// connector-e2e.mjs — the whole Claude & Grok path on one machine, nothing stubbed (docs/MCP-PLAN.md §8 gate 3,
// §10): the real sync server, the real bridge (node mcp/server.mjs, temp /data) and the app, all behind the test
// static server, which routes /api, /mcp and /mcp-admin/* the way Caddy does. A real Chromium turns the connector
// on in Settings; an MCP client (raw JSON-RPC over HTTP, as Claude and Grok Bot send it) changes items, and the
// open, visible page on a good link must show each change within 60 s. An edit in the page must reach the next
// tool call within 15 s of the page's push. Disconnect in Settings must stop and wipe the bridge.
// Usage: node tests/e2e/connector-e2e.mjs      env: NO_BUILD=1     (~6 min: the page checks once a minute)
// Output: console PASS/FAIL lines + tests/e2e/out/connector-e2e.json (every measured time)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, startStatic, startSync, ready, app, sleep, killAll, checker, tmpProfile, CHROME_ARGS, ROOT } from './lib.mjs';
import { client } from '../../mcp/test/helpers.mjs';

const SYNC_PORT = 8102, MCP_PORT = 8103, WEB_PORT = 8101;
const PAGE_MS = 60_000, TOOL_MS = 15_000;
const C = checker('connector-e2e');
const times = {};

build();
const sy = await startSync(SYNC_PORT);
process.env.MCP_PORT = String(MCP_PORT); // startStatic passes the environment on to serve.mjs
const web = await startStatic(WEB_PORT, SYNC_PORT);
const data = tmpProfile('mcp-data');

