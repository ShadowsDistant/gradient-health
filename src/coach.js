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
  // Same shape as the API coach's report: headline, wins, watch, focus, ask_me.
  function report(S, day) {
    const f = facts(S, day);
    const wins = [], watch = [], focus = [];
    let headline;
    if (!f.logs.length) headline = 'Your first workout is the one that counts most. The plan starts easy on purpose.';
    else if (f.week && f.week.phase.deload) headline = 'Deload week: less volume on purpose, so you come back fresher.';
    else if (f.planned && f.done === f.planned) headline = f.done === 1 ? 'One workout in this week, right on plan.' : `Every workout so far this week: ${f.done} of ${f.done}.`;
    else if (f.missed) headline = `${f.missed === 1 ? 'One workout' : `${f.missed} workouts`} missed this week. The plan moved forward, so the next one picks up where you left off.`;
    else if (f.streak.current >= 7) headline = `${f.streak.current} days in a row. That's a habit forming.`;
    else headline = 'A steady week so far.';

    // Wins.
    for (const c of f.ups.slice(-2)) wins.push(c.text);
    if (f.streak.weekly >= 2) wins.push(`${f.streak.weekly} full weeks in a row.`);
    else if (f.streak.current >= 3) wins.push(`${f.streak.current}-day streak.`);
    if (f.goal && f.proteinDays >= 3 && f.proteinHit >= Math.max(3, f.proteinDays - 1)) wins.push(`Protein goal hit on ${f.proteinHit} of the last ${f.proteinDays} days you logged.`);
    if (f.tests.length >= 2 && f.tests[f.tests.length - 1].gap < f.tests[0].gap - 0.02) wins.push(`Left/right curl gap down from ${pct(f.tests[0].gap)} to ${pct(f.tests[f.tests.length - 1].gap)}.`);
    for (const x of f.insights) if (x.tone === 'good' && wins.length < 3) wins.push(x.title);

    // Things to keep an eye on.
    for (const x of f.insights) if ((x.tone === 'watch' || x.tone === 'alert') && watch.length < 2) watch.push(`${x.title}. ${x.body}`);
    if (f.ratings.hard >= 2 && watch.length < 3) watch.push(`${f.ratings.hard} of your last workouts felt too hard. The plan eases off after two of those in a row.`);
    if (f.sleep7.n >= 4 && f.sleep7.avg < 390 && !watch.some((w) => /sleep/i.test(w)) && watch.length < 3) watch.push(`Sleep is averaging ${hrs(f.sleep7.avg)} this week.`);

    // What to focus on, most useful first.
    if (f.sleep7.n >= 4 && f.sleep7.avg < 420) focus.push('Protect your sleep: a steady bedtime helps more than catching up on weekends.');
    if (f.goal && f.proteinDays >= 3 && f.proteinHit < f.proteinDays / 2) focus.push(`Get to ${f.goal} g of protein. One ${S.profile.protein.quickName || 'shake'} on training days goes a long way.`);
    if (f.rirN >= 6 && f.rir['0'] / f.rirN > 0.4) focus.push('Stop most sets with 1-2 reps left. Going to failure every time makes recovery harder without much extra growth.');
    else if (f.rirN >= 6 && f.rir['3'] / f.rirN > 0.5) focus.push('You had lots left in the tank. Keep answering honestly and the plan will keep moving you up.');
    if (f.steps7.n >= 4 && f.stepsBase.n >= 7 && f.steps7.avg < f.stepsBase.avg * 0.8) focus.push('Steps are down on your usual. A 10-minute walk after a meal adds up.');
    if (S.catchup.arm.active) focus.push(`Keep leading with your ${S.catchup.arm.side === 'R' ? 'right' : 'left'} arm and never let the other side do more reps.`);
    if (focus.length < 2) focus.push('Show up for the next session. Consistency beats any single workout.');

    const ask = ['How is my sleep?', 'Am I getting stronger?', 'What should I focus on?'];
    if (f.weight.avg7 != null) ask[1] = 'How is my weight trending?';
    return { headline, wins: wins.slice(0, 3), watch: watch.slice(0, 3), focus: focus.slice(0, 3), ask_me: ask };
  }

  /* ---------------------------------------------------------------- questions */
  const RED_FLAGS = ['chest pain', 'chest hurts', 'faint', 'passed out', 'dizzy', 'dizziness', "can't breathe", 'cant breathe', 'short of breath', 'heart attack', 'numb', 'blood'];
  const TOPICS = [
    { id: 'today', words: ['today', 'lighter', 'easier today', 'fewer sets', 'less sets', 'readiness', 'why is'] },
    { id: 'sleep', words: ['sleep', 'slept', 'tired', 'bedtime', 'insomnia', 'nap', 'rest well'] },
    { id: 'steps', words: ['step', 'walk', 'walking', 'active', 'activity', 'cardio', 'move more'] },
    { id: 'weight', words: ['weight', 'weigh', 'scale', 'lose', 'losing', 'lost', 'gain', 'bulk', 'cut', 'fat', 'waist'] },
    { id: 'protein', words: ['protein', 'eat', 'food', 'diet', 'shake', 'meal', 'nutrition', 'calorie'] },
    { id: 'strength', words: ['stronger', 'strength', 'progress', 'level', 'improv', 'gains', 'muscle', 'grow', 'working'] },
    { id: 'streak', words: ['streak', 'missed', 'miss ', 'skip', 'consisten', 'motivat', 'lazy', 'habit'] },
    { id: 'heart', words: ['heart', 'hrv', 'resting', 'pulse', 'bpm', 'recover'] },
    { id: 'sore', words: ['sore', 'pain', 'hurt', 'ache', 'injur', 'doms', 'stiff'] },
    { id: 'sides', words: ['left', 'right', 'weaker', 'side', 'imbalance', 'uneven', 'one arm'] },
    { id: 'deload', words: ['deload', 'light week', 'easy week', 'rest week'] },
    { id: 'abs', words: ['abs', 'six pack', 'six-pack', 'belly', 'stomach', 'core'] },
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
    redflag: () => 'That could be serious, and it\'s not something an app should judge. Stop exercising and talk to a doctor. If it\'s happening right now or getting worse, call emergency services.',
    today: (S, day, f) => {
      const r = f.readiness;
      if (!r.reasons.length) return 'Nothing is holding today back: your sleep, heart rate and feel check look normal, so you get the full session.';
      return `${r.reasons.map((x) => x.text).join(' ')} On days like this a slightly smaller session keeps the habit going without digging a hole. Everything goes back to normal once you recover.`;
    },
    sleep: (S, day, f) => {
      if (!f.sleep7.n) return 'I don\'t have any sleep from this week. Connect Health Connect, or log sleep on the Health tab, and I can tell you more.';
      let a = `You averaged ${hrs(f.sleep7.avg)} over ${f.sleep7.n === 1 ? 'the last night' : `the last ${f.sleep7.n} nights`}`;
      a += f.sleepBase.n >= 7 ? `, ${Math.abs(f.sleep7.avg - f.sleepBase.avg) < 15 ? 'about the same as' : f.sleep7.avg > f.sleepBase.avg ? `${Math.round(f.sleep7.avg - f.sleepBase.avg)} min more than` : `${Math.round(f.sleepBase.avg - f.sleep7.avg)} min less than`} your usual ${hrs(f.sleepBase.avg)}.` : '.';
      const timing = f.insights.find((x) => /sleep-timing/.test(x.id));
      if (timing) a += ` ${timing.title}.`;
      a += f.sleep7.avg < 420 ? ' Most adults do best on 7 hours or more. A steady bedtime, weekends included, is the easiest lever.' : ' That\'s a solid amount.';
      return `${a} Under 5 hours and the app takes a set off each exercise that day. Short nights hurt performance most when they pile up.`;
    },
    steps: (S, day, f) => {
      if (!f.steps7.n) return 'No steps from this week yet. With Health Connect on, steps come in on their own.';
      let a = `You're averaging ${Math.round(f.steps7.avg).toLocaleString('en-US')} steps a day this week`;
      a += f.stepsBase.n >= 7 ? `, against your usual ${Math.round(f.stepsBase.avg).toLocaleString('en-US')}.` : '.';
      a += f.steps7.avg < 7000 ? ' In large step-count studies, the risk of dying early kept falling up to about 8,000-10,000 steps a day for adults under 60 (6,000-8,000 over 60). A short walk after meals is the easiest way to add some.' : ' That\'s a healthy amount for most adults.';
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
      if (S.profile.protein.track === false) return 'Protein tracking is off. You can turn it on in Settings under Update my answers, Food.';
      if (!f.goal) return 'Add your weight and I can set a protein goal for you.';
      const got = B().proteinToday(S, day);
      let a = `Your goal is ${f.goal} g a day and you're at ${got} g today.`;
      if (f.proteinDays) a += ` You hit it on ${f.proteinHit} of the last ${f.proteinDays} days you logged.`;
      return `${a} Past roughly 1.6 g per kg of body weight a day, extra protein adds little for most people, so hitting the goal matters more than going over it.`;
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
      return `${a} Missing a single day doesn't undo a habit. What matters is picking it back up the next day, which is why the plan shifts forward instead of doubling up.`;
    },
    heart: (S, day, f) => {
      if (!f.rhr7.n && !f.hrv7.n) return 'I don\'t have resting heart rate or HRV yet. A watch or ring that syncs to Health Connect adds them.';
      const bits = [];
      if (f.rhr7.n) bits.push(`resting heart rate ${Math.round(f.rhr7.avg)} bpm${f.rhrBase.n >= 7 ? ` (usual ${Math.round(f.rhrBase.avg)})` : ''}`);
      if (f.hrv7.n) bits.push(`HRV ${Math.round(f.hrv7.avg)} ms${f.hrvBase.n >= 7 ? ` (usual ${Math.round(f.hrvBase.avg)})` : ''}`);
      let a = `This week: ${list(bits)}.`;
      if (f.rhr7.n && f.rhr7.avg > 100) a += ' A resting heart rate over 100 is worth checking with a doctor.';
      a += ' A resting heart rate well above your normal, or HRV well below it, often goes with stress, poor sleep, alcohol or an illness coming on. The app takes a set off when that happens. The weekly trend tells you more than any single day.';
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
    abs: (S, day, f) => 'Abs training builds the muscle, but it doesn\'t burn the fat over it: in a study where people only did ab work for 6 weeks, belly fat didn\'t change. Visible abs come from the muscle plus lower body fat over months, which is mostly food and daily movement. Watch your waist measurement and your ab levels in Progress instead of a date.',
    focus: (S, day, f) => report(S, day).focus.join(' '),
  };

  // Answers a question from the user's own numbers. { text, topic } (topic null = no match).
  function ask(S, day, question) {
    const topic = topicOf(question);
    if (!topic) {
      return { topic: null, text: 'I can answer questions about your sleep, steps, weight, protein, training, streak, recovery and your left and right sides. For anything else, try Ask in the Claude app.' };
    }
    return { topic, text: ANSWER[topic](S, day, facts(S, day)) };
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

  GH.coach = { report, ask, topicOf, facts, claudePrompt };
})(typeof window !== 'undefined' ? window : globalThis);
