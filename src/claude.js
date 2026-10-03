/* The Claude requests, with the official Anthropic SDK: a lazy chunk (GH.lazy('claude'), built into
 * dist/lazy/claude.js by scripts/build.mjs), so the SDK isn't parsed at every launch. It loads the
 * first time GH.ai asks Claude something, after GH.ai has checked the person's OK and the key.
 *
 * Everything that doesn't need the SDK stays in src/ai.js and is read from GH.ai: the key, consent,
 * the summary and system text (what gets sent), the error messages and the report helpers.
 *
 * The model is not hard-coded: the first call lists the models the key can use and picks the
 * newest Opus that supports adaptive thinking, effort and structured outputs (re-checked weekly).
 */
import Anthropic from '@anthropic-ai/sdk';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MODEL_TTL_DAYS = 7;

const AI = () => GH.ai;
const B = () => GH.brain;
const coachError = (code, detail) => AI().coachError(code, detail);

function client() {
  const apiKey = AI().getKey();
  if (!apiKey) throw coachError('nokey');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
}

/* ------------------------------------------------------------------ errors */
// SDK errors → one line a person can act on. Never includes request headers (the key).
function explain(err) {
  const MESSAGES = AI().MESSAGES;
  if (err && err.code && MESSAGES[err.code] && !(err instanceof Anthropic.APIError)) return err;
  if (err instanceof Anthropic.APIUserAbortError) return coachError('aborted');
  if (err instanceof Anthropic.AuthenticationError) return coachError('auth');
  if (err instanceof Anthropic.PermissionDeniedError) return coachError('permission');
  if (err instanceof Anthropic.RateLimitError) return coachError('rate');
  if (err instanceof Anthropic.APIConnectionError) return coachError('offline');
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || err.status >= 500) return coachError('overloaded');
    const apiMsg = err.error && err.error.error && err.error.error.message;
    if (err.status === 400 && apiMsg && /credit|billing|balance/i.test(apiMsg)) return coachError('other', apiMsg);
    return coachError('other');
  }
  return coachError('other');
}

/* ------------------------------------------------------------------ model */
async function model(S, c, day) {
  const cur = S.ai.model;
  if (cur && cur.id && day - (cur.day || 0) < MODEL_TTL_DAYS) return cur.id;
  let picked = null;
  try {
    const page = await c.models.list({ limit: 100 });
    picked = AI().pickFrom(page.data || []);
  } catch (err) {
    if (cur && cur.id && !(err instanceof Anthropic.AuthenticationError)) return cur.id; // keep the last good pick
    throw explain(err);
  }
  if (!picked) throw coachError('nomodel');
  S.ai.model = { id: picked.id, name: picked.display_name || picked.id, day };
  return picked.id;
}

/* ------------------------------------------------------------------ requests */
function baseParams(modelId, maxTokens, effort, S, day) {
  return {
    model: modelId,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: AI().systemBlocks(S, day),
  };
}
function textOf(msg) { return (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''); }
function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw coachError('refusal');
  if (msg.stop_reason === 'max_tokens') throw coachError('cut');
}

const REPORT_ASK = [
  'Write this week\'s report. It\'s shown as a small card, so keep every part short and plain.',
  'headline: one short sentence on how the week went, under 10 words.',
  'glance: 2-4 of their key numbers this week, in this order when they have data: sleep, steps, resting heart rate, weight (HRV, workouts or activity if one is missing). metric: its name, 1-2 words ("Sleep", "Steps", "Resting HR", "Weight"). value: this week\'s average with its unit, as they\'d read it ("7 h 05", "8.2k", "58 bpm", "149.6 lb"). trend: the change against their usual, starting with + or - ("+20 min", "-9%", "-0.3 lb"), or "steady". tone: good, watch or neutral for that change.',
  'wins: 1-3 specific things that went well, under 8 words each, no full stop ("New best: 30 kettlebell deadlift").',
  'watch: 0-3 things to keep an eye on (health or training), one sentence each, under 25 words.',
  'focus: 1-3 concrete things to do next week that fit the app\'s plan, one sentence each, under 25 words.',
  'focus_one: the single most useful of those, under 8 words ("Keep a steady bedtime").',
  'ask_me: 2-3 short questions they might want to ask you next.',
  'Use their numbers.',
].join('\n');

