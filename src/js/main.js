// main.js — boot, routing, lifecycle, persistence and sync wiring.
import * as S from './store.js';
import * as O from './ops.js';
import * as A from './actions.js';
import * as DB from './db.js';
import { st, $, MOD } from './state.js';
import { renderPage, renderSide, rowEl, transition, dayChanged } from './view.js';
import { wire, focusRow } from './input.js';
import { wireKeys } from './keys.js';
import { wireGestures } from './gesture.js';
import { ui } from './ui.js';
import { createSync } from './sync.js';

const VERSION = typeof LISTS_BUILD === 'string' ? LISTS_BUILD : 'dev';
window.LISTS_VERSION = VERSION;

/* ---------------- persistence ---------------- */
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('lists') : null;
let quiet = false;
S.onPersist((rec, local) => {
  DB.put(rec, local);
  if (local && bc && !quiet) bc.postMessage({ t: 'rec', r: rec });
});
if (bc) bc.onmessage = (e) => {
  if (e.data && e.data.t === 'rec') { quiet = true; S.mergeRemote([e.data.r]); quiet = false; }
};

/* ---------------- render scheduling ---------------- */
let raf = 0, flipNext = false;
function schedule(flip) {
  flipNext ||= flip;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const f = flipNext; flipNext = false;
    renderPage({ flip: f }); renderSide(); ui.refreshInsp();
    checkCleared();
  });
}
S.subscribe((ids, structural) => schedule(structural));

