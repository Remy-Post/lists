# End-to-end tests (QA)

Real Chromium (Playwright 1.64), real input, production-like serving. Each suite prints `PASS`/`FAIL` lines,
writes a JSON result to `tests/e2e/out/<suite>.json` and exits non-zero if any check fails. Results and the
gate table live in `docs/audits/03-qa-report.md`.

```sh
export PATH=~/.local/node/bin:$PATH
node tests/e2e/net3g.mjs 5      # 3G / Slow 4G / packet-level 3G timings + sync gate        (~12 min)
node tests/e2e/persist.mjs 10   # SIGKILL persistence                                       (~20 min)
node tests/e2e/flows.mjs        # keyboard flows (1728×1000), touch flows (412×891), 2 tabs (~1.5 min)
node tests/e2e/sync.mjs         # two devices against one sync server                       (~1 min)
node tests/e2e/perf.mjs         # 2k input latency, 500-row render, 10k boot                (~6 min)
node tests/e2e/smoke.mjs        # (pre-existing) boot + screenshots; needs BASE=<url> of a running server
```

Every suite first runs `node build.mjs` with `OUT=tests/e2e/out/dist`, so it never touches the shared `dist/`
and it tests the current `src/`. Set `NO_BUILD=1` to reuse the last build (do this when comparing runs, so all
suites test the same bytes; the build id is in `tests/e2e/out/dist/version.txt`). `DIST=<dir>` points the suites
at another build directory (e.g. `OUT=tests/e2e/out/dist-x node build.mjs`, then `NO_BUILD=1 DIST=tests/e2e/out/dist-x`).
Suites write `tests/e2e/out/<suite>.json`; copy them aside before testing another build.

Ports used (all bound to 127.0.0.1, all killed on exit): static 8088–8098 and 8089/8093 (with `/api` proxied),
sync servers 8094 and 8099, TCP proxies 8095/8096. Sync servers use a throwaway SQLite file in `$TMPDIR` with
`LISTS_NEW_VAULTS=1000 LISTS_FAIL_MAX=1000` so the per-IP limits don't trip during tests.

`lib.mjs` holds the shared pieces: build, static/sync server spawn, a byte-counting / link-shaping TCP proxy,
the DevTools presets, `ready(page)` (= `window.__lists` defined and a `.row` rendered), `app(page, fn)` (run a
function with `S, O, A, DB, st, ui` in the page), median/percentile and a small check collector.

## Environment caveat

