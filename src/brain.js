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
  // (impact, posture and power: practice for older bodies and bones, src/access.js, outside the
  // muscle groups' weekly sets like balance.)
  const GROUP_NAME = { biceps: 'Biceps', triceps: 'Triceps', abs: 'Abs', chest: 'Chest', legs: 'Legs', back: 'Back', shoulders: 'Shoulders', conditioning: 'Conditioning', mobility: 'Mobility', balance: 'Balance', impact: 'Impact', posture: 'Posture', power: 'Power' };
  const GOAL_GROUPS = { abs: ['abs'], arms: ['biceps', 'triceps'], chest: ['chest'], legs: ['legs'], back: ['back'], shoulders: ['shoulders'] };
  const UNIT_OF = { biceps: 'arms', triceps: 'arms', abs: 'abs', chest: 'chest', legs: 'legs', back: 'back', shoulders: 'shoulders' };
  const UNIT_GROUPS = { arms: ['biceps', 'triceps'], abs: ['abs'], chest: ['chest'], legs: ['legs'], back: ['back'], shoulders: ['shoulders'] };
  const PATTERNS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const LEVEL = { never: 0, onoff: 0, lt1: 1, '1to3': 1, '3plus': 2 };
  const JOINTS = ['knee', 'shoulder', 'back', 'wrist', 'elbow', 'hip', 'ankle', 'neck'];
  const CORE_ROTATION = [['abs', 'coreRot'], ['absLoad', 'coreSide'], ['abs', 'coreSide'], ['absLoad', 'coreRot']];
  const CORE_ONE = ['abs', 'coreSide', 'absLoad', 'coreRot'];
  // Which of the 7 groups each of the 17 muscles counts toward: where its sets come from in the
  // plan (rear delts are trained with the back, forearms with curls, hip flexors with abs).
  const MUSCLE_GROUP = {
    chest: 'chest', abs: 'abs', obliques: 'abs', hipFlexors: 'abs', upperBack: 'back', lats: 'back', lowerBack: 'back', rearDelts: 'back',
    glutes: 'legs', quads: 'legs', hamstrings: 'legs', calves: 'legs', biceps: 'biceps', forearms: 'biceps', triceps: 'triceps',
    frontDelts: 'shoulders', sideDelts: 'shoulders',
  };
  // Muscles the person asked to focus on (profile.focus: up to 4 of the 17; may be missing).
  const focusOf = (p) => (p && Array.isArray(p.focus) ? p.focus.filter((m) => MUSCLE_GROUP[m]).slice(0, 4) : []);
  // The muscles each family mainly trains, for leaning a day's sets toward a focus.
  const FAM_FOCUS = {
    push: ['chest', 'triceps'], chestDb: ['chest'], squat: ['quads', 'glutes'], hinge: ['glutes', 'hamstrings', 'lowerBack'], glute: ['glutes'],
    hamCurl: ['hamstrings'], calf: ['calves'], row: ['lats', 'upperBack'], pull: ['lats', 'biceps'], rear: ['rearDelts', 'upperBack'],
    backExt: ['lowerBack'], press: ['frontDelts', 'triceps'], raise: ['sideDelts'], abs: ['abs', 'hipFlexors'], absLoad: ['abs'],
    coreRot: ['obliques'], coreSide: ['obliques'], curl: ['biceps', 'forearms'], triceps: ['triceps'],
    pressG: ['chest', 'triceps'], inclineG: ['chest', 'frontDelts'], flyG: ['chest'], squatG: ['quads', 'glutes'], hingeG: ['hamstrings', 'glutes', 'lowerBack'],
    gluteG: ['glutes'], lungeG: ['quads', 'glutes'], legCurlG: ['hamstrings'], legExtG: ['quads'], calfG: ['calves'], pullG: ['lats'],
    rowG: ['lats', 'upperBack'], rearG: ['rearDelts', 'upperBack'], ohpG: ['frontDelts', 'sideDelts'], raiseG: ['sideDelts'], curlG: ['biceps'], triG: ['triceps'], absG: ['abs'],
  };
  const focusScore = (fam, focus) => (FAM_FOCUS[fam] || []).filter((m) => focus.includes(m)).length;
  const LB_PER_KG = 2.20462;

  /* ================================================================== profile + program */
  function defaultProfile() {
    return {
      onboarded: false, units: 'lb', age: null, sex: null, heightCm: null, weightKg: null,
      goals: [], experience: 'onoff', keptRoutine: false, recentActivity: 'none',
      days: 4, weekdays: null, minutes: 25, lightDays: true,
      equipment: { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: true, wall: true, towel: true, table: false, door: false },
      // Where workouts happen: 'home', 'gym' or 'both' (then Today has a Home / Gym switch), and
      // what the gym has. dbMax is the heaviest dumbbell in the gym's rack, in the person's units.
      where: 'home',
      gym: defaultGym(),
      // What the app is used for: workouts can be switched off (food and health only). Food tracking
      // settings live in profile.food (see food.js).
      workouts: true,
      careful: [], impactOk: true, gentle: false, lead: { arm: null, leg: null },
      weightGoal: 'maintain', protein: { track: true, perLb: 0.8, quickName: 'Shake', quickG: 26 },
      sleepTypical: '6-7', sleepIrregular: false,
      // notify: notifications (src/notify.js), off until the person turns them on; then every kind
      // is on, and the reminder time is worked out (time: minutes after midnight once they set one).
      prefs: {
        supersets: true, rest: 'auto', sound: true, vibrate: true, haptics: true, theme: 'system', density: 0.5, rollHour: 4,
        notify: { on: false, workout: true, move: true, badge: true, sleep: true, comeback: true, time: null },
      },
      startDay: null,
    };
  }

  function defaultGym() {
    return { bb: false, rack: false, bench: false, benchIncline: false, cable: false, pulldown: false, legPress: false, legCurl: false, legExt: false, chestPress: false, shoulderPress: false, pecDeck: false, smith: false, dip: false, ez: false, rower: false, bike: false, treadmill: false, bar: true, dbMax: 0 };
  }
  // One-tap gym set-ups; dbMax is [lb, kg].
  const GYM_PRESETS = {
    full: { name: 'Full gym', eq: { bb: true, rack: true, bench: true, benchIncline: true, cable: true, pulldown: true, legPress: true, legCurl: true, legExt: true, chestPress: true, shoulderPress: true, pecDeck: true, smith: true, dip: true, ez: true, rower: true, bike: true, treadmill: true, bar: true }, dbMax: [100, 50] },
    basic: { name: 'Basic gym', eq: { bb: true, rack: true, bench: true, benchIncline: true, cable: true, pulldown: true, dip: true, ez: true, bar: true, treadmill: true, bike: true }, dbMax: [60, 30] },
    small: { name: 'Hotel or apartment gym', eq: { bench: true, benchIncline: true, cable: true, bar: false, treadmill: true, bike: true }, dbMax: [50, 25] },
  };
  function gymPreset(name, units) {
    const pr = GYM_PRESETS[name];
    if (!pr) return null;
    return Object.assign(defaultGym(), { bar: false }, pr.eq, { dbMax: pr.dbMax[units === 'kg' ? 1 : 0] });
  }

  /* ---------------------------------------------------------------- one piece of work */
  // Planning a week or building a session asks the same questions many times over (which rungs a
  // ladder has today, what a place's kit is). Inside op() the answers are kept until the outermost
  // op() returns; nothing they read changes meanwhile (only S.prog grows, which they don't read).
  let OP = null, opDepth = 0;
  function op(fn) {
    if (opDepth++ === 0) OP = new Map();
    try { return fn(); } finally { if (--opDepth === 0) OP = null; }
  }
  // The answers kept for one state, or for one kind of question (null outside op()).
  function opMap(key) {
    if (!OP) return null;
    let m = OP.get(key);
    if (!m) OP.set(key, (m = new Map()));
    return m;
  }
  const PROGRAMS = {};
  const inOp = () => !!OP;
  const opToken = () => OP; // a different object for each outermost op(), null outside

  // Tiers, frequencies and set targets from the questionnaire. Kept for each set of answers it reads
  // (rungs() asks for it all the time); treat the answer as read-only.
  const programMemo = new Map();
  function programFor(p) {
    const om = opMap(PROGRAMS);
    const kept = om && om.get(p);
    if (kept) return kept;
    const key = JSON.stringify([p.goals, p.focus, p.experience, p.recentActivity, p.days, p.gentle, p.impactOk, p.age, p.conditions, p.oaJoints, p.floorOk, p.jumpsOk, p.fractures, p.retinopathy, !!p.legacyRules]);
    let out = programMemo.get(key);
    if (!out) {
      if (programMemo.size > 64) programMemo.clear();
      out = programOf(p);
      programMemo.set(key, out);
    }
    if (om) om.set(p, out);
    return out;
  }
  function programOf(p) {
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
    // Focus muscles lift the group they belong to one tier (once per group).
    const focus = focusOf(p);
    for (const grp of new Set(focus.map((m) => MUSCLE_GROUP[m]))) if (tiers[grp] > 1) tiers[grp]--;
    const D = clampInt(p.days, 2, 6);
    const freq = {};
    // From 60, muscles that aren't goals train twice a week, their weekly sets shared over both days:
    // one session a week kept strength but not muscle size at 60 to 75 (Bickel et al. 2011). Weeks
    // planned before 1.13's rules started keep once a week (legacyRules, see src/access.js).
    const twice = p.age >= 60 && p.age <= 110 && !p.legacyRules;
    for (const [unit, groups] of Object.entries(UNIT_GROUPS)) {
      const t = Math.min(...groups.map((g) => tiers[g]));
      let f = t === 1 ? 3 : t === 2 ? 2 : 1;
      if (unit === 'back' && t === 3 && tiers.chest <= 2) f = 2; // balance all the pushing
      if (unit === 'shoulders' && t === 3) f = 1;
      if (t === 3 && twice) f = 2;
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
    const out = {
      tiers, freq, start, cap, floor, level: lvl, D, focus,
      finisherPerWeek: cond ? 7 : 2, walkMin: cond ? 20 : 12, mobilityPlus: goals.includes('mobility'),
      onramp, impactOk: p.impactOk !== false && !(p.age >= 60) && !p.gentle,
      warmupMin: p.age >= 40 ? 4 : 2.5,
    };
    // Age and health conditions shift these defaults (src/access.js): impact, warm-up length, a
    // gentler start with a heart condition.
    return GH.access ? GH.access.program(p, out) : out;
  }
  const clampInt = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(x) || lo)));

  // Which muscle units train on which of the week's days: the optimizer's split (src/optimizer.js),
  // the best of every split it compares, or 1.5's when it isn't loaded.
  function templateFor(p, prog) {
    return GH.optimizer ? GH.optimizer.template(p, prog) : templateV1(p, prog);
  }
  // 1.5's split, kept for the weeks planned before 1.6 (see legacyWeek): each unit in turn takes the
  // days that keep the daily load most even, away from its own days before and after.
  function templateV1(p, prog) {
    const D = prog.D;
    const offsets = weekdaysV1(p);
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
    // Order inside each day: your top goals first, while you're fresh (exercises done first get
    // more reps and grow more, Simão et al. 2012), big multi-joint work before smaller muscles on
    // ties, and abs last so a tired core doesn't undercut the heavier lifts.
    const ORDER = ['chest', 'legs', 'back', 'arms', 'shoulders', 'abs'];
    const pri = (u) => (u === 'abs' ? 9 : Math.min(...UNIT_GROUPS[u].map((g) => prog.tiers[g] || 3)));
    for (const d of days) d.units.sort((a, b) => pri(a) - pri(b) || ORDER.indexOf(a) - ORDER.indexOf(b));
    return days.map((d, i) => ({ idx: i, offset: offsets[i], units: d.units }));
  }
  // The weekdays a week's workouts fall on: the days picked (whole days 0-6, each once), or the usual
  // spread for the count. Days picked that don't match the count (a backup from another version,
  // a day listed twice) keep the ones there are and spread the rest (setWorkoutDays).
  function weekdaysFor(p) {
    const D = clampInt(p.days, 2, 6);
    const w = Array.isArray(p.weekdays) ? [...new Set(p.weekdays.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : [];
    if (w.length === D) return w.sort((a, b) => a - b);
    if (w.length) return setWorkoutDays(w, D).weekdays.slice().sort((a, b) => a - b);
    return PATTERNS[D].slice();
  }
  // 1.5's reading, kept so weeks planned before 1.6 replay exactly as they were (see engineFrom).
  function weekdaysV1(p) {
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
    p.gym = Object.assign(defaultGym(), (profile || {}).gym || {});
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
      insightsDismissed: {}, insightsShown: {}, ai: { enabled: false, mode: 'device', reports: [], chat: [] }, volWeeksDone: [], seen: {},
      place: {}, lastPlace: null,
      // Every week is planned by the 1.6 engine (src/optimizer.js); a state saved before 1.6 gets
      // the week after it first loads (the migration there), so earlier weeks replay as they were.
      engineFrom: weekStart(day),
      // And with 1.13's rules for older bodies, osteoporosis and type 2 diabetes (src/access.js).
      rulesFrom: weekStart(day),
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
    row: [['row_db', 'row_band', 'row_towel', 'row_table', 'row_door'], ['row_db', 'row_band', 'row_table', 'row_door'], ['row_chair', 'row_table', 'row_door']],
    pull: [['pull_hang'], ['pull_neg'], ['pull_chin']],
    rear: [['rear_towel', 'rear_band', 'rear_ytw'], ['rear_fly', 'rear_band', 'rear_ytw'], ['rear_fly_slow', 'rear_ytw_hold']],
    raise: [['raise', 'raise_band', 'raise_wall_iso'], ['raise', 'raise_prone_y'], ['raise_slow', 'raise_prone_y']],
    press: [['press_db', 'press_band', 'press_pike_incline'], ['press_db', 'press_band', 'press_pike'], ['press_db_slow', 'press_1arm', 'press_pike']],
    backExt: [['back_birddog'], ['back_superman', 'back_birddog'], ['back_ext', 'back_superman']],
    calf: [['calf_bw'], ['calf_wall_slow', 'calf_bw'], ['calf_load', 'calf_1leg']],
    hamCurl: [['ham_walkout'], ['ham_slide', 'ham_walkout'], ['ham_slide1', 'ham_band_gm', 'ham_slide']],
    abs: [['ab_deadbug'], ['ab_revcrunch'], ['ab_legraise']],
    absLoad: [['abl_crunch'], ['abl_kb', 'abl_crunch'], ['abl_kb_slow', 'abl_crunch']],
    coreRot: [['rot_russian'], ['rot_russian', 'rot_chop'], ['rot_chop', 'rot_russian_up']],
    coreSide: [['side_knee'], ['side_carry', 'side_plank'], ['side_plank']],
    finisher: [['fin_march', 'fin_pulse', 'fin_step_jacks'], ['fin_swing', 'fin_pulse', 'fin_climbers'], ['fin_swing', 'fin_climbers', 'fin_burpee']],
  };

  /* ---------------------------------------------------------------- home and gym */
  // Where a day's workout happens. People who train in both places pick on Today; otherwise it's
  // the last place they picked (a gym-goer who once trained at home isn't sent home forever).
  function placeOf(S, day) {
    const w = S.profile.where || 'home';
    if (w !== 'both') return w;
    return (S.place && S.place[day]) || S.lastPlace || 'gym';
  }
  function setPlace(S, day, place) {
    if (place !== 'home' && place !== 'gym') return;
    S.place = S.place || {};
    S.place[day] = place;
    S.lastPlace = place;
  }
  // A gym's dumbbell rack, lightest to heaviest, in the person's units (always up to the heaviest).
  function dbRack(max, units) {
    const out = [];
    if (!(max > 0)) return out;
    if (units === 'kg') {
      for (let w = 2; w <= Math.min(max, 20); w += 2) out.push(w);
      for (let w = 22.5; w <= max; w += 2.5) out.push(w);
    } else for (let w = 5; w <= max; w += 5) out.push(w);
    if (out[out.length - 1] !== max) out.push(max);
    return out;
  }
  // The "dumbbells up to" choices, and the nearest one after switching units (dbMax is stored in
  // the person's units).
  const DB_MAX_OPTIONS = { lb: [0, 30, 50, 75, 100, 120], kg: [0, 15, 25, 35, 50, 60] };
  function convertDbMax(value, to) {
    if (!(value > 0)) return 0;
    const v = to === 'kg' ? value / LB_PER_KG : value * LB_PER_KG;
    return DB_MAX_OPTIONS[to].filter((x) => x > 0).reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a));
  }
  // Everything available at a place, in the shape moves.js checks. At a gym: its machines and
  // bars, a full dumbbell rack, benches that double as a chair, a wall and a towel.
  function eqAt(S, place) {
    const om = opMap(S);
    if (!om) return eqOf(S, place);
    const k = 'eq|' + place;
    let v = om.get(k);
    if (!v) om.set(k, (v = eqOf(S, place)));
    return v;
  }
  function eqOf(S, place) {
    const p = S.profile;
    // A seated plan always has a seat: the wheelchair, or the chair someone who can't stand for long
    // sits on, whatever the chair box in their kit says.
    if (place !== 'gym') return Array.isArray(p.conditions) && p.conditions.includes('seated') && p.equipment && p.equipment.chair === false ? Object.assign({}, p.equipment, { chair: true }) : p.equipment;
    const g = Object.assign(defaultGym(), p.gym || {});
    const eq = Object.assign({}, g, { db: dbRack(g.dbMax, p.units), kb: [], ball: false, ballLb: null, ballSlam: false, band: false, chair: true, wall: true, towel: true, table: false, door: false, bar: g.bar !== false });
    delete eq.dbMax;
    return eq;
  }
  const eqFor = (S, day) => eqAt(S, placeOf(S, day));

  function filtersFor(S, day, place) {
    const om = opMap(S);
    if (!om) return filtersOf(S, day, place);
    const k = `f|${day}|${place || ''}`;
    let v = om.get(k);
    if (!v) om.set(k, (v = filtersOf(S, day, place)));
    return v;
  }
  function filtersOf(S, day, place) {
    const p = S.profile;
    const avoid = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    return { eq: place ? eqAt(S, place) : eqFor(S, day), noImpact: !programFor(p).impactOk, simple: S.complexity > 0, avoidJoints: avoid, careful: p.careful || [] };
  }
  // The plan tweaks in force (S.profile.planTweaks, checked by src/optimizer.js normTweaks: unknown
  // fields and moves are dropped). Kept for the last tweaks seen, since rungs() reads them constantly.
  const NO_TWEAKS = Object.freeze({ sets: {}, swaps: {}, split: 'auto', rest: 'auto', finisher: 'auto', mobility: 'auto', avoid: [] });
  let twKey = null, twVal = NO_TWEAKS;
  function tweaksOf(S) {
    const t = S && S.profile ? S.profile.planTweaks : null;
    if (!t || typeof t !== 'object' || !GH.optimizer || !GH.optimizer.normTweaks) return NO_TWEAKS;
    const k = JSON.stringify(t);
    if (k !== twKey) { twKey = k; twVal = GH.optimizer.normTweaks(t); }
    return twVal;
  }
  // Rungs this person can use today (equipment, impact, complexity; careful joints drop risky rungs).
  // opts.place checks a specific place instead of the day's.
  function rungs(S, family, day, opts) {
    const om = opMap(S);
    if (!om) return rungsOf(S, family, day, opts);
    const o = opts || {};
    const k = `r|${family}|${day}|${o.place || ''}|${o.noImpact == null ? '' : +o.noImpact}|${o.simple == null ? '' : +o.simple}|${o.noRules ? 1 : 0}`;
    let v = om.get(k);
    if (!v) om.set(k, (v = deepFreeze(rungsOf(S, family, day, opts))));
    return v;
  }
  function rungsOf(S, family, day, opts) {
    const f = filtersFor(S, day, opts && opts.place);
    const o = Object.assign({ noImpact: f.noImpact, simple: f.simple }, opts || {});
    let list = M().rungsFor(family, f.eq, { noImpact: o.noImpact, simple: o.simple });
    if (f.careful.length) list = list.filter((id) => { const m = M().MOVES[id]; return !((m.impact || m.complex) && (m.joints || []).some((j) => f.careful.includes(j))); });
    list = list.filter((id) => !(S.excluded || []).includes(id));
    // Moves a plan tweak leaves out (Make it yours, or a suggestion you accepted).
    const tw = tweaksOf(S);
    if (tw.avoid.length) list = list.filter((id) => !tw.avoid.includes(id));
    // Age and health rules (src/access.js): moves a condition rules out go, and the stand-in
    // ladders stay closed until a plan needs them. opts.noRules skips this (to tell a ladder ruled
    // out by the body from one ruled out by the equipment).
    if (GH.access && !o.noRules) list = GH.access.filterRungs(S, family, list, day);
    return list;
  }
  // The ladder for a slot: the usual one, or its stand-in when a health condition rules every rung
  // of it out (seated band presses for push-ups with painful wrists), or a gentler one that suits
  // the person better (src/access.js).
  function famFor(S, fam, day) {
    if (!GH.access) return fam;
    const om = opMap(S);
    if (!om) return GH.access.famFor(S, fam, day);
    const k = `ff|${fam}|${day}`;
    let v = om.get(k);
    if (!v) om.set(k, (v = GH.access.famFor(S, fam, day)));
    return v;
  }

  const isGymFam = (fam) => !!(M().LADDERS[fam] && M().LADDERS[fam].gym);
  // Gym families start the first time they're used (at the gym, where their moves exist); so does a
  // home family a saved state doesn't have yet (added in an update, or newly possible with new kit),
  // at the usual starting rung for the person's level.
  function ensureProg(S, fam, day) {
    if (S.prog[fam]) return S.prog[fam];
    if (!M().LADDERS[fam]) return null;
    const list = rungs(S, fam, day);
    if (!list.length) return null;
    if (!isGymFam(fam)) {
      // Where this body starts (src/access.js; stand-in ladders start the first time a plan uses
      // them), else the usual starting rung for the person's level, as initProgress does.
      const prefs = (DEFAULT_START[fam] || [[]])[programFor(S.profile).level] || [];
      const id = (GH.access && GH.access.startRung(S, fam, list)) || prefs.find((x) => list.includes(x)) || list[0];
      S.prog[fam] = { rung: id, reps: M().MOVES[id].start, w: 0, best: {}, short: 0, cooldown: 0, maxed: false };
      return S.prog[fam];
    }
    const m = M().MOVES[list[0]];
    S.prog[fam] = { rung: list[0], reps: m.start, best: {}, loads: {}, e1rm: {}, short: 0, cooldown: 0, flat: 0, gym: true };
    return S.prog[fam];
  }

  function initProgress(S, baseline, day) {
    const lvl = programFor(S.profile).level;
    for (const fam of Object.keys(M().LADDERS)) {
      if (isGymFam(fam)) continue;
      const list = rungs(S, fam, day, { place: 'home' });
      if (!list.length) continue;
      const prefs = (DEFAULT_START[fam] || [[]])[lvl] || [];
      const id = (GH.access && GH.access.startRung(S, fam, list)) || prefs.find((x) => list.includes(x)) || list[0];
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
    if (GH.access && !GH.access.testsOk(S, kind, day)) return false;
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

  /* ---------------------------------------------------------------- caches */
  // Answers worked out from the state (the calendar, the week's plan, sessions) are kept until
  // something they read changes. stateStamp is a cheap fingerprint of every part of the state the
  // plan reads, with the long logs cut down to what matters, so asking again costs one stamp.
  // Cached answers are shared: treat them as read-only (tests freeze them to make sure).
  let FREEZE = false;
  function deepFreeze(o) {
    if (!FREEZE || !o || typeof o !== 'object' || Object.isFrozen(o)) return o;
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
    return o;
  }
  function freeze(on) { FREEZE = !!on; if (GH.optimizer && GH.optimizer.freeze) GH.optimizer.freeze(on); }
  function progStamp(S) {
    let s = '';
    const prog = S.prog || {};
    for (const k of Object.keys(prog).sort()) {
      const st = prog[k] || {};
      s += `${k}:${st.rung}:${st.reps}:${st.w || 0}:${st.fmt || 0}:${st.cooldown || 0}${st.loads ? JSON.stringify(st.loads) : ''};`;
    }
    return s;
  }
  function stateStamp(S) {
    let lg = '';
    // (A workout's sets count too: the next week's plan reads what the last one trained.)
    for (const l of S.log || []) if (l && (l.type === 'workout' || l.type === 'light')) lg += `${l.type[0]}${l.day}.${l.checkedIn ? 1 : 0}${(l.pct || 0) >= 0.5 ? 1 : 0}${l.walk ? 1 : 0}${l.mobility ? 1 : 0}${l.doneSets || 0};`;
    const ev = (S.events || []).filter((e) => e && (e.type === 'settings' || e.type === 'move' || e.type === 'deloadNext' || e.type === 'plan'));
    return JSON.stringify([planProfile(S.profile), S.vol, S.complexity, S.pain, S.excluded, S.catchup, S.place, S.lastPlace, S.engineFrom, S.rulesFrom, ev, S.customPlans, S.activePlan]) + progStamp(S) + lg;
  }
  // The workouts a week's plan reads, in short (the week's own and the week before's, what they
  // trained), and the changes to the schedule made in those weeks. A week that's over keeps its plan
  // (src/optimizer.js, keptOf) only while these stay as they were: one done or changed later (a
  // history built day by day, an edit) plans it again.
  function weekLog(S, ws) {
    let s = '';
    const inWeeks = (d) => typeof d === 'number' && d >= ws - 7 && d <= ws + 6;
    for (const l of S.log || []) if (l && l.type === 'workout' && inWeeks(l.day)) s += `${l.day}.${l.tpl}.${l.checkedIn ? 1 : 0}${(l.pct || 0) >= 0.5 ? 1 : 0}.${l.doneSets || 0};`;
    for (const e of S.events || []) if (e && (e.type === 'settings' || e.type === 'move' || e.type === 'deloadNext' || e.type === 'plan') && (inWeeks(e.day) || inWeeks(e.from) || inWeeks(e.to) || inWeeks(e.at))) s += JSON.stringify(e);
    return s;
  }
  // The profile as plans read it: without the preferences only the screens read (the figure, the
  // theme, sounds and haptics, the outdoor activity's, notifications), so changing one keeps every
  // plan worked out (and the plans kept across launches, see src/optimizer.js). Rest, supersets and
  // the hour a day rolls over do change plans, and so does anything new.
  const SCREEN_PREFS = new Set(['figure', 'figSkin', 'figShirt', 'theme', 'density', 'sound', 'vibrate', 'haptics', 'hapticStrength', 'reducedMotion', 'actType', 'actStreets', 'actMaps', 'actAuto', 'actVoice', 'notify']);
  function planProfile(p) {
    if (!p || !p.prefs || typeof p.prefs !== 'object') return p;
    const prefs = {};
    for (const k of Object.keys(p.prefs)) if (!SCREEN_PREFS.has(k)) prefs[k] = p.prefs[k];
    return Object.assign({}, p, { prefs });
  }
  // What a single day's session also reads: the health days readiness looks at, how you said you
  // feel (a flare day too) and the sleep chip.
  function dayStamp(S, day) {
    const h = (S.health && S.health.days) || {};
    const w = [];
    for (let d = day - 14; d <= day; d++) if (h[d]) w.push(d, h[d].rhr, h[d].hrv, h[d].sleepMin, h[d].exercise);
    return [w, S.feel && S.feel[day], S.sleepChip && S.sleepChip[day]];
  }

  // Replays the schedule from the start date up to `today`. Pure: same inputs, same answer (kept for
  // the same state and day; read-only).
  const calendarMemo = new WeakMap();
  function calendar(S, today) {
    const key = today + '|' + stateStamp(S);
    let m = calendarMemo.get(S);
    if (m && m.has(key)) return m.get(key);
    const out = deepFreeze(op(() => replay(S, today)));
    if (!m) calendarMemo.set(S, (m = new Map()));
    if (m.size > 8) m.delete(m.keys().next().value);
    m.set(key, out);
    return out;
  }
  function replay(S, today) {
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
      const tpl = templateOf(S, ws, set);
      // Phase for this week, from history only.
      const idle = lastWorkoutDay != null && ws - lastWorkoutDay >= 7 + 1;
      let deload = false;
      if (deloadReq.has(ws)) deload = true;
      else if (sinceDeload >= 4 && trainingWeeks >= 4) deload = true;
      const onramp = !deload && (trainingWeeks < prog.onramp.weeks || idle);
      const mult = deload ? 0.6 : onramp ? (idle && trainingWeeks >= prog.onramp.weeks ? 0.7 : prog.onramp.mult) : 1;
      // Sessions for the week.
      // [custom plans] Days a custom plan runs take their sessions from it (src/customplan.js).
      const custom = GH.customPlan ? GH.customPlan.weekSessions(S, ws, tpl) : null;
      let sessions = (custom || tpl.map((t) => ({ tpl: t.idx, units: t.units, day: ws + t.offset, planned: ws + t.offset })))
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
          // [custom plans] In a week that switches plans, only this plan's sessions move, up to its last day.
          const pending = sessions.filter((x) => !x.done && !x.dropped && x.day >= d && x.regime === s.regime);
          for (let i = pending.length - 1; i >= 0; i--) {
            pending[i].day += 1;
            if (pending[i].day > (pending[i].until != null ? pending[i].until : ws + 6)) { pending[i].dropped = true; pending[i].day = null; }
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
  // ctx: { occ: which of the week's sessions with this unit it is, prog }.
  function slotsForUnit(unit, sets, S, dayIdx, day, ctx) {
    const c = ctx || {};
    // A ladder counts when it, or the stand-in a health condition swaps in for it (src/access.js),
    // has rungs today.
    const has = (fam) => rungs(S, famFor(S, fam, day), day).length > 0;
    const focus = focusOf(S.profile);
    const prog = c.prog || programFor(S.profile);
    // Rotations advance by session and by week, so every option comes round.
    const rot = (c.occ || 0) + Math.floor(weekStart(day) / 7);
    // Calves get sets of their own when they're a focus or legs are a top goal.
    const calfFocus = focus.includes('calves');
    const calfSets = (fam) => (has(fam) && ((calfFocus && sets >= 3) || (prog.tiers.legs === 1 && sets >= 4)) ? (calfFocus && sets >= 7 ? 2 : 1) : 0);
    if (placeOf(S, day) === 'gym') { const g = gymSlots(unit, sets, dayIdx, has, { rot, focus, calfSets }); if (g) return leanToFocus(standIns(S, g, day), focus); }
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
    } else if (unit === 'legs') {
      // The second exercise rotates hinge → glute bridge → hamstring curl (a focus on their muscles
      // keeps it to the ones that train them).
      const calf = calfSets('calf');
      split('squat', rotatePick(['hinge', 'glute', 'hamCurl'], has, focus, rot) || 'hinge', sets - calf, dayIdx % 2 === 0);
      if (calf) out.push(['calf', calf]);
    } else if (unit === 'back') {
      if (has('pull') && sets >= 3) { const pr = Math.round(sets * 0.4); out.push(['pull', pr]); split('row', 'rear', sets - pr, true); }
      else if (has('backExt') && sets >= 3) {
        // No pull-up bar: the lower back gets an exercise of its own.
        const be = Math.max(1, Math.round(sets * 0.25));
        split('row', 'rear', sets - be, true);
        out.push(['backExt', be]);
      } else split('row', 'rear', sets, true);
    } else if (unit === 'shoulders') split('press', 'raise', sets, true); // an overhead press, then raises
    return leanToFocus(standIns(S, out, day), focus);
  }
  // A slot whose ladder a health condition rules out takes its stand-in (src/access.js). Stand-ins
  // can fill two slots with the same ladder (a press and a raise both seated): those merge into one.
  function standIns(S, slots, day) {
    const merged = [];
    for (const [f, n] of slots) {
      const fam = famFor(S, f, day);
      const same = merged.find((x) => x[0] === fam);
      if (same) same[1] += n; else merged.push([fam, n]);
    }
    return merged.filter(([f, n]) => n > 0 && rungs(S, f, day).length > 0);
  }
  // The first of `fams` available today, going round them with `rot`; with a focus, only the ones
  // that train a focus muscle take turns.
  function rotatePick(fams, has, focus, rot) {
    const avail = fams.filter(has);
    if (!avail.length) return null;
    const best = Math.max(...avail.map((f) => focusScore(f, focus)));
    const pool = best > 0 ? avail.filter((f) => focusScore(f, focus) === best) : avail;
    return pool[((rot % pool.length) + pool.length) % pool.length];
  }
  // A day's slots for a unit lean one set toward the exercise that trains a focus muscle most.
  function leanToFocus(slots, focus) {
    if (!focus.length || slots.length < 2) return slots;
    const sc = slots.map(([f]) => focusScore(f, focus));
    const hi = sc.indexOf(Math.max(...sc));
    let lo = -1;
    slots.forEach(([, n], i) => { if (sc[i] < sc[hi] && n >= 2 && (lo < 0 || sc[i] < sc[lo] || (sc[i] === sc[lo] && n > slots[lo][1]))) lo = i; });
    if (lo < 0) return slots;
    const out = slots.map((x) => x.slice());
    out[lo][1]--; out[hi][1]++;
    return out;
  }

  // At the gym: a main lift for the unit, then a second angle or an isolation move, so a muscle gets
  // a compound and an isolation exercise across the week. null = nothing gym-specific is available
  // (the home families, which also work with gym dumbbells, take over).
  function gymSlots(unit, sets, dayIdx, has, ctx) {
    const c = ctx || { rot: dayIdx, focus: [], calfSets: () => 0 };
    const out = [];
    const pick = (...fams) => fams.find((f) => has(f)) || null;
    const put = (fam, n) => { if (fam && n > 0) out.push([fam, n]); };
    const even = dayIdx % 2 === 0;
    if (unit === 'chest') {
      const main = pick('pressG');
      if (!main) return null;
      const second = even ? pick('inclineG', 'flyG') : pick('flyG', 'inclineG');
      if (sets >= 4 && second) { const a = Math.ceil(sets * 0.6); put(main, a); put(second, sets - a); } else put(main, sets);
    } else if (unit === 'legs') {
      const main = pick('squatG');
      if (!main) return null;
      // Second: a hinge, hip thrust or lunge in turn; third: an isolation move (calves when they're
      // a focus or legs are a top goal).
      const hinge = rotatePick(['hingeG', 'gluteG', 'lungeG'], has, c.focus, c.rot);
      const iso = c.calfSets('calfG') ? pick('calfG') : rotatePick(even ? ['legCurlG', 'legExtG', 'calfG'] : ['legExtG', 'legCurlG', 'calfG'], has, c.focus, 0);
      if (sets >= 6 && hinge && iso) {
        const a = Math.ceil(sets * 0.4), b = Math.ceil((sets - a) * 0.6);
        put(main, a); put(hinge, b); put(iso, sets - a - b);
      } else if (hinge) { const a = even ? Math.ceil(sets / 2) : Math.floor(sets / 2); put(main, a); put(hinge, sets - a); }
      else put(main, sets);
    } else if (unit === 'back') {
      const pull = pick('pullG'), row = pick('rowG'), rear = pick('rearG');
      if (!pull && !row) return null;
      if (pull && row) {
        const pr = Math.max(1, Math.round(sets * 0.4));
        const rr = rear && sets >= 5 ? Math.max(1, Math.round(sets * 0.2)) : 0;
        put(pull, pr); put(row, sets - pr - rr); put(rear, rr);
      } else put(pull || row, sets);
    } else if (unit === 'shoulders') {
      const press = pick('ohpG'), raise = pick('raiseG');
      if (!press && !raise) return null;
      // An overhead press, then raises.
      if (press && raise && sets >= 2) { const a = Math.ceil(sets / 2); put(press, a); put(raise, sets - a); } else put(press || raise, sets);
    } else return null;
    const res = out.filter(([, n]) => n > 0);
    return res.length ? res : null;
  }

  // Distribute a group's weekly sets across the days that train it.
  function perSession(total, f, k) { const base = Math.floor(total / f); return base + (k < total - base * f ? 1 : 0); }

  // The settings a week's split comes from: those in force when the week starts (or on the start
  // day), exactly as the calendar reads them, so a time change mid-week never reshuffles it.
  function weekSettings(S, ws) {
    const start = S.profile.startDay;
    return settingsAt(S, start == null ? ws : ws + 6 < start ? start : Math.max(ws, start));
  }
  // Weeks before S.engineFrom (the week after 1.6 first ran) keep 1.5's split, so what's done and
  // what's left of that week keep their meaning; later weeks come from the optimizer.
  const legacyWeek = (S, ws) => S.engineFrom != null && ws < S.engineFrom;
  // The profile and program a week's split is made from: the person as they are, with that week's
  // days, weekdays and minutes, and how simple sessions are (fewer exercises a day). A week before
  // 1.13's rules started is marked legacyRules, so its split is the one it had; from then, type 2
  // diabetes trains strength on 3 of the days at most, with sessions of 15 minutes or more
  // (src/access.js oldRules, strengthDays).
  function weekInputs(S, ws, set) {
    const st = set || weekSettings(S, ws);
    const p = S.profile;
    const A = GH.access;
    const old = A && A.oldRules ? A.oldRules(S, ws) : false;
    const mark = old ? { legacyRules: true } : null;
    const wk = !old && A && A.strengthDays ? A.strengthDays(p, { days: st.days, weekdays: st.weekdays, minutes: st.minutes }) : { days: st.days, weekdays: st.weekdays };
    return { set: st, p: Object.assign({}, p, { days: wk.days, weekdays: wk.weekdays, minutes: st.minutes, complexity: S.complexity || 0 }, mark), prog: programFor(Object.assign({}, p, { days: wk.days }, mark)) };
  }
  function templateOf(S, ws, set) {
    const w = weekInputs(S, ws, set);
    // (With the state, the optimizer can keep the split in it for the next launch.)
    return legacyWeek(S, ws) || !GH.optimizer ? templateV1(w.p, w.prog) : GH.optimizer.template(w.p, w.prog, S);
  }
  // 1.5's sets for each group of a template day: the week's sets (scaled for the phase) shared out
  // over the days that train the group. Legacy weeks keep these, before the optimizer's fit.
  function legacyGroupSets(S, tpl, t, mult) {
    // (Those weeks came before 1.13's rules too.)
    const prog = programFor(Object.assign({}, S.profile, { legacyRules: true }));
    const occurrence = (unit) => tpl.slice(0, t.idx).filter((x) => x.units.includes(unit)).length;
    const out = {};
    for (const unit of t.units) for (const g of UNIT_GROUPS[unit]) out[g] = perSession(Math.round((S.vol[g] != null ? S.vol[g] : prog.start[g]) * mult), prog.freq[unit] || 1, occurrence(unit));
    return out;
  }
  // The day plan when there is no optimizer: 1.5's split and sets.
  function plainDayPlan(S, ws, tplIdx, mult) {
    const tpl = templateOf(S, ws);
    const t = tpl[tplIdx] || tpl[0] || { idx: 0, offset: 0, units: [] };
    return { idx: t.idx, units: t.units, tplLen: tpl.length, occ: occurrences(tpl, t), legIdx: (tpl.find((x) => x.units.includes('legs')) || {}).idx, groupSets: legacyGroupSets(S, tpl, t, mult) };
  }
  // Which occurrence of each unit this day is within its week (rotations and remainders use it).
  function occurrences(tpl, t) {
    const out = {};
    for (const u of t.units) out[u] = tpl.slice(0, t.idx).filter((x) => x.units.includes(u)).length;
    return out;
  }
  // A day's slots: each of its groups' sets shared out over that group's exercises (the ladders
  // for the unit, with their rotations, stand-ins and focus leaning).
  function slotsOfDay(S, day, dp) {
    const prog = programFor(S.profile);
    const slots = [];
    const atGym = placeOf(S, day) === 'gym';
    const gs = dp.groupSets || {};
    for (const unit of dp.units) {
      if (unit === 'abs') {
        const n = gs.abs || 0;
        if (n <= 0) continue;
        // The core exercises rotate with the day's turn in the week and week by week, so each comes
        // round whichever days the core is trained on.
        const rot = ((dp.occ || {}).abs || 0) + Math.floor(weekStart(day) / 7);
        const avail = (f) => rungs(S, f, day).length > 0;
        let pair = [...new Set(CORE_ROTATION[rot % CORE_ROTATION.length].map((f) => famFor(S, f, day)))].filter(avail);
        // At the gym, one of the two ab slots is a cable or hanging move.
        if (atGym && avail('absG')) pair = ['absG'].concat(pair.filter((f) => f !== 'absLoad' && f !== 'abs')).slice(0, 2);
        // One or two core sets: one exercise, each core family in turn (the obliques get their share).
        const one = atGym && avail('absG') ? pair : [...new Set(CORE_ONE.map((f) => famFor(S, f, day)))].filter(avail);
        if (n <= 2 || pair.length < 2) { const fam = one.length ? one[rot % one.length] : pair[0]; if (fam) slots.push({ fam, sets: n, group: 'abs' }); }
        else { slots.push({ fam: pair[0], sets: Math.ceil(n / 2), group: 'abs' }); slots.push({ fam: pair[1], sets: Math.floor(n / 2), group: 'abs' }); }
        continue;
      }
      if (unit === 'arms') {
        for (const g of UNIT_GROUPS.arms) {
          const n = gs[g] || 0;
          const gymFam = g === 'biceps' ? 'curlG' : 'triG';
          const fam = atGym && rungs(S, gymFam, day).length ? gymFam : famFor(S, g === 'biceps' ? 'curl' : 'triceps', day);
          if (n > 0 && rungs(S, fam, day).length) slots.push({ fam, sets: n, group: g });
        }
        continue;
      }
      const g = UNIT_GROUPS[unit][0];
      const n = gs[g] || 0;
      if (n <= 0) continue;
      for (const [fam, k] of slotsForUnit(unit, n, S, dp.idx, day, { occ: (dp.occ || {})[unit] || 0, prog })) slots.push({ fam, sets: k, group: g });
    }
    // Simpler sessions (complexity 1 or 2): one exercise for each group, with all its sets (unless
    // asked for each option, dp.multi).
    if (S.complexity > 0 && !dp.multi) {
      const one = [];
      for (const sl of slots) { const same = one.find((x) => x.group === sl.group); if (same) same.sets += sl.sets; else one.push(Object.assign({}, sl)); }
      return one;
    }
    return slots;
  }

  // Build the session for a template on a day. opts: { short, noReadiness, noTrim, forceMult, cal }
  // The day's sets come from the week's plan (GH.optimizer.dayPlan), the session is built from them
  // (realize), then fitted to its time (GH.optimizer.fit). Cached: the same state, day and options
  // give the same session (a fresh copy each time, since callers change theirs).
  function buildSession(S, day, tplIdx, opts) {
    return op(() => build(S, day, tplIdx, opts));
  }
  function build(S, day, tplIdx, opts) {
    const o = opts || {};
    // [custom plans] A custom plan's day ('c:<plan>:<day>') is built by src/customplan.js.
    if (GH.customPlan && GH.customPlan.owns(tplIdx)) return GH.customPlan.buildSession(S, day, tplIdx, o);
    const O = GH.optimizer;
    const ws = weekStart(day);
    const cal = o.cal || calendar(S, day);
    const week = (cal.weeks && cal.weeks[ws]) || { phase: { mult: 1, onramp: false, deload: false } };
    const phase = o.forceMult != null ? Object.assign({}, week.phase, { mult: o.forceMult }) : week.phase;
    const stamp = stateStamp(S);
    const slot = JSON.stringify([day, tplIdx, !!o.short, !!o.noReadiness, !!o.noTrim, o.forceMult == null ? null : o.forceMult, phase]);
    const key = slot.slice(0, -1) + ',' + JSON.stringify(dayStamp(S, day)) + ']' + stamp;
    const memo = sessionMemo.get(S);
    if (memo && memo.has(key)) return JSON.parse(memo.get(key));
    // A session to show from today on (not one a week's sets are counted from) the last launch
    // kept, for the state and the day as they are now (src/optimizer.js, keptOf).
    const K = O && O.kept && !o.noReadiness && day >= dayOf(Date.now(), S.profile.prefs && S.profile.prefs.rollHour != null ? S.profile.prefs.rollHour : 4) ? O.kept : null;
    const kept = K ? K.get(S, 'sessions', key) : undefined;
    if (kept && Array.isArray(kept.items)) {
      const json = JSON.stringify(kept);
      const m = memo || new Map();
      if (!memo) sessionMemo.set(S, m);
      m.set(key, json);
      return JSON.parse(json);
    }
    const dp = O ? O.dayPlan(S, ws, tplIdx, { phase, stamp }) : plainDayPlan(S, ws, tplIdx, phase.mult);
    const { session, ready } = realize(S, day, dp, { short: o.short, noReadiness: o.noReadiness, phase, finisher: O ? !!dp.finisher : programFor(S.profile).finisherPerWeek >= 7 });
    const minutes = clampInt(settingsAt(S, day).minutes || S.profile.minutes || 25, 10, 60);
    const budget = o.short ? Math.min(13, minutes) : minutes;
    session.budget = budget;
    // Simpler sessions (complexity 1 or 2) have fewer exercises; the fit keeps to that too.
    const maxItems = S.complexity > 0 ? (S.complexity === 1 ? 5 : 4) : 0;
    if (!o.noTrim && O) O.fit(S, session, { dp, ready, phase, budget, short: !!o.short, maxItems });
    else {
      if (!o.noTrim) fitToBudget(S, session, budget);
      if (maxItems) limitExercises(session, maxItems);
    }
    orderItems(S, session);
    if (!session.items.length && !session.flare) lightInstead(S, session, day);
    session.estimateMin = Math.round(estimate(S, session));
    session.groups = groupsOf(session);
    assignUids(session);
    const m = memo || new Map();
    if (!memo) sessionMemo.set(S, m);
    if (m.size > 24) m.delete(m.keys().next().value);
    const json = JSON.stringify(session);
    m.set(key, json);
    // Building can start a ladder's progress (an exercise used for the first time): the same
    // session is kept for the state as it is now too.
    const after = stateStamp(S);
    const keyAfter = key.slice(0, key.length - stamp.length) + after;
    if (after !== stamp) m.set(keyAfter, json);
    if (K) K.put(S, 'sessions', after !== stamp ? [key, keyAfter] : [key], JSON.parse(json), slot, day);
    return session;
  }
  const sessionMemo = new WeakMap();
  // A day's session from its plan, before it's fitted to the time: the exercises for each group's
  // sets, readiness, merges, the comeback, catch-up sets and tests, the warm-up (and a cool-down when
  // mobility is a goal), supersets, and the age and health rules. o: { short, noReadiness, phase,
  // finisher (add one, as 1.5 did on its days) }. Returns { session, ready }.
  function realize(S, day, dp, o) {
    const p = S.profile;
    const prog = programFor(p);
    const phase = o.phase || { mult: 1, onramp: false, deload: false };
    const ready = o.noReadiness ? { minus: 0, legsMinus: 0, reasons: [] } : readiness(S, day);
    const slots = slotsOfDay(S, day, dp);
    // Readiness: one less set per exercise (never below 1); leg trim after another hard session. No
    // exercise has more than 6 sets (a stand-in can take two slots' sets).
    for (const s of slots) {
      s.sets = Math.min(SET_MAX, s.sets);
      if (ready.minus) s.sets = Math.max(1, s.sets - 1);
      if (ready.legsMinus && s.group === 'legs') s.sets = Math.max(1, s.sets - 1);
    }
    const items = mergeSame(slots.map((s) => itemFor(S, s, day)).filter(Boolean));
    // Back after a break: strength and size come back quickly when training restarts (Ogasawara
    // et al. 2013), but the first session back is a little lighter so it doesn't flatten you.
    const lastDone = workoutLogs(S).filter((l) => isDone(l) && l.day < day).reduce((a, l) => Math.max(a, l.day), -Infinity);
    const gap = isFinite(lastDone) ? day - lastDone : 0;
    const comeback = gap > 10 ? { days: gap, mult: gap > 28 ? 0.8 : 0.9 } : null;
    if (comeback) {
      for (const it of items) {
        if (!it.load || it.load.kg == null || !isGymFam(it.fam) || it.load.guess) continue;
        const kg = snapLoad(S, it.load.key, it.load.kg * comeback.mult, 0, day);
        if (kg != null && kg < it.load.kg) it.load = Object.assign({}, it.load, { kg, value: Math.round(toUnit(kg, unitsOf(S)) * 10) / 10, label: fmtLoad(S, kg, it.load.key, M().MOVES[it.moveId]) });
      }
    }
    // Catch-up: one extra lead-side set on arm (and leg) days (the days the plan made for them, not
    // a day another group joins for its weekly minimum; not a day too short for one, dp.noExtras).
    const armDay = (dp.planUnits || dp.units).includes('arms');
    const legDay = (dp.planUnits || dp.units).includes('legs');
    const extras = [];
    if (armDay && S.catchup.arm.active && !dp.noExtras) { const x = extraItem(S, 'curl', 'arm', day); if (x) extras.push(x); }
    if (legDay && S.catchup.leg.active && !dp.noExtras) { const x = extraItem(S, 'squat', 'leg', day); if (x) extras.push(x); }
    // Tests (every 14 days, at the start of the first matching day).
    const tests = [];
    for (const [kind, on] of [['arm', armDay], ['leg', legDay]]) {
      const t = on && testDue(S, day, kind) ? testItem(S, kind, day) : null;
      if (t) tests.push(t);
    }
    // A test is a max-effort set for each side, so it stands in for one set of that ladder.
    for (const t of tests) { const it = items.find((x) => x.fam === t.fam); if (it && it.sets > 1) it.sets--; }
    // A finisher here only for a conditioning goal (it's part of the point) or when a plan tweak asks
    // for one; otherwise the fit adds one when there's time for it (GH.optimizer.fit).
    const finisher = o.finisher && !ready.noFinisher && !phase.deload && S.complexity < 2 ? finisherFor(S, day, dp.idx) : null;
    // A cool-down after every session when mobility is a goal or a plan tweak asks for one.
    const tw = tweaksOf(S).mobility;
    const cool = !o.short && tw !== 'off' && (prog.mobilityPlus || tw === 'on');
    const session = {
      day, tpl: dp.idx, units: dp.units, title: templateTitle(dp.units), short: !!o.short,
      phase, readiness: ready, warmup: warmupItems(S, day, o.short ? 1 : prog.warmupMin, items),
      tests, items, extras, finisher, notes: [], mobility: cool ? cooldownItems(S, day, items, o.short) : [],
      place: placeOf(S, day), comeback,
    };
    pairSupersets(S, session);
    // Age and health (src/access.js): warm-up, balance and floor practice, power, rest, cool-down,
    // and a flare day's gentle range-of-motion session.
    if (GH.access) GH.access.adjustSession(S, session, day, { tplIdx: dp.idx, days: dp.tplLen || 3, legIdx: dp.legIdx });
    return { session, ready };
  }
  // A finisher for the day, with the age and health limits on it (src/access.js).
  function finisherFor(S, day, tplIdx) {
    const f = finisherItem(S, day);
    if (f && GH.access && GH.access.adjustFinisher) GH.access.adjustFinisher(S, f, day, tplIdx || 0);
    return f;
  }
  // Running order: balance and floor practice first, then the units by priority (your top goals
  // first, abs last), each superset's second exercise straight after its first.
  function orderItems(S, s) {
    const prog = programFor(S.profile);
    const pri = (it) => {
      if (it.skill) return -1;
      const u = UNIT_OF[it.group];
      if (!u) return 5;
      return u === 'abs' ? 9 : Math.min(...UNIT_GROUPS[u].map((g) => prog.tiers[g] || 3));
    };
    const ord = (it) => { const u = UNIT_OF[it.group]; return u ? ORDER_UNITS.indexOf(u) : 3; };
    const base = s.items.map((it, i) => [it, i]).sort((a, b) => pri(a[0]) - pri(b[0]) || ord(a[0]) - ord(b[0]) || a[1] - b[1]).map((x) => x[0]);
    const out = [];
    const seen = new Set();
    for (const it of base) {
      if (seen.has(it)) continue;
      out.push(it); seen.add(it);
      if (it.superset) {
        const partner = base.find((x) => x !== it && x.superset && x.superset[0] === it.superset[0]);
        if (partner && !seen.has(partner)) { out.push(partner); seen.add(partner); }
      }
    }
    s.items = out;
    numberPairs(s.items);
  }
  const ORDER_UNITS = ['chest', 'legs', 'back', 'arms', 'shoulders', 'abs'];
  // Two slots can end up with the same exercise: a stand-in ladder shared by two units (a supported
  // hip hinge for the legs and the lower back), or a sore joint's swap into another ladder. For the
  // same group they become one exercise with both slots' sets (up to 5). For another group, its
  // sets go to that group's other exercise when it has one, so each group keeps the sets the week
  // gave it; otherwise the exercise counts for both (`also`), with the larger of the two set counts.
  function mergeSame(items) {
    const out = [], dups = [];
    for (const it of items) {
      const same = out.find((x) => x.moveId === it.moveId || x.fam === it.fam);
      if (same) dups.push([it, same]); else out.push(it);
    }
    for (const [it, same] of dups) {
      if (it.group === same.group) { same.sets = Math.max(same.sets, Math.min(MERGE_MAX, same.sets + it.sets)); continue; }
      const mate = out.find((x) => x !== same && x.group === it.group && x.sets < SET_MAX);
      if (mate) { mate.sets = Math.min(SET_MAX, mate.sets + it.sets); continue; }
      same.sets = Math.max(same.sets, Math.min(SET_MAX, it.sets));
      if (!(same.also || []).includes(it.group)) same.also = (same.also || []).concat(it.group);
    }
    return out;
  }
  // Nothing in the day's plan can be done today (every move ruled out): it's a light day instead, a
  // walk and the mobility flow, not an empty workout. Finished anyway, it doesn't count as one.
  function lightInstead(S, s, day) {
    Object.assign(s, { light: true, title: 'Light day', warmup: [], tests: [], extras: [], finisher: null, keepMobility: true });
    const eq = eqFor(S, day);
    s.mobility = mobilityFlow(S, day).filter((it) => M().allowed(M().MOVES[it.moveId], eq));
    s.notes = (s.notes || []).concat({ kind: 'light', text: 'Nothing in today\'s plan suits you right now, so it\'s a light day: a walk and easy mobility.' });
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

  /* ---------------------------------------------------------------- loads */
  // Weight steps and the lightest setting for loaded gym moves: [lb, kg].
  const LOAD_STEP = { bb: [5, 2.5], smith: [5, 2.5], ez: [5, 2.5], cable: [5, 2.5], machine: [10, 5] };
  const MIN_LOAD = { bb: [45, 20], smith: [20, 10], ez: [20, 10], cable: [5, 2.5], machine: [10, 5] };
  // Novice starting loads as a share of body weight when a move doesn't say (per dumbbell for db).
  const RATIO = { bb: 0.4, smith: 0.35, ez: 0.2, db: 0.1, cable: 0.25, machine: 0.4 };
  const unitsOf = (S) => (S.profile.units === 'kg' ? 'kg' : 'lb');
  const toUnit = (kg, u) => (u === 'kg' ? kg : kg * LB_PER_KG);
  const fromUnit = (v, u) => (u === 'kg' ? v : v / LB_PER_KG);
  const GYM_LOADS = ['bb', 'smith', 'ez', 'cable', 'machine', 'db'];
  // Snaps a load (kg) to something the equipment can be set to, in the person's units; dir +1/-1
  // steps to the next heavier/lighter setting.
  function snapLoad(S, key, kg, dir, day) {
    const u = unitsOf(S);
    const v = toUnit(kg || 0, u);
    if (key === 'db') {
      const rack = (eqFor(S, day).db || []).slice().sort((a, b) => a - b);
      if (!rack.length) return null;
      let i = rack.findIndex((w) => w >= v - 0.01);
      if (i < 0) i = rack.length - 1;
      if (dir > 0) { const j = rack.findIndex((w) => w > v + 0.01); i = j < 0 ? rack.length - 1 : j; }
      if (dir < 0) { let j = -1; rack.forEach((w, k) => { if (w < v - 0.01) j = k; }); i = j < 0 ? 0 : j; }
      return fromUnit(rack[i], u);
    }
    const [sLb, sKg] = LOAD_STEP[key] || [5, 2.5];
    const [mLb, mKg] = MIN_LOAD[key] || [0, 0];
    const step = u === 'kg' ? sKg : sLb;
    let w = Math.round(v / step) * step + (dir > 0 ? step : dir < 0 ? -step : 0);
    w = Math.max(u === 'kg' ? mKg : mLb, w);
    return fromUnit(w, u);
  }
  // A first guess for someone new to a gym move: body weight × the move's ratio, scaled for
  // experience. It's only pre-filled; the player asks for a weight they could lift about 12 times.
  function suggestLoad(S, m, key, day) {
    const p = S.profile;
    const bw = p.weightKg || 70;
    const lvl = programFor(p).level;
    let kg = bw * (m.ratio || RATIO[key] || 0.25) * [0.8, 1, 1.2][lvl];
    if (p.age >= 60 || p.gentle) kg *= 0.8;
    return snapLoad(S, key, kg, 0, day);
  }
  function fmtLoad(S, kg, key, m) {
    if (kg == null) return '';
    const u = unitsOf(S);
    const v = Math.round(toUnit(kg, u) * 10) / 10;
    const n = fmtNum(Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v);
    if (key === 'db') return `${n} ${u} ${m && m.uni ? 'dumbbell' : 'dumbbells'}`;
    return `${n} ${u}`;
  }

  function loadInfo(S, m, day, fam) {
    const d = day != null ? day : S.active ? S.active.day : dayOf(Date.now(), (S.profile.prefs && S.profile.prefs.rollHour) || 4);
    const eq = eqFor(S, d);
    const key = M().loadFor(m, eq);
    if (!key) return null;
    const unit = S.profile.units || 'lb';
    const f = fam || m.family;
    // Gym families track the weight per exercise, in kg.
    if (isGymFam(f) && GYM_LOADS.includes(key)) {
      const st = S.prog[f];
      const saved = st && st.loads ? st.loads[m.id] : null;
      const kg = saved != null ? saved : suggestLoad(S, m, key, d);
      if (kg == null) return null;
      return { key, kg, value: Math.round(toUnit(kg, unit) * 10) / 10, unit, guess: saved == null, label: `${saved == null ? 'about ' : ''}${fmtLoad(S, kg, key, m)}` };
    }
    if (key === 'db' || key === 'kb') {
      const list = (eq[key] || []).slice().sort((a, b) => a - b);
      const w = S.prog[m.family] ? Math.min(S.prog[m.family].w || 0, list.length - 1) : 0;
      const value = list[Math.max(0, w)];
      return { key, value, kg: fromUnit(value, unit), unit, label: `${fmtNum(value)} ${unit} ${key === 'db' ? (m.uni || /^(curl_conc|tri_oh1|row_chair|chest_press1|raise_lean)/.test(m.id) ? 'dumbbell' : 'dumbbells') : 'kettlebell'}` };
    }
    if (key === 'ball') return { key, value: eq.ballLb, unit, label: eq.ballLb ? `${fmtNum(eq.ballLb)} ${unit} ball` : 'Ball' };
    if (key === 'band') return { key, label: 'Band' };
    return null;
  }
  // Weight choices for the player's picker around the current load (kg values, labelled).
  function loadChoices(S, item, day) {
    const L = item && item.load;
    if (!L || L.kg == null) return [];
    const m = M().MOVES[item.moveId];
    const cur = item.curLoad != null ? item.curLoad : L.kg;
    const out = [cur];
    let lo = cur, hi = cur;
    for (let i = 0; i < 6; i++) {
      const dn = snapLoad(S, L.key, lo, -1, day), up = snapLoad(S, L.key, hi, +1, day);
      if (dn != null && dn < lo - 1e-6) { out.unshift(dn); lo = dn; }
      if (up != null && up > hi + 1e-6) { out.push(up); hi = up; }
    }
    return out.map((kg) => ({ kg, label: fmtLoad(S, kg, L.key, m) }));
  }
  const fmtNum = (x) => (x == null ? '' : Number.isInteger(x) ? String(x) : x.toFixed(1));

  // Auto rest: 90 s after big multi-joint moves, 60 s after small ones (and inside supersets, see
  // pairSupersets). Resting over a minute gives a small extra benefit for muscle size, with nothing
  // clear past about 90 s (Singer et al. 2024).
  // A rest a plan tweak asks for comes first, then the one picked in Settings. When both are auto,
  // the optimizer lengthens rests in sessions with time to spare (src/optimizer.js fit).
  const COMPOUND = ['push', 'chestDb', 'press', 'squat', 'hinge', 'row', 'pull'];
  function restFor(S, fam) {
    const tw = tweaksOf(S).rest;
    if (tw !== 'auto') return tw;
    const pr = S.profile.prefs.rest;
    if (pr === 60 || pr === 90) return pr;
    return COMPOUND.includes(fam) ? 90 : 60;
  }
  const autoRest = (S) => tweaksOf(S).rest === 'auto' && S.profile.prefs.rest !== 60 && S.profile.prefs.rest !== 90;

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
    const home = placeOf(S, day) === 'home';
    for (const [f2, lad] of Object.entries(M().LADDERS)) {
      if (f2 === fam || lad.group !== group || (home && lad.gym)) continue;
      const alt = rungs(S, f2, day).filter((x) => !loads(x));
      if (alt.length) return { id: alt[0], swappedFrom: id, family: f2 };
    }
    // Every ladder for the group loads the sore joint: the group's stand-in ladder (src/access.js:
    // seated, self-resisted and supported versions), when one of its moves spares it.
    const A = GH.access;
    const sub = A && A.STAND_IN && A.STAND_IN[fam];
    if (sub && M().LADDERS[sub] && sub !== fam) {
      const list2 = rungs(S, sub, day, { noRules: true }).filter((x) => A.moveOk(S.profile, x, day) && !loads(x));
      const st2 = S.prog[sub];
      const id2 = st2 && list2.includes(st2.rung) ? st2.rung : (A.startRung(S, sub, list2) || list2[0]);
      if (id2) return { id: id2, swappedFrom: id, family: sub };
    }
    return { id: null, swappedFrom: id, dropped: true };
  }

  // The move a plan tweak picked for a ladder (planTweaks.swaps), when it can be done today: one of
  // the ladder's own rungs, or a move of another ladder for the same muscles (which it then
  // progresses on). Never one that loads a joint on a break.
  function pinnedFor(S, fam, day) {
    const id = tweaksOf(S).swaps[fam];
    const m = id && M().MOVES[id];
    if (!m) return null;
    const lad = (f) => M().LADDERS[f] && M().LADDERS[f].rungs.includes(id);
    const f2 = lad(fam) ? fam : lad(m.family) ? m.family : null;
    if (!f2 || !rungs(S, f2, day).includes(id)) return null;
    const avoid = filtersFor(S, day).avoidJoints;
    if ((m.joints || []).some((j) => avoid.includes(j))) return null;
    return { id, family: f2 };
  }
  const isPinned = (S, id) => Object.values(tweaksOf(S).swaps).includes(id);

  function itemFor(S, slot, day) {
    const pin = pinnedFor(S, slot.fam, day);
    ensureProg(S, pin ? pin.family : slot.fam, day);
    const pick = pin ? { id: pin.id, swappedFrom: null, family: pin.family } : pickMove(S, slot.fam, day);
    if (!pick || !pick.id) return null;
    const m = M().MOVES[pick.id];
    const fam = pick.family || slot.fam;
    const st = S.prog[fam] || { reps: m.start };
    let target = st.rung === pick.id ? st.reps : m.start;
    const [lo, hi] = rangeFor(S, m, fam, day);
    target = clampInt(target, lo, hi);
    const it = {
      kind: 'move', fam, moveId: m.id, name: m.name, group: slot.group, sets: slot.sets, target,
      timed: !!m.timed, uni: !!m.uni, rest: restFor(S, fam), load: loadInfo(S, m, day, fam),
      swappedFrom: pick.swappedFrom, superset: null,
    };
    if (pin) it.pinned = true;
    return it;
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
    if (!M().MOVES[cur].uni && oneArm && M().allowed(M().MOVES[oneArm], eqFor(S, day)) && (!GH.access || GH.access.moveOk(S.profile, oneArm, day))) id = oneArm;
    else if (!M().MOVES[cur].uni && uni.length) id = uni.sort((a, b) => Math.abs(all.indexOf(a) - all.indexOf(cur)) - Math.abs(all.indexOf(b) - all.indexOf(cur)))[0];
    const avoid = filtersFor(S, day).avoidJoints;
    if ((M().MOVES[id].joints || []).some((j) => avoid.includes(j))) return null;
    const m = M().MOVES[id];
    const st = S.prog[fam] || {};
    const target = clampInt(M().MOVES[cur].timed === m.timed ? (st.reps || m.start) : m.start, m.range[0], m.range[1]);
    const side = S.catchup[kind].side || 'L';
    return {
      kind: 'extra', fam, moveId: id, name: m.name, group: m.group, sets: 1, target, timed: !!m.timed, uni: true,
      leadOnly: side, rest: restFor(S, fam), load: loadInfo(S, m, day), superset: null, extraKind: kind,
    };
  }

  // The left vs right test's move: from the rungs this person can do today (kit at today's place,
  // their health rules, careful joints), never one that loads a joint on a break. The arm test needs
  // a loaded curl. null: no fair test today.
  function testItem(S, kind, day) {
    const fam = kind === 'arm' ? 'curl' : 'squat';
    const avoid = filtersFor(S, day).avoidJoints;
    const list = rungs(S, fam, day).filter((id) => !M().MOVES[id].timed && !(M().MOVES[id].joints || []).some((j) => avoid.includes(j)));
    const id = kind === 'arm' ? (list.includes('curl_std') ? 'curl_std' : list.find((x) => M().MOVES[x].load)) : (list.includes('sq_split') ? 'sq_split' : list[0]);
    if (!id) return null;
    const m = M().MOVES[id];
    return { kind: 'test', test: kind, fam, moveId: id, name: kind === 'arm' ? 'Left vs right curl test' : 'Left vs right leg test', load: loadInfo(S, m, day), side: S.catchup[kind].side || 'L' };
  }

  function finisherItem(S, day) {
    // At the gym, the finisher is rowing, cycling or an incline walk when those are there.
    const fam = placeOf(S, day) === 'gym' && rungs(S, famFor(S, 'cardioG', day), day).length ? famFor(S, 'cardioG', day) : famFor(S, 'finisher', day);
    // Nothing that loads a joint on a break: the nearest easier interval, else none today.
    const avoid = filtersFor(S, day).avoidJoints;
    const all = rungs(S, fam, day);
    const list = all.filter((x) => !(M().MOVES[x].joints || []).some((j) => avoid.includes(j)));
    if (!list.length) return null;
    const st = S.prog[fam] || {};
    const at = all.indexOf(st.rung);
    const id = list.includes(st.rung) ? st.rung : list.filter((x) => all.indexOf(x) <= at).pop() || list[0];
    const m = M().MOVES[id];
    const lvl = list.indexOf(id);
    const formats = [[20, 40, 4], [30, 30, 4], [30, 30, 5], [40, 20, 4], [40, 20, 5]];
    const [work, rest, rounds] = formats[Math.min(formats.length - 1, Math.max(0, (st.fmt || 0)))];
    return { kind: 'finisher', fam, moveId: id, name: m.name, group: 'conditioning', work, rest, rounds, load: loadInfo(S, m, day, fam), uni: !!m.uni, level: lvl };
  }

  // How much each muscle works in a list of items (a primary mover counts fully, a helper half).
  function musclesOf(items) {
    const w = {};
    for (const it of items || []) {
      const m = it && M().MOVES[it.moveId];
      if (!m) continue;
      const sets = it.sets || 1;
      (m.muscles || []).forEach((mu, i) => { w[mu] = (w[mu] || 0) + sets * (i < (m.prime || 1) ? 1 : 0.5); });
    }
    return w;
  }
  // Up to n of the candidate moves that best suit the weighted muscles (by their mobFor), each pick
  // halving the pull of the muscles it covers so the rest spread out; ties keep the list order.
  function pickFor(ids, w, n, bonus) {
    const left = Object.assign({}, w);
    const out = [];
    const pool = ids.slice();
    while (out.length < n && pool.length) {
      const score = (id) => (M().MOVES[id].mobFor || []).reduce((a, mu) => a + (left[mu] || 0), 0) + ((bonus && bonus[id]) || 0);
      let best = 0;
      for (let i = 1; i < pool.length; i++) if (score(pool[i]) > score(pool[best])) best = i;
      const [id] = pool.splice(best, 1);
      out.push(id);
      for (const mu of M().MOVES[id].mobFor || []) if (left[mu]) left[mu] /= 2;
    }
    return out;
  }
  const UPPER = ['biceps', 'triceps', 'chest', 'back', 'shoulders'];
  // Warm-ups for the day's muscles: the kettlebell halo leads on upper-body days (and only then).
  function warmupItems(S, day, minutes, items) {
    const eq = eqFor(S, day);
    const avoid = filtersFor(S, day).avoidJoints;
    const upper = !items || !items.length || items.some((it) => UPPER.includes(it.group));
    const skip = tweaksOf(S).avoid;
    const ids = (M().WARMUP.all || M().WARMUP.kb).filter((id) => {
      const m = M().MOVES[id];
      return m && M().allowed(m, eq) && !(m.joints || []).some((j) => avoid.includes(j)) && (id !== 'wu_halo' || upper) && !skip.includes(id);
    });
    const w = musclesOf(items);
    // (No exercises to go by: the usual whole-body three.)
    const moves = Object.keys(w).length ? pickFor(ids, w, 3, { wu_halo: 1000 })
      : [eq.kb && eq.kb.length ? 'wu_halo' : 'wu_circles', 'wu_angels', 'wu_squat'].filter((id) => ids.includes(id));
    // Upper-body moves first, then the legs (the list's order).
    moves.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    const pick = minutes <= 1 ? moves.slice(0, 2) : moves;
    return pick.map((id) => { const m = M().MOVES[id]; return { kind: 'warmup', moveId: id, name: m.name, timed: !!m.timed, target: minutes <= 1 ? Math.min(m.start, 20) : m.start, load: loadInfo(S, m, day) }; });
  }
  // Mobility moves this person can do on a day (the day's kit unless one is given, nothing for a
  // joint that's still sore then).
  function mobilityIds(S, day, eq) {
    const kit = eq || eqFor(S, day);
    const avoid = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    const skip = tweaksOf(S).avoid;
    return M().MOBILITY.filter((id) => { const m = M().MOVES[id]; return m && M().allowed(m, kit) && !(m.joints || []).some((j) => avoid.includes(j)) && !skip.includes(id); });
  }
  // The cool-down: two or three stretches for the muscles the day worked.
  function cooldownItems(S, day, items, short) {
    const ids = mobilityIds(S, day);
    const w = musclesOf(items);
    const picks = Object.keys(w).length ? pickFor(ids, w, short ? 2 : 3) : ['mob_child'];
    picks.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    return picks.map((id) => { const m = M().MOVES[id]; return { kind: 'mobility', moveId: id, name: m.name, timed: true, target: m.start, uni: !!m.uni }; });
  }

  // The light-day mobility flow (about 5 minutes): stretches for the muscles the last few workouts
  // trained most (the latest counts most), in a floor-friendly order. day defaults to today.
  const FLOW_DEFAULT = ['mob_catcow', 'mob_wgs', 'mob_hipflexor', 'mob_squat', 'mob_child'];
  function mobilityFlow(S, day) {
    const extra = programFor(S.profile).mobilityPlus;
    const prefs = S.profile.prefs || {};
    const d = day != null ? day : dayOf(Date.now(), prefs.rollHour != null ? prefs.rollHour : 4);
    // Moves a health condition rules out (src/access.js) never make the list.
    const A = GH.access;
    const ids = mobilityIds(S, d, eqAt(S, 'home')).filter((id) => !A || A.moveOk(S.profile, id, d));
    const recent = workoutLogs(S).filter(isDone).sort((a, b) => b.day - a.day).slice(0, 3);
    const w = {};
    recent.forEach((l, k) => {
      const done = (l.items || []).filter((it) => it.sets && it.sets.length).map((it) => ({ moveId: it.moveId, sets: new Set(it.sets.map((x) => x.set)).size }));
      for (const [mu, v] of Object.entries(musclesOf(done))) w[mu] = (w[mu] || 0) + v * [1, 0.6, 0.35][k];
    });
    let picks = Object.keys(w).length ? pickFor(ids, w, 5) : FLOW_DEFAULT.filter((id) => ids.includes(id));
    if (!picks.length) picks = ids.slice(0, 5);
    picks.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    // A seated plan has a seated flow, too few moves left get a standing one, and from 65 or with
    // balance problems a balance hold joins (src/access.js).
    if (A) picks = A.mobilityIds(S, picks, d);
    return picks.map((id) => { const m = M().MOVES[id]; return { kind: 'mobility', moveId: id, name: m.name, timed: true, target: extra ? m.range[1] : m.start, uni: !!m.uni }; });
  }

  /* ---------------- supersets */
  const CONFLICT = [['push', 'triceps'], ['row', 'curl'], ['pull', 'curl'], ['push', 'raise'], ['chestDb', 'triceps'], ['pull', 'row'], ['row', 'rear'], ['pull', 'rear'], ['chestDb', 'push'], ['squat', 'hinge'], ['squat', 'glute'], ['hinge', 'glute'],
    ['press', 'push'], ['press', 'chestDb'], ['press', 'triceps'], ['press', 'raise'], ['backExt', 'hinge'], ['backExt', 'row'], ['hamCurl', 'hinge'], ['hamCurl', 'glute'], ['calf', 'squat']];
  const PREFER = [['squat', 'curl'], ['push', 'row'], ['hinge', 'triceps'], ['push', 'curl'], ['squat', 'row'], ['hinge', 'curl'], ['row', 'triceps'], ['squat', 'triceps'], ['curl', 'triceps'], ['pull', 'push'], ['rear', 'push'], ['raise', 'squat'], ['raise', 'hinge'], ['chestDb', 'row'], ['push', 'squat'], ['push', 'hinge'],
    ['press', 'row'], ['press', 'squat'], ['press', 'hinge'], ['hamCurl', 'push'], ['hamCurl', 'curl'], ['calf', 'row'], ['calf', 'curl'], ['backExt', 'push'], ['raise', 'hamCurl']];
  const conflicts = (a, b) => a.group === b.group || CONFLICT.some(([x, y]) => (x === a.fam && y === b.fam) || (x === b.fam && y === a.fam));
  // Pairs exercises that don't share muscles. Called again on a fitted session it only pairs the
  // exercises left on their own, with letters not in use yet.
  function pairSupersets(S, session) {
    if (!S.profile.prefs.supersets || S.complexity > 0) return;
    const main = session.items.filter((it) => it.group !== 'abs' && !it.skill && it.kind === 'move');
    const free = new Set(main.filter((it) => !it.superset));
    const used = new Set(session.items.filter((it) => it.superset).map((it) => it.superset[0]));
    const letters = 'ABCDEFGHIJ'.split('').filter((k) => !used.has(k));
    let tag = 0;
    // In a superset each muscle already rests through its partner's set, so auto rest stays at 60 s
    // there: that still gives every muscle about 90 s or more between its own sets.
    const auto = autoRest(S);
    const pairUp = (a, b) => { const k = letters[tag++]; if (!k) return; a.superset = k + '1'; b.superset = k + '2'; free.delete(a); free.delete(b); if (auto) { a.rest = 60; b.rest = 60; } };
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
    numberPairs(session.items);
  }
  // A superset's numbers follow the running order: whichever of the two comes first is 1 (A1 then A2),
  // however the pair was matched.
  function numberPairs(items) {
    const first = new Set();
    for (const it of items) {
      if (!it.superset) continue;
      const k = it.superset[0];
      it.superset = k + (first.has(k) ? '2' : '1');
      first.add(k);
    }
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

  function tierOf(S, group) { return group === 'balance' ? 1 : programFor(S.profile).tiers[group] || 3; }
  // For trimming, back counts as tier 2 whenever chest is trained hard (it balances the pushing).
  function trimTier(S, group) {
    const t = programFor(S.profile).tiers;
    if (group === 'balance') return 1; // balance practice (src/access.js) is trimmed last
    return group === 'back' && t.chest <= 2 ? Math.min(t.back || 3, 2) : t[group] || 3;
  }
  // Trim order: mobility → finisher → shoulders down to one set → second core slot → tier 3 → tier 2
  // → tier 1, and only then the last shoulder set. Pressing works the shoulders too, so they shrink
  // first, but one direct set stays so no muscle group drops out for weeks because sessions are full.
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
    if (over() && s.mobility && s.mobility.length && !s.keepMobility) s.mobility = [];
    if (over() && !cond) dropFinisher();
    // A gentle warm-up's extra move for the day's muscles (src/access.js) goes before any sets do.
    if (over() && s.warmup.some((w) => w.extra)) s.warmup = s.warmup.filter((w) => !w.extra);
    // Two shoulder slots (a press and raises): the raises go. One left: it shrinks to a set.
    if (over()) {
      const sh = s.items.filter((it) => it.group === 'shoulders');
      if (sh.length > 1) dropSlot((it) => it === sh[sh.length - 1]);
      else if (sh.length) sh[0].sets = 1;
    }
    if (over() && tierOf(S, 'abs') > 1) dropSecondCore();
    setsDown(3, 1);
    while (over() && dropSlot((it) => trimTier(S, it.group) === 3 && it.group !== 'shoulders')) { /* drop whole slots */ }
    if (cond) while (over() && s.finisher && s.finisher.rounds > 3) s.finisher.rounds--;
    setsDown(2, 2);
    setsDown(1, 2);
    if (over()) dropSlot((it) => it.group === 'shoulders');
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
    const partner = s.items.find((x) => x !== it && x.superset && x.superset[0] === it.superset[0]);
    if (partner) partner.superset = null;
    it.superset = null;
  }
  // Short on time: priority work only, then fill back up to at least 12 minutes.
  function shortMode(S, s) {
    s.finisher = null; s.mobility = s.keepMobility ? s.mobility.slice(0, 2) : []; s.tests = [];
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
  // Simpler sessions (complexity 1 or 2): fewer exercises. The lowest-priority ones merge into an
  // exercise for the same muscles where there is one (up to 5 sets: more of one move gets dull and
  // sloppy), otherwise they're cut; what doesn't fit is listed in `trimmed`.
  const MERGE_MAX = 5;
  const SET_MAX = 6; // sets of one exercise in a session
  function limitExercises(s, max) {
    if (s.items.length <= max) return;
    s.trimmed = s.trimmed || [];
    while (s.items.length > max) {
      const last = s.items[s.items.length - 1];
      const same = s.items.find((it) => it !== last && it.group === last.group);
      const add = same ? Math.max(0, Math.min(last.sets, MERGE_MAX - same.sets)) : 0;
      if (add) same.sets += add;
      if (add < last.sets) s.trimmed.push(last.name);
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
    let pulled = null;
    if (tplIdx == null) {
      // Training on a light day pulls the next session forward.
      const next = plan.next;
      if (!next) return { error: 'none' };
      pulled = { type: 'move', from: next.day, to: day, at: day };
      S.events.push(pulled);
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
    if (pulled) S.active.pulled = Object.assign({}, pulled);
    return { session, steps: st };
  }

  // Cancels the workout in progress: nothing from it is kept, it doesn't count, and today's plan can
  // be started again. A session pulled forward onto a light day to start it goes back where it was,
  // and a left/right test done in it is forgotten. Returns what was cancelled (or null), which
  // restoreWorkout takes to undo it.
  const isPulled = (a) => (e) => e.type === 'move' && e.from === a.pulled.from && e.to === a.pulled.to && e.at === a.pulled.at;
  function cancelWorkout(S) {
    const a = S.active;
    if (!a) return null;
    if (a.pulled) {
      const i = S.events.map(isPulled(a)).lastIndexOf(true);
      if (i >= 0) S.events.splice(i, 1);
    }
    for (const k of Object.keys(a.catchupWas || {})) if (S.catchup[k]) S.catchup[k] = JSON.parse(JSON.stringify(a.catchupWas[k]));
    S.active = null;
    return a;
  }
  // Undo for cancelWorkout: the same workout back where it was, with its pulled session and tests.
  function restoreWorkout(S, a) {
    if (!a || S.active) return false;
    if (a.pulled && !S.events.some(isPulled(a))) S.events.push(Object.assign({}, a.pulled));
    for (const k of Object.keys(a.catchupWas || {})) {
      const t = a.tests && a.tests[k];
      if (S.catchup[k] && t && t.L != null && t.R != null) recordTest(S, a.day, k, t.L, t.R);
    }
    S.active = a;
    relink(S);
    return true;
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
      // The weight used, when the move is loaded: what the person picked, else the planned load.
      if (r.load != null) st.item.curLoad = r.load;
      const L = st.item.load;
      const load = st.item.curLoad != null ? st.item.curLoad : L && L.kg != null && L.key !== 'band' && L.key !== 'ball' ? L.kg : null;
      log.sets.push(load != null ? { set: st.set, side: st.side || null, amount, target, load } : { set: st.set, side: st.side || null, amount, target });
      // Fewer reps than asked lowers what follows; the second side never does more than the first.
      if (amount < target) st.item.curTarget = Math.min(st.item.curTarget || target, amount + (st.item.timed ? 5 : 1));
    } else if (st.kind === 'test') {
      A.tests[st.item.test] = A.tests[st.item.test] || {};
      A.tests[st.item.test][st.side] = r.value || 0;
      const t = A.tests[st.item.test];
      if (t.L != null && t.R != null) {
        // How the catch-up stood before, in case the workout is cancelled.
        const was = A.catchupWas || (A.catchupWas = {});
        if (!was[st.item.test]) was[st.item.test] = JSON.parse(JSON.stringify(S.catchup[st.item.test]));
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
  function amendLast(S, amount, load) {
    const A = S.active;
    if (!A || A.idx === 0) return false;
    const st = A.steps[A.idx - 1];
    if (!st || st.kind !== 'set') return false;
    const log = A.logs[itemIndex(A, st.item)];
    const last = log && log.sets[log.sets.length - 1];
    if (!last) return false;
    if (amount != null) last.amount = Math.max(0, Math.round(amount));
    if (load != null && load > 0) { last.load = load; st.item.curLoad = load; }
    if (last.amount < last.target) st.item.curTarget = Math.min(st.item.curTarget || last.target, last.amount + (st.item.timed ? 5 : 1));
    return true;
  }
  // The weight for the rest of this exercise (the player's weight picker).
  function setItemLoad(S, item, kg) {
    if (!item || !(kg > 0)) return;
    item.curLoad = kg;
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
    // Keep the slot's family when the new move is one of its own (gym pools share moves).
    const fam = item.fam && M().LADDERS[item.fam] && M().LADDERS[item.fam].rungs.includes(newMoveId) ? item.fam : m.family;
    const st = S.prog[fam] || {};
    item.moveId = newMoveId; item.name = m.name;
    item.target = clampInt(st.rung === newMoveId ? st.reps : m.start, m.range[0], m.range[1]);
    item.curTarget = null; item.curLoad = null;
    item.timed = !!m.timed; item.uni = !!m.uni; item.load = loadInfo(S, m, A ? A.day : null, fam); item.swapped = true;
    if (A) {
      const i = itemIndex(A, item);
      if (i >= 0) Object.assign(A.logs[i], { moveId: newMoveId, target: item.target, timed: item.timed, uni: item.uni, swapped: true, fam });
      item.fam = fam;
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
    const fam = item.fam && M().LADDERS[item.fam] ? item.fam : m.family;
    const list = rungs(S, fam, day);
    const at = list.indexOf(item.moveId);
    if (at > 0 && ok(list[at - 1])) out.push({ id: list[at - 1], why: 'Easier' });
    const home = placeOf(S, day) === 'home';
    for (const [f2, lad] of Object.entries(M().LADDERS)) {
      if (f2 === fam || lad.group !== group || (home && lad.gym)) continue;
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
    const c = Object.assign({}, checkin || {});
    // A flare day's gentle range of motion (src/access.js) says nothing about training volume.
    if (A.session && A.session.flare) { c.rating = null; c.complicated = null; }
    const cal = calendar(S, A.day);
    const week = cal.weeks[weekStart(A.day)];
    const deload = !!(week && week.phase.deload);
    const lines = [];
    const celebrate = [];
    const planned = A.session.items.reduce((a, it) => a + it.sets, 0) + A.session.extras.length;
    const doneSets = A.logs.reduce((a, l) => a + new Set(l.sets.map((x) => x.set + (l.kind === 'extra' ? 'x' : ''))).size, 0);
    // A session with no sets counts only when gentle range of motion was the point (a flare day);
    // an empty workout (a light day in its place, see lightInstead) isn't a workout done.
    const pct = planned ? Math.min(1, doneSets / planned) : A.session.flare ? 1 : 0;
    // 1. Reps and rungs from the per-exercise answers.
    for (let i = 0; i < A.logs.length; i++) {
      const log = A.logs[i];
      if (log.kind !== 'move' || !log.sets.length) continue;
      const fam = log.fam && M().LADDERS[log.fam] ? log.fam : (M().MOVES[log.moveId] || {}).family;
      const before = progSnap(S, fam, log.moveId);
      // [custom plans] Their exercises move on from the plan's own numbers (src/customplan.js).
      const planItem = A.session.custom && GH.customPlan ? A.session.items.concat(A.session.extras)[i] : null;
      const res = planItem ? GH.customPlan.progress(S, log, deload, A.day, planItem) : progress(S, log, deload, A.day);
      log.outcome = planItem ? res.outcome || 'hold' : outcomeOf(before, progSnap(S, fam, log.moveId), isGymFam(fam));
      if (res.line) lines.push(res.line);
      for (const c2 of res.celebrate || []) celebrate.push(c2);
    }
    if (A.finisher && A.finisher.rir) {
      const ff = (A.session.finisher && A.session.finisher.fam) || 'finisher';
      const st = S.prog[ff] || (S.prog[ff] = { rung: A.finisher.moveId, reps: 0, best: {} });
      if (A.finisher.rir === '3' && !deload) {
        st.fmt = Math.min(4, (st.fmt || 0) + 1);
        lines.push({ text: 'Finisher: longer work intervals', why: 'you had plenty left' });
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
  // Where an exercise stands, to tell whether a workout moved it up, held it or took it down.
  function progSnap(S, fam, moveId) {
    const st = S.prog[fam];
    if (!st) return null;
    const lad = M().LADDERS[fam];
    return { rung: lad ? lad.rungs.indexOf(st.rung) : -1, reps: st.reps || 0, w: st.w || 0, load: st.loads && st.loads[moveId] != null ? st.loads[moveId] : null };
  }
  function outcomeOf(a, b, gym) {
    if (!a || !b) return 'hold';
    const cmp = (x, y) => (y > x + 1e-6 ? 1 : y < x - 1e-6 ? -1 : 0);
    const steps = gym ? [cmp(a.load || 0, b.load || 0), cmp(a.reps, b.reps)] : [a.rung === b.rung ? 0 : cmp(a.rung, b.rung), cmp(a.w, b.w), cmp(a.reps, b.reps)];
    // The first thing that changed decides it: a heavier weight with reps reset counts as up.
    const d = steps.find((x) => x !== 0) || 0;
    return d > 0 ? 'up' : d < 0 ? 'down' : 'hold';
  }
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
    const fam = log.fam && M().LADDERS[log.fam] ? log.fam : m.family;
    repin(S, fam, log);
    if (isGymFam(fam)) return progressGym(S, fam, log, deload, day);
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
    // A swap doesn't move its own ladder; a fast-up version (src/access.js) counts as its base rung.
    if (log.moveId !== st.rung && m.powerOf !== st.rung) return res;
    if (deload) return res;
    const [lo, hi] = rangeFor(S, m, fam);
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
        const next = Math.min(hi, st.reps + stepFor(S, log.timed ? 10 : 2, log.timed, '3'));
        if (next !== st.reps) { st.reps = next; res.line = { text: `${name} → ${next}${unit}`, why: 'you had 3+ left' }; }
      }
    } else if (log.rir === '12') {
      if (allHit) {
        const next = Math.min(hi, st.reps + stepFor(S, log.timed ? 5 : st.reps < 12 ? 1 : 2, log.timed, '12'));
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

  // A move a plan tweak pinned to its ladder: the ladder moves onto it the first time it's done, so
  // its reps (or weight) progress from there like any rung's.
  function repin(S, fam, log) {
    const st = S.prog[fam];
    const m = M().MOVES[log.moveId];
    if (!st || !m || st.rung === log.moveId || !isPinned(S, log.moveId) || !M().LADDERS[fam] || !M().LADDERS[fam].rungs.includes(log.moveId)) return;
    const [lo, hi] = rangeFor(S, m, fam);
    Object.assign(st, { rung: log.moveId, reps: clampInt(log.target || m.start, lo, hi), short: 0, cooldown: 0 });
  }

  // How many reps (or seconds) a good set adds: src/access.js makes the steps a little bigger under
  // 30 and smaller from 50.
  function stepFor(S, base, timed, rir) { return GH.access ? GH.access.repStep(S.profile, base, timed, rir) : base; }

  // Rep range for a move, by goal. Heavier sets build more maximal strength while muscle grows
  // about as well across a wide range of loads (Schoenfeld et al. 2017), so a strength goal moves
  // the main gym lifts to 4-8 reps, and the big home moves to 5-10: a harder version comes sooner
  // instead of ever more reps. An endurance goal moves smaller exercises up a little.
  const MAIN_LIFTS = ['pressG', 'squatG', 'hingeG', 'pullG', 'rowG', 'ohpG'];
  const HOME_COMPOUND = ['push', 'chestDb', 'squat', 'hinge', 'row', 'pull', 'press'];
  function rangeFor(S, m, fam, day) {
    const own = GH.access && GH.access.repRange ? GH.access.repRange(S, m, fam, day) : null; // a health condition's (src/access.js)
    if (own) return own;
    const [lo, hi] = m.range;
    if (m.timed) return [lo, hi];
    const top = (S.profile.goals || []).slice(0, 2);
    if (top.includes('strength') && MAIN_LIFTS.includes(fam) && m.load) return [Math.min(lo, 4), Math.max(Math.min(hi, 8), Math.min(lo, 4) + 3)];
    if (top.includes('strength') && HOME_COMPOUND.includes(fam)) return [5, 10];
    if (top.includes('endurance') && (M().LADDERS[fam] || {}).iso) return [lo + 3, hi + 5];
    return [lo, hi];
  }

  // Gym moves: double progression. Reps climb to the top of the range, then the weight goes up one
  // step and reps start again at the bottom (Plotkin et al. 2022: adding reps or load both work).
  // Short of the range twice in a row means about 10% lighter. The best estimated one-rep max
  // (Epley, counting the reps left in the tank) is kept per exercise for the strength charts.
  const RIR_NUM = { 0: 0, 12: 1.5, 3: 3 };
  function progressGym(S, fam, log, deload, day) {
    const m = M().MOVES[log.moveId];
    const res = { celebrate: [] };
    const st = S.prog[fam] || ensureProg(S, fam, day);
    if (!st) return res;
    st.loads = st.loads || {}; st.e1rm = st.e1rm || {}; st.best = st.best || {};
    const firstSide = log.uni ? log.sets.filter((_, k) => k % 2 === 0) : log.sets;
    if (!firstSide.length) return res;
    const unit = log.timed ? ' s' : ' reps';
    const loaded = firstSide.filter((x) => x.load > 0);
    const key = loaded.length ? M().loadFor(m, eqFor(S, day)) : null;
    const work = loaded.length ? Math.max(...loaded.map((x) => x.load)) : null;
    const rirN = RIR_NUM[log.rir] != null ? RIR_NUM[log.rir] : 1;
    if (work != null) {
      const e = Math.max(...loaded.map((x) => x.load * (1 + (x.amount + rirN) / 30)));
      const prev = st.e1rm[m.id];
      if (prev && e > prev.best * 1.01) {
        const top = loaded.reduce((a, x) => (x.load * (1 + x.amount / 30) > a.load * (1 + a.amount / 30) ? x : a), loaded[0]);
        const k = `e1rm:${m.id}:${Math.round(e)}`;
        if (!S.celebrated[k]) { S.celebrated[k] = day; res.celebrate.push({ kind: 'pr', text: `New best: ${m.name.toLowerCase()}, ${fmtLoad(S, top.load, key, m)} × ${top.amount}` }); }
      }
      st.e1rm[m.id] = { best: Math.max(e, prev ? prev.best : 0), last: e, day, hist: ((prev && prev.hist) || []).concat([[day, Math.round(e * 10) / 10]]).slice(-30) };
      st.loads[m.id] = work;
    } else {
      const best = Math.max(...firstSide.map((x) => x.amount));
      const prevBest = st.best[m.id] || 0;
      if (best > prevBest) {
        st.best[m.id] = best;
        const k = `pr:${m.id}:${best}`;
        if (prevBest > 0 && !S.celebrated[k]) { S.celebrated[k] = day; res.celebrate.push({ kind: 'pr', text: `New best: ${best}${log.timed ? ' s' : ''} ${m.name.toLowerCase()}` }); }
      }
    }
    if (st.cooldown > 0) st.cooldown--;
    if (log.moveId !== st.rung || deload) return res;
    // Three sessions in a row with no gain on this exercise: switch to the next option in the pool
    // (a different bar, angle or machine). Some variation can help, rotating constantly doesn't
    // (Kassiano et al. 2022), so it happens at most once every three weeks per muscle slot.
    const hist = (st.e1rm[m.id] && st.e1rm[m.id].hist) || [];
    if (hist.length >= 4 && !(st.rotatedAt > day - 21) && !isPinned(S, m.id)) {
      const recent = hist.slice(-3).map((x) => x[1]);
      const before = hist[hist.length - 4][1];
      if (Math.max(...recent) <= before * 1.005) {
        const list = rungs(S, fam, day);
        const at = list.indexOf(m.id);
        const next = list.length > 1 ? list[(at + 1) % list.length] : null;
        if (next && next !== m.id) {
          const nm = M().MOVES[next];
          const [nlo, nhi] = rangeFor(S, nm, fam);
          st.rung = next; st.reps = clampInt(nm.start, nlo, nhi); st.short = 0; st.rotatedAt = day;
          res.line = { text: `${m.name} → ${nm.name}`, why: 'no progress in three sessions: a new angle often helps' };
          return res;
        }
      }
    }
    const [lo, hi] = rangeFor(S, m, fam);
    const target = log.target;
    const allHit = firstSide.every((x) => x.amount >= target);
    const avg = firstSide.reduce((a, x) => a + x.amount, 0) / firstSide.length;
    if (allHit && (log.rir === '3' || log.rir === '12')) {
      st.short = 0;
      if (st.reps >= hi) {
        const next = work != null && key ? snapLoad(S, key, work, +1, day) : null;
        if (next != null && next > work + 1e-6) {
          st.loads[m.id] = next;
          st.reps = lo;
          res.line = { text: `${m.name} → ${fmtLoad(S, next, key, m)}`, why: 'top of the rep range with reps to spare' };
          res.celebrate.push({ kind: 'weight', text: `Heavier: ${fmtLoad(S, next, key, m)} ${m.name.toLowerCase()}` });
        } else if (!st.topNoted || st.topNoted[m.id] == null) {
          (st.topNoted = st.topNoted || {})[m.id] = day;
          res.line = work != null
            ? { text: `${m.name}: the heaviest option here. Lower it slowly to keep it hard.`, why: 'the rack tops out' }
            : { text: `${m.name}: top of the rep range. Hold a dumbbell to keep progressing.`, why: 'you had reps to spare' };
        }
      } else {
        const next = Math.min(hi, st.reps + stepFor(S, log.rir === '3' ? 2 : 1, false, log.rir));
        if (next !== st.reps) { st.reps = next; res.line = { text: `${m.name} → ${next}${unit}`, why: log.rir === '3' ? 'you had 3+ left' : 'you had 1-2 left' }; }
      }
    } else if (!allHit) {
      if (avg < lo) {
        st.short = (st.short || 0) + 1;
        if (st.short >= 2 && work != null && key) {
          let down = snapLoad(S, key, work * 0.9, 0, day);
          if (!(down < work - 1e-6)) down = snapLoad(S, key, work, -1, day);
          if (down != null && down < work - 1e-6) {
            st.loads[m.id] = down; st.reps = clampInt(Math.round((lo + hi) / 2), lo, hi); st.short = 0;
            res.line = { text: `${m.name} → ${fmtLoad(S, down, key, m)}`, why: 'below the rep range twice' };
          }
        } else {
          st.reps = Math.max(lo, Math.round(avg));
          res.line = { text: `${m.name} → ${st.reps}${unit}`, why: 'matching what you got' };
        }
      } else {
        st.short = 0;
        const nt = Math.max(lo, Math.round(avg));
        if (nt < st.reps) { st.reps = nt; res.line = { text: `${m.name} → ${nt}${unit}`, why: 'matching what you got' }; }
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
    // A move a plan tweak picked stays: no harder rung while it's pinned.
    if (at >= 0 && at < list.length - 1 && !(st.cooldown > 0) && !isPinned(S, st.rung)) {
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

  // Weekly sets, adjusted per muscle once a week. More weekly sets build more muscle, with smaller
  // returns at the top (Schoenfeld et al. 2017; Pelland et al. 2026), and how much each person
  // tolerates varies, so the plan follows your own signals: a goal muscle that's progressing while
  // you recover well gets a set more (up to its cap); one that's going backwards while you're run
  // down (workouts rated too hard, very sore days) gets a set less (down to its floor). Muscles
  // that aren't goals stay at their maintenance dose. A big calorie deficit holds increases, since
  // a deficit blunts muscle gain (Murphy & Koehler 2022).
  function weeklyVolumeUpdate(S, day) {
    const lines = [];
    const cal = calendar(S, day);
    const prog = programFor(S.profile);
    for (const [wsStr, w] of Object.entries(cal.weeks)) {
      const ws = Number(wsStr);
      if (ws + 6 >= day || (S.volWeeksDone || []).includes(ws)) continue;
      S.volWeeksDone = (S.volWeeksDone || []).concat(ws);
      if (w.phase.deload) continue;
      const logs = workoutLogs(S).filter((l) => l.day >= ws && l.day <= ws + 6 && isDone(l));
      if (!logs.length) continue;
      const hard = logs.filter((l) => l.checkin && l.checkin.rating === 'hard').length;
      let sore = 0;
      for (let d = ws; d <= ws + 6; d++) if (S.feel && S.feel[d] && S.feel[d].sore === 'very') sore++;
      const recovering = hard === 0 && sore < 2;
      const holdGrowth = !!(GH.food && GH.food.holdsVolume && GH.food.holdsVolume(S, ws));
      const up = [], down = [];
      for (const g of GROUPS) {
        const items = [];
        for (const l of logs) for (const it of l.items || []) if (it.group === g && it.kind === 'move' && it.sets && it.sets.length) items.push(it);
        if (!items.length) continue;
        const ups = items.filter((it) => it.outcome === 'up').length;
        const downs = items.filter((it) => it.outcome === 'down').length;
        if (prog.tiers[g] <= 2 && w.allDone && recovering && !holdGrowth && ups > 0 && downs === 0 && S.vol[g] < prog.cap[g]) { S.vol[g]++; up.push(g); }
        else if (!recovering && downs > ups && S.vol[g] > prog.floor[g]) { S.vol[g]--; down.push(g); }
      }
      if (up.length) lines.push({ text: `${listNames(up)} +1 set a week`, why: 'progressing and recovering well' });
      if (down.length) lines.push({ text: `${listNames(down)} one set less a week`, why: 'going backwards while run down' });
      if (holdGrowth && !up.length) lines.push({ text: 'Weekly sets held where they are', why: 'a big calorie deficit this week' });
    }
    return lines;
  }

  // A daily steps target from your own normal: 10% above your 4-week median, in 500-step
  // increments, between 5,000 and 10,000 (8,000 from 60). Benefits in the big step studies level
  // off around 8,000-10,000 a day under 60 and 6,000-8,000 from 60 (Paluch et al. 2022).
  function stepsGoal(S, day) {
    const h = (S.health && S.health.days) || {};
    const v = [];
    for (let d = day - 28; d < day; d++) if (h[d] && h[d].steps != null) v.push(h[d].steps);
    const cap = S.profile.age >= 60 ? 8000 : 10000;
    if (v.length < 7) return { goal: Math.min(cap, 7000), usual: null, personal: false };
    const med = median(v);
    return { goal: Math.max(5000, Math.min(cap, Math.round((med * 1.1) / 500) * 500)), usual: Math.round(med), personal: true };
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
  // Quick protein adds, plus the protein in logged food when calorie tracking is on.
  function proteinToday(S, day) { return (S.protein[day] || []).reduce((a, b) => a + b, 0) + (GH.food && GH.food.proteinOn ? GH.food.proteinOn(S, day) : 0); }
  function addProtein(S, day, g) { (S.protein[day] = S.protein[day] || []).push(Math.round(g)); }
  function undoProtein(S, day) { if (S.protein[day] && S.protein[day].length) S.protein[day].pop(); }

  /* ================================================================== weekly summaries */
  function weeklySets(S, day) {
    const ws = weekStart(day);
    const out = {};
    // A week that's over keeps the sets it last had planned (src/optimizer.js, keptOf), while its
    // workouts stay as they were (weekLog): what was planned for it then, not what the state as it
    // is now would plan. What's done is counted from the log, as ever.
    const K = GH.optimizer && GH.optimizer.kept;
    const pastKey = K ? `sets|${ws}|${weekLog(S, ws)}` : null;
    const was = K && ws < K.thisWeek(S) ? K.get(S, 'sets', pastKey) : undefined;
    const frozen = !!was && GROUPS.every((g) => was[g] && Number.isFinite(was[g].target) && Number.isFinite(was[g].planned));
    if (frozen) for (const g of GROUPS) out[g] = { done: 0, target: was[g].target, planned: was[g].planned };
    const cal = frozen ? null : calendar(S, day);
    const week = cal && cal.weeks[ws];
    const mult = week ? week.phase.mult : 1;
    // The target is what the week's plan gives each group (src/optimizer.js: the weekly sets, more
    // when there's time for them, fewer when there isn't); a custom plan's week keeps the old one.
    const custom = week && GH.customPlan && week.sessions.some((s) => GH.customPlan.owns(s.tpl));
    const wp = !custom && GH.optimizer && GH.optimizer.weekPlan && week ? GH.optimizer.weekPlan(S, ws, { phase: week.phase }) : null;
    if (!frozen) for (const g of GROUPS) out[g] = { done: 0, target: wp && wp.perGroup[g] ? wp.perGroup[g].aim : Math.round(S.vol[g] * mult), planned: 0 };
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
    if (K && !frozen) {
      const keep = {};
      for (const g of GROUPS) keep[g] = { target: out[g].target, planned: out[g].planned };
      K.put(S, 'sets', [pastKey], keep, String(ws), ws);
    }
    return out;
  }

  // Setting changes take effect from today; the replay uses the settings in force each week.
  // Workouts a week and the days they're on stay in step. Picking days sets the count (2 to 6: a
  // seventh is refused, one day stays for rest). A new count with days picked adds days where they
  // spread the week most evenly, or drops the last ones picked. { days, weekdays, note }; weekdays is
  // in the order picked, and [] means the default spread for the count.
  const MAX_DAYS = 6;
  function pickWeekday(days, picked, wd, on) {
    let list = (Array.isArray(picked) ? picked : []).filter((x, i, a) => x >= 0 && x <= 6 && a.indexOf(x) === i);
    if (on && !list.includes(wd)) {
      if (list.length >= MAX_DAYS) return { days: clampInt(days, 2, MAX_DAYS), weekdays: list, note: 'max' };
      list = list.concat([wd]);
    } else if (!on) list = list.filter((x) => x !== wd);
    return { days: list.length >= 2 ? list.length : clampInt(days, 2, MAX_DAYS), weekdays: list, note: list.length === 1 ? 'one' : null };
  }
  function setWorkoutDays(picked, n) {
    const days = clampInt(n, 2, MAX_DAYS);
    let list = (Array.isArray(picked) ? picked : []).filter((x, i, a) => x >= 0 && x <= 6 && a.indexOf(x) === i);
    if (!list.length) return { days, weekdays: [], note: null };
    while (list.length > days) list = list.slice(0, -1);
    while (list.length < days) {
      // The free day furthest (round the week) from the days already picked; the earliest on a tie.
      const gap = (d) => Math.min(...list.map((x) => { const g = Math.abs(d - x); return Math.min(g, 7 - g); }));
      const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !list.includes(d));
      list = list.concat([free.reduce((a, d) => (gap(d) > gap(a) ? d : a), free[0])]);
    }
    return { days, weekdays: list, note: null };
  }
  function updateSettings(S, day, patch) {
    // Days picked decide the count, whatever count came with them.
    if (Array.isArray(patch.weekdays) && patch.weekdays.length >= 2) {
      const w = [...new Set(patch.weekdays.filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b).slice(0, MAX_DAYS);
      patch = Object.assign({}, patch, { weekdays: w, days: w.length });
    }
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
      if (isGymFam(fam)) continue;
      const m = M().MOVES[st.rung];
      const key = m && M().loadFor(m, S.profile.equipment);
      if (key === 'db' || key === 'kb') {
        if (maxOf(key, S.profile.equipment) > maxOf(key, old)) {
          const list = rungs(S, fam, day, { place: 'home' });
          const at = Math.max(0, list.indexOf(st.rung) - 2);
          st.rung = list[at] || st.rung; st.reps = M().MOVES[st.rung].start; st.maxed = false;
          const ws = (S.profile.equipment[key] || []).slice().sort((a, b) => a - b);
          st.w = Math.max(0, ws.length - 1);
          lines.push({ text: `${M().LADDERS[fam].name} → ${M().MOVES[st.rung].name}`, why: 'heavier equipment' });
        }
      }
    }
    // Ladders that lost their current rung move to the nearest available one (home families; gym
    // families check their own equipment when they're used).
    for (const fam of Object.keys(M().LADDERS)) {
      if (isGymFam(fam)) continue;
      const list = rungs(S, fam, day, { place: 'home' });
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
    if (profilePatch.gym) S.profile.gym = Object.assign(defaultGym(), profilePatch.gym);
    // Gym families whose current exercise is gone move to the first one that's still there.
    for (const fam of Object.keys(S.prog)) {
      if (!isGymFam(fam)) continue;
      const list = rungs(S, fam, day, { place: 'gym' });
      const st = S.prog[fam];
      if (list.length && !list.includes(st.rung)) { st.rung = list[0]; st.reps = M().MOVES[list[0]].start; }
    }
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
    DAY_MS, dayOf, dayFromStr, dayStr, weekday, weekStart, fmtDay, fmtMin, GROUPS, GROUP_NAME, JOINTS, LB_PER_KG, MUSCLE_GROUP, focusOf, pickWeekday, setWorkoutDays,
    defaultProfile, programFor, templateFor, templateTitle, newState, applyBaseline, rungs, filtersFor,
    calendar, weekOf, todayPlan, readiness, buildSession, estimate, steps, startWorkout, cancelWorkout, restoreWorkout, completeStep, currentTarget,
    setRir, amendLast, swapItem, swapOptions, finishWorkout, progress, levelUp, nextWeight, weeklyVolumeUpdate, recordTest, testDue,
    logLight, autoWalk, addWeight, weightStats, proteinGoal, proteinToday, addProtein, undoProtein, weeklySets,
    updateSettings, scheduleSettings, settingsAt, moveSession, setEquipment, reprogram, ladderLevel, mobilityFlow, loadInfo, isDone, relink, median,
    defaultGym, GYM_PRESETS, DB_MAX_OPTIONS, convertDbMax, rangeFor, stepsGoal, outcomeOf, weekdaysFor, gymPreset, placeOf, setPlace, eqAt, eqFor, dbRack, snapLoad, suggestLoad, fmtLoad, loadChoices, setItemLoad, ensureProg, isGymFam, toUnit, fromUnit,
  };
  // For src/access.js, which builds balance and floor-practice slots like any other.
  Object.assign(GH.brain, { itemFor, famFor, restFor, tierOf, cooldownItems });
  // For src/optimizer.js, which plans the weeks and fits sessions to their time.
  Object.assign(GH.brain, {
    UNIT_GROUPS, UNIT_OF, COMPOUND, MAIN_LIFTS, HOME_COMPOUND, FAM_FOCUS, MERGE_MAX, SET_MAX,
    realize, slotsOfDay, slotsForUnit, warmupItems, mobilityIds, finisherItem, finisherFor, pairSupersets, unpair, secsPerSet,
    limitExercises, mergeSame, orderItems, musclesOf, trimTier, perSession, autoRest, tweaksOf, isPinned, supersetConflict: conflicts,
    weekSettings, weekInputs, templateOf, templateV1, legacyGroupSets, occurrences, legacyWeek, stateStamp, dayStamp, progStamp, planProfile, weekLog, freeze, op, inOp, opToken,
  });
})(typeof window !== 'undefined' ? window : globalThis);
