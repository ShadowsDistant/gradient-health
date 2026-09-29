// The built-in coach and the health sync details: the weekly report, answers from the person's own
// numbers, safety answers, the Claude app hand-off (no names or dates), the research page's data,
// how far back a sync reads, the partial first day of a read, and workouts written to Health Connect.
import { build } from 'esbuild';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/store.js', 'src/coach.js', 'src/tailor.js');
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
  check('muscle ids from the body map mean their group', T.valid(S, { focus: ['calves'] }).focus.join() === 'legs' && T.valid(S, { focus: ['upperBack'] }).focus.join() === 'back');
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
  check('the on-device grammar only allows the fields and values the app reads', /focus/.test(T.GRAMMAR) && /shoulders/.test(T.GRAMMAR) && /avoid_joints/.test(T.GRAMMAR) && !/calves/.test(T.GRAMMAR));
}

done();
