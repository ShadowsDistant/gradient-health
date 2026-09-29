// What training does to each muscle (src/body.js): weighted sets per muscle (primary 1, the rest 0.5,
// a set done on each side once), weekly buckets, what doesn't count (warm-ups, tests, mobility,
// conditioning, zeros, workouts not checked in), how it splits across the body, and what improved
// (outcomes, new bests, levels, weights, reps and estimated maxes) with readable lines. Also an
// empty history, and a real five-week simulation end to end.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/body.js');
const B = GH.brain, M = GH.moves, Y = GH.body;
const D = B.dayFromStr('2026-10-19'); // a Monday
const near = (a, b) => Math.abs(a - b) < 1e-9;
const LB = B.LB_PER_KG;

function person(p) {
  return B.newState(Object.assign({ goals: ['chest', 'arms'], experience: 'onoff', days: 3, minutes: 30, units: 'lb', weightKg: 70, equipment: { db: [10, 15], chair: true, wall: true, towel: true } }, p || {}), null, D - 120);
}
// A logged workout item. sets: amounts, or [amount, load kg] pairs; side: 'LR' logs each set on both sides.
function item(moveId, sets, o = {}) {
  const m = M.MOVES[moveId];
  const out = [];
  sets.forEach((s, k) => {
    const [amount, load] = Array.isArray(s) ? s : [s, null];
    for (const side of o.sides || [null]) out.push(Object.assign({ set: k, side, amount, target: amount }, load != null ? { load } : {}));
  });
  return { fam: o.fam || m.family, moveId, kind: o.kind || 'move', group: o.group || m.group, uni: !!o.sides, sets: out, rir: '12', outcome: o.outcome || 'hold', timed: !!m.timed };
}
function workout(S, day, items, o = {}) {
  S.log.push(Object.assign({ type: 'workout', day, items, checkedIn: true, pct: 1, celebrate: [] }, o));
}

section('Weighting');
let S = person();
workout(S, D - 2, [item('push_std', [12, 12, 12])]);
let r = Y.sets(S, D - 6, D);
check('a push-up set counts 1 for chest (primary)', near(r.sets.chest, 3), r.sets);
check('and 0.5 for triceps and front delts (secondary)', near(r.sets.triceps, 1.5) && near(r.sets.frontDelts, 1.5), r.sets);
check('muscles it doesn\'t train get nothing', r.sets.lats == null && r.sets.calves == null);
check('the exercise is listed under each muscle, with its sets', r.moves.chest[0].id === 'push_std' && near(r.moves.chest[0].sets, 3) && r.moves.chest[0].primary && !r.moves.triceps[0].primary, r.moves.chest);
M.MOVES.push_std.prime = 2;
r = Y.sets(S, D - 6, D);
check('a move with prime: 2 counts its first two muscles as primary', near(r.sets.chest, 3) && near(r.sets.triceps, 3) && near(r.sets.frontDelts, 1.5), r.sets);
delete M.MOVES.push_std.prime;
check('roles() lists each muscle once with its weight', JSON.stringify(Y.roles(M.MOVES.row_db)) === JSON.stringify([['lats', 1], ['upperBack', 0.5], ['rearDelts', 0.5], ['biceps', 0.5]]), Y.roles(M.MOVES.row_db));

section('Sides and what counts');
S = person();
workout(S, D - 1, [
  item('curl_1arm', [10, 10], { sides: ['L', 'R'] }),            // 2 sets, each on both sides
  item('curl_1arm', [9], { kind: 'extra', sides: ['L'] }),         // one extra lead-side set
  item('wu_squat', [10], { kind: 'warmup' }),
  item('sq_goblet', [12], { kind: 'test' }),
  item('mob_child', [45], { kind: 'mobility' }),
  item('fin_jacks', [30]),                                        // conditioning
  item('sq_goblet', [0, 12]),                                     // a zero isn't a set
]);
workout(S, D - 3, [item('raise', [15, 15])], { checkedIn: false });
r = Y.sets(S, D - 6, D);
check('a set done on each side counts once, the extra one-side set once', near(r.sets.biceps, 3), r.sets.biceps);
check('warm-ups, tests, mobility and conditioning don\'t count', r.sets.calves == null && r.sets.lowerBack == null && near(r.sets.quads, 1), r.sets);
check('a set logged as zero doesn\'t count', near(r.sets.quads, 1) && near(r.sets.glutes, 0.5), r.sets);
check('a workout that wasn\'t checked in doesn\'t count', r.sets.sideDelts == null);
check('setsDone counts distinct sets', Y.setsDone(item('curl_1arm', [8, 8, 8], { sides: ['L', 'R'] })) === 3);

