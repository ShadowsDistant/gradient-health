// Notifications' planner (src/notify.js, GH.notify.plan) on seeded states: one a day at most, quiet
// hours, workout reminders only on workout days and none once it's done or while one's in progress,
// walks and runs on rest days twice a week at most, badges, the sleep question and what goes instead,
// the back-off (nothing everyday after 2 days, a note on day 3, then weekly to day 45, then nothing),
// kinds switched off, notifications off, the reminder time from history and from Settings, and the
// words (short, plain, no em dashes).
// Usage: node test/notify.mjs (any time zone: TZ=America/New_York node test/notify.mjs)
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/planweek.js', 'src/health.js', 'src/activity.js', 'src/achievements.js', 'src/customplan.js', 'src/store.js', 'src/notify.js');
const B = GH.brain;
const N = GH.notify;
const DAY = 86400000, HOUR = 3600000, MIN = 60000;

// A Monday, with four workouts a week (Mon, Tue, Thu, Fri) and light days between.
const MON = B.dayFromStr('2026-10-12');
const USER = { goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 34, units: 'lb', weightKg: 70, equipment: { db: [10, 15], band: true, chair: true, wall: true, towel: true } };
const at = (d, h, m = 0) => N.local(d, h * 60 + m);
const minuteOf = (t) => { const x = new Date(t); return x.getHours() * 60 + x.getMinutes(); };
const dayOf = (t) => B.dayOf(t, 4);
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

