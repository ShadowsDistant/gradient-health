// Health Connect data added in 1.2 (estimated resting heart rate, active calories, distance, food
// from other apps), writing meals back, the new-permission check, and the 1.1 → 1.2 migration.
import { load, check, section, done } from './lib.mjs';

const calls = { write: [], del: [], request: [] };
let granted = ['steps', 'sleep', 'weight', 'height', 'bodyFat', 'restingHr', 'hrv', 'exercise', 'writeExercise'];
globalThis.AndroidBridge = {
  hcStatus: () => 'granted',
  hcGranted: () => JSON.stringify(granted),
  hcCanWriteFood: () => granted.includes('writeNutrition'),
  hcWriteFood: (json) => calls.write.push(JSON.parse(json)),
  hcDeleteFood: (json) => calls.del.push(JSON.parse(json)),
  hcRequest: () => calls.request.push('core'),
  hcRequestFood: () => calls.request.push('food'),
};
const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/food.js', 'src/store.js');
const B = GH.brain, H = GH.health, F = GH.food;
const hooks = globalThis.__gh;
const D0 = B.dayFromStr('2026-09-28');
const local = (d, h, m) => { const [y, mo, da] = B.dayStr(d).split('-').map(Number); return new Date(y, mo - 1, da, h, m || 0).getTime(); };
const iso = (t) => new Date(t).toISOString();
function person() {
  return B.newState({ goals: ['fat'], age: 30, units: 'kg', weightKg: 80, heightCm: 180, sex: 'male', days: 3, equipment: { db: [10] } }, null, D0 - 30);
}

section('Estimated resting heart rate');
let S = person();
H.ingest(S, {
  ok: true, from: iso(local(D0 - 5, 9)), to: iso(local(D0, 12)),
  heartRate: [
    { time: iso(local(D0 - 2, 3, 30)), bpm: 52 }, // a night low: counts, for that calendar day
    { time: iso(local(D0 - 1, 14, 0)), bpm: 61 }, // a daytime low: the watch was off overnight
    { time: iso(local(D0, 4, 0)), bpm: 55 },
  ],
}, local(D0, 12));
check('a night low becomes that day\'s estimate', H.value(S, 'rhr', D0 - 2) === 52 && S.health.days[D0 - 2].rhrFromEst === true, S.health.days[D0 - 2]);
check('a daytime low is skipped', H.value(S, 'rhr', D0 - 1) == null);
check('a low just after midnight goes to the calendar day it happened on', H.value(S, 'rhr', D0) === 55);
H.ingest(S, { ok: true, from: iso(local(D0 - 5, 9)), to: iso(local(D0, 13)), restingHr: [{ time: iso(local(D0, 7)), bpm: 50 }], heartRate: [{ time: iso(local(D0 - 2, 3, 30)), bpm: 52 }, { time: iso(local(D0, 4, 0)), bpm: 55 }] }, local(D0, 13));
check('a resting value from the watch wins over the estimate', H.value(S, 'rhr', D0) === 50 && !S.health.days[D0].rhrFromEst);
const t = H.today(S, D0 + 1);
check('Today says when the latest resting HR is an estimate', t.rhrLast && t.rhrLast.day === D0 && t.rhrEstimated === false);
check('and when it is', H.today(S, D0 - 2).rhrEstimated === true);

