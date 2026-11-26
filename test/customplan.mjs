// Custom plans (GH.customPlan): what a plan may hold and how older or foreign ones are read, the
// share code (a round trip, its size in a QR code, a real QR reader on the code), the plan code (its
// frozen move numbers, round trips for every move and a few hundred made-up plans, every typo caught,
// forgiving reads, a code or a link through decode(), and scripts/plan-code.mjs), swaps for missing
// equipment and sore or careful joints, a plan in use feeding the calendar, todayPlan, buildSession
// and the Plan tab (with readiness and deload weeks, a switch part-way through a week, deleting and
// editing the plan in use), progression over weeks, the coach's plan builder with a model's answer
// checked before it's used, and what the picker and New plan stand on: each move's kit and muscles,
// forgiving search, a new exercise's sets and reps, this week by muscle, suggestions and the moves
// most like one, and the ready-made plans (Full body, Upper and lower, Push, pull, legs, No
// equipment) built for this person's days, minutes and kit.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, root, check, section, done } from './lib.mjs';

const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/planweek.js', 'src/tailor.js', 'src/store.js', 'src/coach.js', 'src/customplan.js', 'src/qr.js');
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

/* ------------------------------------------------------------------ the plan code */
// What a code has to bring back: the name, the weekdays, each day's title as it shows, its exercises.
const held = (p) => JSON.stringify([p.name, p.weekdays, p.days.map((d, i) => [C.titleOf(p, i), d.items])]);
const symbols = (code) => code.replace(/-/g, '');
const caught = (text) => { try { C.fromCode(text); return null; } catch (e) { return e.code || `threw ${e.message}`; } };
const SHAPE = /^GH[0-9A-HJKMNP-TV-Z]{2}(-[0-9A-HJKMNP-TV-Z]{4})+$/;
// The same few hundred plans every run.
const seeded = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// n made-up plans, the same every run, the limits among them: 6 days, 12 exercises, 10 sets, 100
// reps, 600 s, rests, set days, long names, and names in other alphabets.
function madeUp(n, seed) {
  const MOVES = GH.moves.MOVES, ids = Object.keys(MOVES);
  const rnd = seeded(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WORDS = ['Push', 'pull', 'Legs', 'day', 'A', '2', 'upper', 'Body', '&', 'arms', '(heavy)', 'Über', 'ноги', '背中', '💪', 'no. 3', 'core'];
  const text = (max) => { let s = ''; for (let k = int(1, 6); k > 0; k--) { const w = pick(WORDS); if ((s ? s.length + 1 : 0) + w.length <= max) s = s ? `${s} ${w}` : w; } return s; };
  return Array.from({ length: n }, (_, k) => {
    const nd = k % 7 === 0 ? 6 : int(1, 6);
    const days = Array.from({ length: nd }, () => ({
      title: rnd() < 0.5 ? '' : text(30),
      items: Array.from({ length: k % 5 === 0 ? 12 : int(1, 12) }, () => {
        const id = pick(ids), m = MOVES[id];
        const it = { move: id, sets: pick([1, 2, 3, 3, 3, 4, 4, 5, 6, 8, 10]) };
        if (m.timed) it.secs = pick([5, 10, 20, 30, 30, 45, 60, 90, 160, 165, 600, int(5, 600)]);
        else it.reps = pick([1, 5, 6, 8, 10, 12, 15, 20, 32, 33, 100, int(1, 100)]);
        if (rnd() < 0.3) it.rest = pick([0, 15, 20, 45, 60, 90, 300, int(0, 300)]);
        return it;
      }),
    }));
    const weekdays = rnd() < 0.4 ? [0, 1, 2, 3, 4, 5, 6].sort(() => rnd() - 0.5).slice(0, nd) : null;
    return { name: k % 9 === 0 ? 'N'.repeat(40) : rnd() < 0.25 ? '' : text(40), days, weekdays };
  });
}
// A plan whose text was written down when format 1 shipped: if either stops matching, codes people
// already have would read differently.
const PINNED = {
  name: 'Café legs', weekdays: [1, 3, 6], days: [
    { title: 'A & B', items: [{ move: 'curl_towel', sets: 1, secs: 600, rest: 0 }, { move: 'leg_press_power', sets: 10, reps: 100, rest: 300 }, { move: 'push_std', sets: 5, reps: 33 }] },
    { title: '', items: [{ move: 'walk', sets: 2, secs: 95, rest: 25 }, { move: 'sq_bw', sets: 4, reps: 7 }] },
    { title: 'Day 3', items: [{ move: 'side_plank', sets: 3, secs: 45 }] },
  ],
};
const PINNED_CODE = 'GH1A-MWA8-DGPD-GX94-1P6A-SVKJ-GR3B-HVM4-067J-QGJF-XMYR-AWY2-02A4-X5Y3-47X3-08C6-1HNR-6G8S-0000-JD70';
const PPL_CODE = 'GH19-3KX4-HZBX-2TZA-S1MG-W4FM-J71A-31M4-0M46-MN51-3X2T-S40R-1GSD-5988-P8D4-4085-R6G9-E000-DXVN';

section('The plan code: its move numbers');
{
  const ids = Object.keys(GH.moves.MOVES), T = GH.PLAN_CODE_MOVES;
  const none = ids.filter((id) => !T.includes(id)), twice = T.filter((id, i) => T.indexOf(id) !== i);
  check(`every move has a number, and no id is there twice (${ids.length} moves, ${T.length} numbers)`, none.length === 0 && twice.length === 0, `add at the END of src/data/plancode-moves.js: ${none.join(' ')}${twice.length ? `; there twice: ${twice.join(' ')}` : ''}`);
  const hash = createHash('sha256').update(T.slice(0, 296).join(' ')).digest('hex');
  check('the 296 numbers 1.15 shipped with are as they were, in their order', hash === '2dcbe672a7841c375b9a026799951fc9bb389dd4fbe947b1a9fe9bf08df25f07', `${hash}: a move was reordered, renamed or taken out of src/data/plancode-moves.js. New ones go at the end; nothing else changes.`);
  check('there\'s room for more than 500 moves', T.length < 1023 && T[0] === 'curl_towel' && T[295] === 'leg_press_power');
  // Numbers from 511 take 9 more bits: a made-up move at 900 goes into a code and comes back.
  GH.moves.MOVES.far_move = Object.assign({}, GH.moves.MOVES.push_std, { id: 'far_move', name: 'Far move' });
  GH.PLAN_CODE_MOVES = T.concat(Array.from({ length: 900 - T.length }, (_, i) => `~${i}`), ['far_move']);
  const far = C.normalize({ days: [{ items: [{ move: 'far_move', sets: 3, reps: 10 }, { move: 'push_std', sets: 3, reps: 10 }, { move: '~3', sets: 3, reps: 10 }] }] }).plan;
  const farCode = C.toCode(far);
  check('a move numbered 900 goes into a code and comes back', C.fromCode(farCode).plan.days[0].items.map((it) => it.move).join() === 'far_move,push_std', farCode);
  // The same code in an app that doesn't have that move yet.
  delete GH.moves.MOVES.far_move;
  GH.PLAN_CODE_MOVES = T;
  const older = C.fromCode(farCode);
  check('a move from a newer version is left out and reported, and the rest still reads', older.plan.days[0].items.length === 1 && older.plan.days[0].items[0].move === 'push_std' && older.report.unknown.join() === '#900', older);
  GH.moves.MOVES.far_move = Object.assign({}, GH.moves.MOVES.push_std, { id: 'far_move', name: 'Far move' });
  GH.PLAN_CODE_MOVES = T.concat(['far_move']);
  const only = C.toCode({ days: [{ items: [{ move: 'far_move', sets: 3, reps: 10 }] }] });
  delete GH.moves.MOVES.far_move;
  GH.PLAN_CODE_MOVES = T;
  check('a plan of nothing but newer moves says it\'s from a newer version', caught(only) === 'newer');
}

section('The plan code: round trips');
{
  const MOVES = GH.moves.MOVES, ids = Object.keys(MOVES);
  // Every move, twelve a day and six days a plan, with every number of sets.
  const off = [];
  for (let i = 0; i < ids.length; i += 72) {
    const days = [];
    for (let j = i; j < Math.min(i + 72, ids.length); j += 12) days.push({ items: ids.slice(j, j + 12).map((id, k) => (MOVES[id].timed ? { move: id, sets: 1 + ((j + k) % 10), secs: 5 + 5 * k } : { move: id, sets: 1 + ((j + k) % 10), reps: 1 + k })) });
    const p = C.normalize({ name: 'All of them', days }).plan;
    const back = C.fromCode(C.toCode(p));
    if (held(back.plan) !== held(p) || back.report.unknown.length) off.push(i);
  }
  const alone = ids.filter((id) => {
    const p = C.normalize({ days: [{ items: [Object.assign({ move: id, sets: 3 }, MOVES[id].timed ? { secs: MOVES[id].start } : { reps: MOVES[id].start })] }] }).plan;
    return held(C.fromCode(C.toCode(p)).plan) !== held(p);
  });
  check(`every one of the ${ids.length} moves goes into a code and comes back, in full plans and alone`, off.length === 0 && alone.length === 0, { off, alone });

  // The fixtures, and how long their codes are.
  const tCode = C.toCode(typical), tBack = C.fromCode(tCode);
  const tLink = C.link(await C.encode(typical));
  check(`the typical plan (3 days, 18 exercises, its names, set days, a rest): ${symbols(tCode).length} characters, where its link has ${tLink.length}`, held(tBack.plan) === held(typical) && symbols(tCode).length === 104 && SHAPE.test(tCode), tCode);
  check('a plan from a code is a shared one, without the note or who sent it', tBack.plan.source === 'shared' && tBack.plan.note === '' && tBack.plan.from === undefined && tBack.code === tCode && tBack.report.unknown.length === 0, tBack.plan);
  const ppl = C.normalize(PPL).plan;
  check(`Push Pull Legs (3 days, 10 exercises, its names): ${symbols(PPL_CODE).length} characters, the code written down when the format shipped`, C.toCode(ppl) === PPL_CODE && held(C.fromCode(PPL_CODE).plan) === held(ppl), C.toCode(ppl));
  const pinned = C.normalize(PINNED).plan;
  check('a plan with every kind of number and name still makes, and reads from, the code written down then', C.toCode(pinned) === PINNED_CODE && held(C.fromCode(PINNED_CODE).plan) === held(pinned), C.toCode(pinned));
  const fifteen = C.normalize({ days: typical.days.map((d) => ({ items: d.items.slice(0, 5) })) }).plan;
  const fCode = C.toCode(fifteen);
  check(`3 days, 15 exercises, the app's own names: ${symbols(fCode).length} characters (the aim: about 70 or fewer)`, symbols(fCode).length <= 70 && held(C.fromCode(fCode).plan) === held(fifteen), fCode);
  const eighteen = C.toCode({ days: typical.days.map((d) => ({ items: d.items })), weekdays: typical.weekdays });
  check(`the typical plan with the app's own names: ${symbols(eighteen).length} characters`, symbols(eighteen).length <= 72, eighteen);
  // One workout: a day of a plan as a plan of its own.
  const six = C.dayPlan(C.normalize({ days: [{ items: typical.days[0].items }] }).plan, 0);
  const sCode = C.toCode(six);
  check(`one workout of 6 exercises: ${symbols(sCode).length} characters (the aim: about 30)`, symbols(sCode).length <= 32 && held(C.fromCode(sCode).plan) === held(six) && six.name === 'Chest, shoulders and arms', `${sCode} ${six.name}`);
  const push = C.dayPlan(typical, 0);
  const pCode = C.toCode(push);
  check(`a day shared on its own is named for the day, and its title is in the code once (Push: ${symbols(pCode).length} characters)`, push.name === 'Push' && push.days.length === 1 && C.fromCode(pCode).plan.name === 'Push' && C.fromCode(pCode).plan.days[0].title === 'Push' && symbols(pCode).length <= 36 && C.dayPlan(typical, 9) === null, pCode);
  const mine = C.normalize({ name: 'My plan', days: [{ items: [{ move: 'push_std', sets: 3, reps: 10 }] }] }).plan;
  check('a single workout called "My plan" keeps that name', C.fromCode(C.toCode(mine)).plan.name === 'My plan' && C.fromCode(C.toCode({ days: ppl.days })).plan.name === 'My plan');

  // Names: ordinary ones in 5-bit letters, anything else in UTF-8.
  const names = ['Push Pull Legs', 'my plan', 'PPL', 'Day 1', 'Sam\'s gym split', 'Sam’s plan – week 2', 'Legs & glutes (heavy)', '3x10 @ 60%: easy!?', 'Тренировка', '筋トレ 月曜日', 'Café legs', '💪 Arms', 'تمرين', 'A'.repeat(40), 'É'.repeat(40), '💪'.repeat(20), 'x y '.repeat(10).trim(), 'Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z Z'];
  const badNames = names.filter((n) => {
    const p = C.normalize({ name: n, days: [{ title: n.slice(0, 30), items: [{ move: 'push_std', sets: 3, reps: 10 }] }, { title: '', items: [{ move: 'sq_bw', sets: 3, reps: 10 }] }] }).plan;
    return held(C.fromCode(C.toCode(p)).plan) !== held(p) || p.name !== n;
  });
  check('names in any alphabet come back as written (accents, Cyrillic, Japanese, Arabic, emoji, 40 characters)', badNames.length === 0, badNames);
  const len = (n) => symbols(C.toCode({ name: n, days: mine.days.concat(mine.days) })).length;
  check('an ordinary name takes about a symbol a letter, another script about three bytes a letter', len('Morning strength') - len('My plan') <= 20 && len('Тренировка') - len('My plan') <= 36, [len('My plan'), len('Morning strength'), len('Тренировка')]);

  // A few hundred plans, the limits among them.
  const seen = { days6: 0, items12: 0, sets10: 0, reps100: 0, secs600: 0, rest300: 0, rest0: 0, restOdd: 0, weekdays: 0, utf8: 0, name40: 0, one: 0 };
  const wrong = [];
  for (const [n, raw] of madeUp(400, 20261125).entries()) {
    const p = C.normalize(raw).plan;
    const code = C.toCode(p);
    const back = C.fromCode(code);
    if (held(back.plan) !== held(p) || !SHAPE.test(code) || symbols(code).length % 4 || back.report.unknown.length || C.toCode(back.plan) !== code) wrong.push(n);
    const all = p.days.flatMap((d) => d.items);
    seen.days6 += p.days.length === 6; seen.one += p.days.length === 1; seen.items12 += p.days.some((d) => d.items.length === 12); seen.sets10 += all.some((it) => it.sets === 10);
    seen.reps100 += all.some((it) => it.reps === 100); seen.secs600 += all.some((it) => it.secs === 600); seen.rest300 += all.some((it) => it.rest === 300); seen.rest0 += all.some((it) => it.rest === 0);
    seen.restOdd += all.some((it) => it.rest != null && it.rest % 5 !== 0); seen.weekdays += !!p.weekdays; seen.utf8 += /[^\x20-\x7e]/.test(p.name + p.days.map((d) => d.title).join('')); seen.name40 += p.name.length === 40;
  }
  check('400 made-up plans each come back the same, and make the same code again', wrong.length === 0, wrong.slice(0, 10));
  check('with every limit among them: 6 days, 12 exercises, 10 sets, 100 reps, 600 s, rests from 0 to 300 s, set days, long names and other alphabets', Object.values(seen).every((v) => v > 5), seen);
  check('a plan with nothing in it has no code, and what goes in is what normalize() keeps', (() => { try { C.toCode({ days: [{ items: [] }] }); return false; } catch (e) { return /at least one exercise/.test(e.message); } })() && JSON.stringify(C.fromCode(C.toCode({ days: [{ items: [{ move: 'push_std', sets: 99, reps: 0, rest: 999 }] }] })).plan.days[0].items[0]) === '{"move":"push_std","sets":10,"reps":1,"rest":300}');
}

section('The plan code: typos');
{
  const code = C.toCode(typical);
  const s = symbols(code), A = GH.planCode.ALPHABET;
  const group = (x) => x.replace(/(.{4})(?=.)/g, '$1-');
  // Every other symbol in every place.
  let subs = 0;
  const missed = [];
  for (let i = 0; i < s.length; i++) for (const ch of A) {
    if (ch === s[i]) continue;
    subs++;
    const why = caught(group(s.slice(0, i) + ch + s.slice(i + 1)));
    if (i < 2 ? !why : why !== 'typo') missed.push(`${i}${ch}:${why}`);
  }
  check(`every single wrong character is caught (${subs} of them, each a typo by name)`, missed.length === 0 && subs === s.length * 31, missed.slice(0, 8));
  const edits = { dropped: [], doubled: [], swapped: [] };
  for (let i = 0; i < s.length; i++) {
    if (!caught(group(s.slice(0, i) + s.slice(i + 1)))) edits.dropped.push(i);
    if (!caught(group(s.slice(0, i + 1) + s.slice(i)))) edits.doubled.push(i);
    if (i + 1 < s.length && s[i] !== s[i + 1] && !caught(group(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)))) edits.swapped.push(i);
  }
  check('so is every character dropped, every one doubled and every two neighbours swapped', !edits.dropped.length && !edits.doubled.length && !edits.swapped.length, edits);
  const rnd = seeded(7);
  let two = 0;
  for (let k = 0; k < 3000; k++) {
    const i = 2 + Math.floor(rnd() * (s.length - 2)), j = 2 + Math.floor(rnd() * (s.length - 2));
    const a = A[(A.indexOf(s[i]) + 1 + Math.floor(rnd() * 31)) % 32], b = A[(A.indexOf(s[j]) + 1 + Math.floor(rnd() * 31)) % 32];
    if (i === j) continue;
    const t = s.split(''); t[i] = a; t[j] = b;
    if (caught(group(t.join(''))) !== 'typo') two++;
  }
  check('and two wrong characters anywhere, 3,000 times over', two === 0, two);
  let err = null;
  try { await C.decode(code.replace(/.$/, (c) => (c === 'Z' ? 'Y' : 'Z'))); } catch (e) { err = e; }
  check('a typo says so, in words', err && err.code === 'typo' && err.message === 'That code has a typo. Check it and try again.' && err.symbols === s.length, err && err.message);
  err = null;
  try { await C.decode('my plan is in the other room'); } catch (e) { err = e; }
  check('words with no code in them aren\'t one', err && err.code === 'broken' && /isn't a plan code/.test(err.message) && caught('') === 'broken' && caught(null) === 'broken' && caught('GH') === 'typo', err && err.message);
  // A code from a format this version doesn't know: the frame and the check are the same for good.
  const newer = GH.planCode.seal([2, 7, 31, 0, 12, 5, 9, 30, 1]);
  err = null;
  try { await C.decode(newer); } catch (e) { err = e; }
  check('a code from a newer format says so', SHAPE.test(newer) && err && err.code === 'newer' && err.message === 'It was shared from a newer version of the app.', `${newer} ${err && err.message}`);
  check('and a typo in one is still a typo', caught(newer.replace(/.$/, (c) => (c === 'Z' ? 'Y' : 'Z'))) === 'typo');
  check('format 0 isn\'t a plan', caught(GH.planCode.seal([0, 1, 2, 3, 4, 5, 6])) === 'broken');
}

section('The plan code: reading one is forgiving');
{
  const code = PPL_CODE, want = held(C.normalize(PPL).plan);
  const reads = (t) => { try { return held(C.fromCode(t).plan) === want; } catch (e) { return false; } };
  const lines = code.replace(/((?:[^-]+-){3}[^-]+)-/g, '$1\n');
  const ways = {
    'small letters': code.toLowerCase(),
    'spaces for hyphens': code.replace(/-/g, ' '),
    'nothing between the groups': symbols(code),
    'a space between every character': symbols(code).split('').join(' '),
    'line breaks': lines,
    'long dashes': code.replace(/-/g, '–').replace('–', '—'),
    'O for 0': code.replace(/0/g, 'O'),
    'o, I and l for 0 and 1': code.replace(/0/g, 'o').replace(/1/, 'I').replace(/1/g, 'l'),
    'words before and after': `Here's my plan: ${code}. Try it!`,
    'curly quotes around it': `“${code}”`,
    'a signature under it': `${code}\n\nSent from my phone`,
    'words that read as symbols on both sides': `light weights tonight: ${code.replace(/-/g, ' ')} thanks, see me at 5`,
    'another GH before it': `GH plan for the gym: ${code.toLowerCase()}`,
    'in the app\'s link': `gradienthealth://plan?c=${code}`,
    'without its GH': code.slice(2),
  };
  const fails = Object.keys(ways).filter((k) => !reads(ways[k]));
  check(`a code reads however it's typed (${Object.keys(ways).length} ways: small letters, spaces, line breaks, O for 0, I and L for 1, words around it)`, fails.length === 0, fails);
  check('and comes back the way the app writes it', C.fromCode(ways['a signature under it']).code === code && GH.planCode.find(`ok ${code.toLowerCase()} ok`) === code && GH.planCode.find('no code here') === null);
  check('a field tidies what\'s typed: capitals, 0 and 1, groups of four', GH.planCode.tidy('gh1o il') === 'GH10-11' && GH.planCode.tidy('GH19-3KX4-') === 'GH19-3KX4' && GH.planCode.tidy('') === '' && GH.planCode.tidy('g') === 'G' && GH.planCode.tidy('GH19 3kx4 hz') === 'GH19-3KX4-HZ');
  check('and leaves alone what isn\'t the start of a code, words made of its letters among it', GH.planCode.tidy('my plan: GH19') === null && GH.planCode.tidy('GHU') === null && GH.planCode.tidy('my plan is in the other room') === null && GH.planCode.tidy('19-3KX4') === null && GH.planCode.tidy('go') === null);
}

section('A code or a link, through the same door');
{
  const code = PPL_CODE, want = held(C.normalize(PPL).plan);
  const viaDecode = async (t) => { try { return held((await C.decode(t)).plan) === want; } catch (e) { return e.code; } };
  check('decode() takes a code: alone, in a sentence, without its GH, and in the app\'s link', await viaDecode(code) === true && await viaDecode(`try this ${code.toLowerCase()} tonight`) === true && await viaDecode(code.slice(2)) === true && await viaDecode(C.appLink(symbols(code)).replace('?d=', '?c=')) === true && await viaDecode(`intent://plan?c=${code}#Intent;scheme=gradienthealth;package=com.shadowsdistant.gradienthealth;end`) === true);
  check('dataFrom() gives the code as the app writes it, or a link\'s data', C.dataFrom(` ${code.toLowerCase().replace(/-/g, ' ')} `) === code && C.dataFrom(`gradienthealth://plan?c=${code}`) === code && C.dataFrom('nothing here') === null);
  check('the app\'s link with a code is a link; a code alone isn\'t, nor is one in someone else\'s link', C.isLink(`gradienthealth://plan?c=${code}`) && !C.isLink(code) && !C.isLink(`https://example.com/?c=${code}`) && !C.isLink('gradienthealth://plan?c=hello'));
  // Links made before there were codes, kept as they were written then.
  const OLD_PLAIN = 'https://shadowsdistant.github.io/gradient-health/p/#AVsiTHVuY2ggYnJlYWsiLCJRdWljay4iLCJKbyIsWzEsNF0sW1siUXVpY2sgb25lIixbInB1c2hfc3RkIiwzLDEwXSxbInNxX2dvYmxldCIsMywxMiw0NV1dLFsiIixbInNpZGVfcGxhbmsiLDIsMzBdXV1d';
  const OLD_PACKED = 'https://shadowsdistant.github.io/gradient-health/p/#gSXKSwqDMBQF0K3IHV_E7yakk44fjxBNUIkktjH7F9vp4QheJS5bNX-9DSDeZV9CDWJKoLQclCJ_rVL0oOAseTP5cmDPtlEK8sesaT789aOOw6gPPznvzpvzsDGAHftGVfUG';
  const was = { name: 'Lunch break', note: 'Quick.', from: 'Jo', weekdays: [1, 4], days: [{ title: 'Quick one', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'sq_goblet', sets: 3, reps: 12, rest: 45 }] }, { title: '', items: [{ move: 'side_plank', sets: 2, secs: 30 }] }] };
  const old = [];
  for (const l of [OLD_PLAIN, OLD_PACKED, OLD_PLAIN.split('#')[1], `gradienthealth://plan?d=${OLD_PACKED.split('#')[1]}`]) {
    const p = (await C.decode(l)).plan;
    old.push(JSON.stringify({ name: p.name, note: p.note, from: p.from, weekdays: p.weekdays, days: p.days }) === JSON.stringify(was));
  }
  check('links from 1.14 still open: plain, compressed, the bare data and the app\'s link', old.every(Boolean) && C.isLink(OLD_PLAIN) && C.dataFrom(OLD_PLAIN) === OLD_PLAIN.split('#')[1], old);
  check('the same plan as a code is a fifth of the length, without the note or the name of who sent it', (() => { const c = C.toCode(was); const p = C.fromCode(c).plan; return symbols(c).length <= 48 && p.name === 'Lunch break' && p.note === '' && !p.from && JSON.stringify(p.days) === JSON.stringify(was.days); })(), C.toCode(was));
  // Data that only looks like a code from afar is still a link's data.
  const junk = await C.decode('AQnotaplanatall_x-GHzz').catch((e) => e.code);
  check('a link\'s bare data with GH somewhere in it is still read as that', junk === 'broken');
  const wordy = await C.decode('MYP1-AN1S-1NTH-E0TH-ERR0-0M').catch((e) => e.message);
  check('and letters that are neither say they aren\'t a plan code', wordy === 'That isn\'t a plan code. A code starts with GH.', wordy);
}

