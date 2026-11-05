// keys.js — one command registry drives the keyboard, the ⌘K palette and the ? sheet.
// Navigation mode uses single unmodified keys (no browser conflicts); typing uses outliner keys
// (docs/research/01-competitors.md §6).
import * as S from './store.js';
import * as O from './ops.js';
import * as A from './actions.js';
import { st, MOD, pageRoot } from './state.js';
import { renderPage, renderSide, rowEl } from './view.js';
import { focusRow, extendTo, neighbour, toggleCollapse, structural } from './input.js';
import { ui } from './ui.js';

const after = (fn) => (...a) => { const r = fn(...a); renderPage({ flip: true }); renderSide(); return r; };
const sel = () => A.targets();
const needSel = () => sel().length > 0;
const keepFocus = (fn) => () => {
  const id = st.cursor;
  const r = fn();
  if (r === false) return false; // nothing happened: let the key through (e.g. Tab)
  renderPage({ flip: true }); renderSide();
  if (id && rowEl(id)) focusRow(id, { keepSel: true, instant: true });
  return r;
};
/** Commands that make sense wherever focus is (sidebar buttons, body). */
const GLOBAL = new Set(['quick', 'palette', 'help', 'undo', 'redo', 'sync', 'settings', 'showdone', 'g-inbox', 'g-today', 'g-up', 'g-some', 'g-log', 'g-trash', 'esc']);

