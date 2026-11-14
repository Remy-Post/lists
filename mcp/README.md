# lists-mcp — the Claude & Grok connector

One remote MCP server at `https://lists.remypost.me/mcp` that lets Claude (every surface) and Grok Bot read
and change Lists. It is **one more paired sync device**: it holds the vault key while connected, keeps a
replica of the vault in the app's own store, and pushes edits through the app's own `sync.js`. What to build
and why: `docs/MCP-PLAN.md` (§10 overrides §4–§8); attacks it answers: `docs/audits/06-mcp-plan-redteam.md`.

```
Claude ─┐                                   ┌─ lists-sync:8787 (ciphertext vault, unchanged)
Grok ───┼─ HTTPS /mcp ── Caddy ── lists-mcp:8788
App ────┴─ /mcp-admin/* ──┘          (/data: key, owner, replica.bin, graveyard.bin, audit.jsonl)
```

## Files

| File | What it does |
|---|---|
| `server.mjs` | `node:http` front end: Host/Origin checks, client IP (X-Real-IP only from Caddy), rate and concurrency limits, body size and nesting, listen-stream lifetime, audit line, then the SDK (`createMcpHandler` + `toNodeHandler`) or the admin endpoints |
| `bridge.mjs` | The replica: the app's store/ops/actions/sync loaded unchanged (matchMedia shim, then a dynamic import), the db adapter, the 20/min lists-sync budget, atomic persistence, connect / disconnect / vault-gone |
| `tools.mjs` | The 16 tools, result format, pagination, undo ids, growth caps |
| `guard.mjs` | Id and destination resolvers, depth cap, date/time/zone/repeat formats, the field allowlist |
| `sanitize.mjs` | Strips invisible characters from text in results and in text written through the connector |
| `limits.mjs` | Every limit in one table, plus the token bucket and counters |
| `persist.mjs` | `/data` files, AES-GCM, atomic writes, the graveyard |
| `audit.mjs` | `/data/audit.jsonl` (request metadata only), rotated 1 MB × 3 |
| `graveyard.mjs` | Operator tool: list or export what delete_forever / empty_trash erased (30 days) |
| `test/*.test.mjs` | End-to-end suites against the real lists-sync and the real bridge process |

## Deploy

From the repo root on the VM:

```sh
docker compose -f deploy/docker-compose.mcp.yml up -d --build     # lists-mcp on n8n_default, no host port
deploy/install-caddy.sh                                            # the (lists) snippet with /mcp, /mcp-admin/*
```

The snippet in `deploy/caddy.lists.conf` adds, before the catch-all: `handle /mcp` (exact path, 256 KB body,
no `encode`), `handle /mcp-admin/*` (4 KB body), both with `header_up X-Real-IP {remote_host}`, and a 404 for
`/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*` and
`/.well-known/openid-configuration*`, so Claude's auth probe sees an authless server instead of `index.html`.

Checks after a deploy (public URL):

```sh
curl -s https://lists.remypost.me/mcp-admin/status            # {"connected":…,"lastSync":…,"url":…}
curl -s -o /dev/null -w '%{http_code}\n' https://lists.remypost.me/.well-known/oauth-protected-resource   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://lists.remypost.me/mcp                                   # 405 (GET)
```

## Owner pin

**Required.** `deploy/docker-compose.mcp.yml` refuses to start until `LISTS_MCP_OWNER_SHA256` is set: without
a pin, anyone who opens the public app before Remy (or after a vault erase) could turn on backup, connect, and
own the connector. The value is `sha256(token)` of Remy's vault, not a secret; every other vault gets the same 403
as a wrong code. Read it from the vault already in `lists.db` (the sync server stores the same digest):

```sh
docker run --rm -v lists_sync_data:/d:ro alpine sh -c \
  "apk add -q sqlite && sqlite3 /d/lists.db 'SELECT lower(hex(token_sha256)) FROM vaults'"
```

Export it as `LISTS_MCP_OWNER_SHA256` (or hard-code it in `deploy/docker-compose.mcp.yml`) and recreate the
container. The env value wins over `/data/owner` and is never copied to disk. Run outside that compose file
without the env value, the bridge logs a warning and the first vault that connects is pinned in `/data/owner`
(disconnect keeps it).

**Re-pin** (Remy reset his vault or started a new account, so Settings says Claude & Grok is linked to a
different Lists account): change the env value and recreate the container, then Connect again in Settings.
Without an env value: `docker exec lists-mcp rm /data/owner` and restart `lists-mcp`. A vault that is erased on
the server (lists-sync answers 401) releases `/data/owner`, but never the env pin.

## Admin endpoints (the app's Settings → Claude & Grok)

Same origin as the app, JSON in and out, no cookies, no CORS. They run one at a time. `code` is the pairing code as `sync.pairingCode()`
returns it, `tz` an IANA zone.

| Request | Answers |
|---|---|
| `POST /mcp-admin/connect {code, tz}` | 200 `{connected:true, url, tz}` · 400 bad code or zone · 403 another account (same for a wrong code) · 502 sync unreachable |
| `POST /mcp-admin/disconnect {code}` | 200 `{connected:false}` then the process exits (when it was connected; a repeat only wipes) · 403 |
| `POST /mcp-admin/tz {code, tz}` | 200 `{tz}` · 400 · 403 |
| `GET /mcp-admin/status` | 200 `{connected, lastSync, url}` |

