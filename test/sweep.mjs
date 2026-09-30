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
  const roots = [document.getElementById('screen'), document.getElementById('float'), document.getElementById('tabbar'), document.getElementById('player'), document.getElementById('onboard'), ...document.querySelectorAll('dialog[open]')].filter((r) => r && !r.hidden);
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
  const pl = document.getElementById('player'), ob = document.getElementById('onboard');
  const scr = document.getElementById('screen');
  if (scr && !document.querySelector('dialog[open]') && (!pl || pl.hidden) && (!ob || ob.hidden)) {
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
    ['sheet-metric-rhr', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('rhr')); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); if (d && window.Refract) window.Refract.sheet.detent(d, 'large'); }); }],
    ['sheet-metric-sleep', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('sleepMin', { range: 365 })); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); if (d && window.Refract) window.Refract.sheet.detent(d, 'large'); const b = d && d.querySelector('.ms-hist'); if (b) b.scrollIntoView(); }); }],
    ['sheet-metric-edit', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => { window.GH.ui.metricSheet('rhr'); }); await settle(); await page.evaluate(() => window.GH.ui.metricEdit('rhr', window.GH.ui.today() - 1)); }],
    ['sheet-metric-feel', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await page.evaluate(() => window.GH.ui.metricSheet('feel')); }],
    ['sheet-report', async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); await act('healthReport'); await settle(); await page.evaluate(() => { const d = document.querySelector('dialog.rs-sheet[open]'); if (d && window.Refract) window.Refract.sheet.detent(d, 'large'); }); }],
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
    ['edit-food', async () => { await page.evaluate(() => window.GH.ui.editAnswers('food')); }],
    ['tour-4', async () => { await act('showTour'); await settle(); for (let i = 0; i < 3; i++) { await page.evaluate(() => { const b = document.querySelector('dialog[open] [data-act="tourNext"], .tour [data-act="tourNext"]'); if (b) b.click(); }); await settle(600); } }],
    ['sheet-rule', async () => { await page.evaluate(() => window.GH.ui.open('science', 'volume')); await settle(1200); }],
    ['sheet-evidence', async () => { await page.evaluate(() => window.GH.ui.open('science')); await settle(); await act('sciKey'); }],
    ['player', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(2000); }],
    ['sheet-leave', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(1200); await page.evaluate(() => window.__gh.back()); await settle(900); }],
    ['capsule', async () => { await page.evaluate(() => window.GH.ui.go('today')); await settle(); await act('startWorkout'); await settle(1200); await act('plKeep'); await settle(); await page.evaluate(() => window.GH.ui.go('progress')); }],
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