section('The share page writes the same code');
{
  // The page's own writer (src/share-page.html, between its CODE marks) run here, on plans packed as
  // a link packs them, with the moves as the build hands them to the page.
  const html = readFileSync(join(root, 'src/share-page.html'), 'utf8');
  const pageCode = new Function(`${html.slice(html.indexOf('/*@CODE*/'), html.indexOf('/*@/CODE*/'))}\nreturn planCode;`)();
  const T = GH.PLAN_CODE_MOVES, moves = {};
  for (const [id, m] of Object.entries(GH.moves.MOVES)) if (m && m.name) moves[id] = [m.name, m.group || '', m.timed ? 1 : 0, T.indexOf(id)];
  const packed = (p) => [p.name, p.note || '', 'Jo', p.weekdays || 0, p.days.map((d) => [d.title || ''].concat(d.items.map((it) => [it.move, it.sets, it.secs != null ? it.secs : it.reps].concat(it.rest != null ? [it.rest] : []))))];
  const differs = (raw) => { const p = C.normalize(raw).plan; return pageCode(packed(p), moves) !== symbols(C.toCode(p)); };
  const ids = Object.keys(GH.moves.MOVES);
  const every = { name: 'Every group', days: [{ title: '', items: ['curl_std', 'tri_oh', 'push_std', 'sq_bw', 'row_db', 'raise', 'ab_deadbug', 'fin_jacks', 'mob_catcow', 'imp_heel', 'bal_one'].map((id) => ({ move: id, sets: 2, [GH.moves.MOVES[id].timed ? 'secs' : 'reps']: 10 })) }, { title: 'Chest and arms', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'curl_std', sets: 3, reps: 10 }] }] };
  const fixed = [typical, PPL, PINNED, every, { days: [typical.days[0]] }, { name: 'My plan', days: [PPL.days[1]] }, C.dayPlan(typical, 2), { name: 'Тренировка 💪', days: PPL.days }];
  check('the fixtures: a plan with every muscle group, names the app would give anyway, one workout, another alphabet', fixed.filter(differs).length === 0 && new Set(every.days[0].items.map((it) => GH.moves.MOVES[it.move].group)).size === new Set(ids.map((id) => GH.moves.MOVES[id].group)).size, fixed.filter(differs).map((p) => p.name));
  const off = madeUp(400, 4242).filter(differs);
  check('and 400 made-up plans, character for character', off.length === 0, off.slice(0, 2).map((p) => JSON.stringify(p).slice(0, 300)));
  // What a link could hold that the app would have to guess at: no code is shown, and nothing breaks.
  const odd = [null, 'x', [], ['A', '', '', 0, 'days'], ['A', '', '', 0, [['T', ['push_std', 3]]]], ['A', '', '', 0, [['T', ['push_std', 3, 'ten']]]], ['A', '', '', 0, [['T', ['no_such_move', 3, 10]]]], ['A', '', '', 0, [null, 7, ['T']]], [{}, {}, {}, {}, [[{}, [{}, {}, {}]]]]];
  check('a link with something missing in it gets no code, quietly', odd.every((a) => { try { return pageCode(a, moves) === ''; } catch (e) { return false; } }));
  const loose = pageCode(['  Leg‮day ', '', '', [4, 0], [['A', ['push_std', '99', 0, '', 'x'], ['no_such_move', 3, 10]], ['B', ['side_plank', null, 3, 999]]]], moves);
  const strict = C.normalize({ name: '  Leg‮day ', weekdays: [4, 0], days: [{ title: 'A', items: [{ move: 'push_std', sets: '99', reps: 0, rest: '' }, { move: 'no_such_move', sets: 3, reps: 10 }] }, { title: 'B', items: [{ move: 'side_plank', sets: null, reps: 3, rest: 999 }] }] }).plan;
  check('numbers out of range and a move it doesn\'t know come out as the app would keep them', loose === symbols(C.toCode(strict)) && strict.name === 'Leg day' && strict.days[0].items[0].sets === 10, `${loose} ${C.toCode(strict)}`);
}

