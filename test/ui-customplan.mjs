// Your plans in Chromium at phone size, someone five weeks in: build a plan like a playlist (the
// picker with its stills and filters, sets and reps with steppers, reordering by dragging and with
// the keyboard, a second day, set weekdays), use it and run its first day in the player to the
// check-in (targets move on), share it (the QR code, the link in the share text), get a friend's
// plan from a link through window.__gh.onLink (the preview with its swaps, Save, Use it now, and the
// same link twice), ask the coach to build one (with a stand-in on-device model held to the moves
// this person can do), and go back to the coach's plan. No console errors. Screenshots of every
// screen go to build/ui-customplan/ for a visual pass.
// Usage: node test/ui-customplan.mjs [--dark] [--width=390] [--zoom=1.3]
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const zoom = Number((process.argv.find((a) => a.startsWith('--zoom=')) || '--zoom=1').split('=')[1]);
const tag = `${dark ? '-dark' : ''}${width !== 390 ? `-${width}` : ''}${zoom !== 1 ? '-zoom' : ''}`;
const OUT = join(root, 'build/ui-customplan');
if (!tag) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
// The share sheet and the clipboard, recorded.
await page.addInitScript(() => {
  const t = setInterval(() => {
    if (!window.AndroidBridge) return;
    clearInterval(t);
    window.__shared = [];
    window.AndroidBridge.shareText = (text, target) => { window.__shared.push({ text, target }); };
    window.AndroidBridge.copy = (text) => { window.__copied = text; return true; };
  }, 1);
});
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"]');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 300)); };
// WebView's text zoom scales every font size; this does the same to what's on screen now.
const zoomText = async () => {
  if (zoom === 1) return;
  await page.evaluate((f) => {
    // Sizes are all read first, so a scaled parent doesn't scale its children twice.
    const els = [...document.querySelectorAll('body *')].filter((x) => !x.closest('svg') && !x.dataset.zoomed);
    const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
    els.forEach((e, i) => { if (sizes[i]) { e.style.setProperty('font-size', `${sizes[i] * f}px`, 'important'); e.dataset.zoomed = '1'; } });
    window.dispatchEvent(new Event('resize'));
  }, zoom);
  await page.waitForTimeout(120);
};
const shot = async (name, keep) => {
  if (!keep) await page.evaluate(() => { if (!document.querySelector('dialog[open]')) document.getElementById('screen').scrollTop = 0; });
  await zoomText();
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(OUT, `${name}${tag}.png`) });
};
const shotSheet = async (name) => {
  await zoomText();
  await page.screenshot({ path: join(OUT, `${name}${tag}.png`) });
  const more = await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); return b ? b.scrollHeight - b.clientHeight : 0; });
  if (more > 40) {
    await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${name}-end${tag}.png`) });
    await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); b.scrollTop = 0; });
  }
};
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
const S = (fn, arg) => page.evaluate(fn, arg);
const plan = () => S(() => { const U = window.GH.ui; return JSON.parse(JSON.stringify(window.GH.customPlan.get(U.S, U.route.arg))); });
const rows = (di) => page.evaluate((d) => [...document.querySelectorAll(`#screen .cp-exlist[data-day="${d}"] .cp-ex-name`)].map((e) => e.textContent), di);
const closeSheets = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await settle(600); };
// Stills: an image (3D) or the flat figure in each tile that's been drawn.
const drawn = (sel) => page.evaluate((s) => { const all = [...document.querySelectorAll(s)]; return { all: all.length, drawn: all.filter((h) => h.querySelector('img, svg')).length }; }, sel);

