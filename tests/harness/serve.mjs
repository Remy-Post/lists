// serve.mjs — a production-like static server for tests: precompressed br/gz, the same caching and CSP
// as the Caddy block, and /api proxied to a local sync server (SYNC_PORT, optional).
// Usage: node tests/harness/serve.mjs <dir> <port>
import { createServer, request } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const dir = process.argv[2] || 'dist', port = +(process.argv[3] || 8080), SYNC = process.env.SYNC_PORT;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
const hashes = existsSync(join(dir, 'csp-script-hashes.txt')) ? readFileSync(join(dir, 'csp-script-hashes.txt'), 'utf8').trim() : '';
const CSP = `default-src 'none'; script-src 'self' ${hashes}; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (!SYNC) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"no sync server"}'); return; }
    const p = request({ host: '127.0.0.1', port: SYNC, path: req.url, method: req.method, headers: { ...req.headers, 'x-real-ip': '127.0.0.1' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(p);
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(dir, path);
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const ae = req.headers['accept-encoding'] || '';
  const headers = { 'content-type': types[extname(file)] || 'application/octet-stream', 'vary': 'Accept-Encoding', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  headers['cache-control'] = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (extname(file) === '.html') headers['content-security-policy'] = CSP;
  if (/\bbr\b/.test(ae) && existsSync(file + '.br')) { file += '.br'; headers['content-encoding'] = 'br'; }
  else if (/\bgzip\b/.test(ae) && existsSync(file + '.gz')) { file += '.gz'; headers['content-encoding'] = 'gzip'; }
  const body = readFileSync(file);
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}` + (SYNC ? ` (api → :${SYNC})` : '')));
