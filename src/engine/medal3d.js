/* 3D medals for the badges (GH.medal3d). They ride in the 3D figure's chunk (src/engine/chunk3d.js),
 * so three.js ships once.
 *
 * A medal is built from what src/ui/badges.js hands over (a spec): its shape (one per category), its
 * glyph (a 24 px icon's SVG markup), its tier's metal, its category's enamel, the number it carries,
 * and what's engraved on its back. Everything is made here: the outlines are the SVG medals' own,
 * the glyph and the number are traced from a canvas into raised, bevelled relief, the enamel's
 * guilloché, platinum's film and the engraving are canvas textures, and the light is a studio
 * drawn into an environment map. A locked badge is the unminted blank: the same shape in dark,
 * frosted metal, its design only faintly there.
 *
 * - still(spec, o) / stillAsync(spec, o): a picture of it at rest, for the stills badges.js keeps
 *   and the share card. stillNow(spec, o) draws one in the caller's idle moment, or says to wait
 *   while new shaders compile in the background.
 * - mount(host, spec, o): the live medal, drawn into a canvas of its own in `host`: drag or flick to
 *   spin it, at rest it (o.sway) sways slowly while the light sweeps across it, and it tilts a
 *   little with the phone. spinIn() is the reveal's: it spins in from small with a flash of light.
 * - supported(): whether WebGL works here.
 *
 * It has a WebGL renderer of its own (the figure's is the figure's), made when a medal is first
 * drawn and handed back a few seconds after the last one, so it only holds the GPU while medals are
 * being drawn or one is on screen. One live medal at a time: a second takes the first one's place.
 *
 * Units: the SVG medals' 120 px box, centred, 53 px to 1. +Z faces the viewer.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, MeshPhysicalMaterial, MeshBasicMaterial, Shape, Path, Vector2,
  ExtrudeGeometry, ShapeGeometry, SphereGeometry, PlaneGeometry, Float32BufferAttribute, Color, CanvasTexture, DataTexture, PMREMGenerator,
  SRGBColorSpace, NoColorSpace, NeutralToneMapping, BackSide, RGBAFormat, LinearMipmapLinearFilter, LinearFilter,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const doc = G.document;
const now = () => (G.performance ? G.performance.now() : Date.now());
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// Two colours (#rrggbb) mixed, t of the way from a to b.
const mix = (a, b, t) => `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- the look */
// Each tier's metal: its colour (sRGB), how polished the rim and relief are (rough) and the back
// (satin). Platinum has a pearly film over a clear coat; the blank is dark, frosted metal (matte).
// Bronze's relief is polished brighter (relief), or its glyph would sink into a warm enamel.
const METALS = {
  bronze: { color: '#cf8a58', relief: '#efbd94', rough: 0.2, satin: 0.4 },
  silver: { color: '#eef2f7', rough: 0.13, satin: 0.34 },
  gold: { color: '#ffd57a', rough: 0.15, satin: 0.34 },
  platinum: { color: '#efeaff', rough: 0.1, satin: 0.28, pearl: true },
  lock: { color: '#5d636e', rough: 0.46, satin: 0.56, frost: true },
};
// Proportions, in medal units (1 = 53 px of the SVG's box).
const DIM = {
  thick: 0.2, // the rim, front to back
  bevel: 0.055, // how far its rounded edges reach in depth
  bevelIn: 0.08, // and in from the outline
  recess: 0.05, // how far the field sits below the rim's top
  relief: 0.036, // the glyph's and the number's height above the field
  bead: 0.021, // a bead's radius on the rim
};
const FRAME = 1.25; // the live view's frame around the medal's box (room to sway and tilt)
const BOX = 60 / 53; // half the medal's box (the SVG's 120 px)
const REST = { x: 0.06, y: -0.16 }; // how a medal rests: turned a little, so its rim and thickness show

/* ---------------------------------------------------------------- outlines */
// Polygons in the SVG medals' box (y down), sampled densely, turned into medal units at the end.
const quadAt = (a, c, b, t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; };
const cubicAt = (a, c1, c2, b, t) => { const u = 1 - t; return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]; };
// A closed polygon with rounded corners: a quadratic curve from r before each corner to r after it
// (the SVG medals' own rounding), n steps a curve.
function rounded(pts, r, n) {
  const out = [];
  pts.forEach((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const at = (q) => { const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy), k = Math.min(r / len, 0.5); return [p[0] + dx * k, p[1] + dy * k]; };
    const s = at(a), e = at(b);
    for (let j = 0; j <= n; j++) out.push(quadAt(s, p, e, j / n));
  });
  return out;
}
const ring = (n, r1, r2, rot) => Array.from({ length: n }, (_, i) => { const a = ((rot + (i * 360) / n) * Math.PI) / 180, r = r2 != null && i % 2 ? r2 : r1; return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]; });
const circle = (r, n = 144) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]; });
// The shield, from its right half (mirrored): the top edge from x0, its corner to (xr, qy), down the
// side to vy, then a curve to the point at the bottom. Outer and face are the SVG's two paths.
const SHIELD = { outer: [12, 25, 105, 22, 55, 82, 86, 100, 112], face: [24, 32, 93, 29, 55, 75, 79, 89, 98] };
function shield(p) {
  const [top, x0, xr, qy, vy, c1y, c2x, c2y, by] = p;
  const half = [[60, top], [120 - x0, top]];
  for (let j = 1; j <= 10; j++) half.push(quadAt([120 - x0, top], [xr, top], [xr, qy], j / 10));
  half.push([xr, vy]);
  for (let j = 1; j <= 28; j++) half.push(cubicAt([xr, vy], [xr, c1y], [c2x, c2y], [60, by], j / 28));
  const left = half.slice(1, -1).reverse().map(([x, y]) => [120 - x, y]);
  return half.concat(left);
}
// Each shape between its outline (t 0) and its face's (t 1), as the SVG draws them. The star's face is
// a circle, so in between it's the rosette's teeth around a circle.
const SHAPES = {
  circle: (t) => circle(lerp(51, 39, t)),
  hexagon: (t) => rounded(ring(6, lerp(53, 41, t), null, -90), lerp(9, 6, t), 12),
  shield: (t) => soften(shield(SHIELD.outer.map((v, i) => lerp(v, SHIELD.face[i], t)))), // its point rounded a little
  square: (t) => { const lo = lerp(16, 27, t), hi = lerp(104, 93, t); return rounded([[lo, lo], [hi, lo], [hi, hi], [lo, hi]], lerp(26, 18, t), 12); },
  star: (t) => (t >= 1 ? circle(36.5) : t > 0 ? circle(lerp(45.5, 36.5, t)) : rounded(ring(24, 53, 45.5, -90), 3.2, 6)),
};
// In medal units (y up, counter-clockwise), with points closer than 0.002 merged.
function outline(name, t) {
  const pts = (SHAPES[name] || SHAPES.circle)(t).map(([x, y]) => new Vector2((x - 60) / 53, (60 - y) / 53));
  const out = [];
  for (const p of pts) if (!out.length || p.distanceTo(out[out.length - 1]) > 0.002) out.push(p);
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 0.002) out.pop();
  return out;
}
// Where the glyph sits on the face, alone and over a number, and where the number sits (y, in medal
// units): the shield's face is higher and narrows toward its point.
const LAYOUT = { shield: [0.057, 0.2, -0.29], other: [0, 0.15, -0.42] };
const layout = (name) => LAYOUT[name] || LAYOUT.other;

