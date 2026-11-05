# 02: Code audit (Red Team)

**Subject:** client code in `src/js/` (store, db, ops, actions, state, view, input, keys, ui, gesture, main, strike), `src/sw.js`, `build.mjs`. I reviewed parse.js, sync.js and gl.js only where callers use them.
**Date:** 2026-11-05 · **Auditor:** Red Team (independent; I did not write this code).
**Severity key:** **S1** = data loss or security. **S2** = broken feature, or a release-blocking gate missed. **S3** = polish or performance.

**Method.** I read every file in scope. I checked each finding below either with a throwaway Node harness that drives `store.js`, `ops.js` and `actions.js` directly (stubbing `matchMedia`, `navigator` and `document`), or in headless Chromium (Playwright) against a production build served by `tests/harness/serve.mjs` with the real CSP. Scripts are in the session scratchpad (`t1–t6.mjs`, `b1–b2.mjs`). Line numbers refer to the files as they are now.

---

## 0. Verdict

The core is careful in places that usually go wrong:
- The outbox ack compares the in-memory `v`, so it is safe against edits made while a sync is in flight.
- A failed IndexedDB batch is put back in the queue.
- Undo skips fields that changed since the step.
- No user string reaches `innerHTML` unescaped.
- Nothing in the code breaks the CSP.

The real risks are elsewhere:
1. **Sync's "only the outbox is pushed" contract is not honoured when backup is turned on again.**
2. **`'void'` tombstones swallow concurrent children.**
3. **Tabs do not tell each other about remote merges.**
4. **Several tree commands act on siblings that are hidden from view.**
5. **Two keyboard paths turn typing into commands.**

---

## 1. Findings, ranked

### S1-1: Turning backup off and on again (or creating a new vault) uploads only the outbox, so the backup is silently incomplete
- **Where:** `main.js:115` (`ui.createVault`), `ui.js:394–398` (Turn off / Turn on backup), `sync.js:222` (new vault, `cursor: 0`); contract in `server/README.md:140`.
- **Scenario:** A device is paired, so its outbox has been acked and is empty. The user taps **Turn off**, then later **Turn on backup**. `createVault()` makes a new key and `syncNow()` pushes `getOutbox()`, which holds only the records edited since the last ack.
  - The new vault holds a handful of records.
  - The status reads "Backed up".
  - A device paired to it later gets an almost empty account.
  - The same happens for any record this device only ever received through `applyRemote`, since those never enter the outbox.
- **Fix:** Before `createVault()` and `join()`, enqueue every record. For example, add `DB.requeueAll()`, which writes every id in `S.recs` to `outbox` in one transaction. Call it from `ui.createVault` and `ui.join`, and after `unpair()`.

### S1-2: Children of a `'void'` parent become unreachable (not in the list, Trash or search)
- **Where:** `store.js:177–181` (`rawParent` keeps a deleted parent), `store.js:232–236` (`isLive`), `store.js:344–348` (`qTrash` needs no deleted ancestor). Producers of `'void'`:
  - `input.js:123` (Backspace on an empty row),
  - `input.js:130` (join),
  - `input.js:250` (paste into an empty row),
  - `ops.js:56` (undo of any create).
- **Scenario:** On the laptop, the user makes an empty row and deletes it with Backspace (`void`), or undoes a "New item". Meanwhile the phone, offline, has added a child under that row. After sync the child is live, but its parent is void. It is hidden from the outline, Today, search and Trash, and nothing can bring it back.
- **Evidence:** Harness `t4.mjs` case 6: `isLive=false inTrash=false search hit=false`.
- **Fix:** In `rawParent`, treat a parent whose `deleted === 'void'` as missing, so orphans fall back to Inbox. Or have `rebuild` move live children of void nodes to Inbox. `'trash'` parents can stay as they are.

### S1-3: A stale tab's whole-record write overwrites merged remote fields in IndexedDB, and they are never pulled again
- **Where:** `main.js:20–26` broadcasts only local edits (`local && bc`), so remote merges are never broadcast. `db.js:49–53` and `db.js:72` `put` the whole record object.
- **Scenario:**
  1. Tab A pulls a remote change to `x.notes`, persists it and saves the sync cursor past it, then closes.
  2. Tab B was open before the pull, so its in-memory `x` is stale. B never hears of the merge.
  3. The user edits `x.title` in B. `patch` writes B's whole stale record over A's in IndexedDB.
  4. On the next boot, IndexedDB has the old notes and the cursor is already past the remote row, so it is never re-pulled.
  5. The next push of `x` carries `since` past that row, so the server compacts it away (README §Push: "deletes older versions … with seq ≤ since"). New devices lose the note too.
