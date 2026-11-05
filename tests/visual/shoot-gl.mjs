// Visual check for src/js/gl.js. Usage: node tests/visual/shoot-gl.mjs
// Captures the sweep at t = 0/300/600/900 ms and at rest (light + dark, 1728x1000 @1x) into tests/visual/out/.
// It also writes *-diff.png (the light's contribution, |frame - bare paper| x 12) and 1:1 crops.
// Time is driven by a virtual rAF clock, so the frames are deterministic even on SwiftShader.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(homedir(), '.local/lists-test/'));
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'tests/visual/out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  try {
    const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!p.startsWith(ROOT)) throw 0;
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
const QUICK = !!process.env.QUICK; // QUICK=1: t=300 + rest only, coarse 50 ms frames (for shader iteration)
const STEP = QUICK ? 50 : 16;

async function diff(page, a, b, gainK = 12) {
  return Buffer.from(await page.evaluate(async ([a, b, k]) => {
    const load = async (s) => createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
    const [A, B] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(A.width, A.height), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(A, 0, 0); const da = x.getImageData(0, 0, A.width, A.height);
    x.drawImage(B, 0, 0); const db = x.getImageData(0, 0, A.width, A.height);
    let sum = 0, n = 0, hist = new Uint32Array(512);
    for (let i = 0; i < da.data.length; i += 4) {
      const l = (db.data[i] - da.data[i]) * 0.2126 + (db.data[i + 1] - da.data[i + 1]) * 0.7152 + (db.data[i + 2] - da.data[i + 2]) * 0.0722;
      sum += l; n++; hist[Math.round(l) + 256]++;
      for (let j = 0; j < 3; j++) da.data[i + j] = 128 + (db.data[i + j] - da.data[i + j]) * k;
    }
    const pct = (q) => { let c = 0; for (let i = 0; i < 512; i++) if ((c += hist[i]) >= q * n) return i - 256; };
    window.__stats = `mean ${(sum / n).toFixed(2)} lv, p1 ${pct(0.01)}, p99 ${pct(0.99)}, min ${pct(0)}, max ${pct(1)}`;
    x.putImageData(da, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, [a.toString('base64'), b.toString('base64'), gainK]), 'base64');
}

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${theme} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${theme} pageerror: ${e.message}`));
  // Virtual clock: rAF and performance.now only advance through window.__tick(ms), in 16 ms frames.
  await page.addInitScript((STEP) => {
    let T = 0, id = 0;
    const q = new Map();
    window.__raf = 0;
    performance.now = () => T;
    window.requestAnimationFrame = (f) => (window.__raf++, q.set(++id, f), id);
    window.cancelAnimationFrame = (i) => q.delete(i);
    window.__tick = (ms) => {
      for (const end = T + ms; T + STEP <= end;) {
        T += STEP;
        const cbs = [...q.values()]; q.clear();
        for (const f of cbs) f(T);
      }
    };
  }, STEP);
  await page.goto(`${base}/tests/visual/gl-demo.html?shot&theme=${theme}`);
  for (let i = 0; i < 100 && !(await page.evaluate(() => window.__ready)); i++) await new Promise((r) => setTimeout(r, 50));
  console.log(theme, 'supported():', await page.evaluate(() => window.__gl.supported()));

  const shot = async (name, clip) => {
    await new Promise((r) => setTimeout(r, 250)); // let the compositor pick up the last GL frame (real time)
    const b = await page.screenshot({ clip });
    if (name) await writeFile(join(OUT, `${theme}-${name}.png`), b);
    return b;
  };
  const bare = await shot('paper');
  await page.evaluate(() => { window.__done = false; window.__gl.sweep().then(() => (window.__done = true)); });
  let now = 0;
  const at = async (ms) => { const d = Math.max(16, ms - now); await page.evaluate((d) => window.__tick(d), d); now += d; };
  for (const ms of QUICK ? [300] : [0, 300, 600, 900]) {
    await at(ms + STEP + 1); // the first rAF after sweep() is the t = 0 frame
    const b = await shot(`t${String(ms).padStart(4, '0')}`);
    await writeFile(join(OUT, `${theme}-t${String(ms).padStart(4, '0')}-diff.png`), await diff(page, bare, b));
    console.log(theme, `t=${ms}`, await page.evaluate(() => window.__stats));
  }
  console.log(theme, 'sweep resolved by ~917 ms:', await page.evaluate(() => window.__done));
  await at(2500);
  const restB = await shot('rest');
  await writeFile(join(OUT, `${theme}-rest-diff.png`), await diff(page, bare, restB));
  console.log(theme, 'rest', await page.evaluate(() => window.__stats));
  const crop = { x: 760, y: 220, width: 640, height: 400 };
  const litCrop = await shot('rest-crop', crop);
  await page.evaluate(() => (window.__gl.canvas().style.visibility = 'hidden'));
  const bareCrop = await shot(null, crop);
  await page.evaluate(() => (window.__gl.canvas().style.visibility = ''));
  await writeFile(join(OUT, `${theme}-rest-crop-diff.png`), await diff(page, bareCrop, litCrop));

  if (QUICK) { await ctx.close(); continue; }
  // Pointer follow, then the idle stop.
  await page.mouse.move(1300, 760, { steps: 4 });
  await at(now + 1200);
  const ptr = await shot('pointer');
  await writeFile(join(OUT, `${theme}-pointer-diff.png`), await diff(page, bare, ptr));
  await at(now + 4600);
  const r0 = await page.evaluate(() => window.__raf);
  await at(now + 2000);
  const r1 = await page.evaluate(() => window.__raf);
  console.log(theme, `rAF calls during 2 s after 4 s idle: ${r1 - r0}`, r1 === r0 ? '(stopped: ok)' : '(STILL RUNNING)');
  if (r1 !== r0) problems.push(`${theme}: rAF loop did not stop when idle`);

  // Context loss / restore, then another sweep.
  const glErr = await page.evaluate(async () => {
    const c = window.__gl.canvas(), g = c.getContext('webgl2'), ext = g.getExtension('WEBGL_lose_context');
    const e0 = g.getError();
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 30));
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 30));
    return { before: e0, lost: g.isContextLost() };
  });
  await at(now + 100);
  await page.evaluate(() => window.__gl.sweep());
  await at(now + 600);
  const glErr2 = await page.evaluate(() => window.__gl.canvas().getContext('webgl2').getError());
  await shot('after-restore');
  console.log(theme, 'gl.getError before loss:', glErr.before, 'lost after restore:', glErr.lost, 'getError after restore + sweep:', glErr2);
  if (glErr.before || glErr2 || glErr.lost) problems.push(`${theme}: GL error or context not restored`);

  await page.evaluate(() => window.__gl.destroy());
  const left = await page.evaluate(() => !!window.__gl.canvas());
  if (left) problems.push(`${theme}: canvas left after destroy()`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors, no GL errors');
console.log('out:', OUT);
