/* QR codes for sharing a plan: text in, a square of modules out, drawn as SVG. Byte mode (UTF-8),
 * any version from 1 to 40, error correction L, M, Q or H, and the mask with the lowest penalty,
 * following ISO/IEC 18004. Plain code with no dependencies, so the share page (docs/p/) can inline
 * it too. GH.qr = { encode(text, { ecl, minVersion }) → { version, size, ecl, mask, dark(x, y) },
 * svg(text | code, opts) → an <svg> string, capacity(version, ecl) }.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});

  // Error correction codewords per block, and blocks, for each level (L, M, Q, H) and version (1-40).
  const ECC_PER_BLOCK = {
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const BLOCKS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  // Modules left for data and error correction once the function patterns are drawn.
  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const align = Math.floor(ver / 7) + 2;
      n -= (25 * align - 10) * align - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver - 1] * BLOCKS[ecl][ver - 1];
  // How many bytes of text a version holds at a level (byte mode).
  const countBits = (ver) => (ver < 10 ? 8 : 16);
  const capacity = (ver, ecl) => Math.floor((dataCodewords(ver, ecl) * 8 - 4 - countBits(ver)) / 8);

  /* ---------------------------------------------------------------- Reed-Solomon over GF(256) */
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(degree) {
    const out = new Array(degree).fill(0);
    out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        out[j] = mul(out[j], root);
        if (j + 1 < degree) out[j] ^= out[j + 1];
      }
      root = mul(root, 2);
    }
    return out;
  }
  function remainder(data, div) {
    const out = div.map(() => 0);
    for (const b of data) {
      const f = b ^ out.shift();
      out.push(0);
      for (let i = 0; i < div.length; i++) out[i] ^= mul(div[i], f);
    }
    return out;
  }

  /* ---------------------------------------------------------------- UTF-8 */
  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(text)));
    const s = unescape(encodeURIComponent(String(text)));
    return Array.from(s, (c) => c.charCodeAt(0));
  }

  /* ---------------------------------------------------------------- encoding */
  // opts.ecl picks the level; without it, M while that fits in version 10 (a code a camera reads off
  // a screen easily), else L, which keeps a long text in fewer, bigger modules.
  function encode(text, opts) {
    const o = opts || {};
    const bytes = Array.isArray(text) ? text.slice() : utf8(text);
    const fit = (l) => { for (let v = Math.max(1, o.minVersion || 1); v <= 40; v++) if (capacity(v, l) >= bytes.length) return v; return 0; };
    let ecl = o.ecl || 'M';
    let ver = fit(ecl);
    if (!o.ecl && (!ver || ver > 10)) { const v2 = fit('L'); if (v2 && (!ver || v2 < ver)) { ecl = 'L'; ver = v2; } }
    if (!ver) throw new Error('qr: too much text for a QR code');
    // The bit stream: mode, count, data, terminator, padding.
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4);
    put(bytes.length, countBits(ver));
    for (const b of bytes) put(b, 8);
    const cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);
    // Split into blocks, add error correction, interleave.
    const nBlocks = BLOCKS[ecl][ver - 1], eccLen = ECC_PER_BLOCK[ecl][ver - 1];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks), shortLen = Math.floor(raw / nBlocks);
    const div = divisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]); });
    return draw(ver, ecl, words);
  }

  function draw(ver, ecl, words) {
    const size = ver * 4 + 17;
    const mod = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const set = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
    // Timing lines, finders, alignment patterns.
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const pos = alignPositions(ver, size);
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Reserve the format areas (drawn for real once the mask is picked), and the version blocks.
    formatBits(set, size, ecl, 0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = (v >>> i) & 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    // Data, in two-column zigzags from the bottom right.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!fn[y * size + x] && i < words.length * 8) {
            mod[y * size + x] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
    // The mask with the lowest penalty.
    let best = null;
    for (let m = 0; m < 8; m++) {
      const t = mod.slice();
      applyMask(t, fn, size, m);
      formatBits((x, y, d) => { t[y * size + x] = d ? 1 : 0; }, size, ecl, m);
      const p = penalty(t, size);
      if (!best || p < best.p) best = { p, m, t };
    }
    const out = best.t;
    return { version: ver, size, ecl, mask: best.m, modules: out, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && out[y * size + x] === 1 };
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const out = [6];
    for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
    return out;
  }

  function formatBits(set, size, ecl, mask) {
    const data = (ECL_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = (i) => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, 1);
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  function applyMask(mod, fn, size, m) {
    const f = MASKS[m];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && f(x, y)) mod[y * size + x] ^= 1;
  }

  // Runs of one colour, 2×2 blocks, finder look-alikes and the dark/light balance (ISO 18004 §7.8.3).
  function penalty(mod, size) {
    let p = 0;
    const at = (x, y) => mod[y * size + x];
    const lines = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b <= size; b++) {
          if (b < size && get(a, b) === get(a, b - 1)) { run++; continue; }
          if (run >= 5) p += 3 + (run - 5);
          run = 1;
        }
        // 1:1:3:1:1 with four light modules on either side.
        for (let b = 0; b + 11 <= size; b++) {
          let s = '';
          for (let k = 0; k < 11; k++) s += get(a, b + k);
          if (s === '10111010000' || s === '00001011101') p += 40;
        }
      }
    };
    lines((a, b) => at(b, a));
    lines((a, b) => at(a, b));
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
    }
    let dark = 0;
    for (let i = 0; i < mod.length; i++) dark += mod[i];
    const total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  /* ---------------------------------------------------------------- drawing */
  // An <svg> of the code with a four-module quiet zone. Rows of dark modules are merged into one
  // rectangle each, so the path stays small. opts: { ecl, label, cls, fg, bg }.
  function svg(input, opts) {
    const o = opts || {};
    const q = typeof input === 'string' || Array.isArray(input) ? encode(input, o) : input;
    const pad = 4, n = q.size + pad * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) {
      for (let x = 0; x < q.size; x++) {
        if (!q.dark(x, y)) continue;
        let w = 1;
        while (q.dark(x + w, y)) w++;
        d += `M${x + pad} ${y + pad}h${w}v1h-${w}z`;
        x += w - 1;
      }
    }
    const label = o.label ? ` role="img" aria-label="${String(o.label).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${o.cls || 'qr'}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"${label}><rect width="${n}" height="${n}" fill="${o.bg || '#fff'}"/><path d="${d}" fill="${o.fg || '#000'}"/></svg>`;
  }

  GH.qr = { encode, svg, capacity };
})(typeof window !== 'undefined' ? window : globalThis);
