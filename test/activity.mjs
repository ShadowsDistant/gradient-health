// Outdoor activities (src/activity.js): distance with GPS noise and jitter, pauses (flagged fixes and
// holes), moving time, splits, best efforts, elevation, calories, heart-rate zones, simplification,
// the route encoding, records and new records, the watch's numbers, what goes to Health Connect,
// the activity clock, the recorders (the shell's, the page's, Reset everything), history limits, and
// counting as exercise (readiness, the Health list).
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/activity.js');
const A = GH.activity, B = GH.brain, H = GH.health;

// A seeded random, so every run of the test sees the same noise.
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const LAT0 = 40.7812, LON0 = -73.9665;
const M_LAT = 111195; // metres per degree of latitude
const mLon = (lat) => M_LAT * Math.cos((lat * Math.PI) / 180);
// Walks a path given as a function of distance → [x, y] metres, at speed(d) m/s, one fix a second.
function record(path, total, speed, o = {}) {
  const pts = [];
  const t0 = o.t0 || Date.UTC(2026, 8, 28, 12, 0, 0);
  let d = 0, t = t0;
  const noise = o.noise == null ? 2 : o.noise;
  while (d <= total) {
    const [x, y] = path(d);
    const lat = LAT0 + (y + gauss() * noise) / M_LAT, lon = LON0 + (x + gauss() * noise) / mLon(LAT0);
    const alt = o.alt ? o.alt(d) + gauss() * (o.altNoise == null ? 3 : o.altNoise) : null;
    pts.push([t, lat, lon, alt, o.acc || 5, speed(d), 0]);
    d += speed(d);
    t += 1000;
  }
  return { pts, t0, end: t - 1000 };
}
const line = (d) => [d, 0];
// A loop of 5 km: a circle with a 795.8 m radius.
const R5 = 5000 / (2 * Math.PI);
const loop = (d) => [R5 * Math.sin(d / R5), R5 - R5 * Math.cos(d / R5)];

section('Distance');
check('haversine: London to Paris is 343.6 km', Math.abs(A.haversine(51.5074, -0.1278, 48.8566, 2.3522) - 343557) < 50);
check('one degree of latitude is 111.2 km', Math.abs(A.haversine(0, 0, 1, 0) - 111195) < 5);
let r = record(line, 1000, () => 3, { noise: 0 });
let tr = A.track(r.pts, { type: 'run', start: r.t0, end: r.end });
check('a clean 1 km line measures 1 km', Math.abs(tr.distanceM - 1000) < 4, tr.distanceM);
r = record(line, 1000, () => 3);
tr = A.track(r.pts, { type: 'run', start: r.t0, end: r.end });
check('with ±2 m of GPS noise it stays within 2%', Math.abs(tr.distanceM - 1000) < 20, tr.distanceM);
// Standing still for a minute at a crossing: jitter mustn't add distance.
const still = [];
for (let i = 0; i < 60; i++) still.push([r.t0 + i * 1000, LAT0 + gauss() * 3 / M_LAT, LON0 + gauss() * 3 / mLon(LAT0), null, 6, 0, 0]);
tr = A.track(still, { type: 'walk', start: r.t0, end: r.t0 + 59000 });
check('a minute standing still adds under 10 m', tr.distanceM < 10, tr.distanceM);
// Out and back with a sharp turn at the far end: the turn isn't standing still.
const outBack = (d) => [d <= 500 ? d : 1000 - d, 0];
r = record(outBack, 1000, () => 3);
tr = A.track(r.pts, { type: 'run', start: r.t0, end: r.end });
check('an out-and-back keeps the distance round its turn', Math.abs(tr.distanceM - 1000) < 25, tr.distanceM);
// A GPS spike: one fix 300 m off, then back.
r = record(line, 400, () => 1.4, { noise: 0 });
const spiked = r.pts.map((p, i) => (i === 100 ? [p[0], p[1] + 300 / M_LAT, p[2], p[3], 8, null, 0] : p));
tr = A.track(spiked, { type: 'walk', start: r.t0, end: r.end });
check('a 300 m GPS spike is dropped', Math.abs(tr.distanceM - 400) < 10, tr.distanceM);
// Poor fixes (60 m) among good ones are left out; a recording that's poor all along still has a route.
const poor = r.pts.map((p, i) => (i % 3 === 0 ? [p[0], p[1] + 40 / M_LAT, p[2], p[3], 80, null, 0] : p));
tr = A.track(poor, { type: 'walk', start: r.t0, end: r.end });
check('fixes worse than 50 m are left out', Math.abs(tr.distanceM - 400) < 10, tr.distanceM);
const allPoor = r.pts.map((p) => [p[0], p[1], p[2], p[3], 45, null, 0]);
tr = A.track(allPoor, { type: 'walk', start: r.t0, end: r.end });
check('a recording that\'s poor all along still measures', tr.distanceM > 300 && tr.pts.length > 5, tr.distanceM);
check('bad points are ignored', A.track([[1, 0, 0, null, 5, null, 0], ['x', 1, 1], [2, 91, 0], null, [3, 40, -73, null, 5, null, 0]], {}).pts.length <= 1);

