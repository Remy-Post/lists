# 04 — Visual & interaction craft audit (Red Team)

**Build audited:** `dist/` built 2026-11-05 15:40 from `5f8b42e` + working tree (`app-QNEVPQTQ.js`). The `src/` tree kept changing while I worked. I re-checked every S1 against `src/` at 16:05, and all four are still present.
**Devices:** Galaxy S25 Ultra emulation (412×891, DPR 3.5, touch, Chrome UA) and 16″ MBP (1728×1000, DPR 2). Light and dark schemes for each.
**Method:** I seeded a realistic fixture through `window.__lists`: 4 lists, nesting 6 levels deep, headings, notes, tags, priorities, recurring items, today/overdue/evening/upcoming/deadline dates, completed items today and on earlier days, and trash. Captures run on a second navigation so the `font-display: optional` fonts are cached. Mona Sans and Mona Display were confirmed loaded in every run. Contrast was computed per visible text run by compositing real computed colours on a canvas. Phone hit targets include the `.ck::before` extension. Checkbox-to-text alignment was measured against the glyph cap/x-height centre. Motion was sampled every rAF in the page (font-stretch, colour, box fill, strike dash offset, row geometry), and View Transitions were read through `document.getAnimations()`.

Scripts: `tests/visual/audit/{lib,shoot,motion,drag,sheet-probe,font-probe,font-ab}.mjs`. Screenshots and JSON: `tests/visual/out/audit/` (all paths below are relative to it). Raw numbers: `report-phone-light_dark.json`, `report-desk-light_dark.json`, `motion-desk-light.json`, `motion-phone-dark.json`.

> **Environment caveat (not a finding):** headless Linux Chromium renders *every* webfont with integer CSS-px advances: Mona `t` = 7 px against a design advance of 5.3 px at 15 px. This affects other variable fonts too (`font-ab.mjs`, `font-probe.png`). That is why words in the phone shots look gappy ("Kit chen", "f ig"). Treat the letter-spacing in these PNGs as an artefact, and check it on the real S25 before tuning tracking. Separately, the shipped `mona-text.woff2` has lost the source font's `HVAR`, `MVAR` and `gasp` tables. Re-subset with `--layout-features='*' --drop-tables-=HVAR,MVAR,gasp` (fontTools) so FreeType doesn't have to derive advances by loading glyphs.

---

## Verdict

The *ingredients* are right and largely on-brief:
- cool paper, not cream;
- Mona Sans with a 125-width display face;
- graphite text with blue marks and red corrections;
- no cards, glass, purple, emoji or sparkles;
- a lifted graphite dark theme;
- a genuinely nice seeded hand-drawn strike;
- Things-style day numerals in Upcoming;
- focus treatment exactly as specified (2 px bar plus a 10% wash, `desk-light-focus-hover-crop.png`).

It is **not yet Things 3 / Linear calibre.** Four things are broken:
- every phone sheet is off-screen;
- a literal `null` is rendered in the inspector;
- the one memorable moment is hidden below the fold on the target phone;
- the checkbox is misaligned on every row of the main screens.

Beyond those, the signature motions (zoom-as-a-sheet, the strike) don't land as designed. Several surfaces (swipe, drag, logbook, palette) are at "competent indie" level rather than "considered". Fix the S1s and the first eight S2s, and this moves from "good AI-assisted app" to "product".

---

## S1 — broken / ugly

### S1-1 Every layer is stuck in its *entry* transform; on the phone, all sheets are off-screen
**Shots:** `phone-light-inspector.png`, `phone-light-palette.png`, `phone-light-composer-empty.png`, `phone-light-settings.png`, `phone-light-cheat.png` (only a grey scrim; nothing to interact with). Compare `*-patched.png`, where the transform is forced to `none`. Desktop: `desk-light-palette.png` vs `desk-light-palette-patched.png` (the panel is 2% narrower and 4 px high). Probe: `sheet-probe.mjs` shows that after 1.2 s the palette panel is at `matrix(…, 628.6)`, top = 891 = viewport height.

**Cause:** these rules all have specificity (0,3,0):
- `.lyr.in .panel { transform: none }` (app.css ~l.274);
- `.lyr.modal .panel { transform: scale(.98) translateY(-4px) }`;
- `.lyr.pop .panel { transform: scale(.96) }`;
- `.lyr.sheet .panel { transform: translateY(100%) }`.

The last three come later in the file, so they win.

