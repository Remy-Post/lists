// gesture.js — drag to reorder / re-nest (pointer and long-press), swipe to complete or schedule.
import * as S from './store.js';
import * as A from './actions.js';
import { st, $, h, haptic, pageRoot } from './state.js';
import { renderPage, renderSide, rowEl } from './view.js';
import { focusRow } from './input.js';
import { ui } from './ui.js';

const INDENT = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--indent')) || 24;
let drag = null;

export function wireGestures() {
  const box = $('#outline');
  box.addEventListener('pointerdown', down);
  document.addEventListener('touchmove', (e) => { if (drag && drag.on) e.preventDefault(); }, { passive: false });
  box.addEventListener('contextmenu', (e) => { if (drag || e.target.closest('.row') && st.touch) e.preventDefault(); });
}

function down(e) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const row = e.target.closest('.row');
  if (!row || st.route.view === 'trash' || st.route.view === 'logbook') return;
  const onText = e.target.closest('.tx');
  const touch = e.pointerType !== 'mouse';
  if (!touch && (onText || e.target.closest('.ck, .tw, .ct'))) return;
  if (touch && document.activeElement === row._tx) return; // editing: let the caret work
  const id = row.dataset.id;
  const d = { id, row, x0: e.clientX, y0: e.clientY, pid: e.pointerId, touch, on: false, swipe: null, t0: performance.now() };
  drag = d;
  if (touch) d.timer = setTimeout(() => { if (drag === d && !d.swipe) { start(d, e.clientX, e.clientY); haptic(10); } }, 420);
  const move = (ev) => onMove(d, ev);
  const up = (ev) => { cleanup(); onUp(d, ev); };
  const cancel = () => { cleanup(); abort(d); };
  const cleanup = () => {
    clearTimeout(d.timer);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel);
  };
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', up); addEventListener('pointercancel', cancel);
}

function onMove(d, e) {
  const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
  if (d.on) { e.preventDefault(); track(d, e.clientX, e.clientY); return; }
  if (d.swipe) { swipeMove(d, dx); return; }
  if (d.touch) {
    if (Math.hypot(dx, dy) > 8) clearTimeout(d.timer);
    const edge = d.x0 < 24 || d.x0 > innerWidth - 24;
    if (!edge && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) { d.swipe = { w: d.row.offsetWidth }; d.row.classList.add('swiping'); try { d.row.setPointerCapture(d.pid); } catch {} }
    return;
  }
  if (Math.hypot(dx, dy) > 5) start(d, e.clientX, e.clientY);
}

/* ---------------- swipe ---------------- */
const TH = 76;
function swipeMove(d, dx) {
  const x = Math.sign(dx) * Math.min(Math.abs(dx), d.swipe.w * 0.6) ** 0.96;
  d.swipe.x = x;
  d.row.style.setProperty('--sx', x.toFixed(1) + 'px');
  d.row.classList.toggle('sw-r', x > 0);
  d.row.classList.toggle('sw-l', x < 0);
  const armed = Math.abs(x) > TH;
  if (armed !== d.swipe.armed) { d.swipe.armed = armed; d.row.classList.toggle('armed', armed); if (armed) haptic(6); }
}
function endSwipe(d) {
  const { row } = d, x = d.swipe.x || 0, armed = d.swipe.armed;
  row._swiped = true;
  setTimeout(() => { row._swiped = false; }, 350);
  const reset = () => { row.classList.remove('swiping', 'sw-r', 'sw-l', 'armed'); row.style.removeProperty('--sx'); };
  if (!armed || st.reduced) { reset(); }
  else { row.style.setProperty('--sx', '0px'); setTimeout(reset, 200); }
  if (!armed) return;
  if (x > 0) { A.toggleDone([d.id]); renderPage(); renderSide(); }
  else ui.datePicker([d.id], 'when', row.querySelector('.tl'));
}

