// Food tracking logic: calorie targets (Mifflin-St Jeor, activity, pace, floors), macros, logging,
// meals, custom and saved foods, meal times (set, and learned from the logs) and each entry's time,
// the foods you log most, learning the burn from intake and weight, the coach hooks and the Health
// Connect bookkeeping.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/health.js', 'src/food.js');
const B = GH.brain, F = GH.food;
const D0 = B.dayFromStr('2026-09-28');
function person(p) {
  const S = B.newState(Object.assign({ goals: ['fat'], age: 30, units: 'kg', weightKg: 80, heightCm: 180, sex: 'male', days: 3, weightGoal: 'lose', equipment: { db: [10] } }, p || {}), null, D0 - 30);
  F.prefs(S).mode = 'full';
  return S;
}

section('Resting burn and targets');
let S = person();
check('Mifflin-St Jeor for a man: 10W + 6.25H - 5A + 5', Math.round(F.ree(S, D0)) === 1780, F.ree(S, D0));
const W = person({ sex: 'female', weightKg: 60, heightCm: 165 });
check('and for a woman: ... - 161', Math.round(F.ree(W, D0)) === 1320, F.ree(W, D0));
const X = person({ sex: null });
check('no sex given: the average of the two constants', Math.round(F.ree(X, D0)) === 1780 - 5 - 78, F.ree(X, D0));
check('activity from steps: none synced is a light factor plus workouts', F.activityFactor(S, D0).pal === 1.53, F.activityFactor(S, D0));
for (let d = D0 - 28; d < D0; d++) S.health.days[d] = { steps: 11000 };
check('lots of steps raise it', F.activityFactor(S, D0).pal === 1.78, F.activityFactor(S, D0));
let t = F.targets(S, D0);
check('losing at 0.5% a week is about a 440 kcal daily deficit at 80 kg', t.delta === -440, t.delta);
check('target = burn + delta, rounded to 10', t.kcal === Math.round((t.burn + t.delta) / 10) * 10, t);
check('macros add up to the target', Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal) <= 12, t);
check('fat at least 0.6 g per kg', t.fat >= 48, t.fat);
const tiny = person({ sex: 'female', weightKg: 45, heightCm: 150, age: 70 });
F.prefs(tiny).pace = 1;
check('never under the floor (1,200 for women)', F.targets(tiny, D0).kcal === 1200, F.targets(tiny, D0));
const gain = person({ weightGoal: 'gain' });
check('gaining adds about 0.25% a week', F.targets(gain, D0).delta === 220, F.targets(gain, D0).delta);
const keep = person({ weightGoal: 'maintain' });
check('maintaining adds nothing', F.targets(keep, D0).delta === 0);

