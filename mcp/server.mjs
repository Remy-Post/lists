// server.mjs — lists-mcp: node:http in front of the MCP SDK (createMcpHandler + toNodeHandler, as
// ~/health-bridge-spike/src/http.ts serves real Claude and Grok Bot traffic), plus the /mcp-admin endpoints
// the app's Settings call. Everything the SDK leaves to the server happens here, before any JSON-RPC is
// dispatched: Host and Origin checks, client IP (X-Real-IP only from the trusted proxy), rate and
// concurrency limits, body size and nesting, listen-stream lifetime, and the audit line.
import { createServer } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { L, perMinute, rateKey } from './limits.mjs';
import * as B from './bridge.mjs';
import { buildServer, TOOL_NAMES } from './tools.mjs';
import { shallowEnough } from './guard.mjs';
import { openAudit, withAudit, note, refusedOnce, flushRefused } from './audit.mjs';

const PORT = Number(process.env.PORT ?? 8788);
const BIND = process.env.LISTS_MCP_BIND || '0.0.0.0';
const PUBLIC = new URL(B.PUBLIC_URL);
// Our own Host check (the SDK does none): the public name, and loopback for the healthcheck and tests.
const HOSTS = new Set([PUBLIC.hostname, 'localhost', '127.0.0.1', '[::1]']);
const ADMIN_BODY = 4 << 10;
const log = (m) => console.log(m);
const errName = (e) => (e && (e.code || e.name)) || 'Error'; // never e.message: it could echo request data

/* ---------------- trusted proxy (same rule as lists-sync's LISTS_TRUSTED_PROXIES) ---------------- */
const proxySpec = (process.env.LISTS_TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean);
let proxies = new Set(proxySpec.filter((s) => isIP(s)));
/** Re-resolved every 60 s; a failed lookup (Caddy restarting, not up yet at boot) keeps the last good
 *  addresses and is retried every 2 s, so clients never all fall into Caddy's own rate-limit bucket. */
async function resolveProxies() {
  const ips = new Set(proxySpec.filter((s) => isIP(s)));
  let ok = true;
  for (const name of proxySpec.filter((s) => !isIP(s))) {
    try { for (const a of await lookup(name, { all: true })) ips.add(a.address); } catch { ok = false; }
  }
  proxies = ok ? ips : new Set([...ips, ...proxies]);
  setTimeout(resolveProxies, ok ? 60_000 : 2_000).unref();
}
const peerOf = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
function clientIp(req) {
  const peer = peerOf(req), real = String(req.headers['x-real-ip'] || '').trim();
  return proxies.has(peer) && real.length <= 45 && isIP(real) ? real : peer;
}
const hostOf = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');

/* ---------------- limits ---------------- */
const ipRate = perMinute(), allRate = perMinute();
const openByIp = new Map();
let openAll = 0;
const listens = []; // [{ ip, res }] oldest first
// Bodies still being read count against the open caps too, so held uploads can't pile up in memory.
let reading = 0;
const readingByIp = new Map();

function track(ip, res, listen) {
  openAll++;
  if (!listen) openByIp.set(ip, (openByIp.get(ip) || 0) + 1);
  let entry = null, timer = 0;
  if (listen) {
    // A new listen evicts its IP's oldest past the per-IP cap, and the oldest overall past the SDK cap,
    // so nobody can hold every slot; and no stream lives past 10 minutes (clients reconnect).
    const mine = listens.filter((l) => l.ip === ip);
    if (mine.length >= L.ipListens) mine[0].res.destroy();
    if (listens.length >= L.maxSubscriptions - 1) listens[0].res.destroy();
    entry = { ip, res };
    listens.push(entry);
    timer = setTimeout(() => res.destroy(), L.listenMaxMs).unref();
  }
  res.once('close', () => {
    openAll--;
    if (entry) { clearTimeout(timer); const i = listens.indexOf(entry); if (i >= 0) listens.splice(i, 1); }
    else { const n = openByIp.get(ip) - 1; if (n) openByIp.set(ip, n); else openByIp.delete(ip); }
  });
}

/* ---------------- helpers ---------------- */
function send(res, status, body, headers = {}) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const rpcError = (res, status, code, message) => send(res, status, { jsonrpc: '2.0', id: null, error: { code, message } });

