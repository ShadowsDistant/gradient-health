/* On-device AI (loads on demand: GH.lazy('llm') sets GH.llm). A small open model runs entirely on the
 * phone with llama.cpp compiled to WebAssembly (@wllama/wllama): on the CPU, with threads where the
 * WebView allows them (Android WebView has no SharedArrayBuffer today, so one), and on the GPU through
 * WebGPU when a quick self-test passes.
 *
 * The Android shell downloads the model files (ModelStore.java: resumable, Wi-Fi only if asked, checked
 * against the size, the GGUF header and the SHA-256) into the app's private storage and serves them
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
// 3.6.1 runs it, which test/llm.mjs checks with a tiny model of the same layout. Hugging Face was
// blocked from the machine this was written on, so the names and sizes come from each file's page on
// the Hub (shown to 3 digits, well inside ModelStore's size check), and the SHA-256 checked on the
// phone is the one the Hub reports for the file (X-Linked-Etag).
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
    id: 'q35-08', tier: 'fast', name: 'Fast', label: 'Qwen3.5 0.8B', speed: 3, quality: 1,
    file: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    bytes: 533e6, minRamGB: 3,
  }, QWEN35),
  Object.assign({
    id: 'q35-2', tier: 'balanced', name: 'Balanced', label: 'Qwen3.5 2B', speed: 2, quality: 2,
    file: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    bytes: 1.28e9, minRamGB: 4,
  }, QWEN35),
  Object.assign({
    id: 'q35-4', tier: 'best', name: 'Best answers', label: 'Qwen3.5 4B', speed: 1, quality: 3,
    file: 'Qwen3.5-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    bytes: 2.74e9, minRamGB: 8,
  }, QWEN35),
  // 1.2's models (Qwen2.5 Instruct from Qwen's own GGUF repos): no longer offered, but one that's
  // already on the phone keeps working until it's deleted. Their SHA-256 is pinned.
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

const IDLE_MS = 2 * 60 * 1000;
const cfg = { models: MODELS, baseUrl: 'models/', served: false, idleMs: IDLE_MS, debug: false };

// Tests and plain browsers: configure({ baseUrl }) says where the model files are served (there's no
// bridge to ask), { models } replaces the table, { idleMs } shortens the idle unload.
function configure(o = {}) {
  if (o.baseUrl != null) { cfg.baseUrl = String(o.baseUrl).replace(/\/?$/, '/'); cfg.served = true; }
  if (Array.isArray(o.models)) cfg.models = o.models.map((m) => Object.assign({ minRamGB: 0, ctx: 2048 }, m));
  if (o.idleMs != null) cfg.idleMs = Math.max(100, Number(o.idleMs) || IDLE_MS);
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
  size: DAMAGED, format: DAMAGED, checksum: DAMAGED,
  io: 'The model couldn\'t be saved on this phone.',
  cancelled: 'Download cancelled.',
  'not-installed': 'Download the model first.',
  'not-loaded': 'Load a model first.',
  load: 'The model couldn\'t be started. Try again.',
  crashed: 'The on-device model stopped unexpectedly. Try again.',
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
  if (!wasmSupported()) return { ok: false, reason: 'On-device AI needs a newer Android System WebView. Update it from the Play Store.' };
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
// The models to offer on this phone: the current ones it has the memory for (Best answers only with
// 8 GB or more). Older models only show up while they're installed.
function offered() { return cfg.models.filter((m) => !m.legacy && fits(m)); }
// The one to suggest: Balanced with 6 GB or more (or when the phone doesn't say), else the smallest
// that fits. Best answers is never pushed: it's slow on most phones' CPUs.
function recommended() {
  const list = offered();
  if (!list.length) return null;
  const ram = ramGB();
  const pick = (tier) => list.find((m) => m.tier === tier);
  return (ram == null || ram >= 6 ? pick('balanced') : null) || pick('fast') || list[0];
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

// [{ id, file, bytes }]: from the Android shell, or (browser, tests) the files found at baseUrl.
async function installed() {
  const b = bridge();
  if (b && b.modelList) {
    let list = [];
    try { list = JSON.parse(b.modelList() || '[]'); } catch (e) { list = []; }
    return list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), file: String(x.file || ''), bytes: Number(x.bytes) || 0 }));
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.url, { headers: { Range: `bytes=${this.start}-${this.end - 1}` }, cache: 'no-store' });
        if (res.status !== 206 && !(res.status === 200 && this.start === 0 && this.end === this.total)) {
          try { if (res.body) await res.body.cancel(); } catch (e) { /* ignore */ }
          throw new Error(`model read failed: HTTP ${res.status}`);
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength !== n) throw new Error(`model read failed: ${buf.byteLength} of ${n} bytes`);
        if (this.onRead) this.onRead(n);
        return buf;
      } catch (e) { last = e; }
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
const LOG = [];
function log(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })())).join(' ');
  LOG.push(`${level}: ${text}`.slice(0, 400));
  if (LOG.length > 80) LOG.shift();
  if (cfg.debug) (console[level] || console.log)('[llm]', ...args);
}
// wllama's own messages go to logs() (and the console with configure({ debug: true })).
const LOGGER = {
  debug: (...a) => { if (cfg.debug) log('debug', a); },
  log: (...a) => log('log', a),
  warn: (...a) => log('warn', a),
  error: (...a) => log('error', a),
};
// Never used: models come from ModelStore, so wllama must not download or cache anything itself.
const NO_STORE = Object.freeze({});
const script = G.document && G.document.currentScript && G.document.currentScript.src;
const wasmUrl = () => new URL('wllama/wllama.wasm', script || new URL('lazy/', G.document.baseURI)).href;