**Impact:**
- On the S25, the inspector, date picker (including the swipe-left schedule), palette, quick add (the ＋ button), Move…, settings and cheat sheet are all unusable.
- On the Mac, every modal rests at 98% scale and every popover at 96%. That means resampled, slightly soft text on a DPR-2 display, plus a 4 px offset.

**Fix:** put the open state after the entry states with higher specificity:
```css
.lyr.in .panel, .lyr.in.modal .panel, .lyr.in.pop .panel, .lyr.in.sheet .panel { opacity: 1; transform: none; }
```
Or write the entry states with `@starting-style` and leave the resting `transform` unset. Add an e2e assertion that `.lyr.in .panel` has a bounding rect inside the viewport.

### S1-2 A literal "null" is printed in the inspector
**Shot:** `phone-light-inspector-patched.png`: "null" sits under "Created Nov 5, 2026".

**Cause:** `fillInsp()` calls `el.replaceChildren(…, path.childElementCount ? path : null, …, insp.docked ? h('button'…) : null)`. `replaceChildren` stringifies `null`; unlike `h()`, it doesn't filter it. On the phone the docked-close slot is always `null`. On the desktop the same happens for top-level lists, which have no path.

**Fix:** `el.replaceChildren(...[ … ].filter(Boolean))`.

### S1-3 "Today is clear." is below the fold on the S25
**Shots:**
- `motion-phone-dark-clear-01.png` and `motion-phone-dark-clear-rest.png`: nine strikes and empty space, with the headline hidden behind the bottom bar;
- desktop `motion-desk-light-clear-00.png`: the headline is visible but sits under uneven "holes";
- compare the intended look in the shader harness, `../light-t0300.png`: evenly stacked strikes with the line directly under them.

**Cause:** in `body.cleared` the rows only set `opacity: 0`. Every `.pa` path line, `.mt` meta line, `.nt` note and the `.grp` "This evening" header keeps its height. The strikes end up irregularly spaced at about 70 px pitch on the phone, and `.empty.clear` lands at y≈930.

**Fix:**
```css
body.cleared .row .pa, body.cleared .row .mt, body.cleared .row .nt { display: none; }
body.cleared .row { min-height: 0; padding-block: 3px; }
body.cleared .grp { display: none; }
body.cleared .empty.clear { padding-top: 20px; }
```
The `display: none` collapse can be FLIP-animated with the existing `measure()`/`play()`. Also call `#empty.scrollIntoView({block:'nearest'})` on the phone.

### S1-4 The checkbox aligns with the path label, not with the task (smart views)
**Shots:** `phone-light-today.png` (rows 3–10), `desk-light-today.png`, `phone-light-upcoming.png`, `phone-light-logbook.png`.

**Measured:** checkbox centre minus title cap-centre is **−15 px** on every row that has a `.pa` line, and 0 px on rows without one (`report-phone-light_dark.json → align.today`). The box sits next to "Home renovation › Kitchen" while the title starts a line lower. This is the most-viewed screen, and it reads as a layout bug.

**Fix (preferred):** move the location into the meta line, after the date chips, as `.mt .chip.where`. That is shorter, calmer, and Things-like.
**Alternative:**
```css
.row.smart:has(.pa:not(:empty)) .ck,
.row.smart:has(.pa:not(:empty)) .tw { margin-top: 16px; }
```
16 px is the `.pa` line-height. Better still, give `.pa` its own grid row:
```css
.bd { display: contents; }
.pa { grid-column: 3; grid-row: 1; }
.tl, .nt, .mt { grid-column: 3; }
.ck { grid-row: 2; }
```

---

## S2 — clearly below the premium bar

### S2-1 Zooming into an item is a generic double-exposure crossfade, not "going one sheet deeper"
**Shot:** `motion-desk-light-zoom-00.png` (at 0.2× playback): old and new pages overlap at a 16 px offset, so both titles and both trees are ghosted on top of each other. `motion-desk-light.json → vtAnimations` shows only `::view-transition-old(ztitle)` fading out. No `ztitle` group or new element is captured, so the row title never morphs into the page title. The paper-stack edges and the parent "recede" never animate either.

**Fix:**
- Give the old root a plain fade with no translate: `vt-back: opacity 0, 120ms`.
- Give the new root a `clip-path: inset(var(--row-top) 0 auto 0 round 8px)` → `inset(0)` reveal from the clicked row's position, 280 ms on `--spring-lift`.
- Ensure exactly one element owns `view-transition-name: ztitle` in each state. The row `.tx` is old; the new one is `#ptitle`. Assert this in a test.
- Animate `.stack i` `translateY(4px)→0` by naming the stack: `view-transition-name: stack`.

