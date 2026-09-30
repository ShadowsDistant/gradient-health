// The on-device coach's real prompts, for the native engine's model check
// (.github/workflows/model-check.yml). Someone five weeks in (test/fixtures.mjs, with its Health
// Connect data) asks the questions test/model-check.mjs asks, and each prompt is written exactly as
// the app sends it: the rules and data, the question with the app's facts, ChatML with the empty
// think block and the app's yes or no to start from. ghllm_ask answers them; this then reads the
// answers back through the coach's number check and prints what someone would see in the chat.
//   node test/model-prompts.mjs write build/prompts [model id, default q35-08]
//   build/native-host/ghllm_ask model.gguf threads build/tailor.gbnf build/prompts
//   node test/model-prompts.mjs read build/prompts
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const [mode, dir, id = 'q35-08'] = process.argv.slice(2);
if (!['write', 'read'].includes(mode) || !dir) { console.error('usage: node test/model-prompts.mjs write|read dir [model id]'); process.exit(2); }
export const QUESTIONS = ['How is my sleep?', 'Am I doing enough steps?', 'Why is today lighter?', 'Am I getting stronger?', 'Am I moving enough?', 'What should I focus on this week?'];
const TAILOR = 'More legs please, my knees hurt, and I only have 20 minutes';

// The app, in this process: its modules, the fake bridge's Health Connect data, the seeded person.
globalThis.window = globalThis;
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/store.js', 'src/coach.js', 'src/tailor.js', 'src/devicecoach.js');
const llm = await build({ entryPoints: [join(root, 'src/llm.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2022'], logLevel: 'silent' });
new Function(llm.outputFiles[0].text)();
seedBridge();
let S = null;
GH.store.save = (s) => { S = s; };
seedState();
const B = GH.brain;
const day = B.dayOf(Date.now(), 4);
await GH.health.sync(S, Date.now());
const m = GH.llm.MODELS.find((x) => x.id === id);

if (mode === 'write') {
  mkdirSync(dir, { recursive: true });
  // What prepare() reads ahead, then each question on its own (the chat's first question).
  writeFileSync(join(dir, 'prefix.txt'), GH.llm.chatml([{ role: 'system', content: GH.deviceCoach.system(S, day) }], m, false));
  const index = QUESTIONS.map((q, i) => {
    const msgs = GH.deviceCoach.messages(S, day, q, 0);
    const lead = GH.deviceCoach.lead(S, day, q);
    writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.txt`), GH.llm.chatml(msgs, m) + lead);
    return { q, lead, facts: GH.deviceCoach.facts(S, day, q), given: `${msgs.map((x) => x.content).join('\n')}\n${lead}` };
  });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 1));
  writeFileSync(join(dir, 'tailor.txt'), GH.llm.chatml(GH.tailor.messages(TAILOR), m));
  console.log(`${QUESTIONS.length} prompts for ${m.label} in ${dir}`);
} else {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  section('Real model, native engine, the coach\'s own prompts');
  const answers = index.map((x, i) => {
    const file = join(dir, `${String(i + 1).padStart(2, '0')}.out`);
    const raw = existsSync(file) ? x.lead + readFileSync(file, 'utf8') : '';
    return Object.assign({ raw }, x, GH.deviceCoach.finish(S, day, x.q, raw, x.given, x.lead));
  });
  for (const a of answers) {
    console.log(`\nQ: ${a.q}\nFACTS: ${a.facts.join(' | ') || 'none'}${a.lead ? `\nSTARTS WITH: ${a.lead}` : ''}\nMODEL: ${a.raw.trim()}`);
    if (a.replaced || a.cut) console.log(`SHOWN: ${a.text}\nNOTE: ${a.note}`);
  }
  console.log('');
  check('it answers every question', answers.every((a) => a.raw.trim().length > 10), answers.map((a) => a.raw));
  check('without any thinking showing', answers.every((a) => !/<\/?think>/.test(a.raw)));
  check('no number anyone sees is one it wasn\'t given', answers.every((a) => a.replaced || GH.deviceCoach.keepToGiven(a.text, a.given).cut === 0));
  const tailor = existsSync(join(dir, 'tailor.out')) ? readFileSync(join(dir, 'tailor.out'), 'utf8') : '';
  const plan = GH.tailor.read(tailor);
  console.log(`\nTailor: "${TAILOR}"\n${tailor}\n${plan ? GH.tailor.plan(S, GH.tailor.valid(S, plan)).lines.map((l) => `- ${l.text}`).join('\n') : ''}`);
  check('Tailor under the grammar is JSON the app reads', !!(plan && Array.isArray(plan.focus)), tailor);
  const own = answers.filter((a) => a.replaced).length, trimmed = answers.filter((a) => !a.replaced && a.cut).length;
  console.log(`\nThe model's own words for ${answers.length - own} of ${answers.length} (${trimmed} with a line left out); the app's own answer for ${own}.`);
  done();
}
