/* The barcode reader's worker (lazy/barcode-worker.js): ZXing compiled to WebAssembly (zxing-wasm,
 * MIT), off the page's thread, so the camera's picture and the sheet stay smooth while it reads and
 * a slow phone still reads every frame it can. The .wasm ships next to it; nothing is downloaded.
 * lazy/barcode.js sends it pictures and gets back what it read.
 *  in:  { id, type: 'init' }
 *       { id, type: 'read', image, rect?, scale?, formats, qr, look, enhance }
 *         image: a VideoFrame (the camera's, taken over: only rect's pixels are copied out, and only
 *         their brightness, so nothing is converted to colour), an ImageBitmap or ImageData
 *  out: { id, ok, found: [{ format, rawValue, cornerPoints }], w, h, how, ms, look } or { id, ok: false, error }
 * It reads rect of the picture, scaled by scale (w x h as read); the corners come back in the
 * received picture's own pixels. With enhance, the part is evened out first (for a blurred, dim or
 * noisy code); with look, it also says how it looks, for the scanner's hints: its light, how much it
 * changed since the last one, and the run of bars in it, if any (where, and how sharp).
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const here = self.location.href;
// Without locateFile the library would fetch the .wasm from a CDN (the app's policy blocks that).
const ready = prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? new URL(path, here).href : prefix + path) },
  fireImmediately: true,
});

// The Barcode Detection API's names, and ZXing's.
const ZX = { ean_13: 'EAN13', ean_8: 'EAN8', upc_a: 'UPCA', upc_e: 'UPCE', qr_code: 'QRCode' };
const NAME = { EAN13: 'ean_13', EAN8: 'ean_8', UPCA: 'upc_a', UPCE: 'upc_e', QRCode: 'qr_code' };

/* ---------------------------------------------------------------- the picture's brightness */
// { Y (one byte a pixel), w, h } of rect scaled by scale, from whatever came.
let canvas = null, ctx = null;
function draw(src, sx, sy, sw, sh, w, h) {
  if (!canvas) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return fromRgba(ctx.getImageData(0, 0, w, h));
}
function fromRgba(img) {
  const { data, width: w, height: h } = img;
  const Y = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < Y.length; i++, o += 4) Y[i] = (data[o] * 77 + data[o + 1] * 150 + data[o + 2] * 29) >> 8;
  return { Y, w, h };
}
// A plane scaled by bilinear sampling (only ever down, for a picture too big to be worth reading whole).
function resample(p, w, h) {
  if (w === p.w && h === p.h) return p;
  const Y = new Uint8Array(w * h), kx = p.w / w, ky = p.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(p.h - 1.001, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = fy | 0, ty = fy - y0;
    const r0 = y0 * p.w, r1 = Math.min(p.h - 1, y0 + 1) * p.w;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(p.w - 1.001, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = fx | 0, tx = fx - x0, x1 = Math.min(p.w - 1, x0 + 1);
      const a = p.Y[r0 + x0] + (p.Y[r0 + x1] - p.Y[r0 + x0]) * tx, b = p.Y[r1 + x0] + (p.Y[r1 + x1] - p.Y[r1 + x0]) * tx;
      Y[y * w + x] = a + (b - a) * ty;
    }
  }
  return { Y, w, h };
}
// The plane comes with where it was cut from, in the received picture's pixels (x0, y0, cw, ch).
const PLANAR = /^(I420|I420A|I422|I422A|I444|I444A|NV12)$/;
async function luma(m) {
  const img = m.image;
  const scale = m.scale || 1;
  if (typeof VideoFrame !== 'undefined' && img instanceof VideoFrame) {
    try {
      const fw = img.displayWidth, fh = img.displayHeight;
      const r = m.rect || { x: 0, y: 0, w: fw, h: fh };
      // Copy out only the rectangle's brightness (the first plane), on the even grid the formats need.
      const x0 = Math.max(0, Math.floor(r.x / 2) * 2), y0 = Math.max(0, Math.floor(r.y / 2) * 2);
      const x1 = Math.min(fw, Math.ceil((r.x + r.w) / 2) * 2), y1 = Math.min(fh, Math.ceil((r.y + r.h) / 2) * 2);
      const w = x1 - x0, h = y1 - y0;
      const w2 = Math.max(1, Math.round(w * scale)), h2 = Math.max(1, Math.round(h * scale));
      const vr = img.visibleRect || { x: 0, y: 0, width: img.codedWidth, height: img.codedHeight };
      // Straight off the frame's own pixels when they're shown as they are (not turned, mirrored
      // or scaled); otherwise drawn, which turns them as the video does.
      if (img.format && PLANAR.test(img.format) && !img.rotation && !img.flip && vr.width === fw && vr.height === fh && vr.x % 2 === 0 && vr.y % 2 === 0) {
        const rect = { x: vr.x + x0, y: vr.y + y0, width: w, height: h };
        const buf = new Uint8Array(img.allocationSize({ rect }));
        const layout = await img.copyTo(buf, { rect });
        const { offset, stride } = layout[0];
        const Y = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) Y.set(buf.subarray(offset + y * stride, offset + y * stride + w), y * w);
        return Object.assign(resample({ Y, w, h }, w2, h2), { x0, y0, cw: w, ch: h, how: 'plane' });
      }
      return Object.assign(draw(img, x0, y0, w, h, w2, h2), { x0, y0, cw: w, ch: h, how: 'drawn' });
    } finally { img.close(); }
  }
  if (img && typeof img.close === 'function') {
    try {
      const r = m.rect || { x: 0, y: 0, w: img.width, h: img.height };
      return Object.assign(draw(img, r.x, r.y, r.w, r.h, Math.max(1, Math.round(r.w * scale)), Math.max(1, Math.round(r.h * scale))), { x0: r.x, y0: r.y, cw: r.w, ch: r.h, how: 'bitmap' });
    } finally { img.close(); }
  }
  const p = fromRgba(img);
  return Object.assign(p, { x0: 0, y0: 0, cw: p.w, ch: p.h, how: 'pixels' });
}
function rgba(p) {
  const data = new Uint8ClampedArray(p.w * p.h * 4);
  for (let i = 0, o = 0; i < p.Y.length; i++, o += 4) { const v = p.Y[i]; data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255; }
  return new ImageData(data, p.w, p.h);
}