section('Pauses');
// 500 m, a 2-minute pause (the fixes keep coming, flagged), 500 m more.
r = record(line, 1000, () => 2.5, { noise: 0 });
const pauseAt = r.t0 + 200 * 1000, resumeAt = pauseAt + 120000;
let paused = [];
for (const p of r.pts) {
  if (p[0] < pauseAt) paused.push(p);
  else paused.push([p[0] + 120000, p[1], p[2], p[3], p[4], p[5], 0]);
}
for (let t = pauseAt; t < resumeAt; t += 1000) paused.push([t, paused[199][1] + ((t - pauseAt) / 1000) * 1.2 / M_LAT, paused[199][2], null, 5, 1.2, 1]); // wandering while paused
paused.sort((a, b) => a[0] - b[0]);
const end1 = r.end + 120000;
tr = A.track(paused, { type: 'run', start: r.t0, end: end1 });
check('distance walked while paused doesn\'t count', Math.abs(tr.distanceM - 1000) < 8, tr.distanceM);
check('moving time leaves the pause out', Math.abs(tr.movingMs - (end1 - r.t0 - 120000)) < 1500, [tr.movingMs, end1 - r.t0 - 120000]);
check('the route breaks at the pause', new Set(tr.pts.map((p) => p.run)).size === 2);
// A recorder that sends no fixes while paused: the hole plus what it says was paused.
const holey = paused.filter((p) => !p[6]);
tr = A.track(holey, { type: 'run', start: r.t0, end: end1, pausedMs: 120000 });
check('a hole the recorder reports as paused is a pause', Math.abs(tr.movingMs - (end1 - r.t0 - 120000)) < 1500 && new Set(tr.pts.map((p) => p.run)).size === 2, [tr.movingMs, tr.pauses]);
tr = A.track(holey, { type: 'run', start: r.t0, end: end1, pauses: [[pauseAt, resumeAt]] });
check('so is a pause the page saw', Math.abs(tr.movingMs - (end1 - r.t0 - 120000)) < 1500 && new Set(tr.pts.map((p) => p.run)).size === 2);
check('merging intervals', JSON.stringify(A.mergeIv([[5, 9], [1, 3], [2, 4], [9, 10]])) === '[[1,4],[5,10]]');
// Paused and resumed from the notification while the app was away: the page only heard when it came
// back, so the pause it logged is late and covers running. The recorder's flagged fixes win.
tr = A.track(paused, { type: 'run', start: r.t0, end: end1, pauses: [[resumeAt + 30000, resumeAt + 150000]] });
check('a pause the page heard of late doesn\'t hide real running', Math.abs(tr.distanceM - 1000) < 8 && Math.abs(tr.movingMs - (end1 - r.t0 - 120000)) < 1500, [tr.distanceM, tr.movingMs, tr.pauses]);
// The wait for GPS and the 3-2-1 is recorded paused, before the start; the first fix after the start
// can come a few seconds later (standing at the line).
const waitFix = [];
for (let t = r.t0 - 30000; t < r.t0; t += 1000) waitFix.push([t, LAT0, LON0, null, 12, 0, 1]);
const offFix = r.pts.slice(0, 60).map((p) => [p[0] + 4000].concat(p.slice(1)));
tr = A.track(waitFix.concat(offFix), { type: 'run', start: r.t0, end: offFix[59][0] });
check('the wait for GPS before the start isn\'t a pause', tr.pauses.length === 0 && tr.pts[0].mt === 4000, [tr.pauses, tr.pts[0] && tr.pts[0].mt]);

section('Splits and best efforts');
// 5.2 km at 5:00 per km, except the third km at 4:30.
const pace = (d) => (d >= 2000 && d < 3000 ? 1000 / 270 : 1000 / 300);
r = record(loop, 5200, pace, { noise: 1 });
tr = A.track(r.pts, { type: 'run', start: r.t0, end: r.end });
let sp = A.splits(tr, 1000, null);
check('five whole kilometre splits and what\'s left', sp.length === 6 && sp.slice(0, 5).every((s) => s.m === 1000) && sp[5].part && Math.abs(sp[5].m - 200) < 25, sp.map((s) => s.m));
check('each split\'s time matches its pace', Math.abs(sp[0].ms - 300000) < 4000 && Math.abs(sp[2].ms - 270000) < 4000 && Math.abs(sp[4].ms - 300000) < 4000, sp.map((s) => s.ms));
check('the splits add up to the moving time', Math.abs(sp.reduce((a, s) => a + s.ms, 0) - tr.movingMs) < 1500);
const spMi = A.splits(tr, A.MILE, null);
check('mile splits too', spMi.length === 4 && spMi[3].part, spMi.map((s) => s.m));
let best = A.efforts(tr);
check('the fastest kilometre is the fast one', Math.abs(best['1k'] - 270000) < 4000, best);
check('the fastest 5 km', best['5k'] > 1440000 && best['5k'] < 1480000, best['5k']);
check('no 10 km in a 5 km run', best['10k'] == null && best.half == null);
check('the fastest mile takes in the fast kilometre (270 + 609 m at 5:00 = 452.7 s)', Math.abs(best['1mi'] - 452700) < 6000, best['1mi']);
// A glitch that "runs" a kilometre in 90 seconds isn't a record.
const fake = [];
for (let i = 0; i <= 100; i++) fake.push({ t: i * 1000, d: i * 12, mt: i * 1000, run: 0 });
check('an impossible pace is never a best effort', A.bestEffort(fake, 1000, 6.5) == null);
check('the fastest 10 seconds', A.maxSpeed(tr.pts, 12) > 3.4 && A.maxSpeed(tr.pts, 12) < 4.3, A.maxSpeed(tr.pts, 12));

section('Elevation');
// Up 50 m over the first 1.5 km, down again, with ±3 m of GPS height noise.
const hill = (d) => (d < 1500 ? (d / 1500) * 50 : d < 3000 ? 50 - ((d - 1500) / 1500) * 50 : 0) + 20;
r = record(line, 3000, () => 1.4, { alt: hill });
tr = A.track(r.pts, { type: 'hike', start: r.t0, end: r.end });
let el = A.elevation(tr.pts);
check('a 50 m climb reads about 50 m', el && Math.abs(el.gain - 50) <= 10, el && el.gain);
check('and the way down about 50 m', el && Math.abs(el.loss - 50) <= 10, el && el.loss);
r = record(line, 2000, () => 1.4, { alt: () => 100, altNoise: 4 });
tr = A.track(r.pts, { type: 'walk', start: r.t0, end: r.end });
el = A.elevation(tr.pts);
check('flat ground with noisy heights climbs under 10 m', el && el.gain < 10, el && el.gain);
r = record(line, 500, () => 1.4, { noise: 0 });
tr = A.track(r.pts, { type: 'walk', start: r.t0, end: r.end });
check('no heights, no elevation', A.elevation(tr.pts) === null);
sp = A.splits(A.track(record(line, 3000, () => 1.4, { alt: hill }).pts, { type: 'hike' }), 1000, A.elevation(A.track(record(line, 3000, () => 1.4, { alt: hill }).pts, { type: 'hike' }).pts));
check('splits carry their climb', sp.length >= 3 && sp[0].up > 20 && sp[2].dn > 20, sp.map((s) => [s.up, s.dn]));

