/* Exercise library: forms (animations), moves (form + dosing + coaching) and ladders.
 *
 * Pose angles (see engine/pose.js): t torso lean (0 upright, 90 face-down, -90 face-up),
 * n neck, aN/aF arms {s shoulder, e elbow}, lN/lF legs {h hip, k knee, a ankle, flat, fd foot dir}.
 * rep steps: { to, ms, hold, ph: 'con' | 'ecc' | 'iso' | 'move' }.
 * req: equipment the move needs, e.g. ['db|kb', 'chair'] = (dumbbell or kettlebell) and a chair.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});

  /* ------------------------------------------------------------------ rep builders */
  const ce = (a, b, o = {}) => [
    { to: b, ms: o.con || 1000, hold: o.holdB != null ? o.holdB : 250, ph: 'con' },
    { to: a, ms: o.ecc || 2000, hold: o.holdA != null ? o.holdA : 300, ph: 'ecc' },
  ];
  const ec = (a, b, o = {}) => [
    { to: b, ms: o.ecc || 2000, hold: o.holdB != null ? o.holdB : 250, ph: 'ecc' },
    { to: a, ms: o.con || 1000, hold: o.holdA != null ? o.holdA : 300, ph: 'con' },
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

  /* ------------------------------------------------------------------ shared poses */
  const FLOOR_ANKLE = { joint: 'anN', at: [0, -8] };
  const SUPINE_HIP = { joint: 'hip', at: [0, -11] };
  const STAND = { t: 0, aN: { s: 4, e: 10 }, lN: { h: 0, k: 2 } };
  const SUPINE = { t: -90, n: 0, aN: { s: 0, e: 0 }, lN: { h: 0, k: 0, flat: false, a: 30 } };
  const HOOK = { lN: { h: 45, k: 92 } }; // lying, knees up, feet flat
  const st = (o) => merge(STAND, o);
  const sup = (o) => merge(SUPINE, o);

  const DB2 = [{ type: 'db', hands: 'both', orient: 'end' }];
  const DB2S = [{ type: 'db', hands: 'both', orient: 'side' }];
  const DBN = [{ type: 'db', hands: 'N', orient: 'end' }];
  const DBNS = [{ type: 'db', hands: 'N', orient: 'side' }];
  const KB2 = [{ type: 'kb', hands: 'both', hold: 'arm' }];
  const KBN = [{ type: 'kb', hands: 'N', hold: 'arm' }];
  const BALL = [{ type: 'ball', hands: 'both' }];
  const CHAIR_BEHIND = { type: 'box', x: -48, w: 46, h: 45, back: 0 };

  /* ------------------------------------------------------------------ forms */
  const F = {};

  // Curls ----------------------------------------------------------------------------
  F.curl = {
    view: 'side', pin: FLOOR_ANKLE, equip: DB2, key: 'b',
    poses: { a: st({ aN: { s: 6, e: 8 } }), b: st({ aN: { s: 14, e: 138 } }) },
    rep: ce('a', 'b'), muscles: ['biceps', 'forearms'],
  };
  F.hammer = merge(F.curl, { equip: DB2S });
  F.bandCurl = merge(F.curl, { equip: [{ type: 'band', hands: 'both', from: 'toN' }] });
  F.towelCurl = {
    view: 'side', pin: { joint: 'hip', at: [0, -54] }, key: 'a', props: [{ type: 'chair', x: -28, w: 40, h: 45, back: -1 }],
    equip: [{ type: 'towel', hands: 'both', from: 'toN' }],
    poses: {
      a: { t: 8, aN: { s: 22, e: 92 }, lN: { h: 98, k: 30, flat: false, a: 10 }, lF: { h: 98, k: 90 } },
      a2: { t: 9, aN: { s: 20, e: 96 }, lN: { h: 100, k: 30, flat: false, a: 10 }, lF: { h: 98, k: 90 } },
    },
    rep: iso('a', 'a2'), muscles: ['biceps', 'forearms'], leadLimbs: ['aN'],
  };
  const ONE_ARM_POSES = { a: { aF: { s: 4, e: 10 } }, b: { aF: { s: 4, e: 10 } } };
  F.curl1 = merge(F.curl, { equip: DBN, poses: ONE_ARM_POSES, uni: true, leadLimbs: ['aN'] });
  F.hammer1 = merge(F.hammer, { equip: DBNS, poses: ONE_ARM_POSES, uni: true, leadLimbs: ['aN'] });
  F.concCurl = {
    view: 'side', pin: { joint: 'hip', at: [0, -54] }, key: 'b',
    props: [{ type: 'chair', x: -30, w: 42, h: 45, back: -1 }], equip: DBN,
    poses: {
      a: { t: 32, aN: { s: 33, e: 8 }, aF: { s: 70, e: 45 }, lN: { h: 122, k: 90 } },
      b: { t: 32, aN: { s: 37, e: 132 }, aF: { s: 70, e: 45 }, lN: { h: 122, k: 90 } },
    },
    rep: ce('a', 'b'), muscles: ['biceps', 'forearms'], uni: true, leadLimbs: ['aN'],
  };

  // Triceps ----------------------------------------------------------------------------
  F.skull = {
    view: 'side', pin: SUPINE_HIP, equip: DB2S, key: 'b',
    poses: { a: sup(merge(HOOK, { aN: { s: 90, e: 0 } })), b: sup(merge(HOOK, { aN: { s: 96, e: 112 } })) },
    rep: ec('a', 'b'), muscles: ['triceps'],
  };
  F.ohExt = {
    view: 'side', pin: FLOOR_ANKLE, equip: KB2, equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side' }] }, key: 'b',
    poses: { a: st({ aN: { s: 172, e: 6 } }), b: st({ aN: { s: 166, e: 128 } }) },
    rep: ec('a', 'b'), muscles: ['triceps'],
  };
  F.ohExt1 = merge(F.ohExt, { equip: [{ type: 'db', hands: 'N', orient: 'side' }], poses: { a: { aF: { s: 4, e: 10 } }, b: { aF: { s: 4, e: 10 } } }, uni: true, leadLimbs: ['aN'] });
  F.pushdown = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'door', x: 52 }],
    equip: [{ type: 'band', hands: 'both', from: [52, -196] }],
    poses: { a: st({ t: 6, aN: { s: 6, e: 105 } }), b: st({ t: 6, aN: { s: 2, e: 6 } }) },
    rep: ce('a', 'b'), muscles: ['triceps'],
  };
  F.dipBent = {
    view: 'side', pin: { joint: 'hip' }, key: 'b', props: [CHAIR_BEHIND],
    poses: {
      a: { at: [11, -50], t: 4, ik: { hdN: [-3, -47], anN: [60, -8] }, lN: { flat: true } },
      b: { at: [11, -26], t: 10, ik: { hdN: [-3, -47], anN: [60, -8] }, lN: { flat: true } },
    },
    rep: ec('a', 'b'), muscles: ['triceps', 'chest', 'frontDelts'],
  };
  F.dipStraight = {
    view: 'side', pin: { joint: 'hip' }, key: 'b', props: [CHAIR_BEHIND],
    poses: {
      a: { at: [11, -50], t: 4, ik: { hdN: [-3, -47], anN: [80, -6] }, lN: { flat: false, a: 30 } },
      b: { at: [11, -27], t: 10, ik: { hdN: [-3, -47], anN: [80, -6] }, lN: { flat: false, a: 30 } },
    },
    rep: ec('a', 'b'), muscles: ['triceps', 'chest', 'frontDelts'],
  };

  // Push-ups ---------------------------------------------------------------------------
  const TOES = { joint: 'toN', at: [0, -1] };
  const plank = (t, hand, o) => merge({ t, n: -8, lN: { h: 0, k: 0, flat: false, a: 0 }, ik: { hdN: hand } }, o || {});
  F.pushup = {
    view: 'side', pin: TOES, key: 'b',
    poses: { a: plank(71, [124, -3]), b: plank(87, [124, -3]) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.kneePush = {
    view: 'side', pin: { joint: 'knN', at: [0, -6] }, key: 'b',
    poses: {
      a: { t: 55, n: -8, lN: { h: 0, k: 115, flat: false, a: 0 }, ik: { hdN: [78, -3] } },
      b: { t: 78, n: -8, lN: { h: 0, k: 115, flat: false, a: 0 }, ik: { hdN: [78, -3] } },
    },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.wallPush = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'wall', x: 78, side: 1 }],
    poses: {
      a: { t: 18, n: -5, lN: { h: 0, k: 0 }, ik: { hdN: [76, -128] } },
      b: { t: 30, n: -5, lN: { h: 0, k: 0 }, ik: { hdN: [76, -128] } },
    },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.inclinePush = {
    view: 'side', pin: TOES, key: 'b', props: [{ type: 'box', x: 96, w: 60, h: 45 }],
    poses: { a: plank(47, [101, -48]), b: plank(63, [101, -48]) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.declinePush = {
    view: 'side', pin: { joint: 'toN', at: [0, -46] }, key: 'b', props: [{ type: 'box', x: -48, w: 52, h: 45 }],
    poses: { a: plank(91, [128, -3], { n: -14 }), b: plank(106, [128, -3], { n: -14 }) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.archer = {
    view: 'front', pin: { joint: 'hip', at: [0, -34] }, key: 'b', armLayer: 'front', legLayer: 'back',
    poses: {
      a: { ts: 0.32, ns: 0.45, sc: { thN: 0.2, thF: 0.2, shN: 0.2, shF: 0.2 }, lN: { h: 6, k: 0 }, ik: { hdN: [44, -3], hdF: [-44, -3] } },
      b: { at: [14, -22], ts: 0.3, ns: 0.4, sc: { thN: 0.2, thF: 0.2, shN: 0.2, shF: 0.2 }, lN: { h: 6, k: 0 }, ik: { hdN: [44, -3], hdF: [-44, -3] } },
    },
    bend: { hdN: 1, hdF: 1 },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'], uni: true, leadLimbs: ['aN'],
  };
  F.floorPress = {
    view: 'side', pin: SUPINE_HIP, equip: DB2, key: 'b',
    poses: { a: sup(merge(HOOK, { aN: { s: 90, e: 0 } })), b: sup(merge(HOOK, { aN: { s: 18, e: 72 } })) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps'],
  };
  F.floorPress1 = merge(F.floorPress, { equip: DBN, poses: { a: { aF: { s: 0, e: 0 } }, b: { aF: { s: 0, e: 0 } } }, uni: true, leadLimbs: ['aN'] });
  F.floorFly = {
    view: 'top', pin: { joint: 'hip', at: [0, 0] }, equip: DB2, key: 'b', props: [{ type: 'mat', x: -95, w: 190, h: 64 }],
    poses: {
      a: { sc: { uaN: 0.25, uaF: 0.25, faN: 0.25, faF: 0.25 }, aN: { s: 60, e: 0 }, lN: { h: 4, k: 0 } },
      b: { sc: { uaN: 1, uaF: 1, faN: 1, faF: 1 }, aN: { s: 88, e: 14 }, lN: { h: 4, k: 0 } },
    },
    rep: ec('a', 'b'), muscles: ['chest'],
  };

  // Squats and lunges ------------------------------------------------------------------
  F.squatBW = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b',
    poses: { a: st({ aN: { s: 10, e: 10 } }), b: { t: 30, n: -12, aN: { s: 118, e: 4 }, lN: { h: 114, k: 109 } } },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'],
  };
  F.goblet = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'kb', hands: 'both', hold: 'hang' }],
    equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side', tilt: 90 }] },
    poses: { a: st({ aN: { s: 22, e: 128 } }), b: { t: 30, n: -12, aN: { s: 22, e: 128 }, lN: { h: 114, k: 109 } } },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'],
  };
  const SPLIT = { joint: 'anN', at: [28, -8] };
  F.split = {
    view: 'side', pin: SPLIT, key: 'b',
    poses: {
      a: { t: 0, aN: { s: 4, e: 12 }, lN: { h: 38, k: 30 }, lF: { flat: false, a: 55 }, ik: { anF: [-48, -14] } },
      b: { t: 4, aN: { s: 8, e: 12 }, lN: { h: 90, k: 90 }, lF: { flat: false, a: 55 }, ik: { anF: [-48, -14] } },
    },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.lunge = {
    view: 'side', pin: SPLIT, key: 'b',
    poses: {
      a: { t: 0, aN: { s: 4, e: 12 }, lN: { h: 0, k: 2 }, lF: { flat: true }, ik: { anF: [28, -8] } },
      step: { t: 2, aN: { s: 6, e: 12 }, lN: { h: 26, k: 24 }, lF: { flat: false, a: 30 }, ik: { anF: [-14, -26] } },
      b: { t: 4, aN: { s: 8, e: 12 }, lN: { h: 90, k: 90 }, lF: { flat: false, a: 55 }, ik: { anF: [-48, -14] } },
    },
    rep: [
      { to: 'step', ms: 650, hold: 0, ph: 'move' }, { to: 'b', ms: 1300, hold: 250, ph: 'ecc' },
      { to: 'step', ms: 800, hold: 0, ph: 'con' }, { to: 'a', ms: 600, hold: 350, ph: 'move' },
    ],
    muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.bulgarian = {
    view: 'side', pin: { joint: 'anN', at: [34, -8] }, key: 'b', props: [{ type: 'box', x: -108, w: 50, h: 45 }],
    poses: {
      a: { t: 6, aN: { s: 6, e: 12 }, lN: { h: 34, k: 24 }, lF: { fd: -90 }, ik: { anF: [-63, -52] } },
      b: { t: 14, aN: { s: 12, e: 12 }, lN: { h: 100, k: 98 }, lF: { fd: -90 }, ik: { anF: [-63, -52] } },
    },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.pistol = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'chair', x: -62, w: 46, h: 45, back: -1 }],
    poses: {
      a: { t: 0, aN: { s: 90, e: 0 }, lN: { h: 0, k: 2 }, lF: { h: 32, k: 6, flat: false, a: 10 } },
      b: { t: 36, n: -10, aN: { s: 124, e: 0 }, lN: { h: 110, k: 115 }, lF: { h: 128, k: 4, flat: false, a: 10 } },
    },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.wallSit = {
    view: 'side', pin: { joint: 'hip', at: [0, -51] }, key: 'a', props: [{ type: 'wall', x: -12, side: -1 }],
    poses: { a: { t: 0, aN: { s: 30, e: 30 }, lN: { h: 90, k: 90 } }, a2: { t: 1, aN: { s: 30, e: 32 }, lN: { h: 90, k: 90 } } },
    rep: iso('a', 'a2'), muscles: ['quads', 'glutes'],
  };
  F.jumpSquat = {
    view: 'side', pin: { joint: 'anN' }, key: 'b',
    poses: {
      a: { at: [0, -8], t: 30, n: -12, aN: { s: -20, e: 10 }, lN: { h: 114, k: 109 } },
      b: { at: [0, -30], t: 2, aN: { s: 150, e: 10 }, lN: { h: 0, k: 4, flat: false, a: 40 } },
    },
    rep: [{ to: 'b', ms: 420, hold: 60, ph: 'con' }, { to: 'a', ms: 620, hold: 350, ph: 'ecc' }],
    muscles: ['quads', 'glutes', 'calves'],
  };

  // Hinges -------------------------------------------------------------------------------
  F.kbDeadlift = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: KB2, equipBy: { db: DB2S },
    poses: { a: st({ aN: { s: 4, e: 6 } }), b: { t: 45, n: -18, aN: { s: 45, e: 4 }, lN: { h: 125, k: 110 } } },
    rep: ec('a', 'b'), muscles: ['glutes', 'hamstrings', 'lowerBack'],
  };
  F.swing = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: KB2, equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side', tilt: 90 }] },
    poses: {
      a: { t: 62, n: -20, aN: { s: 37, e: 0 }, lN: { h: 95, k: 45 } },
      b: { t: -4, aN: { s: 88, e: 0 }, lN: { h: 0, k: 0 } },
    },
    rep: [{ to: 'b', ms: 620, hold: 120, ph: 'con' }, { to: 'a', ms: 620, hold: 60, ph: 'ecc' }],
    muscles: ['glutes', 'hamstrings', 'lowerBack'],
  };
  F.swing1 = merge(F.swing, { equip: KBN, equipBy: { db: [{ type: 'db', hands: 'N', orient: 'side', tilt: 90 }] }, uni: true, leadLimbs: ['aN'] });
  F.staggerRdl = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: KB2, equipBy: { db: DB2S },
    poses: {
      a: { t: 0, aN: { s: 4, e: 6 }, lN: { h: 0, k: 4 }, lF: { flat: false, a: 40 }, ik: { anF: [-20, -14] } },
      b: { t: 72, n: -20, aN: { s: 72, e: 4 }, lN: { h: 84, k: 20 }, lF: { flat: false, a: 40 }, ik: { anF: [-20, -14] } },
    },
    rep: ec('a', 'b'), muscles: ['hamstrings', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.sldl = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'kb', hands: 'F', hold: 'arm', layer: 'far' }],
    equipBy: { db: [{ type: 'db', hands: 'F', orient: 'side' }] },
    poses: {
      a: { t: 0, aN: { s: 30, e: 20 }, aF: { s: 4, e: 6 }, lN: { h: 0, k: 5 }, lF: { h: -12, k: 24, flat: false, a: 30 } },
      b: { t: 80, n: -22, aN: { s: 150, e: 10 }, aF: { s: 80, e: 4 }, lN: { h: 88, k: 18 }, lF: { h: 2, k: 0, flat: false, a: 0 } },
    },
    rep: ec('a', 'b'), muscles: ['hamstrings', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  F.bridge = {
    view: 'side', pin: { joint: 'neck', at: [-50, -11] }, key: 'b',
    poses: {
      a: sup({ aN: { s: 0, e: 0 }, lN: { flat: true }, ik: { anN: [45, -8] } }),
      b: sup({ t: -108, aN: { s: -18, e: 0 }, lN: { flat: true }, ik: { anN: [45, -8] } }),
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes', 'hamstrings'],
  };
  F.kbBridge = merge(F.bridge, { equip: [{ type: 'kb', hold: 'hip' }], equipBy: { db: [{ type: 'db', hands: 'N', orient: 'end' }] },
    poses: { a: { aN: { s: 14, e: 100 } }, b: { aN: { s: 30, e: 100 } } } });
  F.thrust = {
    view: 'side', pin: { joint: 'neck', at: [-42, -52] }, key: 'b', props: [{ type: 'box', x: -104, w: 64, h: 45 }],
    equip: [{ type: 'kb', hold: 'hip' }],
    poses: {
      a: { t: -42, n: 20, aN: { s: 10, e: 90 }, lN: { flat: true }, ik: { anN: [50, -8] } },
      b: { t: -90, n: 34, aN: { s: 26, e: 90 }, lN: { flat: true }, ik: { anN: [50, -8] } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes', 'hamstrings'],
  };
  F.bridge1 = merge(F.bridge, { poses: { a: { lF: { h: 70, k: 0, flat: false, a: 10 } }, b: { lF: { h: 88, k: 0, flat: false, a: 10 } } }, uni: true, leadLimbs: ['lN'] });
  F.thrust1 = merge(F.thrust, { equip: [], poses: { a: { lF: { h: 110, k: 0, flat: false, a: 10 } }, b: { lF: { h: 150, k: 0, flat: false, a: 10 } } }, uni: true, leadLimbs: ['lN'] });

  // Rows and pulls ---------------------------------------------------------------------
  const HINGE_ROW = { t: 60, n: -18, lN: { h: 85, k: 35 } };
  F.row = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: DB2S, equipBy: { kb: KB2 },
    poses: { a: merge(HINGE_ROW, { aN: { s: 60, e: 4 } }), b: merge(HINGE_ROW, { aN: { s: -16, e: 84 } }) },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'],
  };
  F.row1 = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: DBNS, equipBy: { kb: KBN }, props: [{ type: 'chair', x: 58, w: 46, h: 45, back: 1 }],
    poses: {
      a: { t: 76, n: -22, lN: { h: 96, k: 40 }, aN: { s: 76, e: 4 }, ik: { hdF: [62, -48] } },
      b: { t: 76, n: -22, lN: { h: 96, k: 40 }, aN: { s: -2, e: 86 }, ik: { hdF: [62, -48] } },
    },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'], uni: true, leadLimbs: ['aN'],
  };
  F.bandRow = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'door', x: 96 }],
    equip: [{ type: 'band', hands: 'both', from: [96, -110] }],
    poses: { a: st({ t: 8, aN: { s: 82, e: 2 }, lN: { h: 12, k: 14 } }), b: st({ t: 4, aN: { s: -18, e: 110 }, lN: { h: 12, k: 14 } }) },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'],
  };
  F.towelRow = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'door', x: 14 }],
    equip: [{ type: 'towel', hands: 'both', from: [14, -112] }],
    poses: {
      a: { t: -23, n: 12, lN: { h: 0, k: 0 }, ik: { hdN: [0, -112] } },
      b: { t: -6, n: 4, lN: { h: 0, k: 0 }, ik: { hdN: [0, -112] } },
    },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'biceps'],
  };
  F.tableRow = {
    view: 'side', pin: { joint: 'heN', at: [62, -3] }, key: 'b', props: [{ type: 'table', x: -152, w: 82, h: 72 }],
    poses: {
      a: { t: -86, n: 6, lN: { h: 0, k: 0, flat: false, a: -10 }, ik: { hdN: [-74, -70] } },
      b: { t: -64, n: 14, lN: { h: 0, k: 0, flat: false, a: -10 }, ik: { hdN: [-74, -70] } },
    },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'biceps'],
  };
  const BAR = { type: 'bar', x1: -4, x2: 4, y: -226 };
  F.hang = {
    view: 'side', pin: { joint: 'hdN', at: [0, -224] }, key: 'a', props: [BAR],
    poses: { a: { t: 0, aN: { s: 178, e: 2 }, lN: { h: 8, k: 28, flat: false, a: 30 } }, a2: { t: 1, aN: { s: 176, e: 4 }, lN: { h: 8, k: 30, flat: false, a: 30 } } },
    rep: iso('a', 'a2', 2400), muscles: ['lats', 'forearms'],
  };
  F.scapPull = merge(F.hang, { key: 'b', poses: { b: { t: -4, aN: { s: 168, e: 2 }, lN: { h: 8, k: 28, flat: false, a: 30 } } }, rep: ce('a', 'b', { con: 700, ecc: 1200 }) });
  F.chin = {
    view: 'side', pin: { joint: 'hdN', at: [0, -224] }, key: 'b', props: [BAR],
    poses: {
      a: { t: 0, aN: { s: 178, e: 4 }, lN: { h: 10, k: 34, flat: false, a: 30 } },
      b: { t: -10, n: -10, aN: { s: 150, e: 140 }, lN: { h: 18, k: 40, flat: false, a: 30 } },
    },
    rep: ce('a', 'b', { con: 1100, ecc: 2200 }), muscles: ['lats', 'biceps', 'upperBack'],
  };
  F.negative = merge(F.chin, { rep: [{ to: 'a', ms: 4000, hold: 400, ph: 'ecc' }, { to: 'b', ms: 900, hold: 500, ph: 'move' }] });

  // Rear delts / upper back --------------------------------------------------------------
  const FRONT_STAND = { joint: 'anN', at: [9, -8] };
  F.pullApart = {
    view: 'front', pin: FRONT_STAND, key: 'b', armLayer: 'front',
    equip: [{ type: 'band', hands: 'both', between: true }],
    poses: {
      a: { sc: { uaN: 0.35, uaF: 0.35, faN: 0.35, faF: 0.35 }, aN: { s: 78, e: 0 } },
      b: { sc: { uaN: 1, uaF: 1, faN: 1, faF: 1 }, aN: { s: 90, e: 2 } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['rearDelts', 'upperBack'],
  };
  F.towelApart = merge(F.pullApart, {
    key: 'a', equip: [{ type: 'towel', hands: 'both', between: true }],
    poses: { a: { sc: { uaN: 0.42, uaF: 0.42, faN: 0.42, faF: 0.42 }, aN: { s: 80, e: 0 } }, a2: { sc: { uaN: 0.46, uaF: 0.46, faN: 0.46, faF: 0.46 }, aN: { s: 83, e: 0 } } },
    rep: iso('a', 'a2', 1800),
  });
  F.ytw = {
    view: 'top', pin: { joint: 'hip', at: [0, 0] }, key: 'y', props: [{ type: 'mat', x: -100, w: 200, h: 66 }],
    poses: { y: { aN: { s: 148, e: 0 }, lN: { h: 3, k: 0 } }, t: { aN: { s: 92, e: 0 }, lN: { h: 3, k: 0 } }, w: { aN: { s: 58, e: 96 }, lN: { h: 3, k: 0 } } },
    rep: cyc(['y', 't', 'w'], 900, 700, 'con'), muscles: ['rearDelts', 'upperBack'],
  };
  F.revFly = {
    view: 'front', pin: FRONT_STAND, key: 'b', equip: DB2, armLayer: 'front',
    poses: {
      a: { ts: 0.55, ns: 0.55, n: 0, sc: { thN: 0.95, thF: 0.95 }, lN: { h: 4, k: 0 }, aN: { s: 14, e: 10 } },
      b: { ts: 0.55, ns: 0.55, n: 0, sc: { thN: 0.95, thF: 0.95 }, lN: { h: 4, k: 0 }, aN: { s: 78, e: 14 } },
    },
    rep: ce('a', 'b'), muscles: ['rearDelts', 'upperBack'],
  };

  // Shoulders ----------------------------------------------------------------------------
  F.latRaise = {
    view: 'front', pin: FRONT_STAND, key: 'b', equip: DB2, armLayer: 'front',
    poses: { a: { aN: { s: 10, e: 10 }, lN: { h: 3 } }, b: { aN: { s: 86, e: 12 }, lN: { h: 3 } } },
    rep: ce('a', 'b'), muscles: ['sideDelts'],
  };
  F.latRaise1 = {
    view: 'front', pin: FRONT_STAND, key: 'b', equip: DBN, armLayer: 'front', props: [{ type: 'wall', x: -58, side: -1 }],
    poses: {
      a: { t: 8, aN: { s: 12, e: 10 }, lN: { h: 3 }, ik: { hdF: [-54, -122] } },
      b: { t: 8, aN: { s: 90, e: 12 }, lN: { h: 3 }, ik: { hdF: [-54, -122] } },
    },
    rep: ce('a', 'b'), muscles: ['sideDelts'], uni: true, leadLimbs: ['aN'],
  };

  // Abs -----------------------------------------------------------------------------------
  const TABLE_TOP = { h: 90, k: 90, flat: false, a: 10 };
  F.deadBug = {
    view: 'side', pin: SUPINE_HIP, key: 'b',
    poses: {
      a: sup({ aN: { s: 90, e: 0 }, lN: TABLE_TOP }),
      b: sup({ aN: { s: 168, e: 0 }, aF: { s: 90, e: 0 }, lN: TABLE_TOP, lF: { h: 18, k: 0, flat: false, a: 10 } }),
      c: sup({ aN: { s: 90, e: 0 }, aF: { s: 168, e: 0 }, lN: { h: 18, k: 0, flat: false, a: 10 }, lF: TABLE_TOP }),
    },
    rep: [{ to: 'b', ms: 1400, hold: 300, ph: 'con' }, { to: 'a', ms: 1200, hold: 200, ph: 'ecc' }, { to: 'c', ms: 1400, hold: 300, ph: 'con' }, { to: 'a', ms: 1200, hold: 200, ph: 'ecc' }],
    muscles: ['abs'],
  };
  F.revCrunch = {
    view: 'side', pin: { joint: 'neck', at: [-50, -11] }, key: 'b',
    poses: { a: sup({ aN: { s: 0 }, lN: TABLE_TOP }), b: sup({ t: -103, aN: { s: -13 }, lN: { h: 128, k: 112, flat: false, a: 10 } }) },
    rep: ce('a', 'b'), muscles: ['abs', 'hipFlexors'],
  };
  F.legRaise = {
    view: 'side', pin: SUPINE_HIP, key: 'b',
    poses: { a: sup({ aN: { s: 0 }, lN: { h: 16, k: 0, flat: false, a: 10 } }), b: sup({ aN: { s: 0 }, lN: { h: 88, k: 0, flat: false, a: 10 } }) },
    rep: ce('a', 'b', { holdA: 150 }), muscles: ['abs', 'hipFlexors'],
  };
  F.hollow = {
    view: 'side', pin: SUPINE_HIP, key: 'a',
    poses: {
      a: sup({ t: -78, n: 16, aN: { s: 176, e: 0 }, lN: { h: 22, k: 0, flat: false, a: 10 } }),
      a2: sup({ t: -80, n: 16, aN: { s: 174, e: 0 }, lN: { h: 20, k: 0, flat: false, a: 10 } }),
    },
    rep: iso('a', 'a2'), muscles: ['abs'],
  };
  F.vup = {
    view: 'side', pin: SUPINE_HIP, key: 'b',
    poses: {
      a: sup({ t: -86, aN: { s: 176, e: 0 }, lN: { h: 8, k: 0, flat: false, a: 10 } }),
      b: sup({ t: -42, n: 10, aN: { s: 82, e: 0 }, lN: { h: 96, k: 0, flat: false, a: 10 } }),
    },
    rep: ce('a', 'b', { con: 900, ecc: 1600 }), muscles: ['abs', 'hipFlexors'],
  };
  const CRUNCH_FEET = { ik: { anN: [44, -8] }, lN: { flat: true } };
  F.crunch = {
    view: 'side', pin: SUPINE_HIP, key: 'b',
    poses: { a: sup(merge(CRUNCH_FEET, { aN: { s: 110, e: 143 } })), b: sup(merge(CRUNCH_FEET, { t: -66, n: 12, aN: { s: 110, e: 143 } })) },
    rep: ce('a', 'b'), muscles: ['abs'],
  };
  F.kbCrunch = merge(F.crunch, {
    equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side' }], ball: BALL },
    poses: { a: { aN: { s: 10, e: 82 } }, b: { aN: { s: 10, e: 82 } } },
  });
  F.kbCrunchArms = merge(F.crunch, {
    equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side' }], ball: BALL },
    poses: { a: { aN: { s: 86, e: 0 } }, b: { aN: { s: 70, e: 0 } } },
  });
  F.situp = {
    view: 'side', pin: SUPINE_HIP, key: 'b', props: [{ type: 'box', x: 48, w: 62, h: 45 }],
    equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side' }], ball: BALL },
    poses: {
      a: sup({ aN: { s: 10, e: 82 }, lN: { flat: false, a: 0 }, ik: { anN: [52, -8] } }),
      b: sup({ t: -12, n: 4, aN: { s: 10, e: 82 }, lN: { flat: false, a: 0 }, ik: { anN: [52, -8] } }),
    },
    rep: ce('a', 'b', { con: 1100, ecc: 2000 }), muscles: ['abs', 'hipFlexors'],
  };

  // Rotation (front view) ------------------------------------------------------------------
  const SEATED_FRONT = { joint: 'hip', at: [0, -12] };
  const twist = (bx, tw, o) => merge({
    ts: 0.84, ns: 0.9, tw, ball: [bx, -52], ik: { hdN: [bx + 5, -50], hdF: [bx - 5, -50] },
    lN: { h: 160, k: 158 }, sc: { thN: 0.42, thF: 0.42, shN: 0.52, shF: 0.52 },
  }, o || {});
  F.russian = {
    view: 'front', pin: SEATED_FRONT, key: 'l', armLayer: 'front', legLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: { m: twist(0, 0), l: twist(26, 34), r: twist(-26, -34) },
    rep: [{ to: 'l', ms: 900, hold: 150, ph: 'con' }, { to: 'm', ms: 700, hold: 0, ph: 'move' }, { to: 'r', ms: 900, hold: 150, ph: 'con' }, { to: 'm', ms: 700, hold: 0, ph: 'move' }],
    muscles: ['obliques', 'abs'],
  };
  const FEET_UP = { lN: { h: 168, k: 120, flat: false }, sc: { thN: 0.42, thF: 0.42, shN: 0.4, shF: 0.4 } };
  F.russianUp = merge(F.russian, { poses: { m: FEET_UP, l: FEET_UP, r: FEET_UP } });
  F.chop = {
    view: 'front', pin: { joint: 'anN', at: [22, -8] }, key: 'b', armLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { tw: 36, ball: [34, -176], ik: { hdN: [38, -172], hdF: [30, -172] }, lN: { h: 9, k: 0 } },
      b: { tw: -36, ball: [-18, -100], ik: { hdN: [-14, -104], hdF: [-22, -104] }, lN: { h: 9, k: 20 }, lF: { h: 9, k: 24 } },
    },
    rep: ce('a', 'b', { con: 800, ecc: 1300 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };
  F.kneelChop = {
    view: 'front', pin: { joint: 'knN', at: [12, -6] }, key: 'b', armLayer: 'front', legLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { tw: 34, ball: [32, -142], ik: { hdN: [36, -138], hdF: [28, -138] }, lN: { h: 4, k: 0 }, lF: { h: 150, k: 150 }, sc: { shN: 0.02, ftN: 0.2, thF: 0.35 } },
      b: { tw: -34, ball: [-26, -52], ik: { hdN: [-22, -56], hdF: [-30, -56] }, lN: { h: 4, k: 0 }, lF: { h: 150, k: 150 }, sc: { shN: 0.02, ftN: 0.2, thF: 0.35 } },
    },
    rep: ce('a', 'b', { con: 800, ecc: 1300 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };
  F.slam = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { t: -4, aN: { s: 176, e: 12 }, lN: { h: 0, k: 0, flat: false, a: 18 }, ball: [4, -212] },
      b: { t: 52, n: -20, aN: { s: 74, e: 6 }, lN: { h: 88, k: 50 }, ball: [48, -8] },
    },
    rep: [{ to: 'b', ms: 420, hold: 250, ph: 'con' }, { to: 'a', ms: 900, hold: 250, ph: 'move' }],
    muscles: ['abs', 'lats'],
  };
  F.toss = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { t: 0, aN: { s: 32, e: 118 }, lN: { h: 18, k: 30 }, ball: [22, -126] },
      b: { t: -2, aN: { s: 172, e: 8 }, lN: { h: 0, k: 0 }, ball: [6, -214] },
      c: { t: -2, aN: { s: 172, e: 8 }, lN: { h: 0, k: 0 }, ball: [8, -262] },
    },
    rep: [{ to: 'b', ms: 450, hold: 0, ph: 'con' }, { to: 'c', ms: 450, hold: 100, ph: 'move' }, { to: 'b', ms: 450, hold: 0, ph: 'move' }, { to: 'a', ms: 650, hold: 300, ph: 'ecc' }],
    muscles: ['abs', 'frontDelts'],
  };

  // Side plank / carries (front view) -----------------------------------------------------
  F.sidePlankKnee = {
    view: 'front', pin: { joint: 'elN', at: [60, -5] }, key: 'a', armLayer: 'front', legLayer: 'back',
    poses: {
      a: { t: 70, ns: 1, aN: { s: 70, e: 90 }, aF: { s: 40, e: 60 }, lN: { h: 0, k: 90 }, sc: { faN: 0.2, shN: 0.28, shF: 0.28 } },
      a2: { t: 68, ns: 1, aN: { s: 68, e: 90 }, aF: { s: 40, e: 60 }, lN: { h: 0, k: 90 }, sc: { faN: 0.2, shN: 0.28, shF: 0.28 } },
    },
    rep: iso('a', 'a2'), muscles: ['obliques', 'abs'], uni: true, leadLimbs: ['aN'],
  };
  F.sidePlank = merge(F.sidePlankKnee, {
    poses: { a: { t: 76, aN: { s: 76 }, lN: { h: 0, k: 0 }, sc: { shN: 1, shF: 1 } }, a2: { t: 74, aN: { s: 74 }, lN: { h: 0, k: 0 }, sc: { shN: 1, shF: 1 } } },
  });
  F.starPlank = merge(F.sidePlank, {
    poses: { a: { aF: { s: 120, e: 0 }, lF: { h: 36, k: 0 } }, a2: { aF: { s: 118, e: 0 }, lF: { h: 38, k: 0 } } },
  });
  const CARRY_HIP = { joint: 'hip', at: [0, -92] };
  F.carry = {
    view: 'front', pin: CARRY_HIP, key: 'a', armLayer: 'front', equip: [{ type: 'kb', hands: 'N', hold: 'arm' }],
    equipBy: { db: [{ type: 'db', hands: 'N', orient: 'end' }] },
    poses: {
      a: { aN: { s: 6, e: 4 }, aF: { s: 12, e: 12 }, lN: { h: 3, k: 0 }, lF: { h: 3, k: 0 } },
      b: { aN: { s: 6, e: 4 }, aF: { s: 12, e: 12 }, lN: { h: 3, k: 26 }, lF: { h: 3, k: 0 }, sc: { thN: 0.86 } },
      c: { aN: { s: 6, e: 4 }, aF: { s: 12, e: 12 }, lN: { h: 3, k: 0 }, lF: { h: 3, k: 26 }, sc: { thF: 0.86 } },
    },
    rep: cyc(['b', 'a', 'c', 'a'], 380, 40), muscles: ['obliques', 'forearms'], uni: true, leadLimbs: ['aN'],
  };
  F.march = merge(F.carry, {
    poses: { b: { lN: { k: 80 }, sc: { thN: 0.5 } }, c: { lF: { k: 80 }, sc: { thF: 0.5 } } },
    rep: cyc(['b', 'a', 'c', 'a'], 650, 250),
  });

  // Conditioning (bodyweight) -------------------------------------------------------------
  F.jacks = {
    view: 'front', pin: { joint: 'hip', at: [0, -93] }, key: 'b', armLayer: 'front',
    poses: { a: { aN: { s: 8, e: 6 }, lN: { h: 3, k: 0 } }, b: { at: [0, -98], aN: { s: 168, e: 6 }, lN: { h: 20, k: 0 } } },
    rep: cyc(['b', 'a'], 380, 40), muscles: ['calves', 'sideDelts'],
  };
  F.climbers = {
    view: 'side', pin: { joint: 'hdN', at: [124, -3] }, key: 'b',
    poses: {
      a: { t: 71, n: -8, aN: { s: 71, e: 0 }, lN: { h: 111, k: 130, flat: false, a: 30 }, lF: { h: 0, k: 0, flat: false, a: 0 } },
      b: { t: 71, n: -8, aN: { s: 71, e: 0 }, lN: { h: 0, k: 0, flat: false, a: 0 }, lF: { h: 111, k: 130, flat: false, a: 30 } },
      // Mid-switch: both knees under the hips with the feet kicked up, so nothing scrapes the floor.
      x: { t: 71, n: -8, aN: { s: 71, e: 0 }, lN: { h: 71, k: 120, flat: false, a: 30 } },
    },
    rep: [{ to: 'x', ms: 160, hold: 0, ph: 'move' }, { to: 'a', ms: 200, hold: 60, ph: 'move' }, { to: 'x', ms: 160, hold: 0, ph: 'move' }, { to: 'b', ms: 200, hold: 60, ph: 'move' }],
    muscles: ['abs', 'hipFlexors', 'frontDelts'],
  };
  F.burpee = {
    view: 'side', pin: { joint: 'hip' }, key: 'c',
    poses: {
      a: { at: [0, -93], t: 0, lN: { flat: true }, ik: { anN: [0, -8], hdN: [8, -86] } },
      b: { at: [-10, -40], t: 72, n: -20, lN: { flat: true }, ik: { anN: [0, -8], hdN: [36, -3] } },
      c: { at: [-12, -42], t: 72, n: -10, lN: { flat: false, a: 0 }, ik: { anN: [-92, -16], hdN: [36, -3] } },
      j: { at: [-11, -41], t: 72, n: -15, lN: { flat: false, a: 20 }, ik: { anN: [-46, -26], hdN: [36, -3] } }, // feet in the air mid-jump
      d: { at: [0, -118], t: -2, lN: { flat: false, a: 40 }, ik: { anN: [0, -34], hdN: [12, -224] } },
    },
    rep: [{ to: 'b', ms: 500, hold: 0, ph: 'move' }, { to: 'j', ms: 220, hold: 0, ph: 'move' }, { to: 'c', ms: 230, hold: 150, ph: 'move' }, { to: 'j', ms: 220, hold: 0, ph: 'move' }, { to: 'b', ms: 230, hold: 0, ph: 'move' }, { to: 'd', ms: 420, hold: 60, ph: 'con' }, { to: 'a', ms: 420, hold: 250, ph: 'move' }],
    muscles: ['quads', 'chest', 'abs'],
  };
  F.pulse = merge(F.squatBW, {
    poses: { a: { t: 20, aN: { s: 110, e: 4 }, lN: { h: 70, k: 72 } } },
    rep: cyc(['b', 'a'], 450, 40),
  });
  F.highKnees = {
    view: 'side', pin: { joint: 'hip', at: [0, -92] }, key: 'b',
    poses: {
      a: { t: 0, aN: { s: 30, e: 80 }, aF: { s: -30, e: 80 }, lN: { h: 80, k: 90, flat: false, a: 20 }, lF: { h: 0, k: 4 } },
      b: { t: 0, aN: { s: -30, e: 80 }, aF: { s: 30, e: 80 }, lN: { h: 0, k: 4 }, lF: { h: 80, k: 90, flat: false, a: 20 } },
    },
    rep: cyc(['b', 'a'], 420, 60), muscles: ['hipFlexors', 'quads'],
  };

  // Warm-up and mobility ---------------------------------------------------------------
  F.halo = {
    view: 'front', pin: FRONT_STAND, key: 'l', armLayer: 'front', equip: [{ type: 'kb', hold: 'hang' }],
    poses: {
      l: { kb: [20, -164], ik: { hdN: [22, -168], hdF: [16, -168] } },
      t: { kb: [0, -184], ik: { hdN: [4, -186], hdF: [-4, -186] } },
      r: { kb: [-20, -164], ik: { hdN: [-16, -168], hdF: [-22, -168] } },
      f: { kb: [0, -140], ik: { hdN: [4, -146], hdF: [-4, -146] } },
    },
    bend: { hdN: 1, hdF: 1 },
    rep: cyc(['t', 'r', 'f', 'l'], 600, 0), muscles: ['sideDelts', 'upperBack'],
  };
  F.armCircles = {
    view: 'front', pin: FRONT_STAND, key: 'a', armLayer: 'front',
    poses: { a: { aN: { s: 84, e: 0 } }, b: { aN: { s: 94, e: 0 } } },
    rep: cyc(['b', 'a'], 350, 0), muscles: ['sideDelts'],
  };
  F.wallAngel = {
    view: 'front', pin: FRONT_STAND, key: 'b', armLayer: 'front',
    poses: { a: { aN: { s: 88, e: 92 } }, b: { aN: { s: 160, e: 14 } } },
    rep: ce('a', 'b', { con: 1400, ecc: 1400 }), muscles: ['upperBack', 'rearDelts'],
  };
  const QUAD = { joint: 'knN', at: [0, -6] };
  const quad = (t, n) => ({ t, n, lN: { h: t, k: 90, flat: false, a: 90 }, ik: { hdN: [50, -3] } });
  F.catCow = {
    view: 'side', pin: QUAD, key: 'b',
    poses: { a: quad(80, -32), b: quad(77, 48) },
    rep: cyc(['b', 'a'], 1800, 500, 'iso'), muscles: ['lowerBack', 'abs'],
  };
  F.wgs = {
    view: 'side', pin: { joint: 'anN', at: [40, -8] }, key: 'b',
    poses: {
      a: { t: 84, n: -14, lN: { h: 161, k: 118 }, lF: { flat: false, a: 70 }, aN: { s: 56, e: 70 }, ik: { anF: [-46, -8], hdF: [68, -3] } },
      b: { t: 82, n: 30, lN: { h: 162, k: 115 }, lF: { flat: false, a: 70 }, aN: { s: 250, e: 0 }, ik: { anF: [-46, -8], hdF: [68, -3] } },
    },
    rep: cyc(['b', 'a'], 1600, 900, 'iso'), muscles: ['hipFlexors', 'hamstrings', 'upperBack'], uni: true, leadLimbs: ['lN', 'aN'],
  };
  F.hipFlexor = {
    view: 'side', pin: { joint: 'anN', at: [38, -8] }, key: 'b',
    poses: {
      a: { t: 0, lN: { h: 72, k: 76 }, lF: { flat: false, a: 80 }, aN: { s: 30, e: 50 }, aF: { s: 176, e: 4 }, ik: { anF: [-42, -7] } },
      b: { t: -6, lN: { h: 64, k: 98 }, lF: { flat: false, a: 80 }, aN: { s: 30, e: 50 }, aF: { s: 178, e: 4 }, ik: { anF: [-42, -7] } },
    },
    rep: cyc(['b', 'a'], 1800, 1200, 'iso'), muscles: ['hipFlexors'], uni: true, leadLimbs: ['lF', 'aF'],
  };
  F.deepSquat = {
    view: 'side', pin: FLOOR_ANKLE, key: 'a',
    poses: { a: { t: 36, n: -14, aN: { s: 60, e: 110 }, lN: { h: 132, k: 132 } }, a2: { t: 34, n: -14, aN: { s: 60, e: 112 }, lN: { h: 130, k: 131 } } },
    rep: iso('a', 'a2', 2600), muscles: ['glutes', 'quads'],
  };
  F.childPose = {
    view: 'side', pin: QUAD, key: 'a',
    poses: {
      a: { t: 105, n: 22, lN: { h: 156, k: 141, flat: false, a: 90 }, aN: { s: 196, e: 0 } },
      a2: { t: 108, n: 22, lN: { h: 158, k: 141, flat: false, a: 90 }, aN: { s: 198, e: 0 } },
    },
    rep: iso('a', 'a2', 2600), muscles: ['lowerBack', 'lats'],
  };
  F.walk = {
    view: 'side', pin: { joint: 'hip', at: [0, -91] }, key: 'a',
    poses: {
      a: { t: 3, aN: { s: -22, e: 20 }, aF: { s: 24, e: 20 }, lN: { h: 26, k: 4, flat: false, a: -14 }, lF: { h: -20, k: 12, flat: false, a: 30 } },
      b: { t: 3, aN: { s: 0, e: 20 }, aF: { s: 0, e: 20 }, lN: { h: 0, k: 6 }, lF: { h: 16, k: 58, flat: false, a: 10 } },
      c: { t: 3, aN: { s: 24, e: 20 }, aF: { s: -22, e: 20 }, lN: { h: -20, k: 12, flat: false, a: 30 }, lF: { h: 26, k: 4, flat: false, a: -14 } },
      d: { t: 3, aN: { s: 0, e: 20 }, aF: { s: 0, e: 20 }, lN: { h: 16, k: 58, flat: false, a: 10 }, lF: { h: 0, k: 6 } },
    },
    rep: cyc(['b', 'c', 'd', 'a'], 420, 0), muscles: ['calves', 'glutes'],
  };

  /* ------------------------------------------------------------------ moves */
  const MOVES = {};
  // Variant transforms on a rep.
  function slowEcc(rep, ms) { return rep.map((s) => (s.ph === 'ecc' ? Object.assign({}, s, { ms }) : s)); }
  function pauseAt(rep, ph, ms) { return rep.map((s) => (s.ph === ph ? Object.assign({}, s, { hold: ms }) : s)); }
  function oneAndHalf(rep) {
    const con = rep.find((s) => s.ph === 'con');
    const ecc = rep.find((s) => s.ph === 'ecc');
    if (!con || !ecc) return rep;
    const conFirst = rep[0].ph === 'con';
    const lo = conFirst ? ecc.to : con.to; // pose at the stretched end
    const hi = conFirst ? con.to : ecc.to; // pose at the contracted end
    const mid = conFirst ? `${lo}~${hi}~0.5` : `${hi}~${lo}~0.5`;
    return conFirst
      ? [{ to: mid, ms: 600, hold: 0, ph: 'con' }, { to: lo, ms: 900, hold: 0, ph: 'ecc' }, { to: hi, ms: con.ms, hold: con.hold, ph: 'con' }, { to: lo, ms: ecc.ms, hold: ecc.hold, ph: 'ecc' }]
      : [{ to: lo, ms: ecc.ms, hold: 0, ph: 'ecc' }, { to: mid, ms: 600, hold: 0, ph: 'con' }, { to: lo, ms: 900, hold: ecc.hold, ph: 'ecc' }, { to: hi, ms: con.ms, hold: con.hold, ph: 'con' }];
  }

  function move(id, form, meta, variant) {
    const base = F[form];
    if (!base) throw new Error('moves: unknown form ' + form);
    const m = merge(base, {});
    Object.assign(m, clone(meta));
    m.id = id; m.form = form;
    if (variant) {
      if (variant.ecc) m.rep = slowEcc(m.rep, variant.ecc);
      if (variant.pause) m.rep = pauseAt(m.rep, variant.pause[0], variant.pause[1]);
      if (variant.half) m.rep = oneAndHalf(m.rep);
      if (variant.uni) { m.uni = true; if (!m.leadLimbs) m.leadLimbs = ['aN']; }
    }
    if (!m.muscles) m.muscles = base.muscles;
    MOVES[id] = m;
    return m;
  }

  // Cue helpers for tempo variants.
  const SLOW = 'Lower for a slow 3 count.';
  const PAUSE_BOTTOM = 'Hold still for a full second at the bottom.';
  const PAUSE_TOP = 'Squeeze and hold a second at the top.';
  const HALF = 'Half rep, back down, then a full rep. That is one.';
  const withCue = (cues, first) => [first].concat(cues.slice(0, 2));

  /* Curls: biceps */
  const CURL_CUES = ['Elbows pinned to your sides.', 'Curl up, then lower all the way.', 'Stand tall, no swinging.'];
  const CURL = { group: 'biceps', joints: ['elbow', 'wrist'], load: 'db', mistake: 'Swinging the weight up with your back.', breathe: 'Breathe out as you curl up.' };
  move('curl_towel', 'towelCurl', { ...CURL, name: 'Towel curl hold', req: ['towel', 'chair'], load: null, timed: true, range: [20, 45], start: 20, uni: true,
    cues: ['Step on the towel and pull up hard.', 'Elbows bent to 90 and still.', 'Keep pulling the whole time.'], mistake: 'Letting the pull fade halfway.', breathe: 'Slow, steady breaths. Don\'t hold your breath.' });
  move('curl_band', 'bandCurl', { ...CURL, name: 'Band curl', req: ['band'], load: 'band', range: [10, 25], start: 12, cues: CURL_CUES });
  move('curl_hammer', 'hammer', { ...CURL, name: 'Hammer curl', req: ['db'], range: [10, 30], start: 14, cues: ['Thumbs up, palms facing in.', 'Elbows pinned to your sides.', 'Lower all the way down.'] });
  move('curl_std', 'curl', { ...CURL, name: 'Dumbbell curl', req: ['db'], range: [8, 25], start: 12, cues: CURL_CUES });
  move('curl_slow', 'curl', { ...CURL, name: 'Curl, 3-sec lowering', req: ['db'], range: [6, 20], start: 10, cues: withCue(CURL_CUES, SLOW) }, { ecc: 3000 });
  move('curl_half', 'curl', { ...CURL, name: '1.5-rep curl', req: ['db'], range: [6, 16], start: 8, complex: true, cues: withCue(CURL_CUES, HALF) }, { half: true });
  // Single-arm versions used for the extra lead-side set (not ladder rungs).
  move('curl_1arm', 'curl1', { ...CURL, name: 'Single-arm curl', req: ['db'], range: [8, 25], start: 12, uni: true, cues: CURL_CUES });
  move('hammer_1arm', 'hammer1', { ...CURL, name: 'Single-arm hammer curl', req: ['db'], range: [10, 30], start: 14, uni: true, cues: ['Thumb up, palm facing in.', 'Elbow pinned to your side.', 'Lower all the way down.'] });
  move('curl_conc', 'concCurl', { ...CURL, name: 'Paused concentration curl', req: ['db', 'chair'], range: [6, 16], start: 8, uni: true,
    cues: ['Elbow braced on your inner thigh.', PAUSE_TOP, 'Lower slowly all the way.'] }, { pause: ['con', 1000] });

  /* Triceps */
  const TRI = { group: 'triceps', joints: ['elbow', 'shoulder'], mistake: 'Letting the elbows flare wide.', breathe: 'Breathe out as you straighten your arms.' };
  move('tri_skull', 'skull', { ...TRI, name: 'Lying dumbbell extension', req: ['db'], load: 'db', range: [10, 25], start: 12, joints: ['elbow'],
    cues: ['Upper arms point at the ceiling and stay there.', 'Lower the weights beside your head.', 'Straighten without locking hard.'] });
  move('tri_oh', 'ohExt', { ...TRI, name: 'Overhead extension', req: ['kb|db'], load: 'kb|db', range: [10, 25], start: 12,
    cues: ['Elbows point up, close to your head.', 'Lower the weight behind your head.', 'Ribs down, no arching.'] });
  move('tri_band', 'pushdown', { ...TRI, name: 'Band pushdown', req: ['band', 'door'], load: 'band', range: [12, 30], start: 15, joints: ['elbow'],
    cues: ['Elbows glued to your sides.', 'Push down until your arms are straight.', 'Let it back up slowly.'] });
  move('tri_dip_bent', 'dipBent', { ...TRI, name: 'Chair dip, knees bent', req: ['chair'], load: null, range: [6, 20], start: 8, joints: ['shoulder', 'elbow', 'wrist'],
    cues: ['Hands on the edge, fingers forward.', 'Lower until elbows reach 90.', 'Keep your hips close to the chair.'], mistake: 'Dropping so low your shoulders roll forward.' });
  move('tri_oh_slow', 'ohExt', { ...TRI, name: 'Overhead extension, 3-sec lowering', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10,
    cues: [SLOW, 'Elbows point up, close to your head.', 'Ribs down, no arching.'] }, { ecc: 3000 });
  move('tri_dip', 'dipStraight', { ...TRI, name: 'Chair dip, legs straight', req: ['chair'], load: null, range: [6, 20], start: 8, joints: ['shoulder', 'elbow', 'wrist'],
    cues: ['Legs long, heels on the floor.', 'Lower until elbows reach 90.', 'Push back up through your palms.'], mistake: 'Dropping so low your shoulders roll forward.' });
  move('tri_diamond', 'pushup', { ...TRI, name: 'Diamond push-up', req: [], load: null, range: [4, 15], start: 6, muscles: ['triceps', 'chest'], joints: ['wrist', 'elbow', 'shoulder'],
    cues: ['Hands close, thumbs and fingers touching.', 'Elbows brush your ribs on the way down.', 'Body in one straight line.'], mistake: 'Hips sagging toward the floor.' });
  move('tri_oh1', 'ohExt1', { ...TRI, name: 'Single-arm overhead extension, paused', req: ['db'], load: 'db', range: [6, 16], start: 8, uni: true,
    cues: ['Elbow points straight up.', PAUSE_BOTTOM, 'Other hand braces the working elbow.'] }, { pause: ['ecc', 1000] });

  /* Chest */
  const PUSH = { group: 'chest', joints: ['wrist', 'shoulder', 'elbow'], load: null, mistake: 'Hips sagging or piking up.', breathe: 'Breathe in on the way down, out as you push.' };
  const PUSH_CUES = ['Body in one straight line, head to heels.', 'Lower your chest between your hands.', 'Elbows angle back, not straight out.'];
  move('push_wall', 'wallPush', { ...PUSH, name: 'Wall push-up', req: ['wall'], range: [10, 25], start: 12, cues: ['Hands on the wall at shoulder height.', 'Lean in until your nose nearly touches.', 'Keep your body straight.'] });
  move('push_incline', 'inclinePush', { ...PUSH, name: 'Incline push-up', req: ['chair'], range: [8, 20], start: 10, cues: ['Hands on the couch edge, shoulder-width.', 'Chest to the edge, body straight.', 'Push the couch away.'] });
  move('push_knee', 'kneePush', { ...PUSH, name: 'Knee push-up', req: [], range: [8, 20], start: 10, cues: ['Knees down, hips in line with your back.', 'Lower your chest between your hands.', 'Elbows angle back.'] });
  move('push_std', 'pushup', { ...PUSH, name: 'Push-up', req: [], range: [5, 20], start: 8, cues: PUSH_CUES });
  move('push_slow', 'pushup', { ...PUSH, name: 'Push-up, 3-sec lowering', req: [], range: [4, 15], start: 6, cues: withCue(PUSH_CUES, SLOW) }, { ecc: 3000 });
  move('push_pause', 'pushup', { ...PUSH, name: 'Paused push-up', req: [], range: [4, 15], start: 6, cues: withCue(PUSH_CUES, 'Hold an inch off the floor for one second.') }, { pause: ['ecc', 1000] });
  move('push_decline', 'declinePush', { ...PUSH, name: 'Feet-on-couch push-up', req: ['chair'], range: [4, 15], start: 6, cues: ['Toes on the couch, hands on the floor.', 'Lower your forehead toward the floor.', 'Squeeze your glutes to stay straight.'] });
  move('push_archer', 'archer', { ...PUSH, name: 'Archer push-up', req: [], range: [3, 10], start: 4, uni: true, complex: true,
    cues: ['Hands wide on the floor.', 'Shift over the working arm and lower.', 'The other arm stays nearly straight.'], mistake: 'Twisting your hips to one side.' });
  const PRESS = { group: 'chest', joints: ['shoulder', 'elbow'], load: 'db', mistake: 'Letting the weights drift over your face.', breathe: 'Breathe out as you press.' };
  move('chest_press', 'floorPress', { ...PRESS, name: 'Floor press', req: ['db'], range: [10, 30], start: 14, cues: ['Lie with knees bent, feet flat.', 'Lower until your upper arms touch the floor.', 'Press straight up over your chest.'] });
  move('chest_press_slow', 'floorPress', { ...PRESS, name: 'Floor press, 3-sec lowering', req: ['db'], range: [8, 25], start: 12, cues: [SLOW, 'Lower until your upper arms touch the floor.', 'Press straight up over your chest.'] }, { ecc: 3000 });
  move('chest_fly', 'floorFly', { ...PRESS, name: 'Floor fly', req: ['db'], range: [10, 25], start: 12, joints: ['shoulder'], cues: ['Arms wide with a soft bend in the elbows.', 'Open until your arms touch the floor.', 'Hug the weights back together.'] });
  move('chest_press1', 'floorPress1', { ...PRESS, name: 'Single-arm floor press', req: ['db'], range: [8, 25], start: 12, uni: true, cues: ['One weight, other arm on the floor.', 'Keep your hips level.', 'Press straight up.'] });
  move('chest_press_half', 'floorPress', { ...PRESS, name: '1.5-rep floor press', req: ['db'], range: [6, 16], start: 8, complex: true, cues: withCue(['Lower until your upper arms touch the floor.', 'Press straight up.', 'Keep your wrists stacked.'], HALF) }, { half: true });

  /* Legs: squat family */
  const SQ = { group: 'legs', joints: ['knee', 'hip'], mistake: 'Knees caving in on the way up.', breathe: 'Breathe in on the way down, out as you stand.' };
  const SQ_CUES = ['Feet shoulder-width, toes slightly out.', 'Sit back and down, chest up.', 'Push the floor away to stand.'];
  move('sq_bw', 'squatBW', { ...SQ, name: 'Bodyweight squat', req: [], load: null, range: [10, 30], start: 15, cues: SQ_CUES });
  move('sq_goblet', 'goblet', { ...SQ, name: 'Goblet squat', req: ['kb|db'], load: 'kb|db', range: [10, 30], start: 15, cues: ['Hold the weight at your chest.', 'Sit between your heels, chest tall.', 'Push the floor away to stand.'] });
  move('sq_goblet_pause', 'goblet', { ...SQ, name: 'Paused goblet squat', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10, cues: ['Hold the weight at your chest.', PAUSE_BOTTOM, 'Drive up without bouncing.'] }, { pause: ['ecc', 1500] });
  const UNI_LEG = { mistake: 'Front knee drifting inward.', breathe: 'Breathe in as you lower, out as you rise.' };
  move('sq_split', 'split', { ...SQ, ...UNI_LEG, name: 'Split squat', req: [], load: null, range: [8, 20], start: 10, uni: true,
    cues: ['Long stance, both feet pointing forward.', 'Drop the back knee toward the floor.', 'Front heel stays down.'] });
  move('sq_lunge', 'lunge', { ...SQ, ...UNI_LEG, name: 'Reverse lunge', req: [], load: null, range: [8, 20], start: 10, uni: true,
    cues: ['Step back and lower straight down.', 'Front knee over your middle toes.', 'Push through the front heel to return.'] });
  move('sq_bulgarian', 'bulgarian', { ...SQ, ...UNI_LEG, name: 'Bulgarian split squat', req: ['chair'], load: null, range: [6, 16], start: 8, uni: true, complex: true,
    cues: ['Back foot laces-down on the couch.', 'Lower straight down, torso slightly forward.', 'Drive up through the front heel.'] });
  move('sq_pistol', 'pistol', { ...SQ, ...UNI_LEG, name: 'Pistol to chair', req: ['chair'], load: null, range: [4, 12], start: 5, uni: true, complex: true,
    cues: ['Stand on one leg in front of the chair.', 'Sit back slowly, other leg reaching forward.', 'Stand up without rocking.'], mistake: 'Dropping onto the chair instead of lowering.' });
  move('sq_wallsit', 'wallSit', { ...SQ, name: 'Wall sit', req: ['wall'], load: null, timed: true, range: [20, 60], start: 25, cues: ['Back flat on the wall.', 'Thighs parallel to the floor.', 'Knees over your ankles.'], mistake: 'Sliding up the wall when it burns.', breathe: 'Slow breaths through the burn.' });
  move('sq_jump', 'jumpSquat', { ...SQ, name: 'Jump squat', req: [], load: null, range: [6, 15], start: 8, impact: true, joints: ['knee', 'hip', 'ankle'],
    cues: ['Quarter squat, then jump.', 'Land softly on the balls of your feet.', 'Sink straight into the next rep.'], mistake: 'Landing with straight, locked knees.' });

  /* Legs: hinge family */
  const HG = { group: 'legs', joints: ['back', 'hip'], mistake: 'Rounding your lower back.', breathe: 'Breathe in as you hinge, out as you stand.' };
  move('hg_bridge', 'bridge', { ...HG, name: 'Glute bridge', req: [], load: null, range: [12, 30], start: 15, joints: ['hip'],
    cues: ['Feet flat, close to your hips.', 'Drive hips up until knees, hips and shoulders line up.', 'Squeeze your glutes at the top.'], mistake: 'Arching your lower back instead of using your glutes.' });
  move('hg_bridge1', 'bridge1', { ...HG, name: 'Single-leg bridge', req: [], load: null, range: [8, 20], start: 10, uni: true, joints: ['hip'],
    cues: ['One foot planted, the other leg straight.', 'Keep your hips level as you lift.', 'Squeeze at the top.'], mistake: 'Letting one hip drop.' });
  move('hg_deadlift', 'kbDeadlift', { ...HG, name: 'Kettlebell deadlift', req: ['kb|db'], load: 'kb|db', range: [10, 30], start: 15,
    cues: ['Weight between your feet.', 'Push your hips back, chest proud.', 'Stand tall and squeeze your glutes.'] });
  move('hg_swing', 'swing', { ...HG, name: 'Two-hand swing', req: ['kb|db'], load: 'kb|db', range: [10, 30], start: 15, complex: true,
    cues: ['Hike the bell back between your legs.', 'Snap your hips forward to float it.', 'Arms are ropes, the hips do the work.'], mistake: 'Squatting the swing or lifting with your arms.', breathe: 'Sharp breath out as your hips snap forward.' });
  move('hg_rdl', 'staggerRdl', { ...HG, name: 'Staggered-stance RDL', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10, uni: true,
    cues: ['Back foot is a kickstand, weight on the front leg.', 'Hinge until you feel the hamstring stretch.', 'Flat back the whole time.'] });
  move('hg_sldl', 'sldl', { ...HG, name: 'Single-leg deadlift', req: ['kb|db'], load: 'kb|db', range: [6, 16], start: 8, uni: true, complex: true,
    cues: ['Stand on one leg, soft knee.', 'Hinge as the back leg rises behind you.', 'Hips stay square to the floor.'], mistake: 'Opening your hips toward the ceiling.' });
  move('hg_sldl_slow', 'sldl', { ...HG, name: 'Single-leg deadlift, 3-sec lowering', req: ['kb|db'], load: 'kb|db', range: [6, 14], start: 6, uni: true, complex: true,
    cues: [SLOW, 'Hinge as the back leg rises behind you.', 'Hips stay square to the floor.'] }, { ecc: 3000 });
  move('hg_swing1', 'swing1', { ...HG, name: 'One-arm swing', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10, uni: true, complex: true,
    cues: ['Same hike and snap, one hand.', 'Keep your shoulders square.', 'Free arm follows the bell.'], breathe: 'Sharp breath out as your hips snap forward.' });

  /* Legs: glute family */
  const GL = { group: 'legs', joints: ['hip'], mistake: 'Arching your lower back at the top.', breathe: 'Breathe out as you lift.' };
  move('gl_bridge', 'bridge', { ...GL, name: 'Glute bridge', req: [], load: null, range: [12, 30], start: 15, cues: ['Feet flat, close to your hips.', 'Drive through your heels.', 'Squeeze at the top for a second.'] });
  move('gl_kbbridge', 'kbBridge', { ...GL, name: 'Loaded glute bridge', req: ['kb|db'], load: 'kb|db', range: [12, 30], start: 15, cues: ['Hold the weight on your hips.', 'Drive through your heels.', 'Squeeze at the top.'] });
  move('gl_thrust', 'thrust', { ...GL, name: 'Hip thrust', req: ['chair', 'kb|db'], load: 'kb|db', range: [10, 25], start: 12, cues: ['Upper back on the couch edge.', 'Chin tucked, ribs down.', 'Hips up until your thighs are flat.'] });
  move('gl_thrust_pause', 'thrust', { ...GL, name: 'Paused hip thrust', req: ['chair', 'kb|db'], load: 'kb|db', range: [8, 20], start: 10, cues: ['Upper back on the couch edge.', PAUSE_TOP, 'Lower with control.'] }, { pause: ['con', 1500] });
  move('gl_bridge1', 'bridge1', { ...GL, name: 'Single-leg bridge', req: [], load: null, range: [8, 20], start: 10, uni: true, cues: ['One foot planted, the other leg straight.', 'Keep your hips level.', 'Squeeze at the top.'] });
  move('gl_thrust1', 'thrust1', { ...GL, name: 'Single-leg hip thrust', req: ['chair'], load: null, range: [8, 20], start: 10, uni: true, cues: ['Upper back on the couch edge.', 'One foot planted, other leg up.', 'Hips level all the way up.'] });

  /* Back: rows */
  const ROW = { group: 'back', joints: ['back', 'elbow'], mistake: 'Shrugging your shoulders up to your ears.', breathe: 'Breathe out as you pull.' };
  const ROW_CUES = ['Hinge forward, flat back.', 'Pull your elbows back to your hips.', 'Squeeze your shoulder blades together.'];
  move('row_towel', 'towelRow', { ...ROW, name: 'Towel door row', req: ['towel', 'door'], load: null, range: [10, 25], start: 12, joints: ['elbow'],
    cues: ['Loop the towel round a sturdy door handle.', 'Lean back with straight arms.', 'Pull your chest to your hands.'], mistake: 'Using a door that can open toward you.' });
  move('row_table', 'tableRow', { ...ROW, name: 'Table row', req: ['table'], load: null, range: [6, 20], start: 8, joints: ['elbow', 'shoulder'],
    cues: ['Lie under a sturdy table, grip the edge.', 'Body straight from heels to head.', 'Pull your chest to the edge.'], mistake: 'Letting your hips sag.' });
  move('row_band', 'bandRow', { ...ROW, name: 'Band row', req: ['band', 'door'], load: 'band', range: [12, 30], start: 15, joints: ['elbow'], cues: ['Band anchored at chest height.', 'Pull your elbows back past your ribs.', 'Squeeze your shoulder blades.'] });
  move('row_db', 'row', { ...ROW, name: 'Bent-over row', req: ['db|kb'], load: 'db|kb', range: [10, 30], start: 14, cues: ROW_CUES });
  move('row_chair', 'row1', { ...ROW, name: 'Single-arm chair row', req: ['db|kb', 'chair'], load: 'db|kb', range: [10, 25], start: 12, uni: true, joints: ['elbow'],
    cues: ['Free hand on the chair seat.', 'Pull the weight to your hip.', 'Keep your chest square to the floor.'] });
  move('row_slow', 'row', { ...ROW, name: 'Bent-over row, 3-sec lowering', req: ['db|kb'], load: 'db|kb', range: [8, 25], start: 12, cues: withCue(ROW_CUES, SLOW) }, { ecc: 3000 });
  move('row_pause', 'row', { ...ROW, name: 'Paused row', req: ['db|kb'], load: 'db|kb', range: [8, 20], start: 10, cues: withCue(ROW_CUES, 'Hold two seconds with your elbows back.') }, { pause: ['con', 2000] });
  move('row_half', 'row', { ...ROW, name: '1.5-rep row', req: ['db|kb'], load: 'db|kb', range: [6, 16], start: 8, complex: true, cues: withCue(ROW_CUES, HALF) }, { half: true });
  move('row_chair_half', 'row1', { ...ROW, name: 'Single-arm 1.5-rep row', req: ['db|kb', 'chair'], load: 'db|kb', range: [6, 16], start: 8, uni: true, complex: true,
    cues: ['Free hand on the chair seat.', HALF, 'Keep your chest square to the floor.'] }, { half: true });

  /* Back: pull-up bar */
  const PULL = { group: 'back', joints: ['shoulder', 'elbow'], load: null, req: ['bar'], mistake: 'Kicking your legs to get up.', breathe: 'Breathe out as you pull.' };
  move('pull_hang', 'hang', { ...PULL, name: 'Dead hang', timed: true, range: [15, 45], start: 20, cues: ['Hands shoulder-width, full grip.', 'Shoulders active, not shrugged.', 'Legs still.'], breathe: 'Slow, steady breaths.' });
  move('pull_scap', 'scapPull', { ...PULL, name: 'Scap pull', range: [8, 20], start: 10, cues: ['Hang with straight arms.', 'Pull your shoulder blades down and back.', 'Your body rises an inch. That\'s it.'] });
  move('pull_neg', 'negative', { ...PULL, name: 'Chin-up negative', range: [3, 8], start: 3, cues: ['Jump or step to the top.', 'Lower for a slow 4 count.', 'Reset and repeat.'] });
  move('pull_chin', 'chin', { ...PULL, name: 'Chin-up', range: [3, 12], start: 4, cues: ['Palms facing you.', 'Pull your chest to the bar.', 'Lower all the way down.'] });
  move('pull_up', 'chin', { ...PULL, name: 'Pull-up', range: [3, 12], start: 4, cues: ['Palms facing away.', 'Pull your elbows down to your ribs.', 'Lower all the way down.'] });
  move('pull_slow', 'chin', { ...PULL, name: 'Pull-up, 3-sec lowering', range: [2, 10], start: 3, cues: [SLOW, 'Pull your elbows down to your ribs.', 'Lower all the way down.'] }, { ecc: 3000 });

  /* Back: rear delts */
  const REAR = { group: 'back', joints: ['shoulder'], mistake: 'Shrugging instead of pulling back.', breathe: 'Breathe out as you open your arms.' };
  move('rear_towel', 'towelApart', { ...REAR, name: 'Towel pull-apart hold', req: ['towel'], load: null, timed: true, range: [20, 45], start: 20,
    cues: ['Arms straight in front, towel taut.', 'Pull the ends apart as hard as you can.', 'Shoulders down, away from your ears.'], breathe: 'Steady breaths, keep pulling.' });
  move('rear_band', 'pullApart', { ...REAR, name: 'Band pull-apart', req: ['band'], load: 'band', range: [12, 30], start: 15, cues: ['Arms straight at shoulder height.', 'Pull the band to your chest.', 'Squeeze your shoulder blades.'] });
  move('rear_ytw', 'ytw', { ...REAR, name: 'Prone Y-T-W', req: [], load: null, range: [6, 15], start: 6, complex: true,
    cues: ['Lie face down, forehead on a towel.', 'Lift your arms into a Y, then T, then W.', 'Thumbs up, shoulders down.'], mistake: 'Lifting your chest instead of your arms.' });
  move('rear_ytw_hold', 'ytw', { ...REAR, name: 'Y-T-W with 2-sec holds', req: [], load: null, range: [5, 12], start: 5, complex: true,
    cues: ['Hold each letter for two seconds.', 'Thumbs up, shoulders down.', 'Forehead stays on the towel.'] }, { pause: ['con', 2000] });
  move('rear_fly', 'revFly', { ...REAR, name: 'Reverse fly', req: ['db'], load: 'db', range: [10, 30], start: 14, cues: ['Hinge forward, flat back.', 'Open your arms out to the sides.', 'Lead with your elbows.'] });
  move('rear_fly_slow', 'revFly', { ...REAR, name: 'Reverse fly, 3-sec lowering', req: ['db'], load: 'db', range: [8, 25], start: 12, cues: [SLOW, 'Open your arms out to the sides.', 'Lead with your elbows.'] }, { ecc: 3000 });
  move('rear_fly_pause', 'revFly', { ...REAR, name: 'Paused reverse fly', req: ['db'], load: 'db', range: [8, 20], start: 10, cues: ['Hinge forward, flat back.', PAUSE_TOP, 'Lower with control.'] }, { pause: ['con', 1000] });

  /* Shoulders */
  const RAISE = { group: 'shoulders', joints: ['shoulder'], load: 'db', mistake: 'Shrugging the weights up.', breathe: 'Breathe out as you raise.' };
  const RAISE_CUES = ['Slight bend in the elbows.', 'Raise out to the sides to shoulder height.', 'Lower slowly.'];
  move('raise', 'latRaise', { ...RAISE, name: 'Lateral raise', req: ['db'], range: [10, 30], start: 14, cues: RAISE_CUES });
  move('raise_band', 'latRaise', { ...RAISE, name: 'Band lateral raise', req: ['band'], load: 'band', range: [12, 30], start: 15, equip: [{ type: 'band', hands: 'both', from: 'anN' }], cues: ['Stand on the band.', 'Raise out to the sides to shoulder height.', 'Lower slowly.'] });
  move('raise_slow', 'latRaise', { ...RAISE, name: 'Lateral raise, 3-sec lowering', req: ['db'], range: [8, 25], start: 12, cues: withCue(RAISE_CUES, SLOW) }, { ecc: 3000 });
  move('raise_half', 'latRaise', { ...RAISE, name: '1.5-rep lateral raise', req: ['db'], range: [6, 20], start: 10, complex: true, cues: withCue(RAISE_CUES, HALF) }, { half: true });
  move('raise_pause', 'latRaise', { ...RAISE, name: 'Paused lateral raise', req: ['db'], range: [6, 20], start: 10, cues: withCue(RAISE_CUES, PAUSE_TOP) }, { pause: ['con', 1000] });
  move('raise_lean', 'latRaise1', { ...RAISE, name: 'Leaning single-arm raise', req: ['db', 'wall'], range: [8, 20], start: 10, uni: true, cues: ['Hold the wall and lean away.', 'Raise to shoulder height.', 'Lower for a slow 3 count.'] }, { ecc: 3000 });

  /* Abs */
  const AB = { group: 'abs', joints: ['back'], load: null, req: [], mistake: 'Your lower back arching off the floor.', breathe: 'Breathe out as you move, in as you return.' };
  move('ab_deadbug', 'deadBug', { ...AB, name: 'Dead bug', range: [6, 16], start: 8, joints: [], cues: ['Lower back pressed into the floor.', 'Reach one arm and the opposite leg long.', 'Move slowly, then switch.'] });
  move('ab_revcrunch', 'revCrunch', { ...AB, name: 'Reverse crunch', range: [8, 20], start: 10, cues: ['Knees bent, hands by your sides.', 'Curl your hips off the floor.', 'Lower one vertebra at a time.'], mistake: 'Swinging your legs for momentum.' });
  move('ab_legraise', 'legRaise', { ...AB, name: 'Lying leg raise', range: [6, 16], start: 8, cues: ['Legs straight, lower back down.', 'Raise until your legs point up.', 'Lower slowly, stop before your back arches.'] });
  move('ab_hollow', 'hollow', { ...AB, name: 'Hollow hold', timed: true, range: [15, 45], start: 20, joints: ['back', 'neck'], cues: ['Lower back glued to the floor.', 'Shoulders and legs off the floor.', 'Reach long through your hands and toes.'], breathe: 'Short, steady breaths.' });
  move('ab_vup', 'vup', { ...AB, name: 'V-up', range: [5, 15], start: 6, complex: true, joints: ['back', 'hip'], cues: ['Start long and flat.', 'Fold up, hands reach for your toes.', 'Lower with control.'] });
  const ABL = { group: 'abs', joints: ['back', 'neck'], mistake: 'Pulling on your neck.', breathe: 'Breathe out as you crunch.' };
  move('abl_crunch', 'crunch', { ...ABL, name: 'Crunch', req: [], load: null, range: [10, 25], start: 12, cues: ['Hands by your temples, elbows wide.', 'Curl your shoulders off the floor.', 'Lower slowly.'] });
  move('abl_kb', 'kbCrunch', { ...ABL, name: 'Weighted crunch', req: ['kb|db|ball'], load: 'kb|db|ball', range: [10, 25], start: 12, cues: ['Hold the weight on your chest.', 'Curl your shoulders off the floor.', 'Lower slowly.'] });
  move('abl_kb_slow', 'kbCrunch', { ...ABL, name: 'Weighted crunch, 3-sec lowering', req: ['kb|db|ball'], load: 'kb|db|ball', range: [8, 20], start: 10, cues: [SLOW, 'Hold the weight on your chest.', 'Curl your shoulders off the floor.'] }, { ecc: 3000 });
  move('abl_kb_arms', 'kbCrunchArms', { ...ABL, name: 'Weighted crunch, arms extended', req: ['kb|db|ball'], load: 'kb|db|ball', range: [8, 20], start: 10, cues: ['Hold the weight above your chest.', 'Crunch up, arms stay straight.', 'Lower slowly.'] });
  move('abl_situp', 'situp', { ...ABL, name: 'Weighted sit-up', req: ['kb|db|ball', 'chair'], load: 'kb|db|ball', range: [6, 16], start: 8, complex: true, joints: ['back', 'hip'],
    cues: ['Feet tucked under the couch.', 'Sit all the way up, weight at your chest.', 'Lower slowly.'] });

  /* Rotation */
  const ROT = { group: 'abs', joints: ['back'], mistake: 'Moving only your arms, not your ribs.', breathe: 'Breathe out as you turn.' };
  move('rot_russian', 'russian', { ...ROT, name: 'Russian twist', req: [], load: 'ball', range: [10, 30], start: 16, cues: ['Lean back, chest tall, feet down.', 'Turn your ribs, not just your arms.', 'Touch the ball beside each hip.'] });
  move('rot_chop', 'chop', { ...ROT, name: 'Standing woodchop', req: ['ball|kb|db'], load: 'ball|kb|db', range: [8, 20], start: 10, uni: true, joints: ['back', 'shoulder'],
    cues: ['Start high over one shoulder.', 'Chop down across to the other hip.', 'Pivot your back foot.'] });
  move('rot_russian_up', 'russianUp', { ...ROT, name: 'Russian twist, feet up', req: [], load: 'ball', range: [10, 30], start: 14, complex: true, cues: ['Feet off the floor, knees bent.', 'Turn your ribs side to side.', 'Keep your chest tall.'] });
  move('rot_kneel_chop', 'kneelChop', { ...ROT, name: 'Half-kneeling chop', req: ['ball|kb|db'], load: 'ball|kb|db', range: [8, 20], start: 10, uni: true, joints: ['back', 'shoulder', 'knee'],
    cues: ['One knee down, hips square.', 'Chop from high to low across your body.', 'Hips stay still, ribs turn.'] });
  move('rot_slam', 'slam', { ...ROT, name: 'Ball slam', req: ['ball', 'slam'], load: 'ball', range: [8, 20], start: 10, impact: true, joints: ['back', 'shoulder'],
    cues: ['Reach the ball overhead, up on your toes.', 'Slam it down in front of your feet.', 'Hinge to pick it up.'], mistake: 'Slamming a ball that bounces back at your face.', breathe: 'Breathe out hard as you slam.' });
  move('rot_toss', 'toss', { ...ROT, name: 'Overhead toss and catch', req: ['ball'], load: 'ball', range: [8, 20], start: 10, joints: ['shoulder'],
    cues: ['Dip, then drive up and toss.', 'A small toss, a foot above your hands.', 'Catch soft and sink into the next one.'], breathe: 'Breathe out as you toss.' });

  /* Side core */
  const SIDE = { group: 'abs', joints: ['shoulder'], load: null, req: [], mistake: 'Letting your hips sag.', breathe: 'Slow breaths, don\'t hold it.' };
  move('side_knee', 'sidePlankKnee', { ...SIDE, name: 'Side plank on knees', timed: true, range: [15, 45], start: 20, uni: true, cues: ['Elbow under your shoulder.', 'Knees bent, hips lifted.', 'Straight line from knees to head.'] });
  move('side_carry', 'carry', { ...SIDE, name: 'Suitcase carry', req: ['kb|db'], load: 'kb|db', timed: true, range: [20, 60], start: 30, uni: true, joints: ['back'],
    cues: ['Weight in one hand at your side.', 'Walk tall, don\'t lean toward it.', 'Short, steady steps.'], mistake: 'Leaning toward the weight.' });
  move('side_plank', 'sidePlank', { ...SIDE, name: 'Side plank', timed: true, range: [15, 45], start: 20, uni: true, cues: ['Elbow under your shoulder.', 'Feet stacked, hips high.', 'Straight line from feet to head.'] });
  move('side_march', 'march', { ...SIDE, name: 'Suitcase march', req: ['kb|db'], load: 'kb|db', timed: true, range: [20, 60], start: 30, uni: true, joints: ['back', 'hip'],
    cues: ['Weight in one hand at your side.', 'Drive each knee to hip height.', 'Stay tall, no lean.'], mistake: 'Leaning toward the weight.' });
  move('side_star', 'starPlank', { ...SIDE, name: 'Side plank, top leg raised', timed: true, range: [10, 40], start: 15, uni: true, complex: true, joints: ['shoulder', 'hip'],
    cues: ['Side plank with hips high.', 'Lift your top leg and hold.', 'Don\'t let your hips drop.'] });

  /* Conditioning */
  const COND = { group: 'conditioning', joints: [], load: null, req: [], timed: true, range: [20, 40], start: 20, mistake: 'Speeding up until your form falls apart.', breathe: 'Keep breathing, don\'t hold it.' };
  move('fin_swing', 'swing', { ...COND, name: 'Swing intervals', req: ['kb|db'], load: 'kb|db', joints: ['back', 'hip'], cues: ['Hike, snap, float.', 'Arms are ropes.', 'Rest when the timer says rest.'], complex: false });
  move('fin_swing1', 'swing1', { ...COND, name: 'One-arm swing intervals', req: ['kb|db'], load: 'kb|db', uni: true, joints: ['back', 'hip'], cues: ['Hike, snap, float, one hand.', 'Shoulders square.', 'Switch hands each round.'], complex: true });
  move('fin_slam', 'slam', { ...COND, name: 'Ball slam intervals', req: ['ball', 'slam'], load: 'ball', impact: true, joints: ['back', 'shoulder'], cues: ['Reach tall, slam hard.', 'Hinge to pick it up.', 'Steady pace.'] });
  move('fin_toss', 'toss', { ...COND, name: 'Toss and catch intervals', req: ['ball'], load: 'ball', joints: ['shoulder'], cues: ['Dip and drive.', 'Small toss, soft catch.', 'Steady pace.'] });
  move('fin_march', 'highKnees', { ...COND, name: 'High-knee march', joints: ['hip'], cues: ['Knees to hip height.', 'Pump your arms.', 'Stay tall.'] });
  move('fin_pulse', 'pulse', { ...COND, name: 'Squat pulses', joints: ['knee'], cues: ['Stay low, small pulses.', 'Chest up.', 'Weight in your heels.'] });
  move('fin_jacks', 'jacks', { ...COND, name: 'Jumping jacks', impact: true, joints: ['knee', 'ankle'], cues: ['Light on your feet.', 'Arms all the way up.', 'Steady rhythm.'] });
  move('fin_climbers', 'climbers', { ...COND, name: 'Mountain climbers', joints: ['wrist', 'shoulder'], cues: ['Hands under shoulders.', 'Drive your knees toward your chest.', 'Hips stay low.'] });
  move('fin_burpee', 'burpee', { ...COND, name: 'Burpees', impact: true, joints: ['wrist', 'knee', 'shoulder'], complex: true, cues: ['Hands down, jump back.', 'Jump in, then jump up.', 'Land soft.'] });

  /* Warm-up, mobility, walk */
  const MOB = { group: 'mobility', joints: [], load: null, req: [], timed: true, range: [30, 60], start: 45, mistake: 'Forcing the range.', breathe: 'Slow breaths through your nose.' };
  move('wu_halo', 'halo', { ...MOB, name: 'Kettlebell halo', req: ['kb'], load: 'kb', range: [30, 40], start: 30, joints: ['shoulder'], cues: ['Hold the bell upside down by the horns.', 'Circle it close around your head.', 'Switch direction halfway.'] });
  move('wu_circles', 'armCircles', { ...MOB, name: 'Arm circles', range: [30, 40], start: 30, cues: ['Arms out to the sides.', 'Small circles, growing bigger.', 'Switch direction halfway.'] });
  move('wu_squat', 'squatBW', { ...MOB, name: 'Bodyweight squats', timed: false, range: [10, 10], start: 10, cues: SQ_CUES });
  move('wu_angels', 'wallAngel', { ...MOB, name: 'Wall angels', req: ['wall'], range: [30, 40], start: 30, cues: ['Back and head against the wall.', 'Slide your arms up and down.', 'Keep your wrists touching the wall.'] });
  move('mob_catcow', 'catCow', { ...MOB, name: 'Cat-cow', range: [45, 60], start: 60, joints: ['wrist'], cues: ['Hands under shoulders, knees under hips.', 'Round up, then let your belly drop.', 'Move with your breath.'] });
  move('mob_wgs', 'wgs', { ...MOB, name: 'World\'s greatest stretch', range: [30, 30], start: 30, uni: true, cues: ['Lunge with your back knee down.', 'Elbow to your front instep.', 'Rotate and reach to the ceiling.'] });
  move('mob_hipflexor', 'hipFlexor', { ...MOB, name: 'Hip flexor stretch', range: [30, 30], start: 30, uni: true, cues: ['Back knee down on a towel.', 'Tuck your hips and shift forward.', 'Reach the same-side arm up.'] });
  move('mob_squat', 'deepSquat', { ...MOB, name: 'Deep squat hold', range: [30, 45], start: 45, cues: ['Sit as low as you comfortably can.', 'Elbows push your knees out.', 'Heels down if you can.'] });
  move('mob_child', 'childPose', { ...MOB, name: 'Child\'s pose', range: [30, 45], start: 45, cues: ['Knees wide, sit back on your heels.', 'Reach your arms long.', 'Let your forehead rest.'] });
  move('walk', 'walk', { ...MOB, name: 'Walk', range: [600, 900], start: 720, cues: ['Easy pace, you can talk.', 'Swing your arms.', '10 to 15 minutes.'], mistake: 'Skipping it because it feels too easy.' });

  /* ------------------------------------------------------------------ ladders */
  // Rungs are listed easiest → hardest; each user only sees the rungs their equipment allows.
  const LADDERS = {
    curl: { name: 'Curls', group: 'biceps', rungs: ['curl_towel', 'curl_band', 'curl_hammer', 'curl_std', 'curl_slow', 'curl_half', 'curl_conc'] },
    triceps: { name: 'Triceps', group: 'triceps', rungs: ['tri_skull', 'tri_oh', 'tri_band', 'tri_dip_bent', 'tri_oh_slow', 'tri_dip', 'tri_diamond', 'tri_oh1'] },
    push: { name: 'Push-ups', group: 'chest', rungs: ['push_wall', 'push_incline', 'push_knee', 'push_std', 'push_slow', 'push_pause', 'push_decline', 'push_archer'] },
    chestDb: { name: 'Floor press', group: 'chest', accessory: true, rungs: ['chest_press', 'chest_press_slow', 'chest_fly', 'chest_press1', 'chest_press_half'] },
    squat: { name: 'Squats and lunges', group: 'legs', rungs: ['sq_bw', 'sq_goblet', 'sq_goblet_pause', 'sq_split', 'sq_lunge', 'sq_bulgarian', 'sq_pistol'] },
    hinge: { name: 'Hinges', group: 'legs', rungs: ['hg_bridge', 'hg_deadlift', 'hg_swing', 'hg_rdl', 'hg_bridge1', 'hg_sldl', 'hg_sldl_slow', 'hg_swing1'] },
    glute: { name: 'Glute bridges', group: 'legs', accessory: true, rungs: ['gl_bridge', 'gl_kbbridge', 'gl_thrust', 'gl_thrust_pause', 'gl_bridge1', 'gl_thrust1'] },
    row: { name: 'Rows', group: 'back', rungs: ['row_towel', 'row_table', 'row_band', 'row_db', 'row_chair', 'row_slow', 'row_pause', 'row_half', 'row_chair_half'] },
    pull: { name: 'Pull-ups', group: 'back', rungs: ['pull_hang', 'pull_scap', 'pull_neg', 'pull_chin', 'pull_up', 'pull_slow'] },
    rear: { name: 'Rear shoulders', group: 'back', rungs: ['rear_towel', 'rear_band', 'rear_ytw', 'rear_ytw_hold', 'rear_fly', 'rear_fly_slow', 'rear_fly_pause'] },
    raise: { name: 'Lateral raises', group: 'shoulders', rungs: ['raise_band', 'raise', 'raise_slow', 'raise_half', 'raise_pause', 'raise_lean'] },
    abs: { name: 'Abs', group: 'abs', rungs: ['ab_deadbug', 'ab_revcrunch', 'ab_legraise', 'ab_hollow', 'ab_vup'] },
    absLoad: { name: 'Crunches', group: 'abs', rungs: ['abl_crunch', 'abl_kb', 'abl_kb_slow', 'abl_kb_arms', 'abl_situp'] },
    coreRot: { name: 'Rotation', group: 'abs', rungs: ['rot_russian', 'rot_chop', 'rot_russian_up', 'rot_kneel_chop', 'rot_slam', 'rot_toss'] },
    coreSide: { name: 'Side core', group: 'abs', rungs: ['side_knee', 'side_carry', 'side_plank', 'side_march', 'side_star'] },
    finisher: { name: 'Finishers', group: 'conditioning', rungs: ['fin_march', 'fin_pulse', 'fin_toss', 'fin_swing', 'fin_climbers', 'fin_jacks', 'fin_slam', 'fin_burpee', 'fin_swing1'] },
  };
  // The rotation ladder ends in either a slam or a toss, never both for one person.
  LADDERS.coreRot.exclusive = [['rot_slam', 'rot_toss']];
  for (const [fam, lad] of Object.entries(LADDERS)) {
    lad.id = fam;
    for (const id of lad.rungs) { if (!MOVES[id]) throw new Error('moves: ladder ' + fam + ' names unknown move ' + id); MOVES[id].family = MOVES[id].family || fam; }
  }
  // Moves that appear in two ladders keep their first family; hinge borrows the bridges.
  MOVES.hg_bridge.family = 'hinge'; MOVES.hg_bridge1.family = 'hinge';
  MOVES.curl_1arm.family = 'curl'; MOVES.hammer_1arm.family = 'curl';
  // The single-arm version of a curl rung, for the extra lead-side set.
  const ONE_ARM = { curl_std: 'curl_1arm', curl_slow: 'curl_1arm', curl_half: 'curl_1arm', curl_hammer: 'hammer_1arm', curl_band: 'curl_towel' };

  const WARMUP = { kb: ['wu_halo', 'wu_squat', 'wu_angels'], none: ['wu_circles', 'wu_squat', 'wu_angels'] };
  const MOBILITY = ['mob_catcow', 'mob_wgs', 'mob_hipflexor', 'mob_squat', 'mob_child'];

  /* ------------------------------------------------------------------ queries */
  // Does the equipment profile satisfy a req list like ['db|kb', 'chair']?
  function has(eq, key) {
    switch (key) {
      case 'db': return !!(eq.db && eq.db.length);
      case 'kb': return !!(eq.kb && eq.kb.length);
      case 'ball': return !!eq.ball;
      case 'slam': return !!(eq.ball && eq.ballSlam);
      case 'band': return !!eq.band;
      case 'bar': return !!eq.bar;
      case 'chair': return eq.chair !== false;
      case 'wall': return eq.wall !== false;
      case 'towel': return eq.towel !== false;
      case 'table': return !!eq.table;
      case 'door': return !!eq.door;
      default: return false;
    }
  }
  function allowed(m, eq) {
    return (m.req || []).every((alt) => alt.split('|').some((k) => has(eq, k)));
  }
  // Which equipment actually loads this move for this person (heaviest available wins).
  function loadFor(m, eq) {
    if (!m.load) return null;
    for (const k of m.load.split('|')) if (has(eq, k)) return k;
    return null;
  }
  // The rungs of a ladder this person can do, in order (slam vs toss resolved by equipment).
  function rungsFor(family, eq, opts) {
    const o = opts || {};
    const lad = LADDERS[family];
    let rungs = lad.rungs.filter((id) => allowed(MOVES[id], eq));
    for (const pair of lad.exclusive || []) {
      const keep = pair.find((id) => rungs.includes(id));
      rungs = rungs.filter((id) => !pair.includes(id) || id === keep);
    }
    if (o.noImpact) rungs = rungs.filter((id) => !MOVES[id].impact);
    if (o.simple) rungs = rungs.filter((id) => !MOVES[id].complex);
    if (o.avoidJoints && o.avoidJoints.length) rungs = rungs.filter((id) => !(MOVES[id].joints || []).some((j) => o.avoidJoints.includes(j)));
    return rungs;
  }
  // A move with its drawn equipment switched to what this person has.
  function forPerson(m, eq) {
    const load = loadFor(m, eq);
    if (!load || !m.equipBy || !m.equipBy[load]) return m;
    return Object.assign({}, m, { equip: m.equipBy[load], $flat: undefined, $tl: undefined });
  }
  // Seconds per rep from the animation timeline (unilateral moves double it in the brain).
  function secPerRep(m) {
    const total = m.rep.reduce((a, s) => a + s.ms + (s.hold || 0), 0);
    return total / 1000;
  }
  // Which way to draw a unilateral move: mirrored when the working side faces away.
  function mirrorFor(m, side) {
    const view = m.view || 'side';
    const work = (m.leadLimbs && m.leadLimbs[0] && m.leadLimbs[0].slice(-1)) || 'N';
    if (view === 'side') return (side === 'L') === (work === 'N');
    return (side === 'R') === (work === 'N');
  }

  GH.moves = { FORMS: F, MOVES, LADDERS, WARMUP, MOBILITY, ONE_ARM, has, allowed, loadFor, rungsFor, forPerson, secPerRep, mirrorFor };
})(typeof window !== 'undefined' ? window : globalThis);
