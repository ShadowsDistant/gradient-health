// End-to-end smoke run of the built page in Chromium at phone size, with a fake Android bridge
// and a controlled clock: set-up (welcome, four questions, the plan) → Today (the level check from
// the first week's checklist) → a workout with rest, a side switch, a timer and a swap → check-in →
// Next time (Health Connect offered there) → the tour → Health (coach, Claude hand-off) → Progress,
// Plan and its Moves → You, How it works, Settings → reload (persistence, What's new). Screenshots
// go to build/smoke/.
// Usage: node test/smoke.mjs [--dark] [--keep]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { root, check, section, done } from './lib.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const out = join(root, 'build/smoke');
mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: join(out, `${name}${dark ? '-dark' : ''}.png`) });

// A fake AndroidBridge: Health Connect granted with two weeks of data, state saved in memory.
function bridgeScript() {
  const DAY = 86400000;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const store = { state: '', secrets: {} };
  const days = [];
  for (let i = 20; i >= 0; i--) days.push(now - i * DAY);
  const payload = () => ({
    ok: true, tz: 'America/New_York', from: iso(now - 20 * DAY), to: iso(now),
    steps: days.map((t, i) => ({ date: new Date(t - 5 * 3600000).toISOString().slice(0, 10), count: 4000 + (i % 5) * 900 })),
    sleep: days.map((t, i) => ({ start: iso(t - 9 * 3600000), end: iso(t - 2 * 3600000 + (i % 3) * 600000), asleepMin: 380 + (i % 4) * 15, stages: { awake: 20, light: 200, deep: 80, rem: 90, unknown: 0 } })),
    weight: days.filter((_, i) => i % 2 === 0).map((t, i) => ({ time: iso(t - 3 * 3600000), kg: 67.6 - i * 0.05 })),
    height: [{ time: iso(now - 30 * DAY), m: 1.75 }],
    bodyFat: [],
    restingHr: days.map((t, i) => ({ time: iso(t - 3600000), bpm: 60 + (i % 3) })),
    hrv: days.map((t, i) => ({ time: iso(t - 3600000), ms: 55 + (i % 4) })),
    exercise: [{ start: iso(now - 3 * DAY), end: iso(now - 3 * DAY + 50 * 60000), type: 56, typeName: 'running', title: '' }],
    errors: {},
  });
  window.__haptics = []; window.__writes = []; window.__shared = null;
  window.AndroidBridge = {
    haptic: (k) => { window.__haptics.push(k); },
    setSystemBars: (d) => { window.__bars = d; },
    insets: () => JSON.stringify({ top: 32, bottom: 24, left: 0, right: 0, keyboard: false }),
    shareText: (t, target) => { window.__shared = { t, target }; },
    claudeInstalled: () => true,
    hcCanWrite: () => window.__hcStatus === 'granted',
    hcWriteWorkout: (j) => { const r = JSON.parse(j); window.__writes.push(r); setTimeout(() => window.__gh.onHealthWrite({ id: r.id, ok: true }), 20); },
    hcStatus: () => window.__hcStatus || 'denied',
    hcRequest: () => { window.__hcStatus = 'granted'; setTimeout(() => window.__gh && window.__gh.onHealthPerms && window.__gh.onHealthPerms('granted'), 50); },
    hcRead: () => { setTimeout(() => window.__gh && window.__gh.onHealth && window.__gh.onHealth(payload()), 80); },
    hcOpenSettings: () => {},
    save: (s) => { store.state = s; return true; },
    load: () => store.state,
    saveSecret: (k, v) => { store.secrets[k] = v; return true; },
    loadSecret: (k) => store.secrets[k] || '',
    deleteSecret: (k) => { delete store.secrets[k]; return true; },
    keepAwake: (on) => { window.__awake = on; },
    vibrate: () => {}, vibratePattern: () => {},
    copy: (t) => { window.__copied = t; return true; },
    isDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches, appVersion: () => '1.0.0 (test)', openUrl: () => {},
  };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.clock.install({ time: new Date('2026-09-28T08:00:00') }); // a Monday morning
await page.addInitScript(bridgeScript);
await page.goto('file://' + join(root, 'dist/gradient-health.html'));
await page.waitForSelector('.onboard:not([hidden]) .rf-large-title');

const settle = async (ms = 450) => { await page.clock.runFor(60); await page.waitForTimeout(ms); };
const clickNext = async () => { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(); };
const title = () => page.locator('.onboard .rf-large-title').first().innerText();
const hint = () => page.locator('.ob-actions .ob-hint').innerText().catch(() => '');

section('Set-up');
check('starts on the welcome screen, with the logo', (await title()) === 'Gradient Health' && await page.locator('.ob-hello .ob-logo').count() === 1);
check('and one way in: Get started', (await page.locator('.ob-actions [data-variant="tinted"]').innerText()).trim() === 'Get started');
await shot(page, '00-welcome');
await clickNext();
check('then what you want most', (await title()) === 'What do you want most?');
await page.click('.ob-opt[data-arg="muscle"]'); await settle(300);
for (const a of ['abs', 'arms', 'chest']) { await page.click(`.ob-areas [data-v="${a}"]`); await settle(150); }
await page.click('.ob-opt[data-arg="consistency"]'); await settle(300);
check('Build muscle (abs, arms, chest) then Stay consistent, numbered in tap order', (await page.locator('.ob-opt[data-arg="muscle"] .ob-mark-n').innerText()).trim() === '1' && (await page.locator('.ob-opt[data-arg="consistency"] .ob-mark-n').innerText()).trim() === '2');
check('a line says how the plan leans', /leans on abs and arms/.test(await hint()), await hint());
await shot(page, '01-want');
await clickNext();
check('then the time you have: three 30-minute workouts to start', (await title()) === 'How much time do you have?' && await page.locator('.onboard input[name="obDaysN"][value="3"]').isChecked() && await page.locator('.onboard input[name="obMins"][value="30"]').isChecked());
await page.click('.onboard input[name="obDaysN"][value="4"]', { force: true }); await settle(250);
check('four days, and today (a Monday) is the first', await page.locator('.onboard .ob-wd.is-on').count() === 4 && await page.locator('.onboard .ob-wd.is-today.is-on').count() === 1 && /first workout is today/.test(await hint()), await hint());
await clickNext();
check('then where you train: home, to start', (await title()) === 'Where do you train?' && await page.locator('.onboard .ob-tile[data-arg="home"][aria-checked="true"]').count() === 1);
for (const k of ['db', 'kb', 'ball']) { await page.click(`.onboard .ob-kit [data-v="${k}"]`); await settle(150); }
check('dumbbells and a kettlebell start from common weights', /Dumbbells: 10, 15, 20 lb/.test(await page.locator('.onboard details[data-more="weights"] summary').innerText()));
await shot(page, '02-where');
await clickNext();
check('then a little about you', (await title()) === 'A little about you');
await page.fill('.onboard input[data-k="age"]', '19'); await page.locator('.onboard input[data-k="age"]').dispatchEvent('change'); await settle(150);
await page.click('.onboard .ob-opt[data-arg="1to3"]'); await settle(200);
await page.click('.onboard details[data-more="size"] summary'); await settle(300);
await page.fill('.onboard input[data-k="_w"]', '148.8'); await page.locator('.onboard input[data-k="_w"]').dispatchEvent('change'); await settle(150);
await page.click('.onboard [data-act="obAround"]');
await page.waitForSelector('dialog.ob-around-sheet[open]');
await settle(400);
check('Anything to plan around? opens in a sheet, nothing picked', await page.locator('dialog.ob-around-sheet[open] .rf-chip[aria-pressed="true"]').count() === 0);
await page.click('dialog.ob-around-sheet[open] [data-act="obAroundDone"]');
await settle(500);
await shot(page, '03-you');
// See my plan: "Building your plan" for a moment, then the plan.
await page.locator('.ob-actions [data-variant="tinted"]').click();
await page.waitForTimeout(150);
await page.clock.runFor(1400);
await page.waitForSelector('.onboard .ob-reveal[data-ready]', { timeout: 8000 });
await page.waitForTimeout(600);
const planText = await page.locator('.onboard .ob-reveal').innerText();
check('then the plan: four workouts a week, 30 minutes each', /4 workouts a week/.test(planText) && /30 minutes each/.test(planText), planText.slice(0, 200));
check('the next seven days, today the first workout', await page.locator('.onboard .rv-day').count() === 7 && await page.locator('.onboard .rv-day.is-today.is-work').count() === 1);
check('today\'s workout with its moves, and why it\'s this plan', await page.locator('.onboard .rv-first .rv-tag.is-today').count() === 1 && await page.locator('.onboard .rv-move').count() >= 3 && /Why this plan/i.test(planText));
check('no Health Connect request before the plan', await page.evaluate(() => window.__hcStatus === undefined));
await shot(page, '04-plan');
await page.click('.ob-actions [data-act="obLook"]');

section('First run');
await page.waitForSelector('#screen[data-view="today"] .session');
await page.waitForTimeout(1600);
check('Look around first: Today, and no tour before the first workout', await page.evaluate(() => !document.querySelector('dialog.tour-sheet[open]')));
check('the page draws edge to edge with the shell\'s insets', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim() === '32px'));
check('status bar icons follow the page theme', await page.evaluate((d) => window.__bars === d, dark));

