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
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/food.js', 'src/store.js');
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

done();
