// Renders the store screenshots in docs/screenshots/ from the built page: someone five weeks in,
// with a streak, level-ups, a month of Health Connect data and a food log. Needs Playwright with
// Chromium. The page is served over http like the app's asset host, so the lazy parts load.
//
//   npm run build && node scripts/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seedBridge, seedState } from '../test/fixtures.mjs';
import { actBridge, seedActivities } from '../test/actfixture.mjs';
import { serveDist } from '../test/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = join(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });
const NOW = new Date('2026-10-19T08:10:00'); // a Monday, week 6

// A week of meals on top of the training history, so the Food tab has something to show.
function seedFood() {
  const GH = window.GH, S = GH.ui.S, B = GH.brain, F = GH.food;
  const day = GH.ui.today();
  F.setMode(S, 'full');
  const at = (d, h) => d * B.DAY_MS + (h + 4) * 3600000;
  const meals = [
    ['breakfast', 4, 'Greek yogurt with berries', '1 bowl', 260, 22, 30, 6],
    ['breakfast', 4, 'Coffee with milk', '1 mug', 45, 3, 4, 2],
    ['lunch', 9, 'Chicken rice bowl', '1 bowl', 610, 44, 68, 15],
    ['snack', 12, 'Protein bar', '1 bar', 220, 20, 22, 7],
    ['dinner', 15, 'Salmon, potatoes and greens', '1 plate', 690, 42, 52, 30],
  ];
  for (let d = day - 9; d <= day; d++) {
    for (const [meal, h, name, portion, kcal, p, c, f] of meals) {
      if (d === day && h > 5) continue;
      F.add(S, d, { name, portion, src: 'quick', kcal, p, c, f, meal }, at(d, h));
    }
  }
  GH.store.save(S);
}

