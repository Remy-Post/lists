# Teams

Organised like Napoleon's corps: each team is self-contained, owns a clear piece of the work, has one objective and an interface contract, and moves independently toward a shared plan.
Run like Musk's "the requirement owner is a person": every file has exactly one owning team, and each team names the requirement it serves.
Changes that cross team lines go through the **Chief** (the orchestrating session), which owns PLAN.md and the contracts below.

| Team | Owns (files) | Objective | Hiring brief (what "A-grade" means here) |
|---|---|---|---|
| **Intelligence** (4 squads) | `docs/research/*` | Primary-source research on competitors, platform, craft, architecture | Every claim has a URL; flags secondary sources; measures instead of guessing |
| **Red Team** | `docs/audits/*` | Independent audits of the plan, code, visuals and interactivity | Not shown the authors' reasoning; reviews artifacts cold; ranks findings by severity |
| **Core** (Chief) | `src/index.html`, `src/css/*`, `src/js/{main,store,db,ops,keys,view,strike}.js`, `build.mjs` | The app itself | — |
| **Parser** | `src/js/parse.js`, `tests/unit/parse.test.mjs` | Quick-add grammar, NL dates, RRULE subset | Pure functions, exhaustive tests, zero dependencies, ≤ 4 KB gz |
| **Sync** | `server/*`, `src/js/sync.js`, `tests/unit/sync*.mjs`, `deploy/caddy.lists.conf` | E2E-encrypted opportunistic sync + tiny backend | Security-minded; idempotent protocol; ≤ 30 MB RAM server |
| **Light** | `src/js/gl.js` | The "Today, struck through" raking-light moment | Raw WebGL2, ≤ 6 KB gz, context-loss safe, idle at 0 % CPU |
| **QA** | `tests/e2e/*`, `tests/harness/*` | 3G harness, device matrix, persistence kill test, flows | Reproducible numbers; screenshots for both devices and both themes |

## Contracts

### parse.js (pure ES module, no DOM)
```js
parseQuick(text, now?: Date) → {
  title: string,                 // text with recognised tokens removed, whitespace collapsed
  when: 'YYYY-MM-DD'|null, evening: boolean, deadline: 'YYYY-MM-DD'|null,
  priority: 0|1|2|3, list: string|null, tags: string[],
  rrule: string|null, repeatFrom: 'when'|'done',
  tokens: [{ start, end, kind: 'when'|'deadline'|'priority'|'list'|'tag'|'repeat', text }]
}
parseQuick(text, now, { ignore: [[start,end],...] })  // spans the user clicked to make literal
parseDate(str, now) → 'YYYY-MM-DD'|null
suggestDates(prefix, now) → [{ label, date }]           // "tom" → Tomorrow, "au" → Aug 1
nextOccurrence(rrule, fromYMD, repeatFrom, doneYMD?) → 'YYYY-MM-DD'
describeRRule(rrule) → 'Every week on Monday'
formatDay(ymd, now) → 'Today'|'Tomorrow'|'Yesterday'|'Fri'|'Nov 14'|'Nov 14, 2027'
ymd(date) / fromYMD(str) helpers (floating local dates)
```

### sync.js (browser ES module)
```js
createSync({
  db: { getOutbox(): Promise<Rec[]>, ackOutbox(recs: Rec[]): Promise<void>,
        applyRemote(recs: Rec[]): Promise<void>, getMeta(k), setMeta(k, v) },
  onStatus(s: { state: 'idle'|'syncing'|'offline'|'error'|'unpaired', lastPush, lastPull, backupAgeMs, message? })
}) → { maybeSync(reason), syncNow(), createVault(): Promise<string /*pairing code*/>,
       join(code): Promise<void>, unpair(), pairingCode(): Promise<string|null>, linkQuality(): Promise<'good'|'poor'|'offline'> }
// Rec = { id, f: { field: [value, hlc] }, v: hlc }   — opaque to sync; encrypted as JSON
```

### gl.js (lazy chunk)
```js
export function strikeLight(host: HTMLElement, opts?: { theme: 'light'|'dark' }) → { sweep(): Promise<void>, destroy() }
export function supported(): boolean   // WebGL2 && !reduced-motion && !saveData && battery ok
```
