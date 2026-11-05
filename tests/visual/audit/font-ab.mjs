// font-ab.mjs — standalone advance-width test of the shipped text font vs the source variable font.
// Loads each via the FontFace API (no font-display race) and measures single-glyph advances at 15px.
import { launch, OUT, ROOT } from './lib.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const files = { shipped: join(ROOT, 'src/fonts/mona-text.woff2'), source: join(OUT, 'mona-wdth-wght.woff2'), instrument: join(OUT, 'instrument.woff2') };
const srv = createServer((q, r) => { const k = q.url.slice(1); if (files[k]) { r.writeHead(200, { 'content-type': 'font/woff2' }); r.end(readFileSync(files[k])); } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><body style="margin:0;background:#fff"></body>'); } }).listen(0);
const base = 'http://127.0.0.1:' + srv.address().port;
const b = await launch();
for (const dpr of [1, 2, 3.5]) {
  const p = await b.newPage({ deviceScaleFactor: dpr, viewport: { width: 520, height: 260 } });
  await p.goto(base + '/');
  const r = await p.evaluate(async (names) => {
    const out = {};
    let y = 0;
    for (const n of names) {
      const ff = new FontFace('T-' + n, `url(/${n})`, { weight: '400 650', stretch: '75% 125%' }); await ff.load(); document.fonts.add(ff);
      const s = document.createElement('span'); s.style.cssText = `position:absolute;white-space:pre;font:430 15px "T-${n}";visibility:hidden`; document.body.append(s);
      const w = (t) => { s.textContent = t; return +s.getBoundingClientRect().width.toFixed(2); };
      out[n] = { t: w('t'), f: w('f'), i: w('i'), n: w('n'), Kitchen: w('Kitchen') };
      const d = document.createElement('div'); d.style.cssText = `position:absolute;left:10px;top:${10 + y}px;font:430 16px "T-${n}";color:#222`; d.textContent = n + ': Water the fig · Kitchen › Cabinets · renovation'; document.body.append(d); y += 30;
    }
    return out;
  }, Object.keys(files));
  console.log('dpr', dpr, JSON.stringify(r));
  await p.screenshot({ path: join(OUT, `font-ab-dpr${dpr}.png`), clip: { x: 0, y: 0, width: 520, height: 110 } });
  await p.close();
}
await b.close(); srv.close();
