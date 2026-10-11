// Renders the promo video, docs/store/promo-1080p.mp4: 33 seconds at 1920 x 1080, 30 frames a
// second, in the store images' look (scripts/store-style.mjs). It's a page with one timeline: each
// frame, seek(t) puts everything where it is at t (nothing runs on its own clock), Chromium draws it,
// and ffmpeg (the imageio-ffmpeg build; FFMPEG=<path> for another) encodes the frames as H.264.
// The 3D figure and medal come from scripts/store-3d.mjs (rendered once). Also writes a 1280 x 720
// thumbnail. No sound: a store page plays it muted.
//
//   node scripts/promo-video.mjs [--from=<s>] [--to=<s>] [--still=<s>,<s>…]   (--still writes those frames)
import { mkdirSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { root, url, BASE, C, GRAIN } from './store-style.mjs';
import { render3d, OUT as R3, FPS, MOVES, MEDALS } from './store-3d.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : null; };
const FFMPEG = process.env.FFMPEG || execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
const out = process.env.STORE_OUT || join(root, 'docs/store');
mkdirSync(out, { recursive: true });

await render3d({ log: (m) => console.log(`3D: ${m}`) });
const r3 = (name) => pathToFileURL(join(R3, name)).href;
const seq = (dir) => readdirSync(join(R3, dir)).sort().map((f) => r3(`${dir}/${f}`));
const ASSETS = {
  figs: Object.fromEntries(MOVES.map((m) => [m, seq(`fig-${m}`)])),
  spin: seq('medal-spin'),
  medals: Object.fromEntries(MEDALS.map((m) => [m, r3(`medal-${m}.png`)])),
};
const shot = (name) => url(`docs/screenshots/${name}`);

export const DURATION = 33;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
body { width: 1920px; height: 1080px; background: ${C.ink}; }
.glow { position: absolute; left: 0; top: 0; width: 1500px; height: 1500px; margin: -750px 0 0 -750px; border-radius: 50%; will-change: transform, opacity; }
.scene { position: absolute; inset: 0; }
.scene > * { position: absolute; will-change: transform, opacity, filter; }
.h1 { font-size: 88px; font-weight: 780; letter-spacing: -0.035em; line-height: 1.0; }
.h2 { font-size: 34px; font-weight: 500; line-height: 1.32; color: rgb(232 238 255 / .74); }
.center { left: 0; right: 0; text-align: center; }
.chip { font-size: 30px; }
canvas { display: block; }
.ring-n { font-size: 120px; font-weight: 780; letter-spacing: -0.04em; }
.opt { width: 150px; height: 96px; border-radius: 48px; display: grid; place-items: center; font-size: 42px; font-weight: 760; }
.cta { height: 96px; padding: 0 56px; border-radius: 48px; display: grid; place-items: center; font-size: 38px; font-weight: 700; background: linear-gradient(100deg, #3e95f9, #34c7ae 60%, #4bc985); box-shadow: inset 0 2px 0 rgb(255 255 255 / .35), 0 24px 60px -18px rgb(52 199 174 / .7); }
</style></head><body>
<div id="glows"></div>

<!-- 1. the name -->
<div class="scene" id="s1">
  <img id="s1-icon" src="${url('docs/icon-512.png')}" style="left:850px;top:250px;width:220px;height:220px;border-radius:50px;box-shadow:0 0 0 2px rgb(255 255 255 / .4),0 30px 80px -20px rgb(62 149 249 / .8)" alt="">
  <div id="s1-name" class="center" style="top:520px;font-size:104px;font-weight:780;letter-spacing:-0.035em">Gradient Health</div>
  <div id="s1-tag" class="center h2" style="top:656px;font-size:48px;font-weight:600">Workouts that <span class="hue">adapt to you</span></div>
</div>

<!-- 2. today -->
<div class="scene" id="s2">
  <div id="s2-h" class="h1" style="left:150px;top:300px;width:900px">Planned for you,<br><span class="hue">every day</span></div>
  <div id="s2-p" class="h2" style="left:152px;top:510px;width:820px">Around your goals, your time and how you slept, then adjusted as you go.</div>
  <div id="s2-c1" class="chip glass" style="left:150px;top:680px"><i style="background:#5aa8ff;color:#5aa8ff"></i>Your goals</div>
  <div id="s2-c2" class="chip glass" style="left:390px;top:680px"><i style="background:#3fdcbf;color:#3fdcbf"></i>Your time</div>
  <div id="s2-c3" class="chip glass" style="left:620px;top:680px"><i style="background:#ffb54d;color:#ffb54d"></i>Your sleep</div>
  <div id="s2-ph" class="phone" style="left:1200px;top:60px;width:450px;--glow:rgb(62 149 249 / .6)"><img src="${shot('today.png')}" alt=""></div>
</div>

<!-- 3. the 3D figure -->
<div class="scene" id="s3">
  <div id="s3-h" class="h1 center" style="top:90px">See every move <span class="hue">in 3D</span></div>
  <div id="s3-p" class="h2 center" style="top:200px">282 exercises, each at the right tempo, with the working muscles lit.</div>
  <div id="s3-floor" style="left:260px;top:880px;width:1400px;height:120px;border-radius:50%;background:radial-gradient(closest-side, rgb(52 199 174 / .22), transparent)"></div>
  <canvas id="fig0" width="900" height="900" style="left:110px;top:300px;width:640px;height:640px"></canvas>
  <canvas id="fig1" width="900" height="900" style="left:640px;top:270px;width:680px;height:680px"></canvas>
  <canvas id="fig2" width="900" height="900" style="left:1170px;top:300px;width:640px;height:640px"></canvas>
</div>

<!-- 4. how many more -->
<div class="scene" id="s4">
  <div id="s4-ph" class="phone" style="left:250px;top:60px;width:450px;--glow:rgb(75 201 133 / .55)"><img src="${shot('rest-dark.png')}" alt=""></div>
  <div id="s4-q" class="h1" style="left:860px;top:250px;width:960px;font-size:76px">How many more reps<br>could you have done?</div>
  <div id="s4-o0" class="opt glass" style="left:862px;top:480px">0</div>
  <div id="s4-o1" class="opt glass" style="left:1042px;top:480px">1-2</div>
  <div id="s4-o2" class="opt glass" style="left:1222px;top:480px"><span id="s4-o2t">3+</span></div>
  <div id="s4-tap" style="left:1297px;top:528px;width:160px;height:160px;margin:-80px 0 0 -80px;border-radius:50%;background:radial-gradient(circle, rgb(255 255 255 / .55), rgb(255 255 255 / 0) 70%)"></div>
  <div id="s4-a" class="h1" style="left:860px;top:660px;width:980px;font-size:64px">Next time, <span class="hue">a step up</span></div>
  <div id="s4-b" class="h2" style="left:862px;top:752px;width:900px">More reps, then more weight, then a harder move.</div>
</div>

<!-- 5. the plan -->
<div class="scene" id="s5">
  <svg id="s5-ring" style="left:250px;top:250px;width:420px;height:420px" viewBox="0 0 420 420">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa8ff"/><stop offset=".6" stop-color="#3fdcbf"/><stop offset="1" stop-color="#62d98f"/></linearGradient></defs>
    <circle cx="210" cy="210" r="180" fill="none" stroke="rgb(255 255 255 / .12)" stroke-width="30"/>
    <circle id="s5-arc" cx="210" cy="210" r="180" fill="none" stroke="url(#rg)" stroke-width="30" stroke-linecap="round" transform="rotate(-90 210 210)" stroke-dasharray="1131" stroke-dashoffset="1131"/>
  </svg>
  <div id="s5-n" class="ring-n" style="left:250px;top:395px;width:420px;text-align:center">0</div>
  <div id="s5-nl" class="h2" style="left:250px;top:530px;width:420px;text-align:center;font-size:28px">plan score</div>
  <div id="s5-h" class="h1" style="left:780px;top:300px;width:1050px">The best plan<br>for <span class="hue">your week</span></div>
  <div id="s5-c" style="left:782px;top:520px;font-size:96px;font-weight:780;letter-spacing:-0.03em" class="hue">0</div>
  <div id="s5-p" class="h2" style="left:782px;top:640px;width:960px">weekly plans compared, and the best fit for your goals, time and recovery picked.</div>
</div>

<!-- 6. medals -->
<div class="scene" id="s6">
  <div id="s6-h" class="h1 center" style="top:70px">Earn medals <span class="hue-warm">worth showing off</span></div>
  <div id="s6-p" class="h2 center" style="top:178px">64 badges to collect, crack open and share.</div>
  <img id="s6-m1" src="${ASSETS.medals.halfMarathon}" style="left:200px;top:330px;width:270px" alt="">
  <img id="s6-m2" src="${ASSETS.medals.pushups20}" style="left:400px;top:690px;width:230px" alt="">
  <img id="s6-m3" src="${ASSETS.medals.w100}" style="left:1440px;top:320px;width:270px" alt="">
  <img id="s6-m4" src="${ASSETS.medals.sleepWeek}" style="left:1300px;top:700px;width:230px" alt="">
  <img id="s6-m5" src="${ASSETS.medals.earlyBird}" style="left:1650px;top:620px;width:190px" alt="">
  <canvas id="s6-spin" width="1000" height="1000" style="left:640px;top:250px;width:640px;height:640px"></canvas>
</div>

<!-- 7. everything else -->
<div class="scene" id="s7">
  <div id="s7-h" class="h1 center" style="top:70px;font-size:80px">Health, runs, food and a <span class="hue">private AI coach</span></div>
  <div id="s7-a" class="phone" style="left:170px;top:250px;width:360px;--glow:rgb(62 149 249 / .5)"><img src="${shot('health.png')}" alt=""></div>
  <div id="s7-b" class="phone" style="left:590px;top:290px;width:360px;--glow:rgb(75 201 133 / .5)"><img src="${shot('food.png')}" alt=""></div>
  <div id="s7-c" class="phone" style="left:1010px;top:250px;width:360px;--glow:rgb(52 199 174 / .5)"><img src="${shot('activity.png')}" alt=""></div>
  <div id="s7-d" class="phone" style="left:1430px;top:290px;width:360px;--glow:rgb(62 149 249 / .5)"><img src="${shot('answer-dark.png')}" alt=""></div>
</div>

<!-- 8. privacy -->
<div class="scene" id="s8">
  <div id="s8-lock" class="glass" style="left:900px;top:250px;width:120px;height:120px;border-radius:60px;display:grid;place-items:center">
    <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></svg>
  </div>
  <div id="s8-a" class="h1 center" style="top:430px">No account, no ads.</div>
  <div id="s8-b" class="h1 center" style="top:540px">Your data stays <span class="hue">on your phone</span>.</div>
</div>

<!-- 9. the end -->
<div class="scene" id="s9">
  <img id="s9-icon" src="${url('docs/icon-512.png')}" style="left:870px;top:200px;width:180px;height:180px;border-radius:41px;box-shadow:0 0 0 2px rgb(255 255 255 / .4),0 30px 80px -20px rgb(62 149 249 / .8)" alt="">
  <div id="s9-name" class="center" style="top:420px;font-size:96px;font-weight:780;letter-spacing:-0.035em">Gradient Health</div>
  <div id="s9-tag" class="center h2" style="top:548px;font-size:44px;font-weight:600">Workouts that <span class="hue">adapt to you</span></div>
  <div id="s9-cta" class="cta" style="left:50%;top:680px;transform:translateX(-50%)">Download for Android</div>
</div>
<div class="grain" style="opacity:.04"></div>

<script>
const A = ${JSON.stringify(ASSETS)};
const FPS = ${FPS};
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const E = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  lin: (t) => t,
};
// Where a value is at t between keyframes [[t0, v0], [t1, v1], ...], eased between each pair.
function key(t, ks, ease = E.out) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const [t0, v0] = ks[i - 1], [t1, v1] = ks[i]; return lerp(v0, v1, (ks[i][2] || ease)((t - t0) / (t1 - t0))); }
  return ks[ks.length - 1][1];
}
// An element in at tIn (rising dy px and fading in over d s), out at tOut (fading and drifting up).
function inOut(el, t, tIn, tOut, o = {}) {
  const d = o.d || 0.7, dy = o.dy == null ? 40 : o.dy, dx = o.dx || 0, s0 = o.s0 == null ? 1 : o.s0;
  const pin = clamp((t - tIn) / d, 0, 1), pout = clamp((t - tOut) / (o.dOut || 0.45), 0, 1);
  const ei = (o.ease || E.out)(pin), eo = E.inOut(pout);
  const op = ei * (1 - eo);
  el.style.opacity = op.toFixed(4);
  el.style.visibility = op > 0.001 ? 'visible' : 'hidden';
  const x = lerp(dx, 0, ei), y = lerp(dy, 0, ei) - eo * 30, s = lerp(s0, 1, ei) * (1 - eo * 0.04);
  const base = el.dataset.base || '';
  el.style.transform = base + ' translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + s.toFixed(4) + ')' + (o.rot ? ' rotate(' + o.rot(t).toFixed(3) + 'deg)' : '');
  el.style.filter = (o.filter || '') + (eo > 0 ? ' blur(' + (eo * 10).toFixed(2) + 'px)' : '');
  return op;
}
// The glows behind everything: each drifts slowly and moves to where each scene wants it.
const GLOWS = [['${C.blue}', 'blue'], ['${C.mint}', 'mint'], ['${C.green}', 'green'], ['${C.amber}', 'amber']];
const gl = GLOWS.map(([c]) => { const d = document.createElement('div'); d.className = 'glow'; d.style.background = 'radial-gradient(closest-side, rgb(' + c + ' / .55), rgb(' + c + ' / 0))'; $('glows').appendChild(d); return d; });
// [scene start, then per glow x, y, scale, opacity]
const GP = [
  [0, [[600, 300, 1, 0.9], [1400, 700, 1, 0.7], [1100, 1150, 0.9, 0.5], [300, 1000, 0.8, 0.5]]],
  [3, [[300, 200, 1, 0.8], [1500, 400, 1.1, 0.8], [1300, 1200, 1, 0.5], [100, 1100, 0.8, 0.45]]],
  [7, [[960, 1100, 1.4, 0.55], [500, 300, 1, 0.7], [1500, 400, 1, 0.7], [1900, 1200, 0.8, 0.3]]],
  [11.5, [[1600, 200, 1, 0.6], [400, 500, 1.1, 0.8], [700, 1100, 1, 0.7], [1700, 1100, 0.8, 0.4]]],
  [15.5, [[450, 450, 1.1, 0.8], [1400, 300, 1, 0.7], [1500, 1100, 1, 0.5], [200, 1100, 0.8, 0.4]]],
  [19, [[300, 300, 0.9, 0.5], [1700, 400, 0.9, 0.5], [900, 1150, 1, 0.4], [960, 560, 1.1, 0.75]]],
  [23, [[300, 900, 1.1, 0.7], [960, 200, 1, 0.6], [1600, 900, 1.1, 0.7], [1900, 100, 0.7, 0.3]]],
  [26.5, [[700, 400, 1, 0.75], [1300, 600, 1, 0.7], [960, 1150, 1, 0.45], [200, 1050, 0.8, 0.4]]],
  [29, [[600, 300, 1.05, 0.9], [1400, 700, 1, 0.75], [1100, 1150, 0.9, 0.55], [300, 1000, 0.85, 0.55]]],
];
function glows(t) {
  let i = 0;
  while (i + 1 < GP.length && t >= GP[i + 1][0]) i++;
  const a = GP[i][1], [t1, b] = GP[Math.min(i + 1, GP.length - 1)];
  gl.forEach((d, j) => {
    // Each moves to the next scene's place over the 1.4 s before it starts, and wanders a little.
    const w = j * 1.7;
    const cur = i + 1 < GP.length ? a[j].map((x, q) => lerp(x, b[j][q], E.inOut(clamp((t - (t1 - 1.4)) / 1.4, 0, 1)))) : a[j];
    const x = cur[0] + Math.sin(t * 0.35 + w) * 60, y = cur[1] + Math.cos(t * 0.3 + w) * 45;
    d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + cur[2].toFixed(3) + ')';
    d.style.opacity = cur[3].toFixed(3);
  });
}
// Image sequences, decoded up front, drawn into their canvases by frame.
const pics = {};
function load(list) { return Promise.all(list.map((u) => new Promise((ok, no) => { const i = new Image(); i.onload = () => i.decode().then(() => ok(i), () => ok(i)); i.onerror = no; i.src = u; }))); }
window.ready = (async () => {
  for (const [k, list] of Object.entries(A.figs)) pics[k] = await load(list);
  pics.spin = await load(A.spin);
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))));
})();
function draw(id, list, f) {
  const c = $(id), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const img = list[clamp(Math.floor(f), 0, list.length - 1)];
  ctx.drawImage(img, 0, 0, c.width, c.height);
}
const scene = (id, t, a, b) => { const on = t >= a - 0.05 && t <= b + 0.6; $(id).style.display = on ? 'block' : 'none'; return on; };

