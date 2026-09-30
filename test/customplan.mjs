// Custom plans (GH.customPlan): what a plan may hold and how older or foreign ones are read, the
// share code (a round trip, its size in a QR code, a real QR reader on the code), swaps for missing
// equipment and sore or careful joints, a plan in use feeding the calendar, todayPlan, buildSession
// and the Plan tab (with readiness and deload weeks, a switch part-way through a week, deleting and
// editing the plan in use), progression over weeks, and the coach's plan builder with a model's
// answer checked before it's used.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { load, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/engine/pose.js', 'src/brain.js', 'src/planweek.js', 'src/tailor.js', 'src/store.js', 'src/customplan.js', 'src/qr.js');
const B = GH.brain;
const C = GH.customPlan;
const require = createRequire(import.meta.url);

const MON = B.dayFromStr('2026-09-28'); // a Monday
const USER = {
  goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, units: 'lb', weightKg: 68.4,
  equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null },
};
const BASE = { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 };
const fresh = (start = MON, patch = {}) => { const S = B.newState(Object.assign({}, USER, patch), BASE, start); C.ensure(S); return S; };
const clone = (S) => JSON.parse(JSON.stringify(S));
const PPL = {
  name: 'Push Pull Legs',
  days: [
    { title: 'Push', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'chest_press', sets: 3, reps: 12 }, { move: 'tri_oh', sets: 3, reps: 12 }, { move: 'raise', sets: 2, reps: 15 }] },
    { title: 'Pull', items: [{ move: 'row_db', sets: 3, reps: 10 }, { move: 'curl_std', sets: 3, reps: 10 }, { move: 'rear_fly', sets: 2, reps: 15 }] },
    { title: 'Legs', items: [{ move: 'sq_goblet', sets: 3, reps: 12 }, { move: 'hg_rdl', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, secs: 30 }] },
  ],
};
// A workout the way the player runs it: every step, the answer to "how many more?" on each
// exercise's last set, then the check-in. amount(st) can log fewer reps than asked.
function doWorkout(S, day, rir = '12', amount = null) {
  const r = B.startWorkout(S, day, { now: day * B.DAY_MS + 17 * 3600000 });
  if (r.error) throw new Error(`startWorkout ${B.dayStr(day)}: ${r.error}`);
  for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 800; g++) {
    const st = S.active.steps[S.active.idx];
    const a = amount && st.kind === 'set' ? amount(st) : null;
    B.completeStep(S, st.kind === 'test' ? { value: 12 } : a != null ? (st.item.timed ? { secs: a } : { reps: a }) : {});
    if (st.askRir) B.setRir(S, st.item, typeof rir === 'function' ? rir(st) : rir);
  }
  return B.finishWorkout(S, { rating: 'right', now: day * B.DAY_MS + 17 * 3600000 + 30 * 60000 });
}
const light = (S, day) => { B.logLight(S, day, 'walk', true); B.logLight(S, day, 'mobility', true); };
const kinds = (w) => w.days.map((d) => d.kind).join(' ');

/* ------------------------------------------------------------------ what a plan may hold */
section('A plan\'s shape');
{
  const { plan, report } = C.normalize({
    name: '  Leg‮day \u0007 ', note: 'x'.repeat(300), source: 'hacker', weekdays: [4, 0, 2],
    days: [
      { title: 'A', items: [{ move: 'push_std', sets: 99, reps: 0 }, { move: 'no_such_move', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, reps: 3 }, { move: 'sq_bw', sets: 3, reps: 500, rest: 999 }] },
      { title: 'Empty', items: [] },
      { title: 'B', items: Array.from({ length: 20 }, () => ({ move: 'sq_bw', sets: 3, reps: 10 })) },
      { title: 'C', items: [{ move: 'curl_std', sets: 3, reps: 10, rest: 45 }] },
    ],
  });
  check('unknown moves are left out and reported', report.unknown.includes('no_such_move') && plan.days[0].items.every((it) => it.move !== 'no_such_move'), report);
  check('sets 1-10, reps 1-100', plan.days[0].items[0].sets === 10 && plan.days[0].items[0].reps === 1 && plan.days[0].items[2].reps === 100, plan.days[0].items);
  check('a held move takes seconds (5-600), even when given reps', plan.days[0].items[1].secs === 5 && plan.days[0].items[1].reps == null, plan.days[0].items[1]);
  check('rest is clamped to 0-300 s', plan.days[0].items[2].rest === 300 && plan.days[2].items[0].rest === 45);
  check('days without exercises are dropped (and counted)', plan.days.length === 3 && report.droppedDays === 1, plan.days.map((d) => d.title));
  check('a day holds at most 12 exercises', plan.days[1].items.length === 12);
  check('weekdays, one per day, sorted', JSON.stringify(plan.weekdays) === '[0,2,4]', plan.weekdays);
  check('names lose control and direction characters', plan.name === 'Leg day', JSON.stringify(plan.name));
  check('notes are cut to 200 characters', plan.note.length === 200);
  check('an unknown source becomes yours', plan.source === 'you');
  check('the plan is versioned', plan.v === C.VERSION && /^[a-z0-9]+$/.test(plan.id));
  const seven = C.normalize({ days: Array.from({ length: 9 }, () => ({ items: [{ move: 'sq_bw', sets: 3, reps: 10 }] })), weekdays: [0, 0, 1] }).plan;
  check('six days at most; bad weekdays mean spread out', seven.days.length === 6 && seven.weekdays === null);
  const draft = C.normalize({ days: [{ items: [] }] }, { draft: true }).plan;
  check('a plan being built keeps its empty days', draft.days.length === 1 && draft.name === 'My plan');
  check('an empty day is a problem, in words', C.problems(draft)[0] === 'Day 1 has no exercises yet.' && !C.ready(draft));
  check('a full plan is ready', C.ready(C.normalize(PPL).plan) && C.problems(C.normalize(PPL).plan).length === 0);
}