/** The bridge as compose runs it, with its real limits; `PUBLIC_URL` is this origin, so the app's Origin passes. */
function startBridge() {
  const p = spawn(process.execPath, [join(ROOT, 'mcp/server.mjs')], {
    env: { ...process.env, PORT: String(MCP_PORT), LISTS_MCP_BIND: '127.0.0.1', LISTS_MCP_DATA: data, LISTS_SYNC_URL: sy.url, LISTS_TRUSTED_PROXIES: '127.0.0.1', PUBLIC_URL: web.url + '/mcp' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = { p, log: '', exited: new Promise((r) => p.once('exit', (code) => r(code))) };
  process.on('exit', () => { try { p.kill('SIGKILL'); } catch { /* gone */ } });
  return new Promise((res, rej) => {
    const on = (d) => { b.log += d; if (/lists-mcp listening/.test(b.log)) res(b); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    b.exited.then((code) => rej(new Error('bridge exited ' + code + ': ' + b.log)));
  });
}
let bridge = await startBridge();
const mcp = client(web.url, { ua: 'connector-e2e/1' }); // through the static server, as Claude reaches it through Caddy
const tool = async (name, args) => { const r = await mcp.tool(name, args); if (r.isError) throw new Error(`${name}: ${r.text}`); return r.json; };

const browser = await chromium.launch({ args: CHROME_ARGS });
// A zone far from the host's UTC, so "today" on the bridge must come from the page, not from the server clock.
const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, serviceWorkers: 'block', timezoneId: 'Pacific/Auckland' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// A good link: Wi-Fi, no throttling (linkQuality() must say 'good' for the minute check to run).
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });
await page.goto(web.url + '/#/inbox');
await ready(page);

const settings = async () => {
  await app(page, (S, O, A, DB, st, ui) => ui.closeAll());
  await page.waitForFunction(() => !document.querySelector('.settings'));
  await app(page, (S, O, A, DB, st, ui) => { ui.settings(); });
  await page.waitForFunction(() => { const m = document.querySelector('.settings .mcp'); return m && !/Checking/.test(m.innerText) && !m.querySelector('button:disabled'); });
};
const mcpText = () => page.evaluate(() => document.querySelector('.settings .mcp').innerText);
const clickMcp = async (label) => {
  await page.locator('.settings .mcp button', { hasText: label }).click();
  await page.waitForFunction(() => !document.querySelector('.settings .mcp button:disabled'));
};
/** Show the Inbox outline (a first visit lands on Today, where the tour is). */
const toInbox = async () => {
  await page.evaluate(() => { location.hash = '#/inbox'; });
  await page.waitForFunction(() => window.__lists.st.route.view === 'inbox');
};
/** Poll the open page until check(S, arg) is truthy; → ms from `t0`, or Infinity after PAGE_MS. */
async function seenByPage(label, t0, check, arg) {
  while (Date.now() - t0 < PAGE_MS + 5000) {
    if (await page.evaluate(([src, a]) => new Function('S', 'a', 'return (' + src + ')(S, a)')(window.__lists.S, a), [check.toString(), arg])) {
      const ms = Date.now() - t0;
      times[label] = ms;
      return ms;
    }
    await sleep(250);
  }
  times[label] = null;
  return Infinity;
}
/** Run a write tool, then measure how long until the open page shows its effect. */
async function converge(label, name, args, check, arg) {
  const r = await tool(name, args);
  const t0 = Date.now();
  C.ok(r.pushed === true, `${label}: the bridge pushed before replying`, { pushed: r.pushed });
  const ms = await seenByPage(label, t0, check, arg);
  C.ok(ms <= PAGE_MS, `${label}: the open page shows it within 60 s`, ms === Infinity ? 'not seen' : ms + ' ms');
  return r;
}

let ids = {};
await C.step('setup', async () => {
  const env = await page.evaluate(async () => {
    const c = navigator.connection || {};
    const s = await window.__lists.ui.loadSync();
    return { visibility: document.visibilityState, type: c.type, effectiveType: c.effectiveType, rtt: c.rtt, saveData: c.saveData, quality: await s.linkQuality() };
  });
  times.env = env;
  C.ok(env.visibility === 'visible' && env.quality === 'good', 'the page is visible and on a good link', env);
  const before = await mcp.tool('get_overview', {});
  C.ok(before.isError && /isn’t connected/.test(before.text), 'before Connect, tools say Lists isn’t connected', before.text);
  const st = await mcp.admin('status');
  C.ok(st.status === 200 && st.body.connected === false && st.body.url === web.url + '/mcp', 'status: not connected, with the address', st.body);
});

await C.step('connect from Settings', async () => {
  await settings();
  C.ok(/Connect Claude & Grok/.test(await mcpText()) && /turns on backup/.test(await mcpText()), 'Settings offers Connect (and says it turns on backup)');
  await clickMcp('Connect Claude & Grok');
  const t = await mcpText();
  C.ok(t.includes(web.url + '/mcp') && /Disconnect/.test(t), 'Settings shows the address and Disconnect', t.replace(/\n+/g, ' | '));
  const st = await mcp.admin('status');
  C.ok(st.body.connected === true, 'the bridge reports connected', st.body);
  C.ok(existsSync(join(data, 'key')) && existsSync(join(data, 'owner')) && existsSync(join(data, 'replica.bin')), 'key, owner pin and replica are on the volume');
  const here = await app(page, (S, O, A) => ({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, today: A.today() }));
  const ov = await tool('get_overview', {});
  C.ok(ov.time_zone === here.tz && ov.today === here.today && ov.inbox.id === 'inbox', 'get_overview answers in the page’s time zone and date', { page: here, bridge: { tz: ov.time_zone, today: ov.today }, inboxOpen: ov.inbox.open_count });
  ids.today = ov.today;
  await app(page, (S, O, A, DB, st, ui) => ui.closeAll());
});

await C.step('MCP changes reach the open page', async () => {
  await toInbox();
  const list = await converge('create_list', 'create_list', { title: 'Errands (from Claude)' },
    (S, t) => [...S.children('root')].some((id) => S.val(id, 'title') === t && S.isLive(id)), 'Errands (from Claude)');
  ids.list = list.list.id;

  const add = await converge('add_items', 'add_items', { items: [{ title: 'Buy oat milk' }, { title: 'Water the plants', repeat: 'every monday', when: ids.today }] },
    // In the store and rendered on the Inbox page the browser has open.
    (S) => [...document.querySelectorAll('#outline .row .tx')].some((e) => e.textContent === 'Buy oat milk') && S.children('inbox').some((id) => S.val(id, 'rrule')));
  [ids.milk, ids.plants] = add.items.map((x) => x.id);
  const plants = await tool('get_item', { id: ids.plants });
  ids.plantsWhen = plants.item.expected_when;

  await converge('complete_items', 'complete_items', { items: [{ id: ids.milk }, { id: ids.plants, expected_when: ids.plantsWhen }] },
    (S, a) => S.val(a.milk, 'done') === true && S.val(a.plants, 'when') !== a.when && [...S.recs.keys()].some((id) => S.val(id, 'origin') === a.plants && S.val(id, 'kind') === 'log')
      && document.querySelector(`#outline .row[data-id="${a.milk}"]`)?.classList.contains('done'),
    { milk: ids.milk, plants: ids.plants, when: ids.plantsWhen });

  await converge('move_items', 'move_items', { ids: [ids.milk], parent_id: ids.list },
    (S, a) => S.parentOf(a.milk) === a.list && !document.querySelector(`#outline .row[data-id="${a.milk}"]`), { milk: ids.milk, list: ids.list });
});

await C.step('an edit in the page reaches the next tool call', async () => {
  // Real keyboard on the Inbox row: append to the title, leave the row.
  await toInbox();
  await page.keyboard.press('Escape');
  await app(page, (S, O, A, DB, st, ui, id) => ui.focus(id), ids.plants);
  await page.keyboard.press('i');
  await page.keyboard.type(' (edited in the app)', { delay: 10 });
  await page.keyboard.press('Escape');
  const tEdit = Date.now();
  const want = 'Water the plants (edited in the app)';
  C.ok((await app(page, (S, O, A, DB, st, ui, id) => S.val(id, 'title'), ids.plants)) === want, 'the page has the edit', want);
  // The page pushes on its own (its minute check); wait for that push, then poll the tool as a client would.
  let tPush = 0;
  while (!tPush && Date.now() - tEdit < PAGE_MS + 5000) {
    const s = await app(page, async (S, O, A, DB, st, ui) => ({ last: (ui.syncState() || {}).lastPush || 0, out: await DB.outboxSize() }));
    if (s.last >= tEdit && !s.out) tPush = s.last; else await sleep(250);
  }
  C.ok(tPush > 0, 'the page pushed the edit within 60 s', tPush ? tPush - tEdit + ' ms after the edit' : 'no push');
  times.page_push_after_edit = tPush ? tPush - tEdit : null;
  let seen = Infinity;
  while (tPush && Date.now() - tPush < TOOL_MS + 5000) {
    const r = await tool('get_item', { id: ids.plants, depth: 0 });
    if (r.item.data.title === want) { seen = Date.now() - tPush; break; }
    await sleep(1000);
  }
  times.tool_sees_page_edit = seen === Infinity ? null : seen;
  C.ok(seen <= TOOL_MS, 'get_item shows the page’s edit within 15 s of the push', seen === Infinity ? 'not seen' : seen + ' ms');
  const r = await tool('get_item', { id: ids.plants, depth: 0 });
  C.ok(!r.item.via_connector, 'a title last written in the app is not marked via_connector', r.item);
});

await C.step('trash, delete forever and undo reach the open page', async () => {
  await converge('trash_items', 'trash_items', { ids: [ids.list] },
    (S, a) => S.val(a.list, 'deleted') === 'trash' && S.qTrash().includes(a.list), { list: ids.list });
  const del = await converge('delete_forever', 'delete_forever', { ids: [ids.list] },
    (S, a) => S.val(a.list, 'deleted') === 'void' && S.val(a.milk, 'deleted') === 'void' && S.val(a.milk, 'title') === '' && !S.qTrash().includes(a.list), { list: ids.list, milk: ids.milk });
  C.ok(del.items[0].status === 'deleted_forever' && del.deleted === 2, 'delete_forever erased the list and its item', del);
  const und = await converge('undo', 'undo', { undo_id: del.undo_id },
    (S, a) => S.val(a.list, 'deleted') === 'trash' && S.val(a.milk, 'title') === 'Buy oat milk' && S.qTrash().includes(a.list), { list: ids.list, milk: ids.milk });
  C.ok(und.undone === 'Delete forever', 'undo took back the permanent delete', und);
});

await C.step('disconnect from Settings stops and wipes the bridge', async () => {
  await settings();
  await clickMcp('Disconnect');
  C.ok(/Connect Claude & Grok/.test(await mcpText()), 'Settings is back to Connect');
  const code = await Promise.race([bridge.exited, sleep(5000).then(() => 'still running')]);
  C.ok(code === 0, 'the bridge exited 0 after answering', code);
  C.ok(!existsSync(join(data, 'key')) && !existsSync(join(data, 'replica.bin')) && !existsSync(join(data, 'graveyard.bin')), 'key, replica and graveyard are wiped');
  C.ok(existsSync(join(data, 'owner')), 'the owner pin stays');
  bridge = await startBridge(); // what compose's restart policy does
  const st = await mcp.admin('status');
  C.ok(st.body.connected === false, 'the restarted bridge is empty', st.body);
  const list = await mcp.modern('tools/list', {});
  C.ok(list.status === 200 && list.messages.at(-1).result.tools.length === 16, 'tools/list still answers while disconnected', list.messages.at(-1).result?.tools?.length);
  const r = await mcp.tool('get_overview', {});
  C.ok(r.isError && /isn’t connected/.test(r.text), 'tools say Lists isn’t connected', r.text);
});

await C.step('turn off backup also disconnects the bridge', async () => {
  // The owner reconnects (the pin still matches), then turns backup off on this device.
  await settings();
  await clickMcp('Connect Claude & Grok');
  C.ok((await mcp.admin('status')).body.connected === true, 'the owner can connect again after a disconnect');
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); d.accept(); });
  await page.locator('.settings button', { hasText: 'Turn off' }).click();
  await page.waitForFunction(() => /Turn on backup/.test(document.querySelector('.settings').innerText));
  C.ok(/also disconnects Claude & Grok/.test(msg), 'the confirm says it also disconnects Claude & Grok', msg);
  const code = await Promise.race([bridge.exited, sleep(5000).then(() => 'still running')]);
  C.ok(code === 0 && !existsSync(join(data, 'key')), 'the bridge exited and wiped its key before backup went off', code);
  C.ok(!(await app(page, (S, O, A, DB, st, ui) => ui.pairingCode())), 'backup is off on this device');
  C.ok(!errors.length, 'no page errors', errors.join(' | '));
});

await browser.close();
const failed = C.summary();
console.log('times (ms):', JSON.stringify(times));
C.save('connector-e2e.json', { times });
try { bridge.p.kill('SIGKILL'); } catch { /* exited */ }
killAll();
process.exit(failed ? 1 : 0);
