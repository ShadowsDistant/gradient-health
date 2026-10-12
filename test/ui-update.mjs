// Updates in the app, in Chromium at phone size with someone five weeks in, against a stand-in for
// Updater.java (the update* methods on a fake AndroidBridge, playing its phases on the page's clock):
// Today's question before anything checks by itself (asked once: Check daily or Not now, not on the
// day of set-up), the automatic check (a few seconds after the app opens, once a day, not during a
// workout, not with the switch off), Today's card and Not now, Settings' About rows (Check for updates with the version
// and what a check found, Check automatically) and a check by hand, the update sheet (what's new, the
// size, Update with its progress and Cancel, a download that stops, Install, the permission to
// install apps and coming back from Settings, Android's screen, an install said no to, not during a
// workout), the haptics on the way, and the rows where nothing checks (a plain browser, Google Play).
// Usage: node test/ui-update.mjs [--dark] [--shots=<dir>]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const shots = shotsArg ? shotsArg.slice(8) : null;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const server = await serveDist();
const errors = [];
const DAY = 864e5;

// Updater.java's stand-in: window.__up holds what it knows and what it was asked (calls). A test sets
// support ({ ok, why?, canInstall }), what the next check finds (find: 'available', 'current' or a
// reason), and moves a download along with __up.progress(bytes), __up.verify(), __up.finish() and
// __up.fail(code).
function fakeUpdater() {
  const up = window.__up = Object.assign({
    support: { ok: true, canInstall: true },
    installed: { versionName: '1.10.1', versionCode: 29862713 },
    latest: { versionName: '1.11.1', versionCode: 29900000, size: 48234496, notes: '• Answers as tidy cards, with your numbers\n• Your chats, kept\n• Updates right in the app' },
    find: 'available', phase: 'idle', step: null, error: null, known: false, checkedAt: 0, loaded: 0, calls: [], settingsOpened: 0,
  }, window.__up || {});
  const snap = (extra) => JSON.stringify(Object.assign({ phase: up.phase, installed: up.installed },
    up.step ? { step: up.step } : {}, up.error ? { error: up.error } : {}, up.known ? { latest: up.latest } : {}, up.checkedAt ? { checkedAt: up.checkedAt } : {},
    up.phase === 'downloading' || up.phase === 'verifying' ? { loaded: up.loaded, total: up.latest.size, bps: 2e6 } : {}, extra || {}));
  const set = (phase, step, error, doneStep) => {
    Object.assign(up, { phase, step: step || null, error: error || null });
    const s = snap(doneStep ? { done: doneStep } : null);
    setTimeout(() => window.__gh.onUpdate(s), 0);
  };
  const idle = () => ['idle', 'current', 'available', 'ready', 'failed'].includes(up.phase);
  up.set = set;
  up.progress = (bytes) => { up.loaded = bytes; set('downloading'); };
  up.verify = () => { up.loaded = up.latest.size; set('verifying'); };
  up.finish = () => { up.loaded = up.latest.size; set('ready', null, null, 'download'); };
  up.fail = (code) => set('failed', 'download', code, 'download');
  const b = window.AndroidBridge;
  b.updateSupport = () => { up.calls.push('support'); return JSON.stringify(up.support); };
  b.updateState = () => { up.calls.push('state'); return snap(); };
  b.updateCheck = () => {
    up.calls.push('check');
    if (!idle()) return false;
    set('checking');
    setTimeout(() => {
      if (up.find === 'available' || up.find === 'current') {
        up.known = true;
        up.checkedAt = Date.now();
        if (up.find === 'current') up.latest = Object.assign({}, up.latest, { versionName: up.installed.versionName, versionCode: up.installed.versionCode });
        set(up.find, null, null, 'check');
      } else set('failed', 'check', up.find, 'check');
    }, 400);
    return true;
  };
  b.updateDownload = () => { up.calls.push('download'); if (!idle()) return false; up.loaded = 0; set('downloading'); return true; };
  b.updateCancel = () => { up.calls.push('cancel'); if (up.phase === 'downloading') { up.loaded = 0; set('available', null, null, 'download'); } };
  b.updateInstall = () => {
    up.calls.push('install');
    if (!['ready', 'permission', 'confirm'].includes(up.phase)) return false;
    if (!up.support.canInstall) { up.settingsOpened++; set('permission'); return true; }
    set('installing');
    setTimeout(() => set('confirm'), 300);
    return true;
  };
}

