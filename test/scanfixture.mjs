// Barcodes for the scanner's tests, drawn from their digits, and the scenes test/ui-scan.mjs films
// them in for Chromium's fake camera.
// - bars(format, code): EAN-13, UPC-A, EAN-8 or UPC-E as a string of modules, 1 a bar and 0 a space
//   (GS1 General Specifications, 5.2: the L, G and R digit patterns, the guards, the parity of the
//   first digit, and UPC-E's parity from its number system and check digit).
// - CODES: a few real, valid codes of each kind; withCheck(body) adds a check digit.
// - SCENES: the conditions the harness measures, in fractions of the frame so they hold at any size.
// - renderer(): the drawing, as one self-contained function that runs in a page (canvas 2D): a
//   package with a label on it, the bars projected through a camera (rotation, tilt, a curved can),
//   then hand shake, motion blur, defocus, dim light, glare and sensor noise.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((p) => [...p].reverse().map((b) => (b === '1' ? '0' : '1')).join(''));
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
// EAN-13: the first digit is the parity pattern of the next six (L or G).
const PARITY13 = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
// UPC-E, number system 0, by check digit (G is even parity, L odd); number system 1 swaps them.
const PARITY_E = ['GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL', 'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG'];

// The mod-10 check digit of a GTIN body: weights 3 and 1 from the right.
export function checkDigit(body) {
  let sum = 0;
  const d = String(body).split('').map(Number);
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  return String((10 - (sum % 10)) % 10);
}
export const withCheck = (body) => `${body}${checkDigit(body)}`;

