// Every combination of a person's answers, built into weeks and sessions, against the plan's
// invariants. Profiles come from a seeded pairwise covering array over every input (goals,
// experience, days, weekdays, minutes, kit, gym, joints, pain, impact, age, conditions, floor,
// focus, lead side, supersets, rest, complexity, units), plus edge profiles and seeded random ones.
// Each is built for its on-ramp week and a full week; some also for a deload week, a bad-sleep day
// and short mode. It prints how full sessions are against their time, and fails on any broken rule.
//
// Usage: node test/combos.mjs [--full] [--seed=N] [--json=path]
//   --full   a 3-wise covering array instead of pairwise, and 12-week simulations (before a release)
//   --only=3,17,40-60  just those profiles, with --trace to print their weeks and sessions
//   --examples=N  keep N examples of each broken rule (4 by default)
//   --dump=path  with --only, each profile's starting state as JSON (to look into one closely)
import { writeFileSync } from 'node:fs';
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/brain.js', 'src/access.js', 'src/customplan.js');
const B = GH.brain, M = GH.moves, AC = GH.access, CP = GH.customPlan;
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const SEED = Number((args.find((a) => a.startsWith('--seed=')) || '--seed=16').split('=')[1]);
const JSON_OUT = (args.find((a) => a.startsWith('--json=')) || '').split('=')[1] || null;
const ONLY = ((args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean)
  .flatMap((x) => { const [lo, hi] = x.split('-').map(Number); return hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [lo]; });
const TRACE = args.includes('--trace');
const DUMP = (args.find((a) => a.startsWith('--dump=')) || '').split('=')[1] || null;
const dumped = {};
const EXAMPLES = Number((args.find((a) => a.startsWith('--examples=')) || '--examples=4').split('=')[1]) || 4;
const T0 = Date.now();
const D0 = B.dayFromStr('2026-09-28'); // a Monday

/* ------------------------------------------------------------------ seeded randomness */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ the inputs */
const NONE = { db: [], kb: [], ball: false, ballLb: null, ballSlam: false, band: false, bar: false, chair: false, wall: false, towel: false, table: false, door: false };
const HOUSE = Object.assign({}, NONE, { chair: true, wall: true, towel: true });
const KITS = {
  nothing: NONE,
  house: HOUSE,
  chairOnly: Object.assign({}, NONE, { chair: true }),
  band: Object.assign({}, HOUSE, { band: true }),
  bandDoor: Object.assign({}, HOUSE, { band: true, door: true }),
  dbLight: Object.assign({}, HOUSE, { db: [5, 10] }),
  dbFull: Object.assign({}, HOUSE, { db: [5, 10, 15, 20, 25, 30, 40, 50] }),
  kettlebell: Object.assign({}, HOUSE, { kb: [12] }),
  bar: Object.assign({}, HOUSE, { bar: true }),
  ball: Object.assign({}, HOUSE, { ball: true, ballLb: 8, ballSlam: true }),
  tableDoor: Object.assign({}, HOUSE, { table: true, door: true }),
  everything: { db: [5, 10, 15, 20, 25, 30, 40, 50], kb: [8, 12, 16], ball: true, ballLb: 10, ballSlam: true, band: true, bar: true, chair: true, wall: true, towel: true, table: true, door: true },
};
const GYMS = {
  full: (u) => B.gymPreset('full', u),
  basic: (u) => B.gymPreset('basic', u),
  small: (u) => B.gymPreset('small', u),
  // A gym with little more than cardio machines: most of the plan comes from the home ladders.
  cardio: () => Object.assign(B.defaultGym(), { bar: false, treadmill: true, bike: true, dbMax: 0 }),
};
const GOALS = [
  ['consistency'], ['abs', 'arms'], ['chest', 'back'], ['legs'], ['arms', 'chest', 'legs', 'abs'], ['strength'], ['strength', 'legs'],
  ['fat', 'consistency'], ['fat', 'abs'], ['endurance'], ['mobility', 'back'], ['back', 'shoulders', 'legs'],
  ['abs', 'arms', 'chest', 'legs', 'back', 'consistency'], ['endurance', 'strength', 'mobility', 'fat'],
];
const CONDS = [[], ['ra'], ['oa'], ['osteo'], ['back'], ['bp'], ['balance'], ['seated'], ['hands'], ['heart'], AC.CONDITIONS.map((c) => c.id)];
const FACTORS = [
  ['goals', GOALS],
  ['experience', ['never', 'onoff', 'lt1', '1to3', '3plus']],
  ['recentActivity', ['none', 'some', 'regular']],
  ['days', [2, 3, 4, 5, 6]],
  ['weekdays', ['none', 'rotated', 'adjacent', 'duplicate']],
  ['minutes', [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]],
  ['lightDays', [true, false]],
  ['where', ['home', 'gym', 'both']],
  ['kit', Object.keys(KITS)],
  ['gym', Object.keys(GYMS)],
  ['dbMax', ['none', 'some', 'most']],
  ['careful', [[], ['knee'], ['shoulder'], ['back'], ['wrist'], ['elbow'], ['hip'], ['ankle'], ['neck'], ['knee', 'shoulder']]],
  ['pain', [[], ['knee'], ['shoulder'], ['wrist'], ['back'], ['knee', 'hip', 'ankle']]],
  ['impact', ['on', 'off', 'jumps']],
  ['gentle', [false, true]],
  ['age', [13, 16, 17, 25, 45, 55, 65, 75, 85, 95]],
  ['conditions', CONDS],
  ['floorOk', [true, false]],
  ['focus', [[], ['calves'], ['rearDelts', 'glutes'], ['sideDelts', 'lats', 'quads', 'hamstrings'], ['obliques', 'forearms']]],
  ['lead', ['none', 'arm', 'leg', 'both']],
  ['supersets', [true, false]],
  ['rest', ['auto', 60, 90]],
  ['complexity', [0, 1, 2]],
  ['units', ['lb', 'kg']],
];
const NAMES = FACTORS.map(([n]) => n);
const LEVELS = FACTORS.map(([, v]) => v.length);

// A row of level indices → the answers it stands for.
function specOf(row) { const o = {}; FACTORS.forEach(([n, v], i) => { o[n] = v[row[i]]; }); return o; }

/* ------------------------------------------------------------------ covering arrays */
// Greedy t-wise covering array: each new row starts from a tuple not covered enough yet, then picks
// the level of every other factor that covers the most such tuples; the best of a few candidates is
// kept. `times` asks for every tuple in that many rows. Seeded, so the same rows come out every run.
function covering(levels, t, rand, tries, times) {
  const k = levels.length;
  const combos = [];
  const rec = (start, acc) => { if (acc.length === t) { combos.push(acc.slice()); return; } for (let i = start; i < k; i++) { acc.push(i); rec(i + 1, acc); acc.pop(); } };
  rec(0, []);
  const size = combos.map((c) => c.reduce((a, f) => a * levels[f], 1));
  const covered = combos.map((_, i) => new Uint8Array(size[i]));
  const byFactor = Array.from({ length: k }, () => []);
  combos.forEach((c, i) => c.forEach((f) => byFactor[f].push(i)));
  const idx = (c, row) => c.reduce((a, f) => a * levels[f] + row[f], 0);
  let left = size.reduce((a, b) => a + b, 0) * times;
  const rows = [];
  while (left > 0) {
    let best = null, bestGain = -1;
    for (let n = 0; n < tries; n++) {
      // A tuple not covered enough yet, found from a random starting combination.
      const row = new Array(k).fill(-1);
      const c0 = Math.floor(rand() * combos.length);
      for (let j = 0; j < combos.length; j++) {
        const ci = (c0 + j) % combos.length;
        const cov = covered[ci];
        const start = Math.floor(rand() * cov.length);
        let hit = -1;
        for (let x = 0; x < cov.length; x++) { const v = (start + x) % cov.length; if (cov[v] < times) { hit = v; break; } }
        if (hit < 0) continue;
        const c = combos[ci];
        for (let f = c.length - 1, v = hit; f >= 0; f--) { row[c[f]] = v % levels[c[f]]; v = Math.floor(v / levels[c[f]]); }
        break;
      }
      const order = row.map((v, f) => f).filter((f) => row[f] < 0);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const f of order) {
        let bl = 0, bg = -1;
        const off = Math.floor(rand() * levels[f]);
        for (let x = 0; x < levels[f]; x++) {
          const l = (off + x) % levels[f];
          row[f] = l;
          let g = 0;
          for (const ci of byFactor[f]) if (combos[ci].every((q) => row[q] >= 0) && covered[ci][idx(combos[ci], row)] < times) g++;
          if (g > bg) { bg = g; bl = l; }
        }
        row[f] = bl;
      }
      let gain = 0;
      for (let ci = 0; ci < combos.length; ci++) if (covered[ci][idx(combos[ci], row)] < times) gain++;
      if (gain > bestGain) { bestGain = gain; best = row; }
    }
    for (let ci = 0; ci < combos.length; ci++) { const v = idx(combos[ci], best); if (covered[ci][v] < times) { covered[ci][v]++; left--; } }
    rows.push(best);
  }
  return rows;
}

