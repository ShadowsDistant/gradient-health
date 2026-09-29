// The built-in coach and the health sync details: the weekly report, answers from the person's own
// numbers, safety answers, the Claude app hand-off (no names or dates), the research page's data,
// how far back a sync reads, the partial first day of a read, and workouts written to Health Connect.
import { build } from 'esbuild';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/health.js', 'src/store.js', 'src/coach.js');
const bundle = await build({ entryPoints: [join(root, 'src/ai.js')], bundle: true, write: false, format: 'iife', platform: 'browser', target: ['es2022'], logLevel: 'silent' });
new Function(bundle.outputFiles[0].text)();
const B = GH.brain, C = GH.coach, H = GH.health, SC = GH.science;

/* ---------------------------------------------------------------- a person three weeks in */
const D0 = B.dayFromStr('2026-09-28');
function person(opts = {}) {
  const S = B.newState({ name: 'Sam', goals: ['abs', 'arms'], age: 19, equipment: { db: [8] }, weightKg: 68, lead: { arm: 'L' } }, { curlL: 14, curlR: 18 }, D0 - 21);
  for (let d = D0 - 34; d <= D0; d++) S.health.days[d] = { steps: (opts.steps || 6000) + (d % 5) * 200, sleepMin: (opts.sleep || 420) + (d % 3) * 10, rhr: 60, hrv: 55 };
  for (const d of opts.workouts || [D0 - 21, D0 - 20, D0 - 18, D0 - 17]) {
    B.startWorkout(S, d, { now: d * B.DAY_MS + 18 * 3600000 });
    let g = 0;
    while (S.active && S.active.idx < S.active.steps.length && g++ < 400) {
      const st = S.active.steps[S.active.idx];
      B.completeStep(S, st.kind === 'test' ? { value: 12 } : {});
      if (st.askRir) B.setRir(S, st.item, opts.rir || '12');
    }
    B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + 19 * 3600000 });
  }
  return S;
}

section('Weekly report');
let S = person();
let rep = C.report(S, D0);
check('same shape as the API report', typeof rep.headline === 'string' && ['wins', 'watch', 'focus', 'ask_me'].every((k) => Array.isArray(rep[k])));
check('at most three of each, and something to focus on', rep.wins.length <= 3 && rep.watch.length <= 3 && rep.focus.length >= 1 && rep.focus.length <= 3);
S = person({ sleep: 340 });
rep = C.report(S, D0);
check('short sleep all week → a sleep focus', rep.focus.some((f) => /sleep/i.test(f)), rep.focus);
S = person({ rir: '0' });
check('mostly 0 reps left → stop a rep or two short', C.report(S, D0).focus.some((f) => /1-2 reps left/.test(f)), C.report(S, D0).focus);
const fresh = B.newState({ goals: ['abs'] }, null, D0);
check('before any workout → a first-workout headline', /first workout/i.test(C.report(fresh, D0).headline));
check('no exclamation marks or emoji', !/[!\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify(C.report(person(), D0))));

