// A plan code from the command line, made and read by the app's own code (src/plancode.js, with
// src/customplan.js's normalize()), not a copy of it.
//
//   node scripts/plan-code.mjs plan.json          the plan's code, what changed on the way in, the
//                                                 code's length, and the plan read back from it
//   node scripts/plan-code.mjs --decode "GH1A-…"  the plan a code holds (a code among other words
//                                                 works, and so does a share link)
//   node scripts/plan-code.mjs --moves [words]    the move ids a plan can name, with their names
//   --json                                        with either of the first two: the plan as JSON only
//
// plan.json:
//   { "name": "Abs and arms", "weekdays": [0, 2, 4], "days": [{ "title": "Arms", "items": [
//     { "move": "curl_std", "sets": 3, "reps": 12 }, { "move": "side_plank", "sets": 3, "secs": 30, "rest": 45 }] }] }
// weekdays (optional): one for each day, 0 for Monday to 6 for Sunday. rest (optional): seconds. A
// move that's held takes "secs", the others "reps". A name or a title left out is the app's own.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const words = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// The app's plain scripts in this process, the way test/lib.mjs loads them: the moves, the brain
// (a day's title comes from its muscles' names), the plans and the plan code.
export function app() {
  for (const f of ['src/data/moves.js', 'src/data/moves-access.js', 'src/brain.js', 'src/customplan.js', 'src/data/plancode-moves.js', 'src/plancode.js']) require(join(root, f));
  return globalThis.GH;
}

// A plan as plan.json writes it: what a code holds, and nothing else.
export function plain(plan) {
  const out = { name: plan.name };
  if (plan.weekdays) out.weekdays = plan.weekdays.slice();
  out.days = plan.days.map((d) => ({ title: d.title, items: d.items.map((it) => Object.assign({}, it)) }));
  return out;
}