const BIG = Symbol('big'), SLOW = Symbol('slow');
/** The whole body; BIG past `limit` bytes (nothing more is kept), SLOW when it hasn't all arrived in `ms`. */
function readBody(req, limit, ms = L.bodyMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    const finish = (v, e) => { if (done) return; done = true; clearTimeout(t); chunks.length = 0; if (e) reject(e); else resolve(v); };
    const t = setTimeout(() => finish(SLOW), ms);
    req.on('data', (c) => { if (done) return; size += c.length; if (size <= limit) chunks.push(c); else finish(BIG); });
    req.on('end', () => { if (!done) { const b = Buffer.concat(chunks); finish(b); } });
    req.on('error', (e) => finish(null, e));
    req.on('close', () => finish(null, Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
  });
}
/**
 * Read a POST body under the caps: 413 at once when Content-Length is too big, 503/429 when too many
 * requests are open or still uploading, 413 or 408 (connection closed) for a body that is too big or too slow.
 * → the body, or null when the request was already answered.
 */
async function readCapped(req, res, ip, limit) {
  if (Number(req.headers['content-length']) > limit) { send(res, 413, { error: 'payload too large' }, { connection: 'close' }); return null; }
  if (openAll + reading >= L.globalOpen) { refusedOnce(ip, 503); send(res, 503, { error: 'busy' }, { 'retry-after': '2' }); return null; }
  if ((openByIp.get(ip) || 0) + (readingByIp.get(ip) || 0) >= L.ipOpen) { refusedOnce(ip, 429); send(res, 429, { error: 'too many open requests' }, { 'retry-after': '1' }); return null; }
  reading++; readingByIp.set(ip, (readingByIp.get(ip) || 0) + 1);
  let raw;
  try { raw = await readBody(req, limit); } finally {
    reading--;
    const n = readingByIp.get(ip) - 1;
    if (n) readingByIp.set(ip, n); else readingByIp.delete(ip);
  }
  if (raw === BIG || raw === SLOW) {
    res.once('finish', () => req.destroy());
    if (raw === BIG) send(res, 413, { error: 'payload too large' }, { connection: 'close' });
    else send(res, 408, { error: 'request body too slow' }, { connection: 'close' });
    return null;
  }
  return raw;
}

/** Printable, short: these values come from the caller and end up in the audit log. */
const printable = (v, n = 64) => (typeof v === 'string' ? v.replace(/[^\x20-\x7e]/g, '?').slice(0, n) : undefined);

/** What the audit line records about a JSON-RPC message (method, tool, client), never its arguments. */
function describe(m, req) {
  const p = (m && m.params) || {};
  const meta = p._meta || {};
  const ci = p.clientInfo || meta['io.modelcontextprotocol/clientInfo'] || {};
  const out = { rpc: printable(m && m.method, 40) || '-' };
  if (m && m.method === 'tools/call') out.tool = TOOL_NAMES.includes(p.name) ? p.name : 'unknown';
  const client = [printable(ci.name, 40), printable(ci.version, 20)].filter(Boolean).join('/');
  if (client) out.client = client;
  const proto = printable(req.headers['mcp-protocol-version'], 16) || printable(p.protocolVersion, 16) || printable(meta['io.modelcontextprotocol/protocolVersion'], 16);
  if (proto) out.proto = proto;
  return out;
}

/* ---------------- MCP ---------------- */
const mcp = createMcpHandler(() => buildServer(), {
  onerror: (e) => log(`[mcp] ${errName(e)}`),
  maxSubscriptions: L.maxSubscriptions,
  keepAliveMs: L.keepAliveMs,
  maxRequestBodySize: L.bodyBytes,
});
const nodeMcp = toNodeHandler(mcp, { onerror: (e) => log(`[mcp-adapter] ${errName(e)}`), maxRequestBodySize: L.bodyBytes });

