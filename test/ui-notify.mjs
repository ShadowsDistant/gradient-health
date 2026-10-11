// Notifications in the app, in Chromium at phone size with someone five weeks in (a stand-in for the
// Android side, test/fixtures.mjs): someone set up before keeps what they have (off or on, nothing
// asked at launch; set-up turning them on for someone new is test/ui-onboarding.mjs's), Today's
// one-time card (Turn on asks Android once; Not now, or any
// answer, and it never comes back), Settings' Notifications group (the switch, one per kind, the
// reminder time, Android's permission when it's off, a kind switched off in Android, search), the
// schedule handed to Android as the app is left and opened (and a workout done comes off it), a
// tapped notification's screen (while the app runs, and the one it was opened from), and the plain
// browser's note.
// Usage: node test/ui-notify.mjs [--dark]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const browser = await chromium.launch();
const server = await serveDist();
const errors = [];

// A page with someone five weeks in, on Monday Oct 19 at 8:10 am (a workout day). o.notify: the
// Android side's state before the app starts; o.browser: no notifications on this bridge (a plain
// browser's answer); o.ask: they haven't answered Today's card yet.
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
  if (o.notify) await page.addInitScript((n) => { window.__notify = n; }, o.notify);
  await page.addInitScript(seedBridge);
  if (o.browser) await page.addInitScript(() => { for (const k of Object.keys(window.AndroidBridge)) if (/^notify/.test(k)) delete window.AndroidBridge[k]; });
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  if (o.ask) {
    await ev(() => { const U = window.GH.ui; delete U.S.seen.notifyAsk; U.save(true); U.render(); });
    await settle(600);
  }
  return { ctx, page, settle, ev };
}
const toasts = (ev) => ev(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
const schedules = (ev) => ev(() => window.__notify.schedules);
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// The page hidden (the app going to the background), then shown again, as the WebView reports it.
const visibility = (ev, v) => ev((state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}, v);

/* ------------------------------------------------------------------ people set up before */
// Set-up turns them on for someone new (test/ui-onboarding.mjs); someone already set up keeps what
// they have, whatever it is, and nothing is asked of Android at launch.
section('Someone set up before keeps what they have');
{
  const { ctx, page, settle, ev } = await open({ ask: true });
  await settle(2500);
  const r = await ev(() => ({ on: window.GH.ui.S.profile.prefs.notify.on, asked: window.__notify.asked, card: !!document.querySelector('#screen [data-key="notify-ask"]'), handed: window.__notify.schedules.map((x) => x.on) }));
  check('off, as they were: nothing asked at launch, and Android is told there\'s nothing to post', r.on === false && r.asked === 0 && r.handed.every((x) => x === false), r);
  check('Today\'s card still offers them', r.card, r);
  await ev(() => { const U = window.GH.ui; U.S.profile.prefs.notify.on = true; U.S.seen.notifyAsk = true; U.save(true); });
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await settle(2500);
  const on = await ev(() => ({ on: window.GH.ui.S.profile.prefs.notify.on, asked: window.__notify.asked, card: !!document.querySelector('#screen [data-key="notify-ask"]'), last: (window.__notify.schedules.slice(-1)[0] || {}).on }));
  check('on, as they were: still on after a launch, nothing asked, no card, and the schedule handed over', on.on === true && on.asked === 0 && !on.card && on.last === true, on);
  await ctx.close();
}

/* ------------------------------------------------------------------ Today's card */
section('Today: the card that asks, once');
{
  const { ctx, page, settle, ev } = await open({ ask: true });
  const card = () => ev(() => { const c = document.querySelector('#screen [data-key="notify-ask"]'); return c && { text: c.textContent.replace(/\s+/g, ' ').trim(), yes: !!c.querySelector('[data-act="notifyAskYes"]'), no: !!c.querySelector('[data-act="notifyAskNo"]'), afterMain: !!(document.querySelector('#screen [data-key="main"]').compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
  const c = await card();
  check('"Want a nudge on workout days?" with Turn on and Not now, under the workout', c && /^Want a nudge on workout days\?/.test(c.text) && c.yes && c.no && c.afterMain, c);
  check('nothing is asked of Android before they answer', (await ev(() => window.__notify.asked)) === 0);
  const tapped = await ev(() => Date.now());
  await page.click('#screen [data-act="notifyAskYes"]');
  await settle(400);
  check('Turn on: Android asks for the permission (once)', (await ev(() => window.__notify.asked)) === 1);
  await settle(1500);
  const S = await ev(() => ({ on: window.GH.ui.S.profile.prefs.notify.on, seen: window.GH.ui.S.seen.notifyAsk }));
  check('allowed: notifications are on, and the card is answered', S.on === true && S.seen === true, S);
  check('it says so, with the reminder time worked out from their history (5:30 pm)', /Notifications are on/.test(await toasts(ev)) && /Workout days at 5:30 pm/.test(await toasts(ev)), await toasts(ev));
  check('the card folds away', !(await card()));
  const sched = await schedules(ev);
  const last = sched[sched.length - 1];
  const today = await ev(() => window.GH.ui.today());
  // Launch found a badge in the history (ten weigh-ins), waiting sealed: that comes first today.
  const waiting = await ev(() => window.GH.achievements.unopened(window.GH.ui.S));
  const b = last && last.items.find((x) => x.kind === 'badge');
  check(`Android has the schedule: the badge found at launch (${waiting.join()}) two hours on, first that day`, last && last.on === true && waiting.length === 1 && b && b.id === `badge:${waiting[0]}` && b.at >= tapped + 2 * 3600000 && b.at <= tapped + 2 * 3600000 + 8 * 60000 && b.route === 'badges' && !last.items.some((x) => x.id === `workout:${today}`), last && last.items.map((x) => `${x.id} ${hhmm(x.at)}`));
  const days = last.items.map((x) => new Date(x.at).toDateString());
  check('one a day at most, none at night', new Set(days).size === days.length && last.items.every((x) => hhmm(x.at) >= '08:00' && hhmm(x.at) < '21:30'), last.items.map((x) => `${x.kind} ${new Date(x.at).toString().slice(4, 21)}`));
  await settle(4000);

  section('Leaving and opening the app');
  // The badge opened: the day's one is today's workout again.
  await ev(() => { const GH = window.GH, A = GH.achievements, S = GH.ui.S; for (const id of A.unopened(S)) A.markOpened(S, id); A.markSeen(S); GH.ui.save(true); });
  const n0 = (await schedules(ev)).length;
  // On a phone, leaving is heard twice: Android's pause, then the page hidden.
  await ev(() => window.__gh.onPause());
  await visibility(ev, 'hidden');
  const left = await schedules(ev);
  const leftLast = left[left.length - 1];
  check('leaving (Android\'s pause, then the page hidden) hands Android the whole schedule again, once', left.length === n0 + 1 && leftLast.on === true && leftLast.items.length >= 8 && !leftLast.opened, left.length - n0);
  const title = await ev(() => document.querySelector('#screen [data-key="main"] h2').textContent);
  const w = leftLast.items.find((x) => x.id === `workout:${today}`);
  check('with today\'s workout at 5:30 pm, named as Today names it', w && hhmm(w.at) === '17:30' && w.title.startsWith(title.slice(0, 20)) && /, \d+ min$/.test(w.title) && w.route === 'today', { w, title });
  await ev(() => window.__gh.onResume());
  await visibility(ev, 'visible');
  await settle(3000);
  const back = await schedules(ev);
  check('and so does opening it (once), saying it\'s open: what\'s in the shade can go', back.length === n0 + 2 && back[back.length - 1].opened === true, back.length - n0);
  // Today's workout, done: leaving again plans without its reminder.
  await ev(() => {
    const GH = window.GH, B = GH.brain, U = GH.ui, S = U.S, d = U.today();
    B.startWorkout(S, d, { now: Date.now() });
    for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 15 } : {}); }
    B.finishWorkout(S, { rating: 'right', now: Date.now() + 20 * 60000 });
    U.save(true);
    U.render();
  });
  await settle(4000);
  await visibility(ev, 'hidden');
  const after = (await schedules(ev)).pop();
  check('today\'s workout done: leaving takes its reminder off, tomorrow\'s stays', !after.items.some((x) => x.id === `workout:${today}`) && after.items.some((x) => x.id === `workout:${today + 1}`), after.items.map((x) => x.id));
  await visibility(ev, 'visible');
  await settle(3000);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"]');
  await settle(1500);
  check('reloaded: the card doesn\'t come back', !(await card()));
  await ctx.close();
}
{
  const { ctx, page, settle, ev } = await open({ ask: true });
  await page.click('#screen [data-act="notifyAskNo"]');
  await settle(1500);
  const r = await ev(() => ({ card: !!document.querySelector('#screen [data-key="notify-ask"]'), on: window.GH.ui.S.profile.prefs.notify.on, seen: window.GH.ui.S.seen.notifyAsk, asked: window.__notify.asked }));
  check('Not now: the card goes, nothing is turned on or asked', !r.card && r.on === false && r.seen === true && r.asked === 0, r);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await settle(1500);
  check('and it never comes back', !(await ev(() => !!document.querySelector('#screen [data-key="notify-ask"]'))));
  await ctx.close();
}
{
  const { ctx, page, settle, ev } = await open({ ask: true, notify: { answer: 'denied' } });
  await page.click('#screen [data-act="notifyAskYes"]');
  await settle(2000);
  check('Turn on, and Android says no: it says how to allow them', /Notifications are off for Gradient Health/.test(await toasts(ev)) && /Allow them in Android's settings/.test(await toasts(ev)), await toasts(ev));
  await ev(() => window.GH.ui.open('settings'));
  await settle(900);
  const row = await ev(() => { const r = document.querySelector('#screen [data-key="nf-perm"]'); return r && { text: r.textContent, act: (r.querySelector('[data-act]') || {}).dataset.act }; });
  check('and Settings shows Android\'s permission is off, with a way there', row && /Off in Android's settings/.test(row.text) && row.act === 'notifyOpenSettings', row);
  await page.click('#screen [data-key="nf-perm"] [data-act="notifyOpenSettings"]');
  await settle(300);
  check('Open goes to Android\'s notification settings for the app', (await ev(() => window.__notify.opened)) === 1);
  await ctx.close();
}

/* ------------------------------------------------------------------ Settings */
section('Settings: Notifications');
{
  const { ctx, page, settle, ev } = await open({ notify: { permission: 'granted' } });
  await ev(() => window.GH.ui.open('settings'));
  await settle(900);
  const rows = () => ev(() => [...document.querySelectorAll('#screen ul[data-group="notify"] > li, #screen ul[data-group="notify"] > label')].map((li) => (li.querySelector('.rf-list-title') || li).textContent.trim()));
  const sub = (k) => ev((x) => { const i = document.querySelector(`#screen [data-on="notifyKind"][data-k="${x}"]`); return i ? i.closest('.rf-list-row').querySelector('.rf-list-sub').textContent : null; }, k);
  const head = await ev(() => { const h = document.querySelector('#screen .set-list > .rf-list-header[data-group="notify"]'); return h && { text: h.textContent, after: h.previousElementSibling && h.previousElementSibling.dataset.group }; });
  check('a Notifications group after What you track', head && head.text === 'Notifications' && head.after === 'track', head);
  check('off to begin with: only the switch', (await rows()).join() === 'Notifications', await rows());
  await ev(() => document.querySelector('#screen [data-on="notifyOn"]').click());
  await settle(1500);
  check('on (Android allowed it already, so nothing is asked): a switch per kind and the reminder time', (await rows()).join() === 'Notifications,Workout days,Walks and runs,New badges,Good nights,After a few days away,Reminder time' && (await ev(() => window.__notify.asked)) === 0, await rows());
  check('the time is worked out: 5:30 pm, 30 minutes before they usually start', /Auto: 5:30 pm, 30 minutes before you usually start/.test(await ev(() => document.querySelector('#screen [data-key="nf-time"]').textContent)));
  check('the footer says it all stays on the phone', /nothing is sent anywhere/.test(await ev(() => document.querySelector('#screen .rf-list-footer[data-group="notify"]').textContent)));
  check('Good nights says what it needs, if it does (background sync is on here)', (await sub('sleep')) === 'The morning after a good night\'s sleep', await sub('sleep'));
  let n = (await schedules(ev)).length;
  await ev(() => document.querySelector('#screen [data-on="notifyKind"][data-k="badge"]').click());
  await settle(900);
  check('a kind switched off: saved, and Android gets the new schedule', (await ev(() => window.GH.ui.S.profile.prefs.notify.badge)) === false && (await schedules(ev)).length === n + 1);
  await ev(() => document.querySelector('#screen [data-on="notifyKind"][data-k="workout"]').click());
  await settle(900);
  check('workout reminders off: none in the schedule', !(await schedules(ev)).pop().items.some((x) => x.kind === 'workout'));
  await ev(() => document.querySelector('#screen [data-on="notifyKind"][data-k="workout"]').click());
  await settle(900);
  // The reminder time, set by hand.
  await page.click('#screen [data-on="notifyTimeMode"] input[value="set"]', { force: true });
  await settle(900);
  const t0 = await ev(() => ({ time: window.GH.ui.S.profile.prefs.notify.time, label: (document.querySelector('#screen [data-nf-time]') || {}).textContent }));
  check('Pick a time starts from the worked-out one (5:30 pm)', t0.time === 17 * 60 + 30 && t0.label === '5:30 pm', t0);
  await ev(() => { const i = document.querySelector('#screen [data-on="notifyTime"]'); i.value = '600'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(900);
  const t1 = await ev(() => ({ time: window.GH.ui.S.profile.prefs.notify.time, label: document.querySelector('#screen [data-nf-time]').textContent }));
  const today = await ev(() => window.GH.ui.today());
  const w = (await schedules(ev)).pop().items.find((x) => x.id === `workout:${today}`);
  check('slid to 10 am: shown, saved, and the reminders move there', t1.time === 600 && t1.label === '10:00 am' && w && hhmm(w.at) === '10:00', { t1, w });
  await page.click('#screen [data-on="notifyTimeMode"] input[value="auto"]', { force: true });
  await settle(900);
  check('Auto again: the worked-out time', (await ev(() => window.GH.ui.S.profile.prefs.notify.time)) === null && !(await ev(() => document.querySelector('#screen [data-on="notifyTime"]'))));
  // Android's side: a kind switched off there, the permission taken away or never given.
  await ev(() => { window.__notify.blocked = ['sleep']; window.GH.ui.render(); });
  await settle(900);
  check('a kind switched off in Android\'s settings says so', (await sub('sleep')) === 'Off in Android\'s settings', await sub('sleep'));
  await ev(() => { window.__notify.blocked = []; window.__notify.permission = 'ask'; window.GH.ui.render(); });
  await settle(900);
  const ask = await ev(() => { const r = document.querySelector('#screen [data-key="nf-perm"]'); return r && { text: r.textContent, act: (r.querySelector('[data-act]') || {}).dataset.act }; });
  check('not allowed yet: Allow', ask && /Not allowed yet/.test(ask.text) && ask.act === 'notifyAllow', ask);
  await page.click('#screen [data-act="notifyAllow"]');
  await settle(1500);
  check('Allow asks Android, and once it\'s allowed the row goes', (await ev(() => window.__notify.asked)) === 1 && !(await ev(() => document.querySelector('#screen [data-key="nf-perm"]'))) && /Notifications are on/.test(await toasts(ev)));
  // Search.
  const shown = () => ev(() => ({
    groups: [...document.querySelectorAll('#screen .set-list > .rf-list-header:not([data-sub])')].filter((h) => !h.hidden && h.offsetParent).map((h) => h.dataset.group).join(),
    rows: [...document.querySelectorAll('#screen .set-list ul.rf-list > *')].filter((r) => !r.hidden && r.offsetParent && !r.closest('[hidden]')).map((r) => (r.querySelector('.rf-list-title') || r).textContent.trim()),
  }));
  for (const [q, want] of [['reminder', 'Reminder time'], ['notifications', 'Notifications'], ['quiet hours', 'Notifications'], ['badges', 'New badges']]) {
    await page.click('#setQ');
    await page.fill('#setQ', '');
    await page.keyboard.type(q, { delay: 15 });
    await settle(300);
    const r = await shown();
    check(`search "${q}": ${want}`, r.groups.split(',').includes('notify') && r.rows.includes(want), r);
  }
  await page.click('#screen .set-search .rf-search-clear');
  await settle(300);
  n = (await schedules(ev)).length;
  await ev(() => document.querySelector('#screen [data-on="notifyOn"]').click());
  await settle(1500);
  const off = (await schedules(ev)).pop();
  check('switched off: the rows go, and Android\'s schedule is emptied', (await rows()).join() === 'Notifications' && (await schedules(ev)).length === n + 1 && off.on === false && off.items.length === 0, off);

  section('A tapped notification');
  await ev(() => { window.GH.ui.back(); });
  await settle(900);
  await ev(() => window.__gh.onNotifyTap({ id: 'sleep:1', kind: 'sleep', route: 'health' }));
  await settle(900);
  check('a sleep note opens Health', (await ev(() => window.GH.ui.route.tab)) === 'health');
  // None sealed: the badge this state earns at launch (On the scale, the one Today's section opens
  // above) is opened here too. (1.9.0's check ran with it still sealed, so it came up and failed.)
  await ev(() => { const GH = window.GH, A = GH.achievements, S = GH.ui.S; for (const id of A.unopened(S)) A.markOpened(S, id); A.markSeen(S); GH.ui.save(true); });
  await ev(() => window.__gh.onNotifyTap('{"id":"badge:first","kind":"badge","route":"badges"}'));
  await settle(900);
  check('a badge opens the badges', (await ev(() => window.GH.ui.route.view)) === 'badges');
  check('with none sealed, nothing comes up over them', !(await ev(() => !!document.querySelector('.bdg-reveal'))));
  // One still sealed: the tap brings it up over the gallery, sealed, to be opened there.
  const sealed = await ev(() => { const U = window.GH.ui, E = U.S.achievements.earned, id = Object.keys(E)[0]; E[id].opened = false; U.back(); return id; });
  await settle(900);
  await ev(() => window.__gh.onNotifyTap('{"id":"badge:x","kind":"badge","route":"badges"}'));
  for (let i = 0; i < 12 && !(await ev(() => !!document.querySelector('.bdg-reveal'))); i++) await settle(400); // once the push has played
  check('with one sealed, it comes up over the badges, still sealed', (await ev(() => window.GH.ui.route.view)) === 'badges' && (await ev(() => { const r = document.querySelector('.bdg-reveal'); return !!r && r.dataset.cur === 'sealed'; })) && (await ev((id) => window.GH.ui.S.achievements.earned[id].opened === false, sealed)), sealed);
  await ctx.close();
}
{
  const { ctx, settle, ev } = await open({ notify: { tap: '{"id":"workout:1","kind":"workout","route":"plan"}' } });
  await settle(2000);
  check('the app started from a notification opens its screen (Plan)', (await ev(() => window.GH.ui.route.tab)) === 'plan' && (await ev(() => window.__notify.tap)) === '');
  await ctx.close();
}

/* ------------------------------------------------------------------ a plain browser */
section('In a plain browser');
{
  const { ctx, settle, ev } = await open({ browser: true, ask: true });
  check('no card on Today', !(await ev(() => !!document.querySelector('#screen [data-key="notify-ask"]'))));
  await ev(() => window.GH.ui.open('settings'));
  await settle(900);
  const row = await ev(() => { const ul = document.querySelector('#screen ul[data-group="notify"]'); return ul && ul.textContent.replace(/\s+/g, ' ').trim(); });
  check('Settings says notifications are in the Android app', /In the Android app/.test(row || '') && /Gradient Health app on Android/.test(row || '') && !(await ev(() => document.querySelector('#screen [data-on="notifyOn"]'))), row);
  await visibility(ev, 'hidden');
  check('and leaving doesn\'t try to hand anything over', (await ev(() => window.__notify.schedules.length)) === 0);
  await ctx.close();
}

check('no errors in the console', errors.length === 0, errors.slice(0, 5));
await server.close();
await browser.close();
done();
