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
  if (lad.rungs.length < 4) ladderBad.push(`${fam}: fewer than 4 rungs`);
  for (const id of lad.rungs) if (!M.MOVES[id] || M.MOVES[id].family !== fam) ladderBad.push(`${fam}: ${id}`);
}
check('every ladder has 4+ rungs, all known, all tagged with their family', !ladderBad.length, ladderBad);
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
      const bend = s[0] === 'a' ? f[`${s}.e`] : f[`${s}.k`];
      if (bend != null && (bend < -12 || bend > 178)) problems.joints.push(`${id}@${name}.${s}=${bend}`);
    }
  }
  try { const dl = P.drawList(m, fr[0].pts, {}); if (!dl || !dl.layers) problems.draw.push(id); } catch (e) { problems.draw.push(`${id}: ${e.message}`); }
}
check('all joints finite in every keyframe and in-between frame', !problems.finite.length, problems.finite.slice(0, 6));
check('nothing goes through the floor (side and front views)', !problems.floor.length, problems.floor.slice(0, 6));
check('planted hands and feet are always reachable (IK)', !problems.reach.length, problems.reach.slice(0, 6));
check('elbows and knees stay in a human range', !problems.joints.length, problems.joints.slice(0, 6));
check('every move builds a draw list', !problems.draw.length, problems.draw.slice(0, 6));

done();