- **Fix:**
  - Broadcast remote merges as well. Receivers merge them LWW without re-broadcasting, so there is no loop.
  - Or make `flush()` read, merge per field and write inside its readwrite transaction instead of a blind `put`.
  - Also broadcast meta writes so tabs don't keep stale sync cursors (see S3-6).

### S1-4: Backspace-join and Backspace-delete discard notes, dates, repeat and tags, with no Trash entry
- **Where:** `input.js:121–133`.
- **Scenario:**
  - **Join:** Backspace at the start of an item merges its title into the row above, then sets the item to `deleted: 'void'`. Its notes, `when`, `deadline`, `rrule`, `tags` and `priority` are gone.
  - **Delete:** clearing a title and pressing Backspace once more hard-deletes an item that may carry long notes.
  - `'void'` never shows in Trash. Undo is the only way back, and the undo stack is lost on reload. The rule "Delete goes to Trash" is broken by a keystroke that does not look like a delete.
- **Fix:**
  - Join only when the removed item has no notes, dates, repeat or tags. Otherwise refuse, or move them onto the surviving item.
  - Use `'trash'` whenever the item has any content besides its title. Keep `'void'` for rows created and abandoned in this session (`st.fresh`).

### S1-5: If storage is unavailable, the app runs in memory without telling the user
- **Where:** `main.js:278–280` adds `body.nodb`, but no CSS or JS reacts to it (`grep nodb` finds only that line). `db.js:83` retries every second and sets only `lastError`.
- **Scenario:** IndexedDB fails to open or keeps failing, for example storage blocked by policy, quota exceeded, or Safari's "connection lost". The user keeps working and the footer still says "On this device" or "Backed up". Everything is lost when the tab closes.
- **Fix:** Show a persistent banner when `nodb` is set, or when `lastError` is set and `pendingCount()` stays above zero for more than a few seconds. Offer Export. Don't run the tour in that state.

### S2-1: `rekey()` scrambles sibling order and returns a key outside the gap
- **Where:** `store.js:276–283`, called from `posBetween` at `store.js:267`.
- **Cause:** `rekey` iterates `childrenAll(parent)`, which is the live sorted array, while `patch` → `reparent` splices each child out and re-inserts it by its new key. Elements are skipped or visited twice.
- **When it triggers:** Equal keys are common. Two devices that append to the same list offline both compute `keyBetween(last, null)`. Inserts at the top produce `Zz, Zy, …`, which are smaller than the new `a0…` keys, and that makes the scramble worst.
- **Evidence:**
  - `t1.mjs`: siblings `a,c,b,d` (keys `Zw,Zx,Zx,Zy`) become `c,d,b,a`. The key returned for "between b and c" is `a1V`, which is not between them.
  - `t2.mjs` (typical concurrent append): one insert between the duplicates moves an unrelated item three places down and leaves duplicate keys behind.
- **Impact:** The reordered positions are real patches, so they sync to every device.
- **Fix:** Snapshot the order first (`const ids = [...childrenAll(parent)]`), then assign keys in that order. Better, avoid a full rekey: give the `after` sibling, and any run of equal keys after it, new keys between `a` and the next distinct key. `rekey` also bypasses `O.set`, so a later undo of the move restores a key from the old key space.

### S2-2: ArrowUp/ArrowDown while typing drops out of edit mode, so the next letter runs a command
- **Where:** `input.js:135–152`. `vertical()` focuses the neighbour's text and places the caret, then calls `focusRow(target, { edit: false })`. That runs `el.focus()` on the row (`input.js:64`) and takes focus away from the text.
- **Evidence (Chromium):** After `End`, `ArrowDown`, `activeElement` is the `.row` (while `st.mode` says `'edit'`). Typing `x` marked the item complete instead of inserting "x". By the same path:
  - Backspace trashes the item,
  - `d` opens the deadline picker,
  - `s` sends it to Someday.