/** group: shown in the ? sheet. when: 'nav' (a row is focused, not typing) | 'any'. */
export const commands = [
  // Capture
  { id: 'quick', label: 'Quick add', keys: ['q'], group: 'Capture', run: () => ui.compose() },
  { id: 'below', label: 'New item below', keys: ['o'], group: 'Capture', run: () => newNear(1) },
  { id: 'above', label: 'New item above', keys: ['O'], group: 'Capture', run: () => newNear(0) },
  { id: 'edit', label: 'Edit title', keys: ['Enter', 'i'], group: 'Capture', when: 'nav', test: needSel, run: () => focusRow(st.cursor, { edit: true }) },
  { id: 'first-item', label: 'Start the first item', keys: ['Enter'], group: 'Capture', when: 'nav', hidden: true, test: () => !st.rows.length && !!pageRoot(), run: () => newNear(1) },
  { id: 'newlist', label: 'New list', keys: [], group: 'Capture', run: () => { const id = A.newList(); ui.go({ view: 'node', id }, 'key'); setTimeout(() => ui.editTitle(), 0); } },
  // Act
  { id: 'done', label: 'Complete', keys: ['x', 'Mod+Enter'], group: 'Act', test: needSel, run: () => { A.toggleDone(); renderPage(); renderSide(); } },
  { id: 'when', label: 'When…', keys: ['t'], group: 'Act', test: needSel, run: () => ui.datePicker(sel(), 'when') },
  { id: 'deadline', label: 'Deadline…', keys: ['d'], group: 'Act', test: needSel, run: () => ui.datePicker(sel(), 'deadline') },
  { id: 'today', label: 'Schedule for today', keys: ['y'], group: 'Act', test: needSel, run: keepFocus(() => A.setWhen(sel(), A.today())) },
  { id: 'evening', label: 'This evening', keys: ['e'], group: 'Act', test: needSel, run: keepFocus(() => A.setWhen(sel(), A.today(), { evening: true })) },
  { id: 'someday', label: 'Someday', keys: ['s'], group: 'Act', test: needSel, run: keepFocus(() => A.setWhen(sel(), null, { someday: true })) },
  { id: 'nudge+', label: 'One day later', keys: [']'], group: 'Act', test: needSel, run: keepFocus(() => A.nudge(1)) },
  { id: 'nudge-', label: 'One day earlier', keys: ['['], group: 'Act', test: needSel, run: keepFocus(() => A.nudge(-1)) },
  { id: 'week+', label: 'One week later', keys: ['}'], group: 'Act', test: needSel, run: keepFocus(() => A.nudge(7)) },
  { id: 'week-', label: 'One week earlier', keys: ['{'], group: 'Act', test: needSel, run: keepFocus(() => A.nudge(-7)) },
  { id: 'prio', label: 'Cycle priority', keys: ['!'], group: 'Act', test: needSel, run: keepFocus(() => A.cyclePriority()) },
  { id: 'move', label: 'Move to…', keys: ['m', 'v'], group: 'Act', test: needSel, run: () => ui.palette('move') },
  { id: 'details', label: 'Details', keys: ['Space'], group: 'Act', test: needSel, run: () => ui.openInsp(st.cursor) },
  { id: 'heading', label: 'Turn into heading', keys: ['Mod+Alt+h'], group: 'Act', test: needSel, run: keepFocus(() => A.toggleHeading()) },
  { id: 'del', label: 'Delete', keys: ['Backspace', 'Delete', 'Mod+Backspace'], group: 'Act', test: needSel, when: 'nav', run: () => del() },
  { id: 'rescue', label: 'Move overdue to Today', keys: [], group: 'Act', run: () => { const n = A.rescueOverdue(); renderPage(); renderSide(); ui.toast(n ? `Moved ${n} to Today` : 'Nothing overdue', { undo: !!n }); } },
  // Structure
  { id: 'indent', label: 'Indent', keys: ['Tab', 'Alt+Shift+ArrowRight'], group: 'Structure', when: 'nav', test: needSel, run: keepFocus(() => A.indent()) },
  { id: 'outdent', label: 'Outdent', keys: ['Shift+Tab', 'Alt+Shift+ArrowLeft'], group: 'Structure', when: 'nav', test: needSel, run: keepFocus(() => A.outdent()) },
  { id: 'up', label: 'Move up', keys: ['Alt+Shift+ArrowUp', 'Mod+Shift+ArrowUp'], group: 'Structure', test: needSel, run: keepFocus(() => A.moveBy(-1)) },
  { id: 'down', label: 'Move down', keys: ['Alt+Shift+ArrowDown', 'Mod+Shift+ArrowDown'], group: 'Structure', test: needSel, run: keepFocus(() => A.moveBy(1)) },
  { id: 'expand', label: 'Expand', keys: ['ArrowRight', 'l'], group: 'Structure', when: 'nav', run: () => horiz(1) },
  { id: 'collapse', label: 'Collapse', keys: ['ArrowLeft', 'h'], group: 'Structure', when: 'nav', run: () => horiz(-1) },
  { id: 'zoomin', label: 'Open as page', keys: ['Mod+.', 'z'], group: 'Structure', test: needSel, run: () => ui.go({ view: 'node', id: st.cursor }, 'key') },
  { id: 'zoomout', label: 'Up one level', keys: ['u', 'Mod+Shift+.'], group: 'Structure', run: () => zoomOut() },
  // Navigate
  { id: 'next', label: 'Next item', keys: ['ArrowDown', 'j'], group: 'Navigate', when: 'nav', run: () => step(1) },
  { id: 'prev', label: 'Previous item', keys: ['ArrowUp', 'k'], group: 'Navigate', when: 'nav', run: () => step(-1) },
  { id: 'xnext', label: 'Extend selection down', keys: ['Shift+ArrowDown', 'J'], group: 'Navigate', when: 'nav', run: () => ext(1) },
  { id: 'xprev', label: 'Extend selection up', keys: ['Shift+ArrowUp', 'K'], group: 'Navigate', when: 'nav', run: () => ext(-1) },
  { id: 'all', label: 'Select all', keys: ['Mod+a'], group: 'Navigate', when: 'nav', run: () => { st.sel = new Set(st.rows); renderPage(); } },
  { id: 'first', label: 'First item', keys: ['Home', 'g g'], group: 'Navigate', when: 'nav', run: () => st.rows[0] && focusRow(st.rows[0]) },
  { id: 'last', label: 'Last item', keys: ['End', 'G'], group: 'Navigate', when: 'nav', run: () => st.rows.length && focusRow(st.rows[st.rows.length - 1]) },
  { id: 'g-inbox', label: 'Go to Inbox', keys: ['g i'], group: 'Navigate', run: () => ui.go({ view: 'inbox' }, 'key') },
  { id: 'g-today', label: 'Go to Today', keys: ['g t'], group: 'Navigate', run: () => ui.go({ view: 'today' }, 'key') },
  { id: 'g-up', label: 'Go to Upcoming', keys: ['g u'], group: 'Navigate', run: () => ui.go({ view: 'upcoming' }, 'key') },
  { id: 'g-some', label: 'Go to Someday', keys: ['g s'], group: 'Navigate', run: () => ui.go({ view: 'someday' }, 'key') },
  { id: 'g-log', label: 'Go to Logbook', keys: ['g l'], group: 'Navigate', run: () => ui.go({ view: 'logbook' }, 'key') },
  { id: 'g-trash', label: 'Go to Trash', keys: ['g x'], group: 'Navigate', run: () => ui.go({ view: 'trash' }, 'key') },
  { id: 'palette', label: 'Command or search', keys: ['Mod+k', '/'], group: 'Navigate', run: () => ui.palette('all') },
  // App
  { id: 'undo', label: 'Undo', keys: ['Mod+z'], group: 'App', run: () => ui.undo() },
  { id: 'redo', label: 'Redo', keys: ['Mod+Shift+z', 'Mod+y'], group: 'App', run: () => ui.redo() },
  { id: 'showdone', label: 'Show or hide completed', keys: ['Mod+Shift+h'], group: 'App', run: () => { st.showDone = !st.showDone; renderPage({ flip: true }); ui.toast(st.showDone ? 'Showing all completed' : 'Hiding items completed before today'); } },
  { id: 'sync', label: 'Sync now', keys: ['Mod+s'], group: 'App', run: () => ui.syncNow() },
  { id: 'settings', label: 'Settings', keys: ['Mod+,'], group: 'App', run: () => ui.settings() },
  { id: 'theme', label: 'Switch theme', keys: [], group: 'App', run: () => ui.cycleTheme() },
  { id: 'export', label: 'Export as Markdown', keys: [], group: 'App', run: () => ui.exportMd() },
  { id: 'help', label: 'Keyboard shortcuts', keys: ['?'], group: 'App', run: () => ui.cheat() },
  { id: 'esc', label: 'Clear selection / close', keys: ['Escape'], group: 'App', hidden: true, run: () => ui.escape() },
];
const byId = new Map(commands.map((c) => [c.id, c]));
export const command = (id) => byId.get(id);

