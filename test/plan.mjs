// GH.planWeek, the Plan tab's data: each day's kind against the calendar replay (done, missed with
// and without a freeze, light, rest, days before the start), moves and their free days (checked
// against moveSession itself), next week (and a change of days that starts there), sessions and
// sets by muscle, Train today instead, a workout in progress, and the cache. Six weeks of random
// training check the same rules every day.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/planweek.js');
const B = GH.brain;
const PW = GH.planWeek;

const MON = B.dayFromStr('2026-09-28'); // a Monday
const USER = {
  goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, units: 'lb', weightKg: 68.4,
  equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null },
};
const BASE = { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 };
const fresh = (start = MON, patch = {}) => B.newState(Object.assign({}, USER, patch), BASE, start);
const clone = (S) => JSON.parse(JSON.stringify(S));
const ds = (d) => B.dayStr(d).slice(5);

function doWorkout(S, day) {
  const r = B.startWorkout(S, day, { now: day * B.DAY_MS + 17 * 3600000 });
  if (r.error) throw new Error(`startWorkout ${B.dayStr(day)}: ${r.error}`);
  for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 800; g++) {
    const st = S.active.steps[S.active.idx];
    B.completeStep(S, st.kind === 'test' ? { value: 12 } : {});
    if (st.askRir) B.setRir(S, st.item, '12');
  }
  return B.finishWorkout(S, { rating: 'right', now: day * B.DAY_MS + 17 * 3600000 + 24 * 60000 });
}
const light = (S, day) => { B.logLight(S, day, 'walk', true); B.logLight(S, day, 'mobility', true); };
const kinds = (w) => w.days.map((d) => d.kind);

// Every rule that ties planWeek to the calendar and to moveSession, for one day.
function rules(S, day, label) {
  const w = PW(S, day);
  const cal = B.calendar(S, day);
  const ws = B.weekStart(day);
  const week = cal.weeks[ws];
  const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : [];
  const bad = [];
  if (w.ws !== ws || w.days.length !== 7) bad.push('week shape');
  let frozen = 0;
  w.days.forEach((e, i) => {
    const d = ws + i;
    const info = cal.days[d] || {};
    const s = live.find((x) => x.day === d);
    const doneLog = S.log.some((l) => l.type === 'workout' && l.day === d && B.isDone(l));
    if (e.day !== d) bad.push(`${ds(d)} day`);
    if ((e.kind === 'done') !== (doneLog && d >= S.profile.startDay)) bad.push(`${ds(d)} done: ${e.kind}`);
    if ((e.kind === 'missed' || e.kind === 'frozen') !== !!info.missed) bad.push(`${ds(d)} missed: ${e.kind} vs ${JSON.stringify(info)}`);
    if (e.kind === 'frozen') { frozen++; if (!info.frozen) bad.push(`${ds(d)} frozen`); }
    if ((e.kind === 'today' || e.kind === 'workout') !== !!(s && !s.done && !info.missed && d >= day)) bad.push(`${ds(d)} pending: ${e.kind}`);
    if (e.kind === 'today' && d !== day) bad.push(`${ds(d)} today`);
    if ((e.kind === 'light' || e.kind === 'rest') && (s || info.missed || doneLog)) bad.push(`${ds(d)} light with a workout`);
    if (e.kind === 'light' && e.light.done !== !!S.log.find((l) => l.type === 'light' && l.day === d && l.walk && l.mobility)) bad.push(`${ds(d)} light done`);
    if (s && (e.kind === 'today' || e.kind === 'workout') && e.title !== B.templateTitle(s.units)) bad.push(`${ds(d)} title`);
    // Free days: exactly the days moveSession accepts.
    if ((e.kind === 'today' || e.kind === 'workout') && !e.active) {
      for (let x = ws; x < ws + 7; x++) {
        if (x === d) continue;
        const ok = B.moveSession(clone(S), d, x, day);
        if (ok !== e.moveTo.includes(x)) bad.push(`${ds(d)}→${ds(x)}: moveSession ${ok}, planWeek ${e.moveTo.includes(x)}`);
      }
      if (e.canMove !== e.moveTo.length > 0) bad.push(`${ds(d)} canMove`);
    } else if (e.moveTo.length || e.canMove) bad.push(`${ds(d)} can't move a ${e.kind} day`);
  });
  if (frozen > 1) bad.push('two freezes in a week');
  if (w.planned !== live.length) bad.push(`planned ${w.planned} vs ${live.length}`);
  if (w.done !== live.filter((x) => x.done).length || w.done !== w.days.filter((e) => e.kind === 'done').length) bad.push(`done ${w.done}`);
  if (w.trainingWeek !== (week ? week.trainingWeek : 1)) bad.push('training week');
  check(label, bad.length === 0, bad.slice(0, 6).join('; '));
  return w;
}

