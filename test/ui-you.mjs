// Where things are (1.6), in Chromium at phone size with someone five weeks in: the tabs for each
// mode (five at most, so they fit a 360 px phone), the You tab and its order, Plan's This week |
// Moves switch, links to places that moved (moves, profile), the ways into Progress, Settings' groups
// and search, one place for each thing, the new names, a tip on every tab, the haptics on the way
// around, and the easy cardio block's length.
// Usage: node test/ui-you.mjs [--dark] [--width=360]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
const server = await serveDist();
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const tabs = () => ev(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => t.dataset.tab).join(','));
const where = () => ev(() => ({ tab: window.GH.ui.route.tab, view: window.GH.ui.route.view, screen: document.getElementById('screen').dataset.view, back: !!document.querySelector('#topbar [data-act="back"]') }));
const go = async (t) => { await ev((x) => window.GH.ui.go(x), t); await settle(); };
const home = async () => { await ev(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* to the tab */ } }); await settle(); };
// What's tracked: workouts on or off, calories on or off (protein otherwise).
const mode = async (workouts, food) => {
  await ev(([w, f]) => { const U = window.GH.ui, S = U.S; S.profile.workouts = w; window.GH.food.setMode(S, f ? 'full' : 'protein'); U.save(); U.render(); }, [workouts, food]);
  await settle();
};

section('The tabs for each mode');
await mode(true, false);
check('workouts: Today, Plan, Health, Progress and You', (await tabs()) === 'today,plan,health,progress,you', await tabs());
await mode(true, true);
check('workouts and calories: Today, Plan, Food, Health and You', (await tabs()) === 'today,plan,food,health,you', await tabs());
await mode(false, true);
check('calories only: Today, Food, Health and You', (await tabs()) === 'today,food,health,you', await tabs());
await mode(false, false);
check('health only: Today, Health and You', (await tabs()) === 'today,health,you', await tabs());
await mode(true, true);
await page.setViewportSize({ width: 360, height: 800 });
await settle();
const fit = await ev(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => { const l = t.querySelector('.rf-tab-label'); const a = t.getBoundingClientRect(), b = l.getBoundingClientRect(); return { id: t.dataset.tab, ok: b.left >= a.left - 0.5 && b.right <= a.right + 0.5 && l.scrollWidth <= l.clientWidth + 1 && a.right <= innerWidth }; }));
check('five tabs fit a 360 px phone, every label whole', fit.length === 5 && fit.every((x) => x.ok), JSON.stringify(fit));
await page.setViewportSize({ width, height: 844 });
await settle();

section('Today');
await go('today');
check('no unlabelled profile button at the top', await ev(() => !document.querySelector('#topbar [data-act="openProfile"]') && !document.querySelector('#screen [data-act="openProfile"]')));
check('the streak card says it opens Progress', await ev(() => { const s = document.querySelector('#screen [data-key="streak"]'); return !!s && s.matches('button[data-act="openProgress"]') && /Progress/.test(s.textContent); }));