section('Each read starts partway through a day');
S = person();
H.ingest(S, { ok: true, from: iso(local(D0 - 5, 12)), to: iso(local(D0, 12)), heartRate: [{ time: iso(local(D0 - 3, 4)), bpm: 50 }] }, local(D0, 12));
H.ingest(S, { ok: true, from: iso(local(D0 - 3, 12)), to: iso(local(D0 + 1, 12)), heartRate: [{ time: iso(local(D0 - 3, 23)), bpm: 58 }] }, local(D0 + 1, 12));
check('an evening low from a partial day doesn\'t replace the night\'s real low', H.value(S, 'rhr', D0 - 3) === 50, H.value(S, 'rhr', D0 - 3));
S = person();
const daily = (days, n) => days.map((d) => ({ date: B.dayStr(d), count: n, kcal: 400, m: 6000 }));
H.ingest(S, { ok: true, from: iso(local(D0 - 3, 12)), to: iso(local(D0, 12)), steps: daily([D0 - 2, D0 - 1, D0], 8000), activeKcal: daily([D0 - 2, D0 - 1, D0]), distance: daily([D0 - 2, D0 - 1, D0]) }, local(D0, 12));
H.ingest(S, { ok: true, from: iso(local(D0 - 2, 2)), to: iso(local(D0 + 1, 2)), steps: daily([D0 - 1, D0, D0 + 1], 9000), activeKcal: daily([D0 - 1, D0, D0 + 1]), distance: daily([D0 - 1, D0, D0 + 1]) }, local(D0 + 1, 2));
check('a sync at 2 am keeps the steps of a day the totals no longer cover', H.value(S, 'steps', D0 - 2) === 8000 && H.value(S, 'activeKcal', D0 - 2) === 400 && H.value(S, 'distanceM', D0 - 2) === 6000, H.today(S, D0 - 2));
check('and takes the new totals for the rest', H.value(S, 'steps', D0 - 1) === 9000 && H.value(S, 'steps', D0 + 1) === 9000);
S = person();
S.health.lastSync = null;
globalThis.AndroidBridge.hcRead = () => setTimeout(() => hooks.onHealth({ ok: true, from: iso(local(D0 - 3, 12)), to: iso(local(D0, 12)), errors: { heartRate: 'not granted', sleep: 'timed out' } }), 1);
await H.sync(S, local(D0, 12), 3);
check('only real read failures are reported (not types that aren\'t allowed)', S.health.errors.join() === 'sleep', S.health.errors);

section('Active calories and distance');
S = person();
H.ingest(S, { ok: true, from: iso(local(D0 - 3, 9)), to: iso(local(D0, 12)), activeKcal: [{ date: B.dayStr(D0 - 1), kcal: 412 }, { date: B.dayStr(D0), kcal: 120 }, { date: B.dayStr(D0 - 2), kcal: 99999 }], distance: [{ date: B.dayStr(D0 - 1), m: 6400 }] }, local(D0, 12));
check('daily totals land on their days', H.value(S, 'activeKcal', D0 - 1) === 412 && H.value(S, 'activeKcal', D0) === 120 && H.value(S, 'distanceM', D0 - 1) === 6400);
check('impossible values are dropped', H.value(S, 'activeKcal', D0 - 2) == null);
check('and show on Today', H.today(S, D0).activeKcal === 120);

section('Food from other apps');
S = person();
F.setMode(S, 'full');
const meal = (d, h, kcal) => ({ start: iso(local(d, h)), kcal, p: 20, c: 30, f: 10, meal: 'lunch' });
H.ingest(S, { ok: true, from: iso(local(D0 - 3, 9)), to: iso(local(D0, 20)), nutrition: [meal(D0 - 1, 12, 500), meal(D0 - 1, 19, 700), meal(D0, 13, 400), meal(D0 - 3, 12, 900)] }, local(D0, 20));
check('meals are added up per day', F.data(S).other[D0 - 1].kcal === 1200 && F.data(S).other[D0 - 1].n === 2 && F.data(S).other[D0].kcal === 400);
check('the read\'s first (partial) day is left alone', F.data(S).other[D0 - 3] == null);
check('and count toward the day', F.totals(S, D0 - 1).kcal === 1200 && F.totals(S, D0 - 1, false).kcal === 0);
H.ingest(S, { ok: true, from: iso(local(D0 - 3, 9)), to: iso(local(D0, 21)), nutrition: [meal(D0, 13, 400)] }, local(D0, 21));
check('a meal deleted in the other app goes away on the next read', F.data(S).other[D0 - 1] == null && F.data(S).other[D0].kcal === 400);
F.prefs(S).hcRead = false;
check('switching "count food from other apps" off leaves it out', F.totals(S, D0).kcal === 0);

