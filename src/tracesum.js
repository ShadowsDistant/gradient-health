/* What the phone's WebView did, summed up: a recording of Chromium's own trace events (taken on the
 * phone by Bridge.traceStart/traceStop, android.webkit.TracingController, and read back here a chunk
 * at a time) turned into a few lines for the scroll diagnostics report (src/ui/diag.js).
 *
 * The page's own measures (its frames, its thread, where the scroller is) can't see the part of a
 * scroll that happens outside the page: Android's UI thread, which takes each touch and drives a
 * fling, the compositor, which moves the page, and the GPU, which draws it. Chromium times each of
 * those for every touch and every frame, and that's what this reads:
 * - each scroll update's way from the finger to the screen (EventLatency): the time on Android's UI
 *   thread, in the page's compositor, until the frame is drawn and until it's on screen
 * - the frames drawn while the page scrolls (PipelineReporter): how many were dropped, and how long
 *   each step of a frame took
 * - each fling (FlingController): how fast it started and how evenly it was moved along
 * - the GPU's drawing (Graphics.Pipeline), the busiest threads and the longest tasks on any thread.
 *
 * A recording is about 2 MB a second, so it's read as text a piece at a time: a small scanner finds
 * each event in the traceEvents array and parses it alone, and only the sums are kept. Nothing here
 * touches the page; test/tracesum.mjs runs it on traces taken from headless Chromium.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});

  // Scroll updates by EventLatency type: the first of a drag, the rest of it, and a fling's.
  const SCROLL_TYPES = { FIRST_GESTURE_SCROLL_UPDATE: 'first', GESTURE_SCROLL_UPDATE: 'drag', INERTIAL_GESTURE_SCROLL_UPDATE: 'fling' };
  // The stages of a scroll update worth listing, in their order, with a short name.
  const LAT_STAGES = [
    ['GenerationToBrowserMain', 'Android UI thread'],
    ['BrowserMainToRendererCompositor', 'to the compositor'],
    ['RendererCompositorQueueingDelay', 'queued there'],
    ['RendererCompositorProcessing', 'handled'],
    ['RendererCompositorFinishedToBeginImplFrame', 'to its frame'],
    ['RendererCompositorFinishedToEndActivate', 'to its frame'],
    ['EndActivateToSubmitCompositorFrame', 'to submit'],
    ['SubmitCompositorFrameToPresentationCompositorFrame', 'submit to screen'],
    ['ReceiveCompositorFrameToStartDraw', 'to draw'],
    ['StartDrawToSwapStart', 'drawing'],
    ['SwapStartToSwapEnd', 'swap'],
    ['Swap', 'swap'],
    ['SwapEndToPresentationCompositorFrame', 'to screen'],
  ];
  // A frame's stages (PipelineReporter), for the frames drawn while the page scrolled.
  const FRAME_STAGES = [
    ['BeginImplFrameToSendBeginMainFrame', 'start'],
    ['SendBeginMainFrameToCommit', 'page thread'],
    ['Commit', 'commit'],
    ['EndCommitToActivation', 'raster'],
    ['Activation', 'activate'],
    ['EndActivateToSubmitCompositorFrame', 'to submit'],
    ['SubmitCompositorFrameToPresentationCompositorFrame', 'submit to screen'],
    ['StartDrawToSwapStart', 'drawing'],
  ];
  // The GPU's side of a frame, timed on its own.
  const DRAW_NAMES = ['Graphics.Pipeline.DrawAndSwap', 'Graphics.Pipeline.Draw', 'Graphics.Pipeline.WaitForSwap'];
  // Generic task wrappers: real, but they say nothing about what ran inside.
  const GENERIC = /RunTask|ThreadController|SequenceManager|MessageLoop|Looper|ScopedBlockingCall|TaskGraphRunner|ThreadPool_|RunLoop|Scheduler::RunTask/;

  const pct = (a, q) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
  const ms = (us) => Math.round(us / 100) / 10; // microseconds to milliseconds, one decimal
  const tri = (a) => (a.length ? `${ms(pct(a, 0.5))}/${ms(pct(a, 0.95))}/${ms(pct(a, 1))}` : '-');

  function create() {
    /* ------------------------------------------------------------ the scanner */
    // State across chunks: the text not yet scanned, whether the events array has begun, and inside
    // an event, its depth and whether a string is open.
    let buf = '', inEvents = false, ended = false, depth = 0, inStr = false, esc = false, start = -1, scan = 0;
    let count = 0, bad = 0;

    function push(chunk) {
      if (ended || !chunk) return;
      buf += chunk;
      if (!inEvents) {
        // {"traceEvents":[ ... ] ...} or a bare array of events.
        const m = /"traceEvents"\s*:\s*\[/.exec(buf);
        if (m) { inEvents = true; scan = m.index + m[0].length; }
        else if (/^\s*\[/.test(buf)) { inEvents = true; scan = buf.indexOf('[') + 1; }
        else { if (buf.length > 4096) buf = buf.slice(-64); return; }
      }
      let i = scan;
      const n = buf.length;
      for (; i < n; i++) {
        const c = buf.charCodeAt(i);
        if (inStr) {
          if (esc) esc = false;
          else if (c === 92) esc = true; // backslash
          else if (c === 34) inStr = false; // quote
          continue;
        }
        if (c === 34) { if (depth > 0) inStr = true; continue; }
        if (c === 123) { if (depth === 0) start = i; depth++; continue; } // {
        if (c === 125) { // }
          depth--;
          if (depth === 0 && start >= 0) {
            let e = null;
            try { e = JSON.parse(buf.slice(start, i + 1)); } catch (err) { bad++; }
            if (e) { count++; onEvent(e); }
            start = -1;
          }
          continue;
        }
        if (c === 91 && depth > 0) { depth++; continue; } // [ inside an event
        if (c === 93) { // ]
          if (depth > 0) { depth--; continue; }
          ended = true; break; // the end of the events array: what follows is metadata
        }
      }
      // Keep only what an unfinished event needs.
      if (ended) { buf = ''; return; }
      if (start >= 0) { buf = buf.slice(start); start = 0; scan = buf.length; }
      else { buf = ''; scan = 0; }
      if (start === 0) scan = buf.length;
    }

    /* ------------------------------------------------------------ the sums */
    let t0 = Infinity, t1 = -Infinity, vsyncMs = 0;
    const threads = new Map(); // "pid:tid" → thread name
    const procs = new Map(); // pid → process name
    const open = new Map(); // async begins waiting for their end: "pid|id|name" → ts
    const parents = new Map(); // "pid|id" → an EventLatency or PipelineReporter in flight
    const lat = {}; // first / drag / fling → { total: [], stages: { name: [] }, uiOver: n }
    const frames = { scroll: 0, presented: 0, partial: 0, dropped: 0, missing: 0, checker: 0, stages: {}, flags: {} };
    const draws = {}; // GPU drawing names → durations
    const flingTicks = []; // every tick of every fling (FlingController's ProgressFling)
    const flingStarts = []; // when each fling started (HandlingGestureFling)
    const flingSpeeds = [];
    const trackers = { expected: 0, dropped: 0, checkerboarded: 0, n: 0 };
    let janks = 0;
    const busy = new Map(); // "pid:tid" → [start, end, start, end, ...] of complete events
    const byName = new Map(); // "pid:tid" → Map(name → total µs)
    let longs = []; // [dur, "pid:tid", name, ts]

    function onEvent(e) {
      const ph = e.ph, ts = e.ts;
      if (typeof ts === 'number' && ph !== 'M') { if (ts < t0) t0 = ts; const end = ts + (e.dur || 0); if (end > t1) t1 = end; }
      if (ph === 'M') {
        if (e.name === 'thread_name' && e.args) threads.set(`${e.pid}:${e.tid}`, String(e.args.name || ''));
        else if (e.name === 'process_name' && e.args) procs.set(e.pid, String(e.args.name || ''));
        return;
      }
      if (ph === 'X') {
        const d = e.dur || 0;
        if (d <= 0) return;
        const k = `${e.pid}:${e.tid}`;
        let iv = busy.get(k); if (!iv) busy.set(k, (iv = []));
        iv.push(ts, ts + d);
        if (!GENERIC.test(e.name)) {
          let nm = byName.get(k); if (!nm) byName.set(k, (nm = new Map()));
          nm.set(e.name, (nm.get(e.name) || 0) + d);
        }
        if (d >= 16000) {
          longs.push([d, k, e.name, ts]);
          if (longs.length > 400) { longs.sort((a, b) => b[0] - a[0]); longs = longs.slice(0, 120); }
        }
        return;
      }
      if (ph !== 'b' && ph !== 'e' && ph !== 'n') return;
      const id = e.id2 ? (e.id2.local != null ? e.id2.local : e.id2.global) : e.id;
      if (id == null) return;
      const pk = `${e.pid}|${id}`;
      if (ph === 'n') {
        if (e.name === 'ProgressFling') flingTicks.push(ts);
        else if (/JankV3/.test(e.name)) janks++;
        return;
      }
      const ok = `${pk}|${e.name}`;
      if (ph === 'b') {
        open.set(ok, ts);
        const a = e.args || {};
        if (e.name === 'EventLatency' && a.event_latency) {
          const el = a.event_latency;
          if (!vsyncMs && el.vsync_interval_ms) vsyncMs = Number(el.vsync_interval_ms) || 0;
          parents.set(pk, { kind: 'lat', type: el.event_type, stages: {} });
        } else if (e.name === 'PipelineReporter' && a.frame_reporter) {
          parents.set(pk, { kind: 'frame', fr: a.frame_reporter, stages: {} });
        } else if (e.name === 'FlingController::HandlingGestureFling' && (a.vx != null || a.vy != null)) {
          flingStarts.push(ts);
          flingSpeeds.push(Math.round(Math.hypot(Number(a.vx) || 0, Number(a.vy) || 0)));
        } else if (e.name === 'FrameSequenceTrackerV3' && a.args && a.args.data && /Scroll/.test(String(a.name || ''))) {
          const d = a.args.data;
          trackers.n++; trackers.expected += Number(d.expected) || 0; trackers.dropped += Number(d.dropped_v4 != null ? d.dropped_v4 : d.dropped_v3) || 0; trackers.checkerboarded += Number(d.checkerboarded) || 0;
        } else if (/JankV3/.test(e.name)) janks++;
        return;
      }
      // An end: its begin's time gives the duration.
      const b = open.get(ok);
      if (b == null) return;
      open.delete(ok);
      const d = ts - b;
      if (d < 0) return;
      const par = parents.get(pk);
      if (e.name === 'EventLatency' || e.name === 'PipelineReporter') {
        if (!par) return;
        parents.delete(pk);
        if (par.kind === 'lat') {
          const k = SCROLL_TYPES[par.type];
          if (!k) return;
          const L = lat[k] || (lat[k] = { total: [], stages: {} });
          L.total.push(d);
          for (const [n, v] of Object.entries(par.stages)) (L.stages[n] || (L.stages[n] = [])).push(v);
        } else {
          const fr = par.fr;
          if (!fr.scroll_state || fr.scroll_state === 'SCROLL_NONE') return;
          frames.scroll++;
          if (fr.state === 'STATE_DROPPED') frames.dropped++;
          else if (fr.state === 'STATE_PRESENTED_PARTIAL') frames.partial++;
          else if (/^STATE_PRESENTED/.test(fr.state)) frames.presented++;
          if (fr.has_missing_content) frames.missing++;
          if (fr.checkerboarded_needs_raster || fr.checkerboarded_needs_record) frames.checker++;
          if (fr.state === 'STATE_DROPPED') for (const f of ['has_main_animation', 'has_compositor_animation', 'has_smooth_input_main', 'has_high_latency', 'has_missing_content']) if (fr[f]) frames.flags[f] = (frames.flags[f] || 0) + 1;
          for (const [n, v] of Object.entries(par.stages)) (frames.stages[n] || (frames.stages[n] = [])).push(v);
        }
        return;
      }
      if (par) par.stages[e.name] = (par.stages[e.name] || 0) + d;
      if (DRAW_NAMES.includes(e.name)) (draws[e.name] || (draws[e.name] = [])).push(d);
    }

    /* ------------------------------------------------------------ the result */
    function finish() {
      const span = t1 > t0 ? t1 - t0 : 0;
      const name = (k) => {
        const t = threads.get(k) || `thread ${k.split(':')[1]}`;
        const p = procs.get(Number(k.split(':')[0]));
        return p ? `${t} (${p})` : t;
      };
      // Each thread's busy time: the union of its complete events (they nest).
      const threadsOut = [];
      for (const [k, iv] of busy) {
        const pairs = [];
        for (let i = 0; i < iv.length; i += 2) pairs.push([iv[i], iv[i + 1]]);
        pairs.sort((a, b) => a[0] - b[0]);
        let sum = 0, s = -1, en = -1;
        for (const [a, b] of pairs) {
          if (a > en) { if (en > s) sum += en - s; s = a; en = b; } else if (b > en) en = b;
        }
        if (en > s) sum += en - s;
        const nm = byName.get(k);
        const top = nm ? [...nm].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => [n, v]) : [];
        threadsOut.push({ name: name(k), busy: sum, perSec: span ? (sum / span) * 1000 : 0, top });
      }
      threadsOut.sort((a, b) => b.busy - a.busy);
      longs.sort((a, b) => b[0] - a[0]);
      const longOut = longs.slice(0, 8).map(([d, k, n, ts]) => ({ dur: d, thread: name(k), name: n, at: ts - t0 }));
      // Flings: how evenly each was moved along. The ticks of one fling run from its start to the
      // next one's (a gap that spans a new fling's start is the time between two flings).
      const gaps = [];
      flingTicks.sort((a, b) => a - b);
      flingStarts.sort((a, b) => a - b);
      let si = 0, flings = 0, last = -1;
      for (const t of flingTicks) {
        let crossed = false;
        while (si < flingStarts.length && flingStarts[si] <= t) { si++; crossed = true; }
        if (crossed) flings++;
        if (last >= 0 && !crossed) gaps.push(t - last);
        last = t;
      }
      return { span, events: count, unreadable: bad, vsyncMs, lat, frames, draws, flings, flingSpeeds, gaps, trackers, janks, threads: threadsOut, longs: longOut };
    }

    return { push, finish, get events() { return count; } };
  }

  // The summary as report lines.
  function lines(s) {
    const out = [];
    if (!s || !s.events) return ['  nothing was recorded'];
    const hz = s.vsyncMs ? Math.round(1000 / s.vsyncMs) : 0;
    out.push(`  ${(s.span / 1e6).toFixed(1)} s, ${s.events} events${s.unreadable ? ` (${s.unreadable} unreadable)` : ''}${hz ? ` · screen ${hz} Hz` : ''}`);
    const f = s.frames;
    if (f.scroll) {
      const flags = Object.entries(f.flags).map(([k, v]) => `${k.replace(/^has_/, '').replace(/_/g, ' ')} ${v}`).join(', ');
      out.push(`  frames while scrolling: ${f.scroll}, dropped ${f.dropped} (${Math.round((1000 * f.dropped) / f.scroll) / 10}%)${f.partial ? `, partial ${f.partial}` : ''}${f.missing ? `, missing content ${f.missing}` : ''}${f.checker ? `, checkerboarded ${f.checker}` : ''}${flags ? `; the dropped had: ${flags}` : ''}`);
      const st = FRAME_STAGES.filter(([n]) => f.stages[n]).map(([n, label]) => `${label} ${tri(f.stages[n])}`);
      if (st.length) out.push(`    a frame's steps, ms p50/p95/max: ${st.join(' · ')}`);
    } else out.push('  frames while scrolling: none recorded (was the page scrolled?)');
    if (s.trackers.n) out.push(`  scroll smoothness (Chromium's own count): ${s.trackers.dropped} of ${s.trackers.expected} frames dropped${s.trackers.checkerboarded ? `, ${s.trackers.checkerboarded} checkerboarded` : ''}${s.janks ? ` · ${s.janks} janks` : ''}`);
    for (const [k, label] of [['first', 'first move of a drag'], ['drag', 'drag'], ['fling', 'fling']]) {
      const L = s.lat[k];
      if (!L || !L.total.length) continue;
      const seen = new Set();
      const st = [];
      for (const [n, short] of LAT_STAGES) {
        if (!L.stages[n] || seen.has(short)) continue;
        seen.add(short);
        st.push(`${short} ${tri(L.stages[n])}`);
      }
      out.push(`  ${label}: ${L.total.length} updates, finger to screen ${tri(L.total)} ms (p50/p95/max)`);
      if (st.length) out.push(`    ${st.join(' · ')}`);
    }
    if (s.flings || s.flingSpeeds.length) {
      const over = s.vsyncMs ? s.gaps.filter((g) => g > 2.5 * s.vsyncMs * 1000).length : 0;
      out.push(`  flings: ${s.flingSpeeds.length} started (${s.flingSpeeds.slice(0, 8).join(', ')} px/s); moved along every ${tri(s.gaps)} ms${over ? `, ${over} gaps over 2.5 frames` : ''}`);
    }
    const dr = DRAW_NAMES.filter((n) => s.draws[n]).map((n) => `${n.replace('Graphics.Pipeline.', '')} ${tri(s.draws[n])}`);
    if (dr.length) out.push(`  GPU, ms p50/p95/max: ${dr.join(' · ')}`);
    const busy = s.threads.filter((t) => t.busy > 0).slice(0, 6);
    if (busy.length) {
      out.push('  busiest threads (ms busy each second, and on what):');
      for (const t of busy) out.push(`    ${t.name}: ${Math.round(t.perSec)}${t.top.length ? ` · ${t.top.map(([n, v]) => `${n} ${Math.round(v / 1000)} ms`).join(', ')}` : ''}`);
    }
    if (s.longs.length) {
      out.push('  longest tasks:');
      for (const l of s.longs.slice(0, 6)) out.push(`    ${ms(l.dur)} ms at +${(l.at / 1e6).toFixed(2)} s on ${l.thread}: ${l.name}`);
    }
    return out;
  }

  GH.traceSum = { create, lines };
})(typeof window !== 'undefined' ? window : globalThis);
