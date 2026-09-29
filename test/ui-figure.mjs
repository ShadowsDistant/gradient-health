// The exercise figure in the app, in Chromium (SwiftShader): the 3D figure in the player with its
// tempo strip, the move sheet's views, the Settings look (3D or simple, skin tone, shirt) and the
// fallback to the flat figure on a phone without WebGL 2.
// Usage: node test/ui-figure.mjs [--dark]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
// --shots saves what each step looks like to build/figure-ui/.
const shotDir = process.argv.includes('--shots') ? join(root, 'build/figure-ui') : null;
if (shotDir) mkdirSync(shotDir, { recursive: true });
const shot = (page, name) => (shotDir ? page.screenshot({ path: join(shotDir, `${name}${dark ? '-dark' : ''}.png`) }) : null);
const server = await serveDist();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(noGl) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(seedBridge);
  if (noGl) {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /webgl/.test(kind) ? null : get.call(this, kind, ...rest); };
    });
  }
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  return { ctx, page, errors };
}
const figKind = (page, sel) => page.evaluate((s) => { const h = document.querySelector(s); return !h ? 'none' : h.querySelector('.fig3d canvas') ? '3d' : h.querySelector('svg') ? 'flat' : 'empty'; }, sel);

section('Player');
let { ctx, page, errors } = await open(false);
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig');
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig .fig3d canvas'), null, { timeout: 30000 });
check('the workout shows the 3D figure', await figKind(page, '.player .pl-fig') === '3d');
check('one figure, not two', await page.evaluate(() => document.querySelector('.player .pl-fig').children.length === 1));
const tempo = await page.evaluate(() => { const t = document.querySelector('.player .fig-tempo'); return t ? t.textContent : ''; });
if (tempo) {
  check('the tempo strip says how long each half takes', /Control \d/.test(tempo) && /Drive \d/.test(tempo), tempo);
  await page.waitForFunction(() => { const t = document.querySelector('.player .fig-tempo'); return t && /^(con|ecc)$/.test(t.dataset.on || ''); }, null, { timeout: 15000 });
  check('and lights up the half the figure is in', true);
} else check('holds have no tempo strip', !!(await page.evaluate(() => document.querySelector('.player .pl-target'))));
const drawn = await page.evaluate(() => { const c = document.querySelector('.player .pl-fig .fig3d canvas'); const x = document.createElement('canvas'); x.width = c.width; x.height = c.height; const g = x.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, x.width, x.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); });
check('the figure is actually drawn', drawn > 0.02, drawn);
await page.waitForTimeout(1200);
await shot(page, 'player');

section('Move sheet');
await page.click('.player [data-act="plHowTo"]');
await page.waitForSelector('dialog[open] .sheet-fig');
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d canvas'), null, { timeout: 15000 });
check('the how-to sheet has the 3D figure', true);
check('with Angle, Side and Front views', await page.evaluate(() => document.querySelectorAll('dialog[open] [data-on="figView"] input').length === 3));
await page.evaluate(() => document.querySelector('dialog[open] [data-on="figView"] input[value="side"]').click());
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('dialog[open] [data-on="figView"] input[value="front"]').click());
await page.waitForTimeout(900);
check('changing the view works', errors.length === 0, errors.join('\n'));
await shot(page, 'sheet-front');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
check('closing the sheet frees its figure', await page.evaluate(() => !document.querySelector('dialog[open] .fig3d')));
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d canvas'), null, { timeout: 15000 });
const strip = await page.evaluate(() => (document.querySelector('dialog[open] .fig-tempo') || {}).textContent || '');
check('rep moves show their tempo', /Control 2 s/.test(strip) && /Drive 1 s/.test(strip), strip);
await page.waitForFunction(() => /^(con|ecc)$/.test((document.querySelector('dialog[open] .fig-tempo') || { dataset: {} }).dataset.on || ''), null, { timeout: 15000 });
check('and light up the half the figure is in', true);
await page.waitForTimeout(700);
await shot(page, 'sheet-pushup');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);

section('Settings');
await page.evaluate(() => window.GH.ui.act.plMin());
await page.waitForTimeout(500);
await page.evaluate(() => window.GH.ui.open('settings'));
await page.waitForSelector('#screen [data-on="setFigure"]');
check('3D is the default', await page.evaluate(() => document.querySelector('#screen [data-on="setFigure"] input[value="3d"]').checked));
await page.waitForSelector('#screen .set-fig img', { timeout: 15000 });
check('a preview shows the figure', true);
const before = await page.evaluate(() => document.querySelector('#screen .set-fig img').src);
await page.click('#screen [data-act="setFigSkin"][data-arg="umber"]');
await page.waitForTimeout(400);
check('picking a skin tone saves it and redraws the preview', await page.evaluate((b) => window.GH.ui.S.profile.prefs.figSkin === 'umber' && document.querySelector('#screen .set-fig img').src !== b && document.querySelector('#screen [data-act="setFigSkin"][data-arg="umber"]').getAttribute('aria-pressed') === 'true', before));
await page.click('#screen [data-act="setFigShirt"][data-arg="#2b8a3e"]');
await page.waitForTimeout(300);
check('and a shirt colour', await page.evaluate(() => window.GH.ui.S.profile.prefs.figShirt === '#2b8a3e'));
await page.evaluate(() => document.querySelector('#screen .set-fig-row').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
await shot(page, 'settings');
check('nothing in the figure rows is cut off', await page.evaluate(() => ![...document.querySelectorAll('#screen .set-fig-row .rf-list-title, #screen .swatches')].some((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth)));
await page.evaluate(() => document.querySelector('#screen [data-on="setFigure"] input[value="flat"]').click());
await page.waitForTimeout(400);
check('Simple hides the look options', await page.evaluate(() => window.GH.ui.S.profile.prefs.figure === 'flat' && !document.querySelector('#screen .set-fig-row')));
await page.evaluate(() => window.GH.ui.act.back ? window.GH.ui.act.back() : history.back());
await page.waitForTimeout(500);
await page.evaluate(() => window.GH.ui.act.resumeWorkout());
await page.waitForSelector('.player:not([hidden]) .pl-fig');
await page.waitForTimeout(500);
check('with Simple picked, the workout uses the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('No WebGL');
({ ctx, page, errors } = await open(true));
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig svg');
await page.waitForTimeout(1500);
check('without WebGL 2 the workout uses the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
await page.evaluate(() => window.GH.ui.act.plMin());
await page.waitForTimeout(400);
await page.evaluate(() => window.GH.ui.open('settings'));
await page.waitForSelector('#screen [data-on="setWorkouts"]');
check('Settings says 3D isn\'t possible here', await page.evaluate(() => /can't draw 3D/.test(document.querySelector('#screen').textContent) && !document.querySelector('#screen [data-on="setFigure"]')));
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

await browser.close();
await server.close();
done();