section('Calories');
const flat = (m, min) => ({ pts: [{ d: 0, mt: 0, run: 0 }, { d: m, mt: min * 60000, run: 0 }], movingMs: min * 60000 });
const k = (type, m, min, kg) => A.kcalEstimate(type, flat(m, min), null, kg);
check('a 30 min run at 10 km/h, 70 kg: about 350 active kcal (ACSM)', Math.abs(k('run', 5000, 30, 70) - 350) <= 5, k('run', 5000, 30, 70));
check('an hour\'s walk at 5 km/h, 70 kg: about 175', Math.abs(k('walk', 5000, 60, 70) - 175) <= 5, k('walk', 5000, 60, 70));
check('a slow "run" at a walking pace uses the walking equation', k('run', 5000, 60, 70) === k('walk', 5000, 60, 70));
check('a hike costs more than the same walk', k('hike', 5000, 60, 70) > k('walk', 5000, 60, 70));
check('an hour\'s ride at 20 km/h, 70 kg: (8 − 1) MET × 70 = 490', k('cycle', 20000, 60, 70) === 490, k('cycle', 20000, 60, 70));
check('heavier burns more', k('run', 5000, 30, 90) > k('run', 5000, 30, 70));
check('climbing burns more', A.kcalFor('walk', 1000, 12 * 60000, 50, 70) > A.kcalFor('walk', 1000, 12 * 60000, 0, 70));
check('other activities: 3 active MET-hours per hour', A.kcalEstimate('other', { pts: [], movingMs: 3600000 }, null, 70) === 210);

section('Heart rate');
check('max heart rate from age (Tanaka): 208 − 0.7 × 30 = 187', A.hrMaxFor(30) === 187);
check('zones by share of the maximum', A.zoneOf(100, 187) === 0 && A.zoneOf(120, 187) === 1 && A.zoneOf(140, 187) === 2 && A.zoneOf(155, 187) === 3 && A.zoneOf(170, 187) === 4);
const t0 = Date.UTC(2026, 8, 28, 12);
const hr = [];
for (let i = 0; i < 600; i++) hr.push([t0 + i * 5000, i < 120 ? 120 : 160]); // 10 min at 120, 40 at 160
let h = A.hrStats(hr, { start: t0, end: t0 + 3000000, age: 30 });
check('time-weighted average', h && Math.abs(h.avg - 152) <= 1, h && h.avg);
check('maximum', h && h.max === 160);
check('10 minutes in zone 2, 40 in zone 4', h && Math.abs(h.zones[1] - 600000) < 6000 && Math.abs(h.zones[3] - 2400000) < 6000, h && h.zones);
check('a chart series of at most 240 points', h && h.pts.length <= 241 && h.pts[0][0] === 0);
h = A.hrStats(hr, { start: t0, end: t0 + 3000000, age: 30, pauses: [[t0 + 600000, t0 + 1200000]] });
check('pauses are left out of the average and zones', h && Math.abs(h.zones.reduce((a, b) => a + b, 0) - 2400000) < 10000, h && h.zones);
check('nothing usable, no stats', A.hrStats([[t0, 20], [t0 + 1000, 300]], { start: t0, end: t0 + 5000 }) === null);

section('Simplifying and storing the route');
r = record(line, 1000, () => 1, { noise: 0 });
tr = A.track(r.pts, { type: 'walk', start: r.t0, end: r.end });
check('a straight line keeps its two ends', A.simplify(tr.pts, 5).length === 2, A.simplify(tr.pts, 5).length);
r = record(loop, 5000, () => 3);
tr = A.track(r.pts, { type: 'run', start: r.t0, end: r.end });
let simple = A.simplify(tr.pts, 5);
// How far each original point is from the simplified line (point to segment, in metres).
const toLine = (p) => {
  const kx = mLon(LAT0), ky = M_LAT;
  let best = Infinity;
  for (let i = 1; i < simple.length; i++) {
    const ax = simple[i - 1].lon * kx, ay = simple[i - 1].lat * ky, bx = simple[i].lon * kx, by = simple[i].lat * ky, px = p.lon * kx, py = p.lat * ky;
    const L = (bx - ax) ** 2 + (by - ay) ** 2;
    const f = L ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + f * (bx - ax) - px, ay + f * (by - ay) - py));
  }
  return best;
};
const maxOff = Math.max(...tr.pts.map(toLine));
check('a 5 km loop keeps its shape with far fewer points', simple.length < tr.pts.length / 4 && simple.length > 20, [simple.length, tr.pts.length]);
check('every original point is within 5 m of the simplified line', maxOff <= 5.01, maxOff);
const enc = A.encodeRoute(simple, r.t0);
const dec = A.decodeRoute(enc, r.t0);
check('the stored route decodes to the same points', dec.length === simple.length && dec.every((p, i) => A.haversine(p.lat, p.lon, simple[i].lat, simple[i].lon) < 1.5 && Math.abs(p.t - simple[i].t) <= 50));
check('and it\'s small', JSON.stringify(enc).length < simple.length * 22, JSON.stringify(enc).length / simple.length);
tr = A.track(paused, { type: 'run', start: r.t0, end: end1 });
simple = A.simplify(tr.pts, 5);
const dec2 = A.decodeRoute(A.encodeRoute(simple, r.t0), r.t0);
check('a pause survives simplifying and storing', dec2.filter((p) => p.gap).length === 1 && A.routeSegments(dec2).length === dec2.length - 2);

