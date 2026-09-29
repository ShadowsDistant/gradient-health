// Pose and exercise-library checks: every move's keyframes and in-between frames are finite, stay
// on or above the floor, reach their planted hands/feet, keep joints in human ranges, and draw.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js');
const M = GH.moves;
const P = GH.pose;
const ids = Object.keys(M.MOVES);
const POINTS = ['hip', 'neck', 'head', 'shN', 'shF', 'hpN', 'hpF', 'elN', 'elF', 'wrN', 'wrF', 'hdN', 'hdF', 'knN', 'knF', 'anN', 'anF', 'toN', 'toF', 'heN', 'heF'];
const FLOOR_TOL = 2; // about half a stroke width

// Keyframes plus in-between frames. A contact is "planted" when its IK target is the same in the
// poses on both sides of a transition; only planted contacts must be reached exactly.
function frames(m) {
  const tl = P.timeline(m);
  const out = [];
  for (const s of tl.steps) out.push({ name: s.to, pts: P.framePose(m, s.to), f: P.poseByName(m, s.to), planted: null });
  let from = tl.start;
  for (const s of tl.steps) {
    const a = P.poseByName(m, from), b = P.poseByName(m, s.to);
    const planted = ['hdN', 'hdF', 'anN', 'anF'].filter((k) => (`ik.${k}.x` in a) && a[`ik.${k}.x`] === b[`ik.${k}.x`] && a[`ik.${k}.y`] === b[`ik.${k}.y`]);
    for (const frac of [0.25, 0.5, 0.75]) {
      const f = P.mix(a, b, frac);
      out.push({ name: `${from}→${s.to}@${frac}`, pts: P.solve(m, f), f, planted });
    }
    from = s.to;
  }
  return out;
}

section('Library');
const bad = [];
for (const id of ids) {
  const m = M.MOVES[id];
  if (!m.name || !m.rep || !m.rep.length) bad.push(`${id}: no name or rep`);
  if (!Array.isArray(m.range) || !(m.range[0] <= m.range[1]) || !(m.start >= m.range[0] && m.start <= m.range[1])) bad.push(`${id}: range/start`);
  if (!Array.isArray(m.cues) || m.cues.length < 1 || m.cues.some((c) => typeof c !== 'string' || /!/.test(c))) bad.push(`${id}: cues`);
  if (!m.group) bad.push(`${id}: group`);
}
check(`every move (${ids.length}) has a name, a rep, a sensible range and cues without exclamation marks`, !bad.length, bad.slice(0, 5));
const ladderBad = [];
for (const [fam, lad] of Object.entries(M.LADDERS)) {
  if (!lad.gym && lad.rungs.length < 4) ladderBad.push(`${fam}: fewer than 4 rungs`);
  if (lad.gym && !lad.rungs.length) ladderBad.push(`${fam}: empty pool`);
  for (const id of lad.rungs) {
    const m = M.MOVES[id];
    // Gym pools may reuse home moves, which keep their home family.
    const reused = lad.gym && m && !m.gym && M.LADDERS[m.family] && !M.LADDERS[m.family].gym;
    if (!m || (m.family !== fam && !reused)) ladderBad.push(`${fam}: ${id}`);
  }
}
check('every ladder has 4+ rungs (gym pools 1+), all known, all tagged with their family', !ladderBad.length, ladderBad);
const tempo = ids.filter((id) => { const s = M.secPerRep(M.MOVES[id]); return !(s >= 0.5 && s <= 14); });
check('rep tempo is between 0.5 and 14 s', !tempo.length, tempo.map((id) => `${id}:${M.secPerRep(M.MOVES[id])}`));
const eq0 = { db: [], kb: [], ball: false, band: false, bar: false, chair: false, wall: false, towel: false, table: false, door: false };
const bodyweight = Object.keys(M.LADDERS).filter((f) => ['push', 'squat', 'abs'].includes(f)).every((f) => M.rungsFor(f, eq0).length >= 3);
check('push, squat and abs ladders work with no equipment at all', bodyweight);
const slamToss = M.rungsFor('coreRot', { db: [], kb: [], ball: true, ballSlam: true }).filter((id) => id === 'rot_slam' || id === 'rot_toss');
check('the rotation ladder ends in a slam or a toss, never both', slamToss.length === 1, slamToss);
const uni = ids.filter((id) => M.MOVES[id].uni);
check('unilateral moves draw mirrored for one side only', uni.every((id) => M.mirrorFor(M.MOVES[id], 'L') !== M.mirrorFor(M.MOVES[id], 'R')));