section('Questions');
S = person();
const a = (q) => C.ask(S, D0, q);
check('sleep → averages from their own nights', a('How is my sleep?').topic === 'sleep' && /averaged \d+ h/.test(a('How is my sleep?').text));
check('steps → their daily average', a('am I walking enough').topic === 'steps' && /\d,\d{3} steps a day/.test(a('am I walking enough').text));
check('weight → the 7-day average', a('how is my weight trending').topic === 'weight' && /7-day average/.test(a('how is my weight trending').text));
check('protein → goal and today', a('how much protein should I eat').topic === 'protein' && /goal is \d+ g/.test(a('how much protein should I eat').text));
check('strength → levels', a('am I getting stronger?').topic === 'strength');
check('left and right → the last test', a('is my left arm catching up').topic === 'sides' && /gap/.test(a('is my left arm catching up').text));
check('why is today lighter → readiness', a('why is today lighter?').topic === 'today');
check('chest pain → stop and see a doctor, not coaching', a('I get chest pain during push-ups').topic === 'redflag' && /doctor/.test(a('I get chest pain during push-ups').text));
check('something off-topic → says what it can answer', a('what is the capital of France').topic === null && /Claude app/.test(a('what is the capital of France').text));
check('no data → says so instead of guessing', /don't have any sleep/.test(C.ask(fresh, D0, 'how did I sleep').text));

section('Claude app hand-off');
const prompt = C.claudePrompt(S, D0, 'What should I focus on?');
check('the question and the data summary are both there', /My question: What should I focus on\?/.test(prompt) && /LAST 28 DAYS/.test(prompt));
check('no name, dates or day numbers', !/Sam/.test(prompt) && !/\d{4}-\d{2}-\d{2}/.test(prompt) && !prompt.includes(String(D0)) && !/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(prompt));

section('How it works');
check('every rule has what it does, why, a level and research', SC.RULES.every((r) => r.does && r.why && SC.LEVELS[r.level] && r.refs.length && r.refs.every((id) => SC.REFS[id])));
// Papers link to their DOI (or PubMed); the one official report links to its publisher (FAO).
check('every reference links to its DOI, PubMed or the publishing agency', Object.values(SC.REFS).every((x) => /^https:\/\/(doi\.org\/10\.|pubmed\.ncbi\.nlm\.nih\.gov\/|www\.fao\.org\/)/.test(SC.refUrl(x))));
check('no dashes used as punctuation in the copy', SC.RULES.every((r) => !/[—]| – /.test(r.does + r.why + (r.caveat || ''))));
const restCheck = (supersets) => {
  const S2 = person();
  S2.profile.prefs.supersets = supersets;
  const items = [0, 1, 2, 3].flatMap((i) => B.buildSession(S2, D0 + i, i % 2, {}).items);
  const solo = items.filter((it) => !it.superset);
  const big = solo.filter((it) => ['push', 'row', 'squat', 'hinge', 'pull', 'chestDb'].includes(it.fam));
  const small = solo.filter((it) => !['push', 'row', 'squat', 'hinge', 'pull', 'chestDb'].includes(it.fam));
  return { ok: big.every((it) => it.rest === 90) && small.every((it) => it.rest === 60) && items.filter((it) => it.superset).every((it) => it.rest === 60), big: big.length, paired: items.filter((it) => it.superset).length };
};
const rc1 = restCheck(false), rc2 = restCheck(true);
check('the rest rule matches the brain: 90 s after big moves on their own, 60 s after small ones', rc1.ok && rc1.big > 0, rc1);
check('and 60 s inside supersets, where each muscle rests through its partner\'s set', rc2.ok && rc2.paired > 0, rc2);

section('Sync window');
S = person();
const now = D0 * B.DAY_MS + 12 * 3600000;
check('first sync reads 90 days', H.syncDays(Object.assign({}, S, { health: { lastSync: null } }), now) === 90);
check('an hour later: 3 days', H.syncDays({ health: { lastSync: now - 3600000 } }, now) === 3);
check('ten days later: 12 days', H.syncDays({ health: { lastSync: now - 10 * B.DAY_MS } }, now) === 12);
check('months later: capped at 30', H.syncDays({ health: { lastSync: now - 90 * B.DAY_MS } }, now) === 30);

section('A read that starts partway through a day');
S = B.newState({ goals: ['abs'], weightKg: 70 }, null, D0 - 10);
const iso = (t) => new Date(t).toISOString();
const morning = (d, h) => d * B.DAY_MS + h * 3600000 + 4 * 3600000; // day starts at 4 am
// A full read first: a weigh-in at 8 am on D0-3.
H.ingest(S, { ok: true, from: iso(morning(D0 - 5, 0)), to: iso(morning(D0, 8)), weight: [{ time: iso(morning(D0 - 3, 4)), kg: 70.2 }], steps: [], sleep: [], restingHr: [], hrv: [], exercise: [] }, morning(D0, 8));
check('weigh-in stored', S.health.days[D0 - 3] && S.health.days[D0 - 3].weightKg === 70.2);
// Then a short read that starts at noon on D0-3: the 8 am weigh-in isn't in it.
H.ingest(S, { ok: true, from: iso(morning(D0 - 3, 8)), to: iso(morning(D0, 9)), weight: [], steps: [], sleep: [], restingHr: [{ time: iso(morning(D0 - 3, 10)), bpm: 61 }], hrv: [], exercise: [] }, morning(D0, 9));
check('the partial first day keeps what came before the read', S.health.days[D0 - 3].weightKg === 70.2 && S.weights.some((w) => w.day === D0 - 3 && w.src === 'hc'));
check('and still takes in what the read found', S.health.days[D0 - 3].rhr === 61);

section('Workouts written to Health Connect');
S = person();
const log = S.log.filter((l) => l.type === 'workout').slice(-1)[0];
const rec = H.workoutRecord(S, log);
check('one record per day, as strength training, with real times', rec && rec.id === `gradient-${B.dayStr(log.day)}` && rec.type === 'strength_training' && rec.end > rec.start && rec.end - rec.start <= 4 * 3600000);
check('a check-in hours later isn\'t written with a made-up end time', H.workoutRecord(S, Object.assign({}, log, { endedAt: log.startedAt + 9 * 3600000 })) === null);
const sent = [];
globalThis.AndroidBridge = { hcCanWrite: () => true, hcWriteWorkout: (j) => sent.push(JSON.parse(j)) };
check('sent through the bridge when allowed', H.writeWorkout(S, log) && sent.length === 1 && sent[0].id === rec.id);
globalThis.__gh.onHealthWrite({ id: rec.id, ok: true });
check('marked as written when Health Connect confirms', !!S.health.written[rec.id]);
S.health.write = false;
check('not sent when switched off', !H.writeWorkout(S, log) && sent.length === 1);
S.health.write = true;
check('catch-up skips what was already written', H.writeRecent(S, 60) === S.log.filter((l) => l.type === 'workout').length - 1);
globalThis.AndroidBridge = { hcCanWrite: () => false, hcWriteWorkout: () => sent.push('x') };
check('not sent without the permission', !H.writeWorkout(S, log));
delete globalThis.AndroidBridge;

done();
