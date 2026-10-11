/* The Claude requests, with the official Anthropic SDK: a lazy chunk (GH.lazy('claude'), built into
 * dist/lazy/claude.js by scripts/build.mjs), so the SDK isn't parsed at every launch. It loads the
 * first time GH.ai asks Claude something, after GH.ai has checked the person's OK and the key.
 *
 * Everything that doesn't need the SDK stays inline and is read from there: the key, consent, the
 * summary and system text (what gets sent), the error messages and the report helpers (GH.ai,
 * src/ai.js), and the model, the thinking level and the spending limits (GH.spend, src/spend.js).
 *
 * Every request goes through send(): the limits are checked against its worst case first (it isn't
 * sent when even a short answer could go over them), it goes with the model and thinking the person
 * picked, and what it cost is recorded from the usage the API reports, a stopped or broken one's too.
 */
import Anthropic from '@anthropic-ai/sdk';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const AI = () => GH.ai;
const B = () => GH.brain;
const SP = () => GH.spend;
const coachError = (code, detail) => AI().coachError(code, detail);
let lastModel = 'that model'; // the name of the model the last request asked for, for its errors

function client(long) {
  const apiKey = AI().getKey();
  if (!apiKey) throw coachError('nokey');
  // The timeout is for the response to start; a long answer streams for as long as it takes.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: long ? 300000 : 120000 });
}

/* ------------------------------------------------------------------ errors */
// SDK errors → one line a person can act on. Never includes request headers (the key).
function explain(err) {
  const MESSAGES = AI().MESSAGES;
  if (err && err.code && MESSAGES[err.code] && !(err instanceof Anthropic.APIError)) return err;
  if (err instanceof Anthropic.APIUserAbortError) return coachError('aborted');
  if (err instanceof Anthropic.AuthenticationError) return coachError('auth');
  if (err instanceof Anthropic.PermissionDeniedError) return coachError('permission');
  if (err instanceof Anthropic.NotFoundError) return coachError('nomodel', `This key can't use ${lastModel}. Pick another model in Settings, under AI coach.`);
  if (err instanceof Anthropic.RateLimitError) return coachError('rate');
  if (err instanceof Anthropic.APIConnectionError) return coachError('offline');
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status >= 500) return coachError('overloaded');
    const apiMsg = err.error && err.error.error && err.error.error.message;
    const e = err.status === 400 && apiMsg && /credit|billing|balance/i.test(apiMsg) ? coachError('other', apiMsg)
      : err.status === 400 && apiMsg ? coachError('other', `Claude couldn't take that request: ${String(apiMsg).slice(0, 200)}`) : coachError('other');
    // A request the API turned down as it was (a 400): the report then tries again without its plan
    // ideas.
    if (err.status === 400) e.badRequest = true;
    return e;
  }
  return coachError('other');
}

/* ------------------------------------------------------------------ sending */
function textOf(msg) { return (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''); }
function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw coachError('refusal');
  if (msg.stop_reason === 'max_tokens') throw coachError('cut');
}
// Everything a request sends, as characters: what its worst case is reckoned from.
function sizeOf(body) {
  const text = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, x) => a + String((x && x.text) || '').length, 0) : 0);
  let n = (body.system || []).reduce((a, x) => a + String(x.text || '').length, 0);
  for (const m of body.messages || []) n += text(m.content) + 8;
  if (body.format) n += JSON.stringify(body.format.schema).length;
  return n;
}

let busy = null;
function stop() { if (busy) { try { busy.abort(); } catch (e) { /* ignore */ } } }

