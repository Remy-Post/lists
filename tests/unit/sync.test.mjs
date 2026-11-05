// node --test tests/unit/sync.test.mjs
// Real server (python3 server/sync_server.py on a random port, temp db) + fake db + injected navigator/time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createSync, encodeKey, decodeKey, deriveKeys, seal, unseal } from '../../src/js/sync.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
let srv;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lists-sync-'));
  const db = join(dir, 't.db');
  const p = spawn('python3', ['-I', join(ROOT, 'server/sync_server.py')], {
    env: { ...process.env, LISTS_DB: db, LISTS_PORT: '0', LISTS_HOST: '127.0.0.1', LISTS_NEW_VAULTS: '1000', LISTS_FAIL_MAX: '1000' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const port = await new Promise((res, rej) => {
    p.stdout.once('data', (d) => res(+String(d).match(/:(\d+)/)[1]));
    p.once('exit', rej);
  });
  srv = { p, dir, db, base: `http://127.0.0.1:${port}/api` };
});

after(async () => {
  await new Promise((r) => (srv.p.once('exit', r), srv.p.kill('SIGTERM')));
  rmSync(srv.dir, { recursive: true, force: true });
});

// ---- fakes ----------------------------------------------------------------------------------
let tick = 0;
const stamp = (dev) => String(++tick).padStart(8, '0') + dev;

function fakeDB(dev) {
  const nodes = new Map(), outbox = new Map(), meta = new Map(), clone = structuredClone;
  const maxV = (f) => Object.values(f).reduce((m, x) => (x[1] > m ? x[1] : m), '');
  return {
    nodes, outbox, meta, applied: 0,
    edit(id, field, value) {
      const r = nodes.get(id) || { id, f: {} };
      r.f[field] = [value, stamp(dev)], r.v = maxV(r.f);
      nodes.set(id, r), outbox.set(id, clone(r));
    },
    title: (id) => nodes.get(id)?.f.title[0],
    async getOutbox() { return [...outbox.values()].map((r) => clone(r)); },
    async ackOutbox(recs) { for (const r of recs) if (outbox.get(r.id)?.v === r.v) outbox.delete(r.id); },
    async applyRemote(recs) {
      for (const r of recs) {
        this.applied++;
        if (r.f === null) { nodes.delete(r.id); continue; }
        const l = nodes.get(r.id), f = { ...(l?.f || {}) };
        for (const [k, x] of Object.entries(r.f)) if (!f[k] || x[1] > f[k][1]) f[k] = x;
        const m = { id: r.id, f, v: maxV(f) };
        nodes.set(r.id, m);
        if (m.v !== r.v) outbox.set(r.id, clone(m)); // we hold newer fields: push them back
      }
    },
    async getMeta(k) { return clone(meta.get(k)); },
    async setMeta(k, v) { meta.set(k, clone(v)); },
  };
}

function device(name, opts = {}) {
  const db = fakeDB(name), statuses = [], calls = [];
  const clock = { t: Date.now() };
  const nav = { onLine: true, connection: { type: 'wifi', effectiveType: '4g', rtt: 50, saveData: false }, ...opts.nav };
  const sync = createSync({
    db, base: srv.base, nav, now: () => clock.t, onStatus: (s) => (process.env.DBG && console.log(name, s.state, s.message), statuses.push(s)),
    fetch: (url, init = {}) => (calls.push({ url, init }), fetch(url, init)),
  });
  return { name, db, sync, statuses, calls, clock, nav, last: () => statuses.at(-1), syncs: () => calls.filter((c) => c.url.endsWith('/sync')).length };
}

const bodyOf = (init) => {
  const b = Buffer.from(init.body);
  return JSON.parse(init.headers['content-encoding'] === 'gzip' ? gunzipSync(b) : b);
};

// ---- pure pieces ----------------------------------------------------------------------------
test('pairing code: 52 Crockford base32 chars in groups of 4, round-trips, forgiving input', () => {
  const k = crypto.getRandomValues(new Uint8Array(32));
  const code = encodeKey(k);
  assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(decodeKey(code), k);
  assert.deepEqual(decodeKey(code.toLowerCase().replace(/-/g, ' ')), k);
  assert.deepEqual(decodeKey(encodeKey(new Uint8Array(32)).replace(/0/g, 'O')), new Uint8Array(32));
  assert.equal(decodeKey(code.slice(0, -1)), null);
  assert.equal(decodeKey(code.slice(0, -1) + 'U'), null);
  assert.equal(decodeKey(code.slice(0, -1) + 'Z'), null); // non-zero padding bits
});

test('keys: deterministic hex token, non-extractable AES key, AAD binds id|v', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const a = await deriveKeys(raw), b = await deriveKeys(raw);
  assert.match(a.tok, /^[0-9a-f]{64}$/);
  assert.equal(a.tok, b.tok);
  assert.equal(a.key.extractable, false);
  assert.deepEqual(a.key.algorithm, { name: 'AES-GCM', length: 256 });
  const rec = { id: 'n1', f: { title: ['secret', 'h1'] }, v: 'h1' };
  const row = await seal(a.key, rec);
  assert.deepEqual(await unseal(b.key, row), rec);
  assert.notEqual((await seal(a.key, rec)).b, row.b); // fresh IV every time
  await assert.rejects(unseal(a.key, { ...row, id: 'n2' }));
  await assert.rejects(unseal(a.key, { ...row, v: 'h2' }));
  await assert.rejects(unseal((await deriveKeys(new Uint8Array(32))).key, row));
  assert.deepEqual(await seal(a.key, { id: 'p', v: 'h9', f: null }), { id: 'p', v: 'h9', b: null });
});

