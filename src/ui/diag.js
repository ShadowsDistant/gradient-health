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
 * which look this phone draws smoothly. The frames are timed on the page's own animation frames: when
 * the GPU falls behind, the browser holds the next frame back, and the gaps show it.
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
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return '?';
    const c = String(el.className || '').trim().split(/\s+/).filter((x) => x && !/^rf-list-/.test(x))[0];
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${c ? '.' + c : ''}`;
  };

  /* ---------------------------------------------------------------- the scroll, once a frame */
  let until = 0, running = false;
  function tick() {
    const t = now();
    S.push([t, topNow(), 0]);
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
    const t = now();
    const p = e.touches[0] || e.changedTouches[0];
    const route = U.route || {};
    // [t, type, x, y, delay, touches, target, tab, view, sheet open]
    T.push([t, e.type, p ? Math.round(p.clientX) : -1, p ? Math.round(p.clientY) : -1, Math.round(t - e.timeStamp), e.touches.length,
      e.type === 'touchstart' ? desc(e.target) : '', route.tab || '', route.view || '', e.type === 'touchstart' && !!doc.querySelector('.gh-sheet')]);
    if (e.type === 'touchstart') touchSeq++;
    if (e.type === 'touchstart' || e.type === 'touchmove') wake(2500); else wake(2000);
    if (T.length > 3000) T.splice(0, 500);
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) doc.addEventListener(type, onTouch, { passive: true, capture: true });
  doc.addEventListener('scroll', (e) => { if (e.target === screen()) { S.push([now(), topNow(), 1]); wake(1500); } }, { passive: true, capture: true });

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
      const [t, type, x, y, delay, fingers, target, tab, view, sheet] = r;
      if (type === 'touchstart' && !g) { g = { t0: t, t1: null, x0: x, y0: y, yMin: y, yMax: y, yEnd: y, moves: 0, delay, target, tab, view, sheet, fingers: 1 }; continue; }
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
    bits.push(`${stuck ? '*' : late ? '~' : ' '} ${clock(g.t0)} ${g.view || g.tab}${g.sheet ? ' (sheet open)' : ''} · finger ${up ? 'up' : 'down'} ${Math.round(travel)} px in ${Math.round(t1 - g.t0)} ms${g.moves ? '' : ' (a tap)'} on ${g.target}${g.cancel ? ', cancelled' : ''}`);
    bits.push(`page moved ${Math.round(moved)} px while down${first ? ` (first at ${Math.round(first[0] - g.t0)} ms${first[0] > t1 ? ', after the lift' : ''})` : travel >= 120 ? ' (never)' : ''}, then ${Math.round(Math.abs(topEnd - topLift))} px more${holds.length ? `; held ${holds.join(', ')}` : ''}`);
    bits.push(`frames ${frames.length}, longest gap ${Math.round(gap)} ms`);
    bits.push(long.length ? `thread held ${long.length}x, longest ${longest[2]} ms (frame of ${longest[1]} ms at ${clock(longest[0])}${longest[0] < g.t0 ? ', before' : longest[0] > t1 ? ', after' : ''})${longest[3] ? ': ' + longest[3] : ''}` : 'thread free');
    bits.push(`input delay up to ${delay} ms`);
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
    ['lite', 'light, glow hidden (Flat)', { 'data-glass-lite': '' }],
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
  // opts.ms: how long each look runs (default 2200); opts.settle: the wait before each (default 400).
  async function speedTest(opts) {
    if (speedRunning) return speed;
    const ms = (opts && opts.ms) || 2200, settle = (opts && opts.settle) != null ? opts.settle : 400;
    speedRunning = true; speedAbort = false;
    const html = doc.documentElement;
    const abort = () => { speedAbort = true; };
    doc.addEventListener('touchstart', abort, { passive: true, capture: true });
    doc.addEventListener('keydown', abort, { passive: true, capture: true });
    const rows = [];
    try {
      if (U.closeSheets) U.closeSheets();
      // A long page with the tab bar under it: Plan (or the page this is, when it's no tab).
      if (U.go && !(opts && opts.stay)) U.go('plan');
      await wait(1300);
      if (U.motion && U.motion.settled) await U.motion.settled();
      const sc = screen();
      if (sc) sc.scrollTop = 0;
      if (U.glassHold) U.glassHold(true);
      const run = async (id, label, attrs, count) => {
        for (const a of GX_ATTRS) html.removeAttribute(a);
        for (const k of Object.keys(attrs)) html.setAttribute(k, attrs[k]);
        sc.scrollTop = 0;
        await wait(settle);
        if (speedAbort) return;
        const r = summarize(await scrollRun(ms));
        if (count && !speedAbort) rows.push(Object.assign({ id, label }, r)); // a look cut short by a touch isn't counted
      };
      await run('warm', '', LOOKS[0][2], false);
      for (const [id, label, attrs] of LOOKS) { if (speedAbort) break; await run(id, label, attrs, true); }
    } finally {
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
    speed = { when: new Date().toISOString().replace('T', ' ').slice(0, 19), page: (U.route && (U.route.view || U.route.tab)) || '?', ms, rows, stopped: speedAbort };
    return speed;
  }
  function speedLines() {
    if (!speed) return ['Glass speed test: not run (Settings, About, Scroll diagnostics)'];
    const out = [`Glass speed test (${speed.when}, ${speed.page}, each look ${(speed.ms / 1000).toFixed(1)} s, frame times in ms; fewer frames over 20 ms is smoother${speed.stopped ? '; STOPPED by a touch' : ''}):`];
    const best = speed.rows.reduce((m, r) => (m && m.p95 <= r.p95 ? m : r), null);
    for (const r of speed.rows) out.push(`  ${r.label.padEnd(36)} ${String(r.fps).padStart(3)} fps · median ${r.p50} · p95 ${r.p95} · worst ${r.max} · over 20 ms ${r.over20}% · over 33 ms ${r.over33}%${best && r === best ? '   <- smoothest' : ''}`);
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
    const gs = U.glassState ? U.glassState() : null;
    lines.push(`Settings: glass ${['frosted', 'flat'].includes(pr.glass) ? pr.glass : 'liquid'}${gs && gs.lite ? ' (light now)' : ''} · density ${pr.density == null ? 0.5 : pr.density} · theme ${pr.theme || 'system'} (${doc.documentElement.getAttribute('data-theme') || '?'}) · moving background ${pr.glowMove === false ? 'off' : 'on'} · contrast ${pr.contrast ? 'on' : 'off'} · reduced motion ${U.reduced && U.reduced() ? 'on' : 'off'} · figure ${pr.figure || '3d'} · text ${doc.documentElement.style.fontSize || 'normal'}`);
    const gl = gestures().slice(-14).reverse();
    lines.push(`Gestures, newest first (${gl.length} of the last ${Math.round(KEEP_MS / 60000)} min; * the page didn't follow the finger, ~ it followed late):`);
    for (const g of gl) lines.push('  ' + describe(g));
    if (!gl.length) lines.push('  none yet');
    for (const l of speedLines()) lines.push(l);
    const worst = L.slice().sort((a, b) => b[2] - a[2]).slice(0, 6).sort((a, b) => b[0] - a[0]);
    lines.push(`Longest the thread was held, newest first:`);
    for (const l of worst) lines.push(`  ${clock(l[0])} · ${l[2]} ms of a ${l[1]} ms frame${l[3] ? ': ' + l[3] : ''}`);
    if (!worst.length) lines.push('  nothing over 50 ms');
    return lines.join('\n');
  }
  GH.diag = { report, gestures, speedTest, _streams: () => ({ T, S, L, E }) };

  /* ---------------------------------------------------------------- Settings */
  U.act.scrollDiag = () => {
    const txt = report();
    U.sheet({
      title: 'Scroll diagnostics', size: 'full',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">If a scroll freezes or jumps, open this right after and copy or share it to the developer. It's what the last few minutes of touches, scrolling, frames and the page's own work looked like on this phone; nothing is sent anywhere by itself.</p></div>
        <ul class="rf-list">${U.row({ key: 'diag-copy', icon: 'copy', tone: 'teal', title: 'Copy', act: 'diagCopy' })}${U.row({ key: 'diag-share', icon: 'share', tone: 'violet', title: 'Share', sub: 'To a message, an email or a note', act: 'diagShare' })}${U.row({ key: 'diag-speed', icon: 'bolt', tone: 'amber', title: 'Glass speed test', sub: 'About 20 seconds. The page scrolls by itself in a few looks of the glass, and the report says which one this phone draws smoothly. Leave the screen alone', act: 'diagSpeed', chevron: true })}</ul>
        <textarea class="rf-input preview" readonly aria-label="Scroll diagnostics">${U.esc(txt)}</textarea>`,
    });
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
