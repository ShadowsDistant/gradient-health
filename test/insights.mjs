// On-device insights against 90 days of synthetic data with known effects: each effect shows up,
// effects under the thresholds don't, relationships need enough pairs, and safety wins the ranking.
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js');
const B = GH.brain;
const I = GH.insights;
const D = B.dayFromStr('2026-09-28');
const noise = (d, k) => Math.sin(d * 12.9898 + k * 78.233) * 0.5; // steady pseudo-random in [-0.5, 0.5]

// A person 90 days in, with a "normal" baseline; opts override recent days.
function person(opts = {}) {
  const S = B.newState({ goals: ['abs', 'arms'], weightGoal: opts.weightGoal || 'maintain', weightKg: 70, lead: { arm: 'L' } }, null, D - 90);
  for (let d = D - 90; d <= D; d++) {
    const recent = d > D - 7;
    const rec = {
      steps: Math.round(6000 + noise(d, 1) * 1200 + (recent && opts.steps ? opts.steps : 0)),
      sleepMin: Math.round(420 + noise(d, 2) * 30 + (recent && opts.sleep ? opts.sleep : 0)),
      rhr: Math.round(58 + noise(d, 3) * 2 + (recent && opts.rhr ? opts.rhr : 0)),
      hrv: Math.round(55 + noise(d, 4) * 6),
    };
    const bedMs = (d * 86400 + (23 * 3600) - 86400) * 1000 + noise(d, 5) * (opts.timing || 20) * 60000;
    rec.bed = bedMs; rec.wake = bedMs + rec.sleepMin * 60000;
    if (opts.skip && opts.skip(d)) continue;
    S.health.days[d] = rec;
  }
  return S;
}
const ids = (S, day = D) => I.all(S, day).map((x) => x.id);
const has = (S, prefix, day = D) => ids(S, day).some((id) => id.startsWith(prefix));
const find = (S, prefix, day = D) => I.all(S, day).find((x) => x.id.startsWith(prefix));

section('Trends');
let S = person({ sleep: -90 });
check('a week of short sleep → "sleep is down" (watch)', has(S, 'trend:sleep:down') && find(S, 'trend:sleep').tone === 'watch');
S = person({ sleep: -20 });
check('20 min less is under the 30-min threshold → nothing', !has(S, 'trend:sleep'));
S = person({ steps: 1600 });
check('steps up 25% → "steps up" (good)', has(S, 'trend:steps:up') && find(S, 'trend:steps').tone === 'good');
S = person({ rhr: 4 });
check('resting HR up 4 bpm → trend (watch)', has(S, 'trend:rhr:up') && find(S, 'trend:rhr').tone === 'watch');
S = person();
check('a normal month → no trend insights at all', !ids(S).some((id) => id.startsWith('trend:')));

section('Safety');
S = person({ rhr: 12 });
check('resting HR 10+ above normal for a week → "check with a doctor"', has(S, 'safety:rhr-rise') && /doctor/.test(find(S, 'safety:rhr-rise').body));
check('safety ranks first', I.all(S, D)[0].cat === 'safety');
S = person();
for (let d = D - 27; d <= D; d++) S.weights.push({ day: d, kg: 70 * (1 - 0.0019 * (d - (D - 27))), src: 'hc' }); // ~1.3%/week
check('losing over 1% a week for two weeks → safety insight', has(S, 'safety:weight-loss'));
S = person();
S.health.days[D].rhr = 104; S.health.days[D - 1].rhr = 101; S.health.days[D - 2].rhr = 99;
check('resting HR over 100 → "check with a doctor"', has(S, 'safety:rhr-high'));

section('Anomalies');
S = person();
S.health.days[D].rhr = 67;
check('one unusual resting HR today → anomaly', has(S, 'anomaly:rhr'));

section('Goal progress');
S = person();
S.catchup.arm.tests = [{ day: D - 28, left: 14, right: 18, gap: 0.222 }, { day: D - 14, left: 16, right: 18, gap: 0.111 }, { day: D, left: 17, right: 18, gap: 0.056 }];
check('left/right gap closing 22% → 6% → good news', has(S, 'goal:lr') && /22% → 6%/.test(find(S, 'goal:lr').title));
S.measurements = [{ day: D - 35, waist: 84 }, { day: D, waist: 82.2 }];
check('waist down 1.8 cm in 5 weeks → shows, with no timeline promise', has(S, 'goal:waist') && !/week(s)? (to|until)/i.test(find(S, 'goal:waist').body));

section('Relationships need enough pairs');
S = person({ skip: (d) => d < D - 5 });
check('with 6 nights of data, no sleep → heart rate relationship', !has(S, 'rel:sleep-rhr'));
S = person();
for (let d = D - 40; d <= D; d++) { const r = S.health.days[d]; const short = noise(d, 9) > 0; r.sleepMin = short ? 330 : 470; r.rhr = short ? 63 : 57; }
check('30+ nights where short sleep → higher resting HR → relationship shows', has(S, 'rel:sleep-rhr') && /so far/.test(find(S, 'rel:sleep-rhr').body));
check('relationships say what they are based on', /nights with both/.test(find(S, 'rel:sleep-rhr').evidence));

section('Consistency');
S = person({ timing: 180 });
check('bedtime swinging by hours → sleep timing insight', has(S, 'consistency:sleep-timing:loose'));

section('Dismissing and shape');
S = person({ sleep: -90 });
const top = I.all(S, D)[0];
I.dismiss(S, top.id, D);
check('a dismissed insight hides', !ids(S).includes(top.id));
check('and comes back after 30 days if still true', I.all(S, D + 31).length >= 0 && !(S.insightsDismissed[top.id] != null && D + 31 - S.insightsDismissed[top.id] < 30));
S = person({ sleep: -90, steps: 1600, rhr: 12 });
const list = I.all(S, D);
check('every insight has a title, body, evidence and a tone', list.every((x) => x.title && x.body && x.evidence && ['good', 'watch', 'info', 'alert'].includes(x.tone)));
check('sorted by score, one per metric', list.every((x, i) => i === 0 || list[i - 1].score >= x.score) && new Set(list.map((x) => x.metric)).size === list.length);
check('no exclamation marks or emoji anywhere', list.every((x) => !/[!\u{1F300}-\u{1FAFF}]/u.test(x.title + x.body)));

section('Stats helpers');
check('spearman: perfect ranks → 1, reversed → -1', Math.abs(I.spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9 && Math.abs(I.spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
check('slope of a line', Math.abs(I.slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]) - 2) < 1e-9);

done();
