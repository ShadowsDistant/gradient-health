// Plan's 3D stills from cold: how long after a tap on the Plan tab its tiles show the 3D figure when
// the phone has none of them kept (src/ui/stills.js), in Chromium at phone size (390 x 844, touch, 2x)
// with the CPU slowed 4x, someone five weeks in, on a Monday morning (a workout day). Two cases:
// - fresh: a fresh install (nothing kept, WebGL 2 never checked on this phone)
// - update: an update that draws the figure differently (every still the last version kept is under
//   an older figure's id, so it can only stand in until this version's is drawn)
// Each run is a fresh browser (its own GPU process, so no shader is compiled already), and Plan is
// tapped --delay ms after launch's first frame (1 s by default: someone who opens the app and goes
// straight to Plan). Nothing is touched after the tap. What's timed, from the tap:
// - screen: until every tile on Plan's first screen shows a 3D still (after an update, a stand-in
//   counts: "new" is until each shows this version's)
// - card: until every tile in today's card does (a short scroll away)
// - week: until every still this week's days show is drawn (picking a day shows them at once)
// and, along the way, where the time goes: the 3D chunk asked for and run, the warm-up (preload) and
// when stills can go, the WebGL context, shader compiles, each still's drawing on the page's thread,
// copies out of the GL canvas, encoding and data URLs, the writes to IndexedDB, the longest frame,
// and the GPU process's CPU time (WebGL is SwiftShader here: the GPU's work done in software, outside
// the 4x, so a still costs far more than on a phone, and other tests running on this machine slow
// it down; the numbers are for comparing builds here, best run against run with --vs).
//
// Usage: node test/ui-stills.mjs [--measure] [--runs=3] [--delay=1000] [--only=fresh|update|kept] [--dist=<dir>] [--vs=<dir>] [--still-glow] [--flat]
//   (kept: the plan builder's large tiles kept apart, and the stills for later off the page's thread)
//   --measure     print the numbers only, no checks
//   --dist        a built page somewhere else (a copy of an older dist/), to compare on the same machine
//   --vs          another build, run by run in turn with this one
//   --still-glow  the background glow held still (Settings, Look, Moving background off). Its drift
//                 starts 3 s after the tap, just as the stills draw, and here SwiftShader draws it in
//                 software too, in the same GPU process: this shows the stills' own time without it.
//   --flat        Glass effects set to Flat (Settings, Look: no glass filters, no glow). SwiftShader
//                 spends seconds drawing the page itself after launch (the glass over everything, at
//                 2x), which a phone's GPU does in a few frames: this is nearer a phone, where the
//                 GPU's time goes to the 3D figure.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const measureOnly = process.argv.includes('--measure');
const RUNS = Math.max(1, Number(arg('runs', 3)));
const DELAY = Math.max(0, Number(arg('delay', 1000)));
const ONLY = arg('only', '');
const STILL_GLOW = process.argv.includes('--still-glow');
const FLAT = process.argv.includes('--flat');
const CPU = 4;
const MONDAY = '2026-10-19T08:10:00';

/* ---------------------------------------------------------------- budgets */
// What this version reached, run by run with 1.9.0 (in brackets) on a machine with 4 CPUs and other
// tests running alongside (load 12 to 18), best of 3 and median:
// - a fresh install: Plan's first screen 15.9 and 16.5 s (15.1 and 18.1 s), the week's stills 27.2
//   and 30.1 s (25.1 and 27.3 s). On a quieter machine, with an earlier build of this work: 5.9 s
//   (6.8 s) and 9.6 s (11.9 s).
// - after an update: the first screen 0.75 and 0.76 s, a stand-in at once (18.7 and 22.9 s), this
//   version's there 13.6 and 16.6 s, the week's 27.3 and 28.5 s (29.8 and 32.7 s).
// A fresh install here waits on the software GPU, which draws the page's glass after launch, the
// room's light, the shaders and some 300 ms a still, all in one process, and gets less of the
// machine the more else runs: these budgets are loose, there to catch stills that stop coming (stuck
// behind a wait). The stand-in's is tight, and so is each still's time on the page's thread (Checks).
const BUDGET = {
  fresh: { screen: 22000, week: 40000 },
  update: { screen: 3000, screenNew: 30000, week: 40000 },
};