/* ------------------------------------------------------------------ a first week */
section('A first week, day by day');
{
  const S = fresh();
  let w = rules(S, MON, 'Monday: matches the calendar');
  check('Mon: today, Tue workout, Wed light, Thu and Fri workouts, weekend light', kinds(w).join() === 'today,workout,light,workout,workout,light,light', kinds(w).join());
  check('4 planned, 0 done', w.planned === 4 && w.done === 0 && !w.allDone);
  const WED = ds(MON + 2), SAT = ds(MON + 5), SUN = ds(MON + 6);
  check('free days: Wed, Sat and Sun', w.free.map(ds).join() === [WED, SAT, SUN].join(), w.free.map(ds).join());
  check('a workout can move to each of them', w.days[1].moveTo.map(ds).join() === [WED, SAT, SUN].join() && w.days[0].canMove);
  check('new to training: the week eases in at 70%, full from week 3', w.phase.key === 'onramp' && w.phase.pct === 70 && w.phase.fullFrom === 3 && w.trainingWeek === 1, JSON.stringify(w.phase));
  check('date words', w.days[0].date === 'Mon, Sep 28' && w.days[0].letter === 'M' && w.days[0].num === 28 && w.days[6].wdLong === 'Sunday');
  const t = w.days[0];
  const built = B.buildSession(S, MON, t.tpl, { cal: B.calendar(S, MON) });
  check('today\'s session is the one Today builds (with readiness)', t.session.estimateMin === built.estimateMin && t.session.items.length === built.items.length && t.estimateMin === built.estimateMin);
  check('groups come from the session', JSON.stringify(t.groups) === JSON.stringify(built.groups));
  const tue = w.days[1];
  const tueBuilt = B.buildSession(S, MON + 1, tue.tpl, { cal: B.calendar(S, MON), noReadiness: true });
  check('a later session is built without readiness', tue.estimateMin === tueBuilt.estimateMin && tue.session.items.map((x) => x.moveId).join() === tueBuilt.items.map((x) => x.moveId).join());
  const ws = B.weeklySets(S, MON);
  check('sets by muscle is weeklySets', w.muscles.length > 0 && w.muscles.every((m) => ws[m.group].done === m.done && ws[m.group].target === m.target && ws[m.group].planned === m.planned));
  check('light days know the walk length', w.days[2].light && w.days[2].light.walkMin === B.programFor(S.profile).walkMin && !w.days[2].light.done);
  check('nothing to train today instead on a workout day', !w.trainToday && !w.days.some((e) => e.canTrainToday));

  doWorkout(S, MON);
  w = rules(S, MON + 1, 'Tuesday after Monday\'s workout');
  check('Monday is done, with its log', w.days[0].kind === 'done' && w.days[0].log.counted && w.days[0].log.doneSets > 0 && w.days[0].log.minutes === 24 && w.days[0].log.items.length > 0, JSON.stringify(w.days[0].log && { sets: w.days[0].log.doneSets, min: w.days[0].log.minutes }));
  check('the log names each exercise and its sets', w.days[0].log.items.every((x) => x.name && x.sets > 0 && x.amounts.length === x.sets));
  check('1 of 4 done', w.done === 1 && w.planned === 4);
  check('a done day can\'t move and Monday is no longer free', !w.days[0].canMove && !w.free.includes(MON));

  // Skip Tuesday: the freeze keeps the streak and the week moves a day.
  w = rules(S, MON + 2, 'Wednesday after skipping Tuesday');
  check('Tuesday used the freeze', w.days[1].kind === 'frozen' && w.days[1].missed.frozen && w.freezeUsed);
  check('and Tuesday\'s workout is today', w.days[2].kind === 'today' && w.days[2].title === B.templateTitle(B.calendar(S, MON + 2).weeks[MON].sessions.find((x) => x.day === MON + 2).units));
  check('a notice says the plan moved', w.notices.length === 1);

  // Skip Wednesday too: this time the streak resets.
  w = rules(S, MON + 3, 'Thursday after skipping Wednesday as well');
  check('Wednesday was missed, streak reset', w.days[2].kind === 'missed' && w.days[2].missed.broken && !w.days[2].missed.frozen);
  check('the week moved on twice: workouts on Thu, Sat and Sun, Friday free', kinds(w).slice(3).join() === 'today,light,workout,workout', kinds(w).join());

  doWorkout(S, MON + 3);
  // Skip Saturday: Sunday takes its workout and the last one no longer fits.
  w = rules(S, MON + 6, 'Sunday after skipping Saturday');
  check('Saturday missed, Sunday has its workout, one dropped', w.days[5].kind === 'missed' && w.days[6].kind === 'today' && w.dropped === 1 && w.planned === 3, JSON.stringify({ k: kinds(w), dropped: w.dropped, planned: w.planned }));
  doWorkout(S, MON + 6);
  w = rules(S, MON + 6, 'Sunday, trained');
  check('3 of 3 done: the week is complete', w.done === 3 && w.allDone, `${w.done} of ${w.planned}`);
}

