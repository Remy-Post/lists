// actions.js — the verbs. Keyboard, touch, menus and the palette all call these.
import * as S from './store.js';
import * as O from './ops.js';
import { st, pageRoot } from './state.js';
import { ymd, fromYMD, nextOccurrence, parseQuick } from './parse.js';

export const today = () => ymd(new Date());
export const addDays = (d, n) => { const x = fromYMD(d); x.setDate(x.getDate() + n); return ymd(x); };
const ctx = () => ({ route: { ...st.route }, sel: st.cursor });
let notify = () => {};
export const setNotify = (fn) => { notify = fn; };

/** Siblings the user can actually see in an outline (hidden completed items and repeat logs excluded). */
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; };
export function visible(id) {
  if (S.val(id, 'kind') === 'log') return false;
  return st.showDone || !(S.val(id, 'done') && (S.val(id, 'doneAt') || 0) < dayStart());
}
const outlinePage = () => st.route.view === 'node' || st.route.view === 'inbox';
/** Ids in document order, dropping any whose ancestor is also in the set. */
export function tops(ids) {
  const set = new Set(ids);
  const o = S.order();
  return [...set].filter((id) => !S.ancestors(id).some((a) => set.has(a))).sort((a, b) => (o.get(a) ?? 0) - (o.get(b) ?? 0));
}
const target = () => (st.sel.size ? [...st.sel] : st.cursor ? [st.cursor] : []);
export const targets = target;

/* -------- create -------- */
export function createAt(parent, index, fields = {}) {
  return O.tx('New item', () => O.create({ pos: S.posAt(parent, index), ...fields }), { ctx: ctx() });
}
export function createAfter(id, fields = {}) {
  const p = S.parentOf(id);
  const sib = S.children(p);
  return createAt(p, sib.indexOf(id) + 1, fields);
}
/** Where new items go on the current page. */
export function defaultTarget() {
  const r = pageRoot();
  if (r) return { parent: r, index: S.children(r).length };
  const v = st.route.view;
  const fields = v === 'today' ? { when: today() } : v === 'someday' ? { someday: true } : {};
  return { parent: S.INBOX, index: S.children(S.INBOX).length, fields };
}
/** Quick add: parse the grammar, resolve #list, create. */
export function quickAdd(text, at, ignore) {
  const p = parseQuick(text, new Date(), ignore ? { ignore } : undefined);
  if (!p.title && !p.when && !p.deadline) return null;
  const t = at || defaultTarget();
  let parent = t.parent, index = t.index;
  if (p.list) {
    const hit = findList(p.list);
    if (hit) { parent = hit; index = S.children(hit).length; }
  }
  const f = fieldsFromParse(p);
  return createAt(parent, index, { ...(t.fields || {}), ...f });
}
export function fieldsFromParse(p) {
  const f = { title: p.title };
  if (p.when) f.when = p.when;
  if (p.evening) f.evening = true;
  if (p.someday) f.someday = true;
  if (p.deadline) f.deadline = p.deadline;
  if (p.priority) f.priority = p.priority;
  if (p.rrule) { f.rrule = p.rrule; f.repeatFrom = p.repeatFrom || 'when'; }
  if (p.time) f.time = p.time;
  if (p.tags && p.tags.length) f.tags = p.tags;
  return f;
}
export function findList(name) {
  const n = name.toLowerCase().replace(/[-_]/g, ' ');
  let best = null;
  for (const [id] of S.recs) {
    if (!S.isLive(id) || id === S.ROOT) continue;
    const t = String(S.val(id, 'title')).toLowerCase();
    if (t === n) return id;
    if (!best && S.hasChildren(id) && t.startsWith(n)) best = id;
  }
  return best;
}
/** Commit grammar typed into a freshly created outline row. */
export function commitFresh(id) {
  if (!st.fresh.has(id)) return false;
  st.fresh.delete(id);
  const title = S.val(id, 'title');
  if (!title) return false;
  const p = parseQuick(title, new Date());
  if (!p.tokens || !p.tokens.length) return false;
  const f = fieldsFromParse(p);
  if (!f.title) return false;
  O.tx('Schedule', () => {
    if (p.list) { const l = findList(p.list); if (l && S.canMove(id, l)) f.pos = S.posAt(l, S.children(l).length, id, S.parentOf(id)); }
    O.set(id, f);
  }, { ctx: ctx() });
  return true;
}

