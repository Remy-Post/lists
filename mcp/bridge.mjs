// bridge.mjs — the connector as one more paired device (MCP-PLAN §4, §10): the replica is the app's own
// module-singleton store, synced by the app's own createSync through an in-memory db adapter, persisted
// atomically to /data, encrypted with a key derived from the vault key. One process serves one vault;
// disconnect wipes the files and exits so nothing survives in memory (compose restarts it empty).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { L, bucket } from './limits.mjs';
import * as P from './persist.mjs';
import { validZone, UserError } from './guard.mjs';

// state.js reads matchMedia at load; Node has navigator but no matchMedia. The import must stay dynamic:
// a static one would be hoisted above this line. The app's modules are used unchanged.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
export const S = await import('../src/js/store.js');
export const O = await import('../src/js/ops.js');
export const A = await import('../src/js/actions.js');
const { createSync, decodeKey, deriveKeys } = await import('../src/js/sync.js');

const DATA = process.env.LISTS_MCP_DATA || '/data';
const SYNC_URL = (process.env.LISTS_SYNC_URL || 'http://lists-sync:8787').replace(/\/+$/, '');
const ENV_OWNER = (process.env.LISTS_MCP_OWNER_SHA256 || '').trim().toLowerCase();
export const PUBLIC_URL = process.env.PUBLIC_URL || 'https://lists.remypost.me/mcp';
const file = (k) => join(DATA, P.FILES[k]);
const REPLICA_AAD = 'lists-mcp/replica';
const log = (m) => console.log(`[bridge] ${m}`);
if (!ENV_OWNER) log('no owner pin (LISTS_MCP_OWNER_SHA256): the first connect claims this bridge');

/** Fresh sync device id and HLC suffix. The suffix marks connector-written text (via_connector). */
const newDev = () => { const h = randomBytes(8).toString('hex'); return { dev: 'd_mcp' + h, hlc: 'mcp' + h }; };
export const VIA_CONNECTOR = /\.mcp[0-9a-f]{16}$/;

/* ---------------- state (one vault per process) ---------------- */
let c = null;          // the connection: { code, tz, digest, fileKey, sync, meta, out, hlc, baseline, ready }
// Records (or a requeue) changed since the last save. A pushed outbox entry or a newer cursor alone doesn't
// count: losing those to a crash only re-pushes the same versions (the server ignores them, compacting
// nothing) and re-pulls rows that merge as no-ops, so a 10k replica isn't rewritten twice per write.
let dirty = false;
let inflight = null;   // the running sync, shared by everyone who asks
let timer = 0, gone = false;

/* ---------------- lists-sync budget (MCP-PLAN §10 Rate) ---------------- */
// 20 requests per 60 s, inside the fetch createSync uses: an empty bucket answers like a 429 from the
// server, so run() backs off through its own path and nothing ever waits while holding the sync lock.
const budget = bucket(L.syncPerMin, 60_000);
let blockedUntil = 0;
const tooMany = (ms) => new Response('{}', { status: 429, headers: { 'retry-after': String(Math.max(1, Math.ceil(ms / 1000))) } });
let full507 = 0;
async function syncFetch(url, init) {
  if (gone) return new Response('{}', { status: 503 });
  const wait = Math.max(0, blockedUntil - Date.now()) || budget.take();
  if (wait) return tooMany(wait);
  const r = await fetch(url, init);
  if (r.status === 429 || r.status === 503) blockedUntil = Date.now() + (+r.headers.get('retry-after') || 60) * 1000;
  // Vault full: the write that caused it is undone by the tool; stop retrying for a while (the app waits 6 h).
  if (r.status === 507) { full507++; blockedUntil = Date.now() + 15 * 60_000; }
  if (r.status === 401 && c) vaultGone(); // the pinned vault was erased: same wipe as the off switch, before anyone reads on
  return r;
}

