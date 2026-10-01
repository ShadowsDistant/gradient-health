// Security checks: crafted share codes and plans (moves named after Object.prototype's keys), a plan
// that can't be built, malicious and huge backups, the model pins, CI release gating, the manifest
// and backup rules, and the WebView's navigation and bridge guards in the Java source.
// Usage: node test/security.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

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

/* ------------------------------------------------------------------ the Android shell (source) */
const read = (f) => readFileSync(join(root, f), 'utf8');
const JAVA = 'android/src/com/shadowsdistant/gradienthealth/';
// The body of the first method whose declaration contains `sig`, braces matched.
function body(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let j = src.indexOf('{', i), depth = 0;
  const start = j;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(start, j + 1);
}

section('The WebView: only the app\'s own page, over https');
{
  const MA = read(`${JAVA}MainActivity.java`);
  check('the app\'s host counts only over https, on the usual port', /"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/.test(body(MA, 'static boolean isAppHost(')) && /getPort\(\) == -1/.test(body(MA, 'static boolean isAppHost(')));
  const intercept = body(MA, 'public WebResourceResponse shouldInterceptRequest(');
  check('the app\'s host over http (or another port) gets a 403, not the network', /namesAppHost\(uri\)\)\s*\{[^}]*emptyResponse\(403/.test(intercept), intercept.slice(0, 300));
  const nav = body(MA, 'private boolean handleNavigation(');
  check('navigation: the app\'s pages stay in, about:blank is allowed, a foreign frame is blocked', /if \(isAppHost\(uri\)\) \{\s*return false;/.test(nav) && /"about:blank"/.test(nav) && /if \(!mainFrame\b[^{]*\{\s*return true;/.test(nav), nav);
  check('javascript:, data: and blob: pages are never let through', !/"(javascript|data|blob)"/.test(nav) && /return true;\s*\}$/.test(nav.trim()), nav);
  check('no pop-up windows, and never http content on the page', /setSupportMultipleWindows\(false\)/.test(MA) && /setJavaScriptCanOpenWindowsAutomatically\(false\)/.test(MA) && /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/.test(MA) && !/MIXED_CONTENT_(ALWAYS_ALLOW|COMPATIBILITY_MODE)/.test(MA));
  check('no file or content access, and nothing opened up for file pages', /setAllowFileAccess\(false\)/.test(MA) && /setAllowContentAccess\(false\)/.test(MA) && !/setAllow(Universal|File)AccessFromFileURLs\(true\)/.test(MA));
  check('one bridge, and debugging only in a debug build', (MA.match(/addJavascriptInterface\(/g) || []).length === 1 && /FLAG_DEBUGGABLE\) != 0\) \{\s*try \{\s*WebView\.setWebContentsDebuggingEnabled\(true\)/.test(MA));
  const track = body(MA, 'private void trackPage(');
  check('pageTrusted is volatile, follows each page start and address change, and is true only for the app', /private volatile boolean pageTrusted;/.test(MA) && /onPageStarted\(WebView view, String url, Bitmap favicon\) \{\s*trackPage\(view, url\);/.test(MA) && /doUpdateVisitedHistory\(WebView view, String url, boolean isReload\) \{\s*trackPage\(view, url\);/.test(MA) && /isAppHost\(Uri\.parse\(url\)\)/.test(track) && /pageTrusted = trusted;/.test(track), track);
  check('the app\'s page is trusted before it loads (its first bridge call can\'t race the flag)', /pageTrusted = isAppHost\(Uri\.parse\(url\)\);\s*wv\.loadUrl\(url\);/.test(MA));
  check('the camera only for the app\'s own page', /!isAppHost\(request\.getOrigin\(\)\)/.test(MA));
}

section('The bridge answers only the app\'s page');
{
  const BR = read(`${JAVA}Bridge.java`);
  // Everything that reads or changes data, reaches the network or another app, or runs a model.
  const GATED = /^(save\w*|load\w*|deleteSecret|hc\w+|model\w+|share\w+|openUrl|act\w+|llm\w+|foodLookup|copy|pendingLink)$/;
  // The rest: the screen, haptics and harmless facts about the phone.
  const OPEN = /^(keepAwake|vibrate\w*|haptic\w*|isDark|setSystemBars|insets|claudeInstalled|appVersion|deviceMemory|rendererGone)$/;
  const methods = [...BR.matchAll(/@JavascriptInterface\n(?:\s*@\w+(?:\([^)]*\))?\n)?\s*public [\w<>[\]]+ (\w+)\(([^)]*)\) \{\n([^\n]*)/g)].map((m) => ({ name: m[1], first: m[3].trim() }));
  const ungated = methods.filter((m) => GATED.test(m.name) && m.first !== 'if (!trusted()) {');
  const unknown = methods.filter((m) => !GATED.test(m.name) && !OPEN.test(m.name)).map((m) => m.name);
  check(`all ${methods.filter((m) => GATED.test(m.name)).length} bridge methods with side effects check trusted() first (secrets, save and load, hc*, model*, share*, openUrl, act*, llm*)`, methods.length > 40 && ungated.length === 0, ungated.map((m) => m.name));
  check('every other bridge method is one of the harmless kinds (a new one has to be sorted into a list here)', unknown.length === 0, unknown);
  check('trusted() asks MainActivity whether the page is the app\'s', /private boolean trusted\(\) \{\s*return activity\.pageTrusted\(\);/.test(BR));
}

section('The API key is encrypted on the phone (SecretBox)');
{
  const SB = read(`${JAVA}SecretBox.java`);
  const BR = read(`${JAVA}Bridge.java`);
  check('AES-256-GCM with a 128-bit tag, under an Android Keystore key (alias gh-secrets-1)', /"AndroidKeyStore"/.test(SB) && /ALIAS = "gh-secrets-1"/.test(SB) && /"AES\/GCM\/NoPadding"/.test(SB) && /TAG_BITS = 128/.test(SB) && /new GCMParameterSpec\(TAG_BITS, iv\)/.test(SB));
  check('the key is made with KeyGenParameterSpec: GCM only, 256 bits, a fresh IV each time', /new KeyGenParameterSpec\.Builder\(ALIAS,\s*KeyProperties\.PURPOSE_ENCRYPT \| KeyProperties\.PURPOSE_DECRYPT\)/.test(SB) && /setBlockModes\(KeyProperties\.BLOCK_MODE_GCM\)/.test(SB) && /setKeySize\(256\)/.test(SB) && /setRandomizedEncryptionRequired\(true\)/.test(SB) && !/cipher\.init\(Cipher\.ENCRYPT_MODE[^;]*GCMParameterSpec/.test(SB));
  check('stored as v2:<base64 IV>:<base64 ciphertext>', /VERSION = "v2"/.test(SB) && /VERSION \+ ":" \+ Base64\.encodeToString\(iv, Base64\.NO_WRAP\) \+ ":"/.test(SB) && /parts\.length != 3 \|\| !VERSION\.equals\(parts\[0\]\)/.test(SB));
  const save = body(BR, 'public boolean saveSecret('), loadS = body(BR, 'public String loadSecret(');
  check('saveSecret stores only the sealed value', /SecretBox\.seal\(value\)/.test(save) && !/putString\(name, value/.test(save));
  check('loadSecret opens it, seals a plain value from before 1.6, and deletes what it can\'t open', /SecretBox\.open\(stored\)/.test(loadS) && /putString\(name, SecretBox\.seal\(value\)\)/.test(loadS) && /catch \(Throwable t\) \{\s*try \{\s*prefs\.edit\(\)\.remove\(name\)\.commit\(\);/.test(loadS) && /return "";\s*\}\s*\}\s*\}$/.test(loadS.trim()));
  check('nothing about secrets is ever logged', ![SB, BR].some((s) => /\bLog\.[a-z]+\(|System\.(out|err)|printStackTrace/.test(s)));
}

section('Backups: none on Android 8, encrypted only from Android 9, never the key');
{
  const v26 = read('android/res/xml/backup_rules.xml'), v28 = read('android/res/xml-v28/backup_rules.xml'), v31 = read('android/res/xml/data_extraction_rules.xml');
  const domains = ['root', 'file', 'database', 'sharedpref', 'external'];
  check('Android 8 (res/xml/) backs up nothing: no includes, and every domain excluded', !/<include\b/.test(v26.replace(/<!--[\s\S]*?-->/g, '')) && domains.every((d) => new RegExp(`<exclude domain="${d}" path="\\." />`).test(v26)));
  const inc28 = v28.replace(/<!--[\s\S]*?-->/g, '').match(/<include\b[^>]*>/g) || [];
  check('Android 9 to 11 (res/xml-v28/): only end-to-end encrypted backups, without the key', inc28.length >= 1 && inc28.every((t) => /requireFlags="clientSideEncryption"/.test(t)) && /<exclude domain="sharedpref" path="secrets\.xml" \/>/.test(v28));
  check('Android 12 and newer: cloud backups only with encryption, the key never in one or in a device transfer', /<cloud-backup disableIfNoEncryptionCapabilities="true">/.test(v31) && (v31.match(/<exclude domain="sharedpref" path="secrets\.xml" \/>/g) || []).length === 2);
  const { readdirSync, existsSync } = await import('node:fs');
  const dirs = readdirSync(join(root, 'android/res')).filter((d) => existsSync(join(root, 'android/res', d, 'backup_rules.xml')));
  check('no other copy of the rules applies to Android 8', dirs.sort().join() === 'xml,xml-v28', dirs);
  const MS = read(`${JAVA}ModelStore.java`);
  check('model files live in no-backup storage', /new File\(context\.getNoBackupFilesDir\(\), DIR\)/.test(MS));
}

section('The manifest');
{
  const M = read('android/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
  const app = (M.match(/<application\b[^>]*>/) || [''])[0];
  check('the application: backups by the rules above, no plain http, not debuggable', /android:allowBackup="true"/.test(app) && /android:fullBackupContent="@xml\/backup_rules"/.test(app) && /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(app) && /android:usesCleartextTraffic="false"/.test(app) && !/android:debuggable="true"/.test(M), app);
  const tags = [...M.matchAll(/<(activity|activity-alias|service|receiver|provider)\b[^>]*>/g)].map((m) => ({ kind: m[1], tag: m[0], name: (/android:name="([^"]+)"/.exec(m[0]) || [])[1] }));
  const open = tags.filter((t) => /android:exported="true"/.test(t.tag) && !/android:permission="/.test(t.tag) && t.name !== '.MainActivity');
  check('every exported component but the launcher activity needs a permission (and no provider is exported)', open.length === 0 && tags.filter((t) => t.kind === 'provider').every((t) => /android:exported="false"/.test(t.tag)), open.map((t) => t.name));
}

section('CI: only main is signed with the release key and published');
{
  const yml = read('.github/workflows/android.yml').replace(/^\s*#.*\n/gm, '');
  const jobs = {};
  const parts = yml.slice(yml.indexOf('\njobs:')).split(/\n {2}([\w-]+):\n/);
  for (let i = 1; i < parts.length; i += 2) jobs[parts[i]] = `\n${parts[i + 1]}`;
  check('read-only by default', /\npermissions:\n {2}contents: read\n/.test(yml));
  check('the build job never sees a release secret, writes nothing and publishes nothing', jobs.build && !/RELEASE_|contents: write|gh release/.test(jobs.build) && /upload-artifact/.test(jobs.build));
  check('the release job runs on main only, after the build, in the release environment', jobs.release && /\n {4}needs: build\n/.test(jobs.release) && /\n {4}if: github\.ref == 'refs\/heads\/main'/.test(jobs.release) && /\n {4}environment: release\n/.test(jobs.release) && /\n {6}contents: write\n/.test(jobs.release));
  check('and refuses to publish without the release key', jobs.release && /if \[ -z "\$RELEASE_KEYSTORE_B64" \]; then[\s\S]*?exit 1/.test(jobs.release));
  check('no other job or workflow can write to the repository', Object.entries(jobs).every(([k, v]) => k === 'release' || !/contents: write/.test(v)) && !/contents: write/.test(read('.github/workflows/model-check.yml')));
  const unpinned = [...new Set([...yml.matchAll(/uses: ([\w./-]+@[\w.-]+)/g)].map((m) => m[1]).filter((u) => !/@[0-9a-f]{40}$/.test(u)))];
  if (unpinned.length) console.log(`  ! warning: actions not pinned to a commit SHA in android.yml: ${unpinned.join(', ')}`);
}

section('Model files are pinned: a repo commit, an exact size and a SHA-256');
{
  // src/llm.js as the app loads it, with wllama stubbed out (only the catalog is needed here).
  const esbuild = (await import('esbuild')).default;
  const stub = { name: 'no-wllama', setup(b) { b.onResolve({ filter: /^@wllama\// }, (a) => ({ path: a.path, namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class Wllama {}\nexport class WllamaAbortError extends Error {}\nexport const LogLevel = {};', loader: 'js' })); } };
  const built = await esbuild.build({ entryPoints: [join(root, 'src/llm.js')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent', plugins: [stub] });
  new Function(built.outputFiles[0].text)();
  const MODELS = GH.llm.MODELS;
  const current = MODELS.filter((m) => !m.legacy);
  const COMMIT_URL = /^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/([0-9a-f]{40})\/([\w.-]+\.gguf)$/;
  const pinnedOk = (m) => COMMIT_URL.test(m.url) && COMMIT_URL.exec(m.url)[2] === m.file && /^[0-9a-f]{64}$/.test(m.sha256) && Number.isSafeInteger(m.bytes) && m.bytes > 0;
  const pinned = current.filter((m) => m.sha256);
  check(`every pin in src/llm.js is a commit URL for its own file, a SHA-256 and an exact size (${pinned.length} of ${current.length} pinned)`, current.length === 3 && pinned.every(pinnedOk), pinned.filter((m) => !pinnedOk(m)).map((m) => m.id));
  const src = read('src/llm.js');
  const table = /const PINS = \{([\s\S]*?)\n\};/.exec(src);
  const entries = table ? [...table[1].matchAll(/^\s*'([^']+)': \{ commit: '([^']*)', sha256: '([^']*)', bytes: (\d+) \},$/gm)] : [];
  const lines = table ? table[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')) : [];
  check('the PINS table holds only well-formed lines for files the catalog has', !!table && entries.length === lines.length && entries.every(([, file, commit, sha]) => current.some((m) => m.file === file) && /^[0-9a-f]{40}$/.test(commit) && /^[0-9a-f]{64}$/.test(sha)), lines.filter((l) => !entries.some((e) => e[0].trim() === l.trim())));
  check('a size that isn\'t pinned yet stays on the main branch without a hash (so the app won\'t download it)', current.filter((m) => !m.sha256).every((m) => /\/resolve\/main\//.test(m.url)));
  check('1.2\'s models keep their SHA-256 (they\'re never downloaded again)', MODELS.filter((m) => m.legacy).every((m) => /^[0-9a-f]{64}$/.test(m.sha256)));
  const waiting = current.filter((m) => !m.sha256).map((m) => `${m.id} (${m.file})`);
  if (waiting.length) console.log(`  ! warning: not pinned yet, so not downloadable: ${waiting.join(', ')}. Run the "pins" job in .github/workflows/model-check.yml and paste its PINS into src/llm.js.`);
  check('a model without a pin fails with a plain reason', /can't download this model/.test(GH.llm.MESSAGES.unpinned));
  // The self-test's report can go to GitHub: engine lines (which can quote a model's output) only
  // from its own run, whose question is a general one.
  check('the self-test\'s log keeps the engine\'s lines from its own run only', /const since = logSeq;/.test(src) && /out\.log = LOG\.filter\(\(e\) => !e\.engine \|\| e\.n > since\)/.test(src) && /log: \(\.\.\.a\) => log\('log', a, true\)/.test(src));

  const MS = read(`${JAVA}ModelStore.java`);
  check('ModelStore turns down a download without a commit URL for its file, a SHA-256 and a size ("unpinned")', /resolve\/\[0-9a-f\]\{40\}\/\(/.test(MS) && /private static boolean pinned\(Job job\)[\s\S]*?job\.file\.equals\(m\.group\(1\)\) && job\.sha256 != null && SHA256\.matcher\(job\.sha256\)\.matches\(\)\s*&& job\.bytes > 0/.test(MS) && /if \(!pinned\(job\)\) \{\s*throw new Failure\("unpinned"/.test(MS));
  const expect = body(MS, 'private static void expect('), verify = body(MS, 'private void verify(');
  check('the Hub\'s headers only ever stop a download early; the file is checked against the pin', /job\.expectedSha = job\.sha256;/.test(expect) && !/expectedSha = [^;]*linkedSha/.test(MS) && !/getHeaderField\("ETag"\)/.test(MS));
  check('the size must be exact, and the SHA-256 is always checked', /length != job\.bytes/.test(verify) && !/closeInSize/.test(MS) && /if \(job\.expectedSha == null\) \{\s*throw new Failure\("unpinned"/.test(verify) && /throw new Failure\("checksum"/.test(verify));
  check('an older install without a hash is hashed once in the background and marked rehashed', /private synchronized void recheck\(\)/.test(MS) && /if \(rechecked\) \{\s*return;/.test(MS) && /put\("sha256", sha\)\.put\("rehashed", true\)/.test(MS) && /\.put\("rehashed", meta\.optBoolean\("rehashed", false\)\)/.test(MS));
}

done();
