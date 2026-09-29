// Food tracking logic: calorie targets (Mifflin-St Jeor, activity, pace, floors), macros, logging,
// meals, custom and saved foods, learning the burn from intake and weight, the coach hooks and the
// Health Connect bookkeeping.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/food.js');
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
F.copyMeal(S, D0, D0 + 1, 'lunch', (meal) => at(24 + (meal === 'lunch' ? 13 : 8)));
check('copying a meal to another day', F.totals(S, D0 + 1).kcal === 248 && F.entries(S, D0 + 1)[0].t === at(37));
const saved = F.saveMeal(S, 'Lunch box', F.entries(S, D0));
F.addSaved(S, D0 + 2, saved.id, 'dinner', at(48 + 19));
check('saved meals add in one tap', F.totals(S, D0 + 2).kcal === 448 && F.byMeal(S, D0 + 2).dinner.length === 2);
const bar = F.addCustom(S, { name: 'Protein bar', servingG: 60, kcal: 220, p: 20, c: 22, f: 7 });
check('custom foods from a label are stored per 100 g too', bar.per100.kcal === 367 && bar.per100.p === 33.3 && bar.perServing.kcal === 220, bar);
check('favourites toggle', F.toggleFav(S, 'usda:5064') === true && F.toggleFav(S, 'usda:5064') === false);
F.prefs(S).mode = 'full';
check('food protein counts toward the protein goal', B.proteinToday(S, D0) >= 56, B.proteinToday(S, D0));
F.ingestOther(S, [{ day: D0, kcal: 300, p: 10, c: 40, f: 10, n: 1 }]);
check('food from other apps adds to the day', F.totals(S, D0).kcal === 748 && F.totals(S, D0, false).kcal === 448);

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