// A page with someone five weeks in, on Monday Oct 19 at 8:10 am. o.up: the stand-in's start
// (null: no updater at all, as a plain browser's bridge); o.kept: what this phone chose before (by
// default, yes to the automatic check; null: nothing yet, so Today asks).
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width || 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await page.addInitScript(seedBridge);
  if (o.up !== null) {
    await page.addInitScript((u) => { window.__up = u; }, o.up || {});
    await page.addInitScript(fakeUpdater);
  }
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  const was = o.kept === undefined ? { auto: true } : o.kept;
  if (was) await page.evaluate((k) => localStorage.setItem('gh.v1.update', JSON.stringify(k)), was);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  return { ctx, page, settle, ev };
}
const calls = (ev) => ev(() => (window.__up ? window.__up.calls.filter((c) => !['support', 'state'].includes(c)) : []));
const kept = (ev) => ev(() => JSON.parse(localStorage.getItem('gh.v1.update') || '{}'));
const haptics = (ev) => ev(() => window.__haptics.slice());
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const askOf = (ev) => ev(() => { const c = document.querySelector('#screen [data-key="update-ask"]'); return c && { text: c.textContent.replace(/\s+/g, ' ').trim(), yes: (c.querySelector('[data-act="updateAskYes"]') || {}).textContent, no: (c.querySelector('[data-act="updateAskNo"]') || {}).textContent }; });
const cardOf = (ev) => ev(() => { const c = document.querySelector('#screen [data-key="update-card"]'); return c && { text: c.textContent.replace(/\s+/g, ' ').trim(), update: !!c.querySelector('[data-act="updateOpen"]'), no: !!c.querySelector('[data-act="updateDismiss"]') }; });
// Settings, at About: the update row and the switch.
const settings = async (ev, settle) => {
  await ev(() => { const U = window.GH.ui; U.closeSheets(); if (U.route.view !== 'settings') U.open('settings'); });
  await settle(900);
  await ev(() => { const h = document.querySelector('#screen #about'); if (h) h.scrollIntoView({ block: 'start' }); });
  await settle(300);
};
const rows = (ev) => ev(() => {
  const li = document.querySelector('#screen ul[data-group="about"] [data-key="update"]') || document.querySelector('#screen ul[data-group="about"] [data-key="version"]');
  const sw = document.querySelector('#screen [data-on="updateAuto"]');
  const sub = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  return li && {
    key: li.dataset.key, title: sub(li.querySelector('.rf-list-title')), sub: sub(li.querySelector('.rf-list-sub')), detail: sub(li.querySelector('.rf-list-detail')),
    act: (li.querySelector('[data-act]') || {}).dataset ? li.querySelector('[data-act]').dataset.act : null, btn: sub(li.querySelector('button.rf-btn')), spin: !!li.querySelector('.rf-spinner'),
    sw: sw ? { on: sw.checked, sub: sub(sw.closest('label').querySelector('.rf-list-sub')) } : null,
  };
});
const sheetOf = (ev) => ev(() => {
  const d = document.querySelector('dialog.up-sheet[open]');
  if (!d) return null;
  const bar = d.querySelector('.up-prog .rf-progress');
  return {
    title: d.querySelector('.rf-sheet-title').textContent, head: [...d.querySelectorAll('.up-head p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
    notes: [...d.querySelectorAll('.up-notes li')].map((li) => li.textContent.trim()),
    main: (() => { const m = d.querySelector('[data-key="up-main"]'); return m ? { act: m.dataset.act, label: m.textContent.trim() } : null; })(),
    bar: bar ? Number(bar.style.getPropertyValue('--rf-value')) : null, prog: ((d.querySelector('.up-prog-row .t-footnote') || {}).textContent || '').replace(/\s+/g, ' ') || null,
    cancel: !!d.querySelector('[data-act="updateCancel"]'), err: (d.querySelector('.up-err') || {}).textContent || null,
    act: d.querySelector('.up-act').textContent.replace(/\s+/g, ' ').trim(),
  };
});
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `${name}${dark ? '-dark' : ''}.png`) }); };

