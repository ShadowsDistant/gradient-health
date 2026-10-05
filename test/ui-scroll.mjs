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
//              (the top bar's frosted edge), cv (the long pages' content-visibility). With --vs, only
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
const flatJson = (() => { const S = JSON.parse(stateJson); S.profile.prefs.figure = 'flat'; return JSON.stringify(S); })();

async function open(build) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, flatJson);
  const ab = ABLATE && build === builds[0] ? ABLATIONS[ABLATE] : null;
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

/* ---------------------------------------------------------------- while scrolling, and at rest */
// The glass over the page looks the same while the page scrolls as at rest (it keeps its lens: 1.7.0's
// dropping it showed as the glass clearing and frosting again); the glow stops drifting 20 s after
// the last input, and starts again with the next one (src/styles/perf.css, src/ui/core.js).
if (!measureOnly) {
  section('While scrolling, and at rest');
  const { ctx, page } = await open(builds[0]);
  const lens = () => page.evaluate(() => { const l = document.querySelector('#tabbar .rf-tabbar-bar > .rf-lens-layer'); return l ? getComputedStyle(l).backdropFilter : null; });
  const atRest = await lens();
  await page.mouse.move(195, 520);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.getElementById('app').hasAttribute('data-scrolling'), null, { timeout: 3000 }).catch(() => null);
  const scrolling = await lens();
  await page.waitForFunction(() => !document.getElementById('app').hasAttribute('data-scrolling'), null, { timeout: 3000 }).catch(() => null);
  const after = await lens();
  check('at rest, the tab bar refracts (a lens map in its backdrop filter)', /url\(/.test(atRest || ''), atRest);
  check('while the page scrolls it keeps the same glass, lens and all', !!scrolling && scrolling === atRest, scrolling);
  check('and at rest again', after === atRest, after);
  const drift = () => page.evaluate(() => {
    const app = document.getElementById('app');
    const a = document.getAnimations().find((x) => x.effect && x.effect.target === app && x.effect.pseudoElement === '::before' && /glow-drift/.test(x.animationName || ''));
    return { idle: app.hasAttribute('data-idle'), state: a ? a.playState : null };
  });
  const moving = await drift();
  await page.waitForFunction(() => document.getElementById('app').hasAttribute('data-idle'), null, { timeout: 25000, polling: 500 }).catch(() => null);
  const still = await drift();
  await page.keyboard.press('Shift');
  await page.waitForTimeout(100);
  const again = await drift();
  check('the glow drifts while things happen', !moving.idle && moving.state === 'running', moving);
  check('20 s after the last input it holds still', still.idle && still.state === 'paused', still);
  check('the next input sets it drifting again', !again.idle && again.state === 'running', again);
  await ctx.close();
}

if (!measureOnly) check('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));

await browser.close();
for (const b of builds) await b.server.close();
done();
