// Boot, render and save budgets with the CPU slowed 4x (CDP Emulation.setCPUThrottlingRate), in
// Chromium at phone size, with someone five weeks in. Each number is the best of 3 runs, so a busy
// machine makes a run slower but rarely all three.
//
// - boot: from navigation start to the first frame that shows Today's session, each run in a fresh
//   browser context (its own renderer, so nothing compiled earlier is reused): the first launch of a
//   day, and a launch later the same day (which reuses the insights the one before kept)
// - long tasks: none over the budget in the 10 s after that first frame (with the flat figure; the
//   3D figure's warm-up is reported on its own, see flatJson)
// - tab render: switching tabs, the time U.go() takes (the render), p95 over every tab
// - tab taps: a real tap on the tab bar, timed from the touch's end to the first frame after it (the
//   tap answered) and to the first frame with the new page in it, p95 over every tab
// - a feel tap on Today: the re-render it causes
// - a save: U.save() itself, and the longest task any timer or idle callback runs in the 1.5 s after
//   (where the write happens)
//
// Usage: node test/ui-perf.mjs [--measure] [--dist=<dir>] [--runs=3] [--boot-only]
//   --measure  print the numbers only, no checks (how the baselines below were taken)
//   --dist     a built page somewhere else (a copy of an older dist/), to compare on the same machine
//   --boot-only  just the launches (with --runs=N), to compare boot times quickly; this also times
//              the same-day launch without the kept insights
import { createRequire } from 'node:module';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const measureOnly = process.argv.includes('--measure');
const RUNS = Math.max(1, Number(arg('runs', 3)));
const CPU = 4;

/* ---------------------------------------------------------------- baselines and budgets */
// Measured on the 1.5.0 page plus the 1.6.0 scaffolding (commit c3d1851, not minified), with this
// file's --measure on the same machine as the rest of the 1.6.0 work: 4 CPUs, headless Chromium
// (WebGL in software), 390 x 844 at 2x, CPU slowed 4x, best of 3, with the 3D figure. Then the
// longest task after the first frame was 2.6 s: the 3D figure's warm-up, which started right after
// the first paint (the first frame itself doesn't depend on the figure).
const BASE = {
  bootMs: 954, // navigation start to the first frame with Today's session
  tabP95Ms: 152, // U.go() between tabs, p95 (to the next frame: 191)
  feelMs: 30, // Today's re-render after a feel tap
  saveMs: 7.5, // the longest task a save runs (13-20 ms in the other runs)
  distBytes: 2551794, // dist/gradient-health.html
};
// The targets were 0.7 x the baseline boot (668 ms) and a tab render p95 of 50 ms. Where 1.6.0's
// performance work didn't reach them, the budget is what it reached plus a margin (best of 3, over
// a few runs, on the same machine as the baseline), to catch the next slowdown:
// - boot: at release, the first launch of a day reached 690-760 ms (0.72-0.8 x); a launch later the
//   same day, which reuses the insights the one before kept, 590-640 (0.62-0.67 x). What's left
//   before the first frame is mostly compiling and running the page's scripts (building the
//   exercise library in src/data/moves.js and moves-access.js alone takes about 120 ms), its style
//   sheets and layout, and Today's own render (today's session, the calendar).
// - tab render: about 47 ms at release, so this target was reached (the first of the three runs
//   takes 85-90 ms, while each screen's code compiles). The budget is still the one set when it was
//   130-150 ms, before the parts of the app that load on demand (src/ui/lazy.js) and one layout
//   read a frame (src/ui/core.js, readSoon).
// - 1.9.0: this machine now measures 1.8.10 itself at the edge of the boot budgets (800 and 740 ms).
//   In an interleaved A/B (3 rounds, best of 5 launches each), 1.8.10 took 793-812 ms for the first
//   launch of a day and 676-727 ms for a launch later the same day; 1.9.0 (sealed badges, the
//   notifications' hand-off and the kept 3D stills, about 40 KB more page) took 769-858 and 704-744,
//   and single best-of-3 runs here land anywhere from 764 to 831 and from 700 to 798. Level, within
//   the noise, so the boot budgets move to 860 and 800: still well under 1.5's 954, and a real
//   slowdown of a tenth fails them.
// - 1.10.0: this machine now measures 1.9.0 itself over those budgets. Interleaved (4 rounds, best
//   of 5 launches each), 1.9.0 took 807-961 ms for the first launch of a day and 766-833 ms for a
//   launch later the same day; 1.10.0 (Claude's limits, the 3D medals' page part, toasts at the
//   bottom and quicker motion, about 44 KB more page) took 865-929 and 737-799. Level within the
//   noise again (first launches 2% apart on average, later ones 1.10 the quicker), so the budgets
//   move to 980 and 900.
// - 1.12.0 times real taps on the tab bar (Tab taps: each tab from the one before it, twice round,
//   from the touch's end, p95, best of 3). 1.11.0 drew the new page inside the tap, so the first
//   frame after a tap was the new page's: 305 ms here (its runs 305 to 441, interleaved with
//   1.12.0's on the same machine). 1.12.0 answers in the next frame and draws the page after it:
//   the first frame after the tap at 90 and 99 ms in two measurements (runs 90 to 186, the slower
//   ones while other tests ran), the page in a frame at 241 and 266 (runs 241 to 362). The budgets
//   are those plus a margin: a tap that draws the page inside it again fails the first.
// - 1.13.0 also times the taps people make most (Taps people make most: from the touch's end to the
//   first frame with the tap's first response, and to the first with its result) and the first tap
//   after launch (Plan, 300 ms after the first frame), each the best of 3. Measured in turns with
//   1.12's page while two other test suites ran here (load 25 to 37 on 4 CPUs), 1.13.0's best of a
//   run, over six runs: the first tap 47 to 96 ms (9 launches in turns: median 101, 1.12's 171); a
//   move's how-to 93 to 400 / 118 to 459; a Settings row's sheet 96 to 171; How it works 221 to
//   318; Plan's next week 78 to 165; start a workout 156 to 359; Done set 126 to 259; reps left 47
//   to 123; the next exercise 64 to 147; the Food page 115 to 264; a letter in Add food's search 9
//   to 13 / 148 to 211 (its results wait out the search's 120 ms pause). The budgets are about
//   twice the middle run's (the Food page's more, its runs vary most), so a busy machine passes and
//   a tap that waits on a long task, or draws a page or the player inside the tap, fails.
const BUDGET = {
  bootMs: 980, // the first launch of a day
  againMs: 900, // a launch later the same day
  tabP95Ms: 160,
  tapAnsweredMs: 150, // a tab tapped: the first frame after the tap
  tapPageMs: 360, // and the first frame with its page
  feelMs: 30,
  longTaskMs: 200,
  saveMs: 8,
  firstTapMs: 160, // the first tap after launch: the first frame with the tab picked
  // Each tap: [the first frame with its first response, the first with its result], in ms.
  taps: {
    'a move\'s how-to': [260, 320],
    'a Settings row\'s sheet': [300, 300],
    'How it works': [520, 520],
    'Plan\'s next week': [260, 260],
    'start a workout': [480, 480],
    'Done set': [380, 380],
    'reps left': [220, 220],
    'the next exercise': [200, 200],
    'the Food page': [360, 360],
    'a letter in Add food\'s search': [40, 360],
  },
};

