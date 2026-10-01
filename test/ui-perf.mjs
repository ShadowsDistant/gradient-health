// Boot, render and save budgets with the CPU slowed 4x (CDP Emulation.setCPUThrottlingRate), in
// Chromium at phone size, with someone five weeks in. Each number is the best of 3 runs, so a busy
// machine makes a run slower but rarely all three.
//
// - boot: from navigation start to the first frame that shows Today's session, each run in a fresh
//   browser context (its own renderer, so nothing compiled earlier is reused)
// - long tasks: none over the budget in the 10 s after that first frame
// - tab render: switching tabs, the time U.go() takes (the render), p95 over every tab
// - a feel tap on Today: the re-render it causes
// - a save: U.save() itself, and the longest task any timer or idle callback runs in the 1.5 s after
//   (where the write happens)
//
// Usage: node test/ui-perf.mjs [--measure] [--dist=<dir>] [--runs=3]
//   --measure  print the numbers only, no checks (how the baselines below were taken)
//   --dist     a built page somewhere else (a copy of an older dist/), to compare on the same machine
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
// (WebGL in software), 390 x 844 at 2x, CPU slowed 4x, best of 3. Then the longest task after the
// first frame was 2.6 s: the 3D figure's warm-up, which started right after the first paint.
const BASE = {
  bootMs: 954, // navigation start to the first frame with Today's session
  tabP95Ms: 152, // U.go() between tabs, p95 (to the next frame: 191)
  feelMs: 30, // Today's re-render after a feel tap
  saveMs: 7.5, // the longest task a save runs (13-20 ms in the other runs)
  distBytes: 2551794, // dist/gradient-health.html
};
const BUDGET = {
  bootMs: Math.round(BASE.bootMs * 0.7),
  tabP95Ms: 50,
  feelMs: 30,
  longTaskMs: 200,
  saveMs: 8,
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

// One launch, in a fresh context: the bridge and the state are there before the page loads.
async function launch() {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(seedBridge);
  await ctx.addInitScript(asyncBridge);
  await ctx.addInitScript((json) => { try { if (!sessionStorage.getItem('shot-state')) sessionStorage.setItem('shot-state', json); } catch (e) { /* ignore */ } }, stateJson);
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  watch(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__perf && window.__perf.firstRender > 0, null, { timeout: 60000 });
  return { ctx, page, cdp };
}

/* ---------------------------------------------------------------- boot */
section(`Boot (CPU ${CPU}x slower, best of ${RUNS})`);
const boots = [];
let live = null;
for (let i = 0; i < RUNS; i++) {
  const run = await launch();
  // Ten seconds after the first frame: the health sync, What's new, the 3D figure's warm-up.
  const t = await run.page.evaluate(() => window.__perf.firstRender);
  await run.page.waitForFunction((t0) => performance.now() > t0 + 10000, t, { timeout: 120000, polling: 250 });
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
    U.go('today');
    await frames();
    let n = 0;
    const orig = scr.render;
    scr.render = function (...a) { n++; return orig.apply(this, a); };
    const r1 = await U.syncHealth('manual'); // the same data as the last read
    await frames();
    const quiet = n;
    delete U.S.health.days[U.today()]; // today's record lost: this read brings it back
    n = 0;
    const r2 = await U.syncHealth('manual');
    await frames();
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
  check('every request went to the API, and only there', sent.length >= 5 && sent.every((u) => u.startsWith('https://api.anthropic.com/')), sent);
  // The chat on screen, end to end.
  await page.evaluate(() => { window.GH.ui.S.ai.chat = []; window.GH.ui.go('today'); });
  await pause(500);
  await page.click('#topbar .coach-btn');
  await page.waitForSelector('dialog.chat-sheet[open] #askQ', { timeout: 15000 });
  await page.fill('#askQ', 'Should I train today?');
  await page.click('.chat-sheet [data-act="askSend"]');
  const answered = await page.waitForFunction(() => { const x = [...document.querySelectorAll('.chat-sheet .bubble.coach')].pop(); return x && /same bedtime/.test(x.textContent) && !x.classList.contains('is-typing'); }, null, { timeout: 20000 }).then(() => true, () => false);
  check('the chat answers on screen through it', answered, await page.evaluate(() => [...document.querySelectorAll('.chat-sheet .bubble')].map((b) => b.textContent.slice(0, 80))));
  await page.evaluate(() => window.GH.ui.closeSheets());
}

const distBytes = statSync(arg('dist', '') ? join(resolve(arg('dist', '')), 'gradient-health.html') : join(root, 'dist/gradient-health.html')).size;
console.log(`\n  boot ${r1(bootMs)} ms · longest task after it ${longMs} ms · tab p95 ${r1(tabP95)} ms · feel re-render ${r1(feelMs)} ms · save ${r1(saveMs)} ms · dist ${distBytes} bytes`);
if (BASE.bootMs) console.log(`  against the baseline: boot ${r1(bootMs / BASE.bootMs * 100)}%, tab p95 ${r1(tabP95 / BASE.tabP95Ms * 100)}%, feel ${r1(feelMs / BASE.feelMs * 100)}%, save ${r1(saveMs / BASE.saveMs * 100)}%, dist ${r1(distBytes / BASE.distBytes * 100)}%`);

if (!measureOnly) {
  section('Budgets');
  check(`boot ≤ ${BUDGET.bootMs} ms (0.7 x the baseline ${BASE.bootMs} ms)`, bootMs <= BUDGET.bootMs, `${r1(bootMs)} ms`);
  check(`no long task over ${BUDGET.longTaskMs} ms after the first render`, longMs <= BUDGET.longTaskMs, `${longMs} ms`);
  check(`tab render p95 ≤ ${BUDGET.tabP95Ms} ms`, tabP95 <= BUDGET.tabP95Ms, `${r1(tabP95)} ms`);
  check(`Today's re-render after a feel tap ≤ ${BUDGET.feelMs} ms`, feelMs <= BUDGET.feelMs, `${r1(feelMs)} ms`);
  check(`a save blocks the main thread ≤ ${BUDGET.saveMs} ms`, saveMs <= BUDGET.saveMs, `${r1(saveMs)} ms`);
  check('saves go through the bridge\'s saveAsync', saveRuns.every((r) => r.asyncSaves > 0), saveRuns.map((r) => r.asyncSaves));
  check('no page errors', errors.length === 0, errors.slice(0, 5));
}

await browser.close();
await server.close();
done();
