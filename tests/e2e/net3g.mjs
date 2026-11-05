// net3g.mjs — cold and repeat-visit timings under DevTools "3G" and "Slow 4G" (CDP), CPU ×4,
// plus a packet-level 3G pass (shared pipe, which also throttles service-worker fetches) and the sync-gate check.
// Usage: node tests/e2e/net3g.mjs [runs=5]      env: PASSES="3G,Slow 4G,wire" (default all), NO_BUILD=1
// Output: console summary + tests/e2e/out/net3g.json
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, startStatic, startSync, startProxy, PRESETS, CHROME_ARGS, OUT, median, sleep, killAll, checker } from './lib.mjs';

const RUNS = +(process.argv[2] || 5);
const PASSES = (process.env.PASSES || '3G,Slow 4G,wire').split(',');
const S25 = { viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' };
// "wire": the DevTools 3G *target* link (400 ms RTT, 400 kbps each way) applied to TCP, shared by every request.
const WIRE = { rtt: 400, down: 50000, up: 50000 };

// Runs in every document before the app: FCP, the moment window.__lists is assigned (end of boot, handlers bound,
// rows rendered), and the frame after it. Reported through a binding so a reload can't erase it.
const INIT = `(() => {
  const rep = (ev, t, extra) => { try { window.__qaReport({ ev, t, origin: performance.timeOrigin, ...extra }); } catch {} };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') rep('fcp', e.startTime); }).observe({ type: 'paint', buffered: true });
  let v;
  Object.defineProperty(window, '__lists', { configurable: true, get() { return v; }, set(x) {
    v = x; const t = performance.now(); const rows = document.querySelectorAll('#outline .row').length;
    rep('ready', t, { rows, boot: x && x.bootMs });
    requestAnimationFrame(() => requestAnimationFrame(() => rep('painted', performance.now(), { rows })));
  } });
})();`;

async function throttle(ctx, page, net, cpu = 4) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  return cdp;
}
function recordNet(cdp) {
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => { if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp, prio: e.request.initialPriority }); });
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.sw = !!e.response.fromServiceWorker; r.ttfb = e.timestamp; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });
  return reqs;
}
const short = (u) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
function waterfall(reqs) {
  const list = [...reqs.values()].sort((a, b) => a.start - b.start);
  const t0 = list.length ? list[0].start : 0;
  return list.map((r) => ({ url: short(r.url), type: r.type, prio: r.prio, start: Math.round((r.start - t0) * 1000), end: r.end ? Math.round((r.end - t0) * 1000) : null, bytes: r.bytes ?? null, status: r.status, sw: r.sw, failed: r.failed }));
}

