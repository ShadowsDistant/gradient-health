/* Body: what your training does to each muscle, worked out from the workout log. Pure functions of
 * the state; nothing here writes to it.
 *
 * - sets(S, from, to): weighted sets per muscle, in weekly buckets (at most the last 12 weeks). A
 *   move's primary muscles count a set as 1 and its other muscles as 0.5; a set done on each side
 *   counts once; warm-ups, tests, mobility and conditioning don't count.
 * - trained(S, day, weeks): how the last `weeks` weeks of sets split across the body, per muscle and
 *   per group, with the most and least trained.
 * - improved(S, day, weeks): what went up, per muscle and weighted the same way: logged outcomes
 *   (more reps, more weight or a harder level), estimated maxes, new bests and level-ups, with a
 *   readable line per exercise ("Barbell bench press 60 → 72.5 kg", "Push-ups level 3 → 5").
 * - muscle(S, day, weeks, id): one muscle's picture, for its sheet.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;

  // In display order: chest and shoulders, back, arms, core, hips and legs.
  const MUSCLES = ['chest', 'frontDelts', 'sideDelts', 'rearDelts', 'upperBack', 'lats', 'lowerBack', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'glutes', 'hipFlexors', 'quads', 'hamstrings', 'calves'];
  const NAME = { chest: 'Chest', frontDelts: 'Front delts', sideDelts: 'Side delts', rearDelts: 'Rear delts', upperBack: 'Upper back', lats: 'Lats', lowerBack: 'Lower back', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', abs: 'Abs', obliques: 'Obliques', glutes: 'Glutes', hipFlexors: 'Hip flexors', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves' };
  // The app's seven training groups (brain.GROUPS). Forearms go with biceps: curls and grips train both.
  const GROUP_OF = { chest: 'chest', frontDelts: 'shoulders', sideDelts: 'shoulders', rearDelts: 'shoulders', upperBack: 'back', lats: 'back', lowerBack: 'back', biceps: 'biceps', triceps: 'triceps', forearms: 'biceps', abs: 'abs', obliques: 'abs', glutes: 'legs', hipFlexors: 'legs', quads: 'legs', hamstrings: 'legs', calves: 'legs' };
  // Muscles that come along with bigger ones: never named as the one to train more.
  const MINOR = ['hipFlexors', 'forearms', 'lowerBack'];
  const PRIMARY = 1, SECONDARY = 0.5;
  const MAX_WEEKS = 12;
  // How much each kind of progress adds to a muscle's score (times the muscle's weight in the move).
  const UP = 1, BEST = 0.5, LEVEL = 1;
  const SKIP_KIND = { warmup: 1, test: 1, mobility: 1, cooldown: 1, finisher: 1, interval: 1 };
  const SKIP_GROUP = { mobility: 1, conditioning: 1 };

  const clampWeeks = (w) => Math.max(1, Math.min(MAX_WEEKS, Math.round(Number(w) || 4)));
  const byOrder = (a, b) => MUSCLES.indexOf(a) - MUSCLES.indexOf(b);

  // [muscle, weight] for a move: its first `prime` muscles (default 1) are primary.
  function roles(m) {
    const out = [];
    const prime = m && m.prime != null ? m.prime : 1;
    ((m && m.muscles) || []).forEach((mu, i) => { if (NAME[mu] && !out.some((x) => x[0] === mu)) out.push([mu, i < prime ? PRIMARY : SECONDARY]); });
    return out;
  }
  // The move behind a logged item, when the item counts as training sets.
  function moveOf(it) {
    if (!it || SKIP_KIND[it.kind]) return null;
    const m = M().MOVES[it.moveId];
    return m && !SKIP_GROUP[m.group] && !SKIP_GROUP[it.group] ? m : null;
  }
  // Sets done: both sides of a set count once, a one-side set counts once, a zero isn't a set.
  function setsDone(it) {
    const seen = new Set();
    (it.sets || []).forEach((x, k) => { if (x && x.amount !== 0) seen.add(x.set != null ? x.set : 'k' + k); });
    return seen.size;
  }
  const workouts = (S, to) => (S.log || []).filter((l) => l.type === 'workout' && l.checkedIn && l.day <= to);
  const famOf = (it, m) => (it.fam && M().LADDERS[it.fam] ? it.fam : m.family);

  /* ---------------------------------------------------------------- sets */
  function sets(S, from, to) {
    const b = B();
    const lo = Math.max(from, b.weekStart(to) - 7 * (MAX_WEEKS - 1));
    const first = b.weekStart(lo);
    const weeks = [];
    for (let ws = first; ws <= to; ws += 7) weeks.push({ start: ws, from: Math.max(ws, lo), to: Math.min(ws + 6, to), sets: {}, raw: 0 });
    const total = {}, moves = {};
    let count = 0;
    for (const l of workouts(S, to)) {
      if (l.day < lo) continue;
      const w = weeks[Math.floor((l.day - first) / 7)];
      let any = false;
      for (const it of l.items || []) {
        const m = moveOf(it);
        const n = m ? setsDone(it) : 0;
        if (!n) continue;
        any = true;
        w.raw += n;
        for (const [mu, wt] of roles(m)) {
          const v = n * wt;
          total[mu] = (total[mu] || 0) + v;
          w.sets[mu] = (w.sets[mu] || 0) + v;
          const byId = moves[mu] || (moves[mu] = {});
          const e = byId[m.id] || (byId[m.id] = { id: m.id, name: m.name, sets: 0, n: 0, primary: wt === PRIMARY });
          e.sets += v; e.n += n;
        }
      }
      if (any) count++;
    }
    const list = {};
    for (const [mu, byId] of Object.entries(moves)) list[mu] = Object.values(byId).sort((a, c) => c.sets - a.sets || a.name.localeCompare(c.name));
    return { from: lo, to, weeks, sets: total, moves: list, workouts: count };
  }

  /* ---------------------------------------------------------------- trained */
  function trained(S, day, weeks) {
    const n = clampWeeks(weeks);
    const res = sets(S, day - 7 * n + 1, day);
    const v = (mu) => res.sets[mu] || 0;
    const sum = MUSCLES.reduce((a, mu) => a + v(mu), 0);
    const share = {};
    for (const mu of MUSCLES) share[mu] = sum ? v(mu) / sum : 0;
    const groups = {};
    for (const g of B().GROUPS) groups[g] = { sets: 0, share: 0 };
    for (const mu of MUSCLES) if (groups[GROUP_OF[mu]]) groups[GROUP_OF[mu]].sets += v(mu);
    for (const g of Object.values(groups)) g.share = sum ? g.sets / sum : 0;
    const most = MUSCLES.filter((mu) => v(mu) > 0).sort((a, b) => v(b) - v(a) || byOrder(a, b));
    const least = sum ? MUSCLES.filter((mu) => !MINOR.includes(mu)).sort((a, b) => v(a) - v(b) || byOrder(a, b)) : [];
    return { weeks: n, from: res.from, to: day, sets: res.sets, share, groups, sum, max: most.length ? v(most[0]) : 0, most: most.slice(0, 3), least: least.slice(0, 3), workouts: res.workouts, moves: res.moves };
  }

  /* ---------------------------------------------------------------- improved */
  const UNITS = (S) => (S.profile && S.profile.units === 'kg' ? 'kg' : 'lb');
  const round = (v, step) => Math.round(Math.round(v / step) * step * 10) / 10;
  const fmt = (v) => String(v);
  const weight = (S, kg) => round(B().toUnit(kg, UNITS(S)), UNITS(S) === 'kg' ? 0.5 : 1);
  // An item's best set: a loaded set by its estimated max (Epley), else reps or seconds.
  function perf(it) {
    let v = 0, loaded = false;
    for (const x of it.sets || []) if (x && x.amount > 0 && x.load > 0) { loaded = true; v = Math.max(v, x.load * (1 + x.amount / 30)); }
    if (!loaded) for (const x of it.sets || []) if (x && x.amount > 0) v = Math.max(v, x.amount);
    return v > 0 ? { v, loaded } : null;
  }
  const topLoad = (it) => Math.max(0, ...(it.sets || []).filter((x) => x && x.amount > 0 && x.load > 0).map((x) => x.load));
  const topAmount = (it) => Math.max(0, ...(it.sets || []).filter((x) => x && x.amount > 0).map((x) => x.amount));

  function line(o) {
    const d = o.to - o.from;
    const sign = d > 0 ? '+' : '−';
    const abs = Math.abs(Math.round(d * 10) / 10);
    const delta = o.kind === 'level' ? `${sign}${abs} ${abs === 1 ? 'level' : 'levels'}` : o.kind === 'reps' ? `${sign}${abs} ${abs === 1 ? 'rep' : 'reps'}` : `${sign}${abs} ${o.unit}`;
    const text = o.kind === 'level' ? `${o.name} level ${o.from} → ${o.to}` : `${o.name} ${fmt(o.from)} → ${fmt(o.to)} ${o.kind === 'reps' ? 'reps' : o.unit}`;
    // What makes a line worth showing first: levels, then weight, then reps, and bigger changes.
    const rel = o.from > 0 ? Math.abs(d) / o.from : 1;
    const rank = (o.kind === 'level' ? 3 + Math.abs(d) : o.kind === 'reps' || o.kind === 'time' ? 1 + Math.min(1, rel) : 2 + Math.min(1, rel));
    return Object.assign(o, { dir: d > 0 ? 1 : -1, delta, text, rank });
  }

  function improved(S, day, weeks) {
    const n = clampWeeks(weeks);
    const from = day - 7 * n + 1, to = day;
    const score = {}, ups = {}, holds = {}, downs = {}, bests = {}, levelUps = {};
    const add = (obj, m, v) => { for (const [mu, w] of roles(m)) obj[mu] = (obj[mu] || 0) + v * w; };
    const tally = (obj, m, k) => { for (const [mu] of roles(m)) obj[mu] = (obj[mu] || 0) + (k || 1); };
    const logs = workouts(S, to).slice().sort((a, b) => a.day - b.day);
    const best = {};           // move (and whether loaded) → best performance so far
    const fams = {};           // family → { first: in-range item, moves: { id: { before, first, last } } }
    const logged = new Set();  // "day:move" logged in range, so estimated-max steps aren't counted twice
    for (const l of logs) {
      const inRange = l.day >= from;
      for (const it of l.items || []) {
        const m = moveOf(it);
        if (!m || !setsDone(it)) continue;
        const p = perf(it);
        if (p) {
          const k = m.id + (p.loaded ? ':w' : '');
          if (inRange && best[k] != null && p.v > best[k] + 1e-6) { add(score, m, BEST); tally(bests, m); }
          if (best[k] == null || p.v > best[k]) best[k] = p.v;
        }
        if (it.kind !== 'move') continue; // the extra lead-side set has no outcome of its own
        const fam = famOf(it, m);
        if (fam) {
          const f = fams[fam] || (fams[fam] = { first: null, moves: {} });
          const mv = f.moves[m.id] || (f.moves[m.id] = { before: null, first: null, last: null });
          if (!inRange) mv.before = it;
          else { if (!f.first) f.first = it; if (!mv.first) mv.first = it; mv.last = it; f.last = it; }
        }
        if (!inRange) continue;
        logged.add(l.day + ':' + m.id);
        const o = it.outcome === 'up' ? 1 : it.outcome === 'down' ? -1 : 0;
        tally(o > 0 ? ups : o < 0 ? downs : holds, m);
        if (o) add(score, m, o * UP);
      }
    }
    const lines = [];
    const done = new Set(); // "fam:move" with a line already
    // Gym lifts: the estimated one-rep max, from where it stood before the range to its last value.
    for (const [fam, st] of Object.entries(S.prog || {})) {
      for (const [id, e] of Object.entries((st && st.e1rm) || {})) {
        const m = M().MOVES[id];
        const hist = ((e && e.hist) || []).filter((h) => h[0] <= to).sort((a, b) => a[0] - b[0]);
        const inRange = hist.filter((h) => h[0] >= from);
        if (!m || !inRange.length) continue;
        hist.forEach(([d, v], i) => {
          if (d < from || !i || logged.has(d + ':' + id)) return;
          const prev = hist[i - 1][1];
          const s = v > prev * 1.01 ? 1 : v < prev * 0.99 ? -1 : 0;
          tally(s > 0 ? ups : s < 0 ? downs : holds, m);
          if (s) add(score, m, s * UP);
        });
        const base = hist.filter((h) => h[0] < from).pop() || inRange[0];
        const end = inRange[inRange.length - 1];
        const a = weight(S, base[1]), b = weight(S, end[1]);
        if (base === end || a === b) continue;
        done.add(fam + ':' + id);
        lines.push(line({ fam, id, kind: 'max', name: m.name, from: a, to: b, unit: UNITS(S), note: 'estimated max', muscles: roles(m) }));
      }
    }
    // Level-ups on the home ladders, from the workouts' own celebrations ("Push-ups: level 5 of 8"):
    // a logged move can differ from the ladder's rung for other reasons (a swap for a sore joint,
    // new equipment, simpler moves), so rungs alone would invent levels.
    const ladderByName = {};
    for (const [fam, lad] of Object.entries(M().LADDERS)) if (!lad.gym && !ladderByName[lad.name]) ladderByName[lad.name] = fam;
    const levels = {};
    for (const l of logs) {
      if (l.day < from) continue;
      for (const c of l.celebrate || []) {
        const x = c && c.kind === 'level' && /^(.+): level (\d+) of \d+$/.exec(c.text || '');
        const fam = x && (c.fam || ladderByName[x[1]]);
        if (!fam) continue;
        const lv = levels[fam] || (levels[fam] = { from: Number(x[2]) - 1, to: 0, n: 0 });
        lv.to = Number(x[2]); lv.n++;
      }
    }
    for (const [fam, lv] of Object.entries(levels)) {
      const lad = M().LADDERS[fam];
      const st = S.prog && S.prog[fam];
      const cur = M().MOVES[(st && st.rung) || lad.rungs[0]];
      if (!cur || lv.to <= lv.from) continue;
      add(score, cur, lv.n * LEVEL);
      tally(levelUps, cur, lv.n);
      done.add(fam);
      lines.push(line({ fam, id: cur.id, kind: 'level', name: lad.name, from: lv.from, to: lv.to, unit: '', muscles: roles(cur) }));
    }
    // Otherwise the exercise a family is on now: its weight, then its reps (or seconds), from before
    // the range (or its first time in it) to its last time in it.
    for (const [fam, f] of Object.entries(fams)) {
      if (!f.first || done.has(fam)) continue;
      const id = f.last.moveId;
      const mv = f.moves[id];
      const m = M().MOVES[id];
      if (!mv || done.has(fam + ':' + id)) continue;
      const base = mv.before || mv.first, end = mv.last;
      if (!base || base === end) continue;
      const la = topLoad(base), lb = topLoad(end);
      if (la > 0 && lb > 0 && weight(S, la) !== weight(S, lb)) {
        lines.push(line({ fam, id, kind: 'weight', name: m.name, from: weight(S, la), to: weight(S, lb), unit: UNITS(S), muscles: roles(m) }));
        continue;
      }
      if ((la > 0) !== (lb > 0)) continue; // a weight picked one time and not the other: not comparable
      const ra = topAmount(base), rb = topAmount(end);
      if (ra > 0 && rb > 0 && ra !== rb) lines.push(line({ fam, id, kind: m.timed ? 'time' : 'reps', name: m.name, from: ra, to: rb, unit: m.timed ? 's' : 'reps', muscles: roles(m) }));
    }
    const order = (mu) => (a, b) => {
      const wa = (a.muscles.find((x) => x[0] === mu) || [, 0])[1], wb = (b.muscles.find((x) => x[0] === mu) || [, 0])[1];
      return wb - wa || b.dir - a.dir || b.rank - a.rank;
    };
    const byMuscle = {};
    for (const mu of MUSCLES) byMuscle[mu] = lines.filter((x) => x.muscles.some((r) => r[0] === mu)).sort(order(mu));
    // A group goes by its best muscle, so groups of five muscles don't outrank groups of one.
    const groups = {};
    for (const g of B().GROUPS) {
      const mus = MUSCLES.filter((mu) => GROUP_OF[mu] === g);
      groups[g] = {
        score: Math.max(0, ...mus.map((mu) => score[mu] || 0)),
        top: mus.slice().sort((a, b) => (score[b] || 0) - (score[a] || 0) || byOrder(a, b))[0],
        ups: mus.reduce((a, mu) => Math.max(a, ups[mu] || 0), 0),
        lines: lines.filter((x) => x.muscles.some((r) => r[1] === PRIMARY && GROUP_OF[r[0]] === g)).sort((a, b) => b.dir - a.dir || b.rank - a.rank),
      };
    }
    const trainedSets = sets(S, from, to).sets;
    const v = (mu) => score[mu] || 0;
    const most = MUSCLES.filter((mu) => v(mu) > 0).sort((a, b) => v(b) - v(a) || byOrder(a, b));
    const least = most.length ? MUSCLES.filter((mu) => !MINOR.includes(mu)).sort((a, b) => v(a) - v(b) || byOrder(a, b)) : [];
    return { weeks: n, from, to, score, ups, holds, downs, bests, levelUps, lines, byMuscle, groups, sets: trainedSets, max: most.length ? v(most[0]) : 0, most: most.slice(0, 3), least: least.slice(0, 3) };
  }

  /* ---------------------------------------------------------------- one muscle */
  function muscle(S, day, weeks, mu) {
    const t = trained(S, day, weeks);
    const imp = improved(S, day, weeks);
    const b = B();
    const weekly = sets(S, b.weekStart(day) - 7 * (MAX_WEEKS - 1), day).weeks.map((w) => ({ start: w.start, sets: w.sets[mu] || 0 }));
    const rank = t.sets[mu] > 0 ? MUSCLES.filter((x) => (t.sets[x] || 0) > t.sets[mu]).length + 1 : null;
    return {
      id: mu, name: NAME[mu], group: GROUP_OF[mu], weeks: t.weeks, from: t.from, to: day,
      sets: t.sets[mu] || 0, share: t.share[mu] || 0, rank, weekly, moves: t.moves[mu] || [],
      lines: imp.byMuscle[mu] || [], score: imp.score[mu] || 0,
      ups: imp.ups[mu] || 0, holds: imp.holds[mu] || 0, downs: imp.downs[mu] || 0, bests: imp.bests[mu] || 0, levelUps: imp.levelUps[mu] || 0,
    };
  }

  GH.body = { MUSCLES, NAME, GROUP_OF, MINOR, MAX_WEEKS, roles, setsDone, sets, trained, improved, muscle };
})(typeof window !== 'undefined' ? window : globalThis);
