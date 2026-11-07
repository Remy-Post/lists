// store.js — the in-memory replica.
// One flat record per node: { id, f: { field: [value, hlc] }, v: hlc }.
// Lists are nodes whose parent is ROOT; any node can have children, at any depth.
// Merge is per-field last-writer-wins on hybrid logical clocks (docs/research/04-architecture.md §2).

export const ROOT = 'root';
export const INBOX = 'inbox';

/* ---------------- Hybrid logical clock ---------------- */
// "ms36(9).ctr36(4).device" — fixed-width, so plain string compare orders stamps.
let device = 'd0', lastMs = 0, ctr = 0;
export const setDevice = (d) => { device = d; };
const stamp = (ms, c) => ms.toString(36).padStart(9, '0') + '.' + c.toString(36).padStart(4, '0') + '.' + device;
export function tick() {
  const now = Date.now();
  if (now > lastMs) { lastMs = now; ctr = 0; } else ctr++;
  return stamp(lastMs, ctr);
}
function observe(h) {
  if (typeof h !== 'string') return;
  const [a, b] = h.split('.');
  const ms = parseInt(a, 36), c = parseInt(b, 36);
  if (!(ms <= Date.now() + 864e5) || !(c >= 0) || c > 1e6) return; // ignore corrupt or far-future stamps
  if (ms > lastMs) { lastMs = ms; ctr = c; } else if (ms === lastMs && c > ctr) ctr = c;
}

/* ---------------- Fractional index (Greenspan / rocicorp, CC0) ---------------- */
const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function mid(a, b) {
  if (b != null) {
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const da = a ? D.indexOf(a[0]) : 0, db = b != null ? D.indexOf(b[0]) : D.length;
  if (db - da > 1) return D[Math.round((da + db) / 2)];
  if (b && b.length > 1) return b.slice(0, 1);
  return D[da] + mid(a.slice(1), null);
}
const intLen = (h) => h >= 'a' ? h.charCodeAt(0) - 95 : 92 - h.charCodeAt(0); // a→2 … z→27, Z→2 … A→27
const intPart = (k) => k.slice(0, intLen(k[0]));
function incInt(x) {
  const h = x[0], d = x.slice(1).split('');
  let carry = true;
  for (let i = d.length - 1; carry && i >= 0; i--) {
    const n = D.indexOf(d[i]) + 1;
    if (n === D.length) d[i] = '0'; else { d[i] = D[n]; carry = false; }
  }
  if (!carry) return h + d.join('');
  if (h === 'Z') return 'a0';
  if (h === 'z') return null;
  const nh = String.fromCharCode(h.charCodeAt(0) + 1);
  if (nh > 'a') d.push('0'); else d.pop();
  return nh + d.join('');
}
function decInt(x) {
  const h = x[0], d = x.slice(1).split('');
  let borrow = true;
  for (let i = d.length - 1; borrow && i >= 0; i--) {
    const n = D.indexOf(d[i]) - 1;
    if (n === -1) d[i] = 'z'; else { d[i] = D[n]; borrow = false; }
  }
  if (!borrow) return h + d.join('');
  if (h === 'a') return 'Zz';
  if (h === 'A') return null;
  const nh = String.fromCharCode(h.charCodeAt(0) - 1);
  if (nh < 'Z') d.push('z'); else d.pop();
  return nh + d.join('');
}
export function keyBetween(a, b) {
  if (a == null && b == null) return 'a0';
  if (a == null) {
    const ib = intPart(b), fb = b.slice(ib.length);
    if (ib === 'A' + '0'.repeat(26)) return ib + mid('', fb);
    if (ib < b) return ib;
    return decInt(ib);
  }
  if (b == null) {
    const ia = intPart(a), fa = a.slice(ia.length), i = incInt(ia);
    return i == null ? ia + mid(fa, null) : i;
  }
  const ia = intPart(a), fa = a.slice(ia.length), ib = intPart(b), fb = b.slice(ib.length);
  if (ia === ib) return ia + mid(fa, fb);
  const i = incInt(ia);
  return i != null && i < b ? i : ia + mid(fa, null);
}

/* ---------------- Records ---------------- */
export const DEF = {
  kind: 'item', pos: null, title: '', notes: '', done: false, doneAt: null,
  when: null, evening: false, someday: false, deadline: null, time: null,
  rrule: null, repeatFrom: 'when', priority: 0, heading: false, tags: null,
  deleted: false, deletedAt: null, created: 0, color: null,
};
export const recs = new Map();
const kids = new Map();   // effective parent → sorted child ids (includes deleted; filter on read)
const eff = new Map();    // id → effective parent (after cycle repair)
export const val = (id, k) => { const r = recs.get(id); const e = r && r.f[k]; return e ? e[0] : DEF[k]; };
const posOf = (r) => (r.f.pos && r.f.pos[0]) || { parent: INBOX, key: 'a0' };
const cmp = (x, y) => {
  const a = posOf(recs.get(x)).key, b = posOf(recs.get(y)).key;
  return a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0;
};

let persistHook = () => {};
export const onPersist = (fn) => { persistHook = fn; };
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let pending = null, pendingStructural = false, pendingFields = null;
export let version = 0;
const QUIET = new Set(['title', 'notes', 'priority', 'tags', 'rrule', 'repeatFrom', 'time', 'color', 'created', 'origin']);
const revs = new Map();
/** Local revision of a record: bumps on every local patch and every merged remote change. */
export const rev = (id) => revs.get(id) || 0;
function changed(id, structural, fields) {
  version++;
  revs.set(id, (revs.get(id) || 0) + 1);
  // Typing a title can't change counts or smart views, so it keeps the memo (QA B1: no 10k walk per key).
  if (structural || !fields || fields.some((f) => !QUIET.has(f))) memo.clear();
  if (structural) { pendingStructural = true; orderCache = null; }
  (pending ||= new Set()).add(id);
  pendingFields ||= new Set();
  if (fields) for (const f of fields) pendingFields.add(f); else pendingFields.add('*');
  queueMicrotask(flushSubs);
}
function flushSubs() {
  if (!pending) return;
  const ids = pending, s = pendingStructural, f = pendingFields;
  pending = null; pendingStructural = false; pendingFields = null;
  for (const fn of subs) fn(ids, s, f);
}
/* Per-version memo for whole-tree queries (cleared on every change). */
const memo = new Map();
const memoize = (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); };

