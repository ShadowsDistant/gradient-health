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
// Usage: node test/ui-scroll.mjs [--measure] [--dist=<dir>] [--runs=2] [--only=today,badges]
//   --measure  print the numbers only, no checks
//   --dist     a built page somewhere else (a copy of an older dist/), to compare on the same machine
//   --ablate   switch one suspect off, to see what it costs: filters (every backdrop filter), lens (the
//              refraction only), glow (the moving background), shimmer (the progress bars' sheen)
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
// Set from 1.7.0's own numbers, per screen: the frames dropped while scrolling, and the GPU's draw
// time per frame (p95).
const BUDGET = {
  droppedPct: 20,
  drawP95Ms: 30,
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
    else if (id === 'setup') await U.editAnswers();
  }, id);
  await page.waitForTimeout(900);
  if (id === 'badges-next') { await page.click('#screen [data-on="badgeFilter"] input[value="next"]', { force: true }); await page.waitForTimeout(600); }
  // Whatever moves after a route change settles (src/ui/motion.js).
  await page.evaluate(() => (window.GH.ui.motion && window.GH.ui.motion.settled ? window.GH.ui.motion.settled() : null)).catch(() => null);
  await page.waitForTimeout(700);
}

// CSS that switches one suspect off (--ablate).
const ABLATIONS = {
  filters: '*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
  lens: '.rf-lens-layer,.rf-glass[data-lens]::before{filter:none!important}',
  glow: '.app::before,.app::after{display:none!important;animation:none!important}',
  shimmer: '.rf-progress-fill::after{animation:none!important}',
};

/* ---------------------------------------------------------------- the page */
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
function asyncBridge() {
  if (window.AndroidBridge) window.AndroidBridge.saveAsync = () => true;
}

const server = await serve();
const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' };
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
};
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] : 0; };
const r1 = (x) => Math.round(x * 10) / 10;

// CPU time (ms) of the browser's GPU and renderer processes, from /proc (Linux; elsewhere nothing).
function cpu() {
  const out = {};
  let dirs = [];
  try { dirs = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch (e) { return out; }
  for (const d of dirs) {
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      const type = (cmd.match(/--type=(gpu-process|renderer)/) || [])[1];
      if (!type || !/chrom/i.test(cmd)) continue;
      const f = readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ');
      out[type] = (out[type] || 0) + (Number(f[11]) + Number(f[12])) * 10;
    } catch (e) { /* gone */ }
  }
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

async function open() {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((j) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', j); } catch (e) { /* ignore */ } }, flatJson);
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(server.url);
  await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 60000 });
  // What's new and anything else that opens itself after launch.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.GH.ui.closeSheets && window.GH.ui.closeSheets());
  await page.waitForTimeout(500);
  if (ABLATE) await page.addStyleTag({ content: ABLATIONS[ABLATE] || '' });
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

section(`Scrolling (CPU ${CPU}x slower, best of ${RUNS}${ABLATE ? `, without ${ABLATE}` : ''})`);
const results = {};
let idle = null;
for (const id of SCREENS) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page, cdp } = await open();
    await show(page, id);
    if (id === 'today' && idle === null) idle = await idleAnimations(page);
    runs.push(await scroll(page, cdp));
    await ctx.close();
  }
  const b = runs.reduce((m, x) => (x.drawP95 < m.drawP95 ? x : m), runs[0]);
  results[id] = b;
  console.log(`  ${id}: dropped ${r1(b.droppedPct)}% of ${b.presented + b.dropped} frames, draw p95 ${r1(b.drawP95)} ms (mean ${r1(b.drawMean)}), GPU ${Math.round(b.gpu)} ms/s, renderer ${Math.round(b.renderer)} ms/s, blocking ${Math.round(b.blocking)} ms, moved ${Math.round(b.moved)} px (runs: ${runs.map((x) => `${r1(x.drawP95)} ms, ${r1(x.droppedPct)}%`).join('; ')})`);
}
console.log(`  idle on Today: ${idle && idle.length ? idle.join('; ') : 'nothing animating forever that the compositor can\'t run'}`);
console.log(`  json: ${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { dropped: r1(v.droppedPct), drawP95: r1(v.drawP95), gpu: Math.round(v.gpu), renderer: Math.round(v.renderer), blocking: Math.round(v.blocking) }])))}`);

if (!measureOnly) {
  for (const [id, v] of Object.entries(results)) {
    check(`${id}: the scroll moved the page`, v.moved > 300, `${Math.round(v.moved)} px`);
    check(`${id}: ${BUDGET.droppedPct}% of frames or fewer dropped while scrolling`, v.droppedPct <= BUDGET.droppedPct, `${r1(v.droppedPct)}%`);
    check(`${id}: a frame draws in ${BUDGET.drawP95Ms} ms or less (p95)`, v.drawP95 <= BUDGET.drawP95Ms, `${r1(v.drawP95)} ms`);
  }
  if (idle !== null) check('at rest on Today, nothing animates forever that the compositor can\'t run alone', idle.length === 0, idle);
  check('no page errors', errors.length === 0, errors.slice(0, 5).join('\n'));
}

await browser.close();
await server.close();
done();
