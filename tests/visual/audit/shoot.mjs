// shoot.mjs — static captures for the visual audit, both devices × both schemes.
// Usage: node tests/visual/audit/shoot.mjs [phone|desk] [light|dark]   (server: node tests/harness/serve.mjs dist 8085)
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, openSeeded, go, fx, shot, contrastScan, targetScan, alignScan, OUT } from './lib.mjs';

const devs = process.argv[2] ? [process.argv[2]] : ['phone', 'desk'];
const schemes = process.argv[3] ? [process.argv[3]] : ['light', 'dark'];
const browser = await launch();
const report = {};

for (const dev of devs) for (const scheme of schemes) {
  const tag = `${dev}-${scheme}`;
  const R = (report[tag] = { contrast: {}, targets: {}, align: {}, overflow: {}, errors: [] });
  const { ctx, page, fonts } = await openSeeded(browser, dev, scheme);
  R.fonts = fonts;
  const F = await fx(page);
  const phone = dev === 'phone';
  const step = async (name, fn) => { try { await fn(); } catch (e) { R.errors.push(name + ': ' + e.message.split('\n')[0]); console.log(tag, name, 'FAILED', e.message.split('\n')[0]); } };
  // Layers: capture as shipped, then with the panel's resting transform forced to none (the .lyr.in specificity bug,
  // see 04-visual-audit.md S1-1) so the sheet/modal itself can be judged.
  const layerShot = async (name) => {
    await shot(page, `${tag}-${name}`);
    const moved = await page.evaluate(() => { let n = 0; for (const p of document.querySelectorAll('.lyr.in .panel')) { if (getComputedStyle(p).transform !== 'none') { p.style.transform = 'none'; n++; } } return n; });
    if (moved) { await page.waitForTimeout(400); await shot(page, `${tag}-${name}-patched`); }
    await measure(name);
  };
  const measure = async (name) => {
    R.contrast[name] = await page.evaluate(contrastScan);
    if (phone) R.targets[name] = await page.evaluate(targetScan, 48);
    R.overflow[name] = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
  };

  for (const [name, hash] of [['today', '#/today'], ['upcoming', '#/upcoming'], ['inbox', '#/inbox'], ['logbook', '#/logbook'], ['trash', '#/trash'], ['someday', '#/someday'],
    ['list-home', '#/n/' + F.home], ['list-q4', '#/n/' + F.q4], ['deep-hardware', '#/n/' + F.hw], ['deep-soft', '#/n/' + F.soft]]) {
    await step(name, async () => {
      await go(page, hash);
      await shot(page, `${tag}-${name}`);
      if (['today', 'list-home', 'deep-soft', 'upcoming'].includes(name)) await shot(page, `${tag}-${name}-full`, { full: true });
      await measure(name);
      if (['today', 'list-home', 'inbox'].includes(name)) R.align[name] = await page.evaluate(alignScan);
    });
  }
  // Empty states: an empty list page + empty Today
  await step('empty-list', async () => {
    const id = await page.evaluate(() => window.__lists.A.newList('Packing for Lisbon'));
    await go(page, '#/n/' + id); await shot(page, `${tag}-empty-list`); await measure('empty-list');
    await page.evaluate((id) => window.__lists.A.trash([id]), id);
  });

  // Completed row with the strike, zoomed (crop).
  await step('strike-crop', async () => {
    await go(page, '#/n/' + F.cab);
    const b = await page.locator('#outline').boundingBox();
    await shot(page, `${tag}-strike-crop`, { clip: { x: b.x - 20, y: b.y - 4, width: Math.min(560, b.width + 40), height: Math.min(260, b.height + 8) } });
  });

  // Inspector
  await step('inspector', async () => {
    await go(page, '#/n/' + F.home);
    const id = await page.evaluate(() => [...document.querySelectorAll('#outline .row')].find((r) => r.textContent.includes('Countertop')).dataset.id);
    await page.evaluate((id) => { window.__lists.st.cursor = id; window.__lists.ui.openInsp(id); }, id);
    await page.waitForTimeout(450);
    await layerShot('inspector');
  });
  // Date picker
  await step('datepicker', async () => {
    await go(page, '#/n/' + F.q4);
    const row = page.locator('#outline .row').nth(1);
    await page.evaluate(() => { const r = document.querySelectorAll('#outline .row')[1]; window.__lists.ui.datePicker([r.dataset.id], 'when', r.querySelector('.tl')); });
    await page.waitForTimeout(400);
    await layerShot('datepicker');
    await page.keyboard.type('next fri');
    await page.waitForTimeout(250);
    await layerShot('datepicker-typed');
  });
  // Palette
  await step('palette', async () => {
    await go(page, '#/today');
    await page.evaluate(() => window.__lists.ui.palette('all'));
    await page.waitForTimeout(350);
    await layerShot('palette');
    await page.keyboard.type('hin');
    await page.waitForTimeout(250);
    await layerShot('palette-search');
  });
  // Composer with highlighted tokens
  await step('composer', async () => {
    await go(page, '#/today');
    await page.evaluate(() => window.__lists.ui.compose());
    await page.waitForTimeout(350);
    await layerShot('composer-empty');
    await page.keyboard.type('Call Ana about the deposit fri 3pm !! #q4 @phone');
    await page.waitForTimeout(250);
    await layerShot('composer');
    await page.evaluate(() => { const i = document.querySelector('.qa-in'); i.value = ''; i.dispatchEvent(new Event('input')); });
  });
  // Settings + cheat sheet
  await step('settings', async () => {
    await go(page, '#/today');
    await page.evaluate(() => window.__lists.ui.settings());
    await page.waitForTimeout(500);
    await layerShot('settings');
  });
  await step('cheat', async () => {
    await go(page, '#/today');
    await page.evaluate(() => window.__lists.ui.cheat());
    await page.waitForTimeout(400);
    await layerShot('cheat');
  });

  if (phone) {
    await step('drawer', async () => {
      await go(page, '#/n/' + F.home);
      await page.tap('#menuBtn');
      await page.waitForTimeout(450);
      await shot(page, `${tag}-drawer`); await measure('drawer');
      await page.tap('#scrimSide', { position: { x: 400, y: 400 } }).catch(() => {});
    });
    await step('accessory', async () => {
      await go(page, '#/n/' + F.q4);
      await page.locator('#outline .row .tx').nth(2).tap();
      await page.waitForTimeout(400);
      await shot(page, `${tag}-accessory`); await measure('accessory');
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForTimeout(200);
    });
    await step('swipe', async () => {
      await go(page, '#/today');
      for (const [dir, nm] of [[1, 'swipe-right'], [-1, 'swipe-left']]) {
        const pos = await page.evaluate(() => { const r = document.querySelectorAll('#outline .row')[2].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await page.evaluate(([p, dir]) => {
          const row = document.querySelectorAll('#outline .row')[2];
          const ev = (t, x, tgt = window) => tgt.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: p.y, bubbles: true, button: 0, buttons: 1 }));
          ev('pointerdown', p.x, row.querySelector('.bd'));
          for (let i = 1; i <= 12; i++) ev('pointermove', p.x + dir * i * 10);
        }, [pos, dir]);
        await page.waitForTimeout(120);
        await shot(page, `${tag}-${nm}`);
        await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch' })));
        await page.waitForTimeout(300);
      }
    });
  } else {
    await step('drag', async () => {
      await go(page, '#/n/' + F.home);
      const rows = page.locator('#outline .row');
      const b = await rows.nth(14).boundingBox(); // a leaf row
      const x = b.x + 8, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 10, y - 20, { steps: 3 });
      await page.mouse.move(x + 40, y - 150, { steps: 8 });
      await page.waitForTimeout(200);
      await shot(page, `${tag}-drag`);
      // Over a sidebar list
      const li = await page.locator('.side-lists .li').nth(2).boundingBox();
      await page.mouse.move(li.x + 60, li.y + li.height / 2, { steps: 8 });
      await page.waitForTimeout(150);
      await shot(page, `${tag}-drag-sidebar`);
      await page.keyboard.press('Escape');
      await page.mouse.move(x + 40, y - 150, { steps: 4 });
      await page.mouse.move(x, y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    });
    await step('hover-focus', async () => {
      await go(page, '#/n/' + F.q4);
      const rows = page.locator('#outline .row');
      await rows.nth(1).locator('.tx').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('j');
      await page.keyboard.press('Shift+j');
      const b = await rows.nth(5).boundingBox();
      await page.mouse.move(b.x + b.width - 40, b.y + b.height / 2);
      await page.waitForTimeout(200);
      await shot(page, `${tag}-focus-hover`);
      const ob = await page.locator('.sheet').boundingBox();
      await shot(page, `${tag}-focus-hover-crop`, { clip: { x: ob.x, y: ob.y + 40, width: ob.width, height: 520 } });
    });
    await step('toast', async () => {
      await go(page, '#/inbox');
      await page.evaluate(() => window.__lists.ui.toast('Moved to Trash', { undo: true, ms: 8000 }));
      await page.waitForTimeout(400);
      await shot(page, `${tag}-toast`); await measure('toast');
    });
  }
  // Debug clear moment
  await step('debug-clear', async () => {
    await page.goto(page.url().split('#')[0] + '#/debug/clear');
    await page.waitForFunction(() => window.__lists);
    await page.waitForTimeout(1800);
    await shot(page, `${tag}-debug-clear`);
    await page.goto(page.url().split('#')[0] + '#/today');
    await page.waitForFunction(() => window.__lists);
    await page.waitForTimeout(500);
  });
  await ctx.close();
  console.log('done', tag, R.errors.length ? R.errors : '');
}
await writeFile(join(OUT, `report-${devs.join('_')}-${schemes.join('_')}.json`), JSON.stringify(report, null, 1));
await browser.close();
