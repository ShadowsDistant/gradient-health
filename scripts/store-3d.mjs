// Renders the 3D pictures the store images and the promo video are made from, with the app's own
// engines (src/engine/figure3d.js and medal3d.js) in the built page: the figure doing one rep of a
// few moves, frame by frame; big stills of it; a gold medal spinning in, frame by frame; and stills
// of a few medals. Each is an image with a transparent background, in build/store3d/. They take a
// few minutes in software GL, so they're kept between runs: --fresh draws them all again.
// Needs Playwright with Chromium and the built page (npm run build).
//
//   node scripts/store-3d.mjs [--fresh]
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seedBridge, seedState } from '../test/fixtures.mjs';
import { serveDist } from '../test/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

export const OUT = join(root, 'build/store3d');
export const FPS = 30;
// The moves the video shows (one rep each, frame by frame), and the ones with a big still.
export const MOVES = ['sq_goblet', 'curl_std', 'push_std'];
export const HEROES = ['curl_std', 'sq_goblet'];
// The medal that spins in, then a few more to show the range: [badge id, what it's for].
export const SPIN = 'streak30';
export const MEDALS = ['streak30', 'halfMarathon', 'pushups20', 'w100', 'sleepWeek', 'earlyBird'];
const SPIN_MS = 3600; // the spin in takes 1.1 s; the rest is the slow sway after it, with its light

const save = (file, url) => writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
const ext = (url) => (url.startsWith('data:image/webp') ? 'webp' : 'png');
const done = (dir, n) => existsSync(dir) && readdirSync(dir).length >= n;

export async function render3d({ fresh = false, log = console.log } = {}) {
  if (fresh) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await serveDist();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`page error: ${e.message}`));
    // The clock is the test's, so the medal's spin can be stepped a frame at a time.
    await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
    await page.addInitScript(seedBridge);
    await page.goto(server.url);
    await page.waitForSelector('.onboard:not([hidden])');
    await page.evaluate(seedState);
    await page.reload();
    await page.waitForSelector('#screen[data-view="today"] .session');
    await page.evaluate(() => window.GH.lazy('figure3d'));

    // The figure: one rep of each move at 30 frames a second, as the player shows it in dark mode.
    for (const id of MOVES) {
      const dir = join(OUT, `fig-${id}`);
      const total = await page.evaluate((id) => window.GH.pose.timeline(window.GH.moves.MOVES[id]).total, id);
      const n = Math.round((total / 1000) * FPS);
      if (done(dir, n)) continue;
      mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        const url = await page.evaluate(([id, t]) => window.GH.figure3d.still(window.GH.moves.MOVES[id], { width: 900, height: 900, dark: true, t }), [id, (i * 1000) / FPS]);
        if (!url) throw new Error(`no still of ${id} at frame ${i}`);
        save(join(dir, `${String(i).padStart(3, '0')}.${ext(url)}`), url);
      }
      log(`${id}: ${n} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    for (const id of HEROES) {
      const file = join(OUT, `hero-${id}.webp`);
      if (existsSync(file)) continue;
      // Mid-lift, where the working muscles glow.
      const url = await page.evaluate((id) => { const m = window.GH.moves.MOVES[id]; const tl = window.GH.pose.timeline(m); return window.GH.figure3d.still(m, { width: 1600, height: 1600, dark: true, t: tl.steps[0].ms * 0.85 }); }, id);
      save(file.replace(/webp$/, ext(url)), url);
      log(`hero ${id}`);
    }

    // Medal stills, then the gold one spinning in.
    for (const id of MEDALS) {
      const file = join(OUT, `medal-${id}.png`);
      if (existsSync(file)) continue;
      const url = await page.evaluate((id) => {
        const GH = window.GH, spec = GH.ui.medals.spec(GH.achievements.byId[id], true, null);
        const c = GH.medal3d.still(spec, { px: 1000, dark: true });
        return c ? c.toDataURL('image/png') : null;
      }, id);
      if (!url) throw new Error(`no medal still of ${id}`);
      save(file, url);
      log(`medal ${id}`);
    }
    const spinDir = join(OUT, 'medal-spin');
    const frames = Math.round((SPIN_MS / 1000) * FPS);
    if (!done(spinDir, frames)) {
      mkdirSync(spinDir, { recursive: true });
      // The live medal, with the page's own animation loop held off: each frame is drawn on demand
      // at the clock's time, then read out of the canvas in the same task (before it's composited).
      await page.evaluate((id) => {
        const GH = window.GH, spec = GH.ui.medals.spec(GH.achievements.byId[id], true, null);
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => {};
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:500px';
        document.body.appendChild(host);
        window.__medal = GH.medal3d.mount(host, spec, { size: 400, dark: true, sway: true });
        return window.__medal.ready;
      }, SPIN);
      await page.evaluate(() => window.__medal.spinIn());
      for (let i = 0; i < frames; i++) {
        if (i) await page.clock.runFor(1000 / FPS);
        const url = await page.evaluate(() => { const m = window.__medal; m.draw(); return m.el.toDataURL('image/png'); });
        save(join(spinDir, `${String(i).padStart(3, '0')}.png`), url);
      }
      log(`medal spin: ${frames} frames`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await render3d({ fresh: process.argv.includes('--fresh') });
  console.log(`3D pictures in ${OUT}`);
  process.exit(0);
}