/* ---------------------------------------------------------------- the page */
// --dist serves another build's page and lazy/ through lib.mjs's server (its `extra` paths).
async function serve() {
  const dir = arg('dist', '');
  if (!dir) return serveDist();
  const base = resolve(dir);
  const extra = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else extra['/' + relative(base, p).split(sep).join('/')] = p; } };
  if (!existsSync(join(base, 'gradient-health.html'))) throw new Error(`no gradient-health.html in ${base}`);
  walk(base);
  return serveDist(extra);
}

// In the page before anything else: long tasks, the first contentful paint, and the first frame
// that shows Today's session (checked every frame).
function probe() {
  const P = window.__perf = { longtasks: [], firstRender: 0, fcp: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* not supported */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') P.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch (e) { /* not supported */ }
  const tick = () => {
    if (document.querySelector('#screen[data-view="today"] .session')) { P.firstRender = performance.now(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // When the 3D figure's chunk is asked for (GH.lazy adds its script to <head>).
  P.fig3d = 0;
  document.addEventListener('DOMContentLoaded', () => new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (!P.fig3d && n.tagName === 'SCRIPT' && /figure3d/.test(n.src || '')) P.fig3d = performance.now();
  }).observe(document.head, { childList: true }));
  // Every timer and idle callback, timed while __watch is on (to find what a save costs).
  P.tasks = []; P.watch = false;
  const wrap = (name) => {
    const orig = window[name];
    if (!orig) return;
    window[name] = function (fn, ...rest) {
      if (typeof fn !== 'function') return orig.call(window, fn, ...rest);
      return orig.call(window, function (...a) {
        if (!P.watch) return fn.apply(this, a);
        const t0 = performance.now();
        try { return fn.apply(this, a); } finally { P.tasks.push([name, performance.now() - t0]); }
      }, ...rest);
    };
  };
  wrap('setTimeout');
  wrap('requestIdleCallback');
}

// The app's bridge as 1.6 has it: saveAsync hands the state over and returns (the write runs on a
// thread of its own in the app, so here it isn't written at all).
function asyncBridge() {
  window.__asyncSaves = 0;
  if (window.AndroidBridge) window.AndroidBridge.saveAsync = (s) => { window.__asyncSaves++; window.__lastAsync = s.length; return true; };
}

const server = await serve();
const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' };
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const best = (xs) => Math.min(...xs);
const p95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const r1 = (x) => Math.round(x * 10) / 10;

// A real tap (touches through CDP, as a finger's) on the first `target` in sight (brought to the
// middle of the screen if it's covered or off it), timed from the touch's end (with o.type, from the
// input event of that text typed instead) to the first frame the page's thread finishes with
// `answered` on the page, and to the first with `shown` (selectors): the tap's first visible
// response, and its result. { answered, shown } in ms; Infinity for one that never came.
async function timedTap(page, cdp, target, answered, shown, o = {}) {
  const find = () => page.evaluate((s) => {
    const all = [...document.querySelectorAll(s)];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = r.width && y > 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      if (hit && (hit === el || el.contains(hit))) return { x: Math.round(x), y: Math.round(y) };
    }
    if (all[0]) all[0].scrollIntoView({ block: 'center' });
    return null;
  }, target);
  let at = o.type ? {} : await find();
  if (!at) { await pause(600); at = await find(); }
  if (!at) return { answered: Infinity, shown: Infinity, missing: target };
  await page.evaluate(({ answered, shown, input }) => {
    const sw = window.__timed = {};
    const post = (fn) => { const sc = window.scheduler; if (sc && sc.postTask) sc.postTask(fn, { priority: 'user-blocking' }); else setTimeout(fn, 0); };
    document.addEventListener(input ? 'input' : 'touchend', (e) => { sw.t0 = e.timeStamp; }, { capture: true, once: true, passive: true });
    let n = 0;
    const loop = () => {
      if (sw.t0 != null) {
        if (sw.answered == null && !sw.an && document.querySelector(answered)) { sw.an = true; post(() => { sw.answered = performance.now() - sw.t0; }); }
        if (sw.shown == null && !sw.sh && document.querySelector(shown)) { sw.sh = true; post(() => { sw.shown = performance.now() - sw.t0; }); }
      }
      if (++n < 600 && (sw.answered == null || sw.shown == null)) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, { answered, shown, input: !!o.type });
  if (o.type) await page.keyboard.type(o.type);
  else {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
    await pause(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.waitForFunction(() => window.__timed.answered != null && window.__timed.shown != null, null, { timeout: 15000, polling: 50 }).catch(() => {});
  return page.evaluate(() => ({ answered: window.__timed.answered ?? Infinity, shown: window.__timed.shown ?? Infinity }));
}

// The state: five weeks of history, built by the app itself on a first run.
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

// The measured launches use the flat exercise figure. The 3D one warms up after the first paint (so
// boot is the same either way), but here WebGL is software, which turns its warm-up into seconds of
// main-thread work a phone's GPU doesn't have: it's measured on its own, at the end.
const flatJson = (() => { const S = JSON.parse(stateJson); S.profile.prefs.figure = 'flat'; return JSON.stringify(S); })();

// One launch, in a fresh context: the bridge and the state are there before the page loads, and
// with `kept`, the insights an earlier launch that day left next to it (src/insights.js).
async function launch(json = flatJson, kept = null) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, json);
  if (kept) await ctx.addInitScript((k) => { try { if (!localStorage.getItem('gh.v1.insights')) localStorage.setItem('gh.v1.insights', k); } catch (e) { /* ignore */ } }, kept);
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__perf && window.__perf.firstRender > 0, null, { timeout: 60000 });
  return { ctx, page, cdp };
}

// What a launch leaves for the next one the same day, once its health sync and the idle writes after
// it are done: the state, and the insights it worked out (null with a build that doesn't keep them).
async function leftAfter(json) {
  const { ctx, page } = await launch(json);
  await page.waitForFunction(() => localStorage.getItem('gh.v1.insights'), null, { timeout: 8000, polling: 100 }).catch(() => null);
  await pause(3000);
  const left = await page.evaluate(() => ({ state: JSON.stringify(window.GH.ui.S), kept: localStorage.getItem('gh.v1.insights') }));
  await ctx.close();
  return left;
}

/* ---------------------------------------------------------------- boot */
section(`Boot, the first launch of the day (CPU ${CPU}x slower, best of ${RUNS})`);
const boots = [];
let live = null;
for (let i = 0; i < RUNS; i++) {
  const run = await launch();
  // Ten seconds after the first frame: the health sync, What's new, the 3D figure's warm-up.
  const t = await run.page.evaluate(() => window.__perf.firstRender);
  if (!process.argv.includes('--boot-only')) await run.page.waitForFunction((t0) => performance.now() > t0 + 10000, t, { timeout: 120000, polling: 250 });
  const r = await run.page.evaluate(() => {
    const P = window.__perf;
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const after = P.longtasks.filter(([s]) => s >= P.firstRender);
    return { firstRender: P.firstRender, fcp: P.fcp, dcl: nav.domContentLoadedEventEnd || 0, interactive: nav.domInteractive || 0, longest: after.reduce((m, x) => Math.max(m, x[1]), 0), long: after };
  });
  boots.push(r);
  console.log(`  run ${i + 1}: first render ${r1(r.firstRender)} ms (FCP ${r1(r.fcp)}, DOM interactive ${r1(r.interactive)}, DOMContentLoaded ${r1(r.dcl)}); long tasks after it: ${r.long.map(([s, d]) => `${d} ms at +${Math.round(s - r.firstRender)}`).join(', ') || 'none'}`);
  if (i < RUNS - 1) await run.ctx.close(); else live = run;
}
const bootMs = best(boots.map((b) => b.firstRender));
const longMs = best(boots.map((b) => b.longest));

// Again the same day, nothing changed since: the state the last launch saved, and the insights it
// kept (src/insights.js), which this launch reuses.
const left = await leftAfter(flatJson);
async function relaunch(label, kept) {
  section(`Boot, again the same day${label} (best of ${RUNS})`);
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    const run = await launch(left.state, kept);
    const r = await run.page.evaluate(() => ({ firstRender: window.__perf.firstRender, fcp: window.__perf.fcp, kept: (window.GH.insights.top.stats || {}).kept || 0 }));
    out.push(r);
    console.log(`  run ${i + 1}: first render ${r1(r.firstRender)} ms (FCP ${r1(r.fcp)}); generators whose insights were reused: ${r.kept}`);
    await run.ctx.close();
  }
  return out;
}
const again = await relaunch('', left.kept);
const againMs = best(again.map((b) => b.firstRender));
if (process.argv.includes('--boot-only')) {
  // The same relaunch without what the last one kept, to see what reusing it saves.
  const fresh = await relaunch(', without the kept insights', null);
  const sum = (label, list) => { const xs = list.map((b) => b.firstRender).sort((a, b) => a - b); console.log(`  ${label}: best ${r1(xs[0])} ms, median ${r1(xs[xs.length >> 1])} ms over ${xs.length} runs`); };
  console.log('');
  sum('boot, first of the day', boots);
  sum('boot, again the same day', again);
  sum('boot, again, insights worked out afresh', fresh);
  await browser.close();
  await server.close();
  process.exit(0);
}

/* ---------------------------------------------------------------- the first tap after launch */
// A tap on the Plan tab 300 ms after the first frame, the first launch of a day: what a launch does
// after its first frame is still going then (the health sync and its redraw, the glass's lens maps,
// the insight line), and a tap waits behind whatever task is running. From the touch's end to the
// first frame with the tab picked (answered) and to the first with its page. Best of the launches.
section(`The first tap after launch, on Plan 300 ms after the first frame (best of ${RUNS})`);
const firstTaps = [];
for (let i = 0; i < RUNS; i++) {
  const run = await launch();
  await run.page.waitForFunction(() => performance.now() > window.__perf.firstRender + 300, null, { timeout: 30000, polling: 10 });
  const r = await timedTap(run.page, run.cdp, '#tabbar .rf-tab[data-tab="plan"]', '#tabbar .rf-tab[data-tab="plan"][aria-current="page"]', '#screen[data-view="plan"]');
  firstTaps.push(r);
  console.log(`  run ${i + 1}: answered ${r1(r.answered)} ms, its page ${r1(r.shown)} ms`);
  await run.ctx.close();
}
const firstTapMs = best(firstTaps.map((x) => x.answered));

/* ---------------------------------------------------------------- tabs */
const { page } = live;
await page.evaluate(() => window.GH.ui.go('today'));
await pause(1000);
section(`Tab render (best of ${RUNS})`);
const tabRuns = [];
for (let i = 0; i < RUNS; i++) {
  const r = await page.evaluate(async () => {
    const U = window.GH.ui;
    const tabs = U.tabList().map((t) => t[0]);
    const order = tabs.slice(1).concat(tabs[0]);
    const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = [];
    for (let k = 0; k < 4; k++) {
      for (const t of order) {
        const t0 = performance.now();
        U.go(t);
        const t1 = performance.now();
        await frame();
        out.push({ tab: t, js: t1 - t0, frame: performance.now() - t0 });
        await wait(450);
      }
    }
    return out;
  });
  tabRuns.push(r);
  const by = {};
  for (const x of r) (by[x.tab] = by[x.tab] || []).push(x.js);
  console.log(`  run ${i + 1}: p95 ${r1(p95(r.map((x) => x.js)))} ms (to the next frame ${r1(p95(r.map((x) => x.frame)))} ms); ${Object.entries(by).map(([t, xs]) => `${t} ${r1(Math.min(...xs))}-${r1(Math.max(...xs))}`).join(', ')}`);
}
const tabP95 = best(tabRuns.map((r) => p95(r.map((x) => x.js))));

/* ---------------------------------------------------------------- tab taps */
// A real tap on the tab bar (touches through CDP, as a finger's), timed from the touch's end:
// - answered: until the page's thread has drawn the first frame after it (the bar's glass on its
//   way, the old page starting to leave)
// - page: until it has drawn the first frame with the new page in it
// Each tab from the one before it, twice round, p95; best of the runs.
section(`Tab taps (best of ${RUNS})`);
const tapRuns = [];
for (let i = 0; i < RUNS; i++) {
  const out = [];
  await page.evaluate(() => window.GH.ui.go('today'));
  await pause(900);
  const tabs = await page.evaluate(() => window.GH.ui.tabList().map((t) => t[0]));
  for (let k = 0; k < 2; k++) {
    for (const t of tabs.slice(1).concat(tabs[0])) {
      await page.evaluate((to) => {
        const sw = window.__tap = { to };
        const post = (fn) => { const sc = window.scheduler; if (sc && sc.postTask) sc.postTask(fn, { priority: 'user-blocking' }); else setTimeout(fn, 0); };
        document.addEventListener('touchend', (e) => { sw.t0 = e.timeStamp; }, { capture: true, once: true, passive: true });
        let n = 0;
        const loop = () => {
          const tab = document.querySelector(`#tabbar .rf-tab[data-tab="${to}"]`);
          if (sw.t0 != null && sw.answered == null && !sw.ans && tab && tab.getAttribute('aria-current') === 'page') { sw.ans = true; post(() => { sw.answered = performance.now() - sw.t0; }); }
          if (sw.t0 != null && sw.page == null && !sw.pg && document.querySelector(`#screen[data-view="${to}"]`)) { sw.pg = true; post(() => { sw.page = performance.now() - sw.t0; }); }
          if (++n < 120 && (sw.answered == null || sw.page == null)) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }, t);
      const at = await page.evaluate((to) => { const r = document.querySelector(`#tabbar .rf-tab[data-tab="${to}"]`).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, t);
      await live.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
      await pause(50);
      await live.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => window.__tap.answered != null && window.__tap.page != null, null, { timeout: 15000, polling: 50 }).catch(() => {});
      const r = await page.evaluate(() => ({ to: window.__tap.to, answered: window.__tap.answered, page: window.__tap.page }));
      out.push(r);
      await pause(700);
      await page.evaluate(() => window.GH.ui.motion.settled());
      await pause(300);
    }
  }
  tapRuns.push(out);
  const by = {};
  for (const x of out) (by[x.to] = by[x.to] || []).push(x);
  console.log(`  run ${i + 1}: answered p95 ${r1(p95(out.map((x) => x.answered ?? Infinity)))} ms, page p95 ${r1(p95(out.map((x) => x.page ?? Infinity)))} ms; ${Object.entries(by).map(([t, xs]) => `${t} ${xs.map((x) => `${Math.round(x.answered)}/${Math.round(x.page)}`).join(' ')}`).join(', ')}`);
}
const tapAnswered = best(tapRuns.map((r) => p95(r.map((x) => x.answered ?? Infinity))));
const tapPage = best(tapRuns.map((r) => p95(r.map((x) => x.page ?? Infinity))));

/* ---------------------------------------------------------------- a feel tap */
section(`Today after a feel tap (best of ${RUNS})`);
await page.evaluate(() => window.GH.ui.go('today'));
await pause(800);
const feelRuns = [];
for (let i = 0; i < RUNS; i++) {
  const r = await page.evaluate(async () => {
    const U = window.GH.ui;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = [];
    for (let k = 0; k < 3; k++) {
      if (!document.querySelector('[data-on="feelEnergy"]')) { U.act.feelEdit(); await wait(500); }
      const pick = [...document.querySelectorAll('[data-on="feelEnergy"] input')].find((x) => !x.checked);
      if (!pick) return null;
      let render = null;
      const orig = U.render;
      U.render = function (...a) { const t0 = performance.now(); try { return orig.apply(this, a); } finally { render = performance.now() - t0; U.render = orig; } };
      const t0 = performance.now();
      pick.checked = true;
      pick.dispatchEvent(new Event('change', { bubbles: true }));
      const handler = performance.now() - t0;
      await wait(700);
      U.render = orig;
      out.push({ handler, render });
    }
    return out;
  });
  if (!r) { feelRuns.push([{ handler: Infinity, render: Infinity }]); continue; }
  feelRuns.push(r);
  console.log(`  run ${i + 1}: re-render ${r.map((x) => r1(x.render)).join(', ')} ms; the tap's handler ${r.map((x) => r1(x.handler)).join(', ')} ms`);
}
const feelMs = best(feelRuns.map((r) => Math.max(...r.map((x) => x.render))));

/* ---------------------------------------------------------------- a save */
section(`A save (best of ${RUNS})`);
const saveRuns = [];
for (let i = 0; i < RUNS; i++) {
  await pause(1500);
  const r = await page.evaluate(async () => {
    const P = window.__perf, U = window.GH.ui;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    P.tasks = [];
    P.watch = true;
    const t0 = performance.now();
    U.S.seen.perfProbe = (U.S.seen.perfProbe || 0) + 1;
    U.save();
    const call = performance.now() - t0;
    await wait(1500);
    P.watch = false;
    const tasks = P.tasks.slice();
    return { call, longest: tasks.reduce((m, x) => Math.max(m, x[1]), 0), tasks: tasks.filter((x) => x[1] >= 1).map(([n, ms]) => `${n} ${Math.round(ms * 10) / 10}`), asyncSaves: window.__asyncSaves };
  });
  saveRuns.push(r);
  console.log(`  run ${i + 1}: U.save() ${r1(r.call)} ms; longest task after it ${r1(r.longest)} ms (${r.tasks.join(', ') || 'none over 1 ms'}); async saves so far ${r.asyncSaves}`);
}
const saveMs = best(saveRuns.map((r) => Math.max(r.call, r.longest)));

/* ---------------------------------------------------------------- taps people make most */
// Real taps (timedTap: from the touch's end to the first frame with the tap's first response, and to
// the first with its result), each set up first and put back after. A sheet's first response is the
// sheet on its way up, its result what's in it (a move's figure); a page's, the page coming in; the
// player's, its next step. Best of the runs.
section(`Taps people make most (best of ${RUNS})`);
const ev = (fn, a) => page.evaluate(fn, a);
const settle = async (ms = 700) => { await pause(ms); await ev(() => window.GH.ui.motion.settled()); await pause(250); };
const closeAll = async () => { await ev(() => { const U = window.GH.ui; U.closeSheets(); if (U.S.active) window.GH.brain.cancelWorkout(U.S); if (!U.els().playerEl.hidden && U.playerBack) U.playerBack(); }); await settle(600); };
// A page of Settings, opened from You (its top page in between): Workouts, About.
const toSettings = async (id) => { await ev((p) => { const U = window.GH.ui; U.go('you'); U.open('settings'); U.open('settings', p); }, id); await settle(900); };
const SHEET = 'dialog.gh-sheet[open]:not([data-closing])';
const sceneKey = () => ev(() => { const m = document.querySelector('#player .pl-main'); return m ? m.getAttribute('data-key') : ''; });
const tapRes = {};
const tapDo = async (name, target, answered, shown, o) => { const r = await timedTap(page, live.cdp, target, answered, shown, o); (tapRes[name] = tapRes[name] || []).push(r); return r; };
for (let i = 0; i < RUNS; i++) {
  await closeAll();
  await ev(() => window.GH.ui.go('today'));
  await settle(900);
  await tapDo('a move\'s how-to', '#screen .session [data-act="moveInfo"]', SHEET, `${SHEET} .sheet-fig > *`);
  await closeAll();
  await toSettings('workouts');
  await tapDo('a Settings row\'s sheet', '#screen [data-act="baselineSheet"]', SHEET, `${SHEET} #bPush`);
  await closeAll();
  await toSettings('about');
  await tapDo('How it works', '#screen .rf-list-row[data-act="openScience"]:not([data-arg])', '#screen[data-view="science"]', '#screen[data-view="science"] .section');
  await settle(600);
  await ev(() => { const U = window.GH.ui; U.go('plan'); const b = document.querySelector('#screen [data-act="planWeek"][data-arg="0"]'); if (b) b.click(); });
  // (Someone looks at the week a moment before going on to the next: Plan works next week out then.)
  await settle(2600);
  await tapDo('Plan\'s next week', '#screen [data-act="planWeek"][data-arg="1"]', '#screen [data-act="planWeek"][data-arg="0"]', '#screen [data-act="planWeek"][data-arg="0"]');
  await ev(() => window.GH.ui.go('today'));
  await settle(1200);
  // The player: Start, then Done on a set that asks how many more you could have done, the answer,
  // and on to the next.
  await tapDo('start a workout', '#float [data-act="startWorkout"]', '#player:not([hidden])', '#player:not([hidden]) .pl-name');
  await settle(900);
  await ev(() => { const U = window.GH.ui, B = window.GH.brain, a = U.S.active; let g = 0; while (a && a.idx < a.steps.length && !(a.steps[a.idx].kind === 'set' && a.steps[a.idx].askRir) && g++ < 200) B.completeStep(U.S, a.steps[a.idx].kind === 'test' ? { value: 10 } : {}); U.openPlayer(); });
  await settle(900);
  let key = await sceneKey();
  await tapDo('Done set', '#player [data-act="plDone"]', `#player .pl-main:not([data-key="${key}"])`, `#player .pl-main:not([data-key="${key}"]) .pl-rir`);
  await settle(600);
  await tapDo('reps left', '#player .pl-rir .rf-segment[data-arg="12"]', '#player .pl-rir input[value="12"]:checked', '#player .pl-rir input[value="12"]:checked');
  await settle(900);
  key = await sceneKey();
  await tapDo('the next exercise', '#player [data-act="plSkipRest"], #player [data-act="plContinue"]', `#player .pl-main:not([data-key="${key}"])`, `#player .pl-main:not([data-key="${key}"]) .pl-name`);
  await closeAll();
  // Food, for someone tracking calories (its page's part loaded, as it is for them once launched).
  await ev(async () => { const GH = window.GH, U = GH.ui; GH.food.setMode(U.S, 'full'); await GH.lazy('foodUi'); U.go('today'); U.render(); });
  await settle(1200);
  await tapDo('the Food page', '#screen [data-act="goFood"]', '#screen[data-view="food"]', '#screen[data-view="food"] .section');
  await settle(600);
  await ev(() => { const U = window.GH.ui; U.back(); U.go('today'); U.act.foodAdd(); });
  await page.waitForSelector(`${SHEET} #foodQ`, { timeout: 15000 }).catch(() => {});
  await settle(2000); // the built-in food list loads as the sheet opens
  await page.focus(`${SHEET} #foodQ`).catch(() => {});
  await tapDo('a letter in Add food\'s search', null, `${SHEET} #foodQ`, `${SHEET} .rf-sheet-body:not(:has(.fd-tabs)) .fd-results li`, { type: 'a' });
  await ev(() => { const GH = window.GH, U = GH.ui; U.closeSheets(); GH.food.setMode(U.S, 'protein'); U.render(); });
  await settle(900);
  console.log(`  run ${i + 1}: ${Object.entries(tapRes).map(([k, xs]) => { const x = xs[xs.length - 1]; return `${k} ${r1(x.answered)}/${r1(x.shown)}`; }).join(', ')}`);
}
const tapBest = Object.fromEntries(Object.entries(tapRes).map(([k, xs]) => [k, { answered: best(xs.map((x) => x.answered)), shown: best(xs.map((x) => x.shown)) }]));
console.log(`  best (answered/result): ${Object.entries(tapBest).map(([k, x]) => `${k} ${r1(x.answered)}/${r1(x.shown)} ms`).join(', ')}`);

/* ---------------------------------------------------------------- what the speed-ups must keep */
// At normal speed: saves still land, caches give the same answers, and Claude works from its chunk.
if (!measureOnly) {
  await live.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  section('Saves');
  const saves = await page.evaluate(async () => {
    const U = window.GH.ui, br = window.AndroidBridge;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    await wait(1500);
    let syncWrites = 0, written = '';
    const save = br.save;
    br.save = (s) => { syncWrites++; written = s; return save(s); };
    const before = window.__asyncSaves;
    U.S.seen.perfMark = 'a';
    U.save();
    const inTap = window.__asyncSaves !== before || syncWrites > 0;
    await wait(1500);
    const later = window.__asyncSaves > before && syncWrites === 0;
    const noCopy = localStorage.getItem('gh.v1') === null;
    U.S.seen.perfMark = 'b';
    U.save();
    window.dispatchEvent(new Event('pagehide'));
    const flushed = syncWrites === 1 && JSON.parse(written).seen.perfMark === 'b';
    br.save = save;
    return { inTap, later, noCopy, flushed };
  });
  check('a save writes nothing in the tap that made it', !saves.inTap);
  check('it reaches the bridge\'s saveAsync once the page is idle', saves.later);
  check('inside the app, localStorage keeps no copy of the state', saves.noCopy);
  check('when the page is hidden, a waiting save is written at once, the synchronous way', saves.flushed);

  section('Health sync');
  const sync = await page.evaluate(async () => {
    const U = window.GH.ui, scr = U.screens.today;
    const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 50))));
    // (A redraw after a sync comes in an idle moment of its own once it's quiet, U.renderSoon in
    // src/ui/core.js: up to 2 s is waited for one, and then a little more for a second.)
    const redrawn = async (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms && !n) await new Promise((res) => setTimeout(res, 50)); await frames(); await new Promise((res) => setTimeout(res, 400)); };
    U.go('today');
    await frames();
    let n = 0;
    const orig = scr.render;
    scr.render = function (...a) { n++; return orig.apply(this, a); };
    const r1 = await U.syncHealth('manual'); // the same data as the last read
    await redrawn(800);
    const quiet = n;
    // A day's record lost: this read brings it back. (Today's, or the day before's in the hour and
    // a half after the day rolls over at 4, when the seed's records for today aren't on today yet.)
    delete U.S.health.days[U.S.health.days[U.today()] ? U.today() : U.today() - 1];
    n = 0;
    const r2 = await U.syncHealth('manual');
    await redrawn(2000);
    const changed = n;
    scr.render = orig;
    return { quiet, changed, r1: r1 && r1.changed, r2: r2 && r2.changed };
  });
  check('a sync that brought nothing new says so, and Today isn\'t drawn again', sync.r1 === false && sync.quiet === 0, sync);
  check('one that changed the data redraws it, once', sync.r2 === true && sync.changed === 1, sync);

  section('Kept answers');
  const same = await page.evaluate(async () => {
    const GH = window.GH, U = GH.ui, S = U.S, day = U.today();
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const eq = () => JSON.stringify(GH.insights.top(S, day, 10)) === JSON.stringify(GH.insights.all(S, day).slice(0, 10));
    const out = [eq()];
    GH.health.setFeel(S, day, { energy: 'low', sore: 'very' }); U.commit(); await wait(50); out.push(eq());
    GH.health.setSleepChip(S, day - 1, '<5'); U.commit(); await wait(50); out.push(eq());
    GH.brain.addProtein(S, day - 1, 80); U.commit(); await wait(50); out.push(eq());
    GH.brain.addWeight(S, day, 60, 'manual'); U.commit(); await wait(50); out.push(eq());
    const first = GH.insights.all(S, day)[0];
    if (first) { GH.insights.dismiss(S, first.id, day); U.commit(); await wait(50); }
    out.push(eq());
    U.go('health'); await wait(300); out.push(eq());
    U.go('today'); await wait(300);
    return out;
  });
  check('insights kept between renders are the ones worked out afresh, after each kind of change', same.every(Boolean), same);

  // Across launches: what a launch kept is reused only for the same state, day and feel, and a reset
  // deletes it with the state.
  const again1 = await launch(left.state, left.kept);
  await again1.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const across = await again1.page.evaluate(async () => {
    const GH = window.GH, I = GH.insights, U = GH.ui, day = U.today();
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const st = I.top.stats;
    const out = { atLaunch: st.kept };
    const same = (S) => JSON.stringify(I.top(S, day, 10)) === JSON.stringify(I.all(S, day).slice(0, 10));
    out.launchSame = same(U.S);
    // Kept afresh for the state as it is now, then tried on copies of it.
    I.top.clear();
    I.top(U.S, day, 10);
    for (let i = 0; i < 60 && !localStorage.getItem('gh.v1.insights'); i++) await wait(100);
    out.written = !!localStorage.getItem('gh.v1.insights');
    const copy = () => JSON.parse(JSON.stringify(U.S));
    let k = st.kept;
    const S1 = copy(); out.copySame = same(S1); out.copyKept = st.kept - k; k = st.kept;
    const S2 = copy(); GH.health.setFeel(S2, day, { energy: 'low', sore: 'very' }); out.feelSame = same(S2); out.feelKept = st.kept - k; k = st.kept;
    const S3 = copy(); const d3 = Object.keys(S3.health.days).map(Number).sort((a, b) => b - a)[1];
    S3.health.days[d3] = Object.assign({}, S3.health.days[d3], { steps: 1234, sleepMin: 200 });
    out.dataSame = same(S3); out.dataKept = st.kept - k;
    GH.store.clear();
    out.cleared = localStorage.getItem('gh.v1.insights') === null;
    return out;
  });
  await again1.ctx.close();
  check('a relaunch the same day reuses what the last launch kept, and shows the same insights', across.atLaunch > 0 && across.launchSame, across);
  check('a copy of the same state reuses all of it', across.written && across.copyKept === across.atLaunch && across.copySame, across);
  check('after a feel tap, only what doesn\'t read the feel check is reused', across.feelKept > 0 && across.feelKept < across.atLaunch && across.feelSame, across);
  check('with other health data, none of it is reused', across.dataKept === 0 && across.dataSame, across);
  check('a reset deletes it with the state', across.cleared, across);

  section('Claude, loaded the first time it\'s asked');
  const MODELS = [{ type: 'model', id: 'opus-test-2', display_name: 'Opus Test 2', created_at: '2026-07-01T00:00:00Z', capabilities: { effort: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } } } }];
  const REPORT = { headline: 'A steady week.', glance: [], wins: ['4 of 4 workouts'], watch: [], focus: ['Protein on rest days.'], focus_one: 'Protein on rest days', ask_me: ['How do I sleep more?'] };
  const TAILOR = { focus: ['legs'], muscles: [], goals: [], minutes: null, days: null, avoid_joints: [], no_jumping: null, gentle: null, note: 'More leg work each week.' };
  const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  const stream = (text) => sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_perf', type: 'message', role: 'assistant', model: 'opus-test-2', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...text.match(/[\s\S]{1,12}/g).map((c) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const sent = [];
  await live.ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sent.push(req.url());
    if (req.url().includes('/v1/models')) return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ data: MODELS, has_more: false, first_id: MODELS[0].id, last_id: MODELS[0].id }) });
    const body = JSON.parse(req.postData() || '{}');
    const props = (body.output_config && body.output_config.format && body.output_config.format.schema && body.output_config.format.schema.properties) || null;
    const text = !props ? 'Keep the same bedtime on weekends.' : props.headline ? JSON.stringify(REPORT) : props.no_jumping ? JSON.stringify(TAILOR) : JSON.stringify({ days: ['Push', 'Pull'] });
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, cors), body: stream(text) });
  });
  const before = await page.evaluate(() => ({ loaded: !!window.GH.claude, tags: [...document.scripts].filter((s) => /lazy\/claude\.js/.test(s.src)).length }));
  check('it isn\'t loaded at launch', !before.loaded && before.tags === 0, before);
  const ai = await page.evaluate(async () => {
    const GH = window.GH, U = GH.ui, S = U.S, day = U.today();
    window.AndroidBridge.loadSecret = () => 'sk-ant-api03-' + 'a'.repeat(60);
    S.ai.mode = 'api'; S.ai.enabled = true; S.ai.consentAt = Date.now();
    const fail = (e) => `error: ${e && e.message}`;
    const deltas = [];
    const out = {};
    out.ask = await GH.ai.ask(S, day, 'How do I sleep more?', (d, snap) => deltas.push(snap)).then((x) => x.text, fail);
    out.streamed = deltas.length;
    out.tags = [...document.scripts].filter((s) => /lazy\/claude\.js/.test(s.src)).length;
    out.tailor = await GH.ai.tailor(S, day, 'More legs').then((x) => x && x.note, fail);
    out.json = await GH.ai.json(S, day, 'Build me a plan', { type: 'object', properties: { days: { type: 'array', items: { type: 'string' } } }, required: ['days'], additionalProperties: false }).then((x) => x && x.days && x.days.join(), fail);
    out.report = await GH.ai.report(S, day).then((x) => x && x.data && x.data.headline, fail);
    out.saved = !!GH.ai.reportFor(S, day);
    return out;
  });
  check('a question loads it, once, and the answer streams in', ai.ask === 'Keep the same bedtime on weekends.' && ai.streamed > 1 && ai.tags === 1, ai);
  check('Tailor my plan works through it', ai.tailor === TAILOR.note, ai.tailor);
  check('Build me a plan works through it', ai.json === 'Push,Pull', ai.json);
  check('the weekly report works through it, and is kept for the week', ai.report === REPORT.headline && ai.saved, ai);
  // One request a feature: the question, Tailor, the plan and the report (1.9.0 also listed the models
  // to pick the newest; since 1.10 the person picks).
  check('every request went to the API, and only there', sent.length >= 4 && sent.every((u) => u.startsWith('https://api.anthropic.com/v1/messages')), sent);
  // The chat on screen, end to end.
  await page.evaluate(() => { window.GH.ui.S.ai.chatId = null; window.GH.ui.go('today'); });
  await pause(500);
  await page.click('#topbar .coach-btn');
  await page.waitForSelector('dialog.chat-sheet[open] #askQ', { timeout: 15000 });
  await page.fill('#askQ', 'Should I train today?');
  await page.click('.chat-sheet [data-act="askSend"]');
  const answered = await page.waitForFunction(() => { const x = [...document.querySelectorAll('.chat-sheet .bubble.coach')].pop(); return x && /same bedtime/.test(x.textContent) && !x.classList.contains('is-typing'); }, null, { timeout: 20000 }).then(() => true, () => false);
  check('the chat answers on screen through it', answered, await page.evaluate(() => [...document.querySelectorAll('.chat-sheet .bubble')].map((b) => b.textContent.slice(0, 80))));
  await page.evaluate(() => window.GH.ui.closeSheets());
}

