// review-fixes.mjs — regression checks for the final fresh-eyes review (docs/DECISIONS.md, round 5).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8085';
const b = await chromium.launch();
const results = [];
const check = (name, ok, info = '') => { results.push([ok, name, info]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
async function page(vp = { width: 1500, height: 900 }, extra = {}) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block', ...extra });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/#/inbox'); await p.waitForFunction(() => window.__lists && document.body.classList.contains('ready'));
  return { ctx, p, errs };
}
{ // render-1: an older remote stamp still repaints
  const { ctx, p } = await page();
  const r = await p.evaluate(async () => {
    const { A, O, S, ui } = window.__lists; ui.go({ view: 'inbox' }, 'key');
    const id = A.createAt(S.INBOX, 0, { title: 'X' }); await new Promise((r) => setTimeout(r, 50));
    O.tx('t', () => O.set(id, { title: 'X renamed' })); await new Promise((r) => setTimeout(r, 80));
    const h = S.recs.get(id).f.title[1]; const ms = parseInt(h.split('.')[0], 36) - 50;
    const st = ms.toString(36).padStart(9, '0') + '.0000.dOTHER';
    S.mergeRemote([{ id, f: { done: [true, st], doneAt: [Date.now(), st] } }]); await new Promise((r) => setTimeout(r, 120));
    return document.querySelector(`.row[data-id="${id}"]`).classList.contains('done');
  });
  check('render-1: remote change with an older stamp repaints the row', r); await ctx.close();
}
{ // render-2: reveal a row beyond the first chunk
  const { ctx, p } = await page();
  const r = await p.evaluate(async () => {
    const { A, O, S, ui } = window.__lists; let big, target;
    O.tx('fx', () => { big = A.newList('Big'); for (let i = 0; i < 200; i++) { const id = O.create({ title: 'Row number ' + i, pos: S.posAt(big, i) }); if (i === 150) target = id; } });
    O.tx('c', () => O.create({ title: 'kid', pos: S.posAt(target, 0) }));
    ui.go({ view: 'node', id: target }, 'key'); await new Promise((r) => setTimeout(r, 100));
    document.querySelector('#main').focus();
    return target;
  });
  await p.keyboard.press('u'); await p.waitForTimeout(250);
  const r2 = await p.evaluate((target) => { const el = document.querySelector(`.row[data-id="${target}"]`); return { cursor: window.__lists.st.cursor === target, inView: !!el && el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0 }; }, r);
  const rr = r2;
  check('render-2: zoom-out focuses a row past the first chunk', rr.cursor && rr.inView, JSON.stringify(rr)); await ctx.close();
}
{ // render-4: exactly one Tab stop
  const { ctx, p } = await page();
  await p.evaluate(() => { const { A, S, O } = window.__lists; O.tx('fx', () => { for (let i = 0; i < 5; i++) A.createAt(S.INBOX, S.children(S.INBOX).length, { title: 'Item ' + i }); }); window.__lists.ui.go({ view: 'inbox' }, 'key'); });
  await p.waitForTimeout(150);
  await p.click('.row:nth-child(4)', { position: { x: 600, y: 10 } });
  await p.keyboard.press('Escape'); await p.evaluate(() => { const { S, A } = window.__lists; A.setWhen([S.children(S.INBOX)[1]], A.today()); });
  await p.waitForTimeout(150);
  const n = await p.evaluate(() => document.querySelectorAll('.row[tabindex="0"]').length);
  check('render-4: one Tab stop in the list', n === 1, 'stops=' + n); await ctx.close();
}
{ // interaction-1: clicking at the end of the text keeps the date
  const { ctx, p } = await page();
  await p.keyboard.press('q'); await p.keyboard.type('Call mom tomorrow');
  const box = await p.locator('.qa-in').boundingBox(); await p.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
  await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  const r = await p.evaluate(() => { const { S } = window.__lists; const id = [...S.recs.keys()].find((k) => S.val(k, 'title') === 'Call mom'); return id ? S.val(id, 'when') : 'not found'; });
  check('interaction-1: click at the end of quick add keeps the date', r && r !== 'not found', String(r)); await ctx.close();
}
{ // interaction-2: single keys work after clicking the sidebar
  const { ctx, p } = await page();
  await p.click('.side [data-nav="today"]'); await p.waitForTimeout(150); await p.keyboard.press('q'); await p.waitForTimeout(100);
  const r = await p.evaluate(() => !!document.querySelector('.qa-in'));
  check('interaction-2: q opens quick add after a sidebar click', r); await ctx.close();
}
{ // interaction-6: repeated adds keep their order
  const { ctx, p } = await page();
  await p.evaluate(() => { const { A } = window.__lists; const l = A.newList('Order'); A.createAt(l, 0, { title: 'existing' }); window.__lists.ui.go({ view: 'node', id: l }, 'key'); });
  await p.waitForTimeout(100); await p.keyboard.press('q');
  for (const w of ['one', 'two', 'three']) { await p.keyboard.type(w); await p.keyboard.press('Enter'); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  const r = await p.evaluate(() => [...document.querySelectorAll('.row .tx')].map((x) => x.textContent).join(','));
  check('interaction-6: quick adds land in typing order', r === 'existing,one,two,three', r); await ctx.close();
}
{ // render-6: Upcoming shows the when date when grouped under an earlier deadline
  const { ctx, p } = await page();
  const r = await p.evaluate(async () => { const { A, S, ui } = window.__lists; const id = A.createAt(S.INBOX, 0, { title: 'Dual', when: A.addDays(A.today(), 5), deadline: A.addDays(A.today(), 2) }); ui.go({ view: 'upcoming' }, 'key'); await new Promise((r) => setTimeout(r, 100)); return document.querySelector(`.row[data-id="${id}"] .chip.when`) !== null; });
  check('render-6: when chip visible under an earlier deadline group', r); await ctx.close();
}
{ // platform-6: narrow window with a mouse closes the drawer after picking a view
  const { ctx, p } = await page({ width: 500, height: 800 });
  await p.click('#menuBtn'); await p.waitForTimeout(350); await p.click('#side [data-nav="upcoming"]'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => document.body.classList.contains('drawer'));
  check('platform-6: drawer closes after a pick (narrow, mouse)', !r); await ctx.close();
}
{ // platform-1 + 7: a tab already open picks up pairing and shared settings from another tab
  const ctx = await b.newContext({ serviceWorkers: 'block' });
  const a = await ctx.newPage(), c = await ctx.newPage();
  for (const p of [a, c]) { await p.goto(BASE + '/#/inbox'); await p.waitForFunction(() => window.__lists && document.body.classList.contains('ready')); }
  await a.evaluate(() => { window.__lists.DB.setMeta('syncEvery', 7); window.__lists.DB.setMeta('sync.sync', { key: new Uint8Array(32), dev: 'd_x', cursor: 0 }); });
  await c.waitForTimeout(600);
  const r = await c.evaluate(() => ({ every: window.__lists.DB.getMeta('syncEvery'), label: document.querySelector('#sync .sl').textContent }));
  check('platform-1/7: other tab loads sync and mirrors settings', r.every === 7 && r.label !== 'On this device', JSON.stringify(r)); await ctx.close();
}
{ // real-device finding (Mac, 2026-11-07): completing an item in Today must not move it
  const { ctx, p } = await page();
  await p.evaluate(() => window.__lists.ui.go({ view: 'today' }, 'key')); await p.waitForTimeout(150);
  const first = await p.evaluate(() => window.__lists.st.rows[0]);
  await p.click('.row:nth-child(1) .ck'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__lists.st.rows[0]);
  check('Mac: a completed item keeps its place in Today', first === after);
  await ctx.close();
}
{ // Markdown export → import round-trip (code now lives in the lazy panels chunk)
  const { ctx, p } = await page();
  await p.evaluate(() => { const { A, O, S } = window.__lists; O.tx('fx', () => {
    const l = A.newList('Trip'); const a = O.create({ title: 'Pack', pos: S.posAt(l, 0), notes: 'passport\nadapter' });
    O.create({ title: 'Socks', pos: S.posAt(a, 0), when: '2026-12-01' }); O.create({ title: 'Section', pos: S.posAt(l, 1), heading: true });
    A.newList('Empty list'); }); });
  const dl = p.waitForEvent('download'); await p.evaluate(() => window.__lists.ui.exportMd()); const file = await (await dl).path();
  const md = (await import('node:fs')).readFileSync(file, 'utf8');
  await p.evaluate(() => { const { O, S } = window.__lists; O.tx('wipe', () => { for (const id of S.children(S.ROOT)) if (id !== S.INBOX) O.set(id, { deleted: 'void' }); }); });
  const fc = p.waitForEvent('filechooser'); await p.evaluate(() => window.__lists.ui.importFile()); await (await fc).setFiles({ name: 'lists.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const { S } = window.__lists; const lists = S.children(S.ROOT).filter((x) => x !== S.INBOX).map((x) => S.val(x, 'title'));
    const trip = S.children(S.ROOT).find((x) => S.val(x, 'title') === 'Trip'); const pack = trip && S.children(trip)[0]; const socks = pack && S.children(pack)[0]; const sec = trip && S.children(trip)[1];
    return { lists, notes: pack && S.val(pack, 'notes'), socksWhen: socks && S.val(socks, 'when'), heading: sec && S.val(sec, 'heading') }; });
  const ok = !r.lists.includes('Inbox') && r.lists.includes('Trip') && r.lists.includes('Empty list') && r.notes === 'passport\nadapter' && r.socksWhen === '2026-12-01' && r.heading === true;
  check('Markdown export → import round-trips lists, nesting, notes, dates, headings, empty lists', ok, JSON.stringify(r));
  await ctx.close();
}
{ // real-device finding (Mac): Today already clear on load shows the cleared page, not struck rows + headline
  const { ctx, p } = await page();
  await p.evaluate(() => { const { S, A } = window.__lists; const t = S.qToday(A.today()); A.toggleDone([...t.day, ...t.eve]); });
  await p.waitForTimeout(300); await p.evaluate(() => window.__lists.DB.flush()); await p.reload();
  await p.waitForFunction(() => window.__lists && document.body.classList.contains('ready')); await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ cleared: document.body.classList.contains('cleared'), ckVisible: getComputedStyle(document.querySelector('.row .ck')).opacity }));
  check('Mac: opening an already-clear Today shows the cleared page', r.cleared && r.ckVisible === '0', JSON.stringify(r));
  await ctx.close();
}
{ // no surface ever renders a stray "null"/"undefined" (seen in the inspector, then Settings)
  const { ctx, p } = await page();
  const bad = [];
  const scan = async (name) => { await p.waitForTimeout(350); const t = await p.evaluate(() => (document.querySelector('.lyr .panel, #insp:not([hidden])') || {}).innerText || ''); if (/\b(null|undefined)\b/.test(t)) bad.push(name); await p.evaluate(() => { window.__lists.ui.closeAll(); window.__lists.ui.closeInsp(); }); };
  await p.evaluate(() => window.__lists.ui.settings()); await scan('settings');
  await p.evaluate(() => window.__lists.ui.openInsp(window.__lists.st.rows[0] || window.__lists.S.children(window.__lists.S.INBOX)[0])); await scan('inspector');
  await p.evaluate(() => window.__lists.ui.palette('all')); await scan('palette');
  await p.evaluate(() => window.__lists.ui.compose()); await scan('quick add');
  await p.evaluate(() => window.__lists.ui.datePicker([window.__lists.S.children(window.__lists.S.INBOX)[0]], 'when')); await scan('date picker');
  await p.evaluate(() => window.__lists.ui.cheat()); await scan('cheat sheet');
  check('no surface renders a literal "null" or "undefined"', bad.length === 0, bad.join(','));
  await ctx.close();
}
// ---- virtualization (600 rows): focus survives the sliding window (v-1), off-window anchors (v-2), drag (v-3)
async function bigList(p, n = 600) {
  return p.evaluate((n) => { const { A, O, S, ui } = window.__lists; let l; O.tx('fx', () => { l = A.newList('Big'); for (let i = 0; i < n; i++) O.create({ title: 'r' + i, pos: S.posAt(l, i) }); }); ui.go({ view: 'node', id: l }, 'key'); return l; }, n);
}
{
  const { ctx, p } = await page({ width: 1280, height: 800 });
  const l = await bigList(p); await p.waitForTimeout(200);
  await p.evaluate(() => { const { st } = window.__lists; window.__lists.ui.focus(st.rows[400]); });
  await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.keyboard.press('End');
  for (let i = 0; i < 40; i++) { await p.keyboard.press('Enter'); await p.keyboard.type('new' + i); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const titles = await p.evaluate((l) => window.__lists.S.children(l).map((c) => window.__lists.S.val(c, 'title')).filter((t) => /^new/.test(t)), l);
  const ok = titles.length === 40 && titles.every((t, i) => t === 'new' + i);
  check('v-1: typing 40 rows deep in a 600-row list keeps focus and text', ok, titles.length + ' rows' + (ok ? '' : ': ' + titles.slice(0, 6).join(',')));
  // j-navigation focus across the window edge
  await p.evaluate(() => { scrollTo(0, 0); window.__lists.ui.focus(window.__lists.st.rows[0]); }); await p.waitForTimeout(150);
  let lost = 0;
  for (let i = 0; i < 120; i++) { await p.keyboard.press('j'); if (i % 10 === 9) { const bad = await p.evaluate(() => !document.activeElement.closest || !document.activeElement.closest('.row')); if (bad) lost++; } }
  check('v-1: j through 120 rows never drops focus to <body>', lost === 0, lost + ' losses');
  // edit then scroll: caret survives
  await p.evaluate(() => { scrollTo(0, 0); }); await p.waitForTimeout(100);
  await p.click('.row:nth-child(12) .tx'); await p.keyboard.press('End');
  await p.mouse.wheel(0, 2400); await p.waitForTimeout(400); await p.keyboard.type('ZZ'); await p.waitForTimeout(100);
  const zz = await p.evaluate(() => [...window.__lists.S.recs.values()].some((r) => /ZZ$/.test(window.__lists.S.val(r.id, 'title'))));
  check('v-1: typing after scrolling away from the edited row still lands in it', zz);
  // v-2: date picker for an off-window row keeps the visible rows
  await p.evaluate(() => { window.__lists.ui.focus(window.__lists.st.rows[400]); }); await p.waitForTimeout(250);
  await p.evaluate(() => { const { st } = window.__lists; st.sel = new Set([st.rows[0], st.rows[400]]); });
  await p.keyboard.press('t'); await p.waitForTimeout(300);
  const vis = await p.evaluate(() => [...document.querySelectorAll('.row')].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }).length);
  const pick = await p.evaluate(() => { const pnl = document.querySelector('.lyr .panel'); if (!pnl) return 'none'; const b = pnl.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight ? 'on-screen' : 'off ' + Math.round(b.top); });
  check('v-2: date picker for an off-window row keeps rows visible and opens on screen', vis > 5 && pick === 'on-screen', vis + ' visible, picker ' + pick);
  await p.keyboard.press('Escape');
  // v-3: drag with autoscroll keeps the drop line
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
  const r3 = await p.locator('.row:nth-child(5)').boundingBox();
  await p.mouse.move(r3.x + r3.width - 40, r3.y + r3.height / 2); await p.mouse.down();
  await p.mouse.move(r3.x + r3.width - 40, r3.y + 40, { steps: 4 }); await p.mouse.move(r3.x + r3.width - 40, 795, { steps: 6 });
  await p.waitForTimeout(2500);
  const line = await p.evaluate(() => !!document.querySelector('#outline .drop-line') && document.querySelector('.drop-line').isConnected);
  await p.mouse.up(); await p.waitForTimeout(200);
  check('v-3: drop line survives autoscroll across the window', line);
  await ctx.close();
}
await b.close();
const failed = results.filter((r) => !r[0]).length;
console.log(`review-fixes: ${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
