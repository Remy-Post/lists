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
await b.close();
const failed = results.filter((r) => !r[0]).length;
console.log(`review-fixes: ${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