/* ---------------------------------------------------------------- tracing a picture into relief */
// Marching squares over a canvas's alpha: the closed outlines of everything drawn, with sub-pixel
// edges from its antialiasing. Returns polygons in pixels.
function contours(cv) {
  const w = cv.width, h = cv.height;
  const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const W = w + 2, H = h + 2; // a border of nothing, so every outline closes
  const a = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[(y + 1) * W + x + 1] = data[(y * w + x) * 4 + 3] / 255;
  const T = 0.5;
  const pts = new Map(); // edge key → its crossing point
  const hk = (i, j) => (j * W + i) * 2, vk = (i, j) => (j * W + i) * 2 + 1;
  const point = (k) => {
    if (pts.has(k)) return pts.get(k);
    const c = k >> 1, i = c % W, j = (c - i) / W;
    const v0 = a[c], v1 = k & 1 ? a[c + W] : a[c + 1];
    const f = (T - v0) / (v1 - v0 || 1e-6);
    const p = k & 1 ? [i - 1, j - 1 + f] : [i - 1 + f, j - 1];
    pts.set(k, p);
    return p;
  };
  const links = new Map(); // edge key → the edge keys it joins
  const join = (k1, k2) => {
    point(k1); point(k2);
    (links.get(k1) || links.set(k1, []).get(k1)).push(k2);
    (links.get(k2) || links.set(k2, []).get(k2)).push(k1);
  };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const tl = a[j * W + i] > T, tr = a[j * W + i + 1] > T, br = a[(j + 1) * W + i + 1] > T, bl = a[(j + 1) * W + i] > T;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const Tp = hk(i, j), B = hk(i, j + 1), L = vk(i, j), R = vk(i + 1, j);
      const mid = (a[j * W + i] + a[j * W + i + 1] + a[(j + 1) * W + i + 1] + a[(j + 1) * W + i]) / 4 > T;
      switch (c) {
        case 1: case 14: join(L, B); break;
        case 2: case 13: join(B, R); break;
        case 3: case 12: join(L, R); break;
        case 4: case 11: join(Tp, R); break;
        case 6: case 9: join(Tp, B); break;
        case 7: case 8: join(Tp, L); break;
        case 5: if (mid) { join(Tp, L); join(B, R); } else { join(Tp, R); join(L, B); } break;
        case 10: if (mid) { join(Tp, R); join(L, B); } else { join(Tp, L); join(B, R); } break;
        default: break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1, k = start;
    for (let guard = 0; guard < 200000; guard++) {
      seen.add(k);
      loop.push(pts.get(k));
      const nb = links.get(k);
      const nx = nb[0] === prev ? nb[1] : nb[0];
      prev = k;
      k = nx;
      if (k === undefined || k === start) break;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}
// Fewer points where they add nothing (Ramer-Douglas-Peucker, eps in pixels), on a closed loop.
function simplify(pts, eps) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  const seg = (lo, hi) => {
    const [ax, ay] = pts[lo], [bx, by] = pts[hi];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let best = -1, far = eps;
    for (let i = lo + 1; i < hi; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > far) { far = d; best = i; } }
    if (best >= 0) { keep[best] = 1; seg(lo, best); seg(best, hi); }
  };
  const half = pts.length >> 1;
  keep[0] = keep[half] = keep[pts.length - 1] = 1;
  seg(0, half);
  seg(half, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}
// Corners cut, twice (Chaikin): a type's sharp corners become tight curves, so the bevel's inset
// can't cross itself there.
function soften(pts) {
  let p = pts;
  for (let k = 0; k < 2; k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}
const area = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[i].x) * (p[j].y + p[i].y); return s / 2; };
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
// The traced outlines as shapes with holes: an outline inside an even number of others is a shape,
// inside an odd number a hole in the one just around it (a ring's inside, a letter's counter).
// map(x, y) turns a pixel into medal units.
function shapesOf(cv, map, eps) {
  // (A point on top of the one before it would give the bevel no direction to go.)
  const dedupe = (l) => l.filter((p, i) => p.distanceTo(l[(i + l.length - 1) % l.length]) > 1e-4);
  const loops = contours(cv).map((l) => dedupe(soften(simplify(l, eps)).map(([x, y]) => map(x, y)))).filter((l) => l.length > 2 && Math.abs(area(l)) > 1e-5);
  const depth = loops.map((l, i) => loops.filter((o, k) => k !== i && inside(l[0], o)).length);
  const shapes = new Map();
  loops.forEach((l, i) => { if (depth[i] % 2 === 0) shapes.set(i, new Shape(l)); });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let parent = -1;
    loops.forEach((o, k) => { if (k !== i && depth[k] === depth[i] - 1 && inside(l[0], o) && (parent < 0 || Math.abs(area(o)) < Math.abs(area(loops[parent])))) parent = k; });
    if (shapes.has(parent)) shapes.get(parent).holes.push(new Path(l));
  });
  return [...shapes.values()];
}
const canvas2d = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
// A glyph's SVG markup (paths, circles and rects on a 24 px grid, stroked with round ends, or filled)
// drawn into a canvas, scale px a unit.
function drawGlyph(markup, scale, stroke) {
  const n = Math.round(24 * scale) + 8;
  const cv = canvas2d(n, n);
  const ctx = cv.getContext('2d');
  ctx.translate(4, 4);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  for (const m of String(markup).matchAll(/<(path|circle|rect)\b([^>]*)>/g)) {
    const at = {};
    for (const x of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) at[x[1]] = x[2];
    const num = (k) => parseFloat(at[k]) || 0;
    let p;
    if (m[1] === 'path') p = new Path2D(at.d || '');
    else if (m[1] === 'circle') { p = new Path2D(); p.arc(num('cx'), num('cy'), num('r'), 0, TAU); }
    else { p = new Path2D(); if (p.roundRect) p.roundRect(num('x'), num('y'), num('width'), num('height'), num('rx')); else p.rect(num('x'), num('y'), num('width'), num('height')); }
    if (at.fill && at.fill !== 'none') ctx.fill(p);
    if (at.stroke !== 'none') ctx.stroke(p);
  }
  return cv;
}
const FONT = '"Host Grotesk", ui-sans-serif, system-ui, sans-serif';
function drawText(text, px) {
  const probe = canvas2d(8, 8).getContext('2d');
  probe.font = `800 ${px}px ${FONT}`;
  const w = Math.ceil(probe.measureText(text).width) + 16;
  const cv = canvas2d(w, Math.ceil(px * 1.1) + 16);
  const ctx = cv.getContext('2d');
  ctx.font = `800 ${px}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.width / 2, cv.height / 2 + px * 0.04);
  return cv;
}
// Relief: shapes extruded to `h` above z = 0 with a small rounded bevel at the top (the one at the back
// is under the field).
function relief(shapes, h) {
  if (!shapes.length) return null;
  const bt = Math.min(0.012, h * 0.35), bs = 0.006;
  // (The bevel widens its foot rather than narrowing its top: narrowed, a digit's tight corners crossed
  // themselves and its face was filled wrong.)
  const g = new ExtrudeGeometry(shapes, { depth: h, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelOffset: 0, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -bt);
  return flatUv(g);
}
// Texture coordinates straight from where each point is, as the field's are, so a texture across the
// medal (platinum's film) runs on smoothly over its sides and bevels (an extrusion's own change from
// one face to the next, which showed as blocks).
function flatUv(g) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getY(i));
  uv.needsUpdate = true;
  return g;
}

/* ---------------------------------------------------------------- textures */
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {};
  // The enamel's guilloché: fine rays from the centre with a slow wave through them, as engine-turned
  // under translucent enamel. A normal map (the enamel's clear coat stays smooth on top).
  {
    const n = 512, data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1;
        const r = Math.hypot(u, v), th = Math.atan2(v, u);
        const N = 96, wave = 0.18 * Math.sin(r * 14);
        // The slope of sin(N theta + wave) across the rays (over r), and along them from the wave.
        const c = Math.cos(N * th + wave);
        const fade = clamp((r - 0.06) / 0.12, 0, 1);
        const gt = (c * N) / Math.max(r, 0.08) * 0.006 * fade, gr = c * 0.18 * 14 * Math.cos(r * 14) * 0.006 * fade;
        const gx = gr * Math.cos(th) - gt * Math.sin(th), gy = gr * Math.sin(th) + gt * Math.cos(th);
        const len = Math.hypot(gx, gy, 1);
        const i = (y * n + x) * 4;
        data[i] = Math.round(((-gx / len) * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round(((-gy / len) * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        data[i + 3] = 255;
      }
    }
    const t = new DataTexture(data, n, n, RGBAFormat);
    t.colorSpace = NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    t.repeat.set(0.5, 0.5);
    t.offset.set(0.5, 0.5);
    TEX.guilloche = t;
  }
  // Platinum's film: how thick it is drifts across the medal (green), so its colours shift as it turns.
  {
    const n = 128, cv = canvas2d(n, n), ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, '#000');
    g.addColorStop(0.35, '#0f0');
    g.addColorStop(0.6, '#030');
    g.addColorStop(1, '#0c0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    const r = ctx.createRadialGradient(n * 0.35, n * 0.3, 0, n * 0.35, n * 0.3, n * 0.7);
    r.addColorStop(0, 'rgba(0,255,0,.6)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, n, n);
    const t = new CanvasTexture(cv);
    t.colorSpace = NoColorSpace;
    t.repeat.set(0.5, 0.5);
    t.offset.set(0.5, 0.5);
    TEX.film = t;
  }
  return TEX;
}
// The enamel's colour: light where the light falls (up and to the left), deep at its edge, from its
// category's three colours.
const enamelMaps = new Map();
function enamelMap(c) {
  const k = c.join();
  if (enamelMaps.has(k)) return enamelMaps.get(k);
  const n = 128, cv = canvas2d(n, n), ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(n * 0.4, n * 0.34, 0, n * 0.5, n * 0.5, n * 0.62);
  g.addColorStop(0, c[0]);
  g.addColorStop(0.5, c[1]);
  g.addColorStop(1, mix(c[1], c[2], 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.repeat.set(0.5, 0.5);
  t.offset.set(0.5, 0.5);
  enamelMaps.set(k, t);
  return t;
}
// The engraving on the back: its lines, cut into the metal (a bump map in red, the cut's roughness in
// green).
// Lines: [tier, name, day, app]; the name large, the rest in spaced capitals, each as wide as the face
// allows where it sits (the name shrinks to fit before it's ever cut short).
function engraving(lines, sh) {
  const n = 512, cv = canvas2d(n, n), ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgb(255,70,0)';
  ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = 'rgb(0,255,0)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = n / 2 - (layout(sh)[0] * n) / 2;
  const R = (n / 2) * 0.62; // inside the face, which reaches 0.74 of the way to the edge
  const L = (lines || []).filter(Boolean).slice(0, 4);
  const sizes = [21, 46, 20, 16];
  const gaps = L.map((_, i) => sizes[i] * (i === 1 ? 1.35 : 1.7));
  let y = cy - gaps.reduce((s, x) => s + x, 0) / 2 + gaps[0] / 2;
  L.forEach((text, i) => {
    const room = 2 * Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
    let px = sizes[i];
    const set = () => { ctx.font = `${i === 1 ? 800 : 700} ${px}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = i === 1 ? '0px' : `${Math.round(px * 0.14)}px`; };
    set();
    let s = i === 1 ? String(text) : String(text).toUpperCase();
    while (i === 1 && px > 28 && ctx.measureText(s).width > room) { px -= 2; set(); }
    while (s.length > 3 && ctx.measureText(s).width > room) s = `${s.slice(0, -2).trim()}…`;
    ctx.fillText(s, n / 2, y);
    y += gaps[i];
  });
  const t = new CanvasTexture(cv);
  t.colorSpace = NoColorSpace;
  t.repeat.set(0.5, 0.5);
  t.offset.set(0.5, 0.5);
  t.anisotropy = 4;
  return t;
}

