/* Pose engine: one small, data-driven figure for every move.
 *
 * A move is 2-4 keyframe poses built from joint angles (torso, neck, shoulders, elbows, hips,
 * knees, ankles), tweened with easing at the move's real tempo. One joint is pinned to a surface
 * (floor, seat, wall, bar) and planted hands/feet can use 2-bone IK so they stay put.
 *
 * Coordinates: units are roughly centimetres, x to the right, y DOWN (SVG), floor at y = 0.
 * dir(θ) = (sin θ, cos θ): θ = 0 points down, 90 forward (+x), 180 up, -90 back.
 *
 * Side view (default): the figure faces +x; "N" limbs are the near side, "F" the far side.
 * Unilateral moves author the working limb as N; the lead side is drawn mirrored so its working
 * limb is still the near one. Front/top views: "N" is the figure's left (screen right), "F" its right.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const D2R = Math.PI / 180;
  const dir = (deg) => [Math.sin(deg * D2R), Math.cos(deg * D2R)];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, s) => [a[0] * s, a[1] * s];
  const len = (a) => Math.hypot(a[0], a[1]);
  const angOf = (v) => Math.atan2(v[0], v[1]) / D2R;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Segment lengths and drawn thickness.
  const L = { torso: 50, neck: 7, head: 10.5, ua: 29, fa: 25, hand: 7, th: 43, sh: 42, foot: 16, heel: 4, shoulder: 17, hip: 8.5 };
  const W = { torso: 23, torsoFront: 29, neck: 8, ua: 10, fa: 8.5, hand: 6.5, th: 14.5, sh: 10.5, foot: 6, shoulders: 10 };
  const OUTLINE = 1.9;
  const SEAT_H = 45; // couch / chair seat height

  const LIMBS = ['aN', 'aF', 'lN', 'lF'];
  const DEFAULTS = {
    t: 0, n: 0, tw: 0, ts: 1, ns: 1,
    aN: { s: 0, e: 8, w: 0 }, lN: { h: 0, k: 0, a: 0 },
  };

  /* ---------------------------------------------------------------- pose normalisation */
  // Turn a (possibly sparse) pose into a flat map of numbers so any two poses can be tweened.
  function flatten(pose, view) {
    const p = pose || {};
    const f = {};
    f.t = num(p.t, 0); f.n = num(p.n, 0); f.tw = num(p.tw, 0); f.ts = num(p.ts, 1); f.ns = num(p.ns, 1);
    const aN = Object.assign({}, DEFAULTS.aN, p.aN);
    const aF = Object.assign({}, aN, p.aF);
    const lN = Object.assign({}, DEFAULTS.lN, p.lN);
    const lF = Object.assign({}, lN, p.lF);
    const limbs = { aN, aF, lN, lF };
    for (const k of LIMBS) for (const [j, v] of Object.entries(limbs[k])) if (typeof v === 'number') f[k + '.' + j] = v;
    for (const [k, v] of Object.entries(p.sc || {})) f['sc.' + k] = v;
    const ikT = Object.assign({}, p.ik);
    // In side view both limbs overlap: unless the far limb is posed on its own, it follows the
    // near limb's IK target (both hands on the floor, both feet planted).
    if (view === 'side' || !view) {
      if (ikT.anN && !ikT.anF && !p.lF) ikT.anF = ikT.anN;
      if (ikT.hdN && !ikT.hdF && !p.aF) ikT.hdF = ikT.hdN;
    }
    for (const [k, v] of Object.entries(ikT)) { f['ik.' + k + '.x'] = v[0]; f['ik.' + k + '.y'] = v[1]; }
    for (const k of ['ball', 'kb', 'db', 'at']) if (p[k]) { f[k + '.x'] = p[k][0]; f[k + '.y'] = p[k][1]; }
    // Non-numeric flags travel along unchanged.
    f.$ = { flatN: lN.flat !== false, flatF: lF.flat !== false, pin: p.pin, view };
    return f;
  }
  const num = (v, d) => (typeof v === 'number' ? v : d);

  function mix(a, b, t) {
    const out = {};
    for (const k of Object.keys(a)) {
      if (k === '$') continue;
      out[k] = k in b ? lerp(a[k], b[k], t) : a[k];
    }
    for (const k of Object.keys(b)) if (!(k in out) && k !== '$') out[k] = b[k];
    out.$ = t < 0.5 ? a.$ : b.$;
    // Keep the pinned joint steady across a transition: pins never tween.
    out.$ = Object.assign({}, out.$, { pin: a.$.pin || b.$.pin });
    return out;
  }

  /* ---------------------------------------------------------------- forward kinematics */
  function solve(move, f) {
    const view = move.view || 'side';
    const pts = {};
    const P = [0, 0]; // pelvis (hip centre), moved later by the pin
    const sc = (k) => (('sc.' + k) in f ? f['sc.' + k] : 1);
    const thT = 180 - f.t; // torso direction, hip → neck
    const neck = add(P, mul(dir(thT), L.torso * f.ts));
    pts.hip = P; pts.neck = neck;
    const thHead = thT - f.n;
    pts.head = add(neck, mul(dir(thHead), (L.neck + L.head) * f.ns));
    pts.headDir = thHead;
    const down = -f.t; // torso-down direction for limbs
    let sN = neck, sF = neck, hN = P, hF = P;
    if (view !== 'side') {
      // Frontal plane: shoulders and hips sit to each side; twist narrows them.
      const across = thT - 90; // points to the figure's left (screen right) when upright
      const cw = Math.cos(f.tw * D2R);
      sN = add(neck, mul(dir(across), L.shoulder * cw));
      sF = add(neck, mul(dir(across), -L.shoulder * cw));
      hN = add(P, mul(dir(across), L.hip * Math.cos(f.tw * 0.35 * D2R)));
      hF = add(P, mul(dir(across), -L.hip * Math.cos(f.tw * 0.35 * D2R)));
      pts.head = add(pts.head, mul(dir(across), Math.sin(f.tw * D2R) * 3));
    }
    pts.shN = sN; pts.shF = sF; pts.hpN = hN; pts.hpF = hF;
    for (const side of ['N', 'F']) {
      const mirror = view !== 'side' && side === 'F' ? -1 : 1;
      const a = (k) => f['a' + side + '.' + k];
      const l = (k) => f['l' + side + '.' + k];
      // Arm
      const thUA = down + mirror * a('s');
      const el = add(pts['sh' + side], mul(dir(thUA), L.ua * sc('ua' + side)));
      const thFA = thUA + mirror * a('e');
      const wr = add(el, mul(dir(thFA), L.fa * sc('fa' + side)));
      const thHand = thFA + mirror * a('w');
      pts['el' + side] = el; pts['wr' + side] = wr;
      pts['hd' + side] = add(wr, mul(dir(thHand), L.hand * sc('fa' + side)));
      // Leg
      const thTH = down + mirror * l('h');
      const kn = add(pts['hp' + side], mul(dir(thTH), L.th * sc('th' + side)));
      const thSH = thTH - mirror * l('k');
      const an = add(kn, mul(dir(thSH), L.sh * sc('sh' + side)));
      pts['kn' + side] = kn; pts['an' + side] = an;
      footFrom(pts, side, thSH, l('a'), f.$['flat' + side], view, mirror, sc('ft' + side), l('fd'));
    }
    // Pin one joint to its surface.
    const pin = f.$.pin || move.pin || { joint: 'anN', at: [0, -8] };
    const at = 'at.x' in f ? [f['at.x'], f['at.y']] : pin.at;
    const cur = pinPoint(pts, pin.joint);
    const off = sub(at, cur);
    for (const k of Object.keys(pts)) if (Array.isArray(pts[k])) pts[k] = add(pts[k], off);
    // 2-bone IK for planted hands/feet (targets are in world coordinates).
    for (const [key, bend] of [['hdN', -1], ['hdF', -1], ['anN', 1], ['anF', 1]]) {
      const tk = 'ik.' + key;
      if (!((tk + '.x') in f)) continue;
      ik(pts, key, [f[tk + '.x'], f[tk + '.y']], move.bend && move.bend[key] != null ? move.bend[key] : bend, view, f, sc);
    }
    // Free objects (a ball in flight, a bell around the head).
    for (const k of ['ball', 'kb', 'db']) if ((k + '.x') in f) pts[k] = [f[k + '.x'], f[k + '.y']];
    return pts;
  }

  function footFrom(pts, side, thSH, ankle, flat, view, mirror, scale, fixedDir) {
    const an = pts['an' + side];
    let thFoot;
    if (typeof fixedDir === 'number') thFoot = fixedDir;
    else if (view === 'side') thFoot = flat ? 90 : thSH + 90 - ankle;
    else thFoot = flat ? 0 : thSH - mirror * ankle * 0.2;
    const footLen = view === 'side' ? L.foot : 6;
    pts['to' + side] = add(an, mul(dir(thFoot), footLen * scale));
    pts['he' + side] = add(an, mul(dir(thFoot), view === 'side' ? -L.heel : 0));
    pts['footDir' + side] = thFoot;
  }

  function pinPoint(pts, joint) {
    if (joint === 'butt') return add(pts.hip, [0, 8]);
    if (joint === 'back') return mid(pts.hip, pts.neck);
    const p = pts[joint];
    if (!p) throw new Error('pose: unknown pin joint ' + joint);
    return p;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Solve the limb ending at `key` (hdN/hdF: hand; anN/anF: ankle) so its end reaches `target`.
  function ik(pts, key, target, bend, view, f, sc) {
    const side = key.slice(-1);
    const isArm = key.startsWith('hd');
    const root = isArm ? pts['sh' + side] : pts['hp' + side];
    const L1 = isArm ? L.ua * sc('ua' + side) : L.th * sc('th' + side);
    const L2 = isArm ? L.fa * sc('fa' + side) + L.hand * 0.55 : L.sh * sc('sh' + side);
    const d = sub(target, root);
    const dist = clamp(len(d), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01);
    const base = angOf(d);
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const A = Math.acos(clamp(cosA, -1, 1)) / D2R;
    const flip = view !== 'side' && side === 'F' ? -1 : 1;
    const thU = base + bend * flip * A;
    const joint = add(root, mul(dir(thU), L1));
    const end = add(joint, mul(dir(angOf(sub(target, joint))), L2));
    if (isArm) {
      pts['el' + side] = joint;
      const handDir = angOf(sub(end, joint));
      pts['wr' + side] = add(joint, mul(dir(handDir), L.fa * sc('fa' + side)));
      pts['hd' + side] = add(pts['wr' + side], mul(dir(handDir), L.hand * sc('fa' + side)));
    } else {
      pts['kn' + side] = joint;
      pts['an' + side] = end;
      const thSH = angOf(sub(end, joint));
      footFrom(pts, side, thSH, f['l' + side + '.a'] || 0, f.$['flat' + side], view, 1, sc('ft' + side), f['l' + side + '.fd']);
    }
    pts['ikReach' + key] = len(sub(target, root)) <= L1 + L2 + 0.5;
  }

  /* ---------------------------------------------------------------- timeline */
  // A rep is a list of steps: { to: poseName, ms: travel time, hold: ms at the pose }.
  // The loop starts at the last step's pose, so it cycles without a jump.
  function timeline(move) {
    const steps = move.rep.map((s) => ({ to: s.to, ms: s.ms, hold: s.hold || 0 }));
    const total = steps.reduce((a, s) => a + s.ms + s.hold, 0);
    return { steps, total, start: steps[steps.length - 1].to };
  }

  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

  function flatPoses(move) {
    if (!move.$flat) {
      move.$flat = {};
      for (const [k, p] of Object.entries(move.poses)) move.$flat[k] = flatten(p, move.view || 'side');
    }
    return move.$flat;
  }

  // Pose lookup; "a~b~0.5" names a pose halfway between a and b (used for 1.5 reps).
  function poseByName(move, name) {
    const fp = flatPoses(move);
    if (fp[name]) return fp[name];
    const m = /^([^~]+)~([^~]+)~([\d.]+)$/.exec(name);
    if (!m || !fp[m[1]] || !fp[m[2]]) throw new Error('pose: unknown pose ' + name + ' in ' + move.id);
    fp[name] = mix(fp[m[1]], fp[m[2]], parseFloat(m[3]));
    return fp[name];
  }

  function sampleAt(move, tMs) {
    const tl = move.$tl || (move.$tl = timeline(move));
    const fp = new Proxy({}, { get: (_, k) => poseByName(move, k) });
    let t = ((tMs % tl.total) + tl.total) % tl.total;
    let from = tl.start;
    for (const s of tl.steps) {
      if (t < s.ms) return mix(fp[from], fp[s.to], ease(s.ms ? t / s.ms : 1));
      t -= s.ms;
      if (t < s.hold) return fp[s.to];
      t -= s.hold;
      from = s.to;
    }
    return fp[tl.start];
  }

  function frameAt(move, tMs) {
    return solve(move, sampleAt(move, tMs));
  }
  function framePose(move, name) {
    return solve(move, poseByName(move, name));
  }

  /* ---------------------------------------------------------------- muscles */
  // Bands drawn inside a segment: [segment, from, to, side] with side +1 front, -1 back, 0 middle.
  const MUSCLES_SIDE = {
    chest: [['torso', 0.08, 0.36, 1]], abs: [['torso', 0.42, 0.92, 1]], obliques: [['torso', 0.45, 0.9, 0]],
    upperBack: [['torso', 0.06, 0.38, -1]], lats: [['torso', 0.22, 0.62, -1]], lowerBack: [['torso', 0.62, 0.96, -1]],
    glutes: [['th', 0.0, 0.34, -1]], hipFlexors: [['th', 0.0, 0.25, 1]], quads: [['th', 0.12, 0.9, 1]],
    hamstrings: [['th', 0.3, 0.92, -1]], calves: [['sh', 0.1, 0.55, -1]],
    biceps: [['ua', 0.18, 0.86, 1]], triceps: [['ua', 0.14, 0.86, -1]], forearms: [['fa', 0.05, 0.6, 0]],
    frontDelts: [['ua', 0.0, 0.26, 1]], sideDelts: [['ua', 0.0, 0.3, 0]], rearDelts: [['ua', 0.0, 0.26, -1]],
  };
  const MUSCLES_FRONT = {
    chest: [['torso', 0.08, 0.36, 0]], abs: [['torso', 0.42, 0.92, 0]], obliques: [['torso', 0.45, 0.9, 0]],
    upperBack: [['torso', 0.06, 0.36, 0]], lats: [['torso', 0.2, 0.6, 0]], lowerBack: [['torso', 0.62, 0.96, 0]],
    glutes: [['th', 0.0, 0.3, 0]], hipFlexors: [['th', 0.0, 0.25, 0]], quads: [['th', 0.12, 0.9, 0]],
    hamstrings: [['th', 0.3, 0.92, 0]], calves: [['sh', 0.1, 0.55, 0]],
    biceps: [['ua', 0.18, 0.86, 0]], triceps: [['ua', 0.14, 0.86, 0]], forearms: [['fa', 0.05, 0.6, 0]],
    frontDelts: [['ua', 0.0, 0.3, 0]], sideDelts: [['ua', 0.0, 0.3, 0]], rearDelts: [['ua', 0.0, 0.3, 0]],
  };

  /* ---------------------------------------------------------------- geometry for drawing */
  // Each drawable segment: [id, fromJoint, toJoint, width, layer].
  function segments(move) {
    const front = move.view && move.view !== 'side';
    const armLayer = move.armLayer || (front ? 'front' : null);
    const legLayer = move.legLayer || (front ? 'back' : null);
    const segs = [];
    for (const s of ['F', 'N']) {
      const layerA = front ? armLayer : s === 'N' ? 'near' : 'far';
      const layerL = front ? legLayer : s === 'N' ? 'near' : 'far';
      segs.push(['th' + s, 'hp' + s, 'kn' + s, W.th, layerL, 'l' + s]);
      segs.push(['sh' + s, 'kn' + s, 'an' + s, W.sh, layerL, 'l' + s]);
      segs.push(['ft' + s, 'he' + s, 'to' + s, W.foot, layerL, 'l' + s]);
      segs.push(['ua' + s, 'sh' + s, 'el' + s, W.ua, layerA, 'a' + s]);
      segs.push(['fa' + s, 'el' + s, 'wr' + s, W.fa, layerA, 'a' + s]);
      segs.push(['hd' + s, 'wr' + s, 'hd' + s, W.hand, layerA, 'a' + s]);
    }
    segs.push(['torso', 'neck', 'hip', front ? W.torsoFront : W.torso, 'core', null]);
    segs.push(['neck', 'neck', 'head', W.neck, 'core', null]);
    if (front) segs.push(['shoulders', 'shF', 'shN', W.shoulders, 'core', null]);
    return segs;
  }

  function equipGrip(pts, side) {
    // Grip point sits a little way into the hand.
    const wr = pts['wr' + side];
    const hd = pts['hd' + side];
    return [lerp(wr[0], hd[0], 0.55), lerp(wr[1], hd[1], 0.55)];
  }

  // Equipment shapes for a frame: list of primitives {k:'circle'|'line'|'rect'|'poly', ...}.
  function equipment(move, pts) {
    const out = [];
    for (const e of move.equip || []) {
      const hands = e.hands === 'both' ? ['N', 'F'] : e.hands === 'N' || e.hands === 'F' ? [e.hands] : ['N'];
      if (e.type === 'db') {
        for (const s of hands) {
          const g = equipGrip(pts, s);
          const fa = angOf(sub(pts['wr' + s], pts['el' + s]));
          const layer = move.view && move.view !== 'side' ? move.armLayer || 'front' : s === 'N' ? 'near' : 'far';
          if (e.orient === 'side') {
            const ax = dir(fa + 90 + (e.tilt || 0));
            out.push({ k: 'db', a: add(g, mul(ax, -11)), b: add(g, mul(ax, 11)), layer });
          } else {
            out.push({ k: 'dbEnd', c: g, r: 5.2, layer });
          }
        }
      } else if (e.type === 'kb') {
        let g;
        if (pts.kb) g = pts.kb;
        else if (e.hands === 'both') g = mid(equipGrip(pts, 'N'), equipGrip(pts, 'F'));
        else g = equipGrip(pts, hands[0]);
        let c;
        if (pts.kb) c = pts.kb;
        else if (e.hold === 'arm') {
          const s = hands[0];
          c = add(g, mul(dir(angOf(sub(pts['wr' + s], pts['el' + s]))), 9));
        } else if (e.hold === 'chest') {
          const u = dir(angOf(sub(pts.hip, pts.neck)));
          const front = [u[1], -u[0]];
          c = add(add(pts.neck, mul(sub(pts.hip, pts.neck), 0.28)), mul(front, 13));
        } else if (e.hold === 'hip') {
          const u = dir(angOf(sub(pts.hip, pts.neck)));
          const front = [u[1], -u[0]];
          c = add(add(pts.neck, mul(sub(pts.hip, pts.neck), 0.95)), mul(front, 12));
        } else c = add(g, [0, 9]);
        const handle = e.hold === 'chest' || e.hold === 'hip' ? add(c, mul(dir(angOf(sub(pts.neck, pts.hip))), 8)) : g;
        out.push({ k: 'kb', c, r: 6.6, h: handle, layer: e.layer || 'front' });
      } else if (e.type === 'ball') {
        let c = pts.ball;
        if (!c) {
          const g = hands.length === 2 ? mid(equipGrip(pts, 'N'), equipGrip(pts, 'F')) : equipGrip(pts, hands[0]);
          const off = e.offset || [0, 0];
          c = add(g, off);
        }
        out.push({ k: 'ball', c, r: e.r || 8, layer: e.layer || 'front' });
      } else if (e.type === 'band' || e.type === 'towel') {
        const from = e.from ? (typeof e.from === 'string' ? pts[e.from] : e.from) : null;
        const grips = hands.map((s) => equipGrip(pts, s));
        if (e.between) out.push({ k: e.type, a: grips[0], b: grips[1] || grips[0], layer: e.layer || 'front' });
        else for (const g of grips) out.push({ k: e.type, a: from || g, b: g, layer: e.layer || 'front' });
      }
    }
    return out;
  }

  function props(move) {
    return move.props || [];
  }

  /* ---------------------------------------------------------------- bounds */
  function bounds(move, opts) {
    const o = opts || {};
    const tl = move.$tl || (move.$tl = timeline(move));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (p, r) => {
      if (!p || !isFinite(p[0])) return;
      x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r);
      y0 = Math.min(y0, p[1] - r); y1 = Math.max(y1, p[1] + r);
    };
    const N = 36;
    for (let i = 0; i < N; i++) {
      const pts = frameAt(move, (tl.total * i) / N);
      for (const [k, v] of Object.entries(pts)) if (Array.isArray(v)) take(v, k === 'head' ? L.head + 2 : 9);
      for (const e of equipment(move, pts)) {
        if (e.c) take(e.c, (e.r || 6) + 2);
        if (e.a) take(e.a, 6);
        if (e.b) take(e.b, 6);
        if (e.h) take(e.h, 4);
      }
    }
    for (const p of props(move)) {
      if (p.type === 'box' || p.type === 'table' || p.type === 'chair') { take([p.x, -(p.h || SEAT_H)], 2); take([p.x + p.w, 0], 2); }
      if (p.type === 'wall') { take([p.x, -150], 2); }
      if (p.type === 'bar') { take([p.x1, p.y], 3); take([p.x2, p.y], 3); }
      if (p.type === 'door') { take([p.x, -200], 2); take([p.x + 6, 0], 2); }
      if (p.type === 'mat') { take([p.x, -2], 1); take([p.x + p.w, 0], 1); }
    }
    const view = move.view || 'side';
    if (view !== 'top') { y1 = Math.max(y1, 0); }
    const pad = o.pad == null ? 10 : o.pad;
    let b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + (view === 'top' ? pad : 4) };
    // Keep a pleasant aspect so tall and wide moves render at a similar scale.
    const minW = 150, minH = 120;
    if (b.x1 - b.x0 < minW) { const c = (b.x0 + b.x1) / 2; b.x0 = c - minW / 2; b.x1 = c + minW / 2; }
    if (b.y1 - b.y0 < minH) { b.y0 = b.y1 - minH; }
    return b;
  }

  /* ---------------------------------------------------------------- rendering */
  const NS = 'http://www.w3.org/2000/svg';
  const f1 = (n) => Math.round(n * 10) / 10;

  // Mirror a point horizontally around x = 0 when drawing the lead side.
  const mx = (p, m) => (m ? [-p[0], p[1]] : p);

  function bandLine(a, b, w, from, to, side, mirrored) {
    const u = sub(b, a);
    const l = len(u) || 1;
    const n = [u[1] / l, -u[0] / l]; // anterior normal
    const inner = w - 2 * OUTLINE;
    const off = side === 0 ? 0 : side * inner / 4;
    const bw = side === 0 ? inner * 0.62 : inner / 2 - 0.3;
    const p0 = add(add(a, mul(u, from)), mul(n, off));
    const p1 = add(add(a, mul(u, to)), mul(n, off));
    return { a: mx(p0, mirrored), b: mx(p1, mirrored), w: Math.max(1.2, bw) };
  }

  // Everything the renderer draws for one frame, as plain data (used by DOM and string renderers).
  function drawList(move, pts, opts) {
    const o = opts || {};
    const mirrored = !!o.mirrored;
    const view = move.view || 'side';
    let P = pts;
    if (view === 'top') {
      // Top view: the frontal-plane figure lies on the floor, head to the right.
      const rot = (p) => [-p[1], p[0]];
      P = {};
      for (const [k, v] of Object.entries(pts)) P[k] = Array.isArray(v) ? rot(v) : v;
    }
    const segs = segments(move);
    const musclesMap = view === 'side' ? MUSCLES_SIDE : MUSCLES_FRONT;
    const working = new Set(move.muscles || []);
    const layers = { back: [], far: [], core: [], near: [], front: [] };
    const leadLimbs = new Set(o.lead ? move.leadLimbs || ['aN', 'lN'] : []);
    for (const [id, j0, j1, w, layer, limb] of segs) {
      const a = P[j0], b = P[j1];
      if (!a || !b) continue;
      const item = { id, a: mx(a, mirrored), b: mx(b, mirrored), w, lead: limb && leadLimbs.has(limb), bands: [] };
      const baseId = id.replace(/[NF]$/, '');
      const sideLetter = /[NF]$/.test(id) ? id.slice(-1) : null;
      // Bands are computed in drawn (possibly mirrored) space; mirroring flips which side is "front".
      // Unilateral moves highlight the working (near) limb only.
      for (const m of working) {
        for (const [seg, from, to, side] of musclesMap[m] || []) {
          if (seg !== baseId) continue;
          if (sideLetter && move.uni && sideLetter === 'F' && !(move.bilateralMuscles || []).includes(m)) continue;
          const [aa, bb] = seg === 'torso' ? [P.neck, P.hip] : [a, b];
          const s = mirrored ? -side : side;
          item.bands.push(bandLine(mx(aa, mirrored), mx(bb, mirrored), w, from, to, view === 'side' ? s : side, false));
        }
      }
      (layers[layer] || layers.core).push(item);
    }
    const head = { c: mx(P.head, mirrored), r: L.head, dir: P.headDir, mirrored };
    const eq = equipment(move, P).map((e) => {
      const r = Object.assign({}, e);
      for (const k of ['a', 'b', 'c', 'h']) if (r[k]) r[k] = mx(r[k], mirrored);
      return r;
    });
    return { layers, head, eq, view, mirrored };
  }

  function svgFor(move, opts) {
    const o = opts || {};
    const b = bounds(move);
    const mirrored = !!o.mirrored;
    const vb = mirrored ? { x0: -b.x1, x1: -b.x0, y0: b.y0, y1: b.y1 } : b;
    return { vb, mirrored };
  }

  function el(tag, attrs, parent) {
    const e = G.document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function propShapes(move, mirrored, vb) {
    const out = [];
    const view = move.view || 'side';
    const X = (x) => (mirrored ? -x : x);
    if (view !== 'top') out.push({ k: 'floor', x0: vb.x0, x1: vb.x1 });
    for (const p of props(move)) {
      if (p.type === 'box' || p.type === 'chair') {
        const h = p.h || SEAT_H;
        const x0 = Math.min(X(p.x), X(p.x + p.w));
        out.push({ k: 'box', x: x0, y: -h, w: p.w, h, back: p.back ? (mirrored ? -1 : 1) * p.back : 0, legs: p.type === 'chair' });
      } else if (p.type === 'table') {
        const h = p.h || 72;
        const x0 = Math.min(X(p.x), X(p.x + p.w));
        out.push({ k: 'table', x: x0, y: -h, w: p.w, h });
      } else if (p.type === 'wall') {
        out.push({ k: 'wall', x: X(p.x), side: (mirrored ? -1 : 1) * (p.side || 1) });
      } else if (p.type === 'bar') {
        out.push({ k: 'bar', x0: Math.min(X(p.x1), X(p.x2)), x1: Math.max(X(p.x1), X(p.x2)), y: p.y });
      } else if (p.type === 'door') {
        out.push({ k: 'door', x: X(p.x) });
      } else if (p.type === 'mat') {
        const x0 = Math.min(X(p.x), X(p.x + p.w));
        out.push({ k: 'mat', x: x0, w: p.w, y: p.y || 0, h: p.h || 60 });
      }
    }
    return out;
  }

  // Build an SVG element with persistent children, then update it per frame.
  function createFigure(move, opts) {
    const o = Object.assign({ mirrored: false, lead: false }, opts);
    const { vb, mirrored } = svgFor(move, o);
    const svg = el('svg', {
      class: 'fig' + (o.className ? ' ' + o.className : ''),
      viewBox: `${f1(vb.x0)} ${f1(vb.y0)} ${f1(vb.x1 - vb.x0)} ${f1(vb.y1 - vb.y0)}`,
      preserveAspectRatio: 'xMidYMax meet',
      role: 'img',
      'aria-label': o.label || move.name || 'Exercise diagram',
    });
    const gProps = el('g', { class: 'fig-props' }, svg);
    for (const p of propShapes(move, mirrored, vb)) drawProp(gProps, p);
    const gBody = el('g', { class: 'fig-body' }, svg);
    const nodes = { svg, move, o, vb, mirrored, groups: {}, items: {}, head: null, eq: [] };
    const order = ['back', 'far', 'core', 'near', 'front'];
    for (const ly of order) nodes.groups[ly] = el('g', { class: 'fig-layer fig-' + ly }, gBody);
    nodes.gEqBack = el('g', { class: 'fig-eq' }, nodes.groups.back);
    nodes.gEqFar = el('g', { class: 'fig-eq' }, nodes.groups.far);
    nodes.gEqNear = el('g', { class: 'fig-eq' }, nodes.groups.near);
    nodes.gEqFront = el('g', { class: 'fig-eq' }, nodes.groups.front);
    nodes.built = false;
    return nodes;
  }

  function drawProp(g, p) {
    if (p.k === 'floor') el('line', { class: 'fig-floor', x1: f1(p.x0), x2: f1(p.x1), y1: 0.8, y2: 0.8 }, g);
    else if (p.k === 'box') {
      el('rect', { class: 'fig-prop', x: f1(p.x), y: f1(p.y), width: f1(p.w), height: f1(p.h), rx: 5 }, g);
      if (p.back) {
        const bx = p.back > 0 ? p.x + p.w - 8 : p.x;
        el('rect', { class: 'fig-prop', x: f1(bx), y: f1(p.y - 42), width: 8, height: 44, rx: 4 }, g);
      }
    } else if (p.k === 'table') {
      el('rect', { class: 'fig-prop', x: f1(p.x), y: f1(p.y), width: f1(p.w), height: 5, rx: 2 }, g);
      el('line', { class: 'fig-prop-line', x1: f1(p.x + 5), x2: f1(p.x + 5), y1: f1(p.y + 5), y2: 0 }, g);
      el('line', { class: 'fig-prop-line', x1: f1(p.x + p.w - 5), x2: f1(p.x + p.w - 5), y1: f1(p.y + 5), y2: 0 }, g);
    } else if (p.k === 'wall') {
      el('rect', { class: 'fig-prop', x: f1(p.side > 0 ? p.x : p.x - 6), y: -170, width: 6, height: 170 }, g);
    } else if (p.k === 'bar') {
      el('line', { class: 'fig-bar', x1: f1(p.x0), x2: f1(p.x1), y1: f1(p.y), y2: f1(p.y) }, g);
    } else if (p.k === 'door') {
      el('rect', { class: 'fig-prop', x: f1(p.x), y: -200, width: 6, height: 200 }, g);
    } else if (p.k === 'mat') {
      el('rect', { class: 'fig-mat', x: f1(p.x), y: f1(p.y - p.h / 2), width: f1(p.w), height: f1(p.h), rx: 6 }, g);
    }
  }

  function updateFigure(nodes, pts) {
    const { move, o, mirrored } = nodes;
    const dl = drawList(move, pts, { mirrored, lead: o.lead });
    if (!nodes.built) {
      for (const [ly, items] of Object.entries(dl.layers)) {
        const g = nodes.groups[ly];
        const outline = el('g', { class: 'fig-outline' }, g);
        const fill = el('g', { class: 'fig-fill' }, g);
        const bands = el('g', { class: 'fig-bands' }, g);
        g.insertBefore(outline, g.firstChild);
        g.insertBefore(fill, outline.nextSibling);
        g.insertBefore(bands, fill.nextSibling);
        for (const it of items) {
          const lo = el('line', { 'stroke-width': it.w, class: it.lead ? 'lead' : '' }, outline);
          const lf = el('line', { 'stroke-width': Math.max(0.5, it.w - 2 * OUTLINE) }, fill);
          const bl = it.bands.map((bd) => el('line', { 'stroke-width': f1(bd.w) }, bands));
          nodes.items[it.id] = { lo, lf, bl };
        }
        if (ly === 'core') {
          nodes.head = {
            o: el('circle', { class: 'fig-head' }, outline),
            f: el('circle', { class: 'fig-head-fill' }, fill),
            eye: move.view === 'side' || !move.view ? el('circle', { class: 'fig-eye', r: 1.3 }, bands) : null,
          };
        }
      }
      for (const e of dl.eq) {
        const parent = e.layer === 'back' ? nodes.gEqBack : e.layer === 'far' ? nodes.gEqFar : e.layer === 'near' ? nodes.gEqNear : nodes.gEqFront;
        const g = el('g', { class: 'fig-' + e.k }, parent);
        if (e.k === 'db') {
          e.$ = { bar: el('line', { class: 'eq-handle' }, g), p1: el('line', { class: 'eq-plate' }, g), p2: el('line', { class: 'eq-plate' }, g) };
        } else if (e.k === 'dbEnd') {
          e.$ = { c: el('polygon', { class: 'eq-plate-end' }, g) };
        } else if (e.k === 'kb') {
          e.$ = { h: el('path', { class: 'eq-kb-handle' }, g), c: el('circle', { class: 'eq-kb' }, g) };
        } else if (e.k === 'ball') {
          e.$ = { c: el('circle', { class: 'eq-ball' }, g), s: el('path', { class: 'eq-ball-seam' }, g) };
        } else if (e.k === 'band' || e.k === 'towel') {
          e.$ = { l: el('line', { class: 'eq-' + e.k }, g) };
        }
        nodes.eq.push(e.$);
      }
      // Move equipment groups to the top of their layers so they draw over the limbs.
      for (const ly of ['back', 'far', 'near', 'front']) {
        const g = nodes.groups[ly];
        const eqg = ly === 'back' ? nodes.gEqBack : ly === 'far' ? nodes.gEqFar : ly === 'near' ? nodes.gEqNear : nodes.gEqFront;
        g.appendChild(eqg);
      }
      nodes.built = true;
    }
    for (const items of Object.values(dl.layers)) {
      for (const it of items) {
        const n = nodes.items[it.id];
        if (!n) continue;
        setLine(n.lo, it.a, it.b);
        setLine(n.lf, it.a, it.b);
        it.bands.forEach((bd, i) => n.bl[i] && setLine(n.bl[i], bd.a, bd.b));
      }
    }
    if (nodes.head) {
      const c = dl.head.c;
      for (const k of ['o', 'f']) {
        nodes.head[k].setAttribute('cx', f1(c[0])); nodes.head[k].setAttribute('cy', f1(c[1]));
      }
      nodes.head.o.setAttribute('r', f1(dl.head.r + OUTLINE / 2));
      nodes.head.f.setAttribute('r', f1(dl.head.r - OUTLINE / 2));
      if (nodes.head.eye) {
        const d = dir(dl.head.dir + 72);
        const e = add(c, mul([dl.mirrored ? -d[0] : d[0], d[1]], dl.head.r * 0.5));
        nodes.head.eye.setAttribute('cx', f1(e[0])); nodes.head.eye.setAttribute('cy', f1(e[1]));
      }
    }
    dl.eq.forEach((e, i) => {
      const $ = nodes.eq[i];
      if (!$) return;
      if (e.k === 'db') {
        setLine($.bar, e.a, e.b);
        const u = sub(e.b, e.a); const l = len(u) || 1; const n = mul(u, 1 / l);
        setLine($.p1, add(e.a, mul(n, 0)), add(e.a, mul(n, 6)));
        setLine($.p2, add(e.b, mul(n, -6)), add(e.b, mul(n, 0)));
      } else if (e.k === 'dbEnd') {
        const pts6 = [];
        for (let k = 0; k < 6; k++) { const d = dir(k * 60 + 30); pts6.push(f1(e.c[0] + d[0] * e.r) + ',' + f1(e.c[1] + d[1] * e.r)); }
        $.c.setAttribute('points', pts6.join(' '));
      } else if (e.k === 'kb') {
        $.c.setAttribute('cx', f1(e.c[0])); $.c.setAttribute('cy', f1(e.c[1])); $.c.setAttribute('r', e.r);
        const top = sub(e.h, e.c); const tl = len(top) || 1; const tu = mul(top, 1 / tl);
        const n = [tu[1], -tu[0]];
        const a = add(e.c, add(mul(tu, e.r * 0.55), mul(n, 5)));
        const b = add(e.c, add(mul(tu, e.r * 0.55), mul(n, -5)));
        const c1 = add(a, add(mul(tu, 7), mul(n, 0.5)));
        const c2 = add(b, add(mul(tu, 7), mul(n, -0.5)));
        $.h.setAttribute('d', `M${f1(a[0])} ${f1(a[1])}C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(b[0])} ${f1(b[1])}`);
      } else if (e.k === 'ball') {
        $.c.setAttribute('cx', f1(e.c[0])); $.c.setAttribute('cy', f1(e.c[1])); $.c.setAttribute('r', e.r);
        $.s.setAttribute('d', `M${f1(e.c[0] - e.r * 0.92)} ${f1(e.c[1] - 1)}Q${f1(e.c[0])} ${f1(e.c[1] + e.r * 0.55)} ${f1(e.c[0] + e.r * 0.92)} ${f1(e.c[1] - 1)}`);
      } else if ($.l) {
        setLine($.l, e.a, e.b);
      }
    });
  }

  function setLine(n, a, b) {
    n.setAttribute('x1', f1(a[0])); n.setAttribute('y1', f1(a[1]));
    n.setAttribute('x2', f1(b[0])); n.setAttribute('y2', f1(b[1]));
  }

  /* ---------------------------------------------------------------- animation controller */
  // mount(container, move, { lead, mirrored, reducedMotion, fps, poseName }) → controller
  function mount(container, move, opts) {
    const o = Object.assign({ fps: 30 }, opts);
    const nodes = createFigure(move, o);
    container.appendChild(nodes.svg);
    const tl = move.$tl || (move.$tl = timeline(move));
    let raf = 0, t0 = 0, playing = false, last = -1, offset = 0;
    const frameMs = 1000 / o.fps;
    const draw = (t) => updateFigure(nodes, frameAt(move, t));
    const keyPose = move.key || tl.steps[0].to;
    if (o.reducedMotion || o.static) {
      // Static: the end pose, with the start pose as a faint ghost behind it.
      addGhost(nodes, move, o);
      updateFigure(nodes, framePose(move, keyPose));
    } else draw(0);
    function loop(now) {
      if (!playing) return;
      if (!t0) t0 = now - offset;
      if (now - last >= frameMs - 1) { last = now; draw(now - t0); }
      raf = G.requestAnimationFrame(loop);
    }
    const ctl = {
      el: nodes.svg,
      play() { if (playing || o.reducedMotion || o.static) return; playing = true; t0 = 0; raf = G.requestAnimationFrame(loop); },
      pause() { playing = false; if (raf) G.cancelAnimationFrame(raf); raf = 0; },
      playOnce() {
        // Reduced motion: one rep on request, then back to the key pose.
        let start = 0;
        const step = (now) => {
          if (!start) start = now;
          const t = now - start;
          if (t >= tl.total) { updateFigure(nodes, framePose(move, keyPose)); return; }
          draw(t); G.requestAnimationFrame(step);
        };
        G.requestAnimationFrame(step);
      },
      destroy() { ctl.pause(); nodes.svg.remove(); },
      duration: tl.total,
    };
    return ctl;
  }

  function addGhost(nodes, move, o) {
    const tl = move.$tl || (move.$tl = timeline(move));
    const ghostPose = tl.start === (move.key || tl.steps[0].to) ? tl.steps[0].to : tl.start;
    const g = createFigure(move, Object.assign({}, o, { className: 'ghost' }));
    updateFigure(g, framePose(move, ghostPose));
    const body = g.svg.querySelector('.fig-body');
    body.setAttribute('class', 'fig-body fig-ghost');
    nodes.svg.insertBefore(body, nodes.svg.querySelector('.fig-body'));
  }

  // A static SVG (for thumbnails): the key pose, optional ghost.
  function thumb(container, move, opts) {
    return mount(container, move, Object.assign({}, opts, { static: true }));
  }

  // One named keyframe, no animation (contact sheets, tests).
  function still(container, move, poseName, opts) {
    const nodes = createFigure(move, opts || {});
    container.appendChild(nodes.svg);
    updateFigure(nodes, framePose(move, poseName));
    return nodes.svg;
  }

  GH.pose = { L, W, SEAT_H, dir, flatten, mix, solve, timeline, sampleAt, frameAt, framePose, poseByName, bounds, equipment, drawList, segments, mount, thumb, still, MUSCLES_SIDE, MUSCLES_FRONT };
})(typeof window !== 'undefined' ? window : globalThis);