section('Today');
let todayText = await page.locator('#screen').innerText();
check('a getting-started checklist for the first week, the level check on it', /Getting started/.test(todayText) && /Finish your first workout/.test(todayText) && /Do a level check/.test(todayText));
await page.click('#screen [data-act="ckLevel"]');
await page.waitForSelector('dialog[open] #bPush');
await page.waitForTimeout(400);
for (const [id, v] of [['bPush', '24'], ['bCL', '14'], ['bCR', '18']]) await page.fill(`dialog[open] #${id}`, v);
await page.click('dialog[open] [data-act="baselineSave"]');
await page.waitForTimeout(800);
todayText = await page.locator('#screen').innerText();
check('the level check ticks off', await page.evaluate(() => window.GH.ui.seen('levelCheck')) && await page.locator('#screen .checklist [data-key="ck-level"] .ck.is-done').count() === 1);
check('Today shows the session with a time estimate', /Workout · about \d+ min/.test(todayText));
check('the extra left curl set is on the list', /left only/.test(todayText));
check('Start workout floats in glass', await page.locator('#float [data-act="startWorkout"]').isVisible());
check('no profile button on Today: You is a tab', await page.locator('#topbar [data-act="openProfile"]').count() === 0 && await page.locator('.rf-tab[data-tab="you"]').count() === 1);
await shot(page, '05-today');
// Re-renders patch the page in place: the bar and the cards are the same nodes afterwards.
await page.evaluate(() => { window.__nodes = [document.getElementById('topbar'), document.querySelector('#topbar .rf-scroll-edge'), document.querySelector('#screen [data-key="streak"]'), document.querySelector('#screen [data-key="main"]')]; });
await page.click('#screen .feel input[name="feelEnergy"][value="good"]', { force: true });
await page.waitForTimeout(400);
check('a feel check re-renders in place (no nodes rebuilt)', await page.evaluate(() => { const n = window.__nodes; return n[0] === document.getElementById('topbar') && n[1] === document.querySelector('#topbar .rf-scroll-edge') && n[2] === document.querySelector('#screen [data-key="streak"]') && n[3] === document.querySelector('#screen [data-key="main"]'); }));
check('segmented controls tap back with a haptic', await page.evaluate(() => window.__haptics.includes('select')));
await page.click('#float [data-act="toggleShort"]');
await page.waitForTimeout(200);
// The estimate rolls to its new value; the settled value is on data-roll.
const shortEst = Number(await page.locator('.session .rf-card-eyebrow [data-roll]').getAttribute('data-roll'));
check(`short on time → 12-15 min (${shortEst})`, shortEst >= 12 && shortEst <= 15);
await page.click('#float [data-act="toggleShort"]');
await page.waitForTimeout(200);

