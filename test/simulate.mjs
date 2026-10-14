// Fake-history simulation: drives the brain day by day and checks streaks, rung changes,
// deloads, the left-arm extra set, readiness and scheduling. Exits non-zero on any failure.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js');
const B = GH.brain;
const M = GH.moves;
const LB = B.LB_PER_KG;

const D0 = B.dayFromStr('2026-09-28'); // Monday
const USER = {
  goals: ['abs', 'arms', 'chest', 'legs', 'consistency'], experience: 'onoff', keptRoutine: false, recentActivity: 'none',
  days: 4, minutes: 25, age: 19, units: 'lb', weightKg: 148.8 / LB, weightGoal: 'maintain',
  equipment: { db: [8], kb: [10], ball: true, ballLb: null, ballSlam: false, chair: true, wall: true, towel: true },
  lead: { arm: 'L', leg: null }, sleepIrregular: true,
};
const BASELINE = { pushups: 24, knees: false, plankSec: 50, curlL: 14, curlR: 18 };

function doWorkout(S, day, o = {}) {
  const r = B.startWorkout(S, day, { short: o.short, now: day * B.DAY_MS + 18 * 3600000 });
  if (r.error) throw new Error(`startWorkout ${B.dayStr(day)}: ${r.error}`);
  const A = S.active;
  const seen = [];
  let guard = 0;
  while (S.active && A.idx < A.steps.length && guard++ < 800) {
    const st = A.steps[A.idx];
    let res = {};
    if (st.kind === 'set') {
      const target = B.currentTarget(A, st);
      const over = o.reps && o.reps[st.item.fam];
      const val = over != null && st.first !== false ? over : target;
      res = st.item.timed ? { secs: val } : { reps: val };
      seen.push({ fam: st.item.fam, side: st.side, first: st.first, target, val, extra: st.item.kind === 'extra' });
    } else if (st.kind === 'test') {
      res.value = (o.test && o.test[st.side]) || 10;
      seen.push({ test: st.item.test, side: st.side });
    }
    B.completeStep(S, res);
    if (st.askRir) B.setRir(S, st.item, (o.rir && o.rir[st.item.fam]) || o.defaultRir || '12');
  }
  const out = B.finishWorkout(S, {
    rating: o.rating || 'right', complicated: o.complicated == null ? false : o.complicated,
    pain: o.pain || [], weightKg: o.weightKg, now: day * B.DAY_MS + 19 * 3600000,
  });
  out.seen = seen;
  out.session = r.session;
  return out;
}
function lightDay(S, day, o = {}) {
  if (o.auto) B.autoWalk(S, day); else B.logLight(S, day, 'walk', true);
  B.logLight(S, day, 'mobility', true);
}
function health(S, day, h) {
  S.health.days[day] = Object.assign(S.health.days[day] || {}, h);
  if (h.weightKg) B.addWeight(S, day, h.weightKg, 'hc');
}
const totalSets = (s) => s.items.reduce((a, it) => a + it.sets, 0);
const lineTexts = (r) => r.lines.map((l) => `${l.text}: ${l.why}`);
const week = (S, day) => B.calendar(S, day).weeks[B.weekStart(day)];

