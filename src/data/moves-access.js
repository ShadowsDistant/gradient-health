/* Moves for every body: seated, supported, balance and joint-friendly exercises, gentle cardio and
 * range-of-motion moves, so a plan can work around age and health conditions (see src/access.js).
 * Loads right after moves.js and adds to GH.moves: its forms, moves and ladders, plus warm-ups,
 * cool-downs and flows for different bodies.
 *
 * It also says what every move asks of the body, the ones in moves.js included, so the plan can
 * leave out what a condition rules out. Tags (all optional except pos):
 *   pos       where the body is: 'stand', 'seat' (on a chair, bench seat or machine seat), 'floor'
 *             (lying or sitting on the floor), 'kneel' (on the floor on the knees), 'low' (hips down
 *             near the floor, like chair dips), 'bench' (lying on a bench) or 'hang'
 *   hands     body weight rests on the hands (push-ups, planks on hands, dips)
 *   grip      'hang' (hanging from a bar), 'pull' (pulling hard on a towel or an edge), 'hold' (holding
 *             a weight or a band's handles), 'loop' (a band looped over the hands: no grip needed)
 *   spine     list of: 'flex' (curling the spine), 'flexLoad' (curling it under load), 'twist'
 *             (turning it), 'twistLoad' (turning it under load), 'load' (a heavy load through a
 *             bent-over or loaded spine)
 *   headDown  the head goes below the heart
 *   quick     quick footwork (jumps, fast feet)
 *   oneLeg    balance on one leg, a narrow stance or a step, with nothing to hold
 *   support   a hand stays on a chair or a wall the whole time
 *   deep      deep bending of the knee or hip under load (deep squats, lunges)
 *   overhead  arms overhead, with a load or hanging
 *   powerOf   a fast-up version of another move (the same rung for progression)
 *   alt       (ladders) used only when a person's plan needs it: seated plans, painful hands, no floor
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const MV = GH.moves;
  if (!MV) throw new Error('moves-access: load moves.js first');
  const F = MV.FORMS, MOVES = MV.MOVES, LADDERS = MV.LADDERS;

  /* ------------------------------------------------------------------ helpers (as in moves.js) */
  const ce = (a, b, o = {}) => [
    { to: b, ms: o.con || 1000, hold: o.holdB != null ? o.holdB : 250, ph: 'con' },
    { to: a, ms: o.ecc || 2000, hold: o.holdA != null ? o.holdA : 300, ph: 'ecc' },
  ];
  const iso = (a, a2, ms = 2200) => [
    { to: a2, ms, hold: 0, ph: 'iso' },
    { to: a, ms, hold: 0, ph: 'iso' },
  ];
  const cyc = (names, ms, hold = 120, ph = 'move') => names.map((n) => ({ to: n, ms, hold, ph }));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const merge = (a, b) => {
    const out = clone(a);
    for (const [k, v] of Object.entries(b || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = clone(v);
    }
    return out;
  };
  const slowEcc = (rep, ms) => rep.map((s) => (s.ph === 'ecc' ? Object.assign({}, s, { ms }) : s));
  const fastCon = (rep, ms) => rep.map((s) => (s.ph === 'con' ? Object.assign({}, s, { ms }) : s));
  const pauseAt = (rep, ph, ms) => rep.map((s) => (s.ph === ph ? Object.assign({}, s, { hold: ms }) : s));

  function move(id, form, meta, variant) {
    const base = F[form];
    if (!base) throw new Error('moves-access: unknown form ' + form);
    if (MOVES[id]) throw new Error('moves-access: move ' + id + ' already exists');
    const m = merge(base, {});
    Object.assign(m, clone(meta));
    m.id = id; m.form = form;
    if (variant) {
      if (variant.ecc) m.rep = slowEcc(m.rep, variant.ecc);
      if (variant.con) m.rep = fastCon(m.rep, variant.con);
      if (variant.pause) m.rep = pauseAt(m.rep, variant.pause[0], variant.pause[1]);
    }
    if (!m.muscles) m.muscles = base.muscles;
    MOVES[id] = m;
    return m;
  }

  /* ------------------------------------------------------------------ what the moves in moves.js ask */
  const TAGS = {
    pos: {
      stand: 'curl_band curl_hammer curl_std curl_slow curl_half curl_1arm hammer_1arm tri_oh tri_band tri_oh_slow tri_oh1 push_wall push_incline sq_bw sq_goblet sq_goblet_pause sq_split sq_lunge sq_bulgarian sq_pistol sq_wallsit sq_jump hg_deadlift hg_swing hg_rdl hg_sldl hg_sldl_slow hg_swing1 row_towel row_band row_db row_chair row_slow row_pause row_half row_chair_half rear_towel rear_band rear_fly rear_fly_slow rear_fly_pause raise raise_band raise_slow raise_half raise_pause raise_lean rot_chop rot_slam rot_toss side_carry side_march fin_swing fin_swing1 fin_slam fin_toss fin_march fin_pulse fin_jacks wu_halo wu_circles wu_squat wu_angels mob_squat walk fly_cable rdl_bb deadlift_bb rdl_db squat_bb squat_smith calf_smith calf_db row_bb face_pull ohp_bb raise_cable curl_bb curl_cable pushdown_cable oh_ext_cable pallof incline_walk',
      seat: 'curl_towel curl_conc press_machine fly_pec leg_press leg_curl leg_ext pulldown row_cable rev_fly_machine ohp_db press_shoulder_machine bike_int',
      floor: 'tri_skull tri_diamond push_std push_slow push_pause push_decline push_archer chest_press chest_press_slow chest_fly chest_press1 chest_press_half hg_bridge hg_bridge1 gl_bridge gl_kbbridge gl_bridge1 gl_thrust gl_thrust_pause gl_thrust1 row_table rear_ytw rear_ytw_hold ab_deadbug ab_revcrunch ab_legraise ab_hollow ab_vup abl_crunch abl_kb abl_kb_slow abl_kb_arms abl_situp rot_russian rot_russian_up side_plank side_star fin_climbers fin_burpee rower_int',
      kneel: 'push_knee rot_kneel_chop side_knee mob_catcow mob_wgs mob_hipflexor mob_child cable_crunch',
      low: 'tri_dip_bent tri_dip',
      bench: 'bench_bb bench_db bench_smith incline_db incline_bb incline_smith fly_db thrust_bb row_chest curl_incline skull_ez cg_bench',
      hang: 'pull_hang pull_scap pull_neg pull_chin pull_up pull_slow hang_knee dip_bar',
    },
    hands: 'push_wall push_incline push_knee push_std push_slow push_pause push_decline push_archer tri_dip_bent tri_dip tri_diamond fin_climbers fin_burpee mob_catcow mob_wgs dip_bar',
    grip: {
      hang: 'pull_hang pull_scap pull_neg pull_chin pull_up pull_slow hang_knee',
      pull: 'curl_towel row_towel row_table rear_towel',
      hold: 'curl_band curl_hammer curl_std curl_slow curl_half curl_1arm hammer_1arm curl_conc tri_skull tri_oh tri_band tri_oh_slow tri_oh1 chest_press chest_press_slow chest_fly chest_press1 chest_press_half sq_goblet sq_goblet_pause hg_deadlift hg_swing hg_rdl hg_sldl hg_sldl_slow hg_swing1 gl_kbbridge gl_thrust gl_thrust_pause row_band row_db row_chair row_slow row_pause row_half row_chair_half rear_band rear_fly rear_fly_slow rear_fly_pause raise raise_band raise_slow raise_half raise_pause raise_lean abl_kb abl_kb_slow abl_kb_arms abl_situp rot_russian rot_russian_up rot_chop rot_kneel_chop rot_slam rot_toss side_carry side_march fin_swing fin_swing1 fin_slam fin_toss wu_halo bench_bb bench_db press_machine bench_smith incline_db incline_bb incline_smith fly_cable fly_pec fly_db squat_bb squat_smith rdl_bb deadlift_bb rdl_db thrust_bb calf_smith calf_db pulldown row_cable row_bb row_chest face_pull rev_fly_machine ohp_db ohp_bb press_shoulder_machine raise_cable curl_bb curl_incline curl_cable pushdown_cable oh_ext_cable skull_ez cg_bench cable_crunch pallof rower_int',
    },
    spine: {
      flex: 'ab_revcrunch ab_hollow abl_crunch rot_russian rot_russian_up mob_catcow mob_child hang_knee',
      flexLoad: 'ab_vup abl_kb abl_kb_slow abl_kb_arms abl_situp cable_crunch rot_slam fin_slam',
      twist: 'rot_russian rot_russian_up mob_wgs',
      twistLoad: 'rot_chop rot_kneel_chop',
      load: 'hg_deadlift hg_swing hg_swing1 hg_rdl hg_sldl hg_sldl_slow row_db row_slow row_pause row_half fin_swing fin_swing1 deadlift_bb rdl_bb rdl_db squat_bb squat_smith row_bb ohp_bb',
    },
    headDown: 'push_decline mob_child mob_wgs fin_burpee rot_slam fin_slam',
    quick: 'sq_jump fin_jacks fin_climbers fin_burpee fin_march',
    oneLeg: 'sq_split sq_lunge sq_bulgarian sq_pistol hg_rdl hg_sldl hg_sldl_slow side_march side_carry fin_march mob_hipflexor mob_wgs',
    support: 'push_wall raise_lean sq_wallsit wu_angels',
    deep: 'sq_goblet sq_goblet_pause sq_split sq_lunge sq_bulgarian sq_pistol sq_jump mob_squat squat_bb squat_smith leg_press',
    overhead: 'tri_oh tri_oh_slow tri_oh1 oh_ext_cable ohp_db ohp_bb press_shoulder_machine pull_hang pull_scap pull_neg pull_chin pull_up pull_slow hang_knee rot_toss fin_toss wu_halo rot_chop',
  };
  const words = (s) => s.split(/\s+/).filter(Boolean);
  function tag(list, key, value) {
    for (const id of words(list)) {
      const m = MOVES[id];
      if (!m) continue; // a move renamed or removed in moves.js: its tags go with it
      if (key === 'spine') m.spine = (m.spine || []).concat(value);
      else m[key] = value;
    }
  }
  for (const [pos, list] of Object.entries(TAGS.pos)) tag(list, 'pos', pos);
  for (const [g, list] of Object.entries(TAGS.grip)) tag(list, 'grip', g);
  for (const [s, list] of Object.entries(TAGS.spine)) tag(list, 'spine', [s]);
  for (const k of ['hands', 'headDown', 'quick', 'oneLeg', 'support', 'deep', 'overhead']) tag(TAGS[k], k, true);

  /* ------------------------------------------------------------------ seated, side view */
  // Sitting tall on a chair: hips 9 above the seat, feet flat on the floor in front of it. Planted
  // feet and hands use IK so they stay put whatever the torso does. A form keeps the same IK targets
  // in every keyframe (a target in one pose and not the next would hold the limb, then jump), so a
  // leg that lifts gets a lifted target, and a leg posed by angles is posed that way throughout.
  const SIT = { joint: 'hip', at: [0, -54] };
  const CHAIR = { type: 'chair', x: -26, w: 42, h: 45, back: -1 };
  const FOOT = [42, -8];
  const ON_THIGH = [24, -62];
  // Both feet planted (the far foot follows the near one's target).
  const sit = (o) => merge({ t: -2, n: 0, aN: { s: 6, e: 14 }, lN: { flat: true }, ik: { anN: FOOT } }, o || {});
  // The near leg works (posed by angles), the far foot stays planted.
  const sitWork = (o) => merge({ t: -2, n: 0, aN: { s: 6, e: 14 }, lF: { flat: true }, ik: { anF: FOOT } }, o || {});
  const DB2 = [{ type: 'db', hands: 'both', orient: 'end' }];
  const DB2S = [{ type: 'db', hands: 'both', orient: 'side' }];
  const ON_BELLY = [15, -77];

  // Legs.
  F.seatMarch = {
    view: 'side', pin: SIT, key: 'l', props: [CHAIR],
    poses: {
      a: sit({ aN: { s: 10, e: 88 }, lF: { flat: true }, ik: { anN: FOOT, anF: FOOT } }),
      l: sit({ aN: { s: -14, e: 90 }, aF: { s: 30, e: 88 }, lN: { flat: false, a: 10 }, lF: { flat: true }, ik: { anN: [46, -34], anF: FOOT } }),
      r: sit({ aN: { s: 30, e: 88 }, aF: { s: -14, e: 90 }, lN: { flat: true }, lF: { flat: false, a: 10 }, ik: { anN: FOOT, anF: [46, -34] } }),
    },
    rep: cyc(['l', 'a', 'r', 'a'], 520, 60), muscles: ['hipFlexors', 'quads', 'abs'], prime: 2,
  };
  F.seatKneeExt = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: {
      a: sitWork({ lN: { h: 81, k: 84, flat: false, a: 0 }, ik: { hdN: ON_THIGH } }),
      b: sitWork({ lN: { h: 88, k: 4, flat: false, a: 8 }, ik: { hdN: ON_THIGH } }),
    },
    rep: ce('a', 'b', { holdB: 600 }), muscles: ['quads'], uni: true, leadLimbs: ['lN'],
  };
  F.seatLegLift = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: {
      a: sitWork({ aN: { s: 8, e: 20 }, lN: { h: 52, k: 3, flat: false, a: 12 } }),
      b: sitWork({ aN: { s: 8, e: 20 }, lN: { h: 80, k: 3, flat: false, a: 12 } }),
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['quads', 'hipFlexors'], uni: true, leadLimbs: ['lN'],
  };
  F.seatHeel = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: {
      a: sit({ lN: { flat: false, fd: 90 }, ik: { anN: FOOT, hdN: ON_THIGH } }),
      b: sit({ lN: { flat: false, fd: 58 }, ik: { anN: [44.5, -15.8], hdN: ON_THIGH } }),
    },
    rep: ce('a', 'b', { holdB: 600, con: 800, ecc: 1400 }), muscles: ['calves'],
  };
  F.seatLegPress = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: [{ type: 'band', hands: 'both', from: 'toN' }],
    poses: {
      a: sitWork({ t: -6, aN: { s: 34, e: 112 }, lN: { h: 112, k: 116, flat: false, a: 20 } }),
      b: sitWork({ t: -6, aN: { s: 34, e: 112 }, lN: { h: 88, k: 4, flat: false, a: 10 } }),
    },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.seatHinge = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: { a: sit({ t: -2, ik: { anN: FOOT, hdN: [22, -61] } }), b: sit({ t: 40, n: -10, ik: { anN: FOOT, hdN: [38, -58] } }) },
    rep: ce('a', 'b', { holdB: 500, con: 1400, ecc: 1400 }), muscles: ['lowerBack', 'glutes', 'hamstrings'],
  };

  // Arms.
  F.seatCurl = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: DB2,
    poses: { a: sit({ aN: { s: 12, e: 18 } }), b: sit({ aN: { s: 18, e: 138 } }) },
    rep: ce('a', 'b'), muscles: ['biceps', 'forearms'],
  };
  F.seatHammer = merge(F.seatCurl, { equip: DB2S });
  F.seatBandCurl = merge(F.seatCurl, { equip: [{ type: 'band', hands: 'both', from: 'toN' }] });
  F.seatOhExt = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: [{ type: 'db', hands: 'both', orient: 'side' }],
    poses: { a: sit({ aN: { s: 172, e: 6 } }), b: sit({ aN: { s: 166, e: 128 } }) },
    rep: [{ to: 'b', ms: 2000, hold: 250, ph: 'ecc' }, { to: 'a', ms: 1000, hold: 300, ph: 'con' }], muscles: ['triceps'],
  };
  F.seatPress = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: DB2,
    poses: { a: sit({ aN: { s: 26, e: 146 } }), b: sit({ aN: { s: 168, e: 8 } }) },
    rep: ce('a', 'b'), muscles: ['frontDelts', 'sideDelts', 'triceps'],
  };
  // Leaning forward from the hips, upper arm along the body, the forearm straightens back.
  F.seatKickback = {
    view: 'side', pin: SIT, key: 'b', props: [merge(CHAIR, { x: -34 })], equip: [{ type: 'db', hands: 'both', orient: 'end' }],
    poses: { a: sit({ t: 38, n: -12, aN: { s: -8, e: 96 } }), b: sit({ t: 38, n: -12, aN: { s: -10, e: 6 } }) },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['triceps'],
  };

  // Back.
  F.seatRow = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR, { type: 'door', x: 104 }], equip: [{ type: 'band', hands: 'both', from: [104, -92] }],
    poses: { a: sit({ t: 2, aN: { s: 78, e: 4 } }), b: sit({ t: -4, aN: { s: -20, e: 104 } }) },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'], prime: 2,
  };
  F.seatBentRow = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: DB2S,
    poses: { a: sit({ t: 40, n: -12, aN: { s: 44, e: 6 } }), b: sit({ t: 40, n: -12, aN: { s: -14, e: 92 } }) },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'], prime: 2,
  };
  F.bladeSqueeze = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: { a: sit({ aN: { s: 4, e: 88 } }), b: sit({ t: -4, aN: { s: -28, e: 116 } }) },
    rep: ce('a', 'b', { holdB: 1500, con: 900, ecc: 1300 }), muscles: ['upperBack', 'rearDelts'],
  };
  F.seatPulldown = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR, { type: 'door', x: 44 }], equip: [{ type: 'band', hands: 'both', from: [44, -196] }],
    poses: { a: sit({ t: -6, aN: { s: 168, e: 6 } }), b: sit({ t: -8, aN: { s: 32, e: 124 } }) },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['lats', 'upperBack', 'biceps'],
  };

  // Cardio and mobility.
  F.seatBoxing = {
    view: 'side', pin: SIT, key: 'a', props: [CHAIR],
    poses: {
      a: sit({ aN: { s: 88, e: 4 }, aF: { s: 26, e: 128 } }),
      b: sit({ aN: { s: 26, e: 128 }, aF: { s: 88, e: 4 } }),
    },
    rep: cyc(['a', 'b'], 330, 60), muscles: ['frontDelts', 'chest', 'triceps'],
  };
  F.chinTuck = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: { a: sit({ n: -8, ik: { anN: FOOT, hdN: ON_THIGH } }), b: sit({ t: -3, n: 12, ik: { anN: FOOT, hdN: ON_THIGH } }) },
    rep: ce('a', 'b', { holdB: 1500, con: 900, ecc: 900 }), muscles: ['upperBack'],
  };
  F.wristCircles = {
    view: 'side', pin: SIT, key: 'a', props: [CHAIR],
    poses: { a: sit({ aN: { s: 12, e: 78, w: -38 } }), b: sit({ aN: { s: 12, e: 78, w: 36 } }) },
    rep: cyc(['b', 'a'], 900, 150), muscles: ['forearms'],
  };
  F.ankleCircles = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: {
      a: sitWork({ lN: { h: 78, k: 6, flat: false, a: -26 }, ik: { hdN: ON_THIGH } }),
      b: sitWork({ lN: { h: 78, k: 6, flat: false, a: 34 }, ik: { hdN: ON_THIGH } }),
    },
    rep: cyc(['b', 'a'], 950, 150), muscles: ['calves'], uni: true, leadLimbs: ['lN'],
  };
  F.seatHamStretch = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: {
      a: sitWork({ t: -2, aN: { s: 34, e: 40 }, lN: { h: 52, k: 3, flat: false, a: 16 } }),
      b: sitWork({ t: 30, n: -8, aN: { s: 46, e: 30 }, lN: { h: 84, k: 3, flat: false, a: 16 } }),
    },
    rep: iso('a', 'b', 2600), muscles: ['hamstrings'], uni: true, leadLimbs: ['lN'],
  };
  F.seatReach = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR],
    poses: { a: sit({ aN: { s: 88, e: 4 } }), b: sit({ t: 26, n: -6, aN: { s: 96, e: 2 } }) },
    rep: ce('a', 'b', { holdB: 1200, con: 1500, ecc: 1500 }), muscles: ['abs', 'lowerBack'],
  };

  // Core.
  F.seatBrace = {
    view: 'side', pin: SIT, key: 'a', props: [CHAIR],
    poses: { a: sit({ t: -2, ik: { anN: FOOT, hdN: ON_BELLY } }), a2: sit({ t: -3, ik: { anN: FOOT, hdN: ON_BELLY } }) },
    rep: iso('a', 'a2', 2400), muscles: ['abs', 'obliques'],
  };
  // Sitting forward on the seat, away from the backrest, feet a little further out.
  F.seatLean = {
    view: 'side', pin: { joint: 'hip', at: [8, -54] }, key: 'b', props: [merge(CHAIR, { x: -40 })],
    poses: { a: sit({ t: -2, ik: { anN: [52, -8], hdN: [34, -61] } }), b: sit({ t: -24, n: 12, ik: { anN: [52, -8], hdN: [30, -62] } }) },
    rep: ce('a', 'b', { holdB: 2500, con: 1600, ecc: 1600 }), muscles: ['abs', 'hipFlexors'],
  };

  /* ------------------------------------------------------------------ seated, front view */
  // Facing you on a chair: thighs point at you (drawn short), shins hang to the floor.
  const SIT_F = { joint: 'hip', at: [0, -54] };
  const CHAIR_F = { type: 'chair', x: -21, w: 42, h: 45 };
  const sitF = (o) => merge({ aN: { s: 10, e: 10 }, lN: { h: 6, k: 6 }, sc: { thN: 0.15, thF: 0.15 } }, o || {});
  const FRONT_HANDS = { hdN: 1, hdF: 1 }; // IK elbows out to the sides

  F.seatRaiseF = {
    view: 'front', pin: SIT_F, key: 'b', armLayer: 'front', legLayer: 'front', props: [CHAIR_F], equip: DB2,
    poses: { a: sitF({ aN: { s: 12, e: 10 } }), b: sitF({ aN: { s: 86, e: 12 } }) },
    rep: ce('a', 'b'), muscles: ['sideDelts'],
  };
  F.seatArmRaise = merge(F.seatRaiseF, { equip: [] });
  F.seatArmsOut = {
    view: 'front', pin: SIT_F, key: 'a', armLayer: 'front', legLayer: 'front', props: [CHAIR_F],
    poses: { a: sitF({ aN: { s: 86, e: 6 } }), a2: sitF({ aN: { s: 88, e: 6 } }) },
    rep: iso('a', 'a2', 2400), muscles: ['sideDelts', 'frontDelts'],
  };
  F.seatPullApart = {
    view: 'front', pin: SIT_F, key: 'b', armLayer: 'front', legLayer: 'front', props: [CHAIR_F],
    equip: [{ type: 'band', hands: 'both', between: true }],
    poses: {
      a: sitF({ sc: { uaN: 0.35, uaF: 0.35, faN: 0.35, faF: 0.35 }, aN: { s: 78, e: 0 } }),
      b: sitF({ sc: { uaN: 1, uaF: 1, faN: 1, faF: 1 }, aN: { s: 90, e: 2 } }),
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['rearDelts', 'upperBack'],
  };
  F.seatCircles = {
    view: 'front', pin: SIT_F, key: 'a', armLayer: 'front', legLayer: 'front', props: [CHAIR_F],
    poses: { a: sitF({ aN: { s: 84, e: 0 } }), b: sitF({ aN: { s: 94, e: 0 } }) },
    rep: cyc(['b', 'a'], 350, 0), muscles: ['sideDelts'],
  };
  // Arms crossed, hands on the opposite shoulders, turning from the ribs.
  F.seatTwist = {
    view: 'front', pin: SIT_F, key: 'l', armLayer: 'front', legLayer: 'front', props: [CHAIR_F], bend: FRONT_HANDS,
    poses: {
      m: sitF({ tw: 0, ik: { hdN: 'shF', hdF: 'shN' } }),
      l: sitF({ tw: 30, ik: { hdN: 'shF', hdF: 'shN' } }),
      r: sitF({ tw: -30, ik: { hdN: 'shF', hdF: 'shN' } }),
    },
    rep: [{ to: 'l', ms: 1400, hold: 600, ph: 'iso' }, { to: 'm', ms: 1000, hold: 0, ph: 'move' }, { to: 'r', ms: 1400, hold: 600, ph: 'iso' }, { to: 'm', ms: 1000, hold: 0, ph: 'move' }],
    muscles: ['obliques', 'upperBack'],
  };
  // Fingertips behind the head, elbows opening wide and easing back a little: a chest stretch.
  F.seatChestOpen = {
    view: 'front', pin: SIT_F, key: 'a', armLayer: 'front', legLayer: 'front', props: [CHAIR_F],
    poses: {
      a: sitF({ aN: { s: 132, e: 150 }, sc: { uaN: 1, uaF: 1 } }),
      a2: sitF({ aN: { s: 138, e: 150 }, sc: { uaN: 0.75, uaF: 0.75 } }),
    },
    rep: iso('a', 'a2', 2400), muscles: ['chest', 'frontDelts'],
  };
  // One elbow bent to a right angle, forearm pointing forward (drawn short, it points at you),
  // the other hand on that wrist: pressing against your own hand. Seated, the shoulders are at
  // y -104 and a hanging elbow at about -75.
  const SELF_SC = { thN: 0.15, thF: 0.15, faN: 0.25, faF: 0.7 };
  F.seatSelfCurl = {
    view: 'front', pin: SIT_F, key: 'a', armLayer: 'front', legLayer: 'front', props: [CHAIR_F], bend: FRONT_HANDS,
    poses: {
      a: sitF({ sc: SELF_SC, ik: { hdN: [19, -72], hdF: [17, -77] } }),
      a2: sitF({ sc: SELF_SC, ik: { hdN: [19, -73.5], hdF: [17, -78.5] } }),
    },
    rep: iso('a', 'a2', 1800), muscles: ['biceps', 'forearms'], uni: true, leadLimbs: ['aN'],
  };
  F.seatSelfPress = merge(F.seatSelfCurl, {
    muscles: ['triceps'],
    poses: { a: { sc: { faF: 0.85 }, ik: { hdN: [19, -74], hdF: [16, -69.5] } }, a2: { sc: { faF: 0.85 }, ik: { hdN: [19, -72.5], hdF: [16, -68] } } },
  });
  // Upper arms forward at chest height, forearms up and pressed together in front of you.
  F.seatSqueeze = {
    view: 'front', pin: SIT_F, key: 'a', armLayer: 'front', legLayer: 'front', props: [CHAIR_F], bend: FRONT_HANDS,
    poses: {
      a: sitF({ sc: { uaN: 0.4, uaF: 0.4 }, ik: { hdN: [4, -118], hdF: [-4, -118] } }),
      a2: sitF({ sc: { uaN: 0.4, uaF: 0.4 }, ik: { hdN: [3, -119], hdF: [-3, -119] } }),
    },
    rep: iso('a', 'a2', 2000), muscles: ['chest', 'frontDelts'],
  };
  F.seatPallof = {
    view: 'front', pin: SIT_F, key: 'b', armLayer: 'front', legLayer: 'front', bend: FRONT_HANDS,
    props: [CHAIR_F, { type: 'door', x: -92 }], equip: [{ type: 'band', hands: 'both', from: [-86, -96] }],
    poses: {
      a: sitF({ sc: { uaN: 0.85, uaF: 0.85, faN: 0.5, faF: 0.5 }, ik: { hdN: [3, -92], hdF: [-3, -92] } }),
      b: sitF({ sc: { uaN: 0.46, uaF: 0.46, faN: 0.46, faF: 0.46 }, ik: { hdN: [3, -96], hdF: [-3, -96] } }),
    },
    rep: ce('a', 'b', { holdB: 1500 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };
  // Side view: a band round the chair back, pressed forward from the chest.
  F.seatBandPress = {
    view: 'side', pin: SIT, key: 'b', props: [CHAIR], equip: [{ type: 'band', hands: 'both', from: [-22, -84] }],
    poses: { a: sit({ aN: { s: -8, e: 116 } }), b: sit({ aN: { s: 84, e: 4 } }) },
    rep: ce('a', 'b', { holdB: 300 }), muscles: ['chest', 'triceps', 'frontDelts'],
  };

  /* ------------------------------------------------------------------ standing, supported */
  const FLOOR = { joint: 'anN', at: [0, -8] };
  const WALL_AHEAD = { type: 'wall', x: 52, side: 1 };
  const ON_WALL = [49, -126];
  // Sit-to-stand from a chair behind you: sitting tall, leaning forward (nose over toes), standing.
  const STS_CHAIR = { type: 'chair', x: -50, w: 42, h: 45, back: -1 };
  const STS_FEET = [10, -8];
  const sts = (at, t, o) => merge({ at, t, lN: { flat: true }, ik: { anN: STS_FEET } }, o || {});
  F.sitStand = {
    view: 'side', pin: { joint: 'hip' }, key: 'c', props: [STS_CHAIR],
    poses: {
      a: sts([-24, -54], 4, { aN: { s: 84, e: 6 } }),
      b: sts([-20, -54], 38, { n: -14, aN: { s: 118, e: 4 } }),
      c: sts([8, -91], 2, { aN: { s: 82, e: 6 } }),
    },
    rep: [{ to: 'b', ms: 700, hold: 0, ph: 'move' }, { to: 'c', ms: 1100, hold: 300, ph: 'con' }, { to: 'b', ms: 1600, hold: 0, ph: 'ecc' }, { to: 'a', ms: 600, hold: 300, ph: 'move' }],
    muscles: ['quads', 'glutes'],
  };
  // Pushing up with the hands on the seat, then letting go.
  F.sitStandHands = {
    view: 'side', pin: { joint: 'hip' }, key: 'c', props: [STS_CHAIR],
    poses: {
      a: sts([-24, -54], 4, { ik: { anN: STS_FEET, hdN: [-14, -47] } }),
      b: sts([-20, -54], 34, { n: -12, ik: { anN: STS_FEET, hdN: [-10, -47] } }),
      c: sts([8, -91], 2, { ik: { anN: STS_FEET, hdN: [12, -88] } }),
    },
    rep: [{ to: 'b', ms: 700, hold: 0, ph: 'move' }, { to: 'c', ms: 1200, hold: 300, ph: 'con' }, { to: 'b', ms: 1600, hold: 0, ph: 'ecc' }, { to: 'a', ms: 600, hold: 300, ph: 'move' }],
    muscles: ['quads', 'glutes', 'triceps'], prime: 2,
  };
  F.sitStandWeight = merge(F.sitStand, {
    equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side', tilt: 90 }] },
    poses: { a: { aN: { s: 22, e: 128 } }, b: { aN: { s: 40, e: 128 } }, c: { aN: { s: 22, e: 128 } } },
  });
  F.heelRaiseWall = {
    view: 'side', pin: { joint: 'toN', at: [14, -8] }, key: 'b', props: [WALL_AHEAD],
    poses: {
      a: { t: 3, lN: { h: 0, k: 0, fd: 90 }, ik: { hdN: ON_WALL } },
      b: { t: 3, lN: { h: 0, k: 0, fd: 56 }, ik: { hdN: ON_WALL } },
    },
    rep: ce('a', 'b', { con: 900, holdB: 700, ecc: 1500 }), muscles: ['calves'],
  };
  const CHAIR_AHEAD = { type: 'chair', x: 22, w: 42, h: 45, back: -1 };
  F.hipExtChair = {
    view: 'side', pin: { joint: 'anF', at: [0, -8] }, key: 'b', props: [CHAIR_AHEAD],
    poses: {
      a: { t: 14, lN: { h: 14, k: 2 }, lF: { h: 14, k: 2 }, ik: { hdN: [26, -90] } },
      b: { t: 12, n: -4, lN: { h: -10, k: 8, flat: false, a: 20 }, lF: { h: 12, k: 2 }, ik: { hdN: [26, -90] } },
    },
    rep: ce('a', 'b', { holdB: 600 }), muscles: ['glutes', 'hamstrings'], uni: true, leadLimbs: ['lN'],
  };
  F.hipAbdWall = {
    view: 'front', pin: { joint: 'anF', at: [-9, -8] }, key: 'b', armLayer: 'front', props: [{ type: 'wall', x: -58, side: -1 }],
    poses: {
      a: { t: 0, aN: { s: 10, e: 10 }, lN: { h: 4, k: 0 }, lF: { h: 4, k: 0 }, ik: { hdF: [-54, -122] } },
      b: { t: 2, aN: { s: 12, e: 10 }, lN: { h: 30, k: 2 }, lF: { h: 4, k: 0 }, ik: { hdF: [-54, -122] } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes'], uni: true, leadLimbs: ['lN'],
  };
  // Forearms on the wall, body straight: a plank at a slant.
  F.wallPlank = {
    view: 'side', pin: FLOOR, key: 'a', props: [{ type: 'wall', x: 73, side: 1 }],
    poses: {
      a: { t: 18, n: -6, lN: { h: 0, k: 0 }, aN: { s: 86, e: 112 } },
      a2: { t: 18.5, n: -6, lN: { h: 0, k: 0 }, aN: { s: 86.5, e: 111.5 } },
    },
    rep: iso('a', 'a2', 2400), muscles: ['abs', 'obliques', 'frontDelts'],
  };
  // Front knee bent, back leg long with the heel down, leaning into the wall.
  const calfPose = (at, t) => ({ at, t, lN: { flat: true }, lF: { flat: true }, ik: { anN: [24, -8], anF: [-40, -8], hdN: [66, -128] } });
  F.calfStretchWall = {
    view: 'side', pin: { joint: 'hip' }, key: 'a2', props: [{ type: 'wall', x: 70, side: 1 }],
    poses: { a: calfPose([-4, -83.5], 18), a2: calfPose([-1.5, -83.5], 21) },
    rep: iso('a', 'a2', 2600), muscles: ['calves'], uni: true, leadLimbs: ['lF'],
  };
  F.quadStretchWall = {
    view: 'side', pin: FLOOR, key: 'a', props: [WALL_AHEAD],
    poses: {
      a: { t: 4, aF: { s: -34, e: 30 }, lN: { h: 4, k: 2 }, lF: { h: -14, k: 150, flat: false, a: 30 }, ik: { hdN: ON_WALL } },
      a2: { t: 3, aF: { s: -36, e: 30 }, lN: { h: 3, k: 2 }, lF: { h: -16, k: 152, flat: false, a: 30 }, ik: { hdN: ON_WALL } },
    },
    rep: iso('a', 'a2', 2600), muscles: ['quads', 'hipFlexors'], uni: true, leadLimbs: ['lF'],
  };

  /* ------------------------------------------------------------------ balance */
  // Heel to toe: the front ankle 20 ahead of the back one, so the back toes touch the front heel.
  const TANDEM_HIP = { joint: 'hip' };
  const tandemPose = (at, t, o) => merge({ at, t, lN: { flat: true }, lF: { flat: true }, ik: { anN: [10, -8], anF: [-10, -8] } }, o || {});
  F.tandemWall = {
    view: 'side', pin: TANDEM_HIP, key: 'a', props: [WALL_AHEAD],
    poses: {
      a: tandemPose([0, -91], 2, { ik: { anN: [10, -8], anF: [-10, -8], hdN: ON_WALL } }),
      a2: tandemPose([-1, -91], -1, { ik: { anN: [10, -8], anF: [-10, -8], hdN: ON_WALL } }),
    },
    rep: iso('a', 'a2', 2600), muscles: ['calves', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.tandem = {
    view: 'side', pin: TANDEM_HIP, key: 'a',
    poses: {
      a: tandemPose([0, -91], 2, { aN: { s: 24, e: 14 }, sc: { uaN: 0.8, uaF: 0.8 } }),
      a2: tandemPose([-1, -91], -1, { aN: { s: 20, e: 16 }, sc: { uaN: 0.8, uaF: 0.8 } }),
    },
    rep: iso('a', 'a2', 2400), muscles: ['calves', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.oneLegWall = {
    view: 'side', pin: FLOOR, key: 'a', props: [WALL_AHEAD],
    poses: {
      a: { t: 2, lN: { h: 2, k: 2 }, lF: { h: 46, k: 70, flat: false, a: 20 }, ik: { hdN: ON_WALL } },
      a2: { t: 0, lN: { h: 0, k: 3 }, lF: { h: 44, k: 68, flat: false, a: 20 }, ik: { hdN: ON_WALL } },
    },
    rep: iso('a', 'a2', 2600), muscles: ['glutes', 'calves'], uni: true, leadLimbs: ['lN'],
  };
  F.oneLeg = {
    view: 'side', pin: FLOOR, key: 'a',
    poses: {
      a: { t: 2, aN: { s: 26, e: 14 }, sc: { uaN: 0.75, uaF: 0.75 }, lN: { h: 2, k: 2 }, lF: { h: 46, k: 70, flat: false, a: 20 } },
      a2: { t: 0, aN: { s: 22, e: 16 }, sc: { uaN: 0.75, uaF: 0.75 }, lN: { h: 0, k: 3 }, lF: { h: 44, k: 68, flat: false, a: 20 } },
    },
    rep: iso('a', 'a2', 2400), muscles: ['glutes', 'calves'], uni: true, leadLimbs: ['lN'],
  };
  // Walking a line in place: each heel lands just in front of the other foot's toes.
  const HT_ARMS = { sc: { uaN: 0.75, uaF: 0.75 } };
  F.heelToe = {
    view: 'side', pin: { joint: 'hip', at: [0, -92] }, key: 'a',
    poses: {
      a: merge(HT_ARMS, { t: 1, aN: { s: 24, e: 16 }, lN: { h: 8, k: 1, flat: false, a: -10 }, lF: { h: -7, k: 5, flat: false, a: 22 } }),
      b: merge(HT_ARMS, { t: 1, aN: { s: 24, e: 16 }, lN: { h: 1, k: 3 }, lF: { h: 12, k: 42, flat: false, a: 12 } }),
      c: merge(HT_ARMS, { t: 1, aN: { s: 24, e: 16 }, lN: { h: -7, k: 5, flat: false, a: 22 }, lF: { h: 8, k: 1, flat: false, a: -10 } }),
      d: merge(HT_ARMS, { t: 1, aN: { s: 24, e: 16 }, lN: { h: 12, k: 42, flat: false, a: 12 }, lF: { h: 1, k: 3 } }),
    },
    rep: cyc(['b', 'c', 'd', 'a'], 650, 150), muscles: ['calves', 'glutes'],
  };
  // Standing on one leg, one arm reaches forward, then up, then back behind you.
  F.clockReach = {
    view: 'side', pin: FLOOR, key: 'u',
    poses: {
      f: { t: 6, aN: { s: 92, e: 2 }, aF: { s: 14, e: 20 }, lN: { h: 6, k: 4 }, lF: { h: -6, k: 40, flat: false, a: 30 } },
      u: { t: 2, aN: { s: 160, e: 2 }, aF: { s: 14, e: 20 }, lN: { h: 2, k: 4 }, lF: { h: -6, k: 40, flat: false, a: 30 } },
      o: { t: 4, aN: { s: -38, e: 2 }, aF: { s: 14, e: 20 }, lN: { h: 4, k: 4 }, lF: { h: -6, k: 40, flat: false, a: 30 } },
    },
    rep: [{ to: 'u', ms: 1200, hold: 500, ph: 'move' }, { to: 'o', ms: 1200, hold: 500, ph: 'move' }, { to: 'f', ms: 1200, hold: 500, ph: 'move' }],
    muscles: ['glutes', 'calves', 'abs'], uni: true, leadLimbs: ['lN', 'aN'],
  };
  // A high step forward over a line and back.
  F.stepOver = {
    view: 'side', pin: { joint: 'anF', at: [0, -8] }, key: 'b',
    poses: {
      a: { t: 1, aN: { s: 10, e: 20 }, lN: { h: 0, k: 2 }, lF: { h: 0, k: 2 } },
      b: { t: 3, aN: { s: -10, e: 40 }, aF: { s: 24, e: 40 }, lN: { h: 72, k: 90, flat: false, a: 10 }, lF: { h: 0, k: 4 } },
      c: { t: 4, aN: { s: -14, e: 30 }, aF: { s: 22, e: 30 }, lN: { h: 30, k: 10, flat: false, a: 0 }, lF: { h: -4, k: 8 } },
    },
    rep: [{ to: 'b', ms: 700, hold: 0, ph: 'move' }, { to: 'c', ms: 700, hold: 250, ph: 'move' }, { to: 'b', ms: 700, hold: 0, ph: 'move' }, { to: 'a', ms: 700, hold: 250, ph: 'move' }],
    muscles: ['hipFlexors', 'glutes', 'calves'], uni: true, leadLimbs: ['lN'],
  };

  /* ------------------------------------------------------------------ gentle cardio, standing */
  F.marchEasy = merge(F.highKnees, {
    poses: {
      a: { aN: { s: 22, e: 70 }, aF: { s: -18, e: 70 }, lN: { h: 52, k: 62, flat: false, a: 16 }, lF: { h: 0, k: 3 } },
      b: { aN: { s: -18, e: 70 }, aF: { s: 22, e: 70 }, lN: { h: 0, k: 3 }, lF: { h: 52, k: 62, flat: false, a: 16 } },
    },
    rep: cyc(['b', 'a'], 560, 90),
  });
  // Side taps: step out, tap, step back, then the other side (front view).
  const TAP = (at, n, f, arms) => merge({ at, aN: { s: arms, e: 30 }, lN: { flat: true }, lF: { flat: true }, ik: { anN: n, anF: f } }, {});
  F.stepTouch = {
    view: 'front', pin: { joint: 'hip' }, key: 'c', armLayer: 'front',
    poses: {
      a: TAP([0, -92], [9, -8], [-9, -8], 14),
      b: TAP([3, -91], [22, -16], [-9, -8], 30),
      c: TAP([7, -89], [32, -8], [-9, -8], 44),
      d: TAP([-3, -91], [9, -8], [-22, -16], 30),
      e: TAP([-7, -89], [9, -8], [-32, -8], 44),
    },
    rep: cyc(['b', 'c', 'b', 'a', 'd', 'e', 'd', 'a'], 300, 40),
    muscles: ['glutes', 'calves'],
  };

  /* ------------------------------------------------------------------ getting down and up */
  // One hand on a chair seat, step back and lower the back knee to the floor, then stand.
  // A hand on the top of a sturdy chair's backrest the whole way down and up.
  const KNEEL_CHAIR = { type: 'chair', x: 54, w: 42, h: 45, back: -1 };
  const ON_BACKREST = [57, -86];
  F.halfKneel = {
    view: 'side', pin: { joint: 'anN', at: [36, -8] }, key: 'b', props: [KNEEL_CHAIR],
    poses: {
      a: { t: 8, aF: { s: 14, e: 20 }, lN: { h: 8, k: 2 }, lF: { flat: true }, ik: { anF: [34, -8], hdN: ON_BACKREST } },
      s: { t: 12, aF: { s: 14, e: 20 }, lN: { h: 34, k: 34 }, lF: { flat: false, a: 30 }, ik: { anF: [-8, -24], hdN: ON_BACKREST } },
      b: { t: 10, aF: { s: 10, e: 20 }, lN: { h: 92, k: 90 }, lF: { flat: false, a: 55 }, ik: { anF: [-38, -12], hdN: ON_BACKREST } },
    },
    rep: [{ to: 's', ms: 900, hold: 0, ph: 'move' }, { to: 'b', ms: 1400, hold: 600, ph: 'ecc' }, { to: 's', ms: 1400, hold: 0, ph: 'con' }, { to: 'a', ms: 900, hold: 400, ph: 'move' }],
    muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  // From standing to both knees, one knee at a time, and back up the same way. Each foot lifts
  // on its way back so the toes never scrape through the floor.
  const kneel = (at, n, f, o) => merge({ at, t: 10, aF: { s: 12, e: 20 }, ik: { anN: n, anF: f, hdN: ON_BACKREST } }, o || {});
  F.tallKneel = {
    view: 'side', pin: { joint: 'hip' }, key: 'c', props: [KNEEL_CHAIR],
    poses: {
      a: kneel([35, -92], [36, -8], [30, -8], { t: 8, lN: { flat: true }, lF: { flat: true } }),
      s: kneel([28, -89], [36, -8], [-8, -24], { t: 12, lN: { flat: true }, lF: { flat: false, a: 30 } }),
      b: kneel([-2, -52], [36, -8], [-38, -12], { lN: { flat: true }, lF: { flat: false, a: 55 } }),
      s2: kneel([4, -52], [-10, -30], [-38, -12], { lN: { flat: false, a: 20 }, lF: { flat: false, a: 55 } }),
      c: kneel([8, -50], [-30, -12], [-36, -12], { lN: { flat: false, a: 55 }, lF: { flat: false, a: 55 } }),
    },
    rep: [
      { to: 's', ms: 700, hold: 0, ph: 'ecc' }, { to: 'b', ms: 1100, hold: 300, ph: 'ecc' }, { to: 's2', ms: 700, hold: 0, ph: 'ecc' }, { to: 'c', ms: 800, hold: 700, ph: 'ecc' },
      { to: 's2', ms: 800, hold: 0, ph: 'con' }, { to: 'b', ms: 700, hold: 300, ph: 'con' }, { to: 's', ms: 1100, hold: 0, ph: 'con' }, { to: 'a', ms: 700, hold: 500, ph: 'con' },
    ],
    muscles: ['quads', 'glutes'],
  };

  /* ------------------------------------------------------------------ on the floor */
  const QUAD = { joint: 'knN', at: [0, -6] };
  F.birdDog = {
    view: 'side', pin: QUAD, key: 'b',
    poses: {
      a: { t: 80, n: -20, lN: { h: 80, k: 90, flat: false, a: 90 }, lF: { h: 80, k: 90, flat: false, a: 90 }, ik: { hdN: [52, -3], hdF: [50, -3] } },
      b: { t: 82, n: -20, lN: { h: 80, k: 90, flat: false, a: 90 }, lF: { h: 2, k: 0, flat: false, a: 40 }, ik: { hdN: [106, -62], hdF: [50, -3] } },
    },
    rep: ce('a', 'b', { con: 1400, ecc: 1400, holdB: 1500 }), muscles: ['lowerBack', 'glutes', 'abs'], uni: true, leadLimbs: ['aN', 'lF'],
  };
  F.pelvicTilt = {
    view: 'side', pin: { joint: 'neck', at: [-50, -11] }, key: 'b',
    poses: {
      a: { t: -90, n: 0, aN: { s: 0, e: 0 }, lN: { flat: true }, ik: { anN: [45, -8] } },
      b: { t: -95, n: 0, aN: { s: -5, e: 0 }, lN: { flat: true }, ik: { anN: [45, -8] } },
    },
    rep: ce('a', 'b', { holdB: 1500, con: 1000, ecc: 1200 }), muscles: ['abs', 'glutes'],
  };
  F.proneLift = {
    view: 'side', pin: { joint: 'hip', at: [0, -11] }, key: 'b',
    poses: {
      a: { t: 90, n: 0, aN: { s: 4, e: 4 }, lN: { h: 0, k: 0, flat: false, a: -60 } },
      b: { t: 78, n: 8, aN: { s: 1, e: 0 }, lN: { h: -12, k: 0, flat: false, a: -60 } },
    },
    rep: ce('a', 'b', { holdB: 1500, con: 1100, ecc: 1300 }), muscles: ['lowerBack', 'glutes', 'upperBack'],
  };
  F.sideLyingLift = {
    view: 'front', pin: { joint: 'hip', at: [0, -18] }, key: 'b', armLayer: 'front', legLayer: 'front',
    poses: {
      a: { t: 90, n: -6, aN: { s: 176, e: 20 }, aF: { s: 3, e: 4 }, lN: { h: 0, k: 4 }, lF: { h: 2, k: 2 } },
      b: { t: 90, n: -6, aN: { s: 176, e: 20 }, aF: { s: 3, e: 4 }, lN: { h: 0, k: 4 }, lF: { h: 32, k: 2 } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes'], uni: true, leadLimbs: ['lF'],
  };

  /* ------------------------------------------------------------------ seated moves */
  const SLOW = 'Lower for a slow 3 count.';
  const SEAT = { pos: 'seat', req: ['chair'] };
  const HOLD_BREATHE = 'Keep breathing the whole time. Never hold your breath.';

  // Legs, seated.
  const LS = { ...SEAT, group: 'legs', load: null, breathe: 'Breathe out as you lift, in as you lower.' };
  move('ls_march', 'seatMarch', { ...LS, name: 'Seated march', timed: true, range: [20, 60], start: 30, joints: ['hip'],
    cues: ['Sit tall near the front of the chair.', 'Lift one knee, then the other, like marching.', 'Keep your back off the backrest.'], mistake: 'Leaning back to lift your legs.', breathe: 'Breathe steadily, in time with your steps.' });
  move('ls_ext', 'seatKneeExt', { ...LS, name: 'Seated knee extension', range: [10, 25], start: 12, uni: true, joints: ['knee'],
    cues: ['Sit tall, hands resting on your thighs.', 'Straighten one knee until your leg is level.', 'Squeeze your thigh, then lower slowly.'], mistake: 'Kicking the leg up fast.', breathe: 'Breathe out as you straighten.' });
  move('ls_ext_hold', 'seatKneeExt', { ...LS, name: 'Seated knee extension, 3-sec hold', range: [8, 20], start: 10, uni: true, joints: ['knee'],
    cues: ['Straighten one knee until your leg is level.', 'Hold it there for a slow 3 count.', 'Lower slowly.'], mistake: 'Letting the leg drop.', breathe: 'Breathe out as you straighten, keep breathing in the hold.' }, { pause: ['con', 3000] });
  move('ls_lift', 'seatLegLift', { ...LS, name: 'Seated leg lift', range: [8, 20], start: 10, uni: true, joints: ['hip', 'knee'],
    cues: ['Straighten one leg, heel on the floor.', 'Lift the whole leg a few inches, knee straight.', 'Lower slowly and tap the floor.'], mistake: 'Bending the knee as you lift.' });
  move('ls_heel', 'seatHeel', { ...LS, name: 'Seated heel raises', range: [12, 30], start: 15, joints: ['ankle'], muscles: ['calves'],
    cues: ['Feet flat, hands on your thighs.', 'Rise onto the balls of your feet.', 'Lower your heels slowly.'], mistake: 'Bouncing your heels.', breathe: 'Breathe out as you rise.' });
  move('ls_press', 'seatLegPress', { ...LS, name: 'Seated band leg press', req: ['chair', 'band'], load: 'band', grip: 'hold', range: [10, 25], start: 12, uni: true, joints: ['knee', 'hip'],
    cues: ['Loop the band round one foot, ends in your hands.', 'Press the foot out until your knee is straight.', 'Let it come back slowly against the band.'], mistake: 'Letting the band snap your knee back.', breathe: 'Breathe out as you press.' });
  move('hp_seat_hinge', 'seatHinge', { ...LS, name: 'Seated hip hinge', range: [8, 20], start: 10, joints: ['back', 'hip'], muscles: ['lowerBack', 'glutes', 'hamstrings'],
    cues: ['Arms crossed, back straight.', 'Tip forward from your hips, not your waist.', 'Squeeze your seat to sit back up tall.'], mistake: 'Rounding your back as you tip forward.', breathe: 'Breathe in as you tip forward, out as you come up.' });

  // Arms, seated.
  const CU = { ...SEAT, group: 'biceps', joints: ['elbow', 'wrist'], mistake: 'Swinging the weight up with your back.', breathe: 'Breathe out as you curl.' };
  const CU_CUES = ['Sit tall, elbows by your sides.', 'Curl up, then lower all the way.', 'Keep your shoulders still.'];
  move('cu_seat_band', 'seatBandCurl', { ...CU, name: 'Seated band curl', req: ['chair', 'band'], load: 'band', grip: 'hold', range: [12, 30], start: 15,
    cues: ['Band under your feet, ends in your hands.', 'Elbows pinned to your sides.', 'Curl up, then lower slowly.'] });
  move('cu_seat', 'seatCurl', { ...CU, name: 'Seated curl', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [8, 25], start: 12, cues: CU_CUES });
  move('cu_seat_hammer', 'seatHammer', { ...CU, name: 'Seated hammer curl', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [10, 30], start: 14,
    cues: ['Thumbs up, palms facing in.', 'Elbows by your sides.', 'Lower all the way down.'] });
  move('cu_seat_slow', 'seatCurl', { ...CU, name: 'Seated curl, 3-sec lowering', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [6, 20], start: 10, cues: [SLOW, CU_CUES[0], CU_CUES[2]] }, { ecc: 3000 });
  const TR = { ...SEAT, group: 'triceps', joints: ['elbow', 'shoulder'], mistake: 'Letting your elbows flare wide.', breathe: 'Breathe out as you straighten your arms.' };
  move('tr_seat_oh', 'seatOhExt', { ...TR, name: 'Seated overhead extension', req: ['chair', 'db'], load: 'db', grip: 'hold', overhead: true, range: [10, 25], start: 12,
    cues: ['One dumbbell in both hands, overhead.', 'Lower it behind your head, elbows pointing up.', 'Straighten your arms, ribs down.'] });
  move('tr_seat_oh_slow', 'seatOhExt', { ...TR, name: 'Seated overhead extension, 3-sec lowering', req: ['chair', 'db'], load: 'db', grip: 'hold', overhead: true, range: [8, 20], start: 10,
    cues: [SLOW, 'Elbows point up, close to your head.', 'Ribs down, no arching.'] }, { ecc: 3000 });
  move('tr_seat_kick', 'seatKickback', { ...TR, name: 'Seated kickback', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [10, 25], start: 12, joints: ['elbow'],
    cues: ['Tip forward from your hips, back flat.', 'Upper arms by your sides, straighten your elbows back.', 'Lower slowly to a right angle.'], mistake: 'Letting your elbows drop as you straighten.' });
  move('sh_seat_press', 'seatPress', { ...SEAT, group: 'shoulders', name: 'Seated overhead press', req: ['chair', 'db'], load: 'db', grip: 'hold', overhead: true, range: [8, 20], start: 10, joints: ['shoulder', 'elbow'],
    cues: ['Sit tall, dumbbells at your shoulders.', 'Press them straight up overhead.', 'Lower to your shoulders slowly.'], mistake: 'Arching your back to push the weights up.', breathe: 'Breathe out as you press.' });

  // Back, seated.
  const BK = { ...SEAT, group: 'back', joints: ['elbow', 'shoulder'], mistake: 'Shrugging your shoulders up to your ears.', breathe: 'Breathe out as you pull.' };
  move('bk_squeeze', 'bladeSqueeze', { ...BK, name: 'Shoulder blade squeeze', load: null, range: [8, 20], start: 10, joints: [],
    cues: ['Sit tall, elbows bent at your sides.', 'Draw your elbows back and squeeze your shoulder blades together.', 'Hold two seconds, then relax.'] });
  move('bk_seat_row', 'seatRow', { ...BK, name: 'Seated band row', req: ['chair', 'band', 'door'], load: 'band', grip: 'loop', range: [12, 30], start: 15,
    cues: ['Band anchored at chest height in front of you.', 'Pull your elbows back past your ribs.', 'Hold the band, or loop it over your hands if gripping hurts.'] });
  move('bk_seat_db_row', 'seatBentRow', { ...BK, name: 'Seated bent-over row', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [10, 25], start: 12, joints: ['back', 'elbow'],
    cues: ['Tip forward from your hips, back flat.', 'Pull the dumbbells up to your hips.', 'Lower them with straight arms.'] });
  move('bk_seat_pulldown', 'seatPulldown', { ...BK, name: 'Seated band pulldown', req: ['chair', 'band', 'door'], load: 'band', grip: 'loop', range: [12, 30], start: 15,
    cues: ['Band anchored high on the door.', 'Pull your elbows down to your sides.', 'Let your arms rise slowly.'] });

  // Gentle cardio, seated.
  const GC = { ...SEAT, group: 'conditioning', load: null, timed: true, range: [20, 40], start: 20, joints: [], mistake: 'Holding your breath to go faster.', breathe: 'Keep breathing. You should still be able to talk.' };
  move('fin_seat_march', 'seatMarch', { ...GC, name: 'Brisk seated march', joints: ['hip'], rep: cyc(['l', 'a', 'r', 'a'], 360, 40),
    cues: ['Sit tall near the front of the chair.', 'March your knees up, arms pumping.', 'A steady pace you could keep up.'] });
  move('fin_seat_box', 'seatBoxing', { ...GC, name: 'Seated boxing', joints: ['shoulder', 'elbow'], cues: ['Sit tall, fists up by your chin.', 'Punch forward one arm at a time.', 'Don\'t lock your elbows.'] });

  // Mobility and range of motion, seated.
  const MB = { ...SEAT, group: 'mobility', load: null, timed: true, range: [30, 60], start: 40, joints: [], mistake: 'Forcing the range.', breathe: 'Slow breaths through your nose.' };
  move('wu_seat_march', 'seatMarch', { ...MB, name: 'Seated march', range: [30, 40], start: 30, cues: ['Sit tall.', 'Lift one knee, then the other.', 'Swing your arms.'] });
  move('mob_chin', 'chinTuck', { ...MB, name: 'Chin tucks', range: [30, 45], start: 30, cues: ['Sit tall, eyes level.', 'Slide your chin straight back, making a double chin.', 'Hold, then relax.'] });
  move('mob_wrist', 'wristCircles', { ...MB, name: 'Wrist circles', range: [30, 45], start: 30, cues: ['Forearms out in front, hands relaxed.', 'Circle your wrists slowly, both ways.', 'Stay in a range that feels easy.'] });
  move('mob_ankle', 'ankleCircles', { ...MB, name: 'Ankle circles', range: [20, 40], start: 20, uni: true, cues: ['Straighten one leg out in front.', 'Circle your foot slowly, both ways.', 'Point and flex your toes too.'] });
  move('mob_seat_ham', 'seatHamStretch', { ...MB, name: 'Seated hamstring stretch', range: [30, 45], start: 30, uni: true, cues: ['One leg straight, heel on the floor.', 'Tip forward from your hips with a straight back.', 'Stop at a gentle stretch behind your knee.'] });
  move('bal_seat_reach', 'seatReach', { ...MB, group: 'balance', name: 'Seated forward reach', timed: false, range: [6, 15], start: 8, joints: ['back'], muscles: ['abs', 'lowerBack'],
    cues: ['Sit tall near the front of the chair.', 'Reach both arms forward as far as you can, back straight.', 'Hold, then sit back up tall.'], mistake: 'Holding the chair to reach further.', breathe: 'Breathe out as you reach.' });

  // Core, seated.
  const CO = { ...SEAT, group: 'abs', load: null, joints: [], breathe: HOLD_BREATHE, mistake: 'Slumping into the backrest.' };
  move('co_seat_brace', 'seatBrace', { ...CO, name: 'Seated belly brace', timed: true, range: [15, 45], start: 20,
    cues: ['Sit tall, arms crossed, away from the backrest.', 'Tighten your belly as if bracing for a poke.', 'Hold it while you keep breathing.'] });
  move('co_seat_lean', 'seatLean', { ...CO, name: 'Seated lean-back hold', range: [5, 12], start: 6, joints: ['back'],
    cues: ['Sit near the front of the chair, arms crossed.', 'Lean back a little with a straight back.', 'Hold three seconds, then sit up tall.'], breathe: 'Breathe out as you lean back. Never hold your breath.' });


  /* ------------------------------------------------------------------ front-view seated moves */
  const SH = { ...SEAT, group: 'shoulders', joints: ['shoulder'], mistake: 'Shrugging your shoulders up to your ears.', breathe: 'Breathe out as you raise.' };
  move('sh_seat_arm', 'seatArmRaise', { ...SH, name: 'Seated arm raise', load: null, range: [10, 30], start: 12,
    cues: ['Sit tall, arms by your sides.', 'Raise your arms out to shoulder height.', 'Lower slowly, no swinging.'] });
  move('sh_seat_hold', 'seatArmsOut', { ...SH, name: 'Seated arms-out hold', load: null, timed: true, range: [15, 45], start: 20,
    cues: ['Sit tall, arms out at shoulder height.', 'Palms down, shoulders away from your ears.', 'Hold still.'], breathe: HOLD_BREATHE });
  move('sh_seat_raise', 'seatRaiseF', { ...SH, name: 'Seated lateral raise', req: ['chair', 'db'], load: 'db', grip: 'hold', range: [10, 25], start: 12,
    cues: ['Sit tall, dumbbells at your sides.', 'Raise them out to shoulder height, elbows soft.', 'Lower slowly.'] });
  move('bk_seat_apart', 'seatPullApart', { ...BK, name: 'Seated band pull-apart', req: ['chair', 'band'], load: 'band', grip: 'loop', range: [12, 30], start: 15, joints: ['shoulder'],
    cues: ['Band at chest height, arms straight out in front.', 'Pull it apart until it touches your chest.', 'Loop it round your hands if gripping hurts.'], breathe: 'Breathe out as you pull apart.' });

  // Self-resisted: one hand pushes against the other, so there is nothing to hold.
  const SELF = { load: null, timed: true, range: [15, 40], start: 20, uni: true, joints: ['elbow'], mistake: 'Pushing so hard it hurts.', breathe: HOLD_BREATHE };
  move('cu_self', 'seatSelfCurl', { ...CU, ...SELF, name: 'Self-resisted curl',
    cues: ['Bend one elbow to a right angle, palm up.', 'Rest your other hand on that wrist.', 'Push up into it, firm and steady.'] });
  move('tr_self', 'seatSelfPress', { ...TR, ...SELF, name: 'Self-resisted triceps press',
    cues: ['Bend one elbow to a right angle, palm down.', 'Put your other hand under that wrist.', 'Push down into it, firm and steady.'] });

  // Chest, seated.
  const CH = { ...SEAT, group: 'chest', joints: ['shoulder', 'elbow'], mistake: 'Shrugging your shoulders up.', breathe: 'Breathe out as you press.' };
  move('ch_seat_squeeze', 'seatSqueeze', { ...CH, name: 'Seated forearm squeeze', load: null, timed: true, range: [15, 45], start: 20, joints: ['shoulder'],
    cues: ['Elbows bent, forearms up in front of you.', 'Press your forearms together, firm and steady.', 'Keep breathing while you hold.'], breathe: HOLD_BREATHE });
  move('ch_seat_band', 'seatBandPress', { ...CH, name: 'Seated band chest press', req: ['chair', 'band'], load: 'band', grip: 'loop', range: [10, 25], start: 12,
    cues: ['Band round the chair back, under your arms.', 'Press both hands straight forward.', 'Loop the band over your hands if gripping hurts.'] });
  move('ch_seat_band_slow', 'seatBandPress', { ...CH, name: 'Seated band chest press, 3-sec return', req: ['chair', 'band'], load: 'band', grip: 'loop', range: [8, 20], start: 10,
    cues: ['Press both hands straight forward.', 'Let them come back for a slow 3 count.', 'Shoulders down, chest tall.'] }, { ecc: 3000 });

  // Core and mobility, seated.
  move('co_seat_pallof', 'seatPallof', { ...CO, name: 'Seated Pallof press', req: ['chair', 'band', 'door'], load: 'band', grip: 'hold', range: [8, 20], start: 10, uni: true,
    cues: ['Band anchored at your side, chest height.', 'Press your hands straight out and hold.', 'Don\'t let the band turn you.'], mistake: 'Letting the band twist you round.', breathe: 'Breathe out as you press. Never hold your breath.' });
  move('wu_seat_circles', 'seatCircles', { ...MB, name: 'Seated arm circles', range: [30, 40], start: 30, joints: ['shoulder'],
    cues: ['Sit tall, arms out to the sides.', 'Small circles, growing bigger.', 'Switch direction halfway.'] });
  move('mob_seat_twist', 'seatTwist', { ...MB, name: 'Seated twist', range: [30, 45], start: 30, joints: ['back'], spine: ['twist'],
    cues: ['Sit tall, arms crossed on your chest.', 'Turn gently from your ribs to one side, then the other.', 'Hips stay facing forward.'] });
  move('mob_chest', 'seatChestOpen', { ...MB, name: 'Seated chest opener', range: [30, 45], start: 30, joints: ['shoulder'],
    cues: ['Sit tall, fingertips behind your head.', 'Open your elbows wide until you feel your chest stretch.', 'Ease off a little, then open again.'] });

  /* ------------------------------------------------------------------ standing, with support */
  const STS = { group: 'legs', joints: ['knee', 'hip'], req: ['chair'], load: null, pos: 'stand', mistake: 'Dropping onto the chair instead of lowering.', breathe: 'Breathe out as you stand, in as you sit.' };
  move('sq_sts_hands', 'sitStandHands', { ...STS, name: 'Sit to stand, hands on the seat', range: [6, 15], start: 8,
    cues: ['Sit near the front of a sturdy chair, feet under your knees.', 'Lean forward and push through your hands and feet to stand.', 'Reach back for the seat and sit down slowly.'] });
  move('sq_sts', 'sitStand', { ...STS, name: 'Sit to stand', range: [8, 20], start: 10,
    cues: ['Sit near the front of the chair, arms reaching forward.', 'Nose over toes, then stand up tall.', 'Sit back down slowly. Don\'t drop.'] });
  move('sq_sts_slow', 'sitStand', { ...STS, name: 'Sit to stand, 3-sec lowering', range: [6, 15], start: 8,
    cues: ['Arms forward, nose over toes, stand up tall.', SLOW, 'Touch the seat lightly, then stand again.'] }, { ecc: 3000 });
  move('lg_heel_wall', 'heelRaiseWall', { group: 'legs', name: 'Heel raises at a wall', req: ['wall'], load: null, pos: 'stand', support: true, range: [12, 30], start: 15, joints: ['ankle'],
    cues: ['Fingertips on the wall.', 'Rise up onto the balls of your feet.', 'Lower your heels slowly.'], mistake: 'Bouncing at the bottom.', breathe: 'Breathe out as you rise.' });
  const HP = { group: 'legs', load: null, joints: ['hip'], mistake: 'Leaning your body to lift the leg higher.', breathe: 'Breathe out as you lift.' };
  move('hp_ext_chair', 'hipExtChair', { ...HP, name: 'Standing hip extension', req: ['chair'], pos: 'stand', support: true, range: [10, 20], start: 12, uni: true,
    cues: ['Hands on a sturdy chair back, standing tall.', 'Take one straight leg back, squeezing your seat.', 'Don\'t arch your back.'] });
  move('hp_abd_wall', 'hipAbdWall', { ...HP, name: 'Standing side leg raise', req: ['wall'], pos: 'stand', support: true, range: [10, 20], start: 12, uni: true,
    cues: ['One hand on the wall, standing tall.', 'Lift your outside leg out to the side.', 'Toes point forward. Lower slowly.'] });
  move('hp_side_lift', 'sideLyingLift', { ...HP, name: 'Side-lying leg lift', req: [], pos: 'floor', range: [10, 25], start: 12, uni: true,
    cues: ['Lie on your side, head resting on your arm.', 'Lift your top leg, toes pointing forward.', 'Lower slowly.'] });
  const COF = { group: 'abs', load: null, req: [], joints: [], mistake: 'Holding your breath.', breathe: HOLD_BREATHE };
  move('co_wall_plank', 'wallPlank', { ...COF, name: 'Wall plank', req: ['wall'], pos: 'stand', timed: true, range: [15, 45], start: 20, joints: ['shoulder'],
    cues: ['Forearms on the wall, feet back a little.', 'Body in one straight line, head to heels.', 'Tighten your belly and hold.'], mistake: 'Letting your hips sag or stick out.' });

  /* ------------------------------------------------------------------ on the floor, gentle */
  move('co_birddog', 'birdDog', { ...COF, name: 'Bird dog', pos: 'kneel', hands: true, range: [6, 15], start: 8, uni: true, joints: ['back', 'wrist'],
    cues: ['Hands under shoulders, knees under hips.', 'Reach one arm forward and the other leg back.', 'Hold with your back still, then switch.'], mistake: 'Twisting your hips as the leg lifts.', breathe: 'Breathe out as you reach.' });
  move('co_pelvic', 'pelvicTilt', { ...COF, name: 'Pelvic tilt', pos: 'floor', range: [8, 20], start: 10, joints: ['back'],
    cues: ['Lie on your back, knees bent, feet flat.', 'Tighten your belly and press your lower back to the floor.', 'Hold, then relax.'], mistake: 'Lifting your hips off the floor.', breathe: 'Breathe out as you press your back down.' });
  move('co_prone_lift', 'proneLift', { ...COF, name: 'Prone chest lift', pos: 'floor', range: [6, 15], start: 8, joints: ['back'],
    cues: ['Lie face down, arms by your sides.', 'Lift your chest a little off the floor, eyes down.', 'Hold two seconds, then lower slowly.'], mistake: 'Throwing your head back.', breathe: 'Breathe out as you lift.' });

  /* ------------------------------------------------------------------ balance */
  // Timed holds a side at a time, from a hand on the wall to nothing to hold.
  const BAL = { group: 'balance', load: null, req: [], pos: 'stand', timed: true, joints: ['ankle'], mistake: 'Locking your standing knee.', breathe: 'Breathe slowly, eyes on a fixed point ahead.' };
  const NEAR = 'Stand close to a wall or counter, just in case.';
  move('bal_tandem_wall', 'tandemWall', { ...BAL, name: 'Heel-to-toe stand at a wall', req: ['wall'], support: true, range: [10, 45], start: 15, uni: true,
    cues: ['Fingertips on the wall.', 'One foot right in front of the other, heel to toe.', 'Stand tall and hold, then switch feet.'] });
  move('bal_tandem', 'tandem', { ...BAL, name: 'Heel-to-toe stand', oneLeg: true, range: [10, 45], start: 15, uni: true,
    cues: [NEAR, 'One foot right in front of the other, heel to toe.', 'Arms relaxed, hold still.'] });
  move('bal_one_wall', 'oneLegWall', { ...BAL, name: 'One-leg stand at a wall', req: ['wall'], support: true, range: [10, 45], start: 10, uni: true,
    cues: ['Fingertips on the wall.', 'Lift one foot just off the floor.', 'Stand tall and hold, then switch legs.'] });
  move('bal_walk', 'heelToe', { ...BAL, name: 'Heel-to-toe walk', oneLeg: true, range: [20, 60], start: 20,
    cues: ['Walk beside a wall or counter.', 'Put each heel right in front of the other toes.', 'Look ahead, not at your feet.'] });
  move('bal_step', 'stepOver', { ...BAL, name: 'Step-over', oneLeg: true, timed: false, range: [6, 15], start: 8, uni: true, joints: ['hip', 'ankle'],
    cues: [NEAR, 'Lift one knee high and step forward over a line.', 'Step back the same way.'] });
  move('bal_one', 'oneLeg', { ...BAL, name: 'One-leg stand', oneLeg: true, range: [10, 45], start: 10, uni: true,
    cues: [NEAR, 'Lift one foot off the floor.', 'Hold still, then switch legs.'] });
  move('bal_clock', 'clockReach', { ...BAL, name: 'Clock reach', oneLeg: true, timed: false, range: [4, 10], start: 5, uni: true, joints: ['ankle', 'hip'],
    cues: ['Stand on one leg, close to a wall or counter.', 'Reach forward, then up, then back behind you.', 'Keep your hips facing forward.'] });

  /* ------------------------------------------------------------------ getting down and up */
  const GET = { group: 'balance', load: null, req: ['chair'], pos: 'kneel', support: true, joints: ['knee', 'hip'], mistake: 'Rushing the way down.', breathe: 'Breathe out as you rise.' };
  move('get_halfkneel', 'halfKneel', { ...GET, name: 'Half-kneel with a chair', range: [3, 8], start: 3, uni: true,
    cues: ['A sturdy chair beside you, one hand on the seat.', 'Step back and lower one knee to a cushion.', 'Push through your front foot to stand.'] });
  move('get_kneel', 'tallKneel', { ...GET, name: 'Down to both knees and up', range: [2, 6], start: 2,
    cues: ['A hand on a sturdy chair seat, a cushion under your knees.', 'Lower one knee, then the other.', 'Come back up one leg at a time.'] });

  /* ------------------------------------------------------------------ gentle cardio and warm-ups, standing */
  const GCS = { ...GC, pos: 'stand', req: [] };
  move('fin_march_easy', 'marchEasy', { ...GCS, name: 'Easy march', joints: ['hip'],
    cues: ['Stand tall near a wall or counter.', 'March your knees up, arms swinging.', 'A steady pace you could talk at.'] });
  move('fin_step', 'stepTouch', { ...GCS, name: 'Step touch', quick: true, joints: ['knee', 'ankle'],
    cues: ['Step out to one side, bring the other foot in.', 'Then step the other way.', 'Swing your arms, keep it easy.'] });
  const MBS = { ...MB, pos: 'stand', req: [] };
  move('wu_march', 'marchEasy', { ...MBS, name: 'March in place', range: [30, 45], start: 30, joints: ['hip'],
    cues: ['Stand tall near a wall or counter.', 'March your knees up, arms swinging.', 'Start easy, then a little higher.'] });
  move('wu_heel', 'heelRaiseWall', { ...MBS, name: 'Heel raises at a wall', req: ['wall'], support: true, timed: false, range: [10, 10], start: 10, joints: ['ankle'],
    cues: ['Fingertips on the wall.', 'Rise onto the balls of your feet.', 'Lower slowly.'] });
  move('mob_calf', 'calfStretchWall', { ...MBS, name: 'Calf stretch at a wall', req: ['wall'], support: true, range: [30, 45], start: 30, uni: true, joints: ['ankle'],
    cues: ['Hands on the wall, one foot back.', 'Back heel down, back knee straight.', 'Lean in until you feel the calf stretch.'] });
  move('mob_quad', 'quadStretchWall', { ...MBS, name: 'Standing thigh stretch', req: ['wall'], support: true, range: [30, 45], start: 30, uni: true, joints: ['knee'],
    cues: ['One hand on the wall.', 'Hold your other foot behind you, knees together.', 'Stand tall. Use a towel round the foot if it\'s hard to reach.'] });

  /* ------------------------------------------------------------------ fast on the way up (power) */
  // From about 50, power (how quickly you can push) fades faster than strength, and it matters
  // for getting out of a chair or catching a trip. These are the same rung as their base move,
  // done fast on the way up and slow on the way down.
  function power(id, baseId, name, cues) {
    const b = MOVES[baseId];
    if (!b) return;
    const meta = {};
    for (const k of ['group', 'joints', 'req', 'load', 'range', 'start', 'uni', 'muscles', 'prime', 'pos', 'grip', 'deep', 'oneLeg', 'support', 'spine', 'complex']) if (b[k] !== undefined) meta[k] = clone(b[k]);
    move(id, b.form, Object.assign(meta, { name, powerOf: baseId, cues, mistake: 'Rushing the way down. Only the way up is fast.', breathe: 'Breathe out as you drive up.' }), { con: 450 });
  }
  power('sq_sts_power', 'sq_sts', 'Fast sit to stand', ['Arms forward, nose over toes.', 'Stand up as quickly as you can.', 'Sit back down slowly, in control.']);
  power('sq_bw_power', 'sq_bw', 'Fast-up squat', ['Lower slowly, chest up.', 'Drive up as fast as you can.', 'Stay on your feet, no jumping.']);
  power('sq_goblet_power', 'sq_goblet', 'Fast-up goblet squat', ['Hold the weight at your chest.', 'Lower slowly, then drive up fast.', 'Stay on your feet, no jumping.']);

  /* ------------------------------------------------------------------ ladders */
  // Sit to stand comes before the bodyweight squat: the first step for anyone who finds a squat
  // hard, and where a plan for an older body starts.
  LADDERS.squat.rungs = ['sq_sts_hands', 'sq_sts', 'sq_sts_slow'].concat(LADDERS.squat.rungs.filter((id) => !/^sq_sts/.test(id)));
  // Ladders marked alt only open when a plan needs them (src/access.js decides): balance and
  // floor practice for older bodies and balance problems, and seated or hands-free stand-ins for
  // when a health condition rules out every rung of a usual ladder.
  const NEW_LADDERS = {
    balance: { name: 'Balance', group: 'balance', alt: true, rungs: ['bal_seat_reach', 'bal_tandem_wall', 'bal_tandem', 'bal_one_wall', 'bal_walk', 'bal_step', 'bal_one', 'bal_clock'] },
    getup: { name: 'Down to the floor and up', group: 'balance', alt: true, rungs: ['get_halfkneel', 'get_kneel'] },
    pushAlt: { name: 'Chest, seated', group: 'chest', alt: true, rungs: ['ch_seat_squeeze', 'ch_seat_band', 'ch_seat_band_slow'] },
    rowAlt: { name: 'Back, seated', group: 'back', alt: true, rungs: ['bk_squeeze', 'bk_seat_row', 'bk_seat_pulldown', 'bk_seat_apart', 'bk_seat_db_row'] },
    raiseAlt: { name: 'Shoulders, seated', group: 'shoulders', alt: true, rungs: ['sh_seat_arm', 'sh_seat_hold', 'sh_seat_raise', 'sh_seat_press'] },
    curlAlt: { name: 'Biceps, seated', group: 'biceps', alt: true, rungs: ['cu_self', 'cu_seat_band', 'cu_seat_hammer', 'cu_seat', 'cu_seat_slow'] },
    triAlt: { name: 'Triceps, seated', group: 'triceps', alt: true, rungs: ['tr_self', 'tr_seat_oh', 'tr_seat_kick', 'tr_seat_oh_slow'] },
    legSeat: { name: 'Legs, seated', group: 'legs', alt: true, rungs: ['ls_march', 'ls_heel', 'ls_ext', 'ls_lift', 'ls_ext_hold', 'ls_press'] },
    hipAlt: { name: 'Hips, supported', group: 'legs', alt: true, rungs: ['hp_seat_hinge', 'hp_ext_chair', 'hp_abd_wall', 'lg_heel_wall', 'hp_side_lift'] },
    coreAlt: { name: 'Core, gentle', group: 'abs', alt: true, rungs: ['co_seat_brace', 'co_pelvic', 'co_wall_plank', 'co_birddog', 'co_seat_lean', 'co_prone_lift', 'co_seat_pallof'] },
    finGentle: { name: 'Gentle cardio', group: 'conditioning', alt: true, rungs: ['fin_seat_march', 'fin_seat_box', 'fin_march_easy', 'fin_step'] },
  };
  for (const [fam, lad] of Object.entries(NEW_LADDERS)) {
    if (LADDERS[fam]) throw new Error('moves-access: ladder ' + fam + ' already exists');
    lad.id = fam;
    LADDERS[fam] = lad;
  }
  for (const [fam, lad] of Object.entries(LADDERS)) {
    for (const id of lad.rungs) {
      if (!MOVES[id]) throw new Error('moves-access: ladder ' + fam + ' names unknown move ' + id);
      if (NEW_LADDERS[fam] || /^sq_sts/.test(id)) MOVES[id].family = MOVES[id].family || fam;
    }
  }
  // A fast-up version counts as its base move's rung.
  for (const m of Object.values(MOVES)) if (m.powerOf) m.family = MOVES[m.powerOf].family;

  /* ------------------------------------------------------------------ warm-ups, cool-downs, flows */
  // Lists of move ids; src/access.js picks the one that suits a plan and drops any move a
  // person's rules leave out.
  const FLOWS = {
    warmSeat: ['wu_seat_march', 'wu_seat_circles', 'mob_chin'],
    warmGentle: ['wu_march', 'wu_circles', 'wu_heel', 'wu_squat'],
    coolStand: ['mob_calf', 'mob_quad', 'mob_chest'],
    coolSeat: ['mob_seat_ham', 'mob_chest', 'mob_ankle'],
    // Every joint through its range, gently: the daily range-of-motion flow, and a flare day.
    rom: ['wu_seat_circles', 'mob_wrist', 'mob_chin', 'mob_chest', 'mob_seat_twist', 'mob_ankle', 'mob_seat_ham'],
    // A light day's mobility for someone who stays off the floor.
    mobilitySeat: ['wu_seat_circles', 'mob_chest', 'mob_seat_twist', 'mob_seat_ham', 'mob_ankle', 'mob_wrist'],
    mobilityStand: ['wu_march', 'mob_calf', 'mob_quad', 'mob_chest', 'mob_seat_twist', 'mob_seat_ham'],
  };
  for (const [k, list] of Object.entries(FLOWS)) for (const id of list) if (!MOVES[id]) throw new Error('moves-access: flow ' + k + ' names unknown move ' + id);
  MV.FLOWS = FLOWS;
  GH.movesAccess = { TAGS, merge, clone, ce, iso, cyc, move };
})(typeof window !== 'undefined' ? window : globalThis);