section('Building an activity');
const D0 = B.dayFromStr('2026-09-28');
const person = () => B.newState({ goals: ['legs'], age: 30, units: 'kg', weightKg: 70, heightCm: 178, sex: 'male', days: 3, equipment: { db: [10] } }, null, D0 - 20);
let S = person();
seed = 11;
r = record(loop, 5100, pace, { alt: (d) => 30 + 10 * Math.sin(d / 800) });
let act = A.build(S, { id: 'a1', type: 'run', start: r.t0, end: r.end, points: r.pts, movingMs: r.end - r.t0, distanceM: 5080, steps: 5200 });
check('a run with a title from the time of day', act.type === 'run' && /run$/.test(act.title), act.title);
check('the day it belongs to', act.day === B.dayOf(r.t0, 4));
check('its distance is within 2% of the real 5.1 km', Math.abs(act.distanceM - 5100) < 102, act.distanceM);
check('splits in both units', act.splits.km.length === 6 && act.splits.mi.length === 4, [act.splits.km.length, act.splits.mi.length]);
check('best efforts for a run', act.best && act.best['1k'] > 0 && act.best['5k'] > 0);
check('an estimated calorie count', act.kcalEst > 300 && act.kcalEst < 420, act.kcalEst);
check('elevation from the heights', act.elev && act.elev.gain > 5);
check('a stored route and bounds', act.route && act.route.t.length > 20 && act.bounds && act.bounds[0] < act.bounds[2]);
check('steps from the phone', A.stepsOf(act) === 5200 && A.stepsSrc(act) === 'phone');
const small = JSON.stringify(act).length;
check('a 5 km run stores in under 12 KB', small < 12000, small);
const walk = A.build(S, { id: 'w1', type: 'walk', start: r.t0, end: r.end, points: r.pts, movingMs: r.end - r.t0 });
check('a walk has no best efforts', walk.best === null);
const noGps = A.build(S, { id: 'g0', type: 'other', start: r.t0, end: r.t0 + 1800000, points: [], movingMs: 1800000 });
check('no GPS at all still makes an activity', noGps.distanceM === 0 && noGps.route === null && noGps.movingMs === 1800000 && noGps.kcalEst === 105, noGps);

section('Watch data from Health Connect');
act = A.withWatch(S, act, { id: 'a1', ok: true, steps: 5310, distanceM: 5120, activeKcal: 362, totalKcal: 420, hr: hr.map(([t, b]) => [t - t0 + r.t0, b]), sources: ['com.samsung.android.wear.shealth'] });
check('heart rate stats', act.hr && act.hr.avg > 100 && act.hr.max === 160 && act.hr.hrMax === 187);
check('the watch\'s steps and calories come first', A.stepsOf(act) === 5310 && A.stepsSrc(act) === 'watch' && A.kcalOf(act) === 362 && A.kcalSrc(act) === 'watch');
let wr = A.writeRecord(act);
check('saving to Health Connect leaves out what the watch already recorded', wr.distanceM === null && wr.activeKcal === null && wr.route.length > 20 && wr.route[0].length === 4 && wr.type === 'run', wr);
const act2 = A.build(S, { id: 'a2', type: 'run', start: r.t0, end: r.end, points: r.pts, movingMs: r.end - r.t0 });
wr = A.writeRecord(A.withWatch(S, act2, { id: 'a2', ok: true, steps: 0, hr: [] }));
check('and sends ours when no watch did', wr.distanceM === act2.distanceM && wr.activeKcal === act2.kcalEst && act2.hc.found === false, wr);

section('Records');
S = person();
const mk = (id, type, startDay, km, min, extra) => Object.assign({ id, type, start: Date.UTC(2026, 8, startDay, 12), end: Date.UTC(2026, 8, startDay, 13), day: startDay, distanceM: km * 1000, movingMs: min * 60000, best: type === 'run' ? { '1k': 300000 * min / (km * 5), '5k': km >= 5 ? min * 60000 * 5 / km : undefined } : null, steps: null }, extra || {});
A.add(S, mk('r1', 'run', 1, 5, 30));
check('a first run sets its records quietly', A.get(S, 'r1').records.length === 0);
A.add(S, mk('r2', 'run', 3, 5, 27));
const r2 = A.get(S, 'r2');
check('a faster 5 km is a new record', r2.records.some((x) => x.key === '5k' && x.prev === 1800000), r2.records);
check('so is a faster kilometre', r2.records.some((x) => x.key === '1k'));
A.add(S, mk('r3', 'run', 5, 8, 50, { steps: 9000 }));
const r3 = A.get(S, 'r3');
check('the longest run and the longest by time', r3.records.some((x) => x.key === 'dist') && r3.records.some((x) => x.key === 'time'), r3.records.map((x) => x.key));
A.add(S, mk('w1', 'walk', 6, 3, 40, { steps: 4000 }));
check('a first walk doesn\'t beat a run\'s steps', A.get(S, 'w1').records.length === 0);
const rec = A.records(A.list(S));
check('the records table', rec.byType.run.best['5k'].id === 'r3' || rec.byType.run.best['5k'].id === 'r2', rec.byType.run.best);
check('longest run', rec.byType.run.dist.id === 'r3' && rec.byType.walk.dist.id === 'w1');
check('most steps in one activity', rec.steps.id === 'r3' && rec.steps.v === 9000);
check('the list is newest first', A.list(S).map((a) => a.id).join() === 'w1,r3,r2,r1');
A.add(S, mk('tiny', 'run', 7, 0.1, 0.5));
check('under a minute doesn\'t count for records', A.records(A.list(S)).byType.run.n === 3);
const gone = A.remove(S, 'r3');
check('deleting one takes its records with it', A.records(A.list(S)).byType.run.dist.id !== 'r3');
check('and Undo puts it back in its place', A.restore(S, gone) && A.list(S).map((a) => a.id).join() === 'tiny,w1,r3,r2,r1');
for (let i = 0; i < 70; i++) A.add(S, mk(`x${i}`, 'walk', 10 + (i % 18), 2, 25, { route: { t: [0] } }));
check(`the newest ${A.KEEP_ROUTES} keep their route`, A.list(S).slice(0, A.KEEP_ROUTES).every((a) => a.route) && A.list(S).slice(A.KEEP_ROUTES).every((a) => !a.route));

