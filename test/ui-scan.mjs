// The barcode scanner, filmed: Chromium's fake camera plays videos of real EAN-13, UPC-A, EAN-8 and
// UPC-E codes drawn from their digits (test/scanfixture.mjs) under hard conditions (small, turned,
// tilted, blurred, dim, noisy, moving, upside down, on its side, round a can, under glare, outside
// the box, too close) and a shared plan's QR code, and GH.scanner.scan() reads them as the app does.
// It counts how often each reads and how fast, checks no code is ever misread, that the camera
// always stops, what the screen says when nothing reads, the light, focus and zoom requests, the
// platform's own BarcodeDetector when there is one, and the lock-in as a code is caught.
// The videos are made once and kept in build/scan-videos/ (about 250 MB; a change to a scene
// films that one again).
// Usage: node test/ui-scan.mjs [--measure] [--trials=N] [--only=clear,small] [--json=<file>]
//        [--shots=<dir>] [--dist=<dir> --res=720]
//   --measure  6 trials a scene and numbers only: no pass or fail on how often each reads
//   --dist     measure another build the same way (read rates only), e.g. 1.11's; --res=720 films it
//              720 pixels wide, which 1.11's camera request (1280 x 720) gets from a phone held upright
//   --shots    the scanner's screen, light and dark, as PNGs in that folder
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, section, done, serveDist, root, load } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';
import { SCENES, HINT_SCENES, bars, expected, renderer } from './scanfixture.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const MEASURE = process.argv.includes('--measure');
const VERBOSE = process.argv.includes('--verbose');
const DIST = arg('dist', null);
const BASELINE = !!DIST;
const RES = Number(arg('res', 1080));
const TRIALS = Number(arg('trials', MEASURE ? 6 : 2));
const ONLY = arg('only', null) ? arg('only').split(',') : null;
const SHOTS = arg('shots', null);
const JSON_OUT = arg('json', null);
const TIMEOUT = 10000; // ms a trial waits for a read

/* ---------------------------------------------------------------- the plan's QR code */
// A real shared plan, encoded the way the share sheet does.
const P = load('src/data/moves.js', 'src/customplan.js', 'src/qr.js');
const plan = P.customPlan.normalize({
  name: 'Push Pull Legs', note: 'Heavy on Monday.',
  days: [
    { title: 'Push', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'incline_db', sets: 3, reps: 10 }, { move: 'ohp_db', sets: 3, reps: 10 }, { move: 'fly_cable', sets: 3, reps: 12 }, { move: 'pushdown_cable', sets: 3, reps: 12 }, { move: 'raise_cable', sets: 3, reps: 15 }] },
    { title: 'Pull', items: [{ move: 'pulldown', sets: 4, reps: 8 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'face_pull', sets: 3, reps: 15 }, { move: 'curl_bb', sets: 3, reps: 10 }, { move: 'curl_incline', sets: 3, reps: 12 }, { move: 'hang_knee', sets: 3, reps: 12 }] },
    { title: 'Legs', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'rdl_bb', sets: 3, reps: 8 }, { move: 'leg_press', sets: 3, reps: 12 }, { move: 'leg_curl', sets: 3, reps: 12 }, { move: 'calf_smith', sets: 3, reps: 15 }, { move: 'side_plank', sets: 2, secs: 40, rest: 30 }] },
  ],
  weekdays: [0, 2, 4],
}).plan;
const LINK = P.customPlan.link(await P.customPlan.encode(plan, { from: 'Alex' }));
const QR = P.qr.encode(LINK);

/* ---------------------------------------------------------------- the videos */
// Each scene as Motion JPEG (Chromium's fake camera plays .mjpeg files at 30 frames a second,
// looping, from the start each time the camera opens), at 1080 x 1920 and 720 x 1280: a phone held
// upright. Made in a page (the drawing is canvas 2D), kept until the fixture changes.
const ALL = SCENES.concat(HINT_SCENES);
const withSymbol = (sc) => Object.assign({}, sc, sc.format === 'qr_code' ? { qr: { size: QR.size, modules: QR.modules } } : sc.format ? { bits: bars(sc.format, sc.code) } : {});
// Each video is kept under what it's made from: the drawing and the scene (and the plan's link for
// the QR code), so a change to one scene films only that one again.
const VIDEOS = join(root, 'build/scan-videos');
const drawing = renderer.toString();
const keyOf = (sc) => createHash('sha256').update(drawing).update(JSON.stringify(sc)).update(sc.format === 'qr_code' ? LINK : '').digest('hex').slice(0, 10);
const videoFile = (name, res) => { const sc = ALL.find((s) => s.name === name); return join(VIDEOS, `${name}-${keyOf(sc)}-${res}.mjpeg`); };