section('Weekly buckets');
S = person();
workout(S, D, [item('push_std', [10])]);            // this week (Monday)
workout(S, D - 1, [item('push_std', [10, 10])]);    // last week (Sunday)
workout(S, D - 7, [item('push_std', [10, 10, 10])]); // last week (Monday)
workout(S, D - 20, [item('push_std', [10])]);       // three weeks back
workout(S, D - 200, [item('push_std', [10])]);      // long ago
r = Y.sets(S, D - 27, D);
check('buckets are calendar weeks from Monday, the last one running to today', r.weeks.length === 5 && r.weeks.every((w) => B.weekday(w.start) === 0) && r.weeks[4].start === D && r.weeks[4].to === D && r.weeks[3].to === D - 1, r.weeks.map((w) => [w.start - D, w.from - D, w.to - D]));
check('each week has its own sets', r.weeks.map((w) => w.sets.chest || 0).join() === '0,1,0,5,1', r.weeks.map((w) => w.sets.chest || 0));
check('the first week is clipped to the range', r.weeks[0].from === D - 27 && r.weeks[0].start === D - 27 - B.weekday(D - 27), [r.weeks[0].from - D, r.weeks[0].start - D]);
check('totals cover the range only', near(r.sets.chest, 7), r.sets.chest);
check('workouts counted', r.workouts === 4, r.workouts);
r = Y.sets(S, D - 400, D);
check('at most the last 12 weeks', r.weeks.length === 12 && r.from === D - 77 && near(r.sets.chest, 7), [r.weeks.length, r.from - D]);

section('Trained');
S = person();
workout(S, D - 1, [item('push_std', [10, 10, 10, 10]), item('curl_std', [10, 10]), item('sq_goblet', [12])]);
let t = Y.trained(S, D, 1);
const shareSum = Y.MUSCLES.reduce((a, m) => a + t.share[m], 0);
check('shares add up to 1', near(shareSum, 1), shareSum);
check('chest is most trained, then triceps and front delts', t.most[0] === 'chest' && t.most.length === 3 && near(t.max, 4), t.most);
check('the least trained skips muscles that only come along (hip flexors, forearms, lower back)', t.least.length === 3 && !t.least.some((m) => Y.MINOR.includes(m)) && t.least.every((m) => !(t.sets[m] > 0)), t.least);
check('groups add up: chest 4, biceps 2 + forearms 1 → 3, legs 1.5', near(t.groups.chest.sets, 4) && near(t.groups.biceps.sets, 3) && near(t.groups.legs.sets, 1.5), t.groups);
check('range: 1 week is the last 7 days', t.from === D - 6 && t.to === D && t.weeks === 1);
t = Y.trained(S, D, 40);
check('weeks are clamped to 12', t.weeks === 12);
t = Y.trained(person(), D, 4);
check('empty history: nothing trained, no most or least', t.sum === 0 && !t.most.length && !t.least.length && t.max === 0 && Y.MUSCLES.every((m) => t.share[m] === 0));