window.seek = function seek(t) {
  glows(t);
  // 1. the name
  if (scene('s1', t, 0, 3)) {
    inOut($('s1-icon'), t, 0.15, 2.6, { d: 0.9, dy: 0, s0: 0.55, ease: E.back });
    inOut($('s1-name'), t, 0.6, 2.65, { d: 0.8 });
    inOut($('s1-tag'), t, 1.05, 2.7, { d: 0.8 });
  }
  // 2. today
  if (scene('s2', t, 3, 7)) {
    inOut($('s2-h'), t, 3.1, 6.55);
    inOut($('s2-p'), t, 3.35, 6.6);
    ['s2-c1', 's2-c2', 's2-c3'].forEach((id, i) => inOut($(id), t, 3.8 + i * 0.18, 6.62, { s0: 0.8, ease: E.back, dy: 20 }));
    const ph = $('s2-ph');
    ph.dataset.base = 'perspective(1800px) rotateY(' + key(t, [[3.0, -24], [4.2, -8], [7, -4]], E.out).toFixed(2) + 'deg)';
    inOut(ph, t, 3.0, 6.6, { dx: 160, dy: 0, d: 1.0 });
  }
  // 3. the 3D figures, one rep each, a little apart
  if (scene('s3', t, 7, 11.5)) {
    inOut($('s3-h'), t, 7.1, 11.05);
    inOut($('s3-p'), t, 7.3, 11.1);
    inOut($('s3-floor'), t, 7.2, 11.1, { dy: 0 });
    const figs = ['sq_goblet', 'curl_std', 'push_std'];
    figs.forEach((m, i) => {
      const el = $('fig' + i), t0 = 7.35 + i * 0.25;
      inOut(el, t, t0, 11.1, { dy: 60, d: 0.8 });
      const list = pics[m];
      draw('fig' + i, list, (Math.max(0, t - t0) * FPS + i * 20) % list.length);
    });
  }
  // 4. how many more
  if (scene('s4', t, 11.5, 15.5)) {
    const ph = $('s4-ph');
    ph.dataset.base = 'perspective(1800px) rotateY(' + key(t, [[11.5, 22], [12.6, 8], [15.5, 4]]).toFixed(2) + 'deg)';
    inOut(ph, t, 11.5, 15.05, { dx: -160, dy: 0, d: 1.0 });
    inOut($('s4-q'), t, 11.65, 15.05);
    ['s4-o0', 's4-o1', 's4-o2'].forEach((id, i) => inOut($(id), t, 12.0 + i * 0.12, 15.1, { s0: 0.8, ease: E.back, dy: 16 }));
    // the tap on 3+
    const tap = clamp((t - 13.05) / 0.5, 0, 1);
    const tapEl = $('s4-tap');
    tapEl.style.opacity = (tap > 0 && tap < 1 ? (1 - tap) * 0.9 : 0).toFixed(3);
    tapEl.style.transform = 'scale(' + (0.3 + tap * 1.2).toFixed(3) + ')';
    const on = clamp((t - 13.1) / 0.25, 0, 1);
    const o2 = $('s4-o2');
    o2.style.background = on ? 'linear-gradient(100deg, rgb(62 149 249 / ' + on + '), rgb(52 199 174 / ' + on + ') 60%, rgb(75 201 133 / ' + on + '))' : '';
    o2.dataset.base = 'scale(' + (1 + Math.sin(clamp((t - 13.05) / 0.35, 0, 1) * Math.PI) * 0.08).toFixed(3) + ')';
    inOut($('s4-a'), t, 13.55, 15.1);
    inOut($('s4-b'), t, 13.8, 15.12);
  }
  // 5. the plan
  if (scene('s5', t, 15.5, 19)) {
    inOut($('s5-ring'), t, 15.55, 18.55, { dy: 0, s0: 0.85 });
    inOut($('s5-n'), t, 15.7, 18.55, { dy: 0 });
    inOut($('s5-nl'), t, 15.8, 18.55, { dy: 0 });
    const p = E.out(clamp((t - 15.8) / 1.6, 0, 1));
    $('s5-arc').setAttribute('stroke-dashoffset', (1131 * (1 - 0.83 * p)).toFixed(1));
    $('s5-n').textContent = String(Math.round(83 * p));
    inOut($('s5-h'), t, 15.65, 18.55);
    inOut($('s5-c'), t, 15.95, 18.6);
    $('s5-c').textContent = Math.round(124698 * E.out(clamp((t - 16) / 1.8, 0, 1))).toLocaleString('en-US');
    inOut($('s5-p'), t, 16.2, 18.62);
  }
  // 6. medals: the gold one spins in, the rest float round it
  if (scene('s6', t, 19, 23)) {
    inOut($('s6-h'), t, 19.1, 22.55);
    inOut($('s6-p'), t, 19.3, 22.6);
    ['s6-m1', 's6-m2', 's6-m3', 's6-m4', 's6-m5'].forEach((id, i) => {
      const el = $(id);
      el.dataset.base = 'translateY(' + (Math.sin(t * 1.3 + i * 1.9) * 12).toFixed(2) + 'px) rotate(' + (Math.sin(t * 0.9 + i) * 6 + (i % 2 ? 8 : -8)).toFixed(2) + 'deg)';
      inOut(el, t, 19.6 + i * 0.12, 22.6, { s0: 0.6, ease: E.back, dy: 0, filter: 'drop-shadow(0 20px 26px rgb(0 0 0 / .55))' });
    });
    const sp = $('s6-spin');
    inOut(sp, t, 19.25, 22.6, { dy: 0, d: 0.2, filter: 'drop-shadow(0 0 80px rgb(244 168 62 / .35))' });
    draw('s6-spin', pics.spin, Math.max(0, t - 19.25) * FPS);
  }
  // 7. everything else
  if (scene('s7', t, 23, 26.5)) {
    inOut($('s7-h'), t, 23.1, 26.05);
    ['s7-a', 's7-b', 's7-c', 's7-d'].forEach((id, i) => {
      const el = $(id);
      el.dataset.base = 'rotate(' + [-4, 2, -2, 4][i] + 'deg)';
      inOut(el, t, 23.3 + i * 0.14, 26.1, { dy: 260, d: 0.9 });
    });
  }
  // 8. privacy
  if (scene('s8', t, 26.5, 29)) {
    inOut($('s8-lock'), t, 26.55, 28.55, { dy: 0, s0: 0.6, ease: E.back });
    inOut($('s8-a'), t, 26.75, 28.6);
    inOut($('s8-b'), t, 27.1, 28.62);
  }
  // 9. the end
  if (scene('s9', t, 29, 33)) {
    inOut($('s9-icon'), t, 29.1, 99, { dy: 0, s0: 0.55, ease: E.back, d: 0.9 });
    inOut($('s9-name'), t, 29.45, 99);
    inOut($('s9-tag'), t, 29.75, 99);
    const cta = $('s9-cta');
    cta.dataset.base = 'translateX(-50%)';
    inOut(cta, t, 30.15, 99, { s0: 0.85, ease: E.back, dy: 20 });
  }
};
</script>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), 'gh-promo-'));
const page0 = join(tmp, 'promo.html');
writeFileSync(page0, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
await page.goto(pathToFileURL(page0).href);
await page.evaluate(() => window.ready);
const frameAt = (t) => page.evaluate((t) => window.seek(t), t).then(() => page.screenshot({ type: 'jpeg', quality: 95 }));

const stills = (process.argv.find((x) => x.startsWith('--still=')) || '').slice(8);
if (stills) {
  for (const t of stills.split(',').map(Number)) writeFileSync(join(out, `promo-frame-${t}.jpg`), await frameAt(t));
  console.log(`frames at ${stills} s in ${out}`);
} else {
  const from = arg('from') || 0, to = arg('to') || DURATION;
  const file = join(out, from || to !== DURATION ? `promo-${from}-${to}.mp4` : 'promo-1080p.mp4');
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((to - from) * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frameAt(from + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i} of ${n} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())));
  // A thumbnail for a video page: the medal scene.
  if (!from && to === DURATION) writeFileSync(join(out, 'promo-thumbnail-1280x720.jpg'), await page.evaluate((t) => window.seek(t), 21.2).then(() => page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 'css' })));
  console.log(`${file}: ${n} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
process.exit(0);
