// Training at a gym, end to end with the real exercise library: sessions built from the gym pools,
// starting weights, double progression (reps up to the top of the range, then more weight), lighter
// after two short sessions, home and gym progress kept apart, and "both" switching per day.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js');
const B = GH.brain, M = GH.moves;
const D0 = B.dayFromStr('2026-09-28'); // a Monday

function person(p) {
  const base = { goals: ['chest', 'strength'], experience: '1to3', days: 3, minutes: 45, age: 30, units: 'kg', weightKg: 80, heightCm: 180, sex: 'male', equipment: { db: [5, 10] } };
  const S = B.newState(Object.assign(base, p || {}), null, D0);
  return S;
}
// Does every set of a workout: reps from reps(item, set) (default: the target), and the given effort.
function train(S, day, reps, rir) {
  const plan = B.todayPlan(S, day);
  if (plan.type !== 'workout') return null;
  B.startWorkout(S, day, { now: (day * B.DAY_MS) + 17 * 3600000 });
  let guard = 0;
  while (S.active && S.active.idx < S.active.steps.length && guard++ < 500) {
    const st = S.active.steps[S.active.idx];
    const r = st.kind === 'set' && reps ? reps(st.item, st.set) : null;
    B.completeStep(S, st.kind === 'test' ? { value: 12 } : r != null ? { reps: r } : {});
    if (st.askRir) B.setRir(S, st.item, rir || '12');
  }
  return B.finishWorkout(S, { rating: 'right', now: (day * B.DAY_MS) + 18 * 3600000 });
}
const workoutDays = (S, from, n) => { const out = []; for (let d = from; out.length < n && d < from + 60; d++) if (B.todayPlan(S, d).type === 'workout') out.push(d); return out; };

section('A gym session');
let S = person({ where: 'gym', gym: B.gymPreset('full', 'kg') });
const d1 = workoutDays(S, D0, 1)[0];
const plan = B.todayPlan(S, d1);
let s = B.buildSession(S, d1, plan.tpl, {});
const gymItems = s.items.filter((it) => M.LADDERS[it.fam] && M.LADDERS[it.fam].gym);
check('the session is built from gym exercises', gymItems.length >= 2, s.items.map((i) => `${i.fam}:${i.moveId}`));
check('every loaded gym exercise has a starting weight', gymItems.filter((it) => M.MOVES[it.moveId].load && it.load).every((it) => it.load.kg > 0 && it.load.guess), gymItems.map((i) => i.load));
const bench = gymItems.find((it) => it.fam === 'pressG');
check('chest day starts with the barbell bench press', !bench || bench.moveId === 'bench_bb', bench && bench.moveId);
check('barbell weights land on 2.5 kg steps', gymItems.filter((it) => it.load && it.load.key === 'bb').every((it) => Math.abs(it.load.kg / 2.5 - Math.round(it.load.kg / 2.5)) < 1e-6));
check('strength goal: main lifts in the 4-8 range', !bench || (bench.lo <= 4 || B.rangeFor(S, M.MOVES[bench.moveId], 'pressG')[1] <= 8), B.rangeFor(S, M.MOVES.bench_bb, 'pressG'));

section('Double progression');
S = person({ where: 'gym', gym: B.gymPreset('full', 'kg'), goals: ['chest', 'arms'] });
const days = workoutDays(S, D0, 12);
const first = {};
for (const d of days) {
  train(S, d, (it) => (it.timed ? null : (it.curTarget || it.target || it.reps)), '3');
  for (const [fam, st] of Object.entries(S.prog)) if (st.gym && st.loads) for (const [id, kg] of Object.entries(st.loads)) if (first[id] == null) first[id] = kg;
}
const grew = Object.entries(first).filter(([id, kg]) => { for (const st of Object.values(S.prog)) if (st.loads && st.loads[id] > kg) return true; return false; });
check('hitting every rep with reps to spare adds weight over four weeks', grew.length >= 2, { first, now: Object.fromEntries(Object.entries(S.prog).filter(([, st]) => st.gym).map(([f, st]) => [f, st.loads])) });
const pr = S.prog.pressG;
check('reps reset to the bottom of the range after a weight jump', !pr || pr.reps <= B.rangeFor(S, M.MOVES[pr.rung], 'pressG')[1], pr);
check('an estimated one-rep max is kept', !pr || Object.values(pr.e1rm || {}).some((e) => e.best > 0 && e.hist.length >= 2));