/* ---------------------------------------------------------------- the 3D figure's warm-up */
// With the 3D figure, as most people have it: when its warm-up starts after the first render, and
// the longest task from then on. Reported, not budgeted: WebGL is software here.
section('The 3D figure\'s warm-up (software WebGL here: reported, not budgeted)');
await live.ctx.close();
const w3d = await launch(stateJson);
const fr = await w3d.page.evaluate(() => window.__perf.firstRender);
await w3d.page.waitForFunction((t0) => performance.now() > t0 + 14000, fr, { timeout: 120000, polling: 250 });
const warm = await w3d.page.evaluate(() => {
  const P = window.__perf;
  const before = P.longtasks.filter(([s]) => s >= P.firstRender && (!P.fig3d || s < P.fig3d));
  const after = P.fig3d ? P.longtasks.filter(([s]) => s >= P.fig3d) : [];
  return { start: P.fig3d ? P.fig3d - P.firstRender : null, before: before.reduce((m, x) => Math.max(m, x[1]), 0), longest: after.reduce((m, x) => Math.max(m, x[1]), 0) };
});
await w3d.ctx.close();
console.log(`  it started ${warm.start == null ? 'later than 14 s' : `${Math.round(warm.start)} ms`} after the first render (longest task before it ${warm.before} ms); its longest task ${warm.longest} ms`);

