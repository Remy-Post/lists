// icons.mjs — render the PWA icons from the SVG mark (any, maskable, apple-touch).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('src/icon.svg', 'utf8');
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect[^>]*\/>/, '');
const b = await chromium.launch();
const p = await b.newPage();
async function shot(size, file, { mask = false, radius = 14 } = {}) {
  // maskable: full-bleed paper, content inside the 80% safe zone
  const scale = mask ? 0.8 : 1;
  const html = `<html><body style="margin:0;background:transparent">
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${mask ? 0 : radius}" fill="#f8fafd"/>
    <g transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})">${inner}</g></svg></body></html>`;
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(html);
  await p.locator('svg').screenshot({ path: file, omitBackground: true });
}
await shot(192, 'src/icons/icon-192.png');
await shot(512, 'src/icons/icon-512.png');
await shot(512, 'src/icons/maskable-512.png', { mask: true });
await shot(180, 'src/icons/apple-180.png', { mask: true });
await b.close();
console.log('icons done');
