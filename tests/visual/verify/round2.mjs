// round2.mjs — re-shoot the states the visual audit flagged, after the fixes.
import { launch, openSeeded, go, fx, alignScan, contrastScan } from '../audit/lib.mjs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const OUT = new URL('../out/verify/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const b = await launch();
const snap = (p, n) => p.screenshot({ path: join(OUT, n + '.png') });
for (const [dev, scheme] of [['phone', 'light'], ['phone', 'dark'], ['desk', 'light'], ['desk', 'dark']]) {
  const { page, ctx } = await openSeeded(b, dev, scheme);
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const F = await fx(page);
  await go(page, '#/today'); await snap(page, `${dev}-${scheme}-today`);
  const align = await page.evaluate(alignScan);
  await go(page, '#/n/' + F.soft); await snap(page, `${dev}-${scheme}-deep`);
  await go(page, '#/upcoming'); await snap(page, `${dev}-${scheme}-upcoming`);
  await go(page, '#/logbook'); await snap(page, `${dev}-${scheme}-logbook`);
  await go(page, '#/today');
  await page.evaluate(() => window.__lists.ui.palette('all')); await page.waitForTimeout(450); await snap(page, `${dev}-${scheme}-palette`);
  const palRect = await page.evaluate(() => { const p = document.querySelector('.lyr .panel'); const r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
  await page.evaluate(() => window.__lists.ui.closeAll());
  await page.evaluate(() => window.__lists.ui.openInsp(window.__lists.st.rows[1])); await page.waitForTimeout(450); await snap(page, `${dev}-${scheme}-inspector`);
  const nullText = await page.evaluate(() => /\bnull\b/.test((document.querySelector('.insp-sheet, #insp') || {}).textContent || ''));
  await page.evaluate(() => { window.__lists.ui.closeAll(); window.__lists.ui.closeInsp(); });
  await page.evaluate(() => window.__lists.ui.compose()); await page.waitForTimeout(300);
  await page.keyboard.type('Call Ana about the deposit fri !! #home'); await page.waitForTimeout(150); await snap(page, `${dev}-${scheme}-composer`);
  await page.evaluate(() => { window.__lists.DB.setMeta('draft', ''); window.__lists.ui.closeAll(); });
  await page.evaluate(() => window.__lists.ui.settings()); await page.waitForTimeout(600); await snap(page, `${dev}-${scheme}-settings`);
  await page.evaluate(() => window.__lists.ui.closeAll());
  // complete everything in Today → cleared
  await go(page, '#/today');
  await page.evaluate(() => { const { S, A } = window.__lists; const t = S.qToday(A.today()); A.toggleDone([...t.day, ...t.eve]); });
  await page.waitForTimeout(1600); await snap(page, `${dev}-${scheme}-cleared`);
  const clearVisible = await page.evaluate(() => { const e = document.querySelector('.empty.clear .big'); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return r.bottom <= innerHeight ? 'visible' : 'below fold ' + Math.round(r.top); });
  const contrast = await page.evaluate(contrastScan);
  console.log(`${dev}/${scheme}: palette ${JSON.stringify(palRect)} | insp null=${nullText} | cleared ${clearVisible} | align ${JSON.stringify(align).slice(0, 160)} | contrast fails ${Array.isArray(contrast) ? contrast.length : JSON.stringify(contrast).slice(0, 200)} | errors ${errs.length} ${errs.slice(0, 2)}`);
  await ctx.close();
}
await b.close();
