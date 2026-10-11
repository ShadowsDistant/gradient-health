/* 3D exercise figure: a realistic, procedurally built person that performs any move of the 2D pose
 * engine (GH.pose). Nothing here authors poses. Every frame the 2D joints from GH.pose.sampleAt /
 * solve are lifted into 3D (side view: lateral offsets; front view: depth recovered from the
 * foreshortening; top view: the figure laid on the floor), then each limb is re-solved in 3D with
 * its true segment lengths, so meshes never stretch and planted hands and feet stay put.
 *
 * Loaded on demand with GH.lazy('figure3d'); it sets GH.figure3d = { supported, mount, still,
 * stillAsync, stillNow, preload, warm, stillsReady }. One shared WebGLRenderer draws every mounted
 * figure and copies each frame into that figure's own 2D canvas, so any number of figures can be on
 * screen with a single GL context.
 *
 * Units are centimetres. World axes: +Y up, floor at Y = 0. Side-view moves face +X with the near
 * ("N") limbs at +Z; front-view moves face +Z with N (the figure's left) at +X.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, MeshDepthMaterial,
  ShaderMaterial, HemisphereLight, DirectionalLight, Color, Vector3, Quaternion, Matrix4, CanvasTexture,
  SphereGeometry, CylinderGeometry, PlaneGeometry, CircleGeometry, TubeGeometry, CatmullRomCurve3,
  WebGLRenderTarget, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace, LinearFilter, Euler,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const PZ = () => GH.pose;

/* ---------------------------------------------------------------- constants */
const SKINS = { porcelain: '#efcfbc', sand: '#d9a982', olive: '#b17c4e', umber: '#7d4c2d', ebony: '#482c1c' };
const HAIRS = { porcelain: '#5b412f', sand: '#3a2a1f', olive: '#221913', umber: '#1b1411', ebony: '#141010' };
const MUSCLES = ['chest', 'abs', 'obliques', 'upperBack', 'lats', 'lowerBack', 'glutes', 'hipFlexors', 'quads', 'hamstrings', 'calves', 'biceps', 'triceps', 'forearms', 'frontDelts', 'sideDelts', 'rearDelts'];
const MI = {};
MUSCLES.forEach((m, i) => { MI[m] = i + 1; });
const NM = MUSCLES.length + 1; // slot 0 is "no muscle"
const CORE_MUSCLES = new Set(['chest', 'abs', 'obliques', 'upperBack', 'lats', 'lowerBack', 'glutes', 'hipFlexors']);
const BACK_MUSCLES = new Set(['rearDelts', 'upperBack', 'lats', 'lowerBack']);
const SIDES = ['N', 'F'];
const SH_W = 18; // shoulder joint half-width
const HIP_W = 8.5; // hip joint half-width
const SEAT_H = 45;

/* ---------------------------------------------------------------- math */
const D2R = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const band = (x, a, b, e) => smooth(a - e, a + e, x) * (1 - smooth(b - e, b + e, x));
const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
const wrapA = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };
const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
const V3 = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const Y_UP = V3(0, 1, 0);
const _m4 = new Matrix4();
const dir2 = (deg) => [Math.sin(deg * D2R), Math.cos(deg * D2R)];

function anyPerp(v) {
  const a = Math.abs(v.y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0);
  return a.addScaledVector(v, -a.dot(v)).normalize();
}
// Component of v perpendicular to the unit vector n.
const perp = (v, n) => v.clone().addScaledVector(n, -v.dot(n));
// Which way a hinge (elbow, knee) faces, for the segment `a` whose child segment is `b`: the way
// `b` bends, except that a slight bend keeps the segment's natural rotation. A soft elbow drawn in
// the picture plane of a front view is the carrying angle, not an upper arm turned through 90°.
function hinge(a, b, natural) {
  const an = a.clone().normalize();
  const bent = perp(b, an);
  // By the sine of the bend, from 12° to 37°: a knee starting to bend fast (a step, a hop) turns
  // its front over several frames rather than two.
  const k = smooth(0.2, 0.6, bent.length() / (b.length() || 1));
  const nat = natural.lengthSq() > 1e-6 ? natural.clone().normalize() : perp(bent, an);
  if (k <= 0) return nat;
  const out = bent.normalize().multiplyScalar(k).addScaledVector(nat, 1 - k);
  return out.lengthSq() > 0.04 ? out : bent;
}
// An elbow's front (ua, fa unit): the bend's own plane only once it's clearly bent (past 50°);
// below that it blends into the hinge track's front (nat, unit and square to ua). At a slight
// bend the elbow sits a centimetre or two off the shoulder–wrist line, so the plane it makes swings
// with every nudge of the wrist.
const ARM_BENT = 50;
function armHinge(ua, fa, nat) {
  const ang = Math.acos(clamp(ua.dot(fa), -1, 1)) / D2R;
  const k = smooth(20, ARM_BENT, ang);
  if (k <= 0) return nat.clone();
  const bent = perp(fa, ua);
  if (bent.lengthSq() < 1e-8) return nat.clone();
  const out = bent.normalize().multiplyScalar(k).addScaledVector(nat, 1 - k);
  return out.lengthSq() > 0.04 ? out.normalize() : bent;
}
// The front of a straight upper arm: the hanging arm's front (the trunk's forward) swung up with
// the arm and not twisted, so it faces up in a front raise and stays forward in a lateral raise.
// Near overhead the swing is ambiguous; the front then stays forward, as when hanging from a bar.
function armFront(ua, up, fwd) {
  const u = ua.clone().normalize();
  const down = up.clone().negate();
  const c = u.dot(down);
  const w = smooth(-0.3, -0.85, c);
  const out = fwd.clone().multiplyScalar(w);
  if (c > -0.995) out.addScaledVector(fwd.clone().applyQuaternion(new Quaternion().setFromUnitVectors(down, u)), 1 - w);
  return out;
}
// Signed angle (radians) from a to b about the unit axis n.
const signedAngle = (a, b, n) => Math.atan2(n.dot(V3().crossVectors(a, b)), a.dot(b));
// v carried from a limb pointing along u0 to one pointing along u1 without spinning about itself
// (turned by the shortest arc between the two), kept square to u1.
function carry(v, u0, u1) {
  const w = u0.dot(u1) > -0.9 ? v.clone().applyQuaternion(new Quaternion().setFromUnitVectors(u0, u1)) : v.clone();
  const p = perp(w, u1);
  return p.lengthSq() > 1e-8 ? p.normalize() : anyPerp(u1);
}
// Rotation whose +Y is `y` and whose +Z is as close to `z` as possible.
function frameQ(y, z, out) {
  const Y = y.clone().normalize();
  let Z = perp(z, Y);
  if (Z.lengthSq() < 1e-8) Z = anyPerp(Y);
  Z.normalize();
  const X = V3().crossVectors(Y, Z);
  _m4.makeBasis(X, Y, Z);
  return (out || new Quaternion()).setFromRotationMatrix(_m4);
}
// Rotate v about the world-vertical axis.
const yaw = (v, ang) => v.clone().applyAxisAngle(Y_UP, ang);

// Two-bone IK from root R to target T with lengths a, b. The bend goes toward pole point P, turned
// by `swing` radians about the root→target axis toward the direction `out` (or the way `sign`
// says, +1 or -1, when given: the side it's turning to already). soft: near full stretch the limb
// straightens gradually instead of snapping straight (the end may stop a little short), for a
// hand that isn't planted on anything.
function ik2(R, T, a, b, P, out, swing, sign, soft) {
  const d = T.clone().sub(R);
  let dist = d.length();
  const dn = dist > 1e-6 ? d.divideScalar(dist) : V3(0, -1, 0);
  const reach = dist <= a + b + 0.05;
  // soft (0..1): how far a reach near full length eases off instead of locking the joint straight.
  if (soft) { const s0 = (a + b) * 0.96; if (dist > s0) dist = lerp(dist, s0 + (a + b - s0) * (1 - Math.exp(-(dist - s0) / (a + b - s0))), +soft); }
  dist = clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const x = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  let pv = perp(P.clone().sub(R), dn);
  if (pv.lengthSq() < 1e-6) pv = out ? perp(out, dn) : anyPerp(dn);
  if (pv.lengthSq() < 1e-6) pv = anyPerp(dn);
  pv.normalize();
  let s = 0;
  if (out) {
    const b2 = V3().crossVectors(dn, pv);
    s = sign || (b2.dot(out) >= 0 ? 1 : -1);
    if (swing) pv.multiplyScalar(Math.cos(swing)).addScaledVector(b2, s * Math.sin(swing)).normalize();
  }
  return { mid: R.clone().addScaledVector(dn, x).addScaledVector(pv, h), end: R.clone().addScaledVector(dn, dist), reach, dn, pv, sign: s };
}

/* ---------------------------------------------------------------- geometry builders */
// A smooth closed solid along +Y from cross-section stations [y, w, f, b, ox, oz, tilt]: w is the
// half-width on ±X, f/b the depth toward +Z/−Z, (ox, oz) the ring centre, tilt a slope of the ring
// along Z. Rings are Catmull-Rom interpolated; the ends close with rounded caps.
// o: seg, step, n (superellipse exponent), capLo/capHi (dome lengths), bumps [{y0, y1, th, sw, a}],
// ys (extra ring heights), off(y) radial offset, group(y) material index, muscle(x, y, z, th).
function solid(st, o = {}) {
  const seg = o.seg || 32;
  const S = st.map((s) => ({ y: s[0], w: s[1], f: s[2], b: s[3], ox: s[4] || 0, oz: s[5] || 0, t: s[6] || 0 }));
  const K = ['w', 'f', 'b', 'ox', 'oz', 't'];
  const at = (y) => {
    let i = 0;
    while (i < S.length - 2 && y > S[i + 1].y) i++;
    const a = S[i], b = S[i + 1], a0 = S[Math.max(0, i - 1)], b1 = S[Math.min(S.length - 1, i + 2)];
    const u = clamp((y - a.y) / (b.y - a.y || 1), 0, 1);
    const r = { y };
    for (const k of K) r[k] = cr(a0[k], a[k], b[k], b1[k], u);
    return r;
  };
  const y0 = S[0].y, y1 = S[S.length - 1].y;
  const step = o.step || 1;
  let ys = [];
  const n = Math.max(1, Math.round((y1 - y0) / step));
  for (let i = 0; i <= n; i++) ys.push(y0 + ((y1 - y0) * i) / n);
  for (const y of o.ys || []) if (y > y0 && y < y1) ys.push(y);
  ys.sort((a, b) => a - b);
  ys = ys.filter((y, i) => i === 0 || y - ys[i - 1] > 0.04);
  const rings = ys.map((y) => {
    const r = at(y);
    const d = o.off ? o.off(y) : 0;
    if (d) { r.w += d; r.f += d; r.b += d; }
    return r;
  });
  const capRings = (end, len, dirn) => {
    const out = [];
    const cs = o.capSeg || 6;
    for (let k = 1; k < cs; k++) {
      const ph = (k / cs) * Math.PI * 0.5;
      const c = Math.cos(ph);
      out.push({ y: end.y + dirn * len * Math.sin(ph), w: end.w * c, f: end.f * c, b: end.b * c, ox: end.ox, oz: end.oz, t: end.t * c, cap: true });
    }
    return out;
  };
  const lo = o.capLo != null ? o.capLo : Math.min(rings[0].w, rings[0].f) * 0.7;
  const hi = o.capHi != null ? o.capHi : Math.min(rings[rings.length - 1].w, rings[rings.length - 1].f) * 0.7;
  const bottom = capRings(rings[0], lo, -1).reverse();
  const top = capRings(rings[rings.length - 1], hi, 1);
  const all = bottom.concat(rings, top);
  const pe = 2 / (o.n || 2);
  const pos = [], mus = [];
  const pushV = (x, y, z, th) => {
    pos.push(x, y, z);
    if (o.muscle) {
      // Up to four muscles per vertex, each packed as id + weight (the weight in the fraction).
      const m = o.muscle(x, y, z, th).filter((e) => e[1] > 0.02).sort((a, b) => b[1] - a[1]);
      for (let k = 0; k < 4; k++) mus.push(m[k] ? m[k][0] + Math.min(0.999, m[k][1]) : 0);
    } else mus.push(0, 0, 0, 0);
  };
  const poleLo = { y: rings[0].y - lo, ox: rings[0].ox, oz: rings[0].oz };
  const poleHi = { y: rings[rings.length - 1].y + hi, ox: rings[rings.length - 1].ox, oz: rings[rings.length - 1].oz };
  pushV(poleLo.ox, poleLo.y, poleLo.oz, 0);
  for (const r of all) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      let x = r.ox + r.w * Math.sign(c) * Math.pow(Math.abs(c), pe);
      let z = r.oz + (s >= 0 ? r.f : r.b) * Math.sign(s) * Math.pow(Math.abs(s), pe);
      const y = r.y + (z - r.oz) * r.t;
      if (o.bumps) {
        let d = 0;
        for (const bp of o.bumps) {
          if (y <= bp.y0 || y >= bp.y1) continue;
          d += bp.a * Math.sin((Math.PI * (y - bp.y0)) / (bp.y1 - bp.y0)) * gauss(wrapA(th - bp.th), bp.sw);
        }
        if (d) { const l = Math.hypot(x - r.ox, z - r.oz) || 1; x += ((x - r.ox) / l) * d; z += ((z - r.oz) / l) * d; }
      }
      pushV(x, y, z, th);
    }
  }
  pushV(poleHi.ox, poleHi.y, poleHi.oz, 0);
  const groups = new Map();
  const tri = (g, a, b, c) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a, b, c); };
  const R = all.length;
  const base = (i) => 1 + i * seg;
  const grp = (y) => (o.group ? o.group(y) : 0);
  for (let j = 0; j < seg; j++) tri(grp(all[0].y), 0, base(0) + j, base(0) + ((j + 1) % seg));
  for (let i = 0; i < R - 1; i++) {
    const g = grp((all[i].y + all[i + 1].y) / 2);
    for (let j = 0; j < seg; j++) {
      const a = base(i) + j, b = base(i) + ((j + 1) % seg), c = base(i + 1) + j, d = base(i + 1) + ((j + 1) % seg);
      tri(g, a, c, b); tri(g, b, c, d);
    }
  }
  const last = 1 + R * seg;
  for (let j = 0; j < seg; j++) tri(grp(all[R - 1].y), last, base(R - 1) + ((j + 1) % seg), base(R - 1) + j);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('muscle', new Float32BufferAttribute(mus, 4));
  const idx = [];
  const keys = [...groups.keys()].sort((a, b) => a - b);
  for (const k of keys) { geo.addGroup(idx.length, groups.get(k).length, k); idx.push(...groups.get(k)); }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// The mirror image across X (left limbs are mirrored right limbs).
function mirrorX(src) {
  const g = src.clone();
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name];
    for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
  }
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  for (const k of Object.keys(g.morphAttributes)) {
    for (const a of g.morphAttributes[k]) for (let i = 0; i < a.count; i++) a.setX(i, -a.getX(i));
  }
  return g;
}

// Concatenate indexed geometries (position, normal, muscle) into one, keeping their groups.
function mergeGeos(list) {
  const pos = [], nor = [], mus = [], idx = [];
  let off = 0;
  const groups = [];
  for (const g of list) {
    const p = g.attributes.position, nn = g.attributes.normal, m = g.attributes.muscle;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nn.getX(i), nn.getY(i), nn.getZ(i));
      if (m) mus.push(m.getX(i), m.getY(i), m.getZ(i), m.getW(i)); else mus.push(0, 0, 0, 0);
    }
    const ix = g.index.array;
    const start = idx.length;
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
    const gg = g.groups.length ? g.groups : [{ start: 0, count: ix.length, materialIndex: 0 }];
    for (const q of gg) groups.push({ start: start + q.start, count: q.count, materialIndex: q.materialIndex });
    off += p.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('muscle', new Float32BufferAttribute(mus, 4));
  out.setIndex(idx);
  // Merge consecutive groups that share a material.
  groups.sort((a, b) => a.materialIndex - b.materialIndex || a.start - b.start);
  const idx2 = [];
  for (const q of groups) {
    const start = idx2.length;
    for (let i = q.start; i < q.start + q.count; i++) idx2.push(idx[i]);
    const prev = out.groups[out.groups.length - 1];
    if (prev && prev.materialIndex === q.materialIndex && prev.start + prev.count === start) prev.count += q.count;
    else out.addGroup(start, q.count, q.materialIndex);
  }
  out.setIndex(idx2);
  return out;
}

// Apply a matrix to positions and normals in place.
function xform(g, m) {
  g.applyMatrix4(m);
  return g;
}

// Merge the rigid meshes of a group into one mesh per material (fewer draw calls for props and
// equipment). Meshes marked userData.dyn move on their own and are left alone. Returns the new
// geometries, which the caller owns.
function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map(), drop = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.dyn || Array.isArray(o.material)) return;
    let dyn = false;
    for (let p = o.parent; p && p !== group; p = p.parent) if (p.userData.dyn) dyn = true;
    if (dyn) return;
    const g = o.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
    drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  const out = [];
  for (const [mat, list] of byMat) {
    const pos = [], nor = [], idx = [];
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, off = pos.length / 3;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
      if (g.index) for (const i of g.index.array) idx.push(i + off);
      else for (let i = 0; i < p.count; i++) idx.push(i + off);
      g.dispose();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    group.add(new Mesh(geo, mat));
    out.push(geo);
  }
  return out;
}

/* ---------------------------------------------------------------- body shapes */
// Chest and belly (the t-shirt), from the hip-joint level (y = 0) to the base of the neck.
const CHEST = [
  [7.5, 16.4, 10.9, 10.8, 0, -0.3],
  [11, 15.5, 10.3, 10.0, 0, 0.2],
  [16, 14.3, 9.7, 9.4, 0, 0.6],
  [22, 14.7, 10.0, 9.8, 0, 0.6],
  [28, 15.8, 10.8, 10.5, 0, 0.6],
  [33.5, 16.8, 11.5, 11.1, 0, 0.6],
  [38.5, 17.1, 11.9, 11.3, 0, 0.6],
  [43.5, 16.9, 11.7, 11.2, 0, 0.4],
  [47.5, 16.7, 10.7, 10.6, 0, 0],
  [50.5, 16.5, 9.0, 9.4, 0, -0.6, -0.1],
  [53, 12.4, 7.2, 7.8, 0, -1.1, -0.18],
  [55, 7.9, 6.6, 6.9, 0, -1.5, -0.24],
  [55.9, 7.0, 6.2, 6.5, 0, -1.7, -0.26],
];
// Pecs, sternum and spine grooves, lats and shoulder blades on the chest piece.
const CHEST_BUMPS = [
  { y0: 32.5, y1: 48.5, th: Math.PI / 2 - 0.5, sw: 0.42, a: 1.25 },
  { y0: 32.5, y1: 48.5, th: Math.PI / 2 + 0.5, sw: 0.42, a: 1.25 },
  { y0: 33, y1: 49, th: Math.PI / 2, sw: 0.11, a: -0.45 },
  { y0: 9, y1: 52, th: Math.PI * 1.5, sw: 0.1, a: -0.45 },
  { y0: 25, y1: 47, th: Math.PI * 1.5 - 1.1, sw: 0.34, a: 0.75 },
  { y0: 25, y1: 47, th: Math.PI * 1.5 + 1.1, sw: 0.34, a: 0.75 },
  { y0: 35, y1: 51, th: Math.PI * 1.5 - 0.55, sw: 0.3, a: 0.45 },
  { y0: 35, y1: 51, th: Math.PI * 1.5 + 0.55, sw: 0.3, a: 0.45 },
];
// Hips and seat (the shorts).
const PELVIS = [
  [-7.5, 13.2, 7.0, 9.6, 0, -1.6],
  [-4.5, 15.8, 8.1, 10.9, 0, -1.6],
  [-1, 17.0, 8.8, 11.0, 0, -1.3],
  [3, 16.9, 9.2, 10.5, 0, -0.9],
  [7, 15.6, 9.6, 9.8, 0, -0.4],
  [10.5, 14.7, 9.6, 9.3, 0, 0],
  [13, 14.0, 9.3, 8.9, 0, 0.2],
];
// Right limbs: +Y distal, +Z anterior, +X lateral (the body's right).
const UARM = [
  [-2.5, 5.4, 5.2, 5.4, 0.3],
  [0.5, 5.9, 5.6, 5.8, 0.5],
  [4, 5.8, 5.5, 5.6, 0.6],
  [8, 5.4, 5.2, 5.3, 0.4],
  [12, 4.9, 5.3, 5.4, 0.2],
  [16, 4.6, 5.6, 5.5, 0],
  [20, 4.4, 5.3, 5.1, 0],
  [24, 4.2, 4.5, 4.4, 0],
  [27, 4.1, 3.8, 4.0, 0, -0.1],
  [29, 4.2, 3.5, 4.0, 0, -0.2],
];
const FARM = [
  [0, 4.3, 3.6, 3.9, 0, -0.3],
  [3, 4.7, 4.1, 3.9, 0.2],
  [6.5, 4.8, 4.1, 3.7, 0.3],
  [10, 4.3, 3.6, 3.4, 0.2],
  [15, 3.6, 2.9, 2.9, 0.1],
  [20, 3.1, 2.3, 2.3, 0],
  [24.5, 2.9, 2.0, 2.1, 0],
];
const THIGH = [
  [-1, 8.7, 8.3, 9.0, 1.2, -0.4],
  [3, 8.8, 8.6, 8.9, 1.3],
  [8, 8.3, 8.3, 8.2, 1.0],
  [13, 7.7, 8.0, 7.5, 0.6],
  [19, 7.1, 7.6, 7.0, 0.3],
  [25, 6.6, 7.1, 6.4, 0.1],
  [31, 6.0, 6.5, 5.7, 0],
  [36.5, 5.5, 5.9, 5.0, 0],
  [40.5, 5.3, 5.4, 4.8, 0],
  [43, 5.3, 5.1, 4.9, 0],
];
const SHIN = [
  [0, 5.3, 4.9, 4.9, 0],
  [3, 5.1, 4.5, 5.1, 0],
  [8, 5.3, 4.1, 6.3, 0, -0.3],
  [13, 5.6, 4.0, 6.8, 0, -0.4],
  [18, 5.1, 3.8, 6.0, 0, -0.3],
  [24, 4.3, 3.5, 4.7, 0],
  [30, 3.6, 3.2, 3.5, 0],
  [35, 3.3, 3.0, 3.2, 0],
  [39.5, 3.4, 3.2, 3.5, 0],
  [42, 3.6, 3.3, 3.6, 0],
];
const NECK = [
  [-4, 6.2, 5.9, 6.3],
  [2, 5.8, 5.4, 5.9],
  [7, 5.2, 4.8, 5.3],
  [11.5, 5.0, 4.6, 5.0],
];
// Trainer, along the foot (+Y toward the toes) from the ankle: [y, half-width, bottom, top].
const SHOE = [
  [-6.3, 3.4, -7.1, -1.0],
  [-4.6, 4.1, -7.2, 0.8],
  [-1.5, 4.4, -7.2, 1.0],
  [1.5, 4.6, -7.1, -0.6],
  [5, 4.9, -7.0, -1.9],
  [9, 5.1, -6.9, -3.1],
  [12.5, 5.1, -6.8, -4.0],
  [15.5, 4.7, -6.7, -4.5],
  [17.6, 3.6, -6.5, -4.9],
];

// Points on the shoe's sole and toe (foot frame) that must stay above the floor.
const FOOT_PROBES = [V3(0, 18.4, -6.2), V3(0, 16.5, -7.6), V3(0, 12, -8), V3(0, -4.5, -8), V3(0, -7.2, -5), V3(4.8, 11, -7.9), V3(-4.8, 11, -7.9), V3(3.8, -3, -7.9), V3(-3.8, -3, -7.9)];

/* ---------------------------------------------------------------- muscle maps */
// Each returns [[muscleId, weight], …] for a vertex; θ: 0 lateral (+X), π/2 front, π medial, 3π/2 back.
const ang = (th, c, w) => gauss(wrapA(th - c), w);
const MAPS = {
  chest(x, y, z) {
    const ax = Math.abs(x);
    const front = smooth(1, 6, z);
    const back = smooth(0, -5, z);
    // The pecs' lower edge curves up toward the armpit, so the glow reads as a muscle, not a patch.
    const low = 32 + 0.035 * ax * ax;
    const trapW = clamp(3 + (y - 24) * 0.5, 0, 15);
    return [
      [MI.chest, band(y, low + 1, 48, 2.5) * band(ax, 1.2, 15.5, 1.4) * front],
      [MI.abs, band(y, 9, 32, 2) * (1 - smooth(7, 10, ax)) * smooth(3, 7, z)],
      [MI.obliques, band(y, 9, 30, 3) * smooth(6.5, 10, ax) * smooth(-7, -1, z)],
      // Trapezius and rhomboids: a kite from the neck and shoulders down to a point mid-back.
      [MI.upperBack, Math.max(band(y, 24, 57, 2.5) * (1 - smooth(trapW - 3, trapW + 3, ax)) * back, smooth(51, 54, y) * smooth(4, -2, z) * (1 - smooth(14, 17, ax)))],
      [MI.lats, band(y, 21, 45, 3) * gauss(ax - (4 + (y - 21) * 0.48), 4.5) * smooth(2, -4, z)],
      [MI.lowerBack, band(y, 7, 27, 3) * band(ax, 0.8, 7, 1.2) * smooth(-2, -6, z)],
    ];
  },
  pelvis(x, y, z) {
    const ax = Math.abs(x);
    return [
      [MI.glutes, band(y, -10, 8, 2.5) * smooth(-2, -6, z) * band(ax, 1, 16.5, 2)],
      [MI.hipFlexors, band(y, -4, 7, 2) * band(ax, 5, 15, 2) * smooth(3, 7, z)],
      [MI.abs, band(y, 6, 16, 2) * (1 - smooth(7, 10, ax)) * smooth(4, 8, z)],
      [MI.lowerBack, band(y, 5, 16, 2) * band(ax, 1, 7, 1.2) * smooth(-3, -7, z)],
      [MI.obliques, band(y, 5, 16, 2) * smooth(6.5, 10, ax) * smooth(-7, -1, z)],
    ];
  },
  uarm(x, y, z, th) {
    const top = band(y, -8, 11, 2.5);
    return [
      [MI.frontDelts, top * ang(th, Math.PI * 0.62, 0.62)],
      [MI.sideDelts, top * ang(th, Math.PI * 0.05, 0.9)], // wide: it caps the shoulder, visible from the front when the arm is up
      [MI.rearDelts, top * ang(th, Math.PI * 1.45, 0.62)],
      [MI.biceps, band(y, 10, 26, 2.5) * ang(th, Math.PI * 0.5, 0.95)],
      [MI.triceps, band(y, 6, 26, 2.5) * ang(th, Math.PI * 1.5, 1.1)],
    ];
  },
  farm(x, y, z, th) {
    return [[MI.forearms, band(y, 0.5, 17, 2.5) * (0.7 + 0.3 * ang(th, Math.PI * 0.3, 1.2))]];
  },
  thigh(x, y, z, th) {
    return [
      [MI.quads, band(y, 4, 40, 3) * ang(th, Math.PI * 0.5, 1.15)],
      [MI.hamstrings, band(y, 8, 40, 3) * ang(th, Math.PI * 1.5, 1.0)],
      [MI.hipFlexors, band(y, -4, 9, 2) * ang(th, Math.PI * 0.62, 0.7)],
      [MI.glutes, band(y, -8, 5, 2) * ang(th, Math.PI * 1.45, 0.9)],
    ];
  },
  shin(x, y, z, th) {
    return [[MI.calves, band(y, 2, 25, 3) * ang(th, Math.PI * 1.5, 1.1)]];
  },
};

