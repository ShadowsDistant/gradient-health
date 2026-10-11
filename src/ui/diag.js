/* Scroll diagnostics (Settings, About, "Scroll diagnostics"; GH.diag.report()): a record of what each
 * touch, the scroll, the frames and the page's thread did, kept in memory for the last few minutes,
 * for the owner to copy or share when a scroll freezes or jumps on a phone. Nothing about that can be
 * measured off the phone (a software renderer on a desktop scrolls its own way), and after two rounds
 * of fixes made from a screen recording the freeze was still there: this says what happened.
 *
 * What's recorded, all of it cheap: every touch (a passive listener in the capture phase: where, when,
 * and how late it reached the page, the event's own time against the clock), the scroller's position
 * once a frame while a finger is down or a scroll runs and for a moment after (a requestAnimationFrame
 * loop that stops by itself), its scroll events, every long animation frame with the scripts in it
 * (or long tasks where those aren't supported), and the input delays the Event Timing API reports.
 * The report lists the device and the settings that bear on scrolling, then each gesture: how far
 * the finger went, how far the page went while the finger was down and when it first moved, how far
 * it flung after, the frames drawn and the longest gap between them, any moment the fling held still
 * and then jumped, the longest the thread was held meanwhile and by what, and the touches' delays. A
 * gesture the page didn't follow is marked. Nothing leaves the phone unless the owner shares it.
 *
 * And the glass speed test: with the glass the cause of a freeze on one phone (Flat fixed it) and the
 * emulator unable to say which part of it, the page scrolls itself for about two seconds in each of a
 * few looks (the glass as designed, without the lenses, without the top bar's edge, with the glow
 * hidden, light, light with the glow kept), timing every frame, and the report says
 * which look this phone draws smoothly. The frames are timed on the page's own animation frames, and
 * on Android's (below): the page's can look even while the phone draws them late.
 *
 * And the phone's side (Diagnostics.java, through the diag* and trace* bridge methods): Android's own
 * timing of each frame of the app's window and of each touch, added to each gesture and to each look
 * of the speed test (run at the display's fastest refresh rate, as under a finger), and on request a
 * 12-second recording of the WebView's trace events, summed up by src/tracesum.js: each touch's way
 * from the finger to the screen, each frame's steps, each fling.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document, perf = G.performance;
  if (!doc || !perf || !perf.now) { GH.diag = { report: () => 'No diagnostics here.', gestures: () => [] }; return; }
  const now = () => perf.now();
  const KEEP_MS = 5 * 60000; // the last five minutes
  const T = [], S = [], L = [], E = []; // touches, scroll samples, long frames, event timing
  const prune = (list) => { const cut = now() - KEEP_MS; let i = 0; while (i < list.length && list[i][0] < cut) i++; if (i) list.splice(0, i); };
  const screen = () => doc.getElementById('screen');
  const topNow = () => { const s = screen(); return s ? s.scrollTop : 0; };
  // The glass effects setting a gesture started under, so flicks in different looks can be told apart
  // in one report.
  const glassNow = () => { const g = U.glassState && U.glassState(); return (g && g.mode) || doc.documentElement.getAttribute('data-glass') || ''; };
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return '?';
    const c = String(el.className || '').trim().split(/\s+/).filter((x) => x && !/^rf-list-/.test(x))[0];
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${c ? '.' + c : ''}`;
  };

  /* ---------------------------------------------------------------- the scroll, once a frame */
  // The position is read once the frame is drawn (a message posted from the frame's callback, or
  // from a scroll event, runs as a task after the frame's style and layout), with the time it was
  // asked for. Read in the frame's callback itself, scrollTop made the page's style and layout catch
  // up there with everything that frame was about to change: after a tab change, with the new page
  // and the tab bar's moving glass, a recalculation of hundreds of elements in every frame for the
  // two seconds after each touch, all of it on top of the frame's own.
  const pend = [];
  const mc = G.MessageChannel ? new G.MessageChannel() : null;
  let posted = false;
  if (mc) mc.port1.onmessage = () => { posted = false; const y = topNow(); for (const [t, k] of pend) S.push([t, y, k]); pend.length = 0; };
  const sample = (t, kind) => {
    if (!mc) { S.push([t, topNow(), kind]); return; }
    pend.push([t, kind]);
    if (!posted) { posted = true; mc.port2.postMessage(0); }
  };
  let until = 0, running = false;
  function tick() {
    const t = now();
    sample(t, 0);
    if (t < until) G.requestAnimationFrame(tick); else running = false;
    if (S.length > 4000) S.splice(0, 500);
  }
  function wake(ms) {
    until = Math.max(until, now() + ms);
    if (!running && G.requestAnimationFrame) { running = true; G.requestAnimationFrame(tick); }
  }

  /* ---------------------------------------------------------------- touches and scrolls */
  let touchSeq = 0;
  const onTouch = (e) => {
    // The glass speed test's own flicks aren't gestures to report (there are dozens, and the report
    // lists the last few): it reports them itself.
    if (speedRunning) return;
    const t = now();
    const p = e.touches[0] || e.changedTouches[0];
    const route = U.route || {};
    // [t, type, x, y, delay, touches, target, tab, view, sheet open, glass effects]
    T.push([t, e.type, p ? Math.round(p.clientX) : -1, p ? Math.round(p.clientY) : -1, Math.round(t - e.timeStamp), e.touches.length,
      e.type === 'touchstart' ? desc(e.target) : '', route.tab || '', route.view || '', e.type === 'touchstart' && !!doc.querySelector('.gh-sheet'),
      e.type === 'touchstart' ? glassNow() : '']);
    if (e.type === 'touchstart') touchSeq++;
    if (e.type === 'touchstart' || e.type === 'touchmove') wake(2500); else wake(2000);
    if (T.length > 3000) T.splice(0, 500);
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) doc.addEventListener(type, onTouch, { passive: true, capture: true });
  doc.addEventListener('scroll', (e) => { if (e.target === screen()) { sample(now(), 1); wake(1500); } }, { passive: true, capture: true });

  /* ---------------------------------------------------------------- the thread, and input delays */
  let loaf = false;
  try {
    new G.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).filter((x) => x.duration >= 8).sort((a, b) => b.duration - a.duration).slice(0, 3)
          .map((x) => `${x.invoker || ''} ${x.sourceFunctionName || ''}@${x.sourceCharPosition >= 0 ? x.sourceCharPosition : '?'} ${Math.round(x.duration)} ms`.replace(/\s+/g, ' ').trim());
        L.push([e.startTime, Math.round(e.duration), Math.round(e.blockingDuration || 0), scripts.join(' | ')]);
      }
      if (L.length > 1500) L.splice(0, 300);
    }).observe({ type: 'long-animation-frame', buffered: true });
    loaf = true;
  } catch (e) { /* not here */ }
  if (!loaf) {
    try {
      new G.PerformanceObserver((list) => { for (const e of list.getEntries()) L.push([e.startTime, Math.round(e.duration), Math.max(0, Math.round(e.duration - 50)), 'long task']); })
        .observe({ type: 'longtask', buffered: true });
    } catch (e) { /* not here either */ }
  }
  try {
    new G.PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (/^(touch|pointer)/.test(e.name)) E.push([e.startTime, e.name, Math.round(e.processingStart - e.startTime), Math.round(e.duration)]);
      if (E.length > 1500) E.splice(0, 300);
    }).observe({ type: 'event', durationThreshold: 16 });
  } catch (e) { /* ignore */ }

  /* ---------------------------------------------------------------- the phone's side */
  // What the page can't see from inside the WebView, from the Android side (Diagnostics.java):
  // Android's timing of each frame of the app's window (how late it was, the GPU's time, how long it
  // waited for the UI thread) and how late each touch reached the app's UI thread, for any stretch
  // of time; and on request a recording of the WebView's own trace events, which the page reads back
  // a piece at a time and sums up (src/tracesum.js): each touch's way to the screen, each frame's
  // steps, each fling.
  const bridge = () => G.AndroidBridge || null;
  const wallAt = (t) => Math.round((perf.timeOrigin || (Date.now() - now())) + t);
  function appFrames(a, b) {
    const br = bridge();
    if (!br || !br.diagFrames) return null;
    try { const s = br.diagFrames(wallAt(a), wallAt(b)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function display() {
    const br = bridge();
    if (!br || !br.diagDisplay) return null;
    try { const s = br.diagDisplay(); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  const tri = (a) => (a && a.length ? a.join('/') : '-');
  function appLine(o) {
    if (!o) return '';
    if (!o.frames && !o.touches) return 'Android: no frames or touches recorded';
    const bits = [];
    if (o.frames) bits.push(`Android drew ${o.frames} frames, ${o.overDeadline} late${o.overDeadlineByHalf ? ` (${o.overDeadlineByHalf} by half a frame or more)` : ''}; ms p50/p95/max: frame ${tri(o.total)}${o.gpu ? `, GPU ${tri(o.gpu)}` : ''}, RenderThread ${tri(o.command)}, waiting for the UI thread ${tri(o.waitUi)}`);
    if (o.touches) bits.push(`touches reached the app ${tri(o.touchLate)} ms late`);
    return bits.join('; ');
  }
  // The last recording: { when, page, glass, bytes, readMs, lines, app }.
  let trace = null, recording = false;
  // opts.keep false: the recording is only returned, not kept as the report's (the speed test's own,
  // which has a line of its own); opts.glass: what to call the glass it ran under.
  async function record(secs, onTick, opts) {
    const br = bridge();
    if (!br || !br.traceStart || !br.traceStop || !br.traceRead) throw new Error('Recording needs the Android app, on Android 9 or newer');
    if (recording) throw new Error('A recording is already running');
    if (!br.traceStart()) throw new Error("The phone wouldn't start a recording");
    recording = true;
    const hooks = G.__gh || (G.__gh = {});
    const t0 = now();
    let stopped = false;
    try {
      for (let left = Math.max(1, secs); left > 0; left--) {
        if (onTick && onTick(left) === false) break;
        await wait(1000);
      }
      const t1 = now();
      const saved = new Promise((resolve) => {
        const timer = G.setTimeout(() => { hooks.onTraceSaved = null; resolve(-2); }, 60000);
        hooks.onTraceSaved = (bytes) => { G.clearTimeout(timer); hooks.onTraceSaved = null; resolve(Number(bytes)); };
      });
      if (onTick) onTick(0);
      if (!br.traceStop()) throw new Error("The recording couldn't be stopped");
      stopped = true;
      const bytes = await saved;
      if (bytes < 0) throw new Error(bytes === -2 ? 'The recording took too long to save' : "The recording couldn't be saved");
      const sum = GH.traceSum.create();
      const r0 = now();
      for (let i = 0; ; i++) {
        const chunk = br.traceRead();
        if (chunk == null) break;
        sum.push(chunk);
        if (i % 6 === 5) await wait(0); // the page stays responsive while it reads
      }
      const pr = (U.S && U.S.profile && U.S.profile.prefs) || {};
      const out = {
        when: new Date().toISOString().replace('T', ' ').slice(0, 19),
        page: (U.route && (U.route.view || U.route.tab)) || '?',
        glass: (opts && opts.glass) || (['liquid', 'frosted', 'flat'].includes(pr.glass) ? pr.glass : 'auto'),
        bytes, readMs: Math.round(now() - r0), lines: GH.traceSum.lines(sum.finish()), app: appFrames(t0, t1),
      };
      if (!opts || opts.keep !== false) trace = out;
      return out;
    } finally {
      recording = false;
      if (!stopped) { try { br.traceStop(); } catch (e) { /* ignore */ } }
      try { if (br.traceDone) br.traceDone(); } catch (e) { /* ignore */ }
    }
  }
  function traceLines() {
    if (!trace) return ['What the phone did (a recording): none yet (Record what the phone does, below the report)'];
    const out = [`What the phone did, recorded ${trace.when} on ${trace.page} with glass ${trace.glass} (${(trace.bytes / 1e6).toFixed(1)} MB, read in ${trace.readMs} ms):`];
    if (trace.app) out.push('  ' + appLine(trace.app));
    for (const l of trace.lines) out.push(l);
    return out;
  }

  /* ---------------------------------------------------------------- the report */
  const clock = (t) => { const d = new Date((perf.timeOrigin || Date.now() - now()) + t); const two = (n) => String(n).padStart(2, '0'); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`; };
  let gpu = null;
  function gpuName() {
    if (gpu != null) return gpu;
    gpu = '';
    try {
      const c = doc.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (e) { gpu = ''; }
    return gpu;
  }
  // The touches grouped into gestures: from a first finger down to the last finger up.
  function gestures() {
    const out = [];
    let g = null;
    for (const r of T) {
      const [t, type, x, y, delay, fingers, target, tab, view, sheet, glass] = r;
      if (type === 'touchstart' && !g) { g = { t0: t, t1: null, x0: x, y0: y, yMin: y, yMax: y, yEnd: y, moves: 0, delay, target, tab, view, sheet, glass, fingers: 1 }; continue; }
      if (!g) continue;
      g.delay = Math.max(g.delay, delay);
      g.fingers = Math.max(g.fingers, fingers + (type === 'touchstart' ? 0 : 0));
      if (type === 'touchmove') { g.moves++; g.yMin = Math.min(g.yMin, y); g.yMax = Math.max(g.yMax, y); g.yEnd = y; }
      if ((type === 'touchend' || type === 'touchcancel') && fingers === 0) { g.t1 = t; g.cancel = type === 'touchcancel'; out.push(g); g = null; }
    }
    if (g) { g.t1 = now(); g.open = true; out.push(g); }
    return out;
  }
  function describe(g) {
    const t1 = g.t1, after = t1 + 2000;
    const inWin = (a, b) => S.filter((s) => s[0] >= a && s[0] <= b);
    const before = S.filter((s) => s[0] <= g.t0 + 20);
    const top0 = before.length ? before[before.length - 1][1] : (inWin(g.t0, after)[0] || [0, 0])[1];
    const during = inWin(g.t0, t1);
    const moved = during.reduce((m, s) => Math.max(m, Math.abs(s[1] - top0)), 0);
    const first = inWin(g.t0, after).find((s) => Math.abs(s[1] - top0) >= 4);
    const all = inWin(g.t0, after);
    const topLift = during.length ? during[during.length - 1][1] : top0;
    const topEnd = all.length ? all[all.length - 1][1] : topLift;
    const frames = all.filter((s) => s[2] === 0);
    let gap = 0;
    for (let i = 1; i < frames.length; i++) gap = Math.max(gap, frames[i][0] - frames[i - 1][0]);
    // A fling that held still, then jumped: the position unchanged for 150 ms or more after the lift,
    // then a change of 30 px or more at once.
    const holds = [];
    const later = frames.filter((s) => s[0] >= t1);
    for (let i = 0, j; i < later.length; i = j) {
      for (j = i + 1; j < later.length && later[j][1] === later[i][1]; j++);
      if (j < later.length && later[j - 1][0] - later[i][0] >= 150 && Math.abs(later[j][1] - later[i][1]) >= 30) holds.push(`${Math.round(later[j - 1][0] - later[i][0])} ms still then ${Math.round(Math.abs(later[j][1] - later[i][1]))} px`);
    }
    const long = L.filter((l) => l[0] + l[1] >= g.t0 - 1500 && l[0] <= t1 + 1500);
    const longest = long.reduce((m, l) => (l[2] > (m ? m[2] : -1) ? l : m), null);
    const delays = E.filter((e) => e[0] >= g.t0 - 50 && e[0] <= t1 + 50).map((e) => e[2]);
    const delay = Math.max(g.delay, ...delays, 0);
    const travel = Math.max(g.yMax - g.y0, g.y0 - g.yMin);
    const up = g.y0 - g.yMin >= g.yMax - g.y0; // finger went up: the page should move down
    const s = screen();
    const room = s ? (up ? s.scrollHeight - s.clientHeight - top0 : top0) : 0;
    const stuck = travel >= 120 && room > 40 && moved < 10 && !g.sheet && g.fingers < 2;
    const late = !stuck && first && first[0] - g.t0 >= 150;
    const bits = [];
    bits.push(`${stuck ? '*' : late ? '~' : ' '} ${clock(g.t0)} ${g.view || g.tab}${g.sheet ? ' (sheet open)' : ''}${g.glass ? ` · ${g.glass}` : ''} · finger ${up ? 'up' : 'down'} ${Math.round(travel)} px in ${Math.round(t1 - g.t0)} ms${g.moves ? '' : ' (a tap)'} on ${g.target}${g.cancel ? ', cancelled' : ''}`);
    bits.push(`page moved ${Math.round(moved)} px while down${first ? ` (first at ${Math.round(first[0] - g.t0)} ms${first[0] > t1 ? ', after the lift' : ''})` : travel >= 120 ? ' (never)' : ''}, then ${Math.round(Math.abs(topEnd - topLift))} px more${holds.length ? `; held ${holds.join(', ')}` : ''}`);
    bits.push(`frames ${frames.length}, longest gap ${Math.round(gap)} ms`);
    bits.push(long.length ? `thread held ${long.length}x, longest ${longest[2]} ms (frame of ${longest[1]} ms at ${clock(longest[0])}${longest[0] < g.t0 ? ', before' : longest[0] > t1 ? ', after' : ''})${longest[3] ? ': ' + longest[3] : ''}` : 'thread free');
    bits.push(`input delay up to ${delay} ms`);
    const af = appFrames(g.t0 - 50, after);
    if (af) bits.push(appLine(af));
    return bits.join('\n    ');
  }
  /* ---------------------------------------------------------------- the glass speed test */
  // [id, what it is, the attributes it sets on the root]. The first is run once before they are, to
  // warm the shaders up, and not counted.
  const LOOKS = [
    ['liquid', 'the glass as designed', {}],
    ['nolens', 'blur without the lenses', { 'data-gx-nolens': '' }],
    ['noedge', 'as designed, top bar edge off', { 'data-gx-noedge': '' }],
    ['noglow', 'as designed, glow hidden', { 'data-gx-noglow': '' }],
    ['lite', 'light, glow hidden (Auto while moving, Flat)', { 'data-glass-lite': '' }],
    ['liteglow', 'light, glow kept', { 'data-glass-lite': '', 'data-gx-keepglow': '' }],
  ];
  const GX_ATTRS = ['data-gx-nolens', 'data-gx-noedge', 'data-gx-noglow', 'data-gx-keepglow', 'data-glass-lite', 'data-rf-transparency'];
  let speed = null; // the last run: { when, page, ms, rows: [{ id, label, n, p50, p95, max, over20, over33, fps }] }
  let speedRunning = false, speedAbort = false;
  const pct = (a, q) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  const wait = (ms) => new Promise((r) => G.setTimeout(r, ms));
  // The page scroller back and forth at a medium fling's speed for ms, every frame timed.
  function scrollRun(ms) {
    return new Promise((resolve) => {
      const sc = screen();
      const max = Math.max(0, sc.scrollHeight - sc.clientHeight), amp = Math.max(1, Math.min(max, 1500)), v = 1.8; // px per ms
      const gaps = [];
      let t0 = 0, last = 0;
      const frame = (t) => {
        if (!t0) { t0 = t; last = t; }
        else { gaps.push(t - last); last = t; }
        const x = ((t - t0) * v) % (2 * amp);
        sc.scrollTop = x < amp ? x : 2 * amp - x;
        if (t - t0 < ms && !speedAbort) G.requestAnimationFrame(frame);
        else resolve({ gaps, ms: t - t0 });
      };
      G.requestAnimationFrame(frame);
    });
  }
  function summarize(r) {
    const g = r.gaps, n = g.length;
    return { n, p50: Math.round(pct(g, 0.5) * 10) / 10, p95: Math.round(pct(g, 0.95) * 10) / 10, max: Math.round(g.reduce((m, x) => Math.max(m, x), 0)), over20: n ? Math.round(100 * g.filter((x) => x > 20).length / n) : 0, over33: n ? Math.round(100 * g.filter((x) => x > 33).length / n) : 0, fps: r.ms ? Math.round(1000 * n / r.ms) : 0 };
  }
  // The touch half, where the phone can flick the page (the Android app: AndroidBridge.diagFlick,
  // Diagnostics.java): the same looks, the page flicked by the phone's own touch events, so each scroll
  // goes the way one does under a finger, through Android's UI thread and the web view's touch handling
  // and fling. The half above scrolls the page from the page itself and skips all of that, and on the
  // owner's phone it was smooth in every look while the page stuttered under a finger in Liquid. On
  // Settings, where that was reported most: flicks up the page and back down, every frame timed.
  const FLICK_MS = 110, FLICK_GAP = 950;
  let ownTouchUntil = 0; // the test's own flicks: their touches mustn't stop it
  function flickOnce(x, y, dy) {
    const br = bridge(), d = G.devicePixelRatio || 1;
    if (!br || !br.diagFlick) return false;
    ownTouchUntil = now() + FLICK_MS + 400;
    try { return !!br.diagFlick(Math.round(x * d), Math.round(y * d), Math.round(dy * d), FLICK_MS); } catch (e) { return false; }
  }
  // Flick k of a run: up the page twice (the finger going up), then back down twice.
  function flickAt(k) {
    const w = G.innerWidth, h = G.innerHeight, up = Math.floor(k / 2) % 2 === 0;
    return flickOnce(w * 0.3, up ? h * 0.7 : h * 0.3, (up ? -1 : 1) * h * 0.38);
  }
  // n flicks, FLICK_GAP apart, with the page's frames and its scroll position kept; null if the phone
  // wouldn't flick or a touch stopped the test.
  function flickRun(n) {
    return new Promise((resolve) => {
      const sc = screen();
      const gaps = [], pos = [], starts = [];
      let last = 0, live = true, k = 0;
      const t0 = now();
      const frame = (t) => { if (last) gaps.push(t - last); last = t; pos.push([t, sc.scrollTop]); if (live) G.requestAnimationFrame(frame); };
      G.requestAnimationFrame(frame);
      const end = (ok) => { live = false; resolve(ok ? { gaps, pos, starts, ms: now() - t0 } : null); };
      const next = () => {
        if (speedAbort) { end(false); return; }
        if (k >= n) { end(true); return; }
        starts.push(now());
        if (!flickAt(k)) { end(false); return; }
        k++;
        G.setTimeout(next, FLICK_GAP);
      };
      next();
    });
  }
  // A run of flicks summed up: the page's frames; how long after each touch the page started to move;
  // and each time it held still mid-fling (50 ms or more), then moved on with a jump (15 px or more):
  // the fling stopping and catching up, as the diagnostics saw on the owner's phone.
  function flickSummary(r) {
    const s = summarize(r);
    const startMs = [], holds = [];
    let jump = 0;
    r.starts.forEach((a, k) => {
      const b = k + 1 < r.starts.length ? r.starts[k + 1] : Infinity;
      const p = r.pos.filter((q) => q[0] >= a && q[0] < b);
      const first = p.findIndex((q) => Math.abs(q[1] - (p[0] ? p[0][1] : 0)) >= 2);
      if (first < 1) return;
      startMs.push(p[first][0] - a);
      let lastMove = first;
      for (let j = first + 1; j < p.length; j++) if (p[j][1] !== p[j - 1][1]) lastMove = j;
      let still = 0;
      for (let j = first + 1; j <= lastMove; j++) {
        if (p[j][1] === p[j - 1][1]) { still += p[j][0] - p[j - 1][0]; continue; }
        const step = Math.abs(p[j][1] - p[j - 1][1]);
        if (still >= 50 && step >= 15) { holds.push(still); jump = Math.max(jump, step); }
        still = 0;
      }
    });
    return Object.assign(s, { flicks: r.starts.length, moved: startMs.length, start: startMs.length ? Math.round(pct(startMs, 0.5)) : null, holds: holds.length, hold: holds.length ? Math.round(Math.max(...holds)) : 0, jump: Math.round(jump) });
  }
  // opts.ms: how long each look runs (default 1600); opts.settle: the wait before each (default 400);
  // opts.flicks: the touch half's flicks per look (default 4; 0 leaves it out); opts.record: false
  // leaves out its recorded pass.
  async function speedTest(opts) {
    if (speedRunning) return speed;
    const ms = (opts && opts.ms) || 1600, settle = (opts && opts.settle) != null ? opts.settle : 400;
    const flicks = (opts && opts.flicks) != null ? opts.flicks : 4;
    speedRunning = true; speedAbort = false;
    const html = doc.documentElement;
    const abort = () => { if (now() > ownTouchUntil) speedAbort = true; };
    doc.addEventListener('touchstart', abort, { passive: true, capture: true });
    doc.addEventListener('keydown', abort, { passive: true, capture: true });
    const rows = [], touchRows = [];
    let hz = 0, scrollPage = '', touchPage = '', touchNote = '', touchTrace = null;
    try {
      if (U.closeSheets) U.closeSheets();
      // A long page with the tab bar under it: Plan (or the page this is, when it's no tab).
      if (U.go && !(opts && opts.stay)) U.go('plan');
      await wait(1300);
      if (U.motion && U.motion.settled) await U.motion.settled();
      scrollPage = (U.route && (U.route.view || U.route.tab)) || '?';
      const sc = screen();
      if (sc) sc.scrollTop = 0;
      // Held as Liquid, whatever the setting: its bend (core.js) goes with the glass as designed.
      if (U.glassHold) U.glassHold(true, 'liquid');
      // At the display's fastest rate, as under a finger (most phones switch to it for a touch,
      // and not for a page that scrolls by itself).
      const br = bridge();
      if (br && br.diagRefresh) { try { br.diagRefresh(true); } catch (e) { /* ignore */ } await wait(600); }
      const disp = display();
      hz = disp ? disp.hz : 0;
      const run = async (id, label, attrs, count) => {
        for (const a of GX_ATTRS) html.removeAttribute(a);
        for (const k of Object.keys(attrs)) html.setAttribute(k, attrs[k]);
        sc.scrollTop = 0;
        await wait(settle);
        if (speedAbort) return;
        const a0 = now();
        const r = summarize(await scrollRun(ms));
        // Android's own timing of the same frames: the page's frames alone can look even while
        // the phone draws them late (on the GPU, or on Android's side of the WebView).
        const app = appFrames(a0, now());
        if (count && !speedAbort) rows.push(Object.assign({ id, label, app }, r)); // a look cut short by a touch isn't counted
      };
      await run('warm', '', LOOKS[0][2], false);
      for (const [id, label, attrs] of LOOKS) { if (speedAbort) break; await run(id, label, attrs, true); }
      // The touch half (above), on Settings.
      const bt = bridge();
      if (flicks > 0 && !speedAbort && bt && bt.diagFlick) {
        if (U.open && !(U.route && U.route.view === 'settings')) U.open('settings');
        await wait(1300);
        if (U.motion && U.motion.settled) await U.motion.settled();
        touchPage = (U.route && (U.route.view || U.route.tab)) || '?';
        const runT = async (id, label, attrs, count) => {
          for (const a of GX_ATTRS) html.removeAttribute(a);
          for (const k of Object.keys(attrs)) html.setAttribute(k, attrs[k]);
          const sc2 = screen();
          if (sc2) sc2.scrollTop = 0;
          await wait(Math.max(settle, 500));
          if (speedAbort) return;
          const a0 = now();
          const r = await flickRun(count ? flicks : 2);
          const app = appFrames(a0, now());
          if (!r) { if (!speedAbort) touchNote = 'the phone wouldn\'t flick the page'; return; }
          if (count && !speedAbort) touchRows.push(Object.assign({ id, label, app }, flickSummary(r)));
        };
        await runT('warm', '', LOOKS[0][2], false);
        for (const [id, label, attrs] of LOOKS) { if (speedAbort || touchNote) break; await runT(id, label, attrs, true); }
        // Once more as designed, recorded (the web view's own trace, Android 9+): each touch's way to
        // the screen, each frame's steps and each fling's ticks, under the same flicks.
        if (!speedAbort && !touchNote && !(opts && opts.record === false) && bt.traceStart && !recording) {
          for (const a of GX_ATTRS) html.removeAttribute(a);
          const sc2 = screen();
          if (sc2) sc2.scrollTop = 0;
          await wait(Math.max(settle, 500));
          let k = 0;
          try { touchTrace = await record(Math.max(2, flicks), (left) => { if (left > 0) flickAt(k++); return !speedAbort; }, { keep: false, glass: 'the glass as designed, under the test\'s flicks' }); } catch (e) { touchTrace = { error: String((e && e.message) || e) }; }
        }
      }
    } finally {
      const br = bridge();
      if (br && br.diagRefresh) { try { br.diagRefresh(false); } catch (e) { /* ignore */ } }
      doc.removeEventListener('touchstart', abort, true);
      doc.removeEventListener('keydown', abort, true);
      for (const a of GX_ATTRS) html.removeAttribute(a);
      const sc = screen();
      if (sc) sc.scrollTop = 0;
      // The scroll event of that reset comes a frame later, while the glass is still held (a touch that
      // stopped the test may be down: its scroll would count as a move and lighten the glass for a moment).
      await wait(150);
      if (U.glassHold) U.glassHold(false); // works the attributes out again from the setting
      speedRunning = false;
    }
    speed = { when: new Date().toISOString().replace('T', ' ').slice(0, 19), page: scrollPage || (U.route && (U.route.view || U.route.tab)) || '?', ms, rows, hz, stopped: speedAbort, touchPage, touchRows, touchNote, touchTrace, flicks };
    return speed;
  }
  function speedLines() {
    if (!speed) return ['Glass speed test: not run (Settings, About, Scroll diagnostics)'];
    const out = [`Glass speed test (${speed.when}${speed.hz ? `, display ${speed.hz} Hz` : ''}${speed.stopped ? '; STOPPED by a touch' : ''}):`];
    out.push(`  The page scrolling by itself, on ${speed.page}, each look ${(speed.ms / 1000).toFixed(1)} s: the page's frame times in ms, then Android's; fewer late frames is smoother.`);
    // Smoothest by Android's late frames where it says, else by the page's own.
    const lateShare = (r) => r.app.overDeadline / Math.max(1, r.app.frames);
    const android = speed.rows.length && speed.rows.every((r) => r.app && r.app.frames);
    const score = (r) => (android ? lateShare(r) : r.p95);
    const best = speed.rows.reduce((m, r) => (m && score(m) <= score(r) ? m : r), null);
    // (Under a finger, how late the phone's own touches reached the app says how busy Android's UI
    // thread was: it takes each touch, and in a web view it waits on the page's compositor every frame.)
    const appBits = (r) => (r.app && r.app.frames ? ` · Android: ${r.app.frames} frames, ${r.app.overDeadline} late, frame p95 ${r.app.total ? r.app.total[1] : '-'}${r.app.gpu ? `, GPU p95 ${r.app.gpu[1]}` : ''}${r.app.command ? `, RenderThread p95 ${r.app.command[1]}` : ''}${r.app.waitUi ? `, waiting for the UI thread p95 ${r.app.waitUi[1]}` : ''}${r.app.touches && r.app.touchLate ? `, touches late p95 ${r.app.touchLate[1]}` : ''}` : '');
    for (const r of speed.rows) {
      out.push(`  ${r.label.padEnd(36)} ${String(r.fps).padStart(3)} fps · median ${r.p50} · p95 ${r.p95} · worst ${r.max} · over 20 ms ${r.over20}% · over 33 ms ${r.over33}%${appBits(r)}${best && r === best ? '   <- smoothest' : ''}`);
    }
    // The touch half: the page flicked by the phone's own touch events.
    if (speed.touchRows && speed.touchRows.length) {
      out.push(`  Under a finger (the phone's own touch events), on ${speed.touchPage}, ${speed.flicks} flicks each look: the page's frames, how long after the touch it moved, any time it held still mid-fling then jumped, and Android's frames:`);
      const tAndroid = speed.touchRows.every((r) => r.app && r.app.frames);
      const tScore = (r) => r.holds * 1000 + (tAndroid ? lateShare(r) * 100 : 0) + r.p95 / 100;
      const tBest = speed.touchRows.reduce((m, r) => (m && tScore(m) <= tScore(r) ? m : r), null);
      for (const r of speed.touchRows) {
        const moved = r.moved < r.flicks ? ` · moved on ${r.moved} of ${r.flicks}` : '';
        out.push(`  ${r.label.padEnd(36)} p95 ${r.p95} · worst ${r.max} · over 20 ms ${r.over20}%${r.start != null ? ` · moved ${r.start} ms after the touch` : ''}${moved} · held ${r.holds ? `${r.holds}x, longest ${r.hold} ms, then ${r.jump} px` : 'never'}${appBits(r)}${tBest && r === tBest ? '   <- smoothest' : ''}`);
      }
    } else if (speed.touchNote) out.push(`  Under a finger: not run (${speed.touchNote})`);
    else if (!speed.stopped && speed.flicks !== 0) out.push('  Under a finger: not run (it needs the Android app)');
    const tt = speed.touchTrace;
    if (tt && tt.error) out.push(`  Recorded under the test's flicks: no (${tt.error})`);
    else if (tt) {
      out.push(`  Recorded under the test's flicks, the glass as designed (${(tt.bytes / 1e6).toFixed(1)} MB, read in ${tt.readMs} ms):`);
      if (tt.app) out.push('    ' + appLine(tt.app));
      for (const l of tt.lines) out.push('  ' + l);
    }
    return out;
  }

  function report() {
    prune(T); prune(S); prune(L); prune(E);
    const pr = (U.S && U.S.profile && U.S.profile.prefs) || {};
    const p = GH.platform;
    const lines = [];
    lines.push(`Gradient Health ${p && p.appVersion ? p.appVersion() : GH.VERSION || ''} · scroll diagnostics · ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
    lines.push(`Device: ${G.navigator.userAgent}`);
    lines.push(`Screen ${G.innerWidth}x${G.innerHeight} at ${G.devicePixelRatio}x · ${G.navigator.hardwareConcurrency || '?'} cores · ${G.navigator.deviceMemory ? G.navigator.deviceMemory + ' GB' : 'memory ?'} · GPU: ${gpuName() || '?'} · long frames ${loaf ? 'yes' : 'no'}`);
    const disp = display();
    if (disp) lines.push(`Display: ${disp.hz} Hz now${disp.modes ? ` (it can run at ${disp.modes.join(', ')})` : ''} · Android API ${disp.sdk}`);
    const gs = U.glassState ? U.glassState() : null;
    lines.push(`Settings: glass ${['liquid', 'frosted', 'flat'].includes(pr.glass) ? pr.glass : 'auto'}${gs && gs.lite ? ' (light now)' : ''} · density ${pr.density == null ? 0.5 : pr.density} · theme ${pr.theme || 'system'} (${doc.documentElement.getAttribute('data-theme') || '?'}) · moving background ${pr.glowMove === false ? 'off' : 'on'} · contrast ${pr.contrast ? 'on' : 'off'} · reduced motion ${U.reduced && U.reduced() ? 'on' : 'off'} · figure ${pr.figure || '3d'} · text ${doc.documentElement.style.fontSize || 'normal'}`);
    const gl = gestures().slice(-14).reverse();
    lines.push(`Gestures, newest first (${gl.length} of the last ${Math.round(KEEP_MS / 60000)} min; * the page didn't follow the finger, ~ it followed late):`);
    for (const g of gl) lines.push('  ' + describe(g));
    if (!gl.length) lines.push('  none yet');
    for (const l of traceLines()) lines.push(l);
    for (const l of speedLines()) lines.push(l);
    const worst = L.slice().sort((a, b) => b[2] - a[2]).slice(0, 6).sort((a, b) => b[0] - a[0]);
    lines.push(`Longest the thread was held, newest first:`);
    for (const l of worst) lines.push(`  ${clock(l[0])} · ${l[2]} ms of a ${l[1]} ms frame${l[3] ? ': ' + l[3] : ''}`);
    if (!worst.length) lines.push('  nothing over 50 ms');
    return lines.join('\n');
  }
  GH.diag = { report, gestures, speedTest, record, trace: () => trace, _streams: () => ({ T, S, L, E }) };

  /* ---------------------------------------------------------------- Settings */
  U.act.scrollDiag = () => {
    const txt = report();
    U.sheet({
      title: 'Scroll diagnostics', size: 'full',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">If a scroll freezes or jumps, open this right after and send it to the developer. It holds the last few minutes of touches, scrolling, frames and the page's work on this phone. Nothing is sent by itself.</p></div>
        <ul class="rf-list">${U.row({ key: 'diag-copy', icon: 'copy', tone: 'teal', title: 'Copy', act: 'diagCopy' })}${U.row({ key: 'diag-share', icon: 'share', tone: 'violet', title: 'Share', sub: 'To a message, an email or a note', act: 'diagShare' })}${U.row({ key: 'diag-record', icon: 'activity', tone: 'rose', title: 'Record what the phone does', sub: '12 seconds. Flick the page up and down where it stutters, and the report gets how the phone handled each touch, frame and fling', act: 'diagRecord', chevron: true })}${U.row({ key: 'diag-speed', icon: 'bolt', tone: 'amber', title: 'Glass speed test', sub: 'About a minute. The page scrolls itself, then the phone flicks it like a finger, in a few glass looks. The report says which stays smooth. Don\'t touch the screen', act: 'diagSpeed', chevron: true })}</ul>
        <textarea class="rf-input preview" readonly aria-label="Scroll diagnostics">${U.esc(txt)}</textarea>`,
    });
  };
  // The recording runs on whatever page is under the sheet, which closes for it. A small solid pill
  // (not glass: it would be one more filter in what's being measured) counts down; a tap ends it early.
  U.act.diagRecord = async () => {
    if (U.closeSheets) U.closeSheets();
    const pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'diag-rec';
    let early = false;
    pill.addEventListener('click', () => { early = true; });
    doc.body.appendChild(pill);
    try {
      await record(12, (left) => {
        pill.textContent = left > 0 ? `Recording: flick up and down · ${left}` : 'Reading the recording…';
        return !early;
      });
      U.haptic('success');
    } catch (e) {
      U.toast('No recording', 'caution', String((e && e.message) || e).slice(0, 140));
    } finally {
      pill.remove();
    }
    if (U.act.scrollDiag) U.act.scrollDiag();
  };
  // (No toast while it runs: a toast is glass too, and would be one more filter in the first look.)
  U.act.diagSpeed = async () => {
    try { await speedTest(); } catch (e) { U.toast('The speed test stopped', 'caution', String((e && e.message) || e).slice(0, 120)); }
    if (U.act.scrollDiag) U.act.scrollDiag();
  };
  U.act.diagCopy = async () => {
    const ok = GH.platform && GH.platform.copy ? await GH.platform.copy(report()) : false;
    if (ok) { U.haptic('copy'); U.toast('Copied', 'positive', 'Paste it into a message to the developer.'); } else U.toast("Copying didn't work", 'caution', 'Select the text and copy it, or use Share.');
  };
  U.act.diagShare = () => { if (!(GH.platform && GH.platform.share && GH.platform.share(report(), ''))) U.act.diagCopy(); };
})(typeof window !== 'undefined' ? window : globalThis);
