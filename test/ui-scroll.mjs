// Scrolling, in Chromium at phone size with the CPU slowed 4x (CDP Emulation.setCPUThrottlingRate),
// with someone five weeks in: each main screen is scrolled at a fling's speed (CDP
// Input.synthesizeScrollGesture) down, up and down again, traced. Each screen reports:
// - dropped: the share of frames Chrome dropped while the page was scrolling (its own frame reporter,
//   the same one its smoothness metric counts)
// - draw: how long the GPU took to draw a frame (p95; blur and refraction are drawn here)
// - GPU and renderer: the CPU time each process spent per second of scrolling
// - blocking: the main thread's blocking time from long animation frames
// The best of the runs (by draw time) is kept.
//
// Headless Chromium draws the GPU's work in software (on the CPU), so a frame here costs far more
// than on a phone's GPU and every number is only good for comparing builds on the same machine. The
// budgets are what 1.7.0 reached plus a margin, to catch the next slowdown.
//
// At rest on Today, nothing may animate forever unless the compositor can run it alone (transform and
// opacity): anything else repaints every frame and keeps the phone from idling.
//
// Usage: node test/ui-scroll.mjs [--measure] [--dist=<dir>] [--vs=<dir>] [--runs=2] [--only=today,badges]
//   --measure  print the numbers only, no checks
//   --dist     a built page somewhere else (a copy of an older dist/), to compare on the same machine
//   --vs       another build to compare with, run by run in turn with this one (A/B, interleaved: the
//              machine's speed drifts from minute to minute, so builds measured apart can't be compared)
//   --ablate   switch one suspect off, to see what it costs: filters (every backdrop filter), lens (the
//              refraction only), glow (the moving background), mask (the glow's fade, as a mask),
//              shimmer (the progress bars' sheen), light (Refract's light following the scroll), edge
//              (the top bar's frosted edge), cv (the long pages' content-visibility), flat and frosted
//              (Settings' Glass effects), lite and litekeepglow (Flat's light state, with the
//              glow hidden or kept), noglass (no backdrop, lens or glass fill). With --vs, only
//              A is ablated: --dist=X --vs=X --ablate=lens is what the lens costs, A/B.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const measureOnly = process.argv.includes('--measure');
const RUNS = Math.max(1, Number(arg('runs', 2)));
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const ABLATE = arg('ablate', '');
const CPU = 4;

/* ---------------------------------------------------------------- budgets */
// Per screen, from 1.7.0's own numbers (--runs=3, best of 3, run by run with the build before its
// scrolling work, on the machine that set them). The GPU's draw time per frame, p95, in ms:
//   today 9.9 (before: 13.9), plan 10.5 (13.8), health 11.2 (13.9), progress 10.7 (14), you 9.3
//   (12.6), badges 8.4 (8.9), badges' Next up 7.4 (9.3), coach 7.4 (8.1), settings 7.8 (10.4),
//   set-up 6.6 (15.2)
// A budget is that plus 60%, rounded up, since a run here can be a third slower than the one before
// it. Frames dropped while scrolling: 0 to 0.5% (before: up to 3%, and 13% on Health in another
// session), so 10%.
const BUDGET = {
  droppedPct: 10,
  drawP95Ms: { today: 16, plan: 17, health: 18, progress: 18, you: 15, badges: 14, 'badges-next': 12, coach: 12, settings: 13, setup: 11 },
};

/* ---------------------------------------------------------------- the screens */
const SCREENS = ['today', 'plan', 'health', 'progress', 'you', 'badges', 'badges-next', 'coach', 'settings', 'setup']
  .filter((s) => !ONLY.length || ONLY.includes(s));

// In the page: go to a screen from Today.
async function show(page, id) {
  await page.evaluate(async (id) => {
    const U = window.GH.ui;
    if (['today', 'plan', 'health', 'progress', 'you'].includes(id)) U.go(id);
    else if (id === 'badges' || id === 'badges-next') U.open('badges');
    else if (id === 'coach') U.open('coach');
    else if (id === 'settings') U.open('settings');
    // Set-up's Your plan screen, one of its long ones, with its cards and lists (its first, About
    // you, fits the screen and doesn't scroll): its scroller is .ob-scroll.
    else if (id === 'setup') await U.editAnswers('plan');
  }, id);
  await page.waitForTimeout(900);
  if (id === 'badges-next') { await page.click('#screen [data-on="badgeFilter"] input[value="next"]', { force: true }); await page.waitForTimeout(600); }
  // Whatever moves after a route change settles (src/ui/motion.js).
  await page.evaluate(() => (window.GH.ui.motion && window.GH.ui.motion.settled ? window.GH.ui.motion.settled() : null)).catch(() => null);
  await page.waitForTimeout(700);
}

// What switches one suspect off (--ablate): CSS added once the page is up, or a script that runs
// before the page's own.
const ABLATIONS = {
  filters: { css: '*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}' },
  // Refract 1.4 refracts in the lens layer's backdrop filter (the --_lens map, between the blur and
  // the saturation): the same filter without it.
  lens: { css: '.rf-lens-layer{-webkit-backdrop-filter:blur(calc(var(--_blur) * .3 * var(--rf-mat, 1))) saturate(var(--_sat)) brightness(var(--rf-glass-bright))!important;backdrop-filter:blur(calc(var(--_blur) * .3 * var(--rf-mat, 1))) saturate(var(--_sat)) brightness(var(--rf-glass-bright))!important}' },
  glow: { css: '.app::before,.app::after{display:none!important;animation:none!important}' },
  mask: { css: '.app::before,.app::after{-webkit-mask-image:none!important;mask-image:none!important}' },
  shimmer: { css: '.rf-progress-fill::after{animation:none!important}' },
  edge: { css: '.topbar>.rf-scroll-edge{display:none!important}' },
  cv: { css: '*{content-visibility:visible!important}' },
  // Settings, Look, Glass effects: the two lighter modes, set the way the setting sets them.
  flat: { css: '', pref: { glass: 'flat' } },
  frosted: { css: '', pref: { glass: 'frosted' } },
  // Flat's light state (data-glass-lite, core.js: no backdrop, no lenses, the glow hidden), and
  // the same with the glow kept.
  lite: { css: '', attr: 'data-glass-lite' },
  litekeepglow: { css: '', attr: 'data-glass-lite', attr2: 'data-gx-keepglow' },
  // The glass without the glow behind it that Frosted and Flat hide as well (reduced transparency).
  noglass: { css: '*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}.rf-lens-layer{display:none!important}.rf-glass[data-lens-ready]{background-color:var(--glass-fill-solid,var(--bg-raised))!important}' },
  // Refract's light hears every scroll on the window (in the capture phase) and then reads where each
  // glass it lights is, a frame at a time: without that listener.
  light: {
    script() {
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, fn, o) {
        if (this === window && type === 'scroll' && o && (o === true || o.capture)) return undefined;
        return add.call(this, type, fn, o);
      };
    },
  },
};
if (ABLATE && !ABLATIONS[ABLATE]) { console.error(`--ablate: one of ${Object.keys(ABLATIONS).join(', ')}`); process.exit(1); }

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
function asyncBridge() {
  if (window.AndroidBridge) window.AndroidBridge.saveAsync = () => true;
}

