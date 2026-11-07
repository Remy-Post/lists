// main.js — boot, routing, lifecycle, persistence and sync wiring.
import * as S from './store.js';
import * as O from './ops.js';
import * as A from './actions.js';
import * as DB from './db.js';
import { st, $, MOD } from './state.js';
import { renderPage, renderSide, rowEl, peekRow, transition, dayChanged, refillRow } from './view.js';
import { wire, focusRow } from './input.js';
import { wireKeys } from './keys.js';
import { wireGestures } from './gesture.js';
import { ui } from './ui.js';

const VERSION = typeof LISTS_BUILD === 'string' ? LISTS_BUILD : 'dev';
window.LISTS_VERSION = VERSION;

/* ---------------- persistence ---------------- */
// Every write (local edit or merged remote change) is mirrored to other open tabs, which merge it
// per field without re-broadcasting. The disk write itself also merges (db.js), so a stale tab
// can never clobber newer fields (docs/audits/02-code-audit.md S1-3).
const bc = 'BroadcastChannel' in self ? new BroadcastChannel('lists') : null;
let quiet = false, inbox = [];
S.onPersist((rec, local) => {
  DB.put(rec, local);
  if (bc && !quiet) bc.postMessage({ t: 'rec', r: rec });
  if (local) maybeSync('edit');
});
const mergeQuiet = (list) => { quiet = true; try { S.mergeRemote(list); } finally { quiet = false; } };
if (bc) bc.onmessage = (e) => {
  const d = e.data;
  if (!d) return;
  if (d.t === 'rec') { if (!inbox.length) queueMicrotask(() => mergeQuiet(inbox.splice(0))); inbox.push(d.r); }
  else if (d.t === 'meta') { DB.mirrorMeta(d.k, d.v); if (d.k === 'sync.sync' && d.v && d.v.key) loadSync().then(() => maybeSync('paired')).catch(() => {}); }
};
const SHARED_META = new Set(['syncEvery', 'backupDays']);
DB.onMeta((k, v) => { if (bc && (k.startsWith('sync.') || SHARED_META.has(k))) bc.postMessage({ t: 'meta', k, v }); });
DB.onDiskNewer((list) => mergeQuiet(list));

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
// Typing in a row changes only that row's title: refill it alone instead of re-rendering the page.
S.subscribe((ids, structural, fields) => {
  if (!structural && fields && ids.size === 1 && [...fields].every((f) => f === 'title' || f === 'notes')) {
    const id = [...ids][0];
    if (peekRow(id) && peekRow(id).isConnected) { refillRow(id); if (S.parentOf(id) === S.ROOT) renderSide(); return; }
  }
  schedule(structural);
});

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
function announce(r) {
  const live = $('#live');
  if (!live) return;
  const name = r.view === 'node' ? S.val(r.id, 'title') || 'Untitled' : { inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', someday: 'Someday', logbook: 'Logbook', trash: 'Trash' }[r.view];
  live.textContent = `${name}, ${st.rows.length} ${st.rows.length === 1 ? 'item' : 'items'}`;
}
const hashOf = (r) => '#/' + (r.view === 'node' ? 'n/' + r.id : r.view);
function show(r, kind, fromRow) {
  const prev = st.route;
  const same = prev.view === r.view && prev.id === r.id;
  st.route = { view: r.view, id: r.id };
  if (!same) { st.sel.clear(); st.cursor = null; st.mode = 'nav'; if (!matchMedia('(min-width: 1440px)').matches) ui.closeInsp(); }
  DB.setMeta('lastView', r.view === 'node' ? 'today' : r.view);
  // Only a real zoom (into a row, or along one branch of the tree) animates; switching views or lists
  // from the sidebar renders at once, so no tap is ever swallowed by a transition (review platform-5).
  const deeper = r.view === 'node' && (!!fromRow || (prev.view === 'node' && S.ancestors(r.id).includes(prev.id)));
  const shallower = !deeper && prev.view === 'node' && r.view === 'node' && S.ancestors(prev.id).includes(r.id);
  const doRender = () => {
    renderPage(); renderSide();
    // Land keyboard focus in the new page, including after a mouse click in the sidebar or a palette jump,
    // so single-key shortcuts keep working (a11y-09, review interaction-2). Then announce what rendered.
    const a = document.activeElement, m = $('#main');
    if (!st.touch && m && (!a || a === document.body || !a.isConnected || a.closest('#side, .topbar, #searchBtn, #moreBtn'))) m.focus({ preventScroll: true });
    announce(r);
  };
  if (same) { doRender(); return; }
  // Measure the clicked row before scrolling, so the zoom opens from where the row was (review platform-3).
  const root = document.documentElement;
  if (fromRow) { const b = fromRow.getBoundingClientRect(); root.style.setProperty('--vt-y', Math.min(innerHeight - 40, Math.max(0, b.top)) + 'px'); root.style.setProperty('--vt-h', b.height + 'px'); }
  else { root.style.removeProperty('--vt-y'); root.style.removeProperty('--vt-h'); }
  scrollTo({ top: 0 }); // before rendering: scrolling after forced a full layout of the new page (QA B2)
  if (r.view !== 'today' && light) { light.destroy(); light = null; }
  // Zoom: the new sheet opens out of the clicked row, and that row's title becomes the page title.
  // Exactly one element carries 'ztitle' in each state (visual audit S2-1).
  const t = fromRow && kind === 'pointer' ? fromRow.querySelector('.tx') : null;
  const pt = $('#ptitle');
  pt.style.viewTransitionName = '';
  if (t) t.style.viewTransitionName = 'ztitle';
  root.dataset.dir = deeper ? 'in' : shallower ? 'out' : 'x';
  transition(() => {
    if (t) t.style.viewTransitionName = '';
    if (t) pt.style.viewTransitionName = 'ztitle';
    doRender();
  }, kind === 'key' || !(deeper || shallower) ? 'key' : 'nav'); // list switches render instantly (QA B7)
  setTimeout(() => { pt.style.viewTransitionName = ''; }, 700);
  closeDrawer(); // no-op when closed; also covers a narrow window driven by a mouse (review platform-6)
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
// The sync module loads only on devices that use backup (it isn't on the critical path).
let sync = null, syncStatus = { state: 'unpaired' }, syncLoading = null;
const syncMeta = () => DB.getMeta('sync.sync') || {};
const isPaired = () => !!syncMeta().key;
// A failed chunk load is forgotten, so the next attempt fetches again (review platform-2).
const loadSync = () => (syncLoading ||= import('./sync.js').then((m) => { if (!sync) setupSync(m.createSync); paintSync(); return sync; }, (e) => { syncLoading = null; throw e; }));
function setupSync(createSync) {
  sync = createSync({
    db: {
      getOutbox: () => DB.getOutbox((id) => S.recs.get(id)),
      ackOutbox: (recs) => DB.ackOutbox(recs, (id) => S.recs.get(id)),
      applyRemote: async (recs) => { S.mergeRemote(recs); await DB.flush(); },
      getMeta: async (k) => DB.getMeta('sync.' + k),
      setMeta: async (k, v) => { DB.setMeta('sync.' + k, v); },
      requeueAll: () => requeueAll(),
    },
    onStatus: (s) => { syncStatus = s; paintSync(); },
    backupAgeMs: () => (DB.getMeta('backupDays') ?? 3) * 864e5,
    staleMs: () => { const d = DB.getMeta('syncEvery'); return d ? d * 864e5 : null; },
  });
  // Paired devices must not read "On this device" until the first sync runs (req-trust-touch-02).
  sync.pairingCode().then((c) => {
    if (c && syncStatus.state === 'unpaired') { const m = syncMeta(); syncStatus = { state: 'idle', lastPush: m.lastPush, lastPull: m.lastPull }; paintSync(); }
  }).catch(() => {});
}
function paintSync() {
  const el = $('#sync');
  if (!el) return;
  const s = syncStatus;
  el.dataset.state = s.state;
  let label = { idle: 'Backed up', syncing: 'Syncing', offline: 'Offline', error: 'Backup paused', unpaired: 'On this device' }[s.state] || '';
  if (s.state === 'idle' && s.message) label = /good connection/.test(s.message) ? 'Waiting for Wi-Fi' : 'Backed up*';
  if (s.state === 'idle' && !s.lastPush) label = 'Not backed up yet';
  el.querySelector('.sl').textContent = label;
  el.title = s.lastPush ? 'Last backup ' + new Date(s.lastPush).toLocaleString() : s.message || label;
}
ui.syncState = () => syncStatus;
ui.syncNow = async () => {
  if (!isPaired()) { ui.settings(); return; }
  try { await loadSync(); } catch { ui.toast('Couldn’t load sync. Check your connection.'); return; }
  ui.toast('Syncing…', { ms: 1200 });
  const ok = await sync.syncNow().catch(() => false);
  ui.toast(ok ? 'Synced' : navigator.onLine ? 'Sync failed. It will retry on a good connection.' : 'You’re offline. Changes are saved here and will sync later.');
};
const requeueAll = () => DB.requeueAll([...S.recs.keys()].filter((id) => id !== S.ROOT));
ui.createVault = async () => { await loadSync(); await requeueAll(); const c = await sync.createVault(); await sync.syncNow().catch(() => {}); return c; };
ui.join = async (code) => {
  await loadSync();
  dropUntouchedTour();
  await requeueAll();
  await sync.join(code.trim());
  await sync.syncNow();
};
ui.unpair = async () => { await loadSync(); await sync.unpair(); await requeueAll(); };
/** A device being paired shouldn't push its untouched tour into the account (audit S2-9). */
function dropUntouchedTour() {
  const tour = new Set(DB.getMeta('tourIds') || []);
  if (!tour.size) return;
  const others = [...S.recs.keys()].filter((id) => id !== S.ROOT && id !== S.INBOX && !tour.has(id) && S.isLive(id));
  if (others.length) return;
  for (const id of tour) if (S.recs.has(id)) S.patch(id, { deleted: 'void' });
}
ui.pairingCode = async () => (isPaired() ? (await loadSync()).pairingCode() : null);
async function pairFromLink(code) {
  history.replaceState(null, '', '#/today'); // the key must not linger in history
  try { sessionStorage.setItem('lists.pair', code); } catch {} // survives a reload until join resolves
  show({ view: 'today' }, 'key');
  if (await ui.pairingCode()) { ui.toast('This device is already paired'); clearPending(); return; }
  // Never auto-join: a link could come from someone else, and joining uploads this device's lists (security-1).
  const ok = await ui.confirmPair(code);
  if (!ok) { clearPending(); return; }
  try { await ui.join(code); ui.toast('Paired. Your lists are syncing.'); } catch { ui.toast('That pairing link didn’t work'); }
  clearPending();
}
const clearPending = () => { try { sessionStorage.removeItem('lists.pair'); } catch {} };
const pendingPair = () => { try { return sessionStorage.getItem('lists.pair'); } catch { return null; } };
const maybeSync = (why) => {
  try {
    if (sync) sync.maybeSync(why);
    else if (isPaired()) loadSync().then((s) => s.maybeSync(why)).catch(() => {}); // paired in another tab (review platform-1)
  } catch {}
};

/* ---------------- the moment: Today, struck through ---------------- */
let wasOpen = null, forcedClear = false;
function todayOpen() { const t = S.qToday(A.today()); return t.day.length + t.eve.length; }
function checkCleared(force) {
  if (st.route.view !== 'today') { wasOpen = null; forcedClear = false; document.body.classList.remove('cleared'); return; }
  if (force) forcedClear = true; // #/debug/clear stays cleared until you navigate away
  const open = todayOpen();
  const doneN = st.rows.filter((id) => S.val(id, 'done')).length; // model, not DOM: long pages are virtualized
  const cleared = (open === 0 && doneN > 0) || forcedClear;
  document.body.classList.toggle('cleared', !!cleared);
  if (cleared) { const c = $('#empty .cnt'); if (c) c.textContent = `${doneN} done`; }
  if (cleared && st.touch) $('#empty').scrollIntoView({ block: 'nearest' });
  if (cleared && (wasOpen > 0 || force)) celebrate(force);
  wasOpen = open;
}
ui.afterDone = () => {};
let light = null;
async function celebrate() {
  const today = A.today();
  if (DB.getMeta('clearedOn') === today && !location.hash.includes('debug')) return;
  DB.setMeta('clearedOn', today);
  if (st.reduced || st.saveData) return;
  try {
    const gl = await import('./gl.js');
    if (!(await gl.supportedAsync())) return;
    const host = $('#main');
    if (light) light.destroy();
    const fx = light = gl.strikeLight(host, { theme: document.documentElement.dataset.theme === 'graphite' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light' });
    await fx.sweep();
    if (st.route.view !== 'today' && light === fx) { fx.destroy(); light = null; }
  } catch {}
}

/* ---------------- first run ---------------- */
function tutorial() {
  const t = A.today();
  const touch = st.touch;
  const lines = touch ? [
    ['Swipe this row right to complete it', []],
    ['Tap + to add an item. Type “tomorrow” or “every monday” and it becomes a date', []],
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
  const ids = [];
  O.tx('Tour', () => {
    lines.forEach(([title, kids]) => {
      const id = O.create({ title, when: t, pos: S.posAt(S.INBOX, S.children(S.INBOX).length) });
      ids.push(id);
      let p = id;
      const add = (arr) => {
        for (const k of arr) {
          if (Array.isArray(k)) { add(k); continue; }
          p = O.create({ title: k, pos: S.posAt(p, S.children(p).length) });
          ids.push(p);
        }
      };
      add(kids);
    });
  });
  DB.setMeta('tourIds', ids);
  ui.go({ view: 'today' }, 'key');
}
ui.tutorial = tutorial;

/* ---------------- drawer (phone) ---------------- */
// The off-canvas drawer must leave the tab order and accessibility tree when closed (a11y-05).
const phoneMQ = matchMedia('(max-width: 599.98px)');
function syncDrawer() { const open = document.body.classList.contains('drawer'); $('#side').inert = phoneMQ.matches && !open; $('#menuBtn').setAttribute('aria-expanded', String(open)); }
function openDrawer() { document.body.classList.add('drawer'); syncDrawer(); const f = $('#side .nv'); f && f.focus({ preventScroll: true }); }
function closeDrawer() { const was = document.body.classList.contains('drawer'); document.body.classList.remove('drawer'); syncDrawer(); if (was && phoneMQ.matches && $('#side').contains(document.activeElement)) $('#menuBtn').focus({ preventScroll: true }); }
phoneMQ.addEventListener?.('change', syncDrawer);
ui.closeDrawer = () => closeDrawer();

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
  title.addEventListener('input', () => { if (st.route.view !== 'node') return; O.tx('Rename', () => O.set(st.route.id, { title: title.textContent.replace(/\n/g, ' ') }), { merge: 'pt:' + st.route.id, ctx: { route: { ...st.route }, sel: null } }); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = S.children(st.route.id)[0];
      if (first && rowEl(first)) focusRow(first, { edit: true, caret: 0 });
      else { const id = A.createAt(st.route.id, 0); st.fresh.add(id); renderPage(); focusRow(id, { edit: true }); }
    }
  });
  notes.addEventListener('input', () => { if (st.route.view !== 'node') return; O.tx('Notes', () => O.set(st.route.id, { notes: notes.innerText }), { merge: 'pn:' + st.route.id, ctx: { route: { ...st.route }, sel: null } }); });
  // Paste an outline anywhere that isn't a text field: after the selected row, or at the page's default spot (req-outline-04).
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (ui.modalOpen() || (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName)))) return;
    if (st.route.view === 'trash' || st.route.view === 'logbook') return;
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text || !text.trim()) return;
    e.preventDefault();
    let parent, index;
    const smart = st.route.view !== 'node' && st.route.view !== 'inbox';
    const top = smart ? { ...(A.defaultTarget().fields || {}) } : {};
    if (st.cursor && S.recs.has(st.cursor)) { parent = S.parentOf(st.cursor); index = S.children(parent).indexOf(st.cursor) + 1; }
    else { const d = A.defaultTarget(); parent = d.parent; index = d.index; }
    const ids = A.pasteOutline(text, parent, index, top);
    renderPage({ flip: true }); renderSide();
    if (ids.length) { focusRow(ids[ids.length - 1]); ui.toast(ids.length === 1 ? 'Pasted 1 item' : `Pasted ${ids.length} items`, { undo: true }); }
  });
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
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.install = () => { e.prompt(); ui.install = null; }; });
  addEventListener('appinstalled', () => { ui.install = null; DB.askPersist(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!localStorage.getItem('lists.theme')) ui.setTheme('system'); });
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
let asked = false, storageBroken = false;
/** Never let the user work on unaware that nothing is being saved (audit S1-5). */
function watchStorage() {
  let since = 0, shown = false;
  const warn = () => {
    if (shown) return;
    shown = true;
    const b = document.createElement('div');
    b.className = 'banner';
    b.setAttribute('role', 'alert');
    b.textContent = 'This browser isn’t letting Lists save. Changes will be lost when you close the tab. ';
    const x = document.createElement('button');
    x.textContent = 'Export a copy';
    x.addEventListener('click', () => ui.exportJson());
    b.append(x);
    document.body.prepend(b);
  };
  if (storageBroken) return warn();
  setInterval(() => {
    if (DB.lastError && DB.pendingCount() > 0) { since ||= Date.now(); if (Date.now() - since > 5000) warn(); }
    else since = 0;
  }, 1000);
}

