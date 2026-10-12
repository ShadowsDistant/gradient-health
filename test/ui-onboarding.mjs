// The set-up in Chromium at phone size. The first run: six screens with one decision each (welcome,
// what you want most, time, where you train, about you, the plan), today a workout day whatever the
// weekday and however many days, the plan from the engine with today's workout (its moves' 3D
// stills, never the flat figure first), the first workout
// started from it, Back (the button and Android Back) with answers kept, no Health Connect request
// before the plan, plain words (no dashes, optional fields marked), "Anything to plan around?" in a
// sheet and what it changes, Restore from a backup on the welcome, a friend's shared plan's three
// screens into that plan (no tour), and Just tracking food? with Health Connect as its optional last
// screen. Reminders on from the end of set-up: the last screen says so, Android asks once as it's
// tapped (not before), a no leaves them off with nothing asking again (Settings shows them off), an
// Android that allows them already asks nothing, a browser has none, and a restored backup keeps its
// own. Then Your answers: every detailed screen as before, one screen with Save; after the first
// workout, Health Connect offered and then the tour (once, not over a toast); and a flare day.
// No console errors. Screenshots go to build/ui-onboarding/.
// Usage: node test/ui-onboarding.mjs [--dark] [--width=390]
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const OUT = join(root, 'build/ui-onboarding');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];

