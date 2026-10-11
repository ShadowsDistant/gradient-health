/* Badges: the definitions, when each is earned, and the earned dates kept for good (GH.achievements).
 *
 * Pure functions over a state S, like the brain: nothing here reads the clock unless a caller leaves
 * out `now`, so tests can drive any timeline. src/ui/badges.js draws the medals and decides when to
 * celebrate.
 *
 * S.achievements = { v: 2, earned: { [id]: { day, at, opened, value?, approx? } }, events: { [name]:
 * { day, at, n } }, seenAt, migrated: { at, n, seen? } }. A badge, once earned, is never taken away:
 * a streak that breaks or a log that's deleted leaves it where it is. `day` is the day it was earned
 * (worked out from history where it can be: the 10th workout's day, the day a streak reached 7);
 * `approx` marks one whose day history can't tell (it then says the day it was found). Badges earned
 * after `seenAt` haven't been shown yet. A new badge arrives sealed (`opened: false`) and is opened
 * in the reveal, src/ui/badges.js; sealed or opened, it's earned all the same. Every badge earned
 * before badges came sealed (the record's v 1, without opened) counts as opened.
 *
 * Everything a definition needs is worked out once per check by ctx(S, day), in sections that are
 * only computed when a definition asks (a check for food badges never replays the calendar).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const asc = (a, b) => a - b;

  /* ---------------------------------------------------------------- tiers and categories */
  // Metal for the medal's rim (dark edge, body, light, highlight) and a rarity word for the reveal.
  const TIERS = {
    bronze: { id: 'bronze', name: 'Bronze', rank: 1, rarity: 'Common', metal: ['#6e3b14', '#b87333', '#e0a577', '#f9dcb8'] },
    silver: { id: 'silver', name: 'Silver', rank: 2, rarity: 'Uncommon', metal: ['#5f6873', '#9aa4ae', '#e6ebf0', '#ffffff'] },
    gold: { id: 'gold', name: 'Gold', rank: 3, rarity: 'Rare', metal: ['#7d5604', '#c9971c', '#ffe08a', '#fff6cf'] },
    platinum: { id: 'platinum', name: 'Platinum', rank: 4, rarity: 'Very rare', metal: ['#6f7fb8', '#a1c4fd', '#c2e9fb', '#e0c3fc'] },
  };
  const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];
  // Each category has a medal shape and an enamel colour (light, body, deep) for the medal's face.
  // `workouts`: only shown while workouts are tracked (earned ones always show).
  const CATS = [
    { id: 'consistency', name: 'Consistency', shape: 'circle', enamel: ['#ffa36b', '#e4471f', '#761705'], workouts: true },
    { id: 'workouts', name: 'Workouts', shape: 'hexagon', enamel: ['#9aa6ff', '#4357d6', '#1f2a82'], workouts: true },
    { id: 'strength', name: 'Strength', shape: 'shield', enamel: ['#ff9a7f', '#cc4330', '#6d1b10'], workouts: true },
    { id: 'body', name: 'Body', shape: 'hexagon', enamel: ['#6fe0d4', '#0f8a84', '#044340'], workouts: true },
    { id: 'moments', name: 'Moments', shape: 'star', enamel: ['#c8a2ff', '#7d44cc', '#3d1a73'], workouts: true },
    { id: 'activities', name: 'Activities', shape: 'square', enamel: ['#7fe0a2', '#1f8a4a', '#0b4022'] },
    { id: 'health', name: 'Health', shape: 'circle', enamel: ['#ff8fb4', '#c92e68', '#6a0f33'] },
    { id: 'food', name: 'Food', shape: 'square', enamel: ['#d4ec7a', '#79a51c', '#35500a'] },
    { id: 'plans', name: 'Plans', shape: 'shield', enamel: ['#7fd0ff', '#1279b8', '#063f63'], workouts: true },
    { id: 'start', name: 'Getting started', shape: 'star', enamel: ['#8ff5df', '#13a891', '#05503f'] },
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));

  /* ---------------------------------------------------------------- small helpers */
  // The day of the n-th entry of a sorted list of days (1-based), or null.
  const nth = (days, n) => (days.length >= n ? days[n - 1] : null);
  // The day a running total of [day, value] pairs (sorted by day) first reaches n, or null.
  function crossing(pairs, n) {
    let t = 0;
    for (const [d, v] of pairs) { t += v; if (t >= n) return d; }
    return null;
  }
  const total = (pairs) => pairs.reduce((a, p) => a + p[1], 0);
  // Runs of consecutive days in a sorted list of distinct days: the best run, and the day each run
  // length in `want` was first reached.
  function runs(days, want) {
    const at = {};
    let run = 0, best = 0, prev = null;
    for (const d of days) {
      run = prev != null && d === prev + 1 ? run + 1 : 1;
      prev = d;
      if (run > best) best = run;
      for (const n of want) if (run >= n && at[n] == null) at[n] = d;
    }
    return { best, at };
  }
  const uniq = (days) => [...new Set(days.filter(num))].sort(asc);
  const once = (fn) => { let done = false, v; return () => (done ? v : ((done = true), (v = fn()))); };
  const hourOf = (ts) => (num(ts) ? new Date(ts).getHours() : null);
  const minutesOf = (l) => (num(l.startedAt) && num(l.endedAt) && l.endedAt > l.startedAt ? (l.endedAt - l.startedAt) / 60000 : null);
  const rollOf = (S) => (S && S.profile && S.profile.prefs && num(S.profile.prefs.rollHour) ? S.profile.prefs.rollHour : 4);
  const STRICT_PUSH = ['push_std', 'push_slow', 'push_pause', 'push_decline', 'push_archer']; // full push-ups and harder
  const PULLUPS = ['pull_chin', 'pull_up', 'pull_slow']; // a real pull-up or chin-up, not a hang or a negative

  /* ---------------------------------------------------------------- what history says */
  // Every section reads history up to the day being checked, never past it, so a day can be looked
  // at as it was then.
  // Workout logs the person checked in, by day (the done ones count for streaks and totals; any
  // checked-in one counts for a best set or a new level).
  function logsOf(S, day) {
    return (Array.isArray(S.log) ? S.log : []).filter((l) => l && l.type === 'workout' && l.checkedIn && num(l.day) && l.day <= day).sort((a, b) => a.day - b.day);
  }
  // Streaks from the calendar replay: each day's done (a workout or a walk-and-stretch day) adds one
  // and a broken day starts again, as the replay itself counts; full weeks in a row from its weeks.
  function timeline(S, day, cal) {
    const out = { streak: {}, best: 0, weeks: {}, weekBest: 0, perfect: null };
    const start = S.profile && S.profile.startDay;
    if (!num(start) || !cal) return out;
    let s = 0;
    for (let d = start; d <= day; d++) {
      const i = cal.days[d];
      if (!i) continue;
      if (i.done) {
        s++;
        if (s > out.best) { out.best = s; for (const n of [3, 7, 30, 100]) if (s === n) out.streak[n] = d; }
      } else if (i.broken) s = 0;
    }
    const b = B();
    const cur = b.weekStart(day);
    let w = 0;
    for (let ws = b.weekStart(start); ws <= cur; ws += 7) {
      const week = cal.weeks[ws];
      const all = !!(week && week.allDone);
      // This week counts once all its workouts are done; until then it doesn't break the run.
      if (ws === cur && !all) break;
      w = all ? w + 1 : 0;
      if (w > out.weekBest) {
        out.weekBest = w;
        const last = Math.max(...week.sessions.map((x) => (num(x.day) ? x.day : ws)));
        for (const n of [4, 12, 26]) if (w === n) out.weeks[n] = Math.min(day, last);
      }
      // A perfect week: every workout and every walk-and-stretch day done, the whole week since the
      // start, and over (or done to its last day).
      if (out.perfect == null && ws >= start && ws + 6 <= day) {
        let ok = true, any = false;
        for (let d = ws; d < ws + 7 && ok; d++) {
          const i = cal.days[d] || {};
          if (i.planned === 'workout' || i.missed) { ok = !!i.done; any = any || ok; } else if (i.planned === 'light') ok = !!i.done;
        }
        if (ok && any) out.perfect = ws + 6;
      }
    }
    return out;
  }
  function workoutStats(S, logs) {
    const b = B();
    const done = logs.filter((l) => b.isDone(l));
    const days = done.map((l) => l.day);
    const set = new Set(days);
    const out = { days, sets: [], mins: [], short: [], comeback: null, early: null, owl: null, full: null, newYear: null, weekend: null };
    let prev = null;
    for (const l of done) {
      out.sets.push([l.day, num(l.doneSets) ? l.doneSets : 0]);
      const m = minutesOf(l);
      if (m != null) out.mins.push([l.day, Math.min(180, m)]);
      if (prev != null && l.day - prev > 14 && out.comeback == null) out.comeback = l.day;
      prev = l.day;
      // Before 8 in the morning (from 4, when the day starts), or from 9 at night.
      const h = hourOf(l.startedAt);
      if (h != null && h >= 4 && h < 8 && out.early == null) out.early = l.day;
      if (h != null && (h >= 21 || h < 4) && out.owl == null) out.owl = l.day;
      if (m != null && m >= 60 && m <= 240 && out.full == null) out.full = l.day;
      if (l.short) out.short.push(l.day);
      if (out.newYear == null && b.dayStr(l.day).slice(5) === '01-01') out.newYear = l.day;
      if (out.weekend == null && ((l.day + 3) % 7 + 7) % 7 === 6 && set.has(l.day - 1)) out.weekend = l.day; // a Sunday after a Saturday
    }
    return out;
  }
  function strengthStats(logs) {
    const MV = M();
    const out = { ups: [], prs: [], heavier: null, top: null, pullup: null, push20: null };
    const low = {}; // the lowest rung done so far, per ladder
    for (const l of logs) {
      for (const c of Array.isArray(l.celebrate) ? l.celebrate : []) {
        if (!c) continue;
        if (c.kind === 'pr') out.prs.push(l.day);
        else if (c.kind === 'weight' || c.kind === 'level') out.ups.push(l.day);
        if (c.kind === 'weight' && out.heavier == null) out.heavier = l.day;
      }
      for (const it of Array.isArray(l.items) ? l.items : []) {
        if (!it || !Array.isArray(it.sets) || !it.sets.length || typeof it.moveId !== 'string') continue;
        const id = it.moveId;
        const reps = it.sets.reduce((a, x) => Math.max(a, x && num(x.amount) ? x.amount : 0), 0);
        if (out.pullup == null && !it.timed && PULLUPS.includes(id) && reps >= 1) out.pullup = l.day;
        if (out.push20 == null && !it.timed && STRICT_PUSH.includes(id) && reps >= 20) out.push20 = l.day;
        // The top of a ladder: its last move done, after climbing at least two of its rungs (someone
        // who starts near the top hasn't climbed it). Gym ladders are kinds of machine, not steps up.
        const mv = MV && own(MV.MOVES, id) ? MV.MOVES[id] : null;
        const fam = (mv && mv.family) || it.fam;
        const lad = typeof fam === 'string' && !/G$/.test(fam) && MV && own(MV.LADDERS, fam) ? MV.LADDERS[fam] : null;
        const i = lad ? lad.rungs.indexOf(id) : -1;
        if (i < 0) continue;
        if (out.top == null && i === lad.rungs.length - 1 && low[fam] != null && low[fam] <= i - 2) out.top = l.day;
        low[fam] = low[fam] == null ? i : Math.min(low[fam], i);
      }
    }
    return out;
  }
  function bodyStats(S, logs, day) {
    const b = B(), MV = M();
    const GROUPS = b.GROUPS;
    const weeks = new Map();
    let all = null, bestGroups = 0;
    const full = []; // weeks that trained every group, in order
    for (const l of logs) {
      const ws = b.weekStart(l.day);
      let w = weeks.get(ws);
      if (!w) weeks.set(ws, (w = { g: new Set(), day: null }));
      for (const it of Array.isArray(l.items) ? l.items : []) {
        if (!it || !Array.isArray(it.sets) || !it.sets.length) continue;
        const g = it.group || (MV && own(MV.MOVES, it.moveId) ? MV.MOVES[it.moveId].group : null);
        if (GROUPS.includes(g)) w.g.add(g);
      }
      bestGroups = Math.max(bestGroups, w.g.size);
      if (w.day == null && w.g.size >= GROUPS.length) { w.day = l.day; full.push(ws); if (all == null) all = l.day; }
    }
    let run = 0, prev = null, all4 = null, best4 = 0;
    for (const ws of full) {
      run = prev != null && ws === prev + 7 ? run + 1 : 1;
      prev = ws;
      best4 = Math.max(best4, run);
      if (run >= 4 && all4 == null) all4 = weeks.get(ws).day;
    }
    // Left and right evened out: a test within 10% after one that wasn't.
    let even = null;
    for (const k of ['arm', 'leg']) {
      const tests = (S.catchup && S.catchup[k] && Array.isArray(S.catchup[k].tests) ? S.catchup[k].tests : []).filter((t) => t && num(t.day) && num(t.gap) && t.day <= day).sort((a, z) => a.day - z.day);
      let gap = false;
      for (const t of tests) {
        if (t.gap >= 0.1) gap = true;
        else if (gap) { if (even == null || t.day < even) even = t.day; break; }
      }
    }
    const mob = [], both = [];
    for (const l of Array.isArray(S.log) ? S.log : []) {
      if (!l || l.type !== 'light' || !num(l.day) || l.day > day) continue;
      if (l.mobility) mob.push(l.day);
      if (l.walk && l.mobility) both.push(l.day);
    }
    return { all, bestGroups, all4, best4, even, mob: uniq(mob), both: uniq(both) };
  }
  // Outdoor activities of a minute or more, oldest first.
  function activityStats(S, day) {
    const list = (Array.isArray(S.activities) ? S.activities : []).filter((a) => a && num(a.day) && a.day <= day && num(a.start) && a.movingMs >= 60000).sort((a, z) => a.start - z.start);
    const out = { first: null, k5: null, k10: null, half: null, km100: null, record: null, climb: null, longestRun: 0, totalM: 0, maxClimb: 0 };
    for (const a of list) {
      if (out.first == null) out.first = a.day;
      const m = num(a.distanceM) ? a.distanceM : 0;
      // GPS reads a race a little short now and then: within 1% counts.
      if (a.type === 'run') {
        out.longestRun = Math.max(out.longestRun, m);
        if (out.k5 == null && m >= 4950) out.k5 = a.day;
        if (out.k10 == null && m >= 9900) out.k10 = a.day;
        if (out.half == null && m >= 20887) out.half = a.day;
      }
      out.totalM += m;
      if (out.km100 == null && out.totalM >= 100000) out.km100 = a.day;
      if (out.record == null && Array.isArray(a.records) && a.records.length) out.record = a.day;
      const g = a.elev && num(a.elev.gain) ? a.elev.gain : 0;
      out.maxClimb = Math.max(out.maxClimb, g);
      if (out.climb == null && g >= 500) out.climb = a.day;
    }
    return out;
  }
  function healthStats(S, live, day) {
    const h = S.health || {};
    const days = isObj(h.days) ? h.days : {};
    const keys = Object.keys(days).map(Number).filter((d) => num(d) && d <= day).sort(asc);
    const steps = keys.filter((d) => isObj(days[d]) && days[d].steps >= 10000);
    const sleep = keys.filter((d) => isObj(days[d]) && days[d].sleepMin >= 420);
    const st = runs(steps, [7]), sl = runs(sleep, [7]);
    const conn = (x) => x === 'granted' || x === 'partial';
    return {
      steps10k: steps.length ? steps[0] : null, stepsBest: st.best, stepsWeek: st.at[7] || null,
      sleepBest: sl.best, sleepWeek: sl.at[7] || null,
      weighIns: uniq((Array.isArray(S.weights) ? S.weights : []).filter((w) => w && w.src !== 'profile' && w.day <= day).map((w) => w.day)),
      measures: uniq((Array.isArray(S.measurements) ? S.measurements : []).filter((m) => isObj(m) && m.day <= day).map((m) => m.day)),
      connected: conn(live && live.hc) || conn(h.status) || num(h.lastSync),
    };
  }
  function foodStats(S, day) {
    const p = S.profile || {};
    const mode = (p.food && p.food.mode) || 'protein';
    const full = mode === 'full';
    const f = S.food || {};
    const fd = isObj(f.days) ? f.days : {};
    const logDays = Object.keys(fd).map(Number).filter((d) => num(d) && d <= day && Array.isArray(fd[d]) && fd[d].length).sort(asc);
    const logs = runs(logDays, [7, 30]);
    // Protein: the counter's adds, plus the protein in logged food when calorie tracking is on (as
    // brain.proteinToday), against the goal from the weight trend that day (brain.proteinGoal).
    // Today not hit yet doesn't end a run.
    const prot = isObj(S.protein) ? S.protein : {};
    const hcRead = !(p.food && p.food.hcRead === false);
    const eaten = (d) => {
      let g = 0;
      if (Array.isArray(prot[d])) for (const x of prot[d]) if (num(x)) g += x;
      if (full) {
        let fp = 0;
        if (Array.isArray(fd[d])) for (const e of fd[d]) if (e && num(e.p)) fp += e.p;
        const o = hcRead && isObj(f.other) ? f.other[d] : null;
        if (o && num(o.p)) fp += o.p;
        g += Math.round(fp);
      }
      return g;
    };
    const cand = Object.keys(prot).map(Number).filter((d) => num(d) && Array.isArray(prot[d]) && prot[d].length).concat(full ? logDays : []);
    const out = { mode, logBest: logs.best, log7: logs.at[7] || null, log30: logs.at[30] || null, protBest: 0, prot7: null, prot30: null };
    if (!cand.length) return out;
    const LB = B().LB_PER_KG;
    const perLb = (p.protein && num(p.protein.perLb) && p.protein.perLb) || 0.8;
    const ws = (Array.isArray(S.weights) ? S.weights : []).filter((w) => w && num(w.day) && num(w.kg) && w.kg > 0).sort((a, z) => a.day - z.day);
    let lo = 0, hi = 0, sum = 0, run = 0;
    for (let d = Math.min(...cand); d <= day; d++) {
      while (hi < ws.length && ws[hi].day <= d) sum += ws[hi++].kg;
      while (lo < hi && ws[lo].day < d - 6) sum -= ws[lo++].kg;
      const kg = hi > lo ? sum / (hi - lo) : hi ? ws[hi - 1].kg : p.weightKg;
      const goal = kg ? Math.round(perLb * kg * LB) : null;
      if (goal && eaten(d) >= goal * 0.95) {
        run++;
        if (run > out.protBest) out.protBest = run;
        if (run >= 7 && out.prot7 == null) out.prot7 = d;
        if (run >= 30 && out.prot30 == null) out.prot30 = d;
      } else if (d < day) run = 0;
    }
    return out;
  }
  function planStats(S, day) {
    const ev = S.achievements && isObj(S.achievements.events) ? S.achievements.events : {};
    const evDay = (k) => (own(ev, k) && isObj(ev[k]) && num(ev[k].day) && ev[k].day <= day ? ev[k].day : null);
    const roll = rollOf(S);
    // A plan of their own with at least one exercise in it; the day it was made (-1: not known).
    let mine = null;
    for (const p of Array.isArray(S.customPlans) ? S.customPlans : []) {
      if (!isObj(p) || p.source !== 'you' || !Array.isArray(p.days) || !p.days.some((d) => d && Array.isArray(d.items) && d.items.length)) continue;
      const d = num(p.createdAt) ? B().dayOf(p.createdAt, roll) : -1;
      if (d > day) continue;
      if (mine == null || (d >= 0 && (mine < 0 || d < mine))) mine = d;
    }
    // Tailor my plan keeps its own record in S.events, so tailoring before 1.6 counts too.
    let tailored = evDay('tailored');
    for (const e of Array.isArray(S.events) ? S.events : []) if (e && e.type === 'tailor' && num(e.day) && e.day <= day && (tailored == null || e.day < tailored)) tailored = e.day;
    return { mine, shared: evDay('sharedPlan'), tailored, reviewed: evDay('reviewed'), badge: evDay('sharedBadge') };
  }
  // Everything the definitions read, computed once per check and only when asked for.
  function ctx(S, day, live) {
    const p = S.profile || {};
    const x = { S, day, live: live || {}, p, workouts: p.workouts !== false };
    x.cal = once(() => (num(p.startDay) ? B().calendar(S, day) : null));
    x.logs = once(() => logsOf(S, day));
    x.tl = once(() => timeline(S, day, x.cal()));
    x.wk = once(() => workoutStats(S, x.logs()));
    x.lift = once(() => strengthStats(x.logs()));
    x.body = once(() => bodyStats(S, x.logs(), day));
    x.acts = once(() => activityStats(S, day));
    x.health = once(() => healthStats(S, live, day));
    x.food = once(() => foodStats(S, day));
    x.plans = once(() => planStats(S, day));
    return x;
  }

  /* ---------------------------------------------------------------- the badges */
  // ev(x) → { have, goal, day }: day is when it was reached (null: not yet; -1: reached, day unknown).
  const r = (have, goal, day) => ({ have: Math.max(0, Math.min(have, goal)), goal, day: day == null ? null : day });
  const done1 = (day) => r(day != null ? 1 : 0, 1, day);
  const count = (get, n) => (x) => { const d = get(x); return r(d.length, n, nth(d, n)); };
  const sum = (get, n, scale) => (x) => { const p = get(x); return r(Math.floor(total(p) / (scale || 1)), Math.round(n / (scale || 1)), crossing(p, n)); };
  const streak = (n) => (x) => r(x.tl().best, n, x.tl().streak[n]);
  const weeks = (n) => (x) => r(x.tl().weekBest, n, x.tl().weeks[n]);
  const foodOn = (x) => x.food().mode !== 'off';
  const foodFull = (x) => x.food().mode === 'full';
  // [id, category, tier, title, how to earn, glyph, ev, extra]. extra: ribbon (the number on the
  // medal), next (what "Next up" calls it), unit (how progress reads), secret, applies(x).
  const LIST = [
    // Consistency
    ['first', 'consistency', 'bronze', 'Day one', 'Finish your first workout.', 'play', (x) => done1(x.wk().days[0]), { next: 'your first workout' }],
    ['streak3', 'consistency', 'bronze', 'On a roll', 'Reach a 3-day streak.', 'flame', streak(3), { ribbon: '3', next: 'a 3-day streak', unit: 'days' }],
    ['streak7', 'consistency', 'silver', 'Week on fire', 'Reach a 7-day streak.', 'flame', streak(7), { ribbon: '7', next: 'a 7-day streak', unit: 'days' }],
    ['streak30', 'consistency', 'gold', 'Unstoppable', 'Reach a 30-day streak.', 'flame', streak(30), { ribbon: '30', next: 'a 30-day streak', unit: 'days' }],
    ['streak100', 'consistency', 'platinum', 'Triple digits', 'Reach a 100-day streak.', 'flame', streak(100), { ribbon: '100', next: 'a 100-day streak', unit: 'days' }],
    ['weeks4', 'consistency', 'silver', 'Full month', 'Do every workout, 4 weeks in a row.', 'calendar', weeks(4), { ribbon: '4', next: '4 full weeks', unit: 'weeks' }],
    ['weeks12', 'consistency', 'gold', 'Twelve strong', 'Do every workout, 12 weeks in a row.', 'calendar', weeks(12), { ribbon: '12', next: '12 full weeks', unit: 'weeks' }],
    ['weeks26', 'consistency', 'platinum', 'Iron habit', 'Do every workout, 26 weeks in a row.', 'calendar', weeks(26), { ribbon: '26', next: '26 full weeks', unit: 'weeks' }],
    ['comeback', 'consistency', 'bronze', 'Welcome back', 'Work out after two weeks or more off.', 'refresh', (x) => done1(x.wk().comeback)],
    ['weekendWarrior', 'consistency', 'bronze', 'Weekend warrior', 'Work out on both days of a weekend.', 'sun', (x) => done1(x.wk().weekend)],
    ['perfectWeek', 'consistency', 'silver', 'Perfect week', 'Do every workout and walk-and-stretch day in a week.', 'check-circle', (x) => done1(x.tl().perfect)],
    // Workouts
    ['w10', 'workouts', 'bronze', 'Ten down', 'Finish 10 workouts.', 'dumbbell', count((x) => x.wk().days, 10), { ribbon: '10', next: '10 workouts' }],
    ['w25', 'workouts', 'silver', 'Twenty-five', 'Finish 25 workouts.', 'dumbbell', count((x) => x.wk().days, 25), { ribbon: '25', next: '25 workouts' }],
    ['w50', 'workouts', 'gold', 'Fifty and counting', 'Finish 50 workouts.', 'dumbbell', count((x) => x.wk().days, 50), { ribbon: '50', next: '50 workouts' }],
    ['w100', 'workouts', 'gold', 'Centurion', 'Finish 100 workouts.', 'trophy', count((x) => x.wk().days, 100), { ribbon: '100', next: '100 workouts' }],
    ['w250', 'workouts', 'platinum', 'Lifer', 'Finish 250 workouts.', 'trophy', count((x) => x.wk().days, 250), { ribbon: '250', next: '250 workouts' }],
    ['sets500', 'workouts', 'silver', 'Set machine', 'Do 500 sets.', 'layers', sum((x) => x.wk().sets, 500), { ribbon: '500', next: '500 sets', unit: 'sets' }],
    ['sets2000', 'workouts', 'gold', 'Two thousand sets', 'Do 2,000 sets.', 'layers', sum((x) => x.wk().sets, 2000), { ribbon: '2K', next: '2,000 sets', unit: 'sets' }],
    ['hours10', 'workouts', 'silver', 'Ten hours in', 'Train 10 hours in the workout player.', 'hourglass', sum((x) => x.wk().mins, 600, 60), { ribbon: '10h', next: '10 hours', unit: 'h' }],
    ['hours50', 'workouts', 'gold', 'Fifty hours', 'Train 50 hours in the workout player.', 'hourglass', sum((x) => x.wk().mins, 3000, 60), { ribbon: '50h', next: '50 hours', unit: 'h' }],
    // Strength
    ['levelup', 'strength', 'bronze', 'Level up', 'Reach a harder move or a heavier weight.', 'arrow-up-right', count((x) => x.lift().ups, 1), { next: 'your first level-up' }],
    ['levelup10', 'strength', 'silver', 'Climbing', 'Level up 10 times.', 'arrow-up-right', count((x) => x.lift().ups, 10), { ribbon: '10', next: '10 level-ups' }],
    ['levelup25', 'strength', 'gold', 'Summit seeker', 'Level up 25 times.', 'arrow-up-right', count((x) => x.lift().ups, 25), { ribbon: '25', next: '25 level-ups' }],
    ['pr', 'strength', 'bronze', 'Personal best', 'Beat one of your best sets.', 'star', count((x) => x.lift().prs, 1), { next: 'a personal best' }],
    ['pr25', 'strength', 'silver', 'Record breaker', 'Set 25 personal bests.', 'star', count((x) => x.lift().prs, 25), { ribbon: '25', next: '25 personal bests' }],
    ['pr100', 'strength', 'gold', 'Unbeatable', 'Set 100 personal bests.', 'star', count((x) => x.lift().prs, 100), { ribbon: '100', next: '100 personal bests' }],
    ['topRung', 'strength', 'gold', 'Top of the ladder', 'Reach the hardest move on a ladder.', 'ladder', (x) => done1(x.lift().top)],
    ['firstPullup', 'strength', 'gold', 'First pull-up', 'Do a full pull-up or chin-up.', 'pullup', (x) => done1(x.lift().pullup)],
    ['pushups20', 'strength', 'silver', 'Twenty push-ups', 'Do 20 full push-ups in one set.', 'bolt', (x) => done1(x.lift().push20), { ribbon: '20' }],
    ['heavier', 'strength', 'bronze', 'Heavier', 'Move up to a heavier weight.', 'dumbbell', (x) => done1(x.lift().heavier)],
    // Body
    ['allGroups', 'body', 'bronze', 'Head to toe', 'Train every muscle group in one week.', 'person', (x) => r(x.body().bestGroups, 7, x.body().all), { next: 'every muscle group in a week', unit: 'groups' }],
    ['allGroups4', 'body', 'silver', 'Balanced build', 'Train every muscle group, 4 weeks in a row.', 'person', (x) => r(x.body().best4, 4, x.body().all4), { ribbon: '4', next: '4 balanced weeks', unit: 'weeks' }],
    ['evenSides', 'body', 'silver', 'Even sides', 'Close the gap between your left and right side.', 'shuffle', (x) => done1(x.body().even)],
    ['mobility10', 'body', 'bronze', 'Loose and limber', 'Do 10 mobility sessions.', 'leaf', count((x) => x.body().mob, 10), { ribbon: '10', next: '10 mobility sessions' }],
    ['lightDays10', 'body', 'bronze', 'Easy does it', 'Complete 10 walk-and-stretch days.', 'act-walk', count((x) => x.body().both, 10), { ribbon: '10', next: '10 walk-and-stretch days' }],
    // Moments
    ['earlyBird', 'moments', 'bronze', 'Early bird', 'Start a workout before 8 am.', 'sunrise', (x) => done1(x.wk().early), { secret: true }],
    ['nightOwl', 'moments', 'bronze', 'Night owl', 'Start a workout after 9 pm.', 'moonstar', (x) => done1(x.wk().owl), { secret: true }],
    ['fullHour', 'moments', 'silver', 'The full hour', 'Train for an hour in one workout.', 'clock', (x) => done1(x.wk().full)],
    ['shortSweet', 'moments', 'bronze', 'Short and sweet', 'Do 10 short-on-time workouts.', 'timer', count((x) => x.wk().short, 10), { ribbon: '10', next: '10 short workouts' }],
    ['newYear', 'moments', 'gold', 'Fresh start', 'Work out on New Year\'s Day.', 'sparkle', (x) => done1(x.wk().newYear), { secret: true }],
    ['anniversary', 'moments', 'gold', 'One year in', 'A year since you started.', 'cake', (x) => { const s = x.p.startDay; return num(s) ? r(x.day - s, 365, x.day >= s + 365 ? s + 365 : null) : r(0, 365, null); }, { ribbon: '1', next: 'a year with the app', unit: 'days', applies: () => true }],
    // Activities
    ['firstActivity', 'activities', 'bronze', 'Out the door', 'Record your first walk, run, hike or ride.', 'compass', (x) => done1(x.acts().first), { next: 'your first activity' }],
    ['run5k', 'activities', 'silver', '5K', 'Run 5 km (3.1 miles) in one go.', 'act-run', (x) => r(Math.floor(x.acts().longestRun / 100) / 10, 5, x.acts().k5), { ribbon: '5K', next: 'a 5K run', unit: 'km' }],
    ['run10k', 'activities', 'gold', '10K', 'Run 10 km (6.2 miles) in one go.', 'act-run', (x) => r(Math.floor(x.acts().longestRun / 100) / 10, 10, x.acts().k10), { ribbon: '10K', next: 'a 10K run', unit: 'km' }],
    ['halfMarathon', 'activities', 'platinum', 'Half marathon', 'Run 21.1 km (13.1 miles) in one go.', 'act-run', (x) => r(Math.floor(x.acts().longestRun / 100) / 10, 21.1, x.acts().half), { ribbon: '21K', next: 'a half marathon', unit: 'km' }],
    ['km100', 'activities', 'gold', 'Hundred club', 'Cover 100 km (62 miles) in recorded activities.', 'navigate', (x) => r(Math.floor(x.acts().totalM / 1000), 100, x.acts().km100), { ribbon: '100', next: '100 km recorded', unit: 'km' }],
    ['record', 'activities', 'silver', 'New record', 'Beat one of your activity records.', 'bolt', (x) => done1(x.acts().record)],
    ['climb500', 'activities', 'gold', 'Mountain goat', 'Climb 500 m (1,640 ft) in one activity.', 'mountain', (x) => r(Math.round(x.acts().maxClimb), 500, x.acts().climb), { ribbon: '500', next: 'a 500 m climb', unit: 'm' }],
    // Health
    ['connected', 'health', 'bronze', 'Connected', 'Connect Health Connect.', 'heart', (x) => done1(x.health().connected ? -1 : null), { applies: (x) => !['unsupported', 'unavailable'].includes(x.live.hc) }],
    ['steps10k', 'health', 'bronze', '10K steps', 'Walk 10,000 steps in a day.', 'steps', (x) => done1(x.health().steps10k), { ribbon: '10K' }],
    ['stepsWeek', 'health', 'silver', 'Step streak', 'Walk 10,000 steps a day, 7 days in a row.', 'steps', (x) => r(x.health().stepsBest, 7, x.health().stepsWeek), { ribbon: '7', next: '10,000 steps for 7 days', unit: 'days' }],
    ['sleepWeek', 'health', 'silver', 'Well rested', 'Sleep 7+ hours, 7 nights in a row.', 'moon', (x) => r(x.health().sleepBest, 7, x.health().sleepWeek), { ribbon: '7', next: '7 good nights', unit: 'nights' }],
    ['weighIns10', 'health', 'bronze', 'On the scale', 'Log your weight on 10 days.', 'scale', count((x) => x.health().weighIns, 10), { ribbon: '10', next: '10 weigh-ins' }],
    ['measure3', 'health', 'silver', 'Measured up', 'Log your body measurements on 3 days.', 'tape', count((x) => x.health().measures, 3), { ribbon: '3', next: '3 measurements' }],
    // Food
    ['protein7', 'food', 'silver', 'Protein week', 'Hit your protein goal 7 days in a row.', 'food', (x) => r(x.food().protBest, 7, x.food().prot7), { ribbon: '7', next: 'a protein week', unit: 'days', applies: foodOn }],
    ['protein30', 'food', 'gold', 'Protein pro', 'Hit your protein goal 30 days in a row.', 'food', (x) => r(x.food().protBest, 30, x.food().prot30), { ribbon: '30', next: '30 protein days', unit: 'days', applies: foodOn }],
    ['foodLog7', 'food', 'bronze', 'Food diary', 'Log food 7 days in a row.', 'compose', (x) => r(x.food().logBest, 7, x.food().log7), { ribbon: '7', next: 'a week of food logs', unit: 'days', applies: foodFull }],
    ['foodLog30', 'food', 'silver', 'Month of meals', 'Log food 30 days in a row.', 'calendar', (x) => r(x.food().logBest, 30, x.food().log30), { ribbon: '30', next: 'a month of food logs', unit: 'days', applies: foodFull }],
    // Plans
    ['ownPlan', 'plans', 'bronze', 'Your way', 'Build a plan of your own.', 'pencil', (x) => done1(x.plans().mine), { next: 'a plan of your own' }],
    ['sharedPlan', 'plans', 'bronze', 'Pass it on', 'Share a plan.', 'share', (x) => done1(x.plans().shared)],
    ['tailored', 'plans', 'bronze', 'Made to measure', 'Tailor your plan.', 'sliders', (x) => done1(x.plans().tailored)],
    ['reviewed', 'plans', 'bronze', 'Second opinion', 'Have the AI coach check your plan.', 'sparkle', (x) => done1(x.plans().reviewed)],
    ['shareBadge', 'plans', 'bronze', 'Show and tell', 'Share a badge.', 'people', (x) => done1(x.plans().badge), { secret: true, applies: () => true }],
    // Getting started
    ['allSet', 'start', 'bronze', 'All set', 'Finish the getting-started list.', 'flag', allSet, { next: 'the getting-started list' }],
  ];
  // All set: the getting-started list ticked off, or its two essentials done (a first workout, or a
  // weigh-in without workouts, and a feel check), for people who hid the list or started before it.
  function allSet(x) {
    const S = x.S;
    if (S.seen && S.seen.checklistDone) return r(1, 1, -1);
    const first = x.workouts ? x.wk().days[0] : x.health().weighIns[0];
    const feel = isObj(S.feel) ? Object.keys(S.feel).map(Number).filter((d) => num(d) && d <= x.day).sort(asc)[0] : null;
    return r((first != null ? 1 : 0) + (feel != null ? 1 : 0), 2, first != null && feel != null ? Math.max(first, feel) : null);
  }
  const DEFS = LIST.map(([id, cat, tier, title, how, glyph, ev, extra]) => Object.freeze(Object.assign({ id, cat, tier, title, how, glyph, ev, shape: CAT[cat].shape, secret: false }, extra || {})));
  const byId = Object.fromEntries(DEFS.map((d) => [d.id, d]));
  // Badges that lead on to one another, the same thing counted further, lowest first: what "Next up"
  // shows is the next of each, and a badge's sheet shows where it sits in its series.
  const SERIES = [
    ['first', 'w10', 'w25', 'w50', 'w100', 'w250'],
    ['streak3', 'streak7', 'streak30', 'streak100'],
    ['weeks4', 'weeks12', 'weeks26'],
    ['sets500', 'sets2000'],
    ['hours10', 'hours50'],
    ['levelup', 'levelup10', 'levelup25'],
    ['pr', 'pr25', 'pr100'],
    ['allGroups', 'allGroups4'],
    ['run5k', 'run10k', 'halfMarathon'],
    ['steps10k', 'stepsWeek'],
    ['protein7', 'protein30'],
    ['foodLog7', 'foodLog30'],
  ];
  const seriesOf = (id) => SERIES.find((s) => s.includes(id)) || null;
  // Whether a badge is offered at all right now (earned ones always show).
  function applies(def, x) {
    if (def.applies) return !!def.applies(x);
    return !CAT[def.cat].workouts || x.workouts;
  }

  /* ---------------------------------------------------------------- saved state */
  const EVENTS = ['sharedPlan', 'tailored', 'reviewed', 'sharedBadge'];
  function todayOf(S, now) { return B().dayOf(num(now) ? now : Date.now(), rollOf(S)); }
  // The saved record, made whole: anything that isn't one of its parts goes (a backup from elsewhere
  // may hold anything), unknown badge ids stay (a newer version's). A badge's opened is true or false;
  // without one (earned before badges came sealed) it counts as opened.
  function ensure(S, day) {
    let A = S.achievements;
    if (!isObj(A)) A = S.achievements = {};
    if (!num(A.v)) A.v = 2;
    if (!isObj(A.earned)) A.earned = {};
    for (const id of Object.keys(A.earned)) {
      const e = A.earned[id];
      if (!isObj(e) || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) { delete A.earned[id]; continue; }
      if (!num(e.at)) e.at = 0;
      if (!num(e.day)) { e.day = e.at > 1e12 ? B().dayOf(e.at, rollOf(S)) : num(day) ? day : todayOf(S); e.approx = true; }
      if (typeof e.opened !== 'boolean') e.opened = true;
    }
    if (!isObj(A.events)) A.events = {};
    for (const k of Object.keys(A.events)) if (!isObj(A.events[k]) || !num(A.events[k].day)) delete A.events[k];
    if (!num(A.seenAt)) A.seenAt = 0;
    return A;
  }
  const earnedOf = (S) => (S && isObj(S.achievements) && isObj(S.achievements.earned) ? S.achievements.earned : {});

  // Every badge's standing: progress, whether it's earned (saved, or reached and not saved yet), the
  // day, and whether it's offered. opts: { live: { hc } }.
  function evaluate(S, day, opts) {
    const x = ctx(S, day, opts && opts.live);
    const got = earnedOf(S);
    const seenAt = S.achievements && num(S.achievements.seenAt) ? S.achievements.seenAt : 0;
    return DEFS.map((def) => {
      const e = own(got, def.id) ? got[def.id] : null;
      // An earned badge doesn't need its progress worked out again (a full bar).
      const res = e ? { have: 1, goal: 1, day: e.day } : def.ev(x);
      const earned = !!e || res.day != null;
      return {
        id: def.id, def, have: e ? res.goal : res.have, goal: res.goal, pct: earned ? 1 : res.goal ? res.have / res.goal : 0, earned,
        day: e ? e.day : res.day != null ? (res.day < 0 || res.day > day ? day : res.day) : null,
        approx: !!(e && e.approx), at: e ? e.at : null, isNew: !!(e && e.at > seenAt),
        sealed: !!(e && e.opened === false),
        shown: earned || applies(def, x),
      };
    });
  }
  // Works out what's newly earned and saves it, sealed (cats: only these categories). Returns the new
  // ids, oldest first. opts: { cats, live, now, approx (an unknown day is marked approximate), opened
  // (what it finds counts as opened: history found on the first load) }.
  function check(S, day, reason, opts) {
    const o = opts || {};
    const A = ensure(S, day);
    const x = ctx(S, day, o.live);
    // Always after the last time badges were seen, so a clock set back can't hide a new one.
    const now = Math.max(num(o.now) ? o.now : Date.now(), A.seenAt + 1);
    const fresh = [];
    for (const def of DEFS) {
      if (own(A.earned, def.id) || (o.cats && !o.cats.includes(def.cat))) continue;
      const res = def.ev(x);
      if (res.day == null) continue;
      const known = res.day >= 0;
      const rec = { day: known && res.day <= day ? res.day : day, at: now, opened: !!o.opened };
      if (!known && o.approx) rec.approx = true;
      if (def.unit && res.goal > 1) rec.value = res.have;
      A.earned[def.id] = rec;
      fresh.push(def.id);
    }
    return fresh.sort((a, b) => A.earned[a].day - A.earned[b].day);
  }
  // A one-off moment the state doesn't otherwise keep (a plan or a badge shared, a plan tailored or
  // reviewed): its first day and how many times.
  function event(S, name, day, now) {
    if (typeof name !== 'string' || !/^[A-Za-z]{1,32}$/.test(name)) return null;
    const A = ensure(S, day);
    const e = own(A.events, name) ? A.events[name] : (A.events[name] = { day, at: num(now) ? now : Date.now(), n: 0 });
    e.n = (num(e.n) ? e.n : 0) + 1;
    return e;
  }
  // 1.6's first load: everything history already shows is earned now, on the day it happened where
  // that can be told, all counted as seen and opened (the You tab says how many, once). Runs on every
  // load and does nothing after the first time.
  function migrate(S, now) {
    if (!S || !S.profile || (isObj(S.achievements) && S.achievements.migrated)) return S;
    const t = num(now) ? now : Date.now();
    if (!GH.brain) return S;
    const day = todayOf(S, t);
    const A = ensure(S, day);
    const had = Object.keys(A.earned).length;
    try { check(S, day, 'migrate', { now: t, approx: true, opened: true }); } catch (e) { /* history the check can't read: try again next load */ return S; }
    markSeen(S, t);
    A.migrated = { at: t, n: Object.keys(A.earned).length - had };
    return S;
  }
  // The first load with sealed badges: every badge earned before then was shown as its medal, so it
  // counts as opened (the record is v 2 from then on). Runs on every load and does nothing after the
  // first time.
  function migrateOpened(S) {
    const A = S && S.achievements;
    if (!isObj(A) || (num(A.v) && A.v >= 2)) return S;
    if (isObj(A.earned)) for (const e of Object.values(A.earned)) if (isObj(e)) e.opened = true;
    A.v = 2;
    return S;
  }
  // Earned but not shown yet, oldest first.
  function unseen(S) {
    const A = S && S.achievements;
    if (!isObj(A) || !isObj(A.earned)) return [];
    const seenAt = num(A.seenAt) ? A.seenAt : 0;
    return Object.keys(A.earned).filter((id) => own(byId, id) && A.earned[id].at > seenAt).sort((a, b) => A.earned[a].at - A.earned[b].at || A.earned[a].day - A.earned[b].day);
  }
  function markSeen(S, now) {
    const A = ensure(S);
    A.seenAt = Math.max(A.seenAt, num(now) ? now : Date.now(), ...Object.values(A.earned).map((e) => (num(e.at) ? e.at : 0)));
    return A;
  }
  // Earned and still sealed, oldest first: what the reveal opens, and what a reminder can say is
  // waiting. Only badges this version knows (a newer version's can't be opened here).
  function unopened(S) {
    const A = S && S.achievements;
    if (!isObj(A) || !isObj(A.earned)) return [];
    const E = A.earned, at = (id) => (num(E[id].at) ? E[id].at : 0), day = (id) => (num(E[id].day) ? E[id].day : 0);
    return Object.keys(E).filter((id) => own(byId, id) && isObj(E[id]) && E[id].opened === false).sort((a, b) => at(a) - at(b) || day(a) - day(b));
  }
  // Opens a sealed badge, for good. True when it was sealed.
  function markOpened(S, id) {
    const E = S && isObj(S.achievements) && isObj(S.achievements.earned) ? S.achievements.earned : null;
    const e = E && typeof id === 'string' && own(E, id) ? E[id] : null;
    if (!isObj(e) || e.opened !== false) return false;
    e.opened = true;
    return true;
  }
  // Earned and offered counts, how many are still sealed, and what's next: the closest badge still to
  // earn (by how far along it is; a lower tier first on a tie), never a secret one.
  function summary(S, day, list) {
    const l = list || evaluate(S, day);
    const shown = l.filter((x) => x.shown);
    const earned = shown.filter((x) => x.earned);
    const open = shown.filter((x) => !x.earned && !x.def.secret);
    open.sort((a, b) => (b.pct - a.pct) || (TIERS[a.def.tier].rank - TIERS[b.def.tier].rank));
    const tiers = {};
    for (const t of TIER_ORDER) tiers[t] = earned.filter((x) => x.def.tier === t).length;
    return { earned: earned.length, total: shown.length, next: open[0] || null, tiers, newCount: l.filter((x) => x.isNew).length, unopened: l.filter((x) => x.sealed).length };
  }
  // What "Next up" says is left: "4 to go", "1.2 km to go".
  function toGo(item) {
    const left = Math.max(0, item.goal - item.have);
    const u = item.def.unit;
    const n = Math.round(left * 10) / 10;
    if (u === 'km' || u === 'm' || u === 'h') return `${n.toLocaleString('en-US')} ${u} to go`;
    return `${Math.ceil(left).toLocaleString('en-US')} to go`;
  }

  // Cheap fingerprints of what each category reads, so a change only re-checks the categories it
  // touched (a weigh-in never replays the calendar).
  function stamps(S, day) {
    const recent = (o, f) => { let s = ''; for (let d = day - 40; d <= day; d++) if (o && o[d] != null) s += `${d}:${f(o[d])};`; return s; };
    let lg = '';
    for (const l of Array.isArray(S.log) ? S.log : []) if (l) lg += `${(l.type || '?')[0]}${l.day}.${l.checkedIn ? 1 : 0}${l.walk ? 1 : 0}${l.mobility ? 1 : 0}${l.doneSets || 0}.${Array.isArray(l.celebrate) ? l.celebrate.length : 0};`;
    const tests = S.catchup ? ['arm', 'leg'].map((k) => (S.catchup[k] && Array.isArray(S.catchup[k].tests) ? S.catchup[k].tests.length : 0)).join() : '';
    const p = S.profile || {};
    const train = `${lg}|${Array.isArray(S.events) ? S.events.length : 0}|${tests}|${p.startDay}|${p.workouts}`;
    const acts = Array.isArray(S.activities) ? S.activities : [];
    const h = S.health || {};
    const f = S.food || {};
    const ev = S.achievements && isObj(S.achievements.events) ? Object.keys(S.achievements.events).sort().join() : '';
    return {
      consistency: train, workouts: train, strength: train, body: train, moments: `${train}|${day}`,
      activities: `${acts.length}|${acts.map((a) => (a ? `${a.id}.${Array.isArray(a.records) ? a.records.length : 0}` : '')).slice(0, 5).join()}`,
      health: `${h.lastSync}|${h.status}|${isObj(h.days) ? Object.keys(h.days).length : 0}|${recent(h.days, (x) => `${x && x.steps}/${x && x.sleepMin}`)}|${Array.isArray(S.weights) ? S.weights.length : 0}|${Array.isArray(S.measurements) ? S.measurements.length : 0}`,
      food: `${p.food && p.food.mode}|${recent(S.protein, (x) => (Array.isArray(x) ? x.join('+') : ''))}|${recent(f.days, (x) => (Array.isArray(x) ? x.length : 0))}|${isObj(f.days) ? Object.keys(f.days).length : 0}|${Array.isArray(S.weights) ? S.weights.length : 0}`,
      plans: `${(Array.isArray(S.customPlans) ? S.customPlans : []).map((x) => (x ? `${x.id}.${x.source}.${x.updatedAt}` : '')).join()}|${(Array.isArray(S.events) ? S.events : []).filter((e) => e && e.type === 'tailor').length}|${ev}`,
      start: `${S.seen && S.seen.checklistDone}|${isObj(S.feel) ? Object.keys(S.feel).length : 0}|${lg.length}|${Array.isArray(S.weights) ? S.weights.length : 0}`,
    };
  }

  GH.achievements = { DEFS, CATS, CAT, TIERS, TIER_ORDER, EVENTS, SERIES, byId, seriesOf, ctx, evaluate, check, event, migrate, migrateOpened, ensure, unseen, markSeen, unopened, markOpened, summary, toGo, stamps, applies };
  // store.migrate runs these on every load (src/store.js), after the plan engine's own. A launch runs
  // this one once its first frame is drawn (later): nothing on that frame reads the badges, and the
  // first check of them comes 800 ms after a change at the soonest (src/ui/badges.js).
  const badges = function badges(S) { migrateOpened(S); migrate(S); };
  badges.later = true;
  (GH.migrations = GH.migrations || []).push(badges);
})(typeof window !== 'undefined' ? window : globalThis);
