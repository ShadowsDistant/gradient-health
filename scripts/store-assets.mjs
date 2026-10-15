// Renders the store listing images in docs/store/: the 1024 x 500 feature graphic, the 512 x 512
// icon and five captioned screenshots, at 1080 x 1800 and at 480 x 800 (the same 3:5 shape, for
// stores that want that exact size), all in one look (scripts/store-style.mjs): the app's screens
// from docs/screenshots/ in a phone on a dark page lit by the icon's colours, with the 3D figure and
// medals the app draws (scripts/store-3d.mjs renders them, once). Stores want JPEG or 24-bit PNG
// with no alpha channel: every image is drawn on an opaque page, so none has one, and the
// screenshots come as JPEG too.
// Needs Playwright with Chromium and the built page. Run scripts/screenshots.mjs first if the
// screens changed.
//
//   node scripts/store-assets.mjs        (STORE_OUT=<dir> writes them somewhere else, to look first)
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { root, url, aurora, BASE, DOT } from './store-style.mjs';
import { render3d, OUT as R3 } from './store-3d.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.env.STORE_OUT || join(root, 'docs/store');
for (const d of ['', 'screenshots/1080x1800', 'screenshots/480x800', 'screenshots/jpg']) mkdirSync(join(out, d), { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'gh-store-'));
const shot = (name) => url(`docs/screenshots/${name}`);
const r3 = (name) => pathToFileURL(join(R3, name)).href;

await render3d({ log: (m) => console.log(`3D: ${m}`) });

/* ---------------------------------------------------------------- the feature graphic */
const banner = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body { width: 1024px; height: 500px; background: ${aurora([['blue', 8, 8, 62, 90, 0.5], ['mint', 82, 38, 46, 80, 0.42], ['green', 66, 108, 40, 60, 0.3], ['amber', 2, 104, 40, 52, 0.36]])}; }
.copy { position: absolute; left: 58px; top: 0; bottom: 0; width: 486px; display: flex; flex-direction: column; justify-content: center; }
.brand { display: flex; align-items: center; gap: 16px; margin-bottom: 30px; }
.brand img { width: 64px; height: 64px; border-radius: 15px; box-shadow: 0 0 0 1.5px rgb(255 255 255 / .35), 0 10px 26px -8px rgb(0 0 0 / .6); }
.brand b { font-size: 30px; font-weight: 720; letter-spacing: -0.02em; }
h1 { font-size: 60px; font-weight: 780; letter-spacing: -0.035em; line-height: 1.0; }
p { margin-top: 18px; font-size: 21px; font-weight: 500; line-height: 1.35; color: rgb(232 238 255 / .74); }
.phone { width: 252px; left: 572px; top: 52px; transform: rotate(-6deg); --glow: rgb(52 199 174 / .6); }
.fig { position: absolute; width: 470px; left: 668px; top: 30px; filter: drop-shadow(0 24px 30px rgb(0 0 0 / .45)); }
.medal { position: absolute; width: 176px; left: 822px; top: 296px; transform: rotate(9deg); filter: drop-shadow(0 18px 26px rgb(0 0 0 / .55)) drop-shadow(0 0 40px rgb(244 168 62 / .35)); }
</style></head><body>
  <div class="copy">
    <div class="brand"><img src="${url('docs/icon-512.png')}" alt=""><b>Gradient Health</b></div>
    <h1>Workouts that<br><span class="hue">adapt to you</span></h1>
    <p>A plan for your body and your time, a 3D coach for every move, and medals to earn.</p>
  </div>
  <div class="phone"><img src="${shot('today.png')}" alt=""></div>
  <img class="fig" src="${r3('hero-curl_std.webp')}" alt="">
  <img class="medal" src="${r3('medal-streak30.png')}" alt="">
  <div class="grain"></div>
