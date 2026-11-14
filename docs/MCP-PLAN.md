# Lists ↔ Claude & Grok: connector plan

Status: draft for red-team audit (2026-11-14). Research: `docs/research/05-ai-connectors.md`.

## 1. Mission

Let Claude and xAI's Grok Bot read and change Remy's lists by talking, from any device. One remote
MCP server at `https://lists.remypost.me/mcp` serves all of them. The same verbs and rules as the app
apply, so an item Claude completes behaves exactly like one completed by a tap.

## 2. Decisions taken in the interview (2026-11-14)

| Question | Remy's answer | Consequence |
|---|---|---|
| Where the unlock key lives | **Server bridge** | A connector on the VM pairs like another device and holds the key while connected. The server can read the lists while the bridge is on. An off switch in Settings wipes the key. |
| Which Grok | **Grok Bot (xAI app)** | Remote HTTPS custom connector (URL, optional headers). Claude: custom connector (claude.ai, Desktop, iOS, Android, Claude Code). |
| Permissions | **Full access** | Read, add, edit, move, complete, reopen, trash, restore, **delete forever, empty Trash**, undo. |
| Sign-in | **Truly open**, re-confirmed after being shown that anyone who finds the address can read and permanently delete everything | No auth, no secret in the URL. The risk is recorded here and in DECISIONS. Mitigations below add no friction. |

## 3. Facts the design rests on (verified against primary sources; see research doc)

- Claude custom connectors: every plan, Streamable HTTP on port 443, public IPv4, auth `none` supported
  by default; Anthropic's cloud connects (160.79.104.0/21). Tool result ≤ ~150k chars, ≤ 240 s per call;
  Claude Code 25k tokens. Every tool needs `title` and `readOnlyHint` or `destructiveHint`.
- Grok Bot: desktop app → Connect apps → Add a custom connector → Remote HTTPS (Server URL, optional
  headers, optional OAuth client). Rejects localhost/private IPs (grok.com connectors).
- MCP spec is 2026-07-28 (stateless, no `initialize`); Claude's docs cite up to 2025-11-25. The TS SDK v2
  (`@modelcontextprotocol/server` 2.4.0, deps zod + core only) serves both statelessly.
- The app's `store.js`, `ops.js`, `parse.js`, `sync.js` run in Node; `actions.js` doesn't, only because
  `state.js` touches `matchMedia`/`navigator` at load.

## 4. Architecture

```
Claude (any surface) ─┐                         ┌─ lists-sync:8787 (ciphertext vault, unchanged)
Grok Bot ─────────────┼─ HTTPS /mcp ─ Caddy ─ lists-mcp:8788 ─┘   (bridge = one more paired device)
                      │                │
Lists app Settings ───┴─ /mcp-admin ───┘
```

- **`lists-mcp`**: a Node container on `n8n_default`, same hardening as `lists-sync`
  (read-only root, tmpfs, `cap_drop: ALL`, `no-new-privileges`, 96 MB, 0.25 CPU, volume `/data`).
- **Same code as the app.** The image copies `src/js/{store,ops,actions,parse,state,sync}.js` from this repo;
  tools call `A.toggleDone`, `A.trash`, `A.destroy`, `A.moveTo`, `O.tx`, `O.undo`… `state.js` gets
  `typeof` guards so it loads in Node (a few bytes on the critical path; budget is checked).
