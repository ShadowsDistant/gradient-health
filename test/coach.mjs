// The built-in coach and the health sync details: the weekly report, answers from the person's own
// numbers, safety answers, the Claude app hand-off (no names or dates), the research page's data,
// how far back a sync reads, the partial first day of a read, and workouts written to Health Connect.
import { build } from 'esbuild';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/store.js', 'src/coach.js', 'src/chats.js', 'src/tailor.js', 'src/devicecoach.js', 'src/ui/embeds.js');
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
// (Their first weeks' sets aim for 2-3 left, so that's what it asks for: brain.effortFor.)
check('mostly 0 reps left → stop with the reps left the sets aim for', C.report(S, D0).focus.some((f) => /^Stop most sets with 2-3 reps left\./.test(f)), C.report(S, D0).focus);
{
  // 1.13: the answers against each exercise's aim. 3 left is on a 2-3 aim; 4 or more is past it.
  const effort = (P) => C.watching(P, D0).find((w) => w.label === 'Effort');
  const on = person({ rir: '3' });
  check('3 left on a 2-3 aim is right where it should be, and the coach names the aim', effort(on).value === '2-3 reps left' && effort(on).status === 'good', effort(on));
  const lots = person({ rir: '4' });
  check('4 or more left, past the aim: lots left in the tank, and a word on honest answers', effort(lots).value === 'Lots left in the tank' && C.report(lots, D0).focus.some((f) => /Honest answers/.test(f)), [effort(lots), C.report(lots, D0).focus]);
  // A log from before 1.13 has no aim: its 3 meant "3 or more", plenty left, as it always counted.
  const old = person({ rir: '3' });
  for (const l of old.log) for (const it of l.items || []) delete it.aim;
  check('older logs: a 3 still counts as 3 or more', effort(old).value === 'Lots left in the tank', effort(old));
  const sum = (P) => GH.ai.summary(P, D0).split('\n').filter((l) => /Reps left|aim/.test(l)).join(' | ');
  check('Claude\'s summary has 0, 1-2, 3 and 4 or more, and how they sat against the aims', /0 → 0, 1-2 → 0, 3 → \d+, 4 or more → 0/.test(sum(on)) && /Against each exercise's aim \(2-3 reps left\): 0 to failure, \d+ on it, 0 with more left/.test(sum(on)), sum(on));
  check('and older answers of 3 as "3 or more", with no aim line for them', /3 → 0, 4 or more → 0, 3 or more \(older answers\) → \d+/.test(sum(old)) && !/Against each/.test(sum(old)), sum(old));
}
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
check('no health data: no numbers rather than a lone one, and nothing made up', rep.glance.length === 0, rep.glance);

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
  const BIG = ['push', 'press', 'row', 'squat', 'hinge', 'pull', 'chestDb'];
  const big = solo.filter((it) => BIG.includes(it.fam));
  const small = solo.filter((it) => !BIG.includes(it.fam));
  // (1.13: a session with time to spare gives what's done on its own at 60 s 90 s instead.)
  return { ok: big.every((it) => it.rest === 90) && small.every((it) => it.rest === 60 || it.rest === 90) && items.filter((it) => it.superset).every((it) => it.rest === 60), big: big.length, small: small.map((it) => `${it.fam}@${it.rest}`), paired: items.filter((it) => it.superset).length };
};
const rc1 = restCheck(false), rc2 = restCheck(true);
check('the rest rule matches the brain: 90 s after big moves on their own, 60 s after small ones (90 with time to spare)', rc1.ok && rc1.big > 0 && ['push', 'press', 'row', 'squat', 'hinge', 'pull', 'chestDb'].every((f) => B.restFor(person(), f) === 90) && ['curl', 'raise', 'calf'].every((f) => B.restFor(person(), f) === 60), rc1);
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

