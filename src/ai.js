/* The AI coach (opt-in): Claude through the official Anthropic SDK. It only ever sees a compact
 * summary with no names, dates or device ids, it only advises (the app's own rules decide the plan),
 * and the key stays on this device.
 *
 * This part is inline and small: the key, the person's OK, the summary and system text (exactly what
 * gets sent, for the preview), the error messages, the model pick and the report helpers. The
 * requests and the SDK are a lazy chunk, src/claude.js (GH.claude), loaded the first time one of the
 * async calls below is made, after the OK and the key are checked: nothing loads before that.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const SECRET = 'anthropic_api_key';
  const KEY_URL = 'https://platform.claude.com/settings/keys';

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
  // An error as one line a person can act on (the chunk knows the SDK's errors; without it loaded,
  // only the app's own).
  function explain(err) {
    if (GH.claude) return GH.claude.explain(err);
    return err && err.code && MESSAGES[err.code] ? err : coachError('other');
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

  /* ------------------------------------------------------------------ the report */
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
  function reportFor(S, day) { const ws = B().weekStart(day); return (S.ai.reports || []).find((r) => r.week === ws) || null; }
  function needsReport(S, day) { return !!(S.ai.enabled && S.ai.consentAt && hasKey() && !reportFor(S, day) && S.log.some((l) => l.type === 'workout')); }
  function clearChat(S) { S.ai.chat = []; }

  /* ------------------------------------------------------------------ requests (lazy) */
  // The chunk with the SDK, once the OK and the key are there (so neither the chunk nor anything else
  // is fetched without them). If it can't load, the person gets the usual one line.
  async function claude(S) {
    needConsent(S);
    if (!hasKey()) throw coachError('nokey');
    try { return await GH.lazy('claude'); } catch (e) { throw coachError('other'); }
  }
  async function report(S, day) { return (await claude(S)).report(S, day); }
  async function ask(S, day, question, onText) {
    if (!String(question || '').trim()) throw coachError('other', 'Type a question first.');
    return (await claude(S)).ask(S, day, question, onText);
  }
  async function suggest(S, day) { return (await claude(S)).suggest(S, day); }
  async function tailor(S, day, text) { return (await claude(S)).tailor(S, day, text); }
  async function json(S, day, prompt, schema, opts) { return (await claude(S)).json(S, day, prompt, schema, opts); }
  // Stops the request in flight (there's none unless the chunk is loaded).
  function stop() { if (GH.claude) GH.claude.stop(); }

  GH.ai = {
    KEY_URL, hasKey, checkKey, setKey, deleteKey, summary, preview, report, reportFor, readReport, needsReport, ask, suggest, tailor, json, stop, clearChat, pickFrom, explain, MESSAGES, SYSTEM, REPORT_SCHEMA,
    // For src/claude.js.
    getKey, needConsent, coachError, systemBlocks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
