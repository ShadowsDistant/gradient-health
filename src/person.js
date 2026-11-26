/* Who this is, for a model (GH.person): one compact statement of what the app knows about the person
 * and what they actually do, the same for every model job (Build me a plan, Check my plan, the chat
 * and the weekly report). More detail about the person is the one input with repeated measured
 * benefit for plans a model writes (research_notes: ai_made_plans, section 2).
 *
 * facts(S, day, o) gives the list, each { id, label, value }: a label and a value in plain words
 * that read the same to a model ("- Equipment: dumbbells 10 lb") and on the sheet that shows people
 * what the coach uses (shown), so the two can't drift apart. Only facts with data behind them.
 *
 * o.to says who reads it. 'device' (the on-device model, and the app's own list) gets everything.
 * 'claude' never gets the exact age, the height, health conditions, floor work or a gentle start,
 * and gets the facts added in 1.15 (how they eat, their build, what their weights mean, what they
 * do and choose) only with o.wide: the person's OK to the list as it is now (GH.ai.wide).
 * o.have: the parts of Claude's summary that go with it (src/ai.js PARTS), whose lines aren't
 * repeated. o.ids: only these facts, and o.short: said briefly (the short form for a small model).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;

  const GOAL = { abs: 'visible abs', arms: 'bigger arms', chest: 'bigger chest', legs: 'legs and glutes', back: 'back and posture', fat: 'lose fat', strength: 'overall strength', endurance: 'endurance', mobility: 'mobility', consistency: 'consistency' };
  const EXP = { never: 'never trained', onoff: 'on and off', lt1: 'under 1 year', '1to3': '1-3 years', '3plus': '3+ years' };
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const lower = (s) => String(s || '').replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase()).replace(/\.$/, '');
  const moveName = (id) => { const m = M().MOVES[id]; return m ? m.name.toLowerCase() : null; };

  function ageRange(age) {
    if (!(age > 0)) return null;
    const bands = [[13, 17], [18, 24], [25, 34], [35, 44], [45, 54], [55, 64]];
    for (const [a, b] of bands) if (age >= a && age <= b) return `${a}-${b}`;
    return age >= 65 ? '65+' : 'under 13';
  }
  const minor = (p) => p.age > 0 && p.age < 18;
  // Lean, mid or higher, from height and weight (body mass index under 21, to 27, above). Only
  // lean changes what a model is told: no talk of losing weight, and abs and arms are about
  // building muscle (research_notes: low_protein_diet, section 8). null when either is missing.
  function build(S, day) {
    const p = S.profile;
    const h = Number(p.heightCm) / 100, kg = Number((day != null && B().weightStats(S, day).current) || p.weightKg);
    if (!(h > 1) || !(kg > 25)) return null;
    const bmi = kg / (h * h);
    return bmi < 21 ? 'lean' : bmi < 27 ? 'mid' : 'higher';
  }
  // How they say they eat (profile.eats, set-up's optional answer): { protein, produce }, each
  // 'low', 'some' or 'most', or null when it wasn't answered.
  const LEVELS = ['low', 'some', 'most'];
  function eats(p) {
    const e = p && p.eats && typeof p.eats === 'object' ? p.eats : {};
    const v = (x) => (LEVELS.includes(x) ? x : null);
    return { protein: v(e.protein), produce: v(e.produce) };
  }
  const EAT_WORD = { low: 'not much', some: 'some', most: 'plenty of' };

  // Weight loss is off the table for someone under 18 or lean (research_notes: ai_made_plans 6,
  // low_protein_diet 8): the app holds a model's words to that either way (strict, for
  // GH.coach.keepSafe), and tells the model so (guard: a line for its rules; Claude only learns
  // they're lean with the newer OK).
  const strict = (S, day) => minor(S.profile) || build(S, day) === 'lean';
  function guard(S, day, o) {
    const claude = o && o.to === 'claude';
    const why = minor(S.profile) ? 'they are under 18' : (!claude || (o && o.wide)) && build(S, day) === 'lean' ? 'they are lean for their height' : '';
    return why ? `Say nothing about losing weight, cutting or eating less: ${why}.` : '';
  }

  /* ---------------------------------------------------------------- what their weights mean */
  // A first working weight for a ladder, as a share of body weight (the moves' own `ratio`, per
  // dumbbell; the ladders without one take a neighbour's).
  const RATIO = { curl: 0.08, triceps: 0.06, row: 0.12, chestDb: 0.12, press: 0.1, squat: 0.2, hinge: 0.2, glute: 0.2, raise: 0.06, rear: 0.05, calf: 0.2, absLoad: 0.1 };
  const FAM_WORD = { curl: 'curls', triceps: 'triceps extensions', row: 'rows', chestDb: 'chest presses', press: 'overhead presses', squat: 'squats', hinge: 'deadlifts', glute: 'hip thrusts', raise: 'lateral raises', rear: 'rear raises', calf: 'calf raises', absLoad: 'weighted crunches' };
  // Whether the heaviest weight they have is 'light', 'right' or 'heavy' for them on a ladder (null
  // when it can't be told: no weights, no body weight, a ladder done without them). The app's own
  // simple judgement until the plan engine has one: the weight against body weight times the
  // ladder's ratio. Under 0.9 of that is light (far: under 0.7, where the body-weight version is
  // the harder one), over 1.8 heavy.
  function loadFeel(S, fam) {
    const p = S.profile, eq = p.equipment || {};
    const bw = Number(p.weightKg);
    const lad = M().LADDERS[fam];
    if (!(bw > 0) || !RATIO[fam] || !lad) return null;
    const kinds = new Set();
    for (const id of lad.rungs) for (const k of String((M().MOVES[id] || {}).load || '').split('|')) if ((k === 'db' || k === 'kb') && (eq[k] || []).length) kinds.add(k);
    if (!kinds.size) return null;
    const top = Math.max(...[...kinds].map((k) => Math.max(...eq[k])));
    const r = (p.units === 'kg' ? top : top / B().LB_PER_KG) / (bw * RATIO[fam]);
    return { feel: r < 0.9 ? 'light' : r <= 1.8 ? 'right' : 'heavy', far: r < 0.7, top };
  }
  // All of it in a line: "10 lb is light for curls, rows and squats; about right for lateral raises".
  // (short: only where it's light or heavy, three of each, for a small model's brief.)
  function loadLine(S, short) {
    const by = { light: [], right: [], heavy: [] };
    let top = 0;
    for (const fam of Object.keys(RATIO)) {
      const f = loadFeel(S, fam);
      if (!f) continue;
      top = Math.max(top, f.top);
      if (!by[f.feel].includes(FAM_WORD[fam])) by[f.feel].push(FAM_WORD[fam]);
    }
    const bits = [['light', 'light for'], ['right', 'about right for'], ['heavy', 'heavy for']].filter(([k]) => by[k].length && !(short && k === 'right')).map(([k, w]) => `${w} ${list(by[k].slice(0, short ? 3 : 5))}`);
    return bits.length ? `${top} ${S.profile.units || 'lb'} is ${bits.join('; ')}` : '';
  }

  /* ---------------------------------------------------------------- what they do */
  // The last four weeks, from the calendar and the workout logs: { span (weeks counted), planned,
  // done, perWeek, mins (how long a full session really takes), cut (stopped early or done in the
  // short mode), n (sessions), felt, left (the reps-left answers against each exercise's aim: zero,
  // on, over), up and stuck (ladders moving up, and not, by name) }.
  function lately(S, day) {
    const b = B(), p = S.profile;
    const logs = (S.log || []).filter((l) => l.type === 'workout' && l.checkedIn && l.day > day - 28 && l.day <= day);
    const from = Math.max(day - 28, p.startDay || 0);
    const cal = b.calendar(S, day);
    let planned = 0, done = 0;
    for (let d = from; d < day; d++) { const i = cal.days[d]; if (i && (i.planned === 'workout' || i.missed)) { planned++; if (i.done) done++; } }
    const span = (day - from) / 7;
    const full = logs.filter((l) => l.startedAt && l.endedAt && !l.short && (l.pct || 0) >= 0.8).map((l) => (l.endedAt - l.startedAt) / 60000).filter((m) => m >= 3 && m <= 180);
    const felt = { easy: 0, right: 0, hard: 0 };
    for (const l of logs) if (l.checkin && felt[l.checkin.rating] != null) felt[l.checkin.rating]++;
    // (As Claude's summary reads them: an answer with no aim, from before 1.13, isn't counted.)
    const left = { zero: 0, on: 0, over: 0 };
    for (const l of logs) for (const it of l.items || []) if (['0', '12', '3', '4'].includes(it.rir) && b.aimWords && b.aimWords(it.aim)) left[it.rir === '0' ? 'zero' : b.effortStep(it).pace >= 2 ? 'over' : 'on']++;
    // A ladder is moving up when one of its last three sessions moved it on; stuck when it has had
    // three or more and none did.
    const runs = {};
    for (const l of logs) for (const it of l.items || []) { const fam = it.fam || (M().MOVES[it.moveId] || {}).family; if (fam && it.outcome && M().LADDERS[fam]) (runs[fam] = runs[fam] || []).push(it.outcome); }
    const name = (fam) => M().LADDERS[fam].name.toLowerCase();
    const up = [], stuck = [];
    for (const [fam, r] of Object.entries(runs)) { if (r.slice(-3).includes('up')) up.push(name(fam)); else if (r.length >= 3) stuck.push(name(fam)); }
    return {
      span, planned, done, perWeek: span >= 1 ? Math.round((done / span) * 2) / 2 : null,
      mins: full.length >= 2 ? Math.round(full.reduce((a, x) => a + x, 0) / full.length) : null,
      cut: logs.filter((l) => l.short || (l.pct || 0) < 0.8).length, n: logs.length, felt, left, up: up.slice(0, 4), stuck: stuck.slice(0, 4),
    };
  }
  // What they've told the app they like or don't, each in a few words: moves they picked
  // themselves mid-workout, hid or pinned, what they asked Tailor for, and the coach's ideas they
  // took or turned down. (claude: without Tailor's gentler plan, which stays on the phone.)
  const TURNED = { min: 'a different workout length', wd: 'moving a workout day', deload: 'a lighter week', vol: 'more sets' };
  function choices(S, day, claude) {
    const out = [];
    const names = (ids) => [...new Set(ids.map(moveName).filter(Boolean))].slice(0, 3);
    const picks = {};
    for (const l of S.log || []) if (l.type === 'workout' && l.day > day - 56) for (const it of l.items || []) if (it.swapped && moveName(it.moveId)) picks[it.moveId] = (picks[it.moveId] || 0) + 1;
    const top = Object.keys(picks).sort((x, y) => picks[y] - picks[x]).filter((id) => picks[id] >= 2);
    if (top.length) out.push(`picked ${list(names(top))} themselves in a workout`);
    if ((S.excluded || []).length) out.push(`hid ${list(names(S.excluded))}`);
    const pins = names(Object.values((B().tweaksOf ? B().tweaksOf(S) : {}).swaps || {}));
    if (pins.length) out.push(`pinned ${list(pins)}`);
    const ev = (type) => (S.events || []).filter((e) => e && e.type === type && !e.undone && e.day > day - 84);
    const asked = [].concat(...ev('tailor').slice(-2).map((e) => e.lines || [])).filter((x) => !(claude && /gentl|full plan/i.test(x))).slice(-3).map(lower);
    if (asked.length) out.push(`asked for: ${asked.join(', ')}`);
    const took = [].concat(...ev('review').slice(-2).map((e) => e.lines || [])).slice(-3).map(lower);
    if (took.length) out.push(`took the coach's ideas: ${took.join(', ')}`);
    const no = [].concat(...ev('review').slice(-2).map((e) => e.declined || [])).map(lower)
      .concat(Object.keys(S.coachDismissed || {}).filter((id) => S.coachDismissed[id] > day - 28).map((id) => TURNED[id.split('-')[0]]).filter(Boolean));
    if (no.length) out.push(`turned down: ${[...new Set(no)].slice(0, 3).join(', ')}`);
    return out;
  }

  /* ---------------------------------------------------------------- the list */
  function facts(S, day, o) {
    const opt = o || {};
    const b = B(), h = GH.health, A = GH.access, p = S.profile;
    const claude = opt.to === 'claude';
    const wide = !claude || !!opt.wide;
    const have = (k) => (opt.have || []).includes(k);
    const out = [];
    // (tag: the label on the sheet, where it isn't the model's; only: who may read it.)
    const add = (id, label, value, x) => { if (value && (!opt.ids || opt.ids.includes(id))) out.push(Object.assign({ id, label, value: String(value) }, x)); };
    const lb = p.units !== 'kg';
    const sex = p.sex ? `; sex: ${p.sex}` : '';
    if (claude) add('body', 'Age range', `${ageRange(p.age) || 'not given'}${sex}`);
    else {
      const kg = Number(p.weightKg) > 0 ? (lb ? `${Math.round(p.weightKg * b.LB_PER_KG)} lb` : `${Math.round(p.weightKg)} kg`) : '';
      add('body', 'Age', `${p.age > 0 ? p.age : 'not given'}${sex}${p.heightCm > 0 ? `; ${Math.round(p.heightCm)} cm` : ''}${kg ? `; ${kg}` : ''}`, { only: 'device' });
    }
    if (wide && build(S, day) === 'lean') add('build', 'Build', 'lean, from height and weight');
    add('goal', 'Goals, most important first', (p.goals || []).map((g) => GOAL[g] || g).join(', ') || 'not set', { tag: 'Goals' });
    const focus = b.focusOf(p).map((m) => String((GH.body && GH.body.NAME && GH.body.NAME[m]) || m).toLowerCase());
    if (wide && focus.length) add('focus', 'Muscles to lean toward', focus.join(', '));
    const weeks = p.startDay != null ? Math.floor((day - p.startDay) / 7) : 0;
    add('level', 'Training history', `${EXP[p.experience] || p.experience || 'not given'}${wide && weeks >= 1 ? `; ${weeks} ${weeks === 1 ? 'week' : 'weeks'} with the app` : ''}`);
    const where = p.where === 'gym' ? 'at a gym' : p.where === 'both' ? 'at home and at a gym' : 'at home';
    add('time', 'Schedule', `${p.days} days a week, about ${p.minutes} min${wide && p.workouts !== false ? `; on ${list(b.weekdaysFor(p).slice().sort((x, y) => x - y).map((d) => WD[d]))}, ${where}` : ''}`);
    const eq = p.equipment || {};
    const kit = [];
    if (eq.db && eq.db.length) kit.push(`dumbbells ${eq.db.join('/')} ${p.units}`);
    if (eq.kb && eq.kb.length) kit.push(`kettlebell ${eq.kb.join('/')} ${p.units}`);
    for (const k of ['ball', 'band', 'bar', 'chair', 'wall', 'towel', 'table']) if (eq[k]) kit.push(k === 'bar' ? 'pull-up bar' : k);
    add('kit', 'Equipment', kit.join(', ') || 'bodyweight only');
    if (wide) add('load', 'Their weights', loadLine(S, opt.short), { tag: 'Your weights' });
    if ((p.careful || []).length) add('joints', 'Careful with', p.careful.join(', '));
    const pain = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    if (pain.length && !have('training')) add('pain', 'Joints on a break', `${pain.join(', ')} (moves that load them are swapped out)`);
    // Nothing about losing weight for someone under 18 or lean (research_notes: ai_made_plans 6).
    const noLoss = minor(p) || (wide && build(S, day) === 'lean');
    const arm = S.catchup && S.catchup.arm.active ? `weaker ${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm gets an extra set` : '';
    add('wgoal', 'Weight goal', [noLoss && p.weightGoal === 'lose' ? '' : p.weightGoal || 'maintain', arm].filter(Boolean).join('; '));
    // Only the on-device model, on the phone, sees these (never Claude).
    if (!claude) {
      const conds = A && A.conditions ? A.conditions(p).map((id) => (A.CONDITIONS.find((c) => c.id === id) || {}).short).filter(Boolean) : [];
      if (conds.length) add('health', 'Health', `the plan is adapted for ${list(conds)}`, { only: 'device' });
      if (Array.isArray(p.oaJoints) && p.oaJoints.length && conds.length) add('oa', 'Joints with arthritis', p.oaJoints.join(', '), { only: 'device' });
      if (p.floorOk === false) add('floor', 'Nothing on the floor', 'standing and seated moves only', { only: 'device' });
      if (p.gentle) add('gentle', 'A gentle plan', 'fewer sets to start', { only: 'device' });
    }
    if (wide) {
      const e = eats(p);
      const said = [e.protein ? `${EAT_WORD[e.protein]} protein` : '', e.produce ? `${EAT_WORD[e.produce]} fruit and veg` : ''].filter(Boolean);
      add('eats', 'Eating, in their own words', said.join(', '), { tag: 'Eating' });
    }
    const goal = p.protein && p.protein.track !== false ? b.proteinGoal(S, day) : null;
    if (goal && wide && !have('food')) {
      let hit = 0, logged = 0;
      for (let d = day - 14; d < day; d++) { const g = b.proteinToday(S, d); if (g) { logged++; if (g >= goal * 0.95) hit++; } }
      if (logged >= 3) add('protein', 'Protein logged', `goal ${goal} g a day, hit on ${hit} of ${logged} logged days (last 2 weeks)`);
    }
    if (p.workouts !== false && (wide || !have('training'))) {
      const L = lately(S, day);
      const bits = [];
      if (L.perWeek != null && L.planned) bits.push(`about ${L.perWeek} ${L.perWeek === 1 ? 'workout' : 'workouts'} a week against ${p.days} planned (${L.done} of ${L.planned} done)`);
      if (L.mins != null) bits.push(`sessions take about ${L.mins} min against ${p.minutes} set`);
      if (L.cut) bits.push(`${L.cut} of ${L.n} cut short`);
      // (The short form says it only when they do less than planned, run long or cut workouts short.)
      const off = (L.perWeek != null && L.planned >= 4 && L.perWeek <= p.days - 1) || (L.mins != null && L.mins > p.minutes + 5) || L.cut > 0;
      if (wide && (!opt.short || off)) add('does', 'Last 4 weeks', bits.join('; '), { tag: 'Lately' });
      if (!have('training') && L.felt.easy + L.felt.right + L.felt.hard) add('felt', 'How workouts felt', `${L.felt.easy} too easy, ${L.felt.right} about right, ${L.felt.hard} too hard`);
      // (Claude's summary has these in its training part, as it did before 1.15.)
      if (!have('training') && L.left.zero + L.left.on + L.left.over >= 3) add('effort', 'Reps left after a set', `${L.left.zero} at failure, ${L.left.on} where the plan aims, ${L.left.over} with more left`, { tag: 'Effort' });
      if (wide) add('up', 'Moving up', L.up.join(', '));
      if (wide) add('stuck', 'Not moving', L.stuck.join(', '));
      if (wide) add('likes', 'Their choices', choices(S, day, claude).slice(0, opt.short ? 2 : 9).join('; '), { tag: 'Your choices' });
    }
    if (h && !have('days') && wide) {
      const now = (k) => h.stats(S, k, day - 6, day), usual = (k) => h.stats(S, k, day - 34, day - 7);
      const pair = (k, fmt, unit) => { const a = now(k), u = usual(k); return a.n ? `${fmt(a.avg)}${unit}${u.n >= 7 ? ` (usually ${fmt(u.avg)}${unit})` : ''}` : ''; };
      const sl = pair('sleepMin', (m) => b.fmtMin(Math.round(m)), ' a night'), rhr = pair('rhr', (x) => String(Math.round(x)), ' bpm');
      add('sleep', 'Sleep and recovery this week', [sl ? `sleep ${sl}` : '', rhr ? `resting heart rate ${rhr}` : ''].filter(Boolean).join('; '), { tag: 'Sleep' });
    }
    return out;
  }
  // How far short of the last rep their sets stop, as the plan engine sets it for a goal muscle
  // (brain.effortFor): { lo, hi } reps left, and why ('age', a condition's id, ...). 2 to 3 from
  // 60, and for a condition that asks for it, never to failure (research_notes: individualized_dose
  // 5); otherwise 1 to 2.
  function effort(S, day) {
    const f = B().effortFor;
    const a = f ? f(S, { group: (B().GROUPS || []).find((g) => B().programFor(S.profile).tiers[g] === 1) || 'chest' }, null, day) : null;
    return a ? { lo: a.lo, hi: a.hi, why: a.why } : { lo: 1, hi: 2, why: 'usual' };
  }
  // (The aims a health condition sets, which Claude isn't told even as an effort.)
  const CONDITION_AIM = ['heart', 'bp', 'eyes'];
  // What the research says a plan should do about some of these facts, as lines for a model's
  // rules: light weights (research_notes: light_loads_bodyweight 2 to 4: up to about 30 reps near
  // the last one, then a harder version, a slower tempo, one side at a time), little protein
  // (low_protein_diet 3: a normal dose with the goal muscles first, not more sets), workouts missed
  // or running long (adherence 2), a beginner (adherence 4 and 7). Only the ones that apply, and for
  // Claude only with the newer OK (they name the facts). Effort follows the engine (effort above).
  function advice(S, day, o) {
    const p = S.profile, out = [];
    if (o && o.to === 'claude' && !o.wide) return out;
    const e = effort(S, day), far = e.lo >= 2;
    const end = far && o && o.to === 'claude' && CONDITION_AIM.includes(e.why) ? 'close to the last one they could do, as the app sets it' : far ? '2 to 3 reps short of the last one they could do, never to failure' : 'within 2 reps of the last one they could do';
    if (Object.keys(RATIO).some((f) => (loadFeel(S, f) || {}).feel === 'light')) out.push(`Their weights are light for them. Light weights build muscle about as well as heavy ones in sets of up to about 30 reps that end ${end}. Past 30, a harder version, then a slower tempo (3 s down, 3 s up), then one side at a time, not more sets.`);
    if (eats(p).protein === 'low') out.push('They eat little protein. Training can\'t make up for food, so don\'t add sets to compensate: keep a normal dose for their level and give their goal muscles priority within it. Strength comes at about the usual pace, size more slowly.');
    if (p.workouts === false) return out;
    const L = lately(S, day);
    if (L.perWeek != null && L.planned >= 4 && L.perWeek <= p.days - 1) out.push(`They do about ${L.perWeek} of the ${p.days} workouts planned each week. Fewer or shorter workouts they keep are worth more than a bigger plan.`);
    if (L.mins != null && L.mins > p.minutes + 5) out.push(`Their sessions run about ${L.mins} minutes against ${p.minutes} set. Trim before adding.`);
    if ((p.experience === 'never' || p.experience === 'onoff') && day - (p.startDay || day) < 84) out.push(`They are new to training: few exercises, the same ones from week to week, and most sets stopped ${far && !(o && o.to === 'claude' && CONDITION_AIM.includes(e.why)) ? '2 to 3' : '1 to 3'} reps short.`);
    return out;
  }
  // The same, as lines for a model.
  const lines = (S, day, o) => facts(S, day, o).map((f) => `- ${f.label}: ${f.value}`);
  // And as the sheet shows it: [label, value, 'device' when it stays on the phone].
  const shown = (S, day, o) => facts(S, day, o).map((f) => [f.tag || f.label, f.value, f.only || null]);

  GH.person = { facts, lines, shown, advice, effort, ageRange, build, eats, strict, guard, loadFeel, loadLine, lately, minor, GOAL, EXP };
})(typeof window !== 'undefined' ? window : globalThis);