/* ---------------------------------------------------------------- body geometry */
let BODY = null;
// Hands: open (flat), relaxed (curled a little) and a fist around a 3.5 cm handle. Right hand:
// +Y toward the fingertips, +Z out of the palm, +X toward the thumb.
const HAND_GRIP = V3(0, 8.9, 2.75); // handle centre inside the fist
function bendFingers(g, y0, R) {
  if (!isFinite(R)) return g;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    if (y <= y0) continue;
    const phi = (y - y0) / R;
    p.setY(i, y0 + (R - z) * Math.sin(phi));
    p.setZ(i, R - (R - z) * Math.cos(phi));
  }
  g.computeVertexNormals();
  return g;
}
function handGeo(kind) {
  // Palm and fingers are one solid (no seam at the knuckles); the fingers curl past the knuckles.
  const groove = (th) => ({ y0: 10.6, y1: 18.2, th, sw: 0.09, a: -0.24 });
  const g1 = Math.acos(Math.pow(0.5, 1.25));
  const hand = solid([
    [-0.8, 2.65, 1.45, 1.25, 0.1],
    [1.2, 3.3, 1.75, 1.3, 0.2],
    [4.2, 3.95, 1.85, 1.28, 0.1],
    [7.2, 4.2, 1.5, 1.22, 0],
    [9.0, 4.12, 1.18, 1.12, -0.05],
    [11.5, 3.95, 1.05, 1.0, -0.05],
    [14.5, 3.72, 0.96, 0.9, 0],
    [16.8, 3.2, 0.86, 0.8, 0],
  ], { seg: 40, n: 2.5, capLo: 1.4, capHi: 1.3, step: 0.55, bumps: [groove(g1), groove(Math.PI - g1), groove(Math.PI / 2), groove(Math.PI + g1), groove(2 * Math.PI - g1), groove(Math.PI * 1.5)] });
  bendFingers(hand, 8.9, kind === 'fist' ? 2.75 : kind === 'relaxed' ? 9 : Infinity);
  const thumb = solid([
    [-1.2, 1.55, 1.5, 1.45],
    [1.8, 1.5, 1.45, 1.35],
    [5, 1.25, 1.18, 1.1],
    [7.8, 1.12, 1.02, 0.98],
  ], { seg: 18, capLo: 0.8, capHi: 1.05, step: 0.8 });
  const T = {
    open: { b: V3(2.5, 2.0, 0.45), d: V3(0.66, 0.72, 0.16) },
    relaxed: { b: V3(2.55, 2.0, 0.6), d: V3(0.45, 0.75, 0.46) },
    fist: { b: V3(2.6, 1.8, 0.8), d: V3(-0.36, 0.7, 0.62) },
  }[kind];
  const q = frameQ(T.d.clone().normalize(), V3(-0.6, 0, 0.8));
  xform(thumb, new Matrix4().compose(T.b, q, V3(1, 1, 1)));
  return mergeGeos([hand, thumb]);
}
function shoeGeo() {
  const st = SHOE.map(([y, w, zb, zt]) => [y, w, (zt - zb) / 2, (zt - zb) / 2, 0, (zt + zb) / 2]);
  const upper = solid(st, { seg: 30, n: 3, capLo: 1.1, capHi: 1.2, step: 0.8, group: () => 0 });
  // Sole: flat underneath with a little toe spring, thicker at the heel.
  const sole = solid(SHOE.map(([y, w]) => {
    const bot = -8 + 0.5 * smooth(13, 17.6, y), top = -6.35 + (y < 1 ? 0.3 : 0) - 0.1 * smooth(12, 17.6, y);
    return [y, w + 0.35, (top - bot) / 2, (top - bot) / 2, 0, (top + bot) / 2];
  }), { seg: 30, n: 5, capLo: 1.3, capHi: 1.4, step: 0.8, group: () => 1 });
  return mergeGeos([upper, sole]);
}
// The head as a radius per direction from the centre of the skull (+Y up, +Z the face): an egg
// with a narrower jaw, the skull base curving into the neck, brow, cheekbones and eye sockets.
const EYES = [V3(3.05, 0.9, 8.6).normalize(), V3(-3.05, 0.9, 8.6).normalize()];
const BROWS = [V3(3.2, 2.9, 8.9).normalize(), V3(-3.2, 2.9, 8.9).normalize()];
const CHEEKS = [V3(5.7, -1.4, 6.8).normalize(), V3(-5.7, -1.4, 6.8).normalize()];
const JAWS = [V3(5.8, -6.8, 3.2).normalize(), V3(-5.8, -6.8, 3.2).normalize()];
const CHIN = V3(0, -9.4, 5.4).normalize();
function headR(d) {
  const c = d.z > 0 ? 9.5 : 10.3;
  const b = d.y > 0 ? 11 : 10.6;
  let r = 1 / Math.sqrt((d.x / 7.75) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2);
  const low = smooth(-0.15, -0.85, d.y);
  r *= 1 - 0.13 * low * d.x * d.x; // jaw narrower than the skull
  r *= 1 - 0.36 * smooth(-0.1, -0.8, d.y) * Math.max(0, -d.z) ** 1.3; // skull base into the neck
  r *= 1 - 0.06 * low * Math.max(0, d.z); // chin under the face
  r *= 1 - 0.035 * smooth(0.55, 0.95, d.y); // a slightly flatter crown
  for (const e of EYES) r -= 0.22 * gauss(d.distanceTo(e), 0.16);
  for (const e of BROWS) r += 0.2 * gauss(d.distanceTo(e), 0.16);
  for (const e of CHEEKS) r += 0.3 * gauss(d.distanceTo(e), 0.2);
  for (const e of JAWS) r += 0.9 * gauss(d.distanceTo(e), 0.28); // a squarer jaw
  r += 0.45 * gauss(d.distanceTo(CHIN), 0.2);
  return r;
}
// A sphere-like grid around +Y (poles at the top and bottom, shared seam), radius from fn(dir).
// cut(θ) optionally stops each column at a polar angle (for open shells like the hair).
function radialGeo(fn, seg, rings, cut, off) {
  const pos = [];
  const dirAt = (ph, th) => V3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
  const put = (d, k) => { const r = fn(d) + (off ? off(d, k) : 0); pos.push(d.x * r, d.y * r, d.z * r); };
  put(V3(0, 1, 0), 0);
  for (let i = 1; i <= rings; i++) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const pmax = cut ? cut(th) : Math.PI;
      const u = cut ? i / rings : i / (rings + 1);
      put(dirAt(pmax * u, th), cut ? u : 0);
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg), c = 1 + (i + 1) * seg + j, d = 1 + (i + 1) * seg + ((j + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  }
  if (!cut) {
    put(V3(0, -1, 0), 0);
    const last = pos.length / 3 - 1, base = 1 + (rings - 1) * seg;
    for (let j = 0; j < seg; j++) idx.push(last, base + j, base + ((j + 1) % seg));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('muscle', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 4), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function headGeo() {
  // A faceless mannequin head: at the sizes it is shown a lone nose reads as a bump.
  const head = radialGeo(headR, 48, 34);
  const ear = (sx) => {
    const e = solid([[-2.3, 0.45, 0.8, 0.8], [-0.4, 0.62, 1.3, 1.15], [1.9, 0.5, 1.1, 1.0]], { seg: 14, capLo: 0.8, capHi: 0.9, step: 0.5 });
    return xform(e, new Matrix4().compose(V3(sx * 7.3, -0.3, -0.9), new Quaternion().setFromEuler(new Euler(-0.15, sx * 0.3, sx * 0.08)), V3(1, 1, 1)));
  };
  return mergeGeos([head, ear(1), ear(-1)]);
}
// Short hair: a shell over the skull down to a hairline that is high at the forehead, comes down in
// front of the ears (sideburns), arcs over them and is low at the nape. It thins out toward the edge
// and has soft clumps on top, so it reads as hair rather than a cap.
function hairGeo() {
  const cut = (th) => {
    const z = Math.sin(th);
    return (81 - 26 * z + 11 * z * z + 10 * gauss(z - 0.38, 0.13) - 5 * gauss(z + 0.1, 0.16)) * D2R;
  };
  const clumps = (d) => 0.13 * Math.sin(8 * Math.atan2(d.z, d.x) + 6 * d.y) * Math.sin(7 * Math.acos(clamp(d.y, -1, 1)));
  return radialGeo(headR, 64, 22, cut, (d, u) => 0.12 + (0.62 + 0.18 * Math.max(0, d.y) + clumps(d)) * (1 - smooth(0.72, 1, u)));
}

// The body's shapes, built once. Each part is its own step, so preload() can spread the work over
// idle time instead of freezing the page for one long task.
const SLEEVE = 11.8, SHORTS = 16.5, SOCK = 33.2;
const BODY_PARTS = [
  ['chest', () => solid(CHEST, { seg: 56, step: 1, capLo: 1.4, capHi: 1.2, muscle: MAPS.chest, bumps: CHEST_BUMPS })],
  ['pelvis', () => solid(PELVIS, { seg: 48, step: 1, capLo: 2.2, capHi: 1.2, muscle: MAPS.pelvis })],
  ['uarm', () => solid(UARM, {
    seg: 32, step: 0.9, capLo: 3.6, capHi: 3.4, muscle: MAPS.uarm, ys: [SLEEVE - 0.3, SLEEVE + 0.15],
    off: (y) => 0.45 * (1 - smooth(SLEEVE - 0.2, SLEEVE + 0.1, y)) * smooth(-9, -4, y), group: (y) => (y < SLEEVE ? 0 : 1),
  })],
  // A long dome at the wrist works as a ball joint under the heel of the hand at any wrist angle.
  ['farm', () => solid(FARM, { seg: 28, step: 0.9, capLo: 3.6, capHi: 2.7, muscle: MAPS.farm })],
  ['thigh', () => solid(THIGH, {
    seg: 36, step: 1, capLo: 6.5, capHi: 4.0, muscle: MAPS.thigh, ys: [SHORTS - 0.3, SHORTS + 0.15],
    bumps: [{ y0: 29, y1: 42, th: Math.PI * 0.78, sw: 0.5, a: 0.75 }],
    off: (y) => 0.6 * (1 - smooth(SHORTS - 0.2, SHORTS + 0.1, y)) * smooth(0, 6, y), group: (y) => (y < SHORTS ? 0 : 1),
  })],
  ['shin', () => solid(SHIN, {
    seg: 32, step: 1, capLo: 4.2, capHi: 3.0, muscle: MAPS.shin, ys: [SOCK - 0.15, SOCK + 0.25],
    bumps: [{ y0: 5, y1: 21, th: Math.PI * 1.28, sw: 0.45, a: 0.55 }, { y0: 37, y1: 44, th: 0, sw: 0.4, a: 0.35 }, { y0: 36.5, y1: 43.5, th: Math.PI, sw: 0.4, a: 0.35 }],
    off: (y) => 0.22 * smooth(SOCK - 0.1, SOCK + 0.2, y), group: (y) => (y > SOCK ? 1 : 0),
  })],
  ['neck', () => solid(NECK, { seg: 28, capLo: 2, capHi: 2 })],
  ['hand', () => {
    const open = handGeo('open');
    const relaxed = handGeo('relaxed');
    // Open ↔ relaxed share a topology, so one mesh morphs between them.
    open.morphAttributes.position = [relaxed.attributes.position.clone()];
    open.morphAttributes.normal = [relaxed.attributes.normal.clone()];
    return open;
  }],
  ['fist', () => handGeo('fist')],
  ['head', headGeo],
  ['hair', hairGeo],
  ['shoe', shoeGeo],
];
const MIRRORED = ['uarm', 'farm', 'thigh', 'shin', 'hand', 'fist'];
let bodyParts = {};
// Build the next missing part; true once the body is complete.
function bodyStep() {
  if (BODY) return true;
  const next = BODY_PARTS.find(([k]) => !(k in bodyParts));
  if (next) { bodyParts[next[0]] = next[1](); return false; }
  const p = bodyParts;
  const pair = (k) => ({ R: p[k], L: mirrorX(p[k]) });
  BODY = { chest: p.chest, pelvis: p.pelvis, neck: p.neck, head: p.head, hair: p.hair, shoe: p.shoe };
  for (const k of MIRRORED) BODY[k] = pair(k);
  bodyParts = {};
  return true;
}
function bodyGeos() {
  while (!bodyStep()) { /* build what's left */ }
  return BODY;
}

// Half-width/depth of the trunk at height u above the hip joints (for keeping limbs outside it).
const TRUNK = PELVIS.slice(0, 5).concat(CHEST.slice(1));
function trunkAt(u) {
  if (u < TRUNK[0][0] - 2 || u > TRUNK[TRUNK.length - 1][0] + 1) return null;
  let i = 0;
  while (i < TRUNK.length - 2 && u > TRUNK[i + 1][0]) i++;
  const a = TRUNK[i], b = TRUNK[i + 1];
  const t = clamp((u - a[0]) / (b[0] - a[0]), 0, 1);
  return { w: lerp(a[1], b[1], t), f: lerp(a[2], b[2], t), b: lerp(a[3], b[3], t), oz: lerp(a[5] || 0, b[5] || 0, t) };
}

/* ---------------------------------------------------------------- materials */
// Working muscles glow: each body material reads up to four per-vertex muscles (id + weight) and a
// per-material intensity table, tinting the surface toward the accent and adding emission.
function glowify(mat, glow) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = glow.u;
    sh.uniforms.uGlowColor = glow.color;
    // vGlowW: how much of this spot belongs to a working muscle; vGlowI: how hard it works now.
    // The tint mostly replaces the base colour (a blend with a blue shirt would turn purple).
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 muscle;\nuniform float uGlow[${NM}];\nvarying float vGlowW;\nvarying float vGlowI;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 mId = floor(muscle), mW = muscle - mId;
        vec4 g = vec4(uGlow[int(mId.x)], uGlow[int(mId.y)], uGlow[int(mId.z)], uGlow[int(mId.w)]);
        vGlowW = min(1.0, dot(step(vec4(0.001), g), mW));
        vGlowI = max(max(g.x, g.y), max(g.z, g.w));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlowColor;\nvarying float vGlowW;\nvarying float vGlowI;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gw = smoothstep(0.12, 0.62, vGlowW);
        float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, uGlowColor * (0.32 + 0.6 * luma), gw * (0.84 + 0.16 * vGlowI));`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * gw * (0.1 + 0.5 * vGlowI);');
  };
  mat.customProgramCacheKey = () => 'gh-glow';
  return mat;
}

const skinHex = (s) => (typeof s === 'string' && /^#?[0-9a-f]{6}$/i.test(s) ? (s[0] === '#' ? s : '#' + s) : SKINS[s] || SKINS.sand);

function makeMaterials(o) {
  const glowColor = { value: new Color(o.glow) };
  const glowA = { u: { value: new Float32Array(NM) }, color: glowColor };
  const glowB = { u: { value: new Float32Array(NM) }, color: glowColor };
  const skinC = new Color(skinHex(o.skin));
  const shirtC = new Color(o.shirt);
  const skin = (g) => glowify(new MeshPhysicalMaterial({ color: skinC, roughness: 0.58, metalness: 0, sheen: 0.5, sheenRoughness: 0.45, sheenColor: new Color('#ffcdb2').multiplyScalar(0.35), specularIntensity: 0.45 }), g);
  const shirt = (g) => glowify(new MeshPhysicalMaterial({ color: shirtC, roughness: 0.88, sheen: 1, sheenRoughness: 0.75, sheenColor: shirtC.clone().lerp(new Color('#ffffff'), 0.45).multiplyScalar(0.55), specularIntensity: 0.25 }), g);
  const shorts = (g) => glowify(new MeshPhysicalMaterial({ color: new Color('#26292f'), roughness: 0.82, sheen: 1, sheenRoughness: 0.7, sheenColor: new Color('#6c7383'), specularIntensity: 0.3 }), g);
  const hairKey = typeof o.skin === 'string' && HAIRS[o.skin] ? o.skin : 'sand';
  const m = {
    glowA, glowB,
    skinA: skin(glowA), skinB: skin(glowB), shirtA: shirt(glowA), shirtB: shirt(glowB), shortsA: shorts(glowA), shortsB: shorts(glowB),
    sock: new MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.95 }),
    shoe: new MeshStandardMaterial({ color: '#eceef2', roughness: 0.5 }),
    sole: new MeshStandardMaterial({ color: '#3a3e46', roughness: 0.78 }),
    hair: new MeshPhysicalMaterial({ color: HAIRS[hairKey], roughness: 0.62, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new Color('#8a7060').multiplyScalar(0.4), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    // Dark gear is lifted a little on the dark theme so it doesn't vanish into the background.
    iron: new MeshStandardMaterial({ color: o.dark ? '#474c56' : '#2a2d33', roughness: 0.42, metalness: 0.55 }),
    rubber: new MeshStandardMaterial({ color: o.dark ? '#41454d' : '#25282d', roughness: 0.7 }),
    chrome: new MeshStandardMaterial({ color: '#c4c8cf', roughness: 0.22, metalness: 0.95 }),
    steel: new MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.35, metalness: 0.85 }),
    ball: new MeshStandardMaterial({ color: '#1d8c83', roughness: 0.55 }),
    ballSeam: new MeshStandardMaterial({ color: '#10433f', roughness: 0.6 }),
    band: new MeshStandardMaterial({ color: '#2f9d58', roughness: 0.42 }),
    towel: new MeshStandardMaterial({ color: '#c9d0da', roughness: 1 }),
    cable: new MeshStandardMaterial({ color: '#30333a', roughness: 0.5, metalness: 0.3 }),
    wood: new MeshStandardMaterial({ color: o.dark ? '#a88f72' : '#c4a887', roughness: 0.62 }),
    fabric: new MeshStandardMaterial({ color: o.dark ? '#80858f' : '#a9aeb8', roughness: 0.92 }),
    pad: new MeshStandardMaterial({ color: o.dark ? '#3c4049' : '#2b2e35', roughness: 0.45 }),
    frame: new MeshStandardMaterial({ color: o.dark ? '#7c828c' : '#8e949d', roughness: 0.38, metalness: 0.75 }),
    wall: new MeshStandardMaterial({ color: o.dark ? '#5d626c' : '#dcdfe5', roughness: 0.95, transparent: true, opacity: 1 }),
    door: new MeshStandardMaterial({ color: o.dark ? '#8c7c68' : '#d8c8b0', roughness: 0.7, transparent: true, opacity: 1 }),
    mat: new MeshStandardMaterial({ color: o.dark ? '#3f6470' : '#5f8a96', roughness: 0.9 }),
    plate: new MeshStandardMaterial({ color: o.dark ? '#3c4048' : '#202227', roughness: 0.8 }),
    stack: new MeshStandardMaterial({ color: '#3a3e45', roughness: 0.55, metalness: 0.5 }),
    belt: new MeshStandardMaterial({ color: '#2a2c31', roughness: 0.9 }),
  };
  return m;
}

/* ---------------------------------------------------------------- equipment geometry */
let EQ = null;
function eqGeos() {
  if (EQ) return EQ;
  const alongX = new Matrix4().makeRotationZ(-Math.PI / 2);
  const cyl = (r, l, s = 16, r2 = r) => new CylinderGeometry(r2, r, l, s).applyMatrix4(alongX);
  const tube = (pts, r, seg = 48) => new TubeGeometry(new CatmullRomCurve3(pts.map((p) => V3(...p))), seg, r, 10, false);
  EQ = {
    dbHandle: cyl(1.55, 13.5, 16),
    dbHead: cyl(6.2, 5.2, 6).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 6)),
    dbCollar: cyl(2.6, 1.2, 16),
    kbBell: new SphereGeometry(8.2, 32, 24).applyMatrix4(new Matrix4().makeScale(1, 0.95, 1)),
    kbHandle: tube([[-6.3, -9.5, 0], [-6.4, -4.5, 0], [-5, -0.8, 0], [0, 0.35, 0], [5, -0.8, 0], [6.4, -4.5, 0], [6.3, -9.5, 0]], 1.12),
    ball: new SphereGeometry(1, 32, 24),
    ballSeam: new CylinderGeometry(1.004, 1.004, 0.05, 48, 1, true),
    strand: new CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0),
    strip: new RoundedBoxGeometry(1, 1, 1, 2, 0.3).translate(0, 0.5, 0),
    bar: cyl(1.4, 1, 12),
    sleeve: cyl(2.5, 1, 16),
    bumper: cyl(22.5, 5.5, 40),
    plateSm: cyl(14, 2.8, 32),
    collar: cyl(3.4, 2.4, 16),
    grip: cyl(1.7, 12, 14),
    dFrame: tube([[-6.2, 0, 0], [-5.8, 3.5, 0], [-3, 6.5, 0], [0, 7.4, 0], [3, 6.5, 0], [5.8, 3.5, 0], [6.2, 0, 0]], 0.7, 32),
    ring: new SphereGeometry(1.4, 12, 10),
    knob: new SphereGeometry(2.1, 14, 10),
  };
  return EQ;
}

/* ---------------------------------------------------------------- per-move analysis */
const hands = (e) => (e.hands === 'both' ? ['N', 'F'] : e.hands === 'N' || e.hands === 'F' ? [e.hands] : ['N']);
const HELD = new Set(['db', 'kb', 'ball', 'band', 'towel', 'bb', 'ez', 'handle', 'rope', 'latbar']);
// Per-form tweaks for the 3D lift where the 2D data can't say (e.g. an elbow braced inside a thigh),
// keyed by form name: stance (side view: half the ankles' spacing, cm), toeOut (degrees), kneeOut,
// handZ { N, F } (a hand's distance from the midline, cm; below 0 across the body), flare { N, F }
// (elbow out, cm), grip ('sup' | 'neutral' | 'pro'), palm { N, F } (a free hand's palm: 'up',
// 'down' or degrees as for a grip), palmIn (ms a landing hand takes to turn flat), dbAxis ('long').
const HINTS = {
  // Heel-to-toe stands and walks (src/data/moves-access.js): the feet in one line, not hip-width.
  tandemWall: { stance: 3 }, tandem: { stance: 3 }, heelToe: { stance: 3 },
  // Seated versions of the moves below (src/data/moves-access.js) hold the weights the same way.
  seatPress: { handZ: { N: 30, F: 30 }, flare: { N: 8, F: 8 } },
  seatOhExt: { handZ: { N: 5, F: 5 } },
  seatPullApart: { grip: 'pro' }, seatRow: { grip: 'neutral' },
  // Arms crossed: each hand on the other side of the trunk, the elbows at its sides.
  seatBrace: { handZ: { N: -7, F: -7 }, flare: { N: 12, F: 12 } },
  seatLean: { handZ: { N: -8, F: -8 }, flare: { N: 12, F: 12 } }, seatHinge: { handZ: { N: -8, F: -8 }, flare: { N: 12, F: 12 } },
  // Pushing against your own hand: the working palm up for a curl (the other hand on top of the
  // wrist), down for a triceps press (the other hand under it).
  seatSelfCurl: { palm: { N: 'up', F: 'down' } }, seatSelfPress: { palm: { N: 'down', F: 'up' } },
  // Reaching back for the seat: the hand turns from hanging at the side to flat on the seat, so it
  // turns over the last half second of the reach, not in a blink as it lands.
  sitStandHands: { palmIn: 450 },
  concCurl: { stance: 24, kneeOut: 0.3, handZ: { N: 2.5 }, flare: { N: -6 } },
  deepSquat: { handZ: { N: 2.5, F: 2.5 }, flare: { N: -5, F: -5 } },
  goblet: { handZ: { N: 6, F: 6 } },
  floorFly: { dbAxis: 'long' },
  skull: { handZ: { N: 9, F: 9 } },
  ohExt: { handZ: { N: 5, F: 5 } },
  // Overhead presses: the hands start out over the elbows, wider than the shoulders.
  seatedPressDB: { handZ: { N: 30, F: 30 }, flare: { N: 8, F: 8 } },
  ohPress: { handZ: { N: 30, F: 30 }, flare: { N: 8, F: 8 } },
  bandPress: { handZ: { N: 28, F: 28 }, flare: { N: 8, F: 8 } },
  ohPress1: { handZ: { N: 30 }, flare: { N: 8 } },
  // Face down: arms overhead in a Y, bent in a W, or pulling from one to the other.
  proneY: { handZ: { N: 54, F: 54 } },
  proneW: { handZ: { N: 32, F: 32 }, flare: { N: 18, F: 18 } },
  supermanPull: { handZ: { N: 30, F: 30 }, flare: { N: 16, F: 16 } },
  // Kettlebell high pull: elbows high and wide.
  kbHighPull: { flare: { N: 30, F: 30 } },
  // Diamond push-up: hands together under the chest, elbows back along the ribs.
  diamond: { handZ: { N: 4.5, F: 4.5 }, flare: { N: 5, F: 5 } },
  // Bench presses: a grip a little wider than the shoulders; the close grip at shoulder width.
  benchBB: { handZ: { N: 28, F: 28 } }, benchSmith: { handZ: { N: 28, F: 28 } },
  inclineBB: { handZ: { N: 28, F: 28 } }, inclineSmith: { handZ: { N: 28, F: 28 } },
  closeGrip: { handZ: { N: 16.5, F: 16.5 } },
  // Chest opener: hands clasped behind the back.
  chestOpen: { handZ: { N: 3.5, F: 3.5 } },
  // How the palms face where the equipment doesn't say: band and towel pull-aparts palms down; band
  // rows, face pulls and overhead extensions, and towel rows, palms in.
  pullApart: { grip: 'pro' }, towelApart: { grip: 'pro' },
  bandRow: { grip: 'neutral' }, bandFacePull: { grip: 'neutral' }, bandOhExt: { grip: 'neutral', handZ: { N: 5, F: 5 } }, towelRow: { grip: 'neutral' },
};

function gripOf(move, s) {
  for (const e of move.equip || []) {
    if (!HELD.has(e.type)) continue;
    if (e.type === 'kb' && (e.hold === 'hip' || e.hold === 'chest') && !e.hands) continue;
    if (e.hold === 'feet') continue; // squeezed between the feet, not held
    const hs = hands(e);
    if (hs.includes(s)) return { type: e.type, e, both: hs.length === 2 };
  }
  return null;
}

function analyze(move, o) {
  const P = PZ();
  const view = move.view || 'side';
  const tl = move.$tl || P.timeline(move);
  const A = { move, view, tl, o, props: move.props || [], equip: move.equip || [], hint: HINTS[move.form] || {} };
  A.key = move.key || tl.steps[0].to;
  A.uni = !!move.uni;
  A.work = ((move.leadLimbs && move.leadLimbs[0]) || 'aN').slice(-1);
  A.grip = { N: gripOf(move, 'N'), F: gripOf(move, 'F') };
  A.samples = [];
  const N = 24;
  for (let i = 0; i < N; i++) {
    const t = (tl.total * i) / N;
    const f = P.sampleAt(move, t);
    A.samples.push({ t, f, pts: P.solve(move, f) });
  }
  A.keyF = P.poseByName(move, A.key);
  A.keyPts = P.solve(move, A.keyF);
  A.lift = view === 'front' ? liftFront : view === 'top' ? liftTop : liftSide;
  A.raise = 0; // the picture stands everything on its props already (a treadmill's belt included)
  if (view === 'side') sideStance(A);
  else if (view === 'front') frontKind(A);
  else topKind(A);
  // Per-form stance (side view): half the distance between the ankles (cm; 3 is heel to toe) and how
  // far the toes turn out (degrees).
  if (A.hint.stance != null) A.stance.z = A.hint.stance;
  if (A.hint.toeOut != null) A.stance.toeOut = A.hint.toeOut * D2R;
  if (A.hint.kneeOut != null) A.stance.kneeOut = A.hint.kneeOut;
  return A;
}

const up2 = (pts) => { const d = [pts.neck[0] - pts.hip[0], pts.neck[1] - pts.hip[1]]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; };
const kneeFlex = (pts, s) => {
  const a = [pts['kn' + s][0] - pts['hp' + s][0], pts['kn' + s][1] - pts['hp' + s][1]];
  const b = [pts['an' + s][0] - pts['kn' + s][0], pts['an' + s][1] - pts['kn' + s][1]];
  const c = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
  return Math.acos(clamp(c, -1, 1)) / D2R;
};

function sideStance(A) {
  const k = A.keyPts;
  const u = up2(k);
  const upright = -u[1]; // 1 upright, 0 horizontal, -1 upside down
  const hipH = -k.hip[1];
  const faceUp = -u[0] > 0; // side view: fwd = up × +Z → fwd.y = -up.x (3D), i.e. u2[0] < 0 means face up
  let maxKnee = 0, maxLean = 0, planted = 0;
  for (const { pts } of A.samples) {
    const feet = -pts.anN[1] < 13 && -pts.anF[1] < 13;
    if (feet) { planted++; maxKnee = Math.max(maxKnee, kneeFlex(pts, 'N'), kneeFlex(pts, 'F')); }
    const uu = up2(pts);
    maxLean = Math.max(maxLean, Math.acos(clamp(-uu[1], -1, 1)) / D2R);
  }
  const split = Math.abs(k.anN[0] - k.anF[0]) > 22;
  const bar = A.props.some((p) => p.type === 'bar' || p.type === 'dip');
  const seat = A.props.find((p) => ['chair', 'box', 'bench'].includes(p.type) && hipH > (p.h || SEAT_H) - 6 && hipH < (p.h || SEAT_H) + 22 && k.hip[0] > p.x - 8 && k.hip[0] < p.x + p.w + 8);
  const st = { z: 10.8, toeOut: 9 * D2R, kneeOut: 0.06 };
  A.lying = Math.abs(upright) < 0.62 && hipH < 40;
  A.prone = A.lying && !faceUp;
  A.supine = A.lying && faceUp;
  A.hang = bar && -k.hdN[1] > -k.head[1];
  if (A.lying && A.supine) {
    if (planted > A.samples.length * 0.5) Object.assign(st, { z: 11.5, toeOut: 6 * D2R, kneeOut: 0.12 });
    else Object.assign(st, { z: 9.2, toeOut: 14 * D2R, kneeOut: 0.05 });
  } else if (A.lying) Object.assign(st, { z: 9, toeOut: 0, kneeOut: 0 });
  else if (A.hang) Object.assign(st, { z: 8.8, toeOut: 5 * D2R, kneeOut: 0.05 });
  else if (seat && !split) Object.assign(st, { z: 13, toeOut: 10 * D2R, kneeOut: 0.1 });
  else if (split) Object.assign(st, { z: 11, toeOut: 5 * D2R, kneeOut: 0.03 });
  else if (maxKnee > 72 && planted) Object.assign(st, { z: 15.5, toeOut: 17 * D2R, kneeOut: 0.26 });
  else if (maxLean > 35) Object.assign(st, { z: 13, toeOut: 10 * D2R, kneeOut: 0.12 });
  A.stance = st;
  A.upright = upright;
}

// Front view: which way foreshortened segments point (toward the camera or away).
function frontKind(A) {
  const k = A.keyPts, f = A.keyF;
  const hipH = -k.hip[1];
  const handDown = ['N', 'F'].some((s) => (`ik.hd${s}.y` in f) && f[`ik.hd${s}.y`] > -10);
  const ts = f.ts == null ? 1 : f.ts;
  A.kind = 'stand';
  if (handDown && ts < 0.7) A.kind = 'prone';
  else if (hipH < 30 && Math.abs(f.t || 0) < 40) A.kind = 'seated';
  else if (Math.abs(f.t || 0) > 45 && hipH < 45) A.kind = 'sidelying';
  // Seated with the feet on the floor, the shins come down in front of the knees (tucked back
  // under the seat they'd put the feet inside it); otherwise shins go back from the knee.
  const feetDown = ['N', 'F'].every((s) => -k['an' + s][1] < 12 && -k['kn' + s][1] > -k['an' + s][1] + 10);
  A.sign = {
    torso: A.kind === 'seated' ? -1 : 1,
    th: A.kind === 'prone' ? -1 : 1,
    sh: A.kind === 'seated' && feetDown ? 1 : -1,
  };
  A.stance = { z: 0, toeOut: (A.kind === 'stand' ? 10 : 6) * D2R, kneeOut: 0 };
  A.lying = A.kind === 'prone' || A.kind === 'sidelying';
  A.prone = A.kind === 'prone';
}

function topKind(A) {
  const m = A.move.muscles || [];
  A.prone = !m.includes('chest') && (m.includes('rearDelts') || m.includes('upperBack') || m.includes('lowerBack'));
  A.supine = !A.prone;
  A.lying = true;
  A.stance = { z: 0, toeOut: 12 * D2R, kneeOut: 0 };
  // Lying on a bench (the top of its pad) rather than on the floor.
  const bench = A.props.find((p) => p.type === 'bench');
  A.topBase = bench ? bench.h || 45 : 0;
}

/* ---------------------------------------------------------------- surfaces */
// Where a hand is resting (floor, a prop top, a wall) or gripping (a bar), in 3D terms.
function surfaces(A) {
  if (A.$surf) return A.$surf;
  const out = { tops: [], walls: [], bars: [] };
  for (const p of A.props) {
    const h = p.h || (p.type === 'table' ? 72 : SEAT_H);
    if (['box', 'chair', 'bench'].includes(p.type)) out.tops.push({ x0: p.x, x1: p.x + p.w, y: h });
    if (p.type === 'table') { out.tops.push({ x0: p.x, x1: p.x + p.w, y: h }); out.bars.push({ x: p.x + p.w, y: h - 1.5, edge: true }, { x: p.x, y: h - 1.5, edge: true }); }
    if (p.type === 'wall') out.walls.push({ x: p.x, side: p.side || 1 });
    if (p.type === 'door') out.walls.push({ x: p.x, side: 1 });
    if (p.type === 'bar') out.bars.push({ x: (p.x1 + p.x2) / 2, y: -p.y });
    if (p.type === 'dip') out.bars.push({ x: p.x, y: p.h || 100, dip: true });
  }
  A.$surf = out;
  return out;
}

// Contact for the hand on side s: { kind, w, y (surface height), bar }. The grip point is where the
// 2D engine puts held things: 55% of the way from the wrist to the hand tip.
function handContact(A, pts, s) {
  const wr = pts['wr' + s], hd = pts['hd' + s];
  const gx = lerp(wr[0], hd[0], 0.55), gy = -lerp(wr[1], hd[1], 0.55);
  const S = surfaces(A);
  if (A.view === 'top') return { kind: 'free', w: 0 };
  let best = { kind: 'free', w: 0 };
  const take = (c) => { if (c.w > best.w) best = c; };
  for (const b of S.bars) {
    const d = Math.hypot(gx - b.x, gy - b.y);
    if (d < 12) take({ kind: 'bar', w: 1 - smooth(7, 12, d), bar: b });
  }
  if (A.view === 'side') {
    for (const t of S.tops) {
      if (gx < t.x0 - 4 || gx > t.x1 + 4) continue;
      const dy = gy - t.y;
      if (dy > -3 && dy < 10) take({ kind: 'top', w: 1 - smooth(5, 10, dy), y: t.y });
    }
    for (const wl of S.walls) {
      const d = Math.abs(gx - wl.x);
      if (d < 10 && gy > 30) take({ kind: 'wall', w: 1 - smooth(5, 10, d), wall: wl });
    }
  } else {
    for (const wl of S.walls) {
      const d = Math.abs(gx - wl.x);
      if (d < 10 && gy > 30) take({ kind: 'wall', w: 1 - smooth(5, 10, d), wall: wl, lateral: true });
    }
  }
  if (gy < 12) take({ kind: 'floor', w: 1 - smooth(6, 12, gy), y: 0 });
  return best;
}

/* ---------------------------------------------------------------- the lift: 2D → 3D */
function newRig() {
  return { sh: {}, el: {}, wr: {}, hand: {}, hp: {}, kn: {}, an: {}, foot: {} };
}

// Keep a point (radius r) outside the trunk and the head by moving it along `lat` (unit, pointing
// to this limb's side). Returns the pushed point. Both shapes fade out at their edges (the trunk
// tapers past its ends, the head is an ellipsoid), so a point moving smoothly is pushed smoothly.
function clearTrunk(J, p, r, lat) {
  const d = p.clone().sub(J.hip);
  const u = d.dot(J.up), v = d.dot(J.fwd);
  let w = d.dot(lat);
  const lo = TRUNK[0][0], hi = TRUNK[TRUNK.length - 1][0];
  const fade = smooth(lo - 3, lo, u) * (1 - smooth(hi, hi + 3, u));
  const s = fade > 0 ? trunkAt(clamp(u, lo, hi)) : null;
  if (s) {
    const dv = v - s.oz;
    const dd = (dv >= 0 ? s.f : s.b) + r;
    if (Math.abs(dv) < dd) {
      const wmin = (s.w + r) * Math.sqrt(1 - (dv / dd) ** 2) * fade;
      if (w < wmin) { p = p.clone().addScaledVector(lat, wmin - w); w = wmin; }
    }
  }
  if (J.headC) {
    const dh = p.clone().sub(J.headC);
    const hv = dh.dot(J.headUp);
    const wh = dh.dot(lat);
    const fv = dh.clone().addScaledVector(J.headUp, -hv).addScaledVector(lat, -wh).dot(J.headFwd || J.fwd);
    const a = (hv > 0 ? 11 : 10.6) + r, bf = (fv > 0 ? 10 : 10.3) + r, bw = 8.2 + r;
    const q = 1 - (hv / a) ** 2 - (fv / bf) ** 2;
    if (q > 0) {
      const wmin = bw * Math.sqrt(q);
      if (wh < wmin) p = p.clone().addScaledVector(lat, wmin - wh);
    }
  }
  return p;
}
// Keep a point (radius r) out of the trunk and the head by moving it forward or back (along the
// chest's forward), out by the nearer side: a bell held in front stays in front, a hand behind the
// head stays behind it. Returns the pushed point.
function clearFront(J, p, r) {
  const fwd = J.fwdC;
  const d = p.clone().sub(J.hip);
  const u = d.dot(J.up), w = d.dot(J.latC);
  const lo = TRUNK[0][0], hi = TRUNK[TRUNK.length - 1][0];
  const fade = smooth(lo - 3, lo, u) * (1 - smooth(hi, hi + 3, u));
  if (fade > 0) {
    const s = trunkAt(clamp(u, lo, hi));
    const a = s.w + r;
    if (Math.abs(w) < a) {
      const k = Math.sqrt(1 - (w / a) ** 2) * fade;
      const v = d.dot(fwd) - s.oz;
      const vmin = (v >= 0 ? s.f + r : -(s.b + r)) * k;
      if (Math.abs(v) < Math.abs(vmin)) p = p.clone().addScaledVector(fwd, vmin - v);
    }
  }
  if (J.headC) {
    const dh = p.clone().sub(J.headC);
    const hv = dh.dot(J.headUp), hw = dh.dot(J.latC);
    const hf = J.headFwd || fwd;
    const q = 1 - (hv / ((hv > 0 ? 11 : 10.6) + r)) ** 2 - (hw / (8.2 + r)) ** 2;
    if (q > 0) {
      const fv = dh.dot(hf);
      const fmin = (fv >= 0 ? 10 + r : -(10.3 + r)) * Math.sqrt(q);
      if (Math.abs(fv) < Math.abs(fmin)) p = p.clone().addScaledVector(hf, fmin - fv);
    }
  }
  return p;
}
// A correction kept per figure (an elbow swung out, a hand pushed clear), by key: while the figure
// animates (T in ms) it follows what's needed at a limited speed (up, down: per ms), so it can
// never snap between frames; stills and seeks (T null, or a jump in time) take it straight away.
function settle(A, key, need, T, up, down) {
  const st = A.swing || (A.swing = {});
  const o = st[key];
  if (T == null) return { v: need, sign: o && o.v > 0.01 ? o.sign : 0 };
  if (!o || !(T > o.T) || T - o.T > 250) { st[key] = { v: need, T, sign: o ? o.sign : 0 }; return st[key]; }
  const dt = T - o.T;
  const v = need > o.v ? Math.min(need, o.v + up * dt) : Math.max(need, o.v - down * dt);
  st[key] = { v, T, sign: o.sign };
  return st[key];
}
// Distance from point p to the segment ab.
function segDist(p, a, b) {
  const ab = b.clone().sub(a);
  const t = clamp(p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
// Keep a point outside both thighs by moving it outward along lat.
function clearThighs(J, p, r, lat) {
  for (const s of SIDES) {
    if (!J.kn[s]) continue;
    for (let k = 0; k < 14; k++) {
      const d = segDist(p, J.hp[s], J.kn[s]);
      if (d >= 7.6 + r) break;
      p = p.clone().addScaledVector(lat, 1);
    }
  }
  return p;
}

// Pelvis/torso frame and the legs, shared by the side and front lifts once the trunk is placed.
function legs(A, J, pts, f, get3, opts, t, T) {
  const st = A.stance;
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    const lat = J.latL.clone().multiplyScalar(sg);
    const hp = J.hp[s];
    let an = get3('an' + s, s);
    const kn2 = get3('kn' + s, s);
    // Legs resting on the floor settle onto it.
    if (A.lying && an.y < 16) {
      const shinH = Math.abs((kn2.y - an.y) / (kn2.distanceTo(an) || 1));
      if (shinH < 0.45 && !(`ik.an${s}.x` in f)) an.y = Math.max(5.5, an.y - 6);
    }
    const out = lat.clone();
    // Knees only fold one way: the front view's 2D knee may sit to the side of the hip–ankle line
    // (its IK folds in the picture plane), which only says the leg is bent, not which way; the pole
    // is pulled forward, over the toes (a knee the pose brings toward the viewer is forward anyway).
    if (opts.poleBias) kn2.add(opts.poleBias);
    let r = ik2(hp, an, PZ().L.th, PZ().L.sh, kn2, out, st.kneeOut);
    J.kn[s] = r.mid; J.an[s] = r.end;
    opts.foot(s, sg, r);
    // The shoe on the floor: tipped about the ankle where that lifts it, and where it would still
    // sink (a 2D ankle a centimetre or two low, a foot lying on its side) the ankle goes up by what's
    // missing and the leg bends that touch more, so the sole rests on the floor.
    const fq = frameQ(J.foot[s].a, J.foot[s].up);
    footOnFloor(A, s, t, r.end, fq, T);
    const low = lowestProbe(r.end, fq);
    if (low < FLOOR_TOL - 0.05) {
      r = ik2(hp, an.clone().setY(an.y + Math.min(4, FLOOR_TOL - low)), PZ().L.th, PZ().L.sh, kn2, out, st.kneeOut);
      J.kn[s] = r.mid; J.an[s] = r.end;
      opts.foot(s, sg, r);
      frameQ(J.foot[s].a, J.foot[s].up, fq);
      footOnFloor(A, s, t, r.end, fq, T);
    }
    J.foot[s].q = fq;
  }
}

// Side view: X = x, Y = -y, Z from rules (N limbs at +Z).
function liftSide(A, pts, f, T, t) {
  const J = newRig();
  const P3 = (p) => V3(p[0], -p[1] + A.raise, 0);
  const hip = P3(pts.hip), neck = P3(pts.neck);
  motion(A, J, T, hip, neck);
  const up = neck.clone().sub(hip).normalize();
  const lat = V3(0, 0, 1);
  const fwd = V3().crossVectors(up, lat).normalize();
  Object.assign(J, { hip, neck, up, fwd, lat, latL: lat, fwdP: fwd, latC: lat, fwdC: fwd });
  const head = P3(pts.head);
  if (J.shift) head.add(J.shift);
  J.headC = head.clone().addScaledVector(fwd, 0.8);
  J.headUp = head.clone().sub(neck).normalize();
  J.headFwd = V3().crossVectors(J.headUp, lat).normalize();
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    J.sh[s] = neck.clone().addScaledVector(lat, sg * SH_W).addScaledVector(up, J.breathUp || 0);
    J.hp[s] = hip.clone().addScaledVector(lat, sg * HIP_W);
  }
  const shift = (v) => (J.shift ? v.add(J.shift) : v);
  const get3 = (k, s) => {
    const v = P3(pts[k]);
    const sg = s === 'N' ? 1 : -1;
    // An ankle's IK target can say how far across it is (+Z toward the near side): a foot placed
    // in line with the other, or swinging out to pass it.
    const az = f[`ik.an${s}.z`];
    if (k.startsWith('an')) v.z = typeof az === 'number' ? az : sg * A.stance.z;
    else if (k.startsWith('kn')) v.z = (typeof az === 'number' ? az + sg * HIP_W : sg * (HIP_W + A.stance.z)) * 0.5;
    if (J.shift && !k.startsWith('an')) shift(v);
    return v;
  };
  legs(A, J, pts, f, get3, {
    foot(s, sg, r) {
      const a2 = [pts['to' + s][0] - pts['an' + s][0], pts['to' + s][1] - pts['an' + s][1]];
      let fa = V3(a2[0], -a2[1], 0).normalize();
      const d2 = dir2(pts['footDir' + s] - 90);
      let fd = V3(d2[0], -d2[1], 0).normalize();
      fa = yaw(fa, -sg * A.stance.toeOut);
      fd = yaw(fd, -sg * A.stance.toeOut);
      J.foot[s] = { a: fa, up: fd.negate() };
    },
  }, t, T);
  arms(A, J, pts, f, P3, null, T, t);
  return J;
}

// Front view: X = x, Y = -y, depth recovered from the foreshortening.
function liftFront(A, pts, f, T, t) {
  const L = PZ().L;
  const J = newRig();
  const P2 = (p) => V3(p[0], -p[1] + A.raise, 0);
  const sgn = A.sign;
  const depth = (a, b, len) => Math.sqrt(Math.max(0, len * len - (b[0] - a[0]) ** 2 - (b[1] - a[1]) ** 2));
  const hip = P2(pts.hip);
  const neck = P2(pts.neck); neck.z = hip.z + sgn.torso * depth(pts.hip, pts.neck, L.torso);
  motion(A, J, T, hip, neck);
  const up = neck.clone().sub(hip).normalize();
  // Lateral axis from the 2D shoulder line, square to the trunk.
  const acr = V3(pts.shN[0] - pts.shF[0], -(pts.shN[1] - pts.shF[1]), 0);
  if (acr.lengthSq() < 1e-4) acr.set(1, 0, 0);
  const l0 = perp(acr.normalize(), up).normalize();
  const fwd0 = V3().crossVectors(l0, up).normalize();
  const tw = (f.tw || 0) * D2R;
  const latC = l0.clone().multiplyScalar(Math.cos(tw)).addScaledVector(fwd0, -Math.sin(tw)).normalize();
  const latP = l0.clone().multiplyScalar(Math.cos(tw * 0.35)).addScaledVector(fwd0, -Math.sin(tw * 0.35)).normalize();
  const fwdC = V3().crossVectors(latC, up).normalize();
  const fwdP = V3().crossVectors(latP, up).normalize();
  Object.assign(J, { hip, neck, up, fwd: fwdC, lat: latC, latL: latP, fwdP, latC, fwdC });
  const hd2 = P2(pts.head);
  const head = hd2.clone(); head.z = neck.z + sgn.torso * depth(pts.neck, pts.head, (L.neck + L.head));
  head.x = neck.x + (pts.head[0] - pts.neck[0]);
  J.headC = head.clone().addScaledVector(fwdC, 0.8);
  J.headUp = head.clone().sub(neck).normalize();
  J.headFwd = perp(fwdC, J.headUp).normalize();
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    J.sh[s] = neck.clone().addScaledVector(latC, sg * SH_W).addScaledVector(up, J.breathUp || 0);
    J.hp[s] = hip.clone().addScaledVector(latP, sg * HIP_W);
  }
  // Leg joints: 2D deltas from the 3D hip plus the depth recovered from the foreshortening.
  const get3 = (k, s) => {
    const hp2 = pts['hp' + s];
    if (k.startsWith('kn')) {
      const kn = pts['kn' + s];
      return J.hp[s].clone().add(V3(kn[0] - hp2[0], -(kn[1] - hp2[1]), sgn.th * depth(hp2, kn, L.th)));
    }
    const kn = pts['kn' + s], an = pts['an' + s];
    const k3 = J.hp[s].clone().add(V3(kn[0] - hp2[0], -(kn[1] - hp2[1]), sgn.th * depth(hp2, kn, L.th)));
    const a3 = k3.clone().add(V3(an[0] - kn[0], -(an[1] - kn[1]), sgn.sh * depth(kn, an, L.sh)));
    if (A.plantZ && A.plantZ[s] != null) a3.z = A.plantZ[s];
    else if (A.kind === 'stand') {
      // A standing foot still on the floor stays under its hip: a step starts with the heel coming
      // up and the knee going forward, not the whole foot sliding back as the shin foreshortens.
      const w = 1 - smooth(8.5, 15, -an[1]);
      if (w > 0) a3.z = lerp(a3.z, J.hp[s].z, w);
    }
    if (A.kind === 'prone') {
      // Legs reach back to the floor on the toes.
      const hp = J.hp[s];
      const drop = hp.y - 13;
      const len = L.th + L.sh - 0.5;
      const back = Math.sqrt(Math.max(1, len * len - drop * drop - (an[0] - hp2[0]) ** 2));
      return V3(hp.x + (an[0] - hp2[0]), 13, hp.z - back);
    }
    return a3;
  };
  legs(A, J, pts, f, get3, {
    poleBias: J.fwdP.clone().multiplyScalar(15),
    foot(s, sg, r) {
      const shin = r.end.clone().sub(r.mid).normalize();
      let fa = yaw(perp(J.fwdP, Y_UP).normalize(), sg * A.stance.toeOut);
      if (A.kind === 'prone') fa = V3(0, -1, 0);
      // A flat foot near the floor stands on it (sole down); lifted, it hangs off the shin. Both
      // blended, by the pose's (tweened) flatness and the ankle's height, so it never snaps.
      const flat = ('l' + s + '.fl') in f ? clamp(f['l' + s + '.fl'], 0, 1) : f.$ && f.$['flat' + s] !== false ? 1 : 0;
      const k = A.kind === 'prone' ? 0 : flat * (1 - smooth(12, 20, r.end.y));
      const down = shin.clone().lerp(V3(0, -1, 0), k);
      if (down.lengthSq() < 1e-4) down.copy(shin);
      const faP = perp(fa, down.clone().normalize());
      if (faP.lengthSq() < 1e-4) faP.copy(anyPerp(down));
      J.foot[s] = { a: faP.normalize(), up: down.clone().normalize().negate() };
    },
  }, t, T);
  // A ball held in both hands sits in front of the trunk at its 2D height.
  const ballE = A.equip.find((e) => e.type === 'ball' && hands(e).length === 2);
  if (ballE) {
    const r = (ballE.r || 8) * 1.25;
    const b2 = pts.ball || [(pts.wrN[0] + pts.wrF[0]) / 2, (pts.wrN[1] + pts.wrF[1]) / 2];
    const c = V3(b2[0], -b2[1] + A.raise, 0);
    c.z = frontZ(J, c.y) + r + 4;
    J.held = { c, r };
  }
  const P3 = (p, key, s) => {
    // Arms: the 2D point, with depth accumulated down the chain from the 3D shoulder.
    const sh2 = pts['sh' + s], el2 = pts['el' + s], wr2 = pts['wr' + s], hd2b = pts['hd' + s];
    const e3 = J.sh[s].clone().add(V3(el2[0] - sh2[0], -(el2[1] - sh2[1]), depth(sh2, el2, L.ua)));
    if (key === 'el') return e3;
    const w3 = e3.clone().add(V3(wr2[0] - el2[0], -(wr2[1] - el2[1]), depth(el2, wr2, L.fa)));
    if (key === 'wr') return w3;
    return w3.clone().add(V3(hd2b[0] - wr2[0], -(hd2b[1] - wr2[1]), depth(wr2, hd2b, L.hand)));
  };
  arms(A, J, pts, f, P2, P3, T, t);
  return J;
}

// Top view: the frontal-plane figure lies on the floor, head toward +X, N side toward +Z.
function liftTop(A, pts, f, T, t) {
  const L = PZ().L;
  const J = newRig();
  const base = A.topBase || 0;
  const P = (p, h) => V3(-p[1], h + base, p[0]);
  const hip = P(pts.hip, 11), neck = P(pts.neck, 11);
  motion(A, J, T, hip, neck);
  const up = neck.clone().sub(hip).normalize();
  const lat = V3(0, 0, 1);
  const face = A.prone ? -1 : 1;
  const fwd = V3(0, face, 0);
  Object.assign(J, { hip, neck, up, fwd, lat, latL: lat, fwdP: fwd, latC: lat, fwdC: fwd });
  const head = P(pts.head, A.prone ? 10.2 : 11);
  J.headC = head.clone().addScaledVector(fwd, 0.8);
  J.headUp = head.clone().sub(neck).normalize();
  J.headFwd = fwd.clone();
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    J.sh[s] = neck.clone().addScaledVector(lat, sg * SH_W).addScaledVector(fwd, -1.5);
    J.hp[s] = hip.clone().addScaledVector(lat, sg * HIP_W);
  }
  // Each distal joint rises from its resting height by the foreshortening of its segment (or, for
  // shins off the end of a bench, drops by it: the feet go to the floor).
  const rise = (a2, b2, len) => Math.sqrt(Math.max(0, len * len - (b2[0] - a2[0]) ** 2 - (b2[1] - a2[1]) ** 2));
  const place = (from3, a2, b2, len, rest, down) => {
    const rz = rise(a2, b2, len);
    const hgt = down ? Math.max(rest, from3.y - rz) : lerp(rest, from3.y + rz, rz / len);
    const dh = hgt - from3.y;
    const planar = V3(-(b2[1] - a2[1]), 0, b2[0] - a2[0]);
    const pl = planar.length() || 1;
    const want = Math.sqrt(Math.max(0, len * len - dh * dh));
    return from3.clone().addScaledVector(planar, want / pl).add(V3(0, dh, 0));
  };
  const armLift = A.prone && (A.move.muscles || []).some((m) => m === 'rearDelts' || m === 'upperBack') ? 7 : 0;
  // Arms out past a bench's sides sink a little below its pad.
  const armBase = base ? base - 3 : 0;
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    const e = place(J.sh[s], pts['sh' + s], pts['el' + s], L.ua, armBase + 5 + armLift * 0.6);
    const w = place(e, pts['el' + s], pts['wr' + s], L.fa, armBase + 3.4 + armLift);
    const h = place(w, pts['wr' + s], pts['hd' + s], L.hand, armBase + 2.4 + armLift);
    J.el[s] = e; J.wr[s] = w;
    const k = place(J.hp[s], pts['hp' + s], pts['kn' + s], L.th, base + 6.5);
    const an = place(k, pts['kn' + s], pts['an' + s], L.sh, base ? 8.3 : 5.5, base > 0);
    J.kn[s] = k; J.an[s] = an;
    const leg = an.clone().sub(k).normalize();
    if (A.prone) J.foot[s] = { a: leg.clone(), up: V3(0, -1, 0) };
    // Off a bench the feet stand flat on the floor, toes away from the head.
    else if (base) J.foot[s] = { a: V3(-1, 0, 0).addScaledVector(lat, sg * 0.22).normalize(), up: V3(0, 1, 0) };
    else J.foot[s] = { a: yaw(V3(0, 1, 0).addScaledVector(leg, 0.35).normalize(), 0).addScaledVector(lat, sg * 0.22).normalize(), up: leg.clone().negate() };
    const dirF = w.clone().sub(e).normalize();
    const handDir = h.clone().sub(w).normalize();
    const ua = e.clone().sub(J.sh[s]).normalize();
    const fr = armFrame(ua, dirF, armHinge(ua, dirF, naturalFront(A, J, s, t, ua)), A.rightSide[s]);
    (J.front || (J.front = {}))[s] = fr.F;
    handFrame(A, J, s, sg, dirF, handDir, { kind: A.prone ? 'floor' : 'free', w: A.prone && !armLift ? 1 : 0 }, lat.clone().multiplyScalar(sg), fr);
  }
  return J;
}

// Depth of the front of the trunk at height y (front view: toward the camera is +Z).
function frontZ(J, y) {
  const t = clamp((y - J.hip.y) / ((J.neck.y - J.hip.y) || 1), -0.1, 1.15);
  return lerp(J.hip.z, J.neck.z, t) + 11 * Math.max(0.3, J.fwdC.z);
}

// Breathing and small weight shifts in holds; filled into J before the limbs are solved.
function motion(A, J, T, hip, neck) {
  if (T == null) return;
  const iso = A.move.rep.every((s) => s.ph === 'iso');
  const br = Math.sin((T / 4200) * Math.PI * 2);
  J.breath = br;
  J.breathUp = br * (iso ? 0.35 : 0.22);
  if (iso && !A.lying) {
    const sh = V3(Math.sin((T / 5300) * Math.PI * 2) * 0.5, 0, Math.sin((T / 6100) * Math.PI * 2) * 0.55);
    J.shift = sh;
    hip.add(sh); neck.add(sh);
  }
}

// A nearly straight arm: its slight bend in the picture says little about where the elbow points
// (the pole then sits on the arm, and the elbow can flip from side to side), so it points where a
// relaxed elbow does: behind the arm's front (from the hinge track, so it agrees with how the arm
// bends before and after) and a little out.
function relaxedPole(A, pts, s, sh, W, J, lat, flare, pole, t) {
  const u2 = [pts['el' + s][0] - pts['sh' + s][0], pts['el' + s][1] - pts['sh' + s][1]];
  const f2 = [pts['wr' + s][0] - pts['el' + s][0], pts['wr' + s][1] - pts['el' + s][1]];
  const cb = (u2[0] * f2[0] + u2[1] * f2[1]) / ((Math.hypot(u2[0], u2[1]) * Math.hypot(f2[0], f2[1])) || 1);
  const bent = smooth(10, 28, Math.acos(clamp(cb, -1, 1)) / D2R);
  if (bent >= 1) return;
  const ua = W.clone().sub(sh).normalize();
  const nat = sh.clone().lerp(W, 0.5).addScaledVector(naturalFront(A, J, s, t, ua), -12).addScaledVector(lat, 4 - flare);
  pole.lerp(nat, 1 - bent);
}

// The upper arm's front (the way its elbow bends) through the rep, per arm, so the humerus never
// spins about itself: where the elbow is clearly bent the pose says which way; where the arm is
// nearly straight the front is carried along with it from the last bent moment and turned, evenly
// over that stretch, to the next one's. (Straight overhead, "forward" and "backward" are both
// fronts a straight arm could have; which one depends on how it bends next, e.g. behind the head
// in an overhead extension.) An arm that never bends starts from a hanging arm's front, carried.
// Kept per sample in the trunk's own axes (up, forward, lateral) so it moves with the body.
function hingeTrack(A, Js) {
  const n = Js.length;
  if (n < 2) return null;
  const out = { n, total: A.tl.total };
  for (const s of SIDES) {
    const ua = [], F = [];
    const anchors = [];
    for (let i = 0; i < n; i++) {
      const J = Js[i];
      const u = J.el[s].clone().sub(J.sh[s]).normalize();
      const b = perp(J.wr[s].clone().sub(J.el[s]).normalize(), u);
      ua.push(u);
      // Bent past ARM_BENT: armHinge() then takes the bend itself, so the pose decides.
      if (Math.acos(clamp(u.dot(J.wr[s].clone().sub(J.el[s]).normalize()), -1, 1)) / D2R >= ARM_BENT) { F.push(b.normalize()); anchors.push(i); } else F.push(null);
    }
    if (!anchors.length) {
      let best = 0, low = -Infinity;
      for (let i = 0; i < n; i++) { const c = -ua[i].dot(Js[i].up); if (c > low) { low = c; best = i; } }
      F[best] = carry(armFront(ua[best], Js[best].up, Js[best].fwd), ua[best], ua[best]);
      anchors.push(best);
    }
    for (let a = 0; a < anchors.length; a++) {
      const i0 = anchors[a], i1 = a + 1 < anchors.length ? anchors[a + 1] : anchors[0] + n;
      if (i1 - i0 < 2) continue;
      const fw = [], bw = [];
      let v = F[i0];
      for (let j = i0 + 1; j < i1; j++) { v = carry(v, ua[(j - 1) % n], ua[j % n]); fw[j] = v; }
      v = F[i1 % n];
      for (let j = i1 - 1; j > i0; j--) { v = carry(v, ua[(j + 1) % n], ua[j % n]); bw[j] = v; }
      // The twist between the two carried fronts, spread evenly (one way round for the stretch).
      const mid = (i0 + i1) >> 1;
      const tm = signedAngle(fw[mid], bw[mid], ua[mid % n]);
      for (let j = i0 + 1; j < i1; j++) {
        let tj = signedAngle(fw[j], bw[j], ua[j % n]);
        while (tj - tm > Math.PI) tj -= 2 * Math.PI;
        while (tj - tm < -Math.PI) tj += 2 * Math.PI;
        F[j % n] = fw[j].clone().applyAxisAngle(ua[j % n], (tj * (j - i0)) / (i1 - i0));
      }
    }
    out[s] = F.map((v, i) => { const J = Js[i]; return [v.dot(J.up), v.dot(J.fwdC), v.dot(J.latC)]; });
  }
  return out;
}
// The shoe on the floor: a foot the lift puts partly below it is tipped about the ankle (toes up:
// +, heel up: -) by the pitch that best trades how far it still sinks (cm) against how far it's
// turned (rad): E = sink² + pitch². So a toe poking through (a plank's feet) tips until it's clear,
// while a whole sole a little too low (an ankle the 2D figure drops a centimetre or two) stays flat
// rather than being tipped onto an edge. Where either way would do (a toe straight below the
// ankle), the way is fixed per stretch of the rep that needs tipping, from the rep's samples, so the
// shoe can't swap from one to the other mid-rep.
const FLOOR_TOL = -0.3;
const _fv = new Vector3(), _fax = new Vector3(), _fq = new Quaternion();
function lowestProbe(an, q) {
  let m = Infinity;
  for (let i = 0; i < FOOT_PROBES.length; i++) { const y = _fv.copy(FOOT_PROBES[i]).applyQuaternion(q).y + an.y; if (y < m) m = y; }
  return m;
}
const _fp = { a: 0, e: 0 };
// The best pitch of sign sgn: { a (radians, ≥ 0), e (its cost) }, the low point of the cost reached
// going that way from no pitch (over small rises, never over a real hill, so it stays in one basin
// and moves smoothly from frame to frame). Shared result object.
function footPitch(an, q, sgn) {
  _fax.set(1, 0, 0).applyQuaternion(q);
  const cost = (a) => {
    _fq.setFromAxisAngle(_fax, sgn * a).multiply(q);
    const d = Math.max(0, FLOOR_TOL - lowestProbe(an, _fq));
    return d * d + a * a;
  };
  let best = 0, be = cost(0);
  for (let a = 0.04; a <= 1.2; a += 0.04) {
    const e = cost(a);
    if (e < be) { be = e; best = a; } else if (e > be + 1) break;
  }
  const lo = Math.max(0, best - 0.04);
  for (let a = lo; a <= best + 0.04; a += 0.004) { const e = cost(a); if (e < be) { be = e; best = a; } }
  _fp.a = best; _fp.e = be;
  return _fp;
}
// Per foot and sample: which way to tip (0: it needs no tipping there).
function footTrack(A, Js) {
  const out = {}, n = Js.length, q = new Quaternion();
  for (const s of SIDES) {
    const need = Js.map((J) => {
      frameQ(J.foot[s].a, J.foot[s].up, q);
      if (lowestProbe(J.an[s], q) >= FLOOR_TOL) return null;
      const p = footPitch(J.an[s], q, 1), x = { p: p.a, pe: p.e };
      const m = footPitch(J.an[s], q, -1);
      x.m = m.a; x.me = m.e;
      return x;
    });
    const sign = need.map((x) => (!x ? 0 : x.pe <= x.me ? 1 : -1));
    // Stretches that need tipping without a break (cyclic): a change of way inside one is only
    // allowed where the tipping is slight both sides; otherwise the stretch keeps the way that
    // costs least overall.
    const free = need.findIndex((x) => !x);
    const start = free < 0 ? 0 : free;
    let run = [];
    const settleRun = () => {
      if (!run.length) return;
      const amt = (i, sg) => (sg > 0 ? need[i].p : need[i].m);
      let jumpy = false;
      for (let k = 1; k < run.length; k++) {
        const a = run[k - 1], b = run[k];
        if (sign[a] !== sign[b] && amt(a, sign[a]) + amt(b, sign[b]) > 0.1) jumpy = true;
      }
      if (jumpy) {
        let tp = 0, tm = 0;
        for (const i of run) { tp += need[i].pe; tm += need[i].me; }
        for (const i of run) sign[i] = tp <= tm ? 1 : -1;
      }
      run = [];
    };
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (need[i]) run.push(i); else settleRun();
    }
    settleRun();
    out[s] = sign;
  }
  return out;
}
// Tip the foot (q, in place) so the shoe sits on the floor at rep time t. While the figure plays
// (T, ms), a tip lets go at a limited speed, so a foot pushing off fast doesn't drop flat within a
// frame, as long as the tip it still holds keeps the shoe out of the floor; tipping more (a foot
// coming down) takes effect at once.
const _fq2 = new Quaternion();
function footOnFloor(A, s, t, an, q, T) {
  let v = 0; // the tip, signed (rad)
  if (lowestProbe(an, q) < FLOOR_TOL) {
    let sg = 0;
    const tr = A.feet && A.feet[s];
    if (tr && t != null) {
      const n = tr.length, u = ((((t % A.tl.total) + A.tl.total) % A.tl.total) / A.tl.total) * n;
      const i0 = Math.floor(u) % n, i1 = (i0 + 1) % n;
      sg = u - Math.floor(u) < 0.5 ? tr[i0] || tr[i1] : tr[i1] || tr[i0];
    }
    let a;
    if (sg) a = footPitch(an, q, sg).a;
    else {
      const p = footPitch(an, q, 1), pa = p.a, pe = p.e;
      const m = footPitch(an, q, -1);
      if (pe <= m.e) { sg = 1; a = pa; } else { sg = -1; a = m.a; }
    }
    v = sg * a;
  }
  _fax.set(1, 0, 0).applyQuaternion(q);
  if (T != null) {
    const st = A.swing || (A.swing = {});
    const o = st['foot' + s] || (st['foot' + s] = { v: 0, T: -1, pv: 0, pT: -1 });
    // A second fit in the same frame (after the ankle went up) eases from the frame before.
    const bv = T === o.T ? o.pv : o.v, bT = T === o.T ? o.pT : o.T;
    if (bT >= 0 && T > bT && T - bT <= 250 && bv && Math.abs(v) < Math.abs(bv) && (!v || Math.sign(v) === Math.sign(bv))) {
      const held = Math.sign(bv) * Math.max(Math.abs(v), Math.abs(bv) - 0.006 * (T - bT));
      if (lowestProbe(an, _fq2.setFromAxisAngle(_fax, held).multiply(q)) >= FLOOR_TOL - 0.05) v = held;
    }
    if (T !== o.T) { o.pv = o.v; o.pT = o.T; }
    o.v = v; o.T = T;
  }
  if (Math.abs(v) < 1e-4) return q;
  return q.premultiply(_fq.setFromAxisAngle(_fax, v));
}
// Where a nearly straight upper arm's front is at rep time t (ms), from the hinge track: square to
// the arm (unit ua). Without a track (or a time) it's the carried hanging front.
function naturalFront(A, J, s, t, ua) {
  const tr = A.hinge;
  if (tr && t != null && tr[s]) {
    const u = ((((t % tr.total) + tr.total) % tr.total) / tr.total) * tr.n;
    const i0 = Math.floor(u) % tr.n, k = u - Math.floor(u);
    const a = tr[s][i0], b = tr[s][(i0 + 1) % tr.n];
    const v = V3().addScaledVector(J.up, lerp(a[0], b[0], k)).addScaledVector(J.fwdC, lerp(a[1], b[1], k)).addScaledVector(J.latC, lerp(a[2], b[2], k));
    const p = perp(v, ua);
    if (p.lengthSq() > 0.05) return p.normalize();
  }
  return armFront(ua, J.up, J.fwd);
}
// The frame an arm's hand turns in, from the upper arm's front F (unit vectors ua, fa, F): R, the
// side the forearm folds toward (a supinated palm faces it), and N, where a neutral palm faces (the
// body's midline when the arm hangs; thumb forward). A palm pronated by p degrees faces
// R cos p + N sin p. H is the elbow's hinge axis.
function armFrame(ua, fa, F, right) {
  const H = V3().crossVectors(ua, F);
  if (H.lengthSq() < 1e-8) H.copy(anyPerp(ua));
  H.normalize();
  const R = perp(V3().crossVectors(H, fa), fa);
  if (R.lengthSq() < 1e-8) R.copy(anyPerp(fa));
  R.normalize();
  const N = V3().crossVectors(fa, R); // = H on the left arm, -H on the right (square to fa)
  if (right) N.negate();
  return { F, H, R, N: N.normalize() };
}
const palmAt = (fr, deg) => fr.R.clone().multiplyScalar(Math.cos(deg * D2R)).addScaledVector(fr.N, Math.sin(deg * D2R));

// Arms for the side and front lifts.
function arms(A, J, pts, f, P2, P3, T, t) {
  const L = PZ().L;
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    const lat = J.lat.clone().multiplyScalar(sg);
    const g = A.grip[s];
    const c = g ? { kind: 'equip', w: 0 } : handContact(A, pts, s);
    const hint = A.hint;
    // A hand resting on the floor or a top, eased per figure as it lands or lifts, so its width, the
    // elbow, the wrist's height and the palm all turn together (a fast hand crosses the few
    // centimetres where it counts as resting within a frame or two).
    const onSurf = (c.kind === 'floor' || c.kind === 'top') ? c.w : 0;
    const surfs = A.surfY || (A.surfY = {});
    if (onSurf > 0) surfs[s] = { y: c.kind === 'floor' ? 0 : c.y, floor: c.kind === 'floor' };
    const planted = surfs[s] != null ? settle(A, 'plant' + s, onSurf, T, 0.006, 0.008).v : 0;
    // The palm turns flat, the hand widens and the elbow flares a little slower (a quarter second to
    // let go), so a hand pushing off the floor doesn't flip over at the wrist. A form's hint can
    // slow the landing too (palmIn, ms), for a hand coming down a long way round onto a seat.
    const palm = surfs[s] != null ? settle(A, 'palm' + s, onSurf, T, hint.palmIn ? 1 / hint.palmIn : 0.006, 0.004).v : 0;
    let sh = J.sh[s].clone();
    let W, pole, flare = 2.5;
    const wr2 = P3 ? P3(null, 'wr', s) : P2(pts['wr' + s]);
    const el2 = P3 ? P3(null, 'el', s) : P2(pts['el' + s]);
    const hd2 = P3 ? P3(null, 'hd', s) : P2(pts['hd' + s]);
    if (J.shift && !(c.kind !== 'free' && c.w > 0.5)) { wr2.add(J.shift); el2.add(J.shift); hd2.add(J.shift); }
    if (A.view === 'side') {
      // Hand width: the shoulder's, unless both hands share one object or the hand rests somewhere
      // (blended by how firmly it rests there, so a hand arriving on the floor doesn't jump).
      let hz = SH_W + 2;
      const on = smooth(0.1, 0.45, c.kind === 'bar' || c.kind === 'wall' ? c.w : palm);
      if (g && g.both) {
        const r = g.e.r || 8;
        hz = { bb: 24, ez: 15.5, latbar: 36, kb: 5.2, ball: r * 1.25 + 2.2, towel: g.e.between ? 16 : SH_W + 1, band: g.e.between ? 18 : SH_W + 1.5, rope: 9, handle: 4.2 }[g.type] || hz;
      } else if (c.kind === 'bar') hz = lerp(hz, c.bar.dip ? 25 : /chin/.test(A.move.id || '') ? 18.5 : 23, on);
      else if (c.kind === 'wall') hz = lerp(hz, 21.5, c.w);
      else if (surfs[s]) hz = lerp(hz, surfs[s].floor ? (A.lying ? (A.prone ? 22 : 24) : 21) : 21, on);
      const hinted = hint.handZ && hint.handZ[s] != null;
      if (hinted) hz = hint.handZ[s];
      // Hands near the head (at the temples) sit at its sides, elbows wide (unless the move says how
      // wide its hands are: they only look near the head from the side).
      const hC = hd2.clone().lerp(wr2, 0.4);
      const onHandles = A.props.some((p) => p.type === 'machine' || p.type === 'cable');
      const atHead = !g && !onHandles && !hinted && J.headC ? (1 - smooth(11, 18, hC.distanceTo(V3(J.headC.x, J.headC.y, 0)))) * (1 - on) : 0;
      hz = lerp(hz, 12, atHead);
      W = V3(wr2.x, wr2.y, sg * hz);
      pole = V3(el2.x, el2.y, sg * (SH_W + hz) * 0.5);
      if (c.kind === 'bar') flare = lerp(2.5, 7, on);
      else if (surfs[s]) flare = lerp(2.5, 9, palm);
      flare = lerp(flare, 26, atHead);
    } else {
      W = wr2.clone();
      pole = el2.clone();
      // Hands the 2D solves onto a target (a ball, a bell) reach out in front of the body: the
      // 2D arms lie flat in the picture plane, which would put the ball inside the chest.
      const ikd = (`ik.hd${s}.x` in f) && c.kind !== 'floor' && c.kind !== 'wall';
      const held = J.held;
      // Depths the pose gives its arm (a reach to a target with depth, or `depth` for arms drawn
      // by angle): the 3D figure puts the wrist and elbow there.
      const dz = pts['depthwr' + s] != null ? pts['depthwr' + s] : null;
      if (held && g && g.both) {
        W = held.c.clone().addScaledVector(J.latC, sg * (held.r + 1.8)).add(V3(0, -1.5, -2));
        // Elbows hang below the arms and a little out.
        pole = sh.clone().lerp(W, 0.5).add(V3(0, -22, 0)).addScaledVector(J.latC, sg * 12);
      } else if (dz != null) {
        const oz = J.shift ? J.shift.z : 0;
        const ez = pts['depthel' + s];
        W.z = dz + oz;
        pole.z = (ez != null ? ez : (W.z + sh.z) / 2 + 6) + oz;
        flare = 0;
        // Reaching a target: the fist, not the wrist, lands on it, so what it holds is where the
        // pose puts it.
        if (`ik.hd${s}.z` in f) {
          const T3 = V3(f[`ik.hd${s}.x`], -f[`ik.hd${s}.y`] + A.raise, f[`ik.hd${s}.z`]);
          if (J.shift) T3.add(J.shift);
          for (let k = 0; k < 2; k++) {
            const e = ik2(sh, W, L.ua, L.fa, pole, null, 0).mid;
            W = T3.clone().addScaledVector(T3.clone().sub(e).normalize(), -8.9);
          }
        }
      } else if (ikd) {
        const d = Math.hypot(W.x - sh.x, W.y - sh.y);
        const reach = 0.84 * (L.ua + L.fa);
        W.z = sh.z + Math.sqrt(Math.max(0, reach * reach - d * d)) * 0.85;
        pole.z = (W.z + sh.z) / 2 - 4;
      }
      if (!(held && g && g.both) && dz == null) relaxedPole(A, pts, s, sh, W, J, lat, flare, pole, t);
    }
    if (hint.flare && hint.flare[s] != null) flare = hint.flare[s];
    // Planted hands put the palm on the surface (the flat palm puts the wrist lower than the flat
    // figure's, hence the easing: an arm landing fast would straighten with a flick); bars put the
    // fist around the bar.
    if (planted > 0 && A.view !== 'top') {
      // The wrist sits just above the palm, which lies flat on the surface; only while the flat
      // figure's wrist is near it, so a hand pushing off fast isn't held down while it lets go.
      const near = 1 - smooth(4, 14, W.y - surfs[s].y);
      W.y = lerp(W.y, surfs[s].y + 2.05, planted * near);
    }
    if (c.kind === 'wall' && c.w > 0) {
      const wx = c.wall.x;
      if (A.view === 'side') W.x = lerp(W.x, wx - c.wall.side * 5.5, c.w);
      else W.x = lerp(W.x, wx - (c.wall.side || 1) * 5.5, c.w); // the wrist stays on the room side of the wall
    }
    if (!g && c.kind !== 'bar') {
      // Out of the trunk and thighs: pushed sideways, eased per figure so a fast hand sliding off
      // a knee doesn't snap back.
      const need = clearThighs(J, clearTrunk(J, W.clone(), 3, lat), 3, lat).sub(W).dot(lat);
      W.addScaledVector(lat, settle(A, 'hand' + s, need, T, 0.15, 0.15).v);
    } else if (g && pts['depthwr' + s] == null && ((g.both && ['kb', 'bb', 'ez', 'latbar', 'ball', 'rope'].includes(g.type)) || g.type === 'handle')) {
      // A hand on one thing held in front of the body (a bell in both hands, a cable handle pulled
      // across) is pushed forward, out of the trunk, the head and the thighs, not out to the side
      // (unless the pose placed the hand in depth itself).
      const fwd = J.fwdC;
      const need = clearThighs(J, clearFront(J, W.clone(), 6), 3.5, fwd).sub(W).dot(fwd);
      W.addScaledVector(fwd, settle(A, 'handF' + s, need, T, 0.15, 0.15).v);
    }
    // Scapular give: reach a little further when a planted hand is just out of range (fading out as
    // the hand leaves the floor, so the shoulder doesn't jump back).
    const reach = L.ua + L.fa;
    let d = W.distanceTo(sh);
    const grab = c.kind === 'bar' || c.kind === 'wall' ? 1 : smooth(0.1, 0.5, planted);
    if (d > reach - 0.3 && grab > 0) {
      const give = Math.min(4, d - reach + 0.3) * grab;
      sh.addScaledVector(W.clone().sub(sh).normalize(), give);
    }
    pole.addScaledVector(lat, flare);
    // A free hand (or one holding something) keeps a soft elbow; one resting on or gripping something
    // locks out as it takes weight (by the contact's weight, so it doesn't jump as it lets go).
    const soft = g || c.kind === 'free' ? 1 : 1 - c.w;
    let r = ik2(sh, W, L.ua, L.fa, pole, lat, 0, 0, soft);
    // Elbow outside the trunk and head: the smallest swing outward about the shoulder–wrist axis
    // that clears them, found finely so it changes smoothly with the pose, then eased per figure.
    // Which way it swings stays put while it's swung out (the geometry alone could flip it).
    const prev = A.swing && A.swing[s];
    const sign = prev && prev.v > 0.01 && prev.sign ? prev.sign : r.sign;
    const swung = (a) => ik2(sh, W, L.ua, L.fa, pole, lat, a, sign, soft);
    const into = (rr) => clearTrunk(J, rr.mid, 4.3, lat).distanceTo(rr.mid);
    let need = 0;
    if (into(r) >= 0.2) {
      let lo = 0, hi = -1, best = 0, bestIn = Infinity;
      for (let a = 0.08; a <= 1.37; a += 0.08) {
        const p = into(swung(a));
        if (p < bestIn) { bestIn = p; best = a; }
        if (p < 0.2) { hi = a; break; }
        lo = a;
      }
      if (hi < 0) need = best;
      else {
        for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (into(swung(m)) < 0.2) hi = m; else lo = m; }
        need = hi;
      }
    }
    const sw = settle(A, s, need, T, 0.0045, 0.003);
    sw.sign = sign;
    if (sw.v > 1e-4) r = swung(sw.v);
    (J.swing || (J.swing = {}))[s] = { need, v: sw.v, sign };
    J.sh[s] = sh;
    J.el[s] = r.mid; J.wr[s] = r.end;
    const dirF = r.end.clone().sub(r.mid).normalize();
    const ua = r.mid.clone().sub(sh).normalize();
    // The upper arm's front: the way the elbow bends, or where the hinge track says for a nearly
    // straight arm. The forearm and hand turn in the frame it gives.
    const fr = armFrame(ua, dirF, armHinge(ua, dirF, naturalFront(A, J, s, t, ua)), A.rightSide[s]);
    (J.front || (J.front = {}))[s] = fr.F;
    (J.armFr || (J.armFr = {}))[s] = fr;
    // The 2D wrist angle carried onto the 3D forearm, about the elbow's hinge axis.
    const f2 = [pts['wr' + s][0] - pts['el' + s][0], pts['wr' + s][1] - pts['el' + s][1]];
    const h2 = [pts['hd' + s][0] - pts['wr' + s][0], pts['hd' + s][1] - pts['wr' + s][1]];
    const wa = Math.atan2(f2[0] * h2[1] - f2[1] * h2[0], f2[0] * h2[0] + f2[1] * h2[1]);
    let handDir = dirF.clone();
    if (Math.abs(wa) > 0.02) handDir.applyAxisAngle(fr.H, -wa);
    handFrame(A, J, s, sg, dirF, handDir, c, lat, fr, palm);
  }
}

// Orientation of a hand: +Y along the fingers, +Z out of the palm. Handles grips, planted palms,
// bars and relaxed hands. fr: the arm's frame (armFrame), which every choice of which way the palm
// faces is measured against, so the hand turns with the arm and never flips over mid-rep.
function handFrame(A, J, s, sg, dirF, handDir, c, lat, fr, planted) {
  const g = A.grip[s];
  const right = A.rightSide[s];
  const H = { curl: 1 };
  let Y = handDir.clone(), Z;
  const thumbTo = (T) => V3().crossVectors(right ? T : T.clone().negate(), Y); // Z from the thumb direction
  // The palm of this grip (0 supinated, 90 neutral, 180 pronated) or of a relaxed hand, which hangs
  // with the palm to the side.
  const palmOf = (deg) => perp(palmAt(fr, deg), Y);
  if (g && g.type !== 'ball') {
    let axis;
    const e = g.e;
    const t = g.type;
    if (t === 'db') {
      if (A.view === 'top' || A.hint.dbAxis === 'long') axis = J.up.clone();
      else if (e.orient === 'side') {
        // Across the forearm in the picture plane, as the 2D engine draws it.
        axis = dirF.clone().applyAxisAngle(A.view === 'side' ? V3(0, 0, 1) : J.fwd, (90 + (e.tilt || 0)) * D2R);
        if (A.view !== 'side') axis = perp(axis, dirF).normalize();
      } else axis = A.view === 'side' ? J.lat.clone() : J.fwd.clone();
    } else if (t === 'kb' && e.hold === 'horns') axis = Y_UP.clone(); // a fist round an upright horn
    else if (t === 'rope' || (t === 'kb' && !g.both && e.hold !== 'arm' && e.hold !== 'rack')) axis = dirF.clone().applyAxisAngle(J.lat, Math.PI / 2);
    else axis = J.lat.clone();
    axis = perp(axis, Y);
    if (axis.lengthSq() < 1e-4) axis = perp(J.fwd, Y);
    axis.normalize();
    // How the palm faces in this grip: supinated for curls and chin-ups; neutral for side-held
    // bells, ropes, horns, cable handles (they swivel) and bands held out to the side; pronated
    // otherwise. A form's hint can say (grip: 'sup' | 'neutral' | 'pro').
    const neutral = (t === 'db' && e.orient === 'side') || t === 'rope' || (A.view === 'top') || A.hint.dbAxis === 'long' || (A.view === 'front' && t === 'db') || (t === 'kb' && e.hold === 'horns') || t === 'handle' || (t === 'band' && A.view === 'front');
    const supin = (A.move.muscles || [])[0] === 'biceps' || /chin/.test(A.move.id || '');
    const hg = A.hint.grip;
    const want = palmOf(hg === 'sup' ? 0 : hg === 'neutral' ? 90 : hg === 'pro' ? 180 : supin ? 0 : neutral ? 90 : 180);
    if (t === 'band' || t === 'towel' || t === 'handle') {
      // Nothing rigid across the fist (a band's end, a swivelling handle): the hand holds it as the
      // grip wants.
      Z = want.lengthSq() > 1e-6 ? want : thumbTo(axis);
    } else {
      Z = thumbTo(axis);
      // Round an upright horn the thumb points up it (the axis, square to the fingers, never points
      // down); otherwise the way that turns the palm as the grip wants.
      if (!(t === 'kb' && e.hold === 'horns') && Z.dot(want) < 0) Z = thumbTo(axis.negate());
    }
  } else if (g && g.type === 'ball') {
    Z = palmOf(90);
    H.curl = 0.65;
  } else if (c.kind === 'bar') {
    // Hook grip around the bar (runs along Z, or along X for dip bars).
    const axis = c.bar.dip ? J.fwd.clone() : V3(0, 0, 1);
    const T0 = c.bar.dip ? axis : (/chin/.test(A.move.id || '') ? lat.clone() : lat.clone().negate());
    Z = thumbTo(perp(T0, Y).normalize());
  } else {
    // Relaxed: the palm to the side, toward the body's midline when the arm hangs. A form's hint can
    // turn it (palm { N, F }: 'up', 'down', or degrees as for a grip, 0 supinated to 180 pronated).
    const hp = A.hint.palm && A.hint.palm[s];
    Z = hp === 'up' ? V3(0, 1, 0) : hp === 'down' ? V3(0, -1, 0) : palmOf(typeof hp === 'number' ? hp : 90);
    if (Z.lengthSq() < 1e-4) Z = anyPerp(Y);
    Z.normalize();
    const pw = planted != null ? planted : (c.kind === 'floor' || c.kind === 'top') ? c.w : 0;
    if (pw > 0) {
      // Palm flat on the surface, fingers pointing where the head is along the trunk (a plank, a
      // pike with the trunk upside down), or where the chest faces when the trunk is upright (hands
      // on a chair edge behind the hips).
      const Zp = V3(0, -1, 0);
      let Yp = perp(J.up.clone().addScaledVector(J.fwd, 2 * Math.max(0, J.up.y)), Y_UP);
      if (Yp.lengthSq() < 1e-3) Yp = perp(J.fwd, Y_UP);
      if (Yp.lengthSq() < 1e-3) Yp = V3(1, 0, 0);
      Yp.normalize();
      Y = Y.lerp(Yp, pw).normalize();
      Z = Z.lerp(Zp, pw);
      H.curl = 1 - pw;
    } else if (c.kind === 'wall' && c.w > 0) {
      const n = A.view === 'side' ? V3(c.wall.side, 0, 0) : V3(-1, 0, 0);
      Y = Y.lerp(Y_UP, c.w).normalize();
      Z = Z.lerp(n, c.w);
      H.curl = 1 - c.w;
    }
  }
  Z = perp(Z, Y);
  if (Z.lengthSq() < 1e-6) Z = anyPerp(Y);
  Z.normalize();
  // The forearm turns with the palm as it would be with the wrist straight (a palm flat on the
  // floor faces along a vertical forearm, which says nothing about how the forearm is turned).
  const Zfa = Z.clone();
  if (Y.dot(dirF) < 0.9999) Zfa.applyQuaternion(new Quaternion().setFromUnitVectors(Y, dirF));
  J.hand[s] = { q: frameQ(Y, Z), curl: H.curl, Y, Z, Zfa: perp(Zfa, dirF).normalize() };
}

/* ---------------------------------------------------------------- figure */
function mesh(geo, mat, parent) {
  const m = new Mesh(geo, mat);
  m.matrixAutoUpdate = true;
  if (parent) parent.add(m);
  return m;
}

class Figure {
  constructor(move, o) {
    this.move = move;
    this.o = o;
    this.A = analyze(move, o);
    const A = this.A;
    this.M = makeMaterials(o);
    this.root = new Group();
    this.root.scale.x = o.mirrored ? -1 : 1;
    this.body = new Group();
    this.root.add(this.body);
    const B = bodyGeos();
    const M = this.M;
    // Which physical side each 2D limb is (for hand chirality and left/right geometry): side view
    // N is the right side, front view the left; confirmed from the lifted key pose.
    const nRight = A.view === 'side' || (A.view === 'top' && A.prone);
    A.rightSide = { N: nRight, F: !nRight };
    const J0 = A.lift(A, A.keyPts, A.keyF, null);
    const right = V3().crossVectors(J0.fwd, J0.up);
    A.rightSide = { N: J0.sh.N.clone().sub(J0.neck).dot(right) > 0, F: J0.sh.F.clone().sub(J0.neck).dot(right) > 0 };
    if (A.rightSide.N === A.rightSide.F) A.rightSide.F = !A.rightSide.N;
    // When in the rep each named pose is reached (a still of it is posed as at that moment), and
    // which way each elbow faces through the rep.
    A.poseT = {};
    let acc = 0;
    for (const st of A.tl.steps) { acc += st.ms; if (!(st.to in A.poseT)) A.poseT[st.to] = acc; acc += st.hold; }
    let Js = A.samples.map((sm) => A.lift(A, sm.pts, sm.f, null, sm.t));
    // Front view: a foot whose flat ankle never moves stays at one depth too (the knee takes what the
    // foreshortening says), so a planted foot doesn't slide forward and back as the legs turn.
    if (A.view === 'front' && A.kind !== 'prone') {
      const plant = {};
      for (const s of SIDES) {
        const p0 = A.samples[0].pts['an' + s];
        if (A.samples.every((sm) => { const p = sm.pts['an' + s]; return Math.hypot(p[0] - p0[0], p[1] - p0[1]) < 1.5 && -p[1] < 12; })) {
          plant[s] = Js.reduce((m, J) => m + J.an[s].z, 0) / Js.length;
        }
      }
      if (Object.keys(plant).length) {
        A.plantZ = plant;
        Js = A.samples.map((sm) => A.lift(A, sm.pts, sm.f, null, sm.t));
      }
    }
    A.hinge = hingeTrack(A, Js);
    A.feet = footTrack(A, Js);
    const workSide = A.uni ? A.work : null;
    const matsFor = (s) => (workSide && s !== workSide ? { skin: M.skinB, shirt: M.shirtB, shorts: M.shortsB } : { skin: M.skinA, shirt: M.shirtA, shorts: M.shortsA });
    const P = {};
    P.chest = mesh(B.chest, [M.shirtA, M.skinA], this.body);
    P.pelvis = mesh(B.pelvis, M.shortsA, this.body);
    P.neck = mesh(B.neck, M.skinA, this.body);
    P.head = new Group(); this.body.add(P.head);
    mesh(B.head, M.skinA, P.head);
    mesh(B.hair, M.hair, P.head);
    for (const s of SIDES) {
      const lr = A.rightSide[s] ? 'R' : 'L';
      const mm = matsFor(s);
      P['ua' + s] = mesh(B.uarm[lr], [mm.shirt, mm.skin], this.body);
      P['fa' + s] = mesh(B.farm[lr], mm.skin, this.body);
      const fist = !!(A.grip[s] && A.grip[s].type !== 'ball') || this.barHand(s);
      P['hd' + s] = mesh(fist ? B.fist[lr] : B.hand[lr], mm.skin, this.body);
      P['hd' + s].userData.fist = fist;
      P['th' + s] = mesh(B.thigh[lr], [mm.shorts, mm.skin], this.body);
      P['sh' + s] = mesh(B.shin[lr], [mm.skin, M.sock], this.body);
      P['ft' + s] = mesh(B.shoe, [M.shoe, M.sole], this.body);
    }
    this.P = P;
    this.eq = new Equipment(this);
    this.props = new Props(this);
    this.glowLevel = 0.3;
  }

  barHand(s) {
    const S = surfaces(this.A);
    if (!S.bars.length) return false;
    for (const { pts } of this.A.samples) if (handContact(this.A, pts, s).kind === 'bar') return true;
    return false;
  }

  // Pose the figure at time t (ms) of the rep, or at a named keyframe.
  setTime(t, T) {
    const P = PZ();
    const f = P.sampleAt(this.move, t);
    this.apply(f, P.solve(this.move, f), T, t);
  }
  setPose(name, T) {
    const P = PZ();
    const f = P.poseByName(this.move, name);
    this.apply(f, P.solve(this.move, f), T, this.A.poseT[name]);
  }

  // t: where in the rep this is (ms), for what the 2D data can't say (which way a straight elbow faces).
  apply(f, pts, T, t) {
    const A = this.A;
    const J = A.lift(A, pts, f, T, t);
    this.J = J;
    this.pts = pts;
    this.f = f;
    const P = this.P;
    const q = (y, z) => frameQ(y, z);
    // Trunk.
    P.pelvis.position.copy(J.hip);
    P.pelvis.quaternion.copy(q(J.up, J.fwdP));
    P.chest.position.copy(J.hip);
    P.chest.quaternion.copy(q(J.up, J.fwdC));
    const br = J.breath || 0;
    P.chest.scale.set(1 + br * 0.008, 1, 1 + br * 0.014);
    // Neck from the base of the neck toward the head.
    const base = J.hip.clone().addScaledVector(J.up, 51.5).addScaledVector(J.fwdC, -1.2);
    const hq = frameQ(J.headUp, J.headFwd);
    const headPos = J.headC;
    if (this.headQ && T != null && this.lastT != null) {
      // Head steadied a touch: it follows the trunk with a very short lag.
      const k = clamp((T - this.lastT) / 60, 0, 1);
      this.headQ.slerp(hq, k);
    } else this.headQ = hq.clone();
    P.head.position.copy(headPos);
    P.head.quaternion.copy(this.headQ);
    const attach = headPos.clone().add(V3(0, -5.5, -2.2).applyQuaternion(this.headQ));
    P.neck.position.copy(base);
    P.neck.quaternion.copy(q(attach.clone().sub(base), J.fwdC));
    P.neck.scale.set(1, clamp(attach.distanceTo(base) / 11.5, 0.7, 1.35), 1);
    for (const s of SIDES) {
      // Arms.
      const sh = J.sh[s], el = J.el[s], wr = J.wr[s];
      const uaY = el.clone().sub(sh), faY = wr.clone().sub(el);
      const hand = J.hand[s];
      P['ua' + s].position.copy(sh);
      P['ua' + s].quaternion.copy(q(uaY, J.front[s]));
      P['fa' + s].position.copy(el);
      P['fa' + s].quaternion.copy(q(faY, hand.Zfa));
      const hm = P['hd' + s];
      hm.position.copy(wr);
      hm.quaternion.copy(hand.q);
      if (hm.morphTargetInfluences) hm.morphTargetInfluences[0] = clamp(hand.curl, 0, 1);
      // Legs.
      const hp = J.hp[s], kn = J.kn[s], an = J.an[s];
      const thY = kn.clone().sub(hp), shY = an.clone().sub(kn);
      // The knee faces over the toes unless it's clearly bent some other way.
      const legFront = (y) => perp(J.foot[s].a, y.clone().normalize()).add(perp(J.fwdP, y.clone().normalize()).multiplyScalar(0.3));
      const tf = hinge(thY, shY.clone().negate(), legFront(thY));
      const sf = hinge(shY, thY, legFront(shY));
      P['th' + s].position.copy(hp);
      P['th' + s].quaternion.copy(q(thY, tf));
      P['sh' + s].position.copy(kn);
      P['sh' + s].quaternion.copy(q(shY, sf));
      const ft = J.foot[s];
      P['ft' + s].position.copy(an);
      if (ft.q) P['ft' + s].quaternion.copy(ft.q);
      else footOnFloor(A, s, t, an, frameQ(ft.a, ft.up, P['ft' + s].quaternion), T);
    }
    this.eq.update(J, pts, f);
    this.props.update(J, pts, f);
    this.lastT = T;
  }

  setGlow(level, dt) {
    const k = dt == null ? 1 : clamp(dt / 140, 0, 1);
    this.glowLevel = lerp(this.glowLevel, level, k);
    const A = this.A, M = this.M;
    const a = M.glowA.u.value, b = M.glowB.u.value;
    a.fill(0); b.fill(0);
    const bil = new Set(this.move.bilateralMuscles || []);
    for (const m of this.move.muscles || []) {
      const i = MI[m];
      if (!i) continue;
      a[i] = this.glowLevel;
      b[i] = !A.uni || CORE_MUSCLES.has(m) || bil.has(m) ? this.glowLevel : 0;
    }
  }

  dispose() {
    for (const m of Object.values(this.M)) if (m && m.dispose) m.dispose();
    this.eq.dispose();
    this.props.dispose();
  }
}

/* ---------------------------------------------------------------- equipment */
class Equipment {
  constructor(fig) {
    this.fig = fig;
    const A = fig.A, M = fig.M;
    const E = eqGeos();
    this.g = new Group();
    fig.root.add(this.g);
    this.items = [];
    this.own = [];
    this.attach = null; // where a cable clips on (a rope's ring), or per hand (handles)
    this.attachAt = {};
    for (const e of A.equip) {
      const it = { e, parts: {} };
      const hs = hands(e);
      if (e.type === 'db') {
        for (const s of hs) it.parts[s] = this.db(E, M);
      } else if (e.type === 'kb') {
        it.parts.kb = this.kb(E, M);
      } else if (e.type === 'ball') {
        const r = (e.r || 8) * 1.25;
        const b = new Group();
        mesh(E.ball, M.ball, b).scale.setScalar(r);
        const seam = mesh(E.ballSeam, M.ballSeam, b); seam.scale.setScalar(r);
        const seam2 = mesh(E.ballSeam, M.ballSeam, b); seam2.scale.setScalar(r); seam2.rotation.x = Math.PI / 2;
        it.parts.ball = this.add(b); it.r = r;
      } else if (e.type === 'band' || e.type === 'towel') {
        const n = e.between ? 1 : hs.length * (e.route === 'back' || e.route === 'arms' ? 2 : 1);
        it.parts.strands = [];
        for (let i = 0; i < n; i++) {
          const m = mesh(e.type === 'band' ? E.strand : E.strip, e.type === 'band' ? M.band : M.towel, this.g);
          it.parts.strands.push(m);
        }
      } else if (e.type === 'bb' || e.type === 'ez' || e.type === 'latbar') {
        it.parts.bar = this.bar(E, M, e.type, e.r);
      } else if (e.type === 'handle') {
        const h = new Group();
        mesh(E.grip, M.rubber, h);
        mesh(E.dFrame, M.chrome, h);
        mesh(E.ring, M.chrome, h).position.set(0, 7.8, 0);
        it.parts.handle = this.add(h);
      } else if (e.type === 'rope') {
        it.parts.ropes = [mesh(E.strand, M.cable, this.g), mesh(E.strand, M.cable, this.g)];
        it.parts.knobs = [mesh(E.knob, M.rubber, this.g), mesh(E.knob, M.rubber, this.g)];
        it.parts.ring = mesh(E.ring, M.chrome, this.g);
      }
      this.items.push(it);
    }
  }

  db(E, M) {
    const g = new Group();
    mesh(E.dbHandle, M.chrome, g);
    for (const sx of [-1, 1]) {
      mesh(E.dbHead, M.rubber, g).position.x = sx * 9.35;
      mesh(E.dbCollar, M.chrome, g).position.x = sx * 7.1;
    }
    return this.add(g);
  }

  kb(E, M) {
    const g = new Group();
    mesh(E.kbBell, M.iron, g).position.y = -12.8;
    mesh(E.kbHandle, M.iron, g);
    return this.add(g);
  }

  // Bake a rigid piece of kit into one mesh per material and add it.
  add(g) {
    this.own.push(...bake(g));
    this.g.add(g);
    return g;
  }

  bar(E, M, type, r) {
    const g = new Group();
    if (r === 0) {
      // A cable attachment (no plates): a short bar, knurled grips, the clip ring in the middle.
      const path = [];
      for (let i = 0; i <= 8; i++) {
        const x = -27 + (54 * i) / 8, ax = Math.abs(x);
        path.push(V3(x, 0, type === 'ez' && ax < 22 ? -1.6 * Math.max(0, Math.cos((ax / 22) * Math.PI * 1.5)) : 0));
      }
      mesh(new TubeGeometry(new CatmullRomCurve3(path), 32, 1.3, 10, false), M.steel, g).userData.own = true;
      for (const sx of [-1, 1]) mesh(E.grip, M.rubber, g).position.set(sx * 17, 0, 0);
      mesh(E.ring, M.chrome, g).position.set(0, 2, 0);
    } else if (type === 'bb') {
      const shaft = mesh(E.bar, M.steel, g); shaft.scale.x = 131;
      for (const sx of [-1, 1]) {
        const sl = mesh(E.sleeve, M.chrome, g); sl.scale.x = 41.5; sl.position.x = sx * (65.5 + 3 + 20.75);
        mesh(E.collar, M.chrome, g).position.x = sx * 67;
        mesh(E.bumper, M.plate, g).position.x = sx * 72.5;
        mesh(E.collar, M.chrome, g).position.x = sx * 76.5;
      }
    } else if (type === 'ez') {
      const path = [];
      for (let i = 0; i <= 16; i++) {
        const x = -62 + (124 * i) / 16;
        const ax = Math.abs(x);
        const z = ax < 32 ? -Math.max(0, 2.2 * Math.cos((ax / 32) * Math.PI * 2.5)) : 0;
        path.push(V3(x, 0, z));
      }
      mesh(new TubeGeometry(new CatmullRomCurve3(path), 64, 1.4, 10, false), M.steel, g).userData.own = true; // baked below
      for (const sx of [-1, 1]) {
        const sl = mesh(E.sleeve, M.chrome, g); sl.scale.x = 22; sl.position.x = sx * 73;
        mesh(E.plateSm, M.plate, g).position.x = sx * 67;
      }
    } else {
      mesh(new TubeGeometry(new CatmullRomCurve3([V3(-60, -12, 0), V3(-52, -5, 0), V3(-40, 0, 0), V3(0, 0.5, 0), V3(40, 0, 0), V3(52, -5, 0), V3(60, -12, 0)]), 80, 1.35, 10, false), M.steel, g).userData.own = true;
      for (const sx of [-1, 1]) { const gr = mesh(E.grip, M.rubber, g); gr.position.set(sx * 53, -6, 0); gr.rotation.z = sx * 0.62; }
      mesh(E.ring, M.chrome, g).position.set(0, 2, 0);
    }
    const tubes = [];
    g.traverse((o) => { if (o.userData.own) tubes.push(o.geometry); });
    this.add(g);
    for (const t of tubes) t.dispose(); // merged copies live on in the baked mesh
    return g;
  }

  // World-space grip point of the hand on side s (inside the fist).
  gripPoint(J, s) {
    const fig = this.fig;
    const m = fig.P['hd' + s];
    const local = m.userData.fist ? HAND_GRIP.clone() : V3(0, 6.5, 3.2);
    return local.applyQuaternion(J.hand[s].q).add(J.wr[s]);
  }

  update(J, pts, f) {
    const A = this.fig.A;
    for (const it of this.items) {
      const e = it.e;
      const hs = hands(e);
      if (e.type === 'db' && e.hold === 'feet') {
        // Squeezed between the feet: across the arches, its bar along the hips.
        const g = it.parts[hs[0]];
        const arch = (s) => J.an[s].clone().addScaledVector(J.foot[s] ? J.foot[s].a : J.fwd, 7);
        g.position.copy(arch('N').lerp(arch('F'), 0.5));
        g.quaternion.copy(frameQ(V3(0, 1, 0), V3().crossVectors(J.lat, V3(0, 1, 0))));
      } else if (e.type === 'db') {
        for (const s of hs) {
          const g = it.parts[s];
          g.position.copy(this.gripPoint(J, s));
          // Local X of the bell = the hand's thumb axis (X).
          g.quaternion.copy(J.hand[s].q);
        }
      } else if (e.type === 'kb') {
        const g = it.parts.kb;
        let grip, hang;
        if (pts.kb) {
          const c = V3(pts.kb[0], -pts.kb[1] + A.raise, 0);
          if (A.view === 'front') c.z = J.wr.N.z * 0.5 + J.wr.F.z * 0.5 + 4;
          if (A.view === 'top') c.set(-pts.kb[1], 12, pts.kb[0]);
          const hm = J.wr.N.clone().add(J.wr.F).multiplyScalar(0.5);
          hang = c.clone().sub(hm).normalize();
          grip = c.clone().addScaledVector(hang, -12.8);
        } else if (e.hold === 'hip' || e.hold === 'chest') {
          const t = e.hold === 'hip' ? 0.95 : 0.28;
          const c = J.neck.clone().lerp(J.hip, t).addScaledVector(J.fwd, e.hold === 'hip' ? 12.5 : 14);
          hang = J.up.clone().negate();
          grip = c.clone().addScaledVector(hang, -12.8);
        } else if (e.hold === 'horns') {
          // Bottom up, a fist round each horn: the handle runs between the grips and the bell stands
          // on it (its horns are 12.6 apart, 7 below the handle's top toward the bell).
          const gs = hs.map((s) => this.gripPoint(J, s));
          const m = gs.length === 2 ? gs[0].clone().add(gs[1]).multiplyScalar(0.5) : gs[0];
          const acr = gs.length === 2 ? gs[0].clone().sub(gs[1]) : J.lat.clone();
          hang = perp(Y_UP, acr.clone().normalize());
          if (hang.lengthSq() < 1e-4) hang = J.up.clone();
          hang.normalize();
          grip = m.clone().addScaledVector(hang, -7);
          g.position.copy(grip);
          g.quaternion.copy(frameQ(hang.clone().negate(), V3().crossVectors(acr, hang.clone().negate())));
          continue;
        } else if (e.hold === 'rack') {
          // Racked for a one-arm press: the handle across the fist, the bell resting on the back of
          // the forearm: on its outside at the shoulder, behind it once pressed overhead.
          const s = hs[0];
          grip = this.gripPoint(J, s);
          const up = clamp((J.wr[s].y - J.sh[s].y - 10) / 35, 0, 1);
          hang = V3(0, -0.8, 0).addScaledVector(J.lat, (s === 'N' ? 1 : -1) * 0.6 * (1 - up)).addScaledVector(J.fwd, -0.6 * up).normalize();
        } else {
          const gs = hs.map((s) => this.gripPoint(J, s));
          grip = gs.length === 2 ? gs[0].clone().add(gs[1]).multiplyScalar(0.5) : gs[0];
          const fa = hs.map((s) => J.wr[s].clone().sub(J.el[s]).normalize()).reduce((a, b) => a.add(b), V3()).normalize();
          hang = e.hold === 'hang' ? V3(0, -1, 0) : fa;
        }
        g.position.copy(grip);
        let across = hs.length === 2 ? J.wr.N.clone().sub(J.wr.F) : V3(1, 0, 0).applyQuaternion(J.hand[hs[0]].q);
        if (pts.kb || e.hold === 'hip' || e.hold === 'chest') across = J.lat.clone();
        // The bell hangs along -Y of its frame; its handle runs along X.
        const q = frameQ(hang.clone().negate(), V3().crossVectors(across, hang.clone().negate()));
        g.quaternion.copy(q);
      } else if (e.type === 'ball') {
        let c;
        if (J.held) c = J.held.c.clone();
        else if (pts.ball) {
          c = A.view === 'top' ? V3(-pts.ball[1], 14, pts.ball[0]) : V3(pts.ball[0], -pts.ball[1] + A.raise, 0);
          if (A.view === 'front') c.z = (J.wr.N.z + J.wr.F.z) * 0.5 + 3;
        } else {
          const gs = hs.map((s) => J.wr[s].clone().lerp(this.gripPoint(J, s), 0.9));
          c = gs.length === 2 ? gs[0].clone().add(gs[1]).multiplyScalar(0.5) : gs[0];
          if (A.view === 'side' && hs.length === 2) c.z = 0;
          if (e.offset) c.add(V3(e.offset[0], -e.offset[1], 0));
        }
        c.y = Math.max(c.y, it.r + 0.2);
        it.parts.ball.position.copy(c);
      } else if (e.type === 'band' || e.type === 'towel') {
        const grips = hs.map((s) => this.gripPoint(J, s));
        const segs = [];
        if (e.between) segs.push([grips[0], grips[1] || grips[0]]);
        else {
          hs.forEach((s, i) => {
            let from;
            if (typeof e.from === 'string') {
              const k = e.from.replace(/[NF]$/, '');
              // Standing on it with both feet: each end from its own foot; under one raised foot
              // (a towel curl): both ends from that foot.
              const own = e.from.slice(-1);
              const raised = this.fig.P['ft' + own].position.y > 14;
              const side = hs.length === 2 && !raised ? s : own;
              if (k === 'to' || k === 'an' || k === 'he') {
                const ft = this.fig.P['ft' + side];
                from = V3(0, 5, -7.6).applyQuaternion(ft.quaternion).add(ft.position);
              } else from = J[k] && J[k][side] ? J[k][side].clone() : grips[i].clone().add(V3(0, -60, 0));
            } else if (Array.isArray(e.from)) {
              // A third number (side view) anchors each end that far out on its own side: a band
              // round a chair's back comes from both of its posts, not from one point behind the back.
              from = A.view === 'top' ? V3(-e.from[1], 5, e.from[0]) : V3(e.from[0], -e.from[1] + A.raise, 0);
              if (A.view === 'side' && typeof e.from[2] === 'number') from.z = (s === 'N' ? 1 : -1) * e.from[2];
            } else from = grips[i].clone().add(V3(0, -40, 0));
            if (e.route === 'back') {
              // Up the back: from the foot, around behind the seat, to the hand.
              const via = J.hip.clone().addScaledVector(J.fwdP, -16).addScaledVector(J.latL || J.lat, (s === 'N' ? 1 : -1) * 8);
              segs.push([from, via], [via, grips[i]]);
            } else if (e.route === 'arms') {
              // Under the arm: from behind, past the side of the chest just below the armpit, to the hand.
              const via = J.sh[s].clone().addScaledVector(J.up, -12).addScaledVector(J.fwd, -2);
              segs.push([from, via], [via, grips[i]]);
            } else segs.push([from, grips[i]]);
          });
        }
        it.parts.strands.forEach((m, i) => {
          const sgm = segs[i];
          if (!sgm) { m.visible = false; return; }
          const d = sgm[1].clone().sub(sgm[0]);
          const len = Math.max(0.1, d.length());
          m.position.copy(sgm[0]);
          m.quaternion.copy(frameQ(d, A.view === 'side' ? V3(0, 0, 1) : V3(0, 0, 1).cross(d).lengthSq() > 1e-3 ? J.fwd : V3(1, 0, 0)));
          if (e.type === 'band') { const th = clamp(0.62 * Math.sqrt(60 / len), 0.42, 0.75); m.scale.set(th, len, th); } else m.scale.set(4.6, len, 1.1);
        });
      } else if (e.type === 'bb' || e.type === 'ez' || e.type === 'latbar') {
        const gs = hs.map((s) => this.gripPoint(J, s));
        const c = gs.length === 2 ? gs[0].clone().add(gs[1]).multiplyScalar(0.5) : gs[0];
        let ax = gs.length === 2 ? gs[0].clone().sub(gs[1]) : V3(1, 0, 0).applyQuaternion(J.hand[hs[0]].q);
        if (ax.lengthSq() < 1) ax = J.lat.clone();
        ax.normalize();
        const up = e.type === 'latbar' ? Y_UP : perp(J.fwd, ax);
        it.parts.bar.position.copy(c);
        // The bar runs along its local X, between the hands.
        let Yb = perp(up, ax);
        if (Yb.lengthSq() < 1e-4) Yb = anyPerp(ax);
        Yb.normalize();
        const X = ax;
        const Zb = V3().crossVectors(X, Yb);
        it.parts.bar.quaternion.setFromRotationMatrix(_m4.makeBasis(X, Yb, Zb));
      } else if (e.type === 'handle') {
        const s = hs[0];
        const gp = this.gripPoint(J, s);
        const X = V3(1, 0, 0).applyQuaternion(J.hand[s].q);
        const cf = this.fig.props.cableAt(s);
        const toCable = cf ? cf.clone().sub(gp) : V3(0, 1, 0);
        const Yb = perp(toCable, X).normalize();
        const Zb = V3().crossVectors(X, Yb);
        it.parts.handle.position.copy(gp);
        it.parts.handle.quaternion.setFromRotationMatrix(_m4.makeBasis(X, Yb, Zb));
        this.attachAt[s] = gp.clone().addScaledVector(Yb, 7.8);
      } else if (e.type === 'rope') {
        const gs = hs.map((s) => this.gripPoint(J, s));
        const mid = gs[0].clone().add(gs[1] || gs[0]).multiplyScalar(0.5);
        const cf = this.fig.props.cableAt(hs[0]);
        const toCable = cf ? cf.clone().sub(mid).normalize() : V3(0, 1, 0);
        const top = mid.clone().addScaledVector(toCable, 16);
        this.attach = top;
        it.parts.ring.position.copy(top);
        gs.forEach((gp, i) => {
          const m = it.parts.ropes[i];
          const d = gp.clone().sub(top);
          const len = d.length() + 6;
          m.position.copy(top);
          m.quaternion.copy(frameQ(d, J.fwd));
          m.scale.set(1.35, len, 1.35);
          it.parts.knobs[i].position.copy(top.clone().addScaledVector(d.normalize(), len));
        });
      }
    }
  }

  dispose() {
    for (const g of this.own) g.dispose();
  }
}

/* ---------------------------------------------------------------- props */
class Props {
  constructor(fig) {
    this.fig = fig;
    this.g = new Group();
    fig.root.add(this.g);
    this.own = [];
    this.walls = [];
    this.dyn = [];
    this.cables = []; // { from: pulley, to: 'both' | 'hdN' | 'hdF' }
    this.solidList = [];
    this.pending = [];
    const A = fig.A, M = fig.M;
    const front = A.view === 'front';
    for (const p of A.props) {
      const g = new Group();
      const b = this.build(p, M, A);
      if (!b) continue;
      for (const sd of this.pending) { sd.m.updateMatrix(); this.solidList.push({ b, local: sd.m.matrix.clone(), size: sd.size }); }
      this.pending = [];
      this.own.push(...bake(b));
      g.add(b);
      if (A.view === 'top') {
        // Top-view props are drawn in the floor plane already.
      } else if (front && ['box', 'chair', 'bench', 'table', 'mat', 'bar', 'dip', 'rack', 'smith'].includes(p.type)) {
        // Front view: long props run in depth (props built around the figure are already placed).
        g.rotation.y = -Math.PI / 2;
        g.position.x = p.x + (p.w || 0) / 2;
        b.position.x -= p.x + (p.w || 0) / 2;
      }
      this.g.add(g);
    }
  }

  geo(g) { this.own.push(g); return g; }
  // The pulley the cable in the hand on side s runs from (or null without a cable).
  cableAt(s) {
    const c = this.cables.find((k) => k.to === 'both' || k.to.slice(-1) === s) || this.cables[0];
    return c ? c.from : null;
  }
  // A solid part the body must stay out of (a seat, a box, a bench pad, a table top), for the tests.
  solid(m, w, h, d) { this.pending.push({ m, size: [w, h, d] }); return m; }
  // The solids as boxes in the figure's own space: { m: its matrix (column-major), size: [w, h, d] }.
  solids() {
    const root = this.fig.root;
    root.updateMatrixWorld(true);
    const inv = new Matrix4().copy(root.matrixWorld).invert();
    return this.solidList.map((sd) => ({ m: new Matrix4().multiplyMatrices(inv, sd.b.matrixWorld).multiply(sd.local).toArray(), size: sd.size }));
  }
  rbox(w, h, d, r, mat, x, y, z, parent) {
    const m = mesh(this.geo(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01))), mat, parent);
    m.position.set(x, y, z);
    return m;
  }
  cyl(r, l, mat, parent, seg = 14) { return mesh(this.geo(new CylinderGeometry(r, r, l, seg)), mat, parent); }

  build(p, M, A) {
    const g = new Group();
    const t = p.type;
    const front = A.view === 'front';
    if (t === 'chair') {
      const h = p.h || SEAT_H, d = 44, w = p.w;
      this.solid(this.rbox(w, 4.5, d, 1.8, M.wood, p.x + w / 2, h - 2.25, 0, g), w, 4.5, d);
      for (const [lx, lz] of [[3, 1], [w - 3, 1], [3, -1], [w - 3, -1]]) {
        const leg = this.cyl(1.6, h - 4.5, M.wood, g); leg.position.set(p.x + lx, (h - 4.5) / 2, lz * (d / 2 - 3));
      }
      if (p.back) {
        const bx = p.back > 0 ? p.x + w - 2.2 : p.x + 2.2;
        for (const lz of [1, -1]) { const post = this.cyl(1.6, 44, M.wood, g); post.position.set(bx, h + 22, lz * (d / 2 - 3)); }
        this.rbox(3, 16, d - 2, 1.4, M.wood, bx, h + 34, 0, g);
      }
    } else if (t === 'box') {
      const h = p.h || SEAT_H, w = p.w, d = 56;
      this.solid(this.rbox(w, h - 9, d, 4, M.fabric, p.x + w / 2, 9 + (h - 9) / 2, 0, g), w, h - 9, d);
      for (const [lx, lz] of [[4, 1], [w - 4, 1], [4, -1], [w - 4, -1]]) {
        const leg = this.cyl(1.8, 9, M.wood, g, 10); leg.position.set(p.x + lx, 4.5, lz * (d / 2 - 5));
      }
      if (p.back) {
        const bx = p.back > 0 ? p.x + w - 7 : p.x + 7;
        this.rbox(14, 36, d, 5, M.fabric, bx, h + 18, 0, g);
      }
    } else if (t === 'table') {
      const h = p.h || 72, w = p.w, d = 80;
      this.solid(this.rbox(w, 3.5, d, 1, M.wood, p.x + w / 2, h - 1.75, 0, g), w, 3.5, d);
      for (const [lx, lz] of [[4, 1], [w - 4, 1], [4, -1], [w - 4, -1]]) this.rbox(4, h - 3.5, 4, 0.8, M.wood, p.x + lx, (h - 3.5) / 2, lz * (d / 2 - 4), g);
    } else if (t === 'wall') {
      const side = p.side || 1;
      const m = front
        ? this.rbox(8, 240, 150, 1, M.wall, p.x + (side > 0 ? 4 : -4), 120, -20, g)
        : this.rbox(8, 240, 150, 1, M.wall, p.x + (side > 0 ? 4 : -4), 120, -30, g);
      this.walls.push({ m, x: p.x, mat: M.wall });
    } else if (t === 'door') {
      const leaf = this.rbox(4.5, 203, 86, 0.8, M.door, p.x + 2.25, 101.5, -8, g);
      this.rbox(9, 211, 7, 0.8, M.wall, p.x + 2.25, 105.5, -55, g);
      this.rbox(9, 211, 7, 0.8, M.wall, p.x + 2.25, 105.5, 39, g);
      this.rbox(9, 7, 101, 0.8, M.wall, p.x + 2.25, 207.5, -8, g);
      const knob = this.cyl(1.1, 9, M.chrome, g); knob.rotation.x = Math.PI / 2; knob.position.set(p.x - 3, 104, 28);
      const knob2 = this.cyl(1.1, 3, M.chrome, g); knob2.rotation.z = Math.PI / 2; knob2.position.set(p.x - 1, 104, 33);
      this.walls.push({ m: leaf, x: p.x, mat: M.door });
    } else if (t === 'mat') {
      if (A.view === 'top') this.rbox(p.w, 0.8, p.h || 62, 0.35, M.mat, p.x + p.w / 2, 0.4, p.y || 0, g);
      else this.rbox(p.w, 0.8, 62, 0.35, M.mat, p.x + p.w / 2, 0.4, 0, g);
    } else if (t === 'bar') {
      const x = (p.x1 + p.x2) / 2, y = -p.y;
      const bar = this.cyl(1.6, 128, M.chrome, g, 16); bar.rotation.x = Math.PI / 2; bar.position.set(x, y, 0);
      for (const lz of [1, -1]) {
        this.rbox(5, y + 14, 5, 1, M.frame, x, (y + 14) / 2, lz * 64, g);
        this.rbox(46, 3, 7, 1, M.frame, x, 1.5, lz * 64, g);
      }
      this.rbox(5, 5, 133, 1, M.frame, x, y + 14, 0, g);
    } else if (t === 'bench') {
      this.bench(p, M, g);
    } else if (t === 'rack' || t === 'smith') {
      const h = p.h || 140, x = p.x;
      for (const lz of [1, -1]) {
        if (t === 'smith') { const r = this.cyl(2.2, 215, M.chrome, g, 16); r.position.set(x, 107.5, lz * 62); }
        this.rbox(7, 225, 7, 1, M.frame, x + (t === 'smith' ? 9 : 0), 112.5, lz * 62, g);
        this.rbox(60, 5, 7, 1, M.frame, x, 2.5, lz * 62, g);
        this.rbox(8, 4, 5, 1, M.frame, x - 6, h, lz * 58, g);
      }
      this.rbox(7, 7, 131, 1, M.frame, x + (t === 'smith' ? 9 : 0), 225, 0, g);
    } else if (t === 'cable') {
      const x = p.x, py = p.y != null ? -p.y : 180; // picture y grows downward
      const back = x + 16 * Math.sign(x || 1);
      this.rbox(10, 215, 10, 1.5, M.frame, back, 107.5, -14, g);
      this.rbox(10, 215, 10, 1.5, M.frame, back, 107.5, 14, g);
      this.rbox(10, 6, 38, 1, M.frame, back, 215, 0, g);
      this.rbox(60, 4, 50, 1, M.frame, back, 2, 0, g);
      for (let i = 0; i < 12; i++) this.rbox(16, 3.4, 20, 0.6, M.stack, back, 8 + i * 3.8, 0, g);
      const pul = mesh(this.geo(new CylinderGeometry(4.5, 4.5, 2.4, 20)), M.chrome, g);
      pul.rotation.x = Math.PI / 2; pul.position.set(x, py, 0);
      const arm = this.rbox(Math.abs(back - x) + 4, 4, 4, 1, M.frame, (x + back) / 2, py, 0, g);
      void arm;
      const from = V3(x, py, 0);
      this.cables.push({ from, to: p.to || 'both' });
      const line = mesh(eqGeos().strand, M.cable, g);
      line.userData.dyn = true;
      this.dyn.push({ kind: 'cable', line, p, from });
    } else if (t === 'dip') {
      const h = p.h || 100, x = p.x;
      for (const lz of [1, -1]) {
        const bar = this.cyl(2, 58, M.chrome, g, 14); bar.rotation.z = Math.PI / 2; bar.position.set(x, h, lz * 27);
        for (const lx of [-24, 24]) this.rbox(5, h, 5, 1, M.frame, x + lx, h / 2, lz * 27, g);
        this.rbox(58, 3, 6, 1, M.frame, x, 1.5, lz * 27, g);
      }
    } else if (t === 'machine') {
      this.machine(p, M, g, A);
    } else if (t === 'rower') {
      this.rower(p, M, g, A);
    } else if (t === 'bike') {
      this.bike(p, M, g, A);
    } else if (t === 'treadmill') {
      // As the picture draws it: the belt from (x, h) rising at `incline` degrees for w, the
      // uprights and the console over its front end.
      const k = A.keyPts, w = p.w || 150, h = p.h || 20, inc = (p.incline || 0) * D2R;
      const x0 = p.x != null ? p.x : (k.anN[0] + k.anF[0]) / 2 - w / 2;
      const deck = new Group();
      deck.position.set(x0, h, 0); deck.rotation.z = inc;
      g.add(deck);
      this.rbox(w + 8, 11, 62, 3, M.frame, w / 2, -7.1, 0, deck);
      this.rbox(w, 1.6, 50, 0.6, M.belt, w / 2, -0.8, 0, deck);
      this.rbox(18, 13, 64, 3, M.pad, w + 12, -5, 0, deck);
      const b1 = V3(x0 + w * Math.cos(inc), h + w * Math.sin(inc), 0);
      const tube = (a2, b2, r = 4.5) => {
        const d = b2.clone().sub(a2);
        const m = this.rbox(r, d.length(), r, 1.5, M.frame, 0, 0, 0, g);
        m.position.copy(a2.clone().add(b2).multiplyScalar(0.5));
        m.quaternion.copy(frameQ(d, V3(0, 0, 1)));
      };
      for (const lz of [1, -1]) {
        tube(V3(x0 + 4, 0, lz * 26), V3(x0 + 4, h - 8, lz * 26), 6);
        tube(V3(b1.x + 8, 0, lz * 26), V3(b1.x + 8, b1.y - 8, lz * 26), 6);
        tube(V3(b1.x + 10, b1.y + 2, lz * 30), V3(b1.x - 2, b1.y + 112, lz * 30));
        tube(V3(b1.x + 2, b1.y + 92, lz * 30), V3(b1.x - 44, b1.y + 92, lz * 30), 3.6);
      }
      this.rbox(12, 22, 64, 3, M.pad, b1.x - 2, b1.y + 117, 0, g);
    } else {
      const w = p.w || 40, h = p.h || 40;
      this.rbox(w, h, 50, Math.min(5, h / 3), M.fabric, (p.x || 0) + w / 2, h / 2, 0, g);
    }
    return g;
  }

  bench(p, M, g) {
    const h = p.h || 45, w = p.w || 120, x = p.x;
    const inc = (p.incline || 0) * D2R;
    const back = p.back || 1;
    this.rbox(w - 18, 5, 8, 1.5, M.frame, x + w / 2, 14, 0, g);
    for (const ex of [x + 10, x + w - 10]) {
      this.rbox(6, 14, 8, 1.5, M.frame, ex, 7, 0, g);
      this.rbox(8, 3, 40, 1.2, M.frame, ex, 1.5, 0, g);
    }
    if (!inc) {
      this.solid(this.rbox(w, 7.5, 28, 3, M.pad, x + w / 2, h - 3.75, 0, g), w, 7.5, 28);
      this.rbox(6, h - 18, 6, 1, M.frame, x + w / 2, 14 + (h - 18) / 2, 0, g);
    } else {
      const seatL = Math.min(40, w * 0.36);
      const seatX = back > 0 ? x + seatL / 2 : x + w - seatL / 2;
      this.solid(this.rbox(seatL, 7.5, 28, 3, M.pad, seatX, h - 3.75, 0, g), seatL, 7.5, 28);
      this.rbox(6, h - 18, 6, 1, M.frame, seatX, 14 + (h - 18) / 2, 0, g);
      const hingeX = back > 0 ? x + seatL + 1.5 : x + w - seatL - 1.5;
      const bl = Math.max(50, w - seatL - 4);
      const pad = this.solid(this.rbox(bl, 7.5, 28, 3, M.pad, 0, 0, 0, g), bl, 7.5, 28);
      const dirx = back > 0 ? 1 : -1;
      pad.rotation.z = dirx * inc;
      pad.position.set(hingeX + dirx * Math.cos(inc) * bl / 2, h - 3.75 + Math.sin(inc) * bl / 2, 0);
      const strut = this.rbox(5, Math.max(10, h - 14 + Math.sin(inc) * bl * 0.45), 5, 1, M.frame, hingeX + dirx * Math.cos(inc) * bl * 0.55, 0, 0, g);
      strut.position.y = (h - 14 + Math.sin(inc) * bl * 0.45) / 2 + 7;
    }
  }

  machine(p, M, g, A) {
    const k = A.keyPts;
    const J0 = A.lift(A, k, A.keyF, null);
    const hip = J0.hip, up = J0.up, fwd = J0.fwd;
    const kind = p.kind || '';
    // Seat under the seat bones, back pad behind the trunk, a frame to the floor.
    const seatTop = hip.y - 9;
    const lying = kind === 'legCurl' && Math.abs(up.y) < 0.6;
    if (!lying && kind !== 'legPress') {
      this.rbox(38, 7, 34, 3, M.pad, hip.x + 2, seatTop - 3.5, 0, g);
      this.rbox(6, Math.max(4, seatTop - 7), 6, 1, M.frame, hip.x + 2, (seatTop - 7) / 2, 0, g);
      this.rbox(60, 4, 40, 1, M.frame, hip.x + 2, 2, 0, g);
    }
    if (kind !== 'legCurl' || !lying) {
      const bp = hip.clone().addScaledVector(up, 28).addScaledVector(fwd, -15.5);
      const pad = this.rbox(7, 52, 32, 3, M.pad, 0, 0, 0, g);
      pad.position.copy(bp);
      pad.quaternion.copy(frameQ(up, fwd));
      const bpost = this.rbox(6, 60, 6, 1, M.frame, 0, 0, 0, g);
      bpost.position.copy(bp.clone().addScaledVector(fwd, -6));
      bpost.quaternion.copy(frameQ(up, fwd));
    } else {
      const c = hip.clone().addScaledVector(up, 20).addScaledVector(fwd, -13);
      const pad = this.rbox(110, 7, 32, 3, M.pad, 0, 0, 0, g);
      pad.position.copy(c.clone().addScaledVector(up, -14));
    }
    const moving = new Group();
    moving.userData.dyn = true;
    g.add(moving);
    const parts = {};
    if (kind === 'legPress') {
      parts.plate = this.rbox(4, 46, 56, 1.5, M.frame, 0, 0, 0, moving);
      this.rbox(58, 9, 36, 3, M.pad, hip.x - 6, hip.y - 12, 0, g);
      const bp = hip.clone().addScaledVector(up, 26).addScaledVector(fwd, -14);
      this.rbox(7, 55, 34, 3, M.pad, 0, 0, 0, g).position.copy(bp);
    } else if (kind === 'legExt' || kind === 'legCurl') {
      parts.roller = mesh(this.geo(new CylinderGeometry(5, 5, 34, 18)), M.pad, moving);
      parts.lever = this.rbox(4, 1, 4, 1, M.frame, 0, 0, 0, moving);
    } else if (kind === 'pecDeck') {
      parts.padN = this.rbox(5, 30, 10, 2, M.pad, 0, 0, 0, moving);
      parts.padF = this.rbox(5, 30, 10, 2, M.pad, 0, 0, 0, moving);
    } else if (kind === 'chestPress' || kind === 'shoulderPress') {
      parts.hN = mesh(this.geo(new CylinderGeometry(1.8, 1.8, 13, 12)), M.rubber, moving);
      parts.hF = mesh(this.geo(new CylinderGeometry(1.8, 1.8, 13, 12)), M.rubber, moving);
      parts.armN = this.rbox(4, 1, 4, 1, M.frame, 0, 0, 0, moving);
      parts.armF = this.rbox(4, 1, 4, 1, M.frame, 0, 0, 0, moving);
    } else if (kind === 'rowSeat' || kind === 'pulldown') {
      if (kind === 'rowSeat') {
        const an = J0.an.N.clone().lerp(J0.an.F, 0.5);
        const fp = this.rbox(4, 34, 44, 1.5, M.frame, 0, 0, 0, g);
        fp.position.set(an.x + 9, an.y - 2, 0);
        fp.rotation.z = 0.35;
        this.rbox(Math.max(10, an.x + 9 - hip.x), 5, 10, 1.5, M.frame, (an.x + 9 + hip.x) / 2, 3, 0, g);
      }
      if (kind === 'pulldown') {
        const top = hip.clone().addScaledVector(up, 150);
        this.rbox(8, top.y, 8, 1, M.frame, hip.x - 30, top.y / 2, 0, g);
        this.rbox(40, 6, 8, 1, M.frame, hip.x - 10, top.y, 0, g);
        const kn = J0.kn.N.clone().lerp(J0.kn.F, 0.5);
        const roll = mesh(this.geo(new CylinderGeometry(4.5, 4.5, 40, 16)), M.pad, g);
        roll.rotation.x = Math.PI / 2; roll.position.set(kn.x - 4, kn.y + 12, 0);
      }
    }
    this.dyn.push({ kind: 'machine', mk: kind, parts, J0, p });
  }

  rower(p, M, g, A) {
    const k = A.keyPts;
    const J0 = A.lift(A, k, A.keyF, null);
    const feetX = (J0.an.N.x + J0.an.F.x) / 2;
    const x0 = Math.min(J0.hip.x, feetX) - 70, x1 = feetX + 55;
    this.rbox(x1 - x0, 5, 12, 2, M.frame, (x0 + x1) / 2, 20, 0, g);
    this.rbox(8, 20, 40, 2, M.frame, x0 + 4, 10, 0, g);
    const fly = mesh(this.geo(new CylinderGeometry(24, 24, 16, 32)), M.pad, g);
    fly.rotation.x = Math.PI / 2; fly.position.set(x1, 30, 0);
    this.rbox(6, 30, 44, 2, M.frame, x1, 15, 0, g);
    for (const s of SIDES) {
      const fp = this.rbox(4, 20, 14, 1.5, M.pad, 0, 0, 0, g);
      fp.position.set(J0.an[s].x + 6, J0.an[s].y - 2, J0.an[s].z);
      fp.rotation.z = 0.7;
    }
    const seat = this.rbox(30, 5, 26, 2, M.pad, 0, 0, 0, g);
    const handle = mesh(this.geo(new CylinderGeometry(1.6, 1.6, 50, 12)), M.rubber, g);
    handle.rotation.x = Math.PI / 2;
    const chain = mesh(eqGeos().strand, M.cable, g);
    seat.userData.dyn = handle.userData.dyn = chain.userData.dyn = true;
    this.dyn.push({ kind: 'rower', seat, handle, chain, fly: V3(x1 - 6, 32, 0) });
  }

  bike(p, M, g, A) {
    const k = A.keyPts;
    const J0 = A.lift(A, k, A.keyF, null);
    // Crank centre: middle of every sampled foot position.
    const c = V3();
    let n = 0;
    for (const { pts, f } of A.samples) {
      const J = A.lift(A, pts, f, null);
      for (const s of SIDES) { c.add(J.an[s]); n++; }
    }
    c.divideScalar(n || 1); c.z = 0;
    const seatP = J0.hip.clone().add(V3(-2, -10, 0));
    this.rbox(26, 6, 16, 2.5, M.pad, seatP.x, seatP.y, 0, g);
    const hands = J0.wr.N.clone().lerp(J0.wr.F, 0.5);
    const bar = mesh(this.geo(new CylinderGeometry(1.6, 1.6, 46, 12)), M.rubber, g);
    bar.rotation.x = Math.PI / 2; bar.position.set(hands.x + 4, hands.y - 2, 0);
    const tube = (a, b) => {
      const d = b.clone().sub(a);
      const m = this.rbox(4.5, d.length(), 4.5, 1.5, M.frame, 0, 0, 0, g);
      m.position.copy(a.clone().add(b).multiplyScalar(0.5));
      m.quaternion.copy(frameQ(d, V3(0, 0, 1)));
    };
    tube(V3(seatP.x, seatP.y - 3, 0), c);
    tube(c, V3(hands.x + 4, hands.y - 3, 0));
    tube(V3(c.x - 30, 3, 0), V3(c.x + 40, 3, 0));
    tube(V3(c.x + 36, 3, 0), V3(c.x + 30, c.y + 10, 0));
    const fly = mesh(this.geo(new CylinderGeometry(22, 22, 5, 32)), M.pad, g);
    fly.rotation.x = Math.PI / 2; fly.position.set(c.x + 30, c.y + 8, 0);
    const cranks = [], pedals = [];
    for (let i = 0; i < 2; i++) {
      cranks.push(this.rbox(3, 1, 3, 1, M.chrome, 0, 0, 0, g));
      pedals.push(this.rbox(11, 2.5, 8, 1, M.rubber, 0, 0, 0, g));
      cranks[i].userData.dyn = pedals[i].userData.dyn = true;
    }
    this.dyn.push({ kind: 'bike', c, cranks, pedals });
  }

  update(J, pts, f) {
    const fig = this.fig;
    for (const d of this.dyn) {
      if (d.kind === 'cable') {
        const eq = fig.eq;
        const to = d.p.to || 'hdN';
        const side = to === 'both' ? null : to.slice(-1);
        let target;
        if (side && eq.attachAt[side]) target = eq.attachAt[side];
        else if (eq.attach) target = eq.attach;
        else if (!side && (eq.attachAt.N || eq.attachAt.F)) target = eq.attachAt.N || eq.attachAt.F;
        else if (!side) target = eq.gripPoint(J, 'N').lerp(eq.gripPoint(J, 'F'), 0.5);
        else target = eq.gripPoint(J, side);
        const dd = target.clone().sub(d.from);
        d.line.position.copy(d.from);
        d.line.quaternion.copy(frameQ(dd, V3(0, 0, 1)));
        d.line.scale.set(0.35, dd.length(), 0.35);
      } else if (d.kind === 'machine') {
        this.machineUpdate(d, J, pts);
      } else if (d.kind === 'rower') {
        d.seat.position.set(J.hip.x - 1, J.hip.y - 11, 0);
        const h = J.wr.N.clone().lerp(J.wr.F, 0.5);
        const gp = fig.eq.gripPoint(J, 'N').lerp(fig.eq.gripPoint(J, 'F'), 0.5);
        d.handle.position.copy(gp.lengthSq() ? gp : h);
        const dd = d.fly.clone().sub(d.handle.position);
        d.chain.position.copy(d.handle.position);
        d.chain.quaternion.copy(frameQ(dd, V3(0, 0, 1)));
        d.chain.scale.set(0.3, dd.length(), 0.3);
      } else if (d.kind === 'bike') {
        SIDES.forEach((s, i) => {
          const ft = fig.P['ft' + s];
          const ped = V3(0, 9, -7.9).applyQuaternion(ft.quaternion).add(ft.position);
          const c = d.c.clone(); c.z = ped.z * 0.6;
          const dd = ped.clone().sub(c);
          d.cranks[i].position.copy(c.clone().addScaledVector(dd, 0.5));
          d.cranks[i].quaternion.copy(frameQ(dd, V3(0, 0, 1)));
          d.cranks[i].scale.set(1, Math.max(1, dd.length()), 1);
          d.pedals[i].position.copy(ped.clone().add(V3(0, -1.5, 0)));
        });
      }
    }
    // Walls and doors between the camera and the figure turn see-through.
    if (this.walls.length && fig.camPos) {
      const cx = fig.camPos.x * (fig.o.mirrored ? -1 : 1);
      for (const w of this.walls) {
        const behind = Math.sign(cx - w.x) !== Math.sign(J.hip.x - w.x);
        const op = behind ? 0.28 : 1;
        w.mat.opacity = op;
        w.mat.depthWrite = op > 0.99;
      }
    }
  }

  machineUpdate(d, J, pts) {
    const P = d.parts, k = d.mk;
    const lever = (m, a, b) => {
      const dd = b.clone().sub(a);
      m.position.copy(a.clone().add(b).multiplyScalar(0.5));
      m.quaternion.copy(frameQ(dd, V3(0, 0, 1)));
      m.scale.set(1, Math.max(1, dd.length()), 1);
    };
    if (k === 'legPress' && d.p && d.p.calf && pts) {
      // A calf raise: the plate stays square to the track under the balls of the feet.
      const c2 = PZ().sledCentre(d.p, pts);
      const u = dir2(90 + (d.p.angle || 45));
      const n = V3(u[0], -u[1], 0).normalize();
      P.plate.position.set(c2[0], -c2[1] + this.fig.A.raise, 0).addScaledVector(n, -4);
      P.plate.quaternion.copy(frameQ(V3(0, 0, 1).cross(n), n));
    } else if (k === 'legPress') {
      const soles = SIDES.map((s) => V3(0, 6, -8.5).applyQuaternion(this.fig.P['ft' + s].quaternion).add(this.fig.P['ft' + s].position));
      const c = soles[0].clone().add(soles[1]).multiplyScalar(0.5); c.z = 0;
      const n = V3(0, 0, 1).applyQuaternion(this.fig.P.ftN.quaternion).negate();
      P.plate.position.copy(c.clone().addScaledVector(n, -1.5));
      P.plate.quaternion.copy(frameQ(perp(V3(0, 1, 0), n).lengthSq() > 1e-3 ? perp(V3(0, 1, 0), n) : V3(1, 0, 0), n)).multiply(new Quaternion().setFromAxisAngle(V3(0, 1, 0), Math.PI / 2));
      P.plate.quaternion.copy(frameQ(V3(0, 0, 1).cross(n), n));
    } else if (k === 'legExt' || k === 'legCurl') {
      const s = 'N';
      const an = J.an.N.clone().lerp(J.an.F, 0.5), kn = J.kn.N.clone().lerp(J.kn.F, 0.5);
      const shin = an.clone().sub(kn).normalize();
      const ant = perp(this.fig.J.fwdP, shin).normalize();
      const sideOff = k === 'legExt' ? 1 : -1;
      const c = kn.clone().addScaledVector(shin, 34).addScaledVector(ant, sideOff * 8.5);
      c.z = 0;
      P.roller.position.copy(c);
      P.roller.rotation.set(Math.PI / 2, 0, 0);
      const pivot = kn.clone(); pivot.z = 22;
      const cc = c.clone(); cc.z = 22;
      lever(P.lever, pivot, cc);
      void s;
    } else if (k === 'pecDeck') {
      for (const s of SIDES) {
        const m = P['pad' + s];
        const c = J.el[s].clone().lerp(J.wr[s], 0.35);
        const fa = J.wr[s].clone().sub(J.el[s]).normalize();
        m.position.copy(c.addScaledVector(J.fwd, 5));
        m.quaternion.copy(frameQ(fa, J.fwd));
      }
    } else if (P.hN) {
      for (const s of SIDES) {
        const gp = this.fig.eq.gripPoint(J, s);
        const h = P['h' + s];
        h.position.copy(gp);
        h.quaternion.copy(frameQ(V3(1, 0, 0).applyQuaternion(J.hand[s].q), V3(0, 0, 1)));
        // Lever arms run from each handle back past the body (press) or down behind it (overhead).
        const sg = s === 'N' ? 1 : -1;
        const end = gp.clone().addScaledVector(J.lat, sg * 6.5);
        const piv = k === 'shoulderPress'
          ? end.clone().addScaledVector(J.up, -38).addScaledVector(J.fwd, -14).addScaledVector(J.lat, sg * 4)
          : end.clone().addScaledVector(J.fwd, -52).addScaledVector(J.lat, sg * 3);
        lever(P['arm' + s], piv, end);
      }
    }
  }

  dispose() { for (const g of this.own) g.dispose(); }
}

/* ---------------------------------------------------------------- stage */
let SHARED = null;
function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    disc: radialTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]),
    blurH: blurMaterial(true), blurV: blurMaterial(false),
    quad: new Mesh(new PlaneGeometry(2, 2)),
    quadCam: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
  };
  return SHARED;
}
function blurMaterial(h) {
  return new ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, d: { value: 1 / 256 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float d; varying vec2 vUv;
      void main(){ vec2 o = ${h ? 'vec2(d, 0.0)' : 'vec2(0.0, d)'}; vec4 s = vec4(0.0);
        s += texture2D(tDiffuse, vUv - 4.0*o) * 0.051; s += texture2D(tDiffuse, vUv - 3.0*o) * 0.0918;
        s += texture2D(tDiffuse, vUv - 2.0*o) * 0.12245; s += texture2D(tDiffuse, vUv - o) * 0.1531;
        s += texture2D(tDiffuse, vUv) * 0.1633; s += texture2D(tDiffuse, vUv + o) * 0.1531;
        s += texture2D(tDiffuse, vUv + 2.0*o) * 0.12245; s += texture2D(tDiffuse, vUv + 3.0*o) * 0.0918;
        s += texture2D(tDiffuse, vUv + 4.0*o) * 0.051; gl_FragColor = s; }`,
    depthTest: false, depthWrite: false,
  });
}

