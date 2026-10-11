// Puts the README's screenshots in a phone: each shot in docs/screenshots/ (390 x 844 at 2x, taken
// with a phone's status bar and gesture bar insets, scripts/screenshots.mjs) gets a black bezel with
// rounded corners, a status bar drawn into the space the app leaves for it (the time, signal, Wi-Fi,
// battery and the camera's punch hole), the gesture bar at the bottom and a soft shadow, on a clear
// background, so it reads on GitHub's light and dark pages alike. Writes docs/screenshots/framed/.
// The store's images (scripts/store-assets.mjs) use the shots as they are.
//
//   node scripts/frame-shots.mjs [name ...]
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const src = join(root, 'docs/screenshots');
const out = join(src, 'framed');
mkdirSync(out, { recursive: true });

// In CSS px of the shot (it's 2x): the status bar's height matches the inset the shots are taken with.
export const STATUS = 30, GESTURE = 16;
const W = 390, H = 844, BEZEL = 9, R = 46, PAD = 28;

const icons = (c) => `
  <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><g fill="${c}">
    <rect x="0" y="7.5" width="2.6" height="3.5" rx=".7"/><rect x="4" y="5" width="2.6" height="6" rx=".7"/>
    <rect x="8" y="2.5" width="2.6" height="8.5" rx=".7"/><rect x="12" y="0" width="2.6" height="11" rx=".7"/></g></svg>
  <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><path fill="${c}" d="M7.5 2.2c2.2 0 4.2.8 5.7 2.2l1.3-1.4A10 10 0 0 0 7.5.3 10 10 0 0 0 .5 3l1.3 1.4A8.2 8.2 0 0 1 7.5 2.2zm0 3.4c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.6 6.6 0 0 0 7.5 3.7c-1.8 0-3.4.7-4.7 1.8l1.3 1.4c.9-.8 2.1-1.3 3.4-1.3zm0 3.3c-.6 0-1.1.2-1.5.6L7.5 11l1.5-1.5c-.4-.4-.9-.6-1.5-.6z"/></svg>
  <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true"><rect x=".5" y=".5" width="20" height="11" rx="3" fill="none" stroke="${c}" stroke-opacity=".5"/>
    <rect x="2" y="2" width="14.5" height="8" rx="1.6" fill="${c}"/><rect x="21.5" y="4" width="1.8" height="4" rx=".9" fill="${c}" fill-opacity=".5"/></svg>`;

function page(img, dark) {
  const ink = dark ? '#ffffff' : '#111111';
  return `<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    .wrap { padding: ${PAD}px ${PAD}px ${PAD + 10}px; display: inline-block; }
    .phone { position: relative; width: ${W}px; height: ${H}px; padding: ${BEZEL}px; border-radius: ${R + BEZEL}px; background: #0a0a0c;
      box-shadow: 0 0 0 1px rgb(255 255 255 / .08) inset, 0 22px 44px -12px rgb(0 0 0 / .45), 0 6px 14px rgb(0 0 0 / .18); }
    .screen { position: relative; width: ${W}px; height: ${H}px; border-radius: ${R}px; overflow: hidden; background: url(${img}) 0 0 / ${W}px ${H}px; }
    .status { position: absolute; inset: 0 0 auto; height: ${STATUS}px; display: flex; align-items: center; justify-content: space-between;
      padding: 2px 26px 0 30px; box-sizing: border-box; font: 600 14px/1 'Roboto', 'Segoe UI', system-ui, sans-serif; color: ${ink}; letter-spacing: .2px; }
    .status .r { display: flex; gap: 5px; align-items: center; }
    .cam { position: absolute; top: 9px; left: 50%; width: 11px; height: 11px; margin-left: -5.5px; border-radius: 50%; background: #050507;
      box-shadow: 0 0 0 1.5px rgb(255 255 255 / .06); }
    .home { position: absolute; left: 50%; bottom: 5px; width: 108px; height: 4px; margin-left: -54px; border-radius: 2px; background: ${ink}; opacity: .85; }
  </style></head><body><div class="wrap"><div class="phone"><div class="screen">
    <div class="status"><span>9:41</span><span class="r">${icons(ink)}</span></div><span class="cam"></span><span class="home"></span>
  </div></div></div></body></html>`;
}

const only = process.argv.slice(2);
const names = readdirSync(src).filter((f) => f.endsWith('.png') && (!only.length || only.includes(f.replace(/\.png$/, ''))));
const browser = await chromium.launch();
// At 1.5x: the README shows them about 200 px wide, so this is still sharp on a high-density screen, at
// about half the bytes of 2x.
const ctx = await browser.newContext({ deviceScaleFactor: 1.5, viewport: { width: W + 2 * BEZEL + 2 * PAD, height: H + 2 * BEZEL + 2 * PAD + 10 } });
const p = await ctx.newPage();
for (const f of names) {
  const dark = /-dark\.png$/.test(f);
  const img = `data:image/png;base64,${readFileSync(join(src, f)).toString('base64')}`;
  await p.setContent(page(img, dark));
  await p.waitForTimeout(50);
  await p.locator('.wrap').screenshot({ path: join(out, f), omitBackground: true });
}
await browser.close();
console.log(`${names.length} framed in ${out}`);
process.exit(0);