section('Older saves');
{
  const S = fresh();
  delete S.customPlans; delete S.activePlan; delete S.planProg;
  const S2 = GH.store.migrate(clone(S));
  check('a save from before plans reads fine', Array.isArray(S2.customPlans) && S2.activePlan === null && typeof S2.planProg === 'object');
  const S3 = clone(S);
  S3.customPlans = [{ id: 'old1', name: 'Old one', days: [{ items: [{ move: 'push_std', sets: '3', reps: '12' }] }] }, null];
  S3.activePlan = 'gone1';
  GH.store.migrate(S3);
  check('a plan from an earlier format is brought up to date', S3.customPlans.length === 1 && S3.customPlans[0].v === C.VERSION && S3.customPlans[0].days[0].items[0].sets === 3 && S3.customPlans[0].id === 'old1');
  check('a plan in use that\'s gone falls back to the coach\'s plan', S3.activePlan === null);
}

/* ------------------------------------------------------------------ sharing */
section('The share code');
const typical = C.normalize({
  name: 'Push Pull Legs', note: 'Heavy on Monday.',
  days: [
    { title: 'Push', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'incline_db', sets: 3, reps: 10 }, { move: 'ohp_db', sets: 3, reps: 10 }, { move: 'fly_cable', sets: 3, reps: 12 }, { move: 'pushdown_cable', sets: 3, reps: 12 }, { move: 'raise_cable', sets: 3, reps: 15 }] },
    { title: 'Pull', items: [{ move: 'pulldown', sets: 4, reps: 8 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'face_pull', sets: 3, reps: 15 }, { move: 'curl_bb', sets: 3, reps: 10 }, { move: 'curl_incline', sets: 3, reps: 12 }, { move: 'hang_knee', sets: 3, reps: 12 }] },
    { title: 'Legs', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'rdl_bb', sets: 3, reps: 8 }, { move: 'leg_press', sets: 3, reps: 12 }, { move: 'leg_curl', sets: 3, reps: 12 }, { move: 'calf_smith', sets: 3, reps: 15 }, { move: 'side_plank', sets: 2, secs: 40, rest: 30 }] },
  ],
  weekdays: [0, 2, 4],
}).plan;
{
  const data = await C.encode(typical, { from: 'Alex' });
  const link = C.link(data);
  const back = await C.decode(link);
  const same = (a, b) => JSON.stringify(a.days) === JSON.stringify(b.days) && a.name === b.name && a.note === b.note && JSON.stringify(a.weekdays) === JSON.stringify(b.weekdays);
  check('a plan survives the round trip', same(typical, back.plan) && back.plan.from === 'Alex' && back.plan.source === 'shared', back.plan);
  check('the link is the share page with the plan after the #', link.startsWith('https://shadowsdistant.github.io/gradient-health/p/#') && !/[+/=]/.test(data));
  check('it opens from the app link and the Android intent too', (await C.decode(C.appLink(data))).plan.name === 'Push Pull Legs' && (await C.decode(`intent://plan?d=${data}#Intent;scheme=gradienthealth;package=com.shadowsdistant.gradienthealth;end`)).plan.days.length === 3);
  check('and from the bare data', (await C.decode(data)).plan.days[2].items[5].secs === 40);
  const plain = await C.encode(typical, { compress: false });
  check('without compression it still reads (and the compressed one is smaller)', same(typical, (await C.decode(plain)).plan) && data.length < plain.length, `${data.length} vs ${plain.length}`);
  const q = GH.qr.encode(link);
  check(`a typical 3-day, 18-exercise plan fits a QR code a phone reads off a screen (${link.length} characters, version ${q.version}${q.ecl})`, link.length <= 380 && q.version <= 13, `${link.length} chars, v${q.version}`);
  const big = C.normalize({ name: 'x'.repeat(40), note: 'y'.repeat(200), days: Array.from({ length: 6 }, (_, i) => ({ title: `Day ${i}`, items: Object.keys(GH.moves.MOVES).slice(i * 12, i * 12 + 12).map((m) => ({ move: m, sets: 3, reps: 10 })) })) }).plan;
  const bigLink = C.link(await C.encode(big, { from: 'Alexandra' }));
  check(`the biggest plan (6 days × 12, long name and note) still makes a code (version ${GH.qr.encode(bigLink).version})`, GH.qr.encode(bigLink).version <= 30, bigLink.length);
  // The real reader: the QR code the share sheet draws, read back by ZXing (what the app's scanner uses).
  try {
    const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');
    await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) }, fireImmediately: true });
    const scale = 4, pad = 4, n = (q.size + pad * 2) * scale;
    const px = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = q.dark(Math.floor(x / scale) - pad, Math.floor(y / scale) - pad) ? 0 : 255; px.set([v, v, v, 255], (y * n + x) * 4); }
    const res = await readBarcodes({ data: px, width: n, height: n, colorSpace: 'srgb' }, { formats: ['QRCode'] });
    check('a QR reader reads the code back to the same link', res.length === 1 && res[0].text === link, res.map((r) => r.error || r.text));
    const svg = GH.qr.svg(link, { label: 'A QR code for Push Pull Legs' });
    check('the code draws as an SVG with a label', /^<svg[^>]+viewBox="0 0 \d+ \d+"[^>]*role="img" aria-label="A QR code for Push Pull Legs"/.test(svg) && svg.includes('<path d="M'));
  } catch (e) { check('a QR reader reads the code back (zxing-wasm)', false, e.message); }
  let err = null;
  try { await C.decode(`https://shadowsdistant.github.io/gradient-health/p/#${String.fromCharCode(65 + 1)}` + data.slice(1)); } catch (e) { err = e; }
  check('a code from a newer version asks for an update', err && err.code === 'newer', err && err.message);
  err = null;
  try { await C.decode('https://shadowsdistant.github.io/gradient-health/p/#AQnotaplanatall_x'); } catch (e) { err = e; }
  check('a broken code says so', err && err.code === 'broken');
  check('other links aren\'t plans', !C.isLink('https://example.com/p/') && !C.isLink('hello') && C.isLink(link) && C.isLink(C.appLink(data)));
  // A move this version doesn't know is left out and reported, and the rest still reads.
  const json = new TextEncoder().encode(JSON.stringify(['Future', '', '', 0, [['A', ['push_std', 3, 10], ['levitate_2030', 3, 10]]]]));
  const bytes = new Uint8Array(json.length + 1); bytes[0] = 1; bytes.set(json, 1);
  const fut = await C.decode(Buffer.from(bytes).toString('base64url'));
  check('a move from a newer version is left out and reported', fut.plan.days[0].items.length === 1 && fut.report.unknown[0] === 'levitate_2030');
  const S = fresh();
  const s1 = C.save(S, (await C.decode(link)).plan);
  const s2 = C.save(S, (await C.decode(link)).plan);
  check('saving the same plan twice keeps one copy', !s1.existed && s2.existed && s2.plan.id === s1.plan.id && C.list(S).length === 1 && s1.plan.from === 'Alex');
}