// Soft contact shadow: the figure rendered from below into a small texture, darker where it is
// close to the floor, then blurred and laid on the floor. Every figure draws its shadow right before
// itself on the one renderer, so they all share the two render targets and the depth material
// (a new figure allocates no GPU buffers for it).
function shadowTargets(sh) {
  if (sh.rt) return sh;
  const res = 256;
  sh.rt = new WebGLRenderTarget(res, res, { type: undefined, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
  sh.rt2 = new WebGLRenderTarget(res, res, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  sh.rt.texture.generateMipmaps = false; sh.rt2.texture.generateMipmaps = false;
  sh.res = res;
  sh.depth = new MeshDepthMaterial();
  sh.depth.onBeforeCompile = (s2) => {
    s2.fragmentShader = s2.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * 0.92 );');
  };
  return sh;
}
class ContactShadow {
  constructor(w, d, dark) {
    const sh = shadowTargets(shared());
    this.rt = sh.rt; this.rt2 = sh.rt2; this.res = sh.res; this.depth = sh.depth;
    this.g = new Group();
    this.plane = new Mesh(new PlaneGeometry(w, d).rotateX(Math.PI / 2), new MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity: dark ? 0.85 : 0.62, depthWrite: false, color: 0x000000 }));
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.plane.position.y = 0.06;
    this.g.add(this.plane);
    this.cam = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, 48);
    this.cam.rotation.x = Math.PI / 2;
    this.g.add(this.cam);
    this.w = w; this.d = d;
  }
  render(r, scene, hide) {
    const sh = shared();
    for (const o of hide) o.visible = false;
    this.plane.visible = false;
    scene.overrideMaterial = this.depth;
    const ca = r.getClearAlpha();
    const cc = r.getClearColor(new Color());
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, this.cam);
    scene.overrideMaterial = null;
    // Blur: two passes each way.
    const blur = (src, dst, mat, amt) => { mat.uniforms.tDiffuse.value = src.texture; mat.uniforms.d.value = amt / this.res; sh.quad.material = mat; r.setRenderTarget(dst); r.render(sh.quad, sh.quadCam); };
    for (const amt of [2.4, 1.1]) { blur(this.rt, this.rt2, sh.blurH, amt); blur(this.rt2, this.rt, sh.blurV, amt); }
    r.setRenderTarget(null);
    r.setClearColor(cc, ca);
    this.plane.visible = true;
    for (const o of hide) o.visible = true;
  }
  dispose() { this.plane.geometry.dispose(); this.plane.material.dispose(); } // the targets are shared
}

