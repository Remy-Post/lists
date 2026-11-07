// ui.js — surfaces: inspector, composer, date picker, palette, toasts, settings, cheat sheet.
// Phones get bottom sheets; desktops get popovers and a docked inspector.
import * as S from './store.js';
import * as O from './ops.js';
import * as A from './actions.js';
import * as DB from './db.js';
import { st, $, h, MOD, haptic } from './state.js';
import { parseQuick, suggestDates, formatDay, describeRRule, fromYMD, ymd } from './parse.js';
import { renderPage, renderSide, rowEl, ICON } from './view.js';
import { commands, pretty } from './keys.js';
import { structural } from './input.js';

export const ui = {};
const layer = () => $('#layer');
const wide = () => matchMedia('(min-width: 1440px)').matches;
export const phone = () => matchMedia('(max-width: 599.98px)').matches;

/* ---------------- layers (sheets / popovers / modals) ---------------- */
const stack = [];
ui.modalOpen = () => stack.length > 0;
export function open(panel, o = {}) {
  const kind = o.kind || (phone() ? 'sheet' : o.anchor ? 'pop' : 'modal');
  const wrap = h('div', { class: 'lyr ' + kind });
  const scrim = h('div', { class: 'scrim', onclick: () => close(entry) });
  panel.classList.add('panel');
  panel.setAttribute('role', o.role || 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (o.label) panel.setAttribute('aria-label', o.label);
  if (kind === 'sheet') panel.prepend(h('div', { class: 'grab', 'aria-hidden': 'true' }));
  wrap.append(scrim, panel);
  layer().append(wrap);
  const prevFocus = document.activeElement;
  const entry = { wrap, panel, onClose: o.onClose, prevFocus };
  stack.push(entry);
  if (kind === 'pop' && o.anchor) place(panel, o.anchor);
  if (kind === 'sheet') dragDismiss(panel, () => close(entry));
  // Keep Tab inside the dialog (WCAG 2.4.3 / APG dialog pattern).
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  requestAnimationFrame(() => wrap.classList.add('in'));
  $('#app').inert = true;
  if (!o.noFocus) setTimeout(() => {
    if (panel.contains(document.activeElement)) return;
    const f = panel.querySelector('input, textarea, button:not(.grab), [href], [tabindex]:not([tabindex="-1"])');
    if (f) f.focus({ preventScroll: true }); else { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
  }, 30);
  return entry;
}
export function close(entry, restore = true) {
  const i = stack.indexOf(entry);
  if (i < 0) return;
  stack.splice(i, 1);
  if (!stack.length) $('#app').inert = false;
  entry.wrap.classList.remove('in');
  entry.wrap.classList.add('out');
  const rm = () => entry.wrap.remove();
  if (st.reduced) rm(); else setTimeout(rm, 200);
  entry.onClose && entry.onClose();
  if (restore && entry.prevFocus && entry.prevFocus.isConnected) entry.prevFocus.focus({ preventScroll: true });
}
const closeTop = () => { const e = stack[stack.length - 1]; if (e) close(e); return !!e; };
ui.closeAll = () => { while (stack.length) close(stack[stack.length - 1], false); };
function place(panel, anchor) {
  const r = anchor.getBoundingClientRect();
  panel.style.position = 'fixed';
  requestAnimationFrame(() => {
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let x = Math.min(innerWidth - pw - 12, Math.max(12, r.left));
    let y = r.bottom + 6;
    if (y + ph > innerHeight - 12) y = Math.max(12, r.top - ph - 6);
    panel.style.left = x + 'px'; panel.style.top = y + 'px';
    panel.style.transformOrigin = `${r.left - x + 12}px ${y > r.top ? 0 : ph}px`;
  });
}
function dragDismiss(panel, done) {
  let y0 = null, dy = 0;
  const grab = panel.querySelector('.grab');
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); panel.style.transition = 'none'; });
  grab.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (y0 == null) return; y0 = null; panel.style.transition = ''; panel.style.transform = ''; if (dy > 90) done(); };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) { e.preventDefault(); e.stopPropagation(); closeTop(); } }, true);