/* ------------------------------------------------------------------ Scenario A */
section('Scenario A: your answers, 3 weeks from Mon Sep 28');
{
  const S = B.newState(USER, BASELINE, D0);
  const prog = B.programFor(S.profile);
  const tpl = B.templateFor(S.profile, prog);
  const count = (u) => tpl.filter((t) => t.units.includes(u)).length;
  check('arms and abs 3× a week, chest and legs 2×, back 2×',
    count('arms') === 3 && count('abs') === 3 && count('chest') === 2 && count('legs') === 2 && count('back') === 2,
    tpl.map((t) => t.units.join('+')));
  check('baseline set push-ups to 18 standard, curls to 11', S.prog.push.rung === 'push_std' && S.prog.push.reps === 18 && S.prog.curl.rung === 'curl_std' && S.prog.curl.reps === 11,
    { push: S.prog.push, curl: S.prog.curl });
  check('left arm catch-up active from the baseline (22% gap)', S.catchup.arm.active && Math.abs(S.catchup.arm.tests[0].gap - 0.222) < 0.01);
  check('protein goal ≈ 119 g', B.proteinGoal(S, D0) === 119, B.proteinGoal(S, D0));

  // On-ramp: weeks 1-2 ≈ 70% of the same week without it.
  const wk = (mult) => [0, 1, 2, 3].reduce((a, i) => a + totalSets(B.buildSession(S, D0 + tpl[i].offset, i, { noTrim: true, noReadiness: true, forceMult: mult })), 0);
  const onramp = [0, 1, 2, 3].reduce((a, i) => a + totalSets(B.buildSession(S, D0 + tpl[i].offset, i, { noTrim: true, noReadiness: true })), 0);
  const full = wk(1);
  check(`week 1 is ~70% volume (${onramp} of ${full} sets)`, onramp / full >= 0.6 && onramp / full <= 0.8);
  check('week 1 is an on-ramp week', week(S, D0).phase.onramp && !week(S, D0).phase.deload);

  // Week 1 health data: low steps, a fast drop in weight.
  const kg0 = 148.8 / LB;
  for (let d = D0 - 10; d < D0 + 21; d++) health(S, d, { steps: 1800, rhr: 62, hrv: 55, sleepMin: 390 });
  for (let i = 0; i < 14; i++) health(S, D0 + i, { weightKg: kg0 * (1 - 0.0024 * i) });

  // 1.6: the optimizer's split for these answers trains chest on Tuesday and Thursday (1.5 had it on
  // Monday and Friday), so the push-up steps are checked on the first two chest days.
  const chestDays = tpl.filter((t) => t.units.includes('chest')).map((t) => D0 + t.offset);
  check('1.6 split: chest on Tuesday and Thursday', chestDays.join() === [D0 + 1, D0 + 3].join(), tpl.map((t) => `${t.offset}:${t.units.join('+')}`));
  // Mon: triceps short (rung-down path); curls +1; squats +2; rows hold.
  const extraSeen = [];
  let r = doWorkout(S, D0, { rir: { push: '3', curl: '12', squat: '12', row: '0' }, reps: { triceps: 4 } });
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  check('Mon: curls +1 (11 → 12, 1-2 left)', S.prog.curl.reps === 12, S.prog.curl);
  check('Mon: rows held at 14 (0 left)', S.prog.row.reps === 14, S.prog.row);
  check('Mon: triceps below range → target matches what you got (6)', S.prog.triceps.reps === 6 && S.prog.triceps.rung === 'tri_dip_bent', S.prog.triceps);
  const uniOk = (seen) => {
    const bySet = {};
    for (const x of seen) if (x.side && !x.extra && !x.test) (bySet[`${x.fam}:${seen.indexOf(x) >> 1}`] = bySet[`${x.fam}:${seen.indexOf(x) >> 1}`] || []).push(x);
    return seen.every((x, i) => x.first !== false || !seen[i - 1] || x.val <= seen[i - 1].val);
  };
  check('Mon: second side never did more than the first', uniOk(r.seen));
  // Tue: push-ups 3+ left (18 → 20).
  r = doWorkout(S, D0 + 1, { rir: { squat: '12', push: '3' }, reps: { triceps: 4 } });
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  check('Tue (first chest day): push-ups → 20 reps (3+ left)', S.prog.push.reps === 20, lineTexts(r));
  check('Tue: triceps below range twice → down a rung with a cooldown', S.prog.triceps.rung === 'tri_oh' && S.prog.triceps.cooldown === 2, S.prog.triceps);
  check('Tue: goblet squat +2 (15 → 17, 1-2 left at 12+ reps)', S.prog.squat.reps === 17, S.prog.squat);
  lightDay(S, D0 + 2);
  r = doWorkout(S, D0 + 3, { rir: { push: '3' } });
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  check('Thu (second chest day): push-ups at 20 with 3+ left → Push-up, 3-sec lowering', S.prog.push.rung === 'push_slow', lineTexts(r));
  check('Thu: the rung-up is celebrated', r.celebrate.some((c) => c.kind === 'level'), r.celebrate);
  r = doWorkout(S, D0 + 4, {});
  health(S, D0 + 5, { steps: 6200 });
  lightDay(S, D0 + 5, { auto: true });
  check('Sat: steps auto-logged the walk', S.log.find((l) => l.type === 'light' && l.day === D0 + 5).walk === 'health-steps' || S.log.find((l) => l.type === 'light' && l.day === D0 + 5).walkSrc === 'health-steps');
  lightDay(S, D0 + 6);
  let cal = B.calendar(S, D0 + 7);
  check('streak is 7 after week 1 (light days count)', cal.streak.current === 7, cal.streak);
  check('weekly streak is 1 after a full week', cal.streak.weekly === 1, cal.streak);
  check('extra left-only curl set on every arm day in week 1', extraSeen.every(Boolean), extraSeen);

  // Week 2: Mon hard + short sleep; Tue missed; Wed (shifted) hard + short sleep → deload next week.
  health(S, D0 + 7, { sleepMin: 270 });
  const planned7 = B.buildSession(S, D0 + 7, 0, { noReadiness: true });
  const ready7 = B.buildSession(S, D0 + 7, 0, {});
  check('short sleep (4 h 30) → one less set per exercise',
    ready7.items.every((it, i) => it.sets === Math.max(1, planned7.items[i].sets - 1)), [planned7.items.map((x) => x.sets), ready7.items.map((x) => x.sets)]);
  r = doWorkout(S, D0 + 7, { rating: 'hard' });
  check('Mon week 2: no deload yet after one too-hard with bad sleep', !S.events.some((e) => e.type === 'deloadNext'));
  cal = B.calendar(S, D0 + 9);
  check('Tue miss uses the weekly freeze', cal.days[D0 + 8].frozen === true && cal.days[D0 + 8].missed, cal.days[D0 + 8]);
  check('the week shifts forward: Wed now holds Tuesday\'s session', B.todayPlan(S, D0 + 9, cal).type === 'workout' && B.todayPlan(S, D0 + 9, cal).tpl === 1);
  check('streak survives the frozen day (8)', cal.streak.current === 8, cal.streak);
  health(S, D0 + 9, { sleepMin: 276 });
  r = doWorkout(S, D0 + 9, { rating: 'hard', weightKg: kg0 * (1 - 0.0024 * 9) });
  check('Wed: too hard twice in a row → one less set per muscle', lineTexts(r).some((t) => t.startsWith('One less set per muscle')), lineTexts(r));
  check('Wed: too hard + short sleep twice in two weeks → deload next week', lineTexts(r).some((t) => t.startsWith('Deload next week')), lineTexts(r));
  check('losing >1% a week → eat-more line', lineTexts(r).some((t) => t.startsWith('Eat more')), lineTexts(r));
  // Thu is now a light day (Thursday's session moved to Fri); Fri missed → streak breaks.
  cal = B.calendar(S, D0 + 10);
  check('Thu became a light day after the shift', cal.days[D0 + 10].planned === 'light', cal.days[D0 + 10]);
  health(S, D0 + 11, { exercise: [{ typeName: 'running', minutes: 60 }] });
  cal = B.calendar(S, D0 + 12);
  check('second miss in the week breaks the streak', cal.days[D0 + 11].broken === true && cal.streak.current === 0, cal.streak);
  // Sat: legs day after a 60-min run and a resting-HR spike: legs trimmed, no finisher, readiness not stacked.
  // (A template with legs in it: 1.6's split has them on its first and last days.)
  const legTpl = tpl.filter((t) => t.units.includes('legs')).map((t) => t.idx);
  health(S, D0 + 12, { rhr: 71, sleepMin: 260 });
  const plan12 = B.buildSession(S, D0 + 12, legTpl[legTpl.length - 1], { noReadiness: true });
  const real12 = B.buildSession(S, D0 + 12, legTpl[legTpl.length - 1], {});
  const legsOk = real12.items.filter((it) => it.group === 'legs').every((it) => { const p = plan12.items.find((x) => x.fam === it.fam); return p && it.sets <= Math.max(1, p.sets - 1); });
  const nonLegOk = real12.items.filter((it) => it.group !== 'legs').every((it) => { const p = plan12.items.find((x) => x.fam === it.fam); return p && it.sets >= Math.max(1, p.sets - 1); });
  check('after a 60-min run: leg sets trimmed and no finisher', legsOk && !real12.finisher, real12.readiness.reasons);
  check('short sleep + high resting HR still only one less set (not stacked)', nonLegOk, [plan12.items.map((x) => x.sets), real12.items.map((x) => x.sets)]);
  r = doWorkout(S, D0 + 12, { pain: ['knee'] });
  check('knee pain → a 14-day knee break line', lineTexts(r).some((t) => t.startsWith('Knee break until')), lineTexts(r));
  r = doWorkout(S, D0 + 13, {});
  cal = B.calendar(S, D0 + 14);
  const w2 = cal.weeks[B.weekStart(D0 + 7)];
  const perDay = {};
  for (const w of Object.values(cal.weeks)) for (const s of w.sessions) if (!s.dropped && s.day != null) perDay[s.day] = (perDay[s.day] || 0) + 1;
  check('never two workouts on one day', Object.values(perDay).every((n) => n === 1), perDay);
  check('week 2: every (shifted) session done → weekly streak 2', w2.allDone && cal.streak.weekly === 2, cal.streak);
  check('streak counts back up after the break (Sat, Sun = 2)', cal.streak.current === 2, cal.streak);

  // Week 3: deload, L/R test on Monday, knee swaps active.
  const w3 = cal.weeks[B.weekStart(D0 + 14)];
  check('week 3 is a deload week', w3.phase.deload && w3.phase.mult === 0.6, w3.phase);
  const deloadSets = [0, 1, 2, 3].reduce((a, i) => a + totalSets(B.buildSession(S, D0 + 14 + tpl[i].offset, i, { noTrim: true, noReadiness: true })), 0);
  const normalSets = [0, 1, 2, 3].reduce((a, i) => a + totalSets(B.buildSession(S, D0 + 14 + tpl[i].offset, i, { noTrim: true, noReadiness: true, forceMult: 1 })), 0);
  // 1.6: every group keeps its (lighter) weekly minimum on a deload too, so with short sessions and
  // small weekly volumes the drop can be a little under 40%.
  check(`deload ≈ 40% less volume (${deloadSets} of ${normalSets} sets)`, deloadSets / normalSets >= 0.5 && deloadSets / normalSets <= 0.75);
  const legsWeek3 = B.buildSession(S, D0 + 15, legTpl[0], {});
  const squatFamily = legsWeek3.items.filter((it) => it.moveId.startsWith('sq_'));
  const kneeLoaded = legsWeek3.items.filter((it) => (M.MOVES[it.moveId].joints || []).includes('knee'));
  check('knee break: no squat-family or knee-loading moves', squatFamily.length === 0 && kneeLoaded.length === 0, legsWeek3.items.map((x) => x.moveId));
  const progOf = (st) => JSON.stringify({ rung: st.rung, reps: st.reps, w: st.w });
  const before = progOf(S.prog.curl);
  // Before the test the extra left set is still planned (untrimmed: on this deload + test day the
  // 25-minute budget can squeeze it out).
  const extrasBefore = B.buildSession(S, D0 + 14, 0, { noTrim: true }).extras.length;
  r = doWorkout(S, D0 + 14, { defaultRir: '3', test: { L: 17, R: 18 } });
  check('Mon week 3: left/right test ran (L17/R18 = 5.6%)', r.seen.some((x) => x.test === 'arm') && S.catchup.arm.tests.length === 2 && Math.abs(S.catchup.arm.tests[1].gap - 0.056) < 0.01, S.catchup.arm.tests);
  check('gap under 10% → extra left set dropped, even from that session', extrasBefore === 1 && !r.seen.some((x) => x.extra) && !S.catchup.arm.active, { extrasBefore, seenExtra: r.seen.some((x) => x.extra), active: S.catchup.arm.active });
  check('deload holds progression (3+ answers change nothing; bests still count)', progOf(S.prog.curl) === before, [before, S.prog.curl]);
  const tue3 = B.buildSession(S, D0 + 15, 1, {});
  check('no extra left set on the next arm day', tue3.extras.length === 0);
  // Knee break ends after 14 days.
  const after = B.buildSession(S, D0 + 12 + 15, legTpl[0], {});
  check('knee swaps end after 14 days', after.items.some((it) => (M.MOVES[it.moveId].joints || []).includes('knee')), after.items.map((x) => x.moveId));
  // Short on time.
  const shorts = [0, 1, 2, 3].map((i) => B.buildSession(S, D0 + 21 + tpl[i].offset, i, { short: true }).estimateMin);
  check(`short on time: every day 12-15 min (${shorts.join(', ')})`, shorts.every((m) => m >= 12 && m <= 15));
  // Normal sessions fit the chosen 25 minutes.
  const normal = [0, 1, 2, 3].map((i) => B.buildSession(S, D0 + 21 + tpl[i].offset, i, {}).estimateMin);
  check(`normal sessions fit 25 min (${normal.join(', ')})`, normal.every((m) => m <= 27));
  // Weekly sets per muscle are tracked.
  const ws = B.weeklySets(S, D0 + 13);
  check('weekly hard sets counted per muscle', ws.biceps.done > 0 && ws.chest.done > 0, ws);
}

/* ------------------------------------------------------------------ Scenario B */
section('Scenario B: five clean weeks → scheduled deload in week 5');
{
  const S = B.newState(USER, BASELINE, D0);
  const tpl = B.templateFor(S.profile, B.programFor(S.profile));
  for (let w = 0; w < 4; w++) for (const t of tpl) doWorkout(S, D0 + w * 7 + t.offset, {});
  const cal = B.calendar(S, D0 + 28);
  check('weeks 1-4 are not deloads', [0, 1, 2, 3].every((w) => !cal.weeks[D0 + w * 7].phase.deload));
  check('week 5 is the scheduled deload', cal.weeks[D0 + 28].phase.deload, cal.weeks[D0 + 28].phase);
  check('weeks 3-4 run at full volume', cal.weeks[D0 + 14].phase.mult === 1 && cal.weeks[D0 + 21].phase.mult === 1);
  check('arms and abs grew +1 set per full week without "too hard"', S.vol.biceps > 8 && S.vol.abs > 8, S.vol);
}