/* ---------------- drag ---------------- */
function start(d, x, y) {
  if (!pageRoot() && !['today'].includes(st.route.view)) { /* smart views: allow drop on sidebar only */ }
  d.on = true;
  const sel = st.sel.has(d.id) && st.sel.size > 1 ? A.tops([...st.sel]) : [d.id];
  d.ids = sel;
  const hidden = new Set(sel);
  for (const id of sel) for (const c of S.descendants(id)) hidden.add(c);
  d.hidden = hidden;
  d.cands = st.rows.filter((id) => !hidden.has(id));
  d.depth0 = st.info.get(d.id)?.depth || 0;
  d.outline = !!pageRoot() && (st.route.view === 'node' || st.route.view === 'inbox');
  for (const id of hidden) rowEl(id)?.classList.add('ghosted');
  const r = d.row.getBoundingClientRect();
  d.dx = x - r.left; d.dy = y - r.top;
  const g = d.row.cloneNode(true);
  g.classList.add('drag-ghost'); g.classList.remove('cur', 'sel', 'ghosted');
  g.style.width = r.width + 'px';
  if (sel.length > 1) g.append(h('span', { class: 'badge' }, String(sel.length)));
  document.body.append(g);
  d.ghost = g;
  d.line = h('div', { class: 'drop-line', 'aria-hidden': 'true' });
  $('#outline').append(d.line);
  document.body.classList.add('dragging');
  track(d, x, y);
}
function track(d, x, y) {
  d.ghost.style.transform = `translate(${x - d.dx}px, ${y - d.dy}px) scale(1.015)`;
  // Sidebar / bar targets.
  const over = document.elementFromPoint(x, y);
  const dest = over && over.closest('[data-list], [data-nav="inbox"], [data-nav="today"], [data-nav="someday"]');
  if (d.dest !== dest) { d.dest && d.dest.classList.remove('drop-on'); dest && dest.classList.add('drop-on'); d.dest = dest; }
  if (dest || !d.outline) { d.line.hidden = true; d.target = null; autoscroll(y); return; }
  d.line.hidden = false;
  // Gap under the pointer.
  let i = d.cands.length;
  for (let k = 0; k < d.cands.length; k++) {
    const el = rowEl(d.cands[k]); if (!el) continue;
    const b = el.getBoundingClientRect();
    if (y < b.top + b.height / 2) { i = k; break; }
  }
  const prev = d.cands[i - 1], next = d.cands[i];
  const dep = (id) => st.info.get(id)?.depth || 0;
  const maxD = prev ? dep(prev) + 1 : 0, minD = next ? dep(next) : 0;
  const want = d.depth0 + Math.round((x - d.x0) / INDENT());
  const depth = Math.max(minD, Math.min(maxD, want));
  d.target = resolve(prev, depth);
  const ob = $('#outline').getBoundingClientRect();
  const ref = prev ? rowEl(prev).getBoundingClientRect() : next ? rowEl(next).getBoundingClientRect() : ob;
  const ly = prev ? ref.bottom : ref.top;
  d.line.style.transform = `translate(${depth * INDENT()}px, ${ly - ob.top - 1}px)`;
  autoscroll(y);
}
function resolve(prev, depth) {
  const root = pageRoot();
  if (!prev) return { parent: root, index: 0 };
  const dp = st.info.get(prev)?.depth || 0;
  if (depth === dp + 1) return { parent: prev, index: 0 };
  let a = prev;
  for (let k = dp; k > depth; k--) a = st.info.get(a)?.parent || S.parentOf(a);
  const p = S.parentOf(a);
  return { parent: p, index: S.children(p).filter((c) => !drag.ids.includes(c)).indexOf(a) + 1 };
}
let scrollRaf = 0;
function autoscroll(y) {
  cancelAnimationFrame(scrollRaf);
  const zone = 64, bottom = innerHeight - (st.touch ? 72 : 0);
  const v = y < zone ? -(zone - y) : y > bottom - zone ? y - (bottom - zone) : 0;
  if (!v || !drag || !drag.on) return;
  const tick = () => { scrollBy(0, v * 0.35); scrollRaf = requestAnimationFrame(tick); };
  scrollRaf = requestAnimationFrame(tick);
}
function finish(d) {
  cancelAnimationFrame(scrollRaf);
  d.ghost && d.ghost.remove(); d.line && d.line.remove();
  d.dest && d.dest.classList.remove('drop-on');
  for (const id of d.hidden || []) rowEl(id)?.classList.remove('ghosted');
  document.body.classList.remove('dragging');
  drag = null;
}
function onUp(d, e) {
  if (d.swipe) { endSwipe(d); drag = null; return; }
  if (!d.on) { drag = null; return; }
  const dest = d.dest, t = d.target, ids = d.ids;
  finish(d);
  d.row._swiped = true; setTimeout(() => { d.row._swiped = false; }, 300);
  if (dest) {
    if (dest.dataset.list) { A.moveTo(ids, dest.dataset.list); ui.toast('Moved to ' + (S.val(dest.dataset.list, 'title') || 'Untitled'), { undo: true }); }
    else if (dest.dataset.nav === 'inbox') { A.moveTo(ids, S.INBOX); ui.toast('Moved to Inbox', { undo: true }); }
    else if (dest.dataset.nav === 'today') A.setWhen(ids, A.today());
    else if (dest.dataset.nav === 'someday') A.setWhen(ids, null, { someday: true });
  } else if (t && t.parent) {
    A.moveTo(ids, t.parent, t.index);
    st.collapsed.delete(t.parent);
  }
  renderPage({ flip: true }); renderSide();
  if (rowEl(ids[0])) focusRow(ids[0], { scroll: false });
  haptic(6);
}
function abort(d) {
  if (d.swipe) { d.row.classList.remove('swiping', 'sw-r', 'sw-l', 'armed'); d.row.style.removeProperty('--sx'); }
  if (d.on) finish(d); else drag = null;
}