/* ------------------------------------------------------------------ asked first */
section('Today asks once, and nothing checks by itself before a yes');
{
  const { ctx, page, settle, ev } = await open({ kept: null });
  await settle(12000);
  check('not asked yet: nothing is asked of GitHub, even seconds after launch', (await calls(ev)).length === 0, await calls(ev));
  const first = await ev(() => ({ nf: !!document.querySelector('#screen [data-key="notify-ask"]'), up: !!document.querySelector('#screen [data-key="update-ask"]') }));
  if (first.nf) check('the reminders\' question comes first', !first.up, first);
  await ev(() => { const U = window.GH.ui; U.markSeen('notifyAsk'); U.render(); });
  await settle(800);
  const a = await askOf(ev);
  check('Today asks "Keep the app up to date?", saying what GitHub sees, with Check daily and Not now', a && /^Keep the app up to date\?/.test(a.text) && /GitHub sees your IP address, like any website\. Nothing about you is sent\./.test(a.text) && a.yes === 'Check daily' && a.no === 'Not now', a);
  if (shots) {
    await ev(() => { const c = document.querySelector('#screen [data-key="update-ask"]'); if (c) c.scrollIntoView({ block: 'center' }); });
    await settle(600);
    await shot(page, 'update-ask');
  }
  await settings(ev, settle);
  const r0 = await rows(ev);
  check('meanwhile Settings shows Check automatically off', r0 && r0.sw && r0.sw.on === false, r0);
  await ev(() => { const U = window.GH.ui; U.closeSheets(); U.go('today'); });
  await settle(900);
  const h0 = (await haptics(ev)).length;
  await page.click('#screen [data-key="update-ask"] [data-act="updateAskYes"]');
  await settle(1200);
  check('Check daily: the card folds away, with the switch-on feel', !(await askOf(ev)) && (await haptics(ev)).slice(h0).includes('toggleOn'), (await haptics(ev)).slice(h0));
  check('and the yes is kept', (await kept(ev)).auto === true, await kept(ev));
  await settle(9000);
  check('a few seconds on, the first check', (await calls(ev)).join() === 'check', await calls(ev));
  await settle(1000);
  check('it found 1.11.1: the update card takes the question\'s place', !!(await cardOf(ev)) && !(await askOf(ev)));
  await ctx.close();
}
{
  const { ctx, page, settle, ev } = await open({ kept: null });
  await ev(() => { const U = window.GH.ui; U.markSeen('notifyAsk'); U.render(); });
  await settle(900);
  await page.click('#screen [data-key="update-ask"] [data-act="updateAskNo"]');
  await settle(1200);
  check('Not now: the card folds away, and the no is kept', !(await askOf(ev)) && (await kept(ev)).auto === false, await kept(ev));
  await ev(() => window.__gh.onResume());
  await settle(12000);
  check('then nothing checks by itself', (await calls(ev)).length === 0, await calls(ev));
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await settle(1500);
  check('and it isn\'t asked again', !(await askOf(ev)));
  await settings(ev, settle);
  const r = await rows(ev);
  check('Settings: Check automatically is off; Check for updates still checks when tapped', r && r.sw && r.sw.on === false && r.act === 'updateCheck', r);
  await ev(() => document.querySelector('#screen [data-on="updateAuto"]').click());
  await settle(600);
  check('switching it on there is kept as a yes', (await kept(ev)).auto === true, await kept(ev));
  await ctx.close();
}
{
  const { ctx, settle, ev } = await open({ kept: null });
  await ev(() => { const U = window.GH.ui; U.markSeen('notifyAsk'); U.S.profile.startDay = U.today(); U.save(true); U.render(); });
  await settle(900);
  check('on the day of set-up, it isn\'t asked yet', !(await askOf(ev)));
  await ctx.close();
}