section('Logging');
S = person();
const at = (h) => (D0 * B.DAY_MS) + h * 3600000;
const oats = { kcal: 379, p: 13.2, c: 67.7, f: 6.5, fib: 10.1 };
const e1 = F.add(S, D0, Object.assign({ name: 'Oats', src: 'usda', ref: 8121, g: 80 }, F.scale(oats, 80)), at(8));
check('an entry scales per-100 g values', e1.kcal === 303 && e1.p === 10.6, e1);
check('the meal comes from the time of day', e1.meal === 'breakfast' && F.mealFor(at(13)) === 'lunch' && F.mealFor(at(19)) === 'dinner' && F.mealFor(at(23)) === 'snack');
F.add(S, D0, { name: 'Chicken', src: 'usda', ref: 5064, g: 150, kcal: 248, p: 46.5, c: 0, f: 5.4, meal: 'lunch' }, at(13));
F.add(S, D0, { name: 'Quick add', src: 'quick', kcal: 200, p: 10, c: 20, f: 8 }, at(16));
let tot = F.totals(S, D0);
check('totals add up', tot.kcal === 751 && tot.p === 67.1 && tot.n === 3, tot);
check('grouped by meal', F.byMeal(S, D0).lunch.length === 1 && F.byMeal(S, D0).breakfast.length === 1);
check('recent foods remember what you logged, newest first', S.food.recent[0] === 'usda:5064' && S.food.recent.includes('usda:8121') && !S.food.recent.some((k) => k.startsWith('quick')));
F.update(S, D0, e1.id, { kcal: 350 });
check('editing an entry changes the totals', F.totals(S, D0).kcal === 798);
F.remove(S, D0, e1.id);
check('removing one too', F.totals(S, D0).kcal === 448 && S.food.removed.some((x) => x.id === e1.id));
F.copyMeal(S, D0, D0 + 1, 'lunch');
check('copying a meal to another day: the same meal at the same time of day', F.totals(S, D0 + 1).kcal === 248 && F.entries(S, D0 + 1)[0].t === at(37) && F.entries(S, D0 + 1)[0].meal === 'lunch' && F.entries(S, D0 + 1)[0].at === 'copy');
const saved = F.saveMeal(S, 'Lunch box', F.entries(S, D0));
F.addSaved(S, D0 + 2, saved.id, 'dinner', { t: at(48 + 19), mh: 1 });
check('saved meals add in one tap', F.totals(S, D0 + 2).kcal === 448 && F.byMeal(S, D0 + 2).dinner.length === 2 && F.byMeal(S, D0 + 2).dinner.every((e) => e.mh === 1 && e.t === at(67)));
const bar = F.addCustom(S, { name: 'Protein bar', servingG: 60, kcal: 220, p: 20, c: 22, f: 7 });
check('custom foods from a label are stored per 100 g too', bar.per100.kcal === 367 && bar.per100.p === 33.3 && bar.perServing.kcal === 220, bar);
check('favourites toggle', F.toggleFav(S, 'usda:5064') === true && F.toggleFav(S, 'usda:5064') === false);
F.prefs(S).mode = 'full';
check('food protein counts toward the protein goal', B.proteinToday(S, D0) >= 56, B.proteinToday(S, D0));
F.ingestOther(S, [{ day: D0, kcal: 300, p: 10, c: 40, f: 10, n: 1 }]);
check('food from other apps adds to the day', F.totals(S, D0).kcal === 748 && F.totals(S, D0, false).kcal === 448);

section('Meal times');
// (These run in UTC, like at() above: the clock's hours are the day's.)
const hm = (d, h, m) => d * B.DAY_MS + (h * 60 + (m || 0)) * 60000;
S = person();
const meal = (t) => F.mealFor(t, S);
check('a new person\'s windows: breakfast 5 to 11 am, lunch 11 am to 3 pm, dinner 5 to 10 pm', ['breakfast', 'lunch', 'dinner'].every((k) => String(F.mealTimes(S, D0).win[k]) === String(F.MEAL_TIMES[k])), F.mealTimes(S, D0).win);
check('snacks are any other time', [[7, 'breakfast'], [11, 'lunch'], [14.9, 'lunch'], [15.5, 'snack'], [17, 'dinner'], [21.9, 'dinner'], [22.5, 'snack'], [2, 'snack']].every(([h, m]) => meal(hm(D0, h)) === m), [7, 11, 14.9, 15.5, 17, 21.9, 22.5, 2].map((h) => meal(hm(D0, h))));
F.prefs(S).learn = false;
F.prefs(S).meals = { breakfast: [360, 540], lunch: [720, 840], dinner: [1080, 1230] };
check('your own times file food by the clock', meal(hm(D0, 8)) === 'breakfast' && meal(hm(D0, 10)) === 'snack' && meal(hm(D0, 13)) === 'lunch' && meal(hm(D0, 15)) === 'snack' && meal(hm(D0, 19)) === 'dinner' && meal(hm(D0, 21)) === 'snack');
let e2 = F.add(S, D0, { name: 'Toast', kcal: 200 }, hm(D0, 8, 14));
check('an entry without a meal goes in the one its time falls in, not marked as picked', e2.meal === 'breakfast' && e2.mh === undefined && e2.at === undefined);
e2 = F.add(S, D0, { name: 'Soup', kcal: 300, meal: 'lunch', mh: 1 }, hm(D0, 10));
check('one picked by hand keeps it, marked', e2.meal === 'lunch' && e2.mh === 1);
check('an earlier day\'s entry gets the meal\'s usual time, the middle of its window', (() => { const w = F.timeFor(S, D0 - 2, 'breakfast', hm(D0, 9)); return w.t === hm(D0 - 2, 7, 30) && w.at === 'usual'; })(), F.timeFor(S, D0 - 2, 'breakfast', hm(D0, 9)));
check('snacks\' usual time is between lunch and dinner', F.timeFor(S, D0 - 1, 'snack', hm(D0, 9)).t === hm(D0 - 1, 16));
check('today\'s is now', F.timeFor(S, D0, 'dinner', hm(D0, 9, 5)).t === hm(D0, 9, 5) && !F.timeFor(S, D0, 'dinner', hm(D0, 9, 5)).at);
const toast = F.entries(S, D0).find((x) => x.name === 'Toast');
F.retime(S, D0, toast.id, 13 * 60 + 5);
check('a new time moves an entry to that time\'s meal', toast.meal === 'lunch' && toast.t === hm(D0, 13, 5) && toast.at === 'set' && toast.v === 1, toast);
F.retime(S, D0, e2.id, 19 * 60);
check('unless its meal was picked by hand', e2.meal === 'lunch' && e2.t === hm(D0, 19));
check('entries sort by time within a meal', (() => { F.add(S, D0, { name: 'Early', kcal: 50 }, hm(D0, 12, 10)); const l = F.byMeal(S, D0).lunch.map((x) => x.name); return l.join() === 'Early,Toast,Soup'; })(), F.byMeal(S, D0).lunch.map((x) => x.name));
F.prefs(S).meals.dinner = [1200, 60];
check('a window past midnight: 12:30 am is still the day before\'s dinner', meal(hm(D0 + 1, 0, 30)) === 'dinner' && B.dayOf(hm(D0 + 1, 0, 30), 4) === D0 && F.atClock(S, D0, 30) === hm(D0 + 1, 0, 30));
F.prefs(S).meals.dinner = [1080, 1230];