/* -------- complete -------- */
export function toggleDone(ids = target()) {
  ids = ids.filter((id) => S.recs.has(id) && !S.val(id, 'heading') && id !== S.INBOX);
  if (!ids.length) return;
  const allDone = ids.every((id) => S.val(id, 'done'));
  const now = Date.now();
  O.tx(allDone ? 'Reopen' : 'Complete', () => {
    for (const id of ids) {
      if (allDone) { O.set(id, { done: false, doneAt: null }); continue; }
      if (S.val(id, 'done')) continue;
      const rr = S.val(id, 'rrule');
      if (rr) repeat(id, rr, now);
      else O.set(id, { done: true, doneAt: now });
    }
  }, { ctx: ctx() });
  if (!allDone) notify('done', ids);
}
function repeat(id, rr, now) {
  // Log this occurrence, then roll the original forward and reset its checklist.
  const base = S.val(id, 'when') || today();
  O.create({
    kind: 'log', title: S.val(id, 'title'), notes: S.val(id, 'notes'), done: true, doneAt: now,
    pos: S.posAt(S.parentOf(id), S.children(S.parentOf(id)).length), origin: id,
  });
  const next = nextOccurrence(rr, base, S.val(id, 'repeatFrom') || 'when', today());
  const f = { when: next };
  const dl = S.val(id, 'deadline'), w = S.val(id, 'when');
  if (dl && w) f.deadline = addDays(next, Math.round((fromYMD(dl) - fromYMD(w)) / 864e5));
  else if (dl) f.deadline = next;
  O.set(id, f);
  for (const c of S.descendants(id)) if (S.val(c, 'done')) O.set(c, { done: false, doneAt: null });
}

