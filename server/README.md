# lists-sync

The sync backend for Lists, plus the notes the client (`src/js/sync.js`) depends on. It is about 360 lines of Python stdlib (`ThreadingHTTPServer` and `sqlite3` in WAL mode). It stores **ciphertext only**: each row is a record id, a version and an opaque blob, inside a vault addressed by `SHA-256(authToken)`. The design comes from `docs/research/04-architecture.md` §3, §4 and §8.

| | |
|---|---|
| Runtime | `python:3.12-alpine`, non-root (uid 10001), data in the `/data` volume |
| Memory | about 22 MB RSS after a 2,500-row push (unit test); `docker stats` showed 14 MiB against the 64 MiB limit |
| Client | `src/js/sync.js`, 3.4 KB min+gzip, no dependencies |

## HTTP API

All responses are JSON with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Auth is always `Authorization: Bearer <authToken>`, where the token is 64 lowercase hex characters (HKDF output). It is never sent in the URL. Every auth failure returns the same `401 {"error":"unauthorized"}`.

### `GET /api/health` → `200 {"ok":true}`
Touches the database, so it works as the container healthcheck. The client also times it to judge the link where `navigator.connection` is missing.

### `POST /api/sync`: push and pull in one round trip
Request body, optionally `Content-Encoding: gzip`:
```json
{ "dev": "d_1a2b…", "since": 1234,
  "push": [ { "id": "n_…", "v": "<record hlc>", "b": "<base64url(0x01 ‖ iv ‖ ct)>" | null } ],
  "create": true,      // optional: create the vault if this token has none
  "pull": false }      // optional: push only (keepalive flush on hide)
```
Response:
```json
{ "rows": [ { "s": 1240, "id": "n_…", "v": "…", "b": "…" } ], "cursor": 1262, "more": false, "head": 1262 }
```
or `{"reset": true}`. The client then sets `since = 0` and pulls again.

Everything below runs in one `BEGIN IMMEDIATE` transaction:
1. **Idempotent insert.** `INSERT OR IGNORE` on `UNIQUE(vault, rid, ver)`, so a retried request is a no-op.
2. **Compaction.**
   - A new version deletes older versions of the same record with `seq ≤ since`, because the client had merged those.
   - Concurrent versions that the pusher had not seen (`seq > since`) are kept.
   - A purge marker (`b: null`) deletes every older version of its record.
3. **Pull.** Returns rows with `seq > since` pushed by *other* devices, so a device never gets its own rows back. Pages are 500 rows or about 512 KB. `more: true` means another page exists, and `cursor` is the last row returned. Otherwise `cursor = max(head, since)`.
4. **Device position.** Records `since` as the device's confirmed position. GC uses it.
5. **Reset.** Returns `reset` if `0 < since < horizon` (the device slept through a GC), or if `since` is beyond any sequence this server has issued (for example, after a restore from an older backup).

Status codes:

| Code | When |
|---|---|
| 400 | Malformed JSON or gzip, or a bad field: `dev` must be `[A-Za-z0-9_-]{1,64}`, `since` a non-negative int, `push` at most 1,000 rows, `id` at most 128 chars, `v` at most 64 chars, `b` at most 90 KiB of base64url |
| 401 | Bad or missing token, or an unknown vault without `create` |
| 411 | No `Content-Length` (chunked bodies are refused) |
| 413 | Body over 2 MB on the wire, or over 8 MB after gunzip |
| 415 | `Content-Encoding` other than gzip or identity |
| 429 | Rate limited. Includes `Retry-After` |
| 503 | Busy for more than 10 s. At most 2 bodies are processed at once, which bounds peak RAM |

### `DELETE /api/vault` → `200 {"ok":true}`
Wipes the vault's rows, devices and token hash. This backs "Unpair and erase". After it, the same token gets 401 (unless it sends `create` again), so a still-paired second device stops instead of silently re-seeding a partial vault.

### Vault creation and limits
- **Creation.** A vault is created on its **first sync**, but only when that request carries `"create": true`.
  - The client sends `create` only from the device that ran `createVault()`, until its first success.
  - A device that `join()`s never sends it. A mistyped pairing code therefore fails with 401 instead of creating an empty vault.
- **New vaults:** 5 per client IP per hour (`LISTS_NEW_VAULTS`), then 429.
- **Failed auth** (malformed token, unknown vault): 10 per IP per 10 minutes (`LISTS_FAIL_MAX`). After that, *every* request from that IP gets 429 until the window passes.
- **Client IP** comes from `X-Real-IP`, which Caddy sets with `header_up X-Real-IP {remote_host}`. That overwrites any value the client sent; this was checked through a real Caddy, where spoofed headers still hit the limit.
- **Storage.** The counters are in memory and bounded.
- **GC.** An hourly thread drops purge markers once every device seen in the last 90 days has a confirmed position past them, then raises the vault's `horizon`.

