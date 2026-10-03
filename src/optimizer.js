/* The plan engine's optimizer (GH.optimizer). For each person it:
 *   - works out every weekly split of their muscle groups over their training days and picks the
 *     best (split): an exact branch and bound over each group's days, the best of the usual weekly
 *     frequencies and their one-step variants, and a count of every split that was in the running;
 *   - gives each day its sets (weekPlan): first enough for every group to reach its weekly floor
 *     (a bigger move's help counted at half), then by what a minute of training is worth toward
 *     the week's targets, the top goals weighing most, each day measured on the session its sets
 *     make; with too little time for every group, the groups last week left short come first;
 *   - fits each session to the time set (fit): filled to about 92% of it with the most useful extra
 *     (more sets, a second exercise, the small muscles, longer rests, a finisher, a cool-down, a
 *     longer warm-up), and never more than 30 seconds over it;
 *   - scores a week (score), says why the plan is as it is (explain, explainProfile), compares the
 *     classic splits (alternatives) and checks plan tweaks before they're made (applyTweaks).
 *
 * It reads GH.brain, GH.moves and GH.access only when called: it loads right after brain.js in
 * tests and after access.js in the app. Weeks before S.engineFrom keep 1.5's split (brain.js
 * templateV1), so history and the week in progress stay as they were; the session fixes (fill and
 * cap) apply to every week. Results are cached and must be treated as read-only; in the app they're
 * also kept in the state for the next launch (see keptOf).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;
  const A = () => GH.access;

  /* ================================================================== units and groups */
  // The six units a week is split into (bit u of a day's mask), and the groups each trains.
  const UNITS = ['arms', 'abs', 'chest', 'legs', 'back', 'shoulders'];
  const UNIT_GROUPS = { arms: ['biceps', 'triceps'], abs: ['abs'], chest: ['chest'], legs: ['legs'], back: ['back'], shoulders: ['shoulders'] };
  const UNIT_OF = { biceps: 'arms', triceps: 'arms', abs: 'abs', chest: 'chest', legs: 'legs', back: 'back', shoulders: 'shoulders' };
  const GROUPS = ['biceps', 'triceps', 'abs', 'chest', 'legs', 'back', 'shoulders'];
  const ORDER = ['chest', 'legs', 'back', 'arms', 'shoulders', 'abs'];
  const UPPER = ['chest', 'back', 'shoulders', 'arms'];
  // The usual ladders of each unit, at home and at the gym (stand-ins come through access.famFor).
  const HOME_FAMS = { arms: ['curl', 'triceps'], abs: ['abs', 'absLoad', 'coreRot', 'coreSide'], chest: ['push', 'chestDb'], legs: ['squat', 'hinge', 'glute', 'hamCurl', 'calf'], back: ['row', 'pull', 'rear', 'backExt'], shoulders: ['press', 'raise'] };
  const GYM_FAMS = { arms: ['curlG', 'triG'], abs: ['absG'], chest: ['pressG', 'inclineG', 'flyG'], legs: ['squatG', 'hingeG', 'gluteG', 'lungeG', 'legCurlG', 'legExtG', 'calfG'], back: ['pullG', 'rowG', 'rearG'], shoulders: ['ohpG', 'raiseG'] };
  const FILL = 0.92; // sessions fill to this share of their time
  const OVER = 0.5; // and never run more than this many minutes over it
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const popc = (m) => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
  const tierW = (t) => (t === 1 ? 3 : t === 2 ? 2 : 1);
  const unitTier = (prog, u) => Math.min(...UNIT_GROUPS[u].map((g) => prog.tiers[g] || 3));
  const minutesOf = (x, p) => clamp(Math.round(Number(x) || Number(p && p.minutes) || 25), 10, 60);
  const tweaksOf = (p) => normTweaks(p && p.planTweaks);
  let FREEZE = false;
  const deepFreeze = (o) => { if (FREEZE && o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  // A small cache: the latest few answers by key.
  function lru(n) {
    const m = new Map();
    return {
      get: (k) => { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
      set: (k, v) => { m.set(k, v); if (m.size > n) m.delete(m.keys().next().value); return v; },
      clear: () => m.clear(),
    };
  }
  const stats = { splits: 0, splitMs: 0, weeks: 0, weekMs: 0, nodes: 0, keptSplits: 0, keptWeeks: 0 };

  /* ================================================================== kept across launches */
  // A launch mostly finds the state as the last one left it, and working its plan out again, on code
  // that isn't compiled yet, was most of the time a launch spent on the plan. So what the plan worked
  // out is kept in the state itself (S.planCache: saved with it, and gone with it on a reset):
  //   splits    the split of each set of answers (a search and up to four trial weeks each)
  //   weeks     the latest plan of each week (last week's, this week's, next week's)
  //   sessions  the latest sessions to show, from today on (brain.js)
  //   sets      each week's planned and target sets (brain.weeklySets)
  // Each is filed under a hash of everything it was worked out from, and the whole cache under the
  // app's build and the engine's version: a changed input, another build or another engine works it
  // out afresh. A week that's over keeps what it last had (weekPlan, weeklySets) while its workouts
  // stay as they were (brain.weekLog): what was planned for it then, whatever changed since in the
  // rest of the state. (In the state rather than in localStorage, where src/insights.js keeps its finds:
  // plans are worked out from the state alone, so they go where it goes, a backup or a copy
  // included.) Only the app keeps them (the build sets GH.BUILD); tests switch it on with keep(true).
  const ENGINE = 1; // bump when the engine's answers change in a way GH.BUILD can't see (a dev page)
  const KEEP = { splits: 4, weeks: 3, sessions: 3, sets: 2 };
  let keepOn = null; // null: as GH.BUILD says
  const keeping = () => (keepOn != null ? keepOn : !!GH.BUILD);
  // cyrb53, a quick 53-bit string hash; with the length, plenty to tell two inputs apart. (Keys are
  // a few thousand characters, and the same one is often hashed to look an answer up and again to
  // keep it: the last few are remembered.)
  const hashMemo = new Map();
  function hash(str) {
    const seen = hashMemo.get(str);
    if (seen) return seen;
    if (hashMemo.size >= 16) hashMemo.clear();
    const out = cyrb53(str);
    hashMemo.set(str, out);
    return out;
  }
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${str.length.toString(36)}`;
  }
  // The state's cache for this build and engine (made when `make` and there's none), or null.
  function keptOf(S, make) {
    if (!S || typeof S !== 'object' || !keeping()) return null;
    const v = `${GH.BUILD || 'dev'}.${ENGINE}`;
    const c = S.planCache;
    if (c && typeof c === 'object' && c.v === v && Object.keys(KEEP).every((k) => Array.isArray(c[k]))) return c;
    if (!make) return null;
    S.planCache = { v, splits: [], weeks: [], sessions: [], sets: [] };
    return S.planCache;
  }
  // A kept answer by its hash, or undefined. Entries: { h: [its hashes], s: its slot, w: its week, v }.
  const entryOk = (e) => !!e && typeof e === 'object' && Array.isArray(e.h) && !!e.v && typeof e.v === 'object';
  function recall(list, h) {
    for (const e of list) if (entryOk(e) && e.h.includes(h)) return e.v;
    return undefined;
  }
  // Keeps an answer (a copy, by way of JSON, and only if JSON gives it back as it is: no undefined,
  // no NaN) under its hashes. It replaces what its slot held (a week's plan for an earlier state of
  // the same week); past max, the earliest week goes first, then the oldest entry.
  function remember(list, hs, answer, max, slot, week) {
    let exact = true;
    const txt = JSON.stringify(answer, (k, v) => { if (v === undefined || typeof v === 'function' || (typeof v === 'number' && !Number.isFinite(v))) exact = false; return v; });
    if (!exact) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!entryOk(e) || e.h.some((h) => hs.includes(h)) || (slot != null && e.s === slot)) list.splice(i, 1);
    }
    const e = { h: hs, v: JSON.parse(txt) };
    if (slot != null) { e.s = slot; e.w = week; }
    list.push(e);
    while (list.length > max) {
      let drop = 0;
      for (let i = 1; i < list.length; i++) if ((list[i].w != null ? list[i].w : Infinity) < (list[drop].w != null ? list[drop].w : Infinity)) drop = i;
      list.splice(drop, 1);
    }
  }

  /* ================================================================== the split */
  // What a profile asks of a week's split, as plain data (also its cache key).
  function splitInputs(p, prog) {
    const b = B();
    const offsets = b.weekdaysFor(p);
    const D = offsets.length;
    const minutes = minutesOf(p.minutes);
    const ac = A();
    // Time that isn't sets: getting started, the warm-up, balance practice and a cool-down when
    // they come every session (all shorter under 15 minutes, see compact).
    const every = ac && ac.balancePerWeek(p) >= 7;
    const fixed = minutes < COMPACT ? 0.5 + 1 + (every ? 1.2 : 0) + (prog.mobilityEvery ? 0.7 : 0)
      : 0.5 + (prog.warmupMin || 2.5) + (every ? 2.5 : 0) + (prog.mobilityEvery ? 2 : 0);
    const free = Math.max(3.2, minutes - fixed);
    // Each unit's work in a week, from its groups' starting sets (about 1.7 minutes a set).
    const load = UNITS.map((u) => UNIT_GROUPS[u].reduce((a, g) => a + (prog.start[g] || 0), 0) * 1.7);
    // Simpler sessions (complexity 1 or 2) have 5 or 4 exercises, balance practice included, one
    // for each group: a day takes no more units than that (arms count twice, biceps and triceps).
    const cx = clamp(Math.round(Number(p.complexity) || 0), 0, 2);
    let maxUnits = clamp(Math.floor(free / 3.2), 1, 6);
    if (cx) maxUnits = Math.max(1, Math.min(maxUnits, (cx === 1 ? 5 : 4) - (ac && ac.balancePerWeek(p) >= 7 ? 1 : 0)));
    return {
      D, offsets, minutes, free, maxUnits, w: UNITS.map((u) => (cx && u === 'arms' ? 2 : 1)),
      feasible: feasibleUnits(p), tiers: UNITS.map((u) => unitTier(prog, u)), rule: UNITS.map((u) => prog.freq[u] || 0), load,
      split: tweaksOf(p).split,
    };
  }
  // Which units this body and kit can train at all (any of their ladders, or the stand-in a
  // condition or an empty room opens), at home and at the gym as the person trains.
  const feasMemo = lru(32);
  function feasibleUnits(p) {
    const key = JSON.stringify([p.equipment, p.gym, p.where, p.conditions, p.oaJoints, p.floorOk, p.careful, p.impactOk, p.jumpsOk, p.gentle, p.age, p.conditionsSince, p.startDay, (p.planTweaks || {}).avoid]);
    const hit = feasMemo.get(key);
    if (hit !== undefined) return hit;
    const b = B();
    const day = p.startDay || 0;
    const places = p.where === 'gym' ? ['gym'] : p.where === 'both' ? ['home', 'gym'] : ['home'];
    let mask = 0;
    UNITS.forEach((u, i) => {
      for (const place of places) {
        const S = { profile: Object.assign({}, p, { where: place }), excluded: [], pain: {}, complexity: 0, place: {}, lastPlace: place, prog: {} };
        const fams = HOME_FAMS[u].concat(place === 'gym' ? GYM_FAMS[u] : []);
        if (fams.some((f) => b.rungs(S, b.famFor(S, f, day), day).length)) { mask |= 1 << i; break; }
      }
    });
    return feasMemo.set(key, mask);
  }

  // Combinations of k of the D days, as day masks, in a fixed order.
  const COMBOS = {};
  function combos(D, k) {
    const key = D * 8 + k;
    if (COMBOS[key]) return COMBOS[key];
    const out = [];
    for (let m = 0; m < (1 << D); m++) if (popc(m) === k) out.push(m);
    return (COMBOS[key] = out);
  }
  // The same unit on back-to-back days (real weekday gaps, round into next week too) costs this
  // much a time; legs most.
  const ADJ = (u) => (UNITS[u] === 'legs' ? 0.6 : 0.25);
  const FREQ_COST = 0.15; // each step away from the usual frequency, times the unit's tier weight
  function adjacency(m, D, consec, wrap, w) {
    let c = 0;
    for (let d = 1; d < D; d++) if (consec[d] && (m >> d & 1) && (m >> (d - 1) & 1)) c += w;
    if (wrap && (m & 1) && (m >> (D - 1) & 1)) c += w;
    return c;
  }
  // The best assignment of days to each unit for one frequency vector f: the sum of each day's
  // squared share of the time plus back-to-back costs, every day used, at most maxUnits units a day.
  // Branch and bound over the units in order of their work. Two bounds prune it: the work still to
  // place spread as evenly as it could go over the days with room (water-filling) plus each unit's
  // least back-to-back cost; and each unit left at its cheapest days given those placed (exact for
  // its own days), plus the units left among themselves. A greedy answer starts it off, and units
  // the cost can't tell apart are only tried in one order. Exact (test/optimizer.mjs checks it
  // against brute force). best0: an upper bound to beat (from another frequency vector).
  function bestDays(f, ctx, best0) {
    const { D, offsets, maxUnits } = ctx;
    const W = ctx.w || UNITS.map(() => 1);
    const consec = offsets.map((o, i) => i > 0 && o - offsets[i - 1] === 1);
    const wrap = D > 1 && offsets[0] + 7 - offsets[D - 1] === 1;
    const share = UNITS.map((u, i) => (f[i] ? ctx.load[i] / f[i] / ctx.free : 0));
    // Heaviest first; units the cost can't tell apart (same share, days, back-to-back cost and room)
    // side by side, so only one order of them is tried (their days in increasing order).
    const order = UNITS.map((u, i) => i).filter((i) => f[i] > 0)
      .sort((a, b) => ctx.load[b] - ctx.load[a] || share[b] - share[a] || f[b] - f[a] || ADJ(b) - ADJ(a) || W[b] - W[a] || a - b);
    const U = order.length;
    const same = order.map((u, i) => i > 0 && Math.abs(share[u] - share[order[i - 1]]) < 1e-12 && f[u] === f[order[i - 1]] && ADJ(u) === ADJ(order[i - 1]) && W[u] === W[order[i - 1]]);
    // Each unit's options as flat arrays: the day mask, its back-to-back cost, its days.
    const optM = [], optA = [], optD = [], costB = [], idxB = [];
    for (const u of order) {
      const ms = combos(D, f[u]);
      optM.push(Int32Array.from(ms));
      optA.push(Float64Array.from(ms.map((m) => adjacency(m, D, consec, wrap, ADJ(u)))));
      const dd = new Int8Array(ms.length * f[u]);
      ms.forEach((m, k) => { let q = 0; for (let d = 0; d < D; d++) if (m >> d & 1) dd[k * f[u] + q++] = d; });
      optD.push(dd);
      costB.push(new Float64Array(ms.length)); idxB.push(new Int32Array(ms.length));
    }
    const fo = order.map((u) => f[u]), so = order.map((u) => share[u]), wo = order.map((u) => W[u]);
    const restAdj = new Float64Array(U + 1), restLoad = new Float64Array(U + 1), restOwn = new Float64Array(U + 1);
    const restW = new Int32Array(U + 1), restF = new Int32Array(U + 1), restMinW = new Int32Array(U + 1);
    restMinW[U] = 99;
    for (let i = U - 1; i >= 0; i--) {
      restAdj[i] = restAdj[i + 1] + Math.min(...optA[i]); restLoad[i] = restLoad[i + 1] + so[i] * fo[i]; restOwn[i] = restOwn[i + 1] + so[i] * so[i] * fo[i];
      restW[i] = restW[i + 1] + fo[i] * wo[i]; restF[i] = restF[i + 1] + fo[i]; restMinW[i] = Math.min(restMinW[i + 1], wo[i]);
    }
    const dayL = new Float64Array(D), dayN = new Int32Array(D), tmp = new Float64Array(D);
    let best = best0 == null ? Infinity : best0, bestPick = null, adjSoFar = 0;
    const pick = new Int32Array(U);
    // The cost of unit i's cheapest option given the days placed so far (Infinity: none fits); the
    // option is left in `cheapAt`.
    let cheapAt = -1;
    const cheapest = (i) => {
      const n = optM[i].length, k0 = fo[i], L = so[i], wu = wo[i], dd = optD[i], A = optA[i];
      let mn = Infinity;
      cheapAt = -1;
      for (let k = 0; k < n; k++) {
        let c = A[k];
        for (let q = 0; q < k0; q++) { const d = dd[k * k0 + q]; if (dayN[d] + wu > maxUnits) { c = Infinity; break; } c += 2 * L * dayL[d]; }
        if (c < mn - 1e-12) { mn = c; cheapAt = k; }
      }
      return mn;
    };
    // A first answer to beat, so most branches end early: each unit in turn takes its cheapest days.
    {
      let cost = 0, ok = true;
      const pk = new Int32Array(U);
      for (let i = 0; i < U && ok; i++) {
        cheapest(i);
        const at = cheapAt;
        if (at < 0) { ok = false; break; }
        for (let q = 0; q < fo[i]; q++) { const d = optD[i][at * fo[i] + q]; dayL[d] += so[i]; dayN[d] += wo[i]; }
        cost += optA[i][at]; pk[i] = optM[i][at];
      }
      for (let d = 0; d < D && ok; d++) if (!dayN[d]) ok = false;
      if (ok) {
        for (let d = 0; d < D; d++) cost += dayL[d] * dayL[d];
        if (cost < best - 1e-9) { best = cost; bestPick = pk; }
      }
      dayL.fill(0); dayN.fill(0);
    }
    // The work still to place spread as evenly as it could go over the days with room for it (the
    // lowest days raised together), plus the days already full.
    const water = (R, wmin) => {
      let n = 0, acc = 0;
      for (let d = 0; d < D; d++) { if (dayN[d] + wmin <= maxUnits) tmp[n++] = dayL[d]; else acc += dayL[d] * dayL[d]; }
      if (!n) return R > 1e-12 ? Infinity : acc;
      const t = tmp.subarray(0, n).sort();
      let lvl = t[0], rem = R;
      for (let k = 1; k <= n; k++) {
        const next = k < n ? t[k] : Infinity;
        const need = (next - lvl) * k;
        if (need >= rem) { lvl += rem / k; break; }
        rem -= need; lvl = next;
      }
      for (let d = 0; d < n; d++) { const v = Math.max(t[d], lvl); acc += v * v; }
      return acc;
    };
    const rec = (i) => {
      stats.nodes++;
      if (i === U) {
        let c = adjSoFar;
        for (let d = 0; d < D; d++) { if (!dayN[d]) return; c += dayL[d] * dayL[d]; }
        if (c < best - 1e-9) { best = c; bestPick = pick.slice(); }
        return;
      }
      // Still possible: the units left fit the room left on the days, and can reach every empty day.
      let room = 0, empty = 0, placed = 0, avail = 0;
      for (let d = 0; d < D; d++) {
        room += maxUnits - dayN[d]; if (!dayN[d]) empty++;
        placed += dayL[d] * dayL[d]; if (dayN[d] + restMinW[i] <= maxUnits) avail++;
      }
      if (restW[i] > room || empty > restF[i]) return;
      if (adjSoFar + restAdj[i] + water(restLoad[i], restMinW[i]) >= best - 1e-9) return;
      let lb = adjSoFar + placed + Math.max(restOwn[i], avail ? (restLoad[i] * restLoad[i]) / avail : 0);
      for (let j = i; j < U && lb < best; j++) lb += cheapest(j);
      if (lb >= best - 1e-9) return;
      // This unit's options, cheapest first given the days so far (ties by mask: deterministic).
      const M = optM[i], A = optA[i], dd = optD[i], cb = costB[i], ib = idxB[i], n = M.length, k0 = fo[i], L = so[i], wu = wo[i];
      for (let k = 0; k < n; k++) { let c = A[k]; for (let q = 0; q < k0; q++) c += 2 * L * dayL[dd[k * k0 + q]]; cb[k] = c; ib[k] = k; }
      for (let a = 1; a < n; a++) {
        const v = ib[a];
        let b = a - 1;
        while (b >= 0 && (cb[ib[b]] > cb[v] || (cb[ib[b]] === cb[v] && M[ib[b]] > M[v]))) { ib[b + 1] = ib[b]; b--; }
        ib[b + 1] = v;
      }
      for (let a = 0; a < n; a++) {
        const k = ib[a], m = M[k];
        if (same[i] && m < pick[i - 1]) continue;
        let ok = true;
        for (let q = 0; q < k0; q++) if (dayN[dd[k * k0 + q]] + wu > maxUnits) { ok = false; break; }
        if (!ok) continue;
        for (let q = 0; q < k0; q++) { const d = dd[k * k0 + q]; dayL[d] += L; dayN[d] += wu; }
        adjSoFar += A[k]; pick[i] = m;
        rec(i + 1);
        adjSoFar -= A[k];
        for (let q = 0; q < k0; q++) { const d = dd[k * k0 + q]; dayL[d] -= L; dayN[d] -= wu; }
      }
    };
    rec(0);
    if (!bestPick) return null;
    const days = new Array(D).fill(0);
    order.forEach((u, i) => { for (let d = 0; d < D; d++) if (bestPick[i] >> d & 1) days[d] |= 1 << u; });
    return { cost: best, days };
  }
  // How many splits there are for f: every day used, at most maxUnits a day (a count over days; w
  // weighs a unit's share of the day, arms counting twice in simpler sessions). A day takes a set
  // of units; the state is the day and how many days each unit still needs. Counts are kept.
  const countMemo = new Map();
  const CNT_VAL = new Float64Array(7 * 4096), CNT_AT = new Uint32Array(7 * 4096);
  const DEC = new Int32Array(64);
  for (let m = 0; m < 64; m++) for (let u = 0; u < 6; u++) if (m >> u & 1) DEC[m] += 1 << (2 * u);
  let cntEpoch = 0;
  function countSplits(f, D, maxUnits, w) {
    const ck = `${f.join()}|${D}|${maxUnits}|${w ? w.join() : ''}`;
    const hit = countMemo.get(ck);
    if (hit !== undefined) return hit;
    const WP = new Uint8Array(64);
    for (let m = 0; m < 64; m++) for (let u = 0; u < 6; u++) if (m >> u & 1) WP[m] += w ? w[u] : 1;
    const ep = ++cntEpoch;
    const rec = (d, r) => {
      if (d === D) return r === 0 ? 1 : 0;
      const key = d * 4096 + r;
      if (CNT_AT[key] === ep) return CNT_VAL[key];
      const left = D - d;
      let need = 0, avail = 0;
      for (let u = 0; u < 6; u++) { const ru = (r >> (2 * u)) & 3; if (ru === left) need |= 1 << u; if (ru) avail |= 1 << u; }
      let n = 0;
      if (WP[need] <= maxUnits) {
        const opt = avail & ~need;
        for (let s = opt; ; s = (s - 1) & opt) {
          const m = s | need;
          if (m && WP[m] <= maxUnits) n += rec(d + 1, r - DEC[m]);
          if (s === 0) break;
        }
      }
      CNT_AT[key] = ep; CNT_VAL[key] = n;
      return n;
    };
    let r0 = 0;
    for (let u = 0; u < 6; u++) r0 += Math.min(3, f[u]) << (2 * u);
    const n = rec(0, r0);
    if (countMemo.size > 2000) countMemo.clear();
    countMemo.set(ck, n);
    return n;
  }
  // The usual frequencies, and one step either way for the top goals and abs, one more for the
  // rest (1 to 3 a week, at most the days there are), keeping only what the time allows. The usual
  // one comes first, so it wins a tie.
  function variants(ctx) {
    const { D, maxUnits, feasible, tiers, rule } = ctx;
    const base = rule.map((x, i) => (feasible >> i & 1 ? clamp(x || 1, 1, Math.min(3, D)) : 0));
    const out = [base];
    UNITS.forEach((u, i) => {
      if (!base[i]) return;
      for (const dlt of tiers[i] <= 2 || u === 'abs' ? [-1, 1] : [1]) {
        const v = base.slice();
        v[i] += dlt;
        if (v[i] >= 1 && v[i] <= Math.min(3, D)) out.push(v);
      }
    });
    const W = ctx.w || UNITS.map(() => 1);
    return out.filter((v) => v.reduce((a, x, i) => a + x * W[i], 0) <= D * maxUnits);
  }
  const freqCost = (v, ctx) => v.reduce((a, x, i) => a + Math.abs(x - (ctx.rule[i] ? clamp(ctx.rule[i], 1, Math.min(3, ctx.D)) : 0)) * tierW(ctx.tiers[i]) * FREQ_COST, 0);

  // The fixed shapes people know, for a split tweak and for comparing (alternatives): full body,
  // upper and lower, push, pull and legs.
  function archetype(kind, ctx) {
    const { D, feasible } = ctx;
    const has = (u) => !!(feasible >> UNITS.indexOf(u) & 1);
    const bit = (u) => (has(u) ? 1 << UNITS.indexOf(u) : 0);
    if (kind === 'full_body') {
      const f = UNITS.map((u) => (!has(u) ? 0 : ['legs', 'chest', 'back'].includes(u) ? D : u === 'shoulders' ? Math.min(2, D) : Math.min(3, D)));
      const r = bestDays(f, Object.assign({}, ctx, { maxUnits: 7 }));
      return r && { days: r.days, cost: r.cost, considered: countSplits(f, D, 7, ctx.w), f };
    }
    // A shape is a list of day kinds, each a set of units; every arrangement of the kinds over the
    // days is tried.
    let kinds, counts;
    if (kind === 'ppl' && D >= 3) {
      kinds = [bit('chest') | bit('shoulders') | bit('arms'), bit('back') | bit('arms') | bit('abs'), bit('legs') | bit('abs')];
      counts = [Math.ceil(D / 3), Math.ceil((D - 1) / 3), Math.floor(D / 3)];
    } else {
      kinds = [bit('chest') | bit('back') | bit('shoulders') | bit('arms'), bit('legs') | bit('abs')];
      counts = [Math.ceil(D / 2), Math.floor(D / 2)];
    }
    const seqs = [];
    const rec = (d, left, acc) => {
      if (d === D) { seqs.push(acc.slice()); return; }
      for (let k = 0; k < kinds.length; k++) if (left[k] > 0) { left[k]--; acc.push(k); rec(d + 1, left, acc); acc.pop(); left[k]++; }
    };
    rec(0, counts.slice(), []);
    let best = null;
    for (const seq of seqs) {
      const days = seq.map((k) => kinds[k]);
      if (days.some((m) => !m)) continue;
      const c = maskCost(days, ctx);
      if (!best || c < best.cost - 1e-9) best = { days, cost: c };
    }
    return best && { days: best.days, cost: best.cost, considered: seqs.length, f: UNITS.map((u, i) => best.days.filter((m) => m >> i & 1).length) };
  }
  // The split cost of given day masks (as bestDays scores them).
  function maskCost(days, ctx) {
    const { D, offsets } = ctx;
    const consec = offsets.map((o, i) => i > 0 && o - offsets[i - 1] === 1);
    const wrap = D > 1 && offsets[0] + 7 - offsets[D - 1] === 1;
    const f = UNITS.map((u, i) => days.filter((m) => m >> i & 1).length);
    let c = 0;
    for (let d = 0; d < D; d++) {
      let L = 0;
      for (let u = 0; u < 6; u++) if (days[d] >> u & 1) L += ctx.load[u] / f[u] / ctx.free;
      c += L * L;
    }
    UNITS.forEach((u, i) => { let m = 0; days.forEach((x, d) => { if (x >> i & 1) m |= 1 << d; }); c += adjacency(m, D, consec, wrap, ADJ(i)); });
    return c;
  }
  // What kind of split a week turned out to be.
  function labelOf(days) {
    const bit = (u) => 1 << UNITS.indexOf(u);
    const up = bit('chest') | bit('back') | bit('shoulders') | bit('arms');
    if (days.every((m) => (m & bit('legs')) && (m & (bit('chest') | bit('back'))))) return 'full_body';
    const lower = days.filter((m) => m & bit('legs')), upper = days.filter((m) => !(m & bit('legs')));
    if (lower.length && upper.length && lower.every((m) => !(m & up)) && upper.every((m) => m & up)) {
      const push = bit('chest') | bit('shoulders'), pull = bit('back');
      if (days.length >= 3 && upper.every((m) => !(m & push) !== !(m & pull)) && upper.some((m) => m & push) && upper.some((m) => m & pull)) return 'ppl';
      return 'upper_lower';
    }
    return 'mixed';
  }
  const LABEL = { full_body: 'Full body', upper_lower: 'Upper and lower', ppl: 'Push, pull and legs', mixed: 'A mix of muscle groups each day' };

  // The split for a profile's week (its days, weekdays and minutes as given): which units go on
  // which days, in training order. Cached by everything it reads. Given the state, it's also kept
  // in it for the next launch (see keptOf), filed under the profile, its program and the split
  // asked for (everything the search and its trial weeks read): a launch that finds it there works
  // nothing else out, not even which units the kit can train.
  const splitMemo = lru(48);
  const keptMemo = lru(16); // profile key → { sp, h }, for the weeks of a calendar
  function split(p, prog, o, S) {
    const kc = o && o.raw ? null : keptOf(S, true);
    let pk = null, h = null;
    if (kc) {
      pk = JSON.stringify([(o && o.split) || null, B().planProfile(p), prog]);
      const seen = keptMemo.get(pk);
      if (seen) { if (!recall(kc.splits, seen.h)) remember(kc.splits, [seen.h], seen.sp, KEEP.splits); return seen.sp; }
      h = hash(pk);
      const k = recall(kc.splits, h);
      if (k && Array.isArray(k.days) && k.ctx && typeof k.ctx === 'object') {
        const sp = deepFreeze(k);
        stats.keptSplits++;
        splitMemo.set(JSON.stringify([k.ctx, k.kind]), sp);
        keptMemo.set(pk, { sp, h });
        return sp;
      }
    }
    const ctx = splitInputs(p, prog);
    const kind = (o && o.split) || ctx.split || 'auto';
    const key = JSON.stringify([ctx, kind]);
    const hit = splitMemo.get(key);
    if (hit) {
      if (kc) { remember(kc.splits, [h], hit, KEEP.splits); keptMemo.set(pk, { sp: hit, h }); }
      return hit;
    }
    const t0 = now();
    let res = null, considered = 0, parity = false;
    if (kind !== 'auto') {
      const r = archetype(kind, ctx);
      if (r) { res = r; considered = r.considered; }
    }
    if (!res) {
      let best = null;
      for (const f of variants(ctx)) {
        const fc = freqCost(f, ctx);
        considered += countSplits(f, ctx.D, ctx.maxUnits, ctx.w);
        const r = bestDays(f, ctx, best ? best.total - fc : Infinity);
        if (r && (!best || r.cost + fc < best.total - 1e-9)) best = { total: r.cost + fc, days: r.days, f, cost: r.cost };
      }
      if (!best && ctx.feasible) {
        // Not even once a week each fits the time (or the simpler sessions' exercises): every unit
        // once, more to a day than usual. The groups then take turns week by week (planWeek).
        parity = true;
        const ones = UNITS.map((u, i) => (ctx.feasible >> i & 1 ? 1 : 0));
        const W = ctx.w || UNITS.map(() => 1);
        const c2 = Object.assign({}, ctx, { maxUnits: Math.max(ctx.maxUnits, Math.ceil(ones.reduce((a, x, i) => a + x * W[i], 0) / ctx.D)) });
        considered += countSplits(ones, ctx.D, c2.maxUnits, ctx.w);
        const r = bestDays(ones, c2);
        if (r) best = { total: r.cost, days: r.days, f: ones, cost: r.cost };
      }
      if (best) res = best;
    }
    let out = shape(res, ctx, prog, { kind, considered, parity });
    // The best fit is the best whole plan: the split above and the classic shapes (full body, upper
    // and lower, push, pull and legs) are each planned as a week, sets and all, and the one that
    // scores best is kept. The split above stays unless another is clearly better (by 0.005: a
    // trial week's score moves about that much with small things, like the day a test falls on).
    if (kind === 'auto' && res && !parity && !(o && o.raw)) {
      const cands = [out];
      const W = ctx.w || UNITS.map(() => 1);
      const fits = (days) => days.every((m) => UNITS.reduce((a, u, i) => a + (m >> i & 1 ? W[i] : 0), 0) <= ctx.maxUnits);
      for (const k of ['full_body', 'upper_lower', 'ppl']) {
        const r = archetype(k, ctx);
        if (!r || !fits(r.days)) continue;
        considered += r.considered;
        const c = shape(r, ctx, prog, { kind: 'auto', considered: 0, parity: false });
        if (!cands.some((x) => JSON.stringify(x.days) === JSON.stringify(c.days))) cands.push(c);
      }
      const scored = cands.length > 1 ? cands.map((c) => ({ c, sc: trial(p, c) })) : [];
      let best = scored.length && scored[0].sc != null ? scored[0] : null;
      for (const x of scored.slice(1)) if (x.sc != null && (!best || x.sc > best.sc + (best === scored[0] ? 0.005 : 1e-9))) best = x;
      if (best) out = best.c;
      out.considered = Math.max(1, Math.round(considered));
      out.scores = scored.map((x) => ({ label: x.c.label, score: x.sc }));
    }
    stats.splits++; stats.splitMs += now() - t0;
    deepFreeze(out);
    if (kc) { remember(kc.splits, [h], out, KEEP.splits); keptMemo.set(pk, { sp: out, h }); }
    return splitMemo.set(key, out);
  }
  // A split's days as the rest of the engine reads them: each day's units in training order.
  function shape(res, ctx, prog, o) {
    const prioOf = (u) => (u === 'abs' ? 9 : unitTier(prog, u));
    const days = (res ? res.days : []).map((m, i) => ({
      idx: i, offset: ctx.offsets[i],
      units: UNITS.filter((u, k) => m >> k & 1).sort((a, b2) => prioOf(a) - prioOf(b2) || ORDER.indexOf(a) - ORDER.indexOf(b2)),
    })).filter((d) => d.units.length);
    days.forEach((d, i) => { d.idx = i; });
    return { days, label: days.length ? labelOf(res.days) : 'mixed', kind: o.kind, considered: Math.max(1, Math.round(o.considered)), parity: o.parity, f: res ? res.f : [], ctx };
  }
  // A candidate split planned as a full week for someone new with these answers (the plan's own
  // score, see planScore); null if it can't be planned.
  function trial(p, cand) {
    const b = B();
    try {
      const day = p.startDay != null ? p.startDay : b.weekStart(20000);
      const S0 = b.newState(Object.assign({}, p), null, day);
      S0.complexity = p.complexity || 0;
      return b.op(() => planWeek(S0, b.weekStart(day), normPhase({ mult: 1 }), cand)).score;
    } catch (e) {
      return null;
    }
  }
  // brain.templateFor's v2 answer: [{ idx, offset, units }] (S: the state it's for, if any).
  function template(p, prog, S) { return split(p, prog, null, S).days; }
  const now = () => (G.performance && G.performance.now ? G.performance.now() : Date.now());

  /* ================================================================== tweaks */
  // What a plan tweak can change (the contract with the AI review): sets per group (-3 to +3 a
  // week), a ladder's move swapped, the split, rest, finishers, cool-downs, and moves left out.
  const TWEAKS = {
    sets: { groups: GROUPS.slice(), min: -3, max: 3 },
    swaps: { families: Object.keys(HOME_FAMS).flatMap((u) => HOME_FAMS[u]).concat(Object.keys(GYM_FAMS).flatMap((u) => GYM_FAMS[u])) },
    split: ['auto', 'full_body', 'upper_lower', 'ppl'],
    rest: ['auto', 60, 90, 120],
    finisher: ['auto', 'on', 'off'],
    mobility: ['auto', 'on', 'off'],
    avoid: { max: 20 },
  };
  // Any tweak object into one the engine reads: unknown fields and values are dropped.
  function normTweaks(t) {
    const x = t && typeof t === 'object' ? t : {};
    const out = { sets: {}, swaps: {}, split: 'auto', rest: 'auto', finisher: 'auto', mobility: 'auto', avoid: [] };
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    if (x.sets && typeof x.sets === 'object') for (const g of GROUPS) if (own(x.sets, g)) { const v = Math.round(Number(x.sets[g])); if (v && Number.isFinite(v)) out.sets[g] = clamp(v, TWEAKS.sets.min, TWEAKS.sets.max); }
    const moves = M() && M().MOVES;
    if (x.swaps && typeof x.swaps === 'object' && moves) for (const f of TWEAKS.swaps.families) if (own(x.swaps, f) && typeof x.swaps[f] === 'string' && moves[x.swaps[f]]) out.swaps[f] = x.swaps[f];
    if (TWEAKS.split.includes(x.split)) out.split = x.split;
    const rest = x.rest === 'auto' ? 'auto' : Number(x.rest);
    if (TWEAKS.rest.includes(rest)) out.rest = rest;
    if (TWEAKS.finisher.includes(x.finisher)) out.finisher = x.finisher;
    if (TWEAKS.mobility.includes(x.mobility)) out.mobility = x.mobility;
    if (Array.isArray(x.avoid) && moves) out.avoid = [...new Set(x.avoid.filter((id) => typeof id === 'string' && moves[id]))].slice(0, TWEAKS.avoid.max);
    return out;
  }
  const isDefault = (t) => !Object.keys(t.sets).length && !Object.keys(t.swaps).length && t.split === 'auto' && t.rest === 'auto' && t.finisher === 'auto' && t.mobility === 'auto' && !t.avoid.length;

  /* ================================================================== the week plan */
  // weekPlan(S, ws): the week's split and each day's sets, worked out once for each state (cached
  // by its stamp; read-only). o: { phase (the calendar's, or a forced one), stamp }.
  // Sets are given out in three passes, each a greedy choice of the best next set by what it's worth
  // per minute of the day's time:
  //   1. every group to 2 effective sets, then to its weekly floor (a set of a bigger move that also
  //      works a group counts half for it, so a push-up set helps the triceps and shoulders);
  //   2. every group toward its weekly target (S.vol, scaled for the week's phase), then on a full
  //      week toward a boosted target when there's time (up to 50% more, 25% for beginners, never
  //      past the group's cap), the top goals weighing most (3, 2 and 1, plus a half for a focus);
  //   3. a pass that evens out a group's sets over its days.
  // Weeks before S.engineFrom keep 1.5's split and sets (brain.legacyGroupSets).
  const weekMemo = new WeakMap();
  function weekPlan(S, ws, o) {
    const b = B();
    const opt = o || {};
    const phase = normPhase(opt.phase || phaseOf(S, ws));
    const stamp = opt.stamp || b.stateStamp(S);
    const slot = ws + '|' + JSON.stringify(phase) + '|';
    const key = slot + stamp;
    let m = weekMemo.get(S);
    const hit = m && m.get(key);
    if (hit) return hit;
    if (!m) weekMemo.set(S, (m = lru(12)));
    // What the last launch kept (see keptOf): the plan for this week as the state is now, or for a
    // week that's over, the plan it last had while its workouts are as they were then (each plan is
    // also filed under those). (Not a lighter week's normal one, which only planning that week reads.)
    const kc = phase.ref ? null : keptOf(S, true);
    const h = kc ? hash(key) : null;
    const past = kc ? hash('past|' + slot + b.weekLog(S, ws)) : null;
    let k = kc ? recall(kc.weeks, h) : undefined;
    if (!k && kc && ws < thisWeek(S)) k = recall(kc.weeks, past);
    if (k && Array.isArray(k.days) && k.perGroup && typeof k.score === 'number') { stats.keptWeeks++; return m.set(key, deepFreeze(k)); }
    const t0 = now();
    const out = deepFreeze(b.op(() => planWeek(S, ws, phase)));
    stats.weeks++; stats.weekMs += now() - t0;
    // Planning can start a ladder's progress (a gym exercise used for the first time); the plan is
    // the same either way, so it's kept for the state as it is now too.
    const after = b.stateStamp(S);
    if (after !== stamp) m.set(slot + after, out);
    if (kc) remember(kc.weeks, after !== stamp ? [h, hash(slot + after), past] : [h, past], out, KEEP.weeks, slot, ws);
    return m.set(key, out);
  }
  // The week the person is in now (by the phone's clock, the day rolling over at their hour).
  function thisWeek(S) {
    const b = B();
    const prefs = (S.profile && S.profile.prefs) || {};
    return b.weekStart(b.dayOf(Date.now(), prefs.rollHour != null ? prefs.rollHour : 4));
  }
  const normPhase = (ph) => Object.assign({ mult: ph && ph.mult != null ? ph.mult : 1, onramp: !!(ph && ph.onramp), deload: !!(ph && ph.deload), idle: !!(ph && ph.idle) }, ph && ph.ref ? { ref: true } : {});
  // A week's phase as the calendar has it (on-ramp, deload or a full week).
  function phaseOf(S, ws) {
    const w = B().calendar(S, ws).weeks[ws];
    return w ? w.phase : { mult: 1, onramp: false, deload: false, idle: false };
  }
  // The plan for one template day of a week (brain.buildSession builds it).
  function dayPlan(S, ws, tplIdx, o) {
    const wp = weekPlan(S, ws, o);
    return wp.days.find((x) => x.tpl === tplIdx) || wp.days[0] || EMPTY_DAY;
  }
  const EMPTY_DAY = Object.freeze({ tpl: 0, idx: 0, units: [], tplLen: 0, occ: {}, groupSets: {}, base: {}, protect: {}, room: {}, spare: {}, short: {}, covered: {}, slack: {}, weights: {}, finisher: false });

  // n shared out over slots in proportion to their weights (largest remainders, earlier slots first
  // on a tie); never more than a slot's cap when caps are given.
  function shareOut(n, weights, caps) {
    const W = weights.reduce((a, w) => a + w, 0);
    const out = weights.map(() => 0);
    if (n <= 0 || W <= 0) return out;
    const raw = weights.map((w) => (n * w) / W);
    let left = n;
    raw.forEach((r, i) => { out[i] = Math.min(Math.floor(r), caps ? caps[i] : Infinity); left -= out[i]; });
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
    for (let guard = 0; left > 0 && guard < 4; guard++) {
      for (const i of order) { if (left <= 0) break; if (weights[i] > 0 && (!caps || out[i] < caps[i])) { out[i]++; left--; } }
    }
    return out;
  }

  // What a day's sets cost in time, measured on the day's session built with a nominal number of
  // sets per group: the time that isn't sets (getting started, warm-up, balance practice, tests,
  // catch-up sets, a planned finisher or cool-down), each group's time for one more set, the
  // exercises it uses and the groups those also work, and how many sets it can take (six for each
  // different exercise it can use, ten in all).
  function measureDay(S, d, G, phase) {
    measureOn(S, d, G, phase);
    // Nothing in the day's units can be done (every move ruled out for now, a sore shoulder on a
    // chest day, say): the day trains whatever can be, rather than turning into a light day.
    if (!Object.keys(d.per).length) {
      const all = UNITS.slice().sort((a, x) => ORDER.indexOf(a) - ORDER.indexOf(x));
      const was = d.units;
      d.units = all;
      measureOn(S, d, G, phase);
      d.fallback = Object.keys(d.per).length ? was : null;
      if (!d.fallback) { d.units = was; measureOn(S, d, G, phase); }
    }
  }
  // What a set of each group does for the others on a day, from the exercises its sets make there
  // (the half-credit a bigger move gives the groups it also works).
  function indOf(S, d, gs) {
    const b = B();
    const out = {};
    if (!Object.keys(gs).length) return out;
    const units = d.units.concat(UNITS.filter((u) => !d.units.includes(u) && UNIT_GROUPS[u].some((g) => gs[g] > 0)));
    const slots = b.slotsOfDay(S, d.day, { idx: d.idx, units, tplLen: d.tplLen, occ: d.occ, legIdx: d.legIdx, groupSets: gs });
    const acc = {};
    for (const sl of slots) {
      const it = b.itemFor(S, sl, d.day);
      const m = it && M().MOVES[it.moveId];
      if (!m) continue;
      const a = acc[sl.group] || (acc[sl.group] = { n: 0, ind: {} });
      a.n += sl.sets;
      for (const h of new Set((m.muscles || []).map((mu) => b.MUSCLE_GROUP[mu]).filter((g) => g && g !== sl.group))) a.ind[h] = (a.ind[h] || 0) + 0.5 * sl.sets;
    }
    for (const [g, a] of Object.entries(acc)) { out[g] = {}; for (const [h, v] of Object.entries(a.ind)) out[g][h] = v / Math.max(1, a.n); }
    return out;
  }
  // A day's sets as the session they make (brain.realize, the parts round the sets shrunk as the fit
  // would under 15 minutes): each group's time a set there (its exercises' share of the session,
  // setting up included), the time outside the sets, the catch-up sets, and what a set of each
  // group does for the others (as indOf).
  function realDay(S, d, gs, phase) {
    const b = B();
    const prog = b.programFor(S.profile);
    // The day's units as its plan will give them (planWeek): a day that trains whatever it can has
    // the units of the groups it got sets for.
    const withSets = (u) => UNIT_GROUPS[u].some((g) => gs[g] > 0);
    const units = d.fallback ? d.units.filter(withSets) : d.units.concat(UNITS.filter((u) => !d.units.includes(u) && withSets(u)));
    const dp = { idx: d.idx, units, planUnits: d.planUnits, tplLen: d.tplLen, occ: d.occ, legIdx: d.legIdx, groupSets: gs };
    const { session } = b.realize(S, d.day, dp, { noReadiness: true, phase, finisher: d.finisher });
    session.tests = session.tests.filter((t) => d.tests && d.tests[t.test]);
    if (d.noExtras) session.extras = [];
    if (d.budget < COMPACT || d.compact) compact(session, d.budget);
    // From 15 minutes the fit gives a session of one exercise a second (ensureMain): a set split off
    // into the group's other exercise, which changes what the sets do for other groups, or else a
    // set of another group, whose time is kept for it (as the time outside the day's sets).
    const maxItems = S.complexity > 0 ? (S.complexity === 1 ? 5 : 4) : 0;
    if (d.budget >= COMPACT && session.items.filter(isMain).length === 1 && !splitOne(S, session, { b, maxItems }) && (!maxItems || session.items.length < maxItems)) {
      const have = new Set(session.items.map((it) => it.moveId));
      const own = session.items.find(isMain).group;
      for (const g of GROUPS.filter((q) => q !== own).sort((a, c) => tierW(prog.tiers[c] || 3) - tierW(prog.tiers[a] || 3) || GROUPS.indexOf(a) - GROUPS.indexOf(c))) {
        const f = famsOfGroup(S, session, g, 1)[0];
        const it = f && b.itemFor(S, { fam: f, sets: 1, group: g }, d.day);
        if (it && !have.has(it.moveId)) {
          // (When the day has time for it beside a set of its own; the day's sets give it room.)
          const one = session.items.map((x) => (isMain(x) ? Object.assign({}, x, { sets: 1 }) : x));
          if (b.estimate(S, Object.assign({}, session, { items: one.concat([it]) })) <= d.budget + OVER) session.items.push(it);
          break;
        }
      }
    }
    const mainOf = (it) => isMain(it) && UNIT_OF[it.group] && gs[it.group] > 0;
    const est = (items) => b.estimate(S, Object.assign({}, session, { items }));
    const total = est(session.items);
    const fixed = est(session.items.filter((it) => !mainOf(it)));
    const acc = {};
    for (const it of session.items) {
      if (!mainOf(it)) continue;
      const a = acc[it.group] || (acc[it.group] = { n: 0, ind: {} });
      a.n += it.sets;
      const m = M().MOVES[it.moveId];
      for (const h of new Set(((m && m.muscles) || []).map((mu) => b.MUSCLE_GROUP[mu]).filter((g) => g && g !== it.group))) a.ind[h] = (a.ind[h] || 0) + 0.5 * it.sets;
    }
    // Each group's share: the time its exercises add to the session, scaled so the shares add up
    // to the time of all the sets together (supersets save time only while both halves are there).
    const raw = {};
    for (const g of Object.keys(acc)) raw[g] = Math.max(0, total - est(session.items.filter((it) => !(mainOf(it) && it.group === g))));
    const sum = Object.values(raw).reduce((a, v) => a + v, 0);
    const scale = sum > 0 ? Math.max(0, total - fixed) / sum : 0;
    const per = {}, ind = {}, extras = {};
    for (const [g, a] of Object.entries(acc)) {
      if (gs[g] > 0 && scale > 0) per[g] = Math.max(0.4, (raw[g] * scale) / gs[g]);
      ind[g] = {};
      for (const [h, v] of Object.entries(a.ind)) ind[g][h] = v / Math.max(1, a.n);
    }
    for (const x of session.extras || []) extras[x.group] = (extras[x.group] || 0) + 1;
    return { per, ind, extras, fixed };
  }
  // Every group measured on the day, its own units' groups remembered (d.own): when the split
  // leaves a group no time for its minimum, it can join another day (planWeek).
  function measureSpill(S, d, G, phase) {
    if (d.fallback || d.spill) return;
    const was = d.units;
    d.own = new Set(was.flatMap((u) => UNIT_GROUPS[u]));
    // The day as it is (its time outside the sets, its own groups), plus what each other group
    // would cost there.
    const mine = { fixed: d.fixed, extras: d.extras, skills: d.skills, per: d.per, ind: d.ind, fams: d.fams, maxSets: d.maxSets };
    d.units = was.concat(UNITS.filter((u) => !was.includes(u)).sort((a, x) => ORDER.indexOf(a) - ORDER.indexOf(x)));
    measureOn(S, d, G, phase);
    d.units = was;
    for (const k of ['per', 'ind', 'fams', 'maxSets']) d[k] = Object.assign({}, d[k], mine[k]);
    Object.assign(d, { fixed: mine.fixed, extras: mine.extras, skills: mine.skills, spill: true });
  }
  function measureOn(S, d, G, phase) {
    const b = B();
    const nominal = {};
    for (const u of d.units) for (const g of UNIT_GROUPS[u]) nominal[g] = clamp(Math.round(G[g].T / Math.max(1, d.freq[u] || 1)), 2, 6);
    const dp = { idx: d.idx, units: d.units, planUnits: d.planUnits, tplLen: d.tplLen, occ: d.occ, legIdx: d.legIdx, groupSets: nominal };
    const { session } = b.realize(S, d.day, dp, { noReadiness: true, phase, finisher: d.finisher });
    session.tests = session.tests.filter((t) => d.tests && d.tests[t.test]);
    if (d.noExtras) session.extras = [];
    if (d.budget < COMPACT || d.compact) compact(session, d.budget);
    const est = (s) => b.estimate(S, s);
    const all = est(session);
    d.fixed = est(Object.assign({}, session, { items: session.items.filter((it) => it.skill) }));
    d.per = {}; d.ind = {}; d.fams = {}; d.maxSets = {}; d.extras = {};
    const acc = {};
    for (const it of session.items) {
      if (it.skill || !UNIT_OF[it.group]) continue;
      const a = acc[it.group] || (acc[it.group] = { t: 0, n: 0, ind: {}, fams: [] });
      it.sets++;
      const dt = est(session) - all;
      it.sets--;
      a.t += dt * it.sets; a.n += it.sets;
      const m = M().MOVES[it.moveId];
      for (const h of new Set(((m && m.muscles) || []).map((mu) => b.MUSCLE_GROUP[mu]).filter((g) => g && g !== it.group))) a.ind[h] = (a.ind[h] || 0) + 0.5 * it.sets;
      if (!a.fams.includes(it.fam)) a.fams.push(it.fam);
    }
    for (const [g, a] of Object.entries(acc)) {
      d.per[g] = Math.max(0.4, a.t / Math.max(1, a.n));
      d.ind[g] = {};
      for (const [h, v] of Object.entries(a.ind)) d.ind[g][h] = v / Math.max(1, a.n);
      d.fams[g] = a.fams;
    }
    for (const x of session.extras || []) d.extras[x.group] = (d.extras[x.group] || 0) + 1;
    d.skills = session.items.filter((it) => it.skill).length;
    const wide = {};
    for (const g of Object.keys(nominal)) wide[g] = 10;
    const nF = {};
    for (const sl of b.slotsOfDay(S, d.day, Object.assign({}, dp, { groupSets: wide }))) (nF[sl.group] = nF[sl.group] || new Set()).add(sl.fam);
    for (const g of Object.keys(d.per)) d.maxSets[g] = Math.min(10, 6 * Math.max(1, nF[g] ? nF[g].size : 1));
  }

  // Gives out a week's sets (see weekPlan): returns each day's sets per group (x), the week's per
  // group (X), and whether every group could get 2 effective sets (short: not). legacySets(k), for
  // weeks before the engine: 1.5's sets for day k instead.
  function allocate(S, ws, days, G, legacySets) {
    // Simpler sessions: a day's groups fit its exercises (one each, after balance practice).
    const maxItems = S.complexity > 0 ? (S.complexity === 1 ? 5 : 4) : 0;
    for (const d of days) d.groupCap = maxItems ? Math.max(1, maxItems - d.skills) : Infinity;
    const D = days.length;
    const x = days.map(() => ({}));
    const X = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    const left = days.map((d) => (d.done ? 0 : d.budget - d.fixed));
    // A day already trained keeps the sets that were done (catch-up sets included); the rest of the
    // week is planned round it.
    days.forEach((d, k) => { if (d.done) for (const [g, n] of Object.entries(d.done)) { x[k][g] = n; X[g] += n; } });
    const extrasW = {};
    for (const d of days) if (!d.done) for (const [g, n] of Object.entries(d.extras)) extrasW[g] = (extrasW[g] || 0) + n;
    const capEff = (g) => Math.max(0, G[g].cap - (extrasW[g] || 0));
    const trainable = GROUPS.filter((g) => days.some((d) => d.per[g] != null));
    const add = (k, g, n) => { x[k][g] = (x[k][g] || 0) + n; X[g] += n; left[k] -= n * days[k].per[g]; };
    const groupsOn = (k) => Object.keys(x[k]).filter((g) => x[k][g] > 0).length;
    const canAdd = (k, g, lim) => {
      const d = days[k];
      return !d.done && d.per[g] != null && (x[k][g] || 0) < d.maxSets[g] && X[g] < lim && d.per[g] <= left[k] + 1e-9 && ((x[k][g] || 0) > 0 || groupsOn(k) < d.groupCap);
    };
    const effective = () => {
      const e = Object.fromEntries(GROUPS.map((g) => [g, X[g] + (extrasW[g] || 0)]));
      days.forEach((d, k) => { for (const [h, n] of Object.entries(x[k])) for (const [g, v] of Object.entries(d.ind[h] || {})) e[g] += n * v; });
      return e;
    };
    // A group of the day's own units (not one joining it for its minimum, see measureSpill).
    const own = (k, g) => !days[k].own || days[k].own.has(g);
    let parity = false, short = false;
    if (legacySets) {
      // 1.5's sets for each day, as the week was planned then (the fit still brings the sessions
      // within their time and fills them).
      days.forEach((d, k) => { for (const [g, n] of Object.entries(legacySets(k))) if (n > 0 && d.per[g] != null) add(k, g, n); });
      return { x, X, extrasW, capEff, trainable, effective, parity, short, own };
    }
    const better = (a, c) => !a || c.sc > a.sc + 1e-9 || (Math.abs(c.sc - a.sc) <= 1e-9 && (c.tie < a.tie - 1e-9 || (Math.abs(c.tie - a.tie) <= 1e-9 && (c.k < a.k || (c.k === a.k && GROUPS.indexOf(c.g) < GROUPS.indexOf(a.g))))));
    // Pass 1: floors (see below for when there isn't time for every group's).
    const floorPass = (goal) => {
      for (let guard = 0; guard < 500; guard++) {
        const e = effective();
        const need = {};
        let any = false;
        for (const g of trainable) { const dl = goal(g) - e[g]; if (dl > 1e-9) { need[g] = dl; any = true; } }
        if (!any) return true;
        let best = null;
        for (let k = 0; k < D; k++) {
          const d = days[k];
          for (const h of Object.keys(d.per)) {
            if (!canAdd(k, h, capEff(h))) continue;
            // A group joins a day of other groups only when none of its own days can take the set.
            if (!own(k, h) && days.some((d2, k2) => k2 !== k && own(k2, h) && canAdd(k2, h, capEff(h)))) continue;
            let v = 0;
            for (const [g, dl] of Object.entries(need)) {
              const gain = g === h ? 1 : d.ind[h][g] || 0;
              if (gain > 0) v += G[g].w * Math.min(dl, gain);
            }
            if (v <= 1e-9) continue;
            if (!own(k, h)) v *= 0.5;
            const c = { k, g: h, sc: v / d.per[h], tie: -left[k] };
            if (better(best, c)) best = c;
          }
        }
        if (!best) return false;
        add(best.k, best.g, 1);
      }
      return false;
    };
    // When the greedy pass runs out of time with a group still short, a set it gave early may no
    // longer be needed (a bigger move later also worked that group): swap such a set on the same day
    // for one of a group that's short, as long as no group drops below its goal. Or a set can move
    // to another day it fits on, to make room for the short group's.
    const repair = (goal) => {
      for (let guard = 0; guard < 60; guard++) {
        const e = effective();
        const shortOf = (ee) => trainable.reduce((a, g) => a + Math.max(0, goal(g) - ee[g]), 0);
        const now = shortOf(e);
        if (now <= 1e-9) return true;
        let best = null;
        for (let k = 0; k < D; k++) {
          const d = days[k];
          if (d.done) continue;
          for (const g of Object.keys(x[k])) {
            if (!(x[k][g] > 0)) continue;
            for (const h of Object.keys(d.per)) {
              if (h === g || e[h] >= goal(h) - 1e-9 || (x[k][h] || 0) >= d.maxSets[h] || X[h] >= capEff(h)) continue;
              if (!own(k, h) && !(x[k][h] > 0) && days.some((d2, k2) => own(k2, h) && d2.per[h] != null && (x[k2][h] || 0) < d2.maxSets[h] && d2.per[h] <= left[k2] + 1e-9)) continue;
              if (d.per[h] > left[k] + d.per[g] + 1e-9 || (!(x[k][h] > 0) && x[k][g] > 1 && groupsOn(k) >= d.groupCap)) continue;
              add(k, g, -1); add(k, h, 1);
              const e2 = effective();
              const ok = trainable.every((q) => e2[q] >= Math.min(goal(q), e[q]) - 1e-9);
              const after = shortOf(e2);
              add(k, h, -1); add(k, g, 1);
              if (ok && after < now - 1e-9 && (!best || after < best.after - 1e-9)) best = { k, g, h, after };
            }
          }
        }
        for (let k = 0; k < D && !best; k++) {
          const d = days[k];
          if (d.done) continue;
          for (const g of Object.keys(x[k])) {
            if (!(x[k][g] > 0)) continue;
            for (let k2 = 0; k2 < D; k2++) {
              const d2 = days[k2];
              if (k2 === k || d2.done || d2.per[g] == null || (x[k2][g] || 0) >= d2.maxSets[g] || d2.per[g] > left[k2] + 1e-9 || (!(x[k2][g] > 0) && groupsOn(k2) >= d2.groupCap)) continue;
              for (const h of Object.keys(d.per)) {
                if (h === g || e[h] >= goal(h) - 1e-9 || (x[k][h] || 0) >= d.maxSets[h] || X[h] >= capEff(h)) continue;
                if (d.per[h] > left[k] + d.per[g] + 1e-9 || (!(x[k][h] > 0) && x[k][g] > 1 && groupsOn(k) >= d.groupCap)) continue;
                add(k, g, -1); add(k2, g, 1); add(k, h, 1);
                const e2 = effective();
                const ok = trainable.every((q) => e2[q] >= Math.min(goal(q), e[q]) - 1e-9);
                const after = shortOf(e2);
                add(k, h, -1); add(k2, g, -1); add(k, g, 1);
                if (ok && after < now - 1e-9 && (!best || after < best.after - 1e-9)) best = { k, g, h, after, k2 };
              }
            }
          }
        }
        if (!best) return false;
        add(best.k, best.g, -1); add(best.k, best.h, 1);
        if (best.k2 != null) add(best.k2, best.g, 1);
        if (!(x[best.k][best.g] > 0)) delete x[best.k][best.g];
        floorPass(goal);
      }
      return false;
    };
    const two = (g) => Math.min(2, G[g].floor);
    if (!floorPass(two) && !repair(two)) {
      // Not enough time for 2 sets of every group: they take turns week by week. The groups last
      // week's workouts left short of 2 sets come first (what they trained waits its turn), then
      // the others with the time that's left; so two weeks in a row train them all, as far as
      // their time goes. (With no workouts last week, the week is simply the best it can be.)
      short = true;
      parity = true;
      if (GROUPS.some((g) => G[g].prev > 0)) {
        days.forEach((d, k) => { if (d.done) return; for (const g of Object.keys(x[k])) { left[k] += x[k][g] * d.per[g]; X[g] -= x[k][g]; } x[k] = {}; });
        const turn = (g) => Math.max(0, two(g) - G[g].prev);
        if (!floorPass(turn)) repair(turn);
        if (!floorPass(two)) repair(two);
      }
    }
    const floorsMet = floorPass((g) => G[g].floor) || repair((g) => G[g].floor);
    // Every group with a target gets a set of its own each week where the time allows, even when
    // bigger moves already bring it to its minimum: a muscle trained only through other exercises
    // for weeks on end falls behind (the more important groups first, on their own days first).
    for (const g of trainable.slice().sort((a, c) => G[c].w - G[a].w || GROUPS.indexOf(a) - GROUPS.indexOf(c))) {
      if (X[g] > 0 || G[g].T < 1) continue;
      let best = null;
      for (let k = 0; k < D; k++) {
        if (!canAdd(k, g, capEff(g))) continue;
        const c = { k, sc: (own(k, g) ? 1000 : 0) + left[k] - days[k].per[g] };
        if (!best || c.sc > best.sc + 1e-9) best = c;
      }
      if (best) add(best.k, g, 1);
    }
    // From 15 minutes a session has two exercises at least (the fit's ensureMain): a day whose sets
    // make one exercise gets a set of another group (one short of its minimum first, then the more
    // important), so the plan counts it; a set of the day's own makes room for it if need be.
    for (let k = 0; k < D; k++) {
      const d = days[k];
      if (d.done || d.budget < COMPACT) continue;
      for (let guard = 0; guard < 2; guard++) {
        const on = Object.keys(x[k]).filter((g) => x[k][g] > 0);
        if (on.length > 1 || (on.length === 1 && x[k][on[0]] >= 2 && d.maxSets[on[0]] > 6)) break;
        const pick = () => {
          const e = effective();
          const rank = (g) => (e[g] < two(g) - 1e-9 ? 100 : 0) + G[g].w;
          return Object.keys(d.per).filter((g) => !on.includes(g) && (x[k][g] || 0) < d.maxSets[g] && X[g] < capEff(g) && groupsOn(k) < d.groupCap && d.per[g] <= left[k] + 1e-9)
            .sort((a, c) => rank(c) - rank(a) || GROUPS.indexOf(a) - GROUPS.indexOf(c))[0];
        };
        let g = pick();
        // (A set of the day's own group only while it keeps its minimum without it.)
        if (!g && on.length === 1 && x[k][on[0]] >= 2 && effective()[on[0]] - 1 >= two(on[0]) - 1e-9) {
          add(k, on[0], -1);
          g = pick();
          if (!g) { add(k, on[0], 1); break; }
        }
        if (!g) break;
        add(k, g, 1);
      }
    }
    // Pass 2: targets, then boosted targets.
    for (let guard = 0; guard < 2000; guard++) {
      let best = null;
      for (let k = 0; k < D; k++) {
        const d = days[k];
        for (const g of Object.keys(d.per)) {
          if (!own(k, g) || !canAdd(k, g, Math.min(G[g].B, capEff(g)))) continue;
          const slope = X[g] < G[g].T ? 1 : 0.35;
          // Each more set for a muscle in one session does a little less (by six, about two thirds
          // as much), so a group's sets spread over its days: twice a week builds more than the same
          // sets once (Schoenfeld et al. 2016).
          const v = (G[g].w * slope) / (1 + 0.08 * (x[k][g] || 0));
          const c = { k, g, sc: v / d.per[g], tie: (x[k][g] || 0) - left[k] / 100 };
          if (better(best, c)) best = c;
        }
      }
      if (!best) break;
      add(best.k, best.g, 1);
    }
    // Pass 3: even out each group's sets over its days, where the time allows.
    for (const g of trainable) {
      for (let guard = 0; guard < 20; guard++) {
        const ks = days.filter((d) => !d.done && d.per[g] != null && own(d.k, g)).map((d) => d.k);
        if (ks.length < 2) break;
        let hi = ks[0];
        for (const k of ks) if ((x[k][g] || 0) > (x[hi][g] || 0)) hi = k;
        const open = ks.filter((k) => k !== hi && (x[k][g] || 0) < days[k].maxSets[g] && days[k].per[g] <= left[k] + 1e-9 && ((x[k][g] || 0) > 0 || groupsOn(k) < days[k].groupCap));
        let lo = -1;
        for (const k of open) if (lo < 0 || (x[k][g] || 0) < (x[lo][g] || 0)) lo = k;
        if (lo < 0 || (x[hi][g] || 0) - (x[lo][g] || 0) < 2) break;
        add(hi, g, -1); add(lo, g, 1);
      }
    }
    return { x, X, extrasW, capEff, trainable, effective, parity, short, own, under: !floorsMet };
  }

  function planWeek(S, ws, phase, forced) {
    const b = B();
    const p = S.profile;
    const prog = b.programFor(p);
    const tw = tweaksOf(p);
    const legacy = b.legacyWeek(S, ws);
    const wi = b.weekInputs(S, ws);
    const sp = legacy ? null : forced || split(wi.p, wi.prog, null, S);
    const tpl = legacy ? b.templateV1(wi.p, wi.prog) : sp.days;
    const full = !phase.onramp && !phase.deload && phase.mult >= 1 && !phase.ref;
    const boost = full ? (prog.level === 0 ? 0.25 : 0.5) : 0;
    // A lighter week (easing in, a deload, back after a break) is lighter than a normal week really
    // is: its share of the sets a normal week's time holds, not of a target that time couldn't. (How
    // much of its targets the normal week holds in all, so one group's share doesn't swing with how
    // a tight week happens to share its last few minutes.)
    const ref = !legacy && phase.mult < 1 ? weekPlan(S, ws, { phase: { mult: 1, onramp: false, deload: false, idle: false, ref: true } }) : null;
    const refGroups = ref ? GROUPS.filter((g) => ref.perGroup[g].trainable) : [];
    const refFill = ref ? Math.min(1, refGroups.reduce((a, g) => a + ref.perGroup[g].aim, 0) / Math.max(1, refGroups.reduce((a, g) => a + ref.perGroup[g].target, 0))) : 1;
    const focusGroups = new Set((prog.focus || []).map((mu) => b.MUSCLE_GROUP[mu]).filter(Boolean));
    // Each group's week: the target, the boosted target, the floor (effective sets), the cap, and
    // how much a set of it is worth.
    const G = {};
    for (const g of GROUPS) {
      const cap = prog.cap[g];
      const vol = clamp((S.vol && S.vol[g] != null ? S.vol[g] : prog.start[g]) + (tw.sets[g] || 0), 1, cap);
      let T = Math.min(cap, Math.round(vol * phase.mult));
      if (ref && ref.perGroup[g].trainable) T = Math.min(T, Math.max(1, Math.round(ref.perGroup[g].target * refFill * phase.mult)));
      G[g] = {
        T, B: full ? Math.max(T, Math.min(cap, Math.round(vol * (1 + boost)))) : T, cap,
        floor: Math.min(cap, Math.max(2, Math.round(prog.floor[g] * phase.mult))),
        w: tierW(prog.tiers[g]) + (focusGroups.has(g) ? 0.5 : 0), tier: prog.tiers[g],
      };
    }
    // A finisher every session for a conditioning goal (or when a tweak asks); otherwise the fit
    // adds one when there's time.
    const plannedFin = tw.finisher === 'on' || (tw.finisher === 'auto' && prog.finisherPerWeek >= 7);
    const freq = {};
    for (const t of tpl) for (const u of t.units) freq[u] = (freq[u] || 0) + 1;
    const legIdx = (tpl.find((x) => x.units.includes('legs')) || {}).idx;
    const days = tpl.map((t, k) => {
      const day = ws + t.offset;
      const budget = clamp(Math.round(Number(b.settingsAt(S, day).minutes) || Number(p.minutes) || 25), 10, 60);
      return { k, tpl: t.idx, idx: t.idx, offset: t.offset, day, budget, units: t.units.slice(), planUnits: t.units.slice(), occ: b.occurrences(tpl, t), legIdx, tplLen: tpl.length, freq, finisher: plannedFin };
    });
    // Workouts already done this week, by template day: the sets done per group (not for the normal
    // week a lighter one is measured against).
    if (!legacy && !phase.ref) {
      for (const l of S.log || []) {
        if (!l || l.type !== 'workout' || l.day < ws || l.day > ws + 6 || !b.isDone(l) || typeof l.tpl !== 'number') continue;
        const d = days.find((x2) => x2.tpl === l.tpl);
        if (!d) continue;
        const gs = {};
        for (const it of l.items || []) {
          if (!GROUPS.includes(it.group)) continue;
          const n = new Set((it.sets || []).map((x2) => `${x2.set}`)).size;
          if (n) gs[it.group] = (gs[it.group] || 0) + n;
        }
        d.done = gs;
      }
    }
    // What last week's workouts did for each group: its sets, and half a set for each other group
    // a move works (when there isn't time for every group each week, what it left short comes first).
    for (const g of GROUPS) G[g].prev = 0;
    if (!legacy && !phase.ref) {
      for (const l of S.log || []) {
        if (!l || l.type !== 'workout' || l.day < ws - 7 || l.day >= ws || !b.isDone(l)) continue;
        for (const it of l.items || []) {
          if (!GROUPS.includes(it.group)) continue;
          const n = new Set((it.sets || []).map((x2) => `${x2.set}`)).size;
          if (!n) continue;
          G[it.group].prev += n;
          const m = M().MOVES[it.moveId];
          for (const h of new Set(((m && m.muscles) || []).map((mu) => b.MUSCLE_GROUP[mu]).filter((g) => g && g !== it.group))) G[h].prev += 0.5 * n;
        }
      }
    }
    // A left vs right test is due on every arm (or leg) day until one is done, but only the first
    // of the week will have it: the time for it is kept on that day only.
    for (const u of ['arms', 'legs']) {
      const first = days.find((d) => !d.done && d.units.includes(u));
      for (const d of days) (d.tests = d.tests || {})[u === 'arms' ? 'arm' : 'leg'] = d === first;
    }
    for (const d of days) measureDay(S, d, G, phase);
    // A day with no time left for a set: its test waits for another day, then the parts round the
    // sets shrink (as the fit would shrink them), then its finisher goes (unless a plan tweak asks
    // for one every time), then its catch-up sets, rather than the day going without any.
    const giveWay = () => {
      if (legacy) return;
      for (const d of days) {
        if (d.done) continue;
        const noRoom = () => { const per = Object.values(d.per); return per.length > 0 && d.budget - d.fixed < Math.min(...per); };
        if (d.tests && (d.tests.arm || d.tests.leg) && noRoom()) { d.tests = { arm: false, leg: false }; measureDay(S, d, G, phase); }
        if (!d.compact && noRoom()) { d.compact = true; measureDay(S, d, G, phase); }
        if (d.finisher && tw.finisher !== 'on' && noRoom()) { d.finisher = false; measureDay(S, d, G, phase); }
        if (!d.noExtras && Object.keys(d.extras).length && noRoom()) { d.noExtras = true; measureDay(S, d, G, phase); }
      }
    };
    giveWay();
    let al = allocate(S, ws, days, G, legacy ? (k) => b.legacyGroupSets(S, tpl, tpl[k], phase.mult) : null);
    // Not enough time for every group's minimum: the warm-up, balance practice and cool-down shrink
    // first (as they do under 15 minutes), and the week is planned again.
    if (!legacy && al.short && days.some((d) => !d.compact && d.budget >= COMPACT)) {
      for (const d of days) { d.compact = true; measureDay(S, d, G, phase); }
      giveWay();
      al = allocate(S, ws, days, G, null);
    }
    // Still short with a finisher every session (a conditioning goal): every other session keeps
    // it (unless a plan tweak asked for one every time).
    if (!legacy && al.short && days.length > 1 && tw.finisher !== 'on' && days.some((d) => d.finisher)) {
      days.forEach((d, k) => { d.finisher = d.finisher && k % 2 === 0; measureDay(S, d, G, phase); });
      giveWay();
      al = allocate(S, ws, days, G, null);
    }
    // Still short, or a group under its weekly minimum: a group may also join a day of other muscle
    // groups for it.
    if (!legacy && (al.short || al.under) && days.length > 1) {
      for (const d of days) measureSpill(S, d, G, phase);
      al = allocate(S, ws, days, G, null);
    }
    // Which exercises a day gets depends on its sets (more sets, more exercises), and so does what
    // they do for other groups and how long they take: each exercise has its own setting up, two
    // sets of legs can be two exercises of one set, and what pairs into supersets changes. With the
    // sets given out, each day is measured again on the session its sets make, and the sets are
    // given out again where a day would run over its time (the fit would cut planned sets) or a
    // group falls short of its minimum.
    const same = (a, c) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(c || {}).sort());
    const settle = () => {
      for (let pass = 0; pass < 4; pass++) {
        let changed = false, over = false;
        days.forEach((d, k) => {
          if (d.done) {
            for (const [g, v] of Object.entries(indOf(S, d, al.x[k]))) if (!same(v, d.ind[g])) { d.ind[g] = v; changed = true; }
            return;
          }
          const real = realDay(S, d, al.x[k], phase);
          // What a group's sets do for others only ever goes down here: it is counted as far as
          // every session measured for it so far does it (a group's exercises change with its sets,
          // and help that comes and goes isn't counted on), so the measuring settles.
          for (const [g, v] of Object.entries(real.ind)) {
            const was = d.ind[g] || {};
            const low = {};
            for (const h of Object.keys(v)) if (was[h] != null) low[h] = Math.min(was[h], v[h]);
            if (!same(low, d.ind[g])) { d.ind[g] = low; changed = true; }
          }
          // The catch-up sets the session will have (a group joining a day can make it an arm or
          // leg day).
          if (!same(real.extras, d.extras)) { d.extras = real.extras; changed = true; }
          // Over its time, or with less outside its sets than measured (a test kept for another
          // day, catch-up sets for units it doesn't have): the day's times from the session.
          const time = Object.keys(al.x[k]).reduce((a, g) => a + (al.x[k][g] || 0) * (real.per[g] != null ? real.per[g] : d.per[g]), real.fixed);
          // (A set's time only goes up here, as the help above only goes down, so the measuring
          // settles.)
          if (time > d.budget + OVER + 1e-9 || real.fixed < d.fixed - 1) {
            for (const g of Object.keys(real.per)) d.per[g] = Math.max(d.per[g] || 0, real.per[g]);
            d.fixed = real.fixed;
            over = true;
          }
        });
        const e = al.effective();
        // (The last pass only measures: the plan's numbers are always those of its own sets.)
        if (pass === 3 || (!over && (!changed || al.trainable.every((g) => e[g] >= Math.min(2, G[g].floor) - 1e-9)))) break;
        al = allocate(S, ws, days, G, null);
      }
    };
    if (!legacy) {
      settle();
      // Measured on their sessions, the days hold less than they seemed to: a group short of its
      // minimum may still join a day of other muscle groups for it.
      if ((al.short || al.under) && days.length > 1 && !days.some((d) => d.spill)) {
        for (const d of days) measureSpill(S, d, G, phase);
        al = allocate(S, ws, days, G, null);
        settle();
      }
    }
    const { x, X, extrasW, capEff, trainable, effective, parity, own } = al;
    // What the fit may change: sets above the week's target go first when a session runs long, the
    // floor's share stays to the last, `room` is how many more a day may take when it runs short,
    // and `spare` what's left under the cap after that, for a day of one group's sets (from 15
    // minutes the fit gives it a second exercise, ensureMain).
    const e = effective();
    const baseOf = {}, protOf = {}, roomOf = {}, spareOf = {}, shortRoomOf = {};
    for (const g of GROUPS) {
      const ws2 = days.map((d, k) => x[k][g] || 0);
      const bonus = shareOut(Math.max(0, X[g] - G[g].T), ws2, ws2);
      baseOf[g] = ws2.map((n, k) => n - bonus[k]);
      protOf[g] = shareOut(Math.min(X[g], G[g].floor), ws2, ws2);
      // (A group the plan couldn't bring to its weekly minimum may also take sets a session turns
      // out to have time for, on any day it can join.)
      const short = Math.ceil(Math.max(0, G[g].floor - e[g]) - 1e-9);
      const on = days.map((d, k) => (!d.done && d.per[g] != null && (own(k, g) || short > 0) ? 1 : 0));
      const roomCaps = days.map((d, k) => (on[k] ? Math.max(0, d.maxSets[g] - (x[k][g] || 0)) : 0));
      const room = shareOut(Math.min(Math.max(0, capEff(g) - X[g]), Math.max(Math.min(G[g].B, capEff(g)) - X[g], short)), on, roomCaps);
      roomOf[g] = room;
      spareOf[g] = days.map(() => 0);
      // (Short of 2 sets: that many, on the days with the most time left it can join, for the fit
      // to add when a session has time after all.)
      const two = Math.min(2, G[g].floor);
      const lacking = trainable.includes(g) ? Math.ceil(Math.max(0, two - e[g]) - 1e-9) : 0;
      shortRoomOf[g] = lacking ? shareOut(lacking, days.map((d, k) => (!d.done && d.per[g] != null ? Math.max(0.01, d.budget - d.fixed - Object.entries(x[k]).reduce((a, [q, n]) => a + n * (d.per[q] || 0), 0)) : 0)), days.map(() => 1)) : days.map(() => 0);
    }
    // Each such day (or one with no sets at all, whatever its length) a set of another group, then
    // of a second (the fit takes the first it has a move for), then a second set of each while there
    // are any: the more important groups first, never more in all than a group has under its cap.
    const spareLeft = {};
    for (const g of trainable) spareLeft[g] = Math.max(0, capEff(g) - X[g] - roomOf[g].reduce((a, n) => a + n, 0));
    const needy = days.filter((d, k) => !d.done && Object.keys(x[k]).filter((q) => x[k][q] > 0).length < (d.budget >= COMPACT ? 2 : 1)).map((d) => d.k);
    for (const round of [0, 1, 2]) {
      for (const k of needy) {
        const given = GROUPS.filter((g) => spareOf[g][k] > 0);
        if (round < 2 && given.length > round) continue;
        const cands = round < 2 ? trainable.filter((g) => !(x[k][g] > 0) && !given.includes(g) && spareLeft[g] > 0) : given.filter((g) => spareLeft[g] > 0);
        const g = cands.sort((a, c) => G[c].w - G[a].w || GROUPS.indexOf(a) - GROUPS.indexOf(c))[0];
        if (g) { spareOf[g][k]++; spareLeft[g]--; }
      }
    }
    const outDays = days.map((d, k) => {
      const pick = (o) => { const r = {}; for (const g of GROUPS) if (o[g][k]) r[g] = o[g][k]; return r; };
      const groupSets = Object.assign({}, x[k]);
      for (const g of Object.keys(groupSets)) if (!groupSets[g]) delete groupSets[g];
      const covered = {}, slack = {};
      for (const g of Object.keys(groupSets)) {
        covered[g] = e[g] - groupSets[g] - (d.extras[g] || 0) >= G[g].floor - 1e-9;
        // How many of its sets the group can lose and still have 2 effective sets in the week.
        slack[g] = Math.max(0, Math.floor(e[g] - Math.min(2, G[g].floor) + 1e-9));
      }
      const weights = {};
      for (const g of GROUPS) weights[g] = G[g].w;
      const planned = d.fixed + Object.entries(groupSets).reduce((a, [g, n]) => a + n * d.per[g], 0);
      const pri = (g) => (g === 'abs' ? 9 : Math.min(...UNIT_GROUPS[UNIT_OF[g]].map((q) => prog.tiers[q] || 3)));
      return {
        tpl: d.tpl, idx: d.idx, offset: d.offset, day: d.day, budget: d.budget, occ: d.occ, legIdx: d.legIdx, tplLen: d.tplLen,
        units: d.fallback ? d.units.filter((u) => UNIT_GROUPS[u].some((g) => groupSets[g] > 0))
          : d.units.concat(UNITS.filter((u) => !d.units.includes(u) && UNIT_GROUPS[u].some((g) => groupSets[g] > 0)).sort((a, x2) => ORDER.indexOf(a) - ORDER.indexOf(x2))),
        planUnits: d.fallback || d.units, noExtras: !!d.noExtras,
        finisher: d.finisher, legacy, compact: !!d.compact, groupSets, base: pick(baseOf), protect: pick(protOf), room: pick(roomOf), spare: pick(spareOf), covered, slack, weights, short: pick(shortRoomOf),
        fixed: round1(d.fixed), planned: round1(planned),
        slots: Object.keys(groupSets).map((g) => ({ group: g, fams: (d.fams[g] || []).slice(), sets: groupSets[g], pri: pri(g), protect: (protOf[g] || [])[k] || 0 })),
        per: Object.fromEntries(Object.entries(d.per).map(([g, v]) => [g, round1(v)])),
      };
    });
    const perGroup = {};
    for (const g of GROUPS) {
      perGroup[g] = {
        target: G[g].T, boosted: G[g].B, floor: G[g].floor, cap: G[g].cap, aim: X[g], extras: extrasW[g] || 0, effective: round1(e[g]), weight: G[g].w, tier: G[g].tier,
        trainable: trainable.includes(g), freq: Math.min(days.length, prog.freq[UNIT_OF[g]] || 1), days: days.filter((d, k) => x[k][g] > 0).length,
      };
    }
    const masks = tpl.map((t) => t.units.reduce((m, u) => m | (1 << UNITS.indexOf(u)), 0));
    const plan = {
      ws, legacy, phase, full, parity: parity || !!(sp && sp.parity),
      split: legacy ? { kind: 'v1', label: masks.length ? labelOf(masks) : 'mixed', considered: 1 } : { kind: sp.kind, label: sp.label, considered: sp.considered },
      considered: legacy ? 1 : sp.considered,
      days: outDays, perGroup,
    };
    const sc = planScore(S, plan);
    plan.score = sc.score;
    plan.parts = sc.parts;
    return plan;
  }
  const round1 = (v) => Math.round(v * 10) / 10;

  /* ================================================================== the score */
  // How good a week is, 0 to 1, from six parts: how well the sets match your goals (0.35), whether
  // every group gets its minimum (0.2), how well sessions fill their time (0.15), recovery between
  // sessions for the same muscles (0.15), balance (pushing against pulling, the front of the legs
  // against the back, 0.1) and variety (0.05). planScore works from a week plan's own numbers;
  // score() builds the sessions and adds the hard rules.
  const PARTS = { goal: 0.35, coverage: 0.2, time: 0.15, recovery: 0.15, balance: 0.1, variety: 0.05 };
  const timeFit = (r) => (r > 1.02 ? Math.max(0, 1 - (r - 1) * 4) : r >= 0.85 ? 1 : Math.max(0, r / 0.85));
  function combine(parts) {
    let s = 0;
    for (const [k, w] of Object.entries(PARTS)) s += w * clamp(parts[k], 0, 1);
    return Math.round(s * 1000) / 1000;
  }
  // Recovery from the days a unit trains: back-to-back days (round into next week too) cost, legs
  // most; and how evenly the week's work is spread over its days.
  function recoveryOf(dayUnits, offsets, minutes) {
    let pen = 0, max = 0;
    const D = offsets.length;
    for (const u of UNITS) {
      const on = offsets.filter((o, i) => dayUnits[i].includes(u)).sort((a, b) => a - b);
      if (on.length < 2) { max += on.length ? ADJ(UNITS.indexOf(u)) : 0; continue; }
      for (let i = 0; i < on.length; i++) {
        const gap = i ? on[i] - on[i - 1] : on[0] + 7 - on[on.length - 1];
        if (gap <= 1) pen += ADJ(UNITS.indexOf(u));
        max += ADJ(UNITS.indexOf(u));
      }
    }
    const mean = minutes.reduce((a, v) => a + v, 0) / Math.max(1, D);
    const sd = Math.sqrt(minutes.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, D));
    return 0.75 * (1 - (max ? pen / max : 0)) + 0.25 * (mean > 0 ? Math.max(0, 1 - sd / mean) : 1);
  }
  const ratio = (a, b) => (Math.max(a, b) <= 0 ? 1 : Math.min(a, b) / Math.max(a, b));
  // How well a week matches the goals: each group's weekly sets against its target (three quarters)
  // and how many days it's trained against the program's frequency (a quarter: the top goals three
  // times a week), weighted by how much the group matters.
  function goalFit(pg, tr, setsOf, daysOf) {
    let gw = 0, gs = 0;
    for (const g of tr) {
      const vol = Math.min(1, pg[g].target ? setsOf(g) / pg[g].target : 1);
      const fr = Math.min(1, pg[g].freq ? daysOf(g) / pg[g].freq : 1);
      gw += pg[g].weight; gs += pg[g].weight * (0.75 * vol + 0.25 * fr);
    }
    return gw ? gs / gw : 0;
  }
  function planScore(S, plan) {
    const pg = plan.perGroup;
    const tr = GROUPS.filter((g) => pg[g].trainable);
    let cov = 0;
    for (const g of tr) cov += Math.min(1, pg[g].floor ? pg[g].effective / pg[g].floor : 1);
    const days = plan.days;
    const time = days.length ? days.reduce((a, d) => a + timeFit(Math.max(d.planned, Math.min(d.budget, d.planned + fillable(d))) / d.budget), 0) / days.length : 0;
    const push = (pg.chest.aim || 0) + (pg.shoulders.aim || 0), pull = pg.back.aim || 0;
    const fams = {};
    for (const d of days) for (const sl of d.slots) for (const f of sl.fams) (fams[sl.group] = fams[sl.group] || new Set()).add(f);
    const variety = tr.length ? tr.reduce((a, g) => a + Math.min(1, ((fams[g] && fams[g].size) || 0) / (pg[g].aim >= 4 ? 2 : 1)), 0) / tr.length : 0;
    const parts = {
      goal: goalFit(pg, tr, (g) => pg[g].aim, (g) => pg[g].days), coverage: tr.length ? cov / tr.length : 0, time,
      recovery: recoveryOf(days.map((d) => d.units), days.map((d) => d.offset), days.map((d) => d.planned)),
      balance: pull || push ? ratio(push, pull * 1.2) : 1, variety,
    };
    for (const k of Object.keys(parts)) parts[k] = Math.round(clamp(parts[k], 0, 1) * 1000) / 1000;
    return { score: combine(parts), parts };
  }
  // About how much of a day's spare time the fit fills without more sets (longer rests, a finisher,
  // a cool-down, an easy cardio block): most of it.
  const fillable = (d) => Math.max(0, d.budget - d.planned);

  /* ================================================================== fitting a session */
  // fit(S, s, o): a built session (brain.realize) brought within its time, then filled. It never
  // runs more than OVER minutes over the time set, and it fills toward FILL of it with, in order:
  // the sets the week has room for (not on a lighter day), longer rests (auto rest only), a finisher,
  // a cool-down, a longer warm-up, more finisher rounds, an easy cardio block and longer stretches,
  // never past the time itself. o: { dp (the day's plan), ready, phase, budget, short, maxItems
  // (simpler sessions), capOnly }.
  function fit(S, s, o) {
    const c = fitCtx(S, s, o);
    if (s.flare) { capTo(S, s, c); return s; }
    if (c.short) shortCut(S, s, c);
    capTo(S, s, c);
    if (c.maxItems && s.items.length > c.maxItems) { c.b.limitExercises(s, c.maxItems); capTo(S, s, c); }
    ensureMain(S, s, c);
    if (!o.capOnly) fill(S, s, c);
    capTo(S, s, c);
    return s;
  }
  function fitCtx(S, s, o) {
    const b = B();
    const p = S.profile;
    const prog = b.programFor(p);
    const tw = tweaksOf(p);
    const ready = o.ready || s.readiness || {};
    const phase = o.phase || s.phase || {};
    const budget = o.budget;
    const focusGroups = new Set((prog.focus || []).map((mu) => b.MUSCLE_GROUP[mu]).filter(Boolean));
    const dp = o.dp || EMPTY_DAY;
    return {
      b, p, prog, tw, dp, budget, short: !!o.short, maxItems: o.maxItems || 0, H: budget + OVER, F: FILL * budget,
      // No sets beyond the plan on a bad night or when short on time (on a lighter week the room
      // is only what its lighter target leaves).
      reduced: !!(o.short || ready.minus),
      legsTired: !!ready.legsMinus,
      cond: tw.finisher === 'on' || (tw.finisher !== 'off' && prog.finisherPerWeek >= 7),
      finisherOk: tw.finisher !== 'off' && !ready.noFinisher && !ready.minus && !phase.deload && S.complexity < 2 && !o.short,
      coolOk: tw.mobility !== 'off' && !o.short,
      autoRest: b.autoRest(S),
      need: budget >= 15 && !o.short ? 2 : 1,
      w: (g) => (dp.weights && dp.weights[g]) || tierW(prog.tiers[g] || 3) + (focusGroups.has(g) ? 0.5 : 0),
      est: () => b.estimate(S, s),
      added: {},
      cut: [],
    };
  }
  const isMain = (it) => !it.skill && it.kind === 'move';
  // Under 15 minutes the parts around the sets shrink before any set goes: a warm-up of two moves
  // (one at 12 minutes or less), one set of balance practice, one stretch to finish (none at 12
  // minutes or less unless every session has one). In the fit (c), what they were is kept, so the
  // fill can bring them back when there's time after all (restore).
  const COMPACT = 15;
  function compact(s, budget, c) {
    const tiny = budget <= 12;
    if (c) {
      const was = c.shrunk || (c.shrunk = { warmup: s.warmup.slice(), mobility: s.mobility.filter((mb) => !mb.cardio), skill: new Map() });
      for (const it of s.items) if (it.skill && it.sets > 1 && !was.skill.has(it)) was.skill.set(it, it.sets);
    }
    if (s.warmup.length > (tiny ? 1 : 2)) s.warmup = s.warmup.slice(0, tiny ? 1 : 2);
    for (const it of s.items) if (it.skill && it.sets > 1) it.sets = 1;
    if (s.mobility.length > (tiny && !s.keepMobility ? 0 : 1)) s.mobility = s.mobility.slice(0, tiny && !s.keepMobility ? 0 : 1);
    if (s.finisher && s.finisher.rounds > 3) s.finisher.rounds = 3;
  }
  // Trimming order: the lowest priority first (tier 3 before 2 before 1; back counts as tier 2 when
  // chest is trained hard), shoulders then abs first among equals, the exercise with most sets first.
  const trimKey = (S, it) => B().trimTier(S, it.group) * 10 + (it.group === 'shoulders' ? 2 : it.group === 'abs' ? 1 : 0);
  function dropItem(S, s, it) {
    B().unpair(s, it);
    s.items = s.items.filter((x) => x !== it);
    (s.trimmed = s.trimmed || []).push(it.name);
  }
  // Takes single sets away while the session is over: from the exercises of groups that have sets to
  // spare (room(group) > 0), lowest priority first, never below minSets an exercise.
  function takeSets(S, s, c, room, over, minSets) {
    for (let guard = 0; guard < 300 && over(); guard++) {
      let pick = null;
      for (const it of s.items) {
        if (!isMain(it) || it.sets <= minSets || room(it.group) <= 0) continue;
        const k = trimKey(S, it);
        if (!pick || k > pick.k || (k === pick.k && it.sets > pick.it.sets)) pick = { it, k };
      }
      if (!pick) return;
      pick.it.sets--;
    }
  }
  function capTo(S, s, c) {
    const b = c.b;
    const sets = (g) => s.items.reduce((a, it) => a + (isMain(it) && it.group === g ? it.sets : 0), 0);
    // No more than 10 sets for a group in a session, nor 6 for an exercise, whatever merged.
    for (const it of s.items) if (isMain(it) && it.sets > b.SET_MAX) it.sets = b.SET_MAX;
    for (const g of GROUPS) {
      for (let guard = 0; guard < 20 && sets(g) > 10; guard++) {
        const it = s.items.filter((x) => isMain(x) && x.group === g && x.sets > 1).sort((a, x) => x.sets - a.sets)[0];
        if (!it) break;
        it.sets--;
      }
    }
    const over = () => c.est() > c.H + 1e-9;
    if (!over()) return;
    if (c.budget < COMPACT || c.dp.compact) compact(s, c.budget, c);
    const mains = () => s.items.filter(isMain).length;
    const dp = c.dp;
    // 1. What's only there because there was time: an easy cardio block, a cool-down (unless every
    // session has one), a finisher (unless conditioning is the point), the warm-up's extra move.
    if (s.mobility.some((mb) => mb.cardio)) s.mobility = s.mobility.filter((mb) => !mb.cardio);
    if (over() && s.mobility.length && !s.keepMobility) s.mobility = [];
    if (over() && s.finisher && !c.cond) { s.finisher = null; (s.trimmed = s.trimmed || []).push('finisher'); }
    if (over() && s.warmup.some((w) => w.extra)) s.warmup = s.warmup.filter((w) => !w.extra);
    // 2. Sets above the week's target (a group the plan didn't give this day has none of its sets
    // in it), never below the floor's share (on a lighter week the floor can be above the target).
    const planned = Object.keys(dp.groupSets).length > 0;
    const baseOf = (g) => (!planned ? sets(g) : dp.groupSets[g] != null ? dp.base[g] || 0 : 0);
    takeSets(S, s, c, (g) => sets(g) - Math.max(baseOf(g), dp.protect[g] || 0), over, 1);
    // 3. A conditioning finisher shrinks to 3 rounds; a left vs right test waits for another day.
    while (over() && s.finisher && s.finisher.rounds > 3) s.finisher.rounds--;
    if (over() && s.tests.length) s.tests = [];
    // 4. Sets down to the floor's share.
    takeSets(S, s, c, (g) => sets(g) - (dp.protect[g] || 1), over, 1);
    // 5. The parts round the sets shrink (a warm-up of two moves, one set of balance practice, one
    // stretch), and what's left on its own pairs into supersets (when they're on).
    if (over()) compact(s, Math.max(COMPACT, c.budget), c);
    if (over()) b.pairSupersets(S, s);
    // 6. The catch-up sets, then exercises for groups trained enough on other days.
    if (over() && s.extras.length) s.extras = [];
    for (let guard = 0; guard < 12 && over(); guard++) {
      const cand = s.items.filter((it) => isMain(it) && dp.covered[it.group] && mains() > c.need).sort((a, x) => trimKey(S, x) - trimKey(S, a) || a.sets - x.sets)[0];
      if (!cand) break;
      dropItem(S, s, cand);
    }
    // 7. One set each (first from groups that keep 2 effective sets in the week without it), then
    // whole exercises, lowest priority first.
    const slack = (g) => (dp.slack && dp.slack[g] != null ? dp.slack[g] - Math.max(0, (dp.groupSets[g] || 0) - sets(g)) : 1);
    takeSets(S, s, c, slack, over, 1);
    takeSets(S, s, c, () => 1, over, 1);
    for (let guard = 0; guard < 12 && over() && mains() > c.need; guard++) {
      const cand = s.items.filter(isMain).sort((a, x) => trimKey(S, x) - trimKey(S, a) || a.sets - x.sets || s.items.indexOf(x) - s.items.indexOf(a))[0];
      if (!cand) break;
      dropItem(S, s, cand);
    }
    // 8. The rest: the finisher, a warm-up of one move, one set of balance practice, one stretch,
    // then fewer exercises still. It always ends within the time.
    if (over() && s.finisher) s.finisher = null;
    if (over() && s.warmup.length > 1) s.warmup = s.warmup.slice(0, 1);
    for (const it of s.items) if (over() && it.skill && it.sets > 1) it.sets = 1;
    if (over() && s.mobility.length > 1) s.mobility = s.mobility.slice(0, 1);
    for (let guard = 0; guard < 12 && over() && s.items.length > 1; guard++) {
      const skill = s.items.filter((it) => it.skill);
      const cand = skill.length > 1 || (skill.length && mains()) ? skill[skill.length - 1] : s.items.filter(isMain).sort((a, x) => trimKey(S, x) - trimKey(S, a))[0];
      if (!cand) break;
      dropItem(S, s, cand);
    }
    if (over()) s.mobility = [];
    if (over()) s.warmup = [];
  }

  // Short on time: priority work only (your top goals and one main exercise more, one core
  // exercise), two sets each; the fill brings back what fits in the 13 minutes.
  function shortCut(S, s, c) {
    const b = c.b;
    s.finisher = null; s.tests = [];
    s.mobility = s.keepMobility ? s.mobility.slice(0, 2) : [];
    const tier = (g) => b.tierOf(S, g);
    const main = s.items.filter(isMain);
    const keep = new Set(s.items.filter((it) => !isMain(it)).concat(main.filter((it) => tier(it.group) === 1)));
    const t2 = main.find((it) => tier(it.group) === 2);
    if (t2) keep.add(t2);
    if (!main.some((it) => keep.has(it)) && main[0]) keep.add(main[0]);
    const core = s.items.filter((it) => keep.has(it) && it.group === 'abs');
    if (core.length > 1) keep.delete(core[1]);
    c.cut = main.filter((it) => !keep.has(it)).map((it) => Object.assign({}, it, { superset: null }));
    for (const it of main) if (!keep.has(it)) b.unpair(s, it);
    s.items = s.items.filter((it) => keep.has(it));
    c.wanted = new Map(s.items.map((it) => [it, it.sets]));
    for (const it of s.items) if (isMain(it)) it.sets = Math.min(it.sets, 2);
  }

  // At least two main exercises from 15 minutes (one below), so balance practice or a single move is
  // never the whole session: one set split off into the unit's other exercise, or a set or two of
  // another group the week has room for.
  function ensureMain(S, s, c) {
    if (!s.items.length) return; // nothing in the plan suits today: it becomes a light day
    for (let guard = 0; guard < 3 && s.items.filter(isMain).length < c.need; guard++) {
      if (!(splitOne(S, s, c) || addOther(S, s, c))) break;
      capTo(S, s, c);
    }
  }
  function famsOfGroup(S, s, g, n) {
    const b = B();
    const u = UNIT_OF[g];
    if (!u) return [];
    return b.slotsOfDay(S, s.day, { idx: s.tpl, units: [u], occ: {}, groupSets: { [g]: n }, multi: true }).filter((sl) => sl.group === g).map((sl) => sl.fam);
  }
  function splitOne(S, s, c) {
    const b = c.b;
    if (c.maxItems && s.items.length >= c.maxItems) return false;
    const ids = new Set(s.items.map((it) => it.moveId));
    const fams = new Set(s.items.map((it) => it.fam));
    for (const it of s.items.filter(isMain).sort((a, x) => x.sets - a.sets)) {
      if (it.sets < 2) break;
      for (const f of famsOfGroup(S, s, it.group, 10)) {
        if (fams.has(f)) continue;
        const nit = b.itemFor(S, { fam: f, sets: 1, group: it.group }, s.day);
        if (!nit || ids.has(nit.moveId)) continue;
        it.sets--;
        s.items.push(nit);
        return true;
      }
    }
    return false;
  }
  function addOther(S, s, c) {
    const b = c.b;
    if (c.maxItems && s.items.length >= c.maxItems) return false;
    const ids = new Set(s.items.map((it) => it.moveId));
    const have = new Set(s.items.filter(isMain).map((it) => it.group));
    const allow = (g) => ((c.dp.room[g] || 0) + (c.dp.spare[g] || 0)) - (c.added[g] || 0);
    const short = (g) => ((c.dp.short || {})[g] > 0 ? 1 : 0);
    const order = GROUPS.filter((g) => !have.has(g) && allow(g) > 0)
      .sort((a, x) => short(x) - short(a) || (s.units.includes(UNIT_OF[x]) ? 1 : 0) - (s.units.includes(UNIT_OF[a]) ? 1 : 0) || c.w(x) - c.w(a) || GROUPS.indexOf(a) - GROUPS.indexOf(x));
    for (const g of order) {
      for (const f of famsOfGroup(S, s, g, 2)) {
        const nit = b.itemFor(S, { fam: f, sets: Math.min(2, allow(g)), group: g }, s.day);
        if (!nit || ids.has(nit.moveId)) continue;
        s.items.push(nit);
        c.added[g] = (c.added[g] || 0) + nit.sets;
        return true;
      }
    }
    return false;
  }

  function fill(S, s, c) {
    const under = () => c.est() < c.F - 1e-9;
    const fits = () => c.est() <= (c.short ? c.H : c.budget) + 1e-9;
    if (!under() || (!s.items.length && !s.flare)) return;
    // Short on time, the priority sets come back first; otherwise what shrank to make room does.
    if (c.short) { addBack(S, s, c, under, fits); restore(S, s, c, under, fits); }
    else { restore(S, s, c, under, fits); if (!c.reduced) { addShort(S, s, c, under, fits); addRoomSets(S, s, c, under, fits); } }
    if (under() && c.autoRest && !c.short) longerRest(S, s, c, under, fits);
    if (under() && !s.finisher && c.finisherOk && (c.cond || c.budget - c.est() >= 8)) {
      const f = c.b.finisherFor(S, s.day, s.tpl);
      if (f && !s.items.some((it) => it.moveId === f.moveId)) {
        s.finisher = f;
        if (!fits() && f.rounds > 3) f.rounds = 3;
        if (!fits()) s.finisher = null;
      }
    }
    if (under() && c.coolOk && !s.mobility.length) {
      s.mobility = cooldown(S, s);
      while (s.mobility.length && !fits()) s.mobility.pop();
    }
    if (under()) for (const w of s.warmup) {
      if (!under()) break;
      const m = M().MOVES[w.moveId];
      if (!m || !m.range || w.target >= m.range[1]) continue;
      const was = w.target;
      w.target = m.range[1];
      if (!fits()) w.target = was;
    }
    // More finisher rounds when conditioning is the point (otherwise the easy block below).
    if (s.finisher && c.finisherOk && c.cond) {
      while (under() && s.finisher.rounds < 8) { s.finisher.rounds++; if (!fits()) { s.finisher.rounds--; break; } }
    }
    if (under() && !c.short) addCardio(S, s, c, fits);
    if (under()) for (const mb of s.mobility) {
      if (!under()) break;
      const m = M().MOVES[mb.moveId];
      if (mb.cardio || !m || !m.range || mb.target >= m.range[1]) continue;
      const was = mb.target;
      mb.target = m.range[1];
      if (!fits()) mb.target = was;
    }
  }
  // What the parts round the sets lost to make room (compact) comes back first when there's time
  // after all: balance practice sets, then the warm-up's moves, then the stretches, in their order.
  function restore(S, s, c, under, fits) {
    const was = c.shrunk;
    if (!was) return;
    for (const [it, n] of was.skill) {
      if (!s.items.includes(it)) continue;
      while (under() && it.sets < n) { it.sets++; if (!fits()) { it.sets--; return; } }
    }
    for (const key of ['warmup', 'mobility']) {
      for (const x of was[key]) {
        if (!under()) return;
        if (s[key].includes(x)) continue;
        const now = s[key];
        s[key] = was[key].filter((y) => y === x || now.includes(y)).concat(now.filter((y) => !was[key].includes(y)));
        if (!fits()) { s[key] = now; break; }
      }
    }
  }
  // Short sessions: back up toward what was planned, the top priorities first.
  function addBack(S, s, c, under, fits) {
    const tier = (g) => c.b.tierOf(S, g);
    for (let guard = 0; guard < 30 && under(); guard++) {
      const it = s.items.filter((x) => isMain(x) && x.sets < Math.min(3, c.wanted.get(x) || 3)).sort((a, x) => tier(a.group) - tier(x.group) || a.sets - x.sets)[0];
      if (it) { it.sets++; if (!fits()) { it.sets--; break; } continue; }
      const back = c.cut.shift();
      if (!back) break;
      back.sets = Math.min(2, back.sets);
      s.items.push(back);
      if (!fits()) { s.items.pop(); break; }
    }
  }
  // A group the week leaves short of 2 sets (dp.short: the sets it lacks, given to the days with the
  // most time left), with no exercise in the session yet: a set of it when the session has time for
  // one (the more important groups first).
  function addShort(S, s, c, under, fits) {
    const b = c.b;
    const short = c.dp.short || {};
    for (const g of Object.keys(short).sort((a, x) => c.w(x) - c.w(a) || GROUPS.indexOf(a) - GROUPS.indexOf(x))) {
      if (!under()) return;
      if (!(short[g] - (c.added[g] || 0) > 0) || s.items.some((it) => isMain(it) && it.group === g)) continue;
      if (c.maxItems && s.items.length >= c.maxItems) return;
      const ids = new Set(s.items.map((it) => it.moveId));
      for (const f of famsOfGroup(S, s, g, 1)) {
        const nit = b.itemFor(S, { fam: f, sets: 1, group: g }, s.day);
        if (!nit || ids.has(nit.moveId)) continue;
        s.items.push(nit);
        if (fits()) c.added[g] = (c.added[g] || 0) + 1;
        else s.items.pop();
        break;
      }
    }
  }
  // More sets where the week has room for them, round the groups by how much they're worth.
  function addRoomSets(S, s, c, under, fits) {
    const room = Object.assign({}, c.dp.room);
    const order = Object.keys(room).filter((g) => room[g] > 0 && !(g === 'legs' && c.legsTired)).sort((a, x) => c.w(x) - c.w(a) || GROUPS.indexOf(a) - GROUPS.indexOf(x));
    let more = true;
    while (more && under()) {
      more = false;
      for (const g of order) {
        if (!under()) return;
        if (room[g] <= 0) continue;
        const its = s.items.filter((it) => isMain(it) && it.group === g);
        const total = its.reduce((a, it) => a + it.sets, 0);
        const it = its.filter((x) => x.sets < B().SET_MAX).sort((a, x) => a.sets - x.sets)[0];
        if (!it || total >= 10) { room[g] = 0; continue; }
        it.sets++;
        if (!fits()) { it.sets--; room[g] = 0; continue; }
        room[g]--;
        c.added[g] = (c.added[g] || 0) + 1;
        more = true;
      }
    }
  }
  // Longer rests (auto rest only) with a strength goal: about 2.5 minutes after the main lifts done
  // on their own when there's time for it. Heavy sets recover more of their strength with longer
  // rests (Schoenfeld et al. 2016), while for muscle size there's nothing clear past about 90 s
  // (Singer et al. 2024), so other rests stay as they are, and 60 s inside supersets, where each
  // muscle rests through its partner's set.
  function longerRest(S, s, c, under, fits) {
    const b = c.b;
    if (!(S.profile.goals || []).slice(0, 2).includes('strength')) return;
    const plus = A() ? A().restPlus(S.profile) : 0;
    const order = s.items.filter((it) => isMain(it) && !it.superset && (b.MAIN_LIFTS.includes(it.fam) || b.HOME_COMPOUND.includes(it.fam)))
      .sort((a, x) => b.tierOf(S, a.group) - b.tierOf(S, x.group));
    for (const it of order) {
      if (!under()) return;
      const was = it.rest;
      for (const step of [150 + plus, 120 + plus]) {
        if (step <= was) break;
        it.rest = step;
        if (fits()) break;
        it.rest = was;
      }
    }
  }
  // A cool-down for the day's muscles, as access.adjustSession would give it.
  function cooldown(S, s) {
    const b = B(), ac = A(), p = S.profile;
    let list = b.cooldownItems(S, s.day, s.items, false);
    if (ac) {
      const r = ac.rulesOf(p);
      list = list.filter((mb) => ac.moveOk(p, mb.moveId, s.day));
      if (r.seated || r.c.has('ra') || list.length < 2) list = ac.flowItems(S, 'mobility', ac.cooldownIds(p), s.day);
    }
    return list;
  }
  // The easy cardio block: a steady walk, march or ride at a pace you could talk at, for the time
  // that's left (3 to 30 minutes). Easy aerobic work counts toward the weekly 150 minutes of
  // moderate activity the guidelines ask for (WHO 2020) and helps recovery.
  // Seated boxing last: the arms keep the heart rate up when the legs, hips and ankles need a rest.
  const CARDIO = {
    gym: ['incline_walk', 'bike_int', 'rower_int', 'fin_march_easy', 'fin_step', 'fin_seat_march', 'fin_seat_box'],
    home: ['fin_march_easy', 'fin_step', 'fin_seat_march', 'fin_seat_box'],
    seated: ['fin_seat_march', 'fin_seat_box'],
  };
  const CARDIO_NAME = { incline_walk: 'Easy incline walk', bike_int: 'Easy bike ride', rower_int: 'Easy rowing', fin_march_easy: 'Easy march', fin_step: 'Easy step touch', fin_seat_march: 'Easy seated march', fin_seat_box: 'Easy seated boxing' };
  function cardioMove(S, day, place, used) {
    const b = B(), ac = A(), p = S.profile;
    const eq = b.eqAt(S, place);
    const sore = Object.entries(S.pain || {}).filter(([, until]) => until >= day).map(([j]) => j);
    const skip = tweaksOf(p).avoid;
    const noImpact = !b.programFor(p).impactOk;
    const list = ac && ac.rulesOf(p).seated ? CARDIO.seated : CARDIO[place === 'gym' ? 'gym' : 'home'];
    return list.find((id) => {
      const m = M().MOVES[id];
      return m && !used.has(id) && M().allowed(m, eq) && (!ac || ac.moveOk(p, id, day)) && !(m.joints || []).some((j) => sore.includes(j)) && !skip.includes(id) && !(m.impact && noImpact);
    }) || null;
  }
  function addCardio(S, s, c, fits) {
    const gap = c.budget - c.est();
    if (gap < 3.2) return;
    const used = new Set(s.items.map((it) => it.moveId).concat(s.finisher ? [s.finisher.moveId] : [], s.warmup.map((w) => w.moveId)));
    // (The finisher's move at an easy pace when nothing else suits, sore legs and hips, say.)
    const id = cardioMove(S, s.day, s.place, used) || (s.finisher && cardioMove(S, s.day, s.place, new Set(s.items.map((it) => it.moveId))));
    if (!id) return;
    const item = { kind: 'mobility', moveId: id, name: CARDIO_NAME[id] || M().MOVES[id].name, timed: true, target: Math.min(30, Math.floor(gap - 0.1)) * 60, uni: false, cardio: true };
    s.mobility = [item].concat(s.mobility);
    while (!fits() && item.target > 180) item.target -= 60;
    if (!fits()) s.mobility = s.mobility.filter((x) => x !== item);
  }

  /* ================================================================== a built week's score */
  // score(S, ws): the week's sessions built as planned (no readiness), scored on the six parts, with
  // the hard rules checked on them: every move allowed (kit, the body's rules, a joint on a break,
  // careful joints, impact), no session over its time, no move twice in a session, no group past its
  // weekly cap, and every group at its minimum while there's time. { score, parts, feasible,
  // violations, sessions, perGroup, split }.
  function score(S, ws) {
    const b = B();
    const cal = b.calendar(S, ws);
    const week = cal.weeks[ws];
    const wp = weekPlan(S, ws, { phase: week ? week.phase : undefined });
    const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : wp.days.map((d) => ({ day: d.day, tpl: d.tpl }));
    const built = live.map((x) => b.buildSession(S, x.day, x.tpl, { cal, noReadiness: true }));
    return scoreBuilt(S, wp, built);
  }
  function scoreBuilt(S, wp, built) {
    const b = B(), ac = A(), p = S.profile;
    const prog = b.programFor(p);
    const pg = wp.perGroup;
    const direct = {}, eff = {};
    for (const g of GROUPS) { direct[g] = 0; eff[g] = 0; }
    const violations = [];
    const bad = (kind, text) => { if (violations.length < 12) violations.push({ kind, text }); };
    const fams = {};
    let quads = 0, posterior = 0;
    for (const s of built) {
      const budget = s.budget || 25;
      const est = b.estimate(S, s);
      if (est > budget + OVER + 1e-9) bad('time', `${s.title} runs ${Math.round(est - budget)} minutes over`);
      const ids = s.items.map((it) => it.moveId);
      if (new Set(ids).size !== ids.length) bad('twice', `${s.title} has a move twice`);
      const eq = b.eqAt(S, s.place || 'home');
      const sore = Object.entries(S.pain || {}).filter(([, until]) => until >= s.day).map(([j]) => j);
      const impactOk = prog.impactOk;
      for (const it of s.items.concat(s.extras || [], s.finisher ? [s.finisher] : [], s.warmup || [], s.mobility || [])) {
        const m = M().MOVES[it.moveId];
        if (!m) { bad('rules', `unknown move ${it.moveId}`); continue; }
        const work = it.kind === 'move' || it.kind === 'extra' || it.kind === 'finisher';
        if (!M().allowed(m, eq)) bad('kit', `${m.name} needs kit that isn't there`);
        else if (ac && ac.why(p, m, s.day)) bad('rules', `${m.name}: ${ac.why(p, m, s.day)}`);
        else if (m.impact && !impactOk) bad('impact', `${m.name} is a jumping move`);
        else if ((m.joints || []).some((j) => sore.includes(j))) bad('pain', `${m.name} loads a joint on a break`);
        else if (work && (m.impact || m.complex) && (m.joints || []).some((j) => (p.careful || []).includes(j))) bad('careful', `${m.name} is hard on a careful joint`);
      }
      for (const it of s.items.concat(s.extras || [])) {
        const m = M().MOVES[it.moveId];
        if (!m || !it.sets) continue;
        if (GROUPS.includes(it.group)) { direct[it.group] += it.sets; eff[it.group] += it.sets; (fams[it.group] = fams[it.group] || new Set()).add(it.moveId); }
        for (const h of new Set((m.muscles || []).map((mu) => b.MUSCLE_GROUP[mu]).filter((g) => g && g !== it.group))) eff[h] += 0.5 * it.sets;
        const prime = (m.muscles || []).slice(0, m.prime || 1);
        if (prime.includes('quads')) quads += it.sets;
        if (prime.includes('glutes') || prime.includes('hamstrings')) posterior += it.sets;
      }
    }
    const tr = GROUPS.filter((g) => pg[g].trainable);
    const full = built.every((s) => b.estimate(S, s) >= 0.85 * (s.budget || 25));
    for (const g of GROUPS) if (direct[g] > pg[g].cap) bad('cap', `${b.GROUP_NAME[g]} past its weekly cap`);
    for (const g of tr) if (!full && eff[g] < pg[g].floor - 1e-9) bad('floor', `${b.GROUP_NAME[g]} under its weekly minimum with time to spare`);
    let cov = 0;
    for (const g of tr) cov += Math.min(1, pg[g].floor ? eff[g] / pg[g].floor : 1);
    const sessions = built.map((s) => ({ day: s.day, title: s.title, units: s.units.slice(), minutes: Math.round(b.estimate(S, s)), budget: s.budget, sets: s.items.reduce((a, it) => a + (it.skill ? 0 : it.sets), 0) }));
    const unitsOf = (s) => UNITS.filter((u) => s.items.some((it) => UNIT_GROUPS[u].includes(it.group)));
    const variety = tr.length ? tr.reduce((a, g) => a + Math.min(1, ((fams[g] && fams[g].size) || 0) / (built.filter((s) => s.items.some((it) => it.group === g)).length >= 2 ? 2 : 1)), 0) / tr.length : 0;
    const push = direct.chest + direct.shoulders, pull = direct.back;
    const parts = {
      goal: goalFit(pg, tr, (g) => direct[g], (g) => built.filter((s) => s.items.some((it) => it.group === g && !it.skill)).length),
      coverage: tr.length ? cov / tr.length : 0,
      time: built.length ? built.reduce((a, s) => a + timeFit(b.estimate(S, s) / (s.budget || 25)), 0) / built.length : 0,
      recovery: recoveryOf(built.map(unitsOf), built.map((s) => b.weekday(s.day)), built.map((s) => b.estimate(S, s))),
      balance: 0.5 * (pull || push ? ratio(push, pull * 1.2) : 1) + 0.5 * (quads || posterior ? ratio(quads, posterior) : 1),
      variety,
    };
    for (const k of Object.keys(parts)) parts[k] = Math.round(clamp(parts[k], 0, 1) * 1000) / 1000;
    const perGroup = {};
    for (const g of GROUPS) perGroup[g] = { sets: direct[g], effective: Math.round(eff[g] * 10) / 10, target: pg[g].target, floor: pg[g].floor, cap: pg[g].cap };
    return { score: combine(parts), parts, feasible: !violations.length, violations, sessions, perGroup, split: { kind: wp.split.kind, label: wp.split.label }, considered: wp.considered };
  }

  /* ================================================================== explanations */
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const joinList = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const setsWord = (n) => `${n} set${Math.abs(n) === 1 ? '' : 's'}`;
  // A score change in words only when it shows: 0.917 to 0.922 is "92 to 92" otherwise.
  const pct100 = (x) => Math.round(x * 100);
  // Groups by name, with biceps and triceps together as arms when both are there.
  function groupNames(list) {
    const b = B();
    const out = list.slice();
    const both = out.includes('biceps') && out.includes('triceps');
    return out.filter((g) => !(both && g === 'triceps')).map((g) => (both && g === 'biceps' ? 'arms' : b.GROUP_NAME[g].toLowerCase()));
  }
  // explain(S, day): why the plan is as it is, for the week of `day`, in plain English.
  // { headline, week: [{ day, weekday, title, units, minutes, sets, done, today }], today (the
  // session for `day`, or the next one this week) , reasons: [lines], parts, score, considered }.
  function explain(S, day) {
    const b = B();
    const ws = b.weekStart(day);
    const cal = b.calendar(S, day);
    const week = cal.weeks[ws];
    const wp = weekPlan(S, ws, { phase: week ? week.phase : undefined });
    const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : [];
    const custom = GH.customPlan && live.some((x) => GH.customPlan.owns(x.tpl));
    const built = live.map((x) => ({ x, s: b.buildSession(S, x.day, x.tpl, { cal, noReadiness: x.day !== day }) }));
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekOut = built.map(({ x, s }) => ({ day: x.day, weekday: wd[b.weekday(x.day)], title: s.title, units: s.units.slice(), minutes: s.estimateMin, sets: s.items.reduce((a, it) => a + (it.skill ? 0 : it.sets), 0), done: !!x.done, today: x.day === day }));
    const pick = built.find(({ x }) => x.day === day) || built.find(({ x }) => x.day > day && !x.done) || null;
    const today = pick ? {
      day: pick.x.day, title: pick.s.title, minutes: pick.s.estimateMin, budget: pick.s.budget, light: !!pick.s.light,
      items: pick.s.items.map((it) => ({ moveId: it.moveId, name: it.name, group: it.group, sets: it.sets, target: it.target, timed: !!it.timed, skill: !!it.skill })),
      finisher: pick.s.finisher ? { moveId: pick.s.finisher.moveId, name: pick.s.finisher.name, rounds: pick.s.finisher.rounds } : null,
      cooldown: (pick.s.mobility || []).map((mb) => ({ moveId: mb.moveId, name: mb.name, target: mb.target, cardio: !!mb.cardio })),
    } : null;
    const minutes = clamp(Math.round(Number(b.settingsAt(S, day).minutes) || Number(S.profile.minutes) || 25), 10, 60);
    const prog = b.programFor(S.profile);
    const top = GROUPS.filter((g) => prog.tiers[g] === 1 && wp.perGroup[g].trainable);
    const headline = custom ? 'You\'re following your own plan this week'
      : `${live.length} workout${live.length === 1 ? '' : 's'} a week, about ${minutes} minutes each${top.length ? `, built around your ${joinList(groupNames(top))}` : ''}`;
    return { headline, week: weekOut, today, reasons: custom ? customReasons(S) : reasonLines(S, wp, built.map((x) => x.s), minutes), parts: wp.parts, score: wp.score, considered: wp.considered, split: { kind: wp.split.kind, label: wp.split.label, name: LABEL[wp.split.label] || LABEL.mixed } };
  }
  function customReasons(S) {
    return ['These sessions come from a plan you made or added. The engine still fits each one to your body\'s rules and keeps it within your time.'];
  }
  // The reasons, most telling first.
  function reasonLines(S, wp, sessions, minutes) {
    const b = B(), ac = A(), p = S.profile;
    const prog = b.programFor(p);
    const tw = tweaksOf(p);
    const out = [];
    const pg = wp.perGroup;
    const D = wp.days.length;
    // The split.
    if (wp.legacy) out.push('This week keeps the plan it started with. From next week the new planner arranges your days.');
    else if (wp.split.kind !== 'auto') out.push(`You picked ${lower(LABEL[wp.split.kind])}: the ${fmtN(wp.considered)} ways to lay it over your ${D} days were compared, and this one rests each muscle best.`);
    else out.push(`Every way to share your muscle groups over your ${D} days was compared (${fmtN(wp.considered)} of them). This one spreads the work most evenly and rests each muscle between sessions.`);
    // The goals.
    const top = GROUPS.filter((g) => prog.tiers[g] === 1 && pg[g].trainable && pg[g].aim > 0);
    if (top.length) {
      const parts = [];
      const both = top.includes('biceps') && top.includes('triceps');
      for (const g of top) {
        if (both && g === 'triceps') continue;
        const sets = both && g === 'biceps' ? pg.biceps.aim + pg.triceps.aim : pg[g].aim;
        const name = both && g === 'biceps' ? 'arms' : b.GROUP_NAME[g].toLowerCase();
        // "12 sets for arms and 6 for legs".
        parts.push(parts.length ? `${sets} for ${name}` : `${setsWord(sets)} for ${name}`);
      }
      out.push(`Your top goals get the most work: ${joinList(parts)} this week.`);
    }
    // Recovery.
    const units = wp.days.map((d) => d.units);
    const offs = wp.days.map((d) => d.offset);
    const backToBack = UNITS.filter((u) => {
      const on = offs.filter((o, i) => units[i].includes(u)).sort((a, x) => a - x);
      return on.some((o, i) => (i ? o - on[i - 1] : on[0] + 7 - on[on.length - 1]) <= 1) && on.length > 1;
    });
    if (D > 1 && !backToBack.length) out.push('No muscle group trains two days in a row, so each one recovers before it works again.');
    else if (D > 1 && !backToBack.includes('legs') && units.filter((u) => u.includes('legs')).length > 1) out.push('Your legs always get a day off between sessions.');
    // The time.
    const setMin = wp.days.length ? Math.round(wp.days.reduce((a, d) => a + d.planned - d.fixed, 0) / wp.days.length) : 0;
    const fin = sessions.some((s) => s.finisher), cool = sessions.some((s) => (s.mobility || []).some((mb) => !mb.cardio)), walk = sessions.some((s) => (s.mobility || []).some((mb) => mb.cardio));
    const extras = ['a warm-up'].concat(fin ? ['a finisher'] : [], walk ? ['an easy cardio block'] : [], cool ? ['a cool-down'] : []);
    if (setMin > 0) out.push(`Each session fits your ${minutes} minutes: about ${setMin} minutes of sets, then ${joinList(extras)}.`);
    // Coverage, or groups taking turns.
    if (wp.parity) out.push('There isn\'t time for every muscle group each week, so they take turns: what misses out this week comes first next week.');
    else if (GROUPS.every((g) => !pg[g].trainable || pg[g].effective >= pg[g].floor - 1e-9)) out.push('Every muscle group gets at least its weekly minimum, counting the help bigger moves give.');
    // The phase.
    const ph = wp.phase;
    if (ph.deload) out.push(`A lighter week to recover: about ${Math.round(ph.mult * 100)}% of your usual sets.`);
    else if (ph.onramp && ph.idle) out.push(`Back after a break: about ${Math.round(ph.mult * 100)}% of your usual sets while you settle in again.`);
    else if (ph.onramp) out.push(`This week eases you in: about ${Math.round(ph.mult * 100)}% of a normal week's sets.`);
    // Changes you made.
    const mine = tweakWords(tw);
    if (mine.length) out.push(`Your changes: ${joinList(mine)}.`);
    // The body.
    const around = ac && ac.plannedAround(p);
    if (around) out.push(`${around}.`);
    return out;
  }
  // Plan tweaks in words.
  function tweakWords(t) {
    const b = B();
    const out = [];
    for (const [g, n] of Object.entries(t.sets)) out.push(`${b.GROUP_NAME[g].toLowerCase()} ${n > 0 ? '+' : ''}${setsWord(n)} a week`);
    for (const [f, id] of Object.entries(t.swaps)) { const m = M().MOVES[id]; const lad = M().LADDERS[f]; if (m) out.push(`${m.name.toLowerCase()} for ${lad ? lad.name.toLowerCase() : 'that exercise'}`); }
    if (t.split !== 'auto') out.push(lower(LABEL[t.split]));
    if (t.rest !== 'auto') out.push(`${t.rest === 60 ? '1 minute' : t.rest === 90 ? '90 s' : '2 minutes'} of rest`);
    if (t.finisher !== 'auto') out.push(t.finisher === 'on' ? 'a finisher every session' : 'no finishers');
    if (t.mobility !== 'auto') out.push(t.mobility === 'on' ? 'a cool-down every session' : 'no optional cool-downs');
    if (t.avoid.length) out.push(`leaving out ${joinList(t.avoid.map((id) => M().MOVES[id].name.toLowerCase()))}`);
    return out;
  }
  // explainProfile(p, day): the same for set-up's answers, before there's a state.
  function explainProfile(p, day) {
    const b = B();
    const S = b.newState(p || {}, null, day);
    return explain(S, day);
  }

  /* ================================================================== the classic splits */
  // alternatives(S, ws): the best fit and the three classic splits (full body, upper and lower,
  // push, pull and legs), each planned for the week and scored, best first.
  const KINDS = ['auto', 'full_body', 'upper_lower', 'ppl'];
  function alternatives(S, ws) {
    const phase = phaseOf(S, ws);
    const cur = tweaksOf(S.profile).split;
    const out = KINDS.map((kind) => {
      const S2 = withTweaks(S, { split: kind });
      const wp = weekPlan(S2, ws, { phase });
      return {
        split: kind, name: kind === 'auto' ? 'Best fit' : LABEL[kind], shape: wp.split.label, shapeName: LABEL[wp.split.label] || LABEL.mixed,
        score: wp.score, parts: wp.parts, considered: wp.considered, current: kind === cur,
        days: wp.days.map((d) => ({ offset: d.offset, units: d.units.slice(), minutes: Math.round(d.planned) })),
      };
    });
    return out.sort((a, x) => x.score - a.score || KINDS.indexOf(a.split) - KINDS.indexOf(x.split));
  }
  // (Copies keep plans of their own: what's tried on one never takes the place of the state's.)
  const cloneState = (S) => { const c = Object.assign({}, S, { planCache: null }); return typeof structuredClone === 'function' ? structuredClone(c) : JSON.parse(JSON.stringify(c)); };
  // A copy of the state with tweaks merged in (what's planned is read from it; nothing in S changes).
  function withTweaks(S, t) {
    const S2 = Object.assign({}, S, { profile: Object.assign({}, S.profile), prog: JSON.parse(JSON.stringify(S.prog || {})), planCache: null });
    S2.profile.planTweaks = mergeTweaks(tweaksOf(S.profile), t);
    return S2;
  }

  /* ================================================================== trying plan tweaks */
  // Tweaks merge onto the ones in force: sets and swaps per group or ladder (0 or null clears one),
  // the split, rest, finisher and cool-down choices replace, and `avoid` replaces the whole list.
  function mergeTweaks(cur, t) {
    const x = t && typeof t === 'object' ? t : {};
    const out = { sets: Object.assign({}, cur.sets), swaps: Object.assign({}, cur.swaps), split: cur.split, rest: cur.rest, finisher: cur.finisher, mobility: cur.mobility, avoid: cur.avoid.slice() };
    if (x.sets && typeof x.sets === 'object') for (const g of GROUPS) if (Object.prototype.hasOwnProperty.call(x.sets, g)) out.sets[g] = x.sets[g];
    if (x.swaps && typeof x.swaps === 'object') for (const f of Object.keys(x.swaps)) { if (x.swaps[f]) out.swaps[f] = x.swaps[f]; else delete out.swaps[f]; }
    for (const k of ['split', 'rest', 'finisher', 'mobility']) if (x[k] != null) out[k] = x[k];
    if (Array.isArray(x.avoid)) out.avoid = x.avoid.slice();
    return normTweaks(out);
  }
  // applyTweaks(S, tweaks[, day]): what the tweaks would do, tried on a copy of the state (S is not
  // changed). Next week is compared before and after: the score and its parts, the hard rules, each
  // group's weekly sets, the sessions. It's ok when every rule still holds and the score drops by
  // no more than 0.03. Besides the plan tweaks it takes minutes (10 to 60) and days (2 to 6), set as
  // Settings would. Returns { ok, reasons, before, after, diff: [lines], tweaks (the merged tweaks to
  // save as S.profile.planTweaks) }.
  function applyTweaks(S, tweaks, day) {
    const b = B();
    const t = tweaks && typeof tweaks === 'object' ? tweaks : {};
    const prefs = S.profile.prefs || {};
    const d0 = day != null ? day : b.dayOf(Date.now(), prefs.rollHour != null ? prefs.rollHour : 4);
    const ws = b.weekStart(d0) + 7;
    const cur = tweaksOf(S.profile);
    const merged = mergeTweaks(cur, t);
    const S1 = cloneState(S), S2 = cloneState(S);
    S2.profile.planTweaks = merged;
    const patch = {};
    if (t.minutes != null && Number.isFinite(Number(t.minutes))) patch.minutes = clamp(Math.round(Number(t.minutes) / 5) * 5, 10, 60);
    if (t.days != null && Number.isFinite(Number(t.days))) { const n = clamp(Math.round(Number(t.days)), 2, 6); Object.assign(patch, b.setWorkoutDays(S.profile.weekdays, n)); }
    if (Object.keys(patch).length) b.updateSettings(S2, d0, patch);
    const before = score(S1, ws), after = score(S2, ws);
    const reasons = [];
    for (const v of after.violations) if (!before.violations.some((w) => w.text === v.text)) reasons.push(`${v.text}.`);
    const fresh = after.violations.filter((v) => !before.violations.some((w) => w.text === v.text));
    const drop = before.score - after.score;
    if (drop > 0.03) {
      const worst = Object.keys(PARTS).sort((a, x) => (after.parts[a] - before.parts[a]) * PARTS[a] - (after.parts[x] - before.parts[x]) * PARTS[x])[0];
      reasons.push(`The plan would score lower (${Math.round(before.score * 100)} to ${Math.round(after.score * 100)} out of 100), mostly on ${PART_WORDS[worst]}.`);
    }
    const ok = !fresh.length && drop <= 0.03;
    if (ok) reasons.push(pct100(after.score) > pct100(before.score) ? `The plan scores better (${pct100(before.score)} to ${pct100(after.score)} out of 100) and every rule still holds.` : 'Every rule still holds and the plan scores about the same.');
    return { ok, reasons, before, after, diff: diffLines(before, after, cur, merged, S.profile, S2.profile), tweaks: merged };
  }
  const PART_WORDS = { goal: 'how well the sets match your goals', coverage: 'every muscle group getting its minimum', time: 'fitting your time', recovery: 'rest between sessions for the same muscles', balance: 'balance between pushing and pulling', variety: 'variety' };
  const restWords = (r) => (r === 'auto' ? 'automatic' : r === 60 ? '1 minute' : r === 90 ? '90 s' : '2 minutes');
  function diffLines(before, after, cur, next, p1, p2) {
    const b = B();
    const out = [];
    if (before.split.label !== after.split.label || cur.split !== next.split) out.push(`Your week: ${lower(LABEL[after.split.label] || LABEL.mixed)}${before.split.label !== after.split.label ? ` (was ${lower(LABEL[before.split.label] || LABEL.mixed)})` : ''}.`);
    if (p1.minutes !== p2.minutes) out.push(`Sessions of ${p2.minutes} minutes (was ${p1.minutes}).`);
    if (p1.days !== p2.days) out.push(`${p2.days} workouts a week (was ${p1.days}).`);
    for (const g of GROUPS) {
      const a = before.perGroup[g].sets, c = after.perGroup[g].sets;
      if (a !== c) out.push(`${b.GROUP_NAME[g]}: ${setsWord(c)} a week (was ${a}).`);
    }
    for (const [f, id] of Object.entries(next.swaps)) if (cur.swaps[f] !== id) { const m = M().MOVES[id]; const lad = M().LADDERS[f]; out.push(`${lad ? lad.name : 'That exercise'}: ${m.name.toLowerCase()} from now on.`); }
    for (const f of Object.keys(cur.swaps)) if (!next.swaps[f]) { const lad = M().LADDERS[f]; out.push(`${lad ? lad.name : 'That exercise'}: back to the usual move.`); }
    const added = next.avoid.filter((id) => !cur.avoid.includes(id)), back = cur.avoid.filter((id) => !next.avoid.includes(id));
    if (added.length) out.push(`Leaves out ${joinList(added.map((id) => M().MOVES[id].name.toLowerCase()))}.`);
    if (back.length) out.push(`Brings back ${joinList(back.map((id) => M().MOVES[id].name.toLowerCase()))}.`);
    if (cur.rest !== next.rest) out.push(`Rest between sets: ${restWords(next.rest)} (was ${restWords(cur.rest)}).`);
    if (cur.finisher !== next.finisher) out.push(next.finisher === 'on' ? 'A finisher at the end of every session.' : next.finisher === 'off' ? 'No finishers.' : 'Finishers when there\'s time for one.');
    if (cur.mobility !== next.mobility) out.push(next.mobility === 'on' ? 'A cool-down after every session.' : next.mobility === 'off' ? 'No cool-down unless your plan needs one.' : 'A cool-down when there\'s time for one.');
    if (pct100(after.score) !== pct100(before.score)) out.push(`Plan score: ${pct100(before.score)} → ${pct100(after.score)} out of 100.`);
    return out;
  }

  /* ================================================================== the engine epoch */
  // A state saved before 1.6 keeps 1.5's split and sets up to the end of the week it's first loaded
  // in (what's done and what's left of that week keep their meaning); the new engine plans from the
  // week after. Safe to run on every load: it only sets S.engineFrom once.
  (GH.migrations = GH.migrations || []).push(function engineEpoch(S) {
    const b = B();
    if (!S || typeof S !== 'object' || S.engineFrom != null || !S.profile || !b) return;
    const prefs = S.profile.prefs || {};
    S.engineFrom = b.weekStart(b.dayOf(Date.now(), prefs.rollHour != null ? prefs.rollHour : 4)) + 7;
  });

  const self = GH.optimizer = {
    weekPlan, score, explain, explainProfile, alternatives, applyTweaks, TWEAKS,
    split, template, dayPlan, fit, normTweaks, mergeTweaks, LABEL, UNITS, UNIT_GROUPS, PARTS, stats,
    _internal: { bestDays, countSplits, variants, archetype, labelOf, maskCost, splitInputs, shareOut, planScore, timeFit, scoreBuilt },
  };
  self.freeze = (on) => { FREEZE = !!on; };
  self.clearCache = () => { splitMemo.clear(); feasMemo.clear(); keptMemo.clear(); };
  // Whether plans are kept in the state across launches (see keptOf): keep(true) or keep(false)
  // for a test, keep(null) to go by GH.BUILD again. Returns the setting it replaced.
  self.keep = (on) => { const was = keepOn; keepOn = on == null ? null : !!on; return was; };
  // For brain.js, which keeps sessions and each week's sets the same way: get(S, list, key) is the
  // answer filed under a key (a string, hashed here), and put(S, list, keys, answer, slot, week)
  // files one, in place of what its slot held.
  self.kept = {
    get: (S, list, key) => { const c = keptOf(S); return c ? recall(c[list], hash(key)) : undefined; },
    put: (S, list, keys, answer, slot, week) => { const c = keptOf(S, true); if (c && KEEP[list]) remember(c[list], keys.map(hash), answer, KEEP[list], slot, week); },
    thisWeek,
  };
})(typeof window !== 'undefined' ? window : globalThis);
