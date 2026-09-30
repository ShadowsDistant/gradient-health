// Outdoor activities in Chromium at phone size, against a fake Android recorder that plays back a
// 5 km loop (test/actfixture.mjs): the ways in (Today, Health, Progress), the start sheet and its
// permission step, finding GPS, the 3-2-1 with its haptics, the live numbers, pause and resume, Back
// tucking it away (the pill on Today, the capsule on other tabs), a reload mid-activity, a tap asking
// first and a hold finishing, the summary (the route, splits, heart rate from the watch, saved to
// Health Connect without double counting), new records after a faster run, the street map loading
// only when asked, deleting with Undo, and the browser's own recorder (navigator.geolocation).
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
// OpenFreeMap, faked: every request is counted; the TileJSON and empty tiles let the map load.
const tileRequests = [];
await ctx.route('https://tiles.openfreemap.org/**', (route) => {
  const url = route.request().url();
  tileRequests.push(url);
  if (/\/planet$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, attribution: '© OpenMapTiles © OpenStreetMap contributors', vector_layers: ['water', 'landuse', 'landcover', 'park', 'waterway', 'building', 'transportation', 'transportation_name', 'place'].map((id) => ({ id, fields: {} })) }) });
  return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
});
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
await page.addInitScript(actBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 350)); };
const shot = async (name) => { if (shots) await page.screenshot({ path: join(OUT, `${width}-${dark ? 'dark' : 'light'}-${name}.png`) }); };
const fake = () => page.evaluate(() => ({ calls: window.__act.calls.slice(), writes: window.__act.writes.slice(), sessions: window.__act.sessions.slice(), rec: window.__act.rec && { id: window.__act.rec.id, active: window.__act.rec.active, paused: window.__act.rec.paused, points: window.__act.rec.points.length } }));
const live = () => page.evaluate(() => {
  const el = document.getElementById('actlive');
  if (!el || el.hidden) return null;
  const q = (s) => { const e = el.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  return { phase: el.dataset.phase, type: el.dataset.type, time: q('[data-live="time"]'), cap: q('[data-live="cap"]'), dist: q('[data-live="dist"]'), avg: q('[data-live="avg"]'), cur: q('[data-live="cur"]'), steps: q('[data-live="steps"]'), splitl: q('[data-live="splitl"]'), gps: el.querySelector('.al-gps') && el.querySelector('.al-gps').dataset.gps, h1: q('.al-h1'), sub: q('.al-sub'), count: q('.al-count-n'), route: el.querySelectorAll('.al-map .rt-line').length, banner: q('.al-banner'), actions: [...el.querySelectorAll('.al-actions [aria-label], .al-actions .rf-btn')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()) };
});
const secs = (t) => { const p = String(t || '').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
const S = () => page.evaluate(() => { const S = window.GH.ui.S; return { live: S.actLive, n: S.activities.length, ids: S.activities.map((a) => a.id) }; });

section('Ways in');
const cta = await page.evaluate(() => { const c = document.querySelector('#screen .act-cta'); return c && c.textContent.replace(/\s+/g, ' ').trim(); });
check('Today has a card to start an activity', /Start an activity/.test(cta || '') && /Walk, run, hike or ride/.test(cta), cta);
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
await shot('01-sheet');
await page.evaluate(() => { window.__act.searchMs = 9000; });
await page.click('dialog[open] .at-tile[data-arg="run"]');
await settle(900);
const perm = await page.evaluate(() => { const d = document.querySelector('dialog[open] .at-perm'); return d && { rows: [...d.querySelectorAll('.at-perm-row .t-subhead')].map((e) => e.textContent.trim()), text: d.textContent.replace(/\s+/g, ' ') }; });
check('it says what it asks for and why', perm && perm.rows[0] === 'Location' && /Physical activity, optional/.test(perm.rows[1]) && /Notifications, optional/.test(perm.rows[2]) && /stays on this phone/.test(perm.text), perm);
await shot('02-permissions');
await page.click('dialog[open] [data-act="actPerm"]');
await settle(300);
let f = await fake();
let L = await live();
check('Continue asks Android, and the recording starts', f.calls.includes('actRequestPermissions') && f.calls.some((c) => /^actStart:.*"type":"run"/.test(c)));
check('its clock waits (paused) while GPS finds you', f.calls[f.calls.length - 1] === 'actPause' && f.rec.paused);
check('the live screen opens on finding your location', L && L.phase === 'search' && L.h1 === 'Finding your location' && /32 m/.test(L.sub) && L.gps === 'searching', L);
const id = (await S()).live.id;
check('the page remembers which activity it is, not started yet', !!id && (await S()).live.goAt === null);
await shot('03-search');

section('Finding GPS, then 3-2-1');
await settle(9500);
L = await live();
check('it says when GPS is ready', L.h1 === 'GPS is ready' && L.gps === 'ok' && /about 5 m/.test(L.sub), L);
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('#actlive [data-act="alGo"]');
await settle(250);
L = await live();
check('Start counts down from 3', L.phase === 'countdown' && L.count === '3', L);
await shot('04-countdown');
await settle(3200);
const haptics = await page.evaluate(() => window.__haptics.slice());
check('a countdown haptic each second, then go', haptics.filter((k) => k === 'countdown').length === 3 && haptics.includes('go') && haptics.lastIndexOf('countdown') < haptics.indexOf('go'), haptics);
f = await fake();
check('then the clock starts', f.calls[f.calls.length - 1] === 'actResume' && !f.rec.paused && (await S()).live.goAt > 0);

section('Live numbers');
await settle(5 * 60 * 1000);
L = await live();
check('the time', Math.abs(secs(L.time) - 300) <= 2, L.time);
check('the distance, in miles (the person uses lb)', Math.abs(parseFloat(L.dist) - 0.62) <= 0.03, L.dist);
check('the average pace and the pace now', /^8:0\d$/.test(L.avg) && /^Now 8:0\d$/.test(L.cur), [L.avg, L.cur]);
check('steps from the phone', Number(L.steps.replace(/,/g, '')) > 1200, L.steps);
check('the split it\'s in', L.splitl === 'Mile 1', L.splitl);
check('the route so far', L.route >= 1);
await shot('05-live');
await page.evaluate(() => { window.__haptics.length = 0; });
// Mile 1 falls at about 8:03.
await settle(2.95 * 60 * 1000);
let banner = null;
for (let i = 0; i < 20 && !banner; i++) { await settle(1000); banner = (await live()).banner; }
check('a banner and a buzz for each mile', /^Mile 1 · 8:0\d$/.test(banner || '') && (await page.evaluate(() => window.__haptics.includes('success'))), banner);
await settle(20000);

section('Pause and resume');
await page.click('#actlive [data-act="alPause"]');
await settle(900);
L = await live();
const pausedAt = secs(L.time), distAt = L.dist;
f = await fake();
check('Pause pauses the recorder and says so', f.calls[f.calls.length - 1] === 'actPause' && L.phase === 'paused' && L.cap === 'Paused', L);
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

section('Back tucks it away');
await page.evaluate(() => window.__gh.back());
await settle(900);
const pill = await page.evaluate(() => { const b = document.querySelector('#float .act-pill'); return b && b.textContent.replace(/\s+/g, ' ').trim(); });
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
check('holding for a second finishes it', f.calls.includes('actStop') && (await page.evaluate(() => window.__haptics.includes('done'))));
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

section('The street map, only when asked');
check('nothing was asked of OpenFreeMap so far', tileRequests.length === 0, tileRequests.slice(0, 3));
check('the map chunk isn\'t loaded', await page.evaluate(() => !window.GH.actmap));
await page.click('#screen [data-act="actStreets"]');
await settle(1500);
await page.waitForFunction(() => { const b = document.querySelector('#screen .am-box'); return b && /ready|failed/.test(b.getAttribute('data-streets') || ''); }, null, { timeout: 30000 }).catch(() => {});
await settle(500);
const streets = await page.evaluate(() => { const b = document.querySelector('#screen .am-box'); return { state: b.getAttribute('data-streets'), canvas: !!b.querySelector('.am-streets canvas'), attr: (b.querySelector('.am-attr') || {}).textContent, pref: window.GH.ui.S.profile.prefs.actStreets, chunk: !!window.GH.actmap }; });
check('Show streets loads the map chunk and asks OpenFreeMap', streets.chunk && tileRequests.some((u) => /tiles\.openfreemap\.org\/planet$/.test(u)), tileRequests.slice(0, 3));
check('the street map draws, with its attribution', streets.state === 'ready' && streets.canvas && /© OpenMapTiles © OpenStreetMap contributors/.test(streets.attr || ''), streets);
check('the choice is remembered', streets.pref === true);
await shot('12-streets');
await page.click('#screen [data-act="actStreets"]');
await settle(700);
check('Hide streets goes back to the route drawn here', await page.evaluate(() => !document.querySelector('#screen .am-streets canvas') && !window.GH.ui.S.profile.prefs.actStreets));

section('Deleting, with Undo');
const n0 = (await S()).n;
await page.click('#screen [data-act="actDelete"]');
await settle(600);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); const b = [...d.querySelectorAll('button')].find((x) => /Delete/.test(x.textContent)); b.click(); });
await settle(900);
check('Delete takes it away and goes back', (await S()).n === n0 - 1 && (await page.evaluate(() => window.GH.ui.route.view !== 'activity')));
await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].pop(); const b = t && [...t.querySelectorAll('button')].find((x) => /Undo/.test(x.textContent)); if (b) b.click(); });
await settle(700);
check('Undo puts it back', (await S()).n === n0);

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
