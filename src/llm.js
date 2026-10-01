/* On-device AI (loads on demand: GH.lazy('llm') sets GH.llm). A small open model runs entirely on the
 * phone with llama.cpp, one of two ways:
 * - native: the Android app's own build (LlmService, in its own process) on the phone's big cores.
 *   The page asks for it through the bridge and hears back through window.__gh.onLlm.
 * - in-app: llama.cpp compiled to WebAssembly (@wllama/wllama), on the CPU with threads where the
 *   WebView allows them (Android's has no SharedArrayBuffer today, so one), and on the GPU through
 *   WebGPU when a quick self-test passes. It's the fallback: several times slower than native.
 * Both get the same prompt, built here (ChatML), and stream the same way.
 *
 * The Android shell downloads the model files (ModelStore.java: resumable, Wi-Fi only if asked, each
 * pinned to a repo commit and checked against its exact size, the GGUF header and its SHA-256, see
 * PINS) into the app's private storage and serves them
 * back to the page at models/<file> with HTTP Range support. wllama reads them through a Range-backed
 * stand-in for a Blob, so a model goes straight from storage into WebAssembly memory and is never
 * copied into browser storage. The chat and settings screens live in src/ui/.
 */
/*! On-device models run on @wllama/wllama (MIT License, Copyright (c) 2024 Xuan Son NGUYEN) and
 * llama.cpp (MIT License, Copyright (c) The ggml authors). */
import { Wllama, WllamaAbortError, LogLevel } from '@wllama/wllama/esm/index.js';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const hooks = G.__gh || (G.__gh = {});
const bridge = () => G.AndroidBridge || null;
const now = () => Date.now();

/* ------------------------------------------------------------------ models */
// Qwen3.5 (March 2026, Apache-2.0, not gated), Q4_K_M, from unsloth's GGUF repos on Hugging Face, in
// three sizes. Qwen3.5 mixes gated delta-net layers with full attention; the llama.cpp inside wllama
// 3.6.1 runs it, which test/llm.mjs checks with a tiny model of the same layout.
//
// Each file is pinned in PINS: the repo commit it's downloaded at (so its URL always means the same
// bytes), its exact size and its SHA-256, which the phone checks every byte against. ModelStore.java
// downloads nothing that isn't pinned. Hugging Face can't be reached from the machine this is written
// on, so the pins come from the "pins" job in .github/workflows/model-check.yml (run it from the
// Actions tab): it reads each file at the repo's current commit, checks it against what the Hub says,
// and prints the lines to paste here. Until a file has its pin, its entry keeps the size shown on its
// page (to 3 digits) and the repo's main branch, and the app won't download it.
const PINS = {
};
const HUB = 'https://huggingface.co';
function pinned(repo, file, shownBytes) {
  const p = Object.prototype.hasOwnProperty.call(PINS, file) ? PINS[file] : null;
  if (!p) return { file, url: `${HUB}/${repo}/resolve/main/${file}`, bytes: shownBytes };
  return { file, url: `${HUB}/${repo}/resolve/${p.commit}/${file}`, sha256: p.sha256, bytes: p.bytes };
}
//
// Each model carries how to run it: ctx, batch (a small batch keeps a cache checkpoint close to the
// end of each prompt, so a follow-up question reuses nearly all of it on a hybrid model like this),
// think (the chat template can think first: asked not to, and any thinking that slips out is hidden)
// and gen (sampling, from Qwen's recommended non-thinking settings, a little cooler for answers that
// quote numbers).
const QWEN35 = {
  family: 'qwen35', license: 'Apache-2.0', ctx: 4096, batch: 64, think: true,
  gen: { temperature: 0.6, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05 },
};
const MODELS = [
  Object.assign({
    id: 'q35-08', tier: 'fast', name: 'Fast', label: 'Qwen3.5 0.8B', speed: 3, quality: 1, minRamGB: 3,
  }, pinned('unsloth/Qwen3.5-0.8B-GGUF', 'Qwen3.5-0.8B-Q4_K_M.gguf', 533e6), QWEN35),
  Object.assign({
    id: 'q35-2', tier: 'balanced', name: 'Balanced', label: 'Qwen3.5 2B', speed: 2, quality: 2, minRamGB: 6,
  }, pinned('unsloth/Qwen3.5-2B-GGUF', 'Qwen3.5-2B-Q4_K_M.gguf', 1.28e9), QWEN35),
  Object.assign({
    id: 'q35-4', tier: 'best', name: 'Best answers', label: 'Qwen3.5 4B', speed: 1, quality: 3, minRamGB: 12,
  }, pinned('unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf', 2.74e9), QWEN35),
  // 1.2's models (Qwen2.5 Instruct from Qwen's own GGUF repos): no longer offered or downloaded, but
  // one that's already on the phone keeps working until it's deleted. Their SHA-256 is pinned.
  {
    id: 'qwen05', legacy: true, name: 'Standard (older)', label: 'Qwen2.5 0.5B Instruct', license: 'Apache-2.0', family: 'qwen2',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    bytes: 491400032,
    sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
    minRamGB: 3, ctx: 2048, gen: { temperature: 0.6, top_p: 0.8, top_k: 20, repeat_penalty: 1.05 },
  },
  {
    id: 'qwen15', legacy: true, name: 'Better answers (older)', label: 'Qwen2.5 1.5B Instruct', license: 'Apache-2.0', family: 'qwen2',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320736,
    sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
    minRamGB: 8, ctx: 2048, gen: { temperature: 0.6, top_p: 0.8, top_k: 20, repeat_penalty: 1.05 },
  },
];
const DEFAULT_GEN = { temperature: 0.6, top_p: 0.8, top_k: 20, repeat_penalty: 1.05 };

// A loaded model stays ready for 10 minutes while the app is on screen and a minute once it isn't
// (the phone wants the memory back), and goes at once when Android says memory is short.
const IDLE_SHOWN = 10 * 60 * 1000;
const IDLE_HIDDEN = 60 * 1000;
// Nothing heard for this long means stuck: loading (no bytes read), answering (no progress or word).
const STALL = { load: 45000, answer: 60000 };
const cfg = { models: MODELS, baseUrl: 'models/', served: false, idleMs: 0, stall: Object.assign({}, STALL), debug: false };

// Tests and plain browsers: configure({ baseUrl }) says where the model files are served (there's no
// bridge to ask), { models } replaces the table, { idleMs } sets one idle unload time, { stall }
// shortens the stuck timers.
function configure(o = {}) {
  if (o.baseUrl != null) { cfg.baseUrl = String(o.baseUrl).replace(/\/?$/, '/'); cfg.served = true; }
  if (Array.isArray(o.models)) cfg.models = o.models.map((m) => Object.assign({ minRamGB: 0, ctx: 2048 }, m));
  if (o.idleMs != null) cfg.idleMs = Math.max(100, Number(o.idleMs) || 0);
  if (o.stall) for (const k of Object.keys(STALL)) if (o.stall[k] > 0) cfg.stall[k] = Number(o.stall[k]);
  if (o.debug != null) cfg.debug = !!o.debug;
}

