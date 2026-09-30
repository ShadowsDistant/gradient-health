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
 *
 * Pins and IK targets can also name body points: 'grip' (between the hands), 'traps' (a bar on the
 * upper back), 'lap' (a bar across the hips), 'butt', 'back'. `ik: { hdN: 'traps' }` keeps the
 * hands on that point in every frame. Gym props and held equipment are documented at gymGeom,
 * machineGeom and equipment below.
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
  // Where a barbell sits on the body (side view): 'traps' is TRAPS[0] behind the neck point and
  // TRAPS[1] down the torso (back squat); 'lap' is LAP in front of the hip joint (hip thrust).
  const TRAPS = [12.5, 3];
  const LAP = 14;

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
    // A flat foot as a number, so a foot rolls between flat and pointed instead of snapping.
    f['lN.fl'] = lN.flat !== false ? 1 : 0; f['lF.fl'] = lF.flat !== false ? 1 : 0;
    for (const [k, v] of Object.entries(p.sc || {})) f['sc.' + k] = v;
    const ikT = Object.assign({}, p.ik);
    // In side view both limbs overlap: unless the far limb is posed on its own, it follows the
    // near limb's IK target (both hands on the floor, both feet planted).
    if (view === 'side' || !view) {
      if (ikT.anN && !ikT.anF && !p.lF) ikT.anF = ikT.anN;
      if (ikT.hdN && !ikT.hdF && !p.aF) ikT.hdF = ikT.hdN;
    }
    // A target can also name a body point ('traps', 'lap': a bar on the back or across the hips),
    // so the hands stay on the bar in every in-between frame.
    // A third number is the target's depth (front view: toward the viewer; side view: toward the
    // near side). The flat figure ignores it; the 3D figure reaches there, and a front-view hand
    // behind the body is drawn behind it.
    const ikTo = {};
    for (const [k, v] of Object.entries(ikT)) {
      if (typeof v === 'string') { ikTo[k] = v; continue; }
      f['ik.' + k + '.x'] = v[0]; f['ik.' + k + '.y'] = v[1];
      if (typeof v[2] === 'number') f['ik.' + k + '.z'] = v[2];
    }
    // Per-pose pole: which way an IK elbow or knee points in this pose ([x, y] as for move.bend, or
    // [out, down, forward] for a hand reaching a target with depth), tweened between poses so the
    // joint turns smoothly as the reach changes.
    for (const [k, v] of Object.entries(p.pole || {})) {
      f['pole.' + k + '.x'] = v[0]; f['pole.' + k + '.y'] = v[1];
      if (typeof v[2] === 'number') f['pole.' + k + '.z'] = v[2];
    }
    // Depth of arm joints drawn by angle (front view: + toward the viewer), e.g. { elN, wrN }: the 3D
    // figure puts them there, and the flat one draws a hand behind the body behind it.
    for (const [k, v] of Object.entries(p.depth || {})) if (typeof v === 'number') f['depth.' + k] = v;
    for (const k of ['ball', 'kb', 'db', 'at']) if (p[k]) { f[k + '.x'] = p[k][0]; f[k + '.y'] = p[k][1]; }
    // Non-numeric flags travel along unchanged.
    f.$ = { flatN: lN.flat !== false, flatF: lF.flat !== false, pin: p.pin, view };
    if (Object.keys(ikTo).length) f.$.ikTo = ikTo;
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
      footFrom(pts, side, thSH, l('a'), flatOf(f, side), view, mirror, sc('ft' + side), l('fd'));
    }
    // Pin one joint to its surface.
    const pin = f.$.pin || move.pin || { joint: 'anN', at: [0, -8] };
    const at = 'at.x' in f ? [f['at.x'], f['at.y']] : pin.at;
    const cur = pinPoint(pts, pin.joint);
    const off = sub(at, cur);
    for (const k of Object.keys(pts)) if (Array.isArray(pts[k])) pts[k] = add(pts[k], off);
    // 2-bone IK for planted hands/feet (targets are in world coordinates, or a named body point).
    const ikTo = f.$.ikTo || {};
    for (const [key, bend] of [['hdN', -1], ['hdF', -1], ['anN', 1], ['anF', 1]]) {
      const tk = 'ik.' + key;
      const pk = 'pole.' + key;
      const bd = (pk + '.x') in f ? [f[pk + '.x'], f[pk + '.y']] : move.bend && move.bend[key] != null ? move.bend[key] : bend;
      if (ikTo[key]) ik(pts, key, pinPoint(pts, ikTo[key]), bd, view, f, sc);
      else if ((tk + '.z') in f && view === 'front' && key[0] === 'h') {
        const pole = (pk + '.z') in f ? [f[pk + '.x'], f[pk + '.y'], f[pk + '.z']] : null;
        reach3(pts, key, [f[tk + '.x'], f[tk + '.y'], f[tk + '.z']], pole);
      } else if ((tk + '.x') in f) ik(pts, key, [f[tk + '.x'], f[tk + '.y']], bd, view, f, sc);
    }
    // Arms drawn by angle with the depths the pose gives (+ toward the viewer).
    for (const s of ['N', 'F']) {
      if (!(('depthhd' + s) in pts) && ('depth.wr' + s) in f) {
        pts['depthwr' + s] = pts['depthhd' + s] = f['depth.wr' + s];
        if (('depth.el' + s) in f) pts['depthel' + s] = f['depth.el' + s];
      }
    }
    // Free objects (a ball in flight, a bell around the head).
    for (const k of ['ball', 'kb', 'db']) if ((k + '.x') in f) pts[k] = [f[k + '.x'], f[k + '.y']];
    return pts;
  }

  // How flat a foot is (1 flat, 0 pointed), tweened between poses.
  const flatOf = (f, side) => ('l' + side + '.fl' in f ? clamp(f['l' + side + '.fl'], 0, 1) : f.$['flat' + side] ? 1 : 0);
  // Blend two directions in degrees the short way round.
  const blendDeg = (a, b, t) => a + (((((b - a) % 360) + 540) % 360) - 180) * t;

  function footFrom(pts, side, thSH, ankle, flat, view, mirror, scale, fixedDir) {
    const an = pts['an' + side];
    let thFoot;
    const w = typeof flat === 'number' ? flat : flat ? 1 : 0;
    if (typeof fixedDir === 'number') thFoot = fixedDir;
    else if (view === 'side') thFoot = blendDeg(thSH + 90 - ankle, 90, w);
    else thFoot = blendDeg(thSH - mirror * ankle * 0.2, 0, w);
    const footLen = view === 'side' ? L.foot : 6;
    pts['to' + side] = add(an, mul(dir(thFoot), footLen * scale));
    pts['he' + side] = add(an, mul(dir(thFoot), view === 'side' ? -L.heel : 0));
    pts['footDir' + side] = thFoot;
  }

  function pinPoint(pts, joint) {
    if (joint === 'butt') return add(pts.hip, [0, 8]);
    if (joint === 'back') return mid(pts.hip, pts.neck);
    // Between the hands (a bar held in both).
    if (joint === 'grip') return mid(equipGrip(pts, 'N'), equipGrip(pts, 'F'));
    // A barbell resting on the upper back, or across the hip crease (side view).
    if (joint === 'traps' || joint === 'lap') {
      const u = mul(sub(pts.neck, pts.hip), 1 / (len(sub(pts.neck, pts.hip)) || 1)); // hip → neck
      const post = [u[1], -u[0]]; // posterior normal
      return joint === 'traps' ? add(add(pts.neck, mul(post, TRAPS[0])), mul(u, -TRAPS[1])) : add(pts.hip, mul(post, -LAP));
    }
    const p = pts[joint];
    if (!p) throw new Error('pose: unknown pin joint ' + joint);
    return p;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Solve the limb ending at `key` (hdN/hdF: hand; anN/anF: ankle) so its end reaches `target`.
  // bend: which way the middle joint goes, 1 or -1 (the side of the root → target line), or a
  // direction [x, y] to point it toward (x outward from the body in front and top views, forward in
  // side view; y down), which picks whichever of the two solutions lies more that way.
  function ik(pts, key, target, bend, view, f, sc) {
    const side = key.slice(-1);
    const isArm = key.startsWith('hd');
    const root = isArm ? pts['sh' + side] : pts['hp' + side];
    const L1 = isArm ? L.ua * sc('ua' + side) : L.th * sc('th' + side);
    // The grip sits 55% into the hand, which scales with the forearm.
    const L2 = isArm ? (L.fa + L.hand * 0.55) * sc('fa' + side) : L.sh * sc('sh' + side);
    const d = sub(target, root);
    const dist = clamp(len(d), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01);
    const base = angOf(d);
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const A = Math.acos(clamp(cosA, -1, 1)) / D2R;
    const flip = view !== 'side' && side === 'F' ? -1 : 1;
    let b = bend;
    if (Array.isArray(bend)) {
      const pole = [bend[0] * flip, bend[1]];
      const toward = (th) => { const u = dir(th); return u[0] * pole[0] + u[1] * pole[1]; };
      b = toward(base + A) >= toward(base - A) ? 1 : -1;
    } else b = bend * flip;
    const thU = base + b * A;
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
      footFrom(pts, side, thSH, f['l' + side + '.a'] || 0, flatOf(f, side), view, 1, sc('ft' + side), f['l' + side + '.fd']);
    }
    pts['ikReach' + key] = len(sub(target, root)) <= L1 + L2 + 0.5;
  }

  // A front-view hand reaching a target with depth T = [x, y, z] (z toward the viewer): a real 3D
  // two-bone reach from the shoulder, the elbow toward `pole` ([out, down, forward]; default out,
  // down and a little forward), drawn as its projection. The arm foreshortens as it comes toward
  // the viewer and, unlike a flat reach, its elbow can't flip when the hand passes the shoulder.
  // The joints' depths go to pts.depth{el,wr,hd}N/F for the 3D figure and the draw order.
  function reach3(pts, key, T, pole) {
    const side = key.slice(-1);
    const sg = side === 'N' ? 1 : -1;
    const S = [pts['sh' + side][0], pts['sh' + side][1], 0];
    const p = pole || [1, 0.5, 0.4];
    const P = [sg * p[0], p[1], p[2]];
    const L1 = L.ua, L2 = L.fa + L.hand * 0.55;
    const d = [T[0] - S[0], T[1] - S[1], T[2] - S[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const dist = clamp(l, Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01);
    const dn = d.map((v) => v / l);
    const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    const pd = P[0] * dn[0] + P[1] * dn[1] + P[2] * dn[2];
    let pv = P.map((v, i) => v - pd * dn[i]);
    let pl = Math.hypot(pv[0], pv[1], pv[2]);
    if (pl < 1e-6) { pv = [dn[1], -dn[0], 0]; pl = Math.hypot(pv[0], pv[1]) || 1; }
    const E = S.map((v, i) => v + dn[i] * x + (pv[i] / pl) * h);
    const e = [T[0] - E[0], T[1] - E[1], T[2] - E[2]];
    const el = Math.hypot(e[0], e[1], e[2]) || 1;
    const Wr = E.map((v, i) => v + (e[i] / el) * L.fa);
    const Hd = Wr.map((v, i) => v + (e[i] / el) * L.hand);
    pts['el' + side] = [E[0], E[1]]; pts['wr' + side] = [Wr[0], Wr[1]]; pts['hd' + side] = [Hd[0], Hd[1]];
    pts['depthel' + side] = E[2]; pts['depthwr' + side] = Wr[2]; pts['depthhd' + side] = T[2];
    pts['ikReach' + key] = l <= L1 + L2 + 0.5;
  }

  /* ---------------------------------------------------------------- timeline */
  // A rep is a list of steps: { to: poseName, ms: travel time, hold: ms at the pose, through }.
  // Each step eases to a stop at its pose, unless `through` (a via point on a curved path: the
  // motion carries on through it, as with move.flow) and it has no hold.
  // The loop starts at the last step's pose, so it cycles without a jump.
  function timeline(move) {
    const steps = move.rep.map((s) => ({ to: s.to, ms: s.ms, hold: s.hold || 0, through: !!s.through }));
    const total = steps.reduce((a, s) => a + s.ms + s.hold, 0);
    return { steps, total, start: steps[steps.length - 1].to };
  }

  const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

  function flatPoses(move) {
    if (!move.$flat) {
      move.$flat = {};
      for (const [k, p] of Object.entries(move.poses)) move.$flat[k] = flatten(p, move.view || 'side');
      // A drawn scale or a pin offset that only some poses name holds its default in the others,
      // so it tweens on the way to a pose that doesn't name it instead of jumping when it arrives.
      const all = Object.values(move.$flat);
      const pinAt = move.pin && move.pin.at;
      for (const f of all) {
        for (const g of all) {
          for (const k of Object.keys(g)) {
            if (k in f) continue;
            if (k.startsWith('sc.')) f[k] = 1;
            else if ((k === 'at.x' || k === 'at.y') && pinAt) f[k] = pinAt[k === 'at.x' ? 0 : 1];
          }
        }
      }
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

  // move.flow: the rep is one continuous path through its keyframes (a spline timed by each step)
  // instead of easing to a stop at every one; a keyframe with a hold still stops there. For circles
  // and other motions that never pause, like a halo.
  function sampleAt(move, tMs) {
    const tl = move.$tl || (move.$tl = timeline(move));
    const fp = new Proxy({}, { get: (_, k) => poseByName(move, k) });
    let t = ((tMs % tl.total) + tl.total) % tl.total;
    let from = tl.start;
    const n = tl.steps.length;
    for (let i = 0; i < n; i++) {
      const s = tl.steps[i];
      if (t < s.ms) {
        const u = s.ms ? t / s.ms : 1;
        const before = tl.steps[(i - 1 + n) % n];
        const glideIn = (move.flow || before.through) && !before.hold, glideOut = (move.flow || s.through) && !s.hold;
        return glideIn || glideOut ? flowMix(move, tl, i, u, glideIn, glideOut) : mix(fp[from], fp[s.to], ease(u));
      }
      t -= s.ms;
      if (t < s.hold) return fp[s.to];
      t -= s.hold;
      from = s.to;
    }
    return fp[tl.start];
  }

  // Step i of a flowing rep at u (0..1): a cubic Hermite spline through the keyframes whose
  // tangents are Catmull-Rom's, measured in time, so the speed carries smoothly through each one.
  // Angles go the short way round between neighbouring keyframes (a limb can circle all the way).
  const ANGLE_KEY = /^(t|n|tw|[al][NF]\.(s|e|w|h|k|a|fd))$/;
  const nearDeg = (ref, a) => ref + (((((a - ref) % 360) + 540) % 360) - 180);
  function flowMix(move, tl, i, u, glideIn = true, glideOut = true) {
    const st = tl.steps, n = st.length;
    const at = (j) => st[((j % n) + n) % n];
    const pose = (j) => poseByName(move, at(j).to);
    const p0 = pose(i - 2), p1 = pose(i - 1), p2 = pose(i), p3 = pose(i + 1);
    const d0 = at(i - 1).ms || 1, d1 = at(i).ms || 1, d2 = at(i + 1).ms || 1;
    // Tangent (per ms) at the start and end keyframes; zero where the rep stops there.
    const k1 = !glideIn || at(i - 1).hold > 0 ? 0 : 1 / (d0 + d1);
    const k2 = !glideOut || at(i).hold > 0 ? 0 : 1 / (d1 + d2);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const out = {};
    for (const k of Object.keys(p1)) {
      if (k === '$') continue;
      const a = p1[k];
      if (!(k in p0) || !(k in p3) || !(k in p2)) { out[k] = lerp(a, k in p2 ? p2[k] : a, ease(u)); continue; }
      let q0 = p0[k], b = p2[k], q3 = p3[k];
      if (ANGLE_KEY.test(k)) { q0 = nearDeg(a, q0); b = nearDeg(a, b); q3 = nearDeg(b, q3); }
      const m1 = (b - q0) * k1 * d1, m2 = (q3 - a) * k2 * d1;
      out[k] = h00 * a + h10 * m1 + h01 * b + h11 * m2;
    }
    for (const k of Object.keys(p2)) if (!(k in out) && k !== '$') out[k] = p2[k];
    out.$ = Object.assign({}, u < 0.5 ? p1.$ : p2.$, { pin: p1.$.pin || p2.$.pin });
    return out;
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
  // Held gym equipment (move.equip entries, hands: 'both' | 'N' | 'F'):
  //   bb, ez  { r, hold } Barbell / EZ bar, seen end-on in side view, centred between the grips
  //           (hands 'both') or on a body point: hold 'traps' (on the upper back) or 'lap' (across
  //           the hip crease). r: plate radius (bb 22.5 = a 45 cm plate, ez 13; 0 = a bare bar, e.g.
  //           a cable bar attachment).
  //   handle  { shared } Cable D-handle in each hand; shared: true is one handle held in both
  //           (V-bar row, Pallof press). Its clip is 8 from the grip, toward the pulley.
  //   rope    Cable rope in both hands; clip 15 from the grips toward the pulley, knobs past them.
  //   latbar  Wide pulldown bar, centred between the grips (end-on in side view).
  function equipment(move, pts) {
    const out = [];
    for (const e of move.equip || []) {
      const hands = e.hands === 'both' ? ['N', 'F'] : e.hands === 'N' || e.hands === 'F' ? [e.hands] : ['N'];
      if (e.type === 'db' && e.hold === 'feet') {
        // Squeezed between the feet (a lying leg curl): end-on across the arches.
        const arch = (s) => [lerp(pts['an' + s][0], pts['to' + s][0], 0.45), lerp(pts['an' + s][1], pts['to' + s][1], 0.45)];
        out.push({ k: 'dbEnd', c: mid(arch('N'), arch('F')), r: 5.2, layer: 'front' });
      } else if (e.type === 'db') {
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
        // Bottom up, held by the horns: the bell sits above the hands on its handle.
        else if (e.hold === 'horns') c = add(g, [0, -7]);
        // Racked (a one-arm press): at the shoulder the bell hangs on the outside of the forearm (in
        // line with it from the side); pressed overhead it rests on the back of the forearm, behind
        // and below the fist.
        else if (e.hold === 'rack') {
          const s = hands[0];
          const u = dir(angOf(sub(pts['wr' + s], pts['el' + s])));
          const up = clamp((pts['sh' + s][1] - pts['wr' + s][1] - 10) / 35, 0, 1);
          c = add(g, add(mul([u[1], -u[0]], 6 * up), [0, 8.5 - 2 * up]));
        } else if (e.hold === 'arm') {
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
        out.push({ k: 'kb', c, r: 6.6, h: handle, layer: behind(move, pts, hands) ? 'far' : e.layer || 'front' });
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
      } else if (e.type === 'bb' || e.type === 'ez') {
        // Barbell or EZ bar, seen end-on in side view: the plate behind the body, the bar end at
        // the grip (or at the body point named by `hold`: 'traps' on the back, 'lap' on the hips).
        const c = e.hold ? pinPoint(pts, e.hold) : hands.length === 2 ? mid(equipGrip(pts, 'N'), equipGrip(pts, 'F')) : equipGrip(pts, hands[0]);
        const r = e.r != null ? e.r : e.type === 'bb' ? 22.5 : 13;
        if (r > 0) out.push({ k: 'plate', c, r, layer: 'back' });
        out.push({ k: 'barEnd', c, r: 2.3, layer: e.layer || 'front' });
      } else if (ATTACH[e.type] != null) {
        attachmentShapes(move, pts, e, hands, out);
      }
    }
    return out;
  }

  function props(move) {
    return move.props || [];
  }

  // Front and top views: hands whose targets name a depth behind the body (a bell passing behind
  // the head) draw behind the head and torso, with what they hold.
  function behind(move, pts, sides) {
    if ((move.view || 'side') === 'side') return false;
    const z = sides.map((s) => pts['depthhd' + s]).filter((v) => v != null);
    return z.length > 0 && z.reduce((a, b) => a + b, 0) / z.length < -2;
  }

  /* ---------------------------------------------------------------- gym: cables and attachments */
  // How far a cable attachment's clip sits from the grip, toward the pulley.
  const ATTACH = { handle: 8, rope: 15, latbar: 0 };
  const unit = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
  const sideLayer = (move, s) => (move.view && move.view !== 'side' ? move.armLayer || 'front' : s === 'N' ? 'near' : 'far');
  function heldBy(move, side) {
    return (move.equip || []).find((e) => (ATTACH[e.type] != null || ((e.type === 'bb' || e.type === 'ez') && e.r === 0))
      && (e.hands === 'both' || e.hands === side || (!e.hands && side === 'N')));
  }
  // Every cable in the move: from a tower's pulley (or the pulldown's top pulley) to the clip of the
  // attachment in that hand. One attachment held in both hands (rope, bar, a shared handle) gets one
  // cable; two separate handles get one each.
  function cableRuns(move, pts) {
    const runs = [];
    for (const p of props(move)) {
      let pulley, to;
      if (p.type === 'cable') { pulley = [p.x, p.y]; to = p.to || 'both'; } else if (p.type === 'machine' && p.kind === 'pulldown') { pulley = p.pulley; to = 'both'; } else continue;
      const sides = to === 'both' ? ['N', 'F'] : [to.slice(-1)];
      const e0 = heldBy(move, sides[0]);
      const shared = !e0 || (e0.hands === 'both' && (e0.type !== 'handle' || e0.shared));
      const groups = sides.length === 2 && shared ? [sides] : sides.map((s) => [s]);
      for (const g of groups) {
        const e = heldBy(move, g[0]);
        const grip = g.length === 2 ? mid(equipGrip(pts, 'N'), equipGrip(pts, 'F')) : equipGrip(pts, g[0]);
        const u = unit(sub(pulley, grip));
        runs.push({ pulley, grip, u, e, sides: g, clip: add(grip, mul(u, e ? ATTACH[e.type] || 0 : 0)), layer: p.layer || 'back' });
      }
    }
    return runs;
  }
  // Drawn attachments: a D-handle (triangle to its clip), a rope (strands from the clip to the
  // hands, knobs at the ends) or a lat bar (seen end-on).
  function attachmentShapes(move, pts, e, hands, out) {
    const runs = cableRuns(move, pts);
    const runFor = (s) => runs.find((r) => r.e === e && r.sides.includes(s));
    const shared = e.type !== 'handle' || e.shared || hands.length === 1;
    const groups = shared ? [hands] : hands.map((s) => [s]);
    for (const g of groups) {
      const grip = g.length === 2 ? mid(equipGrip(pts, 'N'), equipGrip(pts, 'F')) : equipGrip(pts, g[0]);
      const run = runFor(g[0]);
      const u = run ? run.u : [0, -1];
      const layer = e.layer || (g.length === 2 ? (move.view && move.view !== 'side' ? move.armLayer || 'front' : 'near') : sideLayer(move, g[0]));
      if (e.type === 'handle') {
        const n = [u[1], -u[0]];
        out.push({ k: 'dhandle', pts: [add(grip, mul(n, 4.4)), add(grip, mul(u, ATTACH.handle)), add(grip, mul(n, -4.4))], layer });
      } else if (e.type === 'rope') {
        const clip = add(grip, mul(u, ATTACH.rope));
        for (const s of hands) {
          const end = add(equipGrip(pts, s), mul(u, -2.6));
          out.push({ k: 'rope', a: clip, b: end, layer });
          out.push({ k: 'knob', c: add(end, mul(u, -1.4)), r: 2.5, layer });
        }
      } else if (e.type === 'latbar') {
        out.push({ k: 'barEnd', c: grip, r: 2.6, layer: 'front' });
      }
    }
  }

  /* ---------------------------------------------------------------- gym: props and machines */
  // Static prop geometry in world coordinates, as simple shapes plus the support surfaces the body
  // rests on (used by the tests). Shapes: pad {a, b, w} (an upholstered capsule), tube {a, b, w}
  // (frame), gbar {a, b} (a gripped bar), rect {x, y, w, h, rx, cls}, circ {c, r, cls},
  // pline {pts} (a hook), cable {a, b}. Surfaces: {a, b, n} with n the unit normal toward the body.
  //
  //   bench     { x, w, h, incline = 0, back = -1, seat = 36, end = false }
  //             Pad top at height h (the pad is 9 thick). Flat: the pad runs x..x+w. Adjustable
  //             (incline > 0, degrees above horizontal): the seat (length `seat`) sits at the end
  //             away from the backrest; the backrest (length w - seat) hinges at the seat and rises
  //             toward the `back` end (-1: toward -x, you sit facing +x; 1: toward +x, e.g. chest on
  //             the pad). end: true draws the bench end-on (its length runs across the view), x..x+w
  //             being the pad's width. Top view: a 30 wide pad from x to x+w under the spine.
  //   rack      { x, h, d = 105, top = 205, face, safety } Upright at x with a J-hook at height h
  //             opening toward the lifter (face: -1 toward -x, 1 toward +x; default: toward x = 0);
  //             a second upright d further on that side, joined at the top (d: 0 for one upright,
  //             e.g. a bench press station); optional safety arms at height `safety`.
  //   smith     { x, h, top } Guide rail at x (the bar's vertical path), bar hooks at height h, rail
  //             top at `top` (default h + 48, 172..210).
  //   cable     { x, y, to: 'hdN'|'hdF'|'both', face, top, layer } Cable tower: pulley centred at
  //             (x, y) (y < 0: y = -height), the column 7 behind it on the side away from the lifter
  //             (face: 1 the pulley faces +x; default: faces x = 0), top at max(-y + 16, 178). The
  //             cable runs to the clip of the attachment in that hand, or of the one held in both
  //             (see cableRuns); layer 'front' draws it over the body (it crosses in front).
  //   dip       { x, h, len = 56 } Two parallel bars at height h running along the view (one each
  //             side of the body), centred on x, on posts at both ends.
  //   machine   { kind, ... } see machineGeom.
  //   rower     { x, h = 36, fy = -26 } Footplate surface through (x, fy), tilted 45° (toes up and
  //             forward); seat top at height h, the seat slides under the hip (hip 9 above it);
  //             flywheel housing centred at (x + 50, -46), r 24; the chain leaves it at (x + 27, -54)
  //             and runs to the handle between the hands.
  //   bike      { x, y = -30, crank = 17, h, sx, bar: [x, y] } Spin bike: crank axle at (x, y),
  //             saddle top at height h centred on sx (hip 9 above it), handlebar grip at `bar`,
  //             flywheel in front. Each crank points from the axle to the ball of that foot (ankle
  //             + 9 along the foot + 3.5 toward the sole) and is `crank` long.
  //   treadmill { x, w, h = 20, incline = 0 } Belt surface from (x, -h) rising at `incline` degrees
  //             to x + w (the foot line rides 5.5 above it); console and rails at the front end.
  const PAD = 9;
  function benchGeom(p, view) {
    const S = [], surf = [];
    const h = p.h || SEAT_H;
    const x0 = p.x, x1 = p.x + p.w;
    if (view === 'top') {
      S.push({ k: 'rect', x: x0, y: -15, w: p.w, h: 30, rx: 7, cls: 'fig-mat' });
      return { shapes: S, surfaces: surf };
    }
    if (p.end) {
      const cx = (x0 + x1) / 2;
      S.push({ k: 'tube', a: [cx, -h + PAD], b: [cx, -2] });
      S.push({ k: 'tube', a: [x0 - 6, -1.5], b: [x1 + 6, -1.5] });
      S.push({ k: 'pad', a: [x0 + PAD / 2, -h + PAD / 2], b: [x1 - PAD / 2, -h + PAD / 2], w: PAD });
      surf.push({ a: [x0, -h], b: [x1, -h], n: [0, -1] });
      return { shapes: S, surfaces: surf };
    }
    const inc = p.incline || 0;
    if (!inc) {
      for (const [top, foot] of [[x0 + 16, x0 + 9], [x1 - 16, x1 - 9]]) {
        S.push({ k: 'tube', a: [top, -h + PAD], b: [foot, -1.5] });
        S.push({ k: 'tube', a: [foot - 8, -1.5], b: [foot + 8, -1.5] });
      }
      S.push({ k: 'pad', a: [x0 + PAD / 2, -h + PAD / 2], b: [x1 - PAD / 2, -h + PAD / 2], w: PAD });
      surf.push({ a: [x0, -h], b: [x1, -h], n: [0, -1] });
      return { shapes: S, surfaces: surf };
    }
    const back = p.back || -1;
    const seat = p.seat || 36;
    const hx = back < 0 ? x1 - seat : x0 + seat; // hinge
    const sEnd = back < 0 ? x1 : x0; // front edge of the seat
    const sd = -back; // from the hinge toward the seat's front edge
    const hinge = [hx, -h];
    const db = [back * Math.cos(inc * D2R), -Math.sin(inc * D2R)]; // along the backrest, upward
    const nb = [-back * Math.sin(inc * D2R), -Math.cos(inc * D2R)]; // backrest normal, toward the body
    const L2 = p.w - seat;
    // Frame: a spine on the floor, the front leg, the seat post and the backrest's ladder strut.
    const bEnd = back < 0 ? x0 : x1;
    S.push({ k: 'tube', a: [sEnd - sd * 6, -1.5], b: [bEnd + sd * 6, -1.5] });
    S.push({ k: 'tube', a: [sEnd - sd * 10, -h + PAD], b: [sEnd - sd * 4, -1.5] });
    S.push({ k: 'tube', a: [hx + sd * 6, -h + PAD], b: [hx + sd * 2, -1.5] });
    const strut = add(add(hinge, mul(db, L2 * 0.45)), mul(nb, -PAD));
    S.push({ k: 'tube', a: strut, b: [hx - sd * Math.max(18, L2 * 0.55 * Math.cos(inc * D2R)), -1.5] });
    S.push({ k: 'pad', a: [hx + sd * (1.5 + PAD / 2), -h + PAD / 2], b: [sEnd - sd * PAD / 2, -h + PAD / 2], w: PAD });
    S.push({ k: 'pad', a: add(add(hinge, mul(db, 1.5 + PAD / 2)), mul(nb, -PAD / 2)), b: add(add(hinge, mul(db, L2 - PAD / 2)), mul(nb, -PAD / 2)), w: PAD });
    surf.push({ a: hinge, b: [sEnd, -h], n: [0, -1] });
    surf.push({ a: hinge, b: add(hinge, mul(db, L2)), n: nb });
    return { shapes: S, surfaces: surf };
  }

  // A seat with a backrest hinged at its rear corner (machines): seat forward from `hinge`,
  // backrest rising backward at `ang` degrees above horizontal.
  function seatWithBack(S, surf, hinge, seat, ang, blen) {
    const db = [-Math.cos(ang * D2R), -Math.sin(ang * D2R)];
    const nb = [Math.sin(ang * D2R), -Math.cos(ang * D2R)];
    S.push({ k: 'pad', a: [hinge[0] + 1.5 + PAD / 2, hinge[1] + PAD / 2], b: [hinge[0] + seat - PAD / 2, hinge[1] + PAD / 2], w: PAD });
    S.push({ k: 'pad', a: add(add(hinge, mul(db, 1.5 + PAD / 2)), mul(nb, -PAD / 2)), b: add(add(hinge, mul(db, blen - PAD / 2)), mul(nb, -PAD / 2)), w: PAD });
    surf.push({ a: hinge, b: [hinge[0] + seat, hinge[1]], n: [0, -1] });
    surf.push({ a: hinge, b: add(hinge, mul(db, blen)), n: nb });
    return { db, nb, top: add(hinge, mul(db, blen)) };
  }

  // Machines (side view unless noted). h is the seat's top height (seated hips sit 9 above it).
  // With a backrest (legPress, legCurl, legExt, chestPress, shoulderPress) x is the seat's rear
  // corner: the seat runs forward from (x, -h) for `seat`, the backrest rises backward from it at
  // `back` degrees above horizontal. Moving parts follow the joints every frame (movingParts):
  //   legPress      { x, h, back = 35, len = 80, seat = 30, track: [x, y], angle = 45 } 45° sled.
  //                 Foot plate square to the track, centred 5.5 beyond the middle of the sole
  //                 (midway from heN to toN, toward the sole) and 54 long; its centre slides on the line
  //                 through `track` at `angle` degrees above horizontal; carriage 12 deep behind it,
  //                 a plate (r 19) on the carriage; rails 30 below the track line.
  //   legCurl       { x, h, back = 80, seat = 44, pivot: [x, y] } Seated leg curl: lever pivot at the
  //                 knee; roller pad (r 5.6) 6 up the shin from the ankle, 10.9 behind the shin
  //                 line; thigh pad on the thighs just behind the knee.
  //   legExt        { x, h, back = 80, seat = 44, pivot: [x, y] } Leg extension: the same roller in
  //                 front of the shin.
  //   chestPress    { x, h, back = 80, seat = 40, pivot: [x, y] } Lever from a pivot above the head
  //                 down to the handle between the hands (grip point); 9-long handle square to it.
  //   shoulderPress { x, h, back = 84, seat = 38, pivot: [x, y] } Lever from a pivot on the column
  //                 behind the backrest to the handle between the hands.
  //   pecDeck       { x = 0, h, top = 200, py = 172, dx = 22, w = 52, rear } Front view: frame
  //                 uprights at x ± w; arms hang from pivots at (x ± dx, -py) to vertical handles
  //                 in each hand; rear: true (reverse fly, seen from behind) has no backrest.
  //   pulldown      { x, h, seat = 40, pad: [x, y], pulley: [x, y], col } Seat from x - seat to x,
  //                 thigh roller (r 6.2) centred at `pad`, column at x = col with a top beam to the
  //                 pulley; the cable runs to the bar between the hands.
  //   rowSeat       { x, h, w = 60, foot: [x, y], angle = 70 } Seated-row bench from x - w to x and
  //                 a foot plate whose surface passes through `foot`, tilted `angle` degrees from
  //                 the floor (top away from the lifter). Use with a low `cable` tower.
  function machineGeom(p, view) {
    const S = [], surf = [];
    const h = p.h || 48;
    const hinge = [p.x, -h];
    const floorBar = (a, b) => S.push({ k: 'tube', a: [a, -1.5], b: [b, -1.5] });
    if (p.kind === 'legPress') {
      const seat = p.seat || 30;
      const sb = seatWithBack(S, surf, hinge, seat, p.back || 35, p.len || 80);
      const ang = p.angle || 45;
      const u = dir(90 + ang), dn = dir(ang);
      const rail = (s) => add(add(p.track, mul(u, s)), mul(dn, 30));
      const r0 = rail(-34), r1 = rail(62);
      floorBar(sb.top[0] - 6, r1[0] + 12);
      S.push({ k: 'tube', a: add(sb.top, mul(sb.nb, -PAD)), b: [sb.top[0] + 4, -1.5] });
      S.push({ k: 'tube', a: [p.x + 8, -h + PAD], b: [p.x + 14, -1.5] });
      S.push({ k: 'tube', a: r1, b: [r1[0], -1.5], w: 4 });
      S.push({ k: 'tube', a: r0, b: [r0[0], -1.5], w: 4 });
      S.push({ k: 'tube', a: r0, b: r1, w: 5 });
    } else if (p.kind === 'legCurl' || p.kind === 'legExt') {
      const seat = p.seat || 44;
      seatWithBack(S, surf, hinge, seat, p.back || 80, 62);
      const pv = p.pivot;
      floorBar(p.x - 28, pv[0] + 40);
      S.push({ k: 'tube', a: [p.x + seat * 0.45, -h + PAD], b: [p.x + seat * 0.45, -1.5], w: 4 });
      S.push({ k: 'tube', a: [p.x + seat * 0.45, -h + PAD + 6], b: pv, w: 4 });
      S.push({ k: 'rect', x: pv[0] + 26, y: -64, w: 13, h: 60, rx: 2, cls: 'fig-stack' });
      S.push({ k: 'tube', a: [pv[0] + 32.5, -66], b: [pv[0] + 32.5, pv[1] - 22], w: 4 });
      S.push({ k: 'tube', a: [pv[0] + 32.5, pv[1] - 22], b: add(pv, [4, -8]), w: 4 });
      if (p.kind === 'legCurl') {
        const tp = [pv[0] - 14, pv[1] - 13.5];
        S.push({ k: 'tube', a: tp, b: [pv[0] + 10, pv[1] - 22], w: 3.4 });
        S.push({ k: 'pad', a: add(tp, [-9, 0]), b: add(tp, [7, 0]), w: 10 });
      }
      S.push({ k: 'circ', c: pv, r: 5, cls: 'fig-pulley' });
    } else if (p.kind === 'chestPress' || p.kind === 'shoulderPress') {
      const chest = p.kind === 'chestPress';
      const seat = p.seat || (chest ? 40 : 38);
      const sb = seatWithBack(S, surf, hinge, seat, p.back || (chest ? 80 : 84), chest ? 74 : 80);
      const pv = p.pivot;
      // Column behind the backrest (the shoulder press pivots on it); the chest press reaches
      // forward over the head to its pivot.
      const col = chest ? Math.min(sb.top[0], p.x) - 26 : pv[0];
      floorBar(col - 12, p.x + seat + 10);
      S.push({ k: 'tube', a: [p.x + seat * 0.5, -h + PAD], b: [p.x + seat * 0.5, -1.5], w: 4 });
      S.push({ k: 'rect', x: col - 7, y: -104, w: 14, h: 100, rx: 2, cls: 'fig-stack' });
      if (chest) {
        S.push({ k: 'tube', a: [col, -1.5], b: [col, pv[1] - 6], w: 4 });
        S.push({ k: 'tube', a: [col, pv[1] - 6], b: [pv[0], pv[1] - 6], w: 4 });
      } else {
        S.push({ k: 'tube', a: [col, -1.5], b: [col, pv[1] - 12], w: 4 });
      }
      S.push({ k: 'circ', c: pv, r: 4.5, cls: 'fig-pulley' });
    } else if (p.kind === 'pecDeck') {
      // Front view.
      const x = p.x || 0, w = p.w || 52, top = p.top || 200, py = p.py || 172, dx = p.dx || 22;
      floorBar(x - w - 8, x + w + 8);
      S.push({ k: 'tube', a: [x - w, -1.5], b: [x - w, -top], w: 4 });
      S.push({ k: 'tube', a: [x + w, -1.5], b: [x + w, -top], w: 4 });
      S.push({ k: 'tube', a: [x - w, -top], b: [x + w, -top], w: 4 });
      for (const s of [-1, 1]) {
        S.push({ k: 'tube', a: [x + s * dx, -top], b: [x + s * dx, -py], w: 4 });
        S.push({ k: 'circ', c: [x + s * dx, -py], r: 4, cls: 'fig-pulley' });
      }
      S.push({ k: 'tube', a: [x, -h + PAD], b: [x, -1.5], w: 4 });
      if (!p.rear) S.push({ k: 'rect', x: x - 15, y: -h - 76, w: 30, h: 74, rx: 6, cls: 'fig-padrect' });
      S.push({ k: 'pad', a: [x - 20, -h + PAD / 2], b: [x + 20, -h + PAD / 2], w: PAD });
      surf.push({ a: [x - 24, -h], b: [x + 24, -h], n: [0, -1] });
    } else if (p.kind === 'pulldown') {
      const seat = p.seat || 40;
      const col = p.col;
      const [px, py] = p.pulley;
      floorBar(p.x - seat - 8, col + 14);
      S.push({ k: 'tube', a: [p.x - seat * 0.5, -h + PAD], b: [p.x - seat * 0.5, -1.5], w: 4 });
      S.push({ k: 'tube', a: [p.x - 4, -h + PAD + 4], b: [p.pad[0], p.pad[1]], w: 3.4 });
      S.push({ k: 'pad', a: [p.x - seat + PAD / 2, -h + PAD / 2], b: [p.x - PAD / 2, -h + PAD / 2], w: PAD });
      S.push({ k: 'circ', c: p.pad, r: 6.2, cls: 'fig-roller' });
      S.push({ k: 'rect', x: col - 7, y: -108, w: 14, h: 104, rx: 2, cls: 'fig-stack' });
      S.push({ k: 'tube', a: [col, -1.5], b: [col, py - 7], w: 4.5 });
      S.push({ k: 'tube', a: [col, py - 7], b: [px - 8, py - 7], w: 4.5 });
      S.push({ k: 'tube', a: [px, py - 7], b: [px, py], w: 2.4 });
      S.push({ k: 'circ', c: [px, py], r: 3.8, cls: 'fig-pulley' });
      surf.push({ a: [p.x - seat, -h], b: [p.x, -h], n: [0, -1] });
    } else if (p.kind === 'rowSeat') {
      const w = p.w || 60;
      const ang = p.angle || 70;
      const fdir = dir(90 + ang);
      const f0 = add(p.foot, mul(fdir, -15)), f1 = add(p.foot, mul(fdir, 15));
      floorBar(p.x - w + 4, f0[0] + 18);
      S.push({ k: 'tube', a: [p.x - w * 0.5, -h + PAD], b: [p.x - w * 0.5, -1.5], w: 4 });
      S.push({ k: 'tube', a: add(f0, mul(dir(ang), 3)), b: [f0[0] + 6, -1.5], w: 4 });
      S.push({ k: 'pad', a: [p.x - w + PAD / 2, -h + PAD / 2], b: [p.x - PAD / 2, -h + PAD / 2], w: PAD });
      S.push({ k: 'tube', a: add(f0, mul(dir(ang), 2.4)), b: add(f1, mul(dir(ang), 2.4)), w: 4.8 });
      surf.push({ a: [p.x - w, -h], b: [p.x, -h], n: [0, -1] });
    }
    return { shapes: S, surfaces: surf };
  }

  function gymGeom(p, view) {
    const S = [], surf = [];
    if (p.type === 'bench') return benchGeom(p, view);
    if (p.type === 'machine') return machineGeom(p, view);
    if (p.type === 'rack') {
      const d = p.d == null ? 105 : p.d, top = p.top || 205, x = p.x, h = p.h;
      const f = p.face || (x > 0 ? -1 : 1); // the hook opens toward the lifter (near x = 0)
      const xr = x + f * d;
      S.push({ k: 'tube', a: [Math.min(x, xr) - 12, -1.5], b: [Math.max(x, xr) + 12, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x, -1.5], b: [x, -top], w: 4.5 });
      if (d) { S.push({ k: 'tube', a: [xr, -1.5], b: [xr, -top], w: 4.5 }); S.push({ k: 'tube', a: [xr, -top], b: [x, -top], w: 4.5 }); }
      if (p.safety) S.push({ k: 'tube', a: [x + f * (d || 40), -p.safety], b: [x, -p.safety], w: 3.4 });
      S.push({ k: 'pline', pts: [[x, -h - 4], [x + f * 3, -h + 1], [x + f * 9, -h + 1], [x + f * 10.5, -h - 3.5]] });
    } else if (p.type === 'smith') {
      const top = p.top || Math.min(210, Math.max(p.h + 48, 172)), x = p.x;
      S.push({ k: 'tube', a: [x - 16, -1.5], b: [x + 16, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x, -1.5], b: [x, -top], w: 3 });
      S.push({ k: 'tube', a: [x - 9, -top], b: [x + 9, -top], w: 4 });
      S.push({ k: 'tube', a: [x - 5.5, -p.h], b: [x + 5.5, -p.h], w: 2.6 });
    } else if (p.type === 'cable') {
      const face = p.face || (p.x > 0 ? -1 : 1);
      const top = p.top || Math.max(-p.y + 16, 178);
      const cx = p.x - face * 7;
      S.push({ k: 'tube', a: [cx - 16, -1.5], b: [cx + 16, -1.5], w: 4 });
      S.push({ k: 'rect', x: cx - 4, y: -top, w: 8, h: top - 1, rx: 2, cls: 'fig-prop' });
      S.push({ k: 'rect', x: cx - 7, y: -54, w: 14, h: 50, rx: 2, cls: 'fig-stack' });
      S.push({ k: 'tube', a: [cx, p.y], b: [p.x, p.y], w: 2.6 });
      S.push({ k: 'circ', c: [p.x, p.y], r: 3.8, cls: 'fig-pulley' });
    } else if (p.type === 'dip') {
      const l2 = (p.len || 56) / 2, x = p.x, h = p.h;
      S.push({ k: 'tube', a: [x - l2 - 10, -1.5], b: [x + l2 + 10, -1.5], w: 4 });
      for (const s of [-1, 1]) S.push({ k: 'tube', a: [x + s * l2, -h], b: [x + s * l2, -1.5], w: 4.5 });
      S.push({ k: 'gbar', a: [x - l2, -h], b: [x + l2, -h] });
    } else if (p.type === 'rower') {
      const x = p.x, h = p.h || 36, fy = p.fy == null ? -26 : p.fy;
      const ry = -h + 9;
      S.push({ k: 'tube', a: [x - 150, ry], b: [x + 16, ry], w: 5 });
      S.push({ k: 'tube', a: [x - 144, ry], b: [x - 144, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x - 156, -1.5], b: [x - 132, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x + 14, ry], b: [x + 30, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x + 18, -1.5], b: [x + 78, -1.5], w: 4 });
      S.push({ k: 'circ', c: [x + 50, -46], r: 24, cls: 'fig-prop' });
      S.push({ k: 'circ', c: [x + 50, -46], r: 5, cls: 'fig-pulley' });
      S.push({ k: 'tube', a: [x + 38, -68], b: [x + 26, -106], w: 3 });
      S.push({ k: 'rect', x: x + 16, y: -118, w: 16, h: 12, rx: 2, cls: 'fig-stack' });
      // Footplate: its surface passes through (x, fy), tilted 45°.
      const fd = dir(135), fc = add([x, fy], mul(dir(45), 2.3));
      S.push({ k: 'tube', a: add(fc, mul(fd, -13)), b: add(fc, mul(fd, 13)), w: 4.6 });
      S.push({ k: 'tube', a: add(fc, mul(fd, -13)), b: [x - 4, ry], w: 3 });
    } else if (p.type === 'bike') {
      const x = p.x, y = p.y == null ? -30 : p.y, h = p.h, sx = p.sx, bar = p.bar;
      S.push({ k: 'tube', a: [sx - 26, -1.5], b: [x + 52, -1.5], w: 4.5 });
      S.push({ k: 'tube', a: [x + 4, -4], b: [sx + 2, -h + 7], w: 5 });
      S.push({ k: 'tube', a: [x + 4, -4], b: [x + 26, -18], w: 4.5 });
      S.push({ k: 'circ', c: [x + 30, -36], r: 19, cls: 'fig-prop' });
      S.push({ k: 'tube', a: [x + 30, -36], b: [bar[0] - 4, bar[1] + 6], w: 4.5 });
      S.push({ k: 'pad', a: [bar[0] - 7, bar[1]], b: [bar[0] + 5, bar[1] - 2], w: 5 });
      S.push({ k: 'pad', a: [sx - 12, -h + 3], b: [sx + 11, -h + 3], w: 6 });
      S.push({ k: 'circ', c: [x, y], r: 3.4, cls: 'fig-pulley' });
      surf.push({ a: [sx - 12, -h], b: [sx + 11, -h], n: [0, -1] });
    } else if (p.type === 'treadmill') {
      const x = p.x, w = p.w, h = p.h || 20, inc = (p.incline || 0) * D2R;
      const u = [Math.cos(inc), -Math.sin(inc)], n = [Math.sin(inc), Math.cos(inc)]; // along the belt; into the deck
      const b0 = [x, -h], b1 = add(b0, mul(u, w));
      S.push({ k: 'tube', a: add(b0, mul(n, 7)), b: [x + 2, -1.5], w: 4 });
      S.push({ k: 'tube', a: [x - 8, -1.5], b: [b1[0] + 22, -1.5], w: 4 });
      S.push({ k: 'tube', a: add(b1, mul(n, 7)), b: [b1[0] + 4, -1.5], w: 4 });
      S.push({ k: 'pad', a: add(add(b1, mul(u, 6)), mul(n, 1)), b: add(add(b1, mul(u, 18)), mul(n, 1)), w: 14 });
      S.push({ k: 'tube', a: add(b1, [10, -6]), b: add(b1, [-2, -112]), w: 4 });
      S.push({ k: 'tube', a: add(b1, [2, -92]), b: add(b1, [-44, -92]), w: 3.4 });
      S.push({ k: 'pad', a: add(b1, [-12, -114]), b: add(b1, [8, -120]), w: 8 });
      S.push({ k: 'pad', a: add(add(b0, mul(u, 4)), mul(n, 4)), b: add(add(b1, mul(u, -4)), mul(n, 4)), w: 8 });
      surf.push({ a: b0, b: b1, n: [-n[0], -n[1]] });
    }
    return { shapes: S, surfaces: surf };
  }
  const GYM_PROPS = ['bench', 'rack', 'smith', 'cable', 'dip', 'machine', 'rower', 'bike', 'treadmill'];

  // The leg press foot plate's centre (it slides on the line through p.track): under the middle of
  // the soles, or for a calf raise (p.calf) square to the track with the balls of the feet near its
  // bottom edge and the heels hanging off it.
  function sledCentre(p, pts) {
    if (!p.calf) return add(mid(pts.heN, pts.toN), mul(dir(pts.footDirN - 90), 5.5));
    const ang = p.angle || 45;
    const u = dir(90 + ang), pd = dir(180 + ang);
    const ball = [lerp(pts.anN[0], pts.toN[0], 0.75), lerp(pts.anN[1], pts.toN[1], 0.75)];
    const c = add(add(ball, mul(u, 5.5)), mul(pd, 18));
    return add(p.track, mul(u, (c[0] - p.track[0]) * u[0] + (c[1] - p.track[1]) * u[1]));
  }

  // Moving parts, per frame: cables, sleds, pads, levers, seats and cranks that follow the joints.
  function movingParts(move, pts) {
    const out = [];
    if ((move.view || 'side') === 'top' || !props(move).some((p) => GYM_PROPS.includes(p.type))) return out;
    for (const r of cableRuns(move, pts)) out.push({ k: 'cable', a: r.pulley, b: r.clip, layer: r.layer });
    const grip = (s) => equipGrip(pts, s);
    for (const p of props(move)) {
      if (p.type === 'machine') {
        if (p.kind === 'legPress') {
          const ang = p.angle || 45;
          const u = dir(90 + ang), pd = dir(180 + ang);
          const pc = sledCentre(p, pts);
          out.push({ k: 'plate', c: add(pc, mul(u, 14)), r: 19, layer: 'back' });
          out.push({ k: 'poly', pts: [add(pc, mul(pd, -27)), add(pc, mul(pd, 27)), add(add(pc, mul(pd, 27)), mul(u, 12)), add(add(pc, mul(pd, -27)), mul(u, 12))], cls: 'fig-prop', layer: 'back' });
          out.push({ k: 'tube', a: add(pc, mul(pd, -27)), b: add(pc, mul(pd, 27)), w: 4.4, cls: 'eq-lever', layer: 'back' });
        } else if (p.kind === 'legCurl' || p.kind === 'legExt') {
          const u = unit(sub(pts.anN, pts.knN));
          const side = p.kind === 'legCurl' ? [-u[1], u[0]] : [u[1], -u[0]];
          const pad = add(add(pts.anN, mul(u, -6)), mul(side, 5.25 + 5.6));
          out.push({ k: 'tube', a: p.pivot, b: pad, w: 4, cls: 'eq-lever', layer: 'back' });
          out.push({ k: 'circ', c: pad, r: 5.6, cls: 'fig-roller', layer: 'back' });
        } else if (p.kind === 'chestPress' || p.kind === 'shoulderPress') {
          const g = mid(grip('N'), grip('F'));
          const u = unit(sub(g, p.pivot));
          const n = [u[1], -u[0]];
          out.push({ k: 'tube', a: p.pivot, b: g, w: 5, cls: 'eq-lever', layer: 'back' });
          out.push({ k: 'tube', a: add(g, mul(n, -4.5)), b: add(g, mul(n, 4.5)), w: 3.6, cls: 'eq-grip', layer: 'near' });
        } else if (p.kind === 'pecDeck') {
          const x = p.x || 0, py = p.py || 172, dx = p.dx || 22;
          for (const [s, sx] of [['N', 1], ['F', -1]]) {
            const g = grip(s);
            out.push({ k: 'tube', a: [x + sx * dx, -py], b: g, w: 4, cls: 'eq-lever', layer: 'back' });
            out.push({ k: 'tube', a: add(g, [0, -6]), b: add(g, [0, 6]), w: 3.6, cls: 'eq-grip', layer: 'front' });
          }
        }
      } else if (p.type === 'rower') {
        const h = p.h || 36;
        out.push({ k: 'pad', a: [pts.hip[0] - 14, -h + 3], b: [pts.hip[0] + 12, -h + 3], w: 6, layer: 'back' });
        const g = mid(grip('N'), grip('F'));
        out.push({ k: 'cable', a: [p.x + 27, -54], b: g, w: 1.6, layer: 'back' });
        out.push({ k: 'tube', a: add(g, [0, -1]), b: add(g, [0, 1]), w: 5, cls: 'eq-grip', layer: 'near' });
      } else if (p.type === 'bike') {
        const axle = [p.x, p.y == null ? -30 : p.y], crank = p.crank || 17;
        for (const [s, layer] of [['F', 'back'], ['N', 'far']]) {
          const fd = pts['footDir' + s];
          const ball = add(add(pts['an' + s], mul(dir(fd), 9)), mul(dir(fd - 90), 3.5));
          const end = add(axle, mul(unit(sub(ball, axle)), crank));
          out.push({ k: 'tube', a: axle, b: end, w: 3.6, cls: 'eq-lever', layer });
          out.push({ k: 'tube', a: add(end, mul(dir(fd), -4)), b: add(end, mul(dir(fd), 4)), w: 3, cls: 'eq-grip', layer });
        }
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- bounds */
  // The points of a gym shape with the padding each needs, as [[point, pad], ...].
  function shapePoints(s) {
    const w = (s.w || 4) / 2;
    if (s.k === 'rect') return [[[s.x, s.y], 1], [[s.x + s.w, s.y + s.h], 1]];
    if (s.k === 'circ' || s.k === 'plate') return [[s.c, s.r + 1.5]];
    if (s.k === 'poly' || s.k === 'pline') return s.pts.map((q) => [q, 2]);
    return [[s.a, w + 1], [s.b, w + 1]];
  }

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
    const view0 = move.view || 'side';
    for (let i = 0; i < N; i++) {
      const pts = frameAt(move, (tl.total * i) / N);
      for (const [k, v] of Object.entries(pts)) if (Array.isArray(v)) take(v, k === 'head' ? L.head + 2 : 9);
      for (const e of equipment(move, pts)) {
        if (e.c) take(e.c, (e.r || 6) + 2);
        if (e.a) take(e.a, 6);
        if (e.b) take(e.b, 6);
        if (e.h) take(e.h, 4);
        for (const q of e.pts || []) take(q, 3);
      }
      if (view0 !== 'top') for (const e of movingParts(move, pts)) for (const q of shapePoints(e)) take(q[0], q[1]);
    }
    for (const p of props(move)) {
      if (p.type === 'box' || p.type === 'table' || p.type === 'chair') { take([p.x, -(p.h || SEAT_H)], 2); take([p.x + p.w, 0], 2); }
      if (p.type === 'wall') { take([p.x, -150], 2); }
      if (p.type === 'bar') { take([p.x1, p.y], 3); take([p.x2, p.y], 3); }
      if (p.type === 'door') { take([p.x, -200], 2); take([p.x + 6, 0], 2); }
      if (p.type === 'mat') { take([p.x, -2], 1); take([p.x + p.w, 0], 1); }
      if (GYM_PROPS.includes(p.type)) for (const s of gymGeom(p, view0).shapes) for (const q of shapePoints(s)) take(q[0], q[1]);
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
    for (const [id, j0, j1, w, layer0, limb] of segs) {
      const a = P[j0], b = P[j1];
      if (!a || !b) continue;
      const layer = limb && limb[0] === 'a' && behind(move, pts, [limb.slice(-1)]) ? 'far' : layer0;
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
    // Machine parts first, so held equipment in the same layer draws over them.
    const eq = movingParts(move, P).concat(equipment(move, P)).map((e) => {
      const r = Object.assign({}, e);
      for (const k of ['a', 'b', 'c', 'h']) if (r[k]) r[k] = mx(r[k], mirrored);
      if (r.pts) r.pts = r.pts.map((q) => mx(q, mirrored));
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
      } else if (GYM_PROPS.includes(p.type)) {
        for (const s of gymGeom(p, view).shapes) out.push(mirrorShape(s, mirrored));
      }
    }
    return out;
  }
  function mirrorShape(s, m) {
    if (!m) return s;
    const r = Object.assign({}, s);
    for (const k of ['a', 'b', 'c']) if (r[k]) r[k] = mx(r[k], true);
    if (r.pts) r.pts = r.pts.map((q) => mx(q, true));
    if (r.k === 'rect') r.x = -(s.x + s.w);
    return r;
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
    } else {
      gymShape(g, p);
    }
  }
  // Gym shapes: created once; moving ones are updated in place by setShape.
  function gymShape(g, s) {
    const n = {};
    if (s.k === 'pad') {
      n.o = el('line', { class: 'fig-pad-o' }, g);
      n.f = el('line', { class: 'fig-pad-f' }, g);
    } else if (s.k === 'tube' || s.k === 'gbar' || s.k === 'cable') {
      n.l = el('line', { class: s.cls || (s.k === 'tube' ? 'fig-frame' : s.k === 'gbar' ? 'fig-bar' : 'fig-cable') }, g);
    } else if (s.k === 'rect') {
      n.r = el('rect', { class: s.cls || 'fig-prop' }, g);
    } else if (s.k === 'circ') {
      n.c = el('circle', { class: s.cls || 'fig-prop' }, g);
    } else if (s.k === 'poly') {
      n.p = el('polygon', { class: s.cls || 'fig-prop' }, g);
    } else if (s.k === 'pline') {
      n.p = el('polyline', { class: s.cls || 'fig-hook' }, g);
    }
    setShape(n, s);
    return n;
  }
  function setShape(n, s) {
    if (n.o) {
      setLine(n.o, s.a, s.b); setLine(n.f, s.a, s.b);
      n.o.setAttribute('stroke-width', f1(s.w)); n.f.setAttribute('stroke-width', f1(Math.max(0.5, s.w - 2.4)));
    } else if (n.l) {
      setLine(n.l, s.a, s.b);
      n.l.setAttribute('stroke-width', f1(s.w || (s.k === 'cable' ? 1.2 : s.k === 'gbar' ? 5 : 3.4)));
    } else if (n.r) {
      for (const [k, v] of [['x', s.x], ['y', s.y], ['width', s.w], ['height', s.h], ['rx', s.rx || 0]]) n.r.setAttribute(k, f1(v));
    } else if (n.c) {
      n.c.setAttribute('cx', f1(s.c[0])); n.c.setAttribute('cy', f1(s.c[1])); n.c.setAttribute('r', f1(s.r));
    } else if (n.p) {
      n.p.setAttribute('points', s.pts.map((q) => f1(q[0]) + ',' + f1(q[1])).join(' '));
    }
  }

  function updateFigure(nodes, pts) {
    const { move, o, mirrored } = nodes;
    const dl = drawList(move, pts, { mirrored, lead: o.lead });
    if (!nodes.built) {
      nodes.lg = {};
      for (const [ly, items] of Object.entries(dl.layers)) {
        const g = nodes.groups[ly];
        const outline = el('g', { class: 'fig-outline' }, g);
        const fill = el('g', { class: 'fig-fill' }, g);
        const bands = el('g', { class: 'fig-bands' }, g);
        g.insertBefore(outline, g.firstChild);
        g.insertBefore(fill, outline.nextSibling);
        g.insertBefore(bands, fill.nextSibling);
        nodes.lg[ly] = { outline, fill, bands };
        for (const it of items) {
          const lo = el('line', { 'stroke-width': it.w, class: it.lead ? 'lead' : '' }, outline);
          const lf = el('line', { 'stroke-width': Math.max(0.5, it.w - 2 * OUTLINE) }, fill);
          const bl = it.bands.map((bd) => el('line', { 'stroke-width': f1(bd.w) }, bands));
          nodes.items[it.id] = { lo, lf, bl, layer: ly };
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
        const g = el('g', { class: 'fig-' + e.k }, eqParent(nodes, e.layer));
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
        } else if (e.k === 'plate') {
          e.$ = { c: el('circle', { class: 'eq-plate-disc' }, g), hub: el('circle', { class: 'eq-plate-hub' }, g) };
        } else if (e.k === 'barEnd' || e.k === 'knob') {
          e.$ = { c: el('circle', { class: 'eq-' + (e.k === 'knob' ? 'knob' : 'bar-end') }, g) };
        } else if (e.k === 'rope') {
          e.$ = { l: el('line', { class: 'eq-rope' }, g) };
        } else if (e.k === 'dhandle') {
          e.$ = { p: el('polygon', { class: 'eq-dhandle' }, g) };
        } else {
          e.$ = { gym: gymShape(g, e) };
        }
        e.$.g = g; e.$.layer = e.layer;
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
    for (const [ly, items] of Object.entries(dl.layers)) {
      for (const it of items) {
        const n = nodes.items[it.id];
        if (!n) continue;
        if (n.layer !== ly && nodes.lg[ly]) {
          // A hand passing behind the body: its limb moves to the layer behind the torso and head.
          const to = nodes.lg[ly];
          to.outline.appendChild(n.lo); to.fill.appendChild(n.lf);
          for (const b of n.bl) to.bands.appendChild(b);
          n.layer = ly;
        }
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
      if ($.layer !== e.layer && $.g) { eqParent(nodes, e.layer).appendChild($.g); $.layer = e.layer; }
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
      } else if (e.k === 'plate') {
        for (const [n, r] of [[$.c, e.r], [$.hub, Math.min(4.5, e.r * 0.3)]]) { n.setAttribute('cx', f1(e.c[0])); n.setAttribute('cy', f1(e.c[1])); n.setAttribute('r', f1(r)); }
      } else if (e.k === 'barEnd' || e.k === 'knob') {
        $.c.setAttribute('cx', f1(e.c[0])); $.c.setAttribute('cy', f1(e.c[1])); $.c.setAttribute('r', f1(e.r));
      } else if (e.k === 'dhandle') {
        $.p.setAttribute('points', e.pts.map((q) => f1(q[0]) + ',' + f1(q[1])).join(' '));
      } else if ($.gym) {
        setShape($.gym, e);
      } else if ($.l) {
        setLine($.l, e.a, e.b);
      }
    });
  }

  function setLine(n, a, b) {
    n.setAttribute('x1', f1(a[0])); n.setAttribute('y1', f1(a[1]));
    n.setAttribute('x2', f1(b[0])); n.setAttribute('y2', f1(b[1]));
  }
  const eqParent = (nodes, layer) => (layer === 'back' ? nodes.gEqBack : layer === 'far' ? nodes.gEqFar : layer === 'near' ? nodes.gEqNear : nodes.gEqFront);

  /* ---------------------------------------------------------------- animation controller */
  // mount(container, move, { lead, mirrored, static, fps, poseName }) → controller. Only `static`
  // holds a pose: reduced motion still animates exercises, since the movement is the instruction.
  function mount(container, move, opts) {
    const o = Object.assign({ fps: 30 }, opts);
    const nodes = createFigure(move, o);
    container.appendChild(nodes.svg);
    const tl = move.$tl || (move.$tl = timeline(move));
    let raf = 0, t0 = 0, playing = false, last = -1, offset = 0, shown = 0;
    const frameMs = 1000 / o.fps;
    const draw = (t) => { shown = t; updateFigure(nodes, frameAt(move, t)); };
    const keyPose = move.key || tl.steps[0].to;
    if (o.static) {
      // Static: the end pose, with the start pose as a faint ghost behind it.
      addGhost(nodes, move, o);
      updateFigure(nodes, framePose(move, keyPose));
    } else draw(0);
    // While a sheet is dragged or settling (<html data-sheet-moving>), the figure holds its pose and
    // the rep carries on from there after: every frame goes to the sheet.
    const doc = G.document;
    let held = 0;
    function loop(now) {
      if (!playing) return;
      if (!t0) t0 = now - offset;
      if (doc && doc.documentElement.hasAttribute('data-sheet-moving')) {
        if (!held) held = now;
      } else {
        if (held) { t0 += now - held; held = 0; }
        if (now - last >= frameMs - 1) { last = now; draw(now - t0); }
      }
      raf = G.requestAnimationFrame(loop);
    }
    const ctl = {
      el: nodes.svg,
      play() { if (playing || o.static) return; playing = true; t0 = 0; offset = shown; raf = G.requestAnimationFrame(loop); },
      pause() { playing = false; if (raf) G.cancelAnimationFrame(raf); raf = 0; },
      // Where in the rep it is (ms), so a figure that replaces this one can carry on from there.
      time() { return shown % tl.total; },
      playOnce() {
        // One rep on request, then back to the key pose (for stills).
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

  GH.pose = {
    L, W, SEAT_H, dir, flatten, mix, solve, timeline, sampleAt, frameAt, framePose, poseByName, bounds, equipment, drawList, segments, mount, thumb, still, MUSCLES_SIDE, MUSCLES_FRONT,
    gymGeom, movingParts, cableRuns, pinPoint, equipGrip, sledCentre, GYM_PROPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
