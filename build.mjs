// build.mjs — src/ → dist/. One HTML, three CSS (base + two viewports), one JS bundle (+ lazy chunks),
// hashed names, precompressed .br/.gz, CSP hash for the inline theme script, and a budget report.
// Usage: node build.mjs [--dev]
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { execSync } from 'node:child_process';

const SRC = 'src', OUT = process.env.OUT || 'dist', A = join(OUT, 'assets');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
let rev = 'local';
try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const d = new Date();
const VERSION = `${d.toISOString().slice(0, 10).replace(/-/g, '')}.${rev}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(A, { recursive: true });
const names = {};

// Fonts (content-hashed).
for (const f of ['mona-text.woff2', 'mona-display.woff2']) {
  const buf = readFileSync(join(SRC, 'fonts', f));
  const n = f.replace('.woff2', `-${hash(buf)}.woff2`);
  writeFileSync(join(A, n), buf);
  names[f] = n;
}
cpSync(join(SRC, 'fonts', 'OFL.txt'), join(A, 'OFL.txt'));

// CSS
for (const f of ['app.css', 'phone.css', 'desk.css', 'panels.css']) {
  let css = readFileSync(join(SRC, 'css', f), 'utf8');
  for (const [k, v] of Object.entries(names)) css = css.replaceAll(`/assets/${k}`, `/assets/${v}`);
  const r = await build({ stdin: { contents: css, loader: 'css' }, write: false, minify: true, target: ['chrome111', 'safari16.4', 'firefox115'] });
  const out = r.outputFiles[0].contents;
  const n = f.replace('.css', `-${hash(out)}.css`);
  writeFileSync(join(A, n), out);
  names[f] = n;
}

// JS. The lazy modules (gl, panels) import nothing, so they are built standalone and hashed first;
// the app bundle then refers to them as external files. Result: one app file with no static chunks.
const lazyNames = {};
for (const m of ['gl', 'panels', 'sync']) {
  const r = await build({ entryPoints: [join(SRC, 'js', m + '.js')], bundle: true, format: 'esm', minify: true, write: false,
    target: ['chrome111', 'safari16.4', 'firefox115'], legalComments: 'none', define: { PANELS_CSS: JSON.stringify('/assets/' + names['panels.css']) } });
  const out = r.outputFiles[0].contents;
  const n = `${m}-${hash(out)}.js`;
  writeFileSync(join(A, n), out);
  lazyNames[m] = n;
}
const lazyPlugin = { name: 'lazy', setup(b) { b.onResolve({ filter: /^\.\/(gl|panels|sync)\.js$/ }, (a) => ({ path: './' + lazyNames[a.path.slice(2, -3)], external: true })); } };
const js = await build({
  entryPoints: [join(SRC, 'js', 'main.js')], bundle: true, splitting: false, format: 'esm', minify: true,
  target: ['chrome111', 'safari16.4', 'firefox115'], write: false, plugins: [lazyPlugin],
  define: { LISTS_BUILD: JSON.stringify(VERSION) }, metafile: true, legalComments: 'none',
});
const appOut = js.outputFiles[0].contents;
names['app.js'] = `app-${hash(appOut)}.js`;
writeFileSync(join(A, names['app.js']), appOut);
for (const [, meta] of Object.entries(js.metafile.outputs)) {
  const st = meta.imports.filter((i) => i.kind === 'import-statement');
  if (st.length) { console.error('Static import on the critical path (request waterfall): ' + st.map((i) => i.path).join(', ')); process.exitCode = 1; }
}

// HTML
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
for (const k of ['app.css', 'phone.css', 'desk.css', 'app.js']) html = html.replaceAll(`/assets/${k}`, `/assets/${names[k]}`);
html = html.replace(/\n\s*/g, '\n').replace(/>\n</g, '><');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, 'csp-script-hashes.txt'), inline.join(' ') + '\n');

// Static files
cpSync(join(SRC, 'icon.svg'), join(OUT, 'icon.svg'));
cpSync(join(SRC, 'manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));
if (existsSync(join(SRC, 'icons'))) cpSync(join(SRC, 'icons'), join(OUT, 'icons'), { recursive: true });
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /api/\n');
writeFileSync(join(OUT, 'version.txt'), VERSION + '\n');

// Service worker: precache the shell and every asset of this build.
const assets = readdirSync(A).filter((f) => f !== 'OFL.txt').map((f) => '/assets/' + f);
const pre = ['/', '/manifest.webmanifest', '/icon.svg', ...assets, ...(existsSync(join(OUT, 'icons')) ? readdirSync(join(OUT, 'icons')).map((f) => '/icons/' + f) : [])];
// The cache name follows the content (hashed asset names), so every real change gets a fresh cache.
const swVersion = VERSION + '-' + hash(JSON.stringify(pre) + readFileSync(join(OUT, 'index.html')));
let sw = readFileSync(join(SRC, 'sw.js'), 'utf8').replace('__VERSION__', swVersion).replace('__PRECACHE__', JSON.stringify(pre));
const swMin = await build({ stdin: { contents: sw, loader: 'js' }, write: false, minify: true, target: ['chrome111', 'safari16.4'] });
writeFileSync(join(OUT, 'sw.js'), swMin.outputFiles[0].contents);

// Precompress.
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sizes = {};
for (const p of walk(OUT)) {
  if (!['.html', '.js', '.css', '.svg', '.webmanifest', '.txt', '.json'].includes(extname(p))) continue;
  const buf = readFileSync(p);
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(p + '.br', br); writeFileSync(p + '.gz', gz);
  sizes[p.slice(OUT.length + 1)] = { raw: buf.length, br: br.length, gz: gz.length };
}

// Budget report.
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const crit = ['index.html', `assets/${names['app.css']}`, `assets/${names['app.js']}`];
const critBr = crit.reduce((s, f) => s + sizes[f].br, 0), critGz = crit.reduce((s, f) => s + sizes[f].gz, 0);
console.log(`Lists ${VERSION}`);
for (const [f, s] of Object.entries(sizes).sort()) if (!f.endsWith('.txt')) console.log(`  ${f.padEnd(44)} ${kb(s.raw).padStart(9)}  br ${kb(s.br).padStart(8)}  gz ${kb(s.gz).padStart(8)}`);
for (const f of Object.keys(names).filter((k) => k.endsWith('woff2'))) console.log(`  assets/${names[f].padEnd(37)} ${kb(statSync(join(A, names[f])).size).padStart(9)}  (lazy font)`);
console.log(`  critical path (html + app.css + app.js): br ${kb(critBr)} · gz ${kb(critGz)}  [budget 50 KB]`);
const viewportCss = ['phone.css', 'desk.css'].map((k) => sizes[`assets/${names[k]}`].br);
console.log(`  + viewport css: phone br ${kb(viewportCss[0])}, desk br ${kb(viewportCss[1])}`);
console.log(`  CSP script hashes: ${inline.join(' ')}`);
if (critGz > 50 * 1024) { console.error('Critical path over budget'); process.exitCode = 1; }
