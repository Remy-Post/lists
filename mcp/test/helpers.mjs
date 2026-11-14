// helpers.mjs — shared by the bridge suites: the real lists-sync (python3 server/sync_server.py on a free
// port, temp DB), the real bridge (node mcp/server.mjs on a free port, temp /data), "device A" (the app's own
// store and sync.js in this process), a fresh device that pulls a vault from 0, and a raw-fetch MCP client.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../persist.mjs';

export const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = join(MCP_DIR, '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tmp = (tag) => mkdtempSync(join(tmpdir(), `lists-mcp-${tag}-`));

const kids = new Set();
process.on('exit', () => { for (const p of kids) try { p.kill('SIGKILL'); } catch { /* gone */ } });

/** Spawn and resolve once a line matching `re` gives the port. Keeps the output for assertions. */
function spawnPort(cmd, args, env, re) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  kids.add(p);
  const out = { text: '' };
  const exited = new Promise((r) => p.once('exit', (code, sig) => { kids.delete(p); r({ code, sig }); }));
  const port = new Promise((res, rej) => {
    const on = (d) => { out.text += d; const m = out.text.match(re); if (m) res(+m[1]); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    exited.then(({ code }) => rej(new Error(`${cmd} exited ${code}: ${out.text}`)));
  });
  return { p, out, exited, port };
}

export async function startSync(env = {}) {
  const dir = tmp('sync');
  const s = spawnPort('python3', ['-I', join(REPO, 'server/sync_server.py')], {
    LISTS_DB: join(dir, 'lists.db'), LISTS_HOST: '127.0.0.1', LISTS_PORT: '0',
    LISTS_NEW_VAULTS: '1000', LISTS_FAIL_MAX: '1000', LISTS_VAULT_RPM: '100000', ...env,
  }, /listening on [\d.]+:(\d+)/);
  const port = await s.port;
  return { ...s, dir, url: `http://127.0.0.1:${port}`, stop: () => (s.p.kill('SIGTERM'), s.exited) };
}

/** The bridge. `limits` go to LISTS_MCP_TEST_LIMITS; X-Real-IP is trusted from loopback so tests can vary the IP. */
export async function startBridge({ data = tmp('data'), syncUrl, limits = {}, env = {} } = {}) {
  const b = spawnPort(process.execPath, [join(MCP_DIR, 'server.mjs')], {
    PORT: '0', LISTS_MCP_BIND: '127.0.0.1', LISTS_MCP_DATA: data, LISTS_SYNC_URL: syncUrl,
    LISTS_TRUSTED_PROXIES: '127.0.0.1', LISTS_MCP_TEST_LIMITS: JSON.stringify({ syncPerMin: 10_000, ...limits }), ...env,
  }, /lists-mcp listening on [\d.]+:(\d+)/);
  const port = await b.port;
  const url = `http://127.0.0.1:${port}`;
  return { ...b, data, url, client: (o) => client(url, o), kill: (sig = 'SIGKILL') => (b.p.kill(sig), b.exited) };
}

/* ---------------- MCP over raw fetch ---------------- */
export const MODERN = '2026-07-28';
const envelope = (clientInfo) => ({ 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': clientInfo });

/** Parse a JSON or SSE-framed reply into { status, headers, messages[], sse }. */
export async function readReply(r) {
  const type = r.headers.get('content-type') || '', text = await r.text();
  if (type.includes('text/event-stream')) {
    const messages = text.split('\n\n').map((f) => f.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')).filter(Boolean).map((d) => JSON.parse(d));
    return { status: r.status, headers: r.headers, messages, sse: true, text };
  }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, messages: body ? [body] : [], body, sse: false, text };
}

/** Each client gets its own X-Real-IP unless told otherwise, so per-IP limits don't leak across tests. */
const randomIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`;
/** A client for one bridge. ip: sent as X-Real-IP (trusted from loopback in tests). */
export function client(url, { ip = randomIp(), ua = 'lists-mcp-test/1', origin } = {}) {
  let id = 0;
  const base = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-real-ip': ip, 'user-agent': ua };
  if (origin) base.origin = origin;
  const post = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { ...base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(readReply);
  const c = {
    post,
    get: (path, headers = {}) => fetch(url + path, { headers: { ...base, ...headers } }).then(readReply),
    admin: (op, body) => (body === undefined ? c.get('/mcp-admin/' + op) : post('/mcp-admin/' + op, body)),
    /** A modern (2026-07-28) request with the envelope and the standard headers. */
    async modern(method, params = {}, extraHeaders = {}) {
      const headers = { 'mcp-protocol-version': MODERN, 'mcp-method': method, ...extraHeaders };
      if (method === 'tools/call') headers['mcp-name'] = params.name;
      return post('/mcp', { jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: envelope({ name: 'test', version: '1' }) } }, headers);
    },
    /** tools/call → { isError, text, json } where json is the result after the fixed first line. */
    async tool(name, args = {}) {
      const r = await c.modern('tools/call', { name, arguments: args });
      const msg = r.messages.at(-1);
      if (!msg || !msg.result) throw new Error(`tools/call ${name}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
      const text = msg.result.content[0].text, isError = !!msg.result.isError;
      const nl = text.indexOf('\n');
      // Results are the fixed sentence, a newline, then JSON; plain errors are one sentence.
      return { isError, text, json: text.startsWith('Item text') ? JSON.parse(text.slice(nl + 1)) : null };
    },
  };
  return c;
}

