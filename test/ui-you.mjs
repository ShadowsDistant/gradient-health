// Where things are (1.6), in Chromium at phone size with someone five weeks in: the tabs for each
// mode (five at most, so they fit a 360 px phone; food never takes one, since 1.12 it's in Health),
// the You tab and its order, Plan's This week |
// Moves switch, links to places that moved (moves, profile), the ways into Progress, Settings (its
// short top page and what each part's line says, a page for each part, the rows of a kind looking the
// same, the search across every page and a result opening its page at the row, the links into a page
// and where Back goes), the Refract credit, one place for each thing, the new names, a tip on every
// tab, the haptics on the way around, and the easy cardio block's length.
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
// The badge medals on You are drawn in 3D once each, in the app's quiet moments. In software GL on a
// busy machine each takes seconds of the page's time, and a tap on You that met one ran past its
// timeout (in the suite before 1.14 too). They're let finish once, early (two minutes at most), so
// the taps on You after that don't meet them.
const medalsDrawn = async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await ev(() => { const M = window.GH.ui.medals; return !M || M.off || (M.kept.size > 0 && !M.want.size); })) return;
    await page.waitForTimeout(1000);
  }
};
// What's tracked: workouts on or off, calories on or off (protein otherwise).
const mode = async (workouts, food) => {
  await ev(([w, f]) => { const U = window.GH.ui, S = U.S; S.profile.workouts = w; window.GH.food.setMode(S, f ? 'full' : 'protein'); U.save(); U.render(); }, [workouts, food]);
  await settle();
};

