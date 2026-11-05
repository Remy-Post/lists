# 03: QA report (e2e: 3G, kill, flows, sync, size)

**Date:** 2026-11-05 · **Team:** QA · **Procedures:** `tests/e2e/README.md` · **Raw data:** `tests/e2e/out/*.json`

**Builds tested.**
- **Current**: `20261105.5f8b42e`, built from the working tree at about 16:25 (HEAD `5f8b42e` plus the Core
  team's uncommitted edits at that moment; `app-a78b10ff31.js`). §1 reports this build in full. Its results are
  in `tests/e2e/out/build-5f8b42e/`.
- **Re-check**: `20261105.cde13d7` ("Round 3", HEAD at 17:00, `app-978e03ebfd.js`). It was re-run with
  perf, flows and sync in full, net3g at 3G × 3 runs, and persist at 300/1000 ms plus hidden × 5 runs.
  See §1b. Results are in `tests/e2e/out/latest/`.
- **Baseline**: `20261105.e8fea20` (the first build, about 15:45). Its results are kept in
  `tests/e2e/out/baseline-e8fea20/`. Several bugs QA found on it were fixed in `5f8b42e` while QA was still
  running. §3 lists each one with the check that now passes.

**Environment.** Headless Chromium (Playwright 1.64.1) on a shared **2-core ARM VM**. Other teams were working
on the same VM, so the load average was 2–6 during the runs.
- **Network-bound numbers** (3G FCP) are stable, within ±3% run to run.
- **CPU-bound numbers** (input latency, render, boot) are noisy, and pessimistic compared with an M-series Mac.
  Read them as "this box at CPU ×1 / ×4", not as Mac or S25 figures.
- **Real-device sign-off** (S25 over `chrome://inspect`, the Mac) has not been done yet.

## 1. Gates (PLAN §6, audit §5 procedures)

Medians of 5 runs unless noted. Network: S25 profile (412×891 @3.5, touch), CPU ×4. Baseline values are shown
only where they differ meaningfully.

| Gate | Budget | Current `5f8b42e` | Baseline `e8fea20` | Result |
|---|---|---|---|---|
| Critical path (HTML + app.css + app.js), compressed | ≤ 50 KB | br 42.2 KB · gz 47.4 KB (build report) | 41.1 · 46.1 KB | **PASS** |
| Cold FCP, DevTools "3G" (2000 ms, 50,000 B/s), CPU ×4 | ≤ 5.0 s | **4,536 ms** (range 4,532–4,628) | 4,524 ms | **PASS** (the audit's stricter median ≤ 4.5 s: misses by 36 ms) |
| Cold interactive (`__lists` + rows), 3G | (none) | 5,155 ms | 7,196 ms | info |
| Cold FCP / interactive, "Slow 4G" | (none) | 1,376 / 1,614 ms | 1,368 / 2,218 ms | info |
| Cold FCP / interactive, packet-level 3G (400 ms RTT, 50 KB/s shared) | (none) | 1,184 / 1,986 ms | 1,176 / 3,011 ms | info |
| Repeat visit (SW) to interactive, 3G | ≤ 1.0 s | **347 ms** painted (304 ms ready); with 2,000 nodes **539 ms** | 338 / 634 ms | **PASS** |
| Repeat visit: every response from SW; a `j` at ready moves the cursor | all | 7/7 from SW; yes | 8/8; yes | **PASS** |
| No JS request chain deeper than HTML → JS | 2 levels | `app.js` only | `app.js` → `c-*.js` (+2.0 s) | **PASS** (was FAIL) |
| First visit does not reload itself | no reload | 0/15 runs | 15/15 reloaded | **PASS** (was FAIL) |
| Bytes on the wire, first visit, 3G | (none) | 47 KB at interactive · **234 KB** total (134 KB SW precache) | 58 · 198 KB | see B5 |
| Sync gate is "poor" under 3G (no `/api/sync`) | 0 requests | 0 in 9 s; `effectiveType 2g`, rtt 1850. Slow 4G also poor. Unthrottled syncs (control) | same | **PASS** |
| SIGKILL ≥ 300 ms after the last keystroke | 100% | **300 ms: 10/10 · 1000 ms: 10/10** (0 ms: 0/10, 150 ms: 10/10, informational) | 10/10 · 10/10 (0: 1/10, 150: 9/10) | **PASS** |
| Hidden-page flush (`visibilitychange` → kill 60 ms later) | 100% | **10/10**; control without the event: 0/10 | 10/10 / 0/10 | **PASS** |
| Freeze flush (CDP `setWebLifecycleState frozen`) | 100% | N/A: headless never hides a page, and CDP doesn't fire `freeze` on a visible one | same | **not testable here** (real S25 needed) |
| Continuous typing, kill mid-stream: all text ≥ 1 s old survives | 100% | 5/5 (lost window 60–256 ms) | 5/5 | **PASS** |
| Quick-add draft survives a kill 400 ms after typing | 100% | 5/5 | 3/5 (caused by B6, not by storage) | **PASS** |
| Two tabs, kill: title from one tab and date from the other both persist | 100% | 5/5 | 5/5 | **PASS** |
| Input latency, 2,000 nodes, CPU ×1, key → next frame | p95 ≤ 16 ms | p50 13.2 · **p95 25.4** · max 34.6 ms (JS p95 3.9 ms; blank-page floor p95 16.2 ms) | p50 41 · p95 91 ms | **FAIL** (B1) |
| Render a node with 500 visible rows, no long task > 50 ms | 0 | **169 ms** at ×1 · **887 ms** at ×4 | (not measured the same way) | **FAIL** (B2) |
| 10k fixture boot (`__lists` ready), CPU ×4 | ≤ 1.5 s | **989 ms** (bootMs 910) | 1,007 ms | **PASS** |
| 10k boot: one long task ≤ 200 ms, CPU ×4 | ≤ 200 ms | **515 ms** (123 ms at ×1) | 546 ms | **FAIL** (B4) |
| 10k: no long task > 50 ms after ready (complete 10, indent 9, zoom) | 0 | every action is one: 53–243 ms at ×1, up to 930 ms at ×4 | similar | **FAIL** (B3) |
| JS heap, 10k nodes | ≤ 60 MB | 32 MB | 28 MB | **PASS** |
| Keyboard flows, desktop 1728×1000 | all | 31/32 (B6) | 31/32 | **FAIL** (one, S3) |
| Touch flows, phone 412×891 (＋, swipe, edge swipe, accessory bar, long-press drag, Today clear) | all | 7/7 | 7/7 | **PASS** |
| Two tabs live (BroadcastChannel) | all | 3/3 | 3/3 | **PASS** |
| Two-device sync: convergence, LWW, ciphertext only, offline cycle → same acyclic tree, delete, reload | all | **22/22** | 18/22 (F3–F5) | **PASS** |


## 1b. Re-check on `cde13d7` (17:00)

| Gate | `5f8b42e` (§1) | `cde13d7` | Result on `cde13d7` |
|---|---|---|---|
| Cold FCP, 3G | 4,536 ms | **4,540 ms** (3 runs; worst 4,656) | **PASS** |
| Repeat visit, 3G (tutorial / 2,000 nodes) | 347 / 539 ms | **367 / 549 ms** | **PASS** |
| No chain, no self-reload, all repeat responses from SW, sync gate poor under 3G | pass | pass (9/9) | **PASS** |
| Bytes on the wire, first visit | 234 KB | 234 KB (134 KB precache) | B5 open |
| SIGKILL 300 / 1000 ms; hidden flush (control) | 10/10, 10/10; 10/10 (0/10) | **5/5, 5/5; 5/5 (0/5)** | **PASS** |
| Typing, 2k, ×1: key→frame p50 / p95 (floor p95); JS p95 | 13.2 / 25.4 (16.2); 3.9 ms | **10.6 / 19.9 (16.6); 6.4 ms** | **FAIL** as written; within floor + 4 ms (B1) |
| Typing, 10k, 500-row page, ×1: JS for the key p50 / p95 | 13.4 / 25.9 ms | **12.2 / 32.7 ms** | still O(n) per key (B1 #2) |
| Render 500 rows: longest task ×1 / ×4 (key → frame) | 169 / 887 ms (252 / 1,067) | **0 / 151 ms** (153 / 296) | ×1 **PASS**, ×4 **FAIL** (B2) |
| 10k interactions: longest task ×1 / ×4 | 243 / 930 ms | **67 / 402 ms** | **FAIL** (B3, much improved) |
| 10k boot ×4: ready / longest task | 989 / 515 ms | **1,099 / 472 ms** | ready **PASS**, task **FAIL** (B4) |
| Desktop + phone + tabs flows | 43/44 (B6) | **44/44** | **PASS**: B6 fixed |
| Two-device sync | 22/22 | **22/22** | **PASS** |

On `cde13d7` the 500-row render no longer produces a long task at CPU ×1, yet a key still takes 153 ms to
reach the frame. The work is now split across tasks or moved into rendering, which the Long Tasks API doesn't
count. A gate stated as "key → frame" would still fail. Consider gating on LoAF
(`long-animation-frame`) instead.

## 2. Bugs, ranked (current build)

Severity: **S1** = GOALS failure or data loss · **S2** = fails a release gate or a core flow · **S3** = polish.
B1–B6 each have a check in a suite that fails today and will pass once fixed. B7 and B8 are observations, each with reproduction steps.

### B1 (S2): Typing latency misses the 16 ms gate (and at 10k each keystroke walks the whole tree)
**Status on `cde13d7`:** improved (2k p95 19.9 ms against a floor of 16.6). The 10k O(n)-per-key walk is still there: `store.js` `changed()` still calls `memo.clear()` on every patch.
**Gate:** PLAN §6, "Input latency (keypress to paint), 2,000-node tree: ≤ 16 ms p95 desktop".
**Metric:** `keydown.timeStamp` → a message posted from the next `requestAnimationFrame`, i.e. after that frame's
rendering work. 120 keys at 40 ms intervals, CPU ×1.

| Page | key → frame p50 / p95 / max | JS for the key (task) p50 / p95 |
|---|---|---|
| blank page with one contenteditable (the metric's floor) | 2.9 / **16.2** / 16.9 ms | 0.6 / 1.4 ms |
| 2,000 nodes, list page with 208 visible rows | 13.2 / **25.4** / 34.6 ms | 1.8 / 3.9 ms |
| 10,000 nodes, the 500-row page | 28.4 / **54.5** / 187 ms | 13.4 / 25.9 ms |
| same at CPU ×4 (2k / 10k) | 35.8 / 70.3 ms · 97 / 305 ms | 7.3 / 16.6 · 50 / 107 ms |

An earlier run of the same build gave 17.1 / 32.0 ms for the 2k row. The baseline (`e8fea20`) gave 41 / 91 ms,
so the new `refillRow` fast path more than halved the latency, but the gate still fails.

**Two findings.**
1. **At 2k, the JS is cheap (p95 3.9 ms); the frame is not.** About 10 ms per key above the floor is style,
   layout and paint of the whole outline. A trace shows Paint plus Layout around 4–5 ms per key even at
   73 rows. Rows have no `contain` and no `content-visibility`, so changing one title re-lays-out every row.
   *Fix:* add `contain: layout paint style` on `.row`, or `content-visibility: auto;
   contain-intrinsic-size: auto 36px`.
2. **At 10k, every keystroke does an O(n) walk.** `store.js` bumps `version` and calls `memo.clear()` on every
   `patch`, title edits included. `view.js` `refillRow` → `fillRow` then calls `S.countOpen()` whenever the typed
   row has children, which rebuilds the whole-tree `'open'` map, a pass over all 10,000 nodes, on each key.
   That is the 13 ms median JS above. *Fix:* invalidate the open-count and query memos only when a change
   touches `pos`, `done`, `deleted`, `heading` or `kind`; a `title` keystroke can't change them.

**The gate as written is (nearly) unattainable.** Even a blank contenteditable has a p95 of 16.2 ms with this
metric, because the next frame waits for vsync. Restate it as one of these:
- "key task p95 ≤ 8 ms **and** key → frame p95 ≤ floor + 4 ms", or
- the audit's Event Timing share.

By the first wording, 2k passes on JS (3.9 ms) and fails on the frame (25.4 ms against 20.2 ms); 10k fails both.

**Reproduce:** `node tests/e2e/perf.mjs` (steps "floor", "2k typing", "10k typing").

### B2 (S2): Rendering a node with 500 visible rows is one long task
**Status on `cde13d7`:** passes at CPU ×1 (no long task), but the key still takes 153 ms to reach the frame. Fails at ×4 (151 ms task, 296 ms to frame). `scrollTo({ top: 0 })` is still unconditional in `show()`.
**Gate:** PLAN §6, "Render 10,000 nodes with 500 expanded: no long task > 50 ms".
**Measured, real input** (open a child page, press `u` to come back up to the 500-row node; 10k fixture):
CPU ×1: one **169 ms** long task, 252 ms from key to frame (an earlier run measured 175 ms and 377 ms). CPU ×4: **887 ms**, 1,067 ms.

A Chrome trace of the same keypress shows a single **236–274 ms keydown task** at CPU ×1:
- forced **style recalc 67 ms** plus **layout 59 ms**, both with the stack `show()` (main.js) ← `ui.go`;
  the minified frame `St@11:54962` is the `scrollTo({ top: 0 })` call in `show()`, which runs right after the
  synchronous `renderPage()`;
- **ParseHTML 26 ms**: `view.js` `makeRow()` sets `innerHTML` once per row, 500 times;
- the rest is JS in `renderPage`/`fillRow`.

**Reproduce:** `node tests/e2e/perf.mjs`, step "render 500". To reproduce by hand, create BIG with 100 children
of 4 children each, open `#/n/<first child>`, press `u`, and record a performance profile.

**Suspected / fix:**
- `main.js` `show()`: skip `scrollTo` when `scrollY === 0`, or move it to the next frame.
- `view.js` `makeRow()`: clone a `<template>` instead of parsing HTML per row.
- Render the first screenful synchronously and the rest in idle chunks, or rely on
  `content-visibility: auto` on rows so that off-screen rows cost no layout.

### B3 (S2): Every structural edit on a big page is a long task
**Status on `cde13d7`:** much improved (×1 longest 67 ms, ×4 402 ms). Still fails the 50 ms gate.
On the 500-row node of the 10k fixture, each single action is one long task:
- each of 10 completes and 9 indents: 53–171 ms (median 71 ms) at CPU ×1, and 195–930 ms (median 335 ms) at CPU ×4;
- zoom out to Today and back in: 243 ms at CPU ×1 and 1,054 ms at CPU ×4.

At CPU ×4 that is visible jank on every keystroke-level action.

**Reproduce:** `perf.mjs`, step "10k interactions".

**Suspected:** `main.js` `schedule()` runs a full `renderPage({flip})` + `renderSide()` + `ui.refreshInsp()`
for any structural change:
- `view.js` `renderPage` re-runs `fillRow` for all 500 rows;
- `measure()` reads `getBoundingClientRect` for every on-screen row (FLIP);
- `renderSide` walks the whole tree (`S.qToday`, plus `S.countOpen` per list).

Patch only the rows whose ids changed, plus their ancestors' counts, and cache counts per version.

### B4 (S2): Boot long task with 10,000 nodes
**Status on `cde13d7`:** unchanged (472 ms at ×4).
**Gate:** audit §5, "at most one boot long task ≤ 200 ms" at CPU ×4.
**Measured:** the longest boot task is **515 ms** at CPU ×4 (123 ms at ×1). Ready median: 989 ms at ×4 and 344 ms at ×1. Heap: 32 MB. Boot as a whole passes ≤ 1.5 s.

**Suspected:** `main.js` `boot()` does `DB.loadAll()` → `S.hydrate()` (`rebuild()` with the per-node cycle
walk) → the first `renderPage` in one task. Yield between hydrate and render, and render the first screen
before building the full `order()`/count caches.

### B5 (S2): First visit moves 5× the bytes it needs, on the 3G pipe
**Status on `cde13d7`:** unchanged (234 KB down; fonts still requested at 4.52 s on 3G).
**Cold 3G, current build:**
- the page was interactive with **47 KB** transferred;
- by the end, the wire carried **234 KB down** and 10 KB up;
- **134 KB** of that is the service worker's precache, which re-downloads with `cache: 'reload'` every asset the
  page had just fetched (app.js, app.css, both fonts, phone.css, desk.css), plus `panels`, `sync`, `gl`,
  and four PNG icons (21 KB);
- separately, **both fonts (50 KB) are requested at VeryHigh priority at 4.49 s on 3G**, while app.js is still
  downloading. That is because `font-display: optional` still fetches the font, so the fonts are not
  "lazy after interaction" as GOALS requires.

DevTools throttling hides most of this cost: it throttles each request separately and does not throttle
service-worker fetches at all. On the packet-level link (400 ms RTT, 50 KB/s shared, `net3g` pass `wire`),
app.js takes **1.30 s** to arrive (0.51 → 1.81 s) while the fonts share the pipe. It is followed by the 134 KB
precache.

The 3G cold FCP is **4,536 ms** (gate 5.0 s: pass). It misses the audit's stricter median of 4.5 s by 36 ms.
That is 12 ms above the baseline median, as app.css grew from 6.2 to 7.4 KB br. The render-blocking CSS
(app.css, 7.9 KB on the wire) finishes at 4.47 s, so every extra KB of CSS costs about 20 ms of FCP on this
preset.

**Suspected:**
- `src/sw.js` install: `c.addAll(PRE.map(u => new Request(u, {cache:'reload'})))`. Use the default cache mode
  for hashed `/assets/*`, which are immutable, and keep `reload` only for `/`.
- `build.mjs` precache list: don't precache `desk.css` on a phone, or the 512 px icons; fetch those lazily.
- `src/css/app.css` `@font-face`: inject the fonts after first interaction or idle, as the GOALS budget says.

### B6 (S3): Keystrokes typed right after ⌘K / q / t are dropped
**Status on `cde13d7`:** **fixed**; `flows.mjs` 44/44.
The palette, the composer, the date picker and the move palette focus their input in `setTimeout(…, 20)`
(`ui.js` lines 265, 341, 403; `panels.js` line 98). While the overlay is open, `keys.js` ignores the keys.
Keys typed in that window go nowhere.

**Reproduce:** press Ctrl+K and immediately type `abc`. The palette input stays empty. The same happens after
`q`.
- `flows.mjs`, "keys typed immediately after ⌘K and q": `{"palette":"","quickAdd":""}`.
- On the baseline, this race also cost the first letters of quick-add drafts in the kill test (3/5).

**Fix:** call `input.focus()` synchronously after `open()` appends the panel (focus works on a connected
element), and keep the timeout only as a fallback.

### B7 (S3): Taps during a View Transition are swallowed
**Status on `cde13d7`:** not re-checked.
After any pointer or hash navigation, `transition()` (`view.js`) runs `document.startViewTransition`. Until
`finished` resolves, hit-testing returns `<html>` (seen with `elementFromPoint`), so taps and long-presses in
the first ~300–400 ms (`::view-transition-group` 300 ms, `ztitle` 380 ms) are lost. On the phone, "tap a list,
then tap a row" is a natural fast sequence.

**Reproduce:** in the phone context, `page.goto('#/today')` then `'#/inbox'`. Within 300 ms, dispatch a
touch-start on a row: `pointerdown.target` is `HTML`.

**Fix:** shorten the transitions, skip View Transitions for touch, or set
`::view-transition { pointer-events: none }`.

### B8 (S3): Two render-blocking stylesheets on the phone, and desk.css downloaded anyway
**Status on `cde13d7`:** unchanged (the waterfall still shows `phone.css` blocking and `desk.css` at VeryLow).
On the S25, `app.css` and `phone.css` (whose media matches) both block render, and `desk.css` is fetched at
VeryLow priority (1 KB). This is audit X3: it costs little on DevTools 3G, but it adds a request on a real
pipe.

**Fix:** fold `phone.css` and `desk.css` into `app.css` `@media` blocks (still separate CSS from JS and HTML).


## 3. Found on the baseline and fixed in `5f8b42e` (verified)

| # | Bug on `e8fea20` | Evidence then | Check now |
|---|---|---|---|
| F1 | **First visit reloads itself** when the service worker takes control (`controllerchange` → `location.reload()`). A user typing during the first seconds lost the rest of the line, and later keystrokes fell into the nav-mode keymap. | Under 3G the reload came at 7.3 s, 0.1 s after interactive. On the packet-level link it came at 6.7 s, 3.7 s after interactive. In flows, typing "typed during the first visit" persisted only "typ". | `flows.mjs` "no self-reload" PASS; `net3g` "first visit does not reload" PASS (0/15 runs) |
| F2 | **Critical-path import chain**: `app.js` statically imported the shared chunk `c-VHNSBD2M.js` (esbuild's `__export` helper). It was not modulepreloaded, so the browser found it only after app.js arrived. | On 3G it was requested at 5.05 s and finished at 7.08 s, which delayed interactive from about 5.1 s to 7.2 s (+2.0 s). | `net3g` "no JS chain deeper than 2" PASS. Cold 3G interactive is now **5.16 s**. |
| F3 | **"On this device" after reload**: a paired device reported `unpaired` after any reload, until the backup went stale (up to 15 min). ⌘S / the sync button opened Settings instead of syncing. | `sync.mjs`: `{"state":"unpaired"}`, 0 sync requests, Settings opened | `sync.mjs` both checks PASS |
| F4 | **"Synced" toast while offline**: `sync.syncNow()` never rejected, so `ui.syncNow` always toasted "Synced". | toast "Synced", label "Offline" | `sync.mjs` PASS |
| F6 | **"Backed up" while waiting**: under a poor link with unsent edits, the gate set `status('idle', 'Waiting for a good connection')` and the button read "Backed up". | `net3g` gate: state idle + message; label from `paintSync` | Bundle now maps it to "Waiting for Wi-Fi" (`main.js` `paintSync`). Verified in code and bundle, not by an e2e label check. |
| F5 | **Pairing duplicated the tour**: each fresh device seeded 5 tour items, and joining merged both copies, so A had 10. | `{"inboxOnA":10}` | `sync.mjs` PASS |

**About the 0 ms kill result.** On the current build, 0 of 10 bursts survive a kill 0 ms after the last
key. This is not a durability bug:
- a separate probe killed the browser 0–200 ms after a write had **committed** (`DB.writes` advanced,
  nothing pending), and 6/6 survived;
- the loss comes from the documented batch window: `db.js` flushes at most 250 ms after the first queued
  write, and a scripted burst over CDP is shorter than that.

That is the reason PLAN's gate is "≥ 300 ms old". On a phone that is backgrounded, the hidden flush covers the
gap (10/10 against 0/10 without it).

**Test note.** The current build disables tree moves in smart views by design (`actions.js`
`indent()`/`outdent()` return early off outline pages). Because the first-run tour lands on Today, the
persistence and sync suites now navigate to `#/inbox` before editing. Without that change, a run that preceded
it showed "indent lost", which was a test artifact and not data loss.


## 4. What passed (abridged)

- **Desktop keyboard flows (1728×1000).** 31 of 32 checks pass; the only failure is B6. Covered:
  - creating items: ⌘K "New list", Enter chaining;
  - structure: six-level Tab nesting with `aria-level` 6, Shift+Tab, Backspace-join with the caret at the seam;
  - navigation: Escape to nav mode, `j/k/↑/↓/g g`;
  - completion: `x` with the `.tl svg.strike path`;
  - undo/redo across a join and a completion;
  - zoom: `z`, breadcrumbs, `history.back`, Ctrl+., `u`;
  - quick add: "Pay rent every 1st !!" gives rrule `FREQ=MONTHLY;BYMONTHDAY=1`, priority 2 and the repeat chip;
  - dates: `t` "tomorrow" shows the item in Upcoming; `]` `[` `}`;
  - commands: ⌘K jump, `m` move;
  - Trash: delete goes to Trash, restore puts it back;
  - paste: a 6-line indented outline through the real clipboard (nesting and `[x]` preserved);
  - Today: Ctrl+A, `x` shows "Today is clear." (`body.cleared`).
- **Two tabs (BroadcastChannel).** Live cross-tab updates work. Both edits persist, both when the tabs edit
  different items and when they edit different fields of the same item.
- **Phone (412×891, touch).**
  - ＋ composer; swipe right completes and draws the strike; an edge swipe (x < 24) is ignored;
  - the accessory bar shows while editing; long-press drag reorders; tapping every box shows "Today is clear.";
  - CDP touch arrives as `pointerType: "touch"`.
- **Two-device sync (22/22).**
  - pairing code: 52 characters, Crockford; a wrong code is rejected and B stays paired;
  - convergence after A, B, A: identical record sets and identical rendered trees;
  - a concurrent edit to the same title resolves LWW, and the later edit wins on both devices;
  - server rows contain no plaintext;
  - offline concurrent moves X→Y and Y→X converge to the same acyclic tree on both devices: the later move
    loses, Y stays under P, X goes under Y, nothing is lost, and the same answer comes back after a reload
    rebuilt from IDB;
  - a delete on A shows up in B's Trash.
- **Sync gate.**
  - Under DevTools 3G, Chromium reports `effectiveType 2g, rtt 1850, downlink 0.35`. `linkQuality()` is
    poor, and **0** `/api/sync` requests were made in 9 s with a stale backup.
  - Under Slow 4G (`3g`, 500 ms): also poor, 0 requests.
  - Unthrottled (control): it syncs.
