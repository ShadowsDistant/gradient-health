// The Plan tab in Chromium at phone size, someone five weeks in: the week strip matches the plan,
// picking a day fills the card (a workout with its exercises and stills, a light day, next week),
// moving a workout with the chips (and Undo) and by long press, swiping to next week, the week's
// phase explained, Start for today, Train today instead on a light day, a done day, missed days, and
// no console errors. Screenshots go to build/ui-plan/ for a visual pass.
// Usage: node test/ui-plan.mjs [--dark] [--width=390]
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
const OUT = join(root, 'build/ui-plan');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];

// A fresh app on a given morning, seeded with five weeks of training; `mutate` runs on the saved state
// (in the page) before the app loads it.
async function openApp(time, mutate) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(seedBridge);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  if (mutate) await page.evaluate(mutate);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"]');
  const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 350)); };
  await settle();
  return { ctx, page, settle };
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}${dark ? '-dark' : ''}.png`) });
const shotFull = async (page, name) => {
  // The whole page, scrolled in steps (the screen scrolls, not the window).
  const h = await page.evaluate(() => document.getElementById('screen').scrollHeight);
  for (let y = 0, i = 0; y < h && i < 4; y += 700, i++) {
    await page.evaluate((top) => { document.getElementById('screen').scrollTop = top; }, y);
    await page.waitForTimeout(150);
    await shot(page, `${name}-${i}`);
  }
  await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
};

// What the page shows vs what GH.planWeek says.
const state = (page) => page.evaluate(() => {
  const U = window.GH.ui, w = window.GH.planWeek(U.S, U.today());
  const pages = [...document.querySelectorAll('#screen .pw-page')];
  const cur = pages.find((p) => p.getAttribute('aria-hidden') !== 'true');
  const pills = cur ? [...cur.querySelectorAll('.pw-day')] : [];
  const card = document.querySelector('#screen .pw-card');
  return {
    view: document.getElementById('screen').dataset.view,
    page: Number(document.querySelector('#screen .pw-track').style.getPropertyValue('--page')),
    pills: pills.length,
    kinds: pills.map((li) => li.dataset.kind),
    selected: pills.findIndex((li) => li.querySelector('.pw-pill').getAttribute('aria-selected') === 'true'),
    selIndex: cur ? Number(cur.querySelector('.pw-sel').style.getPropertyValue('--i')) : null,
    today: pills.findIndex((li) => li.hasAttribute('data-today')),
    planKinds: w.days.map((d) => d.kind),
    nextKinds: w.next.days.map((d) => d.kind),
    titles: w.days.map((d) => d.title),
    nextTitles: w.next.days.map((d) => d.title),
    cardKind: card && card.dataset.kind,
    cardTitle: card && (card.querySelector('.pw-title') || {}).textContent,
    cardText: card ? card.textContent.replace(/\s+/g, ' ').trim() : '',
    thumbs: card ? card.querySelectorAll('.pw-thumb[data-move]').length : 0,
    drawn: card ? card.querySelectorAll('.pw-thumb[data-move] > svg').length : 0,
    moves: U.S.events.filter((e) => e.type === 'move').length,
  };
});
const pill = (i, page = 0) => `#screen .pw-page[style*="--n:${page}"] .pw-day:nth-child(${i + 1}) .pw-pill`;
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).join(' | '));

