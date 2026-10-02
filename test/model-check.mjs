// A real on-device model through the in-app (WebAssembly) engine, in Chromium, the way the app uses
// it: someone five weeks in (test/fixtures.mjs) asks the coach questions through GH.deviceCoach.ask,
// with the app's own facts, prompt and sampling. It checks each answer arrives with no thinking
// showing, prints the answers, their timings and any number an answer used that wasn't in what the
// model was given, and runs one Tailor my plan request under its grammar. The tests can't download
// the real models, so .github/workflows/model-check.yml runs this on GitHub with one it downloads.
//   node test/model-check.mjs path/to/Qwen3.5-0.8B-Q4_K_M.gguf [model id, default q35-08]
import { createRequire } from 'node:module';
import { statSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const file = process.argv[2];
const id = process.argv[3] || 'q35-08';
if (!file || !existsSync(file)) { console.error('usage: node test/model-check.mjs model.gguf [id]'); process.exit(2); }
const server = await serveDist({ [`/models/${basename(file)}`]: file });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(seedBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');

const QUESTIONS = ['How is my sleep?', 'Am I doing enough steps?', 'Why is today lighter?', 'Am I getting stronger?'];
const out = await page.evaluate(async ([id, name, bytes, questions]) => {
  const GH = window.GH, S = GH.ui.S, day = GH.ui.today();
  const llm = await GH.lazy('llm');
  await GH.lazy('science'); // the rules the facts quote (a part of its own, src/ui/lazy.js)
  const m = Object.assign({}, llm.MODELS.find((x) => x.id === id), { file: name, bytes, minRamGB: 0 });
  llm.configure({ baseUrl: 'models/', models: [m], stall: { load: 300000, answer: 300000 } });
  S.ai.deviceModel = id;
  const r = { model: m.label, answers: [] };
  let t = performance.now();
  await GH.deviceCoach.prime(S, day); // loads the model and reads the rules and data ahead
  r.primeMs = Math.round(performance.now() - t);
  r.info = llm.loaded();
  for (const q of questions) {
    const given = GH.deviceCoach.messages(S, day, q).map((x) => x.content).join('\n');
    let first = 0;
    const t0 = performance.now();
    const res = await GH.deviceCoach.ask(S, day, q, { onToken: () => { if (!first) first = performance.now(); } });
    r.answers.push({ q, text: res.text, raw: res.raw, lead: res.lead, note: res.note, replaced: res.replaced, cut: res.cut, firstMs: first ? Math.round(first - t0) : null, stats: res.stats, facts: GH.deviceCoach.facts(S, day, q), given: `${given}\n${res.lead || ''}` });
  }
  const raw = await llm.chat(GH.tailor.messages('More legs please, my knees hurt, and I only have 20 minutes'), { grammar: GH.tailor.GRAMMAR, maxTokens: 240, temperature: 0.2 });
  r.tailor = raw;
  r.tailorParsed = GH.tailor.read(raw);
  r.logs = llm.logs().slice(-20);
  return r;
}, [id, basename(file), statSync(file).size, QUESTIONS]);

// Numbers in an answer that appear nowhere in what the model was given (made up, or its own sums).
// (As the app reads them: "7,675" is 7675, and a given number may be rounded.)
const nums = (s) => (String(s).match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, '')));
const known = (n, given) => nums(given).some((g) => g === n || (Number.isInteger(n) && (Math.round(g) === n || Math.trunc(g) === n)));
console.log(`\n${out.model}: ready in ${out.primeMs} ms, loading and reading the rules and data ahead (${out.info.engine}, ${out.info.threads} thread${out.info.threads === 1 ? '' : 's'})`);
let invented = 0;
for (const a of out.answers) {
  const extra = nums(a.raw).filter((n) => !known(n, a.given));
  invented += extra.length;
  console.log(`\nQ: ${a.q}\nFACTS: ${a.facts.join(' | ') || 'none'}${a.lead ? `\nSTARTS WITH: ${a.lead}` : ''}\nMODEL: ${a.raw}${a.replaced || a.cut ? `\nSHOWN: ${a.text}\nNOTE: ${a.note}` : ''}\n   first word after ${a.firstMs} ms; ${a.stats.promptTokens} new prompt tokens, ${a.stats.cachedTokens} reused; ${a.stats.tokens} tokens at ${a.stats.tokensPerSec.toFixed(1)}/s${extra.length ? `\n   NUMBERS NOT GIVEN: ${extra.join(', ')}` : ''}`);
}
console.log(`\nTailor: ${out.tailor}\n`);
section('Real model, in-app engine, the coach\'s own path');
check('it answers every question', out.answers.every((a) => a.raw.trim().length > 10), out.answers.map((a) => a.raw));
check('no number anyone sees is one it wasn\'t given', out.answers.every((a) => a.replaced || nums(a.text).every((n) => known(n, a.given))), out.answers.map((a) => a.text));
check('without any thinking showing', out.answers.every((a) => !/<\/?think>/.test(a.text)));
check('each question reuses the rules and data read ahead', out.answers.every((a) => a.stats.cachedTokens > 100), out.answers.map((a) => a.stats.cachedTokens));
check('Tailor under the grammar is JSON the app reads', !!(out.tailorParsed && Array.isArray(out.tailorParsed.focus)), out.tailor);
check('no page errors', errors.length === 0, errors);
console.log(`\n${invented ? `${invented} number(s) in the model's answers weren't in what it was given (see above).` : 'Every number in the model\'s answers was in what it was given.'} The app's own answer stood in for ${out.answers.filter((a) => a.replaced).length} of ${out.answers.length}.`);
if (errors.length || !out.answers.every((a) => a.text.trim())) console.log(out.logs.join('\n'));
await browser.close();
await server.close();
done();