/* ------------------------------------------------------------------ errors */
const DAMAGED = 'The download was damaged, so it was deleted. Try again.';
const MESSAGES = {
  unavailable: 'On-device AI isn\'t available here.',
  web: 'Model downloads need the Gradient Health Android app.',
  unknown: 'That model isn\'t available.',
  invalid: 'The model request wasn\'t valid.',
  memory: 'This phone doesn\'t have enough memory for this model.',
  space: 'Not enough free space.',
  network: 'The download stopped. Check your connection and try again.',
  http: 'The model couldn\'t be downloaded right now. Try again later.',
  changed: 'The model file on the server has changed. Update Gradient Health to download it.',
  unpinned: 'This version of Gradient Health can\'t download this model. Update the app to get it.',
  size: DAMAGED, format: DAMAGED, checksum: DAMAGED,
  io: 'The model couldn\'t be saved on this phone.',
  cancelled: 'Download cancelled.',
  'not-installed': 'Download the model first.',
  'not-loaded': 'Load a model first.',
  load: 'The model couldn\'t be started. Try again.',
  crashed: 'The on-device model stopped unexpectedly. Try again.',
  stalled: 'The on-device model stopped responding. Try again.',
  failed: 'The on-device model couldn\'t answer that. Try again.',
  'too-long': 'This chat is too long for the on-device model. Start a new chat.',
  empty: 'There\'s nothing to answer yet.',
};
function llmError(code, detail) {
  const e = new Error(MESSAGES[code] || MESSAGES.load);
  e.code = code;
  if (detail) e.detail = String(detail);
  return e;
}
const MB = 1024 * 1024;
function errorText(p) {
  if (p.error === 'space' && p.needed > 0 && p.free >= 0) {
    return `${MESSAGES.space} Free up ${Math.max(1, Math.ceil((p.needed - p.free) / MB))} MB and try again.`;
  }
  return MESSAGES[p.error] || MESSAGES.io;
}

/* ------------------------------------------------------------------ what this phone can do */
// The probes wllama runs itself (from wasm-feature-detect): SIMD and exception handling.
const SIMD = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];
const EXCEPTIONS = [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11];
let wasmOk = null;
function wasmSupported() {
  if (wasmOk != null) return wasmOk;
  const W = G.WebAssembly;
  const valid = (bytes) => { try { return W.validate(new Uint8Array(bytes)); } catch (e) { return false; } };
  let mem64 = false;
  try { mem64 = !!new W.Memory({ address: 'i64', initial: 1n }); } catch (e) { mem64 = false; }
  // The prebuilt wasm is 64-bit and suspends on reads (JSPI): Chrome and WebView 137 or newer.
  wasmOk = !!(W && typeof W.Suspending === 'function' && valid(SIMD) && valid(EXCEPTIONS) && mem64 && G.Worker);
  return wasmOk;
}
function available() {
  if (!nativeOk() && !wasmSupported()) return { ok: false, reason: 'On-device AI needs a newer Android System WebView. Update it from the Play Store.' };
  const b = bridge();
  if (!(b && b.modelList) && !cfg.served) return { ok: false, reason: 'On-device AI runs in the Gradient Health Android app.' };
  if (!offered().length) return { ok: false, reason: 'This phone doesn\'t have enough memory for on-device AI.' };
  return { ok: true, reason: '' };
}

// Phones report a little less RAM than they were sold with (8 GB shows up as about 7.3 GB): round up.
const SOLD_AS_GB = [1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 18, 20, 24, 32, 64];
function ramGB() {
  let bytes = 0;
  try { const b = bridge(); if (b && b.deviceMemory) bytes = Number(b.deviceMemory()) || 0; } catch (e) { bytes = 0; }
  if (bytes > 0) {
    const gib = bytes / 2 ** 30;
    return SOLD_AS_GB.find((n) => gib <= n) || Math.ceil(gib);
  }
  const dm = G.navigator && Number(G.navigator.deviceMemory); // browsers: rounded down, capped at 8
  return dm > 0 ? dm : null;
}
function model(id) {
  const m = cfg.models.find((x) => x.id === id);
  if (!m) throw llmError('unknown', id);
  return m;
}
function fits(m) { const ram = ramGB(); return ram == null || ram >= (m.minRamGB || 0); }
// The models to offer on this phone: the current ones it has the memory for (Balanced with 6 GB or
// more, Best answers with 12). Older models only show up while they're installed.
function offered() { return cfg.models.filter((m) => !m.legacy && fits(m)); }
// The one to suggest. With the native engine and 8 GB or more, Balanced: it reads the facts clearly
// better and still writes faster than you read (about half Fast's speed). Otherwise Fast, which
// starts answering soonest; the bigger sizes stay a choice.
function recommended() {
  const list = offered();
  const roomy = nativeOk() && (ramGB() || 0) >= 8;
  return (roomy && list.find((m) => m.tier === 'balanced')) || list.find((m) => m.tier === 'fast') || list[0] || null;
}

/* ------------------------------------------------------------------ downloads (ModelStore.java) */
const STATE_TEXT = {
  queued: 'Waiting to download',
  downloading: 'Downloading',
  'waiting-wifi': 'Download paused: waiting for Wi-Fi',
  'waiting-network': 'Download paused: no internet connection',
  verifying: 'Checking the download',
  paused: 'Download paused',
  done: 'Downloaded',
  cancelled: MESSAGES.cancelled,
};
const states = {};
const listeners = new Set();
const waiters = {};

function describe(p) {
  const s = { id: String(p.id), state: String(p.state || ''), loaded: Number(p.loaded) || 0, total: Number(p.total) || 0 };
  if (p.bps) s.bps = Number(p.bps) || 0;
  if (p.error) s.error = String(p.error);
  if (p.needed != null) s.needed = Number(p.needed);
  if (p.free != null) s.free = Number(p.free);
  s.fraction = s.total > 0 ? Math.min(1, s.loaded / s.total) : 0;
  s.message = s.state === 'error' ? errorText(s) : STATE_TEXT[s.state] || '';
  return s;
}
function settle(s) {
  const list = waiters[s.id];
  if (!list || !['done', 'error', 'cancelled'].includes(s.state)) return;
  delete waiters[s.id];
  for (const w of list) {
    if (s.state === 'done') w.resolve({ id: s.id, bytes: s.total || s.loaded });
    else w.reject(Object.assign(llmError(s.state === 'cancelled' ? 'cancelled' : s.error || 'io'), { message: s.message }));
  }
}
function onModelProgress(p) {
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return; } }
  if (!p || !p.id) return;
  const s = describe(p);
  states[s.id] = s;
  for (const fn of [...listeners]) { try { fn(s); } catch (e) { /* one listener's bug mustn't stop the rest */ } }
  settle(s);
}
// Chained: whatever hook was there first keeps getting called.
const earlierHook = hooks.onModelProgress;
hooks.onModelProgress = function (p) {
  if (typeof earlierHook === 'function') { try { earlierHook.apply(this, arguments); } catch (e) { /* ignore */ } }
  onModelProgress(p);
};

