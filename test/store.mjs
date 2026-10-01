// Persistence: local and file copies (newer wins), empty and broken storage, backups without the
// AI key, restore validation (a real state comes back exactly; the checks on every load), and
// resuming a workout after a reload. Malicious and huge backups are in test/security.mjs.
import { load, check, section, done } from './lib.mjs';

// A fake browser: localStorage plus the Android bridge's file and secret store.
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const file = { state: '', secrets: {} };
globalThis.AndroidBridge = {
  save: (s) => { file.state = s; return true; }, load: () => file.state,
  saveSecret: (k, v) => { file.secrets[k] = v; return true; }, loadSecret: (k) => file.secrets[k] || '', deleteSecret: (k) => { delete file.secrets[k]; return true; },
};
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/food.js', 'src/activity.js', 'src/store.js', 'src/customplan.js');
const B = GH.brain;
const store = GH.store;
const D0 = B.dayFromStr('2026-09-28');
const P = { goals: ['abs', 'arms'], equipment: { db: [8], kb: [10] }, weightKg: 67.5, lead: { arm: 'L' } };

section('Empty and broken storage');
check('first run: nothing stored → null', store.load() === null);
ls.set(store.KEY, '{not json');
file.state = '';
check('a corrupt copy is ignored', store.load() === null);
const saved = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
const S0 = B.newState(P, null, D0);
check('storage that throws (private mode) never breaks saving', store.save(S0) === true && store.load() !== null);
globalThis.localStorage = saved;

section('Two copies, newer wins');
ls.clear(); file.state = '';
const S = B.newState(P, { curlL: 14, curlR: 18 }, D0);
store.save(S);
check('saved to both localStorage and the app file', ls.has(store.KEY) && file.state.length > 100);
const a = JSON.parse(ls.get(store.KEY));
a.updatedAt += 60000; a.profile.minutes = 40;
file.state = JSON.stringify(a);
check('the newer app-file copy wins', store.load().profile.minutes === 40);
ls.set(store.KEY, JSON.stringify(Object.assign(JSON.parse(file.state), { updatedAt: a.updatedAt + 1, profile: Object.assign({}, a.profile, { minutes: 15 }) })));
check('the newer local copy wins', store.load().profile.minutes === 15);
file.state = '{"half":';
check('a broken app file falls back to the local copy', store.load().profile.minutes === 15);

section('Migration');
const old = JSON.parse(JSON.stringify(S));
delete old.health; delete old.ai; delete old.insightsDismissed; delete old.profile.prefs.rollHour;
const m = store.migrate(old);
check('missing parts are filled in', m.health && m.health.days && m.health.hc && m.health.manual && m.ai && Array.isArray(m.ai.reports) && m.insightsDismissed && m.profile.prefs.rollHour === 4);

section('The AI key never lands in the state or a backup');
store.saveSecret('anthropic_api_key', 'fakekey-test-0123456789abcdefghij');
check('the key lives in the app\'s private preferences', file.secrets.anthropic_api_key === 'fakekey-test-0123456789abcdefghij' && !ls.has('gh.secret.anthropic_api_key'));
S.ai.apiKey = 'fakekey-stray-0123456789'; // even if something put one there by mistake
store.save(S);
const exported = store.exportJson(S);
check('not in the saved state', !/fakekey/.test(ls.get(store.KEY)) && !/fakekey/.test(file.state));
check('not in Copy my data', !/fakekey/.test(exported));
check('loadSecret reads it back', store.loadSecret('anthropic_api_key') === 'fakekey-test-0123456789abcdefghij');
store.deleteSecret('anthropic_api_key');
check('delete removes it', store.loadSecret('anthropic_api_key') === '');

section('Restore');
check('rejects text that isn\'t a backup', !store.importJson('hello').ok && !store.importJson('{"a":1}').ok);
const newer = JSON.parse(exported); newer.schema = 99;
check('rejects a backup from a newer version', !store.importJson(JSON.stringify(newer)).ok);
const r = store.importJson(exported);
check('accepts Copy my data and summarizes it', r.ok && r.state.profile.goals.join() === 'abs,arms' && r.workouts === 0 && r.since === D0);
check('a bare state (older backups) also restores', store.importJson(JSON.stringify(S)).ok);