async function run(dark) {
  const server = await serveDist();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: NOW });
  await page.addInitScript(seedBridge);
  await page.addInitScript(actBridge);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
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
  await settle(1800);
  await shot('workout');
  await page.click('.player [data-act="plDone"]');
  await page.waitForSelector('.player .pl-timer');
  // Finish the exercise, so the rest screen asks how many more reps were left.
  for (let i = 0; i < 6 && !(await page.$('.player .pl-rir')); i++) {
    const skip = await page.$('.player [data-act="plSkipRest"]');
    if (skip) { await skip.click(); await settle(500); }
    const cont = await page.$('.player [data-act="plContinue"]');
    if (cont) { await cont.click(); await settle(500); }
    const done = await page.$('.player [data-act="plDone"]');
    if (done) { await done.click(); await settle(500); }
  }
  await shot('rest');
  await page.evaluate(() => window.GH.ui.act.plKeep());
  await settle(500);
  // Put the workout away so the other screens don't show it in progress.
  await page.evaluate(() => { window.GH.ui.S.active = null; window.GH.ui.render(); });
  await tab('health');
  await top();
  await shot('health');
  await page.evaluate(() => { const el = document.querySelector('#screen .hl-trends'); document.getElementById('screen').scrollTo(0, el.offsetTop - 120); });
  await shot('trends');
  // A number's own sheet: resting heart rate, its chart, where each value came from and its history.
  await page.evaluate(() => window.GH.ui.metricSheet('rhr'));
  await settle(1200);
  await shot('metric');
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(600);
  await tab('progress');
  await shot('progress');
  await tab('plan');
  // The exercise tiles turn into stills of the 3D figure while the phone is idle.
  for (let i = 0; i < 20 && await page.evaluate(() => document.querySelectorAll('#screen .pw-card .pw-thumb[data-move] > svg').length > 0); i++) await settle(700);
  await shot('plan');
  // An outdoor activity's summary: the route, pace, splits and the watch's heart rate.
  await page.evaluate(seedActivities);
  await page.evaluate(() => { const a = window.GH.activity.get(window.GH.ui.S, 'seed-r3'); a.title = 'Tempo run'; });
  await settle();
  await page.evaluate(() => window.GH.ui.open('activity', 'seed-r3'));
  await settle(1500);
  // Light: the numbers and new records; dark: the route on its map, with the splits under it.
  if (dark) await page.evaluate(() => { const el = document.querySelector('#screen [data-key="map"]'); if (el) document.getElementById('screen').scrollTo(0, el.offsetTop - 110); });
  else await top();
  await shot('activity');
  // Your plans: one made from the coach's week, its days, and sharing it as a QR code.
  await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; const p = C.list(U.S)[0] || C.add(U.S, C.fromCoach(U.S, U.today())).plan; U.open('planEdit', p.id); });
  await settle(1200);
  await top();
  await shot('plans');
  await page.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; U.act.cpShare({ dataset: { arg: C.list(U.S)[0].id } }); });
  await settle(1500);
  await shot('share');
  await page.evaluate(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* to the tab */ } });
  await settle(600);
  // A plan built around a 68-year-old body with balance problems and a sore knee.
  await page.evaluate(() => { const U = window.GH.ui, p = U.S.profile; Object.assign(p, { age: 68, conditions: ['balance', 'oa'], oaJoints: ['knee'] }); U.act.planAround(); });
  await settle(1200);
  await shot('around');
  await page.evaluate(() => { const U = window.GH.ui, p = U.S.profile; U.closeSheets(); Object.assign(p, { age: 24, conditions: [], oaJoints: [] }); U.render(); });
  await settle(600);
  await tab('today');
  await page.evaluate(() => window.GH.ui.open('coach'));
  await shot('coach');
  await page.evaluate(() => window.GH.ui.back());
  // The coach chat with the Fast model on the phone. The screenshot machine can't run the real model,
  // so the conversation is written out: what a good answer from it looks like.
  await page.evaluate(() => {
    const U = window.GH.ui, S = U.S, d = U.deviceState();
    Object.assign(d, { checked: true, available: { ok: true, reason: '' }, installed: [{ id: 'q35-08', file: 'Qwen3.5-0.8B-Q4_K_M.gguf', bytes: 533e6 }] });
    U.checkDevice = () => Promise.resolve(d);
    S.ai.deviceModel = 'q35-08';
    S.ai.deviceChat = [];
  });
  await page.click('#topbar .coach-btn');
  await settle(1200);
  await shot('chat');
  await page.evaluate(() => {
    const U = window.GH.ui, S = U.S;
    S.ai.deviceChat = [
      { role: 'user', text: 'Why is today lighter?' },
      { role: 'assistant', model: 'q35-08', text: 'You slept 5 h 40 min last night, well under your usual 7 h 10 min, so the app took one set off each exercise today. You still train every muscle on the plan, just with a little less fatigue. A normal night\'s sleep and tomorrow is back to full.', facts: ['What the app worked out: A short night: 5 h 40 min against your usual 7 h 10 min.', 'How the app decides (An easier day after a short night): one set comes off each exercise.'] },
      { role: 'user', text: 'Am I getting stronger?' },
      { role: 'assistant', model: 'q35-08', text: 'Yes. Your dumbbell curl went from **10 to 15 lb** in five weeks, and push-ups moved up two levels, to the full version. Your left arm is catching up too: the gap is down to 6%.', facts: ['What the app worked out: Curl 10 → 15 lb; push-ups level 3 → 5; left vs right gap 6%.'] },
    ];
    U.refreshChat();
  });
  await shot('answer');
  await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.ui.S.ai.deviceChat = []; });
  await settle(600);
  // Tailor my plan: the changes it would make, before anything changes.
  await page.evaluate(() => window.GH.ui.act.tailorPlan());
  await settle(700);
  await page.fill('#tailorQ', 'More legs and glutes, my knees hurt, 20 minute workouts');
  await page.click('[data-act="tailorSuggest"]');
  await shot('tailor');
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(600);
  await page.click('#topbar [data-act="openProfile"]');
  await shot('profile');
  await page.evaluate(() => window.GH.ui.open('science', 'rir'));
  await shot('science');
  // Food: calorie tracking on, a week of meals.
  await page.evaluate(seedFood);
  await page.evaluate(() => { while (window.GH.ui.back()) { /* to the tab */ } window.GH.ui.go('food'); });
  await settle(900);
  await top();
  await shot('food');
  // A gym day: the same person training at a gym.
  await page.evaluate(() => { const S = window.GH.ui.S; S.profile.where = 'gym'; S.profile.gym = window.GH.brain.gymPreset('full', S.profile.units); window.GH.store.save(S); window.GH.ui.go('today'); });
  await settle(900);
  await page.evaluate(() => { const el = document.querySelector('#screen .session'); if (el) document.getElementById('screen').scrollTo(0, el.offsetTop - 110); });
  await shot('gym');
  // Set-up, from the start: the step that asks what to plan around.
  await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.ui.showOnboarding(); });
  await settle(600);
  for (let i = 0; i < 4; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(400); }
  for (const v of ['balance', 'oa']) { await page.click(`.onboard .rf-chip[data-v="${v}"]`); await settle(200); }
  await shot('setup');
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
  await server.close();
}

await run(false);
await run(true);
console.log(`screenshots in ${out}`);