section('Poses');
const problems = { finite: [], floor: [], reach: [], joints: [], draw: [] };
// Elbow flexion in degrees (0 straight) from the solved points; with the move's depths when it gives
// them (arms drawn foreshortened, e.g. round the head), so it's the real bend, not the picture's.
const flexion = (pts, f, s) => {
  const z = (k) => pts[`depth${k}${s}`] || 0;
  const sh = [...pts['sh' + s], 0], el = [...pts['el' + s], z('el')], wr = [...pts['wr' + s], z('wr')];
  const a = sh.map((v, i) => el[i] - v), b = el.map((v, i) => wr[i] - v);
  // A segment drawn shorter than it is (a side-view arm reaching out sideways) goes out of the
  // picture by what's missing, as the 3D figure takes it.
  if (pts['depthel' + s] == null) {
    a[2] = Math.sqrt(Math.max(0, P.L.ua ** 2 - a[0] ** 2 - a[1] ** 2));
    b[2] = Math.sqrt(Math.max(0, P.L.fa ** 2 - b[0] ** 2 - b[1] ** 2));
  }
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
};
for (const id of ids) {
  const m = M.MOVES[id];
  let fr;
  try { fr = frames(m); } catch (e) { problems.finite.push(`${id}: ${e.message}`); continue; }
  for (const { name, pts, f, planted } of fr) {
    for (const k of POINTS) {
      const p = pts[k];
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) { problems.finite.push(`${id}@${name}.${k}`); continue; }
      if (m.view !== 'top' && p[1] > FLOOR_TOL) problems.floor.push(`${id}@${name}.${k}=${p[1].toFixed(1)}`);
    }
    for (const key of ['hdN', 'hdF', 'anN', 'anF']) if (pts['ikReach' + key] === false && (!planted || planted.includes(key))) problems.reach.push(`${id}@${name}.${key}`);
    for (const s of ['aN', 'aF', 'lN', 'lF']) {
      const side = s[1];
      // Arms placed by IK or given depths: the real bend from the points (the angle in the pose
      // isn't used for them); otherwise the pose's own angle.
      const solved = s[0] === 'a' && (`ik.hd${side}.x` in f || (f.$.ikTo && f.$.ikTo['hd' + side]) || pts['depthel' + side] != null);
      const bend = solved ? flexion(pts, f, side) : s[0] === 'a' ? f[`${s}.e`] : f[`${s}.k`];
      if (bend != null && (bend < -12 || bend > (solved ? 162 : 178))) problems.joints.push(`${id}@${name}.${s}=${bend.toFixed(0)}`);
    }
  }
  try { const dl = P.drawList(m, fr[0].pts, {}); if (!dl || !dl.layers) problems.draw.push(id); } catch (e) { problems.draw.push(`${id}: ${e.message}`); }
}
check('all joints finite in every keyframe and in-between frame', !problems.finite.length, problems.finite.slice(0, 6));
check('nothing goes through the floor (side and front views)', !problems.floor.length, problems.floor.slice(0, 6));
check('planted hands and feet are always reachable (IK)', !problems.reach.length, problems.reach.slice(0, 6));
check('elbows and knees stay in a human range (IK and foreshortened arms by their real bend)', !problems.joints.length, problems.joints.slice(0, 6));
check('every move builds a draw list', !problems.draw.length, problems.draw.slice(0, 6));

