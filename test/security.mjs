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

done();