section('scripts/plan-code.mjs');
{
  const dir = mkdtempSync(join(tmpdir(), 'plan-code-'));
  const file = join(dir, 'plan.json');
  writeFileSync(file, JSON.stringify({ name: 'Abs and arms', note: 'Mine.', weekdays: [0, 2], days: [{ title: 'Arms', items: [{ move: 'curl_std', sets: 3, reps: 12 }, { move: 'plank', sets: 3, secs: 30, rest: 45 }, { move: 'tri_oh', sets: 30, reps: 12 }] }, { items: [{ move: 'side_plank', sets: 3, reps: 30, rest: 45 }] }] }));
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts/plan-code.mjs'), ...args], { encoding: 'utf8' });
  const made = run(file);
  const code = made.stdout.split('\n')[0];
  const got = SHAPE.test(code) ? C.fromCode(code).plan : null;
  check('a plan in a file comes out as its code, made by the app\'s own code', made.status === 0 && got && got.name === 'Abs and arms' && JSON.stringify(got.weekdays) === '[0,2]' && JSON.stringify(got.days[0].items) === '[{"move":"curl_std","sets":3,"reps":12},{"move":"tri_oh","sets":10,"reps":12}]' && JSON.stringify(got.days[1].items) === '[{"move":"side_plank","sets":3,"secs":30,"rest":45}]', made.stdout + made.stderr);
  check('with its length, what was changed or left out, and the plan read back', new RegExp(`${symbols(code).length} characters in ${symbols(code).length / 4} groups`).test(made.stdout) && /"plank" isn't a move the app has, so it's left out\. Close ones: [^\n]*side_plank/.test(made.stdout) && /Day 1, Overhead extension: sets 30 → 10\./.test(made.stdout) && /Side plank is held, so it takes seconds/.test(made.stdout) && /The note isn't part of a code\./.test(made.stdout) && /Read back from the code:\n\nAbs and arms\n2 days · 3 exercises · set days: Mon and Wed/.test(made.stdout) && /side_plank\s+Side plank\s+3 × 30 s each side · rest 45 s/.test(made.stdout), made.stdout);
  const read = run('--decode', `here it is: ${code.toLowerCase()}`);
  check('--decode prints the plan a code holds', read.status === 0 && read.stdout.startsWith(`${code}\n\nAbs and arms\n`) && /curl_std\s+Dumbbell curl\s+3 × 12 reps/.test(read.stdout), read.stdout + read.stderr);
  const asJson = run('--decode', code, '--json');
  check('--json gives it as a plan file', asJson.status === 0 && JSON.stringify(JSON.parse(asJson.stdout)) === JSON.stringify({ name: 'Abs and arms', weekdays: [0, 2], days: got.days }), asJson.stdout);
  const bad = run('--decode', code.replace(/.$/, (c) => (c === 'Z' ? 'Y' : 'Z')));
  check('a wrong code ends with the reason, not a plan', bad.status === 1 && /That code has a typo/.test(bad.stderr) && run(join(dir, 'missing.json')).status === 1, bad.stderr);
  const list = run('--moves', 'plank');
  check('--moves lists the ids a plan can name', list.status === 0 && /side_plank\s+Side plank \(abs, held: secs\)/.test(list.stdout), list.stdout);
  rmSync(dir, { recursive: true, force: true });
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
  const res = doWorkout(S, MON, '4');
  const log = S.log.find((l) => l.type === 'workout' && l.day === MON);
  check('a workout from the plan saves like any other', res.done && log.title === 'Push' && log.items.length === 4 && log.items.every((it, i) => new Set(it.sets.map((x) => x.set)).size === setsFor(i)), log.items.map((it) => it.sets.length));
  check('and counts for the streak', B.calendar(S, MON).streak.current >= 1);
  check('each exercise moves on from your numbers', S.planProg[plan.id]['push_std:10'].reps === 12 && res.lines.some((l) => l.text === 'Push-up → 12 reps'), res.lines);
  // Back to the coach's plan: switching again now waits for tomorrow (today's workout is done).
  const back = C.use(S, null, MON);
  check('back to the coach\'s plan after today\'s workout starts tomorrow', back.from === MON + 1 && S.activePlan === null);
  const w3 = GH.planWeek(S, MON);
  check('today stays done, and the coach\'s plan takes the rest of the week', w3.days[0].kind === 'done' && w3.days.slice(1).some((d) => d.kind === 'workout' && d.tpl != null && typeof d.tpl === 'number'), kinds(w3));
  const tl = GH.coach.timeline(S, MON + 1).map((x) => x.text);
  check('the coach page lists both switches', tl.includes('Switched to Push Pull Legs') && tl.includes('Back to the coach\'s plan'), tl);
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
  // (Someone who has trained a year or more: from 1.15 a beginner has no planned lighter week in
  // their first 12 weeks, brain.js replay.)
  const S = fresh(MON - 35, { experience: '1to3' });
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

section('The weaker side\'s catch-up set (1.15)');
{
  // Curls on three of the plan's days, a squat on the last: the lead side's extra curl set comes
  // beside the curls on the plan's first two days that have them (two days a week at most, as on
  // the coach's plan), the extra squat set on the squat day.
  const ARMS = {
    name: 'Arms', weekdays: [0, 2, 4],
    days: [
      { title: 'A', items: [{ move: 'curl_std', sets: 3, reps: 10 }, { move: 'push_std', sets: 3, reps: 10 }] },
      { title: 'B', items: [{ move: 'row_db', sets: 3, reps: 10 }, { move: 'curl_std', sets: 3, reps: 10 }] },
      { title: 'C', items: [{ move: 'sq_goblet', sets: 3, reps: 12 }, { move: 'curl_std', sets: 3, reps: 10 }] },
    ],
  };
  const setUp = (patch, from = MON) => { const S = fresh(MON, patch); if (from !== MON) S.personalFrom = from; const plan = C.add(S, ARMS).plan; C.use(S, plan.id, MON); return { S, plan }; };
  const week = (S, plan, ws = MON, o = {}) => [0, 1, 2].map((i) => B.buildSession(S, ws + 2 * i, `c:${plan.id}:${i}`, Object.assign({ cal: B.calendar(S, ws + 2 * i), noReadiness: true }, o)));
  const arm = (s) => s.extras.filter((x) => x.extraKind === 'arm');
  const { S, plan } = setUp({});
  const w = week(S, plan);
  check('curls on three days: the lead arm\'s extra curl set on the first two', S.catchup.arm.active && w.map((s) => arm(s).length).join() === '1,1,0' && w.flatMap(arm).every((x) => x.leadOnly === 'L' && x.sets === 1 && x.fam === 'curl'), w.map((s) => s.extras.map((x) => `${x.moveId} ${x.leadOnly}`)));
  check('and none on a short session', !week(S, plan, MON, { short: true }).some((s) => s.extras.length));
  check('none when neither arm is behind (lead.arm null)', week(setUp({ lead: { arm: null, leg: null } }).S, setUp({ lead: { arm: null, leg: null } }).plan).every((s) => !s.extras.length));
  // From the epoch: a plan used in the weeks before 1.15's rules keeps its sessions as they were.
  const old = setUp({}, MON + 7);
  check('none before the epoch (S.personalFrom), and from then on', week(old.S, old.plan).every((s) => !s.extras.length) && week(old.S, old.plan, MON + 7).map((s) => arm(s).length).join() === '1,1,0');
  const st = B.steps(S, w[1]);
  const curls = st.map((x, i) => (x.kind === 'set' && x.item.moveId === 'curl_std' ? i : -1)).filter((i) => i >= 0);
  const xAt = st.findIndex((x) => x.kind === 'set' && x.item.kind === 'extra');
  check('the steps put the extra set straight after the curls, lead side only', curls.length > 0 && xAt === curls[curls.length - 1] + 1 && st[xAt].side === 'L' && st[xAt].leadOnly && st.filter((x) => x.item && x.item.kind === 'extra').length === 1, st.map((x) => `${x.kind} ${x.item && x.item.moveId}`));
  // The weaker leg too, on the day with a squat.
  const legs = setUp({ lead: { arm: null, leg: 'R' } });
  check('a weaker leg gets its extra squat set on the squat day', week(legs.S, legs.plan).map((s) => s.extras.filter((x) => x.extraKind === 'leg' && x.leadOnly === 'R').length).join() === '0,0,1');
  // The player runs it and the finish keeps both: the extra set in the log, the plan's own numbers.
  const res = doWorkout(S, MON, '4');
  const log = S.log.find((l) => l.type === 'workout' && l.day === MON);
  const xl = log.items.find((it) => it.kind === 'extra');
  check('a workout with the extra set saves it, and the plan\'s exercises still move on', res.done && log.items.length === 3 && xl && xl.sets.length === 1 && xl.sets[0].side === 'L' && log.planned === w[0].items.reduce((a, it) => a + it.sets, 0) + 1 && S.planProg[plan.id]['curl_std:10'].reps > 10, [log.items.map((it) => `${it.kind} ${it.moveId} ${it.sets.length}`), S.planProg[plan.id]]);
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
    const res = doWorkout(S, d, '4');
    if (p.tpl === `c:${plan.id}:0`) reps.push(S.planProg[plan.id]['push_std:10'].reps);
  }
  check('4 or more left every time: push-ups climb 2 reps a session (not in the deload week)', reps.slice(0, 3).join() === '12,14,16' && reps[reps.length - 1] >= 16, reps.join());
  // 1.13: 3 left is on a 1-3 (or 2-3) aim, so it's the usual one rep; 0 holds.
  const one = (rir) => { const S2 = fresh(MON); const p2 = C.add(S2, PPL).plan; C.use(S2, p2.id, MON); doWorkout(S2, MON, rir); return S2.planProg[p2.id]['push_std:10'].reps; };
  check('3 left (on the aim) adds a rep, 1-2 too, and 0 holds', one('3') === 11 && one('12') === 11 && one('0') === 10, [one('3'), one('12'), one('0')]);
  const book = S.planProg[plan.id];
  // (1.15: the press starts on the 15 lb pair, as 10 lb is under a third of what someone of this
  // size presses once, too light to build with (brain.js weightFit). The lateral raise starts on
  // the 10 lb pair and is the one that goes up.)
  check('the dumbbell moves go up a weight at the top of the range', book['raise:15'].w === 1 && book['raise:15'].reps <= 20 && book['chest_press:12'].w === 1, [book['raise:15'], book['chest_press:12']]);
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
  // (1.15: this person's curls are one arm at a time, the left being the weaker, which takes twice
  // as long: 4 sets of everything no longer fits the time with the rows a plan must keep. The
  // answer adds sets to the day's first exercise, as asked.)
  const good = { name: 'Arms first', note: 'More arm work, easy on your knees.', days: plan.days.map((d, i) => ({ title: d.title, items: d.items.map((it, k) => ({ move: it.move, sets: i === 0 && k === 0 ? 4 : it.sets, reps: 12 })) })) };
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

/* ------------------------------------------------------------------ the picker's model */
section('The picker: what each move is done with, and search');
{
  const S = fresh(MON - 14);
  const day = MON;
  const cat = C.catalog(S, day);
  const row = cat.find((x) => x.id === 'row_db');
  check('the catalog is kept for the day and the state it was worked out for', C.catalog(S, day) === cat && C.catalog(S, day + 1) !== cat);
  check('each move: what it\'s done with, in kinds and in words, and what it works', JSON.stringify(row.kit) === '["db","kb"]' && row.kitText === 'dumbbells or kettlebell' && row.muscles.includes('lats') && row.ok, row);
  check('a chair, a wall or a towel is body only', JSON.stringify(cat.find((x) => x.id === 'tri_dip_bent').kit) === '["body"]' && JSON.stringify(cat.find((x) => x.id === 'push_std').kit) === '["body"]');
  check('the kinds the filter lists come from what moves need', C.KIT.every(([k]) => cat.some((x) => x.kit.includes(k))), C.KIT.map(([k]) => k));
  const both = cat.filter((x) => x.ok && x.kit.includes('cable'));
  check('and the kinds you have: a move done with a band or a cable is yours with the band', both.length > 0 && both.every((x) => !x.mine.includes('cable') && x.mine.length > 0) && cat.every((x) => x.mine.every((k) => x.kit.includes(k))) && JSON.stringify(row.mine) === '["db","kb"]', both.map((x) => `${x.id} ${x.kit} / ${x.mine}`).slice(0, 4));
  const G = fresh(MON - 14, { where: 'gym', gym: B.gymPreset('full', 'lb') });
  check('at the gym, its cables and barbells are yours too', C.catalog(G, day).some((x) => x.ok && x.mine.includes('cable')) && C.catalog(G, day).some((x) => x.ok && x.mine.includes('barbell')));
  const first = (q) => (C.search(cat, q)[0] || {}).id;
  check('"pushup", "push up", "push-up", "pushups" and "press-up" all find the push-up first', ['pushup', 'push up', 'push-up', 'pushups', 'press-up'].every((q) => first(q) === 'push_std'), ['pushup', 'push up', 'push-up', 'pushups', 'press-up'].map(first));
  check('a word a letter off ("dumbell row") and words in any order ("squat goblet")', first('dumbell row') === 'row_db' && first('squat goblet') === 'sq_goblet', [first('dumbell row'), first('squat goblet')]);
  check('a muscle ("glutes") finds the moves that work it', C.search(cat, 'glutes').length > 20 && C.search(cat, 'glutes').every((x) => x.muscles.includes('glutes')));
  check('kit by its short name: "db" finds dumbbell moves only, "kb" kettlebell ones', C.search(cat, 'db').length > 20 && C.search(cat, 'db').every((x) => x.kit.includes('db')) && C.search(cat, 'kb').every((x) => x.kit.includes('kb')));
  check('a short word only matches the start of a word ("row" isn\'t in "throw")', C.search(cat, 'row').every((x) => x.find.first.some((w) => w.startsWith('row')) || x.find.words.some((w) => w.startsWith('row'))));
  check('nothing for nonsense, and everything for an empty search', C.search(cat, 'zzzz').length === 0 && C.search(cat, ' ').length === cat.length);
}

section('A new exercise\'s numbers');
{
  const S = fresh(MON - 14);
  const day = MON;
  const st = S.prog.push;
  const d = (id) => C.defaults(S, id, day);
  check('on the level you\'re at: your own reps', st.rung === 'push_std' && d('push_std').reps === st.reps, { st, it: d('push_std') });
  check('an easier level: more reps; a harder one: fewer', d('push_wall').reps > st.reps && d('push_archer').reps < st.reps, [d('push_wall'), d('push_archer')]);
  const tiers = B.programFor(S.profile).tiers;
  check('sets from your goals: more for a top goal\'s muscles than for the rest', tiers.biceps === 1 && tiers.shoulders === 3 && d('curl_std').sets > d('raise').sets, [d('curl_std'), d('raise')]);
  check('a stretch: two sets, held for seconds', d('mob_catcow').sets === 2 && d('mob_catcow').secs > 0 && d('mob_catcow').reps == null, d('mob_catcow'));
  check('within the range the engine gives you', ['push_std', 'push_wall', 'push_archer', 'curl_std', 'sq_goblet'].every((id) => { const m = GH.moves.MOVES[id]; const r = B.rangeFor(S, m, m.family, day) || m.range; return d(id).reps >= r[0] && d(id).reps <= r[1]; }));
  const T = fresh(MON - 14); T.profile.gentle = true;
  check('a gentle start: a set fewer, never under two', C.defaults(T, 'curl_std', day).sets === d('curl_std').sets - 1 && C.defaults(T, 'raise', day).sets === 2);
  check('itemFor: the move with its numbers', JSON.stringify(C.itemFor(S, 'push_std', day)) === JSON.stringify(Object.assign({ move: 'push_std' }, d('push_std'))));
  check('auto rest: longer after a big move', C.restAuto(S, 'sq_goblet') > C.restAuto(S, 'raise'), [C.restAuto(S, 'sq_goblet'), C.restAuto(S, 'raise')]);
}

section('This week by muscle, and suggestions');
{
  const S = fresh(MON - 14);
  const day = MON;
  const draft = (days) => C.normalize({ days }, { draft: true }).plan;
  const empty = C.weekSets(S, draft([{ items: [] }]));
  check('an empty plan: every group at none, against your weekly sets', empty.length === 7 && empty.every((w) => w.status === 'none' && w.sets === 0 && w.aim === (S.vol[w.group] || B.programFor(S.profile).start[w.group])), empty.map((w) => `${w.group} ${w.aim}`));
  const legs = draft([{ items: [{ move: 'sq_goblet', sets: 3, reps: 12 }] }, { items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'row_db', sets: 3, reps: 10 }, { move: 'curl_std', sets: 10, reps: 10 }, { move: 'curl_hammer', sets: 10, reps: 10 }] }]);
  const wk = Object.fromEntries(C.weekSets(S, legs).map((w) => [w.group, w]));
  check('sets count across the days: low under 70% of the aim, high past the cap', wk.legs.sets === 3 && wk.legs.status === 'low' && wk.biceps.sets === 20 && wk.biceps.status === 'high' && wk.triceps.status === 'none', Object.values(wk).map((w) => `${w.group} ${w.sets}/${w.aim} ${w.status}`));
  const sg = C.suggest(S, legs, 0, day);
  const cx = C.context(S, day);
  check('suggestions for a legs day: another legs move first, then the muscles the week leaves short', sg[0].why === 'day' && GH.moves.MOVES[sg[0].id].group === 'legs' && sg.slice(1).every((x) => x.why === 'none' || x.why === 'low'), sg);
  check('each one you can do, from a ladder the day doesn\'t use, at most six', sg.length <= 6 && sg.every((x) => C.check(cx, x.id).ok && GH.moves.MOVES[x.id].family !== GH.moves.MOVES.sq_goblet.family && x.id !== 'sq_goblet'), sg.map((x) => x.id));
  const bridge = C.suggest(S, draft([{ items: [{ move: 'hg_bridge', sets: 3, reps: 15 }] }]), 0, day, null, 12);
  check('never the same exercise from another ladder (a glute bridge is in the hinge ladder and the glute one)', bridge.length >= 6 && bridge.every((x) => GH.moves.MOVES[x.id].name !== 'Glute bridge'), bridge.map((x) => x.id));
  const blank = C.suggest(S, draft([{ items: [] }]), 0, day);
  check('for an empty plan, a move for each muscle it has none of, at your level', blank.length === 6 && new Set(blank.map((x) => x.group)).size === 6 && blank.every((x) => x.why === 'none') && blank.some((x) => x.id === 'push_std'), blank);
  const like = C.similar(S, 'push_std', day, 6);
  check('moves most like a push-up: chest moves you can do, the nearest levels first', like.length === 6 && like.every((x) => GH.moves.MOVES[x.id].group === 'chest' && C.check(cx, x.id).ok && x.id !== 'push_std') && like.slice(0, 2).every((x) => GH.moves.LADDERS.push.rungs.includes(x.id)), like.map((x) => x.id));
}

