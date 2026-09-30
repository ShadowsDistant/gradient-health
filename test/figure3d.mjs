// The 3D exercise figure in Chromium (WebGL through SwiftShader): for every move (or the filter) it
// mounts the figure, renders frames through the rep (three by default), checks each frame drew a figure (not
// empty, not one flat colour) and that nothing threw, then writes contact sheets to build/fig3d/.
// Also checks the fallback (no WebGL → onFallback), still() thumbnails, and loading the chunk with
// GH.lazy inside the real app page.
//
// Motion (also run by default): every move played at 60 frames a second through the test hook
// GH.figure3d._joints, which poses the 3D figure without drawing it. Elbows and wrists move less than
// 3 cm a frame (or no more than the flat figure moves them there, for fast moves), and elbows stay
// outside the head, in every frame.
//
// Usage: node test/figure3d.mjs [filter,filter…] [--dark] [--mirrored] [--size=240x200] [--cols=6]
//        [--frames=3] [--focus=head|hand|foot|trunk] [--view=side|front|three-quarter] (for checking details)
//        [--motion] (the motion checks only) [--no-motion]
// Build first (npm run build): the figure is served from dist/lazy/ as in the app.
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { root, check, section, done } from './lib.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2);
const dark = args.includes('--dark');
const mirrored = args.includes('--mirrored');
const filters = (args.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);
const opt = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; };
const [CW, CH] = opt('size', '240x200').split('x').map(Number);
const COLS = Number(opt('cols', '6'));
const FOCUS = opt('focus', ''); // debugging close-ups: head, hand, foot, trunk
const VIEW = opt('view', ''); // side | front | three-quarter
const FRAMES = Math.max(1, Number(opt('frames', '3')));
const MOTION_ONLY = args.includes('--motion');
const MOTION = MOTION_ONLY || !args.includes('--no-motion');
const ALL = args.includes('--all'); // list every failing move, not just the first few
const dist = join(root, 'dist');
const out = join(root, 'build/fig3d');

if (!existsSync(join(dist, 'lazy/figure3d.js'))) {
  console.error('dist/lazy/figure3d.js is missing: run `npm run build` first.');
  process.exit(1);
}