/* ---------------------------------------------------------------- the page */
async function serve(dir) {
  if (!dir) return serveDist();
  const base = resolve(dir);
  const extra = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else extra['/' + relative(base, p).split(sep).join('/')] = p; } };
  if (!existsSync(join(base, 'gradient-health.html'))) throw new Error(`no gradient-health.html in ${base}`);
  walk(base);
  return serveDist(extra);
}
const builds = [{ name: arg('dist', '') || 'dist', server: await serve(arg('dist', '')) }];
if (arg('vs', '')) builds.push({ name: arg('vs', ''), server: await serve(arg('vs', '')) });
const GPU_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const r0 = (x) => (x == null || !isFinite(x) ? '-' : String(Math.round(x)));

// CPU time (ms) of this test's own GPU processes (Linux; elsewhere nothing), as ui-scroll counts it.
function gpuMs() {
  let out = 0;
  const info = new Map();
  let dirs = [];
  try { dirs = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch (e) { return 0; }
  for (const d of dirs) {
    try {
      const f = readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ');
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      info.set(Number(d), [Number(f[1]), (Number(f[11]) + Number(f[12])) * 10, /--type=gpu-process/.test(cmd)]);
    } catch (e) { /* gone */ }
  }
  const mine = (pid) => { for (let p = pid, n = 0; p > 1 && n < 64; n++) { if (p === process.pid) return true; const i = info.get(p); if (!i) return false; p = i[0]; } return false; };
  for (const [pid, [, ms, gpu]] of info) if (gpu && mine(pid)) out += ms;
  return out;
}

// The clock on Monday morning, running: Date only (timers and idle callbacks stay real).
function monday(at) {
  const RD = Date, off = new RD(at).getTime() - RD.now();
  function D(...a) { if (!new.target) return new D().toString(); return a.length ? new RD(...a) : new RD(RD.now() + off); }
  D.prototype = RD.prototype;
  D.now = () => RD.now() + off;
  D.parse = RD.parse;
  D.UTC = RD.UTC;
  Object.setPrototypeOf(D, RD);
  window.Date = D;
}
function asyncBridge() {
  if (window.AndroidBridge) window.AndroidBridge.saveAsync = () => true;
}

// In the page before anything else: where a still's time goes. Main-thread time inside the calls
// that make up a still (sums, ms), the background parts from their start to their end, and the
// moments that matter.
function probe() {
  const P = window.__st = { tap: 0, at: {}, sum: {}, n: {}, loaf: [], tiles: new Map() };
  const add = (k, ms) => { P.sum[k] = (P.sum[k] || 0) + ms; P.n[k] = (P.n[k] || 0) + 1; };
  const mark = (k) => { if (!P.at[k]) P.at[k] = performance.now(); };
  const timed = (obj, name, k, when) => {
    const orig = obj && obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...a) {
      if (when && !when(this, a)) return orig.apply(this, a);
      const t0 = performance.now();
      try { return orig.apply(this, a); } finally { add(k, performance.now() - t0); }
    };
  };
  // WebGL contexts made (the 3D figure's, and the checks for WebGL 2 before it).
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (!/webgl/.test(type)) return gc.call(this, type, ...rest);
    const t0 = performance.now();
    try { const c = gc.call(this, type, ...rest); if (c) this.__gl = true; return c; } finally { add('context', performance.now() - t0); }
  };
  // Shader compiles: the calls that wait for the GPU's compiler, or ask it (link status, uniforms).
  const GL = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  for (const f of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getUniformLocation', 'getActiveUniform', 'getAttribLocation', 'getActiveAttrib']) timed(GL, f, 'compile');
  // Copies out of the GL canvas: through a 2D canvas (which waits for the GPU to draw the frame, and
  // the 2D canvas read after it), or into a buffer (readPixels, then the read once it's there).
  const isGL = (x) => x && x.tagName === 'CANVAS' && !!x.__gl;
  timed(CanvasRenderingContext2D.prototype, 'drawImage', 'copyOut', (ctx, a) => isGL(a[0]));
  timed(CanvasRenderingContext2D.prototype, 'getImageData', 'canvasRead');
  timed(GL, 'readPixels', 'copyOut');
  timed(GL, 'getBufferSubData', 'copyOut');
  // Encoding: toDataURL on the thread, toBlob in the background (from the call to its callback).
  timed(HTMLCanvasElement.prototype, 'toDataURL', 'encodeSync');
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) { const t0 = performance.now(); return tb.call(this, (b) => { add('encode', performance.now() - t0); cb(b); }, ...rest); };
  const rd = FileReader.prototype.readAsDataURL;
  FileReader.prototype.readAsDataURL = function (b) { const t0 = performance.now(); this.addEventListener('loadend', () => add('dataUrl', performance.now() - t0), { once: true }); return rd.call(this, b); };
  // IndexedDB: each read-write transaction on the stills, from its start to its end.
  const tx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
    const t = tx.call(this, names, mode, ...rest);
    if (this.name === 'gh-stills') {
      const t0 = performance.now(), k = mode === 'readwrite' ? 'idbWrite' : 'idbRead';
      const end = () => add(k, performance.now() - t0);
      t.addEventListener('complete', end); t.addEventListener('abort', end); t.addEventListener('error', end);
    }
    return t;
  };
  timed(IDBObjectStore.prototype, 'put', 'idbPut');
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.loaf.push({ t: Math.round(e.startTime), d: Math.round(e.duration), block: Math.round(e.blockingDuration || 0) }); }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { /* unsupported */ }
  // The tap (the first touch on the tab bar's Plan tab).
  document.addEventListener('pointerdown', (e) => { if (!P.tap && e.target.closest && e.target.closest('.rf-tab[data-tab="plan"]')) P.tap = performance.now(); }, { capture: true, passive: true });
  // The 3D chunk: asked for (its script added) and run (GH.figure3d set); its warm-up and stills.
  document.addEventListener('DOMContentLoaded', () => new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (n.tagName === 'SCRIPT' && /lazy\/figure3d/.test(n.src || '')) mark('chunkAsked');
  }).observe(document.head, { childList: true }));
  const GH = window.GH = window.GH || {};
  let fig;
  Object.defineProperty(GH, 'figure3d', {
    configurable: true, enumerable: true,
    get: () => fig,
    set(v) {
      fig = v;
      if (!v || P.at.chunkRun) return;
      mark('chunkRun');
      const pre = v.preload;
      v.preload = function (...a) { mark('preload'); const p = pre.apply(this, a); Promise.resolve(p).then(() => mark('preloaded')); return p; };
      for (const name of ['stillNow', 'still', 'stillAsync']) {
        const f = v[name];
        if (typeof f !== 'function') continue;
        v[name] = function (...a) { mark('firstStill'); const t0 = performance.now(); try { return f.apply(this, a); } finally { add('still', performance.now() - t0); } };
      }
      for (const name of ['warm', 'stillsReady']) {
        const f = v[name];
        if (typeof f === 'function') v[name] = function () { const w = f.call(this); if (w) mark(name === 'warm' ? 'warm' : 'ready'); return w; };
      }
    },
  });
  // Plan's tiles: when each first shows a 3D still, and when this version's.
  const fresh = (img) => (img.getAttribute('data-k') || '').startsWith(`${window.GH.FIGURE}|`);
  const seen = () => {
    for (const img of document.querySelectorAll('#screen .pw-thumb[data-move] > img')) {
      const h = img.parentElement;
      let t = P.tiles.get(h);
      if (!t) P.tiles.set(h, t = { any: performance.now(), cur: 0 });
      if (!t.cur && fresh(img)) t.cur = performance.now();
    }
  };
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(seen).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-k'] }));
}