async function handleMcp(req, res, ip, base) {
  if (req.method !== 'POST') {
    // GET/DELETE: the SDK answers (405 for the stateless legacy leg). No body to read.
    if (openAll >= L.globalOpen) return send(res, 503, { error: 'busy' }, { 'retry-after': '2' });
    track(ip, res, false);
    return withAudit({ ...base, rpc: req.method }, async () => { await nodeMcp(req, res); note({ status: res.statusCode }); });
  }
  const raw = await readCapped(req, res, ip, L.bodyBytes);
  if (raw === null) return;
  let msg;
  try { msg = JSON.parse(raw.toString('utf8')); } catch { return rpcError(res, 400, -32700, 'Parse error'); }
  // zod recurses on nested input: refuse absurd nesting before anything parses it.
  if (!shallowEnough(msg, L.jsonDepth)) return rpcError(res, 400, -32600, `Request nests deeper than ${L.jsonDepth} levels`);
  // Legacy JSON-RPC batches would let one request run up to 100 calls past every per-request limit and audit
  // line; no supported client sends them (2026-07-28 forbids them).
  if (Array.isArray(msg)) return rpcError(res, 400, -32600, 'Batch requests are not supported');
  const listen = !!msg && msg.method === 'subscriptions/listen';
  if (openAll >= L.globalOpen) { refusedOnce(ip, 503); return send(res, 503, { error: 'busy' }, { 'retry-after': '2' }); }
  if (!listen && (openByIp.get(ip) || 0) >= L.ipOpen) { refusedOnce(ip, 429); return send(res, 429, { error: 'too many open requests' }, { 'retry-after': '1' }); }
  track(ip, res, listen);
  return withAudit({ ...base, ...describe(msg, req) }, async () => { await nodeMcp(req, res, msg); note({ status: res.statusCode }); });
}

/* ---------------- admin (the app's Settings → Claude & Grok) ---------------- */
async function handleAdmin(req, res, path, ip, base) {
  const op = path.slice('/mcp-admin/'.length);
  if (op === 'status') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' }, { allow: 'GET' });
    return send(res, 200, B.status());
  }
  if (!['connect', 'disconnect', 'tz'].includes(op)) return send(res, 404, { error: 'not found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' });
  const raw = await readCapped(req, res, ip, ADMIN_BODY);
  if (raw === null) return;
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'body must be JSON' }); }
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'body must be a JSON object' });
  return withAudit({ ...base, rpc: 'admin/' + op }, async () => {
    const [status, out, exit] = op === 'connect' ? await B.connect(body.code, body.tz)
      : op === 'tz' ? await B.setTz(body.code, body.tz) : await B.disconnect(body.code);
    note({ status });
    // The off switch: answer, then exit so nothing stays in memory; compose restarts the bridge empty.
    if (exit) res.once('finish', () => setImmediate(() => process.exit(0)));
    send(res, status, out);
  });
}

/* ---------------- server ---------------- */
// Checked every 5 s (not Node's 30 s), so requestTimeout and headersTimeout hold within seconds.
const server = createServer({ connectionsCheckingInterval: 5_000 }, async (req, res) => {
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  res.setHeader('cache-control', 'no-store');
  const path = (req.url || '/').split('?', 1)[0];
  try {
    const isMcp = path === '/mcp', isAdmin = path.startsWith('/mcp-admin/');
    if (!isMcp && !isAdmin) return send(res, 404, { error: 'not found' });
    if (!HOSTS.has(hostOf(req))) return send(res, 403, { error: 'Invalid Host' });
    // Server-side MCP clients send no Origin; the app's Settings send this site's. Anything else is refused.
    const origin = req.headers.origin;
    if (origin && origin !== PUBLIC.origin) return send(res, 403, { error: 'Invalid Origin' });
    const ip = clientIp(req), key = rateKey(ip);
    const wait = ipRate.hit(key, L.ipPerMin) || allRate.hit('*', L.globalPerMin);
    if (wait) { refusedOnce(key, 429); return send(res, 429, { error: 'too many requests' }, { 'retry-after': String(wait) }); }
    const base = { ip, ua: printable(req.headers['user-agent'], 120) || '' };
    return await (isMcp ? handleMcp(req, res, key, base) : handleAdmin(req, res, path, key, base));
  } catch (e) {
    log(`[http] ${errName(e)}`);
    if (!res.headersSent) send(res, 500, { error: 'internal error' }); else res.destroy();
  }
});
server.requestTimeout = 30_000; // the whole request must arrive within 30 s (responses may stream longer)
server.headersTimeout = 10_000;

process.on('uncaughtException', (e) => {
  // The name and the stack frames, not the message (it could carry item text).
  log(`[fatal] ${errName(e)}\n${String(e && e.stack || '').split('\n').slice(1, 8).join('\n')}`);
  process.exit(1);
});
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    B.shutdown();
    flushRefused();
    server.close();
    mcp.close().catch(() => {});
    process.exit(0);
  });
}

openAudit(B.dataDir);
await resolveProxies();
try { await B.boot(); } catch (e) { log(`[bridge] boot failed: ${errName(e)}`); }
server.listen(PORT, BIND, () => log(`lists-mcp listening on ${BIND}:${server.address().port}`));