/* ------------------------------------------------------------------ a person from a row */
const PATTERNS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
function weekdaysFor(kind, D, n) {
  if (kind === 'rotated') return PATTERNS[D].map((x) => (x + 1 + (n % 6)) % 7).sort((a, b) => a - b);
  if (kind === 'adjacent') { const s = n % 7; return Array.from({ length: D }, (_, i) => (s + i) % 7).sort((a, b) => a - b); }
  if (kind === 'duplicate') { const p = PATTERNS[D]; return [p[0]].concat(p.slice(0, D - 1)); } // one day twice
  return null;
}
const DBMAX = { none: [0, 0], some: [50, 25], most: [100, 50] };
function person(spec, n) {
  const u = spec.units;
  const gym = GYMS[spec.gym](u);
  gym.dbMax = DBMAX[spec.dbMax][u === 'kg' ? 1 : 0] || (spec.dbMax === 'none' ? 0 : gym.dbMax);
  const p = {
    goals: spec.goals.slice(), experience: spec.experience, recentActivity: spec.recentActivity, days: spec.days,
    weekdays: weekdaysFor(spec.weekdays, spec.days, n), minutes: spec.minutes, lightDays: spec.lightDays, where: spec.where,
    equipment: JSON.parse(JSON.stringify(KITS[spec.kit])), gym, careful: spec.careful.slice(), impactOk: spec.impact !== 'off',
    jumpsOk: spec.impact === 'jumps' ? true : undefined, gentle: spec.gentle, age: spec.age, conditions: spec.conditions.slice(),
    floorOk: spec.floorOk ? undefined : false, focus: spec.focus.slice(), units: u, weightKg: 60 + (n % 50),
    lead: { arm: spec.lead === 'arm' || spec.lead === 'both' ? 'L' : null, leg: spec.lead === 'leg' || spec.lead === 'both' ? 'R' : null },
    prefs: { supersets: spec.supersets, rest: spec.rest },
  };
  if (spec.conditions.includes('back')) p.conditionsSince = { back: D0 - 100 };
  const S = B.newState(p, null, D0);
  S.complexity = spec.complexity;
  for (const j of spec.pain) S.pain[j] = D0 + 40;
  return S;
}

/* ------------------------------------------------------------------ what the rules allow */
const GROUPS = B.GROUPS;
const UNIT_PRI = (prog, g) => {
  if (g === 'abs') return 9;
  if (g === 'biceps' || g === 'triceps') return Math.min(prog.tiers.biceps, prog.tiers.triceps);
  return prog.tiers[g] || 3;
};
const CONFLICT = [['push', 'triceps'], ['row', 'curl'], ['pull', 'curl'], ['push', 'raise'], ['chestDb', 'triceps'], ['pull', 'row'], ['row', 'rear'], ['pull', 'rear'], ['chestDb', 'push'], ['squat', 'hinge'], ['squat', 'glute'], ['hinge', 'glute'],
  ['press', 'push'], ['press', 'chestDb'], ['press', 'triceps'], ['press', 'raise'], ['backExt', 'hinge'], ['backExt', 'row'], ['hamCurl', 'hinge'], ['hamCurl', 'glute'], ['calf', 'squat']];