// Downloads live in the Android shell, so after a page reload this picks up where they are.
function status() {
  const b = bridge();
  if (b && b.modelStatus) {
    try { for (const p of JSON.parse(b.modelStatus() || '[]')) if (p && p.id) states[p.id] = describe(p); } catch (e) { /* keep what we have */ }
  }
  return Object.values(states);
}
// cb gets { id, state, loaded, total, fraction, bps?, error?, message }; it's called once right away
// for each download there is. Returns an unsubscribe function.
function onProgress(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  const snapshot = status();
  Promise.resolve().then(() => { for (const s of snapshot) { if (listeners.has(cb)) { try { cb(s); } catch (e) { /* ignore */ } } } });
  return () => listeners.delete(cb);
}

// Resolves with { id, bytes } once the model is installed and checked, rejects with an Error whose
// code is space, network, http, changed, size, format, checksum, io, memory, web or cancelled.
// Waiting for Wi-Fi or a connection isn't a failure: it shows up as a progress state.
function download(id, opts = {}) {
  let m;
  try { m = model(id); } catch (e) { return Promise.reject(e); }
  const b = bridge();
  if (!b || !b.modelDownload) return Promise.reject(llmError('web'));
  if (!fits(m)) return Promise.reject(llmError('memory'));
  const done = new Promise((resolve, reject) => { (waiters[m.id] = waiters[m.id] || []).push({ resolve, reject }); });
  let ok = false;
  try {
    ok = !!b.modelDownload(JSON.stringify({
      id: m.id, url: m.url, file: m.file, bytes: m.bytes, sha256: m.sha256 || '', wifiOnly: opts.wifiOnly !== false,
    }));
  } catch (e) { ok = false; }
  if (!ok) settle(describe({ id: m.id, state: 'error', error: 'invalid' }));
  return done;
}
function cancel(id) {
  const b = bridge();
  try { if (b && b.modelCancel) b.modelCancel(String(id)); } catch (e) { /* ignore */ }
  return Promise.resolve();
}
async function remove(id) {
  if (current && current.id === id) await unload();
  const b = bridge();
  delete states[id];
  try { return !!(b && b.modelDelete && b.modelDelete(String(id))); } catch (e) { return false; }
}
function freeSpace() {
  try { const b = bridge(); if (b && b.modelFreeSpace) { const n = Number(b.modelFreeSpace()); return n >= 0 ? n : null; } } catch (e) { /* ignore */ }
  return null;
}

/* ------------------------------------------------------------------ model files */
const fileUrl = (file) => new URL(cfg.baseUrl + encodeURIComponent(file), G.document ? G.document.baseURI : G.location.href).href;

// The file's size from a one-byte Range request (works on the app's origin and on a test server).
async function probeSize(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  let size = 0;
  const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
  if (res.status === 206 && range) size = Number(range[1]);
  else if (res.ok) size = Number(res.headers.get('content-length')) || 0;
  try { if (res.body) await res.body.cancel(); } catch (e) { /* ignore */ }
  return size;
}

// An install from before files were pinned, which the app has hashed since (ModelStore's background
// check, "rehashed"), whose hash isn't this version's pin: not a file the app can vouch for.
function mismatched(x) {
  const m = cfg.models.find((y) => y.id === String(x.id));
  return !!(x.rehashed && m && m.sha256 && String(x.sha256 || '') !== m.sha256);
}
// [{ id, file, bytes }]: from the Android shell, or (browser, tests) the files found at baseUrl. A
// mismatched install reads as not installed, so it's offered for download again (which replaces it).
async function installed() {
  const b = bridge();
  if (b && b.modelList) {
    let list = [];
    try { list = JSON.parse(b.modelList() || '[]'); } catch (e) { list = []; }
    return list.filter((x) => x && x.id && !mismatched(x)).map((x) => ({ id: String(x.id), file: String(x.file || ''), bytes: Number(x.bytes) || 0 }));
  }
  if (!cfg.served) return [];
  const out = [];
  for (const m of cfg.models) {
    const bytes = await probeSize(fileUrl(m.file)).catch(() => 0);
    if (bytes > 0) out.push({ id: m.id, file: m.file, bytes });
  }
  return out;
}

