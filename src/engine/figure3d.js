/* 3D exercise figure: a realistic, procedurally built person that performs any move of the 2D pose
 * engine (GH.pose). Nothing here authors poses. Every frame the 2D joints from GH.pose.sampleAt /
 * solve are lifted into 3D (side view: lateral offsets; front view: depth recovered from the
 * foreshortening; top view: the figure laid on the floor), then each limb is re-solved in 3D with
 * its true segment lengths, so meshes never stretch and planted hands and feet stay put.
 *
 * Loaded on demand with GH.lazy('figure3d'); it sets GH.figure3d = { supported, mount, still,
 * preload, warm }. One shared WebGLRenderer draws every mounted figure and copies each frame into
 * that figure's own 2D canvas, so any number of figures can be on screen with a single GL context.
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
  const k = smooth(0.2, 0.42, bent.length() / (b.length() || 1)); // by the sine of the bend
  const nat = natural.lengthSq() > 1e-6 ? natural.clone().normalize() : perp(bent, an);
  if (k <= 0) return nat;
  const out = bent.normalize().multiplyScalar(k).addScaledVector(nat, 1 - k);
  return out.lengthSq() > 0.04 ? out : bent;
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
// by `swing` radians about the root→target axis toward the direction `out`.
function ik2(R, T, a, b, P, out, swing) {
  const d = T.clone().sub(R);
  let dist = d.length();
  const dn = dist > 1e-6 ? d.divideScalar(dist) : V3(0, -1, 0);
  const reach = dist <= a + b + 0.05;
  dist = clamp(dist, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const x = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  let pv = perp(P.clone().sub(R), dn);
  if (pv.lengthSq() < 1e-6) pv = out ? perp(out, dn) : anyPerp(dn);
  if (pv.lengthSq() < 1e-6) pv = anyPerp(dn);
  pv.normalize();
  if (swing && out) {
    const b2 = V3().crossVectors(dn, pv);
    const s = b2.dot(out) >= 0 ? 1 : -1;
    pv.multiplyScalar(Math.cos(swing)).addScaledVector(b2, s * Math.sin(swing)).normalize();
  }
  return { mid: R.clone().addScaledVector(dn, x).addScaledVector(pv, h), end: R.clone().addScaledVector(dn, dist), reach, dn, pv };
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
// Per-form tweaks for the 3D lift where the 2D data can't say (e.g. an elbow braced inside a thigh).
const HINTS = {
  concCurl: { stance: 24, kneeOut: 0.3, handZ: { N: 2.5 }, flare: { N: -6 } },
  deepSquat: { handZ: { N: 2.5, F: 2.5 }, flare: { N: -5, F: -5 } },
  goblet: { handZ: { N: 6, F: 6 } },
  floorFly: { dbAxis: 'long' },
  skull: { handZ: { N: 9, F: 9 } },
  ohExt: { handZ: { N: 5, F: 5 } },
};

function gripOf(move, s) {
  for (const e of move.equip || []) {
    if (!HELD.has(e.type)) continue;
    if (e.type === 'kb' && (e.hold === 'hip' || e.hold === 'chest') && !e.hands) continue;
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
  A.raise = (A.props.find((p) => p.type === 'treadmill') ? 16 : 0);
  if (view === 'side') sideStance(A);
  else if (view === 'front') frontKind(A);
  else topKind(A);
  if (A.hint.stance) A.stance.z = A.hint.stance;
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
  A.sign = {
    torso: A.kind === 'seated' ? -1 : 1,
    th: A.kind === 'prone' ? -1 : 1,
    sh: -1,
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
// to this limb's side). Returns the pushed point.
function clearTrunk(J, p, r, lat) {
  const d = p.clone().sub(J.hip);
  const u = d.dot(J.up), v = d.dot(J.fwd);
  let w = d.dot(lat);
  const s = trunkAt(u);
  if (s) {
    const dv = v - s.oz;
    const dd = (dv >= 0 ? s.f : s.b) + r;
    if (Math.abs(dv) < dd) {
      const wmin = (s.w + r) * Math.sqrt(1 - (dv / dd) ** 2);
      if (w < wmin) { p = p.clone().addScaledVector(lat, wmin - w); w = wmin; }
    }
  }
  if (J.headC) {
    const dh = p.clone().sub(J.headC);
    const hv = dh.dot(J.headUp);
    if (Math.abs(hv) < 11) {
      const rr = 8.2 + r;
      const inPlane = perp(dh, lat).length();
      if (inPlane < rr) {
        const wmin = Math.sqrt(rr * rr - inPlane * inPlane);
        const wh = dh.dot(lat);
        if (wh < wmin) p = p.clone().addScaledVector(lat, wmin - wh);
      }
    }
  }
  return p;
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
function legs(A, J, pts, f, get3, opts) {
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
    const r = ik2(hp, an, PZ().L.th, PZ().L.sh, kn2, out, st.kneeOut);
    J.kn[s] = r.mid; J.an[s] = r.end;
    opts.foot(s, sg, r);
  }
}

// Side view: X = x, Y = -y, Z from rules (N limbs at +Z).
function liftSide(A, pts, f, T) {
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
    if (k.startsWith('an')) v.z = sg * A.stance.z;
    else if (k.startsWith('kn')) v.z = sg * (HIP_W + A.stance.z) * 0.5;
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
  });
  arms(A, J, pts, f, P3);
  return J;
}

// Front view: X = x, Y = -y, depth recovered from the foreshortening.
function liftFront(A, pts, f, T) {
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
    foot(s, sg, r) {
      const shin = r.end.clone().sub(r.mid).normalize();
      let fa = yaw(perp(J.fwdP, Y_UP).normalize(), sg * A.stance.toeOut);
      if (A.kind === 'prone') fa = V3(0, -1, 0);
      const flat = f.$ && f.$['flat' + s] !== false;
      const down = flat && r.end.y < 16 && A.kind !== 'prone' ? V3(0, -1, 0) : shin;
      const faP = perp(fa, down.clone().normalize());
      if (faP.lengthSq() < 1e-4) faP.copy(anyPerp(down));
      J.foot[s] = { a: faP.normalize(), up: down.clone().normalize().negate() };
    },
  });
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
  arms(A, J, pts, f, P2, P3);
  return J;
}

// Top view: the frontal-plane figure lies on the floor, head toward +X, N side toward +Z.
function liftTop(A, pts, f, T) {
  const L = PZ().L;
  const J = newRig();
  const P = (p, h) => V3(-p[1], h, p[0]);
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
  // Each distal joint rises from its resting height by the foreshortening of its segment.
  const rise = (a2, b2, len) => Math.sqrt(Math.max(0, len * len - (b2[0] - a2[0]) ** 2 - (b2[1] - a2[1]) ** 2));
  const place = (from3, a2, b2, len, base) => {
    const rz = rise(a2, b2, len);
    const hgt = lerp(base, from3.y + rz, rz / len);
    const dh = hgt - from3.y;
    const planar = V3(-(b2[1] - a2[1]), 0, b2[0] - a2[0]);
    const pl = planar.length() || 1;
    const want = Math.sqrt(Math.max(0, len * len - dh * dh));
    return from3.clone().addScaledVector(planar, want / pl).add(V3(0, dh, 0));
  };
  const armLift = A.prone && (A.move.muscles || []).some((m) => m === 'rearDelts' || m === 'upperBack') ? 7 : 0;
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    const e = place(J.sh[s], pts['sh' + s], pts['el' + s], L.ua, 5 + armLift * 0.6);
    const w = place(e, pts['el' + s], pts['wr' + s], L.fa, 3.4 + armLift);
    const h = place(w, pts['wr' + s], pts['hd' + s], L.hand, 2.4 + armLift);
    J.el[s] = e; J.wr[s] = w;
    const k = place(J.hp[s], pts['hp' + s], pts['kn' + s], L.th, 6.5);
    const an = place(k, pts['kn' + s], pts['an' + s], L.sh, 5.5);
    J.kn[s] = k; J.an[s] = an;
    const leg = an.clone().sub(k).normalize();
    if (A.prone) J.foot[s] = { a: leg.clone(), up: V3(0, -1, 0) };
    else J.foot[s] = { a: yaw(V3(0, 1, 0).addScaledVector(leg, 0.35).normalize(), 0).addScaledVector(lat, sg * 0.22).normalize(), up: leg.clone().negate() };
    const dirF = w.clone().sub(e).normalize();
    const handDir = h.clone().sub(w).normalize();
    handFrame(A, J, s, sg, dirF, handDir, { kind: A.prone ? 'floor' : 'free', w: A.prone && !armLift ? 1 : 0 }, lat.clone().multiplyScalar(sg));
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

// Arms for the side and front lifts.
function arms(A, J, pts, f, P2, P3) {
  const L = PZ().L;
  for (const s of SIDES) {
    const sg = s === 'N' ? 1 : -1;
    const lat = J.lat.clone().multiplyScalar(sg);
    const g = A.grip[s];
    const c = g ? { kind: 'equip', w: 0 } : handContact(A, pts, s);
    const hint = A.hint;
    let sh = J.sh[s].clone();
    let W, pole, flare = 2.5;
    const wr2 = P3 ? P3(null, 'wr', s) : P2(pts['wr' + s]);
    const el2 = P3 ? P3(null, 'el', s) : P2(pts['el' + s]);
    const hd2 = P3 ? P3(null, 'hd', s) : P2(pts['hd' + s]);
    if (J.shift && !(c.kind !== 'free' && c.w > 0.5)) { wr2.add(J.shift); el2.add(J.shift); hd2.add(J.shift); }
    if (A.view === 'side') {
      // Hand width: the shoulder's, unless both hands share one object or the hand rests somewhere.
      let hz = SH_W + 2;
      if (g && g.both) {
        const r = g.e.r || 8;
        hz = { bb: 24, ez: 15.5, latbar: 36, kb: 5.2, ball: r * 1.25 + 2.2, towel: g.e.between ? 16 : SH_W + 1, band: g.e.between ? 18 : SH_W + 1.5, rope: 9, handle: 4.2 }[g.type] || hz;
      } else if (c.kind === 'bar') hz = c.bar.dip ? 25 : /chin/.test(A.move.id || '') ? 18.5 : 23;
      else if (c.kind === 'floor' && c.w > 0.3) hz = A.lying ? (A.prone ? 22 : 24) : 21;
      else if (c.kind === 'top' && c.w > 0.3) hz = 21;
      else if (c.kind === 'wall') hz = 21.5;
      if (hint.handZ && hint.handZ[s] != null) hz = hint.handZ[s];
      // Hands near the head (at the temples) sit at its sides.
      const hC = hd2.clone().lerp(wr2, 0.4);
      const atHead = !g && J.headC && hC.distanceTo(V3(J.headC.x, J.headC.y, 0)) < 14 && c.kind === 'free';
      if (atHead) hz = 10.8;
      W = V3(wr2.x, wr2.y, sg * hz);
      pole = V3(el2.x, el2.y, sg * (SH_W + hz) * 0.5);
      if (c.kind === 'floor' || c.kind === 'top') flare = lerp(2.5, 9, c.w);
      if (c.kind === 'bar') flare = 7;
      if (atHead) flare = 26; // hands at the temples, elbows wide
    } else {
      W = wr2.clone();
      pole = el2.clone();
      // Hands the 2D solves onto a target (a ball, a bell) reach out in front of the body: the
      // 2D arms lie flat in the picture plane, which would put the ball inside the chest.
      const ikd = (`ik.hd${s}.x` in f) && c.kind !== 'floor' && c.kind !== 'wall';
      const held = J.held;
      if (held && g && g.both) {
        W = held.c.clone().addScaledVector(J.latC, sg * (held.r + 1.8)).add(V3(0, -1.5, -2));
        // Elbows hang below the arms and a little out.
        pole = sh.clone().lerp(W, 0.5).add(V3(0, -22, 0)).addScaledVector(J.latC, sg * 12);
      } else if (ikd) {
        const d = Math.hypot(W.x - sh.x, W.y - sh.y);
        const reach = 0.84 * (L.ua + L.fa);
        W.z = sh.z + Math.sqrt(Math.max(0, reach * reach - d * d)) * 0.85;
        pole.z = (W.z + sh.z) / 2 - 4;
      }
    }
    if (hint.flare && hint.flare[s] != null) flare = hint.flare[s];
    // Planted hands put the palm on the surface; bars put the fist around the bar.
    const planted = (c.kind === 'floor' || c.kind === 'top') ? c.w : 0;
    if (planted > 0 && A.view !== 'top') {
      // The wrist sits just above the palm, which lies flat on the surface.
      const surfY = c.kind === 'floor' ? 0 : c.y;
      W.y = lerp(W.y, surfY + 2.05, planted);
    }
    if (c.kind === 'wall' && c.w > 0) {
      const wx = c.wall.x;
      if (A.view === 'side') W.x = lerp(W.x, wx - c.wall.side * 5.5, c.w);
      else W.x = lerp(W.x, wx + 5.5, c.w);
    }
    if (!g && c.kind !== 'bar') {
      W = clearThighs(J, clearTrunk(J, W, 3, lat), 3, lat);
    }
    // Scapular give: reach a little further when a planted hand is just out of range.
    const reach = L.ua + L.fa;
    let d = W.distanceTo(sh);
    if (d > reach - 0.3 && (planted > 0.3 || c.kind === 'bar' || c.kind === 'wall')) {
      const give = Math.min(4, d - reach + 0.3);
      sh.addScaledVector(W.clone().sub(sh).normalize(), give);
    }
    pole.addScaledVector(lat, flare);
    let r = ik2(sh, W, L.ua, L.fa, pole, lat, 0);
    // Elbow outside the trunk: swing it outward about the shoulder–wrist axis until clear.
    for (let k = 0, sw = 0; k < 8; k++) {
      const e2 = clearTrunk(J, r.mid, 4.3, lat);
      if (e2.distanceToSquared(r.mid) < 0.04) break;
      sw += 0.14;
      r = ik2(sh, W, L.ua, L.fa, pole, lat, sw);
    }
    J.sh[s] = sh;
    J.el[s] = r.mid; J.wr[s] = r.end;
    const dirF = r.end.clone().sub(r.mid).normalize();
    // The 2D wrist angle carried onto the 3D forearm.
    const f2 = [pts['wr' + s][0] - pts['el' + s][0], pts['wr' + s][1] - pts['el' + s][1]];
    const h2 = [pts['hd' + s][0] - pts['wr' + s][0], pts['hd' + s][1] - pts['wr' + s][1]];
    const wa = Math.atan2(f2[0] * h2[1] - f2[1] * h2[0], f2[0] * h2[0] + f2[1] * h2[1]);
    let handDir = dirF.clone();
    if (Math.abs(wa) > 0.02) {
      const axis = V3().crossVectors(r.mid.clone().sub(sh), dirF);
      if (axis.lengthSq() > 1e-6) handDir.applyAxisAngle(axis.normalize(), -wa);
    }
    handFrame(A, J, s, sg, dirF, handDir, c, lat);
  }
}

// Orientation of a hand: +Y along the fingers, +Z out of the palm. Handles grips, planted palms,
// bars and relaxed hands.
function handFrame(A, J, s, sg, dirF, handDir, c, lat) {
  const g = A.grip[s];
  const right = A.rightSide[s];
  const H = { curl: 1 };
  let Y = handDir.clone(), Z;
  const thumbTo = (T) => V3().crossVectors(right ? T : T.clone().negate(), Y); // Z from the thumb direction
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
    } else if (t === 'rope' || (t === 'kb' && !g.both && e.hold !== 'arm')) axis = dirF.clone().applyAxisAngle(J.lat, Math.PI / 2);
    else axis = J.lat.clone();
    axis = perp(axis, Y);
    if (axis.lengthSq() < 1e-4) axis = perp(J.fwd, Y);
    axis.normalize();
    // Thumb direction: supinated for curls, neutral for side-held bells, pronated otherwise.
    const neutral = (t === 'db' && e.orient === 'side') || t === 'rope' || (A.view === 'top') || A.hint.dbAxis === 'long' || (A.view === 'front' && t === 'db');
    const supin = (A.move.muscles || [])[0] === 'biceps' || /chin/.test(A.move.id || '');
    let T;
    if (neutral) {
      T = axis.dot(J.fwd) + axis.dot(J.up) * 0.3 >= 0 ? axis : axis.clone().negate();
      if (A.view === 'front' && t === 'db' && e.orient !== 'side') T = axis.dot(J.fwd) >= 0 ? axis : axis.clone().negate();
    } else {
      const outward = axis.dot(lat) >= 0 ? axis : axis.clone().negate();
      T = supin ? outward : outward.clone().negate();
    }
    Z = thumbTo(T);
  } else if (g && g.type === 'ball') {
    const toMid = lat.clone().negate();
    Z = perp(toMid, Y);
    H.curl = 0.65;
  } else if (c.kind === 'bar') {
    // Hook grip around the bar (runs along Z, or along X for dip bars).
    const axis = c.bar.dip ? J.fwd.clone() : V3(0, 0, 1);
    const T0 = c.bar.dip ? axis : (/chin/.test(A.move.id || '') ? lat.clone() : lat.clone().negate());
    Z = thumbTo(perp(T0, Y).normalize());
  } else {
    // Relaxed: palm toward the body's midline.
    const med = lat.clone().negate();
    Z = perp(med, Y);
    if (Z.lengthSq() < 0.05) Z = perp(V3(0, -1, 0), Y);
    if (Z.lengthSq() < 1e-4) Z = anyPerp(Y);
    Z.normalize();
    const pw = (c.kind === 'floor' || c.kind === 'top') ? c.w : 0;
    if (pw > 0) {
      // Palm flat on the surface, fingers pointing where the body faces.
      const Zp = V3(0, -1, 0);
      let Yp = perp(J.up.clone().add(J.fwd), Y_UP);
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
  J.hand[s] = { q: frameQ(Y, Z), curl: H.curl, Y, Z };
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
    this.apply(f, P.solve(this.move, f), T);
  }
  setPose(name, T) {
    const P = PZ();
    const f = P.poseByName(this.move, name);
    this.apply(f, P.solve(this.move, f), T);
  }

  apply(f, pts, T) {
    const A = this.A;
    const J = A.lift(A, pts, f, T);
    this.J = J;
    this.pts = pts;
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
      const front = hinge(uaY, faY, armFront(uaY, J.up, J.fwd));
      P['ua' + s].position.copy(sh);
      P['ua' + s].quaternion.copy(q(uaY, front));
      P['fa' + s].position.copy(el);
      P['fa' + s].quaternion.copy(q(faY, hand.Z));
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
      const fq = q(ft.a, ft.up);
      P['ft' + s].position.copy(an);
      P['ft' + s].quaternion.copy(this.footOnFloor(an, fq));
    }
    this.eq.update(J, pts, f);
    this.props.update(J, pts, f);
    this.lastT = T;
  }

  // Tip the foot about the ankle so the shoe never dips below the floor or a prop top.
  footOnFloor(an, q) {
    const pts = FOOT_PROBES;
    const low = (qq) => {
      let m = Infinity;
      for (const p of pts) m = Math.min(m, p.clone().applyQuaternion(qq).add(an).y);
      return m;
    };
    if (low(q) >= -0.6) return q;
    // Pitch about the ankle by the smallest angle that brings the shoe back onto the floor.
    const axis = V3(1, 0, 0).applyQuaternion(q);
    let best = q, bestA = Infinity;
    for (const sgn of [1, -1]) {
      let prev = low(q);
      for (let a = 0.03; a < 1.8; a += 0.03) {
        const qq = new Quaternion().setFromAxisAngle(axis, sgn * a).multiply(q);
        const l = low(qq);
        if (l < prev - 0.01) break; // this way only makes it worse
        prev = l;
        if (l >= -0.3) { if (a < bestA) { bestA = a; best = qq; } break; }
      }
    }
    return best;
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
        const n = e.between ? 1 : hs.length;
        it.parts.strands = [];
        for (let i = 0; i < n; i++) {
          const m = mesh(e.type === 'band' ? E.strand : E.strip, e.type === 'band' ? M.band : M.towel, this.g);
          it.parts.strands.push(m);
        }
      } else if (e.type === 'bb' || e.type === 'ez' || e.type === 'latbar') {
        it.parts.bar = this.bar(E, M, e.type);
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

  bar(E, M, type) {
    const g = new Group();
    if (type === 'bb') {
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
      if (e.type === 'db') {
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
            } else if (Array.isArray(e.from)) from = A.view === 'top' ? V3(-e.from[1], 5, e.from[0]) : V3(e.from[0], -e.from[1] + A.raise, 0);
            else from = grips[i].clone().add(V3(0, -40, 0));
            segs.push([from, grips[i]]);
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
        const toCable = this.fig.props.cableFrom ? this.fig.props.cableFrom.clone().sub(gp) : V3(0, 1, 0);
        const Yb = perp(toCable, X).normalize();
        const Zb = V3().crossVectors(X, Yb);
        it.parts.handle.position.copy(gp);
        it.parts.handle.quaternion.setFromRotationMatrix(_m4.makeBasis(X, Yb, Zb));
        this.attach = gp.clone().addScaledVector(Yb, 7.8);
      } else if (e.type === 'rope') {
        const gs = hs.map((s) => this.gripPoint(J, s));
        const mid = gs[0].clone().add(gs[1] || gs[0]).multiplyScalar(0.5);
        const toCable = this.fig.props.cableFrom ? this.fig.props.cableFrom.clone().sub(mid).normalize() : V3(0, 1, 0);
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
    this.cableFrom = null;
    const A = fig.A, M = fig.M;
    const front = A.view === 'front';
    for (const p of A.props) {
      const g = new Group();
      const b = this.build(p, M, A);
      if (!b) continue;
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
      this.rbox(w, 4.5, d, 1.8, M.wood, p.x + w / 2, h - 2.25, 0, g);
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
      this.rbox(w, h - 9, d, 4, M.fabric, p.x + w / 2, 9 + (h - 9) / 2, 0, g);
      for (const [lx, lz] of [[4, 1], [w - 4, 1], [4, -1], [w - 4, -1]]) {
        const leg = this.cyl(1.8, 9, M.wood, g, 10); leg.position.set(p.x + lx, 4.5, lz * (d / 2 - 5));
      }
      if (p.back) {
        const bx = p.back > 0 ? p.x + w - 7 : p.x + 7;
        this.rbox(14, 36, d, 5, M.fabric, bx, h + 18, 0, g);
      }
    } else if (t === 'table') {
      const h = p.h || 72, w = p.w, d = 80;
      this.rbox(w, 3.5, d, 1, M.wood, p.x + w / 2, h - 1.75, 0, g);
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
      const x = p.x, py = p.y || 180;
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
      this.cableFrom = V3(x, py, 0);
      const line = mesh(eqGeos().strand, M.cable, g);
      line.userData.dyn = true;
      this.dyn.push({ kind: 'cable', line, p, from: this.cableFrom });
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
      const k = A.keyPts;
      const cx = p.x != null ? p.x + (p.w || 150) / 2 : (k.anN[0] + k.anF[0]) / 2;
      this.rbox(160, 14, 62, 3, M.frame, cx, 7, 0, g);
      this.rbox(150, 1.6, 50, 0.6, M.belt, cx, 14.4, 0, g);
      const fx = cx + 80;
      for (const lz of [1, -1]) { const u = this.rbox(5, 118, 5, 1.5, M.frame, fx - 4, 72, lz * 30, g); u.rotation.z = 0.12; }
      this.rbox(12, 22, 64, 3, M.pad, fx - 12, 126, 0, g);
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
      this.rbox(w, 7.5, 28, 3, M.pad, x + w / 2, h - 3.75, 0, g);
      this.rbox(6, h - 18, 6, 1, M.frame, x + w / 2, 14 + (h - 18) / 2, 0, g);
    } else {
      const seatL = Math.min(40, w * 0.36);
      const seatX = back > 0 ? x + seatL / 2 : x + w - seatL / 2;
      this.rbox(seatL, 7.5, 28, 3, M.pad, seatX, h - 3.75, 0, g);
      this.rbox(6, h - 18, 6, 1, M.frame, seatX, 14 + (h - 18) / 2, 0, g);
      const hingeX = back > 0 ? x + seatL + 1.5 : x + w - seatL - 1.5;
      const bl = Math.max(50, w - seatL - 4);
      const pad = this.rbox(bl, 7.5, 28, 3, M.pad, 0, 0, 0, g);
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
    this.dyn.push({ kind: 'machine', mk: kind, parts, J0 });
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
        let target;
        if (eq.attach) target = eq.attach;
        else if (to === 'both') target = eq.gripPoint(J, 'N').lerp(eq.gripPoint(J, 'F'), 0.5);
        else target = eq.gripPoint(J, to.slice(-1));
        const dd = target.clone().sub(d.from);
        d.line.position.copy(d.from);
        d.line.quaternion.copy(frameQ(dd, V3(0, 0, 1)));
        d.line.scale.set(0.35, dd.length(), 0.35);
      } else if (d.kind === 'machine') {
        this.machineUpdate(d, J);
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

  machineUpdate(d, J) {
    const P = d.parts, k = d.mk;
    const lever = (m, a, b) => {
      const dd = b.clone().sub(a);
      m.position.copy(a.clone().add(b).multiplyScalar(0.5));
      m.quaternion.copy(frameQ(dd, V3(0, 0, 1)));
      m.scale.set(1, Math.max(1, dd.length()), 1);
    };
    if (k === 'legPress') {
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
// close to the floor, then blurred and laid on the floor.
class ContactShadow {
  constructor(w, d, dark) {
    const res = 256;
    const opt = { type: undefined, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true };
    this.rt = new WebGLRenderTarget(res, res, opt);
    this.rt2 = new WebGLRenderTarget(res, res, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.rt.texture.generateMipmaps = false; this.rt2.texture.generateMipmaps = false;
    this.res = res;
    this.g = new Group();
    this.plane = new Mesh(new PlaneGeometry(w, d).rotateX(Math.PI / 2), new MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity: dark ? 0.85 : 0.62, depthWrite: false, color: 0x000000 }));
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.plane.position.y = 0.06;
    this.g.add(this.plane);
    this.cam = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0, 48);
    this.cam.rotation.x = Math.PI / 2;
    this.g.add(this.cam);
    this.depth = new MeshDepthMaterial();
    this.depth.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * 0.92 );');
    };
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
  dispose() { this.rt.dispose(); this.rt2.dispose(); this.plane.geometry.dispose(); this.plane.material.dispose(); this.depth.dispose(); }
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
      fig.apply(smp.f, smp.pts, null);
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

  render(r, w, h) {
    const az = this.camState.az, el = this.camState.el;
    const key = `${az.toFixed(4)}:${el.toFixed(4)}:${w}x${h}`;
    if (key !== this.fkey) { this.frame(az, el, w / h); this.fkey = key; }
    this.shadow.render(r, this.scene, this.hideForShadow);
    r.setRenderTarget(null);
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
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
    shrinkTimer = setTimeout(() => {
      shrinkTimer = 0;
      if (live.size || !R) return;
      R.w = R.h = 0;
      try { R.r.setSize(1, 1, false); } catch (e) { /* ignore */ }
    }, 2000);
  }
  if (!releaseTimer) releaseTimer = setTimeout(() => { releaseTimer = 0; if (!live.size) release(); }, document.hidden ? Math.min(releaseMs, 30000) : releaseMs);
}

