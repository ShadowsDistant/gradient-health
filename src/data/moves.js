/* Exercise library: forms (animations), moves (form + dosing + coaching) and ladders.
 *
 * Pose angles (see engine/pose.js): t torso lean (0 upright, 90 face-down, -90 face-up),
 * n neck, aN/aF arms {s shoulder, e elbow}, lN/lF legs {h hip, k knee, a ankle, flat, fd foot dir}.
 * rep steps: { to, ms, hold, ph: 'con' | 'ecc' | 'iso' | 'move' }.
 * req: equipment the move needs, e.g. ['db|kb', 'chair'] = (dumbbell or kettlebell) and a chair.
 * sc: a limb's drawn length scale (foreshortening, e.g. arms out to the side in side view).
 * Gym moves: gym: true; load 'bb' | 'ez' | 'db' | 'cable' | 'machine' | 'smith' (| alternatives);
 * ratio = conservative starting load / body weight (per dumbbell for dumbbells); equipBy / propsBy
 * swap the drawn equipment / props for the loading equipment the person has (see forPerson).
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

  // A deep copy of plain data, as a trip through JSON makes it (undefined and functions left out of
  // objects and null in lists, numbers that aren't finite null), but quicker: it runs for every pose
  // and every move as the page loads.
  function clone(o) {
    if (o === null || typeof o !== 'object') return typeof o === 'number' && !Number.isFinite(o) ? null : o;
    if (Array.isArray(o)) {
      const a = new Array(o.length);
      for (let i = 0; i < o.length; i++) { const v = o[i]; a[i] = v === undefined || typeof v === 'function' ? null : clone(v); }
      return a;
    }
    const out = {};
    for (const k of Object.keys(o)) { const v = o[k]; if (v !== undefined && typeof v !== 'function') out[k] = clone(v); }
    return out;
  }
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
  // Prone (face down, side view): the hip joint 10 above the floor, legs long, the tops of the feet down.
  const PRONE = { joint: 'hip', at: [0, -10] };
  const prone = (o) => merge({ t: 90, n: 0, lN: { h: 3, k: 0, flat: false, a: 76 } }, o || {});
  // Both elbows toward the same side of the reach (side view: [forward, down]).
  const poles = (x, y) => ({ hdN: [x, y], hdF: [x, y] });
  // On hands and knees (side view): knees under the hips, hands under the shoulders.
  const QUAD = { joint: 'knN', at: [0, -6] };
  const quad = (t, n) => ({ t, n, lN: { h: t, k: 90, flat: false, a: 90 }, ik: { hdN: [50, -3] } });

  const r1 = (v) => Math.round(v * 10) / 10;

  const DB2 = [{ type: 'db', hands: 'both', orient: 'end' }];
  const DB2S = [{ type: 'db', hands: 'both', orient: 'side' }];
  const DBN = [{ type: 'db', hands: 'N', orient: 'end' }];
  const DBNS = [{ type: 'db', hands: 'N', orient: 'side' }];
  const KB2 = [{ type: 'kb', hands: 'both', hold: 'arm' }];
  const KBN = [{ type: 'kb', hands: 'N', hold: 'arm' }];
  const BALL = [{ type: 'ball', hands: 'both' }];
  const CHAIR_BEHIND = { type: 'box', x: -48, w: 46, h: 45, back: 0 };

  /* ------------------------------------------------------------------ forms */
  // The registries below (forms, moves, ladders) have no prototype, so an id read from a saved state
  // or a shared plan ("constructor", "__proto__") is simply unknown instead of an Object built-in.
  const F = Object.create(null);

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
      a: { t: 32, aN: { s: 33, e: 8 }, lN: { h: 122, k: 90 }, ik: { hdF: [38, -58] } },
      b: { t: 32, aN: { s: 37, e: 132 }, lN: { h: 122, k: 90 }, ik: { hdF: [38, -58] } },
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
  F.ohExt1 = merge(F.ohExt, { equip: [{ type: 'db', hands: 'N', orient: 'side' }], equipBy: null, poses: { a: { aF: { s: 4, e: 10 } }, b: { aF: { s: 4, e: 10 } } }, uni: true, leadLimbs: ['aN'] });
  // The band runs from under the heels up the back to the hands behind the head.
  F.bandOhExt = merge(F.ohExt, { equip: [{ type: 'band', hands: 'both', from: 'heN', layer: 'back', route: 'back' }], equipBy: null });
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
  F.diamond = merge(F.pushup, {});
  F.kneePush = {
    view: 'side', pin: { joint: 'knN', at: [0, -6] }, key: 'b',
    poses: {
      a: { t: 55, n: -8, lN: { h: 0, k: 115, flat: false, a: 0 }, ik: { hdN: [78, -3] } },
      b: { t: 78, n: -8, lN: { h: 0, k: 115, flat: false, a: 0 }, ik: { hdN: [78, -3] } },
    },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  // Feet about a metre from the wall: arms long at the top, the nose a hand's width off it at the bottom.
  F.wallPush = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'wall', x: 100, side: 1 }],
    poses: {
      a: { t: 18, n: -5, lN: { h: 0, k: 0 }, ik: { hdN: [98, -128] } },
      b: { t: 29, n: -5, lN: { h: 0, k: 0 }, ik: { hdN: [98, -128] } },
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
      b: { t: 36, n: -10, aN: { s: 124, e: 0 }, lN: { h: 104, k: 106 }, lF: { h: 128, k: 4, flat: false, a: 10 } },
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

  // Step-up onto a sturdy step (a low chair or the second stair): the working foot stays up, the
  // other pushes off its toes below and hangs behind at the top.
  F.stepUp = {
    view: 'side', pin: { joint: 'hip' }, key: 'b', props: [{ type: 'box', x: -20, w: 46, h: 40 }],
    poses: {
      a: { at: [-14, -93], t: 18, n: -6, aN: { s: 16, e: 20 }, lN: { flat: true }, lF: { flat: false, a: 30 }, ik: { anN: [0, -48], anF: [-30, -11] } },
      b: { at: [-2, -131], t: 2, aN: { s: 4, e: 14 }, lN: { flat: true }, lF: { flat: false, a: 30 }, ik: { anN: [0, -48], anF: [-22, -55] } },
    },
    rep: ce('a', 'b', { con: 1100, ecc: 1500 }), muscles: ['quads', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  const GOBLET_ARMS = { aN: { s: 22, e: 128 } };
  F.gobletLunge = merge(F.lunge, {
    equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side', tilt: 90 }] },
    poses: { a: GOBLET_ARMS, step: GOBLET_ARMS, b: GOBLET_ARMS },
  });

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
      b: sup({ t: -114, aN: { s: -18, e: 0 }, lN: { flat: true }, ik: { anN: [45, -8] } }), // shoulders, hips, knees in line
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes', 'hamstrings'],
  };
  // Both hands hold the weight on the hip crease in every frame.
  F.kbBridge = merge(F.bridge, { equip: [{ type: 'kb', hold: 'hip' }], equipBy: { db: [{ type: 'db', hands: 'N', orient: 'end' }] },
    poses: { a: { ik: { hdN: 'lap' } }, b: { ik: { hdN: 'lap' } } } });
  F.thrust = {
    view: 'side', pin: { joint: 'neck', at: [-42, -52] }, key: 'b', props: [{ type: 'box', x: -104, w: 64, h: 45 }],
    equip: [{ type: 'kb', hold: 'hip' }],
    poses: {
      a: { t: -42, n: 20, lN: { flat: true }, ik: { anN: [50, -8], hdN: 'lap' } },
      b: { t: -90, n: 34, lN: { flat: true }, ik: { anN: [50, -8], hdN: 'lap' } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes', 'hamstrings'],
  };
  F.bridge1 = merge(F.bridge, { poses: { a: { lF: { h: 70, k: 0, flat: false, a: 10 } }, b: { lF: { h: 88, k: 0, flat: false, a: 10 } } }, uni: true, leadLimbs: ['lN'] });
  F.thrust1 = merge(F.thrust, { equip: [], poses: { a: { lF: { h: 110, k: 0, flat: false, a: 10 } }, b: { lF: { h: 150, k: 0, flat: false, a: 10 } } }, uni: true, leadLimbs: ['lN'] });

  // Calf raises on the floor: pinned at the toe tip, the heel lifts as the foot tips up onto its ball.
  const CALF_FLAT = { at: [16, -8], lN: { h: 0, k: 0, fd: 90 } };
  const CALF_UP = { at: [16, -3.5], lN: { h: 0, k: 0, fd: 48 } };
  F.calfBW = {
    view: 'side', pin: { joint: 'toN', at: [16, -8] }, key: 'b',
    poses: { a: merge(CALF_FLAT, { t: 0, aN: { s: 4, e: 10 } }), b: merge(CALF_UP, { t: 0, aN: { s: 4, e: 10 } }) },
    rep: ce('a', 'b', { con: 900, holdB: 600, ecc: 1500 }), muscles: ['calves'],
  };
  // Fingertips on a wall in front for balance.
  const WALL_HANDS = { t: 6, n: -4, ik: { hdN: [67, -136] } };
  F.calfWall = merge(F.calfBW, {
    props: [{ type: 'wall', x: 70, side: 1 }],
    poses: { a: WALL_HANDS, b: WALL_HANDS },
  });
  // One leg, the other foot hooked behind the working ankle.
  F.calf1 = merge(F.calfWall, {
    poses: { a: { lF: { h: 14, k: 72, flat: false, a: 40, fd: null } }, b: { lF: { h: 14, k: 72, flat: false, a: 40, fd: null } } },
    uni: true, leadLimbs: ['lN'],
  });
  F.calfLoad = merge(F.calfBW, {
    equip: KB2, equipBy: { db: DB2S },
    poses: { a: { aN: { s: 4, e: 6 } }, b: { aN: { s: 4, e: 6 } } },
  });

  // Hamstring curls -----------------------------------------------------------------------
  // Bridge walkout: from a bridge the heels walk out in small steps until the legs are nearly
  // straight (hips still up), then walk back in.
  const walkout = (t, n, f) => sup({ t, aN: { s: 86 + t, e: 0 }, lN: { flat: true }, lF: { flat: true }, ik: { anN: [n, -8], anF: [f, -8] } });
  // Half way through a step: the stepping heel (side s) lifted off the floor, passed through.
  const walkStep = (t, n, f, s) => merge(walkout(t, n, f), { ['l' + s]: { flat: false }, ik: { ['an' + s]: [s === 'N' ? n : f, -14] } });
  const walkRep = (ph, list) => list.flatMap(([via, to, hold]) => [{ to: via, ms: 190, hold: 0, ph, through: true }, { to, ms: 190, hold, ph }]);
  F.hamWalk = {
    view: 'side', pin: { joint: 'neck', at: [-50, -11] }, key: 'o',
    poses: {
      a: walkout(-108, 45, 45), s1: walkout(-106, 63, 45), s2: walkout(-104, 63, 63), s3: walkout(-102, 81, 63),
      o: walkout(-100, 81, 81), r1: walkout(-102, 63, 81), r3: walkout(-106, 45, 63),
      v1: walkStep(-107, 54, 45, 'N'), v2: walkStep(-105, 63, 54, 'F'), v3: walkStep(-103, 72, 63, 'N'), v4: walkStep(-101, 81, 72, 'F'),
      w1: walkStep(-101, 72, 81, 'N'), w2: walkStep(-103, 63, 72, 'F'), w3: walkStep(-105, 54, 63, 'N'), w4: walkStep(-107, 45, 54, 'F'),
    },
    rep: [
      ...walkRep('ecc', [['v1', 's1', 60], ['v2', 's2', 60], ['v3', 's3', 60], ['v4', 'o', 300]]),
      ...walkRep('con', [['w1', 'r1', 60], ['w2', 's2', 60], ['w3', 'r3', 60], ['w4', 'a', 400]]),
    ],
    muscles: ['hamstrings', 'glutes'],
  };
  // Towel slide curl: heels on a towel (toes up), hips up; the heels slide out, then curl back in.
  const SLIDE_FEET = { flat: false, fd: 172 };
  F.hamSlide = {
    view: 'side', pin: { joint: 'neck', at: [-50, -11] }, key: 'b',
    poses: {
      a: sup({ t: -108, aN: { s: -22, e: 0 }, lN: SLIDE_FEET, ik: { anN: [45, -7] } }),
      b: sup({ t: -97, aN: { s: -11, e: 0 }, lN: SLIDE_FEET, ik: { anN: [83, -7] } }),
    },
    rep: ec('a', 'b', { ecc: 2000, con: 1200 }), muscles: ['hamstrings', 'glutes'],
  };
  // One leg: the other points at the ceiling.
  F.hamSlide1 = merge(F.hamSlide, {
    poses: { a: { lF: { h: 67, k: 0, flat: false, a: 10, fd: null } }, b: { lF: { h: 78, k: 0, flat: false, a: 10, fd: null } } },
    uni: true, leadLimbs: ['lN'],
  });
  // Nordic curl negative: kneeling, heels hooked under a heavy chair or couch; the body tips forward
  // in one straight line from the knees as slowly as possible, the hands catch, then push back up.
  const NORDIC_LEGS = (k) => ({ h: 0, k, flat: false, a: 64 });
  F.nordic = {
    view: 'side', pin: { joint: 'knN', at: [0, -6] }, key: 'b', props: [{ type: 'chair', x: -72, w: 46, h: 45, back: -1 }],
    poses: {
      a: { t: 0, n: 0, lN: NORDIC_LEGS(90), ik: { hdN: [16, -88] } },
      b: { t: 62, n: -12, lN: NORDIC_LEGS(28), ik: { hdN: [95, -13] } },
      c: { t: 74, n: -16, lN: NORDIC_LEGS(16), ik: { hdN: [95, -3] } },
    },
    rep: [{ to: 'b', ms: 3000, hold: 0, ph: 'ecc', through: true }, { to: 'c', ms: 600, hold: 250, ph: 'ecc' }, { to: 'a', ms: 1100, hold: 400, ph: 'con' }],
    muscles: ['hamstrings', 'glutes'],
  };
  // Band good morning: the band under the feet and across the upper back (hands holding it there);
  // a hip hinge with a flat back.
  const GM_ARMS = { uaN: 0.8, uaF: 0.8, faN: 0.42, faF: 0.42 };
  F.bandGM = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'band', hands: 'both', from: 'anN', layer: 'back' }],
    poses: {
      a: { t: 0, sc: GM_ARMS, lN: { h: 0, k: 6 }, ik: { hdN: 'traps' } },
      b: { t: 72, n: -16, sc: GM_ARMS, lN: { h: 84, k: 18 }, ik: { hdN: 'traps' } },
    },
    bend: { hdN: 1, hdF: 1 },
    rep: ec('a', 'b'), muscles: ['hamstrings', 'glutes', 'lowerBack'],
  };

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
  // Under a sturdy table, its edge over the chest (the head out past it, so the face never meets
  // the top): pull the chest up to the edge, elbows driving back toward the feet.
  F.tableRow = {
    view: 'side', pin: { joint: 'heN', at: [46, -3] }, key: 'b', props: [{ type: 'table', x: -70, w: 82, h: 72 }],
    bend: { hdN: [1, 1], hdF: [1, 1] },
    poses: {
      a: { t: -86, n: 6, lN: { h: 0, k: 0, flat: false, a: -10 }, ik: { hdN: [-73, -70] } },
      b: { t: -70, n: 12, lN: { h: 0, k: 0, flat: false, a: -10 }, ik: { hdN: [-73, -70] } },
    },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'biceps'],
  };
  // Face down, arms in a W: elbows out and back toward the hips, hands by the head (the upper arm
  // runs out to the side, so it's drawn short); squeeze the shoulder blades to lift them.
  const W_ARMS = { uaN: 0.45, uaF: 0.45, faN: 0.9, faF: 0.9 };
  F.proneW = {
    view: 'side', pin: PRONE, key: 'b',
    poses: {
      a: prone({ sc: W_ARMS, ik: { hdN: [70, -3.5] }, pole: poles(-1, 0.3) }),
      b: prone({ t: 88, lN: { h: 1 }, sc: W_ARMS, ik: { hdN: [70, -15] }, pole: poles(-1, 0.3) }),
    },
    rep: ce('a', 'b', { holdB: 1200 }), muscles: ['upperBack', 'rearDelts'], prime: 2,
  };
  // Superman lat pull: chest and legs lifted, the arms pull from overhead down to a W and back.
  const SUPERMAN = { t: 80, lN: { h: -12 } };
  F.supermanPull = {
    view: 'side', pin: PRONE, key: 'b',
    poses: {
      a: prone(merge(SUPERMAN, { ik: { hdN: [105.5, -30] }, pole: poles(-1, -0.3) })),
      b: prone(merge(SUPERMAN, { sc: W_ARMS, ik: { hdN: [62, -24] }, pole: poles(-1, -0.3) })),
    },
    rep: ce('a', 'b', { con: 1100, ecc: 1300, holdB: 500 }), muscles: ['lats', 'upperBack', 'lowerBack'], prime: 2,
  };
  // Doorframe row: hands on the frame's edge, feet close to it, lean back and pull the chest in.
  F.doorRow = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'door', x: 18 }],
    poses: {
      a: { t: -14, n: 8, lN: { h: 0, k: 0 }, ik: { hdN: [16, -112] } },
      b: { t: -3, n: 2, lN: { h: 0, k: 0 }, ik: { hdN: [16, -112] } },
    },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['lats', 'upperBack', 'biceps', 'rearDelts'], prime: 2,
  };
  // Band high row: anchored at the top of a door, pull down and back to the chest, elbows out.
  F.bandHighRow = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', props: [{ type: 'door', x: 96 }],
    equip: [{ type: 'band', hands: 'both', from: [96, -196] }],
    poses: { a: st({ t: 4, aN: { s: 132, e: 4 }, lN: { h: 8, k: 12 } }), b: st({ t: 0, sc: { uaN: 0.8, uaF: 0.8 }, aN: { s: -6, e: 128 }, lN: { h: 8, k: 12 } }) },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['upperBack', 'lats', 'rearDelts', 'biceps'], prime: 2,
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

  // Kettlebell high pull: hike the bell back, snap the hips through and pull it to the chest, elbows
  // high and wide (the upper arms out to the sides, so drawn short).
  F.kbHighPull = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'kb', hands: 'both', hold: 'hang' }], equipBy: { db: [{ type: 'db', hands: 'both', orient: 'side', tilt: 90 }] },
    poses: {
      a: { t: 62, n: -20, lN: { h: 95, k: 45 }, ik: { hdN: [5.5, -56.5] } },
      b: { t: -2, lN: { h: 0, k: 0 }, sc: { uaN: 0.55, uaF: 0.55 }, ik: { hdN: [23, -126] } },
    },
    bend: { hdN: 1, hdF: 1 }, // elbows up
    rep: [{ to: 'b', ms: 650, hold: 200, ph: 'con' }, { to: 'a', ms: 750, hold: 100, ph: 'ecc' }],
    muscles: ['rearDelts', 'upperBack', 'glutes', 'hamstrings'], prime: 2,
  };

  // Back extensions -----------------------------------------------------------------------
  // Bird dog: on hands and knees, one arm reaches forward and the opposite leg back, level with the back.
  F.birdDog = {
    view: 'side', pin: QUAD, key: 'b',
    poses: {
      a: merge(quad(83, -10), { ik: { hdF: [50, -3] } }),
      // The hand peels off the floor first (a via point, passed through).
      l: merge(quad(83, -9), { lF: { h: 62, k: 72, flat: false, a: 78 }, ik: { hdN: [56, -15], hdF: [50, -3] } }),
      b: merge(quad(83, -6), { lF: { h: -9, k: 0, flat: false, a: 30 }, ik: { hdN: [107, -56], hdF: [50, -3] } }),
    },
    rep: [{ to: 'l', ms: 450, hold: 0, ph: 'con', through: true }, { to: 'b', ms: 850, hold: 1000, ph: 'con' },
      { to: 'l', ms: 800, hold: 0, ph: 'ecc', through: true }, { to: 'a', ms: 450, hold: 200, ph: 'ecc' }],
    muscles: ['lowerBack', 'glutes', 'abs'], uni: true, leadLimbs: ['aN', 'lF'],
  };
  // Superman hold: arms long overhead, chest, arms and legs lifted off the floor.
  const SUPERMAN_HOLD = { t: 80, lN: { h: -12 }, aN: { s: 185, e: 0 } };
  F.superman = {
    view: 'side', pin: PRONE, key: 'a',
    poses: { a: prone(SUPERMAN_HOLD), a2: prone(merge(SUPERMAN_HOLD, { t: 79, lN: { h: -13 }, aN: { s: 186 } })) },
    rep: iso('a', 'a2'), muscles: ['lowerBack', 'glutes', 'upperBack'],
  };
  // Back extension: fingertips at the temples, elbows wide (so the arms are drawn short), the chest
  // lifts; the legs stay down.
  const TEMPLE_ARMS = { uaN: 0.4, uaF: 0.4, faN: 0.7, faF: 0.7 };
  F.backExt = {
    view: 'side', pin: PRONE, key: 'b',
    poses: {
      a: prone({ sc: TEMPLE_ARMS, ik: { hdN: 'head' }, pole: poles(0.3, 1) }),
      b: prone({ t: 70, n: -4, lN: { h: -17 }, sc: TEMPLE_ARMS, ik: { hdN: 'head' }, pole: poles(0.3, 1) }),
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['lowerBack', 'glutes'],
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
  // Standing side-on to a wall, the back of the wrist pressed out into it as if raising the arm.
  F.wallRaiseIso = {
    view: 'front', pin: FRONT_STAND, key: 'a', armLayer: 'front', props: [{ type: 'wall', x: 35, side: 1 }],
    poses: {
      a: { aN: { s: 17, e: 4 }, aF: { s: 6, e: 12 }, lN: { h: 3 } },
      a2: { aN: { s: 18, e: 4 }, aF: { s: 6, e: 14 }, lN: { h: 3 } },
    },
    rep: iso('a', 'a2'), muscles: ['sideDelts'], uni: true, leadLimbs: ['aN'],
  };
  // Pike push-ups: hips high in an upside-down V, arms overhead; the head lowers to the floor just
  // in front of the hands, the hips drifting forward a little on the way down.
  const pike = (t, h, hand, a) => ({ t, n: 0, lN: { h, k: 0, flat: false, a: a == null ? 20 : a }, ik: { hdN: hand } });
  F.pike = {
    view: 'side', pin: TOES, key: 'b',
    poses: { a: pike(128, 100, [88, -3]), b: pike(144, 100, [88, -3]) },
    rep: ec('a', 'b'), muscles: ['frontDelts', 'triceps', 'sideDelts'],
  };
  // Hands on the couch edge: the torso starts nearly level and tips down as the head lowers.
  F.pikeIncline = {
    view: 'side', pin: TOES, key: 'b', props: [{ type: 'box', x: 96, w: 60, h: 45 }],
    poses: { a: pike(100, 86, [102, -48]), b: pike(124, 102, [102, -48]) },
    rep: ec('a', 'b'), muscles: ['frontDelts', 'triceps', 'sideDelts'],
  };
  // Feet on the couch, torso nearly upside down: the most weight on the arms.
  F.pikeDecline = {
    view: 'side', pin: { joint: 'toN', at: [0, -46] }, key: 'b', props: [{ type: 'box', x: -48, w: 52, h: 45 }],
    poses: { a: pike(166, 111, [81, -3], 10), b: pike(176, 104, [81, -3], 10) },
    rep: ec('a', 'b'), muscles: ['frontDelts', 'triceps', 'sideDelts'],
  };
  // Standing overhead press: from the shoulders (the upper arm out to the side, so drawn shorter)
  // to straight overhead.
  F.ohPress = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: DB2,
    poses: {
      a: st({ t: -2, sc: { uaN: 0.69, uaF: 0.69 }, ik: { hdN: [3, -152] } }),
      b: st({ t: -2, ik: { hdN: [0, -199] } }),
    },
    rep: ce('a', 'b'), muscles: ['frontDelts', 'sideDelts', 'triceps'],
  };
  F.bandPress = merge(F.ohPress, { equip: [{ type: 'band', hands: 'both', from: 'anN' }] });
  // One arm: the bell rests on the back of the forearm; the free arm hangs relaxed.
  F.ohPress1 = merge(F.ohPress, {
    equip: [{ type: 'kb', hands: 'N', hold: 'rack' }], equipBy: { db: DBN },
    poses: { a: { aF: { s: 4, e: 10 } }, b: { aF: { s: 4, e: 10 } } }, uni: true, leadLimbs: ['aN'],
  });
  // Arms in a Y overhead (out at 45°, so drawn shorter), thumbs up, lifted off the floor.
  const Y_ARMS = { uaN: 0.72, uaF: 0.72, faN: 0.72, faF: 0.72 };
  F.proneY = {
    view: 'side', pin: PRONE, key: 'b',
    poses: { a: prone({ aN: { s: 172, e: 0 }, sc: Y_ARMS }), b: prone({ t: 88, lN: { h: 1 }, aN: { s: 194, e: 0 }, sc: Y_ARMS }) },
    rep: ce('a', 'b', { holdB: 800 }), muscles: ['upperBack', 'sideDelts', 'rearDelts'], prime: 2,
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
  // The ball is held out in front (depth 20), so the arms are drawn foreshortened, the one reaching
  // across the body less so, elbows out and down.
  const twist = (bx, tw, o) => {
    const across = Math.abs(bx) / 26 * 0.22;
    const arm = (s) => 0.5 + (s * bx < 0 ? across : 0);
    return merge({
      ts: 0.84, ns: 0.9, tw, ball: [bx, -52], ik: { hdN: [bx + 5, -50, 20], hdF: [bx - 5, -50, 20] },
      lN: { h: 160, k: 158 }, sc: { thN: 0.42, thF: 0.42, shN: 0.52, shF: 0.52, uaN: arm(1), faN: arm(1), uaF: arm(-1), faF: arm(-1) },
    }, o || {});
  };
  F.russian = {
    view: 'front', pin: SEATED_FRONT, key: 'l', armLayer: 'front', legLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: { m: twist(0, 0), l: twist(26, 34), r: twist(-26, -34) }, bend: { hdN: [1, 1], hdF: [1, 1] },
    rep: [{ to: 'l', ms: 900, hold: 150, ph: 'con' }, { to: 'm', ms: 700, hold: 0, ph: 'move' }, { to: 'r', ms: 900, hold: 150, ph: 'con' }, { to: 'm', ms: 700, hold: 0, ph: 'move' }],
    muscles: ['obliques', 'abs'],
  };
  const FEET_UP = { lN: { h: 168, k: 120, flat: false }, sc: { thN: 0.42, thF: 0.42, shN: 0.4, shF: 0.4 } };
  F.russianUp = merge(F.russian, { poses: { m: FEET_UP, l: FEET_UP, r: FEET_UP } });
  // The ball travels in front of the body (the third number: depth): the arm reaching across passes in front of the face.
  // Elbows point down and out all the way ([out, down, forward]), so the far one doesn't swing round
  // as the hands cross the face.
  const CHOP_HIGH = { hdN: [1, 1, 0.4], hdF: [0.5, 1, 0.4] }, CHOP_LOW = { hdN: [1, 1, 0.4], hdF: [1, 1, 0.4] };
  F.chop = {
    view: 'front', pin: { joint: 'anN', at: [22, -8] }, key: 'b', armLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { tw: 36, ball: [34, -176], ik: { hdN: [38, -172, 12], hdF: [30, -172, 12] }, pole: CHOP_HIGH, lN: { h: 9, k: 0 } },
      b: { tw: -36, ball: [-18, -100], ik: { hdN: [-14, -104, 10], hdF: [-22, -104, 12] }, pole: CHOP_LOW, lN: { h: 9, k: 0 }, sc: { thN: 0.95, shN: 0.95, thF: 0.95, shF: 0.95 } },
    },
    rep: ce('a', 'b', { con: 800, ecc: 1300 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };
  F.kneelChop = {
    view: 'front', pin: { joint: 'knN', at: [12, -6] }, key: 'b', armLayer: 'front', legLayer: 'front', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { tw: 34, ball: [32, -142], ik: { hdN: [36, -138, 12], hdF: [28, -138, 10] }, pole: CHOP_HIGH, lN: { h: 4, k: 0 }, lF: { h: 150, k: 150 }, sc: { shN: 0.02, ftN: 0.2, thF: 0.35 } },
      b: { tw: -34, ball: [-26, -52], ik: { hdN: [-22, -56, 10], hdF: [-30, -56, 12] }, pole: CHOP_LOW, lN: { h: 4, k: 0 }, lF: { h: 150, k: 150 }, sc: { shN: 0.02, ftN: 0.2, thF: 0.35 } },
    },
    rep: ce('a', 'b', { con: 800, ecc: 1300 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };
  // Slam: the ball held overhead (free 0: in the hands) is thrown down, leading the hands to the
  // floor (r: in the air), and picked up again from a deep squat, hands on its sides.
  F.slam = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { t: -4, aN: { s: 176, e: 12 }, lN: { h: 0, k: 0, flat: false, a: 18 }, ball: [4, -212], free: 0 },
      r: { t: 30, n: -12, aN: { s: 70, e: 6 }, lN: { h: 50, k: 46 }, ball: [56, -52] },
      b: { t: 66, n: -28, aN: { s: 69, e: 3 }, lN: { h: 131, k: 124 }, ball: [46, -10], free: 0 },
    },
    rep: [{ to: 'r', ms: 220, hold: 0, ph: 'con' }, { to: 'b', ms: 200, hold: 250, ph: 'con' }, { to: 'a', ms: 900, hold: 250, ph: 'move' }],
    muscles: ['abs', 'lats'],
  };
  F.toss = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: [{ type: 'ball', hands: 'both' }],
    poses: {
      a: { t: 0, aN: { s: 32, e: 118 }, lN: { h: 18, k: 30 }, ball: [22, -126], free: 0 },
      b: { t: -2, aN: { s: 172, e: 8 }, lN: { h: 0, k: 0 }, ball: [6, -214], free: 0 },
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
      b: { aN: { s: 6, e: 4 }, aF: { s: 12, e: 12 }, lN: { h: 3, k: 3, flat: false }, lF: { h: 3, k: 0, flat: true }, sc: { thN: 0.95, shN: 0.84 } },
      c: { aN: { s: 6, e: 4 }, aF: { s: 12, e: 12 }, lN: { h: 3, k: 0, flat: true }, lF: { h: 3, k: 3, flat: false }, sc: { thF: 0.95, shF: 0.84 } },
    },
    rep: cyc(['b', 'a', 'c', 'a'], 380, 40), muscles: ['obliques', 'forearms'], uni: true, leadLimbs: ['aN'],
  };
  F.march = merge(F.carry, {
    poses: { b: { lN: { k: 4 }, sc: { thN: 0.5, shN: 0.92 } }, c: { lF: { k: 4 }, sc: { thF: 0.5, shF: 0.92 } } },
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
      // Standing up, the arms swing forward and up in an arc (via points, passed through).
      u1: { at: [-6, -66], t: 50, n: -14, lN: { flat: true }, ik: { anN: [0, -8], hdN: [70, -74] } },
      u2: { at: [-2, -89], t: 10, n: -4, lN: { flat: true }, ik: { anN: [0, -8], hdN: [32, -183] } },
      d: { at: [0, -118], t: -2, lN: { flat: false, a: 40 }, ik: { anN: [0, -34], hdN: [12, -224] } },
      l: { at: [-2, -84], t: 14, n: -6, lN: { flat: true }, ik: { anN: [0, -8], hdN: [46, -112] } },
    },
    rep: [{ to: 'b', ms: 500, hold: 0, ph: 'move' }, { to: 'j', ms: 220, hold: 0, ph: 'move' }, { to: 'c', ms: 230, hold: 150, ph: 'move' }, { to: 'j', ms: 220, hold: 0, ph: 'move' }, { to: 'b', ms: 230, hold: 0, ph: 'move' },
      { to: 'u1', ms: 140, hold: 0, ph: 'con', through: true }, { to: 'u2', ms: 140, hold: 0, ph: 'con', through: true }, { to: 'd', ms: 160, hold: 60, ph: 'con' },
      { to: 'l', ms: 220, hold: 0, ph: 'move', through: true }, { to: 'a', ms: 260, hold: 190, ph: 'move' }],
    muscles: ['quads', 'chest', 'abs'],
  };
  F.pulse = merge(F.squatBW, {
    poses: { a: { t: 20, aN: { s: 110, e: 4 }, lN: { h: 70, k: 72 } } },
    rep: cyc(['b', 'a'], 450, 40),
  });
  // High knees: each arm drives forward with the other knee, as in running.
  F.highKnees = {
    view: 'side', pin: { joint: 'hip', at: [0, -92] }, key: 'b',
    poses: {
      a: { t: 0, aN: { s: -30, e: 80 }, aF: { s: 30, e: 80 }, lN: { h: 80, k: 90, flat: false, a: 20 }, lF: { h: 0, k: 4 } },
      b: { t: 0, aN: { s: 30, e: 80 }, aF: { s: -30, e: 80 }, lN: { h: 0, k: 4 }, lF: { h: 80, k: 90, flat: false, a: 20 } },
      // Passed through: the foot leaving the floor heel first (the knee bends before it drives up)
      // as the other comes down.
      ua: { t: 0, aN: { s: 0, e: 80 }, aF: { s: 0, e: 80 }, lN: { h: 28, k: 62, flat: false, a: 20 }, lF: { h: 36, k: 80, flat: false, a: 10 } },
      ub: { t: 0, aN: { s: 0, e: 80 }, aF: { s: 0, e: 80 }, lN: { h: 36, k: 80, flat: false, a: 10 }, lF: { h: 28, k: 62, flat: false, a: 20 } },
    },
    rep: [{ to: 'ub', ms: 210, hold: 0, ph: 'move', through: true }, { to: 'b', ms: 210, hold: 60, ph: 'move' }, { to: 'ua', ms: 210, hold: 0, ph: 'move', through: true }, { to: 'a', ms: 210, hold: 60, ph: 'move' }],
    muscles: ['hipFlexors', 'quads'],
  };

  // Step jacks: one foot steps out to the side as the arms sweep up, then back in, then the other.
  F.stepJack = {
    view: 'front', pin: { joint: 'hip' }, key: 'b', armLayer: 'front',
    poses: {
      a: { at: [0, -92.7], aN: { s: 8, e: 6 }, lN: { flat: true }, ik: { anN: [16, -8], anF: [-16, -8] } },
      b: { at: [6, -88], aN: { s: 160, e: 6 }, lN: { flat: true }, ik: { anN: [40, -8], anF: [-16, -8] } },
      c: { at: [-6, -88], aN: { s: 160, e: 6 }, lN: { flat: true }, ik: { anN: [16, -8], anF: [-40, -8] } },
      // Half way through a step (passed through): the stepping foot lifted.
      bs: { at: [3, -91], aN: { s: 84, e: 6 }, lN: { flat: false }, lF: { flat: true }, ik: { anN: [28, -15], anF: [-16, -8] } },
      cs: { at: [-3, -91], aN: { s: 84, e: 6 }, lN: { flat: true }, lF: { flat: false }, ik: { anN: [16, -8], anF: [-28, -15] } },
    },
    rep: [['bs', 'b'], ['bs', 'a'], ['cs', 'c'], ['cs', 'a']].flatMap(([via, to]) => [{ to: via, ms: 190, hold: 0, ph: 'move', through: true }, { to, ms: 190, hold: 40, ph: 'move' }]),
    muscles: ['sideDelts', 'glutes', 'calves'],
  };
  // Squat thrust, stepping: hands down, step back to a plank one foot at a time, step in, stand.
  F.squatThrust = {
    view: 'side', pin: { joint: 'hip' }, key: 'c',
    poses: {
      a: { at: [0, -93], t: 0, lN: { flat: true }, ik: { anN: [0, -8], hdN: [8, -86] } },
      b: { at: [-10, -40], t: 76, n: -20, lN: { flat: true }, ik: { anN: [0, -8], hdN: [36, -3] } },
      // Half way down (and up): the hands reaching for the floor, passed through.
      d: { at: [-8, -52], t: 55, n: -16, lN: { flat: true }, ik: { anN: [0, -8], hdN: [36, -26] } },
      u: { at: [-4, -80], t: 25, n: -8, lN: { flat: true }, ik: { anN: [0, -8], hdN: [22, -72] } },
      // A foot in the air on its way back (or in): passed through, so the knee clears the floor.
      k1: { at: [-10.5, -41], t: 72, n: -17, lN: { flat: false, a: 10 }, lF: { flat: true }, ik: { anN: [-46, -30], anF: [0, -8], hdN: [36, -3] } },
      s: { at: [-11, -41], t: 72, n: -15, lN: { flat: false, a: 0 }, lF: { flat: true }, ik: { anN: [-92, -16], anF: [0, -8], hdN: [36, -3] } },
      k2: { at: [-11.5, -41.5], t: 72, n: -12, lN: { flat: false, a: 0 }, lF: { flat: false, a: 10 }, ik: { anN: [-92, -16], anF: [-46, -30], hdN: [36, -3] } },
      c: { at: [-12, -42], t: 72, n: -10, lN: { flat: false, a: 0 }, ik: { anN: [-92, -16], hdN: [36, -3] } },
    },
    rep: [
      { to: 'd', ms: 350, hold: 0, ph: 'move', through: true }, { to: 'b', ms: 350, hold: 0, ph: 'move' }, { to: 'k1', ms: 220, hold: 0, ph: 'move', through: true }, { to: 's', ms: 220, hold: 0, ph: 'move' },
      { to: 'k2', ms: 220, hold: 0, ph: 'move', through: true }, { to: 'c', ms: 220, hold: 150, ph: 'move' }, { to: 'k2', ms: 220, hold: 0, ph: 'move', through: true },
      { to: 's', ms: 220, hold: 0, ph: 'move' }, { to: 'k1', ms: 220, hold: 0, ph: 'move', through: true }, { to: 'b', ms: 220, hold: 0, ph: 'move' },
      { to: 'd', ms: 450, hold: 0, ph: 'move', through: true }, { to: 'u', ms: 300, hold: 0, ph: 'move', through: true }, { to: 'a', ms: 400, hold: 200, ph: 'move' },
    ],
    muscles: ['quads', 'abs', 'frontDelts'],
  };

  // Warm-up and mobility ---------------------------------------------------------------
  // Kettlebell halo: the bell, bottom up and held by the horns in both hands, circles the head at a
  // steady speed: out in front at the chest, beside the head at the sides, above and behind it at
  // the back, elbows out. Each hand reaches its grip in 3D (a target with depth, + toward the
  // viewer), so the arms foreshorten and pass behind the head in the flat figure and go round it in
  // the 3D one. deg: 0 in front, 90 at the figure's left (the N side).
  // Which way each elbow points, by where the bell is from that arm's side: 0 in front, 90 on its
  // own side, 180 behind, 270 across the face ([out, down, forward], interpolated). Both arms have
  // to pass over the head once a circle: the arm reaching across rises in front of the forehead,
  // and both elbows point up as the bell goes behind.
  const HALO_POLE = [[0, 1, 0.6, 0.5], [45, 1, 0.1, 0.5], [90, 1, -0.2, 0.2], [135, 0.8, -0.6, 0.3], [180, 0.5, -1, 0.4],
    [225, 0.1, -1.5, 0.7], [270, -0.1, -0.8, 0.6], [315, 0.4, 0.5, 1], [360, 1, 0.6, 0.5]];
  const haloPole = (al) => {
    let i = 0;
    while (i < HALO_POLE.length - 2 && al > HALO_POLE[i + 1][0]) i++;
    const a = HALO_POLE[i], b = HALO_POLE[i + 1], t = (al - a[0]) / (b[0] - a[0]);
    return [1, 2, 3].map((k) => Math.round((a[k] + (b[k] - a[k]) * t) * 100) / 100);
  };
  const halo = (deg) => {
    const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    // The grips circle the head's axis (x = 0, z = 1): far out in front at the chest, level with the
    // crown at the sides and above it behind, where the forearms pass over the head.
    const R = 20 + 10 * c + 9 * Math.sin(2 * th) ** 2;
    const mid = [R * s, -165.75 + 17.5 * c + 5.25 * Math.cos(2 * th), 1 + R * c]; // -143 in front, -171 at the sides, -178 behind
    // The handle turns with the bell, but only half as far as the circle (the wrists can't twist a
    // full turn): across the body in front and behind, at an angle at the sides.
    const psi = (-Math.PI / 4) * s;
    // The head nods a little as the bell passes behind it.
    const nod = 0.03 + 0.3 * Math.max(0, -c) ** 1.5;
    const pose = { lN: { h: 5 }, ns: Math.round(Math.cos(nod) * 100) / 100, ik: {}, pole: {} };
    for (const [side, sg] of [['N', 1], ['F', -1]]) {
      pose.ik['hd' + side] = [r1(mid[0] + sg * 6.3 * Math.cos(psi)), r1(mid[1]), r1(mid[2] + sg * 6.3 * Math.sin(psi))];
      pose.pole['hd' + side] = haloPole((((sg > 0 ? deg : -deg) % 360) + 360) % 360);
    }
    return pose;
  };
  F.halo = {
    view: 'front', pin: { joint: 'hip', at: [0, -92.7] }, key: 'fl', armLayer: 'front', flow: true,
    equip: [{ type: 'kb', hands: 'both', hold: 'horns' }],
    poses: { f: halo(0), fl: halo(45), l: halo(90), bl: halo(135), b: halo(180), br: halo(225), r: halo(270), fr: halo(315) },
    rep: cyc(['bl', 'b', 'br', 'r', 'fr', 'f', 'fl', 'l'], 320, 0), muscles: ['sideDelts', 'upperBack'],
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
  // Open book (front view): lying on the left side, knees bent toward you (thighs drawn short), the
  // bottom arm out in front; the top arm sweeps from in front of the chest up over the body to
  // behind it as the chest turns open (seen from the front the arm only ever points up, so it
  // lengthens then shortens; its depth says where it is). The head rests low.
  const book = (sc, z, tw) => ({
    t: 90, n: 25, tw, lN: { h: 0, k: 0 }, aN: { s: 0, e: 0 }, aF: { s: 90, e: 12 },
    sc: { thN: 0.25, thF: 0.25, uaN: 0.15, faN: 0.15, uaF: sc, faF: sc }, depth: { elN: 12, wrN: 40, elF: r1(z * 0.45), wrF: z },
  });
  F.openBook = {
    view: 'front', pin: { joint: 'hip', at: [0, -19] }, key: 'b', armLayer: 'front', legLayer: 'back',
    poses: { a: book(0.12, 48, 0), m: book(1, 0, 15), b: book(0.12, -48, 30) },
    rep: [{ to: 'm', ms: 1300, hold: 0, ph: 'iso', through: true }, { to: 'b', ms: 1300, hold: 900, ph: 'iso' }, { to: 'm', ms: 1300, hold: 0, ph: 'iso', through: true }, { to: 'a', ms: 1300, hold: 500, ph: 'iso' }],
    muscles: ['upperBack', 'chest', 'obliques'], uni: true, leadLimbs: ['aF'],
  };
  // 90/90 switches (front view): sitting tall, hands on the floor behind, feet planted wide; both
  // knees drop to one side into a 90/90 (front shin across, back shin behind), then up and over.
  const legs9090 = (thN, shN, thF, shF) => ({ sc: { thN, shN, thF, shF } });
  F.hips9090 = {
    view: 'front', pin: SEATED_FRONT, key: 'l', armLayer: 'back', legLayer: 'front',
    poses: {
      m: merge(legs9090(0.8, 0.9, 0.8, 0.9), { t: 0, ts: 0.92, ns: 0.95, aN: { s: 22, e: 10 }, depth: { elN: -8, wrN: -20, elF: -8, wrF: -20 }, lN: { flat: true }, ik: { anN: [30, -8], anF: [-30, -8] } }),
      l: merge(legs9090(0.86, 0.36, 0.3, 0.83), { t: 6, ts: 0.92, ns: 0.95, aN: { s: 22, e: 10 }, depth: { elN: -8, wrN: -20, elF: -8, wrF: -20 }, lN: { flat: true }, ik: { anN: [30, -8], anF: [-30, -8] } }),
      r: merge(legs9090(0.3, 0.83, 0.86, 0.36), { t: -6, ts: 0.92, ns: 0.95, aN: { s: 22, e: 10 }, depth: { elN: -8, wrN: -20, elF: -8, wrF: -20 }, lN: { flat: true }, ik: { anN: [30, -8], anF: [-30, -8] } }),
    },
    bend: { anN: [1, 0], anF: [1, 0] },
    rep: [{ to: 'm', ms: 1100, hold: 0, ph: 'iso', through: true }, { to: 'r', ms: 1100, hold: 900, ph: 'iso' }, { to: 'm', ms: 1100, hold: 0, ph: 'iso', through: true }, { to: 'l', ms: 1100, hold: 900, ph: 'iso' }],
    muscles: ['glutes', 'hipFlexors'],
  };
  // Hamstring floss: on the back, hands behind one thigh held upright; the knee straightens (toes
  // pulled back), then bends again.
  F.hamFloss = {
    view: 'side', pin: SUPINE_HIP, key: 'b',
    poses: {
      a: sup({ n: 8, lN: { h: 90, k: 95, flat: false, a: 40 }, lF: { h: 0, k: 0, flat: false, a: 30 }, ik: { hdN: [-4, -42] } }),
      b: sup({ n: 8, lN: { h: 90, k: 6, flat: false, a: 0 }, lF: { h: 0, k: 0, flat: false, a: 30 }, ik: { hdN: [-4, -42] } }),
    },
    rep: cyc(['b', 'a'], 1300, 500, 'iso'), muscles: ['hamstrings', 'calves'], uni: true, leadLimbs: ['lN'],
  };
  // Wall calf stretch: hands on the wall, the back leg straight with its heel down; the hips ease in.
  F.wallCalf = {
    view: 'side', pin: { joint: 'hip' }, key: 'a', props: [{ type: 'wall', x: 66, side: 1 }],
    poses: {
      a: { at: [2, -82], t: 12, n: -4, lN: { flat: true }, lF: { flat: true }, ik: { anN: [-39.5, -8], anF: [22, -8], hdN: [63, -135] } },
      a2: { at: [4, -81.5], t: 14, n: -4, lN: { flat: true }, lF: { flat: true }, ik: { anN: [-39.5, -8], anF: [22, -8], hdN: [63, -135] } },
    },
    rep: iso('a', 'a2', 2600), muscles: ['calves'], uni: true, leadLimbs: ['lN'],
  };
  // Ankle rocks: half kneeling, the front foot flat; the knee rocks forward over the toes, heel down.
  F.ankleRock = {
    view: 'side', pin: { joint: 'anN', at: [34, -8] }, key: 'b',
    poses: {
      a: { t: 2, aN: { s: 30, e: 70 }, lN: { h: 93.5, k: 91.5, flat: true }, lF: { flat: false, a: 80 }, ik: { anF: [-44, -7] } },
      b: { t: 4, aN: { s: 30, e: 70 }, lN: { h: 91, k: 112, flat: true }, lF: { flat: false, a: 80 }, ik: { anF: [-44, -7] } },
    },
    rep: cyc(['b', 'a'], 1300, 500, 'iso'), muscles: ['calves'], uni: true, leadLimbs: ['lN'],
  };
  // Chest opener: hands clasped behind the back, shoulder blades squeezed, the hands lift.
  F.chestOpen = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b',
    poses: { a: st({ t: -2, ik: { hdN: [-20, -89] } }), b: st({ t: -4, n: -4, ik: { hdN: [-36, -96] } }) },
    rep: cyc(['b', 'a'], 1600, 800, 'iso'), muscles: ['chest', 'frontDelts'],
  };
  // Leg swings: standing on one leg (a hand on a wall or chair), the other swings forward and back,
  // the free arm against it (back as the leg swings forward), as in walking.
  F.legSwing = {
    view: 'side', pin: { joint: 'anF', at: [0, -8] }, key: 'f',
    poses: {
      f: { t: -2, aN: { s: -20, e: 20 }, aF: { s: 40, e: 30 }, lN: { h: 58, k: 8, flat: false, a: 20 }, lF: { h: 0, k: 2, flat: true } },
      m: { t: 1, aN: { s: 0, e: 20 }, aF: { s: 40, e: 30 }, lN: { h: 20, k: 55, flat: false, a: 0 }, lF: { h: 0, k: 2, flat: true } },
      b: { t: 4, aN: { s: 20, e: 20 }, aF: { s: 40, e: 30 }, lN: { h: -28, k: 12, flat: false, a: 30 }, lF: { h: 0, k: 2, flat: true } },
    },
    rep: [{ to: 'm', ms: 260, hold: 0, ph: 'move', through: true }, { to: 'f', ms: 260, hold: 0, ph: 'move' }, { to: 'm', ms: 260, hold: 0, ph: 'move', through: true }, { to: 'b', ms: 260, hold: 0, ph: 'move' }],
    muscles: ['hamstrings', 'hipFlexors', 'glutes'], uni: true, leadLimbs: ['lN'],
  };
  // Scap push-up: arms straight in a plank, the chest sinks between the shoulder blades, then the
  // floor is pushed away.
  F.scapPush = {
    view: 'side', pin: TOES, key: 'b', poses: { a: plank(71, [124, -3]), b: plank(72.5, [124, -3]) },
    rep: ec('a', 'b', { ecc: 900, con: 700, holdA: 250, holdB: 150 }), muscles: ['chest', 'upperBack'],
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

  // Gym ---------------------------------------------------------------------------------------
  // Props and held equipment are documented in engine/pose.js (gymGeom, machineGeom, equipment).
  // Barbells draw end-on at the grip ('traps' / 'lap' holds put the bar on the back or the hips,
  // and `ik: { hdN: 'traps' }` keeps the hands on it). r is the plate radius (0: a bare bar).
  const BENCH_H = 45;
  const ON_BENCH = { joint: 'hip', at: [0, -(BENCH_H + 11)] }; // lying on a flat bench
  const FLAT_BENCH = { type: 'bench', x: -84, w: 118, h: BENCH_H };
  const BENCH_FEET = { t: -90, n: 0, lN: { flat: true }, ik: { anN: [44, -8] } };
  const onBench = (hand, ua, o) => merge(BENCH_FEET, merge({ sc: { uaN: ua, uaF: ua }, ik: { hdN: hand } }, o || {}));
  const BB = (r, o) => [Object.assign({ type: 'bb', hands: 'both', r }, o || {})];
  const EZ = (r) => [{ type: 'ez', hands: 'both', r }];
  const ARMS = (ua, fa) => ({ uaN: ua, uaF: ua, faN: fa, faF: fa });

  // Chest: presses on a flat bench, lowering to the lower chest.
  F.benchBB = {
    view: 'side', pin: ON_BENCH, key: 'b', equip: BB(22.5),
    props: [FLAT_BENCH, { type: 'rack', x: -58, h: 104, d: 0, top: 128 }],
    poses: { a: onBench([-47, -113.5], 1), b: onBench([-38, -71], 0.63) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.benchDB = {
    view: 'side', pin: ON_BENCH, key: 'b', equip: DB2, props: [FLAT_BENCH],
    poses: { a: onBench([-47, -113.5], 1), b: onBench([-40, -70], 0.6) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.benchSmith = {
    view: 'side', pin: ON_BENCH, key: 'b', equip: BB(20), props: [FLAT_BENCH, { type: 'smith', x: -40, h: 106 }],
    poses: { a: onBench([-40, -112.5], 1), b: onBench([-40, -71], 0.63) },
    rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  F.closeGrip = {
    view: 'side', pin: ON_BENCH, key: 'b', equip: BB(22.5),
    props: [FLAT_BENCH, { type: 'rack', x: -58, h: 104, d: 0, top: 128 }],
    poses: { a: onBench([-47, -113.5], 1), b: onBench([-35, -70], 0.86) },
    rep: ec('a', 'b'), muscles: ['triceps', 'chest', 'frontDelts'],
  };
  F.machinePress = {
    view: 'side', pin: { joint: 'hip', at: [0, -55] }, key: 'b',
    props: [{ type: 'machine', kind: 'chestPress', x: -10.1, h: 46, back: 80, seat: 40, pivot: [18, -168] }],
    poses: {
      a: { t: -10, lN: { flat: true }, sc: ARMS(0.62, 1), ik: { anN: [48, -8], hdN: [6, -93] } },
      b: { t: -10, lN: { flat: true }, sc: ARMS(0.95, 1), ik: { anN: [48, -8], hdN: [47, -98] } },
    },
    rep: ce('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'],
  };
  // Adjustable bench at 40°: sitting on the seat, back on the pad (t = -50).
  const INCLINE = { type: 'bench', x: -87.4, w: 116, h: BENCH_H, incline: 40, back: -1, seat: 36 };
  const ON_INCLINE = { joint: 'hip', at: [0, -54] };
  const inc = (hand, ua) => ({ t: -50, n: -6, lN: { flat: true }, sc: { uaN: ua, uaF: ua }, ik: { anN: [58, -8], hdN: hand } });
  F.inclineDB = {
    view: 'side', pin: ON_INCLINE, key: 'b', equip: DB2, props: [INCLINE],
    poses: { a: inc([-37, -143.5], 1), b: inc([-26, -94], 0.72) },
    rep: ec('a', 'b'), muscles: ['chest', 'frontDelts', 'triceps'],
  };
  F.inclineBB = {
    view: 'side', pin: ON_INCLINE, key: 'b', equip: BB(20), props: [INCLINE, { type: 'rack', x: -52, h: 138, d: 0, top: 160 }],
    poses: { a: inc([-37, -143.5], 1), b: inc([-24.5, -92], 0.72) },
    rep: ec('a', 'b'), muscles: ['chest', 'frontDelts', 'triceps'],
  };
  F.inclineSmith = {
    view: 'side', pin: ON_INCLINE, key: 'b', equip: BB(20), props: [INCLINE, { type: 'smith', x: -30, h: 138 }],
    poses: { a: inc([-30, -143], 1), b: inc([-30, -97], 0.72) },
    rep: ec('a', 'b'), muscles: ['chest', 'frontDelts', 'triceps'],
  };
  // Flyes: cable crossover (front view, high pulleys), pec deck (front view, seated), dumbbell fly
  // on a flat bench (top view, like the floor fly).
  const FRONT_CENTER = { joint: 'hip', at: [0, -92.7] }; // standing, front view, centred on x = 0 (legs h: 5)
  // Flyes sweep the hands round a real arc (targets with depth, + in front), elbows softly bent and
  // pointing out and back; `m` is a point on the arc the rep passes through.
  const FLY_POLE = [1, 0.6, -0.5];
  const fly = (h, o) => merge({ ik: { hdN: h, hdF: [-h[0], h[1], h[2]] }, pole: { hdN: FLY_POLE, hdF: FLY_POLE } }, o || {});
  const flyRep = (open, closed, holdClosed) => [
    { to: 'm', ms: 500, hold: 0, ph: open === 'a' ? 'con' : 'ecc', through: true }, { to: closed, ms: 500, hold: holdClosed, ph: 'con' },
    { to: 'm', ms: 1000, hold: 0, ph: 'ecc', through: true }, { to: open, ms: 1000, hold: 300, ph: 'ecc' },
  ];
  F.cableFly = {
    view: 'front', pin: FRONT_CENTER, key: 'b', armLayer: 'front',
    props: [{ type: 'cable', x: 92, y: -190, to: 'hdN' }, { type: 'cable', x: -92, y: -190, to: 'hdF' }],
    equip: [{ type: 'handle', hands: 'both' }],
    poses: {
      a: fly([72, -150, -5], { ts: 0.96, lN: { h: 5 } }),
      m: fly([54, -122, 35], { ts: 0.96, lN: { h: 5 } }),
      b: fly([6, -112, 42], { ts: 0.96, lN: { h: 5 } }),
    },
    rep: flyRep('a', 'b', 500), muscles: ['chest', 'frontDelts'],
  };
  const PEC_DECK = { type: 'machine', kind: 'pecDeck', x: 0, h: 48, top: 168, py: 146, dx: 20, w: 50 };
  const SEAT_FRONT = { lN: { h: 6, k: 6 }, sc: { thN: 0.15, thF: 0.15 } };
  // Seated at the pec deck: the hands on an arc 55 from the shoulders, from out wide to together in front.
  const DECK_OPEN = [71.8, -108, -4.8], DECK_MID = [52.4, -108, 42.1], DECK_SHUT = [7.4, -108, 54.2];
  F.pecFly = {
    view: 'front', pin: { joint: 'hip', at: [0, -57] }, key: 'b', armLayer: 'front', legLayer: 'front', props: [PEC_DECK],
    poses: { a: fly(DECK_OPEN, SEAT_FRONT), m: fly(DECK_MID, SEAT_FRONT), b: fly(DECK_SHUT, SEAT_FRONT) },
    rep: flyRep('a', 'b', 500), muscles: ['chest', 'frontDelts'],
  };
  F.benchFly = {
    view: 'top', pin: { joint: 'hip', at: [0, 0] }, equip: DB2S, key: 'b', props: [{ type: 'bench', x: -30, w: 116, h: BENCH_H }],
    poses: {
      a: { sc: { uaN: 0.22, uaF: 0.22, faN: 0.22, faF: 0.22, shN: 0.18, shF: 0.18 }, aN: { s: 60, e: 0 }, lN: { h: 9, k: 0 } },
      b: { sc: { uaN: 1, uaF: 1, faN: 1, faF: 1, shN: 0.18, shF: 0.18 }, aN: { s: 90, e: 16 }, lN: { h: 9, k: 0 } },
    },
    rep: ec('a', 'b'), muscles: ['chest'],
  };

  // Legs.
  F.squatBB = {
    view: 'side', pin: { joint: 'traps' }, key: 'b', props: [{ type: 'rack', x: 44, h: 134 }],
    equip: BB(22.5, { hold: 'traps' }),
    poses: {
      a: { at: [1.5, -140.5], t: 10, n: -6, sc: ARMS(0.8, 0.42), lN: { flat: true }, ik: { anN: [0, -8], hdN: 'traps' } },
      b: { at: [3, -95], t: 42, n: -18, sc: ARMS(0.8, 0.42), lN: { flat: true }, ik: { anN: [0, -8], hdN: 'traps' } },
    },
    bend: { hdN: 1, hdF: 1 }, // elbows down and back under the bar
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'],
  };
  F.squatSmith = {
    view: 'side', pin: { joint: 'traps' }, key: 'b', props: [{ type: 'smith', x: 0, h: 132 }],
    equip: BB(20, { hold: 'traps' }),
    poses: {
      a: { at: [0, -140], t: 4, n: -2, sc: ARMS(0.8, 0.42), lN: { flat: true }, ik: { anN: [12, -8], hdN: 'traps' } },
      b: { at: [0, -96], t: 25, n: -10, sc: ARMS(0.8, 0.42), lN: { flat: true }, ik: { anN: [12, -8], hdN: 'traps' } },
    },
    bend: { hdN: 1, hdF: 1 },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'],
  };
  // 45° leg press: reclined seat, feet flat on the sled (foot square to the track).
  const LP_FOOT = { fd: 225, flat: false };
  F.legPress = {
    view: 'side', pin: { joint: 'hip', at: [0, -44] }, key: 'b',
    props: [{ type: 'machine', kind: 'legPress', x: -4.9, h: 33.6, back: 25, len: 80, seat: 30, track: [46.65, -119.13], angle: 45 }],
    poses: {
      a: { t: -65, n: 14, aN: { s: 20, e: 60 }, lN: LP_FOOT, ik: { anN: [47, -111] } },
      b: { t: -65, n: 14, aN: { s: 20, e: 60 }, lN: LP_FOOT, ik: { anN: [31.44, -95.44] } },
    },
    rep: ec('a', 'b'), muscles: ['quads', 'glutes'],
  };
  // Dumbbell lunge and split squat: the home forms with a dumbbell in each hand.
  F.lungeDB = merge(F.lunge, { equip: DB2S });
  F.splitDB = merge(F.split, { equip: DB2S });
  // Hinges: hips pinned, feet planted, hands on the bar (IK), bar over the mid-foot.
  const HINGE_FEET = { lN: { flat: true }, ik: { anN: [0, -8] } };
  const hinge = (at, t, n, hand) => merge(HINGE_FEET, { at, t, n, ik: { hdN: hand } });
  F.rdlBB = {
    view: 'side', pin: { joint: 'hip' }, key: 'b', equip: BB(22.5),
    poses: { a: hinge([1.5, -92.5], 4, 0, [10, -86]), b: hinge([-30, -85], 64, -18, [6, -50]) },
    rep: ec('a', 'b'), muscles: ['hamstrings', 'glutes', 'lowerBack'],
  };
  F.rdlDB = merge(F.rdlBB, { equip: DB2S });
  F.deadliftBB = {
    view: 'side', pin: { joint: 'hip' }, key: 'a', equip: BB(22.5),
    poses: { a: hinge([-34.1, -63.1], 70.3, -24, [9, -22.5]), b: hinge([1.5, -92.5], 0, 0, [10, -86]) },
    rep: ce('a', 'b', { con: 1100, ecc: 1600, holdA: 500 }), muscles: ['glutes', 'hamstrings', 'quads', 'lowerBack'],
  };
  F.rowBB = {
    view: 'side', pin: { joint: 'hip' }, key: 'b', equip: BB(22.5),
    poses: { a: hinge([-24, -88], 50, -16, [12, -63]), b: hinge([-24, -88], 50, -16, [1.5, -92.5]) },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'],
  };
  // Hip thrust: the upper back pivots on the bench's edge (neck placed so the back is tangent to it).
  F.thrustBB = {
    view: 'side', pin: { joint: 'neck' }, key: 'b', props: [{ type: 'bench', x: -70, w: 30, h: BENCH_H, end: true }],
    equip: BB(22.5, { hold: 'lap' }),
    poses: {
      a: { at: [-40.6, -60.1], t: -42, n: 20, lN: { flat: true }, ik: { anN: [50, -8], hdN: 'lap' } },
      b: { at: [-56.5, -56.5], t: -90, n: 34, lN: { flat: true }, ik: { anN: [50, -8], hdN: 'lap' } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['glutes', 'hamstrings'],
  };
  // Seated leg curl and leg extension: lever pivot at the knee, pad at the lower shin.
  F.legCurl = {
    view: 'side', pin: { joint: 'hip', at: [0, -59] }, key: 'b',
    props: [{ type: 'machine', kind: 'legCurl', x: -11.3, h: 50, back: 80, seat: 44, pivot: [43, -59] }],
    poses: {
      a: { t: -10, aN: { s: 10, e: 70 }, lN: { h: 80, k: 4, flat: false, a: 10 } },
      b: { t: -10, aN: { s: 10, e: 70 }, lN: { h: 80, k: 100, flat: false, a: 10 } },
    },
    rep: ce('a', 'b'), muscles: ['hamstrings'],
  };
  F.legExt = {
    view: 'side', pin: { joint: 'hip', at: [0, -59] }, key: 'b',
    props: [{ type: 'machine', kind: 'legExt', x: -11.3, h: 50, back: 80, seat: 44, pivot: [43, -59] }],
    poses: {
      a: { t: -10, aN: { s: 12, e: 70 }, lN: { h: 80, k: 95, flat: false, a: 10 } },
      b: { t: -10, aN: { s: 12, e: 70 }, lN: { h: 80, k: 4, flat: false, a: 10 } },
    },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['quads'],
  };
  // Lying dumbbell leg curl: face down on a flat bench, knees just off its end, a dumbbell held
  // between the feet; hands hold the far end of the bench.
  F.legCurlDB = {
    view: 'side', pin: { joint: 'hip', at: [0, -55] }, key: 'b', props: [{ type: 'bench', x: -38, w: 118, h: BENCH_H }],
    equip: [{ type: 'db', hold: 'feet' }],
    poses: {
      a: { t: 90, n: 4, lN: { h: 0, k: 0, flat: false, a: 0 }, ik: { hdN: [58, -22] } },
      b: { t: 90, n: 4, lN: { h: 0, k: 105, flat: false, a: 0 }, ik: { hdN: [58, -22] } },
    },
    rep: ce('a', 'b', { holdB: 300 }), muscles: ['hamstrings'],
  };
  // Calf raises: balls of the feet on a step, the body rises as the heels lift.
  const STEP = { type: 'box', x: 10, w: 30, h: 10 };
  const ON_STEP = { joint: 'toN', at: [18, -13.5] };
  const calf = (fd) => ({ t: 0, lN: { h: 0, k: 0, fd }, aN: { s: 4, e: 6 } });
  F.calfDB = {
    view: 'side', pin: ON_STEP, key: 'b', props: [STEP], equip: DB2S,
    poses: { a: calf(112), b: calf(58) },
    rep: ce('a', 'b', { con: 900, holdB: 700, ecc: 1600 }), muscles: ['calves'],
  };
  F.calfSmith = {
    view: 'side', pin: ON_STEP, key: 'b', props: [STEP, { type: 'smith', x: -8.7, h: 128 }],
    equip: BB(20, { hold: 'traps' }),
    poses: {
      a: merge(calf(112), { sc: ARMS(0.8, 0.42), ik: { hdN: 'traps' } }),
      b: merge(calf(58), { sc: ARMS(0.8, 0.42), ik: { hdN: 'traps' } }),
    },
    bend: { hdN: 1, hdF: 1 },
    rep: ce('a', 'b', { con: 900, holdB: 700, ecc: 1600 }), muscles: ['calves'],
  };

  // Leg press calf raise: legs straight, the balls of the feet on the plate's bottom edge; the
  // ankles push the plate up the track (the prop's `calf` keeps it square to the track).
  F.calfPress = {
    view: 'side', pin: { joint: 'hip', at: [0, -44] }, key: 'b',
    props: [{ type: 'machine', kind: 'legPress', x: -4.9, h: 33.6, back: 25, len: 80, seat: 30, track: [28.7, -134.1], angle: 45, calf: true }],
    poses: {
      a: { t: -65, n: 14, aN: { s: 20, e: 60 }, lN: { flat: false, fd: 246 }, ik: { anN: [48.5, -112.6] } },
      b: { t: -65, n: 14, aN: { s: 20, e: 60 }, lN: { flat: false, fd: 200 }, ik: { anN: [48.5, -112.6] } },
    },
    rep: ce('a', 'b', { con: 900, holdB: 600, ecc: 1500 }), muscles: ['calves'],
  };

  // Back.
  F.pulldown = {
    view: 'side', pin: { joint: 'hip', at: [0, -59] }, key: 'b', equip: [{ type: 'latbar', hands: 'both' }],
    props: [{ type: 'machine', kind: 'pulldown', x: 22, h: 50, seat: 40, pad: [30, -75.5], pulley: [3, -200], col: 74 }],
    poses: {
      a: { t: -8, n: 4, lN: { flat: true }, sc: ARMS(0.84, 0.9), ik: { anN: [46, -8], hdN: [2, -155] } },
      b: { t: -16, n: -4, lN: { flat: true }, sc: ARMS(0.8, 0.9), ik: { anN: [46, -8], hdN: [3, -107] } },
    },
    rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'biceps'],
  };
  F.rowCable = {
    view: 'side', pin: { joint: 'hip', at: [0, -51] }, key: 'b', equip: [{ type: 'handle', hands: 'both', shared: true }],
    props: [{ type: 'machine', kind: 'rowSeat', x: 15, h: 42, w: 60, foot: [81.9, -30.6], angle: 70 }, { type: 'cable', x: 104, y: -34, to: 'both' }],
    poses: {
      a: { t: 18, n: -6, lN: { fd: 160, flat: false }, sc: ARMS(0.95, 1), ik: { anN: [77, -26], hdN: [50, -79] } },
      b: { t: -6, n: 0, lN: { fd: 160, flat: false }, sc: ARMS(0.95, 1), ik: { anN: [77, -26], hdN: [21, -75] } }, // handle to the belly, not into it
    },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'],
  };
  // Chest-supported row: chest on an incline bench at 40° (the backrest rises toward +x).
  const CHEST_PAD = { type: 'bench', x: -43.9, w: 116, h: BENCH_H, incline: 40, back: 1, seat: 36 };
  F.chestRow = {
    view: 'side', pin: { joint: 'hip', at: [0, -66.7] }, key: 'b', equip: DB2S, props: [CHEST_PAD],
    bend: { hdN: [-1, -1], hdF: [-1, -1] }, // elbows drive up and back past the ribs
    poses: {
      a: { t: 50, n: -10, lN: { flat: true }, ik: { anN: [-40, -8], hdN: [38, -41.5] } },
      b: { t: 50, n: -10, lN: { flat: true }, sc: ARMS(0.95, 1), ik: { anN: [-40, -8], hdN: [22, -79] } },
    },
    rep: ce('a', 'b', { holdB: 400 }), muscles: ['lats', 'upperBack', 'rearDelts', 'biceps'],
  };
  F.facePull = {
    view: 'side', pin: { joint: 'hip', at: [0, -92.5] }, key: 'b', equip: [{ type: 'rope', hands: 'both' }],
    props: [{ type: 'cable', x: 82, y: -170, to: 'both' }],
    poses: {
      a: { t: -6, lN: { flat: true }, sc: ARMS(0.95, 0.95), ik: { anN: [0, -8], hdN: [46, -159] } },
      b: { t: -8, lN: { flat: true }, sc: ARMS(0.35, 0.78), ik: { anN: [0, -8], hdN: [-5, -161] } },
    },
    rep: ce('a', 'b', { holdB: 600 }), muscles: ['rearDelts', 'upperBack'],
  };
  // The home version: a band anchored high on a door.
  F.bandFacePull = merge(F.facePull, { equip: [{ type: 'band', hands: 'both', from: [82, -170] }], props: [{ type: 'door', x: 82 }] });
  // Reverse fly on the pec deck, seen from behind: facing the pad, so no backrest shows.
  F.revFlyMachine = {
    view: 'front', pin: { joint: 'hip', at: [0, -57] }, key: 'b', armLayer: 'front', legLayer: 'front', props: [merge(PEC_DECK, { rear: true })],
    poses: { a: fly(DECK_SHUT, SEAT_FRONT), m: fly(DECK_MID, SEAT_FRONT), b: fly(DECK_OPEN, SEAT_FRONT) },
    rep: flyRep('a', 'b', 500), muscles: ['rearDelts', 'upperBack'],
  };

  // Shoulders.
  const UPRIGHT = { type: 'bench', x: -90.75, w: 116, h: BENCH_H, incline: 85, back: -1, seat: 36 };
  F.seatedPressDB = {
    view: 'side', pin: ON_INCLINE, key: 'b', equip: DB2, props: [UPRIGHT],
    poses: {
      a: { t: -5, lN: { flat: true }, sc: { uaN: 0.69, uaF: 0.69 }, ik: { anN: [46, -8], hdN: [0, -113] } },
      b: { t: -5, lN: { flat: true }, sc: { uaN: 1, uaF: 1 }, ik: { anN: [46, -8], hdN: [-2, -160] } },
    },
    rep: ce('a', 'b'), muscles: ['frontDelts', 'sideDelts', 'triceps'],
  };
  F.ohpBB = {
    view: 'side', pin: FLOOR_ANKLE, key: 'b', equip: BB(17), props: [{ type: 'rack', x: 42, h: 133 }],
    poses: {
      a: st({ t: -2, n: -8, sc: { uaN: 0.9, uaF: 0.9 }, ik: { hdN: [13, -139] } }),
      b: st({ t: 0, n: 2, sc: { uaN: 1, uaF: 1 }, ik: { hdN: [3, -199.5] } }),
    },
    rep: ce('a', 'b'), muscles: ['frontDelts', 'sideDelts', 'triceps'],
  };
  // The handles swing on levers from a pivot on the column, so the hands travel an arc (m).
  F.machineShoulder = {
    view: 'side', pin: { joint: 'hip', at: [0, -55] }, key: 'b',
    props: [{ type: 'machine', kind: 'shoulderPress', x: -10.6, h: 46, back: 84, seat: 38, pivot: [-46, -135] }],
    poses: {
      a: { t: -6, lN: { flat: true }, sc: { uaN: 0.7, uaF: 0.7 }, ik: { anN: [46, -8], hdN: [2, -112] } },
      m: { t: -6, lN: { flat: true }, sc: { uaN: 0.85, uaF: 0.85 }, ik: { anN: [46, -8], hdN: [5.5, -135] } },
      b: { t: -6, lN: { flat: true }, sc: { uaN: 1, uaF: 1 }, ik: { anN: [46, -8], hdN: [-1, -158] } },
    },
    rep: [{ to: 'm', ms: 500, hold: 0, ph: 'con' }, { to: 'b', ms: 500, hold: 250, ph: 'con' }, { to: 'm', ms: 1000, hold: 0, ph: 'ecc' }, { to: 'a', ms: 1000, hold: 300, ph: 'ecc' }],
    muscles: ['frontDelts', 'sideDelts', 'triceps'],
  };
  // Working arm by angles so it sweeps out in an arc; the other hand holds the tower.
  F.cableRaise = {
    view: 'front', pin: FRONT_CENTER, key: 'b', armLayer: 'front', equip: [{ type: 'handle', hands: 'N' }],
    props: [{ type: 'cable', x: -64, y: -16, to: 'hdN', layer: 'front' }],
    poses: {
      a: { lN: { h: 5 }, aN: { s: -16, e: 8 }, depth: { elN: 9, wrN: 16 }, ik: { hdF: [-56, -116] } }, // in front of the body, across to the other hip
      b: { lN: { h: 5 }, aN: { s: 86, e: 12 }, depth: { elN: 3, wrN: 6 }, ik: { hdF: [-56, -116] } },
    },
    rep: ce('a', 'b'), muscles: ['sideDelts'], uni: true, leadLimbs: ['aN'],
  };

  // Arms.
  F.curlBar = merge(F.curl, { equip: EZ(12), equipBy: { bb: BB(14) }, poses: { a: { aN: { s: 8, e: 10 } }, b: { aN: { s: 16, e: 135 } } } });
  F.curlCable = merge(F.curl, {
    equip: EZ(0), props: [{ type: 'cable', x: 40, y: -14, to: 'both' }],
    poses: { a: { t: -2, aN: { s: 8, e: 10 } }, b: { t: -2, aN: { s: 16, e: 135 } } },
  });
  const INCLINE_50 = { type: 'bench', x: -87.46, w: 116, h: BENCH_H, incline: 50, back: -1, seat: 36 };
  F.inclineCurl = {
    view: 'side', pin: { joint: 'hip', at: [0, -54] }, key: 'b', equip: DB2, props: [INCLINE_50],
    poses: {
      a: { t: -40, n: -4, aN: { s: -40, e: 6 }, lN: { flat: true }, ik: { anN: [56, -8] } },
      b: { t: -40, n: -4, aN: { s: -36, e: 132 }, lN: { flat: true }, ik: { anN: [56, -8] } },
    },
    rep: ce('a', 'b'), muscles: ['biceps', 'forearms'],
  };
  F.pushdownCable = merge(F.pushdown, {
    equip: [{ type: 'rope', hands: 'both' }], props: [{ type: 'cable', x: 36, y: -196, to: 'both' }],
    poses: { a: { t: 8, aN: { s: 8, e: 100 }, lN: { h: 10, k: 12 } }, b: { t: 8, aN: { s: 6, e: 4 }, lN: { h: 10, k: 12 } } },
  });
  F.ohCable = {
    view: 'side', pin: { joint: 'hip', at: [2, -86] }, key: 'b', equip: [{ type: 'rope', hands: 'both' }],
    props: [{ type: 'cable', x: -52, y: -176, to: 'both' }],
    poses: {
      a: { t: 30, n: -6, aN: { s: 178, e: 125 }, lN: { flat: true }, lF: { flat: true }, ik: { anN: [30, -8], anF: [-30, -8] } },
      b: { t: 30, n: -6, aN: { s: 170, e: 8 }, lN: { flat: true }, lF: { flat: true }, ik: { anN: [30, -8], anF: [-30, -8] } },
    },
    rep: ce('a', 'b'), muscles: ['triceps'],
  };
  F.skullEZ = {
    view: 'side', pin: ON_BENCH, equip: EZ(12), equipBy: { bb: BB(14) }, key: 'b', props: [FLAT_BENCH],
    poses: { a: merge(BENCH_FEET, { aN: { s: 96, e: 4 } }), b: merge(BENCH_FEET, { aN: { s: 102, e: 104 } }) },
    rep: ec('a', 'b'), muscles: ['triceps'],
  };
  F.dipBars = {
    view: 'side', pin: { joint: 'grip', at: [0, -115] }, key: 'b', props: [{ type: 'dip', x: 0, h: 115 }],
    poses: {
      a: { t: 12, aN: { s: 12, e: 4 }, lN: { h: -4, k: 80, flat: false, a: 20 } },
      b: { t: 24, n: -4, aN: { s: -52, e: 76 }, lN: { h: -2, k: 84, flat: false, a: 20 } },
    },
    rep: ec('a', 'b'), muscles: ['triceps', 'chest', 'frontDelts'],
  };

  // Abs.
  F.cableCrunch = {
    view: 'side', pin: { joint: 'knN', at: [0, -6] }, key: 'b', equip: [{ type: 'rope', hands: 'both' }],
    props: [{ type: 'cable', x: 64, y: -196, to: 'both' }],
    poses: {
      a: { t: 28, n: 6, aN: { s: 45, e: 150 }, lN: { h: 28, k: 90, flat: false, a: 90 } },
      b: { t: 72, ts: 0.9, n: 24, aN: { s: 45, e: 150 }, lN: { h: 62, k: 90, flat: false, a: 90 } },
    },
    rep: ce('a', 'b', { holdB: 500 }), muscles: ['abs'],
  };
  F.hangKnee = {
    view: 'side', pin: { joint: 'hdN', at: [0, -224] }, key: 'b', props: [BAR],
    poses: {
      a: { t: 0, aN: { s: 178, e: 2 }, lN: { h: 6, k: 14, flat: false, a: 30 } },
      b: { t: -10, n: -6, aN: { s: 170, e: 4 }, lN: { h: 112, k: 108, flat: false, a: 30 } },
    },
    rep: ce('a', 'b', { con: 1000, ecc: 1800, holdB: 300 }), muscles: ['abs', 'hipFlexors'],
  };
  F.pallof = {
    view: 'front', pin: FRONT_CENTER, key: 'b', armLayer: 'front', equip: [{ type: 'handle', hands: 'both', shared: true }],
    props: [{ type: 'cable', x: -86, y: -118, to: 'both' }],
    propsBy: { band: [{ type: 'door', x: -92 }] },
    equipBy: { band: [{ type: 'band', hands: 'both', from: [-86, -118] }] },
    poses: {
      a: { lN: { h: 5 }, sc: { uaN: 0.85, uaF: 0.85, faN: 0.5, faF: 0.5 }, ik: { hdN: [3, -118], hdF: [-3, -118] } },
      b: { lN: { h: 5 }, sc: ARMS(0.46, 0.46), ik: { hdN: [3, -122], hdF: [-3, -122] } },
    },
    bend: { hdN: 1, hdF: 1 }, // elbows down by the ribs
    rep: ce('a', 'b', { holdB: 1500 }), muscles: ['obliques', 'abs'], uni: true, leadLimbs: [],
  };

  // Cardio machines (timed intervals).
  F.rower = {
    view: 'side', pin: { joint: 'hip' }, key: 'c', props: [{ type: 'rower', x: 62, h: 36, fy: -26 }],
    poses: {
      c: { at: [14, -45], t: 30, n: -6, lN: { fd: 135, flat: false }, ik: { anN: [55.6, -24], hdN: [84, -54] } },
      d: { at: [-18, -45], t: 26, n: -6, lN: { fd: 135, flat: false }, ik: { anN: [55.6, -24], hdN: [49.4, -55] } },
      f: { at: [-25, -45], t: -24, n: 4, lN: { fd: 135, flat: false }, ik: { anN: [55.6, -24], hdN: [-25, -78] } },
      r: { at: [-25, -45], t: 22, n: -4, lN: { fd: 135, flat: false }, ik: { anN: [55.6, -24], hdN: [39.7, -56.4] } },
    },
    rep: [{ to: 'd', ms: 380, hold: 0, ph: 'con' }, { to: 'f', ms: 380, hold: 80, ph: 'con' }, { to: 'r', ms: 450, hold: 0, ph: 'move' }, { to: 'c', ms: 800, hold: 80, ph: 'move' }],
    muscles: ['quads', 'glutes', 'lats', 'upperBack'],
  };
  // Pedals: 8 crank positions; the ankle sits behind and above the pedal (ball of the foot on it).
  const BIKE = { type: 'bike', x: 0, y: -30, crank: 17, h: 88, sx: -22, bar: [42, -104] };
  const pedal = (deg) => [17 * Math.sin(deg * Math.PI / 180) - 9.4, -30 - 17 * Math.cos(deg * Math.PI / 180) - 2.2];
  const spin = (deg) => ({
    t: 42, n: -14, lN: { fd: 98, flat: false }, lF: { fd: 98, flat: false },
    ik: { hdN: [42, -104], anN: pedal(deg).map((v) => Math.round(v * 10) / 10), anF: pedal(deg + 180).map((v) => Math.round(v * 10) / 10) },
  });
  F.bike = {
    view: 'side', pin: { joint: 'hip', at: [-22, -97] }, key: 'p2', props: [BIKE],
    poses: { p0: spin(0), p1: spin(45), p2: spin(90), p3: spin(135), p4: spin(180), p5: spin(225), p6: spin(270), p7: spin(315) },
    rep: cyc(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p0'], 85, 0),
    muscles: ['quads', 'glutes', 'calves'],
  };
  // Incline walk: the stance foot rides the belt back, the other swings through (8° belt). The foot
  // line sits 5.5 above the belt (heel at strike, whole foot at mid-stance, toe at push-off).
  const TREAD = { type: 'treadmill', x: -72, w: 150, h: 20, incline: 8 };
  const walkUp = (nA, nFd, fA, fFd, arm) => ({
    t: 8, n: -4, aN: { s: arm, e: 24 }, aF: { s: -arm, e: 24 },
    lN: { fd: nFd, flat: false }, lF: { fd: fFd, flat: false }, ik: { anN: nA, anF: fA },
  });
  const STRIKE = [24, -39.8], MIDSTANCE = [0, -35.6], TOEOFF = [-25.9, -41.9], SWING = [1, -47];
  F.inclineWalk = {
    view: 'side', pin: { joint: 'hip', at: [0, -119] }, key: 'a', props: [TREAD],
    poses: {
      a: walkUp(STRIKE, 110, TOEOFF, 60, -24),
      b: walkUp(MIDSTANCE, 98, SWING, 92, 0),
      c: walkUp(TOEOFF, 60, STRIKE, 110, 24),
      d: walkUp(SWING, 92, MIDSTANCE, 98, 0),
    },
    rep: cyc(['b', 'c', 'd', 'a'], 440, 0), muscles: ['glutes', 'calves', 'hamstrings'],
  };

  /* ------------------------------------------------------------------ moves */
  const MOVES = Object.create(null);
  // Forms whose first two muscles both drive the move (legs in squats and hinges, the back in rows).
  const PRIME = {};
  for (const f of ['squatBW', 'goblet', 'split', 'lunge', 'bulgarian', 'pistol', 'jumpSquat', 'kbDeadlift', 'swing', 'swing1', 'staggerRdl', 'sldl',
    'row', 'row1', 'bandRow', 'towelRow', 'tableRow', 'pullApart', 'towelApart', 'ytw', 'revFly', 'wallAngel', 'pulse', 'stepUp', 'gobletLunge',
    'bandGM', 'bandFacePull', 'squatBB', 'squatSmith', 'legPress', 'rdlBB', 'rdlDB', 'deadliftBB', 'rowBB', 'rowCable', 'chestRow', 'facePull',
    'revFlyMachine', 'lungeDB', 'splitDB', 'seatedPressDB', 'ohpBB', 'machineShoulder', 'ohPress', 'bandPress', 'ohPress1']) PRIME[f] = 2;
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
    // How many of the muscles, from the front of the list, are primary movers (the rest help).
    if (meta.prime == null) m.prime = PRIME[form] || base.prime || 1;
    m.prime = Math.max(1, Math.min(m.muscles.length, m.prime));
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
  move('tri_band_oh', 'bandOhExt', { ...TRI, name: 'Band overhead extension', req: ['band'], load: 'band', range: [12, 30], start: 15,
    cues: ['Stand on the band, hands behind your head.', 'Elbows point up, close to your head.', 'Straighten your arms, then lower slowly.'] });
  move('tri_dip_bent', 'dipBent', { ...TRI, name: 'Chair dip, knees bent', req: ['chair'], load: null, range: [6, 20], start: 8, joints: ['shoulder', 'elbow', 'wrist'],
    cues: ['Hands on the edge, fingers forward.', 'Lower until elbows reach 90.', 'Keep your hips close to the chair.'], mistake: 'Dropping so low your shoulders roll forward.' });
  move('tri_oh_slow', 'ohExt', { ...TRI, name: 'Overhead extension, 3-sec lowering', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10,
    cues: [SLOW, 'Elbows point up, close to your head.', 'Ribs down, no arching.'] }, { ecc: 3000 });
  move('tri_dip', 'dipStraight', { ...TRI, name: 'Chair dip, legs straight', req: ['chair'], load: null, range: [6, 20], start: 8, joints: ['shoulder', 'elbow', 'wrist'],
    cues: ['Legs long, heels on the floor.', 'Lower until elbows reach 90.', 'Push back up through your palms.'], mistake: 'Dropping so low your shoulders roll forward.' });
  move('tri_diamond', 'diamond', { ...TRI, name: 'Diamond push-up', req: [], load: null, range: [4, 15], start: 6, muscles: ['triceps', 'chest'], joints: ['wrist', 'elbow', 'shoulder'],
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
  move('sq_stepup', 'stepUp', { ...SQ, ...UNI_LEG, name: 'Step-up', req: ['chair'], load: null, range: [8, 20], start: 10, uni: true,
    cues: ['One foot flat on a sturdy low chair or stair.', 'Drive through that heel and stand up tall.', 'Step down slowly, the same leg leads.'], mistake: 'Pushing off the floor with your back foot.' });
  move('sq_goblet_lunge', 'gobletLunge', { ...SQ, ...UNI_LEG, name: 'Goblet reverse lunge', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10, uni: true,
    cues: ['Hold the weight at your chest.', 'Step back and lower straight down.', 'Push through your front heel to come back up.'] });
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

  /* Legs: calves */
  const CALF = { group: 'legs', joints: ['ankle'], load: null, mistake: 'Bouncing at the bottom instead of lowering slowly.', breathe: 'Breathe out as you rise.' };
  move('calf_bw', 'calfBW', { ...CALF, name: 'Calf raise', req: [], range: [12, 30], start: 15,
    cues: ['Feet hip-width apart, stand tall.', 'Rise as high as you can onto the balls of your feet.', 'Lower your heels all the way down.'] });
  move('calf_wall_slow', 'calfWall', { ...CALF, name: 'Wall calf raise, 3-sec lowering', req: ['wall'], range: [10, 25], start: 12,
    cues: ['Fingertips on the wall for balance.', 'Rise high and hold for a second.', SLOW] }, { ecc: 3000 });
  move('calf_load', 'calfLoad', { ...CALF, name: 'Weighted calf raise', req: ['kb|db'], load: 'kb|db', range: [12, 30], start: 15,
    cues: ['Hold the weight with long arms.', 'Rise as high as you can.', 'Lower your heels all the way down.'] });
  move('calf_1leg', 'calf1', { ...CALF, name: 'One-leg calf raise', req: ['wall'], range: [8, 20], start: 10, uni: true,
    cues: ['Stand on one foot, fingertips on the wall.', 'Rise as high as you can.', 'Lower slowly all the way down.'], mistake: 'Pushing off the wall with your hands.' });

  /* Legs: hamstring curls */
  const HAM = { group: 'legs', joints: ['knee', 'hip'], load: null, mistake: 'Letting your hips sag as your legs straighten.', breathe: 'Breathe out as you curl your heels in.' };
  move('ham_walkout', 'hamWalk', { ...HAM, name: 'Bridge walkout', req: [], range: [4, 12], start: 6,
    cues: ['Lift into a glute bridge.', 'Walk your heels out in small steps, hips up.', 'Walk them back in, then lower.'], breathe: 'Keep breathing as you walk.' });
  move('ham_slide', 'hamSlide', { ...HAM, name: 'Towel slide leg curl', req: ['towel'], range: [6, 15], start: 8,
    cues: ['Heels on a towel on a smooth floor.', 'Hips up, slide your heels out slowly.', 'Curl them back in without dropping your hips.'] });
  move('ham_band_gm', 'bandGM', { ...HAM, name: 'Band good morning', req: ['band'], load: 'band', range: [10, 25], start: 12, joints: ['back', 'hip'],
    cues: ['Band under your feet and across your upper back.', 'Soft knees, push your hips back.', 'Flat back, then stand tall and squeeze your glutes.'], mistake: 'Rounding your back as you bend.', breathe: 'Breathe in as you bend, out as you stand.' });
  move('ham_slide1', 'hamSlide1', { ...HAM, name: 'One-leg slide curl', req: ['towel'], range: [5, 12], start: 6, uni: true,
    cues: ['One heel on the towel, the other leg up.', 'Hips up, slide out slowly.', 'Curl back in with your hips level.'] });
  move('ham_nordic', 'nordic', { ...HAM, name: 'Nordic curl negative', req: ['chair', 'towel'], range: [3, 8], start: 3, complex: true, joints: ['knee'],
    cues: ['Kneel on a folded towel, heels hooked under a couch.', 'Lower forward as slowly as you can, hips straight.', 'Catch yourself with your hands, push back up.'], mistake: 'Bending at the hips to make it easier.', breathe: 'Breathe steadily as you lower.' });

  /* Back: rows */
  const ROW = { group: 'back', joints: ['back', 'elbow'], mistake: 'Shrugging your shoulders up to your ears.', breathe: 'Breathe out as you pull.' };
  const ROW_CUES = ['Hinge forward, flat back.', 'Pull your elbows back to your hips.', 'Squeeze your shoulder blades together.'];
  move('row_prone_w', 'proneW', { ...ROW, name: 'Prone W raise', req: [], load: null, range: [8, 20], start: 10, joints: ['shoulder'],
    cues: ['Lie face down, elbows bent, hands by your head.', 'Squeeze your shoulder blades to lift your arms.', 'Hold two seconds, then lower.'], mistake: 'Lifting your chest instead of your arms.' });
  move('row_superman', 'supermanPull', { ...ROW, name: 'Superman lat pull', req: [], load: null, range: [8, 20], start: 10, joints: ['back', 'shoulder'],
    cues: ['Lie face down, lift your chest and arms.', 'Pull your elbows down to your ribs.', 'Reach back out without touching down.'], mistake: 'Cranking your neck up to look ahead.' });
  move('row_door', 'doorRow', { ...ROW, name: 'Doorframe row', req: [], load: null, range: [8, 20], start: 10, joints: ['elbow', 'shoulder'],
    cues: ['Grip the doorframe at chest height, toes close to it.', 'Lean back on straight arms, body in one line.', 'Pull your chest to the frame.'], mistake: 'Bending at the hips instead of pulling.' });
  move('row_band_high', 'bandHighRow', { ...ROW, name: 'Band high row', req: ['band', 'door'], load: 'band', range: [12, 30], start: 15, joints: ['elbow', 'shoulder'],
    cues: ['Band anchored at the top of a closed door.', 'Pull your hands to your chest, elbows out and down.', 'Squeeze your shoulder blades.'] });
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
  move('rear_face_band', 'bandFacePull', { ...REAR, name: 'Band face pull', req: ['band', 'door'], load: 'band', range: [12, 30], start: 15,
    cues: ['Band anchored high on a closed door.', 'Pull to your forehead, hands apart, elbows high.', 'Pause, then let your arms reach forward.'] });
  move('rear_high_pull', 'kbHighPull', { ...REAR, name: 'Kettlebell high pull', req: ['kb|db'], load: 'kb|db', range: [8, 20], start: 10, complex: true, joints: ['shoulder', 'back', 'hip'],
    cues: ['Hike the bell back like a swing.', 'Snap your hips and pull it to your chest.', 'Elbows high and wide, then let it swing back.'], mistake: 'Lifting with your arms instead of your hips.', breathe: 'Sharp breath out as your hips snap forward.' });
  move('rear_fly', 'revFly', { ...REAR, name: 'Reverse fly', req: ['db'], load: 'db', range: [10, 30], start: 14, cues: ['Hinge forward, flat back.', 'Open your arms out to the sides.', 'Lead with your elbows.'] });
  move('rear_fly_slow', 'revFly', { ...REAR, name: 'Reverse fly, 3-sec lowering', req: ['db'], load: 'db', range: [8, 25], start: 12, cues: [SLOW, 'Open your arms out to the sides.', 'Lead with your elbows.'] }, { ecc: 3000 });
  move('rear_fly_pause', 'revFly', { ...REAR, name: 'Paused reverse fly', req: ['db'], load: 'db', range: [8, 20], start: 10, cues: ['Hinge forward, flat back.', PAUSE_TOP, 'Lower with control.'] }, { pause: ['con', 1000] });

  /* Back: lower back */
  const BACK = { group: 'back', joints: ['back'], load: null, req: [], mistake: 'Cranking your head up to look ahead.', breathe: 'Breathe out as you lift.' };
  move('back_birddog', 'birdDog', { ...BACK, name: 'Bird dog', range: [6, 15], start: 8, uni: true,
    cues: ['Hands under shoulders, knees under hips.', 'Reach one arm forward and the other leg back.', 'Hips level, hold a second, then return.'], mistake: 'Twisting your hips as the leg lifts.', breathe: 'Breathe out as you reach.' });
  move('back_superman', 'superman', { ...BACK, name: 'Superman hold', timed: true, range: [15, 40], start: 20,
    cues: ['Lie face down, arms long overhead.', 'Lift your arms, chest and legs together.', 'Eyes on the floor, neck long.'], breathe: 'Slow breaths, keep holding.' });
  move('back_ext', 'backExt', { ...BACK, name: 'Floor back extension', range: [8, 20], start: 10,
    cues: ['Lie face down, fingertips at your temples.', 'Lift your chest, legs stay down.', 'Lower slowly.'] });
  move('back_ext_pause', 'backExt', { ...BACK, name: 'Paused back extension', range: [6, 15], start: 8,
    cues: ['Fingertips at your temples, elbows wide.', 'Lift your chest and hold for two seconds.', 'Lower slowly.'] }, { pause: ['con', 2000] });

  /* Shoulders: overhead press */
  const OHP = { group: 'shoulders', joints: ['shoulder', 'elbow'], mistake: 'Arching your lower back to get the weight up.', breathe: 'Breathe out as you press up.' };
  const PIKE = { ...OHP, joints: ['shoulder', 'wrist', 'elbow'], load: null, mistake: 'Letting your hips drop into a push-up.', breathe: 'Breathe in on the way down, out as you push up.' };
  move('press_pike_incline', 'pikeIncline', { ...PIKE, name: 'Pike push-up, hands on couch', req: ['chair'], range: [6, 15], start: 8,
    cues: ['Hands on the couch edge, hips high.', 'Lower your head toward the edge.', 'Push back up until your arms are straight.'] });
  move('press_band', 'bandPress', { ...OHP, name: 'Band overhead press', req: ['band'], load: 'band', range: [10, 25], start: 12,
    cues: ['Stand on the band, hands at your shoulders.', 'Press straight up until your arms are long.', 'Lower back to your shoulders slowly.'] });
  move('press_db', 'ohPress', { ...OHP, name: 'Dumbbell overhead press', req: ['db'], load: 'db', range: [8, 20], start: 10,
    cues: ['Weights at your shoulders, palms forward.', 'Press straight up, arms by your ears.', 'Ribs down, glutes tight.'] });
  move('press_pike', 'pike', { ...PIKE, name: 'Pike push-up', req: [], range: [4, 15], start: 6,
    cues: ['Hips high, body in an upside-down V.', 'Lower the top of your head toward the floor.', 'Elbows angle back, not out.'] });
  move('press_db_slow', 'ohPress', { ...OHP, name: 'Overhead press, 3-sec lowering', req: ['db'], load: 'db', range: [6, 16], start: 8,
    cues: [SLOW, 'Press straight up, arms by your ears.', 'Ribs down, glutes tight.'] }, { ecc: 3000 });
  move('press_1arm', 'ohPress1', { ...OHP, name: 'Single-arm overhead press', req: ['kb|db'], load: 'kb|db', range: [6, 16], start: 8, uni: true,
    cues: ['Weight at your shoulder, forearm straight up.', 'Press up without leaning away.', 'Squeeze your glutes and stay tall.'], mistake: 'Leaning to one side to get the weight up.' });
  move('press_pike_decline', 'pikeDecline', { ...PIKE, name: 'Pike push-up, feet on couch', req: ['chair'], range: [3, 12], start: 4, complex: true,
    cues: ['Toes on the couch, hips over your shoulders.', 'Lower your head to the floor just in front of your hands.', 'Press the floor away.'] });

  /* Shoulders: raises */
  const RAISE = { group: 'shoulders', joints: ['shoulder'], load: 'db', mistake: 'Shrugging the weights up.', breathe: 'Breathe out as you raise.' };
  const RAISE_CUES = ['Slight bend in the elbows.', 'Raise out to the sides to shoulder height.', 'Lower slowly.'];
  move('raise_wall_iso', 'wallRaiseIso', { ...RAISE, name: 'Wall lateral raise hold', req: ['wall'], load: null, timed: true, range: [15, 45], start: 20, uni: true,
    cues: ['Stand side-on, a hand\'s width from the wall.', 'Press the back of your wrist out into the wall.', 'Shoulder down, don\'t lean away.'], mistake: 'Shrugging your shoulder up to your ear.', breathe: 'Slow, steady breaths. Keep pushing.' });
  move('raise_prone_y', 'proneY', { ...RAISE, name: 'Prone Y raise', req: [], load: null, range: [8, 20], start: 10,
    cues: ['Lie face down, arms overhead in a Y.', 'Thumbs up, lift your arms off the floor.', 'Hold a second, then lower slowly.'], mistake: 'Lifting your head and chest instead of your arms.', breathe: 'Breathe out as you lift.' });
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
  move('fin_step_jacks', 'stepJack', { ...COND, name: 'Step jacks', joints: ['hip'], cues: ['Step one foot out as your arms go up.', 'Step back in, then the other side.', 'Quick, light steps.'] });
  move('fin_squat_thrust', 'squatThrust', { ...COND, name: 'Squat thrusts', joints: ['wrist', 'knee', 'shoulder'], cues: ['Squat down and put your hands on the floor.', 'Step back to a plank, one foot at a time.', 'Step in and stand tall.'] });
  move('fin_burpee', 'burpee', { ...COND, name: 'Burpees', impact: true, joints: ['wrist', 'knee', 'shoulder'], complex: true, cues: ['Hands down, jump back.', 'Jump in, then jump up.', 'Land soft.'] });

  /* Warm-up, mobility, walk */
  const MOB = { group: 'mobility', joints: [], load: null, req: [], timed: true, range: [30, 60], start: 45, mistake: 'Forcing the range.', breathe: 'Slow breaths through your nose.' };
  move('wu_halo', 'halo', { ...MOB, name: 'Kettlebell halo', req: ['kb'], load: 'kb', range: [30, 40], start: 30, joints: ['shoulder'], mobFor: ['sideDelts', 'upperBack', 'frontDelts'], cues: ['Hold the bell upside down by the horns.', 'Circle it close around your head.', 'Switch direction halfway.'] });
  move('wu_circles', 'armCircles', { ...MOB, name: 'Arm circles', range: [30, 40], start: 30, mobFor: ['sideDelts', 'frontDelts', 'chest'], cues: ['Arms out to the sides.', 'Small circles, growing bigger.', 'Switch direction halfway.'] });
  move('wu_squat', 'squatBW', { ...MOB, name: 'Bodyweight squats', timed: false, range: [10, 10], start: 10, mobFor: ['quads', 'glutes'], cues: SQ_CUES });
  move('wu_angels', 'wallAngel', { ...MOB, name: 'Wall angels', req: ['wall'], range: [30, 40], start: 30, mobFor: ['upperBack', 'rearDelts', 'chest'], cues: ['Back and head against the wall.', 'Slide your arms up and down.', 'Keep your wrists touching the wall.'] });
  move('wu_legswing', 'legSwing', { ...MOB, name: 'Leg swings', range: [30, 40], start: 30, uni: true, joints: ['hip'], mobFor: ['hamstrings', 'hipFlexors', 'glutes'],
    cues: ['Hold a wall or chair for balance.', 'Swing one leg forward and back, easy.', 'Let the swings grow bigger.'], mistake: 'Leaning back to kick higher.' });
  move('wu_scap', 'scapPush', { ...MOB, name: 'Scap push-ups', timed: false, range: [10, 10], start: 10, joints: ['wrist', 'shoulder'], mobFor: ['chest', 'upperBack', 'triceps'],
    cues: ['Plank on straight arms.', 'Let your chest sink between your shoulder blades.', 'Push the floor away to round your upper back.'], mistake: 'Bending your elbows.' });
  move('wu_pullapart', 'pullApart', { ...MOB, name: 'Band pull-aparts', req: ['band'], load: 'band', range: [30, 40], start: 30, joints: ['shoulder'], mobFor: ['rearDelts', 'upperBack'],
    cues: ['Arms straight at shoulder height.', 'Pull the band to your chest.', 'Easy pace, shoulders down.'] });
  move('mob_catcow', 'catCow', { ...MOB, name: 'Cat-cow', range: [45, 60], start: 60, joints: ['wrist'], mobFor: ['lowerBack', 'upperBack', 'abs'], cues: ['Hands under shoulders, knees under hips.', 'Round up, then let your belly drop.', 'Move with your breath.'] });
  move('mob_wgs', 'wgs', { ...MOB, name: 'World\'s greatest stretch', range: [30, 30], start: 30, uni: true, mobFor: ['hipFlexors', 'hamstrings', 'glutes', 'upperBack'], cues: ['Lunge with your back knee down.', 'Elbow to your front instep.', 'Rotate and reach to the ceiling.'] });
  move('mob_hipflexor', 'hipFlexor', { ...MOB, name: 'Hip flexor stretch', range: [30, 30], start: 30, uni: true, mobFor: ['hipFlexors', 'quads'], cues: ['Back knee down on a towel.', 'Tuck your hips and shift forward.', 'Reach the same-side arm up.'] });
  move('mob_squat', 'deepSquat', { ...MOB, name: 'Deep squat hold', range: [30, 45], start: 45, mobFor: ['glutes', 'quads', 'calves'], cues: ['Sit as low as you comfortably can.', 'Elbows push your knees out.', 'Heels down if you can.'] });
  move('mob_child', 'childPose', { ...MOB, name: 'Child\'s pose', range: [30, 45], start: 45, mobFor: ['lowerBack', 'lats', 'upperBack'], cues: ['Knees wide, sit back on your heels.', 'Reach your arms long.', 'Let your forehead rest.'] });
  move('mob_openbook', 'openBook', { ...MOB, name: 'Open book', range: [30, 45], start: 30, uni: true, mobFor: ['upperBack', 'chest', 'obliques'],
    cues: ['Lie on your side, knees bent, arms out in front.', 'Sweep your top arm over and open your chest.', 'Follow your hand with your eyes, then come back.'] });
  move('mob_9090', 'hips9090', { ...MOB, name: '90/90 switches', range: [30, 45], start: 30, joints: ['hip'], mobFor: ['glutes', 'hipFlexors'],
    cues: ['Sit tall, hands behind you, feet wide.', 'Drop both knees to one side.', 'Lift them up and over to the other side.'], mistake: 'Slumping back onto your hands.' });
  move('mob_hamfloss', 'hamFloss', { ...MOB, name: 'Hamstring floss', range: [30, 45], start: 30, uni: true, mobFor: ['hamstrings', 'calves'],
    cues: ['Lie on your back, hold behind one thigh.', 'Straighten the knee, toes toward you.', 'Bend it again, slow and easy.'] });
  move('mob_calf', 'wallCalf', { ...MOB, name: 'Wall calf stretch', req: ['wall'], range: [30, 45], start: 30, uni: true, joints: ['ankle'], mobFor: ['calves'],
    cues: ['Hands on the wall, one foot stepped back.', 'Back heel down, back knee straight.', 'Lean in until you feel your calf.'] });
  move('mob_chest', 'chestOpen', { ...MOB, name: 'Chest opener', range: [30, 45], start: 30, joints: ['shoulder'], mobFor: ['chest', 'frontDelts', 'biceps'],
    cues: ['Clasp your hands behind your back.', 'Squeeze your shoulder blades and lift your hands.', 'Chest up, chin level.'], mistake: 'Leaning forward instead of lifting your hands.' });
  move('mob_ankle', 'ankleRock', { ...MOB, name: 'Ankle rocks', range: [30, 45], start: 30, uni: true, joints: ['ankle'], mobFor: ['calves', 'quads'],
    cues: ['Half kneel, front foot flat.', 'Rock your knee forward over your toes.', 'Heel stays down, then rock back.'] });
  move('walk', 'walk', { ...MOB, name: 'Walk', range: [600, 900], start: 720, cues: ['Easy pace, you can talk.', 'Swing your arms.', '10 to 15 minutes.'], mistake: 'Skipping it because it feels too easy.' });

  /* Gym. Every gym move has `gym: true`. Loaded ones carry `ratio`: a conservative novice starting
     load as a fraction of body weight, for the whole bar or machine stack, per dumbbell for
     dumbbell moves and per stack for two-handle cable moves. It only pre-fills the weight picker. */
  const GYM = { gym: true };
  const G_PRESS = { ...GYM, group: 'chest', joints: ['shoulder', 'elbow', 'wrist'], range: [6, 12], start: 8, mistake: 'Bouncing the weight off your chest.', breathe: 'Breathe in on the way down, out as you press.' };
  move('bench_bb', 'benchBB', { ...G_PRESS, name: 'Barbell bench press', req: ['bb', 'bench', 'rack'], load: 'bb', ratio: 0.4,
    cues: ['Shoulder blades pinched, feet planted.', 'Lower the bar to your lower chest.', 'Press up and back over your shoulders.'] });
  move('bench_db', 'benchDB', { ...G_PRESS, name: 'Dumbbell bench press', req: ['db', 'bench'], load: 'db', ratio: 0.12,
    cues: ['Dumbbells over your shoulders, palms forward.', 'Lower them to the sides of your chest.', 'Press up until they nearly touch.'], mistake: 'Flaring your elbows straight out to the sides.' });
  move('press_machine', 'machinePress', { ...G_PRESS, name: 'Machine chest press', req: ['chestPress'], load: 'machine', ratio: 0.3,
    cues: ['Handles level with your mid-chest.', 'Press out until your arms are straight.', 'Let the handles come back slowly.'], mistake: 'Shrugging your shoulders up as you press.' });
  move('bench_smith', 'benchSmith', { ...G_PRESS, name: 'Smith machine bench press', req: ['smith', 'bench'], load: 'smith', ratio: 0.35,
    cues: ['Bench set so the bar lands on your lower chest.', 'Turn the bar off the hooks, lower with control.', 'Press straight up.'] });
  move('incline_db', 'inclineDB', { ...G_PRESS, name: 'Incline dumbbell press', req: ['db', 'incline'], load: 'db', ratio: 0.1,
    cues: ['Bench at 30 to 45 degrees.', 'Lower the dumbbells to your upper chest.', 'Press up over your shoulders.'], mistake: 'Arching your back until the incline turns flat.' });
  move('incline_bb', 'inclineBB', { ...G_PRESS, name: 'Incline barbell press', req: ['bb', 'incline', 'rack'], load: 'bb', ratio: 0.33,
    cues: ['Bench at 30 to 45 degrees.', 'Lower the bar to just below your collarbones.', 'Press up over your shoulders.'] });
  move('incline_smith', 'inclineSmith', { ...G_PRESS, name: 'Incline Smith press', req: ['smith', 'incline'], load: 'smith', ratio: 0.3,
    cues: ['Bench set so the bar lands on your upper chest.', 'Lower with control, elbows under the bar.', 'Press straight up.'] });
  const G_FLY = { ...GYM, group: 'chest', joints: ['shoulder'], range: [10, 20], start: 12, mistake: 'Bending your elbows more to turn it into a press.', breathe: 'Breathe out as you bring your arms together.' };
  move('fly_cable', 'cableFly', { ...G_FLY, name: 'Cable fly', req: ['cable'], load: 'cable', ratio: 0.07,
    cues: ['Pulleys high, one step forward, slight lean.', 'Hug the handles together in front of you.', 'Open wide until your chest stretches.'] });
  move('fly_pec', 'pecFly', { ...G_FLY, name: 'Pec deck fly', req: ['pecDeck'], load: 'machine', ratio: 0.25,
    cues: ['Seat set so the handles are at chest height.', 'Sweep the handles together in a wide arc.', 'Let them open until your chest stretches.'] });
  move('fly_db', 'benchFly', { ...G_FLY, name: 'Dumbbell fly', req: ['db', 'bench'], load: 'db', ratio: 0.07,
    cues: ['Palms facing, slight bend in your elbows.', 'Open wide until your chest stretches.', 'Hug the weights back up over your chest.'] });

  const G_SQ = { ...GYM, group: 'legs', joints: ['knee', 'hip', 'back'], range: [6, 12], start: 8, mistake: 'Knees caving in on the way up.', breathe: 'Big breath in before you go down, out as you stand.' };
  move('squat_bb', 'squatBB', { ...G_SQ, name: 'Barbell back squat', req: ['bb', 'rack'], load: 'bb', ratio: 0.45, complex: true,
    cues: ['Bar on your upper back, brace your core.', 'Sit down between your heels to at least parallel.', 'Drive up, chest and hips rising together.'] });
  move('squat_smith', 'squatSmith', { ...G_SQ, name: 'Smith machine squat', req: ['smith'], load: 'smith', ratio: 0.4,
    cues: ['Feet a little in front of the bar.', 'Sit straight down, chest tall.', 'Push the floor away to stand.'] });
  move('leg_press', 'legPress', { ...G_SQ, name: 'Leg press', req: ['legPress'], load: 'machine', ratio: 0.8, range: [8, 15], start: 10, joints: ['knee', 'hip'],
    cues: ['Feet shoulder-width, flat on the plate.', 'Lower until your knees are bent to about 90 degrees.', 'Press back up without locking your knees.'],
    mistake: 'Letting your lower back curl off the pad at the bottom.', breathe: 'Breathe in as you lower, out as you press.' });
  const G_HG = { ...GYM, group: 'legs', joints: ['back', 'hip'], range: [6, 12], start: 8, mistake: 'Rounding your lower back.', breathe: 'Breathe in and brace before each rep, out at the top.' };
  move('rdl_bb', 'rdlBB', { ...G_HG, name: 'Romanian deadlift', req: ['bb'], load: 'bb', ratio: 0.5,
    cues: ['Soft knees, bar against your thighs.', 'Push your hips back, the bar slides down your legs.', 'Stop at a hamstring stretch, then stand tall.'] });
  move('deadlift_bb', 'deadliftBB', { ...G_HG, name: 'Deadlift', req: ['bb'], load: 'bb', ratio: 0.6, joints: ['back', 'hip', 'knee'], complex: true,
    cues: ['Bar over your mid-foot, shins touching it.', 'Flat back, push the floor away.', 'Stand tall, then lower it the same way.'] });
  move('rdl_db', 'rdlDB', { ...G_HG, name: 'Dumbbell Romanian deadlift', req: ['db'], load: 'db', ratio: 0.15,
    cues: ['Dumbbells at your sides, soft knees.', 'Push your hips back, weights close to your legs.', 'Stop at a hamstring stretch, then stand tall.'] });
  move('thrust_bb', 'thrustBB', { ...GYM, group: 'legs', joints: ['hip'], name: 'Barbell hip thrust', req: ['bb', 'bench'], load: 'bb', ratio: 0.5, range: [8, 15], start: 10,
    cues: ['Upper back on the bench, bar padded on your hips.', 'Drive through your heels until your thighs are flat.', 'Chin tucked, squeeze at the top.'],
    mistake: 'Arching your lower back at the top.', breathe: 'Breathe out as you lift.' });
  const G_LEG_ISO = { ...GYM, group: 'legs', joints: ['knee'], range: [10, 20], start: 12, load: 'machine' };
  move('leg_curl', 'legCurl', { ...G_LEG_ISO, name: 'Leg curl', req: ['legCurl'], ratio: 0.2,
    cues: ['Line your knees up with the machine\'s pivot.', 'Curl your heels down and back as far as they go.', 'Straighten slowly, don\'t let the stack slam.'],
    mistake: 'Lifting your hips to finish the rep.', breathe: 'Breathe out as you curl.' });
  move('leg_ext', 'legExt', { ...G_LEG_ISO, name: 'Leg extension', req: ['legExt'], ratio: 0.25,
    cues: ['Line your knees up with the machine\'s pivot.', 'Straighten your legs and squeeze your thighs.', 'Lower slowly until your knees are bent.'],
    mistake: 'Kicking the weight up with momentum.', breathe: 'Breathe out as you straighten.' });
  const G_LUNGE = { ...GYM, group: 'legs', joints: ['knee', 'hip'], load: 'db', range: [8, 15], start: 10, uni: true, mistake: 'Front knee drifting inward.', breathe: 'Breathe in as you lower, out as you rise.' };
  move('lunge_db', 'lungeDB', { ...G_LUNGE, name: 'Dumbbell reverse lunge', req: ['db'], ratio: 0.1,
    cues: ['A dumbbell in each hand, stand tall.', 'Step back and lower straight down.', 'Push through your front heel to come back up.'] });
  move('split_db', 'splitDB', { ...G_LUNGE, name: 'Dumbbell split squat', req: ['db'], ratio: 0.12,
    cues: ['Long stance, a dumbbell in each hand.', 'Drop your back knee toward the floor.', 'Front heel stays down as you rise.'] });
  move('leg_curl_db', 'legCurlDB', { ...G_LEG_ISO, name: 'Lying dumbbell leg curl', req: ['db', 'bench'], load: 'db', ratio: 0.06,
    cues: ['Lie face down on a bench, knees just off the end.', 'Squeeze a dumbbell between your feet.', 'Curl your heels up, then lower slowly.'],
    mistake: 'Lifting your hips off the bench.', breathe: 'Breathe out as you curl.' });
  const G_CALF = { ...GYM, group: 'legs', joints: ['ankle'], range: [10, 20], start: 12, mistake: 'Bouncing at the bottom instead of pausing.', breathe: 'Breathe out as you rise.' };
  const CALF_CUES = ['Balls of your feet on a plate or step.', 'Rise as high as you can and hold.', 'Lower until your heels drop below the step.'];
  move('calf_smith', 'calfSmith', { ...G_CALF, name: 'Smith machine calf raise', req: ['smith'], load: 'smith', ratio: 0.5, cues: CALF_CUES });
  move('calf_db', 'calfDB', { ...G_CALF, name: 'Dumbbell calf raise', req: ['db'], load: 'db', ratio: 0.15, cues: CALF_CUES });
  move('calf_press', 'calfPress', { ...G_CALF, name: 'Leg press calf raise', req: ['legPress'], load: 'machine', ratio: 0.6,
    cues: ['Balls of your feet on the bottom edge of the plate.', 'Legs straight but not locked, push through your toes.', 'Let your heels sink back for a stretch.'] });

  const G_PULL = { ...GYM, group: 'back', joints: ['shoulder', 'elbow'], range: [6, 12], start: 8, mistake: 'Leaning way back to yank the weight.', breathe: 'Breathe out as you pull.' };
  move('pulldown', 'pulldown', { ...G_PULL, name: 'Lat pulldown', req: ['pulldown'], load: 'machine', ratio: 0.4,
    cues: ['Thighs under the pad, hands a bit wider than your shoulders.', 'Pull the bar to your upper chest, elbows to your ribs.', 'Let it rise until your arms are straight.'] });
  move('row_cable', 'rowCable', { ...G_PULL, name: 'Seated cable row', req: ['cable'], load: 'cable', ratio: 0.35, joints: ['back', 'elbow'],
    cues: ['Sit tall, knees soft, feet on the plate.', 'Pull the handle to your belly, elbows close.', 'Reach forward until your shoulder blades spread.'], mistake: 'Rocking your whole body back and forth.' });
  move('row_bb', 'rowBB', { ...G_PULL, name: 'Barbell row', req: ['bb'], load: 'bb', ratio: 0.35, joints: ['back', 'elbow'],
    cues: ['Hinge until your back is at about 45 degrees.', 'Pull the bar to your lower chest.', 'Lower it with straight arms, back flat.'], mistake: 'Standing up a little more with every rep.' });
  move('row_chest', 'chestRow', { ...G_PULL, name: 'Chest-supported dumbbell row', req: ['db', 'incline'], load: 'db', ratio: 0.12, joints: ['elbow', 'shoulder'],
    cues: ['Chest on the incline pad, feet planted.', 'Row the dumbbells to your lower ribs.', 'Lower until your arms hang straight.'], mistake: 'Lifting your chest off the pad to heave the weight.' });
  const G_REAR = { ...GYM, group: 'back', joints: ['shoulder'], range: [10, 20], start: 12, mistake: 'Shrugging instead of pulling back.', breathe: 'Breathe out as you pull your arms apart.' };
  move('face_pull', 'facePull', { ...G_REAR, name: 'Face pull', req: ['cable'], load: 'cable', ratio: 0.15,
    cues: ['Pulley at face height, rope in an overhand grip.', 'Pull to your forehead, hands apart, elbows high.', 'Pause, then let your arms reach forward.'] });
  move('rev_fly_machine', 'revFlyMachine', { ...G_REAR, name: 'Reverse pec deck', req: ['pecDeck'], load: 'machine', ratio: 0.15,
    cues: ['Face the pad, handles at shoulder height.', 'Sweep your arms out and back in a wide arc.', 'Bring them back together with control.'] });

  const G_OHP = { ...GYM, group: 'shoulders', joints: ['shoulder', 'elbow'], range: [6, 12], start: 8, mistake: 'Arching your lower back to push the weight up.', breathe: 'Breathe out as you press.' };
  move('ohp_db', 'seatedPressDB', { ...G_OHP, name: 'Seated dumbbell shoulder press', req: ['db', 'incline'], load: 'db', ratio: 0.1,
    cues: ['Bench upright, back flat against it.', 'Press the dumbbells straight up overhead.', 'Lower to ear height, elbows under your wrists.'] });
  move('ohp_bb', 'ohpBB', { ...G_OHP, name: 'Overhead press', req: ['bb', 'rack'], load: 'bb', ratio: 0.3, joints: ['shoulder', 'elbow', 'back'],
    cues: ['Bar on your front shoulders, grip just outside them.', 'Press straight up, head back, then through.', 'Lock out overhead, glutes squeezed.'], mistake: 'Leaning back to push the bar up.' });
  move('press_shoulder_machine', 'machineShoulder', { ...G_OHP, name: 'Machine shoulder press', req: ['shoulderPress'], load: 'machine', ratio: 0.25,
    cues: ['Seat set so the handles start at shoulder height.', 'Press up until your arms are straight.', 'Lower slowly back to your shoulders.'] });
  move('raise_cable', 'cableRaise', { ...GYM, group: 'shoulders', joints: ['shoulder'], name: 'Cable lateral raise', req: ['cable'], load: 'cable', ratio: 0.04, range: [10, 20], start: 12, uni: true,
    cues: ['Pulley low, the cable crossing in front of you.', 'Raise your arm out to shoulder height.', 'Lower slowly, keep tension at the bottom.'], mistake: 'Swinging your body to lift the weight.', breathe: 'Breathe out as you raise.' });

  const G_CURL = { ...GYM, group: 'biceps', joints: ['elbow', 'wrist'], mistake: 'Swinging the weight up with your back.', breathe: 'Breathe out as you curl.' };
  move('curl_bb', 'curlBar', { ...G_CURL, name: 'Barbell curl', req: ['ez|bb'], load: 'ez|bb', ratio: 0.2, range: [8, 15], start: 10,
    cues: ['Hands shoulder-width, palms up.', 'Curl the bar up, elbows pinned to your sides.', 'Lower until your arms are straight.'] });
  move('curl_incline', 'inclineCurl', { ...G_CURL, name: 'Incline dumbbell curl', req: ['db', 'incline'], load: 'db', ratio: 0.07, range: [10, 20], start: 12,
    cues: ['Lie back on a 45 to 60 degree incline.', 'Arms hang straight down, palms forward.', 'Curl up without moving your elbows forward.'], mistake: 'Letting your elbows swing forward.' });
  move('curl_cable', 'curlCable', { ...G_CURL, name: 'Cable curl', req: ['cable'], load: 'cable', ratio: 0.15, range: [10, 20], start: 12,
    cues: ['Pulley low, stand close to it.', 'Curl the bar up, elbows pinned to your sides.', 'Lower until your arms are straight.'] });
  const G_TRI = { ...GYM, group: 'triceps', joints: ['elbow'], mistake: 'Letting your elbows drift forward or flare out.', breathe: 'Breathe out as you straighten your arms.' };
  move('pushdown_cable', 'pushdownCable', { ...G_TRI, name: 'Rope pushdown', req: ['cable'], load: 'cable', ratio: 0.2, range: [10, 20], start: 12,
    cues: ['Elbows pinned to your sides.', 'Push down and spread the rope at the bottom.', 'Let your forearms rise just past parallel.'] });
  move('oh_ext_cable', 'ohCable', { ...G_TRI, name: 'Overhead cable extension', req: ['cable'], load: 'cable', ratio: 0.15, range: [10, 20], start: 12, joints: ['elbow', 'shoulder'],
    cues: ['Face away from the cable, rope behind your head.', 'Upper arms by your ears, straighten your arms.', 'Let your hands come back until your triceps stretch.'] });
  move('skull_ez', 'skullEZ', { ...G_TRI, name: 'Skull crusher', req: ['ez|bb', 'bench'], load: 'ez|bb', ratio: 0.15, range: [8, 15], start: 10,
    cues: ['Upper arms still, tilted slightly back.', 'Bend your elbows to lower the bar to your forehead.', 'Straighten your arms without flaring your elbows.'] });
  move('cg_bench', 'closeGrip', { ...G_TRI, name: 'Close-grip bench press', req: ['bb', 'bench', 'rack'], load: 'bb', ratio: 0.35, range: [6, 12], start: 8, joints: ['elbow', 'shoulder', 'wrist'],
    cues: ['Hands shoulder-width on the bar.', 'Lower to your lower chest, elbows close to your sides.', 'Press up and lock out.'], mistake: 'Gripping so narrow your wrists bend.' });
  move('dip_bar', 'dipBars', { ...G_TRI, name: 'Parallel bar dip', req: ['dip'], load: null, range: [4, 12], start: 6, joints: ['shoulder', 'elbow', 'wrist'],
    cues: ['Lock your arms out, shoulders down.', 'Lower until your upper arms are level with the bars.', 'Press back up, leaning slightly forward.'],
    mistake: 'Dropping so low your shoulders roll forward.', breathe: 'Breathe in on the way down, out as you push up.' });

  const G_AB = { ...GYM, group: 'abs', joints: ['back'], range: [10, 20], start: 12, breathe: 'Breathe out as you crunch.' };
  move('cable_crunch', 'cableCrunch', { ...G_AB, name: 'Cable crunch', req: ['cable'], load: 'cable', ratio: 0.3,
    cues: ['Kneel facing the cable, rope beside your head.', 'Curl your ribs down toward your hips.', 'Hips stay still, roll back up slowly.'], mistake: 'Sitting back and pulling with your arms.' });
  move('hang_knee', 'hangKnee', { ...G_AB, name: 'Hanging knee raise', req: ['bar'], load: null, range: [8, 15], start: 10, joints: ['shoulder', 'back'],
    cues: ['Hang with straight arms, shoulders active.', 'Bring your knees up past your hips.', 'Lower slowly without swinging.'], mistake: 'Swinging your legs for momentum.', breathe: 'Breathe out as your knees come up.' });
  move('pallof', 'pallof', { ...G_AB, name: 'Pallof press', req: ['cable|band'], load: 'cable|band', ratio: 0.1, range: [8, 15], start: 10, uni: true,
    cues: ['Stand side-on, handle at your chest.', 'Press straight out and hold, don\'t let it turn you.', 'Bring it back to your chest with control.'],
    mistake: 'Letting your hips and shoulders twist toward the cable.', breathe: 'Breathe out as you press, keep breathing in the hold.' });

  const G_COND = { ...GYM, group: 'conditioning', joints: [], load: null, timed: true, range: [20, 40], start: 20, mistake: 'Going so hard in the first round that you fade.', breathe: 'Keep breathing, don\'t hold it.' };
  move('rower_int', 'rower', { ...G_COND, name: 'Rower intervals', req: ['rower'], joints: ['back'],
    cues: ['Legs, then lean back, then arms.', 'Arms, lean forward, then slide in.', 'Drive hard, recover slowly.'], mistake: 'Pulling with your arms before your legs finish.' });
  move('bike_int', 'bike', { ...G_COND, name: 'Bike intervals', req: ['bike'], joints: ['knee'],
    cues: ['Seat at hip height, knee slightly bent at the bottom.', 'Spin fast against real resistance.', 'Easy spin in the rest.'] });
  move('incline_walk', 'inclineWalk', { ...G_COND, name: 'Incline walk', req: ['treadmill'], range: [30, 60], start: 30, joints: ['ankle'],
    cues: ['Steep incline, brisk walking pace.', 'Stand tall and let your arms swing.', 'Hands off the rails.'], mistake: 'Holding the rails and leaning back.' });
  // Starting loads for the home moves the gym pools reuse (per dumbbell or kettlebell).
  for (const [id, r] of Object.entries({ sq_goblet: 0.2, gl_thrust: 0.2, row_db: 0.12, rear_fly: 0.05, raise: 0.06, curl_std: 0.08 })) MOVES[id].ratio = r;

  /* ------------------------------------------------------------------ ladders */
  // Rungs are listed easiest → hardest; each user only sees the rungs their equipment allows.
  const LADDERS = Object.assign(Object.create(null), {
    curl: { name: 'Curls', group: 'biceps', rungs: ['curl_towel', 'curl_band', 'curl_hammer', 'curl_std', 'curl_slow', 'curl_half', 'curl_conc'] },
    triceps: { name: 'Triceps', group: 'triceps', rungs: ['tri_skull', 'tri_oh', 'tri_band', 'tri_band_oh', 'tri_dip_bent', 'tri_oh_slow', 'tri_dip', 'tri_diamond', 'tri_oh1'] },
    push: { name: 'Push-ups', group: 'chest', rungs: ['push_wall', 'push_incline', 'push_knee', 'push_std', 'push_slow', 'push_pause', 'push_decline', 'push_archer'] },
    chestDb: { name: 'Floor press', group: 'chest', accessory: true, rungs: ['chest_press', 'chest_press_slow', 'chest_fly', 'chest_press1', 'chest_press_half'] },
    squat: { name: 'Squats and lunges', group: 'legs', rungs: ['sq_bw', 'sq_goblet', 'sq_goblet_pause', 'sq_stepup', 'sq_split', 'sq_lunge', 'sq_goblet_lunge', 'sq_bulgarian', 'sq_pistol'] },
    hinge: { name: 'Hinges', group: 'legs', rungs: ['hg_bridge', 'hg_deadlift', 'hg_swing', 'hg_rdl', 'hg_bridge1', 'hg_sldl', 'hg_sldl_slow', 'hg_swing1'] },
    glute: { name: 'Glute bridges', group: 'legs', accessory: true, rungs: ['gl_bridge', 'gl_kbbridge', 'gl_thrust', 'gl_thrust_pause', 'gl_bridge1', 'gl_thrust1'] },
    hamCurl: { name: 'Hamstring curls', group: 'legs', accessory: true, rungs: ['ham_walkout', 'ham_slide', 'ham_band_gm', 'ham_slide1', 'ham_nordic'] },
    calf: { name: 'Calves', group: 'legs', accessory: true, rungs: ['calf_bw', 'calf_wall_slow', 'calf_load', 'calf_1leg'] },
    row: { name: 'Rows', group: 'back', rungs: ['row_prone_w', 'row_superman', 'row_towel', 'row_door', 'row_table', 'row_band', 'row_band_high', 'row_db', 'row_chair', 'row_slow', 'row_pause', 'row_half', 'row_chair_half'] },
    pull: { name: 'Pull-ups', group: 'back', rungs: ['pull_hang', 'pull_scap', 'pull_neg', 'pull_chin', 'pull_up', 'pull_slow'] },
    rear: { name: 'Rear shoulders', group: 'back', rungs: ['rear_towel', 'rear_band', 'rear_face_band', 'rear_ytw', 'rear_ytw_hold', 'rear_fly', 'rear_high_pull', 'rear_fly_slow', 'rear_fly_pause'] },
    backExt: { name: 'Lower back', group: 'back', accessory: true, rungs: ['back_birddog', 'back_superman', 'back_ext', 'back_ext_pause'] },
    press: { name: 'Overhead press', group: 'shoulders', rungs: ['press_pike_incline', 'press_band', 'press_db', 'press_pike', 'press_db_slow', 'press_1arm', 'press_pike_decline'] },
    raise: { name: 'Lateral raises', group: 'shoulders', rungs: ['raise_wall_iso', 'raise_prone_y', 'raise_band', 'raise', 'raise_slow', 'raise_half', 'raise_pause', 'raise_lean'] },
    abs: { name: 'Abs', group: 'abs', rungs: ['ab_deadbug', 'ab_revcrunch', 'ab_legraise', 'ab_hollow', 'ab_vup'] },
    absLoad: { name: 'Crunches', group: 'abs', rungs: ['abl_crunch', 'abl_kb', 'abl_kb_slow', 'abl_kb_arms', 'abl_situp'] },
    coreRot: { name: 'Rotation', group: 'abs', rungs: ['rot_russian', 'rot_chop', 'rot_russian_up', 'rot_kneel_chop', 'rot_slam', 'rot_toss'] },
    coreSide: { name: 'Side core', group: 'abs', rungs: ['side_knee', 'side_carry', 'side_plank', 'side_march', 'side_star'] },
    finisher: { name: 'Finishers', group: 'conditioning', rungs: ['fin_march', 'fin_step_jacks', 'fin_pulse', 'fin_toss', 'fin_swing', 'fin_climbers', 'fin_squat_thrust', 'fin_jacks', 'fin_slam', 'fin_burpee', 'fin_swing1'] },
    // Gym pools (gym: true): preference-ordered, not easiest → hardest. The first allowed move is
    // used and its load progresses; a stall rotates to the next allowed one. Some reuse home moves,
    // which keep their home `family`.
    pressG: { name: 'Chest press', group: 'chest', gym: true, rungs: ['bench_bb', 'bench_db', 'press_machine', 'bench_smith'] },
    inclineG: { name: 'Incline press', group: 'chest', gym: true, accessory: true, rungs: ['incline_db', 'incline_bb', 'incline_smith'] },
    flyG: { name: 'Chest fly', group: 'chest', gym: true, iso: true, rungs: ['fly_cable', 'fly_pec', 'fly_db'] },
    squatG: { name: 'Squat', group: 'legs', gym: true, rungs: ['squat_bb', 'squat_smith', 'leg_press', 'sq_goblet'] },
    hingeG: { name: 'Hinge', group: 'legs', gym: true, rungs: ['rdl_bb', 'deadlift_bb', 'rdl_db'] },
    gluteG: { name: 'Hip thrust', group: 'legs', gym: true, accessory: true, rungs: ['thrust_bb', 'gl_thrust'] },
    lungeG: { name: 'Lunges', group: 'legs', gym: true, accessory: true, rungs: ['lunge_db', 'split_db'] },
    legCurlG: { name: 'Leg curl', group: 'legs', gym: true, iso: true, rungs: ['leg_curl', 'leg_curl_db'] },
    legExtG: { name: 'Leg extension', group: 'legs', gym: true, iso: true, rungs: ['leg_ext'] },
    calfG: { name: 'Calves', group: 'legs', gym: true, iso: true, rungs: ['calf_smith', 'calf_press', 'calf_db'] },
    pullG: { name: 'Pulldown', group: 'back', gym: true, rungs: ['pulldown', 'pull_up', 'pull_neg'] },
    rowG: { name: 'Row', group: 'back', gym: true, rungs: ['row_cable', 'row_bb', 'row_chest', 'row_db'] },
    rearG: { name: 'Rear delts', group: 'back', gym: true, accessory: true, rungs: ['face_pull', 'rev_fly_machine', 'rear_fly'] },
    ohpG: { name: 'Overhead press', group: 'shoulders', gym: true, rungs: ['ohp_db', 'ohp_bb', 'press_shoulder_machine'] },
    raiseG: { name: 'Lateral raise', group: 'shoulders', gym: true, iso: true, rungs: ['raise_cable', 'raise'] },
    curlG: { name: 'Biceps', group: 'biceps', gym: true, rungs: ['curl_bb', 'curl_incline', 'curl_cable', 'curl_std'] },
    triG: { name: 'Triceps', group: 'triceps', gym: true, rungs: ['pushdown_cable', 'oh_ext_cable', 'skull_ez', 'cg_bench', 'dip_bar'] },
    absG: { name: 'Core', group: 'abs', gym: true, rungs: ['cable_crunch', 'hang_knee', 'pallof'] },
    cardioG: { name: 'Cardio', group: 'conditioning', gym: true, rungs: ['rower_int', 'bike_int', 'incline_walk'] },
  });
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
  const ONE_ARM = Object.assign(Object.create(null), { curl_std: 'curl_1arm', curl_slow: 'curl_1arm', curl_half: 'curl_1arm', curl_hammer: 'hammer_1arm', curl_band: 'curl_towel' });

  // Warm-ups: `all` is every one (upper body first); the brain picks the ones that suit the day's
  // muscles (mobFor). kb / none are the lists shown with and without a kettlebell.
  const WARMUP = {
    all: ['wu_halo', 'wu_circles', 'wu_scap', 'wu_pullapart', 'wu_angels', 'wu_squat', 'wu_legswing'],
    kb: ['wu_halo', 'wu_circles', 'wu_scap', 'wu_angels', 'wu_squat', 'wu_legswing'],
    none: ['wu_circles', 'wu_scap', 'wu_angels', 'wu_squat', 'wu_legswing'],
  };
  // Mobility moves in a floor-friendly flow order; cool-downs and light-day flows pick from them.
  const MOBILITY = ['mob_catcow', 'mob_wgs', 'mob_hipflexor', 'mob_ankle', 'mob_squat', 'mob_calf', 'mob_chest', 'mob_hamfloss', 'mob_9090', 'mob_openbook', 'mob_child'];

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
      // Gym (simple booleans; gym dumbbells use the `db` list above).
      case 'bb': return !!eq.bb;
      case 'ez': return !!eq.ez;
      case 'rack': return !!eq.rack;
      case 'bench': return !!(eq.bench || eq.benchIncline); // an adjustable bench lies flat too
      case 'incline': return !!eq.benchIncline;
      case 'smith': return !!eq.smith;
      case 'cable': return !!eq.cable;
      case 'pulldown': return !!eq.pulldown;
      case 'legPress': return !!eq.legPress;
      case 'legCurl': return !!eq.legCurl;
      case 'legExt': return !!eq.legExt;
      case 'chestPress': return !!eq.chestPress;
      case 'shoulderPress': return !!eq.shoulderPress;
      case 'pecDeck': return !!eq.pecDeck;
      case 'dip': return !!eq.dip;
      case 'rower': return !!eq.rower;
      case 'bike': return !!eq.bike;
      case 'treadmill': return !!eq.treadmill;
      default: return false;
    }
  }
  function allowed(m, eq) {
    return (m.req || []).every((alt) => alt.split('|').some((k) => has(eq, k)));
  }
  // Which equipment actually loads this move for this person (heaviest available wins).
  // 'machine' is the machine the move requires, so it loads whenever the move is allowed.
  function loadFor(m, eq) {
    if (!m.load) return null;
    for (const k of m.load.split('|')) if (k === 'machine' ? allowed(m, eq) : has(eq, k)) return k;
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
  // A move with its drawn equipment (and props, e.g. a band on a door instead of a cable tower)
  // switched to what this person has.
  function forPerson(m, eq) {
    const load = loadFor(m, eq);
    const equip = load && m.equipBy && m.equipBy[load];
    const props = load && m.propsBy && m.propsBy[load];
    if (!equip && !props) return m;
    return Object.assign({}, m, equip ? { equip } : {}, props ? { props } : {}, { $flat: undefined, $tl: undefined });
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
