// Renders the store screenshots in docs/screenshots/ from the built page: someone five weeks in,
// with a streak, level-ups, a month of Health Connect data and a food log. Needs Playwright with
// Chromium. The page is served over http like the app's asset host, so the lazy parts load.
//
//   npm run build && node scripts/screenshots.mjs
//
// SHOTS_OUT=<dir> writes them somewhere else (to look at them without touching docs/).
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seedBridge, seedState } from '../test/fixtures.mjs';
import { actBridge, seedActivities } from '../test/actfixture.mjs';
import { serveDist } from '../test/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium, request;
try { ({ chromium, request } = require('playwright')); } catch { ({ chromium, request } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.env.SHOTS_OUT || join(root, 'docs/screenshots');
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

// A walk along Venice Beach, Los Angeles, the evening before: up the boardwalk (Ocean Front Walk) from
// the pier to Rose Avenue, back along the water, then out to the end of the pier and back. A fix a
// second at a walk's pace with a little GPS noise, and the watch's steps, calories and heart rate.
function seedWalk() {
  const GH = window.GH, A = GH.activity, U = GH.ui, S = U.S;
  const WAY = [
    [33.97880, -118.46640], [33.98110, -118.46830], [33.98365, -118.47040], [33.98650, -118.47290],
    [33.98960, -118.47560], [33.99300, -118.47830], [33.99600, -118.48070], // north on the boardwalk
    [33.99540, -118.48170], [33.99200, -118.47930], [33.98850, -118.47650], [33.98500, -118.47370],
    [33.98150, -118.47080], [33.97840, -118.46790], // south along the water
    [33.97660, -118.47030], [33.97830, -118.46800], // out along the pier and back
  ];
  const M = 111195, ML = M * Math.cos((33.987 * Math.PI) / 180);
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 - 0.5; };
  const dt = new Date((U.today() - 1) * 86400000);
  const start = new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 16, 50).getTime();
  const pts = [];
  let t = start, d = 0;
  for (let i = 0; i + 1 < WAY.length; i++) {
    const [a, b] = [WAY[i], WAY[i + 1]];
    const len = Math.hypot((b[0] - a[0]) * M, (b[1] - a[1]) * ML);
    for (let x = 0; x < len;) {
      const f = x / len, v = 1.42 + 0.12 * Math.sin(d / 400);
      pts.push([t, a[0] + (b[0] - a[0]) * f + (rnd() * 2.5) / M, a[1] + (b[1] - a[1]) * f + (rnd() * 2.5) / ML, 4 + 2 * Math.sin(d / 700), 4, v, 0]);
      x += v; d += v; t += 1000;
    }
  }
  let act = A.build(S, { id: 'shot-walk', type: 'walk', title: 'Venice Beach walk', start, end: t, points: pts, movingMs: t - start, steps: null });
  const hr = [];
  let drift = 0;
  for (let x = start; x <= t; x += 5000) { drift = drift * 0.85 + rnd() * 3; hr.push([x, Math.round(97 + 9 * Math.sin((x - start) / 900000) + drift)]); }
  act = A.withWatch(S, act, { id: 'shot-walk', ok: true, steps: Math.round(d * 1.31), activeKcal: Math.round(d * 0.052), hr, sources: ['com.samsung.android.wear.shealth'] });
  act.saved = { at: Date.now(), ok: true, route: true };
  A.add(S, act);
  GH.store.save(S);
}