section('Improved');
S = person({ units: 'kg' });
const push = B.rungs(S, 'push', D);
S.prog.push = { rung: push[4], reps: 10, best: {} };
const up = (n) => ({ celebrate: [{ kind: 'level', text: `Push-ups: level ${n} of ${push.length}` }] });
workout(S, D - 40, [item(push[1], [15, 15], { outcome: 'up' })], up(3));              // before the range
workout(S, D - 20, [item(push[2], [12, 12], { outcome: 'up' }), item('curl_std', [[10, 4.5], [10, 4.5]], { outcome: 'hold' })], up(4));
workout(S, D - 10, [item(push[3], [14, 14], { outcome: 'up' }), item('curl_std', [[8, 7], [8, 7]], { outcome: 'up' })], up(5));
workout(S, D - 3, [item(push[4], [10, 10], { outcome: 'down' }), item('curl_std', [[12, 7], [11, 7]], { outcome: 'up' })]);
let imp = Y.improved(S, D, 4);
const lvl = imp.lines.find((l) => l.kind === 'level');
check('a level line from the level-ups in range ("Push-ups: level 5 of 8")', lvl && lvl.text === `Push-ups level 3 → 5` && lvl.delta === '+2 levels' && lvl.dir === 1, lvl);
const wl = imp.lines.find((l) => l.kind === 'weight');
check('a weight line for a heavier dumbbell', wl && wl.text === 'Dumbbell curl 4.5 → 7 kg' && wl.delta === '+2.5 kg', wl);
check('outcomes: 2 ups and 1 down for chest; each counted for the muscles it trains', imp.ups.chest === 2 && imp.downs.chest === 1 && imp.ups.triceps === 2 && imp.holds.biceps === 1 && imp.ups.biceps === 2, [imp.ups, imp.downs, imp.holds]);
// chest: outcomes +1 +1 -1, levels +2 (primary 1); curl: 2 ups, new bests at D-10 (heavier) and D-3.
check('score weights primary 1 and secondary 0.5', near(imp.score.chest, 1 + 2) && near(imp.score.triceps, 0.5 * (1 + 2)), [imp.score.chest, imp.score.triceps]);
check('new bests are counted per muscle', imp.bests.biceps === 2 && imp.bests.chest == null, imp.bests);
check('level-ups are counted for the muscles of the move', imp.levelUps.chest === 2 && imp.levelUps.triceps === 2, imp.levelUps);
check('lines per muscle list primary ones first', imp.byMuscle.chest[0] === lvl && imp.byMuscle.biceps[0] === wl && imp.byMuscle.forearms[0] === wl);
check('group lines go with the primary muscle\'s group', imp.groups.chest.lines[0] === lvl && imp.groups.biceps.lines[0] === wl && !imp.groups.triceps.lines.length, Object.fromEntries(Object.entries(imp.groups).map(([g, x]) => [g, x.lines.map((l) => l.text)])));
check('most improved: chest, then biceps', imp.most[0] === 'chest' && imp.most[1] === 'biceps', [imp.most, imp.score]);
imp = Y.improved(S, D, 1);
check('1 week: only that week\'s outcomes (the down), and no level-up inside it', imp.downs.chest === 1 && !imp.ups.chest && !imp.lines.some((l) => l.kind === 'level'), [imp.ups, imp.downs, imp.lines.map((l) => l.text)]);
S.prog.curl = { rung: 'curl_hammer', reps: 12, best: {} };
check('a move that isn\'t the ladder\'s rung (a swap) invents no level', !Y.improved(S, D, 4).lines.some((l) => l.fam === 'curl' && l.kind === 'level'));
check('reps line compares with the last time before the range', (() => { const x = imp.lines.find((l) => l.id === 'curl_std'); return x && x.kind === 'reps' && x.text === 'Dumbbell curl 8 → 12 reps' && x.delta === '+4 reps'; })(), imp.lines.map((l) => l.text));

section('Reps, seconds and pounds');
S = person();
S.prog.push = { rung: 'push_std', reps: 20, best: {} };
S.prog.rear = { rung: 'rear_towel', reps: 45, best: {} };
workout(S, D - 12, [item('push_std', [14, 14], { outcome: 'up' }), item('rear_towel', [20], { outcome: 'up' }), item('curl_std', [[10, 10 / LB]], { outcome: 'up' })]);
workout(S, D - 2, [item('push_std', [20, 19], { outcome: 'up' }), item('rear_towel', [45], { outcome: 'up' }), item('curl_std', [[10, 15 / LB]], { outcome: 'up' })]);
imp = Y.improved(S, D, 4);
const txt = imp.lines.map((l) => l.text);
check('reps: "Push-up 14 → 20 reps"', txt.includes('Push-up 14 → 20 reps'), txt);
check('seconds for timed moves', txt.includes('Towel pull-apart hold 20 → 45 s') && imp.lines.find((l) => l.kind === 'time').delta === '+25 s', txt);
check('weights in the person\'s units', txt.includes('Dumbbell curl 10 → 15 lb'), txt);
check('new bests from the second time on', imp.bests.chest === 1 && imp.bests.rearDelts === 1 && imp.bests.biceps === 1, imp.bests);