function supported() {
  if (SUPPORTED != null) return SUPPORTED;
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
  if (!supported()) return null;
  const canvas = document.createElement('canvas');
  let r;
  try {
    r = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
  } catch (e) { SUPPORTED = false; return null; }
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
    // app is back in front); a loss while figures are on screen is the GPU giving up. Twice of those
    // and this session stays with the flat figure.
    const hidden = document.hidden || performanceNow() - shownAt < 2000;
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
  if (ENV) { try { ENV.dispose(); } catch (e) { /* ignore */ } ENV = null; }
  const drop = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.isBufferGeometry || o.isTexture || o.isMaterial) { try { o.dispose(); } catch (e) { /* ignore */ } return; }
    for (const v of Object.values(o)) drop(v);
  };
  drop(BODY); drop(EQ);
  if (SHARED) drop({ disc: SHARED.disc, blurH: SHARED.blurH, blurV: SHARED.blurV, quad: SHARED.quad.geometry });
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
// Where time t sits in the rep: ph is 'con' (lifting), 'ecc' (lowering) or 'hold'.
function phaseAt(move, t) {
  const tl = move.$tl || PZ().timeline(move);
  let r = ((t % tl.total) + tl.total) % tl.total;
  for (let i = 0; i < tl.steps.length; i++) {
    const s = tl.steps[i];
    const raw = (move.rep[i] && move.rep[i].ph) || 'move';
    if (r < s.ms) return { ph: raw === 'ecc' ? 'ecc' : raw === 'iso' ? 'hold' : 'con', step: raw, i, t: s.ms ? r / s.ms : 1 };
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
  let playing = false, raf = 0, clock = 0, lastNow = 0, lastDraw = 0, onceUntil = -1, wake = 0;
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
  if (!supported() || !renderer()) { fallback({ reason: 'unsupported', hidden: false }); return ctl; }
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
  function tick(now) {
    raf = 0;
    if (failed) return;
    if (!onScreen()) { lastNow = 0; return; }
    const dt = lastNow ? Math.min(100, now - lastNow) : 0;
    lastNow = now;
    let busy = false; // something on screen changes this frame
    if (playing || onceUntil >= 0) {
      clock += dt;
      busy = true;
      if (onceUntil >= 0 && clock >= onceUntil) { onceUntil = -1; playing = false; dirty = true; }
    }
    // Camera: idle orbit while playing, drag, easing back, animated view changes.
    if (playing && !o.reducedMotion) { cam.orbit = Math.sin((now / 9000) * Math.PI * 2) * 7 * D2R; busy = true; }
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
    // Show time t (ms into the rep) now; used by tests and for scrubbing.
    seek(t) {
      if (failed) return;
      clock = t;
      poseAt(t, null);
      glowAt(t, 0, null);
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
const stillKey = (move, w, h, o, crop) => [move.id, JSON.stringify(move.equip || []), w, h, o.dark, o.skin, o.shirt, o.mirrored, crop || 0].join('|');
function stillSize(opts) {
  return [Math.max(16, Math.round((opts && opts.width) || 240)), Math.max(16, Math.round((opts && opts.height) || 200))];
}
// A still that's already been drawn, or null; never draws (safe inside a page render).
const cropOf = (opts) => (opts && opts.crop > 0 ? Math.round(opts.crop) : 0);
const drawSize = (opts) => { const crop = cropOf(opts); return crop ? [crop * 2, crop * 2] : stillSize(opts); };
function cachedStill(move, opts) {
  const o = optsOf(Object.assign({ static: true }, opts));
  const [w, h] = drawSize(opts);
  return stills.get(stillKey(move, w, h, o, cropOf(opts))) || null;
}
// A square crop of a still around the figure (anything drawn more than faintly: the body, what it
// holds, its shadow), side px across, so a small tile shows the body rather than the room the whole
// move needs. Drawn from a still twice the size, so it's scaled down and stays sharp.
function cropped(c, side) {
  const w = c.width, h = c.height;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
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
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, (x0 + x1 + 1) / 2 - box / 2, (y0 + y1 + 1) / 2 - box / 2, box, box, 0, 0, side, side);
  return out;
}
// A still of the move's key pose as an image URL, cached. opts: width, height, crop (a square this
// many px across, cropped to the figure) and the look (dark, skin, shirt, mirrored).
function still(move, opts) {
  const o = optsOf(Object.assign({ static: true }, opts));
  const crop = cropOf(opts);
  const [w, h] = drawSize(opts);
  const key = stillKey(move, w, h, o, crop);
  if (stills.has(key)) return stills.get(key);
  if (!supported() || !renderer()) return null;
  let view = null;
  try {
    view = new View(move, o);
    view.fig.setPose(view.fig.A.key, null);
    view.fig.setGlow(0.78, null);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    view.camState = { az: view.base.az, el: view.base.el };
    if (!draw(view, ctx, w, h)) return null;
    const pic = crop ? cropped(c, crop) : c;
    if (!pic) return null;
    let url = pic.toDataURL('image/webp', 0.9);
    if (!/^data:image\/webp/.test(url)) url = pic.toDataURL('image/png');
    if (stills.size > 160) stills.delete(stills.keys().next().value);
    stills.set(key, url);
    return url;
  } catch (e) {
    if (G.console) G.console.error('figure3d:', e);
    return null;
  } finally {
    // Disposing the view doesn't lose compiled shaders while the warm-up view holds them.
    if (view) view.dispose();
    maybeRelease();
  }
}

/* ---------------------------------------------------------------- preload */
function idle(fn) {
  if (G.requestIdleCallback) G.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(() => fn(null), 16);
}
// A view that stays alive once its programs are compiled (so later figures reuse them), then one
// small frame to compile the contact-shadow passes too.
function warmUp() {
  if (WARM || !R) return true;
  const m = GH.moves && GH.moves.MOVES && (GH.moves.MOVES.push_std || Object.values(GH.moves.MOVES)[0]);
  if (!m) return true;
  const view = new View(m, optsOf({ static: true }));
  view.fig.setPose(view.fig.A.key, null);
  view.fig.setGlow(0.78, null);
  view.camState = { az: view.base.az, el: view.base.el };
  view.frame(view.base.az, view.base.el, 1);
  WARM = view;
  const r = R.r;
  const compiled = r.compileAsync ? r.compileAsync(view.scene, view.camera) : Promise.resolve(r.compile(view.scene, view.camera));
  return compiled.then(() => new Promise((done) => idle(() => {
    if (R && WARM === view && !isLost(R)) { ensureSize(64, 64); view.render(R.r, 64, 64); }
    done();
  })));
}
// Build the renderer, the body, the equipment, the lighting and the shaders ahead of the first
// figure, a small piece per idle moment so taps never wait on it. Resolves true when 3D is ready.
function preload() {
  if (preloading) return preloading;
  const steps = [
    () => (supported() && renderer() ? true : null), // null: no 3D here
    bodyStep, // false until every body part is built
    () => { eqGeos(); shared(); return true; },
    () => { envMap(); return true; },
    warmUp, // a promise
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
            out.then(() => idle(run), () => resolve(false));
            return;
          }
          if (out) i++;
          if (!deadline || deadline.timeRemaining() < 8) break;
        }
        if (i >= steps.length) { resolve(true); return; }
        idle(run);
      } catch (e) {
        if (G.console) G.console.error('figure3d:', e);
        resolve(false);
      }
    };
    idle(run);
  }).then((ok) => { maybeRelease(); return ok; });
  preloading = p;
  // A failed or released warm-up can be tried again later.
  p.then((ok) => { if (!ok && preloading === p) preloading = null; });
  return p;
}

GH.figure3d = {
  supported, mount, still, cachedStill, preload, phaseAt,
  // Whether the renderer is up and its shaders compiled, so a new figure draws its first frame at once.
  warm() { return !!(R && WARM && !isLost(R)); },
  // Internal, for tests: drop the shared GL context as a phone might, look at what's held, shorten
  // the idle release, and stop figures drawing (a GPU stuck compiling).
  _loseContext() { if (R) R.r.forceContextLoss(); },
  _stall(on) { stalled = !!on; },
  _stats() { return { live: live.size, renderer: !!R, warm: !!WARM, lost: lostCount, programs: R ? R.r.info.programs.length : 0, size: R ? [R.w, R.h] : null }; },
  _releaseAfter(ms) { releaseMs = ms; },
};
