// The trace summary (src/tracesum.js): a WebView trace recording, read a piece at a time, summed up
// for the scroll diagnostics. A made-up trace with known numbers, fed whole and in tiny pieces (cut
// inside strings, escapes and numbers), in both of Chromium's layouts.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/tracesum.js');
const T = GH.traceSum;

// Times in microseconds. Renderer 10 (main 10, compositor 11), browser 20 (main 20).
const ev = [];
const M = (pid, tid, name) => ev.push({ ph: 'M', name: 'thread_name', pid, tid, args: { name } });
M(10, 10, 'CrRendererMain'); M(10, 11, 'Compositor'); M(20, 20, 'CrBrowserMain');
ev.push({ ph: 'M', name: 'process_name', pid: 10, tid: 0, args: { name: 'Renderer' } });
// A scroll update's latency with its stages (same id), and a fling's.
const lat = (id, type, t, total, stages) => {
  ev.push({ ph: 'b', name: 'EventLatency', pid: 10, tid: 11, ts: t, id2: { local: id }, args: { event_latency: { event_type: type, vsync_interval_ms: 8.333 } } });
  let at = t;
  for (const [name, d] of stages) { ev.push({ ph: 'b', name, pid: 10, tid: 11, ts: at, id2: { local: id }, args: {} }); ev.push({ ph: 'e', name, pid: 10, tid: 11, ts: at + d, id2: { local: id } }); at += d; }
  ev.push({ ph: 'e', name: 'EventLatency', pid: 10, tid: 11, ts: t + total, id2: { local: id } });
};
lat('0x1', 'GESTURE_SCROLL_UPDATE', 1000, 40000, [['GenerationToBrowserMain', 30000], ['RendererCompositorQueueingDelay', 5000]]);
lat('0x2', 'GESTURE_SCROLL_UPDATE', 2000, 20000, [['GenerationToBrowserMain', 10000], ['RendererCompositorQueueingDelay', 4000]]);
lat('0x3', 'INERTIAL_GESTURE_SCROLL_UPDATE', 3000, 12000, [['GenerationToBrowserMain', 1000]]);
lat('0x4', 'TOUCH_MOVED', 3500, 9000, [['GenerationToBrowserMain', 1000]]); // not a scroll update: left out
// Frames while scrolling: three presented, one dropped (with a main-thread animation), one not scrolling.
const frame = (id, t, state, scroll, extra = {}) => {
  ev.push({ ph: 'b', name: 'PipelineReporter', pid: 10, tid: 11, ts: t, id2: { local: id }, args: { frame_reporter: Object.assign({ state, scroll_state: scroll }, extra) } });
  ev.push({ ph: 'b', name: 'StartDrawToSwapStart', pid: 10, tid: 11, ts: t + 100, id2: { local: id }, args: {} });
  ev.push({ ph: 'e', name: 'StartDrawToSwapStart', pid: 10, tid: 11, ts: t + 2100, id2: { local: id } });
  ev.push({ ph: 'e', name: 'PipelineReporter', pid: 10, tid: 11, ts: t + 16000, id2: { local: id } });
};
frame('0x10', 10000, 'STATE_PRESENTED_ALL', 'SCROLL_COMPOSITOR_THREAD');
frame('0x11', 20000, 'STATE_PRESENTED_ALL', 'SCROLL_COMPOSITOR_THREAD');
frame('0x12', 30000, 'STATE_DROPPED', 'SCROLL_COMPOSITOR_THREAD', { has_main_animation: true });
frame('0x13', 40000, 'STATE_PRESENTED_ALL', 'SCROLL_COMPOSITOR_THREAD');
frame('0x14', 50000, 'STATE_DROPPED', 'SCROLL_NONE');
// Two flings: the first ticks every 8.3 ms with one 120 ms hold; the second starts 1 s later.
ev.push({ ph: 'b', name: 'FlingController::HandlingGestureFling', pid: 20, tid: 20, ts: 100000, id2: { local: '0x30' }, args: { vx: 0, vy: -3000 } });
for (const t of [100100, 108400, 116700, 236700, 245000]) ev.push({ ph: 'n', name: 'ProgressFling', pid: 20, tid: 20, ts: t, id2: { local: '0x31' }, args: {} });
ev.push({ ph: 'b', name: 'FlingController::HandlingGestureFling', pid: 20, tid: 20, ts: 1245000, id2: { local: '0x32' }, args: { vx: 400, vy: 300 } });
for (const t of [1245100, 1253400]) ev.push({ ph: 'n', name: 'ProgressFling', pid: 20, tid: 20, ts: t, id2: { local: '0x31' }, args: {} });
// Complete events: on the main thread a 40 ms task with a nested 30 ms one (busy 40, not 70), a
// 10 ms one apart; on the compositor a 5 ms one. A name with braces, quotes and an escape in it.
ev.push({ ph: 'X', name: 'ThreadControllerImpl::RunTask', pid: 10, tid: 10, ts: 500000, dur: 40000 });
ev.push({ ph: 'X', name: 'V8.Execute {"weird"} \\ name', pid: 10, tid: 10, ts: 505000, dur: 30000, args: { note: 'a } and a { and a ] in a string' } });
ev.push({ ph: 'X', name: 'Paint', pid: 10, tid: 10, ts: 600000, dur: 10000 });
ev.push({ ph: 'X', name: 'ProxyImpl::ScheduledActionDraw', pid: 10, tid: 11, ts: 700000, dur: 5000 });
ev.push({ ph: 'X', name: 'Graphics.Pipeline.DrawAndSwap', pid: 10, tid: 11, ts: 1300000, dur: 0 }); // no duration: ignored