section('Plans for different bodies');
{
  const S3 = B.newState({ goals: ['strength'], age: 72, conditions: ['balance', 'ra'], equipment: { db: [5], band: true } }, null, D0);
  const ask3 = (q) => C.ask(S3, D0, q);
  check('a question about a condition gets what the plan does about it', ask3('is this ok with my arthritis?').topic === 'bodies' && /rheumatoid arthritis/.test(ask3('is this ok with my arthritis?').text) && /Balance practice/.test(ask3('is this ok with my arthritis?').text));
  check('pregnancy: ask a midwife or doctor', /midwife or doctor/.test(ask3('can I train while pregnant').text));
  check('heart rate questions still go to heart, chest pain is still a red flag', ask3('what is my resting heart rate').topic === 'heart' && ask3('chest pain when I train with arthritis').topic === 'redflag');
  const pl = B.todayPlan(S3, D0);
  const sess3 = B.buildSession(S3, D0, pl.tpl != null ? pl.tpl : 0, {});
  const dec3 = C.decisions(S3, D0, sess3);
  check('the coach says why balance comes first', dec3.some((x) => x.rule === 'balance' && /Balance practice first/.test(x.text)), dec3.map((x) => x.text));
  S3.feel[D0] = { flare: true };
  const flare = B.buildSession(S3, D0, pl.tpl != null ? pl.tpl : 0, {});
  check('and explains a flare day', flare.flare && C.decisions(S3, D0, flare)[0].rule === 'arthritis');
  const brief = GH.deviceCoach.brief(S3, D0);
  check('the on-device coach knows what the plan works around; Claude\'s summary doesn\'t', (/adapted for age band 65 and over; planned around balance and rheumatoid arthritis/.test(brief)) && !/arthritis|balance/i.test(GH.ai.summary ? GH.ai.summary(S3, D0) : ''), brief);
}

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
/* ---------------------------------------------------------------- Tailor my plan */
section('Tailor my plan: reading a request');
{
  const T = GH.tailor;
  const P = (x) => T.parse(x);
  check('"more legs, my knees hurt": legs first, easy on the knees', P('More legs please, my knees hurt').focus.join() === 'legs' && P('More legs please, my knees hurt').avoid_joints.join() === 'knee');
  check('"my back hurts" is about the back as a joint, not training it', P('my back hurts').focus.length === 0 && P('my back hurts').avoid_joints.join() === 'back');
  check('"focus on my back" is training it', P('focus on my back').focus.join() === 'back' && !P('focus on my back').avoid_joints.length);
  check('minutes and days', P('20 minute workouts, 3 days a week').minutes === 20 && P('20 minute workouts, 3 days a week').days === 3);
  check('"shorter workouts" and "fewer days" are steps from now', P('shorter workouts').minutes_by === -10 && P('I want fewer days').days_by === -1);
  check('no jumping (and why: the neighbours)', P('no jumping please').no_jumping === true && P('my neighbours are downstairs so nothing noisy').no_jumping === true);
  check('a move they hate is left out, by name', P('I hate burpees').avoid_moves.length > 0 && P('I hate burpees').avoid_moves.every((id) => /burpee/i.test(GH.moves.MOVES[id].name)) && !P('I hate burpees').no_jumping);
  check('goals: losing fat, getting stronger', P('I want to lose fat and get stronger').goals.join() === 'fat,strength');
  check('easier or harder', P('go easy on me, I\'m exhausted').gentle === true && P('it\'s too easy, push me').gentle === false);
  check('new kit', P('I got a resistance band').add_equipment.join() === 'band');
  check('"less arms, more legs" only asks for more legs', P('less arms more legs').focus.join() === 'legs');
  check('small talk changes nothing', T.empty(T.valid(person(), P('hello, how are you?'))));
  check('a single muscle is a muscle to lean toward, not its whole group', P('Train my calves more').muscles.join() === 'calves' && !P('Train my calves more').focus.length);
  check('"more legs and glutes": legs first, and glutes leaned toward', P('More legs and glutes').focus.join() === 'legs' && P('More legs and glutes').muscles.join() === 'glutes');
  check('"upper back" and "rear delts" aren\'t the whole back or shoulders', P('more upper back and rear delts').muscles.sort().join() === 'rearDelts,upperBack' && !P('more upper back and rear delts').focus.length);
  check('"my lower back hurts" is a joint, "strengthen my lower back" a muscle', !P('my lower back hurts').muscles.length && P('my lower back hurts').avoid_joints.join() === 'back' && P('strengthen my lower back').muscles.join() === 'lowerBack');
}
section('Tailor my plan: checking and applying');
{
  const T = GH.tailor;
  const S = person();
  const before = JSON.stringify({ goals: S.profile.goals, minutes: S.profile.minutes, careful: S.profile.careful, excl: S.excluded || [], vol: S.vol });
  const v = T.valid(S, { focus: ['chest', 'biceps', 'triceps', 'legs'], minutes: 99, days: 9, avoid_joints: ['knee', 'toe'], avoid_moves: ['nope'], no_jumping: true, gentle: 'yes', add_equipment: ['band', 'jetpack'], note: 'x'.repeat(400) });
  check('at most two goals come first (arms counts once for biceps and triceps)', v.focus.join() === 'chest,biceps,triceps', v.focus);
  check('minutes and days are held to what the plan allows', v.minutes === 60 && v.days === 6, v);
  check('unknown joints, moves and kit are dropped; a note is kept short', v.avoid_joints.join() === 'knee' && !v.avoid_moves.length && v.add_equipment.join() === 'band' && v.note.length === 200 && v.gentle == null);
  check('muscle ids from the body map are muscles to lean toward', T.valid(S, { focus: ['calves'] }).muscles.join() === 'calves' && T.valid(S, { muscles: ['upperBack'] }).muscles.join() === 'upperBack' && !T.valid(S, { focus: ['calves'] }).focus.length);
  check('what already is isn\'t a change', T.empty(T.valid(S, { minutes: S.profile.minutes, days: S.profile.days, focus: [] })));
  const t = T.valid(S, T.parse('More legs, my knees hurt, 30 minute workouts'));
  const { lines } = T.plan(S, t);
  check('the changes are said in plain words: more legs, knees, time', lines.some((l) => /^Legs: more each week/.test(l.text) && /days a week, building to \d+ sets \(was \d+, \d+\)/.test(l.sub)) && lines.some((l) => /Easy on your knees/.test(l.text)) && lines.some((l) => /about 30 minutes/.test(l.text)), lines.map((l) => l.text));
  // Someone further along: putting legs first moves another muscle down, and that's said too.
  const S3 = person();
  S3.profile.experience = '3plus';
  S3.profile.goals = ['abs', 'arms', 'chest'];
  const less = T.plan(S3, T.valid(S3, T.parse('more legs and back'))).lines.map((l) => l.text);
  check('when a muscle gets less to make room, that\'s said', less.some((x) => /^Legs: more/.test(x)) && less.some((x) => /a little less/.test(x)), less);
  const applied = T.apply(S, D0, t);
  const prog = B.programFor(S.profile);
  check('applying puts legs first, goes easy on the knees and sets the time', applied && S.profile.goals[0] === 'legs' && prog.tiers.legs === 1 && S.profile.careful.includes('knee') && S.profile.minutes === 30);
  check('the next workout follows it', (() => { const plan = B.todayPlan(S, D0 + 1); return plan.type !== 'workout' || B.buildSession(S, D0 + 1, plan.tpl, {}).items.every((it) => { const m = GH.moves.MOVES[it.id || it.move || it.rung]; return !m || !((m.impact || m.complex) && (m.joints || []).includes('knee')); }); })());
  check('it shows in the Coach timeline', C.timeline(S, D0, 7).some((x) => /^Tailored: /.test(x.text)));
  check('undo puts everything back', T.undo(S, D0) && JSON.stringify({ goals: S.profile.goals, minutes: S.profile.minutes, careful: S.profile.careful, excl: S.excluded || [], vol: S.vol }) === before && !C.timeline(S, D0, 7).some((x) => /^Tailored: /.test(x.text)));
  const S2 = person();
  const burpees = T.valid(S2, T.parse('no burpees'));
  T.apply(S2, D0, burpees);
  check('a move left out stays out', burpees.avoid_moves.length && burpees.avoid_moves.every((id) => S2.excluded.includes(id)));
  const cut = T.read('{"focus":["legs"],"goals":[],"minutes":20,"days":null,"avoid_joints":["knee"],"no_jumping":null,"gentle":null,"note":"More legs and easy on');
  check('an answer cut off in its note is still read', cut && cut.focus.join() === 'legs' && cut.minutes === 20 && /^More legs/.test(cut.note), cut);
  check('and nonsense isn\'t', T.read('hello') === null && T.read('') === null);
  // A single muscle: the plan leans toward it (profile.focus), and Undo takes it off again.
  const S4 = person();
  const calves = T.valid(S4, T.parse('Train my calves more'));
  const said = T.plan(S4, calves).lines.map((l) => l.text);
  check('"Train my calves more" says calves get more of the work', calves.muscles.join() === 'calves' && said.some((x) => /^Calves: more of the work/.test(x)), said);
  const legsBefore = B.programFor(S4.profile).tiers.legs;
  T.apply(S4, D0, calves);
  check('applying makes calves a focus, and lifts legs a tier', (S4.profile.focus || []).join() === 'calves' && B.programFor(S4.profile).tiers.legs === Math.max(1, legsBefore - 1), [S4.profile.focus, legsBefore, B.programFor(S4.profile).tiers.legs]);
  check('a model naming a muscle in focus counts it as a muscle', T.valid(person(), { focus: ['hamstrings', 'chest'] }).muscles.join() === 'hamstrings' && T.valid(person(), { focus: ['hamstrings', 'chest'] }).focus.join() === 'chest');
  check('a muscle already a focus isn\'t asked again', T.empty(T.valid(S4, T.parse('more calves'))));
  T.undo(S4, D0);
  check('undo takes the focus off', !(S4.profile.focus || []).length);
  const read = T.ground({ focus: ['quads'], goals: ['strength'], minutes: 20, days: 2, avoid_joints: ['knee', 'ankle'], no_jumping: true, gentle: true, add_equipment: ['band'] }, 'More legs please, my knees hurt, and I only have 20 minutes');
  check('a model\'s reading keeps only what the request talks about', read.minutes === 20 && read.days === null && read.avoid_joints.join() === 'knee' && read.no_jumping === null && read.gentle === null && !read.goals.length && !read.add_equipment.length && read.focus.join() === 'quads', read);
  check('and a joint it doesn\'t name when something still hurts', T.ground({ avoid_joints: ['knee'] }, 'my leg hurts when I squat').avoid_joints.join() === 'knee' && !T.ground({ avoid_joints: ['knee'] }, 'more arms please').avoid_joints.length);
  check('the on-device grammar only allows the fields and values the app reads', /focus/.test(T.GRAMMAR) && /shoulders/.test(T.GRAMMAR) && /avoid_joints/.test(T.GRAMMAR) && /calves/.test(T.GRAMMAR) && !/obliques|rearDelts/.test(T.GRAMMAR));
}