// Gym moves in the 2D pose format that exercise equipment and props the library doesn't use yet
// (barbells, cables, benches, racks, machines, cardio kit). Test fixtures only.
const GYM = `(function () {
  const ce = (a, b) => [{ to: b, ms: 1000, hold: 250, ph: 'con' }, { to: a, ms: 1800, hold: 300, ph: 'ecc' }];
  const ec = (a, b) => [{ to: b, ms: 1800, hold: 250, ph: 'ecc' }, { to: a, ms: 1000, hold: 300, ph: 'con' }];
  const cyc = (names, ms) => names.map((n) => ({ to: n, ms, hold: 0, ph: 'move' }));
  const FLOOR = { joint: 'anN', at: [0, -8] };
  const SEAT = { joint: 'hip', at: [0, -55] };
  const sit = (o) => Object.assign({ t: -6, lN: { h: 90, k: 90 } }, o);
  const pedal = (a) => { const r = 17, c = [30, -36]; const p = (d) => [c[0] + r * Math.cos(d * Math.PI / 180), c[1] - r * Math.sin(d * Math.PI / 180)];
    return { t: 32, n: -22, aN: { s: 62, e: 28 }, lN: { flat: false, a: 12 }, ik: { anN: p(a), anF: p(a + 180) } }; };
  const M = {
    gym_bench: { view: 'side', pin: { joint: 'hip', at: [0, -56] }, key: 'b', props: [{ type: 'bench', x: -88, w: 118, h: 45 }], equip: [{ type: 'bb', hands: 'both' }],
      poses: { a: { t: -90, lN: { flat: true }, ik: { anN: [46, -8], hdN: [-46, -112] } }, b: { t: -90, lN: { flat: true }, ik: { anN: [46, -8], hdN: [-35, -76] } } },
      rep: ec('a', 'b'), muscles: ['chest', 'triceps', 'frontDelts'] },
    gym_incline: { view: 'side', pin: { joint: 'hip', at: [0, -54] }, key: 'b', props: [{ type: 'bench', x: -78, w: 112, h: 45, incline: 35, back: -1 }], equip: [{ type: 'db', hands: 'both', orient: 'end' }],
      poses: { a: { t: -55, aN: { s: 125, e: 4 }, lN: { flat: true }, ik: { anN: [50, -8] } }, b: { t: -55, aN: { s: -40, e: 150 }, lN: { flat: true }, ik: { anN: [50, -8] } } },
      rep: ec('a', 'b'), muscles: ['chest', 'frontDelts', 'triceps'] },
    gym_squat: { view: 'side', pin: FLOOR, key: 'b', props: [{ type: 'rack', x: -42, h: 132 }], equip: [{ type: 'bb', hands: 'both' }],
      poses: { a: { t: 3, aN: { s: -25, e: 175 }, lN: { h: 0, k: 2 } }, b: { t: 40, n: -20, aN: { s: -25, e: 175 }, lN: { h: 118, k: 112 } } },
      rep: ec('a', 'b'), muscles: ['quads', 'glutes'] },
    gym_smith: { view: 'side', pin: FLOOR, key: 'b', props: [{ type: 'smith', x: -6, h: 128 }], equip: [{ type: 'bb', hands: 'both' }],
      poses: { a: { t: 3, aN: { s: -25, e: 175 }, lN: { h: 0, k: 2 } }, b: { t: 32, n: -15, aN: { s: -25, e: 175 }, lN: { h: 100, k: 105 } } },
      rep: ec('a', 'b'), muscles: ['quads', 'glutes'] },
    gym_ezcurl: { view: 'side', pin: FLOOR, key: 'b', equip: [{ type: 'ez', hands: 'both' }],
      poses: { a: { t: 0, aN: { s: 6, e: 8 }, lN: { h: 0, k: 2 } }, b: { t: 0, aN: { s: 14, e: 138 }, lN: { h: 0, k: 2 } } },
      rep: ce('a', 'b'), muscles: ['biceps', 'forearms'] },
    gym_deadlift: { view: 'side', pin: FLOOR, key: 'b', equip: [{ type: 'bb', hands: 'both' }],
      poses: { a: { t: 2, aN: { s: 2, e: 4 }, lN: { h: 0, k: 3 } }, b: { t: 55, n: -25, aN: { s: 57, e: 2 }, lN: { h: 100, k: 72 } } },
      rep: ec('a', 'b'), muscles: ['glutes', 'hamstrings', 'lowerBack'] },
    gym_dips: { view: 'side', pin: { joint: 'hdN', at: [0, -118] }, key: 'b', props: [{ type: 'dip', x: 0, h: 115 }],
      poses: { a: { t: 8, aN: { s: 8, e: 0 }, lN: { h: 18, k: 70, flat: false, a: 30 } }, b: { t: 25, aN: { s: -55, e: 95 }, lN: { h: 28, k: 80, flat: false, a: 30 } } },
      rep: ec('a', 'b'), muscles: ['triceps', 'chest'] },
    gym_pulldown: { view: 'side', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'pulldown', x: 0 }, { type: 'cable', x: 6, y: 215, to: 'both' }], equip: [{ type: 'latbar', hands: 'both' }],
      poses: { a: sit({ t: -6, aN: { s: 168, e: 8 } }), b: sit({ t: -15, n: 5, aN: { s: 0, e: 155 } }) },
      rep: ce('a', 'b'), muscles: ['lats', 'biceps', 'upperBack'] },
    gym_cablerow: { view: 'side', pin: { joint: 'hip', at: [0, -40] }, key: 'b', props: [{ type: 'machine', kind: 'rowSeat', x: 0 }, { type: 'cable', x: 125, y: 34, to: 'both' }], equip: [{ type: 'handle', hands: 'both' }],
      poses: { a: { t: 20, aN: { s: 75, e: 2 }, lN: { flat: false, a: 10 }, ik: { anN: [78, -24] } }, b: { t: -6, aN: { s: -18, e: 105 }, lN: { flat: false, a: 10 }, ik: { anN: [78, -24] } } },
      rep: ce('a', 'b'), muscles: ['lats', 'upperBack', 'biceps'] },
    gym_ropedown: { view: 'side', pin: FLOOR, key: 'b', props: [{ type: 'cable', x: 42, y: 205, to: 'both' }], equip: [{ type: 'rope', hands: 'both' }],
      poses: { a: { t: 10, aN: { s: 6, e: 105 }, lN: { h: 6, k: 10 } }, b: { t: 10, aN: { s: 0, e: 6 }, lN: { h: 6, k: 10 } } },
      rep: ce('a', 'b'), muscles: ['triceps'] },
    gym_cablecurl: { view: 'side', pin: FLOOR, key: 'b', uni: true, leadLimbs: ['aN'], props: [{ type: 'cable', x: 55, y: 12, to: 'hdN' }], equip: [{ type: 'handle', hands: 'N' }],
      poses: { a: { t: -4, aN: { s: 10, e: 6 }, aF: { s: 2, e: 8 }, lN: { h: 0, k: 3 } }, b: { t: -4, aN: { s: 18, e: 135 }, aF: { s: 2, e: 8 }, lN: { h: 0, k: 3 } } },
      rep: ce('a', 'b'), muscles: ['biceps'] },
    gym_legpress: { view: 'side', pin: { joint: 'hip', at: [0, -42] }, key: 'b', props: [{ type: 'machine', kind: 'legPress', x: 0 }],
      poses: { a: { t: -52, aN: { s: 30, e: 50 }, lN: { h: 88, k: 6, flat: false, a: 0 } }, b: { t: -52, aN: { s: 30, e: 50 }, lN: { h: 128, k: 100, flat: false, a: 0 } } },
      rep: ec('a', 'b'), muscles: ['quads', 'glutes'] },
    gym_legext: { view: 'side', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'legExt', x: 0 }],
      poses: { a: sit({ aN: { s: 12, e: 35 }, lN: { h: 88, k: 92, flat: false, a: 0 } }), b: sit({ aN: { s: 12, e: 35 }, lN: { h: 88, k: 6, flat: false, a: 0 } }) },
      rep: ce('a', 'b'), muscles: ['quads'] },
    gym_legcurl: { view: 'side', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'legCurl', x: 0 }],
      poses: { a: sit({ aN: { s: 12, e: 35 }, lN: { h: 88, k: 6, flat: false, a: 0 } }), b: sit({ aN: { s: 12, e: 35 }, lN: { h: 88, k: 100, flat: false, a: 0 } }) },
      rep: ce('a', 'b'), muscles: ['hamstrings'] },
    gym_chestpress: { view: 'side', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'chestPress', x: 0 }],
      poses: { a: sit({ t: -10, aN: { s: 88, e: 4 } }), b: sit({ t: -10, aN: { s: 12, e: 112 } }) },
      rep: ec('a', 'b'), muscles: ['chest', 'triceps'] },
    gym_shoulderpress: { view: 'side', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'shoulderPress', x: 0 }],
      poses: { a: sit({ t: -5, aN: { s: 170, e: 4 } }), b: sit({ t: -5, aN: { s: 25, e: 148 } }) },
      rep: ec('a', 'b'), muscles: ['frontDelts', 'sideDelts', 'triceps'] },
    gym_pecdeck: { view: 'front', pin: SEAT, key: 'b', props: [{ type: 'machine', kind: 'pecDeck', x: 0 }],
      poses: { a: { aN: { s: 88, e: 88 }, lN: { h: 6 }, sc: { thN: 0.3, thF: 0.3 } }, b: { aN: { s: 88, e: 88 }, lN: { h: 6 }, sc: { uaN: 0.32, uaF: 0.32, thN: 0.3, thF: 0.3 } } },
      rep: ce('a', 'b'), muscles: ['chest'] },
    gym_rower: { view: 'side', pin: { joint: 'hip' }, key: 'finish', props: [{ type: 'rower' }],
      poses: { catch: { at: [8, -36], t: 25, n: -10, aN: { s: 82, e: 2 }, lN: { flat: false, a: 20 }, ik: { anN: [72, -30] } }, finish: { at: [-30, -36], t: -22, aN: { s: -12, e: 112 }, lN: { flat: false, a: 20 }, ik: { anN: [72, -30] } } },
      rep: [{ to: 'finish', ms: 800, hold: 100, ph: 'con' }, { to: 'catch', ms: 1300, hold: 100, ph: 'ecc' }], muscles: ['lats', 'quads', 'upperBack'] },
    gym_bike: { view: 'side', pin: { joint: 'hip', at: [0, -96] }, key: 'p0', props: [{ type: 'bike' }],
      poses: { p0: pedal(0), p1: pedal(90), p2: pedal(180), p3: pedal(270) },
      rep: cyc(['p1', 'p2', 'p3', 'p0'], 300), muscles: ['quads', 'calves'] },
    gym_treadmill: Object.assign({}, window.GH.moves.FORMS.walk, { props: [{ type: 'treadmill' }] }),
  };
  for (const [id, m] of Object.entries(M)) { m.id = id; m.name = id.slice(4); }
  return M;
})()`;