let current = null;        // { id, w, gpu, ctx, file }
let pending = null;        // { id, promise } while a model loads
let lastLoad = null;       // { id, preferGpu }: what chat() reloads after an idle unload
let running = null;        // { stop, done } for the chat in flight
let idleTimer = 0;
let stats = null;
let ops = Promise.resolve();
const serial = (fn) => { const p = ops.then(fn); ops = p.then(() => {}, () => {}); return p; };

function info() { return current ? { id: current.id, gpu: current.gpu, ctx: current.ctx, threads: current.threads } : null; }
// Idle unload: skipped if a chat started meanwhile (chats don't queue behind it).
function touch() {
  clearTimeout(idleTimer);
  if (current && !running) idleTimer = setTimeout(() => serial(() => (running || !current ? null : stop())), cfg.idleMs);
}

const isAbort = (e) => e instanceof WllamaAbortError || (e && e.name === 'AbortError');
// wllama and llama.cpp errors → one of our codes. phase: 'load' or 'chat'.
function explain(e, phase) {
  if (e && e.code && MESSAGES[e.code]) return e;
  const msg = String((e && e.message) || e || '');
  log('error', [`${phase}:`, msg]);
  if (phase === 'chat' && ((e && e.type === 'kv_cache_full') || /exceed|context size|kv.?cache/i.test(msg))) return llmError('too-long', msg);
  if ((e && e.name === 'RangeError') || /out of memory|cannot allocate|failed to allocate|allocation failed|enlarge memory|\bOOM\b/i.test(msg)) return llmError('memory', msg);
  if (e && e.name === 'RuntimeError') return llmError('crashed', msg); // the wasm aborted: its worker is gone
  return llmError(phase === 'chat' ? 'failed' : 'load', msg);
}

async function stop() {
  clearTimeout(idleTimer);
  const c = current;
  current = null;
  if (!c) return;
  if (running) { running.stop(); await running.done; }
  try { await c.w.exit(); } catch (e) { /* the worker may be gone already */ }
}
// Frees the model's memory (it also goes by itself after two idle minutes).
function unload() { return serial(stop); }