- **Fix:** Call `focusRow(target, { edit: true, caret: <computed> })`, or set `st.cursor`/`sel` directly without calling `el.focus()`.

### S2-3: The global key dispatcher ignores focus: Tab trap, and hijacked Enter, Space and Backspace on buttons
- **Where:** `keys.js:150–178`. The only filter is "typing". `indent` and `outdent` bind Tab and Shift+Tab (`keys.js:43–44`). `ui.escape` (`ui.js:520–524`) never clears a single selection.
- **Evidence (Chromium):**
  - With a row selected, three presses of Tab leave focus on the same row. That is a keyboard trap (WCAG 2.1.2), and each press also tries to indent.
  - With a row selected and focus on the Settings button, Enter opened the row for editing instead of Settings.
  - Space on a focused button opens the inspector.
  - Backspace or Delete trashes the selection.
- **Fix:**
  - Run nav commands only when `document.activeElement` is inside `#outline`, or is `body`.
  - Let Tab through when the indent can't happen.
  - Make Escape clear `st.sel` so focus can leave the tree.

### S2-4: Indent and move use real siblings, including hidden completed items and repeat logs, so rows vanish
- **Where:** `actions.js:131–135` (`indent` takes `S.children(p)`), `actions.js:164–167` (`moveBy`). The outline hides done-before-today items with their subtrees (`view.js:33`) and always hides `kind:'log'`.
- **Evidence (`t4.mjs`):**
  - Case 2: in a list `[old-done (hidden), visible]`, Tab on `visible` nests it under the hidden done item. The row disappears from the outline, and from Today, because the parent counts as done.
  - Case 3: completing a repeating item appends a `log` sibling. The next item typed after it, when indented, lands under the log (`parent kind = log`) and is never rendered again.
  - `moveBy` swaps with an invisible sibling, so the keypress looks like it did nothing.
- **Fix:** Compute the "previous sibling" from rendered rows (`st.rows` and `st.info`, same parent), or filter `children()` through the same visibility predicate as `outlineRows`. Never pick `kind:'log'` as a parent.

### S2-5: Move down at the end of a list in a smart view turns the item into a top-level list
- **Where:** `actions.js:169–175`. In Today, Upcoming and Someday `pageRoot()` is `null`, so the guard `p === root` never matches. An item that is the last child of a top-level list hops into `ROOT`.
- **Evidence (`t4.mjs` case 4):** Alt+Shift+↓ on "milk" in Today sets the parent of milk to `ROOT`, so it shows in the sidebar as a list.
- **Fix:** Mirror the `outdent` guard: in non-node views, never move to `gp === ROOT`. Better, disable structural moves in smart views, where the visual order isn't the tree order.

### S2-6: Dragging a multi-selection drops it at the wrong index
- **Where:** `gesture.js:139` computes the index with *all* dragged ids filtered out. `actions.js:189–192` (`moveTo` → `posAt(parent, i, skip=id)`) filters out only the current id.
- **Evidence (`t4.mjs` case 1):** Dragging `[a,b]` to after `c` in `a,b,c,d` gives `a,c,b,d` instead of `c,a,b,d`.
- **Fix:** Make `moveTo` take positions against `children(parent)` minus all moved ids (insert after the previous kept sibling). Or have `resolve()` return an anchor sibling id instead of an index.

### S2-7: Multi-line paste in Today or Someday puts the items in Inbox with no date, so they vanish
- **Where:** `input.js:244–255` calls `A.pasteOutline(text, p, i + 1)` without the view's `defaultTarget().fields`. The empty row being pasted into, which had `when: today`, is voided.
- **Evidence (Chromium):** Pasting `alpha\nbeta\ngamma` into a new Today row gave `parent: Inbox, when: null, visibleInToday: 0`, while the toast said "Pasted 3 items".
- **Fix:** In smart views, merge `defaultTarget().fields` into each top-level pasted item. At minimum, copy `when`, `evening` and `someday` from the row being replaced.