section('It counts as exercise');
S = person();
seed = 5;
const yday = D0 - 1;
const t9 = B.DAY_MS * yday + 17 * 3600000; // 1 pm the day before (UTC day + 4 h rollover + a bit)
r = record(line, 9000, () => 3, { noise: 1, t0: t9 });
const run50 = A.build(S, { id: 'long', type: 'run', start: r.t0, end: r.end, points: r.pts, movingMs: r.end - r.t0 });
A.add(S, run50);
check('the activity is exercise on its day', (S.health.days[run50.day] || {}).exercise && S.health.days[run50.day].exercise.some((e) => e.src === 'activity' && e.id === 'long' && e.typeName === 'running'));
check('it shows in the activity list with its id', H.activity(S, run50.day, run50.day).some((x) => x.src === 'activity' && x.id === 'long'));
check('and in the active minutes', H.activeMinutes(S, run50.day, run50.day) === Math.round(run50.movingMs / 60000));
const ready = B.readiness(S, run50.day + 1);
check('a 50 minute run makes the next day easier on legs', ready.legsMinus === 1 && ready.reasons.some((x) => /running/.test(x.text)), ready.reasons);
A.remove(S, 'long');
check('deleting it takes that back', B.readiness(S, run50.day + 1).legsMinus === 0 && !S.health.days[run50.day]);
S = person();
const walk50 = A.build(S, { id: 'lw', type: 'walk', start: r.t0, end: r.end, points: r.pts, movingMs: r.end - r.t0 });
A.add(S, walk50);
check('a long walk doesn\'t', B.readiness(S, walk50.day + 1).legsMinus === 0);
// A Health Connect session over the same time (the saved copy, or the watch's own) is the activity.
H.ingest(S, { ok: true, from: new Date(r.t0 - 86400000).toISOString(), to: new Date(r.end + 3600000).toISOString(), exercise: [{ start: new Date(r.t0 + 60000).toISOString(), end: new Date(r.end - 60000).toISOString(), typeName: 'walking', title: '' }] }, r.end + 3600000);
const ex = S.health.days[walk50.day].exercise;
check('a Health Connect session over the same time isn\'t counted twice', ex.filter((e) => !e.fromApp).length === 1 && ex.some((e) => e.src === 'activity'), ex);

section('A light day\'s walk');
// Two weeks of workouts done as planned, so the light days fall where the plan puts them.
S = B.newState({ goals: ['legs'], age: 30, units: 'kg', weightKg: 70, days: 3, equipment: { db: [10] } }, null, D0 - 14);
for (let d = D0 - 14; d < D0; d++) {
  if (B.todayPlan(S, d).type !== 'workout') continue;
  B.startWorkout(S, d, { now: d * B.DAY_MS + 16 * 3600000 });
  for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) B.completeStep(S, S.active.steps[S.active.idx].kind === 'test' ? { value: 12 } : {});
  B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 16.5 * 3600000 });
}
let lightDay = null, workDay = null;
for (let d = D0 - 10; d < D0; d++) { const t = B.todayPlan(S, d).type; if (t === 'light' && lightDay == null) lightDay = d; }
for (let d = D0; d <= D0 + 6 && workDay == null; d++) if (B.todayPlan(S, d).type === 'workout') workDay = d;
const at1 = (d, h) => { const dt = new Date(d * B.DAY_MS); return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), h).getTime(); };
const walkOn = (d, min, id) => { seed = 4; const rr = record(line, min * 60 * 1.3, () => 1.3, { noise: 1, t0: at1(d, 13) }); return A.build(S, { id, type: 'walk', start: rr.t0, end: rr.end, points: rr.pts, movingMs: rr.end - rr.t0 }); };
check('there is a light day and a workout day to try', lightDay != null && workDay != null, [lightDay, workDay]);
const w5 = walkOn(lightDay, 5, 'w5');
A.add(S, w5);
check('a 5 minute walk doesn\'t tick a light day\'s walk', A.countLight(S, w5) === false);
const w15 = walkOn(lightDay, 15, 'w15');
A.add(S, w15);
check('15 minutes does', A.countLight(S, w15) === true && B.todayPlan(S, lightDay).light.walk === true && S.log.find((l) => l.type === 'light' && l.day === lightDay).walkSrc === 'activity');
check('only once', A.countLight(S, w15) === false);
const wWork = walkOn(workDay, 20, 'ww');
A.add(S, wWork);
check('a workout day has no walk to tick', A.countLight(S, wWork) === false);