/* ------------------------------------------------------------------ moves */
section('Moving a workout');
{
  const S = fresh();
  doWorkout(S, MON);
  const day = MON + 1;
  let w = PW(S, day);
  check('Tuesday can go to Wed, Sat or Sun', w.days[1].moveTo.map(ds).join() === [MON + 2, MON + 5, MON + 6].map(ds).join());
  const tueTitle = w.days[1].title;
  check('moveSession Fri → Sat', B.moveSession(S, MON + 4, MON + 5, day));
  w = rules(S, day, 'after moving Friday to Saturday');
  check('Friday is light, Saturday has the workout', w.days[4].kind === 'light' && w.days[5].kind === 'workout' && w.days[5].movedFrom === MON + 4);
  check('Friday is free now, Saturday isn\'t', w.free.includes(MON + 4) && !w.free.includes(MON + 5));
  check('moving today\'s workout to Wednesday', B.moveSession(S, day, MON + 2, day));
  w = rules(S, day, 'after moving Tuesday to Wednesday');
  check('today is light, and Wednesday has Tuesday\'s workout', w.days[1].kind === 'light' && w.days[2].kind === 'workout' && w.days[2].title === tueTitle);
  check('with the next workout offered for today', w.trainToday && w.trainToday.from === MON + 2 && w.days[2].canTrainToday && w.days.filter((e) => e.canTrainToday).length === 1);
  // Undo = take the move event back out.
  S.events = S.events.filter((e) => !(e.type === 'move' && e.from === day && e.to === MON + 2));
  w = rules(S, day, 'after undoing that');
  check('Tuesday is today\'s workout again', w.days[1].kind === 'today' && w.days[1].title === tueTitle && !w.trainToday);
}