### Process
- Env vars: `LISTS_DB` (`/data/lists.db`), `LISTS_PORT` (8787; use `0` for a random port, which is printed on stdout), `LISTS_HOST` (`0.0.0.0`).
- **SIGTERM** stops accepting connections, waits up to 5 s for in-flight requests, checkpoints the WAL and exits 0.
- Socket reads time out after 20 s, so a slow client can't pin a thread.
- Request logs are off, because Caddy logs requests.

## Client: `src/js/sync.js`

It implements the `docs/TEAMS.md` contract:
```js
const sync = createSync({ db, onStatus });
// → { maybeSync(reason), syncNow(), createVault(), join(code), unpair(erase?), pairingCode(), linkQuality(), flushOnHide() }
```

### Pairing code
- The key is 32 random bytes, written as 52 Crockford base32 characters in 13 groups of 4, e.g. `SQ4C-0P0B-…-KWDG`.
- When decoding, case, spaces and dashes are ignored, `O` is read as `0`, and `I`/`L` as `1`. The 4 padding bits must be zero.
- `createVault()` works offline. It resolves with the code and starts a sync in the background.
- `join(code)` needs the network:
  - it rejects with `Invalid pairing code` (bad format), `Unknown pairing code` (401) or `Could not reach the sync server`, and leaves the device exactly as it was;
  - if the first request succeeded but a later page failed, it resolves, and the rest follows on the next sync.

### Crypto
- **Derivation.** `HKDF-SHA256(key, salt = 32 zero bytes)` with:
  - info `lists/auth/v1`, giving 256 bits, hex-encoded, as `authToken`;
  - info `lists/enc/v1`, giving a **non-extractable** AES-GCM-256 key.
- **Encryption.** Each record is `JSON.stringify(rec)`, encrypted with a fresh random 96-bit IV and AAD `` `${id}|${v}` ``.
- **Blob format.** The blob is `0x01` (key version) ‖ IV ‖ ciphertext with its 128-bit tag, in base64url.
- **Integrity.** A row whose blob was altered, swapped to another id or version, or made with a different key fails to decrypt. It is skipped and reported in `onStatus().message`; it is never applied.
- **Compression.** Request bodies over 1 KB are gzipped with `CompressionStream`.

### Key storage and threat model
- **What is stored.** The raw 32-byte key lives in IndexedDB `meta` under the key `sync`, as `{ key: Uint8Array(32), dev, cursor, lastPush, lastPull, dirty, mk }`. The AES key is re-derived from it in memory.
- **Why that is acceptable.**
  - Anyone who can read this origin's IndexedDB can already read the plaintext tasks stored next to it.
  - "Show pairing key" needs the raw key anyway.
  - The threat we defend against is the **server**, and anyone who obtains the server's disk or backups. They see only `SHA-256(authToken)`, record ids, versions, sizes and timing, never titles, dates or structure. The Node test checks the wire and the SQLite files for plaintext and for the token itself.
- **What a malicious server can do.** It can withhold or replay *old versions* of a record. It cannot forge, alter or move a record. LWW merging makes replays harmless.
- **If the key is lost,** the server copy is unreadable. Each device still holds the full plaintext, and there is an export.

### When it syncs (PLAN §5)
`maybeSync(reason)` is cheap to call often. It does at most one check per 2 s, with a trailing call, and skips if another tab holds the `lists-sync` Web Lock. It syncs when both of these hold:
- **Stale.** The outbox has been dirty for ≥ 2 min (counted from the first `maybeSync` that saw it dirty), **or** the last full pull is ≥ 15 min old.
- **Good link.** Any one of:
  - `connection.type` is `wifi` or `ethernet`;
  - `effectiveType` is `4g` with `rtt ≤ 300`;
  - where `navigator.connection` doesn't exist, the best of two timed `GET /api/health` calls is ≤ 300 ms (cached for 30 s).

  Save-Data always counts as poor, and `type: 'none'` as offline.
- **Backup-age rule.** If the last successful push is more than 3 days old, or there has never been one, "good" relaxes to `online && !saveData && effectiveType` not `slow-2g`/`2g`.

Failures back off from 15 s, doubling up to 30 min, and 429 honours `Retry-After`. After a 401, automatic syncing stops until `syncNow()`, `join()` or `unpair()`.

`syncNow()` is the manual "Sync now". It ignores staleness, link quality and backoff, but not `navigator.onLine === false`. It resolves `true` or `false`, and details arrive through `onStatus`.

