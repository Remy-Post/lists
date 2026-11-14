// node --test mcp/test — persistence and the off switch: compaction safety across kill -9 (a fresh device
// pulled from 0 equals the bridge replica), the outbox surviving a crash, device-id rotation rules,
// disconnect (wipe + exit, pin kept), vault gone (401 → wipe, pin released), the env owner pin, 502.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSync, startBridge, deviceA, otherVault, freshPull, readReplica, cleanup, exists, until, tmp } from './helpers.mjs';
import { tokenDigest } from '../persist.mjs';

let sync, dev;
before(async () => { sync = await startSync(); dev = await deviceA(sync.url); });
after(async () => { await sync.stop(); cleanup(sync.dir); });

const fields = (r) => JSON.stringify(Object.keys(r.f).sort().map((k) => [k, r.f[k]]));
/** The bridge's saved replica must equal a device rebuilt from 0 once the bridge's pushes have landed. */
async function assertConverged(b) {
  await b.client().tool('get_overview'); // pulls device A's latest (pullStaleMs 0), saved with it
  let diff = 'never compared';
  const ok = await until(async () => {
    const rep = await readReplica(b.data, dev.code), fresh = await freshPull(sync.url, dev.code);
    const mine = new Map(rep.records.map((r) => [r.id, r]));
    if (fresh.size !== mine.size) { diff = `${fresh.size} records from 0, ${mine.size} in the replica`; return false; }
    for (const [id, r] of mine) if (fields(fresh.get(id) || { f: {} }) !== fields(r)) { diff = 'record ' + id; return false; }
    return true;
  }, 15_000, 'convergence').catch(() => false);
  assert.ok(ok, diff);
}

test('compaction safety: writes, kill -9, restart, more writes on the same records → fresh device equals the replica', async () => {
  const data = tmp('data');
  let b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  let c = b.client();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  const list = (await c.tool('create_list', { title: 'Garden', items: [{ title: 'Seeds', repeat: 'every day' }, { title: 'Hose' }, { title: 'Rake', children: [{ title: 'Handle' }] }] })).json;
  const [seeds, hose, rake] = list.items.map((i) => i.id);
  await c.tool('update_items', { items: [{ id: hose, notes: 'green', priority: 2 }] });
  await c.tool('complete_items', { items: [{ id: seeds }] });
  await c.tool('move_items', { ids: [hose], parent_id: rake });
  await c.tool('trash_items', { ids: [rake] });
  // Device A edits the same records in between.
  await dev.syncNow();
  dev.O.tx('A edit', () => dev.O.set(seeds, { title: 'Seeds (A)' }));
  await dev.syncNow();
  const before = await readReplica(data, dev.code);
  await b.kill('SIGKILL');

  b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  c = b.client();
  assert.equal((await c.admin('status')).body.connected, true, 'reconnects from the saved key');
  await c.tool('get_overview');
  const after = await readReplica(data, dev.code);
  assert.notEqual(after.dev, before.dev, 'an unclean start rotates the device id');
  assert.notEqual(after.hlc, before.hlc);
  await c.tool('restore_items', { ids: [rake] });
  await c.tool('update_items', { items: [{ id: hose, title: 'Hose 2' }, { id: seeds, notes: 'bridge note' }] });
  await c.tool('complete_items', { items: [{ id: seeds }] });
  await assertConverged(b);
  await dev.syncNow();
  assert.equal(dev.S.val(seeds, 'title'), 'Seeds (A)');
  assert.equal(dev.S.val(seeds, 'notes'), 'bridge note');
  assert.equal(dev.S.val(hose, 'title'), 'Hose 2');

  // A clean stop (SIGTERM) keeps the device id.
  const dev1 = (await readReplica(data, dev.code)).dev;
  await b.kill('SIGTERM');
  assert.equal((await readReplica(data, dev.code)).clean, true);
  b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  await b.client().tool('get_overview');
  const r3 = await readReplica(data, dev.code);
  assert.equal(r3.dev, dev1, 'clean restart: same device id');
  assert.equal(r3.clean, false, 'marked unclean while running');
  await assertConverged(b);
  await b.kill(); cleanup(data);
});

