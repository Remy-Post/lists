// connector.mjs — Settings → "Claude & Grok" (docs/MCP-PLAN.md §6, §10) against stubbed /mcp-admin/* replies.
// Real Chromium, a real sync server for "Connect turns on backup", both themes, the S25 and Mac viewports.
// Usage: node tests/e2e/connector.mjs      env: NO_BUILD=1
// Output: console PASS/FAIL lines + tests/e2e/out/connector.json, screenshots in tests/e2e/out/connector-*.png
import { chromium } from 'playwright';
import { join } from 'node:path';
import { build, startStatic, startSync, ready, app, killAll, checker, CHROME_ARGS, OUT } from './lib.mjs';

const MAC = { viewport: { width: 1728, height: 1000 }, deviceScaleFactor: 2 };
const S25 = { viewport: { width: 412, height: 891 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true };
const URL_MCP = 'https://lists.remypost.me/mcp';
const C = checker('connector');

build();
const sy = await startSync(8091);
const srv = await startStatic(8090, 8091);
const browser = await chromium.launch({ args: CHROME_ARGS });

/** A page whose /mcp-admin/* answers come from `bridge` (mutable), recording every request it sees. */
async function open(dev, bridge) {
  const ctx = await browser.newContext({ ...dev, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [], seen = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/mcp-admin/**', (route) => {
    const req = route.request(), op = new URL(req.url()).pathname.split('/').pop();
    seen.push({ op, method: req.method(), body: req.postDataJSON?.() ?? null });
    const ans = bridge[op] ? bridge[op]() : [404, { error: 'not found' }];
    if (ans === 'abort') return route.abort(); // unreachable: admin() resolves { status: 0 }
    const [status, body] = ans;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(srv.url + '/#/inbox');
  await ready(page);
  return { ctx, page, errors, seen };
}
const settings = async (page) => {
  await app(page, (S, O, A, DB, st, ui) => ui.closeAll());
  await page.waitForFunction(() => !document.querySelector('.settings')); // the old sheet animates out first
  await app(page, (S, O, A, DB, st, ui) => { ui.settings(); });
  await page.waitForFunction(() => { const m = document.querySelector('.settings .mcp'); return m && !/Checking/.test(m.innerText) && !m.querySelector('button:disabled'); });
};
const text = (page) => page.evaluate(() => document.querySelector('.settings').innerText);
const mcpText = (page) => page.evaluate(() => document.querySelector('.settings .mcp').innerText);
const clickMcp = async (page, label) => {
  await page.locator('.settings .mcp button', { hasText: label }).click();
  await page.waitForFunction(() => !document.querySelector('.settings .mcp button:disabled'));
};
const status = (connected) => () => [200, { connected, lastSync: connected ? Date.now() : null, url: URL_MCP }];

// 1. Every state renders in both themes without stray "null"/"undefined", with the address and how-tos when connected.
const bgs = {};
for (const [dev, name] of [[S25, 'phone'], [MAC, 'mac']]) for (const theme of ['paper', 'graphite']) {
  await C.step(`${name} ${theme}`, async () => {
    const bridge = { status: status(false) };
    const { ctx, page, errors } = await open(dev, bridge);
    await app(page, (S, O, A, DB, st, ui, t) => ui.setTheme(t), theme);
    (bgs[name] ||= {})[theme] = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    await settings(page);
    let t = await text(page);
    C.ok(/Claude & Grok/.test(t) && /Connect Claude & Grok/.test(t) && /turns on backup/.test(t) && !/\b(null|undefined)\b/.test(t), `${name} ${theme}: backup off shows one sentence and Connect`, (await mcpText(page)).replace(/\n+/g, ' | '));
    // Connected (to an account that isn't on this device): address, how-tos, warning, no Disconnect.
    bridge.status = status(true);
    await settings(page);
    t = await mcpText(page);
    C.ok(t.includes(URL_MCP) && /Settings → Connectors → Add custom connector/.test(t) && /Remote HTTPS/.test(t) && /Anyone with this address can read and change your lists\./.test(t) && !/Disconnect/.test(t) && !/\b(null|undefined)\b/.test(t),
      `${name} ${theme}: connected shows the address, both how-tos and the warning`, t.replace(/\n+/g, ' | '));
    const look = await page.evaluate(() => {
      const box = document.querySelector('.settings .mcp');
      const btns = [...box.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height));
      const code = getComputedStyle(box.querySelector('.code'));
      return { btns, codeBg: code.backgroundColor, ink: getComputedStyle(box).color, upper: [...box.querySelectorAll('*')].some((e) => getComputedStyle(e).textTransform === 'uppercase') };
    });
    C.ok(name !== 'phone' || look.btns.every((x) => x >= 48), `${name} ${theme}: buttons are ≥ 48 px on the phone`, look.btns);
    C.ok(!look.upper, `${name} ${theme}: no all-caps labels`);
    await page.locator('.settings .mcp').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `connector-${name}-${theme}.png`) });
    C.ok(!errors.length, `${name} ${theme}: no page errors`, errors.join(' | '));
    await ctx.close();
  });
}
for (const name in bgs) C.ok(bgs[name].paper !== bgs[name].graphite, `${name}: the two themes really differ`, bgs[name]);

// 2. Connect from backup off: turns backup on (real sync server), then POSTs the pairing code and zone.
await C.step('connect flow', async () => {
  const bridge = { status: status(false), connect: () => [200, { connected: true, url: URL_MCP, tz: 'x' }], disconnect: () => [200, { connected: false }] };
  const { ctx, page, errors, seen } = await open(S25, bridge);
  await settings(page);
  await clickMcp(page, 'Connect Claude & Grok');
  const code = await app(page, (S, O, A, DB, st, ui) => ui.pairingCode());
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const post = seen.find((x) => x.op === 'connect');
  C.ok(code && post && post.method === 'POST' && post.body.code === code && post.body.tz === tz, 'Connect turns backup on, then POSTs {code, tz}', post && { ...post.body, code: post.body.code === code ? 'matches' : post.body.code });
  let t = await mcpText(page);
  C.ok(t.includes(URL_MCP) && /Disconnect/.test(t), 'connected view with Disconnect after Connect', t.replace(/\n+/g, ' | '));
  C.ok(await page.evaluate(() => document.activeElement && document.activeElement.textContent === 'Copy'), 'focus lands on Copy');
  C.ok(/Encrypted backup is on/.test(await text(page)), 'the backup section now says backup is on');

  await clickMcp(page, 'Disconnect');
  const d = seen.find((x) => x.op === 'disconnect');
  C.ok(d && JSON.stringify(Object.keys(d.body)) === '["code"]' && d.body.code === code, 'Disconnect POSTs {code}');
  C.ok(/Connect Claude & Grok/.test(await mcpText(page)) && !/turns on backup/.test(await mcpText(page)), 'back to Connect (backup stays on)');

  // 3. Errors are inline and in plain words.
  bridge.connect = () => [403, { error: 'This connector belongs to another Lists account' }];
  await clickMcp(page, 'Connect Claude & Grok');
  t = await mcpText(page);
  C.ok(/linked to a different Lists account/.test(t) && /pair this device with that account/.test(t) && await page.locator('.settings .mcp [role=alert]').count() === 1, '403 shows the plain-words error inline, with the way out', t.replace(/\n+/g, ' | '));
  C.ok(!/Connect Claude & Grok/.test(t), 'after a 403 Connect is not offered again until the next status check', t.replace(/\n+/g, ' | '));
  bridge.connect = () => [502, { error: 'sync unreachable' }];
  await settings(page);
  await clickMcp(page, 'Connect Claude & Grok');
  C.ok(/couldn’t reach your backup/.test(await mcpText(page)), '502 shows its own error');
  C.ok(!errors.length, 'no page errors', errors.join(' | '));
  await ctx.close();
});

// 4. Turn off backup while connected: the confirm says so, and disconnect goes out before the code is forgotten.
await C.step('turn off', async () => {
  const bridge = { status: status(true), disconnect: () => [200, { connected: false }] };
  const { ctx, page, errors, seen } = await open(MAC, bridge);
  const code = await app(page, async (S, O, A, DB, st, ui) => { await ui.createVault(); return ui.pairingCode(); });
  await settings(page);
  let msg = '';
  page.once('dialog', (dlg) => { msg = dlg.message(); dlg.accept(); });
  await page.locator('.settings button', { hasText: 'Turn off' }).click();
  await page.waitForFunction(() => /Turn on backup/.test(document.querySelector('.settings').innerText));
  const d = seen.find((x) => x.op === 'disconnect');
  C.ok(/also disconnects Claude & Grok/.test(msg), 'confirm text says it also disconnects Claude & Grok', msg);
  C.ok(d && d.body.code === code, 'disconnect was sent with the code', d && Object.keys(d.body));
  C.ok(!(await app(page, (S, O, A, DB, st, ui) => ui.pairingCode())), 'then backup is off');

  // Disconnect fails (offline): backup stays on and the error says why.
  await app(page, (S, O, A, DB, st, ui) => ui.createVault());
  bridge.disconnect = () => [500, {}];
  await settings(page);
  page.once('dialog', (dlg) => dlg.accept());
  await page.locator('.settings button', { hasText: 'Turn off' }).click();
  await page.waitForFunction(() => /backup is still on/.test(document.querySelector('.settings').innerText));
  C.ok(!!(await app(page, (S, O, A, DB, st, ui) => ui.pairingCode())), 'a failed disconnect keeps backup on (the off switch stays reachable)');

  // Not connected: the plain confirm.
  bridge.status = status(false);
  await settings(page);
  page.once('dialog', (dlg) => { msg = dlg.message(); dlg.dismiss(); });
  await page.locator('.settings button', { hasText: 'Turn off' }).click();
  await page.waitForTimeout(200);
  C.ok(!/Claude/.test(msg), 'not connected: the confirm does not mention Claude & Grok', msg);
  C.ok(!errors.length, 'no page errors', errors.join(' | '));
  await ctx.close();
});

// 4b. Status unknown (502 or unreachable): never shown as "not connected", and Turn off still disconnects first
// (finding: a failed status check made Turn off forget the only code that can switch the bridge off).
await C.step('turn off with status unknown', async () => {
  for (const fail of [() => [502, {}], () => 'abort']) {
    const bridge = { status: fail, disconnect: fail };
    const { ctx, page, errors, seen } = await open(S25, bridge);
    const code = await app(page, async (S, O, A, DB, st, ui) => { await ui.createVault(); return ui.pairingCode(); });
    await settings(page);
    const t = await mcpText(page);
    C.ok(/Couldn’t check Claude & Grok/.test(t) && !/Connect Claude & Grok/.test(t) && /Try again/.test(t), 'unknown status: its own state, no Connect', t.replace(/\n+/g, ' | '));
    let msg = '';
    page.once('dialog', (dlg) => { msg = dlg.message(); dlg.accept(); });
    await page.locator('.settings button', { hasText: 'Turn off' }).click();
    await page.waitForFunction(() => /backup is still on/.test(document.querySelector('.settings').innerText));
    C.ok(/also disconnects Claude & Grok/.test(msg), 'unknown status: the confirm mentions Claude & Grok', msg);
    C.ok(seen.some((x) => x.op === 'disconnect'), 'unknown status: disconnect is attempted', seen.map((x) => x.op));
    C.ok((await app(page, (S, O, A, DB, st, ui) => ui.pairingCode())) === code, 'a failed disconnect keeps the pairing code');
    const where = await page.evaluate(() => {
      const e = document.querySelector('.settings .err[role=alert]');
      const r = e && e.getBoundingClientRect();
      return { inBackup: !!e && !e.closest('.mcp') && !!e.closest('.sblock').querySelector('[data-turnoff]'), focus: document.activeElement && document.activeElement.hasAttribute('data-turnoff'), visible: !!r && r.top >= 0 && r.bottom <= innerHeight };
    });
    C.ok(where.inBackup && where.focus && where.visible, 'the Turn off error sits by its button, in view, and focus stays on Turn off', where);
    // A 403 (nothing of ours there) lets Turn off go ahead.
    bridge.disconnect = () => [403, { error: 'This connector belongs to another Lists account' }];
    page.once('dialog', (dlg) => dlg.accept());
    await page.locator('.settings button', { hasText: 'Turn off' }).click();
    await page.waitForFunction(() => /Turn on backup/.test(document.querySelector('.settings').innerText));
    C.ok(!(await app(page, (S, O, A, DB, st, ui) => ui.pairingCode())), 'disconnect 403 with unknown status: backup turns off');
    C.ok(!errors.length, 'no page errors', errors.join(' | '));
    await ctx.close();
  }
});

// 5. Time zone: a visible, paired app re-sends it once per visible session while connected.
await C.step('tz', async () => {
  const bridge = { status: status(true), tz: () => [200, { tz: 'x' }] };
  const { ctx, page, seen } = await open(MAC, bridge);
  await app(page, (S, O, A, DB, st, ui) => ui.createVault());
  await page.reload(); await ready(page);
  await page.waitForTimeout(2500); // boot sync check runs at 1.5 s
  const n = seen.filter((x) => x.op === 'tz').length;
  await app(page, (S, O, A) => { A.createAt('inbox', 0, { title: 'an edit asks for a sync check' }); });
  await page.waitForTimeout(2500);
  C.ok(n === 1 && seen.filter((x) => x.op === 'tz').length === 1, 'tz sent once on open while connected', seen.map((x) => x.op));
  await ctx.close();
});

await browser.close();
const failed = C.summary();
C.save('connector.json');
killAll();
process.exit(failed ? 1 : 0);
