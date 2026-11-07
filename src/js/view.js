// view.js — rendering. Keyed reconciliation of rows, FLIP for structural moves,
// the paper stack for depth, and the strike for completion.
import * as S from './store.js';
import { st, $, h, pageRoot } from './state.js';
import { formatDay as fmtDay, describeRRule, fromYMD } from './parse.js';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const formatDay = (d, now) => { if (!YMD.test(String(d))) return ''; try { return fmtDay(d, now); } catch { return ''; } };
import { measureStrike, paintStrike } from './strike.js';
import { today } from './actions.js';

const CE = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; })();
export const ICON = {
  chev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect class="box" x="1.5" y="1.5" width="17" height="17" rx="5"/><path class="tick" d="M5.6 10.3 8.7 13.3 14.6 6.9"/></svg>',
  flag: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 11V1.5M2.5 2h6.2l-1.4 2.2 1.4 2.3H2.5"/></svg>',
  rep: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5.2A4 4 0 0 1 9.4 3.4M10 6.8a4 4 0 0 1-7.4 1.8M9.6 1.4v2.2H7.4M2.4 10.6V8.4h2.2"/></svg>',
  moon: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.8 7.6A4.3 4.3 0 0 1 4.4 2.2a4.3 4.3 0 1 0 5.4 5.4Z"/></svg>',
};

const els = new Map();      // key → element, for rendered items only (rows by id, group headers by 'g:…')
let pageKey = '';
/* Virtualized page (QA perf, final round). The model (items, st.rows, st.info) always covers every row;
   past VIRT items the DOM holds only the rows within about a screen of the viewport, between two spacers
   sized from measured (cached) heights. Short pages render in full, so find-in-page and screen readers
   see everything. */
const VIRT = 300, OVERSCAN = 600;
let items = [], index = new Map(), offs = [0], win = [0, 0], rowH = 36;
const hcache = new Map();
const topSp = h('div', { class: 'vspace', 'aria-hidden': 'true' });
const botSp = h('div', { class: 'vspace', 'aria-hidden': 'true' });
const virtual = () => items.length > VIRT;
/** The row's element if it is rendered (never renders anything). */
export const peekRow = (id) => els.get(id);
/** The row's element, rendering the rows around it first if it is outside the window. */
export const rowEl = (id) => els.get(id) || ensureRow(id);
function ensureRow(id) {
  const i = index.get(id);
  if (i == null || items[i].grp) return undefined;
  if (growJob) { cancelAnimationFrame(growJob); growJob = 0; }
  if (!virtual()) { renderWindow([0, items.length]); return els.get(id); } // short page still growing: finish it
  // Keep what's on screen and add the target's neighbourhood: nothing visible disappears (v-2). A far target
  // gets its own window; the caller scrolls to it.
  const v = withCursor(viewWindow()), near = [Math.max(0, i - 40), Math.min(items.length, i + 60)];
  renderWindow(Math.abs(i - v[0]) < 250 || Math.abs(i - v[1]) < 250 ? [Math.min(v[0], near[0]), Math.max(v[1], near[1])] : near);
  return els.get(id);
}
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; };

