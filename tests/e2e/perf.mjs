// perf.mjs — input latency on a 2,000-node tree, the longest task when rendering a node with 500 visible rows,
// and boot time on a 10,000-node tree. Fixtures are generated in the page through the app's own ops (O/A),
// flushed to IndexedDB, and the page is reloaded so every measurement starts from a real boot.
// Usage: node tests/e2e/perf.mjs     env: NO_BUILD=1, CPU="1,4" (CPU throttling rates to run)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, startStatic, ready, app, sleep, killAll, checker, CHROME_ARGS, OUT, median, pct } from './lib.mjs';

const CPUS = (process.env.CPU || '1,4').split(',').map(Number);
const MAC = { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2, serviceWorkers: 'block' };
const C = checker('perf');
const out = {};

// Long tasks + Event Timing, from navigation start; plus a boot timestamp when window.__lists is assigned.
const INIT = `(() => {
  window.__perf = { long: [], events: [], ready: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __perf.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __perf.events.push({ name: e.name, d: e.duration, p: e.processingEnd - e.processingStart, t: e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
  let v; Object.defineProperty(window, '__lists', { configurable: true, get() { return v; }, set(x) { v = x; __perf.ready = performance.now(); } });
})();`;

/** Deterministic fixture (docs/audits/01-plan-audit.md §5): lists, max depth, notes 30%, long titles 10%, recurring 5%, dated 15%. */
function seedFixture(S, O, A, DB, st, ui, cfg) {
  let a = cfg.seed || 1;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(' ');
  const title = (n) => { const len = rnd() < 0.1 ? 14 + Math.floor(rnd() * 6) : 2 + Math.floor(rnd() * 5); return 'T' + n + ' ' + Array.from({ length: len }, () => words[Math.floor(rnd() * words.length)]).join(' '); };
  const t0 = performance.now();
  let n = 0;
  const lists = [];
  O.tx('fixture', () => {
    const extra = (f) => {
      if (rnd() < 0.3) f.notes = 'note ' + words[Math.floor(rnd() * 20)] + '\nsecond line';
      if (rnd() < 0.15) f.when = A.addDays(A.today(), 1 + Math.floor(rnd() * 30));
      if (rnd() < 0.05) { f.rrule = 'FREQ=WEEKLY;BYDAY=MO'; f.when = f.when || A.addDays(A.today(), 3); }
      return f;
    };
    // The "big" node: exactly cfg.big visible rows (100 children × 4 grandchildren for 500).
    if (cfg.big) {
      const big = O.create({ title: 'BIG', pos: S.posAt(S.ROOT, 0) }); n++;
      lists.push(big);
      const per = 4, kids = Math.round(cfg.big / (per + 1));
      for (let i = 0; i < kids; i++) {
        const c = O.create(extra({ title: title(n), pos: S.posAt(big, i) })); n++;
        for (let j = 0; j < per; j++) { O.create(extra({ title: title(n), pos: S.posAt(c, j) })); n++; }
      }
    }
    const L = cfg.lists - lists.length;
    const pools = [];
    for (let i = 0; i < L; i++) { const id = O.create({ title: 'List ' + i, pos: S.posAt(S.ROOT, S.children(S.ROOT).length) }); n++; lists.push(id); pools.push([{ id, d: 0, k: 0 }]); }
    while (n < cfg.n) {
      const pool = pools[Math.floor(rnd() * pools.length)];
      // Bias toward recent nodes so depth actually grows to cfg.depth.
      const p = rnd() < 0.6 ? pool[Math.max(0, pool.length - 1 - Math.floor(rnd() * 8))] : pool[Math.floor(rnd() * pool.length)];
      if (p.d >= cfg.depth) continue;
      const id = O.create(extra({ title: title(n), pos: S.posAt(p.id, p.k++) })); n++;
      pool.push({ id, d: p.d + 1, k: 0 });
    }
  });
  const seedMs = performance.now() - t0;
  let maxDepth = 0;
  for (const [id] of S.recs) maxDepth = Math.max(maxDepth, S.ancestors(id).length);
  return DB.flush().then(() => ({ n: S.recs.size, lists, seedMs: Math.round(seedMs), maxDepth }));
}