**The off switch** stops sync, deletes `key`, `replica.bin` and `graveyard.bin`, fsyncs, answers, and exits;
`restart: unless-stopped` brings the process back with empty memory. While disconnected `/mcp` still answers
200: `tools/list` works and every `tools/call` says "Lists isn't connected; turn it on in Settings".

**What the server can read.** While connected, the key sits on the volume (0600) so the connector keeps working
when every device is off — Remy's choice. The replica and graveyard are encrypted with a key derived from it, so
a disk image taken while connected gives full access to the vault. Disconnect does not rotate the key: after a
suspected exposure, unpair with erase and pair again with a new code.

## Tools

Read (`readOnlyHint`, `_meta["anthropic/maxResultSizeChars"]: 100000`): `get_overview`, `list_items`
(today, upcoming, inbox, someday, logbook, trash, list), `search_items`, `get_item`. Write: `add_items`,
`create_list`, `update_items`, `append_notes`, `move_items`, `complete_items`, `reopen_items`, `trash_items`,
`restore_items`, `delete_forever`, `empty_trash`, `undo`. All `openWorldHint:false`; every write states
`readOnlyHint:false` and `destructiveHint`.

- Every result is one fixed sentence (item text is user data; `via_connector:true` marks text last written
  through this open connector), a newline, then JSON. Text is sanitized; `hidden_chars_removed` counts what was
  stripped. Pages default to 50 items, at most 200, and stop near 100 000 characters with `next_cursor`.
- Ids are checked before any verb runs (exists, not `root`/`inbox`, not deleted forever, not a logbook entry for
  edits); one bad id refuses the whole batch with a reason per id. Fields come from an allowlist.
- `complete_items` only completes open items (never reopens). Repeating items take `expected_when` (returned by
  reads), so a retry reports `already_completed` instead of skipping an occurrence. `reopen_items` only reopens.
- `delete_forever` takes only items already in Trash; it and `empty_trash` first copy the full records to the
  graveyard (30 days, 5 MB; when full, permanent deletes are refused rather than dropping older entries).
  `empty_trash` checks that Trash is empty afterwards and reports an error if not.
- `list_items` with `parent_id` on today, upcoming, someday, logbook or trash keeps only items inside that list
  or item. Every input schema is strict: an unknown argument is refused, never silently dropped.
- Write tools (and `undo`) run one at a time. A write whose push is refused (vault full) is undone and says
  "Nothing was changed"; repeating items completed count as creates (their logbook copy) against the caps.
- Every write returns `undo_id`; `undo {undo_id}` only undoes the newest change. History (200 steps) is lost on
  restart.

## Limits (all in `limits.mjs`)

Per IP (an IPv6 client per /64) 120 requests/min, 600/min in total; at most 3 open requests per IP and 32 in
total, bodies still uploading included (a body must arrive within 5 s, else 408); 16 listen streams
(a new one evicts its IP's oldest past 4, and the oldest overall), each closed after 10 minutes, keepalive
25 s. Body 256 KiB, JSON nesting 160, no JSON-RPC batches, 100 nodes per write, depth 64, title 500, notes 20 000, 20 tags × 64.
1 000 creates and 2 MB of new text per rolling hour across all callers; creates refused above
max(2 × the replica at connect, 20 000) records or with 2 000 records waiting to push. The bridge spends at most
20 lists-sync requests per minute (the vault's 60 is shared with Remy's devices): an empty bucket answers like a
429 inside the fetch `createSync` uses, so writes reply `pushed:false` at once and a 5 s timer pushes later.
Claude's traffic comes from one Anthropic range, so for Claude the per-IP limits are in effect one shared bucket;
the global caps and the sync budget are the real guards.

## Persistence

`replica.bin` holds `{records, cursor, outbox, dev, hlc, meta, baseline, clean}` and is written atomically (tmp,
fsync, rename, fsync dir) after every write and before its push, and with the cursor after each pull page. A
fresh `d_mcp…` device id and HLC suffix are made on connect, after a server reset, and whenever the file is
missing, corrupt or not cleanly closed, so rows the bridge pushed before a crash come back as foreign rows and
merge instead of being compacted away. A clean stop (SIGTERM) keeps the id.

## Logs

`/data/audit.jsonl`: time, request id, IP, user agent, MCP client name/version, JSON-RPC method, tool, the ids
it touched, counts, status. Never arguments, results, item text, the code or the token. Refusals (429/503) are
summed per IP and minute. stdout carries only start-up lines and error names (never error messages, which could
echo input). Grok Bot shows up as UA `Cursor/1.0.0` using the legacy flow (`initialize`, a GET answered 405);
Claude as `Claude-User` on the 2026-07-28 flow (`server/discover`, `subscriptions/listen`).

## Graveyard restore

```sh
docker exec lists-mcp node graveyard.mjs list
docker exec lists-mcp node graveyard.mjs export 0 > restore.json
```

In the app: Settings → Restore from backup… with `restore.json`. The records come back in Trash.

## Tests

```sh
cd mcp && npm ci && npm test        # node --test --test-concurrency=1 test/  (needs python3 for lists-sync)
```

Each suite starts the real `server/sync_server.py` on a free port with a temp database and the real bridge
process with a temp `/data`; "device A" is the app's own store and sync in the test process.
`LISTS_MCP_TEST_LIMITS` (JSON) shrinks limits for the tests only.