section('Short of the range');
S = person({ where: 'gym', gym: B.gymPreset('full', 'kg') });
const sd = workoutDays(S, D0, 12);
let before = null, after = null;
for (const d of sd) {
  train(S, d, (it) => (it.fam === 'pressG' ? 2 : null), '0');
  const st = S.prog.pressG;
  if (st && st.loads && st.loads.bench_bb != null) { if (before == null) before = st.loads.bench_bb; after = st.loads.bench_bb; }
}
check('two sessions well short means a lighter weight', before != null && after < before, { before, after });

section('Home and gym');
S = person({ where: 'both', gym: B.gymPreset('basic', 'kg') });
const bd = workoutDays(S, D0, 2);
B.setPlace(S, bd[0], 'home');
s = B.buildSession(S, bd[0], B.todayPlan(S, bd[0]).tpl, {});
check('at home the session uses home exercises', s.items.every((it) => !(M.LADDERS[it.fam] || {}).gym), s.items.map((i) => i.fam));
B.setPlace(S, bd[0], 'gym');
s = B.buildSession(S, bd[0], B.todayPlan(S, bd[0]).tpl, {});
check('switched to the gym, the same day uses gym exercises', s.items.some((it) => (M.LADDERS[it.fam] || {}).gym), s.items.map((i) => i.fam));
check('the switch is remembered for the next day', B.placeOf(S, bd[1]) === 'gym');

section('Home only');
S = person({ where: 'home', equipment: { db: [5, 10, 15], kb: [12], band: true, bar: true } });
for (const d of workoutDays(S, D0, 8)) train(S, d, null, '12');
check('a home plan never starts a gym pool', !Object.keys(S.prog).some((f) => (M.LADDERS[f] || {}).gym), Object.keys(S.prog).filter((f) => (M.LADDERS[f] || {}).gym));
check('and never offers one as a swap', (() => { const d = workoutDays(S, D0 + 28, 1)[0]; const ss = B.buildSession(S, d, B.todayPlan(S, d).tpl, {}); return ss.items.every((it) => B.swapOptions(S, it, d).every((o) => !Object.values(M.LADDERS).some((l) => l.gym && l.rungs.includes(o.id) && !M.MOVES[o.id].family))); })());

section('Dumbbell racks and units');
check('a rack up to 15 kg includes 15', B.dbRack(15, 'kg').slice(-1)[0] === 15 && B.dbRack(50, 'kg').slice(-1)[0] === 50 && B.dbRack(75, 'lb').slice(-1)[0] === 75);
check('switching units keeps the rack the same size', B.convertDbMax(100, 'kg') === 50 && B.convertDbMax(25, 'lb') === 50 && B.convertDbMax(0, 'kg') === 0);

section('Equipment changes');
S = person({ where: 'gym', gym: B.gymPreset('full', 'kg') });
train(S, workoutDays(S, D0, 1)[0], null, '12');
const small = B.gymPreset('small', 'kg');
B.reprogram(S, { gym: small }, D0 + 7);
const d2 = workoutDays(S, D0 + 7, 1)[0];
s = B.buildSession(S, d2, B.todayPlan(S, d2).tpl, {});
check('a smaller gym: nothing needs a barbell any more', s.items.every((it) => !(M.MOVES[it.moveId].req || []).some((r) => r.split('|').every((k) => k === 'bb'))), s.items.map((i) => i.moveId));

done();