// threads: null lets wllama use half the cores when the WebView can share memory between workers
// (SharedArrayBuffer), else one; 1 forces one.
async function startWorker(m, file, bytes, gpu, onRead, threads) {
  const w = new Wllama({ default: wasmUrl() }, { logger: LOGGER, cacheManager: NO_STORE, modelManager: NO_STORE });
  w.setCompat(null); // compat mode would fetch another worker and wasm from a CDN
  try {
    await w.loadModel([new RangeFile(fileUrl(file), bytes, onRead)], Object.assign({
      n_ctx: m.ctx, n_parallel: 1, n_gpu_layers: gpu ? 999 : 0, jinja: true, log_level: LogLevel.WARN,
    }, threads ? { n_threads: threads } : {}, m.batch ? { n_batch: m.batch, n_ubatch: m.batch } : {}));
    // loadModel() resolves even when llama.cpp couldn't load the file (a damaged model, say).
    const loadedInfo = w.getLoadedContextInfo();
    if (loadedInfo.success === false || !(loadedInfo.n_vocab > 0)) throw new Error('llama.cpp could not load the model');
  } catch (e) {
    try { await w.exit(); } catch (x) { /* ignore */ }
    throw e;
  }
  return w;
}

async function doLoad(m, opts) {
  if (current && current.id === m.id) { touch(); return info(); }
  const av = available();
  if (!av.ok) throw llmError('unavailable', av.reason);
  if (!fits(m)) throw llmError('memory');
  if (current) await stop();
  let file = m.file;
  let bytes = 0;
  if (bridge() && bridge().modelList) {
    const entry = (await installed()).find((x) => x.id === m.id);
    if (entry) { file = entry.file || m.file; bytes = entry.bytes; }
  } else {
    bytes = await probeSize(fileUrl(file)).catch(() => 0);
  }
  if (!(bytes > 0)) throw llmError('not-installed');
  const report = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  let read = 0;
  const onRead = (n) => {
    read += n;
    if (report) { try { report({ loaded: Math.min(read, bytes), total: bytes }); } catch (e) { /* ignore */ } }
  };
  const t0 = now();
  let gpu = opts.preferGpu !== false && await gpuUsable();
  let w;
  try {
    w = await startWorker(m, file, bytes, gpu, onRead, null);
  } catch (e) {
    // The GPU failed (don't try it again on this phone), or threads did: one thread on the CPU.
    if (gpu) { log('warn', ['WebGPU load failed, using the CPU:', e]); markGpuBad(); } else log('warn', ['Load failed, trying one thread:', e]);
    gpu = false;
    read = 0;
    try { w = await startWorker(m, file, bytes, false, onRead, 1); } catch (e2) { throw explain(e2, 'load'); }
  }
  current = { id: m.id, w, gpu, ctx: m.ctx, file, m, threads: w.getNumThreads ? w.getNumThreads() : 1 };
  log('log', [`loaded ${m.id} on the ${gpu ? 'GPU' : 'CPU'} in ${now() - t0} ms`]);
  touch();
  return Object.assign(info(), { ms: now() - t0 });
}