/* ---------------- row model ---------------- */
function hiddenDone(id) {
  if (st.showDone) return false;
  return S.val(id, 'done') && (S.val(id, 'doneAt') || 0) < todayStart();
}
function outlineRows(root) {
  const out = [];
  const walk = (p, d) => {
    const list = S.children(p).filter((c) => S.val(c, 'kind') !== 'log' && !hiddenDone(c));
    list.forEach((c, i) => {
      out.push({ id: c, depth: d, parent: p, pos: i + 1, size: list.length });
      if (!st.collapsed.has(c) && S.hasChildren(c)) walk(c, d + 1);
    });
  };
  walk(root, 0);
  return out;
}
function groupsFor(view) {
  const t = today();
  if (view === 'today') {
    const { day, eve } = S.qToday(t);
    const done = S.qDoneToday(todayStart()).filter((id) => {
      const w = S.val(id, 'when'), dl = S.val(id, 'deadline');
      return (w && w <= t) || (dl && dl <= t);
    });
    // Completed items stay where they were, struck, until tomorrow: never jump out from under the pointer.
    const g = [{ key: 'day', rows: S.sortByOrder([...day, ...done.filter((id) => !(S.val(id, 'evening')))]) }];
    const e = S.sortByOrder([...eve, ...done.filter((id) => S.val(id, 'evening'))]);
    if (e.length) g.push({ key: 'eve', label: 'This evening', icon: ICON.moon, rows: e });
    return g;
  }
  if (view === 'upcoming') {
    // Things' rhythm: the next 7 days one by one, then the rest of this month, then whole months.
    const doneToday = S.qDoneToday(todayStart()).filter((id) => { const w = S.val(id, 'when'), dl = S.val(id, 'deadline'); return (w && w > t) || (dl && dl > t); });
    const byDate = new Map(S.qUpcoming(t));
    for (const id of doneToday) { const d = [S.val(id, 'when'), S.val(id, 'deadline')].filter((x) => x && x > t).sort()[0]; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(id); }
    const dates = [...byDate.keys()].sort();
    const week = addDaysYMD(t, 7), now = fromYMD(t);
    const groups = new Map();
    for (const d of dates) {
      const dt = fromYMD(d);
      let key, label;
      if (d <= week) { key = d; label = dayLabel(d); }
      else if (dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth()) { key = 'rest'; label = 'Rest of ' + dt.toLocaleDateString(undefined, { month: 'long' }); }
      else { key = 'm' + d.slice(0, 7); label = dt.toLocaleDateString(undefined, dt.getFullYear() === now.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' }); }
      if (!groups.has(key)) groups.set(key, { key, label, date: d <= week ? d : null, rows: [] });
      groups.get(key).rows.push(...byDate.get(d));
    }
    // Within a group: by date first (multi-day groups), then where the item lives, so completing one never reorders it.
    let ord = null; const dateOf = (id) => [S.val(id, 'when'), S.val(id, 'deadline')].filter((x) => x && x > t).sort()[0] || '';
    for (const g of groups.values()) if (g.rows.length > 1) { ord ||= S.order(); g.rows.sort((x, y) => (dateOf(x) < dateOf(y) ? -1 : dateOf(x) > dateOf(y) ? 1 : (ord.get(x) ?? 0) - (ord.get(y) ?? 0))); }
    return [...groups.values()];
  }
  if (view === 'someday') {
    const done = S.qDoneToday(todayStart()).filter((id) => S.val(id, 'someday') && !S.val(id, 'when'));
    const rows = [...S.qSomeday(), ...done];
    S.sortByOrder(rows);
    return [{ key: 'sd', rows }];
  }
  if (view === 'logbook') {
    const m = new Map();
    for (const id of S.qLogbook()) {
      const d = new Date(S.val(id, 'doneAt') || 0); d.setHours(0, 0, 0, 0);
      const k = +d;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(id);
    }
    return [...m].map(([k, ids]) => ({ key: 'l' + k, label: formatDay(ymdOf(new Date(k)), new Date()), rows: ids }));
  }
  if (view === 'trash') return [{ key: 'tr', rows: S.qTrash() }];
  return [];
}
const addDaysYMD = (d, n) => { const x = fromYMD(d); x.setDate(x.getDate() + n); return ymdOf(x); };
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dayLabel(d) {
  const f = formatDay(d, new Date());
  const dt = fromYMD(d);
  const n = dt.getDate();
  const diff = Math.round((dt - fromYMD(today())) / 864e5);
  if (diff <= 1) return { big: String(n), small: f };
  return { big: String(n), small: dt.toLocaleDateString(undefined, { weekday: 'long' }) };
}

/* ---------------- rows ---------------- */
// Parsed once, cloned per row: innerHTML per row was the top cost of rendering long lists (QA perf).
let rowTpl = null;
function makeRow(id) {
  if (!rowTpl) {
    rowTpl = document.createElement('template');
    rowTpl.innerHTML = '<div class="row" role="treeitem" tabindex="-1">' +
      '<button class="tw" tabindex="-1" aria-hidden="true">' + ICON.chev + '</button>' +
      '<button class="ck" tabindex="-1" role="checkbox" aria-checked="false" aria-label="Complete">' + ICON.check + '</button>' +
      '<div class="bd"><div class="pa"></div><div class="tl"><span class="tx" spellcheck="true" role="textbox" aria-label="Title" tabindex="-1"></span></div><div class="nt"></div><div class="mt"></div></div>' +
      '<button class="ct" tabindex="-1" aria-label="Open"></button></div>';
  }
  const el = rowTpl.content.firstChild.cloneNode(true);
  el.dataset.id = id;
  const tx = el.querySelector('.tx');
  tx.contentEditable = CE; // the row is the Tab stop (roving tabindex); Enter edits
  el._tx = tx;
  return el;
}

/** Everything a row's appearance depends on; if unchanged, the DOM is already right. */
function sigOf(id, m, smart) {
  return S.rev(id) + '|' + (m.date || '') + '|' + (m.pos || 0) + '/' + (m.size || 0) + '|' + (m.depth || 0) + '|' + (smart ? 1 : 0) + '|' + st.route.view + '|' + today() + '|' +
    (st.collapsed.has(id) ? 1 : 0) + (st.sel.has(id) ? 1 : 0) + (st.cursor === id ? 1 : 0) + '|' + (S.hasChildren(id) ? S.countOpen(id) : -1) + '|' + (smart ? S.ancestors(id).map((a) => S.rev(a) + S.val(a, 'title')).join() : '') + '|' + (st.rows[0] === id ? 1 : 0);
}
export function fillRow(el, id, m, smart) {
  const sig = sigOf(id, m, smart);
  if (el._sig === sig && document.activeElement !== el._tx) return;
  el._sig = sig;
  if (el._done && S.val(id, 'done')) el._drawn = false; // refilled done row: re-measure when near the viewport
  const done = S.val(id, 'done'), heading = S.val(id, 'heading');
  const kidsN = S.hasChildren(id);
  const collapsed = st.collapsed.has(id);
  const t = today();
  el.style.setProperty('--d', m.depth || 0);
  el.classList.toggle('done', !!done);
  el.classList.toggle('heading', !!heading);
  el.classList.toggle('parent', kidsN);
  el.classList.toggle('collapsed', kidsN && (collapsed || smart));
  el.classList.toggle('sel', st.sel.has(id));
  el.classList.toggle('cur', st.cursor === id);
  el.classList.toggle('trashed', st.route.view === 'trash');
  el.classList.toggle('smart', !!smart);
  el.classList.toggle('log', S.val(id, 'kind') === 'log');
  el.setAttribute('aria-level', (m.depth || 0) + 1);
  if (m.pos) { el.setAttribute('aria-posinset', m.pos); el.setAttribute('aria-setsize', m.size); }
  if (kidsN && !smart) el.setAttribute('aria-expanded', String(!collapsed)); else el.removeAttribute('aria-expanded');
  el.setAttribute('aria-selected', String(st.sel.has(id)));
  el.tabIndex = st.cursor === id ? 0 : -1;
  const ck = el.children[1];
  ck.setAttribute('aria-checked', String(!!done));
  el.setAttribute('aria-checked', String(!!done));
  const trash = st.route.view === 'trash';
  if (trash) { ck.removeAttribute('role'); ck.removeAttribute('aria-checked'); }
  else ck.setAttribute('role', 'checkbox');
  ck.setAttribute('aria-label', (trash ? 'Restore ' : done ? 'Reopen ' : 'Complete ') + '“' + (S.val(id, 'title') || 'Untitled') + '”');
  // title (never clobber the text being edited)
  const title = S.val(id, 'title');
  if (document.activeElement !== el._tx && el._tx.textContent !== title) el._tx.textContent = title;
  el._tx.dataset.ph = heading ? 'Heading' : 'New item';
  // Where it lives (smart views): a quiet chip at the end of the meta line, so the checkbox stays on the title.
  let where = '';
  if (smart) {
    const anc = S.ancestors(id).filter((a, i, arr) => !(a === S.INBOX && arr.length === 1)).map((a) => (a === S.INBOX ? 'Inbox' : S.val(a, 'title') || 'Untitled'));
    if (anc.length) where = anc.length > 2 ? anc[0] + ' › … › ' + anc[anc.length - 1] : anc.join(' › ');
  }
  // notes preview
  const notes = S.val(id, 'notes');
  el.querySelector('.nt').textContent = notes ? notes.split('\n')[0] : '';
  // metadata
  const mt = el.querySelector('.mt');
  const bits = [];
  const w = S.val(id, 'when'), dl = S.val(id, 'deadline');
  const inToday = st.route.view === 'today';
  const inUpcomingDay = st.route.view === 'upcoming' && w && m.date === w;
  if (w && !(inToday && w === t) && !inUpcomingDay) {
    if (w < t && !done) bits.push(`<span class="chip since">${inToday ? 'since ' : ''}${formatDay(w, new Date())}</span>`);
    else if (!(inToday)) bits.push(`<span class="chip when">${formatDay(w, new Date())}${S.val(id, 'evening') ? ' ' + ICON.moon : ''}</span>`);
  } else if (w && S.val(id, 'evening') && !inToday) bits.push(`<span class="chip when">This evening</span>`);
  if (S.val(id, 'someday') && !w && st.route.view !== 'someday') bits.push('<span class="chip when">Someday</span>');
  if (dl) {
    const late = dl < t && !done, due = dl === t;
    bits.push(`<span class="chip dl${late ? ' late' : ''}${due ? ' due' : ''}">${ICON.flag}${due ? 'Due today' : formatDay(dl, new Date())}</span>`);
  }
  if (S.val(id, 'rrule')) bits.push(`<span class="chip rep" title="${esc(safeDescribe(S.val(id, 'rrule')))}">${ICON.rep}<span class="vh">${esc(safeDescribe(S.val(id, 'rrule')))}</span></span>`);
  if (inToday && S.val(id, 'evening')) bits.push('<span class="vh">This evening</span>');
  if (st.route.view === 'logbook' && S.val(id, 'doneAt')) bits.push(`<span class="chip at">${new Date(S.val(id, 'doneAt')).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>`);
  const tags = S.val(id, 'tags');
  if (tags && tags.length) bits.push(...tags.map((g) => `<span class="chip tag">${esc(g)}</span>`));
  if (where) bits.push(`<span class="chip where">${esc(where)}</span>`);
  const pr = S.val(id, 'priority');
  el.dataset.pri = pr || '';
  const mtHtml = bits.join('');
  if (mt._h !== mtHtml) { mt.innerHTML = mtHtml; mt._h = mtHtml; }
  // count / open affordance
  const ct = el.querySelector('.ct');
  const n = kidsN ? S.countOpen(id) : 0;
  ct.textContent = kidsN ? (n ? String(n) : '✓') : '';
  ct.hidden = !kidsN;
  // strike bookkeeping: new done rows draw when they scroll into view; a fresh completion draws now.
  if (done && !el._done) { if (el._done === undefined) el._strikeQ = 'static'; else { el._strikeQ = 'anim'; strikeDirty.add(id); } el._drawn = false; }
  if (!done && el._done) { el._strikeQ = null; el._drawn = false; const sv = el.querySelector('.tl > svg.strike'); if (sv) sv.remove(); }
  el._done = !!done;
}
/** Re-fill one rendered row in place (the typing fast path). */
export function refillRow(id) {
  const el = els.get(id), m = st.info.get(id);
  if (!el || !m) return;
  fillRow(el, id, m, st.route.view !== 'node' && st.route.view !== 'inbox');
  if (el._done) { strikeDirty.add(id); queueStrikes(); }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeDescribe = (r) => { try { return describeRRule(r); } catch { return 'Repeats'; } };

/* Strikes: rows queue themselves (strikeDirty) or are picked up when near the viewport. Every flush is
   two strict phases, all reads then all writes, so a long list never thrashes layout (QA perf). */
const strikeDirty = new Set();
/** Rendered done rows that still need a strike (rendered rows are always near the viewport). */
function nearDoneRows() {
  const out = [];
  for (const [k, el] of els) if (el._done && !el._drawn && el.isConnected && !k.startsWith('g:')) out.push(k);
  return out;
}
let scrollRaf = 0;
addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (virtual()) {
      if (growJob) { cancelAnimationFrame(growJob); growJob = 0; }
      const r = withCursor(viewWindow());
      // Re-render only when the needed range isn't already covered (or the window grew needlessly large).
      if (r[0] < win[0] || r[1] > win[1] || win[1] - win[0] > (r[1] - r[0]) * 3) renderWindow(r);
    }
    queueStrikes();
  });
}, { passive: true });
function flushStrikes() {
  const ids = [...new Set([...strikeDirty, ...nearDoneRows()])];
  strikeDirty.clear();
  const work = [];
  for (const id of ids) {
    const el = els.get(id);
    if (!el || !el.isConnected || !el._done) continue;
    const tl = el.querySelector('.tl');
    const anim = el._strikeQ === 'anim';
    if (anim) el._tx.style.transition = 'none'; // measure the condensed title, not a mid-transition one
    const geo = measureStrike(tl, el._tx);
    if (!geo) continue;
    work.push([id, el, tl, geo, anim]);
  }
  const fast = performance.now() - (st.keyAt || 0) < 400;
  for (const [id, el, tl, geo, anim] of work) {
    el._strikeQ = null;
    el._sw = geo.w;
    el._drawn = true;
    // The pencil leads; on the keyboard path it draws in 90 ms (visual audit S2-2).
    paintStrike(tl, geo, id, anim && !st.reduced ? (fast ? 'fast' : 'full') : false);
    if (anim) {
      el._tx.style.transition = '';
      if (!st.reduced && !fast && !st.lowEnd) el._tx.animate([{ fontStretch: '100%' }, { fontStretch: '88%' }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    }
  }
}
let strikeRaf = 0;
export function queueStrikes() { if (!strikeRaf) strikeRaf = requestAnimationFrame(() => { strikeRaf = 0; flushStrikes(); }); }
let lastW = 0;
new ResizeObserver((e) => {
  const w = Math.round(e[0].contentRect.width);
  if (w === lastW) return; // only width changes can re-wrap titles
  lastW = w;
  // Titles may re-wrap: every done row re-measures when it is next near the viewport.
  for (const el of els.values()) if (el._done) el._drawn = false;
  queueStrikes();
}).observe(document.documentElement);

/* ---------------- reconcile + FLIP ---------------- */
/* Remove what's gone first, then insert what's new. Rows that stay are never detached, so a focused row
   keeps its focus and caret while the virtual window slides (virtualization review v-1). Unmanaged
   children (the drag drop-line) are left alone (v-3). */
const unmanaged = (n) => n.nodeType === 1 && n.classList.contains('drop-line');
function reconcile(box, nodes) {
  const want = new Set(nodes);
  for (const c of [...box.childNodes]) if (!want.has(c) && !unmanaged(c)) c.remove();
  let cur = box.firstChild;
  for (const n of nodes) {
    while (cur && unmanaged(cur)) cur = cur.nextSibling;
    if (n === cur) { cur = cur.nextSibling; continue; }
    box.insertBefore(n, cur); // new rows, or a real reorder (structural move)
  }
}
function measure() {
  const m = new Map();
  if (st.reduced) return m;
  const vh = innerHeight;
  for (const [id, el] of els) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > -200 && r.top < vh + 200) m.set(id, r.top);
  }
  return m;
}
function play(before) {
  if (!before.size) return;
  for (const [id, top] of before) {
    const el = els.get(id);
    if (!el || !el.isConnected) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  }
}