/* ------------------------------------------------------------------ swaps */
section('Moves you can\'t do today');
{
  const S = fresh();
  const day = MON + 2;
  const ctx = C.context(S, day);
  const bench = C.choose(ctx, 'bench_bb');
  check('a barbell bench press at home with dumbbells becomes the floor press', bench.id === 'chest_press' && C.whyText(bench.why) === 'needs a barbell, a bench and a squat rack', bench);
  const S0 = fresh(MON, { equipment: { db: [], kb: [], chair: true, wall: true, towel: true } });
  const b0 = C.choose(C.context(S0, day), 'bench_bb');
  check('with no weights it\'s a push-up at your level', GH.moves.MOVES[b0.id].family === 'push' && b0.id === S0.prog.push.rung, b0);
  const pd = C.choose(ctx, 'pushdown_cable');
  check('a cable move becomes a similar move for the same muscle', GH.moves.MOVES[pd.id].group === 'triceps' && pd.why.why === 'equipment', pd);
  S.pain.knee = day + 14;
  const sq = C.choose(C.context(S, day), 'sq_goblet');
  check('a sore knee swaps squats for a leg move that spares it', sq.id && !(GH.moves.MOVES[sq.id].joints || []).includes('knee') && GH.moves.MOVES[sq.id].group === 'legs' && C.whyText(sq.why) === 'easy on your knees for now', sq);
  delete S.pain.knee;
  const S2 = fresh(MON, { careful: ['knee'] });
  const j = C.choose(C.context(S2, day), 'sq_jump');
  check('careful knees: jump squats swap out', j.id !== 'sq_jump' && C.whyText(j.why) === 'careful with your knees', j);
  const S3 = fresh(MON, { age: 66 });
  const j3 = C.choose(C.context(S3, day), 'sq_jump');
  check('no jumping at 66: jump squats swap out', j3.id !== 'sq_jump' && C.whyText(j3.why) === 'no jumping in your plan', j3);
  S.excluded.push('curl_std');
  const c = C.choose(C.context(S, day), 'curl_std');
  check('a move you hid is swapped', c.id !== 'curl_std' && c.why.why === 'hidden' && GH.moves.MOVES[c.id].group === 'biceps');
  const S4 = fresh(MON, { equipment: { db: [], kb: [], chair: false, wall: false, towel: false } });
  const none = C.choose(C.context(S4, day), 'row_cable');
  check('nothing similar: left out, with the reason', none.id === null || GH.moves.MOVES[none.id].group === 'back', none);
  const sw = C.swapsFor(S, typical, day);
  check('a shared gym plan at home: every swap is a move you can do, with a reason', sw.length >= 10 && sw.every((x) => !x.to || C.check(C.context(S, day), x.to).ok) && sw.every((x) => x.why), sw.length);
}