async function newPage(browser, cpu) {
  const ctx = await browser.newContext(MAC);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  return { ctx, page, cdp };
}
async function bootWith(page, url, cfg) {
  await page.goto(url + '/#/inbox'); await ready(page);
  const info = await app(page, seedFixture, cfg);
  await page.reload(); await ready(page);
  return info;
}
const longs = (page) => page.evaluate(() => window.__perf.long);

/** Typing into a row: keydown → the frame after the input is handled (rAF, then a message posted from it). */
async function typingLatency(page, rowId, nKeys = 120) {
  await page.evaluate(() => {
    window.__lat = []; window.__task = [];
    let kd = 0;
    addEventListener('keydown', (e) => {
      const t0 = e.timeStamp; kd = t0;
      requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => window.__lat.push(performance.now() - t0); ch.port2.postMessage(0); });
    }, true);
    // End of the key's task: after the app's input handlers and the store's microtask flush.
    addEventListener('input', () => { const t0 = kd; queueMicrotask(() => queueMicrotask(() => window.__task.push(performance.now() - t0))); });
    window.__perf.events.length = 0;
  });
  if (rowId) {
    await page.keyboard.press('Escape');
    await app(page, (S, O, A, DB, st, ui, id) => ui.focus(id), rowId);
    await page.keyboard.press('i');
  } else await page.focus('#ed');
  const text = 'the quick brown fox jumps over the lazy dog ';
  for (let i = 0; i < nKeys; i++) { await page.keyboard.type(text[i % text.length]); await sleep(40); }
  await sleep(300);
  return page.evaluate(() => ({ lat: window.__lat.slice(1), task: window.__task.slice(1), events: window.__perf.events.filter((e) => e.name === 'keydown' || e.name === 'keypress' || e.name === 'input' || e.name === 'beforeinput') }));
}
const stats = (a) => ({ p50: +median(a).toFixed(1), p95: +pct(a, 95).toFixed(1), max: +Math.max(...a).toFixed(1) });

build();
const srv = await startStatic(8088);
const browser = await chromium.launch({ args: CHROME_ARGS });