/* ---------------- routing ---------------- */
const VIEWS = ['inbox', 'today', 'upcoming', 'someday', 'logbook', 'trash'];
function parseHash() {
  const hsh = location.hash.replace(/^#\/?/, '');
  if (hsh.startsWith('pair=')) return { pair: hsh.slice(5) };
  if (hsh === 'debug/clear') return { view: 'today', debug: 'clear' };
  const [a, b] = hsh.split('/');
  if (a === 'n' && b && S.recs.has(b) && S.isLive(b)) return b === S.INBOX ? { view: 'inbox' } : { view: 'node', id: b };
  if (VIEWS.includes(a)) return { view: a };
  return { view: DB.getMeta('lastView') || 'today' };
}
const hashOf = (r) => '#/' + (r.view === 'node' ? 'n/' + r.id : r.view);
function show(r, kind, fromRow) {
  const prev = st.route;
  const same = prev.view === r.view && prev.id === r.id;
  st.route = { view: r.view, id: r.id };
  if (!same) { st.sel.clear(); st.cursor = null; st.mode = 'nav'; if (!matchMedia('(min-width: 1440px)').matches) ui.closeInsp(); }
  DB.setMeta('lastView', r.view === 'node' ? 'today' : r.view);
  const deeper = r.view === 'node' && (prev.view !== 'node' || S.ancestors(r.id).includes(prev.id));
  const shallower = prev.view === 'node' && (r.view !== 'node' || S.ancestors(prev.id).includes(r.id));
  const doRender = () => { renderPage(); renderSide(); };
  if (same) { doRender(); return; }
  // Zoom: the row's title becomes the page title (a shared-element View Transition).
  const t = fromRow && fromRow.querySelector('.tx');
  if (t && kind === 'pointer') t.style.viewTransitionName = 'ztitle';
  document.documentElement.dataset.dir = deeper ? 'in' : shallower ? 'out' : 'x';
  transition(() => {
    if (t) t.style.viewTransitionName = '';
    if (t || deeper) $('#ptitle').style.viewTransitionName = 'ztitle';
    doRender();
  }, kind === 'key' ? 'key' : 'nav');
  setTimeout(() => { $('#ptitle').style.viewTransitionName = ''; }, 600);
  scrollTo({ top: 0 });
  if (st.touch) closeDrawer();
}
ui.go = (r, kind = 'pointer', fromRow) => {
  const target = hashOf(r);
  if (location.hash !== target) history.pushState(null, '', target);
  show(r, kind, fromRow);
};
ui.focus = (id) => focusRow(id);
addEventListener('popstate', () => { const r = parseHash(); if (r.view) show(r, 'pointer'); });
addEventListener('hashchange', () => { const r = parseHash(); if (r.pair) return pairFromLink(r.pair); if (r.view) show(r, 'pointer'); });

/* ---------------- sync ---------------- */
let sync = null, syncStatus = { state: 'unpaired' };
function setupSync() {
  sync = createSync({
    db: {
      getOutbox: () => DB.getOutbox((id) => S.recs.get(id)),
      ackOutbox: (recs) => DB.ackOutbox(recs, (id) => S.recs.get(id)),
      applyRemote: async (recs) => { S.mergeRemote(recs); await DB.flush(); },
      getMeta: async (k) => DB.getMeta('sync.' + k),
      setMeta: async (k, v) => { DB.setMeta('sync.' + k, v); },
    },
    onStatus: (s) => { syncStatus = s; paintSync(); },
  });
}
function paintSync() {
  const el = $('#sync');
  if (!el) return;
  const s = syncStatus;
  el.dataset.state = s.state;
  const label = { idle: 'Backed up', syncing: 'Syncing', offline: 'Offline', error: 'Backup paused', unpaired: 'On this device' }[s.state] || '';
  el.querySelector('.sl').textContent = label;
  el.title = s.lastPush ? 'Last backup ' + new Date(s.lastPush).toLocaleString() : s.message || label;
}
ui.syncState = () => syncStatus;
ui.syncNow = async () => {
  if (!sync || syncStatus.state === 'unpaired') { ui.settings(); return; }
  ui.toast('Syncing…', { ms: 1200 });
  try { await sync.syncNow(); ui.toast('Synced'); } catch { ui.toast('Sync failed. It will retry on a good connection.'); }
};
ui.createVault = async () => { const c = await sync.createVault(); await sync.syncNow().catch(() => {}); return c; };
ui.join = async (code) => { await sync.join(code.trim()); await sync.syncNow(); };
ui.unpair = () => sync.unpair();
ui.pairingCode = () => (sync ? sync.pairingCode() : null);
async function pairFromLink(code) {
  history.replaceState(null, '', '#/today'); // the key must not linger in history
  show({ view: 'today' }, 'key');
  if (await ui.pairingCode()) { ui.toast('This device is already paired'); return; }
  try { await ui.join(code); ui.toast('Paired. Your lists are syncing.'); } catch { ui.toast('That pairing link didn’t work'); }
}
const maybeSync = (why) => { try { sync && sync.maybeSync(why); } catch {} };

/* ---------------- the moment: Today, struck through ---------------- */
let wasOpen = null;
function todayOpen() { const t = S.qToday(A.today()); return t.day.length + t.eve.length; }
function checkCleared(force) {
  if (st.route.view !== 'today') { wasOpen = null; document.body.classList.remove('cleared'); return; }
  const open = todayOpen();
  const doneN = $('#outline').querySelectorAll('.row.done').length;
  const cleared = (open === 0 && doneN > 0) || force;
  document.body.classList.toggle('cleared', !!cleared);
  if (cleared && (wasOpen > 0 || force)) celebrate(force);
  wasOpen = open;
}
ui.afterDone = () => {};
async function celebrate() {
  const today = A.today();
  if (DB.getMeta('clearedOn') === today && !location.hash.includes('debug')) return;
  DB.setMeta('clearedOn', today);
  if (st.reduced || st.saveData) return;
  try {
    const gl = await import('./gl.js');
    if (!(await gl.supportedAsync())) return;
    const host = $('#main');
    const fx = gl.strikeLight(host, { theme: document.documentElement.dataset.theme === 'graphite' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light' });
    await fx.sweep();
    const stop = () => { fx.destroy(); removeEventListener('hashchange', stop); };
    addEventListener('hashchange', stop);
  } catch {}
}

/* ---------------- first run ---------------- */
function tutorial() {
  const t = A.today();
  const touch = st.touch;
  const lines = touch ? [
    ['Swipe this row right to complete it', []],
    ['Tap ＋ to add an item. Type “tomorrow” or “every monday” and it becomes a date', []],
    ['Lists nest as deep as you like', ['Long-press and drag a row sideways to nest it', ['Like this']]],
    ['Swipe left to schedule. Tap a row for its details', []],
    ['Complete them all and see what Today looks like when it’s clear', []],
  ] : [
    ['Click the box to complete this, or select it and press X', []],
    ['Press Enter at the end of a line to start the next one', []],
    ['Tab nests a line under the one above. Lists go as deep as you like', ['Like this', ['And this']]],
    [`Type “tomorrow” or “every monday” in a new item and it becomes a date. Press ${MOD === '⌘' ? '⌘K' : 'Ctrl+K'} for every command`, []],
    ['Complete them all and see what Today looks like when it’s clear', []],
  ];
  O.tx('Tour', () => {
    lines.forEach(([title, kids]) => {
      const id = O.create({ title, when: t, pos: S.posAt(S.INBOX, S.children(S.INBOX).length) });
      let p = id;
      const add = (arr) => {
        for (const k of arr) {
          if (Array.isArray(k)) { add(k); continue; }
          p = O.create({ title: k, pos: S.posAt(p, S.children(p).length) });
        }
      };
      add(kids);
    });
  });
  ui.go({ view: 'today' }, 'key');
}
ui.tutorial = tutorial;

/* ---------------- drawer (phone) ---------------- */
function openDrawer() { document.body.classList.add('drawer'); $('#side').setAttribute('aria-hidden', 'false'); }
function closeDrawer() { document.body.classList.remove('drawer'); }

/* ---------------- chrome wiring ---------------- */
function wireChrome() {
  for (const b of document.querySelectorAll('[data-nav]')) b.addEventListener('click', (e) => { e.preventDefault(); ui.go({ view: b.dataset.nav }, 'pointer'); });
  $('#sideLists').addEventListener('click', (e) => { const a = e.target.closest('[data-list]'); if (!a) return; e.preventDefault(); ui.go({ view: 'node', id: a.dataset.list }, 'pointer'); });
  $('#crumbs').addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); const r = a.getAttribute('href').replace('#/', ''); ui.go(r === 'inbox' ? { view: 'inbox' } : { view: 'node', id: r.slice(2) }, 'pointer'); });
  $('#newList').addEventListener('click', () => { const id = A.newList(); ui.go({ view: 'node', id }, 'key'); setTimeout(ui.editTitle, 30); });
  $('#settingsBtn').addEventListener('click', () => ui.settings());
  $('#sync').addEventListener('click', () => ui.syncNow());
  $('#addBtn').addEventListener('click', () => ui.compose());
  $('#menuBtn').addEventListener('click', () => (document.body.classList.contains('drawer') ? closeDrawer() : openDrawer()));
  $('#scrimSide').addEventListener('click', closeDrawer);
  $('#searchBtn').addEventListener('click', () => ui.palette('all'));
  $('#moreBtn').addEventListener('click', () => ui.palette('all'));
  // Page title & notes editing (node pages).
  const title = $('#ptitle'), notes = $('#pnotes');
  title.addEventListener('input', () => { if (st.route.view !== 'node') return; O.tx('Rename', () => O.set(st.route.id, { title: title.textContent.replace(/\n/g, ' ') }), { merge: 'pt:' + st.route.id }); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = S.children(st.route.id)[0];
      if (first && rowEl(first)) focusRow(first, { edit: true, caret: 0 });
      else { const id = A.createAt(st.route.id, 0); st.fresh.add(id); renderPage(); focusRow(id, { edit: true }); }
    }
  });
  notes.addEventListener('input', () => { if (st.route.view !== 'node') return; O.tx('Notes', () => O.set(st.route.id, { notes: notes.innerText }), { merge: 'pn:' + st.route.id }); });
  // Click on the empty area below the list starts a new item at the end (Workflowy-like).
  $('#tail').addEventListener('click', () => {
    if (st.route.view === 'trash' || st.route.view === 'logbook' || st.route.view === 'upcoming') return;
    const t = A.defaultTarget();
    const id = A.createAt(t.parent, t.index, t.fields || {});
    st.fresh.add(id); renderPage(); renderSide(); focusRow(id, { edit: true });
  });
  // Trash: restore / delete forever via the row's checkbox position is disabled; offer actions.
  $('#outline').addEventListener('click', (e) => {
    if (st.route.view !== 'trash') return;
    const row = e.target.closest('.row');
    if (!row || !e.target.closest('.ck')) return;
    A.restore([row.dataset.id]); renderPage({ flip: true }); renderSide(); ui.toast('Restored', { undo: true });
  });
  // Install prompt (Android Chrome)
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.install = () => e.prompt(); });
}