### S2-2 The strike lands about 0.5 s after the click, and flickers on the keyboard path
**Data:** `motion-desk-light.json → completeTimeline`:
- 0–190 ms: font-stretch 100→88 and colour ink→ink-2 (the condense comes *first*);
- 200 ms: the strike starts;
- about 490 ms: the dash offset reaches 0.

So the user's mark finishes 490 ms after their action, over the 300 ms ceiling in §1.1, and in the wrong order. The pencil should lead and the type settle under it.

`keyTimeline` (press `x`):
- a **fully drawn static strike appears at 35 ms**;
- it is erased and redrawn from zero at 203 ms;
- it takes the same 270 ms instead of the specified 90 ms.

**Cause:** a second `queueStrikes()` from the scheduled render sees `_strikeQ === null` with no `svg.strike` and draws a static one. `flushStrikes` always passes `'full'`.

**Fix:**
- Measure the condensed width synchronously instead of waiting: apply `.done`, read the rect, then FLIP the text width.
- Draw the strike immediately, starting at t≈0, and let the condense run underneath it.
- Mark the row `el._strikePending = true` until the animated draw happens, so `flushStrikes` skips it.
- Pass `'fast'` when the trigger was a keyboard event.

### S2-3 The paper stack reads as stray rules crammed at the top edge
**Shots:**
- `desk-light-deep-soft.png` (crop: six tapered hairlines between y=10 and 30 CSS px, 30 px above the breadcrumbs, glued to the window edge);
- `phone-light-deep-soft.png` (the top line touches the "‹ Hinges" crumb);
- `phone-light-list-home.png` and `desk-light-empty-list.png` (a single rule at depth 1 looks like a header divider).

PLAN §3 specifies left-margin sheet edges. The horizontal pyramid of 4 px-spaced lines reads as a rendering artefact.

**Fix:** move `.stack` to the left margin:
```css
.stack { left: calc(-1 * var(--tw-w) - 4px); top: 0; bottom: 0; width: 0; }
.stack i:nth-last-child(n) { left: calc(-4px * (n - 1)); top: calc(4px * (n - 1)); bottom: 0; border-top: 0; border-left: 1px solid var(--rule-2); }
```
Or keep it horizontal but anchor it to the top of `.page-head` with ≥12 px clearance from `.crumbs` (desk `top: 40px`, phone `top: calc(safe + 48px)`), use 3 px steps, and cap at 4 visible lines.

### S2-4 Glyph fallback in chrome text
Missing from the shipped `mona-text` subset:
- `‹ ›` (U+2039/203A): the separator in **every** smart-view path, and the phone crumb;
- `← ↑ ↓ ↵ ⇧ ⌫` in every keycap;
- the full-width `＋` in "Tap ＋ to add one".

These render in Roboto/Arial: `desk-light-palette-patched.png` has mismatched `←`/`→` widths, and `phone-light-empty-list.png` has a mis-spaced "+".

**Fix:** add U+2039–203A and U+2190–2193 to the pyftsubset unicodes *and* to both `@font-face unicode-range`s (Mona has these glyphs). Replace `↵ ⇧ ⌫ ＋` with words ("Return", "Shift") or inline SVG keycaps, and replace `＋` with `+`.

### S2-5 Contrast failures (WCAG 2, text)
From `report-*.json`:

| Element | Ratio | Shots / themes | Fix |
|---|---|---|---|
| White on `--blue` (`.btn.primary` "Turn on backup", selected `.dp-grid .day.on/.today`) | **3.87:1** | `desk-light-settings-patched.png`, `phone-light-datepicker-patched.png` | Use `background: var(--blue-text)` for text-bearing fills; keep `--blue` for strokes and checkbox fill |
| Dark-theme toast "Undo" (`.tbtn` on the light toast) | **2.99:1** | `desk-dark-toast.png` | `color: color-mix(in oklch, var(--blue-text) 55%, var(--paper))`, i.e. derive from the dark *on-light* blue: `oklch(0.50 0.115 245)` |
| `.pnotes:empty::before` "Notes", `.chip.tag::before` "@", `.crumb::after` "/", `.i-path a::after` | 3.5:1 light, 3.7:1 dark | `phone-light-list-home.png` | `--ink-3` is commented "never text". Use `--ink-2` for the placeholder (or hide it, see S3-1); separators can stay as decoration but go to `--ink-2` at 13 px |