// The state: five weeks of history on the usual Mon, Tue, Thu, Fri, built by the app itself.
let stateJson;
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(monday, MONDAY);
  await ctx.addInitScript(seedBridge);
  const page = await ctx.newPage();
  await page.goto(builds[0].server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState, { usualWeek: true });
  await page.evaluate(() => { if (window.GH.store.flush) window.GH.store.flush(); });
  stateJson = await page.evaluate(() => sessionStorage.getItem('shot-state'));
  await browser.close();
}
if (!stateJson || stateJson.length < 1000) { console.error('Couldn\'t seed the state.'); process.exit(1); }
if (STILL_GLOW || FLAT) {
  const S = JSON.parse(stateJson);
  S.profile.prefs = Object.assign({}, S.profile.prefs, STILL_GLOW ? { glowMove: false } : {}, FLAT ? { glass: 'flat' } : {});
  stateJson = JSON.stringify(S);
}

// In the page: this week's stills (as each day's card shows them: cardMoves in src/ui/plan.js), the
// tiles on Plan's first screen and in today's card, and how many show a still.
const STATE = `(() => {
  const GH = window.GH, U = GH.ui, P = window.__st, B = GH.brain, M = GH.moves, S = U.S;
  const w = GH.planWeek(S, U.today()), o = U.stills.look(52), week = new Set();
  for (const e of w.days) {
    const s = (e.kind === 'today' || e.kind === 'workout') && e.session;
    const ids = s ? [].concat((s.tests || []).map((t) => t.moveId), s.items.map((it) => it.moveId), (s.extras || []).map((x) => x.moveId), s.finisher ? [s.finisher.moveId] : [], (s.mobility || []).map((mb) => mb.moveId))
      : e.kind === 'done' && e.log ? e.log.items.map((x) => x.moveId) : e.kind === 'light' && B.mobilityFlow ? B.mobilityFlow(S).map((m) => m.moveId) : [];
    const eq = B.eqFor ? B.eqFor(S, e.day) : S.profile.equipment;
    for (const id of ids) { const m0 = M.MOVES[id]; if (m0) week.add(U.stills.key(M.forPerson ? M.forPerson(m0, eq) : m0, o)); }
  }
  const vh = window.innerHeight - ((document.getElementById('tabbar') || {}).offsetHeight || 0);
  const card = [...document.querySelectorAll('#screen .pw-card .pw-thumb[data-move]')];
  const screen = card.filter((h) => { const r = h.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; });
  const kept = [...week].filter((k) => U.stills.url(k)).length;
  if (!P.weekAll && week.size && kept === week.size) P.weekAll = performance.now();
  const when = (list, k) => { const ts = list.map((h) => (P.tiles.get(h) || {})[k] || 0); return ts.length && ts.every(Boolean) ? Math.max(...ts) : 0; };
  return { view: document.getElementById('screen').dataset.view, card: card.length, screen: screen.length,
    shown: screen.filter((h) => h.querySelector(':scope > img')).length, cardShown: card.filter((h) => h.querySelector(':scope > img')).length,
    week: week.size, kept, flat: card.filter((h) => h.querySelector(':scope > svg')).length,
    t: { screen: when(screen, 'any'), screenNew: when(screen, 'cur'), card: when(card, 'any'), cardNew: when(card, 'cur'), week: P.weekAll || 0 } };
})()`;