section('Saving meals to Health Connect');
S = person();
F.setMode(S, 'full');
const e = F.add(S, D0, { name: 'Oats', src: 'usda', ref: 1, g: 80, kcal: 300, p: 10, c: 54, f: 5 }, local(D0, 8));
check('nothing is sent without the permission', H.writeFood(S) === 0 && calls.write.length === 0);
granted = granted.concat(['nutrition', 'writeNutrition']);
check('with it, new entries go out', H.writeFood(S) === 1 && calls.write.length === 1 && calls.write[0][0].id === `gradient-food-${e.id}` && calls.write[0][0].kcal === 300);
F.update(S, D0, e.id, { kcal: 320 });
check('a second change waits for the first answer', H.writeFood(S) === 0 && calls.write.length === 1);
hooks.onFoodWrite(JSON.stringify({ ok: true, ids: [`gradient-food-${e.id}`] }));
check('the answer marks the version that was sent, then the edit follows', calls.write.length === 2 && calls.write[1][0].v === 1 && F.data(S).written[e.id] === 0);
hooks.onFoodWrite({ ok: true, ids: [`gradient-food-${e.id}`] });
check('after that, nothing is pending', F.pendingWrites(S).upsert.length === 0 && F.data(S).written[e.id] === 1);
F.remove(S, D0, e.id);
H.writeFood(S);
check('a deleted entry is deleted there too', calls.del.length === 1 && calls.del[0][0] === `gradient-food-${e.id}`);
hooks.onFoodDelete({ ok: true, ids: [`gradient-food-${e.id}`] });
check('once', F.pendingWrites(S).remove.length === 0);
hooks.onFoodWrite({ ok: false, ids: [], error: 'boom' });
check('a failed answer never throws', true);

section('New data types and permissions');
granted = ['steps', 'sleep', 'weight', 'height', 'bodyFat', 'restingHr', 'hrv', 'exercise'];
S = person();
check('1.1 users are asked for the new types (not food, with calories off)', H.missingTypes(S).join() === 'heartRate,activeKcal,distance', H.missingTypes(S));
F.setMode(S, 'full');
check('with calories on, reading and saving meals too', H.missingTypes(S).includes('nutrition') && H.missingTypes(S).includes('writeNutrition'));
H.request(S);
H.request(true);
H.request(false);
check('the nutrition permissions are only asked for with food on', calls.request.join() === 'food,food,core', calls.request);
hooks.onHealthPerms('granted');

section('1.1 → 1.2');
const old = person();
delete old.profile.food; delete old.profile.workouts; delete old.food;
old.profile.protein.track = false;
const m = GH.store.migrate(JSON.parse(JSON.stringify(old)));
check('protein off becomes food tracking off', m.profile.food.mode === 'off');
check('workouts stay on', m.profile.workouts === true);
check('an empty food log is set up', m.food && m.food.days && Array.isArray(m.food.custom));
const old2 = person();
delete old2.profile.food;
check('protein on becomes protein only', GH.store.migrate(JSON.parse(JSON.stringify(old2))).profile.food.mode === 'protein');
const kept = person();
F.setMode(kept, 'full');
check('a 1.2 state keeps its mode', GH.store.migrate(JSON.parse(JSON.stringify(kept))).profile.food.mode === 'full');