/* ------------------------------------------------------------------ Scenario C */
section('Scenario C: early deload in week 3 → next one in week 8');
{
  const S = B.newState(USER, BASELINE, D0);
  const tpl = B.templateFor(S.profile, B.programFor(S.profile));
  for (let w = 0; w < 7; w++) {
    for (const t of tpl) {
      const day = D0 + w * 7 + t.offset;
      if (w === 1 && t.idx < 2) { health(S, day, { sleepMin: 250 }); doWorkout(S, day, { rating: 'hard' }); }
      else doWorkout(S, day, {});
    }
  }
  const cal = B.calendar(S, D0 + 49);
  const deloads = Object.values(cal.weeks).filter((w) => w.phase.deload).map((w) => (w.ws - D0) / 7 + 1);
  check(`deload weeks are 3 and 8 (${deloads.join(', ')})`, deloads.join(',') === '3,8');
}

/* ------------------------------------------------------------------ Scenario D */
section('Scenario D: no equipment, 3 days, lose fat, careful knee, no jumping');
{
  const P = {
    goals: ['fat', 'consistency'], experience: 'never', days: 3, minutes: 20, weightKg: 90, weightGoal: 'lose',
    equipment: { db: [], kb: [], ball: false, chair: true, wall: true, towel: true }, careful: ['knee'], impactOk: false,
  };
  const S = B.newState(P, null, D0);
  const tpl = B.templateFor(S.profile, B.programFor(S.profile));
  const sessions = [];
  for (let w = 0; w < 3; w++) for (const t of tpl) sessions.push(B.buildSession(S, D0 + w * 7 + t.offset, t.idx, {}));
  const all = sessions.flatMap((s) => s.items.concat(s.extras, s.finisher ? [s.finisher] : [], s.warmup));
  check('no move needs equipment they don\'t have', all.every((it) => M.allowed(M.MOVES[it.moveId], S.profile.equipment)), all.filter((it) => !M.allowed(M.MOVES[it.moveId], S.profile.equipment)).map((x) => x.moveId));
  check('no jumping or slamming', all.every((it) => !M.MOVES[it.moveId].impact));
  check('no risky knee moves (complex or impact on a careful knee)', all.every((it) => { const m = M.MOVES[it.moveId]; return !((m.complex || m.impact) && (m.joints || []).includes('knee')); }));
  check('every session fits 20 min', sessions.every((s) => s.estimateMin <= 22), sessions.map((s) => s.estimateMin));
  check('finishers show up for the fat-loss goal', sessions.some((s) => s.finisher));
  check('every day has real work', sessions.every((s) => s.items.length >= 3), sessions.map((s) => s.items.length));
}

/* ------------------------------------------------------------------ Scenario E */
section('Scenario E: advanced, dumbbells 10-50 lb, bar, band, 5 days, chest + back');
{
  const P = {
    goals: ['chest', 'back', 'arms'], experience: '3plus', recentActivity: 'regular', days: 5, minutes: 45,
    equipment: { db: [10, 15, 20, 25, 30, 40, 50], kb: [], ball: false, band: true, bar: true, door: true, chair: true, wall: true, towel: true },
  };
  const S = B.newState(P, null, D0);
  const prog = B.programFor(S.profile);
  check('starting volume is higher for tier 1 (12 sets)', S.vol.chest === 12 && S.vol.back === 12, S.vol);
  check('no on-ramp for 3+ years of training', prog.onramp.weeks === 0);
  const tpl = B.templateFor(S.profile, prog);
  const backDays = tpl.filter((t) => t.units.includes('back')).map((t) => B.buildSession(S, D0 + t.offset, t.idx, {}));
  check('the pull-up ladder is used on back days', backDays.some((s) => s.items.some((it) => it.fam === 'pull')), backDays.map((s) => s.items.map((i) => i.fam)));
  // Weight steps before rung steps: max out reps on rows twice.
  S.prog.row.rung = 'row_db'; S.prog.row.reps = M.MOVES.row_db.range[1]; S.prog.row.w = 0;
  const up1 = B.levelUp(S, 'row', D0);
  check('at the top of the range with a heavier dumbbell available → heavier weight first', S.prog.row.rung === 'row_db' && S.prog.row.w === 1, up1 && up1.line);
  S.prog.row.w = 6;
  const up2 = B.levelUp(S, 'row', D0);
  check('at the heaviest weight → next rung', S.prog.row.rung !== 'row_db', up2 && up2.line);
  // Buy suggestion when everything is maxed.
  const S2 = B.newState(USER, BASELINE, D0);
  S2.prog.curl.rung = 'curl_conc'; S2.prog.curl.reps = 16;
  const up3 = B.levelUp(S2, 'curl', D0);
  check('maxed top rung at the only weight → next dumbbell to buy (12 lb)', up3 && /Next buy: 12 lb dumbbells/.test(up3.line.text), up3 && up3.line);
}

/* ------------------------------------------------------------------ reps left in the tank */
// 1.13: each set aims for a number of reps left by goal and person (brain.effortFor), the player
// asks 0, 1-2, 3 or 4+, and the answer moves the exercise on against that aim (brain.effortStep).
section('Reps left: each set\'s aim, by goal and person');
{
  const AC = GH.access;
  const BASE = { goals: ['consistency'], age: 35, experience: '3plus', recentActivity: 'regular', days: 3, minutes: 30, equipment: { db: [10, 15, 20] } };
  const GYM = { where: 'gym', gym: B.gymPreset('full', 'kg'), units: 'kg' };
  const aim = (p, id, o = {}) => {
    const S = B.newState(Object.assign({}, BASE, p), null, D0);
    const m = M.MOVES[id];
    const a = B.effortFor(S, Object.assign({ kind: 'move', moveId: id, fam: o.fam || m.family, group: m.group }, o.it), o.phase || { onramp: false });
    return `${a.key}:${a.why}`;
  };
  check('everyone else\'s sets aim for 1-3 left', aim({}, 'push_std') === '13:usual' && aim({ goals: ['fat'] }, 'curl_std') === '13:usual');
  check('your top goal muscles (tier 1) aim for 1-2', aim({ goals: ['arms', 'legs', 'chest'] }, 'curl_std') === '12:size' && aim({ goals: ['arms', 'legs', 'chest'] }, 'sq_goblet') === '12:size' && aim({ goals: ['arms', 'legs', 'chest'] }, 'push_std') === '13:usual');
  check('with strength in the top two goals, the 4-8 rep gym lifts aim for 2-3 (4 still fine)',
    aim(Object.assign({ goals: ['strength', 'chest'] }, GYM), 'bench_bb') === '24:strength' && aim(Object.assign({ goals: ['legs', 'strength'] }, GYM), 'squat_bb') === '24:strength' && B.AIMS[24].ok === 4,
    [aim(Object.assign({ goals: ['strength', 'chest'] }, GYM), 'bench_bb'), aim(Object.assign({ goals: ['legs', 'strength'] }, GYM), 'squat_bb')]);
  check('but not a smaller gym move, nor a main lift when strength is third', aim(Object.assign({ goals: ['strength'] }, GYM), 'raise_cable') === '13:usual' && aim(Object.assign({ goals: ['chest', 'arms', 'strength'] }, GYM), 'bench_bb') === '12:size');
  check('gentler, 2-3: the on-ramp weeks, even for a top goal or a strength lift', aim({ goals: ['arms'] }, 'curl_std', { phase: { onramp: true } }) === '23:onramp' && aim(Object.assign({ goals: ['strength'] }, GYM), 'bench_bb', { phase: { onramp: true } }) === '23:onramp');
  check('gentler from 60 (the age itself: 50 to 59 is as usual), top goals included', aim({ age: 60, goals: ['arms'] }, 'curl_std') === '23:age' && aim({ age: 59, goals: ['arms'] }, 'curl_std') === '12:size' && aim({ age: 59 }, 'push_std') === '13:usual' && aim({ age: 72 }, 'push_std') === '23:age');
  check('gentler with high blood pressure or a heart condition, at any age', aim({ conditions: ['bp'], goals: ['arms'] }, 'curl_std') === '23:bp' && aim({ conditions: ['heart'], age: 30 }, 'push_std') === '23:heart' && aim(Object.assign({ conditions: ['heart'], goals: ['strength'] }, GYM), 'bench_bb') === '23:heart');
  check('a strength lift keeps its 2-3, 4 fine, from 60', aim(Object.assign({ age: 66, goals: ['strength'] }, GYM), 'bench_bb') === '24:strength');
  // Osteoporosis: GH.access.boneLoad (from the age and health rules, when they have it) asks for 1-2
  // on main sets after the on-ramp; without it the plan works as before.
  const had = AC.boneLoad;
  AC.boneLoad = (p) => (p.conditions || []).includes('osteo');
  const bone = [aim({ conditions: ['osteo'], age: 67 }, 'push_std'), aim({ conditions: ['osteo'], age: 67 }, 'push_std', { phase: { onramp: true } }), aim({ conditions: ['osteo'], age: 67 }, 'side_plank'), aim({ conditions: ['osteo'], age: 67 }, 'bal_tandem', { it: { skill: true } }), aim({ conditions: ['osteo', 'bp'], age: 67 }, 'push_std')];
  if (had) AC.boneLoad = had; else delete AC.boneLoad;
  check('osteoporosis (boneLoad): main sets aim for 1-2 after the on-ramp; not holds, balance practice or with blood pressure', bone.join() === '12:bone,23:onramp,23:age,23:age,23:bp', bone);
  AC.boneLoad = undefined;
  const without = aim({ conditions: ['osteo'], age: 67 }, 'push_std');
  if (had) AC.boneLoad = had; else delete AC.boneLoad;
  check('without boneLoad an osteoporosis plan aims as anyone else of that age', without === '23:age', without);
  check('no aim ever asks for 0 left', Object.values(B.AIMS).every((x) => x.lo >= 1 && x.hi >= x.lo && x.ok >= x.hi));

  // The player's line under a set names the aim.
  const hint = (p, id, o) => {
    const S = B.newState(Object.assign({}, BASE, p), null, D0);
    const m = M.MOVES[id];
    const it = { kind: 'move', moveId: id, fam: m.family, group: m.group };
    it.effort = B.effortFor(S, it, (o && o.phase) || {});
    return AC.setHint(S.profile, it, false);
  };
  check('the set\'s line names its aim, in plain words', hint({}, 'push_std') === 'Stop with 1-3 reps left in the tank.' && hint({ goals: ['arms'] }, 'curl_std') === 'Stop with 1-2 reps left: arms are a top goal.' && hint({ goals: ['arms'] }, 'curl_std', { phase: { onramp: true } }) === 'Stop with 2-3 reps left while you settle in.'
    && hint({ age: 64 }, 'push_std') === 'Stop with 2-3 reps left in the tank.' && hint(Object.assign({ goals: ['strength'] }, GYM), 'bench_bb') === 'Stop with 2-3 reps left. Heavy sets don\'t need to go near failure.',
  [hint({}, 'push_std'), hint({ goals: ['arms'] }, 'curl_std'), hint({ age: 64 }, 'push_std'), hint(Object.assign({ goals: ['strength'] }, GYM), 'bench_bb')]);
  check('with a heart condition or high blood pressure it says how to breathe, with the 2-3', hint({ conditions: ['heart'] }, 'push_std') === 'Stop with 2-3 reps left. Breathe out as you push.' && hint({ conditions: ['bp'] }, 'push_std') === 'Breathe out as you push, and never hold your breath. Stop with 2-3 reps left.');
  check('no dashes as punctuation, straight quotes, short', ['push_std', 'curl_std', 'bench_bb'].every((id) => { const h = hint(Object.assign({ goals: ['strength', 'arms'] }, GYM), id) || ''; return !/[—–‘’“”]/.test(h) && h.length <= 80; }));
}