### S2-8: The first visit always reloads the page, which can abort pairing from a `#pair=` link
- **Where:** `sw.js:11` calls `skipWaiting()` on first install, and `clients.claim()` fires `controllerchange`. `main.js:266` reloads on any `controllerchange`, including this first one.
- **Evidence (Chromium):** 2 document loads within 5 s of a cold first visit.
- **Scenario:** A new phone opens the pairing link. `pairFromLink` scrubs the hash at once (`main.js:120`), then starts `join()`, which saves the key only after the first successful round trip. If the SW claim reload lands first, the device ends up unpaired and the link is gone, with no message.
- **Fix:**
  - Reload only if the page already had a controller at boot (`const hadCtl = !!navigator.serviceWorker.controller`).
  - Persist the pairing key, or keep the code in `sessionStorage`, until `join` resolves.

### S2-9: A device being paired runs the tour and pushes it into the existing account
- **Where:** `main.js:288–291`. `pairFromLink()` is async, and the tour (`tutorial()`) runs right after it in the same tick, because `first` is true on a fresh device. The tour items are in the outbox before `join()` pushes, so every device in the vault gets five "Click the box…" items in Inbox and Today.
- **Fix:** Skip the tour when `r.pair` is present. When joining from Settings on a device whose only data is the untouched tour, void those records before pushing.

### S2-10: After a server `reset`, records that were already acked are never pushed again
- **Where:** `sync.js:157` resets `cursor` and pulls again, but Core is never told. The README (`:140`) says "after a reset only dirty records are re-pushed", but main.js can't react.
- **Scenario:** The server is restored from an older backup. Records acked after that backup are missing from the server for good, and new devices never get them.
- **Fix:** This is a contract change across both teams. Add `db.requeueAll()` and have `sync.js` call it on `res.reset` (it is the same function as in S1-1). Also, `maybeSync('edit')` from the README trigger list is never wired (pushes wait for the 60 s timer).

### S2-11: Every keystroke re-renders the whole page and sidebar with repeated full-tree walks
- **Where:** `main.js:40` subscribes to the store. Each title keystroke then runs `renderPage`, `renderSide`, `ui.refreshInsp` and `checkCleared`, which do the following:
  - In Today, `qToday` runs four times (`groupsFor`, `renderEmpty`, `renderSide`, `checkCleared`) and `qDoneToday` twice.
  - `countOpen` walks the full subtree for each parent row (`view.js:153`) and each sidebar list (`view.js:353`).
  - Commands also render synchronously before the scheduled frame renders again (`keys.js:12/15`, `ui.js:132`), so every command renders twice.
  - In other tabs, every structural BroadcastChannel message runs a full `rebuild()` (`store.js:164`). A 1,000-line paste in one tab freezes the others.
- **Evidence:**
  - Node, 10k records: the store queries for one Today keystroke take about 33 ms.
  - Chromium, 6k records: input to next frame has a median of 49 ms and a maximum of 190 ms.
  - PLAN §6 gates (release-blocking): ≤ 16 ms p95 at 2k nodes, no long task > 50 ms at 10k.
- **Fix:**
  - When only `title` changed on the focused row, re-fill that row and skip the rest.
  - Compute one `qToday` result and one open-count map per render pass, bottom-up in O(n).
  - Drop the synchronous `renderPage()` calls in commands, or the rAF render.
  - Coalesce BroadcastChannel merges per microtask.

### S3 (polish, perf, robustness)
1. **"Sync now" always says "Synced".** `sync.syncNow()` catches every error and resolves `false` (`sync.js:218`), so the `catch` in `main.js:113` never runs. Offline and server errors both show "Synced". **Fix:** check the return value.
2. **Cycle repair sends a top-level list to Inbox.** `store.js:219` requires `recs.has(prev)`, and `ROOT` is not a record. In `t4.mjs` case 5, list Q ends up in Inbox. **Fix:** accept `prev === ROOT`.
3. **Strike redraws thrash layout.** The ResizeObserver on `<html>` (`view.js:181`) fires on every height change: adding a row, expanding, a toast. It forces every done row to redraw. `flushStrikes` interleaves `getBoundingClientRect` reads with SVG writes, row by row. **Fix:** react only to width changes, then do all reads before any writes.
4. **The raking light is never torn down when you leave Today in the app.** `main.js:151` destroys it only on `hashchange`, but `ui.go` uses `pushState`, which never fires `hashchange`. The canvas, its rAF loop and its window `pointermove` listener stay alive on every page, and a second one stacks the next day. **Fix:** destroy it in `show()` when the route leaves `today`.
5. **The SW cache name can repeat.** `build.mjs:52` builds `VERSION` from the date plus `HEAD`. Same-day redeploys with uncommitted changes, as in the current working tree, get the same `lists-<V>` cache:
   - the new SW's `addAll` overwrites `/` in the cache the active SW serves from, which bypasses the "update ready" flow;
   - `activate` purges nothing, so old assets pile up.

   Also, `sw.js:33` caches any 200 under `/assets/`, and Caddy's `try_files … /index.html` returns HTML with 200 for a missing asset. **Fix:** hash the precache list into `VERSION`, and check `content-type` before caching.
