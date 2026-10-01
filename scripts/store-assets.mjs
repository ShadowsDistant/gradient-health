// Renders the store listing images in docs/store/ from the app screenshots in docs/screenshots/:
// the 1024 x 500 banner, the 512 x 512 icon and eight captioned screenshots, at 1080 x 1800 and at
// 480 x 800 (the same 3:5 shape, for stores that want that exact size). Stores want JPEG or 24-bit
// PNG with no alpha channel: every image is drawn on an opaque page, so none has one (the app's own
// docs/icon-512.png does), and the screenshots come as JPEG too.
// Needs Playwright with Chromium. Run scripts/screenshots.mjs first if the screens changed.
//
//   node scripts/store-assets.mjs
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = join(root, 'docs/store');
for (const d of ['', 'screenshots/1080x1800', 'screenshots/480x800', 'screenshots/jpg']) mkdirSync(join(out, d), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'gh-store-'));
const url = (p) => pathToFileURL(join(root, p)).href;

// The app's own type and colours (src/styles.css: the glow behind each page is the icon's mint, sky,
// violet and pink).
const FONT = `@font-face { font-family: 'Host Grotesk'; src: url('${url('vendor/refract/fonts/HostGrotesk-Variable.woff2')}') format('woff2'); font-weight: 300 800; }`;
const BASE = `${FONT}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: 'Host Grotesk', system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
.phone { position: absolute; border-radius: 9.5% / 4.4%; padding: 2.1%; background: linear-gradient(160deg, #3a3a44, #121217 40%, #0a0a0e); box-shadow: 0 0 0 2px rgb(255 255 255 / .08) inset, 0 40px 80px -20px rgb(20 10 60 / .45), 0 18px 36px -12px rgb(0 0 0 / .35); }
.phone img { display: block; width: 100%; border-radius: 8% / 3.7%; }
`;