### S2-6 Phone hit targets under 48 px (PLAN §4)
From `report-phone-light_dark.json → targets`:

| Target | Size |
|---|---|
| `.tw` (collapse twisty, visible at 0.75 opacity) | **16×24** |
| `.crumb` | 26 px tall |
| `.dp-head .nav` | 28×28 |
| `.ct` count / open | 36×32 |
| `.seg button` | 34 |
| `.chipbtn` | 36 |
| `.icon-btn.sm` (New list) | 36 |
| `.btn` | 40 |
| `.acc button` | 46×42 |
| `.ck` incl. `::before` | 46×50 |
| `.add` | 56×46 |
| `.menu` / `.more` | 44 |

**Fix (phone.css):**
```css
.tw::before { content: ""; position: absolute; inset: -12px -8px -12px -16px; }
.crumb { padding: 12px 4px; margin: -12px 0; }
.dp-head .nav, .icon-btn, .icon-btn.sm { width: 48px; height: 48px; }
.ct { min-width: 48px; height: 48px; }
.seg button, .chipbtn, .btn { min-height: 44px; }
.acc button { width: 48px; height: 48px; }
.ck::before { inset: -13px -12px -13px -14px; }
.add { height: 48px; }
```

### S2-7 The swipe reveals a contentless gradient
**Shots:** `phone-light-swipe-right.png` (armed: a blue-to-transparent wash), `phone-light-swipe-left.png` (a grey wash). There is no check or calendar glyph, no label, and no change when crossing the threshold apart from opacity. Gradient washes are also on the slop list (§2.1, SaaS kit).

**Fix:**
- `.row.sw-r` gets a solid `--wash` track with a 20 px check glyph pinned at `left: 16px`. It scales 0.8→1 on `.armed`, and the track goes to `var(--blue)` with the glyph in `var(--on-blue)`.
- `.row.sw-l` gets a calendar glyph at `right: 16px` on a `--press` track.
- Drop the `linear-gradient`s.

### S2-8 The drag ghost hides what you're aiming at
**Shots:** `desk-light-drag-nest.png` and `desk-light-drag-sidebar.png`. The ghost is a full-width (≈720 px) white card. It sits on top of the drop line, and over the sidebar it covers the names of the lists you are dropping onto. Rows underneath still show `:hover` (the grey slab left of the ghost).

Also, `.tx` is `flex: 1` and spans the whole row (`drag.mjs`: tx right 1346 px vs row right 1352 px). On desktop a drag can therefore only start from the 6 px right padding, the meta line or the gutter. There is no handle and no cursor hint.

**Fix:**
```css
.drag-ghost { width: auto !important; max-width: 320px; padding-right: 12px; }
.drag-ghost .mt, .drag-ghost .nt, .drag-ghost .pa { display: none; }
body.dragging .row:hover { background-color: transparent; }
```
- Offset the ghost +12 px/+8 px from the cursor rather than keeping the grab offset.
- Make `.tx` `flex: 0 1 auto` so empty row space is grabbable.
- Show `cursor: grab` on `.row` outside the text.

### S2-9 Logbook is a wall of blue (and reads cyan in dark)
**Shots:** `phone-light-logbook.png`, `phone-dark-logbook.png`, `desk-dark-logbook.png`. Every row has a filled blue box *and* a blue strike. §7.7 warned about the pale-blue-on-dark "cyan" drift; this is where it shows. Things uses grey checks in its Logbook for the same reason.

**Fix:**
```css
body[data-view="logbook"] .row.done .ck .box { fill: var(--ink-3); stroke: var(--ink-3); }
body[data-view="logbook"] svg.strike path { opacity: .55; }
```
Show the completion time as right-aligned `.ct`-style metadata.

### S2-10 The dark-mode ＋ is the brightest object on the screen
**Shots:** `phone-dark-today.png`, `motion-phone-dark-clear-rest.png`. `.add { background: var(--ink) }` becomes an oklch 0.94 near-white slab with a shadow in Graphite, which pulls the eye harder than the content.

**Fix:** in dark, use `.add { background: var(--raised); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule-2); }`. Or make it blue: the ＋ *is* "your mark".