section('Learning meal times from the logs');
// Someone who has lunch at about 3:30 pm and files it under lunch by hand, five days of it.
const late = person();
const lateDay = (d, m) => F.add(late, d, { name: 'Late lunch', kcal: 600, meal: 'lunch', mh: 1 }, hm(d, 15, m));
for (let d = D0 - 4; d < D0; d++) lateDay(d, (d * 7) % 40);
check('four days aren\'t enough to move a window', F.mealFor(hm(D0, 15, 30), late) === 'snack' && !F.mealTimes(late, D0).learned.length);
lateDay(D0 - 5, 20);
check('after five days, lunch reaches 3:30 pm', F.mealFor(hm(D0, 15, 30), late) === 'lunch' && F.mealTimes(late, D0).learned.includes('lunch'), F.mealTimes(late, D0));
check('meals with no times to learn from keep their own windows', String(F.mealTimes(late, D0).win.breakfast) === String(F.MEAL_TIMES.breakfast) && F.mealTimes(late, D0).win.dinner[0] >= F.mealTimes(late, D0).win.lunch[1], F.mealTimes(late, D0).win);
F.prefs(late).learn = false;
check('with learning off, the windows set are used', F.mealFor(hm(D0, 15, 30), late) === 'snack');
F.prefs(late).learn = true;
// Lunch logged at 6 pm every day, by hand: lunch can't move more than 2 hours from the window set,
// and dinner keeps its own.
const far = person();
for (let d = D0 - 10; d < D0; d++) F.add(far, d, { name: 'Lunch', kcal: 600, meal: 'lunch', mh: 1 }, hm(d, 18));
const fw = F.mealTimes(far, D0).win;
check('never more than 2 hours from the window set', fw.lunch[1] <= 17 * 60 && fw.lunch[0] <= 13 * 60 && fw.dinner[1] - fw.dinner[0] >= 60, fw);
// Copies, earlier days' usual times and meals logged together afterwards say nothing about when
// food was eaten.
const noisy = person();
for (let d = D0 - 12; d < D0; d++) {
  F.add(noisy, d, { name: 'Copied', kcal: 500, meal: 'dinner', mh: 1, at: 'copy' }, hm(d, 8));
  F.add(noisy, d, { name: 'Usual', kcal: 500, meal: 'breakfast', mh: 1, at: 'usual' }, hm(d, 16));
  for (const [m, min] of [['breakfast', 0], ['lunch', 4], ['snack', 7]]) F.add(noisy, d, { name: 'Later', kcal: 300, meal: m, mh: 1 }, hm(d, 21, min));
}
check('copies, usual times and meals logged together don\'t count', !F.mealTimes(noisy, D0).learned.length && String(F.mealTimes(noisy, D0).win.dinner) === String(F.MEAL_TIMES.dinner), F.mealTimes(noisy, D0));
// Eight weeks of someone logging as they eat, at times that vary, never changing what the clock
// picked: the windows settle around those times and keep filing nearly everything where it belongs.
const habit = person();
const jitter = (d, k) => Math.round(Math.sin(d * 12.9898 + k * 78.233) * 43758.5453 % 1 * 50);
let right = 0, all = 0;
for (let d = D0 - 56; d < D0; d++) {
  for (const [k, h] of [['breakfast', 7.75], ['lunch', 12.75], ['dinner', 19]]) {
    const e = F.add(habit, d, { name: k, kcal: 500 }, hm(d, h) + jitter(d, h) * 60000);
    if (d >= D0 - 28) { all++; if (e.meal === k) right++; }
  }
}
const hw = F.mealTimes(habit, D0);
check('everything learned', hw.learned.length === 3, hw);
check('at least 95% of meals filed where they belong', right / all >= 0.95, `${right} of ${all}`);
check('each window at least 2 hours, in order and apart', ['breakfast', 'lunch', 'dinner'].every((k) => hw.win[k][1] - hw.win[k][0] >= 120) && hw.win.breakfast[1] <= hw.win.lunch[0] && hw.win.lunch[1] <= hw.win.dinner[0], hw.win);
check('snacks between meals stay snacks', F.mealFor(hm(D0, 10, 30), habit) === 'snack' || F.mealFor(hm(D0, 16), habit) === 'snack', hw.win);

