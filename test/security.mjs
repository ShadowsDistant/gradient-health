// Security checks: crafted share codes and plans (moves named after Object.prototype's keys), a plan
// that can't be built, malicious and huge backups, the model pins, CI release gating, the manifest
// and backup rules, and the WebView's navigation and bridge guards in the Java source.
// Usage: node test/security.mjs
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/planweek.js', 'src/tailor.js', 'src/store.js', 'src/coach.js', 'src/customplan.js');
const B = GH.brain;
const C = GH.customPlan;

const MON = B.dayFromStr('2026-09-28'); // a Monday
const USER = { goals: ['abs', 'chest'], experience: 'onoff', days: 3, minutes: 25, age: 30, units: 'kg', weightKg: 70, equipment: { db: [10], band: true } };
const fresh = () => { const S = B.newState(USER, { pushups: 12, plankSec: 40, curlL: 10, curlR: 10 }, MON); C.ensure(S); return S; };
// Object.prototype's own keys, and the ones JSON.parse turns into real keys ("__proto__").
const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype);
// A share code holding exactly this packed plan (the app's own format: a version byte, then JSON).
const codeFor = (packed) => {
  const json = new TextEncoder().encode(JSON.stringify(packed));
  const bytes = new Uint8Array(json.length + 1);
  bytes[0] = 1;
  bytes.set(json, 1);
  return Buffer.from(bytes).toString('base64url');
};
// Everything Today and Plan work out for a day: the calendar, today's plan, its session and the week.
function renders(S, day) {
  const cal = B.calendar(S, day);
  const tp = B.todayPlan(S, day, cal);
  const s = tp.type === 'workout' ? B.buildSession(S, day, tp.tpl, { cal }) : null;
  const week = GH.planWeek ? GH.planWeek(S, day) : null;
  return { tp, s, week };
}
const throwsNot = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };

/* ------------------------------------------------------------------ crafted links */
section('Crafted share codes');
{
  const bad = [];
  for (const key of PROTO_KEYS.concat(['__proto__', 'prototype'])) {
    const r = await C.decode(codeFor(['Evil', '', '', 0, [['A', [key, 3, 10], ['push_std', 3, 10]]]])).catch((e) => ({ error: e.message }));
    const ok = r.plan && r.plan.days[0].items.length === 1 && r.plan.days[0].items[0].move === 'push_std' && r.report.unknown.includes(key);
    if (!ok) { bad.push(key); continue; }
    const S = fresh();
    C.use(S, C.save(S, r.plan).plan.id, MON);
    const run = throwsNot(() => renders(S, MON));
    if (!run.ok || !run.value.s || run.value.s.items.some((it) => it.moveId === key)) bad.push(`${key}: ${run.error || 'session'}`);
  }
  check(`a move named after any of Object.prototype's ${PROTO_KEYS.length} keys is left out as unknown, and Today and Plan still work`, bad.length === 0, bad);
  // Every field of a code holding the wrong types: objects for names, strings for numbers, junk days.
  const junk = ['x', { a: 1 }, ['__proto__', 'constructor'], { length: 3 }, [['constructor'], ['toString', 'a', {}], [{}, 1, 2], 'push_std', null, ['push_std', '3', '10', '60']]];
  const r = await C.decode(codeFor(junk)).catch((e) => ({ error: e.message, code: e.code }));
  check('a code with the wrong types everywhere still reads as a plain plan, or as a broken code', (r.code === 'broken') || (r.plan && r.plan.days.every((d) => d.items.every((it) => Object.prototype.hasOwnProperty.call(GH.moves.MOVES, it.move)))), r);
  const pollute = await C.decode(codeFor(JSON.parse('["P", "", "", 0, [["A", ["push_std", 3, 10]]], {"__proto__": {"polluted": 1}}]'))).catch(() => null);
  check('a __proto__ key in a code doesn\'t reach Object.prototype', pollute && ({}).polluted === undefined);
}

