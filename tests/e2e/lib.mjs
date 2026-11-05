// lib.mjs — shared helpers for the QA e2e suites (net3g, persist, flows, sync, perf).
// Builds the app into tests/e2e/out/dist (never touches the shared dist/), starts the production-like
// static server and, optionally, a throwaway sync server, and gives small Playwright utilities.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const OUT = join(ROOT, 'tests/e2e/out');
export const DIST = process.env.DIST || join(OUT, 'dist');
mkdirSync(OUT, { recursive: true });

/** DevTools presets, exact values from docs/research/02-platform.md §C.3 (NetworkManager.ts). */
export const PRESETS = {
  '3G': { latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000, connectionType: 'cellular3g' },
  'Slow 4G': { latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375, connectionType: 'cellular4g' },
};

export function build() {
  if (process.env.NO_BUILD && existsSync(join(DIST, 'index.html'))) return;
  execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, env: { ...process.env, OUT: DIST }, stdio: ['ignore', 'pipe', 'inherit'] });
}

const kids = new Set();
function track(p) { kids.add(p); p.on('exit', () => kids.delete(p)); return p; }
export function killAll() { for (const p of kids) { try { p.kill('SIGKILL'); } catch {} } }
process.on('exit', killAll);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { killAll(); process.exit(130); });

function waitLine(p, re, ms = 8000) {
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('timeout waiting for ' + re + ': ' + buf)), ms);
    const on = (d) => { buf += d; if (re.test(buf)) { clearTimeout(t); res(); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => { clearTimeout(t); rej(new Error('exited ' + c + ': ' + buf)); });
  });
}
async function waitHttp(url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server not up: ' + url);
}

/** Static server (tests/harness/serve.mjs). Returns base URL. */
export async function startStatic(port, syncPort) {
  const env = { ...process.env };
  if (syncPort) env.SYNC_PORT = String(syncPort); else delete env.SYNC_PORT;
  const p = track(spawn(process.execPath, [join(ROOT, 'tests/harness/serve.mjs'), DIST, String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
  await waitLine(p, /serving/);
  return { url: `http://127.0.0.1:${port}`, proc: p };
}

/** Throwaway sync server with a temp SQLite DB and generous rate limits. */
export async function startSync(port) {
  const dir = mkdtempSync(join(tmpdir(), 'lists-qa-sync-'));
  const env = { ...process.env, LISTS_DB: join(dir, 'lists.db'), LISTS_HOST: '127.0.0.1', LISTS_PORT: String(port), LISTS_NEW_VAULTS: '1000', LISTS_FAIL_MAX: '1000' };
  const p = track(spawn('python3', [join(ROOT, 'server/sync_server.py')], { env, stdio: ['ignore', 'pipe', 'pipe'] }));
  await waitHttp(`http://127.0.0.1:${port}/api/health`);
  return { url: `http://127.0.0.1:${port}`, proc: p, dir };
}

/**
 * A TCP proxy that counts bytes on the wire and can shape them like a real link: every chunk is delayed by
 * half the RTT in its direction and serialised through one shared bucket per direction (so parallel requests
 * and service-worker fetches compete for the same pipe, which DevTools' per-request throttling does not do).
 * shape = null → pass-through (byte counting only).
 */
export async function startProxy(port, targetPort, shape = null) {
  const net = await import('node:net');
  const stats = { up: 0, down: 0, conns: 0, reset() { this.up = 0; this.down = 0; this.conns = 0; } };
  const bucket = { up: 0, down: 0 };
  const pipe = (from, to, dir) => {
    from.on('data', (buf) => {
      stats[dir] += buf.length;
      if (!shape) { to.write(buf); return; }
      const rate = dir === 'down' ? shape.down : shape.up; // bytes per second
      const now = performance.now();
      const start = Math.max(now + shape.rtt / 2, bucket[dir]);
      bucket[dir] = start + (buf.length / rate) * 1000;
      setTimeout(() => { if (!to.destroyed) to.write(buf); }, bucket[dir] - now);
    });
    from.on('end', () => { const end = () => to.end(); if (!shape) end(); else setTimeout(end, Math.max(0, bucket[dir] - performance.now()) + 1); });
    from.on('error', () => to.destroy());
  };
  const socks = new Set();
  const srv = net.createServer((c) => {
    stats.conns++; socks.add(c); c.on('close', () => socks.delete(c));
    const s = net.connect(targetPort, '127.0.0.1');
    pipe(c, s, 'up'); pipe(s, c, 'down');
    c.on('close', () => s.destroy()); s.on('close', () => c.destroy());
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, stats, close: () => new Promise((r) => { for (const c of socks) c.destroy(); srv.close(r); }), setShape(s) { shape = s; } };
}

export const CHROME_ARGS =['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** Wait until the app is interactive: window.__lists is defined and (optionally) a row is rendered. */
export async function ready(page, { rows = true, timeout = 30000 } = {}) {
  await page.waitForFunction((r) => !!window.__lists && (!r || !!document.querySelector('#outline .row')), rows, { timeout, polling: 'raf' });
}

/** Run fn(S,O,A,DB,st,ui) inside the page. */
export const app = (page, fn, arg) => page.evaluate(([src, a]) => {
  const { S, O, A, DB, st, ui } = window.__lists;
  return new Function('S', 'O', 'A', 'DB', 'st', 'ui', 'arg', 'return (' + src + ')(S,O,A,DB,st,ui,arg)')(S, O, A, DB, st, ui, a);
}, [fn.toString(), arg]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };
export const tmpProfile = (tag) => mkdtempSync(join(tmpdir(), `lists-qa-${tag}-`));

/** Tiny assertion collector so one suite reports every check instead of dying on the first. */
export function checker(name) {
  const results = [];
  const c = {
    results,
    ok(cond, label, detail) { results.push({ ok: !!cond, label, detail }); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); return !!cond; },
    async step(label, fn) {
      try { await fn(); } catch (e) { c.ok(false, label + ' (threw)', String(e && e.message || e).split('\n')[0]); }
    },
    summary() {
      const f = results.filter((r) => !r.ok);
      console.log(`\n${name}: ${results.length - f.length}/${results.length} passed`);
      return f.length;
    },
    save(file, extra = {}) { writeFileSync(join(OUT, file), JSON.stringify({ name, results, ...extra }, null, 2)); },
  };
  return c;
}
