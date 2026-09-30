// The on-device AI runtime (src/llm.js, lazy chunk "llm") in Chromium, with a tiny random-weight model
// standing in for Qwen: the chunk loads under the page's CSP, the model catalog, the model is read
// with Range requests only, chat() streams tokens, reuses the KV cache, stops mid-stream, queues,
// unloads (also by itself when idle) and reloads, a tiny model with Qwen3.5's hybrid layout loads and
// reuses nearly all of a repeated prompt, thinking that slips out is hidden, and the download API
// works against a fake Android bridge, and so does the app's native engine (a fake LlmService: its
// prompt, streaming, Stop, reloads, a stuck or crashed engine). It prints how fast the tiny model
// generates. Needs
// `npm run build` and Playwright; build/tiny.gguf and build/tiny-qwen35.gguf are made on the first
// run by scripts/make-tiny-gguf.py, which needs the gguf package:
//
//   python3 -m venv build/venv && build/venv/bin/pip install gguf numpy
//   npm run build && node test/llm.mjs
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { root, check, section, done } from './lib.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const DIST = join(root, 'dist');
const MODEL = join(root, 'build/tiny.gguf');
const MODEL35 = join(root, 'build/tiny-qwen35.gguf');
if (!existsSync(join(DIST, 'lazy/llm.js'))) { console.error('Missing dist/lazy/llm.js. Run: npm run build'); process.exit(1); }
for (const [file, arch] of [[MODEL, 'llama'], [MODEL35, 'qwen35']]) {
  if (existsSync(file)) continue;
  const venv = join(root, 'build/venv/bin/python');
  const made = spawnSync(existsSync(venv) ? venv : 'python3', [join(root, 'scripts/make-tiny-gguf.py'), '--arch', arch], { stdio: 'inherit' });
  if (made.status !== 0 || !existsSync(file)) {
    console.error(`Couldn't make ${file}. Run: python3 -m venv build/venv && build/venv/bin/pip install gguf numpy`);
    process.exit(1);
  }
}
const SIZE = statSync(MODEL).size;
const TINY = { id: 'tiny', name: 'Tiny test model', file: 'tiny.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny.gguf', bytes: SIZE, minRamGB: 0, ctx: 512 };
const BIG = { id: 'big', name: 'Needs 8 GB', file: 'big.gguf', url: 'https://huggingface.co/test/big/resolve/main/big.gguf', bytes: 1e9, minRamGB: 8, ctx: 512 };