section('Plans with prototype keys through normalize');
{
  const raw = JSON.parse('{"__proto__": {"polluted": 1}, "name": "constructor", "id": "constructor", "days": [{"title": "toString", "items": [{"move": "constructor", "sets": 3, "reps": 10}, {"move": "__proto__"}, {"move": "hasOwnProperty"}, {"move": "push_std", "sets": {"valueOf": 3}, "reps": "12"}]}], "weekdays": {"length": 1}}');
  const { plan, report } = C.normalize(raw);
  check('only the real move is kept, the rest are reported unknown', plan.days.length === 1 && plan.days[0].items.length === 1 && plan.days[0].items[0].move === 'push_std' && ['constructor', '__proto__', 'hasOwnProperty'].every((k) => report.unknown.includes(k)), { items: plan.days[0].items, report });
  check('the numbers come out as numbers in range', plan.days[0].items[0].sets === 3 && plan.days[0].items[0].reps === 12, plan.days[0].items[0]);
  check('nothing reached Object.prototype', ({}).polluted === undefined && Object.prototype.polluted === undefined);
  const draft = C.normalize({ days: [{ items: [{ move: 'valueOf' }, { move: 'toLocaleString' }] }] }, { draft: true });
  check('a draft of only prototype names keeps an empty day, not a crash', draft.plan.days.length === 1 && draft.plan.days[0].items.length === 0);
}

