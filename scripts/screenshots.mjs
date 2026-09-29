// Renders the store screenshots in docs/screenshots/ from the built page: someone five weeks in,
// with a streak, level-ups and a month of Health Connect data. Needs Playwright with Chromium.
//
//   npm run build && node scripts/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = join(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });
const NOW = new Date('2026-10-19T08:10:00'); // a Monday, week 4

// The Android bridge, with Health Connect granted and 40 days of believable data.
function bridge() {
  const DAY = 86400000, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const wave = (i, a, b) => Math.sin(i * 1.7) * a + Math.cos(i * 0.6) * b;
  const days = []; for (let i = 40; i >= 0; i--) days.push(now - i * DAY);
  const payload = () => ({
    ok: true, tz: 'America/New_York', from: iso(now - 40 * DAY), to: iso(now),
    steps: days.map((t, i) => ({ date: new Date(t - 5 * 3600000).toISOString().slice(0, 10), count: Math.round(7200 + wave(i, 1600, 900) + i * 25) })),
    sleep: days.map((t, i) => ({ start: iso(t - 9.2 * 3600000 + wave(i, 1500000, 900000)), end: iso(t - 1.6 * 3600000), asleepMin: Math.round(425 + wave(i, 22, 14)) })),
    weight: days.filter((_, i) => i % 2 === 0).map((t, i) => ({ time: iso(t - 3 * 3600000), kg: 68.4 - i * 0.03 + wave(i, 0.15, 0.1) })),
    height: [{ time: iso(now - 60 * DAY), m: 1.76 }], bodyFat: [],
    restingHr: days.map((t, i) => ({ time: iso(t - 3600000), bpm: Math.round(60 - i * 0.05 + wave(i, 1.5, 1)) })),
    hrv: days.map((t, i) => ({ time: iso(t - 3600000), ms: Math.round(54 + i * 0.1 + wave(i, 4, 3)) })),
    exercise: [{ start: iso(now - 5 * DAY - 2 * 3600000), end: iso(now - 5 * DAY - 2 * 3600000 + 42 * 60000), type: 33, typeName: 'running', title: '' }],
    errors: {},
  });
  const store = { state: '', secrets: {} };
  window.AndroidBridge = {
    hcStatus: () => 'granted', hcRequest: () => {}, hcOpenSettings: () => {}, hcCanWrite: () => true, hcWriteWorkout: () => {},
    hcRead: () => { setTimeout(() => window.__gh.onHealth(payload()), 30); },
    save: (s) => { store.state = s; try { sessionStorage.setItem('shot-state', s); } catch (e) { /* ignore */ } return true; },
    load: () => { try { return sessionStorage.getItem('shot-state') || store.state; } catch (e) { return store.state; } },
    saveSecret: () => true, loadSecret: () => '', deleteSecret: () => true,
    keepAwake: () => {}, vibrate: () => {}, vibratePattern: () => {}, copy: () => true, openUrl: () => {},
    isDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches, appVersion: () => '1.1.0',
    haptic: () => {}, setSystemBars: () => {}, insets: () => JSON.stringify({ top: 30, bottom: 20, left: 0, right: 0, keyboard: false }),
    shareText: () => {}, claudeInstalled: () => true,
  };
}

// Five weeks of history, built with the app's own brain so every number is real.
function seed() {
  const B = window.GH.brain;
  const today = B.dayOf(Date.now(), 4);
  const start = today - 35;
  const S = B.newState({ goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, units: 'lb', weightKg: 68.4, weightGoal: 'maintain', equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null }, name: 'Alex' }, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, start);
  S.health.status = 'granted';
  for (let d = start; d < today; d++) {
    const plan = B.todayPlan(S, d);
    if (plan.type === 'workout') {
      const t0 = d * B.DAY_MS + (4 + 13 + (d % 3)) * 3600000;
      B.startWorkout(S, d, { now: t0 });
      let g = 0;
      while (S.active && S.active.idx < S.active.steps.length && g++ < 400) {
        const st = S.active.steps[S.active.idx];
        B.completeStep(S, st.kind === 'test' ? { value: st.side === 'L' ? 14 : 15 } : {});
        if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 4 === 0 ? '3' : '12');
      }
      const res = B.finishWorkout(S, { rating: 'right', now: t0 + 24 * 60000 });
      S.pendingLines = res.lines;
    } else if (plan.type === 'light') { B.logLight(S, d, 'walk', true); B.logLight(S, d, 'mobility', true); }
    if (d % 7 !== 3) { B.addProtein(S, d, 26); B.addProtein(S, d, 40); B.addProtein(S, d, 35); B.addProtein(S, d, 30); }
  }
  B.addProtein(S, today, 26); B.addProtein(S, today, 32);
  S.feel[today] = { energy: 'good', sore: 'some' };
  S.seen = { tour: true, checklistHidden: true, lastVersion: window.GH.VERSION, tip_plan: true, tip_health: true, tip_progress: true, tip_moves: true, playerHint: true, rirCount: 5, moveSheet: true };
  S.measurements = [{ day: start + 1, waist: 81.5, armL: 30.4, armR: 31.6 }, { day: today - 1, waist: 80.6, armL: 31.1, armR: 31.8 }];
  window.GH.store.save(S);
}

async function run(dark) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: NOW });
  await page.addInitScript(bridge);
  const url = 'file://' + join(root, 'dist/gradient-health.html');
  await page.goto(url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seed);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  const settle = async (ms = 900) => { await page.clock.runFor(ms); await page.waitForTimeout(ms); };
  const shot = async (name) => { await settle(); await page.screenshot({ path: join(out, `${name}${dark ? '-dark' : ''}.png`) }); };
  const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(700); };
  const top = () => page.evaluate(() => document.getElementById('screen').scrollTo(0, 0));

  await shot('today');
  await page.click('#float [data-act="startWorkout"]');
  await page.waitForSelector('.player:not([hidden]) .pl-name');
  // Skip the warm-up to the first real set.
  for (let i = 0; i < 12; i++) {
    const kind = await page.evaluate(() => { const a = window.GH.ui.S.active; return a && a.steps[a.idx] ? a.steps[a.idx].kind : null; });
    if (kind === 'set') break;
    await page.evaluate(() => { window.GH.brain.completeStep(window.GH.ui.S, {}); });
    await page.evaluate(() => window.GH.ui.openPlayer());
  }
  await page.evaluate(() => window.GH.ui.openPlayer());
  await shot('workout');
  await page.click('.player [data-act="plDone"]');
  await page.waitForSelector('.player .pl-timer');
  await shot('rest');
  await page.click('.player [data-act="plMin"]');
  await settle(500);
  // Put the workout away so the other screens don't show it in progress.
  await page.evaluate(() => { window.GH.ui.S.active = null; window.GH.ui.render(); });
  await tab('health');
  await top();
  await shot('health');
  await page.evaluate(() => { const el = document.querySelector('#screen [data-key="ch-sleep"]') || document.querySelector('#screen .ch-card'); document.getElementById('screen').scrollTo(0, el.offsetTop - 120); });
  await shot('trends');
  await tab('progress');
  await shot('progress');
  await tab('plan');
  await shot('plan');
  await tab('today');
  await page.click('#topbar [data-act="openProfile"]');
  await shot('profile');
  await page.evaluate(() => window.GH.ui.open('science', 'rir'));
  await shot('science');
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
}

await run(false);
await run(true);
console.log(`screenshots in ${out}`);
