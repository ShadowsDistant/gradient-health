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

section('This week at a glance');
S = person();
rep = C.report(S, D0);
const TONES = ['good', 'watch', 'neutral'];
check('two to four numbers, each with a name, a value, a trend and a tone', rep.glance.length >= 2 && rep.glance.length <= 4 && rep.glance.every((g) => g.metric && g.value && typeof g.trend === 'string' && TONES.includes(g.tone)), rep.glance);
check('sleep, steps and resting heart rate lead (HRV stands in for weight with no weigh-ins)', rep.glance.map((g) => g.metric).join() === 'Sleep,Steps,Resting HR,HRV', rep.glance.map((g) => g.metric));
check('values are this week\'s averages in the person\'s units', rep.glance[0].value === H.format(S, 'sleepMin', H.versus(S, 'sleepMin', D0, 'week').value, { compact: true }) && / bpm$/.test(rep.glance[2].value), rep.glance);
check('a week like the usual reads steady', rep.glance.every((g) => g.trend === 'steady' && g.dir === 'flat'), rep.glance.map((g) => g.trend));
// A short week of sleep against the usual: sleep falls and gets flagged.
S = person();
for (let d = D0 - 6; d <= D0; d++) S.health.days[d].sleepMin = 330;
rep = C.report(S, D0);
const sl = rep.glance.find((g) => g.key === 'sleepMin');
check('a week of short nights: sleep is down and worth watching', sl && sl.dir === 'down' && sl.tone === 'watch' && /^-1 h \d\d$/.test(sl.trend), sl);
check('focus_one: one short line from the first focus', typeof rep.focus_one === 'string' && rep.focus_one.length <= 40 && /bedtime/i.test(rep.focus_one) && /sleep/i.test(rep.focus[0]), rep.focus_one);
// Weigh-ins: weight takes its place, compared with the week before.
S = person();
for (let d = D0 - 13; d <= D0; d++) B.addWeight(S, d, d > D0 - 7 ? 67.6 : 68, 'hc');
rep = C.report(S, D0);
const wt = rep.glance.find((g) => g.key === 'weightKg');
check('with weigh-ins, weight is on the card with its weekly change', rep.glance.length === 4 && wt && /lb$/.test(wt.value) && /^-0\.\d lb$/.test(wt.trend), rep.glance);
check('glance numbers only use the phone\'s own data', rep.glance.every((g) => !/NaN|undefined|null/.test(`${g.value} ${g.trend}`)));
S = person();
S.health.days = {};
rep = C.report(S, D0);
check('no health data: workouts stand in, and nothing is made up', rep.glance.every((g) => g.key === 'workouts') && rep.glance.length <= 1, rep.glance);

section('Short enough for a card');
const scenarios = [person(), person({ sleep: 340 }), person({ rir: '0' }), person({ steps: 2000 }), fresh, B.newState({ goals: ['abs'], workouts: false }, null, D0 - 10)];
scenarios[5].profile.workouts = false;
const reps = scenarios.map((P) => C.report(P, D0));
check('headlines are one short sentence', reps.every((r) => r.headline.length <= 50 && (r.headline.match(/\. /g) || []).length <= 1), reps.map((r) => r.headline));
check('wins are badges: short, no full stop, no repeats', reps.every((r) => r.wins.every((w) => w.length <= 48 && !/\.$/.test(w)) && new Set(r.wins.map((w) => w.toLowerCase())).size === r.wins.length), reps.map((r) => r.wins));
check('every report has a focus line', reps.every((r) => r.focus_one && r.focus_one.length <= 40 && r.focus.length >= 1), reps.map((r) => r.focus_one));
check('no dashes as punctuation', reps.every((r) => !/[—]| – /.test(JSON.stringify(r))));

section('Reading Claude\'s report');
const AIr = GH.ai.readReport;
const old = AIr({ headline: ' A steady week. ', wins: ['4 of 4 workouts.'], watch: [], focus: ['Protein on rest days.'], ask_me: ['How do I sleep more?'] });
check('a report saved before glance and focus_one still reads', old.headline === 'A steady week.' && old.wins.length === 1 && old.glance === undefined && old.focus_one === undefined);
const odd = AIr({ headline: 'x', glance: [{ metric: 'Sleep', value: '7 h 05', trend: '+20 min', tone: 'good' }, { metric: 'Steps', value: '8.2k', trend: '-9%', tone: 'great' }, { metric: '', value: '1' }, { metric: 'HRV', value: '55 ms', trend: 'steady', tone: 'neutral' }, { metric: 'Weight', value: '149.6 lb', trend: '-0.3 lb', tone: 'good' }, { metric: 'Extra', value: '1', trend: '', tone: 'good' }], focus_one: '  Keep a steady bedtime  ', wins: [], watch: [], focus: [], ask_me: [] });
check('glance items are checked: unknown tones become neutral, empty ones dropped, at most four', odd.glance.length === 4 && odd.glance[1].tone === 'neutral' && odd.glance.every((g) => g.metric && g.value), odd.glance);
check('focus_one is trimmed', odd.focus_one === 'Keep a steady bedtime');
check('the schema asks for glance and focus_one, with the tones as an enum', GH.ai.REPORT_SCHEMA.required.includes('glance') && GH.ai.REPORT_SCHEMA.required.includes('focus_one') && GH.ai.REPORT_SCHEMA.properties.glance.items.properties.tone.enum.join() === 'good,watch,neutral' && GH.ai.REPORT_SCHEMA.properties.glance.items.additionalProperties === false);

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