/* ------------------------------------------------------------------ server: dist/ + /models/tiny.gguf, with Range */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const modelReads = [];
const missing = [];
function send(req, res, file) {
  const size = statSync(file).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else start = Math.max(0, size - Number(m[2]));
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return 0; }
    status = 206;
  }
  const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return 0; }
  createReadStream(file, { start, end }).pipe(res);
  return end - start + 1;
}
// A damaged model: the GGUF magic and then nonsense.
const DAMAGED = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(64 * 1024, 0xab)]);
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/models/tiny.gguf') { modelReads.push({ range: req.headers.range || null, bytes: send(req, res, MODEL) }); return; }
  if (path === '/models/tiny-qwen35.gguf') { send(req, res, MODEL35); return; }
  if (path === '/models/damaged.gguf') {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), DAMAGED.length - 1) : DAMAGED.length - 1;
    res.writeHead(m ? 206 : 200, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${DAMAGED.length}` });
    res.end(DAMAGED.subarray(start, end + 1));
    return;
  }
  const file = join(DIST, normalize(path === '/' ? 'gradient-health.html' : path).replace(/^[/\\]+/, ''));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || !statSync(file).isFile()) { missing.push(path); res.writeHead(404); res.end(); return; }
  send(req, res, file);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// A software WebGPU adapter (SwiftShader, no shader-f16) is there, so the GPU self-test runs and says no.
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Looking for a model that isn't there is a 404, which Chromium logs.
    if (m.type() === 'error' && !/\/models\/big\.gguf$/.test((m.location() || {}).url || '')) errors.push(`console: ${m.text()}`);
  });
};
const open = async (page) => {
  watch(page);
  await page.goto(`${base}/gradient-health.html`);
  await page.waitForFunction(() => window.GH && typeof window.GH.lazy === 'function');
};
const SYSTEM = { role: 'system', content: 'You are Gradient\'s coach. Answer in one or two short sentences.' };
const ASK = { role: 'user', content: 'How many push-ups should I do today?' };

/* ------------------------------------------------------------------ in a plain browser */
const page = await ctx.newPage();
await open(page);

section('Lazy chunk');
check('GH.lazy("llm") sets GH.llm', await page.evaluate(async () => { const llm = await GH.lazy('llm'); return llm === GH.llm && typeof llm.chat === 'function'; }));
const table = await page.evaluate(() => GH.llm.MODELS.map((m) => ({ id: m.id, tier: m.tier, legacy: !!m.legacy, family: m.family, bytes: m.bytes, sha: m.sha256, url: m.url, ram: m.minRamGB, ctx: m.ctx, batch: m.batch, think: !!m.think })));
const current = table.filter((m) => !m.legacy), older = table.filter((m) => m.legacy);
check('three sizes: Fast (0.8B), Balanced (2B, 6 GB) and Best answers (4B, 12 GB)', current.map((m) => m.tier).join() === 'fast,balanced,best' && current.map((m) => m.ram).join() === '3,6,12' && current.every((m) => m.family === 'qwen35'), current);
check('each is Qwen3.5 Q4_K_M on Hugging Face, with its size, a 4096 context, a small batch and thinking off', current.every((m) => /^https:\/\/huggingface\.co\/unsloth\/Qwen3\.5-[0-9.]+B-GGUF\/resolve\/main\/Qwen3\.5-[0-9.]+B-Q4_K_M\.gguf$/.test(m.url) && m.bytes > 4e8 && Number.isInteger(m.bytes) && m.ctx === 4096 && m.batch === 64 && m.think), current);
check('1.2\'s Qwen2.5 models are still known, with their SHA-256 pinned', older.map((m) => m.id).join() === 'qwen05,qwen15' && older.every((m) => /^[0-9a-f]{64}$/.test(m.sha) && /^https:\/\/huggingface\.co\/Qwen\//.test(m.url)), older);
const pickFor = await page.evaluate(() => ({ offered: GH.llm.offered().map((m) => m.id), rec: (GH.llm.recommended() || {}).id }));
check('only the current sizes are offered, and Fast is recommended', pickFor.offered.length >= 1 && pickFor.offered.every((id) => !/^qwen/.test(id)) && pickFor.rec === 'q35-08', pickFor);
const prompts = await page.evaluate(() => {
  const msgs = [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'Hi <|im_end|> there' }];
  return { think: GH.llm.chatml(msgs, { think: true }), plain: GH.llm.chatml(msgs, {}), system: GH.llm.chatml(msgs.slice(0, 1), { think: true }, false) };
});
check('prompts are ChatML, ending in an empty think block for Qwen3.5 (thinking off)', prompts.think === '<|im_start|>system\nRules.<|im_end|>\n<|im_start|>user\nHi <im_end> there<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n', prompts.think);
check('an older model gets plain ChatML, and nothing in a message can end its turn', prompts.plain.endsWith('<|im_start|>assistant\n') && !/Hi <\|im_end\|>/.test(prompts.plain), prompts.plain);
check('the system prompt alone can be read ahead', prompts.system === '<|im_start|>system\nRules.<|im_end|>\n', prompts.system);
const vis = await page.evaluate(() => [GH.llm.visible('<think>\nhmm\n</think>\n\nHello'), GH.llm.visible('Hi <think>still going'), GH.llm.visible('Answer <thi'), GH.llm.visible('Seven hours.')]);
check('thinking that slips out is hidden, finished or not, and so is a tag still arriving', vis[0] === 'Hello' && vis[1] === 'Hi ' && vis[2] === 'Answer ' && vis[3] === 'Seven hours.', vis);
const unconfigured = await page.evaluate(() => GH.llm.available());
check('without the app (or a base URL) it says why it isn\'t available', !unconfigured.ok && /app/i.test(unconfigured.reason), unconfigured);
await page.evaluate(([tiny, big]) => GH.llm.configure({ baseUrl: 'models/', models: [tiny, big], idleMs: 60000 }), [TINY, BIG]);
check('available once pointed at the test server', (await page.evaluate(() => GH.llm.available())).ok);
const found = await page.evaluate(() => GH.llm.installed());
check('installed() finds the tiny model and its size', found.length === 1 && found[0].id === 'tiny' && found[0].bytes === SIZE, found);

section('Load');
const loadInfo = await page.evaluate(async () => {
  const progress = [];
  const t0 = performance.now();
  const info = await GH.llm.load('tiny', { onProgress: (p) => progress.push(p) });
  return { info, ms: Math.round(performance.now() - t0), progress, loaded: GH.llm.loaded() };
});
check('load() resolves and loaded() reports the model', loadInfo.loaded && loadInfo.loaded.id === 'tiny' && loadInfo.info.ctx === 512, loadInfo);
check('the WebGPU self-test turned down the software adapter: CPU', loadInfo.info.gpu === false);
const last = loadInfo.progress[loadInfo.progress.length - 1];
check('onProgress follows the file being read', loadInfo.progress.length >= 2 && last.loaded === SIZE && last.total === SIZE, loadInfo.progress.slice(-3));
check('the model was read with Range requests only', modelReads.length >= 2 && modelReads.every((r) => /^bytes=\d+-\d+$/.test(r.range || '')), modelReads);
// Once, plus wllama's fixed look-aheads: 128 KB to check for a vision projector, 1 MB blocks for small reads.
const extra = modelReads.reduce((s, r) => s + r.bytes, 0) - SIZE;
check('and read about once, not copied around', extra >= 0 && extra < 1.5 * 2 ** 20, extra);
console.log(`  load: ${loadInfo.ms} ms (${(SIZE / 1024).toFixed(0)} KB model, ${modelReads.length} range reads)`);

section('Chat');
const first = await page.evaluate(async ([system, ask]) => {
  const pieces = [];
  const t0 = performance.now();
  const text = await GH.llm.chat([system, ask], { maxTokens: 48, onToken: (piece, soFar) => pieces.push([piece, soFar.length]) });
  return { text, pieces, ms: performance.now() - t0, stats: GH.llm.stats };
}, [SYSTEM, ASK]);
check('tokens stream through onToken', first.pieces.length >= 10, first.pieces.length);
check('onToken gets each piece and the text so far', first.pieces.every(([p, n], i) => n === first.pieces.slice(0, i + 1).reduce((s, [q]) => s + q.length, 0)));
check('chat() resolves with the streamed reply', first.text.length > 0 && first.text === first.pieces.map(([p]) => p).join(''), first.text);
check('it stops at maxTokens', first.stats.tokens <= 48 && first.stats.finish === 'length', first.stats);
console.log(`  reply: ${JSON.stringify(first.text.slice(0, 60))}...`);
console.log(`  speed: ${first.stats.tokens} tokens in ${Math.round(first.ms)} ms, ${first.stats.tokensPerSec.toFixed(0)} tokens/s generating (${first.stats.promptTokens} prompt tokens)`);

section('KV cache reuse');
const second = await page.evaluate(async ([system, ask, reply]) => {
  const text = await GH.llm.chat([system, ask, { role: 'assistant', content: reply }, { role: 'user', content: 'And tomorrow?' }], { maxTokens: 16 });
  return { text, stats: GH.llm.stats };
}, [SYSTEM, ASK, first.text]);
check('the next turn reuses the cached prompt', second.stats.cachedTokens > 10 && second.stats.cachedTokens < second.stats.promptTokens + second.stats.cachedTokens, second.stats);

section('Abort');
const stopped = await page.evaluate(async ([system, ask]) => {
  const ctrl = new AbortController();
  let seen = 0;
  const text = await GH.llm.chat([system, ask], { maxTokens: 200, signal: ctrl.signal, onToken: () => { if (++seen === 5) ctrl.abort(); } });
  return { text, seen, stats: GH.llm.stats };
}, [SYSTEM, ASK]);
check('aborting resolves with the text so far', stopped.stats.aborted === true && stopped.text.length > 0, stopped.stats);
check('generation stops right away', stopped.seen >= 5 && stopped.seen <= 8, stopped.seen);
const already = await page.evaluate(async ([system, ask]) => { const c = new AbortController(); c.abort(); return GH.llm.chat([system, ask], { signal: c.signal }); }, [SYSTEM, ASK]);
check('an already-aborted signal answers nothing', already === '');
const after = await page.evaluate(async ([system, ask]) => GH.llm.chat([system, ask], { maxTokens: 8 }), [SYSTEM, ASK]);
check('the next chat works after an abort', after.length > 0);

section('One at a time');
const both = await page.evaluate(async ([system, ask]) => {
  const order = [];
  const a = GH.llm.chat([system, ask], { maxTokens: 12, onToken: () => order.push('a') });
  const b = GH.llm.chat([system, ask], { maxTokens: 12, onToken: () => order.push('b') });
  const [ta, tb] = await Promise.all([a, b]);
  return { ta, tb, order: order.join('') };
}, [SYSTEM, ASK]);
check('concurrent chats queue instead of mixing', both.ta.length > 0 && both.tb.length > 0 && /^a+b+$/.test(both.order), both.order);

section('Unload');
const unloaded = await page.evaluate(async () => { await GH.llm.unload(); return GH.llm.loaded(); });
check('unload() frees the model', unloaded === null);
const readsBefore = modelReads.length;
const reloaded = await page.evaluate(async ([system, ask]) => { const text = await GH.llm.chat([system, ask], { maxTokens: 8 }); return { text, loaded: GH.llm.loaded() }; }, [SYSTEM, ASK]);
check('chat() reloads the last model by itself', reloaded.text.length > 0 && reloaded.loaded && reloaded.loaded.id === 'tiny' && modelReads.length > readsBefore);
const idle = await page.evaluate(async ([system, ask]) => {
  GH.llm.configure({ idleMs: 700 });
  await GH.llm.chat([system, ask], { maxTokens: 4 });
  const right = GH.llm.loaded();
  await new Promise((r) => setTimeout(r, 1400));
  return { right, later: GH.llm.loaded() };
}, [SYSTEM, ASK]);
check('it unloads by itself when idle', idle.right && idle.right.id === 'tiny' && idle.later === null, idle);

section('Errors');
const errs = await page.evaluate(async ([system, tiny, big, damaged]) => {
  GH.llm.configure({ models: [tiny, big, damaged] });
  const code = (p) => p.then(() => 'resolved', (e) => `${e.code}: ${e.message}`);
  const out = {
    empty: await code(GH.llm.chat([system])),
    unknown: await code(GH.llm.load('nope')),
    web: await code(GH.llm.download('tiny')),
    missing: await code(GH.llm.load('big')),
    damaged: await code(GH.llm.load('damaged')),
  };
  out.afterDamaged = GH.llm.loaded();
  await GH.llm.load('tiny');
  out.tooLong = await code(GH.llm.chat([system, { role: 'user', content: 'x'.repeat(3000) }], { maxTokens: 16 }));
  out.stillLoaded = GH.llm.loaded();
  out.recovers = await GH.llm.chat([system, { role: 'user', content: 'Hi' }], { maxTokens: 4 });
  return out;
}, [SYSTEM, TINY, BIG, { ...TINY, id: 'damaged', file: 'damaged.gguf', bytes: DAMAGED.length }]);
check('a chat with only a system prompt is refused', /^empty:/.test(errs.empty), errs.empty);
check('an unknown model is refused', /^unknown:/.test(errs.unknown), errs.unknown);
check('downloads need the app', /^web: .*Android app/.test(errs.web), errs.web);
check('a model that isn\'t there can\'t load', /^not-installed:/.test(errs.missing), errs.missing);
check('a damaged model fails to load (wllama alone would say it loaded)', /^load:/.test(errs.damaged) && errs.afterDamaged === null, errs);
check('a message longer than the context: "too long", and the model stays loaded', /^too-long: This chat is too long/.test(errs.tooLong) && errs.stillLoaded && errs.stillLoaded.id === 'tiny', errs.tooLong);
check('the next chat works', errs.recovers.length > 0);

section('Qwen3.5 layout');
const q35 = await page.evaluate(async (bytes) => {
  GH.llm.configure({ models: [{ id: 'tiny35', name: 'Tiny Qwen3.5', file: 'tiny-qwen35.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny-qwen35.gguf', bytes, minRamGB: 0, ctx: 2048, batch: 64, think: true, gen: { temperature: 0.6, top_p: 0.8, top_k: 20 } }] });
  const info = await GH.llm.load('tiny35');
  const sys = { role: 'system', content: `You are Gradient's coach. ${'Here is what the app knows about this person. '.repeat(16)}` };
  const progress = [];
  const a = await GH.llm.chat([sys, { role: 'user', content: 'How is my sleep this week?' }], { maxTokens: 12, onPrompt: (d, t) => progress.push([d, t]) });
  const first = GH.llm.stats;
  await GH.llm.chat([sys, { role: 'user', content: 'Am I getting stronger?' }], { maxTokens: 12 });
  const next = GH.llm.stats;
  // Read ahead: a new set of rules, then a question after them.
  const sys2 = { role: 'system', content: `You are Gradient's coach, version two. ${'The app knows these numbers. '.repeat(16)}` };
  const pieces = [];
  await GH.llm.prepare(sys2.content, { onToken: (p) => pieces.push(p) });
  const after = GH.llm.stats;
  await GH.llm.chat([sys2, { role: 'user', content: 'What should I do today?' }], { maxTokens: 12 });
  const primed = GH.llm.stats;
  await GH.llm.unload();
  return { info, a, first, next, progress, pieces, sameStats: after === next, primed };
}, statSync(MODEL35).size);
check('a model with Qwen3.5\'s gated delta-net layers loads and answers', q35.info.id === 'tiny35' && q35.a.length > 0 && q35.first.tokens > 0, q35.first);
check('on one thread here (no SharedArrayBuffer without cross-origin isolation)', q35.info.threads === 1, q35.info);
check('a new question after the same rules reuses nearly all of the prompt', q35.next.cachedTokens >= q35.first.promptTokens - 120, { first: q35.first.promptTokens, cached: q35.next.cachedTokens, processed: q35.next.promptTokens });
console.log(`  qwen35 layout: ${q35.first.promptTokens} prompt tokens, then ${q35.next.promptTokens} new and ${q35.next.cachedTokens} reused`);
check('reading the prompt reports its progress, up to the end', q35.progress.length >= 2 && q35.progress[q35.progress.length - 1][0] === q35.progress[q35.progress.length - 1][1], q35.progress);
check('rules read ahead (prepare) write nothing and leave the last answer\'s stats', q35.pieces.length === 0 && q35.sameStats, q35.pieces);
// (The in-app engine goes back to its last checkpoint, up to a batch before the rules end.)
check('and the first question after them reads little more than its own turn', q35.primed.cachedTokens >= 300 && q35.primed.promptTokens < q35.primed.cachedTokens / 4, q35.primed);