/* ------------------------------------------------------------------ the Plans page */
section('Your plans');
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
check('Plan\'s Make it yours opens Your plans', await page.locator('#screen [data-key="mine"] [data-act="openPlans"]').count() === 1);
await page.click('#screen [data-key="mine"] [data-act="openPlans"]');
await settle(900);
check('the Plans page opens', await S(() => window.GH.ui.route.view) === 'plans');
check('it says the coach\'s plan is in use', /In use\s*The coach's plan/.test(await page.locator('#screen .cp-inuse').innerText()));
check('with Build your own, Ask the coach and Add a shared plan', await page.locator('#screen .cp-make [data-act="cpNew"]').count() === 1 && await page.locator('#screen .cp-make [data-act="cpBuild"]').count() === 1 && await page.locator('#screen .cp-make [data-act="cpScan"]').count() === 1);
await shot('01-plans');

/* ------------------------------------------------------------------ building one */
section('Building a plan');
await page.click('#screen .cp-make [data-act="cpNew"]');
await settle(700);
await shotSheet('02-new');
await page.click('dialog[open] [data-act="cpNewBlank"]');
await settle(900);
check('an empty plan opens on its own page', await S(() => window.GH.ui.route.view) === 'planEdit' && (await plan()).days.length === 1);
await page.fill('#cpName', 'Morning strength');
await page.press('#cpName', 'Tab');
await settle(500);
check('renaming it saves the name', (await plan()).name === 'Morning strength' && /Morning strength/.test(await page.locator('#screen .cp-title').innerText()));
check('an empty plan can\'t be used yet, and says why', await page.locator('#screen [data-act="cpUse"]').count() === 0 && /Day 1 has no exercises yet/.test(await page.locator('#screen .cp-hero').innerText()));
await shot('03-empty');

await page.click('#screen [data-act="cpAdd"][data-arg="0"]');
await settle(900);
check('the picker opens full height with tiles', await page.locator('dialog[open].cp-picker .cp-tile').count() > 30);
const onlyMine = await S(() => [...document.querySelectorAll('dialog[open] .cp-tile')].every((t) => !t.classList.contains('is-off')));
check('by default only moves you can do', onlyMine);
await settle(2500);
const st1 = await drawn('dialog[open] .cp-tile .cp-thumb');
check('tiles on screen get stills of the move', st1.drawn >= 4, st1);
await shot('04-picker');
await page.click('dialog[open] [data-act="cpGroup"][data-arg="legs"]');
await settle(500);
const legs = await S(() => [...document.querySelectorAll('dialog[open] .cp-tile-sub')].map((e) => e.textContent));
check('the Legs filter shows leg moves only', legs.length > 3 && legs.every((t) => /^Legs/.test(t)), legs.slice(0, 5));
await page.click('dialog[open] [data-act="cpGroup"][data-arg="all"]');
await page.fill('#cpQ', 'push-up');
await settle(400);
const found = await S(() => [...document.querySelectorAll('dialog[open] .cp-tile-name')].map((e) => e.textContent));
check('search finds moves by name', found.includes('Push-up') && found.every((n) => /push-up/i.test(n)), found);
await page.click('dialog[open] .cp-tile[data-arg="push_std"]');
await settle(300);
await page.fill('#cpQ', '');
await settle(400);
await page.click('dialog[open] .cp-tile[data-arg="row_db"]');
await settle(300);
await page.click('dialog[open] .cp-tile[data-arg="sq_goblet"]');
await settle(300);
check('each tap adds one, marked on its tile', await page.locator('dialog[open] .cp-tile.is-added').count() === 3 && /Done \(3\)/.test(await page.locator('dialog[open] [data-act="cpPickDone"]').innerText()));
await page.click('dialog[open] .cp-tile[data-arg="row_db"]');
await settle(300);
check('tapping one just added takes it back out', await page.locator('dialog[open] .cp-tile.is-added').count() === 2);
await page.click('dialog[open] .cp-tile[data-arg="row_db"]');
await settle(300);
await page.evaluate(() => { const b = document.querySelector('dialog[open] .cp-mine input'); b.click(); });
await settle(500);
check('turning off Only what I can do shows the rest, marked', await page.locator('dialog[open] .cp-tile.is-off').count() > 10);
await shot('05-picker-all');
await page.click('dialog[open] [data-act="cpPickDone"]');
await settle(800);
check('the day lists them in order', JSON.stringify(await rows(0)) === JSON.stringify(['Push-up', 'Goblet squat', 'Bent-over row']), await rows(0));

// One exercise: sets and reps with steppers.
await page.click('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-ex-row');
await settle(800);
await shotSheet('06-item');
await page.click('dialog[open] .cp-step:nth-child(1) .rf-stepper-btn[data-step="1"]');
await page.click('dialog[open] .cp-step:nth-child(2) .rf-stepper-btn[data-step="1"]');
await page.click('dialog[open] .cp-rest [data-arg="90"]');
await settle(500);
let p = await plan();
check('steppers set sets and reps, and rest is picked', p.days[0].items[0].sets === 4 && p.days[0].items[0].reps === (await S(() => window.GH.moves.MOVES.push_std.start)) + 1 && p.days[0].items[0].rest === 90, p.days[0].items[0]);
await closeSheets();
check('the row shows it', /4 × \d+ reps · rest 90 s/.test(await page.locator('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-ex-meta').innerText()));

// Reorder: drag the last one to the top, then the keyboard.
await page.evaluate(() => document.querySelector('#screen .cp-exlist[data-day="0"]').scrollIntoView({ block: 'center' }));
await settle(300);
const grip = async (i) => { const b = await page.locator(`#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(${i + 1}) .cp-grip`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const a = await grip(2), top = await grip(0);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x, a.y + (top.y - 20 - a.y) * k / 8); await page.waitForTimeout(16); }
check('a row lifts while it\'s dragged', await page.locator('#screen .cp-ex[data-lifted]').count() === 1);
await shot('07-drag', true);
await page.mouse.up();
await settle(600);
check('dropping it on top moves it there', JSON.stringify(await rows(0)) === JSON.stringify(['Bent-over row', 'Push-up', 'Goblet squat']), await rows(0));
await page.focus('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-grip');
await page.keyboard.press('ArrowDown');
await settle(500);
check('the arrow keys move it too, and focus follows', JSON.stringify(await rows(0)) === JSON.stringify(['Push-up', 'Bent-over row', 'Goblet squat']) && await S(() => document.activeElement && document.activeElement.dataset.grip) === '0:1', await rows(0));

// A second day, and set days.
await page.click('#screen [data-act="cpAddDay"]');
await settle(700);
await page.click('#screen [data-act="cpAdd"][data-arg="1"]');
await settle(800);
await page.fill('#cpQ', 'curl');
await settle(400);
await page.click('dialog[open] .cp-tile[data-arg="curl_std"]');
await page.fill('#cpQ', 'overhead extension');
await settle(400);
await page.click('dialog[open] .cp-tile[data-arg="tri_oh"]');
await settle(300);
await page.click('dialog[open] [data-act="cpPickDone"]');
await settle(700);
await page.fill('#screen .cp-day[data-key="day-1"] .cp-day-title', 'Arms');
await page.press('#screen .cp-day[data-key="day-1"] .cp-day-title', 'Tab');
await settle(400);
await page.click('#screen .cp-sched input[value="set"]', { force: true });
await settle(600);
p = await plan();
check('two days, the second named, on Monday and Thursday', p.days.length === 2 && p.days[1].title === 'Arms' && JSON.stringify(p.weekdays) === '[0,3]', { days: p.days.length, title: p.days[1].title, wd: p.weekdays });
await page.click('#screen .cp-wds [data-v="3"]');
await page.click('#screen .cp-wds [data-v="4"]');
await settle(500);
p = await plan();
check('picking other days moves day 2 to Friday', JSON.stringify(p.weekdays) === '[0,4]' && /day 2 on Fri/.test(await page.locator('#screen .cp-sched').innerText()), p.weekdays);
await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
await settle(300);
await shot('08-plan');
await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight; });
await settle(300);
await shot('09-plan-days', true);