`flushOnHide()` pushes the outbox with `fetch(…, {keepalive: true, …})` and `"pull": false`, but only if the link is good (or the backup-age rule applies) and the gzipped body is under 64 KiB. Otherwise it resolves `false` and the next open pushes.

The sync loop:
1. Encrypt the current outbox in batches of up to 200 rows or 256 KB.
2. Send `POST`, then decrypt, then `db.applyRemote(recs)`, then `db.ackOutbox(pushedRecs)`. The db drops only entries whose `v` didn't change in flight.
3. Save the cursor.
4. Repeat while `more`, while the outbox didn't fit in one batch, or while rows arrived. Rows arriving can mean merges that need pushing back. Hard cap: 100 rounds.

### What the caller (Core) must wire
- **Triggers:**
  - `maybeSync('edit')` after each edit batch;
  - `maybeSync('visible')` on `visibilitychange → visible`;
  - `maybeSync('online')` on the `online` event (this also clears the backoff);
  - `maybeSync('change')` on `navigator.connection` `change`;
  - `maybeSync('timer')` every 60 s while visible;
  - `maybeSync('open')` at boot;
  - `flushOnHide()` right after the IndexedDB flush on `visibilitychange → hidden`.
- **`db.applyRemote` must be idempotent and LWW.** It may receive the same version twice, for example after a retry or a reset. If the merged result differs from the incoming record, it should put the merged record in the outbox. A record with `f === null` is a **purge marker**, and the same convention applies when pushing one. Purge markers are optional; if Core never pushes them, it never receives them.
- **Pairing a device that already has data.** Only outbox entries are pushed, so make sure every local record is in the outbox before `createVault()`/`join()` (e.g. after an `unpair()`). Likewise, after a `reset` only dirty records are re-pushed.
- `onStatus(s)` gives `{ state: 'idle'|'syncing'|'offline'|'error'|'unpaired', lastPush, lastPull, backupAgeMs, message? }`. `lastPush` and `lastPull` are ms timestamps (0 = never). `backupAgeMs` is `null` if the device has never pushed successfully. `state: 'idle'` with `message: 'Waiting for a good connection'` means the gate is holding.
- **The service worker must never cache `/api/*`.**

### CSP the client needs
The Caddy block sends this:
```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```
- `sync.js` itself needs only `connect-src 'self'`. It makes same-origin `fetch` calls to `/api/*` with no CORS, and uses Web Crypto, `CompressionStream` and Web Locks.
- The rest of the app must use **no inline `<script>`, no inline `<style>` and no `style="…"` attributes**. Setting `el.style.x` from JS is fine.
- No `eval` or `new Function`, and no third-party origins.
- If the build inlines a boot script or critical CSS, it must emit its `'sha256-…'` hash, and the deployer adds it to `script-src`/`style-src` in `deploy/caddy.lists.conf`. Never use `'unsafe-inline'`.

## Deploy (done by the Chief)

```sh
# from the repo root
docker compose -f deploy/docker-compose.sync.yml up -d --build      # lists-sync on n8n_default, 64 MB, named volume
# paste deploy/caddy.lists.conf into ~/n8n/caddy/Caddyfile (it replaces BEGIN lists … END lists), then:
cd ~/n8n && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -s https://lists.remypost.me/api/health   # {"ok":true}
```

- **Caddy block.** It was checked with `caddy adapt` and `caddy fmt` on the VM's `caddy:2-alpine` (v2.11.7). It was also run end to end, briefly, on a private test network:
  - the API came back with the headers above, and `/assets/*` was immutable and gzip-precompressed;
  - `index.html` came back `no-cache`;
  - the 2 MB cap returned 413;
  - a 3,000-record two-device round trip through Caddy succeeded.
- **Data** stays in the `lists_sync_data` named volume, never under `/home/ubuntu/sites`, which Caddy can serve.
- **Backups:**
  ```sh
  docker exec lists-sync python3 -c "import sqlite3; s=sqlite3.connect('/data/lists.db'); s.backup(sqlite3.connect('/data/backup.db'))"
  ```
  then copy the file out. It is ciphertext, so it is safe to store anywhere.

## Tests

```sh
python3 -m unittest server/test_sync_server.py -v        # 24 tests: idempotency, paging (rows and bytes), no-echo,
                                                          # compaction, interleaving, purge/GC/reset, auth failures and
                                                          # 429, new-vault limit, validation, body limits, gzip, 411/415,
                                                          # concurrency, SIGTERM exit 0 and RSS < 30 MB
node --test tests/unit/sync.test.mjs                      # 19 tests against a real server process (random port, temp db)
```