section('Held to a grammar (Tailor my plan)');
const tailored = await page.evaluate(async (bytes) => {
  GH.llm.configure({ models: [{ id: 'tiny35', name: 'Tiny Qwen3.5', file: 'tiny-qwen35.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny-qwen35.gguf', bytes, minRamGB: 0, ctx: 2048, batch: 64, think: true, gen: { temperature: 0.8, top_p: 0.95, top_k: 40 } }] });
  await GH.llm.load('tiny35');
  const out = [];
  for (const q of ['More legs and 20 minute workouts', 'My knee hurts']) out.push(await GH.llm.chat(GH.tailor.messages(q), { grammar: GH.tailor.GRAMMAR, maxTokens: 240 }));
  await GH.llm.unload();
  return out;
}, statSync(MODEL35).size);
const parsed = tailored.map((x) => { try { return JSON.parse(x); } catch (e) { return null; } });
check('random weights still write Tailor\'s JSON, field for field, under its grammar', parsed.every((o) => o && Array.isArray(o.focus) && Array.isArray(o.goals) && 'minutes' in o && Array.isArray(o.avoid_joints) && typeof o.note === 'string'), tailored);

/* ------------------------------------------------------------------ in the app (fake bridge) */
section('Android bridge (fake)');
const page2 = await ctx.newPage();
await page2.addInitScript(([size]) => {
  const installed = [{ id: 'tiny', file: 'tiny.gguf', bytes: size }];
  // Like ModelStore: the last state of each download, including one paused before the page loaded.
  const status = { qwen05: { id: 'qwen05', state: 'paused', loaded: 1000, total: 4000 } };
  window.__earlier = [];
  window.__emitted = [];
  window.__gh = { onModelProgress: (p) => window.__earlier.push(`${p.id}:${p.state}`) }; // a hook that was there first
  window.__calls = [];
  const emit = (list) => list.forEach((p, i) => setTimeout(() => {
    status[p.id] = p;
    window.__emitted.push(`${p.id}:${p.state}`);
    window.__gh.onModelProgress(p);
  }, 10 * (i + 1)));
  window.AndroidBridge = {
    modelList: () => JSON.stringify(installed),
    modelStatus: () => JSON.stringify(Object.values(status)),
    modelDownload: (json) => {
      const r = JSON.parse(json);
      window.__calls.push(['download', r]);
      if (r.id === 'tiny') {
        emit([{ id: 'tiny', state: 'queued', loaded: 0, total: size }, { id: 'tiny', state: 'waiting-wifi', loaded: 0, total: size },
          { id: 'tiny', state: 'downloading', loaded: size / 2, total: size, bps: 1e6 }, { id: 'tiny', state: 'verifying', loaded: size, total: size },
          { id: 'tiny', state: 'done', loaded: size, total: size }]);
      } else if (r.id === 'qwen05') {
        emit([{ id: 'qwen05', state: 'error', error: 'space', loaded: 0, total: r.bytes, needed: r.bytes + 314572800, free: 200 * 1048576 }]);
      } else emit([{ id: r.id, state: 'downloading', loaded: 1, total: r.bytes }]);
      return true;
    },
    modelCancel: (id) => { window.__calls.push(['cancel', id]); emit([{ id, state: 'cancelled', loaded: 0, total: 0 }]); },
    modelDelete: (id) => { window.__calls.push(['delete', id]); installed.length = 0; return true; },
    deviceMemory: () => Math.round(3.6 * 2 ** 30), // a "4 GB" phone
    modelFreeSpace: () => 5e9,
  };
}, [SIZE]);
await open(page2);
const app = await page2.evaluate(async ([tiny, big, qwen, other]) => {
  const llm = await GH.lazy('llm');
  llm.configure({ models: [tiny, big, qwen, other] });
  const seen = [];
  llm.onProgress((p) => seen.push(p));
  const out = { available: llm.available(), ram: llm.ramGB(), offered: llm.offered().map((m) => m.id), free: llm.freeSpace(), installed: await llm.installed() };
  await new Promise((r) => setTimeout(r, 20));
  out.replayed = seen.map((p) => `${p.id}:${p.state}`);
  out.memory = await llm.download('big').then(() => 'resolved', (e) => e.code);
  out.done = await llm.download('tiny', { wifiOnly: true });
  out.states = seen.filter((p) => p.id === 'tiny').map((p) => p.state);
  out.wifi = (seen.find((p) => p.state === 'waiting-wifi') || {}).message;
  out.half = (seen.find((p) => p.state === 'downloading' && p.id === 'tiny') || {}).fraction;
  out.space = await llm.download('qwen05').then(() => 'resolved', (e) => `${e.code}: ${e.message}`);
  const pending = llm.download('other');
  await new Promise((r) => setTimeout(r, 30));
  llm.cancel('other');
  out.cancelled = await pending.then(() => 'resolved', (e) => e.code);
  out.status = llm.status().map((p) => `${p.id}:${p.state}`).sort();
  out.loadInfo = await llm.load('tiny');
  out.reply = await llm.chat([{ role: 'user', content: 'Hi' }], { maxTokens: 6 });
  out.removed = await llm.remove('tiny');
  out.afterRemove = { loaded: llm.loaded(), installed: await llm.installed() };
  out.calls = window.__calls;
  out.earlier = window.__earlier;
  out.emitted = window.__emitted;
  return out;
}, [TINY, BIG, { ...TINY, id: 'qwen05', file: 'qwen.gguf', bytes: 491400032, minRamGB: 3 }, { ...TINY, id: 'other', file: 'other.gguf' }]);
check('available in the app', app.available.ok, app.available);
check('a phone that reports 3.6 GB counts as 4 GB', app.ram === 4, app.ram);
check('the 8 GB model isn\'t offered on it', app.offered.join() === 'tiny,qwen05,other', app.offered);
check('free space comes from the app', app.free === 5e9);
check('installed() comes from the app', app.installed.length === 1 && app.installed[0].file === 'tiny.gguf');
check('onProgress replays downloads the app already has (after a reload)', app.replayed.includes('qwen05:paused'), app.replayed);
check('a model that needs more memory is refused before downloading', app.memory === 'memory' && !app.calls.some(([k, r]) => k === 'download' && r.id === 'big'));
const request = (app.calls.find(([k, r]) => k === 'download' && r.id === 'tiny') || [])[1] || {};
check('download() hands the app id, url, file, size, SHA-256 and Wi-Fi only', request.url === TINY.url && request.file === 'tiny.gguf' && request.bytes === SIZE && request.wifiOnly === true && 'sha256' in request, request);
check('download() resolves when the app says done', app.done && app.done.id === 'tiny' && app.done.bytes === SIZE, app.done);
check('progress goes through every state', app.states.join() === 'queued,waiting-wifi,downloading,verifying,done', app.states);
check('waiting for Wi-Fi reads "Download paused: waiting for Wi-Fi"', app.wifi === 'Download paused: waiting for Wi-Fi', app.wifi);
check('progress has a fraction', app.half === 0.5, app.half);
// needs 491400032 + 300 MB margin, has 200 MB: 569 MB short
check('no space: rejects with "Not enough free space" and how much to free', app.space === 'space: Not enough free space. Free up 569 MB and try again.', app.space);
check('cancel() tells the app and rejects the download', app.cancelled === 'cancelled' && app.calls.some(([k, id]) => k === 'cancel' && id === 'other'));
check('status() lists every download', ['qwen05:error', 'tiny:done', 'other:cancelled'].every((s) => app.status.includes(s)), app.status);
check('the app\'s models load from models/<file> on the page\'s own origin', app.loadInfo.id === 'tiny' && app.reply.length > 0);
check('remove() unloads, then deletes through the app', app.removed === true && app.afterRemove.loaded === null && app.afterRemove.installed.length === 0 && app.calls.some(([k, id]) => k === 'delete' && id === 'tiny'));
check('the hook that was there first still gets every event', app.earlier.join() === app.emitted.join() && app.emitted.length === 8, { earlier: app.earlier, emitted: app.emitted });