/* -------- structure -------- */
export function indent(ids = target()) {
  const list = tops(ids);
  let moved = false;
  O.tx('Indent', () => {
    for (const id of list) {
      const p = S.parentOf(id), sib = S.children(p).filter((x) => x === id || visible(x)), i = sib.indexOf(id);
      let np = null;
      for (let j = i - 1; j >= 0; j--) if (!list.includes(sib[j])) { np = sib[j]; break; }
      if (!np || !S.canMove(id, np)) continue;
      O.set(id, { pos: S.posAt(np, S.children(np).length, id, p) });
      st.collapsed.delete(np);
      moved = true;
    }
  }, { ctx: ctx() });
  return moved;
}
export function outdent(ids = target()) {
  const list = tops(ids).reverse();
  const root = pageRoot();
  let moved = false;
  O.tx('Outdent', () => {
    for (const id of list) {
      const p = S.parentOf(id);
      if (p === root || p === S.ROOT || p === S.INBOX && !root) continue;
      const gp = S.parentOf(p);
      if (gp === S.ROOT && root === null && st.route.view !== 'node') continue;
      const sib = S.children(gp);
      O.set(id, { pos: S.posAt(gp, sib.indexOf(p) + 1, id, p) });
      moved = true;
    }
  }, { ctx: ctx() });
  return moved;
}
export function moveBy(dir, ids = target()) {
  const list = tops(ids);
  if (!list.length || !outlinePage()) return; // smart views: visual order isn't tree order (audit S2-5)
  const p = S.parentOf(list[0]);
  if (!list.every((x) => S.parentOf(x) === p)) return;
  const all = S.children(p).filter((x) => list.includes(x) || visible(x));
  const sib = all.filter((x) => !list.includes(x));
  const first = all.indexOf(list[0]);
  const keptBefore = all.slice(0, first).filter((x) => !list.includes(x)).length;
  const ni = keptBefore + (dir < 0 ? -1 : 1);
  O.tx('Move', () => {
    if (ni < 0 || ni > sib.length) {
      // Past the end of the siblings: hop out next to the parent (if the page allows).
      const root = pageRoot();
      if (p === root || p === S.ROOT || p === S.INBOX) return;
      const gp = S.parentOf(p), gs = S.children(gp), pi = gs.indexOf(p);
      list.forEach((id, k) => O.set(id, { pos: S.posAt(gp, (dir < 0 ? pi : pi + 1) + k, id, p) }));
      return;
    }
    let a = sib[ni - 1] || null, b = sib[ni] || null;
    for (const id of list) {
      const pos = S.posBetween(p, a, b, p);
      O.set(id, { pos });
      a = id;
    }
  }, { ctx: ctx() });
}
/** Move ids into parent at `index`, counted among the parent's children that are NOT being moved. */
export function moveTo(ids, parent, index) {
  const list = tops(ids).filter((id) => S.canMove(id, parent));
  if (!list.length) return false;
  const kept = S.children(parent).filter((c) => !list.includes(c));
  const i = index == null ? kept.length : Math.max(0, Math.min(index, kept.length));
  O.tx('Move', () => {
    let a = kept[i - 1] || null;
    const b = kept[i] || null;
    for (const id of list) {
      O.set(id, { pos: S.posBetween(parent, a, b, S.parentOf(id)) });
      a = id;
    }
  }, { ctx: ctx() });
  return true;
}
export function trash(ids = target()) {
  const list = tops(ids).filter((id) => id !== S.INBOX);
  if (!list.length) return;
  const now = Date.now();
  O.tx('Delete', () => { for (const id of list) O.set(id, { deleted: 'trash', deletedAt: now }); }, { ctx: ctx() });
  notify('trash', list);
}
export function restore(ids) {
  O.tx('Restore', () => { for (const id of ids) O.set(id, { deleted: false, deletedAt: null }); }, { ctx: ctx() });
}
export function destroy(ids) {
  O.tx('Delete forever', () => {
    for (const id of ids) { for (const d of S.descendants(id)) O.set(d, { deleted: 'void', title: '', notes: '' }); O.set(id, { deleted: 'void', title: '', notes: '' }); }
  });
}
export function toggleHeading(ids = target()) {
  const all = ids.every((id) => S.val(id, 'heading'));
  O.tx('Heading', () => { for (const id of ids) O.set(id, { heading: !all, done: false }); }, { ctx: ctx() });
}

/* -------- dates -------- */
export function setWhen(ids, when, opts = {}) {
  O.tx('Schedule', () => {
    for (const id of ids) {
      const f = { when, evening: !!opts.evening && !!when, someday: !!opts.someday && !when };
      O.set(id, f);
    }
  }, { ctx: ctx() });
  notify('when', ids);
}
export function setDeadline(ids, deadline) {
  O.tx('Deadline', () => { for (const id of ids) O.set(id, { deadline }); }, { ctx: ctx() });
}
export function nudge(days, ids = target()) {
  if (!ids.length) return;
  O.tx('Reschedule', () => {
    for (const id of ids) {
      const w = S.val(id, 'when');
      const t = today();
      const base = w && w >= t ? w : t;
      let next = addDays(base, w ? days : Math.max(0, days - (days > 0 ? 1 : 0)));
      if (next < t) next = t; // never schedule into the past (audit S3-9)
      O.set(id, { when: next, someday: false });
    }
  }, { ctx: ctx(), merge: 'nudge:' + ids.join() });
}
export function rescueOverdue() {
  const t = today();
  const ids = S.qOverdue(t);
  if (!ids.length) return 0;
  O.tx('Move overdue to Today', () => { for (const id of ids) { if (S.val(id, 'when') && S.val(id, 'when') < t) O.set(id, { when: t }); } }, { ctx: ctx() });
  return ids.length;
}
export function setPriority(ids, p) {
  O.tx('Priority', () => { for (const id of ids) O.set(id, { priority: p }); }, { ctx: ctx() });
}
export function cyclePriority(ids = target()) {
  if (!ids.length) return;
  const p = (S.val(ids[0], 'priority') + 1) % 4;
  setPriority(ids, p);
}