// One request for a feature (src/spend.js FEATURES). body: { system, messages, format? }. onText
// (delta, snapshot) gets a streamed answer as it arrives. Resolves { msg, shape } (shape: what
// GH.spend allowed: model, effort, maxTokens, cut).
async function send(S, day, feature, body, onText) {
  const ok = SP().allow(S, day, feature, sizeOf(body));
  if (!ok.ok) throw AI().budgetError(ok);
  lastModel = (SP().byId(ok.model) || {}).name || ok.model;
  const c = client(ok.maxTokens > 16000);
  const params = {
    model: ok.model,
    max_tokens: ok.maxTokens,
    thinking: ok.thinking,
    output_config: body.format ? { effort: ok.effort, format: body.format } : { effort: ok.effort },
    system: body.system,
    messages: body.messages,
  };
  // A backup model answers if a safety check turns the request down by mistake, when the limits have
  // room for that too.
  if (ok.backup) { params.betas = [FALLBACK_BETA]; params.fallbacks = 'default'; }
  const started = Date.now();
  let stream = null, text = 0, recorded = false;
  const record = (usage, estimated) => {
    if (recorded) return;
    recorded = true;
    SP().record(S, day, { feature, model: ok.model, level: ok.level, usage, estimated });
  };
  try {
    stream = c.beta.messages.stream(params);
    busy = stream;
    stream.on('text', (delta, snapshot) => {
      text += delta.length;
      if (onText) { try { onText(delta, snapshot); } catch (e) { /* UI errors stay in the UI */ } }
    });
    const msg = await stream.finalMessage();
    record(msg.usage, false);
    return { msg, shape: ok };
  } catch (err) {
    // Stopped or broken after it started: the input and whatever was written are billed. The output
    // isn't counted until the end, so it's reckoned from the time it ran (at a quick model's pace,
    // so it errs high) and the text that came, never past the output limit.
    const snap = stream && stream.currentMessage;
    if (snap && snap.usage) {
      const secs = (Date.now() - started) / 1000;
      const out = Math.min(ok.maxTokens, Math.max(Number(snap.usage.output_tokens) || 0, Math.ceil(secs * 250 + text / 3)));
      record(Object.assign({}, snap.usage, { output_tokens: out }), true);
    }
    throw explain(err);
  } finally {
    SP().release(ok.hold);
    if (busy === stream) busy = null;
  }
}

/* ------------------------------------------------------------------ the weekly report */
const REPORT_ASK = [
  'Write this week\'s report for a small card. Keep every part short and plain, with their numbers.',
  'headline: how the week went, under 10 words.',
  'glance: 2-4 key numbers this week, in this order when there\'s data: sleep, steps, resting heart rate, weight (else HRV, workouts or activity). metric: 1-2 words ("Sleep", "Resting HR"). value: this week\'s average as they\'d read it ("7 h 05", "8.2k", "58 bpm", "149.6 lb"). trend: the change against their usual, starting with + or - ("+20 min", "-9%", "-0.3 lb"), or "steady". tone: good, watch or neutral.',
  'wins: 1-3 specific things that went well, under 8 words each, no full stop ("New best: 30 kettlebell deadlift").',
  'watch: 0-3 things to keep an eye on (health or training), one sentence each, under 25 words.',
  'focus: 1-3 concrete things for next week that fit the app\'s plan, one sentence each, under 25 words.',
  'focus_one: the most useful of those, under 8 words ("Keep a steady bedtime").',
  'ask_me: 2-3 short questions they might ask you next.',
].join('\n');

// Weekly report (structured). Saved in S.ai.reports; resolves with the report object. With a plan to
// check, the plan review rides along (GH.ai.reportParts): its ideas are kept on the report as
// rep.plan, already held to the numbers that were sent, for the person to look over.
async function report(S, day) {
  AI().needConsent(S);
  // The plan review is a part of its own (src/ui/lazy.js): it's in before the report asks it for the
  // plan's part, or the report goes without plan ideas, as it would without a plan.
  if (GH.lazy) await GH.lazy('review').catch(() => null);
  let parts = AI().reportParts ? AI().reportParts(S, day) : { schema: AI().REPORT_SCHEMA, ask: '', plan: null };
  let ask = parts.ask ? `${REPORT_ASK}\n\n${parts.ask}` : REPORT_ASK;
  const system = AI().systemBlocks(S, day, 'report');
  const once = () => send(S, day, 'report', { system, messages: [{ role: 'user', content: ask }], format: { type: 'json_schema', schema: parts.schema } });
  try {
    let res;
    try { res = await once(); } catch (err) {
      // The plan ideas make the schema the person's own (their moves and days); should the API ever
      // turn it down (a schema too complex to compile is a 400), the report goes without them.
      if (!(parts.plan && err && err.code === 'other' && err.badRequest)) throw err;
      parts = { schema: AI().REPORT_SCHEMA, ask: '', plan: null };
      ask = REPORT_ASK;
      res = await once();
    }
    const msg = res.msg;
    checkStop(msg);
    let data;
    try { data = JSON.parse(textOf(msg)); } catch (e) { throw coachError('other'); }
    const rep = { week: B().weekStart(day), day, createdAt: Date.now(), model: AI().modelName(S), data: AI().readReport(data) };
    if (parts.plan && GH.planReview) {
      try { rep.plan = GH.planReview.fromReport(S, day, data, parts.plan, `${system.map((b) => b.text).join('\n')}\n${ask}`); } catch (e) { /* the report stands without its plan ideas */ }
    }
    S.ai.reports = (S.ai.reports || []).filter((r) => r.week !== rep.week).concat(rep).slice(-12);
    return rep;
  } catch (err) {
    throw explain(err);
  }
}