function newNear(offset) {
  const id = st.cursor && st.rows.includes(st.cursor) ? st.cursor : null;
  let nid;
  if (!id) {
    const t = A.defaultTarget();
    nid = A.createAt(t.parent, t.index, t.fields || {});
  } else {
    const p = S.parentOf(id), i = S.children(p).indexOf(id);
    const smart = !pageRoot() || !['node', 'inbox'].includes(st.route.view);
    nid = A.createAt(p, i + offset, smart ? A.defaultTarget().fields || {} : {});
  }
  st.fresh.add(nid);
  renderPage({ flip: true }); renderSide();
  focusRow(nid, { edit: true });
}
function step(d) {
  if (!st.rows.length) return;
  const i = st.rows.indexOf(st.cursor);
  const n = i < 0 ? (d > 0 ? 0 : st.rows.length - 1) : Math.max(0, Math.min(st.rows.length - 1, i + d));
  focusRow(st.rows[n], { instant: true });
}
function ext(d) { const n = neighbour(st.cursor, d); if (n) extendTo(n); }
function horiz(d) {
  const id = st.cursor;
  if (!id) return;
  const kids = S.hasChildren(id), open = kids && !st.collapsed.has(id);
  if (d > 0) { if (kids && !open) toggleCollapse(id, false); else if (open) step(1); }
  else if (open) toggleCollapse(id, true);
  else { const p = st.info.get(id)?.parent; if (p && st.rows.includes(p)) focusRow(p); }
}
function zoomOut() {
  if (st.route.view !== 'node') return;
  const p = S.parentOf(st.route.id), from = st.route.id;
  ui.go(p === S.ROOT ? { view: 'today' } : p === S.INBOX ? { view: 'inbox' } : { view: 'node', id: p }, 'key');
  if (rowEl(from)) focusRow(from);
}
function del() {
  const ids = sel();
  if (!ids.length) return;
  const next = neighbour(ids[ids.length - 1], 1) || neighbour(ids[0], -1);
  A.trash(ids);
  renderPage({ flip: true }); renderSide();
  if (next && rowEl(next)) focusRow(next);
}

