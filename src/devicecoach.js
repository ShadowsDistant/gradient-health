/* The on-device coach: a small open model running on the phone (GH.llm, loaded on demand) answers
 * questions about the person's own numbers, and nothing leaves the phone.
 *
 * Small models reason badly from raw numbers, so they don't have to: the app works out the answer's
 * substance itself and hands it over as FACTS with each question (what the built-in coach concludes
 * for that topic, the How it works rule behind it, today's changes), and the model's job is to put
 * it in plain words. The rules and a compact brief of their data (no name, no dates) come first and
 * are the same every turn, so they stay in the model's cache. Questions that sound like an emergency
 * get the built-in safety answer instead of the model's.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const H = () => GH.health;

  // Written for small models: short, concrete, one idea a line.
  const RULES = [
    'You are the coach in Gradient Health, a workout and health app on this person\'s phone.',
    'Answer their question in 2 to 4 short sentences, in plain words. Say "you". No lists, headings or emoji.',
    'FACTS were worked out by the app for this question. Build the answer on them and copy their numbers exactly as written. Don\'t calculate anything yourself.',
    'If FACTS say none, answer from THEIR DATA below, or say you can\'t tell from their data and what they could track. Never make up a number.',
    'Say yes or no plainly when the question asks, and make sure it matches the numbers.',
    'You are not a doctor and never diagnose. Chest pain, fainting, a resting heart rate over 100, unplanned fast weight loss or pain that won\'t go away: tell them to see a doctor.',
    'The app plans the workouts and targets. Explain them; don\'t write new programs, diets or meal plans.',
  ].join('\n');

  const r0 = (x) => String(Math.round(x));
  const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  const GOAL = { abs: 'visible abs', arms: 'bigger arms', chest: 'bigger chest', legs: 'legs and glutes', back: 'back and posture', fat: 'lose fat', strength: 'strength', endurance: 'endurance', mobility: 'mobility', consistency: 'consistency' };

  // The numbers the model sees, one short line each.
  function brief(S, day) {
    const b = B(), h = H(), p = S.profile;
    const lb = p.units !== 'kg';
    const w = (kg) => (lb ? `${r1(kg * b.LB_PER_KG)} lb` : `${r1(kg)} kg`);
    const workouts = p.workouts !== false;
    const L = [];
    const goals = (p.goals || []).map((g) => GOAL[g] || g).join(', ');
    L.push(`Goals: ${goals || 'not set'}.${p.age ? ` Age ${p.age}.` : ''}`);
    // What the plan works around (age band, health conditions). Only this on-device model sees it.
    const around = GH.access && GH.access.briefLine(p);
    if (around) L.push(`The plan is adapted for ${around}. Never give medical advice; suggest a doctor for anything medical.`);
    if (workouts) {
      const where = p.where === 'gym' ? 'at a gym' : p.where === 'both' ? 'at home and at a gym' : 'at home';
      L.push(`Plan: ${p.days} workouts a week, about ${p.minutes} min each, ${where}.`);
      const plan = b.todayPlan(S, day);
      const r = b.readiness(S, day);
      const what = plan.type === 'workout' ? `a workout (${b.templateTitle(plan.units || []).toLowerCase()})` : plan.type === 'done' ? 'a workout, already done' : plan.type === 'light' ? 'a light day (a walk and mobility)' : 'a rest day';
      L.push(`Today: ${what}.${r.reasons.length ? ` The app made it lighter: ${r.reasons.map((x) => x.text).join(' ')}` : ''}`);
    } else L.push('They use the app for health and food, not workouts.');
    const now = (k) => h.stats(S, k, day - 6, day);
    const usual = (k) => h.stats(S, k, day - 34, day - 7);
    const pair = (k, fmt, unit) => {
      const a = now(k), u = usual(k);
      if (!a.n) return null;
      return `${fmt(a.avg)}${unit} on average this week${u.n >= 7 ? ` (usually ${fmt(u.avg)}${unit})` : ''}`;
    };
    const sleep = pair('sleepMin', (m) => b.fmtMin(Math.round(m)), '');
    if (sleep) L.push(`Sleep: ${sleep}.`);
    const steps = pair('steps', r0, ' steps');
    if (steps) L.push(`Steps: ${steps}; daily goal ${b.stepsGoal(S, day).goal}.`);
    const rhr = pair('rhr', r0, ' bpm');
    if (rhr) L.push(`Resting heart rate: ${rhr}.`);
    const hrv = pair('hrv', r0, ' ms');
    if (hrv) L.push(`HRV: ${hrv}.`);
    const kcal = pair('activeKcal', r0, ' kcal');
    if (kcal) L.push(`Active calories: ${kcal}.`);
    const ws = b.weightStats(S, day);
    if (ws.avg7) L.push(`Weight: ${w(ws.avg7)} (7-day average)${ws.rate == null ? '' : Math.abs(ws.rate) < 0.002 ? ', steady on the week before' : `, ${ws.rate >= 0 ? 'up' : 'down'} ${r1(Math.abs(ws.rate * 100))}% on the week before`}. Goal: ${p.weightGoal === 'lose' ? 'lose weight' : p.weightGoal === 'gain' ? 'gain weight' : 'keep it steady'}.`);
    if (workouts) {
      const cal = b.calendar(S, day);
      let planned = 0, done = 0;
      for (let d = day - 28; d < day; d++) { const i = cal.days[d]; if (i && (i.planned === 'workout' || i.missed)) { planned++; if (i.done) done++; } }
      if (planned) L.push(`Workouts: ${done} of ${planned} done in the last 4 weeks; streak ${cal.streak.current} days.`);
      const ratings = { easy: 0, right: 0, hard: 0 };
      for (const l of S.log) if (l.type === 'workout' && l.day > day - 28 && l.checkin && ratings[l.checkin.rating] != null) ratings[l.checkin.rating]++;
      if (ratings.easy + ratings.right + ratings.hard) L.push(`How workouts felt: ${ratings.easy} too easy, ${ratings.right} about right, ${ratings.hard} too hard.`);
      const lv = [];
      for (const fam of ['push', 'squat', 'row', 'curl', 'hinge', 'abs']) {
        const x = b.ladderLevel(S, fam, day);
        if (x) lv.push(`${x.name} ${x.reps}${GH.moves && GH.moves.MOVES[x.rung] && GH.moves.MOVES[x.rung].timed ? ' s' : ' reps'} (level ${x.level} of ${x.of})`);
        if (lv.length >= 4) break;
      }
      if (lv.length) L.push(`Current exercises: ${lv.join('; ')}.`);
      const changes = GH.coach && GH.coach.timeline ? GH.coach.timeline(S, day, 7).slice(0, 3).map((x) => x.text) : [];
      if (changes.length) L.push(`Recent changes by the app: ${changes.map((x) => x.replace(/\.$/, '')).join('; ')}.`);
    }
    const pg = b.proteinGoal(S, day);
    const F = GH.food;
    if (F && F.full(S)) {
      const t = F.targets(S, day);
      const eaten = [];
      for (let d = day - 7; d < day; d++) { const x = F.totals(S, d); if (x.n) eaten.push(x); }
      if (t) L.push(`Food: calorie target ${t.kcal} a day (protein ${t.protein} g, carbs ${t.carbs} g, fat ${t.fat} g).${eaten.length ? ` Ate ${r0(eaten.reduce((a, x) => a + x.kcal, 0) / eaten.length)} kcal and ${r0(eaten.reduce((a, x) => a + x.p, 0) / eaten.length)} g protein a day on ${eaten.length} logged days last week.` : ' Nothing logged last week.'}`);
      const today = F.totals(S, day);
      if (today.n) L.push(`Eaten today so far: ${today.kcal} kcal, ${Math.round(today.p)} g protein.`);
    } else if (pg && p.protein && p.protein.track !== false) {
      let hit = 0, logged = 0;
      for (let d = day - 7; d < day; d++) { const g = b.proteinToday(S, d); if (g) { logged++; if (g >= pg * 0.95) hit++; } }
      L.push(`Protein: goal ${pg} g a day${logged ? `; hit on ${hit} of ${logged} logged days last week` : ''}.`);
    }
    return L.join('\n');
  }

  // The How it works rule behind each of the built-in coach's topics.
  const RULE_FOR = { today: 'sleep', sleep: 'sleep', steps: 'steps', weight: 'weightloss', protein: 'protein', strength: 'overload', streak: 'habits', heart: 'hrv', sides: 'sides', deload: 'deload', abs: 'abs' };
  // The first n sentences ("7.5%" and "e.g. 12" don't end one: only a stop followed by a space does).
  const firstSentences = (t, n) => String(t || '').trim().split(/(?<=[.!?])\s+/).slice(0, n).join(' ');
  // What the app itself can say about this question, one line each: the built-in coach's answer for
  // its topic, the rule behind it, and (for today) what the plan changed and why.
  function facts(S, day, question) {
    const C = GH.coach;
    const L = [];
    const topic = C && C.topicOf ? C.topicOf(question) : null;
    if (!topic || topic === 'redflag') return L;
    try {
      const a = C.ask(S, day, question);
      if (a && a.topic && a.text) L.push(`What the app worked out: ${a.text}`);
    } catch (e) { /* no answer for this one */ }
    const rule = GH.science && RULE_FOR[topic] ? GH.science.RULES.find((r) => r.id === RULE_FOR[topic]) : null;
    if (rule) L.push(`How the app decides (${rule.title}): ${firstSentences(rule.does, 2)} ${firstSentences(rule.why, 1)}`.trim());
    if (topic === 'today' && C.decisions && S.profile.workouts !== false) {
      try {
        // The workout in progress, else today's (as the Coach page shows it). A light day has its
        // own line; a finished or rest day has nothing to explain.
        const b = B();
        const plan = b.todayPlan(S, day);
        const session = S.active && S.active.day === day ? S.active.session : plan.type === 'workout' ? b.buildSession(S, day, plan.tpl, {}) : null;
        if (session || plan.type === 'light') {
          const list = C.decisions(S, day, session).slice(0, 4).map((d) => `${d.text}${d.why ? ` (${d.why.replace(/\.$/, '')})` : ''}`);
          if (list.length) L.push(`Today's changes: ${list.join('; ')}.`);
        }
      } catch (e) { /* the plan isn't there to explain */ }
    }
    return L;
  }
  function turn(S, day, question) {
    const f = facts(S, day, question);
    return `${f.length ? `FACTS\n${f.map((x) => `- ${x}`).join('\n')}` : 'FACTS\n- None for this question.'}\n\nQUESTION\n${question}`;
  }
  // The rules and a brief of their data: the same for every question (until the data changes), so
  // the engines keep it cached and only read each new question.
  const system = (S, day) => `${RULES}\n\nTHEIR DATA\n${brief(S, day)}`;
  // The conversation for the model: rules and data first, then the last exchange, then the question
  // with its facts.
  function messages(S, day, question, keep) {
    const n = keep == null ? 2 : keep; // the last exchange by default
    const past = n > 0 ? (S.ai.deviceChat || []).filter((m) => !m.safety && !m.flagged).slice(-n) : [];
    return [{ role: 'system', content: system(S, day) }]
      .concat(past.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })))
      .concat([{ role: 'user', content: turn(S, day, question) }]);
  }

  function err(message, code) { const e = new Error(message); e.code = code; return e; }
  // The exchange is kept for the next turn and the chat, with the facts the answer was given (the
  // chat's "What it used").
  function record(S, q, text, safety, model, facts, note) {
    const answer = Object.assign({ role: 'assistant', text, safety: !!safety }, model ? { model } : {}, facts && facts.length ? { facts } : {}, note ? { note } : {});
    S.ai.deviceChat = (S.ai.deviceChat || []).concat([{ role: 'user', text: q, safety: !!safety }, answer]).slice(-16);
  }
  // A yes-or-no question the numbers settle starts with the app's own yes or no (GH.coach.verdict),
  // and one built on something that isn't so with the app's correction (GH.coach.correction), both
  // written into the prompt so the model carries on from them: it explains the answer instead of
  // guessing it.
  function lead(S, day, question) {
    const C = GH.coach;
    const v = C && C.verdict ? C.verdict(S, day, question) : null;
    if (v) return `${v},`;
    return (C && C.correction && C.correction(S, day, question)) || '';
  }
  // Every number in an answer should be one the model was given: the check (keepToGiven) and the
  // answer as shown (finish: less any sentence with a number it wasn't given, or the app's own answer
  // with a note when too little is left) live in GH.coach (src/coach.js), shared with Claude's
  // answers and the plan review. { text, cut } and { text, note, cut, replaced }.
  // (start: what the answer was started with, which isn't the model's own words.)
  const keepToGiven = (text, given) => GH.coach.keepToGiven(text, given);
  const finish = (S, day, question, raw, given, start) => GH.coach.grounded(S, day, question, raw, given, start, 'The model');

  // The model to use: the one picked in Settings if it's on the phone, else any that is.
  // Without a pick, a current model (the bigger the better) comes before an older one, and one that
  // ran this phone out of memory comes last.
  function pick(S, have) {
    const ids = (have || []).map((x) => x.id);
    if (S.ai.deviceModel && ids.includes(S.ai.deviceModel)) return S.ai.deviceModel;
    const models = (GH.llm && GH.llm.MODELS) || [];
    const big = S.ai.tooBig || {};
    const rank = (id) => { const i = models.findIndex((m) => m.id === id); const m = models[i]; return (big[id] ? 100 : 0) + (!m ? 99 : m.legacy ? 50 + i : 10 - (m.quality || 0)); };
    return ids.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
  }

  // o: { onToken(piece, textSoFar), onStatus(state, fraction), signal }. The states, in order:
  // 'loading' (the model starting, with a fraction), 'thinking' (waiting its turn), 'reading' (the
  // model reading the question, with a fraction) and 'writing' (the first words are in).
  // Resolves { text, aborted, safety, stats }.
  async function ask(S, day, question, o) {
    const opt = o || {};
    const status = (st, f) => { if (opt.onStatus) { try { opt.onStatus(st, f); } catch (e) { /* a UI bug mustn't stop the answer */ } } };
    const q = String(question || '').trim().slice(0, 600);
    if (!q) throw err('Type a question first.', 'empty');
    if (GH.coach && GH.coach.topicOf(q) === 'redflag') {
      const text = GH.coach.ask(S, day, q).text;
      record(S, q, text, true);
      return { text, safety: true, aborted: false };
    }
    const llm = await GH.lazy('llm');
    const av = llm.available();
    if (!av.ok) throw err(av.reason, 'unavailable');
    const id = pick(S, await llm.installed());
    if (!id) throw err('Download the on-device model first.', 'not-installed');
    const loading = (p) => { if (p && p.total) status('loading', p.loaded / p.total); };
    const cur = llm.loaded();
    if (!cur || cur.id !== id) {
      status('loading', 0);
      await llm.load(id, { onProgress: loading });
    }
    if (opt.signal && opt.signal.aborted) return { text: '', aborted: true };
    status('thinking');
    const f = facts(S, day, q);
    const start = lead(S, day, q);
    let wrote = false;
    let given = '';
    // A low temperature: the answer rewords facts, and small models slip on numbers when it's higher.
    const run = (keep) => {
      const msgs = messages(S, day, q, keep);
      given = msgs.map((m) => m.content).join('\n');
      return llm.chat(msgs, {
        signal: opt.signal, maxTokens: 320, temperature: 0.3, lead: start, onLoadProgress: loading,
        onPrompt: (done, total) => { if (!wrote) status('reading', total ? done / total : 0); },
        onToken: (piece, soFar) => {
          if (!wrote) { wrote = true; status('writing'); }
          if (opt.onToken) opt.onToken(piece, soFar);
        },
      });
    };
    let raw;
    // A long conversation that no longer fits the model's memory: answer this one on its own.
    try { raw = await run(); } catch (e) { if (e && e.code === 'too-long') raw = await run(0); else throw e; }
    // Stopped before it started (waiting behind the warm-up, say) leaves the last chat's stats.
    const st = llm.stats;
    const aborted = !!(opt.signal && opt.signal.aborted) || !!(st && st.aborted);
    // Stopped part way: what it wrote so far, as it is.
    const out = aborted ? { text: String(raw || '').trim(), note: null, cut: 0, replaced: false } : finish(S, day, q, raw, `${given}\n${start}`, start);
    const text = out.text;
    if (text) record(S, q, text, false, id, f, out.note);
    // How fast this model answers on this phone (for the model picker), smoothed over real answers.
    const tps = st && st.id === id && st.tokens >= 8 && text ? st.tokensPerSec : 0;
    if (tps > 0 && !aborted) {
      const sp = S.ai.speed || (S.ai.speed = {});
      sp[id] = sp[id] ? Math.round((sp[id] * 0.7 + tps * 0.3) * 10) / 10 : Math.round(tps * 10) / 10;
    }
    return { text, aborted, stats: st, raw: String(raw || '').trim(), lead: start, note: out.note, cut: out.cut, replaced: out.replaced };
  }
  // A grammar-held answer (the plan review, src/planreview.js): the model the chat would use, loaded
  // if it isn't, then one reply the grammar keeps to the shape the app reads. o: { grammar,
  // maxTokens, temperature, signal, onStatus(state, value) }: 'loading' (a fraction), 'reading' (the
  // prompt, a fraction) and 'writing' (the characters written so far). One answer runs at a time, so
  // it waits for a chat answer in progress. Resolves { raw, aborted, model, stats }.
  async function structured(S, msgs, o) {
    const opt = o || {};
    const status = (st, v) => { if (opt.onStatus) { try { opt.onStatus(st, v); } catch (e) { /* a UI bug mustn't stop the answer */ } } };
    const llm = await GH.lazy('llm');
    const av = llm.available();
    if (!av.ok) throw err(av.reason, 'unavailable');
    const id = pick(S, await llm.installed());
    if (!id) throw err('Download the on-device model first.', 'not-installed');
    const loading = (p) => { if (p && p.total) status('loading', p.loaded / p.total); };
    const cur = llm.loaded();
    if (!cur || cur.id !== id) {
      status('loading', 0);
      await llm.load(id, { onProgress: loading });
    }
    if (opt.signal && opt.signal.aborted) return { raw: '', aborted: true, model: id, stats: null };
    status('reading', 0);
    let wrote = false;
    const raw = await llm.chat(msgs, {
      grammar: opt.grammar, maxTokens: opt.maxTokens || 400, temperature: opt.temperature != null ? opt.temperature : 0.3, signal: opt.signal, onLoadProgress: loading,
      onPrompt: (done, total) => { if (!wrote) status('reading', total ? done / total : 0); },
      onToken: (piece, soFar) => { wrote = true; status('writing', String(soFar || '').length); },
    });
    const st = llm.stats;
    return { raw: String(raw || ''), aborted: !!(opt.signal && opt.signal.aborted) || !!(st && st.aborted), model: id, stats: st };
  }

  // Loads the model and has it read the rules and data ahead of the first question, so the first
  // answer starts sooner (a question asked meanwhile waits for it, then reads only its own turn).
  // Quietly does nothing if the model isn't there.
  async function prime(S, day) {
    try {
      const llm = await GH.lazy('llm');
      if (!llm.available().ok) return false;
      const id = pick(S, await llm.installed());
      if (!id) return false;
      await llm.load(id);
      if (llm.prepare) await llm.prepare(system(S, day));
      return true;
    } catch (e) { return false; }
  }
  function clear(S) { S.ai.deviceChat = []; }

  GH.deviceCoach = { RULES, brief, facts, system, messages, lead, keepToGiven, finish, ask, structured, prime, pick, clear };
})(typeof window !== 'undefined' ? window : globalThis);