// The harness page: the app's CSP, the move library and pose engine, platform.js for GH.lazy.
const shell = readFileSync(join(root, 'src/shell.html'), 'utf8');
const csp = shell.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
const harness = `<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8">${csp}
<style>
body{margin:0;background:${dark ? '#0b0c10' : '#f1f2f6'};font:12px system-ui,sans-serif;color:${dark ? '#f4f5f8' : '#0c0d12'}}
#grid{display:grid;grid-template-columns:repeat(${COLS},${CW}px);gap:6px;padding:6px;width:max-content}
.cell{background:${dark ? '#17181e' : '#fff'};border-radius:10px;overflow:hidden}
.cell img{display:block;width:${CW}px;height:${CH}px}
.cell b{display:block;padding:3px 6px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
#stage{position:fixed;left:-10000px;top:0;width:${CW}px;height:${CH}px}
</style></head><body><div id="grid"></div><div id="stage"></div>
<script>${readFileSync(join(root, 'src/data/moves.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>
<script>${readFileSync(join(root, 'src/engine/pose.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>
<script>${readFileSync(join(root, 'src/platform.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>
<script>window.GYM = ${GYM};</script>
</body></html>`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__fig3d.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); res.end(harness); return; }
  const file = normalize(join(dist, url === '/' ? 'gradient-health.html' : url));
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
};

section('Render every move');
const page = await browser.newPage({ viewport: { width: COLS * (CW + 6) + 12, height: 900 }, deviceScaleFactor: 1 });
watch(page, 'harness');
await page.goto(`${base}/__fig3d.html`);
const loaded = await page.evaluate(async () => { try { await window.GH.lazy('figure3d'); return !!window.GH.figure3d; } catch (e) { return String(e); } });
check('GH.lazy("figure3d") loads the chunk under the app CSP', loaded === true, loaded);
check('supported() is true with WebGL', await page.evaluate(() => window.GH.figure3d.supported()));