/* ---------------- lifecycle ---------------- */
function wireLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { DB.flush(); try { sync && sync.flushOnHide && sync.flushOnHide(); } catch {} }
    else { if (dayChanged()) schedule(false); maybeSync('visible'); }
  });
  addEventListener('pagehide', () => { DB.flush(); });
  addEventListener('freeze', () => { DB.flush(); });
  addEventListener('online', () => maybeSync('online'));
  navigator.connection && navigator.connection.addEventListener && navigator.connection.addEventListener('change', () => maybeSync('connection'));
  setInterval(() => { if (document.visibilityState === 'visible') maybeSync('timer'); }, 60e3);
  const atMidnight = () => { const n = new Date(); const m = new Date(n); m.setHours(24, 0, 5, 0); setTimeout(() => { schedule(false); atMidnight(); }, m - n); };
  atMidnight();
  // Ask for persistent storage after the first meaningful edit.
  O.setOnChange(() => { if (!asked) { asked = true; DB.askPersist(); } });
}
let asked = false;

/* ---------------- service worker ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || VERSION === 'dev') return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const onReady = (w) => w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) ui.toast('An update is ready', { action: { label: 'Reload', run: () => { w.postMessage('skip'); } }, ms: 10000 });
    });
    if (reg.waiting && navigator.serviceWorker.controller) ui.toast('An update is ready', { action: { label: 'Reload', run: () => reg.waiting.postMessage('skip') }, ms: 10000 });
    reg.addEventListener('updatefound', () => reg.installing && onReady(reg.installing));
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; DB.flush().then(() => location.reload()); } });
}

/* ---------------- boot ---------------- */
async function boot() {
  const t0 = performance.now();
  try {
    const { nodes } = await DB.loadAll();
    let dev = DB.getMeta('device');
    if (!dev) { dev = Math.random().toString(36).slice(2, 8); DB.setMeta('device', dev); }
    S.setDevice(dev);
    S.hydrate(nodes);
  } catch (e) {
    document.body.classList.add('nodb');
    console.error('Storage unavailable', e);
  }
  st.collapsed = new Set(DB.getMeta('collapsed') || []);
  const first = !S.recs.has(S.INBOX);
  if (first) S.patch(S.INBOX, { kind: 'inbox', title: 'Inbox', pos: { parent: S.ROOT, key: 'a0', prev: null } });
  setupSync();
  wire(); wireKeys(); wireGestures(); wireChrome(); wireLifecycle();
  const r = parseHash();
  if (r.pair) { show({ view: 'today' }, 'key'); pairFromLink(r.pair); }
  else show(r.view ? r : { view: 'today' }, 'key');
  if (r.debug === 'clear') setTimeout(() => checkCleared(true), 300);
  if (first && !DB.getMeta('toured')) { DB.setMeta('toured', 1); tutorial(); }
  const theme = (() => { try { return localStorage.getItem('lists.theme'); } catch { return null; } })();
  ui.setTheme(theme || 'system');
  document.body.classList.add('ready');
  paintSync();
  registerSW();
  setTimeout(() => maybeSync('boot'), 1500);
  window.__lists = { S, O, A, DB, st, ui, bootMs: performance.now() - t0 };
}
boot();