// One run: a fresh browser and phone, set up as a fresh install or as after an update, then the app
// launched and Plan tapped.
async function run(kind, build) {
  const browser = await chromium.launch({ args: GPU_ARGS });
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(monday, MONDAY);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, stateJson);
  let old = 0;
  if (kind === 'update') {
    // The last version ran here: it checked WebGL 2 and kept this week's and next week's stills,
    // under its own figure's id. (Nothing loads the 3D chunk meanwhile.)
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(build.server.url);
    await page.waitForSelector('#screen[data-view="today"] .session');
    old = await page.evaluate(async () => {
      const U = window.GH.ui;
      U.preloadFigure = U.warmFigure = () => Promise.resolve(false);
      U.stills.ahead = () => 0;
      if (!U.stills.ok()) return -1;
      // A still's worth of picture (about the size of a real one).
      const c = document.createElement('canvas');
      c.width = c.height = 104;
      const x = c.getContext('2d');
      for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 60% ${30 + (i % 50)}%)`; x.fillRect((i * 13) % 104, (i * 29) % 104, 5 + (i % 7), 5 + (i % 5)); }
      const url = c.toDataURL('image/webp', 0.9);
      const keys = [...new Set(U.planStills(U.S, U.today()).map((j) => U.stills.key(j.m, j.o)))].map((k) => k.replace(/^[^|]*\|/, 'f0e1d2c3|'));
      const d = await new Promise((res, rej) => { const r = indexedDB.open('gh-stills', 1); r.onupgradeneeded = () => r.result.createObjectStore('stills', { keyPath: 'k' }).createIndex('at', 'at'); r.onsuccess = () => res(r.result); r.onerror = rej; });
      await new Promise((res, rej) => { const t = d.transaction('stills', 'readwrite'); const os = t.objectStore('stills'); keys.forEach((k, i) => os.put({ k, url, at: Date.now() - 86400000 + i })); t.oncomplete = res; t.onerror = rej; });
      d.close();
      return keys.length;
    });
    await page.close();
  }
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: build.server.url });
  let first = 0;
  for (let i = 0; i < 400 && !first; i++) { await sleep(50); first = await ev("document.querySelector('#screen[data-view=\"today\"] .session') ? performance.now() : 0").catch(() => 0); }
  await sleep(DELAY);
  // A tap on the Plan tab, as a finger does it.
  const tab = await ev(`(() => { const r = document.querySelector('#tabbar .rf-tab[data-tab="plan"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const g0 = gpuMs();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tab[0], y: tab[1], id: 1 }] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Then left alone until this week's stills are all in, and every tile in the card shows this
  // version's (two minutes at most).
  let s = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(100);
    s = await ev(STATE).catch(() => s);
    if (s && s.t.week && s.t.cardNew) break;
  }
  const gpu = gpuMs() - g0;
  await sleep(300);
  s = await ev(STATE).catch(() => s);
  const P = await ev(`(() => { const P = window.__st; return { tap: P.tap, at: P.at, sum: P.sum, n: P.n, loaf: P.loaf, first: Math.min(...[...P.tiles.values()].map((t) => t.any)) }; })()`);
  await browser.close();
  const rel = (t) => (t && P.tap ? t - P.tap : null);
  const end = s && s.t.week ? Math.max(s.t.week, s.t.cardNew || 0) : Infinity;
  return {
    kind, build: build.name, old, s, gpu,
    screen: rel(s && s.t.screen), screenNew: rel(s && s.t.screenNew), card: rel(s && s.t.card), cardNew: rel(s && s.t.cardNew), week: rel(s && s.t.week), firstTile: rel(P.first),
    at: Object.fromEntries(Object.entries(P.at).map(([k, v]) => [k, rel(v)])),
    sum: P.sum, n: P.n,
    // The longest frame from the tap until the week was in.
    longest: P.loaf.filter((x) => x.t >= P.tap && x.t <= end).reduce((m, x) => Math.max(m, x.d), 0),
  };
}

function report(r) {
  const a = r.at, sm = r.sum, n = r.n;
  const per = (k) => (n[k] ? `${r0(sm[k])} ms (${n[k]}, ${r0(sm[k] / n[k])} each)` : '-');
  const s = r.s || {};
  console.log(`  ${builds.length > 1 ? `${r.build}: ` : ''}screen ${r0(r.screen)} ms (new ${r0(r.screenNew)}, ${s.screen} tiles), card ${r0(r.card)} ms (new ${r0(r.cardNew)}, ${s.card} tiles), week ${r0(r.week)} ms (${s.kept} of ${s.week} stills)${r.old ? `; ${r.old} kept under the old figure` : ''}`);
  console.log(`    chunk asked +${r0(a.chunkAsked)}, run +${r0(a.chunkRun)}; warm-up +${r0(a.preload)}, stills can go +${r0(a.ready || a.warm)}, done +${r0(a.preloaded)}; first still +${r0(a.firstStill)}, first tile +${r0(r.firstTile)}`);
  console.log(`    on the page's thread: WebGL contexts ${per('context')}, shader compiles ${r0(sm.compile)} ms, stills ${per('still')}, copies out ${r0(sm.copyOut)} ms, 2D canvas reads ${r0(sm.canvasRead)} ms, encodes ${r0(sm.encodeSync)} ms; longest frame ${r.longest} ms`);
  console.log(`    in the background: encodes ${per('encode')}, data URLs ${per('dataUrl')}, IndexedDB writes ${per('idbWrite')}, ${n.idbPut || 0} puts; GPU process ${r0(r.gpu)} ms of CPU`);
}

const kinds = ONLY ? [ONLY].filter((k) => k !== 'kept') : ['fresh', 'update'];
const results = {};
for (const kind of kinds) {
  section(`${kind === 'fresh' ? 'A fresh install' : 'After an update'}: Plan ${DELAY} ms after the first frame (CPU ${CPU}x slower, ${RUNS} runs${builds.length > 1 ? ' each, run by run' : ''}${STILL_GLOW ? ', the glow held still' : ''}${FLAT ? ', glass effects flat' : ''})`);
  results[kind] = builds.map(() => []);
  for (let i = 0; i < RUNS; i++) {
    for (let b = 0; b < builds.length; b++) {
      const r = await run(kind, builds[(b + i) % builds.length]);
      results[kind][(b + i) % builds.length].push(r);
      report(r);
    }
  }
}

const med = (xs) => { const s = xs.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : null; };
const best = (xs) => { const s = xs.filter((x) => x != null && isFinite(x)); return s.length ? Math.min(...s) : null; };
console.log('');
const summary = {};
for (const kind of kinds) {
  builds.forEach((b, j) => {
    const rs = results[kind][j];
    const m = (k) => med(rs.map((r) => r[k]));
    summary[`${kind}:${j}`] = { screen: m('screen'), screenNew: m('screenNew'), card: m('card'), week: m('week') };
    console.log(`  ${kind}${builds.length > 1 ? ` (${b.name})` : ''}: median screen ${r0(m('screen'))} ms (new ${r0(m('screenNew'))}), card ${r0(m('card'))} ms (new ${r0(m('cardNew'))}), week ${r0(m('week'))} ms; best screen ${r0(best(rs.map((r) => r.screen)))}, week ${r0(best(rs.map((r) => r.week)))}; GPU process ${r0(m('gpu'))} ms`);
  });
}

if (!measureOnly) {
  section('Checks');
  for (const kind of kinds) {
    const rs = results[kind][0];
    check(`${kind}: every tile on Plan's first screen gets its 3D still`, rs.every((r) => r.s && r.s.screen > 0 && r.s.shown === r.s.screen), rs.map((r) => r.s));
    check(`${kind}: and every still of this week is drawn`, rs.every((r) => r.s && r.s.week > 0 && r.s.kept === r.s.week), rs.map((r) => r.s));
    check(`${kind}: no tile ever shows the flat figure`, rs.every((r) => r.s && r.s.flat === 0), rs.map((r) => r.s && r.s.flat));
    // Each still's own time on the page's thread (posing the figure, drawing it): the GPU's part, the
    // copy out and the encoding wait for nothing there. 40 to 90 ms a still here; 1.9.0's waited for
    // the GPU, 260 to 620 ms.
    const thread = (r) => (r.n.encode ? r.sum.still / r.n.encode : Infinity);
    check(`${kind}: a still holds the page's thread ${r0(Math.max(...rs.map(thread)))} ms at most (budget 150)`, rs.every((r) => thread(r) <= 150), rs.map((r) => r0(thread(r))));
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5));

  section(`Budgets (best of ${RUNS})`);
  for (const kind of kinds) {
    const rs = results[kind][0], b = BUDGET[kind];
    const top = (k) => best(rs.map((r) => r[k]));
    check(`${kind}: Plan's first screen shows the 3D figure within ${b.screen} ms of the tap`, top('screen') != null && top('screen') <= b.screen, `${r0(top('screen'))} ms`);
    if (b.screenNew) check(`${kind}: this version's stills there within ${b.screenNew} ms`, top('screenNew') != null && top('screenNew') <= b.screenNew, `${r0(top('screenNew'))} ms`);
    check(`${kind}: this week's stills all drawn within ${b.week} ms`, top('week') != null && top('week') <= b.week, `${r0(top('week'))} ms`);
  }
}

/* ---------------------------------------------------------------- kept apart, and stills for later */
// The plan builder's large tiles (src/ui/stills.js, opt.keep false: its picker's and a plan's
// exercise) are kept on the phone apart from Plan's stills, as their pictures: drawn once, and a later
// launch reads them in when a large tile first asks, with nothing drawn and no 3D chunk; a launch that
// shows none reads none. (Until 1.14 they were held for the launch only: the picker drew every one of
// them again each launch.) And the figure's stills for later (figure3d.stillAsync: the player's and the
// how-to sheet's, kept for the next launch, drawn a few seconds after the warm-up on a workout day) go
// out the way the page's stills do, so encoding one never waits for the GPU on the page's thread: in
// 1.13, five in a row here held it 300 to 560 ms each (a 2D canvas the GPU kept, read back to encode
// it), and now under 60 ms in all. At 1x CPU.
if (!measureOnly && (!ONLY || ONLY === 'kept')) {
  section('The large tiles\' stills kept apart, and stills for later off the page\'s thread (1x CPU)');
  const prof = mkdtempSync(join(tmpdir(), 'gh-stills-'));
  const launch = async () => {
    const ctx = await chromium.launchPersistentContext(prof, { ...ctxOpts, args: GPU_ARGS });
    await ctx.addInitScript(monday, MONDAY);
    await ctx.addInitScript(seedBridge);
    await ctx.addInitScript(asyncBridge);
    await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, stateJson);
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(builds[0].server.url);
    await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 60000 });
    return { ctx, page };
  };
  let { ctx, page } = await launch();
  // The first launch: six large tiles' stills (only those: nothing drawn ahead), written.
  const one = await page.evaluate(async () => {
    const GH = window.GH, U = GH.ui, M = GH.moves;
    U.stills.ahead = () => 0;
    const ids = Object.keys(M.MOVES).filter((id) => !M.MOVES[id].gym).slice(0, 6);
    const o = U.stills.look(120);
    const all = Promise.all(ids.map((id) => new Promise((res) => { const u = U.stills.want(M.MOVES[id], o, res, { keep: false }); if (u !== null) res(u); })));
    const urls = (await Promise.race([all, new Promise((res) => setTimeout(() => res(null), 150000))])) || [];
    await U.stills.flush();
    const db = await new Promise((res) => {
      const r = indexedDB.open('gh-stills-big');
      r.onsuccess = () => {
        const d = r.result;
        try {
          const q = d.transaction('stills').objectStore('stills').getAll();
          q.onsuccess = () => { res(q.result.map((x) => ({ k: x.k, type: x.blob ? x.blob.type : typeof x.url }))); d.close(); };
          q.onerror = () => { d.close(); res(null); };
        } catch (e) { d.close(); res(null); }
      };
      r.onerror = () => res(null);
    });
    return { ids, got: urls.filter(Boolean).length, db, stats: U.stills._stats() };
  });
  check('the first launch draws the large tiles\' stills and keeps them, as their pictures, apart from Plan\'s', one.got === 6 && one.db && one.db.length >= 6 && one.db.every((x) => /^image\//.test(x.type)) && one.stats.kept === 0, one);
  // Stills for later, with the figure warm: the player's kept ones (player.js), long tasks meanwhile.
  await page.waitForFunction(() => window.GH.figure3d && window.GH.figure3d.warm(), null, { timeout: 120000, polling: 250 }).catch(() => {});
  const later = await page.evaluate(async () => {
    const warm = !!(window.GH.figure3d && window.GH.figure3d.warm());
    const L = [];
    let po = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) L.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' }); } catch (e) { /* unsupported */ }
    localStorage.removeItem('gh.figStills');
    window.GH.ui.figureStills(true);
    const kept = () => { try { return (JSON.parse(localStorage.getItem('gh.figStills') || '{}').items || []).length; } catch (e) { return 0; } };
    for (let i = 0; i < 600 && kept() < 3; i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 500));
    if (po) po.disconnect();
    return { warm, n: kept(), longest: Math.max(0, ...L), tasks: L, quiet: window.GH.ui.quiet(), boxes: document.querySelectorAll('.pl-fig, .sheet-fig, .fig3d[data-ready]').length };
  });
  check(`the player's stills for later are kept, the page's thread never held 250 ms for one (longest task ${later.longest} ms)`, later.n >= 3 && later.longest < 250, later);
  await ctx.close();
  // A later launch: nothing read in at launch; a large tile's ask reads them in, nothing drawn.
  ({ ctx, page } = await launch());
  const two = await page.evaluate(async (ids) => {
    const GH = window.GH, U = GH.ui, M = GH.moves;
    U.stills.ahead = () => 0;
    U.stills.prime = () => {};
    U.preloadFigure = U.warmFigure = () => Promise.resolve(false);
    await new Promise((res) => setTimeout(res, 2500));
    const before = U.stills._stats();
    const o = U.stills.look(120);
    const t0 = performance.now();
    const urls = await Promise.all(ids.map((id) => new Promise((res) => { const u = U.stills.want(M.MOVES[id], o, res, { keep: false }); if (u !== null) res(u); })));
    return { before: before.big, ms: Math.round(performance.now() - t0), got: urls.filter(Boolean).length, stats: U.stills._stats(), chunk: !!GH.figure3d };
  }, one.ids);
  check('a later launch reads none of them in by itself', two.before === 0, two);
  check('a large tile asking reads them in: there at once, nothing drawn, no 3D chunk', two.got === 6 && two.stats.drawn === 0 && !two.chunk && two.ms < 3000, two);
  await ctx.close();
  rmSync(prof, { recursive: true, force: true });
  check('no page errors', errors.length === 0, errors.slice(0, 5));
}

for (const b of builds) await b.server.close();
done();
process.exit(0);
