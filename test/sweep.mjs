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
import { actBridge, seedActivities } from './actfixture.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const quick = process.argv.includes('--quick');
const tablet = process.argv.includes('--tablet');
const shots = !process.argv.includes('--no-shots');
const only = ((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean);
// [width, theme, text zoom, height]: phones, a small tablet, and a landscape tablet (from target
// SDK 36 Android ignores the portrait lock on screens 600 dp and wider).
const COMBOS = tablet ? [[1280, 'light', 1, 800]] : quick
  ? [[360, 'light', 1.3], [390, 'dark', 1]]
  : [360, 390, 412, 600].flatMap((w) => ['light', 'dark'].flatMap((t) => [1, 1.3].map((z) => [w, t, z]))).concat([[1280, 'light', 1, 800], [1024, 'dark', 1.3, 768]]);
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
  // Gym lifts with five weeks of history, for the strength charts on Progress.
  for (const [fam, id, start] of [['pressG', 'bench_bb', 60], ['squatG', 'squat_bb', 80], ['rowG', 'row_cable', 50]]) {
    const st = S.prog[fam] || (S.prog[fam] = { rung: id, reps: 8, best: {}, loads: {}, e1rm: {}, short: 0, cooldown: 0, flat: 0, gym: true });
    st.e1rm = st.e1rm || {};
    const hist = [0, 1, 2, 3, 4, 5].map((i) => [day - 35 + i * 7, start + i * 2.5]);
    st.e1rm[id] = { best: hist[5][1], last: hist[5][1], day: hist[5][0], hist };
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
  // Scroll containers: a deliberate sideways rail is marked data-hscroll, and what's in it may run
  // past the screen. Anything in another scroll container (a page, a sheet's body) must fit inside
  // its box, and the container itself mustn't scroll sideways.
  const scrolls = (p) => { const ox = getComputedStyle(p).overflowX; return ox === 'auto' || ox === 'scroll'; };
  const boxOf = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { if (p.hasAttribute('data-hscroll')) return 'rail'; if (scrolls(p)) return p; } return null; };
  const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(e.textContent || '').trim().slice(0, 40)}"`;
  const roots = [document.getElementById('screen'), document.getElementById('float'), document.getElementById('tabbar'), document.getElementById('player'), document.getElementById('onboard'), document.getElementById('actlive'), ...document.querySelectorAll('dialog[open]')].filter((r) => r && !r.hidden);
  if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
  for (const r of roots) {
    for (const c of [r, ...r.querySelectorAll('*')]) {
      if (c.hasAttribute('data-hscroll') || !scrolls(c) || !visible(c) || c.closest('[data-hscroll]')) continue;
      if (c.scrollWidth > c.clientWidth + 1) out.push(`scrolls sideways: ${name(c)} (${c.scrollWidth} > ${c.clientWidth})`);
    }
    for (const e of r.querySelectorAll('*')) {
      if (e.closest('svg') || e.closest('[aria-hidden="true"]') || !visible(e)) continue;
      const box = boxOf(e);
      if (box === 'rail') continue;
      const b = e.getBoundingClientRect();
      const lim = box ? box.getBoundingClientRect() : { left: 0, right: W };
      const right = Math.min(W, box ? lim.left + box.clientWidth + (box.clientLeft || 0) : W), left = Math.max(0, lim.left);
      if (b.right > right + 1.5 || b.left < left - 1.5) { out.push(`past the edge${box ? ' of its scroller' : ''}: ${name(e)} (${Math.round(b.left)}..${Math.round(b.right)} in ${Math.round(left)}..${Math.round(right)})`); continue; }
      const s = getComputedStyle(e);
      const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (text && s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`cut off: ${name(e)}`);
      else if (text && (s.overflowX === 'hidden' || s.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 2 && s.whiteSpace === 'nowrap') out.push(`clipped: ${name(e)}`);
      if ((e.tagName === 'BUTTON' || e.classList.contains('rf-chip') || e.classList.contains('rf-segment')) && e.scrollWidth > e.clientWidth + 2) out.push(`label wider than its control: ${name(e)}`);
    }
  }
  // A page (not a sheet, the player or set-up): scrolled to the end, its last content must clear
  // whatever covers the bottom (the tab bar, the workout capsule, Today's buttons, the system bar).
  const pl = document.getElementById('player'), ob = document.getElementById('onboard'), al = document.getElementById('actlive');
  const scr = document.getElementById('screen');
  if (scr && !document.querySelector('dialog[open]') && (!pl || pl.hidden) && (!ob || ob.hidden) && (!al || al.hidden)) {
    const keep = scr.scrollTop;
    scr.scrollTop = scr.scrollHeight;
    const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
    let cover = window.innerHeight - sab;
    const tb = document.getElementById('tabbar');
    if (tb && !tb.hasAttribute('data-away')) {
      cover = Math.min(cover, tb.querySelector('.rf-tabbar-bar').getBoundingClientRect().top);
      const acc = document.getElementById('accessory');
      if (acc && !acc.hidden) cover = Math.min(cover, acc.getBoundingClientRect().top);
    }
    const fl = document.getElementById('float');
    if (fl && !fl.hidden) for (const c of fl.children) cover = Math.min(cover, c.getBoundingClientRect().top);
    const clipped = (e, r) => { for (let p = e.parentElement; p && p !== scr; p = p.parentElement) { const st = getComputedStyle(p); if (st.overflowY !== 'visible' && r.bottom > p.getBoundingClientRect().bottom + 1) return true; } return false; };
    let low = 0, who = null;
    for (const e of scr.querySelectorAll('*')) {
      if (e.closest('svg') || !visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom > low && !clipped(e, r)) { low = r.bottom; who = e; }
    }
    scr.scrollTop = keep;
    if (who && low > cover - 8) out.push(`bottom cut off: ${name(who)} ends at ${Math.round(low)}, covered from ${Math.round(cover)}`);
  }
  return [...new Set(out)].slice(0, 12);
}

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
let n = 0;
for (const [width, theme, zoom, h] of COMBOS) {
  const tag = `${width}${h ? `x${h}` : ''}-${theme}-${zoom === 1 ? '100' : '130'}`;
  section(tag);
  const ctx = await browser.newContext({ viewport: { width, height: h || (width >= 600 ? 960 : 844) }, deviceScaleFactor: h ? 1 : 2, isMobile: width < 600, hasTouch: true, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await page.addInitScript(seedBridge);
  await page.addInitScript(actBridge);
  // Small phones get a three-button navigation bar (48px); the rest a gesture bar.
  if (width === 360) await page.addInitScript(() => { const t = setInterval(() => { if (window.AndroidBridge) { window.AndroidBridge.insets = () => JSON.stringify({ top: 30, bottom: 48, left: 0, right: 0, keyboard: false }); clearInterval(t); } }, 1); });
  // The app starts on a timer (setTimeout(boot, 0)), which under the test clock can wait for time to
  // move on: if it hasn't started, move the clock on, and if that doesn't do it, start it by hand
  // (and say what the page looked like, in case it's the app).
  const booted = async (sel) => {
    try { await page.waitForSelector(sel, { timeout: 15000 }); return; } catch (e) { /* below */ }
    await page.clock.runFor(1000).catch(() => {});
    try { await page.waitForSelector(sel, { timeout: 5000 }); return; } catch (e) { /* below */ }
    const was = await page.evaluate(() => { const ui = window.GH && window.GH.ui; const w = { ready: document.readyState, ui: !!ui, S: !!(ui && ui.S), view: (document.querySelector('#screen') || {}).dataset }; if (ui && ui.boot && !ui.S) ui.boot(); return JSON.stringify(w); }).catch((e) => e.message);
    if (!/"S":false/.test(was)) errors.push(`${tag}: the page didn't show a screen after a reload: ${was}`);
    await page.waitForSelector(sel, { timeout: 30000 });
  };
  await page.goto(server.url);
  await booted('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await booted('#screen[data-view="today"] .session');
  await page.evaluate(seedMore);
  await page.reload();
  await booted('#screen[data-view="today"]');
  const settle = async (ms = 800) => { await page.clock.runFor(ms); await page.waitForTimeout(250); };
  const act = (name, arg) => page.evaluate(([a, b]) => { const f = window.GH.ui.act[a]; if (f) f({ dataset: { arg: b }, setAttribute() {}, removeAttribute() {}, closest: () => null }); }, [name, arg]);
  const reset = async () => { await page.evaluate(() => { window.GH.ui.closeSheets(); while (window.GH.ui.back()) { /* back to the tab */ } }); await settle(700); };
  // The set-up from the start (over the seeded app, never finished), n screens in; `pick` runs on
  // the last one.
  const setup = async (n, pick) => {
    await page.evaluate(() => window.GH.ui.showOnboarding());
    await settle(600);
    for (let i = 0; i < n; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(400); }
    if (pick) await pick();
  };
  const chips = async (sel) => { for (const s of sel) { await page.click(s); await settle(200); } };
  // Outdoor activities: start one against the fake recorder (permissions allowed, GPS found after
  // searchMs), optionally through the 3-2-1 and a few minutes of running.
  const startAct = async (type, o = {}) => {
    await page.evaluate(([s]) => { window.__act.perms = { location: 'granted', activity: 'granted', notifications: 'granted' }; window.__act.searchMs = s; window.GH.ui.go('today'); }, [o.searchMs == null ? 0 : o.searchMs]);
    await settle();
    await act('actStart');
    await settle(900);
    await page.click(`dialog[open] .at-tile[data-arg="${type}"]`);
    await settle(1500);
    if (!o.go) return;
    await page.evaluate(() => window.GH.ui.act.alGo());
    await settle(3500);
    await settle(o.go);
  };
  const seedActs = async () => { await page.evaluate(seedActivities); await settle(); };
  const scenes = [
    ['today', async () => { await page.evaluate(() => window.GH.ui.go('today')); }],
    ['plan', async () => { await page.evaluate(() => window.GH.ui.go('plan')); }],
    ['plan-light', async () => { await page.evaluate(() => window.GH.ui.go('plan')); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen .pw-page:not([aria-hidden]) .pw-day[data-kind="light"] .pw-pill'); if (b) b.click(); }); }],
    ['plan-move', async () => { await page.evaluate(() => window.GH.ui.go('plan')); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen .pw-page:not([aria-hidden]) .pw-day[data-kind="workout"] .pw-pill'); if (b) b.click(); }); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen .pw-card [data-act="planMoveOpen"]'); if (b) b.click(); }); await settle(); await page.evaluate(() => { const m = document.querySelector('#screen .pw-move'); if (m) m.scrollIntoView({ block: 'center' }); }); }],
    // The week slides with a CSS transition, which runs on real time rather than the test clock.
    ['plan-next', async () => { await page.evaluate(() => window.GH.ui.go('plan')); await settle(); await page.evaluate(() => { const b = document.querySelector('#screen [data-act="planWeek"][data-arg="1"]'); if (b) b.click(); }); await page.waitForTimeout(900); }],
    ['plan-info', async () => { await page.evaluate(() => window.GH.ui.go('plan')); await settle(); await act('planPhase'); }],
    ['food', async () => { await page.evaluate(() => window.GH.ui.go('food')); }],
    ['health', async () => { await page.evaluate(() => window.GH.ui.go('health')); }],
    ['health-lower', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => { const s = document.getElementById('screen'); const t = s.querySelector('.hl-trends'); if (t) s.scrollTop = t.getBoundingClientRect().top + s.scrollTop - 180; }); }],
    ['health-insight', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => { const d = document.querySelector('#screen .hl-ins'); if (d) { d.open = true; const s = document.getElementById('screen'); s.scrollTop = d.getBoundingClientRect().top + s.scrollTop - 200; } }); }],
    ['health-menu', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.click('#topbar [popovertarget="hlLog"]'); }],
    ['sheet-metric-weight', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('weightKg')); }],
    ['sheet-metric-rhr', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('rhr')); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); const top = window.GH.ui.topSheet(); if (top && top.detent) top.detent('large'); }); }],
    ['sheet-metric-sleep', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('sleepMin', { range: 365 })); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); const top = window.GH.ui.topSheet(); if (top && top.detent) top.detent('large'); const b = d && d.querySelector('.ms-hist'); if (b) b.scrollIntoView(); }); }],
    ['sheet-metric-edit', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => { window.GH.ui.metricSheet('rhr'); }); await settle(); await page.evaluate(() => window.GH.ui.metricEdit('rhr', window.GH.ui.today() - 1)); }],
    ['sheet-metric-feel', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('feel')); }],
    ['sheet-report', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await act('healthReport'); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.rs-sheet[open]'); const top = window.GH.ui.topSheet(); if (top && top.detent) top.detent('large'); }); }],
    ['progress', async () => { await page.evaluate(() => window.GH.ui.go('progress')); }],
    // The body map at 12 weeks with its "Train … more" button (a stand-in action if Tailor my plan isn't there).
    ['progress-12w', async () => { await page.evaluate(() => { const U = window.GH.ui; if (!U.act.tailorPlan) U.act.tailorPlan = () => {}; U.go('progress'); }); await settle(); await page.click('#screen .bm-range [data-arg="12"]'); }],
    ['progress-improved', async () => { await page.evaluate(() => { const U = window.GH.ui; if (!U.act.tailorPlan) U.act.tailorPlan = () => {}; U.go('progress'); }); await settle(); await page.click('[data-on="bodyMode"] input[value="improved"]', { force: true }); }],
    ['sheet-muscle', async () => { await page.evaluate(() => { const U = window.GH.ui; if (!U.act.tailorPlan) U.act.tailorPlan = () => {}; U.go('progress'); }); await settle(); await page.click('#screen .bm-view[data-view="front"] .bm-m[data-muscle="chest"] path'); await settle(1200); }],
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
    ['setup-welcome', async () => { await setup(0); }],
    ['setup-track', async () => { await setup(1); }],
    ['setup-about', async () => { await setup(3, async () => { await page.fill('.onboard input[data-k="age"]', '150'); await page.locator('.onboard input[data-k="age"]').dispatchEvent('change'); await page.locator('.ob-actions [data-variant="tinted"]').click(); }); }],
    ['setup-conditions', async () => { await setup(4, async () => { await chips(['.onboard .rf-chip[data-v="ra"]', '.onboard .rf-chip[data-v="oa"]', '.onboard .rf-chip[data-v="heart"]', '.onboard .rf-chip[data-v="seated"]']); }); }],
    ['setup-goals', async () => { await setup(5); }],
    ['setup-body', async () => { await setup(9); }],
    ['setup-baseline', async () => { await setup(10); }],
    ['setup-nutrition', async () => { await setup(11); }],
    ['setup-plan', async () => { await setup(4, async () => { await chips(['.onboard .rf-chip[data-v="balance"]', '.onboard .rf-chip[data-v="bp"]']); for (let i = 0; i < 7; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(300); } }); }],
    ['setup-food', async () => { await setup(1, async () => { await page.click('.onboard input[name="obTrack"][value="both"]', { force: true }); await settle(200); for (let i = 0; i < 10; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(300); } }); }],
    ['edit-conditions', async () => { await page.evaluate(() => window.GH.ui.editAnswers('conditions')); }],
    ['sheet-around', async () => { await page.evaluate(() => { window.GH.ui.S.profile.conditions = ['ra', 'bp']; window.GH.ui.S.profile.age = 67; window.GH.ui.act.planAround(); }); }],
    ['edit-food', async () => { await page.evaluate(() => window.GH.ui.editAnswers('food')); }],
    ['tour-4', async () => { await act('showTour'); await settle(); for (let i = 0; i < 3; i++) { await page.evaluate(() => { const b = document.querySelector('dialog[open] [data-act="tourNext"], .tour [data-act="tourNext"]'); if (b) b.click(); }); await settle(600); } }],
    ['sheet-rule', async () => { await page.evaluate(() => window.GH.ui.open('science', 'volume')); await settle(1200); }],
    ['sheet-evidence', async () => { await page.evaluate(() => window.GH.ui.open('science')); await settle(); await act('sciKey'); }],
    ['player', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(2000); }],
    ['sheet-leave', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(1200); await page.evaluate(() => window.__gh.back()); await settle(900); }],
    ['capsule', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(1200); await act('plKeep'); await settle(); await page.evaluate(() => window.GH.ui.go('progress')); }],
    // Your plans: the page, a plan's page (the coach's week copied), the picker, one exercise,
    // sharing, a shared plan's preview, Build me a plan, and the Plan tab with a plan in use.
    ['plans', async () => { await page.evaluate(() => window.GH.ui.open('plans')); }],
    ['plans-edit', async () => { await page.evaluate(() => { const U = window.GH.ui; U.open('plans'); U.act.cpNew(); U.act.cpNewCopy(); }); await settle(1500); }],
    ['plans-days', async () => { await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; const p = C.list(U.S)[0]; U.open('planEdit', p.id); }); await settle(); await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight / 2; }); }],
    ['plans-picker', async () => { await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; U.open('planEdit', C.list(U.S)[0].id); U.act.cpAdd({ dataset: { arg: '0' } }); }); await settle(1500); }],
    ['plans-item', async () => { await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; U.open('planEdit', C.list(U.S)[0].id); U.act.cpItem({ dataset: { arg: '0:0' } }); }); await settle(1200); }],
    ['plans-share', async () => { await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; const id = C.list(U.S)[0].id; U.open('planEdit', id); U.act.cpShare({ dataset: { arg: id } }); }); await settle(1200); }],
    ['plans-import', async () => { await page.evaluate(async () => { const C = window.GH.customPlan; const p = C.normalize({ name: 'Sam\'s gym split with a long name', note: 'Heavy first, then the rest.', days: [{ title: 'Upper body and a long title', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, secs: 30 }] }, { title: 'Lower', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'hg_rdl', sets: 3, reps: 10 }] }] }).plan; window.__gh.onLink(C.link(await C.encode(p, { from: 'Samantha' }))); }); await settle(1500); }],
    ['plans-build', async () => { await act('cpBuild'); }],
    ['plans-build-plan', async () => { await act('cpBuild'); await settle(); await page.evaluate(() => { document.getElementById('cpAskQ').value = '3 days, 30 minutes, bigger arms, bad knees'; window.GH.ui.act.cpBuildGo(); }); await settle(2500); }],
    ['plan-custom', async () => { await page.evaluate(() => { const GH = window.GH, U = GH.ui, C = GH.customPlan, S = U.S; GH.store.save = () => true; GH.store.saveSoon = () => {}; const p = C.list(S)[0] || C.add(S, C.fromCoach(S, U.today())).plan; C.use(S, p.id, U.today()); U.go('plan'); }); }],
    // Outdoor activities: starting, recording, tucked away, the summary, history and records.
    ['act-sheet', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('actStart'); }],
    ['act-perm', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('actStart'); await settle(900); await page.click('dialog[open] .at-tile[data-arg="hike"]'); }],
    ['act-perm-denied', async () => { await page.evaluate(() => { window.__act.perms = { location: 'denied', approximate: false, activity: 'granted', notifications: 'granted' }; window.GH.ui.go('today'); }); await settle(); await act('actStart'); await settle(900); await page.click('dialog[open] .at-tile[data-arg="walk"]'); }],
    ['act-nogps', async () => { await page.evaluate(() => { window.__act.perms = { location: 'denied', approximate: false, activity: 'granted', notifications: 'granted' }; window.GH.ui.go('today'); }); await settle(); await act('actStart'); await settle(900); await page.click('dialog[open] .at-tile[data-arg="run"]'); await settle(900); await page.click('dialog[open] [data-act="actNoGps"]'); await settle(3600); await settle(3 * 60 * 1000); }],
    ['act-search', async () => { await startAct('run', { searchMs: 60000 }); }],
    ['act-live', async () => { await startAct('run', { go: 6 * 60 * 1000 }); }],
    ['act-paused', async () => { await startAct('cycle', { go: 4 * 60 * 1000 }); await page.evaluate(() => window.GH.ui.act.alPause()); }],
    ['act-pill', async () => { await startAct('walk', { go: 2 * 60 * 1000 }); await page.evaluate(() => window.__gh.back()); }],
    ['act-capsule', async () => { await startAct('run', { go: 2 * 60 * 1000 }); await page.evaluate(() => window.__gh.back()); await settle(); await page.evaluate(() => window.GH.ui.go('health')); }],
    ['act-summary', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activity', 'seed-r3')); }],
    ['act-summary-end', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activity', 'seed-r3')); await settle(); await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight; }); }],
    ['act-ride', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activity', 'seed-c1')); }],
    ['act-rename', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activity', 'seed-w1')); await settle(); await act('actRename', 'seed-w1'); }],
    ['activities', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activities')); }],
    ['activities-records', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activities')); await settle(); await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight; }); }],
    ['progress-records', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.go('progress')); await settle(1200); await page.evaluate(() => { const r = document.querySelector('#screen .act-records'); if (r) r.scrollIntoView({ block: 'center' }); }); }],
    ['health-activity', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.go('health')); await settle(1200); await page.evaluate(() => { const r = document.querySelector('#screen [data-key="act-start"]'); if (r) r.scrollIntoView({ block: 'center' }); }); }],
    // Last, since it changes the state: today's workout done (not saved, so a reload undoes it).
    ['plan-done', async () => { await page.evaluate(() => { const GH = window.GH, U = GH.ui, B = GH.brain, S = U.S; GH.store.save = () => true; GH.store.saveSoon = () => {}; B.startWorkout(S, U.today(), { now: Date.now() - 26 * 60000 }); for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); } B.finishWorkout(S, { rating: 'right', now: Date.now() }); U.go('plan'); }); }],
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
    if (id === 'player' || id === 'capsule') await page.evaluate(() => { const S = window.GH.ui.S; if (window.GH.ui.closePlayer) window.GH.ui.closePlayer(); S.active = null; window.GH.store.save(S); });
    // An activity still recording would open again after the reload: stop it and forget it.
    if (id.startsWith('act-') || id.startsWith('activities') || id.endsWith('-records') || id === 'health-activity') {
      await page.evaluate(() => { const S = window.GH.ui.S; window.GH.activity.reset(); S.actLive = null; S.activities = []; window.GH.store.save(S); sessionStorage.removeItem('act-fake'); });
    }
    // A slow machine can take a while to start the page again; a page that fails to start says why.
    try { await page.reload(); await booted('#screen[data-view]'); } catch (e) {
      check(`${id}: the page starts again`, false, `${e.message.split('\n')[0]} ${errors.slice(-3).join(' | ')}`);
      await page.reload({ timeout: 60000 });
      await booted('#screen[data-view]');
    }
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
