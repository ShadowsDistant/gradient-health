// The AI coach against a mocked Anthropic API: model choice, request shape (streaming, adaptive
// thinking, effort, structured output, server-side fallback), what the summary leaves out, the key
// never leaking, and the error paths (bad key, refusal, offline).
import { build } from 'esbuild';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

// Browser-ish globals the modules expect.
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/store.js');
const bundle = await build({ entryPoints: [join(root, 'src/ai.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2022'], logLevel: 'silent' });
new Function(bundle.outputFiles[0].text)();
const AI = GH.ai;
const B = GH.brain;

/* ---------------------------------------------------------------- the fake API */
const MODELS = [
  { type: 'model', id: 'sonnet-test-3', display_name: 'Sonnet Test 3', created_at: '2026-08-01T00:00:00Z', capabilities: caps(true) },
  { type: 'model', id: 'opus-test-no-effort', display_name: 'Opus No Effort', created_at: '2026-09-01T00:00:00Z', capabilities: caps(false) },
  { type: 'model', id: 'opus-test-2', display_name: 'Opus Test 2', created_at: '2026-07-01T00:00:00Z', capabilities: caps(true) },
  { type: 'model', id: 'opus-test-1', display_name: 'Opus Test 1', created_at: '2025-11-01T00:00:00Z', capabilities: caps(true) },
];
function caps(effort) {
  const yes = { supported: true };
  return { effort: { supported: effort, low: yes, medium: yes, high: yes, max: yes, xhigh: null }, structured_outputs: yes, thinking: { supported: true, types: { adaptive: yes, enabled: yes } } };
}
const REPORT = { headline: 'A steady week.', wins: ['4 of 4 workouts.'], watch: ['Sleep dipped to 6 h 10.'], focus: ['Protein on rest days.'], ask_me: ['How do I sleep more?'] };
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
function stream(text, stop) {
  const chunks = text ? text.match(/[\s\S]{1,9}/g) : [];
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'opus-test-2', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }],
    ...(chunks.length ? [['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]] : []),
    ...chunks.map((c) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }]),
    ...(chunks.length ? [['content_block_stop', { type: 'content_block_stop', index: 0 }]] : []),
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop || 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}
const calls = [];
let mode = 'ok';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method || 'GET', headers, body });
  if (mode === 'offline') throw new TypeError('fetch failed');
  if (mode === '401') return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
  if (u.includes('/v1/models')) return new Response(JSON.stringify({ data: MODELS, has_more: false, first_id: MODELS[0].id, last_id: MODELS[MODELS.length - 1].id }), { status: 200, headers: { 'content-type': 'application/json' } });
  const text = mode === 'refusal' ? '' : body && body.output_config && body.output_config.format ? JSON.stringify(REPORT) : 'Aim for the same bedtime on weekends.';
  return new Response(stream(text, mode === 'refusal' ? 'refusal' : 'end_turn'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
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

section('Weekly report');
S.ai.enabled = true;
const rep = await AI.report(S, D0);
const models = calls.filter((c) => c.url.includes('/v1/models'));
const msg = calls.filter((c) => c.url.includes('/v1/messages')).pop();
check('lists the models once and picks the newest capable Opus', models.length === 1 && msg.body.model === 'opus-test-2' && S.ai.model.id === 'opus-test-2', msg.body.model);
check('streams, with adaptive thinking and high effort', msg.body.stream === true && msg.body.thinking && msg.body.thinking.type === 'adaptive' && msg.body.output_config.effort === 'high');
check('asks for structured JSON', msg.body.output_config.format && msg.body.output_config.format.type === 'json_schema' && msg.body.output_config.format.schema.required.includes('headline'));
check('server-side fallback on (beta header + fallbacks)', (msg.headers.get('anthropic-beta') || '').includes('server-side-fallback-2026-07-01') && msg.body.fallbacks === 'default');
check('the key goes only in its header, browser access flagged', msg.headers.get('x-api-key') === KEY && msg.headers.get('anthropic-dangerous-direct-browser-access') === 'true' && !JSON.stringify(msg.body).includes('TESTKEY'));
check('the data summary is a cached system block', msg.body.system[1].cache_control && msg.body.system[1].cache_control.type === 'ephemeral' && msg.body.system[1].text.includes('DATA SUMMARY'));
check('the report is parsed and saved for the week', rep.data.headline === REPORT.headline && AI.reportFor(S, D0) && !AI.needsReport(S, D0));

section('Ask the coach');
const deltas = [];
const ans = await AI.ask(S, D0, 'How do I sleep more?', (d, snap) => deltas.push(snap));
const q = calls.filter((c) => c.url.includes('/v1/messages')).pop();
check('medium effort, no JSON format, streamed as it arrives', q.body.output_config.effort === 'medium' && !q.body.output_config.format && deltas.length > 1 && deltas[deltas.length - 1] === ans.text);
check('the question is the last message; the chat is kept', q.body.messages[q.body.messages.length - 1].content === 'How do I sleep more?' && S.ai.chat.length === 2);
check('no second model listing (the pick is reused)', calls.filter((c) => c.url.includes('/v1/models')).length === 1);

section('Errors');
const fail = async (m) => { mode = m; try { await AI.ask(S, D0, 'Hi', null); return null; } catch (e) { return e; } finally { mode = 'ok'; } };
let e = await fail('401');
check('401 → "that API key didn\'t work", without echoing it', e && e.code === 'auth' && !e.message.includes('TESTKEY'), e && e.message);
e = await fail('refusal');
check('a refusal is reported as one', e && e.code === 'refusal', e && e.code);
e = await fail('offline');
check('offline → one line, on-device insights still work', e && e.code === 'offline' && /offline/i.test(e.message), e && e.message);
check('failed questions are not added to the chat', S.ai.chat.length === 2);
AI.deleteKey(S);
check('delete key removes it', !AI.hasKey());
e = null;
try { await AI.ask(S, D0, 'Hi'); } catch (err) { e = err; }
check('no key → a clear message, no request made', e && e.code === 'nokey');

done();