section('You, in order');
await go('you');
const order = () => ev(() => {
  const scr = document.getElementById('screen');
  const marks = [['card', '.you-card'], ['progress', '.you-link[data-act="openProgress"]'], ['badges', '.you-badges'], ['plans', 'ul[data-key="plans"]'], ['answers', 'ul[data-key="answers"]'], ['app', 'ul[data-key="app"]']];
  return marks.map(([k, sel]) => { const el = scr.querySelector(sel); return el ? [k, el.getBoundingClientRect().top] : null; }).filter(Boolean).sort((a, b) => a[1] - b[1]).map((x) => x[0]).join();
});
check('with calories on: your card, Progress, badges, your plans, your answers, then the app', (await order()) === 'card,progress,badges,plans,answers,app', await order());
const card = await ev(() => { const c = document.querySelector('#screen .you-card'); return { name: c.querySelector('.you-name').textContent, since: c.querySelector('.you-since').textContent, stats: [...c.querySelectorAll('.you-stat')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()) }; });
check('your card: initials, name, since when and the week', card.name === 'Alex' && /^Training since .+ · week \d+$/.test(card.since), JSON.stringify(card));
check('and workouts, streak and badges in a row', card.stats.length === 3 && /Workouts$/.test(card.stats[0]) && /Day streak$/.test(card.stats[1]) && /Badges?$/.test(card.stats[2]), JSON.stringify(card.stats));
const app = await ev(() => [...document.querySelectorAll('#screen ul[data-key="app"] > li')].map((li) => li.dataset.key).join());
check('last: Settings, Help and tour, What\'s new, Privacy', app === 'settings,help,news,privacy', app);
check('a badge earned shows as earned', await ev(() => !!(document.querySelector('#screen [data-badge="first"].is-earned') || document.querySelector('#screen [data-key="ach-first"].is-earned'))));
check('your answers are each set-up screen, with its answer', await ev(() => { const rows = [...document.querySelectorAll('#screen ul[data-key="answers"] [data-act="editStep"]')]; return rows.length >= 6 && rows.some((r) => r.dataset.arg === 'schedule') && rows.some((r) => r.dataset.arg === 'equipment') && rows.every((r) => r.querySelector('.rf-list-sub').textContent.trim()); }));
const review = async () => ev(() => ({ you: !!document.querySelector('#screen [data-act="reviewPlan"]'), real: !!(window.GH.planReview && window.GH.ui.act.reviewPlan) }));
let rv = await review();
check('Check my plan with AI only when the AI review is in the app', rv.you === rv.real, JSON.stringify(rv));
const stubbed = await ev(() => { const GH = window.GH, U = GH.ui; if (GH.planReview) return false; GH.planReview = { available: () => false, open: () => {} }; U.act.reviewPlan = () => {}; U.render(); return true; });
if (stubbed) {
  await settle();
  check('with it: Check my plan with AI under Your plans', await ev(() => !!document.querySelector('#screen ul[data-key="plans"] [data-act="reviewPlan"]')));
  await go('plan');
  check('and in Plan\'s Make it yours', await ev(() => !!document.querySelector('#screen ul[data-key="mine"] [data-act="reviewPlan"]')));
  await ev(() => { delete window.GH.planReview; delete window.GH.ui.act.reviewPlan; window.GH.ui.render(); });
  await go('you');
}
await mode(true, false);
check('workouts without calories: no Progress card (Progress is a tab)', (await order()) === 'card,badges,plans,answers,app', await order());
await mode(false, false);
const off = await ev(() => ({ plans: !!document.querySelector('#screen ul[data-key="plans"]'), stats: [...document.querySelectorAll('#screen .you-stat .you-l')].map((s) => s.textContent).join(), since: document.querySelector('#screen .you-since').textContent }));
check('workouts off: no plans, and what\'s tracked instead', !off.plans && /^Using Gradient Health since/.test(off.since) && /Weigh-in/.test(off.stats) && /Badge/.test(off.stats), JSON.stringify(off));
await mode(true, true);
await page.click('#screen .you-me');
await page.waitForSelector('dialog.rf-sheet[open] #nameIn');
await settle(500);
await page.fill('#nameIn', 'Sam');
await page.click('dialog.rf-sheet[open] [data-act="nameSave"]');
await settle(900);
check('a tap on your name changes it', await ev(() => document.querySelector('#screen .you-name').textContent === 'Sam' && document.querySelector('#screen .you-avatar').textContent.trim() === 'S'));
await ev(() => { window.GH.ui.S.profile.name = 'Alex'; window.GH.ui.render(); });
await page.click('#screen [data-act="openHelp"]');
await settle(900);
check('Help and tour opens help: the tour, the tips again, the coach', await ev(() => ['helpTour', 'helpTips', 'helpCoach'].every((a) => !!document.querySelector(`dialog.rf-sheet[open] [data-act="${a}"]`))));
await home();

