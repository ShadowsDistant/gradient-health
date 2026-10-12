/* The AI coach (opt-in): Claude through the official Anthropic SDK. It only ever sees a compact
 * summary with no names, dates or device ids, it only advises (the app's own rules decide the plan),
 * and the key stays on this device.
 *
 * This part is inline and small: the key, the person's OK, the summary and system text (exactly what
 * gets sent, for the preview), the error messages and the report helpers. Which model answers, how
 * much it thinks and what it may spend are src/spend.js (GH.spend). The requests and the SDK are a
 * lazy chunk, src/claude.js (GH.claude), loaded the first time one of the async calls below is made,
 * after the OK and the key are checked: nothing loads before that.
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
  function deleteKey() { store().deleteSecret(SECRET); }

  /* ------------------------------------------------------------------ errors */
  const MESSAGES = {
    nokey: 'Add your Anthropic API key in Settings, under AI coach, to use Claude.',
    auth: 'That API key didn\'t work. Check it in Settings, under AI coach.',
    permission: 'This API key can\'t use the coach. Check its permissions in the Claude Console.',
    rate: 'The coach is busy. Try again in a minute.',
    offline: 'You\'re offline. The on-device coach and your insights still work.',
    overloaded: 'The coach is overloaded. Try again soon.',
    refusal: 'The coach couldn\'t help with that one. Try asking another way.',
    cut: 'The answer was cut short. Try again.',
    nomodel: 'This key can\'t use that model. Pick another one in Settings, under AI coach.',
    aborted: 'Stopped.',
    consent: 'Claude needs your OK before it gets any of your data. Allow it in Settings, under AI coach.',
    'budget-today': 'That could go over today\'s Claude limit. It resets tomorrow, or raise it in Settings, under AI coach.',
    'budget-month': 'That could go over this month\'s Claude budget. It resets on the 1st, or raise it in Settings, under AI coach.',
    'budget-request': 'That could cost more than your limit for one request. Raise it in Settings, under AI coach, or pick less thinking or a cheaper model.',
    other: 'Something went wrong reaching the coach. Try again.',
  };
  const isBudget = (code) => /^budget-/.test(String(code || ''));
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

  // What each feature sends of the summary: all of it with a question (anything could come up) and for
  // the weekly report; the parts about training for the plan features. Leaving out what a request
  // can't use keeps it smaller, and so cheaper, without making the answer less personal.
  const ALL_PARTS = ['person', 'days', 'weekly', 'training', 'food', 'insights'];
  const PARTS = {
    chat: ALL_PARTS, report: ALL_PARTS, suggest: ALL_PARTS,
    review: ['person', 'days', 'weekly', 'training', 'insights'],
    build: ['person', 'days', 'training'],
    tailor: ['person', 'training'],
  };

  // Everything the coach sees, as plain text: no names, no dates, no ids. Relative weeks only. A line
  // with nothing to say (no weight logged, no ratings yet) is left out rather than sent as dashes.
  // feature: which parts go (PARTS; all of them when it's left out).
  function summary(S, day, feature) {
    const parts = PARTS[feature] || ALL_PARTS;
    const has = (k) => parts.includes(k);
    const b = B(), h = H();
    const p = S.profile;
    const lb = p.units !== 'kg';
    const w = (kg) => (kg == null ? '–' : lb ? `${r1(kg * b.LB_PER_KG)} lb` : `${r1(kg)} kg`);
    const lines = [];
    if (has('person')) {
      const eq = p.equipment || {};
      const kit = [];
      if (eq.db && eq.db.length) kit.push(`dumbbells ${eq.db.join('/')} ${p.units}`);
      if (eq.kb && eq.kb.length) kit.push(`kettlebell ${eq.kb.join('/')} ${p.units}`);
      for (const k of ['ball', 'band', 'bar', 'chair', 'wall', 'towel', 'table']) if (eq[k]) kit.push(k === 'bar' ? 'pull-up bar' : k);
      lines.push('PERSON');
      lines.push(`- Age range: ${ageRange(p.age) || 'not given'}${p.sex ? `; sex: ${p.sex}` : ''}`);
      lines.push(`- Goals, most important first: ${(p.goals || []).map((g) => GOAL_NAMES[g] || g).join(', ') || 'not set'}`);
      lines.push(`- Training history: ${EXP_NAMES[p.experience] || p.experience}; plan: ${p.days} days a week, about ${p.minutes} min`);
      lines.push(`- Equipment: ${kit.join(', ') || 'bodyweight only'}`);
      if ((p.careful || []).length) lines.push(`- Careful with: ${p.careful.join(', ')}`);
      lines.push(`- Weight goal: ${p.weightGoal || 'maintain'}${S.catchup.arm.active ? `; weaker ${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm gets an extra set` : ''}`);
    }

    // 28-day aggregates.
    const st = (key) => h.stats(S, key, day - 27, day);
    if (has('days')) {
      const sl = st('sleepMin'), stp = st('steps'), rhr = st('rhr'), hrv = st('hrv'), act = st('activeKcal');
      const ws = b.weightStats(S, day);
      const out = [];
      if (sl.n) out.push(`- Sleep: ${b.fmtMin(sl.avg)} a night (${sl.n} nights)`);
      if (stp.n) out.push(`- Steps: ${r0(stp.avg)} a day (${stp.n} days)`);
      if (rhr.n || hrv.n) out.push(`- ${[rhr.n ? `Resting heart rate ${r0(rhr.avg)} bpm (${rhr.n} days)` : '', hrv.n ? `HRV ${r0(hrv.avg)} ms (${hrv.n} days)` : ''].filter(Boolean).join('; ')}`);
      if (act.n) out.push(`- Active calories: ${r0(act.avg)} kcal a day (${act.n} days)`);
      if (ws.avg7 != null) out.push(`- Weight: 7-day average ${w(ws.avg7)}${ws.rate != null ? `, ${ws.rate >= 0 ? '+' : ''}${r1(ws.rate * 100)}% vs the week before` : ''}`);
      if (lines.length) lines.push('');
      lines.push('LAST 28 DAYS (averages of the days with data)');
      lines.push(...(out.length ? out : ['- No health data yet']));
    }

    // Weekly series, oldest first, with only the columns that have data.
    if (has('weekly')) {
      const cur = b.weekStart(day);
      const COLS = [['sleep h', 'sleepMin', (x) => r1(x / 60)], ['steps', 'steps', r0], ['resting HR', 'rhr', r0], ['HRV', 'hrv', r0]];
      const rows = [];
      for (let k = 7; k >= 0; k--) {
        const a = cur - k * 7, z = a + 6;
        const vals = COLS.map(([, key]) => h.stats(S, key, a, z));
        const wk = S.weights.filter((x) => x.src !== 'profile' && x.day >= a && x.day <= z).map((x) => x.kg);
        if (!vals.some((v) => v.n) && !wk.length) continue;
        rows.push({ label: k === 0 ? 'this week' : k === 1 ? '1 week ago' : `${k} weeks ago`, vals, wk });
      }
      const used = COLS.map((c, i) => rows.some((r) => r.vals[i].n));
      const weight = rows.some((r) => r.wk.length);
      if (rows.length) {
        lines.push('');
        lines.push(`WEEKLY (oldest first; ${COLS.filter((c, i) => used[i]).map((c) => c[0]).concat(weight ? ['weight'] : []).join(', ')})`);
        for (const r of rows) {
          const cells = COLS.map(([, , f], i) => (used[i] ? (r.vals[i].n ? f(r.vals[i].avg) : '–') : null)).filter((x) => x != null);
          if (weight) cells.push(r.wk.length ? w(r.wk.reduce((x, y) => x + y, 0) / r.wk.length) : '–');
          lines.push(`- ${r.label}: ${cells.join(' | ')}`);
        }
      }
    }

    // Training.
    if (has('training')) {
      const logs = S.log.filter((l) => l.type === 'workout' && l.checkedIn && l.day > day - 28);
      const cal = b.calendar(S, day);
      const cur = b.weekStart(day);
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
      if (ratings.easy + ratings.right + ratings.hard) lines.push(`- Ratings: ${ratings.easy} too easy, ${ratings.right} about right, ${ratings.hard} too hard`);
      if (rir['0'] + rir['12'] + rir['3']) lines.push(`- Reps left in the tank (per exercise): 0 → ${rir['0']}, 1-2 → ${rir['12']}, 3+ → ${rir['3']}`);
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
    }

    // Food and body.
    if (has('food')) {
      const out = [];
      const goal = b.proteinGoal(S, day);
      const logged = [];
      for (let d = day - 14; d < day; d++) if (S.protein[d] && S.protein[d].length) logged.push(b.proteinToday(S, d));
      if (goal || logged.length) out.push(`- Protein goal ${goal ? `${goal} g` : '–'}; hit on ${logged.filter((g) => goal && g >= goal * 0.95).length} of ${logged.length} logged days (last 2 weeks)`);
      const F = GH.food;
      if (F && F.full(S)) {
        const t = F.targets(S, day);
        const eaten = [];
        for (let d = day - 7; d < day; d++) { const x = F.totals(S, d); if (x.n || (x.other && x.other.kcal)) eaten.push(x); }
        if (t) out.push(`- Calorie tracking on: target ${t.kcal} kcal a day (protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g); estimated burn ${t.burn} kcal${t.learned ? ', learned from their logs and weight' : ' from a formula'}`);
        out.push(`- Eaten: ${eaten.length ? `${r0(eaten.reduce((a, x) => a + x.kcal, 0) / eaten.length)} kcal and ${r0(eaten.reduce((a, x) => a + x.p, 0) / eaten.length)} g protein a day on ${eaten.length} logged days (last week)` : 'nothing logged last week'}`);
      }
      const ms = S.measurements || [];
      if (ms.length >= 2) {
        const a = ms[0], z = ms[ms.length - 1];
        const ch = ['waist', 'armL', 'armR', 'chest', 'thigh'].filter((k) => a[k] != null && z[k] != null).map((k) => `${k} ${z[k] - a[k] >= 0 ? '+' : ''}${r1(z[k] - a[k])} cm`);
        if (ch.length) out.push(`- Measurements since the first (${Math.round((z.day - a.day) / 7)} weeks): ${ch.join(', ')}`);
      }
      const ready = b.readiness(S, day);
      if (ready.reasons.length) out.push(`- Today: ${ready.reasons.map((x) => x.text).join(' ')}`);
      if (out.length) { lines.push(''); lines.push('FOOD AND BODY'); lines.push(...out); }
    }

    // What the on-device engine already noticed.
    const top = has('insights') && I() ? I().top(S, day, 5) : [];
    if (top.length) {
      lines.push('');
      lines.push('ON-DEVICE INSIGHTS');
      for (const x of top) lines.push(`- ${x.title}: ${x.body} (${x.evidence})`);
    }
    return noDates(lines.join('\n'));
  }

  // Sent with every request (the persona and its limits), then each feature's own rules.
  const SYSTEM = [
    'You coach one person in Gradient Health, a workout and health tracking app. The app gives you a summary of their recent data from their phone; use their numbers.',
    '- Plain, specific and warm. Talk to them as "you".',
    '- You are not a doctor: never diagnose or name conditions. If something looks concerning (resting heart rate over 100 or far above their usual, weight loss they didn\'t plan, pain that lingers, chest pain, dizziness, fainting), say it\'s worth seeing a doctor.',
    '- No promises or timelines about results (never "abs in 8 weeks").',
    '- No meal plans or diets. The app sets any calorie target from their size, activity and goal: explain it, don\'t replace it. Keep food advice simple: protein, easy additions, habits. They may be a picky eater.',
    '- The app\'s planner sets their sets, reps, levels and lighter weeks, and checks every change to the plan before it\'s made.',
    '- If the data is thin, say so and say what to track.',
  ].join('\n');
  // Short and scannable, drawn as a card (src/ui/md.js), with the app's own charts as embeds.
  const CHAT_RULES = [
    'In this chat you explain their plan and what to focus on. Don\'t write out a different program: the app builds one with you under Build me a plan, and checks this one under Check my plan.',
    'Answer first in one sentence with the key number in **bold**, then at most 3 short "- " points, then a one-line next step if there is one. About 80 words unless they ask for detail. No emoji; ### headings and small tables only in a longer answer.',
    'Embeds, alone on a line, show the app\'s chart of their data: [[sleep]] [[steps]] [[rhr]] [[hrv]] [[weight]] [[protein]] [[workouts]] [[muscles]] [[streak]] [[lift:exercise name]]; add :30d or :90d for longer. Use one or two where they help; the app fills in the numbers.',
  ].join('\n');

  // The system text for a feature: the rules, then the data summary. A question's is cached (the next
  // question within a few minutes reads it back at a fraction of the price), and so is the plan
  // builder's (people often build again); the others go once and skip the cache-write premium.
  const CACHED = new Set(['chat', 'build']);
  function systemBlocks(S, day, feature) {
    const f = feature || 'chat';
    const rules = f === 'chat' ? `${SYSTEM}\n${CHAT_RULES}` : SYSTEM;
    const data = { type: 'text', text: `DATA SUMMARY (from the app; no names, dates or ids)\n\n${summary(S, day, f)}` };
    if (CACHED.has(f)) data.cache_control = { type: 'ephemeral' };
    return [{ type: 'text', text: rules }, data];
  }
  // The exact text that leaves the phone with a question, for the "What gets sent" preview: the most
  // any request sends (the plan features send less of the summary, with their own question).
  function preview(S, day) { return systemBlocks(S, day, 'chat').map((b) => b.text).join('\n\n'); }

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
  // The report's schema and ask, with the plan review folded in when there's a plan to check
  // (src/planreview.js): plan_suggestions and plan_note, which the report keeps as its plan ideas
  // (rep.plan) for the person to look over. { schema, ask (added to the report's), plan }.
  function reportParts(S, day) {
    const R = GH.planReview && GH.planReview.forReport ? GH.planReview.forReport(S, day) : null;
    if (!R) return { schema: REPORT_SCHEMA, ask: '', plan: null };
    const schema = Object.assign({}, REPORT_SCHEMA, {
      properties: Object.assign({}, REPORT_SCHEMA.properties, { plan_suggestions: R.schema, plan_note: { type: 'string' } }),
      required: REPORT_SCHEMA.required.concat(['plan_suggestions', 'plan_note']),
    });
    return { schema, ask: R.ask, plan: R };
  }
  function reportFor(S, day) { const ws = B().weekStart(day); return (S.ai.reports || []).find((r) => r.week === ws) || null; }
  // Health asks for the week's report by itself when it opens: only with Claude on, a workout to
  // report on and room under the spending limits for it (when there isn't, the card says so rather
  // than an error every time Health opens).
  function needsReport(S, day) { return !!(S.ai.enabled && S.ai.consentAt && hasKey() && !reportFor(S, day) && S.log.some((l) => l.type === 'workout') && fits(S, day, 'report')); }
  // A new chat: the next question starts a conversation of its own (src/chats.js).
  function clearChat(S) { S.ai.chatId = null; }

  /* ------------------------------------------------------------------ spending */
  // Whether a feature's usual request fits under the limits now (nothing is held for it).
  function fits(S, day, feature) {
    const sp = GH.spend;
    if (!sp) return true;
    const r = sp.allow(S, day, feature, TYPICAL_CHARS[feature] || 9000);
    if (r.ok) sp.release(r.hold);
    return r.ok;
  }
  const TYPICAL_CHARS = { chat: 4500, report: 16000, review: 14000, build: 11000, suggest: 5000, tailor: 3500 };
  // A request the limits stopped, as one line with the amounts: what's left and what it could cost.
  function budgetError(res) {
    const sp = GH.spend;
    const L = res.limits;
    const left = res.code === 'budget-month' ? L.month.left : res.code === 'budget-today' ? L.today.left : L.request;
    const what = res.code === 'budget-month' ? 'This month\'s Claude budget has' : res.code === 'budget-today' ? 'Today\'s Claude limit has' : 'Your limit for one request is';
    const lead = res.code === 'budget-request' ? `${what} ${sp.money(left)}, and this could cost up to ${sp.money(res.need)}.` : `${what} ${sp.money(left)} left, and this could cost up to ${sp.money(res.need)}.`;
    const tail = res.code === 'budget-month' ? 'It resets on the 1st, or raise it in Settings, under AI coach.' : res.code === 'budget-today' ? 'It resets tomorrow, or raise it in Settings, under AI coach.' : 'Raise it in Settings, under AI coach, or pick less thinking or a cheaper model.';
    const e = coachError(res.code, `${lead} ${tail}`);
    e.budget = { code: res.code, left, need: res.need };
    return e;
  }
  // The model's name for the UI ("Claude Opus 5.5").
  function modelName(S) { return GH.spend ? GH.spend.model(S).name : 'Claude'; }

  /* ------------------------------------------------------------------ requests (lazy) */
  // The chunk with the SDK, once the OK and the key are there (so neither the chunk nor anything else
  // is fetched without them). If it can't load, the person gets the usual one line.
  async function claude(S) {
    needConsent(S);
    if (!hasKey()) throw coachError('nokey');
    try { return await GH.lazy('claude'); } catch (e) { throw coachError('other'); }
  }
  async function report(S, day) { return (await claude(S)).report(S, day); }
  // A question that sounds like an emergency gets the app's own safety answer, as the on-device
  // coach does: nothing is sent, and the exchange is kept marked safety (it isn't sent with later
  // questions either).
  // o.chat: the conversation it goes in (src/chats.js; the open one when it's left out).
  async function ask(S, day, question, onText, o) {
    const q = String(question || '').trim().slice(0, 1000);
    if (!q) throw coachError('other', 'Type a question first.');
    if (GH.coach && GH.coach.topicOf(q) === 'redflag') {
      const text = GH.coach.ask(S, day, q).text;
      if (GH.chats) GH.chats.add(S, GH.chats.target(S, o && o.chat), [{ role: 'user', text: q, engine: 'api', day, safety: true }, { role: 'assistant', text, engine: 'api', day, safety: true }]);
      return { text, safety: true };
    }
    return (await claude(S)).ask(S, day, question, onText, o);
  }
  async function suggest(S, day) { return (await claude(S)).suggest(S, day); }
  async function tailor(S, day, text) { return (await claude(S)).tailor(S, day, text); }
  // o.feature: 'build' (Build me a plan) or 'review' (Check my plan), for the limits and the usage.
  async function json(S, day, prompt, schema, opts) { return (await claude(S)).json(S, day, prompt, schema, opts); }
  // Stops the request in flight (there's none unless the chunk is loaded).
  function stop() { if (GH.claude) GH.claude.stop(); }

  GH.ai = {
    KEY_URL, hasKey, checkKey, setKey, deleteKey, summary, preview, report, reportFor, readReport, reportParts, needsReport, ask, suggest, tailor, json, stop, clearChat, explain, MESSAGES, SYSTEM, REPORT_SCHEMA,
    fits, budgetError, isBudget, modelName,
    // For src/claude.js.
    getKey, needConsent, coachError, systemBlocks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
