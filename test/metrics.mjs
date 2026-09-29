// The Health tab's metrics table: every metric is complete, values are formatted in the person's
// units, changes read as signed text, and versus() compares with the person's usual (the 28 days
// before, or the week before for weight) with a tone that follows which way is better.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/food.js');
const B = GH.brain, H = GH.health, M = H.METRICS;
const D0 = B.dayFromStr('2026-09-28');
const person = (units, extra) => B.newState(Object.assign({ goals: ['fat'], age: 30, units, weightKg: 80, heightCm: 180, sex: 'male', days: 3, equipment: { db: [10] } }, extra || {}), null, D0 - 60);
const lb = person('lb'), kg = person('kg');

section('The table');
const keys = Object.keys(M);
check('the main metrics are all there', ['sleepMin', 'steps', 'rhr', 'hrv', 'weightKg', 'activeKcal', 'distanceM', 'activeMin', 'kcalIn', 'protein', 'waist', 'armL', 'armR'].every((k) => M[k]), keys);
check('each has a label, a short label, an icon, a hue and a chart kind', keys.every((k) => M[k].key === k && M[k].label && M[k].short && M[k].icon && M[k].tone && ['bar', 'line', 'dot'].includes(M[k].kind)));
check('each knows how much change counts as steady and as a lot', keys.every((k) => M[k].near && M[k].far && ((M[k].near.abs != null && M[k].far.abs != null) || (M[k].near.rel != null && M[k].far.rel != null))));
check('what can be typed in has a valid range', keys.filter((k) => M[k].edit).every((k) => Array.isArray(M[k].valid) && M[k].valid[0] < M[k].valid[1]));
check('weight, sleep, resting HR, steps and measurements can be typed in; HRV and calories can\'t', ['weightKg', 'sleepMin', 'rhr', 'steps', 'waist'].every((k) => M[k].edit) && !M.hrv.edit && !M.activeKcal.edit);
check('labels are sentence case, no dashes', keys.every((k) => /^[A-Z][a-z]/.test(M[k].label) && !/[—–]/.test(M[k].label)));

section('Formatting');
check('sleep in hours and minutes', H.format(lb, 'sleepMin', 425) === '7 h 05' && H.format(lb, 'sleepMin', 480) === '8 h 00' && H.format(lb, 'sleepMin', 45) === '45 min', [H.format(lb, 'sleepMin', 425), H.format(lb, 'sleepMin', 45)]);
check('steps with a thousands separator, or short', H.format(lb, 'steps', 8234) === '8,234' && H.format(lb, 'steps', 8234, { compact: true }) === '8.2k' && H.format(lb, 'steps', 640, { compact: true }) === '640');
check('resting heart rate and HRV with their units', H.format(lb, 'rhr', 57.6) === '58 bpm' && H.format(lb, 'hrv', 54.2) === '54 ms');
check('weight in lb or kg, one decimal', H.format(lb, 'weightKg', 68) === '149.9 lb' && H.format(kg, 'weightKg', 68) === '68.0 kg', [H.format(lb, 'weightKg', 68), H.format(kg, 'weightKg', 68)]);
check('distance in miles or km', H.format(lb, 'distanceM', 5400) === '3.4 mi' && H.format(kg, 'distanceM', 5400) === '5.4 km');
check('measurements in inches or cm', H.format(lb, 'waist', 81.3) === '32.0 in' && H.format(kg, 'waist', 81.3) === '81.3 cm', H.format(lb, 'waist', 81.3));
check('calories and protein', H.format(lb, 'activeKcal', 412) === '412 kcal' && H.format(lb, 'kcalIn', 2150) === '2,150 kcal' && H.format(lb, 'protein', 118) === '118 g');
check('nothing to show is a dash', H.format(lb, 'rhr', null) === '–' && H.format(lb, 'steps', NaN) === '–');
check('the pieces mark units for smaller type', JSON.stringify(H.formatParts(lb, 'weightKg', 68)) === JSON.stringify([{ t: '149.9', u: false }, { t: 'lb', u: true }]) && H.formatParts(lb, 'sleepMin', 425).map((p) => p.t).join(' ') === '7 h 05');
check('units follow the person', H.unitOf(lb, 'weightKg') === 'lb' && H.unitOf(kg, 'weightKg') === 'kg' && H.unitOf(lb, 'distanceM') === 'mi' && H.unitOf(kg, 'waist') === 'cm');
check('typed values convert back to stored units', Math.abs(H.fromDisplay(lb, 'weightKg', 150) - 68.04) < 0.01 && H.fromDisplay(kg, 'weightKg', 70) === 70 && Math.abs(H.fromDisplay(lb, 'waist', 32) - 81.28) < 0.01);

