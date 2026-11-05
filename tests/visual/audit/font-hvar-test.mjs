// font-hvar-test.mjs — A/B: shipped mona-text.woff2 (no HVAR) vs a source VF that keeps HVAR.
// Usage: node tests/visual/audit/font-hvar-test.mjs <path-to-font-with-HVAR>
import { launch, BASE, OUT } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const alt = process.argv[2];
const b = await launch();
for (const mode of ['shipped', 'hvar']) {
  const p = await b.newPage({ deviceScaleFactor: 3, viewport: { width: 412, height: 300 } });
  if (mode === 'hvar') await p.route(/mona-text-.*\.woff2/, (r) => r.fulfill({ body: readFileSync(alt), contentType: 'font/woff2' }));
  await p.goto(BASE + '/#/today'); await p.waitForFunction(() => window.__lists);
  await p.waitForTimeout(800); await p.goto(BASE + '/?second=1#/inbox'); await p.waitForFunction(() => window.__lists); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const s = document.createElement('span'); s.style.cssText = 'position:absolute;white-space:pre;font:430 15px/22px "Mona Sans"'; document.body.append(s);
    const w = (t) => { s.textContent = t; return +s.getBoundingClientRect().width.toFixed(2); };
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff;color:#222;padding:16px;font:430 16px/26px "Mona Sans"';
    box.innerHTML = 'Water the fig · Kitchen › Cabinets<br>Home renovation · Draft release notes<br><span style="font-stretch:88%">Completed: Measure the corner unit</span><br><span style="font-size:13px">Legal wants “up to” in front of every claim.</span>';
    document.body.append(box);
    return { t: w('t'), f: w('f'), i: w('i'), n: w('n'), Kitchen: w('Kitchen') };
  });
  console.log(mode, r);
  await p.screenshot({ path: join(OUT, `font-ab-${mode}.png`), clip: { x: 0, y: 0, width: 412, height: 140 } });
  await p.close();
}
await b.close();