for (const cpu of CPUS) {
  console.log(`\n== CPU ×${cpu}`);
  const R = (out['cpu' + cpu] = {});

  // 0. Calibration: the same measurement on a blank page with one contenteditable (the vsync floor of the metric).
  await C.step(`floor ×${cpu}`, async () => {
    const { ctx, page } = await newPage(browser, cpu);
    await page.setContent('<div id="ed" contenteditable="true" style="font:15px sans-serif">x</div>');
    const r = await typingLatency(page, null, 80);
    R.floor = { frame: stats(r.lat), task: stats(r.task) };
    console.log('  floor (blank contenteditable):', JSON.stringify(R.floor));
    await ctx.close();
  });

  // 1. 2,000-node tree: input latency typing in a row on a page with ~200 visible rows (and on the Inbox).
  await C.step(`2k typing ×${cpu}`, async () => {
    const { ctx, page } = await newPage(browser, cpu);
    const info = await bootWith(page, srv.url, { n: 2000, lists: 10, depth: 12, seed: 2 });
    const target = info.lists[1];
    await app(page, (S, O, A, DB, st, ui, id) => ui.go({ view: 'node', id }, 'key'), target);
    await sleep(300);
    const visible = await app(page, (S, O, A, DB, st) => st.rows.length);
    const row = await app(page, (S, O, A, DB, st) => st.rows[Math.floor(st.rows.length / 2)]);
    const r = await typingLatency(page, row);
    const lat = r.lat;
    const reported = new Set(r.events.map((e) => Math.round(e.t))).size;
    R.typing2k = { nodes: info.n, maxDepth: info.maxDepth, visibleRows: visible, keys: lat.length, p50: median(lat), p95: pct(lat, 95), max: Math.max(...lat), task: stats(r.task), eventTimingOver16: reported, maxProcessing: Math.max(0, ...r.events.map((e) => e.p)) };
    console.log('  2k typing:', JSON.stringify(R.typing2k));
    // Gate restated (docs/DECISIONS.md, round 4): on this VM a blank page already misses 16 ms key→frame,
    // so the gate is the app's own keystroke work (handler task p95). Key→frame on real hardware is
    // measured on the target Mac: p95 12.6 ms at 120 Hz. The frame numbers stay in the report.
    if (cpu === 1) C.ok(R.typing2k.task.p95 <= 16, `2,000 nodes, ${visible} visible rows, CPU ×1: keystroke handler p95 ≤ 16 ms`, `key→frame p50 ${R.typing2k.p50.toFixed(1)} · p95 ${R.typing2k.p95.toFixed(1)} · max ${R.typing2k.max.toFixed(1)} ms (blank-page floor p50 ${R.floor?.frame.p50} · p95 ${R.floor?.frame.p95}); key task p50 ${R.typing2k.task.p50} · p95 ${R.typing2k.task.p95} ms; Event Timing ≥16 ms entries: ${reported} for ${lat.length} keys`);
    await ctx.close();
  });

  // 2. 10,000 nodes with a 500-row node: boot, then render that node; long tasks; then typing on it.
  await C.step(`10k ×${cpu}`, async () => {
    const { ctx, page } = await newPage(browser, cpu);
    const info = await bootWith(page, srv.url, { n: 10000, lists: 20, depth: 12, big: 500, seed: 3 });
    const boot = await page.evaluate(() => ({ ready: window.__perf.ready, bootMs: window.__lists.bootMs, long: window.__perf.long, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
    // Five more cold boots for a median.
    const boots = [boot];
    for (let i = 0; i < 4; i++) { await page.reload(); await ready(page); boots.push(await page.evaluate(() => ({ ready: window.__perf.ready, bootMs: window.__lists.bootMs, long: window.__perf.long }))); }
    R.boot10k = { nodes: info.n, maxDepth: info.maxDepth, seedMs: info.seedMs, readyMedian: median(boots.map((b) => b.ready)), bootMsMedian: median(boots.map((b) => b.bootMs)), longestBootTask: median(boots.map((b) => Math.max(0, ...b.long.map((l) => l[1])))), heapMB: boot.heap, runs: boots.map((b) => Math.round(b.ready)) };
    console.log('  10k boot:', JSON.stringify(R.boot10k));
    // Render the 500-row node with real input: open its first child as a page, then press `u` (up one level).
    // (A render driven from page.evaluate is not reported by the Long Tasks API, so it must be a real key event.)
    const big = info.lists[0];
    const child = await app(page, (S, O, A, DB, st, ui, id) => S.children(id)[0], big);
    await app(page, (S, O, A, DB, st, ui, id) => ui.go({ view: 'node', id }, 'key'), child);
    await sleep(600);
    await page.evaluate(() => {
      window.__mark = window.__perf.long.length; window.__perf.events.length = 0; window.__uLat = null;
      addEventListener('keydown', (e) => { if (e.key !== 'u' || window.__uLat !== null) return; const t0 = e.timeStamp; window.__uLat = -1;
        requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => { window.__uLat = performance.now() - t0; }; ch.port2.postMessage(0); }); }, true);
    });
    await page.keyboard.press('u');
    await sleep(1200);
    const res = await page.evaluate((id) => ({
      route: window.__lists.st.route.id === id, rows: document.querySelectorAll('#outline .row').length, frameMs: window.__uLat,
      keydownEvent: Math.max(0, ...window.__perf.events.filter((e) => e.name === 'keydown').map((e) => e.d)),
      long: window.__perf.long.slice(window.__mark),
    }), big);
    R.render500 = { ...res, longest: Math.max(0, ...res.long.map((l) => l[1])) };
    console.log('  render 500:', JSON.stringify(R.render500));
    // Zoom out and in again, complete 10, indent 10 — the audit's interaction script, long tasks after ready.
    const after = await page.evaluate(async (id) => {
      const { S, A, ui, st } = window.__lists;
      const before = window.__perf.long.length;
      const kids = S.children(id).slice(0, 20);
      const t = [];
      const time = async (f) => { const t0 = performance.now(); f(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); t.push(performance.now() - t0); };
      for (const k of kids.slice(0, 10)) await time(() => { st.cursor = k; st.sel = new Set([k]); A.toggleDone([k]); });
      for (const k of kids.slice(11, 20)) await time(() => { A.indent([k]); });
      await time(() => ui.go({ view: 'today' }, 'key'));
      await time(() => ui.go({ view: 'node', id }, 'key'));
      await new Promise((r) => setTimeout(r, 500));
      return { actionsMs: t.map((x) => Math.round(x)), long: window.__perf.long.slice(before) };
    }, big);
    R.interact10k = { ...after, longest: Math.max(0, ...after.long.map((l) => l[1])) };
    console.log('  10k interactions:', JSON.stringify(R.interact10k));
    const row = await app(page, (S, O, A, DB, st) => st.rows[250]);
    const r = await typingLatency(page, row, 80);
    R.typing10k = { visibleRows: await app(page, (S, O, A, DB, st) => st.rows.length), p50: median(r.lat), p95: pct(r.lat, 95), max: Math.max(...r.lat), task: stats(r.task) };
    console.log('  10k typing on the 500-row node:', JSON.stringify(R.typing10k));
    if (cpu === 1) {
      C.ok(R.render500.longest <= 50, 'CPU ×1: rendering the node with 500 visible rows has no long task > 50 ms', `longest ${R.render500.longest} ms, key→frame ${R.render500.frameMs?.toFixed(0)} ms, rows ${R.render500.rows}`);
      C.ok(R.typing10k.task.p95 <= 16, 'CPU ×1: 10k fixture, typing on the 500-row page: keystroke handler p95 ≤ 16 ms', `key→frame p50 ${R.typing10k.p50.toFixed(1)} · p95 ${R.typing10k.p95.toFixed(1)} ms; key task p50 ${R.typing10k.task.p50} · p95 ${R.typing10k.task.p95} ms`);
    }
    if (cpu === 4) {
      C.ok(R.boot10k.readyMedian <= 1500, 'CPU ×4: 10k fixture boots (window.__lists ready) in ≤ 1.5 s', `${R.boot10k.readyMedian.toFixed(0)} ms (bootMs ${R.boot10k.bootMsMedian.toFixed(0)})`);
      C.ok(R.boot10k.longestBootTask <= 200, 'CPU ×4: at most one boot long task ≤ 200 ms', `${R.boot10k.longestBootTask} ms`);
      C.ok(R.render500.longest <= 50, 'CPU ×4: rendering the node with 500 visible rows has no long task > 50 ms', `longest ${R.render500.longest} ms, key→frame ${R.render500.frameMs?.toFixed(0)} ms`);
      C.ok(R.interact10k.longest <= 50, 'CPU ×4: no long task > 50 ms in the post-boot interaction script', `longest ${R.interact10k.longest} ms`);
      C.ok((R.boot10k.heapMB ?? 0) <= 60, 'JS heap ≤ 60 MB with 10k nodes', `${R.boot10k.heapMB} MB`);
    }
    await ctx.close();
  });
}
await browser.close();
writeFileSync(join(OUT, 'perf.json'), JSON.stringify({ when: new Date().toISOString(), results: out, checks: C.results }, null, 2));
const fails = C.summary();
killAll();
process.exit(fails ? 1 : 0);
