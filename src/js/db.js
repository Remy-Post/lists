// db.js — IndexedDB persistence. Three stores: nodes (records), outbox (ids awaiting sync), meta (k/v).
// Writes batch for up to BATCH ms into one atomic transaction and flush as soon as the page hides,
// because Android can kill a hidden tab without another event (docs/research/02-platform.md §B).

const NAME = 'lists', VER = 1, BATCH = 250;
let dbp = null;
const q = new Map();      // id → record awaiting write
const qOut = new Set();   // ids to add to outbox
const qMeta = new Map();  // meta writes
let timer = 0, inflight = Promise.resolve();
export const metaCache = new Map();

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('nodes', { keyPath: 'id' });
      db.createObjectStore('outbox');
      db.createObjectStore('meta');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      db.onclose = () => { dbp = null; };
      res(db);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blocked'));
  });
  return dbp;
}

export async function loadAll() {
  const db = await open();
  const tx = db.transaction(['nodes', 'meta'], 'readonly');
  const nodes = req(tx.objectStore('nodes').getAll());
  const ms = tx.objectStore('meta');
  const [keys, vals] = await Promise.all([req(ms.getAllKeys()), req(ms.getAll())]);
  keys.forEach((k, i) => metaCache.set(k, vals[i]));
  return { nodes: await nodes };
}

/** Queue a record write. toOutbox: local edits that must reach the server. */
export function put(rec, toOutbox) {
  q.set(rec.id, rec);
  if (toOutbox) qOut.add(rec.id);
  schedule();
}
export function setMeta(k, v) { metaCache.set(k, v); qMeta.set(k, v); schedule(); }
export const getMeta = (k) => metaCache.get(k);

function schedule() { if (!timer) timer = setTimeout(flush, BATCH); }

/** Write everything queued now. Safe to call often. */
export function flush() {
  clearTimeout(timer); timer = 0;
  if (!q.size && !qMeta.size) return inflight;
  const recs = [...q.values()], out = [...qOut], meta = [...qMeta];
  q.clear(); qOut.clear(); qMeta.clear();
  const prev = inflight;
  inflight = (async () => {
    await prev.catch(() => {});
    const db = await open();
    const tx = db.transaction(['nodes', 'outbox', 'meta'], 'readwrite', { durability: 'strict' });
    const n = tx.objectStore('nodes'), o = tx.objectStore('outbox'), m = tx.objectStore('meta');
    // structuredClone-free: records are plain JSON already
    for (const r of recs) n.put(r);
    for (const id of out) { const r = recs.find((x) => x.id === id); o.put(r ? r.v : '', id); }
    for (const [k, v] of meta) m.put(v, k);
    if (tx.commit) tx.commit();
    await done(tx);
    writes++;
  })().catch((e) => {
    // Put the batch back so nothing is lost, and retry shortly.
    for (const r of recs) if (!q.has(r.id)) q.set(r.id, r);
    for (const id of out) qOut.add(id);
    for (const [k, v] of meta) if (!qMeta.has(k)) qMeta.set(k, v);
    dbp = null; lastError = e; setTimeout(flush, 1000);
  });
  return inflight;
}
export let writes = 0, lastError = null;
export const pendingCount = () => q.size + qMeta.size;

/** Records whose latest local version hasn't been acknowledged by the server. */
export async function getOutbox(recById) {
  await flush();
  const db = await open();
  const ids = await req(db.transaction('outbox').objectStore('outbox').getAllKeys());
  return ids.map(recById).filter(Boolean).map((r) => JSON.parse(JSON.stringify(r)));
}
/** Drop outbox entries, but only those whose version is unchanged since they were sent. */
export async function ackOutbox(sent, recById) {
  await flush();
  const db = await open();
  const tx = db.transaction('outbox', 'readwrite');
  const o = tx.objectStore('outbox');
  for (const r of sent) { const cur = recById(r.id); if (!cur || cur.v === r.v) o.delete(r.id); }
  await done(tx);
}
export async function outboxSize() {
  const db = await open();
  return req(db.transaction('outbox').objectStore('outbox').count());
}

/** Close cleanly when the page is frozen/discarded; reopen lazily. */
export function close() { if (dbp) dbp.then((db) => db.close()).catch(() => {}); dbp = null; }

export async function persisted() {
  try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
}
export async function askPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function wipe() {
  close();
  await req(indexedDB.deleteDatabase(NAME));
}