if (MOTION) {
  section('Motion at 60 fps');
  // Each move twice through (the first pass settles the eased corrections), then every frame of
  // the second compared with the one before: elbows and wrists within 3 cm, or within half again
  // what the flat figure moves that joint around then (plus 1 cm) for moves that are simply fast;
  // elbows at least 12.5 cm from the head's centre (the head's radius plus the elbow's).
  const mo = await page.evaluate(({ filters }) => {
    const GH = window.GH;
    const eq = { db: [8], kb: [10], ball: true, ballSlam: true, band: true, bar: true, table: true, door: true, chair: true, wall: true, towel: true };
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const D = 180 / Math.PI;
    // Quaternions as [x, y, z, w].
    const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
    const qang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * D;
    const rot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    // A segment (its +Y along it, +Z its front) between two frames: how far its axis swings and how
    // far it turns about itself (its front, carried along by the swing, against the new front).
    const swingTwist = (q0, q1) => {
      const y0 = rot(q0, [0, 1, 0]), y1 = rot(q1, [0, 1, 0]), z0 = rot(q0, [0, 0, 1]), z1 = rot(q1, [0, 0, 1]);
      const c = Math.max(-1, Math.min(1, dot(y0, y1))), ax = cross(y0, y1), s = Math.hypot(...ax);
      let zc = z0;
      if (s > 1e-7) {
        const k = ax.map((v) => v / s), th = Math.atan2(s, c), kc = cross(k, z0), kd = dot(k, z0);
        zc = z0.map((v, i) => v * Math.cos(th) + kc[i] * Math.sin(th) + k[i] * kd * (1 - Math.cos(th)));
      }
      const pz = unit(zc.map((v, i) => v - dot(zc, y1) * y1[i]));
      return { swing: Math.acos(c) * D, twist: Math.acos(Math.max(-1, Math.min(1, dot(pz, z1)))) * D };
    };
    // A box {m (column-major 4x4), size}: how deep a ball (p, r) is inside it.
    const inside = (b, p, r) => {
      const m = b.m, sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
      const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]];
      const loc = [dot(d, [m[0] / sx, m[1] / sx, m[2] / sx]) / sx, dot(d, [m[4] / sy, m[5] / sy, m[6] / sy]) / sy, dot(d, [m[8] / sz, m[9] / sz, m[10] / sz]) / sz];
      let dep = Infinity;
      for (let k = 0; k < 3; k++) dep = Math.min(dep, b.size[k] / 2 + r - Math.abs(loc[k]));
      return dep;
    };
    const out = { moves: 0, frames: 0, jumps: [], head: [], worst: { d: 0 }, twist: [], rel: [], swing: [], held: [], slide: [], sink: [], body: [], solid: [], most: {} };
    const most = (k, v, at) => { if (!out.most[k] || v > out.most[k].v) out.most[k] = { v, at }; };
    // Moves whose feet are meant to slide: walking in place, a treadmill belt, heels on a towel.
    const SLIDES = /^(walk|incline_walk|ham_slide)/;
    for (const [id, m0] of Object.entries(GH.moves.MOVES)) {
      if (filters.length && !filters.some((f) => id.includes(f))) continue;
      const m = GH.moves.forPerson(m0, eq);
      const total = GH.pose.timeline(m).total;
      const dt = 1000 / 60, n = Math.ceil(total / dt);
      const J = [], F = [];
      let last = null;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i <= n; i++) {
          const t = i * dt, j = GH.figure3d._joints(m, t, 1000 + pass * (n + 1) * dt + t);
          if (pass) { J.push(j); F.push(GH.pose.frameAt(m, t)); } else last = j;
        }
      }
      // The loop's seam too: the first pass's last frame (the rep wrapping round) to the second's first.
      const prevOf = (i) => (i ? J[i - 1] : last);
      const solids = GH.figure3d._solids(m);
      out.moves++; out.frames += J.length;
      const at = (i) => `${id}@${Math.round(i * dt)}ms`;
      let headWorst = null;
      for (const s of ['N', 'F']) {
        for (let i = 0; i < J.length; i++) {
          const h = d3(J[i]['el' + s], J[i].head);
          if (h < 12.5 && (!headWorst || h < headWorst.h)) headWorst = { h, at: `${id}.el${s}@${Math.round(i * dt)}ms ${h.toFixed(1)} cm from the head's centre` };
        }
        for (const k of ['el', 'wr']) {
          const d2 = F.map((f, i) => (i ? Math.hypot(f[k + s][0] - F[i - 1][k + s][0], f[k + s][1] - F[i - 1][k + s][1]) : 0));
          for (let i = 1; i < J.length; i++) {
            const d = d3(J[i][k + s], J[i - 1][k + s]);
            let win = 0;
            for (let q = Math.max(1, i - 4); q <= Math.min(J.length - 1, i + 4); q++) win = Math.max(win, d2[q]);
            if (d > out.worst.d) out.worst = { d, at: `${id}.${k}${s}@${Math.round(i * dt)}ms` };
            if (d > Math.max(3, 1.5 * win + 1)) { out.jumps.push(`${id}.${k}${s}@${Math.round(i * dt)}ms ${d.toFixed(1)} cm (flat figure ${win.toFixed(1)})`); break; }
          }
        }
      }
      if (headWorst) out.head.push(headWorst.at);
      const flag = (list, msg) => { if (!list.some((x) => x.startsWith(id + '.') || x.startsWith(id + '@'))) list.push(msg); };
      // A turn per frame is a flip (not just a fast move) when it's big in itself, a spike over twice
      // the frames on both sides of it (a fast move starting or stopping isn't one), or when the
      // turns add up to most of a half-turn within a fifth of a second (a flip eased over a few
      // frames is still a flip).
      const flips = (seq, lim) => {
        for (let i = 0; i < seq.length; i++) {
          const v = seq[i];
          let before = 0, after = 0;
          for (let q = i - 3; q < i; q++) if (q >= 0) before = Math.max(before, seq[q]);
          for (let q = i + 1; q <= i + 3; q++) if (q < seq.length) after = Math.max(after, seq[q]);
          let win = 0;
          for (let q = i; q < Math.min(seq.length, i + 12); q++) win += seq[q];
          if (v > 2 * lim || (v > 1.5 * lim && v > 2 * Math.max(before, after)) || win > 120) return i;
        }
        return -1;
      };
      const tw = {}, rl = {}, run = { N: null, F: null };
      for (let i = 0; i < J.length; i++) {
        const a = prevOf(i), b = J[i];
        for (const s of ['N', 'F']) {
          // Limbs turn about themselves smoothly (no upper arm, forearm, thigh or shin spinning
          // round), and never swing a long way in one frame (an elbow or knee flipping over).
          for (const seg of ['ua', 'fa', 'th', 'sh']) {
            const st = swingTwist(a.q[seg + s], b.q[seg + s]);
            most('twist', st.twist, `${id}.${seg}${s}@${Math.round(i * dt)}ms`);
            most('swing', st.swing, `${id}.${seg}${s}@${Math.round(i * dt)}ms`);
            (tw[seg + s] || (tw[seg + s] = [])).push(st.twist);
            if (st.swing > 25) flag(out.swing, `${id}.${seg}${s}@${Math.round(i * dt)}ms swings ${st.swing.toFixed(1)}° in a frame`);
          }
          // Hands turn with the forearm and feet with the shin: no flipping over at the wrist or ankle.
          for (const [part, par] of [['hd', 'fa'], ['ft', 'sh']]) {
            const r = qang(qmul(qinv(a.q[par + s]), a.q[part + s]), qmul(qinv(b.q[par + s]), b.q[part + s]));
            most('rel', r, `${id}.${part}${s}@${Math.round(i * dt)}ms`);
            (rl[part + s] || (rl[part + s] = [])).push(r);
          }
          // A foot flat on the floor stays put (walking in place and slides excepted), and no shoe
          // sinks into the floor.
          const fa = a.foot[s], fb = b.foot[s];
          most('sink', -fb[1], `${id}.ft${s}@${Math.round(i * dt)}ms`);
          if (fb[1] < -1.5) flag(out.sink, `${id}.ft${s}@${Math.round(i * dt)}ms sinks ${(-fb[1]).toFixed(1)} cm into the floor`);
          // A foot flat on the floor (heel and ball down: not rolling onto its toes or pivoting on its
          // ball) stays where it is: while it stays flat it ends up under 4 cm from where it landed
          // (a step lifting off may shuffle a little first), and never moves 1.5 cm in one frame.
          const flat = (sole) => [3, 4, 7, 8].some((k) => sole[k][1] < 1) && [0, 1, 2, 5, 6].some((k) => sole[k][1] < 1);
          if (!SLIDES.test(id) && flat(a.sole[s]) && flat(b.sole[s])) {
            // Measured at the heel and at the ball, whichever stays put (a foot starting to roll
            // onto its toes, or back onto its heel, pivots about one of them).
            const mid = (sole, ks) => ks.reduce((m, k) => [m[0] + sole[k][0] / ks.length, m[1] + sole[k][2] / ks.length], [0, 0]);
            const HEEL = [3, 4, 7, 8], BALL = [0, 1, 2, 5, 6];
            if (!run[s]) run[s] = { h: mid(a.sole[s], HEEL), b: mid(a.sole[s], BALL) };
            const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);
            const d = Math.min(dist(mid(a.sole[s], HEEL), mid(b.sole[s], HEEL)), dist(mid(a.sole[s], BALL), mid(b.sole[s], BALL)));
            const drift = Math.min(dist(mid(b.sole[s], HEEL), run[s].h), dist(mid(b.sole[s], BALL), run[s].b));
            most('slide', drift, `${id}.ft${s}@${Math.round(i * dt)}ms`);
            if (d > 1.5 || drift > 4) flag(out.slide, `${id}.ft${s}@${Math.round(i * dt)}ms slides ${drift.toFixed(1)} cm along the floor (${d.toFixed(1)} in a frame)`);
          } else run[s] = null;
        }
        // Held kit stays in the hands.
        for (const [k, d] of Object.entries(b.held)) {
          most('held', d, `${id}.${k}@${Math.round(i * dt)}ms`);
          if (d > (k.startsWith('ball') ? 3 : 2)) flag(out.held, `${id}.${k}@${Math.round(i * dt)}ms: the hand is ${d.toFixed(1)} cm off what it holds`);
        }
        // Limbs stay out of the trunk and the head: touching is fine (a hand cradling the head, a
        // forearm against the hip), going in isn't.
        const lim = /^hand.*head/.test(b.inBody.what) ? 3.5 : /^(hand|forearm)/.test(b.inBody.what) ? 2.5 : 2.5;
        most('body', b.inBody.d, `${at(i)} ${b.inBody.what}`);
        if (b.inBody.d > lim) flag(out.body, `${at(i)}: ${b.inBody.what} by ${b.inBody.d.toFixed(1)} cm`);
        // And out of the seats, boxes, benches and tables.
        const pts = [['hip', 10], ['neck', 7], ['head', 9]];
        // (Not the hands' grip points: a palm flat on a seat holds its grip point inside it.)
        for (const s of ['N', 'F']) pts.push(['kn' + s, 5], ['an' + s, 3], ['el' + s, 4], ['wr' + s, 3]);
        pts.push([b.hip.map((v, k) => (v + b.neck[k]) / 2), 10, 'spine']);
        for (const box of solids) {
          for (const [k, r, name] of pts) {
            const p = typeof k === 'string' ? b[k] : k;
            const dep = inside(box, p, r);
            most('solid', dep, `${at(i)} ${name || k}`);
            if (dep > 2.5) flag(out.solid, `${at(i)}: ${name || k} ${dep.toFixed(1)} cm into a ${box.size.map((v) => Math.round(v)).join('×')} prop`);
          }
        }
      }
      for (const [k, seq] of Object.entries(tw)) {
        const i = flips(seq, 9);
        if (i >= 0) flag(out.twist, `${id}.${k}@${Math.round(i * dt)}ms turns ${seq[i].toFixed(1)}° about itself in a frame`);
      }
      for (const [k, seq] of Object.entries(rl)) {
        const i = flips(seq, 12);
        if (i >= 0) flag(out.rel, `${id}.${k}@${Math.round(i * dt)}ms turns ${seq[i].toFixed(1)}° at the ${k[0] === 'h' ? 'wrist' : 'ankle'} in a frame`);
      }
    }
    return out;
  }, { filters });
  const w = (k) => (mo.most[k] ? `${mo.most[k].v.toFixed(1)} at ${mo.most[k].at}` : '-');
  check(`${mo.moves} moves, ${mo.frames} frames: elbows and wrists never jump (under 3 cm a frame, or as fast as the flat figure moves; fastest ${mo.worst.d.toFixed(1)} cm at ${mo.worst.at})`, !mo.jumps.length, mo.jumps.slice(0, ALL ? 999 : 8).join('\n      '));
  check('3D elbows stay outside the head in every frame', !mo.head.length, mo.head.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`upper arms, forearms, thighs and shins never spin about themselves (no turn over 18° a frame, over 13.5° and twice the frames around it, or 120° within 0.2 s; most ${w('twist')})`, !mo.twist.length, mo.twist.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`no limb swings over 25° in a frame, the loop's seam included (an elbow or knee flipping; most ${w('swing')})`, !mo.swing.length, mo.swing.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`hands turn with the forearm, feet with the shin (at the wrist or ankle no turn over 24° a frame, over 18° and twice the frames around it, or 120° within 0.2 s; most ${w('rel')})`, !mo.rel.length, mo.rel.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`held dumbbells, bars, kettlebells and balls stay in the hands (within 2 cm, a ball's surface 3; most ${w('held')})`, !mo.held.length, mo.held.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`no shoe sinks into the floor (1.5 cm at most; most ${w('sink')})`, !mo.sink.length, mo.sink.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`feet flat on the floor don't slide (under 4 cm while flat, 1.5 in a frame; most ${w('slide')})`, !mo.slide.length, mo.slide.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`hands, forearms, elbows, knees and feet stay out of the trunk and head (touching, not in: a hand on the head 3.5 cm, anything else 2.5; most ${w('body')})`, !mo.body.length, mo.body.slice(0, ALL ? 999 : 8).join('\n      '));
  check(`the body stays out of seats, boxes, bench pads and table tops (2.5 cm at most; most ${w('solid')})`, !mo.solid.length, mo.solid.slice(0, ALL ? 999 : 8).join('\n      '));
}
if (MOTION_ONLY) {
  await browser.close();
  server.close();
  check('no page errors or console errors', !errors.length, errors.slice(0, 8).join('\n      '));
  done();
  process.exit(0);
}

