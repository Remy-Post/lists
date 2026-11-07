// strike.js — the blue-pencil strike. Each task gets its own stroke, seeded by its id,
// so the mark is unique per task yet identical every time it is drawn (docs/research/03-design-craft.md §7.5).

function rng(seed) { // mulberry32
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** SVG path for one stroke across a line box of width w (px), centred on y. */
export function strikePath(seed, w, y) {
  const r = rng(seed + ':' + Math.round(w / 24));
  const j = (s) => (r() - 0.5) * s;
  const x0 = -2 - r() * 3;                         // starts a touch before the word
  const x1 = w + 1 + r() * 4;                       // and overshoots, as a hand does
  const slope = j(2.4);                            // a slight, consistent rise or fall
  const y0 = y + j(1.2) - slope / 2, y1 = y + j(1.2) + slope / 2;
  const segs = w > 220 ? 3 : w > 90 ? 2 : 1;
  let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs, tp = (i - 0.5) / segs;
    const x = x0 + (x1 - x0) * t, yy = y0 + (y1 - y0) * t + (i === segs ? j(0.8) : j(1.4));
    const cx = x0 + (x1 - x0) * tp, cy = y0 + (y1 - y0) * tp + j(2.2);
    d += ` Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${yy.toFixed(1)}`;
  }
  // A short hooked tail on some strokes: the pencil lifting off the page.
  if (r() > 0.55) d += ` q${(2 + r() * 3).toFixed(1)} ${(-1 - r() * 1.5).toFixed(1)} ${(3 + r() * 3).toFixed(1)} ${(-2 - r() * 2).toFixed(1)}`;
  return d;
}

const NS = 'http://www.w3.org/2000/svg';
/** Read phase: one stroke box per rendered line of `textEl`, relative to `host`. No writes. */
export function measureStrike(host, textEl) {
  const hb = host.getBoundingClientRect();
  if (!hb.width) return null; // not laid out (offscreen with content-visibility)
  const range = document.createRange();
  range.selectNodeContents(textEl);
  const lines = [];
  for (const q of range.getClientRects()) {
    if (q.width <= 2) continue;
    const l = lines.find((x) => Math.abs(x.top - q.top) < 4);
    if (l) { l.left = Math.min(l.left, q.left); l.right = Math.max(l.right, q.right); }
    else lines.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right });
  }
  return { w: hb.width, h: hb.height, lines: lines.map((l) => ({ y: (l.top + l.bottom) / 2 - hb.top + 0.5, x: l.left - hb.left, w: l.right - l.left })) };
}
/** Write phase: draw the strokes from a measurement. animate: false | 'full' | 'fast'. */
export function paintStrike(host, geo, seed, animate) {
  let svg = host.querySelector(':scope > svg.strike');
  if (!geo || !geo.lines.length) { if (svg) svg.remove(); return null; }
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'strike');
    svg.setAttribute('aria-hidden', 'true');
    host.appendChild(svg);
  }
  svg.setAttribute('width', Math.ceil(geo.w + 12));
  svg.setAttribute('height', Math.ceil(geo.h));
  svg.replaceChildren();
  geo.lines.forEach((l, i) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', strikePath(seed + i, l.w, l.y));
    p.setAttribute('transform', `translate(${l.x.toFixed(1)} 0)`);
    svg.appendChild(p);
    if (animate) {
      const len = l.w + 12; // close enough to the path length, without a layout-forcing getTotalLength()
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: animate === 'fast' ? 90 : 220 + Math.min(160, len * 0.25),
        delay: i * 70, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards',
      });
    }
  });
  return svg;
}
