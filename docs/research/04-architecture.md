# 04 — Architecture research: data model, merge, sync, security, persistence

**Team:** Architecture · **Date:** 2026-11-05 · **Status:** recommendation, ready for plan audit

The question: how should Lists (one user, an Android phone and a MacBook, sometimes both edited offline) store an unlimited-depth tree, merge edits, sync to a minimal backend on the shared Oracle VM, and stay secure? Every claim below links to its source. Where something is our own reasoning or a measurement on this VM, it says so.

Constraints come from [`GOALS.md`](../GOALS.md): a critical path of **≤ 50 KB gzip**, a sync service of **≤ 30 MB RAM**, local-first, sync only on a good connection when the server copy is stale (or when the user asks), tested under 3G throttling.

---

## TL;DR

| Area | Recommendation |
|---|---|
| Data model | Flat **adjacency list**: one record per node, with `pos = {parent, key, prev}` held as **one** field, and a [fractional-index](https://observablehq.com/@dgreensp/implementing-fractional-indexing) order key. Lists are nodes too. The whole tree is kept in memory and indexed by parent. |
| Merge | **State-based, per-field last-writer-wins** with **hybrid logical clock** stamps. Deletes are tombstones. Concurrent moves that form a cycle are repaired by a pure, deterministic rule (the later move loses), matching the outcome of [Kleppmann et al.](https://martin.kleppmann.com/papers/move-op.pdf). No CRDT library. |
| Sync | One `POST /api/sync` round trip does push and pull together. The server keeps a sequence number per row and the client keeps a cursor. The server keeps only unmerged versions. Pulls are paged at 500 rows or 512 KB. Retries are idempotent through `UNIQUE(rid, ver)`. |
| Security | A **256-bit random sync key**, shown once and paired by QR code. HKDF derives an *auth token* (the server stores only its SHA-256) and an *AES-GCM-256 key* (it never leaves the device). The server stores ciphertext only. Same origin, so there are no CORS headers. The app limits failed attempts, and Caddy caps request bodies. |
| Undo/redo | A command pattern with field-level `{id, field, before, after}` patches. An undo is a **new** stamped write that syncs like any edit, and it skips fields that changed remotely since. |
| Persistence | IndexedDB with three stores (`nodes`, `outbox`, `meta`) behind a hand-rolled wrapper of about 40 lines. Writes are batched every 300 ms and flushed on `visibilitychange:hidden` and `pagehide`. The app requests `navigator.storage.persist()`. |
| Dates | A hand-rolled English parser (about 3 KB) and an RRULE subset evaluator (about 2 KB) instead of chrono-node (48 KB gzip) and rrule.js (13.5 KB gzip plus tslib). |
| Backend | About 180 lines of Python stdlib (`ThreadingHTTPServer` and `sqlite3` in WAL mode). It runs in a `python:3.12-alpine` container on the existing `n8n_default` network behind the shared Caddy. Measured RSS is **~23 MB**. |

---

## 1. Data model for an unlimited-depth tree

### Options

**A. Nested arrays** (`list.items[i].children[j]…`, one document per list). Rendering is easy because the order is implicit. Everything else is harder:
- A move becomes "delete here, insert there". Two replicas moving the same subtree concurrently can **duplicate** it. Kleppmann shows that naive concurrent moves duplicate nodes or create cycles, and demonstrates exactly these bugs in Google Drive and Dropbox ([move-op paper, §2](https://martin.kleppmann.com/papers/move-op.pdf)).
- Position is an array index, and array indices are unstable under concurrent edits. Kleppmann's list-move paper exists because moving list elements by delete+insert duplicates the element ([Moving Elements in List CRDTs](https://martin.kleppmann.com/papers/list-move-papoc20.pdf)).
- Sync granularity is the whole document unless you diff it.

**B. Adjacency list + fractional order key** (one flat record per node, each with `parentId` and an `orderKey`).
- **Moving a subtree is a single field write** on its root. The descendants don't change. Figma uses exactly this: "each child stores a link to its parent", which preserves object identity across moves ([Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)).
- **Ordering** comes from a fractional index. A key is generated between its neighbours, so a reorder changes only one record ([Figma, ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/)). Greenspan's scheme adds an integer part with a length-prefix head ("a0", "a1", "Z9"…), so appending or prepending grows keys only logarithmically: "the millionth item will start with 'd'" ([Greenspan](https://observablehq.com/@dgreensp/implementing-fractional-indexing)). The `fractional-indexing` package implements it as `generateKeyBetween(a, b)` and `generateNKeysBetween` ([rocicorp/fractional-indexing](https://github.com/rocicorp/fractional-indexing)), at 1.5 KB gzip ([bundlephobia](https://bundlephobia.com/package/fractional-indexing)). Compare keys with plain `<`, not `localeCompare` ([same README](https://github.com/rocicorp/fractional-indexing)).
- **Parent and key are one property.** Figma stores the parent link and the position as a single property so they update together, because a position is meaningless under a different parent ([Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). We do the same with `pos = {parent, key, prev}`. This is also Kleppmann's generic move: one LWW register per element holds its position, so concurrent moves pick a single winner instead of duplicating ([list-move paper §3](https://martin.kleppmann.com/papers/list-move-papoc20.pdf)).
- **Cycle prevention** is local and cheap. Before applying a move, walk up from the new parent: if you reach the node being moved, refuse. This is the check in Kleppmann's `do_op`: "if the node c is being moved, and c is an ancestor of the new parent newp", the operation is ignored ([move-op §3.3](https://martin.kleppmann.com/papers/move-op.pdf)). Concurrent moves can still form a cycle that neither replica saw (§2.3 below).
- **Sync** is per record and naturally delta-friendly.
- **Rendering** needs an in-memory index `childrenByParent: Map<id, id[]>` sorted by `(key, id)`. Flatten only the *expanded* subtrees into the visible row list. Build the index once at boot and update it incrementally on each change. That is O(changed) per edit, and a full rebuild for 10k nodes is a single sort per parent (our estimate).

**Concurrent inserts at the same spot** can produce identical keys. Figma notes that averaging identical indices fails and has its server pick a unique position ([Figma ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/)). We have no authoritative server (the data is encrypted), so we (1) sort by `(key, id)` to keep a deterministic order, and (2) when the user next inserts between two equal keys, re-key one of them first. The rocicorp README also suggests random jitter to reduce collisions ([rocicorp](https://github.com/rocicorp/fractional-indexing)). Interleaving of concurrent inserts is acceptable here, as Figma also concluded ([Figma](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/)).

### Decision: B

```js
// One record per node. Lists are nodes whose effective parent is ROOT.
{
  id: "n_01JC…",                 // client-generated (crypto.randomUUID() or ULID): works offline
  f: {                           // every synced field is [value, hlc]
    kind:    ["item", h],        // "list" | "item"
    pos:     [{ parent: "n_…", key: "a3V", prev: "n_…" }, h],  // parent+order+previous parent, ONE register
    title:   ["Buy milk", h],
    notes:   ["", h],
    done:    [false, h],
    due:     ["2026-11-06", h],  // floating local date; no TZ shift between devices
    time:    [null, h],          // "17:00" or null
    rrule:   [null, h],          // "FREQ=WEEKLY;BYDAY=MO" subset (§7)
    repeatFrom: ["due", h],      // "due" | "done"
    deleted: [false, h],         // tombstone
  },
  v: "<max hlc of f>"            // record version, used as the sync row version
}
```

UI-only state (collapsed or expanded, selection, scroll) stays in a device-local `meta` key and is never synced.

---

## 2. Merge strategy

### 2.1 Options weighed

| Option | Fit for 1 user / 2 devices |
|---|---|
| **Full CRDT library** (Automerge, Yjs, Loro) | Automerge "keeps track of the changes you make" (full history) and ships as Rust compiled to WebAssembly ([Automerge docs](https://automerge.org/docs/hello/)). On bundlephobia `@automerge/automerge` is 1.6 MB gzip with a 3.6 MB wasm, and Loro carries a 3.6 MB wasm ([bundlephobia: automerge](https://bundlephobia.com/package/@automerge/automerge), [loro-crdt](https://bundlephobia.com/package/loro-crdt)). Loro does offer a movable tree ([Loro README](https://github.com/loro-dev/loro)). Yjs is 28 KB gzip plus `lib0` ([bundlephobia: yjs](https://bundlephobia.com/package/yjs)), but its documented shared types are Map and Array ([Yjs docs](https://docs.yjs.dev/)), with no tree move. Ink & Switch found Automerge reliable, but noted that "CRDTs store all history", which caused performance and memory problems, and that history is hard to truncate ([Local-first software](https://www.inkandswitch.com/essay/local-first/)). **Every option either blows the 50 KB budget or lacks a native tree move.** |
| **Operation log + replay** (Kleppmann move-op) | Correct for arbitrary concurrent moves and formally verified. It needs a totally ordered log, undo-do-redo of every op newer than an incoming one, and retention of even ignored ops, because "the operation log must include all operations, even those that were ignored" ([move-op §3.5](https://martin.kleppmann.com/papers/move-op.pdf)). The log can be truncated only once timestamps are causally stable ([§3.7](https://martin.kleppmann.com/papers/move-op.pdf)). That is more machinery than one user needs. |
| **Per-field LWW with HLC (state-based)** | Figma resolves conflicts per `(object, property)`, and edits to different properties never conflict ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). Linear also "employs a simple Last-Writer-Wins strategy" for updates ([reverse-engineering of Linear's sync engine](https://github.com/wzhudev/reverse-linear-sync-engine), a secondary source; Tuomas Artman's talk is at [linear.app](https://linear.app/blog/scaling-the-linear-sync-engine)). A merge is a pure function of two records, so it is commutative, associative and idempotent (our reasoning). Retries and duplicate deliveries are therefore harmless, and the server needs no logic. |

### 2.2 Pick: per-field LWW with hybrid logical clocks

Why it fits:
1. **One human.** True concurrent edits to the *same field* happen only when the same item is edited on both devices while offline. LWW keeps the later one. Ink & Switch observe that for same-property conflicts the resolution is "often arbitrary" and "satisfactory either way" ([Local-first](https://www.inkandswitch.com/essay/local-first/)). For the long `notes` field we also keep the losing value in a `conflict` side field so nothing is silently lost.
2. **E2EE forces client-side merging.** Figma and Linear rely on a central server to order and validate. Ours can't read the data, so the merge must be deterministic on the client. State-based LWW is the simplest thing that converges without a server.
3. **Small and budget-friendly.** About 1 KB of code, no wasm, no history growth. Only tombstones need GC (§2.5).

**Why HLC and not wall-clock or Lamport timestamps:** an HLC "captures the causality relationship like logical clocks" while staying "always close to the NTP clock", and it fits in 64 bits ([Kulkarni et al., HLC](https://cse.buffalo.edu/tech-reports/2014-04.pdf)). That means a phone with a skewed clock can't make an old edit win forever after it has seen a newer one, and the stamps still read as human time for "edited 5 min ago". The update rules from the paper's Figure 5:

```
send/local:  l' = l;  l = max(l', pt);           c = (l == l') ? c + 1 : 0
receive m:   l' = l;  l = max(l', l_m, pt)
             c = (l == l' == l_m) ? max(c, c_m) + 1
               : (l == l')        ? c + 1
               : (l == l_m)       ? c_m + 1 : 0
```

We encode an HLC as a sortable string, `l.toString(36).padStart(9,"0") + c.toString(36).padStart(4,"0") + deviceId`, so plain string comparison gives a total order, and ties are broken by device ID. Clamp any received `l_m` more than 24 h in the future, to keep a broken clock from poisoning the stamps (our safeguard).

### 2.3 Concurrent moves that form a cycle

Example: device 1 moves A under B while device 2, offline, moves B under A. Each move was valid locally, but together they form a cycle ([move-op Fig. 2](https://martin.kleppmann.com/papers/move-op.pdf)). Kleppmann's rule is that the operation with the greater timestamp is ignored ([§3.5](https://martin.kleppmann.com/papers/move-op.pdf)). Figma instead lets its server reject the bad parent update, while clients briefly hide the affected objects ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)).

We get Kleppmann's outcome without an op log. The **stored** `pos` registers converge by LWW. The **effective** parent used for rendering is then computed by a pure function of the converged state, so both devices derive the same tree:

```js
// Deterministic cycle repair: the same state gives the same tree on every device.
function effectiveParents(nodes) {           // nodes: Map<id, record>
  const eff = new Map([...nodes].map(([id, n]) => [id, n.f.pos[0].parent]));
  const demoted = new Map();
  for (;;) {
    const cyc = findFirstCycle(nodes, eff);  // walk ids in sorted order; return the node list of the first cycle
    if (!cyc) return eff;
    // the most recent move in the cycle loses (Kleppmann: the later op is ignored)
    const v = cyc.reduce((a, b) => (nodes.get(a).f.pos[1] > nodes.get(b).f.pos[1] ? a : b));
    const prev = nodes.get(v).f.pos[0].prev; // parent before that move, recorded by the mover
    if (!demoted.get(v) && (nodes.has(prev) || prev === ROOT)) { eff.set(v, prev); demoted.set(v, 1); }
    else { eff.set(v, INBOX); demoted.set(v, 2); }   // last resort: always acyclic
  }
}
// Also: a parent missing locally (not yet synced, or purged) → show under INBOX as "Recovered".
```

For the common two-move case this produces exactly Kleppmann's result. Each node is demoted at most twice, so the loop terminates. We fuzzed it with 3,000 random two-replica offline sessions (random trees, 1–5 valid local moves each, LWW merge). Every merged result was acyclic and identical regardless of iteration order. This is our own simulation, not a proof. If Lists ever becomes multi-user with heavy concurrent restructuring, switch to the full move-op log ([paper §3.4](https://martin.kleppmann.com/papers/move-op.pdf)). The record format already carries everything needed.

The UI never offers an invalid move. Indent, outdent and drag use the ancestor check from §1.

### 2.4 Delete vs edit

- **Delete is a tombstone field** (`deleted: [true, h]`), not removal. Figma deletes object data on the server and keeps it in the deleting client's undo buffer ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). That relies on an online server, which we don't have.
- **Only the root of a deleted subtree is tombstoned.** Descendants become invisible because an ancestor is deleted. Kleppmann: "We do not recursively remove children, since a move operation concurrent to the deletion operation might move the deleted subtree back out of the trash", and the children should be preserved ([move-op §3.6](https://martin.kleppmann.com/papers/move-op.pdf)).
- **Edit on device B after delete on device A.** The fields are independent, so the edit survives inside the tombstoned record and the item stays deleted (delete wins structurally). If any field's HLC is newer than the `deleted` stamp, the Trash view marks the item "edited on another device after you deleted it" with a one-tap restore. Nothing is lost, and nothing reappears unexpectedly. This is our policy choice.
- **Undo of delete** is just `deleted = false` with a new stamp (§5).

### 2.5 Tombstones and their GC

The paper's rule: trashed nodes can be collected once the operation that trashed them is *causally stable*, meaning every replica has seen it ([move-op §3.7](https://martin.kleppmann.com/papers/move-op.pdf)). With a server cursor per device this becomes concrete:

1. A tombstone stays in Trash for **30 days**, so the user can restore it.
2. After that, a client that has already pushed the tombstone sends **purge markers** (`{id, v, b: null}`) for the record and its descendants, then deletes them locally.
3. The server drops every older row for that id at once, and drops the purge marker itself once every device seen in the last 90 days has a cursor past it. It then raises the vault's `horizon`.
4. A device whose cursor is below `horizon` gets `{reset: true}` and re-pulls from 0. This is the same idea as Linear's full bootstrap versus incremental sync from `lastSyncId` ([wzhudev](https://github.com/wzhudev/reverse-linear-sync-engine)). On reset, clean local records missing from the server are deleted, while **dirty** local records are pushed. An offline edit to a purged item therefore resurrects it (edit beats purge).

### 2.6 Merge pseudo-code (client)

```js
// [value, hlc] per field. HLC strings compare lexicographically.
function mergeRecord(a, b) {
  if (!a) return b; if (!b) return a;
  const f = {};
  for (const k of new Set([...Object.keys(a.f), ...Object.keys(b.f)])) {
    const x = a.f[k], y = b.f[k];
    f[k] = !x ? y : !y ? x : (y[1] > x[1] ? y : x);
  }
  if (notesConflict(a, b)) f.conflict = [losingNotes(a, b), f.notes[1]]; // concurrent long-text edits: keep the loser
  return { id: a.id, f, v: maxStamp({ f }) };
}

async function applyPulled(rows) {           // rows from /api/sync, in seq order
  const touched = [];
  for (const row of rows) {
    if (row.b === null) { purgeLocal(row.id); continue; }
    const remote = await decryptRecord(row);        // AES-GCM, AAD = id|ver (§4)
    hlcReceive(remote.v);
    const local = state.nodes.get(row.id);
    const merged = mergeRecord(local, remote);
    if (!sameRecord(merged, local)) { state.nodes.set(row.id, merged); touched.push(row.id); }
    if (!sameRecord(merged, remote)) outbox.add(row.id);  // we hold newer fields: push them back
  }
  reindex(touched);                     // childrenByParent, due index, effectiveParents()
  await persist(touched, { cursor: lastSeq(rows) });    // nodes + outbox + cursor in ONE IDB transaction
  render(touched);
}

function localWrite(id, field, value) {   // every user edit goes through here
  const h = hlcTick();
  const n = state.nodes.get(id) ?? newRecord(id);
  n.f[field] = [value, h]; n.v = h;
  outbox.add(id); scheduleFlush();        // §6 batching
}
```

---

## 3. Sync protocol

### 3.1 Design: one round trip, server sequence numbers, state-based rows

This is the push-then-pull pattern from Replicache ([how it works](https://doc.replicache.dev/concepts/how-it-works)) and Linear (a global `lastSyncId` that clients compare to detect missing deltas ([wzhudev](https://github.com/wzhudev/reverse-linear-sync-engine))), collapsed into a single request to save 3G round trips:

```
POST /api/sync                     Authorization: Bearer <authToken>
Content-Encoding: gzip (if > 1 KB)  Content-Type: application/json
{ "dev": "d_7f…", "since": 1234,
  "push": [ { "id": "n_…", "v": "<record hlc>", "b": "<base64url(iv‖ciphertext)>" }, … ] }

200 { "rows": [ { "s": 1240, "id": "n_…", "v": "…", "b": "…" }, … ],
      "cursor": 1262, "more": false, "head": 1262 }
  | { "reset": true }
```

Server, in one SQLite `BEGIN IMMEDIATE` transaction:
1. For each pushed row, `INSERT OR IGNORE` keyed by `UNIQUE(vault, rid, ver)`. **A retried request is a no-op**, which is the same aim as Replicache's rule that "a change is applied exactly once on the server" ([Replicache](https://doc.replicache.dev/concepts/how-it-works)). Even without that, the LWW merge makes duplicates harmless.
2. **Compaction.** A pushed row was built by a client that had already merged everything up to `since`, so the server deletes older versions of that record with `seq ≤ since`. Concurrent versions newer than `since` from the other device stay until someone merges them. The server ends up holding about one row per record, plus at most one unmerged row per device. This is our design, and we verified it in the test run in §8.
3. Return rows with `seq > since` from *other* devices (no echo), paged at **500 rows or 512 KB**, with `more: true` when the page is full.
4. Record the device's cursor (for GC, §2.5).

Client: read the outbox → encrypt the current state of each id (not every intermediate edit: state-based sync **coalesces** ten edits to one item into one row) → POST → `applyPulled(rows)` → set `cursor` → remove outbox entries whose version didn't change while the request was in flight → loop while `more`.

### 3.2 When to sync ("stay local unless the link is good and the copy is stale")

```js
const PUSH_STALE = 2 * 60e3, PULL_STALE = 15 * 60e3;
function goodLink() {
  const c = navigator.connection;            // Chromium only
  if (c) return !c.saveData && (c.type === "wifi" || c.type === "ethernet" || c.effectiveType === "4g");
  return lastSyncStats.rttMs < 800;          // Safari/Firefox: judge by our own last sync's RTT
}
function shouldSync(manual) {
  if (!navigator.onLine) return false;
  if (manual) return true;                   // the user asked: ignore staleness, still respect offline
  const stale = (outbox.size && now() - meta.lastPush > PUSH_STALE) || now() - meta.lastPull > PULL_STALE;
  return stale && goodLink();
}
```

- The Network Information API exposes `effectiveType` and `type` with a `change` event ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API)). It is **not Baseline**: Chrome for Android supports it, while Safari and Firefox do not ([caniuse](https://caniuse.com/netinfo)). Hence the RTT fallback for the MacBook if it runs Safari.
- **Triggers:** `visibilitychange → visible`, the `online` event and `connection.change`, a 60 s timer while visible, and a manual "Sync now" action (keyboard shortcut). There are no WebSockets or SSE. Replicache treats a poke channel as optional ([Replicache](https://doc.replicache.dev/concepts/how-it-works)), and skipping it keeps server threads and memory near zero.
- **On hide:** flush to IndexedDB first (§6). Then, if the outbox is dirty and the link is good, send the push with `fetch(…, {keepalive: true})`, but only when the body is under 64 KiB, because "the body size for keepalive requests is limited to 64 kibibytes" ([MDN RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit)). Otherwise wait for the next open.
- Use the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) so only one tab syncs, and use `BroadcastChannel` to tell other tabs which ids changed.

### 3.3 Compression and payload bounds

- **Responses:** Caddy's `encode` directive enables zstd (preferred) and gzip by default, with a 512-byte `minimum_length` ([Caddy encode](https://caddyserver.com/docs/caddyfile/directives/encode)). It applies to proxied responses too.
- **Requests:** gzip in the browser with `CompressionStream("gzip")`, which has been Baseline since May 2023 and is available in workers ([MDN Compression Streams](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)). The Python backend inflates with `gzip` and caps the inflated size at 8 MB as a zip-bomb guard. The Caddy docs describe response encoding only ([encode](https://caddyserver.com/docs/caddyfile/directives/encode)), so the app does the request side itself.
- **Encrypted bytes don't compress.** Transport compression mostly just wins back base64's 4/3 expansion (our reasoning). If bootstrap size ever matters, add a snapshot mode that compresses the whole state *then* encrypts it into one blob. Compress-then-encrypt leaks only when an attacker can inject plaintext next to secrets, which a single-user to-do app doesn't allow (our reasoning).
- **Bounds:** push ≤ 1,000 rows and ≤ 64 KB per row. The client sends ≤ 200 rows or ≤ 256 KB per request. Pull pages are 500 rows or 512 KB. Caddy rejects bodies over 2 MB with 413 ([request_body](https://caddyserver.com/docs/caddyfile/directives/request_body)), and the app rejects them again itself, as OWASP's REST guidance recommends ("reject … with 413") ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)).

---

## 4. Security

### 4.1 Authentication without heavy infrastructure

There is one user and no accounts. A **sync key** is generated on the first device and pasted or scanned (QR) on the second:

```js
const S = crypto.getRandomValues(new Uint8Array(32));          // 256-bit master secret, shown once as base64url (43 chars)
const base = await crypto.subtle.importKey("raw", S, "HKDF", false, ["deriveKey", "deriveBits"]);
const hk = (info) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8(info) });
const authToken = b64url(await crypto.subtle.deriveBits(hk("lists/auth/v1"), base, 256)); // goes to the server
const encKey = await crypto.subtle.deriveKey(hk("lists/enc/v1"), base,
                 { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); // never leaves the device
```

- HKDF is "designed to derive key material from some high-entropy input" and is a supported `deriveKey` algorithm ([MDN deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)). Because S is high-entropy, **no slow KDF is needed**. That makes pairing instant on the phone, and there is nothing to brute-force.
- 32 random bytes match Python's guidance that "32 bytes (256 bits) of randomness is sufficient" ([Python `secrets`](https://docs.python.org/3/library/secrets.html)).
- The server stores **only SHA-256(authToken)** and compares in constant time with `hmac.compare_digest` ([Python `secrets`/`hmac`](https://docs.python.org/3/library/secrets.html)). OWASP likewise says a comparison should "return in constant time" ([OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)). A fast hash is fine here because the token is random. OWASP's slow-hash parameters target low-entropy passwords ([Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)) (our reasoning).
- The token goes in the **`Authorization` header, never the URL**: "Passwords, security tokens, and API keys should not appear in the URL" ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)).
- **HTTPS only.** "Secure REST services must only provide HTTPS endpoints" ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). Caddy already terminates TLS for the domain.
- A `CryptoKey` is structured-cloneable ([MDN structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)), so the **non-extractable** `encKey` is stored directly in IndexedDB `meta`. The raw S is shown once for pairing and is offered again only behind an explicit "Show sync key" action.
- The sync key never goes in the repo. The repo is public ([`GOALS.md`](../GOALS.md) #9).

**Optional passphrase mode:** if Remy would rather type a memorable passphrase than pair by QR, derive S with PBKDF2-HMAC-SHA256 at **600,000 iterations** ([OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)), using a per-vault random salt stored on the server. OWASP prefers Argon2id (m=19 MiB, t=2, p=1) ([same](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)), but Web Crypto offers only HKDF, PBKDF2, ECDH and X25519 ([MDN deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)). `hash-wasm` (which includes Argon2) is 77.7 KB gzip ([bundlephobia](https://bundlephobia.com/package/hash-wasm)), so it could only be lazy-loaded on the pairing screen. **We recommend the random key.**

### 4.2 End-to-end encryption

Ink & Switch: local-first apps "can use end-to-end encryption" so servers "only hold encrypted data that they cannot read" ([Local-first](https://www.inkandswitch.com/essay/local-first/)). For each record:

```js
const iv = crypto.getRandomValues(new Uint8Array(12));      // 96-bit, fresh per encryption
const ct = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv, additionalData: utf8(`${rec.id}|${rec.v}`) },  // binds the blob to its row
  encKey, utf8(JSON.stringify(rec)));
row.b = b64url(concat(iv, new Uint8Array(ct)));             // 128-bit tag is appended by default
```

- The IV "must be unique for every encryption operation carried out with a given key", 96 bits is recommended, and it "does not have to be secret". The tag defaults to 128 bits. `additionalData` is authenticated, and decryption throws if it doesn't match ([MDN AesGcmParams](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)). Using `id|ver` as AAD stops a malicious server from swapping blobs between records or replaying them under a different version (our design).
- With random IVs, NIST SP 800-38D limits a key to 2³² encryptions ([NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final)). A to-do app won't come close, but include a `kid` key-version byte so the key can be rotated.
- **What the server still learns:** record ids, counts, sizes, timing, and which device pushed. It never sees titles, dates or structure.
- **Losing the key** means the server copy is unreadable, but each device still holds full plaintext. The app provides "Export JSON" as a backup.

### 4.3 Rate limiting, CORS, headers

- **Rate limiting.** OWASP: return **429** for clients that send requests too quickly ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)), and throttle repeated failed login attempts ([OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)). Caddy's rate limiter is a third-party module that needs an `xcaddy` custom build ([mholt/caddy-ratelimit](https://github.com/mholt/caddy-ratelimit)). The shared Caddy on this VM is the stock `caddy:2-alpine` v2.11.7, with no `rate_limit` module (we checked with `caddy list-modules`), and replacing it for one site would put every site at risk. So the app keeps its own limiter: **10 failed auth attempts per IP per 10 minutes → 429**. With a 256-bit key, guessing is hopeless anyway; the limiter just stops log spam and wasted CPU. DNS for `lists.remypost.me` points straight at the VM (no Cloudflare in front), so `X-Forwarded-For` from Caddy is the real client IP.
- **CORS: none.** The PWA and the API are on the **same origin** (`lists.remypost.me/api/*`). OWASP: turn off CORS headers when cross-domain calls are not expected ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). Same origin also avoids preflights: a cross-origin request with `Authorization` or a JSON `Content-Type` would be preflighted ([MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)), which costs an extra 3G round trip.
- **Headers on API responses:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, HSTS, and `frame-ancestors 'none'`/`X-Frame-Options: DENY` ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). The page CSP uses `connect-src 'self'`, following the `tokens` site block already in the Caddyfile.
- **Validation:** "Do not trust input parameters/objects": validate length, type and size, and reject anything unexpected ([OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)). The server checks id and version lengths, blob type and size, row count, and inflated size.
- **Generic errors:** every auth failure returns the same `401 {"error":"unauthorized"}` ([OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).
- The service worker must **never cache `/api/*`**.

---

## 5. Undo/redo that coexists with sync

Principles from primary sources:
- Figma: "if you undo a lot, copy something, and redo back to the present, the document should be unchanged". To get there, an undo modifies the redo history at that moment, and a redo modifies the undo history ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)).
- Linear: undo is transaction-based. Each transaction type has an `undoTransaction` that returns the redo transaction, and "when a transaction executes its undo logic, a new transaction is created" and queued for sync ([wzhudev](https://github.com/wzhudev/reverse-linear-sync-engine)).

Design (command pattern with inverse patches):

```js
// One user gesture = one command. Field-level patches make inverses trivial.
// cmd = { label, patches: [{ id, field, before, after }], selBefore, selAfter }
function exec(cmd)  { for (const p of cmd.patches) localWrite(p.id, p.field, p.after);
                      undo.push(cmd); redo.length = 0; }
function doUndo()   { const c = undo.pop(); if (!c) return;
                      const applied = invert(c);  if (applied.patches.length) redo.push(applied); }
function doRedo()   { const c = redo.pop(); if (!c) return;
                      const applied = invert(c);  if (applied.patches.length) undo.push(applied); }
function invert(c)  {
  const out = [];
  for (const p of [...c.patches].reverse()) {
    const cur = state.nodes.get(p.id)?.f[p.field]?.[0];
    if (!deepEqual(cur, p.after)) continue;             // changed remotely since: don't clobber it
    if (p.field === "pos" && wouldCycle(p.id, p.before.parent)) continue;
    localWrite(p.id, p.field, p.before);                // NEW hlc → syncs like any edit
    out.push({ ...p, before: p.after, after: p.before });
  }
  return { ...c, patches: out.reverse(), selBefore: c.selAfter, selAfter: c.selBefore };
}
```

- **Create** is undone as `deleted=true`, and **delete** as `deleted=false`. Tombstones make both trivial.
- **Indent, outdent and move** are `pos` patches. A multi-select indent is one command.
- **Typing coalesces** into one command per item until 1 s of idle or a blur.
- **Remote changes never enter the local stacks.** Stacks are per device and in memory, capped at 200.
- Test Figma's invariant directly: a property test that does N random commands, undoes all, redoes all, and asserts equal state.

---

## 6. Local persistence (IndexedDB)

### Schema (`lists` DB, version 1)

| Store | keyPath | Contents |
|---|---|---|
| `nodes` | `id` | Full records (§1) with per-field stamps |
| `outbox` | `id` | `{id, v}`: ids whose current state still needs pushing (coalesced) |
| `meta` | `k` | `device`, `hlc`, `cursor`, `lastPush`, `lastPull`, `encKey` (CryptoKey), `authToken`, UI state |

There are no secondary indexes in v1. At boot one read-only transaction runs `getAll()` on `nodes` and `meta`, and the in-memory maps (children, due-date buckets for Today and Upcoming) are built from that. 10,000 items at about 400 B is about 4 MB (our estimate), comfortably in memory. Schema changes only happen in `onupgradeneeded`, and changing a keyPath means recreating the store ([MDN Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)). Handle `onversionchange` by closing the DB so a newer tab can upgrade, and handle `onblocked` ([same](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)).

### Write batching and save-on-hide

```js
let dirty = new Set(), timer = 0;
function scheduleFlush() { clearTimeout(timer); timer = setTimeout(flush, 300); }
function flush() {
  clearTimeout(timer); if (!dirty.size) return;
  const ids = [...dirty]; dirty = new Set();
  const tx = db.transaction(["nodes", "outbox", "meta"], "readwrite");
  for (const id of ids) { tx.objectStore("nodes").put(state.nodes.get(id));
                          if (outbox.has(id)) tx.objectStore("outbox").put({ id, v: state.nodes.get(id).v }); }
  tx.objectStore("meta").put({ k: "hlc", v: hlcState });
  tx.commit?.();                         // commit now; don't wait for the event loop
  tx.onerror = () => ids.forEach((i) => dirty.add(i));   // retry next flush
}
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
addEventListener("pagehide", flush);    // never `unload`
```

- Transitioning to hidden "is the last event that's reliably observable by the page" ([MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)). Chrome's lifecycle guide says the same, recommends `pagehide` for possible unloads, and says `unload` "is never recommended". It also notes that IndexedDB `commit()` runs right away, so it is safe in these handlers ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- Never `await` unrelated promises such as `fetch` inside a transaction. A transaction goes inactive once it returns to the event loop with no pending requests ([MDN Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)).
- **Durability:** keep the default. `"relaxed"` commits once data reaches the OS and is meant for "ephemeral data such as caches", while `"strict"` waits for persistent storage ([MDN IDBDatabase.transaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)). With 300 ms batching, write volume is low enough to consider `"strict"` for the hide-time flush.
- **Eviction:** call `navigator.storage.persist()`, which is Baseline since 2021 and secure-context only ([MDN persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)). WebKit grants it by heuristics such as being opened as a Home Screen web app, and otherwise evicts by origin in least-recently-used order ([WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)). Ask for it after the first real use, show the result in Settings, and encourage installing the PWA.

### Wrapper: hand-rolled, not idb-keyval

idb-keyval is tiny (295 B brotli for get/set, 573 B for everything ([README](https://github.com/jakearchibald/idb-keyval))). But "`createStore` won't let you create multiple stores within the same database", and its author recommends `idb` when you need transactions and migrations ([custom stores doc](https://github.com/jakearchibald/idb-keyval/blob/main/custom-stores.md)). We need `nodes`, `outbox` and `meta` written **atomically in one transaction**. `idb` is 1.5 KB gzip ([bundlephobia](https://bundlephobia.com/package/idb)). A hand-rolled wrapper is smaller still and fits the "vanilla JS" goal:

```js
export function openDB(name, version, upgrade) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); };
    r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("blocked"));
  });
}
export const done = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error);
});
export const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
// usage: const db = await openDB("lists", 1, (db) => { db.createObjectStore("nodes", { keyPath: "id" }); … });
```

---

## 7. Recurrence and natural-language dates

### Size check

| Library | gzip | Source |
|---|---|---|
| chrono-node 2.10.3 | **48.1 KB** (204 KB min) | [bundlephobia](https://bundlephobia.com/package/chrono-node) |
| rrule 2.8.1 | **13.5 KB** + tslib dependency | [bundlephobia](https://bundlephobia.com/package/rrule) |
| hand-rolled parser + RRULE subset | ~3 KB + ~2 KB (our estimate) | — |

chrono-node alone almost equals the whole 50 KB critical-path budget. Even lazy-loaded on first quick-add, it costs a noticeable fetch on 3G. **Hand-roll it.** The grammar a to-do app needs is small, and a fixture table of phrases makes it easy to test.

### Parser scope (English, tokens stripped from the title as you type, with a preview chip)

- Days: `today`, `tod`, `tonight`, `tomorrow`, `tmr`, `yesterday`, `mon`…`sunday`, `next mon`, `this weekend`, `next week`, `next month`
- Offsets: `in 3 days`, `in 2 weeks`, `in 1 month`, `+3d`
- Absolute: `nov 5`, `5 nov`, `2026-11-05`, `11/5`. The `M/D` vs `D/M` ambiguity follows `Intl.DateTimeFormat().formatToParts()` locale order.
- Time: `at 5`, `5pm`, `17:30`, `noon`, `eod` (settable)
- Recurrence: `every day`, `every weekday`, `every mon, wed`, `every 2 weeks`, `every month on the 15th`, `every last fri`, `every year`, and `every! …` for "from completion" (Todoist-style)

### RRULE subset (stored as RFC 5545 text, so it interoperates and stays readable)

From [RFC 5545 §3.3.10](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10): `FREQ` is required and must appear once, `INTERVAL` defaults to 1, and `UNTIL` and `COUNT` must not both appear. `BYDAY` takes an optional ordinal (`-1FR` = last Friday) inside MONTHLY and YEARLY rules. Support exactly:

```
FREQ=DAILY|WEEKLY|MONTHLY|YEARLY ; INTERVAL=n ; BYDAY=MO,TU,… | ±nXX (monthly) ;
BYMONTHDAY=±n ; BYMONTH=n ; BYSETPOS=-1 (only for "last weekday") ; COUNT=n | UNTIL=YYYYMMDD
```

Examples: every other Monday is `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`. The last weekday of the month is `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`.

**Semantics:** a recurring item is **one record**. Completing it advances `due` to the next occurrence after the old `due` (`repeatFrom: "due"`) or after today (`repeatFrom: "done"`), keeps `done=false`, and optionally appends to a completion log. No instances are materialised, so there is nothing extra to sync. The Upcoming view expands occurrences lazily for its window. Dates are stored as **floating local dates** (`YYYY-MM-DD` plus an optional `HH:MM`), so a trip across time zones never shifts "Tuesday" (our design choice).

---

## 8. Minimal backend

### 8.1 What it must do

It needs `POST /api/sync`, `GET /api/health`, and a CLI to register a vault. There is no plaintext, no merge logic and no push channel. Python's docs warn that `http.server` "is not recommended for production. It only implements basic security checks" ([Python http.server](https://docs.python.org/3/library/http.server.html)). That is acceptable here **because** Caddy terminates TLS, caps bodies and fronts it, the service binds only on the private Docker network, and its surface is one JSON endpoint (our risk call). `ThreadingHTTPServer` (3.7+) handles browsers that pre-open sockets, and `protocol_version = "HTTP/1.1"` enables keep-alive as long as every response carries an accurate `Content-Length` ([same](https://docs.python.org/3/library/http.server.html)). SQLite in WAL mode means "readers do not block writers", as long as every process is on the same host ([SQLite WAL](https://www.sqlite.org/wal.html)).

### 8.2 Schema

```sql
CREATE TABLE vaults (vault TEXT PRIMARY KEY, token_sha256 BLOB NOT NULL UNIQUE, horizon INTEGER NOT NULL DEFAULT 0);
CREATE TABLE changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, vault TEXT NOT NULL, rid TEXT NOT NULL,
                     ver TEXT NOT NULL, dev TEXT NOT NULL, blob BLOB,      -- NULL = purge marker
                     UNIQUE(vault, rid, ver));
CREATE INDEX changes_by_seq ON changes(vault, seq);
CREATE INDEX changes_by_rid ON changes(vault, rid, seq);
CREATE TABLE devices(vault TEXT NOT NULL, dev TEXT NOT NULL, cursor INTEGER NOT NULL, seen INTEGER NOT NULL,
                     PRIMARY KEY(vault, dev));
```

### 8.3 Server (`server/sync_server.py`, ~180 lines, stdlib only)

We tested this exact file on this VM (Python 3.12.3): two-device push and pull, a retry that hit the duplicate guard, compaction (superseded rows deleted), a purge marker, a gzip request body, a 401 on a bad key, and a 1,000-row push paged into a 500-row pull with `more: true`. **Idle RSS was about 22–23 MB** after the test traffic (`ps -o rss`), under the 30 MB budget.

```python
#!/usr/bin/env python3
"""lists-sync: a tiny delta-sync store for Lists. Stdlib only.

The server never sees plaintext: each row is (record id, version, opaque blob).
"""
import gzip, hashlib, hmac, io, json, os, sqlite3, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH   = os.environ.get("LISTS_DB", "/data/lists.db")
PORT      = int(os.environ.get("LISTS_PORT", "8787"))
MAX_BODY  = 2 * 1024 * 1024      # compressed or not, reject above this (413)
MAX_INFL  = 8 * 1024 * 1024      # cap on gunzipped size (zip-bomb guard)
PAGE_ROWS = 500                  # rows per pull page
PAGE_BYTES = 512 * 1024          # approx bytes per pull page
MAX_PUSH  = 1000                 # rows per push
GC_DAYS   = 90                   # devices unseen this long stop holding back GC

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS vaults(
  vault TEXT PRIMARY KEY, token_sha256 BLOB NOT NULL UNIQUE,
  horizon INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault TEXT NOT NULL, rid TEXT NOT NULL, ver TEXT NOT NULL,
  dev TEXT NOT NULL, blob BLOB,            -- NULL blob = purge marker
  UNIQUE(vault, rid, ver));
CREATE INDEX IF NOT EXISTS changes_by_seq ON changes(vault, seq);
CREATE INDEX IF NOT EXISTS changes_by_rid ON changes(vault, rid, seq);
CREATE TABLE IF NOT EXISTS devices(
  vault TEXT NOT NULL, dev TEXT NOT NULL, cursor INTEGER NOT NULL,
  seen INTEGER NOT NULL, PRIMARY KEY(vault, dev));
"""

_local = threading.local()
def db():
    c = getattr(_local, "c", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, timeout=5, isolation_level=None)
        c.execute("PRAGMA busy_timeout=5000")
        _local.c = c
    return c

# --- naive per-IP failure limiter (Caddy passes the client IP in X-Forwarded-For) ---
_fail = {}; _fail_lock = threading.Lock()
def too_many_failures(ip):
    now = time.time()
    with _fail_lock:
        hits = [t for t in _fail.get(ip, []) if now - t < 600]
        if hits: _fail[ip] = hits
        else: _fail.pop(ip, None)
        return len(hits) >= 10           # 10 bad keys / 10 min / IP
def note_failure(ip):
    with _fail_lock:
        _fail.setdefault(ip, []).append(time.time())

def auth(header):
    if not header.startswith("Bearer "): return None
    token = header[7:].strip().encode()
    if not (32 <= len(token) <= 128): return None
    digest = hashlib.sha256(token).digest()   # token is 256-bit random: a fast hash is fine
    row = db().execute("SELECT vault, token_sha256, horizon FROM vaults WHERE token_sha256=?",
                       (digest,)).fetchone()
    if row and hmac.compare_digest(row[1], digest):
        return row[0], row[2]
    return None

def sync(vault, horizon, req):
    dev   = str(req["dev"])[:64]
    if not dev: raise ValueError("dev")
    since = int(req.get("since", 0))
    push  = req.get("push", [])
    if not isinstance(push, list) or len(push) > MAX_PUSH: raise ValueError("push")
    c = db()
    c.execute("BEGIN IMMEDIATE")
    try:
        if 0 < since < horizon:            # this device slept through a GC: start over
            c.execute("COMMIT")
            return {"reset": True}
        for r in push:
            rid, ver, blob = str(r["id"])[:64], str(r["v"])[:64], r.get("b")
            if blob is not None and (not isinstance(blob, str) or len(blob) > 64 * 1024):
                raise ValueError("blob")
            cur = c.execute("INSERT OR IGNORE INTO changes(vault,rid,ver,dev,blob) VALUES(?,?,?,?,?)",
                            (vault, rid, ver, dev, blob))
            if cur.rowcount:               # new version: drop what it supersedes
                if blob is None:           # purge: forget every older version of this record
                    c.execute("DELETE FROM changes WHERE vault=? AND rid=? AND seq<?",
                              (vault, rid, cur.lastrowid))
                else:                      # the client had merged everything up to `since`
                    c.execute("DELETE FROM changes WHERE vault=? AND rid=? AND seq<=?",
                              (vault, rid, since))
        rows, size = [], 0
        for seq, rid, ver, blob in c.execute(
                "SELECT seq, rid, ver, blob FROM changes WHERE vault=? AND seq>? AND dev<>? "
                "ORDER BY seq LIMIT ?", (vault, since, dev, PAGE_ROWS + 1)):
            if len(rows) == PAGE_ROWS or size > PAGE_BYTES: break
            rows.append({"s": seq, "id": rid, "v": ver, "b": blob}); size += len(blob or "") + 80
        more = len(rows) == PAGE_ROWS or size > PAGE_BYTES
        head = c.execute("SELECT COALESCE(MAX(seq),0) FROM changes WHERE vault=?", (vault,)).fetchone()[0]
        cursor = rows[-1]["s"] if more else max(head, since)
        c.execute("INSERT INTO devices VALUES(?,?,?,?) ON CONFLICT(vault,dev) DO UPDATE "
                  "SET cursor=excluded.cursor, seen=excluded.seen", (vault, dev, cursor, int(time.time())))
        c.execute("COMMIT")
        return {"rows": rows, "cursor": cursor, "more": more, "head": head}
    except Exception:
        c.execute("ROLLBACK"); raise

def gc():
    """Drop purge markers every recently seen device has already pulled."""
    c = db(); cutoff = int(time.time()) - GC_DAYS * 86400
    for (vault,) in c.execute("SELECT vault FROM vaults").fetchall():
        low = c.execute("SELECT MIN(cursor) FROM devices WHERE vault=? AND seen>?", (vault, cutoff)).fetchone()[0]
        if low is None: continue
        c.execute("BEGIN IMMEDIATE")
        n = c.execute("DELETE FROM changes WHERE vault=? AND blob IS NULL AND seq<=?", (vault, low)).rowcount
        if n: c.execute("UPDATE vaults SET horizon=MAX(horizon,?) WHERE vault=?", (low, vault))
        c.execute("COMMIT")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "lists-sync"; sys_version = ""

    def reply(self, code, obj):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health": return self.reply(200, {"ok": True})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/sync": return self.reply(404, {"error": "not found"})
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        if too_many_failures(ip): return self.reply(429, {"error": "slow down"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY: return self.reply(413, {"error": "too large"})
        raw = self.rfile.read(n)
        who = auth(self.headers.get("Authorization", ""))
        if not who:
            note_failure(ip); return self.reply(401, {"error": "unauthorized"})
        try:
            if self.headers.get("Content-Encoding") == "gzip":
                d = gzip.GzipFile(fileobj=io.BytesIO(raw))
                raw = d.read(MAX_INFL + 1)
                if len(raw) > MAX_INFL: return self.reply(413, {"error": "too large"})
            return self.reply(200, sync(who[0], who[1], json.loads(raw)))
        except (ValueError, KeyError, TypeError, OSError, EOFError):
            return self.reply(400, {"error": "bad request"})

    def log_message(self, fmt, *args):     # Caddy already logs requests; keep stderr quiet
        pass

def main():
    c = sqlite3.connect(DB_PATH); c.executescript(SCHEMA); c.close()
    def gc_loop():
        while True:
            time.sleep(3600)
            try: gc()
            except Exception: pass
    threading.Thread(target=gc_loop, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["add-vault"]:     # echo "$TOKEN" | python3 sync_server.py add-vault remy
        token = sys.stdin.readline().strip()  # the auth token the PWA derived; never put it in argv
        if not (32 <= len(token) <= 128): sys.exit("token must be 32-128 chars")
        c = sqlite3.connect(DB_PATH); c.executescript(SCHEMA)
        c.execute("INSERT INTO vaults(vault, token_sha256) VALUES(?,?)",
                  (sys.argv[2], hashlib.sha256(token.encode()).digest())); c.commit()
    else:
        main()
```

### 8.4 Running it on this VM

The VM's existing convention, which we observed: every app is a container on the `n8n_default` Docker network, and the shared Caddy (`n8n-caddy-1`, config at `/home/ubuntu/n8n/caddy/Caddyfile`) reverse-proxies to `container:port`. Containers run with a 256 MB memory limit and `restart: unless-stopped`. Caddy mounts `/home/ubuntu/sites` read-only at `/srv/sites`, so **don't put the SQLite file under `/home/ubuntu/sites/lists/data`**, where a typo in a `file_server` block could expose it. Use a named volume instead.

**Dockerfile**

```dockerfile
FROM python:3.12-alpine
RUN adduser -D -H -u 10001 app && mkdir /data && chown app /data
COPY server/sync_server.py /app/sync_server.py
USER app
ENV LISTS_DB=/data/lists.db LISTS_PORT=8787 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8787
HEALTHCHECK --interval=60s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["python3", "-I", "/app/sync_server.py"]
```

**Run** (one-time vault registration reads the PWA-derived auth token from stdin, so it never lands in shell history or `ps`):

```sh
docker build -t lists-sync .
docker run -d --name lists-sync --network n8n_default --restart unless-stopped \
  --memory 64m --cpus 0.25 --read-only --tmpfs /tmp \
  -v lists_sync_data:/data lists-sync
docker exec -i lists-sync python3 -I /app/sync_server.py add-vault remy   # paste the auth token, Enter
```

**Caddyfile block** (static PWA plus API on one origin; same header style as the existing `tokens` block):

```caddyfile
# BEGIN lists — managed by lists.remypost.me/deploy
(lists) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-Frame-Options "DENY"
		Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
		-Server
	}
	handle /api/* {
		request_body {
			max_size 2MB
		}
		header Cache-Control "no-store"
		reverse_proxy lists-sync:8787 {
			lb_try_duration 10s
			lb_try_interval 250ms
		}
	}
	handle {
		root * /srv/sites/lists/current
		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"
		@fresh not path /assets/*
		header @fresh Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
lists.remypost.me {
	import lists
}
# END lists
```

**Alternative: systemd** (if Remy prefers no container). Use `MemoryHigh=` as the main throttle and `MemoryMax=` as "the last line of defense" ([systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)). Note that Caddy runs inside Docker, so it would then need to reach the host via `host.docker.internal` or the bridge IP. **This is why the container is the better fit here.**

```ini
[Service]
ExecStart=/usr/bin/python3 -I /opt/lists-sync/sync_server.py
Environment=LISTS_DB=/var/lib/lists-sync/lists.db LISTS_PORT=8787
DynamicUser=yes
StateDirectory=lists-sync
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
MemoryHigh=40M
MemoryMax=64M
CPUQuota=25%
Restart=on-failure
```

**Backups:** a nightly `sqlite3 lists.db ".backup /backup/lists-$(date +%F).db"` from the host, or `docker exec` with Python's `sqlite3.Connection.backup`. Because the data is ciphertext, these backups are safe to copy anywhere.

---

## Notes on sources

- **Linear:** Linear hasn't published a written spec of its sync engine. The talk page ([Scaling the Linear Sync Engine](https://linear.app/blog/scaling-the-linear-sync-engine)) only summarises the video. The technical details cited (`lastSyncId`, delta packets, LWW, transaction-based undo) come from Wenzhao Hu's reverse-engineering study ([wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)), which is a **secondary** source. We used them only to support designs that also have primary sources.
- **Evan Wallace's notes:** the two Figma posts cited are his ([multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/)). He also mirrors his Figma writing at [madebyevan.com/figma](https://madebyevan.com/figma/multiplayer-editing-in-figma/).
- **"Josh Gemmell":** a web search for this name together with sync, CRDT and local-first returned nothing relevant, so no notes by that author are cited. Nothing here depends on them. If the brief meant someone else, the recommendation is unaffected.
- **Bundle sizes** come from bundlephobia's API on 2026-11-05 (minified and gzip, latest versions).

## Sources

**Local-first and CRDTs**
- Ink & Switch, *Local-first software*: https://www.inkandswitch.com/essay/local-first/
- Kleppmann, Mulligan, Gomes, Beresford, *A highly-available move operation for replicated trees* (IEEE TPDS): https://martin.kleppmann.com/papers/move-op.pdf
- Kleppmann, *Moving Elements in List CRDTs* (PaPoC 2020): https://martin.kleppmann.com/papers/list-move-papoc20.pdf
- Kleppmann, *CRDTs: the hard parts*: https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html
- Kulkarni et al., *Logical Physical Clocks and Consistent Snapshots* (HLC): https://cse.buffalo.edu/tech-reports/2014-04.pdf
- Automerge docs: https://automerge.org/docs/hello/ · Yjs docs: https://docs.yjs.dev/ · Loro: https://github.com/loro-dev/loro

**Industry sync engines**
- Figma (Evan Wallace), *How Figma's multiplayer technology works*: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Figma (Evan Wallace), *Realtime editing of ordered sequences*: https://www.figma.com/blog/realtime-editing-of-ordered-sequences/
- Evan Wallace's archive: https://madebyevan.com/figma/multiplayer-editing-in-figma/
- David Greenspan, *Implementing Fractional Indexing*: https://observablehq.com/@dgreensp/implementing-fractional-indexing
- rocicorp/fractional-indexing: https://github.com/rocicorp/fractional-indexing
- Replicache, *How it works*: https://doc.replicache.dev/concepts/how-it-works
- Linear, *Scaling the Linear Sync Engine* (talk): https://linear.app/blog/scaling-the-linear-sync-engine
- Wenzhao Hu, *Reverse engineering Linear's sync engine* (secondary): https://github.com/wzhudev/reverse-linear-sync-engine

**Web platform (MDN, Chrome, WebKit, caniuse)**
- SubtleCrypto.deriveKey: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey
- AesGcmParams: https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams
- CryptoKey: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey
- Structured clone algorithm: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
- Using IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- IDBDatabase.transaction (durability): https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
- StorageManager.persist: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- visibilitychange: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
- Page Lifecycle API (Chrome): https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Network Information API: https://developer.mozilla.org/en-US/docs/Web/API/Network_Information_API · support: https://caniuse.com/netinfo
- Compression Streams API: https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API
- RequestInit (keepalive 64 KiB): https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- Web Locks API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- WebKit, *Updates to Storage Policy*: https://webkit.org/blog/14403/updates-to-storage-policy/

**Security**
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- NIST SP 800-38D (GCM): https://csrc.nist.gov/pubs/sp/800/38/d/final
- Python `secrets`: https://docs.python.org/3/library/secrets.html

**Backend and ops**
- Python `http.server`: https://docs.python.org/3/library/http.server.html
- SQLite WAL: https://www.sqlite.org/wal.html
- Caddy `encode`: https://caddyserver.com/docs/caddyfile/directives/encode
- Caddy `request_body`: https://caddyserver.com/docs/caddyfile/directives/request_body
- mholt/caddy-ratelimit: https://github.com/mholt/caddy-ratelimit
- systemd.resource-control: https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html

**Libraries and sizes**
- idb-keyval README: https://github.com/jakearchibald/idb-keyval · custom stores: https://github.com/jakearchibald/idb-keyval/blob/main/custom-stores.md
- bundlephobia: [chrono-node](https://bundlephobia.com/package/chrono-node), [rrule](https://bundlephobia.com/package/rrule), [idb-keyval](https://bundlephobia.com/package/idb-keyval), [idb](https://bundlephobia.com/package/idb), [fractional-indexing](https://bundlephobia.com/package/fractional-indexing), [yjs](https://bundlephobia.com/package/yjs), [@automerge/automerge](https://bundlephobia.com/package/@automerge/automerge), [loro-crdt](https://bundlephobia.com/package/loro-crdt), [hash-wasm](https://bundlephobia.com/package/hash-wasm)
- RFC 5545 §3.3.10 (RRULE): https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10

---

## Architecture we recommend

```
 ┌──────────── Device (phone / MacBook) ─────────────┐            ┌──── Oracle VM ─────────────────────┐
 │ UI (vanilla JS, keyboard-first outliner)          │            │ Caddy (shared, TLS, zstd/gzip,     │
 │   │ commands → undo/redo stacks (field patches)   │            │   2 MB body cap)                   │
 │   ▼                                               │   HTTPS    │   ├─ /        → static PWA files   │
 │ In-memory store: Map<id,record>, childrenByParent,│  1 POST    │   └─ /api/*   → lists-sync:8787    │
 │   due buckets, effectiveParents() (cycle repair)  │ ◀────────▶ │ lists-sync (Python stdlib, ~23 MB) │
 │   │ 300 ms batch + flush on hidden/pagehide       │ ciphertext │   SQLite WAL: changes(seq,rid,ver, │
 │   ▼                                               │   only     │     dev,blob) · devices · vaults   │
 │ IndexedDB: nodes · outbox · meta(cursor,hlc,key)  │            │   stores SHA-256(authToken) only   │
 │ Sync agent: good link && stale (or manual)        │            └────────────────────────────────────┘
 │   → AES-GCM(encKey) per record, gzip, push+pull   │
 └───────────────────────────────────────────────────┘
```

1. **Model:** a flat adjacency list. Every list and item is a record `{id, f:{field:[value, hlc]}}`, and `pos = {parent, key, prev}` is one register with a Greenspan fractional key. Children are sorted by `(key, id)`. The whole tree lives in memory, and rendering flattens only the expanded subtrees.
2. **Merge:** state-based per-field LWW on HLC stamps. Tombstone deletes apply only to the subtree root. A deterministic `effectiveParents()` repairs concurrent cycles: the later move loses, then the node falls back to its previous parent, then to Inbox. The losing `notes` text is preserved. Upgrade to Kleppmann's move-op log only if this becomes multi-user.
3. **Sync:** opportunistic and pull-based. It runs when there is a good link (Network Information API on Android, measured RTT elsewhere) and the copy is stale (2 min for pushes, 15 min for pulls), or on demand. One `POST /api/sync` per page carries push and pull. Server seq cursors, idempotent `UNIQUE(rid, ver)` inserts, server-side compaction of superseded versions, and pages of 500 rows or 512 KB keep it bounded. No sockets.
4. **Security:** a 256-bit pairing key. HKDF derives an auth token (the server keeps only its SHA-256, compared in constant time) and a non-extractable AES-GCM-256 key, with a 96-bit random IV and `id|ver` as AAD. Same origin, so no CORS. In-app 429 after repeated auth failures, body caps in Caddy and in the app, `no-store`, and the service worker never caches `/api`.
5. **Undo/redo:** command objects of field patches. An undo is a fresh, synced write that skips fields changed remotely. Stacks are per device and checked against Figma's undo-redo invariant.
6. **Persistence:** IndexedDB (`nodes`, `outbox`, `meta`) behind about 40 lines of wrapper. Writes are batched every 300 ms in one atomic transaction, flushed with `commit()` on `visibilitychange:hidden` and `pagehide`, and the app requests `storage.persist()`.
7. **Dates:** a hand-rolled English parser and an RFC 5545 RRULE subset. A recurring item is one record that advances on completion, and dates are floating local dates. This saves about 60 KB gzip compared with chrono-node plus rrule.
8. **Backend:** `sync_server.py` (stdlib, about 180 lines, tested here) in a `python:3.12-alpine` container on `n8n_default`, limited to 64 MB, with its data in a named volume rather than under `/home/ubuntu/sites`, proxied by the existing Caddy using the block in §8.4.

**Client JS cost for the whole sync and persistence layer** (HLC, merge, cycle repair, IndexedDB wrapper, crypto glue, sync agent, fractional index): about 6–8 KB gzip by our estimate, with no third-party runtime dependencies. That leaves most of the 50 KB budget for the UI.
