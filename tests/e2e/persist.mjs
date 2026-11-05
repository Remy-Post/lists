// persist.mjs — does an edit survive a hard kill of the browser?
// Chromium is launched as our own child process (own process group) on a persistent --user-data-dir and
// driven over CDP, so we can SIGKILL the whole group (browser, renderer, storage/network services) the way
// an OS kills an app — not Playwright's graceful close. Then we relaunch on the same profile and look.
// Usage: node tests/e2e/persist.mjs [runs=10]   env: DELAYS="0,150,300,1000" CASES="delay,hidden,freeze,stream,draft,tabs"
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, startStatic, ready, sleep, killAll, tmpProfile, checker, OUT } from './lib.mjs';

const RUNS = +(process.argv[2] || 10);
const DELAYS = (process.env.DELAYS || '0,150,300,1000').split(',').map(Number);
const CASES = (process.env.CASES || 'delay,hidden,freeze,stream,draft,tabs').split(',');
const EXE = chromium.executablePath();

async function launch(dir) {
  const port = join(dir, 'DevToolsActivePort');
  if (existsSync(port)) rmSync(port);
  const p = spawn(EXE, [
    '--headless=new', '--no-sandbox', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1728,1000', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  const end = Date.now() + 15000;
  while (!existsSync(port) || !readFileSync(port, 'utf8').includes('\n')) { if (Date.now() > end) throw new Error('chromium did not start'); await sleep(50); }
  const wsPort = readFileSync(port, 'utf8').split('\n')[0];
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${wsPort}`);
  const ctx = browser.contexts()[0];
  return { p, browser, ctx };
}
function hardKill(b) {
  try { process.kill(-b.p.pid, 'SIGKILL'); } catch { try { b.p.kill('SIGKILL'); } catch {} }
  return new Promise((r) => { if (b.p.exitCode !== null || b.p.signalCode) r(); else b.p.once('exit', r); setTimeout(r, 3000); });
}
async function openApp(ctx, base, hash = '#/inbox') {
  const page = ctx.pages().find((p) => p.url() === 'about:blank') || await ctx.newPage();
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.goto(base + '/' + hash);
  await ready(page);
  return page;
}
/** First launch of a profile: boot, let the service worker take control and the app reload once, settle. */
async function prime(base) {
  const dir = tmpProfile('persist');
  const b = await launch(dir);
  const page = await openApp(b.ctx, base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
  await sleep(1200);
  await ready(page);
  return { dir, b, page };
}
async function readBack(dir, base) {
  const b = await launch(dir);
  const page = await openApp(b.ctx, base);
  await sleep(300);
  const data = await page.evaluate(() => {
    const { S, DB } = window.__lists;
    const out = [];
    for (const [id] of S.recs) if (S.isLive(id)) out.push({ id, title: S.val(id, 'title'), parent: S.parentOf(id), when: S.val(id, 'when') });
    return { recs: out, draft: DB.getMeta('draft') || '' };
  });
  await b.browser.close().catch(() => {});
  await hardKill(b);
  return data;
}
const byTitle = (d, re) => d.recs.find((r) => re.test(r.title));

/* --- edit scripts (real keyboard input) --- */
async function editBurst(page, tag) {
  // New item A under the first Inbox row, Enter → new item B, Tab nests B under A. Last keystroke = Tab... then 2 chars.
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await page.keyboard.press('o');
  await page.keyboard.type(`A-${tag}`, { delay: 15 });
  await page.keyboard.press('Enter');
  await page.keyboard.type(`B-${tag}`, { delay: 15 });
  await page.keyboard.press('Tab');
  await page.keyboard.type('!z', { delay: 15 });
}
function judgeBurst(d, tag) {
  const a = byTitle(d, new RegExp(`^A-${tag}$`));
  const b = byTitle(d, new RegExp(`^B-${tag}`));
  return { newItem: !!a, fullTitle: !!b && b.title.startsWith(`B-${tag}!z`), indent: !!a && !!b && b.parent === a.id, title: b && b.title };
}

const results = {};
const C = checker('persist');
build();
const st = await startStatic(8097);

// 1. Delay after the last keystroke, then SIGKILL.
if (CASES.includes('delay')) for (const delay of DELAYS) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) {
    const tag = `d${delay}r${i}`;
    const { dir, b, page } = await prime(st.url);
    await editBurst(page, tag);
    await sleep(delay);
    await hardKill(b);
    const d = await readBack(dir, st.url);
    const j = judgeBurst(d, tag);
    rs.push(j);
    rmSync(dir, { recursive: true, force: true });
  }
  const ok = rs.filter((r) => r.newItem && r.fullTitle && r.indent).length;
  results['delay' + delay] = { runs: rs.length, survived: ok, detail: rs };
  console.log(`delay ${delay} ms: ${ok}/${rs.length} survived  (new ${rs.filter((r) => r.newItem).length}, full title ${rs.filter((r) => r.fullTitle).length}, indent ${rs.filter((r) => r.indent).length})`);
  if (delay >= 300) C.ok(ok === rs.length, `SIGKILL ${delay} ms after the last keystroke: 100% survive`, `${ok}/${rs.length}`);
}

// 2. Hidden-page flush: type, 20 ms later the page becomes hidden (visibilitychange), kill 60 ms after that.
//    Control: identical timing without the hidden event (the 250 ms batch has not fired yet, so it should be lost).
async function hiddenCase(kind) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) {
    const tag = `${kind}${i}`;
    const { dir, b, page } = await prime(st.url);
    await editBurst(page, tag);
    await sleep(450);                       // everything so far is flushed; the batch timer is idle
    await page.keyboard.type('Q');          // one fresh keystroke that only a flush can save in 80 ms
    await sleep(20);
    if (kind === 'hidden') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } else if (kind === 'freeze') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch((e) => console.log('   setWebLifecycleState:', e.message.split('\n')[0]));
    }
    await sleep(60);
    await hardKill(b);
    const d = await readBack(dir, st.url);
    const j = judgeBurst(d, tag);
    j.lastKey = !!j.title && j.title.endsWith('!zQ');
    rs.push(j);
    rmSync(dir, { recursive: true, force: true });
  }
  const ok = rs.filter((r) => r.newItem && r.indent && r.lastKey).length;
  results[kind] = { runs: rs.length, survived: ok, detail: rs };
  console.log(`${kind}: ${ok}/${rs.length} survived`);
  return ok / rs.length;
}
if (CASES.includes('hidden')) {
  const h = await hiddenCase('hidden');
  const c = await hiddenCase('control');
  C.ok(h === 1, 'visibilitychange:hidden flushes before a kill 60 ms later: 100% survive', `${Math.round(h * 100)}% (control without the event: ${Math.round(c * 100)}%)`);
}
if (CASES.includes('freeze')) {
  const f = await hiddenCase('freeze');
  C.ok(f === 1, 'CDP Page.setWebLifecycleState frozen flushes before a kill 60 ms later', `${Math.round(f * 100)}%`);
}

// 3. Continuous typing: one char every 60 ms for ~4 s, kill mid-stream. Everything typed ≥ 1,000 ms before the kill must survive.
if (CASES.includes('stream')) {
  const rs = [];
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const { dir, b, page } = await prime(st.url);
    await page.keyboard.press('Escape'); await page.keyboard.press('j'); await page.keyboard.press('o');
    const typed = []; // [char, time]
    const text = 'the quick brown fox jumps over the lazy dog 0123456789 '.repeat(2);
    const killAt = Date.now() + 3000 + Math.floor(Math.random() * 1000);
    for (const ch of text) { if (Date.now() >= killAt) break; await page.keyboard.type(ch); typed.push([ch, Date.now()]); await sleep(60); }
    const tKill = Date.now();
    await hardKill(b);
    const mustHave = typed.filter(([, t]) => t <= tKill - 1000).map(([c]) => c).join('');
    const all = typed.map(([c]) => c).join('');
    const d = await readBack(dir, st.url);
    const got = d.recs.map((r) => r.title).find((t) => t && all.startsWith(t.slice(0, 10)) && t.length >= 1) || '';
    rs.push({ typed: all.length, mustHave: mustHave.length, got: got.length, ok: got.startsWith(mustHave) && all.startsWith(got), lostMs: typed.length ? tKill - (typed[got.length - 1]?.[1] || typed[0][1]) : null });
    rmSync(dir, { recursive: true, force: true });
  }
  results.stream = rs;
  console.log('stream:', rs.map((r) => `${r.got}/${r.typed} chars (needed ${r.mustHave}, lost window ${r.lostMs} ms)`).join(' · '));
  C.ok(rs.every((r) => r.ok), 'continuous typing: everything typed ≥ 1 s before the kill survives', rs.map((r) => r.ok ? 'ok' : 'LOST').join(','));
}

// 4. Quick-add draft: q, type, wait 400 ms, kill; the draft should come back.
if (CASES.includes('draft')) {
  const rs = [];
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const { dir, b, page } = await prime(st.url);
    await page.keyboard.press('Escape');
    await page.keyboard.press('q');
    await page.waitForSelector('.qa-in');
    await page.keyboard.type(`draft ${i} call ana fri`, { delay: 15 });
    await sleep(400);
    await hardKill(b);
    const d = await readBack(dir, st.url);
    rs.push(d.draft === `draft ${i} call ana fri`);
    rmSync(dir, { recursive: true, force: true });
  }
  results.draft = rs;
  C.ok(rs.every(Boolean), 'quick-add draft survives a kill 400 ms after typing', `${rs.filter(Boolean).length}/${rs.length}`);
}

// 5. Two tabs of the same profile: tab A edits a title, tab B edits the same item's date; kill; both present.
if (CASES.includes('tabs')) {
  const rs = [];
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const { dir, b, page } = await prime(st.url);
    const pageB = await b.ctx.newPage();
    await pageB.setViewportSize({ width: 1728, height: 1000 });
    await pageB.goto(st.url + '/#/inbox'); await ready(pageB);
    const id = await page.evaluate(() => window.__lists.S.children('inbox')[1]);
    // A: edit the title with the keyboard.
    await page.bringToFront();
    await page.locator(`.row[data-id="${id}"] .tx`).click();
    await page.keyboard.press('End');
    await page.keyboard.type(` tabA${i}`, { delay: 15 });
    // B: schedule tomorrow via the t date picker.
    await pageB.bringToFront();
    await pageB.locator(`.row[data-id="${id}"]`).click({ position: { x: 4, y: 10 } });
    await pageB.keyboard.press('Escape');
    await pageB.evaluate((x) => window.__lists.ui.focus(x), id);
    await pageB.keyboard.press('t');
    await pageB.waitForSelector('.dp-in');
    await pageB.keyboard.type('tomorrow');
    await pageB.keyboard.press('Enter');
    await sleep(700);
    await hardKill(b);
    const d = await readBack(dir, st.url);
    const r = d.recs.find((x) => x.id === id);
    rs.push({ title: !!r && r.title.endsWith(` tabA${i}`), when: !!r && !!r.when, got: r });
    rmSync(dir, { recursive: true, force: true });
  }
  results.tabs = rs;
  C.ok(rs.every((r) => r.title && r.when), 'two tabs editing different fields of one item: both edits survive a kill', rs.map((r) => `title:${r.title} when:${r.when}`).join(' | '));
}

writeFileSync(join(OUT, 'persist.json'), JSON.stringify({ when: new Date().toISOString(), runs: RUNS, results, checks: C.results }, null, 2));
const fails = C.summary();
killAll();
process.exit(fails ? 1 : 0);
