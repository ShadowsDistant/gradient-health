/* The brain: questionnaire → program, sessions, adaptation, calendar, streaks, readiness.
 * Pure functions over a state object S. Days are integer day numbers (local date, rolling over
 * at 4 am by default); nothing here reads the clock, so the simulation can drive any timeline.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const M = () => GH.moves;

  /* ================================================================== days */
  const DAY_MS = 86400000;
  function dayOf(ts, rollHour) {
    const d = new Date(ts - (rollHour == null ? 4 : rollHour) * 3600000);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }
  function dayFromStr(s) { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS); }
  function dayStr(n) { return new Date(n * DAY_MS).toISOString().slice(0, 10); }
  const weekday = (n) => (((n + 3) % 7) + 7) % 7; // Monday = 0
  const weekStart = (n) => n - weekday(n);
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(n, withWeekday) {
    const d = new Date(n * DAY_MS);
    const s = `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
    return withWeekday === false ? s : `${WD[weekday(n)]}, ${s}`;
  }

  /* ================================================================== constants */
  const GROUPS = ['biceps', 'triceps', 'abs', 'chest', 'legs', 'back', 'shoulders'];
  const GROUP_NAME = { biceps: 'Biceps', triceps: 'Triceps', abs: 'Abs', chest: 'Chest', legs: 'Legs', back: 'Back', shoulders: 'Shoulders', conditioning: 'Conditioning', mobility: 'Mobility' };
  const GOAL_GROUPS = { abs: ['abs'], arms: ['biceps', 'triceps'], chest: ['chest'], legs: ['legs'], back: ['back'], shoulders: ['shoulders'] };
  const UNIT_OF = { biceps: 'arms', triceps: 'arms', abs: 'abs', chest: 'chest', legs: 'legs', back: 'back', shoulders: 'shoulders' };
  const UNIT_GROUPS = { arms: ['biceps', 'triceps'], abs: ['abs'], chest: ['chest'], legs: ['legs'], back: ['back'], shoulders: ['shoulders'] };
  const PATTERNS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const LEVEL = { never: 0, onoff: 0, lt1: 1, '1to3': 1, '3plus': 2 };
  const JOINTS = ['knee', 'shoulder', 'back', 'wrist', 'elbow', 'hip', 'ankle', 'neck'];
  const CORE_ROTATION = [['abs', 'coreRot'], ['absLoad', 'coreSide'], ['abs', 'coreSide'], ['absLoad', 'coreRot']];
  const LB_PER_KG = 2.20462;

  /* ================================================================== profile + program */
  function defaultProfile() {
    return {
      onboarded: false, units: 'lb', age: null, sex: null, heightCm: null, weightKg: null,
      goals: [], experience: 'onoff', keptRoutine: false, recentActivity: 'none',
      days: 4, weekdays: null, minutes: 25, lightDays: true,
      equipment: { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: true, wall: true, towel: true, table: false, door: false },
      careful: [], impactOk: true, gentle: false, lead: { arm: null, leg: null },
      weightGoal: 'maintain', protein: { track: true, perLb: 0.8, quickName: 'Shake', quickG: 26 },
      sleepTypical: '6-7', sleepIrregular: false,
      prefs: { supersets: true, rest: 'auto', sound: true, vibrate: true, haptics: true, theme: 'system', density: 0.5, rollHour: 4 },
      startDay: null,
    };
  }

  // Tiers, frequencies and set targets from the questionnaire.
  function programFor(p) {
    const lvl = LEVEL[p.experience] != null ? LEVEL[p.experience] : 0;
    const tiers = {};
    let muscleRank = 0;
    const goals = (p.goals || []).slice();
    for (const g of goals) {
      if (GOAL_GROUPS[g]) {
        const tier = muscleRank < 2 ? 1 : muscleRank < 4 ? 2 : 3;
        for (const grp of GOAL_GROUPS[g]) if (!tiers[grp]) tiers[grp] = tier;
        muscleRank++;
      }
    }
    if (goals.includes('strength') || muscleRank === 0) for (const grp of GROUPS) if (!tiers[grp] && grp !== 'shoulders') tiers[grp] = 2;
    for (const grp of GROUPS) if (!tiers[grp]) tiers[grp] = 3;
    const D = clampInt(p.days, 2, 6);
    const freq = {};
    for (const [unit, groups] of Object.entries(UNIT_GROUPS)) {
      const t = Math.min(...groups.map((g) => tiers[g]));
      let f = t === 1 ? 3 : t === 2 ? 2 : 1;
      if (unit === 'back' && t === 3 && tiers.chest <= 2) f = 2; // balance all the pushing
      if (unit === 'shoulders' && t === 3) f = 1;
      freq[unit] = Math.min(f, D);
    }
    const start = {}, cap = {}, floor = {};
    for (const g of GROUPS) {
      const t = tiers[g];
      if (t === 1) { start[g] = [8, 10, 12][lvl]; cap[g] = [16, 18, 20][lvl]; floor[g] = 6; }
      else if (t === 2) { start[g] = [8, 8, 10][lvl]; cap[g] = [12, 14, 14][lvl]; floor[g] = 4; }
      else if (g === 'back') { start[g] = [6, 6, 8][lvl]; cap[g] = [8, 10, 12][lvl]; floor[g] = 3; }
      else if (g === 'shoulders') { start[g] = [3, 4, 6][lvl]; cap[g] = [6, 8, 10][lvl]; floor[g] = 2; }
      else { start[g] = [4, 6, 6][lvl]; cap[g] = [8, 10, 10][lvl]; floor[g] = 2; }
      if (p.gentle) start[g] = Math.max(floor[g], Math.round(start[g] * 0.75));
    }
    const cond = goals.includes('fat') || goals.includes('endurance');
    const onramp = p.gentle ? { weeks: 2, mult: 0.7 }
      : lvl === 0 || p.recentActivity === 'none' ? { weeks: 2, mult: 0.7 }
      : p.experience === 'lt1' ? { weeks: 1, mult: 0.8 }
      : p.experience === '1to3' ? { weeks: 1, mult: 0.9 } : { weeks: 0, mult: 1 };
    return {
      tiers, freq, start, cap, floor, level: lvl, D,
      finisherPerWeek: cond ? 7 : 2, walkMin: cond ? 20 : 12, mobilityPlus: goals.includes('mobility'),
      onramp, impactOk: p.impactOk !== false && !(p.age >= 60) && !p.gentle,
      warmupMin: p.age >= 40 ? 4 : 2.5,
    };
  }
  const clampInt = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(x) || lo)));

  // Assign muscle units to the training days of a week: spread each unit, balance daily load.
  function templateFor(p, prog) {
    const D = prog.D;
    const offsets = weekdaysFor(p);
    const units = Object.keys(UNIT_GROUPS).map((u) => ({
      u, f: prog.freq[u], sets: UNIT_GROUPS[u].reduce((a, g) => a + prog.start[g], 0),
    })).filter((x) => x.f > 0);
    units.sort((a, b) => b.f - a.f || b.sets - a.sets);
    const days = Array.from({ length: D }, () => ({ units: [], load: 0 }));
    const combos = (n, k, start = 0, acc = [], out = []) => {
      if (acc.length === k) { out.push(acc.slice()); return out; }
      for (let i = start; i < n; i++) { acc.push(i); combos(n, k, i + 1, acc, out); acc.pop(); }
      return out;
    };
    const adjacent = (i, j) => {
      const a = offsets[i], b = offsets[j];
      const gap = Math.min(Math.abs(a - b), 7 - Math.abs(a - b));
      return gap <= 1;
    };
    for (const x of units) {
      const per = x.sets / x.f;
      let best = null, bestCost = Infinity;
      for (const c of combos(D, x.f)) {
        let cost = 0;
        for (let i = 0; i < D; i++) { const l = days[i].load + (c.includes(i) ? per : 0); cost += l * l; }
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) if (adjacent(c[i], c[j])) cost += 30;
        if (cost < bestCost - 1e-9) { bestCost = cost; best = c; }
      }
      for (const i of best) { days[i].units.push(x.u); days[i].load += per; }
    }
    // Keep a stable, readable order inside each day.
    const ORDER = ['chest', 'legs', 'back', 'arms', 'shoulders', 'abs'];
    for (const d of days) d.units.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    return days.map((d, i) => ({ idx: i, offset: offsets[i], units: d.units }));
  }
  function weekdaysFor(p) {
    const D = clampInt(p.days, 2, 6);
    const w = Array.isArray(p.weekdays) ? p.weekdays.filter((x) => x >= 0 && x <= 6) : null;
    if (w && w.length === D) return w.slice().sort((a, b) => a - b);
    return PATTERNS[D];
  }
  function templateTitle(units) {
    const names = { arms: 'arms', abs: 'abs', chest: 'chest', legs: 'legs', back: 'back', shoulders: 'shoulders' };
    const list = units.map((u) => names[u]);
    if (!list.length) return 'Workout';
    const s = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    return s[0].toUpperCase() + s.slice(1);
  }

  /* ================================================================== state */
  function newState(profile, baseline, day) {
    const p = Object.assign(defaultProfile(), profile || {});
    p.equipment = Object.assign(defaultProfile().equipment, (profile || {}).equipment || {});
    p.prefs = Object.assign(defaultProfile().prefs, (profile || {}).prefs || {});
    p.protein = Object.assign(defaultProfile().protein, (profile || {}).protein || {});
    p.lead = Object.assign({ arm: null, leg: null }, (profile || {}).lead || {});
    p.startDay = day;
    p.onboarded = true;
    const prog = programFor(p);
    const S = {
      v: 1, createdAt: Date.now(), updatedAt: Date.now(),
      profile: p,
      vol: Object.assign({}, prog.start),
      prog: {},
      complexity: 0, noStreak: 0, hardStreak: 0,
      pain: {}, excluded: [],
      catchup: {
        arm: { side: p.lead.arm || 'L', active: !!p.lead.arm, tests: [] },
        leg: { side: p.lead.leg || 'L', active: !!p.lead.leg, tests: [] },
      },
      events: [{ type: 'settings', day, days: p.days, weekdays: p.weekdays, minutes: p.minutes }],
      log: [], weights: [], protein: {}, health: { days: {}, hc: {}, manual: {}, lastSync: null, status: null },
      feel: {}, sleepChip: {}, measurements: [], active: null, celebrated: {}, pendingLines: [],
      insightsDismissed: {}, insightsShown: {}, ai: { enabled: false, mode: 'local', reports: [], chat: [], model: null }, volWeeksDone: [], seen: {}, coachChat: [],
    };
    if (p.weightKg) S.weights.push({ day, kg: p.weightKg, src: 'profile' });
    initProgress(S, baseline, day);
    return S;
  }

  const DEFAULT_START = {
    curl: [['curl_hammer', 'curl_band', 'curl_towel'], ['curl_std'], ['curl_slow']],
    triceps: [['tri_skull', 'tri_oh', 'tri_dip_bent'], ['tri_oh', 'tri_dip_bent'], ['tri_dip', 'tri_oh_slow']],
    push: [['push_incline', 'push_knee', 'push_wall'], ['push_std'], ['push_slow']],
    chestDb: [['chest_press'], ['chest_press'], ['chest_press_slow']],
    squat: [['sq_goblet', 'sq_bw'], ['sq_goblet', 'sq_split'], ['sq_split', 'sq_lunge']],
    hinge: [['hg_deadlift', 'hg_bridge'], ['hg_rdl', 'hg_deadlift', 'hg_bridge1'], ['hg_sldl', 'hg_bridge1']],
    glute: [['gl_bridge'], ['gl_kbbridge', 'gl_bridge'], ['gl_thrust', 'gl_bridge1']],
    row: [['row_db', 'row_band', 'row_towel', 'row_table'], ['row_db', 'row_band', 'row_table'], ['row_chair', 'row_table']],
    pull: [['pull_hang'], ['pull_neg'], ['pull_chin']],
    rear: [['rear_towel', 'rear_band', 'rear_ytw'], ['rear_fly', 'rear_band', 'rear_ytw'], ['rear_fly_slow', 'rear_ytw_hold']],
    raise: [['raise', 'raise_band'], ['raise'], ['raise_slow']],
    abs: [['ab_deadbug'], ['ab_revcrunch'], ['ab_legraise']],
    absLoad: [['abl_crunch'], ['abl_kb', 'abl_crunch'], ['abl_kb_slow', 'abl_crunch']],
    coreRot: [['rot_russian'], ['rot_russian', 'rot_chop'], ['rot_chop', 'rot_russian_up']],
    coreSide: [['side_knee'], ['side_carry', 'side_plank'], ['side_plank']],
    finisher: [['fin_march', 'fin_pulse'], ['fin_swing', 'fin_pulse', 'fin_climbers'], ['fin_swing', 'fin_climbers', 'fin_burpee']],
  };

  function filtersFor(S, day) {
    const p = S.profile;
    const avoid = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    return { eq: p.equipment, noImpact: !programFor(p).impactOk, simple: S.complexity > 0, avoidJoints: avoid, careful: p.careful || [] };
  }
  // Rungs this person can use today (equipment, impact, complexity; careful joints drop risky rungs).
  function rungs(S, family, day, opts) {
    const f = filtersFor(S, day);
    const o = Object.assign({ noImpact: f.noImpact, simple: f.simple }, opts || {});
    let list = M().rungsFor(family, f.eq, { noImpact: o.noImpact, simple: o.simple });
    if (f.careful.length) list = list.filter((id) => { const m = M().MOVES[id]; return !((m.impact || m.complex) && (m.joints || []).some((j) => f.careful.includes(j))); });
    list = list.filter((id) => !(S.excluded || []).includes(id));
    return list;
  }

  function initProgress(S, baseline, day) {
    const lvl = programFor(S.profile).level;
    for (const fam of Object.keys(M().LADDERS)) {
      const list = rungs(S, fam, day);
      if (!list.length) continue;
      const prefs = (DEFAULT_START[fam] || [[]])[lvl] || [];
      const id = prefs.find((x) => list.includes(x)) || list[0];
      S.prog[fam] = { rung: id, reps: M().MOVES[id].start, w: 0, best: {}, short: 0, cooldown: 0, maxed: false };
    }
    if (baseline) applyBaseline(S, baseline, day);
  }

  function setRung(S, fam, id, reps) {
    const list = rungs(S, fam, S.profile.startDay || 0);
    if (!list.includes(id)) return false;
    const m = M().MOVES[id];
    S.prog[fam] = Object.assign(S.prog[fam] || { best: {}, w: 0 }, { rung: id, reps: clampInt(reps == null ? m.start : reps, m.range[0], m.range[1]), short: 0, cooldown: 0 });
    return true;
  }

  // Baseline test → starting rungs and the first left/right test.
  function applyBaseline(S, b, day) {
    if (b.pushups != null) {
      const n = b.pushups;
      if (b.knees) {
        if (n < 5) setRung(S, 'push', 'push_wall', 12);
        else if (n <= 12) setRung(S, 'push', 'push_incline', 10) || setRung(S, 'push', 'push_knee', 8);
        else setRung(S, 'push', 'push_knee', Math.round(n * 0.7));
      } else if (n < 3) setRung(S, 'push', 'push_knee', 10);
      else if (n <= 25) setRung(S, 'push', 'push_std', Math.round(n * 0.75));
      else setRung(S, 'push', 'push_slow', Math.round(n * 0.45));
      if (!b.knees && n >= 15) setRung(S, 'triceps', 'tri_dip_bent', 12) || setRung(S, 'triceps', 'tri_oh', 14);
    }
    if (b.plankSec != null) {
      const s = b.plankSec;
      if (s < 20) setRung(S, 'abs', 'ab_deadbug', 8);
      else if (s < 45) setRung(S, 'abs', 'ab_revcrunch', 10);
      else if (s <= 90) setRung(S, 'abs', 'ab_legraise', 10);
      else setRung(S, 'abs', 'ab_hollow', 30);
      if (s < 30) setRung(S, 'coreSide', 'side_knee', 20);
      else if (s <= 60) setRung(S, 'coreSide', 'side_carry', 30) || setRung(S, 'coreSide', 'side_plank', 20);
      else setRung(S, 'coreSide', 'side_plank', 30);
      if (s >= 30) setRung(S, 'absLoad', 'abl_kb', 12);
    }
    if (b.curlL != null && b.curlR != null) {
      const weak = Math.min(b.curlL, b.curlR);
      if (weak < 12) setRung(S, 'curl', 'curl_hammer', Math.max(8, Math.round(weak * 0.75)));
      else if (weak < 25) setRung(S, 'curl', 'curl_std', Math.round(weak * 0.75));
      else setRung(S, 'curl', 'curl_slow', 12);
      recordTest(S, day, 'arm', b.curlL, b.curlR);
    }
  }

  /* ================================================================== left/right catch-up */
  function recordTest(S, day, kind, left, right) {
    const c = S.catchup[kind];
    const lead = c.side || 'L';
    const weak = lead === 'L' ? left : right;
    const strong = lead === 'L' ? right : left;
    const gap = strong > 0 ? Math.max(0, (strong - weak) / strong) : 0;
    const was = c.active;
    if (gap < 0.10) c.active = false;
    else if (gap >= 0.15) c.active = true;
    else if (!c.tests.length) c.active = true;
    c.tests.push({ day, left, right, gap: Math.round(gap * 1000) / 1000 });
    const pct = Math.round(gap * 100);
    const sideName = lead === 'L' ? 'Left' : 'Right';
    const limb = kind === 'arm' ? 'arm' : 'leg';
    let line;
    if (was && !c.active) line = `${sideName} ${limb} within ${pct}%: extra ${sideName.toLowerCase()} set dropped`;
    else if (!was && c.active) line = `${sideName} ${limb} gap is ${pct}%: extra ${sideName.toLowerCase()} set added`;
    else line = `${sideName} ${limb} gap: ${pct}%`;
    return { gap, active: c.active, line };
  }
  function testDue(S, day, kind) {
    const c = S.catchup[kind];
    if (!c || (!c.active && !c.tests.length && !S.profile.lead[kind])) return false;
    const last = c.tests.length ? c.tests[c.tests.length - 1].day : S.profile.startDay;
    return day - last >= 14;
  }

  /* ================================================================== calendar replay */
  // The settings in force on a day: the latest-dated change on or before it (the later edit wins a tie).
  function settingsAt(S, day) {
    let cur = null;
    for (const e of S.events) if (e.type === 'settings' && e.day <= day && (!cur || e.day >= cur.day)) cur = e;
    return cur || { days: S.profile.days, weekdays: S.profile.weekdays, minutes: S.profile.minutes };
  }
  // A new schedule starts next week once this week is under way, so days already done or missed
  // keep their meaning; before the week starts (or for a time-only change) it applies right away.
  // A newer edit replaces any change still waiting for next week.
  function scheduleSettings(S, day, next) {
    S.events = S.events.filter((e) => !(e.type === 'settings' && e.day > day));
    const cur = settingsAt(S, day);
    const ws = weekStart(day);
    const norm = (w) => (Array.isArray(w) && w.length ? w.slice().sort((a, b) => a - b).join(',') : '');
    const sameShape = next.days === cur.days && norm(next.weekdays) === norm(cur.weekdays);
    const started = day > ws || S.log.some((l) => l.type === 'workout' && l.day === ws);
    if (sameShape) {
      if (next.minutes !== cur.minutes) S.events.push({ type: 'settings', day, days: cur.days, weekdays: cur.weekdays, minutes: next.minutes });
      return { from: day, shape: false };
    }
    if (!started || day < (S.profile.startDay || 0) + 1) {
      S.events.push({ type: 'settings', day: Math.max(ws, S.profile.startDay || ws), days: next.days, weekdays: next.weekdays, minutes: next.minutes });
      return { from: ws, shape: true };
    }
    if (next.minutes !== cur.minutes) S.events.push({ type: 'settings', day, days: cur.days, weekdays: cur.weekdays, minutes: next.minutes });
    S.events.push({ type: 'settings', day: ws + 7, days: next.days, weekdays: next.weekdays, minutes: next.minutes });
    return { from: ws + 7, shape: true };
  }
  function workoutLogs(S) { return S.log.filter((l) => l.type === 'workout'); }
  function isDone(l) { return l.type === 'workout' && l.checkedIn && (l.pct || 0) >= 0.5; }

  // Replays the schedule from the start date up to `today`. Pure: same inputs, same answer.
  function calendar(S, today) {
    const p = S.profile;
    const start = p.startDay;
    const out = { weeks: {}, days: {}, streak: { current: 0, best: 0, weekly: 0, weeklyBest: 0, freezeThisWeek: false }, notices: [] };
    if (start == null) return out;
    const prog = programFor(p);
    const doneByDay = {};
    for (const l of workoutLogs(S)) if (isDone(l)) doneByDay[l.day] = l;
    const lightDone = {};
    for (const l of S.log) if (l.type === 'light' && l.walk && l.mobility) lightDone[l.day] = true;
    const moves = S.events.filter((e) => e.type === 'move');
    const deloadReq = new Set(S.events.filter((e) => e.type === 'deloadNext').map((e) => weekStart(e.day) + 7));
    let streak = 0, best = 0, weekly = 0, weeklyBest = 0;
    let trainingWeeks = 0, sinceDeload = 0, lastWorkoutDay = null;
    const lastWeek = weekStart(today);
    for (let ws = weekStart(start); ws <= lastWeek; ws += 7) {
      const set = settingsAt(S, ws + 6 < start ? start : Math.max(ws, start));
      const tpl = templateFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays }), programFor(Object.assign({}, p, { days: set.days })));
      // Phase for this week, from history only.
      const idle = lastWorkoutDay != null && ws - lastWorkoutDay >= 7 + 1;
      let deload = false;
      if (deloadReq.has(ws)) deload = true;
      else if (sinceDeload >= 4 && trainingWeeks >= 4) deload = true;
      const onramp = !deload && (trainingWeeks < prog.onramp.weeks || idle);
      const mult = deload ? 0.6 : onramp ? (idle && trainingWeeks >= prog.onramp.weeks ? 0.7 : prog.onramp.mult) : 1;
      // Sessions for the week.
      let sessions = tpl.map((t) => ({ tpl: t.idx, units: t.units, day: ws + t.offset, planned: ws + t.offset }))
        .filter((s) => s.day >= start);
      // Moves (Plan tab, "Train today instead") replay on the day they were made, after any
      // earlier shifts; moves made before this week started apply up front.
      const applyMove = (mv) => {
        const s = sessions.find((x) => x.day === mv.from && !x.done && !x.dropped);
        if (s && !sessions.some((x) => x.day === mv.to && !x.dropped)) s.day = mv.to;
        sessions.sort((a, b) => (a.day == null ? 1e9 : a.day) - (b.day == null ? 1e9 : b.day));
      };
      const weekMoves = moves.filter((mv) => weekStart(mv.from) === ws);
      for (const mv of weekMoves) if (mv.at < ws) applyMove(mv);
      sessions.sort((a, b) => a.day - b.day);
      const week = { ws, sessions, phase: { deload, onramp, mult, idle }, trainingWeek: trainingWeeks + 1 };
      let freezeUsed = false;
      let weekHadWorkout = false;
      for (let d = ws; d < ws + 7; d++) {
        for (const mv of weekMoves) if (mv.at === d) applyMove(mv);
        const s = sessions.find((x) => x.day === d && !x.dropped);
        const info = { planned: s ? 'workout' : p.lightDays === false ? 'rest' : 'light', tpl: s ? s.tpl : null, done: false };
        if (d < start) { out.days[d] = { planned: 'none' }; continue; }
        if (doneByDay[d]) {
          info.done = true; info.planned = 'workout';
          if (s) s.done = true;
          else {
            // A workout on an unplanned day: it takes the next pending session.
            const next = sessions.find((x) => !x.done && !x.dropped && x.day > d);
            if (next) { next.day = d; next.done = true; info.tpl = next.tpl; }
          }
          weekHadWorkout = true; lastWorkoutDay = d;
          if (d <= today) { streak++; best = Math.max(best, streak); }
        } else if (s && d < today) {
          // Missed a planned workout: freeze or break, then shift the rest of the week a day.
          s.missed = true;
          if (!freezeUsed) { freezeUsed = true; info.frozen = true; }
          else { streak = 0; info.broken = true; }
          info.missed = true;
          const pending = sessions.filter((x) => !x.done && !x.dropped && x.day >= d);
          for (let i = pending.length - 1; i >= 0; i--) {
            pending[i].day += 1;
            if (pending[i].day > ws + 6) { pending[i].dropped = true; pending[i].day = null; }
          }
          out.notices.push({ day: d, text: 'Moved your plan forward a day.' });
        } else if (!s && lightDone[d]) {
          info.done = true;
          if (d <= today) { streak++; best = Math.max(best, streak); }
        }
        out.days[d] = info;
      }
      // Re-label days after shifts (so later reads see where sessions ended up).
      for (let d = ws; d < ws + 7; d++) {
        if (d < start || !out.days[d]) continue;
        const s = sessions.find((x) => x.day === d && !x.dropped);
        if (s && !out.days[d].done) { out.days[d].planned = 'workout'; out.days[d].tpl = s.tpl; }
        else if (!s && !out.days[d].done && out.days[d].planned === 'workout' && !out.days[d].missed) out.days[d].planned = p.lightDays === false ? 'rest' : 'light';
      }
      week.freezeUsed = freezeUsed;
      week.allDone = sessions.length > 0 && sessions.every((x) => x.done);
      if (ws + 6 < today) {
        weekly = week.allDone ? weekly + 1 : 0;
        weeklyBest = Math.max(weeklyBest, weekly);
      }
      if (weekHadWorkout) { trainingWeeks++; sinceDeload = deload ? 0 : sinceDeload + 1; }
      else if (deload) sinceDeload = 0;
      out.weeks[ws] = week;
      if (ws === lastWeek) out.streak.freezeThisWeek = freezeUsed;
    }
    out.streak.current = streak; out.streak.best = best; out.streak.weekly = weekly; out.streak.weeklyBest = weeklyBest;
    return out;
  }

  function weekOf(S, day, cal) {
    const c = cal || calendar(S, day);
    return c.weeks[weekStart(day)] || null;
  }

  // What today holds: a workout (with its template), a light day, or done.
  function todayPlan(S, day, cal) {
    const c = cal || calendar(S, day);
    const info = c.days[day] || { planned: 'light' };
    const week = c.weeks[weekStart(day)];
    const doneLog = workoutLogs(S).find((l) => l.day === day && isDone(l));
    if (doneLog) return { type: 'done', log: doneLog, week };
    if (info.planned === 'workout') {
      const s = week && week.sessions.find((x) => x.day === day && !x.dropped);
      return { type: 'workout', tpl: s ? s.tpl : info.tpl, units: s ? s.units : [], week };
    }
    const light = S.log.find((l) => l.type === 'light' && l.day === day) || { walk: false, mobility: false };
    const next = week && week.sessions.find((x) => !x.done && !x.dropped && x.day > day);
    return { type: info.planned === 'rest' ? 'rest' : 'light', light, next, week };
  }

  /* ================================================================== readiness */
  function median(a) { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function readiness(S, day) {
    const r = { minus: 0, legsMinus: 0, noFinisher: false, badSleep: false, low: false, reasons: [] };
    const h = (S.health && S.health.days) || {};
    const today = h[day] || {};
    const chip = S.sleepChip && S.sleepChip[day];
    const sleepMin = today.sleepMin != null ? today.sleepMin : null;
    if ((sleepMin != null && sleepMin < 300) || chip === '<5') {
      r.minus = 1; r.badSleep = true;
      r.reasons.push({ kind: 'sleep', text: sleepMin != null ? `Slept ${fmtMin(sleepMin)}: one less set per exercise today.` : 'Under 5 hours of sleep: one less set per exercise today.' });
    }
    const hist = (key) => { const v = []; for (let d = day - 14; d < day; d++) if (h[d] && h[d][key] != null) v.push(h[d][key]); return v; };
    const rhrHist = hist('rhr'), hrvHist = hist('hrv');
    if (today.rhr != null && rhrHist.length >= 5) {
      const med = median(rhrHist);
      if (today.rhr >= med + 7) { r.low = true; r.reasons.push({ kind: 'rhr', text: `Resting heart rate is ${Math.round(today.rhr - med)} bpm above your normal.` }); }
    }
    if (today.hrv != null && hrvHist.length >= 5) {
      const med = median(hrvHist);
      if (today.hrv <= med * 0.75) { r.low = true; r.reasons.push({ kind: 'hrv', text: `HRV is ${Math.round((1 - today.hrv / med) * 100)}% below your normal.` }); }
    }
    const feel = S.feel && S.feel[day];
    if (feel && feel.sore === 'very' && feel.energy === 'low') { r.low = true; r.reasons.push({ kind: 'feel', text: 'Very sore with low energy.' }); }
    if (r.low && !r.minus) { r.minus = 1; r.reasons.push({ kind: 'plan', text: 'One less set per exercise today.' }); }
    // Another hard session in the last day (Health Connect or logged by hand).
    const recent = [].concat((h[day] && h[day].exercise) || [], (h[day - 1] && h[day - 1].exercise) || []);
    const big = recent.find((e) => e.minutes >= 45 && !/walk/i.test(e.typeName || '') && !e.fromApp);
    if (big) { r.legsMinus = 1; r.noFinisher = true; r.reasons.push({ kind: 'exercise', text: `${big.minutes} min of ${big.typeName || 'exercise'} logged: easier on legs, no finisher.` }); }
    return r;
  }
  function fmtMin(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return m ? `${h} h ${m}` : `${h} h`; }

  /* ================================================================== session build */
  function slotsForUnit(unit, sets, S, dayIdx, day) {
    const has = (fam) => rungs(S, fam, day).length > 0;
    const out = [];
    const split = (a, b, n, bias) => {
      if (n <= 0) return;
      if (n === 1 || !has(b)) { out.push([a, n]); return; }
      if (!has(a)) { out.push([b, n]); return; }
      const first = bias ? Math.ceil(n / 2) : Math.floor(n / 2);
      if (first > 0) out.push([a, first]);
      if (n - first > 0) out.push([b, n - first]);
    };
    if (unit === 'chest') {
      if (sets > 4 && has('chestDb')) { out.push(['push', 4]); out.push(['chestDb', sets - 4]); } else out.push(['push', sets]);
    } else if (unit === 'legs') split('squat', has('hinge') ? 'hinge' : 'glute', sets, dayIdx % 2 === 0);
    else if (unit === 'back') {
      if (has('pull') && sets >= 3) { const pr = Math.round(sets * 0.4); out.push(['pull', pr]); split('row', 'rear', sets - pr, true); }
      else split('row', 'rear', sets, true);
    } else if (unit === 'shoulders') out.push(['raise', sets]);
    return out.filter(([f, n]) => n > 0 && has(f));
  }

  // Distribute a group's weekly sets across the days that train it.
  function perSession(total, f, k) { const base = Math.floor(total / f); return base + (k < total - base * f ? 1 : 0); }

  // Build the session for a template on a day. opts: { short, sleepChip }
  function buildSession(S, day, tplIdx, opts) {
    const o = opts || {};
    const p = S.profile;
    const prog = programFor(p);
    const cal = o.cal || calendar(S, day);
    const week = cal.weeks[weekStart(day)] || { phase: { mult: 1, onramp: false, deload: false } };
    const set = settingsAt(S, day);
    const tpl = templateFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays }), programFor(Object.assign({}, p, { days: set.days })));
    const t = tpl[tplIdx] || tpl[0];
    const mult = o.forceMult != null ? o.forceMult : week.phase.mult;
    const ready = o.noReadiness ? { minus: 0, legsMinus: 0, reasons: [] } : readiness(S, day);
    // Which occurrence of each unit this is within the week (for the remainder split).
    const occurrence = (unit) => tpl.slice(0, t.idx).filter((x) => x.units.includes(unit)).length;
    const slots = [];
    for (const unit of t.units) {
      const groups = UNIT_GROUPS[unit];
      if (unit === 'abs') {
        const n = perSession(Math.round(S.vol.abs * mult), prog.freq.abs, occurrence('abs'));
        const pair = CORE_ROTATION[t.idx % CORE_ROTATION.length].filter((f) => rungs(S, f, day).length);
        if (n <= 2 || pair.length < 2) { if (pair.length) slots.push({ fam: pair[0], sets: n, group: 'abs' }); }
        else { slots.push({ fam: pair[0], sets: Math.ceil(n / 2), group: 'abs' }); slots.push({ fam: pair[1], sets: Math.floor(n / 2), group: 'abs' }); }
        continue;
      }
      if (unit === 'arms') {
        for (const g of groups) {
          const n = perSession(Math.round(S.vol[g] * mult), prog.freq.arms, occurrence('arms'));
          const fam = g === 'biceps' ? 'curl' : 'triceps';
          if (n > 0 && rungs(S, fam, day).length) slots.push({ fam, sets: n, group: g });
        }
        continue;
      }
      const g = groups[0];
      const n = perSession(Math.round(S.vol[g] * mult), prog.freq[unit], occurrence(unit));
      for (const [fam, k] of slotsForUnit(unit, n, S, t.idx, day)) slots.push({ fam, sets: k, group: g });
    }
    // Readiness: one less set per exercise (never below 1); leg trim after another hard session.
    for (const s of slots) {
      if (ready.minus) s.sets = Math.max(1, s.sets - 1);
      if (ready.legsMinus && s.group === 'legs') s.sets = Math.max(1, s.sets - 1);
    }
    const items = slots.map((s) => itemFor(S, s, day)).filter(Boolean);
    const extraLines = [];
    // Catch-up: one extra lead-side set on arm (and leg) days.
    const armDay = t.units.includes('arms');
    const legDay = t.units.includes('legs');
    const extras = [];
    if (armDay && S.catchup.arm.active) { const x = extraItem(S, 'curl', 'arm', day); if (x) extras.push(x); }
    if (legDay && S.catchup.leg.active) { const x = extraItem(S, 'squat', 'leg', day); if (x) extras.push(x); }
    // Tests (every 14 days, at the start of the first matching day).
    const tests = [];
    if (armDay && testDue(S, day, 'arm') && M().rungsFor('curl', p.equipment).some((id) => M().MOVES[id].load)) tests.push(testItem(S, 'arm', day));
    if (legDay && testDue(S, day, 'leg')) tests.push(testItem(S, 'leg', day));
    // A test is a max-effort set for each side, so it stands in for one set of that ladder.
    for (const t of tests) { const it = items.find((x) => x.fam === t.fam); if (it && it.sets > 1) it.sets--; }
    // Finisher.
    let finisher = null;
    const finDays = Math.min(prog.finisherPerWeek, tpl.length);
    const finIdx = tpl.length <= 2 ? [0, 1] : finDays >= tpl.length ? tpl.map((x) => x.idx) : finDays === 2 ? [1, tpl.length - 1] : [tpl.length - 1];
    if (!ready.noFinisher && finIdx.includes(t.idx) && !week.phase.deload && S.complexity < 2) finisher = finisherItem(S, day);
    const session = {
      day, tpl: t.idx, units: t.units, title: templateTitle(t.units), short: !!o.short,
      phase: week.phase, readiness: ready, warmup: warmupItems(S, day, o.short ? 1 : prog.warmupMin),
      tests, items, extras, finisher, notes: [], mobility: prog.mobilityPlus ? cooldownItems(S) : [],
    };
    pairSupersets(S, session);
    if (!o.noTrim) fitToBudget(S, session, o.short ? 13 : set.minutes || p.minutes);
    if (S.complexity > 0) limitExercises(session, S.complexity === 1 ? 5 : 4);
    session.estimateMin = Math.round(estimate(S, session));
    session.groups = groupsOf(session);
    assignUids(session);
    return session;
  }
  // Stable ids so a saved workout can point its steps back at the session's items after a reload.
  function assignUids(s) {
    s.items.forEach((it, i) => { it.uid = 'i' + i; });
    (s.extras || []).forEach((it, i) => { it.uid = 'x' + i; });
    (s.warmup || []).forEach((it, i) => { it.uid = 'w' + i; });
    (s.tests || []).forEach((it, i) => { it.uid = 't' + i; });
    (s.mobility || []).forEach((it, i) => { it.uid = 'm' + i; });
    if (s.finisher) s.finisher.uid = 'f';
  }
  function relink(S) {
    const A = S && S.active;
    if (!A || !A.session || !Array.isArray(A.steps)) return;
    const s = A.session;
    const pool = [].concat(s.items || [], s.extras || [], s.warmup || [], s.tests || [], s.mobility || [], s.finisher ? [s.finisher] : []);
    const byUid = new Map(pool.filter((it) => it && it.uid).map((it) => [it.uid, it]));
    for (const st of A.steps) if (st.item && st.item.uid && byUid.has(st.item.uid)) st.item = byUid.get(st.item.uid);
  }

  function loadInfo(S, m) {
    const eq = S.profile.equipment;
    const key = M().loadFor(m, eq);
    if (!key) return null;
    const unit = S.profile.units || 'lb';
    if (key === 'db' || key === 'kb') {
      const list = (eq[key] || []).slice().sort((a, b) => a - b);
      const w = S.prog[m.family] ? Math.min(S.prog[m.family].w || 0, list.length - 1) : 0;
      const value = list[Math.max(0, w)];
      return { key, value, unit, label: `${fmtNum(value)} ${unit} ${key === 'db' ? (m.uni || /^(curl_conc|tri_oh1|row_chair|chest_press1|raise_lean)/.test(m.id) ? 'dumbbell' : 'dumbbells') : 'kettlebell'}` };
    }
    if (key === 'ball') return { key, value: eq.ballLb, unit, label: eq.ballLb ? `${fmtNum(eq.ballLb)} ${unit} ball` : 'Ball' };
    if (key === 'band') return { key, label: 'Band' };
    return null;
  }
  const fmtNum = (x) => (x == null ? '' : Number.isInteger(x) ? String(x) : x.toFixed(1));

  // Auto rest: 90 s after big multi-joint moves, 60 s after small ones (and inside supersets, see
  // pairSupersets). Resting over a minute gives a small extra benefit for muscle size, with nothing
  // clear past about 90 s (Singer et al. 2024).
  const COMPOUND = ['push', 'chestDb', 'squat', 'hinge', 'row', 'pull'];
  function restFor(S, fam) {
    const pr = S.profile.prefs.rest;
    if (pr === 60 || pr === 90) return pr;
    return COMPOUND.includes(fam) ? 90 : 60;
  }

  // The move for a slot today: the ladder's current rung, swapped away from painful joints.
  function pickMove(S, fam, day) {
    const list = rungs(S, fam, day);
    if (!list.length) return null;
    const st = S.prog[fam];
    let id = st && list.includes(st.rung) ? st.rung : null;
    if (!id && st) {
      // The saved rung is not available today (equipment, simple mode, exclusion): nearest lower rung.
      const all = M().LADDERS[fam].rungs;
      const at = all.indexOf(st.rung);
      id = list.filter((x) => all.indexOf(x) <= at).pop() || list[0];
    }
    id = id || list[0];
    const avoid = filtersFor(S, day).avoidJoints;
    const loads = (x) => (M().MOVES[x].joints || []).some((j) => avoid.includes(j));
    if (!avoid.length || !loads(id)) return { id, swappedFrom: null };
    // Same ladder first (nearest easier, then harder), then another ladder of the same group.
    const all = M().LADDERS[fam].rungs;
    const at = all.indexOf(id);
    const safe = list.filter((x) => !loads(x)).sort((a, b) => Math.abs(all.indexOf(a) - at) - Math.abs(all.indexOf(b) - at) || all.indexOf(a) - all.indexOf(b));
    if (safe.length) return { id: safe[0], swappedFrom: id };
    const group = M().LADDERS[fam].group;
    for (const [f2, lad] of Object.entries(M().LADDERS)) {
      if (f2 === fam || lad.group !== group) continue;
      const alt = rungs(S, f2, day).filter((x) => !loads(x));
      if (alt.length) return { id: alt[0], swappedFrom: id, family: f2 };
    }
    return { id: null, swappedFrom: id, dropped: true };
  }

  function itemFor(S, slot, day) {
    const pick = pickMove(S, slot.fam, day);
    if (!pick || !pick.id) return null;
    const m = M().MOVES[pick.id];
    const fam = pick.family || slot.fam;
    const st = S.prog[fam] || { reps: m.start };
    let target = st.rung === pick.id ? st.reps : m.start;
    target = clampInt(target, m.range[0], m.range[1]);
    return {
      kind: 'move', fam, moveId: m.id, name: m.name, group: slot.group, sets: slot.sets, target,
      timed: !!m.timed, uni: !!m.uni, rest: restFor(S, fam), load: loadInfo(S, m),
      swappedFrom: pick.swappedFrom, superset: null,
    };
  }

  function extraItem(S, fam, kind, day) {
    const list = rungs(S, fam, day);
    if (!list.length) return null;
    const cur = S.prog[fam] && list.includes(S.prog[fam].rung) ? S.prog[fam].rung : list[0];
    const all = M().LADDERS[fam].rungs;
    // The same move done with one arm when there is a single-arm version, else the nearest
    // single-side rung.
    const uni = list.filter((x) => M().MOVES[x].uni);
    let id = cur;
    const oneArm = M().ONE_ARM[cur];
    if (!M().MOVES[cur].uni && oneArm && M().allowed(M().MOVES[oneArm], S.profile.equipment)) id = oneArm;
    else if (!M().MOVES[cur].uni && uni.length) id = uni.sort((a, b) => Math.abs(all.indexOf(a) - all.indexOf(cur)) - Math.abs(all.indexOf(b) - all.indexOf(cur)))[0];
    const avoid = filtersFor(S, day).avoidJoints;
    if ((M().MOVES[id].joints || []).some((j) => avoid.includes(j))) return null;
    const m = M().MOVES[id];
    const st = S.prog[fam] || {};
    const target = clampInt(M().MOVES[cur].timed === m.timed ? (st.reps || m.start) : m.start, m.range[0], m.range[1]);
    const side = S.catchup[kind].side || 'L';
    return {
      kind: 'extra', fam, moveId: id, name: m.name, group: m.group, sets: 1, target, timed: !!m.timed, uni: true,
      leadOnly: side, rest: restFor(S, fam), load: loadInfo(S, m), superset: null, extraKind: kind,
    };
  }

  function testItem(S, kind, day) {
    const fam = kind === 'arm' ? 'curl' : 'squat';
    const list = M().rungsFor(fam, S.profile.equipment).filter((id) => !M().MOVES[id].timed);
    const id = kind === 'arm' ? (list.includes('curl_std') ? 'curl_std' : list.find((x) => M().MOVES[x].load) || list[0]) : (list.includes('sq_split') ? 'sq_split' : list[0]);
    const m = M().MOVES[id];
    return { kind: 'test', test: kind, fam, moveId: id, name: kind === 'arm' ? 'Left vs right curl test' : 'Left vs right leg test', load: loadInfo(S, m), side: S.catchup[kind].side || 'L' };
  }

  function finisherItem(S, day) {
    const list = rungs(S, 'finisher', day);
    if (!list.length) return null;
    const st = S.prog.finisher || {};
    const id = list.includes(st.rung) ? st.rung : list[0];
    const m = M().MOVES[id];
    const lvl = list.indexOf(id);
    const formats = [[20, 40, 4], [30, 30, 4], [30, 30, 5], [40, 20, 4], [40, 20, 5]];
    const [work, rest, rounds] = formats[Math.min(formats.length - 1, Math.max(0, (st.fmt || 0)))];
    return { kind: 'finisher', fam: 'finisher', moveId: id, name: m.name, group: 'conditioning', work, rest, rounds, load: loadInfo(S, m), uni: !!m.uni, level: lvl };
  }

  function warmupItems(S, day, minutes) {
    const eq = S.profile.equipment;
    const list = (eq.kb && eq.kb.length ? M().WARMUP.kb : M().WARMUP.none).filter((id) => M().allowed(M().MOVES[id], eq));
    const avoid = filtersFor(S, day).avoidJoints;
    const moves = list.filter((id) => !(M().MOVES[id].joints || []).some((j) => avoid.includes(j)));
    const pick = minutes <= 1 ? moves.slice(0, 2) : moves;
    return pick.map((id) => { const m = M().MOVES[id]; return { kind: 'warmup', moveId: id, name: m.name, timed: !!m.timed, target: minutes <= 1 ? Math.min(m.start, 20) : m.start, load: loadInfo(S, m) }; });
  }
  function cooldownItems() { return [{ kind: 'mobility', moveId: 'mob_child', name: 'Child\'s pose', timed: true, target: 45 }]; }

  function mobilityFlow(S) {
    const extra = programFor(S.profile).mobilityPlus;
    return M().MOBILITY.map((id) => { const m = M().MOVES[id]; return { kind: 'mobility', moveId: id, name: m.name, timed: true, target: extra ? m.range[1] : m.start, uni: !!m.uni }; });
  }

  /* ---------------- supersets */
  const CONFLICT = [['push', 'triceps'], ['row', 'curl'], ['pull', 'curl'], ['push', 'raise'], ['chestDb', 'triceps'], ['pull', 'row'], ['row', 'rear'], ['pull', 'rear'], ['chestDb', 'push'], ['squat', 'hinge'], ['squat', 'glute'], ['hinge', 'glute']];
  const PREFER = [['squat', 'curl'], ['push', 'row'], ['hinge', 'triceps'], ['push', 'curl'], ['squat', 'row'], ['hinge', 'curl'], ['row', 'triceps'], ['squat', 'triceps'], ['curl', 'triceps'], ['pull', 'push'], ['rear', 'push'], ['raise', 'squat'], ['raise', 'hinge'], ['chestDb', 'row'], ['push', 'squat'], ['push', 'hinge']];
  const conflicts = (a, b) => a.group === b.group || CONFLICT.some(([x, y]) => (x === a.fam && y === b.fam) || (x === b.fam && y === a.fam));
  function pairSupersets(S, session) {
    if (!S.profile.prefs.supersets || S.complexity > 0) return;
    const main = session.items.filter((it) => it.group !== 'abs');
    const free = new Set(main);
    let tag = 0;
    // In a superset each muscle already rests through its partner's set, so auto rest stays at 60 s
    // there: that still gives every muscle about 90 s or more between its own sets.
    const auto = S.profile.prefs.rest !== 60 && S.profile.prefs.rest !== 90;
    const pairUp = (a, b) => { const k = 'ABCDEFG'[tag++]; a.superset = k + '1'; b.superset = k + '2'; free.delete(a); free.delete(b); if (auto) { a.rest = 60; b.rest = 60; } };
    for (const [x, y] of PREFER) {
      const a = [...free].find((it) => it.fam === x);
      const b = [...free].find((it) => it.fam === y && it !== a);
      if (a && b && !conflicts(a, b)) pairUp(a, b);
    }
    const rest = [...free];
    for (let i = 0; i < rest.length; i++) {
      if (!free.has(rest[i])) continue;
      for (let j = i + 1; j < rest.length; j++) if (free.has(rest[j]) && !conflicts(rest[i], rest[j])) { pairUp(rest[i], rest[j]); break; }
    }
    // Keep superset partners next to each other in the running order.
    const order = [];
    const seen = new Set();
    for (const it of session.items) {
      if (seen.has(it)) continue;
      order.push(it); seen.add(it);
      if (it.superset) {
        const partner = session.items.find((x) => x !== it && x.superset && x.superset[0] === it.superset[0]);
        if (partner && !seen.has(partner)) { order.push(partner); seen.add(partner); }
      }
    }
    session.items = order;
  }

  /* ---------------- time */
  function secsPerSet(it) {
    const m = M().MOVES[it.moveId];
    const reps = it.timed ? it.target : it.target * M().secPerRep(m) / (m.id.startsWith('ab_deadbug') || m.id === 'rot_russian' ? 2 : 1);
    return (it.uni && !it.leadOnly ? reps * 2 + 12 : reps) + 8;
  }
  function estimate(S, s) {
    let sec = 15; // getting started
    for (const w of s.warmup) sec += (w.timed ? w.target : w.target * 3) + 8;
    for (const t of s.tests || []) sec += 150;
    const items = s.items.concat(s.extras || []);
    const done = new Set();
    for (const it of items) {
      if (done.has(it)) continue;
      const partner = it.superset && items.find((x) => x !== it && x.superset && x.superset[0] === it.superset[0]);
      if (partner) {
        done.add(it); done.add(partner);
        const n = Math.max(it.sets, partner.sets);
        for (let k = 0; k < n; k++) {
          if (k < it.sets) sec += secsPerSet(it) + (k < partner.sets ? 20 : it.rest);
          if (k < partner.sets) sec += secsPerSet(partner) + Math.max(it.rest, partner.rest);
        }
        sec += 15;
      } else {
        done.add(it);
        sec += it.sets * (secsPerSet(it) + it.rest) + 15;
      }
    }
    if (s.finisher) sec += s.finisher.rounds * (s.finisher.work + s.finisher.rest) + 15;
    for (const mb of s.mobility || []) sec += mb.target + 5;
    return sec / 60;
  }

  function tierOf(S, group) { return programFor(S.profile).tiers[group] || 3; }
  // For trimming, back counts as tier 2 whenever chest is trained hard (it balances the pushing).
  function trimTier(S, group) {
    const t = programFor(S.profile).tiers;
    return group === 'back' && t.chest <= 2 ? Math.min(t.back || 3, 2) : t[group] || 3;
  }
  // Trim order: mobility → finisher → shoulders → second core slot → tier 3 → tier 2 → tier 1.
  // With a conditioning goal the finisher is part of the point: it shrinks late instead of going first.
  function fitToBudget(S, s, budget) {
    const cond = programFor(S.profile).finisherPerWeek >= 7;
    const over = () => estimate(S, s) > budget + 1;
    const trims = [];
    const dropSlot = (pred) => { const i = s.items.findIndex(pred); if (i >= 0) { const [it] = s.items.splice(i, 1); unpair(s, it); trims.push(it.name); return true; } return false; };
    const dropFinisher = () => { if (s.finisher) { s.finisher = null; trims.push('finisher'); } };
    const dropSecondCore = () => { const core = s.items.filter((it) => it.group === 'abs'); if (core.length > 1) dropSlot((it) => it === core[core.length - 1]); };
    const setsDown = (tier, minSets) => {
      for (;;) {
        if (!over()) return;
        const c = s.items.filter((it) => trimTier(S, it.group) === tier && it.sets > minSets).sort((a, b) => b.sets - a.sets)[0];
        if (!c) return;
        c.sets--;
      }
    };
    if (over() && s.mobility && s.mobility.length) s.mobility = [];
    if (over() && !cond) dropFinisher();
    if (over()) dropSlot((it) => it.group === 'shoulders');
    if (over() && tierOf(S, 'abs') > 1) dropSecondCore();
    setsDown(3, 1);
    while (over() && dropSlot((it) => trimTier(S, it.group) === 3)) { /* drop whole slots */ }
    if (cond) while (over() && s.finisher && s.finisher.rounds > 3) s.finisher.rounds--;
    setsDown(2, 2);
    setsDown(1, 2);
    if (over()) dropFinisher();
    if (over() && s.extras.length) s.extras = [];
    if (over() && s.warmup.length > 2) s.warmup = s.warmup.slice(0, 2);
    if (over() && s.tests.length) s.tests = [];
    // Still over (high reps on light weights eat time): one core slot, then single sets.
    if (over()) dropSecondCore();
    setsDown(2, 1);
    setsDown(1, 1);
    if (s.short) shortMode(S, s);
    s.trimmed = trims;
  }
  function unpair(s, it) {
    if (!it.superset) return;
    const partner = s.items.find((x) => x.superset && x.superset[0] === it.superset[0]);
    if (partner) partner.superset = null;
    it.superset = null;
  }
  // Short on time: priority work only, then fill back up to at least 12 minutes.
  function shortMode(S, s) {
    s.finisher = null; s.mobility = []; s.tests = [];
    const tier1 = s.items.filter((it) => tierOf(S, it.group) === 1);
    const main = s.items.find((it) => tierOf(S, it.group) === 2);
    const keep = new Set(tier1.concat(main ? [main] : []));
    const cut = s.items.filter((it) => !keep.has(it));
    for (const it of cut) unpair(s, it);
    s.items = s.items.filter((it) => keep.has(it));
    // One core slot is enough on a short day.
    const core = s.items.filter((it) => it.group === 'abs');
    if (core.length > 1) { unpair(s, core[1]); s.items = s.items.filter((it) => it !== core[1]); }
    for (const it of s.items) it.sets = Math.min(it.sets, 2);
    let guard = 0;
    while (estimate(S, s) > 15 && guard++ < 20) {
      const c = s.items.filter((it) => it.sets > 1).sort((a, b) => tierOf(S, b.group) - tierOf(S, a.group) || b.sets - a.sets)[0];
      if (!c) break;
      c.sets--;
    }
    guard = 0;
    while (estimate(S, s) < 12 && guard++ < 20) {
      const c = s.items.filter((it) => it.sets < 3).sort((a, b) => tierOf(S, a.group) - tierOf(S, b.group) || a.sets - b.sets)[0];
      if (c) { c.sets++; if (estimate(S, s) > 15) { c.sets--; break; } continue; }
      const back = cut.shift();
      if (!back) break;
      back.sets = 2; s.items.push(back);
      if (estimate(S, s) > 15) { s.items.pop(); break; }
    }
  }
  function limitExercises(s, max) {
    const main = s.items;
    if (main.length <= max) return;
    // Merge the lowest-priority slots into same-group slots where possible, then cut.
    while (s.items.length > max) {
      const last = s.items[s.items.length - 1];
      const same = s.items.find((it) => it !== last && it.group === last.group);
      if (same) same.sets += last.sets;
      unpair(s, last);
      s.items.pop();
    }
  }
  function groupsOf(s) {
    const g = [];
    for (const it of s.items.concat(s.extras || [])) if (!g.includes(it.group)) g.push(it.group);
    return g;
  }

  /* ---------------- running order for the player */
  // Expands a session into steps: warm-up, tests, sets (supersets interleaved, lead side first),
  // extra lead sets, finisher intervals.
  function steps(S, s) {
    const out = [];
    const lead = (S.catchup.arm.side || 'L');
    for (const w of s.warmup) out.push({ kind: 'warmup', item: w, target: w.target, timed: w.timed });
    for (const t of s.tests || []) {
      const first = t.side || lead;
      out.push({ kind: 'test', item: t, side: first });
      out.push({ kind: 'test', item: t, side: first === 'L' ? 'R' : 'L' });
    }
    const items = s.items;
    const done = new Set();
    const setSteps = (it, k, restAfter) => {
      const sideLead = it.fam && ['squat', 'hinge', 'glute'].includes(it.fam) ? (S.catchup.leg.side || 'L') : lead;
      const base = { kind: 'set', item: it, set: k, of: it.sets };
      if (it.uni) {
        out.push(Object.assign({}, base, { side: sideLead, first: true }));
        out.push(Object.assign({}, base, { side: sideLead === 'L' ? 'R' : 'L', first: false, rest: restAfter }));
      } else out.push(Object.assign({}, base, { rest: restAfter }));
    };
    for (const it of items) {
      if (done.has(it)) continue;
      const partner = it.superset && items.find((x) => x !== it && x.superset && x.superset[0] === it.superset[0]);
      if (partner) {
        done.add(it); done.add(partner);
        const n = Math.max(it.sets, partner.sets);
        for (let k = 0; k < n; k++) {
          if (k < it.sets) setSteps(it, k, k < partner.sets ? 20 : it.rest);
          if (k < partner.sets) setSteps(partner, k, Math.max(it.rest, partner.rest));
        }
      } else {
        done.add(it);
        for (let k = 0; k < it.sets; k++) setSteps(it, k, it.rest);
      }
      // After the curl slot comes the extra lead-side curl set.
      for (const x of s.extras || []) if (x.fam === it.fam || (x.extraKind === 'leg' && ['squat', 'hinge'].includes(it.fam) && !done.has(x))) {
        if (done.has(x)) continue;
        done.add(x);
        out.push({ kind: 'set', item: x, set: 0, of: 1, side: x.leadOnly, first: true, leadOnly: true, rest: x.rest });
      }
    }
    for (const x of s.extras || []) if (!done.has(x)) out.push({ kind: 'set', item: x, set: 0, of: 1, side: x.leadOnly, first: true, leadOnly: true, rest: x.rest });
    if (s.finisher) for (let r = 0; r < s.finisher.rounds; r++) out.push({ kind: 'interval', item: s.finisher, round: r, of: s.finisher.rounds, work: s.finisher.work, rest: r < s.finisher.rounds - 1 ? s.finisher.rest : 0, side: s.finisher.uni ? (r % 2 === 0 ? lead : lead === 'L' ? 'R' : 'L') : null });
    for (const mb of s.mobility || []) out.push({ kind: 'cooldown', item: mb, target: mb.target, timed: true });
    // Mark each item's last set so the player asks the reps-in-reserve question there.
    const lastIdx = new Map();
    out.forEach((st, i) => { if (st.kind === 'set' || st.kind === 'interval') lastIdx.set(st.item, i); });
    for (const [, i] of lastIdx) out[i].askRir = true;
    return out;
  }

  /* ================================================================== running a workout */
  function startWorkout(S, day, opts) {
    const o = opts || {};
    const cal = calendar(S, day);
    const plan = todayPlan(S, day, cal);
    if (plan.type === 'done') return { error: 'done' };
    let tplIdx = plan.type === 'workout' ? plan.tpl : null;
    if (tplIdx == null) {
      // Training on a light day pulls the next session forward.
      const next = plan.next;
      if (!next) return { error: 'none' };
      S.events.push({ type: 'move', from: next.day, to: day, at: day });
      tplIdx = next.tpl;
    }
    const session = buildSession(S, day, tplIdx, { short: o.short, cal: calendar(S, day) });
    const st = steps(S, session);
    S.active = {
      day, tpl: tplIdx, startedAt: o.now || Date.now(), short: !!o.short, session, steps: st, idx: 0,
      logs: session.items.concat(session.extras).map((it) => ({ fam: it.fam, moveId: it.moveId, kind: it.kind, target: it.target, sets: [], rir: null, timed: it.timed, group: it.group, uni: it.uni })),
      finisher: session.finisher ? { moveId: session.finisher.moveId, rounds: 0, rir: null } : null,
      tests: {}, warmupDone: 0,
    };
    return { session, steps: st };
  }

  function itemIndex(A, item) {
    const all = A.session.items.concat(A.session.extras);
    return all.indexOf(item);
  }

  // Record one step. result: { reps } | { secs } | { value } (tests)
  function completeStep(S, result) {
    const A = S.active;
    if (!A) return null;
    const st = A.steps[A.idx];
    if (!st) return null;
    const r = result || {};
    if (st.kind === 'set') {
      const i = itemIndex(A, st.item);
      const log = A.logs[i];
      const target = currentTarget(A, st);
      const amount = st.item.timed ? (r.secs != null ? r.secs : target) : (r.reps != null ? r.reps : target);
      log.sets.push({ set: st.set, side: st.side || null, amount, target });
      // Fewer reps than asked lowers what follows; the second side never does more than the first.
      if (amount < target) st.item.curTarget = Math.min(st.item.curTarget || target, amount + (st.item.timed ? 5 : 1));
    } else if (st.kind === 'test') {
      A.tests[st.item.test] = A.tests[st.item.test] || {};
      A.tests[st.item.test][st.side] = r.value || 0;
      const t = A.tests[st.item.test];
      if (t.L != null && t.R != null) {
        const res = recordTest(S, A.day, st.item.test, t.L, t.R);
        A.testLines = (A.testLines || []).concat(res.line);
        // A closed gap drops the extra lead set from this session too.
        if (!res.active) {
          const drop = new Set(A.session.extras.filter((x) => x.extraKind === st.item.test));
          A.steps = A.steps.filter((x, k) => k <= A.idx || !drop.has(x.item));
        }
      }
    } else if (st.kind === 'interval') {
      A.finisher.rounds++;
    } else if (st.kind === 'warmup') A.warmupDone++;
    A.idx++;
    return A.steps[A.idx] || null;
  }

  // Target for a step: the item's (possibly lowered) target; the second side matches the first.
  function currentTarget(A, st) {
    if (st.kind !== 'set') return st.target || (st.item && st.item.target);
    const it = st.item;
    let t = it.curTarget || it.target;
    if (it.uni && st.first === false) {
      const i = itemIndex(A, it);
      const prev = A.logs[i].sets.filter((x) => x.set === st.set);
      if (prev.length) t = Math.min(t, prev[prev.length - 1].amount);
    }
    return t;
  }

  // Correct the amount logged on the step just finished (the rest screen's "Change").
  function amendLast(S, amount) {
    const A = S.active;
    if (!A || A.idx === 0) return false;
    const st = A.steps[A.idx - 1];
    if (!st || st.kind !== 'set') return false;
    const log = A.logs[itemIndex(A, st.item)];
    const last = log && log.sets[log.sets.length - 1];
    if (!last) return false;
    last.amount = Math.max(0, Math.round(amount));
    if (last.amount < last.target) st.item.curTarget = Math.min(st.item.curTarget || last.target, last.amount + (st.item.timed ? 5 : 1));
    return true;
  }

  function setRir(S, item, value) {
    const A = S.active;
    if (!A) return;
    if (item && item.kind === 'finisher') { A.finisher.rir = value; return; }
    const i = itemIndex(A, item);
    if (i >= 0) A.logs[i].rir = value;
  }

  function swapItem(S, item, newMoveId) {
    const A = S.active;
    const m = M().MOVES[newMoveId];
    const st = S.prog[m.family] || {};
    item.moveId = newMoveId; item.name = m.name;
    item.target = clampInt(st.rung === newMoveId ? st.reps : m.start, m.range[0], m.range[1]);
    item.curTarget = null;
    item.timed = !!m.timed; item.uni = !!m.uni; item.load = loadInfo(S, m); item.swapped = true;
    if (A) {
      const i = itemIndex(A, item);
      if (i >= 0) Object.assign(A.logs[i], { moveId: newMoveId, target: item.target, timed: item.timed, uni: item.uni, swapped: true });
      // Re-expand the remaining steps so a unilateral swap gets its side steps.
      const doneSteps = A.steps.slice(0, A.idx);
      const fresh = steps(S, A.session);
      const remaining = [];
      const countDone = new Map();
      for (const s of doneSteps) if (s.kind === 'set') countDone.set(s.item, (countDone.get(s.item) || 0) + 1);
      for (const s of fresh) {
        if (s.kind === 'warmup' || s.kind === 'test') continue;
        if (s.kind === 'set' && countDone.get(s.item) > 0) { countDone.set(s.item, countDone.get(s.item) - 1); continue; }
        if (s.kind === 'interval' && doneSteps.some((d) => d.kind === 'interval' && d.round === s.round)) continue;
        remaining.push(s);
      }
      A.steps = doneSteps.concat(remaining);
    }
  }

  function swapOptions(S, item, day) {
    const m = M().MOVES[item.moveId];
    const group = m.group;
    const avoid = filtersFor(S, day).avoidJoints;
    const ok = (id) => id !== item.moveId && !(M().MOVES[id].joints || []).some((j) => avoid.includes(j));
    const out = [];
    const fam = m.family;
    const list = rungs(S, fam, day);
    const at = list.indexOf(item.moveId);
    if (at > 0 && ok(list[at - 1])) out.push({ id: list[at - 1], why: 'Easier' });
    for (const [f2, lad] of Object.entries(M().LADDERS)) {
      if (f2 === fam || lad.group !== group) continue;
      const l2 = rungs(S, f2, day).filter(ok);
      if (!l2.length) continue;
      const cur = S.prog[f2] && l2.includes(S.prog[f2].rung) ? S.prog[f2].rung : l2[Math.min(l2.length - 1, Math.round((at / Math.max(1, list.length - 1)) * (l2.length - 1)))];
      out.push({ id: cur, why: lad.name });
      if (out.length >= 3) break;
    }
    if (out.length < 3 && at >= 0 && at < list.length - 1 && ok(list[at + 1])) out.push({ id: list[at + 1], why: 'Harder' });
    return out.slice(0, 3).map((o) => Object.assign(o, { name: M().MOVES[o.id].name }));
  }

  /* ================================================================== check-in + adaptation */
  // checkin: { rating: 'easy'|'right'|'hard', complicated: bool, pain: [joints], weightKg?, now? }
  function finishWorkout(S, checkin, day) {
    const A = S.active;
    if (!A) return null;
    const c = checkin || {};
    const cal = calendar(S, A.day);
    const week = cal.weeks[weekStart(A.day)];
    const deload = !!(week && week.phase.deload);
    const lines = [];
    const celebrate = [];
    const planned = A.session.items.reduce((a, it) => a + it.sets, 0) + A.session.extras.length;
    const doneSets = A.logs.reduce((a, l) => a + new Set(l.sets.map((x) => x.set + (l.kind === 'extra' ? 'x' : ''))).size, 0);
    const pct = planned ? Math.min(1, doneSets / planned) : 1;
    // 1. Reps and rungs from the per-exercise answers.
    for (let i = 0; i < A.logs.length; i++) {
      const log = A.logs[i];
      if (log.kind !== 'move' || !log.sets.length) continue;
      const res = progress(S, log, deload, A.day);
      if (res.line) lines.push(res.line);
      for (const c2 of res.celebrate || []) celebrate.push(c2);
    }
    if (A.finisher && A.finisher.rir) {
      const st = S.prog.finisher || (S.prog.finisher = { rung: A.finisher.moveId, reps: 0, best: {} });
      if (A.finisher.rir === '3' && !deload) {
        st.fmt = Math.min(4, (st.fmt || 0) + 1);
        lines.push({ text: 'Finisher: longer work intervals next time', why: 'you had plenty left' });
      }
    }
    if (deload) lines.push({ text: 'Progress held this week', why: 'deload week' });
    // 2. Overall rating → volume.
    const prog = programFor(S.profile);
    const tier1 = GROUPS.filter((g) => prog.tiers[g] === 1);
    const r = readinessAtStart(A) || readiness(S, A.day);
    if (c.rating === 'easy') {
      S.hardStreak = 0;
      const bumped = tier1.filter((g) => { if (S.vol[g] < prog.cap[g]) { S.vol[g]++; return true; } return false; });
      if (bumped.length) lines.push({ text: `${listNames(bumped)} +1 set a week`, why: 'you rated it too easy' });
    } else if (c.rating === 'hard') {
      S.hardStreak = (S.hardStreak || 0) + 1;
      if (S.hardStreak >= 2) {
        S.hardStreak = 0;
        let any = false;
        for (const g of GROUPS) if (S.vol[g] > prog.floor[g]) { S.vol[g]--; any = true; }
        if (any) lines.push({ text: 'One less set per muscle each week', why: 'too hard twice in a row' });
      }
      if (r.badSleep || r.low) {
        // Too hard with bad sleep keeps showing up → deload next week.
        const recent = workoutLogs(S).filter((l) => l.day > A.day - 14 && l.checkin && l.checkin.rating === 'hard' && (l.readiness && (l.readiness.badSleep || l.readiness.low)));
        const nextWs = weekStart(A.day) + 7;
        const already = S.events.some((e) => e.type === 'deloadNext' && weekStart(e.day) + 7 === nextWs);
        if (recent.length + 1 >= 2 && !already && !deload) {
          S.events.push({ type: 'deloadNext', day: A.day });
          lines.push({ text: 'Deload next week: about 40% less volume', why: 'too hard with poor recovery, twice in two weeks' });
        }
      }
    } else if (c.rating === 'right') S.hardStreak = 0;
    // 3. Complexity.
    if (c.complicated === true) {
      if (S.complexity < 2) {
        S.complexity++;
        S.noStreak = 0;
        lines.push({ text: 'Simpler moves, fewer exercises, shorter cues', why: 'you said it was too complicated' });
        for (const fam of Object.keys(S.prog)) {
          const st = S.prog[fam];
          const m = M().MOVES[st.rung];
          if (!m || !m.complex) continue;
          const list = rungs(S, fam, A.day, { simple: true });
          const all = M().LADDERS[fam].rungs;
          const lower = list.filter((x) => all.indexOf(x) < all.indexOf(st.rung)).pop();
          if (lower) { st.rung = lower; st.reps = M().MOVES[lower].range[1]; lines.push({ text: `${m.name} → ${M().MOVES[lower].name}`, why: 'simpler version' }); }
        }
      }
    } else if (c.complicated === false) {
      S.noStreak = (S.noStreak || 0) + 1;
      if (S.noStreak >= 3 && S.complexity > 0) { S.complexity--; S.noStreak = 0; lines.push({ text: 'Back to the full exercise list', why: 'three workouts in a row felt clear' }); }
    }
    // 4. Pain → 14-day swaps.
    for (const j of c.pain || []) {
      if (!JOINTS.includes(j)) continue;
      S.pain[j] = A.day + 14;
      lines.push({ text: `${cap(j)} break until ${fmtDay(A.day + 14, false)}: moves that load it are swapped out`, why: `your ${j} hurt` });
    }
    // 5. Weight.
    if (c.weightKg) {
      addWeight(S, A.day, c.weightKg, 'manual');
    }
    const ws = weightStats(S, A.day);
    if (ws.warn) lines.push({ text: ws.warn, why: ws.why });
    // 6. Tests done during the workout.
    for (const t of A.testLines || []) lines.push({ text: t, why: 'left vs right test' });
    // 7. Save the log.
    const entry = {
      type: 'workout', day: A.day, tpl: A.tpl, startedAt: A.startedAt, endedAt: c.now || Date.now(), short: A.short,
      title: A.session.title, items: A.logs, finisher: A.finisher, pct, planned, doneSets, checkedIn: true,
      checkin: { rating: c.rating || null, complicated: c.complicated == null ? null : c.complicated, pain: c.pain || [] },
      readiness: { badSleep: !!r.badSleep, low: !!r.low, minus: r.minus || 0 }, phase: A.session.phase, lines, celebrate,
    };
    S.log = S.log.filter((l) => !(l.type === 'workout' && l.day === A.day));
    S.log.push(entry);
    S.active = null;
    // 8. Weekly volume growth (completed non-deload weeks with no "too hard").
    const vlines = weeklyVolumeUpdate(S, A.day);
    for (const l of vlines) lines.push(l);
    return { entry, lines, celebrate, done: pct >= 0.5 };
  }
  function readinessAtStart(A) { return A.session && A.session.readiness; }
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  function listNames(groups) {
    const n = groups.map((g) => GROUP_NAME[g].toLowerCase());
    if (groups.includes('biceps') && groups.includes('triceps')) { n.splice(n.indexOf('biceps'), 1); n.splice(n.indexOf('triceps'), 1, 'arms'); }
    const s = n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
    return cap(s);
  }

  // Per-exercise progression from the reps-in-reserve answer.
  function progress(S, log, deload, day) {
    const m = M().MOVES[log.moveId];
    const fam = m.family;
    const st = S.prog[fam];
    if (!st) return {};
    const res = { celebrate: [] };
    const firstSide = log.uni ? log.sets.filter((_, k) => k % 2 === 0) : log.sets;
    const best = Math.max(...firstSide.map((x) => x.amount));
    // PRs: best reps (or hold) at this rung, celebrated once each.
    const prKey = log.moveId;
    const prevBest = st.best[prKey] || 0;
    if (best > prevBest) {
      st.best[prKey] = best;
      const key = `pr:${prKey}:${best}`;
      if (prevBest > 0 && !S.celebrated[key]) { S.celebrated[key] = day; res.celebrate.push({ kind: 'pr', text: `New best: ${best}${log.timed ? ' s' : ''} ${m.name.toLowerCase()}` }); }
    }
    if (st.cooldown > 0) st.cooldown--;
    if (log.moveId !== st.rung) return res; // a swap: its own ladder is not moved
    if (deload) return res;
    const [lo, hi] = m.range;
    const target = log.target;
    const allHit = firstSide.every((x) => x.amount >= target) && firstSide.length > 0;
    const avg = firstSide.reduce((a, x) => a + x.amount, 0) / Math.max(1, firstSide.length);
    const unit = log.timed ? ' s' : ' reps';
    const name = m.name;
    if (log.rir === '3') {
      if (st.reps >= hi && allHit) {
        const up = levelUp(S, fam, day);
        if (up) { res.line = up.line; if (up.celebrate) res.celebrate.push(up.celebrate); }
      } else if (allHit) {
        const next = Math.min(hi, st.reps + (log.timed ? 10 : 2));
        if (next !== st.reps) { st.reps = next; res.line = { text: `${name} → ${next}${unit}`, why: 'you had 3+ left' }; }
      }
    } else if (log.rir === '12') {
      if (allHit) {
        const next = Math.min(hi, st.reps + (log.timed ? 5 : st.reps < 12 ? 1 : 2));
        if (next !== st.reps) { st.reps = next; res.line = { text: `${name} → ${next}${unit}`, why: 'you had 1-2 left' }; }
      }
    }
    if (!allHit) {
      if (avg < lo) {
        st.short = (st.short || 0) + 1;
        if (st.short >= 2) {
          const list = rungs(S, fam, day);
          const all = M().LADDERS[fam].rungs;
          const lower = list.filter((x) => all.indexOf(x) < all.indexOf(st.rung)).pop();
          if (lower) {
            const lm = M().MOVES[lower];
            st.rung = lower; st.reps = clampInt(Math.round((lm.range[0] + lm.range[1]) / 2), lm.range[0], lm.range[1]); st.short = 0; st.cooldown = 2;
            res.line = { text: `${name} → ${lm.name}`, why: 'below the rep range twice' };
          }
        } else {
          st.reps = Math.max(lo, Math.round(avg));
          res.line = { text: `${name} → ${st.reps}${unit}`, why: 'matching what you got' };
        }
      } else {
        st.short = 0;
        const nt = Math.max(lo, Math.round(avg));
        if (nt < st.reps) { st.reps = nt; res.line = { text: `${name} → ${nt}${unit}`, why: 'matching what you got' }; }
      }
    } else st.short = 0;
    return res;
  }

  // Top of the range with 3+ left: heavier weight, then the next rung, then a buy suggestion.
  function levelUp(S, fam, day) {
    const st = S.prog[fam];
    const m = M().MOVES[st.rung];
    const eq = S.profile.equipment;
    const key = M().loadFor(m, eq);
    const weights = key === 'db' || key === 'kb' ? (eq[key] || []).slice().sort((a, b) => a - b) : [];
    const unit = S.profile.units || 'lb';
    if (weights.length > 1 && (st.w || 0) < weights.length - 1) {
      st.w = (st.w || 0) + 1;
      st.reps = clampInt(m.range[0] + 2, m.range[0], m.range[1]);
      return { line: { text: `${m.name} → ${fmtNum(weights[st.w])} ${unit}`, why: 'you had 3+ left every set' }, celebrate: { kind: 'weight', text: `Heavier: ${fmtNum(weights[st.w])} ${unit} ${m.name.toLowerCase()}` } };
    }
    const list = rungs(S, fam, day);
    const at = list.indexOf(st.rung);
    if (at >= 0 && at < list.length - 1 && !(st.cooldown > 0)) {
      const nextId = list[at + 1];
      const nm = M().MOVES[nextId];
      st.rung = nextId;
      st.reps = clampInt(nm.start, nm.range[0], nm.range[1]);
      if (weights.length > 1) st.w = Math.max(0, (st.w || 0) - 1);
      const all = M().LADDERS[fam].rungs.filter((x) => list.includes(x));
      return { line: { text: `${m.name} → ${nm.name}`, why: 'you had 3+ left every set' }, celebrate: { kind: 'level', text: `${M().LADDERS[fam].name}: level ${all.indexOf(nextId) + 1} of ${all.length}` } };
    }
    if (!st.maxed && key && (key === 'db' || key === 'kb')) {
      st.maxed = true;
      const next = nextWeight(key, weights[weights.length - 1], unit);
      return { line: { text: `You maxed ${M().LADDERS[fam].name.toLowerCase()} with ${fmtNum(weights[weights.length - 1])} ${unit}. Next buy: ${next} ${unit} ${key === 'db' ? 'dumbbells' : 'kettlebell'}`, why: 'top rung, top reps, 3+ left', buy: true } };
    }
    return null;
  }
  function nextWeight(key, cur, unit) {
    const sizes = unit === 'kg'
      ? (key === 'db' ? [2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 25] : [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32])
      : (key === 'db' ? [5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50] : [10, 15, 18, 20, 26, 35, 44, 53, 62, 70]);
    const factor = key === 'db' ? 1.4 : 1.75;
    return sizes.find((s) => s >= cur * factor) || sizes[sizes.length - 1];
  }

  // Completed, non-deload weeks with no "too hard": +1 weekly set for tier-1 groups.
  function weeklyVolumeUpdate(S, day) {
    const lines = [];
    const cal = calendar(S, day);
    const prog = programFor(S.profile);
    const tier1 = GROUPS.filter((g) => prog.tiers[g] === 1);
    for (const [wsStr, w] of Object.entries(cal.weeks)) {
      const ws = Number(wsStr);
      if (ws + 6 >= day || (S.volWeeksDone || []).includes(ws)) continue;
      S.volWeeksDone = (S.volWeeksDone || []).concat(ws);
      if (w.phase.deload || !w.allDone) continue;
      const hard = workoutLogs(S).some((l) => l.day >= ws && l.day <= ws + 6 && l.checkin && l.checkin.rating === 'hard');
      if (hard) continue;
      const bumped = tier1.filter((g) => { if (S.vol[g] < prog.cap[g]) { S.vol[g]++; return true; } return false; });
      if (bumped.length) lines.push({ text: `${listNames(bumped)} +1 set a week`, why: 'a full week with no "too hard"' });
    }
    return lines;
  }

  /* ================================================================== light days */
  function logLight(S, day, part, value) {
    let l = S.log.find((x) => x.type === 'light' && x.day === day);
    if (!l) { l = { type: 'light', day, walk: false, mobility: false }; S.log.push(l); }
    l[part] = value !== false;
    if (part === 'walk' && typeof value === 'string') l.walkSrc = value;
    return l;
  }
  // Steps or a walking session from Health Connect can tick the walk.
  function autoWalk(S, day) {
    const h = S.health && S.health.days && S.health.days[day];
    if (!h) return false;
    const walked = (h.exercise || []).some((e) => /walk/i.test(e.typeName || '') && e.minutes >= 10);
    let avg7 = 0, n = 0;
    for (let d = day - 7; d < day; d++) { const x = S.health.days[d]; if (x && x.steps != null) { avg7 += x.steps; n++; } }
    avg7 = n ? avg7 / n : 0;
    const stepsHit = h.steps != null && h.steps >= Math.max(3000, avg7 + 1200);
    if (walked || stepsHit) { const l = logLight(S, day, 'walk', walked ? 'health-walk' : 'health-steps'); return l; }
    return false;
  }

  /* ================================================================== weight + protein */
  function addWeight(S, day, kg, src) {
    S.weights = S.weights.filter((w) => !(w.day === day && w.src === src));
    S.weights.push({ day, kg: Math.round(kg * 100) / 100, src });
    S.weights.sort((a, b) => a.day - b.day);
  }
  function weightStats(S, day) {
    const w = S.weights.filter((x) => x.day <= day);
    const avg = (from, to) => { const v = w.filter((x) => x.day >= from && x.day <= to).map((x) => x.kg); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const avg7 = avg(day - 6, day);
    const prev7 = avg(day - 13, day - 7);
    const prev14 = avg(day - 20, day - 14);
    const last = w.length ? w[w.length - 1].kg : S.profile.weightKg || null;
    const rate = avg7 != null && prev7 != null ? (avg7 - prev7) / prev7 : null;
    const out = { avg7, prev7, last, current: avg7 || last, rate };
    const goal = S.profile.weightGoal || 'maintain';
    if (rate != null && rate < -0.01 && goal !== 'gain') { out.warn = 'Eat more: you\'re losing more than 1% a week'; out.why = 'weight trend'; }
    if (goal === 'gain' && avg7 != null && prev14 != null && avg7 <= prev14) { out.warn = 'Eat more: your weight hasn\'t moved up in two weeks'; out.why = 'weight trend'; }
    return out;
  }
  function proteinGoal(S, day) {
    const ws = weightStats(S, day);
    const kg = ws.current;
    if (!kg) return null;
    return Math.round((S.profile.protein.perLb || 0.8) * kg * LB_PER_KG);
  }
  function proteinToday(S, day) { return (S.protein[day] || []).reduce((a, b) => a + b, 0); }
  function addProtein(S, day, g) { (S.protein[day] = S.protein[day] || []).push(Math.round(g)); }
  function undoProtein(S, day) { if (S.protein[day] && S.protein[day].length) S.protein[day].pop(); }

  /* ================================================================== weekly summaries */
  function weeklySets(S, day) {
    const ws = weekStart(day);
    const cal = calendar(S, day);
    const week = cal.weeks[ws];
    const mult = week ? week.phase.mult : 1;
    const out = {};
    for (const g of GROUPS) out[g] = { done: 0, target: Math.round(S.vol[g] * mult), planned: 0 };
    for (const l of workoutLogs(S)) {
      if (l.day < ws || l.day > ws + 6 || !l.checkedIn) continue;
      for (const it of l.items) {
        if (it.kind !== 'move' || !out[it.group]) continue;
        out[it.group].done += new Set(it.sets.map((x) => x.set)).size;
      }
    }
    if (week) {
      for (const s of week.sessions) {
        if (s.dropped || s.day == null) continue;
        const sess = buildSession(S, s.day, s.tpl, { cal, noReadiness: true });
        for (const it of sess.items) if (out[it.group]) out[it.group].planned += it.sets;
      }
    }
    return out;
  }

  // Setting changes take effect from today; the replay uses the settings in force each week.
  function updateSettings(S, day, patch) {
    Object.assign(S.profile, patch);
    return scheduleSettings(S, day, { days: S.profile.days, weekdays: S.profile.weekdays, minutes: S.profile.minutes });
  }
  function moveSession(S, from, to, today) {
    if (to < today || from < today) return false;
    const cal = calendar(S, today);
    const w = cal.weeks[weekStart(from)];
    if (!w || weekStart(to) !== weekStart(from)) return false;
    if (w.sessions.some((x) => x.day === to && !x.dropped)) return false;
    if (!w.sessions.some((x) => x.day === from && !x.done && !x.dropped)) return false;
    S.events.push({ type: 'move', from, to, at: today });
    return true;
  }

  // Equipment changes: heavier weights drop those ladders two rungs.
  function setEquipment(S, eq, day) {
    const old = S.profile.equipment;
    const lines = [];
    const maxOf = (k, e) => (e[k] && e[k].length ? Math.max(...e[k]) : 0);
    S.profile.equipment = Object.assign({}, old, eq);
    for (const [fam, st] of Object.entries(S.prog)) {
      const m = M().MOVES[st.rung];
      const key = m && M().loadFor(m, S.profile.equipment);
      if (key === 'db' || key === 'kb') {
        if (maxOf(key, S.profile.equipment) > maxOf(key, old)) {
          const list = rungs(S, fam, day);
          const at = Math.max(0, list.indexOf(st.rung) - 2);
          st.rung = list[at] || st.rung; st.reps = M().MOVES[st.rung].start; st.maxed = false;
          const ws = (S.profile.equipment[key] || []).slice().sort((a, b) => a - b);
          st.w = Math.max(0, ws.length - 1);
          lines.push({ text: `${M().LADDERS[fam].name} → ${M().MOVES[st.rung].name}`, why: 'heavier equipment' });
        }
      }
    }
    // Ladders that lost their current rung move to the nearest available one.
    for (const fam of Object.keys(M().LADDERS)) {
      const list = rungs(S, fam, day);
      if (!list.length) continue;
      if (!S.prog[fam]) { S.prog[fam] = { rung: list[0], reps: M().MOVES[list[0]].start, w: 0, best: {}, short: 0, cooldown: 0 }; continue; }
      if (!list.includes(S.prog[fam].rung)) {
        const all = M().LADDERS[fam].rungs;
        const at = all.indexOf(S.prog[fam].rung);
        const id = list.filter((x) => all.indexOf(x) <= at).pop() || list[0];
        S.prog[fam].rung = id; S.prog[fam].reps = M().MOVES[id].start;
      }
    }
    return lines;
  }

  // "Update my answers": rebuild targets for new goals/experience but keep progress and history.
  function reprogram(S, profilePatch, day) {
    const before = programFor(S.profile);
    Object.assign(S.profile, profilePatch);
    const after = programFor(S.profile);
    for (const g of GROUPS) {
      if (after.tiers[g] !== before.tiers[g]) S.vol[g] = after.start[g];
      S.vol[g] = Math.max(after.floor[g], Math.min(after.cap[g], S.vol[g]));
    }
    if (profilePatch.equipment) setEquipment(S, profilePatch.equipment, day);
    return scheduleSettings(S, day, { days: S.profile.days, weekdays: S.profile.weekdays, minutes: S.profile.minutes });
  }

  function ladderLevel(S, fam, day) {
    const list = rungs(S, fam, day == null ? S.profile.startDay : day);
    const st = S.prog[fam];
    if (!st) return null;
    const at = list.indexOf(st.rung);
    return { level: at + 1, of: list.length, rung: st.rung, reps: st.reps, name: M().MOVES[st.rung].name };
  }

  GH.brain = {
    DAY_MS, dayOf, dayFromStr, dayStr, weekday, weekStart, fmtDay, fmtMin, GROUPS, GROUP_NAME, JOINTS, LB_PER_KG,
    defaultProfile, programFor, templateFor, templateTitle, newState, applyBaseline, rungs, filtersFor,
    calendar, weekOf, todayPlan, readiness, buildSession, estimate, steps, startWorkout, completeStep, currentTarget,
    setRir, amendLast, swapItem, swapOptions, finishWorkout, progress, levelUp, nextWeight, weeklyVolumeUpdate, recordTest, testDue,
    logLight, autoWalk, addWeight, weightStats, proteinGoal, proteinToday, addProtein, undoProtein, weeklySets,
    updateSettings, scheduleSettings, settingsAt, moveSession, setEquipment, reprogram, ladderLevel, mobilityFlow, loadInfo, isDone, relink, median,
  };
})(typeof window !== 'undefined' ? window : globalThis);