section('Plan: This week | Moves');
await go('plan');
const seg = () => ev(() => { const s = document.querySelector('#screen [data-on="planSection"]'); return s && { values: [...s.querySelectorAll('input')].map((i) => i.value).join(), on: (s.querySelector('input:checked') || {}).value, strip: !!document.querySelector('#screen .pw-strip'), moves: !!document.querySelector('#screen .moves-list') }; });
let sg = await seg();
check('a switch under the title, This week picked', sg && sg.values === 'week,moves' && sg.on === 'week' && sg.strip && !sg.moves, JSON.stringify(sg));
check('the switch is glass', await ev(() => { const s = document.querySelector('#screen [data-on="planSection"]'); return s.matches('.rf-segmented') && !!s.querySelector('.rf-segmented-thumb'); }));
await page.click('#screen [data-on="planSection"] input[value="moves"]', { force: true });
await settle(900);
sg = await seg();
check('Moves shows every ladder, on Plan', sg.on === 'moves' && sg.moves && !sg.strip && (await where()).tab === 'plan' && await ev(() => document.querySelectorAll('#screen .moves-list [data-act="ladder"]').length >= 5), JSON.stringify(sg));
await page.locator('#screen .moves-list [data-act="ladder"]').first().click();
check('a ladder opens its sheet', await page.waitForSelector('dialog.rf-sheet[open] .sheet-fig', { timeout: 5000 }).then(() => true, () => false));
await home();
await go('today');
await go('plan');
sg = await seg();
check('back on Plan from another tab, it opens on This week again', sg.on === 'week' && sg.strip, JSON.stringify(sg));
await page.click('#screen [data-on="planSection"] input[value="moves"]', { force: true });
await settle(900);
await page.click('#screen [data-on="planSection"] input[value="week"]', { force: true });
await settle(900);
check('and the switch goes both ways', (await seg()).strip);
check('Start today\'s workout on today\'s card', await ev(() => /Start today's workout/.test((document.querySelector('#screen [data-act="planStart"]') || {}).textContent || '')));

section('Links to places that moved');
await go('today');
await go('moves');
sg = await seg();
check('go(\'moves\') lands on Plan\'s Moves section', (await where()).tab === 'plan' && sg && sg.on === 'moves' && sg.moves, JSON.stringify(sg));
await go('moves');
check('again, it stays there', (await where()).tab === 'plan' && (await seg()).on === 'moves');
await ev(() => window.GH.ui.planSection('week'));
await go('today');
await ev(() => { location.hash = '#moves'; });
await settle(900);
check('a #moves link does the same', (await where()).tab === 'plan' && (await seg()).on === 'moves', JSON.stringify(await where()));
await ev(() => { location.hash = '#profile'; });
await settle(900);
check('a #profile link opens You', (await where()).tab === 'you' && !(await where()).view, JSON.stringify(await where()));
await go('today');
await ev(() => window.GH.ui.open('profile'));
await settle();
check('so does opening Profile from older code', (await where()).tab === 'you' && !(await where()).view);
await go('today');
await ev(() => window.GH.ui.act.openProfile());
await settle();
check('and openProfile', (await where()).tab === 'you');
await ev(() => window.GH.ui.act.openSettings());
await settle();
check('openSettings opens Settings on top', (await where()).view === 'settings' && (await where()).back);
await home();
await mode(false, false);
await go('moves');
check('with workouts off, the moves open as a page of their own', (await where()).view === 'moves' && (await where()).back && await ev(() => !!document.querySelector('#screen .moves-list')));
await home();
await mode(true, true);
await ev(() => window.GH.ui.planSection('week'));

section('The ways into Progress');
const viaProgress = async (label, run) => {
  await run();
  await settle(900);
  const w = await where();
  check(label, w.view === 'progress' && w.back && await ev(() => document.getElementById('tabbar').hasAttribute('data-away') && !!document.querySelector('#screen .bm-card')), JSON.stringify(w));
  await ev(() => window.GH.ui.back());
  await settle();
};
await go('today');
await viaProgress('with calories on, Today\'s streak opens Progress as a page', () => page.click('#screen [data-key="streak"]'));
check('and Back returns to Today', (await where()).tab === 'today' && !(await where()).view);
await go('you');
await viaProgress('so does You\'s Progress card', () => page.click('#screen .you-link[data-act="openProgress"]'));
await go('plan');
await viaProgress('and Plan\'s muscles card', async () => { await ev(() => document.querySelector('#screen .pw-mus-card [data-act="openProgress"]').scrollIntoView({ block: 'center' })); await settle(300); await page.click('#screen .pw-mus-card [data-act="openProgress"]'); });
await go('today');
await ev(() => { location.hash = '#progress'; });
await settle(900);
check('a #progress link opens it too', (await where()).view === 'progress');
await home();
await go('today');
await mode(true, false);
await page.click('#screen [data-key="streak"]');
await settle(900);
check('without calories, the streak goes to the Progress tab', (await where()).tab === 'progress' && !(await where()).view, JSON.stringify(await where()));
check('with Totals: workouts, streak, sets, time, level-ups and personal bests', await ev(() => { const t = document.querySelector('#screen [data-key="totals"]'); return !!t && ['Workouts', 'Streak', 'Sets done', 'Time trained', 'Level-ups', 'Personal bests'].every((x) => t.textContent.includes(x)); }));
await mode(true, true);

section('Settings: its groups');
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
const groups = () => ev(() => [...document.querySelectorAll('#screen .set-list > .rf-list-header:not([data-sub])')].filter((h) => !h.hidden).map((h) => h.textContent).join(','));
check('in order: your plan, tracking, Health Connect, AI coach, sound and haptics, look, general, your data, about', (await groups()) === 'Your plan,What you track,Health Connect,AI coach,Sound and haptics,Look,General,Your data,About', await groups());
const general = await ev(() => [...document.querySelectorAll('#screen ul[data-group="general"] .rf-list-title')].map((t) => t.textContent).join());
check('General holds units and the start of the day', general === 'Units,Start of the day', general);
check('Sound and Vibration lead Sound and haptics', await ev(() => [...document.querySelectorAll('#screen ul[data-group="feel"] .rf-list-title')].slice(0, 2).map((t) => t.textContent).join() === 'Sound,Vibration'));
check('the rest setting says what auto does, 2.5 min on a strength plan', await ev(() => /2\.5 min after the main lifts/.test(document.querySelector('#screen [data-on="setRest"]').closest('li').textContent)));
check('Retake the level check (the baseline test before)', await ev(() => /Retake the level check/.test(document.querySelector('#screen [data-act="baselineSheet"]').textContent)));
await page.click('#screen [data-on="setRollHour"] input[value="2"]', { force: true });
await settle(900);
check('the day can start at 2 am', await ev(() => window.GH.ui.S.profile.prefs.rollHour === 2 && window.GH.ui.rollHour() === 2));
await page.click('#screen [data-on="setRollHour"] input[value="4"]', { force: true });
await settle(900);
await ev(() => window.GH.ui.act.keySheet());
await settle(700);
check('the API key sheet: encrypted on this phone', await ev(() => document.querySelector('dialog.rf-sheet[open] .rf-field-hint').textContent === 'Encrypted on this phone, never in backups, never shown again.'));
await ev(() => window.GH.ui.closeSheets());
await settle(900);

section('Settings: search');
const shown = () => ev(() => ({
  groups: [...document.querySelectorAll('#screen .set-list > .rf-list-header:not([data-sub])')].filter((h) => !h.hidden && h.offsetParent).map((h) => h.dataset.group).join(),
  rows: [...document.querySelectorAll('#screen .set-list ul.rf-list > *')].filter((r) => !r.hidden && r.offsetParent && !r.closest('[hidden]')).map((r) => (r.querySelector('.rf-list-title') || r).textContent.trim()),
  none: !document.querySelector('#screen .set-none').hidden,
}));
await ev(() => { window.__setList = document.querySelector('#screen .set-list'); window.__sw = document.querySelector('#screen [data-k="supersets"]'); });
const search = async (q) => {
  await page.click('#setQ');
  await page.fill('#setQ', '');
  await page.keyboard.type(q, { delay: 15 });
  await settle(300);
  return shown();
};
let r = await search('vibration');
check('"vibration": Sound and haptics', r.groups === 'feel' && r.rows.includes('Vibration'), JSON.stringify(r));
r = await search('dark mode');
check('"dark mode": the theme, under Look', r.groups === 'look' && r.rows.includes('Theme'), JSON.stringify(r));
r = await search('kg');
check('"kg": units, under General, and nothing else', r.groups === 'general' && r.rows.join() === 'Units', JSON.stringify(r));
r = await search('API key');
check('"API key": the AI coach first', r.groups.split(',')[0] === 'coach' && r.rows[0] === 'Who answers your questions', JSON.stringify(r));
r = await search('backup');
check('"backup": your data', r.groups === 'data' && r.rows.includes('Copy my data') && r.rows.includes('Restore from a copy'), JSON.stringify(r));
r = await search('rest');
check('"rest": rest between sets', r.rows.includes('Rest between sets'), JSON.stringify(r));
r = await search('zzzz');
check('nothing found says so', r.none && !r.groups && !r.rows.length, JSON.stringify(r));
check('typing doesn\'t re-render: the same nodes, still in the field', await ev(() => document.querySelector('#screen .set-list') === window.__setList && window.__sw.isConnected && document.activeElement === document.getElementById('setQ')));
await page.click('#screen .set-search .rf-search-clear');
await settle(300);
r = await shown();
check('clearing it brings every group back', r.groups === 'plan,track,hc,coach,feel,look,general,data,about' && !r.none, JSON.stringify(r.groups));
await search('supersets');
await ev(() => document.querySelector('#screen [data-k="supersets"]').click());
await settle(900);
r = await shown();
check('a switch flipped mid-search keeps the search', r.groups === 'plan' && r.rows[0] === 'Supersets' && await ev(() => document.getElementById('setQ').value === 'supersets' && window.GH.ui.S.profile.prefs.supersets === false), JSON.stringify(r));
await ev(() => document.querySelector('#screen [data-k="supersets"]').click());
await settle(900);
await home();
await page.click('#screen [data-act="openSettings"]');
await settle(900);
check('a new visit starts with an empty search', await ev(() => document.getElementById('setQ').value === '' && document.querySelectorAll('#screen .set-list > .rf-list-header:not([data-sub]):not([hidden])').length === 9));
await home();

section('One place for each');
const acts = (sel) => ev((s) => [...document.querySelectorAll(s)].map((b) => b.dataset.act), sel);
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
let a = await acts('#screen [data-act]');
check('Settings has no Days and time, Equipment, Your plans, What\'s new or Privacy', !['daysSheet', 'editEquipment', 'planEquipment', 'openPlans', 'openWhatsNew', 'openPrivacyView', 'openMoves'].some((x) => a.includes(x)), a.join());
check('How it works lives in Settings, under About', await ev(() => !!document.querySelector('#screen ul[data-group="about"] [data-act="openScience"]')));
await home();
a = await acts('#screen [data-act]');
check('You: no Days and time, Equipment or How it works of its own (they\'re in Your answers and Settings)', !['daysSheet', 'editEquipment', 'planEquipment', 'openScience', 'openMoves'].some((x) => a.includes(x)), a.join());
check('What\'s new and Privacy once each, on You', a.filter((x) => x === 'openWhatsNew').length === 1 && a.filter((x) => x === 'openPrivacyView').length === 1);
await go('plan');
a = await acts('#screen [data-act]');
check('Plan: Days and time only behind Schedule, at the top', !a.includes('daysSheet') && await ev(() => document.querySelectorAll('#topbar [data-act="daysSheet"]').length === 1), a.join());
check('Plan: Equipment in Make it yours, and no separate All moves', a.includes('planEquipment') && !a.includes('openMoves'), a.join());
await go('today');
check('Today: no way to Profile but the tab', !(await acts('#screen [data-act], #topbar [data-act]')).includes('openProfile'));

section('Names');
await ev(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open]');
await settle(700);
check('the sparkle opens "Ask the coach"', await ev(() => /Ask the coach/.test(document.querySelector('dialog.chat-sheet[open] .rf-sheet-title').textContent) && document.querySelector('#topbar .coach-btn').getAttribute('aria-label') === 'Ask the coach'));
await ev(() => window.GH.ui.closeSheets());
await settle(900);
await ev(() => window.GH.ui.open('coach'));
await settle();
check('the coach\'s page is "Coach notes"', await ev(() => document.querySelector('#topbar .rf-navbar-title').textContent === 'Coach notes' && document.querySelector('#screen .rf-large-title').textContent === 'Coach notes'));
await home();
await go('health');
check('Health\'s + menu: Other exercise', await ev(() => document.querySelector('#hlLog [data-act="logActivity"]').textContent.trim() === 'Other exercise'));
check('and GPS: Record a walk, run or ride', await ev(() => /Record a walk, run or ride/.test((document.querySelector('#screen [data-key="act-start"]') || {}).textContent || '')));
await ev(() => window.GH.ui.act.logActivity());
await settle(700);
check('logging it: Log other exercise', await ev(() => document.querySelector('dialog.rf-sheet[open] .rf-sheet-title').textContent === 'Log other exercise'));
await home();

section('A tip on every tab');
await ev(() => { const s = window.GH.ui.S.seen; for (const k of Object.keys(s)) if (k.startsWith('tip_')) delete s[k]; window.GH.ui.save(); });
for (const [t, id] of [['today', 'today'], ['plan', 'plan'], ['food', 'food'], ['health', 'health'], ['you', 'you']]) {
  await go(t);
  check(`${t}`, await ev((x) => !!document.querySelector(`#screen [data-key="tip-${x}"]`), id));
}
await go('moves');
check('Plan\'s Moves', await ev(() => !!document.querySelector('#screen [data-key="tip-moves"]')));
await ev(() => window.GH.ui.planSection('week'));
await go('today');
await ev(() => window.GH.ui.go('progress'));
await settle();
check('progress', await ev(() => !!document.querySelector('#screen [data-key="tip-progress"]')));
await home();
await go('you');
await page.click('#screen [data-act="tipDone"][data-arg="you"]');
await settle(900);
check('Got it puts it away', await ev(() => !document.querySelector('#screen [data-key="tip-you"]') && window.GH.ui.seen('tip_you')));
await page.click('#screen [data-act="openHelp"]');
await settle(900);
await page.click('dialog.rf-sheet[open] [data-act="helpTips"]');
await settle(900);
check('Help, Show the tips again brings them back', await ev(() => !!document.querySelector('#screen [data-key="tip-you"]') && !window.GH.ui.seen('tip_you')));

section('Haptics on the way around');
await home();
await go('today');
// What the app asked for (the haptics work maps the kinds to the phone; until then a new kind plays as
// a tap there).
await ev(() => { const U = window.GH.ui, play = U.haptic; window.__felt = []; U.haptic = (k, o) => { window.__felt.push(k); return play(k, o); }; });
const felt = async (fn) => { await ev(() => { window.__felt.length = 0; }); await fn(); await settle(300); return ev(() => window.__felt.slice()); };
check('a tab change: tab', (await felt(() => go('plan'))).includes('tab'));
check('a page opening: nav', (await felt(() => ev(() => window.GH.ui.open('settings')))).includes('nav'));
check('Back: back', (await felt(() => ev(() => window.GH.ui.back()))).includes('back'));
const andBack = await felt(() => ev(() => window.__gh.back()));
check('Android\'s Back to Today: back', andBack.includes('back') && (await where()).tab === 'today', JSON.stringify(andBack));

section('The easy cardio block');
await ev(() => {
  const B = window.GH.brain;
  window.__build = B.buildSession;
  B.buildSession = (...args) => { const s = window.__build(...args); return Object.assign({}, s, { mobility: (s.mobility || []).filter((m) => !m.cardio).concat({ kind: 'mobility', moveId: 'fin_march_easy', name: 'Easy march', timed: true, target: 1800, uni: false, cardio: true }) }); };
  window.GH.planWeek.clear();
  window.GH.ui.render();
});
await settle();
check('Today: Easy cardio · 30 min (not 1800 s)', await ev(() => { const t = document.querySelector('#screen .session').textContent; return /Easy march/.test(t) && /Easy cardio · 30 min/.test(t) && !/1800 s/.test(t); }));
await go('plan');
check('Plan\'s day card too', await ev(() => { const c = document.querySelector('#screen .pw-card'); return !!c && /Easy cardio · 30 min/.test(c.textContent) && !/1800 s/.test(c.textContent); }));
await ev(() => { window.GH.brain.buildSession = window.__build; window.GH.planWeek.clear(); window.GH.ui.render(); });

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
done();
