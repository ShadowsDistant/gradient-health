/* The AI coach (opt-in): Claude through the official Anthropic SDK, bundled into the page by
 * scripts/build.mjs. It only ever sees a compact summary with no names, dates or device ids, it
 * only advises (the app's own rules decide the plan), and the key stays on this device.
 *
 * The model is not hard-coded: the first call lists the models the key can use and picks the
 * newest Opus that supports adaptive thinking, effort and structured outputs (re-checked weekly).
 */
import Anthropic from '@anthropic-ai/sdk';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const SECRET = 'anthropic_api_key';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const KEY_URL = 'https://platform.claude.com/settings/keys';
const MODEL_TTL_DAYS = 7;

const B = () => GH.brain;
const H = () => GH.health;
const I = () => GH.insights;
const store = () => GH.store;

/* ------------------------------------------------------------------ key */
function getKey() { return (store() && store().loadSecret(SECRET)) || ''; }
function hasKey() { return getKey().length > 0; }
// Returns an error string for keys that can't be right; never echoes the key.
function checkKey(k) {
  const key = String(k || '').trim();
  if (!key) return 'Paste your API key.';
  if (/\s/.test(key)) return 'The key can\'t contain spaces.';
  if (key.length < 20) return 'That key looks too short. Copy the whole key.';
  return null;
}
function setKey(k) {
  const err = checkKey(k);
  if (err) return { ok: false, error: err };
  return { ok: !!store().saveSecret(SECRET, String(k).trim()) };
}
function deleteKey(S) {
  store().deleteSecret(SECRET);
  if (S && S.ai) { S.ai.model = null; }
}

function client() {
  const apiKey = getKey();
  if (!apiKey) throw coachError('nokey');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
}

/* ------------------------------------------------------------------ errors */
const MESSAGES = {
  nokey: 'Add your Anthropic API key in Settings to use the coach.',
  auth: 'That API key didn\'t work. Check it in Settings → AI coach.',
  permission: 'This API key can\'t use the coach. Check its permissions in the Claude Console.',
  rate: 'The coach is busy. Try again in a minute.',
  offline: 'You\'re offline. On-device insights still work.',
  overloaded: 'The coach is overloaded right now. Try again soon.',
  refusal: 'The coach couldn\'t help with that one. Try asking another way.',
  cut: 'The answer was cut short. Try again.',
  nomodel: 'Couldn\'t find a model for this key. Check the key in the Claude Console.',
  aborted: 'Stopped.',
  other: 'Something went wrong reaching the coach. Try again.',
};
function coachError(code, detail) {
  const e = new Error(detail || MESSAGES[code] || MESSAGES.other);
  e.code = code;
  return e;
}
// SDK errors → one line a person can act on. Never includes request headers (the key).
function explain(err) {
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
function supports(m) {
  const c = m && m.capabilities;
  if (!c) return true; // older listings carry no capabilities: assume the newest models can
  const ok = (x) => !!(x && x.supported);
  return ok(c.effort) && ok(c.structured_outputs) && !!(c.thinking && c.thinking.types && ok(c.thinking.types.adaptive));
}
function pickFrom(models) {
  const list = (models || []).filter((m) => m && typeof m.id === 'string' && m.type !== 'alias');
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return list.find((m) => /opus/i.test(m.id) && supports(m)) || list.find(supports) || null;
}
async function model(S, c, day) {
  const cur = S.ai.model;
  if (cur && cur.id && day - (cur.day || 0) < MODEL_TTL_DAYS) return cur.id;
  let picked = null;
  try {
    const page = await c.models.list({ limit: 100 });
    picked = pickFrom(page.data || []);
  } catch (err) {
    if (cur && cur.id && !(err instanceof Anthropic.AuthenticationError)) return cur.id; // keep the last good pick
    throw explain(err);
  }
  if (!picked) throw coachError('nomodel');
  S.ai.model = { id: picked.id, name: picked.display_name || picked.id, day };
  return picked.id;
}

/* ------------------------------------------------------------------ the summary */
function ageRange(age) {
  if (!(age > 0)) return null;
  const bands = [[13, 17], [18, 24], [25, 34], [35, 44], [45, 54], [55, 64]];
  for (const [a, b] of bands) if (age >= a && age <= b) return `${a}-${b}`;
  return age >= 65 ? '65+' : 'under 13';
}
const r0 = (x) => (x == null ? '–' : String(Math.round(x)));
const r1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toFixed(1));
const GOAL_NAMES = { abs: 'visible abs', arms: 'bigger arms', chest: 'bigger chest', legs: 'legs and glutes', back: 'back and posture', fat: 'lose fat', strength: 'overall strength', endurance: 'endurance', mobility: 'mobility', consistency: 'consistency' };
const EXP_NAMES = { never: 'never trained', onoff: 'on and off', lt1: 'under 1 year', '1to3': '1-3 years', '3plus': '3+ years' };