/* ---------------------------------------------------------------- view: scene + camera */
const VIEWS = {
  side: { az: 30, el: 11 },
  front: { az: 20, el: 13 },
  top: { az: 26, el: 52 },
};
class View {
  constructor(move, o) {
    this.move = move;
    this.o = o;
    this.fig = new Figure(move, o);
    this.scene = new Scene();
    this.scene.add(this.fig.root);
    this.camera = new PerspectiveCamera(30, 1, 5, 4000);
    const A = this.fig.A;
    // Default camera by the move's view; lying moves are seen from a bit higher.
    const v = VIEWS[A.view] || VIEWS.side;
    this.base = { az: v.az * D2R, el: (A.view === 'side' && A.lying ? 20 : v.el) * D2R };
    // Seated and prone front-view moves read better from higher and further round.
    if (A.view === 'front' && A.kind === 'seated') this.base = { az: 52 * D2R, el: 16 * D2R };
    if (A.view === 'front' && A.kind === 'prone') this.base = { az: 40 * D2R, el: 30 * D2R };
    // Standing front-view moves that only work the back (pull-aparts, reverse flies) are seen from
    // behind, where the working muscles are.
    const mus = move.muscles || [];
    if (A.view === 'front' && A.kind === 'stand' && mus.length && mus.every((m) => BACK_MUSCLES.has(m))) this.base.az = 152 * D2R;
    // A wall or door in front of the figure would hide it: look from behind-side instead.
    if (A.view === 'side' && A.props.some((p) => (p.type === 'wall' || p.type === 'door') && p.x > A.keyPts.hip[0] + 8)) this.base.az = -32 * D2R;
    if (o.mirrored) this.base.az = -this.base.az;
    this.base0 = Object.assign({}, this.base);
    this.bounds();
    this.stage();
    this.camState = { az: this.base.az, el: this.base.el };
  }

