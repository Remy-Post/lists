# Lists — Master Plan

Sources: `docs/research/01-competitors.md` (C), `02-platform.md` (P), `03-design-craft.md` (D), `04-architecture.md` (A).
Each decision cites the section it rests on. Anything not cited is our own call and is marked *(ours)*.

---

## 1. Product thesis

> Every to-do app limits depth, or limits calm. Lists does neither.

- **Unlimited depth with equal powers.** Google Tasks flattened subtasks, MS To Do allows one level of Steps, Todoist stops at 4 levels and TickTick at 5, and Things has no sub-projects (C §4). In Lists a list *is* an item with children, and every node at every depth can have dates, notes, repeats and children (C steal 1, avoid "second-class sub-items").
- **Calm like Things.** No red guilt for overdue items, plus a one-step rescue (C steal 7, C §5).
- **Fast like Linear.** Reads come from a local replica, sync runs second, and the critical path has a budget (C steal 23, P decisions 12).
- **Trustworthy.** Undo that survives sync, a Trash, plain-text export, and end-to-end-encrypted backup (C avoid list; A §4–5).

## 2. Feature scope

### v1 (must ship)
| # | Feature | Source |
|---|---|---|
| F1 | Unlimited lists and unlimited nesting; Tab / ⇧Tab indent and outdent; collapse and expand | C steal 1, 10 |
| F2 | **Zoom into any item**: it becomes the page, with breadcrumbs. The zoom is a URL hash route, so Back zooms out | C steal 1 |
| F3 | Outliner keys: Enter adds a sibling, ⇧Enter edits the note, Backspace on an empty row merges or deletes, ⌥⇧↑↓ moves | C steal 10, C §6 |
| F4 | Navigation mode: single-key actions (`x`/`e` complete, `t` date, `v` move, `/` search, `?` cheat sheet, `g t`/`g u`/`g i` go to) | C steal 12, §6 |
| F5 | ⌘K command palette that also jumps to any node and shows each command's shortcut | C steal 11, 22 |
| F6 | Quick add with inline grammar: natural-language dates (`tom`, `fri`, `next week`, `in 3 days`, `aug 1`, `eow`), `!`/`!!` priority, `#list` target, `every …` recurrence. Parsed tokens are highlighted live; clicking one turns it back into literal text | C steal 2, 3, 18 |
| F7 | Separate **when** (start/do date) and **deadline**; Today includes deadline-today items | C steal 4 |
| F8 | Smart views: **Inbox**, **Today** (with a *This Evening* section), **Upcoming** (7 days, then weeks, then months), **Logbook** (completed), **Trash** | C steal 5, 6, 16, 21 |
| F9 | Nested items in smart views show their breadcrumb path, with children collapsed behind a count | C steal 21 |
| F10 | Calm overdue display plus "Rescue overdue → Today" | C steal 7 |
| F11 | Unlimited, global, context-restoring undo/redo (⌘Z / ⇧⌘Z), plus an Undo toast after destructive actions | C steal 15, A §5 |
| F12 | Completed items stay in place until cleanup (*Daily* / *Manual* logging); a show/hide-completed toggle | C steal 16 |
| F13 | Paste multi-line text to get many items, with indentation preserved as nesting | C steal 9 |
| F14 | Recurrence: "on schedule" vs "after completion"; a child checklist resets on each recurrence | C steal 18 |
| F15 | Keyboard date nudges: `]` / `[` = ±1 day, `}` / `{` = ±1 week | C steal 14 |
| F16 | Headings: non-checkable nodes that group siblings | C steal 19 |
| F17 | Export / import as indented Markdown and JSON | C steal 24 |
| F18 | Local-first persistence; offline PWA; installable | P B, A §6 |
| F19 | Opportunistic E2E-encrypted sync (stale + good link, or manual) | A §3–4, P C |
| F20 | Light and Dark themes (system default), P3 colour on the XDR display | D §4, 7.3 |
| F21 | Touch: swipe right to complete, swipe left to schedule, long-press drag to reorder or re-nest, a drag-to-place ＋ button | C steal 8, D §1 |

### Later (not v1)
Mirrors (C 20), custom saved queries (C 21), remappable shortcuts UI (C 13; the keymap is data from day one so this is cheap), shared lists (C §5.5).

## 3. Design direction: "Blue Pencil" (D §7)