// ---- full round trip ------------------------------------------------------------------------
test('two devices: create, join, edit both ways, server never sees plaintext', async () => {
  const A = device('A'), B = device('B');
  A.db.edit('n1', 'title', 'Buy oat milk PLAINTEXT-1');
  A.db.edit('n2', 'title', 'Call the dentist PLAINTEXT-2');
  A.db.edit('n2', 'notes', 'x'.repeat(2000)); // forces a gzip body
  assert.equal(await A.sync.pairingCode(), null);
  const code = await A.sync.createVault();
  assert.equal(await A.sync.pairingCode(), code);
  assert.equal(await A.sync.syncNow(), true);
  assert.equal(A.db.outbox.size, 0);
  assert.equal(A.last().state, 'idle');
  const first = A.calls.find((c) => c.url.endsWith('/sync'));
  assert.equal(first.init.headers['content-encoding'], 'gzip');
  assert.match(first.init.headers.authorization, /^Bearer [0-9a-f]{64}$/);
  assert.equal(bodyOf(first.init).create, true);

  await B.sync.join(code.toLowerCase());
  assert.equal(B.db.title('n1'), 'Buy oat milk PLAINTEXT-1');
  assert.equal(B.db.nodes.get('n2').f.notes[0].length, 2000);
  assert.ok(!('create' in bodyOf(B.calls.find((c) => c.url.endsWith('/sync')).init)));

  B.db.edit('n1', 'title', 'Buy soy milk PLAINTEXT-3');
  B.db.edit('n3', 'title', 'New on B PLAINTEXT-4');
  assert.equal(await B.sync.syncNow(), true);
  assert.equal(await A.sync.syncNow(), true);
  assert.equal(A.db.title('n1'), 'Buy soy milk PLAINTEXT-3');
  assert.equal(A.db.title('n3'), 'New on B PLAINTEXT-4');

  // concurrent edits to different fields of one item merge; same field: later stamp wins
  A.db.edit('n2', 'title', 'Dentist (A) PLAINTEXT-5');
  B.db.edit('n2', 'done', true);
  await A.sync.syncNow(); await B.sync.syncNow(); await A.sync.syncNow();
  for (const D of [A, B]) {
    assert.equal(D.db.title('n2'), 'Dentist (A) PLAINTEXT-5');
    assert.equal(D.db.nodes.get('n2').f.done[0], true);
  }
  assert.deepEqual(A.db.nodes.get('n2'), B.db.nodes.get('n2'));

  // nothing on the wire or on disk is readable
  const wire = [...A.calls, ...B.calls].filter((c) => c.init.body).map((c) => JSON.stringify(bodyOf(c.init))).join('');
  const disk = [srv.db, srv.db + '-wal'].filter(existsSync).map((p) => readFileSync(p).toString('latin1')).join('');
  const tok = A.calls[0].init.headers.authorization.slice(7);
  for (const s of ['PLAINTEXT', 'oat milk', 'dentist', tok]) {
    assert.ok(!wire.includes(s), 'wire leaks ' + s);
    assert.ok(!disk.includes(s), 'disk leaks ' + s);
  }
});