/* ------------------------------------------------------------------ a plan in use */
section('A plan in use');
{
  const S = fresh(MON - 7);
  for (let d = MON - 7; d < MON; d++) { const p = B.todayPlan(S, d); if (p.type === 'workout') doWorkout(S, d); else light(S, d); }
  const plan = C.add(S, PPL).plan;
  const r = C.use(S, plan.id, MON);
  check('using a plan starts today', r && r.from === MON && S.activePlan === plan.id && S.events.filter((e) => e.type === 'plan').length === 1);
  const cal = B.calendar(S, MON);
  const tp = B.todayPlan(S, MON, cal);
  check('today is the plan\'s first day', tp.type === 'workout' && tp.tpl === `c:${plan.id}:0`, tp);
  const s = B.buildSession(S, MON, tp.tpl, { cal, noReadiness: true });
  // The second week is still easing in (70% of the sets), as it is on the coach's plan.
  const mult = cal.weeks[B.weekStart(MON)].phase.mult;
  const setsFor = (i, minus = 0) => Math.max(1, Math.round(PPL.days[0].items[i].sets * mult) - minus);
  check('the session holds its exercises, sets and reps (sets eased in like the coach\'s)', mult === 0.7 && s.title === 'Push' && s.items.map((it) => it.moveId).join() === 'push_std,chest_press,tri_oh,raise' && s.items.every((it, i) => it.sets === setsFor(i) && it.target === PPL.days[0].items[i].reps), s.items.map((it) => `${it.moveId} ${it.sets}x${it.target}`));
  const asWritten = B.buildSession(S, MON, tp.tpl, { cal, noReadiness: true, forceMult: 1 });
  check('a full week asks for the sets as written', asWritten.items.every((it, i) => it.sets === PPL.days[0].items[i].sets));
  check('with the warm-up, rest, weights and time', s.warmup.length >= 2 && s.items.every((it) => it.rest >= 60) && s.items[1].load && s.items[1].load.key === 'db' && s.estimateMin > 10 && s.custom.name === 'Push Pull Legs');
  const w = GH.planWeek(S, MON);
  check('the Plan tab shows the plan\'s days, spread over the week', kinds(w) === 'today light workout light workout light light' && w.days[0].title === 'Push' && w.days[2].title === 'Pull' && w.days[4].title === 'Legs', kinds(w));
  check('and next week\'s', w.next.days.filter((d) => d.kind === 'workout').map((d) => d.title).join() === 'Push,Pull,Legs');
  // Readiness: a short night takes a set off each exercise, never below one.
  S.sleepChip[MON] = '<5';
  const tired = B.buildSession(S, MON, tp.tpl, { cal: B.calendar(S, MON) });
  check('a short night takes a set off each exercise', tired.items.every((it, i) => it.sets === Math.max(1, setsFor(i) - 1)) && tired.readiness.badSleep, tired.items.map((it) => it.sets));
  delete S.sleepChip[MON];
  const sets = B.weeklySets(S, MON);
  check('this week\'s sets by muscle count the plan', sets.chest.planned === setsFor(0) + setsFor(1) && sets.back.planned >= 3, sets);
  // Weekdays of your own.
  C.update(S, plan.id, (p) => { p.weekdays = [1, 3, 5]; }, MON);
  const w2 = GH.planWeek(S, MON);
  check('set days put each day on its weekday (from today, once the shape changes)', kinds(w2) === 'light workout light workout light workout light' && w2.days[1].title === 'Push' && w2.days[5].title === 'Legs', kinds(w2));
  check('a changed shape is a new switch from today', S.events.filter((e) => e.type === 'plan').length === 1 && S.events.find((e) => e.type === 'plan').wd.join() === '1,3,5');
  // The player runs it and the log says so.
  C.update(S, plan.id, (p) => { p.weekdays = null; }, MON);
  const res = doWorkout(S, MON, '3');
  const log = S.log.find((l) => l.type === 'workout' && l.day === MON);
  check('a workout from the plan saves like any other', res.done && log.title === 'Push' && log.items.length === 4 && log.items.every((it, i) => new Set(it.sets.map((x) => x.set)).size === setsFor(i)), log.items.map((it) => it.sets.length));
  check('and counts for the streak', B.calendar(S, MON).streak.current >= 1);
  check('each exercise moves on from your numbers', S.planProg[plan.id]['push_std:10'].reps === 12 && res.lines.some((l) => l.text === 'Push-up → 12 reps'), res.lines);
  // Back to the coach's plan: switching again now waits for tomorrow (today's workout is done).
  const back = C.use(S, null, MON);
  check('back to the coach\'s plan after today\'s workout starts tomorrow', back.from === MON + 1 && S.activePlan === null);
  const w3 = GH.planWeek(S, MON);
  check('today stays done, and the coach\'s plan takes the rest of the week', w3.days[0].kind === 'done' && w3.days.slice(1).some((d) => d.kind === 'workout' && d.tpl != null && typeof d.tpl === 'number'), kinds(w3));
}

