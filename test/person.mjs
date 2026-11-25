// Plans a model builds and checks, made personal: who this is for a model (GH.person: what each
// reader may be told, and what the list shows), the rules a built plan is held to for this person,
// the reasons a plan gives for being theirs, the request's quick choices, what the plan review is
// told and may suggest, and what a model may not say (diet, medicine, weight loss for someone lean
// or under 18). Stand-in model answers throughout: a good personal plan is kept with its reasons, a
// rule-breaking one is put right or turned down, and reasons that name facts the model wasn't given
// are dropped.
import { load, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/planweek.js', 'src/tailor.js', 'src/store.js', 'src/coach.js', 'src/chats.js', 'src/spend.js', 'src/person.js', 'src/ai.js', 'src/customplan.js', 'src/planbuild.js', 'src/planreview.js', 'src/devicecoach.js');
const B = GH.brain, P = GH.person, C = GH.customPlan, AI = GH.ai, R = GH.planReview, K = GH.coach, MV = GH.moves.MOVES;

const D0 = B.dayFromStr('2026-11-23'); // a Monday
// The person the release was asked for: a lean young man who wants abs and arms, at home with one
// 10 lb dumbbell, eating little protein or fruit, three days of twenty minutes, never trained.
const OWNER = { goals: ['abs', 'arms'], experience: 'never', days: 3, minutes: 20, age: 19, sex: 'male', heightCm: 183, weightKg: 68, units: 'lb', equipment: { db: [10], chair: true, wall: true, towel: true }, eats: { protein: 'low', produce: 'low' } };
// A state, with `weeks` of workouts behind it (only: the weekdays they turn up on, when not all;
// mins: how long each took).
function person(profile, weeks = 0, o = {}) {
  const S = B.newState(profile, null, D0 - weeks * 7);
  C.ensure(S);
  for (let d = D0 - weeks * 7; d < D0; d++) {
    if (B.todayPlan(S, d).type !== 'workout') continue;
    if (o.only && !o.only.includes(B.weekday(d))) continue;
    B.startWorkout(S, d, { now: d * B.DAY_MS });
    let g = 0;
    while (S.active && S.active.idx < S.active.steps.length && g++ < 400) { const st = S.active.steps[S.active.idx]; B.completeStep(S, {}); if (st.askRir) B.setRir(S, st.item, '12'); }
    B.finishWorkout(S, { rating: 'right', now: d * B.DAY_MS + (o.mins || 22) * 60000 });
  }
  return S;
}
const allow = (S, v) => { S.ai.consentAt = 1; if (v) S.ai.consentV = v; S.ai.mode = 'api'; S.ai.enabled = true; return S; };
const text = (lines) => lines.join('\n');
AI.setKey('fake-TESTKEY-0123456789abcdefghijklmnop');

/* ------------------------------------------------------------------ who this is */
section('Who this is, for a model');
{
  const S = person(OWNER);
  const dev = text(P.lines(S, D0, { to: 'device' }));
  check('the on-device model gets all of it: age, height and weight, goals, history, schedule, equipment', /Age: 19; sex: male; 183 cm; 150 lb/.test(dev) && /Goals, most important first: visible abs, bigger arms/.test(dev) && /Training history: never trained/.test(dev) && /Schedule: 3 days a week, about 20 min; on Mon, Wed and Fri, at home/.test(dev) && /Equipment: dumbbells 10 lb/.test(dev), dev);
  check('what their weights mean for them: 10 lb is light for curls and rows, about right for lateral raises', /Their weights: 10 lb is light for curls, rows, presses, squats and deadlifts; about right for triceps extensions, lateral raises and rear raises/.test(dev), dev.split('\n').find((l) => /weights/.test(l)));
  check('from body weight and each ladder\'s share of it', P.loadFeel(S, 'curl').feel === 'light' && P.loadFeel(S, 'row').far && P.loadFeel(S, 'raise').feel === 'right' && P.loadFeel(S, 'push') === null);
  const strong = person(Object.assign({}, OWNER, { equipment: { db: [40], chair: true } }));
  check('a heavy dumbbell reads as heavy, and no weights or no body weight as nothing to say', P.loadFeel(strong, 'curl').feel === 'heavy' && P.loadFeel(person(Object.assign({}, OWNER, { equipment: { chair: true } })), 'curl') === null && P.loadFeel(person(Object.assign({}, OWNER, { weightKg: null })), 'curl') === null);
  check('how they eat, in the answer they gave, and their build only when it\'s lean', /Eating, in their own words: not much protein, not much fruit and veg/.test(dev) && /Build: lean, from height and weight/.test(dev) && P.build(S, D0) === 'lean' && P.build(person(Object.assign({}, OWNER, { weightKg: 80 })), D0) === 'mid' && !/Build:/.test(text(P.lines(person(Object.assign({}, OWNER, { weightKg: 80 })), D0, { to: 'device' }))));
  const bare = person({ goals: ['legs'], experience: 'lt1', days: 3, minutes: 30, equipment: { chair: true } });
  const bareLines = text(P.lines(bare, D0, { to: 'device' }));
  check('only facts with data behind them: nothing about eating, build, weights or the last weeks when there\'s none', !/Eating|Build|Their weights|Last 4 weeks|Moving up|Not moving|Their choices|Sleep/.test(bareLines) && /Equipment: chair/.test(bareLines), bareLines);
  check('the sheet\'s list is the same facts in the same words', JSON.stringify(P.shown(S, D0, { to: 'device' }).map(([, v]) => v)) === JSON.stringify(P.facts(S, D0, { to: 'device' }).map((f) => f.value)) && P.shown(S, D0, { to: 'device' }).some(([k, v, only]) => k === 'Age' && only === 'device') && P.shown(S, D0, { to: 'device' }).some(([k]) => k === 'Your weights'));
}

section('Who this is: what they actually do');
{
  // Four weeks in, turning up on Mondays and Wednesdays only (3 planned), for about 31 minutes
  // against 20 set.
  const S = person(OWNER, 4, { only: [0, 2], mins: 31 });
  const L = P.lately(S, D0);
  const dev = text(P.lines(S, D0, { to: 'device' }));
  check('workouts a week against the plan, and how long sessions really take', L.perWeek != null && L.perWeek < 3 && L.mins === 31 && new RegExp(`Last 4 weeks: about ${String(L.perWeek).replace('.', '\\.')} workouts? a week against 3 planned \\(${L.done} of ${L.planned} done\\); sessions take about 31 min against 20 set`).test(dev), dev.split('\n').find((l) => /Last 4/.test(l)));
  check('how they felt, what\'s moving up and what isn\'t', /How workouts felt: 0 too easy, \d+ about right, 0 too hard/.test(dev) && (L.up.length > 0 || L.stuck.length > 0) && (!L.up.length || dev.includes(`Moving up: ${L.up.join(', ')}`)) && (!L.stuck.length || dev.includes(`Not moving: ${L.stuck.join(', ')}`)), [L.up, L.stuck]);
  check('how long they\'ve used the app', /Training history: never trained; 4 weeks with the app/.test(dev));
  // What they've chosen: a move hidden, one pinned, a Tailor wish, and a coach's idea turned down.
  S.excluded = ['sq_jump'];
  S.profile.planTweaks = { swaps: { curl: 'curl_hammer' } };
  S.events.push({ type: 'tailor', day: D0 - 3, lines: ['Easy on your knees', 'A gentler plan'] });
  S.events.push({ type: 'review', day: D0 - 2, lines: ['Rest 1 minute between sets'], declined: ['4 workouts a week'], before: {} });
  S.coachDismissed = { 'deload-1': D0 - 1 };
  const likes = P.facts(S, D0, { to: 'device' }).find((f) => f.id === 'likes');
  check('what they hid, pinned, asked for, took and turned down', likes && /hid jump squat/.test(likes.value) && /pinned hammer curl/.test(likes.value) && /asked for: easy on your knees, a gentler plan/.test(likes.value) && /took the coach's ideas: rest 1 minute between sets/.test(likes.value) && /turned down: 4 workouts a week, a lighter week/.test(likes.value), likes && likes.value);
  const toClaude = P.facts(S, D0, { to: 'claude', wide: true, have: ['person', 'days', 'training'] }).find((f) => f.id === 'likes');
  check('Claude gets the same choices, less the gentler plan, which stays on the phone', toClaude && /easy on your knees/.test(toClaude.value) && !/gentl/i.test(toClaude.value), toClaude && toClaude.value);
  const advice = text(P.advice(S, D0, { to: 'device' }));
  check('and what the research says to do about it: light weights, little protein, workouts missed, sessions running long, a beginner', /Their weights are light for them/.test(advice) && /up to about 30 reps/.test(advice) && /They eat little protein/.test(advice) && /don't add sets to compensate/.test(advice) && new RegExp(`They do about ${String(L.perWeek).replace('.', '\\.')} of the 3 workouts planned`).test(advice) && /Their sessions run about 31 minutes against 20 set/.test(advice) && /new to training/.test(advice), advice);
}

section('Who this is: what Claude may be told');
{
  // Someone whose plan works around their body, who allowed Claude before the list grew.
  const Q = person({ goals: ['legs', 'back'], experience: 'lt1', days: 3, minutes: 30, age: 67, sex: 'female', heightCm: 160, weightKg: 52, conditions: ['oa', 'back'], oaJoints: ['knee', 'hip'], floorOk: false, gentle: true, careful: ['shoulder'], equipment: { db: [10], band: true, chair: true, wall: true }, eats: { protein: 'low', produce: 'some' } }, 3);
  allow(Q);
  const old = AI.systemBlocks(Q, D0, 'chat').map((b) => b.text).join('\n');
  check('the list they allowed has a version: before 1.15\'s, Claude gets what it always did', AI.CONSENT === 2 && !AI.wide(Q) && /Age range: 65\+; sex: female/.test(old) && /Goals, most important first: legs and glutes, back and posture/.test(old) && /Schedule: 3 days a week, about 30 min\n/.test(old) && /Careful with: shoulder/.test(old));
  check('and none of what 1.15 added: eating, build, what their weights mean, the days, the weeks, what they do and choose', !/Eating|Build:|Their weights|on Mon|weeks with the app|Last 4 weeks|Moving up|Not moving|Their choices/.test(old), old.match(/Eating|Build:|Their weights|on Mon|weeks with the app|Last 4 weeks|Moving up|Not moving|Their choices/));
  Q.ai.consentV = 2;
  const now = AI.systemBlocks(Q, D0, 'chat').map((b) => b.text).join('\n');
  check('once they allow the newer list, the same facts every model job gets', AI.wide(Q) && /Eating, in their own words: not much protein, some fruit and veg/.test(now) && /Build: lean/.test(now) && /Their weights: 10 lb is/.test(now) && /Schedule: 3 days a week, about 30 min; on \w+, \w+ and \w+, at home/.test(now) && /3 weeks with the app/.test(now) && /Last 4 weeks: about/.test(now));
  const never = /arthritis|back pain|Planned around|Nothing on the floor|gentle|\b67\b|\b160\b|160 cm|\b52 kg|115 lb/i;
  const C2 = C.claudePrompt(Q, C.wishes(Q, ''), C.build(Q, D0, C.wishes(Q, '')), C.allowedMoves(Q, D0, C.wishes(Q, ''), C.build(Q, D0, C.wishes(Q, ''))), D0);
  const all = ['chat', 'report', 'suggest', 'review', 'build', 'tailor'].map((f) => AI.systemBlocks(Q, D0, f).map((b) => b.text).join('\n')).join('\n') + R.claudeAsk(Q, R.context(Q, D0, 'claude')) + C2;
  check('never the exact age, the height, a health condition, floor work or a gentle start, in any request', !never.test(all), all.match(never));
  const dev = text(P.lines(Q, D0, { to: 'device' }));
  check('the on-device model gets those, on the phone', /Age: 67; sex: female; 160 cm; 115 lb/.test(dev) && /Health: the plan is adapted for osteoarthritis and low back pain/.test(dev) && /Joints with arthritis: knee, hip/.test(dev) && /Nothing on the floor/.test(dev) && /A gentle plan/.test(dev));
  check('withdrawn, nothing is wide again until they allow it', (() => { Q.ai.consentAt = null; return !AI.wide(Q); })());
  // Each feature's parts: what a part already says isn't said twice.
  const S = allow(person(OWNER, 4), 2);
  for (let d = D0 - 10; d <= D0; d++) S.health.days[d] = { sleepMin: 400, rhr: 60 };
  const build = AI.summary(S, D0, 'build'), tailor = AI.summary(S, D0, 'tailor');
  check('sleep goes once: in the days part where there is one, with the person where there isn\'t', (build.match(/Sleep/g) || []).length === 1 && /- Sleep: /.test(build) && /Sleep and recovery this week: sleep 6 h 40 a night; resting heart rate 60 bpm/.test(tailor) && !/Sleep and recovery/.test(build));
  check('the preview is still exactly what a question sends', AI.preview(S, D0) === AI.systemBlocks(S, D0, 'chat').map((b) => b.text).join('\n\n') && AI.preview(S, D0).includes('Their weights: 10 lb is light'));
}

section('Nothing about losing weight for someone lean or under 18');
{
  const S = allow(person(Object.assign({}, OWNER, { weightGoal: 'lose' })), 2);
  const sys = AI.systemBlocks(S, D0, 'chat')[0].text;
  check('Claude is told so, once it may know they\'re lean, and isn\'t told their goal is to lose', /Say nothing about losing weight, cutting or eating less: they are lean for their height\./.test(sys) && !/Weight goal: lose/.test(AI.summary(S, D0, 'chat')) && P.strict(S, D0));
  delete S.ai.consentV;
  check('before that it isn\'t told why, and its words are still held to it', !/lean/.test(AI.systemBlocks(S, D0, 'chat').map((b) => b.text).join('\n')) && P.strict(S, D0));
  const teen = allow(person(Object.assign({}, OWNER, { age: 16, weightKg: 80, weightGoal: 'lose' })));
  check('under 18: the same, whatever they weigh, and the age range says so already', /Say nothing about losing weight, cutting or eating less: they are under 18\./.test(AI.systemBlocks(teen, D0, 'chat')[0].text) && /Age range: 13-17/.test(AI.summary(teen, D0, 'chat')) && P.strict(teen, D0) && !/Weight goal: lose/.test(AI.summary(teen, D0, 'chat')));
  const adult = allow(person(Object.assign({}, OWNER, { weightKg: 85, weightGoal: 'lose' })), 2);
  check('an adult who isn\'t lean keeps their goal, and no such line', !/Say nothing about losing/.test(AI.systemBlocks(adult, D0, 'chat')[0].text) && /Weight goal: lose/.test(AI.summary(adult, D0, 'chat')) && !P.strict(adult, D0));
  check('the on-device coach\'s brief says it too', /Say nothing about losing weight/.test(GH.deviceCoach.brief(S, D0)) && /Their weights: 10 lb is light/.test(GH.deviceCoach.brief(S, D0)) && /Eating, in their own words: not much protein/.test(GH.deviceCoach.brief(S, D0)) && !/Say nothing about losing/.test(GH.deviceCoach.brief(adult, D0)));
}

section('What a model may not say');
{
  const cut = (x, strict) => K.keepSafe(x, strict).text;
  check('a diet, a calorie deficit or surplus, a weight or body-fat target', cut('Eat in a 500 calorie deficit. Sleep more.') === 'Sleep more.' && cut('Try keto for a month. Keep the curls.') === 'Keep the curls.' && cut('Aim for 10% body fat. Keep going.') === 'Keep going.' && cut('Get down to 140 lb first.') === '' && cut('You could lose 5 lb this month.') === '');
  check('a diagnosis, medicine or supplements', cut('You probably have tendinitis in that elbow. Rest it.') === 'Rest it.' && cut('Take 400 mg of ibuprofen.') === '' && cut('Creatine would help. So would sleep.') === 'So would sleep.');
  check('ordinary coaching and small food ideas stay', cut('The bulk of your sets are for your arms. Aim for a weight you can lift 12 times. One more serving of protein a day would help: milk, yogurt or eggs.').split('. ').length === 3 && cut('That is worth seeing a doctor about.') !== '' && cut('Cut back on sets if it feels too hard.', true) !== '');
  check('for someone lean or under 18, nothing about losing weight or eating less', cut('Losing fat will make your abs show. Train them three times a week.', true) === 'Train them three times a week.' && cut('Burn belly fat with more crunches.', true) === '' && cut('Losing fat will make your abs show.', false) !== '');
  const S = person(OWNER);
  const given = 'You train 3 days a week.';
  const g = K.grounded(S, D0, 'How do I get abs?', 'Your abs grow like any muscle, so train them on your 3 days. Eat in a calorie deficit to burn the fat over them. Keep each set close to the last rep you can do.', given, '', 'Claude');
  check('a chat answer loses those lines, and says so', !/deficit|burn/.test(g.text) && /train them on your 3 days/.test(g.text) && /Left out advice on diet or medicine/.test(g.note) && g.cut === 1, g);
  check('a red-flag question still gets the app\'s own safety answer', K.topicOf('I get chest pain doing push-ups') === 'redflag' && /doctor/.test(K.ask(S, D0, 'I get chest pain doing push-ups').text));
}

/* ------------------------------------------------------------------ Build me a plan */
section('Build me a plan: the quick choices');
{
  const S = person(OWNER);
  const ch = C.choices(S, D0);
  check('what they want most starts from their goals, how it should feel from who they are', JSON.stringify(ch.most.options.map(([id]) => id)) === '["abs","arms","all"]' && ch.most.value === 'abs' && ch.feel.value === 'easy' && ch.feel.options.length === 3 && ch.skip.value.length === 0);
  const T = person(Object.assign({}, OWNER, { experience: '1to3', careful: ['knee'], impactOk: false, floorOk: false }), 4);
  const ct = C.choices(T, D0);
  check('someone with a year behind them starts on steady, and what they already leave out is ticked', ct.feel.value === 'steady' && JSON.stringify(ct.skip.value) === '["jumping","floor","knee"]');
  const w = C.wishes(S, '3 days', { most: 'arms', feel: 'easy', skip: ['jumping', 'knee', 'nonsense'] });
  check('the picks are read like words: arms first, a gentler start, no jumping, easy on the knees', w.most === 'arms' && w.focus.includes('biceps') && w.focus.includes('triceps') && w.gentle === true && w.noImpact && w.careful.includes('knee') && JSON.stringify(w.skip) === '["jumping","knee"]' && w.days === 3);
  check('words still win, and nothing picked changes nothing', C.wishes(S, 'bigger chest', { most: 'arms' }).focus[0] === 'chest' && JSON.stringify(C.wishes(S, '3 days')) === JSON.stringify(C.wishes(S, '3 days', {})));
  const floor = C.build(S, D0, C.wishes(S, '', { skip: ['floor'] }));
  check('floor work left out is left out of the plan', floor.days.every((d) => d.items.every((it) => MV[it.move].pos !== 'floor' && MV[it.move].pos !== 'prone' && MV[it.move].pos !== 'supine')) && /nothing on the floor/.test(floor.note), floor.days.map((d) => d.items.map((it) => `${it.move}:${MV[it.move].pos}`)));
}

section('Build me a plan: the rules for this person');
{
  const S = person(OWNER);
  const w = C.wishes(S, '', { most: 'arms', feel: 'steady' });
  const draft = C.build(S, D0, w);
  const RU = C.rules(S, D0, w, draft);
  check('exercises a day from their minutes, 4 sets of one exercise at most (3 when they asked for easy)', JSON.stringify(RU.perDay) === '[3,5]' && JSON.stringify(RU.sets) === '[1,4]' && JSON.stringify(C.rules(S, D0, C.wishes(S, '', { feel: 'easy' }), draft).sets) === '[1,3]' && JSON.stringify(C.rules(S, D0, C.wishes(S, '45 minutes'), draft).perDay) === '[5,8]');
  check('reps up to 30 where their weights are light, each move\'s own range otherwise', RU.reps('curl_std')[1] === 30 && RU.reps('row_db')[1] === 30 && JSON.stringify(RU.reps('push_incline')) === JSON.stringify(B.rangeFor(RU.S2, MV.push_incline, 'push', D0)) && RU.reps('side_knee')[1] === MV.side_knee.range[1]);
  const strong = person(Object.assign({}, OWNER, { equipment: { db: [40], chair: true } }));
  check('not for someone whose dumbbells are heavy for them', C.rules(strong, D0, w).reps('curl_std')[1] === B.rangeFor(strong, MV.curl_std, 'curl', D0)[1]);
  const prog = B.programFor(RU.S2.profile);
  check('their goal muscles: weekly sets from the engine\'s floor to 12 (little protein), on at least 2 days', RU.goals.length === 3 && RU.goals.every((g) => g.floor === prog.floor[g.group] && g.cap === 12 && g.days === 2) && C.rules(person(Object.assign({}, OWNER, { eats: null })), D0, w).goals.every((g) => g.cap === prog.cap[g.group]));
  const ids = C.allowedMoves(S, D0, w, draft);
  allow(S, 2);
  const prompt = C.claudePrompt(S, w, draft, ids, D0);
  check('the prompt states them, in place of the fixed ones', /3 to 5 exercises a day: that's what 20 minutes holds/.test(prompt) && /1 to 4 sets of an exercise, never more than 4 in a day\. When a muscle needs more, give it a second exercise/.test(prompt) && /Each week: biceps \d+ to 12 sets, triceps \d+ to 12 sets, abs \d+ to 12 sets, each on at least 2 days/.test(prompt) && /muscles they want most first, big moves before small ones, abs and core last/.test(prompt) && !/sets 2 to 5|reps 5 to 20|3 to 8 moves/.test(prompt));
  check('with each move\'s range, and what the research says for them', /curl_std: Dumbbell curl \(biceps; 8-30\)/.test(prompt) && /side_knee: Side plank on knees \(abs; \d+-\d+ s\)/.test(prompt) && /Their weights are light for them/.test(prompt) && /They eat little protein/.test(prompt) && /Say nothing about losing weight/.test(prompt));
  check('what they picked goes with the request', /They picked: wants most: bigger arms; how it should feel: steady/.test(prompt));
  check('only moves for this person: no stand-in or practice ladders they don\'t use', ids.every((id) => !['balance', 'impact', 'getup', 'pushAlt', 'curlAlt', 'legSeat'].includes(MV[id].family)) && ids.includes('curl_std') && ids.length >= 20, ids.length);
  const sys = AI.systemBlocks(S, D0, 'build').map((b) => b.text).join('\n\n');
  check(`Claude's request stays small: the prompt under ${C.BUILD.CLAUDE_CHARS} characters, with its summary under 12,000`, prompt.length < C.BUILD.CLAUDE_CHARS && prompt.length + sys.length < 12000, [prompt.length, sys.length]);
  const big = person({ goals: ['strength', 'chest'], experience: '3plus', days: 6, minutes: 60, age: 30, weightKg: 80, where: 'both', equipment: { db: [20, 30, 40], kb: [35], bar: true, band: true, ball: true, chair: true, wall: true, towel: true, table: true }, gym: B.gymPreset('full', 'lb') }, 2);
  const wb = C.wishes(big, '6 days');
  const db = C.build(big, D0, wb);
  check('and for someone with everything, six long days', C.claudePrompt(big, wb, db, C.allowedMoves(big, D0, wb, db), D0).length <= C.BUILD.CLAUDE_CHARS + 200, C.claudePrompt(big, wb, db, C.allowedMoves(big, D0, wb, db), D0).length);
  const msgs = C.planMessages(S, w, draft, ids, D0);
  const devText = msgs.map((m) => m.content).join('\n');
  check('the on-device model gets the short form: the same rules, 60 moves at most, who this is in a few lines, reasons to pick from', devText.length < 6500 && /1 to 4 sets of an exercise/.test(devText) && /About them:\n- Age: 19; sex: male; 183 cm; 150 lb/.test(devText) && /Their weights: 10 lb is light/.test(devText) && /REASONS\nb1: You want your arms and abs most/.test(devText) && (msgs[0].content.match(/^[a-z0-9_]+: /gm) || []).length <= C.BUILD.DEVICE_MOVES && /\nDraft: \{/.test(msgs[1].content), devText.length);
  const gram = C.planGrammar(ids.slice(0, 60), 3, { perDay: RU.perDay, sets: RU.sets, reasons: 5 });
  check('its grammar holds it to them: 3 to 5 exercises, 1 to 4 sets, reasons by id, no free text but the names', /item \("," item\)\{2,4\}/.test(gram) && /\\"sets\\":" \[1-4\]/.test(gram) && /pick ::= "\\"b1\\"" \| "\\"b2\\"" \| "\\"b3\\"" \| "\\"b4\\"" \| "\\"b5\\""/.test(gram) && /root ::= "\{\\"because\\":\[" pick \("," pick\)\{0,2\}/.test(gram) && !/note/.test(gram) && gram.split('\n').every((l) => /^[a-z]+ ::= /.test(l)));
  const sc = C.planSchema(ids, ['goal', 'load', 'asked']);
  check('Claude\'s schema: the reasons first, each naming a fact it was given, then the plan with a line for each day', JSON.stringify(Object.keys(sc.properties)) === '["because","name","note","days"]' && JSON.stringify(sc.properties.because.items.properties.fact.enum) === '["goal","load","asked"]' && sc.properties.days.items.required.includes('why') && !/"(minimum|maximum|minLength|maxLength|maxItems|minItems)"/.test(JSON.stringify(sc)));
}

section('Build me a plan: the app\'s own plan says why it\'s theirs');
{
  const S = person(OWNER);
  const w = C.wishes(S, '', { most: 'arms', feel: 'easy' });
  const plan = C.build(S, D0, w);
  check('three lines, each from a fact about them and what the plan does about it', plan.why.length === 3 && /^You want your arms and abs most, so they're trained on (all 3 days|at least 2 of your 3 days|2 of your 3 days), arms first\.$/.test(plan.why[0]) && /^You said you don't eat much protein\. Training can't make up for that, so sets stay moderate and your goals come first\.$/.test(plan.why[1]) && /^Your 10 lb weights are light for you, so those exercises build on reps, up to 30, close to the last one you can do\.$/.test(plan.why[2]), plan.why);
  check('and a line for each day', plan.days.every((d) => d.why && d.why.length <= C.LIMITS.dayWhy && /\.$/.test(d.why)) && /^Arms first while you're fresh, then /.test(plan.days.find((d) => MV[d.items[0].move].group === 'biceps' || MV[d.items[0].move].group === 'triceps').why), plan.days.map((d) => d.why));
  check('the engine\'s draft is brought inside the rules: no exercise over 3 sets when they asked for easy, goal muscles first, core last', plan.days.every((d) => d.items.every((it) => it.sets <= 3)) && plan.days.every((d) => { const k = d.items.findIndex((it) => MV[it.move].group === 'abs'); return k < 0 || d.items.slice(k).every((it) => MV[it.move].group === 'abs'); }), plan.days.map((d) => d.items.map((it) => `${it.move} ${it.sets}`)));
  const every = C.ownWhy(S, D0, w, plan, C.rules(S, D0, w, plan));
  check('every line it could give is true of this plan and within its length', every.length >= 5 && every.every((x) => x.line.length <= C.LIMITS.why && /^You/.test(x.line)) && every.some((x) => x.key === 'time' && /You have 3 days of 20 minutes, so each day has \d( to \d)? exercises\./.test(x.line)) && every.some((x) => x.key === 'feel' && /no exercise has more than 3 sets/.test(x.line)) && every.some((x) => x.key === 'level'), every.map((x) => x.line));
  const none = C.build(person({ goals: ['legs'], experience: '1to3', days: 2, minutes: 30, equipment: { chair: true } }, 2), D0, C.wishes(S, ''));
  check('with little known it still says why, from the goal, the time and the kit', none.why.length >= 2 && none.why.some((l) => /You want your legs most/.test(l)) && none.why.some((l) => /You have 2 days of 30 minutes|You train without equipment/.test(l)), none.why);
  // Kept with the plan, and gone once its exercises change.
  const saved = C.save(S, plan).plan;
  check('kept with the plan when it\'s saved, and through a restart', JSON.stringify(saved.why) === JSON.stringify(plan.why) && saved.days[0].why === plan.days[0].why && JSON.stringify(C.normalize(JSON.parse(JSON.stringify(saved))).plan.why) === JSON.stringify(plan.why));
  C.update(S, saved.id, (p) => { p.name = 'Mine'; p.days.reverse(); });
  check('a new name or moving a day keeps them', C.get(S, saved.id).why.length === 3 && C.get(S, saved.id).days.every((d) => d.why));
  C.update(S, saved.id, (p) => { p.days[0].items[0].sets = 1; });
  check('changing an exercise takes them off: they\'d no longer be true', !C.get(S, saved.id).why && C.get(S, saved.id).days.every((d) => !d.why));
  check('a plan from elsewhere can\'t carry more or longer lines than a built one', C.normalize({ name: 'X', days: [{ title: 'A', why: 'y'.repeat(500), items: [{ move: 'push_std', sets: 3, reps: 10 }] }], why: ['a', 'b', 'c', 'd', 'e'.repeat(500), 7, null] }).plan.why.length === 3 && C.normalize({ name: 'X', days: [{ title: 'A', why: 'y'.repeat(500), items: [{ move: 'push_std', sets: 3, reps: 10 }] }] }).plan.days[0].why.length === C.LIMITS.dayWhy);
}

section('Build me a plan: a model\'s plan is held to the rules');
{
  const S = allow(person(OWNER), 2);
  const w = C.wishes(S, '', { most: 'arms', feel: 'steady' });
  const draft = C.build(S, D0, w);
  const ids = C.allowedMoves(S, D0, w, draft);
  const given = `${AI.systemBlocks(S, D0, 'build').map((b) => b.text).join('\n')}\n${C.claudePrompt(S, w, draft, ids, D0)}`;
  const facts = C.claudeFacts(S, D0);
  const answer = (f, extra) => Object.assign({ because: [], name: 'Arms and abs at home', note: 'Three short days built around your arms and abs.', days: draft.days.map((d, i) => ({ title: d.title, why: '', items: f(d, i) })) }, extra);
  const same = (d) => d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.secs != null ? it.secs : it.reps }));
  const run = (raw) => { const o = { fixes: [], said: {}, facts, given }; return { plan: C.accept(S, D0, w, draft, raw, ids, o), o }; };
  const sets = (p, g) => p.days.reduce((a, d) => a + d.items.filter((it) => MV[it.move].group === g).reduce((x, it) => x + it.sets, 0), 0);
  const daysOf = (p, g) => p.days.filter((d) => d.items.some((it) => MV[it.move].group === g)).length;

  const echo = run(answer(same));
  check('the draft back as it was passes, with nothing to put right', echo.plan && echo.o.fixes.length === 0 && JSON.stringify(echo.plan.days.map((d) => d.items)) === JSON.stringify(draft.days.map((d) => d.items)), echo.o.fixes);

  // Six sets of curls on one day: on a day with room for another exercise, and on a full one.
  const curlDay = draft.days.findIndex((d) => d.items.filter((it) => MV[it.move].group === 'biceps').length === 1);
  const loose = draft.days[curlDay].items.filter((it) => !['biceps', 'triceps', 'abs'].includes(MV[it.move].group)).sort((a, b) => a.sets - b.sets)[0];
  const sixOf = (roomy) => run(answer((d, i) => same(d).filter((it) => !(roomy && i === curlDay && draft.days[curlDay].items.length >= 5 && it.move === loose.move)).map((it) => (i === curlDay && MV[it.move].group === 'biceps' ? Object.assign(it, { sets: 6 }) : it))));
  const six = sixOf(true);
  const day6 = six.plan && six.plan.days[curlDay].items.filter((it) => MV[it.move].group === 'biceps');
  check('six sets of curls: kept to 4, with a second biceps exercise for the rest, and the sheet is told', six.plan && day6.length === 2 && day6[0].sets === 4 && day6.every((it) => it.sets <= 4) && six.o.fixes.some((x) => /^Kept .+ to 4 sets on day \d, with .+ for the rest\.$/.test(x)), [day6, six.o.fixes]);
  const full = sixOf(false);
  check('on a day that\'s already full, just kept to 4', full.plan && full.plan.days.every((d, i) => d.items.every((it) => it.sets <= 4) && d.items.length <= Math.max(5, draft.days[i].items.length)) && full.o.fixes.some((x) => /^Kept .+ to 4 sets on day \d/.test(x)), full.o.fixes);

  // A goal muscle once a week.
  const once = run(answer((d, i) => same(d).filter((it) => i === 0 || MV[it.move].group !== 'triceps')));
  check('a goal muscle left on one day: the draft\'s exercise goes back, so it trains twice', once.plan && daysOf(once.plan, 'triceps') >= 2 && once.o.fixes.some((x) => /^Put .+ back on day \d, so your triceps train 2 days a week\.$/.test(x)), once.o.fixes);
  const gone = run(answer((d) => same(d).filter((it) => MV[it.move].group !== 'triceps')));
  check('left out altogether, it\'s put back too (or the draft stands)', !gone.plan || daysOf(gone.plan, 'triceps') >= 2);

  // Nine exercises in twenty minutes.
  const extra = ids.filter((id) => !draft.days[0].items.some((it) => it.move === id) && !MV[id].timed).slice(0, 9 - draft.days[0].items.length);
  const nine = run(answer((d, i) => (i === 0 ? same(d).concat(extra.map((id) => ({ move: id, sets: 1, reps: 10 }))) : same(d))));
  check('nine exercises in twenty minutes: folded where muscles double up, else the draft stands', draft.days[0].items.length + extra.length === 9 && (!nine.plan || nine.plan.days[0].items.length <= Math.max(5, draft.days[0].items.length)), nine.plan && nine.plan.days[0].items.length);

  // Reps outside a move's range, sets past the weekly cap, the order.
  const wild = run(answer((d) => same(d).map((it, k) => (k ? it : Object.assign(it, { reps: MV[it.move].timed ? 300 : 60 })))));
  check('reps and holds come back inside each move\'s range', wild.plan && wild.plan.days.every((d) => d.items.every((it) => { const [lo, hi] = C.rules(S, D0, w, draft).reps(it.move); const v = it.secs != null ? it.secs : it.reps; return v >= lo && v <= hi; })) && wild.o.fixes.includes('Kept reps inside each exercise\'s own range.'), wild.o.fixes);
  const all60 = run(answer((d) => same(d).map((it) => Object.assign(it, { reps: MV[it.move].timed ? 300 : 60 }))));
  check('and when every exercise is at its most, so no day can fit its time, the draft stands', all60.plan === null || all60.plan.days.every((d, i) => C.minutes(S, all60.plan, i, D0) <= Math.max(20, C.minutes(S, draft, i, D0)) + 2));
  const many = run(answer((d) => same(d).map((it) => (MV[it.move].group === 'abs' ? Object.assign(it, { sets: 4 }) : Object.assign(it, { sets: 1 })))));
  check('a goal muscle past its weekly cap gives the extra up', !many.plan || sets(many.plan, 'abs') <= Math.max(12, sets(draft, 'abs')), many.plan && sets(many.plan, 'abs'));
  const flipped = run(answer((d) => same(d).reverse()));
  check('abs and core go last, goal muscles first', flipped.plan && flipped.plan.days.every((d) => { const k = d.items.findIndex((it) => MV[it.move].group === 'abs'); return k < 0 || d.items.slice(k).every((it) => MV[it.move].group === 'abs'); }) && flipped.plan.days.every((d) => { const g = MV[d.items[0].move].group; return ['biceps', 'triceps'].includes(g) || !d.items.some((it) => ['biceps', 'triceps'].includes(MV[it.move].group)); }), flipped.plan && flipped.plan.days.map((d) => d.items.map((it) => it.move)));
  check('a move they can\'t do, the wrong number of days or no answer: the draft stands', run(answer((d, i) => (i ? same(d) : same(d).concat([{ move: 'bench_bb', sets: 3, reps: 10 }])))).plan === null && run(Object.assign(answer(same), { days: answer(same).days.slice(1) })).plan === null && run(null).plan === null);
}

section('Build me a plan: a model\'s reasons are checked');
{
  const S = allow(person(OWNER), 2);
  const w = C.wishes(S, '', { most: 'arms', feel: 'steady' });
  const draft = C.build(S, D0, w);
  const ids = C.allowedMoves(S, D0, w, draft);
  const given = `${AI.systemBlocks(S, D0, 'build').map((b) => b.text).join('\n')}\n${C.claudePrompt(S, w, draft, ids, D0)}`;
  const facts = C.claudeFacts(S, D0);
  const same = (d) => d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.secs != null ? it.secs : it.reps }));
  const run = (because, days, note) => { const o = { fixes: [], said: {}, facts, given }; const plan = C.accept(S, D0, w, draft, { because, name: 'Arms and abs at home', note: note || 'Three short days built around your arms and abs.', days: draft.days.map((d, i) => ({ title: d.title, why: (days || [])[i] || '', items: same(d) })) }, ids, o); return { plan, o }; };
  check('the facts Claude may name are the ones it was given', facts.includes('load') && facts.includes('eats') && facts.includes('goal') && facts.includes('build') && !facts.includes('sleep') && !facts.includes('health') && !facts.includes('likes'), facts);

  const good = run([
    { fact: 'load', line: 'Your 10 lb dumbbells are light for curls and rows, so those run to 20 reps or more instead of adding weight.' },
    { fact: 'eats', line: 'You said protein is low, so the plan keeps sets moderate and puts your arms and abs first.' },
    { fact: 'time', line: 'You have 3 days of 20 minutes, so each day is short and built around your arms.' },
  ], ['Arms while you are fresh, then abs.', 'A bit of everything so nothing is left out.', 'Arms again, then your chest and abs.']);
  check('a good personal plan is kept with its reasons, as written', good.plan && good.plan.why.length === 3 && /^Your 10 lb dumbbells are light for curls and rows/.test(good.plan.why[0]) && /^You said protein is low/.test(good.plan.why[1]) && good.plan.days[0].why === 'Arms while you are fresh, then abs.' && good.plan.note === 'Three short days built around your arms and abs.' && good.plan.name === 'Arms and abs at home' && good.o.said.dropped === 0, [good.plan && good.plan.why, good.o.said]);

  const bad = run([
    { fact: 'sleep', line: 'You sleep badly, so workouts are short.' },
    { fact: 'goal', line: 'You sleep about 5 hours a night, so the plan goes easy.' },
    { fact: 'goal', line: 'You want bigger arms, so you get 47 sets of curls a week.' },
    { fact: 'goal', line: 'You should eat in a 500 calorie surplus to grow your arms.' },
    { fact: 'goal', line: 'You have arthritis in your knees, so there are no squats.' },
    { fact: 'goal', line: 'The plan trains arms on three days.' },
  ], ['Burn belly fat with a long abs finisher.', 'You \u2014 yes you \u2014 will love this!', '']);
  check('reasons that name a fact it wasn\'t given, a number it wasn\'t given, a diet, a condition or nobody are dropped', bad.plan && bad.plan.why.every((l) => !/sleep|47|calorie|arthritis|The plan trains/.test(l)) && bad.o.said.dropped >= 7, [bad.plan && bad.plan.why, bad.o.said]);
  check('and the app\'s own lines stand in, so the plan still says why', bad.plan && bad.plan.why.length >= 2 && /^You want your arms and abs most/.test(bad.plan.why[0]) && bad.plan.days.every((d) => d.why && !/belly|\u2014|!/.test(d.why)), bad.plan && [bad.plan.why, bad.plan.days.map((d) => d.why)]);
  const lean = run([{ fact: 'goal', line: 'You want abs, so the plan helps you lose the fat over them.' }], null, 'Lose weight fast with this plan.');
  check('nothing about losing weight for someone lean, in a reason or the note (the app\'s note stands)', lean.plan && lean.plan.why.every((l) => !/lose/.test(l)) && lean.plan.note === draft.note, lean.plan && [lean.plan.why, lean.plan.note]);
  const promise = run([{ fact: 'goal', line: 'You want abs, so this plan guarantees a six-pack in 8 weeks.' }], null, 'A plan with 99 exercises.');
  check('no promises, and a note or a name with a made-up number gives way to the app\'s', promise.plan && promise.plan.why.every((l) => !/guarantee|8 weeks/.test(l)) && promise.plan.note === draft.note, promise.plan && [promise.plan.why, promise.plan.note]);
  check('a line is one line in the app\'s voice: a capital, a full stop, no exclamation marks, not too long', C.say('you want arms, so arms come first!', 160, { known: '', facts: ['goal'] }) === 'You want arms, so arms come first.' && C.say('x'.repeat(200), 160, { known: '', facts: [] }) === '' && C.say('Arms first \u2014 always.', 160, { known: '', facts: [] }) === '');
  const hostile = run([{ fact: '__proto__', line: 'You are great.' }, { fact: 'constructor', line: 'You are great.' }, 'toString', 7, null, { fact: 'goal', line: { toString: () => 'You win.' } }, { fact: 'goal', line: 'You <img src=x onerror=alert(1)> want arms, so arms come first.\u0000\u202e' }]);
  check('odd answers do no harm: unknown facts and shapes are dropped, control characters go', hostile.plan && hostile.plan.why.every((l) => typeof l === 'string' && !/[\u0000-\u001f\u202e]/.test(l) && l.length <= C.LIMITS.why) && !hostile.plan.why.some((l) => /You are great|You win/.test(l)), hostile.plan && hostile.plan.why);

  // The on-device model picks from the app's own lines, by id.
  const own = C.ownWhy(S, D0, w, draft, C.rules(S, D0, w, draft));
  const o = { fixes: [], said: {}, reasons: own, given: C.planMessages(S, w, draft, ids, D0).map((m) => m.content).join('\n') };
  const picked = C.accept(S, D0, w, draft, { because: ['b3', 'b1', 'b9', 'zz'], name: 'Arms first', days: draft.days.map((d) => ({ title: d.title, items: same(d) })) }, ids, o);
  check('an on-device model\'s picks become the app\'s own lines, in its order; ones that aren\'t there are skipped', picked && picked.why.length === 2 && picked.why[0] === own[2].line && picked.why[1] === own[0].line && picked.note === draft.note && picked.days.every((d) => d.why), picked && picked.why);
}

section('Build me a plan: asking a model');
{
  const S = allow(person(OWNER), 2);
  const w = C.wishes(S, '3 days, 20 minutes', { most: 'arms', feel: 'steady' });
  const draft = C.build(S, D0, w);
  const keep = AI.json;
  const calls = [];
  const same = (d) => d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.secs != null ? it.secs : it.reps }));
  AI.json = async (S1, day, prompt, schema, o) => { calls.push({ prompt, schema, o }); return { because: [{ fact: 'goal', line: 'You want bigger arms, so arms come first on each of your 3 days.' }], name: 'Arms first', note: 'Three short days with your arms first.', days: draft.days.map((d, i) => ({ title: d.title, why: 'Arms first, then the rest.', items: same(d).map((it, k) => (i === 0 && k === 0 ? Object.assign(it, { sets: 6 }) : it)) })) }; };
  try {
    const r = await C.refine(S, D0, w, draft, null);
    check('Claude gets the rules, the facts it may name and the reasons-first schema', calls.length === 1 && calls[0].o.feature === 'build' && /RULES FOR THIS PERSON/.test(calls[0].prompt) && calls[0].schema.required[0] === 'because' && calls[0].schema.properties.because.items.properties.fact.enum.includes('asked'));
    check('its plan comes back checked: by Claude, its reason kept, six sets put right and said so', r.by === 'claude' && r.plan.why[0] === 'You want bigger arms, so arms come first on each of your 3 days.' && r.plan.days[0].why === 'Arms first, then the rest.' && r.plan.days[0].items.every((it) => it.sets <= 4) && r.fixes.some((x) => /^Kept .+ to 4 sets on day 1/.test(x)), [r.by, r.plan && r.plan.why, r.fixes]);
    AI.json = async () => ({ because: [], name: 'Bad', note: '', days: [] });
    const bad = await C.refine(S, D0, w, draft, null);
    check('an answer that can\'t be used leaves the app\'s own plan, with its own reasons', bad.by === null && bad.plan === draft && bad.plan.why.length >= 2 && bad.fixes.length === 0);
    // Improve: what they had and the model kept stays as they had it.
    const mine = C.save(S, Object.assign(JSON.parse(JSON.stringify(draft)), { name: 'Mine', source: 'you' })).plan;
    C.update(S, mine.id, (p) => { p.days[0].items[0].sets = 6; });
    const plan6 = C.get(S, mine.id);
    AI.json = async () => ({ because: [{ fact: 'goal', line: 'You want bigger arms, so one more set goes to your curls.' }], name: 'x', note: 'A little more for your arms.', days: plan6.days.map((d, i) => ({ title: d.title, why: '', items: d.items.map((it, k) => ({ move: it.move, sets: i === 1 && k === 0 ? it.sets + 1 : it.sets, reps: it.secs != null ? it.secs : it.reps })) })) });
    const imp = await C.improve(S, D0, plan6, 'more for my arms');
    check('Improve keeps a choice of theirs the model left alone (six sets), and still checks what it changed', imp.by === 'claude' && imp.plan.days[0].items[0].sets === 6 && imp.plan.name === 'Mine' && Array.isArray(imp.fixes) && imp.changes.length >= 1, [imp.plan && imp.plan.days[0].items[0], imp.changes, imp.fixes]);
  } finally { AI.json = keep; }
  // The on-device model, through a stand-in.
  const D = GH.deviceCoach;
  const was = { lazy: GH.lazy, pick: D.pick };
  let seen = null;
  S.ai.mode = 'device';
  GH.lazy = async (name) => {
    if (name !== 'llm') throw new Error(`no chunk ${name}`);
    return { available: () => ({ ok: true }), installed: async () => [{ id: 'stand-in' }], load: async () => ({}), chat: async (msgs, o) => { seen = { msgs, o }; return JSON.stringify({ because: ['b2', 'b1'], name: 'Arms first', days: draft.days.map((d) => ({ title: d.title, items: same(d) })) }); } };
  };
  D.pick = () => 'stand-in';
  try {
    const r = await C.refine(S, D0, w, draft, null);
    const own = C.ownWhy(S, D0, w, draft, C.rules(S, D0, w, draft));
    check('the on-device model: a grammar from the rules, a low temperature, and its picks as the app\'s lines', r.by === 'device' && seen.o.temperature === 0.3 && /pick ::= /.test(seen.o.grammar) && /\[1-4\]/.test(seen.o.grammar) && r.plan.why[0] === own[1].line && r.plan.why[1] === own[0].line && r.plan.name === 'Arms first', [r.by, r.plan && r.plan.why]);
  } finally { GH.lazy = was.lazy; D.pick = was.pick; S.ai.mode = 'api'; }
}

/* ------------------------------------------------------------------ Check my plan */
section('Check my plan: the same facts, and a change for someone who misses workouts');
{
  const S = allow(person(OWNER, 4, { only: [0, 2], mins: 31 }), 2);
  const ctx = R.context(S, D0, 'claude');
  const ask = R.claudeAsk(S, ctx);
  check('Claude\'s check gets what the research says for them, with the plan', /FOR THIS PERSON \(from the research the app follows\)/.test(ask) && /Their weights are light for them/.test(ask) && /They eat little protein/.test(ask) && /They do about \d(\.5)? of the 3 workouts planned each week/.test(ask) && /what they actually do/.test(ask) && /PLAN \(next week/.test(ask));
  delete S.ai.consentV;
  check('not before they allow the newer list', !/FOR THIS PERSON|light for them|little protein/.test(R.claudeAsk(S, R.context(S, D0, 'claude'))));
  S.ai.consentV = 2;
  const dev = R.deviceMessages(S, D0, R.context(S, D0, 'device')).map((m) => m.content).join('\n');
  check('the on-device check gets the same, with who this is in full', /FOR THIS PERSON/.test(dev) && /- Age: 19; sex: male; 183 cm; 150 lb/.test(dev) && /Their weights: 10 lb is light/.test(dev) && /Eating, in their own words/.test(dev) && /Say nothing about losing weight/.test(dev) && /workouts missed or running long, weights that are light for them/.test(dev));
  check('a new kind, where the engine can try it: workouts a week', R.KINDS.includes('days') && JSON.stringify(R.SPEC.days) === '["days"]' && JSON.stringify(R.DAYS) === '[2,3,4,5,6]' && R.schema(ctx).properties.suggestions.items.anyOf.some((v) => v.properties.kind.enum[0] === 'days' && JSON.stringify(v.properties.days.enum) === '[2,3,4,5,6]') && /kind-days ::= /.test(R.grammar(R.context(S, D0, 'device'))) && /^days ::= "2" \| "3" \| "4" \| "5" \| "6"$/m.test(R.grammar(R.context(S, D0, 'device'))));
  const given = `${AI.systemBlocks(S, D0, 'review').map((b) => b.text).join('\n')}\n${ask}`;
  const v = R.validate(S, { suggestions: [
    { kind: 'days', days: 2, title: 'Plan 2 workouts a week', why: 'You do about 2 of the 3 workouts planned, so 2 you keep beats 3 you miss.' },
    { kind: 'days', days: 3, title: 'Stay at 3', why: 'It fits.' },
    { kind: 'days', days: 9, title: 'Nine days', why: 'More.' },
    { kind: 'tip', title: 'Eat more', why: 'Eat in a 500 calorie surplus. One more glass of milk a day is an easy start.' },
  ], note: 'Lose the belly fat first.' }, D0, { ctx, given });
  const two = v.items.find((x) => x.kind === 'days');
  const engine = GH.optimizer.applyTweaks(S, { days: 2 }, D0);
  check('it\'s tried like every change: offered exactly when the engine\'s own test passes, with what it does', engine.ok === !!two && (!two || (two.change.days === 2 && two.diff.some((l) => /2 workouts a week \(was 3\)/.test(l)))) && v.rejected.some((x) => /already has 3 workouts a week/.test(x.reason)) && v.rejected.some((x) => /2 to 6 workouts a week/.test(x.reason)), [engine.ok, two && two.diff, v.rejected]);
  check('its words are held to what a model may say: the calorie line and the weight-loss note go', v.tips.length === 1 && !/calorie|surplus/.test(v.tips[0].why) && /milk/.test(v.tips[0].why) && v.note === '' && v.cut >= 2, [v.tips, v.note, v.cut]);
  if (two) {
    const before = JSON.stringify([S.profile.days, S.profile.weekdays]);
    const res = R.apply(S, [two], D0, { engine: 'claude', source: 'test', declined: ['Rest 2 minutes between sets'] });
    const ev = S.events[S.events.length - 1];
    check('applied, the plan has 2 days; what was turned down is kept for the next model; undo puts it back', res.applied.length === 1 && S.profile.days === 2 && JSON.stringify(ev.declined) === '["Rest 2 minutes between sets"]' && /turned down: rest 2 minutes between sets/.test(P.facts(S, D0, { to: 'device' }).find((f) => f.id === 'likes').value) && R.undo(S, D0) && JSON.stringify([S.profile.days, S.profile.weekdays]) === before, [S.profile.days, ev.declined]);
  }
  check('the review says what it looked at besides the plan', (() => { const l = R.looked(S, D0, 'claude'); return l.includes('your goals') && l.includes('what your weights mean for you') && l.includes('how you eat') && l.includes('the workouts you\'ve done') && !l.includes('what you plan around'); })() && R.looked(person(Object.assign({}, OWNER, { conditions: ['back'] })), D0, 'device').includes('what you plan around'), R.looked(S, D0, 'claude'));
}

done();
