// The exercise figure in the app, in Chromium (SwiftShader): the 3D figure in the player with its
// tempo strip, the move sheet's views, a ladder's rungs, pausing under the how-to sheet, the Settings
// look (3D or simple, skin tone, shirt), the warm-up and frame rate, how soon a figure is 3D (warm,
// and on a fresh launch with the stills kept from the one before), losing and handing back the GPU,
// figures that keep moving with reduced motion, a box that's never empty while 3D gets ready (and
// gives up on a stuck GPU), 3D coming back after the phone took the GPU in the background, a chunk
// that fails to load, and the fallback to the flat figure on a phone without WebGL 2.
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

async function open(noGl, setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  if (setup) await setup(page);
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
  await page.waitForSelector('#screen[data-view="today"]');
  // The fixture's today is a training day most days; on a light day the page's clock goes back a
  // day at a time until it is one (these tests start workouts). The app saves soon after it starts
  // (a health read), and now and then a reload flushes that save over the fresh seed, so the state
  // seeded for the day before comes back with that day's workout already done: then seed again.
  const session = () => page.$('#screen[data-view="today"] .session');
  const ready = async () => !!(await session()) && page.evaluate(() => { const U = window.GH.ui; return window.GH.brain.todayPlan(U.S, U.today()).type !== 'done'; });
  for (let back = 0, tries = 0; tries < 10 && !(await ready()); tries++) {
    if (!(await session()) && back < 6) await page.clock.setSystemTime(new Date(Date.now() - ++back * 86400000));
    await page.evaluate(seedState);
    await page.reload();
    await page.waitForSelector('#screen[data-view="today"]');
  }
  await page.waitForSelector('#screen[data-view="today"] .session');
  return { ctx, page, errors };
}
// A small copy of a figure (3D canvas pixels or the flat SVG's markup), to tell whether it moves.
const figSig = (page, sel) => page.evaluate((s) => {
  const h = document.querySelector(s);
  const c = h && h.querySelector('.fig3d:not(.fig-pending) canvas');
  if (c) { const x = document.createElement('canvas'); x.width = 48; x.height = 48; const g = x.getContext('2d'); g.drawImage(c, 0, 0, 48, 48); return Array.from(g.getImageData(0, 0, 48, 48).data).join(','); }
  const svg = h && h.querySelector('svg');
  return svg ? svg.innerHTML : null;
}, sel);
const moves = async (page, sel, ms = 700) => { const a = await figSig(page, sel); await page.waitForTimeout(ms); const b = await figSig(page, sel); return !!(a && b && a !== b); };
// Counts animation frames where a figure box shows nothing: neither the flat figure, nor a 3D one
// that has drawn, nor a 3D still standing in for one.
const watchBlank = (page, sel) => page.evaluate((s) => {
  window.__fig = { frames: 0, blank: 0 };
  const tick = () => {
    const h = document.querySelector(s);
    if (h && h.offsetParent) {
      window.__fig.frames++;
      if (!h.querySelector(':scope > svg') && !h.querySelector(':scope > .fig3d[data-ready]:not(.fig-pending)') && !h.querySelector(':scope > .fig-still')) window.__fig.blank++;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, sel);
const figKind = (page, sel) => page.evaluate((s) => { const h = document.querySelector(s); return !h ? 'none' : h.querySelector('.fig3d:not(.fig-pending) canvas') ? '3d' : h.querySelector('svg') ? 'flat' : 'empty'; }, sel);

section('Player');
let { ctx, page, errors } = await open(false);
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig');
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 30000 });
check('the workout shows the 3D figure', await figKind(page, '.player .pl-fig') === '3d');
// The flat figure crossfades out once the 3D one has drawn (a quarter second, given a busy machine).
check('one figure, not two', await page.waitForFunction(() => document.querySelector('.player .pl-fig').children.length === 1, null, { timeout: 6000, polling: 100 }).then(() => true, () => false),
  await page.evaluate(() => { const h = document.querySelector('.player .pl-fig'); return [...h.children].map((e) => `${e.tagName}.${e.getAttribute('class')}${e.dataset && e.dataset.ready ? '[ready]' : ''}`).join(' | ') + ' · animations: ' + h.getAnimations({ subtree: true }).map((a) => `${a.playState}@${Math.round(a.currentTime || 0)}`).join(','); }));
const tempo = await page.evaluate(() => { const t = document.querySelector('.player .fig-tempo'); return t ? t.textContent : ''; });
if (tempo) {
  check('the tempo strip says how long each half takes', /Control \d/.test(tempo) && /Drive \d/.test(tempo), tempo);
  await page.waitForFunction(() => { const t = document.querySelector('.player .fig-tempo'); return t && /^(con|ecc)$/.test(t.dataset.on || ''); }, null, { timeout: 15000 });
  check('and lights up the half the figure is in', true);
} else check('holds have no tempo strip', !!(await page.evaluate(() => document.querySelector('.player .pl-target'))));
const drawn = await page.evaluate(() => { const c = document.querySelector('.player .pl-fig .fig3d:not(.fig-pending) canvas'); const x = document.createElement('canvas'); x.width = c.width; x.height = c.height; const g = x.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(0, 0, x.width, x.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); });
check('the figure is actually drawn', drawn > 0.02, drawn);
await page.waitForTimeout(1200);
await shot(page, 'player');

section('Move sheet');
// A small copy of the player's figure, to tell whether it's still being drawn.
const sig = () => page.evaluate(() => { const c = document.querySelector('.player .pl-fig .fig3d:not(.fig-pending) canvas'); if (!c) return null; const x = document.createElement('canvas'); x.width = 48; x.height = 48; const g = x.getContext('2d'); g.drawImage(c, 0, 0, 48, 48); return Array.from(g.getImageData(0, 0, 48, 48).data).join(','); });
await page.click('.player [data-act="plHowTo"]');
await page.waitForSelector('dialog[open] .sheet-fig');
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 15000 });
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
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 15000 });
const strip = await page.evaluate(() => (document.querySelector('dialog[open] .fig-tempo') || {}).textContent || '');
check('rep moves show their tempo', /Control 2 s/.test(strip) && /Drive 1 s/.test(strip), strip);
await page.waitForFunction(() => /^(con|ecc)$/.test((document.querySelector('dialog[open] .fig-tempo') || { dataset: {} }).dataset.on || ''), null, { timeout: 15000 });
check('and light up the half the figure is in', true);
await page.waitForTimeout(700);
await shot(page, 'sheet-pushup');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
// A sheet that finishes closing after the next one opened (a slow phone, a quick tap) takes only
// its own figure with it.
const both = await page.evaluate(async () => {
  const U = window.GH.ui;
  const a = U.moveSheet('sq_bw');
  await new Promise((r) => setTimeout(r, 400));
  const b = U.moveSheet('push_std');
  await new Promise((r) => setTimeout(r, 400));
  a.close('cancel');
  await new Promise((r) => setTimeout(r, 800));
  const host = b.el.querySelector('.sheet-fig');
  return { kids: host ? [...host.children].map((e) => e.tagName.toLowerCase()) : null };
});
check('closing one move sheet never empties another', both.kids && both.kids.length >= 1, both);
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
await page.evaluate(() => window.GH.ui.act.plKeep());
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
// A removed row fades from where it was before it goes (src/ui/motion.js), later under load.
await page.evaluate(() => window.GH.ui.motion && window.GH.ui.motion.settled());
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