// Everything the coach sees, as plain text: no names, no dates, no ids. Relative weeks only.
function summary(S, day) {
  const b = B(), h = H();
  const p = S.profile;
  const lb = p.units !== 'kg';
  const w = (kg) => (kg == null ? '–' : lb ? `${r1(kg * b.LB_PER_KG)} lb` : `${r1(kg)} kg`);
  const eq = p.equipment || {};
  const kit = [];
  if (eq.db && eq.db.length) kit.push(`dumbbells ${eq.db.join('/')} ${p.units}`);
  if (eq.kb && eq.kb.length) kit.push(`kettlebell ${eq.kb.join('/')} ${p.units}`);
  for (const k of ['ball', 'band', 'bar', 'chair', 'wall', 'towel', 'table']) if (eq[k]) kit.push(k === 'bar' ? 'pull-up bar' : k);
  const lines = [];
  lines.push('PERSON');
  lines.push(`- Age range: ${ageRange(p.age) || 'not given'}${p.sex ? `; sex: ${p.sex}` : ''}`);
  lines.push(`- Goals in priority order: ${(p.goals || []).map((g) => GOAL_NAMES[g] || g).join(', ') || 'not set'}`);
  lines.push(`- Training history: ${EXP_NAMES[p.experience] || p.experience}; plan: ${p.days} days a week, about ${p.minutes} min`);
  lines.push(`- Equipment: ${kit.join(', ') || 'bodyweight only'}`);
  if ((p.careful || []).length) lines.push(`- Careful with: ${p.careful.join(', ')}`);
  lines.push(`- Weight goal: ${p.weightGoal || 'maintain'}; weaker side catch-up: ${S.catchup.arm.active ? `${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm (extra set on)` : 'off'}`);

  // 28-day aggregates.
  const st = (key) => h.stats(S, key, day - 27, day);
  const sl = st('sleepMin'), stp = st('steps'), rhr = st('rhr'), hrv = st('hrv');
  const ws = b.weightStats(S, day);
  lines.push('');
  lines.push('LAST 28 DAYS (averages, days with data)');
  lines.push(`- Sleep: ${sl.n ? b.fmtMin(sl.avg) : '–'} a night (${sl.n} nights)`);
  lines.push(`- Steps: ${stp.n ? r0(stp.avg) : '–'} a day (${stp.n} days)`);
  lines.push(`- Resting heart rate: ${rhr.n ? `${r0(rhr.avg)} bpm` : '–'} (${rhr.n} days); HRV: ${hrv.n ? `${r0(hrv.avg)} ms` : '–'} (${hrv.n} days)`);
  lines.push(`- Weight: 7-day average ${w(ws.avg7)}${ws.rate != null ? `, ${ws.rate >= 0 ? '+' : ''}${r1(ws.rate * 100)}% vs the week before` : ''}`);

  // Weekly series, oldest first.
  lines.push('');
  lines.push('WEEKLY (oldest first; sleep h, steps, resting HR, HRV, weight)');
  const cur = b.weekStart(day);
  for (let k = 7; k >= 0; k--) {
    const a = cur - k * 7, z = a + 6;
    const s1 = h.stats(S, 'sleepMin', a, z), s2 = h.stats(S, 'steps', a, z), s3 = h.stats(S, 'rhr', a, z), s4 = h.stats(S, 'hrv', a, z);
    const wk = S.weights.filter((x) => x.src !== 'profile' && x.day >= a && x.day <= z).map((x) => x.kg);
    if (!s1.n && !s2.n && !s3.n && !s4.n && !wk.length) continue;
    const label = k === 0 ? 'this week' : k === 1 ? '1 week ago' : `${k} weeks ago`;
    lines.push(`- ${label}: ${s1.n ? r1(s1.avg / 60) : '–'} | ${s2.n ? r0(s2.avg) : '–'} | ${s3.n ? r0(s3.avg) : '–'} | ${s4.n ? r0(s4.avg) : '–'} | ${wk.length ? w(wk.reduce((x, y) => x + y, 0) / wk.length) : '–'}`);
  }

  // Training.
  const logs = S.log.filter((l) => l.type === 'workout' && l.checkedIn && l.day > day - 28);
  const cal = b.calendar(S, day);
  let planned = 0, doneN = 0;
  for (let d = day - 28; d < day; d++) { const i = cal.days[d]; if (i && (i.planned === 'workout' || i.missed)) { planned++; if (i.done) doneN++; } }
  const ratings = { easy: 0, right: 0, hard: 0 };
  for (const l of logs) if (l.checkin && ratings[l.checkin.rating] != null) ratings[l.checkin.rating]++;
  const rir = { '0': 0, '12': 0, '3': 0 };
  for (const l of logs) for (const it of l.items || []) if (it.rir && rir[it.rir] != null) rir[it.rir]++;
  lines.push('');
  lines.push('TRAINING (last 4 weeks)');
  lines.push(`- Workouts: ${doneN} of ${planned} planned done; streak ${cal.streak.current} days; full weeks in a row ${cal.streak.weekly}`);
  lines.push(`- Ratings: ${ratings.easy} too easy, ${ratings.right} about right, ${ratings.hard} too hard`);
  lines.push(`- Reps left in the tank (per exercise): 0 → ${rir['0']}, 1-2 → ${rir['12']}, 3+ → ${rir['3']}`);
  const week = cal.weeks[cur];
  if (week) lines.push(`- This week's phase: ${week.phase.deload ? 'deload (about 40% less volume)' : week.phase.onramp ? 'on-ramp (lighter start)' : 'normal'}`);
  const lastWs = cur - 7;
  if (lastWs >= b.weekStart(p.startDay)) {
    const sets = b.weeklySets(S, lastWs + 6);
    lines.push(`- Sets last week (done/target): ${Object.entries(sets).map(([g, v]) => `${g} ${v.done}/${v.target}`).join(', ')}`);
  }
  const lv = [];
  for (const fam of ['push', 'curl', 'triceps', 'squat', 'hinge', 'row', 'abs']) { const x = b.ladderLevel(S, fam, day); if (x) lv.push(`${x.name} (level ${x.level} of ${x.of}, ${x.reps}${GH.moves && GH.moves.MOVES[x.rung] && GH.moves.MOVES[x.rung].timed ? ' s' : ' reps'})`); }
  if (lv.length) lines.push(`- Current moves: ${lv.join('; ')}`);
  const tests = (S.catchup.arm.tests || []).map((t) => `${Math.round(t.gap * 100)}%`);
  if (tests.length) lines.push(`- Left/right curl gap over time: ${tests.join(' → ')}`);
  const pain = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
  if (pain.length) lines.push(`- Resting sore joints: ${pain.join(', ')}`);

  // Food and body.
  const goal = b.proteinGoal(S, day);
  const logged = [];
  for (let d = day - 14; d < day; d++) if (S.protein[d] && S.protein[d].length) logged.push(b.proteinToday(S, d));
  lines.push('');
  lines.push('FOOD AND BODY');
  lines.push(`- Protein goal ${goal ? `${goal} g` : '–'}; hit on ${logged.filter((g) => goal && g >= goal * 0.95).length} of ${logged.length} logged days (last 2 weeks)`);
  const ms = S.measurements || [];
  if (ms.length >= 2) {
    const a = ms[0], z = ms[ms.length - 1];
    const ch = ['waist', 'armL', 'armR', 'chest', 'thigh'].filter((k) => a[k] != null && z[k] != null).map((k) => `${k} ${z[k] - a[k] >= 0 ? '+' : ''}${r1(z[k] - a[k])} cm`);
    if (ch.length) lines.push(`- Measurements since the first (${Math.round((z.day - a.day) / 7)} weeks): ${ch.join(', ')}`);
  }
  const ready = b.readiness(S, day);
  if (ready.reasons.length) lines.push(`- Today: ${ready.reasons.map((x) => x.text).join(' ')}`);

  // What the on-device engine already noticed.
  const top = I() ? I().top(S, day, 5) : [];
  if (top.length) {
    lines.push('');
    lines.push('ON-DEVICE INSIGHTS');
    for (const x of top) lines.push(`- ${x.title}: ${x.body} (${x.evidence})`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  'You are the coach inside Gradient, a home workout and health tracking app. You get a summary of one person\'s recent health and training data from their phone.',
  'How to coach:',
  '- Short, plain, specific and warm. Use their numbers. Talk to them as "you".',
  '- You are not a doctor. Never diagnose or name conditions. If something looks concerning (resting heart rate far above normal or over 100, fast weight loss they didn\'t plan, pain that lingers, chest pain, dizziness, fainting), say it\'s worth talking to a doctor.',
  '- No timelines or promises about results (never "abs in 8 weeks").',
  '- No meal plans, calorie targets or diets. Food advice stays simple: protein, easy additions, habits. They may be a picky eater.',
  '- The app decides the training plan (sets, reps, levels, deloads, swaps). You can explain it and say what to focus on, but don\'t prescribe a different program or new exercises.',
  '- If the data is thin, say so and suggest what to track.',
  '- No emoji, no headings. Keep answers under 150 words unless asked for more.',
].join('\n');

function systemBlocks(S, day) {
  return [
    { type: 'text', text: SYSTEM },
    { type: 'text', text: `DATA SUMMARY (from the app; no names, dates or ids)\n\n${summary(S, day)}`, cache_control: { type: 'ephemeral' } },
  ];
}
// The exact text that leaves the phone, for the "What gets sent" preview.
function preview(S, day) { return systemBlocks(S, day).map((b) => b.text).join('\n\n'); }

/* ------------------------------------------------------------------ requests */
function baseParams(modelId, maxTokens, effort, S, day) {
  return {
    model: modelId,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system: systemBlocks(S, day),
  };
}
function textOf(msg) { return (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''); }
function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw coachError('refusal');
  if (msg.stop_reason === 'max_tokens') throw coachError('cut');
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    wins: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    focus: { type: 'array', items: { type: 'string' } },
    ask_me: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'wins', 'watch', 'focus', 'ask_me'],
  additionalProperties: false,
};
const REPORT_ASK = 'Write this week\'s report. headline: one sentence on how the week went. wins: 1-3 specific things that went well. watch: 0-3 things to keep an eye on (health or training). focus: 1-3 concrete things to do next week that fit the app\'s plan. ask_me: 2-3 short questions they might want to ask you next. Each item one sentence, under 25 words, using their numbers.';

let busy = null;
function stop() { if (busy) { try { busy.abort(); } catch (e) { /* ignore */ } } }

// Weekly report (structured). Saved in S.ai.reports; resolves with the report object.
async function report(S, day) {
  const c = client();
  try {
    const modelId = await model(S, c, day);
    const stream = c.beta.messages.stream(Object.assign(baseParams(modelId, 12000, 'high', S, day), {
      output_config: { effort: 'high', format: { type: 'json_schema', schema: REPORT_SCHEMA } },
      messages: [{ role: 'user', content: REPORT_ASK }],
    }));
    busy = stream;
    const msg = await stream.finalMessage();
    checkStop(msg);
    let data;
    try { data = JSON.parse(textOf(msg)); } catch (e) { throw coachError('other'); }
    const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 4) : []);
    const rep = { week: B().weekStart(day), day, createdAt: Date.now(), model: S.ai.model && S.ai.model.name, data: { headline: String(data.headline || '').trim(), wins: clean(data.wins), watch: clean(data.watch), focus: clean(data.focus), ask_me: clean(data.ask_me) } };
    S.ai.reports = (S.ai.reports || []).filter((r) => r.week !== rep.week).concat(rep).slice(-12);
    return rep;
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}
function reportFor(S, day) { const ws = B().weekStart(day); return (S.ai.reports || []).find((r) => r.week === ws) || null; }
function needsReport(S, day) { return !!(S.ai.enabled && hasKey() && !reportFor(S, day) && S.log.some((l) => l.type === 'workout')); }

// Ask the coach: streamed. onText(delta, snapshot) as it arrives. Keeps the last few turns.
async function ask(S, day, question, onText) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw coachError('other', 'Type a question first.');
  const c = client();
  const history = (S.ai.chat || []).slice(-6).map((m) => ({ role: m.role, content: m.text }));
  try {
    const modelId = await model(S, c, day);
    const stream = c.beta.messages.stream(Object.assign(baseParams(modelId, 6000, 'medium', S, day), {
      messages: history.concat([{ role: 'user', content: q }]),
    }));
    busy = stream;
    if (onText) stream.on('text', (delta, snapshot) => { try { onText(delta, snapshot); } catch (e) { /* UI errors stay in the UI */ } });
    const msg = await stream.finalMessage();
    checkStop(msg);
    const text = textOf(msg).trim();
    S.ai.chat = (S.ai.chat || []).concat([{ role: 'user', text: q, day }, { role: 'assistant', text, day }]).slice(-20);
    return { text };
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}
function clearChat(S) { S.ai.chat = []; }

GH.ai = { KEY_URL, hasKey, checkKey, setKey, deleteKey, summary, preview, report, reportFor, needsReport, ask, stop, clearChat, pickFrom, explain, MESSAGES, SYSTEM };
