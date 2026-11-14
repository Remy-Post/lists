// node --test mcp/test — small pieces on their own: sanitize, input formats and repeat rules, the counters
// in limits.mjs, and the 20-per-minute lists-sync budget as the bridge actually spends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../sanitize.mjs';
import { bucket, perMinute, growthBudget, L } from '../limits.mjs';
import { startSync, startBridge, otherVault, cleanup } from './helpers.mjs';

test('sanitize: invisible controls go, emoji sequences and flags stay, counts what it removed', () => {
  const flag = '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'; // Scotland
  const keep = ['plain', 'tab\tand\nnewline', 'Ünïcödé 日本語', '👨‍👩‍👧', '👩🏽‍💻', '🏳️‍🌈', flag, '❤️‍🔥'];
  for (const s of keep) assert.deepEqual(sanitize(s), { text: s, removed: 0 }, s);
  const cases = [
    ['a‮b', 'ab'], ['a⁦b⁩', 'ab'], ['a​b‌c⁠d﻿', 'abcd'], ['a‎b‏', 'ab'],
    ['a\u0000b\u0007c\u001Bd\u007F\u0085', 'abcd'], ['x‍y', 'xy'], ['‍👍', '👍'], ['👍‍', '👍'],
    ['hi\u{E0049}\u{E0047}\u{E004E}', 'hi'], ['🏴\u{E0067}\u{E0062}', '🏴'], ['a؜b', 'ab'],
  ];
  for (const [inp, out] of cases) assert.equal(sanitize(inp).text, out, JSON.stringify(inp));
  assert.equal(sanitize('a‮​b').removed, 2);
  assert.deepEqual(sanitize(42), { text: 42, removed: 0 });
});

test('formats: real dates, zones, repeat rules normalised to the composer’s form', async () => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const G = await import('../guard.mjs');
  for (const d of ['2026-01-31', '2028-02-29']) assert.ok(G.realDate(d), d);
  for (const d of ['2026-02-29', '2026-13-01', '2026-1-1', '20260101', 'next tuesday', '1899-12-31']) assert.ok(!G.realDate(d), d);
  for (const z of ['UTC', 'Europe/Lisbon', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) assert.ok(G.validZone(z), z);
  for (const z of ['Mars/Base', '', '../etc', 'Europe/Lisbon; rm', 42]) assert.ok(!G.validZone(z), String(z));
  const n = (s, f) => G.normalizeRepeat(s, f);
  assert.equal(n('FREQ=WEEKLY;BYDAY=FR,MO').rrule, 'FREQ=WEEKLY;BYDAY=MO,FR');
  assert.equal(n('rrule:freq=weekly;interval=1').rrule, 'FREQ=WEEKLY');
  assert.equal(n('FREQ=MONTHLY;BYDAY=-1FR').rrule, 'FREQ=MONTHLY;BYDAY=-1FR');
  assert.equal(n('FREQ=DAILY;INTERVAL=2;UNTIL=20301231').rrule, 'FREQ=DAILY;INTERVAL=2;UNTIL=20301231');
  assert.deepEqual([n('after 3 days').rrule, n('after 3 days').repeatFrom], ['FREQ=DAILY;INTERVAL=3', 'done']);
  assert.equal(n('every monday', 'done').repeatFrom, 'done');
  for (const bad of ['FREQ=WEEKLY;INTERVAL=100', 'FREQ=WEEKLY;INTERVAL=0', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=HOURLY', 'FREQ=DAILY;UNTIL=2030', 'FREQ=WEEKLY;COUNT=3', 'whenever', 'every day at noon']) {
    assert.throws(() => n(bad), G.UserError, bad);
  }
  // The rule that took 50 s per occurrence on a phone is refused in well under a millisecond.
  const t = performance.now();
  assert.throws(() => n('FREQ=WEEKLY;INTERVAL=100000000;BYDAY=XX'));
  assert.ok(performance.now() - t < 50);
});

test('limits: token bucket refills evenly; per-minute windows; rolling-hour growth budget', () => {
  let now = 0;
  const b = bucket(20, 60_000, () => now);
  for (let i = 0; i < 20; i++) assert.equal(b.take(), 0);
  assert.equal(b.take(), 3000, 'next token in 3 s');
  now += 3000;
  assert.equal(b.take(), 0);
  assert.ok(b.take() > 0);
  const m = perMinute(() => now);
  assert.equal(m.hit('ip', 2), 0); assert.equal(m.hit('ip', 2), 0);
  assert.equal(m.hit('ip', 2), 60);
  assert.equal(m.hit('other', 2), 0);
  now += 60_000;
  assert.equal(m.hit('ip', 2), 0);
  const g = growthBudget(() => now);
  assert.equal(g.check(L.createsPerHour, 0), null);
  g.spend(L.createsPerHour - 1, 10);
  assert.equal(g.check(1, 0), null);
  assert.match(g.check(2, 0), /in the last hour/);
  now += 3600_001;
  assert.equal(g.check(L.createsPerHour, 0), null, 'the hour rolls');
});

test('the lists-sync budget lives in the injected fetch: an empty bucket means pushed:false at once, never a wait', async () => {
  const sync = await startSync();
  const v = await otherVault(sync.url);
  // 3 tokens: the connect probe, the first catch-up run, one push.
  const b = await startBridge({ syncUrl: sync.url, limits: { syncPerMin: 3 } });
  try {
    const c = b.client();
    assert.equal((await c.admin('connect', { code: v.code, tz: 'UTC' })).status, 200);
    const first = await c.tool('create_list', { title: 'one' });
    assert.equal(first.json.pushed, true);
    const t = Date.now();
    const second = await c.tool('create_list', { title: 'two' });
    assert.equal(second.json.pushed, false);
    assert.ok(Date.now() - t < 1500, 'answered without waiting for the push budget');
  } finally { await b.kill(); await sync.stop(); cleanup(b.data); cleanup(sync.dir); }
});
