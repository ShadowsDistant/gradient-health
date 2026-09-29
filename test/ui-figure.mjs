// The exercise figure in the app, in Chromium (SwiftShader): the 3D figure in the player with its
// tempo strip, the move sheet's views, a ladder's rungs, pausing under the how-to sheet, the Settings
// look (3D or simple, skin tone, shirt), the warm-up and frame rate, losing and handing back the GPU,
// and the fallback to the flat figure on a phone without WebGL 2.
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
// A small copy of the player's figure, to tell whether it's still being drawn.
const sig = () => page.evaluate(() => { const c = document.querySelector('.player .pl-fig .fig3d canvas'); if (!c) return null; const x = document.createElement('canvas'); x.width = 48; x.height = 48; const g = x.getContext('2d'); g.drawImage(c, 0, 0, 48, 48); return Array.from(g.getImageData(0, 0, 48, 48).data).join(','); });
await page.click('.player [data-act="plHowTo"]');
await page.waitForSelector('dialog[open] .sheet-fig');
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d canvas'), null, { timeout: 15000 });
check('the how-to sheet has the 3D figure', true);
await page.waitForTimeout(1200); // the frame in flight when the sheet opened lands
const s1 = await sig(); await page.waitForTimeout(700); const s2 = await sig();
check('the player\'s figure stops while the sheet covers it', s1 && s1 === s2);
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
const s3 = await sig(); await page.waitForTimeout(700); const s4 = await sig();
check('and the player\'s figure moves again', s3 && s4 && s3 !== s4);
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

section('Ladder sheet');
const tempoText = (id) => page.evaluate((i) => { const d = document.createElement('div'); d.innerHTML = window.GH.ui.tempoHtml(window.GH.moves.MOVES[i]); return d.textContent; }, id);
const sheetTempo = () => page.evaluate(() => ({ tempo: [...document.querySelectorAll('dialog[open] .fig-tempo')].map((e) => e.textContent), views: document.querySelectorAll('dialog[open] .fig-view').length }));
await page.evaluate(() => { const b = document.createElement('button'); b.dataset.arg = 'curl'; window.GH.ui.act.ladder(b); });
await page.waitForSelector('dialog[open] [data-act="ladderShow"][data-arg="curl_towel"]');
const rung = async (id) => { await page.evaluate((i) => document.querySelector(`dialog[open] [data-act="ladderShow"][data-arg="${i}"]`).click(), id); await page.waitForTimeout(700); return sheetTempo(); };
let t = await rung('curl_towel');
check('a held rung has no tempo and one view switcher', t.tempo.length === 0 && t.views === 1, JSON.stringify(t));
t = await rung('curl_band');
check('the next rung shows its own tempo, once', t.tempo.length === 1 && t.tempo[0] === await tempoText('curl_band') && t.views === 1, JSON.stringify(t));
t = await rung('curl_slow');
check('a slower rung updates the tempo', t.tempo.length === 1 && t.tempo[0] === await tempoText('curl_slow') && t.tempo[0] !== await tempoText('curl_band'), JSON.stringify(t));
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
await page.waitForFunction((b) => { const i = document.querySelector('#screen .set-fig img'); return i && i.src !== b && !i.classList.contains('is-stale'); }, before, { timeout: 8000 }).catch(() => {});
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

section('Warm-up and frame rate');
({ ctx, page, errors } = await open(false));
const warm = await page.evaluate(async () => {
  const f = await window.GH.lazy('figure3d');
  const ok = await f.preload();
  const p0 = f._stats().programs;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:300px;z-index:9999';
  document.body.appendChild(host);
  const ctl = f.mount(host, window.GH.moves.MOVES.sq_bw, {});
  await new Promise((r) => setTimeout(r, 400));
  const p1 = f._stats().programs;
  // Count the frames drawn into this figure's canvas.
  const canvas = host.querySelector('canvas');
  const orig = CanvasRenderingContext2D.prototype.drawImage;
  let n = 0;
  CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (this.canvas === canvas) n++; return orig.apply(this, a); };
  const ev = (type, x) => ctl.el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 150, bubbles: true }));
  ev('pointerdown', 100);
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 16)); ev('pointermove', 100 + i * 4); }
  const dragMs = performance.now() - t0;
  const duringDrag = n;
  n = 0;
  ev('pointerup', 220);
  await new Promise((r) => setTimeout(r, 1000));
  const held = n;
  CanvasRenderingContext2D.prototype.drawImage = orig;
  ctl.destroy();
  host.remove();
  return { ok, p0, p1, duringDrag, dragMs: Math.round(dragMs), held };
});
check('preload() gets 3D ready', warm.ok, warm);
check('a figure after preload() compiles no new shaders', warm.p0 > 0 && warm.p1 === warm.p0, warm);
check('a drag draws at most 60 frames a second', warm.duringDrag <= Math.ceil(warm.dragMs / 15) + 1, warm);
check('held still after a drag, nothing new is drawn', warm.held <= 2, warm);
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('Losing and handing back the GPU');
({ ctx, page, errors } = await open(false));
await page.evaluate(() => window.GH.lazy('figure3d').then((f) => f._releaseAfter(400)));
// The app warms up the 3D figure a few seconds after launch; let that finish first.
await page.waitForFunction(() => window.GH.figure3d._stats().warm, null, { timeout: 30000 }).catch(() => {});
check('the app warms the figure up after launch', await page.evaluate(() => window.GH.figure3d._stats().warm));
await page.click('#float [data-act="startWorkout"]');
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig .fig3d canvas'), null, { timeout: 30000 });
await page.evaluate(() => window.GH.figure3d._loseContext());
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig svg'), null, { timeout: 8000 }).catch(() => {});
check('a lost GPU swaps the workout to the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
check('nothing of the lost 3D figure is left running', await page.evaluate(() => window.GH.figure3d._stats().live === 0), await page.evaluate(() => window.GH.figure3d._stats()));
await page.evaluate(() => window.GH.ui.act.plMin());
await page.waitForTimeout(600);
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d canvas'), null, { timeout: 15000 }).catch(() => {});
check('after one loss, the next figure is 3D again', await figKind(page, 'dialog[open] .sheet-fig') === '3d');
await page.waitForTimeout(900); // let the sheet finish opening before closing it
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForFunction(() => { const s = window.GH.figure3d._stats(); return s.live === 0 && !s.renderer; }, null, { timeout: 8000 }).catch(() => {});
check('with no figure left, the GPU context is handed back', await page.evaluate(() => { const s = window.GH.figure3d._stats(); return s.live === 0 && !s.renderer; }), await page.evaluate(() => JSON.stringify(window.GH.figure3d._stats()) + ' in: ' + [...document.querySelectorAll('.fig3d')].map((e) => e.parentElement.className).join(',')));
await page.evaluate(() => window.GH.ui.moveSheet('sq_bw'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d canvas'), null, { timeout: 15000 }).catch(() => {});
check('and taken again for the next figure', await figKind(page, 'dialog[open] .sheet-fig') === '3d' && await page.evaluate(() => window.GH.figure3d._stats().renderer));
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