section('Reps left: the answer against the aim');
{
  // effortStep: pace 0 holds, 1 is the usual step, 2 and 3 bigger ones; harder (3 or more left) is
  // what the top of the range needs for a harder version.
  const row = (key) => ['0', '12', '3', '4'].map((rir) => { const g = B.effortStep({ rir, aim: key }); return `${g.pace}${g.harder ? 'h' : ''}`; }).join(' ');
  check('1-3: 0 holds, 1-2 and 3 are on the aim, 4+ moves faster', row('13') === '0 1 1h 2h', row('13'));
  check('1-2: 3 is past it and moves faster, 4+ faster still (a bigger step than 3)', row('12') === '0 1 2h 3h', row('12'));
  check('2-3: 1-2 and 3 on it, 4+ faster', row('23') === '0 1 1h 2h', row('23'));
  check('the strength lifts\' 2-3: 4+ is still fine', row('24') === '0 1 1h 1h', row('24'));
  const old = ['0', '12', '3'].map((rir) => { const g = B.effortStep({ rir }); return `${g.pace}${g.harder ? 'h' : ''}`; }).join(' ');
  check('a log from before 1.13 (no aim): its 3 meant "3 or more" and moves on as it did then', old === '0 1 2h', old);
  check('no answer, or one it doesn\'t know, holds', B.effortStep({ rir: null, aim: '13' }).pace === 0 && B.effortStep({ rir: '7', aim: '13' }).pace === 0 && B.effortStep({ rir: '3', aim: 'zz' }).pace === 2);

  // End to end on a home ladder: push-ups at 10 of 5-20 (35, so no age steps), three sets hit.
  const BASE = { goals: ['consistency'], age: 35, experience: '3plus', recentActivity: 'regular', days: 3, minutes: 30, equipment: { db: [10, 15, 20] } };
  const home = (rir, aimKey, o = {}) => {
    const S = B.newState(Object.assign({}, BASE, o.p), null, D0);
    const id = o.id || 'push_std', m = M.MOVES[id], fam = m.family;
    S.prog[fam] = Object.assign({ rung: id, reps: o.reps || (m.timed ? 20 : 10), w: 0, best: {}, short: 0, cooldown: 0, maxed: false }, o.st);
    const t = S.prog[fam].reps;
    const log = { fam, moveId: id, kind: 'move', target: t, sets: [0, 1, 2].map((set) => ({ set, amount: t, target: t })), rir, timed: !!m.timed, group: m.group };
    if (aimKey) log.aim = aimKey;
    const res = B.progress(S, log, false, D0 + 7);
    return { reps: S.prog[fam].reps, rung: S.prog[fam].rung, why: res.line && res.line.why };
  };
  const reps = (key) => ['0', '12', '3', '4'].map((rir) => home(rir, key).reps).join();
  check('push-ups at 10, aiming for 1-3: 10, 11, 11, 12', reps('13') === '10,11,11,12', reps('13'));
  check('aiming for 1-2: 10, 11, 12, 13 (4+ a bigger step than 3)', reps('12') === '10,11,12,13', reps('12'));
  check('aiming for 2-3: 10, 11, 11, 12', reps('23') === '10,11,11,12', reps('23'));
  check('an older log: 3 or more adds 2, as it always did', home('3').reps === 12 && home('3').why === 'you had 3+ left' && home('12').reps === 11, [home('3'), home('12')]);
  check('the reason says what was left', home('3', '13').why === 'you had 3 left' && home('4', '12').why === 'you had 4 or more left' && home('12', '12').why === 'you had 1-2 left');
  const top = (rir, key) => home(rir, key, { reps: 20 }).rung;
  check('at the top of the range: 3 or 4+ left brings the harder version, 1-2 holds', top('3', '13') === 'push_slow' && top('4', '13') === 'push_slow' && top('3', '12') === 'push_slow' && top('12', '12') === 'push_std' && top('0', '13') === 'push_std' && top('3') === 'push_slow');
  const plank = ['12', '3', '4'].map((rir) => home(rir, '12', { id: 'side_plank' }).reps).join();
  check('holds step in seconds: 1-2 adds 5, 3 past a 1-2 aim 10, 4+ 15', plank === '25,30,35', plank);
  check('from 50 the steps are a little smaller, 4+ still a step more than 3', home('4', '12', { p: { age: 55 } }).reps === 12 && home('3', '12', { p: { age: 55 } }).reps === 11);
  check('under 30, 3 or more left adds a little more', home('3', '13', { p: { age: 22 } }).reps === 12 && home('4', '13', { p: { age: 22 } }).reps === 13 && home('12', '13', { p: { age: 22 } }).reps === 11);

  // At the gym: double progression on the strength lifts.
  const GYM = { where: 'gym', gym: B.gymPreset('full', 'kg'), units: 'kg', goals: ['strength', 'chest'] };
  const gym = (rir, aimKey, reps) => {
    const S = B.newState(Object.assign({}, BASE, GYM), null, D0);
    S.prog.pressG = { rung: 'bench_bb', reps, best: {}, loads: { bench_bb: 60 }, e1rm: {}, short: 0, cooldown: 0, flat: 0, gym: true };
    const log = { fam: 'pressG', moveId: 'bench_bb', kind: 'move', target: reps, sets: [0, 1, 2].map((set) => ({ set, amount: reps, target: reps, load: 60 })), rir, timed: false, group: 'chest' };
    if (aimKey) log.aim = aimKey;
    B.progress(S, log, false, D0 + 7);
    const st = S.prog.pressG;
    return { reps: st.reps, kg: st.loads.bench_bb, e1rm: st.e1rm.bench_bb && st.e1rm.bench_bb.last };
  };
  check('bench press 4-8, aiming for 2-3 (4 fine): one rep more for 1-2, 3 or 4+', ['12', '3', '4'].every((rir) => gym(rir, '24', 6).reps === 7) && gym('0', '24', 6).reps === 6);
  check('at the top of the range with reps to spare the weight goes up a step and reps start again at 4', ['12', '3', '4'].every((rir) => { const g = gym(rir, '24', 8); return g.kg === 62.5 && g.reps === 4; }) && gym('0', '24', 8).kg === 60);
  check('the estimated one-rep max counts 4+ as about 4.5 left, and an older 3 as 3', Math.abs(gym('4', '24', 6).e1rm - 60 * (1 + 10.5 / 30)) < 1e-6 && Math.abs(gym('3', null, 6).e1rm - 60 * (1 + 9 / 30)) < 1e-6 && B.RIR_NUM[4] === 4.5);

  // A workout's logs carry each exercise's aim; the finisher moves on a step for 3, two for 4+.
  const S = B.newState({ goals: ['fat', 'arms'], age: 35, experience: '3plus', recentActivity: 'regular', days: 3, minutes: 30, equipment: { db: [10, 15, 20] } }, null, D0);
  const day = [D0, D0 + 1, D0 + 2].find((d) => B.todayPlan(S, d).type === 'workout');
  B.startWorkout(S, day, { now: day * B.DAY_MS + 18 * 3600000 });
  const A = S.active;
  const aims = A.logs.map((l) => `${l.group}:${l.aim}`);
  check('each exercise\'s log keeps its aim (arms are a top goal here)', A.logs.every((l) => B.AIMS[l.aim]) && A.logs.filter((l) => l.group === 'biceps' || l.group === 'triceps').every((l) => l.aim === '12') && A.session.items.every((it) => it.effort && it.effort.key === A.logs[A.session.items.indexOf(it)].aim), aims);
  let g = 0;
  while (S.active && A.idx < A.steps.length && g++ < 600) { const st = A.steps[A.idx]; B.completeStep(S, st.kind === 'test' ? { value: 10 } : {}); if (st.askRir) B.setRir(S, st.item, '4'); }
  const fin = A.session.finisher;
  const before = 0;
  const done = B.finishWorkout(S, { rating: 'right', now: day * B.DAY_MS + 19 * 3600000 });
  check('a finisher with 4 or more left moves on two steps', !!fin && S.prog[fin.fam].fmt === before + 2 && done.lines.some((l) => /Finisher/.test(l.text)), fin && S.prog[fin.fam]);
  check('the saved log keeps the answers and their aims', S.log.find((l) => l.type === 'workout').items.every((it) => it.rir === '4' && B.AIMS[it.aim]));
}

