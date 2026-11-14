// node --test mcp/test — regression tests for the connector audit fixes (one test per S1/S2 finding, plus the
// cheap S3s): growth caps on repeating completions, one write at a time, the throw backstop, admin ops one at a
// time, idempotent disconnect, the owner pin, batches and held uploads, list_items scope, strict schemas, the
// graveyard that refuses instead of evicting, the per-minute counter under many keys, IPv6 /64 keys.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startSync, startBridge, deviceA, otherVault, cleanup, tmp, sleep, REPO } from './helpers.mjs';
import { tokenDigest, graveAppend, graveRead } from '../persist.mjs';
import { perMinute, rateKey, OVERFLOW } from '../limits.mjs';
import { buildFields } from '../guard.mjs';

let sync, dev;
before(async () => { sync = await startSync(); dev = await deviceA(sync.url); });
after(async () => { await sync.stop(); cleanup(sync.dir); });

/** A bridge connected to a fresh vault of its own. */
async function fresh(limits = {}, env = {}) {
  const v = await otherVault(sync.url);
  const b = await startBridge({ syncUrl: sync.url, limits: { pullStaleMs: 0, ...limits }, env });
  const c = b.client();
  assert.equal((await c.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
  const list = await c.tool('create_list', { title: 'L' });
  assert.equal(list.isError, false, list.text);
  return { b, c, v, list: list.json.list.id, done: async () => { await b.kill(); cleanup(b.data); } };
}
const logEntries = async (c, title) => (await c.tool('list_items', { view: 'logbook', limit: 200 })).json.items.filter((i) => i.data.title === title).length;

test('S1 complete_items on a repeating item counts its logbook copy against the creates and text caps', async () => {
  // Creates: 1 (list) + 1 (item) + 1 (first completion) = the cap; the second completion is refused.
  let f = await fresh({ createsPerHour: 3 });
  try {
    const add = await f.c.tool('add_items', { parent_id: f.list, items: [{ title: 'daily', notes: 'n'.repeat(20_000), repeat: 'every day' }] });
    assert.equal(add.isError, false, add.text);
    const id = add.json.items[0].id;
    const one = await f.c.tool('complete_items', { items: [{ id }] });
    assert.equal(one.isError, false, one.text);
    const when = (await f.c.tool('get_item', { id })).json.item.when;
    const two = await f.c.tool('complete_items', { items: [{ id }] });
    assert.equal(two.isError, true, 'refused once the creates budget is spent');
    assert.match(two.text, /created 3 items in the last hour/);
    assert.equal((await f.c.tool('get_item', { id })).json.item.when, when, 'nothing changed');
    assert.equal(await logEntries(f.c, 'daily'), 1);
  } finally { await f.done(); }
  // Text: 20 000 (item) + 20 000 (first log copy) fit in 50 000; a second copy doesn't.
  f = await fresh({ textPerHour: 50_000 });
  try {
    const id = (await f.c.tool('add_items', { parent_id: f.list, items: [{ title: 'big', notes: 'n'.repeat(20_000), repeat: 'every day' }] })).json.items[0].id;
    assert.equal((await f.c.tool('complete_items', { items: [{ id }] })).isError, false);
    const r = await f.c.tool('complete_items', { items: [{ id }] });
    assert.equal(r.isError, true);
    assert.match(r.text, /hourly limit of new text/);
    assert.equal(await logEntries(f.c, 'big'), 1);
  } finally { await f.done(); }
  // update_items counts tags as text too: 1 280 characters of tags fit in 1 500 once, not twice.
  f = await fresh({ textPerHour: 1500 });
  try {
    const tags = (p) => Array.from({ length: 20 }, (_, i) => (p + i).padEnd(64, 'x'));
    assert.equal((await f.c.tool('update_items', { items: [{ id: f.list, tags: tags('a') }] })).isError, false);
    const t = await f.c.tool('update_items', { items: [{ id: f.list, tags: tags('b') }] });
    assert.equal(t.isError, true, 'tags count against the text budget');
    assert.match(t.text, /hourly limit of new text/);
  } finally { await f.done(); }
});

test('S2 writes run one at a time: a 507 undoes the call that caused it, the other call keeps its change', async () => {
  const full = await startSync({ LISTS_VAULT_ROWS: '12' });
  const v = await otherVault(full.url);
  const b = await startBridge({ syncUrl: full.url, limits: { pullStaleMs: 0 } });
  try {
    const c = b.client();
    assert.equal((await c.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
    const list = (await c.tool('create_list', { title: 'L' })).json.list.id;
    const A = b.client().tool('add_items', { parent_id: list, items: Array.from({ length: 20 }, (_, i) => ({ title: 'BIG' + i })) });
    await sleep(30);
    const B = b.client().tool('update_items', { items: [{ id: list, title: 'Renamed' }] });
    const [ra, rb] = await Promise.all([A, B]);
    assert.equal(ra.isError, true);
    assert.match(ra.text, /^Nothing was changed: .*full/);
    assert.equal(rb.isError, false, rb.text);
    assert.equal((await c.tool('search_items', { query: 'BIG' })).json.items.length, 0, 'the refused items are really gone');
    assert.equal((await c.tool('get_item', { id: list })).json.item.data.title, 'Renamed', 'the other change stays');
  } finally { await b.kill(); await full.stop(); cleanup(b.data); cleanup(full.dir); }
});

test('S2 a write that throws leaves nothing half-applied: unreadable repeat rules, a failing save; undo still works', async () => {
  // A rule the app can't read (synced from elsewhere) used to throw after the log record was made.
  const { S, O } = dev;
  let id;
  O.tx('seed', () => { id = O.create({ title: 'weird', notes: 'secret', rrule: 'garbage', when: '2026-01-01', pos: S.posAt(S.INBOX, 0) }); });
  await dev.syncNow();
  const data = tmp('data');
  const b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  const c = b.client();
  try {
    assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
    const r = await c.tool('complete_items', { items: [{ id }] });
    assert.equal(r.isError, false, r.text);
    assert.equal(await logEntries(c, 'weird'), 1, 'one log entry, no duplicates');
    // Now make the save fail (read-only /data): the write answers "Internal error" and is really undone.
    const keep = await c.tool('add_items', { items: [{ title: 'kept' }] });
    assert.equal(keep.isError, false, keep.text);
    chmodSync(data, 0o500);
    let bad;
    try { bad = await c.tool('add_items', { items: [{ title: 'lost-on-save' }] }); } finally { chmodSync(data, 0o700); }
    assert.equal(bad.isError, true);
    assert.match(bad.text, /Internal error/);
    assert.equal((await c.tool('search_items', { query: 'lost-on-save' })).json.items.length, 0, 'not kept');
    const u = await c.tool('undo', { undo_id: keep.json.undo_id });
    assert.equal(u.isError, false, 'the earlier undo_id is still the newest: ' + u.text);
    assert.equal((await c.tool('search_items', { query: 'kept' })).json.items.length, 0);
  } finally { await b.kill(); cleanup(data); }
});

test('S1 admin connects run one at a time: two first connects at once pin exactly one vault', async () => {
  const x = await otherVault(sync.url), y = await otherVault(sync.url);
  const b = await startBridge({ syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  try {
    const [rx, ry] = await Promise.all([b.client().admin('connect', { code: x.code, tz: 'UTC' }), b.client().admin('connect', { code: y.code, tz: 'UTC' })]);
    assert.deepEqual([rx.status, ry.status].sort(), [200, 403]);
    const win = rx.status === 200 ? x : y;
    assert.equal(readFileSync(join(b.data, 'owner'), 'utf8').trim(), tokenDigest(win.tok), 'the winner owns it');
    assert.equal(b.out.text.match(/\[bridge\] connected/g).length, 1, 'attached once');
    // One device row per connect at lists-sync (the existence probe uses the replica's own device).
    await b.client().tool('get_overview');
    const q = spawnSync('python3', ['-I', '-c', `import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("SELECT COUNT(*) FROM devices d JOIN vaults v ON v.id=d.vault WHERE lower(hex(v.token_sha256))=? AND d.dev LIKE 'd_mcp%'", (sys.argv[2],)).fetchone()[0])`, join(sync.dir, 'lists.db'), tokenDigest(win.tok)], { encoding: 'utf8' });
    assert.equal(q.stdout.trim(), '1', q.stderr);
  } finally { await b.kill(); cleanup(b.data); }
});

test('S2 disconnect is idempotent: a second Disconnect after the restart leaves Connect working', async () => {
  const v = await otherVault(sync.url);
  const data = tmp('data');
  let b = await startBridge({ data, syncUrl: sync.url });
  assert.equal((await b.client().admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
  assert.equal((await b.client().admin('disconnect', { code: v.code })).status, 200);
  assert.equal((await b.exited).code, 0);
  b = await startBridge({ data, syncUrl: sync.url });
  try {
    const again = await b.client().admin('disconnect', { code: v.code });
    assert.deepEqual([again.status, again.body], [200, { connected: false }]);
    await sleep(300);
    assert.equal(b.p.exitCode, null, 'nothing to stop, so it stays up');
    const r = await b.client().admin('connect', { code: v.code, tz: 'UTC' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await b.client().tool('get_overview')).isError, false);
  } finally { await b.kill(); cleanup(data); }
});

test('S2 the owner pin: compose refuses to start without it; with it, a vault erase does not free the connector', async () => {
  const compose = readFileSync(join(REPO, 'deploy/docker-compose.mcp.yml'), 'utf8');
  assert.match(compose, /^\s+LISTS_MCP_OWNER_SHA256: "\$\{LISTS_MCP_OWNER_SHA256:\?/m);
  const v = await otherVault(sync.url), stranger = await otherVault(sync.url);
  const data = tmp('data'), env = { LISTS_MCP_OWNER_SHA256: tokenDigest(v.tok) };
  let b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 }, env });
  assert.equal((await b.client().admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
  assert.equal((await fetch(sync.url + '/api/vault', { method: 'DELETE', headers: { authorization: 'Bearer ' + v.tok } })).status, 200);
  await b.client().tool('get_overview');
  assert.equal((await b.exited).code, 0, 'vault gone: wiped and exited');
  b = await startBridge({ data, syncUrl: sync.url, env });
  try {
    assert.equal((await b.client().admin('connect', { code: stranger.code, tz: 'UTC' })).status, 403);
  } finally { await b.kill(); cleanup(data); }
  const nopin = await startBridge({ syncUrl: sync.url });
  try { assert.match(nopin.out.text, /no owner pin/); } finally { await nopin.kill(); cleanup(nopin.data); }
});

test('S2 JSON-RPC batches are refused before any tool runs, with no audit line', async () => {
  const f = await fresh();
  try {
    const audit = join(f.b.data, 'audit.jsonl');
    await sleep(50);
    const size = statSync(audit).size;
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_overview', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'empty_trash', arguments: {} } },
    ];
    const r = await f.c.post('/mcp', batch, { 'mcp-protocol-version': '2025-03-26' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, -32600);
    const big = await f.c.post('/mcp', Array.from({ length: 3000 }, () => ({ method: 'x'.repeat(40) })), { 'mcp-protocol-version': '2025-03-26' });
    assert.equal(big.status, 400);
    await sleep(50);
    assert.equal(statSync(audit).size, size, 'no audit entry for refused batches');
  } finally { await f.done(); }
});

/** A POST that sends part of its body and holds the rest. → { req, done: Promise<status> } */
function held(url, ip, { length = 1000, send = 10, path = '/mcp' } = {}) {
  const u = new URL(url);
  let req;
  const done = new Promise((res) => {
    req = request({ host: u.hostname, port: u.port, method: 'POST', path, headers: { host: '127.0.0.1', 'content-type': 'application/json', 'content-length': length, 'x-real-ip': ip } }, (m) => { m.resume(); res(m.statusCode); });
    req.on('error', () => res('error'));
    if (send) req.write('x'.repeat(send)); else req.flushHeaders();
  });
  return { req, done };
}

test('S2 bodies still uploading count against the open caps; too slow is 408, too big is 413 at once', async () => {
  const b = await startBridge({ syncUrl: sync.url, limits: { bodyMs: 1500 } });
  try {
    const ip = '10.77.0.1';
    const hold = [0, 1, 2].map(() => held(b.url, ip));
    await sleep(200);
    const fourth = await b.client({ ip }).modern('tools/list');
    assert.equal(fourth.status, 429, 'a 4th from the same IP waits its turn');
    assert.equal((await b.client({ ip: '10.77.0.2' }).modern('tools/list')).status, 200, 'other IPs are fine');
    assert.deepEqual(await Promise.all(hold.map((h) => h.done)), [408, 408, 408]);
    const t0 = Date.now();
    const big = held(b.url, '10.77.0.3', { length: (256 << 10) + 1, send: 0 });
    assert.equal(await big.done, 413);
    assert.ok(Date.now() - t0 < 1000, '413 from Content-Length, before reading');
    big.req.destroy();
  } finally { await b.kill(); cleanup(b.data); }
});

test('S2 list_items: parent_id scopes today and the other views, inbox refuses it', async () => {
  const f = await fresh();
  try {
    const t = (await f.c.tool('get_overview')).json.today;
    const home = (await f.c.tool('create_list', { title: 'Home', items: [{ title: 'h1', when: t }] })).json.list.id;
    await f.c.tool('create_list', { title: 'Groceries', items: [{ title: 'g1', when: t }] });
    const r = await f.c.tool('list_items', { view: 'today', parent_id: home });
    assert.deepEqual(r.json.items.map((i) => i.data.title), ['h1']);
    assert.equal(r.json.parent_id, home);
    assert.equal((await f.c.tool('list_items', { view: 'today' })).json.items.length, 2);
    assert.equal((await f.c.tool('list_items', { view: 'inbox', parent_id: home })).isError, true);
    assert.equal((await f.c.tool('list_items', { view: 'upcoming', parent_id: 'nope' })).isError, true);
  } finally { await f.done(); }
});

test('S2 strict input schemas: unknown arguments are refused, never dropped', async () => {
  const f = await fresh();
  try {
    const [a, x] = (await f.c.tool('add_items', { parent_id: f.list, items: [{ title: 'Alpha' }, { title: 'Omega' }] })).json.items.map((i) => i.id);
    const call = async (name, args) => { const r = await f.c.modern('tools/call', { name, arguments: args }); const m = r.messages.at(-1); return m.error ? { refused: true, text: m.error.message } : { refused: !!m.result.isError, text: m.result.content[0].text }; };
    const mv = await call('move_items', { ids: [x], parent_id: f.list, position: 0 });
    assert.equal(mv.refused, true);
    assert.match(mv.text, /position/);
    assert.deepEqual((await f.c.tool('list_items', { view: 'list', parent_id: f.list })).json.items.map((i) => i.id), [a, x], 'tree unchanged');
    assert.equal((await call('search_items', { query: 'a', parent_id: f.list })).refused, true);
    assert.equal((await call('complete_items', { items: [{ id: a, when: '2026-01-01' }] })).refused, true);
    assert.equal((await f.c.tool('get_item', { id: a })).json.item.done, false);
    // Every advertised object schema says additionalProperties:false.
    const list = (await f.c.modern('tools/list')).messages.at(-1).result.tools;
    const open = [];
    const walk = (s, where) => {
      if (!s || typeof s !== 'object') return;
      if (s.type === 'object' && s.properties && s.additionalProperties !== false) open.push(where);
      for (const [k, v] of Object.entries(s)) if (v && typeof v === 'object') walk(v, where + '.' + k);
    };
    for (const t of list) walk(t.inputSchema, t.name);
    assert.deepEqual(open, []);
  } finally { await f.done(); }
});

test('S3 add_items: quick text keeps its date with evening:true or a repeat', async () => {
  const f = await fresh();
  try {
    const add = async (it) => (await f.c.tool('add_items', { parent_id: f.list, items: [it] })).json.items[0].id;
    const when = async (id) => (await f.c.tool('get_item', { id })).json.item.when;
    const plain = await when(await add({ quick: 'Call Ana next friday' }));
    assert.ok(plain && plain !== (await f.c.tool('get_overview')).json.today);
    assert.equal(await when(await add({ quick: 'Call Ana next friday', evening: true })), plain);
    assert.equal(await when(await add({ quick: 'Call Ana next friday', repeat: 'every month' })), plain);
  } finally { await f.done(); }
  // buildFields itself: no quick date means today for evening, as before.
  assert.equal(buildFields({ evening: true }, null, '2026-11-14', null).fields.when, '2026-11-14');
  assert.equal(buildFields({ evening: true }, null, '2026-11-14', '2026-11-20').fields.when, undefined);
});

test('S3 graveyard: full means permanent deletes are refused, older entries are never evicted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lists-grave-')), path = join(dir, 'g.bin'), key = Buffer.alloc(32, 7);
  try {
    graveAppend(path, key, { big: 'x'.repeat(5000) }, { days: 30, maxBytes: 1000 });
    assert.equal(graveRead(path, key).length, 1, 'one entry alone may pass the cap');
    const before = readFileSync(path);
    assert.throws(() => graveAppend(path, key, { n: 1 }, { days: 30, maxBytes: 1000 }), (e) => e.code === 'GRAVE_FULL');
    assert.deepEqual(readFileSync(path), before, 'byte-identical');
    graveAppend(path, key, { n: 2 }, { days: 30, maxBytes: 1000, now: Date.now() + 31 * 864e5 });
    assert.deepEqual(graveRead(path, key), [{ n: 2 }], 'expired entries still go');
  } finally { cleanup(dir); }
  const f = await fresh({ graveyardBytes: 3000 });
  try {
    const [a, b] = (await f.c.tool('add_items', { parent_id: f.list, items: [{ title: 'one', notes: 'y'.repeat(3000) }, { title: 'two' }] })).json.items.map((i) => i.id);
    await f.c.tool('trash_items', { ids: [a, b] });
    assert.equal((await f.c.tool('delete_forever', { ids: [a] })).isError, false);
    const r = await f.c.tool('delete_forever', { ids: [b] });
    assert.equal(r.isError, true);
    assert.match(r.text, /backup of permanently deleted items is full/);
    assert.equal((await f.c.tool('get_item', { id: b })).json.item.in_trash, true, 'still in Trash');
  } finally { await f.done(); }
});

test('S3 perMinute: 50 000 distinct keys stay cheap; overflow shares one window; IPv6 keyed per /64', () => {
  let t = 1_000_000;
  const r = perMinute(() => t);
  const t0 = performance.now();
  for (let i = 0; i < 50_000; i++) r.hit('k' + i, 120);
  assert.ok(performance.now() - t0 < 300, 'no quadratic sweep');
  assert.equal(r.size(), 10_001, 'capped, plus the overflow window');
  for (let i = 0; i < 200; i++) r.hit('new' + i, 120);
  assert.ok(r.hit('another', 120) > 0, 'past the cap, new keys share the overflow budget');
  t += 61_000;
  assert.equal(r.hit('after', 120), 0, 'a sweep frees expired windows');
  assert.ok(r.size() < 10);
  assert.ok(OVERFLOW);
  assert.equal(rateKey('2001:db8:1:2:aaaa::1'), rateKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(rateKey('2001:db8:1:2::1'), rateKey('2001:db8:1:3::1'));
  assert.equal(rateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(rateKey('::ffff:203.0.113.9'), '203.0.113.9');
});