const results = await page.evaluate(async ({ filters, dark, mirrored, focus, view, frames }) => {
  const GH = window.GH;
  const eq = { db: [8], kb: [10], ball: true, ballSlam: true, band: true, bar: true, table: true, door: true, chair: true, wall: true, towel: true };
  const grid = document.getElementById('grid');
  const stage = document.getElementById('stage');
  const out = [];
  const all = Object.assign({}, GH.moves.MOVES, window.GYM);
  const ids = Object.keys(all).filter((id) => !filters.length || filters.some((f) => id.includes(f)));
  for (const id of ids) {
    const m = GH.moves.forPerson(all[id], eq);
    const r = { id, frames: [], error: null };
    let ctl = null;
    try {
      ctl = GH.figure3d.mount(stage, m, { dark, mirrored: mirrored && !!m.uni, lead: !!m.uni, focus: focus || undefined, onFallback: () => { r.error = 'fallback'; } });
      if (view) ctl.setView(view, true);
      const canvas = ctl.el.querySelector('canvas');
      const total = ctl.duration;
      for (let k = 0; k < frames; k++) {
        const t = Math.round((total * k) / frames);
        ctl.seek(t);
        const c2 = canvas.getContext('2d');
        const d = c2.getImageData(0, 0, canvas.width, canvas.height).data;
        let n = 0, sum = 0, sum2 = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 16) continue;
          n++;
          const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
          sum += l; sum2 += l * l;
        }
        const mean = n ? sum / n : 0;
        const sd = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
        const ph = ctl.phase();
        r.frames.push({ t, cover: n / (d.length / 4), sd, ph: ph.ph });
        const cell = document.createElement('div');
        cell.className = 'cell';
        const img = new Image();
        img.src = canvas.toDataURL('image/png');
        cell.appendChild(img);
        const b = document.createElement('b');
        b.textContent = `${id} · ${t} ms · ${ph.ph}`;
        cell.appendChild(b);
        grid.appendChild(cell);
      }
    } catch (e) {
      r.error = String(e && e.stack || e);
    } finally {
      if (ctl) ctl.destroy();
    }
    out.push(r);
  }
  await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; }))));
  return out;
}, { filters, dark, mirrored, focus: FOCUS, view: VIEW, frames: FRAMES });