/* ---------------------------------------------------------------- materials */
const mats = new Map();
function material(key, make) { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); }
function metal(tier, satin, raised) {
  const m = METALS[tier] || METALS.bronze;
  return material(`m:${tier}:${satin ? 1 : 0}${raised ? ':r' : ''}`, () => {
    const o = { color: new Color((raised && m.relief) || m.color), metalness: 1, roughness: satin ? m.satin : m.rough, envMapIntensity: 1 };
    if (m.pearl) Object.assign(o, { clearcoat: 0.8, clearcoatRoughness: 0.05, iridescence: 0.8, iridescenceIOR: 1.7, iridescenceThicknessMap: textures().film, iridescenceThicknessRange: [260, 600] });
    if (m.frost) Object.assign(o, { metalness: 0.9 });
    return new MeshPhysicalMaterial(o);
  });
}
function enamel(colors) {
  return material(`e:${colors.join()}`, () => new MeshPhysicalMaterial({
    color: 0xffffff, map: enamelMap(colors), metalness: 0, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.05,
    normalMap: textures().guilloche, normalScale: new Vector2(0.6, 0.6), envMapIntensity: 1,
  }));
}

/* ---------------------------------------------------------------- building a medal */
// Geometry kept per shape and per glyph (a gallery repeats them), dropped with the renderer.
const geos = new Map();
function geo(key, make) { if (!geos.has(key)) geos.set(key, make()); return geos.get(key); }
// The body: a thick rim around the field, its edges rounded, the same front and back.
function rimGeo(sh) {
  return geo(`rim:${sh}`, () => {
    const s = new Shape(outline(sh, 0));
    s.holes.push(new Path(outline(sh, 1)));
    const bt = DIM.bevel, bs = sh === 'star' ? DIM.bevelIn * 0.6 : DIM.bevelIn;
    const g = new ExtrudeGeometry(s, { depth: DIM.thick - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelOffset: -bs, bevelSegments: 10, curveSegments: 1 });
    g.translate(0, 0, -(DIM.thick - 2 * bt) / 2);
    // Shaded smooth all round: an extrusion's faces each have their own corners, so its normals are
    // flat, and a polished rim showed each facet of a rounded corner as a block.
    g.deleteAttribute('normal');
    const m = mergeVertices(flatUv(g), 1e-5);
    g.dispose();
    m.computeVertexNormals();
    return m;
  });
}
// The field, a plate in the rim's opening (front or back), a hair larger so no gap shows.
function fieldGeo(sh) {
  return geo(`field:${sh}`, () => new ShapeGeometry(new Shape(outline(sh, 0.97)), 1));
}
// Beads round the rim's top, where it's widest.
function beadsGeo(sh) {
  return geo(`beads:${sh}`, () => {
    const path = outline(sh, sh === 'star' ? 0.45 : 0.5);
    let len = 0;
    for (let i = 0; i < path.length; i++) len += path[i].distanceTo(path[(i + 1) % path.length]);
    const n = Math.max(24, Math.round(len / (DIM.bead * 3.3)));
    const step = len / n;
    const ball = new SphereGeometry(DIM.bead, 10, 7);
    const z = DIM.thick / 2 - DIM.bead * 0.3;
    const out = [];
    let i = 0, acc = 0, want = 0;
    for (let k = 0; k < n; k++) {
      while (i < path.length) {
        const a = path[i], b = path[(i + 1) % path.length], d = a.distanceTo(b);
        if (acc + d >= want) { const f = (want - acc) / (d || 1); out.push(ball.clone().translate(lerp(a.x, b.x, f), lerp(a.y, b.y, f), z)); break; }
        acc += d;
        i++;
      }
      want += step;
    }
    ball.dispose();
    const g = mergeGeometries(out);
    for (const x of out) x.dispose();
    return g;
  });
}
// The glyph in relief on the field: traced from its icon, a little higher over a number.
function glyphGeo(markup, low) {
  return geo(`glyph:${markup}:${low ? 1 : 0}`, () => {
    const scale = 12;
    const cv = drawGlyph(markup, scale, 1.95);
    const size = low ? 0.6 : 0.72; // its 24 px box, in medal units
    const k = size / (24 * scale);
    const c = cv.width / 2;
    return relief(shapesOf(cv, (x, y) => new Vector2((x - c) * k, (c - y) * k), 0.3), DIM.relief);
  });
}
function numberGeo(text) {
  return geo(`num:${text}`, () => {
    const px = 120;
    const cv = drawText(text, px);
    const k = (text.length > 2 ? 0.27 : 0.31) / px; // the font's size, in medal units
    const cx = cv.width / 2, cy = cv.height / 2;
    return relief(shapesOf(cv, (x, y) => new Vector2((x - cx) * k, (cy - y) * k), 0.35), DIM.relief);
  });
}
// A medal: spec { shape, glyph (markup), tier ('lock' for the blank), enamel [light, body, deep],
// ribbon (its number, or none), back (the lines engraved there, or none) }.
function build(spec) {
  const sh = SHAPES[spec.shape] ? spec.shape : 'circle';
  const blank = spec.tier === 'lock' || !METALS[spec.tier];
  const tier = blank ? 'lock' : spec.tier;
  const g = new Group();
  const polished = metal(tier, false);
  g.add(new Mesh(rimGeo(sh), polished));
  // Beads round the rim from silver up.
  if (!blank && tier !== 'bronze') g.add(new Mesh(beadsGeo(sh), polished));
  const zf = DIM.thick / 2 - DIM.recess;
  const front = new Mesh(fieldGeo(sh), blank ? metal(tier, true) : enamel(spec.enamel || ['#ccc', '#888', '#444']));
  front.position.z = zf;
  g.add(front);
  // The relief: the glyph, and the number under it. On the blank, only faintly there.
  const rel = new Group();
  rel.position.z = zf;
  const num = spec.ribbon ? String(spec.ribbon) : '';
  const [alone, over, under] = layout(sh);
  const gg = spec.glyph ? glyphGeo(spec.glyph, !!num) : null;
  const raised = metal(tier, false, true);
  if (gg) { const m = new Mesh(gg, raised); m.position.y = num ? over : alone; rel.add(m); }
  if (num) { const m = new Mesh(numberGeo(num), raised); m.position.y = under; rel.add(m); }
  if (blank) rel.scale.z = 0.6;
  g.add(rel);
  // The back: a plate of satin metal, with what's engraved there.
  const back = new Mesh(fieldGeo(sh), spec.back && !blank ? backMaterial(tier, spec.back, sh) : metal(tier, true));
  back.position.z = -zf;
  back.rotation.y = Math.PI;
  g.add(back);
  g.userData.dispose = () => { if (back.material.userData.own) { back.material.bumpMap.dispose(); back.material.dispose(); } };
  return g;
}
function backMaterial(tier, lines, sh) {
  const m = METALS[tier];
  const map = engraving(lines, sh);
  const mat = new MeshPhysicalMaterial({ color: new Color(m.color), metalness: 1, roughness: 1, roughnessMap: map, bumpMap: map, bumpScale: 1.6, envMapIntensity: 1 });
  if (m.pearl) Object.assign(mat, { clearcoat: 0.5, clearcoatRoughness: 0.1, iridescence: 0.8, iridescenceIOR: 1.8, iridescenceThicknessMap: textures().film, iridescenceThicknessRange: [180, 640] });
  mat.userData.own = true;
  return mat;
}

