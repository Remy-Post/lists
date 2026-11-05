# lists-sync

The sync backend for Lists, plus the notes the client (`src/js/sync.js`) depends on. It is about 540 lines of Python stdlib (`ThreadingHTTPServer` and `sqlite3` in WAL mode). It stores **ciphertext only**: each row is a record id, a version and an opaque blob, inside a vault addressed by `SHA-256(authToken)`. The design comes from `docs/research/04-architecture.md` §3, §4 and §8.

| | |
|---|---|
| Runtime | `python:3.12-alpine`, non-root (uid 10001), data in the `/data` volume |
| Memory | 22–23 MB RSS typical (unit test, after a 2,500-row push). Worst case measured under a hostile load (4 clients pushing 2 MB-inflated bodies non-stop plus 3 sending gzip bombs): about 40 MB peak, against the 64 MiB limit. A gzip bomb from an unknown token costs < 1 MB (unit test) |
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
5. **Reset.** Returns `reset` if `0 < since < horizon` (the device slept through a GC), or if `since` is beyond the last sequence this vault has issued (for example, after a restore from an older backup).

**Sequences are per vault.** `seq`, `cursor` and `head` count only this vault's pushes (`vaults.next_seq`, bumped inside the transaction), so they say nothing about other users' activity. `head` is the last seq this vault issued, even if that row has since been compacted away.

Status codes:

| Code | When |
|---|---|
| 400 | Malformed JSON or gzip, or a bad field: `dev` must be `[A-Za-z0-9_-]{1,64}`, `since` a non-negative int, `push` at most 1,000 rows, `id` at most 128 chars, `v` at most 64 chars, `b` at most 90 KiB of unpadded base64url (`[A-Za-z0-9_-]`) |
| 401 | Bad or missing token, or an unknown vault without a well-formed `create` (any body problem on an unknown token is a 401 too) |
| 411 | No `Content-Length` (chunked bodies are refused) |
| 413 | Body over 512 KB on the wire, or over 2 MB after gunzip (known vaults; the client sends ≤ ~260 KB) |
| 415 | `Content-Encoding` other than gzip or identity |
| 429 | Rate limited (see below). Includes `Retry-After` |
| 503 | No body slot free within 2 s. Includes `Retry-After: 2` |
| 507 | `{"error":"vault full"}`: the push would take the vault over its quota (the whole push is rolled back). `{"error":"server full"}`: the database is over the disk guard; pushes and new vaults are refused, pulls still work |

### `DELETE /api/vault` → `200 {"ok":true}`
Wipes the vault's rows, devices and token hash. This backs "Unpair and erase". After it, the same token gets 401 (unless it sends `create` again), so a still-paired second device stops instead of silently re-seeding a partial vault.

### Vault creation and limits
- **Order of work.** The bearer token is checked and its vault looked up (`SHA-256` → indexed read) **before any byte of the body is read**. What happens next depends on the answer:
  - **Known vault:** served whatever the IP's failure count (a 256-bit token can't be guessed, so locking out an IP would only hurt its owner). It has its own budget: 60 requests per minute (`LISTS_VAULT_RPM`), then 429. The body is read into one of **2** slots (512 KB wire, 2 MB inflated).
  - **Unknown token:** 429 without reading if the IP is over its failure limit or its new-vault quota. Otherwise the body is read into a **single** separate slot (512 KB wire, **1 MB** inflated). Unless it is a well-formed `"create": true`, the answer is 401 and the IP gets a failure.
- **Body slots** are taken *before* reading, held through the reply, and never queued for more than 2 s (then 503). A whole body must arrive within 15 s, so a trickled upload gives its slot back. Unknown tokens can't starve known vaults, or the reverse. At most 64 connections are open at once; more are dropped at accept.
- **Inflate** uses `zlib.decompressobj(...).decompress(data, cap + 1)`, which stops at the cap however small the input. JSON with more than 20,000 commas is refused before parsing, so a flood of tiny values can't amplify memory.
- **Creation.** A vault is created on its **first sync**, but only when that request carries `"create": true`.
  - The client sends `create` only from the device that ran `createVault()`, until its first success.
  - A device that `join()`s never sends it. A mistyped pairing code therefore fails with 401 instead of creating an empty vault.