/* ------------------------------------------------------------------ using it */
section('Using it');
await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
await page.click('#screen [data-act="cpUse"]');
await settle(700);
check('Use this plan puts it in use', await S(() => window.GH.ui.S.activePlan) === p.id && /Using Morning strength/.test(await toasts()), await toasts());
check('its page says so', /In use/.test(await page.locator('#screen .cp-hero').innerText()));
await page.evaluate(() => window.GH.ui.go('plan'));
await settle(900);
const w = await S(() => { const U = window.GH.ui, w = window.GH.planWeek(U.S, U.today()); return { kinds: w.days.map((d) => d.kind), titles: w.days.map((d) => d.title) }; });
check('the Plan tab follows it: Monday and Friday', w.kinds[0] === 'today' && w.kinds[4] === 'workout' && w.kinds[1] !== 'workout' && w.titles[4] === 'Arms', w);
check('with the plan above the week', /Your plan\s*Morning strength/.test(await page.locator('#screen .cp-banner').innerText()));
await settle(7000);
await shot('10-plan-tab');
await page.click('.rf-tab[data-tab="today"]');
await settle(900);
check('Today shows the plan\'s first day', /Morning strength/.test(await page.locator('#screen .session').innerText()) && /Push-up/.test(await page.locator('#screen .session').innerText()));
await shot('11-today');