/** A request with an arbitrary Host header (fetch can't set one). → { status, body } */
export async function rawRequest(url, { method = 'GET', path = '/', headers = {}, body } = {}) {
  const { request } = await import('node:http');
  const u = new URL(url);
  return new Promise((res, rej) => {
    const r = request({ host: u.hostname, port: u.port, method, path, headers }, (m) => {
      let t = '';
      m.on('data', (d) => (t += d)); m.on('end', () => res({ status: m.statusCode, headers: m.headers, text: t }));
    });
    r.on('error', rej);
    r.end(body);
  });
}

/* ---------------- device A: the app's own modules in this process ---------------- */
export async function deviceA(syncUrl) {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const S = await import('../../src/js/store.js');
  const O = await import('../../src/js/ops.js');
  const A = await import('../../src/js/actions.js');
  const Y = await import('../../src/js/sync.js');
  S.setDevice('devA01');
  S.hydrate([]);
  const out = new Set(), meta = {};
  S.onPersist((r, local) => { if (local) out.add(r.id); });
  S.patch(S.INBOX, { kind: 'inbox', title: 'Inbox', pos: { parent: S.ROOT, key: 'a0', prev: null } }); // as main.js boot does
  const db = {
    getOutbox: async () => [...out].map((id) => S.recs.get(id)).filter(Boolean).map((r) => structuredClone(r)),
    ackOutbox: async (sent) => { for (const r of sent) { const cur = S.recs.get(r.id); if (!cur || cur.v === r.v) out.delete(r.id); } },
    applyRemote: async (recs) => { S.mergeRemote(recs); },
    getMeta: async (k) => structuredClone(meta[k]),
    setMeta: async (k, v) => { meta[k] = structuredClone(v); },
    requeueAll: async () => { for (const id of S.recs.keys()) out.add(id); },
  };
  const sync = Y.createSync({ db, base: syncUrl + '/api', nav: { onLine: true } });
  const code = await sync.createVault();
  const tok = (await Y.deriveKeys(Y.decodeKey(code))).tok;
  const dev = { S, O, A, Y, sync, code, tok, out, syncNow: () => sync.syncNow() };
  await dev.syncNow();
  return dev;
}

/** Another vault (for "belongs to another account"): just a key, created on the server with one push. */
export async function otherVault(syncUrl) {
  const Y = await import('../../src/js/sync.js');
  const meta = {};
  const db = { getOutbox: async () => [], ackOutbox: async () => {}, applyRemote: async () => {}, getMeta: async (k) => structuredClone(meta[k]), setMeta: async (k, v) => { meta[k] = structuredClone(v); } };
  const s = Y.createSync({ db, base: syncUrl + '/api', nav: { onLine: true } });
  const code = await s.createVault();
  await s.syncNow();
  return { code, tok: (await Y.deriveKeys(Y.decodeKey(code))).tok };
}

/** A brand-new device that pulls the whole vault from 0 with plain per-field LWW → Map(id → record). */
export async function freshPull(syncUrl, code) {
  const Y = await import('../../src/js/sync.js');
  const nodes = new Map(), meta = {};
  const db = {
    getOutbox: async () => [], ackOutbox: async () => {},
    applyRemote: async (recs) => {
      for (const r of recs) {
        const l = nodes.get(r.id) || { id: r.id, f: {} };
        for (const [k, x] of Object.entries(r.f)) if (!l.f[k] || x[1] > l.f[k][1]) l.f[k] = x;
        l.v = Object.values(l.f).reduce((m, x) => (x[1] > m ? x[1] : m), '');
        nodes.set(r.id, l);
      }
    },
    getMeta: async (k) => structuredClone(meta[k]), setMeta: async (k, v) => { meta[k] = structuredClone(v); },
  };
  const s = Y.createSync({ db, base: syncUrl + '/api', nav: { onLine: true } });
  await s.join(code);
  return nodes;
}

/** The bridge's saved replica, decrypted the way the bridge does it. */
export async function readReplica(data, code) {
  const Y = await import('../../src/js/sync.js');
  return P.unseal(P.localKey(Y.decodeKey(code)), readFileSync(join(data, P.FILES.replica)), 'lists-mcp/replica');
}

export const exists = (data, name) => { try { readFileSync(join(data, name)); return true; } catch { return false; } };
export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
/** Poll until fn() is truthy (or throw after ms). */
export async function until(fn, ms = 10_000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + label);
    await sleep(100);
  }
}
/** Percentile of a list of numbers (nearest rank). */
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