section('Load times');
// From opening a move sheet (the call) to its figure box holding a 3D picture: the live figure, or a
// still of its first frame standing in; and to the live figure itself. Frames with nothing in the
// box are counted too.
const sheetTimes = (page, id) => page.evaluate((mid) => new Promise((res) => {
  const t0 = performance.now();
  const out = { look3d: null, live: null, blank: 0, frames: 0 };
  window.GH.ui.moveSheet(mid);
  const tick = () => {
    const h = document.querySelector('dialog[open] .sheet-fig');
    const t = Math.round(performance.now() - t0);
    if (h) {
      const live = h.querySelector(':scope > .fig3d[data-ready]:not(.fig-pending)');
      const still = h.querySelector(':scope > .fig-still');
      out.frames++;
      if (!live && !still && !h.querySelector(':scope > svg')) out.blank++;
      if (out.look3d == null && (live || still)) out.look3d = t;
      if (out.live == null && live) out.live = t;
    }
    if (out.live != null || t > 30000) { res(out); return; }
    requestAnimationFrame(tick);
  };
  tick();
}), id);
const keptStill = (page, id) => page.evaluate((mid) => { try { return (JSON.parse(localStorage.getItem('gh.figStills') || '{}').items || []).some((it) => it.k.startsWith(mid + '|')); } catch (e) { return false; } }, id);
({ ctx, page, errors } = await open(false));
// The app starts warming 3D up right after its first paint, in idle moments.
const tWarm = await page.evaluate(() => new Promise((res) => {
  const t0 = performance.now();
  const poll = () => (window.GH.figure3d && window.GH.figure3d._stats().warm ? res(Math.round(performance.now() - t0)) : setTimeout(poll, 50));
  poll();
}));
check(`the app warms 3D up soon after launch, without being asked (${tWarm} ms more here)`, tWarm < 20000, tWarm);
await page.waitForTimeout(600);
let lt = await sheetTimes(page, 'push_std');
check(`once warm, a move sheet's figure is 3D within 150 ms of opening it (${lt.look3d} ms)`, lt.look3d != null && lt.look3d <= 150, lt);
await page.waitForTimeout(900);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
// Stills of today's figures, and of moves opened lately, are drawn in idle time and kept.
await page.evaluate(() => window.GH.ui.figureStills(true));
await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem('gh.figStills') || '{}').items || []).some((it) => it.k.startsWith('push_std|')); } catch (e) { return false; } }, null, { timeout: 60000 }).catch(() => {});
check('stills of figures opened lately are kept for the next launch', await keptStill(page, 'push_std'));
await page.waitForTimeout(1500); // written out in an idle moment
// A fresh launch: 3D isn't loaded, let alone warm; the kept still stands in, then the live figure.
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
lt = await sheetTimes(page, 'push_std');
check(`on a fresh launch, a move sheet shows a 3D picture within 300 ms (${lt.look3d} ms)`, lt.look3d != null && lt.look3d <= 300, lt);
check(`and the live 3D figure soon after (${lt.live} ms)`, lt.live != null && lt.live <= 20000, lt);
check('with the box never empty on the way', lt.frames > 2 && lt.blank === 0, lt);
await page.waitForFunction(() => document.querySelector('dialog[open] .sheet-fig').children.length === 1, null, { timeout: 3000 }).catch(() => {});
check('the still crossfades out, leaving one figure', await page.evaluate(() => { const h = document.querySelector('dialog[open] .sheet-fig'); return h.children.length === 1 && !!h.querySelector(':scope > .fig3d[data-ready]'); }));
await page.waitForTimeout(600);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('Losing and handing back the GPU');
({ ctx, page, errors } = await open(false));
await page.evaluate(() => window.GH.lazy('figure3d').then((f) => f._releaseAfter(400)));
// The app warms up the 3D figure a few seconds after launch; let that finish first.
await page.waitForFunction(() => window.GH.figure3d._stats().warm, null, { timeout: 30000 }).catch(() => {});
check('the app warms the figure up after launch', await page.evaluate(() => window.GH.figure3d._stats().warm));
await page.click('#float [data-act="startWorkout"]');
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 30000 });
await page.evaluate(() => window.GH.figure3d._loseContext());
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig svg'), null, { timeout: 8000 }).catch(() => {});
check('a lost GPU swaps the workout to the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
check('nothing of the lost 3D figure is left running', await page.evaluate(() => window.GH.figure3d._stats().live === 0), await page.evaluate(() => window.GH.figure3d._stats()));
await page.evaluate(() => window.GH.ui.act.plKeep());
await page.waitForTimeout(600);
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 15000 }).catch(() => {});
check('after one loss, the next figure is 3D again', await figKind(page, 'dialog[open] .sheet-fig') === '3d');
await page.waitForTimeout(900); // let the sheet finish opening before closing it
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForFunction(() => { const s = window.GH.figure3d._stats(); return s.live === 0 && !s.renderer; }, null, { timeout: 8000 }).catch(() => {});
check('with no figure left, the GPU context is handed back', await page.evaluate(() => { const s = window.GH.figure3d._stats(); return s.live === 0 && !s.renderer; }), await page.evaluate(() => JSON.stringify(window.GH.figure3d._stats()) + ' in: ' + [...document.querySelectorAll('.fig3d')].map((e) => e.parentElement.className).join(',')));
await page.evaluate(() => window.GH.ui.moveSheet('sq_bw'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 15000 }).catch(() => {});
check('and taken again for the next figure', await figKind(page, 'dialog[open] .sheet-fig') === '3d' && await page.evaluate(() => window.GH.figure3d._stats().renderer));
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('Reduced motion');
({ ctx, page, errors } = await open(false));
await page.emulateMedia({ reducedMotion: 'reduce' });
check('the app sees reduced motion', await page.evaluate(() => window.GH.ui.reduced()));
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig .fig3d:not(.fig-pending) canvas'), null, { timeout: 30000 });
await page.waitForTimeout(900);
check('a rep move keeps moving in 3D', await moves(page, 'dialog[open] .sheet-fig'));
await page.waitForFunction(() => /^(con|ecc)$/.test((document.querySelector('dialog[open] .fig-tempo') || { dataset: {} }).dataset.on || ''), null, { timeout: 15000 }).catch(() => {});
check('and its tempo strip still lights up', await page.evaluate(() => /^(con|ecc)$/.test(document.querySelector('dialog[open] .fig-tempo').dataset.on || '')));
check('the view switcher is still there', await page.evaluate(() => document.querySelectorAll('dialog[open] [data-on="figView"] input').length === 3));
await page.click('dialog[open] [data-act="figPause"]');
await page.waitForTimeout(600);
check('Pause stops the figure', !(await moves(page, 'dialog[open] .sheet-fig')) && await page.evaluate(() => document.querySelector('dialog[open] [data-act="figPause"]').getAttribute('aria-pressed') === 'true'));
await page.click('dialog[open] [data-act="figPause"]');
await page.waitForTimeout(300);
check('and Play starts it again', await moves(page, 'dialog[open] .sheet-fig'));
await page.waitForTimeout(600);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
await page.evaluate(() => { window.GH.ui.S.profile.prefs.figure = 'flat'; });
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForSelector('dialog[open] .sheet-fig svg');
await page.waitForTimeout(300);
check('the flat figure moves too', await moves(page, 'dialog[open] .sheet-fig'));
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('Never an empty box');
// The 3D chunk arrives late, as on a slow phone's first launch.
({ ctx, page, errors } = await open(false, (pg) => pg.route('**/lazy/figure3d.js', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); })));
await watchBlank(page, '.player .pl-fig');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig');
await page.waitForTimeout(200);
check('the flat figure shows straight away', await figKind(page, '.player .pl-fig') === 'flat');
await page.waitForFunction(() => { const h = document.querySelector('.player .pl-fig'); return h && h.children.length === 1 && h.querySelector(':scope > .fig3d[data-ready]:not(.fig-pending)'); }, null, { timeout: 30000 });
const fb = await page.evaluate(() => Object.assign({}, window.__fig, window.GH.figure3d._stats()));
check('then the 3D one takes over', true);
check('and the box was never empty on the way', fb.frames > 10 && fb.blank === 0, fb);
check('one 3D figure is left running', fb.live === 1, fb);
const warmFirst = await page.evaluate(() => new Promise((res) => {
  window.GH.ui.moveSheet('sq_bw');
  requestAnimationFrame(() => { const h = document.querySelector('dialog[open] .sheet-fig'); res({ ready: !!(h && h.querySelector('.fig3d[data-ready]:not(.fig-pending)')), svg: !!(h && h.querySelector('svg')) }); });
}));
check('once warm, a new figure is 3D from its first frame', warmFirst.ready && !warmFirst.svg, warmFirst);
await page.waitForTimeout(900);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
check('no console errors', errors.length === 0, errors.join('\n'));

