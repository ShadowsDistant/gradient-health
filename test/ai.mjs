// The AI coach against a mocked Anthropic API: the model and thinking level the person picked, the
// request shape (streaming, thinking, effort, structured output, server-side fallback), the spending
// limits (checked before a request, recorded after), what the summary leaves out, the key never
// leaking, and the error paths (bad key, refusal, offline). Three parts: src/spend.js and src/ai.js
// (inline in the page) and src/claude.js (the requests and the SDK, a lazy chunk), bundled here like
// the build does and loaded through GH.lazy the first time it's needed.
import { build } from 'esbuild';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

// Browser-ish globals the modules expect.
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/health.js', 'src/store.js', 'src/spend.js', 'src/ai.js');
const bundle = await build({ entryPoints: [join(root, 'src/claude.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2022'], logLevel: 'silent' });
let chunkLoads = 0;
GH.lazy = async (name) => {
  if (name !== 'claude') throw new Error(`no chunk ${name}`);
  if (!GH.claude) { chunkLoads++; new Function(bundle.outputFiles[0].text)(); }
  return GH.claude;
};
const AI = GH.ai;
const B = GH.brain;

/* ---------------------------------------------------------------- the fake API */
// Claude's suggestions: one fine, one out of range, one plain tip, one kind the app doesn't know.
const SUGGEST = { suggestions: [
  { kind: 'minutes', title: 'Plan 30-minute workouts', why: 'Your last three took about 31 minutes.', minutes: 30 },
  { kind: 'minutes', title: 'Plan 7-minute workouts', why: 'Too short to be allowed.', minutes: 7 },
  { kind: 'tip', title: 'Walk after dinner', why: 'Steps are 20% under your usual.' },
] };
const REPORT = { headline: 'A steady week.', wins: ['4 of 4 workouts.'], watch: ['Sleep dipped to 6 h 10.'], focus: ['Protein on rest days.'], ask_me: ['How do I sleep more?'] };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
// USAGE: what the next answers report having used (per test below); its iterations, when a backup
// model answered.
let USAGE = { input_tokens: 1000, output_tokens: 500 };
function stream(text, stop, model) {
  const chunks = text ? text.match(/[\s\S]{1,9}/g) : [];
  const { output_tokens: out, ...start } = USAGE;
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: model || 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: Object.assign({ output_tokens: 1 }, start, { iterations: undefined }) } }],
    ...(chunks.length ? [['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]] : []),
    ...chunks.map((c) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }]),
    ...(chunks.length ? [['content_block_stop', { type: 'content_block_stop', index: 0 }]] : []),
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop || 'end_turn', stop_sequence: null }, usage: Object.assign({ output_tokens: out }, USAGE.iterations ? { iterations: USAGE.iterations } : {}) }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}
const calls = [];
let mode = 'ok';
// What the plan review, the report's plan ideas and a chat answer come back as (set per test below).
let REVIEW = { suggestions: [], note: '' };
let PLAN_IDEAS = { plan_suggestions: [], plan_note: '' };
let ANSWER = 'Aim for the same bedtime on weekends.';
let PLAN = null; // what Build me a plan and Improve get back

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method || 'GET', headers, body });
  if (mode === 'offline') throw new TypeError('fetch failed');
  if (mode === '401') return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
  if (mode === '404') return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `model: ${body && body.model}` } }), { status: 404, headers: { 'content-type': 'application/json', 'request-id': 'req_3' } });
  const fmt = body && body.output_config && body.output_config.format;
  const props = (fmt && fmt.schema && fmt.schema.properties) || {};
  if (mode === 'schema400' && props.plan_suggestions) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation.' } }), { status: 400, headers: { 'content-type': 'application/json', 'request-id': 'req_2' } });
  const wantsReview = !!(props.suggestions && props.suggestions.items && props.suggestions.items.anyOf);
  const wantsSuggestions = !!props.suggestions;
  const report = props.plan_suggestions ? Object.assign({}, REPORT, PLAN_IDEAS) : REPORT;
  const text = mode === 'refusal' ? '' : props.days && PLAN ? JSON.stringify(PLAN) : wantsReview ? JSON.stringify(REVIEW) : wantsSuggestions ? JSON.stringify(SUGGEST) : fmt ? JSON.stringify(report) : ANSWER;
  return new Response(stream(text, mode === 'refusal' ? 'refusal' : mode === 'cut' ? 'max_tokens' : 'end_turn', body && body.model), { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

/* ---------------------------------------------------------------- a person with some history */
const D0 = B.dayFromStr('2026-09-28');
const S = B.newState({ goals: ['abs', 'arms', 'chest'], age: 19, equipment: { db: [8], kb: [10] }, weightKg: 67.5, lead: { arm: 'L' } }, { curlL: 14, curlR: 18 }, D0 - 21);
for (let d = D0 - 21; d <= D0; d++) S.health.days[d] = { steps: 5000 + (d % 7) * 300, sleepMin: 380 + (d % 3) * 20, rhr: 60 + (d % 2), hrv: 55 };
for (const d of [D0 - 21, D0 - 20, D0 - 18, D0 - 17]) {
  B.startWorkout(S, d, { now: d * B.DAY_MS });
  let g = 0;
  while (S.active && S.active.idx < S.active.steps.length && g++ < 300) B.completeStep(S, {});
  B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 3600000 });
}
const KEY = 'fake-TESTKEY-0123456789abcdefghijklmnop';