test('the outbox survives kill -9: a write that could not be pushed is pushed after restart', async () => {
  const data = tmp('data');
  let b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0, pushWaitMs: 400 } });
  const c = b.client();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  await c.tool('get_overview');
  sync.p.kill('SIGSTOP');
  let id;
  try {
    const r = await c.tool('add_items', { items: [{ title: 'Stranded' }] });
    assert.equal(r.json.pushed, false);
    id = r.json.items[0].id;
    assert.ok((await readReplica(data, dev.code)).outbox.includes(id), 'saved before the push');
    await b.kill('SIGKILL');
  } finally { sync.p.kill('SIGCONT'); }
  b = await startBridge({ data, syncUrl: sync.url });
  await until(async () => { await dev.syncNow(); return dev.S.val(id, 'title') === 'Stranded'; }, 15_000, 'the stranded write');
  await b.kill(); cleanup(data);
});

test('disconnect: wrong code 403; owner code wipes key, replica and graveyard, exits 0, keeps the pin', async () => {
  const data = tmp('data');
  const other = await otherVault(sync.url);
  let b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  let c = b.client();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  const t = await c.tool('add_items', { items: [{ title: 'to delete' }] });
  await c.tool('trash_items', { ids: [t.json.items[0].id] });
  await c.tool('empty_trash');
  assert.ok(exists(data, 'graveyard.bin'));
  assert.equal((await c.admin('disconnect', { code: other.code })).status, 403);
  assert.equal((await c.admin('disconnect', { code: 'garbage' })).status, 403);
  const r = await c.admin('disconnect', { code: dev.code });
  assert.deepEqual([r.status, r.body], [200, { connected: false }]);
  const exit = await b.exited;
  assert.equal(exit.code, 0, 'the process exits so nothing stays in memory');
  for (const f of ['key', 'replica.bin', 'graveyard.bin']) assert.equal(exists(data, f), false, f + ' wiped');
  assert.ok(exists(data, 'owner'), 'the owner pin survives');

  // "compose restarts it": empty, refuses another vault, takes the owner back.
  b = await startBridge({ data, syncUrl: sync.url });
  c = b.client();
  assert.equal((await c.admin('status')).body.connected, false);
  assert.match((await c.tool('get_overview')).text, /isn’t connected/);
  assert.equal((await c.admin('connect', { code: other.code, tz: 'UTC' })).status, 403, 'a fresh vault can’t take over the URL');
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  assert.equal((await c.tool('get_overview')).isError, false);
  await b.kill(); cleanup(data);
});

test('vault gone: a 401 from lists-sync wipes everything, releases the pin and exits', async () => {
  const data = tmp('data');
  const v = await otherVault(sync.url);
  const b = await startBridge({ data, syncUrl: sync.url, limits: { pullStaleMs: 0 } });
  const c = b.client();
  assert.equal((await c.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
  assert.equal((await c.tool('create_list', { title: 'x' })).isError, false);
  const del = await fetch(sync.url + '/api/vault', { method: 'DELETE', headers: { authorization: 'Bearer ' + v.tok } });
  assert.equal(del.status, 200);
  const r = await c.tool('get_overview');
  assert.equal(r.isError, true);
  assert.match(r.text, /isn’t connected/);
  assert.equal((await b.exited).code, 0);
  for (const f of ['key', 'replica.bin', 'owner']) assert.equal(exists(data, f), false, f + ' wiped');
  cleanup(data);
});

test('LISTS_MCP_OWNER_SHA256 pins the owner before the first connect', async () => {
  const other = await otherVault(sync.url);
  const b = await startBridge({ syncUrl: sync.url, env: { LISTS_MCP_OWNER_SHA256: tokenDigest(other.tok) } });
  const c = b.client();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 403);
  assert.equal((await c.admin('connect', { code: other.code, tz: 'UTC' })).status, 200);
  assert.equal(exists(b.data, 'owner'), false, 'the env pin is not copied to disk');
  await b.kill(); cleanup(b.data);
});

test('sync server unreachable at connect: 502, nothing pinned or saved', async () => {
  const b = await startBridge({ syncUrl: 'http://127.0.0.1:9' });
  const r = await b.client().admin('connect', { code: dev.code, tz: 'UTC' });
  assert.equal(r.status, 502);
  assert.equal(exists(b.data, 'owner') || exists(b.data, 'key'), false);
  await b.kill(); cleanup(b.data);
});