/* ------------------------------------------------------------------ Monday, five weeks in */
section('The week strip (Monday, week 6)');
let { ctx, page, settle } = await openApp('2026-10-19T08:10:00');
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
let s = await state(page);
check('the Plan tab shows seven days', s.view === 'plan' && s.pills === 7, JSON.stringify(s));
check('each day\'s mark matches the plan', JSON.stringify(s.kinds) === JSON.stringify(s.planKinds), `${s.kinds} vs ${s.planKinds}`);
check('Monday is today and picked', s.today === 0 && s.selected === 0 && s.selIndex === 0, JSON.stringify(s));
check('the card shows today\'s workout', s.cardKind === 'today' && s.cardTitle === s.titles[0], `${s.cardKind}: ${s.cardTitle}`);
check('with Start and Move', await page.locator('#screen .pw-card [data-act="planStart"]').count() === 1 && await page.locator('#screen .pw-card [data-act="planMoveOpen"]').count() === 1);
check('each exercise has a still of the move', s.thumbs >= 4 && s.drawn === s.thumbs, `${s.drawn} of ${s.thumbs}`);
const sub = (await page.locator('#screen .pw-sub').innerText()).replace(/\s+/g, ' ');
check('the summary says the week, the phase and what\'s done', /Week 6 · Full volume · 0 of 4 done/.test(sub), sub);
check('the navigation bar has Schedule', await page.locator('#topbar [data-act="daysSheet"]').count() === 1);
check('Coming up lists next week\'s workouts', await page.locator('#screen .pw-cu li').count() === s.nextKinds.filter((k) => k === 'workout').length);
check('Make it yours has days and time and equipment', await page.locator('#screen [data-key="mine"] [data-act="daysSheet"]').count() === 1 && await page.locator('#screen [data-key="mine"] [data-act="planEquipment"]').count() === 1);
check('sets by muscle has a bar for each muscle with a target', await page.locator('#screen .pw-mu').count() >= 5);
await shotFull(page, '01-week');

section('Picking a day');
const hits0 = await page.evaluate(() => window.GH.planWeek.stats.misses);
await page.click(pill(1));
await settle();
s = await state(page);
check('Tuesday is picked and the selection slid there', s.selected === 1 && s.selIndex === 1, JSON.stringify(s));
check('its card shows Tuesday\'s workout', s.cardKind === 'workout' && s.cardTitle === s.titles[1] && /Tomorrow/.test(s.cardText), `${s.cardKind}: ${s.cardTitle}`);
check('with its exercises drawn', s.thumbs >= 4 && s.drawn === s.thumbs, `${s.drawn} of ${s.thumbs}`);
check('no Start on a later day', await page.locator('#screen .pw-card [data-act="planStart"]').count() === 0);
check('picking a day doesn\'t rebuild the plan', (await page.evaluate(() => window.GH.planWeek.stats.misses)) === hits0);
const haptics = await page.evaluate(() => window.__haptics.slice(-3));
check('a tap on a day ticks', haptics.includes('select'), haptics.join());
await page.click(pill(2));
await settle();
s = await state(page);
check('Wednesday is a light day: walk and mobility', s.cardKind === 'light' && /Walk and mobility/.test(s.cardText) && /Mobility flow/.test(s.cardText), s.cardText.slice(0, 120));
check('with the five mobility moves drawn', await page.locator('#screen .pw-mob .pw-thumb > svg').count() === 5);
await shot(page, '02-light');
await page.click('#screen .pw-mob .pw-mob-btn');
await settle(1200);
check('a mobility move opens its how-to', await page.evaluate(() => !!document.querySelector('dialog.rf-sheet[open] .sheet-fig')));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(700);
await page.click(pill(0));
await settle();
const tabStops = await page.evaluate(() => [...document.querySelectorAll('#screen .pw-page[style*="--n:0"] .pw-pill')].filter((b) => b.tabIndex === 0).length);
check('one day per week is in the Tab order', tabStops === 1, tabStops);
await page.focus(pill(0));
await page.keyboard.press('ArrowRight');
await settle();
s = await state(page);
const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.arg);
check('arrow keys move between days, and focus follows', s.selected === 1 && focused === String((await page.evaluate(() => window.GH.planWeek(window.GH.ui.S, window.GH.ui.today()).days[1].day))), JSON.stringify({ sel: s.selected, focused }));
await page.keyboard.press('Home');
await settle();
check('Home goes back to Monday', (await state(page)).selected === 0);
await page.click('#screen .pw-card .pw-ex-row[data-act="planMoveInfo"]');
await settle(1200);
check('an exercise row opens its how-to', await page.evaluate(() => !!document.querySelector('dialog.rf-sheet[open] .sheet-fig')));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(700);