// What wllama needs from a Blob is size, slice() and arrayBuffer(), so each read it makes becomes one
// Range request and the model is never held as a whole in memory or copied to browser storage.
class RangeFile {
  constructor(url, total, onRead, start = 0, end = total) {
    this.url = url; this.total = total; this.onRead = onRead; this.start = start; this.end = end;
    this.size = end - start;
    this.type = 'application/octet-stream';
  }
  slice(a = 0, b = this.size) {
    const clamp = (v) => Math.max(0, Math.min(this.size, v < 0 ? this.size + v : v));
    const s = this.start + clamp(a);
    return new RangeFile(this.url, this.total, this.onRead, s, Math.max(s, this.start + clamp(b)));
  }
  async arrayBuffer() {
    const n = this.end - this.start;
    if (n <= 0) return new ArrayBuffer(0);
    let last = null;
    // Three tries, 30 s each: a read that hangs mustn't hang the load.
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      try {
        const res = await fetch(this.url, { headers: { Range: `bytes=${this.start}-${this.end - 1}` }, cache: 'no-store', signal: ctl.signal });
        if (res.status !== 206 && !(res.status === 200 && this.start === 0 && this.end === this.total)) {
          try { if (res.body) await res.body.cancel(); } catch (e) { /* ignore */ }
          throw new Error(`model read failed: HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== n) throw new Error(`model read failed: ${buf.byteLength} of ${n} bytes`);
        if (this.onRead) this.onRead(n);
        return buf;
      } catch (e) { last = e; } finally { clearTimeout(timer); }
    }
    throw last;
  }
  // Only used when the WebView can't suspend on reads, which available() already rules out.
  stream() {
    const self = this;
    let at = 0;
    return new ReadableStream({
      async pull(ctrl) {
        if (at >= self.size) { ctrl.close(); return; }
        const n = Math.min(8 * MB, self.size - at);
        ctrl.enqueue(new Uint8Array(await self.slice(at, at + n).arrayBuffer()));
        at += n;
      },
    });
  }
}

/* ------------------------------------------------------------------ GPU */
// ggml's WebGPU kernels need shader-f16. A software adapter (SwiftShader) is slower than the CPU path,
// and some phone drivers get f16 math wrong, so a tiny f16 kernel has to give the right answer first.
const GPU_BAD = 'gh.llm.gpuBad';
function gpuBad() { try { return G.localStorage.getItem(GPU_BAD) === String(G.navigator.userAgent); } catch (e) { return false; } }
// Remembered per WebView version: an update gets a fresh try.
function markGpuBad() { try { G.localStorage.setItem(GPU_BAD, String(G.navigator.userAgent)); } catch (e) { /* ignore */ } }
const GPU_TEST = `enable f16;
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x;
  if (i >= arrayLength(&a)) { return; }
  let h = f16(a[i]);
  var acc = f16(0.0);
  for (var k = 0u; k < 8u; k++) { acc = acc + h * f16(0.5); }
  o[i] = f32(acc) + a[i];
}`;
async function gpuTest() {
  const gpu = G.navigator && G.navigator.gpu;
  if (!gpu) return false;
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return false;
  const about = adapter.info || {};
  if (adapter.isFallbackAdapter || about.isFallbackAdapter || /swiftshader/i.test(`${about.vendor} ${about.architecture} ${about.description}`)) return false;
  if (!adapter.features.has('shader-f16') || adapter.limits.maxStorageBufferBindingSize < 256 * MB) return false;
  const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
  try {
    const n = 256;
    const input = new Float32Array(n);
    for (let i = 0; i < n; i++) input[i] = (i % 17) * 0.25 - 2; // exact in f16
    const S = G.GPUBufferUsage;
    const a = device.createBuffer({ size: n * 4, usage: S.STORAGE | S.COPY_DST });
    const o = device.createBuffer({ size: n * 4, usage: S.STORAGE | S.COPY_SRC });
    const read = device.createBuffer({ size: n * 4, usage: S.MAP_READ | S.COPY_DST });
    device.queue.writeBuffer(a, 0, input);
    const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: GPU_TEST }), entryPoint: 'main' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: a } }, { binding: 1, resource: { buffer: o } }] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(n / 64);
    pass.end();
    enc.copyBufferToBuffer(o, 0, read, 0, n * 4);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(G.GPUMapMode.READ);
    const out = new Float32Array(read.getMappedRange().slice(0));
    read.unmap();
    return out.every((v, i) => Math.abs(v - 5 * input[i]) < 1e-3);
  } finally {
    try { device.destroy(); } catch (e) { /* ignore */ }
  }
}
let gpuChecked = null;
function gpuUsable() {
  if (gpuBad()) return Promise.resolve(false);
  if (!gpuChecked) {
    const timeout = new Promise((r) => setTimeout(() => r(false), 4000));
    gpuChecked = Promise.race([gpuTest().catch(() => false), timeout]);
  }
  return gpuChecked;
}

/* ------------------------------------------------------------------ runtime */
// The log: this file's own lines (what loaded where, fallbacks, errors), which never hold a chat, and
// the engine's (wllama and llama.cpp), which can quote a model's output. The self-test's report, which
// can go to GitHub, keeps engine lines from its own run only (its question is a general one).
const LOG = [];
let logSeq = 0;
function log(level, args, engine) {
  const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ');
  LOG.push({ n: ++logSeq, engine: !!engine, line: `${level}: ${text}`.slice(0, 400) });
  if (LOG.length > 80) LOG.shift();
  if (cfg.debug) (console[level] || console.log)('[llm]', ...args);
}
// wllama's own messages go to logs() (and the console with configure({ debug: true })). Its worker's
// error event comes here too, and only here: that means the worker is gone.
const isWorkerError = (a) => !!a && typeof a === 'object' && !(a instanceof Error) && 'filename' in a && 'lineno' in a;
const LOGGER = {
  debug: (...a) => { if (cfg.debug) log('debug', a, true); },
  log: (...a) => log('log', a, true),
  warn: (...a) => log('warn', a, true),
  error: (...a) => { log('error', a.map((x) => (isWorkerError(x) ? `worker error: ${x.message || 'unknown'}` : x)), true); if (a.some(isWorkerError)) workerDied(a.find(isWorkerError)); },
};
// Never used: models come from ModelStore, so wllama must not download or cache anything itself.
const NO_STORE = Object.freeze({});
const script = G.document && G.document.currentScript && G.document.currentScript.src;
const wasmUrl = () => new URL('wllama/wllama.wasm', script || new URL('lazy/', G.document.baseURI)).href;

let current = null;        // { id, engine: 'native' | 'wasm', m, ctx, gpu, threads, w (wasm) }
let pending = null;        // { id, promise, listeners } while a model loads
let lastLoad = null;       // { id, preferGpu }: what chat() reloads after an idle unload
let running = null;        // { stop, done } for the answer in flight
let idleTimer = 0;
let stats = null;
let ops = Promise.resolve();
const serial = (fn) => { const p = ops.then(fn); ops = p.then(() => {}, () => {}); return p; };

function info() { return current ? { id: current.id, engine: current.engine, gpu: current.gpu, ctx: current.ctx, threads: current.threads } : null; }
const hidden = () => !!(G.document && G.document.visibilityState === 'hidden');
const idleMs = () => cfg.idleMs || (hidden() ? IDLE_HIDDEN : IDLE_SHOWN);
// Idle unload: skipped if an answer started meanwhile (answers don't queue behind it).
function touch() {
  clearTimeout(idleTimer);
  if (current && !running) idleTimer = setTimeout(() => serial(() => (running || !current ? null : stop())), idleMs());
}
if (G.document && G.document.addEventListener) G.document.addEventListener('visibilitychange', touch);
// Android is short of memory (MainActivity.onTrimMemory): running critically low, or the app is in
// the background and next in line to be killed. A loaded model is the biggest thing to let go.
const earlierLow = hooks.onMemoryLow;
hooks.onMemoryLow = function (level) {
  if (typeof earlierLow === 'function') { try { earlierLow.apply(this, arguments); } catch (e) { /* ignore */ } }
  const n = Number(level);
  if ((n === 15 || n >= 60) && current && !running) { log('warn', [`memory low (${n}): unloading`]); unload(); }
};

// Calls onStall after ms without a poke().
function watchdog(ms, onStall) {
  let t = 0;
  const poke = () => { clearTimeout(t); t = setTimeout(onStall, ms); };
  poke();
  return { poke, stop: () => clearTimeout(t) };
}

const isAbort = (e) => e instanceof WllamaAbortError || (e && e.name === 'AbortError');
// wllama, llama.cpp and native engine errors → one of our codes. phase: 'load' or 'chat'.
function explain(e, phase) {
  if (e && e.code && MESSAGES[e.code]) return e;
  const msg = String((e && e.message) || e || '');
  log('error', [`${phase}:`, msg]);
  if (phase === 'chat' && ((e && e.type === 'kv_cache_full') || /exceed|context size|kv.?cache/i.test(msg))) return llmError('too-long', msg);
  if ((e && e.name === 'RangeError') || /out of memory|cannot allocate|failed to allocate|allocation failed|enlarge memory|not enough memory|\bOOM\b/i.test(msg)) return llmError('memory', msg);
  if (e && e.name === 'RuntimeError') return llmError('crashed', msg); // the wasm aborted: its worker is gone
  return llmError(phase === 'chat' ? 'failed' : 'load', msg);
}

async function stop() {
  clearTimeout(idleTimer);
  const c = current;
  current = null;
  if (!c) return;
  if (running) { running.stop(); await running.done; }
  if (c.engine === 'native') { try { bridge().llmUnload(); } catch (e) { /* the service may be gone already */ } return; }
  try { await c.w.exit(); } catch (e) { /* the worker may be gone already */ }
}
// Frees the model's memory (it also goes by itself when idle).
function unload() { return serial(stop); }

/* ------------------------------------------------------------------ prompts */
// Every model here speaks ChatML. Qwen3.5 thinks before it answers unless the prompt ends with an
// empty think block (what its own template does with thinking off), so both engines get exactly this
// text and neither depends on a template engine. Nothing in a message can open or close a turn.
const TURN_TAGS = /<\|(im_start|im_end|endoftext)\|>/g;
function chatml(msgs, m, open = true) {
  let s = '';
  for (const x of msgs) s += `<|im_start|>${x.role}\n${String(x.content).replace(TURN_TAGS, '<$1>')}<|im_end|>\n`;
  return open ? `${s}<|im_start|>assistant\n${m && m.think ? '<think>\n\n</think>\n\n' : ''}` : s;
}

/* ------------------------------------------------------------------ the native engine */
// LlmService runs llama.cpp in the app's ":llm" process. If it can't start a model, that model uses
// the in-app engine; if its process dies while it's working (a crash, or Android reclaiming the
// memory), the in-app engine takes over for the rest of the session.
const NATIVE_BATCH = 256; // prompt tokens read per step: big batches suit the phone's CPU
const nat = { about: null, off: false, bad: {}, load: null, reqs: new Map(), seq: 0 };
function nativeAbout() {
  if (!nat.about) {
    let o = { ok: false };
    try { const b = bridge(); if (b && b.llmNative) o = JSON.parse(b.llmNative() || '{}') || o; } catch (e) { o = { ok: false }; }
    nat.about = o;
  }
  return nat.about;
}
const nativeOk = (m) => !nat.off && !!nativeAbout().ok && !(m && nat.bad[m.id]);
function onLlm(e) {
  if (typeof e === 'string') { try { e = JSON.parse(e); } catch (x) { return; } }
  if (!e || !e.type) return;
  if (e.type === 'died') { nativeDied(); return; }
  if (/^load/.test(e.type)) { if (nat.load) nat.load(e); return; }
  const r = nat.reqs.get(String(e.req || ''));
  if (r) r(e);
}
const earlierLlm = hooks.onLlm;
hooks.onLlm = function (e) {
  if (typeof earlierLlm === 'function') { try { earlierLlm.apply(this, arguments); } catch (x) { /* ignore */ } }
  onLlm(e);
};
function nativeDied() {
  const busy = !!nat.load || nat.reqs.size > 0;
  // Android can reclaim an idle service's process, or a busy one in the background; that isn't the
  // engine's fault. Dying while it's working on screen is.
  if (busy && !hidden()) nat.off = true;
  log('warn', [`native engine stopped${busy ? ' while working' : ''}${nat.off ? ': the in-app engine takes over' : ''}`]);
  if (current && current.engine === 'native') current = null;
  const err = Object.assign(llmError('crashed', 'the native engine\'s process died'), { native: true });
  if (nat.load) nat.load({ type: 'died', err });
  for (const r of [...nat.reqs.values()]) r({ type: 'died', err });
}
function nativeLoad(m, report) {
  return new Promise((resolve, reject) => {
    const end = (err, e) => { dog.stop(); nat.load = null; if (err) reject(err); else resolve(e); };
    const dog = watchdog(cfg.stall.load, () => { try { bridge().llmUnload(); } catch (x) { /* ignore */ } end(llmError('stalled', 'native load')); });
    nat.load = (e) => {
      if (e.type === 'loadProgress') { dog.poke(); report({ loaded: Math.round((Number(e.progress) || 0) * 1000), total: 1000 }); } else if (e.type === 'loaded') end(null, e);
      else if (e.type === 'loadFailed') end(/memory|alloc/i.test(e.error || '') ? llmError('memory', e.error) : llmError('load', e.error));
      else if (e.type === 'died') end(e.err);
    };
    let ok = false;
    try { ok = !!bridge().llmLoad(JSON.stringify({ id: m.id, ctx: m.ctx, batch: NATIVE_BATCH })); } catch (x) { ok = false; }
    if (!ok) end(llmError('not-installed'));
  });
}
const FINISH = ['stop', 'length', null, 'error'];
// One answer (or, with maxTokens 0, only reading the prompt). o: { prompt, gen, maxTokens, grammar,
// signal, onRaw(text), onPrompt(done, total) }.
function nativeRun(c, o) {
  return new Promise((resolve, reject) => {
    const req = `r${++nat.seq}`;
    // Stopped, it answers within a batch or two. If it doesn't within 5 s, it's stuck: the in-app
    // engine takes over for this session.
    let late = 0;
    const onAbort = () => {
      try { bridge().llmAbort(req); } catch (x) { /* ignore */ }
      late = setTimeout(() => { off(); nat.off = true; if (current === c) current = null; log('warn', ['native engine didn\'t stop']); reject(llmError('stalled', 'native engine didn\'t stop')); }, 5000);
    };
    const off = () => { clearTimeout(late); nat.reqs.delete(req); o.signal.removeEventListener('abort', onAbort); };
    nat.reqs.set(req, (e) => {
      if (e.type === 'text') o.onRaw(String(e.text || ''));
      else if (e.type === 'progress') o.onPrompt(Number(e.done) || 0, Number(e.total) || 0);
      else if (e.type === 'died') { off(); reject(e.err); } else if (e.type === 'done') {
        off();
        const s = e.stats || {};
        const code = Number(e.code);
        if (code === 0) {
          resolve({ aborted: !!s.aborted, finish: FINISH[s.finish] === undefined ? null : FINISH[s.finish], tokens: s.tokens || 0, promptTokens: Math.max(0, (s.promptTokens || 0) - (s.reusedTokens || 0)), cachedTokens: s.reusedTokens || 0, tokensPerSec: s.genMs > 0 ? (s.tokens * 1000) / s.genMs : 0 });
        } else if (code === 1) reject(llmError('too-long'));
        else if (e.error === 'not-loaded') reject(Object.assign(llmError('not-loaded'), { reload: true }));
        else reject(llmError('failed', `native engine code ${code}`));
      }
    });
    o.signal.addEventListener('abort', onAbort, { once: true });
    const g = o.gen;
    let ok = false;
    try {
      ok = !!bridge().llmGenerate(JSON.stringify({
        req, prompt: o.prompt, temperature: g.temperature, top_p: g.top_p, min_p: g.min_p || 0, top_k: g.top_k, repeat_penalty: g.repeat_penalty || 1, max_tokens: o.maxTokens, seed: 0, grammar: o.grammar || '',
      }));
    } catch (x) { ok = false; }
    if (!ok) { off(); reject(llmError('failed', 'the app didn\'t take the request')); return; }
    if (o.signal.aborted) onAbort();
  });
}

/* ------------------------------------------------------------------ the in-app engine (wllama) */
// wllama only logs its worker dying; whatever was waiting on it would wait forever. Everything that
// waits on the worker goes through guard(), which rejects when that happens.
const dying = new Set();
function guard(p) {
  let fail;
  const died = new Promise((_, reject) => { fail = reject; });
  dying.add(fail);
  return Promise.race([p, died]).finally(() => dying.delete(fail));
}
function workerDied(ev) {
  const err = llmError('crashed', (ev && ev.message) || 'worker error');
  const c = current;
  if (c && c.engine === 'wasm') { current = null; try { c.w.exit(); } catch (e) { /* ignore */ } }
  for (const fail of [...dying]) fail(err);
}

// Whether wllama can run more than one thread here (it needs memory shared between workers).
const threaded = () => typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
// threads: null lets wllama use half the cores when the WebView can share memory between workers
// (SharedArrayBuffer), else one; 1 forces one.
async function startWorker(m, file, bytes, gpu, onRead, threads) {
  const w = new Wllama({ default: wasmUrl() }, { logger: LOGGER, cacheManager: NO_STORE, modelManager: NO_STORE });
  w.setCompat(null); // compat mode would fetch another worker and wasm from a CDN
  let stuck = false;
  const dog = watchdog(cfg.stall.load, () => { stuck = true; workerDied({ message: 'no progress loading the model' }); });
  try {
    await guard(w.loadModel([new RangeFile(fileUrl(file), bytes, (n) => { dog.poke(); onRead(n); })], Object.assign({
      n_ctx: m.ctx, n_parallel: 1, n_gpu_layers: gpu ? 999 : 0, log_level: LogLevel.WARN,
    }, threads ? { n_threads: threads } : {}, m.batch ? { n_batch: m.batch, n_ubatch: m.batch } : {})));
    // loadModel() resolves even when llama.cpp couldn't load the file (a damaged model, say).
    const loadedInfo = w.getLoadedContextInfo();
    if (loadedInfo.success === false || !(loadedInfo.n_vocab > 0)) throw new Error('llama.cpp could not load the model');
  } catch (e) {
    try { await w.exit(); } catch (x) { /* ignore */ }
    throw stuck ? llmError('stalled', 'loading') : e;
  } finally {
    dog.stop();
  }
  return w;
}
// Same contract as nativeRun. The prompt goes in as text (no template), so what the model reads is
// exactly what the native engine reads.
function wasmRun(c, o) {
  let timings = null;
  let finish = null;
  const call = c.w.createCompletion(Object.assign({
    prompt: o.prompt,
    stream: true,
    // 0 would still write one token; the caller ignores it.
    max_tokens: Math.max(1, o.maxTokens),
    // Keeps the unchanged start of the prompt (the rules, earlier turns) cached between answers.
    cache_prompt: true,
    return_progress: true,
    stop: ['<|im_end|>', '<|endoftext|>'],
    abortSignal: o.signal,
    onData: (chunk) => {
      if (!chunk) return;
      if (chunk.timings) timings = chunk.timings;
      const p = chunk.prompt_progress;
      if (p && p.total > 0) o.onPrompt(Math.max(0, p.processed - p.cache), Math.max(1, p.total - p.cache));
      const choice = chunk.choices && chunk.choices[0];
      if (choice && choice.finish_reason) finish = choice.finish_reason;
      if (choice && choice.text && o.maxTokens > 0) o.onRaw(choice.text);
    },
  }, o.gen, o.grammar ? { grammar: o.grammar } : {}));
  // A worker that doesn't let go within 5 s of being stopped is shut down.
  let late = 0;
  const onAbort = () => { late = setTimeout(() => workerDied({ message: 'the worker didn\'t stop' }), 5000); };
  o.signal.addEventListener('abort', onAbort, { once: true });
  return guard(call).then(() => ({
    finish, tokens: timings ? timings.predicted_n : 0, promptTokens: timings ? timings.prompt_n : null, cachedTokens: timings ? timings.cache_n : null, tokensPerSec: timings ? timings.predicted_per_second : 0,
  })).finally(() => { clearTimeout(late); o.signal.removeEventListener('abort', onAbort); });
}

// A page that dies while the in-app engine works (the WebView ran out of memory, and the app
// rebuilt it) leaves this mark; lastCrash() finds it on the next start.
const ACTIVE = 'gh.llm.active';
function mark(c) { if (c.engine === 'wasm') { try { G.localStorage.setItem(ACTIVE, JSON.stringify({ id: c.id, at: now() })); } catch (e) { /* ignore */ } } }
function unmark() { try { G.localStorage.removeItem(ACTIVE); } catch (e) { /* ignore */ } }
// { id, at } when the page crashed while the in-app engine was loading or answering (once).
function lastCrash() {
  let v = null;
  try { v = JSON.parse(G.localStorage.getItem(ACTIVE) || 'null'); } catch (e) { v = null; }
  unmark();
  if (!v || !v.id || !(now() - v.at < 30 * 60000)) return null;
  // The app counts renderer crashes; a page closed any other way (swiped away) isn't one.
  try { const b = bridge(); if (b && b.rendererGone && !(Number(b.rendererGone()) > 0)) return null; } catch (e) { /* assume it was */ }
  return v;
}

/* ------------------------------------------------------------------ loading */
async function doLoad(m, opts) {
  if (current && current.id === m.id) { touch(); return info(); }
  const av = available();
  if (!av.ok) throw llmError('unavailable', av.reason);
  if (!fits(m)) throw llmError('memory');
  // A file that isn't the pinned one (installed() leaves it out) doesn't load either engine.
  if (bridge() && bridge().modelList && !(await installed()).some((x) => x.id === m.id)) throw llmError('not-installed');
  if (current) await stop();
  const report = opts.report;
  const t0 = now();
  if (nativeOk(m)) {
    try {
      const e = await nativeLoad(m, report);
      current = { id: m.id, engine: 'native', m, ctx: Number(e.ctx) || m.ctx, gpu: false, threads: Number(e.threads) || 0, about: String(e.info || '') };
      log('log', [`loaded ${m.id} (native, ${current.threads} threads) in ${now() - t0} ms`]);
      touch();
      return Object.assign(info(), { ms: now() - t0 });
    } catch (e) {
      // Not installed, or not enough memory: the in-app engine would fail the same way (or take the
      // page down with it).
      if (e.code === 'not-installed' || e.code === 'memory') throw e;
      nat.bad[m.id] = true;
      log('warn', ['native load failed, using the in-app engine:', e.message, e.detail || '']);
    }
  }
  if (!wasmSupported()) throw llmError('unavailable', 'On-device AI needs a newer Android System WebView. Update it from the Play Store.');
  let file = m.file;
  let bytes = 0;
  if (bridge() && bridge().modelList) {
    const entry = (await installed()).find((x) => x.id === m.id);
    if (entry) { file = entry.file || m.file; bytes = entry.bytes; }
  } else {
    bytes = await probeSize(fileUrl(file)).catch(() => 0);
  }
  if (!(bytes > 0)) throw llmError('not-installed');
  let read = 0;
  const onRead = (n) => { read += n; report({ loaded: Math.min(read, bytes), total: bytes }); };
  let gpu = opts.preferGpu !== false && await gpuUsable();
  let w;
  mark({ id: m.id, engine: 'wasm' });
  try {
    try {
      w = await startWorker(m, file, bytes, gpu, onRead, null);
    } catch (e) {
      // The GPU failed (don't try it again on this phone): the CPU. Or threads did: one thread. A CPU
      // load on one thread already (Android's WebView has no SharedArrayBuffer) or out of memory
      // would only fail again the same way, after reading the whole file a second time.
      if (gpu) { log('warn', ['WebGPU load failed, using the CPU:', e]); markGpuBad(); } else {
        const why = explain(e, 'load');
        if (!threaded() || why.code === 'memory' || why.code === 'stalled') throw why;
        log('warn', ['Load failed, trying one thread:', e]);
      }
      gpu = false;
      read = 0;
      try { w = await startWorker(m, file, bytes, false, onRead, 1); } catch (e2) { throw explain(e2, 'load'); }
    }
  } finally {
    unmark();
  }
  current = { id: m.id, engine: 'wasm', w, gpu, ctx: m.ctx, file, m, threads: w.getNumThreads ? w.getNumThreads() : 1 };
  log('log', [`loaded ${m.id} (in-app, ${gpu ? 'GPU' : 'CPU'}) in ${now() - t0} ms`]);
  touch();
  return Object.assign(info(), { ms: now() - t0 });
}

// Loads a downloaded model: resolves with { id, engine, gpu, ctx, threads, ms }. onProgress({ loaded,
// total }) follows the loading, including for a caller that joins a load already under way.
// preferGpu (default true) lets the in-app engine use WebGPU when its self-test passes.
function load(id, opts = {}) {
  let m;
  try { m = model(id); } catch (e) { return Promise.reject(e); }
  lastLoad = { id: m.id, preferGpu: opts.preferGpu };
  const listen = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  if (current && current.id === m.id && !pending) { touch(); return Promise.resolve(info()); }
  if (pending && pending.id === m.id) { if (listen) pending.listeners.add(listen); return pending.promise; }
  const listeners = new Set(listen ? [listen] : []);
  const report = (p) => { for (const fn of [...listeners]) { try { fn(p); } catch (e) { /* one listener's bug mustn't stop the rest */ } } };
  const promise = serial(() => doLoad(m, { preferGpu: opts.preferGpu, report }));
  pending = { id: m.id, promise, listeners };
  const clear = () => { if (pending && pending.promise === promise) pending = null; };
  promise.then(clear, clear);
  return promise;
}

/* ------------------------------------------------------------------ chat */
const ROLES = new Set(['system', 'user', 'assistant']);
function clean(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || !ROLES.has(m.role) || m.content == null) continue;
    const content = String(m.content);
    if (content.trim() || m.role === 'assistant') out.push({ role: m.role, content });
  }
  if (!out.some((m) => m.role !== 'system')) throw llmError('empty');
  return out;
}
// Keeps the conversation inside the context window: the system prompt and the newest turns stay. Token
// counts are estimated at 3 characters a token (on the safe side for Qwen's tokenizer and English).
function fit(msgs, ctx, maxTokens) {
  const budget = ctx - maxTokens - 64;
  const cost = (m) => Math.ceil(m.content.length / 3) + 6;
  const sys = msgs[0].role === 'system' ? [msgs[0]] : [];
  let used = sys.length ? cost(sys[0]) : 0;
  const kept = [];
  for (let i = msgs.length - 1; i >= sys.length; i--) {
    if (kept.length && used + cost(msgs[i]) > budget) break;
    used += cost(msgs[i]);
    kept.unshift(msgs[i]);
  }
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
  return sys.concat(kept);
}

// What to show of a reply so far. A model asked not to think sometimes does anyway: a <think> block
// (finished or not) is hidden, and so is a tag still arriving at the end.
function visible(raw) {
  let s = String(raw || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  const open = s.indexOf('<think>');
  if (open >= 0) s = s.slice(0, open);
  const partial = /<\/?t?h?i?n?k?$/.exec(s);
  if (partial && partial[0].length) s = s.slice(0, partial.index);
  return s.replace(/^\s+/, '');
}

let chats = Promise.resolve();
// Answers the conversation with the loaded model (reloading the last one if it went idle) and resolves
// with the reply. onToken(piece, textSoFar) streams it; onPrompt(done, total) follows the model
// reading the prompt; onLoadProgress({ loaded, total }) a reload. grammar (GBNF) holds the reply to
// a shape. lead is text the reply starts with: it goes into the prompt, so the model carries on from
// it, and it's part of what's streamed and returned. Aborting the signal stops cleanly and resolves
// with the text so far (stats.aborted is true). One chat runs at a time; others wait.
function chat(messages, opts = {}) {
  const job = chats.then(() => runChat(messages, opts));
  chats = job.then(() => {}, () => {});
  return job;
}
// Reads the system prompt ahead of the first question, so the answer starts sooner (the question's
// prompt begins the same way, and the engines keep it). Loads the model first if needed.
function prepare(system, opts = {}) {
  const job = chats.then(() => runChat([{ role: 'system', content: String(system || '') }], Object.assign({}, opts, { readOnly: true })));
  chats = job.then(() => {}, () => {});
  return job;
}

async function runChat(messages, opts) {
  const msgs = opts.readOnly ? messages.filter((m) => m && m.role === 'system') : clean(messages);
  if (!msgs.length) throw llmError('empty');
  const signal = opts.signal;
  if (signal && signal.aborted) return '';
  const ensure = async () => {
    if (current && !pending) return;
    const id = (pending && pending.id) || (lastLoad && lastLoad.id);
    if (!id) throw llmError('not-loaded');
    await load(id, { preferGpu: lastLoad && lastLoad.id === id ? lastLoad.preferGpu : undefined, onProgress: opts.onLoadProgress });
  };
  await ensure();
  if (signal && signal.aborted) return '';
  try {
    return await generate(current, msgs, opts);
  } catch (e) {
    if (e.reload) {
      // The native engine's process was started again without the model: load it and carry on.
      current = null;
      await ensure();
      return generate(current, msgs, opts);
    }
    if (!e.retryOnCpu) throw e;
    // The GPU crashed before the first word: carry on with the CPU (and don't try the GPU again).
    await load(e.retryOnCpu, { preferGpu: false, onProgress: opts.onLoadProgress });
    return generate(current, msgs, opts);
  }
}

async function generate(c, msgs, opts) {
  if (!c) throw llmError('not-loaded');
  const { onToken, signal } = opts;
  const readOnly = !!opts.readOnly;
  const maxTokens = readOnly ? 0 : Math.max(1, Math.min(Number(opts.maxTokens) || 256, Math.floor(c.ctx / 2)));
  const m = c.m || {};
  const gen = Object.assign({}, DEFAULT_GEN, m.gen || {}, opts.temperature != null ? { temperature: Number(opts.temperature) } : {});
  const lead = readOnly ? '' : String(opts.lead || '');
  const prompt = readOnly ? chatml(msgs, m, false) : chatml(fit(msgs, c.ctx, maxTokens), m) + lead;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', abort, { once: true });
  let finished;
  running = { stop: abort, done: new Promise((r) => { finished = r; }) };
  clearTimeout(idleTimer);
  let raw = lead;
  let text = '';
  let pieces = 0;
  let first = 0;
  let st = null;
  let aborted = false;
  let stalled = false;
  const dog = watchdog(cfg.stall.answer, () => { stalled = true; log('warn', ['answer stalled']); ctrl.abort(); });
  const t0 = now();
  const onRaw = (piece) => {
    dog.poke();
    pieces++;
    raw += piece;
    const next = visible(raw);
    if (next === text) return;
    // Only what's new since the last piece shown (a hidden tag can make it shorter: then resend).
    const add = next.startsWith(text) ? next.slice(text.length) : next;
    text = next;
    if (!first) first = now();
    if (onToken) { try { onToken(add, text); } catch (e) { /* a UI bug mustn't stop the answer */ } }
  };
  const onPrompt = (done, total) => {
    dog.poke();
    if (opts.onPrompt) { try { opts.onPrompt(done, total); } catch (e) { /* ignore */ } }
  };
  mark(c);
  try {
    st = await (c.engine === 'native' ? nativeRun : wasmRun)(c, { prompt, gen, maxTokens, grammar: opts.grammar, signal: ctrl.signal, onRaw, onPrompt });
    aborted = !!st.aborted || ctrl.signal.aborted;
  } catch (e) {
    if (!stalled && (isAbort(e) || (ctrl.signal.aborted && !(e && e.code)))) {
      aborted = true;
    } else {
      const err = stalled ? llmError('stalled', e && e.message) : explain(e, 'chat');
      if (c.engine === 'wasm' && ['crashed', 'memory', 'stalled'].includes(err.code)) {
        // The worker is gone, short of memory or stuck: drop it, so the next chat starts a fresh one.
        if (current === c) { current = null; try { await c.w.exit(); } catch (x) { /* ignore */ } }
        if (c.gpu && err.code !== 'stalled') { markGpuBad(); if (!text) err.retryOnCpu = c.id; }
      }
      throw err;
    }
  } finally {
    dog.stop();
    unmark();
    if (signal) signal.removeEventListener('abort', abort);
    running = null;
    finished();
    const genMs = first ? now() - first : 0;
    if (!readOnly) {
      stats = {
        id: c.id, engine: c.engine, gpu: c.gpu, aborted, finish: st ? st.finish : null, ms: now() - t0, firstMs: first ? first - t0 : null,
        tokens: (st && st.tokens) || pieces,
        promptTokens: st ? st.promptTokens : null,
        cachedTokens: st ? st.cachedTokens : null,
        tokensPerSec: st && st.tokensPerSec ? st.tokensPerSec : genMs > 0 ? (pieces * 1000) / genMs : 0,
      };
    }
    touch();
  }
  if (stalled) throw llmError('stalled');
  // A reply that was all thinking (it never got to an answer before the token limit): better its
  // words than nothing.
  if (!text.trim() && raw.trim() && !aborted) {
    text = raw.replace(/<\/?think>/g, '').trim();
    if (text && onToken) { try { onToken(text, text); } catch (e) { /* ignore */ } }
  }
  return text;
}

/* ------------------------------------------------------------------ self-test */
// For Settings: which engine runs here, how long the model takes to load and to start answering,
// how fast it writes, what the phone and WebView are, and the recent log. onStep(text) narrates. It
// can be sent to GitHub, so it holds nothing about the person: the question is a general one, and the
// log has the runtime's own lines plus the engine's from this run only.
async function selfTest(id, onStep) {
  const step = (t) => { if (onStep) { try { onStep(t); } catch (e) { /* ignore */ } } };
  const since = logSeq;
  const ua = String((G.navigator && G.navigator.userAgent) || '');
  const out = {
    at: new Date().toISOString(),
    native: Object.assign({}, nativeAbout(), { off: nat.off, failed: Object.keys(nat.bad) }),
    webview: (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || null,
    wasm: wasmSupported(),
    ram: ramGB(),
    model: id,
  };
  try {
    const m = model(id);
    const have = (await installed()).find((x) => x.id === id);
    out.file = have ? { bytes: have.bytes, expected: m.bytes, pinned: !!m.sha256, ok: m.sha256 ? have.bytes === m.bytes : Math.abs(have.bytes - m.bytes) <= m.bytes * 0.006 } : null;
    if (!have) throw llmError('not-installed');
    if (current && current.id === id) await unload();
    step('Loading the model');
    const t0 = now();
    const loaded = await load(id, { onProgress: (p) => { if (p && p.total) step(`Loading the model ${Math.round((p.loaded / p.total) * 100)}%`); } });
    out.loadMs = now() - t0;
    out.engine = loaded.engine;
    out.threads = loaded.threads;
    out.gpu = loaded.gpu;
    out.about = current && current.about ? current.about : null;
    step('Writing a short answer');
    const reply = await chat([{ role: 'system', content: 'You are a helpful assistant. Be brief.' }, { role: 'user', content: 'In one sentence, why does sleep help muscles recover?' }], { maxTokens: 48 });
    out.reply = reply.slice(0, 200);
    out.stats = stats;
    out.ok = !!reply.trim();
  } catch (e) {
    out.ok = false;
    out.error = `${e.code || 'error'}: ${e.message}${e.detail ? ` (${e.detail})` : ''}`;
  }
  out.log = LOG.filter((e) => !e.engine || e.n > since).map((e) => e.line).slice(-40);
  return out;
}

GH.llm = {
  get MODELS() { return cfg.models; },
  configure, available, offered, recommended, ramGB, visible, chatml,
  installed, freeSpace, download, cancel, remove, status, onProgress,
  load, loaded: info, unload, chat, prepare, selfTest, lastCrash,
  get stats() { return stats; },
  get engine() { return nativeOk() ? 'native' : 'wasm'; },
  logs: () => LOG.map((e) => e.line),
  MESSAGES,
};