async function makeVideos() {
  mkdirSync(VIDEOS, { recursive: true });
  // Videos of scenes as they no longer are go.
  const keep = new Set(ALL.flatMap((sc) => [1080, 720].map((res) => videoFile(sc.name, res).split(/[\\/]/).pop())));
  for (const f of readdirSync(VIDEOS)) if (!keep.has(f)) rmSync(join(VIDEOS, f), { recursive: true, force: true });
  const missing = ALL.filter((sc) => !existsSync(videoFile(sc.name, 1080)) || !existsSync(videoFile(sc.name, 720)));
  if (!missing.length) return;
  const t0 = Date.now();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addScriptTag({ content: `window.R = (${renderer.toString()})();` });
  for (const sc of missing) {
    const parts = { 1080: [], 720: [] };
    for (let i = 0; i < sc.frames; i++) {
      const [big, small] = await page.evaluate(async ({ sc, i }) => {
        const c = new OffscreenCanvas(1080, 1920);
        window.R.frame(c, sc, i);
        const d = new OffscreenCanvas(720, 1280), x = d.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(c, 0, 0, 720, 1280);
        const b64 = async (canvas) => {
          const buf = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
          let s = '';
          for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
          return btoa(s);
        };
        return [await b64(c), await b64(d)];
      }, { sc: withSymbol(sc), i });
      parts[1080].push(Buffer.from(big, 'base64'));
      parts[720].push(Buffer.from(small, 'base64'));
    }
    for (const res of [1080, 720]) writeFileSync(videoFile(sc.name, res), Buffer.concat(parts[res]));
    process.stdout.write(`  filmed ${sc.name} (${sc.frames} frames, ${(statSync(videoFile(sc.name, 1080)).size / 1048576).toFixed(1)} MB)\n`);
  }
  await browser.close();
  console.log(`  videos made in ${((Date.now() - t0) / 1000).toFixed(0)} s, in ${relative(root, VIDEOS)}/`);
}

/* ---------------------------------------------------------------- the app */
// Another build's folder is served file by file (lib's server maps extra paths to files).
function filesOf(dir) {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[`/${relative(dir, p).split('\\').join('/')}`] = p; } };
  walk(dir);
  return out;
}
const server = await serveDist(DIST ? filesOf(DIST) : {});

// Before the page loads: keep every camera stream the page opens, and the main thread's long tasks.
function instrument() {
  window.__scan = { streams: [], asked: [], long: [] };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      window.__scan.asked.push(JSON.parse(JSON.stringify(c)));
      const s = await gum(c);
      window.__scan.streams.push(s);
      const t = s.getVideoTracks()[0];
      s.__settings = t ? t.getSettings() : {};
      return s;
    };
  }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__scan.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { /* no long task timing */ }
}

// A browser whose camera plays this scene's video, with the app open and set up.
async function open(sc, opts = {}) {
  const file = videoFile(sc.name, RES);
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: opts.dark ? 'dark' : 'light' });
  await ctx.grantPermissions(['camera'], { origin: new URL(server.url).origin });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(seedBridge);
  await page.addInitScript(instrument);
  for (const s of opts.init || []) await page.addInitScript(s);
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  // The app loads its likely parts while idle a couple of seconds after launch: load them now, so
  // the main thread's long tasks while scanning are the scanner's.
  await page.evaluate(() => Promise.all(['review', 'science', 'shareCard'].map((n) => window.GH.lazy(n).catch(() => null))));
  await page.waitForTimeout(500);
  return { browser, page, errors };
}