/* -------- lists -------- */
export function newList(title = '') {
  const roots = S.children(S.ROOT);
  return O.tx('New list', () => O.create({ kind: 'item', title, pos: S.posAt(S.ROOT, roots.length) }));
}

/* -------- paste: many lines become many items, indentation becomes nesting -------- */
export function parseOutline(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  const indentOf = (l) => { const m = l.match(/^[\t ]*/)[0]; return m.replace(/\t/g, '    ').length; };
  const items = lines.map((l) => {
    const raw = l.replace(/^[\t ]*/, '');
    const m = raw.match(/^(?:[-*+•◦▪]|\d+[.)])\s+(\[( |x|X)\]\s+)?/);
    let title = m ? raw.slice(m[0].length) : raw;
    let done = false;
    const cb = raw.match(/^(?:[-*+]\s+)?\[( |x|X)\]\s+/);
    if (cb) { done = cb[1] !== ' '; title = raw.slice(cb[0].length); }
    else if (m && m[2]) done = m[2] !== ' ';
    return { ind: indentOf(l), title: title.trim(), done };
  });
  // Normalise indentation widths into levels.
  const stack = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1] >= it.ind) stack.pop();
    it.level = stack.length;
    stack.push(it.ind);
  }
  return items;
}
export function pasteOutline(text, parent, index, topFields = {}) {
  const items = parseOutline(text);
  if (!items.length) return [];
  const ids = [];
  O.tx('Paste', () => {
    const parents = [parent], idx = [index];
    for (const it of items) {
      const lvl = Math.min(it.level, parents.length - 1);
      parents.length = lvl + 1; idx.length = lvl + 1;
      const p = parents[lvl];
      const id = O.create({ title: it.title, done: it.done, doneAt: it.done ? Date.now() : null, pos: S.posAt(p, idx[lvl]), ...(lvl === 0 ? topFields : {}) });
      idx[lvl] = S.children(p).indexOf(id) + 1;
      parents.push(id); idx.push(0);
      ids.push(id);
    }
  }, { ctx: ctx() });
  return ids;
}

/* -------- export -------- */
export function toMarkdown(rootId = S.ROOT) {
  const out = [];
  const walk = (p, d) => {
    for (const c of S.children(p)) {
      if (S.val(c, 'kind') === 'log') continue;
      const t = S.val(c, 'title');
      const head = S.val(c, 'heading');
      const meta = [];
      if (S.val(c, 'when')) meta.push('when:' + S.val(c, 'when'));
      if (S.val(c, 'deadline')) meta.push('due:' + S.val(c, 'deadline'));
      const line = (head ? '- **' + t + '**' : '- [' + (S.val(c, 'done') ? 'x' : ' ') + '] ' + t) + (meta.length ? '  <!-- ' + meta.join(' ') + ' -->' : '');
      if (d === 0 && p === S.ROOT) { out.push('', '# ' + (t || 'Untitled'), ''); walk(c, 0.5); continue; }
      out.push('  '.repeat(Math.floor(d)) + line);
      const n = S.val(c, 'notes');
      if (n) out.push(...n.split('\n').map((l) => '  '.repeat(Math.floor(d) + 1) + '> ' + l));
      walk(c, Math.floor(d) + 1);
    }
  };
  walk(rootId, 0);
  return out.join('\n').trim() + '\n';
}