/* ------------------------------------------------------------------ the automatic check */
section('The automatic check: a few seconds after the app opens, once a day');
{
  const { ctx, page, settle, ev } = await open();
  await settle(2500);
  check('nothing is asked of GitHub at launch', (await calls(ev)).length === 0, await calls(ev));
  await settle(7000);
  check('a few seconds on, one check', (await calls(ev)).join() === 'check', await calls(ev));
  await settle(1000);
  const c = await cardOf(ev);
  check('it found 1.11.1: Today\'s card says "Version 1.11.1 is ready", with Update and Not now', c && /^Version 1\.11\.1 is ready/.test(c.text) && c.update && c.no, c);
  check('with the first line of what\'s new and the size', c && /Answers as tidy cards, with your numbers\./.test(c.text) && /A 46 MB download\./.test(c.text), c && c.text);
  const k = await kept(ev);
  check('the check is kept for this phone, with the switch on', k.auto === true && k.at > 0 && !k.failedAt, k);
  if (shots) {
    await ev(() => { const c = document.querySelector('#screen [data-key="update-card"]'); if (c) c.scrollIntoView({ block: 'center' }); });
    await settle(600);
    await shot(page, 'update-card');
    await ev(() => document.getElementById('screen').scrollTo(0, 0));
  }
  // The app opened again the same day: no second check.
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await settle(10000);
  check('opened again the same day: no second check', (await calls(ev)).length === 0, await calls(ev));
  // A day later, the app comes back from the background.
  await ev(() => { const k2 = JSON.parse(localStorage.getItem('gh.v1.update')); k2.at = Date.now() - 864e5 - 60000; localStorage.setItem('gh.v1.update', JSON.stringify(k2)); });
  await ev(() => window.__gh.onResume());
  await settle(2000);
  check('a day later, coming back: not at once', (await calls(ev)).length === 0);
  await settle(8000);
  check('but a few seconds on', (await calls(ev)).join() === 'check', await calls(ev));
  await ctx.close();
}

section('Never during a workout, nor with the switch off, and an hour after one that failed');
{
  const { ctx, settle, ev } = await open({ up: { find: 'offline' } });
  await ev(() => { const U = window.GH.ui, B = window.GH.brain; B.startWorkout(U.S, U.today(), { now: Date.now() }); U.save(true); U.render(); });
  await settle(12000);
  check('a workout going on: no check', (await calls(ev)).length === 0, await calls(ev));
  await ev(() => { const U = window.GH.ui; U.S.active = null; U.save(true); U.render(); });
  await ev(() => window.__gh.onResume());
  await settle(10000);
  check('once it\'s over (the app comes back): the check', (await calls(ev)).join() === 'check', await calls(ev));
  await settle(1000);
  const k = await kept(ev);
  check('offline: it failed, and that\'s kept (an hour before the next try)', k.failedAt > 0 && !k.at, k);
  await ev(() => window.__gh.onResume());
  await settle(10000);
  check('back within the hour: no new try', (await calls(ev)).length === 1, await calls(ev));
  await settings(ev, settle);
  const r = await rows(ev);
  check('Settings says why: "couldn\'t check: you\'re offline"', r && r.sub === 'Version 1.10.1 · couldn\'t check: you\'re offline', r);
  await ev(() => document.querySelector('#screen [data-on="updateAuto"]').click());
  await settle(600);
  check('Check automatically, switched off, is kept', (await kept(ev)).auto === false);
  await ev(() => { const k2 = JSON.parse(localStorage.getItem('gh.v1.update')); k2.failedAt = 0; localStorage.setItem('gh.v1.update', JSON.stringify(k2)); });
  await ev(() => window.__gh.onResume());
  await settle(10000);
  check('then nothing checks by itself', (await calls(ev)).length === 1, await calls(ev));
  await ctx.close();
}

/* ------------------------------------------------------------------ Today's card */
section('Today: the card, and Not now until the next version');
{
  const { ctx, page, settle, ev } = await open();
  await settle(10000);
  check('the card is up', !!(await cardOf(ev)));
  const h0 = (await haptics(ev)).length;
  await page.click('#screen [data-key="update-card"] [data-act="updateDismiss"]');
  await settle(1200);
  check('Not now: it folds away', !(await cardOf(ev)));
  check('with the dismiss feel', (await haptics(ev)).slice(h0).includes('dismiss'), (await haptics(ev)).slice(h0));
  check('and 1.11.1 is kept as put away', (await kept(ev)).dismissed === '1.11.1', await kept(ev));
  // Tomorrow's check finds the same 1.11.1: still no card. Then 1.11.2 brings it back.
  await ev(() => { const k = JSON.parse(localStorage.getItem('gh.v1.update')); k.at = 1; localStorage.setItem('gh.v1.update', JSON.stringify(k)); window.__gh.onResume(); });
  await settle(10000);
  check('the next check finds 1.11.1 again: no card', (await calls(ev)).filter((x) => x === 'check').length === 2 && !(await cardOf(ev)));
  await ev(() => { const up = window.__up; up.latest = Object.assign({}, up.latest, { versionName: '1.11.2', versionCode: 29950000 }); const k = JSON.parse(localStorage.getItem('gh.v1.update')); k.at = 1; localStorage.setItem('gh.v1.update', JSON.stringify(k)); window.__gh.onResume(); });
  await settle(10000);
  const c = await cardOf(ev);
  check('1.11.2 comes out: the card is back', c && /^Version 1\.11\.2 is ready/.test(c.text), c);
  await page.click('#screen [data-key="update-card"] [data-act="updateOpen"]');
  await settle(900);
  const s = await sheetOf(ev);
  check('Update on the card opens the update sheet', s && s.title === 'Update' && s.head[0] === 'Version 1.11.2', s);
  await ctx.close();
}