- **Palette:** graphite neutrals; **blue pencil** for your marks (done, focus, selection); **red pencil** only for corrections (overdue deadline, destructive actions). Nothing else is coloured. The OKLCH tokens in D §7.3 are adopted verbatim, with P3 overrides.
- **Type:** Mona Sans (variable: wght and wdth); **width is the hierarchy**. Self-hosted latin woff2, `font-display: swap` with metric-matched `system-ui` fallback; skipped on Save-Data (D §3).
- **Shape:** no cards in the working list. Rows, hairlines and spacing only. Radius encodes containment (D §7.4).
- **Motion signature: the strike.** A hand-drawn SVG strike, seeded by the task id, draws through completed titles, and the title condenses from wdth 100 to 88 (D §7.5).
- **Depth signature: the paper stack** *(ours, extends D)*. Zooming into an item is going one sheet deeper:
  - the parent sheet recedes (CSS `perspective` / `translateZ` and dims 6%), and the child sheet rises from the row's own position (View Transition);
  - the left margin shows one hairline sheet-edge per level of depth, up to 6, then a numeral;
  - this makes "n levels" something you can *feel* without becoming visual noise.
- **The one memorable moment: "Today, struck through"** (D §7.6). The strikes remain after the rows fade, and a raw WebGL2 raking-light shader with procedural paper relief sweeps once across. It is gated to skip on reduced motion, Save-Data, low battery and no WebGL2 (D §5.4).
- **The anti-slop checklist (D §2.2) is a release gate:** no purple, no Inter or Geist, no glass, no emoji in the chrome, no sparkles, no eyebrow labels, no gradient text, no glows, no card grids, no fade-up-on-scroll, no shimmer.

## 4. Viewports

Tuned for two targets, but never hard-coded to them (P decisions 2–4):

| Target | Expected CSS viewport | Layout |
|---|---|---|
| **Galaxy S25 Ultra**, Chrome Android | ~412 × 891, DPR 2.625 or 3.5 | One column. Header with the list title and depth stack. **Bottom bar in the thumb zone**: views switcher and ＋. Sheets slide up for detail and quick add. 48 px targets, 16 px body text, swipe gestures. `interactive-widget=resizes-content` keeps the composer above the keyboard. |
| **MacBook Pro 16"** (M5 Pro/Max), Chrome | 1728 × ~1000 maximised, DPR 2, 120 Hz, P3 | Three panes: sidebar (views and the list tree) at 264 px, list at ≤ 720 px measure, inspector at 360 px shown on selection. 36 px rows, 15 px text. Hover affordances only under `(hover:hover) and (pointer:fine)`. |

- **CSS files:**
  - `app.css`: tokens, base and components, used everywhere.
  - `phone.css`: `media="(max-width: 599.98px)"`.
  - `desk.css`: `media="(min-width: 1200px)"`.

  Tablet and medium widths (600–1199) fall back to the base two-pane layout. All three files are requested in parallel from the HTML, so no `@import` chain.
- **Measure, then tune:** run the P §A.4 snippet on the real devices and record the results in §10 below.

## 5. Architecture (A, "Architecture we recommend")

```
src/
  index.html          shell + inline boot
  css/app.css phone.css desk.css
  js/
    main.js           boot, routing, wiring
    store.js          records, HLC, LWW merge, childrenByParent index, cycle repair, queries (views)
    db.js             ~40-line IndexedDB wrapper, batch writes, flush on hidden
    ops.js            commands (create/update/move/delete) + undo/redo stacks
    keys.js           keymap (data) + dispatcher, nav vs edit modes
    view.js           rendering: rows, virtualization, FLIP, view transitions
    parse.js          quick-add grammar + NL dates + RRULE subset (pure, unit-tested)
    sync.js           crypto (HKDF/AES-GCM), gate, POST /api/sync loop
    strike.js         seeded hand-drawn strike path generator
    gl.js             (lazy chunk) raking-light shader
  sw.js               service worker: precache shell, network-only /api
  manifest.webmanifest, icons/
server/
  sync_server.py      stdlib + sqlite3, POST /api/sync, /api/health
  Dockerfile          python:3.12-alpine, 64 MB limit
tests/
  unit/*.test.mjs     node --test (parse, store merge/cycles, fractional keys)
  e2e/*.mjs           Playwright: flows, 3G timings, device screenshots, persistence-across-kill
build.mjs             esbuild bundle (1 JS + lazy gl chunk), hash, precompress .br/.gz, emit dist/
```