6. **Each tab reads sync meta from its own cache.** `DB.getMeta` reads the per-tab `metaCache` (`db.js:55`, `main.js:94`), which is never refreshed from other tabs. If you **Turn off** sync in one tab, another tab's next `save()` writes the key back. Stale cursors also cause re-pulls. **Fix:** broadcast meta writes, or read the `sync` key from IndexedDB.
7. **Import trusts arbitrary JSON.** `ui.js:474–478` merges any `records` array into the outbox:
   - a malformed `when` or `deadline` (`"2026-13-45"`) makes `formatDay` throw (`t5.mjs`), so every `renderPage` throws on every synced device;
   - far-future HLC stamps are accepted unclamped (`store.js:19–24`). The clock then stays pinned and the 4-char counter can eventually overflow its fixed width (`store.js:13`), which breaks string ordering.
   - Importing an older backup can't restore deleted items, because newer tombstones win. The UI says "Merged N records" and nothing else.

   **Fix:** validate field types and ranges on import, clamp `observe()` to now + 1 day, and offer "restore as copy".
8. **The Logbook checkbox reopens repeat-log rows.** Unchecking a `kind:'log'` row sets `done:false`. The row then leaves the Logbook and is hidden everywhere else (`view.js:33`, `store.js:302`). **Fix:** make log rows read-only.
9. **Nudge can schedule into the past.** `[` on an item scheduled for today moves it to yesterday (`actions.js:235–236`). **Fix:** clamp the result to `>= today()`.
10. **Accessibility.** Rows are all `tabindex=-1` and the tree itself isn't focusable, so Tab can't reach the outline (no roving tabindex). Dialogs set `aria-modal` but don't trap focus (`ui.js:21–39`). The tree roles, levels and states are otherwise correct.
11. **Deploy CSP in the repo.** `deploy/caddy.lists.conf` lists `script-src 'self'` without the theme script's hash, and `publish.sh` deletes `csp-script-hashes.txt`. If the block is pasted as-is, the theme script is blocked, which causes a flash of the wrong theme. This is harmless otherwise, because `ui.setTheme` runs at boot.

---

## 2. Checked and found sound

- **XSS.** Titles, notes, list names, crumbs, palette, toasts and the pairing code all go through `textContent` or `h()`. Tags and rrule descriptions go through `esc()`; the `title="…"` use escapes `"`. `formatDay` output is computed from the date, so it can't carry markup. Every `html:` value is a static SVG.
- **CSP.** There are no `style="…"` attributes, `setAttribute('style')`, `<style>` or inline handlers. Every style is set through CSSOM: `el.style.*`, `setProperty`, `cssText` in gl.js, and WAAPI. Playwright under the real CSP logged no `securitypolicyviolation` events.
- **Fractional keys.** `keyBetween` matches rocicorp's reference. A fuzz run (2,000 runs × 60 random inserts) found no ordering violations. The only problem is `rekey` (S2-1).
- **Outbox and persistence.**
  - `ackOutbox` deletes only entries whose in-memory `v` matches what was sent.
  - A failed flush puts the batch back in the queue without overwriting newer entries.
  - The flush chain is serialised.
- **Undo.** Fields edited since a step are skipped. A create is undone by `'void'`, and redo restores it correctly. Typing steps coalesce per row.
- **`combo()`.** The mappings are correct for `Mod+Shift+z`, `Mod+.` (by `code`), Option-letter (by `code`), `Shift+Tab`, `?` and `{`/`}`. The typing filter lets native editing chords through.
- **Pairing link.** The code is only ever in the fragment. It is replaced at once with `replaceState`, the policy is `Referrer-Policy: no-referrer`, and nothing is sent to the network. The real exposure is the race in S2-8.