section('Your own numbers replace Health Connect\'s for a day');
// A week of Health Connect data: steps, sleep, resting heart rate and a morning weigh-in each day.
const week = (days, kg) => ({
  ok: true, from: iso(local(D0 - 8, 12)), to: iso(local(D0, 12)),
  steps: days.map((d) => ({ date: B.dayStr(d), count: 8000 })),
  sleep: days.map((d) => ({ start: iso(local(d - 1, 23)), end: iso(local(d, 6, 30)), asleepMin: 420 })),
  restingHr: days.map((d) => ({ time: iso(local(d, 7)), bpm: 60 })),
  weight: days.map((d) => ({ time: iso(local(d, 7, 30)), kg })),
});
const last7 = [D0 - 6, D0 - 5, D0 - 4, D0 - 3, D0 - 2, D0 - 1, D0];
S = person();
H.ingest(S, week(last7, 80), local(D0, 12));
const d2 = D0 - 2;
check('Health Connect\'s values, marked as such', H.entry(S, 'steps', d2).src === 'hc' && H.entry(S, 'weightKg', d2).src === 'hc' && H.entry(S, 'weightKg', d2).value === 80);
check('setting yours: steps, sleep, resting HR, weight', H.setManual(S, d2, 'steps', 11000.4) && H.setManual(S, d2, 'sleepMin', 455) && H.setManual(S, d2, 'rhr', 55) && H.setManual(S, d2, 'weightKg', 79.2));
check('yours win for that day', H.value(S, 'steps', d2) === 11000 && H.value(S, 'sleepMin', d2) === 455 && H.value(S, 'rhr', d2) === 55 && H.weightOn(S, d2) === 79.2);
const ew = H.entry(S, 'weightKg', d2);
check('and say so, keeping what Health Connect had', ew.src === 'manual' && ew.mine === 79.2 && ew.hc === 80 && H.entry(S, 'steps', d2).src === 'manual' && H.entry(S, 'steps', d2).hc === 8000, ew);
check('one weigh-in for the day in the weight list (yours)', S.weights.filter((w) => w.day === d2).length === 1 && S.weights.find((w) => w.day === d2).src === 'manual');
check('every value names a source its metric allows', ['sleepMin', 'steps', 'rhr', 'weightKg'].every((k) => { const h = H.history(S, k, D0 - 6, D0); return h.length === 7 && h.every((e) => H.METRICS[k].from.includes(e.src)); }));
check('the 7-day average uses yours', Math.abs(B.weightStats(S, D0).avg7 - (80 * 6 + 79.2) / 7) < 0.001, B.weightStats(S, D0).avg7);
check('out-of-range values are turned away', !H.setManual(S, d2, 'rhr', 400) && !H.setManual(S, d2, 'weightKg', 5) && !H.setManual(S, d2, 'hrv', 60) && H.value(S, 'rhr', d2) === 55);
H.ingest(S, week(last7, 81), local(D0, 13));
check('a sync later doesn\'t overwrite them', H.value(S, 'steps', d2) === 11000 && H.value(S, 'rhr', d2) === 55 && H.weightOn(S, d2) === 79.2 && S.weights.filter((w) => w.day === d2).length === 1);
check('while the other days take the new sync', H.weightOn(S, d2 - 1) === 81 && H.entry(S, 'weightKg', d2).hc === 81);
H.clearManual(S, d2, 'steps');
H.clearManual(S, d2, 'weightKg');
check('removing yours brings Health Connect\'s back', H.value(S, 'steps', d2) === 8000 && H.entry(S, 'steps', d2).src === 'hc' && H.weightOn(S, d2) === 81 && S.weights.filter((w) => w.day === d2).map((w) => w.src).join() === 'hc');
check('the rest of the day\'s own values stay', H.value(S, 'rhr', d2) === 55 && H.value(S, 'sleepMin', d2) === 455 && H.hasManual(S, d2, 'rhr') && !H.hasManual(S, d2, 'steps'));
H.clearManual(S, d2, 'rhr'); H.clearManual(S, d2, 'sleepMin');
check('and with none left, the hand log for the day is gone', S.health.manual[d2] == null && H.value(S, 'rhr', d2) === 60);
check('a day Health Connect never had simply goes empty', (() => { H.setManual(S, D0 - 20, 'steps', 5000); const had = H.value(S, 'steps', D0 - 20) === 5000; H.clearManual(S, D0 - 20, 'steps'); return had && H.value(S, 'steps', D0 - 20) == null; })());

section('The Log weight path and the metric sheet feed the same data');
S = person();
H.ingest(S, week(last7, 80), local(D0, 12));
H.logManual(S, D0, { weightKg: 78.9 }); // what Log weight does
const viaLog = { weights: S.weights.filter((w) => w.day === D0), day: H.value(S, 'weightKg', D0), entry: H.entry(S, 'weightKg', D0) };
const S2 = person();
H.ingest(S2, week(last7, 80), local(D0, 12));
H.setManual(S2, D0, 'weightKg', 78.9); // what Add or change does
check('the same weigh-in list', JSON.stringify(viaLog.weights) === JSON.stringify(S2.weights.filter((w) => w.day === D0)), viaLog.weights);
check('the same day record and entry', viaLog.day === 78.9 && H.value(S2, 'weightKg', D0) === 78.9 && JSON.stringify(viaLog.entry) === JSON.stringify(H.entry(S2, 'weightKg', D0)));
check('and the same average', B.weightStats(S, D0).avg7 === B.weightStats(S2, D0).avg7);
H.removeManual(S, D0, 'weightKg');
check('the old remove path restores Health Connect\'s too', H.weightOn(S, D0) === 80 && S.weights.filter((w) => w.day === D0).map((w) => w.src).join() === 'hc');
// A weight typed in at a workout's check-in goes straight to the weight list.
B.addWeight(S, D0 - 1, 79.5, 'manual');
check('a check-in weight counts as yours', H.entry(S, 'weightKg', D0 - 1).src === 'manual' && H.weightOn(S, D0 - 1) === 79.5);
H.clearManual(S, D0 - 1, 'weightKg');
check('and can be removed from the sheet', H.weightOn(S, D0 - 1) === 80 && !H.hasManual(S, D0 - 1, 'weightKg'));
// Log sleep and the old hand-log remove.
H.logManual(S, D0, { sleepMin: 390 });
check('Log sleep lands as your value for the night', H.entry(S, 'sleepMin', D0).src === 'manual' && H.entry(S, 'sleepMin', D0).value === 390 && H.entry(S, 'sleepMin', D0).hc === 420);