- **Record:** `{id, f:{kind,pos,title,notes,done,doneAt,when,evening,deadline,rrule,repeatFrom,priority,heading,deleted}, v}`, with every field `[value, hlc]`; `pos = {parent,key,prev}`. *(ours: `when`/`deadline` split from A's single `due`; `evening`, `priority` and `heading` added.)*
- **Persistence:** IndexedDB stores `nodes`, `outbox`, `meta`. Each edit batch is committed within 300 ms with durability `strict`, and flushed on `visibilitychange:hidden`. Request `storage.persist()` (P decisions 7). No user data in localStorage.
- **Sync gate:**
  - stale = outbox older than 2 min, or the last pull older than 15 min;
  - good = `connection.type` wifi/ethernet, or `effectiveType` 4g with rtt ≤ 300 and no saveData; otherwise our own measured RTT ≤ 300 ms;
  - manual "Sync now" ignores staleness (P 9, A 3.2).

  On top of this, a **"backup age" rule** answers Remy's "hasn't been updated in X days": if the last successful push is older than 3 days (configurable), the gate relaxes "good" to "online and not 2g / Save-Data", and Settings shows the backup age.
- **Pairing:** the first device creates a 256-bit key, shown as a 52-char base32 string plus a QR-free "pairing link" (`#pair=…`). The second device opens the link, and the key never leaves the hash (A §4).
- **Server:** `lists-sync` container on `n8n_default`, SQLite WAL in a named volume, behind the existing Caddy at `lists.remypost.me/api/*`.
- **Build:** esbuild (dev-only dependency; the output is plain static files). Hashed filenames, `.br`/`.gz` precompressed, Caddy `file_server precompressed br gzip` (P decisions 12).

## 6. Budgets & gates (release-blocking)

| Metric | Budget | How measured |
|---|---|---|
| Critical path (HTML + CSS + main JS), compressed | ≤ 50 KB | build report |
| Font (lazy, non-blocking) | ≤ 45 KB | build report |
| GL chunk (lazy) | ≤ 6 KB | build report |
| First contentful paint, cold, DevTools "3G" (2000 ms RTT, 50 KB/s), CPU ×4 | ≤ 5.0 s | Playwright + CDP |
| Repeat visit (SW) to interactive, "3G" | ≤ 1.0 s | Playwright |
| Data survives tab close and browser kill | 100% of the last edit ≥ 300 ms old | e2e: edit, then kill the context hard, relaunch |
| Input latency (keypress to paint), 2,000-node tree | ≤ 16 ms p95 desktop | Performance API in e2e |
| Render 10,000 nodes with 500 expanded | no long task > 50 ms | e2e |
| Contrast | all text ≥ 4.5:1 | D §7.3 tokens |
| Accessibility | tree uses `role=tree`/`treeitem`, `aria-level/expanded/selected`; full keyboard; reduced motion honoured | axe-style manual audit |
| Anti-slop checklist | 0 violations | visual audit |
| Server memory | ≤ 64 MB hard, ~25 MB typical | docker stats |

## 7. Process & teams (see TEAMS.md)

1. **Plan audit:** an independent reviewer critiques this plan against GOALS and the research; I adjust.
2. **Build, in parallel, with explicit file ownership:**
   - Core: me. `index.html`, `css/*`, `js/main/store/db/ops/keys/view/strike.js`.
   - Parser: `js/parse.js` and its unit tests.
   - Sync: `server/*`, `js/sync.js`, Caddy block, unit tests.
   - Light: `js/gl.js` (lazy WebGL chunk).
   - QA rig: `tests/e2e/*`, the 3G harness and the screenshot matrix.
3. **Code audit:** a fresh reviewer, not anchored on the authors.
4. **Visual audit:** screenshots at 412×891 @3.5 and 1728×1000 @2, light and dark, checked against Blue Pencil and the anti-slop gate.
5. **Interactivity audit:** scripted keyboard and touch flows, the persistence kill test, and 3G.
6. **Iterate** until every gate in §6 passes, then deploy and verify on the real Mac Chrome and the S25 (via chrome://inspect).

## 8. Risks
| Risk | Mitigation |
|---|---|
| Animating `wdth` causes reflow jank on Android | `contain: layout` on the row; snap it instead of animating if profiling shows jank (D 7.7) |
| Concurrent-move cycles | Deterministic `effectiveParents()` repair, with simulation tests (A §2) |
| Safari's 7-day storage eviction on the Mac | The server backup plus a backup-age banner (P 7) |
| Mona Sans width axis costs 98 KB | Ship wght+wdth only if it stays ≤ 45 KB after subsetting; otherwise wght-only plus `font-stretch` fallback *(ours)* |
| Users lose the pairing key | Settings → "Show pairing key", plus export |
| Unlimited depth makes huge trees | Virtualized rows, no expand-all on double click (C avoid) |

## 9. Definition of done
Every v1 feature works on both devices; every §6 gate passes; the docs are current; the public repo is pushed; it is deployed at lists.remypost.me (or ready for DNS); and the audit reports are in `docs/audits/`.

## 10. Device measurements (fill in from the real devices)
| Device | innerWidth × innerHeight | DPR | screen | notes |
|---|---|---|---|---|
| S25 Ultra | _tbd_ | _tbd_ | _tbd_ | |
| MBP 16" | _tbd_ | _tbd_ | _tbd_ | |

---

## 11. Plan audit response (docs/audits/01-plan-audit.md)

| # | Audit finding | Decision |
|---|---|---|
| 1 | Android keyboards send `Unidentified` keydowns; there is no Tab | Enter/Backspace in rows are handled from `beforeinput` (`insertParagraph`, `deleteContentBackward`), not keydown. On the phone an **accessory bar** sits above the keyboard (outdent · indent · move up/down · date · done · hide keyboard). Verified on the real S25. |
| 2 | Persistence holes | The batch timer never resets, so the maximum wait is 250 ms. Quick-add drafts are saved to `meta`. **Cross-tab:** every local patch is broadcast on a `BroadcastChannel`, other tabs LWW-merge it, so whole-record writes cannot clobber. Kill test: SIGKILL of a persistent Chromium profile, and `adb`/swipe-away on the S25. |
| 3 | Scope | **Deferred to M2:** drag-to-place ＋, Manual logging mode (Daily only), JS virtualization (use `content-visibility:auto`), recurrence edge cases beyond the parser's subset. **Kept** (cheap, high value): headings, This Evening, drag reorder and re-nest on desktop, long-press drag on touch. Milestones: **M1** data, outline, keyboard, views, persistence → **M2** gestures, inspector, palette → **M3** sync, light, polish. |
| 4 | Font | Decided and measured: text VF (wdth 88–100, wght 400–650, Basic Latin) is **37.8 KB**; display instance (wdth 125, wght 640) is **11.6 KB**. Both use `font-display: optional` and are precached by the service worker, so every visit after the first is in Mona Sans with no layout shift. Width stays the hierarchy device. The strike is measured *after* the condense finishes, one stroke per wrapped line. |
| 5 | Tokens, CSP | `--ink-3` is decorative only and never used for text; placeholder text uses `--ink-2`. CSP is emitted by the build with a sha256 for the single inline theme script; dynamic styles go through CSSOM (`el.style.setProperty`), which CSP allows. **Separate viewport stylesheets stay** because Remy asked for them explicitly; non-matching `media` links download at low priority and never block render. The server gate is ≤ 30 MB RSS (64 MB is only the container ceiling). |
| 6 | Backup rule | Two settings: **"Sync when stale"** (default 15 min pull / 2 min push, good link only) and **"Back up at least every N days"** (default 3). The second is measured from the **oldest unsynced change**; when exceeded, "good link" relaxes to online && !saveData && not 2g. A vault is created on first sync, rate-limited per IP by the server. Pairing uses a code (typed) or a link whose hash is consumed and removed with `history.replaceState` at once. |
| 7 | Build/deploy | Node now lives in `~/.local/node` on the VM. `deploy/publish.sh` builds, copies the previous release's `/assets` into the new release (open tabs never 404), swaps `current`, and keeps 5 releases. SW update: the new worker waits, a quiet "Update ready — Reload" toast appears, and it applies on the next cold start. Removed `~/sites/lists/data`. |
| 8 | Gates | The QA team writes the exact procedures (fixtures, run counts, medians) in `tests/e2e/README.md`. |
| 9 | Signature moment | **First run seeds a short Today tutorial** (5 tasks that teach the keys) which ends in "Today is clear". Debug route `#/debug/clear`. Keyboard zoom is instant; View Transitions only for pointer and Back. Completed rows **stay in place**, struck (no collapse), until the next day. Themes: System / Paper / Graphite; contrast follows `prefers-contrast`. |
| 10 | Specs | **Today:** parent and child can both appear; children show their path. **Midnight rollover:** re-render on visibility change and on a timer at the next midnight. **⌘Z while typing** is the app's undo (coalesced title edits). **Swipe:** ignored when it starts within 24 px of a screen edge (Android back gesture). Phone rows are ≥ 48 px. **Desktop:** the inspector docks at ≥ 1440 px wide and overlays below that. |