test('paging: 1,200 records push in ≤200-row requests and pull in 500-row pages', async () => {
  const A = device('A'), B = device('B');
  for (let i = 0; i < 1200; i++) A.db.edit('p' + i, 'title', 'item ' + i);
  const code = await A.sync.createVault();
  assert.equal(await A.sync.syncNow(), true);
  assert.equal(A.db.outbox.size, 0);
  const pushes = A.calls.filter((c) => c.url.endsWith('/sync')).map((c) => bodyOf(c.init).push.length);
  assert.ok(Math.max(...pushes) <= 200, String(pushes));
  assert.equal(pushes.reduce((a, b) => a + b), 1200);
  await B.sync.join(code);
  assert.equal(B.db.nodes.size, 1200);
  assert.deepEqual(B.calls.filter((c) => c.url.endsWith('/sync')).length, 3); // pages of 500 + 500 + 200
});

test('reject unknown or malformed pairing codes without creating a vault', async () => {
  const B = device('B');
  await assert.rejects(B.sync.join('not a code'), /Invalid pairing code/);
  await assert.rejects(B.sync.join(encodeKey(crypto.getRandomValues(new Uint8Array(32)))), /Unknown pairing code/);
  assert.equal(await B.sync.pairingCode(), null);
  assert.equal(B.last().state, 'unpaired');
});

test('tampered rows are skipped and reported, not applied', async () => {
  const A = device('A');
  A.db.edit('t1', 'title', 'one'); A.db.edit('t2', 'title', 'two');
  const code = await A.sync.createVault();
  await A.sync.syncNow();
  // B swaps the two blobs in the response, as a malicious server would
  const swap = device('B2');
  const sync = createSync({
    db: swap.db, base: srv.base, nav: swap.nav, now: () => Date.now(),
    onStatus: (s) => swap.statuses.push(s),
    fetch: async (url, init) => {
      const r = await fetch(url, init);
      if (!url.endsWith('/sync')) return r;
      const js = await r.json();
      if (js.rows?.length === 2) [js.rows[0].b, js.rows[1].b] = [js.rows[1].b, js.rows[0].b];
      return new Response(JSON.stringify(js), { status: r.status });
    },
  });
  await sync.join(code);
  assert.equal(swap.db.nodes.size, 0);
  assert.match(swap.last().message, /2 rows failed to decrypt/);
});

test('server reset (cursor from before a GC or another server) re-pulls from 0', async () => {
  const A = device('A'), B = device('B');
  A.db.edit('r1', 'title', 'kept');
  const code = await A.sync.createVault();
  await A.sync.syncNow();
  await B.sync.join(code);
  B.db.nodes.clear();
  const m = B.db.meta.get('sync');
  B.db.meta.set('sync', { ...m, cursor: 1e12 });
  assert.equal(await B.sync.syncNow(), true);
  assert.equal(B.db.title('r1'), 'kept');
  assert.ok(B.db.meta.get('sync').cursor < 1e12);
});

test('unpair(true) erases the server copy; the other device then stops with an error', async () => {
  const A = device('A'), B = device('B');
  A.db.edit('u1', 'title', 'x');
  const code = await A.sync.createVault();
  await A.sync.syncNow();
  await B.sync.join(code);
  await A.sync.unpair(true);
  assert.equal(await A.sync.pairingCode(), null);
  assert.equal(A.last().state, 'unpaired');
  B.db.edit('u2', 'title', 'y');
  assert.equal(await B.sync.syncNow(), false);
  assert.equal(B.last().state, 'error');
  // halted after a 401: the automatic gate no longer hammers the server
  B.clock.t += 60 * 60e3;
  const n = B.syncs();
  await B.sync.maybeSync('timer');
  assert.equal(B.syncs(), n);
});