section('Running it in the player');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
const pstate = () => page.evaluate(() => {
  const pl = document.querySelector('.player');
  const q = (sel) => pl.querySelector(sel);
  const t = q('.pl-actions [data-variant="tinted"]');
  return { checkin: !!(q('.rf-large-title') && q('.rf-large-title').textContent === 'Check-in'), act: t ? t.getAttribute('data-act') : null, rir: !!q('.pl-rir'), rirChosen: !!q('.pl-rir input:checked'), skipRest: !!q('[data-act="plSkipRest"]'), name: q('.pl-name') ? q('.pl-name').textContent : '' };
});
let guard = 0, rirAsked = 0, sawRest = false;
const names = new Set();
while (guard++ < 300) {
  const st = await pstate();
  if (st.checkin) break;
  if (st.name) names.add(st.name);
  if (st.rir && !st.rirChosen) { rirAsked++; if (rirAsked === 1) await shot('12-rest'); await page.click('.player .pl-rir input[value="3"]', { force: true }); await page.waitForTimeout(80); continue; }
  if (st.skipRest) { sawRest = true; await page.clock.fastForward(125000); await page.waitForTimeout(150); continue; }
  if (st.act === 'plStartTimer') { await page.click('.player [data-act="plStartTimer"]'); await page.clock.fastForward(3500); await page.waitForTimeout(100); await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act === 'plStopEarly' || st.act === 'plCancelTimer') { await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act) { await page.click(`.player [data-act="${st.act}"]`); await page.waitForTimeout(100); continue; }
  await page.waitForTimeout(150);
}
check('the player ran the plan\'s exercises', ['Push-up', 'Bent-over row', 'Goblet squat'].every((n) => names.has(n)), [...names]);
check('with rests and the how-many-more question on each', sawRest && rirAsked === 3, { sawRest, rirAsked });
check('to the check-in', (await pstate()).checkin);
await page.click('.player [data-act="plSaveCheckin"]');
await page.waitForSelector('.player .rf-large-title:has-text("Next time")', { timeout: 5000 });
const next = await page.locator('.player').innerText();
check('Next time: its targets move on', /Push-up → \d+ reps/.test(next) && /Goblet squat → \d+ reps/.test(next), next.slice(0, 300));
await shot('13-next');
await page.click('.player [data-act="plClose"]');
await settle(900);
const logged = await S(() => { const U = window.GH.ui, S = U.S; const l = S.log.find((x) => x.type === 'workout' && x.day === U.today()); return l ? { title: l.title, moves: l.items.map((it) => it.moveId), done: window.GH.brain.isDone(l), prog: Object.keys(S.planProg[S.activePlan] || {}) } : null; });
check('the workout is saved and counts', logged && logged.done && logged.moves.join() === 'push_std,row_db,sq_goblet' && logged.prog.length === 3, logged);