/* ------------------------------------------------------------------ motion */
section('Motion');
// Every move played at 60 samples per rep step: no joint jumps between samples (a jump is a step
// far bigger than its neighbours', or simply too big for any real movement), and in front and
// top views no elbow or forearm crosses the face unless the move says the arm is in front of it
// or behind the head (then it's drawn behind).
const H = P.L.torso + P.L.neck + 2 * P.L.head + P.L.th + P.L.sh; // figure height, ~163
const JOINTS = ['hip', 'neck', 'head', 'shN', 'shF', 'elN', 'elF', 'wrN', 'wrF', 'hdN', 'hdF', 'knN', 'knF', 'anN', 'anF', 'toN', 'toF', 'heN', 'heF'];
const motion = { jump: [], head: [] };
const segDist = (c, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)));
  return Math.hypot(a[0] + ab[0] * t - c[0], a[1] + ab[1] * t - c[1]);
};
const seenForm = new Set();
for (const id of ids) {
  const m = M.MOVES[id];
  const key = m.form + JSON.stringify(m.rep);
  if (seenForm.has(key)) continue; // same animation as a move already checked
  seenForm.add(key);
  const tl = P.timeline(m);
  const ts = [];
  let t0 = 0;
  for (const s of tl.steps) { for (let i = 0; i <= 60; i++) ts.push(t0 + (s.ms * i) / 60); t0 += s.ms + s.hold; }
  const fr = ts.map((t) => ({ t, pts: P.frameAt(m, t), f: P.sampleAt(m, t) }));
  for (const k of JOINTS) {
    const d = fr.map((x, i) => (i ? Math.hypot(x.pts[k][0] - fr[i - 1].pts[k][0], x.pts[k][1] - fr[i - 1].pts[k][1]) : 0));
    for (let i = 1; i < d.length; i++) {
      const nb = Math.max(d[i - 1], i + 1 < d.length ? d[i + 1] : 0);
      if (d[i] > 0.05 * H || (d[i] > 0.02 * H && d[i] > 3 * nb)) { motion.jump.push(`${id}.${k}@${Math.round(fr[i].t)}ms ${d[i].toFixed(1)} cm`); break; }
    }
  }
  if ((m.view || 'side') === 'side') continue;
  const crossing = fr.flatMap(({ t, pts, f }) => ['N', 'F'].map((s) => {
    const inFront = (pts['depthel' + s] || 0) > 8 || (pts['depthhd' + s] || 0) > 8;
    const behind = (pts['depthhd' + s] || 0) < -2;
    if (inFront || behind) return null;
    const de = Math.hypot(pts['el' + s][0] - pts.head[0], pts['el' + s][1] - pts.head[1]);
    const dfa = segDist(pts.head, pts['el' + s], pts['wr' + s]);
    return de < P.L.head + 4 || dfa < P.L.head * 0.6 ? `${id}.${s}@${Math.round(t)}ms elbow ${de.toFixed(1)} forearm ${dfa.toFixed(1)} cm from the head's centre` : null;
  })).filter(Boolean);
  if (crossing.length) motion.head.push(crossing[0]);
}
check(`joints move continuously at 60 samples per rep step (${seenForm.size} animations)`, !motion.jump.length, motion.jump.slice(0, 12));
check('in front and top views no elbow or forearm crosses the face', !motion.head.length, motion.head.slice(0, 12));

/* ------------------------------------------------------------------ gym */
section('Gym library');
const GYM_EQ = {
  db: [5, 10, 20], kb: [], bar: true, band: true, bb: true, ez: true, rack: true, bench: true, benchIncline: true, smith: true, cable: true,
  pulldown: true, legPress: true, legCurl: true, legExt: true, chestPress: true, shoulderPress: true, pecDeck: true, dip: true, rower: true, bike: true, treadmill: true,
};
const LOAD_KEYS = ['bb', 'ez', 'db', 'cable', 'machine', 'smith', 'band', 'kb', 'ball'];
const MUSCLE_NAMES = Object.keys(P.MUSCLES_SIDE);
const gymIds = ids.filter((id) => M.MOVES[id].gym);
const pools = Object.entries(M.LADDERS).filter(([, l]) => l.gym);
const pooled = new Set(pools.flatMap(([, l]) => l.rungs));
const gymBad = [];
for (const id of gymIds) {
  const m = M.MOVES[id];
  if (!pooled.has(id)) gymBad.push(`${id}: in no gym pool`);
  if (m.load && m.load.split('|').some((k) => !LOAD_KEYS.includes(k))) gymBad.push(`${id}: load ${m.load}`);
  if (m.cues.length !== 3 || [...m.cues, m.mistake, m.breathe].some((c) => typeof c !== 'string' || !c || /[\u2013\u2014]/.test(c))) gymBad.push(`${id}: three cues, a mistake and a breathing tip, no dashes`);
  if (!m.muscles.length || m.muscles.some((x) => !MUSCLE_NAMES.includes(x))) gymBad.push(`${id}: muscles`);
  if (m.start > (m.range[0] + m.range[1]) / 2) gymBad.push(`${id}: start above the middle of the range`);
  if (!M.allowed(m, GYM_EQ)) gymBad.push(`${id}: req ${m.req} not satisfied by a full gym`);
}
// Loaded pool members (gym or reused home moves) carry a plausible starting ratio of body weight.
for (const id of pooled) {
  const m = M.MOVES[id];
  if (!m.load) { if (m.ratio != null) gymBad.push(`${id}: ratio on a bodyweight move`); continue; }
  const perDumbbell = /^(db|kb)/.test(m.load);
  if (!(m.ratio > 0 && m.ratio <= (perDumbbell ? 0.25 : 1))) gymBad.push(`${id}: ratio ${m.ratio}`);
  if (!M.loadFor(m, GYM_EQ)) gymBad.push(`${id}: no load key in a full gym`);
}
check(`${gymIds.length} gym moves: flagged, pooled, known load keys, cues, muscles, ranges, starting ratios`, !gymBad.length, gymBad.slice(0, 6));
const poolOrder = M.rungsFor('pressG', { db: [10], bb: true, bench: true, rack: true, chestPress: true });
check('gym pools keep their preference order through rungsFor', poolOrder.join() === 'bench_bb,bench_db,press_machine', poolOrder);
check('an adjustable bench also counts as a flat bench; a flat bench is not an incline',
  M.has({ benchIncline: true }, 'bench') && !M.has({ bench: true }, 'incline') && M.has({ bench: true }, 'bench'));