/* ---------------- toasts ---------------- */
let toastEl = null, toastT = 0;
const toastRegion = () => {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); toastEl.inert = true; document.body.append(toastEl); }
  return toastEl;
};
queueMicrotask(toastRegion); // the live region must exist before its first message, or it isn't announced
ui.toast = (msg, o = {}) => {
  toastRegion();
  toastEl.replaceChildren(h('span', null, msg));
  // Undo applies to the step this toast announced, never to something newer.
  const step = o.undo ? O.peekUndo() : null;
  if (o.undo) toastEl.append(h('button', { class: 'tbtn', onclick: () => { if (O.peekUndo() === step) ui.undo(); else ui.toast('That was already changed'); hide(); } }, 'Undo'));
  if (o.action) toastEl.append(h('button', { class: 'tbtn', onclick: () => { o.action.run(); hide(); } }, o.action.label));
  toastEl.classList.add('in');
  toastEl.inert = false;
  clearTimeout(toastT);
  const hide = () => { toastEl.classList.remove('in'); toastEl.inert = true; };
  toastT = setTimeout(hide, o.ms || (o.undo ? 5200 : 2600));
};
A.setNotify((kind, ids) => {
  if (kind === 'trash') ui.toast(ids.length > 1 ? `Moved ${ids.length} items to Trash` : 'Moved to Trash', { undo: true });
  if (kind === 'done' && ids.length > 1) ui.toast(`Completed ${ids.length}`, { undo: true });
  if (kind === 'done') ui.afterDone && ui.afterDone(ids);
});

/* ---------------- undo / redo with context ---------------- */
function restoreCtx(t) {
  if (!t || !t.ctx) return;
  const r = t.ctx.route;
  if (r && (r.view !== st.route.view || r.id !== st.route.id)) ui.go(r, 'key');
  renderPage({ flip: true }); renderSide();
  const id = t.ctx.sel;
  if (id && rowEl(id)) ui.focus(id);
}
ui.undo = () => { const t = O.undo(); if (!t) { ui.toast('Nothing to undo'); return; } restoreCtx(t); ui.toast('Undid ' + t.label.toLowerCase()); };
ui.redo = () => { const t = O.redo(); if (!t) return; restoreCtx(t); ui.toast('Redid ' + t.label.toLowerCase()); };