/* ---------------- dispatcher ---------------- */
const isMacLike = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export function combo(e) {
  const mod = isMacLike ? e.metaKey : e.ctrlKey;
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  if (e.code === 'Period' && (mod || e.altKey)) k = '.';
  if (e.code === 'Comma' && mod) k = ',';
  const printable = k.length === 1;
  const parts = [];
  if (mod) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (!printable || mod || e.altKey)) parts.push('Shift');
  if (printable && (mod || e.altKey)) k = k.toLowerCase();
  parts.push(k);
  return parts.join('+');
}
export function pretty(k) {
  return k.split(' ').map((chord) => chord.split('+').map((p) => ({
    Mod: MOD === '⌘' ? '⌘' : 'Ctrl', Alt: MOD === '⌘' ? '⌥' : 'Alt', Shift: '⇧', Enter: '↵', ArrowUp: '↑', ArrowDown: '↓',
    ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: 'Del', Escape: 'Esc', Space: 'Space', Tab: 'Tab',
  }[p] || (p.length === 1 ? p.toUpperCase() === p && /[a-z]/i.test(p) ? '⇧' + p : p.toUpperCase() : p))).join(MOD === '⌘' ? '' : '+')).join(' then ');
}
let prefix = null, prefixT = 0;
export function wireKeys() {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const inRow = typing && t.classList && t.classList.contains('tx');
    if (ui.modalOpen() && !['Mod+k', 'Escape'].includes(combo(e))) return;
    const c = combo(e);
    // Focus on a control outside the list (sidebar link, button): keep its native keys (audit S2-3).
    st.keyAt = performance.now();
    const outside = !typing && t && t !== document.body && !(t.closest && (t.closest('#outline') || t.id === 'main'));
    // A focused control keeps its keys, and single characters never fire from it (WCAG 2.1.4, a11y-16).
    if (outside && !/^(Mod|Alt)\+/.test(c) && c !== 'Escape') return;
    // While typing, only modified chords (and Escape) reach the registry.
    if (typing) {
      if (!(c.startsWith('Mod+') || c.startsWith('Alt+') || c === 'Escape')) return;
      if (!inRow && !['Mod+k', 'Mod+z', 'Mod+Shift+z', 'Mod+y', 'Mod+s', 'Escape'].includes(c)) return;
      if (inRow && ['Mod+a', 'Mod+Backspace'].includes(c)) return;
      if (!inRow && ['Mod+z', 'Mod+Shift+z', 'Mod+y'].includes(c) && t.tagName !== 'DIV' && t.id !== 'ptitle' && t.id !== 'pnotes') return;
    }
    let key = c;
    const now = performance.now();
    if (prefix && now - prefixT < 1200 && !typing) { key = prefix + ' ' + c; prefix = null; }
    else if (!typing && (c === 'g') && !e.repeat) { prefix = 'g'; prefixT = now; e.preventDefault(); return; }
    for (const cmd of commands) {
      if (!cmd.keys.includes(key)) continue;
      if (cmd.when === 'nav' && typing) continue;
      if (outside && !GLOBAL.has(cmd.id)) continue;
      if (cmd.test && !cmd.test()) continue;
      if (inRow && cmd.id !== 'undo' && cmd.id !== 'redo' && cmd.id !== 'esc') { e.preventDefault(); const id = st.cursor; if (['up', 'down', 'heading', 'prio', 'today', 'evening', 'someday', 'nudge+', 'nudge-', 'week+', 'week-'].includes(cmd.id)) { structural.keepCaret(id, () => runRaw(cmd)); return; } }
      const r = cmd.run();
      if (r !== false) e.preventDefault();
      return;
    }
  });
}
function runRaw(cmd) {
  // Run without the post-render focus juggling (keepCaret handles it).
  const map = { up: () => A.moveBy(-1), down: () => A.moveBy(1), heading: () => A.toggleHeading(), prio: () => A.cyclePriority(),
    today: () => A.setWhen(A.targets(), A.today()), evening: () => A.setWhen(A.targets(), A.today(), { evening: true }), someday: () => A.setWhen(A.targets(), null, { someday: true }),
    'nudge+': () => A.nudge(1), 'nudge-': () => A.nudge(-1), 'week+': () => A.nudge(7), 'week-': () => A.nudge(-7) };
  (map[cmd.id] || cmd.run)();
}
export { O };