- **New vaults:** 5 per client IP per hour (`LISTS_NEW_VAULTS`), then 429.
- **Failed auth** (malformed token, unknown vault, or any bad body from an unknown token): 10 per IP per 10 minutes (`LISTS_FAIL_MAX`). After that the IP gets 429 for malformed and unknown tokens; known vaults are unaffected.
- **Quotas per vault:** 50 MB (`LISTS_VAULT_MB`) and 100,000 rows (`LISTS_VAULT_ROWS`), counted as `len(id)+len(v)+len(dev)+len(b)+48` per stored row in `vaults.nrows/nbytes`, kept exact inside the same transaction (compaction and GC subtract). A push that would grow a vault past either limit gets 507 and is rolled back; a push that doesn't grow it (compaction) still goes through. One user's lists are a few MB.
- **Disk guard:** if the pages in use (`page_count − freelist_count`) exceed 500 MB (`LISTS_DB_MAX_MB`), pushes and new vaults get 507 `server full`.
- **Client IP.** `X-Real-IP` is believed only when the TCP peer is in `LISTS_TRUSTED_PROXIES` (comma-separated IPs, CIDRs or hostnames; hostnames are re-resolved every 60 s). Empty, the default, trusts nobody and uses the peer address. The compose file sets `n8n-caddy-1`: n8n_default (172.18.0.0/16) also hosts other apps, which must not be able to pick their own rate-limit key. Caddy sets the header with `header_up X-Real-IP {remote_host}`, overwriting anything the client sent. IPv6 clients are keyed by /64.
- **Storage.** The rate counters are in memory and bounded.
- **GC.** An hourly thread drops purge markers once every device seen in the last 90 days has a confirmed position past them, then raises the vault's `horizon`.

### Schema migration
`PRAGMA user_version` is 2. A v1 database (one `AUTOINCREMENT` seq shared by all vaults) is migrated on start, in one transaction: every row is kept and renumbered per vault starting above the old global top, the `horizon` is set at that boundary, and quota counters are filled in. Every cursor a client still holds is then below the horizon or beyond the head, so it gets `{reset: true}` and re-pulls from 0 (the client already handles that). The live database was empty when this shipped.

### Process
- Env vars: `LISTS_DB` (`/data/lists.db`), `LISTS_PORT` (8787; use `0` for a random port, which is printed on stdout), `LISTS_HOST` (`0.0.0.0`), `LISTS_TRUSTED_PROXIES` (empty), `LISTS_FAIL_MAX` (10), `LISTS_NEW_VAULTS` (5), `LISTS_VAULT_RPM` (60), `LISTS_VAULT_MB` (50), `LISTS_VAULT_ROWS` (100000), `LISTS_DB_MAX_MB` (500).
- **SIGTERM** stops accepting connections, waits up to 5 s for in-flight requests, checkpoints the WAL and exits 0.
- Socket reads time out after 20 s, and a whole body must arrive within 15 s, so a slow client can't pin a thread or a body slot.
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
python3 -m unittest discover -s server -p 'test_*.py'    # 44 tests: idempotency, paging (rows and bytes), no-echo,
                                                          # compaction, interleaving, purge/GC/reset, auth failures and
                                                          # 429, new-vault limit, validation, body limits, gzip, 411/415,
                                                          # concurrency, SIGTERM exit 0 and RSS < 30 MB; and for the
                                                          # 2026-11-05 review: gzip bomb from an unknown token (401 in
                                                          # ms, RSS +<1 MB), no body read without quota, body slots/503,
                                                          # slow-body deadline, quotas/507 + rollback, disk guard,
                                                          # per-vault rate limit, per-vault seq, v1 migration, trusted
                                                          # proxies, valid token served while its IP is locked out
node --test tests/unit/sync.test.mjs                      # 19 tests against a real server process (random port, temp db)
```