section('Ready-made plans');
{
  const S = fresh(MON - 14);
  const day = MON;
  const cx = C.context(S, day);
  const list = C.templates(S);
  check('Full body, Upper and lower, Push, pull, legs and No equipment, for your days and minutes', JSON.stringify(list.map((t) => t.id)) === '["full","upperlower","ppl","bodyweight"]' && list.every((t) => t.days === 4 && t.minutes === 25), list);
  check('No equipment only for someone who has some', C.templates(fresh(MON - 14, { equipment: { chair: true, wall: true, towel: true } })).every((t) => t.id !== 'bodyweight'));
  const two = Object.fromEntries(C.templates(fresh(MON - 14, { days: 2 })).map((t) => [t.id, t.days]));
  check('two days a week: Push, pull, legs still takes three', two.full === 2 && two.upperlower === 2 && two.ppl === 3, two);
  const groups = (d) => new Set(d.items.map((it) => GH.moves.MOVES[it.move].group));
  const fit = (p) => p.days.every((d, i) => Math.abs(C.minutes(S, p, i, day) - 25) <= 5);
  const okAll = (p) => p.days.every((d) => d.items.length >= 3 && d.items.every((it) => it.sets >= 2 && C.check(cx, it.move).ok));
  const full = C.template(S, day, 'full');
  check('Full body: A to D, each with legs, chest and back, every move one you can do, two sets or more', full.name === 'Full body' && full.source === 'you' && C.ready(full) && full.days.map((d) => d.title).join() === 'Full body A,Full body B,Full body C,Full body D' && full.days.every((d) => ['legs', 'chest', 'back'].every((g) => groups(d).has(g))) && okAll(full), full.days.map((d) => `${d.title}: ${d.items.map((it) => `${it.move} ${it.sets}`)}`));
  check('the days aren\'t all the same', new Set(full.days.map((d) => d.items.map((it) => it.move).join())).size >= 2);
  // Short of time (20 minutes, and the reps of someone some weeks in): a top goal's exercise stays
  // each day, the top goals taking turns, and a lower goal's exercise goes down to a set first.
  const T = fresh(MON - 14, { minutes: 20 });
  for (const f of ['row', 'squat', 'hinge', 'push', 'chestDb']) if (T.prog[f]) T.prog[f].reps = Math.round((T.prog[f].reps || 10) * 1.8);
  const tiersT = B.programFor(T.profile).tiers;
  const top = (d) => d.items.filter((it) => tiersT[GH.moves.MOVES[it.move].group] === 1).map((it) => GH.moves.MOVES[it.move].group);
  const tight = C.template(T, day, 'full');
  check('short of time: each Full body day keeps one of your top goals, taking turns, before a lower goal\'s second set', tight.days.every((d) => top(d).length >= 1 && ['legs', 'chest'].every((g) => groups(d).has(g))) && new Set(tight.days.map((d) => top(d).join())).size >= 3 && tight.days.every((d) => d.items.every((it) => it.sets >= 2 || tiersT[GH.moves.MOVES[it.move].group] > 1)), tight.days.map((d) => d.items.map((it) => `${it.move} ${it.sets}`)));
  check('each about your 25 minutes', fit(full), full.days.map((d, i) => C.minutes(S, full, i, day)));
  const ul = C.template(S, day, 'upperlower');
  check('Upper and lower: upper days hold no legs, lower days only legs and core', ul.days.map((d) => d.title).join() === 'Upper body A,Lower body A,Upper body B,Lower body B' && [0, 2].every((i) => !groups(ul.days[i]).has('legs')) && [1, 3].every((i) => [...groups(ul.days[i])].every((g) => g === 'legs' || g === 'abs')) && okAll(ul) && fit(ul), ul.days.map((d) => [...groups(d)]));
  const ppl = C.template(S, day, 'ppl');
  const PUSH = ['chest', 'shoulders', 'triceps'], PULL = ['back', 'biceps'];
  check('Push, pull, legs: each day its own muscles', ppl.days.map((d) => d.title).join() === 'Push A,Pull,Legs,Push B' && [0, 3].every((i) => [...groups(ppl.days[i])].every((g) => PUSH.includes(g))) && [...groups(ppl.days[1])].every((g) => PULL.includes(g)) && okAll(ppl) && fit(ppl), ppl.days.map((d) => [...groups(d)]));
  const cat = C.catalog(S, day);
  const bw = C.template(S, day, 'bodyweight');
  check('No equipment: body-only moves, full body', bw.days.every((d) => d.items.every((it) => cat.find((x) => x.id === it.move).kit.join() === 'body')) && bw.days.every((d) => groups(d).has('legs')) && okAll(bw), bw.days.map((d) => d.items.map((it) => it.move)));
  const G = fresh(MON - 14, { where: 'gym', gym: B.gymPreset('full', 'lb'), days: 3, minutes: 45 });
  const gf = C.template(G, day, 'full');
  const gcx = C.context(G, day);
  const gcat = C.catalog(G, day);
  check('at the gym: three Full body days with barbell work, every move one you can do there', gf.days.length === 3 && gf.days.every((d) => d.items.some((it) => gcat.find((x) => x.id === it.move).kit.includes('barbell'))) && gf.days.every((d) => d.items.every((it) => C.check(gcx, it.move).ok)), gf.days.map((d) => d.items.map((it) => it.move)));
  const W = fresh(MON - 14, { days: 2, weekdays: [3, 0] });
  check('your own weekdays when the days match (not for three days of Push, pull, legs)', JSON.stringify(C.template(W, day, 'full').weekdays) === '[0,3]' && C.template(W, day, 'ppl').days.length === 3 && C.template(W, day, 'ppl').weekdays == null, [C.template(W, day, 'full').weekdays, C.template(W, day, 'ppl').weekdays]);
}