section('Switching part-way through a week');
{
  const S = fresh(MON - 7);
  for (let d = MON - 7; d < MON; d++) { const p = B.todayPlan(S, d); if (p.type === 'workout') doWorkout(S, d); else light(S, d); }
  // Monday and Tuesday's workouts are missed; the plan starts on Wednesday.
  const wed = MON + 2;
  const before = B.calendar(S, wed);
  const plan = C.add(S, PPL).plan;
  C.use(S, plan.id, wed);
  const after = B.calendar(S, wed);
  const missed = (c) => [MON, MON + 1].map((d) => `${!!(c.days[d] || {}).missed}${!!(c.days[d] || {}).frozen}`).join();
  check('days before the switch keep their meaning (missed stays missed)', missed(before) === missed(after), `${missed(before)} vs ${missed(after)}`);
  check('the streak is the same', before.streak.current === after.streak.current);
  const tp = B.todayPlan(S, wed, after);
  check('a spread plan switched on mid-week starts at its first day, today', tp.type === 'workout' && tp.tpl === `c:${plan.id}:0`, tp);
  const wk = after.weeks[B.weekStart(wed)];
  check('the coach\'s missed sessions don\'t spill into the new plan\'s days', wk.sessions.filter((x) => !x.dropped && x.day >= wed).every((x) => typeof x.tpl === 'string'), wk.sessions.map((x) => [x.day && B.dayStr(x.day), x.tpl, x.dropped]));
  // Missing a custom day moves only the custom days, up to Sunday.
  const thu = MON + 3;
  const later = B.calendar(S, thu);
  const lw = later.weeks[B.weekStart(thu)];
  check('a missed day in your plan moves the rest of your plan a day', lw.sessions.some((x) => x.tpl === `c:${plan.id}:0` && x.missed && x.day === thu) && lw.sessions.some((x) => x.tpl === `c:${plan.id}:1` && x.day === MON + 5), lw.sessions.map((x) => [x.day && B.dayStr(x.day), x.tpl, x.missed]));
  // Set weekdays: the days that are left, on their own weekdays.
  const S2 = fresh(MON - 7);
  const p2 = C.add(S2, Object.assign({}, PPL, { weekdays: [0, 3, 5] })).plan;
  C.use(S2, p2.id, MON + 2);
  const w = GH.planWeek(S2, MON + 2);
  check('with set days, the rest of the week follows them', w.days[3].title === 'Pull' && w.days[5].title === 'Legs' && w.days[3].kind === 'workout', kinds(w));
  // Deleting the plan in use goes back to the coach's plan; history stays.
  const S3 = fresh(MON - 7);
  const p3 = C.add(S3, PPL).plan;
  C.use(S3, p3.id, MON - 7);
  doWorkout(S3, MON - 7);
  const hist = B.calendar(S3, MON).days[MON - 7];
  const tok = C.remove(S3, p3.id, MON);
  check('deleting the plan in use goes back to the coach\'s plan', S3.activePlan === null && B.todayPlan(S3, MON).tpl != null && typeof B.todayPlan(S3, MON).tpl === 'number');
  check('a plan that ran stays for history, hidden', C.list(S3).length === 0 && C.get(S3, p3.id).deleted && JSON.stringify(B.calendar(S3, MON).days[MON - 7]) === JSON.stringify(hist));
  C.restore(S3, tok, MON);
  check('Undo brings it back, in use again', C.list(S3).length === 1 && S3.activePlan === p3.id && !C.get(S3, p3.id).deleted);
}

