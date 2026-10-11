// Renders the app icon from the logo artwork (art/logo.png: a white heart with a pulse line on a blue,
// green and amber gradient rounded square, on a transparent surround) with Chromium's canvas, since
// there's no image library here.
//
//   node scripts/make-icons.mjs
//
// Writes:
// - android/res/mipmap-*/ic_launcher_foreground.png: the adaptive icon's full-bleed layer (108 dp).
//   The heart and its pulse line sit well inside the 66 dp safe zone and the gradient runs to every
//   edge, so no launcher mask or parallax shows the artwork's rim or surround.
// - docs/icon-512.png: the Play Store icon (full-bleed square; Play rounds the corners itself).
// - src/data/brand.js: a small logo as a data URI for the welcome screen and Profile.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const src = 'data:image/png;base64,' + readFileSync(join(root, 'art/logo.png')).toString('base64');
const DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
const out = await page.evaluate(async ({ src, sizes }) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bx = base.getContext('2d');
  bx.drawImage(img, 0, 0);
  const px = bx.getImageData(0, 0, W, H).data;
  // The coloured square: every pixel that isn't near-white.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      if (a > 200 && (Math.max(r, g, b) - Math.min(r, g, b) > 28 || Math.min(r, g, b) < 200)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const sq = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // The artwork's inner area (inside the glassy rim), which holds the gradient and the heart. The
  // heart with its pulse line is about 75% of this crop's width.
  const INSET = 0.05;
  const C = { x: sq.x + sq.w * INSET, y: sq.y + sq.h * INSET, w: sq.w * (1 - 2 * INSET), h: sq.h * (1 - 2 * INSET) };
  // In the 108 dp layer the crop is drawn 60 dp wide, so the heart is ~46 dp: about two thirds of the
  // 72 dp visible icon and well inside the 66 dp safe zone. Past the crop, the gradient continues:
  // its edge pixels are stretched outward and blurred, and the sharp crop fades into that.
  const CROP_DP = 60, FEATHER_DP = 7;
  function layer(size) {
    const dp = size / 108;
    const tw = CROP_DP * dp, th = tw * C.h / C.w, tx = (size - tw) / 2, ty = (size - th) / 2;
    const ext = document.createElement('canvas');
    ext.width = ext.height = size;
    const e = ext.getContext('2d');
    e.imageSmoothingQuality = 'high';
    e.drawImage(base, C.x, C.y, C.w, C.h, tx, ty, tw, th);
    // The outward stretch samples strips just inside the artwork's rim, clear of its rounded corners
    // (so the corners never pull in the transparent surround) and of the heart, whose stroke runs
    // close to the sides: the side columns at 10% in from each edge, between 22% and 78% down, and
    // the top and bottom rows at 10% in, between 22% and 78% across. The seam is blurred and
    // feathered below.
    const at = (fx, fy) => [sq.x + sq.w * fx, sq.y + sq.h * fy];
    const [Lx, Ty] = at(0.1, 0.1), [Rx, By] = at(0.9, 0.9), [Ix, Iy] = at(0.22, 0.22), [Jx, Jy] = at(0.78, 0.78);
    e.drawImage(base, Lx, Iy, 1, Jy - Iy, 0, ty, tx, th);                     // left
    e.drawImage(base, Rx, Iy, 1, Jy - Iy, tx + tw, ty, size - tx - tw, th);   // right
    e.drawImage(base, Ix, Ty, Jx - Ix, 1, tx, 0, tw, ty);                     // top
    e.drawImage(base, Ix, By, Jx - Ix, 1, tx, ty + th, tw, size - ty - th);   // bottom
    e.drawImage(base, Lx, Iy, 1, 1, 0, 0, tx, ty);                            // corners
    e.drawImage(base, Rx, Iy, 1, 1, tx + tw, 0, size - tx - tw, ty);
    e.drawImage(base, Lx, Jy, 1, 1, 0, ty + th, tx, size - ty - th);
    e.drawImage(base, Rx, Jy, 1, 1, tx + tw, ty + th, size - tx - tw, size - ty - th);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.filter = `blur(${(9 * dp).toFixed(1)}px)`;
    // Draw a little larger than the canvas so the blur doesn't pull in transparent edges.
    x.drawImage(ext, -12 * dp, -12 * dp, size + 24 * dp, size + 24 * dp);
    x.filter = 'none';
    // The sharp crop, feathered at its edges.
    const sharp = document.createElement('canvas');
    sharp.width = sharp.height = size;
    const sx = sharp.getContext('2d');
    sx.drawImage(base, C.x, C.y, C.w, C.h, tx, ty, tw, th);
    const f = FEATHER_DP * dp;
    sx.globalCompositeOperation = 'destination-in';
    sx.filter = `blur(${(f / 2).toFixed(1)}px)`;
    sx.fillStyle = '#000';
    sx.fillRect(tx + f, ty + f, tw - 2 * f, th - 2 * f);
    sx.filter = 'none';
    x.drawImage(sharp, 0, 0);
    return c;
  }
  const res = { sq };
  res.layers = {};
  for (const [k, n] of Object.entries(sizes)) res.layers[k] = layer(n).toDataURL('image/png');
  // Play icon: the 72 dp visible area of a large layer, full bleed (Play rounds the corners).
  const big = layer(108 * 8);
  const play = document.createElement('canvas');
  play.width = play.height = 512;
  const o = 18 * 8;
  play.getContext('2d').drawImage(big, o, o, 72 * 8, 72 * 8, 0, 0, 512, 512);
  res.play = play.toDataURL('image/png');
  // In-app logo: the square with its own rounded corners on transparent, 192 px.
  const lg = document.createElement('canvas');
  lg.width = lg.height = 192;
  const lx = lg.getContext('2d');
  lx.beginPath(); lx.roundRect(0, 0, 192, 192, 192 * 0.22); lx.clip();
  lx.drawImage(play, 0, 0, 512, 512, 0, 0, 192, 192);
  res.logo = lg.toDataURL('image/webp', 0.9);
  return res;
}, { src, sizes: DENSITIES });
await browser.close();

const b64 = (u) => Buffer.from(u.split(',')[1], 'base64');
for (const [k, u] of Object.entries(out.layers)) {
  const dir = join(root, `android/res/mipmap-${k}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), b64(u));
}
writeFileSync(join(root, 'docs/icon-512.png'), b64(out.play));
writeFileSync(join(root, 'src/data/brand.js'), `/* The app's logo (generated by scripts/make-icons.mjs from art/logo.png). */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.LOGO = '${out.logo}';
})(typeof window !== 'undefined' ? window : globalThis);
`);
console.log('square', JSON.stringify(out.sq), 'logo', Math.round(out.logo.length / 1024), 'KB');