section('A stuck GPU');
await page.evaluate(() => window.GH.figure3d._stall(true));
await page.evaluate(() => window.GH.ui.moveSheet('sq_bw'));
await page.waitForSelector('dialog[open] .sheet-fig svg');
// The 3D figure is mounted beside the flat one (a moment after it shows, on a busy machine) and is
// given 3 s to draw a frame.
const mountedAt = await page.waitForSelector('dialog[open] .sheet-fig > .fig3d', { timeout: 4000 }).then(() => Date.now(), () => 0);
await page.waitForFunction(() => [...document.querySelector('dialog[open] .sheet-fig').children].every((e) => e.tagName.toLowerCase() === 'svg'), null, { timeout: 7000 }).catch(() => {});
const stuck = await page.evaluate(() => ({ kids: [...document.querySelector('dialog[open] .sheet-fig').children].map((e) => e.tagName.toLowerCase()), live: window.GH.figure3d._stats().live }));
stuck.held = mountedAt ? Date.now() - mountedAt : null;
check('after 3 s without a frame, the 3D figure is dropped and the flat one stays', stuck.kids.join() === 'svg' && stuck.live <= 1 && mountedAt > 0 && stuck.held >= 2500, stuck);
check('and it keeps moving', await moves(page, 'dialog[open] .sheet-fig'));
// One that gave up stays flat when it's redrawn (it used to mount another hidden 3D figure each time).
const redrawn = await page.evaluate(async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:160px';
  document.body.appendChild(host);
  const ctl = window.GH.ui.figureFor(host, 'sq_bw', null, true);
  await new Promise((r) => setTimeout(r, 3600));
  const liveBefore = window.GH.figure3d._stats().live;
  for (let i = 0; i < 3; i++) { ctl.attach(host); ctl.play(); await new Promise((r) => setTimeout(r, 250)); }
  const out = { pending: !!host.querySelector('.fig-pending'), kids: host.children.length, liveBefore, liveAfter: window.GH.figure3d._stats().live };
  ctl.destroy();
  host.remove();
  return out;
});
check('a figure that gave up stays flat when redrawn', !redrawn.pending && redrawn.kids === 1 && redrawn.liveAfter <= redrawn.liveBefore, redrawn);
await page.evaluate(() => window.GH.figure3d._stall(false));
await page.waitForTimeout(900);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('GPU taken back in the background');
({ ctx, page, errors } = await open(false));
await page.click('#float [data-act="startWorkout"]');
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig > .fig3d[data-ready]:not(.fig-pending)'), null, { timeout: 30000 });
const lost0 = await page.evaluate(() => window.GH.figure3d._stats().lost);
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  if (window.__gh && window.__gh.onPause) window.__gh.onPause();
  window.GH.figure3d._loseContext();
});
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig svg'), null, { timeout: 8000 }).catch(() => {});
check('the figure goes flat', await figKind(page, '.player .pl-fig') === 'flat');
check('a loss in the background doesn\'t count against 3D', await page.evaluate((l) => window.GH.figure3d._stats().lost === l && window.GH.figure3d.supported(), lost0));
await watchBlank(page, '.player .pl-fig');
await page.evaluate(() => {
  delete document.hidden;
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
  if (window.__gh && window.__gh.onResume) window.__gh.onResume();
});
await page.waitForFunction(() => !!document.querySelector('.player .pl-fig > .fig3d[data-ready]:not(.fig-pending)'), null, { timeout: 20000 }).catch(() => {});
check('back in front, it\'s 3D again', await figKind(page, '.player .pl-fig') === '3d');
const back = await page.evaluate(() => window.__fig);
check('without an empty frame', back.frames > 5 && back.blank === 0, back);
// Phones often report the loss only once the app is back in front. A move sheet (which, unlike the
// player, isn't redrawn by anything else) gets its 3D figure back then too.
await page.evaluate(() => window.GH.ui.act.plKeep());
await page.waitForTimeout(500);
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig > .fig3d[data-ready]:not(.fig-pending)'), null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  delete document.hidden;
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
  if (window.__gh && window.__gh.onResume) window.__gh.onResume();
  window.GH.figure3d._loseContext();
});
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig svg'), null, { timeout: 8000 }).catch(() => {});
check('a loss reported just after coming back goes flat', await figKind(page, 'dialog[open] .sheet-fig') === 'flat');
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig > .fig3d[data-ready]:not(.fig-pending)'), null, { timeout: 20000 }).catch(() => {});
check('then 3D again, without another trip to the background', await figKind(page, 'dialog[open] .sheet-fig') === '3d');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(600);
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

