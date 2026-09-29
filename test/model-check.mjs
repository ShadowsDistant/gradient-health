// A real on-device model through the in-app (WebAssembly) engine, in Chromium: loads it, reads the
// coach's system prompt ahead, answers two questions (checking no thinking shows) and one Tailor my
// plan request under its grammar, and prints the timings. The tests can't download the real models,
// so .github/workflows/model-check.yml runs this on GitHub with one it downloads.
//   node test/model-check.mjs path/to/Qwen3.5-0.8B-Q4_K_M.gguf [model id, default q35-08]
import { createRequire } from 'node:module';
import { statSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { check, section, done, serveDist } from './lib.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const file = process.argv[2];
const id = process.argv[3] || 'q35-08';
if (!file || !existsSync(file)) { console.error('usage: node test/model-check.mjs model.gguf [id]'); process.exit(2); }
const server = await serveDist({ [`/models/${basename(file)}`]: file });
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(server.url);
await page.waitForFunction(() => window.GH && typeof window.GH.lazy === 'function');
const out = await page.evaluate(async ([id, name, bytes]) => {
  const llm = await GH.lazy('llm');
  const m = Object.assign({}, llm.MODELS.find((x) => x.id === id), { file: name, bytes, minRamGB: 0 });
  llm.configure({ baseUrl: 'models/', models: [m], stall: { load: 300000, answer: 300000 } });
  const r = { model: m.label };
  let t = performance.now();
  r.info = await llm.load(id);
  r.loadMs = Math.round(performance.now() - t);
  const system = 'You are the coach in Gradient Health, a workout and health app on this person\'s phone.\nAnswer their question in 2 to 4 short sentences, in plain words. Say "you". No lists, headings or emoji.\nBase the answer on FACTS and THEIR DATA below. Use their real numbers. Never make up a number.\n\nTHEIR DATA\nGoals: bigger arms, legs and glutes.\nSleep: 6 h 40 min on average this week (usually 7 h 10 min).\nSteps: 7400 steps on average this week; daily goal 8000.';
  t = performance.now();
  await llm.prepare(system);
  r.prepareMs = Math.round(performance.now() - t);
  r.answers = [];
  for (const [q, f] of [['How is my sleep?', 'You averaged 6 h 40 min of sleep this week, 30 min less than usual.'], ['Am I doing enough steps?', '7400 steps a day this week, a little under your 8000 goal.']]) {
    let first = 0;
    const t0 = performance.now();
    const text = await llm.chat([{ role: 'system', content: system }, { role: 'user', content: `FACTS\n- What the app worked out: ${f}\n\nQUESTION\n${q}` }], { maxTokens: 200, onToken: () => { if (!first) first = performance.now(); } });
    r.answers.push({ q, text, firstMs: Math.round(first - t0), stats: llm.stats });
  }
  const raw = await llm.chat(GH.tailor.messages('More legs please, my knees hurt, and I only have 20 minutes'), { grammar: GH.tailor.GRAMMAR, maxTokens: 240, temperature: 0.2 });
  r.tailor = raw;
  r.tailorParsed = GH.tailor.read(raw);
  r.logs = llm.logs().slice(-20);
  return r;
}, [id, basename(file), statSync(file).size]);
console.log(`\n${out.model}: loaded in ${out.loadMs} ms (${out.info.engine}, ${out.info.threads} thread${out.info.threads === 1 ? '' : 's'}${out.info.gpu ? ', GPU' : ''}); system prompt read ahead in ${out.prepareMs} ms`);
for (const a of out.answers) console.log(`\nQ: ${a.q}\nA: ${a.text}\n   first word after ${a.firstMs} ms; ${a.stats.promptTokens} new prompt tokens, ${a.stats.cachedTokens} reused; ${a.stats.tokens} tokens at ${a.stats.tokensPerSec.toFixed(1)}/s`);
console.log(`\nTailor: ${out.tailor}\n`);
section('Real model, in-app engine');
check('it answers both questions', out.answers.every((a) => a.text.trim().length > 10), out.answers.map((a) => a.text));
check('without any thinking showing', out.answers.every((a) => !/<\/?think>/.test(a.text)));
check('the second question reuses the system prompt', out.answers[1].stats.cachedTokens > 50, out.answers[1].stats);
check('Tailor under the grammar is JSON the app reads', !!(out.tailorParsed && Array.isArray(out.tailorParsed.focus)), out.tailor);
check('no page errors', errors.length === 0, errors);
if (errors.length || !out.answers.every((a) => a.text.trim())) console.log(out.logs.join('\n'));
await browser.close();
await server.close();
done();
