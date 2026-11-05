# 01: Plan audit (Red Team)

**Subject:** `docs/PLAN.md` against `docs/GOALS.md`, Remy's stated wishes, and the research in `docs/research/01–04`.
**Date:** 2026-11-05 · **Auditor:** Red Team (independent; did not see the plan author's reasoning).
**Severity key:** **S1** = will cause a GOALS failure or data loss if not fixed before build. **S2** = will cost a rebuild or a failed gate. **S3** = polish or clarity.

Citations use the plan's own shorthand: C = 01-competitors, P = 02-platform, D = 03-design-craft, A = 04-architecture.

---

## 0. Verdict

The plan is well researched and the direction ("Blue Pencil", flat adjacency list with per-field LWW, raw WebGL2 for one moment) is sound. Its weaknesses are a **v1 that is too broad for "flawless"**, a set of **persistence and editing risks it has not named** (and these are the ones that decide whether Remy trusts the app), an **identity that depends on a font asset the plan may cut**, and **gates that read as measurable but aren't yet**. Two adopted research artifacts contradict the plan's own gates: the colour tokens fail the contrast gate, and the CSP blocks the inline boot.

---

## 1. Gaps: requirements the plan misses or underserves

### G1 (S1): Nesting on the phone has no input path
GOALS #1 ("n levels") and #6 (S25 tuned). F1 nests with Tab / ⇧Tab, and F21 covers swipes and drag. **Android soft keyboards have no Tab key.** While typing on the phone you can't indent or outdent except by long-press drag. Every serious mobile outliner puts an accessory bar above the keyboard (⇤ ⇥ ↑ ↓, date, done).
**Fix:** add F22, a keyboard accessory bar on `(pointer: coarse)`. It sits above the keyboard via `interactive-widget=resizes-content` (P A.2) and holds outdent, indent, move up, move down, date and "done editing". Hide the bottom views bar while a row is being edited, because with `resizes-content` it would also ride above the keyboard and eat about 15% of a roughly 450 px visible height.

### G2 (S1): The editing surface and Android IME are undecided
The plan never says how a row is edited (`<input>` or `<textarea>` per row, `contenteditable`, or a single floating editor). This is the largest technical decision in an outliner, and it interacts with F3:
- On Android, Gboard and Samsung Keyboard send `keydown` with `key: "Unidentified"` / `keyCode 229` during composition. So "Enter adds a sibling" and "Backspace on an empty row merges" **cannot be detected from `keydown` alone** on the target phone. They must be handled from `beforeinput` (`inputType` `insertParagraph`, `insertLineBreak`, `deleteContentBackward`).
- Caret movement between rows with ↑/↓, IME composition across a re-render, and autocorrect replacing text all break if the row re-renders mid-composition.

**Fix:** decide in a day-1 spike on the real S25 (Gboard and Samsung Keyboard). Recommended: one `<textarea>` per row while editing, auto-height, rendered as plain text when not editing. Never re-render the row that owns the active composition (`compositionstart`/`compositionend` guard). Treat `beforeinput` as the primary signal and `keydown` as the desktop fast path.

### G3 (S1): Persistence holes that the "kill" requirement exposes
GOALS #2 says killing the browser loses nothing. The plan adopts A §6's flush, which has four holes:
1. **The trailing debounce never fires during continuous typing.** `scheduleFlush()` does `clearTimeout` then `setTimeout(300)` (A §6), so someone typing steadily for 30 s has nothing on disk until they pause. **Fix:** add a max-wait: flush at most 300 ms after the last write *and* at most 1,000 ms after the first unflushed write.
2. **Composer and quick-add drafts aren't persisted.** Only committed mutations reach IDB. A half-typed quick add, or a note being written before Enter, vanishes on kill. **Fix:** persist drafts to `meta` through the same flush.
3. **Multiple tabs cause lost updates.** `flush()` does `put(state.nodes.get(id))`, which writes the *whole record* from this tab's memory. With two Mac tabs open, tab B's stale in-memory record overwrites fields that tab A changed. The plan doesn't mention multiple tabs at all (A §3.2 mentions Web Locks and BroadcastChannel, but only for sync). **Fix:** merge-on-write. Inside the readwrite transaction, `get` the stored record, `mergeRecord(stored, mine)`, then `put`. Also broadcast changed ids over `BroadcastChannel` so other tabs re-read them.
4. **Close and reopen across bfcache.** P B.2 says to close IDB on `pagehide`/`freeze` and reopen on `pageshow`/`resume`. A §6 flushes on `pagehide`. The order must be flush, then close, and writes that arrive while the DB is closed must queue. Unstated.

### G4 (S2): "Themes" is reduced to light and dark
GOALS #8 says "themes & polish". The plan ships only the system light/dark (F20). D §4.3 recommends a Settings override, and D §4.1/§7.3 give a three-input generator (base, accent, contrast) that makes extra themes cheap.
**Fix:** v1 ships *System / Paper (light) / Graphite (dark)*, plus an *Increased contrast* variant driven by `prefers-contrast` and also selectable by hand. That is three themes with no new design surface. Don't add hue variety: every extra accent hue is a slop risk (D §2.1, D §7.7).

### G5 (S2): The "wow" may never be seen, and the plan has no first-run design
The WebGL moment fires only when Today is cleared (D §7.6), which happens at most once a day and never if Remy works mostly inside lists. The visual audit can't trigger it on demand, and the plan has no empty, first-run or onboarding state, so the first impression is a blank page.
**Fix:** seed a first-run Today with four or five plain, useful tasks that teach the keys. For example: "Press x to strike this through", "Tab nests this under the line above", "z zooms into this one", "⌘K finds anything". Completing them ends in "Today is clear" during the first session. Also add a debug route (`#debug/cleared`) for audits. No mascot, no emoji, no confetti.

### G6 (S2): The X-days backup rule is reinterpreted, and measured from the wrong event
Remy: sync "when Wi-Fi/good **and** the backend copy is stale for X days". The plan makes "stale" 2 min / 15 min (so on Wi-Fi it effectively always syncs) and turns "X days" into a rule for escalating to worse links. That is a reasonable design, because two devices need minutes, not days, but **it isn't what Remy said, and nobody has confirmed it with him.** Also:
- "Last successful push older than 3 days" is the wrong measure. With an empty outbox there is nothing to back up, but the rule still fires. Measure **the age of the oldest unpushed change** (the backup lag).
- The relaxed rule must never run a full bootstrap pull (a new device or `reset`) on a poor link. Only push and incremental pull.
- P C.2 and P decision 10 recommend one-off Background Sync as a Chrome enhancement, and the plan omits it. It is the only mechanism that serves "opportunistic when Wi-Fi returns" after the tab is closed. Defer it explicitly or include it; don't drop it silently.

**Fix:** write two named knobs into Settings and the docs, and confirm them with Remy:
- *Keep devices in step:* a good link plus stale > 15 min, or manual.
- *Backup guarantee:* if any change has been unbacked-up for more than X days (default 3), sync on any link that isn't 2g or Save-Data. After 2X days, show a calm, persistent "3 changes not backed up since Tue · Sync now" line. Never a modal (C §4, "sync failures surfaced as popups").

### G7 (S2): Vault registration has no UX, and the contracts disagree
A §8.4 registers a vault with `docker exec … add-vault remy` and the token pasted on the VM. TEAMS.md gives `sync.js` a `createVault()` that returns a pairing code, as if the client can create vaults. The plan says neither. If the client can create vaults, an open endpoint lets anyone store data on Remy's shared VM. **Fix:** choose one. Recommended: the server accepts `createVault` only with a one-time enrollment secret set via an env var, plus a hard cap of 2 vaults. Document the path in README.

### G8 (S2): Pairing deviates from the research and leaks the key
A §4.1 recommends QR (or paste). The plan says "QR-free pairing link (`#pair=…`)" and cites A §4 for it, which is a misattribution. A key in the URL fragment never reaches the server, but it does land in **browser history**, which Chrome syncs to the Google account, and in whatever messaging app carried the link. **Fix:** QR on the first device (lazy-load the QR encoder on the pairing screen only, outside the critical path), with paste as the fallback. If the link stays, strip the hash with `history.replaceState` before anything else runs and document the history caveat.

### G9 (S2): Smart-view semantics for nested, dated items are unspecified
With unlimited depth, Today's rules decide whether it is calm or noisy:
- A parent and its child are both dated today: shown twice, nested, or deduplicated?
- Does a future `when` hide the item in its home list (C steal 4: "hides the item until it is relevant")?
- Which field does recurrence advance, `when` or `deadline`?
- What grammar sets a deadline rather than a when? F6 lists dates but not which field they fill (TEAMS.md's `parseQuick` returns both).

**Fix:** a one-page view spec. Suggested: a node shows in Today if it matches and **no matched ancestor is already shown**, and a matched descendant renders under its matched ancestor. `fri` sets when, and `by fri` / `due fri` sets the deadline. Recurrence advances `when`, and shifts the deadline by the same delta if one is set.

### G10 (S2): Day rollover
Today must recompute at local midnight and on `visibilitychange: visible` (phones resume frozen pages, P B.2). Daily-logging cleanup runs at the same point. Not in the plan.

### G11 (S3): Multi-select and the `x` conflict
C §6 maps `x` to select and `e`/Space to complete. The plan (and D §7.5) uses `x` to complete, and the plan has **no multi-select at all**. "Rescue overdue" covers one bulk case only. **Fix:** v1 gets ⇧↑/↓ range selection, with every single-key action applied to the selection. Keep `x` as complete (it matches the strike metaphor) and drop the `x`-toggle-select.

### G12 (S3): Smaller gaps
- `⌘Z` while the caret is in a field: native text undo or app undo? A §5 coalesces typing into one command per item. Decide that the app owns ⌘Z everywhere (`preventDefault` on native text undo), so text and structure undo in one stack.
- `/` "search" appears in F4, but no search feature is specified. Define it as filtering the current view, or as an alias for ⌘K.
- **Settings screen** contents: backup age, storage persisted or best-effort (P B.1), pairing, theme, haptics. Not listed.
- **Haptics:** D §1.8 recommends an Android 8–12 ms tick on complete and drop. It's missing from the plan's scope. Include it; it costs almost nothing.
- **Reminders and notifications:** not asked for, and not reliable on the web. List them explicitly as a non-goal so nobody builds them.
- The **Mona Sans OFL licence** must ship with the font in the public repo (GOALS #9).
- **Non-ASCII titles:** if the font is subset to Basic Latin to save bytes, accented text (Remy's spec pages are en-CA) falls back glyph by glyph. Keep at least Latin-1 plus general punctuation (em dash, curly quotes, ellipsis).

---

## 2. Contradictions and wrong assumptions vs the research

| # | Plan says | Research says | Why it matters / fix |
|---|---|---|---|
| X1 (S1) | Contrast gate: "all text ≥ 4.5:1", and the D §7.3 tokens are "adopted verbatim" | D §7.3: `--ink-3` is **3.5:1** (light) and **4.3:1** (dark), and is used for placeholders | The gate fails on day one. Raise `--ink-3` to ≥ 4.5:1 or forbid it on text, and measure with axe (§5). |
| X2 (S1) | `index.html` has an "inline boot" | A §8.4's CSP is `script-src 'self'; style-src 'self'` | It blocks the inline boot, any inline critical CSS and inline `@font-face`. It also blocks `style="--depth:4"` attributes in template-rendered rows. CSSOM (`el.style.setProperty`) is allowed. Fix: the build emits `'sha256-…'` hashes into the Caddy CSP, and rows set custom properties via CSSOM only. |
| X3 (S2) | Three stylesheets: `app.css`, plus `phone.css` and `desk.css` with `media=` | P C.4: "**Exactly one CSS file and one JS file**" | Chrome still downloads non-matching `media` sheets (at low priority, non-blocking). On a real 3G pipe they compete for bandwidth. DevTools throttles per request, so **the test won't show this cost** (P C.3). Fix: one CSS file with `@media` blocks inside. It still satisfies "separate HTML/CSS/JS". |
| X4 (S2) | `font-display: swap` | P C.4 and P decision 12: `optional` (or swap with `size-adjust`). D §3.3: swap with a metric-matched fallback | The font is lazy, so with `swap` it arrives seconds after first use and reflows every row under the cursor. Width is the hierarchy, so metric matching can't hide that. Fix: `optional` on first visit. Precache it in the SW after idle, so repeat visits get it inside the 100 ms block window. |
| X5 (S2) | Font: "ship wght+wdth only if ≤ 45 KB, otherwise weight-only plus a `font-stretch` fallback" | D §3.1: wght+wdth is **98 KB**. D §3.3 recommends **two-stage** loading (39.8 KB weight-only, then the 98 KB file after idle). D §7.2: width *is* the hierarchy, and the strike condenses wdth 100 → 88 | The fallback quietly deletes the design's main device. A font with no wdth axis gives nothing from `font-stretch` (the browser doesn't synthesize width), so the completion condense and "Today is clear" at wdth 125 disappear. Fix: §4 R1. |
| X6 (S2) | Server memory gate "≤ 64 MB hard, ~25 MB typical" | GOALS: "one tiny sync service (**≤ 30 MB RAM**)". A §8.3 measured 22–23 MB | The plan weakens a GOALS budget. The gate should be RSS ≤ 30 MB under load. 64 MB is the container limit, not the budget. |
| X7 (S2) | §6 drops P's third harness assertion | P decision 11: assert "the sync gate reports 'poor' under '3G'" | That is the only automated check of GOALS #3's "otherwise stay local". Restore it. |
| X8 (S2) | "Unlimited, global" undo (F11) | A §5: stacks are "per device and in memory, capped at 200" | Unlimited plus in-memory means it is lost on reload anyway. State: 200 steps per session, not persisted. |
| X9 (S2) | F12: completed items stay in place until cleanup | D §7.5 step 4: "after a 1.2 s undo grace, the row collapses (FLIP) into 'Done'" | These directly contradict each other. Pick stay-in-place: it is calmer, matches C steal 16 and D §1.1's frequency rule, and removes a FLIP. Strike D §7.5 step 4 from the motion spec. |
| X10 (S2) | The strike draws, *then* the title condenses (D §7.5, adopted) | Geometry | A strike measured at wdth 100 overshoots by about 12% after the condense to 88. Wrapped titles (common at 412 px) need **one stroke per line box**. Fix: measure the final (condensed) line boxes with `Range.getClientRects()` first, then draw one seeded path per line. Or condense first, then strike. |
| X11 (S3) | Row height 36 px on desk; "48 px targets" on phone | D §7.4: 36 desk / **44** touch. P A.3: ~44 Mac, **52–56** phone, 48 px targets | 44 px touch rows break Android's 48 dp minimum (P A.3). Use phone rows ≥ 48 px (52 with metadata) and 36 px on desk. Write it down. |
| X12 (S3) | Move with ⌥⇧↑↓ (F3) | C §6: ⌘⇧↑/↓. D §1.9: Alt+↑/↓ | Three sources, three bindings. In a text field, ⌥⇧↑ extends the selection by paragraph on macOS. Pick one, document it, and test it in edit mode. |
| X13 (S3) | Desk layout ≥ 1200: 264 + 720 + 360 px | P A.3: three panes only at ≥ 1600. At 1200–1599: "rail, items, and a detail pane on demand" | 264 + 720 + 360 = 1,344 > 1,200. Between 1200 and 1343 the panes overflow. Fix: the inspector overlays below 1600, or the list measure shrinks. P also lists `(height < 480px)` phone landscape, which the plan omits. |
| X14 (S3) | "QR-free pairing link" citing A §4 | A §4.1 recommends QR | Misattribution (see G8). |
| X15 (S3) | "Shared lists (C §5.5)" | C §5 has no §5.5. It is loyalty pattern 5 | Citation fix. |
| X16 (S3) | Caddy `precompressed br gzip`; no web root named | P C.4: `br zstd gzip`, root `/srv/lists.remypost.me/dist`. A §8.4: `/srv/sites/lists/current`, and **don't put data under `/home/ubuntu/sites/lists/data`** | `/home/ubuntu/sites/lists/data/` **already exists on the VM**, which is exactly the path A warns Caddy can serve. Remove it. Use a named volume and the existing `releases/` + `current` convention (see R7). |
| X17 (S3) | Record omits `conflict` and `time` | A §2.2 keeps the losing `notes` in a `conflict` field, so "nothing is silently lost" | Keep `conflict` (cheap, and it prevents a data-loss complaint). Dropping `time` is fine if there are no reminders; then drop `at 5pm` from the grammar too. |

**Assumptions to verify, not trust:**
- **CDP `connectionType: 'cellular3g'` doesn't give `navigator.connection.type` on desktop Linux Chromium.** P C.1 says `type` exists only on ChromeOS and Android. So the Wi-Fi branch of the gate is **only testable with a stubbed `navigator.connection`** (`addInitScript`). The real-throttle e2e can only prove the "poor" branch.
- **The "paper stack" in View Transitions.** VT snapshots are flat images, and the UA sets transforms on named `::view-transition-group`s. "Recede with `translateZ`" has to be a `perspective()` + `scale`/`translate` keyframe on the root snapshot, not real 3D on live DOM. Feasible, but prototype it before promising it.
- **The system fallback can't carry the width hierarchy.** It is unverified whether Chrome on macOS exposes SF Pro's width axis through `font-stretch: 88%` with `system-ui`. Samsung's system font has none. Assume the fallback is weight-only.

---

## 3. Over-scope for v1: cut or defer

The goal is a v1 where every shipped feature passes every gate on both devices. Recommended scope:

| Feature | Verdict | Reason |
|---|---|---|
| F1–F5, F11, F13, F15, F17 (JSON + Markdown export; Markdown import = F13 paste), F18, F20 | **Keep** | The keyboard-first outliner core and trust. |
| F6 quick-add grammar | **Keep, trimmed** | Dates, `!`/`!!`, `#list`, `every …`. Defer click-to-literal on highlighted tokens (overlay-mirror work inside an input). Use **Esc or Backspace right after a token** to un-parse it, and keep the parsed-preview chip (C §4, "always show what was parsed"). |
| F7 when vs deadline | **Keep** | It's the backbone of Today (C steal 4). |
| F8 smart views | **Keep Inbox, Today, Upcoming, Logbook, Trash. Defer "This Evening"** | Evening adds a field, a token, a section and a gate case for little v1 value. Upcoming: 14 days plus a "Later" bucket. Defer the weeks → months compression. |
| F9 breadcrumbs in views | Keep | Necessary with unlimited depth. |
| F10 rescue overdue | Keep | Cheap and on-brand. |
| F12 logging modes | **Keep one mode** | Manual cleanup via a "Clean up" command plus the show/hide toggle. Defer the Daily/Manual setting. |
| F14 recurrence | **Keep a subset** | DAILY, WEEKLY+BYDAY, MONTHLY by month-day, YEARLY, INTERVAL; on schedule and `every!`. **Defer** child-checklist reset, ordinal weekdays, BYSETPOS, COUNT/UNTIL, and multi-occurrence expansion in Upcoming (show the next occurrence only). |
| F16 headings | **Defer** | With unlimited nesting, a parent item already groups. A new node kind touches every view, the parser and the a11y tree. |
| F19 sync | **Keep, trimmed** | Defer tombstone GC: purge markers, `horizon`, `reset` (A §2.5). At this data size, tombstones cost nothing for months. Defer Background Sync (but say so, G6). Keep pairing, E2EE, idempotent push/pull and the `conflict` field. |
| F21 touch | **Keep** swipe-complete, swipe-schedule and long-press reorder. **Defer** the drag-to-place ＋ (Magic Plus) and drag-to-re-nest (use the accessory bar, G1) | Magic Plus is the most expensive gesture in the plan and the easiest to make feel cheap. |
| Virtualized rows | **Defer** (see R3) | 500 expanded rows doesn't need virtualization. |
| Paper-stack sheet edges ("one hairline per level up to 6, then a numeral") | **Keep, but behind a prototype gate** | If the S25 prototype reads as decoration rather than information, ship breadcrumbs plus the recede only. |
| "Today, struck through" WebGL | **Keep, build last** | It is about 1 KB and isolated, but it must not consume time before the core gates pass. |

Process scope: Core (`main/store/db/ops/keys/view/strike` plus all CSS and HTML) is a single owner holding every S1 risk. **Split it**: *Data core* (`store.js`, `db.js`, `ops.js`: pure, unit-tested, owns the persistence gates) and *Interaction* (`view.js`, `keys.js`, editor, CSS). Fold *Light* (a ~1 KB shader) into Interaction or Visual.

**Suggested milestones (vertical slices, each one gated):**
- **M0, spikes (2 days):** the S25 editing surface and IME (G2); the font subset size (R1); the SIGKILL harness (§5); a paper-stack VT prototype on the S25.
- **M1, local outliner:** F1–F5, F11, F13, persistence; the kill and 10k-fixture gates pass.
- **M2:** views, quick add, dates, recurrence subset.
- **M3:** sync and pairing, with the two-device convergence test.
- **M4:** themes, strike, paper stack, haptics, the WebGL moment; visual and anti-slop audit.
- **M5:** deploy, real-device script, docs.

---

## 4. Technical risks the plan underestimates

**R1 (S1): The font budget decides the identity.** Nobody has measured whether a Latin-1 subset of Mona Sans wght+wdth fits 45 KB. The 98 KB file is already the Google Fonts Latin subset (D §3.1). Options, in order:
- (a) Subset with `pyftsubset` to Latin-1 plus punctuation, and limit axis ranges with `fontTools.varLib.instancer` (wdth 85–125, wght 400–700). Measure.
- (b) If that is still over budget, raise the lazy-font budget to ≤ 75 KB. GOALS only requires enhancement assets to be lazy and skipped on Save-Data; it sets no byte cap.
- (c) Only then fall back to weight-only, and **redesign** the hierarchy and the completion state for it, rather than letting `font-stretch` silently no-op.

Do this in M0.

**R2 (S1): `wdth` animation on Android.** `contain: layout` keeps layout inside the row, but if the condensed title **unwraps from two lines to one**, the row's height changes mid-animation and every row below jumps. Each intermediate instance also re-rasterizes glyphs every frame. **Mitigation:** animate wdth only when the title is single-line at both widths (check line rects); otherwise snap. Lock `block-size` during the 180 ms. Gate: a Perfetto/DevTools trace on the S25 at 120 Hz with ≤ 1 dropped frame across the completion.

**R3 (S2): Virtualization with variable-height rows.** Notes previews, wrapped titles and the font swap all change row heights. A virtualized `role=tree` breaks `aria-setsize`/`aria-posinset` unless both are maintained by hand, breaks Chrome's ⌘F (C §6 says keep ⌘F as page find), breaks View Transitions and FLIP for rows that unmount, and fights IME composition when the edited row scrolls out. **Mitigation:** no virtualization in v1. Render only expanded subtrees (A §1 already does this) and put `content-visibility: auto; contain-intrinsic-size: auto 36px` on each top-level child block. Re-evaluate only if the 10k-fixture gate fails.

**R4 (S2): View Transitions.** Support is fine on both targets (Chrome 111+; D §1.11). The risks are behavioural:
- VTs are **not interruptible** and freeze rendering during the update callback (D §1.4). Rapid z / Back / z spam skips transitions and feels broken.
- **Keyboard zoom must be instant** (D §1.1: keyboard actions never animate; D §7.5: list switch "instant from the keyboard"). The plan's paper stack doesn't say this. Use the VT only for pointer and touch zoom, and for the Back gesture.
- Give `view-transition-name` only to the zoomed row (and maybe its visible siblings). Naming hundreds of rows makes each one a separate snapshot.
- Android's back gesture fires `popstate`. Start the VT from the router, and skip it under `prefers-reduced-motion` (D §7.5 reduced-motion row).

**R5 (S2): Touch gestures vs Android system gestures.** With gesture navigation, a swipe right that starts within about 20–30 px of the left edge is the system Back. Long-press on text opens selection and the context menu. **Mitigation:** row swipes start only inside the row body (inset from the edges), `touch-action: pan-y` on rows, `user-select: none` plus `contextmenu` `preventDefault` on the drag handle only, and commit on release (D §1.4). Test with the S Pen too (P A.2).

**R6 (S2): Service-worker update flow is unspecified.** The plan's `sw.js` "precache shell, network-only /api" leaves open:
- How a new version reaches a user. Index is served from cache, so a new deploy shows up only on the *second* load.
- `skipWaiting` mid-session against an IDB schema change.
- **Deleted hashed assets.** The VM's publish convention keeps 5 releases in separate folders (`~/bin/publish-remypost`). An old open page that lazily imports the GL chunk or font after a deploy gets a 404.

**Policy:** cache-first navigation with background revalidation. A new SW waits. The app shows a quiet "Updated · reload" line in Settings and the status area (never a modal), and applies the update on the next cold start. The build **carries forward the previous release's `/assets/*`**. The SW precaches the GL chunk and font after idle (never on Save-Data), so they work offline. IDB upgrades handle `onversionchange` and `onblocked` (A §6).

**R7 (S2): Build and test toolchain on this VM.** **Node isn't installed on the VM** (`node: command not found`). The plan assumes esbuild, `node --test` and Playwright run here. Playwright's Chromium is cached (`~/.cache/ms-playwright/chromium-1248`), but with no Node driver.
- The other sites already build in **GitHub Actions** and deploy via a forced-command `publish-*` script with atomic `current` symlinks.
- **Fix:** build, unit and e2e run in GitHub Actions (free for a public repo). Deploy via a new `~/bin/publish-lists` modelled on `publish-remypost`. For local agent testing, use the `mcr.microsoft.com/playwright` container rather than installing Node on the shared VM.
- esbuild itself is low-risk. Pin its exact version and commit the lockfile. Set `target: ['chrome120', 'safari17']` explicitly so it doesn't lower `oklch()`, nesting or `@starting-style`. Have `build.mjs` generate the SW precache manifest and the CSP hashes.

**R8 (S2): IndexedDB durability on Android kill.** P B.1 is right that `relaxed` already survives a browser-process kill and `strict` adds power-loss safety. The real risks are G3's four holes, plus:
- `persist()` is granted silently by engagement and install heuristics (P B.1). Call it after the first real edit, not on load. Show the result. Push the PWA install (an installed WebAPK makes the grant far more likely).
- Handle `QuotaExceededError` and an IDB open failure (some Samsung privacy modes) with a calm, persistent warning, never silent loss.

**R9 (S3): The sync gate on the Mac.** Chrome on macOS has no `connection.type` (P C.1), so "good" depends on `effectiveType`/`rtt`, which Chrome estimates and caps. Captive-portal Wi-Fi reads as online and 4g. Treat a non-JSON or HTML response from `/api/sync` as "offline", not "error".

**R10 (S3): Event and input model.** "Space completes" scrolls the page unless it is handled. Tab must be trapped inside the tree with an escape hatch (C §6: Esc, then Tab, leaves the tree). Decide roving `tabindex` rather than `aria-activedescendant`, because roving `tabindex` works with the per-row textarea in G2.

---

## 5. Testability: the gates rewritten as procedures

Every gate below names its fixture, tool, N, statistic and pass threshold. Shared harness: `tests/harness/seed.mjs` generates deterministic fixtures from a seeded PRNG, and `tests/harness/throttle.js` is P C.3's CDP helper verbatim.

**Fixtures.** `small` = 50 nodes. `medium` = 2,000 nodes. `large` = 10,000 nodes: 20 lists, max depth 12, 500 rows expanded, 30% with notes, 10% with titles over 90 characters (they wrap at 412 px), 5% recurring, 15% dated across the next 30 days.

| Gate | Exact procedure | Pass |
|---|---|---|
| **Critical path ≤ 50 KB** | `build.mjs` writes `dist/budget.json` listing every file requested before `lists:ready` on a cold load (taken from a Playwright HAR, not guessed), with gzip and br sizes. CI fails if the sum is over budget. | gzip sum ≤ 50 KB. HTML ≤ 14 KB gzip (P decision 12). No font, GL or QR request before `lists:ready`. |
| **Lazy assets** | Same HAR. Separately, emulate Save-Data (DevTools Save-Data emulation, or stub `navigator.connection.saveData = true` via `addInitScript` and send the `Save-Data: on` header), then complete all Today items. | Font ≤ budget (R1). GL ≤ 6 KB. **Zero** font, GL or QR requests under Save-Data. |
| **Cold FCP on "3G"** | Chromium via Playwright, a fresh persistent profile, `Network.setCacheDisabled(true)`, P C.3 `throttle(page, '3G', 4)`, navigate, read the `first-contentful-paint` entry. 7 runs, run **headed under `xvfb-run`** (headless paint timing is less faithful). | Median ≤ 4.5 s, worst ≤ 5.0 s. The HAR shows exactly one render-blocking CSS and no request chain deeper than 2. |
| **Repeat visit ≤ 1.0 s** | Same profile after the SW controls the page (`await navigator.serviceWorker.ready` and `controller !== null`). Seed `medium` into IDB. Reload under 3G + CPU 4×. The app sets `performance.mark('lists:ready')` in the second `requestAnimationFrame` after the first render from IDB, with key handlers bound. 7 runs. | Median `lists:ready` ≤ 1,000 ms. Every response `fromServiceWorker()`. A scripted `j` keypress at `lists:ready` + 0 ms moves focus. |
| **Offline** | After the repeat-visit test: `context.setOffline(true)`, reload, add 3 items, reload again. | The app loads, the items persist, and sync status reads `offline` (not `error`). |
| **Persistence across a hard kill** | Desktop: launch Chromium **as a child process** (`--user-data-dir=<tmp> --remote-debugging-port=0`) and attach with `chromium.connectOverCDP`. (Playwright's default contexts are ephemeral, and `context.close()` is graceful, so neither tests a kill.) Make an edit, wait T, then `process.kill(-pid, 'SIGKILL')` on the whole process group. Relaunch with the same profile and read the DOM and IDB. T ∈ {0, 150, 300, 500, 2,000} ms × 20 runs, for three edit kinds: new item, title edit, indent. Add a **continuous-typing** case (one character every 60 ms for 8 s, kill mid-stream) and a **quick-add draft** case (G3). | T ≥ 300 ms: 20/20 for every kind. Continuous typing: at least everything typed up to 1,000 ms before the kill (needs the max-wait fix). Drafts restored. |
| **Persistence on the S25** | Scripted where possible: `adb forward tcp:9222 localabstract:chrome_devtools_remote`, then Playwright `connectOverCDP`. Edit, wait 1 s, `adb shell am force-stop com.android.chrome`, relaunch the URL with `adb shell am start -a android.intent.action.VIEW -d https://lists.remypost.me`, verify. 20 cycles, plus 3 manual swipe-away-from-Recents cycles, 1 reboot, and 1 run with the installed PWA. | 20/20, plus every manual case passes. `persisted()` shows "protected" after install. |
| **Two tabs** | Two pages, same profile. Tab A edits a title, tab B edits the same item's `when`. Kill as above. Relaunch. | Both edits are present (G3 #3). |
| **Input latency, desktop** | `large` fixture, CPU 1×, 200 scripted keypresses (j/k, x, Tab, Enter, typing). Observe `PerformanceObserver({type: 'event', durationThreshold: 16})`. **Note:** Event Timing never reports durations under 16 ms, so the measurable statement is the share of keypresses that *are* reported. | ≤ 5% of keypresses reported (that is, p95 ≤ 16 ms). No `processingEnd − processingStart` over 8 ms. |
| **Input latency, phone** | Same script under CPU 4× with a 412×891 @3.5 viewport; spot-check on the S25 via CDP. | p95 event duration ≤ 50 ms. |
| **10k render** | `large` fixture. `PerformanceObserver('longtask')` from navigation to `lists:ready` + a 10 s interaction script: expand a 300-child node, zoom in and out three levels, complete 10, indent 10, open ⌘K and type 5 characters. CPU 4×. | `lists:ready` ≤ 1.5 s. At most one boot long task ≤ 200 ms (the IDB `getAll` deserialize). No long task over 50 ms after `lists:ready`. JS heap ≤ 60 MB. |
| **Completion animation (S25)** | A DevTools Performance trace on the device while completing 10 rows (single-line and wrapped). | ≤ 1 dropped frame per completion at the device's refresh rate. Otherwise apply R2's snap. |
| **Contrast** | `@axe-core/playwright` with rules `color-contrast` and `color-contrast-enhanced` (report only) on 8 states (Today, Upcoming, a list, a zoomed item, ⌘K open, quick add with parsed tokens, Settings, Trash) × light/dark × phone/desk = 32 scans. Repeat with `prefers-contrast: more`. | 0 `color-contrast` violations (fix `--ink-3` first, X1). |
| **Accessibility** | The same 32 axe scans with all WCAG 2.2 AA rules. Plus a written 15-step VoiceOver (Mac) and TalkBack (S25) script: navigate the tree, hear the level and expanded state, complete, indent, undo, open ⌘K. | 0 serious or critical axe violations. The script passes on both. `prefers-reduced-motion` scan: no animation over 120 ms, no WebGL (D §7.5). |
| **Anti-slop** | Automate what can be automated, in `tests/slop.mjs` over `dist/`: no `Inter` or `Geist` in `font-family`; no `backdrop-filter`; no `background-clip: text`; no `text-transform: uppercase` together with `letter-spacing`; no `\p{Extended_Pictographic}` in HTML or JS UI strings; no OKLCH hue in 270–330 with chroma > 0.04, and no hex or rgb converting into that range; no `box-shadow` with blur over 24 px in an accent colour; no `@keyframes` named or shaped like shimmer or pulse; no IntersectionObserver-driven fade-ups. Then a human checklist pass over the screenshot matrix, using D §2.2's list item by item. | 0 automated hits. Every checklist line is signed off with a screenshot reference. |
| **Visual matrix** | Screenshots at 412×891 @3.5, 360×800 @3, 1728×1000 @2, 1280×800 @2 and 2056×1200 @2 (P decision 3 ranges); light and dark; 8 states; plus `#debug/cleared`. | Reviewed against Blue Pencil and the anti-slop list. Pixel-diff baselines are stored for regression. |
| **Sync correctness** | Unit: property tests (seeded PRNG, no deps) showing `mergeRecord` is commutative, associative and idempotent over 10,000 random pairs; `effectiveParents` acyclic and order-independent over 3,000 random two-replica sessions (as in A §2.3); the undo/redo invariant from A §5 (N random commands → undo all → redo all → equal state). Integration: real `sync_server.py`, two Playwright contexts paired, both offline (`setOffline`), 50 random edits each including conflicting moves, back online, sync both twice. | The canonical JSON of both stores is identical. No cycles. Pushes retried after a forced connection drop cause no duplicate rows. |
| **Sync gate** | Unit: a decision table over `{type, effectiveType, rtt, saveData, oldestUnpushedAge, lastPullAge, manual, onLine}`, at least 24 rows including the X-days rule. E2E under real CDP "3G". | Every table row matches. Under "3G", `linkQuality()` returns `'poor'` and no `/api/sync` request is made without manual (P decision 11). |
| **Server budget** | Push 10,000 rows from one device, pull them on another, repeat 3 times, then `docker stats --no-stream lists-sync` and `ps -o rss`. | RSS ≤ 30 MB (GOALS). p95 `/api/sync` ≤ 100 ms on the VM. |
| **SW update** | Build v1, serve, load (controlled). Build v2 with changed CSS and GL. Publish v2 with the carry-forward. In the v1 page, trigger the lazy GL import. Reload twice. | No 404s. The v1 page keeps working. The update notice appears, and v2 is active after the next cold start. |
| **Real-device sign-off** | A 12-step checklist for Remy (`docs/DEVICE-CHECKLIST.md`): install the PWA; airplane mode; swipe-kill; Gboard and Samsung Keyboard Enter/Backspace/indent bar; S Pen hover; 120 Hz trace; Mac P3 vs sRGB profile (D §4.2); the §A.4 snippet results pasted into PLAN §10. | Every step ticked by Remy. |

---

## 6. Top 10 changes, ranked

1. **(S1) Spike the S25 editing surface and IME first, and add a phone indent accessory bar.** Use a per-row `<textarea>`, handle structure from `beforeinput`, guard composition. Without this, "n levels" doesn't work on the phone (G1, G2).
2. **(S1) Close the persistence holes:** add a 1 s max-wait flush, persist drafts, merge-on-write for multiple tabs, flush before close. Prove it with a real SIGKILL test on a persistent profile and `adb force-stop` on the S25 (G3, §5).
3. **(S1) Cut v1 to the core and build in milestones.** Defer headings, This Evening, Magic Plus, drag re-nest, Daily/Manual modes, tombstone GC, virtualization, and the advanced recurrence and grammar features. Split Core into Data and Interaction owners (§3).
4. **(S1) Make the font decision deliberately in M0:** measure a Latin-1 wght+wdth subset, use `font-display: optional` with SW precache, raise the lazy budget before giving up the width hierarchy, and fix the strike/condense geometry (X4, X5, X10, R1, R2).
5. **(S1) Fix the adopted artifacts that break the plan's own gates:** raise or restrict `--ink-3` (X1), generate CSP hashes for the inline boot with no `style=` attributes (X2), use one CSS file (X3), set the server RSS gate back to ≤ 30 MB (X6).
6. **(S2) Re-spec the X-days rule as two named knobs and confirm them with Remy.** Measure the oldest unpushed change. Restore the "poor under 3G" assertion. Choose vault registration and QR pairing, and strip the hash (G6, G7, G8, X7).
7. **(S2) Specify toolchain and deploy:** CI in GitHub Actions (no Node on the VM), a `publish-lists` release script, asset carry-forward, the SW update policy, removal of `/home/ubuntu/sites/lists/data` (R6, R7, X16).
8. **(S2) Replace the vague gates with the procedures in §5.** Name fixtures, N, statistics and tools. Automate the contrast, a11y and anti-slop checks.
9. **(S2) Make the signature seen and coherent:** a first-run Today that ends in "Today is clear", `#debug/cleared`, keyboard zoom instant and VT only for pointer and Back, stay-in-place completion (drop D's collapse), and themes as System/Paper/Graphite/Increased contrast (G4, G5, X9, R4).
10. **(S2) Write the missing specs:** smart-view inclusion and dedup rules for nested dated items, when vs deadline grammar, midnight rollover, ⇧↑/↓ multi-select, ⌘Z ownership in edit mode, Android edge-swipe rules, row heights ≥ 48 px on the phone, the 1200–1599 layout (G9–G12, R5, X11, X13).