// The moves whose id or name holds one of the words (every move, with none).
export function moves(GH, find) {
  const q = String(find || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return Object.entries(GH.moves.MOVES)
    .filter(([id, m]) => m && m.name && q.every((w) => `${id} ${m.name}`.toLowerCase().includes(w)))
    .map(([id, m]) => ({ id, name: m.name, group: m.group, timed: !!m.timed }));
}

// What normalize() changed or left out of a plan as it was written, a line each.
export function changes(GH, raw, plan, report) {
  const MOVES = GH.moves.MOVES, L = GH.customPlan.LIMITS;
  const known = (x) => !!x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(MOVES, String(x.move || ''));
  const num = (x) => (x == null || x === '' ? null : Number(x));
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = [];
  for (const id of report.unknown) {
    const part = String(id).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const near = part.length ? Object.keys(MOVES).filter((k) => part.some((w) => k.includes(w) || String(MOVES[k].name).toLowerCase().includes(w))).slice(0, 5) : [];
    out.push(`"${id}" isn't a move the app has, so it's left out.${near.length ? ` Close ones: ${near.join(', ')}.` : ''}`);
  }
  let pi = 0;
  (Array.isArray(r.days) ? r.days : []).forEach((d, di) => {
    const items = (d && Array.isArray(d.items) ? d.items : []).filter(known);
    if (!items.length) { out.push(`Day ${di + 1} of the file has no exercises the app has, so the day is left out.`); return; }
    const pd = plan.days[pi];
    if (!pd) { out.push(`Day ${di + 1} of the file is left out: a plan holds ${L.days} days.`); return; }
    const at = `Day ${++pi}`;
    if (items.length > pd.items.length) out.push(`${at}: ${items.length - pd.items.length} left out, a day holds ${L.items} exercises.`);
    if (String(d.title == null ? '' : d.title) !== pd.title) out.push(`${at}: its title is now "${pd.title}".`);
    pd.items.forEach((it, k) => {
      const x = items[k], m = MOVES[it.move], who = `${at}, ${m.name}`;
      if (num(x.sets) !== it.sets) out.push(`${who}: sets ${x.sets == null ? 'not given' : x.sets} → ${it.sets}.`);
      const [unit, other] = m.timed ? ['secs', 'reps'] : ['reps', 'secs'];
      const given = x[unit] != null ? x[unit] : x[other];
      if (x[unit] == null && x[other] != null) out.push(`${who} is ${m.timed ? 'held, so it takes seconds' : 'counted, so it takes reps'}: "${other}": ${x[other]} is read as ${it[unit]} ${unit}.`);
      else if (num(given) !== it[unit]) out.push(`${who}: ${unit} ${given == null ? 'not given' : given} → ${it[unit]}.`);
      if (num(x.rest) !== (it.rest == null ? null : it.rest)) out.push(`${who}: rest ${x.rest} → ${it.rest == null ? 'the app\'s own' : `${it.rest} s`}.`);
    });
  });
  if (r.name != null && String(r.name) !== plan.name) out.push(`The name is now "${plan.name}".`);
  if (r.weekdays != null && !plan.weekdays) out.push('The weekdays are left out, so the days are spread through the week. They take one for each day, 0 (Monday) to 6 (Sunday), none twice.');
  if (r.note) out.push('The note isn\'t part of a code.');
  if (r.from) out.push('Who shared it isn\'t part of a code.');
  return out;
}

// A plan in words: its name, its days and each exercise with its numbers.
export function describe(GH, plan) {
  const C = GH.customPlan, MOVES = GH.moves.MOVES;
  const offs = C.offsetsFor(plan.days.length, plan.weekdays).map((o) => WD[o]);
  const out = [`${plan.name}`, `${C.summary(plan)} · ${plan.weekdays ? `set days: ${words(offs)}` : `spread through the week (${words(offs)} to start with)`}`];
  const wide = Math.max(...plan.days.flatMap((d) => d.items.map((it) => it.move.length)));
  const long = Math.max(...plan.days.flatMap((d) => d.items.map((it) => MOVES[it.move].name.length)));
  plan.days.forEach((d, di) => {
    out.push('', `Day ${di + 1} · ${C.titleOf(plan, di)}${d.title ? '' : ' (named for its muscles)'}`);
    for (const it of d.items) {
      const m = MOVES[it.move];
      out.push(`  ${it.move.padEnd(wide)}  ${m.name.padEnd(long)}  ${it.sets} × ${C.amountText(it)}${m.uni ? ' each side' : ''}${it.rest != null ? ` · rest ${it.rest} s` : ''}`);
    }
  });
  return out;
}

const same = (GH, a, b) => {
  const C = GH.customPlan;
  const shape = (p) => JSON.stringify([p.name, p.weekdays, p.days.map((d, i) => [C.titleOf(p, i), d.items])]);
  return shape(a) === shape(b);
};

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const say = (lines) => console.log([].concat(lines).join('\n'));
  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    say(['Usage:', '  node scripts/plan-code.mjs <plan.json> [--json]', '  node scripts/plan-code.mjs --decode "<code>" [--json]', '  node scripts/plan-code.mjs --moves [words]']);
    return args.length ? 0 : 1;
  }
  const GH = app();
  const C = GH.customPlan;
  if (args[0] === '--moves') {
    const list = moves(GH, args.slice(1).join(' '));
    const wide = Math.max(0, ...list.map((m) => m.id.length));
    say(list.map((m) => `${m.id.padEnd(wide)}  ${m.name} (${m.group}${m.timed ? ', held: secs' : ''})`));
    return list.length ? 0 : 1;
  }
  if (args[0] === '--decode') {
    const text = args.slice(1).join(' ');
    let got;
    try { got = await C.decode(text); } catch (e) { console.error(e.message); return 1; }
    if (json) { say(JSON.stringify(plain(got.plan), null, 2)); return 0; }
    if (got.code) say([got.code, '']);
    say(describe(GH, got.plan));
    if (got.report.unknown.length) say(['', `${got.report.unknown.length} of its exercises ${got.report.unknown.length === 1 ? 'is' : 'are'} from a newer version of the app and left out (${got.report.unknown.join(', ')}).`]);
    return 0;
  }
  let raw;
  try { raw = JSON.parse(readFileSync(args[0], 'utf8')); } catch (e) { console.error(`Couldn't read ${args[0]}: ${e.message}`); return 1; }
  const { plan, report } = C.normalize(raw);
  const changed = changes(GH, raw, plan, report);
  let code;
  try { code = C.toCode(plan); } catch (e) { console.error(e.message); for (const c of changed) console.error(`- ${c}`); return 1; }
  const back = C.fromCode(code).plan;
  if (json) { say(JSON.stringify(plain(back), null, 2)); return same(GH, plan, back) ? 0 : 2; }
  const n = code.replace(/-/g, '').length;
  say([code, '', `${n} characters in ${n / 4} groups (${code.length} with the hyphens)`, '', 'Changed or left out on the way in:']);
  say(changed.length ? changed.map((c) => `- ${c}`) : '- Nothing. The code holds the plan as it was written.');
  say(['', 'Read back from the code:', '']);
  say(describe(GH, back));
  if (!same(GH, plan, back)) { console.error('\nThe code does not read back to the same plan. That is a bug in src/plancode.js.'); return 2; }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