section('The on-device coach keeps to the app\'s numbers');
{
  const DC = GH.deviceCoach;
  const walker = person({ steps: 9000 }), sitter = person({ steps: 3000 });
  check('a yes-or-no question the numbers settle gets the app\'s own yes or no', C.verdict(walker, D0, 'Am I doing enough steps?') === 'Yes' && C.verdict(sitter, D0, 'Am I walking enough?') === 'Not quite');
  check('the chat\'s own "Am I moving enough?" counts as a steps question', C.topicOf('Am I moving enough?') === 'steps' && C.verdict(walker, D0, 'Am I moving enough?') === 'Yes');
  check('the same for sleep', C.verdict(person({ sleep: 480 }), D0, 'Am I sleeping enough?') === 'Yes' && C.verdict(person({ sleep: 340 }), D0, 'Do I get enough sleep?') === 'Not quite');
  const S = person();
  const strong = C.verdict(S, D0, 'Am I getting stronger?');
  check('"Am I getting stronger?" agrees with the app\'s answer', strong === (/^Yes/.test(C.ask(S, D0, 'Am I getting stronger?').text) ? 'Yes' : 'Not yet'), strong);
  check('a question asked the other way round, or not yes-or-no, gets none', [
    C.verdict(S, D0, 'Am I getting weaker?'), C.verdict(walker, D0, 'Am I walking too much?'), C.verdict(walker, D0, 'Why aren\'t I doing enough steps?'),
    C.verdict(walker, D0, 'How are my steps?'), C.verdict(S, D0, 'Is my heart rate OK?'),
  ].every((x) => x === null));
  check('the answer starts from it', DC.lead(walker, D0, 'Am I doing enough steps?') === 'Yes,' && DC.lead(walker, D0, 'How are my steps?') === '');

  const given = 'Steps: 7675 steps on average this week (usually 7020 steps); daily goal 8000. Weight: 68.4 kg. Sleep 6 h 59.';
  const k = DC.keepToGiven('You walk 7,675 steps a day. That\'s 655 more than usual. Your goal is 8,000.', given);
  check('a sentence with a number it wasn\'t given is left out', k.cut === 1 && k.text === 'You walk 7,675 steps a day. Your goal is 8,000.', k);
  check('numbers it was given, rounded or with commas, stay', DC.keepToGiven('You weigh about 68 kg and slept 6 h 59, against a goal of 8,000.', given).cut === 0);
  const pg = 'Your goal is 10% above your usual 7675, and a short night cut performance by about 7.6%. Level 5 of 8.';
  check('a percentage it worked out itself goes, even when the number is elsewhere in the prompt', DC.keepToGiven('You walk 7,751 steps, which is 8% above your usual. Keep it up.', `${pg} 7751`).text === 'Keep it up.');
  check('a percentage it was given stays', DC.keepToGiven('Your goal is 10% above your usual, and a short night costs about 7.6 percent.', pg).cut === 0);
  check('an answer with nothing made up is kept exactly', DC.keepToGiven('Yes, you walk plenty.\nKeep it up.', given).text === 'Yes, you walk plenty.\nKeep it up.');
  const q = 'Am I doing enough steps?';
  const cut = DC.finish(walker, D0, q, 'Yes, you walk 7675 steps a day, which is great for your health. That puts you in the top 12% of people.', given, 'Yes,');
  check('a made-up line goes and a note says so', cut.cut === 1 && !/12%/.test(cut.text) && /7675/.test(cut.text) && /Left out a line/.test(cut.note), cut);
  const bad = DC.finish(walker, D0, q, 'Yes, 12,000 steps.', given, 'Yes,');
  check('if too little is left, the app\'s own answer stands in', bad.replaced && bad.text === C.ask(walker, D0, q).text && /didn't match your numbers/.test(bad.note), bad);
  const none = DC.finish(walker, D0, q, 'Yes,', given, 'Yes,');
  check('and when all it wrote was the yes or no', none.replaced && /didn't answer/.test(none.note), none);
  const fine = DC.finish(walker, D0, q, 'Yes, you walk 7675 steps a day, above what most studies link to better health.', given, 'Yes,');
  check('a good answer goes through untouched, with no note', !fine.replaced && !fine.note && fine.text.startsWith('Yes, you walk 7675'), fine);
  // The check is the coach's own (GH.coach), shared by the on-device coach, Claude's chat answers and
  // the plan review's text; only the name in the note changes.
  const line = 'You walk 7,675 steps a day. That\'s 655 more than usual. Your goal is 8,000.';
  check('the number check lives in the coach, the same for every model', JSON.stringify(C.keepToGiven(line, given)) === JSON.stringify(DC.keepToGiven(line, given)));
  const claude = C.grounded(walker, D0, q, 'Yes, 12,000 steps.', given, 'Yes,', 'Claude');
  check('and the stand-in note names who answered', claude.replaced && claude.text === C.ask(walker, D0, q).text && /^Claude's answer didn't match your numbers, so this is the app's own\.$/.test(claude.note), claude);

  // A question built on something that isn't so starts from the app's correction.
  const full = person(), tired = person({ sleep: 270 });
  const fullDay = B.todayPlan(full, D0).type === 'workout' && !B.readiness(full, D0).reasons.length;
  check('"Why is today lighter?" on a full day starts from "Today isn\'t lighter:"', !fullDay || (C.correction(full, D0, 'Why is today lighter?') === 'Today isn\'t lighter:' && DC.lead(full, D0, 'Why is today lighter?') === 'Today isn\'t lighter:'), { fullDay });
  check('but not when today really is lighter, or for other questions', C.correction(tired, D0, 'Why is today lighter?') === null && C.correction(full, D0, 'How is my sleep?') === null);
  const corrected = DC.finish(full, D0, 'Why is today lighter?', 'Today isn\'t lighter:', 'Today isn\'t lighter:', 'Today isn\'t lighter:');
  check('a correction with nothing after it counts as no answer', corrected.replaced && /didn't answer/.test(corrected.note), corrected);

  // ask() end to end, with a stand-in for the model.
  let sent = null;
  const reply = (text) => ({
    MODELS: [], available: () => ({ ok: true }), installed: async () => [{ id: 'q35-08' }], loaded: () => ({ id: 'q35-08' }), load: async () => {},
    stats: { id: 'q35-08', tokens: 20, tokensPerSec: 12 },
    chat: async (msgs, o) => { sent = { msgs, o }; const t = (o.lead || '') + text; if (o.onToken) o.onToken(t, t); return t; },
  });
  const S2 = person({ steps: 9000 });
  S2.ai = S2.ai || {};
  GH.lazy = async () => reply(' you walk 1,234,567 steps a day.');
  const res = await DC.ask(S2, D0, 'Am I doing enough steps?');
  check('ask() sends the app\'s yes or no as the lead, at a low temperature', sent.o.lead === 'Yes,' && sent.o.temperature <= 0.3);
  check('a made-up number never reaches the chat: the app\'s own answer does, with the note', res.replaced && res.text === C.ask(S2, D0, 'Am I doing enough steps?').text && res.raw.startsWith('Yes, you walk 1,234,567'));
  const conv = GH.chats.current(S2);
  const last = conv.msgs[conv.msgs.length - 1];
  check('the chat keeps the checked answer and its note, in a conversation of its own', last.text === res.text && /didn't match/.test(last.note) && last.facts && last.facts.length > 0 && last.engine === 'device' && conv.title === 'Am I doing enough steps?' && res.chat === conv.id);
  check('with the embed for what was asked, worked out from its data', JSON.stringify(last.embeds) === '["steps:7d"]' && JSON.stringify(res.embeds) === '["steps:7d"]', last.embeds);

  // The format it's asked for: short and scannable; the safety lines are as they were.
  check('the small model is asked for one sentence with the number in bold, at most 3 points and a next step', /one sentence first, with the key number in \*\*bold\*\*/.test(DC.RULES) && /at most 3 short points/.test(DC.RULES) && /one short next step if there is one/.test(DC.RULES) && /Under 80 words/.test(DC.RULES) && !/\[\[/.test(DC.RULES));
  check('and still never to diagnose, and to see a doctor for the red flags', /never diagnose/.test(DC.RULES) && /tell them to see a doctor/.test(DC.RULES) && /Never make up a number/.test(DC.RULES));
  // A small model that copies marks it doesn't need: they go (the app adds the embeds itself).
  GH.lazy = async () => reply(' you walk plenty. [[steps]] Keep it up [[sle');
  const marks = await DC.ask(S2, D0, 'Am I doing enough steps?');
  check('stray [[ marks from the model go', !/\[|\]/.test(marks.text) && /you walk plenty\. Keep it up/.test(marks.text) && JSON.stringify(marks.embeds) === '["steps:7d"]', marks.text);
  // A follow-up goes with the last exchanges of its chat, as many as fit the model's memory.
  const prev = DC.messages(S2, D0, 'And my sleep?', 4);
  check('a follow-up goes with the chat\'s last two exchanges, without their embeds\' marks', prev.length === 6 && prev[1].role === 'user' && prev[2].role === 'assistant' && prev[3].content === 'Am I doing enough steps?' && !/\[\[/.test(prev.map((m) => m.content).join()));
  // Counted as the engine counts: 3 characters a token, a few for each message, and room to answer.
  const m2 = DC.messages(S2, D0, 'And my sleep?', 2, conv.id);
  const ctx2 = Math.ceil(m2.reduce((a, m) => a + m.content.length, 0) / 3) + m2.length * 6 + 64 + 320;
  check('fewer when they wouldn\'t fit its memory, none when nothing would', DC.fits(S2, D0, 'And my sleep?', conv.id, 1e6) === 4 && DC.fits(S2, D0, 'And my sleep?', conv.id, ctx2) === 2 && DC.fits(S2, D0, 'And my sleep?', conv.id, 100) === 0);
  check('a new chat goes with none', DC.messages(S2, D0, 'Hi', 4, null).length === 2 && DC.messages(S2, D0, 'Hi', 4, 'cNew').length === 2);
  sent = null;
  GH.lazy = async () => reply(' yes.');
  await DC.ask(S2, D0, 'And my sleep?');
  check('ask() sends them', sent.msgs.length === 6 && sent.msgs[3].content === 'Am I doing enough steps?');
}

done();