section('Estimated maxes (gym)');
S = person({ units: 'kg' });
S.prog.pressG = { rung: 'bench_bb', reps: 8, best: {}, loads: {}, e1rm: { bench_bb: { best: 72.5, last: 72.5, day: D, hist: [0, 1, 2, 3, 4, 5].map((i) => [D - 35 + i * 7, 60 + i * 2.5]) } }, gym: true };
imp = Y.improved(S, D, 12);
const mx = imp.lines.find((l) => l.kind === 'max');
check('"Barbell bench press 60 → 72.5 kg", noted as an estimated max', mx && mx.text === 'Barbell bench press 60 → 72.5 kg' && mx.note === 'estimated max' && mx.delta === '+12.5 kg', mx);
check('each rise counts as a step up for chest (none logged those days)', imp.ups.chest === 5 && near(imp.score.chest, 5) && near(imp.score.triceps, 2.5), [imp.ups, imp.score]);
imp = Y.improved(S, D, 4);
check('4 weeks: from where it stood before the range', imp.lines[0].text === 'Barbell bench press 62.5 → 72.5 kg' && imp.ups.chest === 4, [imp.lines.map((l) => l.text), imp.ups]);
workout(S, D - 7, [item('bench_bb', [[8, 67.5]], { fam: 'pressG', outcome: 'up' })]);
imp = Y.improved(S, D, 4);
check('a day that was logged counts once (from the log)', imp.ups.chest === 4, imp.ups);
S.profile.units = 'lb';
imp = Y.improved(S, D, 12);
check('in pounds, to the pound', imp.lines.find((l) => l.kind === 'max').text === 'Barbell bench press 132 → 160 lb', imp.lines.map((l) => l.text));

section('Empty and quiet');
imp = Y.improved(person(), D, 4);
check('no history: no lines, scores, most or least', !imp.lines.length && !Object.keys(imp.score).length && !imp.most.length && !imp.least.length && imp.max === 0);
S = person();
workout(S, D - 2, [item('push_std', [10, 10], { outcome: 'hold' })]);
imp = Y.improved(S, D, 4);
check('trained but held: no progress, nothing named', !imp.lines.length && !imp.most.length && imp.holds.chest === 1 && near(imp.sets.chest, 2), [imp.lines, imp.most]);
const one = Y.muscle(S, D, 4, 'chest');
check('muscle(): sets, share, rank, 12 weekly buckets, exercises', near(one.sets, 2) && one.rank === 1 && one.weekly.length === 12 && near(one.weekly[10].sets, 2) && one.weekly[11].start === D && one.moves[0].id === 'push_std' && one.name === 'Chest' && one.group === 'chest', one);
const none = Y.muscle(S, D, 4, 'calves');
check('an untrained muscle has no rank, sets or lines', none.sets === 0 && none.rank === null && !none.lines.length && none.weekly.every((w) => w.sets === 0));

section('Five weeks of real workouts');
S = B.newState({ goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, units: 'lb', weightKg: 68.4, equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null } }, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, D - 35);
for (let d = D - 35; d < D; d++) {
  if (B.todayPlan(S, d).type !== 'workout') continue;
  B.startWorkout(S, d, { now: d * B.DAY_MS + 17 * 3600000 });
  let g = 0;
  while (S.active && S.active.idx < S.active.steps.length && g++ < 400) {
    const st = S.active.steps[S.active.idx];
    B.completeStep(S, st.kind === 'test' ? { value: st.side === 'L' ? 14 : 15 } : {});
    if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 4 === 0 ? '3' : '12');
  }
  B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 18 * 3600000 });
}
t = Y.trained(S, D, 4);
imp = Y.improved(S, D, 4);
check('trained: most of the body, calves untouched at home', t.sum > 50 && t.most.length === 3 && !(t.sets.calves > 0) && t.least[0] === 'calves', [t.sum, t.most, t.least]);
check('every logged set is accounted for (weights 1 and 0.5 only)', Y.MUSCLES.every((m) => !(t.sets[m] > 0) || Number.isInteger(t.sets[m] * 2)));
check('improved: lines for the exercises that went up, all readable', imp.lines.length >= 5 && imp.lines.every((l) => /→/.test(l.text) && /^[+−]/.test(l.delta)), imp.lines.map((l) => `${l.text} (${l.delta})`));
check('and the goal muscles lead', ['biceps', 'triceps', 'chest', 'abs', 'quads', 'glutes'].includes(imp.most[0]), [imp.most, imp.score]);
check('the log is untouched', S.log.filter((l) => l.type === 'workout').every((l) => l.items.every((it) => !('muscles' in it))));
let t0 = Date.now();
for (let i = 0; i < 20; i++) { Y.trained(S, D, 12); Y.improved(S, D, 12); }
const ms = (Date.now() - t0) / 20;
check(`fast: trained + improved in ${ms.toFixed(1)} ms`, ms < 25, ms);

done();