/* ------------------------------------------------------------------ cancelling */
section('Cancelling a workout');
{
  const S = B.newState(USER, BASELINE, D0);
  const workDay = B.calendar(S, D0).days[D0].planned === 'workout' ? D0 : D0 + 1;
  B.startWorkout(S, workDay, { now: workDay * B.DAY_MS + 18 * 3600000 });
  B.completeStep(S, {});
  const logsBefore = S.log.length;
  const gone = B.cancelWorkout(S);
  check('cancel clears the workout in progress and returns it', gone && gone.day === workDay && S.active === null);
  check('nothing from it is logged', S.log.length === logsBefore);
  check('today\'s workout can be started again', B.todayPlan(S, workDay).type === 'workout' && !B.startWorkout(S, workDay, {}).error && !!S.active);
  B.cancelWorkout(S);
  // A light day (after the week's first two workouts): starting pulls the next session forward, and
  // cancelling puts it back.
  const S2 = B.newState(USER, BASELINE, D0);
  const cal = B.calendar(S2, D0);
  let light = D0;
  while (cal.days[light].planned === 'workout') doWorkout(S2, light++);
  const events = S2.events.length;
  const plan = B.todayPlan(S2, light);
  const next = plan.next;
  check('a light day with a session later in the week', plan.type === 'light' && next, plan.type);
  B.startWorkout(S2, light, {});
  check('starting on a light day pulls the next session forward', S2.events.length === events + 1 && S2.active.pulled && S2.active.pulled.from === next.day);
  B.cancelWorkout(S2);
  check('cancelling puts it back where it was', S2.events.length === events && B.todayPlan(S2, light).type === 'light' && B.todayPlan(S2, light).next.day === next.day);
  check('with nothing in progress, cancel does nothing', B.cancelWorkout(S2) === null);

  // Undo: the very same workout comes back, and sets can be logged in it again.
  B.startWorkout(S2, light, {});
  const A2 = S2.active;
  while (A2.steps[A2.idx].kind !== 'set') B.completeStep(S2, {});
  const gone2 = B.cancelWorkout(S2);
  check('Undo puts the workout back, pulled session and all', B.restoreWorkout(S2, gone2) && S2.active === gone2 && S2.events.length === events + 1);
  check('but never over another workout', !B.restoreWorkout(S2, gone2) && S2.events.length === events + 1);
  const logged = () => S2.active.logs.reduce((n, l) => n + l.sets.length, 0);
  let threw = null;
  try { B.completeStep(S2, { reps: 8 }); } catch (e) { threw = e.message; }
  check('a set can be logged after Undo', !threw && logged() === 1, threw);
  // A copy (as a backup would hold) is relinked to its session.
  const copy = JSON.parse(JSON.stringify(B.cancelWorkout(S2)));
  B.restoreWorkout(S2, copy);
  threw = null;
  try { while (S2.active.steps[S2.active.idx].kind !== 'set') B.completeStep(S2, {}); B.completeStep(S2, { reps: 8 }); } catch (e) { threw = e.message; }
  check('a restored copy works too', !threw && logged() === 2, threw);
  B.cancelWorkout(S2);

  // A left/right test done in a cancelled workout doesn't count either; Undo counts it again.
  const S3 = B.newState(USER, BASELINE, D0);
  B.startWorkout(S3, workDay, {});
  const A3 = S3.active;
  const test = { kind: 'test', test: 'arm', fam: 'curl', moveId: A3.session.items[0].moveId, name: 'Left vs right curl test', side: 'L' };
  A3.steps.splice(A3.idx, 0, { kind: 'test', item: test, side: 'L' }, { kind: 'test', item: test, side: 'R' });
  const was = JSON.stringify(S3.catchup.arm);
  B.completeStep(S3, { value: 10 });
  B.completeStep(S3, { value: 16 });
  const after = JSON.stringify(S3.catchup.arm);
  check('the test is recorded while the workout runs', after !== was && S3.catchup.arm.tests.length === JSON.parse(was).tests.length + 1);
  const gone3 = B.cancelWorkout(S3);
  check('cancelling forgets the test', JSON.stringify(S3.catchup.arm) === was);
  B.restoreWorkout(S3, gone3);
  check('and Undo records it again', JSON.stringify(S3.catchup.arm) === after);
}

