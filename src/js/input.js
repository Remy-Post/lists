// input.js — editing rows in place, the outliner keys while typing, pointer selection.
// Enter/Backspace are handled from `beforeinput` too, because Android keyboards send
// keydown "Unidentified" (docs/audits/01-plan-audit.md #1).
import * as S from './store.js';
import * as O from './ops.js';
import * as A from './actions.js';
import { st, $, pageRoot, haptic } from './state.js';
import { rowEl, renderPage, renderSide } from './view.js';
import { ui } from './ui.js';

/* ---------------- caret ---------------- */
export function caretOf(el) {
  const s = getSelection();
  if (!s.rangeCount || !el.contains(s.anchorNode)) return el.textContent.length;
  const r = s.getRangeAt(0), pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
const selCollapsed = () => { const s = getSelection(); return !s.rangeCount || s.getRangeAt(0).collapsed; };
export function setCaret(el, pos) {
  el.normalize();
  const len = el.textContent.length;
  pos = pos === 'end' || pos == null ? len : pos === 'start' ? 0 : Math.max(0, Math.min(pos, len));
  const r = document.createRange();
  if (el.firstChild && el.firstChild.nodeType === 3) r.setStart(el.firstChild, Math.min(pos, el.firstChild.length));
  else r.setStart(el, 0);
  r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
function caretRect() {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  const rects = r.getClientRects();
  if (rects.length) return rects[0];
  const span = document.createElement('span'); span.textContent = '​';
  r.insertNode(span); const q = span.getBoundingClientRect(); span.remove();
  return q;
}
function onEdge(tx, dir) {
  const c = caretRect(); const b = tx.getBoundingClientRect();
  if (!c || !c.height) return true;
  const lh = parseFloat(getComputedStyle(tx).lineHeight) || 20;
  return dir < 0 ? c.top - b.top < lh * 0.6 : b.bottom - c.bottom < lh * 0.6;
}

/* ---------------- focus & selection ---------------- */
export function focusRow(id, o = {}) {
  if (!id) return;
  const prev = st.cursor && rowEl(st.cursor);
  if (prev) prev.classList.remove('cur');
  st.cursor = id;
  if (!o.keepSel) { st.sel = new Set([id]); st.anchor = id; }
  paintSel();
  const el = rowEl(id);
  if (!el) return;
  el.classList.add('cur');
  if (prev && prev !== el) prev.tabIndex = -1;
  el.tabIndex = 0;
  if (o.edit) {
    el._tx.focus({ preventScroll: true });
    setCaret(el._tx, o.caret ?? 'end');
    st.mode = 'edit';
  } else {
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    st.mode = 'nav';
  }
  if (o.scroll !== false) el.scrollIntoView({ block: 'nearest', behavior: st.reduced || o.instant ? 'auto' : 'smooth' });
  ui.follow(id);
}
export function paintSel() {
  for (const id of st.rows) { const el = rowEl(id); if (el) { const on = st.sel.has(id); el.classList.toggle('sel', on); el.setAttribute('aria-selected', String(on)); } }
}
export function extendTo(id) {
  const a = st.rows.indexOf(st.anchor ?? st.cursor), b = st.rows.indexOf(id);
  if (a < 0 || b < 0) return;
  st.sel = new Set(st.rows.slice(Math.min(a, b), Math.max(a, b) + 1));
  focusRow(id, { keepSel: true });
}
const rowIdOf = (node) => node && node.closest && node.closest('.row') && node.closest('.row').dataset.id;
export const neighbour = (id, d) => st.rows[st.rows.indexOf(id) + d];

/* ---------------- edit commands ---------------- */
function enter(id, tx, shift) {
  if (shift) { ui.openInsp(id, 'notes'); return; }
  const text = tx.textContent, c = caretOf(tx);
  const smart = !pageRoot() || st.route.view !== 'node' && st.route.view !== 'inbox';
  // Enter on an empty nested row outdents it (as in Workflowy/Notion).
  if (!text && st.info.get(id)?.depth > 0 && !smart) {
    if (A.outdent([id])) { renderPage({ flip: true }); focusRow(id, { edit: true }); }
    return;
  }
  if (c === 0 && text) {
    const p = S.parentOf(id), i = S.children(p).indexOf(id);
    const nid = A.createAt(p, i, smart ? A.defaultTarget().fields : {});
    st.fresh.add(nid);
    renderPage({ flip: true });
    focusRow(id, { edit: true, caret: 0 });
    return;
  }
  const after = text.slice(c), before = text.slice(0, c);
  const wasFresh = st.fresh.has(id);
  let nid;
  O.tx('New item', () => {
    if (after) O.set(id, { title: before });
    if (wasFresh) A.commitFresh(id);
    const kids = S.hasChildren(id) && !st.collapsed.has(id) && !smart;
    if (kids) nid = O.create({ title: after, pos: S.posAt(id, 0) });
    else {
      const p = S.parentOf(id), i = S.children(p).indexOf(id);
      nid = O.create({ title: after, pos: S.posAt(p, i + 1), ...(smart ? A.defaultTarget().fields || {} : {}) });
    }
  }, { ctx: { route: { ...st.route }, sel: id } });
  st.fresh.add(nid);
  renderPage({ flip: true });
  if (document.activeElement !== tx) tx.textContent = S.val(id, 'title');
  focusRow(nid, { edit: true, caret: 0 });
}
/** Anything besides a title worth keeping? Then Backspace must not destroy it (audit S1-4). */
const hasContent = (id) => !!(S.val(id, 'notes') || S.val(id, 'when') || S.val(id, 'deadline') || S.val(id, 'rrule') || S.val(id, 'someday') || (S.val(id, 'tags') || []).length || S.val(id, 'priority'));
function backspaceAtStart(id, tx) {
  const text = tx.textContent;
  const prev = neighbour(id, -1);
  if (!text) {
    if (S.hasChildren(id)) return false;
    const keep = hasContent(id) && !st.fresh.has(id);
    O.tx('Delete', () => O.set(id, keep ? { deleted: 'trash', deletedAt: Date.now() } : { deleted: 'void' }), { ctx: { route: { ...st.route }, sel: id } });
    if (keep) ui.toast('Moved to Trash', { undo: true });
    renderPage({ flip: true });
    if (prev) focusRow(prev, { edit: true, caret: 'end' }); else focusRow(st.rows[0], { edit: true, caret: 0 });
    return true;
  }
  if (!prev || S.hasChildren(id) || S.val(prev, 'kind') !== 'item' || hasContent(id)) return false;
  const pt = S.val(prev, 'title');
  O.tx('Join', () => { O.set(prev, { title: pt + text }); O.set(id, { deleted: 'void' }); }, { ctx: { route: { ...st.route }, sel: prev } });
  renderPage({ flip: true });
  focusRow(prev, { edit: true, caret: pt.length });
  return true;
}
function vertical(id, tx, dir) {
  const target = neighbour(id, dir);
  if (!target) return false;
  const c = caretRect();
  const el = rowEl(target);
  el._tx.focus({ preventScroll: true });
  const b = el._tx.getBoundingClientRect();
  let placed = false;
  if (c && c.height) {
    const y = dir < 0 ? b.bottom - 4 : b.top + 4;
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(c.left, y) : null;
    const pos = !r && document.caretPositionFromPoint ? document.caretPositionFromPoint(c.left, y) : null;
    const node = r ? r.startContainer : pos && pos.offsetNode, off = r ? r.startOffset : pos && pos.offset;
    if (node && el._tx.contains(node)) { const s = getSelection(); s.removeAllRanges(); const rr = document.createRange(); rr.setStart(node, off); s.addRange(rr); placed = true; }
  }
  if (!placed) setCaret(el._tx, dir < 0 ? 'end' : 0);
  // Keep focus in the text (audit S2-2): update cursor and selection without focusing the row.
  const prevEl = st.cursor && rowEl(st.cursor);
  if (prevEl) prevEl.classList.remove('cur');
  st.cursor = target; st.sel = new Set([target]); st.anchor = target; st.mode = 'edit';
  el.classList.add('cur'); paintSel();
  el.scrollIntoView({ block: 'nearest' });
  ui.follow(target);
  return true;
}
/** Re-focus a row's title after a structural change, keeping the caret. */
function keepCaret(id, fn) {
  const tx = rowEl(id)?._tx;
  const c = tx ? caretOf(tx) : 'end';
  fn();
  renderPage({ flip: true });
  const el = rowEl(id);
  if (el) { el._tx.focus({ preventScroll: true }); setCaret(el._tx, c); st.cursor = id; st.mode = 'edit'; el.classList.add('cur'); el.scrollIntoView({ block: 'nearest' }); }
}
export const structural = { keepCaret };

/* ---------------- wire ---------------- */
let shiftDown = false;
export function wire() {
  const box = $('#outline');

  box.addEventListener('focusin', (e) => {
    const id = rowIdOf(e.target);
    if (!id) return;
    if (e.target.classList.contains('tx')) {
      st.mode = 'edit';
      if (st.cursor !== id) { const p = st.cursor && rowEl(st.cursor); if (p) p.classList.remove('cur'); st.cursor = id; rowEl(id).classList.add('cur'); }
      if (!st.sel.has(id) || st.sel.size > 1) { st.sel = new Set([id]); st.anchor = id; paintSel(); }
      ui.follow(id);
      ui.accessory(true);
    }
  });
  box.addEventListener('focusout', (e) => {
    const id = rowIdOf(e.target);
    if (!id || !e.target.classList.contains('tx')) return;
    const to = e.relatedTarget;
    if (A.commitFresh(id)) { renderPage(); renderSide(); }
    if (!to || !to.classList || !to.classList.contains('tx')) {
      st.mode = 'nav';
      setTimeout(() => { if (!document.activeElement || !document.activeElement.classList.contains('tx')) ui.accessory(false); }, 60);
    }
  });
  box.addEventListener('input', (e) => {
    const tx = e.target;
    if (!tx.classList || !tx.classList.contains('tx')) return;
    const id = rowIdOf(tx);
    let t = tx.textContent;
    if (/[\n\r]/.test(t)) { t = t.replace(/[\n\r]+/g, ' '); tx.textContent = t; setCaret(tx, 'end'); }
    O.tx('Typing', () => O.set(id, { title: t }), { merge: 't:' + id, ctx: { route: { ...st.route }, sel: id } });
  });
  box.addEventListener('beforeinput', (e) => {
    const tx = e.target;
    if (!tx.classList || !tx.classList.contains('tx') || e.isComposing) return;
    const id = rowIdOf(tx);
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      enter(id, tx, shiftDown && e.inputType === 'insertLineBreak');
    } else if (e.inputType === 'deleteContentBackward' && selCollapsed() && caretOf(tx) === 0) {
      if (backspaceAtStart(id, tx)) e.preventDefault();
    }
  });
  box.addEventListener('keydown', (e) => {
    const tx = e.target;
    shiftDown = e.shiftKey;
    if (!tx.classList || !tx.classList.contains('tx') || e.isComposing || e.keyCode === 229) return;
    const id = rowIdOf(tx);
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !mod) { e.preventDefault(); enter(id, tx, e.shiftKey); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      keepCaret(id, () => (e.shiftKey ? A.outdent([id]) : A.indent([id])));
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); A.commitFresh(id); focusRow(id); renderPage(); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.altKey && e.shiftKey || mod && e.shiftKey)) {
      e.preventDefault(); keepCaret(id, () => A.moveBy(e.key === 'ArrowUp' ? -1 : 1, [id])); return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !mod && !e.altKey) {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (onEdge(tx, dir) && vertical(id, tx, dir)) e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && !mod && selCollapsed() && caretOf(tx) === 0) {
      if (backspaceAtStart(id, tx)) e.preventDefault();
      return;
    }
    if (mod && e.key === 'Enter') { e.preventDefault(); A.toggleDone([id]); return; }
  });
  box.addEventListener('keyup', (e) => { shiftDown = e.shiftKey; });
  box.addEventListener('paste', (e) => {
    const tx = e.target;
    if (!tx.classList || !tx.classList.contains('tx')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const id = rowIdOf(tx);
    if (/\n/.test(text.trim())) {
      e.preventDefault();
      const p = S.parentOf(id), i = S.children(p).indexOf(id);
      const empty = !tx.textContent;
      const smart = st.route.view !== 'node' && st.route.view !== 'inbox';
      const top = smart ? { ...(A.defaultTarget().fields || {}) } : {};
      if (smart) for (const k of ['when', 'evening', 'someday']) if (S.val(id, k)) top[k] = S.val(id, k);
      const ids = O.tx('Paste', () => {
        const out = A.pasteOutline(text, p, i + 1, top);
        if (empty) O.set(id, { deleted: 'void' });
        return out;
      });
      renderPage({ flip: true });
      ui.toast(`Pasted ${ids.length} items`, { undo: true });
      if (ids.length) focusRow(ids[ids.length - 1], { edit: true });
    } else if (tx.contentEditable === 'true') {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  });

  // Pointer: checkbox, twisty, count, row selection.
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    if (row._swiped) { row._swiped = false; return; }
    if (e.target.closest('.ck')) {
      e.preventDefault();
      if (st.route.view === 'trash' || S.val(id, 'kind') === 'log') return; // repeat logs are a record, not a task
      haptic(8);
      A.toggleDone(st.sel.has(id) && st.sel.size > 1 ? [...st.sel] : [id]);
      return;
    }
    if (e.target.closest('.tw')) { toggleCollapse(id); return; }
    if (e.target.closest('.ct')) { ui.go({ view: 'node', id }, 'pointer', row); return; }
    if (e.target.closest('.tx')) return;
    if (e.shiftKey) { extendTo(id); return; }
    if (e.metaKey || e.ctrlKey) {
      if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id);
      st.cursor = id; paintSel(); return;
    }
    if (st.touch) { ui.openInsp(id); return; }
    focusRow(id);
  });
  box.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (row && !e.target.closest('.tx, .ck, .tw')) ui.openInsp(row.dataset.id);
  });
}
export function toggleCollapse(id, force) {
  if (!S.hasChildren(id)) return;
  const c = force ?? !st.collapsed.has(id);
  if (c) st.collapsed.add(id); else st.collapsed.delete(id);
  ui.saveCollapsed();
  renderPage({ flip: true });
  if (st.cursor && !st.rows.includes(st.cursor)) focusRow(id);
}