// Loads a downloaded model: resolves with { id, gpu, ctx, ms }. onProgress({ loaded, total }) follows
// the model file being read. preferGpu (default true) uses WebGPU when the self-test passes.
function load(id, opts = {}) {
  let m;
  try { m = model(id); } catch (e) { return Promise.reject(e); }
  lastLoad = { id: m.id, preferGpu: opts.preferGpu };
  if (current && current.id === m.id && !pending) { touch(); return Promise.resolve(info()); }
  if (pending && pending.id === m.id) return pending.promise;
  const promise = serial(() => doLoad(m, opts));
  pending = { id: m.id, promise };
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
// with the reply. onToken(piece, textSoFar) streams it. Aborting the signal stops generation cleanly
// and resolves with the text so far (stats.aborted is true). One chat runs at a time; others wait.
function chat(messages, opts = {}) {
  const job = chats.then(() => runChat(messages, opts));
  chats = job.then(() => {}, () => {});
  return job;
}

async function runChat(messages, opts) {
  const msgs = clean(messages);
  const signal = opts.signal;
  if (signal && signal.aborted) return '';
  if (!current || pending) {
    const id = (pending && pending.id) || (lastLoad && lastLoad.id);
    if (!id) throw llmError('not-loaded');
    await load(id, { preferGpu: lastLoad && lastLoad.id === id ? lastLoad.preferGpu : undefined, onProgress: opts.onLoadProgress });
    if (signal && signal.aborted) return '';
  }
  try {
    return await generate(current, msgs, opts);
  } catch (e) {
    if (!e.retryOnCpu) throw e;
    // The GPU crashed before the first word: carry on with the CPU (and don't try the GPU again).
    await load(e.retryOnCpu, { preferGpu: false, onProgress: opts.onLoadProgress });
    return generate(current, msgs, opts);
  }
}

async function generate(c, msgs, opts) {
  if (!c) throw llmError('not-loaded');
  const { onToken, signal } = opts;
  const maxTokens = Math.max(1, Math.min(Number(opts.maxTokens) || 256, Math.floor(c.ctx / 2)));
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', abort, { once: true });
  let finished;
  running = { stop: abort, done: new Promise((r) => { finished = r; }) };
  clearTimeout(idleTimer);
  let raw = '';
  let text = '';
  let pieces = 0;
  let first = 0;
  let timings = null;
  let finish = null;
  let aborted = false;
  const t0 = now();
  const m = c.m || {};
  const gen = Object.assign({}, DEFAULT_GEN, m.gen || {});
  try {
    await c.w.createChatCompletion(Object.assign({
      messages: fit(msgs, c.ctx, maxTokens),
      stream: true,
      max_tokens: maxTokens,
      // cache_prompt keeps the unchanged start of the conversation (the system prompt, earlier turns)
      // in the cache, so only the new part is processed each turn.
      cache_prompt: true,
      stop: ['<|im_end|>', '<|endoftext|>'],
      abortSignal: ctrl.signal,
      onData: (chunk) => {
        const choice = chunk && chunk.choices && chunk.choices[0];
        if (chunk && chunk.timings) timings = chunk.timings;
        if (choice && choice.finish_reason) finish = choice.finish_reason;
        const delta = choice && choice.delta && choice.delta.content;
        if (!delta) return;
        pieces++;
        raw += delta;
        const next = visible(raw);
        if (next === text) return;
        // Only what's new since the last piece shown (a hidden tag can make it shorter: then resend).
        const piece = next.startsWith(text) ? next.slice(text.length) : next;
        text = next;
        if (!first) first = now();
        if (onToken) { try { onToken(piece, text); } catch (e) { /* a UI bug mustn't stop the answer */ } }
      },
    }, gen, opts.temperature != null ? { temperature: Number(opts.temperature) } : {},
    // Qwen3 and 3.5 templates think before answering unless told not to.
    m.think ? { chat_template_kwargs: { enable_thinking: false } } : {}));
  } catch (e) {
    if (isAbort(e) || ctrl.signal.aborted) {
      aborted = true;
    } else {
      const err = explain(e, 'chat');
      if (err.code === 'crashed' || err.code === 'memory') {
        // The worker is gone (or short of memory): drop it, so the next chat starts a fresh one.
        if (current === c) { current = null; try { await c.w.exit(); } catch (x) { /* ignore */ } }
        if (c.gpu) { markGpuBad(); if (!text) err.retryOnCpu = c.id; }
      }
      throw err;
    }
  } finally {
    if (signal) signal.removeEventListener('abort', abort);
    running = null;
    finished();
    const genMs = first ? now() - first : 0;
    stats = {
      id: c.id, gpu: c.gpu, aborted, finish, ms: now() - t0,
      tokens: (timings && timings.predicted_n) || pieces,
      promptTokens: timings ? timings.prompt_n : null,
      cachedTokens: timings ? timings.cache_n : null,
      tokensPerSec: timings && timings.predicted_per_second ? timings.predicted_per_second : genMs > 0 ? (pieces * 1000) / genMs : 0,
    };
    touch();
  }
  // A reply that was all thinking (it never got to an answer before the token limit): better its
  // words than nothing.
  if (!text.trim() && raw.trim() && !aborted) {
    text = raw.replace(/<\/?think>/g, '').trim();
    if (text && onToken) { try { onToken(text, text); } catch (e) { /* ignore */ } }
  }
  return text;
}

GH.llm = {
  get MODELS() { return cfg.models; },
  configure, available, offered, recommended, ramGB, visible,
  installed, freeSpace, download, cancel, remove, status, onProgress,
  load, loaded: info, unload, chat,
  get stats() { return stats; },
  logs: () => LOG.slice(),
  MESSAGES,
};