/* ---------------------------------------------------------------- evening it out */
// For a blurred, dim or noisy code: each pixel averaged with the rows above and below (along the bars
// of a code held about upright, so the noise drops and the bars stay sharp), then sharpened across
// (an unsharp mask: the difference from a Gaussian, amplified, which undoes much of a blur) and
// stretched to the full range. Tried on the test videos (test/ui-scan.mjs): EVEN reads a code blurred
// by half a module, which no setting of ZXing's does, and the dim and noisy ones.
// But sharpening a picture that moved can make bars that aren't there: on the swaying code it read
// a wrong number with a right check digit 4 times in 23, the same wrong number each time. So a read
// from it only counts when another setting reads the same code in the same frame (CHECK: one tuned
// for blur, one for dim light); they never agreed on a wrong number there, and agreed on the right
// one in every blurred frame and most dim ones.
const EVEN = { rows: 4, sigma: 2, amount: 2 };
const CHECK = [{ rows: 4, sigma: 3, amount: 3 }, { rows: 2, sigma: 1.2, amount: 1.5 }];
function enhance(p, o) {
  const { Y, w, h } = p;
  const rows = o.rows, span = 2 * rows + 1;
  // The rows' average, a running sum down each column.
  const V = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -rows; d <= rows; d++) s += Y[Math.max(0, Math.min(h - 1, d)) * w + x];
    for (let y = 0; y < h; y++) {
      V[y * w + x] = s / span;
      s += Y[Math.min(h - 1, y + rows + 1) * w + x] - Y[Math.max(0, y - rows) * w + x];
    }
  }
  const R = Math.max(2, Math.ceil(o.sigma * 2.5)), K = [];
  let ks = 0;
  for (let i = -R; i <= R; i++) { const v = Math.exp(-(i * i) / (2 * o.sigma * o.sigma)); K.push(v); ks += v; }
  for (let i = 0; i < K.length; i++) K[i] /= ks;
  const out = new Uint8Array(w * h), hist = new Uint32Array(256);
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      let blur = 0;
      for (let i = -R; i <= R; i++) blur += K[i + R] * V[r + Math.max(0, Math.min(w - 1, x + i))];
      const c = V[r + x], v = c + o.amount * (c - blur);
      S[r + x] = v;
      hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    }
  }
  let lo = 0, hi = 255, n = 0;
  for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= S.length * 0.01) { lo = v; break; } }
  n = 0;
  for (let v = 255; v >= 0; v--) { n += hist[v]; if (n >= S.length * 0.01) { hi = v; break; } }
  const k = 255 / Math.max(16, hi - lo);
  for (let i = 0; i < S.length; i++) out[i] = Math.max(0, Math.min(255, (S[i] - lo) * k));
  return { Y: out, w, h };
}