/* ---------------- the db adapter (MCP-PLAN §10 "Sync adapter contract") ---------------- */
function adapter() {
  return {
    // Snapshots, never live records: seal() reads r.v across an await, and a tool may edit meanwhile.
    getOutbox: async () => [...c.out].map((id) => S.recs.get(id)).filter(Boolean).map((r) => structuredClone(r)),
    ackOutbox: async (sent) => {
      for (const r of sent) { const cur = S.recs.get(r.id); if (!cur || cur.v === r.v) c.out.delete(r.id); }
    },
    // Merged records are saved together with the cursor that follows them (setMeta below), in one atomic file.
    applyRemote: async (recs) => { S.mergeRemote(recs); },
    getMeta: async (k) => structuredClone(c.meta[k]),
    setMeta: async (k, v) => {
      const prev = c.meta[k] || {};
      v = structuredClone(v);
      if (c.rotateTo) v.dev = c.rotateTo; // run() keeps its own copy of the meta: re-apply a rotation it can't see
      if (v.dev !== prev.dev) dirty = true;
      c.meta[k] = v;
      if (c.baseline == null && v.lastPull) { c.baseline = S.recs.size; dirty = true; }
      save();
    },
    // The server reset (it slept through a GC, or was restored): push everything again, as a new device.
    requeueAll: async () => {
      for (const id of S.recs.keys()) if (id !== S.ROOT) c.out.add(id);
      const n = newDev();
      c.rotateTo = n.dev; c.hlc = n.hlc; S.setDevice(n.hlc);
      dirty = true;
      log('server reset: re-pushing every record under a new device id');
    },
  };
}

/* ---------------- persistence (MCP-PLAN §10 Persistence) ---------------- */
/** Save {records, cursor, outbox, dev, hlc} atomically. Skipped when nothing durable changed, unless `clean`. */
export function save(clean = false) {
  if (!c || gone || (!dirty && !clean)) return;
  const m = c.meta.sync;
  const head = {
    cursor: m.cursor || 0, outbox: [...c.out], dev: m.dev, hlc: c.hlc,
    meta: { lastPush: m.lastPush || 0, lastPull: m.lastPull || 0 }, baseline: c.baseline ?? null, clean,
  };
  P.sealChunksTo(file('replica'), c.fileKey, REPLICA_AAD, replicaJSON(S.allRecords(), head));
  dirty = false;
}
/** {"records":[…], …head} as ~64 KB string chunks. */
function* replicaJSON(records, head) {
  let buf = '{"records":[';
  for (let i = 0; i < records.length; i++) {
    buf += (i ? ',' : '') + JSON.stringify(records[i]);
    if (buf.length >= 65536) { yield buf; buf = ''; }
  }
  yield buf + '],' + JSON.stringify(head).slice(1);
}

/** The saved replica, or null when it is missing or can't be read (then the bridge starts over from 0). */
function loadReplica(fileKey) {
  const buf = P.readOr(file('replica'), null);
  if (!buf) return null;
  try {
    const r = P.unseal(fileKey, buf, REPLICA_AAD);
    return Array.isArray(r.records) && Array.isArray(r.outbox) && typeof r.dev === 'string' ? r : null;
  } catch { return null; }
}

/* ---------------- connection lifecycle ---------------- */
function setZone(tz) {
  process.env.TZ = tz;
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== tz) log('time zone alias in use');
}

/** Load (or start) the replica for `code`, hydrate the store and begin syncing. `fresh` = a new connect;
 *  `freshIds` = the device the existence probe used, so one connect leaves one device row at lists-sync. */
async function attach(code, tz, digest, fresh, freshIds) {
  if (c) throw new Error('already attached');
  clearInterval(timer);
  gone = false;
  const raw = decodeKey(code);
  const fileKey = P.localKey(raw);
  if (fresh) P.wipe(DATA, [P.FILES.replica]);
  const saved = fresh ? null : loadReplica(fileKey);
  // A fresh device id when the file is missing, corrupt or not cleanly closed, and on every connect: then
  // our own rows written before a crash come back to us as foreign rows and merge, never compact away.
  const ids = saved && saved.clean ? { dev: saved.dev, hlc: saved.hlc } : (freshIds || newDev());
  c = {
    code, tz, digest, fileKey, hlc: ids.hlc, baseline: saved ? saved.baseline : null,
    out: new Set(saved ? saved.outbox : []),
    meta: { sync: { key: raw, dev: ids.dev, cursor: saved ? saved.cursor : 0, ...(saved && saved.meta) } },
  };
  setZone(tz);
  S.setDevice(c.hlc);
  S.hydrate(saved ? saved.records : []);
  S.onPersist((r, local) => { if (local) c.out.add(r.id); dirty = true; });
  dirty = true;
  save(); // marks the file unclean until the next clean shutdown
  c.sync = createSync({ db: adapter(), base: SYNC_URL + '/api', nav: { onLine: true }, fetch: syncFetch });
  // Push whatever a crash left behind, and catch up, before tools are served (bounded by the callers).
  c.ready = runSync();
  timer = setInterval(() => { if (c && c.out.size && !inflight) runSync(); }, 5000);
  timer.unref();
}