export const newId = () => 'n' + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(2)).reduce((s, x) => s + x.toString(36), '');

/** Write fields locally. Returns the record. */
export function patch(id, fields) {
  let r = recs.get(id);
  const h = tick();
  let structural = !r;
  if (!r) { r = { id, f: {}, v: h }; recs.set(id, r); }
  const oldParent = eff.get(id);
  const wasVoid = r.f.deleted && r.f.deleted[0] === 'void';
  for (const k in fields) {
    r.f[k] = [fields[k], h];
    if (k === 'pos' || k === 'deleted') structural = true;
  }
  r.v = h;
  // A void node's children fall back to the Inbox, so voiding or un-voiding re-parents its subtree.
  if (wasVoid !== (r.f.deleted && r.f.deleted[0] === 'void') && childrenAll(id).length) rebuild();
  else if (structural) reparent(id, oldParent);
  persistHook(r, true);
  changed(id, structural, Object.keys(fields));
  return r;
}

/** Merge records pulled from another device. */
export function mergeRemote(list) {
  let structural = false;
  const touched = [];
  for (const inc of list) {
    if (!inc || typeof inc.id !== 'string' || !inc.f) continue;
    let r = recs.get(inc.id), any = false;
    if (!r) { r = { id: inc.id, f: {}, v: '' }; recs.set(inc.id, r); structural = true; }
    for (const k in inc.f) {
      const e = inc.f[k];
      if (!Array.isArray(e)) continue;
      observe(e[1]);
      if (!r.f[k] || e[1] > r.f[k][1]) {
        r.f[k] = [e[0], e[1]]; any = true;
        if (k === 'pos' || k === 'deleted') structural = true;
      }
    }
    if (any) {
      r.v = Object.values(r.f).reduce((m, e) => (e[1] > m ? e[1] : m), '');
      persistHook(r, false);
      touched.push(r.id);
    }
  }
  if (structural) rebuild();
  for (const id of touched) changed(id, structural, null);
  return touched.length;
}

/** Load from disk (no persistence, no events). */
export function hydrate(list) {
  recs.clear();
  for (const r of list) { recs.set(r.id, r); for (const k in r.f) observe(r.f[k][1]); }
  rebuild();
}