  // Everything the move ever occupies, as spheres (rig space, then mirrored to world).
  bounds() {
    const A = this.fig.A, fig = this.fig;
    const sp = [];
    const add = (p, r) => sp.push({ c: p.clone(), r });
    const J0 = [];
    for (const smp of A.samples) {
      fig.apply(smp.f, smp.pts, null, smp.t);
      J0.push(fig.J);
      const J = fig.J;
      add(J.headC, 12.5);
      add(J.hip, 15); add(J.neck.clone().lerp(J.hip, 0.3), 17); add(J.neck, 13);
      for (const s of SIDES) {
        add(J.sh[s], 7); add(J.el[s], 5.5); add(J.wr[s], 4.5);
        add(J.wr[s].clone().addScaledVector(J.hand[s].Y, 10), 4.5);
        add(J.hp[s], 9); add(J.kn[s], 6.5); add(J.an[s], 5);
        const ft = fig.P['ft' + s];
        add(V3(0, 17, -5).applyQuaternion(ft.quaternion).add(ft.position), 3.5);
        add(V3(0, -6, -5).applyQuaternion(ft.quaternion).add(ft.position), 3.5);
      }
      fig.eq.g.updateMatrixWorld(true);
      fig.eq.g.traverse((m) => {
        if (!m.isMesh) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const bs = m.geometry.boundingSphere;
        const c = bs.center.clone().applyMatrix4(m.matrixWorld);
        const sc = m.matrixWorld.getMaxScaleOnAxis();
        if (m.geometry === eqGeos().strand || m.geometry === eqGeos().strip) return;
        add(c, Math.min(bs.radius * sc, 30));
      });
    }
    // Props, clipped to the space around the figure so tall props don't shrink it.
    const fb = { x0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const s of sp) { fb.x0 = Math.min(fb.x0, s.c.x - s.r); fb.x1 = Math.max(fb.x1, s.c.x + s.r); fb.y1 = Math.max(fb.y1, s.c.y + s.r); fb.z0 = Math.min(fb.z0, s.c.z - s.r); fb.z1 = Math.max(fb.z1, s.c.z + s.r); }
    this.fig.props.g.updateMatrixWorld(true);
    this.fig.props.g.traverse((m) => {
      if (!m.isMesh || m === undefined) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      const cx0 = Math.max(bb.min.x, fb.x0 - 45), cx1 = Math.min(bb.max.x, fb.x1 + 45);
      const cy1 = Math.min(bb.max.y, fb.y1 + 12), cy0 = Math.max(bb.min.y, 0);
      const cz0 = Math.max(bb.min.z, fb.z0 - 25), cz1 = Math.min(bb.max.z, fb.z1 + 25);
      if (cx0 > cx1 || cy0 > cy1 || cz0 > cz1) return;
      for (const x of [cx0, cx1]) for (const y of [cy0, cy1]) for (const z of [cz0, cz1]) add(V3(x, y, z), 1);
    });
    const mir = this.o.mirrored ? -1 : 1;
    for (const s of sp) s.c.x *= mir;
    this.spheres = sp;
    // Debug close-ups (tests only): frame one body part.
    const focus = this.o.focus;
    if (focus) {
      const J = this.fig.J;
      const at = { head: [J.headC, 16], hand: [J.wr.N, 13], foot: [J.an.N, 16], trunk: [J.hip.clone().lerp(J.neck, 0.5), 40] }[focus];
      if (at) this.spheres = [{ c: at[0].clone().setX(at[0].x * mir), r: at[1] }];
    }
    // Floor footprint for the shadow and the floor disc.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of sp) { if (s.c.y - s.r > 70) continue; x0 = Math.min(x0, s.c.x - s.r); x1 = Math.max(x1, s.c.x + s.r); z0 = Math.min(z0, s.c.z - s.r); z1 = Math.max(z1, s.c.z + s.r); }
    if (!isFinite(x0)) { x0 = -40; x1 = 40; z0 = -30; z1 = 30; }
    this.foot = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0 + 50, d: z1 - z0 + 50 };
  }

  stage() {
    const o = this.o, sc = this.scene;
    const sh = shared();
    const env = envMap();
    if (env) { sc.environment = env; sc.environmentIntensity = o.dark ? 0.32 : 0.42; }
    const hemi = new HemisphereLight(o.dark ? 0xc8d4ff : 0xeef3ff, o.dark ? 0x2a2622 : 0x8f8478, o.dark ? 1.05 : 1.25);
    sc.add(hemi);
    // Key light from the camera's upper left, warm; a cool rim from behind.
    const key = new DirectionalLight(0xfff0e0, o.dark ? 2.3 : 2.5);
    const rim = new DirectionalLight(0xbfd6ff, o.dark ? 2.6 : 1.9);
    const az = this.base.az;
    const put = (l, daz, el, d = 400) => { l.position.set(Math.sin(az + daz) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az + daz) * Math.cos(el) * d); sc.add(l); sc.add(l.target); };
    put(key, -48 * D2R, 50 * D2R);
    put(rim, 155 * D2R, 28 * D2R);
    this.lights = [key, rim];
    const f = this.foot;
    // Floor disc: faint, fading to nothing at the edge.
    const r = Math.max(f.w, f.d) * 0.72;
    const disc = new Mesh(new CircleGeometry(1, 64).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: sh.disc, color: o.dark ? 0xffffff : 0x1c2433, transparent: true, opacity: o.dark ? 0.06 : 0.055, depthWrite: false }));
    disc.scale.set(r, 1, r * 0.8);
    disc.position.set(f.cx, 0.02, f.cz);
    disc.renderOrder = 0;
    sc.add(disc);
    this.disc = disc;
    this.shadow = new ContactShadow(f.w, f.d, o.dark);
    this.shadow.g.position.set(f.cx, 0, f.cz);
    sc.add(this.shadow.g);
    this.hideForShadow = [disc];
  }

  // Place the camera so the whole move fits at this angle. The fit (where to aim and how far back)
  // is worked out in 0.5° steps and cached, so the idle orbit and drags don't redo it every frame;
  // the direction itself stays exact, so the camera still moves smoothly.
  frame(az, el, aspect) {
    const cam = this.camera;
    cam.aspect = aspect;
    const f = this.fitFor(az, el, aspect);
    const ce = Math.cos(el);
    cam.position.set(f.tx + Math.sin(az) * ce * f.D, f.ty + Math.sin(el) * f.D, f.tz + Math.cos(az) * ce * f.D);
    cam.up.set(0, 1, 0);
    cam.lookAt(f.tx, f.ty, f.tz);
    cam.near = f.near;
    cam.far = f.far;
    cam.updateProjectionMatrix();
    this.fig.camPos = cam.position;
  }

  fitFor(az, el, aspect) {
    const step = 0.5 * D2R;
    const qa = Math.round(az / step), qe = Math.round(el / step);
    const k = `${qa}:${qe}:${aspect.toFixed(3)}`;
    const fits = this.fits || (this.fits = new Map());
    let f = fits.get(k);
    if (!f) {
      f = this.solveFit(qa * step, qe * step, aspect);
      if (fits.size >= 400) fits.delete(fits.keys().next().value);
      fits.set(k, f);
    }
    return f;
  }

  // Target and distance that frame every sphere at this angle (no allocations in the loops).
  solveFit(az, el, aspect) {
    const tY = Math.tan((this.camera.fov * D2R) / 2), tX = tY * aspect;
    const dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = Math.cos(az) * Math.cos(el);
    // fwd = -dir; right = normalize(fwd × up); up' = right × fwd.
    const fx = -dx, fy = -dy, fz = -dz;
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    let x0b = Infinity, x1b = -Infinity, y0b = Infinity, y1b = -Infinity, z0b = Infinity, z1b = -Infinity;
    for (const s of this.spheres) {
      const c = s.c, r = s.r;
      if (c.x - r < x0b) x0b = c.x - r; if (c.x + r > x1b) x1b = c.x + r;
      if (c.y - r < y0b) y0b = c.y - r; if (c.y + r > y1b) y1b = c.y + r;
      if (c.z - r < z0b) z0b = c.z - r; if (c.z + r > z1b) z1b = c.z + r;
    }
    let tx = (x0b + x1b) / 2, ty = (y0b + y1b) / 2, tz = (z0b + z1b) / 2;
    const span = Math.max(x1b - x0b, y1b - y0b, z1b - z0b);
    let D = span / (2 * Math.min(tX, tY)) + 60;
    const pad = 0.06;
    for (let it = 0; it < 7; it++) {
      const cx = tx + dx * D, cy = ty + dy * D, cz = tz + dz * D;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of this.spheres) {
        const vx = s.c.x - cx, vy = s.c.y - cy, vz = s.c.z - cz;
        const z = Math.max(1, vx * fx + vy * fy + vz * fz);
        const x = (vx * rx + vy * ry + vz * rz) / (z * tX), y = (vx * ux + vy * uy + vz * uz) / (z * tY);
        const px = s.r / (z * tX), py = s.r / (z * tY);
        if (x - px < x0) x0 = x - px; if (x + px > x1) x1 = x + px;
        if (y - py < y0) y0 = y - py; if (y + py > y1) y1 = y + py;
      }
      const sx = ((x0 + x1) / 2) * D * tX, sy = ((y0 + y1) / 2) * D * tY;
      tx += rx * sx + ux * sy; ty += ry * sx + uy * sy; tz += rz * sx + uz * sy;
      const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2);
      D *= clamp(ext / (1 - pad), 0.5, 2);
    }
    return { tx, ty, tz, D, near: Math.max(2, D - span * 1.5), far: D + span * 1.5 + 200 };
  }

  // Drawn w × h px at the GL canvas's bottom left, or x px to the right of it (stills drawn side by
  // side, see copyOut).
  render(r, w, h, x = 0) {
    const az = this.camState.az, el = this.camState.el;
    const key = `${az.toFixed(4)}:${el.toFixed(4)}:${w}x${h}`;
    if (key !== this.fkey) { this.frame(az, el, w / h); this.fkey = key; }
    this.shadow.render(r, this.scene, this.hideForShadow);
    r.setRenderTarget(null);
    r.setViewport(x, 0, w, h);
    r.setScissor(x, 0, w, h);
    r.setScissorTest(true);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
  }

  dispose() {
    this.fig.dispose();
    this.shadow.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
  }
}