section('The 3D chunk fails to load');
({ ctx, page, errors } = await open(false, (pg) => pg.route('**/lazy/figure3d.js', (route) => route.abort())));
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig svg');
await page.waitForTimeout(1500);
check('the workout shows the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
await page.evaluate(() => window.GH.ui.act.plKeep());
await page.waitForTimeout(500);
await page.unroute('**/lazy/figure3d.js');
await page.evaluate(() => window.GH.ui.moveSheet('push_std'));
await page.waitForFunction(() => !!document.querySelector('dialog[open] .sheet-fig > .fig3d[data-ready]:not(.fig-pending)'), null, { timeout: 20000 }).catch(() => {});
check('once it can load, the next figure is 3D', await figKind(page, 'dialog[open] .sheet-fig') === '3d');
check('only the failed request was reported', errors.every((e) => /Failed to load resource/.test(e)), errors.join('\n'));
await ctx.close();

section('No WebGL');
({ ctx, page, errors } = await open(true));
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player .pl-fig svg');
await page.waitForTimeout(1500);
check('without WebGL 2 the workout uses the flat figure', await figKind(page, '.player .pl-fig') === 'flat');
await page.evaluate(() => window.GH.ui.act.plKeep());
await page.waitForTimeout(400);
await page.evaluate(() => window.GH.ui.open('settings'));
await page.waitForSelector('#screen [data-on="setWorkouts"]');
check('Settings says 3D isn\'t possible here', await page.evaluate(() => /can't draw 3D/.test(document.querySelector('#screen').textContent) && !document.querySelector('#screen [data-on="setFigure"]')));
check('no console errors', errors.length === 0, errors.join('\n'));
await ctx.close();

await browser.close();
await server.close();
done();