section('Changes');
check('minutes, beats and weight as signed amounts', H.formatDelta(lb, 'sleepMin', 20) === '+20 min' && H.formatDelta(lb, 'sleepMin', -65) === '-1 h 05' && H.formatDelta(lb, 'rhr', -2) === '-2 bpm' && H.formatDelta(kg, 'weightKg', -0.3) === '-0.3 kg', [H.formatDelta(lb, 'sleepMin', -65), H.formatDelta(kg, 'weightKg', -0.3)]);
check('counts as a percentage', H.formatDelta(lb, 'steps', -700, -0.09) === '-9%' && H.formatDelta(lb, 'hrv', 4, 0.08) === '+8%');

section('Compared with your usual');
// Four weeks at a steady level, then a different last week (from D0 - 7, so the whole-day window
// D0 - 7..D0 - 1 and the plain one D0 - 6..D0 both see it). today: a different last day only.
function withDays(S, key, usual, recent, today) {
  for (let d = D0 - 35; d <= D0; d++) S.health.days[d] = Object.assign(S.health.days[d] || {}, { [key]: today ? (d === D0 ? recent : usual) : d >= D0 - 7 ? recent : usual });
  return S;
}
let S = withDays(person('lb'), 'steps', 8000, 10000);
let v = H.versus(S, 'steps', D0, 'week');
check('steps up 25% → up, good', v.dir === 'up' && v.tone === 'good' && Math.round(v.usual) === 8000 && v.rel > 0.2, v);
check('daily totals leave today out (it isn\'t over)', H.versus(withDays(person('lb'), 'steps', 8000, 8000), 'steps', D0, 'week').dir === 'flat' && (() => { const S2 = withDays(person('lb'), 'steps', 8000, 8000); S2.health.days[D0].steps = 900; return H.versus(S2, 'steps', D0, 'week').dir === 'flat'; })());
S = withDays(person('lb'), 'steps', 8000, 5500);
check('steps down 30% → watch', H.versus(S, 'steps', D0, 'week').tone === 'watch');
S = withDays(person('lb'), 'steps', 8000, 7300);
check('down a little → neutral, not watch', (() => { const x = H.versus(S, 'steps', D0, 'week'); return x.dir === 'down' && x.tone === 'neutral'; })());
S = withDays(person('lb'), 'rhr', 58, 64, true);
v = H.versus(S, 'rhr', D0, 'latest');
check('resting HR 6 above usual → up, watch (lower is better)', v.dir === 'up' && v.tone === 'watch' && Math.round(v.delta) === 6 && v.n === 1, v);
S = withDays(person('lb'), 'rhr', 60, 57, true);
check('resting HR 3 below usual → good', H.versus(S, 'rhr', D0, 'latest').tone === 'good');
S = withDays(person('lb'), 'rhr', 60, 61, true);
check('1 bpm off is steady', H.versus(S, 'rhr', D0, 'latest').dir === 'flat');
S = withDays(person('lb'), 'rhr', 58, 62);
check('a week of it shows in the weekly view too', H.versus(S, 'rhr', D0, 'week').dir === 'up' && Math.round(H.versus(S, 'rhr', D0, 'week').usual) === 58);
S = withDays(person('lb'), 'sleepMin', 420, 450);
check('sleep 30 min more → good', H.versus(S, 'sleepMin', D0, 'week').tone === 'good');
S = person('lb');
for (let d = D0 - 3; d <= D0; d++) S.health.days[d] = { rhr: 60 };
v = H.versus(S, 'rhr', D0, 'latest');
check('without enough history there\'s no usual yet (and no tone)', v && v.usual == null && v.dir == null && v.tone === 'neutral', v);
S = withDays(person('lb'), 'sleepMin', 340, 340);
check('short sleep every night is steady, but still worth watching', H.versus(S, 'sleepMin', D0, 'week').dir === 'flat' && H.versus(S, 'sleepMin', D0, 'week').tone === 'watch');
S = withDays(person('lb'), 'rhr', 104, 104);
check('so is a resting heart rate over 100', H.versus(S, 'rhr', D0, 'latest').tone === 'watch');
check('no data at all → null', H.versus(person('lb'), 'hrv', D0, 'week') === null);

section('Weight follows the goal');
const weighed = (goal, from, to) => {
  const P = person('kg', { weightGoal: goal });
  for (let d = D0 - 13; d <= D0; d++) B.addWeight(P, d, d > D0 - 7 ? to : from, 'hc');
  return H.versus(P, 'weightKg', D0, 'week');
};
check('losing on a lose goal → good', weighed('lose', 80, 79.4).tone === 'good' && weighed('lose', 80, 79.4).dir === 'down');
check('gaining on a lose goal → watch when it\'s a lot', weighed('lose', 80, 81.5).tone === 'watch');
check('steady on maintain → good', weighed('maintain', 80, 80.1).dir === 'flat' && weighed('maintain', 80, 80.1).tone === 'good');
check('compared with the week before', Math.abs(weighed('gain', 70, 70.6).delta - 0.6) < 0.001 && weighed('gain', 70, 70.6).tone === 'good');

done();