/* ---------------- page ---------------- */
let lastToday = '';
function computeOffsets() {
  const n = items.length;
  offs = new Array(n + 1);
  offs[0] = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    offs[i + 1] = offs[i] + (hcache.get(it.key) ?? (it.grp ? 52 : rowH + (it.smart ? 17 : 0)));
  }
}
/** Item range covering the viewport plus overscan, in outline coordinates. */
function viewWindow() {
  const n = items.length;
  if (!virtual()) return [0, n];
  const top = -$('#outline').getBoundingClientRect().top;
  const lo = top - OVERSCAN, hi = top + innerHeight + OVERSCAN;
  let a = 0, b = n;
  while (a < b) { const m = (a + b) >> 1; if (offs[m + 1] <= lo) a = m + 1; else b = m; }
  let e = a;
  while (e < n && offs[e] < hi) e++;
  return [a, Math.max(e, Math.min(n, a + 1))];
}
/** Keep the row you're on rendered, so focus and the caret survive scrolling. */
function withCursor(r) {
  const ci = st.cursor != null ? index.get(st.cursor) : undefined;
  if (ci == null || (ci >= r[0] && ci < r[1]) || Math.abs(ci - r[0]) > 400) return r;
  return [Math.min(r[0], ci), Math.max(r[1], ci + 1)];
}
function renderWindow([a, b]) {
  const box = $('#outline');
  win = [a, b];
  const nodes = [], keep = new Set();
  if (virtual()) nodes.push(topSp);
  for (let i = a; i < b; i++) {
    const it = items[i];
    let el = els.get(it.key);
    if (it.grp) {
      if (!el) { el = h('div', { class: 'grp', role: 'presentation' }); els.set(it.key, el); }
      if (el._h !== it.lab) { el.innerHTML = it.lab; el._h = it.lab; }
    } else {
      if (!el) { el = makeRow(it.id); els.set(it.key, el); }
      fillRow(el, it.id, it.m, it.smart);
      el.classList.toggle('ghosted', !!(st.ghost && st.ghost.has(it.id))); // rows rendered mid-drag stay faded (v-3)
    }
    keep.add(it.key);
    nodes.push(el);
  }
  if (virtual()) nodes.push(botSp);
  for (const k of [...els.keys()]) if (!keep.has(k)) els.delete(k);
  reconcile(box, nodes);
  if (!virtual()) return;
  // Measure what is rendered (one read), then correct the cached heights and the spacers (writes).
  const hs = [];
  for (let i = a; i < b; i++) { const el = els.get(items[i].key); hs.push(el ? el.offsetHeight : 0); }
  let changed = false;
  for (let i = a; i < b; i++) { const v = hs[i - a]; if (v && hcache.get(items[i].key) !== v) { hcache.set(items[i].key, v); changed = true; } }
  if (changed) computeOffsets();
  topSp.style.height = offs[a] + 'px';
  botSp.style.height = (offs[items.length] - offs[b]) + 'px';
}
// A freshly opened long page builds progressively: a first slice now, then a slice per frame, so no single
// task has to style and lay out a whole screen of new rows on a slow device (QA perf, CPU ×4).
const SLICE = st.lowEnd ? 6 : 12;
let growJob = 0;
export function renderPage(opts = {}) {
  const r = st.route;
  const key = r.view + ':' + (r.id || '');
  const box = $('#outline');
  if (growJob) { cancelAnimationFrame(growJob); growJob = 0; }
  const fresh = key !== pageKey;
  if (fresh) { els.clear(); hcache.clear(); box.replaceChildren(); pageKey = key; }
  const before = opts.flip ? measure() : new Map();
  const active = document.activeElement;
  rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 36;
  st.rows = []; st.info.clear(); items = []; index = new Map();
  const addRow = (id, m, smart) => { st.rows.push(id); st.info.set(id, m); index.set(id, items.length); items.push({ key: id, id, m, smart }); };
  renderHead();
  if (r.view === 'node' || r.view === 'inbox') {
    for (const m of outlineRows(pageRoot())) addRow(m.id, m, false);
  } else {
    for (const g of groupsFor(r.view)) {
      if (!g.rows.length) continue;
      if (g.label) {
        const lab = typeof g.label === 'string'
          ? `<span class="gl">${g.icon || ''}${esc(g.label)}</span>`
          : `<span class="gn">${g.label.big}</span><span class="gl">${esc(g.label.small)}</span>`;
        items.push({ key: 'g:' + g.key, grp: true, lab });
      }
      g.rows.forEach((id, i) => addRow(id, { depth: 0, parent: S.parentOf(id), date: g.date || null, pos: i + 1, size: g.rows.length }, true));
    }
  }
  computeOffsets();
  const full = withCursor(viewWindow());
  if (fresh && full[1] - full[0] > SLICE) {
    let end = full[0] + SLICE;
    renderWindow([full[0], end]);
    const grow = () => {
      growJob = 0;
      end = Math.min(full[1], end + SLICE);
      renderWindow([full[0], Math.max(end, win[1])]);
      queueStrikes();
      if (end < full[1]) growJob = requestAnimationFrame(grow);
    };
    growJob = requestAnimationFrame(grow);
  } else renderWindow(full);
  // Roving tabindex: exactly one row is a Tab stop (the cursor, else the first row).
  const stopId = st.cursor && index.has(st.cursor) ? st.cursor : st.rows[0];
  for (const el of box.querySelectorAll('.row[tabindex="0"]')) if (el.dataset.id !== stopId) el.tabIndex = -1;
  const stop = stopId && els.get(stopId); if (stop) stop.tabIndex = 0;
  if (active && active.isConnected && document.activeElement !== active && active !== document.body) active.focus({ preventScroll: true });
  renderEmpty();
  play(before);
  queueStrikes();
  lastToday = today();
}
export const dayChanged = () => lastToday && lastToday !== today();