async function coldAndRepeat(browser, base, label, net, proxy) {
  const ctx = await browser.newContext({ ...S25 });
  const events = [];
  await ctx.exposeBinding('__qaReport', (_src, e) => { events.push({ ...e, wall: Date.now() }); });
  await ctx.addInitScript(INIT);
  const swReqs = [];
  ctx.on('requestfinished', async (r) => { if (r.serviceWorker()) { const s = await r.sizes().catch(() => null); swReqs.push({ url: short(r.url()), body: s && s.responseBodySize, headers: s && s.responseHeadersSize, wall: Date.now() }); } });
  const page = await ctx.newPage();
  const cdp = await throttle(ctx, page, net);
  const reqs = recordNet(cdp);
  proxy && proxy.stats.reset();
  const wall0 = Date.now();
  await page.goto(base + '/#/today', { waitUntil: 'commit' });
  const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); } return null; };
  const firstOrigin = await until(() => events.find((e) => e.ev === 'ready')?.origin, 120000);
  const docs = () => [...new Set(events.map((e) => e.origin))];
  const of = (origin, ev) => events.find((e) => e.origin === origin && e.ev === ev);
  await until(() => of(firstOrigin, 'painted'), 20000);
  await until(() => of(firstOrigin, 'fcp'), 5000);
  const cold = { fcp: of(firstOrigin, 'fcp')?.t, ready: of(firstOrigin, 'ready')?.t, painted: of(firstOrigin, 'painted')?.t, rows: of(firstOrigin, 'ready')?.rows, boot: of(firstOrigin, 'ready')?.boot };
  // Snapshot what the cold document transferred by the time it was interactive.
  const wfCold = waterfall(reqs);
  const coldBytesAtReady = [...reqs.values()].filter((r) => r.end && (r.end - [...reqs.values()][0].start) * 1000 <= cold.ready + 50).reduce((s, r) => s + (r.bytes || 0), 0);
  // The service worker installs, claims, and the app reloads itself once (main.js registerSW → controllerchange).
  const controlledAt = await until(() => (docs().length > 1 ? events.find((e) => e.origin !== firstOrigin && e.ev === 'ready') : null), 180000);
  const reload = controlledAt ? { afterColdReadyMs: Math.round(controlledAt.wall - (wall0 + 0)) - 0, secondDocOriginDeltaMs: Math.round(controlledAt.origin - firstOrigin) } : null;
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 }).catch(() => {});
  await sleep(1000);
  const wireColdTotal = proxy ? { up: proxy.stats.up, down: proxy.stats.down, conns: proxy.stats.conns } : null;
  const pageBytes = [...reqs.values()].filter((r) => !r.sw).reduce((s, r) => s + (r.bytes > 0 ? r.bytes : 0), 0);
  const swBytes = swReqs.reduce((s, r) => s + (r.body || 0) + (r.headers || 0), 0);
  await page.close();

  // Repeat visit: a new tab in the same profile (SW installed, caches warm), same throttling.
  const repeat = [];
  for (const kind of ['tutorial', '2000 nodes']) {
    proxy && proxy.stats.reset();
    const p2 = await ctx.newPage();
    const c2 = await throttle(ctx, p2, net);
    const r2 = recordNet(c2);
    const before = new Set(events.map((e) => e.origin));
    await p2.goto(base + '/#/today', { waitUntil: 'commit' });
    const ev = await until(() => events.find((e) => !before.has(e.origin) && e.ev === 'painted'), 60000);
    const origin = ev && ev.origin;
    await until(() => of(origin, 'fcp'), 3000);
    // A scripted keypress right at ready must move focus (handlers bound).
    await p2.keyboard.press('j');
    const moved = await p2.evaluate(() => !!window.__lists.st.cursor);
    const all = [...r2.values()];
    repeat.push({
      kind, ready: of(origin, 'ready')?.t, painted: ev?.t, fcp: of(origin, 'fcp')?.t, rows: of(origin, 'ready')?.rows, boot: of(origin, 'ready')?.boot, jMoved: moved,
      requests: all.length, fromSW: all.filter((r) => r.sw).length, notFromSW: all.filter((r) => !r.sw && !/\/api\//.test(r.url)).map((r) => short(r.url)),
      wire: proxy ? { up: proxy.stats.up, down: proxy.stats.down } : null,
    });
    if (kind === 'tutorial') {
      // Seed the "medium" fixture for the second repeat (PLAN audit §5: seed 2,000 into IDB, reload).
      await p2.evaluate(async () => {
        const { S, O, DB } = window.__lists;
        let a = 7; const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        O.tx('seed', () => {
          const nodes = [];
          for (let i = 0; i < 10; i++) nodes.push({ id: O.create({ title: 'List ' + i, pos: S.posAt(S.ROOT, S.children(S.ROOT).length) }), d: 0 });
          let n = nodes.length;
          while (n < 2000) {
            const p = nodes[Math.floor(rnd() * nodes.length)];
            if (p.d >= 8) continue;
            const id = O.create({ title: 'Item ' + n + ' ' + 'lorem ipsum '.repeat(1 + Math.floor(rnd() * 4)), pos: S.posAt(p.id, S.children(p.id).length) });
            nodes.push({ id, d: p.d + 1 }); n++;
          }
        });
        await DB.flush();
      });
    }
    await p2.close();
  }
  await ctx.close();
  return { label, cold, coldBytesAtReady, pageBytes, swBytes, swRequests: swReqs.length, wireColdTotal, reload, waterfall: wfCold, repeat };
}