const conflicts = B.supersetConflict || ((a, b) => a.group === b.group || CONFLICT.some(([x, y]) => (x === a.fam && y === b.fam) || (x === b.fam && y === a.fam)));
const painAt = (S, day) => Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
// Why a move can't be in this person's session today (null: it can).
function notAllowed(S, m, day, place, kind) {
  if (!m) return 'unknown move';
  const p = S.profile;
  const eq = B.eqAt(S, place);
  if (!M.allowed(m, eq)) return 'kit';
  if (AC && AC.why(p, m, day)) return `rules: ${AC.why(p, m, day)}`;
  if (m.impact && !B.programFor(p).impactOk) return 'impact';
  const pain = painAt(S, day);
  if ((m.joints || []).some((j) => pain.includes(j))) return 'pain';
  if (kind === 'work' && (m.impact || m.complex) && (m.joints || []).some((j) => (p.careful || []).includes(j))) return 'careful';
  if (kind === 'work' && (S.excluded || []).includes(m.id)) return 'excluded';
  if (kind === 'work' && S.complexity > 0 && m.complex) return 'simple mode';
  return null;
}
// Groups this person could train at all today: some move of the group they're allowed to do.
const possibleMemo = new Map();
function possible(S, day, place) {
  const key = JSON.stringify([S.profile, place, painAt(S, day), S.complexity]);
  if (possibleMemo.has(key)) return possibleMemo.get(key);
  const out = new Set();
  for (const m of Object.values(M.MOVES)) if (GROUPS.includes(m.group) && !out.has(m.group) && !(m.gym && place !== 'gym') && !notAllowed(S, m, day, place, 'work')) out.add(m.group);
  possibleMemo.set(key, out);
  return out;
}
// Effective sets for each group: direct sets, plus half for a move that also works a muscle of it.
function effective(items) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  const direct = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const it of items) {
    const m = M.MOVES[it.moveId];
    if (!m || !it.sets) continue;
    if (GROUPS.includes(it.group)) { out[it.group] += it.sets; direct[it.group] += it.sets; }
    const helped = new Set((m.muscles || []).map((mu) => B.MUSCLE_GROUP[mu]).filter((g) => g && g !== it.group));
    for (const g of helped) out[g] += it.sets * 0.5;
  }
  return { eff: out, direct };
}
const budgetOf = (S, s, o) => (s.budget != null ? s.budget : o && o.short ? 13 : B.settingsAt(S, s.day).minutes || S.profile.minutes);

/* ------------------------------------------------------------------ bookkeeping */
const viol = {};
function bad(name, detail) { const v = viol[name] || (viol[name] = { n: 0, ex: [] }); v.n++; if (v.ex.length < EXAMPLES) v.ex.push(detail); }
const times = [], planTimes = [];
const fills = []; // { budget, ratio, phase }
const weeks = { n: 0, zero: 0, zeroEff: 0, belowFloor: 0 };
const sessionsSeen = { n: 0, empty: 0, dup: 0, over: 0, maxOver: 0, mainShort: 0 };

// A session, timed apart from its week's plan (worked out once for each state of the week and
// kept; timed here when it's new).
function build(S, day, tpl, o) {
  const O = GH.optimizer;
  if (O && !(CP && CP.owns(tpl))) {
    const cal = (o && o.cal) || B.calendar(S, day);
    const ws = B.weekStart(day);
    const ph = cal.weeks[ws] ? cal.weeks[ws].phase : undefined;
    const n0 = O.stats.weeks;
    const t1 = performance.now();
    O.weekPlan(S, ws, { phase: ph });
    if (O.stats.weeks > n0) planTimes.push(performance.now() - t1);
  }
  const t0 = performance.now();
  const s = B.buildSession(S, day, tpl, o);
  times.push(performance.now() - t0);
  return s;
}