test('flushOnHide: keepalive push under 64 KiB, push only, then acks', async () => {
  const A = device('A');
  const code = await A.sync.createVault();
  await A.sync.syncNow(); void code;
  A.db.edit('h1', 'title', 'typed just before hiding');
  assert.equal(await A.sync.flushOnHide(), true);
  const c = A.calls.at(-1);
  assert.equal(c.init.keepalive, true);
  assert.equal(bodyOf(c.init).pull, false);
  assert.ok(Buffer.from(c.init.body).length < 65536);
  assert.equal(A.db.outbox.size, 0);
  // too big for keepalive: nothing sent, outbox kept for the next open
  for (let i = 0; i < 150; i++) A.db.edit('big' + i, 'notes', crypto.getRandomValues(new Uint8Array(400)).join(','));
  const n = A.calls.length;
  assert.equal(await A.sync.flushOnHide(), false);
  assert.equal(A.calls.length, n);
  assert.equal(A.db.outbox.size, 150);
  // poor link: skip
  A.nav.connection = { effectiveType: '3g', rtt: 500 };
  A.db.outbox.clear(); A.db.edit('h2', 'title', 'z');
  assert.equal(await A.sync.flushOnHide(), false);
});

// ---- the gate -------------------------------------------------------------------------------
async function pairedDevice(nav) {
  const D = device('G', { nav });
  await D.sync.createVault();
  await D.sync.syncNow();
  return D;
}
const step = (D, ms) => (D.clock.t += ms);

test('gate: unpaired and offline never touch the network', async () => {
  const D = device('U');
  await D.sync.maybeSync('timer');
  assert.equal(D.last().state, 'unpaired');
  const P = await pairedDevice();
  P.nav.onLine = false;
  const n = P.calls.length;
  step(P, 60 * 60e3);
  await P.sync.maybeSync('timer');
  assert.equal(P.last().state, 'offline');
  assert.equal(await P.sync.linkQuality(), 'offline');
  assert.equal(P.calls.length, n);
});

test('gate: push after the outbox has been dirty 2 min; pull after 15 min', async () => {
  const D = await pairedDevice();
  const n0 = D.syncs();
  step(D, 5e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n0, 'fresh and clean: no request');
  D.db.edit('g1', 'title', 'dirty');
  step(D, 5e3); await D.sync.maybeSync('edit');   // first sight of the dirty outbox
  step(D, 60e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n0, '1 min dirty: still local');
  step(D, 61e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n0 + 1, '2 min dirty: pushed');
  assert.equal(D.db.outbox.size, 0);
  step(D, 14 * 60e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n0 + 1);
  step(D, 61e3); await D.sync.maybeSync('visible');
  assert.equal(D.syncs(), n0 + 2, '15 min since last pull: pulled');
});

test('gate: maybeSync is throttled to one check per 2 s', async () => {
  const D = await pairedDevice();
  let reads = 0;
  const g = D.db.getOutbox.bind(D.db);
  D.db.getOutbox = () => (reads++, g());
  step(D, 3e3);
  await Promise.all([D.sync.maybeSync('a'), D.sync.maybeSync('b'), D.sync.maybeSync('c')]);
  assert.equal(reads, 1);
});

test('gate: link quality from navigator.connection', async () => {
  const D = await pairedDevice();
  const q = async (c) => ((D.nav.connection = c), D.sync.linkQuality());
  assert.equal(await q({ type: 'wifi', effectiveType: '3g' }), 'good');
  assert.equal(await q({ type: 'ethernet' }), 'good');
  assert.equal(await q({ type: 'cellular', effectiveType: '4g', rtt: 100 }), 'good');
  assert.equal(await q({ effectiveType: '4g', rtt: 300 }), 'good');     // Chrome on the Mac: no `type`
  assert.equal(await q({ effectiveType: '4g', rtt: 350 }), 'poor');
  assert.equal(await q({ effectiveType: '3g', rtt: 200 }), 'poor');
  assert.equal(await q({ effectiveType: 'slow-2g', rtt: 2000 }), 'poor'); // DevTools "3G" reads like this
  assert.equal(await q({ type: 'wifi', saveData: true }), 'poor');
  assert.equal(await q({ type: 'none' }), 'offline');
});

