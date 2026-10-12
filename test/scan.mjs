// The barcode scanner's rules, without a camera: the test barcodes drawn from their digits read back
// by ZXing (the reader the app ships), when a read counts, the digits handed back for each kind of
// code, where the box is in the camera's picture, and which hint the screen shows.
// test/ui-scan.mjs films the same barcodes and scans them in Chromium.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { load, check, section, done } from './lib.mjs';
import { bars, checkDigit, withCheck, expected, CODES, SCENES, HINT_SCENES } from './scanfixture.mjs';

const GH = load('src/scanner.js', 'src/barcode.js');
const S = GH.scanner, B = GH.barcode;
const require = createRequire(import.meta.url);

section('The test barcodes');
check('check digits: GS1\'s and Wikipedia\'s examples', checkDigit('590123412345') === '7' && checkDigit('03600029145') === '2' && checkDigit('9638507') === '4' && withCheck('400638133393') === '4006381333931');
check('every code in the fixture has a right check digit', Object.values(CODES).flat().every((c) => S.checksumOk(c.length === 8 && c[0] <= '1' && CODES.upc_e.includes(c) ? S.expandUpcE(c) : c)));
check('module counts: EAN-13 and UPC-A 95, EAN-8 67, UPC-E 51', bars('ean_13', CODES.ean_13[0]).length === 95 && bars('upc_a', CODES.upc_a[0]).length === 95 && bars('ean_8', CODES.ean_8[0]).length === 67 && bars('upc_e', CODES.upc_e[0]).length === 51);
check('a UPC-A is an EAN-13 with a leading 0, bar for bar', bars('upc_a', '036000291452') === bars('ean_13', '0036000291452'));
let threw = 0;
for (const [f, c] of [['ean_13', '3017620422004'], ['ean_8', '96385075'], ['upc_e', '04252615'], ['upc_a', '03600029145']]) { try { bars(f, c); } catch (e) { threw++; } }
check('a wrong check digit or length isn\'t drawn', threw === 4);
check('every scene names a code it can draw', SCENES.concat(HINT_SCENES).every((sc) => !sc.format || sc.format === 'qr_code' || bars(sc.format, sc.code).length > 50));