async function run(dark) {
  const server = await serveDist();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  // The map's pieces come from OpenFreeMap, fetched here (through the environment's proxy, if it has
  // one: Playwright would send the local page through a browser's proxy too) and handed to the page.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const net = await request.newContext(proxy ? { proxy: { server: proxy } } : {});
  await ctx.route(/^https:\/\/tiles\.openfreemap\.org\//, async (route) => {
    try { await route.fulfill({ response: await net.fetch(route.request()) }); } catch (e) { await route.abort(); }
  });
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
  // Each tab's tip is for a first visit: the shots show the screens themselves.
  await page.evaluate(() => { const U = window.GH.ui, S = U.S; for (const id of ['today', 'plan', 'moves', 'food', 'health', 'progress', 'you']) S.seen[`tip_${id}`] = true; window.GH.store.save(S); U.render(); });
  const settle = async (ms = 900) => { await page.clock.runFor(ms); await page.waitForTimeout(ms); };
  // A message that came up on its way (a new badge, say) is cleared first: the shots show the screens.
  const shot = async (name) => {
    await settle();
    if (await page.evaluate(() => { const b = [...document.querySelectorAll('.rf-toast .rf-toast-close')]; b.forEach((x) => x.click()); return b.length > 0; })) await settle(700);
    await page.screenshot({ path: join(out, `${name}${dark ? '-dark' : ''}.png`) });
  };
  const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(700); };
  const top = () => page.evaluate(() => document.getElementById('screen').scrollTo(0, 0));
  // The badges' medals turn into stills of the 3D ones while the phone is idle (the SVG stands in, and
  // stays where WebGL can't draw).
  const medals = async () => { for (let i = 0; i < 90 && await page.evaluate(() => { const U = window.GH.ui; return !!(U.canDraw3d && U.canDraw3d()) && !U.medals.off && [...document.querySelectorAll('#screen .bdg-m')].some((h) => !h.querySelector('.bdg-img')); }); i++) await settle(1000); };

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
  // An outdoor activity's summary: the walk along Venice Beach, after a few weeks of runs and walks
  // (so it has records to beat). When OpenFreeMap can be reached from here, its map is behind the route.
  await page.evaluate(seedActivities);
  await page.evaluate(seedWalk);
  const mapOk = await page.evaluate(() => window.GH.ui.mapPieces.tilejson().then(() => true, () => false));
  if (mapOk) await page.evaluate(() => { const S = window.GH.ui.S; S.profile.prefs.actMaps = true; delete S.profile.prefs.actStreets; window.GH.store.save(S); });
  else console.log('OpenFreeMap can\'t be reached from here: the activity shots have no map');
  await settle();
  await page.evaluate(() => window.GH.ui.open('activity', 'shot-walk'));
  await settle(1500);
  if (mapOk) {
    for (let i = 0; i < 40 && !(await page.$('#screen .am-streets[data-state="ready"]')); i++) await settle(500);
    await settle(2500); // the tiles under the route
  }
  // Light: the numbers and new records; dark: the route on its map (with no map, pace and terrain).
  if (dark) {
    await page.evaluate((m) => {
      const sp = document.querySelector('#screen [data-key="splits"]'), sec = sp && sp.closest('.section');
      const el = m ? document.querySelector('#screen [data-key="map"]') : sec && sec.previousElementSibling;
      if (el) document.getElementById('screen').scrollTo(0, el.offsetTop - (m ? 110 : 96));
    }, mapOk);
  }
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
    S.ai.chats = [];
    S.ai.chatId = null;
  });
  await page.click('#topbar .coach-btn');
  await settle(1200);
  await shot('chat');
  await page.evaluate(async () => {
    const U = window.GH.ui, S = U.S;
    await window.GH.lazy('cards');
    window.GH.chats.add(S, 'shot', [
      { role: 'user', text: 'Why is today lighter?', engine: 'device' },
      { role: 'assistant', engine: 'device', model: 'q35-08', text: 'You slept **5 h 40 min** last night, so the app took one set off each exercise today.\n\n- That\'s well under your usual 7 h 10 min.\n- Every muscle on the plan still gets its work, with less fatigue.\n\nA normal night, and tomorrow is back to full.', embeds: ['sleep:7d'], facts: ['What the app worked out: A short night: 5 h 40 min against your usual 7 h 10 min.', 'How the app decides (An easier day after a short night): one set comes off each exercise.'] },
      { role: 'user', text: 'Am I getting stronger?', engine: 'device' },
      { role: 'assistant', engine: 'device', model: 'q35-08', text: 'Yes: your dumbbell curl went from **10 to 15 lb** in five weeks.\n\n- Push-ups moved up two levels, to the full version.\n- Your left arm is catching up: the gap is down to 6%.', embeds: ['lift:Dumbbell curl:90d'], facts: ['What the app worked out: Curl 10 → 15 lb; push-ups level 3 → 5; left vs right gap 6%.'] },
    ]);
    S.ai.chatId = 'shot';
    U.refreshChat('bottom');
  });
  await shot('answer');
  await page.evaluate(() => { const S = window.GH.ui.S; window.GH.ui.closeSheets(); S.ai.chats = []; S.ai.chatId = null; });
  await settle(600);
  // Tailor my plan: the changes it would make, before anything changes.
  await page.evaluate(() => window.GH.ui.act.tailorPlan());
  await settle(700);
  await page.fill('#tailorQ', 'More legs and glutes, my knees hurt, 20 minute workouts');
  await page.click('[data-act="tailorSuggest"]');
  await shot('tailor');
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(600);
  // You: your card, the badges' shelf, plans and answers (Profile before 1.6).
  await tab('you');
  await top();
  await medals();
  await shot('you');
  // Reminders, turned on: Settings' Notifications group, a switch for each kind and the time.
  await page.evaluate(() => {
    const U = window.GH.ui, S = U.S;
    window.__notify.permission = 'granted';
    if (window.__bg) Object.assign(window.__bg, { supported: true, granted: true, on: true });
    S.profile.prefs.notify.on = true;
    window.GH.store.save(S);
    U.open('settings');
  });
  await settle(1500);
  await page.evaluate(() => { const h = document.querySelector('#screen #notify'); if (h) document.getElementById('screen').scrollTo(0, h.offsetTop - 210); });
  await settle(900); // the planner's chunk loads, for the reminder time
  await shot('reminders');
  await page.evaluate(() => { const U = window.GH.ui; while (U.back()) { /* to the tab */ } });
  await settle(600);
  // Badges: the gallery's 3D medals, then one shared as a picture (the preview is exactly what gets
  // sent, the 3D medal large on it). The 30-day streak when it's earned, else the newest earned one.
  await page.evaluate(() => window.GH.ui.open('badges'));
  await settle(1200);
  await top();
  await medals();
  await shot('badges');
  // A new badge, sealed: a glass capsule in its tier's colours, with its rarity and nothing else. In
  // dark, two taps in: cracked, one more to open it.
  const sealed = await page.evaluate(() => {
    const U = window.GH.ui, earned = (U.S.achievements && U.S.achievements.earned) || {};
    const ids = Object.keys(earned).sort((a, b) => (earned[b].day || 0) - (earned[a].day || 0));
    const id = ids.includes('streak30') ? 'streak30' : ids[0];
    earned[id].opened = false;
    U.badgeReveal([id]);
    return id;
  });
  await settle(1600);
  if (dark) for (let i = 0; i < 2; i++) { await page.click('.bdg-reveal .bdg-cap'); await settle(800); }
  await shot('sealed');
  await page.evaluate((id) => { const U = window.GH.ui; window.GH.achievements.markOpened(U.S, id); U.closeSheets(); }, sealed);
  await settle(800);
  await page.evaluate(() => {
    const U = window.GH.ui, earned = (U.S.achievements && U.S.achievements.earned) || {};
    const ids = Object.keys(earned).sort((a, b) => (earned[b].day || 0) - (earned[a].day || 0));
    U.shareBadge(ids.includes('streak30') ? 'streak30' : ids[0]);
  });
  await settle(1800);
  for (let i = 0; i < 60 && !(await page.evaluate(() => { const c = document.querySelector('dialog.sc-sheet[open] .sc-canvas'); return !!c && !!c.dataset.medal; })); i++) await settle(1000);
  await shot('badge-share');
  await page.evaluate(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* to the tab */ } });
  await settle(600);
  // Why this plan: what the planner compared and how the week scores, with no AI. From Plan, where
  // its row is.
  await tab('plan');
  await top();
  await page.evaluate(() => window.GH.ui.act.whyPlan());
  await settle(1400);
  await shot('why');
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(600);
  // The Coach's review: suggestions as Claude's weekly report would bring them, each checked against
  // the plan before it's offered (the screenshot machine can't ask Claude, so they're written out).
  await page.evaluate(() => window.GH.planReview.open('report', {
    engine: 'claude', model: 'Claude', note: 'Your plan fits your goals well. A little more time would give your arms and abs more.',
    suggestions: [
      { kind: 'minutes', minutes: 30, title: 'Five more minutes a session', why: 'Your arms and abs get more sets each week, with nothing else cut.' },
      { kind: 'swap_move', family: 'abs', move: 'ab_legraise', title: 'A new move for your abs', why: 'It works your abs from a new angle.' },
      // Turned down: there's no time for it (the sheet lists it under Not applied, with the reason).
      { kind: 'more_sets', group: 'back', delta: 1, title: 'More back work', why: 'You press more than you pull.' },
    ],
  }));
  await settle(1800);
  await shot('review');
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(600);
  await page.evaluate(() => window.GH.ui.open('science', 'rir'));
  await settle(1400); // the page's push, then the rule's sheet rising over it
  await shot('science');
  // The rule's sheet that "rir" opened closes before the next shots.
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(700);
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
  // Set-up, from the start: the plan it ends on, for someone who wants bigger arms and chest.
  await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.ui.showOnboarding(); });
  await settle(600);
  await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(400);
  for (const s of ['.ob-opt[data-arg="muscle"]', '.ob-areas [data-v="arms"]', '.ob-areas [data-v="chest"]']) { await page.click(s); await settle(200); }
  for (let i = 0; i < 4; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(400); }
  await settle(1600);
  await shot('setup');
  if (errors.length) console.log('page errors:', errors);
  await browser.close();
  await net.dispose();
  await server.close();
}

await run(false);
await run(true);
console.log(`screenshots in ${out}`);
