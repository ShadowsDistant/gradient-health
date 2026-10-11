/* The built-in coach: a weekly report and answers to common questions, worked out on the phone
 * from your own numbers. No network and no AI model: it picks from what the brain, the health
 * records and the insights engine already know, and says so when the data is thin.
 *
 * It also writes the hand-off for "Ask in the Claude app": your question plus the same privacy-
 * safe summary the API coach uses, for the Claude app to answer with your own Claude plan.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const H = () => GH.health;
  const I = () => GH.insights;

  const hrs = (min) => B().fmtMin(Math.round(min));
  const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;
  // Made once, on first use (toLocaleString makes a formatter every call).
  let INT = null;
  const int = (n) => (INT || (INT = new Intl.NumberFormat('en-US'))).format(n);
  const round = (v, d) => { const f = Math.pow(10, d || 0); return Math.round(v * f) / f; };
  function weightText(S, kg) {
    if (kg == null) return '–';
    const lb = S.profile.units !== 'kg';
    return lb ? `${round(kg * B().LB_PER_KG, 1)} lb` : `${round(kg, 1)} kg`;
  }
  const list = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);

  /* ---------------------------------------------------------------- facts */
  // Everything both the report and the answers draw on, worked out once.
  function facts(S, day) {
    const b = B(), h = H();
    const cal = b.calendar(S, day);
    const ws = b.weekStart(day);
    const week = cal.weeks[ws] || null;
    let planned = 0, done = 0, missed = 0;
    for (let d = ws; d <= day; d++) {
      const i = cal.days[d];
      if (!i) continue;
      if (i.planned === 'workout' || i.missed) { if (d < day || i.done) planned++; if (i.done && i.planned === 'workout') done++; if (i.missed) missed++; }
    }
    const logs = S.log.filter((l) => l.type === 'workout' && l.checkedIn);
    const recent = logs.filter((l) => l.day > day - 28);
    const rir = { '0': 0, '12': 0, '3': 0 };
    for (const l of recent) for (const it of l.items || []) if (it.rir && rir[it.rir] != null) rir[it.rir]++;
    const rirN = rir['0'] + rir['12'] + rir['3'];
    const ratings = { easy: 0, right: 0, hard: 0 };
    for (const l of recent) if (l.checkin && ratings[l.checkin.rating] != null) ratings[l.checkin.rating]++;
    const ups = [];
    for (const l of logs) if (l.day >= ws - 7) for (const c of l.celebrate || []) ups.push(c);
    const sleep7 = h.stats(S, 'sleepMin', day - 6, day), sleepBase = h.stats(S, 'sleepMin', day - 34, day - 7);
    const steps7 = h.stats(S, 'steps', day - 6, day), stepsBase = h.stats(S, 'steps', day - 34, day - 7);
    const rhr7 = h.stats(S, 'rhr', day - 6, day), rhrBase = h.stats(S, 'rhr', day - 34, day - 7);
    const hrv7 = h.stats(S, 'hrv', day - 6, day), hrvBase = h.stats(S, 'hrv', day - 34, day - 7);
    const goal = b.proteinGoal(S, day);
    let proteinDays = 0, proteinHit = 0;
    for (let d = day - 7; d < day; d++) if (S.protein[d] && S.protein[d].length) { proteinDays++; if (goal && b.proteinToday(S, d) >= goal * 0.95) proteinHit++; }
    const tests = (S.catchup.arm.tests || []).slice();
    return {
      cal, week, ws, planned, done, missed, streak: cal.streak, logs, recent, rir, rirN, ratings, ups,
      sleep7, sleepBase, steps7, stepsBase, rhr7, rhrBase, hrv7, hrvBase,
      weight: b.weightStats(S, day), goal, proteinDays, proteinHit, tests, readiness: b.readiness(S, day),
      insights: I() ? I().top(S, day, 6) : [],
    };
  }

  /* ---------------------------------------------------------------- weekly report */
  // This week's key numbers, for the top of the report: up to four of sleep, steps, resting heart
  // rate and weight (HRV, workouts or active calories stand in for one that's missing), each as the
  // week's average with its trend against the person's usual and a tone (good | watch | neutral).
  // Fewer than two means there isn't enough yet: none.
  // → [{ key, metric, value, trend: "+20 min" | "-9%" | "steady" | "", dir, tone }]
  function glance(S, day, f0) {
    const h = H();
    const out = [];
    if (!h || !h.versus) return out;
    const f = f0 || facts(S, day);
    const workouts = S.profile.workouts !== false;
    for (const key of ['sleepMin', 'steps', 'rhr', 'weightKg', 'hrv', 'workouts', 'activeKcal']) {
      if (out.length >= 4) break;
      if (key === 'workouts') {
        if (!workouts || !(f.planned || f.done)) continue;
        const of = Math.max(f.planned, f.done);
        out.push({ key, metric: 'Workouts', value: `${f.done} of ${of}`, trend: f.missed ? `${f.missed} missed` : 'on plan', dir: null, tone: f.missed ? 'watch' : 'good' });
        continue;
      }
      const v = h.versus(S, key, day, 'week');
      if (!v || v.n < (key === 'weightKg' ? 1 : 3)) continue;
      const m = h.METRICS[key];
      out.push({ key, metric: m.short, value: h.format(S, key, v.value, { compact: true }), trend: v.usual == null ? '' : v.dir === 'flat' ? 'steady' : h.formatDelta(S, key, v.delta, v.rel), dir: v.dir, tone: v.tone });
    }
    return out.length >= 2 ? out : [];
  }
  // Wins go on small badges: no closing full stop, no repeats (an insight often says the same).
  const winText = (t) => String(t || '').trim().replace(/\.$/, '');
  const sameWin = (a, b) => winText(a).toLowerCase().replace(/[^a-z0-9]/g, '') === winText(b).toLowerCase().replace(/[^a-z0-9]/g, '');

  // Same shape as the API coach's report: headline, wins, watch, focus, ask_me, plus glance (the
  // numbers above) and focus_one (the one thing to do next, short enough for a single line).
  function report(S, day) {
    const f = facts(S, day);
    const wins = [], watch = [], focus = [], focusShort = [];
    const addFocus = (short, long) => { focusShort.push(short); focus.push(long); };
    let headline;
    const workouts = S.profile.workouts !== false;
    const F = GH.food && GH.food.full(S) ? GH.food : null;
    let foodDays = 0;
    if (F) for (let d = day - 7; d < day; d++) if (F.totals(S, d).n) foodDays++;
    // One short sentence; anything more goes to the lists below.
    if (!workouts) {
      // Health (and food) only: the headline is about the week's numbers.
      if (F && foodDays >= 3) headline = `Food logged on ${foodDays} of the last 7 days.`;
      else if (f.sleep7.n >= 4) headline = `Sleep is averaging ${hrs(f.sleep7.avg)} a night.`;
      else if (f.steps7.n >= 3) headline = `About ${int(Math.round(f.steps7.avg))} steps a day this week.`;
      else { headline = 'A quiet week so far.'; addFocus('Log your weight and sleep', 'Log your weight and sleep, or connect Health Connect, and this fills in.'); }
    } else if (!f.logs.length) { headline = 'Your first workout counts most.'; addFocus('Do your first workout', 'Do your first workout. The plan starts easy on purpose.'); }
    else if (f.week && f.week.phase.deload) headline = 'Deload week: lighter on purpose.';
    else if (f.planned && f.done === f.planned) headline = f.done === 1 ? 'One workout in, right on plan.' : `Every workout so far: ${f.done} of ${f.done}.`;
    else if (f.missed) headline = `${f.missed === 1 ? 'One workout' : `${f.missed} workouts`} missed this week.`;
    else if (f.streak.current >= 7) headline = `${f.streak.current} days in a row. That's a habit forming.`;
    else headline = 'A steady week so far.';

    // Wins.
    const win = (t) => { if (wins.length < 3 && t && !wins.some((w) => sameWin(w, t))) wins.push(winText(t)); };
    if (workouts) {
      for (const c of f.ups.slice(-2)) win(c.text);
      if (f.streak.weekly >= 2) win(`${f.streak.weekly} full weeks in a row`);
      else if (f.streak.current >= 3) win(`${f.streak.current}-day streak`);
    }
    if (f.goal && f.proteinDays >= 3 && f.proteinHit >= Math.max(3, f.proteinDays - 1)) win(`Protein goal hit ${f.proteinHit} of ${f.proteinDays} days`);
    if (f.tests.length >= 2 && f.tests[f.tests.length - 1].gap < f.tests[0].gap - 0.02) win(`Arm gap down from ${pct(f.tests[0].gap)} to ${pct(f.tests[f.tests.length - 1].gap)}`);
    for (const x of f.insights) if (x.tone === 'good') win(x.title);

    // Things to keep an eye on.
    if (workouts && f.week && f.week.phase.deload) watch.push('Less volume this week on purpose, so you come back fresher.');
    if (workouts && f.missed) watch.push('The plan moved forward, so the next workout picks up where you left off.');
    for (const x of f.insights) if ((x.tone === 'watch' || x.tone === 'alert') && watch.length < 3) watch.push(`${x.title}. ${x.body}`);
    if (workouts && f.ratings.hard >= 2 && watch.length < 3) watch.push(`${f.ratings.hard} of your last workouts felt too hard. The plan eases off after two of those in a row.`);
    if (f.sleep7.n >= 4 && f.sleep7.avg < 390 && !watch.some((w) => /sleep/i.test(w)) && watch.length < 3) watch.push(`Sleep is averaging ${hrs(f.sleep7.avg)} this week.`);

    // What to focus on, most useful first.
    if (f.sleep7.n >= 4 && f.sleep7.avg < 420) addFocus('Keep a steady bedtime', 'Protect your sleep: a steady bedtime helps more than catching up on weekends.');
    if (f.goal && f.proteinDays >= 3 && f.proteinHit < f.proteinDays / 2) addFocus(`Get to ${f.goal} g of protein a day`, `Get to ${f.goal} g of protein. One ${S.profile.protein.quickName || 'shake'} on training days goes a long way.`);
    if (workouts && f.rirN >= 6 && f.rir['0'] / f.rirN > 0.4) addFocus('Stop sets with 1-2 reps left', 'Stop most sets with 1-2 reps left. Going to failure every time makes recovery harder without much extra growth.');
    else if (workouts && f.rirN >= 6 && f.rir['3'] / f.rirN > 0.5) addFocus('Rate the reps you have left honestly', 'You had lots left in the tank. Honest answers keep the plan moving you up.');
    if (f.steps7.n >= 4 && f.stepsBase.n >= 7 && f.steps7.avg < f.stepsBase.avg * 0.8) addFocus('A 10-minute walk after a meal', 'Steps are down on your usual. A 10-minute walk after a meal adds up.');
    if (workouts && S.catchup.arm.active) addFocus(`Lead with your ${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm`, `Keep leading with your ${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm and never let the other side do more reps.`);
    if (F && foodDays < 4) addFocus('Log what you eat most days', 'Log what you eat on most days. After two weeks with a few weigh-ins, your calorie target tunes itself to you.');
    if (focus.length < 2) {
      if (workouts) addFocus('Show up for the next session', 'Show up for the next session. Consistency beats any single workout.');
      else addFocus('Keep sleep and steps steady', 'Keep your sleep and steps steady. Small daily habits move the trends most.');
    }

    const ask = ['How is my sleep?', workouts ? 'Am I getting stronger?' : 'How are my steps?', 'What should I focus on?'];
    if (f.weight.avg7 != null) ask[1] = 'How is my weight trending?';
    return { headline, wins, watch: watch.slice(0, 3), focus: focus.slice(0, 3), ask_me: ask, glance: glance(S, day, f), focus_one: focusShort[0] };
  }

  /* ---------------------------------------------------------------- questions */
  const RED_FLAGS = ['chest pain', 'chest hurts', 'faint', 'passed out', 'dizzy', 'dizziness', "can't breathe", 'cant breathe', 'short of breath', 'heart attack', 'numb', 'blood'];
  const TOPICS = [
    { id: 'today', words: ['today', 'lighter', 'easier today', 'fewer sets', 'less sets', 'readiness', 'why is'] },
    { id: 'sleep', words: ['sleep', 'slept', 'tired', 'bedtime', 'insomnia', 'nap', 'rest well'] },
    { id: 'steps', words: ['step', 'walk', 'walking', 'active', 'activity', 'cardio', 'move more', 'moving enough', 'move enough'] },
    { id: 'weight', words: ['weight', 'weigh', 'scale', 'lose', 'losing', 'lost', 'gain', 'bulk', 'cut', 'fat', 'waist'] },
    { id: 'protein', words: ['protein', 'eat', 'food', 'diet', 'shake', 'meal', 'nutrition', 'calorie'] },
    { id: 'strength', words: ['stronger', 'strength', 'progress', 'level', 'improv', 'gains', 'muscle', 'grow', 'working'] },
    { id: 'streak', words: ['streak', 'missed', 'miss ', 'skip', 'consisten', 'motivat', 'lazy', 'habit'] },
    { id: 'heart', words: ['heart', 'hrv', 'resting', 'pulse', 'bpm', 'recover'] },
    { id: 'sore', words: ['sore', 'pain', 'hurt', 'ache', 'injur', 'doms', 'stiff'] },
    { id: 'sides', words: ['left', 'right', 'weaker', 'side', 'imbalance', 'uneven', 'one arm'] },
    { id: 'deload', words: ['deload', 'light week', 'easy week', 'rest week'] },
    { id: 'abs', words: ['abs', 'six pack', 'six-pack', 'belly', 'stomach', 'core'] },
    { id: 'bodies', words: ['arthritis', 'rheumat', 'osteopor', 'bone density', 'back pain', 'blood pressure', 'hypertension', 'balance', 'wheelchair', 'seated', 'wrist pain', 'hand pain', 'heart condition', 'heart disease', 'health condition', 'pregnan', 'flare', 'my age', 'too old', 'older'] },
    { id: 'focus', words: ['focus', 'improve', 'what should', 'next', 'advice', 'tip', 'help me', 'better'] },
  ];
  function topicOf(q) {
    const t = ` ${String(q || '').toLowerCase()} `;
    if (RED_FLAGS.some((w) => t.includes(w))) return 'redflag';
    let best = null, score = 0;
    for (const tp of TOPICS) {
      const s = tp.words.reduce((a, w) => a + (t.includes(w) ? w.length : 0), 0);
      if (s > score) { score = s; best = tp.id; }
    }
    return best;
  }

  const ANSWER = {
    bodies: (S, day, f, q) => (GH.access ? GH.access.answer(S.profile, q) : 'Tell the app about anything to plan around under Settings, Your answers.'),
    redflag: () => 'That could be serious, and an app can\'t judge it. Stop exercising and talk to a doctor. If it\'s happening now or getting worse, call emergency services.',
    today: (S, day, f) => {
      const r = f.readiness;
      if (!r.reasons.length) return 'Your sleep, heart rate and feel check look normal, so you get the full session.';
      return `${r.reasons.map((x) => x.text).join(' ')} A slightly smaller session keeps the habit going without digging a hole. It goes back to normal once you recover.`;
    },
    sleep: (S, day, f) => {
      if (!f.sleep7.n) return 'I don\'t have any sleep from this week. Connect Health Connect or log sleep on the Health tab.';
      let a = `You averaged ${hrs(f.sleep7.avg)} over ${f.sleep7.n === 1 ? 'the last night' : `the last ${f.sleep7.n} nights`}`;
      a += f.sleepBase.n >= 7 ? `, ${Math.abs(f.sleep7.avg - f.sleepBase.avg) < 15 ? 'about the same as' : f.sleep7.avg > f.sleepBase.avg ? `${Math.round(f.sleep7.avg - f.sleepBase.avg)} min more than` : `${Math.round(f.sleepBase.avg - f.sleep7.avg)} min less than`} your usual ${hrs(f.sleepBase.avg)}.` : '.';
      const timing = f.insights.find((x) => /sleep-timing/.test(x.id));
      if (timing) a += ` ${timing.title}.`;
      a += f.sleep7.avg < 420 ? ' Most adults do best on 7 hours or more. A steady bedtime, weekends included, is the easiest lever.' : ' That\'s a solid amount.';
      return `${a} Under 5 hours, the app takes a set off each exercise that day. Short nights hurt most when they pile up.`;
    },
    steps: (S, day, f) => {
      if (!f.steps7.n) return 'No steps from this week yet. With Health Connect on, steps come in on their own.';
      let a = `You're averaging ${int(Math.round(f.steps7.avg))} steps a day this week`;
      a += f.stepsBase.n >= 7 ? `, against your usual ${int(Math.round(f.stepsBase.avg))}.` : '.';
      a += f.steps7.avg < 7000 ? ' In large studies, the risk of dying early kept falling up to about 8,000-10,000 steps a day for adults under 60 (6,000-8,000 over 60). A short walk after meals is the easiest way to add some.' : ' That\'s a healthy amount for most adults.';
      return a;
    },
    weight: (S, day, f) => {
      const w = f.weight;
      if (w.avg7 == null) return 'I need a few weigh-ins to see a trend. Weigh in the morning, a few times a week, and the app smooths it into a 7-day average.';
      let a = `Your 7-day average is ${weightText(S, w.avg7)}`;
      if (w.rate != null) a += `, ${Math.abs(w.rate) < 0.002 ? 'steady' : w.rate < 0 ? `down ${pct(w.rate)}` : `up ${pct(w.rate)}`} on the week before.`;
      else a += '.';
      const goal = S.profile.weightGoal || 'maintain';
      if (w.warn) a += ` ${w.warn}.`;
      else if (goal === 'lose') a += ' For losing fat while keeping muscle, about 0.5-1% of body weight a week is the usual target.';
      else if (goal === 'gain') a += ' For gaining, a slow climb keeps most of it muscle.';
      return `${a} Day-to-day swings are mostly water, so watch the average, not single weigh-ins.`;
    },
    protein: (S, day, f) => {
      if (S.profile.protein.track === false) return 'Protein tracking is off. Turn it on in Settings, under What you track.';
      if (!f.goal) return 'Add your weight and I can set a protein goal for you.';
      const got = B().proteinToday(S, day);
      let a = `Your goal is ${f.goal} g a day and you're at ${got} g today.`;
      if (f.proteinDays) a += ` You hit it on ${f.proteinHit} of the last ${f.proteinDays} days you logged.`;
      return `${a} Past about 1.6 g per kg of body weight a day, more adds little for most people, so hitting the goal matters more than beating it.`;
    },
    strength: (S, day, f) => {
      const ups = S.log.filter((l) => l.type === 'workout').flatMap((l) => (l.celebrate || []).map((c) => ({ day: l.day, c })));
      const recentUps = ups.filter((x) => x.day > day - 28);
      if (!f.logs.length) return 'After a few workouts I can show you. Each exercise moves up when you have 3 or more reps left at the top of its range.';
      const levels = [];
      for (const fam of ['push', 'curl', 'squat', 'row', 'abs']) { const x = B().ladderLevel(S, fam, day); if (x && x.level > 0) levels.push(`${x.name.toLowerCase()} (level ${x.level} of ${x.of})`); }
      let a = recentUps.length ? `Yes: ${recentUps.length === 1 ? 'one level-up or personal best' : `${recentUps.length} level-ups and personal bests`} in the last 4 weeks, most recently "${recentUps[recentUps.length - 1].c.text}".` : 'No level-ups in the last 4 weeks yet. That\'s normal early on: reps climb first, then weight, then the next level.';
      if (levels.length) a += ` Right now you're on ${list(levels.slice(0, 3))}.`;
      return a;
    },
    streak: (S, day, f) => {
      const s = f.streak;
      let a = s.current ? `You're on a ${s.current}-day streak${s.best > s.current ? ` (best ${s.best})` : ''}.` : 'No streak running right now, and that\'s fine: the next workout starts one.';
      a += s.freezeThisWeek ? ' Your freeze for this week is used.' : ' You have one freeze this week, so one miss won\'t break it.';
      return `${a} One missed day doesn't undo a habit. Picking it back up the next day matters most, so the plan shifts forward instead of doubling up.`;
    },
    heart: (S, day, f) => {
      if (!f.rhr7.n && !f.hrv7.n) return 'I don\'t have resting heart rate or HRV yet. A watch or ring that syncs to Health Connect adds them.';
      const bits = [];
      if (f.rhr7.n) bits.push(`resting heart rate ${Math.round(f.rhr7.avg)} bpm${f.rhrBase.n >= 7 ? ` (usual ${Math.round(f.rhrBase.avg)})` : ''}`);
      if (f.hrv7.n) bits.push(`HRV ${Math.round(f.hrv7.avg)} ms${f.hrvBase.n >= 7 ? ` (usual ${Math.round(f.hrvBase.avg)})` : ''}`);
      let a = `This week: ${list(bits)}.`;
      if (f.rhr7.n && f.rhr7.avg > 100) a += ' A resting heart rate over 100 is worth checking with a doctor.';
      a += ' A resting heart rate well above your normal, or HRV well below it, often goes with stress, poor sleep, alcohol or an illness coming on, and the app takes a set off. The weekly trend says more than any single day.';
      return a;
    },
    sore: (S, day, f) => {
      const pain = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
      let a = 'Normal muscle soreness peaks a day or two after training and fades on its own. Moving gently helps more than resting completely.';
      if (pain.length) a += ` Moves that load your ${list(pain)} are swapped out until ${B().fmtDay(Math.max(...pain.map((j) => S.pain[j])))}.`;
      else a += ' If a joint hurts, tick it at the check-in and those moves get swapped out for two weeks.';
      return `${a} Sharp pain, swelling, or pain that lasts more than a week or two is worth getting checked.`;
    },
    sides: (S, day, f) => {
      const c = S.catchup.arm;
      const t = f.tests[f.tests.length - 1];
      if (!t) return 'You haven\'t done a left vs right test yet. It runs every two weeks on an arm day.';
      const side = c.side === 'R' ? 'right' : 'left';
      let a = `Your last test had a ${pct(t.gap)} gap between arms.`;
      a += c.active ? ` Your ${side} arm goes first and gets one extra set until the gap is under 10%.` : ' That\'s under 10%, so the extra set is off. It comes back if the gap reaches 15%.';
      return `${a} Training one side also helps the other a little, so keep doing both.`;
    },
    deload: (S, day, f) => {
      const w = f.week;
      const a = w && w.phase.deload ? 'This is a deload week: about 40% less volume.' : 'A deload is a lighter week, about 40% less volume. It comes every 5th week, or sooner if you rate two workouts in a row too hard while sleeping badly.';
      return `${a} Coaches use deloads to shed built-up fatigue before the next block. A lighter week doesn't cost you muscle.`;
    },
    abs: (S, day, f) => 'Ab training builds the muscle but doesn\'t burn the fat over it: in a 6-week study of ab work alone, belly fat didn\'t change. Visible abs take the muscle plus lower body fat over months, which is mostly food and daily movement. Track your waist and ab levels in Progress rather than a date.',
    focus: (S, day, f) => report(S, day).focus.join(' '),
  };

  // A plain yes or no for a yes-or-no question the numbers settle, read the way the answer above reads
  // them. The on-device coach starts its answer with it: small models get yes or no wrong from the
  // numbers alone. Only for a question asked the positive way round ("Am I getting stronger?", not
  // "...weaker?"); anything else gets null.
  const YES_NO = /^\s*(am|is|are|do|does|did|have|has|was|were|will|should)\b/i;
  const TURNED = /\b(not|weaker|worse|less|lose|losing|too much|too many|too little)\b|n't\b/i;
  const VERDICT = {
    strength: { asks: /\b(stronger|progress(ing)?|improving|getting better|gains)\b/i, of: (S, day, f) => (f.logs.length ? (S.log.some((l) => l.type === 'workout' && l.day > day - 28 && (l.celebrate || []).length) ? 'Yes' : 'Not yet') : null) },
    steps: { asks: /\benough\b/i, of: (S, day, f) => (f.steps7.n ? (f.steps7.avg >= 7000 ? 'Yes' : 'Not quite') : null) },
    sleep: { asks: /\benough\b/i, of: (S, day, f) => (f.sleep7.n ? (f.sleep7.avg >= 420 ? 'Yes' : 'Not quite') : null) },
    protein: { asks: /\benough\b|\bhitting\b/i, of: (S, day, f) => (S.profile.protein.track !== false && f.goal && f.proteinDays ? (f.proteinHit / f.proteinDays >= 0.7 ? 'Yes' : 'Not quite') : null) },
  };
  function verdict(S, day, question) {
    const q = String(question || '');
    if (!YES_NO.test(q) || TURNED.test(q)) return null;
    const v = VERDICT[topicOf(q)];
    return v && v.asks.test(q) ? v.of(S, day, facts(S, day)) : null;
  }

  // A question built on something that isn't so ("Why is today lighter?" on a full day) starts from
  // the app's correction, so a model can't make up a reason for it. null when there's nothing to fix.
  function correction(S, day, question) {
    const q = String(question || '');
    if (topicOf(q) !== 'today' || !/\b(lighter|easier|shorter|smaller|less|fewer|cut|reduced)\b/i.test(q) || S.profile.workouts === false) return null;
    const b = B();
    const plan = b.todayPlan(S, day);
    if (plan.type !== 'workout') return null; // a light, rest or finished day has its own answer
    return b.readiness(S, day).reasons.length ? null : 'Today isn\'t lighter:';
  }

  // Answers a question from the user's own numbers. { text, topic } (topic null = no match).
  function ask(S, day, question) {
    const topic = topicOf(question);
    if (!topic) {
      return { topic: null, text: 'I can answer about your sleep, steps, weight, protein, training, streak, recovery and left and right sides. For anything else, try Ask in the Claude app.' };
    }
    return { topic, text: ANSWER[topic](S, day, facts(S, day), question) };
  }

  /* ---------------------------------------------------------------- the number check */
  // Every number in an AI's words should be one it was given, or that number rounded: models
  // sometimes make one up or do their own sums. Sentences with any other number are left out. The
  // on-device coach, Claude's answers and the plan review (src/planreview.js) all go through it.
  // { text, cut } (cut: how many sentences went).
  // A percentage has to be one of the given percentages exactly: a small model works out its own ("8%
  // above your usual" for 1%), and neither some other 8 in the prompt nor a 7.6% rounded up may let it
  // through.
  const NUM = /\d+(?:,\d{3})*(?:\.\d+)?/g;
  const PCT = /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/g;
  const numbers = (s) => (String(s || '').match(NUM) || []).map((x) => Number(x.replace(/,/g, '')));
  const percents = (s) => [...String(s || '').matchAll(PCT)].map((m) => Number(m[1]));
  const near = (known) => (n) => known.some((g) => g === n || (Number.isInteger(n) && (Math.round(g) === n || Math.trunc(g) === n)));
  function keepToGiven(text, given) {
    const known = near(numbers(given)), givenPct = percents(given), knownPct = (n) => givenPct.includes(n);
    const all = String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = all.filter((x) => numbers(x).every(known) && percents(x).every(knownPct));
    return { text: kept.length === all.length ? String(text || '').trim() : kept.join(' '), cut: all.length - kept.length };
  }
  // An AI's answer as shown: its own words, less any sentence with a number it wasn't given. If that
  // leaves next to nothing (or it only got as far as the yes or no it was started with), the app's
  // own answer stands in, and a note says so. who names the AI in that note ('The model', 'Claude').
  // start: what the answer was started with, which isn't the AI's own words.
  // { text, note, cut, replaced }.
  function grounded(S, day, question, raw, given, start, who) {
    const text = String(raw || '').trim();
    const k = keepToGiven(text, given);
    const after = (x) => { const lead0 = String(start || '').trim(); return (lead0 && x.startsWith(lead0) ? x.slice(lead0.length) : x).trim(); };
    const words = after(k.text);
    if (words.length >= (k.cut ? 30 : 8)) return { text: k.text, note: k.cut ? 'Left out a line with a number that isn\'t in your data.' : null, cut: k.cut, replaced: false };
    const own = ask(S, day, question).text;
    const name = who || 'The model';
    const why = after(text) ? `${name}'s answer didn't match your numbers` : `${name} didn't answer`;
    return { text: own || text, note: own ? `${why}, so this is the app's own.` : null, cut: k.cut, replaced: !!own };
  }

  /* ---------------------------------------------------------------- Claude app hand-off */
  // The text sent to the Claude app: a short brief, the question, then the data summary.
  function claudePrompt(S, day, question) {
    const sum = GH.ai && GH.ai.summary ? GH.ai.summary(S, day) : '';
    return [
      'I use Gradient Health, a home workout and health tracking app. Below is a summary of my recent data from the app, without my name or any dates.',
      'Please answer like a coach: short, plain and specific, using my numbers. You\'re not my doctor, so tell me if something is worth getting checked. The app sets my training plan, so explain it rather than replace it.',
      '',
      `My question: ${String(question || 'What should I focus on this week?').trim()}`,
      '',
      sum,
    ].join('\n');
  }

  /* ---------------------------------------------------------------- what the coach is doing */
  // Today's decisions, each with its reason and the How it works rule behind it, so the plan never
  // changes without saying why. session: today's built session, or null on a light or rest day.
  function decisions(S, day, session) {
    const b = B();
    const M = GH.moves;
    const out = [];
    const s = session;
    if (!s) {
      out.push({ icon: 'leaf', tone: 'teal', text: 'Light day: a walk and 5 minutes of mobility', why: 'Recovery between workouts. Doing both keeps your streak going.', rule: 'steps' });
      return out;
    }
    // A flare day (src/access.js) is gentle range of motion only: that's the one thing to say.
    if (s.flare && GH.access) return GH.access.decisions(S, s);
    const r = s.readiness || { reasons: [] };
    const why = (kind) => (r.reasons || []).find((x) => x.kind === kind);
    if (r.minus) {
      const sl = why('sleep');
      const body = (r.reasons || []).filter((x) => ['rhr', 'hrv', 'feel'].includes(x.kind)).map((x) => x.text);
      const sleepMin = (S.health.days[day] || {}).sleepMin;
      out.push({ icon: sl ? 'moon' : 'heart', tone: sl ? 'indigo' : 'rose', text: 'One set less on each exercise', why: sl ? (sleepMin != null ? `You slept ${hrs(sleepMin)}.` : 'Under 5 hours of sleep.') : body.join(' '), rule: sl ? 'sleep' : 'hrv' });
    }
    const ex = why('exercise');
    if (ex) out.push({ icon: 'bolt', tone: 'amber', text: 'Easier on your legs, no finisher', why: `${ex.text.split(':')[0]}.`, rule: 'sleep' });
    if (s.phase && s.phase.deload) out.push({ icon: 'moon', tone: 'indigo', text: 'Deload week: about 40% less volume', why: 'Every 5th week, or sooner when workouts feel too hard on poor recovery.', rule: 'deload' });
    else if (s.phase && s.phase.onramp) out.push({ icon: 'sun', tone: 'amber', text: 'Easing in with fewer sets this week', why: s.phase.idle ? 'Coming back after time off.' : 'Your first weeks build up gradually.', rule: 'volume' });
    if (s.comeback) out.push({ icon: 'refresh', tone: 'teal', text: `About ${Math.round((1 - s.comeback.mult) * 100)}% lighter weights today`, why: `${s.comeback.days} days since your last workout.`, rule: 'comeback' });
    for (const it of s.items || []) if (it.swappedFrom && M && M.MOVES[it.swappedFrom]) out.push({ icon: 'shuffle', tone: 'coral', text: `${M.MOVES[it.swappedFrom].name} swapped for ${it.name}`, why: 'A joint you flagged is having a break.', rule: null });
    const first = (s.units || [])[0];
    const prog = b.programFor(S.profile);
    if (first && first !== 'chest' && first !== 'abs' && Math.min(...(({ arms: ['biceps', 'triceps'] })[first] || [first]).map((g) => prog.tiers[g] || 3)) === 1) {
      out.push({ icon: 'flag', tone: 'green', text: `${first[0].toUpperCase() + first.slice(1)} first while you're fresh`, why: 'It\'s one of your top goals.', rule: 'order' });
    }
    const top = (S.profile.goals || []).slice(0, 2);
    if (s.place === 'gym' && top.includes('strength') && (s.items || []).some((it) => ['pressG', 'squatG', 'hingeG', 'pullG', 'rowG', 'ohpG'].includes(it.fam))) out.push({ icon: 'bolt', tone: 'amber', text: 'Heavier sets of 4-8 on the main lifts', why: 'Strength is one of your top goals.', rule: 'ranges' });
    const guesses = (s.items || []).filter((it) => it.load && it.load.guess).length;
    if (guesses) out.push({ icon: 'dumbbell', tone: 'sky', text: `Pick your weight on ${guesses === 1 ? 'one new exercise' : `${guesses} new exercises`}`, why: 'Start with one you could lift about 12 times. It\'s remembered after that.', rule: 'overload' });
    if (s.trimmed && s.trimmed.length) out.push({ icon: 'clock', tone: 'sky', text: `Trimmed to fit ${s.short ? '12-15' : S.profile.minutes} minutes`, why: `Left out: ${s.trimmed.map((x) => x.toLowerCase()).join(', ')}.`, rule: null });
    for (const l of (S.pendingLines || []).filter((x) => x && x.text).slice(0, 3)) out.push({ icon: 'arrow-up-right', tone: 'green', text: l.text, why: l.why ? `${l.why[0].toUpperCase()}${l.why.slice(1)}.` : '', rule: 'overload' });
    // Age and health (src/access.js): balance, power, stand-ins, breathing, a flare day.
    if (GH.access) for (const d of GH.access.decisions(S, s)) out.push(d);
    return out;
  }

  // Everything the coach changed recently, newest first: [{ day, text, why }].
  function timeline(S, day, span) {
    const n = span || 42;
    const items = [];
    for (const l of S.log) {
      if (l.type !== 'workout' || !l.checkedIn || l.day <= day - n) continue;
      for (const x of l.lines || []) if (x && x.text) items.push({ day: l.day, text: x.text, why: x.why || '' });
    }
    for (const e of S.events || []) {
      if (e.day <= day - n || e.day > day) continue;
      if (e.type === 'deloadNext') items.push({ day: e.day, text: 'Lighter week planned for next week', why: 'you asked for it, or recovery has been poor' });
      else if (e.type === 'settings' && e.day > (S.profile.startDay || 0)) items.push({ day: e.day, text: `Schedule: ${e.days} days a week, ${e.minutes} min`, why: 'you changed it' });
      else if (e.type === 'tailor' && !e.undone) items.push({ day: e.day, text: `Tailored: ${(e.lines || []).map((x) => x.replace(/\.$/, '')).join('; ')}`, why: 'you asked for it' });
      // Changes from the plan review (src/planreview.js), which the person approved.
      else if (e.type === 'review' && !e.undone) items.push({ day: e.day, text: `Plan checked: ${(e.lines || []).map((x) => String(x).replace(/\.$/, '')).join('; ')}`, why: e.engine === 'claude' ? 'suggested by Claude, approved by you' : e.engine === 'device' ? 'suggested by the on-device coach, approved by you' : 'you chose it' });
      else if (e.type === 'plan') { const p = e.id && GH.customPlan ? GH.customPlan.get(S, e.id) : null; items.push({ day: e.day, text: e.id ? `Switched to ${p ? p.name : 'your own plan'}` : 'Back to the coach\'s plan', why: 'you chose it' }); }
    }
    // The same change repeated within a week (a deload note after every workout) shows once.
    const seen = new Set();
    return items.sort((a, b) => b.day - a.day).filter((x) => {
      const k = `${B().weekStart(x.day)}|${x.text}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // What the coach keeps an eye on, each with a status: good, info or watch.
  function watching(S, day) {
    const f = facts(S, day);
    const b = B();
    const out = [];
    if (f.planned || f.done) out.push({ icon: 'calendar', label: 'Workouts this week', value: `${f.done} of ${Math.max(f.planned, f.done)}`, status: f.missed ? 'watch' : 'good', note: f.missed ? 'The plan moved forward, so nothing doubles up.' : 'On plan.' });
    if (f.rirN >= 6) {
      const zero = f.rir['0'] / f.rirN, lots = f.rir['3'] / f.rirN;
      out.push(zero > 0.4 ? { icon: 'timer', label: 'Effort', value: 'Often to failure', status: 'watch', note: 'Stopping 1-2 reps short grows muscle about as well with less fatigue.' }
        : lots > 0.5 ? { icon: 'timer', label: 'Effort', value: 'Lots left in the tank', status: 'info', note: 'Honest answers move you up faster.' }
          : { icon: 'timer', label: 'Effort', value: '1-3 reps left', status: 'good', note: 'Right where it should be.' });
    }
    if (f.sleep7.n >= 3) out.push({ icon: 'moon', label: 'Sleep', value: `${hrs(f.sleep7.avg)} a night`, status: f.sleep7.avg < 360 ? 'watch' : f.sleep7.avg < 420 ? 'info' : 'good', note: f.sleep7.avg < 420 ? 'Under 7 hours. A night under 5 takes a set off the next day.' : 'Enough for good recovery.' });
    if (f.rhr7.n >= 3 && f.rhrBase.n >= 7) { const d = f.rhr7.avg - f.rhrBase.avg; out.push({ icon: 'heart', label: 'Resting heart rate', value: `${Math.round(f.rhr7.avg)} bpm`, status: d >= 5 ? 'watch' : 'good', note: d >= 5 ? `${Math.round(d)} above your usual ${Math.round(f.rhrBase.avg)}.` : `Around your usual ${Math.round(f.rhrBase.avg)}.` }); }
    if (f.hrv7.n >= 3 && f.hrvBase.n >= 7) { const d = f.hrv7.avg / f.hrvBase.avg - 1; out.push({ icon: 'wave', label: 'HRV', value: `${Math.round(f.hrv7.avg)} ms`, status: d <= -0.15 ? 'watch' : 'good', note: d <= -0.15 ? `${pct(d)} below your usual.` : 'Around your usual.' }); }
    const sg = b.stepsGoal(S, day);
    if (f.steps7.n >= 3) out.push({ icon: 'navigate', label: 'Steps', value: `${int(Math.round(f.steps7.avg))} a day`, status: f.steps7.avg >= sg.goal ? 'good' : f.steps7.avg >= sg.goal * 0.75 ? 'info' : 'watch', note: `Goal ${int(sg.goal)}.` });
    const w = f.weight;
    if (w.avg7 != null && w.rate != null) out.push({ icon: 'chart', label: 'Weight trend', value: `${Math.abs(w.rate) < 0.002 ? 'Steady' : `${w.rate < 0 ? 'Down' : 'Up'} ${pct(w.rate)} a week`}`, status: w.warn ? 'watch' : 'good', note: w.warn || `Goal: ${S.profile.weightGoal === 'lose' ? 'lose' : S.profile.weightGoal === 'gain' ? 'gain' : 'maintain'}.` });
    if (f.goal && f.proteinDays >= 3) out.push({ icon: 'check-circle', label: 'Protein', value: `${f.proteinHit} of ${f.proteinDays} days`, status: f.proteinHit >= f.proteinDays - 1 ? 'good' : 'watch', note: `Goal ${f.goal} g a day.` });
    if (GH.food && GH.food.watchItem) { const x = GH.food.watchItem(S, day); if (x) out.push(x); }
    // Gym lifts that have gone flat (the next flat session swaps them).
    for (const [fam, st] of Object.entries(S.prog || {})) {
      if (!st || !st.gym || !st.e1rm || !st.e1rm[st.rung]) continue;
      const hist = st.e1rm[st.rung].hist || [];
      if (hist.length >= 3 && Math.max(hist[hist.length - 1][1], hist[hist.length - 2][1]) <= hist[hist.length - 3][1] * 1.005) {
        const m = GH.moves && GH.moves.MOVES[st.rung];
        if (m) out.push({ icon: 'shuffle', label: m.name, value: 'No gain in 2 sessions', status: 'info', note: 'One more and it switches to another option for that muscle.' });
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- suggestions */
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // Things the coach would change if you agree. Each one has an id (dismissals stick for two weeks),
  // a title and reason, and an action the app can apply, or none for plain advice.
  function suggestions(S, day) {
    const b = B();
    const out = [];
    const p = S.profile;
    const cal = b.calendar(S, day);
    // 1. The same weekday keeps getting missed.
    const misses = {};
    for (let d = day - 28; d < day; d++) { const i = cal.days[d]; if (i && i.missed) { const wd = b.weekday(d); misses[wd] = (misses[wd] || 0) + 1; } }
    const offsets = b.weekdaysFor(p);
    for (const [wdStr, n] of Object.entries(misses)) {
      const wd = Number(wdStr);
      if (n < 2 || !offsets.includes(wd)) continue;
      // The nearest free day, preferring later in the week.
      const free = [1, -1, 2, -2, 3].map((k) => (wd + k + 7) % 7).find((x) => !offsets.includes(x));
      if (free == null) continue;
      out.push({ id: `wd-${wd}-${free}`, icon: 'calendar', title: `Move ${WD[wd]} workouts to ${WD[free]}?`, body: `${WD[wd]} got missed ${n} times in the last four weeks.`, action: { kind: 'weekday', from: wd, to: free, label: `Move to ${WD[free]}` } });
      break;
    }
    // 2. Workouts keep running longer (or shorter) than the time you picked.
    const recent = S.log.filter((l) => l.type === 'workout' && l.checkedIn && l.day > day - 21 && l.startedAt && l.endedAt && !l.short);
    if (recent.length >= 3) {
      const avg = recent.reduce((a, l) => a + (l.endedAt - l.startedAt) / 60000, 0) / recent.length;
      const want = Math.max(10, Math.min(60, Math.round(avg / 5) * 5));
      if (avg > p.minutes + 8 && want !== p.minutes) out.push({ id: `min-${want}`, icon: 'clock', title: `Plan for ${want} minutes?`, body: `Your workouts have been taking about ${Math.round(avg)} minutes, not ${p.minutes}.`, action: { kind: 'minutes', value: want, label: `Set ${want} min` } });
    }
    // 3. Too hard, twice lately, and no lighter week coming.
    const lastLogs = S.log.filter((l) => l.type === 'workout' && l.checkedIn).slice(-3);
    const hard = lastLogs.filter((l) => l.checkin && l.checkin.rating === 'hard').length;
    const ws = b.weekStart(day);
    const week = cal.weeks[ws];
    if (hard >= 2 && !(week && week.phase.deload) && !(S.events || []).some((e) => e.type === 'deloadNext' && b.weekStart(e.day) === ws)) {
      out.push({ id: `deload-${ws}`, icon: 'moon', title: 'Take a lighter week next week?', body: `${hard} of your last ${lastLogs.length} workouts felt too hard. A lighter week sheds the fatigue without losing muscle.`, action: { kind: 'deload', label: 'Plan a lighter week' } });
    }
    // 4. Too easy, again and again: more sets for the top goals.
    const easy = S.log.filter((l) => l.type === 'workout' && l.checkedIn).slice(-4).filter((l) => l.checkin && l.checkin.rating === 'easy').length;
    const prog = b.programFor(p);
    const room = b.GROUPS.filter((g) => prog.tiers[g] === 1 && S.vol[g] < prog.cap[g]);
    if (easy >= 3 && room.length) out.push({ id: `vol-${ws}`, icon: 'layers', title: 'Add a set a week to your top goals?', body: `${easy} of your last 4 workouts felt too easy.`, action: { kind: 'volume', label: 'Add sets' } });
    // 5. Plain advice.
    const f = facts(S, day);
    if (f.sleep7.n >= 4 && f.sleep7.avg < 390) out.push({ id: `tip-sleep-${ws}`, icon: 'moon', title: 'Aim for an earlier, steadier bedtime', body: `You're averaging ${hrs(f.sleep7.avg)}. A regular bedtime, weekends included, helps more than catching up.` });
    if (f.goal && f.proteinDays >= 3 && f.proteinHit < f.proteinDays / 2) out.push({ id: `tip-protein-${ws}`, icon: 'check-circle', title: `Get to ${f.goal} g of protein`, body: `You hit it on ${f.proteinHit} of ${f.proteinDays} days. One ${p.protein.quickName || 'shake'} on training days goes a long way.` });
    const sg = b.stepsGoal(S, day);
    if (f.steps7.n >= 4 && f.steps7.avg < sg.goal * 0.75) out.push({ id: `tip-steps-${ws}`, icon: 'navigate', title: 'A walk after one meal a day', body: `You're at ${int(Math.round(f.steps7.avg))} steps against a goal of ${int(sg.goal)}. Ten minutes after a meal adds about 1,000.` });
    if (GH.food && GH.food.suggestions) for (const x of GH.food.suggestions(S, day)) out.push(x);
    const gone = S.coachDismissed || {};
    return out.filter((x) => !(gone[x.id] > day - 14)).concat(aiSuggestions(S, day).filter((x) => !(gone[x.id] > day - 14)));
  }
  // Suggestions Claude made (API mode), after validation: same shape as the built-in ones.
  function aiSuggestions(S, day) {
    const list = (S.ai && S.ai.suggestions && S.ai.suggestions.day > day - 7 ? S.ai.suggestions.items : []) || [];
    return list.filter((x) => !x.action || validAction(S, x.action, day)).map((x) => Object.assign({ fromClaude: true }, x));
  }
  // Is an action one the app can safely apply right now?
  function validAction(S, a, day) {
    const b = B();
    const p = S.profile;
    if (!a || typeof a !== 'object') return false;
    if (a.kind === 'minutes') return Number.isInteger(a.value) && a.value >= 10 && a.value <= 60 && a.value % 5 === 0 && a.value !== p.minutes;
    if (a.kind === 'weekday') { const o = b.weekdaysFor(p); return Number.isInteger(a.from) && Number.isInteger(a.to) && o.includes(a.from) && !o.includes(a.to) && a.to >= 0 && a.to <= 6; }
    if (a.kind === 'deload') return !(S.events || []).some((e) => e.type === 'deloadNext' && b.weekStart(e.day) === b.weekStart(day));
    if (a.kind === 'volume') { const prog = b.programFor(p); return b.GROUPS.some((g) => prog.tiers[g] === 1 && S.vol[g] < prog.cap[g]); }
    return false;
  }
  // Applies a suggestion's action; returns the lines to show (what changed).
  function apply(S, sug, day) {
    const b = B();
    const a = sug && sug.action;
    if (!validAction(S, a, day)) return null;
    const p = S.profile;
    let text;
    if (a.kind === 'minutes') { b.reprogram(S, { minutes: a.value }, day); text = `Workouts planned for ${a.value} minutes`; }
    else if (a.kind === 'weekday') { const w = b.weekdaysFor(p).map((x) => (x === a.from ? a.to : x)).sort((x, y) => x - y); b.reprogram(S, { weekdays: w }, day); text = `${WD[a.from]} workouts move to ${WD[a.to]}`; }
    else if (a.kind === 'deload') { S.events.push({ type: 'deloadNext', day }); text = 'Next week is a lighter week'; }
    else if (a.kind === 'volume') {
      const prog = b.programFor(p);
      const up = b.GROUPS.filter((g) => prog.tiers[g] === 1 && S.vol[g] < prog.cap[g]);
      for (const g of up) S.vol[g]++;
      text = `${list(up.map((g) => b.GROUP_NAME[g].toLowerCase()))} +1 set a week`;
    }
    dismiss(S, sug.id, day);
    return { text: text[0].toUpperCase() + text.slice(1), why: sug.fromClaude ? 'suggested by Claude, applied by you' : 'you accepted the coach\'s suggestion' };
  }
  function dismiss(S, id, day) { S.coachDismissed = S.coachDismissed || {}; S.coachDismissed[id] = day; }

  GH.coach = { report, glance, ask, verdict, correction, topicOf, facts, keepToGiven, grounded, claudePrompt, decisions, timeline, watching, suggestions, validAction, apply, dismiss };
})(typeof window !== 'undefined' ? window : globalThis);