### S2-11 Upcoming date labels: "Nov Sun", plus a redundant date on every row
**Shot:** `desk-light-upcoming.png`: "15 Nov Sun".

**Cause:** in `dayLabel()`, `toLocaleDateString(undefined,{weekday:'short',month:'short'})` orders the parts as month then weekday. Each item's meta line also repeats its group's day ("Sat" under "7 Sat", "Wed" under "11 Wed").

**Fix:** use `{ weekday: 'short' }` plus a month marker only when the month changes. In `fillRow`, skip the `chip when` when `st.route.view === 'upcoming'` and `w === group date`.

### S2-12 The phone quick-add can't show what you type, and has no button
**Shot:** `phone-light-composer.png`: "ıll Ana about the deposit…". The single-line `input` with `white-space: pre` scrolls horizontally and the beginning of the title is lost. There is no visible Add control on touch, and the `enterkeyhint` is "enter".

**Fix:**
- Make it an auto-growing `textarea` with the mirror set to `white-space: pre-wrap`.
- Add a 48 px blue "Add" button in `.qa-foot` on `(pointer: coarse)`.
- Set `enterkeyhint="send"` (or "done").

### S2-13 The inspector's empty states are inconsistent
**Shots:** `desk-light-inspector.png` crop and `phone-light-inspector-patched.png`.
- "Not scheduled" (an empty value) is in `--ink`, while the empty Repeat shows the placeholder "every monday, every! 2 weeks…" in `--ink-2`. It reads like a value, and exposes grammar ("every!") to people.
- The empty Notes block reserves 63 px.
- The action buttons wrap and leave "Delete" orphaned.
- The path separator is "/" while rows use "›".

**Fix:**
- `.i-field .v:empty-state` → `color: var(--ink-2)`, with copy "None" / "Add…".
- Repeat placeholder: "Never".
- `.i-notes { min-height: 21px }`.
- `.i-acts { display: grid; grid-template-columns: repeat(3, 1fr) }`, with Delete as a text button in the row with the meta.
- Unify the separator on "›".

### S2-14 The phone header scrolls away; the accessory arrows are ambiguous
- `.page-head` is not sticky, so on a long list the drawer and "⋯" disappear. The bottom bar has no Lists entry.
  **Fix:** `.page-head > .menu, .more, .crumbs` in a `position: sticky; top: 0` bar with `background: var(--paper)` and a hairline after scroll. Or add "Lists" to `.bar`.
- `phone-light-accessory.png`: outdent/indent are `←`/`→` arrows drawn identically to move `↑`/`↓`.
  **Fix:** use indent glyphs (lines with a chevron: ⇤/⇥-style SVG). Also show which row is being edited: phone.css hides `.row.cur::after`, so restore a 2 px bar while `st.mode === 'edit'`.

### S2-15 The palette's empty state isn't curated
**Shot:** `desk-light-palette-patched.png`. Before any typing, it lists "Next item ↓, Previous item ↑, Expand, Collapse…". These are the lowest-value commands.

**Fix:** with an empty query, show "Go to" (Inbox, Today, Upcoming and each list), then recent items, then about 5 verbs relevant to the selection (Complete, When…, Move…).

### S2-16 The wordmark glyph reads as a hamburger menu
**Shots:** `desk-light-today.png` sidebar head and `phone-light-drawer.png`. The mark is three horizontal lines with a faint blue stroke at 22 px. It looks like a menu button, and on the phone the actual menu button uses nearly the same glyph.

**Fix:** make the blue strike the dominant element (a 2 px stroke across two shorter grey lines, rotated −3°), or use a single struck word mark. Keep the hamburger glyph for the menu only.

---

## S3 — polish

1. **The "Notes" placeholder is always visible** on every list page (`phone-light-list-home.png`). Show it only on `.page-head:focus-within` or hover: `.pnotes:empty:not(:focus)::before { content: none }`, plus add notes from the ⋯ menu.
2. **Width as hierarchy is under-used.** Metadata and path are at wdth 100; the spec asks for 92. Add `.mt, .pa, .psub, .grp .gl, .side-sec { font-stretch: 92%; }`. `.ptitle` is 30–32/36–38, against 28/32 in the spec. Desktop `--row-h` is 34, against 36 in the spec.
3. **4 px grid drift:**
   - `.side` padding 14/10;
   - `.page-head` padding-bottom 18;
   - `.grp` padding-top 22;
   - `.sheet` padding 52/40;
   - `.row` vertical padding 6 (desk);
   - `.li::before` left 15;
   - `.nv` padding-left 9;
   - `--fs-meta: 12.5px`;
   - `.i-field` grid column 92.

   Snap to 4 multiples (12/16/20/24/48…) and use 12 or 13 px meta.
