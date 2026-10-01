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
 *   testsOk       whether the all-out left vs right tests run
 *   mobilityIds   a light day's mobility flow
 *   adjustSession one pass over each built session: warm-up, balance and floor practice, power,
 *                 rest, cool-down, and flare days (a gentle range-of-motion session instead)
 * The UI reads the words from here too (plannedAround, planLines, CONDITIONS).
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

  /* ================================================================== conditions */
  // Offered in set-up ("Anything we should plan around?") and Settings. `plan` says what changes,
  // `doctor` when to check first. Pregnancy is left out on purpose: exercise in pregnancy needs a
  // midwife's or doctor's say for each person (ACOG 2020), which an app can't give.
  const CONDITIONS = [
    { id: 'ra', name: 'Rheumatoid arthritis', short: 'rheumatoid arthritis', flare: true,
      plan: 'Joint-friendly moves with no weight on your hands, gentle range of motion every session, and a flare-day option.' },
    { id: 'oa', name: 'Osteoarthritis', short: 'osteoarthritis', joints: true, flare: true,
      plan: 'Low impact, strength around the joints, and no deep loaded bending for sore knees or hips.' },
    { id: 'osteo', name: 'Osteoporosis or low bone density', short: 'osteoporosis',
      plan: 'No bending or twisting your spine under load, balance work, and strength that keeps progressing.',
      doctor: 'If you\'ve broken a bone in a minor fall, check with your doctor or physio before you start.' },
    { id: 'back', name: 'Ongoing low back pain', short: 'low back pain',
      plan: 'Bird dogs, side planks and walking, and no heavy loads on your back for the first 8 weeks.' },
    { id: 'bp', name: 'High blood pressure', short: 'high blood pressure',
      plan: 'Breathe out on every effort, never hold your breath, and no head-down positions.',
      doctor: 'If it isn\'t under control yet, check with your doctor before you start.' },
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
  const conditions = (p) => (p && Array.isArray(p.conditions) ? p.conditions.filter((id) => BY_ID[id]) : []);

  // The rules a profile brings, worked out once per distinct set of answers.
  let memo = { key: null, r: null };
  function rulesOf(p) {
    const list = conditions(p);
    const key = [list.join(), (p && p.oaJoints || []).join(), p && p.floorOk, p && p.age, p && p.jumpsOk].join('|');
    if (memo.key === key) return memo.r;
    const c = new Set(list);
    const oa = new Set(c.has('oa') ? (p.oaJoints && p.oaJoints.length ? p.oaJoints : ['knee', 'hip']) : []);
    const r = {
      c, oa, band: band(p),
      any: list.length > 0 || p.floorOk === false,
      seated: c.has('seated'),
      noFloor: c.has('seated') || p.floorOk === false,
      // Jumping and slamming: never with these; from 50 only if you turn it on.
      noImpact: ['ra', 'oa', 'osteo', 'balance', 'seated', 'heart'].some((x) => c.has(x)),
    };
    memo = { key, r };
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
    if (m.ballistic && (c.has('osteo') || c.has('heart') || spineBack)) return 'Fast, jerky loading';
    if (m.deep && (r.oa.has('knee') || r.oa.has('hip'))) return 'Deep knee and hip bend';
    if (m.pos === 'kneel' && r.oa.has('knee')) return 'Kneeling on your knees';
    if (m.overhead && m.load && r.oa.has('shoulder')) return 'Weight overhead';
    if (m.headDown && (c.has('bp') || c.has('heart'))) return 'Head below your heart';
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
  // The left vs right tests are all-out sets: not with a heart condition or high blood pressure,
  // and the leg test (split squats) not seated, with balance problems, sore knees or from 65.
  // Neither runs while a joint it loads is on a break (S.pain, on `day`) or marked careful: the leg
  // test loads knees, hips and ankles, the arm test elbows, wrists and shoulders.
  const TEST_JOINTS = { leg: ['knee', 'hip', 'ankle'], arm: ['elbow', 'wrist', 'shoulder'] };
  function testsOk(S, kind, day) {
    const p = S.profile;
    const r = rulesOf(p);
    if (r.c.has('heart') || r.c.has('bp') || r.seated) return false;
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
    for (const it of first) { it.skill = true; it.rest = 45; }
    // (A sore joint can swap the floor practice into the balance ladder: one of a move is enough.)
    s.items = first.filter((it, i) => !first.slice(0, i).some((x) => x.moveId === it.moveId) && !s.items.some((x) => x.moveId === it.moveId)).concat(s.items);
    // Power: on the first leg day of the week, the squat is fast on the way up.
    if (!c.custom && powerOn(p) && c.tplIdx === c.legIdx) {
      for (const it of s.items) {
        if (it.fam !== 'squat') continue;
        const pw = Object.values(M().MOVES).find((m) => m.powerOf === it.moveId);
        if (pw && M().allowed(pw, B().eqFor(S, day)) && moveOk(p, pw.id, day)) { it.moveId = pw.id; it.name = pw.name; it.power = true; it.load = B().loadInfo(S, pw, day, it.fam); }
      }
    }
    // A little more rest from 50 (auto rest only).
    const plus = restPlus(p);
    if (plus && !c.custom && p.prefs && (p.prefs.rest === 'auto' || p.prefs.rest == null)) for (const it of s.items.concat(s.extras || [])) if (!it.skill) it.rest += plus;
    // Cool-down: every session from 65, seated, and with rheumatoid arthritis. It's stretches for the
    // muscles the day worked when at least two suit this body; seated plans and rheumatoid arthritis
    // (range of motion, wrists included) have one of their own.
    if (mobilityEvery(p) || (s.mobility && s.mobility.length)) {
      const own = (s.mobility && s.mobility.length ? s.mobility : B().cooldownItems(S, day, s.items, s.short)).filter((mb) => moveOk(p, mb.moveId, day));
      s.mobility = r.seated || r.c.has('ra') || own.length < 2 ? flowItems(S, 'mobility', cooldownIds(p), day) : own;
    }
    if (mobilityEvery(p)) s.keepMobility = true;
    // No all-out finishers with a heart condition or high blood pressure: 30 s on, 30 s off at most.
    if (s.finisher && (r.c.has('heart') || r.c.has('bp'))) { s.finisher.work = Math.min(s.finisher.work, 30); s.finisher.rest = Math.max(s.finisher.rest, 30); }
    // Under 30, the finisher changes more often: a different one of the rungs you've reached.
    if (s.finisher && r.band === 'young' && s.finisher.fam === 'finisher') {
      const avoid = sore(S, day);
      const list = B().rungs(S, 'finisher', day).filter((x) => spares(M().MOVES[x], avoid));
      const top = Math.min(list.length, Math.max(1, list.indexOf(s.finisher.moveId) + 2));
      const id = list.slice(0, top)[(day + (c.tplIdx || 0)) % top];
      if (id && id !== s.finisher.moveId) { const m = M().MOVES[id]; Object.assign(s.finisher, { moveId: id, name: m.name, uni: !!m.uni, load: B().loadInfo(S, m, day, 'finisher') }); }
    }
    const notes = sessionNotes(p);
    if (notes.length) s.notes = (s.notes || []).concat(notes);
    return s;
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
    if (r.c.has('bp') || r.c.has('heart')) out.push({ kind: 'breathe', text: 'Breathe out as you push or lift. Never hold your breath.' });
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
    if (b === 'young') out.push({ kind: 'age', text: 'Under 30: reps climb a little faster and finishers change more often.' });
    if (b === 'older') out.push({ kind: 'age', text: `From 50: longer warm-ups, a little more rest, balance twice a week and fast sit-to-stands or squats once a week.${r.noImpact || p.gentle ? '' : p.jumpsOk ? '' : ' Jumping stays off unless you turn it on.'}` });
    if (b === 'senior') out.push({ kind: 'age', text: `From 65: balance practice every session, chair-supported moves first, low impact and a cool-down every time. Strength still keeps progressing.${getupOn(p) ? ' Once a week you practise getting down to the floor and up, with a chair.' : ''}` });
    for (const id of conditions(p)) {
      const c = BY_ID[id];
      let text = c.plan;
      if (id === 'oa' && r.oa.size) text = `${text} Joints: ${joinList(OA_JOINTS.filter(([j]) => r.oa.has(j)).map(([, t]) => t.toLowerCase()))}.`;
      out.push({ kind: 'condition', id, text: `${c.name}: ${text}` });
    }
    if (p.floorOk === false && !r.seated) out.push({ kind: 'floor', text: 'Nothing on the floor: standing and seated versions instead.' });
    return out;
  }
  function doctorLines(p) {
    return conditions(p).map((id) => BY_ID[id].doctor).filter(Boolean);
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
    if (items.some((it) => it.fam === 'getup')) out.push({ icon: 'arrow-up-right', tone: 'green', text: 'Down to the floor and up, with a chair', why: 'Once a week, so getting up after a fall is practised.', rule: 'floor' });
    if (items.some((it) => it.power)) out.push({ icon: 'bolt', tone: 'amber', text: 'Squats fast on the way up today', why: 'Power fades faster than strength from 50. Up fast, down slow.', rule: 'power' });
    const stand = items.filter((it) => { const m = M().MOVES[it.moveId]; return m && M().LADDERS[m.family] && M().LADDERS[m.family].alt && m.family !== 'balance' && m.family !== 'getup'; });
    if (stand.length) out.push({ icon: 'shuffle', tone: 'coral', text: stand.length === 1 ? `${stand[0].name} in place of the usual move` : `${stand.length} moves swapped for versions that suit you`, why: plannedAround(p) ? `${plannedAround(p)}.` : 'Your answers rule the usual moves out.', rule: rulesOf(p).seated ? 'seated' : 'arthritis' });
    if ((s.notes || []).some((n) => n.kind === 'breathe')) out.push({ icon: 'heart', tone: 'rose', text: 'Breathe out on every effort', why: 'Holding your breath while you strain makes blood pressure spike.', rule: 'pressure' });
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
    if (!lines.length) return 'Your plan isn\'t shaped around any health condition right now. If something applies, like arthritis, low back pain, balance problems or high blood pressure, add it under Settings, Your answers, Anything we should plan around, and the plan works around it.';
    return `${around}. ${lines.join(' ')}${doc.length ? ` ${doc.join(' ')}` : ''} If a move hurts, stop, and say so after your workout: moves that load that joint are swapped out.`;
  }

  GH.access = {
    BANDS, CONDITIONS, OA_JOINTS, STAND_IN, BACK_WEEKS,
    band, conditions, rulesOf, why, moveOk, program, filterRungs, famFor, startRung, repStep, testsOk,
    balancePerWeek, getupOn, powerOn, restPlus, mobilityEvery, flareOk, flareOn, mobilityIds, warmupIds, adjustSession,
    plannedAround, planLines, doctorLines, briefLine, decisions, setHint, answer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