// The build measured (checked against the budgets), and with --vs the one it's compared with.
const builds = [{ name: arg('dist', '') ? `${arg('dist', '')}` : 'dist', server: await serve(arg('dist', '')) }];
if (arg('vs', '')) builds.push({ name: arg('vs', ''), server: await serve(arg('vs', '')) });
const server = builds[0].server;
const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' };
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] : 0; };
const r1 = (x) => Math.round(x * 10) / 10;

// CPU time (ms) of this browser's GPU and renderer processes, from /proc (Linux; elsewhere nothing).
// Only this test's own (the processes under this node process): another Chromium running on the
// same machine (a test in another checkout) isn't counted.
function cpu() {
  const out = {};
  let dirs = [];
  try { dirs = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch (e) { return out; }
  const info = new Map(); // pid → [parent pid, utime + stime in ms, process type]
  for (const d of dirs) {
    try {
      const f = readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ');
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      const type = /chrom|headless_shell/i.test(cmd) ? (cmd.match(/--type=(gpu-process|renderer)/) || [])[1] : null;
      info.set(Number(d), [Number(f[1]), (Number(f[11]) + Number(f[12])) * 10, type]);
    } catch (e) { /* gone */ }
  }
  const mine = (pid) => { for (let p = pid, n = 0; p > 1 && n < 64; n++) { if (p === process.pid) return true; const i = info.get(p); if (!i) return false; p = i[0]; } return false; };
  for (const [pid, [, ms, type]] of info) if (type && mine(pid)) out[type] = (out[type] || 0) + ms;
  return out;
}

// The state: five weeks of history, built by the app itself on a first run. The flat exercise
// figure: the 3D one's warm-up runs in software here (seconds a phone's GPU doesn't spend).
let stateJson;
{
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  watch(page);
  await page.addInitScript(seedBridge);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.evaluate(() => { if (window.GH.store.flush) window.GH.store.flush(); });
  stateJson = await page.evaluate(() => sessionStorage.getItem('shot-state'));
  await ctx.close();
}
if (!stateJson || stateJson.length < 1000) { console.error('Couldn\'t seed the state.'); process.exit(1); }
const flatJson = (() => { const S = JSON.parse(stateJson); S.profile.prefs.figure = 'flat'; S.profile.prefs.glass = 'liquid'; return JSON.stringify(S); })();

async function open(build) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  const ab = ABLATE && build === builds[0] ? ABLATIONS[ABLATE] : null;
  const seed = ab && ab.pref ? (() => { const S = JSON.parse(flatJson); Object.assign(S.profile.prefs, ab.pref); return JSON.stringify(S); })() : flatJson;
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, seed);
  if (ab && ab.script) await ctx.addInitScript(ab.script);
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(build.server.url);
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 60000 });
  // What's new and anything else that opens itself after launch.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.GH.ui.closeSheets && window.GH.ui.closeSheets());
  await page.waitForTimeout(500);
  if (ab && ab.css) await page.addStyleTag({ content: ab.css });
  if (ab && ab.attr) await page.evaluate((a) => { for (const x of a) document.documentElement.setAttribute(x, ''); }, [ab.attr, ab.attr2].filter(Boolean));
  return { ctx, page, cdp };
}

// Three scrolls (down, up, down) at 4x CPU, traced. Headless Chromium doesn't scroll for a
// synthesized touch gesture, so these are smooth wheel scrolls at a fling's speed: both scroll on the
// compositor and redraw the same glass every frame.
async function scroll(page, cdp) {
  await page.evaluate(() => {
    const F = window.__scroll = { loaf: [] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) F.loaf.push(e.blockingDuration || 0); }).observe({ type: 'long-animation-frame' }); } catch (e) { /* not supported */ }
    // How far the scroller went: a scroll that moved nothing measures nothing.
    const sc = document.querySelector('.onboard:not([hidden]) .ob-scroll') || document.getElementById('screen');
    F.start = sc.scrollTop; F.max = 0;
    sc.addEventListener('scroll', () => { F.max = Math.max(F.max, Math.abs(sc.scrollTop - F.start)); }, { passive: true });
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await browser.startTracing(page, { categories: ['cc', 'benchmark', 'disabled-by-default-devtools.timeline.frame'] });
  const c0 = cpu();
  const t0 = Date.now();
  for (const dy of [-2400, 2400, -2400]) {
    await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 520, xDistance: 0, yDistance: dy, speed: 2400, gestureSourceType: 'mouse' });
    await new Promise((r) => setTimeout(r, 300));
  }
  const secs = (Date.now() - t0) / 1000;
  const c1 = cpu();
  const trace = JSON.parse((await browser.stopTracing()).toString());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const evs = trace.traceEvents || trace;
  // Frames while scrolling: presented (all or partly) or dropped.
  let presented = 0, dropped = 0;
  for (const e of evs) {
    const fr = e.name === 'PipelineReporter' && e.ph === 'b' && e.args && e.args.frame_reporter;
    if (!fr || fr.scroll_state === 'SCROLL_NONE' || fr.scroll_state === undefined) continue;
    if (fr.state === 'STATE_DROPPED') dropped++;
    else if (/^STATE_PRESENTED/.test(fr.state)) presented++;
  }
  // The GPU's draw of each frame: begin and end of StartDrawToSwapStart, paired by id.
  const open = new Map(), draws = [];
  for (const e of evs) {
    if (e.name !== 'StartDrawToSwapStart') continue;
    const key = `${e.pid}:${(e.id2 && (e.id2.local || e.id2.global)) || e.id}`;
    if (e.ph === 'b') open.set(key, e.ts);
    else if (e.ph === 'e' && open.has(key)) { draws.push((e.ts - open.get(key)) / 1000); open.delete(key); }
  }
  const page2 = await page.evaluate(() => ({ moved: window.__scroll.max, blocking: window.__scroll.loaf.reduce((s, x) => s + x, 0) }));
  const per = (k) => ((c1[k] || 0) - (c0[k] || 0)) / secs;
  return { presented, dropped, droppedPct: (100 * dropped) / Math.max(1, presented + dropped), drawP95: pct(draws, 0.95), drawMean: draws.reduce((s, x) => s + x, 0) / Math.max(1, draws.length), gpu: per('gpu-process'), renderer: per('renderer'), ...page2 };
}

