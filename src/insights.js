/* On-device insights: plain statistics over the per-day health records, the workout log and the
 * check-ins. No network. Every insight says what it's based on, and relationships only show up
 * with enough pairs and a real effect, worded as "so far", never as a diagnosis.
 *
 * insight: { id, cat, metric, tone: good|watch|info|alert, icon, title, body, evidence, action?, n, effect, score }
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const H = () => GH.health;

  const CAT_WEIGHT = { safety: 5, recovery: 3, anomaly: 2.4, goal: 2, trend: 1.6, relationship: 1.3, consistency: 1.1 };
  const MIN_PAIRS = 8;

  /* ---------------------------------------------------------------- small stats */
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
  function ranks(a) {
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }
  function spearman(xs, ys) {
    if (xs.length < 3) return 0;
    const rx = ranks(xs), ry = ranks(ys);
    const mx = mean(rx), my = mean(ry);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < rx.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }
  function slope(points) { // least squares, value per day
    if (points.length < 2) return 0;
    const mx = mean(points.map((p) => p.x)), my = mean(points.map((p) => p.y));
    let num = 0, den = 0;
    for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    return den ? num / den : 0;
  }
  const conf = (n, full) => Math.max(0.15, Math.min(1, n / (full || 21)));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /* ---------------------------------------------------------------- wording */
  const fmtMin = (m) => B().fmtMin(Math.round(m));
  // Made once, on first use (toLocaleString makes a formatter every call, and the first one made sets
  // up the number formats, which a launch shouldn't wait for).
  let INT = null;
  const fmtInt = (n) => (INT || (INT = new Intl.NumberFormat('en-US'))).format(Math.round(n));
  const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  function wUnit(S) { return S.profile.units === 'kg' ? 'kg' : 'lb'; }
  function fmtW(S, kg, digits) { const v = S.profile.units === 'kg' ? kg : kg * B().LB_PER_KG; return `${v.toFixed(digits == null ? 1 : digits)} ${wUnit(S)}`; }
  function fmtClock(minFromMidnight) {
    const m = ((Math.round(minFromMidnight) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60), mm = m % 60;
    return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }

  function make(o, S, day) {
    const effect = clamp(o.effect == null ? 1 : o.effect, 0.2, 2);
    const shown = S.insightsShown && S.insightsShown[o.id];
    const age = shown == null ? 0 : day - shown;
    const novelty = age <= 2 ? 1 : Math.max(0.6, 1 - (age - 2) * 0.08);
    return Object.assign({ tone: 'info', icon: 'sparkle' }, o, { score: CAT_WEIGHT[o.cat] * effect * conf(o.n || 1, o.full) * novelty });
  }

  /* ---------------------------------------------------------------- 1. trends */
  const METRIC = {
    sleepMin: { icon: 'moon', name: 'Sleep' },
    steps: { icon: 'navigate', name: 'Steps' },
    rhr: { icon: 'heart', name: 'Resting heart rate' },
    hrv: { icon: 'wave', name: 'HRV' },
  };
  function trends(S, day, out) {
    const st = (key, a, b) => H().stats(S, key, a, b);
    const pair = (key) => ({ r: st(key, day - 6, day), b: st(key, day - 34, day - 7) });
    // Sleep: ±30 min a night.
    let { r, b } = pair('sleepMin');
    if (r.n >= 4 && b.n >= 10 && Math.abs(r.avg - b.avg) >= 30) {
      const up = r.avg > b.avg;
      out.push({ id: `trend:sleep:${up ? 'up' : 'down'}`, cat: 'trend', metric: 'sleepMin', icon: 'moon', tone: up ? 'good' : 'watch', n: r.n + b.n, effect: Math.abs(r.avg - b.avg) / 30,
        title: up ? `Sleeping ${fmtMin(r.avg - b.avg)} more` : `Sleep down ${fmtMin(b.avg - r.avg)} a night`,
        body: up ? `${fmtMin(r.avg)} a night this week against your usual ${fmtMin(b.avg)}.` : `${fmtMin(r.avg)} a night this week against your usual ${fmtMin(b.avg)}. Short nights make sessions feel harder. Under 5 h, the app trims a set.`,
        evidence: `${plural(r.n, 'night')} this week vs ${b.n} before` });
    }
    // Steps: ±15%.
    ({ r, b } = pair('steps'));
    if (r.n >= 4 && b.n >= 10 && b.avg > 0 && Math.abs(r.avg / b.avg - 1) >= 0.15) {
      const up = r.avg > b.avg;
      out.push({ id: `trend:steps:${up ? 'up' : 'down'}`, cat: 'trend', metric: 'steps', icon: 'navigate', tone: up ? 'good' : 'watch', n: r.n + b.n, effect: Math.abs(r.avg / b.avg - 1) / 0.15,
        title: `Steps ${up ? 'up' : 'down'} ${pct(r.avg / b.avg - 1)}`,
        body: `${fmtInt(r.avg)} a day this week against your usual ${fmtInt(b.avg)}.${up ? '' : ' A 10-minute walk after a meal adds about 1,000.'}`,
        evidence: `${plural(r.n, 'day')} this week vs ${b.n} before` });
    }
    // Resting heart rate: ±3 bpm.
    ({ r, b } = pair('rhr'));
    if (r.n >= 4 && b.n >= 10 && Math.abs(r.avg - b.avg) >= 3) {
      const up = r.avg > b.avg;
      out.push({ id: `trend:rhr:${up ? 'up' : 'down'}`, cat: 'trend', metric: 'rhr', icon: 'heart', tone: up ? 'watch' : 'good', n: r.n + b.n, effect: Math.abs(r.avg - b.avg) / 3,
        title: `Resting heart rate ${up ? 'up' : 'down'} ${Math.round(Math.abs(r.avg - b.avg))} bpm`,
        body: up ? `${Math.round(r.avg)} bpm this week against your usual ${Math.round(b.avg)}. Short sleep, stress, alcohol, illness and hard training can all raise it.` : `${Math.round(r.avg)} bpm this week against your usual ${Math.round(b.avg)}. A falling resting heart rate often goes with better fitness.`,
        evidence: `${plural(r.n, 'day')} this week vs ${b.n} before` });
    }
    // HRV: ±10%.
    ({ r, b } = pair('hrv'));
    if (r.n >= 4 && b.n >= 10 && b.avg > 0 && Math.abs(r.avg / b.avg - 1) >= 0.10) {
      const up = r.avg > b.avg;
      out.push({ id: `trend:hrv:${up ? 'up' : 'down'}`, cat: 'trend', metric: 'hrv', icon: 'wave', tone: up ? 'good' : 'watch', n: r.n + b.n, effect: Math.abs(r.avg / b.avg - 1) / 0.1,
        title: `HRV ${up ? 'up' : 'down'} ${pct(r.avg / b.avg - 1)}`,
        body: up ? `${Math.round(r.avg)} ms this week against your usual ${Math.round(b.avg)}. Higher usually means you're recovering well.` : `${Math.round(r.avg)} ms this week against your usual ${Math.round(b.avg)}. Lower HRV often follows poor sleep or a run of hard days.`,
        evidence: `${plural(r.n, 'day')} this week vs ${b.n} before` });
    }
  }

  // Weight: 28-day regression against the weight goal.
  function weightTrend(S, day, out) {
    const pts = S.weights.filter((w) => w.src !== 'profile' && w.day > day - 28 && w.day <= day).map((w) => ({ x: w.day, y: w.kg }));
    if (pts.length < 6 || pts[pts.length - 1].x - pts[0].x < 14) return;
    const perWeek = slope(pts) * 7;
    const avg = mean(pts.map((p) => p.y));
    const rel = perWeek / avg;
    const goal = S.profile.weightGoal || 'maintain';
    const amount = `${fmtW(S, Math.abs(perWeek))} a week`;
    const base = { cat: 'goal', metric: 'weight', icon: 'chart', n: pts.length, full: 12, evidence: `${plural(pts.length, 'weigh-in')} over 4 weeks` };
    const flat = Math.abs(rel) < 0.0025;
    if (goal === 'lose') {
      if (rel <= -0.0025 && rel >= -0.01) out.push(Object.assign(base, { id: 'goal:weight:on-track', tone: 'good', effect: 1.2, title: `Weight trending down ${amount}`, body: 'A steady pace that keeps muscle. Keep protein up and keep training.' }));
      else if (rel > 0.0025) out.push(Object.assign(base, { id: 'goal:weight:up', tone: 'watch', effect: 1, title: `Weight trending up ${amount}`, body: 'Your goal is to lose. Smaller portions of the snacks you like, plus a daily walk, can turn this around.' }));
      else if (flat) out.push(Object.assign(base, { id: 'goal:weight:flat', tone: 'info', effect: 0.6, title: 'Weight holding steady', body: `Within ${fmtW(S, Math.abs(perWeek))} a week. To lose, eat a little less each day; strength work protects your muscle.` }));
    } else if (goal === 'gain') {
      if (rel >= 0.001) out.push(Object.assign(base, { id: 'goal:weight:on-track', tone: 'good', effect: 1.2, title: `Weight trending up ${amount}`, body: 'On track. Keep protein and training steady.' }));
      else out.push(Object.assign(base, { id: 'goal:weight:flat', tone: 'watch', effect: 1, title: 'Weight isn\'t moving up', body: 'To gain, add an easy extra: a shake, a bigger portion of something you already like.' }));
    } else if (flat) out.push(Object.assign(base, { id: 'goal:weight:steady', tone: 'good', effect: 0.7, title: 'Weight steady', body: `Within ${fmtW(S, Math.abs(perWeek))} a week, which is what maintaining looks like.` }));
    else out.push(Object.assign(base, { id: `goal:weight:${rel > 0 ? 'up' : 'down'}`, tone: 'info', effect: 0.8, title: `Weight trending ${rel > 0 ? 'up' : 'down'} ${amount}`, body: 'Your goal is to hold steady. Small drifts like this are normal week to week.' }));
  }

  /* ---------------------------------------------------------------- 2. anomalies */
  function anomalies(S, day, out) {
    const check = (key, d, dir) => {
      const v = H().value(S, key, d);
      if (v == null) return null;
      const b = H().stats(S, key, d - 28, d - 1);
      if (b.n < 14 || !(b.sd > 0)) return null;
      const z = (v - b.avg) / b.sd;
      if (!(dir > 0 ? z >= 2 : z <= -2)) return null;
      // A spike that's part of a run of similar days is a trend, not an anomaly.
      const before = H().stats(S, key, d - 3, d - 1);
      if (before.n >= 2 && (dir > 0 ? before.avg - b.avg : b.avg - before.avg) >= b.sd) return null;
      return { v, b, z };
    };
    let a = check('rhr', day, 1);
    if (a) out.push({ id: `anomaly:rhr:${day}`, cat: 'anomaly', metric: 'rhr', icon: 'heart', tone: 'watch', n: a.b.n, effect: Math.abs(a.z) / 2,
      title: `Resting heart rate ${Math.round(a.v)} bpm today`, body: `Well above your normal ${Math.round(a.b.avg - a.b.sd)}-${Math.round(a.b.avg + a.b.sd)} bpm. Take it easy if you feel run down.`,
      evidence: `${a.b.n} days of history` });
    a = check('hrv', day, -1);
    if (a) out.push({ id: `anomaly:hrv:${day}`, cat: 'anomaly', metric: 'hrv', icon: 'wave', tone: 'watch', n: a.b.n, effect: Math.abs(a.z) / 2,
      title: `HRV ${Math.round(a.v)} ms today`, body: `Well below your normal ${Math.round(a.b.avg - a.b.sd)}-${Math.round(a.b.avg + a.b.sd)} ms. Your body may still be recovering.`,
      evidence: `${a.b.n} days of history` });
    a = check('sleepMin', day, -1);
    if (a) out.push({ id: `anomaly:sleep:${day}`, cat: 'anomaly', metric: 'sleepMin', icon: 'moon', tone: 'watch', n: a.b.n, effect: Math.abs(a.z) / 2,
      title: `Short night: ${fmtMin(a.v)}`, body: `Your usual is ${fmtMin(a.b.avg)}. An early night tonight helps more than a nap.`, evidence: `${a.b.n} nights of history` });
    a = check('steps', day - 1, 1);
    if (a) out.push({ id: `anomaly:steps:${day - 1}`, cat: 'anomaly', metric: 'steps', icon: 'navigate', tone: 'good', n: a.b.n, effect: Math.abs(a.z) / 2.5,
      title: `Big day yesterday: ${fmtInt(a.v)} steps`, body: `Well over your usual ${fmtInt(a.b.avg)}.`, evidence: `${a.b.n} days of history` });
  }

  /* ---------------------------------------------------------------- 3. consistency */
  function consistency(S, day, out) {
    // Sleep timing: spread of the sleep midpoint over two weeks.
    const mids = [];
    for (let d = day - 13; d <= day; d++) {
      const r = S.health.days[d];
      if (!r || !r.bed || !r.wake) continue;
      const mid = new Date((r.bed + r.wake) / 2);
      mids.push(((mid.getHours() * 60 + mid.getMinutes()) - 720 + 1440) % 1440); // minutes after noon: no midnight wrap
    }
    if (mids.length >= 7) {
      const s = sd(mids);
      const m = mean(mids) + 720;
      if (s >= 60) out.push({ id: 'consistency:sleep-timing:loose', cat: 'consistency', metric: 'sleepTiming', icon: 'clock', tone: 'watch', n: mids.length, full: 14, effect: s / 60,
        title: `Sleep timing swings about ±${fmtMin(s)}`, body: `The middle of your night moves that much around ${fmtClock(m)}. A steadier bedtime is an easy way to sleep better.`, evidence: `${mids.length} nights` });
      else if (s <= 30) out.push({ id: 'consistency:sleep-timing:steady', cat: 'consistency', metric: 'sleepTiming', icon: 'clock', tone: 'good', n: mids.length, full: 14, effect: 0.8,
        title: 'Steady sleep timing', body: `Within about ±${Math.round(s)} min of ${fmtClock(m)} most nights.`, evidence: `${mids.length} nights` });
    }
    // Workouts done vs planned over the last four weeks (finished days only).
    const cal = B().calendar(S, day);
    let planned = 0, doneN = 0;
    for (let d = day - 28; d < day; d++) {
      const info = cal.days[d];
      if (!info) continue;
      if (info.planned === 'workout' || info.missed) { planned++; if (info.done) doneN++; }
    }
    if (planned >= 4 && S.profile.workouts !== false) {
      const rate = doneN / planned;
      if (rate >= 0.9) out.push({ id: 'consistency:workouts:high', cat: 'consistency', metric: 'workouts', icon: 'calendar', tone: 'good', n: planned, full: 12, effect: 1.1,
        title: `${doneN} of ${planned} planned workouts done`, body: 'That consistency is what makes the rest work.', evidence: 'the last 4 weeks' });
      else if (rate < 0.6) out.push({ id: 'consistency:workouts:low', cat: 'consistency', metric: 'workouts', icon: 'calendar', tone: 'watch', n: planned, full: 12, effect: 1,
        title: `${doneN} of ${planned} planned workouts done`, body: 'Short on time mode fits a real session into 12-15 min, and it counts for the streak.', evidence: 'the last 4 weeks', action: { label: 'See this week', route: 'plan' } });
    }
    // Protein on the days it was logged.
    const goal = B().proteinGoal(S, day);
    if (goal && S.profile.protein && S.profile.protein.track !== false) {
      const logged = [];
      for (let d = day - 14; d < day; d++) if (S.protein[d] && S.protein[d].length) logged.push(B().proteinToday(S, d));
      if (logged.length >= 5) {
        const hit = logged.filter((g) => g >= goal * 0.95).length;
        const short = mean(logged.filter((g) => g < goal * 0.95).map((g) => goal - g)) || 0;
        const q = S.profile.protein;
        if (hit / logged.length >= 0.7) out.push({ id: 'consistency:protein:high', cat: 'consistency', metric: 'protein', icon: 'check-circle', tone: 'good', n: logged.length, full: 10, effect: 0.9,
          title: `Protein goal hit ${hit} of ${logged.length} days`, body: `${goal} g a day supports the muscle you're building.`, evidence: 'days you logged, last 2 weeks' });
        else if (hit / logged.length <= 0.4) out.push({ id: 'consistency:protein:low', cat: 'consistency', metric: 'protein', icon: 'check-circle', tone: 'watch', n: logged.length, full: 10, effect: 1,
          title: `Protein goal hit ${hit} of ${logged.length} days`, body: `Short by about ${Math.round(short)} g on the other days.${q.quickG ? ` ${Math.max(1, Math.round(short / q.quickG))} more ${String(q.quickName || 'shake').toLowerCase()} would close most of it.` : ''}`, evidence: 'days you logged, last 2 weeks' });
      }
    }
  }

  /* ---------------------------------------------------------------- 4. relationships */
  function relationships(S, day, out) {
    const from = day - 90;
    // Sleep before a workout → how hard it felt.
    const wo = S.log.filter((l) => l.type === 'workout' && l.day >= from && l.checkin && l.checkin.rating)
      .map((l) => ({ sleep: H().value(S, 'sleepMin', l.day), hard: l.checkin.rating === 'hard' })).filter((x) => x.sleep != null);
    if (wo.length >= MIN_PAIRS) {
      const low = wo.filter((x) => x.sleep < 360), ok = wo.filter((x) => x.sleep >= 360);
      if (low.length >= 3 && ok.length >= 3) {
        const a = low.filter((x) => x.hard).length / low.length, b = ok.filter((x) => x.hard).length / ok.length;
        if (a - b >= 0.25) out.push({ id: 'rel:sleep-hard', cat: 'relationship', metric: 'sleep-workout', icon: 'moon', tone: 'info', n: wo.length, full: 20, effect: (a - b) / 0.25,
          title: 'Short nights make workouts feel harder', body: `In ${wo.length} workouts so far, ${low.filter((x) => x.hard).length} of ${low.length} after under 6 h of sleep felt too hard, against ${ok.filter((x) => x.hard).length} of ${ok.length} after more.`,
          evidence: `${wo.length} workouts with sleep data` });
      }
    }
    // Sleep → resting heart rate the same day.
    const xs = [], ys = [];
    for (let d = from; d <= day; d++) { const s = H().value(S, 'sleepMin', d), r = H().value(S, 'rhr', d); if (s != null && r != null) { xs.push(s); ys.push(r); } }
    if (xs.length >= MIN_PAIRS) {
      const rho = spearman(xs, ys);
      if (rho <= -0.3) {
        const lo = ys.filter((_, i) => xs[i] < 360), hi = ys.filter((_, i) => xs[i] >= 420);
        const extra = lo.length >= 3 && hi.length >= 3 ? ` About ${Math.round(mean(lo) - mean(hi))} bpm higher after nights under 6 h than after 7 h or more.` : '';
        out.push({ id: 'rel:sleep-rhr', cat: 'relationship', metric: 'sleep-rhr', icon: 'heart', tone: 'info', n: xs.length, full: 30, effect: Math.abs(rho) / 0.3,
          title: 'Shorter nights, higher resting heart rate', body: `For you, the two tend to move together so far.${extra}`, evidence: `${xs.length} nights with both` });
      }
    }
    // Feel check ↔ sleep.
    const f = [];
    for (let d = from; d <= day; d++) { const fe = S.feel[d], s = H().value(S, 'sleepMin', d); if (fe && fe.energy && s != null) f.push({ low: fe.energy === 'low', s }); }
    if (f.length >= MIN_PAIRS) {
      const low = f.filter((x) => x.low).map((x) => x.s), rest = f.filter((x) => !x.low).map((x) => x.s);
      if (low.length >= 3 && rest.length >= 3 && mean(rest) - mean(low) >= 30) out.push({ id: 'rel:feel-sleep', cat: 'relationship', metric: 'feel-sleep', icon: 'bolt', tone: 'info', n: f.length, full: 20, effect: (mean(rest) - mean(low)) / 30,
        title: 'Low-energy days follow short nights', body: `On low-energy days you'd slept ${fmtMin(mean(rest) - mean(low))} less on average, over ${f.length} check-ins so far.`, evidence: `${f.length} feel checks with sleep` });
    }
    // Weekly steps → weekly weight change.
    const weeks = [];
    for (let ws = B().weekStart(day) - 7 * 12; ws < B().weekStart(day); ws += 7) {
      const st = H().stats(S, 'steps', ws, ws + 6);
      const w0 = mean(S.weights.filter((w) => w.src !== 'profile' && w.day >= ws - 7 && w.day < ws).map((w) => w.kg));
      const w1 = mean(S.weights.filter((w) => w.src !== 'profile' && w.day >= ws && w.day <= ws + 6).map((w) => w.kg));
      if (st.n >= 4 && w0 != null && w1 != null) weeks.push({ steps: st.avg, dw: w1 - w0 });
    }
    if (weeks.length >= MIN_PAIRS) {
      const rho = spearman(weeks.map((w) => w.steps), weeks.map((w) => w.dw));
      if (rho <= -0.3) out.push({ id: 'rel:steps-weight', cat: 'relationship', metric: 'steps-weight', icon: 'navigate', tone: 'info', n: weeks.length, full: 12, effect: Math.abs(rho) / 0.3,
        title: 'More steps, lower weight trend', body: `Your weight has tended to drop in weeks with more steps, over ${weeks.length} weeks so far.`, evidence: `${weeks.length} weeks with both` });
    }
  }

  /* ---------------------------------------------------------------- 5. goal progress */
  function goals(S, day, out) {
    const g = S.profile.goals || [];
    const ms = S.measurements || [];
    const latest = ms.length ? ms[ms.length - 1] : null;
    const before = (k) => { if (!latest) return null; for (let i = ms.length - 2; i >= 0; i--) if (ms[i][k] != null && latest.day - ms[i].day >= 21) return ms[i]; return null; };
    const cmUnit = S.profile.units === 'kg' ? 'cm' : 'in';
    const fmtCm = (cm) => (cmUnit === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`);
    if (latest && latest.waist != null) {
      const b = before('waist');
      if (b) {
        const d = latest.waist - b.waist;
        if (d <= -1) out.push({ id: `goal:waist:${latest.day}`, cat: 'goal', metric: 'waist', icon: 'sparkle', tone: 'good', n: 2, full: 2, effect: Math.min(2, -d),
          title: `Waist down ${fmtCm(-d)}`, body: `Since ${B().fmtDay(b.day, false)}. ${g.includes('abs') ? 'Waist size tracks belly fat better than the scale does.' : 'Nice work.'}`, evidence: 'your measurements' });
        else if (d >= 1 && S.profile.weightGoal === 'lose') out.push({ id: `goal:waist-up:${latest.day}`, cat: 'goal', metric: 'waist', icon: 'sparkle', tone: 'watch', n: 2, full: 2, effect: 0.8,
          title: `Waist up ${fmtCm(d)}`, body: `Since ${B().fmtDay(b.day, false)}. Worth measuring again in two weeks at the same time of day.`, evidence: 'your measurements' });
      }
    }
    if (latest && (latest.armL != null || latest.armR != null) && g.includes('arms')) {
      const b = before('armL') || before('armR');
      if (b) {
        const dl = latest.armL != null && b.armL != null ? latest.armL - b.armL : null;
        const dr = latest.armR != null && b.armR != null ? latest.armR - b.armR : null;
        if ((dl || 0) >= 0.5 || (dr || 0) >= 0.5) out.push({ id: `goal:arms:${latest.day}`, cat: 'goal', metric: 'arms', icon: 'sparkle', tone: 'good', n: 2, full: 2, effect: 1.2,
          title: 'Arms are growing', body: `Since ${B().fmtDay(b.day, false)}: ${[dl != null ? `left ${dl >= 0 ? '+' : ''}${fmtCm(dl)}` : null, dr != null ? `right ${dr >= 0 ? '+' : ''}${fmtCm(dr)}` : null].filter(Boolean).join(', ')}.`, evidence: 'your measurements' });
      }
    }
    // Left/right gap from the curl tests.
    const t = S.catchup && S.catchup.arm && S.catchup.arm.tests || [];
    if (t.length >= 2) {
      const a = t[0], b = t[t.length - 1];
      const side = S.catchup.arm.side === 'R' ? 'Right' : 'Left';
      if (b.gap < a.gap - 0.03) out.push({ id: `goal:lr:${b.day}`, cat: 'goal', metric: 'lr', icon: 'layers', tone: 'good', n: t.length, full: 3, effect: clamp((a.gap - b.gap) / 0.05, 0.5, 2),
        title: `${side} arm gap: ${Math.round(a.gap * 100)}% → ${Math.round(b.gap * 100)}%`, body: b.gap < 0.1 ? 'Under 10% now, so the extra set is off. The test still runs every two weeks.' : 'The extra set is doing its job.', evidence: `${t.length} curl tests` });
    }
    // Level-ups and heavier weights in the last four weeks.
    const ups = [];
    for (const l of S.log) if (l.type === 'workout' && l.day > day - 28) for (const c of l.celebrate || []) if (c.kind === 'level' || c.kind === 'weight') ups.push(c);
    if (ups.length >= 2) out.push({ id: `goal:levels:${ups.length}`, cat: 'goal', metric: 'levels', icon: 'star', tone: 'good', n: ups.length, full: 3, effect: clamp(ups.length / 3, 0.6, 2),
      title: `${plural(ups.length, 'level-up')} in 4 weeks`, body: ups.slice(-3).map((c) => c.text).join('. ') + '.', evidence: 'your workout log' });
    // Weekly sets against target, last full week.
    const lastWeek = B().weekStart(day) - 7;
    const workouts = S.profile.workouts !== false;
    if (workouts && lastWeek >= B().weekStart(S.profile.startDay)) {
      const ws = B().weeklySets(S, lastWeek + 6);
      const prog = B().programFor(S.profile);
      const short = Object.entries(ws).filter(([grp, v]) => prog.tiers[grp] <= 2 && v.target >= 4 && v.done < v.target * 0.7);
      const done = Object.values(ws).reduce((a, v) => a + v.done, 0);
      if (done > 0 && short.length) {
        const [grp, v] = short.sort((a, b) => (a[1].done / a[1].target) - (b[1].done / b[1].target))[0];
        out.push({ id: `goal:volume:${lastWeek}:${grp}`, cat: 'goal', metric: 'volume', icon: 'chart', tone: 'watch', n: 7, full: 7, effect: 0.9,
          title: `${B().GROUP_NAME[grp]}: ${v.done} of ${v.target} sets last week`, body: v.planned < v.target ? 'Your sessions are too short for the target. A few more minutes each would close the gap.' : 'Missed sessions left this one short.', evidence: 'last week\'s log' });
      }
    }
    // Streaks.
    if (!workouts) return;
    const cal = B().calendar(S, day);
    const cur = cal.streak.current;
    if (cur >= 7 && cur % 7 === 0) out.push({ id: `goal:streak:${cur}`, cat: 'goal', metric: 'streak', icon: 'star', tone: 'good', n: cur, full: 7, effect: 1.2, title: `${cur}-day streak`, body: 'Light days count, so keep them light.', evidence: 'your calendar' });
    if (cal.streak.weekly >= 2) out.push({ id: `goal:weekly:${cal.streak.weekly}`, cat: 'goal', metric: 'streak-weekly', icon: 'calendar', tone: 'good', n: cal.streak.weekly, full: 3, effect: 0.9, title: `${cal.streak.weekly} full weeks in a row`, body: 'Every planned session done.', evidence: 'your calendar' });
  }

  /* ---------------------------------------------------------------- 6. recovery */
  function recovery(S, day, out) {
    if (S.profile.workouts === false) return;
    const r = B().readiness(S, day);
    if (!r.minus && !r.legsMinus) return;
    out.push({ id: `recovery:${day}`, cat: 'recovery', metric: 'readiness', icon: 'bolt', tone: 'watch', n: 21, effect: r.minus && r.legsMinus ? 1.4 : 1,
      title: 'Lighter session today', body: r.reasons.map((x) => x.text).join(' '), evidence: 'today\'s readiness', action: { label: 'See today', route: 'today' } });
  }

  /* ---------------------------------------------------------------- 7. safety */
  function safety(S, day, out) {
    const w = B().weightStats(S, day);
    const older = B().weightStats(S, day - 7);
    if (w.rate != null && w.rate < -0.01 && older.rate != null && older.rate < -0.01) out.push({ id: `safety:weight-loss:${B().weekStart(day)}`, cat: 'safety', metric: 'weight', icon: 'alert', tone: 'alert', n: 14, full: 14, effect: 1.5,
      title: 'Losing weight fast', body: `More than 1% a week for two weeks. Eat more. If you aren't trying to lose, it's worth checking with a doctor.`, evidence: 'two weeks of weigh-ins' });
    const r3 = H().stats(S, 'rhr', day - 2, day);
    if (r3.n >= 2 && r3.avg >= 100) out.push({ id: `safety:rhr-high:${day}`, cat: 'safety', metric: 'rhr', icon: 'alert', tone: 'alert', n: r3.n, full: 3, effect: 2,
      title: 'Resting heart rate over 100', body: `${Math.round(r3.avg)} bpm over the last few days. That's high at rest; it's worth checking with a doctor.`, evidence: `${plural(r3.n, 'day')}` });
    else {
      const r7 = H().stats(S, 'rhr', day - 6, day), base = H().stats(S, 'rhr', day - 34, day - 7);
      const highDays = r7.values.filter((v) => base.avg != null && v >= base.avg + 7).length;
      if (r7.n >= 5 && base.n >= 14 && r7.avg >= base.avg + 10 && highDays >= 5) out.push({ id: `safety:rhr-rise:${B().weekStart(day)}`, cat: 'safety', metric: 'rhr', icon: 'alert', tone: 'alert', n: r7.n, full: 7, effect: 1.6,
        title: 'Resting heart rate up for a week', body: `About ${Math.round(r7.avg - base.avg)} bpm above your normal for most of the week. If you feel unwell or it doesn't settle, check with a doctor.`, evidence: `${r7.n} days vs ${base.n} before` });
    }
  }

  /* ---------------------------------------------------------------- all together */
  const GENERATORS = [safety, recovery, anomalies, goals, weightTrend, trends, relationships, consistency];
  // Sorted, one insight per metric (an anomaly beats the trend it's part of), dismissed ones out.
  function finish(S, day, raw) {
    const dismissed = S.insightsDismissed || {};
    const list = raw.filter((x) => !(dismissed[x.id] != null && day - dismissed[x.id] < 30)).map((x) => make(x, S, day));
    list.sort((a, b) => b.score - a.score);
    const seen = new Set();
    return list.filter((x) => { if (seen.has(x.metric)) return false; seen.add(x.metric); return true; });
  }
  function all(S, day) {
    const raw = [];
    for (const gen of GENERATORS) {
      try { gen(S, day, raw); } catch (e) { /* one broken generator never hides the rest */ }
    }
    return finish(S, day, raw);
  }

  /* ---------------------------------------------------------------- kept answers */
  // top() is asked for on every render of Today and Health, and by the coach, and the generators run
  // over weeks of data. What each generator found is kept per state and day until something it
  // reads changes, which two stamps tell far more cheaply than running it:
  // - the feel check and the sleep chips, read by the four generators in FEEL (straight away, or
  //   through readiness or a night's sleep): a feel tap redoes only those
  // - everything else: every top-level field as JSON, except the ones insights never read (or read
  //   through others, or only when sorting: shown and dismissed); the health days, each record
  //   stringified once (a sync or a hand log replaces a day's record rather than editing it, so
  //   when the sync ran doesn't matter); the hand logs, which are small; the log, one short line per
  //   entry (what changes after the fact:
  //   the check-in, the rating, what it celebrated); the workout in progress; and food only as the
  //   protein of the days the goals read. (Not the plans the optimizer keeps in the state,
  //   planCache: they're worked out from the rest, and change as a launch works them out.)
  // A generator that starts reading something new adds it here.
  const FEEL = new Set([recovery, anomalies, trends, relationships]);
  const SKIP = new Set(['log', 'health', 'food', 'active', 'feel', 'sleepChip', 'insightsShown', 'insightsDismissed', 'ai', 'seen', 'activities', 'actLive', 'achievements', 'pendingLines', 'updatedAt', 'createdAt', 'planCache']);
  const dayJson = new WeakMap(); // health day record → its JSON
  const js = (v) => (v === undefined ? '' : JSON.stringify(v));
  function stamp(S, day) {
    const out = [day];
    for (const k of Object.keys(S)) if (!SKIP.has(k)) out.push(k, js(S[k]));
    const h = S.health || {};
    out.push(js(h.manual));
    const days = h.days || {};
    for (const d of Object.keys(days)) {
      const r = days[d];
      let t = r && typeof r === 'object' ? dayJson.get(r) : js(r);
      if (t == null) { t = js(r); dayJson.set(r, t); }
      out.push(d, t);
    }
    let lg = '';
    for (const l of S.log || []) lg += `${l.type}.${l.day}.${l.checkedIn ? 1 : 0}.${l.pct == null ? '' : l.pct}.${l.walk ? 1 : 0}${l.mobility ? 1 : 0}.${l.walkSrc || ''}.${l.endedAt || ''}.${(l.checkin && l.checkin.rating) || ''}.${(l.celebrate || []).length}.${(l.items || []).length};`;
    out.push(lg);
    const a = S.active;
    out.push(a ? `${a.day}.${a.idx}.${a.steps ? a.steps.length : 0}.${a.startedAt || ''}` : '');
    if (S.food && S.protein && GH.brain) for (let d = day - 14; d < day; d++) out.push(B().proteinToday(S, d));
    return out.join('\u0001');
  }
  const feelStamp = (S) => js([S.feel, S.sleepChip]);
  let memo = new WeakMap(); // S → { key, feel, day, found: Map(generator → what it found) }
  const stats = { hits: 0, misses: 0, kept: 0 };
  // o.ready: answer only if no generator has to run (this launch, or the last one the same day, has
  // what they found), else null. Today's first frame asks this way and works the line out after it.
  function top(S, day, n, o) {
    const key = stamp(S, day), feel = feelStamp(S);
    let m = memo.get(S);
    if (!m || m.key !== key) { m = { key, feel, day, found: (!m && kept(day, key, feel)) || new Map() }; memo.set(S, m); }
    if (o && o.ready && !GENERATORS.every((gen) => m.found.has(gen) && (m.feel === feel || !FEEL.has(gen)))) return null;
    let ran = false;
    const raw = [];
    for (const gen of GENERATORS) {
      let found = m.found.get(gen);
      if (found && (m.feel === feel || !FEEL.has(gen))) stats.hits++;
      else {
        stats.misses++;
        ran = true;
        found = [];
        try { gen(S, day, found); } catch (e) { /* one broken generator never hides the rest */ }
        m.found.set(gen, found);
      }
      for (const x of found) raw.push(x);
    }
    m.feel = feel;
    if (ran) keepSoon(S);
    return finish(S, day, raw).slice(0, n || 5);
  }
  // Works out what top() needs, a generator at a time while more() says there's time (one at least),
  // and keeps it; true once there's nothing left to work out. For the moments after a launch, so no
  // single task carries every generator.
  function warm(S, day, more) {
    const key = stamp(S, day), feel = feelStamp(S);
    let m = memo.get(S);
    if (!m || m.key !== key) { m = { key, feel, day, found: (!m && kept(day, key, feel)) || new Map() }; memo.set(S, m); }
    if (m.feel !== feel) { for (const gen of FEEL) m.found.delete(gen); m.feel = feel; }
    let ran = false, done = true;
    for (const gen of GENERATORS) {
      if (m.found.has(gen)) continue;
      if (ran && !more()) { done = false; break; }
      stats.misses++;
      ran = true;
      const found = [];
      try { gen(S, day, found); } catch (e) { /* one broken generator never hides the rest */ }
      m.found.set(gen, found);
    }
    if (ran) keepSoon(S);
    return done;
  }

  /* ---------------------------------------------------------------- kept across launches */
  // A launch usually finds the state as it was left, and the first render would otherwise run every
  // generator on code that isn't compiled yet, a good part of the time Today takes to appear. So what
  // they found is also kept in localStorage ('gh.v1.insights', which a reset deletes with the state),
  // and only the same build of the app reuses it, on the same day, in the same time zone, for the
  // same two stamps (as hashes). It holds no more than the insights show.
  const KEEP = 'gh.v1.insights';
  function ls() { try { return G.localStorage || null; } catch (e) { return null; } }
  // cyrb53, a quick 53-bit string hash; with the length, plenty to tell two states apart.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${str.length.toString(36)}`;
  }
  // The night-time numbers (bedtimes) read the clock in the phone's time zone.
  const zone = () => new Date().getTimezoneOffset();
  // What a launch can reuse for this state: generator → what it found, or null.
  function kept(day, key, feel) {
    const store = GH.BUILD ? ls() : null;
    if (!store) return null;
    let o = null;
    try { o = JSON.parse(store.getItem(KEEP)); } catch (e) { o = null; }
    if (!o || o.build !== GH.BUILD || o.day !== day || o.zone !== zone() || !Array.isArray(o.found) || o.found.length !== GENERATORS.length || o.key !== hash(key)) return null;
    const sameFeel = o.feel === hash(feel);
    const found = new Map();
    GENERATORS.forEach((gen, i) => { if (Array.isArray(o.found[i]) && (sameFeel || !FEEL.has(gen))) { found.set(gen, o.found[i]); stats.kept++; } });
    return found;
  }
  // After a call that ran generators, the page's next idle moment writes down what they found.
  let keepJob = 0, keepFor = null, keptTxt = '';
  function keepSoon(S) {
    keepFor = S;
    if (keepJob || !GH.BUILD || !G.requestIdleCallback || !ls()) return;
    keepJob = G.requestIdleCallback(() => {
      keepJob = 0;
      const m = memo.get(keepFor);
      keepFor = null;
      if (!m) return;
      // A generator's finds are kept only if JSON gives them back as they are (no undefined, no NaN).
      const found = GENERATORS.map((gen) => {
        const f = m.found.get(gen);
        let exact = !!f;
        const txt = f ? JSON.stringify(f, (k, v) => { if (v === undefined || typeof v === 'function' || (typeof v === 'number' && !isFinite(v))) exact = false; return v; }) : '';
        return exact ? txt : 'null';
      });
      const txt = `{"build":${js(GH.BUILD)},"day":${Number(m.day) || 0},"zone":${zone()},"key":${js(hash(m.key))},"feel":${js(hash(m.feel))},"found":[${found.join(',')}]}`;
      if (txt === keptTxt) return;
      try { ls().setItem(KEEP, txt); keptTxt = txt; } catch (e) { /* storage full or blocked: the next launch works it out */ }
    }, { timeout: 5000 });
  }
  top.clear = () => {
    memo = new WeakMap();
    keptTxt = '';
    try { const store = ls(); if (store) store.removeItem(KEEP); } catch (e) { /* nothing kept */ }
  };
  top.stats = stats;
  function dismiss(S, id, day) { S.insightsDismissed = S.insightsDismissed || {}; S.insightsDismissed[id] = day; }
  function markShown(S, list, day) { S.insightsShown = S.insightsShown || {}; for (const x of list) if (S.insightsShown[x.id] == null) S.insightsShown[x.id] = day; }

  GH.insights = { all, top, warm, dismiss, markShown, spearman, slope, mean, sd, MIN_PAIRS };
})(typeof window !== 'undefined' ? window : globalThis);