section('The foods you log most');
const reg = person();
const fd = (name, ref, d, h, portion) => F.add(reg, d, { name, src: 'usda', ref, g: 100, portion, kcal: 100, p: 1, c: 1, f: 1 }, hm(d, h));
fd('Apple', 1, D0 - 3, 10, '1 medium'); fd('Apple', 1, D0 - 2, 10, '1 medium'); fd('Apple', 1, D0 - 1, 10, '1 large');
fd('Oats', 2, D0 - 2, 8, '1 cup'); fd('Old', 3, D0 - 60, 8, '1 bowl');
fd('Banana', 4, D0, 9, '1 small');
const rg = F.regulars(reg, D0);
check('most used first, then the latest', rg.map((x) => x.key).join() === 'usda:1,usda:4,usda:2,usda:3', rg.map((x) => `${x.key}×${x.n}`));
check('each with the portion it was last logged as', rg[0].last.portion === '1 large' && rg.find((x) => x.key === 'usda:3').last.portion === '1 bowl');

section('Activity set by hand');
const act = person();
F.prefs(act).activity = 'active';
check('in place of the steps', F.activityFactor(act, D0).pal === Math.round((1.8 + 0.075) * 100) / 100 && F.activityFactor(act, D0).set, F.activityFactor(act, D0));
F.prefs(act).activity = 'auto';
check('Auto goes back to the steps', F.activityFactor(act, D0).pal === 1.53);

