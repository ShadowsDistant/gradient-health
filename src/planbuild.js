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
  const clampInt = (x, lo, hi, def) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const clean = (s, max) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const uniq = (a) => a.filter((x, i) => x != null && a.indexOf(x) === i);
  const copy = (x) => JSON.parse(JSON.stringify(x));

  /* ================================================================== ask the coach */
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  // The quick choices above the request's field (the things research finds matter most and the app
  // can't know for sure: research_notes ai_made_plans 2 and 5, adherence 4): what they want most
  // from this plan, how it should feel, and anything to leave out. One tap each at most, each
  // already set from what the app knows. { most, feel, skip }, each { options: [[id, label]], value }
  // (skip's value is a list).
  const MOST = { arms: 'Bigger arms', abs: 'Abs', chest: 'Chest', legs: 'Legs', back: 'Back', shoulders: 'Shoulders', strength: 'Strength', all: 'A bit of everything' };
  const FEEL = { easy: 'Easy to keep up', steady: 'Steady', hard: 'Push me' };
  const SKIP = { jumping: 'Jumping', floor: 'Floor work', knee: 'Knees', shoulder: 'Shoulders', back: 'Back', wrist: 'Wrists' };
  function choices(S, day) {
    const p = S.profile;
    const mine = uniq((p.goals || []).filter((g) => MOST[g])).slice(0, 3);
    const most = (mine.length ? mine : ['arms', 'abs', 'legs']).concat('all');
    // Easy for someone new, someone on a gentle plan, or someone missing a workout a week or more.
    const L = GH.person && p.workouts !== false ? GH.person.lately(S, day) : null;
    const fresh = (p.experience === 'never' || p.experience === 'onoff') && day - (p.startDay || day) < 28;
    const easy = !!p.gentle || fresh || !!(L && L.perWeek != null && L.planned >= 4 && L.perWeek <= p.days - 1);
    const skip = [p.impactOk === false ? 'jumping' : '', p.floorOk === false ? 'floor' : ''].concat(p.careful || []).filter((k) => SKIP[k]);
    const opts = (map, ids) => ids.map((id) => [id, map[id]]);
    return {
      most: { options: opts(MOST, most), value: mine.length ? mine[0] : 'all' },
      feel: { options: opts(FEEL, Object.keys(FEEL)), value: easy ? 'easy' : 'steady' },
      skip: { options: opts(SKIP, Object.keys(SKIP)), value: skip },
    };
  }
  // What someone asked for, read with the same rules as Tailor my plan, plus the split, where and
  // what with. form (optional) holds what they picked instead of typing: { days, minutes, focus, and
  // the quick choices: most, feel, skip }.
  function wishes(S, text, form) {
    const T = GH.tailor;
    const t = ` ${String(text || '').toLowerCase().replace(/[’']/g, '\'')} `;
    const r = T && T.parse ? T.parse(text) : {};
    const w = { days: null, minutes: null, focus: [], goals: [], careful: [], noImpact: false, noFloor: false, gentle: null, split: null, place: null, bodyweight: false, most: null, feel: null, skip: [], text: clean(text, 400) };
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
      // What they want most goes first (after anything they typed); easy to keep up is a gentler
      // start; what's left out is left out as Tailor would.
      if (form.most && MOST[form.most]) {
        w.most = form.most;
        if (GOAL_GROUPS_OF[form.most]) w.focus = uniq(w.focus.concat(GOAL_GROUPS_OF[form.most]));
        else if (form.most === 'strength' && !w.goals.includes('strength')) w.goals.push('strength');
      }
      if (form.feel && FEEL[form.feel]) { w.feel = form.feel; if (form.feel === 'easy' && w.gentle == null) w.gentle = true; }
      w.skip = uniq(Array.isArray(form.skip) ? form.skip.filter((k) => SKIP[k]) : []);
      for (const k of w.skip) { if (k === 'jumping') w.noImpact = true; else if (k === 'floor') w.noFloor = true; else if (!w.careful.includes(k)) w.careful.push(k); }
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
    if (w.noFloor) p.floorOk = false;
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
    // (Abs come last in a day, so they aren't "first": they get the most.)
    if (w.focus.length) { const f = uniq(w.focus.map((g) => (g === 'biceps' || g === 'triceps' ? 'arms' : g)))[0]; bits.push(f === 'abs' ? 'the most for your abs' : `${f} first`); }
    const joints = uniq((S.profile.careful || []).concat(w.careful));
    if (joints.length) bits.push(`easy on your ${joints.map((j) => JOINT_NAME[j] || j).join(' and ')}`);
    if (w.noImpact) bits.push('no jumping');
    if (w.noFloor) bits.push('nothing on the floor');
    if (w.bodyweight) bits.push('no equipment');
    const s = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  }
  // What the coach uses, as the build sheet lists it: who this is, in the words a model gets
  // (GH.person.shown, src/person.js), so the list and what's sent can't drift apart. o: { to:
  // 'claude' | 'device' (who would read it), wide (Claude: with the newer OK) }. Each row is
  // [label, value, 'device' when it stays on the phone].
  function knows(S, day, o) {
    const P = GH.person;
    const d = day != null ? day : B().dayOf(Date.now(), (S.profile.prefs && S.profile.prefs.rollHour) || 4);
    return P ? P.shown(S, d, Object.assign({ to: 'device' }, o)) : [];
  }

  /* ---------------------------------------------------------------- the rules for this person */
  // What a built plan is held to, from the research the app follows, for this person and what they
  // asked. The prompts state them and accept() checks them, so a model can't quietly return six
  // sets of curls, a goal muscle once a week or nine exercises in twenty minutes.
  //  - exercises a day: what the minutes hold (the app's own table: a set with its rest takes a
  //    minute and a half to two, and few, simple sessions are the ones kept; research_notes:
  //    adherence 1 and 2), or as many as the draft's day has once its doubles are folded together;
  //  - sets: 1 to 4 of one exercise in a day (3 when they asked for easy to keep up); past that a
  //    goal muscle gets a second exercise (sets in a session lose quality: individualized_dose 2);
  //  - reps: each move's own range, as the engine progresses it (brain.rangeFor), up to 30 where
  //    their weights are light for them: light loads grow muscle like heavy ones when sets end near
  //    the last rep, to about 30 (light_loads_bodyweight 1 and 2);
  //  - each goal muscle (their top goals): its weekly sets between the engine's floor and cap for
  //    their level (brain.programFor; the cap is 12 when they eat little protein, since more sets
  //    don't make up for food: low_protein_diet 3), on at least 2 days when the plan has 2
  //    (abs_and_arms 2 and 4);
  //  - order: goal muscles first, abs and core last (How it works: Your goals go first);
  //  - and the research's other limits: every muscle the draft trains keeps at least 4 sets a week
  //    and none goes past 30 (individualized_dose 1), abs past about 18 and arms past about 20 add
  //    little (abs_and_arms 2 and 4), about 10 sets of one muscle in a session at most (legs, which
  //    is several muscles here, aside: individualized_dose 2), at most about 60 crunch-type reps in
  //    a session (abs_and_arms 3), and 2 to 3 sets of an exercise from 60 (individualized_dose 5).
  // Each limit is read against the draft too: a model isn't held to more than the engine's own plan.
  const SETS_MAX = 4, LIGHT_REPS = 30;
  const WEEK = [4, 30], GOAL_CAP = { abs: 18, biceps: 20, triceps: 20 }, DAY_SETS = 10, FLEX_REPS = 60;
  const perDayFor = (mins) => (mins <= 12 ? [2, 3] : mins <= 20 ? [3, 5] : mins <= 30 ? [4, 6] : mins <= 45 ? [5, 8] : [6, 9]);
  // Crunch-type work (dynamic trunk flexion): the crunch ladder, reverse crunches, leg raises and V-ups.
  const FLEX = ['ab_revcrunch', 'ab_legraise', 'ab_vup', 'cable_crunch', 'hang_knee'];
  const flexion = (id) => FLEX.includes(id) || (M().MOVES[id] || {}).family === 'absLoad';
  function rules(S, day, w, draft) {
    const b = B(), P = GH.person, A = GH.access;
    const S2 = sandbox(S, w), p = S2.profile, prog = b.programFor(p);
    const D = draft ? draft.days.length : clampInt(w.days || p.days, 1, 6, 3);
    const mins = clampInt(w.minutes || p.minutes, 10, 90, 30);
    const lowEat = !!(P && P.eats(p).protein === 'low');
    // (Light, or right but under about half their one-rep max: sets run long either way.)
    const light = (fam) => { const f = P ? P.loadFeel(S2, fam) : null; return !!f && (f.feel === 'light' || f.high); };
    const reps = (id) => {
      const m = M().MOVES[id];
      const [lo, hi] = b.rangeFor(S2, m, m.family, day);
      return m.timed || !/db|kb/.test(m.load || '') || !light(m.family) ? [lo, hi] : [lo, Math.max(hi, LIGHT_REPS)];
    };
    const goals = b.GROUPS.filter((g) => prog.tiers[g] === 1).map((g) => ({ group: g, floor: prog.floor[g], cap: Math.min(lowEat ? 12 : prog.cap[g], GOAL_CAP[g] || WEEK[1]), days: Math.min(2, D) }));
    const older = !!(A && A.ageOf && A.ageOf(p) >= 60);
    return { S2, D, mins, perDay: perDayFor(mins), sets: [1, w.feel === 'easy' || older ? SETS_MAX - 1 : SETS_MAX], reps, goals, lowEat, light, older, week: WEEK, daySets: DAY_SETS, flexReps: FLEX_REPS, tier: (g) => (g === 'abs' ? 9 : prog.tiers[g] || (GROUP_GOAL[g] ? 3 : 10)) };
  }
  // A day's crunch-type reps, and a muscle's sets in it (the limits above).
  const flexOf = (d) => d.items.filter((it) => flexion(it.move) && it.reps).reduce((a, it) => a + it.sets * it.reps, 0);
  const daySetsOf = (d, g) => d.items.filter((it) => M().MOVES[it.move].group === g).reduce((a, it) => a + it.sets, 0);
  const groupWord = (g) => (g === 'abs' ? 'abs' : String((B().GROUP_NAME || {})[g] || g).toLowerCase());
  const listWords = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  // The rules in words, for a model. o: { to: 'claude' | 'device', wide } (what it may be told about
  // the person, GH.person.advice).
  function rulesLines(S, day, R, o) {
    const P = GH.person;
    const L = [
      `Keep exactly ${R.D} ${R.D === 1 ? 'day' : 'days'}. ${R.perDay[0]} to ${R.perDay[1]} exercises a day: that's what ${R.mins} minutes holds.`,
      `${R.sets[0]} to ${R.sets[1]} sets of an exercise, never more than ${R.sets[1]} in a day. When a muscle needs more, give it a second exercise, up to ${R.daySets} sets of one muscle in a day.`,
      `Reps (or seconds) inside each move's own range, given in MOVES. Crunch-type moves (crunches, reverse crunches, leg raises, sit-ups): ${R.flexReps} reps a day at most, all sets together.`,
    ];
    if (R.goals.length) L.push(`Each week: ${R.goals.map((g) => `${groupWord(g.group)} ${g.floor} to ${g.cap} sets`).join(', ')}${R.D >= 2 ? ', each on at least 2 days' : ''}.`);
    L.push(`Every ${R.goals.length ? 'other ' : ''}muscle the draft trains: ${R.week[0]} to ${R.week[1]} sets a week (fewer only where the draft has fewer).`);
    L.push('Order each day: the muscles they want most first, big moves before small ones, abs and core last.');
    return L.concat(P ? P.advice(S, day, o) : [], P ? [P.guard(S, day, o)].filter(Boolean) : []);
  }

  /* ---------------------------------------------------------------- why it's theirs */
  // Each built plan says why it's this person's: two or three lines, each naming a fact about them
  // and what the plan does about it, and a short line for each day. A model writes them (Claude) or
  // picks them (the on-device model, from the app's own); with no model the app's own stand. All of
  // them go through say(): a line that isn't in the app's voice, has a number that wasn't given or
  // isn't in the plan, crosses what a model may say (GH.coach.keepSafe) or names a fact the model
  // wasn't given is dropped.
  const WHY = { lines: C.LIMITS.whys, line: C.LIMITS.why, day: C.LIMITS.dayWhy };
  // The plan's own numbers, which its reasons may use: days, each day's exercises and minutes, sets,
  // reps and seconds, each group's weekly sets and days.
  function planNumbers(S, day, plan) {
    const out = [plan.days.length];
    const sets = {}, days = {};
    plan.days.forEach((d, i) => {
      out.push(d.items.length, minutes(S, plan, i, day));
      for (const g of uniq(d.items.map((it) => M().MOVES[it.move].group))) days[g] = (days[g] || 0) + 1;
      for (const it of d.items) { out.push(it.sets, it.secs != null ? it.secs : it.reps); const g = M().MOVES[it.move].group; sets[g] = (sets[g] || 0) + it.sets; }
    });
    for (const g of Object.keys(sets)) out.push(sets[g], days[g]);
    out.push((sets.biceps || 0) + (sets.triceps || 0));
    return out.join(' ');
  }
  // Words that name a fact about the person, by the fact's id (GH.person.facts, plus 'asked': what
  // they asked for here). A line that uses them when no such fact was given is one the model made up.
  const NAMES = [
    [['eats', 'protein'], /\b(protein|eat(s|ing)?|ate|food|diet|meals?|fruit|veg\w*|nutrition|calories?|appetite)\b/i],
    [['sleep'], /\b(sleep\w*|slept|bedtime|tired|nights?)\b/i],
    [['build'], /\b(lean|slim|skinny|thin|tall|height|bmi|body ?weight|your (weight|size|build)|weigh)\b/i],
    [['joints', 'pain', 'care'], /\b(injur\w+|pain\w*|sore|hurt\w*|ache\w*|careful|easy on|gentle on)\b/i],
    [['does', 'felt'], /\b(miss(ed|ing)?|skipp\w+|cut short|running long|lately|last (4|four) weeks|attendance|too (hard|easy))\b/i],
    [['up', 'stuck'], /\b(stall\w*|stuck|plateau\w*|not moving|stopped moving|moving up)\b/i],
    [['load'], /\b(too )?(light|heavy)\b/i],
    [['likes'], /\byou (hid|pinned|picked|swapped|turned down)\b/i],
    [['level'], /\b(beginner|new to|never trained|just start\w+|experienced|weeks? (in|with the app))\b/i],
    [[], /\b(arthritis|osteo\w+|diabet\w+|blood pressure|heart (condition|disease)|asthma|condition|doctor|medical|medic\w+|pregnan\w+|years old|your age)\b/i],
  ];
  // A model's line as shown, or '' when it can't be: one line in the app's voice (no dashes for
  // punctuation, no exclamation marks, a capital and a full stop), within its length, its numbers
  // given or the plan's, nothing a model may not say, and no fact the model wasn't given.
  function say(text, max, o) {
    let s = clean(text, 400).replace(/!+/g, '.').replace(/\.{2,}/g, '.').replace(/\s+([.,;:])/g, '$1');
    // (Plain words only: letters, numbers and everyday punctuation. Markup, or a dash used as
    // punctuation, isn't the app's voice.)
    if (!s || s.length > max || / - /.test(s) || /[^\w\s.,;:'"\u2019()/%+?&-]/.test(s)) return '';
    s = `${s[0].toUpperCase()}${s.slice(1)}`;
    if (!/[.?]$/.test(s)) s += '.';
    const K = GH.coach;
    if (K && K.keepToGiven && K.keepToGiven(s, o.known).cut) return '';
    if (K && K.unsafe && K.unsafe(s, o.strict)) return '';
    if (/\b(guarantee\w*|promise\w*|in \d+ (days|weeks|months)|six[- ]pack in)\b/i.test(s)) return '';
    for (const [ids, re] of NAMES) if (re.test(s) && !ids.some((id) => o.facts.includes(id))) return '';
    return s;
  }
  // The app's own "because you" lines for a plan, the most telling first: [{ key, fact, line }]
  // (fact: the fact about them it names, by GH.person's id; key: which line it is). Each is true of
  // this plan (its own numbers) and of what the app knows or was asked.
  function ownWhy(S, day, w, plan, R) {
    const P = GH.person, p = R.S2.profile;
    const out = [];
    const add = (key, fact, line) => { if (line && line.length <= WHY.line) out.push({ key, fact, line }); };
    const MV = M().MOVES;
    const D = plan.days.length;
    const all = plan.days.flatMap((d) => d.items);
    const daysOf = (groups) => plan.days.filter((d) => d.items.some((it) => groups.includes(MV[it.move].group))).length;
    const trained = uniq(R.goals.map((g) => GROUP_GOAL[g.group])).filter((u) => u && daysOf(GOAL_GROUPS_OF[u]) > 0);
    // What they asked to leave out comes first: it's the surest thing the app knows about this plan.
    const joints = uniq((S.profile.careful || []).concat(w.careful));
    if (joints.length) add('care', w.careful.length ? 'asked' : 'joints', `You're careful with your ${listWords(joints.map((j) => JOINT_NAME[j] || j))}, so nothing here is hard on ${joints.length === 1 && (joints[0] === 'back' || joints[0] === 'neck') ? 'it' : 'them'}.`);
    if (w.noImpact) add('jump', 'asked', 'You asked for no jumping, so every move keeps a foot on the floor.');
    if (w.noFloor) add('floor', 'asked', 'You asked for nothing on the floor, so every move is standing or seated.');
    if (trained.length) {
      const n = Math.min(...trained.map((u) => daysOf(GOAL_GROUPS_OF[u])));
      const even = trained.every((u) => daysOf(GOAL_GROUPS_OF[u]) === n);
      const on = n === D ? (D === 1 ? 'your one day' : `all ${D} days`) : `${even ? '' : 'at least '}${n} of your ${D} days`;
      const they = trained.length > 1 || !['chest', 'back'].includes(trained[0]);
      const first = trained.filter((u) => u !== 'abs');
      add('goal', 'goal', `You want your ${listWords(trained)} most, so ${they ? 'they\'re' : 'it\'s'} trained on ${on}${first.length && first.length < trained.length ? `, ${listWords(first)} first` : first.length ? ` and ${they ? 'come' : 'comes'} first` : ''}.`);
    }
    if (R.lowEat) add('eats', 'eats', 'You said you don\'t eat much protein. Training can\'t make up for that, so sets stay moderate and your goals come first.');
    const light = all.filter((it) => it.reps && /db|kb/.test(MV[it.move].load || '') && R.light(MV[it.move].family));
    if (P && light.length) {
      const f = P.loadFeel(R.S2, MV[light[0].move].family);
      // (How close to the last rep, as the engine sets it: 2 or 3 short from 60.)
      const any = light.some((it) => (P.loadFeel(R.S2, MV[it.move].family) || {}).feel === 'light');
      add('load', 'load', `Your ${f.top} ${p.units || 'lb'} weights ${any ? 'are light for you' : 'mean long sets for you'}, so those exercises build on reps, up to ${Math.max(...light.map((it) => R.reps(it.move)[1]))}, ${P.effort(R.S2, day).lo >= 2 ? 'stopping 2 or 3 short of' : 'close to'} the last one you can do.`);
    }
    if (w.feel === 'easy') add('feel', 'asked', `You asked for a plan that's easy to keep up, so no exercise has more than ${R.sets[1]} sets and it starts a little lower.`);
    add('time', 'time', `You have ${D} ${D === 1 ? 'day' : 'days'} of ${R.mins} minutes, so each day has ${uniq([Math.min(...plan.days.map((d) => d.items.length)), Math.max(...plan.days.map((d) => d.items.length))]).join(' to ')} exercises.`);
    const L = P && S.profile.workouts !== false ? P.lately(S, day) : null;
    if (L && L.perWeek != null && L.planned >= 4 && L.perWeek <= S.profile.days - 1 && D <= Math.ceil(L.perWeek)) add('does', 'does', `You've been doing about ${L.perWeek} workouts a week, so this plan asks for ${D}.`);
    if (p.experience === 'never' && day - (S.profile.startDay || day) < 84) add('level', 'level', 'You\'re new to training, so the moves are simple ones at your level and stay the same from week to week.');
    if (!all.some((it) => MV[it.move].load)) add('kit', 'kit', 'You train without equipment, so every move uses your body weight, with harder versions as you move up.');
    return out;
  }
  // What a day is for, in a line: what comes first, then the rest.
  function dayWhy(plan, i, R) {
    const MV = M().MOVES;
    const unit = (g) => (g === 'biceps' || g === 'triceps' ? 'arms' : groupWord(g));
    const names = uniq(plan.days[i].items.map((it) => MV[it.move].group).filter((g) => GROUP_GOAL[g]).map(unit));
    if (!names.length) return '';
    const first = plan.days[i].items.map((it) => MV[it.move].group).find((g) => GROUP_GOAL[g]);
    const cap = (x) => `${x[0].toUpperCase()}${x.slice(1)}`;
    const goal = (g) => R.goals.some((x) => x.group === g);
    if (goal(first) && first !== 'abs' && names.length > 1) return `${cap(unit(first))} first while you're fresh, then ${listWords(names.slice(1))}.`;
    // (Said another way than the day's title, which lists the same muscles.)
    const mine = uniq(plan.days[i].items.map((it) => MV[it.move].group).filter(goal).map(unit));
    const rest = names.filter((n) => !mine.includes(n));
    if (mine.length && rest.length) return `${cap(listWords(rest))}, and your ${listWords(mine)} too.`;
    if (mine.length) return `Just your ${listWords(mine)} today.`;
    if (R.goals.length) return `${cap(listWords(rest))}, so the rest of you keeps up.`;
    return `${cap(listWords(names))}.`;
  }
  // A plan with the app's own reasons on it: up to three "because you" lines (plan.why) and a line
  // for each day (day.why).
  function withWhy(S, day, w, plan, R) {
    plan.why = ownWhy(S, day, w, plan, R).slice(0, WHY.lines).map((x) => x.line);
    plan.days.forEach((d, i) => { d.why = dayWhy(plan, i, R); });
    return plan;
  }

  /* ---------------------------------------------------------------- a model's take */
  // The moves a model may use: for each family the person's own level and the ones either side of
  // it, the draft's moves, and nothing they can't do (checked for the wishes too). The ladders that
  // stand in for others with a health condition, and the practice ones (balance, impact, getting
  // up), only when the draft itself uses them: for anyone else they're not this person's moves.
  const PRACTICE = ['impact', 'balance', 'getup', 'finGentle', 'cardioG'];
  function allowedMoves(S, day, w, draft) {
    const S2 = sandbox(S, w);
    const ctx = context(S2, day);
    const ids = [];
    const push = (id) => { if (id && !ids.includes(id) && check(ctx, id).ok) ids.push(id); };
    for (const d of draft.days) for (const it of d.items) push(it.move);
    const used = new Set(ids.map((id) => M().MOVES[id].family));
    const special = new Set(PRACTICE.concat(Object.values((GH.access && GH.access.STAND_IN) || {})));
    for (const [fam, lad] of Object.entries(M().LADDERS)) {
      if (special.has(fam) && !used.has(fam)) continue;
      const list = lad.rungs.filter((id) => check(ctx, id).ok);
      if (!list.length) continue;
      const st = S2.prog[fam];
      const at = Math.max(0, st ? list.indexOf(st.rung) : 0);
      for (const id of list.slice(Math.max(0, at - 1), at + 2)) push(id);
    }
    return ids.slice(0, 90);
  }
  const plainForModel = (plan) => ({ name: plan.name, days: plan.days.map((d) => ({ title: d.title, items: d.items.map((it) => ({ move: it.move, sets: it.sets, reps: it.secs != null ? it.secs : it.reps })) })) });
  // Each move with the muscle it trains and the reps (or seconds) it may have for this person.
  function movesText(ids, R) {
    return ids.map((id) => {
      const m = M().MOVES[id];
      const r = R ? R.reps(id) : m.range;
      return `${id}: ${m.name} (${String((B().GROUP_NAME || {})[m.group] || m.group).toLowerCase()}; ${r[0]}-${r[1]}${m.timed ? ' s' : ''})`;
    }).join('\n');
  }
  // What they picked on the sheet, in words (nothing when they picked nothing).
  function pickedLine(w) {
    const bits = [w.most ? `wants most: ${MOST[w.most].toLowerCase()}` : '', w.feel ? `how it should feel: ${FEEL[w.feel].toLowerCase()}` : '', w.skip.length ? `leave out: ${w.skip.map((k) => SKIP[k].toLowerCase()).join(', ')}` : ''].filter(Boolean);
    return bits.join('; ');
  }
  // The on-device model's: short rules, the moves, then the request, who this is in the short form,
  // the reasons it may pick from (the app's own, by id) and the draft. At most 60 moves and about
  // 6,500 characters (about 2,200 tokens, with up to 1,350 for the answer: a 4,096-token model's
  // memory). o.short, for a model with less (the older 2,048-token ones): the moves of compactMoves
  // and fewer facts, about 4,400 characters.
  const DEVICE_MOVES = 60, COMPACT_MOVES = 24;
  const DEVICE_FACTS = ['body', 'build', 'goal', 'focus', 'level', 'time', 'kit', 'load', 'joints', 'pain', 'health', 'floor', 'gentle', 'eats', 'does', 'felt', 'effort', 'stuck'];
  const DEVICE_SHORT = ['body', 'goal', 'time', 'kit', 'load', 'joints', 'pain', 'health', 'floor', 'eats', 'does'];
  function planMessages(S, w, draft, ids, day, o) {
    const P = GH.person;
    const d = day != null ? day : B().dayOf(Date.now(), (S.profile.prefs && S.profile.prefs.rollHour) || 4);
    const R = rules(S, d, w, draft);
    const list = ids.slice(0, DEVICE_MOVES);
    const reasons = ownWhy(S, d, w, draft, R);
    const about = P ? P.lines(S, d, { to: 'device', ids: o && o.short ? DEVICE_SHORT : DEVICE_FACTS, short: !!(o && o.short) }) : [];
    const picked = pickedLine(w);
    return [
      { role: 'system', content: [
        'You are a strength coach. You adjust a draft workout plan so it fits this person and what they asked for, and answer with JSON only.',
        'Use only move ids from MOVES.', ...rulesLines(S, d, R, { to: 'device' }),
        'because: the 2 or 3 REASONS that are most true of your plan, by id.',
        'title: 1 to 3 words for each day. name: 2 to 5 words for the plan.',
        '', 'MOVES (id: name (muscle; reps or seconds))', movesText(list, R),
      ].join('\n') },
      { role: 'user', content: [
        `Request: ${w.text || 'a plan that fits me'}`, ...(picked ? [`They picked: ${picked}`] : []),
        'About them:', ...about,
        'REASONS', ...reasons.map((x, k) => `b${k + 1}: ${x.line}`),
        `Draft: ${JSON.stringify(plainForModel(draft))}`,
      ].join('\n') },
    ];
  }
  // The moves for a model with a short memory: the draft's own, then the rungs either side of each on
  // its ladder, COMPACT_MOVES at most (or all of the draft's, if it has more).
  function compactMoves(draft, ids) {
    const keep = [];
    const add = (id) => { if (id && ids.includes(id) && !keep.includes(id)) keep.push(id); };
    for (const d of draft.days) for (const it of d.items) add(it.move);
    const own = keep.length;
    for (const d of draft.days) for (const it of d.items) {
      const lad = (M().LADDERS[(M().MOVES[it.move] || {}).family] || { rungs: [] }).rungs, k = lad.indexOf(it.move);
      if (k >= 0) { add(lad[k - 1]); add(lad[k + 1]); }
    }
    return keep.slice(0, Math.max(COMPACT_MOVES, own));
  }
  // What the on-device model is sent, and whether it fits: the full request, or the short one when
  // the model's memory (room, in tokens) can't hold it, or null when neither fits. Counted at 3
  // characters a token, as llm.js does, with the answer's tokens: 24 for each exercise a day may
  // hold (an item is about 18 of Qwen's), 20 for its title and 60 for the reasons and the name; the
  // full request keeps at least the 200 a day it had.
  function deviceAsk(S, w, draft, ids, day, R, room) {
    const per = [Math.min(R.perDay[0], ...draft.days.map((x) => x.items.length)), Math.max(R.perDay[1], ...draft.days.map((x) => x.items.length))];
    const make = (short) => {
      const list = short ? compactMoves(draft, ids) : ids.slice(0, DEVICE_MOVES);
      const msgs = planMessages(S, w, draft, list, day, { short });
      const fit = draft.days.length * (per[1] * 24 + 20) + 60;
      const maxTokens = short ? fit : Math.max(fit, 200 * draft.days.length + 150);
      return { list, msgs, per, maxTokens, short, needs: Math.ceil(msgs.reduce((a, m) => a + m.content.length + 18, 0) / 3) + 64 + maxTokens };
    };
    const full = make(false);
    if (!room || full.needs <= room) return full;
    const short = make(true);
    return short.needs <= room ? short : null;
  }
  // A grammar that holds the on-device model to a plan of exactly `days` days made of `ids`, with
  // the rules' counts (o: { perDay: [min, max], sets: [min, max], reasons: how many it may pick
  // from }): reasons by id, then a name, then the days. No free text but the short names.
  function planGrammar(ids, days, o) {
    const opt = o || {};
    const per = opt.perDay || [3, 8], sets = opt.sets || [1, SETS_MAX], n = opt.reasons || 0;
    const q = (s) => `"\\"${s}\\""`;
    const dayRule = Array.from({ length: days }, () => 'day').join(' "," ');
    const because = n ? `"{\\"because\\":[" pick ("," pick){0,${Math.min(n, WHY.lines) - 1}} "],\\"name\\":"` : '"{\\"name\\":"';
    return [
      `root ::= ${because} name ",\\"days\\":[" ${dayRule} "]}"`,
      `day ::= "{\\"title\\":" title ",\\"items\\":[" item ("," item){${Math.max(1, per[0] - 1)},${per[1] - 1}} "]}"`,
      `item ::= "{\\"move\\":" move ",\\"sets\\":" [${sets[0]}-${sets[1]}] ",\\"reps\\":" reps "}"`,
      `move ::= ${ids.map(q).join(' | ')}`,
      'reps ::= [1-9] | [1-9] [0-9]',
      ...(n ? [`pick ::= ${Array.from({ length: n }, (_, k) => q(`b${k + 1}`)).join(' | ')}`] : []),
      'name ::= "\\"" [A-Za-z0-9 ,&-]{2,36} "\\""',
      'title ::= "\\"" [A-Za-z0-9 ,&-]{2,24} "\\""',
    ].join('\n');
  }
  // Claude's: the reasons first (what it's answering shapes the plan it then writes), each naming a
  // fact by id from the ones it was given, then the plan, each day with its line.
  function planSchema(ids, facts) {
    const str = { type: 'string' };
    return {
      type: 'object',
      properties: {
        because: { type: 'array', items: { type: 'object', properties: { fact: { type: 'string', enum: facts && facts.length ? facts : ['goal'] }, line: str }, required: ['fact', 'line'], additionalProperties: false } },
        name: str,
        note: str,
        days: { type: 'array', items: { type: 'object', properties: { title: str, why: str, items: { type: 'array', items: { type: 'object', properties: { move: { type: 'string', enum: ids }, sets: { type: 'integer' }, reps: { type: 'integer' } }, required: ['move', 'sets', 'reps'], additionalProperties: false } } }, required: ['title', 'why', 'items'], additionalProperties: false } },
      },
      required: ['because', 'name', 'note', 'days'],
      additionalProperties: false,
    };
  }
  // The facts about the person Claude has for a plan, by id (GH.person.facts; its summary's parts
  // hold how workouts went and sleep), plus 'asked' for what they asked here.
  const BUILD_PARTS = ['person', 'days', 'training'];
  const FACT_WORDS = { body: 'age range and sex', build: 'their build', goal: 'their goals', focus: 'muscles to lean toward', level: 'training history', time: 'days and minutes', kit: 'equipment', load: 'what their weights mean for them', joints: 'joints to be careful with', eats: 'how they eat', protein: 'protein logged', does: 'what they\'ve been doing', up: 'what\'s moving up', stuck: 'what isn\'t moving', likes: 'their choices', sleep: 'sleep', asked: 'what they asked for here' };
  function claudeFacts(S, day) {
    const P = GH.person, A = GH.ai;
    const wide = !!(A && A.wide && A.wide(S));
    const ids = P ? P.facts(S, day, { to: 'claude', wide, have: BUILD_PARTS }).map((f) => f.id) : ['goal'];
    return uniq(ids.concat(S.profile.workouts !== false ? ['does'] : [])).filter((id) => FACT_WORDS[id]);
  }
  // The request for Claude (its system text holds the summary, with who this is: src/ai.js). At
  // most about 9,000 characters: moves leave the end of the list until it fits.
  const CLAUDE_CHARS = 9000;
  function claudePrompt(S, w, draft, ids, day) {
    const A = GH.ai;
    const d = day != null ? day : B().dayOf(Date.now(), (S.profile.prefs && S.profile.prefs.rollHour) || 4);
    const R = rules(S, d, w, draft);
    const facts = claudeFacts(S, d);
    const picked = pickedLine(w);
    const text = (list) => [
      'Build this person a workout plan they can run in the app. Adjust the draft so it fits their request and who they are (PERSON in the summary): make it theirs, not a general plan.',
      'RULES FOR THIS PERSON', ...rulesLines(S, d, R, { to: 'claude', wide: !!(A && A.wide && A.wide(S)) }).map((x) => `- ${x}`),
      'MOVES (use only these; id: name (muscle; reps or seconds))', movesText(list, R), '',
      `Their request: ${w.text || 'a plan that fits me'}`, ...(picked ? [`They picked: ${picked}`] : []),
      `Draft: ${JSON.stringify(plainForModel(draft))}`,
      `because: 2 or 3 lines on why this plan is theirs. Each names one fact you were given about them (fact: ${facts.concat('asked').map((id) => `${id} = ${FACT_WORDS[id]}`).join(', ')}) and says what the plan does about it, as you'd say it to them ("Your ... so ..."), under 25 words. Only numbers you were given or that are in your plan. No promises, and nothing about diet, weight or medicine.`,
      'Each day: title of 1 to 3 words, and why: one line on what the day is for, under 15 words.',
      'name: 2 to 5 words. note: one short sentence on what the plan does for them.',
    ].join('\n');
    let list = ids.slice();
    while (list.length > draft.days.reduce((a, x) => a + x.items.length, 0) && text(list).length > CLAUDE_CHARS) list = list.slice(0, -1);
    return text(list);
  }

  /* ---------------------------------------------------------------- the checks */
  // A plan brought inside the rules where that's safe, day by day; fixes gets a line in plain words
  // for each thing changed. own: the draft is a plan of the person's own (Improve), so what the
  // model left as they had it stays as they had it.
  function tidy(S, day, plan, R, o) {
    const MV = M().MOVES;
    const { ids, draft, fixes, own } = o;
    const grp = (it) => MV[it.move].group;
    const isGoal = (g) => R.goals.some((x) => x.group === g);
    const amount = (it) => (it.secs != null ? it.secs : it.reps);
    const theirs = (i, it) => !!own && !!draft.days[i] && draft.days[i].items.some((x) => x.move === it.move && x.sets === it.sets && amount(x) === amount(it));
    const max = R.sets[1];
    let clamped = false;
    plan.days.forEach((d, i) => {
      d.items = d.items.filter((it, k) => d.items.findIndex((x) => x.move === it.move) === k);
      for (const it of d.items) {
        if (theirs(i, it)) continue;
        const [lo, hi] = R.reps(it.move);
        const key = MV[it.move].timed ? 'secs' : 'reps';
        const v = Math.max(lo, Math.min(hi, it[key]));
        if (v !== it[key]) { it[key] = v; clamped = true; }
      }
      // At most `max` sets of one exercise: a goal muscle's sets past that go to a second exercise
      // for it (one the day has, or the nearest on its ladder they can do), other muscles' just go.
      const cap = Math.max(R.perDay[1], own && draft.days[i] ? draft.days[i].items.length : 0);
      for (const it of d.items.slice()) {
        if (it.sets <= max || theirs(i, it)) continue;
        let extra = it.sets - max;
        it.sets = max;
        let mate = null;
        if (isGoal(grp(it))) {
          mate = d.items.find((x) => x !== it && grp(x) === grp(it) && x.sets < max) || null;
          if (!mate && d.items.length < cap && !d.items.some((x) => x !== it && grp(x) === grp(it))) {
            const lad = (M().LADDERS[MV[it.move].family] || { rungs: [] }).rungs;
            const near = (id) => { const k = lad.indexOf(id); return k < 0 ? 99 : Math.abs(k - lad.indexOf(it.move)); };
            const id = ids.filter((x) => MV[x].group === grp(it) && !d.items.some((y) => y.move === x)).sort((x, y) => near(x) - near(y))[0];
            if (id) {
              const [lo, hi] = R.reps(id);
              mate = MV[id].timed ? { move: id, sets: 0, secs: Math.max(lo, Math.min(hi, MV[id].start || lo)) } : { move: id, sets: 0, reps: Math.max(lo, Math.min(hi, it.reps || MV[id].start || lo)) };
              d.items.splice(d.items.indexOf(it) + 1, 0, mate);
            }
          }
          if (mate) { const add = Math.min(extra, max - mate.sets); mate.sets += add; extra -= add; }
        }
        fixes.push(`Kept ${MV[it.move].name} to ${max} sets on day ${i + 1}${mate ? `, with ${MV[mate.move].name} for the rest` : ''}.`);
      }
      // No more exercises than the time holds, where that costs no muscle its sets and no time:
      // a muscle's later exercise that day is folded into its earlier one (the day leads with the
      // bigger move) when that has room for the sets, the lowest goal's first, then the one with the
      // fewest sets, unless the day would run longer.
      let folded = 0;
      const kept = new Set();
      for (let guard = 0; guard < 12 && d.items.length > cap && d.items.length > 2; guard++) {
        const mateOf = (it) => d.items.slice(0, d.items.indexOf(it)).find((x) => grp(x) === grp(it) && x.sets + it.sets <= max && !theirs(i, x));
        const pool = d.items.filter((it) => !kept.has(it) && !theirs(i, it) && mateOf(it));
        if (!pool.length) break;
        const rank = (it) => R.tier(grp(it)) * 10 - it.sets;
        const out = pool.reduce((a, it) => (rank(it) >= rank(a) ? it : a), pool[0]);
        const mate = mateOf(out), at = d.items.indexOf(out), before = minutes(S, plan, i, day);
        mate.sets += out.sets;
        d.items.splice(at, 1);
        if (minutes(S, plan, i, day) > before) { mate.sets -= out.sets; d.items.splice(at, 0, out); kept.add(out); } else folded++;
      }
      if (folded) fixes.push(`Day ${i + 1} had more exercises than ${R.mins} minutes holds, so ${folded === 1 ? 'one was' : `${folded} were`} folded into the others.`);
      // No muscle past its sets for a day (legs aside), and crunch-type work within its reps: sets
      // come off the exercise with the most, down to one, and then reps, down to the move's lowest.
      for (const g of uniq(d.items.map(grp)).filter((x) => GROUP_GOAL[x] && x !== 'legs')) {
        const most = Math.max(R.daySets, own && draft.days[i] ? daySetsOf(draft.days[i], g) : 0);
        let cut = 0;
        for (let guard = 0; guard < 40 && daySetsOf(d, g) > most; guard++) {
          const it = d.items.filter((x) => grp(x) === g && x.sets > 1 && !theirs(i, x)).sort((a, b) => b.sets - a.sets)[0];
          if (!it) break;
          it.sets--;
          cut++;
        }
        if (cut) fixes.push(`Kept your ${groupWord(g)} to ${most} sets on day ${i + 1}.`);
      }
      const flexMost = Math.max(R.flexReps, own && draft.days[i] ? flexOf(draft.days[i]) : 0);
      if (flexOf(d) > flexMost) {
        for (let guard = 0; guard < 40 && flexOf(d) > flexMost; guard++) {
          const pool = d.items.filter((x) => flexion(x.move) && x.reps && !theirs(i, x));
          const it = pool.filter((x) => x.sets > 1).sort((a, b) => b.sets * b.reps - a.sets * a.reps)[0];
          if (it) { it.sets--; continue; }
          const big = pool.filter((x) => x.reps > R.reps(x.move)[0]).sort((a, b) => b.reps - a.reps)[0];
          if (!big) break;
          big.reps = Math.max(R.reps(big.move)[0], big.reps - Math.ceil((flexOf(d) - flexMost) / big.sets));
        }
        fixes.push(`Kept day ${i + 1}'s crunch-type work to ${flexMost} reps.`);
      }
      // Goal muscles first, abs and core last (the order within each is the model's).
      const before = d.items.map((it) => it.move).join();
      d.items = d.items.map((it, k) => [it, k]).sort((a, b) => R.tier(grp(a[0])) - R.tier(grp(b[0])) || a[1] - b[1]).map((x) => x[0]);
      if (!own && d.items.map((it) => it.move).join() !== before && isGoal(grp(d.items[0])) && before.split(',')[0] !== d.items[0].move) fixes.push(`Put your ${groupWord(grp(d.items[0]))} first on day ${i + 1}.`);
    });
    if (clamped) fixes.push('Kept reps inside each exercise\'s own range.');
    return plan;
  }
  // A model's answer, kept only if it's a plan this person can do with the days they asked for that
  // passes the rules above and the checks the plan review makes on the coach's plan
  // (src/planreview.js). What can be put right safely is (tidy, and below), and o.fixes says so in
  // plain words; anything else keeps the draft:
  //  - the rules: sets of one exercise, reps, exercises a day, a muscle's sets in a day, crunch-type
  //    reps and the order (tidy);
  //  - goal muscles: each on as many days as the rules ask, or as the draft has when that's fewer
  //    (the draft's own exercise goes back in where the model dropped it);
  //  - weekly sets: each muscle inside its floor and ceiling (a goal muscle's from the rules, any
  //    other's 4 to 30), or the draft's where that's wider: past it, sets come off; short of it,
  //    sets go back where a day has the time and the room;
  //  - time: each day fits the time asked for, or runs no longer than the draft's own day (a set
  //    comes off the move with the most to spare until it fits, down to 1; the move the day leads
  //    with and the groups they asked to focus on count as having fewer, so they keep theirs longer);
  //  - coverage: every muscle group the draft trains keeps at least half of its weekly sets;
  //  - focus: the groups they asked to focus on keep at least two thirds of the draft's sets;
  //  - balance: pulling still balances pushing about as well as in the draft.
  // Its words are checked too (say): the reasons it gave or picked (plan.why), each day's line, the
  // note and the names; one that fails gives way to the app's own. o: { given (what the model was
  // sent, for the number check), fixes: [], facts (the fact ids it was given), reasons (the app's
  // own lines an on-device model picks from, by b1, b2 and so on), own (Improve) }. Returns the plan, or null.
  function accept(S, day, w, draft, raw, ids, o) {
    const opt = o || {};
    const fixes = opt.fixes || [];
    if (!raw || typeof raw !== 'object') return null;
    const { plan, report } = normalize(Object.assign({}, raw, { source: 'coach', weekdays: draft.weekdays }));
    if (report.unknown.length || plan.days.length !== draft.days.length) return null;
    const allowed = new Set(ids);
    const MV = M().MOVES;
    const grp = (it) => MV[it.move].group;
    for (const d of plan.days) if (d.items.length < 2 || d.items.some((it) => !allowed.has(it.move))) return null;
    const R = rules(S, day, w, draft);
    tidy(S, day, plan, R, { ids, draft, fixes, own: !!opt.own });
    // (The muscles the model's own answer trains: one it left out altogether is turned down below,
    // not put back.)
    const kept = new Set(plan.days.flatMap((d) => d.items.map((it) => MV[it.move].group)));
    const budget = clampInt((w && w.minutes) || S.profile.minutes, 10, 90, 30);
    const limit = (i) => Math.max(budget, minutes(S, draft, i, day)) + 2;
    const daysOf = (p, g) => p.days.filter((d) => d.items.some((it) => grp(it) === g)).length;
    const setsOf = (p) => {
      const out = {};
      for (const d of p.days) for (const it of d.items) { const m = MV[it.move]; if (m && GROUP_GOAL[m.group]) out[m.group] = (out[m.group] || 0) + it.sets; }
      return out;
    };
    const was = setsOf(draft);
    // What they asked to focus on, as the model's own answer has it: one that cuts those groups well
    // back is turned down, whatever the repairs below would make of it.
    const asked = setsOf(plan);
    for (const g of (w && w.focus) || []) if (was[g] && (asked[g] || 0) < Math.ceil((was[g] * 2) / 3)) return null;
    // Pushing against pulling (rows count a little more, as the plan review weighs them).
    const pushOf = (x) => (x.chest || 0) + (x.shoulders || 0), pullOf = (x) => (x.back || 0) * 1.2;
    const balance = (x) => { const push = pushOf(x), pull = pullOf(x); return Math.max(push, pull) <= 0 ? 1 : Math.min(push, pull) / Math.max(push, pull); };
    // A goal muscle on too few days: the draft's exercise for it goes back in, on the days the
    // draft has it and the model's doesn't.
    for (const g of R.goals) {
      const need = Math.min(g.days, daysOf(draft, g.group));
      plan.days.forEach((d, i) => {
        if (daysOf(plan, g.group) >= need || d.items.some((it) => grp(it) === g.group)) return;
        const back = draft.days[i].items.find((it) => grp(it) === g.group && allowed.has(it.move));
        if (!back || d.items.length >= Math.max(R.perDay[1], draft.days[i].items.length)) return;
        d.items.push(Object.assign({}, back, { sets: Math.min(R.sets[1], back.sets) }));
        d.items = d.items.map((it, k) => [it, k]).sort((a, b) => R.tier(grp(a[0])) - R.tier(grp(b[0])) || a[1] - b[1]).map((x) => x[0]);
        fixes.push(`Put ${MV[back.move].name} back on day ${i + 1}, so your ${groupWord(g.group)} train ${need} days a week.`);
      });
      if (daysOf(plan, g.group) < need) return null;
    }
    // Each muscle's weekly floor and ceiling: a goal muscle's from the rules, any other's the
    // research's (4 to 30), and never more than the draft itself asks or less than it allows. (A
    // muscle the draft gives a single set may go, as the coverage check below allows.)
    const now = () => setsOf(plan);
    const goalOf = (g) => R.goals.find((x) => x.group === g);
    const floorOf = (g) => (goalOf(g) ? Math.min(goalOf(g).floor, was[g] || 0) : (was[g] || 0) >= 2 ? Math.min(R.week[0], was[g]) : 0);
    const capOf = (g) => Math.max(goalOf(g) ? goalOf(g).cap : R.week[1], was[g] || 0);
    // (Improve: an exercise as they had it, which sets come off last.)
    const amount = (it) => (it.secs != null ? it.secs : it.reps);
    const theirs = (i, it) => !!opt.own && !!draft.days[i] && draft.days[i].items.some((x) => x.move === it.move && x.sets === it.sets && amount(x) === amount(it));
    // Weekly sets: a muscle past its ceiling gives the extra up, from what the model changed first.
    for (const g of Object.keys(now())) {
      let over = (now()[g] || 0) - capOf(g);
      if (over > 0) fixes.push(`Kept your ${groupWord(g)} to ${capOf(g)} sets a week.`);
      for (let guard = 0; guard < 60 && over > 0; guard++) {
        const pick = plan.days.flatMap((d, i) => d.items.map((x) => [x, theirs(i, x) ? 1 : 0])).filter(([x]) => grp(x) === g && x.sets > 1).sort((a, b) => a[1] - b[1] || b[0].sets - a[0].sets)[0];
        if (!pick) break;
        pick[0].sets--;
        over--;
      }
    }
    // A day's own limits (a muscle's sets in a day, crunch-type reps), read against the draft's day.
    const dayOk = (i) => {
      const d = plan.days[i], o = draft.days[i];
      return flexOf(d) <= Math.max(R.flexReps, flexOf(o)) && uniq(d.items.map(grp)).every((g) => !GROUP_GOAL[g] || g === 'legs' || daySetsOf(d, g) <= Math.max(R.daySets, daySetsOf(o, g)));
    };
    // Time: a set comes off the move with the most to spare until the day fits, a muscle's at its
    // weekly floor (or the draft's) only once the others have none to give.
    const focus = (it) => ((w && w.focus) || []).includes(grp(it));
    for (let i = 0; i < plan.days.length; i++) {
      const d = plan.days[i];
      // (On a tie, the later move gives a set first.)
      const spare = (it, k) => it.sets - (focus(it) ? 1 : 0) - (k === 0 ? 2 : 0) + k / 100;
      // (Held: a muscle at its weekly floor, and the lighter side of pushing and pulling while the
      // plan is no better balanced than the draft, so trimming doesn't tip it over.)
      const behind = (g) => { const x = now(); return balance(x) <= balance(was) && ((g === 'back' && pushOf(x) > pullOf(x)) || ((g === 'chest' || g === 'shoulders') && pullOf(x) > pushOf(x))); };
      const held = (it) => (now()[grp(it)] || 0) <= floorOf(grp(it)) || behind(grp(it));
      let cut = 0;
      for (let guard = 0; guard < 200 && minutes(S, plan, i, day) > limit(i); guard++) {
        let pick = -1;
        // (Held muscles last, and, in Improve, what they had after what the model changed.)
        for (const [free, fresh] of [[true, true], [true, false], [false, true], [false, false]]) {
          d.items.forEach((it, k) => { if (it.sets > 1 && (!free || !held(it)) && (!fresh || !theirs(i, it)) && (pick < 0 || spare(it, k) > spare(d.items[pick], pick))) pick = k; });
          if (pick >= 0) break;
        }
        if (pick < 0) break;
        d.items[pick].sets--;
        cut++;
      }
      if (minutes(S, plan, i, day) > limit(i)) return null;
      if (cut) fixes.push(`Took ${cut === 1 ? 'a set' : `${cut} sets`} off day ${i + 1} so it fits your time.`);
    }
    // A muscle short of its weekly floor (or the draft's) gets sets back where a day has the time
    // and the room for them, the goal muscles first.
    for (const g of R.goals.map((x) => x.group).concat(Object.keys(was).filter((x) => !goalOf(x)))) {
      let added = 0;
      for (let guard = 0; guard < 24 && (now()[g] || 0) < floorOf(g); guard++) {
        let done = false;
        for (let i = 0; i < plan.days.length && !done; i++) {
          const it = plan.days[i].items.filter((x) => grp(x) === g && x.sets < R.sets[1]).sort((a, b) => a.sets - b.sets)[0];
          if (!it) continue;
          it.sets++;
          if (minutes(S, plan, i, day) > limit(i) || !dayOk(i)) it.sets--; else { done = true; added++; }
        }
        // No day with the muscle has room: the draft's exercise for it goes back on a day the model
        // left it off, where that day has the time and the room (for a muscle the model trains).
        for (let i = 0; i < plan.days.length && !done && kept.has(g); i++) {
          const d = plan.days[i];
          const back = d.items.some((x) => grp(x) === g) ? null : (draft.days[i] || { items: [] }).items.find((x) => grp(x) === g && allowed.has(x.move));
          if (!back || d.items.length >= Math.max(R.perDay[1], draft.days[i].items.length)) continue;
          const put = Object.assign({}, back, { sets: Math.max(1, Math.min(R.sets[1], back.sets, floorOf(g) - (now()[g] || 0))) });
          const was0 = d.items;
          d.items = d.items.concat(put).map((it, k) => [it, k]).sort((a, b) => R.tier(grp(a[0])) - R.tier(grp(b[0])) || a[1] - b[1]).map((x) => x[0]);
          if (minutes(S, plan, i, day) > limit(i) || !dayOk(i)) { d.items = was0; continue; }
          done = true;
          added += put.sets;
          fixes.push(`Put ${MV[put.move].name} back on day ${i + 1} for your ${groupWord(g)}.`);
        }
        if (!done) return null;
      }
      if (added) fixes.push(`Gave your ${groupWord(g)} ${added === 1 ? 'a set' : `${added} sets`} back, so ${g === 'chest' || g === 'back' ? 'it gets' : 'they get'} ${floorOf(g)} a week.`);
    }
    const got = now();
    for (const g of Object.keys(was)) if (was[g] >= 2 && (got[g] || 0) < Math.ceil(was[g] / 2)) return null;
    for (const g of (w && w.focus) || []) if (was[g] && (got[g] || 0) < Math.ceil((was[g] * 2) / 3)) return null;
    if (balance(got) < Math.min(0.5, balance(was) - 0.15)) return null;
    for (let i = 0; i < plan.days.length; i++) if (plan.days[i].items.length > Math.max(R.perDay[1], draft.days[i].items.length) || !dayOk(i)) return null;

    // Its words. (known: what it was sent, and the plan's own numbers.)
    // (The facts it was given, by id: the on-device model's when nothing says, plus what they asked
    // here, and 'care' when that named a joint.)
    const facts = (opt.facts || (GH.person ? GH.person.facts(S, day, { to: 'device' }).map((f) => f.id) : ['goal', 'time', 'kit'])).concat(w && (w.text || w.most || w.feel || w.skip.length) ? ['asked'] : [], w && w.careful.length ? ['care'] : []);
    const told = { known: `${opt.given != null ? opt.given : planMessages(S, w, draft, ids, day).map((m) => m.content).join('\n')}\n${planNumbers(S, day, plan)}`, strict: !!(GH.person && GH.person.strict(S, day)), facts };
    const mine = ownWhy(S, day, w, plan, R);
    const reasons = opt.reasons || [];
    const lines = [];
    let dropped = 0;
    for (const x of (Array.isArray(raw.because) ? raw.because : []).slice(0, 6)) {
      // An id (the on-device model's pick from the app's own lines) or { fact, line } (Claude's).
      const pick = typeof x === 'string' ? reasons[Number(x.slice(1)) - 1] : null;
      const line = pick ? (mine.find((m) => m.key === pick.key) || {}).line || '' : x && typeof x === 'object' && typeof x.line === 'string' && facts.includes(x.fact) && /\byou/i.test(x.line) ? say(x.line, WHY.line, told) : '';
      if (line && !lines.includes(line)) lines.push(line); else dropped++;
    }
    for (const m of mine) if (lines.length < 2 && !lines.includes(m.line)) lines.push(m.line);
    plan.why = lines.slice(0, WHY.lines);
    plan.days.forEach((d, i) => {
      const rawDay = (Array.isArray(raw.days) ? raw.days : [])[i] || {};
      const line = typeof rawDay.why === 'string' && rawDay.why ? say(rawDay.why, WHY.day, told) : '';
      if (rawDay.why && !line) dropped++;
      d.why = line || dayWhy(plan, i, R);
      // (A day's name with a number it wasn't given goes back to the draft's.)
      if (d.title && GH.coach && GH.coach.keepToGiven && GH.coach.keepToGiven(d.title, told.known).cut) d.title = draft.days[i].title;
    });
    const note = plan.note ? say(plan.note, C.LIMITS.note, told) : '';
    if (plan.note && !note) dropped++;
    plan.note = note || draft.note;
    if (GH.coach && GH.coach.keepToGiven && GH.coach.keepToGiven(plan.name, told.known).cut) plan.name = draft.name;
    if (opt.said) opt.said.dropped = dropped;
    return plan;
  }
  // The plan the build sheet shows first: the engine's draft, brought inside the rules (the engine's
  // own plans can hold six sets of one exercise or more exercises than a short session holds), with
  // the app's own reasons on it.
  function build(S, day, w) {
    const draft = generate(S, day, w);
    const R = rules(S, day, w, draft);
    tidy(S, day, draft, R, { ids: allowedMoves(S, day, w, draft), draft, fixes: [] });
    return withWhy(S, day, w, draft, R);
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
  // The draft, refined by a model when there is one. Resolves { plan, by, fixes, error? } (by:
  // 'claude', 'device' or null when the draft stands; fixes: what the app put right in the model's
  // take, in plain words; error: why a model's take didn't come, such as a Claude spending limit,
  // for the screen to say). o.own: the draft is a plan of their own (Improve).
  async function refine(S, day, w, draft, signal, o) {
    const by = await modelFor(S);
    if (!by) return { plan: draft, by: null, fixes: [] };
    // Who this is, for a model (src/person.js, a part of its own): in before the request is written.
    if (!GH.person && GH.lazy) await GH.lazy('person').catch(() => null);
    const ids = allowedMoves(S, day, w, draft);
    const R = rules(S, day, w, draft);
    const fixes = [];
    const opt = { fixes, own: !!(o && o.own), said: {} };
    let raw = null, error = null;
    try {
      if (by === 'claude') {
        opt.facts = claudeFacts(S, day);
        const prompt = claudePrompt(S, w, draft, ids, day);
        opt.given = `${GH.ai.systemBlocks ? GH.ai.systemBlocks(S, day, 'build').map((b) => b.text).join('\n') : ''}\n${prompt}`;
        raw = await GH.ai.json(S, day, prompt, planSchema(ids, opt.facts.concat('asked')), { feature: 'build' });
      } else {
        const llm = await GH.lazy('llm');
        const id = GH.deviceCoach.pick(S, await llm.installed());
        // (A request its memory can't hold isn't sent: the draft stands.)
        const q = deviceAsk(S, w, draft, ids, day, R, GH.deviceCoach.room ? await GH.deviceCoach.room(S) : null);
        if (q) {
          await llm.load(id);
          opt.reasons = ownWhy(S, day, w, draft, R);
          opt.given = q.msgs.map((m) => m.content).join('\n');
          const text = await llm.chat(q.msgs, { grammar: planGrammar(q.list, draft.days.length, { perDay: q.per, sets: R.sets, reasons: opt.reasons.length }), maxTokens: q.maxTokens, temperature: 0.3, signal });
          raw = readJson(text);
        }
      }
    } catch (e) { raw = null; error = e; }
    if (signal && signal.aborted) return { plan: draft, by: null, fixes: [] };
    const plan = accept(S, day, w, draft, raw, ids, opt);
    return plan ? { plan, by, fixes: uniq(fixes) } : Object.assign({ plan: draft, by: null, fixes: [] }, error ? { error } : {});
  }
  // Their own plan, reworked by a model from their data and what they ask for, and held to the same
  // checks as a plan built from scratch (accept: the same days, time, coverage, focus and balance;
  // what they had and the model kept stays as they had it). Resolves { plan, by, changes, fixes,
  // error? }: plan is null when there's no model or its take didn't pass, and changes says what's
  // different, day by day.
  async function improve(S, day, plan, text, signal) {
    const ask = clean(text, 300);
    const w = wishes(S, ask);
    w.days = plan.days.length;
    w.text = `Improve my own plan from my data${ask ? `, and: ${ask}` : ''}. Keep what works and what I clearly chose; change what would help most.`;
    const draft = copy(plan);
    const r = await refine(S, day, w, draft, signal, { own: true });
    if (!r.by) return Object.assign({ plan: null, by: null, changes: [], fixes: [] }, r.error ? { error: r.error } : {});
    const out = Object.assign(r.plan, { name: plan.name });
    return { plan: out, by: r.by, changes: diff(plan, out), fixes: r.fixes };
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

  Object.assign(C, {
    wishes, choices, generate, build, templates, template, knows, rules, rulesLines, ownWhy, withWhy, say, tidy,
    allowedMoves, planMessages, compactMoves, deviceAsk, planGrammar, planSchema, claudePrompt, claudeFacts, accept, refine, modelFor, readJson, improve, diff,
    BUILD: { SETS_MAX, LIGHT_REPS, WEEK, GOAL_CAP, DAY_SETS, FLEX_REPS, WHY, DEVICE_MOVES, COMPACT_MOVES, CLAUDE_CHARS, MOST, FEEL, SKIP, flexion },
  });
})(typeof window !== 'undefined' ? window : globalThis);