section('Moving a workout');
await page.click(pill(1));
await settle();
await page.click('#screen .pw-card [data-act="planMoveOpen"]');
await settle();
const chips = await page.locator('#screen .pw-move .pw-chip').allInnerTexts();
check('Move offers the free days left this week', chips.join() === 'Wed 21,Sat 24,Sun 25', chips.join());
await shot(page, '03-move');
await page.click('#screen .pw-move .pw-chip >> nth=0');
await settle(900);
s = await state(page);
check('Tuesday\'s workout is now on Wednesday', s.kinds[1] === 'light' && s.kinds[2] === 'workout' && JSON.stringify(s.kinds) === JSON.stringify(s.planKinds), s.kinds.join());
check('and the strip follows it there', s.selected === 2 && s.selIndex === 2 && s.cardKind === 'workout' && /Moved here from Tue/.test(s.cardText), JSON.stringify({ sel: s.selected, text: s.cardText.slice(0, 90) }));
check('a move event was added', s.moves === 1);
let t = await toasts(page);
check('a toast says where it went, with Undo', /Moved to Wed, Oct 21/.test(t) && /Undo/.test(t), t);
await shot(page, '04-moved');
await page.evaluate(() => { const x = [...document.querySelectorAll('.rf-toast')].pop(); x.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
await settle(900);
s = await state(page);
check('Undo puts it back', s.kinds[1] === 'workout' && s.kinds[2] === 'light' && s.moves === 0 && s.selected === 1, s.kinds.join());

section('Long press and drop on a free day');
await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
await settle(300);
const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
let a = await box(pill(4)), b = await box(pill(5));
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.clock.runFor(500);
await page.waitForTimeout(80);
const lifted = await page.evaluate(() => !!document.querySelector('#screen .pw-day[data-lifted]'));
check('a long press on Friday picks it up', lifted);
for (let k = 1; k <= 6; k++) { await page.mouse.move(a.x + (b.x - a.x) * k / 6, a.y); await page.waitForTimeout(16); }
await shot(page, '05-drag');
await page.mouse.up();
await settle(900);
s = await state(page);
check('dropped on Saturday, it moves there', s.kinds[4] === 'light' && s.kinds[5] === 'workout' && s.moves === 1, s.kinds.join());
await page.evaluate(() => { const x = [...document.querySelectorAll('.rf-toast')].pop(); if (x) x.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
await settle(900);
check('and Undo takes it back', (await state(page)).moves === 0);

section('Next week');
await page.click(pill(0));
await settle();
await page.click('#screen [data-act="planWeek"][data-arg="1"]');
await settle(900);
s = await state(page);
check('Next week slides in', s.page === 1 && s.pills === 7 && JSON.stringify(s.kinds) === JSON.stringify(s.nextKinds), JSON.stringify({ page: s.page, kinds: s.kinds }));
check('the same weekday is picked, as a preview', s.selected === 0 && s.cardKind === 'workout' && s.cardTitle === s.nextTitles[0] && await page.locator('#screen .pw-card[data-preview]').count() === 1 && /preview/i.test(s.cardText), s.cardText.slice(0, 100));
check('the header says which week', /Next week/.test(await page.locator('#screen .pw-head').innerText()));
check('a preview can\'t be started or moved', await page.locator('#screen .pw-card [data-act="planStart"], #screen .pw-card [data-act="planMoveOpen"]').count() === 0);
check('this week is out of reach while next week shows', await page.evaluate(() => document.querySelector('#screen .pw-page[style*="--n:0"]').hasAttribute('inert')));
await shot(page, '06-next');
// Swipe back with the finger (a mouse drag here).
a = await box('#screen .pw-viewport');
await page.mouse.move(a.x - 120, a.y);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x - 120 + k * 30, a.y + k); await page.waitForTimeout(16); }
await page.mouse.up();
await settle(900);
s = await state(page);
check('a swipe to the right goes back to this week', s.page === 0 && s.selected === 0, JSON.stringify({ page: s.page, sel: s.selected }));
await page.mouse.move(a.x + 120, a.y);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x + 120 - k * 30, a.y); await page.waitForTimeout(16); }
await page.mouse.up();
await settle(900);
check('and a swipe to the left shows next week', (await state(page)).page === 1);
await page.click('#screen [data-act="planWeek"][data-arg="0"]');
await settle(900);
await page.evaluate(() => { document.querySelector('#screen .pw-cu [data-act="planPick"]').scrollIntoView(); });
await page.click('#screen .pw-cu [data-act="planPick"] >> nth=1');
await settle(1200);
s = await state(page);
check('a row in Coming up opens that day of next week', s.page === 1 && s.selected === 1 && s.cardTitle === s.nextTitles[1], JSON.stringify({ page: s.page, sel: s.selected, title: s.cardTitle }));
const back = await page.waitForFunction(() => document.querySelector('#screen .pw-strip').getBoundingClientRect().top > 0, null, { timeout: 3000 }).then(() => true, () => false);
check('and scrolls the strip back into view', back);