let busy = null;
function stop() { if (busy) { try { busy.abort(); } catch (e) { /* ignore */ } } }

// Weekly report (structured). Saved in S.ai.reports; resolves with the report object. With a plan to
// check, the plan review rides along (GH.ai.reportParts): its ideas are kept on the report as
// rep.plan, already held to the numbers that were sent, for the person to look over.
async function report(S, day) {
  AI().needConsent(S);
  const c = client();
  // The plan review is a part of its own (src/ui/lazy.js): it's in before the report asks it for the
  // plan's part, or the report goes without plan ideas, as it would without a plan.
  if (GH.lazy) await GH.lazy('review').catch(() => null);
  let parts = AI().reportParts ? AI().reportParts(S, day) : { schema: AI().REPORT_SCHEMA, ask: '', plan: null };
  let ask = parts.ask ? `${REPORT_ASK}\n\n${parts.ask}` : REPORT_ASK;
  try {
    const modelId = await model(S, c, day);
    let params;
    const send = async () => {
      params = baseParams(modelId, 12000, 'high', S, day);
      const stream = c.beta.messages.stream(Object.assign(params, {
        output_config: { effort: 'high', format: { type: 'json_schema', schema: parts.schema } },
        messages: [{ role: 'user', content: ask }],
      }));
      busy = stream;
      return stream.finalMessage();
    };
    let msg;
    try { msg = await send(); } catch (err) {
      // The plan ideas make the schema the person's own (their moves and days); should the API ever
      // turn it down (a schema too complex to compile is a 400), the report goes without them.
      if (!(parts.plan && err instanceof Anthropic.BadRequestError)) throw err;
      parts = { schema: AI().REPORT_SCHEMA, ask: '', plan: null };
      ask = REPORT_ASK;
      msg = await send();
    }
    checkStop(msg);
    let data;
    try { data = JSON.parse(textOf(msg)); } catch (e) { throw coachError('other'); }
    const rep = { week: B().weekStart(day), day, createdAt: Date.now(), model: S.ai.model && S.ai.model.name, data: AI().readReport(data) };
    if (parts.plan && GH.planReview) {
      try { rep.plan = GH.planReview.fromReport(S, day, data, parts.plan, `${params.system.map((b) => b.text).join('\n')}\n${ask}`); } catch (e) { /* the report stands without its plan ideas */ }
    }
    S.ai.reports = (S.ai.reports || []).filter((r) => r.week !== rep.week).concat(rep).slice(-12);
    return rep;
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}

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
// own answer stands in. Resolves { text, raw, note, cut, replaced }.
async function ask(S, day, question, onText) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw coachError('other', 'Type a question first.');
  AI().needConsent(S);
  const c = client();
  const past = pastTurns(S);
  try {
    const modelId = await model(S, c, day);
    const params = baseParams(modelId, 6000, 'medium', S, day);
    const stream = c.beta.messages.stream(Object.assign(params, {
      messages: past.concat([{ role: 'user', content: q }]),
    }));
    busy = stream;
    if (onText) stream.on('text', (delta, snapshot) => { try { onText(delta, snapshot); } catch (e) { /* UI errors stay in the UI */ } });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const raw = textOf(msg).trim();
    const given = [params.system.map((b) => b.text).join('\n')].concat(past.map((m) => m.content), [q]).join('\n');
    const out = GH.coach && GH.coach.grounded ? GH.coach.grounded(S, day, q, raw, given, '', 'Claude') : { text: raw, note: null, cut: 0, replaced: false };
    S.ai.chat = (S.ai.chat || []).concat([{ role: 'user', text: q, day }, Object.assign({ role: 'assistant', text: out.text, day }, out.note ? { note: out.note } : {})]).slice(-20);
    return { text: out.text, raw, note: out.note, cut: out.cut, replaced: out.replaced };
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}

// Suggestions: Claude may only propose the changes the app knows how to apply (checked again by
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
    'Suggest up to 3 changes that would help this person with their goals, based on their data. Use only these kinds:',
    `- minutes: planned workout length, 10-60 in steps of 5 (now ${p.minutes}). Put the value in "minutes".`,
    `- weekday: move a workout day ("from") to a free day ("to"), 0 = Monday to 6 = Sunday. Workout days now: ${on.map((d) => `${d} (${WD[d]})`).join(', ')}. Free days: ${free.map((d) => `${d} (${WD[d]})`).join(', ') || 'none'}.`,
    '- deload: a lighter week next week.',
    '- volume: one more weekly set for their top-goal muscles.',
    '- tip: advice that doesn\'t change the plan.',
    'title: under 10 words. why: one sentence under 25 words using their numbers. Return an empty list if nothing needs changing.',
  ].join('\n');
}
async function suggest(S, day) {
  AI().needConsent(S);
  const c = client();
  try {
    const modelId = await model(S, c, day);
    const stream = c.beta.messages.stream(Object.assign(baseParams(modelId, 8000, 'medium', S, day), {
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
      messages: [{ role: 'user', content: suggestAsk(S) }],
    }));
    busy = stream;
    const msg = await stream.finalMessage();
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
  } finally { busy = null; }
}