/* ---------------------------------------------------------------- the banner */
const banner = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body { width: 1024px; height: 500px; position: relative; color: #fff;
  background:
    radial-gradient(60% 90% at 0% 100%, rgb(255 126 179 / .55), transparent 70%),
    radial-gradient(55% 80% at 100% 0%, rgb(111 227 200 / .75), transparent 72%),
    radial-gradient(50% 70% at 78% 92%, rgb(58 168 255 / .55), transparent 70%),
    linear-gradient(118deg, #2f2ab8 0%, #5a33e6 38%, #7c3cf0 55%, #2f8ff0 82%, #3fd0b4 100%); }
.copy { position: absolute; left: 64px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
.brand { display: flex; align-items: center; gap: 22px; margin-bottom: 26px; }
.brand img { width: 92px; height: 92px; border-radius: 22px; box-shadow: 0 0 0 2px rgb(255 255 255 / .55), 0 14px 30px -8px rgb(20 0 60 / .5); }
.name { font-size: 50px; font-weight: 750; letter-spacing: -0.02em; line-height: 1; }
h1 { font-size: 40px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.12; text-wrap: balance; text-shadow: 0 2px 18px rgb(30 0 80 / .25); }
.chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.chips span { font-size: 18px; font-weight: 600; padding: 9px 16px; border-radius: 999px; background: rgb(255 255 255 / .16); box-shadow: 0 0 0 1.5px rgb(255 255 255 / .35) inset; backdrop-filter: blur(6px); }
.p1 { width: 236px; left: 618px; top: 64px; transform: rotate(-7deg); }
.p2 { width: 236px; left: 790px; top: 118px; transform: rotate(5deg); }
</style></head><body>
  <div class="copy">
    <div class="brand"><img src="${url('docs/icon-512.png')}" alt=""><div class="name">Gradient Health</div></div>
    <h1>Workouts that adjust to you, every day.</h1>
    <div class="chips"><span>3D coach</span><span>GPS runs</span><span>Private AI</span></div>
  </div>
  <div class="phone p1"><img src="${url('docs/screenshots/today.png')}" alt=""></div>
  <div class="phone p2"><img src="${url('docs/screenshots/workout-dark.png')}" alt=""></div>
</body></html>`;

/* ---------------------------------------------------------------- the screenshots */
// [file, the app screenshot, headline, the line under it]
const SHOTS = [
  ['01-today', 'today.png', 'Workouts that adjust to you, every day', 'Your sleep, recovery and last session shape today\'s plan.'],
  ['02-workout', 'workout.png', 'A 3D coach shows every move', 'The right tempo and the working muscles lit, from any angle.'],
  ['03-plan', 'plan.png', 'Your whole week at a glance', 'Move a workout with a tap. Miss a day and the week moves along.'],
  ['04-activity', 'activity-dark.png', 'Track runs, walks, hikes and rides', 'GPS route, pace and splits, with heart rate from your watch.'],
  ['05-around', 'around.png', 'A plan built around your body', 'It adapts to your age, and to arthritis, back pain, balance and more.'],
  ['06-share', 'share-dark.png', 'Make your own plan and share it', 'Build it like a playlist. Friends scan the QR code and train.'],
  ['07-coach', 'answer-dark.png', 'A private AI coach on your phone', 'Ask about your numbers. It runs on the phone, even offline.'],
  ['08-health', 'health.png', 'Your health, with the story behind it', 'Sleep, steps, heart rate and weight from Health Connect.'],
];
function shotHtml(img, title, sub) {
  const dark = /-dark\.png$/.test(img);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body { width: 1080px; height: 1800px; position: relative; color: ${dark ? '#f4f3fa' : '#15141c'};
  background: ${dark
    ? `radial-gradient(50% 32% at 12% 10%, rgb(70 190 170 / .32), transparent 72%), radial-gradient(48% 30% at 92% 16%, rgb(60 130 255 / .45), transparent 72%), radial-gradient(60% 40% at 50% 62%, rgb(140 80 255 / .42), transparent 74%), radial-gradient(50% 30% at 10% 90%, rgb(240 100 170 / .28), transparent 72%), #09080f`
    : `radial-gradient(50% 32% at 12% 10%, rgb(111 227 200 / .6), transparent 72%), radial-gradient(48% 30% at 92% 14%, rgb(58 168 255 / .48), transparent 72%), radial-gradient(60% 40% at 50% 64%, rgb(155 92 255 / .36), transparent 74%), radial-gradient(50% 30% at 8% 92%, rgb(255 126 179 / .34), transparent 72%), #f1f2f6`}; }
.copy { position: absolute; left: 90px; right: 90px; top: 108px; text-align: center; }
h1 { font-size: 78px; font-weight: 760; letter-spacing: -0.025em; line-height: 1.04; text-wrap: balance; }
p { margin-top: 26px; font-size: 38px; font-weight: 500; line-height: 1.28; color: ${dark ? 'rgb(236 234 248 / .78)' : 'rgb(30 28 44 / .66)'}; text-wrap: balance; }
.phone { width: 820px; left: 130px; top: 470px; ${dark ? 'box-shadow: 0 0 0 2px rgb(255 255 255 / .16) inset, 0 0 0 1.5px rgb(255 255 255 / .12), 0 40px 90px -20px rgb(0 0 0 / .7);' : ''} }
</style></head><body>
  <div class="copy"><h1>${title}</h1><p>${sub}</p></div>
  <div class="phone"><img src="${url(`docs/screenshots/${img}`)}" alt=""></div>
</body></html>`;
}

const browser = await chromium.launch();
async function render(html, name, width, height, opts = {}) {
  const file = join(tmp, `${name.replace(/\W/g, '_')}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  if (opts.zoom) await page.evaluate((z) => { document.body.style.zoom = String(z); }, opts.zoom);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, name), type: opts.jpeg ? 'jpeg' : 'png', quality: opts.jpeg ? 95 : undefined });
  await page.close();
}

await render(banner, 'banner-1024x500.jpg', 1024, 500, { jpeg: true });
// The icon without its alpha channel (it's opaque anyway: a full-bleed square).
const icon = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE} body { width: 512px; height: 512px; background: #7c3cf0; } img { display: block; width: 512px; height: 512px; }</style></head><body><img src="${url('docs/icon-512.png')}" alt=""></body></html>`;
await render(icon, 'icon-512.png', 512, 512);
await render(icon, 'icon-512.jpg', 512, 512, { jpeg: true });
for (const [name, img, title, sub] of SHOTS) {
  const html = shotHtml(img, title, sub);
  await render(html, `screenshots/1080x1800/${name}.png`, 1080, 1800);
  await render(html, `screenshots/jpg/${name}.jpg`, 1080, 1800, { jpeg: true });
  // The same picture drawn at 480 x 800 (text drawn at that size, not a blurry downscale).
  await render(html, `screenshots/480x800/${name}.png`, 480, 800, { zoom: 480 / 1080 });
}
await browser.close();
console.log(`store images in ${out}`);