/* ------------------------------------------------------------------ sharing */
section('Sharing');
await page.evaluate((id) => window.GH.ui.open('planEdit', id), p.id);
await settle(800);
await page.click('#topbar [data-act="cpShare"]');
await settle(900);
check('the share sheet draws a QR code', await page.locator('dialog[open] .cp-qr svg path').count() === 1 && /A QR code for Morning strength/.test(await page.locator('dialog[open] .cp-qr svg').getAttribute('aria-label')));
check('with the plan and who it\'s from', /Morning strength/.test(await page.locator('dialog[open] .cp-share-what').innerText()) && /from Alex/.test(await page.locator('dialog[open] .cp-share-what').innerText()));
await shotSheet('14-share');
await page.click('dialog[open] [data-act="cpSendLink"]');
await settle(300);
const shared = await S(() => window.__shared.slice(-1)[0]);
const link = shared && (/https:\/\/shadowsdistant\.github\.io\/gradient-health\/p\/#[A-Za-z0-9_-]+/.exec(shared.text) || [])[0];
check('Send a link opens the share sheet with a short message and the link', !!link && /^Alex shared a workout plan with you: Morning strength \(2 days · 5 exercises\)\. Open it in Gradient Health: /.test(shared.text), shared);
const back = link && await S(async (l) => (await window.GH.customPlan.decode(l)).plan, link);
check('the link holds the plan', back && back.name === 'Morning strength' && back.days[1].title === 'Arms' && back.from === 'Alex' && JSON.stringify(back.weekdays) === '[0,4]', back);
await page.evaluate(() => { const i = document.querySelector('dialog[open] .rf-list input[role="switch"]'); i.click(); });
await settle(500);
check('Show my name off: the code leaves it out', !/from Alex/.test(await page.locator('dialog[open] .cp-share-what').innerText()));
await page.click('dialog[open] [data-act="cpCopyLink"]');
await settle(300);
const copied = await S(() => window.__copied);
check('Copy puts the link on the clipboard', /\/p\/#/.test(copied) && !(await S(async (l) => (await window.GH.customPlan.decode(l)).plan.from, copied)));
await closeSheets();

/* ------------------------------------------------------------------ getting one */
section('Getting a shared plan');
const friend = await S(async () => {
  const C = window.GH.customPlan;
  const plan = C.normalize({ name: 'Sam\'s gym split', note: 'Heavy first, then the rest.', weekdays: [1, 3, 5], days: [
    { title: 'Upper', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'curl_std', sets: 3, reps: 12 }] },
    { title: 'Lower', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'hg_rdl', sets: 3, reps: 10 }] },
    { title: 'Core', items: [{ move: 'ab_deadbug', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, secs: 30 }] },
  ] }).plan;
  return C.link(await C.encode(plan, { from: 'Sam' }));
});
check('other links go on to the next handler', await S(() => window.__gh.onLink('https://example.com/elsewhere')) === false);
check('a plan link is taken', await S((l) => window.__gh.onLink(l), friend) === true);
await settle(1200);
check('the preview opens: Sam\'s 3-day plan', /Sam's 3-day plan/.test(await page.locator('dialog[open] .rf-sheet-title').innerText()));
const preview = await page.locator('dialog[open] .cp-import').innerText();
check('with its days and exercises', /Upper/.test(preview) && /Barbell bench press/.test(preview) && /Lower/.test(preview) && /Core/.test(preview));
check('and what replaces the moves you have no equipment for', /Floor press for you: needs a barbell, a bench and a squat rack/.test(preview) && await page.locator('dialog[open] .cp-imp-list .cp-swap').count() >= 3, preview.slice(0, 400));
await settle(1500);
await shotSheet('15-import');
await page.click('dialog[open] [data-act="cpImpSave"]');
await settle(600);
check('Save to my plans saves it, from Sam', /Saved to your plans/.test(await page.locator('dialog[open] .cp-saved').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).some((x) => x.name === 'Sam\'s gym split' && x.from === 'Sam' && x.source === 'shared')));
await shotSheet('16-import-saved');
await page.click('dialog[open] [data-act="cpImpUse"]');
await settle(900);
check('Use it now switches to it and shows the Plan tab', await S(() => window.GH.ui.route.tab) === 'plan' && await S(() => window.GH.customPlan.get(window.GH.ui.S, window.GH.ui.S.activePlan).name) === 'Sam\'s gym split');
check('from tomorrow, since today\'s workout is done', /from tomorrow/.test(await page.locator('#screen .cp-banner').innerText()));
await S((l) => window.__gh.onLink(l), friend);
await settle(1200);
check('the same link again finds the saved copy', /Already in your plans/.test(await page.locator('dialog[open] .cp-import').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).filter((x) => x.name === 'Sam\'s gym split').length) === 1);
await closeSheets();

