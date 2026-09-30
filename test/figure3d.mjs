// The 3D exercise figure in Chromium (WebGL through SwiftShader): for every move (or the filter) it
// mounts the figure, renders three frames through the rep, checks each frame drew a figure (not
// empty, not one flat colour) and that nothing threw, then writes contact sheets to build/fig3d/.
// Also checks the fallback (no WebGL → onFallback), still() thumbnails, and loading the chunk with
// GH.lazy inside the real app page.
//
// Usage: node test/figure3d.mjs [filter,filter…] [--dark] [--mirrored] [--size=240x200] [--cols=6]
//        [--focus=head|hand|foot|trunk] [--view=side|front|three-quarter] (for checking details)
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
<script>${readFileSync(join(root, 'src/data/moves-access.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>
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

const results = await page.evaluate(async ({ filters, dark, mirrored, focus, view }) => {
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
      for (const k of [0, 1, 2]) {
        const t = Math.round((total * k) / 3);
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
}, { filters, dark, mirrored, focus: FOCUS, view: VIEW });

// (A --focus close-up is framed on the key pose, so the part may leave it: only errors count then.)
const bad = results.filter((r) => r.error || r.frames.length !== 3 || (!FOCUS && r.frames.some((f) => f.cover < 0.02 || f.sd < 6)));
check(`every move (${results.length}) renders three frames with a visible, shaded figure`, !bad.length, bad.slice(0, 6).map((r) => `${r.id}: ${r.error || JSON.stringify(r.frames)}`).join('\n      '));
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
