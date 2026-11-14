// node --test mcp/test — gate 4 hostile inputs: reserved/unknown/void ids on every write tool, depth 65,
// oversized fields, bad dates/rrules, too many items, nesting, size and rate limits, Host/Origin, growth caps.
// After each refusal the replica must be unchanged and device A must still render.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startSync, startBridge, deviceA, otherVault, cleanup, readReplica, sleep, until, rawRequest } from './helpers.mjs';

let sync, bridge, dev, c, F;

before(async () => {
  sync = await startSync();
  dev = await deviceA(sync.url);
  const { S, O, A } = dev;
  F = { list: A.newList('Work') };
  O.tx('seed', () => {
    F.a = O.create({ title: 'Alpha', pos: S.posAt(F.list, 0) });
    F.b = O.create({ title: 'Beta', pos: S.posAt(F.list, 1) });
    F.gone = O.create({ title: 'Gone', pos: S.posAt(F.list, 2) });
    F.binned = O.create({ title: 'Binned', pos: S.posAt(F.list, 3) });
  });
  A.trash([F.gone]); A.destroy([F.gone]);
  A.trash([F.binned]);
  await dev.syncNow();
  bridge = await startBridge({ syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  c = bridge.client();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  await c.tool('get_overview');
});
beforeEach(() => { if (bridge) c = bridge.client(); }); // a fresh client IP per test: the suite outruns 120/min
after(async () => {
  await bridge.kill(); await sync.stop();
  cleanup(bridge.data); cleanup(sync.dir);
});

/** The replica's records as id → v, so "unchanged" means not one field was written. */
const snapshot = async () => { const r = await readReplica(bridge.data, dev.code); return JSON.stringify(r.records.map((x) => [x.id, x.v]).sort()); };
/** A call refused either by the SDK's schema check (JSON-RPC error or isError) or by the bridge. */
async function refused(name, args) {
  const r = await c.modern('tools/call', { name, arguments: args });
  const m = r.messages.at(-1);
  return { refused: !!(m.error || m.result.isError), text: m.error ? m.error.message : m.result.content[0].text };
}
async function deviceStillRenders() {
  await dev.syncNow();
  const { S, A } = dev;
  assert.ok(S.countOpen(S.ROOT) >= 0);
  S.qToday(A.today()); S.qTrash(); S.qUpcoming(A.today());
}

test('reserved, unknown, prototype and void ids are refused by every write tool; nothing is written', async () => {
  const before = await snapshot(), size = dev.S.recs.size;
  const bad = ['root', 'inbox', '__proto__', 'constructor', 'n-made-up', F.gone];
  const calls = {
    update_items: (id) => ({ items: [{ id, title: 'x' }] }),
    append_notes: (id) => ({ items: [{ id, text: 'x' }] }),
    move_items: (id) => ({ ids: [id], parent_id: F.list }),
    complete_items: (id) => ({ items: [{ id }] }),
    reopen_items: (id) => ({ ids: [id] }),
    trash_items: (id) => ({ ids: [id] }),
    restore_items: (id) => ({ ids: [id] }),
    delete_forever: (id) => ({ ids: [id] }),
  };
  for (const [tool, args] of Object.entries(calls)) {
    for (const id of bad) {
      if (tool === 'delete_forever' && id === F.gone) continue; // already void: an idempotent no-op, checked below
      const r = await refused(tool, args(id));
      assert.ok(r.refused, `${tool}(${id}) must be refused`);
    }
    // One bad id spoils the whole batch: the good one is not touched either.
    const mixed = tool === 'update_items' || tool === 'append_notes' || tool === 'complete_items'
      ? { items: [...args(F.a).items, ...args('root').items] } : { ...args(F.a), ids: [F.a, 'root'] };
    assert.ok((await refused(tool, mixed)).refused, `${tool} mixed batch`);
  }
  const df = await c.tool('delete_forever', { ids: [F.gone] });
  assert.equal(df.json.items[0].status, 'already_deleted');
  assert.equal(df.json.undo_id, null);
  assert.ok((await refused('delete_forever', { ids: [F.a] })).refused, 'live item: trash first');
  // Destinations.
  for (const parent_id of ['root', '__proto__', 'n-made-up', F.gone, F.binned]) assert.ok((await refused('add_items', { parent_id, items: [{ title: 'x' }] })).refused, 'add under ' + parent_id);
  for (const parent_id of ['__proto__', 'n-made-up', F.gone, F.binned]) assert.ok((await refused('move_items', { ids: [F.a], parent_id })).refused, 'move under ' + parent_id);
  assert.ok((await refused('add_items', { parent_id: F.list, after_id: 'inbox', items: [{ title: 'x' }] })).refused, 'after_id not a child');
  assert.ok((await refused('get_item', { id: 'root' })).refused);
  assert.equal(await snapshot(), before, 'replica unchanged');
  await deviceStillRenders();
  assert.equal(dev.S.recs.size, size, 'no junk records reached the device');
  assert.equal(dev.S.val(F.a, 'title'), 'Alpha');
});

test('fields can’t smuggle id, pos, deleted, kind or __proto__', async () => {
  const r = await refused('add_items', { items: [{ title: 'x', id: 'root', pos: { parent: 'root' }, deleted: 'void', kind: 'inbox' }] });
  assert.ok(r.refused, 'unknown keys are refused');
  const p = await c.modern('tools/call', { name: 'add_items', arguments: JSON.parse('{"items":[{"title":"proto","__proto__":{"kind":"log"}}]}') });
  const m = p.messages.at(-1);
  if (!m.error && !m.result.isError) {
    const id = JSON.parse(m.result.content[0].text.split('\n')[1]).items[0].id;
    assert.equal((await c.tool('get_item', { id })).json.item.type, 'item');
    await c.tool('undo');
  }
});

test('depth: 64 levels are fine, the 65th is refused (add and move); raw nesting refused before zod', async () => {
  let chain = { title: 'd63' };
  for (let d = 62; d >= 2; d--) chain = { title: 'd' + d, children: [chain] };
  const deep = await c.tool('create_list', { title: 'd1', items: [chain] });
  assert.equal(deep.isError, false, deep.text);
  const all = (await c.tool('list_items', { view: 'list', parent_id: deep.json.list.id, depth: 64, limit: 200 })).json.items;
  const d63 = all.find((i) => i.data.title === 'd63');
  assert.equal(d63.depth + 1, 63);
  const ok = await c.tool('add_items', { parent_id: d63.id, items: [{ title: 'd64' }] });
  assert.equal(ok.isError, false, ok.text);
  const d64 = ok.json.items[0].id;
  const no = await c.tool('add_items', { parent_id: d64, items: [{ title: 'd65' }] });
  assert.equal(no.isError, true);
  assert.match(no.text, /deeper than 64/);
  // A two-level subtree moved under d63 would reach 65.
  const pair = await c.tool('add_items', { parent_id: F.list, items: [{ title: 'p', children: [{ title: 'q' }] }] });
  const mv = await c.tool('move_items', { ids: [pair.json.items[0].id], parent_id: d63.id });
  assert.equal(mv.isError, true);
  assert.match(mv.text, /deeper than 64/);
  // 200 levels of raw JSON: refused before any schema runs.
  let raw = { title: 'x' };
  for (let i = 0; i < 100; i++) raw = { title: 'x', children: [raw] };
  const r = await c.modern('tools/call', { name: 'add_items', arguments: { items: [raw] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, -32600);
  await deviceStillRenders();
});

test('oversized fields, too many items, bad dates, times and repeat rules: refused, nothing written', async () => {
  const before = await snapshot();
  const longTag = 'x'.repeat(65), tags21 = Array.from({ length: 21 }, (_, i) => 't' + i);
  const badItems = [
    { title: 'x'.repeat(501) }, { title: 'x', notes: 'x'.repeat(20_001) }, { title: 'x', tags: tags21 }, { title: 'x', tags: [longTag] },
    { quick: 'x'.repeat(501) }, { title: 'x', when: 'next tuesday' }, { title: 'x', when: '2026-02-30' }, { title: 'x', deadline: '2026-13-01' },
    { title: 'x', time: '25:00' }, { title: 'x', time: '5pm' }, { title: 'x', priority: 4 }, { title: 'x', repeat: 'FREQ=WEEKLY;INTERVAL=100000000;BYDAY=XX' },
    { title: 'x', repeat: 'FREQ=WEEKLY;BYDAY=XX' }, { title: 'x', repeat: 'COUNT=5' }, { title: 'x', repeat: 'INTERVAL=2' }, { title: 'x', repeat: 'every day at 5pm' },
    { title: 'x', repeat: 'FREQ=WEEKLY;BYSETPOS=1' }, { title: '' }, { title: '​‮' }, { title: 'x', someday: true, when: '2030-01-01' },
  ];
  for (const it of badItems) {
    assert.ok((await refused('add_items', { items: [it] })).refused, 'add ' + JSON.stringify(it).slice(0, 60));
    const { title, quick, ...rest } = it;
    if (Object.keys(rest).length) assert.ok((await refused('update_items', { items: [{ id: F.a, ...rest }] })).refused, 'update ' + JSON.stringify(rest).slice(0, 60));
  }
  const many = Array.from({ length: 101 }, (_, i) => ({ title: 'm' + i }));
  assert.ok((await refused('add_items', { items: many })).refused, '101 items');
  const nested = Array.from({ length: 51 }, (_, i) => ({ title: 'n' + i, children: [{ title: 'c' }] }));
  const r = await refused('add_items', { items: nested });
  assert.ok(r.refused, '102 nodes counted with children');
  assert.match(r.text, /At most 100 items/);
  assert.ok((await refused('complete_items', { items: Array.from({ length: 101 }, () => ({ id: F.a })) })).refused);
  assert.equal(await snapshot(), before);
  await deviceStillRenders();
});

test('HTTP: 413 over 256 KB, Host and Origin 403, well-known paths 404 from node, GET /mcp 405', async () => {
  const big = await c.post('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(256 << 10) } }));
  assert.equal(big.status, 413);
  const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-real-ip': '10.200.0.1' };
  assert.equal((await rawRequest(bridge.url, { method: 'POST', path: '/mcp', headers: { ...H, host: 'evil.example' }, body: list })).status, 403);
  assert.equal((await rawRequest(bridge.url, { path: '/mcp-admin/status', headers: { host: 'evil.example:443', 'x-real-ip': '10.200.0.1' } })).status, 403);
  assert.equal((await rawRequest(bridge.url, { method: 'POST', path: '/mcp', headers: { ...H, host: 'lists.remypost.me' }, body: list })).status, 200);
  assert.equal((await bridge.client({ origin: 'https://evil.example' }).modern('tools/list')).status, 403);
  assert.equal((await bridge.client({ origin: 'https://lists.remypost.me' }).modern('tools/list')).status, 200);
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/']) {
    const r = await c.get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers.get('content-type'), /application\/json/);
  }
  const g = await c.get('/mcp');
  assert.equal(g.status, 405);
  assert.equal(g.headers.get('access-control-allow-origin'), null, 'no CORS');
  assert.equal(g.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('rate: 120 per IP per minute, then 429 with Retry-After; another IP is unaffected', async () => {
  const one = bridge.client({ ip: '10.0.0.9' });
  for (let i = 0; i < 120; i++) assert.equal((await one.admin('status')).status, 200, 'request ' + i);
  const r = await one.admin('status');
  assert.equal(r.status, 429);
  assert.ok(+r.headers.get('retry-after') >= 1);
  assert.equal((await bridge.client({ ip: '10.0.0.10' }).admin('status')).status, 200);
});

test('global limits and X-Real-IP trust (separate bridge, no proxy trusted)', async () => {
  const b = await startBridge({ syncUrl: sync.url, limits: { globalPerMin: 5 }, env: { LISTS_TRUSTED_PROXIES: '' } });
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await b.client({ ip: '10.1.0.' + i }).admin('status')).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  } finally { await b.kill(); cleanup(b.data); }
  const t = await startBridge({ syncUrl: sync.url, limits: { ipPerMin: 2 }, env: { LISTS_TRUSTED_PROXIES: '' } });
  try {
    // Untrusted peer: X-Real-IP is ignored, so three "different" IPs are one bucket.
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await t.client({ ip: '10.2.0.' + i }).admin('status')).status);
    assert.deepEqual(codes, [200, 200, 429]);
  } finally { await t.kill(); cleanup(t.data); }
});

test('concurrency: at most 3 open requests per IP; a stalled sync server gives pushed:false within the wait', async () => {
  const b = await startBridge({ syncUrl: sync.url, limits: { pushWaitMs: 1500, pullStaleMs: 0 } });
  try {
    const bc = b.client({ ip: '10.3.0.1' });
    assert.equal((await bc.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
    await bc.tool('get_overview');
    sync.p.kill('SIGSTOP');
    try {
      const slow = [0, 1, 2].map(() => bc.tool('add_items', { items: [{ title: 'while stalled' }] }));
      await sleep(200);
      const fourth = await bc.modern('tools/call', { name: 'get_overview', arguments: {} });
      assert.equal(fourth.status, 429);
      const done = await Promise.all(slow);
      for (const r of done) { assert.equal(r.isError, false, r.text); assert.equal(r.json.pushed, false); }
    } finally { sync.p.kill('SIGCONT'); }
    // The background flush pushes them once lists-sync answers again.
    const fresh = await until(async () => {
      await dev.syncNow();
      return [...dev.S.recs.values()].filter((r) => r.f.title && r.f.title[0] === 'while stalled').length === 3;
    }, 15_000, 'stalled writes to arrive');
    assert.ok(fresh);
  } finally { await b.kill(); cleanup(b.data); }
});

test('growth caps: hourly creates, the replica ceiling, and records too big to sync are undone', async () => {
  const size = dev.S.recs.size;
  const b = await startBridge({ syncUrl: sync.url, limits: { createsPerHour: 150, sealedBytes: 3000, replicaFloor: size + 160 } });
  try {
    const bc = b.client();
    assert.equal((await bc.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
    await bc.tool('get_overview');
    const big = await bc.tool('add_items', { parent_id: F.list, items: [{ title: 'big', notes: 'é'.repeat(4000) }] });
    assert.equal(big.isError, true);
    assert.match(big.text, /too large to sync/);
    assert.equal((await bc.tool('search_items', { query: 'big' })).json.items.length, 0, 'undone');
    const batch = (n, t) => ({ parent_id: F.list, items: Array.from({ length: n }, (_, i) => ({ title: t + i })) });
    assert.equal((await bc.tool('add_items', batch(100, 'g'))).isError, false);
    const over = await bc.tool('add_items', batch(51, 'h'));
    assert.equal(over.isError, true);
    assert.match(over.text, /created 150 items in the last hour/);
    assert.equal((await bc.tool('add_items', batch(50, 'h'))).isError, false, 'exactly at the cap');
  } finally { await b.kill(); cleanup(b.data); }
  // The ceiling is max(2 × the replica at connect, floor): an empty vault makes the floor the limit.
  const v = await otherVault(sync.url);
  const r = await startBridge({ syncUrl: sync.url, limits: { replicaFloor: 10 } });
  try {
    const rc = r.client();
    assert.equal((await rc.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
    const list = await rc.tool('create_list', { title: 'L', items: [{ title: 'a' }, { title: 'b' }] });
    assert.equal(list.isError, false, list.text);
    const res = await rc.tool('add_items', { parent_id: list.json.list.id, items: Array.from({ length: 8 }, (_, i) => ({ title: 'r' + i })) });
    assert.equal(res.isError, true);
    assert.match(res.text, /near the size/);
    assert.equal((await rc.tool('add_items', { parent_id: list.json.list.id, items: Array.from({ length: 7 }, (_, i) => ({ title: 'r' + i })) })).isError, false);
  } finally { await r.kill(); cleanup(r.data); }
});

test('a push answered 507 (vault full) is a tool error and the change is undone', async () => {
  const full = await startSync({ LISTS_VAULT_ROWS: '12' });
  const url = full.url;
  const v = await otherVault(url);
  const b = await startBridge({ syncUrl: url });
  try {
    const bc = b.client();
    assert.equal((await bc.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
    await bc.tool('get_overview');
    // The bridge's own vault has no Inbox (that vault was made by a bare client); add under a new list.
    const list = await bc.tool('create_list', { title: 'L' });
    assert.equal(list.isError, false, list.text);
    const r = await bc.tool('add_items', { parent_id: list.json.list.id, items: Array.from({ length: 20 }, (_, i) => ({ title: 'f' + i })) });
    assert.equal(r.isError, true);
    assert.match(r.text, /full/);
    assert.equal((await bc.tool('list_items', { view: 'list', parent_id: list.json.list.id })).json.items.length, 0, 'undone');
  } finally { await b.kill(); await full.stop(); cleanup(b.data); cleanup(full.dir); }
});