/* ------------------------------------------------------------------ the coach builds one */
section('Ask the coach');
// A stand-in on-device model: it answers with a plan made from the moves its grammar allows.
await page.evaluate(() => {
  const GH = window.GH;
  window.__grammar = null;
  GH.llm = {
    MODELS: [], available: () => ({ ok: true, reason: '' }), installed: async () => [{ id: 'stand-in' }], load: async () => ({}),
    chat: async (messages, opts) => {
      window.__grammar = opts.grammar;
      const ids = [...opts.grammar.split('\n').find((l) => l.startsWith('move ::=')).matchAll(/\\"([a-z0-9_]+)\\"/g)].map((m) => m[1]);
      const days = (opts.grammar.match(/ day /g) || []).length;
      const pick = (k) => ids.filter((_, i) => i % days === k).slice(0, 5);
      return JSON.stringify({ name: 'Arms first, knees easy', note: 'Arms twice a week and nothing hard on your knees.', days: Array.from({ length: days }, (_, k) => ({ title: `Day ${String.fromCharCode(65 + k)}`, items: pick(k).map((move) => ({ move, sets: 3, reps: 12 })) })) });
    },
  };
  GH.deviceCoach.pick = () => 'stand-in';
  GH.ui.S.ai.mode = 'device';
});
await page.evaluate(() => window.GH.ui.open('plans'));
await settle(800);
await page.click('#screen .cp-make [data-act="cpBuild"]');
await settle(800);
check('the coach shows what it already knows', /Equipment/.test(await page.locator('dialog[open] .cp-knows').innerText()) && /dumbbells 10\/15 lb/.test(await page.locator('dialog[open] .cp-knows').innerText()));
await shotSheet('17-build');
await page.fill('#cpAskQ', '3 days, 30 minutes, I want bigger arms, bad knees');
await page.click('dialog[open] [data-act="cpBuildGo"]');
await settle(1500);
const built = await page.locator('dialog[open] .cp-import').innerText();
check('it builds a plan and a model refines it', /Arms first, knees easy/.test(built) && /with the on-device AI/.test(built) && /Arms twice a week/.test(built), built.slice(0, 300));
const gramOk = await S(() => {
  const C = window.GH.customPlan, U = window.GH.ui;
  const ids = [...window.__grammar.split('\n').find((l) => l.startsWith('move ::=')).matchAll(/\\"([a-z0-9_]+)\\"/g)].map((m) => m[1]);
  const S2 = JSON.parse(JSON.stringify(U.S)); S2.profile.careful = ['knee'];
  const ctx = C.context(S2, U.today());
  return { n: ids.length, ok: ids.every((id) => C.check(ctx, id).ok), jump: ids.includes('sq_jump'), days: (window.__grammar.match(/ day /g) || []).length };
});
check('the model could only use moves this person can do, for three days', gramOk.n > 10 && gramOk.ok && !gramOk.jump && gramOk.days === 3, gramOk);
await shotSheet('18-build-plan');
await page.click('dialog[open] [data-act="cpBuildSave"]');
await settle(600);
check('Save keeps it, built by the coach', /Saved to your plans/.test(await page.locator('dialog[open] .cp-saved').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).some((x) => x.source === 'coach' && x.name === 'Arms first, knees easy')));
await page.click('dialog[open] [data-act="cpBuildOpen"]');
await settle(900);
check('Edit it opens it like any plan', await S(() => window.GH.ui.route.view) === 'planEdit' && /Arms first, knees easy/.test(await page.locator('#screen .cp-title').innerText()));
await shot('19-coach-plan');
// A model's answer that breaks the rules is dropped, and the app's own plan stands.
await page.evaluate(() => { window.GH.llm.chat = async () => JSON.stringify({ name: 'Bad', note: '', days: [{ title: 'X', items: [{ move: 'sq_jump', sets: 3, reps: 10 }, { move: 'bench_bb', sets: 3, reps: 10 }] }] }); });
await page.evaluate(() => window.GH.ui.back());
await settle(700);
await page.click('#screen .cp-make [data-act="cpBuild"]');
await settle(700);
await page.fill('#cpAskQ', '3 days, bigger arms, bad knees');
await page.click('dialog[open] [data-act="cpBuildGo"]');
await settle(1500);
const kept = await page.locator('dialog[open] .cp-import').innerText();
check('a model answer with moves they can\'t do is dropped: the coach\'s own plan stands', /3-day plan for bigger arms/.test(kept) && !/Bad/.test(kept) && /Built by the coach\n/.test(kept + '\n'), kept.slice(0, 200));
await closeSheets();