section('Restore checks every part, and keeps a real state exactly');
// Every field the checks look at, the way the app writes them: weeks of workouts and light days, a
// custom plan in use with its progress, a workout under way, food, an activity with its route,
// health days, chats, and fields a newer version keeps (left alone, as plain JSON).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function lived() {
  const R = B.newState(Object.assign({}, P, { days: 4, minutes: 30, age: 34, heightCm: 178, weekdays: [0, 1, 3, 4] }), { pushups: 15, plankSec: 45, curlL: 12, curlR: 13 }, D0 - 28);
  const C = GH.customPlan;
  C.ensure(R);
  const plan = C.save(R, C.normalize({ name: 'Upper lower', days: [{ title: 'Upper', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'row_db', sets: 3, reps: 10 }] }, { title: 'Lower', items: [{ move: 'sq_goblet', sets: 3, reps: 12 }, { move: 'side_plank', sets: 2, secs: 30 }] }] }).plan).plan;
  for (let d = D0 - 28; d < D0; d++) {
    if (d === D0 - 10) C.use(R, plan.id, d);
    const tp = B.todayPlan(R, d);
    if (tp.type === 'light') { B.logLight(R, d, 'walk', true); B.logLight(R, d, 'mobility', true); continue; }
    if (tp.type !== 'workout') continue;
    B.startWorkout(R, d, { now: d * B.DAY_MS + 17 * 3600000 });
    for (let g = 0; R.active && R.active.idx < R.active.steps.length && g < 500; g++) {
      const st = R.active.steps[R.active.idx];
      B.completeStep(R, st.kind === 'test' ? { value: 12 } : {});
      if (st.askRir) B.setRir(R, st.item, '12');
    }
    B.finishWorkout(R, { rating: 'right', now: d * B.DAY_MS + 18 * 3600000 });
    B.addProtein(R, d, 30);
  }
  B.startWorkout(R, D0, { now: D0 * B.DAY_MS + 17 * 3600000 });
  B.completeStep(R, {});
  GH.food.setMode(R, 'full');
  GH.food.add(R, D0, Object.assign({ name: 'Oats', src: 'usda', ref: 8121, g: 80 }, GH.food.scale({ kcal: 379, p: 13.2, c: 67.7, f: 6.5, fib: 10.1 }, 80)), D0 * B.DAY_MS + 8 * 3600000);
  const t0 = (D0 - 2) * B.DAY_MS + 7 * 3600000;
  const pts = Array.from({ length: 900 }, (_, i) => [t0 + i * 1000, 40.78 + i * 2e-5, -73.96 + Math.sin(i / 40) * 1e-4, 12, 5, 2.9, 0]);
  GH.activity.add(R, GH.activity.build(R, { id: 'run1', type: 'run', title: 'Park run', start: t0, end: t0 + 900000, points: pts, pauses: [], pausedMs: 0, movingMs: 900000, steps: 2400 }));
  R.health.days[D0 - 1] = { steps: 8123, sleepMin: 415, rhr: 57, hrv: 52, exercise: [{ start: t0, end: t0 + 1800000, minutes: 30, typeName: 'walking' }] };
  R.ai.chat.push({ role: 'user', content: 'How is my sleep?' }, { role: 'assistant', content: 'About 6 h 55 a night.' });
  R.feel[D0] = { energy: 'good', sore: 'some' };
  R.achievements = { earned: { firstWorkout: { at: D0 } } };
  R.profile.planTweaks = [{ kind: 'more_sets', group: 'back' }];
  return R;
}
const R = lived();
const copyR = () => JSON.parse(JSON.stringify(R));
check('(the state has all of that)', R.log.filter((l) => l.type === 'workout').length >= 10 && R.log.some((l) => l.type === 'light') && Object.keys(R.planProg[R.activePlan] || {}).length > 0 && R.active && R.activities[0].route && GH.food.entries(R, D0).length === 1 && Object.keys(R.prog).length > 10, { workouts: R.log.length, planProg: R.planProg, active: !!R.active });
check('the checks leave a real state exactly as it was', same(store.sanitize(copyR()), R) && same(store.sanitize(copyR(), { deep: false }), R));
const back2 = store.importJson(store.exportJson(R));
check('so it restores from Copy my data unchanged', back2.ok && same(back2.state, store.migrate(copyR())) && back2.state.active && back2.state.activities.length === 1 && back2.state.activePlan && back2.state.achievements.earned.firstWorkout);
check('the plan in use, its progress and the workout under way come back', back2.ok && back2.state.activePlan === R.activePlan && same(back2.state.planProg, R.planProg) && back2.state.active.idx === R.active.idx);

section('Every load runs the quick checks');
ls.clear();
const junk = Object.assign(copyR(), { updatedAt: Date.now() + 1e6, catchup: {}, active: { day: 'today', steps: 'all of them' } });
junk.events.push(null, 7, { type: 'settings', day: 'monday' });
junk.log.push(null, { type: 'workout', day: D0 - 1, items: [null, { moveId: 'push_std', sets: [null] }] });
junk.profile.minutes = 500;
junk.protein[D0] = 'lots';
junk.health.days[D0] = null;
file.state = JSON.stringify(junk);
const L = store.load();
check('a state bent by a bug loads in shape', L && L.catchup.arm && L.active === null && L.events.every((e) => e && typeof e.type === 'string' && (e.type !== 'settings' || Number.isInteger(e.day))) && L.log.every((l) => l && typeof l === 'object') && L.profile.minutes === 60 && !(D0 in L.protein) && !(D0 in L.health.days));
const lw = L.log[L.log.length - 1];
check('and keeps everything that was fine', L.log.length === R.log.length + 1 && lw.items.length === 1 && lw.items[0].sets.length === 0 && L.customPlans.length === 1 && L.activities.length === 1);
let threw = null;
try { const cal = B.calendar(L, D0); const tp = B.todayPlan(L, D0, cal); if (tp.type === 'workout') B.buildSession(L, D0, tp.tpl, { cal }); } catch (e) { threw = e.message; }
check('and the plan works it out', threw === null, threw);

section('Resuming a workout after a reload');
const W = B.newState(P, null, D0);
B.startWorkout(W, D0, { now: D0 * B.DAY_MS });
B.completeStep(W, {}); B.completeStep(W, {});
store.save(W);
const back = store.load();
const A = back.active;
const st = A.steps[A.idx];
const pool = A.session.items.concat(A.session.extras, A.session.warmup, A.session.tests, A.session.mobility, A.session.finisher ? [A.session.finisher] : []);
check('steps point at the session\'s own items again (not copies)', A.steps.every((x) => !x.item || pool.includes(x.item)));
let guard = 0;
while (back.active && back.active.idx < back.active.steps.length && guard++ < 200) B.completeStep(back, {});
const res = B.finishWorkout(back, { rating: 'right', now: (D0 + 0.8) * B.DAY_MS });
check('the resumed workout finishes and counts', res && res.done && B.calendar(back, D0).streak.current === 1, st && st.kind);

done();