/* ---------------------------------------------------------------- renderer */
let R = null; // { r, canvas, w, h, released }
let lostCount = 0; // contexts lost while figures were on screen
let SUPPORTED = null;
let ENV = null;
let WARM = null; // a View kept alive after preload() so its shader programs stay compiled
let warmed = false; // and preload() has finished: those programs are compiled, not still compiling
let stillsReady = false; // the shaders a still needs are compiled (before the warm-up's last step)
let preloading = null;
const live = new Set();
let shownAt = -Infinity; // when the page last came to the front
let stalled = false; // tests: figures never draw (a GPU that's stuck compiling)
// With no figure on screen, the shared canvas shrinks after a moment (its buffers are most of the
// memory) and the GPU context itself is handed back after a few idle minutes, or 30 s after the app
// goes to the background. The compiled shaders stay warm until then.
let releaseMs = 180000;
let shrinkTimer = 0, releaseTimer = 0;
function clearTimers() {
  if (shrinkTimer) { clearTimeout(shrinkTimer); shrinkTimer = 0; }
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; }
}
function retain(self) {
  live.add(self);
  clearTimers();
}
function letGo(self) {
  live.delete(self);
  maybeRelease();
}
function maybeRelease() {
  if (live.size || !R) return;
  if (!shrinkTimer) {
    const shrink = () => {
      if (live.size || !R || !R.w) return;
      R.w = R.h = 0;
      try { R.r.setSize(1, 1, false); } catch (e) { /* ignore */ }
    };
    shrinkTimer = setTimeout(() => {
      shrinkTimer = 0;
      if (live.size || !R) return;
      // Resizing the canvas waits on the GPU (45 ms in a software-GL test at 4x CPU), so not in the
      // middle of a scroll, a drag or a switch's glide on the page opened after this one.
      const ui = typeof GH !== 'undefined' && GH.ui;
      const when = ui && (ui.whenQuiet || ui.whenCalm);
      if (when) when(shrink); else shrink();
    }, 2000);
  }
  if (!releaseTimer) releaseTimer = setTimeout(() => { releaseTimer = 0; if (!live.size) release(); }, document.hidden ? Math.min(releaseMs, 30000) : releaseMs);
}

