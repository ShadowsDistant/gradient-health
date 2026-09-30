// Fake-history simulation: drives the brain day by day and checks streaks, rung changes,
// deloads, the left-arm extra set, readiness and scheduling. Exits non-zero on any failure.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js');
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

  // Mon: push-ups 3+ left (18 → 20); triceps short (rung-down path); curls +1; squats +2; rows hold.
  const extraSeen = [];
  let r = doWorkout(S, D0, { rir: { push: '3', curl: '12', squat: '12', row: '0' }, reps: { triceps: 4 } });
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  check('Mon: push-ups → 20 reps (3+ left)', S.prog.push.reps === 20, lineTexts(r));
  check('Mon: curls +1 (11 → 12, 1-2 left)', S.prog.curl.reps === 12, S.prog.curl);
  check('Mon: rows held at 14 (0 left)', S.prog.row.reps === 14, S.prog.row);
  check('Mon: triceps below range → target matches what you got (6)', S.prog.triceps.reps === 6 && S.prog.triceps.rung === 'tri_dip_bent', S.prog.triceps);
  const uniOk = (seen) => {
    const bySet = {};
    for (const x of seen) if (x.side && !x.extra && !x.test) (bySet[`${x.fam}:${seen.indexOf(x) >> 1}`] = bySet[`${x.fam}:${seen.indexOf(x) >> 1}`] || []).push(x);
    return seen.every((x, i) => x.first !== false || !seen[i - 1] || x.val <= seen[i - 1].val);
  };
  check('Mon: second side never did more than the first', uniOk(r.seen));
  // Tue
  r = doWorkout(S, D0 + 1, { rir: { squat: '12' }, reps: { triceps: 4 } });
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  check('Tue: triceps below range twice → down a rung with a cooldown', S.prog.triceps.rung === 'tri_oh' && S.prog.triceps.cooldown === 2, S.prog.triceps);
  check('Tue: goblet squat +2 (15 → 17, 1-2 left at 12+ reps)', S.prog.squat.reps === 17, S.prog.squat);
  lightDay(S, D0 + 2);
  r = doWorkout(S, D0 + 3, {});
  extraSeen.push(r.seen.some((x) => x.extra && x.side === 'L'));
  r = doWorkout(S, D0 + 4, { rir: { push: '3' } });
  check('Fri: push-ups at 20 with 3+ left → Push-up, 3-sec lowering', S.prog.push.rung === 'push_slow', lineTexts(r));
  check('Fri: the rung-up is celebrated', r.celebrate.some((c) => c.kind === 'level'), r.celebrate);
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
  health(S, D0 + 12, { rhr: 71, sleepMin: 260 });
  const plan12 = B.buildSession(S, D0 + 12, 2, { noReadiness: true });
  const real12 = B.buildSession(S, D0 + 12, 2, {});
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
  check(`deload ≈ 40% less volume (${deloadSets} of ${normalSets} sets)`, deloadSets / normalSets >= 0.5 && deloadSets / normalSets <= 0.7);
  const legsWeek3 = B.buildSession(S, D0 + 15, 1, {});
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
  const after = B.buildSession(S, D0 + 12 + 15, 1, {});
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

done();