/* ------------------------------------------------------------------ twelve weeks, six people */
// Every workout done as planned for 12 weeks: each muscle group trained every week, the weekly
// volume inside the program's floor and cap, nothing that needs kit they don't have, no jumping or
// slamming when impact is off, and the new ladders (presses, lower back, calves, hamstring curls)
// in use where they fit.
section('Twelve weeks for six people');
{
  const HOME = { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: true, wall: true, towel: true, table: false, door: false };
  const base = { experience: 'onoff', recentActivity: 'some', days: 4, minutes: 45, age: 30, units: 'lb', weightKg: 75 };
  const people = [
    ['default home kit', { goals: ['abs', 'arms', 'chest', 'legs'], equipment: HOME }],
    ['band only', { goals: ['back', 'shoulders', 'legs'], equipment: Object.assign({}, HOME, { band: true, door: true }) }],
    ['kettlebell only', { goals: ['legs', 'abs'], equipment: Object.assign({}, HOME, { kb: [12] }), focus: ['hamstrings', 'calves'] }],
    ['basic gym', { goals: ['chest', 'back', 'legs'], where: 'gym', gym: B.gymPreset('basic', 'lb'), equipment: HOME }],
    ['careful knees', { goals: ['legs', 'arms'], equipment: Object.assign({}, HOME, { db: [10, 15] }), careful: ['knee'] }],
    ['gentle mode', { goals: ['abs', 'arms'], equipment: Object.assign({}, HOME, { db: [8], kb: [10] }), gentle: true }],
  ];
  const cov = {};
  for (const [label, extra] of people) {
    const S = B.newState(Object.assign({}, base, extra), null, D0);
    const prog = B.programFor(S.profile);
    const tpl = B.templateFor(S.profile, prog);
    const eq = B.eqAt(S, S.profile.where === 'gym' ? 'gym' : 'home');
    const bad = { untrained: [], vol: [], over: [], under: [], kit: [], impact: [], knee: [] };
    const fams = new Set();
    for (let w = 0; w < 12; w++) {
      const sets = {};
      for (const t of tpl) {
        const r = doWorkout(S, D0 + w * 7 + t.offset, { defaultRir: '12' });
        const s = r.session;
        const moves = s.items.concat(s.extras, s.warmup, s.mobility || [], s.finisher ? [s.finisher] : []);
        for (const it of s.items.concat(s.extras)) { sets[it.group] = (sets[it.group] || 0) + it.sets; fams.add(it.fam); }
        for (const it of moves) {
          const m = M.MOVES[it.moveId];
          if (!M.allowed(m, eq)) bad.kit.push(`w${w + 1} ${it.moveId}`);
          if (!prog.impactOk && m.impact) bad.impact.push(`w${w + 1} ${it.moveId}`);
          if ((S.profile.careful || []).includes('knee') && (m.impact || m.complex) && (m.joints || []).includes('knee')) bad.knee.push(`w${w + 1} ${it.moveId}`);
        }
      }
      const phase = B.calendar(S, D0 + w * 7).weeks[D0 + w * 7].phase;
      const full = phase.mult === 1 && !phase.deload && !phase.onramp;
      for (const g of B.GROUPS) {
        if (!(sets[g] > 0)) bad.untrained.push(`w${w + 1} ${g}`);
        if (!(S.vol[g] >= prog.floor[g] && S.vol[g] <= prog.cap[g])) bad.vol.push(`w${w + 1} ${g} ${S.vol[g]}`);
        if (sets[g] > prog.cap[g]) bad.over.push(`w${w + 1} ${g} ${sets[g]} > ${prog.cap[g]}`);
        if (full && sets[g] < prog.floor[g]) bad.under.push(`w${w + 1} ${g} ${sets[g]} < ${prog.floor[g]}`);
      }
    }
    cov[label] = fams;
    check(`${label}: every group trained every week for 12 weeks`, !bad.untrained.length, bad.untrained.slice(0, 6));
    check(`${label}: weekly volume stays inside the floor and cap`, !bad.vol.length && !bad.over.length && !bad.under.length, bad.vol.concat(bad.over, bad.under).slice(0, 6));
    check(`${label}: only moves their kit allows`, !bad.kit.length, bad.kit.slice(0, 6));
    if (!prog.impactOk) check(`${label}: impact off, so no jumping or slamming`, !bad.impact.length, bad.impact.slice(0, 6));
    if ((S.profile.careful || []).includes('knee')) check(`${label}: no complex or impact moves on the careful knee`, !bad.knee.length, bad.knee.slice(0, 6));
  }
  check('with just a chair, wall and towel: overhead presses, raises, rows and the lower back', ['press', 'raise', 'row', 'backExt'].every((f) => cov['default home kit'].has(f)), [...cov['default home kit']]);
  check('legs rotate through hinges, glute bridges and hamstring curls', ['hinge', 'glute', 'hamCurl'].every((f) => cov['default home kit'].has(f)), [...cov['default home kit']]);
  check('a calf focus adds calf raises', cov['kettlebell only'].has('calf'), [...cov['kettlebell only']]);
  check('the gym rotates hinges, hip thrusts and lunges', ['hingeG', 'gluteG', 'lungeG'].every((f) => cov['basic gym'].has(f)), [...cov['basic gym']]);
}

/* ------------------------------------------------------------------ focus, warm-ups, cool-downs */
section('Focus muscles, warm-ups and cool-downs');
{
  const P = { goals: ['abs', 'arms'], experience: 'onoff', days: 4, minutes: 45, weightKg: 70, equipment: { db: [8], kb: [10], chair: true, wall: true, towel: true } };
  const plain = B.programFor(Object.assign(B.defaultProfile(), P));
  const focused = B.programFor(Object.assign(B.defaultProfile(), P, { focus: ['sideDelts', 'glutes', 'quads', 'nonsense', 'calves', 'lats'] }));
  check('focus muscles lift their group one tier (up to 4 muscles, unknown names ignored)', focused.tiers.shoulders === plain.tiers.shoulders - 1 && focused.tiers.legs === plain.tiers.legs - 1 && focused.tiers.back === plain.tiers.back && focused.focus.length === 4, { plain: plain.tiers, focused: focused.tiers, focus: focused.focus });
  check('MUSCLE_GROUP maps all 17 muscles to one of the 7 groups', Object.keys(B.MUSCLE_GROUP).length === 17 && Object.values(B.MUSCLE_GROUP).every((g) => B.GROUPS.includes(g)));
  check('every move lists known muscles, with 1 or more primary movers', Object.values(M.MOVES).every((m) => m.muscles.every((x) => B.MUSCLE_GROUP[x]) && m.prime >= 1 && m.prime <= m.muscles.length));
  const S = B.newState(Object.assign({}, P, { goals: ['abs', 'arms', 'mobility'] }), null, D0);
  const tpl = B.templateFor(S.profile, B.programFor(S.profile));
  const days = tpl.map((t) => B.buildSession(S, D0 + t.offset, t.idx, {}));
  const upper = (s) => s.items.some((it) => ['biceps', 'triceps', 'chest', 'back', 'shoulders'].includes(it.group));
  check('the kettlebell halo only on upper-body days', days.every((s) => s.warmup.some((w) => w.moveId === 'wu_halo') === upper(s)), days.map((s) => `${s.title}: ${s.warmup.map((w) => w.moveId)}`));
  const legDay = days.find((s) => s.units.includes('legs'));
  check('leg days warm up the legs', legDay && legDay.warmup.some((w) => ['wu_squat', 'wu_legswing'].includes(w.moveId)), legDay && legDay.warmup.map((w) => w.moveId));
  // 1.6: a session with time to spare starts its cool-down with an easy cardio block (a steady march,
  // walk or ride, src/optimizer.js fill); the stretches after it are as before.
  const stretches = (s) => s.mobility.filter((it) => !it.cardio);
  check('the cool-down is 2 or 3 stretches for the day\'s muscles', days.every((s) => stretches(s).length >= 2 && stretches(s).length <= 3 && stretches(s).every((it) => M.MOBILITY.includes(it.moveId))), days.map((s) => s.mobility.map((x) => x.moveId)));
  check('an easy cardio block, when there is one, is a steady move at a talking pace and comes first', days.every((s) => s.mobility.filter((it) => it.cardio).every((it) => s.mobility[0] === it && it.timed && it.target >= 180 && M.MOVES[it.moveId].group === 'conditioning')), days.map((s) => s.mobility.map((x) => `${x.moveId}:${x.target}`)));
  // The light-day flow follows what was trained: after leg days, leg stretches.
  // (Someone whose top goal is legs, so leg days are mostly legs: 1.6 shares days between muscle
  // groups differently, and for abs and arms goals the arm work outweighs the legs.)
  const S2 = B.newState(Object.assign({}, P, { goals: ['legs'] }), null, D0);
  const legs = B.templateFor(S2.profile, B.programFor(S2.profile)).filter((t) => t.units.includes('legs'));
  for (const t of legs) doWorkout(S2, D0 + t.offset, {});
  const flowOn = (day) => B.mobilityFlow(S2, day).map((x) => x.moveId);
  const flow = flowOn(D0 + 7);
  const legStretch = flow.filter((id) => (M.MOVES[id].mobFor || []).some((mu) => ['glutes', 'quads', 'hamstrings', 'calves', 'hipFlexors'].includes(mu)));
  check('after leg days the mobility flow leans to leg stretches', flow.length >= 4 && legStretch.length >= 3, flow);
  // A sore joint leaves its stretches out only while it's sore.
  const later = flowOn(D0 + 12);
  S2.pain = { ankle: D0 + 10, wrist: D0 + 10 };
  const sore = flowOn(D0 + 7), healed = flowOn(D0 + 12);
  const hurts = (id) => (M.MOVES[id].joints || []).some((j) => j === 'ankle' || j === 'wrist');
  check('the flow skips stretches for a sore joint, and brings them back once it has healed', flow.some(hurts) && !sore.some(hurts) && sore.length >= 4 && healed.join() === later.join(), { flow, sore, healed, later });
}