The VM is a shared 2-core ARM (aarch64) box that other teams build on; load average during the runs was 4–6.
CPU-bound numbers (boot, render, input latency) are therefore pessimistic versus an M-series Mac and noisy run
to run; network-bound numbers (FCP under 3G) are dominated by the emulated latency and are stable (±2%).
Headless Chromium (`--headless=new` for the persistence suite, Playwright's headless shell elsewhere).

## net3g.mjs — 3G gates

Procedure, per pass, `RUNS` (default 5) independent runs, medians reported:

1. Fresh browser context (= empty profile, no HTTP cache, no service worker), S25 viewport 412×891 @3.5,
   mobile + touch, Android UA.
2. CDP on the page: `Network.enable`, `Network.emulateNetworkConditions` with the exact DevTools presets from
   `docs/research/02-platform.md` §C.3 —
   **3G** = latency 2000 ms, 50,000 B/s down, 50,000 B/s up, `cellular3g`;
   **Slow 4G** = 562.5 ms, 180,000 B/s, 84,375 B/s, `cellular4g` — and `Emulation.setCPUThrottlingRate {rate: 4}`.
3. An init script (runs before the app) records `first-contentful-paint` (PerformanceObserver `paint`), the
   moment `window.__lists` is assigned (end of `boot()`: handlers bound, rows rendered = **ready**) and two
   frames later (**painted** = rows on screen). It reports through `exposeBinding`, so the app's own reload
   can't erase the numbers.
4. Navigate to `/#/today`. The waterfall comes from CDP `requestWillBeSent` / `loadingFinished` (start/end in ms
   from the document request, encoded bytes). Wire bytes come from a pass-through TCP proxy in front of the
   static server (exact bytes on the socket, headers included, service-worker fetches included).
5. Wait for the service worker to control the page (and for the app's self-reload, which is recorded).
6. **Repeat visit**: a new tab in the same context (same throttling, CPU ×4), `/#/today`; record ready/painted,
   check every response is `fromServiceWorker`, and that a `j` keypress right at ready moves the cursor.
7. Seed the 2,000-node fixture through `O.create`, flush, and repeat (6) again ("repeat, 2,000 nodes").

Passes: `3G`, `Slow 4G`, and `wire` — the 3G *target* link (400 ms RTT, 400 kbps each way) applied at TCP level
by the proxy, so all requests, including the service worker's precache, share one pipe (DevTools throttles
each request separately and does **not** throttle service-worker fetches at all, which hides contention).

Gates: 3G cold FCP median ≤ 5.0 s; 3G repeat painted median ≤ 1.0 s; every repeat response from the SW;
no JS chain deeper than HTML → JS; no self-reload on first visit.

**Sync gate** (same suite): pair a device (`ui.createVault()`), mark the backup stale
(`sync.sync` meta: `lastPull` 1 h ago, `dirty` 10 min ago, plus one edit), set the network to 3G, fire
`online` (→ `maybeSync`), wait 9 s. Pass = **zero** `/api/sync` requests and `ui.syncState().message ===
'Waiting for a good connection'` (i.e. `linkQuality()` said `poor`). Repeated under Slow 4G (also poor:
`effectiveType` 3g) and unthrottled (control: must sync). `navigator.connection` values are recorded.

## persist.mjs — hard kill

Chromium is spawned by the test itself (`--headless=new --no-sandbox --user-data-dir=<tmp>
--remote-debugging-port=0`, own process group) and driven with `chromium.connectOverCDP`. Kill =
`process.kill(-pid, 'SIGKILL')` on the whole group (browser, renderer, GPU, storage and network services) —
not a graceful close. Relaunch on the same profile, open the app, read the store.

Each run uses a fresh profile that is **primed** first (boot, SW takes control, the app's self-reload settles),
so the measured edits are not racing the first-visit reload bug.

Edit burst (real keyboard, 15 ms/key): Esc, `j`, `o` (new item below), type `A-<tag>`, Enter, type `B-<tag>`,
Tab (nest B under A), type `!z`. Survival = A exists, B's title is complete (`B-<tag>!z`) and B is nested under A.

| Case | Procedure | Gate |
|---|---|---|
| delay T | burst, wait T ∈ {0, 150, 300, 1000} ms after the last key, SIGKILL; 10 runs each | T ≥ 300: 10/10 |
| hidden | burst, wait 450 ms (all flushed, batch timer idle), type `Q`, 20 ms, fake `visibilitychange` to hidden (`document.visibilityState` overridden, event dispatched — Chromium headless never hides a page itself), 60 ms, SIGKILL; `Q` must survive | 10/10 |
| control | the same timing without the event (shows what the hidden flush buys) | informational |
| freeze | as *hidden* but CDP `Page.setWebLifecycleState {state:'frozen'}` (fires `freeze`) | 10/10 |
| stream | one char every 60 ms for 3–4 s, SIGKILL mid-stream; everything typed ≥ 1 s before the kill must be there | 5/5 |
| draft | `q`, type a quick-add draft, 400 ms, SIGKILL; `DB.getMeta('draft')` restored | 5/5 |
| tabs | two tabs of the profile; tab A types into an item's title, tab B sets its date with `t` → "tomorrow"; 700 ms; SIGKILL | 5/5 both edits |

## flows.mjs — interaction flows

Fresh context per group, `serviceWorkers: 'block'` (so the first-visit reload can't race the script; run with
`SW=1` to allow it). All actions are real `keyboard.press/type`, mouse clicks, or CDP `Input.dispatchTouchEvent`
(which Chromium turns into `pointerType: 'touch'` pointer events; the suite records the pointer types it saw).
The store is only read, to assert. Keyboard map: `src/js/keys.js`, `src/js/input.js`; Mod = Ctrl on Linux.

Desktop 1728×1000 @2: ⌘K → "New list" → title; Enter chaining; Tab ×5 (6 levels, aria-level 6) and Shift+Tab;
Backspace-at-start join (caret at the seam); Escape → nav mode; `k/j/↑/↓/g g`; `x` + `.tl svg.strike path`;
Ctrl+Z ×2 / Ctrl+Shift+Z ×2 (complete, then join); `z` zoom (title + breadcrumbs + sheet edges), `history.back`,
Ctrl+., `u`; `q` "Pay rent every 1st !!" (rrule `FREQ=MONTHLY;BYMONTHDAY=1`, priority 2, repeat chip); `t`
"tomorrow" → Upcoming; `] [ }`; Ctrl+K search "L4" → jump; `m` → Inbox; Backspace → Trash (`g x`) → restore by
its box; paste of a 6-line indented outline via the real clipboard; Ctrl+A, `x` in Today → `body.cleared`
and "Today is clear.". Also: keys typed immediately after Ctrl+K / `q` must reach the input.

Two tabs (same context): different items edited in each → each tab sees the other live, both in IDB after
closing; same item (title in one tab, date in the other) → both persist.

Phone 412×891 @3.5, touch: ＋ → composer → "Phone item tomorrow"; swipe right (CDP touch, 80→330 px) completes
and draws the strike; a swipe from x = 10 (edge) is ignored; tapping a title shows the accessory bar; long-press
650 ms then drag row 1 into the gap between rows 2 and 3 (Inbox); tapping every box in Today → "Today is clear.".

## sync.mjs — two devices

Two contexts (= two profiles) on one static server with `/api` proxied to a fresh `server/sync_server.py`.
A `ui.createVault()` → code; `ui.pairingCode()` must match; B `ui.join(code)`; a wrong code must be rejected
and leave B paired. Edits with the keyboard on both (new items, retitle, complete, indent, a concurrent edit of
the same title), then `ui.syncNow()` A, B, A → identical record sets (id → title, parent, done, when) and
identical rendered trees; the later concurrent title wins; the server's SQLite rows contain no plaintext.
Cycle: list P with X and Y; both devices `setOffline(true)`; A moves X under Y, B moves Y under X; online;
sync A, B, A → no cycle on either, same effective parents, nothing lost. Delete on A → in Trash on B.
After a reload: the sync state must not read "unpaired" and Ctrl+S must sync.

## perf.mjs — size gates

Desktop context, SW blocked, CPU ×1 and ×4 (`CPU="1,4"`). Fixtures are generated in the page with the app's
own `O.create` in one transaction (deterministic PRNG): titles 2–6 words (10% 14–19 words), 30% notes,
15% dated 1–30 days out, 5% weekly-recurring, max depth 12. Flushed to IDB, then **reloaded**.

- **Typing, 2,000 nodes** (10 lists): open a list page (≈200 visible rows), edit the middle row, type 120
  characters at 40 ms intervals. Latency = `keydown.timeStamp` → a message posted from the next
  `requestAnimationFrame` (i.e. after that frame's rendering work). p50/p95/max; plus the count of Event
  Timing entries ≥ 16 ms. Gate: p95 ≤ 16 ms at CPU ×1.
- **10,000 nodes** (20 lists, one node "BIG" with 100 children × 4 = 500 visible rows): 5 boots →
  median `window.__lists` time from navigation start and `bootMs`; long tasks during boot; heap.
  Render BIG via `ui.go(…, 'key')` (keyboard path, no View Transition): long tasks and the time to the next
  frame. Then complete 10, indent 9, zoom out/in: long tasks. Then typing on BIG.
  Gates: no long task > 50 ms rendering 500 rows; at CPU ×4 boot ≤ 1.5 s, boot long task ≤ 200 ms, heap ≤ 60 MB.

Artifacts: `tests/e2e/out/*.json` (all raw numbers, every waterfall), `*.log`, and screenshots
`flows-*.png`. `tests/e2e/out/` is scratch and safe to delete.