section('Auto-pause');
// Fixes a second along a line: [seconds, m/s, GPS speed reported (null: none), jitter m, accuracy]
// stretches, with the GPS's speed as phones report it (a few tenths of a m/s while standing).
function legs(list, o = {}) {
  const pts = [];
  const t0 = o.t0 || Date.UTC(2026, 8, 28, 7, 0, 0);
  let t = t0, x = 0;
  for (const [secs, v, sp, jit = 1.5, acc = 5] of list) {
    for (let i = 0; i < secs; i++) {
      x += v;
      pts.push([t, LAT0 + (gauss() * jit) / M_LAT, LON0 + (x + gauss() * jit) / mLon(LAT0), null, acc, sp === undefined ? Math.max(0, v + gauss() * 0.12) : sp === 'still' ? Math.abs(gauss()) * 0.12 : sp, 0]);
      t += 1000;
    }
  }
  return pts;
}
// Every fix through the detector: what it kept (each once, in order, with its flag) and when it paused
// and went on.
function autoRun(type, pts, init) {
  const det = A.autoPauser(type, init);
  const out = [], ev = [];
  for (const p of pts) {
    const res = det.feed(p.slice());
    for (const [q, f] of res.out) { q[6] = f; out.push(q); }
    if (res.pause != null) ev.push(['pause', res.pause]);
    if (res.resume != null) ev.push(['resume', res.resume]);
  }
  for (const [q, f] of det.drain()) { q[6] = f; out.push(q); }
  return { out, ev, det };
}
seed = 21;
// A run: 2 minutes at 3 m/s, 40 s at a crossing, 2 minutes more.
let ap = legs([[120, 3], [40, 0, 'still', 2], [120, 3]]);
let ar = autoRun('run', ap);
const stopAt = ap[120][0], goAt = ap[160][0];
check('a 40 s stop on a run pauses the clock from where the stop began, and starts it where the running did', ar.ev.length === 2 && ar.ev[0][0] === 'pause' && ar.ev[0][1] === stopAt && ar.ev[1][0] === 'resume' && ar.ev[1][1] === goAt, ar.ev.map(([k, t]) => [k, (t - ap[0][0]) / 1000]));
check('every fix is kept once, in order', ar.out.length === ap.length && ar.out.every((p, i) => p[0] === ap[i][0]));
check('flagged paused exactly from the stop to the start again', ar.out.every((p) => (p[0] >= stopAt && p[0] < goAt ? p[6] === 1 : p[6] === 0)));
tr = A.track(ar.out, { type: 'run', start: ap[0][0], end: ap[ap.length - 1][0] });
check('so the moving time leaves the stop out, and the distance is the running', Math.abs(tr.movingMs - 239000) <= 2000 && Math.abs(tr.distanceM - 720) < 15 && tr.pauses.length === 1, [tr.movingMs, Math.round(tr.distanceM), tr.pauses.length]);
seed = 22;
ar = autoRun('run', legs([[60, 3], [90, 1.25], [60, 3]]));
check('walking up a hill in the middle of a run isn\'t a stop', ar.ev.length === 0 && ar.out.every((p) => p[6] === 0), ar.ev);
seed = 23;
ar = autoRun('run', legs([[60, 3], [4, 0, 'still'], [60, 3]]));
check('nor is a 4 s pause for breath', ar.ev.length === 0, ar.ev);
seed = 24;
ar = autoRun('run', legs([[20, 0, 'still'], [60, 3], [30, 0, 'still'], [20, 3]]));
check('standing at the start doesn\'t pause (it waits for the first moving fix), a stop after does', ar.ev.length === 2 && ar.ev[0][1] === Date.UTC(2026, 8, 28, 7, 0, 80), ar.ev.map(([k, t]) => [k, (t - Date.UTC(2026, 8, 28, 7)) / 1000]));
seed = 25;
ap = legs([[60, 3], [30, 0, 'still'], [60, 3]]);
ap[75][5] = 2.4; // one stray speed while standing
ap[80][4] = 90; ap[80][1] += 60 / M_LAT; // and a fix 60 m off, 90 m accurate
ar = autoRun('run', ap);
check('a stray speed or a poor fix while stopped doesn\'t start it again', ar.ev.length === 2 && ar.ev[1][1] === ap[90][0], ar.ev.map(([k, t]) => [k, (t - ap[0][0]) / 1000]));
seed = 26;
ap = legs([[60, 3, null], [30, 0, null, 1.5], [60, 3, null]]);
ar = autoRun('run', ap);
check('without the GPS\'s speed: a stop is staying inside the fixes\' accuracy for 8 s', ar.ev.length === 2 && ar.ev[0][1] >= ap[60][0] && ar.ev[0][1] <= ap[62][0] && ar.ev[1][1] >= ap[90][0] && ar.ev[1][1] <= ap[96][0], ar.ev.map(([k, t]) => [k, (t - ap[0][0]) / 1000]));
check('and every fix is still kept once', ar.out.length === ap.length && ar.out.every((p, i) => p[0] === ap[i][0]));
seed = 27;
ap = legs([[60, 1.4], [30, 0, 'still'], [60, 1.4]]);
check('a walk stops at its own speeds (still under 0.35 m/s)', autoRun('walk', ap).ev.length === 2 && autoRun('cycle', legs([[60, 6], [20, 0, 'still'], [60, 6]])).ev.length === 2);
seed = 28;
{
  const det = A.autoPauser('run');
  const pts = legs([[30, 3], [3, 0, 'still']]);
  let kept = 0;
  for (const p of pts) kept += det.feed(p).out.length;
  const flushed = det.manual();
  check('a pause by hand hands on what was held, as moving', kept === 30 && flushed.length === 3 && flushed.every(([, f]) => f === 0));
  const after = legs([[20, 0, 'still']], { t0: pts[pts.length - 1][0] + 60000 });
  check('and after a resume by hand, standing still doesn\'t pause until it moves', after.every((p) => det.feed(p).out.length === 1) && det.mode === 'moving');
}
seed = 29;
{
  ap = legs([[20, 0, 'still'], [30, 3]]);
  ar = autoRun('run', ap, true);
  check('picked up again while auto-paused (a reload), it goes on once it moves', ar.ev.length === 1 && ar.ev[0][0] === 'resume' && ar.ev[0][1] === ap[20][0] && ar.out.slice(0, 20).every((p) => p[6] === 1), ar.ev);
}
{
  // The browser's recorder, with auto-pause on: its clock stops with the stop (from where it began).
  const realNow = Date.now;
  let clock = Date.UTC(2026, 8, 28, 8);
  Date.now = () => clock;
  const fixes = [];
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { geolocation: { watchPosition: (f) => { fixes.push(f); return 1; }, clearWatch() {}, getCurrentPosition(ok) { ok({ coords: { latitude: LAT0, longitude: LON0, accuracy: 900 } }); } } } });
  A.web.start({ id: 'ap1', type: 'run', title: 'Run', autoPause: true });
  const s0 = A.web.state();
  check('the browser\'s recorder takes a rough position at once, for the map', s0.coarse && s0.coarse.acc === 900 && s0.opts.autoPause && !s0.opts.voice, s0.coarse);
  A.web.pause(); // waiting for the 3-2-1
  clock += 5000;
  A.web.resume();
  seed = 30;
  const run = legs([[60, 3], [40, 0, 'still'], [60, 3]], { t0: clock });
  const seen = [];
  for (const p of run) {
    clock = p[0];
    fixes[0]({ coords: { latitude: p[1], longitude: p[2], accuracy: p[4], speed: p[5], altitude: null, heading: 90 } });
    const st = A.web.state();
    seen.push(st.autoPaused ? 1 : 0);
  }
  const st = A.web.state();
  check('it auto-pauses during the stop and says so, then goes on', seen.slice(0, 64).every((x) => x === 0) && seen.slice(66, 100).every((x) => x === 1) && seen.slice(103).every((x) => x === 0), seen.join(''));
  check('its clock leaves the 40 s stop out', Math.abs(st.elapsedMs - (159000 - 40000)) <= 2000, st.elapsedMs);
  check('its last fix has the GPS heading and speed', st.lastFix.bearing === 90 && st.lastFix.speed > 2);
  A.web.setOptions({ autoPause: false });
  check('auto-pause can be turned off while it records', A.web.state().opts.autoPause === false);
  A.web.stop();
  A.web.clear('ap1');
  Date.now = realNow;
}