/* ------------------------------------------------------------------ back to the coach */
section('Back to the coach\'s plan');
await page.evaluate(() => window.GH.ui.render());
await settle(500);
await page.click('#screen .cp-inuse [data-act="cpCoach"]');
await settle(700);
check('back to the coach\'s plan', await S(() => window.GH.ui.S.activePlan) === null && /Back to the coach's plan/.test(await toasts()));
check('the Plans page shows the coach\'s plan in use and your plans saved', /The coach's plan/.test(await page.locator('#screen .cp-inuse').innerText()) && await page.locator('#screen .cp-plan').count() === 3);
await shot('20-plans-saved');
await page.evaluate(() => window.GH.ui.go('plan'));
await settle(900);
const w2 = await S(() => { const U = window.GH.ui, w = window.GH.planWeek(U.S, U.today()); return { banner: !!document.querySelector('#screen .cp-banner'), next: w.next.days.filter((d) => d.kind === 'workout').map((d) => d.title) }; });
check('the Plan tab has the coach\'s week again', !w2.banner && w2.next.length === 4 && !w2.next.includes('Upper'), w2);
await page.click('#screen [data-key="mine"] [data-act="openPlans"]');
await settle(800);
await page.click('#screen .cp-plan:nth-child(1) [data-act="cpOpen"]');
await settle(800);
await page.click('#topbar [data-act="cpMenu"]');
await settle(600);
await page.click('dialog[open] [data-act="cpDelete"]');
await settle(600);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((x) => /^Delete$/.test(x.textContent.trim())).click(); });
await settle(900);
check('deleting a plan (with Undo)', await S(() => window.GH.customPlan.list(window.GH.ui.S).length) === 2 && /Plan deleted/.test(await toasts()), await toasts());

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 10).join('\n'));
await browser.close();
await server.close();
console.log(`\nscreenshots in build/ui-customplan/`);
done();