section('Measurements');
S = person();
H.addMeasurement(S, D0 - 30, { waist: 82, armL: 30 });
H.addMeasurement(S, D0, { waist: 81.26 });
H.addMeasurement(S, D0, { armR: 31.4 });
check('saving some keeps the others from that day', JSON.stringify(S.measurements.find((m) => m.day === D0)) === JSON.stringify({ waist: 81.3, day: D0, armR: 31.4 }), S.measurements);
check('each is a metric with a history', H.history(S, 'waist', D0 - 60, D0).map((e) => e.value).join() === '82,81.3' && H.entry(S, 'armR', D0).src === 'manual');
check('set and clear one from the sheet', H.setManual(S, D0 - 30, 'armR', 30.9) && H.entry(S, 'armR', D0 - 30).value === 30.9 && (H.clearManual(S, D0 - 30, 'armR'), H.entry(S, 'armR', D0 - 30) == null) && H.entry(S, 'waist', D0 - 30).value === 82);
H.clearManual(S, D0 - 30, 'waist'); H.clearManual(S, D0 - 30, 'armL');
check('an empty day disappears', !S.measurements.some((m) => m.day === D0 - 30));

section('History over a range');
S = person();
for (let d = D0 - 400; d <= D0; d++) if (d % 3 !== 0) S.health.days[d] = { rhr: 50 + (d % 10), steps: 7000 + (d % 7) * 500 };
const rng = (n) => H.history(S, 'rhr', D0 - n + 1, D0);
check('a range covers exactly its days, oldest first', [7, 28, 90, 365].every((n) => { const h = rng(n); return h.every((e, i) => e.day >= D0 - n + 1 && e.day <= D0 && (i === 0 || h[i - 1].day < e.day)); }));
check('and only days with a value', [7, 28, 90, 365].every((n) => rng(n).length === Array.from({ length: n }, (_, i) => D0 - i).filter((d) => d % 3 !== 0).length));
const st = H.rangeStats(S, 'rhr', D0 - 27, D0);
const vals = rng(28).map((e) => e.value);
check('average, lowest and highest', Math.abs(st.avg - vals.reduce((a, b) => a + b, 0) / vals.length) < 1e-9 && st.min === Math.min(...vals) && st.max === Math.max(...vals) && H.entry(S, 'rhr', st.minDay).value === st.min);
check('change: the last week against the first week with data', (() => { const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length; const h = rng(28); return Math.abs(st.change - (mean(h.filter((e) => e.day >= D0 - 6).map((e) => e.value)) - mean(h.filter((e) => e.day <= h[0].day + 6).map((e) => e.value)))) < 1e-9; })(), st.change);
check('no change when there\'s only a week or so of data in the range', H.rangeStats(S, 'rhr', D0 - 364, D0).change != null && (() => { const S3 = person(); for (let d = D0 - 8; d <= D0; d++) S3.health.days[d] = { rhr: 60 + (d % 4) }; return H.rangeStats(S3, 'rhr', D0 - 89, D0).change == null; })());
check('an empty range', H.rangeStats(S, 'hrv', D0 - 6, D0).n === 0 && H.rangeStats(S, 'hrv', D0 - 6, D0).avg == null);
const newest = [D0, D0 - 1, D0 - 2].find((d) => d % 3 !== 0);
check('the latest value looks back only as far as the metric allows', H.latestEntry(S, 'rhr', D0 + 1).day === newest && H.latestEntry(S, 'rhr', D0 + 9) == null && H.latestEntry(S, 'rhr', D0 + 9, 30).day === newest);

done();