section('Lighter weeks');
{
  const S = fresh(MON - 35);
  const plan = C.add(S, PPL).plan;
  C.use(S, plan.id, MON - 35);
  for (let d = MON - 35; d < MON; d++) { const p = B.todayPlan(S, d); if (p.type === 'workout') doWorkout(S, d); else light(S, d); }
  const cal = B.calendar(S, MON);
  const ws = Object.keys(cal.weeks).map(Number).find((x) => cal.weeks[x].phase.deload);
  const s = ws != null ? B.buildSession(S, ws, `c:${plan.id}:0`, { cal, noReadiness: true }) : null;
  check('the fifth week is a deload for your plan too (sets × 0.6)', ws === MON - 7 && s.items.every((it, i) => it.sets === Math.max(1, Math.round(PPL.days[0].items[i].sets * 0.6))), `${ws} ${s && s.items.map((it) => it.sets)}`);
  const full = B.buildSession(S, MON, `c:${plan.id}:0`, { cal, noReadiness: true });
  check('and the week after is back to the sets as written', !cal.weeks[B.weekStart(MON)].phase.deload && full.items.every((it, i) => it.sets === PPL.days[0].items[i].sets));
  const short = B.buildSession(S, MON + 7, `c:${plan.id}:0`, { cal: B.calendar(S, MON + 7), noReadiness: true, short: true });
  check('short on time: two sets at most, about 15 minutes', short.items.every((it) => it.sets <= 2) && short.estimateMin <= 16 && short.short, short.estimateMin);
}