section('The tabs for each mode');
await mode(true, false);
check('workouts: Today, Plan, Health, Progress and You', (await tabs()) === 'today,plan,health,progress,you', await tabs());
await mode(true, true);
check('workouts and calories: the same (food is in Health)', (await tabs()) === 'today,plan,health,progress,you', await tabs());
await mode(false, true);
check('calories only: Today, Health and You', (await tabs()) === 'today,health,you', await tabs());
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
check('with calories on: your card, badges, your plans, your answers, then the app (Progress is a tab)', (await order()) === 'card,badges,plans,answers,app', await order());
const card = await ev(() => { const c = document.querySelector('#screen .you-card'); return { name: c.querySelector('.you-name').textContent, since: c.querySelector('.you-since').textContent, stats: [...c.querySelectorAll('.you-stat')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()) }; });
check('your card: initials, name, since when and the week', card.name === 'Alex' && /^Training since .+ · week \d+$/.test(card.since), JSON.stringify(card));
check('and workouts, streak and badges in a row', card.stats.length === 3 && /Workouts$/.test(card.stats[0]) && /Day streak$/.test(card.stats[1]) && /Badges?$/.test(card.stats[2]), JSON.stringify(card.stats));
const app = await ev(() => [...document.querySelectorAll('#screen ul[data-key="app"] > li')].map((li) => li.dataset.key).join());
check('last: Settings, Help and tour, What\'s new, Privacy', app === 'settings,help,news,privacy', app);
// The strip shows the latest badges earned (the first workout's may be older than those), and the
// gallery behind it shows them all.
check('a badge earned shows as earned', await ev(() => !!document.querySelector('#screen .you-badges [data-badge].is-earned')));
await ev(() => window.GH.ui.open('badges'));
await settle();
check('and the first workout\'s badge is earned in the gallery', await ev(() => !!document.querySelector('#screen [data-badge="first"].is-earned')));
await ev(() => window.GH.ui.back());
await settle();
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
await medalsDrawn();

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
await page.click('#screen [data-act="setPage"][data-arg="look"]');
await settle();
// Glass effects (Appearance): Auto (the default: Liquid at rest, light while the page moves, core.js), Liquid
// as designed, Frosted (the blur without the lenses, the glow kept), Flat (no backdrop drawn
// anywhere, the glow hidden); and the scroll diagnostics row (About) with its report.
const glassFx = await ev(() => Array.from(document.querySelectorAll('#screen [data-key="glass-fx"] .rf-segment'), (b) => b.textContent.trim()));
check('Look has Glass effects: Auto, Liquid, Frosted, Flat', JSON.stringify(glassFx) === JSON.stringify(['Auto', 'Liquid', 'Frosted', 'Flat']), glassFx);
check('Auto is picked by default', await ev(() => { const on = document.querySelector('#screen [data-key="glass-fx"] input[type="radio"]:checked'); return !!on && on.value === 'auto'; }));
const glassState = () => ev(() => {
  const root = document.documentElement, lens = document.querySelector('#tabbar .rf-tabbar-bar .rf-lens-layer, #tabbar .rf-glass > .rf-lens-layer');
  const glow = getComputedStyle(document.querySelector('.app'), '::before').display;
  return { pref: window.GH.ui.S.profile.prefs.glass || 'auto', mode: root.getAttribute('data-glass'), reduced: root.getAttribute('data-rf-transparency'), lite: root.hasAttribute('data-glass-lite'), lensShown: lens ? getComputedStyle(lens).display !== 'none' : false, lensFilter: lens ? getComputedStyle(lens).backdropFilter : 'none', glow };
});
// The modes' looks are read where the tab bar is (Today); Settings, a pushed page, takes it away.
await home();
await go('today');
let gs = await glassState();
check('Auto at rest: the lens shows, no reduced transparency, the glow is there', gs.mode === 'auto' && !gs.lite && gs.reduced === null && gs.lensShown && /url\(/.test(gs.lensFilter) && gs.glow !== 'none', gs);
await ev(() => window.GH.ui.on.setGlass(null, null, 'flat'));
await settle(900);
gs = await glassState();
check('Flat: lite, reduced transparency, no lens, no glow', gs.pref === 'flat' && gs.mode === 'flat' && gs.lite && gs.reduced === 'reduced' && !gs.lensShown && gs.glow === 'none', gs);
await ev(() => window.GH.ui.on.setGlass(null, null, 'frosted'));
await settle(900);
gs = await glassState();
check('Frosted: the blur without the lenses, not lite, the glow kept', gs.pref === 'frosted' && gs.mode === 'frosted' && !gs.lite && gs.reduced === null && !gs.lensShown && gs.glow !== 'none', gs);
await ev(() => window.GH.ui.on.setGlass(null, null, 'liquid'));
await settle(900);
gs = await glassState();
check('Liquid: as designed', gs.pref === 'liquid' && gs.mode === 'liquid' && !gs.lite && gs.reduced === null && gs.lensShown && gs.glow !== 'none', gs);
await ev(() => window.GH.ui.on.setGlass(null, null, 'auto'));
await settle(900);
gs = await glassState();
check('and back to Auto', gs.pref === 'auto' && gs.mode === 'auto' && !gs.lite && gs.lensShown, gs);
await ev(() => window.GH.ui.open('settings', 'about'));
await settle();
check('About has a Scroll diagnostics row', await ev(() => !!document.querySelector('#screen [data-key="diag"] [data-act="scrollDiag"]')));
await ev(() => window.GH.ui.act.scrollDiag());
await settle();
const diag = await ev(() => { const t = document.querySelector('.gh-sheet textarea'); return { open: !!t, text: t ? t.value : '', copy: !!document.querySelector('.gh-sheet [data-act="diagCopy"]'), share: !!document.querySelector('.gh-sheet [data-act="diagShare"]') }; });
check('and the Glass speed test row', await ev(() => !!document.querySelector('.gh-sheet [data-act="diagSpeed"]')));
check('its sheet carries the report, with Copy and Share', diag.open && diag.copy && diag.share && /scroll diagnostics/.test(diag.text) && /Device: /.test(diag.text) && /Settings: glass auto/.test(diag.text) && /Gestures, newest first/.test(diag.text), diag.text.slice(0, 300));
check('and the Record what the phone does row; no recording yet', await ev(() => !!document.querySelector('.gh-sheet [data-act="diagRecord"]')) && /What the phone did \(a recording\): none yet/.test(diag.text));
// A recording, with a stand-in for the Android side (Diagnostics.java): its frame timings, the
// display, and a small trace that it hands back in pieces and deletes once read.
const rec = await ev(async () => {
  const B = window.AndroidBridge;
  const evs = [
    { ph: 'M', name: 'thread_name', pid: 1, tid: 2, args: { name: 'Compositor' } },
    { ph: 'b', name: 'EventLatency', pid: 1, tid: 2, ts: 1000, id2: { local: '0x1' }, args: { event_latency: { event_type: 'GESTURE_SCROLL_UPDATE', vsync_interval_ms: 8.333 } } },
    { ph: 'b', name: 'GenerationToBrowserMain', pid: 1, tid: 2, ts: 1000, id2: { local: '0x1' }, args: {} },
    { ph: 'e', name: 'GenerationToBrowserMain', pid: 1, tid: 2, ts: 31000, id2: { local: '0x1' } },
    { ph: 'e', name: 'EventLatency', pid: 1, tid: 2, ts: 41000, id2: { local: '0x1' } },
    { ph: 'b', name: 'PipelineReporter', pid: 1, tid: 2, ts: 50000, id2: { local: '0x2' }, args: { frame_reporter: { state: 'STATE_DROPPED', scroll_state: 'SCROLL_COMPOSITOR_THREAD' } } },
    { ph: 'e', name: 'PipelineReporter', pid: 1, tid: 2, ts: 66000, id2: { local: '0x2' } },
    { ph: 'X', name: 'ProxyImpl::ScheduledActionDraw', pid: 1, tid: 2, ts: 70000, dur: 20000 },
  ];
  const trace = JSON.stringify({ traceEvents: evs });
  let pos = 0;
  const added = {
    diagFrames: () => JSON.stringify({ frameMetrics: true, frames: 90, overDeadline: 3, overDeadlineByHalf: 1, total: [6.1, 9.8, 22], gpu: [2, 4, 9], waitUi: [0.2, 1, 12], command: [3, 5, 8], touches: 40, moves: 36, touchLate: [4, 9, 30] }),
    diagDisplay: () => JSON.stringify({ hz: 120, modes: [60, 120], sdk: 36 }),
    traceStart: () => true,
    traceStop: () => { setTimeout(() => window.__gh.onTraceSaved(trace.length), 50); return true; },
    traceRead: () => { if (pos >= trace.length) return null; const c = trace.slice(pos, pos + 97); pos += 97; return c; },
    traceDone: () => { B.__done = (B.__done || 0) + 1; },
  };
  Object.assign(B, added);
  let out;
  try {
    const t = await window.GH.diag.record(1);
    out = { ok: !!t, read: pos >= trace.length, done: B.__done || 0, report: window.GH.diag.report() };
  } finally { for (const k of Object.keys(added)) delete B[k]; delete B.__done; }
  return out;
});
check('a recording reads the trace back in pieces and deletes it after', rec.ok && rec.read && rec.done >= 1, { ok: rec.ok, read: rec.read, done: rec.done });
check('the report carries it: the display, Android\'s frames and touches, and the trace summed up', /Display: 120 Hz now \(it can run at 60, 120\)/.test(rec.report) && /What the phone did, recorded [^\n]* with glass auto/.test(rec.report) && /Android drew 90 frames, 3 late \(1 by half a frame or more\)/.test(rec.report) && /touches reached the app 4\/9\/30 ms late/.test(rec.report) && /screen 120 Hz/.test(rec.report) && /drag: 1 updates, finger to screen 40\/40\/40 ms/.test(rec.report) && /Android UI thread 30\/30\/30/.test(rec.report) && /frames while scrolling: 1, dropped 1/.test(rec.report), rec.report.split('Gestures')[0] + rec.report.slice(rec.report.indexOf('What the phone did')));
check('without the Android side, Record says why', await ev(async () => { try { await window.GH.diag.record(1); return false; } catch (e) { return /Android app/.test(e.message); } }));
await ev(() => window.GH.ui.closeSheets && window.GH.ui.closeSheets());
await settle();
await home();
await mode(false, false);
await go('moves');
check('with workouts off, the moves open as a page of their own', (await where()).view === 'moves' && (await where()).back && await ev(() => !!document.querySelector('#screen .moves-list')));
await home();
await mode(true, true);
await ev(() => window.GH.ui.planSection('week'));

section('The ways into Progress');
// With calories on or off it's a tab: each way in goes to it.
const viaProgress = async (label, run) => {
  await run();
  await settle(900);
  const w = await where();
  check(label, w.tab === 'progress' && !w.view && !w.back && await ev(() => !document.getElementById('tabbar').hasAttribute('data-away') && !!document.querySelector('#screen .bm-card')), JSON.stringify(w));
};
await go('today');
await viaProgress('with calories on, Today\'s streak goes to the Progress tab', () => page.click('#screen [data-key="streak"]'));
await go('plan');
await viaProgress('so does Plan\'s muscles card', async () => { await ev(() => document.querySelector('#screen .pw-mus-card [data-act="openProgress"]').scrollIntoView({ block: 'center' })); await settle(300); await page.click('#screen .pw-mus-card [data-act="openProgress"]'); });
await go('today');
await viaProgress('and a #progress link', () => ev(() => { location.hash = '#progress'; }));
await ev(() => { history.replaceState(null, '', location.pathname); });
await go('you');
check('You has no Progress card any more', await ev(() => !document.querySelector('#screen [data-act="openProgress"]')));
await home();
await go('today');
await mode(true, false);
await page.click('#screen [data-key="streak"]');
await settle(900);
check('without calories, the streak goes to the Progress tab', (await where()).tab === 'progress' && !(await where()).view, JSON.stringify(await where()));
check('with Totals: workouts, streak, sets, time, level-ups and personal bests', await ev(() => { const t = document.querySelector('#screen [data-key="totals"]'); return !!t && ['Workouts', 'Streak', 'Sets done', 'Time trained', 'Level-ups', 'Personal bests'].every((x) => t.textContent.includes(x)); }));
await mode(true, true);

section('Settings: a short top page');
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
// Each part's row on the top page: the page it opens, its name, its line, its icon and chevron.
const parts = () => ev(() => [...document.querySelectorAll('#screen .set-home > ul.rf-list')].map((ul) => [...ul.children].map((li) => {
  const b = li.querySelector('[data-act]');
  return { id: b && b.dataset.arg, act: b && b.dataset.act, title: li.querySelector('.rf-list-title').textContent, line: (li.querySelector('.rf-list-sub') || {}).textContent || '', icon: !!li.querySelector('.rf-list-icon svg'), chevron: !!li.querySelector('.rf-list-chevron') };
})));
const lines = async () => Object.fromEntries((await parts()).flat().map((x) => [x.id, x.line]));
let tops = await parts();
check('three groups: what you train and track, how the app behaves, and the app itself', JSON.stringify(tops.map((g) => g.map((x) => x.id))) === JSON.stringify([['workouts', 'track', 'hc'], ['notify', 'coach', 'feel', 'look', 'general'], ['data', 'about']]), tops.map((g) => g.map((x) => x.id).join()).join(' | '));
check('named Workouts, Tracking, Health Connect, Notifications, AI coach, Sound and haptics, Appearance, General, Your data, About', tops.flat().map((x) => x.title).join() === 'Workouts,Tracking,Health Connect,Notifications,AI coach,Sound and haptics,Appearance,General,Your data,About', tops.flat().map((x) => x.title).join());
check('each a row with its icon, its name, a line on what\'s set and a chevron, that opens its page', tops.flat().every((x) => x.act === 'setPage' && x.icon && x.chevron && x.title && x.line), JSON.stringify(tops.flat().filter((x) => !(x.act === 'setPage' && x.icon && x.chevron && x.title && x.line))));
let line = await lines();
check('the lines: days and time, what\'s tracked, Health Connect syncing, notifications off', line.workouts === '4 days a week · 25 min' && line.track === 'Workouts and calories' && line.hc === 'On · syncs every 15 minutes' && line.notify === 'Off', line);
check('and the coach, sound and haptics, the look, units and the day, your data and the version', line.coach === 'On-device' && line.feel === 'Sound on · Haptics medium' && line.look === 'System theme · Auto glass' && line.general === 'lb, ft, in · Day starts at 4 am' && line.data === 'Copy, restore or reset' && line.about === `Version ${await ev(() => window.GH.VERSION)}`, line);
check('the top page is short: every part on one screen with the search', await ev(() => { const s = document.getElementById('screen'); return s.scrollHeight <= s.clientHeight + 120; }), await ev(() => [document.getElementById('screen').scrollHeight, document.getElementById('screen').clientHeight]));
// What's set changes the lines: a new look picked on its page, and settings changed elsewhere.
await page.click('#screen [data-act="setPage"][data-arg="look"]');
await settle(900);
await page.click('#screen [data-on="setTheme"] input[value="dark"]', { force: true });
await settle(900);
await page.click('#screen [data-on="setGlass"] input[value="liquid"]', { force: true });
await settle(900);
await page.click('#topbar [data-act="back"]');
await settle(900);
line = await lines();
check('a look picked on its page shows on the top page: "Dark theme · Liquid glass"', line.look === 'Dark theme · Liquid glass', line.look);
await ev(() => { const U = window.GH.ui, S = U.S, n = S.profile.prefs.notify; U.on.setTheme(null, null, 'system'); U.on.setGlass(null, null, 'auto'); n.on = true; n.time = 18 * 60; S.profile.prefs.rest = 90; S.profile.prefs.supersets = false; S.profile.prefs.sound = false; S.profile.prefs.hapticStrength = 'strong'; S.profile.units = 'kg'; S.profile.prefs.rollHour = 0; S.ai.mode = 'api'; U.render(); });
await settle(900);
line = await lines();
check('rest and supersets, the reminder time, sound and haptics, units and the day, Claude without a key', line.workouts === '4 days a week · 25 min · 90 s rest · no supersets' && line.notify === 'Workout reminders at 6:00 pm' && line.feel === 'Sound off · Haptics strong' && line.general === 'kg, cm · Day starts at midnight' && line.coach === 'Claude · add your API key', line);
await ev(() => { const U = window.GH.ui, S = U.S, n = S.profile.prefs.notify; n.on = false; n.time = null; S.profile.prefs.rest = 'auto'; S.profile.prefs.supersets = true; S.profile.prefs.sound = true; S.profile.prefs.hapticStrength = 'medium'; S.profile.units = 'lb'; S.profile.prefs.rollHour = 4; S.ai.mode = 'device'; U.render(); });
await settle(900);
// With workouts off, Your answers (age, weight and height) takes Workouts' place.
await mode(false, true);
await ev(() => window.GH.ui.render());
await settle(600);
tops = await parts();
check('with workouts off: Your answers in Workouts\' place, opening its sheet', tops[0].map((x) => x.id || x.act).join() === 'editAnswers,track,hc' && tops[0][0].title === 'Your answers' && tops[0][0].line === 'Age, weight, height and more', JSON.stringify(tops[0]));
await mode(true, true);
await ev(() => window.GH.ui.render());
await settle(600);

section('Settings: a page for each part');
const NAMES = { workouts: 'Workouts', track: 'Tracking', hc: 'Health Connect', notify: 'Notifications', coach: 'AI coach', feel: 'Sound and haptics', look: 'Appearance', general: 'General', data: 'Your data', about: 'About' };
const pageNow = () => ev(() => {
  const s = document.getElementById('screen'), p = s.querySelector('.set-page');
  return { view: window.GH.ui.route.view, arg: window.GH.ui.route.arg, page: p ? p.dataset.page : null, title: (s.querySelector('.rf-large-title') || {}).textContent, bar: (document.querySelector('#topbar .rf-navbar-title') || {}).textContent, rows: p ? p.querySelectorAll('.rf-list > *').length : 0, back: !!document.querySelector('#topbar [data-act="back"]'), search: !!s.querySelector('#setQ') };
});
const opened = [], backed = [];
for (const [id, name] of Object.entries(NAMES)) {
  // A push moves the old page into a layer beside the screen for as long as it slides away
  // (.screen-exit). It's watched for: on a busy machine it can be gone by the time the click returns.
  await ev(() => {
    window.__haptics.length = 0;
    window.__exited = false;
    const seen = (recs) => { if (recs.some((r) => [...r.addedNodes].some((n) => n.classList && n.classList.contains('screen-exit')))) window.__exited = true; };
    const watch = new MutationObserver(seen);
    watch.observe(document.getElementById('screen').parentNode, { childList: true });
    window.__exitDone = () => { seen(watch.takeRecords()); watch.disconnect(); return window.__exited; };
  });
  await page.click(`#screen [data-act="setPage"][data-arg="${id}"]`);
  const pushed = await ev(() => window.__exitDone() && window.__haptics.includes('nav'));
  await settle(900);
  const w = await pageNow();
  if (!(pushed && w.view === 'settings' && w.arg === id && w.page === id && w.title === name && w.bar === name && w.rows > 0 && w.back && !w.search)) opened.push({ id, pushed, w });
  await page.click('#topbar [data-act="back"]');
  await settle(900);
  const t = await pageNow();
  if (!(t.view === 'settings' && !t.arg && t.title === 'Settings' && t.search)) backed.push({ id, t });
}
check('each part opens its page: it pushes in with the page haptic, its title large and in the bar, its rows, Back and no search', !opened.length, opened);
check('Back from each returns to the top page', !backed.length, backed);
await page.click('#screen [data-act="setPage"][data-arg="track"]');
await settle(900);
await ev(() => { document.getElementById('screen').scrollTop = 400; });
await settle(600);
check('a page\'s large title collapses into the bar as it scrolls, as on every page', await ev(() => document.getElementById('topbar').hasAttribute('data-scrolled') && document.querySelector('#topbar .rf-navbar-title').textContent === 'Tracking'));
await ev(() => window.__gh.back());
await settle(900);
check('Android\'s Back returns to the top page too', (await pageNow()).title === 'Settings' && (await where()).view === 'settings');
// Rows of a kind look the same on every page (all of them on one): a list of controls has no icon
// tiles and its titles share an inset, a list of places to go has an icon on each row, and every
// row but a list's last has a hairline under it.
await ev(() => window.GH.ui.open('settings', 'all'));
await settle(1200);
const kinds = await ev(() => {
  const bad = [];
  const lists = [...document.querySelectorAll('#screen .set-page ul.rf-list')];
  for (const ul of lists) {
    const rows = [...ul.children].filter((r) => r.offsetParent);
    const where = `${ul.dataset.group} ${(rows[0] && rows[0].dataset.key) || ''}`;
    const lefts = new Set(rows.filter((r) => r.dataset.key !== 'figlook').map((r) => r.querySelector('.rf-list-title')).filter(Boolean).map((t) => Math.round(t.getBoundingClientRect().left)));
    if (lefts.size > 1) bad.push(`titles at ${[...lefts]} in ${where}`);
    if (ul.classList.contains('set-form')) { if (rows.some((r) => [...r.querySelectorAll('.rf-list-icon')].some((i) => i.getBoundingClientRect().width > 0))) bad.push(`an icon in a list of controls: ${where}`); } else if (ul.classList.contains('set-menu')) { if (rows.some((r) => !r.querySelector('.rf-list-icon, .rf-list-lead'))) bad.push(`a row without an icon in ${where}`); } else bad.push(`a list of neither kind: ${where}`);
    for (const r of rows.slice(0, -1)) { const a = getComputedStyle(r, '::after'); if (a.content === 'none' || a.height !== '1px') bad.push(`no hairline under ${r.dataset.key || r.textContent.slice(0, 20)}`); }
  }
  return { bad, lists: lists.length, pages: document.querySelectorAll('#screen .set-page[data-page]').length };
});
check(`rows of a kind look the same on every page (${kinds.lists} lists): controls on one inset with no icons, an icon on each place to go, a hairline under each row`, kinds.pages === 10 && !kinds.bad.length, kinds.bad);
await home();
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
// The rows that were there, where they went.
const onPage = async (id, fn) => { await ev((x) => window.GH.ui.open('settings', x), id); await settle(900); return ev(fn); };
check('Workouts: Your answers and the level check first, then supersets and rest', (await onPage('workouts', () => [...document.querySelectorAll('#screen .set-page .rf-list-title')].map((t) => t.textContent).join())) === 'Your answers,Retake the level check,Supersets,Rest between sets');
check('the rest\'s line is short, and its footer says what Auto does, 2.5 min on a strength plan', await ev(() => { const li = document.querySelector('#screen [data-key="rest"]'); const f = document.querySelector('#screen .rf-list-footer[data-group="workouts"]'); return li.querySelector('.rf-list-sub').textContent === 'Auto picks it for each exercise' && /2\.5 min after the main lifts/.test(f.textContent); }));
check('Sound and Vibration lead Sound and haptics', (await onPage('feel', () => [...document.querySelectorAll('#screen ul[data-group="feel"] .rf-list-title')].slice(0, 2).map((t) => t.textContent).join())) === 'Sound,Vibration');
check('General holds units and the start of the day', (await onPage('general', () => [...document.querySelectorAll('#screen ul[data-group="general"] .rf-list-title')].map((t) => t.textContent).join())) === 'Units,Start of the day');
await page.click('#screen [data-on="setRollHour"] input[value="2"]', { force: true });
await settle(900);
check('the day can start at 2 am', await ev(() => window.GH.ui.S.profile.prefs.rollHour === 2 && window.GH.ui.rollHour() === 2));
await page.click('#screen [data-on="setRollHour"] input[value="4"]', { force: true });
await settle(900);
check('Appearance: the theme, the glass, then the exercise figure and its look', (await onPage('look', () => ['theme', 'glass-fx', 'glass', 'figure', 'figlook'].every((k) => document.querySelector(`#screen ul[data-group="look"] [data-key="${k}"]`)))) && await ev(() => !document.querySelector('#screen [data-on="setFigure"]').closest('[data-group="workouts"]')));
check('Health Connect: the connection and the background sync, then saving and reading with other apps', await onPage('hc', () => !!document.querySelector('#screen [data-key="hc"]') && !!document.querySelector('#screen [data-on="hcBgToggle"]') && [...document.querySelectorAll('#screen #set-hc-others + ul .rf-list-title')].map((t) => t.textContent).join() === 'Save workouts to Health Connect,Save meals to Health Connect,Count food from other apps'));
check('Notifications: the switch, what they\'re for, and when', await onPage('notify', () => { const uls = [...document.querySelectorAll('#screen ul[data-group="notify"]')]; return uls.length >= 1 && !!uls[0].querySelector('[data-on="notifyOn"]'); }));
await ev(() => { window.GH.ui.S.profile.prefs.notify.on = true; window.GH.ui.render(); });
await settle(900);
const nf = await ev(() => [...document.querySelectorAll('#screen ul[data-group="notify"]')].map((ul) => [...ul.children].map((r) => r.dataset.key).join()));
check('with them on: the switch (and Android\'s permission), the kinds under "What they\'re for", then the time', nf.length === 3 && /^sw:notifyOn:/.test(nf[0]) && nf[1].split(',').every((k) => /^sw:notifyKind:/.test(k)) && nf[2] === 'nf-time' && await ev(() => document.getElementById('set-notify-kinds').textContent === 'What they\'re for'), nf);
await ev(() => { window.GH.ui.S.profile.prefs.notify.on = false; window.GH.ui.render(); });
await settle(900);
await onPage('workouts', () => 1);
await ev(() => { window.__haptics.length = 0; });
await page.click('#screen [data-key="sw:setPref:supersets"]');
await settle(900);
check('a switch on a page works there, with its liquid control and its haptic', await ev(() => window.GH.ui.S.profile.prefs.supersets === false && window.__haptics.includes('toggleOff') && !!document.querySelector('#screen [data-k="supersets"]').closest('.rf-switch') && window.GH.ui.route.arg === 'workouts'));
await page.click('#screen [data-key="sw:setPref:supersets"]');
await settle(900);
await ev(() => window.GH.ui.act.keySheet());
await settle(700);
check('the API key sheet: encrypted on this phone', await ev(() => document.querySelector('dialog.rf-sheet[open] .rf-field-hint').textContent === 'Encrypted on this phone, never in backups, never shown again.'));
await ev(() => window.GH.ui.closeSheets());
await settle(900);
await home();

section('Settings: search across every page');
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
await ev(() => { window.__home = document.querySelector('#screen .set-home'); window.__field = document.getElementById('setQ'); });
const found = () => ev(() => ({
  rows: [...document.querySelectorAll('#screen .set-results ul.rf-list > li')].filter((li) => li.offsetParent).map((li) => { const b = li.querySelector('[data-act]'); return { title: li.querySelector('.rf-list-title').textContent, path: (li.querySelector('.rf-list-sub') || {}).textContent || '', arg: b.dataset.arg || '', act: b.dataset.act, icon: !!li.querySelector('.rf-list-icon svg') }; }),
  home: !!(document.querySelector('#screen .set-home') || {}).offsetParent,
  none: !!(document.querySelector('#screen .set-none') || {}).offsetParent,
}));
const search = async (q) => {
  await page.click('#setQ');
  await page.fill('#setQ', '');
  await page.keyboard.type(q, { delay: 15 });
  await settle(300);
  return found();
};
const titles = (x) => x.rows.map((y) => y.title).join();
const row = (x, title) => x.rows.find((y) => y.title === title) || {};
let r = await search('vibration');
check('"vibration": Sound and haptics, and its Vibration, in the parts\' place', !r.home && titles(r) === 'Sound and haptics,Vibration' && row(r, 'Vibration').path === 'Sound and haptics' && row(r, 'Vibration').arg === 'feel sw:setPref:vibrate' && r.rows.every((y) => y.icon), JSON.stringify(r));
r = await search('dark mode');
check('"dark mode": Appearance and its Theme', r.rows[0].title === 'Appearance' && row(r, 'Theme').path === 'Appearance', JSON.stringify(r));
r = await search('kg');
check('"kg": Units, in General, and nothing else', titles(r) === 'Units' && r.rows[0].path === 'General', JSON.stringify(r));
r = await search('API key');
check('"API key": the AI coach\'s Who answers your questions first, then Copy my data', r.rows[0].title === 'Who answers your questions' && r.rows[0].path === 'AI coach' && row(r, 'Copy my data').path === 'Your data', JSON.stringify(r));
r = await search('backup');
check('"backup": Your data, Copy my data and Restore from a copy', titles(r) === 'Your data,Copy my data,Restore from a copy', JSON.stringify(r));
r = await search('rest');
check('"rest": Rest between sets, in Workouts', row(r, 'Rest between sets').path === 'Workouts', JSON.stringify(r));
r = await search('diabetes');
check('"diabetes" and "osteoporosis": Your answers, in Workouts, where health conditions are', titles(r) === 'Your answers' && r.rows[0].path === 'Workouts' && titles(await search('osteoporosis')) === 'Your answers', JSON.stringify(r));
// Rows other parts draw are found too, with the page and the header they're under.
await ev(() => { window.GH.ui.S.profile.prefs.notify.on = true; window.GH.ui.render(); });
r = await search('good nights');
await ev(() => { window.GH.ui.S.profile.prefs.notify.on = false; window.GH.ui.render(); });
check('rows other parts draw: notifications\' "Good nights" (with them on)', row(r, 'Good nights').path === 'Notifications · What they\'re for', JSON.stringify(r));
r = await search('spoken');
check('the activities\' "Spoken splits"', row(r, 'Spoken splits').path === 'Tracking · Walks, runs and rides', JSON.stringify(r));
r = await search('feel each');
check('the haptics\' "Feel each one"', row(r, 'Feel each one').path === 'Sound and haptics · Haptics', JSON.stringify(r));
r = await search('breakfast');
check('"breakfast": Meal times, under Food', row(r, 'Meal times').path === 'Tracking · Food', JSON.stringify(r));
r = await search('shirt');
check('"shirt": the figure\'s look, in Appearance', titles(r) === 'Skin tone and shirt' && r.rows[0].path === 'Appearance', JSON.stringify(r));
r = await search('zzzz');
check('nothing found says so', r.none && !r.rows.length && !r.home, JSON.stringify(r));
check('typing doesn\'t re-render: the same field, still focused, and the parts kept for later', await ev(() => document.getElementById('setQ') === window.__field && document.activeElement === window.__field && document.querySelector('#screen .set-home') === window.__home));
await page.click('#screen .set-search .rf-search-clear');
await settle(300);
r = await found();
check('clearing it brings the parts back', r.home && !r.rows.length && !r.none, JSON.stringify(r));
// A result opens its page, at its row, lit up a moment; Back brings the results back.
await search('spoken');
await ev(() => { window.__haptics.length = 0; });
await page.click('#screen .set-results [data-arg="track sw:actVoice:Spoken splits"]');
await settle(300);
const at = await ev(() => {
  const s = document.getElementById('screen'), li = s.querySelector('[data-key="sw:actVoice:Spoken splits"]');
  if (!li) return { route: window.GH.ui.route, keys: [...s.querySelectorAll('[data-key]')].map((n) => n.dataset.key).slice(0, 30) };
  const b = li.getBoundingClientRect(), bar = document.getElementById('topbar').getBoundingClientRect();
  return { arg: window.GH.ui.route.arg, title: s.querySelector('.rf-large-title').textContent, scrolled: s.scrollTop > 0, inView: b.top >= bar.bottom - 1 && b.bottom <= innerHeight, lit: li.classList.contains('set-flash'), glow: getComputedStyle(li, '::before').content !== 'none', field: document.activeElement === document.getElementById('setQ'), nav: window.__haptics.includes('nav') };
});
check('a result opens its page, scrolled to its row, lit up, with the page haptic', at.arg === 'track' && at.title === 'Tracking' && at.scrolled && at.inView && at.lit && at.glow && !at.field && at.nav, at);
await settle(2000);
check('and the light goes after a moment', await ev(() => !document.querySelector('#screen [data-key="sw:actVoice:Spoken splits"]').classList.contains('set-flash')));
await page.click('#topbar [data-act="back"]');
await settle(900);
r = await found();
check('Back: the top page with the search as it was, to try the next result', (await ev(() => document.getElementById('setQ').value)) === 'spoken' && row(r, 'Spoken splits').title && !r.home, JSON.stringify(r));
await page.click('#topbar [data-act="back"]');
await settle(900);
check('Back again leaves Settings', (await where()).tab === 'you' && !(await where()).view);
await page.click('#screen [data-act="openSettings"]');
await settle(900);
check('a new visit starts with an empty search and every part', await ev(() => document.getElementById('setQ').value === '' && !!document.querySelector('#screen .set-home').offsetParent && document.querySelectorAll('#screen .set-home li').length === 10));
await home();

section('Settings: links into a page');
// From Health's coach button, the chat's menu, You's tracking link, notifications and older code:
// each lands on its page, and Back goes back to where the link was.
const link = async (label, run, id, title, from, more) => {
  await run();
  await settle(1000);
  const w = await pageNow();
  const extra = more ? await ev(more) : true;
  await page.click('#topbar [data-act="back"]');
  await settle(900);
  const b = await where();
  check(label, w.view === 'settings' && w.page === id && w.title === title && extra && b.tab === from && !b.view, { w, extra, b });
};
await go('health');
await link('Health\'s coach settings: AI coach, and Back to Health', () => ev(() => window.GH.ui.act.openCoachSettings()), 'coach', 'AI coach', 'health');
await link('the chat\'s AI coach settings: AI coach, and Back to the tab the chat was on', () => ev(() => window.GH.ui.act.chatSettings()), 'coach', 'AI coach', 'health');
await go('you');
await link('You\'s tracking link: Tracking, and Back to You', () => ev(() => window.GH.ui.act.openTracking()), 'track', 'Tracking', 'you');
await go('today');
for (const [arg, id, title] of [['feel', 'feel', 'Sound and haptics'], ['hc', 'hc', 'Health Connect'], ['notify', 'notify', 'Notifications']]) {
  await link(`'${arg}': ${title}, and Back to Today`, () => ev((x) => window.GH.ui.open('settings', x), arg), id, title, 'today');
}
await link('\'food\': Tracking, opened at Food, clear of the bar', () => ev(() => window.GH.ui.open('settings', 'food')), 'track', 'Tracking', 'today', () => { const h = document.getElementById('set-food').getBoundingClientRect(), bar = document.getElementById('topbar').getBoundingClientRect(); return document.getElementById('screen').scrollTop > 0 && h.top >= bar.bottom && h.top < bar.bottom + 60; });
await link('\'figure\': Appearance, at the exercise figure', () => ev(() => window.GH.ui.open('settings', 'figure')), 'look', 'Appearance', 'today', () => document.getElementById('screen').scrollTop > 0);
await link('\'all\': every part on one page, long enough to flick (the scroll diagnostics)', () => ev(() => window.GH.ui.open('settings', 'all')), 'workouts', 'All settings', 'today', () => { const s = document.getElementById('screen'); return document.querySelectorAll('#screen .set-page[data-page]').length === 10 && s.scrollHeight > 4 * s.clientHeight; });
await link('an id it doesn\'t know: the top page', () => ev(() => window.GH.ui.open('settings', 'nope')), null, 'Settings', 'today', () => !!document.getElementById('setQ'));
await link('the shell\'s #settings: the top page', () => ev(() => { location.hash = '#settings'; }), null, 'Settings', 'today', () => !!document.getElementById('setQ'));
await ev(() => { history.replaceState(null, '', location.pathname); });
await home();

section('The Refract credit');
await go('you');
await page.click('#screen [data-act="openSettings"]');
await settle(900);
await page.click('#screen [data-act="setPage"][data-arg="about"]');
await settle(900);
const credit = await ev(() => {
  const li = document.querySelector('#screen ul[data-group="about"] [data-key="refract"]');
  const mark = li && li.querySelector('.rf-list-lead .rf-mark');
  const b = mark && mark.getBoundingClientRect();
  const half = mark && getComputedStyle(mark, '::before');
  const prev = li && li.previousElementSibling && li.previousElementSibling.querySelector('[data-act]');
  return {
    row: !!li, title: li ? li.querySelector('.rf-list-title').textContent : '', act: li ? li.querySelector('[data-act]').dataset.act : '', after: prev ? prev.dataset.act : '',
    mark: !!mark, role: mark && mark.getAttribute('role'), label: mark && mark.getAttribute('aria-label'), size: b ? [Math.round(b.width), Math.round(b.height)].join() : '',
    drawn: !!half && half.content !== 'none' && half.backgroundColor !== 'rgba(0, 0, 0, 0)', ink: !!mark && getComputedStyle(mark).color === getComputedStyle(li.querySelector('.rf-list-title')).color,
    tile: !!(li && li.querySelector('.rf-list-icon')),
  };
});
check('About: "Built with Refract", after the licenses, opens them', credit.row && credit.title === 'Built with Refract' && credit.act === 'licensesSheet' && credit.after === 'licensesSheet', JSON.stringify(credit));
check('its icon is Refract\'s mark, drawn (20 px, in the label\'s ink), named for screen readers, with no tile', credit.mark && credit.size === '20,20' && credit.drawn && credit.ink && credit.role === 'img' && credit.label === 'Refract' && !credit.tile, JSON.stringify(credit));
await page.click('#topbar [data-act="back"]');
await settle(900);
r = await search('design system');
check('search finds it: "design system", in About', row(r, 'Built with Refract').path === 'About', JSON.stringify(r));
await page.click('#screen .set-results [data-arg="about refract"]');
await settle(900);
await page.click('#screen [data-key="refract"] [data-act]');
await settle(900);
const sheet = await ev(() => {
  const d = document.querySelector('dialog.rf-sheet[open]');
  const c = d && d.querySelector('.credit-refract');
  const mark = c && c.querySelector('.rf-mark');
  const half = mark && getComputedStyle(mark, '::before');
  return {
    open: !!d, credit: !!c, first: !!c && !c.previousElementSibling,
    head: c && c.querySelector('.t-headline') ? c.querySelector('.t-headline').textContent.trim() : '', foot: c && c.querySelector('.t-footnote') ? c.querySelector('.t-footnote').textContent.trim() : '',
    mark: !!mark, size: mark ? Math.round(mark.getBoundingClientRect().width) : 0, once: !!mark && mark.dataset.animate === 'once' && half.animationIterationCount === '1', label: mark && mark.getAttribute('aria-label'),
    list: d ? d.querySelectorAll('ul.rf-list > li').length : 0, version: String(window.Refract.version),
  };
});
check('the credits open with Refract: its mark, larger, coming apart once', sheet.open && sheet.credit && sheet.first && sheet.mark && sheet.size === 48 && sheet.once && sheet.label === 'Refract', JSON.stringify(sheet));
check(`"Built with Refract ${sheet.version.replace(/\.0$/, '')}", what it gave the app, then the licenses`, sheet.head === `Built with Refract ${sheet.version.replace(/\.0$/, '')}` && /glass, controls, motion, icons and type\.$/.test(sheet.foot) && sheet.list >= 11, JSON.stringify(sheet));
await ev(() => window.GH.ui.closeSheets());
await settle(900);
await home();

section('One place for each');
const acts = (sel) => ev((s) => [...document.querySelectorAll(s)].map((b) => b.dataset.act), sel);
await go('you');
await ev(() => window.GH.ui.open('settings', 'all'));
await settle(900);
let a = await acts('#screen [data-act]');
check('Settings has no Days and time, Equipment, Your plans, What\'s new or Privacy, on any page', a.length > 20 && !['daysSheet', 'editEquipment', 'planEquipment', 'openPlans', 'openWhatsNew', 'openPrivacyView', 'openMoves'].some((x) => a.includes(x)), a.join());
await ev(() => window.GH.ui.back());
await settle(900);
await ev(() => window.GH.ui.open('settings', 'about'));
await settle(900);
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
for (const [t, id] of [['today', 'today'], ['plan', 'plan'], ['health', 'health'], ['progress', 'progress'], ['you', 'you']]) {
  await go(t);
  check(`${t}`, await ev((x) => !!document.querySelector(`#screen [data-key="tip-${x}"]`), id));
}
await go('health');
check('with calories on, Health\'s says where the food is', await ev(() => window.GH.food.full(window.GH.ui.S) && /Your food is at the top/.test((document.querySelector('#screen [data-key="tip-health"]') || {}).textContent || '')));
await go('food');
await page.waitForSelector('#screen .fd-sum', { timeout: 8000 }).catch(() => {});
check('the Food page has no tip of its own', await ev(() => window.GH.ui.route.view === 'food' && !!document.querySelector('#screen .fd-sum') && !document.querySelector('#screen .tip')));
await home();
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