section('Learning your burn');
S = person({ weightGoal: 'lose', weightKg: 80 });
S.weights = [];
// Three weeks eating 2,000 kcal a day while losing 0.5 kg a week: a burn of about 2,550.
for (let d = D0 - 21; d < D0; d++) {
  F.add(S, d, { name: 'Day', src: 'quick', kcal: 2000, p: 150, c: 200, f: 67 }, d * B.DAY_MS + 12 * 3600000);
  if ((d - D0) % 2 === 0) S.weights.push({ day: d, kg: 80 - ((d - (D0 - 21)) / 7) * 0.5, src: 'manual' });
}
const formula = Math.round(F.ree(S, D0) * F.activityFactor(S, D0).pal);
const est = F.learnBurn(S, D0);
check('with enough logs and weigh-ins it learns', est && est.days >= 10, est);
check('toward what the logs say, but blended with the formula', est.kcal > Math.min(formula, 2550) - 1 && est.kcal < Math.max(formula, 2550) + 1, { est, formula });
check('what it observed is close to 2,550', Math.abs(est.observed - 2550) < 150, est.observed);
const again = F.learnBurn(S, D0 + 7);
check('it never moves more than 150 kcal a week', Math.abs(again.kcal - est.kcal) <= 150, [est.kcal, again.kcal]);
const sameWeek = [F.learnBurn(S, D0 + 8), F.learnBurn(S, D0 + 9), F.learnBurn(S, D0 + 10)];
check('and only updates once a week, however often it\'s asked', sameWeek.every((x) => x.kcal === again.kcal && x.day === D0 + 7), sameWeek.map((x) => [x.day, x.kcal]));
const R = person();
for (let d = D0 - 21; d < D0; d++) {
  F.add(R, d, { name: 'Day', src: 'quick', kcal: 2000, p: 150, c: 200, f: 67 }, d * B.DAY_MS + 12 * 3600000);
  if ((d - D0) % 2 === 0) R.weights.push({ day: d, kg: 80 - ((d - (D0 - 21)) / 7) * 0.5, src: 'manual' });
}
check('the app learns it by itself once a day', F.refreshBurn(R, D0) && F.data(R).tdee && F.data(R).burnChecked === D0 && F.refreshBurn(R, D0) === F.data(R).tdee);
const few = person();
for (let d = D0 - 5; d < D0; d++) F.add(few, d, { name: 'x', src: 'quick', kcal: 2000 }, d * B.DAY_MS);
check('not enough data: nothing learned', F.learnBurn(few, D0) == null);
check('targets say when the burn is learned', F.targets(S, D0).learned === true);

section('Coach hooks');
S = person();
for (let d = D0 - 7; d < D0; d++) F.add(S, d, { name: 'Little', src: 'quick', kcal: 1100, p: 60 }, d * B.DAY_MS + 12 * 3600000);
check('a big deficit holds weekly set increases', F.holdsVolume(S, B.weekStart(D0 - 7)) === true);
const S3 = person();
for (let d = D0 - 7; d < D0; d++) F.add(S3, d, { name: 'Enough', src: 'quick', kcal: F.targets(S3, d).kcal, p: 160 }, d * B.DAY_MS + 12 * 3600000);
check('eating to target doesn\'t', F.holdsVolume(S3, B.weekStart(D0 - 7)) === false);
check('a watch item for calories', F.watchItem(S3, D0) && F.watchItem(S3, D0).status === 'good', F.watchItem(S3, D0));
check('off mode: no hooks', (() => { const S4 = person(); F.prefs(S4).mode = 'off'; return !F.holdsVolume(S4, D0 - 7) && !F.watchItem(S4, D0) && !F.suggestions(S4, D0).length; })());

section('Health Connect bookkeeping');
S = person();
const a = F.add(S, D0, { name: 'Apple', src: 'usda', ref: 9003, g: 180, kcal: 94, p: 0.5, c: 25, f: 0.3 }, at(10));
let pw = F.pendingWrites(S);
check('new entries are pending, with a stable record id', pw.upsert.length === 1 && pw.upsert[0].id === `gradient-food-${a.id}` && pw.upsert[0].kcal === 94);
F.markWritten(S, a.id, true);
check('written ones aren\'t sent again', F.pendingWrites(S).upsert.length === 0);
F.update(S, D0, a.id, { kcal: 100 });
check('an edit is sent again (Health Connect updates the same record)', F.pendingWrites(S).upsert.length === 1);
F.markWritten(S, a.id, true);
F.remove(S, D0, a.id);
pw = F.pendingWrites(S);
check('a removed entry is deleted from Health Connect', pw.remove.length === 1 && pw.remove[0].id === `gradient-food-${a.id}`);
F.markRemoved(S, a.id);
check('once', F.pendingWrites(S).remove.length === 0);
F.prefs(S).hcWrite = false;
F.add(S, D0, { name: 'Pear', src: 'quick', kcal: 90 }, at(11));
check('nothing is written when saving to Health Connect is off', F.pendingWrites(S).upsert.length === 0);

done();