const distBytes = statSync(arg('dist', '') ? join(resolve(arg('dist', '')), 'gradient-health.html') : join(root, 'dist/gradient-health.html')).size;
console.log(`\n  boot ${r1(bootMs)} ms (again the same day ${r1(againMs)} ms) · longest task after it ${longMs} ms · tab p95 ${r1(tabP95)} ms · tab tap: answered ${r1(tapAnswered)} ms, page ${r1(tapPage)} ms (p95) · feel re-render ${r1(feelMs)} ms · save ${r1(saveMs)} ms · dist ${distBytes} bytes · 3D warm-up from +${warm.start == null ? '-' : Math.round(warm.start)} ms, its longest task ${warm.longest} ms`);
if (BASE.bootMs) console.log(`  against the baseline: boot ${r1(bootMs / BASE.bootMs * 100)}% (again ${r1(againMs / BASE.bootMs * 100)}%), tab p95 ${r1(tabP95 / BASE.tabP95Ms * 100)}%, feel ${r1(feelMs / BASE.feelMs * 100)}%, save ${r1(saveMs / BASE.saveMs * 100)}%, dist ${r1(distBytes / BASE.distBytes * 100)}%`);

if (!measureOnly) {
  section('Budgets');
  check(`boot, the first launch of a day, ≤ ${BUDGET.bootMs} ms (the baseline: ${BASE.bootMs} ms)`, bootMs <= BUDGET.bootMs, `${r1(bootMs)} ms`);
  check(`boot, again the same day, ≤ ${BUDGET.againMs} ms`, againMs <= BUDGET.againMs, `${r1(againMs)} ms`);
  check(`no long task over ${BUDGET.longTaskMs} ms after the first render`, longMs <= BUDGET.longTaskMs, `${longMs} ms`);
  check(`tab render p95 ≤ ${BUDGET.tabP95Ms} ms`, tabP95 <= BUDGET.tabP95Ms, `${r1(tabP95)} ms`);
  check(`a tab tapped: the first frame after the tap ≤ ${BUDGET.tapAnsweredMs} ms (p95)`, tapAnswered <= BUDGET.tapAnsweredMs, `${r1(tapAnswered)} ms`);
  check(`a tab tapped: its page in a frame ≤ ${BUDGET.tapPageMs} ms (p95)`, tapPage <= BUDGET.tapPageMs, `${r1(tapPage)} ms`);
  check(`Today's re-render after a feel tap ≤ ${BUDGET.feelMs} ms`, feelMs <= BUDGET.feelMs, `${r1(feelMs)} ms`);
  check(`a save blocks the main thread ≤ ${BUDGET.saveMs} ms`, saveMs <= BUDGET.saveMs, `${r1(saveMs)} ms`);
  check(`the first tap after launch (Plan, 300 ms after the first frame) is answered within ${BUDGET.firstTapMs} ms`, firstTapMs <= BUDGET.firstTapMs, `${r1(firstTapMs)} ms`);
  for (const [k, [a, s]] of Object.entries(BUDGET.taps)) {
    const x = tapBest[k] || { answered: Infinity, shown: Infinity };
    // (Infinity: what it taps, or what it waits for, wasn't found: a selector above to update.)
    const miss = (tapRes[k] || []).map((t) => t.missing).find(Boolean);
    check(`${k}: answered within ${a} ms, its result within ${s} ms`, x.answered <= a && x.shown <= s, miss ? `nothing to tap at ${miss}` : `${r1(x.answered)} / ${r1(x.shown)} ms`);
  }
  check('saves go through the bridge\'s saveAsync', saveRuns.every((r) => r.asyncSaves > 0), saveRuns.map((r) => r.asyncSaves));
  check('no page errors', errors.length === 0, errors.slice(0, 5));
}

await browser.close();
await server.close();
done();