/* ------------------------------------------------------------------ the native engine (fake bridge) */
// LlmService stands in: it answers load and generate through window.__gh.onLlm like LlmClient does.
section('Native engine (fake bridge)');
const page3 = await ctx.newPage();
await page3.addInitScript(([size]) => {
  const say = (e, ms) => setTimeout(() => window.__gh.onLlm(JSON.stringify(e)), ms || 5);
  window.__native = { loads: [], gens: [], aborts: [], unloads: 0, mode: 'ok' };
  const N = window.__native;
  window.AndroidBridge = {
    modelList: () => JSON.stringify([{ id: 'tiny', file: 'tiny.gguf', bytes: size }]),
    modelStatus: () => '[]',
    deviceMemory: () => 8 * 2 ** 30,
    llmNative: () => JSON.stringify({ ok: true, threads: 4, cores: 8 }),
    llmLoad: (json) => {
      const r = JSON.parse(json);
      N.loads.push(r);
      if (N.mode === 'fail-load') { say({ type: 'loadFailed', error: 'the CPU backend couldn\'t start' }); return true; }
      say({ type: 'loadProgress', progress: 0.5 }, 5);
      say({ type: 'loadProgress', progress: 1 }, 10);
      say({ type: 'loaded', ctx: r.ctx, ms: 40, threads: 4, info: 'NEON = 1 | loaded CPU backend android_armv8.2_2' }, 15);
      return true;
    },
    llmGenerate: (json) => {
      const r = JSON.parse(json);
      N.gens.push(r);
      if (N.mode === 'die') { say({ type: 'progress', req: r.req, done: 10, total: 40 }); say({ type: 'died' }, 20); return true; }
      if (N.mode === 'silent') return true; // never answers
      if (N.mode === 'not-loaded') { N.mode = 'ok'; say({ type: 'done', req: r.req, code: -1, error: 'not-loaded' }); return true; }
      const stop = () => N.aborts.includes(r.req);
      say({ type: 'progress', req: r.req, done: 20, total: 40 }, 5);
      say({ type: 'progress', req: r.req, done: 40, total: 40 }, 10);
      if (r.max_tokens === 0) { say({ type: 'done', req: r.req, code: 0, stats: { promptTokens: 40, reusedTokens: 0, tokens: 0, promptMs: 30, genMs: 0, aborted: false, finish: 0 } }, 15); return true; }
      const words = ['<think>', '\n\n', '</think>', 'Seven ', 'hours ', 'of ', 'sleep ', 'is ', 'a ', 'good ', 'week.'];
      let i = 0;
      const tick = () => {
        if (stop()) { window.__gh.onLlm(JSON.stringify({ type: 'done', req: r.req, code: 0, stats: { promptTokens: 40, reusedTokens: 30, tokens: i, promptMs: 20, genMs: 50, aborted: true, finish: 2 } })); return; }
        if (i < words.length) { window.__gh.onLlm(JSON.stringify({ type: 'text', req: r.req, text: words[i++] })); setTimeout(tick, 8); return; }
        window.__gh.onLlm(JSON.stringify({ type: 'done', req: r.req, code: 0, stats: { promptTokens: 40, reusedTokens: 30, tokens: i, promptMs: 20, genMs: 100, aborted: false, finish: 0 } }));
      };
      setTimeout(tick, 20);
      return true;
    },
    llmAbort: (req) => { N.aborts.push(req); },
    llmUnload: () => { N.unloads++; },
    rendererGone: () => 0,
  };
}, [SIZE]);
await open(page3);
const nat = await page3.evaluate(async (tiny) => {
  const llm = await GH.lazy('llm');
  llm.configure({ models: [Object.assign({}, tiny, { think: true })] });
  const N = window.__native;
  const out = { engine: llm.engine, available: llm.available().ok };
  const progress = [];
  out.info = await llm.load('tiny', { onProgress: (p) => progress.push(p.loaded / p.total) });
  out.progress = progress;
  out.load = N.loads[0];
  const pieces = [], reading = [];
  out.text = await llm.chat([{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'How did I sleep?' }], { maxTokens: 40, onToken: (p, all) => pieces.push(all), onPrompt: (d, t) => reading.push(d / t) });
  out.pieces = pieces;
  out.reading = reading;
  out.stats = llm.stats;
  out.gen = N.gens[0];
  // Read ahead.
  await llm.prepare('Rules.');
  out.prepared = N.gens[1];
  // Stop part way.
  const ctl = new AbortController();
  const stopped = llm.chat([{ role: 'user', content: 'Tell me more' }], { signal: ctl.signal, onToken: (p, all) => { if (/sleep/.test(all)) ctl.abort(); } });
  out.stopped = await stopped;
  out.stoppedStats = llm.stats;
  out.aborts = N.aborts.slice();
  // The service's process restarted without the model: loaded again, and answered.
  N.mode = 'not-loaded';
  out.reloaded = await llm.chat([{ role: 'user', content: 'Again' }], { maxTokens: 20 });
  out.loadsAfterReload = N.loads.length;
  // An answer that starts from given words (the coach's yes or no).
  const led = [];
  out.led = await llm.chat([{ role: 'user', content: 'Did I sleep enough?' }], { lead: 'Yes,', maxTokens: 20, onToken: (p, all) => led.push(all) });
  out.ledFirst = led[0];
  out.ledPrompt = N.gens[N.gens.length - 1].prompt;
  // Stuck: nothing heard for a while.
  llm.configure({ stall: { answer: 150 } });
  N.mode = 'silent';
  out.stalled = await llm.chat([{ role: 'user', content: 'Hello?' }]).then(() => 'answered', (e) => e.code);
  out.afterStall = llm.engine;
  return out;
}, TINY);
check('the app\'s native engine is used when it has one', nat.engine === 'native' && nat.available && nat.info.engine === 'native' && nat.info.threads === 4, nat.info);
check('it loads the installed model with its context and a big batch, reporting progress', nat.load.id === 'tiny' && nat.load.ctx === TINY.ctx && nat.load.batch >= 128 && nat.progress.join() === '0.5,1', { load: nat.load, progress: nat.progress });
check('the prompt it gets is ChatML with the empty think block', nat.gen.prompt === '<|im_start|>system\nRules.<|im_end|>\n<|im_start|>user\nHow did I sleep?<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n' && nat.gen.max_tokens === 40, nat.gen);
check('with the model\'s sampling', nat.gen.temperature > 0 && nat.gen.top_k > 0 && nat.gen.top_p > 0 && nat.gen.grammar === '', nat.gen);
check('the answer streams in, with any thinking hidden', nat.text === 'Seven hours of sleep is a good week.' && nat.pieces.length >= 5 && !nat.pieces.some((p) => /think/.test(p)), { text: nat.text, pieces: nat.pieces });
check('reading the prompt is reported', nat.reading.join() === '0.5,1', nat.reading);
check('stats come back: tokens, reused prompt, speed', nat.stats.engine === 'native' && nat.stats.cachedTokens === 30 && nat.stats.promptTokens === 10 && nat.stats.tokensPerSec > 0 && nat.stats.finish === 'stop', nat.stats);
check('reading ahead asks for no tokens and only the system turn', nat.prepared.max_tokens === 0 && nat.prepared.prompt === '<|im_start|>system\nRules.<|im_end|>\n', nat.prepared);
check('Stop reaches the engine with the request\'s id, and the answer so far comes back', nat.aborts.length === 1 && nat.stoppedStats.aborted === true && /sleep/.test(nat.stopped), { aborts: nat.aborts, text: nat.stopped });
check('a service that restarted without the model loads it again and answers', nat.reloaded.length > 0 && nat.loadsAfterReload === 2, nat);
check('a lead goes at the end of the prompt, and the answer starts with it from its first word', /<\/think>\n\nYes,$/.test(nat.ledPrompt) && nat.led.startsWith('Yes,') && /Seven hours/.test(nat.led) && /^Yes,/.test(nat.ledFirst || ''), { prompt: (nat.ledPrompt || '').slice(-40), led: nat.led, first: nat.ledFirst });
check('an engine that goes quiet is "stalled", and the in-app engine takes over', nat.stalled === 'stalled' && nat.afterStall === 'wasm', { stalled: nat.stalled, engine: nat.afterStall });
await page3.close();
const page4 = await ctx.newPage();
await page4.addInitScript(() => {
  const say = (e, ms) => setTimeout(() => window.__gh.onLlm(JSON.stringify(e)), ms || 5);
  window.AndroidBridge = {
    modelList: () => JSON.stringify([{ id: 'tiny', file: 'tiny.gguf', bytes: 1 }]),
    modelStatus: () => '[]',
    llmNative: () => JSON.stringify({ ok: true, threads: 4 }),
    llmLoad: () => { say({ type: 'loaded', ctx: 512, threads: 4 }); return true; },
    llmGenerate: (json) => { const r = JSON.parse(json); say({ type: 'progress', req: r.req, done: 5, total: 40 }); say({ type: 'died' }, 20); return true; },
    llmAbort: () => {},
    llmUnload: () => {},
  };
});
await open(page4);
const crash = await page4.evaluate(async (tiny) => {
  const llm = await GH.lazy('llm');
  llm.configure({ models: [tiny] });
  await llm.load('tiny');
  const r = await llm.chat([{ role: 'user', content: 'Hi' }]).then(() => 'answered', (e) => e.code);
  return { r, engine: llm.engine, loaded: llm.loaded() };
}, TINY);
check('if its process dies mid-answer: "crashed", and the in-app engine is used from then on', crash.r === 'crashed' && crash.engine === 'wasm' && crash.loaded === null, crash);
await page4.close();

section('Page');
check('no page errors', errors.length === 0, errors);
check('the only missing files were the ones looked for on purpose', missing.every((p) => p === '/models/big.gguf'), missing);

await browser.close();
server.close();
done();