function renderHead() {
  const r = st.route;
  const title = $('#ptitle'), sub = $('#psub'), crumbs = $('#crumbs'), pn = $('#pnotes'), stack = $('#stack');
  const names = { inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', someday: 'Someday', logbook: 'Logbook', trash: 'Trash' };
  let depth = 0;
  crumbs.replaceChildren();
  if (r.view === 'node') {
    const anc = S.ancestors(r.id);
    depth = anc.length + 1;
    for (const a of anc) crumbs.append(h('a', { href: '#/' + (a === S.INBOX ? 'inbox' : 'n/' + a), class: 'crumb' }, a === S.INBOX ? 'Inbox' : S.val(a, 'title') || 'Untitled'));
    const t = S.val(r.id, 'title');
    if (document.activeElement !== title) title.textContent = t;
    title.contentEditable = CE;
    title.dataset.ph = 'Untitled';
    const n = S.val(r.id, 'notes');
    if (document.activeElement !== pn) pn.textContent = n;
    pn.hidden = false; pn.contentEditable = CE;
    const open = S.countOpen(r.id);
    sub.textContent = open ? `${open} open` : S.hasChildren(r.id) ? 'All done' : '';
  } else {
    title.textContent = names[r.view] || '';
    title.contentEditable = 'false';
    pn.hidden = true;
    if (r.view === 'today') sub.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    else if (r.view === 'inbox') { const n = S.countOpen(S.INBOX); sub.textContent = n ? `${n} open` : ''; }
    else sub.textContent = '';
  }
  document.title = (r.view === 'node' ? S.val(r.id, 'title') || 'Untitled' : names[r.view]) + ' — Lists';
  // Paper stack: one sheet edge per level of depth.
  const n = Math.min(depth, 6);
  if (stack.childElementCount !== n) stack.replaceChildren(...Array.from({ length: n }, () => h('i')));
  stack.dataset.more = depth > 6 ? String(depth) : '';
  // Only write when changed: body attributes feed selectors, and every write restyles every row (QA 10k perf).
  if (document.body.dataset.view !== r.view) document.body.dataset.view = r.view;
  if (document.body.dataset.depth !== String(depth)) document.body.dataset.depth = String(depth);
}

function renderEmpty() {
  const e = $('#empty');
  const v = st.route.view;
  e.replaceChildren();
  e.className = 'empty';
  e.hidden = st.rows.length > 0;
  if (v === 'today') {
    const doneToday = S.qDoneToday(todayStart());
    const open = S.qToday(today());
    if (!open.day.length && !open.eve.length && doneToday.length) {
      // "Today, struck through": handled by main (needs the light); here only the words.
      e.hidden = false;
      e.className = 'empty clear';
      e.append(h('p', { class: 'big' }, 'Today is clear.'), h('p', { class: 'cnt' }, `${doneToday.length} done`));
      return;
    }
  }
  if (!e.hidden) {
    const key = st.touch ? 'Tap + to add one.' : 'Press Q to add one, or Enter to start typing.';
    const msg = {
      inbox: ['Inbox is empty.', key],
      today: ['Nothing scheduled for today.', st.touch ? 'Tap + to add one.' : 'Press Q to add one.'],
      upcoming: ['Nothing coming up.', 'Give an item a date and it shows here.'],
      someday: ['Nothing for someday.', 'Items without a date, kept for later.'],
      logbook: ['No completed items yet.', ''],
      trash: ['Trash is empty.', ''],
      node: ['Empty.', key],
    }[v] || ['', ''];
    e.append(h('p', { class: 'big' }, msg[0]), msg[1] ? h('p', null, msg[1]) : null);
  }
}

/* ---------------- sidebar ---------------- */
let badgeJob = 0, lastTodayN = 0;
export function renderSide() {
  const t = today();
  // The Today badge needs a pass over every open item; it updates in idle time so an edit never waits on it.
  const counts = { inbox: S.children(S.INBOX).filter((c) => !S.val(c, 'done')).length, today: lastTodayN };
  if (!badgeJob) badgeJob = (window.requestIdleCallback || setTimeout)(() => {
    badgeJob = 0;
    lastTodayN = S.qTodayCount(today());
    const n = document.querySelector('[data-nav="today"] .n');
    if (n) n.textContent = lastTodayN ? String(lastTodayN) : '';
  }, { timeout: 300 });
  for (const b of document.querySelectorAll('[data-nav]')) {
    const v = b.dataset.nav;
    const on = st.route.view === v || (v === 'inbox' && st.route.view === 'node' && S.ancestors(st.route.id)[0] === S.INBOX);
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    const c = b.querySelector('.n');
    if (c) c.textContent = counts[v] ? String(counts[v]) : '';
  }
  const box = $('#sideLists');
  const lists = S.children(S.ROOT).filter((id) => id !== S.INBOX);
  const top = st.route.view === 'node' ? [...S.ancestors(st.route.id), st.route.id][0] : null;
  const items = lists.map((id) => {
    let b = box.querySelector(`[data-list="${CSS.escape(id)}"]`);
    if (!b) b = h('a', { class: 'li', 'data-list': id, href: '#/n/' + id }, h('span', { class: 'lt' }), h('span', { class: 'n' }));
    b.querySelector('.lt').textContent = S.val(id, 'title') || 'Untitled';
    const n = S.countOpen(id);
    b.querySelector('.n').textContent = n ? String(n) : '';
    b.classList.toggle('on', top === id);
    if (top === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    return b;
  });
  reconcile(box, items);
}

/** View Transition wrapper (pointer-driven navigation only). */
export function transition(fn, kind) {
  if (!document.startViewTransition || st.reduced || kind === 'key') { fn(); return; }
  document.documentElement.dataset.vt = kind || 'nav';
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { delete document.documentElement.dataset.vt; });
}