/* ------------------------------------------------------------------ progression */
section('Progress over the weeks');
{
  const S = fresh(MON);
  const plan = C.add(S, PPL).plan;
  C.use(S, plan.id, MON);
  const rungs = JSON.stringify(Object.fromEntries(Object.entries(S.prog).map(([f, st]) => [f, [st.rung, st.reps]])));
  const reps = [];
  for (let d = MON; d < MON + 28; d++) {
    const p = B.todayPlan(S, d);
    if (p.type !== 'workout') { light(S, d); continue; }
    const res = doWorkout(S, d, '3');
    if (p.tpl === `c:${plan.id}:0`) reps.push(S.planProg[plan.id]['push_std:10'].reps);
  }
  check('3+ left every time: push-ups climb 2 reps a session (not in the deload week)', reps.slice(0, 3).join() === '12,14,16' && reps[reps.length - 1] >= 16, reps.join());
  const book = S.planProg[plan.id];
  check('the dumbbell moves go up a weight at the top of the range', book['chest_press:12'].w === 1 && book['chest_press:12'].reps <= 16, book['chest_press:12']);
  check('held moves add seconds', book['side_plank:30'].reps > 30, book['side_plank:30']);
  check('the coach\'s own levels don\'t move', JSON.stringify(Object.fromEntries(Object.entries(S.prog).map(([f, st]) => [f, [st.rung, st.reps]]))) === rungs);
  const s = B.buildSession(S, MON + 28, `c:${plan.id}:0`, { cal: B.calendar(S, MON + 28), noReadiness: true });
  check('the next session asks for the new targets and weight', s.items[0].target === book['push_std:10'].reps && s.items[1].load.value === 15, s.items.map((it) => `${it.moveId} ${it.target} ${it.load && it.load.label}`));
  // Well short twice: back to what you got, then a lighter weight.
  const S2 = fresh(MON);
  const p2 = C.add(S2, { name: 'Curls', days: [{ items: [{ move: 'curl_std', sets: 3, reps: 12 }, { move: 'push_std', sets: 3, reps: 10 }] }] }).plan;
  C.update(S2, p2.id, (p) => { p.weekdays = [0]; }, MON);
  C.use(S2, p2.id, MON);
  S2.planProg[p2.id] = { 'curl_std:12': { reps: 12, short: 0, w: 1 } };
  doWorkout(S2, MON, '0', () => 7);
  check('short once: hold', S2.planProg[p2.id]['curl_std:12'].w === 1 && S2.planProg[p2.id]['curl_std:12'].short === 1);
  const r2 = doWorkout(S2, MON + 7, '0', () => 7);
  check('short twice: a lighter weight', S2.planProg[p2.id]['curl_std:12'].w === 0 && r2.lines.some((l) => /Dumbbell curl → 10 lb/.test(l.text)), r2.lines);
  check('a bodyweight move short twice comes down to what you got', S2.planProg[p2.id]['push_std:10'].reps === 7, S2.planProg[p2.id]['push_std:10']);
  // At a gym: reps, then the weight, as the brain does.
  const G1 = fresh(MON, { where: 'gym', gym: B.gymPreset('full', 'lb') });
  const pg = C.add(G1, { name: 'Bench', days: [{ items: [{ move: 'bench_bb', sets: 3, reps: 8 }] }], weekdays: [0] }).plan;
  C.use(G1, pg.id, MON);
  const loads = [];
  for (let k = 0; k < 4; k++) { const d = MON + 7 * k; doWorkout(G1, d, '12'); const st = G1.planProg[pg.id]['bench_bb:8']; loads.push(`${st.reps}@${Math.round(B.toUnit(st.kg, 'lb'))}`); }
  check('gym lifts: a rep at a time up to the top, then heavier and back to your reps', loads.join() === '9@75,10@75,8@80,9@80' || /^9@\d+,10@\d+,8@\d+,9@\d+$/.test(loads.join()), loads.join());
  check('and the weight you use is remembered for the coach\'s plan too', G1.prog.pressG && G1.prog.pressG.loads.bench_bb > 0 && G1.prog.pressG.e1rm.bench_bb.hist.length === 4);
  // A swap in the player: the move done keeps its own numbers.
  const S5 = fresh(MON);
  const p5 = C.add(S5, { name: 'One', days: [{ items: [{ move: 'push_std', sets: 2, reps: 10 }] }], weekdays: [0] }).plan;
  C.use(S5, p5.id, MON);
  B.startWorkout(S5, MON, { now: MON * B.DAY_MS });
  B.swapItem(S5, S5.active.session.items[0], 'push_knee');
  while (S5.active && S5.active.idx < S5.active.steps.length) { const st = S5.active.steps[S5.active.idx]; B.completeStep(S5, {}); if (st.askRir) B.setRir(S5, st.item, '3'); }
  B.finishWorkout(S5, { rating: 'right' });
  check('a swap in the player progresses the move you did', !!S5.planProg[p5.id]['push_knee:10'] && !S5.planProg[p5.id]['push_std:10'], Object.keys(S5.planProg[p5.id]));
}

