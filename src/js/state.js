// state.js — UI state (device-local; never synced).
export const st = {
  route: { view: 'today' },   // {view:'inbox'|'today'|'upcoming'|'someday'|'logbook'|'trash'} | {view:'node', id}
  cursor: null,                // focused row id
  sel: new Set(),              // selected row ids (nav mode)
  anchor: null,                // shift-selection anchor
  mode: 'nav',                 // 'nav' | 'edit'
  insp: null,                  // id open in the inspector
  collapsed: new Set(),
  showDone: false,
  rows: [],                    // ids in render order
  info: new Map(),             // id → { depth, parent } for rendered rows
  fresh: new Set(),            // rows created this session and not yet committed (quick-add parsing)
  touch: matchMedia('(pointer: coarse)').matches,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  saveData: !!(navigator.connection && navigator.connection.saveData),
};
matchMedia('(pointer: coarse)').addEventListener?.('change', (e) => { st.touch = e.matches; });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => { st.reduced = e.matches; });

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
export const haptic = (ms = 8) => { try { if (st.touch && navigator.vibrate) navigator.vibrate(ms); } catch {} };
export const pageRoot = () => (st.route.view === 'node' ? st.route.id : st.route.view === 'inbox' ? 'inbox' : null);
