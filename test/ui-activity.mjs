// Outdoor activities in Chromium at phone size, against a fake Android recorder that plays back a
// 5 km loop (test/actfixture.mjs): the ways in (Today, Health, Progress), the start sheet (auto-pause
// for each kind, the spoken splits) and its permission step, finding GPS (the signal's bars), the
// 3-2-1 with its haptics (and cancelling it), the live numbers, pause and resume, auto-pause, the
// options while it records, Back tucking it away (the pill on Today, the capsule on other tabs), a
// reload mid-activity, a tap asking first and a hold finishing, the summary (the route, splits, heart
// rate from the watch, saved to Health Connect without double counting), new records after a faster
// run, OpenFreeMap's map loading only when asked (pinch and Fit; the pieces it shows kept on the
// phone, so it opens again with nothing asked, offline too; a map never shown failing offline to the
// route drawn here, then coming back online; a theme change recolouring the same map; Clear saved
// maps), the options menu (out of its button, by keyboard too), deleting with Undo (folding away), a
// finish on the notification while the app is away, the live map (from finding GPS into the live
// screen, following you, a finger stopping it, Follow, hiding and showing again), discarding
// (folding away), precise location (asking, Open settings, starting without GPS), and the browser's
// own recorder (navigator.geolocation). The live screen's tiles, map and Pause are glass (solid with
// reduced transparency or increased contrast). OpenFreeMap is faked: nothing leaves the machine.
// Usage: node test/ui-activity.mjs [--dark] [--width=390] [--shots]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';
import { actBridge } from './actfixture.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const shots = process.argv.includes('--shots');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const OUT = join(root, 'build/ui-activity');
if (shots) mkdirSync(OUT, { recursive: true });
const server = await serveDist();
// WebGL through SwiftShader, for the street map.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/tiles\.openfreemap\.org|Failed to load resource/.test(m.text())) errors.push(m.text()); });
// OpenFreeMap, faked: every request is counted; the TileJSON and empty tiles let the map load. With
// mapsOffline, every request fails as with no connection (and is counted in mapsBlocked). tileWeek is
// the week of tiles the TileJSON names (OpenFreeMap's are rebuilt about weekly, at new addresses);
// tiles matching holdTiles wait for an answer until released (held).
const tileRequests = [], mapsBlocked = [], held = [];
let mapsOffline = false, tileWeek = 'test', holdTiles = null;
await ctx.route('https://tiles.openfreemap.org/**', (route) => {
  const url = route.request().url();
  if (mapsOffline) { mapsBlocked.push(url); return route.abort('internetdisconnected'); }
  tileRequests.push(url);
  if (/\/planet$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tilejson: '3.0.0', tiles: [`https://tiles.openfreemap.org/planet/${tileWeek}/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14, attribution: '© OpenMapTiles © OpenStreetMap contributors', vector_layers: ['water', 'landuse', 'landcover', 'park', 'waterway', 'building', 'transportation', 'transportation_name', 'place'].map((id) => ({ id, fields: {} })) }) });
  const tile = () => route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }).catch(() => {});
  if (holdTiles && holdTiles.test(url)) return new Promise((done) => held.push(() => done(tile())));
  return tile();
});
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
await page.addInitScript(actBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
// A route change's motion runs in real time (Refract's springs, up to about 650 ms), however far the
// page's clock is moved on: a step that changed the route waits for it to land, so what's clicked or
// measured next isn't still sliding in.
const calm = () => Promise.race([page.evaluate(() => window.GH.ui.motion && window.GH.ui.motion.settled && window.GH.ui.motion.settled()), page.waitForTimeout(2000)]).catch(() => {});
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 350)); await calm(); };
const shot = async (name) => { if (shots) await page.screenshot({ path: join(OUT, `${width}-${dark ? 'dark' : 'light'}-${name}.png`) }); };
const fake = () => page.evaluate(() => ({ calls: window.__act.calls.slice(), writes: window.__act.writes.slice(), sessions: window.__act.sessions.slice(), rec: window.__act.rec && { id: window.__act.rec.id, active: window.__act.rec.active, paused: window.__act.rec.paused, points: window.__act.rec.points.length } }));
const live = () => page.evaluate(() => {
  const el = document.getElementById('actlive');
  if (!el || el.hidden) return null;
  const q = (s) => { const e = el.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  return { phase: el.dataset.phase, type: el.dataset.type, time: q('[data-live="time"]'), cap: q('[data-live="cap"]'), dist: q('[data-live="dist"]'), avg: q('[data-live="avg"]'), cur: q('[data-live="cur"]'), steps: q('[data-live="steps"]'), splitl: q('[data-live="splitl"]'), gps: el.querySelector('.al-gps') && el.querySelector('.al-gps').dataset.gps, bars: el.querySelector('.al-gps') && el.querySelector('.al-gps').dataset.bars, gpsText: q('.al-gps-t'), h1: q('.al-h1'), sub: q('.al-sub'), count: q('.al-count-n'), route: el.querySelectorAll('.al-map .rt-line').length, banner: q('.al-banner'), actions: [...el.querySelectorAll('.al-actions [aria-label], .al-actions .rf-btn')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()) };
});
// What folds away (U.actFoldAway, for a discard, a delete or a cancelled 3-2-1): how many parts, and
// how many were already moving when it was asked.
const watchFolds = () => page.evaluate(() => {
  const U = window.GH.ui;
  window.__folds = [];
  if (U.actFoldAway.watched) return;
  const fold = U.actFoldAway;
  U.actFoldAway = (list, o) => {
    const els = Array.from(list || []);
    const p = fold(els, o);
    window.__folds.push({ n: els.length, moving: els.filter((e) => e.getAnimations && e.getAnimations().length > 0).length });
    return p;
  };
  U.actFoldAway.watched = true;
});
// A switch in the open sheet, flipped.
const flip = (on) => page.evaluate((x) => document.querySelector(`dialog[open] input[data-on="${x}"]`).click(), on);
const secs = (t) => { const p = String(t || '').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
const S = () => page.evaluate(() => { const S = window.GH.ui.S; return { live: S.actLive, n: S.activities.length, ids: S.activities.map((a) => a.id) }; });
const permText = () => page.evaluate(() => {
  const d = document.querySelector('dialog[open] .at-perm');
  return d ? { rows: [...d.querySelectorAll('.at-perm-row .t-subhead')].map((e) => e.textContent.trim()), note: ((d.querySelector('.notice') || {}).textContent || '').replace(/\s+/g, ' ').trim(), buttons: [...d.querySelectorAll('.at-perm-actions button')].map((b) => b.textContent.trim()) } : { rows: [], note: '', buttons: [] };
});
// Press and hold the finish button for a second.
async function holdFinish() {
  const b = await (await page.$('#actlive .al-finish .al-btn-disc')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await settle(1200);
  await page.mouse.up();
  await settle(2500);
}

section('Ways in');
const cta = await page.evaluate(() => { const c = document.querySelector('#screen .act-cta'); return c && c.textContent.replace(/\s+/g, ' ').trim(); });
check('Today has a card to record a walk, run or ride', /Record a walk, run or ride/.test(cta || '') && /with GPS/.test(cta), cta);
await page.evaluate(() => window.GH.ui.go('health'));
await settle();
check('Health\'s Activity section starts one too', await page.evaluate(() => !!document.querySelector('#screen [data-key="act-start"] [data-act="actStart"]')));
await page.evaluate(() => window.GH.ui.go('progress'));
await settle();
const recEmpty = await page.evaluate(() => { const s = document.querySelector('#screen .act-records'); return s && s.textContent.replace(/\s+/g, ' '); });
check('Progress has a Personal records section, empty for now', /fastest 1 km, mile, 5 km and 10 km/.test(recEmpty || ''), recEmpty);
await page.evaluate(() => window.GH.ui.go('today'));
await settle();

section('Starting: the kind of activity, then permissions');
await page.click('#screen .act-cta');
await settle(900);
const tiles = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .at-tile')].map((t) => t.querySelector('.at-name').textContent));
check('a sheet with a big tile for each kind', tiles.join() === 'Walk,Run,Hike,Ride,Other', tiles);
const sheetOpts = () => page.evaluate(() => {
  const d = document.querySelector('dialog[open] .at-opts');
  const v = d && d.querySelector('input[data-on="actVoice"]');
  return d && { chips: [...d.querySelectorAll('.at-auto .rf-chip')].map((c) => `${c.textContent.trim()}:${c.getAttribute('aria-pressed')}`).join(), voice: v ? v.checked : null };
});
let so = await sheetOpts();
check('under them, how it records: auto-pause for each kind (on for runs and rides) and the spoken splits (off)', so && so.chips === 'Walks:false,Runs:true,Hikes:false,Rides:true,Other:false' && so.voice === false, so);
await page.click('dialog[open] .at-auto .rf-chip[data-v="walk"]');
await settle(400);
so = await sheetOpts();
check('a chip turns auto-pause on for that kind, remembered', /Walks:true/.test(so.chips) && (await page.evaluate(() => window.GH.ui.S.profile.prefs.actAuto.walk === true)), so);
await page.click('dialog[open] .at-auto .rf-chip[data-v="walk"]');
await settle(400);
so = await sheetOpts();
check('and off again', /Walks:false/.test(so.chips) && (await page.evaluate(() => window.GH.ui.S.profile.prefs.actAuto.walk === false)), so);
await shot('01-sheet');
await page.evaluate(() => { window.__act.searchMs = 9000; });
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(900);
const perm = await page.evaluate(() => { const d = document.querySelector('dialog[open] .at-perm'); return d && { rows: [...d.querySelectorAll('.at-perm-row .t-subhead')].map((e) => e.textContent.trim()), text: d.textContent.replace(/\s+/g, ' ') }; });
check('it says what it asks for and why', perm && perm.rows[0] === 'Precise location' && /Physical activity, optional/.test(perm.rows[1]) && /Notifications, optional/.test(perm.rows[2]) && /stays on this phone/.test(perm.text), perm);
await shot('02-permissions');
await page.click('dialog[open] [data-act="actPerm"]');
await settle(1300);
let f = await fake();
let L = await live();
check('Continue asks Android, and the recording starts', f.calls.includes('actRequestPermissions') && f.calls.some((c) => /^actStart:.*"type":"run"/.test(c)));
check('with auto-pause on (a run) and the spoken splits off', f.calls.some((c) => /^actStart:.*"autoPause":true,"voice":false/.test(c)), f.calls.find((c) => c.startsWith('actStart:')));
check('its clock waits (paused) while GPS finds you', f.calls[f.calls.length - 1] === 'actPause' && f.rec.paused);
check('the live screen opens on finding your location', L && L.phase === 'search' && L.h1 === 'Finding your location' && /32 m/.test(L.sub) && L.gps === 'searching', L);
check('the GPS signal: one bar (accurate to 32 m), still finding', L.bars === '1' && L.gpsText === 'Finding GPS', [L.bars, L.gpsText]);
const id = (await S()).live.id;
check('the page remembers which activity it is, not started yet', !!id && (await S()).live.goAt === null);
await shot('03-search');

section('Finding GPS, then 3-2-1');
await settle(9500);
L = await live();
check('it says when GPS is ready', L.h1 === 'GPS is ready' && L.gps === 'ok' && /about 5 m/.test(L.sub), L);
check('three bars and how accurate, with a feel of its own as it locks on', L.bars === '3' && L.gpsText === 'GPS ±5 m' && (await page.evaluate(() => window.__haptics.filter((k) => k === 'actGps').length === 1)), [L.bars, L.gpsText]);
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('#actlive [data-act="alGo"]');
await settle(250);
L = await live();
check('Start counts down from 3', L.phase === 'countdown' && L.count === '3', L);
await shot('04-countdown');
await settle(3200);
const haptics = await page.evaluate(() => window.__haptics.slice());
check('a countdown haptic each second, then the start\'s own', haptics.filter((k) => k === 'countdown').length === 3 && haptics.includes('actGo') && haptics.lastIndexOf('countdown') < haptics.indexOf('actGo'), haptics);
f = await fake();
check('then the clock starts', f.calls[f.calls.length - 1] === 'actResume' && !f.rec.paused && (await S()).live.goAt > 0);

section('Live numbers');
await settle(5 * 60 * 1000);
L = await live();
// The page's clock also runs in real time between steps, so a busy machine adds a few seconds.
check('the time', secs(L.time) >= 299 && secs(L.time) <= 305, L.time);
check('the distance, in miles (the person uses lb)', Math.abs(parseFloat(L.dist) - 0.62) <= 0.03, L.dist);
// 5:00 per km is 8:03 per mile; the pace now is over the last 30 seconds, so GPS noise shows more.
check('the average pace and the pace now', Math.abs(secs(L.avg) - 483) <= 8 && /^Now \d:\d\d$/.test(L.cur) && Math.abs(secs(L.cur.slice(4)) - 483) <= 15, [L.avg, L.cur]);
check('steps from the phone', Number(L.steps.replace(/,/g, '')) > 1200, L.steps);
check('the split it\'s in', L.splitl === 'Mile 1', L.splitl);
check('the route so far', L.route >= 1);
{
  // The tiles, the map and Pause are Refract's glass (thick, lit when pressed); with reduced
  // transparency or increased contrast they're solid.
  const glass = () => page.evaluate(() => {
    const el = document.getElementById('actlive');
    const parts = [...el.querySelectorAll('.al-m, .al-map, .al-pause .al-btn-disc')];
    // A fill's alpha (rgba(), or a color function's "/ alpha").
    const alpha = (c) => { const m = /\/\s*([\d.]+)\)$/.exec(c) || /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(c); return m ? Number(m[1]) : 1; };
    // Solid: Refract's solid glass fill (--glass-fill-solid, nearly opaque), not the see-through one.
    return { n: parts.length, glass: parts.every((e) => e.matches('.rf-glass[data-interactive]')), thick: el.querySelectorAll('.al-m.rf-glass[data-variant="thick"], .al-map.rf-glass[data-variant="thick"]').length, blurred: parts.filter((e) => /blur/.test(getComputedStyle(e).backdropFilter)).length, solid: parts.filter((e) => alpha(getComputedStyle(e).backgroundColor) >= 0.95).length };
  });
  const g = await glass();
  check('the tiles, the map and Pause are glass (the tiles and map thick), frosted', g.n >= 4 && g.glass && g.thick === g.n - 1 && g.blurred === g.n && g.solid < g.n, g);
  await page.evaluate(() => document.documentElement.setAttribute('data-rf-transparency', 'reduced'));
  await page.waitForTimeout(400); // the fill's own transition
  const rt = await glass();
  await page.evaluate(() => document.documentElement.removeAttribute('data-rf-transparency'));
  await page.waitForTimeout(400);
  check('with reduced transparency their fill is solid (Refract\'s fallback)', rt.solid === rt.n, rt);
}
await shot('05-live');
await page.evaluate(() => { window.__haptics.length = 0; });
// Mile 1 falls at about 8:03.
await settle(2.95 * 60 * 1000);
let banner = null;
for (let i = 0; i < 20 && !banner; i++) { await settle(1000); banner = (await live()).banner; }
check('a banner and a split\'s buzz for each mile', /^Mile 1 · 8:0\d$/.test(banner || '') && (await page.evaluate(() => window.__haptics.includes('actSplit'))), banner);
await settle(20000);

section('Pause and resume');
await page.click('#actlive [data-act="alPause"]');
await settle(900);
L = await live();
const pausedAt = secs(L.time), distAt = L.dist;
f = await fake();
check('Pause pauses the recorder and says so, with its own feel', f.calls[f.calls.length - 1] === 'actPause' && L.phase === 'paused' && L.cap === 'Paused' && (await page.evaluate(() => window.__haptics.includes('actPause'))), L);
check('with Resume and Finish to hand', L.actions.includes('Resume') && L.actions.some((a) => /^Finish/.test(a)), L.actions);
await shot('06-paused');
await settle(2 * 60 * 1000);
L = await live();
check('the clock and distance hold still while paused', secs(L.time) === pausedAt && L.dist === distAt, [L.time, pausedAt, L.dist, distAt]);
await page.click('#actlive [data-act="alResume"]');
await settle(60 * 1000);
L = await live();
check('Resume carries on from there', Math.abs(secs(L.time) - (pausedAt + 60)) <= 2 && L.phase === 'live', [L.time, pausedAt]);
const pauses = (await S()).live.pauses;
check('the pause is remembered', pauses.length === 1 && pauses[0][1] - pauses[0][0] >= 119000, pauses);
check('Resume has its own feel', await page.evaluate(() => window.__haptics.includes('actResume')));

section('Auto-pause');
await page.evaluate(() => { window.__haptics.length = 0; window.__act.standing = true; });
await settle(3000);
check('stopping for a moment doesn\'t stop the clock', (await live()).phase === 'live');
await settle(6000);
L = await live();
const autoAt = secs(L.time);
check('standing still, auto-pause stops the clock and says so, with a feel of its own', L.phase === 'autopaused' && L.cap === 'Auto-paused' && (await page.evaluate(() => window.__haptics.includes('actAutoPause') && !window.__haptics.includes('actPause'))), [L.phase, L.cap, await page.evaluate(() => window.__haptics.slice())]);
check('Resume and Finish to hand, as for a pause', L.actions.includes('Resume') && L.actions.some((a) => /^Finish/.test(a)), L.actions);
await shot('06b-autopaused');
await settle(30000);
L = await live();
check('the clock holds while you stand', secs(L.time) === autoAt, [L.time, autoAt]);
await page.evaluate(() => { window.__act.standing = false; });
await settle(3000);
L = await live();
check('moving again, it goes on by itself, with its own feel', L.phase === 'live' && L.cap === 'Time' && (await page.evaluate(() => window.__haptics.includes('actAutoResume'))), [L.phase, L.cap]);
const pauses2 = (await S()).live.pauses;
check('the stop is in the pause log too', pauses2.length === 2 && pauses2[1][1] - pauses2[1][0] >= 29000, pauses2);

section('Its options while it records');
await page.click('#actlive [data-act="alMenu"]');
await settle(800);
const alMenu = () => page.evaluate(() => {
  const d = document.querySelector('dialog[open]');
  const sw = (on) => { const i = d && d.querySelector(`input[data-on="${on}"]`); return i ? i.checked : null; };
  return d && { auto: sw('alAuto'), voice: sw('actVoice'), rows: [...d.querySelectorAll('.rf-list-title')].map((t) => t.textContent.trim()).join() };
});
const am = await alMenu();
check('auto-pause (on, for a run), the spoken splits (off), and discard', am && am.auto === true && am.voice === false && am.rows === 'Auto-pause,Spoken splits,Discard this run', am);
await flip('alAuto');
await settle(400);
await flip('actVoice');
await settle(400);
f = await fake();
check('the recorder takes a change at once', f.calls.includes('actSetOptions:{"autoPause":false}') && f.calls.includes('actSetOptions:{"voice":true}'), f.calls.slice(-4));
check('and it\'s remembered: auto-pause for runs, the spoken splits for all', await page.evaluate(() => { const p = window.GH.ui.S.profile.prefs; return p.actAuto.run === false && p.actVoice === true; }));
await flip('alAuto');
await settle(400);
await flip('actVoice');
await settle(400);
check('and back', await page.evaluate(() => { const p = window.GH.ui.S.profile.prefs; return p.actAuto.run === true && p.actVoice === false; }) && (await fake()).calls.slice(-2).join() === 'actSetOptions:{"autoPause":true},actSetOptions:{"voice":false}');
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('The map button asks first');
await page.click('#actlive [data-act="alMaps"]');
await settle(700);
const mq = await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); return d && d.textContent.replace(/\s+/g, ' '); });
check('the first time, it asks before showing a map: whose, and what that service sees', /Show a map from OpenFreeMap\?/.test(mq || '') && /sees the area it shows/.test(mq || '') && /Not now/.test(mq || ''), mq);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Not now').click(); });
await settle(700);
check('Not now leaves it off, and nothing is loaded', (await page.evaluate(() => window.GH.ui.S.profile.prefs.actMaps === undefined && !document.querySelector('#actlive .al-map-slot') && !window.GH.actmap)) && tileRequests.length === 0);

section('Back tucks it away');
await page.evaluate(() => window.__gh.back());
await settle(900);
// Its words (less the old ones cross-fading out while Today's main button shape-shifts into it).
const pill = await page.evaluate(() => { const b = document.querySelector('#float .act-pill'); if (!b) return null; const c = b.cloneNode(true); c.querySelectorAll('.rf-ghost').forEach((g) => g.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); });
check('Back hides the live screen and Today shows a pill with the time', !(await live()) && /^Run · \d+:\d\d$/.test(pill || ''), pill);
await shot('07-pill');
await settle(5000);
const pill2 = await page.evaluate(() => document.querySelector('#float [data-act-clock]').textContent);
check('the pill\'s clock keeps running', secs(pill2) > secs(pill.split('· ')[1]), [pill, pill2]);
await page.evaluate(() => window.GH.ui.go('plan'));
await settle(900);
const cap = await page.evaluate(() => { const a = document.getElementById('accessory'); return !a.hidden && a.innerText.replace(/\s+/g, ' ').trim(); });
check('other tabs show it in the capsule over the tab bar', /^Run ?\d+:\d\d · \d+\.\d\d mi Open$/.test(cap || ''), cap);
await page.click('#accessory [data-act="actOpenLive"]');
await settle(900);
check('Open brings the live screen back', (await live()).phase === 'live');

section('A reload mid-activity');
const before = secs((await live()).time);
await page.reload();
await page.waitForSelector('#actlive:not([hidden])', { timeout: 15000 });
await settle(1200);
L = await live();
const recClock = await page.evaluate(() => { const s = JSON.parse(window.AndroidBridge.actState()); return Math.round(s.elapsedMs / 1000); });
check('it goes straight back to the live screen', L && L.phase === 'live' && (await S()).live.id === id, L);
check('with the clock running on from where it was (the recorder\'s)', secs(L.time) >= before && Math.abs(secs(L.time) - recClock) <= 2, [L.time, before, recClock]);
check('and the route drawn again', L.route >= 1);

section('Finishing');
await settle(15 * 60 * 1000);
await page.click('#actlive .al-finish');
await settle(600);
const ask = await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); return d && d.textContent.replace(/\s+/g, ' '); });
check('a tap asks first (a pocket can\'t end it)', /Finish your run\?/.test(ask || '') && /Keep going/.test(ask), ask);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); window.Refract.dialog.close(d, 'cancel'); });
await settle(600);
check('Keep going keeps it going', (await live()).phase === 'live' && (await fake()).rec.active);
await page.evaluate(() => { window.__haptics.length = 0; });
const fin = await page.$('#actlive .al-finish .al-btn-disc');
const box = await fin.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await settle(500);
check('holding fills the ring', await page.evaluate(() => document.querySelector('#actlive .al-finish').classList.contains('is-holding')));
await settle(700);
await page.mouse.up();
await settle(1500);
f = await fake();
const st = await S();
check('holding for a second finishes it, with a detent as the hold is recognized', f.calls.includes('actStop') && (await page.evaluate(() => window.__haptics.includes('detent'))));
check('it\'s saved, and the recording cleared', st.live === null && st.n === 1 && st.ids[0] === id && f.calls.includes(`actClear:${id}`));
check('the summary opens', await page.evaluate((x) => window.GH.ui.route.view === 'activity' && window.GH.ui.route.arg === x, id));

section('The summary');
await settle(1500);
const sum = await page.evaluate(() => {
  const s = document.getElementById('screen');
  const t = (q) => { const e = s.querySelector(q); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  return {
    title: t('.as-title'), when: t('.as-when'), hero: [...s.querySelectorAll('.as-stat')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    lines: s.querySelectorAll('.am-box .rt-line').length, marks: s.querySelectorAll('.am-box .rt-km').length, ends: s.querySelectorAll('.am-box .rt-start, .am-box .rt-end').length,
    splits: [...s.querySelectorAll('.sp-tbl tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
    hr: t('.hr-card .ch-value'), zones: s.querySelectorAll('.hz-row').length, tiles: [...s.querySelectorAll('.as-tile')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    hc: t('.as-hc'), legend: t('.am-legend'),
  };
});
check('its title and when', sum.title === 'Morning run' && /^Run · Mon, Oct 19 · 8:1\d am$/.test(sum.when), [sum.title, sum.when]);
check('distance, moving time and pace', /^\d\.\d\d ?mi Distance$/.test(sum.hero[0]) && /^2\d:\d\d Time$/.test(sum.hero[1]) && /^[78]:\d\d ?\/mi Avg pace$/.test(sum.hero[2]), sum.hero);
check('the route, coloured by pace, with start, end and a marker per mile', sum.lines >= 1 && sum.ends === 2 && sum.marks >= 2, [sum.lines, sum.marks, sum.ends]);
check('a legend for the colours', /Slower/.test(sum.legend) && /Faster/.test(sum.legend) && /your average/.test(sum.legend), sum.legend);
check('splits per mile, with what\'s left', sum.splits.length >= 3 && /^1 [78]:\d\d/.test(sum.splits[0]) && /^0\.\d\d /.test(sum.splits[sum.splits.length - 1]), sum.splits);
f = await fake();
check('the watch\'s data is read for the activity\'s time', f.sessions.length >= 1 && f.sessions[0].id === id && f.sessions[0].end > f.sessions[0].start);
check('heart rate over time, with average, highest and zones', /^avg \d+ · max \d+ bpm$/.test(sum.hr || '') && sum.zones === 5, [sum.hr, sum.zones]);
check('steps and calories from the watch', sum.tiles.some((x) => /^Steps 6,420 from your watch$/.test(x)) && sum.tiles.some((x) => /^Calories 377 kcal active, from your watch$/.test(x)), sum.tiles);
check('saved to Health Connect by itself (saving workouts is on)', /Saved to Health Connect/.test(sum.hc || ''), sum.hc);
const w = f.writes[0];
check('with its route, and no distance or calories the watch already recorded', w && w.id === id && w.type === 'run' && w.route.length > 20 && w.route.every((p) => p.length === 4 && p[0] >= w.start - 1000 && p[0] <= w.end + 1000) && w.distanceM === null && w.activeKcal === null, w && { n: w.route.length, d: w.distanceM, k: w.activeKcal });
await shot('08-summary');
await page.evaluate(() => { document.getElementById('screen').scrollTop = 99999; });
await settle(400);
await shot('09-summary-end');
const ex = await page.evaluate(() => { const GH = window.GH; const S = GH.ui.S; const a = S.activities[0]; const d = S.health.days[a.day]; return d && d.exercise && d.exercise.find((e) => e.src === 'activity'); });
check('it counts as the day\'s exercise', ex && ex.typeName === 'running' && ex.minutes >= 20, ex);

section('New records');
await page.evaluate(() => { const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.go('today'); window.__act.mps = 1000 / 285; window.__act.searchMs = 0; });
await settle(900);
await page.click('#screen .act-cta');
await settle(900);
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(900);
check('permissions already allowed: straight to finding GPS', (await live()).phase === 'search');
await settle(1500);
await page.click('#actlive [data-act="alGo"]');
await settle(1100);
await watchFolds();
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('#actlive [data-act="alCancelCount"]');
await page.waitForFunction(() => document.getElementById('actlive').dataset.phase === 'search', null, { timeout: 5000 }).catch(() => {});
await settle(4000);
const cc = await page.evaluate(() => ({ phase: document.getElementById('actlive').dataset.phase, folds: window.__folds.slice(), haptics: window.__haptics.slice(), goAt: window.GH.ui.S.actLive && window.GH.ui.S.actLive.goAt }));
check('Cancel in the 3-2-1 folds the number away and goes back to GPS, the clock not started', cc.phase === 'search' && cc.folds.length === 1 && cc.folds[0].moving > 0 && cc.haptics[0] === 'back' && cc.goAt === null, cc);
await page.click('#actlive [data-act="alGo"]');
await settle(3500);
await settle(27 * 60 * 1000);
const fin2 = await page.$('#actlive .al-finish .al-btn-disc');
const b2 = await fin2.boundingBox();
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
await page.mouse.down();
await settle(1200);
await page.mouse.up();
await settle(2500);
const recs = await page.evaluate(() => [...document.querySelectorAll('#screen .as-rec')].map((e) => `${e.querySelector('.as-rec-l').textContent}: ${e.querySelector('.as-rec-v').textContent}`));
check('a faster run shows its new records', recs.some((x) => /^Fastest 5 km: 2\d:\d\d$/.test(x)) && recs.some((x) => /^Fastest mile: /.test(x)) && recs.some((x) => /^Longest run: /.test(x)), recs);
await shot('10-records');
await page.evaluate(() => { const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.go('progress'); });
await settle(1200);
const tilesP = await page.evaluate(() => [...document.querySelectorAll('#screen .rec-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
check('Progress shows the records, each opening its activity', tilesP.length >= 3 && /^Fastest 5 km 2\d:\d\d Oct 19$/.test(tilesP[0]) && tilesP.some((x) => /^Fastest mile /.test(x)), tilesP);
await page.evaluate(() => document.querySelector('#screen .rec-tile').scrollIntoView({ block: 'center' }));
await shot('11-progress');
await page.click('#screen .rec-tile');
await settle(900);
check('a record opens its activity', await page.evaluate(() => window.GH.ui.route.view === 'activity'));

section('The map, only when asked');
check('nothing was asked of OpenFreeMap so far', tileRequests.length === 0, tileRequests.slice(0, 3));
check('the map chunk isn\'t loaded', await page.evaluate(() => !window.GH.actmap));
await page.click('#screen [data-act="actMaps"]');
await settle(1500);
await page.waitForFunction(() => { const b = document.querySelector('#screen .am-box'); return b && /ready|failed/.test(b.getAttribute('data-streets') || ''); }, null, { timeout: 30000 }).catch(() => {});
await settle(500);
const streets = await page.evaluate(() => {
  const b = document.querySelector('#screen .am-box');
  const size = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
  return { state: b.getAttribute('data-streets'), canvas: !!b.querySelector('.am-streets canvas'), box: size(b), map: size(b.querySelector('.am-streets')), cv: size(b.querySelector('.am-streets canvas')), attr: (b.querySelector('.am-attr') || {}).textContent, pref: window.GH.ui.S.profile.prefs.actMaps, chunk: !!window.GH.actmap };
});
check('Show map loads OpenFreeMap\'s map (MapLibre\'s chunk): its TileJSON, then its tiles', streets.chunk && tileRequests.some((u) => /tiles\.openfreemap\.org\/planet$/.test(u)) && tileRequests.some((u) => /\/planet\/test\/\d+\/\d+\/\d+\.pbf$/.test(u)), tileRequests.slice(0, 4));
check('the map draws over the whole box, with OpenFreeMap\'s attribution', streets.state === 'ready' && streets.canvas && streets.map === streets.box && streets.cv === streets.box && /© OpenMapTiles © OpenStreetMap contributors/.test(streets.attr || ''), streets);
check('the choice is remembered', streets.pref === true);
// Two fingers zoom the map (MapLibre's cooperative gestures), while the page itself stays at its size.
{
  const cdp = await ctx.newCDPSession(page);
  const box = await page.evaluate(() => { const r = document.querySelector('#screen .am-streets').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const z0 = await page.evaluate(() => Number(document.querySelector('#screen .am-streets .am-engine').dataset.zoom));
  let t = Date.now() / 1000;
  const at = (d) => [{ x: box.x - 20 - d, y: box.y, id: 1 }, { x: box.x + 20 + d, y: box.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0), timestamp: t });
  for (let i = 1; i <= 14; i++) { t += 0.016; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(5 * i), timestamp: t }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.016 });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ zoom: Number(document.querySelector('#screen .am-streets .am-engine').dataset.zoom), scale: window.visualViewport.scale, fit: !document.querySelector('#screen .am-fit').hidden }));
  check('a pinch zooms the street map in, not the page', after.zoom > z0 + 0.3 && after.scale === 1, { z0, ...after });
  check('and a button appears to show the whole route again', after.fit, after);
  await page.click('#screen .am-fit');
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => ({ zoom: Number(document.querySelector('#screen .am-streets .am-engine').dataset.zoom), fit: !document.querySelector('#screen .am-fit').hidden }));
  check('which fits the route again and goes', Math.abs(back.zoom - z0) < 0.2 && !back.fit, { z0, ...back });
  await cdp.detach();
}
await shot('12-streets');
// What the summary's map is: its id (a new one each time a map is made), its theme, its background.
const sm = () => page.evaluate(() => {
  const b = document.querySelector('#screen .am-box'), e = b && b.querySelector('.am-engine');
  return { state: b && b.getAttribute('data-streets'), map: e && e.dataset.map, dark: e && e.dataset.dark, land: e && e.ghMap && e.ghMap.getPaintProperty('land', 'background-color'), routeCase: e && e.ghMap && e.ghMap.getPaintProperty('route-case', 'line-color'), toast: ([...document.querySelectorAll('.rf-toast')].pop() || {}).textContent || '' };
});
const showMap = async (wait) => {
  await page.click('#screen [data-act="actMaps"]');
  await settle(1500);
  await page.waitForFunction(() => { const b = document.querySelector('#screen .am-box'); return b && /ready|failed/.test(b.getAttribute('data-streets') || ''); }, null, { timeout: wait || 30000 }).catch(() => {});
  await settle(500);
};
const hideMap = async () => { await page.click('#screen [data-act="actMaps"]'); await settle(700); };
{
  // A theme change: the same map, recoloured, with nothing loaded again.
  const m0 = await sm(), t0 = tileRequests.length;
  await page.evaluate((t) => { const U = window.GH.ui; U.S.profile.prefs.theme = t; U.applyPrefs(); }, dark ? 'light' : 'dark');
  await settle(1200);
  const m1 = await sm();
  check('a theme change recolours the same map in place, loading nothing', m1.map === m0.map && m1.dark !== m0.dark && m1.land !== m0.land && m1.state === 'ready' && tileRequests.length === t0, [m0, m1, tileRequests.length - t0]);
  await page.evaluate(() => { const U = window.GH.ui; U.S.profile.prefs.theme = 'system'; U.applyPrefs(); });
  await settle(1200);
  const m2 = await sm();
  check('and back', m2.map === m0.map && m2.land === m0.land && m2.routeCase === m0.routeCase, [m0, m2]);
  // The pieces it showed are kept: shown again, it asks OpenFreeMap for nothing.
  const kept = await page.evaluate(() => window.GH.ui.mapPieces.count());
  check('the map pieces it showed are kept on the phone', kept >= 2, kept);
  await hideMap();
  const t1 = tileRequests.length;
  await showMap();
  const again = await sm();
  check('shown again, it draws from them, asking OpenFreeMap for nothing', again.state === 'ready' && again.map !== m0.map && tileRequests.length === t1, [again, tileRequests.slice(t1)]);
  // No connection: the kept pieces still draw it.
  await hideMap();
  mapsOffline = true;
  await showMap();
  const off = await sm();
  check('with no connection, a map shown before still draws, from the phone', off.state === 'ready' && mapsBlocked.length === 0, [off.state, mapsBlocked.slice(0, 3)]);
  // OpenFreeMap's next week (its tiles at new addresses), the app opened again: the map draws at once
  // from the kept pieces (the new week's are held back here, so it can't be from them), and the new
  // week's come in behind them, in their place; shown again, it draws from those, asking for nothing.
  await hideMap();
  mapsOffline = false;
  tileWeek = 'w2';
  holdTiles = /\/planet\/w2\//;
  const k0 = await page.evaluate(() => window.GH.ui.mapPieces.count());
  const actId = await page.evaluate(() => window.GH.ui.route.arg);
  await page.reload();
  await page.waitForSelector('#screen[data-view]');
  await page.evaluate((id) => { const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.open('activity', id); }, actId);
  await settle(1200);
  const tw = tileRequests.length;
  await showMap();
  const wk = await sm(), asked = tileRequests.slice(tw);
  check('when OpenFreeMap has a new week\'s map, one shown before still draws at once, from the kept pieces', wk.state === 'ready' && asked.some((u) => /\/planet$/.test(u)) && asked.some((u) => /\/planet\/w2\//.test(u)) && held.length > 0, [wk.state, held.length, asked.slice(0, 4)]);
  holdTiles = null;
  held.splice(0).forEach((f) => f());
  await settle(1500);
  await page.waitForTimeout(600);
  const k1 = await page.evaluate(() => window.GH.ui.mapPieces.count());
  await hideMap();
  const tx = tileRequests.length;
  await showMap();
  check('and the new week\'s pieces take their place: shown again, it asks for nothing', (await sm()).state === 'ready' && k1 === k0 && tileRequests.length === tx, [k0, k1, tileRequests.slice(tx, tx + 3)]);
  // No connection and nothing kept (Settings, Clear saved maps): the route drawn here stays, and the
  // map comes once the connection is back.
  await hideMap();
  mapsOffline = true;
  await page.evaluate(() => window.GH.ui.act.mapPiecesClear());
  await settle(900);
  const cleared = { n: await page.evaluate(() => window.GH.ui.mapPieces.count()), toast: await page.evaluate(() => ([...document.querySelectorAll('.rf-toast')].pop() || {}).textContent || '') };
  check('Clear saved maps (Settings) deletes them', cleared.n === 0 && /Saved maps cleared/.test(cleared.toast), cleared);
  await showMap(25000);
  // (Its toast waits for Clear saved maps' to go.)
  await page.waitForFunction(() => [...document.querySelectorAll('.rf-toast')].some((t) => /Couldn't load the map/.test(t.textContent)), null, { timeout: 10000 }).catch(() => {});
  const fo = await sm();
  fo.toast = await page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '));
  const drawn = await page.evaluate(() => { const r = document.querySelector('#screen .am-box > .rt'); return !!r && getComputedStyle(r).opacity === '1'; });
  check('with no connection and nothing kept, the route drawn here stays, and it says why', fo.state === 'failed' && drawn && /Couldn't load the map/.test(fo.toast) && mapsBlocked.length >= 1, [fo, drawn, mapsBlocked.length]);
  mapsOffline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(1500);
  await page.waitForFunction(() => { const b = document.querySelector('#screen .am-box'); return b && b.getAttribute('data-streets') === 'ready'; }, null, { timeout: 30000 }).catch(() => {});
  check('back online, the map comes by itself', (await sm()).state === 'ready');
}
await hideMap();
check('Hide map goes back to the route drawn here', await page.evaluate(() => !document.querySelector('#screen .am-streets canvas') && window.GH.ui.S.profile.prefs.actMaps === false));
// Maps on again, for the live map further on.
await showMap();

section('Options, a menu out of its button');
{
  // Activity options is only a list: a menu that grows out of the button (U.menu), not a sheet.
  await page.click('#topbar [data-act="actMenu"]');
  await settle(600);
  const m = await page.evaluate(() => {
    const menu = document.querySelector('.rf-menu:popover-open'), btn = document.querySelector('#topbar [data-act="actMenu"]');
    return menu && { role: menu.getAttribute('role'), items: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()), controls: btn.getAttribute('aria-controls') === menu.id && btn.getAttribute('aria-haspopup') === 'menu', glass: menu.matches('.rf-glass'), onMenu: document.activeElement === menu, sheet: !!document.querySelector('dialog.gh-sheet[open]') };
  });
  check('Activity options opens a menu out of its button, not a sheet: Rename, Delete', m && m.role === 'menu' && m.glass && m.controls && !m.sheet && m.items.length === 2 && m.items[0] === 'Rename' && /^Delete this run$/.test(m.items[1]), m);
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
  await page.keyboard.press('ArrowDown');
  const first = await focused();
  await page.keyboard.press('ArrowDown');
  const second = await focused();
  check('opened by a tap, focus is on the menu, and the arrow keys go through its items', m && m.onMenu && first === 'Rename' && /^Delete/.test(second || ''), [m && m.onMenu, first, second]);
  await page.keyboard.press('Escape');
  await settle(700);
  await page.waitForFunction(() => !document.querySelector('.rf-menu'), null, { timeout: 3000 }).catch(() => {});
  const shut = await page.evaluate(() => ({ open: !!document.querySelector('.rf-menu:popover-open'), left: document.querySelectorAll('.rf-menu').length, focus: document.activeElement && document.activeElement.dataset.act, view: window.GH.ui.route.view }));
  check('Escape closes it, and focus goes back to the button', !shut.open && shut.left === 0 && shut.focus === 'actMenu' && shut.view === 'activity', shut);
  await page.keyboard.press('Enter');
  await settle(600);
  const kb = await page.evaluate(() => ({ open: !!document.querySelector('.rf-menu:popover-open'), focus: document.activeElement && document.activeElement.textContent.trim() }));
  check('opened from the keyboard, focus starts on its first item', kb.open && kb.focus === 'Rename', kb);
  await page.keyboard.press('Escape');
  await settle(700);
  await page.click('#topbar [data-act="actMenu"]');
  await settle(600);
  await page.click('.rf-menu:popover-open [data-act="actRename"]');
  await settle(900);
  const ren = await page.evaluate(() => ({ menu: !!document.querySelector('.rf-menu:popover-open'), sheet: !!document.querySelector('dialog.gh-sheet[open] input') }));
  check('Rename in it opens the rename sheet', !ren.menu && ren.sheet, ren);
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(900);
}

section('Deleting, with Undo');
// At once, no question first: Undo in its toast brings it back.
const n0 = (await S()).n;
await watchFolds();
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('#screen [data-act="actDelete"]');
await page.waitForFunction(() => window.GH.ui.route.view !== 'activity', null, { timeout: 5000 }).catch(() => {});
await settle(900);
const del = await page.evaluate(() => ({ asked: !!document.querySelector('dialog.rf-dialog[open]'), folds: window.__folds.slice(), haptics: window.__haptics.slice(), toast: [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ')).join(' | ') }));
check('Delete takes it away at once, with no question first, and goes back', !del.asked && (await S()).n === n0 - 1 && (await page.evaluate(() => window.GH.ui.route.view !== 'activity')), del);
check('its summary folds away first, the discard\'s feel on the tap, once', del.folds.length === 1 && del.folds[0].moving > 0 && del.haptics.filter((k) => k === 'actDiscard').length === 1 && !del.haptics.includes('heavy'), del);
check('the toast says so, with Undo', /deleted/.test(del.toast) && /Undo/.test(del.toast), del);
await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].pop(); const b = t && [...t.querySelectorAll('button')].find((x) => /Undo/.test(x.textContent)); if (b) b.click(); });
await settle(700);
check('Undo puts it back', (await S()).n === n0);

section('Finished on the notification while the app is away');
await page.evaluate(() => { const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.go('today'); window.__act.searchMs = 0; window.__act.mps = 1.35; });
await settle(900);
await page.click('#screen .act-cta');
await settle(900);
await page.click('dialog[open] .at-tile[data-arg="walk"]');
await settle(1500);
await page.click('#actlive [data-act="alGo"]');
await settle(3500);
const walkId = (await S()).live.id;
check('the recorder gets the units for its notification', (await fake()).calls.some((c) => c.startsWith('actStart:') && c.includes('"units":"mi"')));
{
  const walkStart = (await fake()).calls.filter((c) => c.startsWith('actStart:') && c.includes('"type":"walk"')).pop();
  check('a walk starts without auto-pause (unless it\'s turned on for walks)', /"autoPause":false/.test(walkStart || ''), [walkStart, await page.evaluate(() => window.GH.ui.S.profile.prefs.actAuto)]);
}
// Maps are on (from the summary): OpenFreeMap's map, following you.
await page.waitForFunction(() => { const m = document.querySelector('#actlive .al-map'); return m && /ready|failed/.test(m.dataset.streets || ''); }, null, { timeout: 30000 }).catch(() => {});
// (The route so far is worked out every 3 seconds: the start goes on the map with the first of it.)
await settle(6000);
const wm = await page.evaluate(() => {
  const m = document.querySelector('#actlive .al-map');
  const attr = m && m.querySelector('.am-attr');
  return m && { state: m.dataset.streets, canvas: !!m.querySelector('.al-map-slot canvas'), here: !!m.querySelector('.maplibregl-marker .mk-here'), start: !!m.querySelector('.maplibregl-marker .mk-start'), attr: attr ? getComputedStyle(attr).display : null, pressable: m.hasAttribute('data-interactive') };
});
check('while it records, the map follows you: OpenFreeMap\'s, with where you are and where you started', wm && wm.state === 'ready' && wm.canvas && wm.here && wm.start && wm.attr !== 'none', wm);
check('the card\'s glass doesn\'t take a press while a map is in it (fingers move the map)', wm && !wm.pressable, wm);
await settle(10 * 60 * 1000);
await page.evaluate(() => window.__gh.back());
await settle(900);
await page.evaluate(() => window.__gh.openRoute('activity'));
await settle(900);
L = await live();
check('the notification\'s tap opens the live screen', L && L.phase === 'live', L);
await page.evaluate(() => window.__gh.back());
await settle(900);
// The app goes to the background, the walk is finished on the notification, and the app is opened
// again 25 minutes later.
await page.evaluate(() => window.__gh.onPause());
const endedAt = await page.evaluate(() => window.__act.stopOutside());
await settle(25 * 60 * 1000);
await page.evaluate(() => window.__gh.onResume());
await settle(1500);
const fw = await page.evaluate((x) => {
  const S = window.GH.ui.S; const a = S.activities.find((y) => y.id === x); const t = [...document.querySelectorAll('.rf-toast')].pop();
  return { live: S.actLive, a: a && { end: a.end, elapsed: a.elapsedMs, moving: a.movingMs, type: a.type }, toast: t && t.textContent.replace(/\s+/g, ' ').trim() };
}, walkId);
check('it\'s saved when the app is back, and says so', fw.live === null && fw.a && fw.a.type === 'walk' && /Your walk was saved/.test(fw.toast || ''), fw);
check('ending when it was finished, not when the app came back', fw.a && Math.abs(fw.a.end - endedAt) <= 1000 && fw.a.elapsed < 11 * 60 * 1000, fw.a && [fw.a.end - endedAt, fw.a.elapsed]);
check('and the recording is cleared', (await fake()).calls.includes(`actClear:${walkId}`));
await page.evaluate(() => window.__gh.openRoute('activity'));
await settle(900);
check('its notification then opens the summary', await page.evaluate((x) => window.GH.ui.route.view === 'activity' && window.GH.ui.route.arg === x, walkId));

section('The live map');
await page.reload();
await page.waitForSelector('#screen[data-view]');
await page.evaluate(() => { Object.assign(window.__act, { searchMs: 6000, mps: 1000 / 300 }); const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.go('today'); });
await settle(900);
await page.click('#screen .act-cta');
await settle(900);
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(1500);
await page.waitForFunction(() => { const m = document.querySelector('#actlive .al-map-search'); return m && /ready|failed/.test(m.dataset.streets || ''); }, null, { timeout: 30000 }).catch(() => {});
await settle(300);
const gs = await page.evaluate(() => {
  const m = document.querySelector('#actlive .al-map-search'), e = m && m.querySelector('.am-engine');
  return m && { state: m.dataset.streets, map: e && e.dataset.map, canvas: !!m.querySelector('.maplibregl-canvas'), here: !!m.querySelector('.maplibregl-marker .mk-here'), radar: !!m.querySelector('.al-radar') };
});
check('maps on, finding GPS shows the map at where the phone is, the radar over it', gs && gs.state === 'ready' && gs.canvas && gs.here && gs.radar, gs);
await shot('17-search-map');
await settle(6000);
await page.click('#actlive [data-act="alGo"]');
await settle(3500);
await settle(60000);
const follows = () => page.evaluate(() => Number((document.querySelector('#actlive .al-map .am-engine') || {}).dataset.follows || 0));
const gl = await page.evaluate(() => {
  const m = document.querySelector('#actlive .al-map:not(.al-map-search)');
  const e = m && m.querySelector('.am-engine'), M = e && e.ghMap;
  const here = m && m.querySelector('.maplibregl-marker .mk-here');
  const want = window.GH.ui.actColor(m, '--al-line');
  return m && { map: e && e.dataset.map, state: m.dataset.streets, line: M && String(M.getPaintProperty('route', 'line-color')).toLowerCase(), want: want && want.hex, drawn: M ? M.queryRenderedFeatures({ layers: ['route'] }).length : 0, heading: here && here.hasAttribute('data-heading'), acc: here && parseFloat(here.style.getPropertyValue('--mk-acc')), start: !!m.querySelector('.maplibregl-marker .mk-start') };
});
check('then the same map moves into the live screen (not a second one)', gl && gl.map === gs.map && gl.state === 'ready', [gs && gs.map, gl]);
check('with the route so far in the activity\'s colour, the start, and where you are, heading and all', gl && gl.drawn >= 1 && gl.line === gl.want && gl.start && gl.heading && gl.acc > 0, gl);
const f0 = await follows();
await settle(5000);
const f1 = await follows();
check('it follows you as you go', f0 >= 3 && f1 > f0, [f0, f1]);
await shot('18-live-map');
await page.evaluate(() => { const M = document.querySelector('#actlive .al-map .am-engine').ghMap; M.fire('dragstart', { originalEvent: new Event('touchstart') }); });
await settle(300);
const fa = await follows();
await settle(5000);
const fb = await page.evaluate(() => { const b = document.querySelector('#actlive .am-fit'); return b && !b.hidden ? b.getAttribute('aria-label') : null; });
check('a finger moving it stops the following, and a button follows you again', fb === 'Follow your position' && (await follows()) === fa, [fb, fa, await follows()]);
await page.click('#actlive .am-fit');
await settle(2500);
check('which it does', (await follows()) > fa && (await page.evaluate(() => document.querySelector('#actlive .am-fit').hidden)));
await page.click('#actlive [data-act="alMaps"]');
await settle(900);
check('the map button hides it again (the route drawn here instead)', await page.evaluate(() => !document.querySelector('#actlive .maplibregl-canvas') && !document.querySelector('#actlive .al-map-slot') && document.querySelectorAll('#actlive .al-map .rt-line').length >= 1 && window.GH.ui.S.profile.prefs.actMaps === false));
const lt = tileRequests.length;
await page.click('#actlive [data-act="alMaps"]');
await settle(1500);
await page.waitForFunction(() => { const m = document.querySelector('#actlive .al-map'); return m && /ready|failed/.test(m.dataset.streets || ''); }, null, { timeout: 30000 }).catch(() => {});
const sa = await page.evaluate(() => ({ asked: !!document.querySelector('dialog.rf-dialog[open]'), canvas: !!document.querySelector('#actlive .al-map-slot .maplibregl-canvas'), state: (document.querySelector('#actlive .al-map') || {}).dataset.streets }));
check('and shows it again without asking twice, from the pieces it kept as it followed you', !sa.asked && sa.canvas && sa.state === 'ready' && tileRequests.length === lt, [sa, tileRequests.slice(lt, lt + 3)]);
{
  // No connection, and nothing kept for here: the route drawn here stands in, and the map comes once
  // the phone is back online.
  await page.click('#actlive [data-act="alMaps"]');
  await settle(900);
  await page.evaluate(() => window.GH.ui.mapPieces.clear());
  mapsOffline = true;
  await page.click('#actlive [data-act="alMaps"]');
  await settle(1500);
  await page.waitForFunction(() => { const m = document.querySelector('#actlive .al-map'); return m && /ready|failed/.test(m.dataset.streets || ''); }, null, { timeout: 30000 }).catch(() => {});
  const lf = await page.evaluate(() => { const m = document.querySelector('#actlive .al-map'); return m && { state: m.dataset.streets, line: m.querySelectorAll('.rt-line').length, asked: !!document.querySelector('dialog.rf-dialog[open]') }; });
  check('with no connection and nothing kept, the live screen keeps the route it draws', lf && lf.state === 'failed' && lf.line >= 1 && !lf.asked, lf);
  mapsOffline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(1500);
  await page.waitForFunction(() => { const m = document.querySelector('#actlive .al-map'); return m && m.dataset.streets === 'ready'; }, null, { timeout: 30000 }).catch(() => {});
  const lb = await page.evaluate(() => ({ state: (document.querySelector('#actlive .al-map') || {}).dataset.streets, maps: document.querySelectorAll('#actlive .maplibregl-canvas').length }));
  check('and back online, its map comes by itself', lb.state === 'ready' && lb.maps === 1, lb);
}

section('Discarding');
await watchFolds();
await page.click('#actlive [data-act="alMenu"]');
await settle(800);
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('dialog[open] [data-act="alDiscard"]');
await settle(900);
const dq = await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); return d && d.textContent.replace(/\s+/g, ' '); });
check('Discard asks first, once it has been going a minute', /Discard this run\?/.test(dq || '') && /Keep it/.test(dq), dq);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Discard').click(); });
await page.waitForFunction(() => document.getElementById('actlive').hidden, null, { timeout: 5000 }).catch(() => {});
await settle(900);
const dc = await page.evaluate(() => ({ live: window.GH.ui.S.actLive, hidden: document.getElementById('actlive').hidden, folds: window.__folds.slice(), haptics: window.__haptics.slice(), maps: document.querySelectorAll('#actlive .maplibregl-canvas').length, toast: ([...document.querySelectorAll('.rf-toast')].pop() || {}).textContent }));
check('then the screen folds away, and nothing is kept', dc.live === null && dc.hidden && dc.folds.length === 1 && dc.folds[0].moving > 0 && (await fake()).rec === null && /Run discarded/.test(dc.toast || ''), dc);
check('with the discard\'s own feel after the question\'s, and its map gone with it', dc.haptics.indexOf('heavy') >= 0 && dc.haptics.indexOf('actDiscard') > dc.haptics.indexOf('heavy') && dc.maps === 0, dc);

section('Precise location, or none');
await page.evaluate(() => {
  const U = window.GH.ui; while (U.back()) { /* back to the tab */ } U.go('today');
  Object.assign(window.__act, { perms: { location: 'ask', approximate: true, activity: 'granted', notifications: 'granted' }, grant: { location: 'denied', approximate: true, activity: 'granted', notifications: 'granted' } });
});
await settle(900);
await page.click('#screen .act-cta');
await settle(900);
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(900);
let pb = await permText();
check('approximate location only: it asks for precise, and says why', pb.rows[0] === 'Precise location' && /approximate location only/.test(pb.note) && /Choose Precise when Android asks/.test(pb.note) && pb.buttons.join() === 'Continue', pb);
await shot('13-approximate');
await page.click('dialog[open] [data-act="actPerm"]');
await settle(600);
pb = await permText();
check('still approximate, and Android won\'t ask again: Open settings, or start without GPS', pb.buttons.join() === 'Open settings,Start without GPS' && /Choose Precise in Android's Settings/.test(pb.note), pb);
await page.click('dialog[open] [data-act="actSettings"]');
await settle(300);
check('Open settings opens the app\'s page in Android\'s settings', (await fake()).calls.includes('actOpenSettings'));
await page.evaluate(() => { window.__act.perms = { location: 'granted', approximate: false, activity: 'granted', notifications: 'granted' }; window.__gh.onResume(); });
await settle(1500);
L = await live();
check('back with precise location allowed, it goes on to finding GPS', L && L.phase === 'search' && (await permText()).rows.length === 0, L);
await page.click('#actlive [data-act="alDiscardNow"]');
await settle(900);
check('Cancel before the start keeps nothing', (await S()).live === null && !(await live()) && (await fake()).rec === null);
await page.evaluate(() => { window.__act.perms = { location: 'denied', approximate: false, activity: 'granted', notifications: 'granted' }; });
await page.click('#screen .act-cta');
await settle(900);
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(900);
pb = await permText();
check('location turned off for the app: Open settings, or start without GPS', pb.buttons.join() === 'Open settings,Start without GPS' && /Location is turned off for Gradient Health/.test(pb.note), pb);
await shot('14-denied');
const nBefore = (await S()).n;
await page.click('dialog[open] [data-act="actNoGps"]');
await settle(3600);
L = await live();
const pageRec = await page.evaluate(() => window.GH.activity.rec().kind === 'web' && !!localStorage.getItem('gh.act.rec'));
check('without GPS it counts down, then the page keeps the clock (the phone\'s recorder needs location)', L && L.phase === 'live' && L.gps === 'off' && pageRec, L);
await settle(12 * 60 * 1000);
L = await live();
check('its clock runs', Math.abs(secs(L.time) - 720) <= 3, L.time);
await shot('15-nogps');
await holdFinish();
const ng = await page.evaluate(() => { const S = window.GH.ui.S; const a = S.activities[0]; return { n: S.activities.length, moving: a.movingMs, dist: a.distanceM, stored: !!localStorage.getItem('gh.act.rec'), view: window.GH.ui.route.view, hero: [...document.querySelectorAll('#screen .as-stat')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), map: (document.querySelector('#screen .am-empty') || {}).textContent }; });
check('it\'s saved with its time, and the page\'s recording cleared', ng.n === nBefore + 1 && Math.abs(ng.moving - 720000) < 5000 && ng.dist === 0 && !ng.stored && ng.view === 'activity', ng);
check('the watch\'s distance stands in for GPS', /^3\.13 ?mi Watch distance$/.test(ng.hero[0]) && /No route for this one/.test(ng.map || ''), ng);
await shot('16-nogps-summary');
await page.evaluate(() => { window.__act.perms = { location: 'granted', approximate: false, activity: 'granted', notifications: 'granted' }; });

section('The browser\'s own recorder');
const ctx2 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(`web: ${e.message}`));
await p2.clock.install({ time: new Date('2026-10-19T08:10:00') });
await p2.goto(server.url);
await p2.waitForSelector('.onboard:not([hidden])');
await p2.evaluate(seedState);
await p2.reload();
await p2.waitForSelector('#screen[data-view="today"]');
const s2 = async (ms = 700) => { await p2.clock.runFor(ms); await p2.waitForTimeout(Math.min(ms, 350)); };
await p2.evaluate(() => window.GH.ui.act.actStart({ dataset: {} }));
await s2(900);
await p2.click('dialog[open] .at-tile[data-arg="walk"]');
await s2(900);
const perm2 = await p2.evaluate(() => { const d = document.querySelector('dialog[open] .at-perm'); return d && [...d.querySelectorAll('.at-perm-row .t-subhead')].map((e) => e.textContent.trim()); });
check('without the app, it asks for location only', perm2 && perm2.length === 1 && perm2[0] === 'Location', perm2);
await ctx2.grantPermissions(['geolocation']);
const LAT = 40.7812, LON = -73.9665;
await ctx2.setGeolocation({ latitude: LAT, longitude: LON, accuracy: 8 });
await p2.click('dialog[open] [data-act="actPerm"]');
await s2(1500);
check('then finds GPS with navigator.geolocation', await p2.evaluate(() => { const e = document.getElementById('actlive'); return e && !e.hidden && e.dataset.phase === 'search'; }));
await p2.click('#actlive [data-act="alGo"]');
await s2(3500);
for (let i = 1; i <= 60; i++) { await ctx2.setGeolocation({ latitude: LAT + (i * 1.4) / 111195, longitude: LON, accuracy: 6 }); await s2(1000); }
const web = await p2.evaluate(() => ({ phase: document.getElementById('actlive').dataset.phase, dist: document.querySelector('#actlive [data-live="dist"]').textContent, stored: !!localStorage.getItem('gh.act.rec') }));
check('it records the walk and keeps it in the browser', web.phase === 'live' && parseFloat(web.dist) > 0.03 && web.stored, web);
await p2.reload();
await p2.waitForSelector('#actlive:not([hidden])', { timeout: 15000 });
check('a reload picks it up again', await p2.evaluate(() => window.GH.ui.S.actLive && document.getElementById('actlive').dataset.phase === 'live'));
await ctx2.close();

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 8).join('\n'));
await browser.close();
await server.close();
done();