section('What the week means');
await page.click('#screen .pw-info');
await settle(900);
const sheet = await page.evaluate(() => { const d = document.querySelector('dialog.rf-sheet[open]'); return d ? { title: d.querySelector('.rf-sheet-title').textContent, marks: d.querySelectorAll('.pw-key li').length, text: d.textContent } : null; });
check('the info button explains the phase and the marks', sheet && sheet.title === 'Full volume' && sheet.marks === 5 && /deload/.test(sheet.text), JSON.stringify(sheet && { title: sheet.title, marks: sheet.marks }));
await shot(page, '07-info');
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Schedule and the rest of the page');
await page.click('#topbar [data-act="daysSheet"]');
await settle(900);
check('Schedule opens Days and time', await page.evaluate(() => /Days and time/.test((document.querySelector('dialog.rf-sheet[open] .rf-sheet-title') || {}).textContent || '')));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Start today');
await page.click('.rf-tab[data-tab="today"]');
await settle();
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
s = await state(page);
check('coming back to Plan picks today again', s.page === 0 && s.selected === 0);
await page.click('#screen .pw-card [data-act="planStart"]');
await page.waitForSelector('.player:not([hidden]) .pl-name', { timeout: 5000 }).catch(() => {});
const started = await page.evaluate(() => ({ player: !document.querySelector('.player').hidden, active: window.GH.ui.S.active && window.GH.ui.S.active.session.title, today: window.GH.planWeek(window.GH.ui.S, window.GH.ui.today()).days[0].title }));
check('Start opens today\'s workout in the player', started.player && started.active === started.today, JSON.stringify(started));
// Finish it quickly, then look at the done day.
await page.evaluate(() => window.GH.ui.act.plKeep());
await settle(700);
await page.evaluate(() => {
  const GH = window.GH, U = GH.ui, B = GH.brain, S = U.S;
  for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); }
  B.finishWorkout(S, { rating: 'right', now: Date.now() + 25 * 60000 });
  GH.store.save(S);
  U.go('plan');
});
await settle(1200);
s = await state(page);
check('the day is done, with what was done in it', s.kinds[0] === 'done' && s.cardKind === 'done' && /Done/.test(s.cardText) && /sets/.test(s.cardText) && s.drawn >= 4, s.cardText.slice(0, 120));
check('the summary counts it', /1 of 4 done/.test((await page.locator('#screen .pw-sub').innerText()).replace(/\s+/g, ' ')));
await shot(page, '08-done');
await ctx.close();