/** Start (or join) a sync run. Resolves true when it reached the server and caught up. */
export function runSync() {
  if (!c || gone) return Promise.resolve(false);
  return (inflight ||= c.sync.syncNow().finally(() => { inflight = null; }));
}

const TIMEOUT = Symbol('timeout');
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, Math.max(0, ms), TIMEOUT).unref())]);

/** Before a tool: wait for start-up, then pull if the last pull is older than 10 s (never longer than 10 s). */
export async function fresh() {
  if (!connected()) return;
  const end = Date.now() + L.pushWaitMs;
  await within(c.ready, L.pushWaitMs);
  if (connected() && Date.now() - (c.meta.sync.lastPull || 0) >= L.pullStaleMs) await within(runSync(), end - Date.now());
}

/** After a write: push those records, one attempt of our own, ≤ 10 s. → { pushed, full } */
export async function push(ids) {
  const end = Date.now() + L.pushWaitMs, before = full507;
  for (let own = false; ; ) {
    if (!ids.some((id) => c.out.has(id))) return { pushed: true, full: false };
    if (own || Date.now() >= end || gone) break;
    own = !inflight; // a run already going may not include our records: join it, then try once ourselves
    if ((await within(runSync(), end - Date.now())) === TIMEOUT) break;
  }
  return { pushed: !ids.some((id) => c.out.has(id)), full: full507 > before };
}

export const connected = () => !!c && !gone;
export const outboxSize = () => (c ? c.out.size : 0);
/** Creates are refused above max(2 × the replica at connect, 20 000) records (MCP-PLAN §10 Growth caps). */
export const replicaCeiling = () => Math.max(2 * (c && c.baseline || 0), L.replicaFloor);
export const zone = () => (c ? c.tz : null);
export const lastSync = () => (c && (c.meta.sync.lastPull || c.meta.sync.lastPush)) || null;
export const isViaConnector = (id, k) => { const e = S.recs.get(id)?.f[k]; return !!e && VIA_CONNECTOR.test(e[1]); };

/** Keep the before-records of a permanent delete for 30 days (operator restore only; MCP-PLAN §10). */
export function bury(ids, auditId) {
  const records = [], seen = new Set(), todo = [...ids];
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id) || !S.recs.has(id) || S.val(id, 'deleted') === 'void') continue;
    seen.add(id); records.push(structuredClone(S.recs.get(id))); todo.push(...S.childrenAll(id));
  }
  try {
    P.graveAppend(file('graveyard'), c.fileKey, { t: Date.now(), audit: auditId, ids, records }, { days: L.graveyardDays, maxBytes: L.graveyardBytes });
  } catch (e) {
    if (e.code !== 'GRAVE_FULL') throw e;
    throw new UserError('Nothing was deleted: the connector’s 30-day backup of permanently deleted items is full. Move items to Trash instead, or try again after older backups expire.');
  }
  return records.length;
}

/* ---------------- teardown ---------------- */
function stop() {
  gone = true;
  clearInterval(timer);
}
/** Lists-sync answered 401 for our token: the vault was erased. Wipe like the off switch and release the pin. */
function vaultGone() {
  if (gone) return;
  log('vault gone (401 from lists-sync): wiping and exiting');
  stop();
  P.wipe(DATA, [P.FILES.key, P.FILES.replica, P.FILES.graveyard, P.FILES.owner]);
  setTimeout(() => process.exit(0), 300).unref?.(); // let the answer to the current call go out first
}
/** SIGTERM: one last save marked clean, so the next start keeps this device id. */
export function shutdown() {
  if (c && !gone) { try { save(true); } catch (e) { log(`final save failed: ${e.name}`); } }
  stop();
}

/* ---------------- admin (MCP-PLAN §4 + §10; contract in the bridge README) ---------------- */
const readJSON = (k) => { try { return JSON.parse(readFileSync(file(k), 'utf8')); } catch { return null; } };
const owner = () => ENV_OWNER || String(P.readOr(file('owner'), '')).trim() || null;
const NOT_OWNER = { error: 'This connector belongs to another Lists account' };

