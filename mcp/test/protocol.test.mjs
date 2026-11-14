// node --test mcp/test — gate 1 against the bridge process: the modern stateless flow Claude uses
// (server/discover, tools/list, tools/call with MCP-Protocol-Version / Mcp-Method / Mcp-Name, and
// subscriptions/listen streams with keepalives, eviction and a lifetime), and the legacy flow Grok Bot's
// connector backend uses (initialize → initialized → tools/list → tools/call, SSE-framed, GET → 405).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSync, startBridge, deviceA, cleanup, readReply, MODERN, sleep } from './helpers.mjs';

let sync, bridge, dev;
before(async () => {
  sync = await startSync();
  dev = await deviceA(sync.url);
  bridge = await startBridge({ syncUrl: sync.url, limits: { keepAliveMs: 300, listenMaxMs: 2500 } });
  assert.equal((await bridge.client().admin('connect', { code: dev.code, tz: 'UTC' })).status, 200);
});
after(async () => { await bridge.kill(); await sync.stop(); cleanup(bridge.data); cleanup(sync.dir); });

const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const post = (body, headers = {}) => fetch(bridge.url + '/mcp', { method: 'POST', headers: { ...H, ...headers }, body: JSON.stringify(body) });

test('modern 2026-07-28: server/discover, tools/list, tools/call', async () => {
  const c = bridge.client({ ua: 'Claude-User' });
  const d = await c.modern('server/discover');
  assert.equal(d.status, 200);
  const res = d.messages[0].result;
  assert.ok(res.supportedVersions.includes(MODERN), JSON.stringify(res).slice(0, 200));
  assert.equal((res.serverInfo || res._meta['io.modelcontextprotocol/serverInfo']).name, 'lists');
  assert.ok(res.capabilities.tools);
  assert.match(res.instructions, /user data/);
  const list = await c.modern('tools/list');
  assert.equal(list.messages[0].result.tools.length, 16);
  const call = await c.tool('get_overview');
  assert.equal(call.isError, false);
  assert.equal(call.json.time_zone, 'UTC');
});

test('modern: missing or mismatched standard headers are refused by the SDK', async () => {
  const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} };
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } };
  const none = await readReply(await post(body, { 'mcp-protocol-version': MODERN }));
  assert.ok(none.messages[0].error, 'Mcp-Method missing');
  const wrong = await readReply(await post(body, { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call' }));
  assert.ok(wrong.messages[0].error, 'Mcp-Method mismatch');
  const name = await readReply(await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_overview', arguments: {}, _meta: meta } }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': 'list_items' }));
  assert.ok(name.messages[0].error, 'Mcp-Name mismatch');
});

/** Open a listen stream and collect raw SSE text until `ms` passes or the server closes it. */
async function listen(ip, ms) {
  const ac = new AbortController();
  const r = await fetch(bridge.url + '/mcp', {
    method: 'POST', signal: ac.signal,
    headers: { ...H, 'x-real-ip': ip, 'mcp-protocol-version': MODERN, 'mcp-method': 'subscriptions/listen' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true }, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  });
  const out = { status: r.status, type: r.headers.get('content-type'), text: '', closed: false, t0: Date.now(), closedAt: 0 };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let mine = false; // true once we aborted it ourselves
  const done = (async () => {
    try { for (;;) { const { value, done: d } = await reader.read(); if (d) break; out.text += dec.decode(value); } } catch { /* closed by the server (destroy) or by us */ }
    if (!mine) { out.closed = true; out.closedAt = Date.now(); }
  })();
  out.stop = async () => { mine = true; ac.abort(); await done; };
  out.wait = (t = ms) => Promise.race([done, sleep(t)]);
  return out;
}

test('subscriptions/listen: SSE ack, keepalive comment frames, closed after the lifetime', async () => {
  const l = await listen('10.9.0.1', 4000);
  assert.equal(l.status, 200);
  assert.match(l.type, /text\/event-stream/);
  await sleep(1000);
  assert.match(l.text, /notifications\/subscriptions\/acknowledged/);
  assert.match(l.text, /^:/m, 'keepalive comment frame');
  await l.wait(4000);
  assert.equal(l.closed, true, 'stream closed by the server');
  assert.ok(l.closedAt - l.t0 < 3500 && l.closedAt - l.t0 >= 2000, 'after about listenMaxMs');
});

test('listen streams: a 5th from one IP evicts that IP’s oldest; tools still answer meanwhile', async () => {
  const ls = [];
  for (let i = 0; i < 5; i++) { ls.push(await listen('10.9.0.2', 1000)); await sleep(50); }
  await sleep(300);
  assert.equal(ls[0].closed, true, 'oldest evicted');
  assert.ok(ls.slice(1).every((l) => !l.closed), 'the newer four stay open');
  assert.equal((await bridge.client({ ip: '10.9.0.2' }).tool('get_overview')).isError, false, 'listen streams don’t count against the per-IP request cap');
  for (const l of ls) await l.stop();
});

for (const version of ['2025-06-18', '2025-11-25']) {
  test(`legacy ${version} (Grok Bot / Cursor): initialize → initialized → tools/list → tools/call, SSE-framed; GET 405`, async () => {
    const h = { 'user-agent': 'Cursor/1.0.0', 'x-real-ip': '3.209.66.12' };
    const init = await readReply(await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'cursor-vscode', version: '1.0.0' } } }, h));
    assert.equal(init.status, 200);
    assert.equal(init.sse, true, 'legacy answers are SSE-framed');
    assert.equal(init.messages[0].result.protocolVersion, version);
    const hv = { ...h, 'mcp-protocol-version': version };
    const ack = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, hv);
    assert.equal(ack.status, 202);
    const list = await readReply(await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, hv));
    assert.equal(list.sse, true);
    assert.equal(list.messages[0].result.tools.length, 16);
    const call = await readReply(await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_items', arguments: { view: 'today' } } }, hv));
    const r = call.messages[0].result;
    assert.equal(r.isError, undefined);
    assert.match(r.content[0].text, /^Item text/);
    const get = await fetch(bridge.url + '/mcp', { headers: { ...hv, accept: 'text/event-stream' } });
    assert.equal(get.status, 405);
    const fs = await import('node:fs');
    const audit = fs.readFileSync(bridge.data + '/audit.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const mine = audit.filter((a) => a.ua === 'Cursor/1.0.0' && a.ip === '3.209.66.12');
    for (const m of ['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'GET']) assert.ok(mine.some((a) => a.rpc === m), 'audited ' + m);
    assert.ok(mine.some((a) => a.client === 'cursor-vscode/1.0.0'));
  });
}

test('JSON-RPC edge cases: parse error 400, unknown tool', async () => {
  const bad = await fetch(bridge.url + '/mcp', { method: 'POST', headers: H, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const c = bridge.client();
  const r = await c.modern('tools/call', { name: 'no_such_tool', arguments: {} });
  const m = r.messages[0];
  assert.ok(m.error || m.result.isError);
});