section('Key');
check('rejects an empty or short key', !AI.setKey('').ok && !AI.setKey('sk-ant-x').ok && !AI.setKey('has spaces in it but long enough').ok);
check('stores a key on the device', AI.setKey(KEY).ok && AI.hasKey());
check('the key is not in the state or its backup', !JSON.stringify(S).includes('TESTKEY') && !GH.store.exportJson(S).includes('TESTKEY'));

section('What gets sent');
const sum = AI.summary(S, D0);
check('the summary has goals, averages, training and insights', /visible abs/.test(sum) && /Sleep:/.test(sum) && /Workouts: \d+ of \d+/.test(sum) && /Left\/right curl gap/.test(sum));
check('no dates, day numbers or month names', !/\d{4}-\d{2}-\d{2}/.test(sum) && !/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(sum) && !sum.includes(String(D0)));
check('age as a range, not the exact age', /18-24/.test(sum) && !/\b19\b/.test(sum));
check('the preview is exactly the system text', AI.preview(S, D0).includes(sum) && AI.preview(S, D0).includes(AI.SYSTEM));

section('Consent');
S.ai.enabled = true;
let blocked = null;
try { await AI.report(S, D0); } catch (err) { blocked = err; }
check('nothing is sent before the person allows it', blocked && blocked.code === 'consent' && calls.length === 0, blocked && blocked.code);
check('and no automatic report either', AI.needsReport(S, D0) === false);
check('the Claude chunk isn\'t even loaded yet (the SDK isn\'t parsed for nothing)', chunkLoads === 0 && !GH.claude);
check('Stop and the error lines work without it', (() => { AI.stop(); const e = AI.explain(new Error('x')); return e.code === 'other' && AI.explain(blocked) === blocked; })());
S.ai.consentAt = Date.now();

section('Weekly report');
const rep = await AI.report(S, D0);
const msg = calls.filter((c) => c.url.includes('/v1/messages')).pop();
check('the model is the one picked (Opus 5.5 until they pick another), with no model listing', msg.body.model === 'claude-opus-5-5' && GH.spend.model(S).id === 'claude-opus-5-5' && !calls.some((c) => c.url.includes('/v1/models')), msg.body.model);
check('streams, with adaptive thinking and, on Auto, medium effort for the report', msg.body.stream === true && msg.body.thinking && msg.body.thinking.type === 'adaptive' && msg.body.output_config.effort === 'medium' && msg.body.max_tokens === GH.spend.FEATURES.report.tokens[2]);
check('asks for structured JSON', msg.body.output_config.format && msg.body.output_config.format.type === 'json_schema' && msg.body.output_config.format.schema.required.includes('headline'));
check('server-side fallback on (beta header + fallbacks)', (msg.headers.get('anthropic-beta') || '').includes('server-side-fallback-2026-07-01') && msg.body.fallbacks === 'default');
check('the key goes only in its header, browser access flagged', msg.headers.get('x-api-key') === KEY && msg.headers.get('anthropic-dangerous-direct-browser-access') === 'true' && !JSON.stringify(msg.body).includes('TESTKEY'));
check('the data summary goes as its own system block, not cached for a report that goes once', !msg.body.system[1].cache_control && msg.body.system[1].text.includes('DATA SUMMARY'));
check('what it cost is on the day and the month: 1,000 tokens in and 500 out at Opus 5.5\'s prices', GH.spend.data(S).days[D0].c === 1000 * 4 + 500 * 20 && GH.spend.data(S).months['2026-09'].f.report === 14000, GH.spend.data(S).days[D0]);
check('the report is parsed and saved for the week', rep.data.headline === REPORT.headline && AI.reportFor(S, D0) && !AI.needsReport(S, D0));
check('the first request loaded the chunk, once', chunkLoads === 1 && !!GH.claude);

section('Ask the coach');
const deltas = [];
const ans = await AI.ask(S, D0, 'How do I sleep more?', (d, snap) => deltas.push(snap));
const q = calls.filter((c) => c.url.includes('/v1/messages')).pop();
check('medium effort, no JSON format, streamed as it arrives', q.body.output_config.effort === 'medium' && !q.body.output_config.format && deltas.length > 1 && deltas[deltas.length - 1] === ans.text);
const last = q.body.messages[q.body.messages.length - 1];
check('the question is the last message, the end of what\'s cached; the chat is kept', last.content[0].text === 'How do I sleep more?' && last.content[0].cache_control.type === 'ephemeral' && S.ai.chat.length === 2);
check('a question\'s summary is cached too, with the chat\'s own rules', q.body.system[1].cache_control && /Under 150 words/.test(q.body.system[0].text) && !/Under 150 words/.test(msg.body.system[0].text));
check('the answer keeps what it cost and which model wrote it', S.ai.chat[1].cost === 14000 && S.ai.chat[1].model === 'claude-opus-5-5' && ans.cost === 14000);

