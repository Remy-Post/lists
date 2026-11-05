// sheet-probe.mjs — checks whether phone bottom sheets actually come on screen after opening.
import { launch, openSeeded, OUT } from './lib.mjs';
import { join } from 'node:path';
const b = await launch();
const { page } = await openSeeded(b, 'phone', 'light');
for (const fn of ['palette', 'settings', 'compose']) {
  await page.evaluate((fn) => window.__lists.ui[fn](), fn);
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => { const p = document.querySelector('.lyr .panel'); const cs = getComputedStyle(p); const rc = p.getBoundingClientRect();
    return { cls: p.parentElement.className, transform: cs.transform, opacity: cs.opacity, top: Math.round(rc.top), bottom: Math.round(rc.bottom), vh: innerHeight }; });
  console.log(fn, JSON.stringify(r));
  await page.evaluate(() => window.__lists.ui.closeAll()); await page.waitForTimeout(300);
}
await b.close();