test('gate: no Network Information API → timed GET /api/health (cached 30 s)', async () => {
  const D = await pairedDevice({ connection: undefined });
  const n = D.calls.length;
  assert.equal(await D.sync.linkQuality(), 'good'); // localhost
  assert.ok(D.calls.slice(n).every((c) => c.url.endsWith('/health')));
  const m = D.calls.length;
  assert.equal(await D.sync.linkQuality(), 'good');
  assert.equal(D.calls.length, m);
  step(D, 31e3);
  await D.sync.linkQuality();
  assert.ok(D.calls.length > m);
});

test('gate: poor link waits; stale + good link syncs', async () => {
  const D = await pairedDevice({ connection: { effectiveType: '3g', rtt: 600 } });
  const n = D.syncs();
  step(D, 20 * 60e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n);
  assert.equal(D.last().message, 'Waiting for a good connection');
  D.nav.connection = { effectiveType: '4g', rtt: 100 };
  step(D, 3e3); await D.sync.maybeSync('change');
  assert.equal(D.syncs(), n + 1);
});

test('gate: backup older than 3 days relaxes "good" to online && !saveData && !2g', async () => {
  const D = await pairedDevice({ connection: { effectiveType: '3g', rtt: 600 } });
  const n = D.syncs();
  step(D, 3 * 86400e3 + 60e3);
  D.nav.connection = { effectiveType: '2g', rtt: 1500 };
  await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n, '2g: still waits');
  D.nav.connection = { effectiveType: '3g', rtt: 600, saveData: true };
  step(D, 3e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n, 'Save-Data: still waits');
  D.nav.connection = { effectiveType: '3g', rtt: 600 };
  step(D, 3e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n + 1, '3g with an old backup: syncs');
  assert.ok(D.last().backupAgeMs < 1e3);
  step(D, 20 * 60e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n + 1, 'backup fresh again: back to the strict gate');
});

test('manual syncNow ignores staleness and link quality, but not offline', async () => {
  const D = await pairedDevice({ connection: { effectiveType: 'slow-2g', rtt: 2000 } });
  const n = D.syncs();
  assert.equal(await D.sync.syncNow(), true);
  assert.equal(D.syncs(), n + 1);
  D.nav.onLine = false;
  assert.equal(await D.sync.syncNow(), false);
  assert.equal(D.last().state, 'offline');
});

test('status shape', async () => {
  const D = await pairedDevice();
  const s = D.last();
  assert.deepEqual(Object.keys(s).sort(), ['backupAgeMs', 'lastPull', 'lastPush', 'message', 'state']);
  assert.ok(s.lastPush > 0 && s.lastPull > 0);
  assert.ok(D.statuses.some((x) => x.state === 'syncing'));
});

test('Web Locks: concurrent syncs serialise; maybeSync skips while another sync holds the lock', async () => {
  const D = await pairedDevice({ locks: navigator.locks });
  D.db.edit('w1', 'title', 'w');
  const [a, b] = await Promise.all([D.sync.syncNow(), D.sync.syncNow()]);
  assert.equal(a && b, true);
  assert.equal(D.db.outbox.size, 0);
  step(D, 20 * 60e3);                       // stale: maybeSync would sync if it could take the lock
  const n = D.syncs();
  let release;
  const held = navigator.locks.request('lists-sync', () => new Promise((r) => (release = r)));
  await new Promise((r) => setTimeout(r, 10));
  await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n);
  release(); await held;
  step(D, 3e3); await D.sync.maybeSync('timer');
  assert.equal(D.syncs(), n + 1);
});
