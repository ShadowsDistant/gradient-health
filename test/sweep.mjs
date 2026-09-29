// The review sweep: every screen and the main sheets at 360, 390, 412 and 600 px wide, light and dark,
// at 100% and 130% text (the most the app allows when the phone's font size is turned up), checked
// for sideways overflow, cut-off text and labels spilling out of buttons. Screenshots go to
// build/sweep/ for a visual pass.
// Usage: node test/sweep.mjs [--quick] [--no-shots] [--only=food,settings]
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const quick = process.argv.includes('--quick');
const shots = !process.argv.includes('--no-shots');
const only = ((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean);
const COMBOS = quick
  ? [[360, 'light', 1.3], [390, 'dark', 1]]
  : [360, 390, 412, 600].flatMap((w) => ['light', 'dark'].flatMap((t) => [1, 1.3].map((z) => [w, t, z])));
const OUT = join(root, 'build/sweep');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Someone five weeks in who also tracks food, trains at home and at a gym, and uses the on-device coach.
function seedMore() {
  const GH = window.GH, S = GH.ui.S, B = GH.brain, F = GH.food;
  const day = GH.ui.today();
  F.setMode(S, 'full');
  F.prefs(S).online = true;
  S.profile.sex = 'male';
  S.profile.where = 'both';
  S.profile.gym = B.gymPreset('basic', S.profile.units);
  const at = (d, h) => d * B.DAY_MS + (h + 4) * 3600000;
  for (let d = day - 9; d <= day; d++) {
    F.add(S, d, { name: 'Oatmeal with milk', src: 'quick', g: 250, portion: '1 bowl', kcal: 320, p: 14, c: 48, f: 8, meal: 'breakfast' }, at(d, 4));
    if (d === day) continue;
    F.add(S, d, { name: 'Chicken and rice', src: 'quick', portion: '1 plate', kcal: 640, p: 45, c: 70, f: 16, meal: 'lunch' }, at(d, 9));
    F.add(S, d, { name: 'Salmon, potatoes and a very long description of the side salad', src: 'quick', kcal: 710, p: 40, c: 55, f: 30, meal: 'dinner' }, at(d, 15));
    F.add(S, d, { name: 'Greek yogurt', src: 'quick', kcal: 150, p: 15, c: 10, f: 4, meal: 'snack' }, at(d, 12));
  }
  F.saveMeal(S, 'Usual breakfast', F.entries(S, day));
  F.addCustom(S, { name: 'Protein bar', servingG: 60, kcal: 220, p: 20, c: 22, f: 7 });
  S.ai.mode = 'device';
  GH.store.save(S);
}

// WebView's text zoom scales every font size; this does the same to what's on screen now.
function zoomText(f) {
  if (f === 1) return;
  const els = [...document.querySelectorAll('body *')].filter((e) => !e.closest('svg'));
  const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
  els.forEach((e, i) => { if (sizes[i]) e.style.setProperty('font-size', `${sizes[i] * f}px`, 'important'); });
  window.dispatchEvent(new Event('resize')); // the app re-fits what depends on text size
}

// What's wrong on screen right now: things past the right edge, cut-off text, labels spilling out.
function problems() {
  const W = window.innerWidth;
  const out = [];
  const visible = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const scroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
  const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(e.textContent || '').trim().slice(0, 40)}"`;
  const roots = [document.getElementById('screen'), document.getElementById('float'), document.getElementById('tabbar'), document.getElementById('player'), document.getElementById('onboard'), ...document.querySelectorAll('dialog[open]')].filter((r) => r && !r.hidden);
  if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
  for (const r of roots) {
    for (const e of r.querySelectorAll('*')) {
      if (e.closest('svg') || e.closest('[aria-hidden="true"]') || !visible(e) || scroller(e)) continue;
      const b = e.getBoundingClientRect();
      if (b.right > W + 1.5 || b.left < -1.5) { out.push(`past the edge: ${name(e)} (${Math.round(b.left)}..${Math.round(b.right)})`); continue; }
      const s = getComputedStyle(e);
      const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (text && s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`cut off: ${name(e)}`);
      else if (text && (s.overflowX === 'hidden' || s.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 2 && s.whiteSpace === 'nowrap') out.push(`clipped: ${name(e)}`);
      if ((e.tagName === 'BUTTON' || e.classList.contains('rf-chip') || e.classList.contains('rf-segment')) && e.scrollWidth > e.clientWidth + 2) out.push(`label wider than its control: ${name(e)}`);
    }
  }
  return [...new Set(out)].slice(0, 12);
}

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
let n = 0;
for (const [width, theme, zoom] of COMBOS) {
  const tag = `${width}-${theme}-${zoom === 1 ? '100' : '130'}`;
  section(tag);
  const ctx = await browser.newContext({ viewport: { width, height: width >= 600 ? 960 : 844 }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: true, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await page.addInitScript(seedBridge);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await page.evaluate(seedMore);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"]');
  const settle = async (ms = 800) => { await page.clock.runFor(ms); await page.waitForTimeout(250); };
  const act = (name, arg) => page.evaluate(([a, b]) => { const f = window.GH.ui.act[a]; if (f) f({ dataset: { arg: b }, setAttribute() {}, removeAttribute() {}, closest: () => null }); }, [name, arg]);
  const reset = async () => { await page.evaluate(() => { window.GH.ui.closeSheets(); while (window.GH.ui.back()) { /* back to the tab */ } }); await settle(700); };
  const scenes = [
    ['today', async () => { await page.evaluate(() => window.GH.ui.go('today')); }],
    ['plan', async () => { await page.evaluate(() => window.GH.ui.go('plan')); }],
    ['food', async () => { await page.evaluate(() => window.GH.ui.go('food')); }],
    ['health', async () => { await page.evaluate(() => window.GH.ui.go('health')); }],
    ['health-7', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.click('[data-on="healthRange"] input[value="7"]', { force: true }).catch(() => {}); }],
    ['progress', async () => { await page.evaluate(() => window.GH.ui.go('progress')); }],
    ['moves', async () => { await page.evaluate(() => window.GH.ui.go('moves')); }],
    ['profile', async () => { await page.evaluate(() => window.GH.ui.open('profile')); }],
    ['settings', async () => { await page.evaluate(() => window.GH.ui.open('settings')); }],
    ['settings-coach', async () => { await page.evaluate(() => window.GH.ui.open('settings', 'coach')); await settle(1500); }],
    ['coach', async () => { await page.evaluate(() => window.GH.ui.open('coach')); }],
    ['science', async () => { await page.evaluate(() => window.GH.ui.open('science')); }],
    ['privacy', async () => { await page.evaluate(() => window.GH.ui.open('privacy')); }],
    ['whatsnew', async () => { await page.evaluate(() => window.GH.ui.open('whatsnew')); }],
    ['sheet-logfood', async () => { await page.evaluate(() => window.GH.ui.go('food')); await settle(); await act('foodAdd', 'lunch'); }],
    ['sheet-quickadd', async () => { await page.evaluate(() => window.GH.ui.go('food')); await settle(); await act('foodQuick'); }],
    ['sheet-create', async () => { await page.evaluate(() => window.GH.ui.go('food')); await settle(); await act('foodCreate'); }],
    ['sheet-portion', async () => { await page.evaluate(() => window.GH.ui.go('food')); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen [data-act="foodEdit"]'); if (b) b.click(); }); }],
    ['sheet-chat', async () => { await act('askCoach'); await settle(1500); }],
    ['sheet-days', async () => { await act('daysSheet'); }],
    ['sheet-answers', async () => { await act('editAnswers'); }],
    ['sheet-move', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen .ex-name[data-act="moveInfo"]'); if (b) b.click(); }); await settle(1500); }],
    ['edit-equipment', async () => { await page.evaluate(() => window.GH.ui.editAnswers('equipment')); }],
    ['edit-food', async () => { await page.evaluate(() => window.GH.ui.editAnswers('food')); }],
    ['tour-4', async () => { await act('showTour'); await settle(); for (let i = 0; i < 3; i++) { await page.evaluate(() => { const b = document.querySelector('dialog[open] [data-act="tourNext"], .tour [data-act="tourNext"]'); if (b) b.click(); }); await settle(600); } }],
    ['player', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(2000); }],
  ].filter(([id]) => !only.length || only.some((o) => id.startsWith(o)));
  for (const [id, run] of scenes) {
    try {
      await run();
      await settle(900);
      await page.evaluate(zoomText, zoom);
      await page.waitForTimeout(120);
      const bad = await page.evaluate(problems);
      check(`${id}`, bad.length === 0, bad.join('\n      '));
      if (shots) await page.screenshot({ path: join(OUT, `${tag}-${id}.png`) });
      n++;
    } catch (e) {
      check(`${id} (ran)`, false, e.message.split('\n')[0]);
    }
    if (id === 'player') await page.evaluate(() => { const S = window.GH.ui.S; if (window.GH.ui.closePlayer) window.GH.ui.closePlayer(); S.active = null; window.GH.store.save(S); });
    await page.reload();
    await page.waitForSelector('#screen[data-view]');
    await reset();
  }
  await ctx.close();
}
section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 10).join('\n'));
await browser.close();
await server.close();
console.log(`\n${n} screens checked${shots ? `, screenshots in build/sweep/` : ''}`);
done();