/** Sync gate: pair, make the backup stale, then trigger the gate under 3G (expect no /api/sync) and unthrottled (expect a sync). */
async function syncGate(browser, base) {
  const ctx = await browser.newContext({ ...S25 });
  const page = await ctx.newPage();
  const syncReqs = [];
  page.on('request', (r) => { if (r.url().includes('/api/sync')) syncReqs.push(Date.now()); });
  await page.goto(base + '/#/today');
  await page.waitForFunction(() => !!window.__lists, null, { timeout: 30000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
  await sleep(1500); // let the first-visit reload settle
  await page.waitForFunction(() => !!window.__lists, null, { timeout: 30000 });
  const code = await page.evaluate(() => window.__lists.ui.createVault());
  await sleep(1500);
  const makeStale = () => page.evaluate(async () => {
    const { DB, O, S } = window.__lists;
    const m = DB.getMeta('sync.sync');
    DB.setMeta('sync.sync', { ...m, lastPull: Date.now() - 60 * 60e3, dirty: Date.now() - 10 * 60e3 });
    O.tx('edit', () => O.set(S.children(S.INBOX)[0], { title: 'gate edit ' + Date.now() }));
    await DB.flush();
  });
  const fire = () => page.evaluate(() => dispatchEvent(new Event('online')));
  const out = { paired: !!code, initialSyncs: syncReqs.length };
  for (const [name, net] of [['3G', PRESETS['3G']], ['Slow 4G', PRESETS['Slow 4G']], ['unthrottled', null]]) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', net ? { offline: false, ...net } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(2500);
    await makeStale();
    const n0 = syncReqs.length;
    await fire();
    await sleep(net ? 9000 : 6000);
    const conn = await page.evaluate(() => { const c = navigator.connection; return c ? { effectiveType: c.effectiveType, rtt: c.rtt, downlink: c.downlink, type: c.type } : null; });
    const status = await page.evaluate(() => window.__lists.ui.syncState());
    out[name] = { connection: conn, status: { state: status.state, message: status.message }, syncRequests: syncReqs.length - n0 };
    await cdp.detach();
  }
  await ctx.close();
  return out;
}

/* ---------------- main ---------------- */
build();
const st = await startStatic(8092);
const sy = await startSync(8094);
const stSync = await startStatic(8093, 8094);
const proxyPlain = await startProxy(8095, 8092, null);   // byte counting only
const proxyWire = await startProxy(8096, 8092, WIRE);    // packet-level 3G
const browser = await chromium.launch({ args: CHROME_ARGS });
const C = checker('net3g');
const results = {};
for (const pass of PASSES) {
  const runs = [];
  console.log(`\n== ${pass}: ${RUNS} runs (CPU ×4, S25 viewport)`);
  for (let i = 0; i < RUNS; i++) {
    const r = pass === 'wire'
      ? await coldAndRepeat(browser, proxyWire.url, pass, null, proxyWire)
      : await coldAndRepeat(browser, proxyPlain.url, pass, PRESETS[pass], proxyPlain);
    runs.push(r);
    console.log(`  run ${i + 1}: FCP ${r.cold.fcp?.toFixed(0)} ms · ready ${r.cold.ready?.toFixed(0)} ms (rows ${r.cold.rows}) · wire down ${r.wireColdTotal?.down} B · reload ${r.reload ? r.reload.secondDocOriginDeltaMs + ' ms after nav start' : 'none'} · repeat ${r.repeat.map((x) => x.kind + ' ' + x.painted?.toFixed(0) + ' ms').join(', ')}`);
  }
  const m = (f) => median(runs.map(f).filter((x) => x != null));
  const summary = {
    fcp: m((r) => r.cold.fcp), coldReady: m((r) => r.cold.ready), coldPainted: m((r) => r.cold.painted),
    wireDown: m((r) => r.wireColdTotal?.down), wireUp: m((r) => r.wireColdTotal?.up), pageBytes: m((r) => r.pageBytes), swBytes: m((r) => r.swBytes),
    coldBytesAtReady: m((r) => r.coldBytesAtReady),
    reloadAt: m((r) => r.reload?.secondDocOriginDeltaMs),
    repeatReady: m((r) => r.repeat[0].ready), repeatPainted: m((r) => r.repeat[0].painted), repeatFcp: m((r) => r.repeat[0].fcp),
    repeat2kReady: m((r) => r.repeat[1].ready), repeat2kPainted: m((r) => r.repeat[1].painted),
    worstFcp: Math.max(...runs.map((r) => r.cold.fcp || Infinity)),
  };
  results[pass] = { summary, runs };
  console.log('  medians:', JSON.stringify(summary));
  if (pass === '3G') {
    C.ok(summary.fcp <= 5000, `3G cold FCP median ≤ 5.0 s`, `${summary.fcp.toFixed(0)} ms (worst ${summary.worstFcp.toFixed(0)})`);
    C.ok(summary.repeatPainted <= 1000, `3G repeat visit to interactive median ≤ 1.0 s`, `${summary.repeatPainted.toFixed(0)} ms (ready ${summary.repeatReady.toFixed(0)})`);
    C.ok(summary.repeat2kPainted <= 1000, `3G repeat visit with 2,000 nodes ≤ 1.0 s`, `${summary.repeat2kPainted.toFixed(0)} ms`);
    C.ok(runs.every((r) => r.repeat.every((x) => x.notFromSW.length === 0)), 'repeat visit: every response from the service worker', [...new Set(runs.flatMap((r) => r.repeat.flatMap((x) => x.notFromSW)))].join(', ') || 'all SW');
    C.ok(runs.every((r) => r.repeat.every((x) => x.jMoved)), 'repeat visit: a j keypress at ready moves the cursor');
    const chain = runs[0].waterfall.filter((w) => w.url.endsWith('.js'));
    C.ok(chain.length <= 1 || chain.every((w) => w.start < 3000), '3G: no JS request chain deeper than 2 (all JS discovered from HTML)', chain.map((w) => `${w.url}@${w.start}ms`).join(', '));
    C.ok(!runs.some((r) => r.reload), 'first visit does not reload itself when the service worker takes control', runs.map((r) => r.reload ? r.reload.secondDocOriginDeltaMs + 'ms' : '-').join(', '));
  }
  if (pass === 'wire') C.ok(summary.fcp <= 5000, 'packet-level 3G cold FCP median ≤ 5.0 s (informational)', `${summary.fcp?.toFixed(0)} ms`);
}
console.log('\n== sync gate');
results.syncGate = await syncGate(browser, stSync.url);
console.log(JSON.stringify(results.syncGate, null, 1));
const g = results.syncGate;
C.ok(g['3G'] && g['3G'].syncRequests === 0 && /good connection/i.test(g['3G'].status.message || ''), "sync gate reports 'poor' under 3G (no /api/sync, 'Waiting for a good connection')", g['3G']);
C.ok(g.unthrottled && g.unthrottled.syncRequests > 0, 'sync gate syncs when the link is good and the backup is stale', g.unthrottled);
await browser.close();
await proxyPlain.close(); await proxyWire.close();
writeFileSync(join(OUT, 'net3g.json'), JSON.stringify({ when: new Date().toISOString(), runs: RUNS, results, checks: C.results }, null, 2));
const fails = C.summary();
killAll();
process.exit(fails ? 1 : 0);