/* ---------------------------------------------------------------- the studio */
// The light: a room dark below and soft above, with softboxes: a big warm key up to the left, a cool
// strip to the right, a long one overhead, and a rim light behind. Metal is what it reflects, so this
// is most of the look. Drawn once into an environment map. In dark, a little brighter at the rim so
// the medal's edge reads against a dark page.
const envs = {};
function studio(rr, dark) {
  const k = dark ? 'd' : 'l';
  if (envs[k]) return envs[k];
  const scene = new Scene();
  const room = new SphereGeometry(40, 32, 16);
  const col = [];
  const pos = room.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 40;
    const v = y > 0 ? lerp(0.05, 0.14, y) : lerp(0.05, 0.01, -y);
    col.push(v, v * 0.99, v * 1.02);
  }
  room.setAttribute('color', new Float32BufferAttribute(col, 3));
  scene.add(new Mesh(room, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));
  const box = (w, h, x, y, z, c, s) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c).multiplyScalar(s) }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  box(7, 7, -11, 10, 4, '#fff1df', 9); // key, up to the left
  box(2.2, 13, 14, 0, 3, '#e6f0ff', 5); // a cool strip to the right
  box(20, 2.2, 0, 15, -1, '#ffffff', 6); // overhead
  box(14, 2.5, 0, 3, -14, '#ffffff', dark ? 6 : 4); // rim, behind
  box(4, 4, -13, -6, 2, '#ffe9d6', dark ? 3 : 2); // low on the left, warm
  // In front, a horizon: a big soft light above it and dark below, so a flat polished face catches
  // light across its top and falls off toward its foot (the medal's face looks down a little).
  const front = new PlaneGeometry(40, 26, 1, 26);
  const fp = front.getAttribute('position'), fc = [];
  for (let i = 0; i < fp.count; i++) {
    const y = fp.getY(i);
    const t = clamp((y + 4.4) / 4.8, 0, 1);
    const v = 0.04 + 1.7 * t * t * (3 - 2 * t) + 0.25 * clamp(y / 13, 0, 1);
    fc.push(v, v * 0.995, v * 0.98);
  }
  front.setAttribute('color', new Float32BufferAttribute(fc, 3));
  const fm = new Mesh(front, new MeshBasicMaterial({ vertexColors: true }));
  fm.position.set(0, 0, 16);
  fm.lookAt(0, 0, 0);
  scene.add(fm);
  const pm = new PMREMGenerator(rr.r);
  const env = pm.fromScene(scene, 0.02, 0.1, 100, { size: 512 }).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  envs[k] = env;
  return env;
}

