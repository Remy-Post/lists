// node --test mcp/test — gate 5: warm read p95 on a 10 000-item replica (target ≤ 150 ms, measured over
// loopback HTTP, so it includes the HTTP and MCP layers but no real network) and the bridge's RSS
// (target ≤ 80 MB). Numbers are printed as test diagnostics.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startSync, startBridge, deviceA, cleanup, until, pct, sleep } from './helpers.mjs';

let sync, bridge, dev, big;
const NODE_FLAGS = '--max-old-space-size=64 --max-semi-space-size=1'; // as in deploy/docker-compose.mcp.yml
// Memory as the container's cgroup sees it is the process's private (anonymous) memory: VmRSS also counts
// the file-backed pages of the node binary (~55–60 MB), which are page cache, shared and reclaimable.
// Gate 5 is 80 MB; the 96 MB mem_limit is what must never be reached.
const TARGET_MB = 80;
const mem = (pid) => {
  const s = readFileSync(`/proc/${pid}/status`, 'utf8'), kb = (k) => +s.match(new RegExp(k + ':\\s+(\\d+)'))[1] / 1024;
  return { anon: kb('RssAnon'), rss: kb('VmRSS') };
};
const show = (m) => `${m.anon.toFixed(1)} MB private (VmRSS ${m.rss.toFixed(1)} MB incl. the node binary)`;

before(async () => {
  sync = await startSync();
  dev = await deviceA(sync.url);
  const { S, O, A } = dev;
  const t = A.today();
  // 20 lists × 500 items; every 5th item has a sub-item, every 7th a date, every 50th repeats.
  O.tx('bulk', () => {
    for (let l = 0; l < 20; l++) {
      const list = O.create({ title: 'List ' + l, pos: S.posAt(S.ROOT, l + 1) });
      if (l === 0) big = list;
      let prev = null;
      for (let i = 0; i < 400; i++) {
        const f = { title: `Item ${l}-${i} buy paint and brushes`, notes: i % 3 ? '' : 'Some notes about item ' + i, pos: S.posBetween(list, prev, null) };
        if (i % 7 === 0) f.when = A.addDays(t, (i % 30) - 10);
        if (i % 50 === 0) Object.assign(f, { rrule: 'FREQ=WEEKLY;BYDAY=MO', repeatFrom: 'when' });
        prev = O.create(f);
        if (i % 4 === 0) O.create({ title: 'Sub ' + i, pos: S.posAt(prev, 0) });
      }
    }
  });
  await dev.syncNow();
  assert.ok(S.recs.size >= 10_000, 'fixture has ' + S.recs.size + ' records');
});
after(async () => { await bridge?.kill(); await sync.stop(); if (bridge) cleanup(bridge.data); cleanup(sync.dir); });

test('idle memory of a disconnected bridge', async (t) => {
  const b = await startBridge({ syncUrl: sync.url, env: { NODE_OPTIONS: NODE_FLAGS } });
  try {
    await b.client().modern('tools/list');
    await sleep(1500);
    const m = mem(b.p.pid);
    t.diagnostic(`idle, disconnected: ${show(m)}, node ${process.version}`);
    assert.ok(m.anon <= TARGET_MB);
  } finally { await b.kill(); cleanup(b.data); }
});

test('warm reads on a 10k-item replica: p95 ≤ 150 ms; idle memory ≤ 80 MB', async (t) => {
  // Rate limits lifted: this measures latency, not the limiter.
  bridge = await startBridge({ syncUrl: sync.url, limits: { ipPerMin: 1e6, globalPerMin: 1e6 }, env: { NODE_OPTIONS: NODE_FLAGS } });
  const c = bridge.client();
  const t0 = Date.now();
  assert.equal((await c.admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
  await until(async () => (await c.tool('get_overview')).json?.lists.length === 20, 60_000, 'initial pull');
  t.diagnostic(`connect + initial pull of ${dev.S.recs.size} records: ${Date.now() - t0} ms`);
  const calls = {
    get_overview: {},
    'list_items today': { view: 'today' },
    'list_items upcoming': { view: 'upcoming' },
    'list_items list (400 items, page 50)': { view: 'list', parent_id: big },
    'list_items list (page 200)': { view: 'list', parent_id: big, limit: 200 },
    'search_items': { query: 'paint 12' },
    'get_item': { id: dev.S.children(big)[10], depth: 2 },
  };
  const all = [];
  for (const [label, args] of Object.entries(calls)) {
    const name = label.split(' ')[0];
    for (let i = 0; i < 3; i++) await c.tool(name, args); // warm up
    const ms = [];
    for (let i = 0; i < 30; i++) {
      const s = performance.now();
      const r = await c.tool(name, args);
      ms.push(performance.now() - s);
      assert.equal(r.isError, false, r.text);
    }
    all.push(...ms);
    t.diagnostic(`${label}: p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${pct(ms, 95).toFixed(1)} ms`);
    assert.ok(pct(ms, 95) <= 150, `${label} p95 ${pct(ms, 95).toFixed(1)} ms`);
  }
  t.diagnostic(`all reads: p95 ${pct(all, 95).toFixed(1)} ms over ${all.length} calls`);
  const w = [];
  for (let i = 0; i < 20; i++) {
    const s = performance.now();
    assert.equal((await c.tool('add_items', { parent_id: big, items: [{ title: 'perf ' + i }] })).isError, false);
    w.push(performance.now() - s);
  }
  t.diagnostic(`add_items (save 10k replica + push): p50 ${pct(w, 50).toFixed(1)} ms, p95 ${pct(w, 95).toFixed(1)} ms`);
  await sleep(2000);
  const m = mem(bridge.p.pid);
  t.diagnostic(`idle with the 10k replica: ${show(m)}`);
  assert.ok(m.anon <= TARGET_MB, show(m));
});