/* ------------------------------------------------------------------ the coach builds one */
section('Build me a plan');
{
  const S = fresh(MON - 14);
  const day = MON;
  const w = C.wishes(S, '3 days, 30 minutes, I want bigger arms, bad knees');
  check('the request is read: days, minutes, focus, joints', w.days === 3 && w.minutes === 30 && w.focus.includes('biceps') && w.careful.includes('knee'), w);
  const plan = C.generate(S, day, w);
  const ctx = C.context(Object.assign(clone(S), { profile: Object.assign({}, S.profile, { careful: ['knee'] }) }), day);
  check('the coach\'s plan has the days asked for', plan.days.length === 3 && plan.source === 'coach' && C.ready(plan), plan.days.length);
  check('every move is one you can do (knees included)', plan.days.every((d) => d.items.every((it) => C.check(ctx, it.move).ok)));
  check('arms come first in the plan', ['biceps', 'triceps'].includes(GH.moves.MOVES[plan.days[0].items[0].move].group), plan.days[0].items[0]);
  check('each day fits about 30 minutes', plan.days.every((d, i) => C.minutes(S, plan, i, day) <= 36), plan.days.map((d, i) => C.minutes(S, plan, i, day)));
  check('a name and a note in plain words', /bigger arms/.test(plan.name) && /30 minutes/.test(plan.note) && /knees/.test(plan.note), `${plan.name} | ${plan.note}`);
  const ppl = C.generate(S, day, C.wishes(S, 'push pull legs, 3 days'));
  check('push, pull, legs: each day its own muscles', ppl.days.map((d) => d.title).join() === 'Push,Pull,Legs' && ppl.days[1].items.every((it) => ['back', 'biceps'].includes(GH.moves.MOVES[it.move].group)), ppl.days.map((d) => `${d.title}: ${d.items.map((x) => x.move)}`));
  const bw = C.generate(S, day, C.wishes(S, 'full body, 2 days, no equipment'));
  check('no equipment: bodyweight moves only', bw.days.length === 2 && bw.days.every((d) => d.items.every((it) => !GH.moves.MOVES[it.move].load || GH.moves.MOVES[it.move].load === 'band')), bw.days.map((d) => d.items.map((x) => x.move)));
  const one = C.generate(S, day, C.wishes(S, 'one day a week'));
  check('one day: a full-body day', one.days.length === 1 && new Set(one.days[0].items.map((it) => GH.moves.MOVES[it.move].group)).size >= 4, one.days[0].items.map((x) => x.move));
  const ids = C.allowedMoves(S, day, w, plan);
  check('a model only gets moves this person can do', ids.length >= 20 && ids.every((id) => C.check(ctx, id).ok) && !ids.includes('sq_jump'), ids.length);
  const gram = C.planGrammar(ids, 3);
  check('the grammar allows exactly those moves and three days', ids.every((id) => gram.includes(`"\\"${id}\\""`)) && !gram.includes('bench_bb') && /\[" day "," day "," day "\]\}"/.test(gram));
  const schema = C.planSchema(ids);
  check('Claude\'s schema holds moves to the same list', JSON.stringify(schema.properties.days.items.properties.items.items.properties.move.enum) === JSON.stringify(ids));
  const good = { name: 'Arms first', note: 'More arm work, easy on your knees.', days: plan.days.map((d) => ({ title: d.title, items: d.items.map((it) => ({ move: it.move, sets: 4, reps: 12 })) })) };
  const ok = C.accept(S, day, w, plan, good, ids);
  check('a good answer is kept', ok && ok.name === 'Arms first' && ok.days[0].items[0].sets === 4 && ok.source === 'coach');
  const bad1 = JSON.parse(JSON.stringify(good)); bad1.days[0].items[0].move = 'sq_jump';
  const bad2 = JSON.parse(JSON.stringify(good)); bad2.days.pop();
  const bad3 = JSON.parse(JSON.stringify(good)); bad3.days[1].items[0].move = 'bench_bb';
  check('an answer with a move they can\'t do is dropped', C.accept(S, day, w, plan, bad1, ids) === null && C.accept(S, day, w, plan, bad3, ids) === null);
  check('so is one with the wrong number of days, or no answer', C.accept(S, day, w, plan, bad2, ids) === null && C.accept(S, day, w, plan, null, ids) === null);
  check('a cut-off answer is read when it can be', C.readJson('{"name":"A","note":"B","days":[{"title":"X","items":[{"move":"push_std","sets":3,"reps":10}]}]').days.length === 1);
  const draft = C.fromCoach(S, day);
  const set = B.settingsAt(S, day);
  check('Start from my current plan: the coach\'s week as it stands', draft.days.length === set.days && draft.days.every((d) => d.items.length >= 3) && draft.name === 'My plan', draft.days.map((d) => d.items.length));
  const knows = C.knows(S);
  check('what the coach uses, in words', knows.some(([k]) => k === 'Goals') && knows.some(([k, v]) => k === 'Equipment' && /dumbbells/.test(v)));
}

done();