function supported() {
  if (SUPPORTED != null) return SUPPORTED;
  if (R) return (SUPPORTED = true);
  // While the warm-up is under way, its renderer is the test: it makes one in a moment anyway, and a
  // throwaway test context first would be one more context creation (slow on some phones, seconds in
  // a software-GL test with the page busy).
  if (preloading) return !!renderer();
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2'); // three.js needs WebGL 2
    SUPPORTED = !!gl;
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { SUPPORTED = false; }
  return SUPPORTED;
}

function renderer() {
  if (R) return R;
  if (SUPPORTED === false) return null;
  // The renderer's own WebGL 2 context is the test for it (a throwaway test context first would
  // cost a second context creation, which is slow on some phones).
  const canvas = document.createElement('canvas');
  const attrs = { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' };
  let gl = null;
  try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
  if (!gl) { SUPPORTED = false; return null; }
  let r;
  try {
    r = new WebGLRenderer(Object.assign({ canvas, context: gl }, attrs));
  } catch (e) { SUPPORTED = false; return null; }
  SUPPORTED = true;
  r.setPixelRatio(1);
  r.outputColorSpace = SRGBColorSpace;
  // ACES keeps skin warm and the glow saturated (AgX washed both out in comparisons).
  r.toneMapping = ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.setClearColor(0x000000, 0);
  r.autoClear = false;
  const me = { r, canvas, w: 0, h: 0, released: false };
  canvas.addEventListener('webglcontextlost', (e) => {
    if (me.released) return; // we gave it back
    e.preventDefault();
    // A loss while the page is hidden is the phone reclaiming memory (often only reported once the
    // app is back in front, seconds later when the GPU is busy redrawing it); a loss while figures
    // are on screen is the GPU giving up. Twice of those and this session stays with the flat figure.
    const hidden = document.hidden || performanceNow() - shownAt < 5000;
    if (live.size && !hidden) lostCount++;
    if (lostCount >= 2) SUPPORTED = false;
    // Each figure frees its view while the renderer still exists.
    for (const m of [...live]) m.fail({ reason: 'lost', hidden });
    if (R === me) forget(me);
  });
  R = me;
  return R;
}
// Drop everything tied to a renderer: the warm-up view, the environment map and the GPU copies of
// the shared shapes (the shapes themselves stay and are uploaded again next time).
function forget(rr) {
  R = null;
  preloading = null;
  if (WARM) { try { WARM.dispose(); } catch (e) { /* ignore */ } WARM = null; }
  warmed = stillsReady = false;
  held.clear(); // stills waiting for shaders this renderer was compiling: posed again next time
  strip.x = strip.h = 0; // (stills drawn in this task and not copied out yet: their copy finds R gone)
  unhold(); // (the stills that waited for the warm-up's copy go back to the page)
  if (flying) { flying = 1; landed(); }
  if (ENV) { try { ENV.dispose(); } catch (e) { /* ignore */ } ENV = null; }
  const drop = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.isBufferGeometry || o.isTexture || o.isMaterial) { try { o.dispose(); } catch (e) { /* ignore */ } return; }
    for (const v of Object.values(o)) drop(v);
  };
  drop(BODY); drop(EQ);
  if (SHARED) {
    drop({ disc: SHARED.disc, blurH: SHARED.blurH, blurV: SHARED.blurV, quad: SHARED.quad.geometry, depth: SHARED.depth });
    for (const k of ['rt', 'rt2']) if (SHARED[k]) { try { SHARED[k].dispose(); } catch (e) { /* ignore */ } }
    SHARED.rt = SHARED.rt2 = SHARED.depth = null; // made again with the next renderer
  }
  try { rr.r.dispose(); } catch (e) { /* ignore */ }
  rr.canvas.width = rr.canvas.height = 1; // the backing store goes even if the browser restores it
}
function release() {
  const rr = R;
  if (!rr) return;
  rr.released = true;
  try { rr.r.forceContextLoss(); } catch (e) { /* ignore */ }
  forget(rr);
}
function ensureSize(w, h) {
  const rr = R;
  if (w > rr.w || h > rr.h) {
    rr.w = Math.max(rr.w, w); rr.h = Math.max(rr.h, h);
    rr.r.setSize(rr.w, rr.h, false);
  }
}
function envMap() {
  if (ENV) return ENV;
  if (!R) return null;
  try {
    const pm = new PMREMGenerator(R.r);
    ENV = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  } catch (e) { ENV = null; }
  return ENV;
}

const isLost = (rr) => { try { return rr.r.getContext().isContextLost(); } catch (e) { return true; } };
// Draw a view into a 2D context (w×h device pixels). A lost context draws nothing, so the figure's
// canvas keeps its last frame until the loss is handled.
function draw(view, ctx, w, h) {
  const rr = renderer();
  if (!rr || isLost(rr)) return false;
  ensureSize(w, h);
  view.render(rr.r, w, h);
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(rr.canvas, 0, rr.h - h, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return true;
}

/* ---------------------------------------------------------------- phases */
// Where time t sits in the rep: ph is 'con' (lifting), 'ecc' (lowering) or 'hold'. A via point (a
// `through` step with no hold) and the step it leads on to in the same phase are one stretch of it:
// t runs over both and i names the step it ends at, so the glow doesn't start over at the via.
function phaseAt(move, t) {
  const tl = move.$tl || PZ().timeline(move);
  let r = ((t % tl.total) + tl.total) % tl.total;
  const n = tl.steps.length;
  const phOf = (i) => (move.rep[i] && move.rep[i].ph) || 'move';
  const joined = (i) => i + 1 < n && tl.steps[i].through && !tl.steps[i].hold && phOf(i + 1) === phOf(i);
  for (let i = 0; i < n; i++) {
    const s = tl.steps[i];
    const raw = phOf(i);
    if (r < s.ms) {
      let j = i, before = 0, all = s.ms;
      for (let q = i - 1; q >= 0 && joined(q); q--) { before += tl.steps[q].ms; all += tl.steps[q].ms; }
      while (joined(j)) { j++; all += tl.steps[j].ms; }
      return { ph: raw === 'ecc' ? 'ecc' : raw === 'iso' ? 'hold' : 'con', step: raw, i: j, t: all ? (before + r) / all : 1 };
    }
    r -= s.ms;
    if (r < s.hold) return { ph: 'hold', step: raw, i, t: s.hold ? r / s.hold : 1, after: raw };
    r -= s.hold;
  }
  return { ph: 'hold', step: 'iso', i: 0, t: 0 };
}
// Glow strength for a phase: bright while lifting, dim while lowering.
function glowFor(p, T) {
  if (p.step === 'iso') return 0.62 + 0.14 * Math.sin((T / 900) * Math.PI);
  if (p.ph === 'con') return p.step === 'move' ? 0.55 : 0.5 + 0.5 * smooth(0, 0.6, p.t);
  if (p.ph === 'ecc') return 0.72 - 0.34 * smooth(0, 0.8, p.t);
  if (p.after === 'con') return 0.95 + 0.05 * Math.sin((T / 180) * Math.PI);
  if (p.after === 'ecc') return 0.38;
  return 0.55;
}

/* ---------------------------------------------------------------- mount */
const DEFAULT_SHIRT = '#3b5bdb';
function optsOf(o) {
  o = o || {};
  return {
    reducedMotion: !!o.reducedMotion, static: !!o.static, mirrored: !!o.mirrored, lead: !!o.lead,
    dark: !!o.dark, skin: o.skin || 'sand', shirt: o.shirt || DEFAULT_SHIRT, glow: o.glow || '#ff9f43',
    onFallback: typeof o.onFallback === 'function' ? o.onFallback : null, onReady: typeof o.onReady === 'function' ? o.onReady : null,
    fps: o.fps || 30, label: o.label, focus: o.focus,
  };
}

let visHooked = false;
function hookVisibility() {
  if (visHooked || typeof document === 'undefined') return;
  visHooked = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { shownAt = performanceNow(); for (const m of live) m.kick(); return; }
    if (!live.size && R) { if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = 0; } maybeRelease(); }
  });
}

function mount(host, move, opts) {
  const o = optsOf(opts);
  const P = PZ();
  const tl = move.$tl || P.timeline(move);
  const el = document.createElement('div');
  el.className = 'fig3d';
  el.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:pan-y;-webkit-tap-highlight-color:transparent;user-select:none';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label || move.name || 'Exercise diagram');
  el.appendChild(canvas);
  if (host) host.appendChild(el);
  const ctx = canvas.getContext('2d');
  const noop = () => {};
  const ctl = {
    el, duration: tl.total, onPhase: null,
    play: noop, pause: noop, playOnce: noop, setView: noop, seek: noop,
    phase: () => ({ ph: 'hold', step: 'iso', i: 0, t: 0 }),
    destroy() { el.remove(); },
  };
  let failed = false;
  let playing = false, raf = 0, clock = 0, lastNow = 0, lastDraw = 0, onceUntil = -1, wake = 0, orbit0 = 0;
  let visible = true, dirty = true, W = 0, H = 0;
  let lastPh = null;
  let view = null, ro = null, io = null, self = null;
  // Everything this figure holds goes: its frame loop, observers, place in `live` and its view.
  const teardown = () => {
    failed = true;
    stop();
    if (wake) { clearTimeout(wake); wake = 0; }
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    el.remove();
    if (view) { try { view.dispose(); } catch (e) { /* ignore */ } view = null; }
    if (self) { letGo(self); self = null; }
  };
  // onFallback(ctl, { reason, hidden }): 'unsupported', 'error', 'draw', or 'lost' (hidden: the phone
  // took the GPU back while the app was in the background, so 3D can be tried again later).
  const fallback = (info) => {
    if (failed) return;
    teardown();
    if (o.onFallback) Promise.resolve().then(() => o.onFallback(ctl, info || { reason: 'error', hidden: false }));
  };
  if (!renderer()) { fallback({ reason: 'unsupported', hidden: false }); return ctl; }
  try { view = new View(move, o); } catch (e) {
    if (G.console) G.console.error('figure3d:', e);
    fallback({ reason: 'error', hidden: false });
    return ctl;
  }
  hookVisibility();
  const keyPose = view.fig.A.key;
  // Only an explicit still holds the key pose. Reduced motion keeps the exercise moving (it's the
  // content) and just stops the camera drifting and animating between views.
  const still = o.static;
  const frameMs = 1000 / Math.max(1, Math.min(60, o.fps)) - 1;
  const cam = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, drag: null, back: 0, orbit: 0, view: null, anim: null };
  const pr = () => Math.min(G.devicePixelRatio || 1, 2);
  const resize = () => {
    const w = Math.max(1, Math.round(el.clientWidth * pr())), h = Math.max(1, Math.round(el.clientHeight * pr()));
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h; dirty = true;
    // A resized canvas is blank until it's drawn again: draw now (ResizeObserver runs before paint).
    if (view && !failed && onScreen()) render();
    kick();
  };
  ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(el);
  io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) kick(); }) : null;
  if (io) io.observe(el);

  const poseAt = (t, T) => {
    if (still && onceUntil < 0) view.fig.setPose(keyPose, null);
    else view.fig.setTime(t, T);
  };
  const glowAt = (t, T, dt) => {
    if (still && onceUntil < 0) { view.fig.setGlow(0.78, null); return; }
    const p = phaseAt(move, t);
    view.fig.setGlow(glowFor(p, T), dt);
    const key = p.ph + ':' + p.i;
    if (key !== lastPh) {
      lastPh = key;
      if (typeof ctl.onPhase === 'function') { try { ctl.onPhase(p); } catch (e) { /* app errors stay in the app */ } }
    }
  };
  let ready = false;
  const render = () => {
    if (!W || !H) resize();
    if (!W || !H || failed || stalled) return;
    // A lost context keeps the last frame; its loss event swaps the figure out.
    if (R && isLost(R)) return;
    const az = view.base.az + cam.yaw + cam.orbit, el2 = view.base.el + cam.pitch;
    view.camState.az = az; view.camState.el = el2;
    if (!draw(view, ctx, W, H)) { fallback({ reason: 'draw', hidden: false }); return; }
    dirty = false;
    // The first real frame is on the canvas: whoever mounted it can show it now.
    if (!ready && W > 1 && H > 1) {
      ready = true;
      el.dataset.ready = '1';
      if (o.onReady) Promise.resolve().then(() => { if (!failed) o.onReady(ctl); });
    }
  };
  const onScreen = () => visible && el.isConnected && !(typeof document !== 'undefined' && document.hidden);
  // A sheet being dragged or settling (the sheet engine marks <html data-sheet-moving>): every frame
  // goes to the sheet, so the figure holds its pose and the rep carries on from there after. A sheet
  // settles well within a second and a half; a mark left on longer than that is stale.
  let markSince = 0;
  const sheetMoving = () => {
    const on = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-sheet-moving');
    if (!on) { markSince = 0; return false; }
    const now = performanceNow();
    if (!markSince) markSince = now;
    return now - markSince < 1500;
  };
  function tick(now) {
    raf = 0;
    if (failed) return;
    if (!onScreen()) { lastNow = 0; return; }
    if (sheetMoving()) { lastNow = now; kick(); return; }
    const dt = lastNow ? Math.min(100, now - lastNow) : 0;
    lastNow = now;
    let busy = false; // something on screen changes this frame
    if (playing || onceUntil >= 0) {
      clock += dt;
      busy = true;
      if (onceUntil >= 0 && clock >= onceUntil) { onceUntil = -1; playing = false; dirty = true; }
    }
    // Camera: idle orbit while playing, drag, easing back, animated view changes.
    // (From where it started playing, so its first frame matches a still of the same moment.)
    if (playing && !o.reducedMotion) {
      if (!orbit0) orbit0 = now;
      cam.orbit = Math.sin(((now - orbit0) / 9000) * Math.PI * 2) * 7 * D2R;
      busy = true;
    }
    let later = 0;
    if (cam.drag) busy = true;
    else if (Math.abs(cam.yaw) > 1e-4 || Math.abs(cam.pitch) > 1e-4) {
      if (now > cam.back) {
        const k = 1 - Math.exp(-dt / 700);
        cam.yaw -= cam.yaw * k; cam.pitch -= cam.pitch * k;
        if (Math.abs(cam.yaw) < 1e-3 && Math.abs(cam.pitch) < 1e-3) { cam.yaw = 0; cam.pitch = 0; dirty = true; }
        busy = true;
      } else later = cam.back - now; // held where it was dragged to: nothing to draw until then
    }
    if (cam.anim) {
      const a = cam.anim;
      const t = clamp((now - a.t0) / a.ms, 0, 1);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * t);
      view.base.az = lerp(a.az0, a.az1, e); view.base.el = lerp(a.el0, a.el1, e);
      if (t >= 1) { cam.anim = null; dirty = true; }
      busy = true;
    }
    if ((busy && now - lastDraw >= (cam.drag ? 15 : frameMs)) || dirty) {
      lastDraw = now;
      const T = now;
      poseAt(clock, T);
      glowAt(clock, T, dt);
      render();
    }
    if (busy) kick();
    else if (later && !wake) wake = setTimeout(() => { wake = 0; kick(); }, later + 5);
  }
  function kick() { if (!raf && !failed) raf = G.requestAnimationFrame(tick); }
  function stop() { if (raf) G.cancelAnimationFrame(raf); raf = 0; }
  self = { kick, fail: fallback };
  retain(self);

  // Pointer: drag to turn (±70°), ease back after release, double-tap to reset.
  let lastTap = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    cam.drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, id: e.pointerId };
    moved = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    kick();
  });
  el.addEventListener('pointermove', (e) => {
    const d = cam.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    const w = Math.max(120, el.clientWidth);
    cam.yaw = clamp(d.yaw - (dx / w) * Math.PI * 0.9, -70 * D2R, 70 * D2R);
    cam.pitch = clamp(d.pitch + (dy / w) * Math.PI * 0.5, -10 * D2R, 22 * D2R);
    kick();
  });
  const end = (e) => {
    if (!cam.drag || cam.drag.id !== e.pointerId) return;
    cam.drag = null;
    cam.back = performanceNow() + 1400;
    dirty = true; // show exactly where it was let go
    const now = performanceNow();
    if (!moved) {
      if (now - lastTap < 320) { cam.yaw = 0; cam.pitch = 0; cam.back = 0; lastTap = 0; dirty = true; }
      else lastTap = now;
    }
    kick();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // A drag is not a tap on whatever holds the figure.
  el.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);

  Object.assign(ctl, {
    play() {
      if (still || failed) return;
      if (!playing) { playing = true; lastPh = null; }
      kick(); // also restarts a loop that stopped while the figure was off screen
    },
    // Check again whether it's on screen (after being moved into another box of the same size).
    wake() { kick(); },
    pause() { playing = false; dirty = true; kick(); },
    playOnce() {
      if (failed) return;
      clock = 0; onceUntil = tl.total; lastPh = null; kick();
    },
    // 'side' | 'front' | 'three-quarter' (the move's default); instant skips the camera move.
    setView(name, instant) {
      if (failed) return;
      const A = view.fig.A;
      const mir = o.mirrored ? -1 : 1;
      let az = view.base0.az, el3 = view.base0.el;
      // Side and top views are lifted with the body along the same axis; front views face the camera.
      if (name === 'side') { az = mir * (A.view === 'front' ? 90 : 0) * D2R; el3 = (A.view === 'top' ? 30 : 6) * D2R; }
      else if (name === 'front') { az = mir * (A.view === 'front' ? 0 : 90) * D2R; el3 = (A.view === 'top' ? 30 : 6) * D2R; }
      if (instant || o.reducedMotion) { cam.anim = null; view.base.az = az; view.base.el = el3; dirty = true; }
      else cam.anim = { t0: performanceNow(), ms: 800, az0: view.base.az, el0: view.base.el, az1: az, el1: el3 };
      kick();
    },
    phase() { return phaseAt(move, clock); },
    _view: view, // internal: tests and debugging
    // Show time t (ms into the rep) now; used by tests and for scrubbing. T: the clock (ms) to pose
    // with, so frames sought in time order ease their corrections as when playing; none takes each
    // correction straight away.
    seek(t, T) {
      if (failed) return;
      clock = t;
      poseAt(t, T == null ? null : T);
      glowAt(t, T == null ? 0 : T, null);
      render();
    },
    destroy() { teardown(); },
  });
  // First frame straight away (the key pose when still).
  poseAt(0, null); glowAt(0, 0, null);
  resize(); // sizes the canvas, and draws when it's on screen
  if (dirty) render();
  kick();
  return ctl;
}

const performanceNow = () => (G.performance ? G.performance.now() : Date.now());