// UPC-E's six digits back to the UPC-A body they stand for (number system first, no check digit).
export function upcEBody(ns, six) {
  const d = String(six), last = d[5];
  if ('012'.includes(last)) return `${ns}${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  if (last === '3') return `${ns}${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  if (last === '4') return `${ns}${d.slice(0, 4)}00000${d[4]}`;
  return `${ns}${d.slice(0, 5)}0000${last}`;
}

export function bars(format, code) {
  const s = String(code);
  const d = s.split('').map(Number);
  if (format === 'ean_13' || format === 'upc_a') {
    const c = format === 'upc_a' ? `0${s}` : s;
    if (!/^\d{13}$/.test(c) || checkDigit(c.slice(0, 12)) !== c[12]) throw new Error(`not a valid ${format}: ${s}`);
    const e = c.split('').map(Number);
    let b = '101';
    for (let i = 1; i <= 6; i++) b += (PARITY13[e[0]][i - 1] === 'L' ? L : G)[e[i]];
    b += '01010';
    for (let i = 7; i <= 12; i++) b += R[e[i]];
    return `${b}101`;
  }
  if (format === 'ean_8') {
    if (!/^\d{8}$/.test(s) || checkDigit(s.slice(0, 7)) !== s[7]) throw new Error(`not a valid EAN-8: ${s}`);
    let b = '101';
    for (let i = 0; i < 4; i++) b += L[d[i]];
    b += '01010';
    for (let i = 4; i < 8; i++) b += R[d[i]];
    return `${b}101`;
  }
  if (format === 'upc_e') {
    if (!/^[01]\d{7}$/.test(s) || checkDigit(upcEBody(s[0], s.slice(1, 7))) !== s[7]) throw new Error(`not a valid UPC-E: ${s}`);
    const pattern = PARITY_E[d[7]];
    let b = '101';
    for (let i = 1; i <= 6; i++) {
      const even = (pattern[i - 1] === 'G') !== (d[0] === 1);
      b += (even ? G : L)[d[i]];
    }
    return `${b}010101`;
  }
  throw new Error(`unknown format ${format}`);
}

// What the scanner hands back for each, as 1.11 did with ZXing: the digits, with UPC-A as the
// EAN-13 it is (a leading 0) and UPC-E written out as that too (Open Food Facts knows the long form).
export function expected(format, code) {
  if (format === 'upc_a') return `0${code}`;
  if (format === 'upc_e') return `0${withCheck(upcEBody(code[0], code.slice(1, 7)))}`;
  return code;
}

// Real, valid codes: Nutella 400 g, a Penguin paperback's ISBN, GS1's examples, Wikipedia's.
export const CODES = {
  ean_13: ['3017620422003', '9780141036144', '5901234123457', '4006381333931'],
  upc_a: ['036000291452', '012345678905', '042100005264'],
  ean_8: ['96385074', '40170725', '55123457'],
  upc_e: ['04252614', '01234565', '00123457'],
};

// The conditions. Sizes are the symbol's width (its bars, without the quiet zones) as a fraction of
// the frame's width: on a phone held upright that's the camera view's width. The scanner's food box
// covers about 0.33 of it (82% of a view magnified 2.5 times), so a code that fills the box is about
// 0.32 wide (3.6 pixels a module at 1080). blur is a fraction of a module; light and contrast scale
// the picture; noise is the sensor's, in 8-bit levels; shake moves the picture a little each frame.
// Each runs `frames` frames at 30 a second, looping.
const base = { width: 0.32, barHeight: 0.62, cx: 0.5, cy: 0.5, rot: 2, tiltX: 0, tiltY: 0, curve: 0, blur: 0.08, motion: null, shake: 0.0035, light: 1, contrast: 1, noise: 3, glare: 0, frames: 30 };
const scene = (name, format, code, opts, note) => Object.assign({}, base, { name, format, code, note }, opts);
export const SCENES = [
  scene('clear', 'ean_13', CODES.ean_13[0], {}, 'an EAN-13 that fills the box'),
  scene('clear-upca', 'upc_a', CODES.upc_a[0], {}, 'a UPC-A'),
  scene('clear-ean8', 'ean_8', CODES.ean_8[0], { width: 0.23 }, 'an EAN-8'),
  scene('clear-upce', 'upc_e', CODES.upc_e[0], { width: 0.18 }, 'a UPC-E'),
  scene('small', 'ean_13', CODES.ean_13[1], { width: 0.19 }, 'small in frame, 2.2 px a module at 1080'),
  scene('rotated', 'upc_a', CODES.upc_a[1], { rot: 20 }, 'turned 20 degrees'),
  scene('tilted', 'ean_13', CODES.ean_13[2], { rot: 4, tiltY: 38, tiltX: 12 }, 'tilted 38 degrees away on one side, 12 on the other axis'),
  scene('blurred', 'ean_13', CODES.ean_13[3], { blur: 0.55 }, 'out of focus, blur 0.55 of a module'),
  scene('dim', 'upc_a', CODES.upc_a[2], { light: 0.24, contrast: 0.6, noise: 9 }, 'dim and low contrast'),
  scene('noisy', 'ean_8', CODES.ean_8[1], { width: 0.23, noise: 30 }, 'heavy sensor noise'),
  scene('moving', 'ean_13', CODES.ean_13[0], { motion: { ax: 0.1, ay: 0.06, period: 2 }, frames: 60 }, 'swaying, with motion blur'),
  scene('upside-down', 'upc_e', CODES.upc_e[1], { width: 0.18, rot: 184 }, 'upside down'),
  scene('vertical', 'ean_13', CODES.ean_13[1], { rot: 93 }, 'turned on its side'),
  scene('curved', 'ean_13', CODES.ean_13[2], { curve: 0.75, rot: 1 }, 'round a can'),
  scene('glare', 'ean_13', CODES.ean_13[3], { glare: 0.9 }, 'a shiny wrapper catching the light'),
  scene('off-box', 'ean_13', CODES.ean_13[0], { cy: 0.27 }, 'above the box, still in the picture'),
  scene('too-close', 'ean_13', CODES.ean_13[1], { width: 0.62, blur: 0.25 }, 'closer than the box, wider than it'),
  scene('qr', 'qr_code', null, { width: 0.42, rot: 6, noise: 4 }, 'a shared plan\'s QR code on a phone screen'),
];

// Scenes nobody could read, for what the screen says after a few seconds without a read.
export const HINT_SCENES = [
  scene('dark', null, null, { light: 0.06, noise: 5 }, 'a dark kitchen, no code in sight'),
  scene('far', 'ean_13', CODES.ean_13[2], { width: 0.075 }, 'too far: under a pixel a module'),
  scene('huge', 'ean_13', CODES.ean_13[3], { width: 1.5, blur: 0.15 }, 'so close the bars run off the picture'),
  scene('shaky', 'ean_13', CODES.ean_13[0], { motion: { zigzag: 0.08, period: 0.25 }, frames: 30 }, 'a hand that won\'t keep still'),
];

// The drawing, run in a page: renderer() returns { frame(canvas, scene, i) } where scene carries
// `bits` (the modules) or `qr` ({ size, modules }). Self-contained, so it can be sent as source.
export function renderer() {
  // A small seeded generator, so every run films the same video.
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const hash = (str) => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const rad = (deg) => (deg * Math.PI) / 180;
  // Smooth noise for the hand's shake: a sum of slow sines with seeded phases.
  const wobble = (seed, t) => { const r = rng(seed); let v = 0; for (let k = 1; k <= 3; k++) v += Math.sin(t * (1.3 + r() * 2.2) * k + r() * 6.283) / k; return v / 1.83; };

  // The camera: a 43 degree field across the frame's width (a phone's main camera, upright, 16:9).
  function camera(W, H, sc, t) {
    const f = W / (2 * Math.tan(rad(43) / 2));
    const mods = sc.qr ? sc.qr.size : sc.bits ? sc.bits.length : 95;
    const Z0 = (f * mods) / (sc.width * W);
    let cx = sc.cx * W, cy = sc.cy * H, roll = sc.rot;
    const seed = hash(sc.name);
    cx += sc.shake * W * wobble(seed, t * 6.283);
    cy += sc.shake * W * wobble(seed + 1, t * 6.283);
    roll += 0.6 * wobble(seed + 2, t * 6.283);
    if (sc.motion && sc.motion.zigzag) {
      // Side to side at one speed, turning at once: never still, always across the bars.
      const ph = (t / sc.motion.period) % 1;
      cx += sc.motion.zigzag * W * (2 * Math.abs(2 * ph - 1) - 1);
    } else if (sc.motion) {
      const w = (2 * Math.PI) / sc.motion.period;
      cx += sc.motion.ax * W * Math.sin(w * t);
      cy += sc.motion.ay * W * Math.sin(2 * w * t + 0.7);
    }
    const [a, b, c] = [rad(sc.tiltX), rad(sc.tiltY), rad(roll)];
    // Rz(roll) . Rx(tiltX) . Ry(tiltY)
    const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
    const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
    const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
    const M = mul(Rz, mul(Rx, Ry));
    const radius = sc.curve ? sc.curve * mods : 0;
    // A point of the label in module units (u across, v down, from the symbol's centre) to pixels.
    return (u, v) => {
      let X = u, Y = v, Z = 0;
      if (radius) { const th = u / radius; X = radius * Math.sin(th); Z = radius * (1 - Math.cos(th)); }
      const x = M[0][0] * X + M[0][1] * Y + M[0][2] * Z, y = M[1][0] * X + M[1][1] * Y + M[1][2] * Z, z = M[2][0] * X + M[2][1] * Y + M[2][2] * Z + Z0;
      return [cx + (f * x) / z, cy + (f * y) / z];
    };
  }
  const quad = (ctx, P, u0, v0, u1, v1, steps) => {
    // A rectangle of the label, its edges split so a curved can bends them.
    const n = steps || 1;
    ctx.beginPath();
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(P(u0 + ((u1 - u0) * i) / n, v0));
    for (let i = 0; i <= n; i++) pts.push(P(u1 - ((u1 - u0) * i) / n, v1));
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
  };
  // The package around the label: a coloured panel with shapes and lines of "text".
  function packaging(ctx, W, H, sc) {
    const r = rng(hash(`${sc.name}-pack`));
    const hue = Math.floor(r() * 360);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${hue} 55% 42%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 30%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `hsl(${(hue + r() * 120) % 360} ${40 + r() * 40}% ${25 + r() * 50}% / ${0.35 + r() * 0.5})`;
      ctx.beginPath();
      ctx.arc(r() * W, r() * H, (0.05 + r() * 0.25) * W, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(250 250 245 / 0.85)';
    for (let i = 0; i < 14; i++) {
      const y = r() * H, x = r() * W * 0.7, w = (0.1 + r() * 0.4) * W;
      ctx.fillRect(x, y, w, 0.012 * W);
    }
  }
  function symbol(ctx, P, sc) {
    if (sc.qr) {
      const n = sc.qr.size, h = n / 2, q = 4;
      ctx.fillStyle = '#fbfbfb';
      quad(ctx, P, -h - q - 3, -h - q - 3, h + q + 3, h + q + 3, 4);
      ctx.fillStyle = '#111';
      for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
          if (!sc.qr.modules[y * n + x]) { x++; continue; }
          const s = x;
          while (x < n && sc.qr.modules[y * n + x]) x++;
          quad(ctx, P, s - h - 0.02, y - h - 0.02, x - h + 0.02, y - h + 1.02, 1);
        }
      }
      return;
    }
    const bits = sc.bits, n = bits.length, h = n / 2;
    const barH = sc.barHeight * n, top = -barH / 2, quiet = 9;
    const guardsLong = sc.format !== 'ean_8' ? 5 : 4;
    const steps = sc.curve ? 6 : 1;
    // The label: white, a little warm, with room for the digits under the bars.
    ctx.fillStyle = '#f6f5ef';
    quad(ctx, P, -h - quiet - 2, top - 6, h + quiet + 2, top + barH + 14, sc.curve ? 24 : 1);
    ctx.fillStyle = '#16161a';
    // Which modules are guards (their bars run longer than the digits').
    const guard = new Array(n).fill(false);
    const mark = (from, len) => { for (let i = from; i < from + len; i++) guard[i] = true; };
    mark(0, 3);
    if (sc.format === 'upc_e') mark(n - 6, 6);
    else { mark(n - 3, 3); mark(Math.floor(n / 2) - 2, 5); }
    let i = 0;
    while (i < n) {
      if (bits[i] !== '1') { i++; continue; }
      const s = i, g = guard[i];
      while (i < n && bits[i] === '1' && guard[i] === g) i++;
      // Bars print a touch thinner than their modules (ink spread is compensated for on presses).
      quad(ctx, P, s - h + 0.04, top, i - h - 0.04, top + barH + (g ? guardsLong : 0), steps);
    }
    // The digits, as a printer sets them: under the bars, between the guards.
    const digits = sc.code.split('');
    const fs = 9;
    const [x0, y0] = P(-h, top + barH + 3.5), [x1, y1] = P(h, top + barH + 3.5), [xu, yu] = P(-h, top + barH + 3.5 - fs);
    const ang = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0), up = Math.hypot(xu - x0, yu - y0);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(ang);
    ctx.font = `${Math.max(4, up)}px monospace`;
    ctx.textBaseline = 'top';
    const step = len / (digits.length + 1);
    digits.forEach((dg, k) => ctx.fillText(dg, step * (k + 0.6), 0));
    ctx.restore();
  }
  function scene(W, H, sc, t) {
    const c = new OffscreenCanvas(W, H), ctx = c.getContext('2d');
    packaging(ctx, W, H, sc);
    if (sc.bits || sc.qr) symbol(ctx, camera(W, H, sc, t), sc);
    return c;
  }
  // One frame: the scene (averaged over the exposure when it moves), defocus, light, glare, noise.
  function frame(out, sc, i) {
    const W = out.width, H = out.height, t = i / 30;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    const mods = sc.qr ? sc.qr.size : sc.bits ? sc.bits.length : 95;
    const modPx = (sc.width * W) / mods;
    const filters = [];
    if (sc.blur > 0) filters.push(`blur(${(sc.blur * modPx).toFixed(2)}px)`);
    if (sc.light !== 1) filters.push(`brightness(${sc.light})`);
    if (sc.contrast !== 1) filters.push(`contrast(${sc.contrast})`);
    ctx.filter = filters.join(' ') || 'none';
    ctx.globalAlpha = 1;
    if (sc.motion) {
      // A 1/60 s exposure: six positions across it, averaged.
      const k = 6;
      for (let j = 0; j < k; j++) {
        ctx.globalAlpha = 1 / (j + 1);
        ctx.drawImage(scene(W, H, sc, t + (j / (k - 1)) / 60), 0, 0);
      }
      ctx.globalAlpha = 1;
    } else ctx.drawImage(scene(W, H, sc, t), 0, 0);
    ctx.filter = 'none';
    if (sc.glare) {
      // A light reflected in a glossy wrapper: a tall bright patch over the left of the code, bars
      // and spaces alike washed out under it, drifting a little as the hand moves.
      const P = camera(W, H, sc, t);
      const [gx, gy] = P(-mods * 0.16 + 2 * Math.sin(t * 2), -mods * 0.04);
      const r0 = 0.15 * sc.width * W;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(rad(sc.rot));
      ctx.scale(1, 1.9);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r0);
      g.addColorStop(0, `rgb(255 255 255 / ${sc.glare})`);
      g.addColorStop(0.5, `rgb(255 255 255 / ${sc.glare * 0.8})`);
      g.addColorStop(1, 'rgb(255 255 255 / 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g;
      ctx.fillRect(-r0, -r0, 2 * r0, 2 * r0);
      ctx.restore();
    }
    // Vignetting: the corners a little darker, as a phone's lens leaves them.
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, 'rgb(0 0 0 / 0)');
    v.addColorStop(1, `rgb(0 0 0 / ${0.35 * sc.light})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    if (sc.noise > 0) {
      // Mostly brightness noise, a little colour, from a table of normal samples picked by xorshift.
      const img = ctx.getImageData(0, 0, W, H), d = img.data;
      let x = hash(`${sc.name}-noise-${i}`) | 1;
      const s = sc.noise, cs = s * 0.25;
      for (let p = 0; p < d.length; p += 4) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        const n = NORMAL[x & 0xffff] * s, cn = NORMAL[(x >>> 16) & 0xffff] * cs;
        d[p] += n + cn; d[p + 1] += n; d[p + 2] += n - cn;
      }
      ctx.putImageData(img, 0, 0);
    }
  }
  // 65,536 samples of a unit normal (the sum of four uniforms, scaled).
  const NORMAL = (() => { const r = rng(12345), t = new Float32Array(65536); for (let k = 0; k < t.length; k++) t[k] = (r() + r() + r() + r() - 2) / 0.57735; return t; })();
  return { frame };
}