// Drawn plainly at 3 pixels a module, each reads back as the scanner hands it on.
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');
await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) }, fireImmediately: true });
const draw = (b, unit, h, quiet) => {
  const w = (b.length + quiet * 2) * unit, px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 4; y < h - 4; y++) for (let x = 0; x < w; x++) { const m = Math.floor(x / unit) - quiet; if (m >= 0 && m < b.length && b[m] === '1') { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; } }
  return { data: px, width: w, height: h, colorSpace: 'srgb' };
};
const NAME = { EAN13: 'ean_13', EAN8: 'ean_8', UPCA: 'upc_a', UPCE: 'upc_e' };
const wrong = [];
for (const [format, list] of Object.entries(CODES)) {
  for (const code of list) {
    const r = await readBarcodes(draw(bars(format, code), 3, 90, 10), { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'], tryHarder: true, maxNumberOfSymbols: 1 });
    const got = r[0] ? B.canon(r[0].text, NAME[r[0].format]) : null;
    if (got !== expected(format, code)) wrong.push(`${format} ${code}: ${got}`);
  }
}
check(`all ${Object.values(CODES).flat().length} read back by ZXing as the scanner hands them on`, wrong.length === 0, wrong);

section('The digits handed back');
check('EAN-13 as it is', B.canon('3017620422003', 'ean_13') === '3017620422003');
check('UPC-A as the EAN-13 it is: from ZXing (13 digits) and from a phone\'s detector (12)', B.canon('0036000291452', 'ean_13') === '0036000291452' && B.canon('036000291452', 'upc_a') === '0036000291452');
check('UPC-E written out the same way: from ZXing (13) and from a phone\'s detector (8)', B.canon('0042100005264', 'upc_e') === '0042100005264' && B.canon('04252614', 'upc_e') === '0042100005264');
check('EAN-8 as it is', B.canon('96385074', 'ean_8') === '96385074');
check('a typed number keeps its digits (normalise, as before)', S.normalise(' 0 36000 29145 2 ') === '036000291452' && S.expandUpcE('04252614') === '042100005264');

section('When a read counts');
{
  const r = B.rule();
  check('an EAN-13 with a right check digit: at once', r.take('3017620422003', 'ean_13', 0, 'f1'));
  check('a UPC-A too', B.rule().take('0036000291452', 'upc_a', 0, 'f1'));
  check('a wrong check digit: never', !B.rule().take('3017620422004', 'ean_13', 0, 'f1'));
  const e8 = B.rule();
  check('an EAN-8: not on its first read', !e8.take('96385074', 'ean_8', 0, 'f1'));
  check('the same frame again (both engines): still not', !e8.take('96385074', 'ean_8', 30, 'f1'));
  check('read again in another frame within a second: yes', e8.take('96385074', 'ean_8', 900, 'f5'));
  const e8b = B.rule();
  e8b.take('96385074', 'ean_8', 0, 'f1');
  check('read again after more than a second: starts over', !e8b.take('96385074', 'ean_8', 1500, 'f9') && e8b.take('96385074', 'ean_8', 2000, 'f12'));
  const ue = B.rule();
  ue.take('0042100005264', 'upc_e', 0, 'f1');
  check('a UPC-E: another code in between doesn\'t confirm it, its own second read does', !ue.take('0001234000057', 'upc_e', 200, 'f2') && ue.take('0042100005264', 'upc_e', 400, 'f3'));
  check('not two frames in a row: any two within the second', (() => { const x = B.rule(); x.take('55123457', 'ean_8', 0, 'f1'); return x.take('55123457', 'ean_8', 700, 'f14'); })());
}

section('Where the box is in the picture');
{
  // A 1080 x 1920 frame in a 358 x 477 view (3:4), magnified 2.2 times about the centre.
  const c = B.cover(1080, 1920, 358, 477, 2.2);
  const mid = B.toFrame(c, 179, 238.5), back = B.toView(c, mid.x, mid.y);
  check('the view\'s centre is the frame\'s', Math.abs(mid.x - 540) < 0.01 && Math.abs(mid.y - 960) < 0.01);
  check('and back again', Math.abs(back.x - 179) < 1e-6 && Math.abs(back.y - 238.5) < 1e-6);
  const l = B.toFrame(c, 0, 0), r = B.toFrame(c, 358, 0);
  check(`the view shows the frame's middle ${Math.round(((r.x - l.x) / 1080) * 100)}% across (1/2.2)`, Math.abs((r.x - l.x) / 1080 - 1 / 2.2) < 0.001);
  check('zoom: 2.2 for food at 1080 wide, less for a smaller picture, none at 480', B.zoomFor(false, 1080, 1920, 358, 477) === 2.2 && Math.abs(B.zoomFor(false, 720, 1280, 358, 477) - 1.5) < 0.01 && B.zoomFor(false, 480, 640, 358, 477) === 1);
  check('a plan\'s code on a screen: 1.4', B.zoomFor(true, 1080, 1920, 358, 477) === 1.4);
}

section('Hints');
{
  const h = (looks, o) => B.hint(looks.map((l) => Object.assign({ light: 120, change: 2, bars: null }, l)), o);
  check('nothing to go on: none', B.hint([], {}) === null);
  check('dark: the light, when there is one', h([{ light: 20 }, { light: 30 }], { torch: true }) === 'dark' && h([{ light: 20 }], {}) === 'darkNoTorch');
  check('bars from edge to edge: further away', h([{ bars: { full: true } }, { bars: { full: true } }]) === 'further');
  check('a small run of bars: closer', h([{ bars: { span: 0.2 } }, { bars: { span: 0.25 } }]) === 'closer');
  check('moving: hold steady, even with bars edge to edge', h([{ change: 30 }, { change: 25 }]) === 'steady' && h([{ change: 30, bars: { span: 0.2 } }, { change: 28, bars: { span: 0.2 } }]) === 'steady' && h([{ change: 30, bars: { full: true } }, { change: 28, bars: { full: true } }]) === 'steady');
  check('no bars at all: hold the barcode in the box', h([{}, {}]) === 'aim');
  check('a plan\'s code: point at it, or hold steady', h([{}], { qr: true }) === 'aimQr' && h([{ change: 40 }], { qr: true }) === 'steady');
  check('every hint has words', ['aim', 'aimQr', 'closer', 'further', 'dark', 'darkNoTorch', 'steady'].every((k) => B.HINTS[k] && !/[–—]/.test(B.HINTS[k])));
}

done();
