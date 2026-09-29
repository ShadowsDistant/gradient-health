// End-to-end smoke run of the built page in Chromium at phone size, with a fake Android bridge
// and a controlled clock: questionnaire → tour → Today → a workout with rest, a side switch, a
// timer and a swap → check-in → Next time → Health (coach, Claude hand-off) → Progress, Plan, Moves
// → Profile, How it works, Settings → reload (persistence, What's new). Screenshots go to build/smoke/.
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

const clickNext = async () => { await page.locator('.ob-actions [data-variant="tinted"]').click(); await page.waitForTimeout(150); };
const title = () => page.locator('.onboard .rf-large-title').innerText();

section('Questionnaire');
check('starts on the welcome screen', (await title()) === 'Gradient Health');
check('with the logo', await page.locator('.ob-welcome .ob-logo').count() === 1);
await shot(page, '00-welcome');
await clickNext();
check('then what to track', (await title()) === 'What to track');
check('workouts and health is picked by default', await page.locator('input[name="obTrack"][value="workouts"]').isChecked());
await clickNext();
check('then Health data', (await title()) === 'Health data');
await page.click('[data-act="obConnect"]');
await page.waitForSelector('.ob-status[data-tone="positive"]');
check('Health Connect connects and prefills', /Read .*weight/.test(await page.locator('.ob-status').innerText()), await page.locator('.ob-status').innerText());
await shot(page, '01-health');
await clickNext();
check('About you shows prefilled weight', (await title()) === 'About you' && (await page.locator('input[data-k="_w"]').inputValue()) !== '');
await page.fill('input[data-k="age"]', '19'); await page.locator('input[data-k="age"]').dispatchEvent('change');
await page.fill('input[data-k="_w"]', '148.8'); await page.locator('input[data-k="_w"]').dispatchEvent('change');
await clickNext();
for (const g of ['abs', 'arms', 'chest', 'legs', 'consistency']) { await page.click(`.rf-chip[data-v="${g}"]`); await page.waitForTimeout(60); }
check('goals are numbered in tap order', /1\. Visible abs/.test(await page.locator('.ob-chips').innerText()) && /5\. Consistency/.test(await page.locator('.ob-chips').innerText()));
await shot(page, '02-goals');
await clickNext(); // → experience
check('Experience screen', (await title()) === 'Experience');
await clickNext(); // → schedule
check('Schedule defaults to 4 days, 25 min', (await page.locator('#obDays').inputValue()) === '4' && /25 min/.test(await page.locator('#obMin').innerText()));
await clickNext(); // → equipment
await page.click('.rf-chip[data-list="equipment.db"][data-v="8"]');
await page.click('.rf-chip[data-list="equipment.kb"][data-v="10"]');
await page.locator('input[data-k="equipment.ball"]').check();
await page.waitForTimeout(100);
await shot(page, '03-equipment');
await clickNext(); // → body check
await page.click('.rf-segmented[aria-label="Stronger arm"] input[value="R"]', { force: true });
await clickNext(); // → food
await clickNext(); // → sleep
await clickNext(); // → style
await clickNext(); // → baseline
check('Baseline test screen', (await title()) === 'Baseline test');
for (const [k, v] of [['_base.pushups', '24'], ['_base.curlL', '14'], ['_base.curlR', '18']]) { await page.fill(`input[data-k="${k}"]`, v); await page.locator(`input[data-k="${k}"]`).dispatchEvent('change'); }
await clickNext();
check('abs note shows with the abs goal', (await title()) === 'About abs');
await clickNext();
check('Your plan summary', (await title()) === 'Your plan' && /4 days · ~25 min/.test(await page.locator('.onboard').innerText()));
check('plan: abs + arms 3×', /abs \+ arms 3×/.test(await page.locator('.onboard').innerText()), await page.locator('.onboard .ob-card').first().innerText());
await shot(page, '04-plan');
await clickNext(); // Start

