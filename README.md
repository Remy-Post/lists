# Lists

**Unlimited lists, unlimited depth.** A local-first, keyboard-first to-do app that stays fast on a 3G connection.
Live at **[lists.remypost.me](https://lists.remypost.me)**.

Every to-do app limits either depth or calm. Google Tasks flattened subtasks to one level, Microsoft To Do allows one level of steps, Todoist stops at 4 and TickTick at 5. Lists lets any item hold items, which hold items, to any depth. It keeps the calm of Things: no red guilt for overdue work, and one keystroke to bring it back to Today. Every claim here is sourced in [`docs/research/`](docs/research).

## What it does

- **n lists, n levels.** A list *is* an item with children. Tab and ⇧Tab nest and un-nest. Open any item as its own page, with breadcrumbs; the URL changes, so Back zooms out. A thin stack of sheet edges above the title shows how deep you are.
- **Keyboard-first.** Outliner keys while typing (Enter, Tab, ⇧Tab, Backspace to join). Single keys once a row is selected (`x` complete, `t` when, `d` deadline, `]`/`[` move a day, `m` move, `z` open, `u` up a level). `g t`, `g i` and `g u` go to Today, Inbox and Upcoming. `⌘K` opens a command palette that also finds any item, and `?` lists every shortcut.
- **Quick add that understands you.** Type `Pay rent every 1st #home !!` or `Call Ana by fri` and the dates, deadlines, repeats, priority and target list are highlighted as you type. Click a highlight to keep those words as literal text.
- **Smart views:** Inbox, Today (with *This evening*), Upcoming, Someday, Logbook and Trash. Items nested anywhere show up with their path.
- **When vs deadline**, the way Things does it. Repeats run either on a schedule or after completion, and a repeating item's checklist resets each time.
- **Undo for everything**, unlimited and context-restoring, and it keeps working after a sync. Deleted items go to Trash.
- **Touch:** swipe right to complete, swipe left to schedule, long-press to drag (sideways to nest), and a toolbar above the keyboard for indenting on a phone.
- **Local-first.** Everything lives in IndexedDB and is saved within 250 ms and again the moment the app is hidden, so killing the browser on Android loses nothing. It works offline as an installable PWA.
- **Opportunistic, end-to-end encrypted sync.** It syncs only on Wi-Fi or a fast link, and only when the backup is stale. A backup-age rule ("at least every N days") overrides that. The server stores ciphertext only (AES-GCM-256, keys derived from a pairing code it never sees).
- **Export** as Markdown or JSON at any time. Your data is yours.

## Design: "Blue Pencil"

Graphite for content, an editor's **blue pencil** for your marks (done, focus, selection), **red pencil** only for corrections (a missed deadline, delete). Nothing else is coloured. One typeface, Mona Sans, where *width* carries hierarchy: completed items literally condense. Every completion gets a hand-drawn strike seeded by the item's id, so it's unique per item but stable. When the last item of the day is done, the strikes stay on the page and a raking-light WebGL shader sweeps once across it: **"Today is clear."** Full rationale in [`docs/research/03-design-craft.md`](docs/research/03-design-craft.md).

## Built for two screens

| Galaxy S25 Ultra (Chrome) | 16" MacBook Pro (Chrome) |
|---|---|
| `phone.css`: bottom bar in the thumb zone, 48 px targets, sheets, swipe gestures, keyboard toolbar, safe areas | `desk.css`: three panes with a docked inspector from 1440 px, dense 34 px rows, hover affordances for fine pointers, P3 colour on the XDR panel |

## Performance

| | Budget | Now |
|---|---|---|
| Critical path (HTML + CSS + JS), Brotli | ≤ 50 KB | ~41 KB |
| Fonts (lazy, `font-display: optional`) | ≤ 50 KB | 48 KB (two subsets) |
| WebGL light (lazy chunk) | ≤ 6 KB | ~3 KB |
| Sync server memory | ≤ 30 MB | ~14 MB |

There are no runtime dependencies. One HTML file, three stylesheets (base plus two viewport files, fetched in parallel) and one JS bundle; no request waterfalls. QA numbers under DevTools "3G" throttling are in [`docs/audits/`](docs/audits).

## Architecture

```
src/
  index.html  css/{app,phone,desk}.css  sw.js  manifest.webmanifest
  js/ main  store (records, HLC, LWW merge, tree index, cycle repair)  db (IndexedDB)  ops (undo)
      actions  view (render, FLIP)  input (editing)  keys (command registry)  ui (surfaces)
      gesture (drag, swipe)  parse (quick-add grammar)  sync (E2E sync)  strike  gl (lazy)
server/  sync_server.py (Python stdlib + SQLite)  Dockerfile
deploy/  publish.sh  install-caddy.sh  caddy.lists.conf  docker-compose.sync.yml
docs/    GOALS  PLAN  TEAMS  research/  audits/
```

The data model is one flat record per node, `{id, f: {field: [value, hybridLogicalClock]}}`, with `pos = {parent, fractionalKey}` as a single register. Merges are per-field last-writer-wins. Concurrent moves that would form a cycle are repaired deterministically on every device. Details in [`docs/research/04-architecture.md`](docs/research/04-architecture.md).

## Develop

```bash
export PATH=~/.local/node/bin:$PATH   # Node 22+
npm install                           # esbuild (dev only)
node build.mjs                        # → dist/, prints the size budget
node tests/harness/serve.mjs dist 8080
npm test                              # parser, sync client, sync server
```

## Deploy (on the VM)

```bash
./deploy/publish.sh                                          # build → ~/sites/lists/releases/<stamp>, swap current
docker compose -f deploy/docker-compose.sync.yml up -d --build
./deploy/install-caddy.sh                                    # backup, validate, reload the shared Caddy
```

## How it was made

Planned, built and audited in compartments, each team with one owner and one deliverable ([`docs/TEAMS.md`](docs/TEAMS.md)). Four research squads read primary sources on competitors, platforms, design craft and local-first architecture. A red team audited the plan before any code existed, then the code, the visuals and the interactions. Parser, Sync and Light teams built against written contracts.

## Credits

[Mona Sans](https://github.com/github/mona-sans) by GitHub, SIL Open Font License (`src/fonts/OFL.txt`). Fractional indexing after David Greenspan and rocicorp (CC0). Ideas borrowed, with thanks and citations, from Things, Workflowy, Dynalist, Todoist, TickTick, OmniFocus, Logseq and Linear.

MIT License.
