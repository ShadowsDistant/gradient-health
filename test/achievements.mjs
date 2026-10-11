// Badges: every definition over a seeded year, earned dates, permanence, migration, what's offered
// when, the checks that only look at what changed, and how long a check takes. Also the Android side
// of sharing a badge's picture (the provider, the bridge, the manifest), read from the source.
// Usage: node test/achievements.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, check, section, done, root } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/health.js', 'src/activity.js', 'src/food.js', 'src/achievements.js', 'src/store.js', 'src/customplan.js');
const B = GH.brain, A = GH.achievements;
const D0 = B.dayFromStr('2026-10-01');
const START = D0 - 400;
const BREAK = [START + 30, START + 46]; // two weeks and more without a workout
// A time on a day, in local time (the badges read the hour a workout started).
const at = (d, h, m = 0) => { const [y, mo, dd] = B.dayStr(d).split('-').map(Number); return new Date(y, mo - 1, dd, h, m).getTime(); };
const copy = (x) => JSON.parse(JSON.stringify(x));

// A year and a bit of someone who does nearly everything: workouts five days a week (two weeks off
// near the start), walk-and-stretch days, a test that evens their arms out, steps and sleep from
// Health Connect, weigh-ins and measurements, a month of food logs, runs up to a half marathon, a
// hilly hike, their own plan, a shared one, a tailored one, a review and a shared badge.
function seedYear() {
  const S = B.newState({ goals: ['strength', 'arms', 'legs'], experience: '3plus', days: 5, weekdays: [0, 2, 4, 5, 6], minutes: 30, age: 30, units: 'kg', weightKg: 75, equipment: { db: [10, 15, 20, 25], kb: [16, 24], band: true, bar: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null } }, { pushups: 30, plankSec: 60, curlL: 12, curlR: 15 }, START);
  S.health.status = 'granted';
  S.health.lastSync = at(D0, 9);
  const log = { workouts: [], early: null, owl: null, full: null };
  let n = 0;
  for (let d = START; d < D0; d++) {
    const off = d >= BREAK[0] && d <= BREAK[1];
    const plan = B.todayPlan(S, d);
    const ny = B.dayStr(d).endsWith('-01-01');
    if (!off && (plan.type === 'workout' || ny)) {
      n++;
      const h = n === 5 ? 6 : n === 9 ? 21 : 18; // one early, one late
      const t = at(d, h, 30);
      const r = B.startWorkout(S, d, { now: t, short: n % 20 === 3 });
      if (r && r.error) continue;
      for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 600; g++) {
        const st = S.active.steps[S.active.idx];
        let res = {};
        if (st.kind === 'test') res = { value: n < 40 ? (st.side === 'L' ? 12 : 15) : 15 };
        else if (st.kind === 'set' && ['push_std', 'push_slow', 'push_pause', 'push_decline', 'push_archer'].includes(st.item.moveId) && n > 100) res = { reps: 21 };
        B.completeStep(S, res);
        if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 3 === 0 ? '12' : '3');
      }
      const len = n === 12 ? 65 : 32;
      B.finishWorkout(S, { rating: 'right', now: t + len * 60000 });
      log.workouts.push(d);
      if (n === 5) log.early = d;
      if (n === 9) log.owl = d;
      if (n === 12) log.full = d;
    } else if (!off && plan.type === 'light') { B.logLight(S, d, 'walk', true); B.logLight(S, d, 'mobility', true); }
    const steps = d > START + 200 && d <= START + 207 ? 11500 : 7000 + ((d * 37) % 9) * 450;
    const sleep = d > START + 100 && d <= START + 107 ? 455 : 380 + ((d * 13) % 7) * 12;
    S.health.days[d] = { steps, sleepMin: sleep };
    if ((d - START) % 7 === 0) B.addWeight(S, d, 75 - (d - START) * 0.005, 'manual');
    if ((d - START) % 60 === 5) GH.health.addMeasurement(S, d, { waist: 82 - (d - START) / 100 });
  }
  S.profile.food = Object.assign({}, S.profile.food || {}, { mode: 'full' });
  S.food = { days: {}, custom: [], saved: [], recent: [], favs: [], other: {} };
  for (let d = D0 - 36; d < D0; d++) {
    S.food.days[d] = [{ id: `f${d}`, t: at(d, 12), meal: 'lunch', name: 'Chicken and rice', src: 'quick', kcal: 650, p: 60, c: 70, f: 15, fib: 3 }];
    S.protein[d] = [50, 40];
  }
  const act = (id, d, km, climb, type) => {
    const t = at(d, 7), ms = km * 330000;
    GH.activity.add(S, { v: 1, id, type: type || 'run', title: 'Run', start: t, end: t + ms, day: d, distanceM: km * 1000, movingMs: ms, elapsedMs: ms, steps: null, kcalEst: km * 70, kg: 75, elev: { gain: climb || 40, loss: climb || 40, min: 10, max: 60 }, splits: { km: [], mi: [] }, best: null, maxMps: 4, route: null, bounds: null, pauses: [], hr: null, hc: null, saved: null, records: [] });
  };
  act('a1', D0 - 300, 3); act('a2', D0 - 250, 5.1); act('a3', D0 - 200, 10.2); act('a4', D0 - 150, 21.2);
  for (let i = 0; i < 12; i++) act(`b${i}`, D0 - 140 + i * 7, 6);
  act('h1', D0 - 30, 12, 640, 'hike');
  const plan = GH.customPlan.add(S, { name: 'My split', days: [{ title: 'Push', items: [{ move: 'push_std', sets: 3, reps: 10 }] }], source: 'you' }).plan;
  plan.createdAt = at(D0 - 120, 12);
  S.events.push({ type: 'tailor', day: D0 - 80, at: at(D0 - 80, 12), lines: [], before: {} });
  A.event(S, 'sharedPlan', D0 - 90, at(D0 - 90, 12));
  A.event(S, 'reviewed', D0 - 60, at(D0 - 60, 12));
  A.event(S, 'sharedBadge', D0 - 10, at(D0 - 10, 12));
  S.feel[START + 2] = { energy: 'good', sore: 'none' };
  return { S, log };
}