4. **`A · B · C` interpunct strings** (a template-chrome tell, §2.1): settings footer "Lists 20261105.e8fea20 · 62 records · open source", inspector `.i-meta`, composer hint "↵ add · Esc close", and composer preview. Use separate spans with gap spacing, or plain sentences.
5. **Blue on non-marks:** "Due today" (`.chip.dl.due`), priority `!!!` (`.row[data-pri] .tl::before`), the sync idle dot, and the "This evening" moon are all blue. §7.1: "Nothing else gets colour." Use `--ink` at weight 600 for due-today and priority, and a graphite moon.
6. **The palette strikes done items with CSS `line-through`** (`phone-light-palette-search.png`). Reuse the hand strike, or simply use `--ink-2` with no line.
7. **Done rows never collapse into a "Done" group** after the 1.2 s grace (§7.5). They stay inline forever in lists (`phone-light-list-home.png`). Decide deliberately; if keeping them inline, at least sink them below open siblings.
8. **The cleared count doesn't match what's shown:** "13 done" under 9 strikes (`motion-desk-light-clear-rest.png`), because `qDoneToday` counts items completed elsewhere. Count the struck Today rows.
9. **`#/debug/clear` does nothing.** The next `schedule()` → `checkCleared()` un-forces the class (`phone-dark-debug-clear.png`). Keep a `forced` flag until navigation.
10. **The cheat sheet grid leaves holes** (`desk-light-cheat-patched.png`). Use `.cheat .cols { display: block; columns: 3 260px; } .cheat .grp { break-inside: avoid; }`. Hide it on touch (`phone-light-cheat-patched.png` lists keyboard shortcuts on a phone).
11. **Crumbs sit 2 px right of the title edge** (`.crumb { padding: 1px 2px }`). Use `margin-left: -2px` on the first crumb.
12. **Quick add and modals centre on the viewport, not the content column**, at 1728 (`desk-light-composer.png`). Use `.lyr.modal .panel { left: calc(var(--side-w) + (100vw - var(--side-w)) / 2) }` on desk.
13. **The toast draws over open sheets** on the phone (`phone-light-inspector-patched.png`). Raise `.toast` bottom above `.lyr.sheet .panel` or hide it while a sheet is open.
14. **The date suggestion is duplicated:** "Nov 13 ……… Nov 13" (`phone-light-datepicker-typed.png`). Label it "Next Friday", with the date on the right.
15. **Trash has no visible "Empty trash" or restore affordance**; only dashed boxes (`phone-light-trash.png`). Add a header action and a subtitle such as "Items here are deleted after 30 days" (if true).
16. **A recurring icon alone occupies a meta line** ("Water the fig", `phone-light-today.png`). Set the `.chip.rep` icon inline after the title (`.tl` slot) when it is the only meta.
17. **View-switch transitions fade and slide up 4–10 px on every navigation** (`vt-in`, `vt-rise`, `body.cleared .empty.clear { animation: rise }`). This is the mildest form of the "fade-up everywhere" motion tell. For list switches, prefer an opacity-only 120 ms crossfade, and keep spatial motion for the zoom.
18. **The sync "syncing" underline loops forever** (`@keyframes pencil … infinite`). Per §7.5 it should grow once while a write is actually in flight for more than 300 ms, not shimmer.

---

## Anti-slop checklist (D §2.2)

| Item | Result |
|---|---|
| No purple | ✅ |
| No Inter or Geist | ✅ Mona Sans |
| No glass (`backdrop-filter`) | ✅ none |
| No emoji in chrome | ✅ |
| No ✨ | ✅ |
| No eyebrow labels | ✅ sentence-case labels |
| No gradient text | ✅ |
| No glows | ✅ |
| No card grid | ✅ |
| No fade-up-on-scroll | ⚠️ none on scroll, but every view switch fades up (S3-17) |
| No shimmer except real in-flight sync | ⚠️ looping sync underline (S3-18) |
| No cream + serif + terracotta | ✅ |
| Other tells found | Gradient washes on swipe (S2-7); `A · B · C` meta strings (S3-4); a lone `→` prefix in the composer target |