/* ---------------- service worker ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || VERSION === 'dev') return;
  // Register once the page has loaded and gone quiet, so the precache never competes with the app on 3G (QA B5).
  const go = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(() => doRegister(), { timeout: 4000 }), 1500);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}
function doRegister() {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const onReady = (w) => w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) ui.toast('An update is ready', { action: { label: 'Reload', run: () => { w.postMessage('skip'); } }, ms: 10000 });
    });
    if (reg.waiting && navigator.serviceWorker.controller) ui.toast('An update is ready', { action: { label: 'Reload', run: () => reg.waiting.postMessage('skip') }, ms: 10000 });
    reg.addEventListener('updatefound', () => reg.installing && onReady(reg.installing));
  }).catch(() => {});
  // Reload only when an existing worker was replaced (an update), never on the first install's claim.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; DB.flush().then(() => location.reload()); } });
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
    storageBroken = true;
    console.error('Storage unavailable', e);
  }
  st.collapsed = new Set(DB.getMeta('collapsed') || []);
  const first = !S.recs.has(S.INBOX);
  if (first) S.patch(S.INBOX, { kind: 'inbox', title: 'Inbox', pos: { parent: S.ROOT, key: 'a0', prev: null } });
  if (isPaired()) { syncStatus = { state: 'idle', lastPush: syncMeta().lastPush, lastPull: syncMeta().lastPull }; loadSync(); }
  wire(); wireKeys(); wireGestures(); wireChrome(); wireLifecycle();
  A.onCollapsedChange(() => ui.saveCollapsed());
  const r = parseHash();
  const pair = r.pair || pendingPair();
  if (pair) { show({ view: 'today' }, 'key'); pairFromLink(pair); }
  else show(r.view ? r : { view: 'today' }, 'key');
  if (r.debug === 'clear') setTimeout(() => checkCleared(true), 300);
  if (first && !pair && !storageBroken && !DB.getMeta('toured')) { DB.setMeta('toured', 1); tutorial(); }
  watchStorage();
  syncDrawer();
  const theme = (() => { try { return localStorage.getItem('lists.theme'); } catch { return null; } })();
  ui.setTheme(theme || 'system');
  document.body.classList.add('ready');
  paintSync();
  registerSW();
  setTimeout(() => maybeSync('boot'), 1500);
  window.__lists = { S, O, A, DB, st, ui, bootMs: performance.now() - t0 };
}
boot();