/* ---------------- Tree index ---------------- */
function rawParent(id) {
  if (id === INBOX) return ROOT;
  const p = posOf(recs.get(id)).parent;
  if (p === ROOT) return p;
  const pr = recs.get(p);
  return pr && !(pr.f.deleted && pr.f.deleted[0] === 'void') ? p : INBOX;
}
function insertSorted(p, id) {
  let arr = kids.get(p);
  if (!arr) kids.set(p, (arr = []));
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(arr[m], id) < 0) lo = m + 1; else hi = m; }
  arr.splice(lo, 0, id);
}
function reparent(id, oldParent) {
  if (oldParent !== undefined) {
    const arr = kids.get(oldParent);
    if (arr) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); }
  }
  const p = rawParent(id);
  // Local moves are validated by canMove(); if something still forms a cycle, rebuild repairs it.
  if (p !== ROOT && !canMove(id, p)) { rebuild(); return; }
  eff.set(id, p);
  insertSorted(p, id);
}
const pstamp = (id) => { const e = recs.get(id).f.pos; return e ? e[1] : ''; };
function rebuild() {
  eff.clear(); kids.clear(); orderCache = null;
  for (const id of recs.keys()) eff.set(id, rawParent(id));
  // Concurrent moves on two devices can form a cycle neither saw. Break it deterministically:
  // the most recent move in the cycle loses and falls back to its previous parent, then to Inbox.
  for (const id of recs.keys()) {
    for (let guard = 0; guard < 64; guard++) {
      const seen = new Set();
      let cur = id, cyc = null;
      while (cur !== ROOT) {
        if (seen.has(cur)) { cyc = cur; break; }
        seen.add(cur); cur = eff.get(cur) ?? ROOT;
      }
      if (!cyc) break;
      const ring = []; let c = cyc;
      do { ring.push(c); c = eff.get(c); } while (c !== cyc);
      ring.sort((a, b) => (pstamp(b) > pstamp(a) ? 1 : pstamp(b) < pstamp(a) ? -1 : b > a ? 1 : -1));
      const loser = ring[0], prev = posOf(recs.get(loser)).prev;
      eff.set(loser, prev === ROOT ? ROOT : prev && prev !== loser && recs.has(prev) && !reaches(prev, loser) ? prev : INBOX);
    }
  }
  for (const [id, p] of eff) { let a = kids.get(p); if (!a) kids.set(p, (a = [])); a.push(id); }
  for (const a of kids.values()) a.sort(cmp);
}
function reaches(from, target) { // does walking up from `from` hit `target`?
  const seen = new Set();
  for (let c = from; c && c !== ROOT && !seen.has(c); c = eff.get(c)) { if (c === target) return true; seen.add(c); }
  return false;
}

export const parentOf = (id) => eff.get(id) ?? ROOT;
export const isLiveSelf = (id) => recs.has(id) && !val(id, 'deleted');
export function isLive(id) {
  for (let c = id, i = 0; c && c !== ROOT && i < 4096; c = eff.get(c), i++) if (!recs.has(c) || val(c, 'deleted')) return false;
  return true;
}
export const childrenAll = (id) => kids.get(id) || [];
export const children = (id) => childrenAll(id).filter(isLiveSelf);
export const hasChildren = (id) => childrenAll(id).some(isLiveSelf);
export function ancestors(id) { // nearest-last, excluding ROOT
  const out = [];
  for (let c = eff.get(id); c && c !== ROOT && out.length < 4096; c = eff.get(c)) out.unshift(c);
  return out;
}
export function canMove(id, newParent) {
  if (id === INBOX || id === ROOT) return false;
  const seen = new Set();
  for (let c = newParent; c && c !== ROOT && !seen.has(c); c = eff.get(c)) { if (c === id) return false; seen.add(c); }
  return true;
}
export function doneEff(id) {
  for (let c = id; c && c !== ROOT; c = eff.get(c)) if (val(c, 'done')) return true;
  return false;
}
/* One allocation-free walk per store version gives both the open count under every node and the list of
   open items for the smart views (it used to be two walks with filtered arrays at every level). */
const fv = (r, k) => { const e = r.f[k]; return e ? e[0] : DEF[k]; };
function treeStats() {
  return memoize('tree', () => {
    const open = new Map(), items = [];
    const walk = (p, doneAbove) => {
      let n = 0;
      const arr = kids.get(p);
      if (arr) for (let i = 0; i < arr.length; i++) {
        const c = arr[i], r = recs.get(c);
        if (!r || fv(r, 'deleted')) continue;
        const kind = fv(r, 'kind'), done = fv(r, 'done'), heading = fv(r, 'heading');
        const d = doneAbove || done;
        if (!d && !heading && kind === 'item') items.push(c);
        const sub = walk(c, d);
        if (kind !== 'log') n += sub + (!done && !heading ? 1 : 0);
      }
      open.set(p, n);
      return n;
    };
    walk(ROOT, false);
    return { open, items };
  });
}
/** Open descendants (any depth): O(1) per call after one walk per store version. */
export function countOpen(id) { return treeStats().open.get(id) || 0; }
export function descendants(id, out = []) { for (const c of children(id)) { out.push(c); descendants(c, out); } return out; }