// One scan: from the tap to the code (or the timeout, when the sheet is closed). With watch, it
// also notes when the box first showed the code locked in, and the hint shown at hintAt ms.
async function trial(page, sc, o = {}) {
  const r = await page.evaluate(async ({ timeout, qr, link, hintAt }) => {
    const S = window.__scan, GH = window.GH;
    const longFrom = S.long.length, streamsFrom = S.streams.length, hapticsFrom = window.__haptics.length;
    let locked = 0, hint = '';
    const t0 = performance.now();
    const mo = new MutationObserver(() => { if (!locked && document.querySelector('.sc-frame[data-locked]')) locked = performance.now() - t0; });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-locked'] });
    const hintTimer = hintAt ? setTimeout(() => { const m = document.querySelector('dialog.rf-sheet[open] .sc-msg'); hint = m ? m.textContent.trim() : ''; }, hintAt) : 0;
    let timer;
    const p = qr ? GH.scanner.scan({ qr: true, accept: (t) => t === link }) : GH.scanner.scan();
    const got = await Promise.race([p, new Promise((res) => { timer = setTimeout(() => res(undefined), timeout); })]);
    clearTimeout(timer); clearTimeout(hintTimer);
    const ms = performance.now() - t0;
    const stream = S.streams[S.streams.length - 1];
    const set = (stream && stream.__settings) || {};
    const stats = GH.scanner.stats ? GH.scanner.stats() : null;
    if (got === undefined) { GH.ui.closeSheets(); await p; }
    mo.disconnect();
    // Let the sheet slide away and the camera stop.
    await new Promise((res) => setTimeout(res, 700));
    const longs = S.long.slice(longFrom).filter((e) => e.t >= t0 && e.t <= t0 + ms).map((e) => e.d);
    return {
      code: got === undefined ? null : got, ms: Math.round(ms), timedOut: got === undefined, locked: Math.round(locked), hint,
      width: set.width, height: set.height, opened: S.streams.length - streamsFrom,
      stopped: S.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')),
      longest: Math.round(Math.max(0, ...longs)), longTotal: Math.round(longs.reduce((a, b) => a + b, 0)),
      haptics: window.__haptics.slice(hapticsFrom), stats,
    };
  }, { timeout: o.timeout || TIMEOUT, qr: sc.format === 'qr_code', link: LINK, hintAt: o.hintAt || 0 });
  const want = sc.format === 'qr_code' ? LINK : sc.format ? expected(sc.format, sc.code) : null;
  r.read = !!r.code && r.code === want;
  r.misread = !!r.code && r.code !== want;
  // Time to read: from the tap to the code caught (this build shows it locking in for a moment
  // before the sheet closes; 1.11 closed at once, so there it's the same as closing).
  r.readMs = r.stats && r.stats.readAt != null ? r.stats.readAt : r.ms;
  return r;
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const results = [];

await makeVideos();

section(`Reading the videos (${BASELINE ? `the build in ${DIST}` : 'this build'}, ${RES} wide, ${TRIALS} ${TRIALS === 1 ? 'trial' : 'trials'} a scene)`);
for (const sc of SCENES) {
  if (ONLY && !ONLY.includes(sc.name)) continue;
  const { browser, page, errors } = await open(sc);
  const runs = [];
  for (let i = 0; i < TRIALS; i++) runs.push(await trial(page, sc));
  await browser.close();
  const reads = runs.filter((r) => r.read), times = reads.map((r) => r.readMs);
  const row = {
    scene: sc.name, format: sc.format, note: sc.note, trials: runs.length, reads: reads.length, misreads: runs.filter((r) => r.misread).map((r) => r.code),
    first: runs[0].read ? runs[0].readMs : null, median: median(times), times, size: `${runs[0].width}x${runs[0].height}`,
    longest: Math.max(...runs.map((r) => r.longest)), longPerSec: Math.round(runs.reduce((a, r) => a + r.longTotal, 0) / Math.max(1, runs.reduce((a, r) => a + r.ms, 0) / 1000)),
    stopped: runs.every((r) => r.stopped), errors: errors.slice(0, 3), stats: runs.map((r) => r.stats).filter(Boolean),
    locked: runs.filter((r) => r.read).every((r) => r.locked > 0 && r.locked <= r.ms), haptic: runs.filter((r) => r.read).every((r) => r.haptics.includes('scan')),
  };
  results.push(row);
  if (VERBOSE) for (const r of runs) console.log(`      ${r.code || (r.timedOut ? 'timed out' : 'closed')} in ${r.readMs} ms: ${JSON.stringify(r.stats)}`);
  console.log(`  ${sc.name.padEnd(12)} ${String(sc.format || '').padEnd(8)} read ${row.reads}/${row.trials}  median ${row.median == null ? '   -' : `${String(Math.round(row.median)).padStart(5)} ms`}  first ${row.first == null ? '   -' : `${String(row.first).padStart(5)} ms`}  ${row.size}  longest task ${row.longest} ms${row.misreads.length ? `  MISREAD ${row.misreads.join(',')}` : ''}${row.errors.length ? `  errors: ${row.errors.join(' | ')}` : ''}`);
  if (!MEASURE && !BASELINE) {
    check(`${sc.name}: ${sc.note}, read every time (${row.reads}/${row.trials})`, row.reads === row.trials, runs.map((r) => r.code || (r.timedOut ? 'timed out' : 'closed')));
  }
  check(`${sc.name}: never misread`, row.misreads.length === 0, row.misreads);
  check(`${sc.name}: the camera stopped every time the sheet closed`, row.stopped);
  if (!BASELINE) {
    check(`${sc.name}: no errors`, errors.length === 0, errors);
    if (row.reads) {
      check(`${sc.name}: the code locked in the box, then the sheet closed`, row.locked);
      check(`${sc.name}: with the scan haptic`, row.haptic);
    }
  }
}

/* ---------------------------------------------------------------- smoothness */
// A code too far away to read: the reader works all the time. How long the page's thread is held,
// and how evenly the page's frames come, over 4 seconds once the camera and the reader are going.
const scanFor = (page, ms, o = {}) => page.evaluate(async ({ ms, qr }) => {
  window.__p = window.GH.scanner.scan(qr ? { qr: true, accept: () => false } : undefined);
  await new Promise((r) => setTimeout(r, ms));
}, { ms, qr: !!o.qr });
const stopScan = (page) => page.evaluate(async () => { window.GH.ui.closeSheets(); const code = await window.__p; await new Promise((r) => setTimeout(r, 700)); return { code, stopped: window.__scan.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')) }; });
const ALL_ONLY = !ONLY || ONLY.includes('extras');
if (ALL_ONLY) {
  section('The screen stays smooth while it reads');
  const sc = HINT_SCENES.find((s) => s.name === 'far');
  const { browser, page } = await open(sc);
  await scanFor(page, 1500);
  const m = await page.evaluate(async () => {
    // Long animation frames, with the scripts that ran in them: the reader's own (the barcode chunk,
    // a video frame callback) apart from everything else, since other suites running at the same
    // time make every task longer.
    const loaf = [];
    let po = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push(e); }); po.observe({ type: 'long-animation-frame' }); } catch (e) { po = null; }
    const S = window.__scan, from = performance.now(), longFrom = S.long.length, gaps = [];
    let last = from;
    await new Promise((res) => { const step = (t) => { gaps.push(t - last); last = t; if (t - from < 4000) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    if (po) po.disconnect();
    const longs = S.long.slice(longFrom).filter((e) => e.t >= from).map((e) => e.d);
    const own = (s) => /barcode/.test(String(s.sourceURL)) || s.invoker === 'VideoFrameRequestCallback';
    const reader = loaf.filter((e) => e.startTime >= from).map((e) => e.scripts.filter(own).reduce((a, s) => a + s.duration, 0));
    return {
      longest: Math.round(Math.max(0, ...longs)), blocking: Math.round(longs.reduce((a, d) => a + Math.max(0, d - 50), 0) / 4), fps: Math.round(gaps.length / 4), worstGap: Math.round(Math.max(...gaps)),
      reader: po ? Math.round(Math.max(0, ...reader)) : null, readerTotal: po ? Math.round(reader.reduce((a, b) => a + b, 0) / 4) : null,
      stats: window.GH.scanner.stats ? window.GH.scanner.stats() : null,
    };
  });
  await stopScan(page);
  await browser.close();
  const reads = m.stats && m.stats.zxing ? `; the worker read ${m.stats.zxing} pictures in 5.5 s, ${m.stats.ms} ms each` : '';
  console.log(`  the reader's own work: at most ${m.reader} ms in a frame, ${m.readerTotal} ms a second in long frames; all told: longest task ${m.longest} ms, blocking ${m.blocking} ms a second, ${m.fps} frames a second, longest gap between frames ${m.worstGap} ms${reads}`);
  results.push(Object.assign({ scene: 'smoothness' }, m));
  if (!BASELINE) check('the reader never holds the page\'s thread for 50 ms (it reads in a worker)', m.reader !== null && m.reader < 50, m);
}

if (!BASELINE && ALL_ONLY) {
  /* ---------------------------------------------------------------- hints */
  section('What it says when nothing reads');
  const WANT = { dark: 'darkNoTorch', far: 'closer', huge: 'further', shaky: 'steady' };
  for (const sc of HINT_SCENES) {
    const { browser, page, errors } = await open(sc);
    const HINTS = await page.evaluate(() => window.GH.lazy('barcode').then((m) => m.HINTS));
    const r = await trial(page, sc, { timeout: 6000, hintAt: 5600 });
    await browser.close();
    const want = WANT[sc.name];
    check(`${sc.name} (${sc.note}): "${HINTS[want]}"`, r.hint === HINTS[want], { shown: r.hint, stats: r.stats });
    check(`${sc.name}: nothing read, and the camera stopped`, !r.code && r.stopped, r.code);
    check(`${sc.name}: no errors`, errors.length === 0, errors);
  }
  for (const dark of [false, true]) {
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page } = await open(sc, { dark });
    await scanFor(page, 4500);
    const shown = await page.evaluate(() => {
      const el = document.querySelector('dialog.rf-sheet[open] .sc-wrap');
      const view = el.querySelector('.sc-view').getBoundingClientRect(), box = el.querySelector('.sc-frame').getBoundingClientRect();
      const type = el.querySelector('[data-act="scanType"]');
      return { ratio: box.width / box.height, wide: box.width / view.width, msg: el.querySelector('.sc-msg').textContent, type: !!type && !type.hidden && type.getBoundingClientRect().height > 0 && type.textContent.trim(), light: !el.querySelector('[data-act="scanTorch"]').hidden, zoom: getComputedStyle(el.querySelector('.sc-view')).getPropertyValue('--sc-zoom').trim() };
    });
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `scanner-${dark ? 'dark' : 'light'}.png`) }); }
    const end = await stopScan(page);
    await browser.close();
    check(`${dark ? 'dark' : 'light'}: a wide box for a barcode (${shown.ratio.toFixed(2)} to 1, ${Math.round(shown.wide * 100)}% of the picture's width)`, shown.ratio > 1.8 && shown.wide > 0.75, shown);
    check(`${dark ? 'dark' : 'light'}: Type the number is there all along; no light button without a torch`, shown.type === 'Type the number' && !shown.light, shown);
    check(`${dark ? 'dark' : 'light'}: the picture is magnified (no zoom on this camera): ${shown.zoom}`, Number(shown.zoom) > 1.5, shown.zoom);
    check(`${dark ? 'dark' : 'light'}: closing the sheet stops the camera`, end.code === null && end.stopped, end);
  }

  {
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page } = await open(sc);
    await scanFor(page, 1500, { qr: true });
    const qr = await page.evaluate(() => {
      const el = document.querySelector('dialog.rf-sheet[open] .sc-wrap');
      const box = el.querySelector('.sc-frame').getBoundingClientRect();
      return { ratio: box.width / box.height, type: el.querySelector('[data-act="scanType"]').textContent.trim(), title: document.querySelector('dialog.rf-sheet[open] .rf-sheet-title').textContent, zoom: window.GH.scanner.stats().zoom };
    });
    const end = await stopScan(page);
    await browser.close();
    check(`a plan's code: a square box, "Paste a link instead", magnified ${qr.zoom} times`, Math.abs(qr.ratio - 1) < 0.05 && qr.type === 'Paste a link instead' && qr.zoom === 1.4 && end.stopped, qr);
  }

  /* ---------------------------------------------------------------- the camera's controls */
  // Chromium's fake camera has no light, focus or zoom: these stand in for a phone's, record what's
  // asked of them, and leave everything else to the real track.
  section('The light, focus and zoom, on a camera that has them');
  const phoneCamera = () => {
    window.__applied = [];
    const caps = MediaStreamTrack.prototype.getCapabilities;
    MediaStreamTrack.prototype.getCapabilities = function () { const c = caps.call(this); return this.kind === 'video' ? Object.assign({}, c, { torch: true, focusMode: ['manual', 'single-shot', 'continuous'], zoom: { min: 1, max: 8, step: 0.1 } }) : c; };
    const apply = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = function (c) {
      const adv = c && c.advanced;
      if (adv && adv.some((s) => 'torch' in s || 'focusMode' in s || 'zoom' in s || 'pointsOfInterest' in s)) { window.__applied.push(JSON.parse(JSON.stringify(adv[0]))); return Promise.resolve(); }
      return apply.call(this, c);
    };
  };
  {
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page, errors } = await open(sc, { init: [phoneCamera] });
    await scanFor(page, 2500);
    const before = await page.evaluate(() => ({ applied: window.__applied.slice(), light: !document.querySelector('dialog.rf-sheet[open] [data-act="scanTorch"]').hidden, zoom: getComputedStyle(document.querySelector('dialog.rf-sheet[open] .sc-view')).getPropertyValue('--sc-zoom').trim(), stats: window.GH.scanner.stats() }));
    check('it asks for continuous focus', before.applied.some((s) => s.focusMode === 'continuous'), before.applied);
    const z = before.applied.find((s) => 'zoom' in s);
    check(`it zooms the camera itself (${z ? z.zoom : 'no'} times), so the picture isn't magnified as well`, z && z.zoom >= 1.8 && z.zoom <= 2.5 && Math.abs(Number(before.zoom) - 1) < 0.01, before);
    check('the light button shows', before.light);
    await page.click('dialog.rf-sheet[open] [data-act="scanTorch"]');
    await page.waitForTimeout(300);
    const lit = await page.evaluate(() => ({ applied: window.__applied.slice(), pressed: document.querySelector('dialog.rf-sheet[open] [data-act="scanTorch"]').getAttribute('aria-pressed') }));
    check('a tap turns the light on', lit.applied.some((s) => s.torch === true) && lit.pressed === 'true', lit);
    // A tap on the picture, left of centre and a little below it.
    const at = await page.evaluate(() => { const r = document.querySelector('dialog.rf-sheet[open] .sc-view').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.6 }; });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(250);
    const tapped = await page.evaluate(() => ({ poi: window.__applied.find((s) => s.pointsOfInterest), ring: !document.querySelector('dialog.rf-sheet[open] .sc-focus').hidden }));
    const p = tapped.poi && tapped.poi.pointsOfInterest[0];
    // The camera zooms itself here, so the picture isn't magnified: the view shows the frame's full
    // width and the middle three quarters of its height, and (0.3, 0.6) of it is (0.3, 0.575) of the frame.
    check('a tap on the picture focuses there (single shot, at that point of the frame)', tapped.poi && tapped.poi.focusMode === 'single-shot' && Math.abs(p.x - 0.3) < 0.04 && Math.abs(p.y - 0.575) < 0.04, tapped);
    check('with a ring where the finger was', tapped.ring);
    const end = await stopScan(page);
    await browser.close();
    check('the camera stopped', end.stopped);
    check('no errors', errors.length === 0, errors);
  }
  {
    const sc = HINT_SCENES.find((s) => s.name === 'dark');
    const { browser, page } = await open(sc, { init: [phoneCamera] });
    const HINTS = await page.evaluate(() => window.GH.lazy('barcode').then((m) => m.HINTS));
    await scanFor(page, 5500);
    const s = await page.evaluate(() => ({ msg: document.querySelector('dialog.rf-sheet[open] .sc-msg').textContent, hinted: document.querySelector('dialog.rf-sheet[open] [data-act="scanTorch"]').hasAttribute('data-hint') }));
    await stopScan(page);
    await browser.close();
    check(`in the dark, with a light: "${HINTS.dark}", and the light button stands out`, s.msg === HINTS.dark && s.hinted, s);
  }

  /* ---------------------------------------------------------------- the phone's own detector */
  section('The phone\'s own barcode detector, where there is one');
  const platformDetector = () => {
    window.__native = 0;
    window.BarcodeDetector = class {
      constructor(o) { this.formats = (o && o.formats) || []; }
      static async getSupportedFormats() { return ['aztec', 'code_128', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e']; }
      async detect() {
        window.__native++;
        if (window.__native < 3) return [];
        return [{ format: 'upc_a', rawValue: '036000291452', boundingBox: new DOMRectReadOnly(400, 900, 280, 150), cornerPoints: [{ x: 400, y: 900 }, { x: 680, y: 900 }, { x: 680, y: 1050 }, { x: 400, y: 1050 }] }];
      }
    };
  };
  {
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page, errors } = await open(sc, { init: [platformDetector] });
    const r = await trial(page, sc);
    await browser.close();
    check('it reads with the phone\'s detector when ZXing can\'t (UPC-A as 13 digits, as ZXing gives it)', r.code === '0036000291452' && r.stats.engine === 'native', { code: r.code, stats: r.stats });
    check('and locks in with the haptic', r.locked > 0 && r.haptics.includes('scan'));
    check('no errors', errors.length === 0, errors);
  }
  {
    const onlyQr = () => { window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { window.__asked = true; return []; } }; };
    const sc = SCENES.find((s) => s.name === 'clear');
    const { browser, page } = await open(sc, { init: [onlyQr] });
    const r = await trial(page, sc);
    const asked = await page.evaluate(() => !!window.__asked);
    await browser.close();
    check('a detector without food\'s formats is left alone, and ZXing reads', r.read && !asked && r.stats.engine === 'zxing', { asked, stats: r.stats });
  }

  /* ---------------------------------------------------------------- closing */
  section('The camera always stops');
  {
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page } = await open(sc);
    await scanFor(page, 1500);
    await page.click('dialog.rf-sheet[open] [data-sheet-close]');
    const closed = await page.evaluate(async () => { const code = await window.__p; await new Promise((r) => setTimeout(r, 700)); return { code, stopped: window.__scan.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')) }; });
    check('the close button: nothing read, the camera off', closed.code === null && closed.stopped, closed);
    await scanFor(page, 1500);
    const hidden = await page.evaluate(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const code = await window.__p;
      delete document.visibilityState;
      await new Promise((r) => setTimeout(r, 700));
      return { code, stopped: window.__scan.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')), open: !!document.querySelector('dialog.rf-sheet[open] .sc-wrap') };
    });
    check('leaving the app closes it and the camera', hidden.code === null && hidden.stopped && !hidden.open, hidden);
    // Closed while the camera is still starting: it's turned straight off when it comes.
    const early = await page.evaluate(async () => {
      const p = window.GH.scanner.scan();
      window.GH.ui.closeSheets();
      const code = await p;
      await new Promise((r) => setTimeout(r, 1200));
      return { code, stopped: window.__scan.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended')) };
    });
    check('closed before the camera started: it\'s off as soon as it comes', early.code === null && early.stopped, early);
    await browser.close();
  }
  {
    const denied = () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); };
    const sc = HINT_SCENES.find((s) => s.name === 'far');
    const { browser, page } = await open(sc, { init: [denied] });
    await scanFor(page, 800);
    const s = await page.evaluate(() => ({ msg: document.querySelector('dialog.rf-sheet[open] .sc-msg').textContent, form: !document.querySelector('dialog.rf-sheet[open] .sc-type').hidden }));
    await stopScan(page);
    await browser.close();
    check('camera access off: it says so, and the number can be typed', /Camera access is off/.test(s.msg) && s.form, s);
  }
}

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ build: DIST || 'this', res: RES, trials: TRIALS, results }, null, 1));
await server.close();
done();
process.exit(0);