section('Plans for different bodies (src/access.js)');
{
  // Rheumatoid arthritis: no weight on the hands, so a push-up in a shared plan is swapped for the
  // closest move this body can do, and says why.
  const S = fresh(MON - 7, { age: 60, conditions: ['ra'] });
  const plan = C.add(S, PPL).plan;
  C.use(S, plan.id, MON);
  const cal = B.calendar(S, MON);
  const tp = B.todayPlan(S, MON, cal);
  const s = B.buildSession(S, MON, tp.tpl, { cal, noReadiness: true });
  const push = s.items.find((it) => it.plan && it.plan.move === 'push_std');
  check('rheumatoid arthritis: the push-up is swapped, with the reason', !!push && push.moveId !== 'push_std' && !GH.access.why(S.profile, GH.moves.MOVES[push.moveId], MON) && /hands/.test(push.swapWhy || ''), push && { to: push.moveId, why: push.swapWhy });
  check('and every exercise suits this body', s.items.every((it) => !GH.access.why(S.profile, GH.moves.MOVES[it.moveId], MON)), s.items.map((it) => it.moveId));
  check('the plan\'s session gets the gentle warm-up and range of motion, not extra exercises', s.warmup.some((w) => w.moveId === 'wu_march') && s.mobility.some((mb) => mb.moveId === 'mob_wrist') && s.items.length === PPL.days[0].items.length && !s.items.some((it) => it.group === 'balance'));
  // A flare day turns the plan's day into gentle range of motion, as it does on the coach's plan.
  S.feel[MON] = { flare: true };
  const flare = B.buildSession(S, MON, tp.tpl, { cal, noReadiness: true });
  check('a flare day: gentle range of motion instead of the plan\'s exercises', flare.flare && !flare.items.length && flare.mobility.length >= 5);
  // The seated and gentle moves are anyone's to put in a plan.
  const T = fresh(MON - 7);
  const own = C.add(T, { name: 'Chair day', days: [{ title: 'Seated', items: [{ move: 'ch_seat_band', sets: 2, reps: 12 }, { move: 'sq_sts', sets: 2, reps: 10 }, { move: 'bal_tandem_wall', sets: 2, secs: 20 }] }] }).plan;
  C.use(T, own.id, MON);
  const cal2 = B.calendar(T, MON);
  const tp2 = B.todayPlan(T, MON, cal2);
  const s2 = tp2.type === 'workout' ? B.buildSession(T, MON, tp2.tpl, { cal: cal2, noReadiness: true }) : null;
  check('seated, sit-to-stand and balance moves run as written for anyone', !!s2 && s2.items.map((it) => it.moveId).join() === 'ch_seat_band,sq_sts,bal_tandem_wall', s2 && s2.items.map((it) => it.moveId));
}

done();