section('Errors');
const fail = async (m) => { mode = m; try { await AI.ask(S, D0, 'Hi', null); return null; } catch (e) { return e; } finally { mode = 'ok'; } };
let e = await fail('401');
check('401 → "that API key didn\'t work", without echoing it', e && e.code === 'auth' && !e.message.includes('TESTKEY'), e && e.message);
e = await fail('refusal');
check('a refusal is reported as one', e && e.code === 'refusal', e && e.code);
e = await fail('offline');
check('offline → one line, on-device insights still work', e && e.code === 'offline' && /offline/i.test(e.message), e && e.message);
e = await fail('404');
check('a model the key can\'t use → says which, and where to pick another', e && e.code === 'nomodel' && /Claude Opus 5\.5/.test(e.message) && /Settings/.test(e.message), e && e.message);
check('failed questions are not added to the chat', S.ai.chat.length === 2);
mode = 'cut';
const cut = await AI.ask(S, D0, 'Tell me more', null);
mode = 'ok';
check('an answer cut short keeps what came, with a note', /bedtime/.test(cut.text) && /Cut short/.test(cut.note) && S.ai.chat.length === 4);
AI.deleteKey(S);
check('delete key removes it', !AI.hasKey());
e = null;
try { await AI.ask(S, D0, 'Hi'); } catch (err) { e = err; }
check('no key → a clear message, no request made', e && e.code === 'nokey');

section('Suggestions');
{
  mode = 'ok';
  AI.setKey('sk-ant-test-0123456789abcdef');
  globalThis.GH.coach = globalThis.GH.coach || { validAction: (S2, a) => a.kind !== 'minutes' || (a.value >= 10 && a.value <= 60 && a.value % 5 === 0) };
  const n = await AI.suggest(S, D0);
  const items = S.ai.suggestions.items;
  check('asks with the suggestion schema', calls.some((c) => c.body && c.body.output_config && c.body.output_config.format && c.body.output_config.format.schema.properties.suggestions));
  check('keeps only suggestions the app can apply (and tips)', n === 2 && items.some((x) => x.action && x.action.kind === 'minutes' && x.action.value === 30) && items.some((x) => !x.action) && !items.some((x) => x.action && x.action.value === 7), items);
}

/* ---------------------------------------------------------------- the AI plan review (1.6) */
// The rest of the coach: the built-in answers and the number check (src/coach.js), Tailor's reading
// (for a focus suggestion), the review itself, and the on-device coach's prompts.
load('src/data/science.js', 'src/body.js', 'src/coach.js', 'src/tailor.js', 'src/customplan.js', 'src/planreview.js', 'src/devicecoach.js');
const R = GH.planReview, C = GH.coach;
const workout = (S1, d) => {
  B.startWorkout(S1, d, { now: d * B.DAY_MS });
  let g = 0;
  while (S1.active && S1.active.idx < S1.active.steps.length && g++ < 300) B.completeStep(S1, {});
  B.finishWorkout(S1, { rating: 'right', now: d * B.DAY_MS + 3600000 });
};
// Someone four weeks in at home, and someone whose plan works around their body.
const P = B.newState({ goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true } }, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, D0 - 28);
for (let d = D0 - 28; d < D0; d++) if (B.todayPlan(P, d).type === 'workout') workout(P, d);
const Q = B.newState({ goals: ['legs', 'back'], experience: 'lt1', days: 3, minutes: 30, age: 67, conditions: ['oa', 'back'], oaJoints: ['knee', 'hip'], floorOk: false, gentle: true, careful: ['shoulder'], equipment: { db: [10], band: true, chair: true, wall: true } }, null, D0 - 21);
for (let d = D0 - 21; d < D0; d++) if (B.todayPlan(Q, d).type === 'workout') workout(Q, d);
for (const X of [P, Q]) { X.ai.consentAt = Date.now(); X.ai.mode = 'api'; X.ai.enabled = true; }

