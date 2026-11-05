// lib.mjs — shared helpers for the visual audit (docs/audits/04-visual-audit.md).
// Devices, a realistic fixture seeded through window.__lists, and in-page measurement helpers.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const OUT = join(ROOT, 'tests/visual/out/audit');
export const BASE = process.env.BASE || 'http://127.0.0.1:8085';

export const DEVICES = {
  phone: { viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' },
  desk: { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};

export async function launch() {
  await mkdir(OUT, { recursive: true });
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

/** New context + page with the fixture seeded, then a second navigation so the optional fonts are cached. */
export async function openSeeded(browser, dev, scheme, opts = {}) {
  const ctx = await browser.newContext({ ...DEVICES[dev], colorScheme: scheme, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${dev}/${scheme}] pageerror:`, e.message));
  await page.goto(BASE + '/#/today');
  await page.waitForFunction(() => window.__lists && document.body.classList.contains('ready'));
  await page.evaluate(seed);
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__lists.DB.flush());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.__lists && document.body.classList.contains('ready'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const fonts = await page.evaluate(() => ({ text: document.fonts.check('15px "Mona Sans"'), display: document.fonts.check('640 30px "Mona Display"'),
    loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) }));
  return { ctx, page, fonts };
}

/** Runs in the page. Builds a realistic data set (today is computed by the app). */
export function seed() {
  const { S, O, A } = window.__lists;
  const T = A.today(), D = (n) => A.addDays(T, n);
  const day = 864e5, now = Date.now();
  // Remove the first-run tour.
  A.destroy(S.children(S.INBOX));
  const mk = (parent, title, f = {}) => A.createAt(parent, S.children(parent).length, { title, ...f });
  const done = (id, ago = 0) => O.tx('d', () => O.set(id, { done: true, doneAt: now - ago * day - (ago ? 0 : 60e3) }));

  // Inbox
  mk(S.INBOX, 'Reply to Marguerite about the lease renewal', { notes: 'She needs it signed by the 14th. Ask about the parking spot too.' });
  mk(S.INBOX, 'Book dentist');
  mk(S.INBOX, 'Look into a standing desk for the studio — compare the Jarvis with the Uplift V2 and check whether either fits under the window');
  mk(S.INBOX, 'Pick up dry cleaning', { when: T });
  A.quickAdd('Water the fig every 3 days', { parent: S.INBOX, index: S.children(S.INBOX).length });
  O.tx('w', () => O.set(S.children(S.INBOX).at(-1), { when: T }));

  // Home renovation: 6 levels deep, with headings.
  const home = A.newList('Home renovation');
  const kit = mk(home, 'Kitchen', { notes: 'Budget £18k. Fitter starts 1 December.' });
  const cab = mk(kit, 'Cabinets');
  const hw = mk(cab, 'Hardware');
  const hin = mk(hw, 'Hinges');
  const soft = mk(hin, 'Soft-close or standard?', { notes: 'Blum quoted 14 days lead time; Hettich is cheaper but 3 weeks.' });
  mk(soft, 'Ask the fitter which he prefers');
  mk(soft, 'Price 14 pairs of each', { deadline: D(4) });
  mk(hin, 'Count doors — 14 or 16 with the larder?');
  const pulls = mk(hw, 'Pulls — brushed brass, 128 mm centres');
  done(pulls);
  mk(cab, 'Order sample doors', { when: T, deadline: D(3) });
  const meas = mk(cab, 'Measure the corner unit');
  done(meas);
  mk(kit, 'Countertop quote', { deadline: D(-2), priority: 2 });
  mk(kit, 'Choose backsplash tile', { when: D(6) });
  mk(home, 'Bathroom', { heading: true });
  mk(home, 'Regrout the shower', { priority: 1 });
  mk(home, 'Replace the extractor fan', { when: T, evening: true });
  mk(home, 'Call the electrician about the consumer unit', { when: D(-3) });
  mk(home, 'Garden', { heading: true });
  mk(home, 'Prune the apple tree before the frost', { when: D(10) });

  // Q4 launch
  const q4 = A.newList('Q4 launch');
  mk(q4, 'Draft release notes', { when: T, priority: 3, tags: ['writing'] });
  mk(q4, 'Review pricing page copy', { when: T, notes: 'Legal wants “up to” in front of every saving claim.' });
  mk(q4, 'QA pass on Android', { deadline: T });
  mk(q4, 'Ship beta to testers', { when: D(1) });
  mk(q4, 'Plan launch-day comms', { when: D(2), deadline: D(8) });
  mk(q4, 'Retro', { when: D(14) });
  A.quickAdd('Weekly sync notes every monday', { parent: q4, index: S.children(q4).length });
  const sent = mk(q4, 'Send the investor update');
  done(sent);
  mk(q4, 'Read through the support backlog', { when: T, evening: true, tags: ['support'] });

  // Reading
  const rd = A.newList('Reading');
  done(mk(rd, 'The Design of Everyday Things'), 3);
  done(mk(rd, 'Thinking in Systems'), 1);
  mk(rd, 'A Pattern Language', { someday: true });
  mk(rd, 'Seeing Like a State', { someday: true });

  // Groceries
  const gr = A.newList('Groceries');
  for (const g of ['Oat milk', 'Sourdough', 'Lemons', 'Parmesan']) mk(gr, g);
  done(S.children(gr)[1]);
  done(mk(gr, 'Coffee beans'), 2);

  // Upcoming extras
  mk(S.INBOX, 'Renew passport', { when: D(5), deadline: D(40) });
  mk(S.INBOX, 'Mum’s birthday — book the table', { when: D(20) });

  // Logbook history
  done(mk(S.INBOX, 'Return the router'), 1);
  done(mk(S.INBOX, 'File expenses for October'), 2);
  done(mk(S.INBOX, 'Cancel the gym trial'), 6);

  // Trash
  const t1 = mk(S.INBOX, 'Old idea: weekly newsletter');
  const t2 = mk(gr, 'Kale');
  A.trash([t1]); A.trash([t2]);

  window.__fx = { home, kit, cab, hw, hin, soft, q4, rd, gr };
  window.__lists.DB.setMeta('fx', window.__fx);
}

/** Navigate by hash and settle (view transitions, fonts). */
export async function go(page, hash, wait = 450) {
  await page.evaluate((h) => { window.__lists.ui.closeAll(); window.__lists.ui.closeInsp(); document.body.classList.remove('drawer'); location.hash = h; }, hash);
  await page.waitForTimeout(wait);
  await page.mouse.move(1, 1).catch(() => {});
}
export const fx = (page) => page.evaluate(() => window.__lists.DB.getMeta('fx'));

export async function shot(page, name, o = {}) {
  const p = join(OUT, name + '.png');
  await page.screenshot({ path: p, fullPage: !!o.full, clip: o.clip, animations: o.animations || 'allow' });
  return p;
}

/** In-page: WCAG contrast for every visible text run (and key pseudo-elements). */
export function contrastScan(limit = 4.5) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const c = cv.getContext('2d', { willReadFrequently: true });
  const px = () => [...c.getImageData(0, 0, 1, 1).data];
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.unshift(e);
    c.globalAlpha = 1; c.clearRect(0, 0, 1, 1); c.fillStyle = getComputedStyle(document.documentElement).backgroundColor; c.fillRect(0, 0, 1, 1);
    for (const e of chain) { const cs = getComputedStyle(e); c.globalAlpha = 1; c.fillStyle = cs.backgroundColor; c.fillRect(0, 0, 1, 1); }
    return px();
  };
  const opac = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const desc = (el) => { const parts = []; for (let e = el; e && parts.length < 3 && e !== document.body; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return parts.join(' > '); };
  const out = new Map();
  const test = (el, color, text, pseudo = '') => {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') return;
    const o = opac(el); if (o < 0.05) return;
    const bg = bgOf(el);
    c.globalAlpha = 1; c.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; c.fillRect(0, 0, 1, 1);
    c.globalAlpha = o; c.fillStyle = color; c.fillRect(0, 0, 1, 1);
    const fg = px();
    const k = ratio(fg, bg);
    const key = desc(el) + pseudo + '|' + color;
    if (!out.has(key) || out.get(key).ratio > k) out.set(key, { sel: desc(el) + pseudo, text: text.trim().slice(0, 40), ratio: +k.toFixed(2), fg: `rgb(${fg.slice(0, 3)})`, bg: `rgb(${bg.slice(0, 3)})`, size: cs.fontSize, weight: cs.fontWeight });
  };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || el.closest('svg')) continue; test(el, getComputedStyle(el).color, n.textContent); }
  for (const el of document.querySelectorAll('*')) for (const ps of ['::before', '::after']) {
    const cs = getComputedStyle(el, ps); const ct = cs.content;
    if (!ct || ct === 'none' || ct === 'normal' || ct === '""') continue;
    let txt = ct.startsWith('attr(') ? el.getAttribute(ct.slice(5, -1)) : ct.replace(/^"|"$/g, '');
    if (ct.startsWith('attr')) txt = el.getAttribute(ct.match(/attr\(([^)]+)\)/)?.[1]) || '';
    if (!txt || !txt.trim()) continue;
    test(el, cs.color, txt, ps);
  }
  for (const el of document.querySelectorAll('input, textarea')) { if (!el.value && el.placeholder) test(el, getComputedStyle(el, '::placeholder').color, el.placeholder, '::placeholder'); }
  return [...out.values()].filter((x) => x.ratio < limit).sort((a, b) => a.ratio - b.ratio);
}

/** In-page: interactive elements smaller than min (CSS px), including the .ck::before hit extension. */
export function targetScan(min = 48) {
  const out = [];
  const els = document.querySelectorAll('button, a[href], [role="checkbox"], [role="radio"], input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
    let w = r.width, h = r.height;
    const b = getComputedStyle(el, '::before');
    if (b.content && b.content !== 'none' && b.position === 'absolute') {
      const px = (v) => (v === 'auto' ? 0 : -parseFloat(v) || 0);
      w = r.width + px(b.left) + px(b.right); h = r.height + px(b.top) + px(b.bottom);
    }
    if (w < min || h < min) out.push({ el: el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.'), label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24), w: Math.round(w), h: Math.round(h) });
  }
  const seen = new Map();
  for (const o of out) { const k = o.el + o.w + 'x' + o.h; if (!seen.has(k)) seen.set(k, { ...o, n: 0 }); seen.get(k).n++; }
  return [...seen.values()];
}

/** In-page: alignment of the checkbox centre vs the first text line (x-height centre and line-box centre). */
export function alignScan() {
  const rows = [...document.querySelectorAll('#outline .row')].slice(0, 12);
  return rows.map((row) => {
    const box = row.querySelector('.ck svg')?.getBoundingClientRect();
    const tx = row.querySelector('.tx');
    if (!box || !tx || !tx.firstChild) return null;
    const rg = document.createRange(); rg.setStart(tx.firstChild, 0); rg.setEnd(tx.firstChild, 1);
    const g = rg.getBoundingClientRect();
    const cs = getComputedStyle(tx);
    // x-height centre: draw on a canvas to measure the actual glyph box of "x".
    const cv = document.createElement('canvas').getContext('2d'); cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = cv.measureText('x'), H = cv.measureText('H');
    const baseline = g.top + (g.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const xMid = baseline - m.actualBoundingBoxAscent / 2, capMid = baseline - H.actualBoundingBoxAscent / 2;
    const ckMid = box.top + box.height / 2;
    return { title: tx.textContent.slice(0, 28), ckMid: +ckMid.toFixed(1), xMid: +xMid.toFixed(1), capMid: +capMid.toFixed(1), dX: +(ckMid - xMid).toFixed(1), dCap: +(ckMid - capMid).toFixed(1), rowH: Math.round(row.getBoundingClientRect().height), ckLeft: Math.round(box.left), txLeft: Math.round(g.left) };
  }).filter(Boolean);
}