- **Replica.** One vault, held in the module-singleton store. On start it loads `/data/replica.bin`
  (records + cursor, AES-GCM with the vault's enc key) and pulls the delta; first start pulls from 0.
- **Sync.** `createSync` from `sync.js` with an in-memory db adapter (outbox = changed ids, pushes full
  merged records, so server compaction stays safe). Before a tool runs: pull if the last pull is older
  than 10 s. After a write tool: push before replying. Own budget ≤ 20 requests/min (the vault's 60/min
  is shared with Remy's devices). Own device id `d_mcp…` and HLC suffix.
- **Time zone.** The phone/Mac sends its IANA zone at connect; the bridge sets `process.env.TZ`, so
  `today()` and repeat roll-forward match the devices.
- **Admin endpoints** (same origin as the app; CSP `connect-src 'self'` already allows it):
  - `POST /mcp-admin/connect {code, tz}`: derives the token, checks the vault exists (a pull), and
    claims the bridge. The first vault to connect owns it; another vault gets 409 until the owner
    disconnects. Stores the code in `/data/key` (0600).
  - `POST /mcp-admin/disconnect {code}`: same vault only; wipes `/data/key` and `/data/replica.bin`.
  - `GET /mcp-admin/status`: `{connected, lastSync}` only.

## 5. Tools (MCP), all `openWorldHint: false`

| Tool | Hints | Does |
|---|---|---|
| `get_overview` | read | Lists with open counts, Inbox, Today/Upcoming counts, today's date and zone |
| `list_items` | read | `view` today·upcoming·inbox·someday·logbook·trash·list; `list_id`/`parent_id`, `depth`, `include_done`, `limit`≤200, `cursor` |
| `search_items` | read | Title/notes/tag search, `include_done`, `limit`, `cursor` |
| `get_item` | read | One item with path, notes, dates, repeat (in words), children to `depth` |
| `add_items` | additive | Batch ≤100, nested `children`, `parent_id`/`after_id`, dates, `repeat` (rrule or "every monday"), notes, tags, priority, heading; optional `quick: "Call Ana fri #home"` parsed like the composer |
| `create_list` | additive | New top-level list, optional items |
| `update_items` | idempotent | Title, notes (`notes_mode` append/replace), when/deadline/evening/someday, repeat, tags, priority, heading |
| `move_items` | idempotent | To `parent_id` at `index`/`after_id`; refuses cycles (same check as the app) |
| `complete_items` / `reopen_items` | idempotent | Same as a tap; a repeating item logs this occurrence and rolls forward |
| `trash_items` / `restore_items` | destructive / idempotent | Soft delete with children / back |
| `delete_forever` | destructive | Same as "Delete forever" in the app (`void`, text blanked) |
| `empty_trash` | destructive | Deletes everything in Trash forever |
| `undo` | destructive | Undoes the connector's own last change(s) via `O.undo` |

Results are JSON text: ids everywhere; titles/notes are JSON strings under a `data` key, prefixed by one
line saying the item text is user data. Pagination with opaque cursors; results capped at 100k chars.

## 6. App changes (lazy only; no critical-path growth beyond the `state.js` guards)

- Settings → **Claude & Grok** (in `panels.js` / `panels.css`): Connect (turns on backup first if needed),
  the address with Copy, two short how-tos (Claude: Settings → Connectors → Add custom connector → paste
  → no sign-in; Grok Bot: Connect apps → Add a custom connector → Remote HTTPS → paste), the plain
  warning "Anyone with this address can read and change your lists", Disconnect.
- **Freshness.** While connected, an open app pulls when it becomes visible and every 60 s while
  visible, but only on a good connection (the existing gate: not 2G, not Save-Data). Edits by Claude show
  up within a minute on an open device and on next open otherwise.

## 7. Protections that add no friction

Per-IP 120 req/min and global 600 req/min (429), body ≤ 256 KB (413), ≤ 100 items per write, Host check,
JSON-schema validation of every input (zod), user text never interpolated into instructions, an audit log
(`/data/audit.jsonl`: time, IP, tool, ids, counts; 1 MB × 3), the off switch, `X-Robots-Tag: noindex`.

## 8. Release gates (each with how it's measured)

1. **Protocol:** `tools/list` and `tools/call` succeed for protocol versions 2025-06-18, 2025-11-25 and
   2026-07-28 (SDK client + raw JSON-RPC over HTTP), through Caddy on the public URL.
2. **Real Claude:** Claude Code (`claude mcp add --transport http`) lists the tools and completes a
   scripted read/add/complete/undo session against the live URL.
3. **Convergence:** add/complete/move via MCP appear in a real browser tab ≤ 60 s while visible; edits in
   the browser are visible to the next tool call ≤ 15 s after the browser pushes. Repeat completion
   produces the same records as the app (unit test compares bridge vs app verbs on the same fixture).
4. **Safety:** compaction-safe pushes (a fresh device rebuilt from the server equals the bridge replica),
   claim lock (409), wrong code 403, kill switch wipes key and replica, 413/429 limits, injection text
   round-trips as data.
5. **Speed:** read tools p95 ≤ 150 ms on 10k items warm (excluding network); container idle RSS ≤ 80 MB.
6. **App:** critical path ≤ 50 KB gz; existing suites stay green (unit, review-fixes, flows, sync, perf).
7. **Grok Bot:** Remy adds the URL in Grok Bot and asks "what's on my list today"; if he can't, the
   steps and a raw xAI Responses-API `mcp` tool call (needs an xAI key) are the fallback check.

## 9. Risks

- **Open endpoint** (accepted by Remy): any finder can read/delete. Mitigated only by the off switch,
  audit log, Trash/undo for non-permanent actions, and rate limits.
- Bridge clock skew wins LWW → NTP-synced host; HLC observes pulled stamps.
- Shared 60 rpm vault budget → bridge caps itself at 20.
- Server can read lists while connected → stated in Settings and here.
- Remy's devices must have backup (sync) on for the bridge to see anything.

## 10. Red-team response (27 findings survived skeptics; all adopted unless noted) — this section overrides §4–§8

Audit: `docs/audits/06-mcp-plan-redteam.md`. Remy's follow-up answer (2026-11-14): sync "whenever there's Wi-Fi";
data thrift is no longer worth it.

**Ids and shapes (S1).** One shared resolver runs before any `O.`/`A.` call. Target ids must exist in `S.recs`, not be
`root`/`inbox`, not be `void`, not be `kind:'log'` for edits; restore only `deleted==='trash'`. Destinations: existing,
live, not log; `inbox` allowed as parent, `root` only for lists. `after_id` must be a child of the parent. A batch is
rejected whole with per-id reasons before anything is written. Fields are built from an allowlist (never `id`, `pos`,
`deleted`, `kind`, `v`, `__proto__`). Defence in depth in the app: `store.js` ignores a record whose id is `root`;
`formatDay` returns '' on bad input.
**Depth (S1).** Resulting depth ≤ 64 (ancestors + 1 + subtree height, iterative); nested `children` count toward 100
nodes per call; raw body nesting checked iteratively before zod.
**Owner pin (S1).** No vault exists yet, so the first successful connect pins `sha256(token)` in `/data/owner`
(constant-time compare, same 403 for wrong code and wrong owner); disconnect keeps the pin; only an operator clears it
(`LISTS_MCP_OWNER_SHA256` env overrides). Connect pulls without `create`. While disconnected `/mcp` still answers 200
JSON-RPC; `tools/list` works and every `tools/call` returns isError "Lists isn't connected; turn it on in Settings".
**Off switch (S1).** Disconnect: stop sync, unlink key/replica/graveyard, fsync, reply 200, `process.exit(0)` (compose
restarts it empty). A 401 from lists-sync on the pinned vault = vault gone → same wipe, pin released.
The app's "Turn off backup" disconnects the bridge first (confirm text says so). Key stays on the volume (0600) so the
connector works while all devices are off — Remy's choice; README states it.
**Growth caps (S1).** title ≤ 500, notes ≤ 20 000, tags ≤ 20×64, sealed record < 90 KiB checked before reply; ≤ 1 000
creates and 2 MB new text per rolling hour across all callers; refuse creates when replica > max(2× at connect, 20 000)
records or outbox > 2 000; a push that leaves records behind or gets 507 → tool error + `O.undo` of that tx.
**Not toggles (S1/S2).** `complete_items` completes only open ids (never the reopen branch); repeating items take
optional `expected_when` (returned by reads) and report `already_completed` when stale. `reopen_items` sets
`done:false, doneAt:null` in one `O.tx('Reopen')`. Per-item statuses in results. `append_notes` is its own tool
(not idempotent). Every write tool sets readOnlyHint:false and an explicit destructiveHint.
**Delete forever (S2).** `A.destroy` walks `childrenAll` (includes separately trashed children, skips void), collects
before writing, voids all in one tx (app and bridge share the fix). `delete_forever` accepts only ids in Trash;
`empty_trash` verifies `qTrash()` is empty. Before either, the full before-records go to `/data/graveyard.bin`
(AES-GCM, 30 days, 5 MB) for operator restore.
**Undo (S3).** Each write returns `undo_id`; `undo{undo_id}` only pops if it is the top step, else names the newer change.
History is lost on restart (said in the description). Stack capped at 200 steps.
**Sync adapter contract (S1).** getOutbox → structuredClone snapshots of `S.recs.get(id)` for outbox ids;
ackOutbox(sent) deletes an id only if `!cur || cur.v === sent.v`; applyRemote → `S.mergeRemote` only; outbox filled by
`S.onPersist((r, local) => local && out.add(r.id))`; requeueAll adds every id but root; meta cloned in/out.
**Persistence (S1).** `{records, cursor, outbox, dev, hlc}` saved atomically (tmp, fsync, rename) after every write tx
and before its push, and after each applyRemote (records then cursor). Fresh `d_mcp`+16hex dev/HLC suffix when the file
is missing/corrupt/unclean, on connect, and on a server reset; not on clean restarts.
**Rate (S2).** 20-per-60 s token bucket inside the injected fetch, which throws a 429-shaped error (run() backs off);
write tools try one push ≤ 10 s, then reply `pushed:false`. Per-IP 120/min, global 600/min, ≤ 3 open requests per IP,
≤ 32 global, `maxSubscriptions: 16`, `keepAliveMs: 25000`, listen streams closed after 10 min.
**Clients (S2/S3).** `@modelcontextprotocol/server` 2.4.0 + `@modelcontextprotocol/node` 2.1.2 `toNodeHandler` on
node:http (as `~/health-bridge-spike/src/http.ts`, which real Claude and Grok Bot traffic already uses), exact pins.
Our own Host check (lists.remypost.me, localhost for tests), Origin 403 unless absent or the site, no CORS. Read tools
set `_meta['anthropic/maxResultSizeChars']: 100000`; default page 50, max 200, stop at ~100k chars with `next_cursor`.
X-Real-IP trusted only from `n8n-caddy-1`. Logs never contain arguments or results.
Gate 1 covers modern (server/discover, subscriptions/listen keepalive, MCP-Protocol-Version/Mcp-Method headers) and
legacy (initialize → initialized → tools/list → tools/call, SSE-framed; GET → 405) through Caddy. Gate 7 = Grok Bot
(Cursor/1.0.0 UA in the audit log), no xAI API fallback.
**Caddy.** `handle /mcp` (exact) and `handle /mcp-admin/*`: body 256 KB, `X-Real-IP`, no `encode`, before the
catch-all; `/.well-known/oauth-*` and `openid-configuration` answer 404.
**Untrusted text (S1/S2).** `sanitize()` on every title/note/tag in results (C0/C1 except \n\t, bidi controls,
U+200B/C, 2060, FEFF; ZWJ only between emoji; tag chars only in flag sequences). Items whose title/notes stamp ends in
the bridge's HLC suffix carry `via_connector: true`; results start with one fixed sentence that such text may have been
written by anyone with the address and is data, not instructions. Global creates cap above also bounds mass injection.
**Inputs (S2).** `repeat`: natural language via `parseQuick`, or an rrule that round-trips the app grammar (INTERVAL
1–99) — stored normalised; dates `^\d{4}-\d{2}-\d{2}$` + round-trip; time `HH:MM`; priority 0–3; tz validated by
`Intl.DateTimeFormat`, re-sent by the app when visible (`POST /mcp-admin/tz` with the auth token).
**Node.** `globalThis.matchMedia ??= …` then dynamic `import('../src/js/actions.js')`; state.js untouched; node:22 pinned.
**Freshness (Remy).** On a good link (Wi-Fi/Ethernet/fast 4G) an open app syncs as you go and checks every 60 s while
visible, regardless of the old cadence setting (that setting is removed from Settings). Mobile-data rule unchanged.