/* ---------------------------------------------------------------- how it looks */
// The light (the mean brightness), and the change since the last look: its brightness down every
// column and along every row, lined up with the last look's at the best shift (up to an eighth of
// the picture either way), and what still differs. A hand's tremor moves the picture a few pixels,
// which lines back up; a picture smeared by moving, or swept further, doesn't. (A grid of averages
// took the tremor across sharp bars for movement.)
let previous = null;
function profiles(Y, w, h) {
  const cols = new Float32Array(w), rows = new Float32Array(h), nr = Math.ceil(h / 3), nc = Math.ceil(w / 3);
  let light = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x++) cols[x] += Y[y * w + x];
  }
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x += 3) s += Y[y * w + x];
    rows[y] = s / nc;
    light += rows[y];
  }
  for (let x = 0; x < w; x++) cols[x] /= nr;
  return { cols, rows, light: light / Math.max(1, h) };
}
function apart(a, b) {
  if (a.length !== b.length) return 255;
  const S = Math.max(2, Math.round(a.length / 8));
  let best = Infinity;
  for (let s = -S; s <= S; s++) {
    let sum = 0, n = 0;
    for (let i = Math.max(0, -s); i < Math.min(a.length, a.length - s); i++) { sum += Math.abs(a[i] - b[i + s]); n++; }
    if (n) best = Math.min(best, sum / n);
  }
  return best;
}
let lastScan = null;
function look(p, scan) {
  const { Y, w, h } = p;
  if (scan !== lastScan) { previous = null; lastScan = scan; }
  const now = profiles(Y, w, h);
  const change = previous ? Math.max(apart(now.cols, previous.cols), apart(now.rows, previous.rows)) : 0;
  previous = now;
  return { light: Math.round(now.light), change: Math.round(change * 10) / 10, bars: bars(Y, w, h) };
}