section('The plan review: what is sent');
{
  const ctx = R.context(Q, D0, 'claude');
  const toClaude = `${AI.preview(Q, D0)}\n${R.claudeAsk(Q, ctx)}\n${R.forReport(Q, D0).ask}`;
  check('Claude gets next week\'s plan: its days, sets against targets, minutes, score and reasons', /PLAN \(next week/.test(toClaude) && /Weekly sets per group/.test(toClaude) && /Plan score \d+ of 100/.test(toClaude) && /\d+ of \d+ min/.test(toClaude) && /Why the planner picked it/.test(toClaude));
  check('never a health condition, the joints arthritis affects, floor work, a gentle start or the exact age', !/arthritis|back pain|Planned around|Nothing on the floor|gentle|\b67\b/i.test(toClaude), toClaude.match(/arthritis|back pain|Planned around|Nothing on the floor|gentle|\b67\b/i));
  check('just the age range, with goals, schedule and careful joints in the summary', /65\+/.test(toClaude) && /legs and glutes/.test(toClaude) && /Careful with: shoulder/.test(toClaude));
  const dev = R.deviceMessages(Q, D0, R.context(Q, D0, 'device')).map((m) => m.content).join('\n');
  check('the on-device model gets them, on the phone', /osteoarthritis/.test(dev) && /low back pain/.test(dev) && /Joints with arthritis: knee, hip/.test(dev) && /Nothing on the floor/.test(dev) && /A gentle plan/.test(dev) && /Planned around/.test(dev));
  check('and the same plan and readiness', /PLAN \(next week/.test(dev) && /Weekly sets per group/.test(dev) && /Workouts in the last 4 weeks/.test(dev));
  const p = Q.profile;
  const ok = ctx.allowed.every((id) => { const m = GH.moves.MOVES[id]; return m && GH.moves.allowed(m, B.eqAt(Q, 'home')) && !GH.access.why(p, m, D0) && !((m.impact || m.complex) && (m.joints || []).includes('shoulder')); });
  const ctxP = R.context(P, D0, 'claude');
  check('moves a swap may name: at most 60, each one they can do with their kit and body', ctx.allowed.length > 0 && ctx.allowed.length <= 60 && ctxP.allowed.length <= 60 && ok, ctx.allowed.length);
  check('none of the moves they do now', ctxP.swaps.every((x) => !x.options.includes(x.current)));
}

section('The plan review: the schema and the grammar');
{
  const ctx = R.context(P, D0, 'claude');
  const sc = R.schema(ctx);
  const variants = sc.properties.suggestions.items.anyOf;
  check('one object shape per kind, every one closed and complete', variants.length === ctx.kinds.length && ctx.kinds.length === R.KINDS.length && variants.every((v) => v.additionalProperties === false && v.required.length === Object.keys(v.properties).length && v.properties.kind.enum.length === 1));
  const byKind = Object.fromEntries(variants.map((v) => [v.properties.kind.enum[0], v.properties]));
  check('each kind has just its own fields, then title and why', JSON.stringify(Object.keys(byKind.more_sets)) === JSON.stringify(['kind', 'group', 'delta', 'title', 'why']) && JSON.stringify(Object.keys(byKind.tip)) === JSON.stringify(['kind', 'title', 'why']) && JSON.stringify(Object.keys(byKind.move_day)) === JSON.stringify(['kind', 'from', 'to', 'title', 'why']));
  check('values held to what the app can do: moves, free days, rest, minutes', JSON.stringify(byKind.swap_move.move.enum) === JSON.stringify(ctx.allowed) && JSON.stringify(byKind.move_day.to.enum) === JSON.stringify(ctx.freeDays) && JSON.stringify(byKind.rest.rest.enum) === '[60,90,120]' && byKind.minutes.minutes.enum.length === 11 && JSON.stringify(byKind.more_sets.delta.enum) === '[1,2]' && JSON.stringify(byKind.fewer_sets.delta.enum) === '[-2,-1]');
  check('only keywords structured outputs take (no ranges, lengths or item counts)', !/"(minimum|maximum|minLength|maxLength|maxItems|minItems|multipleOf)"/.test(JSON.stringify(sc)));
  const gram = R.grammar(R.context(P, D0, 'device'));
  check('the grammar is made from the same spec: a rule for every kind, at most 3 suggestions, the note last', ctx.kinds.every((k) => gram.includes(`kind-${k.replace(/_/g, '-')} ::= "{\\"kind\\":\\"${k}\\""`)) && /\{0,2\}\)\? "\],\\"note\\":" note "\}"$/m.test(gram.split('\n')[0]));
  check('with the same moves and days', ctx.allowed.every((id) => gram.includes(`"\\"${id}\\""`)) && gram.split('\n').find((l) => l.startsWith('to ::=')) === `to ::= ${ctx.freeDays.map((d) => `"${d}"`).join(' | ')}`);
  check('rule names a GBNF parser reads (no underscores)', gram.split('\n').every((l) => /^[a-z0-9-]+ ::= /.test(l)));
  // A name given twice is one rule to llama.cpp: the kind "minutes" would also take a bare 35.
  const names = gram.split('\n').map((l) => l.split(' ::= ')[0]);
  check('each rule is named once', new Set(names).size === names.length, names);
  check('an answer cut off at the token limit is still read', R.readJson('{"suggestions":[{"kind":"tip","title":"Sleep","why":"More sleep').suggestions.length === 1);
}

section('The plan review: asking Claude');
{
  const ctx = R.context(P, D0, 'claude');
  const sw = ctx.swaps[0];
  REVIEW = { suggestions: [
    { kind: 'swap_move', family: sw.family, move: sw.options[0], title: 'Try a new move', why: 'A step up keeps the work fresh.' },
    { kind: 'tip', title: 'Sleep a little more', why: 'Your sleep sets the tone for every workout.' },
  ], note: 'Your plan fits your goals.' };
  const before = calls.length;
  const res = await R.ask(P, D0, { engine: 'claude' });
  const msg = calls.slice(before).filter((c) => c.url.includes('/v1/messages')).pop();
  check('one structured request, medium effort, the review\'s own schema', msg && msg.body.output_config.effort === 'medium' && msg.body.output_config.format.type === 'json_schema' && !!msg.body.output_config.format.schema.properties.suggestions.items.anyOf);
  check('the plan goes in the question, the usual summary in the system text', /PLAN \(next week/.test(msg.body.messages[0].content) && /DATA SUMMARY/.test(msg.body.system[1].text));
  const review = await R.run(P, D0, { engine: 'claude' });
  check('the answer is checked and kept for the sheet', review.engine === 'claude' && review.items.length === 1 && review.items[0].kind === 'swap_move' && review.tips.length === 1 && P.ai.review === review);
  check('it stays while the plan is as it was', R.current(P, D0) === review);
}

section('The plan review: an on-device model with a short memory');
{
  // A stand-in for the model on the phone: it takes up to `limit` characters, like a context window.
  const DC = GH.deviceCoach;
  const keep = { room: DC.room, structured: DC.structured };
  const seen = [];
  let limit = Infinity;
  DC.structured = async (S1, msgs, o) => {
    const chars = msgs.reduce((a, m) => a + m.content.length, 0);
    seen.push({ chars, maxTokens: o.maxTokens, grammar: o.grammar, text: msgs.map((m) => m.content).join('\n') });
    if (chars > limit) { const e = new Error('too long'); e.code = 'too-long'; throw e; }
    return { raw: JSON.stringify({ suggestions: [], note: 'It fits.' }), aborted: false, model: 'test', stats: null };
  };
  const quoted = (gram, id) => gram.includes(`"\\"${id}\\""`);
  try {
    const full = R.context(P, D0, 'device');
    const small = R.compact(full);
    const reasonsLine = (lines) => lines.some((l) => /^- Why the planner picked it/.test(l));
    check('the shorter plan: two moves to swap to for each family, 16 in all, and no reasons line', small.compact && small.allowed.length <= 16 && small.allowed.length < full.allowed.length && small.swaps.every((x) => x.options.length <= 2 && x.options.every((id) => full.allowed.includes(id))) && !reasonsLine(R.planLines(P, small)) && reasonsLine(R.planLines(P, full)), { full: full.allowed.length, small: small.allowed.length });
    DC.room = async () => 4096;
    const roomy = await R.ask(P, D0, { engine: 'device' });
    check('a model with room gets the whole plan', !roomy.ctx.compact && seen.length === 1 && seen[0].maxTokens === 560 && /Why the planner picked it/.test(seen[0].text));
    seen.length = 0;
    DC.room = async () => 2048;
    const short = await R.ask(P, D0, { engine: 'device' });
    const gone = full.allowed.filter((id) => !short.ctx.allowed.includes(id));
    check('one with 2,048 tokens gets the shorter plan straight away, its grammar held to the shorter lists', short.ctx.compact && seen.length === 1 && seen[0].maxTokens === 420 && !/Why the planner picked it/.test(seen[0].text) && short.ctx.allowed.every((id) => quoted(seen[0].grammar, id)) && gone.length > 0 && !gone.some((id) => quoted(seen[0].grammar, id)), seen.map((x) => x.chars));
    check('and the shorter plan fits it, counted the way the engine counts (3 characters a token)', Math.ceil(seen[0].chars / 3) + 2 * 6 + 64 + 420 <= 2048, seen[0].chars);
    const fam = full.swaps.find((x) => x.options.includes(gone[0]));
    const offered = R.validate(P, { suggestions: [{ kind: 'swap_move', family: fam.family, move: gone[0], title: 'A move it wasn\'t offered', why: 'Fresh.' }] }, D0, { ctx: short.ctx, given: null });
    check('its answer is checked against the same lists', offered.items.length === 0 && /isn't in your plan/.test(offered.rejected[0].reason), offered.rejected);
    // A model that turns the whole plan down anyway (the count is an estimate): the shorter one next.
    seen.length = 0;
    DC.room = async () => 4096;
    const fullChars = R.deviceMessages(P, D0, full).reduce((a, m) => a + m.content.length, 0);
    const smallChars = R.deviceMessages(P, D0, small).reduce((a, m) => a + m.content.length, 0);
    limit = Math.floor((fullChars + smallChars) / 2);
    const retried = await R.ask(P, D0, { engine: 'device' });
    check('should a model still say the whole plan is too long, the shorter one is tried', retried.ctx.compact && seen.length === 2 && seen[0].chars === fullChars && seen[1].chars === smallChars, seen.map((x) => x.chars));
    seen.length = 0;
    limit = 100;
    let e3 = null;
    try { await R.ask(P, D0, { engine: 'device' }); } catch (e) { e3 = e; }
    check('and when that\'s too long as well, a plain error says what would work', e3 && e3.code === 'too-long' && /newer size in Settings/.test(e3.message) && seen.length === 2, e3 && e3.message);
  } finally { Object.assign(DC, keep); }
}

section('The plan review: checking suggestions');
{
  const ctx = R.context(P, D0, 'device');
  const sw = ctx.swaps[1] || ctx.swaps[0];
  const given = R.deviceMessages(P, D0, ctx).map((m) => m.content).join('\n');
  const raw = { suggestions: [
    { kind: 'swap_move', family: sw.family, move: sw.options[0], title: 'Swap in a harder move', why: 'It keeps the work fresh. 87% of people love it.' },
    { kind: 'move_day', from: ctx.workDays[ctx.workDays.length - 1], to: ctx.freeDays[ctx.freeDays.length - 1], title: 'Move your last workout 37 days', why: 'More rest before it.' },
    { kind: 'split', split: 'auto', title: 'Let the planner pick', why: 'It knows best.' },
  ], note: 'Looks good.' };
  const v = R.validate(P, raw, D0, { ctx, given });
  const swap = v.items.find((x) => x.kind === 'swap_move');
  check('a good swap is a card with what it changes and the score in words', swap && swap.diff.some((l) => / from now on\.$/.test(l)) && /^(A better fit: \d+ points? higher, mostly on |Scores \d+ points? lower \(mostly |About as good a fit as your plan now\.$)/.test(swap.score.text) && swap.change.tweaks.swaps[sw.family] === sw.options[0], swap);
  // In points, never a second score: Why this plan scores the plan as designed, a card next week's
  // sessions as built, and two numbers out of 100 that differ would only confuse.
  check('the change is told in points, not as a score out of 100', v.items.every((x) => !/out of 100/.test(x.score.text)), v.items.map((x) => x.score.text));
  check('a sentence with a number it wasn\'t given is left out of the why', swap && swap.why === 'It keeps the work fresh.' && v.cut >= 1, swap && swap.why);
  const day = v.items.find((x) => x.kind === 'move_day');
  check('a title with a made-up number gets the app\'s own', day && !/37/.test(day.title) && /workout to/.test(day.title), day && day.title);
  check('a day move says which days change', day && /^Workouts on .+ \(was .+\)\.$/.test(day.diff[0]), day && day.diff);
  check('a change that\'s already so is not applied, with the reason', v.rejected.some((x) => x.title === 'Let the planner pick' && /already picks your split/.test(x.reason)), v.rejected);
  // Every kind is checked with the engine's own test: applied when it passes, turned down with a
  // plain reason when it doesn't.
  const bad = R.validate(P, { suggestions: [
    { kind: 'swap_move', family: 'squat', move: 'sq_jump', title: 'Jump squats', why: 'Power.' },
    { kind: 'move_day', from: ctx.freeDays[0], to: ctx.freeDays[1] != null ? ctx.freeDays[1] : ctx.workDays[0], title: 'Move a rest day', why: 'Why not.' },
    { kind: 'delete_everything', title: 'Start over', why: 'Fresh start.' },
  ], note: '' }, D0, { ctx, given });
  check('a move they can\'t do, a day that isn\'t a workout day and a kind the app doesn\'t have are turned down', bad.items.length === 0 && bad.rejected.length === 3 && /equipment and joints/.test(bad.rejected[0].reason) && /isn't one of your workout days/.test(bad.rejected[1].reason) && /can't make/.test(bad.rejected[2].reason), bad.rejected);
  const tries = [{ kind: 'split', split: 'full_body' }, { kind: 'split', split: 'ppl' }, { kind: 'split', split: 'upper_lower' }, { kind: 'minutes', minutes: 10 }, { kind: 'minutes', minutes: 60 }, { kind: 'fewer_sets', group: 'chest', delta: -2 }, { kind: 'more_sets', group: 'shoulders', delta: 2 }];
  let agree = true, reasons = [];
  for (const t of tries) {
    const one = R.validate(P, { suggestions: [Object.assign({ title: 'A change', why: 'Because.' }, t)] }, D0, { ctx, given: null });
    const prep = R.prepare(P, R.normalize({ suggestions: [t] }, ctx).items[0], ctx);
    const engineSays = prep.change ? R.trial(P, prep.change, D0).ok : false;
    if (engineSays !== (one.items.length === 1)) agree = false;
    reasons = reasons.concat(one.rejected.map((x) => x.reason));
  }
  check('each one passes exactly when the engine\'s own test passes', agree);
  // More or fewer sets of a group is only offered when next week's sets of that group move that way
  // (with no time for them, the plan could keep the group as it was and drop a set elsewhere).
  const wrongWay = [];
  for (const g of R.GROUPS) {
    for (const t of [{ kind: 'more_sets', group: g, delta: 1 }, { kind: 'more_sets', group: g, delta: 2 }, { kind: 'fewer_sets', group: g, delta: -1 }]) {
      const one = R.validate(P, { suggestions: [Object.assign({ title: 'A change', why: 'Because.' }, t)] }, D0, { ctx, given: null });
      const it = one.items[0];
      if (!it) continue;
      const tr = R.trial(P, it.change, D0);
      const gs = g === 'arms' ? ['biceps', 'triceps'] : [g];
      const up = t.kind === 'more_sets';
      if (!gs.some((x) => (up ? tr.after.perGroup[x].sets > tr.before.perGroup[x].sets : tr.after.perGroup[x].sets < tr.before.perGroup[x].sets))) wrongWay.push(`${t.kind} ${g} ${t.delta}`);
    }
  }
  check('more or fewer sets of a group is only offered when that group\'s sets move that way', !wrongWay.length, wrongWay);
  check('and a turned-down one says why in plain words, with no ids or rule names', reasons.length > 0 && reasons.every((r) => /^[A-Z]/.test(r) && /\.$/.test(r) && !/_|violation|tweak|undefined/.test(r)), reasons);
  // A split the engine says no to, by name: the score would drop by more than 0.03.
  const worse = ['full_body', 'ppl', 'upper_lower'].map((s) => ({ s, t: GH.optimizer.applyTweaks(P, { split: s }, D0) })).find((x) => !x.t.ok);
  if (worse) {
    const w = R.validate(P, { suggestions: [{ kind: 'split', split: worse.s, title: 'Change the split', why: 'Variety.' }] }, D0, { ctx, given: null });
    check('a split that scores more than 3 points lower is turned down', w.items.length === 0 && /worse fit \(\d+ points lower\), mostly on /.test(w.rejected[0].reason), w.rejected);
  }
  // Applying: together, with one undo.
  const keep = JSON.stringify({ t: P.profile.planTweaks || null, m: P.profile.minutes, w: P.profile.weekdays, v: P.vol });
  const res = R.apply(P, v.items, D0, { engine: 'device', source: 'test' });
  const ev = P.events[P.events.length - 1];
  check('apply writes them all, and records one review', res.applied.length === v.items.length && P.profile.planTweaks.swaps[sw.family] === sw.options[0] && ev.type === 'review' && ev.engine === 'device' && ev.lines.length === v.items.length);
  check('the coach\'s timeline lists it, and who suggested it', C.timeline(P, D0, 3).some((x) => /^Plan checked: /.test(x.text) && /on-device coach/.test(x.why)));
  check('undo puts the plan back as it was', R.undo(P, D0) && JSON.stringify({ t: P.profile.planTweaks || null, m: P.profile.minutes, w: P.profile.weekdays, v: P.vol }) === keep && P.events[P.events.length - 1 - 0].undone !== false);
  check('and there\'s nothing left to undo', !R.undo(P, D0));
}

section('The plan review: the weekly report\'s plan ideas');
{
  const ctx = R.context(P, D0, 'claude');
  PLAN_IDEAS = { plan_suggestions: [
    { kind: 'more_sets', group: 'back', delta: 1, title: 'One more back set', why: 'Your back gets 99 sets now.' },
    { kind: 'swap_move', family: ctx.swaps[0].family, move: 'not_a_move', title: 'A move that isn\'t there', why: 'Hmm.' },
  ], plan_note: 'A good week of training.' };
  const before = calls.length;
  const rep = await AI.report(P, D0);
  const msg = calls.slice(before).filter((c) => c.url.includes('/v1/messages')).pop();
  const fmt = msg.body.output_config.format.schema;
  check('the report\'s one request also asks for plan ideas', fmt.required.includes('plan_suggestions') && fmt.required.includes('plan_note') && !!fmt.properties.plan_suggestions.items.anyOf && /PLAN IDEAS/.test(msg.body.messages[0].content) && /PLAN \(next week/.test(msg.body.messages[0].content));
  check('its ideas are kept on the report, read and held to the numbers', rep.plan && rep.plan.items.length === 1 && rep.plan.items[0].kind === 'more_sets' && rep.plan.items[0].why === '' && rep.plan.note === 'A good week of training.', rep.plan);
  check('the report itself is as before', rep.data.headline === REPORT.headline && !('plan_suggestions' in rep.data));
  check('workouts off: no plan ideas asked for', (() => { const was = P.profile.workouts; P.profile.workouts = false; const parts = AI.reportParts(P, D0); P.profile.workouts = was; return !parts.plan && !parts.schema.properties.plan_suggestions; })());
  mode = 'schema400';
  const n0 = calls.length;
  let rep2 = null, e2 = null;
  try { rep2 = await AI.report(P, D0); } catch (err) { e2 = err; }
  mode = 'ok';
  const tries = calls.slice(n0).filter((c) => c.url.includes('/v1/messages'));
  check('should the API turn the plan\'s schema down, the report is asked for again without it', !e2 && rep2 && rep2.data.headline === REPORT.headline && !rep2.plan && tries.length === 2 && !tries[1].body.output_config.format.schema.properties.plan_suggestions, e2 && e2.message);
  const odd = R.normalize({ suggestions: [{ kind: 'More_Sets', group: 'Back', delta: 1, title: 'x', why: 'y' }, { kind: 'SPLIT', split: 'Full_Body', title: 'x', why: 'y' }] }, ctx);
  check('enum values come back in any case and are still read', odd.items.length === 2 && odd.items[0].kind === 'more_sets' && odd.items[0].group === 'back' && odd.items[1].split === 'full_body', odd);
}

section('Claude chat: red flags and the number check');
{
  const before = calls.length;
  const a = await AI.ask(P, D0, 'I get chest pain when I do push-ups');
  check('a red-flag question gets the app\'s safety answer, and nothing is sent', a.safety && /doctor/.test(a.text) && calls.length === before);
  const log = P.ai.chat.slice(-2);
  check('it\'s kept in the chat, marked safety', log.length === 2 && log.every((m) => m.safety) && log[0].role === 'user');
  ANSWER = 'You slept about 7 hours most nights. Studies say 64% of people sleep less than you. Keep your bedtime steady on weekends.';
  const b = await AI.ask(P, D0, 'How is my sleep?');
  const sent = calls.slice(before).filter((c) => c.url.includes('/v1/messages')).pop();
  check('the next question goes without the safety exchange', !JSON.stringify(sent.body.messages).includes('chest pain'));
  check('a sentence with a number that wasn\'t sent is left out, with the device path\'s note', !/64%/.test(b.text) && /bedtime/.test(b.text) && /Left out a line with a number/.test(b.note) && b.raw.includes('64%'), b);
  check('the chat keeps the checked answer and its note', P.ai.chat[P.ai.chat.length - 1].text === b.text && /Left out a line/.test(P.ai.chat[P.ai.chat.length - 1].note));
  ANSWER = 'You need 12,345 steps.';
  const c = await AI.ask(P, D0, 'How are my steps?');
  check('if almost nothing is left, the app\'s own answer, saying so', c.replaced && c.text === C.ask(P, D0, 'How are my steps?').text && /Claude's answer didn't match your numbers, so this is the app's own\./.test(c.note), c);
  ANSWER = 'Aim for the same bedtime on weekends.';
}

section('Build me a plan: a model\'s plan is checked too');
{
  const CP = GH.customPlan;
  const S1 = B.newState({ goals: ['arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true } }, null, D0 - 14);
  CP.ensure(S1);
  const w = CP.wishes(S1, '3 days, 30 minutes, bigger arms');
  const draft = CP.generate(S1, D0, w);
  const ids = CP.allowedMoves(S1, D0, w, draft);
  const like = (f) => ({ name: 'Plan', note: 'A plan.', days: draft.days.map((d, i) => ({ title: d.title, items: f(d, i) })) });
  const same = CP.accept(S1, D0, w, draft, like((d) => d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.reps || it.secs }))), ids);
  check('the draft\'s own moves and sets pass', !!same);
  const long = CP.accept(S1, D0, w, draft, like((d) => d.items.map((it) => ({ move: it.move, sets: 6, reps: 12 }))), ids);
  const group = (id) => GH.moves.MOVES[id].group;
  const focus = (it) => ['biceps', 'triceps'].includes(group(it.move));
  check('a plan too long for the time is cut to fit (or to the draft\'s own day, when that runs longer)', long && long.days.every((d, i) => CP.minutes(S1, long, i, D0) <= Math.max(30, CP.minutes(S1, draft, i, D0)) + 2), long && long.days.map((d, i) => [CP.minutes(S1, long, i, D0), CP.minutes(S1, draft, i, D0)]));
  check('sets come off evenly, the moves for what they asked for keeping theirs longer', long && long.days.every((d) => { const f = d.items.slice(1).filter(focus), o = d.items.slice(1).filter((it) => !focus(it)); return !f.length || !o.length || Math.min(...f.map((it) => it.sets)) >= Math.max(...o.map((it) => it.sets)) - 1; }) && long.days.every((d) => d.items.every((it) => it.sets >= 1)), long && long.days.map((d) => d.items.map((it) => `${it.move}x${it.sets}`).join(' ')));
  const noLegs = CP.accept(S1, D0, w, draft, like((d) => d.items.filter((it) => group(it.move) !== 'legs').concat(d.items.filter((it) => group(it.move) !== 'legs').length < 2 ? d.items.slice(0, 2) : []).map((it) => ({ move: it.move, sets: it.sets, reps: 10 }))), ids);
  check('one that leaves out a muscle group the draft trains is turned down', noLegs === null);
  const noArms = CP.accept(S1, D0, w, draft, like((d) => d.items.map((it) => ({ move: it.move, sets: ['biceps', 'triceps'].includes(group(it.move)) ? 1 : it.sets, reps: 10 }))), ids);
  check('so is one that cuts back the groups they asked for', noArms === null);
  const core = CP.accept(S1, D0, w, draft, like((d) => d.items.slice().reverse().map((it) => ({ move: it.move, sets: it.sets, reps: 10 }))), ids);
  check('core work goes last', !core || core.days.every((d) => { const k = d.items.findIndex((it) => group(it.move) === 'abs'); return k < 0 || d.items.slice(k).every((it) => group(it.move) === 'abs'); }));
}

section('Improve a plan of their own');
{
  const CP = GH.customPlan;
  const S2 = B.newState({ goals: ['arms', 'chest', 'legs'], experience: 'onoff', days: 3, minutes: 30, age: 30, equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true } }, null, D0 - 14);
  CP.ensure(S2);
  Object.assign(S2.ai, { mode: 'api', enabled: true, consentAt: Date.now() });
  const mine = CP.save(S2, CP.generate(S2, D0, CP.wishes(S2, '3 days, 30 minutes'))).plan;
  const first = mine.days[0].items.find((x) => x.sets > 1);
  const as = (f) => ({ name: 'Something else', note: 'A little more for your arms.', days: mine.days.map((d, i) => ({ title: d.title, items: d.items.map((it, k) => f(it, i, k)).filter(Boolean) })) });
  // One set fewer on the first move of day 1 with more than one: it still fits the time and the checks.
  const k0 = mine.days[0].items.findIndex((x) => x.sets > 1);
  PLAN = as((it, i, k) => ({ move: it.move, sets: i === 0 && k === k0 ? it.sets - 1 : it.sets, reps: it.reps || it.secs }));
  const before = calls.length;
  const r = await CP.improve(S2, D0, mine, 'more for my arms');
  const msg = calls.slice(before).filter((c) => c.url.includes('/v1/messages')).pop();
  check('Claude gets their plan as the draft, and what they asked', !!msg && /Improve my own plan from my data, and: more for my arms/.test(msg.body.messages[0].content) && /"move":/.test(msg.body.messages[0].content) && !!msg.body.output_config.format.schema.properties.days);
  check('as a plan built from scratch: the plan features\' summary, without food', /TRAINING/.test(msg.body.system[1].text) && !/FOOD AND BODY/.test(msg.body.system[1].text));
  check('its take comes back checked, with their plan\'s name, and what changed in words', r.by === 'claude' && r.plan && r.plan.name === mine.name && r.changes.length === 1 && r.changes[0].startsWith(`Day 1: ${GH.moves.MOVES[first.move].name} ${first.sets} × `) && / → \d+ × /.test(r.changes[0]), r.changes);
  check('their plan isn\'t changed until they choose', CP.get(S2, mine.id).days[0].items[0].sets === first.sets);
  check('the request is on the month\'s record as a plan built', GH.spend.data(S2).months['2026-09'] && GH.spend.data(S2).months['2026-09'].f.build > 0);
  // A take that drops every leg move fails the same checks as a plan built from scratch.
  PLAN = as((it) => (GH.moves.MOVES[it.move].group === 'legs' ? null : { move: it.move, sets: it.sets, reps: it.reps || it.secs }));
  const bad = await CP.improve(S2, D0, mine, '');
  check('a take that fails the checks leaves nothing to use', bad.plan === null && !bad.error);
  S2.ai.budget = { monthly: 10, daily: null, request: 0.0001 };
  const capped = await CP.improve(S2, D0, mine, '');
  check('a spending limit that stops Claude comes back as the reason', capped.plan === null && capped.error && capped.error.code === 'budget-request', capped.error && capped.error.code);
  const same = CP.diff(mine, mine);
  check('the same plan has nothing to say', same.length === 0);
  PLAN = null;
}

done();