// The checks for one built session.
function checkSession(S, s, label, o) {
  sessionsSeen.n++;
  const p = S.profile;
  const prog = B.programFor(p);
  const budget = budgetOf(S, s, o);
  const est = B.estimate(S, s);
  const main = s.items.filter((it) => !it.skill);
  if (!s.flare) {
    if (!s.items.length && !s.light) { sessionsSeen.empty++; bad('every session has work (or is turned into a light day)', label); }
    if (!s.light && main.length < (budget >= 15 && !o.short ? 2 : 1)) { sessionsSeen.mainShort++; bad('at least 2 main exercises from 15 min (1 at 10 min)', `${label}: ${main.map((x) => x.moveId)}`); }
  }
  if (est > budget + 0.5) { sessionsSeen.over++; sessionsSeen.maxOver = Math.max(sessionsSeen.maxOver, est - budget); bad('no session runs over its time by more than 30 s', `${label}: ${est.toFixed(1)} of ${budget} min`); }
  if (!s.flare && !s.light && !o.malformed) fills.push({ budget, ratio: est / budget, phase: o.phase || 'full', short: !!o.short, label });
  const ids = s.items.map((it) => it.moveId);
  if (new Set(ids).size !== ids.length) { sessionsSeen.dup++; bad('no move twice in a session', `${label}: ${ids.join(',')}`); }
  if (s.finisher && ids.includes(s.finisher.moveId)) bad('no move twice in a session', `${label}: finisher ${s.finisher.moveId}`);
  // Only moves the rules allow.
  const day = s.day;
  for (const it of s.items.concat(s.extras || [], s.finisher ? [s.finisher] : [])) { const why = notAllowed(S, M.MOVES[it.moveId], day, s.place, 'work'); if (why) bad(`only allowed moves (${why.split(':')[0]})`, `${label}: ${it.moveId} ${why}`); }
  for (const it of (s.warmup || []).concat(s.mobility || [], s.tests || [])) { const why = notAllowed(S, M.MOVES[it.moveId], day, s.place, 'other'); if (why) bad(`only allowed moves (${why.split(':')[0]})`, `${label}: ${it.kind} ${it.moveId} ${why}`); }
  // Set caps.
  const perGroup = {};
  for (const it of s.items) {
    if (!(it.sets >= 1 && it.sets <= 6)) bad('at most 6 sets an exercise', `${label}: ${it.moveId}×${it.sets}`);
    perGroup[it.group] = (perGroup[it.group] || 0) + it.sets;
  }
  for (const [g, n] of Object.entries(perGroup)) if (n > 10) bad('at most 10 sets a muscle group a session', `${label}: ${g} ${n}`);
  if (S.complexity > 0) for (const it of s.items) if (it.sets > 6) bad('merged exercises keep at most 5 sets', `${label}: ${it.moveId}×${it.sets}`);
  // Tier order: priority work first (balance practice before it), abs last; a superset's second
  // exercise rides with its first.
  let last = -1;
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (it.skill) { if (last > 0) bad('priority order', `${label}: balance after work`); continue; }
    const prev = s.items[i - 1];
    if (it.superset && prev && prev.superset && prev.superset[0] === it.superset[0]) continue;
    const r = GROUPS.includes(it.group) ? UNIT_PRI(prog, it.group) : 5;
    if (r < last) { bad('priority order', `${label}: ${s.items.map((x) => `${x.group}${x.superset ? `/${x.superset}` : ''}`).join(' ')}`); break; }
    last = r;
  }
  // Supersets.
  const tags = {};
  for (const it of s.items) if (it.superset) (tags[it.superset[0]] = tags[it.superset[0]] || []).push(it);
  const off = !p.prefs.supersets || S.complexity > 0;
  for (const [k, pair] of Object.entries(tags)) {
    if (off) { bad('no supersets when they\'re off', `${label}: ${k}`); break; }
    if (pair.length !== 2 || conflicts(pair[0], pair[1])) bad('supersets pair two exercises that don\'t clash', `${label}: ${pair.map((x) => x.fam)}`);
    else if (Math.abs(s.items.indexOf(pair[0]) - s.items.indexOf(pair[1])) !== 1) bad('superset partners side by side', `${label}: ${k}`);
  }
  // Tests only when they're allowed.
  for (const t of s.tests || []) {
    const joints = t.test === 'leg' ? ['knee', 'hip', 'ankle'] : ['elbow', 'wrist', 'shoulder'];
    const sore = painAt(S, day).concat(p.careful || []).filter((j) => joints.includes(j));
    if ((AC && !AC.testsOk(S, t.test)) || sore.length) bad('left vs right tests only when allowed', `${label}: ${t.test} ${sore}`);
  }
  // Strength rep ranges at home.
  if ((p.goals || []).slice(0, 2).includes('strength')) {
    for (const it of s.items) {
      if (!['push', 'chestDb', 'squat', 'hinge', 'row', 'pull', 'press'].includes(it.fam) || it.timed) continue;
      const r = B.rangeFor(S, M.MOVES[it.moveId], it.fam);
      if (r[0] !== 5 || r[1] !== 10 || it.target < 5 || it.target > 10) bad('a strength goal works home compounds in 5 to 10 reps', `${label}: ${it.moveId} ${r} target ${it.target}`);
    }
  }
}