// (A --focus close-up is framed on the key pose, so the part may leave it: only errors count then.)
const bad = results.filter((r) => r.error || r.frames.length !== FRAMES || (!FOCUS && r.frames.some((f) => f.cover < 0.02 || f.sd < 6)));
check(`every move (${results.length}) renders ${FRAMES} frames with a visible, shaded figure`, !bad.length, bad.slice(0, 6).map((r) => `${r.id}: ${r.error || JSON.stringify(r.frames)}`).join('\n      '));
const phases = new Set(results.flatMap((r) => r.frames.map((f) => f.ph)));
check('phase() reports con/ecc/hold', [...phases].every((p) => ['con', 'ecc', 'hold'].includes(p)), [...phases]);

// Contact sheets, a few rows per image so they stay readable. Only this run's tag is replaced, so
// the light, dark and mirrored sheets can sit side by side.
const tag = `${dark ? '-dark' : ''}${mirrored ? '-mirrored' : ''}${filters.length ? '-' + filters.join('_').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) : ''}`;
mkdirSync(out, { recursive: true });
const mine = new RegExp(`^sheet${tag.replace(/[-]/g, '\\-')}-\\d+\\.png$`);
for (const f of readdirSync(out)) if (mine.test(f)) rmSync(join(out, f));
const rows = await page.evaluate(() => {
  const tops = new Map();
  for (const c of document.querySelectorAll('#grid .cell')) { const r = c.getBoundingClientRect(); tops.set(r.top + scrollY, r.bottom + scrollY); }
  return [...tops].sort((a, b) => a[0] - b[0]);
});
const rowsPer = Math.max(1, Math.floor(1100 / (CH + 30)));
const sheets = [];
for (let i = 0; i * rowsPer < rows.length; i++) {
  const band = rows.slice(i * rowsPer, (i + 1) * rowsPer);
  const y = Math.max(0, band[0][0] - 6), bottom = band[band.length - 1][1] + 6;
  const file = join(out, `sheet${tag}-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y, width: COLS * (CW + 6) + 6, height: bottom - y }, fullPage: true });
  sheets.push(file);
}
console.log(`  contact sheets: ${sheets.length} in build/fig3d/`);

section('still() thumbnails');
const thumb = await page.evaluate(({ dark }) => {
  const m = window.GH.moves.MOVES.sq_goblet;
  const a = window.GH.figure3d.still(m, { width: 160, height: 140, dark });
  const b = window.GH.figure3d.still(m, { width: 160, height: 140, dark });
  return { ok: typeof a === 'string' && /^data:image\/(png|webp)/.test(a), cached: a === b, len: a ? a.length : 0 };
}, { dark });
check('still() returns an image data URL', thumb.ok, thumb);
check('still() caches by move and options', thumb.cached);

section('Playing, dragging, views, several figures, context loss');
const live = await page.evaluate(async () => {
  const GH = window.GH;
  const mk = (id, o) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:260px;height:220px';
    document.body.appendChild(host);
    return { host, ctl: GH.figure3d.mount(host, GH.moves.MOVES[id], o || {}) };
  };
  const px = (ctl) => { const c = ctl.el.querySelector('canvas'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 16) if (Math.abs(a[i] - b[i]) > 8) n++; return n; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = mk('sq_bw');
  const b = mk('push_std');
  const c = mk('curl_std', { static: true });
  const e = mk('curl_std', { reducedMotion: true });
  const phases = [];
  a.ctl.onPhase = (p) => phases.push(p.ph);
  const p0 = px(a.ctl), e0 = px(e.ctl);
  a.ctl.play(); b.ctl.play(); c.ctl.play(); e.ctl.play();
  // Until a whole rep has gone by (slow software GL can take longer than the rep).
  await wait(1500);
  for (let i = 0; i < 80 && !(phases.includes('con') && phases.includes('ecc')); i++) await wait(100);
  const moved = diff(p0, px(a.ctl));
  // Reduced motion still shows the exercise moving (only the camera holds still).
  const eMoved = diff(e0, px(e.ctl));
  // A still stays on the key pose until asked for one rep.
  const c0 = px(c.ctl);
  await wait(200);
  const cStill = diff(c0, px(c.ctl)) === 0;
  c.ctl.playOnce();
  await wait(700);
  const cOnce = diff(c0, px(c.ctl)) > 0;
  // Drag to turn the camera, then a double-tap to reset.
  const el = a.ctl.el;
  const r = el.getBoundingClientRect();
  const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: r.left + x, clientY: r.top + 100, bubbles: true }));
  a.ctl.pause();
  await wait(100);
  const d0 = px(a.ctl);
  ev('pointerdown', 60); ev('pointermove', 120); ev('pointermove', 200); ev('pointerup', 200);
  await wait(150);
  const dragged = diff(d0, px(a.ctl));
  ev('pointerdown', 100); ev('pointerup', 100); ev('pointerdown', 100); ev('pointerup', 100);
  a.ctl.setView('front');
  await wait(1000);
  const viewed = diff(d0, px(a.ctl));
  a.ctl.setView('three-quarter');
  // Context loss hands every live figure to its fallback.
  let lost = 0;
  const d = mk('row_db', { onFallback: () => { lost++; } });
  d.ctl.play();
  await wait(100);
  GH.figure3d._loseContext();
  await wait(400);
  for (const m of [a, b, c, d, e]) { m.ctl.destroy(); m.host.remove(); }
  return { moved, eMoved, cStill, cOnce, dragged, viewed, phases: [...new Set(phases)], lost, gone: !document.querySelector('.fig3d') };
});
check('a playing figure animates', live.moved > 50, live);
check('reduced motion still animates the exercise', live.eMoved > 50, live.eMoved);
check('a still holds the key pose, playOnce() plays a rep', live.cStill && live.cOnce, live);
check('dragging turns the camera', live.dragged > 50, live.dragged);
check('setView() animates to another camera', live.viewed > 50, live.viewed);
check('onPhase fires with lift and lower phases', live.phases.includes('con') && live.phases.includes('ecc'), live.phases);
check('losing the GL context calls onFallback', live.lost === 1, live.lost);
check('destroy() leaves nothing behind', live.gone);
const after = await page.evaluate(() => {
  // A figure mounted after a context loss gets a fresh renderer.
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:160px';
  document.body.appendChild(host);
  let fell = false;
  const ctl = window.GH.figure3d.mount(host, window.GH.moves.MOVES.sq_bw, { onFallback: () => { fell = true; } });
  const c = ctl.el.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
  ctl.destroy();
  return { fell, cover: n / (d.length / 4) };
});
check('figures still draw after a context loss', !after.fell && after.cover > 0.02, after);

section('Fallback without WebGL');
const page2 = await browser.newPage();
watch(page2, 'nogl');
await page2.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, o) { return /webgl/i.test(type) ? null : orig.call(this, type, o); };
});
await page2.goto(`${base}/__fig3d.html`);
const fb = await page2.evaluate(async () => {
  await window.GH.lazy('figure3d');
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:160px';
  document.body.appendChild(host);
  let called = false;
  const ctl = window.GH.figure3d.mount(host, window.GH.moves.MOVES.push_std, { onFallback: () => { called = true; } });
  await new Promise((r) => setTimeout(r, 30));
  return { supported: window.GH.figure3d.supported(), called, shape: ['el', 'play', 'pause', 'playOnce', 'destroy', 'duration', 'setView', 'phase'].every((k) => k in ctl), still: window.GH.figure3d.still(window.GH.moves.MOVES.push_std) };
});
check('supported() is false without WebGL', fb.supported === false);
check('mount() calls onFallback when WebGL is missing', fb.called);
check('the controller keeps the pose.mount shape even then', fb.shape);
check('still() returns null without WebGL', fb.still === null);

section('Inside the app page');
const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
watch(page3, 'app');
await page3.goto(`${base}/gradient-health.html`);
await page3.waitForFunction(() => window.GH && window.GH.lazy && window.GH.pose && window.GH.moves, null, { timeout: 15000 });
const app = await page3.evaluate(async () => {
  const f = await window.GH.lazy('figure3d');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:240px;z-index:99999';
  document.body.appendChild(host);
  const ctl = f.mount(host, window.GH.moves.MOVES.sq_bw, {});
  ctl.play();
  await new Promise((r) => setTimeout(r, 400));
  const c = ctl.el.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
  const ph = ctl.phase();
  ctl.destroy();
  return { cover: n / (d.length / 4), ph, gone: !host.querySelector('canvas') };
});
check('the chunk loads and draws inside the built app', app.cover > 0.02, app);
check('destroy() removes the canvas', app.gone);

section('Page errors');
check('no page errors or console errors', !errors.length, errors.slice(0, 8).join('\n      '));

await browser.close();
server.close();
done();