section('Workout');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
check('screen kept awake during the workout', await page.evaluate(() => window.__awake === true));
await shot(page, '06-player');
const hadUni = await page.evaluate(() => window.GH.ui.S.active.steps.some((x) => x.kind === 'set' && x.first === false));
let sawRest = false, sawSwitch = false, sawTimer = false, swapped = false, rirAsked = false, guard = 0;
let lastSide = null;
// 1.13: the question's answers, how many times it was asked, and the lines under the sets.
let rirOpts = null, rirN = 0;
const hints = new Set();
// One snapshot of the player per iteration (locators would wait for missing elements).
const state = () => page.evaluate(() => {
  const p = document.querySelector('.player');
  const q = (sel) => p.querySelector(sel);
  const t = q('.pl-actions [data-variant="tinted"]');
  return {
    checkin: !!(q('.rf-large-title') && q('.rf-large-title').textContent === 'Check-in'),
    act: t ? t.getAttribute('data-act') : null,
    side: q('.pl-side') ? q('.pl-side').textContent : null,
    eyebrow: q('.pl-eyebrow') ? q('.pl-eyebrow').textContent : '',
    rir: !!q('.pl-rir'), rirChosen: !!(q('.pl-rir input:checked')),
    rirOpts: [...p.querySelectorAll('.pl-rir .rf-segment')].map((l) => `${l.querySelector('input').value}:${l.textContent.trim()}`).join(' '),
    hint: q('.pl-hint') ? q('.pl-hint').textContent : '',
    skipRest: !!q('[data-act="plSkipRest"]'),
  };
});
while (guard++ < 300) {
  const st = await state();
  if (st.checkin) break;
  if (st.side && lastSide && st.side !== lastSide && /Right|Left/.test(st.side)) sawSwitch = true;
  if (st.side) lastSide = st.side;
  if (st.hint) hints.add(st.hint);
  if (st.rir && !st.rirChosen) {
    rirAsked = true;
    if (!rirN) { rirOpts = st.rirOpts; await shot(page, '07a-reps-left'); }
    // 1-2 left, and on the second exercise 4 or more.
    await page.click(`.player .pl-rir input[value="${rirN++ === 1 ? '4' : '12'}"]`, { force: true });
    await page.waitForTimeout(80);
    continue;
  }
  if (st.skipRest) {
    if (!sawRest) await shot(page, '07-rest');
    sawRest = true;
    await page.clock.fastForward(95000);
    await page.waitForTimeout(150);
    continue;
  }
  if (!swapped && st.act === 'plDone' && /set 1 of/.test(st.eyebrow)) {
    swapped = true;
    // Workout options: a menu out of its button (U.menu), then Swap opens its sheet.
    await page.click('.player [data-act="plMenu"]');
    await page.waitForSelector('.rf-menu:popover-open [data-act="plSwap"]', { timeout: 3000 }).catch(() => null);
    if (await page.locator('.rf-menu:popover-open [data-act="plSwap"]').count()) {
      await page.click('.rf-menu:popover-open [data-act="plSwap"]');
      await page.waitForSelector('dialog.rf-sheet [data-act="plSwapTo"]', { timeout: 3000 }).catch(() => null);
      const opt = page.locator('dialog.rf-sheet [data-act="plSwapTo"]').first();
      if (await opt.count()) { await opt.click(); await page.waitForTimeout(400); continue; }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    continue;
  }
  if (st.act === 'plStartTimer') { sawTimer = true; await page.click('.player [data-act="plStartTimer"]'); await page.clock.fastForward(3500); await page.waitForTimeout(100); await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act === 'plStopEarly' || st.act === 'plCancelTimer') { await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act) { await page.click(`.player [data-act="${st.act}"]`); await page.waitForTimeout(100); continue; }
  await page.waitForTimeout(150);
}
check('rest screens ran between sets', sawRest);
check('the reps-in-reserve tap was asked', rirAsked);
check('it offers 0, 1-2, 3 and 4+', rirOpts === '0:0 12:1-2 3:3 4:4+', rirOpts);
check('the line under a set says how many reps to leave', [...hints].some((h) => /^Stop with [1-3]-[2-4] reps left/.test(h)), [...hints]);
check('unilateral sets switch sides (when the session has one)', sawSwitch || !hadUni);
check('a timed set ran its countdown', sawTimer);
check('a swap was made from the menu', swapped);
check('reached the check-in', (await state()).checkin, await state());
await shot(page, '08-checkin');
await page.click('.player input[name="ckRating"][value="right"]', { force: true });
await page.click('.player [data-act="plSaveCheckin"]');
await page.waitForSelector('.player .rf-large-title:has-text("Next time")', { timeout: 5000 }).catch(async (e) => { console.log('errors so far:', errors); await shot(page, 'fail-next'); throw e; });
const nextText = await page.locator('.player').innerText();
check('Next time shows the streak', /Streak\s+1\s+day/.test(nextText), nextText.slice(0, 200));
const saved = await page.evaluate(() => { const l = window.GH.ui.S.log.find((x) => x.type === 'workout'); return l ? l.items.filter((it) => it.rir).map((it) => `${it.rir}/${it.aim}`) : null; });
check('the answers are saved with each exercise\'s aim, 4+ among them', !!saved && saved.some((x) => /^4\//.test(x)) && saved.every((x) => /\/(12|13|23|24)$/.test(x)), saved);
check('and offers Health Connect, now the first workout is done', await page.locator('.player .hc-invite [data-act="hcInviteGo"]').count() === 1);
await shot(page, '09-next');
await page.click('.player .hc-invite [data-act="hcInviteGo"]');
const connected = await page.waitForFunction(() => /Connected/.test((document.querySelector('.player .hc-invite') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true, () => false);
check('Connect asks Health Connect, then says it\'s connected', connected && await page.evaluate(() => window.__hcStatus === 'granted'));
await page.waitForTimeout(300);
await page.click('.player [data-act="plClose"]');
await page.waitForSelector('#screen .session.done');
check('Today shows the workout as done', /Done/.test(await page.locator('#screen .session.done').innerText()));
check('screen no longer kept awake', await page.evaluate(() => window.__awake === false));
const hx = await page.evaluate(() => window.__haptics);
check('haptics: start, finished sets and a finish', hx.includes('start') && hx.includes('done') && hx.includes('workoutDone'), hx.slice(-12));
const writes = await page.evaluate(() => window.__writes);
check('the workout was saved to Health Connect once, keyed by day', writes.length === 1 && writes[0].id === 'gradient-2026-09-28' && writes[0].type === 'strength_training' && writes[0].end > writes[0].start, writes);

section('The tour, after the first workout');
// It waits for anything on top (the toasts from connecting, a new badge's) to go first.
await page.waitForSelector('dialog.tour-sheet[open]', { timeout: 15000 }).catch(() => null);
check('not over a toast', await page.evaluate(() => !document.querySelector('.rf-toaster .rf-toast:not([data-leaving])')));
check('a short tour opens once the first workout is checked in', await page.evaluate(() => !!document.querySelector('dialog.tour-sheet[open]')));
await page.waitForTimeout(500);
await shot(page, '09b-tour');
const tourPages = [];
for (let k = 0; k < 5 && await page.locator('dialog.tour-sheet[open]').count(); k++) {
  const lit = await page.locator('dialog.tour-sheet .tour-tab.is-on').count();
  tourPages.push(`${await page.locator('dialog.tour-sheet .tour-copy h3').innerText()} (${lit})`);
  await page.click('dialog.tour-sheet [data-act="tourNext"]');
  await page.waitForTimeout(450);
}
check('three short cards, each with the tab bar and its tab lit', tourPages.length === 3 && tourPages.every((t) => / \(1\)$/.test(t)), tourPages);
check('and Let\'s go closes it, for good', await page.evaluate(() => !document.querySelector('dialog.tour-sheet[open]') && window.GH.ui.seen('tour')));

section('Health, Progress, Plan and its Moves');
await page.click('.rf-tab[data-tab="health"]');
await page.waitForSelector('#screen[data-view="health"] .hl-tr', { timeout: 5000 }).catch(async (e) => { console.log('errors so far:', errors); await shot(page, 'fail-health'); throw e; });
await page.waitForTimeout(300);
const healthText = await page.locator('#screen').innerText();
check('Health shows today\'s numbers from Health Connect', /Resting HR/.test(healthText) && /\d+ bpm/.test(healthText));
check('trend sparklines drew', (await page.locator('#screen .hl-tr .sp-svg').count()) >= 4);
await shot(page, '10-health');
await page.locator('#screen .hl-tr').first().click();
await page.waitForSelector('dialog.ms-sheet[open] .ch-plot');
await page.waitForTimeout(600);
await page.locator('dialog.ms-sheet .ch-plot').click();
check('a number opens its sheet; tapping its chart shows a value', /:/.test(await page.locator('dialog.ms-sheet .ch-tip').innerText()));
check('with every day listed', (await page.locator('dialog.ms-sheet .ms-hist li').count()) >= 7);
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(500);
check('a weekly report worked out on the phone', /This week/.test(healthText) && /From your numbers/.test(healthText));
check('sync status shows when it last synced', /Synced (just now|\d+ min ago)/.test(healthText));
check('food sits in Health: Track calories, one tap to start', /Track calories/.test(healthText) && await page.locator('#screen .hf-invite [data-act="foodStart"]').count() === 1 && await page.locator('.rf-tab[data-tab="food"]').count() === 0);
check('the coach button sits at the top left', await page.locator('#topbar .rf-navbar-leading .coach-btn').count() === 1);
await page.click('#topbar .coach-btn');
await page.waitForSelector('dialog.chat-sheet[open] .chat-pill');
await page.waitForTimeout(600);
check('the chat says who answers: the on-device coach', /On this phone/.test(await page.locator('dialog.chat-sheet .chat-pill').innerText()));
const grounding = await page.evaluate(() => window.GH.deviceCoach.facts(window.GH.ui.S, window.GH.ui.today(), 'How is my sleep?').join('\n'));
check('the on-device coach gets the app\'s own answer from the data', /What the app worked out: You averaged \d+ h/.test(grounding), grounding.slice(0, 160));
await shot(page, '10b-coach');
await page.click('dialog.chat-sheet [data-act="chatMenu"]');
await page.waitForSelector('dialog[open] [data-arg="askClaudeApp"]');
await page.waitForTimeout(400);
await page.click('dialog[open] [data-arg="askClaudeApp"]');
await page.waitForSelector('#handQ');
await page.fill('#handQ', 'How is my sleep?');
await page.click('[data-act="handOff"]');
await page.waitForTimeout(300);
const shared = await page.evaluate(() => window.__shared);
check('Ask in the Claude app hands the question and summary to the Claude app', shared && shared.target === 'claude' && /My question: How is my sleep\?/.test(shared.t) && /LAST 28 DAYS/.test(shared.t));
check('the hand-off has no dates in it', shared && !/\d{4}-\d{2}-\d{2}/.test(shared.t) && !/Sep 2\d/.test(shared.t));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await page.click('.rf-tab[data-tab="progress"]');
await page.waitForSelector('#screen[data-view="progress"] .hm');
check('Progress heat map and left vs right', (await page.locator('#screen .hm-work').count()) >= 1 && /Left vs right/.test(await page.locator('#screen').innerText()));
await shot(page, '11-progress');
await page.click('.rf-tab[data-tab="plan"]');
await page.waitForSelector('#screen[data-view="plan"] .plan-list');
check('Plan lists seven days', (await page.locator('#screen .plan-list').first().locator('li').count()) === 7);
await shot(page, '12-plan');
await page.click('#screen [data-on="planSection"] input[value="moves"]', { force: true });
await page.waitForSelector('#screen[data-view="plan"] .moves-list');
await page.locator('#screen [data-act="ladder"]').first().click();
await page.waitForSelector('dialog.rf-sheet .sheet-fig svg, dialog.rf-sheet .sheet-fig .fig3d canvas');
check('a ladder sheet shows an animated diagram', await page.locator('dialog.rf-sheet .sheet-fig svg, dialog.rf-sheet .sheet-fig .fig3d canvas').count() >= 1);
await shot(page, '13-ladder');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

section('You, How it works, Settings');
await page.click('.rf-tab[data-tab="you"]');
await page.waitForSelector('#screen[data-view="you"] .you-card');
await page.waitForTimeout(500);
const prof = await page.locator('#screen').innerText();
// The first badge: the badges' own tile when they're in, else the achievement from before them.
const firstBadge = (await page.locator('#screen [data-badge="first"].is-earned').count()) || (await page.locator('#screen [data-key="ach-first"].is-earned').count());
check('You shows your numbers and the first badge', /\b1\s+Workout\b/.test(prof) && firstBadge === 1, prof.slice(0, 160));
await shot(page, '14a-you');
await page.evaluate(() => window.GH.ui.open('science', 'rest'));
await page.waitForTimeout(900);
check('How it works lists every rule in its group', await page.evaluate(() => document.querySelectorAll('#screen .sci-list .sci-row').length === window.GH.science.RULES.length && document.querySelectorAll('#screen .sci-list').length === window.GH.science.GROUPS.length));
check('a "Why?" link opens that rule with its research', await page.evaluate(() => { const d = document.querySelector('dialog.sci-sheet[open]'); return !!(d && /Rest between sets/.test(d.textContent) && d.querySelector('.sci-ref') && d.querySelector('.sci-block')); }));
await shot(page, '14b-science');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(500);
await page.click('#screen [data-on="sciShow"] [data-arg="food"]');
await page.waitForTimeout(300);
check('the group chips narrow the list', await page.evaluate(() => document.querySelectorAll('#screen .sci-list').length === 1 && [...document.querySelectorAll('#screen .sci-row')].every((r) => window.GH.science.RULES.find((x) => x.id === r.dataset.arg).cat === 'food')));
await page.click('#screen [data-on="sciShow"] [data-arg="all"]');
await page.waitForTimeout(200);
await page.click('#topbar [data-act="back"]');
await page.waitForTimeout(400);
check('back returns to You', await page.evaluate(() => document.getElementById('screen').dataset.view === 'you'));
await page.click('#topbar [data-act="openSettings"]');
await page.waitForSelector('#screen[data-view="settings"]');
check('the tab bar steps aside on pushed pages', await page.evaluate(() => document.getElementById('tabbar').hasAttribute('data-away')));
await page.click('#screen [data-act="exportData"]');
await page.waitForTimeout(200);
const copied = await page.evaluate(() => window.__copied || '');
check('Copy my data copies a backup without any key', copied.includes('"app":"gradient-health"') && !/fakekey|TESTKEY/.test(copied));
await shot(page, '14-settings');

section('Persistence');
await page.reload();
await page.waitForSelector('#screen[data-view="today"]');
await page.waitForTimeout(300);
check('after a reload Today still shows the finished workout', await page.locator('#screen .session.done').count() === 1);
check('no What\'s new on a normal launch', await page.evaluate(() => !document.querySelector('dialog.rf-sheet[open]')));
// Someone updating from 1.0.0 sees What's new once.
await page.evaluate(() => { const S = window.GH.ui.S; S.seen.lastVersion = '1.0.0'; window.GH.store.save(S); });
await page.reload();
await page.waitForSelector('#screen[data-view="today"]');
await page.waitForTimeout(1200);
check('after an update, What\'s new shows once', await page.evaluate(() => /What's new in/.test((document.querySelector('dialog.rf-sheet[open] .rf-sheet-title') || {}).textContent || '')));
await shot(page, '15-whatsnew');

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 5));
if (!process.argv.includes('--keep')) await browser.close();
done();
