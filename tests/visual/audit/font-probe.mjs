// font-probe.mjs — isolates the uneven t/f spacing seen in Mona Sans text runs.
import { launch, BASE, OUT } from './lib.mjs';
import { join } from 'node:path';
const b = await launch();
const p = await b.newPage({ deviceScaleFactor: 3 });
await p.goto(BASE + '/#/today'); await p.waitForFunction(() => window.__lists);
await p.reload(); await p.waitForFunction(() => window.__lists); await p.evaluate(() => document.fonts.ready);
const r = await p.evaluate(async () => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff;color:#111;padding:20px;font:430 30px/44px "Mona Sans";';
  const variants = [['default', ''], ['kern off', 'font-kerning:none'], ['liga off', 'font-variant-ligatures:none'], ['no optimizeLegibility', 'text-rendering:auto'], ['wdth 88', 'font-stretch:88%'], ['wdth 94', 'font-stretch:94%'], ['wght 400', 'font-weight:400'], ['wght 500', 'font-weight:500'], ['fallback', 'font-family:"Mona Fallback"']];
  const out = [];
  for (const [n, css] of variants) {
    const d = document.createElement('div'); d.style.cssText = css; d.textContent = n + ': Kitchen Water the fig attention';
    box.append(d);
    const s = document.createElement('span'); s.style.cssText = css + ';position:absolute;visibility:hidden;white-space:pre'; document.body.append(s);
    const w = (t) => { s.textContent = t; return s.getBoundingClientRect().width.toFixed(1); };
    out.push({ n, t: w('t'), f: w('f'), i: w('i'), n_: w('n'), tt: w('tt'), it: w('it') });
  }
  document.body.append(box);
  return out;
});
console.table(r);
await p.screenshot({ path: join(OUT, 'font-probe.png'), clip: { x: 0, y: 0, width: 900, height: 440 } });
await b.close();