// Bars along four rows through the middle: the edges (where the brightness steps by a quarter of the
// row's range or more), then the longest run of them close together (a barcode's are at most a few
// modules apart, and its quiet zones end it): where it is, how many edges, the median step between
// them and how sharp they are. full: in two rows or more, modules bigger than the box allows, as
// when the code is closer than the box.
function bars(Y, w, h) {
  if (w < 40 || h < 8) return null;
  let best = null, full = 0;
  const row = new Int16Array(w), hist = new Uint32Array(256);
  for (const f of [0.38, 0.46, 0.54, 0.62]) {
    const y = Math.floor(f * h), r0 = Math.max(0, y - 1) * w, r1 = y * w, r2 = Math.min(h - 1, y + 1) * w;
    hist.fill(0);
    for (let x = 0; x < w; x++) {
      const v = (Y[r1 + x] * 2 + Y[r0 + x] + Y[r2 + x]) >> 2;
      row[x] = v;
      hist[v]++;
    }
    let lo = 0, hi = 255, c = 0;
    for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= w * 0.05) { lo = v; break; } }
    c = 0;
    for (let v = 255; v >= 0; v--) { c += hist[v]; if (c >= w * 0.05) { hi = v; break; } }
    const range = hi - lo;
    if (range < 18) continue;
    const T = range * 0.25;
    const xs = [], gs = [];
    for (let x = 2; x < w - 2; x++) {
      const g = Math.abs(row[x + 1] - row[x - 1]);
      if (g >= T && g >= Math.abs(row[x + 2] - row[x]) && g > Math.abs(row[x] - row[x - 2])) { xs.push(x); gs.push(g); }
    }
    // Runs of edges no further apart than four and a half of the row's usual steps (its median gap,
    // about a module; a code's widest bar or space is four): a code's bars, which its quiet zones
    // end, at any size. The longest run's own median step says how big its modules are: a code that
    // fills the box steps about 0.8% of the picture between edges, so over 1.4% it's well over the
    // box, or blurred into wider bars, as a code too close to focus on is (full).
    const steps = [];
    for (let k = 1; k < xs.length; k++) steps.push(xs[k] - xs[k - 1]);
    steps.sort((a, b) => a - b);
    const gap = Math.max(10, 4.5 * (steps.length ? steps[steps.length >> 1] : 0));
    let s = 0, rowBest = null;
    for (let k = 1; k <= xs.length; k++) {
      if (k < xs.length && xs[k] - xs[k - 1] <= gap) continue;
      const n = k - s;
      if (n >= 10 && (!rowBest || n > rowBest.edges)) {
        const own = [];
        for (let q = s + 1; q < k; q++) own.push(xs[q] - xs[q - 1]);
        own.sort((a, b) => a - b);
        // Sharpness: the strongest quarter of its edges against the row's range (a crisp edge
        // steps the whole range within two pixels; a blurred one doesn't).
        const strong = gs.slice(s, k).sort((a, b) => b - a).slice(0, Math.max(1, n >> 2));
        rowBest = { from: xs[s] / w, to: xs[k - 1] / w, edges: n, step: own[own.length >> 1] / w, sharp: Math.min(1, strong.reduce((a, b) => a + b, 0) / strong.length / range) };
      }
      s = k;
    }
    if (rowBest && rowBest.step > 0.014) full++;
    if (rowBest && (!best || rowBest.edges > best.edges)) best = rowBest;
  }
  if (!best && !full) return null;
  return Object.assign({ full: full >= 2 }, best ? { from: Math.round(best.from * 1000) / 1000, to: Math.round(best.to * 1000) / 1000, edges: best.edges, step: Math.round(best.step * 1000) / 1000, sharp: Math.round(best.sharp * 100) / 100 } : {});
}

/* ---------------------------------------------------------------- reading */
self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'init') {
      await ready;
      self.postMessage({ id: m.id, ok: true });
      return;
    }
    if (m.type !== 'read') return;
    const t0 = performance.now();
    const p = await luma(m);
    await ready;
    const formats = (m.formats || []).map((f) => ZX[f]).filter(Boolean);
    // For 1D codes: try harder (more rows), turned a quarter (a code on its side) and upside down,
    // light bars on dark, and smaller copies of a big picture. One code is enough.
    const opts = { formats, tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1, textMode: m.qr ? 'Plain' : 'HRI' };
    let found = await readBarcodes(rgba(m.enhance ? enhance(p, EVEN) : p), opts);
    if (m.enhance && found.length) {
      // Evened out, it only counts if another setting reads the same in this frame.
      const text = found[0].text;
      let agreed = false;
      for (const o of CHECK) {
        const again = await readBarcodes(rgba(enhance(p, o)), opts);
        if (again.some((r) => r.text === text)) { agreed = true; break; }
      }
      if (!agreed) found = [];
    }
    // Corners in the received picture's pixels.
    const kx = p.cw / p.w, ky = p.ch / p.h;
    const out = found.filter((r) => r.isValid && r.text).map((r) => {
      const q = r.position;
      return { format: NAME[r.format] || String(r.format), rawValue: r.text, cornerPoints: [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft].map((c) => ({ x: p.x0 + c.x * kx, y: p.y0 + c.y * ky })) };
    });
    self.postMessage({ id: m.id, ok: true, found: out, w: p.w, h: p.h, how: p.how, ms: Math.round(performance.now() - t0), look: m.look ? look(p, m.scan) : null });
  } catch (err) {
    if (m.image && typeof m.image.close === 'function') { try { m.image.close(); } catch (x) { /* gone already */ } }
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
  }
};