section('The pace now');
const pts3 = (n, v, o = {}) => { const out = []; for (let i = 0; i < n; i++) out.push([1e9 + i * 1000, LAT0, LON0 + (i * v + gauss() * (o.jit || 0)) / mLon(LAT0), null, 5, o.speed === null ? null : v, o.paused ? 1 : 0]); return out; };
seed = 31;
check('from the GPS\'s own speeds', Math.abs(A.liveSpeed(pts3(30, 3), 'run') - 3) < 0.05);
const wild = pts3(30, 3);
wild[25][5] = 19; wild[27][5] = 0.2;
check('a stray reading or two doesn\'t move it', Math.abs(A.liveSpeed(wild, 'run') - 3) < 0.1, A.liveSpeed(wild, 'run'));
check('without speeds, from the distance covered (noise taken off)', Math.abs(A.liveSpeed(pts3(30, 3, { speed: null, jit: 2 }), 'run') - 3) < 0.35, A.liveSpeed(pts3(30, 3, { speed: null, jit: 2 }), 'run'));
check('standing still is 0, paused is 0', A.liveSpeed(pts3(30, 0.1), 'run') === 0 && A.liveSpeed(pts3(30, 3, { paused: true }), 'run') === 0);
check('not enough yet is null', A.liveSpeed(pts3(3, 3), 'run') === null && A.liveSpeed([], 'run') === null);

section('The route as it\'s drawn');
seed = 32;
{
  // Around a block: 150 m east, 150 m north, with ±4 m of noise and a stretch of poor fixes.
  const corner = (d) => (d < 150 ? [d, 0] : [150, d - 150]);
  const noisy = [];
  const t0r = Date.UTC(2026, 8, 28, 9);
  for (let i = 0, d = 0; d <= 300; i++, d += 1.4) {
    const [x, y] = corner(d);
    const poor = i > 60 && i < 75;
    noisy.push([t0r + i * 1000, LAT0 + (y + gauss() * (poor ? 12 : 4)) / M_LAT, LON0 + (x + gauss() * (poor ? 12 : 4)) / mLon(LAT0), null, poor ? 25 : 5, 1.4, 0]);
  }
  const trr = A.track(noisy, { type: 'walk', start: noisy[0][0], end: noisy[noisy.length - 1][0] });
  const drawn = A.smoothRoute(trr.pts);
  const off = (p) => { const x = (p.lon - LON0) * mLon(LAT0), y = (p.lat - LAT0) * M_LAT; return Math.min(Math.abs(y) + Math.max(0, x - 150), Math.abs(x - 150) + Math.max(0, -y)); };
  const rms = (list) => Math.sqrt(list.reduce((a, p) => a + off(p) ** 2, 0) / list.length);
  // How much the drawn line (simplified, as it's stored) turns, all told: one real corner is 90°.
  const turning = (list) => { const l = A.simplify(list, 5); let s = 0; for (let i = 2; i < l.length; i++) { const h1 = Math.atan2((l[i - 1].lat - l[i - 2].lat) * M_LAT, (l[i - 1].lon - l[i - 2].lon) * mLon(LAT0)), h2 = Math.atan2((l[i].lat - l[i - 1].lat) * M_LAT, (l[i].lon - l[i - 1].lon) * mLon(LAT0)); let d = Math.abs(h2 - h1); if (d > Math.PI) d = 2 * Math.PI - d; s += d; } return (s * 180) / Math.PI; };
  check('the drawn line zigzags less than the filtered fixes\' (closer to the one 90° corner)', turning(drawn) < turning(trr.pts) - 20, [turning(drawn), turning(trr.pts)]);
  check('and stays as close to where you went', rms(drawn) <= rms(trr.pts) * 1.05 + 0.3, [rms(drawn), rms(trr.pts)]);
  const cornerPt = drawn.reduce((m, p) => (Math.hypot((p.lon - LON0) * mLon(LAT0) - 150, (p.lat - LAT0) * M_LAT) < Math.hypot((m.lon - LON0) * mLon(LAT0) - 150, (m.lat - LAT0) * M_LAT) ? p : m), drawn[0]);
  check('without cutting the corner', Math.hypot((cornerPt.lon - LON0) * mLon(LAT0) - 150, (cornerPt.lat - LAT0) * M_LAT) < 6, Math.hypot((cornerPt.lon - LON0) * mLon(LAT0) - 150, (cornerPt.lat - LAT0) * M_LAT));
  check('the ends stay put, and the track itself is untouched', drawn[0].lat === trr.pts[0].lat && drawn[drawn.length - 1].lon === trr.pts[trr.pts.length - 1].lon && drawn !== trr.pts && A.track(noisy, { type: 'walk', start: noisy[0][0], end: noisy[noisy.length - 1][0] }).distanceM === trr.distanceM);
  // Half a minute at a crossing, halfway: the fixes wander, the drawn route doesn't scribble.
  seed = 33;
  const waited = legs([[60, 1.4], [30, 0, 'still', 3], [60, 1.4]]);
  const trw = A.track(waited, { type: 'walk', start: waited[0][0], end: waited[waited.length - 1][0] });
  const stop = A.smoothRoute(trw.pts).filter((p) => p.t >= waited[64][0] && p.t <= waited[86][0]);
  const spread = Math.max(...stop.map((p) => A.haversine(p.lat, p.lon, stop[0].lat, stop[0].lon)));
  check('standing at a crossing draws as one spot', spread < 2, spread);
}