section('First run');
await page.waitForSelector('#screen[data-view="today"] .session');
await page.waitForSelector('dialog.tour-sheet[open]', { timeout: 4000 }).catch(() => null);
check('a short tour opens after set-up', await page.evaluate(() => !!document.querySelector('dialog.tour-sheet[open]')));
await shot(page, '05a-tour');
await page.click('dialog.tour-sheet [data-act="tourNext"]');
await page.waitForTimeout(300);
check('the tour pages through (an animated diagram on page 2)', await page.evaluate(() => !!document.querySelector('dialog.tour-sheet .tour-fig svg, dialog.tour-sheet .tour-fig .fig3d canvas')));
await page.click('dialog.tour-sheet [data-act="tourSkip"]');
await page.waitForTimeout(600);
check('the page draws edge to edge with the shell\'s insets', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim() === '32px'));
check('status bar icons follow the page theme', await page.evaluate((d) => window.__bars === d, dark));

section('Today');
await page.waitForTimeout(400);
const todayText = await page.locator('#screen').innerText();
check('Today shows the session with a time estimate', /Workout · about \d+ min/.test(todayText));
check('the extra left curl set is on the list', /left only/.test(todayText));
check('Start workout floats in glass', await page.locator('#float [data-act="startWorkout"]').isVisible());
check('a getting-started checklist for the first week', /Getting started/.test(todayText) && /Finish your first workout/.test(todayText));
check('the profile button sits in the shared top bar', await page.locator('#topbar [data-act="openProfile"]').count() === 1);
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
    skipRest: !!q('[data-act="plSkipRest"]'),
  };
});
while (guard++ < 300) {
  const st = await state();
  if (st.checkin) break;
  if (st.side && lastSide && st.side !== lastSide && /Right|Left/.test(st.side)) sawSwitch = true;
  if (st.side) lastSide = st.side;
  if (st.rir && !st.rirChosen) {
    rirAsked = true;
    await page.click('.player .pl-rir input[value="12"]', { force: true });
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
    await page.click('.player [data-act="plMenu"]');
    await page.waitForSelector('dialog.rf-sheet [data-act="plSwap"]', { timeout: 3000 }).catch(() => null);
    if (await page.locator('dialog.rf-sheet [data-act="plSwap"]').count()) {
      await page.click('dialog.rf-sheet [data-act="plSwap"]');
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
await shot(page, '09-next');
await page.click('.player [data-act="plClose"]');
await page.waitForSelector('#screen .session.done');
check('Today shows the workout as done', /Done/.test(await page.locator('#screen .session.done').innerText()));
check('screen no longer kept awake', await page.evaluate(() => window.__awake === false));
const hx = await page.evaluate(() => window.__haptics);
check('haptics: start, finished sets and a finish', hx.includes('go') && hx.includes('done') && (hx.includes('celebrate') || hx.includes('success')), hx.slice(-12));
const writes = await page.evaluate(() => window.__writes);
check('the workout was saved to Health Connect once, keyed by day', writes.length === 1 && writes[0].id === 'gradient-2026-09-28' && writes[0].type === 'strength_training' && writes[0].end > writes[0].start, writes);

section('Health, Progress, Plan, Moves');
await page.click('.rf-tab[data-tab="health"]');
await page.waitForSelector('#screen[data-view="health"] .ch-card', { timeout: 5000 }).catch(async (e) => { console.log('errors so far:', errors); await shot(page, 'fail-health'); throw e; });
await page.waitForTimeout(300);
const healthText = await page.locator('#screen').innerText();
check('Health shows today\'s numbers from Health Connect', /Resting HR/.test(healthText) && /\d+ bpm/.test(healthText));
check('trend charts drew', (await page.locator('#screen .ch-svg').count()) >= 4);
await page.locator('#screen .ch-plot').first().click();
check('tapping a chart shows a value', /:/.test(await page.locator('#screen .ch-tip').first().innerText()));
await page.locator('#screen [data-act="chartTable"]').first().click();
check('Numbers table opens', await page.locator('#screen .ch-tbl').first().isVisible());
await shot(page, '10-health');
check('a weekly report worked out on the phone', /Weekly report/.test(healthText) && /From your numbers/.test(healthText));
check('sync status shows when it last synced', /Synced (just now|\d+ min ago)/.test(healthText));
await page.click('#screen [data-act="askCoach"]');
await page.waitForSelector('dialog.chat-sheet[open] .chat-engine');
await page.waitForTimeout(600);
check('the chat offers the on-device coach and Claude', await page.evaluate(() => [...document.querySelectorAll('dialog.chat-sheet [data-on="setChatEngine"] input')].map((i) => i.value).join() === 'device,api'));
const grounding = await page.evaluate(() => window.GH.deviceCoach.facts(window.GH.ui.S, window.GH.ui.today(), 'How is my sleep?').join('\n'));
check('the on-device coach gets the app\'s own answer from the data', /What the app worked out: You averaged \d+ h/.test(grounding), grounding.slice(0, 160));
await shot(page, '10b-coach');
await page.click('dialog.chat-sheet [data-act="askClaudeApp"]');
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
await page.click('.rf-tab[data-tab="moves"]');
await page.waitForSelector('#screen[data-view="moves"] .moves-list');
await page.locator('#screen [data-act="ladder"]').first().click();
await page.waitForSelector('dialog.rf-sheet .sheet-fig svg, dialog.rf-sheet .sheet-fig .fig3d canvas');
check('a ladder sheet shows an animated diagram', await page.locator('dialog.rf-sheet .sheet-fig svg, dialog.rf-sheet .sheet-fig .fig3d canvas').count() >= 1);
await shot(page, '13-ladder');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

section('Profile, How it works, Settings');
await page.click('.rf-tab[data-tab="today"]');
await page.click('#topbar [data-act="openProfile"]');
await page.waitForSelector('#screen[data-view="profile"] .ach-grid');
await page.waitForTimeout(500);
const prof = await page.locator('#screen').innerText();
check('Profile shows stats and the first achievement', /Workouts\s+1/.test(prof) && (await page.locator('#screen [data-key="ach-first"].is-earned').count()) === 1, prof.slice(0, 160));
check('the tab bar steps aside on pushed pages', await page.evaluate(() => document.getElementById('tabbar').hasAttribute('data-away')));
await shot(page, '14a-profile');
await page.evaluate(() => window.GH.ui.open('science', 'rest'));
await page.waitForTimeout(900);
check('How it works lists every rule in its group', await page.evaluate(() => document.querySelectorAll('#screen .sci-list .sci-row').length === window.GH.science.RULES.length && document.querySelectorAll('#screen .sci-list').length === 4));
check('a "Why?" link opens that rule with its research', await page.evaluate(() => { const d = document.querySelector('dialog.sci-sheet[open]'); return !!(d && /Rest between sets/.test(d.textContent) && d.querySelector('.sci-ref') && d.querySelector('.sci-block')); }));
await shot(page, '14b-science');
await page.evaluate(() => window.GH.ui.closeSheets());
await page.waitForTimeout(500);
await page.click('#screen [data-act="sciShow"][data-arg="food"]');
await page.waitForTimeout(300);
check('the group chips narrow the list', await page.evaluate(() => document.querySelectorAll('#screen .sci-list').length === 1 && [...document.querySelectorAll('#screen .sci-row')].every((r) => window.GH.science.RULES.find((x) => x.id === r.dataset.arg).cat === 'food')));
await page.click('#screen [data-act="sciShow"][data-arg="all"]');
await page.waitForTimeout(200);
await page.click('#topbar [data-act="back"]');
await page.waitForTimeout(400);
check('back returns to Profile', await page.evaluate(() => document.getElementById('screen').dataset.view === 'profile'));
await page.click('#topbar [data-act="openSettings"]');
await page.waitForSelector('#screen[data-view="settings"]');
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