/* ------------------------------------------------------------------ different bodies */
// Twelve weeks for each of eight people, every workout done as planned (reps hit, 1-2 left, 3+ left
// every third day) and every light day done. For each: every muscle group trained, sets within
// their limits, and not one move their age and health rules leave out (src/access.js).
const AC = GH.access;
const BODY = {
  goals: ['strength', 'consistency'], experience: 'onoff', recentActivity: 'some', days: 3, minutes: 40, units: 'lb', weightKg: 75,
  equipment: { db: [5, 10, 15], kb: [], ball: false, band: true, door: true, chair: true, wall: true, towel: true },
};
function twelveWeeks(extra, o = {}) {
  const S = B.newState(Object.assign({}, BODY, extra), null, D0);
  const sessions = [];
  for (let d = D0; d < D0 + 84; d++) {
    if (o.onDay) o.onDay(S, d);
    const plan = B.todayPlan(S, d);
    if (plan.type === 'workout') sessions.push(doWorkout(S, d, { defaultRir: (d - D0) % 3 === 0 ? '3' : '12' }).session);
    else if (plan.type === 'light') lightDay(S, d);
  }
  return { S, sessions };
}
const movesOf = (s) => [].concat(s.warmup, s.items, s.extras || [], s.tests || [], s.finisher ? [s.finisher] : [], s.mobility || []);
function ruleBreaks(S, sessions) {
  const out = [];
  const impactOk = B.programFor(S.profile).impactOk;
  for (const s of sessions) {
    for (const it of movesOf(s)) {
      const m = M.MOVES[it.moveId];
      const why = AC.why(S.profile, m, s.day);
      if (why) out.push(`${it.moveId}: ${why}`);
      if (!M.allowed(m, S.profile.equipment)) out.push(`${it.moveId}: needs equipment`);
      if (m.impact && !impactOk) out.push(`${it.moveId}: impact`);
    }
  }
  return [...new Set(out)];
}
function setsByGroup(S) {
  const out = {};
  for (const l of S.log) if (l.type === 'workout') for (const it of l.items) if (it.kind === 'move' && it.sets.length) out[it.group] = (out[it.group] || 0) + new Set(it.sets.map((x) => x.set)).size;
  return out;
}
function bodyChecks(name, run) {
  const { S, sessions } = run;
  const groups = setsByGroup(S);
  const untrained = B.GROUPS.filter((g) => !(groups[g] >= 6));
  check(`${name}: ${sessions.length} workouts in 12 weeks, every muscle group trained`, sessions.length >= 30 && !untrained.length, { untrained, groups });
  const pr = B.programFor(S.profile);
  const volBad = B.GROUPS.filter((g) => S.vol[g] < pr.floor[g] || S.vol[g] > pr.cap[g]);
  const setBad = sessions.flatMap((s) => s.items.filter((it) => !(it.sets >= 1 && it.sets <= 6)).map((it) => `${it.moveId}×${it.sets}`));
  const long = sessions.filter((s) => s.estimateMin > S.profile.minutes + 5).map((s) => s.estimateMin);
  check(`${name}: weekly sets within limits, 1-6 sets a move, sessions fit the time`, !volBad.length && !setBad.length && !long.length, { volBad, setBad, long });
  const breaks = ruleBreaks(S, sessions);
  check(`${name}: no move breaks this body's rules`, !breaks.length, breaks.slice(0, 6));
}
const used = (sessions, pick) => sessions.flatMap((s) => movesOf(s)).filter(pick || (() => true)).map((it) => it.moveId);
const perWeek = (sessions, pred) => { const w = {}; for (const s of sessions) if (pred(s)) w[B.weekStart(s.day)] = (w[B.weekStart(s.day)] || 0) + 1; return w; };
const score = (S) => Object.entries(S.prog).filter(([f]) => M.LADDERS[f] && !M.LADDERS[f].gym && !M.LADDERS[f].alt).reduce((a, [f, st]) => a + M.LADDERS[f].rungs.indexOf(st.rung) * 40 + (st.w || 0) * 20 + (st.reps || 0), 0);

section('Different bodies: age bands');
{
  check('age bands: 29 under 30, 30 and 49 the baseline, 50 and 64 from 50, 65 on; no age = baseline',
    AC.band({ age: 29 }) === 'young' && AC.band({ age: 30 }) === 'mid' && AC.band({ age: 49 }) === 'mid' && AC.band({ age: 50 }) === 'older' && AC.band({ age: 64 }) === 'older' && AC.band({ age: 65 }) === 'senior' && AC.band({ age: null }) === 'mid');
  const prog = (x) => B.programFor(Object.assign(B.defaultProfile(), BODY, x));
  check('jumping: on under 50, opt-in from 50, off with arthritis, osteoporosis, balance problems or a heart condition',
    prog({ age: 22 }).impactOk && !prog({ age: 55 }).impactOk && prog({ age: 55, jumpsOk: true }).impactOk && !prog({ age: 72 }).impactOk && prog({ age: 72, jumpsOk: true }).impactOk
    && ['ra', 'oa', 'osteo', 'balance', 'heart', 'seated'].every((c) => !prog({ age: 30, conditions: [c] }).impactOk) && !prog({ age: 22, impactOk: false }).impactOk);
  check('warm-ups get longer with age (2.5, 4, 5, 6 min)', prog({ age: 22 }).warmupMin === 2.5 && prog({ age: 45 }).warmupMin === 4 && prog({ age: 55 }).warmupMin === 5 && prog({ age: 70 }).warmupMin === 6);
  check('a good set adds a little more under 30 and a little less from 50', AC.repStep({ age: 22 }, 2, false, '3') === 3 && AC.repStep({ age: 40 }, 2, false, '3') === 2 && AC.repStep({ age: 58 }, 2, false, '3') === 1 && AC.repStep({ age: 70 }, 10, true, '3') === 5 && AC.repStep({ age: 22 }, 1, false, '12') === 1);
  const heart = prog({ age: 40, conditions: ['heart'] }), same = prog({ age: 40 });
  check('a heart condition starts gentler: lower volume, two eased-in weeks', B.GROUPS.every((g) => heart.start[g] <= same.start[g]) && heart.onramp.weeks === 2 && heart.onramp.mult === 0.7);
  check('nothing changes for 30 to 49 with no conditions', AC.plannedAround({ age: 40 }) === null && AC.planLines({ age: 40 }).length === 0);
  check('"Planned around" names age and conditions', AC.plannedAround({ age: 72, conditions: ['balance', 'ra'] }) === 'Planned around age 72, balance and rheumatoid arthritis', AC.plannedAround({ age: 72, conditions: ['balance', 'ra'] }));

  const young = twelveWeeks({ age: 22 });
  bodyChecks('22-year-old', young);
  const mid = twelveWeeks({ age: 40 });
  const older = twelveWeeks({ age: 55 });
  bodyChecks('55-year-old', older);
  // 1.6: the plan is built for each age (power work, balance practice and a longer warm-up from 50
  // change which exercises get the time, and the rungs climbed differ), so 40 and 55 no longer
  // train alike and their totals aren't compared; the rule itself (a good set adds a little less
  // from 50) is checked above.
  check(`with the same answers, progress is fastest at 22 (${score(young.S)} > ${score(mid.S)}, ${score(older.S)})`, score(young.S) > score(mid.S) && score(young.S) > score(older.S));
  check('22: jumps allowed, the usual warm-up for the day\'s muscles, finishers that change', B.programFor(young.S.profile).impactOk && young.sessions.every((s) => s.warmup.length === 3 && !s.warmup.some((w) => (M.FLOWS.warmGentle || []).includes(w.moveId) && w.moveId !== 'wu_circles' && w.moveId !== 'wu_squat')) && new Set(young.sessions.filter((s) => s.finisher).map((s) => s.finisher.moveId)).size >= 2);
  const bal55 = perWeek(older.sessions, (s) => s.items.some((it) => it.group === 'balance'));
  check('55: balance practice twice a week, first thing in the session', Object.values(bal55).every((n) => n === 2) && older.sessions.every((s) => !s.items.some((it) => it.group === 'balance') || s.items[0].group === 'balance'), bal55);
  const power55 = perWeek(older.sessions, (s) => s.items.some((it) => it.power));
  // A strength goal works the home squat in 5 to 10 reps (1.6), so it climbs past the rungs with a
  // fast-up version (goblet squats) within the 12 weeks (how soon depends on the week's plan): power
  // runs once a week while it has one.
  const powerWeeks = Object.keys(perWeek(older.sessions, (s) => s.items.some((it) => it.fam === 'squat' && M.MOVES[it.moveId].powerOf)));
  const canPower = Object.keys(perWeek(older.sessions, (s) => s.items.some((it) => it.fam === 'squat' && Object.values(M.MOVES).some((m) => m.powerOf === it.moveId || m.id === it.moveId && m.powerOf))));
  check('55: once a week the squat is fast on the way up (power), every week it has a fast-up version', Object.values(power55).length >= 2 && Object.values(power55).every((n) => n === 1) && canPower.every((w) => powerWeeks.includes(w)), { power55, canPower });
  // 1.6: with a strength goal and time to spare the main lifts rest longer (about 2.5 minutes, or
  // 2), the 15 s from 50 on top.
  const strengthMain = (it) => B.HOME_COMPOUND.includes(it.fam) || B.MAIN_LIFTS.includes(it.fam);
  check('55: a longer, gentler warm-up (plus one move for the day\'s muscles) and 15 s more rest', older.sessions.every((s) => s.warmup.slice(0, 4).map((w) => w.moveId).join() === M.FLOWS.warmGentle.join() && s.warmup.length <= 5) && older.sessions.every((s) => s.items.filter((it) => !it.skill && !it.superset).every((it) => it.rest === 75 || it.rest === 105 || (strengthMain(it) && (it.rest === 135 || it.rest === 165)))),
    older.sessions.flatMap((s) => s.items.filter((it) => !it.skill && !it.superset).map((it) => `${it.fam}@${it.rest}`)).filter((x, i, a) => a.indexOf(x) === i));
  const powerLog = older.S.log.find((l) => l.type === 'workout' && l.items.some((it) => M.MOVES[it.moveId].powerOf));
  check('55: a fast-up set moves its base rung on like any other', !!powerLog && older.S.prog.squat && (older.S.prog.squat.reps > M.MOVES[older.S.prog.squat.rung].start || M.LADDERS.squat.rungs.indexOf(older.S.prog.squat.rung) > M.LADDERS.squat.rungs.indexOf('sq_goblet')), older.S.prog.squat);
  check('under 65, no left vs right test is skipped for age', B.testDue({ catchup: { arm: { active: true, tests: [], side: 'L' } }, profile: Object.assign(B.defaultProfile(), { age: 55, startDay: D0, lead: { arm: 'L' } }) }, D0 + 20, 'arm'));
}

