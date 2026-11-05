// smoke.mjs — boot the built app in Chromium at both target viewports; report console errors; screenshot.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const OUT = 'tests/e2e/out';
const shots = process.argv.slice(2);
const devices = {
  mac: { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2, hasTouch: false, isMobile: false },
  s25: { viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' },
};
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, dev] of Object.entries(devices)) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...dev, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    await page.goto(BASE + '/#/today', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${name}-${scheme}-today.png` });
    console.log(`${name}/${scheme}: rows=${await page.locator('.row').count()} errors=${errs.length}`);
    errs.slice(0, 8).forEach((e) => console.log('   ', e));
    await ctx.close();
  }
}
await browser.close();