/* ------------------------------------------------------------------ Wednesday: a light day today */
section('Train today instead (Wednesday, a light day)');
({ ctx, page, settle } = await openApp('2026-10-21T08:10:00'));
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
s = await state(page);
check('today is a light day with the next workout offered', s.cardKind === 'light' && /Train today instead/.test(s.cardText), s.cardText.slice(0, 160));
check('Monday and Tuesday are done', s.kinds[0] === 'done' && s.kinds[1] === 'done');
await shot(page, '09-light-today');
await page.click(pill(3));
await settle();
check('the next workout offers it too', /Train today instead/.test((await state(page)).cardText));
await page.click('#screen .pw-card [data-act="planTrainToday"]');
await settle(900);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((x) => /Train today/.test(x.textContent)).click(); });
await page.waitForSelector('.player:not([hidden]) .pl-name', { timeout: 5000 }).catch(() => {});
const pulled = await page.evaluate(() => ({ player: !document.querySelector('.player').hidden, day: window.GH.ui.S.active && window.GH.ui.S.active.day === window.GH.ui.today(), pulled: !!(window.GH.ui.S.active && window.GH.ui.S.active.pulled) }));
check('after confirming, Thursday\'s workout starts today', pulled.player && pulled.day && pulled.pulled, JSON.stringify(pulled));
await ctx.close();

/* ------------------------------------------------------------------ Wednesday after two missed days */
section('Missed days');
({ ctx, page, settle } = await openApp('2026-10-21T08:10:00', () => {
  const GH = window.GH, B = GH.brain;
  const S = GH.store.load();
  const ws = B.weekStart(B.dayOf(Date.now(), 4));
  S.log = S.log.filter((l) => l.day < ws);
  GH.store.save(S);
}));
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
s = await state(page);
check('Monday used the freeze, Tuesday was missed', s.kinds[0] === 'frozen' && s.kinds[1] === 'missed' && JSON.stringify(s.kinds) === JSON.stringify(s.planKinds), s.kinds.join());
check('and the week moved on: today has a workout', s.cardKind === 'today');
await page.click(pill(0));
await settle();
check('the frozen day says the streak was kept', /streak kept/i.test((await state(page)).cardText));
await shot(page, '10-frozen');
await page.click(pill(1));
await settle();
check('the missed day says what happened', /Missed workout/.test((await state(page)).cardText) && /moved a day/.test((await state(page)).cardText));
await shot(page, '11-missed');
await ctx.close();

/* ------------------------------------------------------------------ a new plan started on a Wednesday, no light days */
section('A first week, rest days');
({ ctx, page, settle } = await openApp('2026-10-21T08:10:00', () => {
  const GH = window.GH, B = GH.brain;
  const day = B.dayOf(Date.now(), 4);
  const S = B.newState({ goals: ['legs', 'abs'], experience: 'never', days: 3, minutes: 20, age: 31, units: 'kg', weightKg: 60, lightDays: false, equipment: { db: [], kb: [], band: true, chair: true, wall: true, towel: true }, name: 'Sam' }, null, day);
  S.seen = { tour: true, checklistHidden: true, lastVersion: GH.VERSION, moveSheet: true };
  GH.store.save(S);
}));
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
s = await state(page);
check('days before the start are marked, rest days replace light days', s.kinds[0] === 'before' && s.kinds[1] === 'before' && s.kinds.includes('rest') && !s.kinds.includes('light'), s.kinds.join());
check('the first week eases in', /Week 1 · Easing in/.test((await page.locator('#screen .pw-sub').innerText()).replace(/\s+/g, ' ')));
const tip = await page.locator('#screen .tip').count();
check('a first visit shows the Plan tip above the week', tip === 1);
await shot(page, '12-first-week');
await page.click(pill(0));
await settle();
check('a day before the start says so', /Before you started/.test((await state(page)).cardText));
const restIdx = (await state(page)).kinds.indexOf('rest');
await page.click(pill(restIdx));
await settle();
check('a rest day says what\'s next', /Rest and recover/.test((await state(page)).cardText) && /Next:/.test((await state(page)).cardText));
await shot(page, '13-rest');
await page.click('#screen .pw-info');
await settle(900);
check('the info sheet explains easing in', await page.evaluate(() => /Easing in/.test(document.querySelector('dialog.rf-sheet[open] .rf-sheet-title').textContent) && /Full volume starts in week/.test(document.querySelector('dialog.rf-sheet[open]').textContent)));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(700);
await ctx.close();

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 6).join(' | '));
await browser.close();
await server.close();
done();