/* ------------------------------------------------------------------ questions */
// The last few exchanges, as context for the next question: whole exchanges only, leaving out safety
// answers (the app's own, never sent) and answers the person reported.
function pastTurns(S) {
  const log = S.ai.chat || [];
  const out = [];
  for (let i = 0; i + 1 < log.length; i++) {
    const u = log[i], a = log[i + 1];
    if (u.role !== 'user' || a.role !== 'assistant') continue;
    i++;
    if (u.safety || a.safety || a.flagged) continue;
    out.push({ role: 'user', content: u.text }, { role: 'assistant', content: a.text });
  }
  return out.slice(-6);
}

// Ask the coach: streamed. onText(delta, snapshot) as it arrives. Keeps the last few turns. Once it's
// in, the answer is held to the person's numbers like the on-device coach's (GH.coach.grounded): a
// sentence with a number that wasn't sent goes, with a note, and if next to nothing is left the app's
// own answer stands in. An answer cut short by the output limit keeps what came, with a note.
// Resolves { text, raw, note, cut, replaced, cost }.
async function ask(S, day, question, onText) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw coachError('other', 'Type a question first.');
  AI().needConsent(S);
  const past = pastTurns(S);
  const system = AI().systemBlocks(S, day, 'chat');
  // The question ends the part that's cached, so the next one reads this whole conversation back.
  const messages = past.concat([{ role: 'user', content: [{ type: 'text', text: q, cache_control: { type: 'ephemeral' } }] }]);
  try {
    const { msg, shape } = await send(S, day, 'chat', { system, messages }, onText);
    if (msg.stop_reason === 'refusal') throw coachError('refusal');
    const short = msg.stop_reason === 'max_tokens';
    const raw = textOf(msg).trim();
    if (short && !raw) throw coachError('cut');
    const given = [system.map((b) => b.text).join('\n')].concat(past.map((m) => m.content), [q]).join('\n');
    const out = GH.coach && GH.coach.grounded ? GH.coach.grounded(S, day, q, raw, given, '', 'Claude') : { text: raw, note: null, cut: 0, replaced: false };
    const note = short ? [out.note, shape.cut ? 'Cut short to stay within your spending limit.' : 'Cut short: it ran out of room.'].filter(Boolean).join(' ') : out.note;
    const log = SP().data(S).log;
    const cost = log.length ? log[log.length - 1].c : 0;
    S.ai.chat = (S.ai.chat || []).concat([{ role: 'user', text: q, day }, Object.assign({ role: 'assistant', text: out.text, day, cost, model: shape.model }, note ? { note } : {})]).slice(-20);
    return { text: out.text, raw, note, cut: out.cut, replaced: out.replaced, cost };
  } catch (err) {
    throw explain(err);
  }
}

/* ------------------------------------------------------------------ suggestions */
// Claude may only propose the changes the app knows how to apply (checked again by
// GH.coach.validAction before anything is shown), or plain tips. Nothing changes until the person
// taps Apply.
const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['minutes', 'weekday', 'deload', 'volume', 'tip'] },
          title: { type: 'string' },
          why: { type: 'string' },
          minutes: { type: 'integer' },
          from: { type: 'integer' },
          to: { type: 'integer' },
        },
        required: ['kind', 'title', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};
