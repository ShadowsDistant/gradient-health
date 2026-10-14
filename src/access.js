/* Plans for different bodies: how age and health conditions shape the plan.
 *
 * The brain (src/brain.js) calls in at a few hooks, each tolerant of this file being missing:
 *   program       age and condition defaults on top of the questionnaire (impact, warm-up length,
 *                 a gentler start, balance as a trained skill)
 *   filterRungs   the moves a person's rules allow, and the stand-in ladders that stay closed until
 *                 a plan needs them
 *   famFor        which ladder fills a slot when a condition rules out a whole ladder (push-ups with
 *                 painful wrists: seated band presses), or when a gentler one suits better
 *   startRung     where a ladder starts (sit to stand from 65, a hand on the wall for balance)
 *   repStep       how fast reps climb (a little faster under 30, smaller steps from 50)
 *   repRange      the rep range a condition sets (osteoporosis, type 2 diabetes, diabetic eye disease)
 *   testsOk       whether the all-out left vs right tests run
 *   mobilityIds   a light day's mobility flow (and the impact block for bones on light days)
 *   strengthDays  which of the week's days train strength (type 2 diabetes: 3 at most, spread out)
 *   adjustSession one pass over each built session: warm-up, balance and floor practice, impact for
 *                 bones, back extensions, power, rest, cool-down, and flare days (a gentle
 *                 range-of-motion session instead)
 * The rules that change which days train what (power on every leg day and muscles that aren't goals
 * twice a week from 60, impact and back extensions with osteoporosis, type 2 diabetes's days) start
 * with S.rulesFrom (newRules): a state from before 1.13 keeps the earlier ones to the end of the week
 * it's first loaded in, so no week reshuffles under someone halfway through.
 * The UI reads the words from here too (plannedAround, planLines, CONDITIONS, FOLLOW_UPS).
 *
 * Nothing here is medical advice. The rules follow published exercise guidance for each group (see
 * src/data/science.js, 'Age and health'), lean to the safe side, and say when to check with a
 * doctor. Conditions stay on this phone: they are never sent to Claude.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const M = () => GH.moves;
  const B = () => GH.brain;

  /* ================================================================== age */
  // Four bands. 30 to 49 is the app's baseline; the others shift the defaults.
  const BANDS = {
    young: { name: 'Under 30', short: 'under 30' },
    mid: { name: '30 to 49', short: '30 to 49' },
    older: { name: '50 to 64', short: '50 to 64' },
    senior: { name: '65 and over', short: '65 and over' },
  };
  function band(p) {
    const a = Number(p && p.age);
    if (!(a >= 13 && a <= 110)) return 'mid';
    return a < 30 ? 'young' : a < 50 ? 'mid' : a < 65 ? 'older' : 'senior';
  }
  const from50 = (p) => { const b = band(p); return b === 'older' || b === 'senior'; };
  // The age itself, for the rules that start at 60 and 75 (null when it isn't one).
  const ageOf = (p) => { const a = Number(p && p.age); return a >= 13 && a <= 110 ? a : null; };
  const from60 = (p) => ageOf(p) >= 60;

  /* ================================================================== conditions */
  // Offered in set-up ("Anything to plan around?") and Settings. `plan` says what changes,
  // `doctor` when to check first. Pregnancy is left out on purpose: exercise in pregnancy needs a
  // midwife's or doctor's say for each person (ACOG 2020), which an app can't give.
  const CONDITIONS = [
    { id: 'ra', name: 'Rheumatoid arthritis', short: 'rheumatoid arthritis', flare: true,
      plan: 'No weight on your hands, gentle range of motion every session, and a flare-day option.' },
    { id: 'oa', name: 'Osteoarthritis', short: 'osteoarthritis', joints: true, flare: true,
      plan: 'Low impact, strength around the joints, and no deep loaded bending for sore knees or hips.' },
    { id: 'osteo', name: 'Osteoporosis or low bone density', short: 'osteoporosis',
      plan: 'Strength that builds to heavier sets, back extensions for posture, balance work, and no bending or twisting your spine under load.' },
    { id: 'back', name: 'Ongoing low back pain', short: 'low back pain',
      plan: 'Bird dogs, side planks and walking, and no heavy loads on your back for the first 8 weeks.' },
    { id: 'bp', name: 'High blood pressure', short: 'high blood pressure',
      plan: 'Breathe out on every effort, never hold your breath, and no head-down positions.',
      doctor: 'If it isn\'t under control yet, check with your doctor before you start.' },
    { id: 'diabetes', name: 'Type 2 diabetes', short: 'type 2 diabetes',
      plan: 'Strength on 2 or 3 days a week, not back to back, with walks between. Breathe out on every effort.',
      doctor: 'If you take insulin or a medicine that can cause low blood sugar, ask your doctor about timing, and keep some fast-acting sugar with you.' },
    { id: 'balance', name: 'Balance problems or falls', short: 'balance',
      plan: 'Balance practice every session with a hand on the wall, seated and supported moves, and no quick footwork.' },
    { id: 'seated', name: 'Wheelchair, or can\'t stand for long', short: 'a seated plan',
      plan: 'Every exercise seated. Skip any leg move your legs don\'t do.' },
    { id: 'hands', name: 'Hand or wrist pain', short: 'hand and wrist pain',
      plan: 'No weight on your hands and no tight grip: self-resisted and band-loop versions instead.' },
    { id: 'heart', name: 'A heart condition', short: 'a heart condition',
      plan: 'A gentler start, easy cardio and no all-out efforts.',
      doctor: 'Check with your doctor before you start.' },
  ];
  const BY_ID = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));
  // Joints osteoarthritis can affect, as asked in set-up.
  const OA_JOINTS = [['knee', 'Knees'], ['hip', 'Hips'], ['hand', 'Hands'], ['back', 'Lower back'], ['shoulder', 'Shoulders']];
  // The question a condition brings in set-up and Settings, its answer kept in the profile under
  // `key` ('yes', 'no' or 'unsure'). No answer yet counts as not sure, and not sure as yes: the
  // safer plan until someone knows.
  const ANSWERS = [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']];
  const FOLLOW_UPS = {
    osteo: { key: 'fractures', q: 'Have you broken a bone in your spine, or more than one bone in a minor fall?', label: 'Broken bones',
      foot: 'If not, a short impact block on most days helps your bones. If so, or if you\'re not sure, impact stays at brisk walking.' },
    diabetes: { key: 'retinopathy', q: 'Do you have diabetic eye disease (retinopathy)?', label: 'Diabetic eye disease',
      foot: 'If so, or if you\'re not sure, sets stay at 10 to 15 reps, with no heavy lifting, jumping or head-down moves.' },
  };
  const conditions = (p) => (p && Array.isArray(p.conditions) ? p.conditions.filter((id) => BY_ID[id]) : []);

  // The rules a profile brings, worked out once per distinct set of answers.
  let memo = { key: null, r: null, p: null, op: null };
  function rulesOf(p) {
    // The same profile within one week plan or session build (nothing changes it during one).
    const op = GH.brain && GH.brain.opToken ? GH.brain.opToken() : null;
    if (op && p === memo.p && memo.op === op) return memo.r;
    const list = conditions(p);
    const key = [list.join(), (p && p.oaJoints || []).join(), p && p.floorOk, p && p.age, p && p.jumpsOk, p && p.fractures, p && p.retinopathy].join('|');
    if (memo.key === key) { memo.p = p; memo.op = op; return memo.r; }
    const c = new Set(list);
    const oa = new Set(c.has('oa') ? (p.oaJoints && p.oaJoints.length ? p.oaJoints : ['knee', 'hip']) : []);
    // Diabetic eye disease, or not sure (or not asked yet): no heavy sets, jumping, jarring or
    // head-down moves (Kanaley et al. 2022).
    const retino = c.has('diabetes') && p.retinopathy !== 'no';
    const r = {
      c, oa, band: band(p), retino,
      any: list.length > 0 || p.floorOk === false,
      seated: c.has('seated'),
      noFloor: c.has('seated') || p.floorOk === false,
      // Osteoporosis with a broken bone in the spine or several in minor falls, or not sure: impact
      // stays at brisk walking (Brooke-Wavell et al. 2022).
      fragile: c.has('osteo') && p.fractures !== 'no',
      // Jumping and slamming: never with these; from 50 only if you turn it on.
      noImpact: ['ra', 'oa', 'osteo', 'balance', 'seated', 'heart'].some((x) => c.has(x)) || retino,
    };
    memo = { key, r, p, op };
    return r;
  }
  // Low back pain rules out heavy spinal loading for the first 8 weeks after it's added.
  const BACK_WEEKS = 8;
  function backEarly(p, day) {
    const since = p.conditionsSince && p.conditionsSince.back != null ? p.conditionsSince.back : p.startDay;
    return since == null || day == null || day - since < BACK_WEEKS * 7;
  }

  // Why a move doesn't suit this body right now (null = fine). Short, for the Moves tab.
  function why(p, m, day) {
    if (!m) return null;
    const r = rulesOf(p);
    if (!r.any) return null;
    const c = r.c, spine = m.spine || [];
    const spineBack = c.has('back') || r.oa.has('back');
    if (r.seated && m.pos !== 'seat') return 'Not done sitting down';
    if (r.noFloor && ['floor', 'kneel', 'low'].includes(m.pos)) return 'Gets down on the floor';
    if (m.hands && (c.has('hands') || ((c.has('ra') || r.oa.has('hand')) && !m.support))) return 'Weight on your hands';
    if (c.has('hands') && m.grip && m.grip !== 'loop') return 'Needs a firm grip';
    if ((c.has('ra') || r.oa.has('hand')) && (m.grip === 'hang' || m.grip === 'pull')) return 'A hard grip on small joints';
    if (m.quick && ['ra', 'oa', 'balance', 'osteo', 'heart', 'seated'].some((x) => c.has(x))) return 'Quick footwork';
    if (c.has('balance') && m.oneLeg && !m.support) return 'Balancing with nothing to hold';
    if (c.has('osteo') && spine.some((s) => s === 'flex' || s === 'flexLoad' || s === 'twist' || s === 'twistLoad')) return 'Bends or twists your spine';
    if (spineBack && spine.some((s) => s === 'flexLoad' || s === 'twistLoad')) return 'Bends or twists your spine under load';
    if (spineBack && spine.includes('load') && (r.oa.has('back') || backEarly(p, day))) return 'Heavy load on your back, for now';
    if (m.ballistic && (c.has('osteo') || c.has('heart') || spineBack || r.retino)) return 'Fast, jerky loading';
    if (m.deep && (r.oa.has('knee') || r.oa.has('hip'))) return 'Deep knee and hip bend';
    if (m.pos === 'kneel' && r.oa.has('knee')) return 'Kneeling on your knees';
    if (m.overhead && m.load && r.oa.has('shoulder')) return 'Weight overhead';
    if (m.headDown && (c.has('bp') || c.has('heart') || r.retino)) return 'Head below your heart';
    return null;
  }
  const moveOk = (p, id, day) => !why(p, M().MOVES[id], day);

  /* ================================================================== program */
  function program(p, prog) {
    const r = rulesOf(p);
    const b = r.band;
    // Jumping: on by default under 50 (unless switched off), opt-in from 50, never with a
    // condition that rules impact out.
    prog.impactOk = !p.gentle && !r.noImpact && p.impactOk !== false && (!from50(p) || p.jumpsOk === true);
    // Longer warm-ups from 50.
    prog.warmupMin = b === 'senior' ? 6 : b === 'older' ? 5 : b === 'mid' && p.age >= 40 ? 4 : 2.5;
    // A heart condition starts like "a doctor told me to take it easy": lower volume, eased in.
    if (r.c.has('heart') && !p.gentle) {
      for (const g of Object.keys(prog.start)) prog.start[g] = Math.max(prog.floor[g], Math.round(prog.start[g] * 0.75));
      prog.onramp = { weeks: 2, mult: 0.7 };
    }
    prog.mobilityEvery = mobilityEvery(p);
    prog.band = b;
    return prog;
  }

  /* ================================================================== ladders */
  // The ladder that stands in when every rung of a usual one is ruled out.
  const STAND_IN = {
    push: 'pushAlt', chestDb: 'pushAlt', row: 'rowAlt', pull: 'rowAlt', rear: 'rowAlt', raise: 'raiseAlt',
    curl: 'curlAlt', triceps: 'triAlt', squat: 'legSeat', hinge: 'hipAlt', glute: 'hipAlt',
    abs: 'coreAlt', absLoad: 'coreAlt', coreRot: 'coreAlt', coreSide: 'coreAlt', finisher: 'finGentle',
    press: 'raiseAlt', calf: 'legSeat', hamCurl: 'hipAlt', backExt: 'hipAlt',
    pressG: 'pushAlt', inclineG: 'pushAlt', flyG: 'pushAlt', rowG: 'rowAlt', pullG: 'rowAlt', rearG: 'rowAlt',
    ohpG: 'raiseAlt', raiseG: 'raiseAlt', curlG: 'curlAlt', triG: 'triAlt', squatG: 'legSeat', hingeG: 'hipAlt', gluteG: 'hipAlt', absG: 'coreAlt', cardioG: 'finGentle',
    lungeG: 'legSeat', legCurlG: 'hipAlt', legExtG: 'legSeat', calfG: 'legSeat',
  };
  // Gentler ladders used even when the usual one has rungs left.
  function prefer(p) {
    const r = rulesOf(p);
    const out = {};
    if (r.c.has('back') || r.oa.has('back')) out.coreRot = 'coreAlt';
    if (['heart', 'balance', 'seated', 'ra'].some((x) => r.c.has(x))) { out.finisher = 'finGentle'; out.cardioG = 'finGentle'; }
    return out;
  }
  function altOpen(S, fam, day) {
    const p = S.profile;
    if (fam === 'balance') return balancePerWeek(p) > 0;
    if (fam === 'getup') return getupOn(p);
    if (fam === 'impact') return impactOn(p) && newRules(S, day);
    const pref = prefer(p);
    if (Object.values(pref).includes(fam)) return true;
    const gym = B().placeOf(S, day) === 'gym';
    for (const [main, alt] of Object.entries(STAND_IN)) {
      if (alt !== fam || !M().LADDERS[main] || (M().LADDERS[main].gym && !gym)) continue;
      if (ruledOut(S, main, day) || bare(S, main, day)) return true;
    }
    return false;
  }
  // A ladder the person's body rules out, as opposed to one their equipment does.
  const ruledOut = (S, fam, day) => !B().rungs(S, fam, day).length && B().rungs(S, fam, day, { noRules: true }).length > 0;
  // A home ladder whose whole muscle group has nothing left here, for any reason (no kit, no
  // floor, the body's rules): the group's stand-in takes over, so no group goes untrained because
  // of what's in the room. (Stand-ins themselves aren't asked, which would ask this again.)
  function bare(S, fam, day) {
    const lad = M().LADDERS[fam];
    if (!lad || lad.gym || lad.alt || B().rungs(S, fam, day).length) return false;
    for (const [f, l] of Object.entries(M().LADDERS)) {
      if (l.group === lad.group && !l.gym && !l.alt && B().rungs(S, f, day).length) return false;
    }
    return true;
  }
  function filterRungs(S, fam, list, day) {
    const lad = M().LADDERS[fam];
    if (lad && lad.alt && !altOpen(S, fam, day)) return [];
    const p = S.profile;
    // Impact for bones never lands on a joint an old injury made careful.
    if (fam === 'impact') list = list.filter((id) => spares(M().MOVES[id], p.careful || []));
    if (!rulesOf(p).any) return list;
    return list.filter((id) => !why(p, M().MOVES[id], day));
  }
  function famFor(S, fam, day) {
    const p = S.profile;
    const pref = prefer(p)[fam];
    if (pref && B().rungs(S, pref, day).length) return pref;
    if (!ruledOut(S, fam, day) && !bare(S, fam, day)) return fam;
    const alt = STAND_IN[fam];
    return alt && B().rungs(S, alt, day).length ? alt : fam;
  }
  // Where a ladder starts for this body (null: the brain's usual choice).
  function startRung(S, fam, list) {
    const p = S.profile;
    const r = rulesOf(p);
    const b = r.band;
    let prefs = [];
    if (fam === 'balance') prefs = r.seated ? ['bal_seat_reach'] : r.c.has('balance') || b === 'senior' ? ['bal_tandem_wall', 'bal_one_wall', 'bal_seat_reach'] : ['bal_tandem', 'bal_tandem_wall'];
    else if (fam === 'squat' && r.c.has('balance')) prefs = ['sq_sts_hands', 'sq_sts'];
    else if (fam === 'squat' && (b === 'senior' || r.c.has('heart'))) prefs = ['sq_sts', 'sq_sts_hands'];
    else if (fam === 'push' && (b === 'senior' || r.c.has('heart'))) prefs = ['push_wall', 'push_incline'];
    else if (fam === 'coreAlt' && (r.c.has('back') || r.oa.has('back'))) prefs = ['co_birddog', 'co_pelvic', 'co_wall_plank'];
    else if (fam === 'coreAlt') prefs = r.seated ? ['co_seat_brace'] : ['co_wall_plank', 'co_birddog', 'co_seat_brace'];
    return prefs.find((id) => list.includes(id)) || null;
  }

  /* ================================================================== progression */
  // How many reps (or seconds) a good set adds (rir: the reps-in-reserve answer, '3' or '12'). Under
  // 30 an easy set (3+ left) adds a little more; from 50, and with a heart condition, steps are
  // smaller, so loads climb more slowly.
  function repStep(p, base, timed, rir) {
    const b = band(p);
    const unit = timed ? 5 : 1;
    if (b === 'young') return rir === '3' ? base + unit : base;
    if (b === 'older' || b === 'senior' || rulesOf(p).c.has('heart')) return Math.max(unit, base - unit);
    return base;
  }
  // The left vs right tests are all-out sets: not with a heart condition, high blood pressure or
  // diabetic eye disease, and the leg test (split squats) not seated, with balance problems, sore
  // knees or from 65.
  // Neither runs while a joint it loads is on a break (S.pain, on `day`) or marked careful: the leg
  // test loads knees, hips and ankles, the arm test elbows, wrists and shoulders.
  const TEST_JOINTS = { leg: ['knee', 'hip', 'ankle'], arm: ['elbow', 'wrist', 'shoulder'] };
  function testsOk(S, kind, day) {
    const p = S.profile;
    const r = rulesOf(p);
    if (r.c.has('heart') || r.c.has('bp') || r.seated || r.retino) return false;
    const joints = TEST_JOINTS[kind] || [];
    if ((p.careful || []).some((j) => joints.includes(j))) return false;
    if (day != null && Object.entries(S.pain || {}).some(([j, until]) => until >= day && joints.includes(j))) return false;
    if (kind === 'arm') return !r.c.has('hands') && !r.c.has('ra');
    return !r.c.has('balance') && !r.oa.has('knee') && !r.oa.has('hip') && r.band !== 'senior';
  }

  /* ================================================================== session extras */
  // Sessions a week with balance practice: every one from 65 and with balance problems, two from 50
  // or with osteoporosis.
  function balancePerWeek(p) {
    const r = rulesOf(p);
    if (r.band === 'senior' || r.c.has('balance')) return 7;
    if (r.band === 'older' || r.c.has('osteo') || r.seated) return 2;
    return 0;
  }
  // Getting down to the floor and up, with a chair, once a week from 65 or with balance problems,
  // unless the floor is hard, you plan seated, or your knees would take it badly.
  function getupOn(p) {
    const r = rulesOf(p);
    if (!(r.band === 'senior' || r.c.has('balance'))) return false;
    return !r.noFloor && !r.oa.has('knee') && !r.c.has('ra');
  }
  // Fast on the way up once a week from 50 (not with a heart condition or seated).
  const powerOn = (p) => from50(p) && !rulesOf(p).c.has('heart') && !rulesOf(p).seated;
  // Extra rest between sets (auto rest only): 15 s from 50, 30 s from 65.
  const restPlus = (p) => (band(p) === 'senior' ? 30 : band(p) === 'older' ? 15 : 0);
  // A cool-down every session: from 65, and range of motion daily with rheumatoid arthritis.
  function mobilityEvery(p) { const r = rulesOf(p); return r.band === 'senior' || r.c.has('ra') || r.seated; }
  const flareOk = (p) => conditions(p).some((id) => BY_ID[id].flare);
  const flareOn = (S, day) => flareOk(S.profile) && !!(S.feel && S.feel[day] && S.feel[day].flare);

  /* ================================================================== when 1.13's rules start */
  // Weeks before S.rulesFrom keep the rules from before 1.13 (see the top of this file): a state
  // saved before 1.13 gets the week after it's first loaded (the migration in src/optimizer.js), a
  // new state its first week. A week planned under the earlier rules hands its split a copy of the
  // profile marked legacyRules (src/brain.js weekInputs), and the trial weeks a split is scored on
  // carry the mark too. Safety rules (diabetic eye disease) never wait for it.
  const oldRules = (S, ws) => !!S && (!!(S.profile && S.profile.legacyRules) || (S.rulesFrom != null && ws != null && ws < S.rulesFrom));
  // (No day: from now on.)
  const newRules = (S, day) => !oldRules(S, day == null ? null : B().weekStart(day));
  // Whether 1.13's rules change anything for these answers: src/optimizer.js files a split under it,
  // so one worked out under either set of rules never stands in for the other.
  const rulesKey = (p) => (from60(p) || ['osteo', 'diabetes'].some((x) => conditions(p).includes(x)) ? (p.legacyRules ? 'old' : 'new') : null);

  /* ================================================================== power */
  // Fast on the way up (Balachandran et al. 2022): from 50 the squat on the week's first leg day, as
  // before 1.13; from 60 one or two lower-body moves (sit to stand, squats, step-ups, the leg press)
  // in every session that trains legs. From 75, with balance problems or when a doctor said to take
  // it easy, one move a session and the safest one: sit to stand, pushing up with the hands. Never
  // with a heart condition or in a seated plan (powerOn). Loads stay moderate and each set stops
  // while the reps are still quick, which the fast moves' first cue says.
  function powerPlan(p) {
    if (!powerOn(p)) return null;
    if (!from60(p) || p.legacyRules) return { every: false, max: 1, safest: false };
    const safest = ageOf(p) >= 75 || rulesOf(p).c.has('balance') || !!p.gentle;
    return { every: true, max: safest ? 1 : 2, safest };
  }
  const SAFEST = 'sq_sts_hands_power';
  // The moves that had a fast version before 1.13: the weeks planned then, and 50 to 59, keep to them.
  const FAST_BEFORE = ['sq_sts', 'sq_bw', 'sq_goblet'];
  // A move's fast-up version (src/data/moves-access.js powerOf), by the move.
  let FAST = null;
  function fastOf(id) {
    if (!FAST) { FAST = {}; for (const m of Object.values(M().MOVES)) if (m.powerOf) FAST[m.powerOf] = m.id; }
    return FAST[id] || null;
  }
  // From 60, a session's power work: its own leg moves done fast where they have a fast version (the
  // squat first, up to plan.max), else a fast move of its own when `extra`: the fast version of the
  // squat level you're on or the nearest below it, or a fast leg press at the gym. From 75 (with
  // balance problems, or taking it easy) it's always the safest: the day's sit to stand with the
  // hands done fast, else that as a move of its own. Returns a move of its own to add, if any.
  function addPower(S, s, day, plan, extra) {
    const p = S.profile;
    const legs = s.items.filter((it) => !it.skill && it.kind === 'move' && it.group === 'legs');
    if (!legs.length) return null;
    const eq = B().eqFor(S, day);
    const avoid = sore(S, day);
    const usable = (id) => !!id && !!M().MOVES[id] && M().allowed(M().MOVES[id], eq) && moveOk(p, id, day) && spares(M().MOVES[id], avoid) && !s.items.some((x) => x.moveId === id);
    const fast = (it, id) => { const m = M().MOVES[id]; Object.assign(it, { moveId: id, name: m.name, power: true, load: B().loadInfo(S, m, day, it.fam) }); };
    if (plan.safest) {
      const it = legs.find((x) => x.moveId === M().MOVES[SAFEST].powerOf);
      if (it && usable(SAFEST)) { fast(it, SAFEST); return null; }
      return extra && usable(SAFEST) ? powerItem(S, s, SAFEST, day) : null;
    }
    let n = 0;
    const squat = (it) => (it.fam === 'squat' || it.fam === 'squatG' ? 1 : 0);
    for (const it of legs.slice().sort((a, b) => squat(b) - squat(a))) {
      if (n >= plan.max) break;
      const id = fastOf(it.moveId);
      if (usable(id)) { fast(it, id); n++; }
    }
    if (n || !extra) return null;
    const lad = M().LADDERS.squat.rungs;
    const at = S.prog.squat ? lad.indexOf(S.prog.squat.rung) : -1;
    const near = lad.slice(0, at + 1).reverse().map(fastOf).filter(Boolean);
    const id = (B().placeOf(S, day) === 'gym' ? ['leg_press_power'] : []).concat(near, ['sq_goblet_power', 'sq_stepup_power', 'sq_bw_power', 'sq_sts_power', SAFEST]).find(usable);
    return id ? powerItem(S, s, id, day) : null;
  }
  // A fast move of its own: 2 sets (1 on a short day) after the warm-up practice, of the move's
  // fewest reps, or your usual reps when it's the fast version of the level you're on (it counts as
  // that level, src/brain.js progress, so a short set mustn't move it on). Its group is power, so
  // it adds nothing to a muscle group's weekly sets.
  function powerItem(S, s, id, day) {
    const m = M().MOVES[id];
    const st = S.prog && S.prog[m.family];
    const usual = st && st.rung === m.powerOf ? st.reps : null;
    return {
      kind: 'move', fam: m.family, moveId: id, name: m.name, group: 'power', sets: s.short ? 1 : 2, target: Math.max(m.range[0], Math.min(m.range[1], usual || 6)),
      timed: false, uni: !!m.uni, rest: 60, load: B().loadInfo(S, m, day, m.family), swappedFrom: null, superset: null, power: true, skill: true,
    };
  }

  /* ================================================================== bones */
  // With osteoporosis and no break in the spine or several in minor falls (profile.fractures 'no'),
  // an impact block on most days, light days included: 10 heel drops, stamps or jogging steps on
  // the spot at a time with a short walk between, for about 2.5 minutes, 50 or more in all
  // (Brooke-Wavell et al. 2022; the 'impact' ladder in src/data/moves.js, on the calf raise and march
  // figures). Not with a break or when not sure (brisk walking is their impact), nor wherever another
  // rule keeps impact out: another condition that does, a seated plan, a doctor's "take it easy", or
  // jumping switched off. Low hops aren't offered: they'd need a figure of their own.
  function impactOn(p) {
    const r = rulesOf(p);
    if (!r.c.has('osteo') || r.fragile || p.legacyRules) return false;
    if (['ra', 'oa', 'balance', 'seated', 'heart'].some((x) => r.c.has(x)) || r.retino) return false;
    return !p.gentle && p.impactOk !== false;
  }
  // The landings an impact block of `secs` holds: rounds of the move's landings at its tempo, each
  // followed by 15 seconds' walk (m.impacts: landings a round, landings a rep of the figure).
  function impactCount(m, secs) {
    if (!m || !m.impacts) return 0;
    const [n, perRep] = m.impacts;
    const one = M().secPerRep(m) / perRep;
    const round = n * one + 15;
    return Math.floor(secs / round) * n + Math.min(n, Math.floor((secs % round) / one));
  }
  // Back extensions for posture twice a week with osteoporosis (the backExt ladder: bird dog,
  // superman hold, floor back extension), on the days balance practice comes twice a week.
  const postureOn = (p) => rulesOf(p).c.has('osteo') && !p.legacyRules;
  // Osteoporosis, after the on-ramp: a muscle group's main move takes up to 3 sets before its other
  // moves that day keep more than one, building to 3 sets an exercise; the group's sets for the
  // day stay as planned.
  function boneSets(s) {
    const MAIN = B().HOME_COMPOUND.concat(B().MAIN_LIFTS);
    const by = {};
    for (const it of s.items) if (!it.skill && it.kind === 'move' && B().GROUPS.includes(it.group)) (by[it.group] = by[it.group] || []).push(it);
    for (const list of Object.values(by)) {
      const main = list.find((it) => MAIN.includes(it.fam));
      if (!main) continue;
      for (const it of list.slice().reverse()) while (it !== main && main.sets < 3 && it.sets > 1) { it.sets--; main.sets++; }
    }
  }
  // Whether the on-ramp is over by `day`'s week, counted as the calendar counts it (src/brain.js
  // replay): as many weeks with a workout done as the on-ramp has, and no week off since. No day:
  // as of now.
  function rampedUp(S, day) {
    const need = ((B().programFor(S.profile) || {}).onramp || {}).weeks || 0;
    const ws = day != null ? B().weekStart(day) : Infinity;
    const weeks = new Set();
    let last = -Infinity;
    for (const l of S.log || []) if (l && l.type === 'workout' && l.day < ws && B().isDone(l)) { weeks.add(B().weekStart(l.day)); last = Math.max(last, l.day); }
    if (weeks.size < need) return false;
    return !(Number.isFinite(ws) && Number.isFinite(last) && ws - last >= 8);
  }
  // [a, b] fitted to a move's own range: within the move's counts where they overlap, at least two
  // reps wide where the move allows.
  function within(m, a, b) {
    const [lo, hi] = m.range;
    const L = Math.max(a, Math.min(b, lo));
    let H = Math.max(a, Math.min(b, hi));
    if (H < L + 2) H = Math.max(L, Math.min(hi, L + 2));
    return [L, H];
  }
  // The rep range a condition sets for a move, or null for the usual (src/brain.js rangeFor asks
  // first). Diabetic eye disease, or not sure: 10 to 15 reps, never heavy, from the day it's picked
  // (a safety rule). Once the on-ramp is done (from these rules' start): with osteoporosis, main
  // moves toward the heaviest load you can lift 8 to 12 times (Brooke-Wavell et al. 2022); with type
  // 2 diabetes, main moves in heavier sets of about 8 to 10 (Kanaley et al. 2022), where a strength
  // goal's heavier range stays. `day` is the session's (a workout in progress's when not given).
  function repRange(S, m, fam, day) {
    if (!S || !S.profile || !m || m.timed || !Array.isArray(m.range) || !B().GROUPS.includes(m.group)) return null;
    const p = S.profile;
    const r = rulesOf(p);
    const osteo = r.c.has('osteo'), diabetes = r.c.has('diabetes');
    if (!osteo && !diabetes) return null;
    if (r.retino) return within(m, 10, 15);
    if (!B().HOME_COMPOUND.includes(fam) && !B().MAIN_LIFTS.includes(fam)) return null;
    const d = day != null ? day : S.active && S.active.day != null ? S.active.day : null;
    if (!newRules(S, d) || !rampedUp(S, d)) return null;
    if (osteo) return within(m, 8, 12);
    const top = (p.goals || []).slice(0, 2);
    if (top.includes('strength') && ((B().MAIN_LIFTS.includes(fam) && m.load) || B().HOME_COMPOUND.includes(fam))) return null;
    return within(m, 8, 10);
  }
  // Strength that builds toward heavier sets for bones: osteoporosis, whatever the answer about
  // breaks. The reps-left target (src/brain.js) asks for 1 or 2 left on main sets once the on-ramp
  // is done.
  const boneLoad = (p) => conditions(p).includes('osteo');

  /* ================================================================== strength days */
  // Type 2 diabetes: strength on 2 or 3 days a week, not back to back where it can be helped
  // (Kanaley et al. 2022). With more days set, the 3 of them most spread out (Monday, Wednesday and
  // Friday when no days are picked); the others are light days, a walk and a short mobility flow.
  // wk: { days, weekdays } as the schedule has them; returns the same shape.
  function strengthDays(p, wk) {
    if (!p || p.legacyRules || !rulesOf(p).c.has('diabetes')) return wk;
    const D = Math.max(2, Math.min(6, Math.round(Number(wk.days)) || 2));
    if (D <= 3) return wk;
    if (!(Array.isArray(wk.weekdays) && wk.weekdays.length >= 2)) return { days: 3, weekdays: null };
    return { days: 3, weekdays: spreadOut(B().weekdaysFor({ days: D, weekdays: wk.weekdays }), 3) };
  }
  // The k of these weekdays (0-6, in order) with the fewest back-to-back pairs (Sunday to Monday
  // counts), then the widest smallest gap, then the earliest.
  function spreadOut(days, k) {
    let best = null;
    const rec = (i, acc) => {
      if (acc.length === k) {
        const gaps = acc.map((d, j) => (j ? d - acc[j - 1] : d + 7 - acc[acc.length - 1]));
        const c = [gaps.filter((g) => g <= 1).length, -Math.min(...gaps)];
        if (!best || c[0] < best.c[0] || (c[0] === best.c[0] && c[1] < best.c[1])) best = { c, acc: acc.slice() };
        return;
      }
      for (let j = i; j < days.length; j++) { acc.push(days[j]); rec(j + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return best ? best.acc : days.slice(0, k);
  }

  const FLOW = (k) => ((M().FLOWS || {})[k] || []);
  function warmupIds(p) {
    const r = rulesOf(p);
    if (r.seated) return FLOW('warmSeat');
    if (from50(p) || ['ra', 'oa', 'balance', 'heart', 'osteo', 'back'].some((x) => r.c.has(x))) return FLOW('warmGentle');
    return null;
  }
  function cooldownIds(p) {
    const r = rulesOf(p);
    if (r.seated) return FLOW('coolSeat');
    if (r.c.has('ra')) return FLOW('rom').slice(0, 4);
    return FLOW('coolStand');
  }
  // A light day's mobility flow, from the stretches the brain picked for the muscles trained lately
  // (src/brain.js mobilityFlow): seated plans get a seated flow instead, and a list a condition
  // leaves too short a standing one.
  function mobilityIds(S, picks, day) {
    const p = S.profile;
    const r = rulesOf(p);
    // Light days are at home: what the home kit allows, nothing for a joint on a break.
    const avoid = sore(S, day);
    const fits = (id) => M().MOVES[id] && moveOk(p, id, day) && M().allowed(M().MOVES[id], B().eqAt(S, 'home')) && spares(M().MOVES[id], avoid);
    let ids;
    if (r.seated) ids = FLOW('mobilitySeat');
    else {
      ids = (picks || M().MOBILITY).filter(fits);
      if (ids.length < 4) ids = FLOW('mobilityStand');
    }
    ids = ids.filter(fits);
    // Balance most days: from 65 and with balance problems, a light day has a balance hold too.
    if (balancePerWeek(p) >= 7 && !r.seated) {
      const bal = B().rungs(S, 'balance', p.startDay || 0).filter((x) => spares(M().MOVES[x], avoid));
      const st = S.prog && S.prog.balance;
      const id = st && bal.includes(st.rung) && M().MOVES[st.rung].timed ? st.rung : bal.find((x) => M().MOVES[x].timed);
      if (id && !ids.includes(id)) ids = ids.concat(id);
    }
    // The impact block for bones comes first (osteoporosis with no break, impactOn): most days means
    // light days too.
    if (impactOn(p) && newRules(S, day)) {
      const list = B().rungs(S, 'impact', day).filter((x) => spares(M().MOVES[x], avoid));
      const st = S.prog && S.prog.impact;
      const id = st && list.includes(st.rung) ? st.rung : list[0];
      if (id && !ids.includes(id)) ids = [id].concat(ids);
    }
    return ids;
  }

  // Joints on a break today (a sore joint ticked after a workout, or Tailor's "my knee hurts").
  const sore = (S, day) => Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
  const spares = (m, joints) => !(m.joints || []).some((j) => joints.includes(j));
  function flowItems(S, kind, ids, day, o) {
    const opt = o || {};
    const eq = B().eqFor(S, day);
    const avoid = sore(S, day);
    return ids.filter((id) => M().MOVES[id] && M().allowed(M().MOVES[id], eq) && moveOk(S.profile, id, day) && spares(M().MOVES[id], avoid)).map((id) => {
      const m = M().MOVES[id];
      const target = opt.short ? Math.min(m.start, 20) : opt.long && m.timed ? m.range[1] : m.start;
      return { kind, moveId: id, name: m.name, timed: !!m.timed, target, uni: !!m.uni, load: B().loadInfo(S, m, day) };
    });
  }

  // One pass over a built session (before it's fitted to the time budget).
  // ctx: { tplIdx, days (sessions a week), legIdx (the first leg day's template index), custom (a
  // plan the person wrote, src/customplan.js: its exercises, sets and rests stay as written, so it
  // only gets the warm-up, cool-down, flare days and notes) }
  function adjustSession(S, s, day, ctx) {
    const p = S.profile;
    const r = rulesOf(p);
    const c = ctx || {};
    if (flareOn(S, day)) return flareSession(S, s, day);
    // Warm-up: gentle and a little longer from 50 and with most conditions, seated when seated.
    const wu = warmupIds(p);
    if (wu) {
      const list = flowItems(S, 'warmup', wu, day, { short: s.short, long: r.band === 'senior' });
      // Plus one of the day's own warm-up moves (leg swings before a leg day, say) that suits this body.
      const own = !r.seated && (s.warmup || []).find((w) => !list.some((x) => x.moveId === w.moveId) && moveOk(p, w.moveId, day));
      if (own) list.push(Object.assign({}, own, { extra: true })); // the first thing to go when time is short
      s.warmup = s.short ? list.slice(0, 2) : list;
    } else s.warmup = s.warmup.filter((w) => moveOk(p, w.moveId, day));
    // Balance and floor practice come first, while you're fresh.
    const first = [];
    const per = c.custom ? 0 : balancePerWeek(p);
    const D = c.days || 3;
    const balanceDays = per >= 7 ? null : [0, Math.floor(D / 2)];
    if (per > 0 && (!balanceDays || balanceDays.includes(c.tplIdx))) {
      const it = B().itemFor(S, { fam: 'balance', sets: s.short ? 1 : 2, group: 'balance' }, day);
      if (it) first.push(it);
    }
    if (!c.custom && getupOn(p) && c.tplIdx === D - 1 && !s.short) {
      const it = B().itemFor(S, { fam: 'getup', sets: 1, group: 'balance' }, day);
      if (it) first.push(it);
    }
    // From these rules' start, with osteoporosis: the impact block for bones (impactOn), and back
    // extensions for posture on the days balance comes twice a week (not when the day has one).
    const fresh = !c.custom && newRules(S, day);
    if (fresh && impactOn(p)) {
      const it = B().itemFor(S, { fam: 'impact', sets: 1, group: 'impact' }, day);
      if (it) { it.bone = true; first.push(it); }
    }
    if (fresh && postureOn(p) && [0, Math.floor(D / 2)].includes(c.tplIdx) && !s.items.some((x) => x.fam === 'backExt') && B().rungs(S, 'backExt', day).length) {
      const it = B().itemFor(S, { fam: 'backExt', sets: s.short ? 1 : 2, group: 'posture' }, day);
      if (it && M().MOVES[it.moveId].family === 'backExt') first.push(it);
    }
    // Simpler sessions (fewer exercises) keep room for two main moves: balance first, then impact.
    if (fresh && S.complexity > 0) {
      const rank = (it) => (it.fam === 'balance' ? 0 : it.bone ? 1 : it.fam === 'getup' ? 2 : 3);
      const keep = first.slice().sort((a, x) => rank(a) - rank(x)).slice(0, (S.complexity === 1 ? 5 : 4) - 2);
      for (let i = first.length - 1; i >= 0; i--) if (!keep.includes(first[i])) first.splice(i, 1);
    }
    for (const it of first) { it.skill = true; it.rest = 45; }
    for (const it of first) if (it.bone) it.rest = 30; // a short walk between rounds
    // (A sore joint can swap the floor practice into the balance ladder: one of a move is enough.)
    s.items = first.filter((it, i) => !first.slice(0, i).some((x) => x.moveId === it.moveId) && !s.items.some((x) => x.moveId === it.moveId)).concat(s.items);
    // Osteoporosis, after the on-ramp: main moves build to 3 sets.
    if (fresh && r.c.has('osteo') && !(s.phase && s.phase.onramp)) boneSets(s);
    // Power from 60: every session that trains legs (addPower), its own fast move after the warm-up
    // practice when none of the day's leg moves has a fast version (not in simpler sessions).
    const pp = c.custom ? null : powerPlan(p);
    const every = !!(pp && pp.every && fresh);
    if (every) {
      const own = addPower(S, s, day, pp, !(S.complexity > 0));
      if (own) { const at = s.items.findIndex((x) => !x.skill); s.items.splice(at < 0 ? s.items.length : at, 0, own); }
    }
    // Power from 50 (and in weeks planned before 1.13): on the first leg day of the week, the squat
    // is fast on the way up.
    if (pp && !every && c.tplIdx === c.legIdx) {
      for (const it of s.items) {
        if (it.fam !== 'squat' || !FAST_BEFORE.includes(it.moveId)) continue;
        const pw = Object.values(M().MOVES).find((m) => m.powerOf === it.moveId);
        if (pw && M().allowed(pw, B().eqFor(S, day)) && moveOk(p, pw.id, day)) { it.moveId = pw.id; it.name = pw.name; it.power = true; it.load = B().loadInfo(S, pw, day, it.fam); }
      }
    }
    // A little more rest from 50 (auto rest only).
    const plus = restPlus(p);
    if (plus && !c.custom && (B().autoRest ? B().autoRest(S) : p.prefs && (p.prefs.rest === 'auto' || p.prefs.rest == null))) for (const it of s.items.concat(s.extras || [])) if (!it.skill) it.rest += plus;
    // Cool-down: every session from 65, seated, and with rheumatoid arthritis. It's stretches for the
    // muscles the day worked when at least two suit this body; seated plans and rheumatoid arthritis
    // (range of motion, wrists included) have one of their own.
    if (mobilityEvery(p) || (s.mobility && s.mobility.length)) {
      const own = (s.mobility && s.mobility.length ? s.mobility : B().cooldownItems(S, day, s.items, s.short)).filter((mb) => moveOk(p, mb.moveId, day));
      s.mobility = r.seated || r.c.has('ra') || own.length < 2 ? flowItems(S, 'mobility', cooldownIds(p), day) : own;
    }
    if (mobilityEvery(p)) s.keepMobility = true;
    if (s.finisher) adjustFinisher(S, s.finisher, day, c.tplIdx || 0);
    const notes = sessionNotes(p);
    if (notes.length) s.notes = (s.notes || []).concat(notes);
    return s;
  }
  // A finisher's limits, wherever it's added (here, or when src/optimizer.js finds time for one):
  // no all-out intervals with a heart condition, high blood pressure or diabetic eye disease (30 s
  // on, 30 s off at most), and under 30 a different one of the rungs you've reached, so it changes
  // more often. Run once per finisher (it marks it).
  function adjustFinisher(S, f, day, tplIdx) {
    if (!f || f.adjusted) return f;
    const r = rulesOf(S.profile);
    if (r.c.has('heart') || r.c.has('bp') || r.retino) { f.work = Math.min(f.work, 30); f.rest = Math.max(f.rest, 30); }
    if (r.band === 'young' && f.fam === 'finisher') {
      const avoid = sore(S, day);
      const list = B().rungs(S, 'finisher', day).filter((x) => spares(M().MOVES[x], avoid));
      const top = Math.min(list.length, Math.max(1, list.indexOf(f.moveId) + 2));
      const id = list.slice(0, top)[(day + (tplIdx || 0)) % top];
      if (id && id !== f.moveId) { const m = M().MOVES[id]; Object.assign(f, { moveId: id, name: m.name, uni: !!m.uni, load: B().loadInfo(S, m, day, 'finisher') }); }
    }
    f.adjusted = true;
    return f;
  }
  function flareSession(S, s, day) {
    s.flare = true;
    s.title = 'Gentle range of motion';
    s.warmup = []; s.items = []; s.extras = []; s.tests = []; s.finisher = null;
    s.mobility = flowItems(S, 'mobility', FLOW('rom'), day);
    s.keepMobility = true;
    s.notes = (s.notes || []).concat({ kind: 'flare', text: 'Flare day: gentle range of motion only. Move within what feels easy, and stop anything that hurts.' });
    return s;
  }
  function sessionNotes(p) {
    const r = rulesOf(p);
    const out = [];
    if (r.c.has('bp') || r.c.has('heart') || r.c.has('diabetes')) out.push({ kind: 'breathe', text: 'Breathe out as you push or lift. Never hold your breath.' });
    if (r.c.has('heart')) out.push({ kind: 'effort', text: 'Stop every set with 2 or 3 reps still in you.' });
    return out;
  }

  /* ================================================================== words */
  const joinList = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  // "Planned around: age 72, balance and rheumatoid arthritis" (null when nothing shifts).
  function plannedAround(p) {
    const parts = [];
    const b = band(p);
    if (b !== 'mid' && p.age) parts.push(`age ${p.age}`);
    for (const id of conditions(p)) parts.push(BY_ID[id].short);
    if (p.floorOk === false && !conditions(p).includes('seated')) parts.push('staying off the floor');
    return parts.length ? `Planned around ${joinList(parts)}` : null;
  }
  // What's different in the plan, one line each (set-up summary, Plan tab).
  function planLines(p) {
    const out = [];
    const b = band(p);
    const r = rulesOf(p);
    const pp = powerPlan(p);
    const jumps = r.noImpact || p.gentle ? '' : p.jumpsOk ? '' : ' Jumping stays off unless you turn it on.';
    if (b === 'young') out.push({ kind: 'age', text: 'Under 30: reps climb a little faster and finishers change more often.' });
    if (b === 'older' && !from60(p)) out.push({ kind: 'age', text: `From 50: longer warm-ups, a little more rest, balance twice a week and fast sit-to-stands or squats once a week.${jumps}` });
    if (b === 'older' && from60(p)) out.push({ kind: 'age', text: `From 60: longer warm-ups, a little more rest, balance twice a week${pp ? ', fast reps on every leg day' : ''} and muscles that aren't goals trained twice a week.${jumps}` });
    if (b === 'senior') out.push({ kind: 'age', text: `From 65: balance practice every session, chair-supported moves first, low impact and a cool-down every time. ${!pp ? '' : pp.safest ? 'Every leg day has fast sit-to-stands, hands on the seat. ' : 'Every leg day has fast reps. '}Muscles that aren't goals train twice a week, and strength keeps progressing.${getupOn(p) ? ' Once a week you practise getting down to the floor and up, with a chair.' : ''}` });
    for (const id of conditions(p)) {
      const c = BY_ID[id];
      let text = c.plan;
      if (id === 'oa' && r.oa.size) text = `${text} Joints: ${joinList(OA_JOINTS.filter(([j]) => r.oa.has(j)).map(([, t]) => t.toLowerCase()))}.`;
      // (Diabetic eye disease keeps sets light, so osteoporosis's heavier sets don't apply.)
      if (id === 'osteo') text = `${r.retino ? 'Back extensions for posture, balance work, and no bending or twisting your spine under load.' : text}${impactOn(p) ? ' A short impact block on most days: heel drops, stamps or jogging on the spot.' : r.fragile ? ' Impact stays at brisk walking.' : ''}`;
      if (id === 'diabetes') text = `${text}${r.retino ? ' Sets stay at 10 to 15 reps, with no heavy lifting, jumping or head-down moves.' : ' After the first easier weeks, your main moves build to heavier sets of about 8 to 10 reps.'}`;
      out.push({ kind: 'condition', id, text: `${c.name}: ${text}` });
    }
    if (p.floorOk === false && !r.seated) out.push({ kind: 'floor', text: 'Nothing on the floor: standing and seated versions instead.' });
    return out;
  }
  // When to check with a doctor first. Osteoporosis's depends on the answer about breaks, and
  // diabetic eye disease (or not being sure) adds its own.
  const DOCTOR = {
    fracture: 'With a broken bone in your spine or from a minor fall, check with your doctor or physio before you start.',
    fractureUnsure: 'Not sure about past breaks? Ask your doctor. Until you know, impact stays at brisk walking.',
    eyes: 'With diabetic eye disease, check with your eye doctor before you start.',
    eyesUnsure: 'Not sure about your eyes? Ask at your next eye check. Until then, sets stay light.',
  };
  function doctorLines(p) {
    const r = rulesOf(p);
    const out = [];
    for (const id of conditions(p)) {
      if (id === 'osteo') out.push(p.fractures === 'yes' ? DOCTOR.fracture : p.fractures === 'no' ? null : DOCTOR.fractureUnsure);
      else out.push(BY_ID[id].doctor);
      if (id === 'diabetes' && r.retino) out.push(p.retinopathy === 'yes' ? DOCTOR.eyes : DOCTOR.eyesUnsure);
    }
    return out.filter(Boolean);
  }
  // For the on-device coach's brief: one plain line (never sent to Claude).
  function briefLine(p) {
    const list = conditions(p).map((id) => BY_ID[id].short);
    const b = band(p);
    const bits = [];
    if (b !== 'mid') bits.push(`age band ${BANDS[b].short}`);
    if (list.length) bits.push(`planned around ${joinList(list)}`);
    return bits.length ? bits.join('; ') : null;
  }

  // What today's session does because of age or health, for the coach's list of decisions (same
  // shape as GH.coach.decisions: icon, tone, text, why, and the How it works rule behind it).
  function decisions(S, s) {
    const p = S.profile;
    const out = [];
    if (!s) return out;
    if (s.flare) return [{ icon: 'refresh', tone: 'coral', text: 'Flare day: gentle range of motion instead', why: 'You said your joints are flaring. The plan picks up again tomorrow.', rule: 'arthritis' }];
    const items = s.items || [];
    if (items.some((it) => it.fam === 'balance')) out.push({ icon: 'compass', tone: 'teal', text: 'Balance practice first', why: rulesOf(p).c.has('balance') ? 'You said balance is a problem, so it starts every session, with a hand on the wall.' : band(p) === 'senior' ? 'From 65 it starts every session.' : 'From 50 it comes twice a week.', rule: 'balance' });
    if (items.some((it) => it.fam === 'getup')) out.push({ icon: 'arrow-up-right', tone: 'green', text: 'Down to the floor and up, with a chair', why: 'Once a week, to practise getting up after a fall.', rule: 'floor' });
    if (items.some((it) => it.bone)) out.push({ icon: 'bolt', tone: 'violet', text: 'An impact block for your bones', why: 'Heel drops, stamps or jogging on the spot on most days help keep bones strong.', rule: 'bones' });
    if (items.some((it) => it.group === 'posture')) out.push({ icon: 'person', tone: 'violet', text: 'Back extensions for posture', why: 'Twice a week, for the muscles that hold your back straight.', rule: 'bones' });
    if (items.some((it) => it.power)) {
      out.push(from60(p) && newRules(S, s.day)
        ? { icon: 'bolt', tone: 'amber', text: 'Fast on the way up today', why: 'From 60, every leg day has fast reps: up quick, down slow, stopping while they\'re still quick.', rule: 'power' }
        : { icon: 'bolt', tone: 'amber', text: 'Squats fast on the way up today', why: 'Power fades faster than strength from 50. Up fast, down slow.', rule: 'power' });
    }
    const stand = items.filter((it) => { const m = M().MOVES[it.moveId]; return m && M().LADDERS[m.family] && M().LADDERS[m.family].alt && m.family !== 'balance' && m.family !== 'getup' && m.family !== 'impact'; });
    if (stand.length) out.push({ icon: 'shuffle', tone: 'coral', text: stand.length === 1 ? `${stand[0].name} in place of the usual move` : `${stand.length} moves swapped for versions that suit you`, why: plannedAround(p) ? `${plannedAround(p)}.` : 'Your answers rule the usual moves out.', rule: rulesOf(p).seated ? 'seated' : 'arthritis' });
    if ((s.notes || []).some((n) => n.kind === 'breathe')) out.push({ icon: 'heart', tone: 'rose', text: 'Breathe out on every effort', why: 'Holding your breath while you strain makes blood pressure spike.', rule: ['bp', 'heart'].some((x) => rulesOf(p).c.has(x)) || !rulesOf(p).c.has('diabetes') ? 'pressure' : 'diabetes' });
    else if (band(p) !== 'mid' && band(p) !== 'young' && s.warmup && s.warmup.length >= 3) out.push({ icon: 'sun', tone: 'amber', text: 'A longer, gentler warm-up', why: `From ${band(p) === 'senior' ? '65' : '50'}, with a little more rest between sets too.`, rule: 'age' });
    return out;
  }
  // The line under a set in the workout player, when age or health changes how to do it.
  function setHint(p, it, timed) {
    const c = rulesOf(p).c;
    if (it && it.power) return 'Up as fast as you can, then lower slowly.';
    if (timed) return c.has('bp') || c.has('heart') ? 'Hold with good form, and keep breathing the whole time.' : null;
    if (c.has('heart')) return 'Stop with 2 or 3 reps left. Breathe out as you push.';
    if (c.has('bp')) return 'Breathe out as you push, and never hold your breath. Stop with 1-3 reps left.';
    return null;
  }
  // The on-device coach's answer to "is this OK with my arthritis?" and the like.
  function answer(p, q) {
    const t = String(q || '').toLowerCase();
    if (/pregnan/.test(t)) return 'This plan isn\'t built for pregnancy. Exercise is encouraged in most pregnancies, but your midwife or doctor should say what\'s right for you first.';
    const lines = planLines(p).map((l) => l.text);
    const around = plannedAround(p);
    const doc = doctorLines(p);
    if (!lines.length) return 'Your plan isn\'t shaped around any health condition right now. To add one, like arthritis or high blood pressure, go to Settings, Your answers, Anything to plan around.';
    return `${around}. ${lines.join(' ')}${doc.length ? ` ${doc.join(' ')}` : ''} If a move hurts, stop, and say so after your workout: moves that load that joint are swapped out.`;
  }

  GH.access = {
    BANDS, CONDITIONS, OA_JOINTS, STAND_IN, BACK_WEEKS,
    band, conditions, rulesOf, why, moveOk, program, filterRungs, famFor, startRung, repStep, testsOk,
    balancePerWeek, getupOn, powerOn, restPlus, mobilityEvery, flareOk, flareOn, mobilityIds, warmupIds, adjustSession, adjustFinisher, cooldownIds, flowItems,
    plannedAround, planLines, doctorLines, briefLine, decisions, setHint, answer,
  };
  // 1.13: the questions a condition brings, when the new rules start, power, bones, rep ranges and
  // strength days (boneLoad is what the reps-left target asks).
  Object.assign(GH.access, {
    FOLLOW_UPS, ANSWERS, ageOf, oldRules, newRules, rulesKey, powerPlan, impactOn, impactCount, postureOn, rampedUp, repRange, strengthDays, boneLoad,
  });
})(typeof window !== 'undefined' ? window : globalThis);