check('machine moves load from their machine only when it is there',
  M.loadFor(M.MOVES.leg_press, { legPress: true }) === 'machine' && M.loadFor(M.MOVES.leg_press, {}) === null);
const bandPallof = M.forPerson(M.MOVES.pallof, { band: true, door: true });
check('the Pallof press draws a band on a door when there is no cable',
  bandPallof.props[0].type === 'door' && bandPallof.equip[0].type === 'band' && M.forPerson(M.MOVES.pallof, GYM_EQ).props[0].type === 'cable');
const homeOnly = { db: [8], kb: [10], ball: true, band: true, bar: true, chair: true, wall: true, towel: true, table: true, door: true };
const leaks = gymIds.filter((id) => M.allowed(M.MOVES[id], homeOnly) && !['calf_db', 'rdl_db', 'hang_knee', 'pallof'].includes(id));
check('home equipment never unlocks a gym machine or barbell move', !leaks.length, leaks);

section('Gym props');
const segs2 = (m) => (m.view && m.view !== 'side' ? { torso: P.W.torsoFront / 2 } : { torso: P.W.torso / 2 });
// Gap between a body capsule (a→b, radius r) and the pad under a support surface {a, b, n} (a capsule
// 9 thick with rounded ends, so edges count too): negative means overlapping.
const PAD_R = 4.5;
function gap(a, b, r, s) {
  const sl = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
  const u = [(s.b[0] - s.a[0]) / sl, (s.b[1] - s.a[1]) / sl]; // the pad's caps end flush with the surface
  const c0 = [s.a[0] + (u[0] - s.n[0]) * PAD_R, s.a[1] + (u[1] - s.n[1]) * PAD_R], c1 = [s.b[0] - (u[0] + s.n[0]) * PAD_R, s.b[1] - (u[1] + s.n[1]) * PAD_R];
  const d = [c1[0] - c0[0], c1[1] - c0[1]];
  const l2 = d[0] * d[0] + d[1] * d[1] || 1;
  let best = Infinity;
  for (let i = 0; i <= 40; i++) {
    const p = [a[0] + (b[0] - a[0]) * i / 40, a[1] + (b[1] - a[1]) * i / 40];
    const t = Math.max(0, Math.min(1, ((p[0] - c0[0]) * d[0] + (p[1] - c0[1]) * d[1]) / l2));
    best = Math.min(best, Math.hypot(p[0] - c0[0] - d[0] * t, p[1] - c0[1] - d[1] * t) - PAD_R - r);
  }
  return best;
}
const surfacesOf = (m) => (m.props || []).filter((p) => P.GYM_PROPS.includes(p.type)).flatMap((p) => P.gymGeom(p, m.view || 'side').surfaces.map((s) => Object.assign({ prop: p }, s)));
// Which body part rests on which support, every frame: 'torso' on a pad (flat bench, backrest,
// incline or chest pad), 'thigh' on a seat, 'hip' (front view and bikes) 9 above the seat.
const REST = {
  bench_bb: ['torso'], bench_db: ['torso'], bench_smith: ['torso'], cg_bench: ['torso'], skull_ez: ['torso'], thrust_bb: ['torso'],
  incline_db: ['torso', 'thigh'], incline_bb: ['torso', 'thigh'], incline_smith: ['torso', 'thigh'], ohp_db: ['torso', 'thigh'], curl_incline: ['torso', 'thigh'],
  press_machine: ['torso', 'thigh'], press_shoulder_machine: ['torso', 'thigh'], leg_curl: ['torso', 'thigh'], leg_ext: ['torso', 'thigh'],
  leg_press: ['torso'], row_chest: ['torso'], pulldown: ['thigh'], row_cable: ['thigh'], fly_pec: ['hip'], rev_fly_machine: ['hip'], bike_int: ['hip'],
};
const gp = { rest: [], sink: [], sled: [], smith: [], rack: [], dip: [], held: [], rower: [], bike: [], belt: [], pivot: [], lever: [], cable: [] };
const TOL = 3; // cm of air allowed between the body and what it rests on
const SQUASH = 4; // cm a pad may compress under the body
const touching = (g) => g >= -SQUASH && g <= TOL;
for (const id of gymIds) {
  const m = M.forPerson(M.MOVES[id], GYM_EQ);
  const fr = frames(m);
  const surf = surfacesOf(m);
  const props = m.props || [];
  const levers = [];
  for (const { name, pts } of fr) {
    const at = `${id}@${name}`;
    const torso = [pts.neck, pts.hip, segs2(m).torso];
    const thighs = ['N', 'F'].map((s) => [pts['hp' + s], pts['kn' + s], P.W.th / 2]);
    // Rests on its supports, never sinks into one.
    for (const part of REST[id] || []) {
      const gaps = [];
      if (part === 'torso') for (const s of surf) gaps.push(gap(torso[0], torso[1], torso[2], s));
      if (part === 'thigh') for (const s of surf) for (const t of thighs) gaps.push(gap(t[0], t[1], t[2], s));
      // Seated hips sit 9 above the seat top (positive: floating, negative: sunk in).
      if (part === 'hip') for (const s of surf) if (s.n[1] < -0.9) gaps.push(s.a[1] - pts.hip[1] - 9);
      if (!gaps.some(touching)) gp.rest.push(`${at}: ${part} ${gaps.map((g) => g.toFixed(1)).join('/')} from its supports`);
    }
    if ((m.view || 'side') === 'side') for (const s of surf) { const g = gap(torso[0], torso[1], torso[2], s); if (g < -SQUASH) gp.sink.push(`${at}: torso ${g.toFixed(1)} into the ${s.prop.type}`); }
    for (const p of props) {
      if (p.type === 'machine' && p.kind === 'legPress') {
        // The foot plate (under the soles) slides on the track line.
        const sole = P.dir(pts.footDirN - 90);
        const pc = [(pts.heN[0] + pts.toN[0]) / 2 + sole[0] * 5.5, (pts.heN[1] + pts.toN[1]) / 2 + sole[1] * 5.5];
        const u = P.dir(90 + (p.angle || 45));
        const off = Math.abs((pc[0] - p.track[0]) * u[1] - (pc[1] - p.track[1]) * u[0]);
        if (off > 1.5) gp.sled.push(`${at}: plate ${off.toFixed(1)} off the track`);
      }
      if (p.type === 'smith') {
        const e = (m.equip || []).find((q) => q.type === 'bb');
        const bar = e.hold ? P.pinPoint(pts, e.hold) : P.pinPoint(pts, 'grip');
        if (Math.abs(bar[0] - p.x) > 2) gp.smith.push(`${at}: bar ${(bar[0] - p.x).toFixed(1)} off the rail`);
      }
      if (p.type === 'dip') {
        const g = P.pinPoint(pts, 'grip');
        if (Math.abs(g[1] + p.h) > TOL || Math.abs(g[0] - p.x) > (p.len || 56) / 2) gp.dip.push(`${at}: hands off the bars`);
      }
      if (p.type === 'rower') {
        if (Math.abs(pts.hip[1] + (p.h || 36) + 9) > 2) gp.rower.push(`${at}: hip off the seat`);
      }
      if (p.type === 'bike') {
        for (const s of ['N', 'F']) {
          const fd = pts['footDir' + s];
          const ball = [pts['an' + s][0] + P.dir(fd)[0] * 9 + P.dir(fd - 90)[0] * 3.5, pts['an' + s][1] + P.dir(fd)[1] * 9 + P.dir(fd - 90)[1] * 3.5];
          const r = Math.hypot(ball[0] - p.x, ball[1] - (p.y == null ? -30 : p.y));
          if (Math.abs(r - (p.crank || 17)) > 2) gp.bike.push(`${at}.${s}: pedal ${r.toFixed(1)} from the axle`);
        }
      }
      if (p.type === 'treadmill') {
        // The lower foot touches the belt (foot line 5.5 ± 3 above it) and nothing goes through it.
        const inc = (p.incline || 0) * Math.PI / 180;
        const above = (q) => (-(p.h || 20) - (q[0] - p.x) * Math.tan(inc)) - q[1];
        const feet = ['N', 'F'].map((s) => Math.min(above(pts['he' + s]), above(pts['to' + s])));
        const low = Math.min(...feet);
        if (low < 5.5 - TOL || low > 5.5 + TOL) gp.belt.push(`${at}: lower foot ${low.toFixed(1)} above the belt`);
      }
      if (p.type === 'machine' && (p.kind === 'legCurl' || p.kind === 'legExt')) {
        const d = Math.hypot(pts.knN[0] - p.pivot[0], pts.knN[1] - p.pivot[1]);
        if (d > 2.5) gp.pivot.push(`${at}: knee ${d.toFixed(1)} from the pivot`);
      }
      if (p.type === 'machine' && (p.kind === 'chestPress' || p.kind === 'shoulderPress')) {
        const g = P.pinPoint(pts, 'grip');
        levers.push(Math.hypot(g[0] - p.pivot[0], g[1] - p.pivot[1]));
      }
    }
    // A bar on the back or the hips stays in the hands.
    for (const e of m.equip || []) if (e.hold) {
      const bar = P.pinPoint(pts, e.hold), g = P.pinPoint(pts, 'grip');
      if (Math.hypot(bar[0] - g[0], bar[1] - g[1]) > 2) gp.held.push(`${at}: hands ${Math.hypot(bar[0] - g[0], bar[1] - g[1]).toFixed(1)} off the bar`);
    }
    // Cables run from a pulley to a finite clip in the hands' attachment.
    for (const r of P.cableRuns(m, pts)) if (![...r.clip, ...r.pulley].every(Number.isFinite) || r.clip[1] > 0) gp.cable.push(`${at}: cable`);
  }
  if (levers.length && (Math.max(...levers) - Math.min(...levers)) / Math.max(...levers) > 0.1) gp.lever.push(`${id}: lever stretches ${(Math.max(...levers) - Math.min(...levers)).toFixed(1)}`);
  // The racked bar sits a little above the J-hooks when standing tall.
  const rack = props.find((p) => p.type === 'rack');
  if (rack && ['squat_bb', 'ohp_bb'].includes(id)) {
    const e = m.equip.find((q) => q.type === 'bb');
    const top = Math.min(...fr.map(({ pts }) => (e.hold ? P.pinPoint(pts, e.hold) : P.pinPoint(pts, 'grip'))[1]));
    const low = Math.max(...fr.map(({ pts }) => (e.hold ? P.pinPoint(pts, e.hold) : P.pinPoint(pts, 'grip'))[1]));
    const racked = id === 'squat_bb' ? top : low; // squat unracks standing tall; the press starts at the shoulders
    if (!(-racked - rack.h >= 2 && -racked - rack.h <= 15)) gp.rack.push(`${id}: bar ${(-racked - rack.h).toFixed(1)} above the hooks`);
  }
}
check('the body rests on its bench, seat, pad or saddle in every frame', !gp.rest.length, gp.rest.slice(0, 6));
check('nobody sinks into a pad', !gp.sink.length, gp.sink.slice(0, 6));
check('leg press: the foot plate slides along its track', !gp.sled.length, gp.sled.slice(0, 6));
check('Smith machine: the bar stays on the rail', !gp.smith.length, gp.smith.slice(0, 6));
check('rack: the bar starts just above the J-hooks', !gp.rack.length, gp.rack);
check('dips: hands stay on the bars', !gp.dip.length, gp.dip.slice(0, 6));
check('a bar on the back or hips stays in the hands', !gp.held.length, gp.held.slice(0, 6));
check('rower: the hips ride the seat', !gp.rower.length, gp.rower.slice(0, 6));
check('bike: the feet stay on the pedals', !gp.bike.length, gp.bike.slice(0, 6));
check('treadmill: a foot is always on the belt', !gp.belt.length, gp.belt.slice(0, 6));
check('leg curl and extension: knees on the machine pivot', !gp.pivot.length, gp.pivot.slice(0, 6));
check('chest and shoulder press levers keep their length', !gp.lever.length, gp.lever);
check('cables run from a pulley to the hands', !gp.cable.length, gp.cable.slice(0, 6));

done();