/* ---------------------------------------------------------------- the renderer */
let R = null; // { r, canvas, lost }
let SUPPORTED = null;
let releaseTimer = 0;
let live = null; // the live medal on screen, if any
let stillsAt = 0; // when a still was last drawn
const RELEASE_MS = 8000;
function supported() {
  if (SUPPORTED != null) return SUPPORTED;
  if (GH.figure3d && GH.figure3d.supported) return (SUPPORTED = !!GH.figure3d.supported());
  try { const gl = canvas2d(1, 1).getContext('webgl2'); SUPPORTED = !!gl; const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { SUPPORTED = false; }
  return SUPPORTED;
}
function renderer() {
  if (R && !R.lost) return R;
  if (SUPPORTED === false) return null;
  const canvas = doc.createElement('canvas');
  const attrs = { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' };
  let gl = null;
  try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
  if (!gl) { SUPPORTED = false; return null; }
  let r;
  try { r = new WebGLRenderer(Object.assign({ canvas, context: gl }, attrs)); } catch (e) { SUPPORTED = false; return null; }
  SUPPORTED = true;
  r.setPixelRatio(1);
  r.outputColorSpace = SRGBColorSpace;
  // Neutral keeps each metal's and enamel's own colour (ACES turned gold orange and the enamels dull).
  r.toneMapping = NeutralToneMapping;
  r.toneMappingExposure = 1.05;
  r.setClearColor(0x000000, 0);
  const me = { r, canvas, lost: false, compiled: new Set() };
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    me.lost = true;
    if (live && live.rr === me) live.fail();
    if (R === me) forget();
  });
  R = me;
  return R;
}
// Everything the renderer held goes; what's built on the CPU is built again next time.
function forget() {
  const rr = R;
  R = null;
  for (const k of Object.keys(envs)) { try { envs[k].dispose(); } catch (e) { /* ignore */ } delete envs[k]; }
  for (const g of geos.values()) if (g) g.dispose();
  geos.clear();
  for (const m of mats.values()) m.dispose();
  mats.clear();
  for (const t of enamelMaps.values()) t.dispose();
  enamelMaps.clear();
  if (TEX) { for (const t of Object.values(TEX)) t.dispose(); TEX = null; }
  if (rr) {
    try { rr.r.dispose(); } catch (e) { /* ignore */ }
    if (!rr.lost) { try { rr.r.forceContextLoss(); } catch (e) { /* ignore */ } }
    rr.canvas.width = rr.canvas.height = 1;
  }
}
// Handed back a while after the last medal drawn, with none on screen.
function maybeRelease() {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = 0;
    if (live || now() - stillsAt < RELEASE_MS - 50) { if (!live) maybeRelease(); return; }
    forget();
  }, RELEASE_MS);
}