const wrapped = JSON.stringify({ traceEvents: ev, metadata: { 'clock-domain': 'LINUX_CLOCK_MONOTONIC', note: '"traceEvents" [{ }]' } });
const bare = JSON.stringify(ev);

function run(text, size) {
  const s = T.create();
  for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
  return s.finish();
}

section('Summing up a recording');
const whole = run(wrapped, wrapped.length);
check('every event is read, none unreadable', whole.events === ev.length && whole.unreadable === 0, { events: whole.events, of: ev.length, unreadable: whole.unreadable });
check('the screen\'s rate comes from the latencies (8.33 ms: 120 Hz)', Math.round(1000 / whole.vsyncMs) === 120, whole.vsyncMs);
check('scroll updates are grouped by kind (drags 2, flings 1; a touch move isn\'t one)', whole.lat.drag.total.length === 2 && whole.lat.fling.total.length === 1 && !whole.lat.first, Object.keys(whole.lat));
check('each update\'s time on Android\'s UI thread is kept', JSON.stringify(whole.lat.drag.stages.GenerationToBrowserMain.slice().sort((a, b) => a - b)) === '[10000,30000]', whole.lat.drag.stages);
check('frames while scrolling: 4, one dropped, with its main-thread animation; the one not scrolling is left out', whole.frames.scroll === 4 && whole.frames.dropped === 1 && whole.frames.presented === 3 && whole.frames.flags.has_main_animation === 1, whole.frames);
check('a frame\'s steps are timed (drawing 2 ms each)', whole.frames.stages.StartDrawToSwapStart.length === 4 && whole.frames.stages.StartDrawToSwapStart.every((d) => d === 2000), whole.frames.stages);
check('two flings, with their speeds', whole.flings === 2 && JSON.stringify(whole.flingSpeeds) === '[3000,500]', { flings: whole.flings, speeds: whole.flingSpeeds });
check('a fling\'s ticks: the 120 ms hold is there, the second between flings isn\'t', Math.max(...whole.gaps) === 120000 && whole.gaps.length === 5, whole.gaps);
const main = whole.threads.find((t) => /^CrRendererMain/.test(t.name));
check('a thread\'s busy time counts nested tasks once (40 + 10 ms)', main && main.busy === 50000, main);
check('threads are named with their process', main && main.name === 'CrRendererMain (Renderer)', main && main.name);
check('task names keep their braces, quotes and escapes', main && main.top.some(([n]) => n === 'V8.Execute {"weird"} \\ name'), main && main.top);
check('the longest task is listed first', whole.longs[0].dur === 40000 && whole.longs.length === 2, whole.longs);

section('Read in pieces');
for (const size of [1, 7, 64, 4093]) {
  const r = run(wrapped, size);
  check(`in pieces of ${size} characters: the same sums`, JSON.stringify(r) === JSON.stringify(whole), size);
}
const b = run(bare, 13);
check('a bare array of events reads the same', b.events === ev.length && JSON.stringify(b.lat) === JSON.stringify(whole.lat) && b.flings === 2);
check('nothing in it: no events, and the lines say so', T.lines(T.create().finish()).join(' ').includes('nothing was recorded'));

section('The report\'s lines');
const lines = T.lines(whole).join('\n');
check('the screen\'s rate', /screen 120 Hz/.test(lines), lines);
check('frames dropped while scrolling, with the share', /frames while scrolling: 4, dropped 1 \(25%\)/.test(lines), lines);
check('drags: finger to screen, and the UI thread\'s part', /drag: 2 updates, finger to screen 40\/40\/40 ms/.test(lines) && /Android UI thread 30\/30\/30/.test(lines), lines);
check('flings: speeds and the hold', /flings: 2 started \(3000, 500 px\/s\)/.test(lines) && /1 gaps over 2.5 frames/.test(lines), lines);
check('the busiest threads and the longest tasks', /busiest threads/.test(lines) && /40 ms at \+0\.50 s on CrRendererMain \(Renderer\)/.test(lines), lines);

done();