/* ---------------------------------------------------------------- stills */
const stills = new Map();
// opts.t: a still of time t ms into the rep (as a live figure's first frame shows it) instead of
// the key pose.
const timeOf = (opts) => (opts && typeof opts.t === 'number' && isFinite(opts.t) ? Math.max(0, opts.t) : null);
const stillKey = (move, w, h, o, crop, t) => [move.id, JSON.stringify(move.equip || []), w, h, o.dark, o.skin, o.shirt, o.mirrored, crop || 0, t == null ? 'key' : Math.round(t)].join('|');
function stillSize(opts) {
  return [Math.max(16, Math.round((opts && opts.width) || 240)), Math.max(16, Math.round((opts && opts.height) || 200))];
}
// A still that's already been drawn, or null; never draws (safe inside a page render).
const cropOf = (opts) => (opts && opts.crop > 0 ? Math.round(opts.crop) : 0);
const drawSize = (opts) => { const crop = cropOf(opts); return crop ? [crop * 2, crop * 2] : stillSize(opts); };
function cachedStill(move, opts) {
  const o = optsOf(Object.assign({ static: true }, opts));
  const [w, h] = drawSize(opts);
  return stills.get(stillKey(move, w, h, o, cropOf(opts), timeOf(opts))) || null;
}
// A square crop of a still around the figure (anything drawn more than faintly: the body, what it
// holds, its shadow), side px across, so a small tile shows the body rather than the room the whole
// move needs. Drawn from a still twice the size, so it's scaled down and stays sharp. px: the
// still's pixels when they're at hand (else they're read from the canvas), and then the crop is
// drawn on the CPU too (a canvas the GPU kept would wait behind everything queued there).
function cropped(c, side, px) {
  const w = c.width, h = c.height;
  const soft = !!px;
  if (!px) px = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) {
      if (px[i] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return null;
  const box = Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.1;
  const out = document.createElement('canvas');
  out.width = side; out.height = side;
  const ctx = out.getContext('2d', soft ? { willReadFrequently: true } : undefined);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, (x0 + x1 + 1) / 2 - box / 2, (y0 + y1 + 1) / 2 - box / 2, box, box, 0, 0, side, side);
  return out;
}
// A still of the move's key pose, in two steps, so the second can wait for the shaders. stillPrep:
// the cache key (and the kept URL, if it's drawn already) and the figure posed for it. stillDraw: one
// frame of it and its copy out of the GL canvas (which waits on the GPU) and the crop, on the page's
// thread, then the view goes.
function stillPrep(move, opts) {
  const o = optsOf(Object.assign({ static: true }, opts));
  const crop = cropOf(opts), t = timeOf(opts);
  const [w, h] = drawSize(opts);
  const key = stillKey(move, w, h, o, crop, t);
  if (stills.has(key)) return { key, url: stills.get(key) };
  if (!renderer()) return null;
  try {
    const view = new View(move, o);
    if (t == null) { view.fig.setPose(view.fig.A.key, null); view.fig.setGlow(0.78, null); }
    else { view.fig.setTime(t, null); view.fig.setGlow(glowFor(phaseAt(move, t), 0), null); } // as a live figure's first frame
    view.camState = { az: view.base.az, el: view.base.el };
    return { key, view, w, h, crop };
  } catch (e) {
    if (G.console) G.console.error('figure3d:', e);
    return null;
  }
}
function stillDraw(st) {
  try {
    const c = document.createElement('canvas');
    c.width = st.w; c.height = st.h;
    const ctx = c.getContext('2d');
    if (!draw(st.view, ctx, st.w, st.h)) return null;
    return (st.crop ? cropped(c, st.crop) : c) || null;
  } catch (e) {
    if (G.console) G.console.error('figure3d:', e);
    return null;
  } finally {
    // Disposing the view doesn't lose compiled shaders while the warm-up view holds them.
    st.view.dispose();
    maybeRelease();
  }
}
function keepUrl(key, url) {
  if (stills.size > 160) stills.delete(stills.keys().next().value);
  stills.set(key, url);
  return url;
}
// A still of the move's key pose as an image URL, cached. opts: width, height, crop (a square this
// many px across, cropped to the figure) and the look (dark, skin, shirt, mirrored). All on the
// page's thread, the encoding too (110 ms and more for a 360 x 300 still in a software-GL test):
// stillAsync is the one for stills drawn in the background.
function still(move, opts) {
  const st = stillPrep(move, opts);
  if (!st) return null;
  if (st.url) return st.url;
  const pic = stillDraw(st);
  if (!pic) return null;
  let url = pic.toDataURL('image/webp', 0.9);
  if (!/^data:image\/webp/.test(url)) url = pic.toDataURL('image/png');
  return keepUrl(st.key, url);
}
// A drawn still encoded in the background (toBlob, WebP, else PNG): a promise of the Blob, or null.
function blobOf(pic) {
  return new Promise((resolve) => {
    try {
      pic.toBlob((blob) => {
        if (blob && blob.type === 'image/webp') resolve(blob);
        else pic.toBlob((b) => resolve(b || null), 'image/png');
      }, 'image/webp', 0.9);
    } catch (e) { resolve(null); }
  });
}
// The same as a data URL, which an <img> shows and the page can keep: a promise of the URL, or null.
function encode(pic) {
  if (!pic.toBlob) {
    try { let url = pic.toDataURL('image/webp', 0.9); if (!/^data:image\/webp/.test(url)) url = pic.toDataURL('image/png'); return Promise.resolve(url); } catch (e) { return Promise.resolve(null); }
  }
  return blobOf(pic).then((blob) => new Promise((resolve) => {
    if (!blob) { resolve(null); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  }));
}
// The same still with as little as can be on the page's thread: the figure is posed now; its shaders
// compile in the background where the GPU allows (compileAsync: the first still of a move with new
// kit compiled them on the thread, 730 ms in a software-GL test); then one frame and its copy out
// (a few frames' worth); then the picture is encoded in the background. Resolves with the URL, or
// null. One request per still at a time: a second asks for the same promise.
const pendingStills = new Map();
function stillAsync(move, opts) {
  const st = stillPrep(move, opts);
  if (!st) return Promise.resolve(null);
  if (st.url) return Promise.resolve(st.url);
  if (pendingStills.has(st.key)) { st.view.dispose(); return pendingStills.get(st.key); }
  const rr = renderer();
  const compiled = rr && rr.r.compileAsync ? Promise.resolve(rr.r.compileAsync(st.view.scene, st.view.camera)).catch(() => {}) : Promise.resolve();
  const p = compiled.then(() => {
    const pic = stillDraw(st);
    return pic ? encode(pic).then((url) => (url ? keepUrl(st.key, url) : null)) : null;
  }).then((url) => { pendingStills.delete(st.key); return url; }, () => { pendingStills.delete(st.key); return null; });
  pendingStills.set(st.key, p);
  return p;
}
/* ---------------------------------------------------------------- stills that wait on nothing */
// The page's stills (src/ui/stills.js: Plan's tiles, the plan builder's, set-up's reveal, Settings'
// preview) never wait for the GPU on the page's thread. Each is posed and drawn into its own part of
// the shared GL canvas, side by side, and everything drawn in one task is copied out at its end in one
// go, into a buffer on the GPU (readPixels into a pixel pack buffer, then a fence). Nothing waits for
// the GPU to finish drawing, which a copy out through a 2D canvas did: the still's whole frame, and
// everything the GPU had queued before it (a few frames' worth on a phone; in a software-GL test the
// first still of a launch waited 3 s there for the room's light). Once the fence says the copy's
// done (looked at every few ms), the pixels are read back, and each still is turned the right way
// up, cropped and encoded in the background.
const strip = { x: 0, h: 0, list: [], soon: false }; // the stills drawn in this task, left to right
// Resolves true once the GPU has done all it was asked so far, false if the context went meanwhile.
function fence(rr) {
  return new Promise((resolve) => {
    let gl = null, sync = null;
    try { gl = rr.r.getContext(); sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); } catch (e) { sync = null; }
    if (!sync) { resolve(false); return; }
    const look = () => {
      if (R !== rr || isLost(rr)) { resolve(false); return; }
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s === gl.TIMEOUT_EXPIRED) { setTimeout(look, 4); return; }
      gl.deleteSync(sync);
      resolve(s !== gl.WAIT_FAILED);
    };
    setTimeout(look, 4);
  });
}
// Stills copied out and not back yet: one batch at most, so the GPU never has a queue of them (a live
// figure's first frame waits for whatever the GPU has queued: a dozen stills held one for 1.5 s in a
// software-GL test). stillNow answers { busy } meanwhile, which resolves once it's back.
let flying = 0, landing = null, land = null;
function landed() {
  flying = Math.max(0, flying - 1);
  const r = land;
  landing = land = null;
  if (r) r();
}
const busyUntil = () => landing || (landing = new Promise((r) => { land = r; }));
// Room for a still w × h px right of what this task drew already. The canvas only grows here, by a
// few stills' room at a time (a resize waits on the GPU and clears the canvas, so what's drawn is
// copied out first).
function room(w, h) {
  const rr = R;
  if (strip.x + w > rr.w || h > rr.h) {
    copyOut();
    if (w > rr.w || h > rr.h) ensureSize(Math.max(rr.w, Math.min(2048, w * 4)), Math.max(rr.h, h));
  }
  const x = strip.x;
  strip.x += w;
  strip.h = Math.max(strip.h, h);
  return x;
}
// What this task drew, copied out of the canvas at once; each still's picture follows (s.done).
function copyOut() {
  const list = strip.list, w = strip.x, h = strip.h, rr = R;
  strip.list = [];
  strip.x = strip.h = 0;
  if (!list.length) return;
  const fail = () => { for (const s of list) s.done(null); };
  if (!rr || isLost(rr) || !w || !h) { fail(); return; }
  let gl = null, buf = null;
  try {
    gl = rr.r.getContext();
    buf = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  } catch (e) { fail(); return; }
  flying++;
  fence(rr).then((ok) => {
    let px = null;
    if (ok) {
      try {
        px = new Uint8Array(w * h * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      } catch (e) { px = null; }
    }
    try { gl.deleteBuffer(buf); } catch (e) { /* gone with the context */ }
    landed();
    if (!px) { fail(); return; }
    // Each still in a task of its own (a few ms each), so the page's thread is never held long.
    let i = 0;
    const one = () => {
      const s = list[i++];
      let pic = null;
      try { pic = cut(px, w, s); } catch (e) { pic = null; }
      s.done(pic);
      if (i < list.length) setTimeout(one, 0);
    };
    one();
  });
}
// One still out of the pixels read back (w px wide, rows from the bottom up, colours premultiplied by
// their alpha as the canvas keeps them): a canvas the right way up, cropped to the figure if asked.
function cut(px, w, s) {
  const img = new ImageData(s.w, s.h);
  const d = img.data;
  for (let y = 0; y < s.h; y++) {
    let i = (y * w + s.x) * 4, o = (s.h - 1 - y) * s.w * 4;
    for (let x = 0; x < s.w; x++, i += 4, o += 4) {
      const a = px[i + 3];
      if (!a) continue;
      const k = 255 / a;
      d[o] = px[i] * k; d[o + 1] = px[i + 1] * k; d[o + 2] = px[i + 2] * k; d[o + 3] = a;
    }
  }
  const c = document.createElement('canvas');
  c.width = s.w; c.height = s.h;
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return s.crop ? cropped(c, s.crop, d) : c;
}
// A posed still drawn into the canvas; a promise of its picture once it's copied out (null if it
// couldn't be). Its view goes as soon as it's drawn.
function stillOut(st) {
  return new Promise((resolve) => {
    const rr = renderer();
    try {
      if (!rr || isLost(rr)) { resolve(null); return; }
      clearTimers(); // (the canvas keeps its size while stills are drawn)
      const x = room(st.w, st.h);
      st.view.render(rr.r, st.w, st.h, x);
      strip.list.push({ x, w: st.w, h: st.h, crop: st.crop, done: resolve });
      if (!strip.soon) { strip.soon = true; queueMicrotask(() => { strip.soon = false; copyOut(); }); }
    } catch (e) {
      if (G.console) G.console.error('figure3d:', e);
      resolve(null);
    } finally {
      // Disposing the view doesn't lose compiled shaders while the warm-up view holds them.
      st.view.dispose();
      maybeRelease();
    }
  });
}
// A still drawn now, in the caller's idle moment (the figure posed and one frame of it, a few frames'
// worth on the page's thread once the figure is warm), so a caller with time left can draw another:
// those drawn in the same task are copied out together. Returns { blob }, a promise of the picture
// (WebP), encoded in the background; or { busy } while the last stills are still on their way (or
// the warm-up copies its still out), which resolves once they're back. A still that needs shaders no
// warm view keeps compiled (kit the warm-up didn't have) isn't drawn yet: they compile in the
// background where the GPU allows, and { wait } resolves once they have; the next call draws it (its
// figure is held meanwhile, so they stay compiled). null without 3D. The page keeps these itself
// (src/ui/stills.js), so they aren't kept here as well.
const held = new Map(); // key → a still posed and waiting for its shaders
const pendingBlobs = new Map(); // key → its picture on the way
function stillNow(move, opts) {
  const o = optsOf(Object.assign({ static: true }, opts));
  const [w, h] = drawSize(opts);
  const key = stillKey(move, w, h, o, cropOf(opts), timeOf(opts));
  if (pendingBlobs.has(key)) return { blob: pendingBlobs.get(key) };
  if (paused) return { busy: paused };
  if (flying && !strip.list.length) return { busy: busyUntil() };
  let st = held.get(key);
  if (st) held.delete(key);
  else {
    st = stillPrep(move, opts);
    if (!st) return null;
    if (st.url) return { url: Promise.resolve(st.url) };
    // Compiling only makes programs for what has none; more programs than before means new shaders.
    const r = R.r, n = r.info.programs.length;
    try { r.compile(st.view.scene, st.view.camera); } catch (e) { /* drawn below, compiled then */ }
    if (r.info.programs.length > n) {
      if (held.size >= 8) { const [k0, s0] = held.entries().next().value; held.delete(k0); s0.view.dispose(); }
      held.set(key, st);
      // (And the GPU done with them, so the first frame doesn't wait for it on the page's thread.)
      const rr = R;
      const wait = (r.compileAsync ? Promise.resolve(r.compileAsync(st.view.scene, st.view.camera)).catch(() => {}) : new Promise((done) => setTimeout(done, 50))).then(() => (R === rr ? fence(rr) : false));
      return { wait };
    }
  }
  const p = stillOut(st).then((pic) => (pic ? blobOf(pic) : null)).then((b) => { pendingBlobs.delete(key); return b; }, () => { pendingBlobs.delete(key); return null; });
  pendingBlobs.set(key, p);
  return { blob: p };
}

/* ---------------------------------------------------------------- preload */
function idle(fn) {
  if (G.requestIdleCallback) G.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(() => fn(null), 16);
}
// A view that stays alive once its programs are compiled (so later figures reuse them): the figure's,
// and a wall's or a door's (a transparent material, a program of its own that no figure's view keeps
// compiled, so a speck of it lives here: a still of a wall push-up compiled it again every time, 200
// ms in a software-GL test). Then one small frame to compile the contact-shadow passes too: the
// page's stills can be drawn from there (stillNow). Last, one still the size of Plan's tiles, out
// through a 2D canvas as a live figure's frames go: the first copy out of the GL canvas is the dear
// one (700 ms in the same test when a still was the first, 130 ms after), so it's paid here, where
// nothing waits on it: once the stills a screen waits for are drawn (busy(): whether one is left), the
// ones drawn ahead wait a moment while the GPU finishes what it was asked, so the copy waits on its
// own frame only (on the room's light it held the page's thread 3 s there, and in the middle of the
// stills more than a second). when(fn): runs each step.
const WARM_STILL = 208; // px: Plan's tiles at 2x
function warmUp(when, busy) {
  if (WARM || !R) return true;
  const m = GH.moves && GH.moves.MOVES && (GH.moves.MOVES.push_std || Object.values(GH.moves.MOVES)[0]);
  if (!m) return true;
  const view = new View(m, optsOf({ static: true }));
  view.fig.setPose(view.fig.A.key, null);
  view.fig.setGlow(0.78, null);
  if (view.fig.M && view.fig.M.wall) mesh(new PlaneGeometry(0.01, 0.01), view.fig.M.wall, view.scene).position.set(0, -200, 0);
  view.camState = { az: view.base.az, el: view.base.el };
  view.frame(view.base.az, view.base.el, 1);
  WARM = view;
  const r = R.r;
  const compiled = r.compileAsync ? r.compileAsync(view.scene, view.camera) : Promise.resolve(r.compile(view.scene, view.camera));
  // Each step in its own moment, and only while this view is still the warm one (not released).
  const mine = () => R && WARM === view && !isLost(R);
  const step = (fn) => () => new Promise((done) => when(() => {
    if (mine()) { try { fn(); } catch (e) { /* the warm-up is best effort */ } }
    done();
  }));
  // (Its first frame once the GPU is done with what it was asked, the shaders' compiling and the
  // room's light: the frame asks whether the shaders compiled, which waited for all of that on the
  // page's thread, 0.3 to 7 s in a software-GL test.)
  return compiled
    .then(() => (mine() ? fence(R) : false))
    .then(step(() => { ensureSize(64, 64); view.render(R.r, 64, 64); }))
    .then(() => {
      if (!mine()) return;
      stillsReady = true;
      for (const fn of readyFns.splice(0)) { try { fn(); } catch (e) { /* the page's own */ } }
    })
    .then(() => new Promise((done) => {
      // In a calm moment once no still a screen waits for is left (busy(): the page's own), the
      // stills drawn ahead wait (stillNow) until those on their way are out, the GPU is done, and
      // the copy's made.
      const go = () => when(() => {
        if (!mine()) { done(); return; }
        if (busy && busy()) { setTimeout(go, 250); return; }
        hold();
        settled().then((ok) => {
          if (ok && mine()) {
            try {
              const c = document.createElement('canvas');
              c.width = c.height = WARM_STILL;
              if (draw(view, c.getContext('2d'), WARM_STILL, WARM_STILL)) cropped(c, WARM_STILL / 2);
            } catch (e) { /* the warm-up is best effort */ }
          }
          unhold();
          done();
        });
      });
      go();
    }));
}
// While the warm-up copies its still out, the page's stills wait (stillNow returns { busy: paused }).
let paused = null, unpause = null;
function hold() { if (!paused) paused = new Promise((r) => { unpause = r; }); }
function unhold() { const r = unpause; paused = unpause = null; if (r) r(); }
// Resolves true once none of the page's stills is on its way (stillNow) and the GPU has done all it
// was asked; false if the renderer went meanwhile (the stills drawn meanwhile are held: hold()).
function settled() {
  return new Promise((resolve) => {
    const look = () => {
      const rr = R;
      if (!rr) { resolve(false); return; }
      if (pendingBlobs.size || strip.list.length) { setTimeout(look, 50); return; }
      fence(rr).then((ok) => {
        if (!ok) resolve(false);
        else if (pendingBlobs.size || strip.list.length) setTimeout(look, 50);
        else resolve(true);
      });
    };
    look();
  });
}
// Build the renderer, the body, the equipment, the room's light and the shaders ahead of the first
// figure, a small piece per idle moment so taps never wait on it (or whenever opts.when(fn) runs fn
// with an idle deadline: the page's stills hold the steps while the page is in use). The room's light
// comes after the body's shapes: it's the GPU's longest job here, and first, right after launch, its
// shaders compiled while the GPU was still drawing the page, which held the page's thread longest
// (2.8 s in a software-GL test), and the stills came no sooner for it. opts.ready(): called once
// stills can be drawn (stillsReady), a step before the end; opts.busy(): whether a still a screen
// waits for is left (the last step waits for those). Resolves true when 3D is ready.
const readyFns = [];
function preload(opts) {
  const onReady = opts && typeof opts.ready === 'function' ? opts.ready : null;
  if (onReady) { if (stillsReady || warmed) Promise.resolve().then(onReady); else readyFns.push(onReady); }
  if (preloading) return preloading;
  const when = opts && typeof opts.when === 'function' ? opts.when : idle;
  const busy = opts && typeof opts.busy === 'function' ? opts.busy : null;
  const steps = [
    () => (renderer() ? true : null), // null: no 3D here
    bodyStep, // false until every body part is built
    () => { eqGeos(); shared(); return true; },
    () => { envMap(); return true; },
    () => warmUp(when, busy), // a promise
  ];
  const p = new Promise((resolve) => {
    let i = 0;
    const run = (deadline) => {
      try {
        while (i < steps.length) {
          const out = steps[i]();
          if (out === null) { resolve(false); return; }
          if (out && typeof out.then === 'function') {
            i++;
            out.then(() => when(run), () => resolve(false));
            return;
          }
          if (out) i++;
          if (!deadline || deadline.timeRemaining() < 8) break;
        }
        if (i >= steps.length) { resolve(true); return; }
        when(run);
      } catch (e) {
        if (G.console) G.console.error('figure3d:', e);
        resolve(false);
      }
    };
    when(run);
  }).then((ok) => { if (ok && R && WARM && preloading === p) warmed = true; maybeRelease(); return ok; });
  preloading = p;
  // A failed or released warm-up can be tried again later.
  p.then((ok) => { if (!ok && preloading === p) preloading = null; });
  return p;
}

GH.figure3d = {
  supported, mount, still, stillAsync, stillNow, cachedStill, preload, phaseAt,
  // Whether the renderer is up and its shaders compiled, so a new figure draws its first frame at once
  // (not yet while the warm-up is compiling them: a figure would wait on that).
  warm() { return !!(R && WARM && warmed && !isLost(R)); },
  // Whether the page's stills can be drawn without compiling anything (stillNow): true once the
  // warm-up has compiled its shaders, a step before warm().
  stillsReady() { return !!(R && WARM && (stillsReady || warmed) && !isLost(R)); },
  // Internal, for tests: drop the shared GL context as a phone might, look at what's held, shorten
  // the idle release, and stop figures drawing (a GPU stuck compiling).
  _loseContext() { if (R) R.r.forceContextLoss(); },
  _stall(on) { stalled = !!on; },
  _stats() { return { live: live.size, renderer: !!R, warm: !!(WARM && warmed), lost: lostCount, programs: R ? R.r.info.programs.length : 0, size: R ? [R.w, R.h] : null }; },
  _releaseAfter(ms) { releaseMs = ms; },
  // The 3D joints of a move (id or move) at time t ms into the rep, without drawing anything (no
  // WebGL needed): [x, y, z] for the head centre, shoulders, elbows, wrists, hands (grip point),
  // hips, knees and ankles. It keeps one figure per move, so asking frame after frame in time
  // order plays the move as the app does (eased elbow swings included); T is the clock (default t).
  _joints(move, t, T) {
    const m = typeof move === 'string' ? GH.moves.MOVES[move] : move;
    if (!m) return null;
    let fig = jointFigs.get(m);
    if (!fig) {
      if (jointFigs.size > 40) { const [k, v] = jointFigs.entries().next().value; v.dispose(); jointFigs.delete(k); }
      fig = new Figure(m, optsOf({}));
      jointFigs.set(m, fig);
    }
    fig.setTime(t, T === undefined ? t : T);
    const J = fig.J;
    const a = (v) => [v.x, v.y, v.z];
    const out = { head: a(J.headC), headUp: a(J.headUp), neck: a(J.neck), hip: a(J.hip), swing: J.swing };
    for (const s of SIDES) {
      Object.assign(out, { ['sh' + s]: a(J.sh[s]), ['el' + s]: a(J.el[s]), ['wr' + s]: a(J.wr[s]), ['hd' + s]: a(fig.eq.gripPoint(J, s)), ['hp' + s]: a(J.hp[s]), ['kn' + s]: a(J.kn[s]), ['an' + s]: a(J.an[s]) });
    }
    // Where a kettlebell's bell is (its centre).
    const kb = fig.eq.items.find((it) => it.parts.kb);
    if (kb) out.kb = a(V3(0, -12.8, 0).applyQuaternion(kb.parts.kb.quaternion).add(kb.parts.kb.position));
    // And a dumbbell squeezed between the feet.
    const feet = fig.eq.items.find((it) => it.e.type === 'db' && it.e.hold === 'feet');
    if (feet) out.dbFeet = a(feet.parts.N.position);
    // Orientations (quaternions [x, y, z, w]) of the body's parts and of the held kit.
    out.q = {};
    for (const k of ['chest', 'pelvis', 'head', 'neck']) out.q[k] = fig.P[k].quaternion.toArray();
    for (const s of SIDES) for (const k of ['ua', 'fa', 'hd', 'th', 'sh', 'ft']) out.q[k + s] = fig.P[k + s].quaternion.toArray();
    out.eq = [];
    for (const it of fig.eq.items) {
      for (const [k, v] of Object.entries(it.parts)) if (v && v.isObject3D && v.quaternion) out.eq.push({ type: it.e.type, part: k, hands: it.e.hands || null, hold: it.e.hold || null, p: a(v.position), q: v.quaternion.toArray() });
    }
    // How far each hand's grip is from what it holds (cm): on a bar's or dumbbell's handle, a
    // kettlebell's handle or horns, a ball's surface.
    out.held = {};
    for (const it of fig.eq.items) {
      const e = it.e;
      if (e.hold === 'feet' || ((e.hold === 'hip' || e.hold === 'chest') && !e.hands)) continue;
      for (const s of hands(e)) {
        const gp = fig.eq.gripPoint(J, s);
        let d = null;
        const onSeg = (g, a0, a1) => { const ab = a1.clone().sub(a0); const k = clamp(gp.clone().sub(a0).dot(ab) / ab.lengthSq(), 0, 1); return gp.distanceTo(a0.clone().addScaledVector(ab, k)); };
        const local = (g, x, y, z) => V3(x, y, z).applyQuaternion(g.quaternion).add(g.position);
        if (e.type === 'db') { const g = it.parts[s]; d = onSeg(g, local(g, -6.7, 0, 0), local(g, 6.7, 0, 0)); }
        else if (e.type === 'bb' || e.type === 'ez' || e.type === 'latbar') { const g = it.parts.bar, L = e.r === 0 ? 27 : 60; d = onSeg(g, local(g, -L, 0, 0), local(g, L, 0, 0)); }
        else if (e.type === 'kb') {
          const g = it.parts.kb;
          d = e.hold === 'horns' ? Math.min(onSeg(g, local(g, -6.3, -9.5, 0), local(g, -6.4, -3, 0)), onSeg(g, local(g, 6.3, -9.5, 0), local(g, 6.4, -3, 0))) : onSeg(g, local(g, -5.5, 0, 0), local(g, 5.5, 0, 0));
        } else if (e.type === 'ball') d = fig.f && fig.f.free > 0.25 ? null : Math.max(0, Math.abs(gp.distanceTo(it.parts.ball.position) - it.r) - 2.5);
        if (d != null) out.held[e.type + (e.hands === 'both' ? '' : '') + '.' + s] = d;
      }
    }
    // The shoe: its lowest point (y) and where under the foot that is (x, z); and every point of
    // its sole (heel, ball, toe tip...), for what stays put on the floor.
    out.foot = {};
    out.sole = {};
    for (const s of SIDES) {
      const ft = fig.P['ft' + s];
      let low = null;
      out.sole[s] = [];
      for (const p0 of FOOT_PROBES) {
        const w = p0.clone().applyQuaternion(ft.quaternion).add(ft.position);
        out.sole[s].push([w.x, w.y, w.z]);
        if (!low || w.y < low[1]) low = [w.x, w.y, w.z];
      }
      out.foot[s] = low;
    }
    // How deep (cm) hands, forearms, elbows, knees and ankles go into the trunk or the head.
    out.inBody = trunkPenetration(J, fig);
    return out;
  },
  // The solid props (seats, boxes, bench pads, table tops) of a move, as boxes in the figure's space.
  _solids(move) {
    const m = typeof move === 'string' ? GH.moves.MOVES[move] : move;
    const fig = jointFigs.get(m) || new Figure(m, optsOf({}));
    jointFigs.set(m, fig);
    return fig.props.solids();
  },
};
const jointFigs = new Map();

// Tests: the deepest any limb point goes into the trunk or the head: { d (cm), what }.
function trunkPenetration(J, fig) {
  let worst = { d: 0, what: '' };
  const lo = TRUNK[0][0], hi = TRUNK[TRUNK.length - 1][0];
  const probe = (p, r, what) => {
    const d = p.clone().sub(J.hip);
    const u = d.dot(J.up);
    if (u >= lo && u <= hi) {
      const sct = trunkAt(u);
      const v = d.dot(J.fwdC) - sct.oz, w = d.dot(J.latC);
      const a = sct.w + r, b = (v >= 0 ? sct.f : sct.b) + r;
      const q = (w / a) ** 2 + (v / b) ** 2;
      if (q < 1) { const dep = (1 - Math.sqrt(q)) * Math.min(a, b); if (dep > worst.d) worst = { d: dep, what: what + ' in the trunk' }; }
    }
    if (J.headC) {
      const dh = p.clone().sub(J.headC);
      const hv = dh.dot(J.headUp);
      const fv = dh.dot(J.headFwd || J.fwd);
      const wv = dh.clone().addScaledVector(J.headUp, -hv).addScaledVector(J.headFwd || J.fwd, -fv).length();
      const q = (hv / ((hv > 0 ? 11 : 10.6) + r)) ** 2 + (fv / ((fv > 0 ? 10 : 10.3) + r)) ** 2 + (wv / (8.2 + r)) ** 2;
      if (q < 1) { const dep = (1 - Math.sqrt(q)) * (8.2 + r); if (dep > worst.d) worst = { d: dep, what: what + ' in the head' }; }
    }
  };
  for (const s of SIDES) {
    const el = J.el[s], wr = J.wr[s];
    probe(el, 4, 'el' + s);
    probe(el.clone().lerp(wr, 0.5), 3.5, 'forearm' + s);
    probe(wr, 3, 'wr' + s);
    probe(wr.clone().addScaledVector(J.hand[s].Y, 6), 2.5, 'hand' + s);
    probe(J.kn[s], 5, 'kn' + s);
    probe(J.kn[s].clone().lerp(J.an[s], 0.5), 4.5, 'shin' + s);
    probe(J.an[s], 4, 'an' + s);
  }
  return worst;
}