const SUNDAY = '2026-10-04T08:00:00'; // a Sunday: in none of the usual spreads of days
// A fresh first run. bridge: 'app' (Health Connect there but not allowed yet; every permission
// request is counted in window.__hcAsks), 'unsupported' (the app on an older Android) or 'web'.
// notify: Android's side of notifications before the app starts (test/fixtures.mjs: Android 13
// asks, and the answer is yes unless notify.answer says otherwise).
async function fresh(bridge = 'app', time = SUNDAY, notify = null) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date(time) });
  if (notify) await page.addInitScript((n) => { window.__notify = n; }, notify);
  if (bridge !== 'web') await page.addInitScript(seedBridge);
  await page.addInitScript((kind) => {
    window.__hcAsks = 0;
    const t = setInterval(() => {
      const b = window.AndroidBridge;
      if (!b) return;
      clearInterval(t);
      if (kind === 'unsupported') { b.hcStatus = () => 'unsupported'; return; }
      b.hcStatus = () => window.__hc || 'denied';
      b.hcRequest = b.hcRequestFood = () => { window.__hcAsks++; window.__hc = 'granted'; setTimeout(() => window.__gh.onHealthPerms('granted'), 40); };
    }, 1);
  }, bridge);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden]) .rf-large-title');
  await page.waitForTimeout(300);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}${dark ? '-dark' : ''}.png`) });
const title = (page) => page.locator('.onboard .rf-large-title').first().innerText();
const text = (page) => page.locator('.onboard').innerText();
const settle = async (page, ms = 450) => { await page.clock.runFor(60); await page.waitForTimeout(ms); };
const next = async (page) => { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(page); };
const fill = async (page, k, v) => { const el = page.locator(`.onboard input[data-k="${k}"]`); await el.fill(String(v)); await el.dispatchEvent('change'); await page.waitForTimeout(80); };
const tap = async (page, sel, ms = 160) => { await page.click(sel); await page.waitForTimeout(ms); };
// Through "Building your plan" to the plan (it's worked out a beat after the screen shows).
async function toPlan(page) {
  await page.locator('.ob-actions [data-variant="tinted"]').click();
  await page.waitForTimeout(150);
  await page.clock.runFor(1400);
  await page.waitForSelector('.onboard .ob-reveal[data-ready]', { timeout: 8000 });
  await page.waitForTimeout(500);
}
const hint = (page) => page.locator('.ob-actions .ob-hint').innerText().catch(() => '');
const seen = [];
const dashes = (t) => /[–—]/.test(t);

section('The first run: six screens, one decision each');
{
  const { ctx, page } = await fresh('app');
  const words = [];
  const look = async () => { const t = await title(page); seen.push(t); words.push(await text(page)); return t; };
  check('it starts on the welcome', (await look()) === 'Gradient Health' && await page.locator('.ob-hello .ob-logo').count() === 1);
  check('with a way in, Restore from a backup and Just tracking food?', (await page.locator('.ob-actions [data-variant="tinted"]').innerText()).trim() === 'Get started' && await page.locator('.ob-actions [data-act="obRestore"]').count() === 1 && await page.locator('.ob-actions [data-act="obFood"]').count() === 1);
  check('no progress or Back on the welcome', await page.locator('.onboard .ob-top [data-act="obBack"]').count() === 0 && await page.locator('.onboard .ob-steps').count() === 0);
  await shot(page, '01-welcome');
  await next(page);

  check('What do you want most?, 1 of 5', (await look()) === 'What do you want most?' && /1 of 5/.test(await page.locator('.ob-count').innerText()));
  check('six goals to pick from, none picked yet', await page.locator('.onboard .ob-opt[aria-pressed]').count() === 6 && await page.locator('.onboard .ob-opt[aria-pressed="true"]').count() === 0);
  await tap(page, '.ob-opt[data-arg="muscle"]', 400);
  check('Build muscle opens its body areas, all over to start', await page.locator('.onboard .ob-areas .rf-chip').count() === 7 && await page.locator('.onboard .ob-areas [data-v="all"][aria-pressed="true"]').count() === 1);
  await tap(page, '.ob-areas [data-v="legs"]', 250);
  await tap(page, '.ob-areas [data-v="arms"]', 250);
  check('picking areas leaves all over', await page.locator('.onboard .ob-areas [data-v="all"][aria-pressed="true"]').count() === 0);
  check('a line says how the plan leans', /leans on legs and arms/.test(await hint(page)), await hint(page));
  await tap(page, '.ob-opt[data-arg="fat"]', 300);
  await tap(page, '.ob-opt[data-arg="strength"]', 300);
  check('picks are numbered in tap order', (await page.locator('.ob-opt[data-arg="muscle"] .ob-mark-n').innerText()).trim() === '1' && (await page.locator('.ob-opt[data-arg="fat"] .ob-mark-n').innerText()).trim() === '2' && (await page.locator('.ob-opt[data-arg="strength"] .ob-mark-n').innerText()).trim() === '3');
  await tap(page, '.ob-opt[data-arg="mobility"]', 300);
  check('a fourth is refused, with a word why', await page.locator('.onboard .ob-opt[aria-pressed="true"]').count() === 3 && /Up to 3/.test(await hint(page)));
  await shot(page, '02-want');
  await next(page);

  check('How much time do you have?, 2 of 5', (await look()) === 'How much time do you have?' && /2 of 5/.test(await page.locator('.ob-count').innerText()));
  check('three 30-minute workouts to start', await page.locator('.onboard input[name="obDaysN"][value="3"]').isChecked() && await page.locator('.onboard input[name="obMins"][value="30"]').isChecked());
  check('today (a Sunday) is a workout day', await page.locator('.onboard .ob-wd.is-today.is-on').count() === 1 && /first workout is today/.test(await hint(page)), await hint(page));
  const sundays = [];
  for (const d of [2, 3, 4, 5, 6]) {
    await page.click(`.onboard input[name="obDaysN"][value="${d}"]`, { force: true });
    await settle(page, 200);
    sundays.push(await page.locator('.onboard .ob-wd.is-on').count() === d && await page.locator('.onboard .ob-wd.is-today.is-on').count() === 1);
  }
  check('with 2 to 6 days, today is always one of them', sundays.every(Boolean), sundays);
  await page.click('.onboard input[name="obDaysN"][value="3"]', { force: true }); await settle(page, 200);
  await tap(page, '.ob-wd[data-arg="2"]', 300);
  check('tapping a day picks your own days', await page.locator('.onboard input[name="obDaysN"][value="4"]').isChecked() && await page.locator('.onboard [data-act="obDaysAuto"]').count() === 1);
  await tap(page, '[data-act="obDaysAuto"]', 300);
  check('Let the app pick goes back to the usual days from today', await page.locator('.onboard .ob-wd.is-today.is-on').count() === 1 && await page.locator('.onboard [data-act="obDaysAuto"]').count() === 0);
  await page.click('.onboard input[name="obDaysN"][value="3"]', { force: true }); await settle(page, 200);
  await shot(page, '03-time');
  await next(page);

  check('Where do you train?, 3 of 5', (await look()) === 'Where do you train?' && /3 of 5/.test(await page.locator('.ob-count').innerText()));
  check('home with just your body to start', await page.locator('.onboard .ob-tile[data-arg="home"][aria-checked="true"]').count() === 1 && await page.locator('.onboard .ob-kit [data-v="none"][aria-pressed="true"]').count() === 1);
  await tap(page, '.ob-kit [data-v="db"]', 300);
  check('dumbbells come with a common set of weights, folded away', /Dumbbells: 10, 15, 20 lb/.test(await page.locator('.onboard details[data-more="weights"] summary').innerText()) && !(await page.locator('.onboard details[data-more="weights"]').evaluate((d) => d.open)));
  await tap(page, '.ob-tile[data-arg="gym"]', 300);
  check('a gym starts as a full gym, with Adjust for the details', await page.locator('.onboard .ob-opt[data-arg="full"][aria-checked="true"]').count() === 1 && await page.locator('.onboard details[data-more="gym"]').count() === 1);
  await tap(page, '.ob-tile[data-arg="home"]', 300);
  await shot(page, '04-where');
  await next(page);

  check('A little about you, 4 of 5', (await look()) === 'A little about you' && /4 of 5/.test(await page.locator('.ob-count').innerText()));
  check('optional fields say so', /Age \(optional\)/.test(await text(page)) && /Weight and height \(optional\)/.test(await text(page)));
  check('new or coming back to start', await page.locator('.onboard .ob-opt[data-arg="onoff"][aria-checked="true"]').count() === 1);
  await fill(page, 'age', 150);
  await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(page, 300);
  const err = await page.locator('.onboard .rf-field[data-invalid] .rf-field-error').first().innerText().catch(() => '');
  check('an age of 150 stays here with a helpful message', (await title(page)) === 'A little about you' && /age from 13 to 100/.test(err) && await page.locator('.onboard input[data-k="age"][aria-invalid="true"]').count() === 1, err);
  await fill(page, 'age', 34);
  check('fixing it clears the message', await page.locator('.onboard .rf-field-error').count() === 0);
  await tap(page, '.ob-opt[data-arg="1to3"]', 250);
  await page.evaluate(() => { document.querySelector('.onboard details[data-more="size"]').open = true; });
  await page.waitForTimeout(250);
  await fill(page, '_w', 165);
  await fill(page, '_hft', 5); await fill(page, '_hin', 9);
  await page.click('.onboard .rf-segmented[aria-label="Units"] input[value="kg"]', { force: true }); await settle(page, 250);
  check('switching to kg converts weight and height', (await page.locator('.onboard input[data-k="_w"]').inputValue()) === '74.8' && (await page.locator('.onboard input[data-k="_hcm"]').inputValue()) === '175');
  check('the open disclosure stays open', await page.locator('.onboard details[data-more="size"]').evaluate((d) => d.open));
  await page.locator('.onboard input[data-k="age"]').focus();
  await page.keyboard.press('Enter');
  check('Enter moves to the next field', await page.evaluate(() => document.activeElement && document.activeElement.dataset.k === '_w'));
  await page.click('.onboard .rf-segmented[aria-label="Units"] input[value="lb"]', { force: true }); await settle(page, 250);
  await tap(page, '[data-act="obAround"]', 100);
  await page.clock.runFor(400); await page.waitForTimeout(600);
  check('Anything to plan around? opens in a sheet', await page.locator('dialog.ob-around-sheet[open]').count() === 1);
  await tap(page, 'dialog[open] .rf-chip[data-list="_pain"][data-v="knee"]', 250);
  await tap(page, 'dialog[open] .rf-chip[data-list="careful"][data-v="shoulder"]', 250);
  await shot(page, '05-around');
  await page.click('dialog[open] [data-act="obAroundDone"]');
  await page.clock.runFor(500); await page.waitForTimeout(600);
  check('its row says what\'s planned around', /Sore knees/.test(await page.locator('.onboard [data-act="obAround"]').innerText()) && /careful with shoulders/.test(await page.locator('.onboard [data-act="obAround"]').innerText()));
  check('no Health Connect request so far', await page.evaluate(() => window.__hcAsks) === 0);
  await shot(page, '06-you');

  await page.locator('.ob-actions [data-variant="tinted"]').click();
  await page.waitForTimeout(150);
  check('Building your plan, for a moment', await page.locator('.onboard .ob-build[role="status"]').count() === 1 && /Building your plan/.test(await text(page)));
  await page.clock.runFor(1400);
  await page.waitForSelector('.onboard .ob-reveal[data-ready]', { timeout: 8000 });
  await page.waitForTimeout(600);
  check('then Your plan, 5 of 5', (await look()) === 'Your plan' && /5 of 5/.test(await page.locator('.ob-count').innerText()));
  const plan = await page.evaluate(() => {
    const r = document.querySelector('.onboard .ob-reveal');
    return {
      head: r.querySelector('.rv-head').textContent, days: r.querySelectorAll('.rv-day').length, todayWork: !!r.querySelector('.rv-day.is-today.is-work'), first: (r.querySelector('.rv-day') || {}).classList.contains('is-today'),
      tag: r.querySelector('.rv-first .rv-tag').textContent.trim(), moves: r.querySelectorAll('.rv-first .rv-move').length, thumbs: r.querySelectorAll('.rv-first .ob-thumb > svg, .rv-first .ob-thumb > img').length,
      n: Number((r.querySelector('.rv-n') || { textContent: '0' }).textContent.replace(/\D/g, '')), reasons: r.querySelectorAll('.rv-reasons li').length, why: r.querySelector('.rv-why').textContent,
      around: !!r.querySelector('.rv-around'), title: r.querySelector('.rv-first-title').textContent,
    };
  });
  check('three 30-minute workouts a week', /3 workouts a week, 30 minutes each/.test(plan.head), plan.head);
  check('the next seven days, today first and a workout day', plan.days === 7 && plan.first && plan.todayWork, plan);
  check('today\'s workout with its moves', plan.tag === 'Today' && plan.moves >= 2, plan);
  // Their pictures: with the 3D figure (the default), each move's 3D still, drawn once the figure
  // set-up started warming up is ready, fading into the tile's own background; never the flat figure
  // first. (WebGL is software here, so it takes a while.)
  const pics = () => page.evaluate(() => { const t = [...document.querySelectorAll('.onboard .rv-first .ob-thumb[data-move]')]; return { n: t.length, img: t.filter((h) => h.querySelector(':scope > img')).length, flat: t.filter((h) => h.querySelector(':scope > svg')).length }; });
  let pic = await pics();
  const flatFirst = pic.flat;
  for (let i = 0; i < 40 && pic.img < pic.n; i++) { await page.clock.runFor(1500); await page.waitForTimeout(400); pic = await pics(); }
  check('and their pictures: the 3D figure\'s stills, never the flat figure first', pic.n >= 2 && pic.img === pic.n && !pic.flat && !flatFirst, { first: flatFirst, ...pic });
  check('why this plan: the weekly plans compared and two or three reasons', plan.n > 100 && plan.reasons >= 2 && plan.reasons <= 3 && /weekly plans compared/.test(plan.why), plan);
  check('in words that read well ("12 sets for arms", "minutes of sets")', !/\b(?:[a-z]+ \d+ and [a-z]+ \d+ sets|about \d+ of sets)\b/.test(plan.why) && (!/most work/.test(plan.why) || /\d+ sets for /.test(plan.why)), plan.why);
  check('nothing "built around you" for an age and a sore knee that change nothing there', !plan.around);
  check('Start my first workout, or Look around first', (await page.locator('.ob-actions [data-variant="tinted"]').innerText()).trim() === 'Start my first workout' && await page.locator('.ob-actions [data-act="obLook"]').count() === 1);
  check('over them, reminders come on: workout days and a walk now and then, one a day at most', /^A reminder on workout days, and a walk now and then\. One a day at most, never at night\.$/.test((await hint(page)).trim()), await hint(page));
  check('nothing asked of Android about notifications yet', await page.evaluate(() => window.__notify.asked) === 0);
  check('six screens from the welcome to the plan', seen.join(' > ') === ['Gradient Health', 'What do you want most?', 'How much time do you have?', 'Where do you train?', 'A little about you', 'Your plan'].join(' > '), seen.join(' > '));
  check('still no Health Connect request', await page.evaluate(() => window.__hcAsks) === 0);
  words.push(await text(page));
  check('plain words: no dashes on any screen', !words.some(dashes), words.find(dashes));
  await shot(page, '07-plan');

  section('Back');
  await page.click('.onboard [data-act="obBack"]'); await settle(page);
  check('the Back button goes to the screen before, answers kept', (await title(page)) === 'A little about you' && (await page.locator('.onboard input[data-k="age"]').inputValue()) === '34' && await page.locator('.onboard .ob-opt[data-arg="1to3"][aria-checked="true"]').count() === 1);
  await page.evaluate(() => window.__gh.back()); await settle(page);
  check('Android Back does the same', (await title(page)) === 'Where do you train?' && await page.locator('.onboard .ob-kit [data-v="db"][aria-pressed="true"]').count() === 1);
  await next(page);
  await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(page, 300);
  check('the same answers show the plan again at once', await page.locator('.onboard .ob-reveal[data-ready]').count() === 1 && await page.locator('.onboard .ob-build').count() === 0);

  section('The first workout, from the plan');
  const firstTitle = plan.title;
  await page.locator('.ob-actions [data-variant="tinted"]').click();
  await page.waitForSelector('.player:not([hidden]) .pl-name', { timeout: 5000 });
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => {
    const U = window.GH.ui, S = U.S, p = S.profile;
    return { onboarded: p.onboarded, active: !!S.active, day: S.active && S.active.day, today: U.today(), title: S.active && S.active.session.title, goals: p.goals.join(), days: p.days, minutes: p.minutes, weekdays: p.weekdays, where: p.where, db: p.equipment.db.join(), pain: Object.keys(S.pain).join(), careful: p.careful.join(), age: p.age, exp: p.experience, recent: p.recentActivity, kg: Math.round(p.weightKg * 10) / 10, setupHidden: document.getElementById('onboard').hidden, tour: !!document.querySelector('dialog.tour-sheet[open]') };
  });
  check('Start my first workout opens the player on today\'s workout', st.active && st.day === st.today && st.title === firstTitle, st);
  check('with set-up done and gone', st.onboarded && st.setupHidden, st);
  check('the answers saved as the plan reads them', st.goals === 'legs,arms,fat,strength' && st.days === 3 && st.minutes === 30 && st.where === 'home' && st.db === '10,15,20' && st.pain === 'knee' && st.careful === 'shoulder' && st.age === 34 && st.exp === '1to3' && st.recent === 'some' && st.kg === 74.8, st);
  check('the usual three days, started today: Sunday, Tuesday, Thursday', JSON.stringify(st.weekdays) === '[1,3,6]', st.weekdays);
  check('no tour before the first workout', !st.tour);
  check('and never a Health Connect request', await page.evaluate(() => window.__hcAsks) === 0);
  await shot(page, '08-first-workout');

  section('Reminders, on from the end of set-up');
  const nf = await page.evaluate(() => ({ asked: window.__notify.asked, on: window.GH.ui.S.profile.prefs.notify.on, kinds: ['workout', 'move', 'badge', 'sleep', 'comeback'].every((k) => window.GH.ui.S.profile.prefs.notify[k] === true), time: window.GH.ui.S.profile.prefs.notify.time, answered: window.GH.ui.S.seen.notifyAsk }));
  check('Start my first workout: Android asked about notifications, once, and said yes', nf.asked === 1, nf);
  check('so reminders are on, every kind, at the time worked out', nf.on === true && nf.kinds && nf.time === null, nf);
  check('and Today\'s card that asks is answered: it won\'t come', nf.answered === true, nf);
  let sched = null;
  for (let i = 0; i < 20 && !sched; i++) { await page.clock.runFor(300); await page.waitForTimeout(150); sched = await page.evaluate(() => window.__notify.schedules.filter((x) => x.on).pop() || null); }
  check('Android has the first schedule', sched && sched.items.length >= 3, sched && sched.items.map((x) => x.id));
  check('nothing about notifications was said in a toast', !/[Nn]otifications/.test(await page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '))));
  await ctx.close();
}

section('Reminders: a no at the end of set-up leaves them off, and nothing asks again');
{
  const { ctx, page } = await fresh('app', SUNDAY, { answer: 'denied' });
  for (let i = 0; i < 4; i++) await next(page);
  await toPlan(page);
  check('the plan says reminders come on', /A reminder on workout days/.test(await hint(page)), await hint(page));
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 5000 });
  await page.clock.runFor(1500); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ asked: window.__notify.asked, on: window.GH.ui.S.profile.prefs.notify.on, answered: window.GH.ui.S.seen.notifyAsk, toasts: [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '), scheduled: window.__notify.schedules.some((x) => x.on) }));
  check('Look around first: Android asked once, and they said no', r.asked === 1, r);
  check('reminders stay off, with nothing handed to Android', r.on === false && !r.scheduled, r);
  check('and nothing nags: no toast about it', !/[Nn]otifications/.test(r.toasts), r.toasts);
  // Later, with a workout done and the tour seen: Today's card still doesn't ask.
  const card = await page.evaluate(() => { const GH = window.GH, U = GH.ui, B = GH.brain, S = U.S; B.startWorkout(S, U.today(), { now: Date.now() - 26 * 60000 }); for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); } B.finishWorkout(S, { rating: 'right', now: Date.now() }); S.seen.tour = true; U.save(true); return U.notifyCard(S, U.today()); });
  check('after the first workout and the tour, Today\'s card doesn\'t ask either', card === '', card);
  await page.evaluate(() => { window.GH.ui.open('settings'); });
  await page.clock.runFor(900); await page.waitForTimeout(700);
  const set = await page.evaluate(() => { const i = document.querySelector('#screen [data-on="notifyOn"]'); return { sw: i && i.checked, rows: document.querySelectorAll('#screen ul[data-group="notify"] > *').length, perm: !!document.querySelector('#screen [data-key="nf-perm"]') }; });
  check('Settings shows them off, as for anyone who has them off', set.sw === false && set.rows === 1 && !set.perm, set);
  check('still asked once', await page.evaluate(() => window.__notify.asked) === 1);
  await ctx.close();
}

section('Reminders: Android already allows them');
{
  const { ctx, page } = await fresh('app', SUNDAY, { permission: 'granted' });
  for (let i = 0; i < 4; i++) await next(page);
  await toPlan(page);
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 5000 });
  await page.clock.runFor(1500); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ asked: window.__notify.asked, on: window.GH.ui.S.profile.prefs.notify.on }));
  check('older Androids (or one that allowed them before): nothing to ask, and they\'re on', r.asked === 0 && r.on === true, r);
  await ctx.close();
}

section('Today is a workout day, every weekday');
{
  const { ctx, page } = await fresh('web', '2026-09-28T08:00:00');
  await next(page); await next(page);
  check('on the time screen', (await title(page)) === 'How much time do you have?');
  const bad = [];
  for (let k = 0; k < 7; k++) {
    await page.clock.setSystemTime(new Date(2026, 8, 28 + k, 8, 0, 0)); // Monday 28 September to Sunday 4 October
    for (const d of [2, 3, 4, 5, 6]) {
      await page.click(`.onboard input[name="obDaysN"][value="${d}"]`, { force: true });
      await page.clock.runFor(60);
      // The strip redraws a frame after the change: wait for it rather than for a fixed time.
      const ok = await page.waitForFunction((n) => document.querySelectorAll('.onboard .ob-wd.is-on').length === n && document.querySelectorAll('.onboard .ob-wd.is-today.is-on').length === 1, d, { timeout: 3000 }).then(() => true, () => false);
      if (!ok) bad.push(`weekday ${k}, ${d} days`);
    }
  }
  check('Monday to Sunday, 2 to 6 days: today is always on', !bad.length, bad.join(', '));
  // Monday is in every usual spread: those days are kept as they are (nothing stored).
  await page.clock.setSystemTime(new Date('2026-09-28T09:00:00'));
  await page.click('.onboard input[name="obDaysN"][value="3"]', { force: true }); await settle(page, 200);
  await next(page); await next(page);
  await toPlan(page);
  check('in a browser, the plan says nothing about reminders (there\'s nothing to post them with)', !(await hint(page)));
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 5000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => { const U = window.GH.ui, S = U.S; return { weekdays: S.profile.weekdays, plan: window.GH.brain.todayPlan(S, U.today()).type, tour: !!document.querySelector('dialog.tour-sheet[open]'), start: !!document.querySelector('#float [data-act="startWorkout"]') }; });
  check('Look around first: Today, with today\'s workout to start', m.plan === 'workout' && m.start, m);
  check('and notifications left off', await page.evaluate(() => window.GH.ui.S.profile.prefs.notify.on) === false);
  check('a Monday start keeps the usual days (none stored)', m.weekdays === null, m.weekdays);
  check('and no tour yet', !m.tour);
  await ctx.close();
}

section('Ask the coach to check it, when there\'s a coach');
{
  const { ctx, page } = await fresh('web');
  // As if an on-device model or Claude were ready (src/planreview.js says, as the plan is built).
  await page.evaluate(() => { window.GH.planReview.available = () => true; });
  for (let i = 0; i < 4; i++) await next(page);
  await toPlan(page);
  check('the plan offers the coach\'s review', await page.locator('.onboard [data-act="obReview"]').count() === 1);
  await page.click('.onboard [data-act="obReview"]');
  await page.clock.runFor(900); await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ sheet: !!document.querySelector('dialog.rv-sheet[open]'), onboard: document.getElementById('onboard').hidden, view: document.getElementById('screen').dataset.view, saved: !!(window.GH.ui.S && window.GH.ui.S.profile.onboarded) }));
  check('it saves the answers and opens the Coach\'s review over Today', r.sheet && r.onboard && r.view === 'today' && r.saved, r);
  await ctx.close();
}

section('Restore from a backup, on the welcome');
{
  const { ctx, page } = await fresh('app');
  const backup = await page.evaluate(() => { const B = window.GH.brain; const day = B.dayOf(Date.now(), 4); const S = B.newState({ goals: ['legs'], name: 'Rae', days: 4 }, null, day - 20); S.seen = { tour: true, lastVersion: window.GH.VERSION }; return window.GH.store.exportJson(S); });
  await page.click('.ob-actions [data-act="obRestore"]');
  await page.clock.runFor(400); await page.waitForTimeout(700);
  check('it opens the restore sheet', await page.locator('dialog[open] #restoreTxt').count() === 1);
  await page.keyboard.press('Escape'); await page.clock.runFor(500); await page.waitForTimeout(600);
  check('closing it leaves the welcome as it was', !(await page.locator('.onboard').isHidden()) && (await title(page)) === 'Gradient Health');
  await page.click('.ob-actions [data-act="obRestore"]');
  await page.clock.runFor(400); await page.waitForTimeout(700);
  await page.fill('dialog[open] #restoreTxt', backup);
  await page.click('dialog[open] [data-act="restoreCheck"]');
  await page.waitForSelector('dialog.rf-dialog[open]', { timeout: 4000 });
  await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((x) => /Replace/.test(x.textContent)).click(); });
  await page.clock.runFor(600); await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ name: window.GH.ui.S && window.GH.ui.S.profile.name, view: document.getElementById('screen').dataset.view, hidden: document.getElementById('onboard').hidden, empty: !document.getElementById('onboard').firstElementChild }));
  check('restoring it opens the app with the backup, set-up gone', r.name === 'Rae' && r.view === 'today' && r.hidden && r.empty, r);
  const nf = await page.evaluate(() => ({ on: window.GH.ui.S.profile.prefs.notify.on, asked: window.__notify.asked }));
  check('someone set up before keeps their notifications as they were (off), and nothing is asked', nf.on === false && nf.asked === 0, nf);
  await shot(page, '09-restored');
  await ctx.close();
}

section('A friend\'s plan: three screens into it');
{
  const { ctx, page } = await fresh('app');
  const link = await page.evaluate(async () => { const C = window.GH.customPlan; const plan = C.normalize({ name: 'Upper and lower', days: [{ title: 'Upper', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'row_db', sets: 3, reps: 12 }, { move: 'curl_std', sets: 2, reps: 12 }] }, { title: 'Lower', items: [{ move: 'sq_goblet', sets: 3, reps: 12 }, { move: 'hg_rdl', sets: 3, reps: 10 }] }] }).plan; return C.link(await C.encode(plan, { from: 'Alex' })); });
  await page.evaluate((l) => window.__gh.onLink(l), link);
  await page.waitForSelector('.onboard .ob-shared', { timeout: 4000 });
  await page.waitForTimeout(500);
  check('the welcome offers the plan, with who sent it', /Alex sent you a plan/.test(await page.locator('.onboard .ob-shared').innerText()) && /Upper and lower/.test(await page.locator('.onboard .ob-shared').innerText()));
  check('Start with Alex\'s plan leads, Make my own plan below', (await page.locator('.ob-actions [data-variant="tinted"]').innerText()).trim() === 'Start with Alex\'s plan' && await page.locator('.ob-actions [data-act="obStart"]').count() === 1);
  await shot(page, '10-friend-welcome');
  await next(page);
  check('what you want, filled in from the plan', (await title(page)) === 'What do you want most?' && /1 of 3/.test(await page.locator('.ob-count').innerText()) && await page.locator('.onboard .ob-opt[data-arg="muscle"][aria-pressed="true"]').count() === 1);
  await next(page);
  check('then where you train, with what gets swapped for you', (await title(page)) === 'Where do you train?' && /swapped|works with what you have/.test(await hint(page)), await hint(page));
  await next(page);
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => ({ title: document.querySelector('.onboard .rf-large-title').textContent, from: (document.querySelector('.onboard .rv-from') || {}).textContent, moves: document.querySelectorAll('.onboard .rv-first .rv-move').length, btn: document.querySelector('.ob-actions [data-variant="tinted"]').textContent.trim() }));
  check('then the plan as you\'d do it, and Start with Alex\'s plan', f.title === 'Upper and lower' && /Alex/.test(f.from) && f.moves === 3 && f.btn === 'Start with Alex\'s plan', f);
  check('saying reminders come on', /A reminder on workout days/.test(await hint(page)), await hint(page));
  await shot(page, '11-friend-plan');
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"]', { timeout: 5000 });
  await page.clock.runFor(2500); await page.waitForTimeout(900);
  const u = await page.evaluate(() => { const GH = window.GH, U = GH.ui, C = GH.customPlan, S = U.S; const id = C.activeId(S); return { plan: id && C.get(S, id).name, from: id && C.get(S, id).from, tour: !!(S.seen && S.seen.tour), sheets: [...document.querySelectorAll('dialog[open] .rf-sheet-title')].map((e) => e.textContent), asks: window.__hcAsks }; });
  check('it\'s saved and in use, from Alex', u.plan === 'Upper and lower' && u.from === 'Alex', u);
  check('the tour is skipped, and the plan doesn\'t open again', u.tour && !u.sheets.length, u);
  check('no Health Connect request', u.asks === 0);
  check('reminders on, Android asked once', await page.evaluate(() => window.GH.ui.S.profile.prefs.notify.on === true && window.__notify.asked === 1));
  await ctx.close();
}

section('Just tracking food?');
{
  const { ctx, page } = await fresh('app');
  await page.click('.ob-actions [data-act="obFood"]'); await settle(page);
  check('A little about you, for the targets', (await title(page)) === 'A little about you' && /calorie and protein targets/.test(await text(page)) && /1 of 4/.test(await page.locator('.ob-count').innerText()));
  await fill(page, '_w', 180); await fill(page, 'age', 30);
  await next(page);
  check('then the goal', (await title(page)) === 'What\'s your goal?');
  await tap(page, '.ob-opt[data-arg="lose"]', 300);
  check('protein in grams a day, the pace in pounds a week', /\b145 g\b/.test(await text(page)) && /About that much a day/.test(await text(page)) && /0\.9 lb/.test(await text(page)), await text(page));
  await next(page); await page.waitForTimeout(300);
  check('then the daily targets', (await title(page)) === 'Your daily targets' && await page.locator('.onboard .ft-big .ft-n').count() === 1 && /steps a day/.test(await text(page)));
  check('no Health Connect request before them', await page.evaluate(() => window.__hcAsks) === 0);
  await next(page);
  check('Health Connect last, optional', (await title(page)) === 'Fill in the rest for you?' && /Optional/.test(await text(page)) && await page.locator('.ob-actions [data-act="obLook"]').innerText() === 'Not now');
  await shot(page, '12-food-health');
  await page.locator('.ob-actions [data-variant="tinted"]').click();
  await page.clock.runFor(300); await page.waitForTimeout(500);
  check('Connect asks Health Connect, once', await page.evaluate(() => window.__hcAsks) === 1);
  await page.waitForSelector('.ob-actions [data-act="obLook"][data-variant="tinted"]', { timeout: 4000 });
  check('then Start tracking, saying a nudge comes now and then', /^A nudge now and then\. One a day at most, never at night\.$/.test((await hint(page)).trim()), await hint(page));
  check('and nothing asked about notifications yet', await page.evaluate(() => window.__notify.asked) === 0);
  await page.click('.ob-actions [data-variant="tinted"]');
  await page.waitForSelector('#screen[data-view="today"]', { timeout: 5000 });
  await page.waitForTimeout(700);
  const t = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('#tabbar .rf-tab')].map((x) => x.dataset.tab).join(','), session: !!document.querySelector('#screen .session'), card: !!document.querySelector('#screen .fd-card'), mode: window.GH.food.mode(window.GH.ui.S), goal: window.GH.ui.S.profile.weightGoal, notify: window.GH.ui.S.profile.prefs.notify.on, asked: window.__notify.asked }));
  check('the app opens on Today with Today, Health and You (food is in Health), no workout, the food card', t.tabs === 'today,health,you' && !t.session && t.card && t.mode === 'full' && t.goal === 'lose', t);
  check('with notifications on, Android asked once', t.notify === true && t.asked === 1, t);
  await ctx.close();
}
for (const bridge of ['unsupported', 'web']) {
  const { ctx, page } = await fresh(bridge);
  await page.click('.ob-actions [data-act="obFood"]'); await settle(page);
  await next(page); await next(page);
  check(`no Health Connect screen ${bridge === 'web' ? 'in a browser' : 'where it\'s unsupported'}: the targets end it`, (await title(page)) === 'Your daily targets' && /Start tracking/.test(await page.locator('.ob-actions [data-variant="tinted"]').innerText()) && /3 of 3/.test(await page.locator('.ob-count').innerText()));
  await ctx.close();
}

section('Planned around: the sheet and what it changes');
{
  const { ctx, page } = await fresh('web');
  await next(page); await next(page); await next(page); await next(page);
  await fill(page, 'age', 72);
  check('the age says what changes from 65', /From 65: balance practice every session/.test(await text(page)));
  await tap(page, '[data-act="obAround"]', 100); await page.clock.runFor(400); await page.waitForTimeout(600);
  check('from 60, it asks about getting down to the floor', await page.locator('dialog[open] .rf-segmented[aria-label="Getting down to the floor"]').count() === 1);
  check('pregnancy is explained, not offered', /Pregnant\? This plan isn't built for pregnancy/.test(await page.locator('dialog[open]').innerText()) && await page.locator('dialog[open] [data-list="conditions"][data-v="pregnancy"]').count() === 0);
  await tap(page, 'dialog[open] .rf-chip[data-list="conditions"][data-v="balance"]', 300);
  const around = await page.locator('dialog[open] .ob-around').innerText().catch(() => '');
  check('picking one shows what the plan does about it', /Planned around age 72 and balance/.test(around) && /hand on the wall/.test(around), around);
  await tap(page, 'dialog[open] .rf-chip[data-list="conditions"][data-v="heart"]', 300);
  check('a heart condition says to check with your doctor first', /Check with your doctor before you start/.test(await page.locator('dialog[open] .ob-status[data-tone="caution"]').innerText().catch(() => '')));
  await tap(page, 'dialog[open] .rf-chip[data-list="conditions"][data-v="oa"]', 300);
  check('osteoarthritis asks which joints', await page.locator('dialog[open] .rf-chip[data-list="oaJoints"]').count() === 5);
  await shot(page, '13-around-sheet');
  await tap(page, 'dialog[open] .rf-chip[data-list="conditions"][data-v="heart"]', 250);
  await tap(page, 'dialog[open] .rf-chip[data-list="conditions"][data-v="oa"]', 250);
  await page.click('dialog[open] [data-act="obAroundDone"]'); await page.clock.runFor(500); await page.waitForTimeout(600);
  await toPlan(page);
  const r = await page.locator('.onboard .ob-reveal').innerText();
  check('the plan says what it\'s built around', /Built around you/i.test(r) && /Planned around age 72 and balance/.test(r) && /From 65/.test(r), r.slice(0, 400));
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"]');
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => { const S = window.GH.ui.S; return { c: S.profile.conditions, since: S.profile.conditionsSince, age: S.profile.age }; });
  check('finishing saves them', p.c.join() === 'balance' && p.since && p.since.balance != null && p.age === 72, p);
  check('Today says what the plan is built around', /Planned around age 72 and balance/.test(await page.locator('#screen').innerText()));

  section('Your answers: every detailed screen, as before');
  check('the same screens to edit one at a time', await page.evaluate(() => window.GH.ui.editableSteps().map((s) => s.id).join()) === 'about,conditions,goals,experience,schedule,equipment,body,nutrition');
  await page.evaluate(() => { const U = window.GH.ui; window.GH.brain.addWeight(U.S, U.today(), 70, 'manual'); U.editAnswers(); });
  await page.waitForTimeout(400);
  check('opens on About you with Close, not Back', (await title(page)) === 'About you' && await page.locator('.onboard .ob-top [aria-label="Close"]').count() === 1);
  check('the weight shown is your latest one (70 kg = 154.3 lb)', (await page.locator('.onboard input[data-k="_w"]').inputValue()) === '154.3');
  const edits = [];
  for (let i = 0; i < 12; i++) { const t = await title(page); edits.push(t); if (t === 'Your plan') break; await next(page); }
  check('every detailed screen in order', edits.join(' > ') === ['About you', 'Anything to plan around?', 'Goals', 'Experience', 'Schedule', 'Equipment', 'Joints and sides', 'Weight and protein', 'Your plan'].join(' > '), edits.join(' > '));
  check('ending in Save changes', /Save changes/.test(await page.locator('.ob-actions').innerText()));
  check('in plain words there too', !dashes(await text(page)) && !/deload|×/.test(await text(page)));
  await next(page);
  await page.waitForTimeout(400);
  check('saving closes it with "Plan updated"', await page.locator('.onboard').isHidden() && /Plan updated/.test(await page.evaluate(() => document.body.innerText)));
  const w = await page.evaluate(() => window.GH.ui.S.weights.filter((x) => x.day === window.GH.ui.today()).length);
  check('an unchanged weight isn\'t logged again', w === 1, w);

  section('One screen with Save');
  await page.evaluate(() => window.GH.ui.editAnswers('conditions'));
  await page.waitForTimeout(400);
  check('one screen: no progress bar, Save', (await title(page)) === 'Anything to plan around?' && await page.locator('.onboard .ob-progress .rf-progress').count() === 0 && (await page.locator('.ob-actions').innerText()).trim() === 'Save');
  await tap(page, '.onboard .rf-chip[data-list="conditions"][data-v="hands"]', 120);
  await next(page);
  await page.waitForTimeout(400);
  check('Save updates the plan', await page.evaluate(() => window.GH.ui.S.profile.conditions.join()) === 'balance,hands');
  await page.evaluate(() => window.GH.ui.editAnswers('schedule'));
  await page.waitForTimeout(400);
  check('Schedule as before, in plain words', (await title(page)) === 'Schedule' && /Walk-and-stretch days/.test(await text(page)) && await page.locator('.onboard input[type="range"][data-k="minutes"]').count() === 1);
  await page.evaluate(() => window.__gh.back()); await page.waitForTimeout(400);
  await page.evaluate(() => window.GH.ui.editAnswers('nutrition'));
  await page.waitForTimeout(400);
  check('Weight and protein on its own, protein in grams a day', (await title(page)) === 'Weight and protein' && /\b\d+ g\b/.test(await text(page)) && /About that much a day/.test(await text(page)) && !/g\/kg|g\/lb/.test(await text(page)));
  await shot(page, '14-one-nutrition');
  await page.evaluate(() => window.__gh.back()); await page.waitForTimeout(400);
  check('Android Back closes a one-screen edit', await page.locator('.onboard').isHidden());
  await ctx.close();
}

section('After the first workout: Health Connect, then the tour');
{
  const { ctx, page } = await fresh('app', '2026-09-28T08:00:00');
  await next(page); await next(page); await next(page); await next(page);
  await toPlan(page);
  await page.click('.ob-actions [data-act="obLook"]');
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 5000 });
  await page.clock.runFor(2500); await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({ tour: !!document.querySelector('dialog.tour-sheet[open]'), card: window.GH.ui.hcInvite(window.GH.ui.S), list: (document.querySelector('#screen .checklist') || {}).innerText || '' }));
  check('before it: no tour and no Health Connect card; the checklist keeps both for later', !before.tour && before.card === '' && /Connect Health Connect/.test(before.list) && /Do a level check/.test(before.list), before);
  // The first workout, done and checked in as the player does it.
  await page.evaluate(() => { const GH = window.GH, U = GH.ui, B = GH.brain, S = U.S; B.startWorkout(S, U.today(), { now: Date.now() - 26 * 60000 }); for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); } B.finishWorkout(S, { rating: 'right', now: Date.now() }); U.save(true); });
  const card = await page.evaluate(() => window.GH.ui.hcInvite(window.GH.ui.S));
  check('after it, the Next screen\'s card offers Health Connect', /Let sleep and steps shape your workouts/.test(card) && /data-act="hcInviteGo"/.test(card) && /Not now/.test(card));
  // Today brings the tour once nothing's on top (a new badge's toast goes first).
  await page.evaluate(() => window.GH.ui.render());
  let tour = {};
  for (let i = 0; i < 40 && !tour.open; i++) {
    await page.clock.runFor(500); await page.waitForTimeout(80);
    tour = await page.evaluate(() => ({ open: !!document.querySelector('dialog.tour-sheet[open]'), title: (document.querySelector('dialog.tour-sheet[open] .rf-sheet-title') || {}).textContent, n: document.querySelectorAll('dialog.tour-sheet[open] .tour-dots.rf-pagedots > .rf-dot').length, toast: !!document.querySelector('.rf-toaster .rf-toast:not([data-leaving])') }));
  }
  check('then Today brings the tour, three cards, not over a toast', tour.open && tour.title === 'Find your way around' && tour.n === 3 && !tour.toast, tour);
  await page.waitForTimeout(500);
  await shot(page, '15-tour');
  // Refract's page dots follow the page: Next moves the current dot, and a dot goes to its page.
  const dots = () => page.evaluate(() => { const d = document.querySelector('dialog.tour-sheet[open]'); const page = d.querySelector('.tour').dataset.page; const ds = [...d.querySelectorAll('.tour-dots > .rf-dot')]; return { page, cur: ds.findIndex((x) => x.getAttribute('aria-current') === 'true'), worm: !!d.querySelector('.tour-dots > .rf-pagedots-worm') }; });
  const d0 = await dots();
  await page.click('dialog.tour-sheet[open] [data-act="tourNext"]');
  await page.clock.runFor(600); await page.waitForTimeout(300);
  const d1 = await dots();
  await page.click('dialog.tour-sheet[open] .tour-dots > .rf-dot:nth-child(3)');
  await page.clock.runFor(600); await page.waitForTimeout(300);
  const d2 = await dots();
  check('its page dots follow the page (Next, then a dot tapped)', d0.page === '0' && d0.cur === 0 && d0.worm && d1.page === '1' && d1.cur === 1 && d2.page === '2' && d2.cur === 2, { d0, d1, d2 });
  await page.evaluate(() => window.GH.ui.closeSheets()); await page.clock.runFor(600); await page.waitForTimeout(400);
  await page.evaluate(() => window.GH.ui.render()); await page.clock.runFor(3000); await page.waitForTimeout(400);
  check('once', await page.evaluate(() => !document.querySelector('dialog.tour-sheet[open]') && window.GH.ui.seen('tour')));
  // Not now: the card goes, and stays gone.
  await page.evaluate(() => { const U = window.GH.ui; const d = document.createElement('div'); d.innerHTML = U.hcInvite(U.S); document.body.appendChild(d); U.act.hcInviteLater(d.querySelector('[data-act="hcInviteLater"]')); });
  await page.clock.runFor(600); await page.waitForTimeout(400);
  check('Not now puts it away for good', await page.evaluate(() => window.GH.ui.hcInvite(window.GH.ui.S) === ''));
  check('and no Health Connect request in all that', await page.evaluate(() => window.__hcAsks) === 0);
  await ctx.close();
}

section('A flare day (rheumatoid arthritis)');
{
  const { ctx, page } = await fresh('app', '2026-09-28T08:00:00');
  await page.evaluate(() => {
    const B = window.GH.brain;
    const day = B.dayOf(Date.now(), 4);
    const S = B.newState({ goals: ['strength'], age: 60, conditions: ['ra'], units: 'lb', weightKg: 70, equipment: { db: [5, 10], band: true } }, null, day);
    S.seen = { tour: true, checklistHidden: true, lastVersion: window.GH.VERSION, tip_plan: true, tip_health: true, tip_progress: true, tip_moves: true, playerHint: true, rirCount: 5, moveSheet: true, hcInvite: true };
    window.GH.store.save(S);
  });
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await page.waitForTimeout(400);
  const has = await page.locator('#screen .feel-flare input[role="switch"]').count();
  check('the feel check offers a flare day', has === 1);
  if (has) {
    await page.locator('#screen .feel-flare input[role="switch"]').check({ force: true });
    // Today changes once the switch's knob has landed (a re-render waits for it, src/ui/core.js).
    await page.waitForFunction(() => /Flare day/.test((document.querySelector('#screen .session') || {}).innerText || ''), null, { timeout: 4000 }).catch(() => {});
    const card = await page.locator('#screen .session').innerText().catch(() => '');
    check('today becomes gentle range of motion', /Flare day/.test(card) && /Gentle range of motion/.test(card), card.slice(0, 300));
    await page.evaluate(() => window.GH.ui.act.startWorkout());
    await page.waitForTimeout(700);
    check('the player starts on a seated range-of-motion move', /Seated arm circles|Wrist circles/.test(await page.locator('#player').innerText()));
    await page.evaluate(() => { const S = window.GH.ui.S, B = window.GH.brain; for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 50; g++) B.completeStep(S, {}); window.GH.ui.openCheckin(); });
    await page.waitForTimeout(500);
    const ck = await page.locator('#player').innerText();
    check('its check-in is short: no rating, no sets to count', /A gentle day done/.test(ck) && !/How was it\?/.test(ck), ck.slice(0, 200));
    await page.click('#player [data-act="plSaveCheckin"]');
    await page.waitForTimeout(600);
    const vol = await page.evaluate(() => { const S = window.GH.ui.S; return { done: S.log.some((l) => l.type === 'workout' && window.GH.brain.isDone(l)), rating: S.log[S.log.length - 1].checkin.rating }; });
    check('and it counts, without touching training volume', vol.done && vol.rating == null, vol);
  }
  await ctx.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 8).join('\n'));
await browser.close();
await server.close();
done();
