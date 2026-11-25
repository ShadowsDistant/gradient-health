/* Build me a plan, the ready-made plans and Improve (a part of GH.customPlan that loads with the
 * plans' screens: 'planUi' in scripts/build.mjs, since only they ask for it). The engine drafts a plan
 * from what was asked; with Claude on or an on-device model there, a model then renames, regroups and
 * re-picks moves, and accept() keeps its answer only if it passes the checks. src/customplan.js has
 * the plans themselves and how they run.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;
  const C = GH.customPlan;
  const { PATTERNS, normalize, minutes, context, check, titleFrom, amountText, itemsOf, niceTitle } = C;
  const GROUP_GOAL = { legs: 'legs', chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'arms', triceps: 'arms', abs: 'abs' };
  const GOAL_GROUPS_OF = { legs: ['legs'], chest: ['chest'], back: ['back'], shoulders: ['shoulders'], arms: ['biceps', 'triceps'], abs: ['abs'] };
  const JOINT_NAME = { knee: 'knees', shoulder: 'shoulders', back: 'back', wrist: 'wrists', elbow: 'elbows', hip: 'hips', ankle: 'ankles', neck: 'neck' };
  const EQ_NAME = { band: 'a band', bar: 'a pull-up bar', ball: 'a ball', table: 'a sturdy table' };
  const clampInt = (x, lo, hi, def) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const uniq = (a) => a.filter((x, i) => x != null && a.indexOf(x) === i);
  const copy = (x) => JSON.parse(JSON.stringify(x));

  /* ================================================================== ask the coach */
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  // What someone asked for, read with the same rules as Tailor my plan, plus the split, where and
  // what with. form (optional) holds what they picked instead of typing: { days, minutes, focus }.
  function wishes(S, text, form) {
    const T = GH.tailor;
    const t = ` ${String(text || '').toLowerCase().replace(/[’']/g, '\'')} `;
    const r = T && T.parse ? T.parse(text) : {};
    const w = { days: null, minutes: null, focus: [], goals: [], careful: [], noImpact: false, gentle: null, split: null, place: null, bodyweight: false, text: clean(text, 400) };
    if (r.days) w.days = clampInt(r.days, 1, 6, null);
    else { const m = /\b(\d|one|two|three|four|five|six)[ -]?days?\b/.exec(t); if (m) w.days = clampInt(WORDS[m[1]] || Number(m[1]), 1, 6, null); }
    if (r.minutes) w.minutes = clampInt(r.minutes, 10, 90, null);
    w.focus = (r.focus || []).filter((g) => B().GROUPS.includes(g));
    w.goals = (r.goals || []).slice();
    w.careful = (r.avoid_joints || []).slice();
    w.noImpact = !!r.no_jumping;
    if (typeof r.gentle === 'boolean') w.gentle = r.gentle;
    if (/\bfull[- ]?body\b/.test(t)) w.split = 'full';
    else if (/\bupper\b[^.;]{0,24}\blower\b/.test(t)) w.split = 'upperlower';
    else if (/\bpush\b[^.;]{0,16}\bpull\b[^.;]{0,16}\blegs?\b|\bppl\b/.test(t)) w.split = 'ppl';
    if (/\b(no equipment|without equipment|bodyweight|body weight|no weights|without weights)\b/.test(t)) { w.bodyweight = true; w.place = 'home'; }
    else if (/\b(at|in) the gym\b|\bgym\b/.test(t)) w.place = 'gym';
    else if (/\b(at|from) home\b/.test(t)) w.place = 'home';
    if (form) {
      if (form.days) w.days = clampInt(form.days, 1, 6, w.days);
      if (form.minutes) w.minutes = clampInt(form.minutes, 10, 90, w.minutes);
      if (Array.isArray(form.focus) && form.focus.length) w.focus = uniq(form.focus.concat(w.focus));
    }
    if (w.days === 1 && !w.split) w.split = 'full';
    return w;
  }
  // A copy of this person with the wishes applied, for the brain's own generator to plan for.
  function sandbox(S, w) {
    const b = B();
    const S2 = copy({ profile: S.profile, vol: S.vol, prog: S.prog, complexity: S.complexity || 0, pain: S.pain || {}, excluded: S.excluded || [], catchup: S.catchup, place: S.place || {}, lastPlace: S.lastPlace || null });
    Object.assign(S2, { v: S.v, events: [], log: [], weights: [], protein: {}, health: { days: {}, hc: {}, manual: {} }, feel: {}, sleepChip: {}, celebrated: {}, customPlans: [], activePlan: null, planProg: {}, active: null });
    const p = S2.profile;
    const before = b.programFor(S.profile);
    p.days = clampInt(w.days || p.days, 2, 6, 3);
    p.weekdays = null;
    if (w.minutes) p.minutes = w.minutes;
    if (w.focus.length) {
      const first = uniq(w.focus.map((g) => GROUP_GOAL[g]));
      p.goals = first.concat((p.goals || []).filter((g) => !first.includes(g)));
    }
    for (const g of w.goals) if (!(p.goals || []).includes(g)) p.goals = (p.goals || []).concat(g);
    p.careful = uniq((p.careful || []).concat(w.careful));
    if (w.noImpact) p.impactOk = false;
    if (w.gentle != null) p.gentle = w.gentle;
    if (w.place && (w.place === 'home' || (S.profile.where || 'home') !== 'home')) p.where = w.place;
    if (w.bodyweight) p.equipment = Object.assign({}, p.equipment, { db: [], kb: [], ball: false, ballSlam: false, band: false, bar: false });
    const after = b.programFor(p);
    for (const g of b.GROUPS) {
      if (after.tiers[g] !== before.tiers[g] || S2.vol[g] == null) S2.vol[g] = after.start[g];
      S2.vol[g] = Math.max(after.floor[g], Math.min(after.cap[g], S2.vol[g]));
    }
    return S2;
  }
  // The plan the app's own generator makes from the wishes: the brain's week for a copy of this
  // person (their levels, equipment and joints, with the wishes applied), turned into a plan, or a
  // classic split's days built the same way. It only ever holds moves the brain picked for them, so
  // it's always one they can do.
  function generate(S, day, w) {
    const b = B();
    const S2 = sandbox(S, w);
    const p = S2.profile;
    const D = clampInt(w.days || p.days, 1, 6, 3);
    let days = null;
    if (!w.split) {
      const tpl = b.templateFor(p, b.programFor(p));
      const ws = b.weekStart(day);
      const sessions = tpl.map((t) => b.buildSession(S2, ws + t.offset, t.idx, { cal: { weeks: {} }, noReadiness: true, forceMult: 1 }));
      if (D === sessions.length) days = sessions.map((s) => ({ title: niceTitle(s.groups || []) || titleFrom(s.items), items: itemsOf(s) }));
    }
    if (!days) days = classic(S2, w.split || 'full', D, p.minutes, day);
    const wd = !w.days && Array.isArray(S.profile.weekdays) && S.profile.weekdays.length === days.length ? S.profile.weekdays : null;
    return normalize({ name: nameFor(w, days.length), note: noteFor(S, w, days.length, p.minutes), days, weekdays: wd, source: 'coach' }).plan;
  }
  // The classic splits: each day's name and the exercises it takes from each muscle group, in the
  // order they're done (a push day's arms are its triceps, a pull day's its biceps).
  // A day short of time keeps its main groups (the last of its third list) longest.
  const SPLIT_DAYS = {
    full: [['Full body', [['legs', 1], ['chest', 1], ['back', 1], ['shoulders', 1], ['biceps', 1], ['triceps', 1], ['abs', 1]], ['legs', 'chest', 'back']]],
    upperlower: [['Upper body', [['chest', 2], ['back', 2], ['shoulders', 1], ['biceps', 1], ['triceps', 1]], ['chest', 'back']], ['Lower body', [['legs', 4], ['abs', 2]], ['legs']]],
    ppl: [['Push', [['chest', 2], ['shoulders', 2], ['triceps', 1]], ['chest', 'shoulders']], ['Pull', [['back', 3], ['biceps', 1]], ['back']], ['Legs', [['legs', 4], ['abs', 1]], ['legs']]],
  };
  // Each group's ladders, the main ones first: a day with one exercise for a group takes turns over
  // its main ladders (squats one day, hinges the next); more take the rest in order.
  const FAMS = {
    home: { legs: [['squat', 'hinge'], ['glute', 'hamCurl', 'calf']], chest: [['push', 'chestDb'], []], back: [['row', 'pull'], ['rear', 'backExt']], shoulders: [['press', 'raise'], []], biceps: [['curl'], []], triceps: [['triceps'], []], abs: [['abs', 'absLoad', 'coreRot', 'coreSide'], []] },
    gym: { legs: [['squatG', 'hingeG'], ['lungeG', 'gluteG', 'legCurlG', 'legExtG', 'calfG']], chest: [['pressG', 'inclineG'], ['flyG']], back: [['rowG', 'pullG'], ['rearG']], shoulders: [['ohpG', 'raiseG'], []], biceps: [['curlG'], []], triceps: [['triG'], []], abs: [['absG', 'abs', 'coreSide'], ['coreRot']] },
  };
  // A classic split's days for a copy of this person (S2, see sandbox), from the engine's own picks:
  // each exercise is the ladder's move at their level today (brain.itemFor: their rung, swapped off a
  // sore joint; a ladder a health condition rules out gives way to its stand-in, brain.famFor), with
  // their reps. Sets by how much their goals want of the muscle (three for the top goals, two for
  // the rest, as the coach starts them), then the day is fitted to the time: over it, a set comes off
  // the exercise with the most to spare (the lowest goal, then the most sets) down to two, then the
  // exercises of the groups the day can do without go (the lowest goal first; of the others, one a
  // day stays, taking turns), then a lower goal's exercise goes down to one set, and only then does
  // an exercise of the day's own go; under it, a set more for the top goals first (four at most,
  // three for the rest). A day that repeats takes a letter (Full body A, Full body B) and the next
  // of each group's ladders.
  function classic(S2, split, D, mins, day) {
    const b = B();
    const kinds = SPLIT_DAYS[split] || SPLIT_DAYS.full;
    const plan = Array.from({ length: D }, (_, k) => kinds[k % kinds.length]);
    const prog = b.programFor(S2.profile);
    const ws = b.weekStart(day);
    const offs = PATTERNS[D] || PATTERNS[3];
    const budget = clampInt(mins, 10, 90, 30);
    const tierOf = (g) => prog.tiers[g] || 3;
    // What comes off first when a day runs over: the lowest goals (back counts as a goal when the
    // chest is trained hard, brain.trimTier), and a day's main groups last of all. Groups of the same
    // goal take turns, day by day, to be the one kept (Full body A keeps the abs, B the arms).
    const rank = (g) => (b.trimTier ? b.trimTier(S2, g) : tierOf(g));
    const goalOrder = (g) => { const i = (S2.profile.goals || []).findIndex((x) => (GOAL_GROUPS_OF[x] || []).includes(g)); return i < 0 ? 9 : i; };
    const tier = (it) => tierOf((M().MOVES[it.move] || {}).group);
    const turn = {}, count = {}, seen = {};
    for (const kd of plan) count[kd[0]] = (count[kd[0]] || 0) + 1;
    return plan.map((kd, k) => {
      const d = ws + offs[k];
      const at = b.placeOf(S2, d) === 'gym' ? 'gym' : 'home';
      let items = [];
      for (const [g, n] of kd[1]) {
        const [main, more] = FAMS[at][g] || [[], []];
        const ok = (f) => { try { return b.rungs(S2, b.famFor(S2, f, d), d).length > 0; } catch (e) { return false; } };
        const mains = main.filter(ok), rest = more.filter(ok);
        const t = turn[g] || 0;
        turn[g] = t + 1;
        // Turns over the main ladders day by day, then the others.
        const fams = mains.length ? mains.slice(t % mains.length).concat(mains.slice(0, t % mains.length)) : [];
        const pick = (n === 1 ? fams.slice(0, 1) : fams.concat(rest)).slice(0, n);
        for (const f0 of pick) {
          const fam = b.famFor(S2, f0, d);
          let it = null;
          try { it = b.itemFor(S2, { fam, group: g, sets: tierOf(g) === 1 ? (prog.level >= 1 ? 4 : 3) : tierOf(g) === 2 ? 3 : 2 }, d); } catch (e) { it = null; }
          if (!it || items.some((x) => x.move === it.moveId)) continue;
          items.push(it.timed ? { move: it.moveId, sets: it.sets, secs: it.target } : { move: it.moveId, sets: it.sets, reps: it.target });
        }
      }
      const one = { days: [{ items }] };
      const time = () => minutes(S2, one, 0, d);
      const keep = kd[2] || [];
      const nth = (seen[kd[0]] || 0);
      const extra = uniq(kd[1].map(([g]) => g).filter((g) => !keep.includes(g))).sort((x, y) => rank(x) - rank(y) || goalOrder(x) - goalOrder(y));
      const order = [];
      for (const r of uniq(extra.map(rank))) { const same = extra.filter((g) => rank(g) === r); const k2 = nth % same.length; order.push(...same.slice(k2), ...same.slice(0, k2)); }
      // The day's own one of the other groups (they take turns) stays with its main groups.
      const own = order[0];
      const cut = (it) => { const g = (M().MOVES[it.move] || {}).group; return keep.includes(g) || g === own ? rank(g) : 100 + order.indexOf(g) * 10; };
      // (The last of the worst: of a group's exercises, its last, the extra ladders after the main.)
      const worst = (ok) => { let w = -1; items.forEach((it, i) => { if (ok(it) && (w < 0 || cut(it) >= cut(items[w]))) w = i; }); return w; };
      const groupOf = (it) => (M().MOVES[it.move] || {}).group;
      const twice = (it) => items.filter((x) => groupOf(x) === groupOf(it)).length > 1;
      for (let guard = 0; guard < 80 && time() > budget + 1; guard++) {
        // Sets above two come off first, from the exercise with the most to spare.
        let pick = -1;
        items.forEach((it, i) => { if (it.sets > 2 && (pick < 0 || cut(it) + it.sets > cut(items[pick]) + items[pick].sets)) pick = i; });
        if (pick >= 0) { items[pick].sets--; continue; }
        // Then the other groups' exercises go, the lowest goal first, then a group's second exercise.
        const extra = worst((it) => cut(it) >= 100);
        if (extra >= 0) { items.splice(extra, 1); continue; }
        const more = worst(twice);
        if (more >= 0) { items.splice(more, 1); continue; }
        // Then a lower goal's exercise goes down to one set (a top goal isn't left out for a second
        // set of a lower one), and only then does one of the day's own go.
        const low = worst((it) => it.sets > 1);
        if (low >= 0 && rank(groupOf(items[low])) > 1) { items[low].sets--; continue; }
        if (items.length > 2) { items.splice(worst(() => true), 1); continue; }
        if (low < 0) break;
        items[low].sets--;
      }
      for (let guard = 0; guard < 20 && items.length; guard++) {
        let pick = -1;
        items.forEach((it, i) => { if (it.sets < (tier(it) <= 2 ? 4 : 3) && (pick < 0 || tier(it) < tier(items[pick]) || (tier(it) === tier(items[pick]) && it.sets < items[pick].sets))) pick = i; });
        if (pick < 0) break;
        items[pick].sets++;
        if (time() > budget) { items[pick].sets--; break; }
      }
      seen[kd[0]] = (seen[kd[0]] || 0) + 1;
      const title = count[kd[0]] > 1 ? `${kd[0]} ${String.fromCharCode(64 + seen[kd[0]])}` : kd[0];
      return { title, items };
    });
  }

  /* ---------------------------------------------------------------- templates */
  // Ready-made plans, built for this person by the engine (classic above): their days and minutes,
  // their equipment and level, moves they can do. No equipment is offered to someone who has some
  // (for a trip, or a day away from it).
  const TEMPLATES = [
    { id: 'full', name: 'Full body', about: 'Every muscle, every workout' },
    { id: 'upperlower', name: 'Upper and lower', about: 'Upper body one day, legs and core the next' },
    { id: 'ppl', name: 'Push, pull, legs', about: 'Chest and shoulders, then back and biceps, then legs' },
    { id: 'bodyweight', name: 'No equipment', about: 'Full body with nothing but you' },
  ];
  const hasKit = (p) => { const eq = p.equipment || {}; return (p.where || 'home') !== 'home' || !!((eq.db && eq.db.length) || (eq.kb && eq.kb.length) || eq.band || eq.bar || eq.ball); };
  function templates(S) {
    const p = S.profile;
    const D = clampInt(p.days, 1, 6, 3);
    return TEMPLATES.filter((t) => t.id !== 'bodyweight' || hasKit(p)).map((t) => Object.assign({}, t, { days: t.id === 'ppl' ? Math.max(3, D) : t.id === 'upperlower' ? Math.max(2, D) : D, minutes: clampInt(p.minutes, 10, 90, 30) }));
  }
  // One template as a plan to save (not saved yet), or null.
  function template(S, day, id) {
    const t = templates(S).find((x) => x.id === id);
    if (!t) return null;
    const w = wishes(S, '');
    w.split = id === 'bodyweight' ? 'full' : id;
    w.days = t.days;
    if (id === 'bodyweight') { w.bodyweight = true; w.place = 'home'; }
    const plan = generate(S, day, w);
    plan.name = t.name;
    plan.source = 'you';
    const wd = S.profile.weekdays;
    if (Array.isArray(wd) && wd.length === plan.days.length) plan.weekdays = wd.slice().sort((a, b) => a - b);
    return plan;
  }
  const FOCUS_NAME = { biceps: 'bigger arms', triceps: 'bigger arms', chest: 'a bigger chest', legs: 'stronger legs', back: 'a stronger back', shoulders: 'broader shoulders', abs: 'a stronger core' };
  function nameFor(w, D) {
    const split = { full: 'full body', upperlower: 'upper and lower', ppl: 'push, pull, legs' }[w.split];
    if (D === 1) return w.focus.length ? `One day for ${FOCUS_NAME[w.focus[0]]}` : 'One full-body day';
    if (split) return `${D}-day ${split}`;
    if (w.focus.length) return `${D}-day plan for ${FOCUS_NAME[w.focus[0]]}`;
    return `${D}-day plan`;
  }
  function noteFor(S, w, D, mins) {
    const bits = [`${D} ${D === 1 ? 'workout' : 'workouts'} a week, about ${mins} minutes each`];
    if (w.focus.length) bits.push(`${uniq(w.focus.map((g) => (g === 'biceps' || g === 'triceps' ? 'arms' : g)))[0]} first`);
    const joints = uniq((S.profile.careful || []).concat(w.careful));
    if (joints.length) bits.push(`easy on your ${joints.map((j) => JOINT_NAME[j] || j).join(' and ')}`);
    if (w.noImpact) bits.push('no jumping');
    if (w.bodyweight) bits.push('no equipment');
    const s = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  }
  // What the app already knows and uses, in plain words (shown before building, and given to a model).
  function knows(S) {
    const p = S.profile;
    const out = [];
    const GOAL = { abs: 'visible abs', arms: 'bigger arms', chest: 'a bigger chest', legs: 'legs and glutes', back: 'back and posture', shoulders: 'shoulders', fat: 'losing fat', strength: 'strength', endurance: 'endurance', mobility: 'mobility', consistency: 'showing up' };
    const goals = (p.goals || []).map((g) => GOAL[g]).filter(Boolean);
    if (goals.length) out.push(['Goals', goals.slice(0, 3).join(', ')]);
    out.push(['Schedule', `${p.days} days a week, ${p.minutes} min`]);
    const eq = p.equipment || {};
    const kit = [];
    if (eq.db && eq.db.length) kit.push(`dumbbells ${eq.db.join('/')} ${p.units || 'lb'}`);
    if (eq.kb && eq.kb.length) kit.push(`kettlebell ${eq.kb.join('/')} ${p.units || 'lb'}`);
    for (const k of ['band', 'bar', 'ball', 'table']) if (eq[k]) kit.push(EQ_NAME[k].replace(/^an? /, ''));
    if ((p.where || 'home') !== 'home') kit.push('a gym');
    out.push(['Equipment', kit.length ? kit.join(', ') : 'none, just your body']);
    const joints = uniq((p.careful || []).concat(Object.entries(S.pain || {}).filter(([, until]) => until >= B().dayOf(Date.now(), (p.prefs && p.prefs.rollHour) || 4)).map(([j]) => j)));
    if (joints.length) out.push(['Careful with', joints.map((j) => JOINT_NAME[j] || j).join(', ')]);
    if (p.age > 0) out.push(['Age', String(p.age)]);
    const cond = Array.isArray(p.conditions) ? p.conditions.map((c) => (typeof c === 'string' ? c : c && (c.name || c.id))).filter(Boolean) : [];
    if (cond.length) out.push(['Health', cond.join(', ')]);
    return out;
  }

  /* ---------------------------------------------------------------- a model's take */
  // The moves a model may use: for each family the person's own level and the ones either side of
  // it, the draft's moves, and nothing they can't do (checked for the wishes too).
  function allowedMoves(S, day, w, draft) {
    const S2 = sandbox(S, w);
    const ctx = context(S2, day);
    const ids = [];
    const push = (id) => { if (id && !ids.includes(id) && check(ctx, id).ok) ids.push(id); };
    for (const d of draft.days) for (const it of d.items) push(it.move);
    for (const [fam, lad] of Object.entries(M().LADDERS)) {
      const list = lad.rungs.filter((id) => check(ctx, id).ok);
      if (!list.length) continue;
      const st = S2.prog[fam];
      const at = Math.max(0, st ? list.indexOf(st.rung) : 0);
      for (const id of list.slice(Math.max(0, at - 1), at + 2)) push(id);
    }
    return ids.slice(0, 90);
  }
  const plainForModel = (plan) => ({ name: plan.name, days: plan.days.map((d) => ({ title: d.title, items: d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.secs != null ? it.secs : it.reps })) })) });
  const PLAN_RULES = [
    'You are a strength coach. You adjust a draft workout plan so it fits what the person asked for, and answer with JSON only.',
    'Use only move ids from MOVES. Keep the same number of days. Put 3 to 8 moves in each day, bigger moves first.',
    'sets: 2 to 5. reps: 5 to 20; for moves marked seconds, reps is how many seconds to hold (20 to 60).',
    'title: 1 to 3 words for each day. name: 2 to 5 words for the plan. note: one short, friendly sentence on what the plan does.',
  ].join('\n');
  function movesText(ids) {
    return ids.map((id) => { const m = M().MOVES[id]; return `${id}: ${m.name} (${String((B().GROUP_NAME || {})[m.group] || m.group).toLowerCase()}${m.timed ? ', seconds' : ''})`; }).join('\n');
  }
  function planMessages(S, w, draft, ids) {
    const about = knows(S).map(([k, v]) => `${k}: ${v}`).join('. ');
    return [
      { role: 'system', content: `${PLAN_RULES}\n\nMOVES\n${movesText(ids)}` },
      { role: 'user', content: `Request: ${w.text || 'a plan that fits me'}\nAbout them: ${about}\nDraft: ${JSON.stringify(plainForModel(draft))}` },
    ];
  }
  // A grammar that holds the on-device model to a plan of exactly `days` days made of `ids`.
  function planGrammar(ids, days) {
    const q = (s) => `"\\"${s}\\""`;
    const dayRule = Array.from({ length: days }, () => 'day').join(' "," ');
    return [
      `root ::= "{\\"name\\":" name ",\\"note\\":" note ",\\"days\\":[" ${dayRule} "]}"`,
      'day ::= "{\\"title\\":" title ",\\"items\\":[" item ("," item){1,7} "]}"',
      'item ::= "{\\"move\\":" move ",\\"sets\\":" [1-6] ",\\"reps\\":" reps "}"',
      `move ::= ${ids.map(q).join(' | ')}`,
      'reps ::= [1-9] | [1-9] [0-9]',
      'name ::= "\\"" [A-Za-z0-9 ,&-]{2,36} "\\""',
      'title ::= "\\"" [A-Za-z0-9 ,&-]{2,24} "\\""',
      'note ::= "\\"" [a-zA-Z0-9 ,.\'!?-]{0,150} "\\""',
    ].join('\n');
  }
  function planSchema(ids) {
    return {
      type: 'object',
      properties: {
        name: { type: 'string' },
        note: { type: 'string' },
        days: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { move: { type: 'string', enum: ids }, sets: { type: 'integer' }, reps: { type: 'integer' } }, required: ['move', 'sets', 'reps'], additionalProperties: false } } }, required: ['title', 'items'], additionalProperties: false } },
      },
      required: ['name', 'note', 'days'],
      additionalProperties: false,
    };
  }
  function claudePrompt(S, w, draft, ids) {
    return [
      'Build this person a workout plan they can run in the app. Adjust the draft so it fits their request and what you know about them.',
      `Keep exactly ${draft.days.length} days. 3 to 8 moves a day, bigger moves first. sets 2 to 5; reps 5 to 20, or seconds (20 to 60) for moves marked seconds.`,
      'Use only these moves (id: name):', movesText(ids), '',
      `Their request: ${w.text || 'a plan that fits me'}`,
      `Draft: ${JSON.stringify(plainForModel(draft))}`,
      'name: 2 to 5 words. Each day\'s title: 1 to 3 words. note: one short, friendly sentence on what the plan does.',
    ].join('\n');
  }
  // A model's answer, kept only if it's a plan this person can do with the days they asked for, and
  // it passes the checks the plan review makes on the coach's plan (src/planreview.js):
  //  - time: each day fits the time asked for, or runs no longer than the draft's own day (a set
  //    comes off the move with the most to spare until it fits, down to 1 as the coach's own days
  //    have them; the move the day leads with and the groups they asked to focus on count as having
  //    fewer, so they keep theirs longer);
  //  - coverage: every muscle group the draft trains keeps at least half of its weekly sets;
  //  - focus: the groups they asked to focus on keep at least two thirds of the draft's sets;
  //  - balance: pulling still balances pushing about as well as in the draft.
  // Core work goes last in each day (a tired core shouldn't undercut the heavier lifts); otherwise
  // the model's order stands. Anything else keeps the draft. Returns the plan, or null.
  function accept(S, day, w, draft, raw, ids) {
    if (!raw || typeof raw !== 'object') return null;
    const { plan, report } = normalize(Object.assign({}, raw, { source: 'coach', weekdays: draft.weekdays }));
    if (report.unknown.length || plan.days.length !== draft.days.length) return null;
    const allowed = new Set(ids);
    for (const d of plan.days) {
      if (d.items.length < 2 || d.items.some((it) => !allowed.has(it.move))) return null;
      for (const it of d.items) {
        it.sets = Math.max(1, Math.min(6, it.sets));
        const m = M().MOVES[it.move];
        if (m.timed) it.secs = Math.max(10, Math.min(120, it.secs)); else it.reps = Math.max(3, Math.min(30, it.reps));
      }
      d.items = d.items.filter((it, i) => d.items.findIndex((x) => x.move === it.move) === i);
      const core = (it) => M().MOVES[it.move].group === 'abs';
      d.items = d.items.filter((it) => !core(it)).concat(d.items.filter(core));
    }
    const budget = clampInt((w && w.minutes) || S.profile.minutes, 10, 90, 30);
    const focus = (it) => ((w && w.focus) || []).includes(M().MOVES[it.move].group);
    for (let i = 0; i < plan.days.length; i++) {
      const d = plan.days[i];
      const limit = Math.max(budget, minutes(S, draft, i, day)) + 2;
      // (On a tie, the later move gives a set first.)
      const spare = (it, k) => it.sets - (focus(it) ? 1 : 0) - (k === 0 ? 2 : 0) + k / 100;
      for (let guard = 0; guard < 200 && minutes(S, plan, i, day) > limit; guard++) {
        let pick = -1;
        d.items.forEach((it, k) => { if (it.sets > 1 && (pick < 0 || spare(it, k) > spare(d.items[pick], pick))) pick = k; });
        if (pick < 0) break;
        d.items[pick].sets--;
      }
      if (minutes(S, plan, i, day) > limit) return null;
    }
    const setsOf = (p) => {
      const out = {};
      for (const d of p.days) for (const it of d.items) { const m = M().MOVES[it.move]; if (m && GROUP_GOAL[m.group]) out[m.group] = (out[m.group] || 0) + it.sets; }
      return out;
    };
    const was = setsOf(draft), now = setsOf(plan);
    for (const g of Object.keys(was)) if (was[g] >= 2 && (now[g] || 0) < Math.ceil(was[g] / 2)) return null;
    for (const g of (w && w.focus) || []) if (was[g] && (now[g] || 0) < Math.ceil((was[g] * 2) / 3)) return null;
    const balance = (x) => { const push = (x.chest || 0) + (x.shoulders || 0), pull = (x.back || 0) * 1.2; return Math.max(push, pull) <= 0 ? 1 : Math.min(push, pull) / Math.max(push, pull); };
    if (balance(now) < Math.min(0.5, balance(was) - 0.15)) return null;
    if (!plan.note) plan.note = draft.note;
    return plan;
  }
  // Which model can refine a plan here: Claude when it's on and allowed, else the on-device model
  // when one is on the phone. Resolves 'claude', 'device' or null.
  async function modelFor(S) {
    if (S.ai && S.ai.mode === 'api') return GH.ai && GH.ai.hasKey && GH.ai.hasKey() && S.ai.consentAt && GH.ai.json ? 'claude' : null;
    try {
      if (!GH.lazy) return null;
      const llm = await GH.lazy('llm');
      if (!llm.available().ok || !GH.deviceCoach) return null;
      return GH.deviceCoach.pick(S, await llm.installed()) ? 'device' : null;
    } catch (e) { return null; }
  }
  // The draft, refined by a model when there is one. Resolves { plan, by, error? } (by: 'claude',
  // 'device' or null when the draft stands; error: why a model's take didn't come, such as a Claude
  // spending limit, for the screen to say).
  async function refine(S, day, w, draft, signal) {
    const by = await modelFor(S);
    if (!by) return { plan: draft, by: null };
    const ids = allowedMoves(S, day, w, draft);
    let raw = null, error = null;
    try {
      if (by === 'claude') raw = await GH.ai.json(S, day, claudePrompt(S, w, draft, ids), planSchema(ids), { feature: 'build' });
      else {
        const llm = await GH.lazy('llm');
        const id = GH.deviceCoach.pick(S, await llm.installed());
        await llm.load(id);
        const text = await llm.chat(planMessages(S, w, draft, ids), { grammar: planGrammar(ids, draft.days.length), maxTokens: 200 * draft.days.length + 150, temperature: 0.3, signal });
        raw = readJson(text);
      }
    } catch (e) { raw = null; error = e; }
    if (signal && signal.aborted) return { plan: draft, by: null };
    const plan = accept(S, day, w, draft, raw, ids);
    return plan ? { plan, by } : Object.assign({ plan: draft, by: null }, error ? { error } : {});
  }
  // Their own plan, reworked by a model from their data and what they ask for, and held to the same
  // checks as a plan built from scratch (accept: the same days, time, coverage, focus and balance).
  // Resolves { plan, by, changes, error? }: plan is null when there's no model or its take didn't
  // pass, and changes says what's different, day by day.
  async function improve(S, day, plan, text, signal) {
    const ask = clean(text, 300);
    const w = wishes(S, ask);
    w.days = plan.days.length;
    w.text = `Improve my own plan from my data${ask ? `, and: ${ask}` : ''}. Keep what works and what I clearly chose; change what would help most.`;
    const draft = copy(plan);
    const r = await refine(S, day, w, draft, signal);
    if (!r.by) return Object.assign({ plan: null, by: null, changes: [] }, r.error ? { error: r.error } : {});
    const out = Object.assign(r.plan, { name: plan.name });
    return { plan: out, by: r.by, changes: diff(plan, out) };
  }
  // What changed between two versions of a plan, day by day, in plain words.
  function diff(a, b) {
    const out = [];
    const name = (id) => (M().MOVES[id] ? M().MOVES[id].name : id);
    const amt = (it) => `${it.sets} × ${amountText(it)}`;
    b.days.forEach((d, i) => {
      const was = (a.days[i] && a.days[i].items) || [];
      const day = `Day ${i + 1}`;
      for (const it of d.items) {
        const x = was.find((y) => y.move === it.move);
        if (!x) out.push(`${day}: added ${name(it.move)}, ${amt(it)}`);
        else if (x.sets !== it.sets || (x.reps || 0) !== (it.reps || 0) || (x.secs || 0) !== (it.secs || 0)) out.push(`${day}: ${name(it.move)} ${amt(x)} → ${amt(it)}`);
      }
      for (const x of was) if (!d.items.some((it) => it.move === x.move)) out.push(`${day}: took out ${name(x.move)}`);
    });
    return out;
  }
  function readJson(text) {
    const s = String(text || '').trim();
    for (const tail of ['', '"}', '}', ']}', '}]}', '"}]}']) { try { return JSON.parse(s + tail); } catch (e) { /* try the next */ } }
    return null;
  }
  Object.assign(C, { wishes, generate, templates, template, knows, allowedMoves, planMessages, planGrammar, planSchema, accept, refine, modelFor, readJson, improve, diff });
})(typeof window !== 'undefined' ? window : globalThis);