// A week as planned (no readiness): every session built and checked, and each group's sets
// checked over the week.
function checkWeek(S, ws, label, o) {
  const cal = B.calendar(S, ws);
  const week = cal.weeks[ws];
  if (!week) { bad('every week has a plan', label); return null; }
  const live = week.sessions.filter((x) => !x.dropped && x.day != null);
  const days = live.map((x) => x.day);
  if (new Set(days).size !== days.length) bad('never two workouts on one day', `${label}: ${days}`);
  const built = [];
  for (const x of live) {
    let s;
    try { s = build(S, x.day, x.tpl, { cal, noReadiness: true }); } catch (e) { bad('no crash', `${label} ${x.tpl}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); continue; }
    checkSession(S, s, `${label} ${B.dayStr(x.day)}`, { phase: o.phase });
    if (TRACE) console.log(`  ${label} ${B.dayStr(x.day)} ${s.title} ${B.estimate(S, s).toFixed(1)}/${budgetOf(S, s, {})} min: ${s.items.map((it) => `${it.moveId}×${it.sets}${it.superset ? `/${it.superset}` : ''}`).join(' ')}${s.finisher ? ` fin ${s.finisher.moveId}×${s.finisher.rounds}` : ''}${(s.mobility || []).length ? ` cool ${s.mobility.map((m) => `${m.moveId}:${m.target}`).join(',')}` : ''}`);
    built.push(s);
  }
  if (TRACE && GH.optimizer) {
    const wp = GH.optimizer.weekPlan(S, ws, { phase: week.phase });
    for (const d of wp.days) console.log(`    plan ${d.tpl} ${d.units.join('+')} ${JSON.stringify(d.groupSets)} ${d.planned}/${d.budget} min, fixed ${d.fixed}, a set ${JSON.stringify(d.per)}`);
    console.log(`    plan ${wp.split.label}${wp.parity ? ' (taking turns)' : ''}: ${Object.entries(wp.perGroup).filter(([, v]) => v.trainable).map(([g, v]) => `${g} ${v.aim}/${v.target} floor ${v.floor} eff ${v.effective}`).join(', ')}`);
  }
  if (!built.length) return null;
  weeks.n++;
  const prog = B.programFor(S.profile);
  const items = built.flatMap((s) => s.items.concat(s.extras || []));
  const { eff, direct } = effective(items);
  const can = possible(S, ws + 2, built[0].place);
  const mult = week.phase.mult;
  if (GROUPS.some((g) => can.has(g) && !direct[g])) weeks.zero++;
  if (GROUPS.some((g) => can.has(g) && !eff[g])) weeks.zeroEff++;
  const below = GROUPS.filter((g) => can.has(g) && eff[g] < Math.max(2, Math.round(prog.floor[g] * mult)));
  if (TRACE) console.log(`  ${label} effective: ${GROUPS.map((g) => `${g} ${eff[g]}${can.has(g) ? '' : '(-)'}`).join(', ')}${below.length ? `; below: ${below}` : ''}`);
  if (below.length) weeks.belowFloor++;
  for (const g of GROUPS) if (direct[g] > prog.cap[g]) bad('weekly sets stay under each group\'s cap', `${label}: ${g} ${direct[g]} > ${prog.cap[g]}`);
  // Coverage: every group it can train reaches its floor (scaled for a lighter week), or, when
  // the time is used up, at least 2 effective sets; when the week's sessions can't hold 2 sets of
  // each group, groups may take turns week by week (checked over two weeks by the caller). The
  // time for sets is the week's time less what every session holds anyway for this person: the
  // warm-up, balance and floor practice, a cool-down every session from 65 (and with some
  // conditions), the finisher when conditioning is a goal, and the lead side's catch-up sets and
  // left vs right tests the plan keeps time for. It holds whole sets only: what's
  // left of a session after its last whole set holds none (a set's minutes, its rest and setting
  // up included, are this person's average this week), and 2 sets of each group take each group's
  // own time a set (a squat takes longer than a curl). Simpler sessions hold a set number of
  // exercises, one a group (balance and floor practice count among them), so a week of them may
  // not have room for every group either.
  const full = built.every((s) => B.estimate(S, s) >= 0.85 * budgetOf(S, s, {}));
  const cond = prog.finisherPerWeek >= 7;
  const setTimes = built.map((s) => budgetOf(S, s, {}) - B.estimate(S, Object.assign({}, s, {
    items: s.items.filter((it) => it.skill), finisher: cond ? s.finisher : null,
    mobility: s.keepMobility ? (s.mobility || []).filter((m) => !m.cardio) : [],
  })));
  const setTime = setTimes.reduce((a, t) => a + t, 0);
  const setsIn = built.reduce((a, s) => a + s.items.filter((it) => !it.skill).reduce((n, it) => n + it.sets, 0), 0);
  const setsMin = built.reduce((a, s) => a + B.estimate(S, s) - B.estimate(S, Object.assign({}, s, { items: s.items.filter((it) => it.skill) })), 0);
  const perSet = setsIn ? setsMin / setsIn : 2;
  const wholeSets = setTimes.reduce((a, t) => a + Math.max(0, Math.floor(t / perSet + 1e-9)), 0);
  const gTime = {}, gSets = {};
  for (const s of built) {
    const all = B.estimate(S, s);
    for (const it of s.items) {
      if (it.skill || !GROUPS.includes(it.group)) continue;
      gTime[it.group] = (gTime[it.group] || 0) + all - B.estimate(S, Object.assign({}, s, { items: s.items.filter((x) => x !== it) }));
      gSets[it.group] = (gSets[it.group] || 0) + it.sets;
    }
  }
  const need2 = GROUPS.filter((g) => can.has(g)).reduce((a, g) => a + 2 * (gSets[g] ? gTime[g] / gSets[g] : perSet), 0);
  const holds = wholeSets * perSet;
  const maxItems = S.complexity > 0 ? (S.complexity === 1 ? 5 : 4) : 0;
  const slots = maxItems ? built.reduce((a, s) => a + Math.max(0, maxItems - s.items.filter((it) => it.skill).length), 0) : Infinity;
  const nCan = GROUPS.filter((g) => can.has(g)).length;
  const turns = holds < need2 - 1e-9 || slots < nCan;
  for (const g of below) {
    if (turns && o.pairWith) continue;
    if (!full) { bad('every group reaches its weekly floor while there is time left', `${label}: ${g} ${eff[g]} < ${Math.max(2, Math.round(prog.floor[g] * mult))} (${built.map((s) => `${B.estimate(S, s).toFixed(0)}/${budgetOf(S, s, {})}`).join(' ')})`); break; }
    if (eff[g] < 2 && !turns) { bad('every group gets at least 2 sets a week', `${label}: ${g} ${eff[g]} (${setTime.toFixed(0)} min for sets, ${wholeSets} whole sets${Number.isFinite(slots) ? `, ${slots} exercises` : ''})`); break; }
  }
  return { eff, can, setTime, perSet, wholeSets, holds, need2, slots, turns, built };
}

// Done workouts (one a week, on Sunday) so later weeks count as training weeks.
// A week's sessions logged as done, every set as planned (as finishing each workout would).
function logWeek(S, built) {
  for (const s of built) {
    const items = s.items.concat(s.extras || []).map((it) => ({ fam: it.fam, moveId: it.moveId, kind: it.kind, target: it.target, group: it.group,
      sets: Array.from({ length: it.sets || 1 }, (_, i) => ({ set: i + 1, amount: it.target, target: it.target })) }));
    const n = items.reduce((a, it) => a + it.sets.length, 0);
    S.log.push({ type: 'workout', day: s.day, tpl: s.tpl, title: s.title, items, checkedIn: true, pct: 1, planned: n, doneSets: n });
  }
}

function trained(S, weeksDone) {
  for (let w = 0; w < weeksDone; w++) S.log.push({ type: 'workout', day: D0 + w * 7 + 6, tpl: 0, title: 'Workout', items: [], checkedIn: true, pct: 1, planned: 1, doneSets: 1 });
}

function runProfile(spec, n, extra) {
  let S;
  const label = `#${n}`;
  try { S = person(spec, n); } catch (e) { bad('no crash', `${label} newState: ${e.message}`); return; }
  const clean = JSON.stringify(S);
  if (DUMP) dumped[n] = JSON.parse(clean);
  try {
    // Week 1: the on-ramp for most people.
    const w1 = checkWeek(S, D0, `${label} w1`, { phase: 'onramp' });
    // Week 3: a full week.
    trained(S, 2);
    const w3 = checkWeek(S, D0 + 14, `${label} w3`, { phase: 'full', pairWith: true });
    if (w3 && w3.turns) {
      // Too little time for 2 sets of each group a week: groups may take turns, so weeks 3 and 4
      // together train them all (week 3 done as planned first).
      const S4 = JSON.parse(JSON.stringify(S));
      logWeek(S4, w3.built);
      const w4 = checkWeek(S4, D0 + 21, `${label} w4`, { phase: 'full', pairWith: true });
      // Every group, when the two weeks' sessions hold 2 whole sets of each (and an exercise for
      // each); with less than that, as many groups as they hold, less one (the most important
      // groups keep their 2 sets every week, so they take more than their share).
      if (w4) {
        const groups = GROUPS.filter((g) => w3.can.has(g));
        const missed = groups.filter((g) => w3.eff[g] + w4.eff[g] < 2);
        const sets = w3.wholeSets + w4.wholeSets;
        const slots = w3.slots + w4.slots;
        const need = w3.holds + w4.holds >= w3.need2 - 1e-9 && slots >= groups.length ? groups.length : Math.max(0, Math.min(Math.floor(sets / 2), slots) - 1);
        if (groups.length - missed.length < need) for (const g of missed) bad('with too little time for 2 sets of each group a week, every group is trained over two weeks', `${label}: ${g} (${w3.setTime.toFixed(0)} + ${w4.setTime.toFixed(0)} min for sets, ${sets} whole sets${Number.isFinite(slots) ? ` and ${slots} exercises` : ''} for ${groups.length} groups, ${groups.length - missed.length} trained)`);
      }
    }
    if (w1 && w3) { /* both built */ }
    // Deterministic: the same answers build the same session.
    const cal = B.calendar(S, D0 + 14);
    const first = (cal.weeks[D0 + 14].sessions.find((x) => !x.dropped && x.day != null) || {});
    if (first.day != null) {
      const a = JSON.parse(clean), b2 = JSON.parse(clean);
      trained(a, 2); trained(b2, 2);
      const sa = JSON.stringify(B.buildSession(a, first.day, first.tpl, {}));
      const sb = JSON.stringify(B.buildSession(b2, first.day, first.tpl, {}));
      if (sa !== sb) bad('the same answers build the same session', label);
    }
    if (extra && first.day != null) {
      // A bad night's sleep, short on time, and (after two more weeks) a deload week.
      S.sleepChip[first.day] = '<5';
      const tired = build(S, first.day, first.tpl, {});
      checkSession(S, tired, `${label} bad sleep`, { phase: 'tired' });
      delete S.sleepChip[first.day];
      const short = build(S, first.day, first.tpl, { short: true });
      checkSession(S, short, `${label} short`, { short: true, phase: 'short' });
      // Weeks 3 and 4 trained too: week 5 is the scheduled deload.
      for (let w = 2; w < 4; w++) S.log.push({ type: 'workout', day: D0 + w * 7 + 6, tpl: 0, title: 'Workout', items: [], checkedIn: true, pct: 1, planned: 1, doneSets: 1 });
      const ph = B.calendar(S, D0 + 28).weeks[D0 + 28].phase;
      if (!ph.deload) bad('a deload comes after four training weeks', label);
      checkWeek(S, D0 + 28, `${label} w5`, { phase: 'deload' });
    }
  } catch (e) {
    bad('no crash', `${label}: ${e.stack.split('\n').slice(0, 4).join(' ')}`);
  }
}

// Twelve weeks of every workout done as planned: the same rules every week as the plan moves on.
function simulate(spec, n) {
  const S = person(spec, n);
  const label = `#${n} sim`;
  try {
    for (let d = D0; d < D0 + 84; d++) {
      const plan = B.todayPlan(S, d);
      if (plan.type === 'workout') {
        const r = B.startWorkout(S, d, { now: d * B.DAY_MS + 17 * 3600000 });
        if (r.error) { bad('no crash', `${label} ${B.dayStr(d)}: ${r.error}`); continue; }
        checkSession(S, r.session, `${label} ${B.dayStr(d)}`, { phase: 'sim' });
        let g = 0;
        while (S.active && S.active.idx < S.active.steps.length && g++ < 1000) {
          const st = S.active.steps[S.active.idx];
          B.completeStep(S, st.kind === 'test' ? { value: 12 } : {});
          if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 3 === 0 ? '3' : '12');
        }
        B.finishWorkout(S, { rating: (d % 9) === 0 ? 'easy' : 'right', now: d * B.DAY_MS + 18 * 3600000 });
      } else if (plan.type === 'light') { B.logLight(S, d, 'walk', true); B.logLight(S, d, 'mobility', true); }
    }
  } catch (e) { bad('no crash', `${label}: ${e.stack.split('\n').slice(0, 4).join(' ')}`); }
}

/* ------------------------------------------------------------------ the profiles */
const rand = rng(SEED);
const t = FULL ? 3 : 2;
const tCA = Date.now();
// Pairwise, with every pair of answers in at least two people (about 380 rows); 3-wise with --full.
const rows = covering(LEVELS, t, rand, FULL ? 2 : 12, FULL ? 1 : 2);
const caMs = Date.now() - tCA;
const specs = rows.map(specOf);
// Edge profiles: the extremes of time, kit and body, alone and together.
const BASE = specOf(FACTORS.map(() => 0));
const edge = (o) => Object.assign({}, BASE, { goals: ['abs', 'arms'], experience: 'onoff', days: 3, weekdays: 'none', minutes: 30, kit: 'house', gym: 'full', dbMax: 'some', age: 25, floorOk: true, lead: 'none', supersets: true, rest: 'auto' }, o);
const EDGES = [
  edge({ minutes: 10, days: 2 }), edge({ minutes: 10, days: 6 }), edge({ minutes: 60, days: 2 }), edge({ minutes: 60, days: 6 }),
  edge({ minutes: 10, days: 2, kit: 'nothing', floorOk: false }), edge({ minutes: 60, days: 6, kit: 'everything', experience: '3plus', goals: ['strength'] }),
  edge({ kit: 'nothing' }), edge({ kit: 'nothing', floorOk: false }), edge({ kit: 'chairOnly', floorOk: false }), edge({ kit: 'nothing', conditions: CONDS[CONDS.length - 1] }),
  edge({ kit: 'nothing', conditions: ['seated'] }), edge({ kit: 'chairOnly', conditions: ['seated'], minutes: 10 }), edge({ conditions: CONDS[CONDS.length - 1], age: 95, minutes: 60, days: 6 }),
  edge({ conditions: CONDS[CONDS.length - 1], age: 95, minutes: 10, days: 2, kit: 'nothing' }), edge({ age: 13, goals: ['strength', 'legs'], kit: 'nothing' }), edge({ age: 95, kit: 'everything' }),
  edge({ weekdays: 'duplicate', days: 6 }), edge({ weekdays: 'duplicate', days: 2 }), edge({ weekdays: 'adjacent', days: 6, minutes: 45 }), edge({ weekdays: 'adjacent', days: 5, minutes: 15 }),
  edge({ where: 'gym', gym: 'cardio', dbMax: 'none', kit: 'nothing' }), edge({ where: 'gym', gym: 'full', dbMax: 'most', minutes: 60, days: 6 }), edge({ where: 'gym', gym: 'small', minutes: 10 }), edge({ where: 'both', gym: 'basic', kit: 'band' }),
  edge({ pain: ['knee', 'hip', 'ankle'], careful: ['knee', 'shoulder'] }), edge({ pain: ['shoulder'], careful: ['wrist'], kit: 'nothing' }), edge({ pain: ['wrist'], conditions: ['hands'] }), edge({ pain: ['back'], conditions: ['back'] }),
  edge({ complexity: 2, minutes: 60, days: 3 }), edge({ complexity: 2, minutes: 10, days: 6 }), edge({ complexity: 1, kit: 'everything', minutes: 45 }), edge({ supersets: false, rest: 90, minutes: 60 }),
  edge({ supersets: false, rest: 60, minutes: 10 }), edge({ rest: 90, minutes: 15, days: 2 }), edge({ goals: ['fat', 'consistency'], minutes: 60, days: 5 }), edge({ goals: ['endurance'], minutes: 10, days: 3 }),
  edge({ goals: GOALS[12], focus: ['sideDelts', 'lats', 'quads', 'hamstrings'], minutes: 60, days: 6 }), edge({ goals: GOALS[12], minutes: 10, days: 2 }), edge({ goals: ['mobility', 'back'], age: 75, minutes: 20 }), edge({ gentle: true, experience: 'never', minutes: 60 }),
  edge({ lead: 'both', minutes: 15, days: 2 }), edge({ lead: 'both', minutes: 60, days: 6, kit: 'everything' }), edge({ impact: 'jumps', age: 55, goals: ['fat'] }), edge({ impact: 'off', goals: ['endurance', 'fat'], kit: 'ball' }),
  edge({ units: 'kg', kit: 'dbFull', where: 'both', gym: 'basic', dbMax: 'most' }), edge({ conditions: ['seated'], kit: 'band', minutes: 45, days: 4 }), edge({ conditions: ['hands'], kit: 'everything', minutes: 30 }), edge({ conditions: ['heart', 'bp'].slice(0, 1), age: 85, minutes: 25 }),
  edge({ conditions: ['balance', 'osteo'].slice(0, 1), floorOk: false, kit: 'nothing', age: 75 }), edge({ days: 6, minutes: 60, kit: 'bar', goals: ['back', 'shoulders', 'legs'] }),
];
const RANDOM = 2000;
const randRows = Array.from({ length: RANDOM }, () => LEVELS.map((l) => Math.floor(rand() * l)));
const all = specs.concat(EDGES, randRows.map(specOf));

/* ------------------------------------------------------------------ run */
section(`${all.length} profiles: ${specs.length} from a ${t}-wise covering array (${caMs} ms), ${EDGES.length} edge, ${RANDOM} random`);
const EXTRA_EVERY = Math.max(1, Math.floor(all.length / 500));
all.forEach((spec, i) => {
  if (ONLY.length && !ONLY.includes(i)) return;
  if (TRACE) console.log(`#${i} ${JSON.stringify(spec)}`);
  runProfile(spec, i, i % EXTRA_EVERY === 0);
});
if (FULL) {
  section('Twelve-week simulations');
  const every = Math.max(1, Math.floor(specs.length / 400));
  let n = 0;
  specs.forEach((spec, i) => { if (i % every === 0) { simulate(spec, i); n++; } });
  console.log(`  ${n} people, 12 weeks each`);
}

// Malformed weekdays and custom plans never crash the plan.
section('Malformed input');
const odd = [
  ['weekdays: strings, duplicates, out of range', { weekdays: ['1', 'x', 9, -1, 2.5, 2, 2, 4] }],
  ['weekdays: seven days', { weekdays: [0, 1, 2, 3, 4, 5, 6], days: 6 }],
  ['weekdays: one day', { weekdays: [3], days: 4 }],
  ['weekdays: not a list', { weekdays: '0,2,4' }],
  ['days out of range', { days: 12, weekdays: null }],
  ['days missing', { days: undefined }],
  ['minutes out of range', { minutes: 400 }],
  ['minutes missing', { minutes: null }],
];
let crashed = 0;
for (const [name, patch] of odd) {
  try {
    const S = B.newState(Object.assign({ goals: ['abs'], equipment: HOUSE }, patch), null, D0);
    const cal = B.calendar(S, D0 + 6);
    for (const x of cal.weeks[D0].sessions) if (!x.dropped && x.day != null) checkSession(S, build(S, x.day, x.tpl, { cal }), name, { malformed: true });
    const days = cal.weeks[D0].sessions.filter((x) => !x.dropped).map((x) => x.day);
    if (new Set(days).size !== days.length) bad('never two workouts on one day', `${name}: ${days}`);
  } catch (e) { crashed++; bad('no crash', `${name}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); }
}
const plans = [
  ['a move named constructor', { name: 'x', days: [{ items: [{ move: 'constructor', sets: 3, reps: 10 }, { move: '__proto__', sets: 2 }, { move: 'push_std', sets: 3, reps: 8 }] }] }],
  ['a day of unknown moves only', { name: 'y', days: [{ items: [{ move: 'toString', sets: 3 }] }, { items: [{ move: 'sq_bw', sets: 3, reps: 12 }] }] }],
  ['huge numbers', { name: 'z', days: [{ items: [{ move: 'push_std', sets: 1e9, reps: -5 }] }] }],
];
for (const [name, raw] of plans) {
  try {
    const S = B.newState({ goals: ['abs'], equipment: HOUSE }, null, D0);
    // As a shared plan's link is read: normalized, saved and put in use.
    const { plan } = CP.add(S, raw);
    if (plan && plan.days.length && plan.days.every((d) => d.items.length)) CP.use(S, plan.id, D0);
    const cal = B.calendar(S, D0 + 6);
    for (const x of cal.weeks[D0].sessions) if (!x.dropped && x.day != null) B.buildSession(S, x.day, x.tpl, { cal });
    B.todayPlan(S, D0, cal);
  } catch (e) { crashed++; bad('no crash', `custom plan, ${name}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); }
}
console.log(`  ${odd.length + plans.length} malformed inputs, ${crashed} crashed`);

/* ------------------------------------------------------------------ report */
section('How full sessions are (estimate against the time set)');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const big = fills.filter((f) => f.budget >= 20 && !f.short);
const BUCKETS = [[0, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 1.0001], [1.0001, Infinity]];
const hist = BUCKETS.map(([lo, hi]) => big.filter((f) => f.ratio >= lo && f.ratio < hi).length);
console.log(`  budgets of 20 min or more (${big.length} sessions):`);
BUCKETS.forEach(([lo, hi], i) => console.log(`    ${hi === Infinity ? '  over' : `${lo.toFixed(2)}-${Math.min(hi, 1).toFixed(2)}`} ${String(hist[i]).padStart(6)} ${'#'.repeat(Math.round((60 * hist[i]) / Math.max(1, big.length)))}`));
const byBudget = {};
for (const f of fills.filter((x) => !x.short)) (byBudget[f.budget] = byBudget[f.budget] || []).push(f.ratio);
console.log('  by minutes: median fill, share ≥ 0.8, share ≥ 0.92');
for (const b of Object.keys(byBudget).map(Number).sort((x, y) => x - y)) {
  const r = byBudget[b];
  console.log(`    ${String(b).padStart(3)} min  ${q(r, 0.5).toFixed(2)}  ${pct(r.filter((x) => x >= 0.8).length, r.length).padStart(6)}  ${pct(r.filter((x) => x >= 0.92).length, r.length).padStart(6)}  (${r.length})`);
}
const byPhase = {};
for (const f of big) (byPhase[f.phase] = byPhase[f.phase] || []).push(f.ratio);
console.log(`  by week: ${Object.entries(byPhase).map(([k, r]) => `${k} ${q(r, 0.5).toFixed(2)} (≥0.8 ${pct(r.filter((x) => x >= 0.8).length, r.length)})`).join(', ')}`);
const reach = big.filter((f) => f.ratio >= 0.8).length / Math.max(1, big.length);
const low = big.filter((f) => f.ratio < 0.8);
if (low.length) console.log(`  under 0.8, a sample: ${low.filter((f, i) => i % Math.max(1, Math.floor(low.length / 8)) === 0).slice(0, 8).map((f) => `${f.label.split(' ')[0]} ${f.phase} ${f.budget} min ${f.ratio.toFixed(2)}`).join('; ')}`);
console.log(`  over the time by more than 30 s: ${sessionsSeen.over} of ${sessionsSeen.n} sessions (worst ${sessionsSeen.maxOver.toFixed(1)} min over)`);
console.log(`  weeks with a trainable group at 0 direct sets: ${weeks.zero} of ${weeks.n} (${pct(weeks.zero, weeks.n)}); at 0 counting indirect: ${weeks.zeroEff}; below its floor: ${weeks.belowFloor}`);
console.log(`  sessions with a move twice: ${sessionsSeen.dup}; with no work: ${sessionsSeen.empty}; under 2 main exercises: ${sessionsSeen.mainShort}`);
const p95 = q(times, 0.95), p50 = q(times, 0.5), wp95 = q(planTimes, 0.95);
console.log(`  buildSession (its week planned): ${times.length} builds, median ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${Math.max(...times).toFixed(1)} ms`);
console.log(`  week plans for a new state: ${planTimes.length}, median ${q(planTimes, 0.5).toFixed(2)} ms, p95 ${wp95.toFixed(2)} ms, max ${Math.max(0, ...planTimes).toFixed(1)} ms`);
const OS = GH.optimizer && GH.optimizer.stats;
if (OS) console.log(`  week plans: ${OS.weeks}, mean ${(OS.weekMs / Math.max(1, OS.weeks)).toFixed(2)} ms; splits searched: ${OS.splits}, mean ${(OS.splitMs / Math.max(1, OS.splits)).toFixed(2)} ms`);

section('Invariants');
const NAMED = [
  'no crash', 'every session has work (or is turned into a light day)', 'at least 2 main exercises from 15 min (1 at 10 min)', 'no session runs over its time by more than 30 s',
  'every group reaches its weekly floor while there is time left', 'every group gets at least 2 sets a week', 'with too little time for 2 sets of each group a week, every group is trained over two weeks',
  'no move twice in a session', 'never two workouts on one day', 'at most 6 sets an exercise', 'at most 10 sets a muscle group a session', 'weekly sets stay under each group\'s cap',
  'merged exercises keep at most 5 sets', 'priority order', 'no supersets when they\'re off', 'supersets pair two exercises that don\'t clash', 'superset partners side by side',
  'left vs right tests only when allowed', 'a strength goal works home compounds in 5 to 10 reps', 'the same answers build the same session', 'a deload comes after four training weeks', 'every week has a plan',
];
const allowedNames = Object.keys(viol).filter((k) => k.startsWith('only allowed moves'));
for (const name of NAMED.concat(allowedNames.length ? allowedNames : ['only allowed moves'])) {
  const v = viol[name];
  check(`${name}${v ? ` (${v.n})` : ''}`, !v, v && v.ex);
}
for (const name of Object.keys(viol)) if (!NAMED.includes(name) && !allowedNames.includes(name)) check(`${name} (${viol[name].n})`, false, viol[name].ex);
check(`at least 90% of sessions with 20 min or more reach 0.8 of their time (${(reach * 100).toFixed(1)}%)`, reach >= 0.9);
check(`buildSession p95 is 3 ms or less (${p95.toFixed(2)} ms)`, p95 <= 3);
check(`a new week's plan p95 is 50 ms or less (${wp95.toFixed(2)} ms)`, wp95 <= 50);
console.log(`\n  ran in ${((Date.now() - T0) / 1000).toFixed(1)} s`);
if (DUMP) writeFileSync(DUMP, JSON.stringify(dumped));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ profiles: all.length, rows: specs.length, sessions: sessionsSeen, weeks, hist, buckets: BUCKETS, byBudget: Object.fromEntries(Object.entries(byBudget).map(([b, r]) => [b, { n: r.length, median: q(r, 0.5), ge08: r.filter((x) => x >= 0.8).length / r.length, ge092: r.filter((x) => x >= 0.92).length / r.length }])), reach, p50, p95, wp95, viol }, null, 1));
done();
