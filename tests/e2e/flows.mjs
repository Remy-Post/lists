// flows.mjs — scripted keyboard flows on the MacBook viewport and touch flows on the S25 viewport.
// Every step uses real input (keyboard / mouse / CDP touch); the store is only *read* to assert.
// Usage: node tests/e2e/flows.mjs      env: NO_BUILD=1, ONLY=desk|phone|tabs, SW=1 (allow the service worker)
// Output: console PASS/FAIL lines + tests/e2e/out/flows.json, screenshots in tests/e2e/out/flows-*.png
import { chromium } from 'playwright';
import { join } from 'node:path';
import { build, startStatic, ready, app, sleep, killAll, checker, CHROME_ARGS, OUT } from './lib.mjs';

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : ['desk', 'phone', 'tabs', 'sw'];
const MAC = { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2 };
const S25 = { viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' };
// The service worker's first-visit self-reload (a bug, see net3g) would race the scripted input, so flows block it.
const SWOPT = process.env.SW ? {} : { serviceWorkers: 'block' };
const C = checker('flows');
const MOD = 'Control'; // Linux Chromium: the app maps Mod to Ctrl

build();
const srv = await startStatic(8098);
const browser = await chromium.launch({ args: CHROME_ARGS });
const errors = [];
async function freshPage(dev, hash = '#/inbox', ctx) {
  ctx = ctx || await browser.newContext({ ...dev, ...SWOPT });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(srv.url + '/' + hash);
  await ready(page);
  return { ctx, page };
}
const q = (page, fn, arg) => app(page, fn, arg);
const titles = (page, parent) => q(page, (S, O, A, DB, st, ui, p) => S.children(p).map((id) => S.val(id, 'title')), parent);
const idOf = (page, title) => q(page, (S, O, A, DB, st, ui, t) => { for (const [id] of S.recs) if (S.isLive(id) && S.val(id, 'title') === t) return id; return null; }, title);
const route = (page) => q(page, (S, O, A, DB, st) => ({ ...st.route, cursor: st.cursor, mode: st.mode }));
const focusById = async (page, id) => { await page.keyboard.press('Escape'); await q(page, (S, O, A, DB, st, ui, x) => ui.focus(x), id); };
const press = async (page, ...keys) => { for (const k of keys) await page.keyboard.press(k); };
const type = (page, s) => page.keyboard.type(s, { delay: 8 });
// Overlays focus their input in a setTimeout(…, 20); wait for real focus before typing (see the race check below).
const focused = (page, sel) => page.waitForFunction((s) => document.activeElement && document.activeElement.matches(s), sel, { timeout: 5000 });

/* ====================================================================== desktop */
if (ONLY.includes('desk')) {
  console.log('\n== desktop 1728×1000 keyboard flows');
  const { ctx, page } = await freshPage(MAC);
  const step = (l, f) => C.step(l, f);

  await step('typing right after ⌘K / q is not dropped', async () => {
    await press(page, 'Escape', `${MOD}+k`); await page.keyboard.type('abc');
    const v1 = await page.evaluate(() => document.querySelector('.pal-in')?.value);
    await press(page, 'Escape'); await sleep(300);
    await press(page, 'q'); await page.keyboard.type('xyz');
    const v2 = await page.evaluate(() => document.querySelector('.qa-in')?.value);
    await press(page, 'Escape'); await sleep(300);
    await page.evaluate(() => window.__lists.DB.setMeta('draft', ''));
    C.ok(v1 === 'abc' && v2 === 'xyz', 'keys typed immediately after ⌘K and q reach the input (no 20 ms focus gap)', { palette: v1, quickAdd: v2 });
  });

  await step('palette → New list → title', async () => {
    await press(page, 'Escape', `${MOD}+k`);
    await focused(page, '.pal-in');
    await type(page, 'new list');
    await press(page, 'Enter');
    await sleep(80);
    await type(page, 'QA flows');
    const r = await route(page);
    const t = await page.textContent('#ptitle');
    C.ok(r.view === 'node' && t === 'QA flows', 'New list from ⌘K and its title typed in place', { view: r.view, title: t });
  });
  const LIST = await q(page, (S, O, A, DB, st) => st.route.id);

  await step('Enter chaining', async () => {
    await press(page, 'Enter'); // title → first item
    await type(page, 'one'); await press(page, 'Enter');
    await type(page, 'two'); await press(page, 'Enter');
    await type(page, 'three');
    C.ok(JSON.stringify(await titles(page, LIST)) === '["one","two","three"]', 'Enter chains new sibling items', await titles(page, LIST));
  });

  await step('Tab nesting ≥ 5 levels and Shift+Tab', async () => {
    await press(page, 'Enter'); await type(page, 'L1');
    for (let i = 2; i <= 6; i++) { await press(page, 'Enter', 'Tab'); await type(page, 'L' + i); }
    const info = await q(page, (S, O, A, DB, st) => { const id = st.cursor; return { depth: S.ancestors(id).length, chain: S.ancestors(id).map((a) => S.val(a, 'title')), level: document.querySelector(`.row[data-id="${id}"]`).getAttribute('aria-level') }; });
    C.ok(info.chain.slice(-5).join('>') === 'L1>L2>L3>L4>L5' && info.level === '6', 'Tab nests six levels (L6 under L5 under … L1), aria-level 6', info);
    await press(page, 'Shift+Tab');
    const after = await q(page, (S, O, A, DB, st) => ({ parent: S.val(S.parentOf(st.cursor), 'title'), level: document.querySelector(`.row[data-id="${st.cursor}"]`).getAttribute('aria-level'), title: S.val(st.cursor, 'title'), editing: document.activeElement.classList.contains('tx') }));
    C.ok(after.parent === 'L4' && after.level === '5' && after.editing, 'Shift+Tab outdents one level and keeps editing', after);
    await press(page, 'Tab');
  });

  await step('Backspace at start joins with the row above', async () => {
    // New top-level pair after "three": foo / bar  (i = edit the focused row, caret at end)
    await focusById(page, await idOf(page, 'three'));
    await press(page, 'i', 'Enter');
    await type(page, 'foo'); await press(page, 'Enter'); await type(page, 'bar');
    await press(page, 'Home', 'Backspace');
    const t = await titles(page, LIST);
    const cur = await q(page, (S, O, A, DB, st) => ({ title: S.val(st.cursor, 'title'), caret: getSelection().anchorOffset }));
    C.ok(t.includes('foobar') && !t.includes('bar') && cur.title === 'foobar' && cur.caret === 3, 'Backspace at start of "bar" joins into "foobar", caret at the seam', { top: t, cur });
  });

  await step('Escape to navigation mode', async () => {
    await press(page, 'Escape');
    const r = await route(page);
    const active = await page.evaluate(() => ({ row: document.activeElement.classList.contains('row'), tx: document.activeElement.classList.contains('tx') }));
    C.ok(r.mode === 'nav' && active.row && !active.tx, 'Escape leaves the text and focuses the row (nav mode)', { mode: r.mode, ...active });
  });

  await step('j/k and arrows', async () => {
    const rows = await q(page, (S, O, A, DB, st) => st.rows);
    const i0 = rows.indexOf((await route(page)).cursor);
    await press(page, 'k'); const a = rows.indexOf((await route(page)).cursor);
    await press(page, 'k'); const b = rows.indexOf((await route(page)).cursor);
    await press(page, 'j'); const c = rows.indexOf((await route(page)).cursor);
    await press(page, 'ArrowUp'); const d = rows.indexOf((await route(page)).cursor);
    await press(page, 'ArrowDown', 'ArrowDown'); const e = rows.indexOf((await route(page)).cursor);
    C.ok(a === i0 - 1 && b === i0 - 2 && c === i0 - 1 && d === i0 - 2 && e === i0, 'k/j and ↑/↓ move the cursor one row', [i0, a, b, c, d, e]);
    await press(page, 'g', 'g');
    C.ok((await route(page)).cursor === rows[0], 'g g jumps to the first row');
  });

  const ONE = await idOf(page, 'one');
  await step('x completes and draws the strike', async () => {
    await focusById(page, ONE);
    await press(page, 'x');
    await page.waitForSelector(`.row[data-id="${ONE}"] .tl svg.strike path`, { timeout: 2000 });
    const s = await q(page, (S, O, A, DB, st, ui, id) => ({ done: S.val(id, 'done'), cls: document.querySelector(`.row[data-id="${id}"]`).classList.contains('done'), paths: document.querySelectorAll(`.row[data-id="${id}"] .tl svg.strike path`).length }), ONE);
    C.ok(s.done && s.cls && s.paths >= 1, 'x marks done; .tl svg.strike path is drawn', s);
    await page.locator(`.row[data-id="${ONE}"]`).screenshot({ path: join(OUT, 'flows-strike.png') });
  });

  await step('undo / redo', async () => {
    const st = async () => q(page, (S, O, A, DB, st, ui, a) => ({ done: S.val(a.one, 'done'), strike: !!document.querySelector(`.row[data-id="${a.one}"] .tl svg.strike`), top: S.children(a.list).map((i) => S.val(i, 'title')) }), { one: ONE, list: LIST });
    await press(page, `${MOD}+z`); const u1 = await st();
    await press(page, `${MOD}+z`); const u2 = await st();
    await press(page, `${MOD}+Shift+z`); const r1 = await st();
    await press(page, `${MOD}+Shift+z`); await sleep(400); const r2 = await st();
    C.ok(!u1.done && !u1.strike, 'Ctrl+Z reopens the item and removes the strike', u1);
    C.ok(u2.top.includes('foo') && u2.top.includes('bar') && !u2.top.includes('foobar'), 'second Ctrl+Z undoes the join (foo, bar back)', u2.top);
    C.ok(r1.top.includes('foobar') && !r1.top.includes('bar'), 'Ctrl+Shift+Z redoes the join', r1.top);
    C.ok(r2.done && r2.strike, 'second Ctrl+Shift+Z redoes the completion (strike back)', r2);
  });

  await step('zoom in / breadcrumbs / Back', async () => {
    const L3 = await idOf(page, 'L3');
    await focusById(page, L3);
    await press(page, 'z');
    await sleep(100);
    const r = await route(page);
    const head = await page.evaluate(() => ({ title: document.querySelector('#ptitle').textContent, crumbs: [...document.querySelectorAll('#crumbs a')].map((a) => a.textContent), hash: location.hash, stack: document.querySelectorAll('#stack i').length }));
    C.ok(r.view === 'node' && r.id === L3 && head.title === 'L3' && head.crumbs.join('>') === 'QA flows>L1>L2', 'z zooms into L3: page title and breadcrumbs QA flows › L1 › L2', head);
    const rowsIn = await q(page, (S, O, A, DB, st) => st.rows.map((id) => S.val(id, 'title')));
    C.ok(rowsIn[0] === 'L4', 'zoomed page lists the children', rowsIn);
    await page.goBack();
    await sleep(150);
    const back = await route(page);
    C.ok(back.view === 'node' && back.id === LIST, 'history.back zooms out to the list', back);
    await focusById(page, L3);
    await press(page, `${MOD}+.`);
    await sleep(100);
    C.ok((await route(page)).id === L3, 'Ctrl+. also zooms in');
    await press(page, 'u');
    await sleep(100);
    const up = await route(page);
    C.ok(up.id === await idOf(page, 'L2'), 'u goes up one level (to L2)', up);
    await page.goto(srv.url + '/#/n/' + LIST); await ready(page);
  });

  await step('quick add grammar', async () => {
    await press(page, 'Escape', 'q');
    await focused(page, '.qa-in');
    await type(page, 'Pay rent every 1st !!');
    const prev = await page.textContent('.qa-prev');
    await press(page, 'Enter', 'Escape');
    const id = await idOf(page, 'Pay rent');
    const f = id && await q(page, (S, O, A, DB, st, ui, x) => ({ rrule: S.val(x, 'rrule'), priority: S.val(x, 'priority'), when: S.val(x, 'when'), parent: S.parentOf(x) }), id);
    C.ok(f && f.rrule === 'FREQ=MONTHLY;BYMONTHDAY=1' && f.priority === 2 && f.parent === LIST, 'q "Pay rent every 1st !!" → title "Pay rent", monthly rrule, priority 2, in this list', { f, preview: prev });
    const chip = await page.locator(`.row[data-id="${id}"] .chip.rep`).count();
    C.ok(chip === 1, 'the row shows the repeat chip');
  });

  const TWO = await idOf(page, 'two');
  const tomorrow = await q(page, (S, O, A) => A.addDays(A.today(), 1));
  await step('t date picker → Upcoming', async () => {
    await focusById(page, TWO);
    await press(page, 't');
    await focused(page, '.dp-in');
    await type(page, 'tomorrow');
    await press(page, 'Enter');
    const w = await q(page, (S, O, A, DB, st, ui, x) => S.val(x, 'when'), TWO);
    C.ok(w === tomorrow, 't + "tomorrow" + Enter sets when = tomorrow', w);
    await press(page, 'Escape', 'g', 'u');
    await sleep(100);
    const inUp = await q(page, (S, O, A, DB, st, ui, x) => ({ view: st.route.view, has: st.rows.includes(x) }), TWO);
    C.ok(inUp.view === 'upcoming' && inUp.has, 'the item shows in Upcoming (g u)', inUp);
    await page.screenshot({ path: join(OUT, 'flows-upcoming.png') });
  });

  await step('] [ } nudges', async () => {
    await page.goto(srv.url + '/#/n/' + LIST); await ready(page);
    await focusById(page, TWO);
    const w = async () => q(page, (S, O, A, DB, st, ui, x) => S.val(x, 'when'), TWO);
    await press(page, ']'); const a = await w();
    await press(page, '['); const b = await w();
    await press(page, '}'); const c = await w();
    const exp = await q(page, (S, O, A, DB, st, ui, t) => [A.addDays(t, 1), t, A.addDays(t, 7)], tomorrow);
    C.ok(a === exp[0] && b === exp[1] && c === exp[2], '] +1 day, [ −1 day, } +1 week', { got: [a, b, c], exp });
    const cursorKept = (await route(page)).cursor === TWO;
    C.ok(cursorKept, 'cursor stays on the nudged row');
  });

  await step('⌘K search jumps to an item', async () => {
    await page.goto(srv.url + '/#/today'); await ready(page);
    const L4 = await idOf(page, 'L4');
    await press(page, 'Escape', `${MOD}+k`);
    await focused(page, '.pal-in');
    await type(page, 'L4');
    const first = await page.textContent('.pal-list .opt.on .ol');
    await press(page, 'Enter');
    await sleep(150);
    const r = await route(page);
    C.ok(first === 'L4' && r.view === 'node' && r.id === LIST && r.cursor === L4, '⌘K "L4" → Enter opens QA flows with L4 focused', { first, r });
  });

  await step('m moves to another list', async () => {
    const THREE = await idOf(page, 'three');
    await focusById(page, THREE);
    await press(page, 'm');
    await focused(page, '.pal-in');
    await type(page, 'Inbox');
    await press(page, 'Enter');
    const p = await q(page, (S, O, A, DB, st, ui, x) => S.parentOf(x), THREE);
    C.ok(p === 'inbox', 'm → "Inbox" moves the item to the Inbox', p);
  });

  await step('delete → Trash → restore', async () => {
    await focusById(page, TWO);
    await press(page, 'Backspace');
    const del = await q(page, (S, O, A, DB, st, ui, x) => ({ deleted: S.val(x, 'deleted'), inList: st.rows.includes(x), next: st.cursor }), TWO);
    C.ok(del.deleted === 'trash' && !del.inList, 'Backspace in nav mode moves the item to Trash', del);
    await press(page, 'g', 'x');
    await sleep(100);
    const inTrash = await q(page, (S, O, A, DB, st, ui, x) => st.rows.includes(x), TWO);
    C.ok(inTrash, 'the item is listed in Trash (g x)');
    await page.locator(`.row[data-id="${TWO}"] .ck`).click();
    const r = await q(page, (S, O, A, DB, st, ui, x) => ({ deleted: S.val(x, 'deleted'), parent: S.parentOf(x) }), TWO);
    C.ok(r.deleted === false && r.parent === LIST, 'clicking its box in Trash restores it to its list', r);
  });

  await step('paste an indented outline', async () => {
    await page.goto(srv.url + '/#/n/' + LIST); await ready(page);
    await focusById(page, await idOf(page, 'foobar'));
    await press(page, 'o');
    const text = 'Groceries\n  Milk\n  Eggs\n    Free range\nChores\n\t- [x] Laundry\n';
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
    let viaClipboard = true;
    try { await page.evaluate((t) => navigator.clipboard.writeText(t), text); await press(page, `${MOD}+v`); }
    catch { viaClipboard = false; }
    await sleep(100);
    let g = await idOf(page, 'Groceries');
    if (!g) { // fallback: synthetic paste event with a DataTransfer
      viaClipboard = false;
      await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
      await sleep(100); g = await idOf(page, 'Groceries');
    }
    const tree = g && await q(page, (S, O, A, DB, st, ui, a) => {
      const walk = (p) => S.children(p).map((c) => ({ t: S.val(c, 'title'), done: S.val(c, 'done'), k: walk(c) }));
      const ch = S.children(a.list).map((c) => S.val(c, 'title'));
      return { groceries: walk(a.g), chores: walk(S.children(a.list).find((c) => S.val(c, 'title') === 'Chores')), top: ch };
    }, { g, list: LIST });
    const ok = tree && JSON.stringify(tree.groceries.map((x) => x.t)) === '["Milk","Eggs"]' && tree.groceries[1].k[0]?.t === 'Free range' && tree.chores?.[0]?.t === 'Laundry' && tree.chores[0].done === true && !tree.top.includes('');
    C.ok(ok, `paste of a 6-line indented outline nests it (${viaClipboard ? 'real clipboard' : 'synthetic paste event'}); the empty row it replaced is gone`, tree);
  });

  await step('Today is clear', async () => {
    await page.goto(srv.url + '/#/today'); await ready(page);
    await press(page, 'Escape', 'j', `${MOD}+a`, 'x');
    await sleep(1200);
    const s = await page.evaluate(() => ({ cleared: document.body.classList.contains('cleared'), text: document.querySelector('#empty')?.textContent, open: window.__lists.S.qToday(window.__lists.A.today()).day.length }));
    C.ok(s.cleared && /Today is clear\./.test(s.text), 'completing every Today item (Ctrl+A, x) shows "Today is clear." (body.cleared)', s);
    await page.screenshot({ path: join(OUT, 'flows-cleared-desk.png') });
  });
  await ctx.close();
}

/* ====================================================================== multi-tab */
if (ONLY.includes('tabs')) {
  console.log('\n== two tabs, same profile (BroadcastChannel)');
  const { ctx, page: A } = await freshPage(MAC, '#/inbox');
  const B = await ctx.newPage();
  await B.goto(srv.url + '/#/inbox'); await ready(B);
  const [x, y] = await q(A, (S) => S.children('inbox').slice(0, 2));
  await C.step('two tabs edit different items', async () => {
    await A.locator(`.row[data-id="${x}"] .tx`).click(); await A.keyboard.press('End'); await type(A, ' [A]');
    await B.locator(`.row[data-id="${y}"] .tx`).click(); await B.keyboard.press('End'); await type(B, ' [B]');
    await sleep(600);
    const seen = async (p) => q(p, (S, O, A, DB, st, ui, a) => [S.val(a[0], 'title').endsWith(' [A]'), S.val(a[1], 'title').endsWith(' [B]')], [x, y]);
    C.ok((await seen(A)).every(Boolean) && (await seen(B)).every(Boolean), 'each tab sees the other tab’s edit live', { A: await seen(A), B: await seen(B) });
    await A.close(); await B.close();
    const P = await ctx.newPage(); await P.goto(srv.url + '/#/inbox'); await ready(P);
    C.ok((await seen(P)).every(Boolean), 'both edits are in IndexedDB after both tabs close', await seen(P));
    await P.close();
  });
  await C.step('two tabs edit the same item (title vs when)', async () => {
    const P = await ctx.newPage(); await P.goto(srv.url + '/#/inbox'); await ready(P);
    const Q = await ctx.newPage(); await Q.goto(srv.url + '/#/inbox'); await ready(Q);
    const z = await q(P, (S) => S.children('inbox')[2]);
    await P.locator(`.row[data-id="${z}"] .tx`).click(); await P.keyboard.press('End'); await type(P, ' [P]');
    await Q.bringToFront();
    await focusById(Q, z); await Q.keyboard.press('t'); await focused(Q, '.dp-in'); await type(Q, 'tomorrow'); await Q.keyboard.press('Enter');
    await sleep(600);
    await P.close(); await Q.close();
    const R = await ctx.newPage(); await R.goto(srv.url + '/#/inbox'); await ready(R);
    const r = await q(R, (S, O, A, DB, st, ui, id) => ({ title: S.val(id, 'title'), when: S.val(id, 'when') }), z);
    C.ok(r.title.endsWith(' [P]') && !!r.when, 'same item: title from tab P and date from tab Q both persist', r);
  });
  await ctx.close();
}

/* ====================================================================== phone */
async function touch(page, cdp, pts, { holdMs = 0, stepMs = 16 } = {}) {
  const [x0, y0] = pts[0];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  if (holdMs) await sleep(holdMs);
  for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); await sleep(stepMs); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const line = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
if (ONLY.includes('phone')) {
  console.log('\n== phone 412×891 touch flows');
  const { ctx, page } = await freshPage(S25, '#/today');
  const cdp = await ctx.newCDPSession(page);
  const pointerTypes = [];
  await page.exposeFunction('__pt', (t) => pointerTypes.push(t));
  await page.evaluate(() => addEventListener('pointerdown', (e) => window.__pt(e.pointerType), true));

  await C.step('＋ composer adds an item', async () => {
    const n0 = await q(page, (S, O, A) => S.qToday(A.today()).day.length);
    await page.tap('#addBtn');
    await focused(page, '.qa-in');
    await type(page, 'Phone item tomorrow');
    await press(page, 'Enter');
    await sleep(100);
    const id = await idOf(page, 'Phone item');
    const w = id && await q(page, (S, O, A, DB, st, ui, x) => S.val(x, 'when'), id);
    await page.screenshot({ path: join(OUT, 'flows-phone-composer.png') });
    await page.tap('.lyr .scrim', { position: { x: 200, y: 40 } }).catch(() => page.keyboard.press('Escape'));
    await sleep(300);
    C.ok(!!id && !!w, 'tap ＋, type "Phone item tomorrow", Enter → item with a date', { id, w, n0 });
  });

  await C.step('swipe right completes', async () => {
    const id = await q(page, (S, O, A, DB, st) => st.rows.find((r) => !S.val(r, 'done')));
    const box = await page.locator(`.row[data-id="${id}"]`).boundingBox();
    const y = box.y + box.height / 2;
    await touch(page, cdp, line([80, y], [330, y], 14));
    await sleep(500);
    const done = await q(page, (S, O, A, DB, st, ui, x) => S.val(x, 'done'), id);
    C.ok(done, 'swipe right (CDP touch, 250 px) completes the row', { id, pointerTypes: [...new Set(pointerTypes)] });
    const strike = await page.locator(`.row[data-id="${id}"] .tl svg.strike path`).count();
    C.ok(strike > 0, 'the strike is drawn after a swipe');
  });

  await C.step('swipe from the screen edge is ignored', async () => {
    const id = await q(page, (S, O, A, DB, st) => st.rows.find((r) => !S.val(r, 'done')));
    const box = await page.locator(`.row[data-id="${id}"]`).boundingBox();
    const y = box.y + box.height / 2;
    await touch(page, cdp, line([10, y], [300, y], 14));
    await sleep(400);
    C.ok(!(await q(page, (S, O, A, DB, st, ui, x) => S.val(x, 'done'), id)), 'a swipe starting within 24 px of the edge does not complete (Android back gesture)');
    await page.keyboard.press('Escape');
  });

  await C.step('editing shows the accessory bar', async () => {
    const id = await q(page, (S, O, A, DB, st) => st.rows.find((r) => !S.val(r, 'done')));
    await page.locator(`.row[data-id="${id}"] .tx`).tap();
    await sleep(200);
    const s = await page.evaluate(() => ({ acc: !!document.querySelector('.acc.in'), typing: document.body.classList.contains('typing'), active: document.activeElement.className }));
    C.ok(s.acc && s.typing, 'tapping a title opens the editing accessory bar (indent/outdent on phone)', s);
    await page.evaluate(() => document.activeElement.blur());
    await sleep(150);
  });

  await C.step('long-press drag reorders', async () => {
    await page.goto(srv.url + '/#/inbox'); await ready(page);
    // A hash navigation runs a View Transition; while it runs, hit-testing goes to <html>. Let it finish.
    await page.waitForFunction(() => !document.documentElement.dataset.vt, null, { timeout: 3000 }).catch(() => {});
    await sleep(200);
    const before = await q(page, (S) => S.children('inbox'));
    const r0 = await page.locator(`.row[data-id="${before[0]}"]`).boundingBox();
    const r2 = await page.locator(`.row[data-id="${before[2]}"]`).boundingBox();
    const x = Math.min(250, r0.x + r0.width * 0.6);
    // Hold 650 ms (long-press is 420 ms), then drag straight down into the gap between rows 2 and 3.
    await touch(page, cdp, line([x, r0.y + r0.height / 2], [x, r2.y + 8], 16), { holdMs: 650, stepMs: 30 });
    await sleep(400);
    const after = await q(page, (S) => S.children('inbox'));
    C.ok(after[1] === before[0] && after[0] === before[1] && after[2] === before[2], 'long-press (650 ms) then drag moves row 1 between rows 2 and 3', { before: before.slice(0, 3), after: after.slice(0, 3) });
  });

  await C.step('Today is clear (phone, tapping boxes)', async () => {
    await page.goto(srv.url + '/#/today'); await ready(page);
    await page.waitForFunction(() => !document.documentElement.dataset.vt, null, { timeout: 3000 }).catch(() => {});
    for (let i = 0; i < 20; i++) {
      const id = await q(page, (S, O, A, DB, st) => st.rows.find((r) => !S.val(r, 'done')));
      if (!id) break;
      await page.locator(`.row[data-id="${id}"] .ck`).tap();
      await sleep(120);
    }
    await sleep(1200);
    const s = await page.evaluate(() => ({ cleared: document.body.classList.contains('cleared'), text: document.querySelector('#empty')?.textContent }));
    await page.screenshot({ path: join(OUT, 'flows-cleared-phone.png') });
    C.ok(s.cleared && /Today is clear\./.test(s.text), 'tapping every box in Today shows "Today is clear."', s);
  });
  await ctx.close();
}

/* ====================================================================== first visit with the service worker */
if (ONLY.includes('sw')) {
  console.log('\n== first visit with the service worker allowed');
  const ctx = await browser.newContext({ ...MAC });
  const page = await ctx.newPage();
  let navs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
  await page.goto(srv.url + '/#/today'); await ready(page);
  const text = 'typed during the first visit';
  await press(page, 'j', 'o');
  await page.keyboard.type(text, { delay: 40 });
  await sleep(2500);
  const got = await page.evaluate((t) => { const { S } = window.__lists; for (const [id] of S.recs) { const v = S.val(id, 'title'); if (v && t.startsWith(v.slice(0, 5)) && v.length < 60) return v; } return null; }, text);
  C.ok(navs === 1 && got === text, 'typing right after the first load is not cut off by the service worker taking control (no self-reload)', { navigations: navs, persistedTitle: got });
  await ctx.close();
}

C.ok(errors.length === 0, 'no page errors or console errors during the flows', errors.slice(0, 5));
await browser.close();
C.save('flows.json');
const fails = C.summary();
killAll();
process.exit(fails ? 1 : 0);