/* ------------------------------------------------------------------ Settings */
section('Settings, About: Check for updates and Check automatically');
{
  const { ctx, page, settle, ev } = await open({ up: { find: 'current' }, kept: { auto: true, at: Date.parse('2026-10-19T07:00:00') } });
  await settle(10000);
  check('checked an hour ago: nothing checks at launch', (await calls(ev)).length === 0, await calls(ev));
  await settings(ev, settle);
  let r = await rows(ev);
  check('"Check for updates" with the version, and a tap checks', r && r.title === 'Check for updates' && r.sub === 'Version 1.10.1' && r.act === 'updateCheck', r);
  check('"Check automatically" is on, and says what GitHub sees', r && r.sw && r.sw.on === true && r.sw.sub === 'Once a day. GitHub sees your IP address and app version, nothing about you.', r && r.sw);
  check('no plain Version row as well', await ev(() => !document.querySelector('#screen ul[data-group="about"] [data-key="version"]')));
  let h0 = (await haptics(ev)).length;
  await page.click('#screen [data-key="update"] [data-act="updateCheck"]');
  await settle(100);
  r = await rows(ev);
  check('a tap: "checking…", with a spinner', r && /checking/.test(r.sub) && r.spin, r);
  await settle(900);
  r = await rows(ev);
  check('then "you\'re up to date"', r && r.sub === 'Version 1.10.1 · you\'re up to date', r);
  check('with a tap, then the fresh-data feel', (await haptics(ev)).slice(h0).join() === 'tap,refresh', (await haptics(ev)).slice(h0));
  await ev(() => { window.__up.find = 'network'; });
  h0 = (await haptics(ev)).length;
  await page.click('#screen [data-key="update"] [data-act="updateCheck"]');
  await settle(1000);
  r = await rows(ev);
  check('GitHub out of reach: a short reason', r && r.sub === 'Version 1.10.1 · couldn\'t check: couldn\'t reach GitHub', r);
  check('and a warning', (await haptics(ev)).slice(h0).includes('warning'), (await haptics(ev)).slice(h0));
  await ev(() => { const up = window.__up; up.find = 'available'; up.latest = Object.assign({}, up.latest, { versionName: '1.11.1', versionCode: 29900000 }); });
  await page.click('#screen [data-key="update"] [data-act="updateCheck"]');
  await settle(1000);
  r = await rows(ev);
  check('a new version: "1.11.1 is ready", with an Update button', r && r.sub === '1.11.1 is ready · you have 1.10.1' && r.btn === 'Update' && r.act === 'updateOpen', r);
  await shot(page, 'update-settings');
  // Search finds them.
  await page.click('#setQ');
  await page.keyboard.type('update', { delay: 15 });
  await settle(300);
  const found = await ev(() => [...document.querySelectorAll('#screen .set-list ul.rf-list > *')].filter((x) => !x.hidden && !x.closest('[hidden]')).map((x) => (x.querySelector('.rf-list-title') || x).textContent.trim()));
  check('searching "update" finds both rows', found.includes('Check for updates') && found.includes('Check automatically'), found);
  await page.click('#screen .set-search .rf-search-clear');
  await settle(300);

  section('The update sheet: what\'s new, the size, Update');
  h0 = (await haptics(ev)).length;
  await page.click('#screen [data-key="update"] [data-act="updateOpen"]');
  await settle(900);
  let s = await sheetOf(ev);
  check('"Version 1.11.1", what you have and the size', s && s.head[0] === 'Version 1.11.1' && s.head[1] === 'You have 1.10.1 · 46 MB download', s && s.head);
  check('what\'s new: the store text as a list, without its bullets', s && s.notes.join('|') === 'Answers as tidy cards, with your numbers|Your chats, kept|Updates right in the app', s && s.notes);
  check('Update, and what happens then', s && s.main && s.main.act === 'updateGet' && s.main.label === 'Update' && /Downloads 46 MB from GitHub\. Android asks you before anything installs\./.test(s.act), s);
  check('the sheet came up with its own feel', (await haptics(ev)).slice(h0).includes('sheet'), (await haptics(ev)).slice(h0));
  h0 = (await haptics(ev)).length;
  await page.click('dialog.up-sheet [data-act="updateGet"]');
  await settle(300);
  s = await sheetOf(ev);
  check('Update: the download starts, with a progress bar and Cancel', (await calls(ev)).slice(-1)[0] === 'download' && s.bar === 0 && s.cancel && /0 MB of 46 MB/.test(s.prog), s);
  check('a tap\'s feel', (await haptics(ev)).slice(h0).includes('tap'), (await haptics(ev)).slice(h0));
  await ev(() => window.__up.progress(24117248));
  await settle(400);
  s = await sheetOf(ev);
  check('half way: the bar and "23 MB of 46 MB"', s && Math.abs(s.bar - 0.5) < 0.01 && s.prog === '23 MB of 46 MB', s);
  await shot(page, 'update-sheet-progress');
  r = await rows(ev);
  check('Settings follows it: "Downloading 1.11.1 · 50%"', r && r.sub === 'Downloading 1.11.1 · 50%', r);
  h0 = (await haptics(ev)).length;
  await page.click('dialog.up-sheet [data-act="updateCancel"]');
  await settle(400);
  s = await sheetOf(ev);
  check('Cancel: it stops, and Update is back', (await calls(ev)).slice(-1)[0] === 'cancel' && s.main && s.main.act === 'updateGet' && !s.cancel, s);
  check('with the dismiss feel', (await haptics(ev)).slice(h0).includes('dismiss'), (await haptics(ev)).slice(h0));
  await page.click('dialog.up-sheet [data-act="updateGet"]');
  await settle(300);
  await ev(() => window.__up.progress(10000000));
  await settle(300);
  h0 = (await haptics(ev)).length;
  await ev(() => window.__up.fail('network'));
  await settle(400);
  s = await sheetOf(ev);
  check('a download that stops: plain words, and Try again', s && s.err === 'Couldn\'t reach GitHub. Check your connection and try again.' && s.main && s.main.label === 'Try again' && s.main.act === 'updateGet', s);
  check('with a warning', (await haptics(ev)).slice(h0).includes('warning'), (await haptics(ev)).slice(h0));
  await page.click('dialog.up-sheet [data-act="updateGet"]');
  await settle(300);
  await ev(() => window.__up.verify());
  await settle(400);
  s = await sheetOf(ev);
  check('checking the download', s && /Checking the download/.test(s.prog || ''), s);
  h0 = (await haptics(ev)).length;
  await ev(() => window.__up.finish());
  await settle(400);
  s = await sheetOf(ev);
  check('downloaded and checked: Install, and what happens then', s && s.main && s.main.act === 'updateInstall' && s.main.label === 'Install' && /The app closes while it updates: open it again when it.s done\. Your data stays as it is\./.test(s.act), s);
  check('with the success feel', (await haptics(ev)).slice(h0).includes('success'), (await haptics(ev)).slice(h0));
  await shot(page, 'update-sheet-ready');

  section('Install: the permission to install apps, Android\'s screen');
  await ev(() => { window.__up.support.canInstall = false; });
  await ev(() => { const U = window.GH.ui, B = window.GH.brain; B.startWorkout(U.S, U.today(), { now: Date.now() }); U.save(true); });
  await page.click('dialog.up-sheet [data-act="updateInstall"]');
  await settle(500);
  const toast = await ev(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  check('mid-workout: not now, it says why', /Finish your workout first/.test(toast) && /The app closes while it updates/.test(toast) && !(await calls(ev)).includes('install'), toast);
  await ev(() => { for (const b of document.querySelectorAll('.rf-toast .rf-toast-close')) b.click(); });
  await ev(() => { const U = window.GH.ui; U.S.active = null; U.save(true); });
  await settle(4000);
  // Every save from here on is counted: Install writes the state before Android takes over.
  await ev(() => { const b = window.AndroidBridge, save = b.save; window.__saved = 0; b.save = (x) => { window.__saved++; return save(x); }; });
  await page.click('dialog.up-sheet [data-act="updateInstall"]');
  await settle(400);
  s = await sheetOf(ev);
  check('not allowed to install apps yet: Settings opens there, and the sheet explains', (await ev(() => window.__up.settingsOpened)) === 1 && /Allow updates from Gradient Health/.test(s.act) && /turn on Allow from this source, then come back here/.test(s.act) && s.main.label === 'Open settings', s);
  check('the state was written first (the app closes while it updates)', (await ev(() => window.__saved)) >= 1, await ev(() => window.__saved));
  await shot(page, 'update-sheet-permission');
  // Back from Settings without allowing it: nothing more happens; then allowed: on it goes.
  await ev(() => window.__gh.onResume());
  await settle(600);
  check('back without allowing it: it waits (no second trip to Settings)', (await ev(() => window.__up.settingsOpened)) === 1 && (await ev(() => window.__up.phase)) === 'permission');
  await ev(() => { window.__up.support.canInstall = true; window.__gh.onResume(); });
  await settle(200);
  check('back, allowed: the install carries on by itself', (await calls(ev)).filter((x) => x === 'install').length === 2 && ['installing', 'confirm'].includes(await ev(() => window.__up.phase)), await calls(ev));
  await settle(600);
  s = await sheetOf(ev);
  check('Android\'s screen is up: the sheet waits for it, with a way to try again', s && /Waiting for you in Android's screen/.test(s.act) && /Try again/.test(s.act), s);
  h0 = (await haptics(ev)).length;
  await ev(() => window.__up.set('ready', 'install', 'aborted', 'install'));
  await settle(400);
  s = await sheetOf(ev);
  check('said no in Android\'s screen: not installed, and Install is there again', s && s.err === 'Not installed. Tap Install when you\'re ready.' && s.main.act === 'updateInstall', s);
  check('no error feel for a no', !(await haptics(ev)).slice(h0).includes('error'), (await haptics(ev)).slice(h0));
  r = await rows(ev);
  check('Settings: downloaded, not installed yet, with Install', r && r.sub === '1.11.1 is downloaded, not installed yet' && r.btn === 'Install', r);
  await ctx.close();
}

/* ------------------------------------------------------------------ nothing checks */
section('A plain browser\'s bridge, and Google Play: nothing checks');
{
  const plain = await open({ up: null });
  await plain.settle(10000);
  await settings(plain.ev, plain.settle);
  const r = await rows(plain.ev);
  check('the Version row says updates come from where the app was installed, with the version', r && r.key === 'version' && r.title === 'Version' && r.sub === 'Updates come from where you installed the app' && r.detail === '1.10.1', r);
  check('no switch, no card', r && !r.sw && !(await plain.ev(() => document.querySelector('[data-key="update-card"]'))));
  await plain.ctx.close();
  const play = await open({ up: { support: { ok: false, why: 'play', canInstall: false } } });
  await play.settle(10000);
  check('installed by Google Play: nothing is asked of GitHub', (await calls(play.ev)).length === 0, await calls(play.ev));
  await settings(play.ev, play.settle);
  const p = await rows(play.ev);
  check('and Settings says updates come from Google Play', p && p.sub === 'Updates come from Google Play' && !p.sw, p);
  await play.ctx.close();
}

section('A small phone');
{
  const { ctx, page, settle, ev } = await open({ width: 360 });
  await settle(10000);
  const fits = (sel) => ev((s) => { const el = document.querySelector(s); return !!el && el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= innerWidth + 0.5; }, sel);
  check('at 360 px Today\'s card fits', await fits('#screen [data-key="update-card"]'));
  await settings(ev, settle);
  check('and so does the row with its button', await fits('#screen [data-key="update"] .rf-list-row'));
  await page.click('#screen [data-key="update"] [data-act="updateOpen"]');
  await settle(900);
  check('and the sheet', await fits('dialog.up-sheet .rf-sheet-body') && await fits('dialog.up-sheet .up-act'));
  await ctx.close();
}

section('Console');
check('no errors', errors.length === 0, errors.slice(0, 5));
await server.close();
await browser.close();
done();