/** Position for inserting into `parent` between siblings `before` and `after` (ids or null). */
export function posBetween(parent, beforeId, afterId, prevParent = null) {
  let a = beforeId ? posOf(recs.get(beforeId)).key : null;
  let b = afterId ? posOf(recs.get(afterId)).key : null;
  if (a != null && b != null && a >= b) { rekey(parent); a = posOf(recs.get(beforeId)).key; b = posOf(recs.get(afterId)).key; }
  return { parent, key: keyBetween(a, b), prev: prevParent };
}
/** Position at index `i` among the live children of `parent`, ignoring `skip`. */
export function posAt(parent, i, skip, prevParent = null) {
  const sib = children(parent).filter((x) => x !== skip);
  i = Math.max(0, Math.min(i, sib.length));
  return posBetween(parent, sib[i - 1] || null, sib[i] || null, prevParent);
}
function rekey(parent) { // rare: two devices inserted at the same spot with equal keys
  let k = null;
  for (const id of [...childrenAll(parent)]) {
    k = keyBetween(k, null);
    const p = posOf(recs.get(id));
    patch(id, { pos: { parent: p.parent, key: k, prev: p.prev } });
  }
}

/* ---------------- Ordering & queries ---------------- */
let orderCache = null;
/** Document order of every live node, for stable sorting in smart views. */
export function order() {
  if (orderCache) return orderCache;
  const m = new Map(); let i = 0;
  const walk = (p) => { for (const c of children(p)) { m.set(c, i++); walk(c); } };
  walk(ROOT);
  return (orderCache = m);
}
const byOrder = (a, b) => (order().get(a) ?? 0) - (order().get(b) ?? 0);

function liveOpenItems() { return treeStats().items; }
function liveOpenItemsRaw() {
  const out = [];
  const walk = (p, doneAbove) => {
    for (const c of children(p)) {
      const d = doneAbove || val(c, 'done');
      if (!d && !val(c, 'heading') && val(c, 'kind') === 'item') out.push(c);
      walk(c, d);
    }
  };
  walk(ROOT, false);
  return out;
}
/** Today: scheduled on/before today, or deadline on/before today. Split by evening. */
export function qToday(today) { return memoize('today:' + today, () => qTodayRaw(today)); }
function qTodayRaw(today) {
  const day = [], eve = [];
  for (const id of liveOpenItems()) {
    const w = val(id, 'when'), dl = val(id, 'deadline');
    if ((w && w <= today) || (dl && dl <= today)) (val(id, 'evening') && w && w <= today ? eve : day).push(id);
  }
  day.sort(byOrder); eve.sort(byOrder);
  return { day, eve };
}
/** Items done today that would have been in Today (for the "struck through" view). */
export function qDoneToday(todayStart) {
  const out = [];
  for (const [id] of recs) if (isLive(id) && val(id, 'done') && (val(id, 'doneAt') || 0) >= todayStart && (val(id, 'kind') === 'item' || val(id, 'kind') === 'log')) out.push(id);
  return out.sort((a, b) => val(a, 'doneAt') - val(b, 'doneAt'));
}
export function qUpcoming(today) {
  const m = new Map();
  for (const id of liveOpenItems()) {
    const w = val(id, 'when'), dl = val(id, 'deadline');
    const d = [w, dl].filter((x) => x && x > today).sort()[0];
    if (!d) continue;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(id);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, ids]) => [d, ids.sort(byOrder)]);
}
export function qOverdue(today) {
  return liveOpenItems().filter((id) => { const w = val(id, 'when'), dl = val(id, 'deadline'); return (w && w < today) || (dl && dl < today); });
}
export function qLogbook(limit = 400) {
  const out = [];
  for (const [id] of recs) if (isLive(id) && val(id, 'done') && (val(id, 'kind') === 'item' || val(id, 'kind') === 'log')) out.push(id);
  return out.sort((a, b) => (val(b, 'doneAt') || 0) - (val(a, 'doneAt') || 0)).slice(0, limit);
}
export function qTrash() {
  const out = [];
  for (const [id] of recs) if (val(id, 'deleted') === 'trash' && ancestors(id).every((a) => !val(a, 'deleted'))) out.push(id);
  return out.sort((a, b) => (val(b, 'deletedAt') || 0) - (val(a, 'deletedAt') || 0));
}
export function qSomeday() {
  return liveOpenItems().filter((id) => val(id, 'someday') && !val(id, 'when')).sort(byOrder);
}
export function search(q, limit = 40) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/), hits = [];
  for (const [id] of recs) {
    if (id === ROOT || !isLive(id)) continue;
    const t = String(val(id, 'title')).toLowerCase();
    const n = String(val(id, 'notes')).toLowerCase();
    if (!words.every((w) => t.includes(w) || n.includes(w))) continue;
    let s = t.startsWith(q) ? 0 : t.includes(q) ? 1 : 2;
    if (val(id, 'done')) s += 3;
    s += ancestors(id).length * 0.01;
    hits.push([s, id]);
  }
  return hits.sort((a, b) => a[0] - b[0]).slice(0, limit).map((h) => h[1]);
}
/** All live records as plain objects (for export / sync bootstrap). */
export const allRecords = () => [...recs.values()];