/* ---------------------------------------------------------------- a view */
// A scene with one medal in it, lit by the studio, and its camera.
const CAM_D = 9; // the camera's distance: long, for a product's flat perspective
function view(spec, dark) {
  const rr = renderer();
  if (!rr) return null;
  const scene = new Scene();
  scene.environment = studio(rr, dark);
  const medal = build(spec);
  scene.add(medal);
  // Its shadow on the ground under it, where the SVG medal has its own (behind it, so it's never over
  // it), the same in a still and live.
  const shadow = new Mesh(geo('shadow', () => new PlaneGeometry(1, 1)), shadowMaterial(dark));
  const back = (CAM_D + 0.3) / CAM_D;
  shadow.position.set(0, (-53 / 53) * back, -0.3);
  shadow.scale.set(((2 * 34) / 53) * back, ((2 * 5.5) / 53) * back, 1);
  scene.add(shadow);
  const half = BOX * FRAME;
  const cam = new PerspectiveCamera((2 * Math.atan(half / CAM_D) * 180) / Math.PI, 1, CAM_D - 2, CAM_D + 2);
  cam.position.set(0, 0, CAM_D);
  cam.lookAt(0, 0, 0);
  return { scene, cam, medal, shadow, rr, w: shadow.scale.x, dispose() { medal.userData.dispose(); scene.remove(medal); } };
}
function shadowMaterial(dark) {
  return material(`shadow:${dark ? 1 : 0}`, () => {
    const n = 64, cv = canvas2d(n, n), ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, `rgba(0,0,0,${dark ? 0.5 : 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  });
}
// Turned by y about its own upright, then leaned by x toward the viewer; its shadow narrows as it
// turns side on, and grows with it.
function pose(v, x, y, s) {
  const k = s == null ? 1 : s;
  v.medal.rotation.set(x, y, 0, 'XYZ');
  v.medal.scale.setScalar(k);
  v.shadow.scale.x = v.w * k * (0.55 + 0.45 * Math.abs(Math.cos(y)));
}
function sizeTo(rr, w, h) {
  if (rr.canvas.width !== w || rr.canvas.height !== h) rr.r.setSize(w, h, false);
}

/* ---------------------------------------------------------------- stills */
// A picture of a medal at rest, px device pixels across its box (the SVG medal's 120 box: the
// medal, and its shadow under it), drawn larger (twice; a large one one and a half times) and scaled
// down so its edges stay fine. Returns a canvas.
function shoot(v, px) {
  const rr = v.rr;
  const ss = px <= 640 ? 2 : 1.5;
  const full = Math.round(px * FRAME * ss);
  const lv = live && live.rr === rr && live.el.isConnected ? live : null;
  const keep = lv ? [rr.canvas.width, rr.canvas.height] : null;
  sizeTo(rr, full, full);
  pose(v, REST.x, REST.y);
  v.scene.environmentRotation.set(0, 0, 0);
  rr.r.render(v.scene, v.cam);
  const out = canvas2d(px, px);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const crop = full / FRAME, at = (full - crop) / 2;
  ctx.drawImage(rr.canvas, at, at, crop, crop, 0, 0, px, px);
  if (lv) { sizeTo(rr, keep[0], keep[1]); lv.draw(); }
  stillsAt = now();
  maybeRelease();
  return out;
}
// A still of a medal, drawn now. o: { px, dark }. Returns a canvas, or null without WebGL.
function still(spec, o) {
  o = o || {};
  const v = view(spec, !!o.dark);
  if (!v) return null;
  try { return shoot(v, Math.round(o.px || 144)); } catch (e) { if (G.console) G.console.error('medal3d:', e); return null; } finally { v.dispose(); }
}
// Compiled once per kind of medal (its materials' programs): the ones a still needs that aren't yet
// compile in the background where the GPU allows, so the page's thread doesn't wait on them.
// (A kind is what decides the programs: plain metal, platinum's pearl, the frosted blank, an engraved
// back.)
const kindOf = (spec) => `${spec.tier === 'lock' || !METALS[spec.tier] ? 'lock' : spec.tier === 'platinum' ? 'pearl' : 'metal'}:${spec.back ? 1 : 0}`;
function compiled(v, spec) {
  const k = kindOf(spec);
  if (v.rr.compiled.has(k)) return Promise.resolve();
  const p = v.rr.r.compileAsync ? Promise.resolve(v.rr.r.compileAsync(v.scene, v.cam)).catch(() => {}) : Promise.resolve();
  return p.then(() => { v.rr.compiled.add(k); });
}
// A still with its shaders compiled first in the background: a promise of the canvas (or null).
function stillAsync(spec, o) {
  o = o || {};
  const v = view(spec, !!o.dark);
  if (!v) return Promise.resolve(null);
  return compiled(v, spec).then(() => {
    try { return R === v.rr ? shoot(v, Math.round(o.px || 144)) : null; } catch (e) { if (G.console) G.console.error('medal3d:', e); return null; } finally { v.dispose(); }
  });
}
// A still drawn now, in the caller's idle moment: { canvas } (one frame and its copy: a few frames'
// work once the medal's kind is compiled), or { wait }, a promise that resolves once its shaders have
// compiled in the background (the next call draws it). null without WebGL.
function stillNow(spec, o) {
  o = o || {};
  const rr = renderer();
  if (!rr) return null;
  if (!rr.compiled.has(kindOf(spec))) {
    const v = view(spec, !!o.dark);
    return { wait: compiled(v, spec).then(() => v.dispose(), () => v.dispose()) };
  }
  const pic = still(spec, o);
  return pic ? { canvas: pic } : null;
}
// A canvas as a picture file in the background (WebP where it can, else PNG): a promise of a Blob.
function encode(cv) {
  return new Promise((resolve) => {
    try {
      if (!cv.toBlob) { resolve(null); return; }
      cv.toBlob((b) => { if (b && b.type === 'image/webp') resolve(b); else cv.toBlob((p) => resolve(p || null), 'image/png'); }, 'image/webp', 0.92);
    } catch (e) { resolve(null); }
  });
}

/* ---------------------------------------------------------------- live */
// The live medal: it rests turned a little and (o.sway) sways slowly round that while the studio's
// light sweeps across it; a drag spins it (a full width of the canvas is half a turn), a flick spins
// on and slows, and it settles on its face or its back, whichever is nearer. The phone's tilt leans it
// a few degrees. Each time someone's spin turns it over (face to back, or back to face) o.onFlip() is
// called (the inline code plays a light haptic). It draws at most 30 frames a second while it sways
// and 60 while it's spun, nothing while it rests still, and stops when it's off screen, covered
// (o.covered()) or the page is hidden; it stops swaying 30 s after the last touch (a touch starts it
// again).
// o: { size (css px of the medal's box), dark, interactive, tilt, sway, covered, onFlip, onReady,
// onFail }.
function mount(host, spec, o) {
  o = o || {};
  const rr = renderer();
  if (!rr || !host) return null;
  if (live) live.destroy();
  const v = view(spec, !!o.dark);
  if (!v) return null;
  clearTimeout(releaseTimer);
  const css = Math.round((o.size || 148) * FRAME);
  const px = Math.round(css * Math.min(3, G.devicePixelRatio || 1));
  const el = rr.canvas;
  el.className = 'bdg-live';
  el.style.width = el.style.height = `${css}px`;
  el.style.touchAction = o.interactive ? 'pan-y' : '';
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
  // Where it is: its turn (yaw, radians) and speed, the sway on top of it, the tilt, a spin in.
  const st = { yaw: REST.y, vel: 0, sway: 0, drag: null, side: 1, swayFrom: now(), touched: now(), tx: 0, ty: 0, tiltX: 0, tiltY: 0, spin: null };
  let raf = 0, poll = 0, last = 0, frames = 0, visible = true, dead = false, ready = false, base = null;
  const reduced = () => !!(GH.platform && GH.platform.reducedMotion && GH.platform.reducedMotion());
  // Where the sway has it now becomes where it is, so a touch or a spin starts from what shows.
  const hold = () => { st.yaw += st.sway; st.sway = 0; };
  // Turned over (face to back, or back to face) at this turn: by someone's spin, that's o.onFlip.
  const turned = (yaw) => {
    const side = Math.cos(yaw) >= 0 ? 1 : -1;
    if (side === st.side) return;
    st.side = side;
    if ((st.drag || st.vel) && o.onFlip) o.onFlip();
  };
  const ctl = {
    el, rr, ready: null,
    // The reveal: in from small and turned away, a full turn and a little past, then still, with a
    // sweep of light across it (where the capsule was just tapped: on screen).
    spinIn() { visible = true; hold(); st.vel = 0; st.spin = { at: now() }; st.touched = now(); kick(); },
    draw() { if (ready) frame(now()); },
    fail() { if (dead) return; ctl.destroy(); if (o.onFail) Promise.resolve().then(() => o.onFail()); },
    destroy() {
      if (dead) return;
      dead = true;
      if (raf) G.cancelAnimationFrame(raf);
      clearTimeout(poll);
      raf = poll = 0;
      if (io) io.disconnect();
      G.removeEventListener('deviceorientation', onTilt);
      doc.removeEventListener('visibilitychange', onVis);
      for (const [t, f] of HANDLERS) el.removeEventListener(t, f);
      el.remove();
      v.dispose();
      if (live === ctl) live = null;
      maybeRelease();
    },
  };
  // Keyframes of the spin in (the SVG medal's CSS pop): [time, scale, turn in degrees].
  const POP = [[0, 0.3, -220], [0.48, 1.12, 16], [0.68, 0.95, -7], [0.84, 1.025, 2], [1, 1, 0]];
  function popAt(p) {
    const e = 1 - Math.pow(1 - clamp(p, 0, 1), 2.4);
    for (let i = 1; i < POP.length; i++) {
      if (e <= POP[i][0]) { const [t0, s0, a0] = POP[i - 1], [t1, s1, a1] = POP[i]; const f = (e - t0) / (t1 - t0); return [lerp(s0, s1, f), (lerp(a0, a1, f) * Math.PI) / 180]; }
    }
    return [1, 0];
  }
  // One frame: where it is now, drawn. Returns whether it's still moving.
  // (A frame drawn outside the loop, ctl.draw(), is timed by performance.now(), the loop's by its
  // frame's timestamp, and the two can disagree, by seconds under a test's clock: so the step and the
  // sway's ease-in are kept to their ranges, or a sway eased in "from the future" whirls the medal.)
  function frame(t) {
    const dt = clamp(last ? (t - last) / 1000 : 0.016, 0, 0.05);
    last = t;
    let scale = 1, yaw = st.yaw, busy = !!st.drag, sweep = Math.sin((t / 11000) * TAU) * 0.5;
    if (st.spin) {
      const p = (t - st.spin.at) / 1100;
      const [s, a] = popAt(p);
      scale = s;
      yaw = st.yaw + a;
      sweep = lerp(-1.7, 0.5, clamp(p * 1.3, 0, 1));
      if (p >= 1) { st.spin = null; st.swayFrom = t; }
      busy = true;
    } else if (!st.drag && st.vel) {
      // A flick: on at its speed, slowing; slow enough, it springs to whichever side is nearer.
      st.yaw += st.vel * dt;
      st.vel *= Math.exp(-dt * 2.4);
      if (Math.abs(st.vel) < 1.2) {
        const target = REST.y + Math.round((st.yaw - REST.y) / Math.PI) * Math.PI;
        st.vel += ((target - st.yaw) * 30 - st.vel * 9) * dt;
        if (Math.abs(target - st.yaw) < 0.002 && Math.abs(st.vel) < 0.03) { st.yaw = target; st.vel = 0; st.swayFrom = t; }
      }
      yaw = st.yaw;
      busy = true;
    }
    // At rest it sways slowly round where it settled (not with reduced motion, and not 30 s after the
    // last touch), easing in.
    const swaying = !busy && !!o.sway && !reduced() && t - st.touched < 30000;
    if (swaying) { const k = clamp((t - st.swayFrom) / 1800, 0, 1); st.sway = Math.sin(((t - st.swayFrom) / 7000) * TAU) * 0.42 * k * k; } else if (!busy) st.sway *= 0.9;
    // The phone's tilt, eased.
    st.tx += (st.tiltX - st.tx) * Math.min(1, dt * 6);
    st.ty += (st.tiltY - st.ty) * Math.min(1, dt * 6);
    yaw += st.sway + st.ty;
    turned(yaw);
    pose(v, REST.x + st.tx, yaw, scale);
    v.scene.environmentRotation.y = sweep;
    if (R !== rr || rr.lost) return false;
    sizeTo(rr, px, px);
    rr.r.render(v.scene, v.cam);
    if (!ready) { ready = true; if (o.onReady) o.onReady(ctl); }
    return busy || swaying || Math.abs(st.sway) > 0.002 || Math.abs(st.tx - st.tiltX) > 0.001 || Math.abs(st.ty - st.tiltY) > 0.001;
  }
  function loop(t) {
    raf = 0;
    if (dead || !visible || doc.hidden) return;
    // Covered by another sheet: looked at again in a moment.
    if (o.covered && o.covered()) { clearTimeout(poll); poll = setTimeout(kick, 400); return; }
    // 30 frames a second while it only sways: every other frame.
    const fast = st.drag || st.spin || st.vel;
    if (!fast && frames++ % 2 && ready) { raf = G.requestAnimationFrame(loop); return; }
    if (frame(t)) raf = G.requestAnimationFrame(loop);
  }
  function kick() { if (!raf && !dead) raf = G.requestAnimationFrame(loop); }
  // Spun by hand: a horizontal drag (a vertical one is the sheet's or the page's).
  const down = (e) => {
    if (e.button > 0) return;
    // (A medal being touched is on screen, whatever the observer last had to say.)
    visible = true;
    hold();
    st.drag = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0 };
    st.vel = 0;
    st.spin = null;
    st.touched = now();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    kick();
  };
  const move = (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    const a = ((e.clientX - d.x) / css) * Math.PI, dt = Math.max(1, e.timeStamp - d.t);
    st.yaw += a;
    // Its haptic comes with the finger, not with the next frame.
    turned(st.yaw + st.ty);
    d.v = lerp(d.v, (a / dt) * 1000, 0.5); // its speed (radians a second), smoothed
    d.x = e.clientX;
    d.t = e.timeStamp;
    st.touched = now();
    kick();
  };
  const up = (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    st.drag = null;
    // A finger that stopped before it let go doesn't flick it; it settles from where it is.
    const v0 = e.type === 'pointercancel' || e.timeStamp - d.t > 80 ? 0 : clamp(d.v, -26, 26);
    st.vel = v0 || 0.001;
    st.touched = now();
    kick();
  };
  const HANDLERS = o.interactive ? [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]] : [];
  for (const [t, f] of HANDLERS) el.addEventListener(t, f);
  // The phone's tilt (the app's WebView asks no permission for it): a few degrees either way from how
  // it was held when the medal came up.
  const onTilt = (e) => {
    if (e.beta == null || e.gamma == null || reduced()) return;
    if (!base) base = [e.beta, e.gamma];
    st.tiltX = clamp((e.beta - base[0]) * 0.012, -0.16, 0.16);
    st.tiltY = clamp((e.gamma - base[1]) * 0.012, -0.16, 0.16);
    if (Math.abs(st.tiltX - st.tx) > 0.004 || Math.abs(st.tiltY - st.ty) > 0.004) kick();
  };
  if (o.tilt) G.addEventListener('deviceorientation', onTilt);
  const onVis = () => { if (!doc.hidden) kick(); };
  doc.addEventListener('visibilitychange', onVis);
  // Drawn only while it's on screen.
  const io = G.IntersectionObserver ? new G.IntersectionObserver((list) => { for (const x of list) { visible = x.isIntersecting; if (visible) kick(); } }) : null;
  if (io) io.observe(el);
  live = ctl;
  // Its first frame once its shaders are compiled (in the background where the GPU allows).
  ctl.ready = compiled(v, spec).then(() => {
    if (dead) return false;
    frame(now());
    if (!ready) return false;
    kick();
    return true;
  });
  return ctl;
}

GH.medal3d = {
  supported, still, stillAsync, stillNow, encode, mount,
  // For tests: what it holds.
  _stats() { return { renderer: !!R, live: !!live, geos: geos.size, mats: mats.size, compiled: R ? [...R.compiled] : [] }; },
  _release() { if (live) live.destroy(); forget(); },
};