section('A plan that can\'t be built falls back to the coach\'s workout');
{
  // A bug, or a plan no check caught: the plan's session throws. Today and Plan carry on with the
  // coach's workout for that day, say so, and flag the plan.
  const S = fresh();
  const plan = C.save(S, C.normalize({ name: 'Mine', days: [{ items: [{ move: 'push_std', sets: 3, reps: 10 }] }, { items: [{ move: 'sq_bw', sets: 3, reps: 12 }] }, { items: [{ move: 'curl_std', sets: 3, reps: 10 }] }] }).plan).plan;
  C.use(S, plan.id, MON);
  const before = renders(S, MON);
  check('the plan runs today as it is', before.s && before.s.custom && before.s.custom.id === plan.id && !before.s.planBroken);
  const adjust = GH.access.adjustSession;
  GH.access.adjustSession = function (S2, s, day, o) { if (o && o.custom) throw new Error('a broken plan'); return adjust.apply(this, arguments); };
  const run = throwsNot(() => renders(S, MON));
  GH.access.adjustSession = adjust;
  const s = run.ok && run.value.s;
  check('Today and Plan don\'t throw', run.ok, run.error);
  check('the day runs the coach\'s session (not the plan\'s)', s && !s.custom && typeof s.tpl === 'number' && s.items.length > 0, s && { tpl: s.tpl, custom: s.custom });
  check('it says why, in plain words', s && s.notes.some((n) => n.kind === 'plan' && /Your plan "Mine" couldn't be used today/.test(n.text)), s && s.notes);
  check('the session and the plan are flagged', s && s.planBroken && s.planBroken.id === plan.id && C.get(S, plan.id).broken === true);
  check('the week still has its seven days', run.ok && run.value.week && run.value.week.days.length === 7, run.ok && run.value.week && run.value.week.days && run.value.week.days.length);
  // A plan saved before this version with a move named after a prototype key (no normalize since).
  const S2 = fresh();
  const p2 = C.save(S2, C.normalize({ name: 'Old', days: [{ items: [{ move: 'push_std', sets: 3, reps: 10 }] }] }).plan).plan;
  C.use(S2, p2.id, MON);
  p2.days[0].items.unshift({ move: 'constructor', sets: 3, reps: 10 }, { move: 'toString', sets: 3, reps: 10 });
  const run2 = throwsNot(() => renders(S2, MON));
  check('a saved plan holding "constructor" and "toString" doesn\'t crash Today or Plan', run2.ok && run2.value.s && run2.value.s.items.every((it) => GH.moves.MOVES[it.moveId] && it.moveId !== 'constructor'), run2.error);
  C.migrate(S2);
  check('and the next load drops those moves from it', C.get(S2, p2.id).days[0].items.map((it) => it.move).join() === 'push_std', C.get(S2, p2.id).days[0].items);
  // A plan switch a backup mangled ("n": "constructor") keeps the coach's week.
  const S3 = fresh();
  S3.events.push({ type: 'plan', day: MON, id: p2.id, n: 'constructor', wd: { length: 2 } });
  S3.customPlans.push(JSON.parse(JSON.stringify(p2)));
  const run3 = throwsNot(() => renders(S3, MON));
  check('a mangled plan switch keeps the calendar working', run3.ok, run3.error);
}

/* ------------------------------------------------------------------ restores */
const store = GH.store;
const TODAY = B.dayOf(Date.now(), 4);
// A backup of someone a week in, as Copy my data writes it, with `edit` applied to its state.
const base = (() => {
  const S = B.newState(USER, { pushups: 12, plankSec: 40, curlL: 10, curlR: 10 }, TODAY - 7);
  C.ensure(S);
  for (let d = TODAY - 7; d < TODAY; d++) { B.logLight(S, d, 'walk', true); B.addProtein(S, d, 30); }
  return JSON.parse(store.exportJson(S));
})();
const backup = (edit) => { const o = JSON.parse(JSON.stringify(base)); if (edit) edit(o.state, o); return JSON.stringify(o); };
// Any key, anywhere, that would reach a prototype.
const BAD = new Set(PROTO_KEYS.concat('prototype'));
function badKeys(v, path = '$', out = []) {
  if (!v || typeof v !== 'object') return out;
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) out.push(`${path} (prototype)`);
  for (const k of Object.keys(v)) { if (BAD.has(k)) out.push(`${path}.${k}`); badKeys(v[k], `${path}.${k}`, out); }
  return out;
}
const works = (S) => throwsNot(() => { const r = renders(S, TODAY); B.weeklySets(S, TODAY); return r; });

section('Malicious backups');
{
  // Prototype keys at every level, as JSON.parse sees them (own keys named __proto__ and the rest).
  const plainText = backup();
  const text = plainText.replace('"state":{', '"state":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"toString":"x",')
    .replace('"profile":{', '"profile":{"__proto__":{"isAdmin":true},"hasOwnProperty":1,"valueOf":{"a":1},')
    .replace('"health":{"days":{}', '"health":{"__defineGetter__":2,"days":{"toString":1,"__proto__":{"x":1}}');
  check('(the backup has them all)', ['"state":{"__proto__"', '"profile":{"__proto__"', '"days":{"toString":1,"__proto__"'].every((s) => text.includes(s)));
  const r = store.importJson(text);
  check('a backup full of prototype keys still restores', r.ok, r.error);
  check('none of them reach Object.prototype', ({}).polluted === undefined && ({}).isAdmin === undefined && Object.prototype.x === undefined);
  check('and none is left anywhere in the state', r.ok && badKeys(r.state).length === 0, r.ok && badKeys(r.state).slice(0, 5));
  check('objects still behave (no shadowed toString or hasOwnProperty)', r.ok && String(r.state.health.days) === '[object Object]' && typeof r.state.profile.hasOwnProperty === 'function' && r.state.profile.isAdmin === undefined);

  // The wrong type in every field the app reads.
  const t = store.importJson(backup((S) => {
    Object.assign(S.profile, { days: '7', minutes: 9999, age: -5, heightCm: 'tall', weightKg: 1e9, weekdays: 'mon', units: 'stone', where: 'moon', goals: 'abs', careful: ['knee', 'soul'], lead: 'L', equipment: 'all', gym: [1], prefs: { rollHour: 99, density: 7, haptics: 'yes' }, startDay: -1e9, onboarded: 'true' });
    S.events.push(null, 1, 'x', { type: 'settings', day: 'x' }, { type: 'plan', day: TODAY, id: 'nope', n: 99 }, { type: 'move', from: 1 }, { type: 'settings', day: TODAY - 1, days: 40, minutes: 1, weekdays: [9, 9] });
    S.log.push(null, 5, { type: 'workout', day: 'yesterday' }, { type: 'workout', day: TODAY - 1, items: 'lots', lines: {}, checkin: 'ok', pct: 'all' }, { day: TODAY });
    S.weights = [{ day: TODAY, kg: 'heavy' }, null, { day: 'x', kg: 70 }, { day: TODAY, kg: 71 }];
    S.prog = { push: { rung: 'constructor', reps: 'many' }, nonsense: { rung: 'push_std' }, squat: 'deep', row: { rung: 'push_std' } };
    S.vol = { chest: 'lots', wings: 9, legs: 1e6 };
    S.pain = { knee: 'always', soul: TODAY };
    S.catchup = {};
    S.active = { day: 'today', steps: 'many', session: null };
    S.health = { days: { [TODAY]: null, [TODAY - 1]: { exercise: [null, 7, { minutes: 50, typeName: 'run' }] } }, hc: 'x', lastSync: 'soon' };
    S.protein = { [TODAY]: 'lots', [TODAY - 1]: [30, '40', null] };
    S.food = { days: { [TODAY]: 'x', [TODAY - 1]: [null, { kcal: 100, p: 5, c: 10, f: 3 }] }, custom: 'x' };
    S.ai = { chat: 'hi', reports: [null], mode: 'telepathy', enabled: 'yes' };
    S.place = { [TODAY]: 'moon' };
    S.excluded = ['constructor', 'push_std', 7, 'no_such_move'];
    S.complexity = 99;
    S.feel = [];
    S.customPlans = 'mine';
  }));
  check('a backup with the wrong type in every field restores', t.ok, t.error);
  const T = t.state || {};
  const p = T.profile || {};
  check('the plan numbers come back in range (days 2-6, minutes 10-60, age 13-100)', p.days >= 2 && p.days <= 6 && p.minutes === 60 && (p.age === null || (p.age >= 13 && p.age <= 100)) && p.heightCm === null && p.weightKg === 400 && p.weekdays === null, { days: p.days, minutes: p.minutes, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, weekdays: p.weekdays });
  check('and the rest of the profile as the app expects it', p.units === 'lb' && p.where === 'home' && Array.isArray(p.goals) && p.careful.join() === 'knee' && p.lead.arm === null && typeof p.equipment === 'object' && Array.isArray(p.equipment.db) && p.prefs.rollHour === 23 && p.prefs.density === 1 && typeof p.prefs.haptics === 'boolean' && typeof p.onboarded === 'boolean' && p.startDay >= 18262, p);
  check('lists keep only what holds together', T.events.every((e) => e && typeof e.type === 'string') && !T.events.some((e) => e.type === 'plan' && e.id === 'nope' && e.n === 99) && T.events.filter((e) => e.type === 'settings').every((e) => Number.isInteger(e.day) && e.days >= 2 && e.days <= 6 && e.minutes >= 10 && e.minutes <= 60) && T.log.every((l) => l && typeof l.type === 'string' && Array.isArray(l.items || [])) && T.weights.length === 1, { events: T.events, weights: T.weights });
  check('levels only on ladders and rungs this version has', Object.keys(T.prog).every((f) => GH.moves.LADDERS[f] && GH.moves.LADDERS[f].rungs.includes(T.prog[f].rung) && Number.isFinite(T.prog[f].reps)) && !T.prog.nonsense && !T.prog.squat && T.prog.push.rung === GH.moves.LADDERS.push.rungs[0] && T.prog.row.rung === GH.moves.LADDERS.row.rungs[0], T.prog);
  check('unknown moves and groups are dropped', T.excluded.join() === 'push_std' && !('wings' in T.vol) && T.vol.legs <= 100 && Object.keys(T.pain).length === 0);
  check('a broken workout in progress is dropped, and left vs right tests start again', T.active === null && T.catchup.arm && typeof T.catchup.arm.active === 'boolean');
  check('health, protein, food and chats come back in the shapes the screens read', !(TODAY in T.health.days) && T.health.days[TODAY - 1].exercise.length === 1 && T.health.lastSync === null && !(TODAY in T.protein) && T.protein[TODAY - 1].join() === '30' && T.food.days[TODAY - 1].length === 1 && Array.isArray(T.ai.chat) && T.ai.reports.length === 0 && T.ai.mode === 'device' && T.ai.enabled === false && !(TODAY in T.place) && T.complexity === 2 && Array.isArray(T.customPlans));
  const w = works(T);
  check('and Today, Plan and the week\'s sets work it all out', w.ok, w.error);
  check('with whole numbers of sets (a muscle group whose volume went starts again)', B.GROUPS.every((g) => typeof T.vol[g] === 'number') && w.ok && (!w.value.s || w.value.s.items.every((it) => Number.isInteger(it.sets) && it.sets > 0)), { vol: T.vol, items: w.ok && w.value.s && w.value.s.items.map((it) => it.sets) });

  // startDay a billion days ago: the calendar walks from it every render.
  const t0 = Date.now();
  const far = store.importJson(backup((S) => { S.profile.startDay = -1e9; S.events[0].day = -1e9; }));
  const fw = far.ok && works(far.state);
  check('a start date from long ago can\'t make the calendar walk forever', far.ok && far.state.profile.startDay >= 18262 && fw.ok && Date.now() - t0 < 5000, { ms: Date.now() - t0, error: fw && fw.error });

  // A plan named after a prototype key: any lookup by its id (its progress, say) would find the
  // prototype's function instead.
  const pl = store.importJson(backup((S) => {
    S.customPlans = [{ v: 1, id: 'constructor', name: 'Evil', days: [{ title: 'A', items: [{ move: 'push_std', sets: 3, reps: 10 }] }], weekdays: null, source: 'shared' }, { v: 1, id: 'prototype', name: 'Also', days: [{ title: 'B', items: [{ move: 'sq_bw', sets: 3, reps: 10 }] }], source: 'you' }];
    S.activePlan = 'constructor';
    S.events.push({ type: 'plan', day: TODAY - 1, id: 'constructor', n: 1, wd: null });
    S.planProg = { constructor: { 'push_std:10': { reps: 12 } }, ok: { 'levitate:10': { reps: 1 }, 'push_std:10': 'x' } };
  }));
  check('a plan called "constructor" or "prototype" goes, with its switch and progress', pl.ok && pl.state.customPlans.length === 0 && pl.state.activePlan === null && !pl.state.events.some((e) => e.type === 'plan') && !Object.prototype.hasOwnProperty.call(pl.state.planProg, 'constructor') && Object.keys(pl.state.planProg.ok || {}).length === 0, pl.ok ? { plans: pl.state.customPlans, planProg: pl.state.planProg } : pl.error);
  const act = store.importJson(backup((S) => {
    const s = B.buildSession(Object.assign(B.newState(USER, null, TODAY), {}), TODAY, 0, { noReadiness: true });
    s.items[0].moveId = 'constructor';
    S.active = { day: TODAY, tpl: 0, startedAt: Date.now(), session: s, steps: [{ kind: 'set', item: s.items[0] }], idx: 0, logs: [] };
  }));
  check('a workout in progress naming an unknown move is dropped', act.ok && act.state.active === null);
}

section('Huge backups');
{
  const t0 = Date.now();
  const big = store.importJson(`{"app":"gradient-health","state":"${'x'.repeat(store.MAX_TEXT)}"}`);
  check('more than 20 MB is turned down at once, with a reason', !big.ok && /too much text/.test(big.error) && Date.now() - t0 < 3000, big.error);
  const long = store.importJson(backup((S) => {
    for (let i = 0; i < 15000; i++) S.log.push({ type: 'light', day: TODAY - 20000 + i, walk: true, mobility: true });
    for (let i = 0; i < 60000; i++) S.events.push({ type: 'deloadNext', day: TODAY - 60000 + i });
    S.weights = Array.from({ length: 25000 }, (_, i) => ({ day: TODAY - 25000 + i, kg: 70 }));
    S.activities = Array.from({ length: 600 }, (_, i) => ({ v: 1, id: `a${i}`, type: 'walk', title: 'Walk', start: Date.now() - (600 - i) * 3600000, end: Date.now(), day: TODAY, distanceM: 1000, records: [] }));
  }));
  const L = long.state || {};
  check('long lists keep their newest entries (log 10k, events 50k, weights 20k)', long.ok && L.log.length === 10000 && L.log[L.log.length - 1].day === TODAY - 20000 + 14999 + 0 && L.events.length <= 50000 && L.events[L.events.length - 1].day === TODAY - 1 && L.weights.length === 20000 && L.weights[19999].day === TODAY - 1, long.ok ? { log: L.log.length, events: L.events.length, weights: L.weights.length } : long.error);
  check('activities keep the newest 500, newest first', long.ok && L.activities.length === 500 && L.activities[0].id === 'a599' && L.activities.every((a, i) => i === 0 || L.activities[i - 1].start >= a.start));
  const s = store.importJson(backup((S) => {
    S.achievements = { earned: { first: { at: 1 } } }; // a newer version's field, before the junk
    S.profile.name = 'n'.repeat(100000);
    S.profile.goals = Array.from({ length: 500 }, (_, i) => `g${i}`);
    S.seen.note = 'z'.repeat(50000);
    let deep = {}; const top = deep;
    for (let i = 0; i < 200; i++) { deep.next = {}; deep = deep.next; }
    S.newerThing = { ok: true, nested: top };
    for (let i = 0; i < 100; i++) S[`extra${i}`] = i;
    S.hugeThing = Array.from({ length: 10000 }, () => 'y'.repeat(300));
  }));
  const X = s.state || {};
  check('strings are cut (a name to 60 characters, anything else to 20,000)', s.ok && X.profile.name.length === 60 && X.profile.goals.length <= 12 && X.seen.note.length === 20000, s.error);
  let depth = 0;
  for (let v = X.newerThing && X.newerThing.nested; v && typeof v === 'object'; v = v.next) depth++;
  check('a branch nested too deep is cut, without overflowing the stack', s.ok && X.newerThing.ok === true && depth > 0 && depth < 40, depth);
  const extras = Object.keys(X).filter((k) => /^extra\d+$/.test(k));
  check('fields this version doesn\'t know stay only as small plain JSON, and not too many of them', s.ok && X.achievements && X.achievements.earned.first.at === 1 && extras.length < 64 && !('hugeThing' in X), { extras: extras.length, huge: 'hugeThing' in X });
}

done();