section('The badges');
{
  const ids = A.DEFS.map((d) => d.id);
  check(`about 60 badges (${ids.length}), each id once`, ids.length >= 55 && ids.length <= 70 && new Set(ids).size === ids.length);
  check('in bronze, silver, gold and platinum', A.TIER_ORDER.every((t) => A.DEFS.some((d) => d.tier === t)) && A.DEFS.every((d) => A.TIERS[d.tier]));
  check('every category has badges and a medal shape', A.CATS.every((c) => A.DEFS.some((d) => d.cat === c.id) && ['circle', 'hexagon', 'shield', 'square', 'star'].includes(c.shape)) && A.DEFS.every((d) => A.CAT[d.cat]));
  check('the design\'s categories are all there', ['consistency', 'workouts', 'moments', 'strength', 'body', 'activities', 'health', 'food', 'plans', 'start'].every((c) => A.CAT[c]));
  check('some are secret', A.DEFS.filter((d) => d.secret).length >= 3);
  const words = A.DEFS.flatMap((d) => [d.title, d.how, d.next || '']);
  check('short names and one line on how to earn each, in plain words (no dashes as punctuation)', A.DEFS.every((d) => d.title.length <= 22 && d.how.length <= 70 && /\.$/.test(d.how)) && !words.some((w) => /—|–/.test(w)), A.DEFS.filter((d) => d.title.length > 22 || d.how.length > 70).map((d) => d.id));
  check('a medal number on the counted ones', ['streak7', 'w25', 'sets2000', 'run5k', 'km100'].every((id) => A.byId[id].ribbon));
  check('every badge names a glyph', A.DEFS.every((d) => typeof d.glyph === 'string' && d.glyph));
}

section('Every badge over a seeded year');
const { S: YEAR, log: LOG } = seedYear();
const S1 = copy(YEAR);
const NOW = at(D0, 10);
const fresh = A.check(S1, D0, 'test', { now: NOW, approx: true });
const E = S1.achievements.earned;
check(`all ${A.DEFS.length} earned`, A.DEFS.every((d) => E[d.id]), A.DEFS.filter((d) => !E[d.id]).map((d) => d.id));
check('and reported oldest first', fresh.length === A.DEFS.length && fresh.every((id, i) => i === 0 || E[fresh[i - 1]].day <= E[id].day));
const doneDays = LOG.workouts;
check('Day one: the first workout\'s day', E.first.day === doneDays[0] && E.first.day === START, B.dayStr(E.first.day));
check('Ten down, Twenty-five, Fifty: the 10th, 25th and 50th workouts', E.w10.day === doneDays[9] && E.w25.day === doneDays[24] && E.w50.day === doneDays[49], [E.w10.day, doneDays[9]]);
check('Lifer: the 250th', E.w250.day === doneDays[249]);
{
  // The streak from the calendar replay itself, day by day.
  const cal = B.calendar(YEAR, D0);
  let s = 0, at7 = null, at30 = null, at100 = null;
  for (let d = START; d <= D0; d++) { const i = cal.days[d]; if (!i) continue; if (i.done) { s++; if (s === 7 && at7 == null) at7 = d; if (s === 30 && at30 == null) at30 = d; if (s === 100 && at100 == null) at100 = d; } else if (i.broken) s = 0; }
  check('streaks are dated the day the replayed streak reached 7, 30 and 100', E.streak7.day === at7 && E.streak30.day === at30 && E.streak100.day === at100, [E.streak7.day, at7]);
  check('the year\'s best streak is what the calendar says', cal.streak.best >= 100);
}
check('Welcome back: the first workout after the two weeks off', E.comeback.day === doneDays.find((d) => d > BREAK[1]));
check('Early bird and Night owl: the workouts started at 6:30 am and 9:30 pm', E.earlyBird.day === LOG.early && E.nightOwl.day === LOG.owl);
check('The full hour: the 65-minute workout', E.fullHour.day === LOG.full);
check('Fresh start: New Year\'s Day', B.dayStr(E.newYear.day) === '2026-01-01');
check('One year in: a year after the start', E.anniversary.day === START + 365);
check('5K, 10K and Half marathon: the days of those runs', E.run5k.day === D0 - 250 && E.run10k.day === D0 - 200 && E.halfMarathon.day === D0 - 150);
check('Out the door: the first activity', E.firstActivity.day === D0 - 300);
check('Hundred club: the run that took the total past 100 km (39.5 km, then 6 km at a time)', E.km100.day === D0 - 140 + 10 * 7, B.dayStr(E.km100.day));
check('Mountain goat: the hike with 640 m of climbing', E.climb500.day === D0 - 30);
check('New record: the first activity that beat an earlier one', E.record.day === D0 - 250);
check('Step streak and Well rested: the 7th day of each run', E.stepsWeek.day === START + 207 && E.sleepWeek.day === START + 107);
check('On the scale: the 10th weigh-in; Measured up: the 3rd measurement', E.weighIns10.day === START + 63 && E.measure3.day === START + 125);
check('Protein week and Food diary: the 7th day of the month of logs; 30 for the month', E.protein7.day === D0 - 30 && E.foodLog7.day === D0 - 30 && E.protein30.day === D0 - 7 && E.foodLog30.day === D0 - 7);
check('Plans: made, shared, tailored, reviewed, a badge shared, each on its day', E.ownPlan.day === D0 - 120 && E.sharedPlan.day === D0 - 90 && E.tailored.day === D0 - 80 && E.reviewed.day === D0 - 60 && E.shareBadge.day === D0 - 10);
check('All set: the first workout and the first feel check', E.allSet.day === START + 2);
check('Connected: no day in the history to tell, so the day it was found, marked approximate', E.connected.day === D0 && E.connected.approx === true);
check('nothing else is approximate', Object.entries(E).every(([id, e]) => id === 'connected' || !e.approx));
check('every day is on or before the day of the check, and after the start of the data', Object.values(E).every((e) => e.day <= D0 && e.day >= START - 1));
check('each saved with when it was recorded', Object.values(E).every((e) => e.at === NOW));
check('the counted ones keep their number', E.km100.value >= 100 && E.streak7.value === 7);
check('and each arrives sealed (not opened yet)', Object.values(E).every((e) => e.opened === false));

section('Progress on the way');
{
  const mid = copy(YEAR);
  const day = START + 120;
  const got = A.check(mid, day, 'test', { now: at(day, 10) });
  const list = A.evaluate(mid, day);
  const it = (id) => list.find((x) => x.id === id);
  check('half a year in, the later ones aren\'t earned yet', !got.includes('w250') && !got.includes('anniversary') && !got.includes('halfMarathon') && got.includes('first'));
  check('Lifer shows the workouts so far, of 250', it('w250').have > 50 && it('w250').have < 250 && it('w250').goal === 250 && it('w250').pct > 0.2 && it('w250').pct < 1);
  check('One year in counts the days', it('anniversary').have === 120 && it('anniversary').goal === 365);
  const sum = A.summary(mid, day, list);
  check('the summary: earned of offered, and the closest one still to earn (never a secret)', sum.earned === got.length && sum.total === list.filter((x) => x.shown).length && sum.next && !sum.next.earned && !sum.next.def.secret && sum.next.pct >= Math.max(...list.filter((x) => x.shown && !x.earned && !x.def.secret).map((x) => x.pct)), sum.next && sum.next.id);
  check('with what\'s left to go', /^\d[\d,.]* (km |m |h )?to go$/.test(A.toGo(sum.next)), A.toGo(sum.next));
  check('earned today: day and progress are right before anything is saved', it('first').earned && it('first').day === START);
}

section('Sealed until opened');
{
  const S = copy(S1);
  const E1 = S.achievements.earned;
  // Earned at three different times: the oldest first, then by day.
  E1.w250.at = NOW - 3000; E1.first.at = NOW - 2000; E1.newYear.at = NOW - 2000;
  const sealed = A.unopened(S);
  check('unopened(S): every badge earned and not opened yet', sealed.length === A.DEFS.length && new Set(sealed).size === sealed.length, sealed.length);
  check('oldest first: by when each was earned, then by its day', sealed[0] === 'w250' && sealed[1] === 'first' && sealed[2] === 'newYear' && sealed.slice(3).every((id, i, l) => i === 0 || E1[l[i - 1]].day <= E1[id].day), sealed.slice(0, 4));
  check('evaluate marks them sealed, and still earned, on their day', A.evaluate(S, D0).every((x) => x.sealed && x.earned && x.day === E1[x.id].day));
  const sum = A.summary(S, D0);
  check('the summary counts them as earned, and how many are still to open', sum.earned === A.DEFS.length && sum.unopened === A.DEFS.length, sum);
  const rec = JSON.stringify(E1.km100);
  check('markOpened opens one (true), and only once (false after)', A.markOpened(S, 'km100') === true && E1.km100.opened === true && A.markOpened(S, 'km100') === false);
  check('opening changes nothing else: its day, when it was earned, its number', JSON.stringify(Object.assign({}, E1.km100, { opened: false })) === rec);
  check('it leaves unopened(S), and only it', !A.unopened(S).includes('km100') && A.unopened(S).length === A.DEFS.length - 1);
  const it = A.evaluate(S, D0).find((x) => x.id === 'km100');
  check('evaluate: opened, earned, the same day', !it.sealed && it.earned && it.day === E1.km100.day);
  check('a badge not earned, or not a badge at all, can\'t be opened', A.markOpened(copy(YEAR), 'first') === false && A.markOpened(S, 'nope') === false && A.markOpened(S, '__proto__') === false && A.markOpened(S, null) === false && A.markOpened({}, 'first') === false);
  E1.fromLater = { day: D0, at: NOW, opened: false };
  check('a newer version\'s sealed badge isn\'t offered to open here, and stays in the record', !A.unopened(S).includes('fromLater') && A.check(S, D0, 'test', { now: NOW + 5 }).length === 0 && E1.fromLater.opened === false);
  check('nothing sealed, nothing to open', A.unopened(copy(YEAR)).length === 0 && A.unopened({}).length === 0 && A.unopened(null).length === 0);
}

section('Earned for good');
{
  const S = copy(S1);
  for (const id of ['first', 'streak7', 'w10']) A.markOpened(S, id);
  const before = JSON.stringify(S.achievements.earned);
  S.log = []; S.activities = []; S.weights = []; S.health.days = {}; S.food.days = {}; S.protein = {}; S.customPlans = []; S.events = S.events.filter((e) => e.type !== 'tailor');
  const again = A.check(S, D0 + 3, 'test', { now: NOW + 3 * 86400000 });
  const list = A.evaluate(S, D0 + 3);
  check('history wiped (a reset streak, deleted logs): nothing new, nothing taken away', again.length === 0 && JSON.stringify(S.achievements.earned) === before);
  check('every badge still shows earned, on its day', list.every((x) => x.earned && x.day === S1.achievements.earned[x.id].day));
  check('and still offered (earned ones always show)', list.every((x) => x.shown));
  check('opened ones stay opened, sealed ones stay sealed, waiting', list.filter((x) => !x.sealed).map((x) => x.id).sort().join() === 'first,streak7,w10' && A.unopened(S).length === A.DEFS.length - 3);
}

section('Seen, events and the saved record');
{
  const S = copy(YEAR);
  A.check(S, D0, 'test', { now: 1000 });
  check('earned and not shown yet: new', A.unseen(S).length === A.DEFS.length && A.evaluate(S, D0).every((x) => x.isNew));
  A.markSeen(S, 2000);
  check('seen: nothing new', A.unseen(S).length === 0 && S.achievements.seenAt === 2000);
  const e1 = A.event(S, 'tailored', D0, 3000);
  const e2 = A.event(S, 'tailored', D0 + 1, 4000);
  check('an event keeps its first day and a count', e1 === e2 && e2.day === D0 && e2.n >= 2);
  check('an event that isn\'t a name is turned away', A.event(S, '__proto__', D0) === null && A.event(S, 'a b', D0) === null);
  const R = { profile: S.profile, achievements: { earned: { first: { at: 1 }, w10: { day: D0, at: 2, opened: 'no' }, w25: { day: D0, at: 3, opened: false }, junk: 'x', 'bad id!': { day: 3 } }, events: { x: 5 }, seenAt: 'no' } };
  A.ensure(R, D0);
  check('a record from elsewhere is made whole (bad entries go, a missing day is marked approximate)', R.achievements.v === 2 && R.achievements.earned.first.approx === true && R.achievements.earned.first.day === D0 && !R.achievements.earned.junk && !R.achievements.earned['bad id!'] && !R.achievements.events.x && R.achievements.seenAt === 0);
  check('with opened true or false: none, or anything else, counts as opened', R.achievements.earned.first.opened === true && R.achievements.earned.w10.opened === true && R.achievements.earned.w25.opened === false);
}

section('Migration: the first 1.6 load');
{
  const old = copy(YEAR);
  delete old.achievements;
  const t0 = Date.now();
  const m = GH.store.migrate(old);
  const M = m.achievements;
  check('runs with the store\'s migration (GH.migrations)', GH.migrations.length >= 1 && M && M.v === 2 && M.migrated && M.migrated.n === Object.keys(M.earned).length);
  check('history earns its badges, back-dated', M.earned.first.day === START && M.earned.w10.day === YEAR.log.filter((l) => l.type === 'workout' && B.isDone(l)).map((l) => l.day).sort((a, b) => a - b)[9]);
  check('every badge it found counts as seen', A.unseen(m).length === 0 && M.seenAt >= t0);
  check('and as opened: history found on the first load isn\'t sealed (nothing to open)', A.unopened(m).length === 0 && Object.values(M.earned).every((e) => e.opened === true) && M.v === 2);
  check('one it can\'t date says so (approximate)', M.earned.connected && M.earned.connected.approx === true);
  const snap = JSON.stringify(M);
  GH.store.migrate(m);
  check('a second load changes nothing', JSON.stringify(m.achievements) === snap);
  const fresh2 = B.newState({ goals: ['abs'] }, null, D0);
  GH.store.migrate(fresh2);
  check('a new state migrates to nothing earned', fresh2.achievements.migrated.n === 0 && Object.keys(fresh2.achievements.earned).length === 0);
  const back = GH.store.importJson(GH.store.exportJson(m));
  check('a backup keeps them, earned dates and all', back.ok && JSON.stringify(back.state.achievements.earned) === JSON.stringify(M.earned));
}

section('Migration: the first 1.8.11 load (badges arrive sealed)');
{
  // A record as 1.8.10 saved it: v 1, no opened, one badge earned and not shown yet.
  const old = copy(YEAR);
  A.check(old, D0, 'test', { now: NOW });
  A.markSeen(old, NOW);
  for (const e of Object.values(old.achievements.earned)) delete e.opened;
  old.achievements.v = 1;
  old.achievements.migrated = { at: NOW, n: 3, seen: true };
  old.achievements.earned.w250.at = NOW + 60000; // earned after it was last seen
  const days = JSON.stringify(Object.fromEntries(Object.entries(old.achievements.earned).map(([id, e]) => [id, [e.day, e.at]])));
  const m = GH.store.migrate(copy(old));
  const M = m.achievements;
  check('every badge earned before then counts as opened (nothing to open)', M.v === 2 && Object.values(M.earned).every((e) => e.opened === true) && A.unopened(m).length === 0 && A.evaluate(m, D0).every((x) => !x.sealed));
  check('the one not shown yet is still new (shown, as before, as its medal)', A.unseen(m).join() === 'w250');
  check('nothing else changes: every badge, its day and when it was earned', JSON.stringify(Object.fromEntries(Object.entries(M.earned).map(([id, e]) => [id, [e.day, e.at]]))) === days && Object.keys(M.earned).length === A.DEFS.length);
  const snap = JSON.stringify(M);
  GH.store.migrate(m);
  check('a second load changes nothing', JSON.stringify(m.achievements) === snap);
  // From then on a new badge stays sealed, load after load, until it's opened.
  delete m.achievements.earned.w250;
  check('a badge earned after it arrives sealed', A.check(m, D0, 'test', { now: NOW + 120000 }).join() === 'w250' && A.unopened(m).join() === 'w250');
  GH.store.migrate(m);
  check('and a load doesn\'t open it', A.unopened(m).join() === 'w250' && m.achievements.earned.w250.opened === false);
  const back = GH.store.importJson(GH.store.exportJson(m));
  check('a backup keeps it sealed, and the rest opened', back.ok && A.unopened(back.state).join() === 'w250' && Object.entries(back.state.achievements.earned).every(([id, e]) => e.opened === (id !== 'w250')));
  // A crafted backup: opened has to be true or false (store.sanitize), anything else counts as opened.
  const bad = JSON.parse(GH.store.exportJson(m));
  bad.state.achievements.earned.w250.opened = 'nope';
  bad.state.achievements.earned.first.opened = { x: 1 };
  bad.state.achievements.earned.w10.opened = 0;
  const r = GH.store.importJson(JSON.stringify(bad));
  check('a crafted backup\'s opened that isn\'t true or false counts as opened', r.ok && ['w250', 'first', 'w10'].every((id) => r.state.achievements.earned[id].opened === true) && A.unopened(r.state).length === 0, r.ok && ['w250', 'first', 'w10'].map((id) => r.state.achievements.earned[id].opened));
  check('store.sanitize checks it on every load too', (() => { const s = copy(m); s.achievements.earned.w250.opened = 'x'; GH.store.sanitize(s, { deep: false }); return s.achievements.earned.w250.opened === true; })());
}

section('What\'s offered');
{
  const S = B.newState({ goals: ['abs'], workouts: true }, null, D0);
  const shown = (s, id, live) => A.evaluate(s, D0, { live }).find((x) => x.id === id).shown;
  check('with workouts on: workout badges are offered', shown(S, 'w10') && shown(S, 'streak7') && shown(S, 'ownPlan'));
  S.profile.workouts = false;
  check('with workouts off: not offered', !shown(S, 'w10') && !shown(S, 'streak7') && !shown(S, 'pr') && !shown(S, 'ownPlan'));
  check('but activities, health, a year in and the secret Show and tell still are', shown(S, 'run5k') && shown(S, 'steps10k') && shown(S, 'anniversary') && shown(S, 'shareBadge'));
  S.achievements = { v: 1, earned: { w10: { day: D0 - 3, at: 1 } }, events: {}, seenAt: 0 };
  check('an earned workout badge always shows', shown(S, 'w10'));
  S.profile.food = { mode: 'off' };
  check('food off: no protein badges', !shown(S, 'protein7'));
  S.profile.food = { mode: 'protein' };
  check('the protein counter: protein badges, not food logs', shown(S, 'protein7') && !shown(S, 'foodLog7'));
  S.profile.food = { mode: 'full' };
  check('calorie tracking: food logs too', shown(S, 'foodLog7') && shown(S, 'foodLog30'));
  check('Connected only where Health Connect can be', shown(S, 'connected', { hc: 'denied' }) && !shown(S, 'connected', { hc: 'unsupported' }));
}

section('Checking only what changed');
{
  const S = copy(YEAR);
  A.check(S, D0, 'test');
  const before = A.stamps(S, D0);
  B.addWeight(S, D0, 74, 'manual');
  const afterW = A.stamps(S, D0);
  const changedW = Object.keys(before).filter((k) => before[k] !== afterW[k]);
  check('a weigh-in touches health, food (the protein goal reads the weight) and getting started', changedW.sort().join() === 'food,health,start', changedW);
  B.logLight(S, D0, 'walk', true);
  const afterL = A.stamps(S, D0);
  const changedL = Object.keys(afterW).filter((k) => afterW[k] !== afterL[k]);
  check('a walk ticked on a light day touches training (streaks, body, moments) and getting started', ['consistency', 'workouts', 'strength', 'body', 'moments'].every((k) => changedL.includes(k)) && !changedL.includes('health') && !changedL.includes('food'), changedL);
  const nextDay = A.stamps(S, D0 + 1);
  check('a new day re-checks Moments (a year in), not the rest of training, activities or plans', afterL.moments !== nextDay.moments && ['consistency', 'workouts', 'strength', 'body', 'activities', 'plans', 'start'].every((k) => afterL[k] === nextDay[k]));
  // A food-only check never replays the calendar.
  const real = B.calendar;
  let calls = 0;
  B.calendar = (...a) => { calls++; return real(...a); };
  const T = copy(YEAR);
  A.check(T, D0, 'test', { cats: ['food', 'health'] });
  B.calendar = real;
  check('a check for food and health never replays the calendar', calls === 0 && T.achievements.earned.protein7 && !T.achievements.earned.first, calls);
}

section('Timing');
{
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const S = copy(YEAR);
    const t = performance.now();
    A.check(S, D0, 'test');
    A.evaluate(S, D0);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  check(`a whole check and evaluation of a year, calendar replay included: ${runs[2].toFixed(1)} ms (15 or less)`, runs[2] <= 15, runs.map((x) => x.toFixed(1)));
  const S = copy(YEAR);
  A.check(S, D0, 'test');
  const t = performance.now();
  for (let i = 0; i < 20; i++) A.evaluate(S, D0);
  const each = (performance.now() - t) / 20;
  check(`evaluating again (the gallery's renders): ${each.toFixed(2)} ms`, each <= 5);
}

section('Sharing a badge on Android (source)');
{
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const SP = read('android/src/com/shadowsdistant/gradienthealth/ShareProvider.java');
  const BR = read('android/src/com/shadowsdistant/gradienthealth/Bridge.java');
  const MA = read('android/src/com/shadowsdistant/gradienthealth/MainActivity.java');
  const MF = read('android/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  const prov = (MF.match(/<provider\b[^>]*>/) || [''])[0];
  check('the manifest: ShareProvider, its own authority, not exported, read grants per share', /android:name="\.ShareProvider"/.test(prov) && /android:authorities="com\.shadowsdistant\.gradienthealth\.files"/.test(prov) && /android:exported="false"/.test(prov) && /android:grantUriPermissions="true"/.test(prov), prov);
  check('ShareProvider is a plain ContentProvider (no AndroidX)', /extends ContentProvider/.test(SP) && !/androidx/.test(SP));
  check('it serves only /shared/<name>.png, lowercase letters, digits and dashes', SP.includes('Pattern.compile("^/shared/[a-z0-9-]{1,40}\\\\.png$")'));
  check('checked again on the canonical path, inside cacheDir/shared', /getCacheDir\(\), DIR\)\.getCanonicalFile\(\)/.test(SP) && /getCanonicalFile\(\);\s*if \(!dir\.equals\(file\.getParentFile\(\)\)/.test(SP));
  check('read only: "r" files, writes throw', /if \(!"r"\.equals\(mode\)\) \{\s*throw new SecurityException/.test(SP) && /MODE_READ_ONLY/.test(SP) && ['insert', 'update', 'delete'].every((m) => new RegExp(`public \\w+ ${m}\\([^)]*\\) \\{\\s*throw new UnsupportedOperationException`).test(SP)));
  check('a PNG, with a name and size for the app that asks', /return "image\/png";/.test(SP) && /new MatrixCursor\(/.test(SP) && /OpenableColumns\.DISPLAY_NAME/.test(SP) && /OpenableColumns\.SIZE/.test(SP));
  check('it refuses to run exported or without grants', /if \(info\.exported\) \{\s*throw new SecurityException/.test(SP) && /if \(!info\.grantUriPermissions\) \{\s*throw new SecurityException/.test(SP));
  const share = (BR.match(/public boolean shareImage\(String b64, String text\) \{[\s\S]*?\n {4}\}/) || [''])[0];
  check('Bridge.shareImage checks the page first, then a PNG of 10 MB at most', /^public boolean shareImage\(String b64, String text\) \{\s*if \(!trusted\(\)\) \{\s*return false;/.test(share) && /isPng\(png\)/.test(share) && /MAX_SHARE_BYTES/.test(share) && /MAX_SHARE_BYTES = 10 \* 1024 \* 1024/.test(BR) && /\(byte\) 0x89, 'P', 'N', 'G', '\\r', '\\n', 0x1a, '\\n'/.test(BR), share.slice(0, 200));
  check('the file goes to cacheDir/shared/badge-<ms>.png, five at most, none older than an hour', /new java\.io\.File\(getCacheDir\(\), ShareProvider\.DIR\)/.test(MA) && /"badge-" \+ System\.currentTimeMillis\(\) \+ "\.png"/.test(MA) && /SHARED_KEEP = 5/.test(MA) && /SHARED_MAX_AGE_MS = 60L \* 60L \* 1000L/.test(MA));
  const send = (MA.match(/void shareImage\(java\.io\.File file, String text\) \{[\s\S]*?\n {4}\}/) || [''])[0];
  check('sent as ACTION_SEND image/png with the stream, the text, ClipData and the read grant on the intent and the chooser', /ACTION_SEND/.test(send) && /setType\("image\/png"\)/.test(send) && /EXTRA_STREAM, uri/.test(send) && /EXTRA_TEXT, text/.test(send) && /setClipData\(android\.content\.ClipData\.newRawUri\("", uri\)\)/.test(send) && /send\.addFlags\(Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/.test(send) && /chooser\.addFlags\(Intent\.FLAG_GRANT_READ_URI_PERMISSION\)/.test(send));
}

done();
