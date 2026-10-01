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
  nokey: 'Add your Anthropic API key in Settings, under Coach, to use Claude.',
  auth: 'That API key didn\'t work. Check it in Settings, under Coach.',
  permission: 'This API key can\'t use the coach. Check its permissions in the Claude Console.',
  rate: 'The coach is busy. Try again in a minute.',
  offline: 'You\'re offline. The on-device coach and your insights still work.',
  overloaded: 'The coach is overloaded right now. Try again soon.',
  refusal: 'The coach couldn\'t help with that one. Try asking another way.',
  cut: 'The answer was cut short. Try again.',
  nomodel: 'Couldn\'t find a model for this key. Check the key in the Claude Console.',
  aborted: 'Stopped.',
  consent: 'Claude needs your OK before it gets any of your data. Allow it in Settings, under Coach.',
  other: 'Something went wrong reaching the coach. Try again.',
};
// Nothing goes to Anthropic until the person has seen what gets sent and allowed it.
function needConsent(S) { if (!S || !S.ai || !S.ai.consentAt) throw coachError('consent'); }
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

// Calendar dates that slip in through insight text ("Since Aug 26") become relative.
const noDates = (t) => String(t).replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d)/g, '').replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:, \d{4})?\b/g, 'an earlier date');

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
  const act = st('activeKcal');
  if (act.n) lines.push(`- Active calories: ${r0(act.avg)} kcal a day (${act.n} days)`);
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
  if (p.workouts === false) lines.push('TRAINING: workouts are turned off; they use the app for health and food.');
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
  const F = GH.food;
  if (F && F.full(S)) {
    const t = F.targets(S, day);
    const eaten = [];
    for (let d = day - 7; d < day; d++) { const x = F.totals(S, d); if (x.n || (x.other && x.other.kcal)) eaten.push(x); }
    if (t) lines.push(`- Calorie tracking on: target ${t.kcal} kcal a day (protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g); estimated burn ${t.burn} kcal${t.learned ? ', learned from their logs and weight' : ' from a formula'}`);
    lines.push(`- Eaten: ${eaten.length ? `${r0(eaten.reduce((a, x) => a + x.kcal, 0) / eaten.length)} kcal and ${r0(eaten.reduce((a, x) => a + x.p, 0) / eaten.length)} g protein a day on ${eaten.length} logged days (last week)` : 'nothing logged last week'}`);
  }
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
  return noDates(lines.join('\n'));
}

const SYSTEM = [
  'You are the coach inside Gradient Health, a home workout and health tracking app. You get a summary of one person\'s recent health and training data from their phone.',
  'How to coach:',
  '- Short, plain, specific and warm. Use their numbers. Talk to them as "you".',
  '- You are not a doctor. Never diagnose or name conditions. If something looks concerning (resting heart rate far above normal or over 100, fast weight loss they didn\'t plan, pain that lingers, chest pain, dizziness, fainting), say it\'s worth talking to a doctor.',
  '- No timelines or promises about results (never "abs in 8 weeks").',
  '- No meal plans or diets. If they track calories, the app sets their calorie target from their size, activity and goal: explain it rather than set a different one. Food advice stays simple: protein, easy additions, habits. They may be a picky eater.',
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

// glance: the week's key numbers for the card at the top of the Health tab; focus_one: its single
// "Focus next" line. (Structured outputs don't take length or item-count limits: the ask says how
// short, and readReport trims.)
const GLANCE_TONES = ['good', 'watch', 'neutral'];
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    glance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          value: { type: 'string' },
          trend: { type: 'string' },
          tone: { type: 'string', enum: GLANCE_TONES },
        },
        required: ['metric', 'value', 'trend', 'tone'],
        additionalProperties: false,
      },
    },
    wins: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    focus: { type: 'array', items: { type: 'string' } },
    focus_one: { type: 'string' },
    ask_me: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'glance', 'wins', 'watch', 'focus', 'focus_one', 'ask_me'],
  additionalProperties: false,
};
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
// A report's content as the app shows it: strings trimmed and cut to length, glance items checked.
// Reports saved before glance and focus_one existed come back without them (the card works them out
// from the phone's own numbers).
function readReport(data) {
  const d = data && typeof data === 'object' ? data : {};
  const str = (x, n) => (typeof x === 'string' ? x.trim().replace(/\s+/g, ' ').slice(0, n) : '');
  const clean = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()).map((x) => str(x, 400)).slice(0, 4) : []);
  const glance = (Array.isArray(d.glance) ? d.glance : [])
    .filter((g) => g && typeof g === 'object' && str(g.metric, 24) && str(g.value, 18))
    .slice(0, 4)
    .map((g) => ({ metric: str(g.metric, 24), value: str(g.value, 18), trend: str(g.trend, 18), tone: GLANCE_TONES.includes(g.tone) ? g.tone : 'neutral' }));
  const out = { headline: str(d.headline, 200), wins: clean(d.wins), watch: clean(d.watch), focus: clean(d.focus), ask_me: clean(d.ask_me) };
  if (glance.length) out.glance = glance;
  const one = str(d.focus_one, 90);
  if (one) out.focus_one = one;
  return out;
}

let busy = null;
function stop() { if (busy) { try { busy.abort(); } catch (e) { /* ignore */ } } }

// Weekly report (structured). Saved in S.ai.reports; resolves with the report object.
async function report(S, day) {
  needConsent(S);
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
    const rep = { week: B().weekStart(day), day, createdAt: Date.now(), model: S.ai.model && S.ai.model.name, data: readReport(data) };
    S.ai.reports = (S.ai.reports || []).filter((r) => r.week !== rep.week).concat(rep).slice(-12);
    return rep;
  } catch (err) {
    throw explain(err);
  } finally { busy = null; }
}
function reportFor(S, day) { const ws = B().weekStart(day); return (S.ai.reports || []).find((r) => r.week === ws) || null; }
function needsReport(S, day) { return !!(S.ai.enabled && S.ai.consentAt && hasKey() && !reportFor(S, day) && S.log.some((l) => l.type === 'workout')); }

// Ask the coach: streamed. onText(delta, snapshot) as it arrives. Keeps the last few turns.
async function ask(S, day, question, onText) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) throw coachError('other', 'Type a question first.');
  needConsent(S);
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
  needConsent(S);
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
  needConsent(S);
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
  needConsent(S);
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

GH.ai = { KEY_URL, hasKey, checkKey, setKey, deleteKey, summary, preview, report, reportFor, readReport, needsReport, ask, suggest, tailor, json, stop, clearChat, pickFrom, explain, MESSAGES, SYSTEM, REPORT_SCHEMA };