function workout(S, day, hour = 18) {
  const t0 = at(day, hour);
  const r = B.startWorkout(S, day, { now: t0 });
  if (r.error) return false;
  for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 800; g++) {
    const st = S.active.steps[S.active.idx];
    B.completeStep(S, st.kind === 'test' ? { value: 12 } : {});
    if (st.askRir) B.setRir(S, st.item, '12');
  }
  B.finishWorkout(S, { rating: 'right', now: t0 + 24 * MIN });
  return true;
}
// Someone four weeks in who trains on plan at `hour`, with notifications on (o: profile changes).
function person(o = {}) {
  const start = MON - 28;
  const S = B.newState(Object.assign({}, USER, o.profile || {}), { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, start);
  for (let d = start; d < (o.until || MON); d++) if (B.todayPlan(S, d).type === 'workout') workout(S, d, o.hour != null ? o.hour : 18);
  S.profile.prefs.notify.on = true;
  GH.achievements.migrate(S, at(MON, 9)); // the badges history earned, all seen
  return S;
}
const kindsOf = (S, d) => GH.planWeek(S, MON).days.concat(GH.planWeek(S, MON).next.days).find((e) => e.day === d).kind;
// Every rule that holds for any schedule.
function rules(items, now, label) {
  const bad = [];
  const days = new Map();
  for (const x of items) {
    const d = dayOf(x.at);
    days.set(d, (days.get(d) || 0) + 1);
    const m = minuteOf(x.at);
    if (m < 8 * 60 || m >= 21 * 60 + 30) bad.push(`${x.id} at ${hhmm(x.at)}: quiet hours`);
    if (x.alt && (minuteOf(x.alt.at) < 8 * 60 || minuteOf(x.alt.at) >= 21 * 60 + 30)) bad.push(`${x.alt.id}: quiet hours`);
    if (x.at < now + 15 * MIN) bad.push(`${x.id}: too soon`);
    if (x.at > now + 47 * DAY) bad.push(`${x.id}: after day 45`);
    if (!['badge', 'workout', 'sleep', 'move', 'comeback'].includes(x.kind)) bad.push(`${x.id}: kind`);
    if (!/^[A-Za-z0-9:_.-]{1,64}$/.test(x.id)) bad.push(`${x.id}: id`);
    for (const w of [x, x.alt].concat(x.sleep ? x.sleep.tiers : []).filter(Boolean)) {
      if (!w.title || w.title.length > 40) bad.push(`title "${w.title}"`);
      if ((w.body || '').length > 100) bad.push(`body "${w.body}"`);
      if (/[—–]/.test(`${w.title} ${w.body}`)) bad.push(`a dash in "${w.title} ${w.body}"`);
    }
    if (x.kind === 'sleep' && !(x.until > x.at && x.sleep && x.sleep.from <= x.at && x.sleep.tiers.length)) bad.push(`${x.id}: sleep question`);
    if (x.alt && !(x.alt.at >= x.until + 30 * MIN && dayOf(x.alt.at) === dayOf(x.at) && !x.alt.alt)) bad.push(`${x.id}: alt`);
  }
  for (const [d, n] of days) if (n > 1) bad.push(`${B.dayStr(d)}: ${n} in one day`);
  if (new Set(items.map((x) => x.id)).size !== items.length) bad.push('an id twice');
  if (items.some((x, i) => i && x.at < items[i - 1].at)) bad.push('not soonest first');
  check(`${label}: one a day at most, 8 am to 9:30 pm, plain short words`, bad.length === 0, bad.slice(0, 6));
  return items;
}
const list = (items) => items.map((x) => `${B.dayStr(dayOf(x.at)).slice(5)} ${hhmm(x.at)} ${x.kind}${x.alt ? `+${x.alt.kind}` : ''}`);

/* ------------------------------------------------------------------ off, not set up */
section('Off');
{
  const S = person();
  S.profile.prefs.notify.on = false;
  check('notifications off: nothing', N.plan(S, at(MON, 10)).length === 0);
  const T = person();
  T.profile.onboarded = false;
  check('not set up: nothing', N.plan(T, at(MON, 10)).length === 0);
  const U = person();
  for (const k of N.KINDS) U.profile.prefs.notify[k] = false;
  check('every kind off: nothing', N.plan(U, at(MON, 10)).length === 0);
  const def = B.defaultProfile().prefs.notify;
  check('off by default, every kind on once they\'re on, the time worked out', def.on === false && N.KINDS.every((k) => def[k] === true) && def.time === null, def);
}

/* ------------------------------------------------------------------ a week */
section('A week, left on Monday morning');
const S0 = person();
const now0 = at(MON, 10);
const week = rules(N.plan(S0, now0), now0, 'Monday 10 am');
{
  const kinds = (d) => week.filter((x) => dayOf(x.at) === d).map((x) => x.kind).join();
  check('the plan is Mon, Tue, Thu, Fri with light days between', ['today', 'workout', 'light', 'workout'].every((k, i) => kindsOf(S0, MON + i) === k), [0, 1, 2, 3].map((i) => kindsOf(S0, MON + i)));
  check('Monday and Tuesday: the day\'s workout', kinds(MON) === 'workout' && kinds(MON + 1) === 'workout', list(week));
  const mon = week.find((x) => x.id === `workout:${MON}`);
  const s = B.buildSession(S0, MON, B.todayPlan(S0, MON).tpl, {});
  check(`it says what the workout is ("${mon && mon.title}"), and opens Today`, mon && mon.title === `${s.title}, ${s.estimateMin} min` && mon.route === 'today', mon);
  check('Wednesday, a light day: a walk', kinds(MON + 2) === 'move' && /walk/.test(week.find((x) => x.kind === 'move').body), list(week));
  check('nothing everyday after two days: Thursday (a workout day) is day 3\'s note', kinds(MON + 3) === 'comeback', list(week));
  const comeback = week.filter((x) => x.kind === 'comeback');
  check('then once a week: days 3, 10, 17, 24, 31, 38 and 45', comeback.map((x) => dayOf(x.at) - MON).join() === N.COMEBACK_DAYS.join(), comeback.map((x) => dayOf(x.at) - MON));
  check('and nothing else after day 2', week.filter((x) => dayOf(x.at) - MON > N.EVERYDAY_DAYS).every((x) => x.kind === 'comeback'));
  check('each note worded differently', new Set(comeback.map((x) => x.title)).size === 7 && new Set(comeback.map((x) => x.body)).size === 7, comeback.map((x) => x.title));
  check('the first is the one from the design', comeback[0].title === 'Your plan\'s ready when you are' && comeback[0].body === '25 minutes keeps it going.', comeback[0]);
  check('the reminder time: 30 minutes before their usual 6 pm start', week.filter((x) => x.kind !== 'badge').every((x) => hhmm(x.at) === '17:30') && N.reminderTime(S0, now0).how === 'usual', week.map((x) => hhmm(x.at)));
}

section('Done, in progress, already sent today');
{
  const S = person();
  workout(S, MON, 8);
  const items = rules(N.plan(S, at(MON, 9)), at(MON, 9), 'after Monday\'s workout');
  check('Monday\'s done: no reminder that day, Tuesday\'s still there', !items.some((x) => x.id === `workout:${MON}`) && items.some((x) => x.id === `workout:${MON + 1}`), list(items));
  const T = person();
  B.startWorkout(T, MON, { now: at(MON, 9) });
  const mid = rules(N.plan(T, at(MON, 9, 30)), at(MON, 9, 30), 'a workout in progress');
  check('a workout in progress: nothing more today', T.active && !mid.some((x) => dayOf(x.at) === MON) && mid.some((x) => dayOf(x.at) === MON + 1), list(mid));
  const sent = rules(N.plan(person(), now0, { lastPosted: at(MON, 9), sent: [{ id: 'sleep:1', at: at(MON, 9) }] }), now0, 'one already sent today');
  check('one sent today already: nothing more today', !sent.some((x) => dayOf(x.at) === MON) && sent.some((x) => x.id === `workout:${MON + 1}`), list(sent));
  const late = rules(N.plan(person(), at(MON, 17, 20)), at(MON, 17, 20), 'left at 5:20 pm');
  check('left ten minutes before the reminder: none today (they just saw it)', !late.some((x) => dayOf(x.at) === MON), list(late));
}

/* ------------------------------------------------------------------ walks and runs */
section('Walks and runs');
{
  // Two workouts a week (Mon and Thu): Tuesday and Wednesday are light days.
  const S = person({ profile: { days: 2 } });
  const items = rules(N.plan(S, now0), now0, 'two workouts a week');
  const moves = items.filter((x) => x.kind === 'move');
  check('a walk on each light day in the window (Tue, Wed)', moves.map((x) => dayOf(x.at) - MON).join() === '1,2' && moves.every((x) => ['light', 'rest'].includes(kindsOf(S, dayOf(x.at)))), list(items));
  const one = rules(N.plan(S, now0, { sent: [{ id: `move:${MON - 1}`, at: at(MON - 1, 17, 30) }, { id: `move:${MON}`, at: at(MON, 9) }] }), now0, 'two sent: one last week, one this');
  check('one sent this week: one more at most (last week\'s doesn\'t count)', one.filter((x) => x.kind === 'move').length === 1, list(one));
  const none = rules(N.plan(S, now0, { sent: [{ id: `move:${MON - 7}`, at: at(MON, 8, 30) }, { id: `move:${MON - 8}`, at: at(MON, 9) }] }), now0, 'two sent this week');
  check('two sent this week: no more', !none.some((x) => x.kind === 'move'), list(none));
  // Over a whole week of leaving the app every morning, each day's plan honours what came before.
  let posted = [];
  for (let d = MON; d < MON + 7; d++) {
    const plan = N.plan(S, at(d, 8, 30), { sent: posted });
    const today = plan.find((x) => dayOf(x.at) === d);
    if (today) posted.push({ id: today.id, at: today.at });
  }
  check('opened every morning for a week: two walks at most that week', posted.filter((x) => x.id.startsWith('move:')).length <= 2, posted.map((x) => x.id));
  check('and never on a workout day', posted.filter((x) => x.id.startsWith('move:')).every((x) => !['today', 'workout'].includes(kindsOf(S, dayOf(x.at)))));
  const walked = person({ profile: { days: 2 } });
  B.logLight(walked, MON + 1, 'walk', true);
  const after = rules(N.plan(walked, at(MON + 1, 9)), at(MON + 1, 9), 'walked already');
  check('walked already today: no walk nudge today', !after.some((x) => x.id === `move:${MON + 1}`), list(after));
  const rest = person({ profile: { days: 2, lightDays: false } });
  const r = rules(N.plan(rest, now0), now0, 'rest days').filter((x) => x.kind === 'move');
  check('rest days (no light days): a walk, gently', r.length >= 1 && r[0].body === 'Your plan has today off. A short walk outside still feels good.', r.map((x) => x.body));
}
{
  // Runs on Wednesdays at 7 am, recorded in the app, three of the last six weeks.
  const S = person();
  S.activities = [7, 14, 35].map((n) => ({ id: `r${n}`, type: 'run', start: at(MON + 2 - n, 7), end: at(MON + 2 - n, 7, 40) }));
  const items = rules(N.plan(S, now0), now0, 'a running habit');
  const wed = items.find((x) => dayOf(x.at) === MON + 2);
  check('their habit on Wednesday: "You usually run on Wednesdays", at 8 am (30 minutes before 7 is too early)', wed && wed.kind === 'move' && wed.title === 'Wednesday run?' && wed.body === 'You usually run on Wednesdays, and it\'s a light day.' && hhmm(wed.at) === '08:00', wed);
  S.activities = [7, 14, 35].map((n) => ({ id: `r${n}`, type: 'run', start: at(MON + 2 - n, 9, 15), end: at(MON + 2 - n, 10) }));
  check('a 9:15 habit: the nudge at 8:45', hhmm(N.plan(S, now0).find((x) => dayOf(x.at) === MON + 2).at) === '08:45');
  S.activities = [28, 35, 42].map((n) => ({ id: `r${n}`, type: 'run', start: at(MON + 2 - n, 7), end: at(MON + 2 - n, 7, 40) }));
  check('a habit that stopped three weeks ago isn\'t one', !N.plan(S, now0).some((x) => /run/.test(x.title)));
  // Health Connect's runs from a watch count too, and with workouts off only a habit brings a nudge.
  const T = person({ profile: { workouts: false } });
  for (const n of [7, 14, 21]) {
    const d = MON + 5 - n;
    T.health.days[d] = Object.assign(T.health.days[d] || {}, { exercise: [{ typeName: 'Running', minutes: 40, start: at(d, 10), fromApp: false, src: 'hc' }] });
  }
  const off = rules(N.plan(T, at(MON + 4, 10)), at(MON + 4, 10), 'workouts off, a watch\'s Saturday runs');
  check('workouts off: no workout reminders, and only their habit for moving', !off.some((x) => x.kind === 'workout') && off.filter((x) => x.kind === 'move').map((x) => x.title).join() === 'Saturday run?', list(off));
  check('and the notes after a few days away say nothing about workouts', off.filter((x) => x.kind === 'comeback').every((x) => !/workout|plan/i.test(`${x.title} ${x.body}`)), off.filter((x) => x.kind === 'comeback').map((x) => x.body));
}

/* ------------------------------------------------------------------ badges */
section('Badges');
{
  const S = person();
  const id = 'streak100';
  GH.achievements.ensure(S, MON).earned[id] = { day: MON, at: at(MON, 9, 30) };
  check('(a badge earned and not opened)', GH.achievements.unseen(S).join() === id, GH.achievements.unseen(S));
  const items = rules(N.plan(S, now0), now0, 'a badge waiting');
  const b = items.find((x) => x.kind === 'badge');
  check('two hours after leaving, opening the badges', b && hhmm(b.at) === '12:00' && b.id === `badge:${id}` && b.route === 'badges' && b.title === 'You earned a new badge', b);
  check('it comes first that day (before the workout reminder)', !items.some((x) => x.id === `workout:${MON}`), list(items));
  const eve = rules(N.plan(S, at(MON, 20)), at(MON, 20), 'left at 8 pm');
  const b2 = eve.find((x) => x.kind === 'badge');
  check('left in the evening: the next morning at 9', b2 && dayOf(b2.at) === MON + 1 && hhmm(b2.at) === '09:00', b2);
  check('sent once, never again', !N.plan(S, now0, { sent: [{ id: `badge:${id}`, at: at(MON, 8) }] }).some((x) => x.kind === 'badge'));
  S.profile.prefs.notify.badge = false;
  check('badges off: none', !N.plan(S, now0).some((x) => x.kind === 'badge'));
  S.profile.prefs.notify.badge = true;
  // The tap-to-open reveals (GH.achievements.unopened), where they're there.
  GH.achievements.unopened = () => [{ id: 'first' }, { id: 'week1' }];
  const two = N.plan(S, now0).find((x) => x.kind === 'badge');
  delete GH.achievements.unopened;
  check('unopened() is asked first, where it\'s there: "You earned 2 new badges"', two && two.id === 'badge:week1' && two.title === 'You earned 2 new badges', two);
}

/* ------------------------------------------------------------------ sleep */
section('Sleep');
{
  // Two weeks of nights from a watch: about 7 hours, up at 7.
  const sleepy = (S, mins) => {
    for (let i = 1; i <= 14; i++) {
      const d = MON + 1 - i;
      const min = mins ? mins(i) : 420 + ((i * 17) % 30);
      const rec = { sleepMin: min, bed: at(d, 7) - min * MIN - 20 * MIN, wake: at(d, 7) };
      S.health.hc[d] = Object.assign({}, rec);
      S.health.days[d] = Object.assign(S.health.days[d] || {}, rec);
    }
  };
  const S = person();
  sleepy(S);
  const items = rules(N.plan(S, now0), now0, 'with sleep from Health Connect');
  const q = items.find((x) => x.kind === 'sleep');
  check('a question on the light day\'s morning (not on workout days), opening Health', q && dayOf(q.at) === MON + 2 && q.route === 'health' && !items.some((x) => x.kind === 'sleep' && ['today', 'workout'].includes(kindsOf(S, dayOf(x.at)))), list(items));
  check('from 8:30 (up at 7, plus 45 minutes, not before 8:30), waiting until 11', q && hhmm(q.at) === '08:30' && hhmm(q.until) === '11:00', q && [hhmm(q.at), hhmm(q.until)]);
  check('the night counts from the start of that day (4 am)', q && q.sleep.from === at(MON + 2, 4));
  const tiers = q ? q.sleep.tiers : [];
  // The nights before Wednesday's that are known by Monday, and the usual of the last four weeks.
  const before = [0, 1, 2, 3, 4].map((k) => S.health.days[MON - k].sleepMin);
  const nights = Object.keys(S.health.hc).map((d) => S.health.days[d].sleepMin).sort((a, b) => a - b);
  const median = (nights[6] + nights[7]) / 2;
  check('good news only: above the week\'s best, or half an hour more than usual, from 7 hours to 11', tiers.length === 2 && tiers[0].best && tiers[0].min === Math.max(420, Math.max(...before) + 1) && !tiers[1].best && tiers[1].min === Math.max(420, Math.round(median) + 30) && tiers.every((t) => t.max === 660 && /\{t\} of sleep/.test(t.body)), { tiers, before, median });
  check(`"7 h 52 m of sleep: your best this week."`, tiers[0] && tiers[0].body.replace('{t}', '7 h 52 m') === '7 h 52 m of sleep: your best this week.');
  check('with the day\'s walk to send instead, in the evening', q && q.alt && q.alt.kind === 'move' && q.alt.id === `move:${MON + 2}`, q && q.alt);
  check('no background reads: no question', !N.plan(S, now0, { sleepSync: false }).some((x) => x.kind === 'sleep'));
  S.profile.prefs.notify.sleep = false;
  check('sleep off: no question', !N.plan(S, now0).some((x) => x.kind === 'sleep'));
  const T = person();
  sleepy(T, (i) => (i > 4 ? 430 : null));
  for (let i = 1; i <= 4; i++) { delete T.health.hc[MON + 1 - i]; delete T.health.days[MON + 1 - i].sleepMin; }
  check('no sleep from Health Connect in the last 3 nights: no question (they stopped wearing the watch)', !N.plan(T, now0).some((x) => x.kind === 'sleep'));
  const W = person();
  sleepy(W);
  for (let d = MON - 10; d <= MON; d++) W.health.days[d].wake = at(d, 9, 30);
  check('up at 9:30: asked at 10:15', hhmm(N.plan(W, now0).find((x) => x.kind === 'sleep').at) === '10:15');
}

/* ------------------------------------------------------------------ settings */
section('Kinds switched off, and the reminder time');
{
  const S = person();
  S.profile.prefs.notify.workout = false;
  const a = rules(N.plan(S, now0), now0, 'workout reminders off');
  check('workout reminders off: none, the rest as before', !a.some((x) => x.kind === 'workout') && a.some((x) => x.kind === 'move') && a.some((x) => x.kind === 'comeback'), list(a));
  S.profile.prefs.notify.workout = true;
  S.profile.prefs.notify.comeback = false;
  check('notes after a few days away off: none', !N.plan(S, now0).some((x) => x.kind === 'comeback'));
  S.profile.prefs.notify.comeback = true;
  S.profile.prefs.notify.move = false;
  check('walks and runs off: none', !N.plan(S, now0).some((x) => x.kind === 'move'));
  S.profile.prefs.notify.move = true;
  S.profile.prefs.notify.time = 10 * 60;
  const t = rules(N.plan(S, at(MON, 8, 30)), at(MON, 8, 30), 'a time set');
  check('a time set (10 am): reminders, walks and notes then', t.every((x) => hhmm(x.at) === '10:00') && N.reminderTime(S, now0).how === 'set', t.map((x) => hhmm(x.at)));
  S.profile.prefs.notify.time = null;
  const early = person({ hour: 7 });
  check('usually starts at 7 am: reminders at 8 (not before)', N.reminderTime(early, now0).min === 8 * 60);
  const late = person({ hour: 21 });
  check('usually starts at 9 pm: reminders at 8 pm (not later)', N.reminderTime(late, now0).min === 20 * 60);
  const fresh = B.newState(USER, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, MON);
  fresh.profile.prefs.notify.on = true;
  check('no workouts yet: 6 pm', N.reminderTime(fresh, now0).min === 18 * 60 && N.reminderTime(fresh, now0).how === 'default');
  const first = rules(N.plan(fresh, now0), now0, 'a new plan');
  check('and the first one says so', first.find((x) => x.id === `workout:${MON}`).body === 'Your first workout, ready when you are.', first[0]);
  // A setting from a crafted backup is put right by store.sanitize.
  const bad = JSON.parse(JSON.stringify(person()));
  Object.assign(bad.profile.prefs.notify, { on: 'yes', workout: 1, time: 3 });
  const clean = GH.store.sanitize(bad);
  check('a backup\'s settings checked: switches as booleans, a time within 8 am to 8 pm', clean && !('on' in clean.profile.prefs.notify) && !('workout' in clean.profile.prefs.notify) && clean.profile.prefs.notify.time === 480, clean && clean.profile.prefs.notify);
  const old = JSON.parse(JSON.stringify(person()));
  delete old.profile.prefs.notify;
  GH.store.migrate(old);
  check('an older state gets the settings, off', old.profile.prefs.notify && old.profile.prefs.notify.on === false && old.profile.prefs.notify.sleep === true, old.profile.prefs.notify);
  const part = JSON.parse(JSON.stringify(person()));
  part.profile.prefs.notify = { on: true };
  GH.store.migrate(part);
  check('a setting this version adds takes its default', part.profile.prefs.notify.on === true && part.profile.prefs.notify.comeback === true && part.profile.prefs.notify.time === null, part.profile.prefs.notify);
  const plans = B.planProfile(person().profile);
  check('the plan doesn\'t read them (switching one keeps every plan worked out)', !('notify' in plans.prefs));
}

/* ------------------------------------------------------------------ back-off */
section('The back-off, played out');
{
  // Left on Monday and never opened again: what goes out, day by day, as Android posts it.
  const S = person();
  const items = N.plan(S, now0);
  const out = [];
  const posted = new Set();
  for (const x of items) {
    const d = dayOf(x.at);
    if (posted.has(d)) continue;
    posted.add(d);
    out.push(dayOf(x.at) - MON);
  }
  check('days 0, 1, 2, then 3, 10, 17, 24, 31, 38, 45, then nothing', out.join() === '0,1,2,3,10,17,24,31,38,45', out);
  // Opened again on day 20: the series starts over from there.
  const again = N.plan(S, at(MON + 20, 12));
  const ids = again.filter((x) => x.kind === 'comeback').map((x) => x.id);
  check('opened again: a new series from that day', ids.length === 7 && ids.every((id) => id.startsWith(`comeback:${MON + 20}:`)) && dayOf(again.find((x) => x.kind === 'comeback').at) === MON + 23, ids);
  // Planned at any hour of a week (leaving the app at 3 am included), the same rules hold.
  let ok = true;
  for (let h = 0; h < 7 * 24; h += 5) {
    const now = now0 + h * HOUR;
    const plan = N.plan(S, now, { lastPosted: h % 3 ? null : now - HOUR });
    const days = plan.map((x) => dayOf(x.at));
    if (new Set(days).size !== days.length || plan.some((x) => minuteOf(x.at) < 480 || minuteOf(x.at) >= 1290 || x.at < now + 15 * MIN)) { ok = false; console.log('   ', new Date(now).toString(), list(plan)); break; }
  }
  check('left at any hour of a week: still one a day, in the day, never right away', ok);
}

done();