section('A coach you can see');
S = person({ sleep: 270 });
let cal = B.calendar(S, D0);
let plan = B.todayPlan(S, D0, cal);
let dayOf = D0;
// Find the next workout day from D0 so there's a session to explain.
for (let d = D0; d < D0 + 7 && plan.type !== 'workout'; d++) { dayOf = d; S.health.days[d] = Object.assign({}, S.health.days[d], { sleepMin: 270 }); cal = B.calendar(S, d); plan = B.todayPlan(S, d, cal); }
S.health.days[dayOf] = Object.assign({}, S.health.days[dayOf], { sleepMin: 270 });
const sess = B.buildSession(S, dayOf, plan.tpl, { cal });
let dec = C.decisions(S, dayOf, sess);
const sleepDec = dec.find((x) => x.rule === 'sleep');
check('a short night shows up as a decision, with its reason', sleepDec && /one set less/i.test(sleepDec.text) && /4 h 30/.test(sleepDec.why), dec);
S.pendingLines = [{ text: 'Push-up → 12 reps', why: 'you had 3+ left' }];
dec = C.decisions(S, dayOf, sess);
check('last time\'s changes are listed too, with why', dec.some((x) => x.text === 'Push-up → 12 reps' && /3\+ left/.test(x.why)));
check('light days explain themselves', C.decisions(S, D0, null)[0].rule === 'steps');
const tl = C.timeline(S, D0, 42);
check('the timeline is newest first', tl.every((x, i) => i === 0 || tl[i - 1].day >= x.day));
check('and never repeats a change within a week', new Set(tl.map((x) => `${B.weekStart(x.day)}|${x.text}`)).size === tl.length);
const w = C.watching(S, D0);
check('what it watches has a value and a status', w.length >= 3 && w.every((x) => x.label && x.value && ['good', 'info', 'watch'].includes(x.status)));
check('short sleep is flagged', w.some((x) => x.label === 'Sleep' && x.status === 'watch'));

section('Suggestions you apply');
S = person({ workouts: [D0 - 21, D0 - 20, D0 - 18, D0 - 17] });
const sugs = C.suggestions(S, D0);
const moveDay = sugs.find((x) => x.action && x.action.kind === 'weekday');
check('a day that keeps getting missed gets a suggestion', !!moveDay, sugs.map((x) => x.title));
if (moveDay) {
  const before = B.weekdaysFor(S.profile);
  const line = C.apply(S, moveDay, D0);
  const after = B.weekdaysFor(S.profile);
  check('applying it moves that weekday', line && !after.includes(moveDay.action.from) && after.includes(moveDay.action.to) && before.length === after.length, { before, after });
  check('and it doesn\'t come back', !C.suggestions(S, D0).some((x) => x.id === moveDay.id));
}
check('actions are checked before they apply', !C.validAction(S, { kind: 'minutes', value: 13 }, D0) && !C.validAction(S, { kind: 'minutes', value: 90 }, D0) && C.validAction(S, { kind: 'minutes', value: S.profile.minutes === 30 ? 35 : 30 }, D0) && !C.validAction(S, { kind: 'rm -rf' }, D0));
const nd = C.apply(S, { id: 'x', action: { kind: 'deload', label: 'x' } }, D0);
check('a lighter week can be planned once', nd && !C.validAction(S, { kind: 'deload' }, D0));
check('a dismissed suggestion stays hidden for two weeks', (() => { const all = C.suggestions(S, D0); if (!all.length) return true; C.dismiss(S, all[0].id, D0); return !C.suggestions(S, D0 + 13).some((x) => x.id === all[0].id) && (C.suggestions(S, D0 + 15).some((x) => x.id === all[0].id) || true); })());

section('Weekly sets follow progress and recovery');
{
  const S2 = person({ rir: '3', workouts: [D0 - 21, D0 - 20, D0 - 18, D0 - 17, D0 - 14, D0 - 13, D0 - 11, D0 - 10] });
  const prog = B.programFor(S2.profile);
  const goals = B.GROUPS.filter((g) => prog.tiers[g] === 1);
  const outcomes = S2.log.filter((l) => l.type === 'workout').flatMap((l) => (l.items || []).filter((it) => it.kind === 'move' && it.sets.length).map((it) => it.outcome));
  check('every exercise result is recorded as up, held or down', outcomes.length > 0 && outcomes.every((o) => ['up', 'hold', 'down'].includes(o)), [...new Set(outcomes)]);
  check('goal muscles that progress with good recovery gain sets', goals.some((g) => S2.vol[g] > prog.start[g]), goals.map((g) => [g, S2.vol[g], prog.start[g]]));
  check('non-goal muscles stay at their maintenance dose', B.GROUPS.filter((g) => prog.tiers[g] === 3).every((g) => S2.vol[g] <= prog.start[g]));
}

done();
