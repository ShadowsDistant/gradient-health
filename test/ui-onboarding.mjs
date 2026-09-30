// The set-up in Chromium at phone size: which screens show for each "what to track" choice (never a
// food tracking question on "Workouts and health"), with and without Health Connect, the "Anything
// we should plan around?" screen and what it changes, kind validation messages, Back (the button and
// Android Back), finishing onto Today, "Update my answers" (every screen, Save changes) and one
// screen with Save from Settings, and no console errors. Screenshots go to build/ui-onboarding/.
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

// A fresh first run. bridge: 'app' (Health Connect there), 'unsupported' (the app on an older
// Android) or 'web' (a browser, no app).
async function fresh(bridge = 'app') {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date('2026-09-28T08:00:00') });
  if (bridge !== 'web') await page.addInitScript(seedBridge);
  if (bridge === 'unsupported') await page.addInitScript(() => { const t = setInterval(() => { if (window.AndroidBridge) { window.AndroidBridge.hcStatus = () => 'unsupported'; clearInterval(t); } }, 1); });
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden]) .rf-large-title');
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}${dark ? '-dark' : ''}.png`) });
const title = (page) => page.locator('.onboard .rf-large-title').first().innerText();
const next = async (page) => { await page.locator('.ob-actions [data-variant="tinted"]').click(); await page.waitForTimeout(120); };
const fill = async (page, k, v) => { const el = page.locator(`.onboard input[data-k="${k}"]`); await el.fill(String(v)); await el.dispatchEvent('change'); await page.waitForTimeout(60); };
const track = async (page, v) => { await page.click(`.onboard input[name="obTrack"][value="${v}"]`, { force: true }); await page.waitForTimeout(80); };
// Food tracking choices from the old set-up: none of these may appear on the workouts path.
const foodQuestion = (page) => page.evaluate(() => !!document.querySelector('.onboard input[name="food.mode"]') || /Protein only|Food tracking/.test(document.querySelector('.onboard').innerText));
// Clicks Continue from the welcome screen to the plan, collecting titles; `at` runs on each screen.
async function walk(page, at) {
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const t = await title(page);
    seen.push(t);
    if (at) await at(t);
    if (t === 'Your plan') break;
    await next(page);
  }
  return seen;
}
const W = ['Gradient Health', 'What to track'];
const TRAINING = ['Goals', 'Experience', 'Schedule', 'Equipment', 'Joints and sides'];

section('Which screens show');
{
  const { ctx, page } = await fresh('app');
  let food = false;
  const seen = await walk(page, async (t) => { if (await foodQuestion(page)) food = true; if (t === 'What to track') check('"Workouts and health" is picked by default', await page.locator('input[name="obTrack"][value="workouts"]').isChecked()); });
  check('Workouts and health: every step in order, Weight and protein instead of Food', seen.join(' > ') === W.concat(['Health data', 'About you', 'Anything we should plan around?'], TRAINING, ['Baseline test', 'Weight and protein', 'Your plan']).join(' > '), seen.join(' > '));
  check('Workouts and health never asks about food tracking', !food);
  await shot(page, '01-plan-workouts');
  await ctx.close();
}
{
  const { ctx, page } = await fresh('app');
  const seen = await walk(page, async (t) => { if (t === 'What to track') await track(page, 'both'); if (t === 'Food') await shot(page, '02-food-calories'); });
  check('Workouts, health and food: the calorie set-up instead of Weight and protein', seen.join(' > ') === W.concat(['Health data', 'About you', 'Anything we should plan around?'], TRAINING, ['Baseline test', 'Food', 'Your plan']).join(' > '), seen.join(' > '));
  await ctx.close();
}
{
  const { ctx, page } = await fresh('app');
  const seen = await walk(page, async (t) => { if (t === 'What to track') await track(page, 'food'); });
  check('Food and health: no workout screens at all', seen.join(' > ') === W.concat(['Health data', 'About you', 'Food', 'Your plan']).join(' > '), seen.join(' > '));
  check('its summary is daily targets, not a week of workouts', /Your daily targets/.test(await page.locator('.onboard').innerText()) && !/Your week/.test(await page.locator('.onboard').innerText()));
  await ctx.close();
}
for (const bridge of ['unsupported', 'web']) {
  const { ctx, page } = await fresh(bridge);
  const seen = await walk(page);
  check(`no Health data screen ${bridge === 'web' ? 'in a browser' : 'where Health Connect is unsupported'}`, !seen.includes('Health data') && seen.includes('About you'), seen.join(' > '));
  await ctx.close();
}

section('About you: kind checks, units, Enter');
{
  const { ctx, page } = await fresh('web');
  await next(page); await next(page);
  check('About you', (await title(page)) === 'About you');
  await fill(page, 'age', 150);
  await next(page);
  const err = await page.locator('.onboard .rf-field[data-invalid] .rf-field-error').first().innerText().catch(() => '');
  check('an age of 150 stays on the screen with a helpful message', (await title(page)) === 'About you' && /age from 13 to 100/.test(err), err);
  check('the field is marked invalid for screen readers', await page.locator('.onboard input[data-k="age"][aria-invalid="true"]').count() === 1);
  await shot(page, '03-about-error');
  await fill(page, 'age', 34);
  check('fixing it clears the message', await page.locator('.onboard .rf-field-error').count() === 0);
  await fill(page, '_w', 5);
  await next(page);
  check('a weight of 5 lb gets its own message', /weight from 60 to 700 lb/.test(await page.locator('.onboard .rf-field-error').first().innerText().catch(() => '')));
  await fill(page, '_w', 165);
  await fill(page, '_hft', 5); await fill(page, '_hin', 9);
  await page.click('.onboard .rf-segmented[aria-label="Units"] input[value="kg"]', { force: true });
  await page.waitForTimeout(120);
  check('switching to kg converts weight and height', (await page.locator('.onboard input[data-k="_w"]').inputValue()) === '74.8' && (await page.locator('.onboard input[data-k="_hcm"]').inputValue()) === '175');
  await page.locator('.onboard input[data-k="age"]').focus();
  await page.keyboard.press('Enter');
  check('Enter moves to the next field', await page.evaluate(() => document.activeElement && document.activeElement.dataset.k === '_w'));
  await next(page);
  check('valid answers move on', (await title(page)) === 'Anything we should plan around?');
  await ctx.close();
}

section('Anything we should plan around?');
{
  const { ctx, page } = await fresh('web');
  await next(page); await next(page);
  await fill(page, 'age', 72);
  check('the age says what changes from 65', /From 65: balance practice every session/.test(await page.locator('.onboard').innerText()));
  await next(page);
  check('conditions come right after About you', (await title(page)) === 'Anything we should plan around?');
  check('from 60, it asks about getting down to the floor', await page.locator('.onboard .rf-segmented[aria-label="Getting down to the floor"]').count() === 1);
  check('pregnancy is explained, not offered', /Pregnant\? This plan isn't built for pregnancy/.test(await page.locator('.onboard').innerText()) && await page.locator('.onboard [data-list="conditions"][data-v="pregnancy"]').count() === 0);
  await page.click('.onboard .rf-chip[data-list="conditions"][data-v="balance"]'); await page.waitForTimeout(120);
  const around = await page.locator('.onboard .ob-around').innerText().catch(() => '');
  check('picking one shows what the plan does about it', /Planned around age 72 and balance/.test(around) && /hand on the wall/.test(around), around);
  await page.click('.onboard .rf-chip[data-list="conditions"][data-v="heart"]'); await page.waitForTimeout(120);
  check('a heart condition says to check with your doctor first', /Check with your doctor before you start/.test(await page.locator('.onboard .ob-status[data-tone="caution"]').innerText().catch(() => '')));
  await page.click('.onboard .rf-chip[data-list="conditions"][data-v="oa"]'); await page.waitForTimeout(120);
  check('osteoarthritis asks which joints', await page.locator('.onboard .rf-chip[data-list="oaJoints"]').count() === 5);
  await shot(page, '04-conditions');
  await page.click('.onboard .rf-chip[data-list="conditions"][data-v="heart"]'); await page.click('.onboard .rf-chip[data-list="conditions"][data-v="oa"]'); await page.waitForTimeout(120);
  // Back: the button, then Android Back.
  await next(page);
  check('then Goals', (await title(page)) === 'Goals');
  await page.click('.onboard [data-act="obBack"]'); await page.waitForTimeout(150);
  check('the Back button goes to the screen before, answers kept', (await title(page)) === 'Anything we should plan around?' && await page.locator('.onboard .rf-chip[data-v="balance"][aria-pressed="true"]').count() === 1);
  await page.evaluate(() => window.__gh.back()); await page.waitForTimeout(150);
  check('Android Back does the same', (await title(page)) === 'About you' && (await page.locator('.onboard input[data-k="age"]').inputValue()) === '72');
  await next(page); await next(page);
  const seen = await walk(page);
  check('with a condition there is no baseline test', !seen.includes('Baseline test'), seen.join(' > '));
  const plan = await page.locator('.onboard').innerText();
  check('Your plan: days, focus, and what\'s built around you', /3 days · ~|4 days · ~/.test(plan) && /Built around you/.test(plan) && /Balance problems or falls/.test(plan) && /From 65/.test(plan), plan.slice(0, 400));
  await shot(page, '05-plan-around');
  await next(page); // Start
  await page.waitForSelector('#screen[data-view="today"]');
  // The short tour opens after set-up; skip it.
  await page.waitForSelector('dialog.tour-sheet[open]', { timeout: 4000 }).catch(() => null);
  await page.evaluate(() => { const b = document.querySelector('dialog.tour-sheet [data-act="tourSkip"]'); if (b) b.click(); });
  await page.waitForTimeout(700);
  const p = await page.evaluate(() => { const S = window.GH.ui.S; return { c: S.profile.conditions, since: S.profile.conditionsSince, age: S.profile.age, floor: S.profile.floorOk }; });
  check('finishing saves the answers', p.c.join() === 'balance' && p.since && p.since.balance != null && p.age === 72, p);
  check('Today says what the plan is built around', /Planned around age 72 and balance/.test(await page.locator('#screen').innerText()));
  await shot(page, '06-today-around');

  section('Update my answers (edit mode)');
  await page.evaluate(() => { const U = window.GH.ui; window.GH.brain.addWeight(U.S, U.today(), 70, 'manual'); U.editAnswers(); });
  await page.waitForTimeout(300);
  check('opens on About you with Close, not Back', (await title(page)) === 'About you' && await page.locator('.onboard .ob-top [aria-label="Close"]').count() === 1);
  check('the weight shown is your latest one (70 kg = 154.3 lb)', (await page.locator('.onboard input[data-k="_w"]').inputValue()) === '154.3');
  const edits = [];
  for (let i = 0; i < 12; i++) { const t = await title(page); edits.push(t); if (t === 'Your plan') break; await next(page); }
  check('every screen but the welcome, what to track, health data and the test', edits.join(' > ') === ['About you', 'Anything we should plan around?'].concat(TRAINING, ['Weight and protein', 'Your plan']).join(' > '), edits.join(' > '));
  check('ending in Save changes', /Save changes/.test(await page.locator('.ob-actions').innerText()));
  await next(page);
  await page.waitForTimeout(400);
  check('saving closes it with "Plan updated"', await page.locator('.onboard').isHidden() && /Plan updated/.test(await page.evaluate(() => document.body.innerText)));
  const w = await page.evaluate(() => window.GH.ui.S.weights.filter((x) => x.day === window.GH.ui.today()).length);
  check('an unchanged weight isn\'t logged again', w === 1, w);

  section('One screen with Save (Settings)');
  await page.evaluate(() => window.GH.ui.open('settings'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.GH.ui.act.editAnswers());
  await page.waitForTimeout(500);
  const rows = await page.locator('dialog[open] .rf-list').innerText();
  check('Your answers lists the new screens with their answers', /Anything we should plan around\?/.test(rows) && /Balance problems or falls/.test(rows) && /Joints and sides/.test(rows) && /Weight and protein/.test(rows) && !/Sleep|Style/.test(rows), rows);
  await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.ui.editAnswers('conditions'); });
  await page.waitForTimeout(400);
  check('one screen: no progress bar, Save', (await title(page)) === 'Anything we should plan around?' && await page.locator('.onboard .ob-progress .rf-progress').count() === 0 && (await page.locator('.ob-actions').innerText()).trim() === 'Save');
  await page.click('.onboard .rf-chip[data-list="conditions"][data-v="hands"]'); await page.waitForTimeout(100);
  await next(page);
  await page.waitForTimeout(400);
  check('Save updates the plan', await page.evaluate(() => window.GH.ui.S.profile.conditions.join()) === 'balance,hands');
  await page.evaluate(() => window.GH.ui.editAnswers('nutrition'));
  await page.waitForTimeout(400);
  check('Weight and protein on its own: no food tracking question', (await title(page)) === 'Weight and protein' && !(await foodQuestion(page)));
  await shot(page, '07-one-nutrition');
  await page.evaluate(() => window.__gh.back()); await page.waitForTimeout(400);
  check('Android Back closes a one-screen edit', await page.locator('.onboard').isHidden());
  await ctx.close();
}

section('A flare day (rheumatoid arthritis)');
{
  const { ctx, page } = await fresh('app');
  await page.evaluate(() => {
    const B = window.GH.brain;
    const day = B.dayOf(Date.now(), 4);
    const S = B.newState({ goals: ['strength'], age: 60, conditions: ['ra'], units: 'lb', weightKg: 70, equipment: { db: [5, 10], band: true } }, null, day);
    S.seen = { tour: true, checklistHidden: true, lastVersion: window.GH.VERSION, tip_plan: true, tip_health: true, tip_progress: true, tip_moves: true, playerHint: true, rirCount: 5, moveSheet: true };
    window.GH.store.save(S);
  });
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await page.waitForTimeout(400);
  check('the feel check offers a flare day', await page.locator('#screen .feel-flare input[role="switch"]').count() === 1);
  await page.locator('#screen .feel-flare input[role="switch"]').check({ force: true });
  await page.waitForTimeout(700);
  const card = await page.locator('#screen .session').innerText();
  check('today becomes gentle range of motion', /Flare day/.test(card) && /Gentle range of motion/.test(card) && /Wrist circles/.test(card), card.slice(0, 300));
  await shot(page, '08-flare-today');
  await page.evaluate(() => window.GH.ui.act.startWorkout());
  await page.waitForTimeout(700);
  check('the player starts on a seated range-of-motion move', /Seated arm circles|Wrist circles/.test(await page.locator('#player').innerText()));
  await shot(page, '09-flare-player');
  await page.evaluate(() => { const S = window.GH.ui.S, B = window.GH.brain; for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 50; g++) B.completeStep(S, {}); window.GH.ui.openCheckin(); });
  await page.waitForTimeout(500);
  const ck = await page.locator('#player').innerText();
  check('its check-in is short: no rating, no sets to count', /A gentle day done/.test(ck) && !/How was it\?/.test(ck), ck.slice(0, 200));
  await page.click('#player [data-act="plSaveCheckin"]');
  await page.waitForTimeout(600);
  const vol = await page.evaluate(() => { const S = window.GH.ui.S; return { done: S.log.some((l) => l.type === 'workout' && window.GH.brain.isDone(l)), rating: S.log[S.log.length - 1].checkin.rating }; });
  check('and it counts, without touching training volume', vol.done && vol.rating == null, vol);
  await ctx.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 8).join('\n'));
await browser.close();
await server.close();
done();