/* ------------------------------------------------------------------ light days, rest days, a late start */
section('Light and rest days, a start mid-week');
{
  const S = fresh();
  doWorkout(S, MON); doWorkout(S, MON + 1);
  light(S, MON + 2);
  const w = rules(S, MON + 2, 'Wednesday, light day done');
  check('a done light day is light, done', w.days[2].kind === 'light' && w.days[2].isToday && w.days[2].light.done);
  check('and the next workout could be trained today', w.trainToday && w.trainToday.from === MON + 3 && w.days[3].canTrainToday);
  const R = fresh(MON + 2, { lightDays: false, days: 3 });
  const r = rules(R, MON + 2, 'a Wednesday start with light days off');
  check('Mon and Tue are before the start', r.days[0].kind === 'before' && r.days[1].kind === 'before' && !r.days[0].log && !r.days[0].canMove);
  check('days without a workout are rest days', r.days.filter((e) => e.kind === 'rest').length >= 1 && !r.days.some((e) => e.kind === 'light'));
  check('free days start from the start day', r.free.every((d) => d >= MON + 2));
  check('next week has rest days too', r.next.days.some((e) => e.kind === 'rest') && !r.next.days.some((e) => e.kind === 'light'));
}

/* ------------------------------------------------------------------ next week */
section('Next week');
{
  const S = fresh();
  doWorkout(S, MON);
  let w = PW(S, MON + 1);
  const tpl = B.templateFor(S.profile, B.programFor(S.profile));
  check('next week follows the template', w.next.ws === MON + 7 && w.next.days.every((e, i) => { const t = tpl.find((x) => x.offset === i); return t ? e.kind === 'workout' && e.title === B.templateTitle(t.units) : e.kind === 'light'; }));
  check('4 workouts, no change of schedule', w.next.workouts === 4 && !w.next.newSchedule);
  const e = w.next.days[0];
  const built = B.buildSession(S, MON + 7, e.tpl, { cal: B.calendar(S, MON + 1), noReadiness: true });
  check('a next-week day has its session as a preview', e.preview && e.session && e.estimateMin === built.estimateMin && !e.canMove && e.moveTo.length === 0);
  // Three days a week from now on: this week keeps its shape, next week changes.
  B.updateSettings(S, MON + 1, { days: 3, weekdays: [0, 2, 4] });
  w = rules(S, MON + 1, 'after switching to 3 days mid-week');
  check('this week still has 4 workouts', w.planned === 4);
  check('next week has 3, on Mon, Wed and Fri', w.next.workouts === 3 && w.next.newSchedule && w.next.days.filter((x) => x.kind === 'workout').map((x) => x.wd).join() === 'Mon,Wed,Fri');
}

/* ------------------------------------------------------------------ phases */
section('Phases');
{
  const S = fresh();
  for (let d = MON; d < MON + 28; d++) if (B.todayPlan(S, d).type === 'workout') doWorkout(S, d);
  const w5 = PW(S, MON + 28);
  check('after four weeks of training, a deload week at 60%', w5.phase.key === 'deload' && w5.phase.pct === 60 && w5.trainingWeek === 5, JSON.stringify(w5.phase));
  const w6 = PW(S, MON + 35);
  check('after more than a week off, easing back in', w6.phase.key === 'comeback' && w6.phase.idle && w6.phase.pct < 100, JSON.stringify(w6.phase));
  check('matching the calendar', w6.phase.mult === B.calendar(S, MON + 35).weeks[MON + 35].phase.mult);
}

/* ------------------------------------------------------------------ a workout in progress */
section('A workout in progress');
{
  const S = fresh();
  B.startWorkout(S, MON, { now: MON * B.DAY_MS + 17 * 3600000 });
  B.completeStep(S, {});
  const w = PW(S, MON);
  check('today shows it in progress', w.days[0].kind === 'today' && w.days[0].active && w.days[0].active.total > 0 && w.days[0].session === S.active.session);
  check('and it can\'t be moved', !w.days[0].canMove && w.days[0].moveTo.length === 0);
  check('other workouts can\'t move onto today', !w.days[1].moveTo.includes(MON));
}