function suggestAsk(S) {
  const p = S.profile;
  const on = B().weekdaysFor(p);
  const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !on.includes(d));
  return [
    'Suggest up to 3 changes that would help with their goals, based on their data. Only these kinds:',
    `- minutes: workout length, 10-60 in steps of 5 (now ${p.minutes}), in "minutes".`,
    `- weekday: move a workout day ("from") to a free day ("to"), 0 = Monday to 6 = Sunday. Workout days: ${on.map((d) => `${d} (${WD[d]})`).join(', ')}. Free: ${free.map((d) => `${d} (${WD[d]})`).join(', ') || 'none'}.`,
    '- deload: a lighter week next week.',
    '- volume: one more weekly set for their top-goal muscles.',
    '- tip: advice that doesn\'t change the plan.',
    'title: under 10 words. why: one sentence under 25 words with their numbers. An empty list if nothing needs changing.',
  ].join('\n');
}
async function suggest(S, day) {
  AI().needConsent(S);
  try {
    const { msg } = await send(S, day, 'suggest', { system: AI().systemBlocks(S, day, 'suggest'), messages: [{ role: 'user', content: suggestAsk(S) }], format: { type: 'json_schema', schema: SUGGEST_SCHEMA } });
    checkStop(msg);
    let data;
    try { data = JSON.parse(textOf(msg)); } catch (e) { throw coachError('other'); }
    const items = (Array.isArray(data.suggestions) ? data.suggestions : []).slice(0, 3).map((x, i) => {
      const action = x.kind === 'minutes' ? { kind: 'minutes', value: x.minutes, label: `Set ${x.minutes} min` }
        : x.kind === 'weekday' ? { kind: 'weekday', from: x.from, to: x.to, label: `Move to ${WD[x.to] || ''}` }
          : x.kind === 'deload' ? { kind: 'deload', label: 'Plan a lighter week' }
            : x.kind === 'volume' ? { kind: 'volume', label: 'Add sets' } : null;
      return { id: `ai-${day}-${i}`, icon: 'sparkle', title: String(x.title || '').trim().slice(0, 80), body: String(x.why || '').trim().slice(0, 240), action };
    }).filter((x) => x.title && (!x.action || (GH.coach && GH.coach.validAction(S, x.action, day))));
    S.ai.suggestions = { day, items };
    return items.length;
  } catch (err) {
    throw explain(err);
  }
}

/* ------------------------------------------------------------------ Tailor my plan */
// Claude reads a request the app's own rules couldn't, into the same shape (GH.tailor checks it
// before anything is shown).
const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const TAILOR_SCHEMA = {
  type: 'object',
  properties: {
    focus: { type: 'array', items: { type: 'string', enum: ['biceps', 'triceps', 'abs', 'chest', 'legs', 'back', 'shoulders'] } },
    muscles: { type: 'array', items: { type: 'string', enum: ['glutes', 'quads', 'hamstrings', 'calves', 'obliques', 'forearms', 'lats', 'upperBack', 'lowerBack', 'rearDelts', 'sideDelts', 'frontDelts', 'hipFlexors'] } },
    goals: { type: 'array', items: { type: 'string', enum: ['fat', 'strength', 'endurance', 'mobility'] } },
    minutes: nullable('integer'),
    days: nullable('integer'),
    avoid_joints: { type: 'array', items: { type: 'string', enum: ['knee', 'shoulder', 'back', 'wrist', 'elbow', 'hip', 'ankle', 'neck'] } },
    no_jumping: nullable('boolean'),
    gentle: nullable('boolean'),
    note: { type: 'string' },
  },
  required: ['focus', 'muscles', 'goals', 'minutes', 'days', 'avoid_joints', 'no_jumping', 'gentle', 'note'],
  additionalProperties: false,
};
async function tailor(S, day, text) {
  AI().needConsent(S);
  const p = S.profile;
  try {
    const { msg } = await send(S, day, 'tailor', {
      system: AI().systemBlocks(S, day, 'tailor'),
      messages: [{ role: 'user', content: [
        'Turn this request about their workout plan into changes. Only what they asked for; leave the rest empty or null.',
        `focus: muscle groups to train more (at most 2). muscles: single muscles to lean toward, when they name one (at most 2). goals: goals to add. minutes: per workout, 10-60 (now ${p.minutes}). days: workouts a week, 2-6 (now ${p.days}).`,
        'avoid_joints: joints to go easy on. no_jumping: true for no jumping. gentle: true for easier, false for harder.',
        'note: one short, friendly sentence on what will change, without numbers you weren\'t given.',
        '', `Their request: ${String(text || '').slice(0, 400)}`,
      ].join('\n') }],
      format: { type: 'json_schema', schema: TAILOR_SCHEMA },
    });
    checkStop(msg);
    return JSON.parse(textOf(msg));
  } catch (err) {
    throw explain(err);
  }
}

/* ------------------------------------------------------------------ the plan features */
// Structured output for a feature that writes its own request and schema: Build me a plan
// (src/customplan.js) and Check my plan (src/planreview.js). o.feature: 'build' or 'review'. The
// caller checks what comes back before anything is shown.
async function json(S, day, prompt, schema, opts) {
  AI().needConsent(S);
  const feature = (opts && opts.feature) || 'build';
  try {
    const { msg } = await send(S, day, feature, { system: AI().systemBlocks(S, day, feature), messages: [{ role: 'user', content: String(prompt || '') }], format: { type: 'json_schema', schema } });
    checkStop(msg);
    return JSON.parse(textOf(msg));
  } catch (err) {
    throw explain(err);
  }
}

GH.claude = { report, ask, suggest, tailor, json, stop, explain, send, SUGGEST_SCHEMA, TAILOR_SCHEMA };
