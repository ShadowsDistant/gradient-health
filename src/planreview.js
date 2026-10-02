/* The AI plan review (GH.planReview): the on-device model or Claude looks over the plan the engine
 * picked and suggests a few changes, and the engine checks each one before the person sees it.
 *
 * - What is sent (context): next week's plan as the planner made it (each day's muscle groups and
 *   moves, minutes against the time set), the weekly sets against their targets, the score's six
 *   parts and the planner's reasons, and the moves a swap may name: at most 60, each one this
 *   person can do (their kit, joints and the body's rules). Claude gets it with the usual summary
 *   (goals, experience, schedule, equipment, an age range, careful joints and the readiness trends);
 *   the on-device model gets the same in a short brief, plus what only it may know: health
 *   conditions, the joints arthritis affects, floor work and a gentle start. None of those ever goes
 *   to Claude (privacy.js), and neither does the planner's "Planned around ..." line. An on-device
 *   model with a short memory gets a shorter plan (compact: fewer moves, no reasons).
 * - What comes back: { suggestions: [{ kind, group?, delta?, family?, move?, from?, to?, split?,
 *   rest?, minutes?, focus?, title, why }], note }, at most 3. SPEC lists each kind's fields and
 *   VALUES what each field may hold; together they make Claude's JSON schema and the on-device
 *   model's GBNF grammar, so the two can only write the same shapes.
 * - Checking (validate): each suggestion is normalized, turned into a plan tweak (or a change of the
 *   time, the weekdays or a muscle to lean toward), tried on a copy of the state with the engine's
 *   own test (GH.optimizer.applyTweaks) and kept only when every rule still holds and the score
 *   drops by no more than 0.03. The rest are listed with the reason in plain words. Its words go
 *   through the number check (GH.coach.keepToGiven) against what was sent.
 * - Applying: the ones the person keeps are written together, each checked again with the ones
 *   before it, under one undo (an event of type 'review', which the coach's timeline lists).
 *
 * Claude also gets the plan with the weekly report (forReport, fromReport): its ideas wait on the
 * report and are checked when the person opens them. The sheets are in src/ui/review.js.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;
  const O = () => GH.optimizer;

  const KINDS = ['more_sets', 'fewer_sets', 'swap_move', 'move_day', 'split', 'rest', 'minutes', 'finisher', 'mobility', 'focus', 'tip'];
  const GROUPS = ['biceps', 'triceps', 'abs', 'chest', 'legs', 'back', 'shoulders'];
  const SPLITS = ['auto', 'full_body', 'upper_lower', 'ppl'];
  const RESTS = [60, 90, 120];
  const MINUTES = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const MAX = 3; // suggestions kept
  const MAX_MOVES = 60; // move ids a swap may name
  const DROP = 0.03; // the most the score may drop (applyTweaks' own rule, for the changes it can't try)
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const WD3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Each kind's fields, in the order the models write them (title and why come after).
  const SPEC = {
    more_sets: ['group', 'delta'], fewer_sets: ['group', 'delta'], swap_move: ['family', 'move'], move_day: ['from', 'to'],
    split: ['split'], rest: ['rest'], minutes: ['minutes'], finisher: ['delta'], mobility: ['delta'], focus: ['focus'], tip: [],
  };
  // The muscles a plan can lean toward: the groups, then the single muscles (src/brain.js).
  const focusList = () => GROUPS.concat(Object.keys(B().MUSCLE_GROUP || {}).filter((m) => !GROUPS.includes(m)));
  // What each field may hold (ctx: the review's context, for this person's own lists). delta is
  // sets a week for more_sets (1 or 2) and fewer_sets (-1 or -2); for a finisher or a cool-down, 1
  // adds one to every workout and -1 drops it.
  const VALUES = {
    group: () => GROUPS,
    delta: (k) => (k === 'more_sets' ? [1, 2] : k === 'fewer_sets' ? [-2, -1] : [1, -1]),
    family: (k, ctx) => ctx.swaps.map((x) => x.family),
    move: (k, ctx) => ctx.allowed,
    from: (k, ctx) => ctx.workDays,
    to: (k, ctx) => ctx.freeDays,
    split: () => SPLITS,
    rest: () => RESTS,
    minutes: () => MINUTES,
    focus: () => focusList(),
  };
  const NUMERIC = new Set(['delta', 'from', 'to', 'rest', 'minutes']);
  // The kinds this plan can take: a swap needs moves to swap in, a day move a free day.
  const kindsOf = (ctx) => KINDS.filter((k) => SPEC[k].every((f) => VALUES[f](k, ctx).length));

  // How each kind looks on its card: [icon, hue].
  const LOOK = {
    more_sets: ['plus-circle', 'green'], fewer_sets: ['minus', 'amber'], swap_move: ['shuffle', 'coral'], move_day: ['calendar', 'sky'],
    split: ['layers', 'indigo'], rest: ['timer', 'teal'], minutes: ['clock', 'sky'], finisher: ['bolt', 'amber'],
    mobility: ['leaf', 'teal'], focus: ['flag', 'violet'], tip: ['sparkle', 'violet'],
  };
  // The score's parts in plain words: a name, what it measures, and how a change reads.
  const PART_INFO = {
    goal: ['Your goals', 'Sets toward each goal, the top ones first', 'how well the sets match your goals'],
    coverage: ['Every muscle', 'Each muscle group gets its weekly minimum', 'every muscle getting its minimum'],
    time: ['Your time', 'Sessions fill your minutes without running over', 'fitting your time'],
    recovery: ['Recovery', 'Muscles rest before they work again', 'rest between sessions'],
    balance: ['Balance', 'As much pulling as pushing', 'balance between pushing and pulling'],
    variety: ['Variety', 'More than one move for each muscle', 'variety'],
  };
  const SPLIT_WORDS = { auto: 'the planner\'s own pick', full_body: 'full body', upper_lower: 'upper and lower', ppl: 'push, pull and legs' };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const int = (v) => { const n = Math.round(Number(v)); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const joinList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const groupWord = (g) => (g === 'arms' ? 'arms' : String(B().GROUP_NAME[g] || g).toLowerCase());
  // A group before "sets": "2 more leg sets".
  const ADJ = { biceps: 'biceps', triceps: 'triceps', abs: 'abs', chest: 'chest', legs: 'leg', back: 'back', shoulders: 'shoulder', arms: 'arm' };
  const moveName = (id) => { const m = M().MOVES[id]; return m ? m.name : id; };
  const muscleName = (x) => (GROUPS.includes(x) ? groupWord(x) : String((GH.body && GH.body.NAME && GH.body.NAME[x]) || x).toLowerCase());
  const pct = (x) => Math.round(clamp(Number(x) || 0, 0, 1) * 100);
  // A copy of the state to try a change on: it keeps no plans of its own (src/optimizer.js keptOf).
  const copyState = (S) => { const c = Object.assign({}, S, { planCache: null }); return typeof structuredClone === 'function' ? structuredClone(c) : copy(c); };
  function err(message, code) { const e = new Error(message); e.code = code; return e; }

  /* ================================================================== who can review */
  // The on-device model is ready when one is on the phone and the phone can run it (Settings keeps
  // what it found, U.deviceState); before that's been checked, the model picked in Settings stands in.
  function deviceReady(S) {
    const U = GH.ui;
    const d = U && U.deviceState ? U.deviceState() : null;
    if (d && d.checked) return !!(d.available && d.available.ok && d.installed && d.installed.length);
    return !!(S && S.ai && S.ai.deviceModel);
  }
  const claudeReady = (S) => !!(S && S.ai && S.ai.consentAt && GH.ai && GH.ai.hasKey && GH.ai.hasKey());
  // Who reviews: the coach the person picked for the chat when it's ready, else the other one.
  // 'claude', 'device' or null.
  function engine(S) {
    const c = claudeReady(S), d = deviceReady(S);
    if (S && S.ai && S.ai.mode === 'api' && c) return 'claude';
    return d ? 'device' : c ? 'claude' : null;
  }
  const available = (S) => !!engine(S);

  /* ================================================================== what is sent */
  // The plan as the review sees it: next week (the week applyTweaks compares), its sessions built as
  // planned, the engine's score and reasons, and what each field may hold for this person.
  // target: 'claude' or 'device' (what the words may include).
  function context(S, day, target) {
    const b = B(), opt = O();
    const p = S.profile;
    const ws = b.weekStart(day) + 7;
    const score = opt.score(S, ws);
    const cal = b.calendar(S, ws);
    const week = cal.weeks[ws];
    const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : [];
    const custom = !!(GH.customPlan && live.some((x) => GH.customPlan.owns(x.tpl)));
    const sessions = live.map((x) => b.buildSession(S, x.day, x.tpl, { cal, noReadiness: true }));
    const ex = opt.explain(S, ws);
    const set = b.settingsAt(S, ws);
    const workDays = b.weekdaysFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays })).slice().sort((x, y) => x - y);
    const freeDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !workDays.includes(d));
    const swaps = custom ? [] : swapOptions(S, sessions);
    const ctx = {
      day, ws, target: target === 'claude' ? 'claude' : 'device', score, sessions, custom, phase: week ? week.phase : null,
      explain: ex, minutes: set.minutes || p.minutes, workDays, freeDays, swaps, allowed: [].concat(...swaps.map((x) => x.options)),
    };
    ctx.kinds = kindsOf(ctx);
    return ctx;
  }
  // The moves a swap may name: for each ladder in next week's plan, the ones near the person's level
  // they can do there (kit, careful joints, the body's rules, no joint on a break), the nearest
  // first, at most 60 in all. [{ family, name, current, options: [ids] }].
  function swapOptions(S, sessions) {
    const b = B(), mv = M();
    const families = O().TWEAKS.swaps.families;
    const out = [];
    const seen = new Set();
    for (const s of sessions) {
      const avoid = (b.filtersFor(S, s.day).avoidJoints || []);
      for (const it of s.items || []) {
        const fam = it.fam;
        if (!fam || seen.has(fam) || !families.includes(fam) || !mv.LADDERS[fam] || it.skill) continue;
        seen.add(fam);
        const rungs = mv.LADDERS[fam].rungs;
        const at = Math.max(0, rungs.indexOf(it.moveId));
        const list = b.rungs(S, fam, s.day, { place: s.place || 'home' })
          .filter((id) => id !== it.moveId && mv.MOVES[id] && !(mv.MOVES[id].joints || []).some((j) => avoid.includes(j)))
          .sort((x, y) => Math.abs(rungs.indexOf(x) - at) - Math.abs(rungs.indexOf(y) - at) || rungs.indexOf(x) - rungs.indexOf(y))
          .slice(0, 4);
        if (list.length) out.push({ family: fam, name: mv.LADDERS[fam].name, current: it.moveId, options: list });
      }
    }
    // Over 60 in all: one fewer for each family, the farthest from their level first.
    for (let total = out.reduce((a, x) => a + x.options.length, 0); total > MAX_MOVES; total--) {
      const most = out.reduce((a, x) => (x.options.length > a.options.length ? x : a), out[0]);
      most.options.pop();
    }
    return out.filter((x) => x.options.length);
  }
  // The plan for a model with a short memory (an older on-device size, 2,048 tokens): two moves to
  // swap to for each family and 16 in all, and no reasons line. The answer is checked against these
  // shorter lists.
  const COMPACT_MOVES = 16;
  function compact(ctx) {
    const swaps = ctx.swaps.map((x) => Object.assign({}, x, { options: x.options.slice(0, 2) }));
    for (let total = swaps.reduce((a, x) => a + x.options.length, 0); total > COMPACT_MOVES; total--) {
      const most = swaps.reduce((a, x) => (x.options.length > a.options.length ? x : a), swaps[0]);
      most.options.pop();
    }
    const out = Object.assign({}, ctx, { compact: true, swaps: swaps.filter((x) => x.options.length) });
    out.allowed = [].concat(...out.swaps.map((x) => x.options));
    out.kinds = kindsOf(out);
    return out;
  }

  // The plan in words, the same for both models (only what each may know differs).
  function planLines(S, ctx) {
    const b = B(), opt = O(), p = S.profile;
    const sc = ctx.score;
    const ex = ctx.explain;
    const L = ['PLAN (next week, as the app\'s planner made it)'];
    const D = ctx.sessions.length;
    L.push(`- Split: ${ex.split ? ex.split.name.toLowerCase() : 'a mix'} (the planner compared ${fmtN(ex.considered || sc.considered || 1)} ways to lay out ${D} workout days)`);
    L.push(`- Trains ${p.where === 'gym' ? 'at a gym' : p.where === 'both' ? 'at home and at a gym' : 'at home'}; ${D} workouts a week, ${ctx.minutes} min each`);
    const ph = ctx.phase;
    if (ph && ph.deload) L.push(`- Next week is a lighter week: about ${Math.round(ph.mult * 100)}% of the usual sets`);
    else if (ph && ph.onramp) L.push(`- Next week still eases in: about ${Math.round(ph.mult * 100)}% of the usual sets`);
    L.push(`- Plan score ${pct(sc.score)} of 100. Parts: ${Object.keys(PART_INFO).map((k) => `${k} ${pct(sc.parts[k])}`).join(', ')}`);
    for (const s of ctx.sessions) {
      const wd = b.weekday(s.day);
      const items = (s.items || []).map((it) => `${it.name} ${it.sets}x${it.timed ? `${it.target} s` : it.target}`);
      const extra = [s.finisher ? 'a finisher' : '', (s.mobility || []).some((mb) => mb.cardio) ? 'easy cardio' : '', (s.mobility || []).some((mb) => !mb.cardio) ? 'a cool-down' : ''].filter(Boolean);
      L.push(`- ${WD3[wd]} (day ${wd}): ${s.title.toLowerCase()}, about ${Math.round(s.estimateMin || b.estimate(S, s))} of ${s.budget || ctx.minutes} min: ${items.join(', ')}${extra.length ? `; then ${joinList(extra)}` : ''}`);
    }
    if (ctx.freeDays.length) L.push(`- Free days: ${ctx.freeDays.map((d) => `${WD3[d]} (day ${d})`).join(', ')}`);
    L.push('- Weekly sets per group: planned sets (with half of the help from bigger moves), then target, minimum and most');
    L.push(`  ${GROUPS.map((g) => { const x = sc.perGroup[g]; return `${g} ${x.sets} (${x.effective}), ${x.target}, ${x.floor}, ${x.cap}`; }).join('; ')}`);
    const tw = opt.normTweaks(p.planTweaks);
    const rest = tw.rest === 'auto' ? 'auto (90 s after big moves, 60 s after small ones)' : `${tw.rest} s`;
    L.push(`- Rest between sets: ${rest}. Finishers: ${tw.finisher === 'auto' ? 'when there\'s time' : tw.finisher}. Cool-downs: ${tw.mobility === 'auto' ? 'when there\'s time' : tw.mobility}`);
    const mine = [];
    for (const [g, n] of Object.entries(tw.sets)) mine.push(`${g} ${n > 0 ? '+' : ''}${n} sets a week`);
    for (const [f, id] of Object.entries(tw.swaps)) mine.push(`${moveName(id)} for ${f}`);
    if (tw.split !== 'auto') mine.push(`the ${SPLIT_WORDS[tw.split]} split`);
    if (mine.length) L.push(`- Changes they already made: ${mine.join('; ')}`);
    // The planner's reasons; its "Planned around ..." line names health conditions and the exact
    // age, so it stays on the phone.
    const around = GH.access && GH.access.plannedAround ? GH.access.plannedAround(p) : null;
    const reasons = (ex.reasons || []).filter((r) => !(ctx.target === 'claude' && around && String(r).startsWith(around)));
    if (reasons.length && !ctx.compact) L.push(`- Why the planner picked it: ${reasons.join(' ')}`);
    return L;
  }
  function movesLines(ctx) {
    if (!ctx.swaps.length) return ['MOVES: none to swap in.'];
    return ['MOVES (family: its move now, then the moves it can swap to as id name; only these)']
      .concat(ctx.swaps.map((x) => `- ${x.family} (${x.name}, now ${moveName(x.current)}): ${x.options.map((id) => `${id} ${moveName(id)}`).join(', ')}`));
  }
  // The person, for the on-device model only (Claude has the usual summary instead): what the review
  // weighs, plus the body's details that never leave the phone.
  function personLines(S, day) {
    const b = B(), h = GH.health, p = S.profile, A = GH.access;
    const GOAL = { abs: 'visible abs', arms: 'bigger arms', chest: 'bigger chest', legs: 'legs and glutes', back: 'back and posture', fat: 'lose fat', strength: 'strength', endurance: 'endurance', mobility: 'mobility', consistency: 'consistency' };
    const EXP = { never: 'never trained', onoff: 'on and off', lt1: 'under 1 year', '1to3': '1 to 3 years', '3plus': '3 years or more' };
    const L = ['PERSON'];
    L.push(`- Goals in order: ${(p.goals || []).map((g) => GOAL[g] || g).join(', ') || 'not set'}`);
    L.push(`- Training history: ${EXP[p.experience] || p.experience || 'not given'}`);
    const eq = p.equipment || {};
    const kit = [];
    if (eq.db && eq.db.length) kit.push(`dumbbells ${eq.db.join('/')} ${p.units || 'lb'}`);
    if (eq.kb && eq.kb.length) kit.push(`kettlebell ${eq.kb.join('/')} ${p.units || 'lb'}`);
    for (const k of ['band', 'bar', 'ball', 'chair', 'table', 'door']) if (eq[k]) kit.push(k === 'bar' ? 'pull-up bar' : k);
    L.push(`- Equipment at home: ${kit.join(', ') || 'none, just their body'}`);
    if (A && A.band) L.push(`- Age: ${A.BANDS[A.band(p)].short}`);
    if ((p.careful || []).length) L.push(`- Careful with: ${p.careful.join(', ')}`);
    const pain = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    if (pain.length) L.push(`- Joints on a break (moves that load them are swapped out): ${pain.join(', ')}`);
    // Only this model, on the phone, sees these (never Claude).
    const conds = A && A.conditions ? A.conditions(p).map((id) => (A.CONDITIONS.find((c) => c.id === id) || {}).short).filter(Boolean) : [];
    if (conds.length) L.push(`- Health: the plan is adapted for ${joinList(conds)}`);
    if (Array.isArray(p.oaJoints) && p.oaJoints.length && conds.length) L.push(`- Joints with arthritis: ${p.oaJoints.join(', ')}`);
    if (p.floorOk === false) L.push('- Nothing on the floor: standing and seated moves only');
    if (p.gentle) L.push('- A gentle plan: fewer sets to start');
    // Readiness: this week against the usual, and how the last four weeks' workouts felt.
    const now = (k) => h.stats(S, k, day - 6, day), usual = (k) => h.stats(S, k, day - 34, day - 7);
    const pair = (k, fmt, unit) => { const a = now(k), u = usual(k); return a.n ? `${fmt(a.avg)}${unit}${u.n >= 7 ? ` (usually ${fmt(u.avg)}${unit})` : ''}` : null; };
    const bits = [['Sleep', pair('sleepMin', (m) => b.fmtMin(Math.round(m)), ' a night')], ['Resting heart rate', pair('rhr', (x) => String(Math.round(x)), ' bpm')], ['HRV', pair('hrv', (x) => String(Math.round(x)), ' ms')]].filter(([, v]) => v);
    if (bits.length) L.push(`- This week: ${bits.map(([k, v]) => `${k} ${v}`).join('; ')}`);
    const r = { easy: 0, right: 0, hard: 0 };
    let done = 0;
    for (const l of S.log || []) if (l.type === 'workout' && l.checkedIn && l.day > day - 28) { done++; if (l.checkin && r[l.checkin.rating] != null) r[l.checkin.rating]++; }
    if (done) L.push(`- Workouts in the last 4 weeks: ${done} done; ${r.easy} felt too easy, ${r.right} about right, ${r.hard} too hard`);
    return L;
  }

  const KIND_HELP = [
    '- more_sets or fewer_sets: weekly sets for one muscle group (delta 1 or 2; for fewer_sets -1 or -2).',
    '- swap_move: another move from one family\'s list in MOVES (family and move).',
    '- move_day: the workout on weekday "from" moves to the free weekday "to" (0 is Monday, 6 is Sunday).',
    '- split: full_body, upper_lower or ppl (push, pull and legs); auto lets the planner pick again.',
    '- rest: seconds between sets (60, 90 or 120).',
    '- minutes: minutes per workout (10 to 60, in steps of 5).',
    '- finisher or mobility: delta 1 adds a finisher (or a cool-down) to every workout, -1 drops it.',
    '- focus: a muscle or muscle group to lean the plan toward.',
    '- tip: advice that doesn\'t change the plan.',
  ];
  // Claude's ask (its system text holds the usual summary).
  function claudeAsk(S, ctx) {
    return [
      'Check this person\'s workout plan, below. The app\'s planner made it after comparing every way to lay out their week, and scores a plan on how well it fits their goals, covers every muscle group, fits their time, rests muscles between sessions, balances pushing and pulling, and varies the moves.',
      'Suggest up to 3 changes that would clearly help them, based on what their data shows (goals, how workouts felt, sleep and recovery, schedule). Fewer is better, and an empty list is right when the plan already fits. The app checks each suggestion against its rules (equipment, joints, time, every muscle\'s weekly minimum, recovery) before they see it, and nothing changes until they approve it.',
      'Kinds of change:', ...KIND_HELP,
      'title: under 8 words, plain. why: one sentence under 25 words, with their numbers. note: one sentence about the plan as a whole.',
      '', ...planLines(S, ctx), '', ...movesLines(ctx),
    ].join('\n');
  }
  // The on-device model's: short rules for a small model, the person and the plan, then the ask.
  const DEVICE_RULES = [
    'You check a workout plan the app made and suggest at most 3 small changes, as JSON.',
    'The app already compared every way to lay out the week. Suggest a change only for a clear reason in PERSON or PLAN: a goal below its target, workouts that felt too hard or too easy, short sleep, a muscle trained two days in a row. An empty list is fine.',
    'Kinds:', ...KIND_HELP,
    'title: under 8 words. why: one short sentence that copies their numbers exactly as written. Don\'t calculate anything.',
    'note: one short sentence about the plan.',
  ].join('\n');
  function deviceMessages(S, day, ctx) {
    return [
      { role: 'system', content: [DEVICE_RULES, '', ...personLines(S, day), '', ...planLines(S, ctx), '', ...movesLines(ctx)].join('\n') },
      { role: 'user', content: 'Check my plan. Suggest up to 3 changes, or none if it already fits me.' },
    ];
  }

  /* ================================================================== the shape of an answer */
  // Claude's JSON schema for the list: one object shape per kind, each with exactly its fields.
  // (Structured outputs take enums but no ranges or item counts: ranges are enums here, and the ask
  // says how many.)
  function listSchema(ctx) {
    const field = (f, k) => (NUMERIC.has(f) ? { type: 'integer', enum: VALUES[f](k, ctx) } : { type: 'string', enum: VALUES[f](k, ctx) });
    const variants = ctx.kinds.map((k) => {
      const props = { kind: { type: 'string', enum: [k] } };
      for (const f of SPEC[k]) props[f] = field(f, k);
      props.title = { type: 'string' };
      props.why = { type: 'string' };
      return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
    });
    return { type: 'array', items: { anyOf: variants } };
  }
  function schema(ctx) {
    return { type: 'object', properties: { suggestions: listSchema(ctx), note: { type: 'string' } }, required: ['suggestions', 'note'], additionalProperties: false };
  }
  // The on-device model's GBNF grammar, from the same lists (like GH.tailor.GRAMMAR): one rule per
  // kind, at most 3 suggestions, the note last so an answer cut off by the token limit can still be
  // read. (A GBNF literal is quoted like a JSON string; rule names can't hold underscores, and a kind's
  // rule is named apart from the fields, since a name given twice is one rule to llama.cpp: "minutes"
  // the kind would take "35" the value.)
  function grammar(ctx) {
    const lit = (s) => JSON.stringify(s);
    const value = (v) => lit(typeof v === 'number' ? String(v) : JSON.stringify(v));
    const rule = (k) => `kind-${k.replace(/_/g, '-')}`;
    const fields = new Map();
    const fieldRule = (f, k) => {
      const name = f === 'delta' ? `delta-${k.replace(/_/g, '-')}` : f;
      if (!fields.has(name)) fields.set(name, `${name} ::= ${VALUES[f](k, ctx).map(value).join(' | ')}`);
      return name;
    };
    const kinds = ctx.kinds.map((k) => {
      let body = lit(`{"kind":"${k}"`);
      for (const f of SPEC[k]) body += ` ${lit(`,"${f}":`)} ${fieldRule(f, k)}`;
      return `${rule(k)} ::= ${body} ${lit(',"title":')} title ${lit(',"why":')} why ${lit('}')}`;
    });
    return [
      `root ::= ${lit('{"suggestions":[')} (item (${lit(',')} item){0,${MAX - 1}})? ${lit('],"note":')} note ${lit('}')}`,
      `item ::= ${ctx.kinds.map(rule).join(' | ')}`,
      ...kinds, ...fields.values(),
      'title ::= "\\"" [A-Za-z0-9 ,\'+-]{2,48} "\\""',
      'why ::= "\\"" [A-Za-z0-9 ,.\'!?%:+-]{0,150} "\\""',
      'note ::= "\\"" [A-Za-z0-9 ,.\'!?%:+-]{0,150} "\\""',
    ].join('\n');
  }
  // The grammar's JSON, or null. An answer cut off by the token limit is closed off when it can be.
  function readJson(text) {
    const s = String(text || '').trim();
    for (const tail of ['', '"}', '}', '"}]}', '}]}', ']}', '"]}', '","note":""}', '],"note":""}', '"}],"note":""}']) { try { return JSON.parse(s + tail); } catch (e) { /* try the next */ } }
    return null;
  }

  /* ================================================================== checking */
  // A model's answer into suggestions the app understands: kinds it knows, values in range, at most
  // 3. { items, dropped: [{ title, reason }], note }. (Enum values are matched without regard to
  // case: structured outputs don't promise it.)
  const pick = (list, v) => { const t = String(v == null ? '' : v).toLowerCase(); return list.find((x) => String(x).toLowerCase() === t) || null; };
  function normalize(raw, ctx) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(r.suggestions) ? r.suggestions : [];
    const items = [], dropped = [];
    for (const [at, x] of list.entries()) {
      if (items.length + dropped.length >= MAX + 2 || items.length >= MAX) break;
      if (!x || typeof x !== 'object') continue;
      const kind = pick(KINDS, x.kind);
      const s = { kind, title: clean(x.title, 80), why: clean(x.why, 300), at };
      let bad = null;
      if (!kind) bad = 'It asked for a kind of change the app can\'t make.';
      else if (kind === 'more_sets' || kind === 'fewer_sets') {
        s.group = pick(GROUPS.concat(['arms']), x.group);
        s.delta = clamp(Math.abs(int(x.delta) || 1), 1, 2);
        if (!s.group) bad = 'It didn\'t say which muscle group.';
      } else if (kind === 'swap_move') {
        const move = pick(ctx.allowed, x.move) || '';
        const fam = pick(ctx.swaps.map((o) => o.family), x.family);
        const own = ctx.swaps.find((o) => o.family === fam && o.options.includes(move)) || ctx.swaps.find((o) => o.options.includes(move));
        if (!own) bad = 'That move isn\'t one you can do with your equipment and joints, or it isn\'t in your plan.';
        else { s.family = own.family; s.move = move; }
      } else if (kind === 'move_day') {
        s.from = int(x.from); s.to = int(x.to);
        if (s.from == null || s.to == null || s.from < 0 || s.from > 6 || s.to < 0 || s.to > 6 || s.from === s.to) bad = 'It didn\'t say which days.';
      } else if (kind === 'split') {
        s.split = pick(SPLITS, x.split);
        if (!s.split) bad = 'It named a split the planner doesn\'t have.';
      } else if (kind === 'rest') {
        const v = int(x.rest);
        s.rest = v != null && v >= 30 && v <= 180 ? RESTS.reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a)) : null;
        if (!s.rest) bad = 'Rest between sets can be 60, 90 or 120 seconds.';
      } else if (kind === 'minutes') {
        const v = int(x.minutes);
        s.minutes = v != null && v > 0 ? clamp(Math.round(v / 5) * 5, 10, 60) : null;
        if (!s.minutes) bad = 'It didn\'t say how many minutes.';
      } else if (kind === 'finisher' || kind === 'mobility') s.delta = int(x.delta) < 0 ? -1 : 1;
      else if (kind === 'focus') {
        s.focus = pick(focusList(), x.focus);
        if (!s.focus) bad = 'It named a muscle the plan doesn\'t know.';
      }
      if (bad) dropped.push({ kind, title: s.title || (kind ? ownTitle(s) : 'A suggestion'), reason: bad, at });
      else items.push(s);
    }
    return { items, dropped, note: clean(r.note, 300) };
  }

  // The app's own title for a change: used when the model's has a number it wasn't given.
  function ownTitle(s) {
    const sets = (k) => (k === 1 ? 'set' : 'sets');
    switch (s.kind) {
      case 'more_sets': return `${s.delta} more ${ADJ[s.group]} ${sets(s.delta)} a week`;
      case 'fewer_sets': return `${s.delta} fewer ${ADJ[s.group]} ${sets(s.delta)} a week`;
      case 'swap_move': return `${moveName(s.move)} instead`;
      case 'move_day': return `${WD[s.from]}'s workout to ${WD[s.to]}`;
      case 'split': return s.split === 'auto' ? 'Let the planner pick the split' : `Switch to ${SPLIT_WORDS[s.split]}`;
      case 'rest': return `Rest ${s.rest === 60 ? '1 minute' : s.rest === 90 ? '90 seconds' : '2 minutes'} between sets`;
      case 'minutes': return `${s.minutes}-minute workouts`;
      case 'finisher': return s.delta < 0 ? 'No finishers' : 'A finisher every workout';
      case 'mobility': return s.delta < 0 ? 'No extra cool-downs' : 'A cool-down every workout';
      case 'focus': return `Lean the plan toward your ${muscleName(s.focus)}`;
      default: return 'A tip';
    }
  }
  // The title and why as shown: held to the numbers that were sent (and the suggestion's own), the
  // app's own title standing in for one that isn't. given null: already checked (a report's ideas).
  function wordsOf(s, given) {
    const title0 = s.title || ownTitle(s);
    if (given == null || !GH.coach || !GH.coach.keepToGiven) return { title: title0, why: s.why || '', cut: 0 };
    const own = [s.delta, s.minutes, s.rest, s.rest ? s.rest / 60 : null].filter((x) => x != null).map((x) => Math.abs(x)).join(' ');
    const g = `${given}\n${own}`;
    const t = GH.coach.keepToGiven(title0, g);
    const w = GH.coach.keepToGiven(s.why || '', g);
    return { title: t.cut ? ownTitle(s) : title0, why: w.text, cut: (t.cut ? 1 : 0) + w.cut };
  }

  // A suggestion as a change to the plan: { change: { tweaks?, minutes?, weekdays?, profile?, lines? },
  // key (one change of each kind) } or { reason } when it can't or needn't be made.
  function prepare(S, s, ctx) {
    const opt = O();
    const cur = opt.normTweaks(S.profile.planTweaks);
    switch (s.kind) {
      case 'more_sets': case 'fewer_sets': {
        const groups = s.group === 'arms' ? ['biceps', 'triceps'] : [s.group];
        const d = s.kind === 'more_sets' ? Math.abs(s.delta) : -Math.abs(s.delta);
        const sets = {};
        for (const g of groups) {
          const was = cur.sets[g] || 0;
          const next = clamp(was + d, opt.TWEAKS.sets.min, opt.TWEAKS.sets.max);
          if (next === was) return { reason: d > 0 ? `Your plan already has all the extra ${ADJ[g]} sets a change can add.` : `Your plan already has as few ${ADJ[g]} sets as a change can leave.` };
          sets[g] = next;
        }
        return { change: { tweaks: { sets } }, key: `sets:${groups.join()}` };
      }
      case 'swap_move': {
        if (cur.swaps[s.family] === s.move) return { reason: `Your plan already uses ${moveName(s.move).toLowerCase()}.` };
        return { change: { tweaks: { swaps: { [s.family]: s.move } } }, key: `swap:${s.family}` };
      }
      case 'move_day': {
        if (!ctx.workDays.includes(s.from)) return { reason: `${WD[s.from]} isn't one of your workout days.` };
        if (ctx.workDays.includes(s.to)) return { reason: `${WD[s.to]} is already a workout day.` };
        return { change: { weekdays: ctx.workDays.map((x) => (x === s.from ? s.to : x)).sort((x, y) => x - y) }, key: 'weekdays' };
      }
      case 'split':
        if (cur.split === s.split) return { reason: s.split === 'auto' ? 'The planner already picks your split.' : `Your plan is already ${SPLIT_WORDS[s.split]}.` };
        return { change: { tweaks: { split: s.split } }, key: 'split' };
      case 'rest':
        if (cur.rest === s.rest) return { reason: 'Your rest between sets is already that long.' };
        return { change: { tweaks: { rest: s.rest } }, key: 'rest' };
      case 'minutes':
        if (s.minutes === ctx.minutes) return { reason: `Your workouts are already about ${s.minutes} minutes.` };
        return { change: { minutes: s.minutes }, key: 'minutes' };
      case 'finisher': case 'mobility': {
        const v = s.delta < 0 ? 'off' : 'on';
        if (cur[s.kind] === v) return { reason: `Your plan already has ${v === 'on' ? 'that' : 'none'}.` };
        return { change: { tweaks: { [s.kind]: v } }, key: s.kind };
      }
      case 'focus': {
        // The same reading as Tailor my plan: a group goes first among the goals, a single muscle
        // joins the ones the plan leans toward.
        const T = GH.tailor;
        if (!T) return { reason: 'The plan can\'t lean toward a muscle here.' };
        const t = T.valid(S, GROUPS.includes(s.focus) ? { focus: [s.focus] } : { muscles: [s.focus] });
        if (T.empty(t)) return { reason: `Your plan already leans toward your ${muscleName(s.focus)}.` };
        const { patch, lines } = T.plan(S, t);
        const p = S.profile;
        const same = (!patch.goals || JSON.stringify(patch.goals) === JSON.stringify(p.goals || [])) && (!patch.focus || JSON.stringify(patch.focus) === JSON.stringify(p.focus || []));
        if (same) return { reason: `Your ${muscleName(s.focus)} already get the most work.` };
        const profile = {};
        if (patch.goals) profile.goals = patch.goals;
        if (patch.focus) profile.focus = patch.focus;
        return { change: { profile, lines: lines.map((l) => `${l.text}${l.sub ? `: ${l.sub.charAt(0).toLowerCase()}${l.sub.slice(1)}` : ''}.`) }, key: 'focus' };
      }
      default: return { reason: 'There\'s nothing to change.' };
    }
  }

  // A change tried on a copy: the engine's own test (applyTweaks) for tweaks and the time, and the
  // same test made here for what it can't express (the weekdays, a muscle to lean toward).
  // { ok, reason, diff, before, after }.
  function trial(S, change, day) {
    const opt = O();
    let res;
    if (!change.weekdays && !change.profile) res = opt.applyTweaks(S, Object.assign({}, change.tweaks || {}, change.minutes != null ? { minutes: change.minutes } : {}), day);
    else res = tryOnCopy(S, change, day);
    const fresh = res.after.violations.filter((v) => !res.before.violations.some((w) => w.text === v.text));
    const diff = diffOf(res, change);
    // A change that leaves next week as it was (more sets with no time for them) isn't one to make.
    if (res.ok && !diff.length && Math.abs(res.after.score - res.before.score) < 0.001) return { ok: false, reason: noChange(change), diff, before: res.before, after: res.after };
    return { ok: !!res.ok, reason: res.ok ? null : fresh.length ? plain(fresh[0]) : worse(res.before, res.after), diff, before: res.before, after: res.after };
  }
  function noChange(change) {
    const sets = change.tweaks && change.tweaks.sets ? Object.entries(change.tweaks.sets) : [];
    if (sets.length === 1 && sets[0][1] > 0) return `Your time has no room for more ${ADJ[sets[0][0]]} sets, so next week would stay as it is.`;
    if (sets.length === 1) return `Your ${ADJ[sets[0][0]]} sets are already at their weekly minimum, so next week would stay as it is.`;
    return 'It wouldn\'t change next week\'s plan.';
  }
  function tryOnCopy(S, change, day) {
    const b = B(), opt = O();
    const ws = b.weekStart(day) + 7;
    const S1 = copyState(S), S2 = copyState(S);
    write(S2, change, day);
    const before = opt.score(S1, ws), after = opt.score(S2, ws);
    const fresh = after.violations.filter((v) => !before.violations.some((w) => w.text === v.text));
    return { ok: !fresh.length && before.score - after.score <= DROP, before, after, diff: [] };
  }
  // Writes a change (to the state, or to a copy being tried).
  function write(S, change, day) {
    const b = B(), opt = O();
    if (change.tweaks && Object.keys(change.tweaks).length) S.profile.planTweaks = opt.mergeTweaks(opt.normTweaks(S.profile.planTweaks), change.tweaks);
    if (change.profile) b.reprogram(S, copy(change.profile), day);
    const patch = {};
    if (change.minutes != null) patch.minutes = change.minutes;
    if (change.weekdays) patch.weekdays = change.weekdays.slice();
    if (Object.keys(patch).length) b.updateSettings(S, day, patch);
  }
  // Two changes as one (later ones win where both say something).
  function merge(a, c) {
    const out = Object.assign({}, a);
    if (c.tweaks) {
      const t = Object.assign({}, a.tweaks || {});
      for (const [k, v] of Object.entries(c.tweaks)) t[k] = (k === 'sets' || k === 'swaps') ? Object.assign({}, t[k] || {}, v) : v;
      out.tweaks = t;
    }
    if (c.minutes != null) out.minutes = c.minutes;
    if (c.weekdays) out.weekdays = c.weekdays.slice();
    if (c.profile) out.profile = Object.assign({}, a.profile || {}, c.profile);
    return out;
  }

  // What a change does, line by line: the engine's lines (without its score line, which the card
  // words itself), and for the changes tried here, the days or the muscles plus each group's sets.
  function diffOf(res, change) {
    const b = B();
    let lines = (res.diff || []).filter((l) => !/^Plan score:/.test(l));
    if (change.weekdays || change.profile) {
      lines = [];
      if (change.weekdays) {
        const was = res.before.sessions.map((s) => WD3[b.weekday(s.day)]), now = res.after.sessions.map((s) => WD3[b.weekday(s.day)]);
        lines.push(`Workouts on ${joinList(now)} (was ${joinList(was)}).`);
      }
      if (change.lines) lines.push(...change.lines);
      if (change.minutes != null) lines.push(`Sessions of ${change.minutes} minutes.`);
      for (const g of GROUPS) {
        const a = res.before.perGroup[g].sets, z = res.after.perGroup[g].sets;
        if (a !== z) lines.push(`${b.GROUP_NAME[g]}: ${z} sets a week (was ${a}).`);
      }
    }
    // "1 sets" reads as one set.
    return lines.map((l) => String(l).replace(/\b1 sets\b/g, '1 set'));
  }
  // Why the engine said no, in plain words. Its rules: kit, the body's rules, impact, a joint on a
  // break, careful joints, time, a move twice, each group's weekly cap and floor.
  function plain(v) {
    const b = B();
    const g = GROUPS.find((x) => String(v.text || '').startsWith(b.GROUP_NAME[x]));
    const gw = g ? (g === 'abs' ? 'abs' : b.GROUP_NAME[g].toLowerCase()) : 'a muscle group';
    switch (v.kind) {
      case 'time': return 'A workout would run over the time you set.';
      case 'twice': return 'A workout would have the same move twice.';
      case 'kit': return 'It needs equipment you don\'t have.';
      case 'impact': return 'It adds jumping, which your plan leaves out.';
      case 'pain': return 'It loads a joint that\'s having a break.';
      case 'careful': return 'It\'s hard on a joint you\'re careful with.';
      case 'rules': return 'It brings in a move your plan rules out for you.';
      case 'cap': return `It would take your ${gw} past the most sets a week your plan allows.`;
      case 'floor': return `It would leave your ${gw} short of their weekly minimum.`;
      default: return 'It breaks one of your plan\'s rules.';
    }
  }
  const PARTS = () => O().PARTS;
  const partMoved = (before, after, sign) => Object.keys(PARTS()).sort((x, y) => sign * ((after.parts[y] - before.parts[y]) * PARTS()[y] - (after.parts[x] - before.parts[x]) * PARTS()[x]))[0];
  // A change is told in points, never as a second score: it's weighed on next week's sessions as
  // built, which can sit a point or two from the plan score Why this plan shows.
  const points = (n) => `${n} point${n === 1 ? '' : 's'}`;
  function worse(before, after) {
    return `It would make your plan a worse fit (${points(pct(before.score) - pct(after.score))} lower), mostly on ${PART_INFO[partMoved(before, after, -1)][2]}.`;
  }
  // The score's change in words: { dir: 'up' | 'same' | 'down', text }.
  function scoreWords(before, after) {
    const a = pct(before.score), z = pct(after.score);
    if (z > a) return { dir: 'up', text: `A better fit: ${points(z - a)} higher, mostly on ${PART_INFO[partMoved(before, after, 1)][2]}.` };
    if (z < a) return { dir: 'down', text: `Scores ${points(a - z)} lower (mostly ${PART_INFO[partMoved(before, after, -1)][2]}), within what the planner allows.` };
    return { dir: 'same', text: 'About as good a fit as your plan now.' };
  }

  // A model's answer, checked: { items (the changes that pass, as cards), tips, rejected: [{ title,
  // reason }], note, cut (sentences the number check left out) }. o: { ctx, given (what was sent,
  // for the number check; null when already checked) }.
  function validate(S, raw, day, o) {
    const opt = o || {};
    const ctx = opt.ctx || context(S, day, 'device');
    const given = opt.given === undefined ? '' : opt.given;
    const n = normalize(raw, ctx);
    const out = { items: [], tips: [], rejected: n.dropped.map((x) => ({ kind: x.kind, title: x.title, reason: x.reason, at: x.at })), note: '', cut: 0 };
    const keys = new Set();
    let id = 0;
    for (const s of n.items) {
      const w = wordsOf(s, given);
      out.cut += w.cut;
      const no = (reason) => out.rejected.push({ kind: s.kind, title: w.title, reason, at: s.at });
      if (s.kind === 'tip') { if (w.why || s.title) out.tips.push({ title: w.title, why: w.why }); continue; }
      const prep = prepare(S, s, ctx);
      if (prep.reason) { no(prep.reason); continue; }
      if (keys.has(prep.key)) { no('Another suggestion already changes that.'); continue; }
      keys.add(prep.key);
      const res = trial(S, prep.change, day);
      if (!res.ok) { no(res.reason); continue; }
      const [icon, tone] = LOOK[s.kind];
      out.items.push({ id: `s${id++}`, kind: s.kind, title: w.title, why: w.why, change: prep.change, diff: res.diff, from: res.before.score, to: res.after.score, score: scoreWords(res.before, res.after), icon, tone, raw: s });
    }
    // In the order the model gave them.
    out.rejected.sort((a, b) => a.at - b.at);
    if (n.note) {
      const k = given != null && GH.coach && GH.coach.keepToGiven ? GH.coach.keepToGiven(n.note, given) : { text: n.note, cut: 0 };
      out.note = k.text;
      out.cut += k.cut;
    }
    return out;
  }

  /* ================================================================== asking */
  // How long an on-device answer may run, in tokens: room for 3 suggestions and the note (for the
  // shorter plan, which has less room around it, a little less).
  const DEVICE_TOKENS = 560, COMPACT_TOKENS = 420;
  // One review: the model reads the plan and answers in the schema or grammar. o: { engine, signal,
  // onStatus(state, value) } (the on-device states: 'loading', 'reading', 'writing'; Claude's:
  // 'asking'). Resolves { raw, given, ctx, engine, model } or { aborted: true }.
  async function ask(S, day, o) {
    const opt = o || {};
    const who = opt.engine || engine(S);
    if (!who) throw err('Set up the on-device coach or Claude first.', 'none');
    const ctx = context(S, day, who === 'claude' ? 'claude' : 'device');
    if (ctx.custom) throw err('You\'re following your own plan. The review checks the coach\'s plan.', 'custom');
    if (!ctx.sessions.length) throw err('There\'s no plan to check next week.', 'empty');
    if (who === 'claude') {
      const prompt = claudeAsk(S, ctx);
      const given = `${GH.ai.preview(S, day)}\n${prompt}`;
      if (opt.onStatus) { try { opt.onStatus('asking'); } catch (e) { /* ignore */ } }
      const raw = await GH.ai.json(S, day, prompt, schema(ctx), { effort: 'medium', maxTokens: 8000 });
      return { raw, given, ctx, engine: 'claude', model: (S.ai.model && S.ai.model.name) || null };
    }
    // A model with a short memory gets the shorter plan when the whole one won't fit (counted at 3
    // characters a token, as llm.js does), and should it still say the plan is too long, the shorter
    // one is tried before giving up.
    const tooLong = () => err('Your plan is too long for this on-device model. A newer size in Settings can read it, or Claude can.', 'too-long');
    const room = GH.deviceCoach.room ? await GH.deviceCoach.room(S) : null;
    const needs = (c) => Math.ceil(deviceMessages(S, day, c).reduce((a, m) => a + m.content.length + 18, 0) / 3) + 64 + DEVICE_TOKENS;
    const once = async (c) => {
      const msgs = deviceMessages(S, day, c);
      const res = await GH.deviceCoach.structured(S, msgs, { grammar: grammar(c), maxTokens: c.compact ? COMPACT_TOKENS : DEVICE_TOKENS, temperature: 0.3, signal: opt.signal, onStatus: opt.onStatus });
      return { res, msgs, c };
    };
    let out;
    const first = room && needs(ctx) > room ? compact(ctx) : ctx;
    try { out = await once(first); } catch (e) {
      if (!(e && e.code === 'too-long')) throw e;
      if (first.compact) throw tooLong();
      try { out = await once(compact(ctx)); } catch (e2) { throw e2 && e2.code === 'too-long' ? tooLong() : e2; }
    }
    if (out.res.aborted) return { aborted: true, ctx: out.c, engine: 'device' };
    return { raw: readJson(out.res.raw), text: out.res.raw, given: out.msgs.map((m) => m.content).join('\n'), ctx: out.c, engine: 'device', model: out.res.model };
  }
  // The plan's shape, to tell whether a review still fits it.
  function stamp(S, day) {
    const b = B();
    const s = JSON.stringify([b.planProfile ? b.planProfile(S.profile) : S.profile, S.vol, S.excluded, S.pain, S.activePlan || null, b.settingsAt(S, b.weekStart(day) + 7), b.weekStart(day)]);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  // A review, asked and checked, kept in S.ai.review so it's there when the sheet opens again (until
  // the plan changes). Resolves the review, or { aborted: true }.
  async function run(S, day, o) {
    const opt = o || {};
    const res = await ask(S, day, opt);
    if (res.aborted) return { aborted: true };
    if (!res.raw || typeof res.raw !== 'object') throw err('The coach\'s answer couldn\'t be read. Try again.', 'unread');
    const out = validate(S, res.raw, day, { ctx: res.ctx, given: res.given });
    const review = Object.assign(out, { v: 1, at: Date.now(), day, engine: res.engine, model: res.model || null, source: opt.source || null, stamp: stamp(S, day) });
    S.ai = S.ai || {};
    S.ai.review = review;
    return review;
  }
  // The last review, while the plan is as it was then.
  function current(S, day) {
    const r = S && S.ai && S.ai.review;
    return r && r.v === 1 && r.stamp === stamp(S, day) && Array.isArray(r.items) ? r : null;
  }

  /* ================================================================== applying */
  const KEEP = ['minutes', 'days', 'weekdays', 'goals', 'focus'];
  // Writes the approved changes. Each is tried again with the ones before it (two that pass alone
  // can fail together); one that fails then is skipped. One undo covers the lot. meta: { engine,
  // source }. { applied, skipped: [{ title, reason }], lines }.
  function apply(S, items, day, meta) {
    const m = meta || {};
    let all = {};
    const applied = [], skipped = [];
    for (const it of items || []) {
      if (!it || !it.change) continue;
      const next = merge(all, it.change);
      const res = trial(S, next, day);
      if (res.ok) { all = next; applied.push(it); } else skipped.push({ title: it.title, reason: `With the other changes: ${res.reason.charAt(0).toLowerCase()}${res.reason.slice(1)}` });
    }
    if (!applied.length) return { applied, skipped, lines: [] };
    const p = S.profile;
    // (focus is kept as a list, even when it wasn't set, so Undo clears one that was added.)
    const before = { planTweaks: p.planTweaks ? copy(p.planTweaks) : null, profile: copy(Object.fromEntries(KEEP.map((k) => [k, k === 'focus' ? p.focus || [] : p[k] === undefined ? null : p[k]]))), vol: Object.assign({}, S.vol), noFocus: p.focus === undefined };
    write(S, all, day);
    const lines = applied.map((it) => it.title);
    S.events = S.events || [];
    S.events.push({ type: 'review', day, at: Date.now(), engine: m.engine || null, source: m.source || null, lines, before });
    return { applied, skipped, lines };
  }
  // The last review's changes that can still be undone.
  const last = (S) => (S.events || []).filter((e) => e && e.type === 'review' && !e.undone && e.before).pop() || null;
  function undo(S, day) {
    const e = last(S);
    if (!e) return false;
    if (e.before.planTweaks) S.profile.planTweaks = copy(e.before.planTweaks); else delete S.profile.planTweaks;
    B().reprogram(S, copy(e.before.profile), day);
    if (e.before.noFocus && Array.isArray(S.profile.focus) && !S.profile.focus.length) delete S.profile.focus;
    S.vol = Object.assign({}, S.vol, e.before.vol);
    e.undone = true;
    return true;
  }

  /* ================================================================== the weekly report */
  // Claude's weekly report also checks the plan (src/claude.js): the list schema, the ask, and the
  // context they came from. null when there's no plan to check (workouts off, their own plan).
  function forReport(S, day) {
    if (!S || !S.profile || S.profile.workouts === false) return null;
    let ctx;
    try { ctx = context(S, day, 'claude'); } catch (e) { return null; }
    if (ctx.custom || !ctx.sessions.length) return null;
    const ask0 = [
      'PLAN IDEAS',
      'Also check their workout plan, below, for plan_suggestions and plan_note. The app\'s planner made it after comparing every way to lay out their week. Suggest up to 3 changes that would clearly help, based on their data; an empty list is right when the plan already fits. The app checks each one against its rules, and nothing changes until they approve it.',
      'Kinds of change:', ...KIND_HELP,
      'title: under 8 words. why: one sentence under 25 words, with their numbers. plan_note: one sentence about the plan, or empty with no suggestions.',
      '', ...planLines(S, ctx), '', ...movesLines(ctx),
    ].join('\n');
    return { ctx, schema: listSchema(ctx), ask: ask0 };
  }
  // The report's plan ideas, kept with the report: read and held to the numbers here, checked
  // against the plan when they're opened (it may have changed by then).
  function fromReport(S, day, data, part, given) {
    const d = data && typeof data === 'object' ? data : {};
    const n = normalize({ suggestions: d.plan_suggestions, note: d.plan_note }, part.ctx);
    const items = n.items.map((s) => { const w = wordsOf(s, given || ''); return Object.assign({}, s, { title: w.title, why: w.why }); });
    const note = n.note && GH.coach && GH.coach.keepToGiven ? GH.coach.keepToGiven(n.note, given || '').text : n.note;
    return { day, at: Date.now(), items, note };
  }

  /* ================================================================== why this plan */
  // The engine's own account (no AI): the headline, how many weekly plans it compared, its reasons,
  // the score's parts, and the classic splits it weighed against this one, each with the reason it
  // lost. For U.act.whyPlan.
  function why(S, day) {
    const b = B(), opt = O();
    const ex = opt.explain(S, day);
    const ws = b.weekStart(day);
    const alts = opt.alternatives(S, ws);
    const cur = alts.find((a) => a.current) || alts.find((a) => a.split === 'auto') || alts[0];
    const daysOf = (a) => a.days.map((d) => ({ wd: WD3[d.offset], label: dayLabel(d.units, a.shape) }));
    const sameWeek = (a, c) => a.shape === c.shape && JSON.stringify(a.days.map((d) => [d.offset, d.units.slice().sort()])) === JSON.stringify(c.days.map((d) => [d.offset, d.units.slice().sort()]));
    const others = alts.filter((a) => a !== cur).map((a) => ({
      split: a.split, name: a.split === 'auto' ? 'The planner\'s pick' : a.name, score: a.score, days: daysOf(a),
      same: sameWeek(a, cur), note: sameWeek(a, cur) ? 'The same week as yours.' : whyNot(cur, a),
    }));
    const custom = !!(GH.customPlan && GH.customPlan.inForce && GH.customPlan.inForce(S, day));
    return {
      headline: ex.headline, custom, considered: ex.considered || 1, score: ex.score, split: ex.split, reasons: ex.reasons || [],
      parts: Object.keys(PART_INFO).map((k) => ({ key: k, name: PART_INFO[k][0], about: PART_INFO[k][1], value: ex.parts[k], weight: opt.PARTS[k] })),
      current: { split: cur.split, name: cur.split === 'auto' ? (ex.split ? ex.split.name : cur.shapeName) : cur.name, score: cur.score, days: daysOf(cur) },
      others,
    };
  }
  const NOT = {
    goal: 'Fewer sets where your goals need them.', coverage: 'Some muscle groups would miss their weekly minimum.', time: 'Its sessions wouldn\'t fit your time as well.',
    recovery: 'More muscles would train on back-to-back days.', balance: 'Less balance between pushing and pulling.', variety: 'Less variety in your moves.',
  };
  // Why the planner didn't pick a split: its weakest part next to the plan in force. (The planner
  // chooses by how evenly each day's work falls, the rest between sessions and how often each muscle
  // should train, then scores the result; so another split can score higher and still not be its pick.)
  function whyNot(cur, a) {
    const d = a.score - cur.score;
    const picked = cur.split !== 'auto';
    if (d > 0.004) {
      if (a.split === 'auto') return 'What the planner would pick for you. It scores higher than the split you chose.';
      if (picked) return 'It scores higher than the split you chose.';
      return d > 0.02 ? `It scores higher, but the planner chose yours for how evenly it spreads the work and how often each muscle trains. You can try it.` : 'Scores a touch higher, but yours spreads the work and the rest days more evenly.';
    }
    if (d >= -0.004) return picked ? 'About as good as the split you chose.' : 'About as good. Yours spreads the work over the week a little more evenly.';
    return NOT[partMoved({ parts: cur.parts }, { parts: a.parts }, -1)];
  }
  // A day of a split in a word or two: the classic splits' own names for their days (full body,
  // upper, lower, push, pull, legs), and for a mix, the groups it trains, the big ones first.
  const UNIT_WORD = { chest: 'chest', back: 'back', legs: 'legs', shoulders: 'shoulders', arms: 'arms', abs: 'abs' };
  function dayLabel(units, shape) {
    const has = (u) => units.includes(u);
    const upper = ['chest', 'back', 'shoulders', 'arms'].filter(has).length;
    if (shape === 'full_body') return 'Full body';
    if (shape === 'upper_lower') return has('legs') ? 'Lower' : 'Upper';
    if (shape === 'ppl') {
      if (has('legs') && upper < 2) return 'Legs';
      if (has('back') && !has('chest') && !has('shoulders')) return 'Pull';
      if ((has('chest') || has('shoulders')) && !has('back')) return 'Push';
    }
    const list = Object.keys(UNIT_WORD).filter(has).map((u) => UNIT_WORD[u]);
    const s = list.length > 3 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Rest';
  }

  // Opens the Coach's review (src/ui/review.js). source: where from ('plan', 'you', 'setup',
  // 'report', 'why').
  function open(source, o) { const U = GH.ui; if (U && U.openReview) return U.openReview(source, o); return null; }

  GH.planReview = {
    KINDS, SPEC, VALUES, GROUPS, SPLITS, RESTS, MINUTES, MAX, MAX_MOVES, LOOK, PART_INFO, WD,
    available, engine, open, context, compact, planLines, personLines, claudeAsk, deviceMessages, listSchema, schema, grammar, readJson,
    normalize, prepare, trial, validate, ownTitle, ask, run, current, stamp, apply, last, undo, forReport, fromReport, why, dayLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