/* ------------------------------------------------------------------ the cache */
section('Cache');
{
  const S = fresh();
  PW.clear();
  const a = PW(S, MON);
  const b = PW(S, MON);
  check('the same state gives the same answer, without working it out again', a === b && PW.stats.hits >= 1);
  const m0 = PW.stats.misses;
  B.logLight(S, MON + 2, 'walk', true);
  const c = PW(S, MON);
  check('a change to the log is picked up', c !== a && PW.stats.misses === m0 + 1);
  B.moveSession(S, MON + 1, MON + 2, MON);
  check('so is a move', PW(S, MON).days[2].kind === 'workout');
  S.profile.minutes = 45;
  check('and a change of settings', PW(S, MON).days[1].kind === 'light' && PW.stats.misses === m0 + 3);
  S.somethingNew = { focus: 'legs' };
  const d = PW(S, MON);
  check('an unknown new field counts too', d !== PW(S, MON - 7) && PW.stats.misses >= m0 + 4);
  const e = PW(S, MON + 1);
  check('a different day is a different answer', e.day === MON + 1 && e.days[1].isToday);
}

/* ------------------------------------------------------------------ six weeks of random training */
section('Six weeks of random training, every day');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (const patch of [{}, { days: 3, lightDays: false }, { days: 5, experience: '3plus' }]) {
    const S = fresh(MON + 3, patch); // a Thursday start
    let fails = 0, daysChecked = 0;
    for (let d = MON + 3; d < MON + 3 + 42; d++) {
      const w = PW(S, d);
      // Quietly check the rules; report only a summary line per profile.
      const probe = (() => {
        const cal = B.calendar(S, d);
        const week = cal.weeks[B.weekStart(d)];
        const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : [];
        for (const e of w.days) {
          const info = cal.days[e.day] || {};
          const s = live.find((x) => x.day === e.day);
          const doneLog = S.log.some((l) => l.type === 'workout' && l.day === e.day && B.isDone(l));
          if ((e.kind === 'done') !== (doneLog && e.day >= S.profile.startDay)) return `${ds(e.day)} done`;
          if ((e.kind === 'missed' || e.kind === 'frozen') !== !!info.missed) return `${ds(e.day)} missed`;
          if ((e.kind === 'today' || e.kind === 'workout') !== !!(s && !s.done && !info.missed && e.day >= d)) return `${ds(e.day)} pending`;
          if ((e.kind === 'today' || e.kind === 'workout') && !e.active) {
            for (let x = w.ws; x < w.ws + 7; x++) if (x !== e.day && B.moveSession(clone(S), e.day, x, d) !== e.moveTo.includes(x)) return `${ds(e.day)}→${ds(x)} move`;
          }
        }
        if (w.planned !== live.length || w.done !== live.filter((x) => x.done).length) return 'counts';
        return null;
      })();
      daysChecked++;
      if (probe) { fails++; if (fails <= 3) console.log(`      ${B.dayStr(d)}: ${probe}`); }
      // Live the day: train most planned days, sometimes skip, sometimes move, walk on some light days.
      const plan = B.todayPlan(S, d);
      const r = rnd();
      if (plan.type === 'workout') {
        if (r < 0.15) { /* skip */ } else if (r < 0.25 && w.days.find((e) => e.day === d && e.canMove)) {
          const e = w.days.find((x) => x.day === d);
          B.moveSession(S, d, e.moveTo[e.moveTo.length - 1], d);
        } else doWorkout(S, d);
      } else if (plan.type === 'light' && r < 0.6) light(S, d);
      else if (plan.type === 'light' && r < 0.7 && plan.next) doWorkout(S, d); // train today instead
    }
    check(`${JSON.stringify(patch)}: planWeek agrees with the calendar and moveSession on all ${daysChecked} days`, fails === 0, `${fails} days disagree`);
  }
}

done();