</body></html>`;

/* ---------------------------------------------------------------- the screenshots */
// Each: the file, its page's glows, the headline (a word in colour), the line under it, chips under
// that, and what's on the page below: the phone and anything around it.
const phone = (img, css, glow) => `<div class="phone" style="${css};--glow:${glow}"><img src="${shot(img)}" alt=""></div>`;
const SHOTS = [
  {
    name: '01-adapts',
    glows: [['blue', 20, 6, 70, 34, 0.55], ['mint', 96, 40, 52, 36, 0.38], ['amber', 0, 92, 54, 30, 0.3]],
    title: 'Workouts that <span class="hue">adapt to you</span>',
    sub: 'A plan for each day, then adjusted as you go.',
    chips: [['Your goals', 'blue'], ['Your time', 'mint'], ['Your sleep', 'amber']],
    body: phone('today.png', 'width:780px;left:150px;top:600px', 'rgb(62 149 249 / .6)'),
  },
  {
    name: '02-coach3d',
    glows: [['mint', 88, 14, 60, 36, 0.48], ['blue', 4, 60, 56, 36, 0.4], ['green', 80, 98, 60, 30, 0.34]],
    title: 'A <span class="hue">3D coach</span> for every move',
    sub: '296 moves, each at the right tempo, with the working muscles lit up.',
    body: phone('workout-dark.png', 'width:640px;left:40px;top:540px', 'rgb(52 199 174 / .55)')
      + '<div style="position:absolute;left:520px;top:1560px;width:560px;height:150px;border-radius:50%;background:radial-gradient(closest-side, rgb(52 199 174 / .45), transparent)"></div>'
      + `<img src="${r3('hero-curl_std.webp')}" alt="" style="position:absolute;width:1180px;left:250px;top:560px;filter:drop-shadow(0 30px 40px rgb(0 0 0 / .5))">`,
  },
  {
    name: '03-stronger',
    glows: [['green', 86, 8, 62, 36, 0.48], ['blue', 0, 46, 56, 34, 0.38], ['amber', 90, 96, 54, 30, 0.3]],
    title: 'Stronger <span class="hue">every week</span>',
    sub: 'After each exercise, one question. Your answer sets the next workout.',
    body: phone('rest-dark.png', 'width:720px;left:180px;top:450px', 'rgb(75 201 133 / .55)')
      + `<div class="glass dark ask">
          <div class="q">How many more could you have done?</div>
          <div class="opts">
            <div><b>0</b><span>Holds steady</span></div>
            <div><b>1-2</b><span>Adds a little</span></div>
            <div><b>3</b><span>Moves you up</span></div>
            <div class="on"><b>4+</b><span>Up faster</span></div>
          </div>
        </div>`,
  },
  {
    name: '04-ai-coach',
    glows: [['blue', 90, 10, 62, 36, 0.5], ['mint', 6, 52, 54, 36, 0.36], ['amber', 70, 100, 60, 30, 0.28]],
    title: 'A <span class="hue">private AI coach</span>',
    sub: 'Ask about your sleep, steps and training.',
    chips: [['Runs on your phone', 'blue'], ['Works offline', 'mint']],
    body: phone('answer-dark.png', 'width:780px;left:150px;top:560px', 'rgb(62 149 249 / .55)'),
  },
  {
    name: '05-medals',
    glows: [['amber', 84, 14, 60, 36, 0.5], ['blue', 2, 60, 54, 34, 0.36], ['mint', 70, 100, 60, 30, 0.3]],
    title: 'Earn <span class="hue-warm">3D medals</span>',
    sub: 'Over 60 badges to collect, crack open and share.',
    body: phone('badges.png', 'width:760px;left:60px;top:520px', 'rgb(244 168 62 / .5)')
      + `<img src="${r3('medal-halfMarathon.png')}" alt="" style="position:absolute;width:300px;left:760px;top:560px;transform:rotate(10deg);filter:drop-shadow(0 20px 30px rgb(0 0 0 / .55))">`
      + `<img src="${r3('medal-pushups20.png')}" alt="" style="position:absolute;width:260px;left:800px;top:1450px;transform:rotate(-8deg);filter:drop-shadow(0 20px 30px rgb(0 0 0 / .55))">`
      + `<img src="${r3('medal-streak30.png')}" alt="" style="position:absolute;width:520px;left:520px;top:880px;transform:rotate(-6deg);filter:drop-shadow(0 30px 40px rgb(0 0 0 / .6)) drop-shadow(0 0 70px rgb(244 168 62 / .4))">`,
  },
];
function shotHtml(s) {
  const chips = s.chips ? `<div class="row">${s.chips.map(([text, dot]) => `<span class="chip glass"><i style="background:${DOT[dot]};color:${DOT[dot]}"></i>${text}</span>`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body { width: 1080px; height: 1800px; background: ${aurora(s.glows)}; }
.copy { position: absolute; left: 70px; right: 70px; top: 112px; text-align: center; }
h1 { font-size: 92px; font-weight: 780; letter-spacing: -0.035em; line-height: 1.0; text-wrap: balance; }
p { margin: 28px auto 0; max-width: 880px; font-size: 38px; font-weight: 500; line-height: 1.3; color: rgb(232 238 255 / .74); text-wrap: balance; }
.row { display: flex; justify-content: center; gap: 16px; margin-top: 30px; }
.row .chip { position: static; font-size: 32px; }
.ask { position: absolute; left: 60px; right: 60px; top: 1080px; border-radius: 48px; padding: 40px 40px 44px; text-align: center; }
.glass.dark.ask { background: linear-gradient(160deg, rgb(28 32 46 / .94), rgb(10 12 20 / .96)); }
.ask .q { font-size: 42px; font-weight: 700; letter-spacing: -0.015em; }
.ask .opts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 30px; }
.ask .opts div { display: grid; gap: 14px; justify-items: center; }
.ask b { width: 100%; height: 96px; border-radius: 48px; display: grid; place-items: center; font-size: 46px; font-weight: 760; background: rgb(255 255 255 / .1); box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .18); }
.ask .on b { background: linear-gradient(100deg, #3e95f9, #34c7ae 60%, #4bc985); box-shadow: inset 0 2px 0 rgb(255 255 255 / .35), 0 14px 40px -12px rgb(52 199 174 / .8); }
.ask span { font-size: 28px; font-weight: 600; line-height: 1.25; color: rgb(232 238 255 / .8); }
.ask .on span { color: #fff; }
</style></head><body>
  <div class="copy"><h1>${s.title}</h1><p>${s.sub}</p>${chips}</div>
  ${s.body}
  <div class="grain"></div>
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
  await page.screenshot({ path: join(out, name), type: opts.jpeg ? 'jpeg' : 'png', quality: opts.jpeg ? 94 : undefined });
  await page.close();
}

await render(banner, 'feature-graphic-1024x500.png', 1024, 500);
await render(banner, 'feature-graphic-1024x500.jpg', 1024, 500, { jpeg: true });
// The icon without its alpha channel (it's opaque anyway: a full-bleed square).
const icon = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE} body { width: 512px; height: 512px; background: #4fb9c9; } img { display: block; width: 512px; height: 512px; }</style></head><body><img src="${url('docs/icon-512.png')}" alt=""></body></html>`;
await render(icon, 'icon-512.png', 512, 512);
await render(icon, 'icon-512.jpg', 512, 512, { jpeg: true });
for (const s of SHOTS) {
  const html = shotHtml(s);
  await render(html, `screenshots/1080x1800/${s.name}.png`, 1080, 1800);
  await render(html, `screenshots/jpg/${s.name}.jpg`, 1080, 1800, { jpeg: true });
  // The same picture drawn at 480 x 800 (text drawn at that size, not a blurry downscale).
  await render(html, `screenshots/480x800/${s.name}.png`, 480, 800, { zoom: 480 / 1080 });
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`store images in ${out}`);
process.exit(0);