section('Different bodies: 72 with balance problems');
{
  const run = twelveWeeks({ age: 72, conditions: ['balance'] });
  const { S, sessions } = run;
  bodyChecks('72, balance problems', run);
  check('balance practice starts every session, always with a hand on the wall', sessions.every((s) => s.items[0].group === 'balance' && s.items[0].fam === 'balance' && M.MOVES[s.items[0].moveId].support), sessions.map((s) => s.items[0].moveId).slice(0, 4));
  check('no one-leg balance with nothing to hold, no quick footwork, no jumping', !used(sessions, (it) => { const m = M.MOVES[it.moveId]; return (m.oneLeg && !m.support) || m.quick || m.impact; }).length);
  check('squats start from the chair: sit to stand with the hands', S.log.find((l) => l.type === 'workout' && l.items.some((it) => it.fam === 'squat')).items.find((it) => it.fam === 'squat').moveId === 'sq_sts_hands');
  const getup = perWeek(sessions, (s) => s.items.some((it) => it.fam === 'getup'));
  check('once a week: down to the floor and up, holding a chair', Object.values(getup).length >= 11 && Object.values(getup).every((n) => n === 1), getup);
  check('a cool-down every session, kept even when time is short', sessions.every((s) => s.mobility.length >= 2) && B.buildSession(S, D0 + 91, 0, { short: true }).mobility.length >= 1);
  check('light days have a balance hold too (balance most days)', B.mobilityFlow(S).some((m) => M.MOVES[m.moveId].group === 'balance'));
  check('balance and sit to stand move up over 12 weeks', M.LADDERS.balance.rungs.indexOf(S.prog.balance.rung) > M.LADDERS.balance.rungs.indexOf('bal_tandem_wall') || S.prog.balance.reps > M.MOVES.bal_tandem_wall.start, S.prog.balance);
  check('no all-out left vs right leg test', !sessions.some((s) => (s.tests || []).some((t) => t.test === 'leg')));
  const flat = twelveWeeks({ age: 72, conditions: ['balance'], floorOk: false });
  check('with the floor hard: nothing on the floor and no floor practice', !used(flat.sessions, (it) => ['floor', 'kneel', 'low'].includes(M.MOVES[it.moveId].pos)).length && !flat.sessions.some((s) => s.items.some((it) => it.fam === 'getup')));
  bodyChecks('72, balance problems, floor hard', flat);
}

section('Different bodies: 60 with rheumatoid arthritis');
{
  // A flare on two workout days (week 3 and week 8), ticked in the feel check-in.
  const flares = [];
  const run = twelveWeeks({ age: 60, conditions: ['ra'] }, {
    onDay(S, d) {
      const w = Math.floor((d - D0) / 7);
      if ((w === 2 || w === 7) && B.todayPlan(S, d).type === 'workout' && !flares.some((f) => Math.floor((f - D0) / 7) === w)) { S.feel[d] = { flare: true }; flares.push(d); }
    },
  });
  const { S, sessions } = run;
  bodyChecks('60, rheumatoid arthritis', run);
  const flareS = sessions.filter((s) => s.flare);
  check('flare days: a gentle range-of-motion session instead', flareS.length === 2 && flareS.every((s) => !s.items.length && !s.warmup.length && !s.finisher && s.mobility.length >= 5 && s.mobility.every((mb) => M.MOVES[mb.moveId].group === 'mobility')), flareS.map((s) => s.mobility.map((m) => m.moveId)));
  check('a flare-day session counts as done', flares.every((d) => S.log.some((l) => l.type === 'workout' && l.day === d && B.isDone(l))));
  check('range of motion every session (wrists included)', sessions.every((s) => s.mobility.some((mb) => mb.moveId === 'mob_wrist')));
  check('no weight on the hands, no hanging or hard pulling grips', !used(sessions, (it) => { const m = M.MOVES[it.moveId]; return (m.hands && !m.support) || m.grip === 'hang' || m.grip === 'pull'; }).length);
  check('a flare is only offered with arthritis', AC.flareOk(S.profile) && AC.flareOk({ conditions: ['oa'] }) && !AC.flareOk({ conditions: ['back'] }));
}

section('Different bodies: osteoporosis, low back pain');
{
  const run = twelveWeeks({ age: 58, sex: 'female', conditions: ['osteo'] });
  bodyChecks('58 with osteoporosis', run);
  check('osteoporosis: no bending or twisting the spine, no jumping, no swings or slams', !used(run.sessions, (it) => { const m = M.MOVES[it.moveId]; return (m.spine || []).some((x) => /flex|twist/.test(x)) || m.impact || m.ballistic; }).length);
  check('osteoporosis: balance twice a week and strength that keeps progressing', Object.values(perWeek(run.sessions, (s) => s.items.some((it) => it.group === 'balance'))).every((n) => n === 2) && score(run.S) > score(B.newState(Object.assign({}, BODY, { age: 58, conditions: ['osteo'] }), null, D0)));

  const back = twelveWeeks({ age: 45, conditions: ['back'] });
  bodyChecks('45 with low back pain', back);
  check('back pain: bird dogs and side planks', used(back.sessions).includes('co_birddog') && used(back.sessions).some((id) => M.MOVES[id].family === 'coreSide'));
  check('back pain: no heavy spinal loading in the first 8 weeks', !back.sessions.filter((s) => s.day < D0 + 56).some((s) => movesOf(s).some((it) => (M.MOVES[it.moveId].spine || []).includes('load'))));
  check('then deadlifts come back as a rung to climb to', AC.why(back.S.profile, M.MOVES.hg_deadlift, D0 + 30) && !AC.why(back.S.profile, M.MOVES.hg_deadlift, D0 + 60) && B.rungs(back.S, 'hinge', D0 + 60).includes('hg_deadlift'));
  check('back pain: never loaded bending or twisting (weighted sit-ups, woodchops)', !used(back.sessions, (it) => (M.MOVES[it.moveId].spine || []).some((x) => x === 'flexLoad' || x === 'twistLoad')).length);
}

section('Different bodies: a wheelchair user, painful wrists');
{
  const run = twelveWeeks({ age: 50, conditions: ['seated'] });
  const { S, sessions } = run;
  bodyChecks('seated plan', run);
  check('every move is done sitting down: warm-up, sets, finisher and cool-down', !used(sessions, (it) => M.MOVES[it.moveId].pos !== 'seat').length, [...new Set(used(sessions, (it) => M.MOVES[it.moveId].pos !== 'seat'))]);
  check('seated stand-ins cover chest, back, shoulders, arms, legs and core', ['pushAlt', 'rowAlt', 'legSeat', 'coreAlt'].every((f) => sessions.some((s) => s.items.some((it) => it.fam === f))));
  check('no all-out tests seated, and a seated light day', sessions.every((s) => !(s.tests || []).length) && B.mobilityFlow(S).every((m) => M.MOVES[m.moveId].pos === 'seat'));

  const wrist = twelveWeeks({ age: 35, conditions: ['hands'] });
  bodyChecks('hand and wrist pain', wrist);
  check('wrists: no weight on the hands and nothing gripped tight (band loops are fine)', !used(wrist.sessions, (it) => { const m = M.MOVES[it.moveId]; return m.hands || (m.grip && m.grip !== 'loop'); }).length);
  check('wrists: push-ups and curls are replaced, not dropped', wrist.sessions.some((s) => s.items.some((it) => it.fam === 'pushAlt')) && wrist.sessions.some((s) => s.items.some((it) => it.fam === 'curlAlt')));
  const plain = B.newState(Object.assign({}, BODY, { age: 35 }), null, D0);
  check('stand-in ladders stay closed for everyone else', ['pushAlt', 'rowAlt', 'curlAlt', 'legSeat', 'balance', 'getup', 'finGentle'].every((f) => !B.rungs(plain, f, D0).length && !plain.prog[f]));
}

section('Different bodies: heart and blood pressure');
{
  const run = twelveWeeks({ age: 58, conditions: ['heart', 'bp'] });
  bodyChecks('heart condition and high blood pressure', run);
  check('no head-down positions and no all-out tests', !used(run.sessions, (it) => M.MOVES[it.moveId].headDown).length && run.sessions.every((s) => !(s.tests || []).length));
  check('easy cardio only, never more than 30 s hard', run.sessions.filter((s) => s.finisher).every((s) => s.finisher.fam === 'finGentle' && s.finisher.work <= 30));
  check('every session reminds you to breathe out on the effort', run.sessions.every((s) => s.notes.some((n) => n.kind === 'breathe')));
  check('heart and blood pressure say to check with a doctor; pregnancy is not offered', AC.doctorLines({ conditions: ['heart', 'bp'] }).length === 2 && !AC.CONDITIONS.some((c) => /pregnan/i.test(c.name)));
}

done();