/** Reconnect after a restart if a key is on the volume. */
export async function boot() {
  const k = readJSON('key');
  if (!k || !decodeKey(k.code) || !validZone(k.tz)) return;
  const { tok } = await deriveKeys(decodeKey(k.code));
  const d = P.tokenDigest(tok), o = owner();
  if (o && !P.sameDigest(o, d)) { log('saved key is not the owner’s: ignoring it'); return; }
  await attach(k.code, k.tz, d, false);
  log('reconnected from the saved key');
}

/** code → its token digest, or null if it isn't a pairing code. */
async function digestOf(code) {
  const raw = typeof code === 'string' && code.length <= 128 ? decodeKey(code) : null;
  return raw ? { raw, tok: (await deriveKeys(raw)).tok } : null;
}

/* Admin ops run one at a time: the owner and connection checks are then atomic with the pin and the attach. */
let adminQ = Promise.resolve();
const serial = (fn) => (...a) => { const p = adminQ.then(() => fn(...a)); adminQ = p.catch(() => {}); return p; };

async function connectImpl(code, tz) {
  const k = await digestOf(code);
  if (!k) return [400, { error: 'That isn’t a pairing code' }];
  if (!validZone(tz)) return [400, { error: 'Unknown time zone' }];
  const d = P.tokenDigest(k.tok), o = owner();
  if (o && !P.sameDigest(o, d)) return [403, NOT_OWNER];
  if (c) {
    if (!P.sameDigest(c.digest, d)) return [403, NOT_OWNER];
    await setTzImpl(code, tz); // already connected (the app re-sends connect): only the zone can change
    return [200, { connected: true, url: PUBLIC_URL, tz }];
  }
  // Does the vault exist? Ask without `create`, so a made-up code can't make one. Push nothing, pull nothing.
  const ids = newDev();
  let r;
  try {
    r = await syncFetch(SYNC_URL + '/api/sync', {
      method: 'POST', headers: { authorization: 'Bearer ' + k.tok, 'content-type': 'application/json' },
      body: JSON.stringify({ dev: ids.dev, since: 0, push: [], pull: false }), signal: AbortSignal.timeout(10_000),
    });
  } catch { return [502, { error: 'The sync server can’t be reached' }]; }
  if (r.status === 401) return [403, NOT_OWNER];
  if (!r.ok) return [502, { error: `The sync server answered ${r.status}` }];
  if (!o) { P.atomicWrite(file('owner'), d + '\n'); log('owner pinned on first connect'); }
  P.atomicWrite(file('key'), JSON.stringify({ code, tz }));
  await attach(code, tz, d, true, ids);
  log('connected');
  return [200, { connected: true, url: PUBLIC_URL, tz }];
}

async function setTzImpl(code, tz) {
  const k = await digestOf(code);
  if (!k) return [403, NOT_OWNER];
  if (!validZone(tz)) return [400, { error: 'Unknown time zone' }];
  if (!c || !P.sameDigest(c.digest, P.tokenDigest(k.tok))) return [403, NOT_OWNER];
  if (tz !== c.tz) { c.tz = tz; setZone(tz); P.atomicWrite(file('key'), JSON.stringify({ code: c.code, tz })); }
  return [200, { tz }];
}

/** The off switch. → [status, body, exitAfter]: wipe key, replica and graveyard, keep the owner pin. */
async function disconnectImpl(code) {
  const k = await digestOf(code);
  const d = k && P.tokenDigest(k.tok), o = c ? c.digest : owner();
  if (!d || !o || !P.sameDigest(o, d)) return [403, NOT_OWNER];
  const was = !!c;
  if (was) stop(); // already off (a retried or second Disconnect): only wipe, so a later connect still works
  P.wipe(DATA, [P.FILES.key, P.FILES.replica, P.FILES.graveyard]);
  log('disconnected: key, replica and graveyard wiped');
  return [200, { connected: false }, was];
}
export const connect = serial(connectImpl);
export const setTz = serial(setTzImpl);
export const disconnect = serial(disconnectImpl);

export const status = () => ({ connected: connected(), lastSync: lastSync(), url: PUBLIC_URL });
export const dataDir = DATA;
