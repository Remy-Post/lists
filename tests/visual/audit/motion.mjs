// motion.mjs — frame sequences + an in-page rAF timeline for the strike, the zoom View Transition and the cleared-Today moment.
// Usage: node tests/visual/audit/motion.mjs [desk|phone] [light|dark]
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, openSeeded, go, fx, shot, OUT } from './lib.mjs';

const dev = process.argv[2] || 'desk', scheme = process.argv[3] || 'light';
const tag = `motion-${dev}-${scheme}`;
const browser = await launch();
const { page } = await openSeeded(browser, dev, scheme);
const F = await fx(page);
const log = {};
const cdp = await page.context().newCDPSession(page);

/** In-page sampler: every rAF for `ms`, records the state of one row. */
const sampleRow = (sel, ms) => page.evaluate(([sel, ms]) => new Promise((res) => {
  const row = document.querySelector(sel); const out = []; const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    const r = row.isConnected ? row.getBoundingClientRect() : null;
    const tx = row.querySelector('.tx'), box = row.querySelector('.ck .box'), path = row.querySelector('svg.strike path');
    const cs = tx && getComputedStyle(tx);
    out.push({ t: Math.round(t), top: r && Math.round(r.top), h: r && Math.round(r.height), stretch: cs && cs.fontStretch, color: cs && cs.color, txW: tx && Math.round(tx.getBoundingClientRect().width),
      boxFill: box && getComputedStyle(box).fill, boxScale: box && getComputedStyle(box).transform, strike: path ? (getComputedStyle(path).strokeDashoffset + '/' + (path.style.strokeDasharray || '-')) : null, connected: row.isConnected });
    if (t < ms) requestAnimationFrame(tick); else res(out);
  };
  requestAnimationFrame(tick);
}), [sel, ms]);

/** Fast clipped screenshots for `n` frames, timestamped. */
async function frames(name, clip, n, gap) {
  const t0 = Date.now(); const ts = [];
  for (let i = 0; i < n; i++) {
    await shot(page, `${tag}-${name}-${String(i).padStart(2, '0')}`, { clip });
    ts.push(Date.now() - t0);
    if (gap) await page.waitForTimeout(gap);
  }
  return ts;
}

// 1) Completing a task (pointer): timeline + frames.
await go(page, '#/n/' + F.q4);
const rowSel = '#outline .row:nth-child(2)';
const rb = await page.locator(rowSel).boundingBox();
const clip = { x: Math.max(0, rb.x - 30), y: rb.y - 10, width: Math.min(560, rb.width + 40), height: rb.height + 60 };
const ck = await page.locator(rowSel + ' .ck').boundingBox();
const samp = sampleRow(rowSel, 1600);
if (dev === 'phone') await page.tap(rowSel + ' .ck'); else await page.mouse.click(ck.x + ck.width / 2, ck.y + ck.height / 2);
log.completeFramesMs = await frames('complete', clip, 14, 0);
log.completeTimeline = await samp;
await page.waitForTimeout(1500);
await shot(page, `${tag}-complete-after1500`, { clip });
// Undo for the next steps
await page.evaluate(() => window.__lists.ui.undo());
await page.waitForTimeout(400);

// 1b) Keyboard completion (x)
if (dev === 'desk') {
  await page.locator(rowSel + ' .tx').click(); await page.keyboard.press('Escape');
  const s2 = sampleRow(rowSel, 600);
  await page.keyboard.press('x');
  log.keyTimeline = await s2;
  await page.evaluate(() => window.__lists.ui.undo()); await page.waitForTimeout(300);
}

// 2) Zoom into a page (pointer on the count): View Transition animations + slowed frames.
await go(page, '#/n/' + F.home);
const ct = await page.locator('#outline .row:nth-child(1) .ct').boundingBox();
await cdp.send('Animation.enable');
await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.2 });
if (dev === 'phone') await page.tap('#outline .row:nth-child(1) .ct'); else await page.mouse.click(ct.x + ct.width / 2, ct.y + ct.height / 2);
await page.waitForTimeout(30);
log.vtAnimations = await page.evaluate(() => document.getAnimations().map((a) => ({ target: a.effect && a.effect.pseudoElement, name: a.animationName, dur: a.effect.getTiming().duration, easing: a.effect.getTiming().easing, kf: (() => { try { return a.effect.getKeyframes().map((k) => ({ o: k.offset, opacity: k.opacity, transform: k.transform })); } catch { return null; } })() })));
const vp = page.viewportSize();
log.zoomFramesMs = await frames('zoom', { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, 620) }, 10, 120);
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
await page.waitForTimeout(800);
await shot(page, `${tag}-zoom-end`);

// 3) Today is clear: complete every Today item by pointer, capture the moment.
await go(page, '#/today', 600);
const n = await page.locator('#outline .row:not(.done)').count();
for (let i = 0; i < n - 1; i++) {
  const sel = '#outline .row:not(.done) .ck';
  await page.evaluate(() => window.__lists.DB.setMeta('clearedOn', null));
  if (dev === 'phone') await page.locator(sel).first().tap(); else await page.locator(sel).first().click();
  await page.waitForTimeout(260);
}
await page.waitForTimeout(400);
await shot(page, `${tag}-clear-before`);
const last = page.locator('#outline .row:not(.done) .ck').first();
if (dev === 'phone') await last.tap(); else await last.click();
const t0 = Date.now(); log.clearFramesMs = [];
for (let i = 0; i < 8; i++) { await shot(page, `${tag}-clear-${String(i).padStart(2, '0')}`); log.clearFramesMs.push(Date.now() - t0); await page.waitForTimeout(150); }
await page.waitForTimeout(1500);
await shot(page, `${tag}-clear-rest`);
log.clearState = await page.evaluate(() => ({ cleared: document.body.classList.contains('cleared'), canvas: !!document.querySelector('canvas'), empty: document.querySelector('#empty').textContent, rows: document.querySelectorAll('#outline .row').length, strikes: document.querySelectorAll('#outline svg.strike').length }));
await writeFile(join(OUT, `${tag}.json`), JSON.stringify(log, null, 1));
await browser.close();
console.log('done', tag);