section('The activity clock');
const now = 1_000_000_000;
check('elapsedMs is the clock, pauses already out', A.clockMs({ active: true, paused: false, startedAt: now - 600000, pausedMs: 60000, elapsedMs: 540000, at: now }, now) === 540000);
check('a recorder that sends wall time has the pauses taken out', A.clockMs({ active: true, paused: false, startedAt: now - 600000, pausedMs: 60000, elapsedMs: 600000, at: now }, now) === 540000);
check('it runs on between updates', A.clockMs({ active: true, paused: false, startedAt: now - 600000, pausedMs: 0, elapsedMs: 600000, at: now }, now + 800) === 600800);
check('and holds still while paused', A.clockMs({ active: true, paused: true, startedAt: now - 600000, pausedMs: 0, elapsedMs: 600000, at: now }, now + 800) === 600000);
const st = A.normState('{"active":true,"id":7,"distanceM":"12.5","gps":"weird","lastFix":{"lat":1,"lon":2,"acc":5,"t":3}}');
check('a state from the bridge is read defensively', st.active && st.id === '7' && st.distanceM === 12.5 && st.gps === 'off' && st.lastFix.lat === 1);
check('an empty state', A.normState(null).active === false && A.normState('nope').points === 0);
check('a finished state says when it ended', A.normState({ active: false, id: 'a', endedAt: 123 }).endedAt === 123 && A.normState({ active: true, id: 'a', endedAt: 123 }).endedAt === null);

section('The recorders');
// A phone: the shell's recorder (faked here) keeps finished recordings until they're cleared.
const store = new Map();
const watches = [];
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { geolocation: { watchPosition: (f) => { watches.push(f); return watches.length; }, clearWatch() {}, getCurrentPosition() {} } } });
let shell = [];
const nowRec = () => shell.find((x) => x.active) || shell.slice().sort((x, y) => y.endedAt - x.endedAt)[0] || null;
globalThis.AndroidBridge = {
  actStart: (json) => { const o = JSON.parse(json); if (shell.some((x) => x.active)) return false; shell.push({ id: o.id, active: true, startedAt: Date.now(), units: o.units }); return true; },
  actStop: () => { const x = shell.find((y) => y.active); if (x) { x.active = false; x.endedAt = Date.now(); } },
  actState: () => { const x = nowRec(); return JSON.stringify(x ? { active: x.active, id: x.id, startedAt: x.startedAt, endedAt: x.active ? null : x.endedAt, elapsedMs: 1000 } : { active: false }); },
  actClear: (id) => { shell = shell.filter((x) => x.active || x.id !== id); },
  actOpenSettings: () => {},
};
check('a new activity uses the shell\'s recorder', A.starter().kind === 'android' && A.rec().kind === 'android' && A.starter().canOpenSettings());
check('without location allowed, the page can keep the clock itself (no GPS asked for)', A.web.start({ id: 'w1', type: 'run', title: 'Treadmill', noGps: true }) && watches.length === 0 && A.web.state().gps === 'off');
check('and while it does, that\'s the recorder the page talks to', A.rec().kind === 'web' && A.rec().state().id === 'w1' && !!store.get('gh.act.rec'));
A.web.stop();
const wst = A.web.state();
check('stopped, it says when', !wst.active && wst.endedAt > 0 && wst.id === 'w1');
A.web.clear('w1');
check('cleared, the shell\'s recorder is back', A.rec().kind === 'android' && !A.web.holds() && !store.get('gh.act.rec'));
A.native.start({ id: 'n1', type: 'walk', title: 'Walk' });
A.native.stop();
A.native.start({ id: 'n2', type: 'run', title: 'Run', units: 'mi' });
A.web.start({ id: 'w2', type: 'run', title: 'x', noGps: true });
check('the units go to the shell for its notification', shell.find((x) => x.id === 'n2').units === 'mi');
let heard = 0;
const offHeard = A.onState(() => { heard++; });
A.reset();
offHeard();
check('Reset everything stops and deletes every recording, going or finished', shell.length === 0 && !A.web.holds() && !store.get('gh.act.rec'));
check('without telling the page', heard === 0);
delete globalThis.AndroidBridge;
check('a browser uses the page\'s recorder', A.starter().kind === 'web' && A.rec().kind === 'web');

section('Units and titles');
check('kg means kilometres, lb miles', A.unitsOf({ profile: { units: 'kg' } }) === 'km' && A.unitsOf({ profile: { units: 'lb' } }) === 'mi');
check('pace per km', A.paceOf(5000, 1500000, 1000) === 300);
check('speed in km/h', A.speedOf(20000, 3600000, 1000) === 20);
check('titles by time of day', A.defaultTitle('run', new Date(2026, 8, 28, 7).getTime()) === 'Morning run' && A.defaultTitle('cycle', new Date(2026, 8, 28, 19).getTime()) === 'Evening ride' && A.defaultTitle('walk', new Date(2026, 8, 28, 23).getTime()) === 'Night walk');

done();
