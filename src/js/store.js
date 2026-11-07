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
function changed(id, structural, fields, move) {
  version++;
  revs.set(id, (revs.get(id) || 0) + 1);
  // Typing a title can't change counts or smart views, so it keeps the memo (QA B1: no 10k walk per key).
  if (move) {
    // Moves (indent, outdent, reorder, drag): shift counts between the two ancestor chains and refresh the
    // moved subtree's open items; document order is recomputed lazily, only if a smart view sorts.
    const t = memo.get('tree');
    memo.clear();
    if (t && treeMove(t, id, move.from, move.to)) memo.set('tree', t);
  } else if (structural || !fields || fields.includes('kind')) memo.clear();
  else if (fields.some((f) => !QUIET.has(f))) {
    // Dates and completion don't change the tree's shape: keep the cached walk, drop the derived queries,
    // and patch counts and open items for just this node's ancestors and subtree (QA perf, 10k at ×4).
    const t = memo.get('tree');
    for (const k of [...memo.keys()]) if (k !== 'tree') memo.delete(k);
    if (t && (fields.includes('done') || fields.includes('heading')) && !treeDelta(t, id)) memo.delete('tree');
    else if (t && (fields.includes('when') || fields.includes('deadline'))) { const r = recs.get(id); if (r && (fv(r, 'when') || fv(r, 'deadline'))) t.dated.add(id); else t.dated.delete(id); }
  }
  if (structural) pendingStructural = true;
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
  let move = null;
  if (wasVoid !== (r.f.deleted && r.f.deleted[0] === 'void') && childrenAll(id).length) rebuild();
  else if (structural) {
    const v0 = rebuilds;
    reparent(id, oldParent);
    // A plain move (only `pos` changed, no cycle repair): the cached walk can be patched instead of redone.
    if (oldParent !== undefined && rebuilds === v0 && Object.keys(fields).every((k) => k === 'pos' || QUIET.has(k))) move = { from: oldParent, to: eff.get(id) };
  }
  persistHook(r, true);
  changed(id, structural, Object.keys(fields), move);
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
  // A record's v is the newest of its field stamps, so observing v alone advances the clock just as far.
  for (const r of list) { recs.set(r.id, r); if (r.v) observe(r.v); else for (const k in r.f) observe(r.f[k][1]); }
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
let rebuilds = 0;
function rebuild() {
  rebuilds++;
  eff.clear(); kids.clear();
  for (const id of recs.keys()) eff.set(id, rawParent(id));
  // Concurrent moves on two devices can form a cycle neither saw. Break it deterministically:
  // the most recent move in the cycle loses and falls back to its previous parent, then to Inbox.
  // Linear time: nodes already known to reach ROOT end every later walk early (10k-item boot).
  const ok = new Set([ROOT]);
  for (const id of recs.keys()) {
    for (let guard = 0; guard < 64; guard++) {
      const path = [], onPath = new Set();
      let cur = id, cyc = null;
      while (!ok.has(cur)) {
        if (onPath.has(cur)) { cyc = cur; break; }
        onPath.add(cur); path.push(cur); cur = eff.get(cur) ?? ROOT;
      }
      if (!cyc) { for (const x of path) ok.add(x); break; }
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
/* One allocation-free walk per store version gives both the open count under every node and the list of
   open items for the smart views (it used to be two walks with filtered arrays at every level). */
const fv = (r, k) => { const e = r.f[k]; return e ? e[0] : DEF[k]; };
/** Incrementally apply a done/heading change on `id` to the cached walk. Returns false to force a full walk. */
const bump = (t, start, d) => {
  // Counts flow up like the full walk: a repeat-log's subtree counts toward the log itself but not past it.
  for (let a = start; a !== undefined; a = eff.get(a)) {
    t.open.set(a, (t.open.get(a) || 0) + d);
    const ar = recs.get(a);
    if (a === ROOT || (ar && fv(ar, 'kind') === 'log')) break;
  }
};
/** Re-derive open-item membership for `id`'s subtree from its current ancestors. */
function resubtree(t, id) {
  let doneAbove = false;
  for (let a = eff.get(id); a !== undefined && a !== ROOT; a = eff.get(a)) { const ar = recs.get(a); if (ar && fv(ar, 'done')) { doneAbove = true; break; } }
  const visit = (c, da) => {
    const rr = recs.get(c);
    if (!rr || fv(rr, 'deleted')) return;
    const d = da || fv(rr, 'done');
    if (!d && !fv(rr, 'heading') && fv(rr, 'kind') === 'item') t.items.add(c); else t.items.delete(c);
    const arr = kids.get(c);
    if (arr) for (let i = 0; i < arr.length; i++) visit(arr[i], d);
  };
  visit(id, doneAbove);
}
function treeMove(t, id, from, to) {
  const r = recs.get(id);
  if (!r || !t.self.has(id) || (!t.open.has(from) && from !== ROOT)) return false;
  if (fv(r, 'kind') !== 'log') {
    const contrib = (t.open.get(id) || 0) + (t.self.get(id) ? 1 : 0);
    if (contrib) { bump(t, from, -contrib); bump(t, to, contrib); }
  }
  if (!t.open.has(to)) t.open.set(to, 0);
  resubtree(t, id);
  return true;
}
function treeDelta(t, id) {
  const r = recs.get(id);
  if (!r || !t.self.has(id)) return false;
  const was = t.self.get(id), now = !fv(r, 'done') && !fv(r, 'heading') && fv(r, 'kind') !== 'log';
  if (was === undefined) return false;
  if (was !== now) { bump(t, eff.get(id), now ? 1 : -1); t.self.set(id, now); }
  if (fv(r, 'done')) t.done.add(id); else t.done.delete(id);
  resubtree(t, id);
  return true;
}
function treeStats() {
  return memoize('tree', () => {
    const open = new Map(), items = new Set(), self = new Map(), doneSet = new Set(), dated = new Set();
    const walk = (p, doneAbove) => {
      let n = 0;
      const arr = kids.get(p);
      if (arr) for (let i = 0; i < arr.length; i++) {
        const c = arr[i], r = recs.get(c);
        if (!r || fv(r, 'deleted')) continue;
        const kind = fv(r, 'kind'), done = fv(r, 'done'), heading = fv(r, 'heading');
        const d = doneAbove || done;
        if (!d && !heading && kind === 'item') items.add(c);
        if (done) doneSet.add(c);
        if (fv(r, 'when') || fv(r, 'deadline')) dated.add(c);
        const sub = walk(c, d);
        const me = kind !== 'log' && !done && !heading;
        self.set(c, me);
        if (kind !== 'log') n += sub + (me ? 1 : 0);
      }
      open.set(p, n);
      return n;
    };
    walk(ROOT, false);
    return { open, items, self, done: doneSet, dated };
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
/** Document order of every live node, for stable sorting in smart views. */
/** Document order of every live node: comes free with the one tree walk per store version. */
export function order() {
  return memoize('ord', () => {
    const m = new Map(); let i = 0;
    const walk = (p) => {
      const arr = kids.get(p);
      if (arr) for (let k = 0; k < arr.length; k++) {
        const c = arr[k], r = recs.get(c);
        if (!r || (r.f.deleted && r.f.deleted[0])) continue;
        m.set(c, i++); walk(c);
      }
    };
    walk(ROOT);
    return m;
  });
}
/** Today's open count without sorting (the sidebar badge needs only the number). */
export function qTodayCount(today) {
  return memoize('todayN:' + today, () => {
    let n = 0;
    for (const id of datedOpen()) { const r = recs.get(id), w = fv(r, 'when'), dl = fv(r, 'deadline'); if ((w && w <= today) || (dl && dl <= today)) n++; }
    return n;
  });
}
const byOrder = (a, b) => (order().get(a) ?? 0) - (order().get(b) ?? 0);
/** Sort ids into document order. Small sets compare root-to-node sibling-index paths (a few lookups each)
    instead of walking the whole tree; big sets use the cached full order. */
export function sortByOrder(ids) {
  if (ids.length < 2) return ids;
  if (ids.length > 64) return ids.sort(byOrder);
  const path = new Map();
  for (const id of ids) {
    const p = [];
    for (let c = id, g = 0; c && c !== ROOT && g < 4096; c = eff.get(c), g++) p.push((kids.get(eff.get(c) ?? ROOT) || []).indexOf(c));
    path.set(id, p.reverse());
  }
  return ids.sort((a, b) => {
    const x = path.get(a), y = path.get(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  });
}

function liveOpenItems() { return treeStats().items; }
/** Open items that have a start date or a deadline (Today, Upcoming and overdue only need these). */
function* datedOpen() { const t = treeStats(); for (const id of t.dated) if (t.items.has(id)) yield id; }
/** Today: scheduled on/before today, or deadline on/before today. Split by evening. */
export function qToday(today) { return memoize('today:' + today, () => qTodayRaw(today)); }
function qTodayRaw(today) {
  const day = [], eve = [];
  for (const id of datedOpen()) {
    const r = recs.get(id), w = fv(r, 'when'), dl = fv(r, 'deadline');
    if ((w && w <= today) || (dl && dl <= today)) (fv(r, 'evening') && w && w <= today ? eve : day).push(id);
  }
  sortByOrder(day); sortByOrder(eve);
  return { day, eve };
}
/** Items done today that would have been in Today (for the "struck through" view). */
export function qDoneToday(todayStart) {
  return memoize('doneToday:' + todayStart, () => {
    // order() holds exactly the live nodes (the tree walk skips deleted subtrees), so no ancestor walks here.
    const out = [];
    for (const id of treeStats().done) {
      const r = recs.get(id), k = fv(r, 'kind');
      if (fv(r, 'done') && (fv(r, 'doneAt') || 0) >= todayStart && (k === 'item' || k === 'log')) out.push(id);
    }
    return out.sort((a, b) => val(a, 'doneAt') - val(b, 'doneAt'));
  });
}
export function qUpcoming(today) {
  const m = new Map();
  for (const id of datedOpen()) {
    const w = val(id, 'when'), dl = val(id, 'deadline');
    const d = [w, dl].filter((x) => x && x > today).sort()[0];
    if (!d) continue;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(id);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, ids]) => [d, sortByOrder(ids)]);
}
export function qOverdue(today) {
  return [...datedOpen()].filter((id) => { const w = val(id, 'when'), dl = val(id, 'deadline'); return (w && w < today) || (dl && dl < today); });
}
export function qLogbook(limit = 400) {
  const out = [];
  for (const id of treeStats().done) { const r = recs.get(id), k = fv(r, 'kind'); if (fv(r, 'done') && (k === 'item' || k === 'log')) out.push(id); }
  return out.sort((a, b) => (val(b, 'doneAt') || 0) - (val(a, 'doneAt') || 0)).slice(0, limit);
}
export function qTrash() {
  const out = [];
  for (const [id] of recs) if (val(id, 'deleted') === 'trash' && ancestors(id).every((a) => !val(a, 'deleted'))) out.push(id);
  return out.sort((a, b) => (val(b, 'deletedAt') || 0) - (val(a, 'deletedAt') || 0));
}
export function qSomeday() {
  return sortByOrder([...liveOpenItems()].filter((id) => val(id, 'someday') && !val(id, 'when')));
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