// What animates forever at rest that the compositor can't run on its own.
async function idleAnimations(page) {
  return page.evaluate(() => document.getAnimations().filter((a) => {
    if (a.playState !== 'running') return false;
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    if (t.iterations !== Infinity) return false;
    const props = new Set();
    for (const k of (a.effect.getKeyframes ? a.effect.getKeyframes() : [])) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) props.add(p);
    return [...props].some((p) => p !== 'transform' && p !== 'opacity');
  }).map((a) => {
    const el = a.effect.target;
    const name = a.animationName || a.id || 'animation';
    return `${name} on ${el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}` : '?'}${a.effect.pseudoElement || ''}`;
  }));
}

section(`Scrolling (CPU ${CPU}x slower, best of ${RUNS}${ABLATE ? `, without ${ABLATE}` : ''}${builds.length > 1 ? `; A: ${builds[0].name}, B: ${builds[1].name}, in turn` : ''})`);
const results = builds.map(() => ({}));
let idle = null;
const line = (b, runs) => `dropped ${r1(b.droppedPct)}% of ${b.presented + b.dropped} frames, draw p95 ${r1(b.drawP95)} ms (mean ${r1(b.drawMean)}), GPU ${Math.round(b.gpu)} ms/s, renderer ${Math.round(b.renderer)} ms/s, blocking ${Math.round(b.blocking)} ms, moved ${Math.round(b.moved)} px (runs: ${runs.map((x) => `${r1(x.drawP95)} ms, ${r1(x.droppedPct)}%`).join('; ')})`;
for (const id of SCREENS) {
  const runs = builds.map(() => []);
  // Run by run, each build in turn (A, B, A, B...), so a slower minute falls on both.
  for (let i = 0; i < RUNS; i++) {
    for (let k = 0; k < builds.length; k++) {
      const { ctx, page, cdp } = await open(builds[k]);
      await show(page, id);
      if (k === 0 && id === 'today' && idle === null) idle = await idleAnimations(page);
      runs[k].push(await scroll(page, cdp));
      await ctx.close();
    }
  }
  builds.forEach((_, k) => {
    const b = runs[k].reduce((m, x) => (x.drawP95 < m.drawP95 ? x : m), runs[k][0]);
    results[k][id] = b;
    console.log(`  ${id}${builds.length > 1 ? ` ${'AB'[k]}` : ''}: ${line(b, runs[k])}`);
  });
}
console.log(`  idle on Today: ${idle && idle.length ? idle.join('; ') : 'nothing animating forever that the compositor can\'t run'}`);
const summary = (res) => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { dropped: r1(v.droppedPct), drawP95: r1(v.drawP95), gpu: Math.round(v.gpu), renderer: Math.round(v.renderer), blocking: Math.round(v.blocking) }]));
builds.forEach((b, k) => console.log(`  json${builds.length > 1 ? ` ${'AB'[k]}` : ''}: ${JSON.stringify(summary(results[k]))}`));
if (builds.length > 1) {
  // B to A, screen by screen: draw p95, frames dropped, GPU time a second.
  const ch = (b, a) => (b ? `${a < b ? '' : '+'}${Math.round((100 * (a - b)) / b)}%` : '');
  console.log(`  B → A (${builds[1].name} → ${builds[0].name}):`);
  for (const id of SCREENS) {
    const a = results[0][id], b = results[1][id];
    console.log(`    ${id}: draw p95 ${r1(b.drawP95)} → ${r1(a.drawP95)} ms (${ch(b.drawP95, a.drawP95)}), dropped ${r1(b.droppedPct)} → ${r1(a.droppedPct)}%, GPU ${Math.round(b.gpu)} → ${Math.round(a.gpu)} ms/s (${ch(b.gpu, a.gpu)}), renderer ${Math.round(b.renderer)} → ${Math.round(a.renderer)} ms/s`);
  }
}

if (!measureOnly) {
  for (const [id, v] of Object.entries(results[0])) {
    check(`${id}: the scroll moved the page`, v.moved > 300, `${Math.round(v.moved)} px`);
    check(`${id}: ${BUDGET.droppedPct}% of frames or fewer dropped while scrolling`, v.droppedPct <= BUDGET.droppedPct, `${r1(v.droppedPct)}%`);
    const draw = BUDGET.drawP95Ms[id];
    check(`${id}: a frame draws in ${draw} ms or less (p95)`, v.drawP95 <= draw, `${r1(v.drawP95)} ms`);
  }
  if (idle !== null) check('at rest on Today, nothing animates forever that the compositor can\'t run alone', idle.length === 0, idle);
}

/* ---------------------------------------------------------------- touch */
// A phone scrolls by touch, and the wheel scrolls above don't show all of it. Here: real touch flings
// (CDP Input.dispatchTouchEvent; Chromium turns them into a scroll and a fling as on a phone), on a
// page opened and driven through raw CDP only. Playwright's own page helpers inject a script that puts
// a blocking touchstart listener on the window, which by itself makes any page scroll on the main
// thread (a plain page too), so they aren't used on these pages.
// Each screen: two flings down and one up, traced, best of the runs. Checks:
// - no blocking touch or wheel listener on the window or the document (the app's are all passive)
// - the page scrolls on the compositor (the frame reporter's scroll state), never the main thread
// - frames dropped while it moves, within the budget
// On Today, while it moves: the bottom glass's bend is off (the tab bar's and the floating buttons'
// lens, faded out and taken off), its frost isn't, and the top bar's buttons keep theirs; once it
// stops, all of it is as it was. And Refract's light no longer hears each scroll.
// Budgets, dropped frames while touch-scrolling (best of 2, 1.8.2's numbers at 4x CPU, 390 x 844 at
// 3x, plus about a half; 1.8.1 dropped about 31% on Today, 29% on Health, 31% on Plan, 27% on You,
// 18% on Progress):
const TOUCH_BUDGET = { today: 28, health: 24, plan: 24, you: 21, progress: 9 };
const TOUCH = Object.keys(TOUCH_BUDGET).filter((s) => !ONLY.length || ONLY.includes(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The touch pages draw with Chromium's GPU path (SwiftShader standing in for a phone's GPU), as a
// phone does: without it the glass is drawn by the software compositor, at a cost unlike a phone's.
let gpuBrowser = null;
async function openRaw(build, prefs) {
  if (!gpuBrowser) gpuBrowser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await gpuBrowser.newContext({ ...ctxOpts, deviceScaleFactor: 3 });
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  const seed = prefs ? (() => { const S = JSON.parse(flatJson); Object.assign(S.profile.prefs, prefs); return JSON.stringify(S); })() : flatJson;
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, seed);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: build.server.url });
  for (let i = 0; i < 120; i++) { await sleep(500); if (await ev("!!document.querySelector('#screen[data-view=\"today\"] .session')").catch(() => false)) break; }
  await sleep(1500);
  await ev('(window.GH.ui.closeSheets && window.GH.ui.closeSheets(), 1)');
  await sleep(500);
  return { ctx, page, cdp, ev };
}
// A finger dragging dy px over 15 moves a frame apart, then lifted: a fling.
async function fling(cdp, y0, dy) {
  let t = Date.now() / 1000;
  const send = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y, id: 1 }], timestamp: t });
  await send('touchStart', y0);
  for (let i = 1; i <= 15; i++) { t += 0.016; await send('touchMove', y0 + (dy * i) / 15); await sleep(16); }
  t += 0.016;
  await send('touchEnd', y0 + dy);
}
async function blockingListeners(cdp) {
  const out = [];
  for (const expr of ['window', 'document']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    for (const l of listeners) if (/^(touch|wheel|mousewheel)/.test(l.type) && !l.passive) out.push(`${expr} ${l.type}`);
  }
  return out;
}
async function touchScroll(build, id) {
  const { ctx, page, cdp, ev } = await openRaw(build);
  await ev(`(() => { const U = window.GH.ui; const id = ${JSON.stringify(id)}; if (id !== 'today') U.go(id); return 1; })()`);
  await sleep(2500);
  const blocking = await blockingListeners(cdp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await gpuBrowser.startTracing(page, { categories: ['cc', 'benchmark', 'disabled-by-default-devtools.timeline.frame'] });
  for (const [y0, dy] of [[650, -400], [650, -400], [250, 500]]) { await fling(cdp, y0, dy); await sleep(1500); }
  const evs = (JSON.parse((await gpuBrowser.stopTracing()).toString()).traceEvents) || [];
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  let dropped = 0, presented = 0, mainThread = 0, compositor = 0;
  for (const e of evs) {
    const fr = e.name === 'PipelineReporter' && e.ph === 'b' && e.args && e.args.frame_reporter;
    if (!fr || !fr.scroll_state || fr.scroll_state === 'SCROLL_NONE') continue;
    if (fr.scroll_state === 'SCROLL_MAIN_THREAD') mainThread++; else compositor++;
    if (fr.state === 'STATE_DROPPED') dropped++; else if (/^STATE_PRESENTED/.test(fr.state)) presented++;
  }
  const moved = await ev('document.getElementById("screen").scrollTop');
  await ctx.close();
  return { blocking, dropped, presented, droppedPct: (100 * dropped) / Math.max(1, dropped + presented), mainThread, compositor, moved };
}
if (TOUCH.length) {
  section(`Touch scrolling (CPU ${CPU}x slower, at 3x, best of ${RUNS})`);
  for (const id of TOUCH) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await touchScroll(builds[0], id));
    const b = runs.reduce((m, x) => (x.droppedPct < m.droppedPct ? x : m), runs[0]);
    console.log(`  ${id}: dropped ${r1(b.droppedPct)}% of ${b.dropped + b.presented} frames, ${b.compositor} frames scrolled on the compositor, ${b.mainThread} on the main thread (runs: ${runs.map((x) => `${r1(x.droppedPct)}%`).join(', ')})`);
    if (!measureOnly) {
      check(`${id}: no blocking touch or wheel listener on the page`, b.blocking.length === 0, b.blocking);
      check(`${id}: a touch scroll runs on the compositor, never the main thread`, b.compositor > 20 && b.mainThread === 0, b);
      check(`${id}: ${TOUCH_BUDGET[id]}% of frames or fewer dropped while touch-scrolling`, b.droppedPct <= TOUCH_BUDGET[id], `${r1(b.droppedPct)}%`);
    }
  }
}

/* ---------------------------------------------------------------- deferred work after a scroll */
// On a phone a touch's scroll waits for the page's thread (filmed on one: three flicks in a row froze
// for 100 to 330 ms each, with the page's thread busy under the finger, a 3D still's encode or a
// re-render that the "calm" moment after the last scroll had let loose). So the heavy deferred work
// (3D stills, the 3D chunk and its warm-up, background re-renders) waits for quiet (U.whenQuiet,
// 1.5 s with nothing happening, core.js) rather than calm (0.4 s), a held finger is never calm, and a
// still's encoding runs off the thread (figure3d's stillAsync). Here, with the 3D figure warm, Plan is
// opened by a tap on its tab, as on the phone (its tiles queue a 3D still each; the tap is the last
// input) and flung 400 ms on; then, from the flick until 1.1 s after the page stops moving (the window
// in which the next flick comes), the page's long animation frames must carry no task of 120 ms or
// more, and left alone after, the tiles must still get their stills. A frame's blocking time is the
// part of any one task over 50 ms: a software GPU makes frames long here with no task to blame, and
// those count for nothing. The time from the flick to the stop is reported, not held: a frozen fling
// runs long (the thread's work holds the scroll's end), but so does one on a loaded machine. (1.8.2
// fails this: its first 3D still comes at "calm", 400 ms after the tap, and a shader compile and a
// toDataURL encode held the thread 1 to 2 s at 4x in mid-fling, 0.2 s after the flick.)
if (!measureOnly && (!ONLY.length || ONLY.includes('plan'))) {
  section('Deferred work after a scroll');
  if (!gpuBrowser) gpuBrowser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await gpuBrowser.newContext({ ...ctxOpts, deviceScaleFactor: 3 });
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, stateJson);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: builds[0].server.url });
  for (let i = 0; i < 120; i++) { await sleep(500); if (await ev("!!document.querySelector('#screen[data-view=\"today\"] .session')").catch(() => false)) break; }
  await sleep(1500);
  await ev('(window.GH.ui.closeSheets && window.GH.ui.closeSheets(), 1)');
  // The figure warms up now (it would on its own 8 s after launch).
  await ev('(window.GH.ui.warmFigure(), 1)');
  let warm = false;
  for (let i = 0; i < 180 && !warm; i++) { await sleep(500); warm = await ev('!!(window.GH.figure3d && window.GH.figure3d.warm())').catch(() => false); }
  check('the 3D figure warms up', warm);
  await sleep(2000);
  await ev(`(() => { const L = window.__loaf = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) L.push({ t: Math.round(e.startTime), d: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), scripts: (e.scripts || []).filter((x) => x.duration >= 20).map((x) => \`\${x.invoker || ''} \${x.sourceFunctionName || ''}@\${x.sourceCharPosition} \${Math.round(x.duration)} ms\`) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { /* unsupported */ } return 1; })()`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Plan, by a tap on its tab, and a fling 400 ms after it's in (its tiles have queued a 3D still each).
  const tab = await ev(`(() => { const r = document.querySelector('#tabbar .rf-tab[data-tab="plan"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tab[0], y: tab[1], id: 1 }] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  let onPlan = false;
  for (let i = 0; i < 40 && !onPlan; i++) { await sleep(50); onPlan = await ev("!!document.querySelector('#screen[data-view=\"plan\"] .pw-thumb[data-move]')"); }
  check('a tap on the Plan tab opens Plan', onPlan);
  await sleep(400);
  const flick = await ev('performance.now()');
  await fling(cdp, 650, -400);
  // The page stops moving (data-scrolling goes 150 ms after the last scroll): from there, 1.1 s.
  let stopped = null;
  for (let i = 0; i < 100 && stopped === null; i++) { await sleep(50); if (!(await ev("document.getElementById('app').hasAttribute('data-scrolling')"))) stopped = await ev('performance.now()'); }
  await sleep(1100);
  const end = (stopped === null ? flick + 5000 : stopped) + 1100;
  const after = await ev(`window.__loaf.filter((x) => x.t + x.d > ${flick} && x.t < ${end})`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const blocking = after.reduce((m, x) => Math.max(m, x.block), 0);
  // At 4x CPU: a task of 120 ms (blocking 70) is about 30 ms on the phone, a frame or two.
  check(`the fling ends (${stopped === null ? 'never' : `${Math.round(stopped - flick)} ms after the flick`})`, stopped !== null, stopped);
  check('from the flick until 1.1 s after the page stops, no task holds the page\'s thread for 120 ms or more (4x CPU)', blocking < 70, `frames (start after the flick, ms, blocking, scripts): ${JSON.stringify(after.filter((x) => x.block > 0).map((x) => ({ ...x, t: x.t - Math.round(flick) })).slice(0, 8))}`);
  const quietAt = await ev('(() => { const U = window.GH.ui; return U.quiet ? U.quiet() : null; })()');
  check('it isn\'t "quiet" yet (deferred work waits 1.5 s after the last scroll)', quietAt === false, quietAt);
  // Left alone, the tiles get their 3D stills.
  let drawn3d = 0;
  for (let i = 0; i < 60 && !drawn3d; i++) { await sleep(500); drawn3d = await ev("document.querySelectorAll('#screen .pw-thumb[data-move] > img').length").catch(() => 0); }
  check('left alone, Plan\'s tiles get their 3D stills', drawn3d > 0, drawn3d);
  await ctx.close();
}

/* ---------------------------------------------------------------- glass effects: Auto */
// Auto (the default, core.js "glass while the page moves"): the glass as designed at rest and as light
// as Flat while the page moves, from the first few pixels of a vertical drag until half a second
// after the page stops. Reported on a phone: the scroll doesn't start until the finger lifts, or
// freezes in a fling and jumps, with the glass on, and Flat fixes it. Here: a tap never lightens the
// glass; a drag does, within a frame or two, takes every backdrop filter off (the tab bar, the
// floating buttons, the bar's frosted edge, the lenses) and puts them back when the page has been
// still for half a second; a tab change doesn't flash it. (Liquid, Frosted, Flat and the glass speed
// test: the next section.)
if (!measureOnly && (!ONLY.length || ONLY.includes('today'))) {
  section('Glass effects: Auto lightens the glass while the page moves');
  const { ctx, cdp, ev } = await openRaw(builds[0], { glass: 'auto' });
  await ev(`(() => { const L = window.__lite = []; const root = document.documentElement; new MutationObserver(() => { L.push([Math.round(performance.now()), root.hasAttribute('data-glass-lite')]); }).observe(root, { attributes: true, attributeFilter: ['data-glass-lite'] }); return 1; })()`);
  const backdrops = () => ev(`(() => {
    const f = (el) => (el ? getComputedStyle(el).backdropFilter : 'none');
    const q = (s) => document.querySelector(s);
    const edge = q('#topbar > .rf-scroll-edge');
    return {
      lite: document.documentElement.hasAttribute('data-glass-lite'),
      tabbar: f(q('#tabbar .rf-tabbar-bar')), lens: (() => { const l = q('#tabbar .rf-glass > .rf-lens-layer, #tabbar .rf-tabbar-bar .rf-lens-layer'); return l ? getComputedStyle(l).display + ' ' + f(l) : 'none'; })(),
      floats: Array.from(document.querySelectorAll('#float .rf-glass'), (g) => getComputedStyle(g).backgroundColor).join(' | '),
      glow: getComputedStyle(document.querySelector('.app'), '::before').display,
      glowVis: getComputedStyle(document.querySelector('.app'), '::before').visibility,
      state: window.GH.ui.glassState(),
    };
  })()`);
  const atRest = await backdrops();
  check('at rest: not light, the tab bar has its lens, the glow is there', !atRest.lite && atRest.state.mode === 'auto' && /url\(/.test(atRest.lens) && atRest.glow !== 'none' && atRest.glowVis !== 'hidden', atRest);
  // A tap on the page, and on a tab: never light.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
  const tabXY = await ev(`(() => { const r = document.querySelector('#tabbar .rf-tab[data-tab="plan"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tabXY[0], y: tabXY[1], id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1500);
  const afterTaps = await ev('window.__lite');
  check('a tap on the page and a tab change never lighten the glass', afterTaps.length === 0, afterTaps);
  // A drag: light within a frame or two of the first pixels, nothing backdrop-filtered while it moves.
  const t0 = await ev('performance.now()');
  await fling(cdp, 650, -400);
  await sleep(120);
  const during = await backdrops();
  const first = (await ev('window.__lite')).find((x) => x[1]);
  check('a drag lightens it: within 150 ms of the first move', !!first && first[0] - t0 < 150 + 15 * 16, { first, t0 });
  check('while it moves: no lens, no backdrop on the tab bar, solid fills, the glow hidden (what Flat is)', during.lite && /^none/.test(during.lens) && during.tabbar === 'none' && during.glowVis === 'hidden', during);
  // Then half a second after the page has stopped (a fling lasts a while: wait for the end).
  let rested = false;
  for (let i = 0; i < 80 && !rested; i++) { await sleep(100); rested = await ev("!document.documentElement.hasAttribute('data-glass-lite')"); }
  await sleep(300);
  const back = await backdrops();
  const lite = await ev('window.__lite');
  const lastOn = lite.filter((x) => x[1]).pop(), lastOff = lite.filter((x) => !x[1]).pop();
  check('it comes back once the page has been still for half a second', rested && !back.lite && /url\(/.test(back.lens) && back.glowVis !== 'hidden' && back.tabbar === atRest.tabbar && lastOff && lastOff[0] - lastOn[0] >= 450, { lite, back });
  check('and one drag was one stretch of it, not a flicker', lite.length === 2, lite);
  // A second flick right after the first: it stays light through both.
  const n0 = (await ev('window.__lite')).length;
  await fling(cdp, 650, -300);
  await sleep(250);
  await fling(cdp, 650, 300);
  await sleep(150);
  const midTwo = await ev('window.GH.ui.glassState()');
  check('two flicks 250 ms apart are one stretch: light the whole time', midTwo.lite && (await ev('window.__lite')).length - n0 === 1, { midTwo, events: (await ev('window.__lite')).slice(n0) });
  for (let i = 0; i < 80 && (await ev("document.documentElement.hasAttribute('data-glass-lite')")); i++) await sleep(100);
  // A scroll the page makes by itself (a tab's position coming back, a scrollIntoView) never counts.
  await sleep(1200);
  const n1 = (await ev('window.__lite')).length;
  await ev("(() => { const s = document.getElementById('screen'); s.scrollTop = 120; return 1; })()");
  await sleep(900);
  check('a scroll the page makes by itself never lightens the glass', (await ev('window.__lite')).length === n1, (await ev('window.__lite')).slice(n1));
  await ctx.close();
}

/* ---------------------------------------------------------------- glass effects: Liquid */
// Liquid (core.js "glass while the page moves"): the glass as designed, at rest and while the page
// moves. 1.8.6 made it the default (the phone still stuttered while the page moved, so Auto is the
// default again). What it drew when nothing it showed had changed is gone, in every mode: Refract's light hears no tilt (each step of it
// repainted every rim and had every backdrop filtered again, all the time in a hand), and the glow
// holds still while the app is in use (#app[data-in-use]: any input in the last 3 s), drifting once
// it's left alone. Here: the light doesn't move however the phone tilts; a drag keeps the glass
// (its frost, the tab bar's backdrop, the glow); a touch holds the glow still and 3 s without one
// lets it drift; Frosted and Flat are what they were; the glass speed test still times its looks.
if (!measureOnly && (!ONLY.length || ONLY.includes('today'))) {
  section('Glass effects: Liquid keeps its look and draws nothing while nothing changes');
  const { ctx, cdp, ev } = await openRaw(builds[0], { glass: 'liquid' });
  const backdrops = () => ev(`(() => {
    const f = (el) => (el ? getComputedStyle(el).backdropFilter : 'none');
    const q = (s) => document.querySelector(s);
    const drift = document.getAnimations().filter((a) => /^glow-drift/.test(a.animationName || '')).map((a) => a.playState);
    return {
      lite: document.documentElement.hasAttribute('data-glass-lite'),
      tabbar: f(q('#tabbar .rf-tabbar-bar')), lens: (() => { const l = q('#tabbar .rf-glass > .rf-lens-layer, #tabbar .rf-tabbar-bar .rf-lens-layer'); return l ? getComputedStyle(l).display + ' ' + f(l) : 'none'; })(),
      glow: getComputedStyle(document.querySelector('.app'), '::before').display,
      glowVis: getComputedStyle(document.querySelector('.app'), '::before').visibility,
      inUse: document.getElementById('app').hasAttribute('data-in-use'),
      drift: drift.join(' '),
      state: window.GH.ui.glassState(),
    };
  })()`);
  const atRest = await backdrops();
  check('Liquid: the tab bar\'s glass has its blur and lens, the glow is there, nothing light', atRest.state.mode === 'liquid' && !atRest.lite && /^block blur\(.*url\(/.test(atRest.lens) && atRest.glow !== 'none' && atRest.glowVis !== 'hidden', atRest);
  // The light: however the phone tilts, the rims stay where they are, and the sensor isn't asked for.
  const light = await ev(`(async () => {
    const g = document.querySelector('#tabbar .rf-tabbar-bar'), L = window.Refract.light;
    const before = L.current(g);
    for (let i = 0; i < 30; i++) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 20 + i * 2, gamma: -30 + i * 2, absolute: false })); await new Promise((r) => setTimeout(r, 16)); }
    await new Promise((r) => setTimeout(r, 500));
    return { before: Math.round(before), after: Math.round(L.current(g)), asks: typeof DeviceOrientationEvent.requestPermission === 'function' };
  })()`);
  check('Refract\'s light hears no tilt: the rims stay at their angle however the phone turns', light.asks && light.before === light.after, light);
  // A drag: the glass stays as it is (no light state), the bottom glass's lens fading as before.
  await fling(cdp, 650, -400);
  await sleep(120);
  const during = await backdrops();
  check('while the page moves: still glass (the tab bar\'s frost, its lens fading out, the glow there), nothing light', !during.lite && /^block blur\(/.test(during.lens) && during.glowVis !== 'hidden' && during.glow !== 'none', during);
  check('and the glow holds still meanwhile, the app in use', during.inUse && !/running/.test(during.drift), during);
  for (let i = 0; i < 60 && (await ev("document.getElementById('app').hasAttribute('data-scrolling')")); i++) await sleep(100);
  // In use, then left alone: 3 s after the last input the glow drifts again, and a touch stops it.
  let alone = null;
  for (let i = 0; i < 60; i++) { await sleep(100); const b = await backdrops(); if (!b.inUse) { alone = b; break; } }
  await sleep(200);
  const drifting = await backdrops();
  check('3 s after the last input the app isn\'t in use any more, and the glow drifts', !!alone && !drifting.inUse && /running/.test(drifting.drift), { alone, drifting });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }] });
  await sleep(60);
  const touched = await backdrops();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('a touch holds it still again at once', touched.inUse && !/running/.test(touched.drift), touched);
  // The other modes, set the way Settings sets them, and back.
  const modeCheck = async (mode) => {
    await ev(`(window.GH.ui.on.setGlass(null, null, ${JSON.stringify(mode)}), 1)`);
    await sleep(300);
    await fling(cdp, 650, -300);
    await sleep(150);
    const mid = await backdrops();
    for (let i = 0; i < 60 && (await ev("document.getElementById('app').hasAttribute('data-scrolling')")); i++) await sleep(100);
    await sleep(300);
    return { mid, rest: await backdrops() };
  };
  const frosted = await modeCheck('frosted');
  check('Frosted: the blur without the lens, the glow kept, never light', frosted.mid.state.mode === 'frosted' && !frosted.mid.lite && /^none/.test(frosted.rest.lens) && /blur\(/.test(frosted.rest.tabbar) && frosted.rest.glow !== 'none', frosted);
  const flat = await modeCheck('flat');
  check('Flat: light always, with the glow hidden', flat.mid.lite && flat.rest.lite && /^none/.test(flat.rest.lens) && flat.rest.glow === 'none', flat);
  const back = await modeCheck('liquid');
  check('and Liquid again: as at the start', back.rest.state.mode === 'liquid' && !back.rest.lite && /url\(/.test(back.rest.lens) && back.rest.glow !== 'none', back.rest);
  // The glass speed test (src/ui/diag.js): each look timed, and the setting's own look put back after.
  const speedRes = await ev(`(async () => {
    const root = document.documentElement, A = ['data-gx-nolens', 'data-gx-noedge', 'data-gx-noglow', 'data-glass-lite', 'data-rf-transparency'];
    const before = JSON.stringify(window.GH.ui.glassState()), t0 = performance.now();
    const r = await window.GH.diag.speedTest({ ms: 400, settle: 100 });
    const held = window.GH.diag._streams().L.filter((x) => x[0] >= t0).map((x) => [Math.round(x[0] - t0), x[1], x[3]]);
    return { rows: r.rows.map((x) => [x.id, x.n, x.fps, x.p95]), stopped: r.stopped, held, before, after: JSON.stringify(window.GH.ui.glassState()), attrs: A.filter((a) => root.hasAttribute(a)), report: window.GH.diag.report().split('\\n').filter((l) => /Glass speed test|smoothest|fps/.test(l)) };
  })()`);
  check('the glass speed test times six looks and puts everything back', speedRes.rows.length === 6 && speedRes.rows.every(([, n]) => n > 5) && !speedRes.stopped && speedRes.before === speedRes.after && speedRes.attrs.length === 0, speedRes);
  check('and the report carries its table, with the smoothest marked', speedRes.report.length >= 7 && speedRes.report.some((l) => /smoothest/.test(l)), speedRes.report);
  await ev('(window.__abortRun = window.GH.diag.speedTest({ ms: 2500, settle: 100 }).then((r) => { window.__aborted = r; }), 1)');
  await sleep(1900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  let aborted = null;
  for (let i = 0; i < 100 && !aborted; i++) { await sleep(100); aborted = await ev('window.__aborted ? { stopped: window.__aborted.stopped, rows: window.__aborted.rows.length } : null'); }
  await sleep(300);
  check('a touch stops it, and everything is put back', !!aborted && aborted.stopped && aborted.rows < 6 && (await ev("['data-gx-nolens', 'data-gx-noedge', 'data-gx-noglow', 'data-gx-keepglow', 'data-glass-lite'].filter((a) => document.documentElement.hasAttribute(a)).length")) === 0, aborted);
  await ctx.close();
}

/* ---------------------------------------------------------------- while scrolling, and at rest */
// While the page moves, the glass at the bottom loses its bend (faded out, then the lens taken off:
// src/ui/core.js, bend) and keeps its frost; the top bar's buttons keep their lens (1.7.0 dropped
// every lens for the scroll, and the title went sharp under them); once the page stops it's all as it
// was. Refract's light doesn't hear each scroll. The glow holds still while the app is in use (any
// input in the last 3 s), drifts once it's left alone, and stops again 20 s after the last input
// (src/styles/perf.css, src/ui/core.js).
if (!measureOnly) {
  section('While scrolling, and at rest');
  {
    const { ctx, cdp, ev } = await openRaw(builds[0]);
    const glass = () => ev(`[...document.querySelectorAll('#tabbar .rf-tabbar-bar, #float .rf-glass, #topbar .rf-glass')].filter((g) => g.querySelector(':scope > .rf-lens-layer')).map((g) => {
      const f = getComputedStyle(g.querySelector(':scope > .rf-lens-layer')).backdropFilter;
      const id = (/#([\\w-]+)/.exec(g.style.getPropertyValue('--_lens')) || [])[1], fe = id && document.getElementById(id) && document.getElementById(id).querySelector('feDisplacementMap');
      return { where: g.closest('#tabbar, #float, #topbar').id, lens: /url\\(/.test(f), frost: /blur\\(/.test(f), scale: fe ? fe.getAttribute('scale') : null };
    })`);
    const atRest = await glass();
    // Mid-fling, after the finger has lifted (a pause in the drag would be the scroll ending).
    await fling(cdp, 650, -400);
    await sleep(150);
    const moving = await glass();
    await sleep(2500);
    const after = await glass();
    const by = (list, w) => (list || []).filter((x) => x.where === w);
    check('at rest, the tab bar, the floating buttons and the top bar\'s buttons bend (a lens in their glass)', ['tabbar', 'float', 'topbar'].every((w) => by(atRest, w).some((x) => x.lens)), atRest);
    check('while the page moves, the tab bar and the floating buttons have no bend, and keep their frost', ['tabbar', 'float'].every((w) => by(moving, w).length && by(moving, w).every((x) => !x.lens && x.frost && Number(x.scale) === 0)), moving);
    check('and the top bar\'s buttons keep theirs', by(moving, 'topbar').length > 0 && by(moving, 'topbar').every((x) => x.lens), moving);
    check('once it stops, the glass is as it was, bend and all', JSON.stringify(after) === JSON.stringify(atRest), { atRest, after });
    const light = await ev("(() => { const r = window.Refract; return !!(r && r.light && r.light.refresh); })()");
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    check('Refract\'s light no longer hears each scroll (its listener comes off at the first)', light && !listeners.some((l) => l.type === 'scroll' && l.useCapture), listeners.filter((l) => l.type === 'scroll').map((l) => `${l.useCapture ? 'capture' : 'bubble'} ${l.lineNumber}`));
    // The scroll diagnostics (src/ui/diag.js) saw that fling: the finger's travel, the page following
    // it while the finger was down, frames drawn, the thread's long frames and the touches' delays.
    const report = await ev('window.GH.diag.report()');
    const gesture = report.split('\n').find((l) => /finger up \d+ px/.test(l)) || '';
    const px = (re) => { const m = re.exec(report); return m ? Number(m[1]) : -1; };
    check('the scroll diagnostics record the fling: the finger up 400 px, the page following while down', /finger up 4\d\d px/.test(gesture) && px(/page moved (\d+) px while down/) >= 100 && !/^\* /.test(gesture.trim()), report.slice(0, 900));
    check('with frames, the thread and input delays reported', /frames \d+, longest gap \d+ ms/.test(report) && /thread (held|free)/.test(report) && /input delay up to \d+ ms/.test(report), report.slice(0, 900));
    await ctx.close();
  }
  const { ctx, page } = await open(builds[0]);
  const drift = () => page.evaluate(() => {
    const app = document.getElementById('app');
    const a = document.getAnimations().find((x) => x.effect && x.effect.target === app && x.effect.pseudoElement === '::before' && /glow-drift/.test(x.animationName || ''));
    return { idle: app.hasAttribute('data-idle'), inUse: app.hasAttribute('data-in-use'), state: a ? a.playState : null };
  });
  const notInUse = () => page.waitForFunction(() => !document.getElementById('app').hasAttribute('data-in-use'), null, { timeout: 10000, polling: 100 }).catch(() => null);
  await notInUse();
  await page.waitForTimeout(100);
  const alone = await drift();
  await page.waitForFunction(() => document.getElementById('app').hasAttribute('data-idle'), null, { timeout: 25000, polling: 500 }).catch(() => null);
  const still = await drift();
  await page.keyboard.press('Shift');
  await page.waitForTimeout(100);
  const inUse = await drift();
  await notInUse();
  await page.waitForTimeout(100);
  const again = await drift();
  check('left alone for a few seconds, the glow drifts', !alone.inUse && !alone.idle && alone.state === 'running', alone);
  check('20 s after the last input it holds still', still.idle && still.state === 'paused', still);
  check('an input holds it still while the app is in use', inUse.inUse && !inUse.idle && inUse.state === 'paused', inUse);
  check('and 3 s later it drifts again', !again.inUse && !again.idle && again.state === 'running', again);
  await ctx.close();
}

if (!measureOnly) check('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));

await browser.close();
if (gpuBrowser) await gpuBrowser.close();
for (const b of builds) await b.server.close();
done();