/* ---------------- inspector ---------------- */
let insp = null; // { id, el, entry }
ui.follow = (id) => { if (insp && insp.docked && id !== insp.id && S.recs.has(id)) fillInsp(id); };
ui.openInsp = (id, focus) => {
  if (!id || !S.recs.has(id)) return;
  if (insp && insp.id === id && !focus) { if (!insp.docked) return; }
  const docked = wide();
  if (insp && !insp.docked) close(insp.entry, false);
  const el = docked ? $('#insp') : h('section', { class: 'insp-sheet' });
  insp = { id, el, docked };
  if (docked) { el.hidden = false; document.body.classList.add('has-insp'); }
  else insp.entry = open(el, { label: 'Details', onClose: () => { insp = null; } });
  fillInsp(id);
  if (focus) setTimeout(() => { const f = el.querySelector(`[data-f="${focus}"]`); if (f) { f.focus(); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); } }, 30);
};
ui.closeInsp = () => {
  if (!insp) return false;
  if (insp.docked) { insp.el.hidden = true; insp.el.replaceChildren(); document.body.classList.remove('has-insp'); }
  else close(insp.entry);
  insp = null;
  return true;
};
ui.refreshInsp = () => { if (insp && S.recs.has(insp.id)) { if (!S.isLive(insp.id)) ui.closeInsp(); else if (!insp.el.contains(document.activeElement)) fillInsp(insp.id); } };
function fillInsp(id) {
  const el = insp.el;
  insp.id = id;
  const v = (k) => S.val(id, k);
  const save = (f, merge) => { O.tx('Edit', () => O.set(id, f), { merge, ctx: { route: { ...st.route }, sel: id } }); renderPage(); renderSide(); };
  const title = h('textarea', { class: 'i-title', rows: '1', 'data-f': 'title', 'aria-label': 'Title', placeholder: 'New item' });
  title.value = v('title');
  title.addEventListener('input', () => { title.value = title.value.replace(/\n/g, ' '); autosize(title); save({ title: title.value }, 'it:' + id); });
  const notes = h('textarea', { class: 'i-notes', rows: '3', 'data-f': 'notes', 'aria-label': 'Notes', placeholder: 'Notes' });
  notes.value = v('notes');
  notes.addEventListener('input', () => { autosize(notes); save({ notes: notes.value }, 'in:' + id); });
  const anc = S.ancestors(id);
  const path = h('nav', { class: 'i-path', 'aria-label': 'Location' },
    ...anc.map((a) => h('a', { href: '#/' + (a === S.INBOX ? 'inbox' : 'n/' + a) }, a === S.INBOX ? 'Inbox' : S.val(a, 'title') || 'Untitled')));
  const w = v('when'), dl = v('deadline');
  const whenTxt = w ? (formatDay(w, new Date()) + (v('evening') ? ', evening' : '')) : v('someday') ? 'Someday' : '';
  const field = (label, value, onclick, cls = '') => h('button', { class: 'i-field ' + cls, onclick }, h('span', { class: 'k' }, label), h('span', { class: 'v' + (value ? '' : ' none') }, value || 'Add…'));
  const repeat = h('input', { class: 'i-rep', 'data-f': 'repeat', placeholder: 'Never', 'aria-label': 'Repeat, for example every monday' });
  repeat.value = v('rrule') ? safe(() => describeRRule(v('rrule'))) : '';
  repeat.addEventListener('change', () => {
    const txt = repeat.value.trim();
    if (!txt) { save({ rrule: null }); return; }
    const p = parseQuick('x ' + (/^(every|after)/i.test(txt) ? txt : 'every ' + txt));
    const explicit = /every!|^after/i.test(txt);
    if (p.rrule) { save({ rrule: p.rrule, repeatFrom: explicit ? p.repeatFrom : v('repeatFrom') || 'when', ...(v('when') ? {} : { when: p.when }) }); repeat.value = safe(() => describeRRule(p.rrule)); setTimeout(() => insp && insp.id === id && !insp.el.contains(document.activeElement) && fillInsp(id), 250); }
    else { repeat.value = v('rrule') ? safe(() => describeRRule(v('rrule'))) : ''; ui.toast('Try “every monday” or “every! 3 days”'); }
  });
  const pri = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Priority' },
    ...['None', '!', '!!', '!!!'].map((lbl, i) => h('button', { role: 'radio', 'aria-checked': String(v('priority') === i), class: v('priority') === i ? 'on' : '', onclick: () => { save({ priority: i }); fillInsp(id); } }, lbl)));
  const kids = S.hasChildren(id);
  const repMode = v('rrule') ? h('div', { class: 'seg sm', role: 'radiogroup', 'aria-label': 'Repeat from' },
    ...[['when', 'On schedule'], ['done', 'After done']].map(([k, l]) => h('button', { role: 'radio', 'aria-checked': String((v('repeatFrom') || 'when') === k), class: (v('repeatFrom') || 'when') === k ? 'on' : '', onclick: () => { save({ repeatFrom: k }); fillInsp(id); } }, l))) : null;
  el.replaceChildren(...[
    h('div', { class: 'i-top' },
      h('button', { class: 'ck big' + (v('done') ? ' on' : ''), role: 'checkbox', 'aria-checked': String(!!v('done')), 'aria-label': 'Complete', html: ICON.check, onclick: () => { A.toggleDone([id]); renderPage(); renderSide(); fillInsp(id); } }),
      title),
    path.childElementCount ? path : null,
    notes,
    h('div', { class: 'i-grid' },
      field('When', whenTxt, (e) => ui.datePicker([id], 'when', e.currentTarget)),
      field('Deadline', dl ? formatDay(dl, new Date()) : 'None', (e) => ui.datePicker([id], 'deadline', e.currentTarget), dl && dl < A.today() && !v('done') ? 'late' : ''),
      h('label', { class: 'i-field' }, h('span', { class: 'k' }, 'Repeat'), repeat),
      repMode ? h('div', { class: 'i-field' }, h('span', { class: 'k' }, ''), repMode) : null,
      h('div', { class: 'i-field' }, h('span', { class: 'k' }, 'Priority'), pri)),
    h('div', { class: 'i-acts' },
      h('button', { class: 'btn', onclick: () => ui.go({ view: 'node', id }, 'pointer') }, kids ? `Open (${S.countOpen(id)} open)` : 'Open as page'),
      h('button', { class: 'btn', onclick: () => { st.sel = new Set([id]); st.cursor = id; ui.palette('move'); } }, 'Move…'),
      h('button', { class: 'btn', onclick: () => { A.toggleHeading([id]); renderPage(); fillInsp(id); } }, v('heading') ? 'Make item' : 'Make heading'),
      h('button', { class: 'btn danger', onclick: () => { A.trash([id]); ui.closeInsp(); renderPage({ flip: true }); renderSide(); } }, 'Delete')),
    h('p', { class: 'i-meta' }, ...[v('created') ? 'Created ' + new Date(v('created')).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '', v('done') && v('doneAt') ? 'Completed ' + new Date(v('doneAt')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''].filter(Boolean).map((t) => h('span', null, t))),
    insp.docked ? h('button', { class: 'i-close', 'aria-label': 'Close details', onclick: () => ui.closeInsp(), html: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3 3 9"/></svg>' }) : null,
  ].filter(Boolean));
  requestAnimationFrame(() => { autosize(title); autosize(notes); });
}
const safe = (f) => { try { return f(); } catch { return ''; } };
function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

/* ---------------- date picker ---------------- */
ui.datePicker = (ids, mode, anchor) => {
  ids = ids.filter((id) => S.recs.has(id));
  if (!ids.length) return;
  anchor = anchor || rowEl(ids[0])?.querySelector('.tl') || $('#ptitle');
  const cur = S.val(ids[0], mode);
  let month = fromYMD(cur || A.today()); month.setDate(1);
  const input = h('input', { class: 'dp-in', placeholder: mode === 'when' ? 'When? tomorrow, fri, in 3 days…' : 'Deadline? fri, nov 30…', 'aria-label': mode === 'when' ? 'When' : 'Deadline', autocomplete: 'off', enterkeyhint: 'done' });
  const sugg = h('div', { class: 'dp-sugg', role: 'listbox', id: 'dp-sugg' });
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'dp-sugg'); input.setAttribute('aria-expanded', 'true');
  const grid = h('div', { class: 'dp-grid', role: 'group', 'aria-label': 'Calendar' });
  const head = h('div', { class: 'dp-head' });
  const pick = (d, o = {}) => {
    if (mode === 'when') A.setWhen(ids, d, o); else A.setDeadline(ids, d);
    close(entry); renderPage({ flip: true }); renderSide();
    if (insp && ids.includes(insp.id)) fillInsp(insp.id); else ui.refreshInsp();
    haptic(6);
    if (d && mode === 'when') ui.toast((ids.length > 1 ? `${ids.length} items → ` : '') + (o.evening ? 'This evening' : formatDay(d, new Date())), { undo: true });
  };
  const quick = mode === 'when' ? [
    ['Today', () => pick(A.today())], ['This evening', () => pick(A.today(), { evening: true })], ['Tomorrow', () => pick(A.addDays(A.today(), 1))],
    ['Next week', () => pick(nextMonday())], ['Someday', () => pick(null, { someday: true })], ['Clear', () => pick(null)],
  ] : [['Today', () => pick(A.today())], ['Tomorrow', () => pick(A.addDays(A.today(), 1))], ['End of week', () => pick(friday())], ['Clear', () => pick(null)]];
  const qrow = h('div', { class: 'dp-quick' }, ...quick.map(([l, f]) => h('button', { class: 'chipbtn', onclick: f }, l)));
  let active = -1, opts = [];
  const drawSugg = () => {
    const q = input.value.trim();
    opts = q ? suggestDates(q, new Date()).slice(0, 5) : [];
    sugg.replaceChildren(...opts.map((o, i) => h('button', { class: 'opt' + (i === active ? ' on' : ''), id: 'dp-opt-' + i, role: 'option', 'aria-selected': String(i === active), onclick: () => pick(o.date, { evening: o.evening, someday: o.someday }) },
      h('span', null, o.label), h('span', { class: 'muted' }, o.date && formatDay(o.date, new Date()) !== o.label ? fromYMD(o.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''))));
    if (active >= 0 && opts[active]) input.setAttribute('aria-activedescendant', 'dp-opt-' + active); else input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('input', () => { active = opts.length ? 0 : -1; drawSugg(); if (active < 0 && opts.length) active = 0; drawSugg(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(opts.length - 1, active + 1); drawSugg(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); drawSugg(); }
    if (e.key === 'Enter') { e.preventDefault(); const o = opts[Math.max(0, active)]; if (o) pick(o.date, { evening: o.evening, someday: o.someday }); }
  });
  const drawGrid = () => {
    const t = A.today();
    head.replaceChildren(
      h('button', { class: 'nav', 'aria-label': 'Previous month', onclick: () => { month.setMonth(month.getMonth() - 1); drawGrid(); }, html: '<svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>' }),
      h('span', { class: 'mo' }, month.toLocaleDateString(undefined, { month: 'long', year: month.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })),
      h('button', { class: 'nav', 'aria-label': 'Next month', onclick: () => { month.setMonth(month.getMonth() + 1); drawGrid(); }, html: '<svg viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>' }));
    const first = new Date(month); const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('span', { class: 'dow', 'aria-hidden': 'true' }, d));
    for (let i = 0; i < lead; i++) cells.push(h('span'));
    for (let d = 1; d <= days; d++) {
      const y = ymd(new Date(month.getFullYear(), month.getMonth(), d));
      cells.push(h('button', { class: 'day' + (y === t ? ' today' : '') + (y === cur ? ' on' : '') + (y < t ? ' past' : ''), 'aria-label': new Date(month.getFullYear(), month.getMonth(), d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), 'aria-current': y === t ? 'date' : null, 'aria-pressed': y === cur ? 'true' : null, onclick: () => pick(y) }, String(d)));
    }
    grid.replaceChildren(...cells);
  };
  drawGrid();
  const panel = h('section', { class: 'dp' }, input, sugg, qrow, head, grid);
  const entry = open(panel, { anchor, label: mode === 'when' ? 'When' : 'Deadline' });
  input.focus({ preventScroll: true });
};
function nextMonday() { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return ymd(d); }
function friday() { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return ymd(d); }

/* ---------------- composer (quick add) ---------------- */
ui.compose = (at) => {
  const ta = h('textarea', { class: 'qa-in', rows: '1', placeholder: 'New item — try “Call Ana fri !” or “Pay rent every 1st”', 'aria-label': 'New item', autocomplete: 'off', enterkeyhint: 'done', spellcheck: 'false' });
  const mirror = h('div', { class: 'qa-mirror', 'aria-hidden': 'true' });
  const preview = h('div', { class: 'qa-prev', 'aria-live': 'polite' });
  const where = h('div', { class: 'qa-where' });
  let ignore = [];
  const target = at || A.defaultTarget();
  const tname = target.parent === S.INBOX ? 'Inbox' : S.val(target.parent, 'title') || 'Untitled';
  ta.value = DB.getMeta('draft') || '';
  const draw = () => {
    const text = ta.value;
    const p = parseQuick(text, new Date(), { ignore });
    // Mirror: the same text with recognised tokens marked (click a token to keep it literal).
    const frag = []; let i = 0;
    for (const t of p.tokens || []) { frag.push(esc(text.slice(i, t.start)), `<mark class="k-${t.kind}">${esc(text.slice(t.start, t.end))}</mark>`); i = t.end; }
    frag.push(esc(text.slice(i)) + ' ');
    mirror.innerHTML = frag.join('');
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    const bits = [];
    if (p.when) bits.push((p.evening ? 'This evening' : formatDay(p.when, new Date())) + (p.time ? ' ' + p.time : ''));
    if (p.someday) bits.push('Someday');
    if (p.deadline) bits.push('Deadline ' + formatDay(p.deadline, new Date()));
    if (p.priority) bits.push('!'.repeat(p.priority));
    if (p.rrule) bits.push(safe(() => describeRRule(p.rrule)) + (p.repeatFrom === 'done' ? ' after completion' : ''));
    if (p.tags && p.tags.length) bits.push(p.tags.map((t) => '@' + t).join(' '));
    const l = p.list ? A.findList(p.list) : null;
    where.textContent = 'In ' + (l ? S.val(l, 'title') : p.list ? `${tname} (no list “${p.list}”)` : tname);
    preview.replaceChildren(...bits.map((b) => h('span', null, b)));
    if (DB.getMeta('draft') !== text) { DB.setMeta('draft', text); DB.flush(); } // a draft must survive a kill
  };
  let prevVal = ta.value;
  ta.addEventListener('input', () => {
    // Keep literal spans attached to their text when the user edits before them (req-dates-views-9).
    const v = ta.value, d = v.length - prevVal.length, at = ta.selectionStart - Math.max(d, 0);
    ignore = ignore.filter(([s, e]) => e <= at || s >= at + Math.max(-d, 0)).map(([s, e]) => (s >= at ? [s + d, e + d] : [s, e])).filter(([s, e]) => e <= v.length);
    prevVal = v;
    if (/\n/.test(v)) { ta.value = v.replace(/\n+/g, ' '); prevVal = ta.value; }
    draw();
  });
  ta.addEventListener('click', () => {
    const c = ta.selectionStart;
    const p = parseQuick(ta.value, new Date(), { ignore });
    const t = ta.selectionStart === ta.selectionEnd && (p.tokens || []).find((x) => c > x.start && c < x.end);
    if (t) { ignore.push([t.start, t.end]); draw(); }
  });
  ta.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/\n/.test(text.trim())) return;
    // Many lines: an outline, not a title (req-outline-04).
    e.preventDefault();
    const ids = A.pasteOutline(text, target.parent, at && at.index != null ? at.index : S.children(target.parent).length, target.fields || {});
    close(entry); renderPage({ flip: true }); renderSide();
    ui.toast(`Added ${ids.length} items`, { undo: true });
  });
  const submit = (closeAfter) => {
    if (!ta.value.trim()) { close(entry); return; }
    const id = A.quickAdd(ta.value, { ...target, index: at && at.index != null ? at.index : S.children(target.parent).length }, ignore);
    if (id && at && at.index != null) at.index++;
    if (id) { haptic(6); renderPage({ flip: true }); renderSide(); ui.toast('Added', { undo: true, ms: 1800 }); }
    ta.value = ''; prevVal = ''; ignore = []; DB.setMeta('draft', ''); draw();
    if (closeAfter) close(entry); else ta.focus();
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(e.metaKey || e.ctrlKey); }
  });
  const panel = h('section', { class: 'qa' },
    h('div', { class: 'qa-field' }, mirror, ta),
    h('div', { class: 'qa-foot' }, where, preview,
      st.touch ? h('button', { class: 'btn primary qa-add', onclick: () => submit(false) }, 'Add') : h('span', { class: 'qa-hint' }, h('kbd', null, 'Return'), ' adds, ', h('kbd', null, 'Esc'), ' closes')));
  const entry = open(panel, { kind: phone() ? 'sheet' : 'modal', label: 'Quick add' });
  draw();
  ta.focus({ preventScroll: true });
};
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------------- palette ---------------- */
let palOpen = null;
ui.palette = (mode = 'all') => {
  if (palOpen) { palOpen.querySelector('input').focus(); return; }
  const input = h('input', { class: 'pal-in', placeholder: mode === 'move' ? 'Move to…' : 'Type a command or search', 'aria-label': 'Command', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list' });
  const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox' });
  let items = [], active = 0;
  const ids = A.targets();
  const pathOf = (id) => S.ancestors(id).map((a) => (a === S.INBOX ? 'Inbox' : S.val(a, 'title') || 'Untitled')).join(' › ');
  const build = () => {
    const q = input.value.trim().toLowerCase();
    items = [];
    if (mode === 'move') {
      const dests = [S.INBOX, ...[...S.recs.keys()].filter((id) => id !== S.INBOX && id !== S.ROOT && S.isLive(id) && !S.val(id, 'done') && S.val(id, 'kind') === 'item' && (S.parentOf(id) === S.ROOT || S.hasChildren(id)))];
      for (const d of dests) {
        if (ids.some((x) => !S.canMove(x, d))) continue;
        const name = d === S.INBOX ? 'Inbox' : S.val(d, 'title') || 'Untitled';
        if (q && !name.toLowerCase().includes(q)) continue;
        items.push({ label: name, sub: d === S.INBOX ? '' : pathOf(d), run: () => { A.moveTo(ids, d); renderPage({ flip: true }); renderSide(); ui.toast('Moved to ' + name, { undo: true }); } });
        if (items.length > 60) break;
      }
      if (q && !items.length) items.push({ label: `New list “${input.value.trim()}”`, sub: '', run: () => { const l = A.newList(input.value.trim()); A.moveTo(ids, l); renderPage(); renderSide(); } });
    } else {
      for (const c of commands) {
        if (c.hidden || (c.test && !c.test())) continue;
        if (q && !c.label.toLowerCase().includes(q)) continue;
        items.push({ label: c.label, keys: c.keys.slice(0, 1).map(pretty), run: c.run, cmd: true });
      }
      if (q) for (const id of S.search(q, 30)) {
        items.push({ label: S.val(id, 'title') || 'Untitled', sub: pathOf(id), done: S.val(id, 'done'), run: () => reveal(id) });
      }
      if (!q) {
        // Empty query: where you might go, then what you can do to the selection (visual S2-15).
        const go = [['Inbox', { view: 'inbox' }], ['Today', { view: 'today' }], ['Upcoming', { view: 'upcoming' }], ['Someday', { view: 'someday' }], ['Logbook', { view: 'logbook' }]]
          .map(([l, r]) => ({ label: l, sub: 'Go to', run: () => ui.go(r, 'key') }));
        const lists = S.children(S.ROOT).filter((x) => x !== S.INBOX).slice(0, 6).map((x) => ({ label: S.val(x, 'title') || 'Untitled', sub: 'List', run: () => ui.go({ view: 'node', id: x }, 'key') }));
        const verbs = ['done', 'when', 'move', 'quick', 'help'].map((k) => commands.find((c) => c.id === k)).filter((c) => c && (!c.test || c.test()))
          .map((c) => ({ label: c.label, keys: c.keys.slice(0, 1).map(pretty), run: c.run, cmd: true }));
        items = [...verbs, ...go, ...lists];
      }
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => h('div', { class: 'opt' + (i === active ? ' on' : '') + (it.done ? ' isdone' : ''), id: 'pal-opt-' + i, role: 'option', 'aria-selected': String(i === active), onpointerdown: (e) => e.preventDefault(), onclick: () => run(i) },
      h('span', { class: 'ol' }, it.label), it.sub ? h('span', { class: 'os' }, it.sub) : null, it.keys && it.keys[0] ? h('kbd', null, it.keys[0]) : null)));
    const on = list.children[active];
    if (on) { on.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', on.id); } else input.removeAttribute('aria-activedescendant');
  };
  const run = (i) => { const it = items[i]; if (!it) return; close(entry, !it.cmd); it.run(); };
  input.addEventListener('input', () => { active = 0; build(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); build(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); build(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  const panel = h('section', { class: 'pal' }, input, list);
  palOpen = panel;
  const entry = open(panel, { kind: phone() ? 'sheet' : 'modal', label: 'Command palette', onClose: () => { palOpen = null; } });
  build();
  input.focus({ preventScroll: true });
};
function reveal(id) {
  // Open the page that contains the item, expand its ancestors, focus it.
  const anc = S.ancestors(id);
  const top = anc[0];
  for (const a of anc) st.collapsed.delete(a);
  ui.saveCollapsed();
  if (!st.showDone && [id, ...anc].some((x) => !A.visible(x))) { st.showDone = true; ui.toast('Showing completed items'); }
  ui.go(top === S.INBOX ? { view: 'inbox' } : top ? { view: 'node', id: top } : { view: 'node', id }, 'key');
  if (rowEl(id)) ui.focus(id);
}

ui.restoreRecords = (recs) => {
  O.tx('Restore backup', () => {
    for (const r of recs) {
      const f = {};
      for (const k in r.f) if (k !== 'created' || !S.recs.has(r.id)) f[k] = r.f[k][0];
      O.set(r.id, f);
    }
  });
  renderPage(); renderSide();
};
/* ---------------- lazy panels (panels.js) ---------------- */
let panels = null;
const lazy = (name) => async (...a) => {
  if (!panels) {
    panels = await import('./panels.js');
    panels.install({ S, A, DB, st, h, renderPage, renderSide, commands, pretty, ui, open, close, phone });
  }
  return ui[name](...a);
};
for (const n of ['cheat', 'settings', 'exportMd', 'exportJson', 'importFile']) ui[n] = lazy(n);

/* ---------------- theme ---------------- */
ui.setTheme = (v) => {
  try { if (v === 'system') localStorage.removeItem('lists.theme'); else localStorage.setItem('lists.theme', v); } catch {}
  if (v === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  const dark = v === 'graphite' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? '#1f2329' : '#f8fafd';
  ui.onTheme && ui.onTheme();
};
ui.cycleTheme = () => {
  const cur = localStorage.getItem('lists.theme') || 'system';
  const next = { system: 'paper', paper: 'graphite', graphite: 'system' }[cur];
  ui.setTheme(next);
  ui.toast('Theme: ' + { system: 'System', paper: 'Paper', graphite: 'Graphite' }[next]);
};

/* ---------------- phone accessory bar (above the keyboard) ---------------- */
let acc = null;
ui.accessory = (show) => {
  if (!st.touch) return;
  if (!acc) {
    // pointerdown keeps the keyboard open; the action itself runs on click (keyboard and switch access too).
    const b = (label, icon, fn) => h('button', { 'aria-label': label, onpointerdown: (e) => e.preventDefault(), onclick: fn, html: icon });
    const id = () => st.cursor;
    const keep = (fn) => structural.keepCaret(id(), fn);
    acc = h('div', { class: 'acc', role: 'toolbar', 'aria-label': 'Editing tools' },
      b('Outdent', '<svg viewBox="0 0 20 20"><path d="M3.5 5h13M9.5 10h7M3.5 15h13M6.5 7.6 4 10l2.5 2.4"/></svg>', () => keep(() => A.outdent([id()]))),
      b('Indent', '<svg viewBox="0 0 20 20"><path d="M3.5 5h13M9.5 10h7M3.5 15h13M4 7.6 6.5 10 4 12.4"/></svg>', () => keep(() => A.indent([id()]))),
      b('Move up', '<svg viewBox="0 0 20 20"><path d="M6 8l4-4 4 4M10 4v12"/></svg>', () => keep(() => A.moveBy(-1, [id()]))),
      b('Move down', '<svg viewBox="0 0 20 20"><path d="M6 12l4 4 4-4M10 16V4"/></svg>', () => keep(() => A.moveBy(1, [id()]))),
      h('span', { class: 'sp' }),
      b('When', '<svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="12" rx="2.5"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/></svg>', () => ui.datePicker([id()], 'when', rowEl(id())?.querySelector('.tl'))),
      b('Complete', ICON.check, () => { A.toggleDone([id()]); renderPage(); renderSide(); }),
      b('Done typing', '<svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg>', () => document.activeElement && document.activeElement.blur()));
    document.body.append(acc);
    const vv = window.visualViewport;
    const pos = () => { if (!vv) return; acc.style.transform = `translateY(${-(innerHeight - vv.height - vv.offsetTop)}px)`; };
    vv && vv.addEventListener('resize', pos); vv && vv.addEventListener('scroll', pos);
    pos();
  }
  acc.classList.toggle('in', !!show);
  acc.inert = !show;
  document.body.classList.toggle('typing', !!show);
};

/* ---------------- pairing confirmation ---------------- */
ui.confirmPair = (code) => new Promise((resolve) => {
  const groups = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase().match(/.{1,4}/g) || [];
  let done = false;
  const finish = (v) => { if (done) return; done = true; close(entry); resolve(v); };
  const panel = h('section', { class: 'pair' },
    h('h2', null, 'Pair this device?'),
    h('p', null, 'This link connects this device to an encrypted Lists account. Your lists here will be added to it and synced.'),
    h('p', { class: 'muted' }, 'Only continue if you made this link on your own device. Check that the code there starts and ends like this:'),
    h('code', { class: 'code' }, (groups[0] || '') + ' … ' + (groups[groups.length - 1] || '')),
    h('div', { class: 'acts' }, h('button', { class: 'btn primary', onclick: () => finish(true) }, 'Pair'), h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel')));
  const entry = open(panel, { label: 'Pair this device', onClose: () => finish(false) });
});

/* ---------------- misc ---------------- */
ui.escape = () => {
  if (closeTop()) return;
  if (st.sel.size > 1) { st.sel = new Set(st.cursor ? [st.cursor] : []); renderPage(); return; }
  if (ui.closeInsp()) return;
  if (document.body.classList.contains('drawer') && ui.closeDrawer) { ui.closeDrawer(); return; }
  // Release the selection entirely so Tab can leave the list (audit S2-3).
  if (st.sel.size || st.cursor) { st.sel.clear(); renderPage(); const a = document.activeElement; if (a && a.closest && a.closest('#outline')) a.blur(); }
};
ui.saveCollapsed = () => DB.setMeta('collapsed', [...st.collapsed]);
ui.editTitle = () => { const t = $('#ptitle'); if (t.isContentEditable) { t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } };
