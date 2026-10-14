// The plan engine's optimizer: the split search against brute force, the week's set allocation,
// fitting sessions to their time, the score, plan tweaks, explanations, the engine epoch, caching
// and timing.
// Usage: node test/optimizer.mjs
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/brain.js', 'src/access.js', 'src/customplan.js');
const B = GH.brain, M = GH.moves, O = GH.optimizer, I = O._internal;
const D0 = B.dayFromStr('2026-09-28'); // a Monday
B.freeze(true); // cached answers are read-only: any change to one throws

let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const popc = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
const HOUSE = { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: true, wall: true, towel: true, table: false, door: false };
const person = (p, day = D0) => B.newState(Object.assign({ goals: ['abs', 'arms'], days: 4, minutes: 30, equipment: HOUSE }, p), null, day);
const noDash = (s) => !/[—–]/.test(s);

/* ------------------------------------------------------------------ the split search */
section('Split search: exact, and every split counted');
{
  // Brute force: every unit on every combination of its days, keeping those with every day used and
  // no day over its room (arms weighing w).
  const brute = (f, ctx) => {
    const W = ctx.w || [1, 1, 1, 1, 1, 1];
    const opts = f.map((k) => { if (!k) return [0]; const o = []; for (let m = 0; m < (1 << ctx.D); m++) if (popc(m) === k) o.push(m); return o; });
    let best = Infinity, count = 0;
    const C = new Array(6).fill(0);
    const rec = (u) => {
      if (u === 6) {
        const days = new Array(ctx.D).fill(0);
        for (let v = 0; v < 6; v++) for (let d = 0; d < ctx.D; d++) if (C[v] >> d & 1) days[d] |= 1 << v;
        for (let d = 0; d < ctx.D; d++) { if (!days[d]) return; let n = 0; for (let v = 0; v < 6; v++) if (days[d] >> v & 1) n += W[v]; if (n > ctx.maxUnits) return; }
        count++;
        best = Math.min(best, I.maskCost(days, ctx));
        return;
      }
      for (const m of opts[u]) { C[u] = m; rec(u + 1); }
    };
    rec(0);
    return { cost: best, count };
  };
  let n = 0, costBad = 0, countBad = 0, maskBad = 0;
  for (let k = 0; k < 300; k++) {
    const offs = [...new Set(Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => Math.floor(rnd() * 7)))].sort((a, b) => a - b);
    if (offs.length < 2) continue;
    const D = offs.length;
    const f = Array.from({ length: 6 }, () => (rnd() < 0.15 ? 0 : 1 + Math.floor(rnd() * Math.min(3, D))));
    if (!f.some(Boolean)) continue;
    const ctx = { D, offsets: offs, maxUnits: 1 + Math.floor(rnd() * 6), load: Array.from({ length: 6 }, () => 2 + rnd() * 30), free: 5 + rnd() * 50, w: rnd() < 0.3 ? [2, 1, 1, 1, 1, 1] : [1, 1, 1, 1, 1, 1] };
    const a = I.bestDays(f, ctx), b = brute(f, ctx);
    n++;
    if ((a ? a.cost : Infinity) !== b.cost && Math.abs((a ? a.cost : 0) - b.cost) > 1e-6) costBad++;
    if (a && Math.abs(I.maskCost(a.days, ctx) - a.cost) > 1e-6) maskBad++;
    if (I.countSplits(f, D, ctx.maxUnits, ctx.w) !== b.count) countBad++;
  }
  check(`branch and bound finds brute force's best split (${n} random weeks of 2 to 4 days)`, costBad === 0 && maskBad === 0, { costBad, maskBad });
  check('the count of splits matches brute force', countBad === 0, countBad);
  const p = Object.assign(B.defaultProfile(), { goals: ['abs', 'arms'], days: 4, minutes: 45, startDay: D0 });
  const sp = O.split(p, B.programFor(p));
  check('a split counts every arrangement it compared, and uses every training day', sp.considered > 1000 && sp.days.length === 4 && sp.days.every((d) => d.units.length), { considered: sp.considered, days: sp.days });
  O.clearCache();
  const again = O.split(p, B.programFor(p));
  check('the same answers give the same split (ties break the same way)', JSON.stringify(again.days) === JSON.stringify(sp.days));
  check('the best fit is the best whole plan: it scores at least as well as each classic split tried', !sp.scores || sp.scores.every((x) => x.score == null || x.score <= Math.max(...sp.scores.map((y) => y.score || 0)) + 1e-9) && (!sp.scores || sp.scores.some((x) => x.label === sp.label)), sp.scores);
  // Every unit that can be trained appears; a day never holds more than the time allows.
  const tight = Object.assign({}, p, { minutes: 15, days: 6 });
  const st = O.split(tight, B.programFor(tight));
  check('every trainable unit is in the week, even with short sessions', O.UNITS.every((u) => st.days.some((d) => d.units.includes(u))), st.days.map((d) => d.units.join('+')));
  const simple = Object.assign({}, p, { complexity: 2, minutes: 45 });
  const ss = O.split(simple, B.programFor(simple));
  check('simpler sessions (4 exercises) never put more units on a day than they hold', ss.days.every((d) => d.units.reduce((a, u) => a + (u === 'arms' ? 2 : 1), 0) <= 4 || ss.parity), ss.days.map((d) => d.units.join('+')));
  const ppl = O.split(Object.assign({}, p, { planTweaks: { split: 'ppl' }, days: 3 }), B.programFor(Object.assign({}, p, { days: 3 })));
  check('a split tweak gives that shape (push, pull and legs)', ppl.label === 'ppl' && ppl.kind === 'ppl', ppl.days.map((d) => d.units.join('+')));
}

/* ------------------------------------------------------------------ the week's sets */
section('Week plan: sets given out by what they are worth');
{
  const S = person({ goals: ['chest', 'back'], days: 4, minutes: 45, equipment: Object.assign({}, HOUSE, { db: [10, 20, 30] }) });
  B.calendar(S, D0 + 14);
  const wp = O.weekPlan(S, D0 + 14, { phase: { mult: 1, onramp: false, deload: false } });
  const pg = wp.perGroup;
  check('weekly sets stay within each group\'s cap', B.GROUPS.every((g) => pg[g].aim + pg[g].extras <= pg[g].cap), pg);
  check('every group that can be trained reaches its weekly minimum (counting half for bigger moves that help)', B.GROUPS.every((g) => !pg[g].trainable || pg[g].effective >= pg[g].floor), B.GROUPS.map((g) => `${g} ${pg[g].effective}/${pg[g].floor}`));
  check('with time to spare, every group reaches its target', B.GROUPS.every((g) => !pg[g].trainable || pg[g].aim >= pg[g].target), B.GROUPS.map((g) => `${g} ${pg[g].aim}/${pg[g].target}`));
  check('the top goals get the most sets', pg.chest.aim >= pg.shoulders.aim && pg.back.aim >= pg.shoulders.aim && pg.chest.aim >= pg.biceps.aim, B.GROUPS.map((g) => `${g} ${pg[g].aim}`));
  check('a full week with time to spare goes past the target, up to the boosted target', B.GROUPS.some((g) => pg[g].aim > pg[g].target) && B.GROUPS.every((g) => pg[g].aim <= Math.max(pg[g].boosted, pg[g].floor)), B.GROUPS.map((g) => `${g} ${pg[g].aim}/${pg[g].target}/${pg[g].boosted}`));
  const per = {};
  for (const d of wp.days) for (const [g, n] of Object.entries(d.groupSets)) (per[g] = per[g] || []).push(n);
  check('a group\'s sets are spread over its days (no day more than 2 apart)', Object.values(per).every((a) => Math.max(...a) - Math.min(...a) <= 2), per);
  check('each day lists its slots: group, exercises, sets, priority and the protected share', wp.days.every((d) => d.slots.every((sl) => sl.group && sl.fams.length && sl.sets > 0 && sl.pri != null && sl.protect <= sl.sets)));
  const onr = O.weekPlan(S, D0 + 14, { phase: { mult: 0.7, onramp: true, deload: false } });
  const total = (w) => B.GROUPS.reduce((a, g) => a + w.perGroup[g].aim, 0);
  check(`an easing-in week is lighter than a full one (${total(onr)} of ${total(wp)} sets)`, total(onr) < total(wp) * 0.85, { onramp: total(onr), full: total(wp) });
  // Short on time: the minimums first.
  const T = person({ goals: ['abs', 'arms'], days: 3, minutes: 15 });
  const tw = O.weekPlan(T, D0 + 14, { phase: { mult: 1, onramp: false, deload: false } });
  check('with 15-minute sessions every group still gets 2 effective sets', B.GROUPS.every((g) => !tw.perGroup[g].trainable || tw.perGroup[g].effective >= 2), B.GROUPS.map((g) => `${g} ${tw.perGroup[g].effective}`));
  // The rest of the week is planned round what's been done.
  const R = person({ goals: ['abs', 'arms'], days: 4, minutes: 30 });
  const before = O.weekPlan(R, D0);
  const first = before.days[0];
  R.log.push({ type: 'workout', day: D0 + first.offset, tpl: first.tpl, checkedIn: true, pct: 1, items: [{ kind: 'move', group: 'biceps', fam: 'curl', moveId: 'curl_std', sets: [0, 1, 2, 3, 4, 5].map((k) => ({ set: k, amount: 10 })) }] });
  const after = O.weekPlan(R, D0);
  check('a workout done counts as done: the week plans the rest round its sets', after.days[0].groupSets.biceps === 6 && after.perGroup.biceps.aim <= Math.max(after.perGroup.biceps.boosted, 6), { done: after.days[0].groupSets, aim: after.perGroup.biceps });
  // The plan's times are the sessions' own: a day's sets are measured on the session they make (two
  // sets of legs can be two exercises, each with its setting up), so the fit has no need to cut the
  // floor's share. Ten-minute days at the gym, six a week.
  const G10 = person({ goals: ['arms', 'chest', 'legs', 'abs'], experience: '3plus', days: 6, minutes: 10, where: 'gym', gym: Object.assign(B.gymPreset('basic', 'kg'), { dbMax: 0 }), careful: ['elbow'], gentle: true, age: 13, conditions: ['ra'], floorOk: false, focus: ['rearDelts', 'glutes'] });
  for (let w = 0; w < 2; w++) G10.log.push({ type: 'workout', day: D0 + w * 7 + 6, tpl: 0, title: 'Workout', items: [], checkedIn: true, pct: 1, planned: 1, doneSets: 1 });
  const gcal = B.calendar(G10, D0 + 14);
  const gwp = O.weekPlan(G10, D0 + 14, { phase: gcal.weeks[D0 + 14].phase });
  const cut = [];
  for (const x of gcal.weeks[D0 + 14].sessions) {
    const sx = B.buildSession(G10, x.day, x.tpl, { cal: gcal, noReadiness: true });
    const dp = gwp.days.find((d) => d.tpl === x.tpl);
    for (const [g, n] of Object.entries(dp.protect)) { const got = sx.items.filter((it) => !it.skill && it.group === g).reduce((q, it) => q + it.sets, 0); if (got < n) cut.push(`${B.dayStr(x.day)} ${g} ${got} < ${n}`); }
  }
  check('ten-minute sessions keep the floor\'s share of their planned sets', !cut.length, cut);
  // Too little time for 2 sets of every group: they take turns, what last week's workouts left
  // short coming first, so two weeks in a row train them all.
  const Tn = person({ goals: ['abs', 'arms', 'chest', 'legs', 'back'], days: 2, minutes: 10, equipment: Object.assign({}, HOUSE, { db: [10, 20] }) });
  for (let w = 0; w < 2; w++) Tn.log.push({ type: 'workout', day: D0 + w * 7 + 6, tpl: 0, title: 'Workout', items: [], checkedIn: true, pct: 1, planned: 1, doneSets: 1 });
  const effOf = (sessions) => { const e = Object.fromEntries(B.GROUPS.map((g) => [g, 0])); for (const sx of sessions) for (const it of sx.items.concat(sx.extras || [])) { if (it.skill || !B.GROUPS.includes(it.group)) continue; e[it.group] += it.sets; for (const h of new Set((M.MOVES[it.moveId].muscles || []).map((mu) => B.MUSCLE_GROUP[mu]).filter((h2) => h2 && h2 !== it.group))) e[h] += 0.5 * it.sets; } return e; };
  const weekOf = (S, ws) => { const c = B.calendar(S, ws); return c.weeks[ws].sessions.filter((x) => !x.dropped && x.day != null).map((x) => B.buildSession(S, x.day, x.tpl, { cal: c, noReadiness: true })); };
  const w3 = weekOf(Tn, D0 + 14);
  const turnPlan = O.weekPlan(Tn, D0 + 14);
  for (const sx of w3) {
    const items = sx.items.concat(sx.extras || []).map((it) => ({ fam: it.fam, moveId: it.moveId, kind: it.kind, group: it.group, sets: Array.from({ length: it.sets || 1 }, (_, i) => ({ set: i + 1, amount: it.target })) }));
    Tn.log.push({ type: 'workout', day: sx.day, tpl: sx.tpl, title: sx.title, items, checkedIn: true, pct: 1, planned: 1, doneSets: items.reduce((q, it) => q + it.sets.length, 0) });
  }
  const e3 = effOf(w3), e4 = effOf(weekOf(Tn, D0 + 21));
  const left3 = B.GROUPS.filter((g) => turnPlan.perGroup[g].trainable && e3[g] < 2);
  check('too little time for every group: next week trains first what this week left short', turnPlan.parity && left3.length > 0 && left3.filter((g) => e3[g] + e4[g] >= 2).length >= Math.min(left3.length, 2), { left3, e3, e4 });
  // No planned day goes without sets because of what's round them: a left vs right test waits for
  // another day, the parts round the sets shrink, then a planned finisher goes.
  const empty = [];
  for (const minutes of [10, 15]) {
    for (const goals of [['fat', 'consistency'], ['endurance', 'strength', 'mobility', 'fat'], ['abs', 'arms']]) {
      const S = person({ goals, days: 5, minutes, age: 25, conditions: ['hands'], lead: { arm: 'L', leg: 'R' }, where: 'gym', gym: B.gymPreset('small', 'lb') });
      for (const ws of [D0, D0 + 14]) for (const d of O.weekPlan(S, ws).days) if (!Object.keys(d.groupSets).length) empty.push(`${minutes} min ${goals.join('+')} ${B.dayStr(d.day)}`);
    }
  }
  check('no planned day is left without sets by its test, warm-up or finisher', !empty.length, empty.slice(0, 4));
}

/* ------------------------------------------------------------------ fitting sessions */
section('Fitting sessions to their time');
{
  let over = 0, n = 0, low = 0, big = 0, mainShort = 0;
  const examples = [];
  for (const minutes of [10, 15, 20, 30, 45, 60]) {
    for (const goals of [['abs', 'arms'], ['strength'], ['fat'], ['mobility', 'back']]) {
      for (const extra of [{}, { age: 72, conditions: ['balance'] }, { where: 'gym', gym: B.gymPreset('full', 'lb') }]) {
        const S = person(Object.assign({ goals, days: 3, minutes }, extra));
        const cal = B.calendar(S, D0);
        for (const x of cal.weeks[D0].sessions) {
          const s = B.buildSession(S, x.day, x.tpl, { cal });
          const est = B.estimate(S, s);
          n++;
          if (est > minutes + 0.5) { over++; if (examples.length < 3) examples.push(`${minutes} min: ${est.toFixed(1)}`); }
          if (minutes >= 20) { big++; if (est < 0.8 * minutes) low++; }
          if (!s.light && s.items.filter((it) => !it.skill).length < (minutes >= 15 ? 2 : 1)) mainShort++;
        }
      }
    }
  }
  check(`no session runs over its time by more than 30 s (${n} sessions, 10 to 60 minutes)`, over === 0, examples);
  check(`sessions of 20 minutes or more are filled to at least 80% (${big - low} of ${big})`, low <= big * 0.05, low);
  check('at least 2 main exercises from 15 minutes (1 below)', mainShort === 0, mainShort);
  // An hour's session in someone's first, easier week: the sets don't fill it, so it goes on with an
  // easy cardio block and stretches.
  const S = person({ goals: ['abs', 'arms'], days: 3, minutes: 60, experience: 'never', recentActivity: 'none' });
  const cal = B.calendar(S, D0);
  const s = B.buildSession(S, D0, cal.weeks[D0].sessions[0].tpl, { cal });
  check('a long session ends with an easy cardio block and stretches when the sets are done', s.mobility.some((mb) => mb.cardio) && s.mobility.some((mb) => !mb.cardio) && B.estimate(S, s) >= 0.92 * 60 - 0.5, s.mobility.map((m) => `${m.moveId}:${m.target}`));
  // With more experience and the same hour, sets take most of it.
  const X = person({ goals: ['abs', 'arms'], days: 3, minutes: 60, experience: '3plus', recentActivity: 'regular' });
  const xc = B.calendar(X, D0);
  const xs = B.buildSession(X, D0, xc.weeks[D0].sessions[0].tpl, { cal: xc });
  const setMin = (x) => B.estimate(X, Object.assign({}, x, { warmup: [], mobility: [], finisher: null, tests: [], extras: [] }));
  check('with experience and a full week, sets take most of an hour', setMin(xs) >= 0.6 * 60 && B.estimate(X, xs) >= 0.92 * 60 - 0.5, setMin(xs).toFixed(1));
  // Short on time: 12 to 13.5 minutes, priority work.
  const shorts = cal.weeks[D0].sessions.map((x) => B.buildSession(S, x.day, x.tpl, { short: true, cal }));
  check('short sessions run 12 to 13.5 minutes', shorts.every((x) => B.estimate(S, x) >= 11.5 && B.estimate(S, x) <= 13.5), shorts.map((x) => B.estimate(S, x).toFixed(1)));
  // The cap: a senior's mandatory parts first shrink, sets stay.
  const old = person({ goals: ['abs', 'arms'], days: 2, minutes: 10, age: 80, conditions: ['balance'] });
  const oc = B.calendar(old, D0);
  const os = B.buildSession(old, D0 + oc.weeks[D0].sessions[0].day - D0, oc.weeks[D0].sessions[0].tpl, { cal: oc });
  check('a 10-minute session with balance practice keeps a main exercise and fits the time', os.items.some((it) => !it.skill) && B.estimate(old, os) <= 10.5, os.items.map((it) => `${it.moveId}×${it.sets}`));
  // A bad night: one less set per exercise, and no extra sets put back.
  const P = person({ goals: ['chest'], days: 3, minutes: 45 });
  const pc = B.calendar(P, D0);
  const day = pc.weeks[D0].sessions[0].day;
  const plain = B.buildSession(P, day, pc.weeks[D0].sessions[0].tpl, { cal: pc });
  P.sleepChip[day] = '<5';
  const tired = B.buildSession(P, day, pc.weeks[D0].sessions[0].tpl, { cal: pc });
  const sets = (x) => x.items.reduce((a, it) => a + (it.skill ? 0 : it.sets), 0);
  check('after a bad night the session has fewer sets and no finisher is added', sets(tired) < sets(plain) && !tired.finisher, { plain: sets(plain), tired: sets(tired) });
}

/* ------------------------------------------------------------------ the score */
section('The score');
{
  check('the six parts weigh 1 in all', Math.abs(Object.values(O.PARTS).reduce((a, b) => a + b, 0) - 1) < 1e-9, O.PARTS);
  const S = person({ goals: ['legs', 'chest'], days: 4, minutes: 40 });
  const sc = O.score(S, D0 + 7);
  check('a built week scores between 0 and 1, every part too, and keeps every rule', sc.score > 0.7 && sc.score <= 1 && Object.values(sc.parts).every((v) => v >= 0 && v <= 1) && sc.feasible, sc);
  const wp = O.weekPlan(S, D0 + 7);
  const bad = B.buildSession(S, wp.days[0].day, wp.days[0].tpl, {});
  bad.items.push(Object.assign({}, bad.items[0], { moveId: 'bench_bb', name: 'Bench press', sets: 3 }));
  const r = I.scoreBuilt(S, wp, [bad]);
  check('the hard rules catch a move the kit can\'t do', !r.feasible && r.violations.some((v) => v.kind === 'kit'), r.violations);
  check('time fit: 85% to 100% of the time is full marks, over it loses fast', I.timeFit(0.9) === 1 && I.timeFit(1) === 1 && I.timeFit(0.5) < 0.6 && I.timeFit(1.3) < 0.1);
}

/* ------------------------------------------------------------------ plan tweaks */
section('Plan tweaks');
{
  check('TWEAKS lists what a tweak can change', O.TWEAKS.split.join() === 'auto,full_body,upper_lower,ppl' && O.TWEAKS.rest.join() === 'auto,60,90,120' && O.TWEAKS.sets.min === -3 && O.TWEAKS.sets.max === 3 && O.TWEAKS.finisher.length === 3 && O.TWEAKS.mobility.length === 3);
  const junk = O.normTweaks({ sets: { chest: 9, legs: 'x', nope: 2, __proto__: { abs: 3 } }, swaps: { push: 'push_knee', squat: 'no_such_move', constructor: 'push_std' }, split: 'bro', rest: '120', finisher: 'maybe', avoid: ['fin_burpee', 'fin_burpee', 'zzz', 7] });
  check('unknown fields and values are dropped, numbers clamped', JSON.stringify(junk) === JSON.stringify({ sets: { chest: 3 }, swaps: { push: 'push_knee' }, split: 'auto', rest: 120, finisher: 'auto', mobility: 'auto', avoid: ['fin_burpee'] }), junk);
  const S = person({ goals: ['abs', 'arms'], days: 4, minutes: 40, experience: '1to3', recentActivity: 'regular' });
  const was = JSON.stringify(S);
  const r = O.applyTweaks(S, { sets: { chest: 2 } }, D0);
  check('applyTweaks tries them on a copy: the state is unchanged', JSON.stringify(S) === was);
  check('it says what changes, in plain words', r.ok && r.diff.some((l) => /^Chest: \d+ sets a week \(was \d+\)\.$/.test(l)) && r.reasons.length && r.diff.concat(r.reasons).every(noDash), r);
  check('more chest sets a week means more chest sets', r.after.perGroup.chest.sets > r.before.perGroup.chest.sets, [r.before.perGroup.chest, r.after.perGroup.chest]);
  const r2 = O.applyTweaks(Object.assign({}, S, { profile: Object.assign({}, S.profile, { planTweaks: r.tweaks }) }), { rest: 120 }, D0);
  check('tweaks merge onto the ones in force, and the merged ones come back to save', r2.tweaks.sets.chest === 2 && r2.tweaks.rest === 120 && r2.diff.some((l) => /Rest between sets: 2 minutes \(was automatic\)/.test(l)), r2.diff);
  // Saving them changes the plan.
  S.profile.planTweaks = r2.tweaks;
  const cal = B.calendar(S, D0 + 7);
  const week = cal.weeks[D0 + 7].sessions.map((x) => B.buildSession(S, x.day, x.tpl, { cal }));
  check('a rest tweak sets the rest after every set', week.every((s) => s.items.filter((it) => !it.skill && !it.superset).every((it) => it.rest === 120)));
  // Avoid and swap.
  const T = person({ goals: ['abs', 'arms'], days: 3, minutes: 30, equipment: Object.assign({}, HOUSE, { db: [10, 20] }) });
  const c0 = B.calendar(T, D0 + 7);
  const curls = c0.weeks[D0 + 7].sessions.map((x) => B.buildSession(T, x.day, x.tpl, { cal: c0 })).flatMap((s) => s.items).filter((it) => it.fam === 'curl');
  const usual = curls[0] && curls[0].moveId;
  T.profile.planTweaks = { avoid: [usual] };
  const c1 = B.calendar(T, D0 + 7);
  const all1 = c1.weeks[D0 + 7].sessions.map((x) => B.buildSession(T, x.day, x.tpl, { cal: c1 })).flatMap((s) => s.items);
  check('a move left out never comes up', usual && !all1.some((it) => it.moveId === usual) && all1.some((it) => it.group === 'biceps'), { usual, now: all1.filter((it) => it.group === 'biceps').map((it) => it.moveId) });
  T.profile.planTweaks = { swaps: { curl: 'curl_hammer' } };
  const c2 = B.calendar(T, D0 + 7);
  const s2 = c2.weeks[D0 + 7].sessions.map((x) => B.buildSession(T, x.day, x.tpl, { cal: c2 }));
  const pinned = s2.flatMap((s) => s.items).filter((it) => it.fam === 'curl');
  check('a swapped move is used for its ladder', pinned.length && pinned.every((it) => it.moveId === 'curl_hammer' && it.pinned), pinned.map((it) => it.moveId));
  // Done with reps to spare, the pinned move's reps go up on its ladder.
  const day = c2.weeks[D0 + 7].sessions.find((x) => s2[c2.weeks[D0 + 7].sessions.indexOf(x)].items.some((it) => it.fam === 'curl')).day;
  B.startWorkout(T, day, { now: day * B.DAY_MS + 18 * 3600000 });
  for (let g = 0; T.active && T.active.idx < T.active.steps.length && g < 400; g++) { const st = T.active.steps[T.active.idx]; B.completeStep(T, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(T, st.item, '3'); }
  B.finishWorkout(T, { rating: 'right', now: day * B.DAY_MS + 19 * 3600000 });
  check('a pinned move progresses on its own ladder', T.prog.curl.rung === 'curl_hammer' && T.prog.curl.reps > M.MOVES.curl_hammer.start, T.prog.curl);
  // Finisher off and cool-down on.
  const F = person({ goals: ['fat'], days: 3, minutes: 30 });
  F.profile.planTweaks = { finisher: 'off', mobility: 'on' };
  const cf = B.calendar(F, D0 + 7);
  const fs = cf.weeks[D0 + 7].sessions.map((x) => B.buildSession(F, x.day, x.tpl, { cal: cf }));
  check('finisher off means none, even for a fat-loss goal; mobility on means a cool-down every session', fs.every((s) => !s.finisher && s.mobility.some((m) => !m.cardio)), fs.map((s) => [!!s.finisher, s.mobility.length]));
  // A tweak that makes the plan worse isn't ok.
  const W = person({ goals: ['legs', 'back'], days: 6, minutes: 30 });
  const worse = O.applyTweaks(W, { split: 'full_body' }, D0);
  check('a tweak that lowers the score by more than 0.03 isn\'t ok, and says why', worse.after.score >= worse.before.score - 0.03 ? worse.ok : !worse.ok && worse.reasons.some((l) => /score lower/.test(l)), { before: worse.before.score, after: worse.after.score, reasons: worse.reasons });
  const longer = O.applyTweaks(W, { minutes: 45 }, D0);
  check('minutes can be tried too', longer.diff.some((l) => /Sessions of 45 minutes \(was 30\)/.test(l)), longer.diff);
}

/* ------------------------------------------------------------------ explanations */
section('Why this plan');
{
  const S = person({ goals: ['abs', 'arms'], days: 4, minutes: 45 });
  const ex = O.explain(S, D0);
  const wp = O.weekPlan(S, D0);
  check('explain: a headline, the week, today\'s session, reasons, the parts and how many splits were compared',
    /4 workouts a week, about 45 minutes each, built around your arms and abs/.test(ex.headline) && ex.week.length === 4 && ex.today && ex.today.items.length >= 2 && ex.reasons.length >= 3 && ex.considered === wp.considered && Object.keys(ex.parts).length === 6, ex);
  check('the reasons are plain sentences', ex.reasons.every((l) => /^[A-Z].*[.]$/.test(l) && noDash(l) && l.length < 220), ex.reasons);
  const fresh = O.explainProfile({ goals: ['legs'], days: 3, minutes: 30, equipment: HOUSE }, D0);
  check('explainProfile works from set-up\'s answers alone', fresh.week.length === 3 && fresh.today && fresh.reasons.length >= 2 && fresh.considered >= 1, fresh);
  const alt = O.alternatives(S, D0 + 7);
  check('alternatives: the best fit and the three classic splits, best first, the one in use marked', alt.length === 4 && alt.every((a, i) => i === 0 || a.score <= alt[i - 1].score) && alt.filter((a) => a.current).length === 1 && alt.some((a) => a.split === 'ppl'), alt.map((a) => `${a.split} ${a.score}`));
  check('the best fit scores at least as well as every classic split', alt.find((a) => a.split === 'auto').score >= Math.max(...alt.map((a) => a.score)) - 0.01, alt.map((a) => `${a.split} ${a.score}`));
}

/* ------------------------------------------------------------------ the engine epoch */
section('Engine epoch: weeks before 1.6 replay as they were');
{
  const S = person({ goals: ['abs', 'arms', 'chest', 'legs'], days: 4, minutes: 25 });
  delete S.engineFrom;
  // A 1.5 state: no engineFrom. The migration sets it to the week after the one it's loaded in.
  const real = Date.now;
  Date.now = () => (D0 + 9) * B.DAY_MS + 12 * 3600000;
  for (const fn of GH.migrations || []) fn(S);
  Date.now = real;
  check('the migration starts the engine the week after it first runs', S.engineFrom === D0 + 14, S.engineFrom);
  const once = S.engineFrom;
  for (const fn of GH.migrations || []) fn(S);
  check('and only once', S.engineFrom === once);
  const p2 = Object.assign({}, S.profile, { minutes: 25 });
  const prog = B.programFor(p2);
  const v1 = B.templateV1(p2, prog);
  const cal = B.calendar(S, D0 + 21);
  const units = (ws) => cal.weeks[ws].sessions.map((x) => x.units.join('+')).join(' | ');
  check('weeks before it keep 1.5\'s split', units(D0) === v1.map((t) => t.units.join('+')).join(' | ') && units(D0 + 7) === units(D0), { v1: v1.map((t) => t.units.join('+')), w1: units(D0) });
  check('weeks from it use the optimizer\'s', units(D0 + 14) === O.template(p2, prog).map((t) => t.units.join('+')).join(' | '), units(D0 + 14));
  const legacy = O.weekPlan(S, D0 + 7);
  check('an old week keeps 1.5\'s sets, and its sessions are fitted to the time', legacy.legacy && B.buildSession(S, D0 + 7 + legacy.days[0].offset, 0, {}).estimateMin <= 26);
  check('a new state plans every week with the engine', person({}).engineFrom === B.weekStart(D0));
}

/* ------------------------------------------------------------------ 1.13's rules epoch */
section('Rules epoch: weeks before 1.13\'s rules replay as they were');
{
  // What 1.12 planned for these people (the same history, built day by day): each session's units
  // and moves, the logged ones as done and the rest as planned (! fast on the way up, ~ a skill).
  const HOME = { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: true, wall: true, towel: true, table: false, door: false };
  const PEOPLE = {
    osteo65: { age: 65, conditions: ['osteo'], goals: ['strength', 'consistency'], days: 3, minutes: 45, equipment: Object.assign({}, HOME, { db: [5, 10, 15], band: true, door: true }) },
    gym62: { age: 62, goals: ['legs', 'back'], days: 4, minutes: 60, where: 'gym', gym: B.gymPreset('full', 'kg'), units: 'kg', weightKg: 80, equipment: HOME },
    balance78: { age: 78, conditions: ['balance'], goals: ['consistency'], days: 3, minutes: 40, equipment: HOME },
    arms70: { age: 70, goals: ['abs', 'arms'], days: 2, minutes: 50, equipment: Object.assign({}, HOME, { kb: [12] }) },
    // (Where the fit's top-up for a group short of 2 sets goes changed with 1.13's rules: this
    // person's Monday would gain a seated brace without the epoch.)
    seated76: { age: 76, conditions: ['seated'], goals: ['strength'], experience: 'onoff', recentActivity: 'none', days: 2, minutes: 20, where: 'gym', gym: B.gymPreset('full', 'kg'), units: 'kg', weightKg: 75, equipment: HOME },
  };
  const V112 = {
    osteo65: { '2026-09-14': ['09-14 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_db sq_sts_power curl_hammer hg_deadlift tri_skull rear_towel press_db ab_deadbug', '09-16 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_db sq_sts curl_hammer rear_towel tri_skull press_db side_knee', '09-18 chest+legs+back+arms+abs: bal_tandem_wall get_halfkneel push_wall row_db sq_sts curl_hammer ham_walkout tri_skull co_wall_plank'], '2026-09-21': ['09-21 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_db sq_sts_power curl_hammer gl_bridge rear_towel tri_skull press_db side_knee', '09-23 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_db sq_sts curl_hammer tri_skull press_db co_wall_plank', '09-25 chest+legs+back+arms+abs: bal_tandem_wall get_halfkneel push_wall row_db sq_sts curl_hammer hg_deadlift tri_skull rear_towel ab_deadbug'], '2026-09-28': ['09-28 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_db sq_sts_power curl_hammer ham_walkout rear_towel back_birddog tri_skull co_wall_plank', '09-30 chest+legs+back+arms+shoulders+abs: bal_tandem_wall~ sq_sts curl_hammer hg_deadlift tri_skull row_db press_db ab_deadbug', '10-02 chest+legs+back+arms+abs: bal_tandem_wall~ get_halfkneel~ push_wall row_db chest_press gl_bridge sq_sts curl_hammer rear_towel tri_skull side_knee'] },
    gym62: { '2026-09-14': ['09-14 arms: bal_tandem curl_bb pushdown_cable', '09-15 legs+back+chest: squat_bb pulldown rdl_bb row_cable bench_bb', '09-17 legs+back+shoulders: bal_tandem squat_bb pulldown thrust_bb row_cable ohp_db raise_cable', '09-18 back+abs: pulldown row_cable cable_crunch side_knee'], '2026-09-21': ['09-21 arms: bal_tandem curl_bb pushdown_cable', '09-22 legs+back+chest: squat_bb pulldown thrust_bb row_cable bench_bb', '09-24 legs+back+shoulders: bal_tandem squat_bb pulldown lunge_db row_cable ohp_db raise_cable', '09-25 back+abs: pulldown row_cable cable_crunch rot_russian'], '2026-09-28': ['09-28 arms: bal_tandem curl_bb pushdown_cable', '09-29 legs+back+chest: squat_bb pulldown lunge_db row_cable calf_smith face_pull bench_bb fly_cable', '10-01 legs+back+shoulders: bal_tandem~ squat_bb pulldown rdl_bb row_cable calf_smith ohp_db raise_cable', '10-02 back+abs: pulldown row_cable cable_crunch rot_russian'] },
    balance78: { '2026-09-14': ['09-14 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_door sq_sts_hands curl_towel rear_towel tri_dip_bent press_pike_incline abl_crunch', '09-16 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_door sq_sts_hands curl_towel tri_dip_bent press_pike_incline rot_russian', '09-18 chest+legs+back+arms+abs: bal_tandem_wall get_halfkneel push_wall row_door sq_sts_hands curl_towel ham_walkout tri_dip_bent ab_deadbug'], '2026-09-21': ['09-21 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_door sq_sts_hands curl_towel tri_dip_bent press_pike_incline rot_russian', '09-23 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_door sq_sts_hands curl_towel rear_towel tri_dip_bent ab_deadbug', '09-25 chest+legs+back+arms+abs: bal_tandem_wall get_halfkneel push_wall row_door sq_sts_hands curl_towel hg_bridge tri_dip_bent side_knee'], '2026-09-28': ['09-28 chest+legs+back+arms+shoulders+abs: bal_tandem_wall push_wall row_door sq_sts_hands tri_dip_bent ham_walkout rear_towel press_pike_incline ab_deadbug rot_russian', '09-30 chest+legs+back+arms+shoulders+abs: bal_tandem_wall~ push_wall sq_sts_hands curl_towel hg_bridge tri_dip_bent', '10-02 chest+legs+back+arms+abs: bal_tandem_wall~ get_halfkneel~ sq_sts_hands row_door gl_bridge rear_towel back_birddog tri_dip_bent abl_crunch'] },
    arms70: { '2026-09-14': ['09-14 arms+back+shoulders+abs: bal_tandem_wall curl_towel rear_towel tri_oh row_db back_birddog press_pike_incline raise_wall_iso ab_deadbug side_knee', '09-17 arms+chest+legs+abs: bal_tandem_wall get_halfkneel curl_towel sq_sts_power tri_oh hg_deadlift push_wall rot_russian'], '2026-09-21': ['09-21 arms+back+shoulders+abs: bal_tandem_wall curl_towel rear_towel tri_oh row_db back_birddog press_pike_incline raise_wall_iso rot_russian', '09-24 arms+chest+legs+abs: bal_tandem_wall get_halfkneel curl_towel sq_sts_power tri_oh gl_bridge push_wall ab_deadbug'], '2026-09-28': ['09-28 arms+back+shoulders+abs: bal_tandem_wall curl_towel rear_towel tri_oh row_db back_birddog press_pike_incline ab_deadbug rot_russian', '10-01 arms+chest+legs+abs: bal_tandem_wall~ get_halfkneel~ curl_towel sq_sts_power! tri_oh push_wall ham_walkout abl_crunch side_knee'] },
    seated76: { '2026-09-14': ['09-14 chest+arms+shoulders: bal_seat_reach press_machine curl_towel tr_self ohp_db', '09-17 legs+back+abs: bal_seat_reach leg_press pulldown hp_seat_hinge row_cable co_seat_brace'], '2026-09-21': ['09-21 chest+arms+shoulders: bal_seat_reach press_machine curl_towel tr_self ohp_db sh_seat_arm', '09-24 legs+back+abs: bal_seat_reach leg_press pulldown hp_seat_hinge row_cable co_seat_brace'], '2026-09-28': ['09-28 chest+arms+shoulders: bal_seat_reach press_machine curl_towel tr_self ohp_db', '10-01 legs+back+abs: bal_seat_reach~ leg_press pulldown ls_march row_cable co_seat_brace'] },
  };
  const real = Date.now;
  {
    // A 1.12 state: no rulesFrom. The migration starts the rules the week after it first runs.
    const S = person({ age: 65, goals: ['legs'], days: 3 }, D0 - 14);
    delete S.rulesFrom;
    Date.now = () => (D0 + 2) * B.DAY_MS + 12 * 3600000;
    for (const fn of GH.migrations || []) fn(S);
    Date.now = real;
    check('the migration starts the new rules the week after it first runs', S.rulesFrom === D0 + 7, S.rulesFrom);
    const once = S.rulesFrom;
    for (const fn of GH.migrations || []) fn(S);
    check('and only once', S.rulesFrom === once);
    check('a new state has them from its first week', person({ age: 65 }).rulesFrom === B.weekStart(D0) && person({ age: 65 }, D0 + 3).rulesFrom === D0);
  }
  const mark = (it) => `${it.moveId}${it.power ? '!' : ''}${it.skill ? '~' : ''}`;
  const digest = (S, cal, ws) => cal.weeks[ws].sessions.filter((x) => !x.dropped && x.day != null).map((x) => {
    const log = S.log.find((l) => l.type === 'workout' && l.day === x.day);
    const items = log ? log.items.map((it) => it.moveId) : B.buildSession(S, x.day, x.tpl, { cal, noReadiness: true }).items.map(mark);
    return `${B.dayStr(x.day).slice(5)} ${x.units.join('+')}: ${items.join(' ')}`;
  });
  const legDays = (S, cal, ws) => cal.weeks[ws].sessions.filter((x) => !x.dropped && x.day != null && x.units.includes('legs')).map((x) => B.buildSession(S, x.day, x.tpl, { cal, noReadiness: true }));
  const fastDays = (list) => list.filter((s) => s.items.some((it) => it.power)).length;
  for (const [name, p] of Object.entries(PEOPLE)) {
    // Two weeks done under 1.12's rules and this week begun (Monday and Tuesday), 1.13 arriving on
    // Wednesday: the rules start next Monday, D0 + 7.
    const S = B.newState(Object.assign({ units: 'lb', weightKg: 75 }, p), null, D0 - 14);
    S.rulesFrom = D0 + 7;
    for (let d = D0 - 14; d < D0 + 2; d++) {
      const plan = B.todayPlan(S, d);
      if (plan.type === 'workout') {
        B.startWorkout(S, d, { now: d * B.DAY_MS + 17 * 3600000 });
        for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 800; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); }
        B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 18 * 3600000 });
      } else if (plan.type === 'light') { B.logLight(S, d, 'walk', true); B.logLight(S, d, 'mobility', true); }
    }
    const cal = B.calendar(S, D0 + 2);
    const got = {};
    for (const ws of [D0 - 14, D0 - 7, D0]) got[B.dayStr(ws)] = digest(S, cal, ws);
    check(`${name}: the weeks before replay exactly as 1.12 planned them`, JSON.stringify(got) === JSON.stringify(V112[name]), JSON.stringify(got).slice(0, 600));
    const before = legDays(S, cal, D0), after = legDays(S, B.calendar(S, D0 + 7), D0 + 7);
    if (GH.access.powerPlan(S.profile)) check(`${name}: from next week every leg day is fast on the way up (this week, ${fastDays(before)} of ${before.length})`, after.length > 0 && fastDays(after) === after.length && fastDays(before) <= 1, { before: fastDays(before), after: `${fastDays(after)}/${after.length}` });
    else check(`${name}: seated, no fast reps before or after`, !fastDays(before) && !fastDays(after) && after.length > 0);
  }
}

/* ------------------------------------------------------------------ caches */
section('Caches');
{
  const S = person({ goals: ['chest'], days: 3, minutes: 30 });
  const c1 = B.calendar(S, D0), c2 = B.calendar(S, D0);
  check('the calendar is kept for the same state (and frozen under test)', c1 === c2 && Object.isFrozen(c1) && Object.isFrozen(c1.weeks[D0].sessions[0]));
  let threw = false;
  try { c1.weeks[D0].sessions[0].day = 0; } catch (e) { threw = true; }
  check('changing a kept answer throws (strict mode, frozen)', threw);
  const w1 = O.weekPlan(S, D0), w2 = O.weekPlan(S, D0);
  check('the week plan is kept too, and frozen', w1 === w2 && Object.isFrozen(w1.days[0].groupSets));
  const x = c1.weeks[D0].sessions[0];
  const s1 = B.buildSession(S, x.day, x.tpl, {});
  s1.items[0].sets = 99;
  const s2 = B.buildSession(S, x.day, x.tpl, {});
  check('sessions come back as fresh copies: changing one leaves the next alone', s2.items[0].sets !== 99);
  S.vol.chest += 2;
  const w3 = O.weekPlan(S, D0);
  check('a change to the state plans the week again', w3 !== w1 && w3.perGroup.chest.target >= w1.perGroup.chest.target);
  S.pain.shoulder = D0 + 10;
  const c3 = B.calendar(S, D0);
  check('so does a joint on a break', c3 !== c1);
}

/* ------------------------------------------------------------------ kept across launches */
section('Kept across launches: the plan in the state');
{
  // Today is the Thursday of D0's week, a workout day; the app keeps plans (it has GH.BUILD), so
  // these turn it on.
  const realNow = Date.now;
  Date.now = () => (D0 + 3) * B.DAY_MS + 12 * 3600000;
  const wasKeep = O.keep(true);
  const day = D0 + 3;
  // Workouts done as test/fixtures.mjs does them: every step, some sets easy and some hard.
  const train = (S, from, to, skip) => {
    for (let d = from; d < to; d++) {
      const plan = B.todayPlan(S, d);
      if (plan.type !== 'workout' || skip.includes(d)) continue;
      B.startWorkout(S, d, { now: d * B.DAY_MS + 17 * 3600000 });
      for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) {
        const st = S.active.steps[S.active.idx];
        B.completeStep(S, st.kind === 'test' ? { value: st.side === 'L' ? 14 : 15 } : {});
        if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 4 === 0 ? '3' : '12');
      }
      B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 17.5 * 3600000 });
    }
  };
  // What a launch asks for first: the calendar, today's session and this week's plan (`now`), and
  // last week's sets (`last`, for the insights).
  const launch = (S) => {
    const cal = B.calendar(S, day);
    const plan = B.todayPlan(S, day, cal);
    const s = plan.type === 'workout' ? B.buildSession(S, day, plan.tpl, { cal }) : null;
    const wp = O.weekPlan(S, D0, { phase: cal.weeks[D0].phase });
    return { now: JSON.stringify({ type: plan.type, tpl: plan.tpl, s, days: wp.days, perGroup: wp.perGroup, score: wp.score, split: wp.split }), last: JSON.stringify(B.weeklySets(S, D0 - 1)) };
  };
  // A launch in a fresh process: the saved state, nothing worked out in memory.
  const relaunch = (json, change) => { O.clearCache(); const S = JSON.parse(json); if (change) change(S); const st = Object.assign({}, O.stats); return Object.assign({ S, st }, launch(S)); };
  const did = (st, k) => O.stats[k] - st[k];
  const fresh = (json, change) => { O.keep(false); const r = relaunch(json, (S) => { delete S.planCache; if (change) change(S); }); O.keep(true); return r; };

  // (Last Friday's workout missed, and not made up at the weekend: last week's sets then also come
  // from its plan.)
  const S = person({ goals: ['abs', 'arms', 'chest', 'legs'], days: 4, minutes: 25 }, D0 - 14);
  train(S, D0 - 14, day, [D0 - 3, D0 - 2, D0 - 1]);
  const first = launch(S);
  const pc = S.planCache;
  check('today is a workout day, two weeks in', JSON.parse(first.now).type === 'workout' && JSON.parse(first.now).s.items.length > 0);
  check('a launch keeps its split, week plans, today\'s session and last week\'s sets in the state', !!pc && pc.splits.length === 1 && pc.weeks.length >= 2 && pc.sessions.length === 1 && pc.sets.length === 1, pc && { splits: pc.splits.length, weeks: pc.weeks.length, sessions: pc.sessions.length, sets: pc.sets.length });
  check('only so much: at most 3 weeks, 3 sessions, under 25 KB', pc.weeks.length <= 3 && pc.sessions.length <= 3 && JSON.stringify(pc).length < 25000, JSON.stringify(pc).length);
  const json = JSON.stringify(S);
  const f0 = fresh(json);
  check('what it worked out afresh is what it keeps', first.now === f0.now && first.last === f0.last);

  const a = relaunch(json);
  check('the next launch plans nothing again: the split and the week come from the state', did(a.st, 'splits') === 0 && did(a.st, 'weeks') === 0 && did(a.st, 'keptSplits') === 1 && did(a.st, 'keptWeeks') >= 1, { splits: did(a.st, 'splits'), weeks: did(a.st, 'weeks') });
  check('and gives the same plan, session and sets', a.now === first.now && a.last === first.last);

  const kit = (S) => { S.profile.equipment = Object.assign({}, S.profile.equipment, { band: true, door: true }); };
  const b = relaunch(json, kit);
  check('a changed answer (new kit) plans the split and the week again, as it would afresh', did(b.st, 'splits') === 1 && did(b.st, 'weeks') >= 1 && b.now === fresh(json, kit).now);
  const minutes = (S) => { B.updateSettings(S, day, { minutes: 35 }); };
  const c = relaunch(json, minutes);
  check('so do new minutes from today: the week is planned again', did(c.st, 'weeks') >= 1 && c.now === fresh(json, minutes).now && c.now !== first.now);
  const screen = (S) => { S.profile.prefs.figure = 'flat'; S.profile.prefs.theme = 'dark'; S.profile.prefs.haptics = false; };
  const d = relaunch(json, screen);
  check('preferences only the screens read (the figure, the theme, haptics) keep it all', did(d.st, 'splits') === 0 && did(d.st, 'weeks') === 0 && d.now === first.now);
  GH.BUILD = 'another-build';
  const e = relaunch(json);
  delete GH.BUILD;
  check('another build of the app works it all out again, and keeps its own', did(e.st, 'splits') === 1 && did(e.st, 'weeks') >= 1 && e.now === first.now && e.last === first.last && e.S.planCache.v.startsWith('another-build'));
  const f = relaunch(json, (S) => { S.planCache.weeks.forEach((x) => { x.v = { days: 'no' }; }); S.planCache.splits[0].v.days = null; S.planCache.sets.forEach((x) => { x.v = { chest: 'no' }; }); });
  check('a kept answer that isn\'t one is worked out again', did(f.st, 'splits') === 1 && did(f.st, 'weeks') >= 1 && f.now === first.now && f.last === first.last);
  const g = relaunch(json, (S) => { S.planCache = 'garbage'; });
  check('and so is a cache that isn\'t one', g.now === first.now && g.last === first.last && Array.isArray(g.S.planCache.weeks));

  // A week that's over keeps what it last had planned: a later change plans this week again, and
  // last week stays as it was.
  const more = (S) => { S.vol.chest += 2; };
  const h = relaunch(json, more);
  check('a change plans this week again', did(h.st, 'weeks') >= 1 && JSON.parse(h.now).perGroup.chest.target > JSON.parse(first.now).perGroup.chest.target);
  const goals = (S) => { S.profile.goals = ['back', 'shoulders', 'legs']; };
  const h2 = relaunch(json, goals);
  check('but last week keeps the sets it was planned (new goals would change them, worked out afresh)', h2.last === first.last && fresh(json, goals).last !== first.last && h2.now !== first.now, { kept: h2.last, afresh: fresh(json, goals).last });
  const sets0 = JSON.parse(first.last);
  const drop = (S) => { S.log = S.log.filter((l) => l.day < D0 - 7 || l.day >= D0); };
  const gone = relaunch(json, drop);
  check('a change to last week\'s workouts plans it again: what\'s done comes from the log', B.GROUPS.some((q) => sets0[q].done > 0) && B.GROUPS.every((q) => JSON.parse(gone.last)[q].done === 0) && gone.last === fresh(json, drop).last && did(gone.st, 'weeks') >= 2);

  // A history built day by day while the clock is past it (as the tests' fixtures build theirs):
  // each week is planned again as its workouts are done, as it would be without keeping.
  const gear = { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true };
  const built = (on) => {
    O.keep(on);
    O.clearCache();
    const T = person({ goals: ['abs', 'arms', 'chest', 'legs'], days: 4, minutes: 25, equipment: Object.assign({}, HOUSE, gear) }, D0 - 35);
    train(T, D0 - 35, D0 - 2, [D0 - 17]);
    O.keep(true);
    return JSON.stringify(T.log) + JSON.stringify(T.prog) + JSON.stringify(T.vol);
  };
  check('a history built day by day comes out the same as without keeping', built(true) === built(false));

  // Copies keep plans of their own: what's tried on one never takes the place of the state's.
  const S2 = JSON.parse(json);
  O.clearCache();
  launch(S2);
  const kept = JSON.stringify(S2.planCache);
  O.alternatives(S2, D0);
  O.applyTweaks(S2, { sets: { chest: 2 }, split: 'ppl' }, day);
  check('trying other splits and tweaks leaves the state\'s kept plans alone', JSON.stringify(S2.planCache) === kept);

  O.keep(false);
  const T = person({ goals: ['abs'], days: 3 });
  B.buildSession(T, D0 + 2, 0, {});
  B.weeklySets(T, D0 - 1);
  check('without keeping (tests, a plain page), nothing goes in the state', !('planCache' in T));
  check('a reset starts from a new state, with nothing kept', !('planCache' in B.newState({ goals: ['abs'] }, null, D0)));

  // Backups leave the kept plans out, a restore doesn't take any in, and a reset forgets what this
  // session worked out too.
  const store = load('src/store.js').store;
  const withCache = JSON.parse(json);
  const backup = JSON.parse(store.exportJson(withCache));
  check('a backup leaves the kept plans out (the state keeps them)', !('planCache' in backup.state) && !!withCache.planCache && backup.state.log.length === withCache.log.length);
  const restored = store.importJson(JSON.stringify({ app: 'gradient-health', schema: store.SCHEMA, state: withCache }));
  check('a restored backup works its plans out again rather than take them on trust', restored.ok && !('planCache' in restored.state));
  const pr = B.programFor(S.profile);
  O.clearCache();
  const n0 = O.stats.splits;
  O.split(S.profile, pr);
  O.split(S.profile, pr);
  const n1 = O.stats.splits;
  store.clear();
  O.split(S.profile, pr);
  check('a reset (store.clear) forgets the splits worked out this session', n1 - n0 === 1 && O.stats.splits - n1 === 1);
  O.keep(wasKeep);
  Date.now = realNow;
}

/* ------------------------------------------------------------------ timing */
section('Timing');
{
  // Warm up, then time a week's plan for many new states (each a different person or a state after a
  // workout) and many sessions with their week planned.
  const plans = [], builds = [];
  const kits = [HOUSE, Object.assign({}, HOUSE, { db: [10, 20] }), Object.assign({}, HOUSE, { band: true, door: true })];
  let k = 0;
  for (const goals of [['abs', 'arms'], ['strength'], ['legs', 'chest'], ['fat', 'consistency'], ['back', 'shoulders', 'legs']]) {
    for (let days = 2; days <= 6; days++) {
      for (const minutes of [15, 30, 45, 60]) {
        const S = person({ goals, days, minutes, equipment: kits[k++ % kits.length] });
        const cal = B.calendar(S, D0 + 14);
        O.weekPlan(S, D0 + 14, { phase: cal.weeks[D0 + 14].phase });
        S.vol[B.GROUPS[k % 7]] += 1; // as after a workout: a new state, the split already known
        const cal2 = B.calendar(S, D0 + 14);
        const t0 = performance.now();
        O.weekPlan(S, D0 + 14, { phase: cal2.weeks[D0 + 14].phase });
        plans.push(performance.now() - t0);
        for (const x of cal2.weeks[D0 + 14].sessions) {
          const t1 = performance.now();
          B.buildSession(S, x.day, x.tpl, { cal: cal2 });
          builds.push(performance.now() - t1);
        }
      }
    }
  }
  const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  check(`a week's plan for a new state takes 50 ms or less (${plans.length} plans, p95 ${q(plans, 0.95).toFixed(1)} ms, max ${Math.max(...plans).toFixed(1)} ms)`, q(plans, 0.95) <= 50);
  check(`buildSession p95 is 3 ms or less with its week planned (${builds.length} builds, ${q(builds, 0.95).toFixed(2)} ms)`, q(builds, 0.95) <= 3);
}

done();
