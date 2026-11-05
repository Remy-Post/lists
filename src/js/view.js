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
  note: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h8M2 6h8M2 9h5"/></svg>',
  moon: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M9.8 7.6A4.3 4.3 0 0 1 4.4 2.2a4.3 4.3 0 1 0 5.4 5.4Z"/></svg>',
};

const els = new Map();      // id → row element (current page)
let pageKey = '';
export const rowEl = (id) => els.get(id);
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; };

/* ---------------- row model ---------------- */
function hiddenDone(id) {
  if (st.showDone) return false;
  return S.val(id, 'done') && (S.val(id, 'doneAt') || 0) < todayStart();
}
function outlineRows(root) {
  const out = [];
  const walk = (p, d) => {
    for (const c of S.children(p)) {
      if (S.val(c, 'kind') === 'log' || hiddenDone(c)) continue;
      out.push({ id: c, depth: d, parent: p });
      if (!st.collapsed.has(c) && S.hasChildren(c)) walk(c, d + 1);
    }
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
    const g = [{ key: 'day', rows: [...day, ...done.filter((id) => !(S.val(id, 'evening')))] }];
    const e = [...eve, ...done.filter((id) => S.val(id, 'evening'))];
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
    return [...groups.values()];
  }
  if (view === 'someday') {
    const done = S.qDoneToday(todayStart()).filter((id) => S.val(id, 'someday') && !S.val(id, 'when'));
    return [{ key: 'sd', rows: [...S.qSomeday(), ...done] }];
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

export function fillRow(el, id, m, smart) {
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
  const inUpcomingDay = st.route.view === 'upcoming' && w && w > t && w <= addDaysYMD(t, 7);
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
  if (done && !el._done) { if (el._done === undefined) { el._strikeQ = 'static'; strikeIO.observe(el); } else { el._strikeQ = 'anim'; strikeDirty.add(id); } }
  if (!done && el._done) { el._strikeQ = null; const sv = el.querySelector('.tl > svg.strike'); if (sv) sv.remove(); }
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

/* Strikes: rows queue themselves (strikeDirty) or wait to scroll into view (strikeIO). Every flush is
   two strict phases, all reads then all writes, so a long list never thrashes layout (QA perf). */
const strikeDirty = new Set();
const strikeIO = new IntersectionObserver((entries) => {
  let any = false;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    strikeIO.unobserve(e.target);
    const id = e.target.dataset.id;
    if (id && els.get(id) === e.target) { strikeDirty.add(id); any = true; }
  }
  if (any) queueStrikes();
}, { rootMargin: '300px 0px' });
function flushStrikes() {
  const ids = [...strikeDirty];
  strikeDirty.clear();
  const work = [];
  for (const id of ids) {
    const el = els.get(id);
    if (!el || !el.isConnected || !el._done) continue;
    const tl = el.querySelector('.tl');
    const anim = el._strikeQ === 'anim';
    if (anim) el._tx.style.transition = 'none'; // measure the condensed title, not a mid-transition one
    const geo = measureStrike(tl, el._tx);
    if (!geo) { strikeIO.observe(el); continue; }
    work.push([id, el, tl, geo, anim]);
  }
  const fast = performance.now() - (st.keyAt || 0) < 400;
  for (const [id, el, tl, geo, anim] of work) {
    el._strikeQ = null;
    el._sw = geo.w;
    // The pencil leads; on the keyboard path it draws in 90 ms (visual audit S2-2).
    paintStrike(tl, geo, id, anim && !st.reduced ? (fast ? 'fast' : 'full') : false);
    if (anim) {
      el._tx.style.transition = '';
      if (!st.reduced && !fast) el._tx.animate([{ fontStretch: '100%' }, { fontStretch: '88%' }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
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
  // Titles may re-wrap: re-measure done rows as they come into view.
  for (const el of els.values()) if (el._done) { strikeIO.unobserve(el); strikeIO.observe(el); }
}).observe(document.documentElement);

/* ---------------- reconcile + FLIP ---------------- */
function reconcile(box, nodes) {
  let cur = box.firstChild;
  for (const n of nodes) {
    if (n === cur) { cur = cur.nextSibling; continue; }
    box.insertBefore(n, cur);
  }
  while (cur) { const nx = cur.nextSibling; cur.remove(); cur = nx; }
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
// A fresh page paints its first rows at once and streams the rest in per-frame chunks, so opening a
// 1,000-row list never blocks the main thread (QA perf gate: no long task > 50 ms).
const FIRST = 90, CHUNK = 120;
let chunkJob = 0;
export function renderPage(opts = {}) {
  const r = st.route;
  const key = r.view + ':' + (r.id || '');
  const box = $('#outline');
  if (chunkJob) { cancelAnimationFrame(chunkJob); chunkJob = 0; }
  const fresh = key !== pageKey || !els.size;
  if (key !== pageKey) { els.clear(); box.replaceChildren(); pageKey = key; }
  const pend = [];
  const before = opts.flip ? measure() : new Map();
  const active = document.activeElement;
  const nodes = [];
  st.rows = []; st.info.clear();
  const seen = new Set();
  const pushRow = (id, m, smart) => {
    st.rows.push(id); st.info.set(id, m); seen.add(id);
    let el = els.get(id);
    if (!el && fresh && st.rows.length > FIRST && !smart) { pend.push([id, m]); return; }
    if (!el) { el = makeRow(id); els.set(id, el); }
    fillRow(el, id, m, smart);
    nodes.push(el);
  };
  renderHead();
  if (r.view === 'node' || r.view === 'inbox') {
    const root = pageRoot();
    for (const m of outlineRows(root)) pushRow(m.id, m, false);
  } else {
    for (const g of groupsFor(r.view)) {
      if (!g.rows.length) continue;
      if (g.label) {
        const gk = 'g:' + g.key;
        let ge = els.get(gk);
        if (!ge) {
          ge = h('div', { class: 'grp', role: 'presentation' });
          els.set(gk, ge);
        }
        const lab = typeof g.label === 'string'
          ? `<span class="gl">${g.icon || ''}${esc(g.label)}</span>`
          : `<span class="gn">${g.label.big}</span><span class="gl">${esc(g.label.small)}</span>`;
        if (ge._h !== lab) { ge.innerHTML = lab; ge._h = lab; }
        nodes.push(ge); seen.add(gk);
      }
      for (const id of g.rows) pushRow(id, { depth: 0, parent: S.parentOf(id) }, true);
    }
  }
  for (const k of [...els.keys()]) if (!seen.has(k)) els.delete(k);
  reconcile(box, nodes);
  if (pend.length) {
    const step = () => {
      const part = pend.splice(0, CHUNK), frag = document.createDocumentFragment();
      for (const [id, m] of part) { const el = makeRow(id); els.set(id, el); fillRow(el, id, m, false); frag.append(el); }
      box.append(frag);
      chunkJob = pend.length ? requestAnimationFrame(step) : 0;
      if (!pend.length) queueStrikes();
    };
    chunkJob = requestAnimationFrame(step);
  }
  // Roving tabindex: exactly one row is a Tab stop (the cursor, else the first row).
  if (!st.cursor || !st.rows.includes(st.cursor)) { const f = st.rows[0] && els.get(st.rows[0]); if (f) f.tabIndex = 0; }
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
  document.body.dataset.view = r.view;
  document.body.dataset.depth = String(depth);
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
export function renderSide() {
  const t = today();
  const td = S.qToday(t);
  const counts = { inbox: S.children(S.INBOX).filter((c) => !S.val(c, 'done')).length, today: td.day.length + td.eve.length };
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