// Tailor my plan: Claude reads a request the app's own rules couldn't, into the same shape
// (GH.tailor checks it before anything is shown).
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
  const c = client();
  const p = S.profile;
  try {
    const modelId = await model(S, c, day);
    const stream = c.beta.messages.stream(Object.assign(baseParams(modelId, 2000, 'low', S, day), {
      output_config: { effort: 'low', format: { type: 'json_schema', schema: TAILOR_SCHEMA } },
      messages: [{ role: 'user', content: [
        'Turn this request about their workout plan into changes. Only include what they asked for; leave the rest empty or null.',
        `focus: muscle groups to train more (at most 2). muscles: single muscles to lean toward, when they name one (calves, rear delts; at most 2). goals: goals to add. minutes: per workout, 10-60 (now ${p.minutes}). days: workouts a week, 2-6 (now ${p.days}).`,
        'avoid_joints: joints to go easy on. no_jumping: true if they want no jumping. gentle: true for easier, false for harder.',
        'note: one short, friendly sentence saying what will change, without numbers you weren\'t given.',
        '', `Their request: ${String(text || '').slice(0, 400)}`,
      ].join('\n') }],
    }));
    busy = stream;
    const msg = await stream.finalMessage();
    checkStop(msg);
    return JSON.parse(textOf(msg));
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}

// Structured output for a feature that writes its own request and schema (Build me a plan in
// src/customplan.js): the same consent, privacy summary and model as the rest. The caller checks
// what comes back before anything is shown.
async function json(S, day, prompt, schema, opts) {
  AI().needConsent(S);
  const c = client();
  const o = opts || {};
  try {
    const modelId = await model(S, c, day);
    const stream = c.beta.messages.stream(Object.assign(baseParams(modelId, o.maxTokens || 4000, o.effort || 'low', S, day), {
      output_config: { effort: o.effort || 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: String(prompt || '') }],
    }));
    busy = stream;
    const msg = await stream.finalMessage();
    checkStop(msg);
    return JSON.parse(textOf(msg));
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}

GH.claude = { report, ask, suggest, tailor, json, stop, explain, model, SUGGEST_SCHEMA, TAILOR_SCHEMA };
