/* Custom workout plans (GH.customPlan): plans people build themselves, ask the coach to build, or get
 * from someone else, run with the app's own player, progression and readiness, and shared as a QR
 * code or a link.
 *
 * A plan: { v, id, name, note, days: [{ title, items: [{ move, sets, reps | secs, rest? }] }],
 * weekdays: [0-6, one per day] | null (spread like the coach's plan), source: 'you' | 'coach' |
 * 'shared', from?, createdAt, updatedAt }. They live in S.customPlans; S.activePlan is the one in use
 * (null: the coach's plan). Switching is an event, { type: 'plan', day, id, n, wd }, so the calendar
 * replays each week with the plan that was in force: past days keep their meaning and a switch never
 * turns an earlier day into a missed one. Progress on a plan's exercises is kept per plan in
 * S.planProg[planId][`${move}:${base}`] (the prescription it grew from), so editing the reps starts
 * that exercise afresh from what you wrote.
 *
 * GH.brain calls in at four places marked [custom plans]: calendar() takes a week's sessions from
 * weekSessions() and moves a missed day only within one plan's stretch of the week (regime, until),
 * buildSession() hands custom sessions (their tpl is 'c:<plan id>:<day>') to buildSession() here, and
 * finishWorkout() moves their exercises on with progress() here.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;

  const VERSION = 1;
  const LIMITS = { days: 6, items: 12, sets: [1, 10], reps: [1, 100], secs: [5, 600], rest: [0, 300], name: 40, note: 200, title: 30, from: 24 };
  const SHARE_URL = 'https://shadowsdistant.github.io/gradient-health/p/';
  const PATTERNS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const GROUP_ORDER = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'abs', 'conditioning', 'mobility'];
  const GROUP_GOAL = { legs: 'legs', chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'arms', triceps: 'arms', abs: 'abs' };
  const JOINT_NAME = { knee: 'knees', shoulder: 'shoulders', back: 'back', wrist: 'wrists', elbow: 'elbows', hip: 'hips', ankle: 'ankles', neck: 'neck' };
  const EQ_NAME = { db: 'dumbbells', kb: 'a kettlebell', ball: 'a ball', slam: 'a ball you can slam', band: 'a band', bar: 'a pull-up bar', chair: 'a chair', wall: 'a wall', towel: 'a towel', table: 'a sturdy table', door: 'a door anchor', bb: 'a barbell', ez: 'an EZ bar', rack: 'a squat rack', bench: 'a bench', incline: 'an adjustable bench', smith: 'a Smith machine', cable: 'a cable machine', pulldown: 'a lat pulldown', legPress: 'a leg press', legCurl: 'a leg curl machine', legExt: 'a leg extension machine', chestPress: 'a chest press machine', shoulderPress: 'a shoulder press machine', pecDeck: 'a pec deck', dip: 'dip bars', rower: 'a rower', bike: 'an exercise bike', treadmill: 'a treadmill' };
  // Big moves rest longer by default (the brain's auto rest: 90 s after multi-joint moves, 60 s else).
  const COMPOUND = ['push', 'chestDb', 'squat', 'hinge', 'row', 'pull', 'pressG', 'inclineG', 'squatG', 'hingeG', 'pullG', 'rowG', 'ohpG'];
  const GYM_LOADS = ['bb', 'smith', 'ez', 'cable', 'machine', 'db'];

  const clampInt = (x, lo, hi, def) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  // Names people type, or that come in a shared code: one line, no control or direction characters.
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const uniq = (a) => a.filter((x, i) => x != null && a.indexOf(x) === i);
  const newId = () => `p${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`.replace(/[^a-z0-9]/g, '');
  const copy = (x) => JSON.parse(JSON.stringify(x));

  /* ================================================================== the shape of a plan */
  // Only the library's own entries count as moves: a shared code or a backup naming "constructor" or
  // "toString" must not find Object.prototype's (which crashed Today and Plan).
  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  // One exercise, clamped to what the app can run; null for a move this version doesn't know.
  function normItem(raw, report) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const id = String(r.move || '');
    const m = hasOwn(M().MOVES, id) ? M().MOVES[id] : null;
    if (!m || typeof m !== 'object' || !m.name) { if (report && id) report.unknown.push(id.slice(0, 60)); return null; }
    const it = { move: id, sets: clampInt(r.sets, LIMITS.sets[0], LIMITS.sets[1], 3) };
    if (m.timed) it.secs = clampInt(r.secs != null ? r.secs : r.reps, LIMITS.secs[0], LIMITS.secs[1], m.start || 30);
    else it.reps = clampInt(r.reps != null ? r.reps : r.secs, LIMITS.reps[0], LIMITS.reps[1], m.start || 10);
    if (r.rest != null && r.rest !== '') { const rest = clampInt(r.rest, LIMITS.rest[0], LIMITS.rest[1], null); if (rest != null) it.rest = rest; }
    return it;
  }
  // Any plan-like object (older saves, a shared code, a model's answer) into a plan this version runs.
  // opts.draft keeps days that have no exercises yet (a plan being built). Returns { plan, report }.
  function normalize(raw, opts) {
    const o = opts || {};
    const r = raw && typeof raw === 'object' ? raw : {};
    const report = { unknown: [], droppedDays: 0 };
    const now = Date.now();
    let days = (Array.isArray(r.days) ? r.days : []).map((d) => {
      const dd = d && typeof d === 'object' ? d : {};
      const items = (Array.isArray(dd.items) ? dd.items : []).map((x) => normItem(x, report)).filter(Boolean).slice(0, LIMITS.items);
      return { title: clean(dd.title, LIMITS.title), items };
    });
    if (!o.draft) { const n = days.length; days = days.filter((d) => d.items.length); report.droppedDays = n - days.length; }
    days = days.slice(0, LIMITS.days);
    if (!days.length && o.draft) days = [{ title: '', items: [] }];
    let wd = Array.isArray(r.weekdays) ? r.weekdays.map((x) => clampInt(x, 0, 6, -1)) : null;
    if (!wd || wd.length !== days.length || wd.some((x) => x < 0) || new Set(wd).size !== wd.length) wd = null;
    else wd = wd.slice().sort((a, b) => a - b);
    const plan = {
      v: VERSION,
      id: /^[a-z0-9]{3,24}$/.test(String(r.id || '')) ? r.id : newId(),
      name: clean(r.name, LIMITS.name) || 'My plan',
      note: clean(r.note, LIMITS.note),
      days,
      weekdays: wd,
      source: ['you', 'coach', 'shared'].includes(r.source) ? r.source : 'you',
      createdAt: Number(r.createdAt) > 0 ? Number(r.createdAt) : now,
      updatedAt: Number(r.updatedAt) > 0 ? Number(r.updatedAt) : now,
    };
    const from = clean(r.from, LIMITS.from);
    if (from) plan.from = from;
    if (r.deleted) plan.deleted = true;
    return { plan, report };
  }
  // What stops a plan from being used, in plain words (empty when it's ready).
  function problems(plan) {
    const out = [];
    if (!plan || !Array.isArray(plan.days) || !plan.days.length) return ['Add a day with at least one exercise.'];
    plan.days.forEach((d, i) => { if (!d.items.length) out.push(`${dayName(plan, i)} has no exercises yet.`); });
    return out;
  }
  const ready = (plan) => !!plan && !plan.deleted && problems(plan).length === 0;
  const dayName = (plan, i) => (plan.days[i] && plan.days[i].title) || `Day ${i + 1}`;
  const countItems = (plan) => plan.days.reduce((a, d) => a + d.items.length, 0);
  function amountText(it) {
    const m = M().MOVES[it.move];
    return m && m.timed ? `${it.secs} s` : `${it.reps} ${it.reps === 1 ? 'rep' : 'reps'}`;
  }

  // A day's title from what it trains ("Chest, arms and shoulders"), for days without a title.
  function titleFrom(items) {
    const names = [];
    for (const it of items) {
      const m = M().MOVES[it.move || it.moveId];
      if (!m) continue;
      const g = m.group === 'biceps' || m.group === 'triceps' ? 'arms' : m.group;
      const name = g === 'arms' ? 'arms' : String((B().GROUP_NAME || {})[g] || g).toLowerCase();
      if (!names.includes(name)) names.push(name);
    }
    if (!names.length) return 'Workout';
    const s = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return s[0].toUpperCase() + s.slice(1);
  }
  const UNIT_OF = { biceps: 'arms', triceps: 'arms', abs: 'abs', chest: 'chest', legs: 'legs', back: 'back', shoulders: 'shoulders' };
  function unitsOf(items) {
    const out = [];
    for (const it of items || []) { const m = M().MOVES[it.move]; const u = m && UNIT_OF[m.group]; if (u && !out.includes(u)) out.push(u); }
    return out;
  }
  const titleOf = (plan, i) => (plan && plan.days[i] ? plan.days[i].title || titleFrom(plan.days[i].items) : 'Workout');
  function groupsOf(plan, i) {
    const out = [];
    for (const it of (plan.days[i] || { items: [] }).items) { const m = M().MOVES[it.move]; if (m && !out.includes(m.group)) out.push(m.group); }
    return out;
  }
  // Two plans with the same exercises are the same plan (a code scanned twice isn't saved twice).
  function fingerprint(plan) {
    const s = JSON.stringify([plan.name, plan.weekdays, plan.days.map((d) => [d.title, d.items.map((x) => [x.move, x.sets, x.reps || x.secs, x.rest])])]);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /* ================================================================== saved plans */
  function ensure(S) {
    if (!Array.isArray(S.customPlans)) S.customPlans = [];
    if (S.activePlan === undefined) S.activePlan = null;
    if (!S.planProg || typeof S.planProg !== 'object') S.planProg = {};
    if (!Array.isArray(S.events)) S.events = [];
  }
  // Older saves (no plans yet) and plans from an earlier plan format read fine.
  function migrate(S) {
    if (!S) return S;
    ensure(S);
    S.customPlans = S.customPlans.filter((p) => p && typeof p === 'object').map((p) => normalize(p, { draft: true }).plan);
    if (S.activePlan && !ready(get(S, S.activePlan))) S.activePlan = null;
    return S;
  }
  const list = (S) => (S.customPlans || []).filter((p) => !p.deleted);
  const get = (S, id) => (id && (S.customPlans || []).find((p) => p.id === id)) || null;
  const activeId = (S) => (S.activePlan && get(S, S.activePlan) && !get(S, S.activePlan).deleted ? S.activePlan : null);

  function add(S, raw, opts) {
    ensure(S);
    const { plan, report } = normalize(Object.assign({}, raw, { id: null, createdAt: null, updatedAt: null }), { draft: !!(opts && opts.draft) });
    S.customPlans.push(plan);
    return { plan, report };
  }
  function create(S, fields) {
    return add(S, Object.assign({ name: 'My plan', days: [{ title: '', items: [] }], source: 'you' }, fields || {}), { draft: true }).plan;
  }
  // Changes a plan in place (fn edits a copy), keeps it valid and, when it's the plan in use and its
  // days or weekdays changed, starts the new shape from today (or tomorrow, after today's workout).
  function update(S, id, fn, day) {
    const plan = get(S, id);
    if (!plan) return null;
    const draft = copy(plan);
    if (fn) fn(draft);
    const { plan: next } = normalize(Object.assign(draft, { id: plan.id, createdAt: plan.createdAt, updatedAt: Date.now() }), { draft: true });
    Object.keys(plan).forEach((k) => { delete plan[k]; });
    Object.assign(plan, next);
    if (day != null && S.activePlan === id) reshape(S, plan, day);
    return plan;
  }
  function duplicate(S, id) {
    const p = get(S, id);
    if (!p) return null;
    const { plan } = add(S, Object.assign(copy(p), { name: `${p.name.slice(0, LIMITS.name - 5)} copy`, source: 'you' }), { draft: true });
    delete plan.from;
    if (S.planProg[id]) S.planProg[plan.id] = copy(S.planProg[id]);
    return plan;
  }
  // Deleting the plan in use goes back to the coach's plan first. A plan that ran on some day stays
  // (hidden) so the weeks it shaped read the same; Undo takes the returned token.
  function remove(S, id, day) {
    const plan = get(S, id);
    if (!plan) return null;
    const token = { plan: copy(plan), prog: S.planProg[id] ? copy(S.planProg[id]) : null, wasActive: S.activePlan === id, at: S.customPlans.indexOf(plan) };
    if (S.activePlan === id) use(S, null, day);
    const ran = (S.events || []).some((e) => e.type === 'plan' && e.id === id);
    if (ran) plan.deleted = true;
    else S.customPlans.splice(S.customPlans.indexOf(plan), 1);
    delete S.planProg[id];
    return token;
  }
  function restore(S, token, day) {
    if (!token) return null;
    ensure(S);
    const cur = get(S, token.plan.id);
    if (cur) Object.assign(cur, token.plan, { deleted: undefined });
    else S.customPlans.splice(Math.min(token.at, S.customPlans.length), 0, copy(token.plan));
    const plan = get(S, token.plan.id);
    delete plan.deleted;
    if (token.prog) S.planProg[plan.id] = token.prog;
    if (token.wasActive) use(S, plan.id, day);
    return plan;
  }

  /* ================================================================== in use */
  const planEvents = (S) => (S.events || []).filter((e) => e && e.type === 'plan');
  // The switch in force on a day: the latest one on or before it (a later one the same day wins).
  function eventAt(evs, day) {
    let cur = null;
    for (const e of evs) if (e.day <= day && (!cur || e.day >= cur.day)) cur = e;
    return cur;
  }
  // The plan that runs a day (null: the coach's plan).
  function inForce(S, day) { const e = eventAt(planEvents(S), day); return e && e.id ? get(S, e.id) : null; }
  const shapeOf = (plan) => ({ n: plan.days.length, wd: plan.weekdays ? plan.weekdays.slice() : null });
  const sameShape = (e, plan) => !!e && e.n === plan.days.length && JSON.stringify(e.wd || null) === JSON.stringify(plan.weekdays || null);
  // A switch starts today, or tomorrow once today's workout is done or under way (so it doesn't
  // take today's workout from under you).
  function startDay(S, day) {
    const b = B();
    const done = (S.log || []).some((l) => l.type === 'workout' && l.day === day && b.isDone(l));
    return done || (S.active && S.active.day === day) ? day + 1 : day;
  }
  // Puts a plan in use (id null: back to the coach's plan). Returns { from, plan } or null.
  function use(S, id, day) {
    ensure(S);
    const plan = id ? get(S, id) : null;
    if (id && !ready(plan)) return null;
    const from = startDay(S, day);
    S.events = S.events.filter((e) => !(e && e.type === 'plan' && e.day >= from));
    const cur = eventAt(planEvents(S), from);
    const same = plan ? cur && cur.id === plan.id && sameShape(cur, plan) : !cur || !cur.id;
    if (!same) S.events.push(Object.assign({ type: 'plan', day: from, id: plan ? plan.id : null }, plan ? shapeOf(plan) : {}));
    S.activePlan = plan ? plan.id : null;
    return { from, plan };
  }
  function reshape(S, plan, day) {
    if (!ready(plan)) return;
    const from = startDay(S, day);
    const cur = eventAt(planEvents(S), from);
    if (cur && cur.id === plan.id && sameShape(cur, plan)) return;
    use(S, plan.id, day);
  }
  const offsetsFor = (n, wd) => (Array.isArray(wd) && wd.length === n ? wd.slice().sort((a, b) => a - b) : (PATTERNS[n] || PATTERNS[3]).slice());

  // The calendar's hook: a week's sessions when a custom plan is in force on any of its days (else
  // null, and the coach's template stands). Days under the coach's plan keep its sessions; a plan
  // switched on part-way through the week starts at its first day (or, with set weekdays, on them).
  // Each session knows its plan's stretch of the week (regime, until), so a missed day only moves
  // that plan's sessions, and never past its last day. A week that can't be worked out (a plan switch
  // a backup mangled) keeps the coach's template rather than breaking the calendar.
  function weekSessions(S, ws, tpl) {
    try { return planWeek(S, ws, tpl); } catch (e) { return null; }
  }
  function planWeek(S, ws, tpl) {
    const evs = planEvents(S);
    if (!evs.length) return null;
    const at = [];
    for (let k = 0; k < 7; k++) at.push(eventAt(evs, ws + k));
    if (at.every((e) => !e || !e.id)) return null;
    const regime = (e) => (e ? `${e.id || 'coach'}@${e.day}` : 'coach');
    const until = (k) => { let j = k; while (j < 6 && at[j + 1] === at[k]) j++; return ws + j; };
    const out = [];
    for (const t of tpl || []) { const e = at[t.offset]; if (!e || !e.id) out.push({ tpl: t.idx, units: t.units, day: ws + t.offset, planned: ws + t.offset, regime: regime(e), until: until(t.offset) }); }
    for (const e of new Set(at.filter((x) => x && x.id))) {
      const plan = get(S, e.id);
      const n = e.n || (plan ? plan.days.length : 0);
      if (!n) continue;
      const covered = offsetsFor(n, e.wd).map((o, i) => ({ o, i })).filter((x) => at[x.o] === e);
      const fresh = !e.wd && e.day > ws && e.day <= ws + 6;
      covered.forEach((x, k) => {
        const idx = fresh ? k : x.i;
        const d = plan && plan.days[idx];
        // A day emptied since (being rebuilt) is a light day until it has exercises again.
        if (plan && !plan.deleted && d && !d.items.length && ws + x.o >= e.day) return;
        out.push({ tpl: `c:${e.id}:${idx}`, units: d ? unitsOf(d.items) : [], title: plan ? titleOf(plan, idx) : 'Workout', day: ws + x.o, planned: ws + x.o, custom: e.id, regime: regime(e), until: until(x.o) });
      });
    }
    return out.sort((a, b) => a.day - b.day);
  }
  const owns = (tpl) => typeof tpl === 'string' && tpl.startsWith('c:');
  function parseTpl(tpl) { const m = /^c:([a-z0-9]+):(\d+)$/.exec(String(tpl)); return m ? { id: m[1], idx: Number(m[2]) } : null; }

  /* ================================================================== what you can do today */
  // What stands between this person and a move today: equipment, a joint that needs a break or
  // care, no jumping, simpler moves, a move they hid, and anything else the brain's own rules
  // leave out of their plan. ctx caches the day's filters.
  function context(S, day, place) {
    return { S, day, place: place || null, f: B().filtersFor(S, day, place || undefined), rungs: {} };
  }
  function needs(m, eq) {
    return (m.req || []).filter((alt) => !alt.split('|').some((k) => M().has(eq, k))).map((alt) => alt.split('|').map((k) => EQ_NAME[k] || k).join(' or '));
  }
  function check(ctx, id) {
    const m = M().MOVES[id];
    if (!m) return { ok: false, why: 'unknown' };
    const f = ctx.f;
    if (!M().allowed(m, f.eq)) return { ok: false, why: 'equipment', need: needs(m, f.eq) };
    if ((ctx.S.excluded || []).includes(id)) return { ok: false, why: 'hidden' };
    const joints = m.joints || [];
    const pain = joints.find((j) => (f.avoidJoints || []).includes(j));
    if (pain) return { ok: false, why: 'pain', joint: pain };
    if (f.noImpact && m.impact) return { ok: false, why: 'impact' };
    const careful = (m.impact || m.complex) && joints.find((j) => (f.careful || []).includes(j));
    if (careful) return { ok: false, why: 'careful', joint: careful };
    if (f.simple && m.complex) return { ok: false, why: 'simple' };
    // Age and health conditions (src/access.js): weight on painful hands, kneeling on a sore knee and
    // the like. The stand-in ladders for those bodies are anyone's to pick here.
    const body = GH.access && GH.access.why(ctx.S.profile, m, ctx.day);
    if (body) return { ok: false, why: 'body', text: body };
    const lad = m.family && M().LADDERS[m.family];
    if (lad && !lad.alt && lad.rungs.includes(id) && !(lad.exclusive || []).some((p) => p.includes(id))) {
      const list = ctx.rungs[m.family] || (ctx.rungs[m.family] = B().rungs(ctx.S, m.family, ctx.day, ctx.place ? { place: ctx.place } : undefined));
      if (!list.includes(id)) return { ok: false, why: 'plan' };
    }
    return { ok: true };
  }
  function whyText(r) {
    if (!r || r.ok) return '';
    switch (r.why) {
      case 'equipment': return r.need && r.need.length ? `needs ${r.need.length > 1 ? `${r.need.slice(0, -1).join(', ')} and ${r.need[r.need.length - 1]}` : r.need[0]}` : 'needs equipment you don\'t have';
      case 'pain': return `easy on your ${JOINT_NAME[r.joint] || r.joint} for now`;
      case 'careful': return `careful with your ${JOINT_NAME[r.joint] || r.joint}`;
      case 'impact': return 'no jumping in your plan';
      case 'simple': return 'simpler moves for now';
      case 'hidden': return 'you hid it';
      case 'body': return String(r.text || '').replace(/^./, (c) => c.toLowerCase());
      case 'unknown': return 'needs a newer version of the app';
      default: return 'left out of your plan for now';
    }
  }
  // How alike two moves are: the same ladder (nearest level first), the same main muscle and the
  // others it works, how they're done (held or for reps, with a weight or without, one side or
  // both), and the level this person is at in the stand-in's own ladder.
  function likeness(S, a, b) {
    let s = 0;
    for (const lad of Object.values(M().LADDERS)) {
      const i = lad.rungs.indexOf(a.id), j = lad.rungs.indexOf(b.id);
      if (i >= 0 && j >= 0) { s = Math.max(s, 100 - Math.abs(i - j) * 4 + (j < i ? 1 : 0)); }
    }
    const am = a.muscles || [], bm = b.muscles || [];
    if (am[0] && am[0] === bm[0]) s += 20;
    if (am.length) s += 15 * am.filter((x) => bm.includes(x)).length / am.length;
    if (!!a.timed === !!b.timed) s += 15;
    if (!!a.load === !!b.load) s += 12;
    if (!!a.uni === !!b.uni) s += 4;
    if (b.family && S.prog && S.prog[b.family] && S.prog[b.family].rung === b.id) s += 8;
    if (b.complex) s -= 3;
    if (b.impact) s -= 3;
    return s;
  }
  // The move to do for a plan's move today: itself, or the most similar one this person can do.
  // Returns { id, why } (id null when nothing fits).
  function choose(ctx, id) {
    const r = check(ctx, id);
    if (r.ok) return { id, why: null };
    const m0 = M().MOVES[id];
    if (!m0) return { id: null, why: r };
    let best = null;
    for (const [cid, m] of Object.entries(M().MOVES)) {
      if (cid === id || m.group !== m0.group || !m.name) continue;
      const score = likeness(ctx.S, m0, m);
      if (best && score <= best.score) continue;
      if (!check(ctx, cid).ok) continue;
      best = { id: cid, score };
    }
    return { id: best ? best.id : null, why: r };
  }
  // A plan as it would run for this person today: each move, and what stands in for the ones they
  // can't do (for previews: a shared plan, a plan's page). [{ day, i, move, to, why }]
  function swapsFor(S, plan, day, place) {
    const ctx = context(S, day, place);
    const out = [];
    plan.days.forEach((d, di) => d.items.forEach((it, i) => {
      const pick = choose(ctx, it.move);
      if (pick.id !== it.move) out.push({ day: di, i, move: it.move, to: pick.id, why: whyText(pick.why) });
    }));
    return out;
  }
  // Every move someone could put in a plan, with whether they can do it at home and at the gym.
  function catalog(S, day) {
    const where = S.profile.where || 'home';
    const home = where !== 'gym' ? context(S, day, 'home') : null;
    const gym = where !== 'home' ? context(S, day, 'gym') : null;
    const out = [];
    for (const [id, m] of Object.entries(M().MOVES)) {
      if (!m.name || !m.group) continue;
      const h = home ? check(home, id) : null, g = gym ? check(gym, id) : null;
      out.push({ id, name: m.name, group: m.group, timed: !!m.timed, ok: !!((h && h.ok) || (g && g.ok)), home: !!(h && h.ok), gym: !!(g && g.ok), why: whyText((h && !h.ok ? h : null) || g) });
    }
    return out;
  }

  /* ================================================================== a day's session */
  function autoRest(S, fam) {
    const pr = S.profile.prefs && S.profile.prefs.rest;
    if (pr === 60 || pr === 90 || pr === '60' || pr === '90') return Number(pr);
    return COMPOUND.includes(fam) ? 90 : 60;
  }
  // The prescription for the move actually done: the plan's own numbers, or for a stand-in, the same
  // numbers within its range (its own start when one is held and the other counted).
  function baseFor(it, m) {
    const planned = M().MOVES[it.move];
    let base = planned && planned.timed ? it.secs : it.reps;
    if (m.id !== it.move) base = !!(planned && planned.timed) !== !!m.timed ? m.start : Math.max(m.range[0], Math.min(m.range[1], base));
    return base;
  }
  const keyOf = (id, base) => `${id}:${base}`;
  const book = (S, planId) => ((S.planProg || (S.planProg = {}))[planId] || (S.planProg[planId] = {}));
  function loadFor(S, m, day, st) {
    const b = B();
    const fam = m.family || undefined;
    let load = b.loadInfo(S, m, day, fam);
    if (!load || !st) return load;
    if (st.kg != null && load.kg != null && b.isGymFam(fam) && GYM_LOADS.includes(load.key)) {
      const unit = S.profile.units === 'kg' ? 'kg' : 'lb';
      load = Object.assign({}, load, { kg: st.kg, value: Math.round(b.toUnit(st.kg, unit) * 10) / 10, guess: false, label: b.fmtLoad(S, st.kg, load.key, m) });
    } else if (st.w != null && (load.key === 'db' || load.key === 'kb')) {
      const list = (b.eqFor(S, day)[load.key] || []).slice().sort((x, y) => x - y);
      const value = list[Math.max(0, Math.min(st.w, list.length - 1))];
      if (value != null) {
        const unit = S.profile.units === 'kg' ? 'kg' : 'lb';
        load = Object.assign({}, load, { value, kg: b.fromUnit(value, unit), label: String(load.label || '').replace(/^[\d.]+/, Number.isInteger(value) ? String(value) : value.toFixed(1)) });
      }
    }
    return load;
  }
  function warmup(S, day, short) {
    const b = B(), mv = M();
    const eq = b.eqFor(S, day);
    const avoid = b.filtersFor(S, day).avoidJoints || [];
    const list = (eq.kb && eq.kb.length ? mv.WARMUP.kb : mv.WARMUP.none).filter((id) => mv.MOVES[id] && mv.allowed(mv.MOVES[id], eq) && !(mv.MOVES[id].joints || []).some((j) => avoid.includes(j)));
    const pick = short ? list.slice(0, 2) : list;
    return pick.map((id) => { const m = mv.MOVES[id]; return { kind: 'warmup', moveId: id, name: m.name, timed: !!m.timed, target: short ? Math.min(m.start, 20) : m.start, load: b.loadInfo(S, m, day) }; });
  }
  // A plan's day that can't be built (a shared code or backup that got past the checks, or a bug)
  // never takes Today or Plan down: that day runs the coach's session instead, with a note saying
  // so, and the plan is flagged (plan.broken, until it's edited or the app restarts).
  function buildSession(S, day, tpl, opts) {
    try { return planSession(S, day, tpl, opts); } catch (e) { return coachInstead(S, day, tpl, opts); }
  }
  function coachInstead(S, day, tpl, opts) {
    const b = B();
    const ref = parseTpl(tpl);
    const plan = ref ? get(S, ref.id) : null;
    if (plan) plan.broken = true;
    const set = b.settingsAt(S, day);
    const T = b.templateFor(Object.assign({}, S.profile, { days: set.days, weekdays: set.weekdays }), b.programFor(Object.assign({}, S.profile, { days: set.days })));
    const off = day - b.weekStart(day);
    const t = T.find((x) => x.offset === off) || T[(ref ? ref.idx : 0) % Math.max(1, T.length)] || T[0];
    const s = b.buildSession(S, day, t ? t.idx : 0, opts);
    s.planBroken = { id: plan ? plan.id : ref ? ref.id : null, name: plan ? plan.name : '' };
    s.notes = (s.notes || []).concat({ kind: 'plan', text: `${plan && plan.name ? `Your plan "${plan.name}"` : 'Your plan'} couldn't be used today, so this is the coach's workout.` });
    return s;
  }
  // The session for a custom plan's day, shaped like the brain's: the plan's exercises with today's
  // swaps, sets scaled for a lighter week and trimmed for a short night (never below one), targets
  // and weights from how each one has gone, and the usual warm-up. opts as brain.buildSession.
  function planSession(S, day, tpl, opts) {
    const o = opts || {};
    const b = B();
    const ref = parseTpl(tpl) || { id: null, idx: 0 };
    const plan = get(S, ref.id);
    const pd = plan && plan.days[ref.idx];
    const cal = o.cal || b.calendar(S, day);
    const week = (cal.weeks && cal.weeks[b.weekStart(day)]) || { phase: { mult: 1, onramp: false, deload: false } };
    const mult = o.forceMult != null ? o.forceMult : week.phase.mult;
    const ready0 = o.noReadiness ? { minus: 0, legsMinus: 0, reasons: [] } : b.readiness(S, day);
    const ctx = context(S, day);
    const items = [], swaps = [];
    (pd ? pd.items : []).forEach((it, i) => {
      const pick = choose(ctx, it.move);
      if (!pick.id) { swaps.push({ from: it.move, to: null, why: whyText(pick.why) }); return; }
      if (pick.id !== it.move) swaps.push({ from: it.move, to: pick.id, why: whyText(pick.why) });
      const m = M().MOVES[pick.id];
      let sets = Math.max(1, Math.round(it.sets * mult));
      if (ready0.minus) sets = Math.max(1, sets - 1);
      if (ready0.legsMinus && m.group === 'legs') sets = Math.max(1, sets - 1);
      const base = baseFor(it, m);
      const key = keyOf(m.id, base);
      const st = (S.planProg && S.planProg[plan.id] && S.planProg[plan.id][key]) || null;
      const fam = m.family || null;
      const load = loadFor(S, m, day, st);
      const w = load && (load.key === 'db' || load.key === 'kb') ? Math.max(0, (b.eqFor(S, day)[load.key] || []).slice().sort((x, y) => x - y).indexOf(load.value)) : null;
      items.push({
        kind: 'move', fam, moveId: m.id, name: m.name, group: m.group, sets, target: st ? st.reps : base,
        timed: !!m.timed, uni: !!m.uni, rest: it.rest != null ? it.rest : autoRest(S, fam), load,
        swappedFrom: pick.id !== it.move ? it.move : null, swapWhy: pick.id !== it.move ? whyText(pick.why) : null, superset: null,
        plan: { id: plan.id, day: ref.idx, i, move: it.move, built: m.id, base, key, w },
      });
    });
    const s = {
      day, tpl, units: pd ? unitsOf(pd.items) : [], title: plan ? titleOf(plan, ref.idx) : 'Workout', short: !!o.short,
      phase: week.phase, readiness: ready0, warmup: warmup(S, day, !!o.short), tests: [], items, extras: [], finisher: null,
      notes: swaps.map((x) => (x.to ? `${M().MOVES[x.from].name} → ${M().MOVES[x.to].name}: ${x.why}` : `${(M().MOVES[x.from] || { name: x.from }).name} left out: ${x.why}`)),
      mobility: [], place: b.placeOf(S, day), comeback: null, trimmed: [],
      custom: { id: plan ? plan.id : ref.id, name: plan ? plan.name : '', day: ref.idx, swaps },
    };
    // The warm-up, cool-down, flare days and notes a body's plan gets (src/access.js); the exercises
    // stay as the plan has them.
    if (GH.access) GH.access.adjustSession(S, s, day, { custom: true });
    if (o.short) shorten(S, s);
    s.estimateMin = Math.round(b.estimate(S, s));
    s.groups = uniq(s.items.map((it) => it.group));
    s.items.forEach((it, k) => { it.uid = `i${k}`; });
    s.warmup.forEach((it, k) => { it.uid = `w${k}`; });
    return s;
  }
  // Short on time: two sets at most, then the last exercises go until it fits 15 minutes.
  function shorten(S, s) {
    for (const it of s.items) it.sets = Math.min(it.sets, 2);
    let guard = 0;
    while (B().estimate(S, s) > 15 && guard++ < 40) {
      if (s.items.length > 2) { s.trimmed.push(s.items.pop().name); continue; }
      const c = s.items.slice().reverse().find((it) => it.sets > 1);
      if (!c) break;
      c.sets--;
    }
  }
  // About how long a plan's day takes as written (for the plan's page).
  function minutes(S, plan, i, day) {
    const d = plan.days[i];
    if (!d || !d.items.length) return 0;
    const b = B();
    const s = { warmup: warmup(S, day), tests: [], extras: [], finisher: null, mobility: [], items: [] };
    for (const it of d.items) {
      const m = M().MOVES[it.move];
      if (!m) continue;
      s.items.push({ moveId: m.id, sets: it.sets, target: m.timed ? it.secs : it.reps, timed: !!m.timed, uni: !!m.uni, rest: it.rest != null ? it.rest : autoRest(S, m.family) });
    }
    return Math.max(1, Math.round(b.estimate(S, s)));
  }

  /* ================================================================== progression */
  // After a custom session: the usual record-keeping (personal bests, best weights and strength
  // estimates, as for any workout, without moving the coach's own levels), then this exercise's
  // target: more reps (or seconds) while there's room, then a heavier weight when the move takes one,
  // back down when it was well short twice. The same steps the coach's plan takes, from the
  // prescription you wrote. Returns { line, celebrate, outcome }.
  function progress(S, log, deload, day, item) {
    const b = B(), mv = M();
    const res = b.progress(S, log, true, day) || {};
    const out = { line: null, celebrate: (res.celebrate || []).slice(), outcome: 'hold' };
    const P = item && item.plan;
    const m = mv.MOVES[log.moveId];
    if (!P || !m) return out;
    // A swap in the player: the move done has its own prescription.
    const base = log.moveId === P.built ? P.base : baseFor({ move: P.move, reps: P.base, secs: P.base }, m);
    const bk = book(S, P.id);
    const key = keyOf(m.id, base);
    const st = bk[key] || (bk[key] = { reps: base, short: 0 });
    st.n = (st.n || 0) + 1;
    st.last = day;
    const firstSide = log.uni ? log.sets.filter((_, k) => k % 2 === 0) : log.sets;
    if (!firstSide.length) return out;
    const eq = b.eqFor(S, day);
    const lkey = mv.loadFor(m, eq);
    const fam = m.family;
    const gym = !!lkey && GYM_LOADS.includes(lkey) && b.isGymFam(fam);
    const home = !gym && (lkey === 'db' || lkey === 'kb');
    const loaded = firstSide.filter((x) => x.load > 0);
    const work = loaded.length ? Math.max(...loaded.map((x) => x.load)) : null;
    const list = home ? (eq[lkey] || []).slice().sort((x, y) => x - y) : [];
    const unit = S.profile.units === 'kg' ? 'kg' : 'lb';
    // Keep what was actually used as the starting point.
    if (gym && work != null) st.kg = work;
    if (home) {
      if (st.w == null) st.w = P.w != null ? P.w : 0;
      if (work != null && list.length) { const v = b.toUnit(work, unit); let k = 0; list.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(list[k] - v)) k = i; }); st.w = k; }
    }
    if (deload) return out;
    const canHeavier = gym ? work != null : home && st.w < list.length - 1;
    const top = m.timed ? (canHeavier ? base + 15 : Math.min(LIMITS.secs[1], Math.max(m.range[1], Math.round(base * 1.5))))
      : canHeavier ? base + Math.max(2, Math.round(base * 0.3)) : Math.min(LIMITS.reps[1], Math.max(m.range[1], Math.round(base * 1.5)));
    const target = log.target || st.reps;
    const allHit = firstSide.every((x) => x.amount >= target);
    const avg = firstSide.reduce((a, x) => a + x.amount, 0) / firstSide.length;
    const u = m.timed ? ' s' : ' reps';
    const heavier = () => {
      if (gym) {
        const next = b.snapLoad(S, lkey, work, +1, day);
        if (next != null && next > work + 1e-6) { st.kg = next; return b.fmtLoad(S, next, lkey, m); }
      } else if (home && st.w < list.length - 1) {
        st.w++;
        return `${list[st.w]} ${unit} ${lkey === 'kb' ? 'kettlebell' : m.uni ? 'dumbbell' : 'dumbbells'}`;
      }
      return null;
    };
    const lighter = () => {
      if (gym && work != null) {
        let down = b.snapLoad(S, lkey, work * 0.9, 0, day);
        if (!(down < work - 1e-6)) down = b.snapLoad(S, lkey, work, -1, day);
        if (down != null && down < work - 1e-6) { st.kg = down; return b.fmtLoad(S, down, lkey, m); }
      } else if (home && st.w > 0) {
        st.w--;
        return `${list[st.w]} ${unit} ${lkey === 'kb' ? 'kettlebell' : m.uni ? 'dumbbell' : 'dumbbells'}`;
      }
      return null;
    };
    if (allHit && (log.rir === '3' || log.rir === '12')) {
      st.short = 0;
      if (st.reps >= top) {
        const label = gym || log.rir === '3' ? heavier() : null;
        if (label) {
          st.reps = base;
          out.line = { text: `${m.name} → ${label}`, why: 'top of your range with reps to spare' };
          out.celebrate.push({ kind: 'weight', text: `Heavier: ${label} ${m.name.toLowerCase()}` });
          out.outcome = 'up';
        } else if (!st.topNoted) {
          st.topNoted = day;
          const harder = nextHarder(S, m, day);
          out.line = harder
            ? { text: `${m.name}: top of your range. Ready for ${harder.name.toLowerCase()}?`, why: 'swap it into your plan when you like' }
            : { text: `${m.name}: top of your range`, why: 'you had reps to spare' };
        }
      } else {
        const step = log.rir === '3' ? (m.timed ? 10 : 2) : m.timed ? 5 : st.reps < 12 ? 1 : 2;
        const next = Math.min(top, st.reps + step);
        if (next > st.reps) {
          st.reps = next;
          out.line = { text: `${m.name} → ${next}${u}`, why: log.rir === '3' ? 'you had 3+ left' : 'you had 1-2 left' };
          out.outcome = 'up';
        }
      }
    } else if (!allHit) {
      if (avg < base) {
        st.short = (st.short || 0) + 1;
        if (st.short >= 2) {
          st.short = 0;
          const label = lighter();
          if (label) { st.reps = base; out.line = { text: `${m.name} → ${label}`, why: 'short of your reps twice' }; out.outcome = 'down'; }
          else {
            const nt = Math.max(1, Math.round(avg));
            if (nt < st.reps) { st.reps = nt; out.line = { text: `${m.name} → ${nt}${u}`, why: 'matching what you got' }; out.outcome = 'down'; }
          }
        } else if (st.reps > base) { st.reps = base; out.line = { text: `${m.name} → ${base}${u}`, why: 'matching what you got' }; out.outcome = 'down'; }
      } else {
        st.short = 0;
        const nt = Math.max(base, Math.round(avg));
        if (nt < st.reps) { st.reps = nt; out.line = { text: `${m.name} → ${nt}${u}`, why: 'matching what you got' }; out.outcome = 'down'; }
      }
    } else st.short = 0;
    return out;
  }
  // The next harder level of a move this person can do (its ladder's next rung), or null.
  function nextHarder(S, m, day) {
    const lad = m.family && M().LADDERS[m.family];
    if (!lad || lad.gym) return null;
    const ctx = context(S, day);
    const list = lad.rungs.filter((id) => check(ctx, id).ok);
    const at = list.indexOf(m.id);
    return at >= 0 && at < list.length - 1 ? M().MOVES[list[at + 1]] : null;
  }

  /* ================================================================== from the coach's plan */
  // The coach's current week as a plan to start from: its days, exercises and sets as they stand.
  function fromCoach(S, day) {
    const b = B();
    const p = S.profile;
    const set = b.settingsAt(S, day);
    const tpl = b.templateFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays }), b.programFor(Object.assign({}, p, { days: set.days })));
    const ws = b.weekStart(day);
    const days = tpl.map((t) => {
      const s = b.buildSession(S, ws + t.offset, t.idx, { cal: { weeks: {} }, noReadiness: true, forceMult: 1 });
      return { title: s.title, items: itemsOf(s) };
    });
    const wd = Array.isArray(set.weekdays) && set.weekdays.length === set.days ? set.weekdays : null;
    return normalize({ name: 'My plan', days, weekdays: wd, source: 'you' }).plan;
  }
  function itemsOf(s) {
    const out = s.items.map((it) => (it.timed ? { move: it.moveId, sets: it.sets, secs: it.target } : { move: it.moveId, sets: it.sets, reps: it.target }));
    if (s.finisher) out.push({ move: s.finisher.moveId, sets: s.finisher.rounds, secs: s.finisher.work, rest: s.finisher.rest });
    return out;
  }

  /* ================================================================== sharing */
  // A plan as compact JSON: [name, note, from, weekdays | 0, [[title, [move, sets, reps or secs, rest?], …], …]].
  function pack(plan, from) {
    return [plan.name, plan.note || '', clean(from, LIMITS.from), plan.weekdays || 0, plan.days.map((d) => [d.title || ''].concat(d.items.map((it) => {
      const a = [it.move, it.sets, it.secs != null ? it.secs : it.reps];
      if (it.rest != null) a.push(it.rest);
      return a;
    })))];
  }
  function unpack(a) {
    if (!Array.isArray(a) || a.length < 5 || !Array.isArray(a[4])) throw codeError('broken');
    return {
      name: a[0], note: a[1], from: a[2], weekdays: Array.isArray(a[3]) ? a[3] : null, source: 'shared',
      days: a[4].map((d) => (Array.isArray(d) ? { title: d[0], items: d.slice(1).map((x) => (Array.isArray(x) ? { move: x[0], sets: x[1], reps: x[2], rest: x[3] } : null)).filter(Boolean) } : { items: [] })),
    };
  }
  function codeError(code) {
    const text = {
      broken: 'That code doesn\'t hold a plan.',
      newer: 'This plan was shared from a newer version of Gradient Health. Update the app to open it.',
      unsupported: 'This phone can\'t unpack that plan. Update Android System WebView and try again.',
    }[code] || 'That code doesn\'t hold a plan.';
    const e = new Error(text);
    e.code = code;
    return e;
  }
  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return G.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = G.atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function canCompress() {
    try { return typeof G.CompressionStream === 'function' && !!new G.CompressionStream('deflate-raw'); } catch (e) { return false; }
  }
  async function through(bytes, stream, limit) {
    const reader = new G.Blob([bytes]).stream().pipeThrough(stream).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (limit && n > limit) { try { reader.cancel(); } catch (e) { /* ignore */ } throw codeError('broken'); }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  // The plan as the text of a link: a version byte (the top bit set when what follows is compressed
  // with deflate), then the packed plan, all in base64url.
  async function encode(plan, opts) {
    const o = opts || {};
    const json = new G.TextEncoder().encode(JSON.stringify(pack(plan, o.from)));
    let body = json, flag = 0;
    if (o.compress !== false && canCompress()) {
      const z = await through(json, new G.CompressionStream('deflate-raw'));
      if (z.length < json.length) { body = z; flag = 0x80; }
    }
    const bytes = new Uint8Array(body.length + 1);
    bytes[0] = VERSION | flag;
    bytes.set(body, 1);
    return b64url(bytes);
  }
  // The plan's data out of anything someone might scan or open: the share link, the app's own link,
  // an Android intent link, or the bare data.
  function dataFrom(text) {
    const s = String(text || '').trim();
    let m = /^https?:\/\/[^\s#]*\/p\/?(?:index\.html)?#(?:d=)?([A-Za-z0-9_-]+)\s*$/i.exec(s);
    if (m) return m[1];
    m = /^(?:gradienthealth|intent):\/\/plan\/?\?(?:[^#]*&)?d=([A-Za-z0-9_-]+)/i.exec(s);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{12,}$/.test(s)) return s;
    return null;
  }
  const isLink = (text) => !!dataFrom(text) && /^(https?|gradienthealth|intent):/i.test(String(text || '').trim());
  // Back to a plan (not saved yet): { plan, report } or an Error with .code (broken, newer, unsupported).
  async function decode(text) {
    const data = dataFrom(text);
    if (!data || data.length > 12000) throw codeError('broken');
    let bytes;
    try { bytes = unb64url(data); } catch (e) { throw codeError('broken'); }
    if (bytes.length < 2) throw codeError('broken');
    const v = bytes[0] & 0x7f;
    if (v > VERSION) throw codeError('newer');
    if (v < 1) throw codeError('broken');
    let body = bytes.subarray(1);
    if (bytes[0] & 0x80) {
      if (typeof G.DecompressionStream !== 'function') throw codeError('unsupported');
      try { body = await through(body, new G.DecompressionStream('deflate-raw'), 65536); } catch (e) { throw e && e.code ? e : codeError('broken'); }
    }
    let a;
    try { a = JSON.parse(new G.TextDecoder().decode(body)); } catch (e) { throw codeError('broken'); }
    const out = normalize(unpack(a));
    if (!out.plan.days.length) throw codeError('broken');
    out.plan.source = 'shared';
    return out;
  }
  const link = (data) => `${SHARE_URL}#${data}`;
  const appLink = (data) => `gradienthealth://plan?d=${data}`;
  function summary(plan) {
    const n = plan.days.length, k = countItems(plan);
    return `${n} ${n === 1 ? 'day' : 'days'} · ${k} ${k === 1 ? 'exercise' : 'exercises'}`;
  }
  // "Alex's 3-day plan", or "A 3-day plan".
  function sharedTitle(plan) {
    const n = plan.days.length;
    return plan.from ? `${plan.from}'s ${n}-day plan` : `A ${n}-day plan`;
  }
  // Saves a shared or built plan (not twice: the same exercises find the saved copy).
  function save(S, plan) {
    ensure(S);
    const fp = fingerprint(plan);
    const have = list(S).find((p) => fingerprint(p) === fp);
    if (have) return { plan: have, existed: true };
    const { plan: saved } = add(S, plan);
    saved.source = plan.source || 'you';
    if (plan.from) saved.from = plan.from;
    return { plan: saved, existed: false };
  }

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
  // Nicer names than "Arms, chest, back and abs" for the usual splits.
  function niceTitle(groups) {
    const g = new Set(groups);
    const upper = ['chest', 'back', 'shoulders', 'biceps', 'triceps'].filter((x) => g.has(x)).length;
    const lower = g.has('legs');
    if (lower && upper >= 3) return 'Full body';
    if (!lower && upper >= 3) return 'Upper body';
    if (lower && !upper) return 'Lower body';
    return '';
  }
  const SPLITS = {
    ppl: [['Push', ['chest', 'shoulders', 'triceps']], ['Pull', ['back', 'biceps']], ['Legs', ['legs', 'abs']]],
    upperlower: [['Upper body', ['chest', 'back', 'shoulders', 'biceps', 'triceps']], ['Lower body', ['legs', 'abs']]],
    full: [['Full body', ['chest', 'back', 'legs', 'shoulders', 'biceps', 'triceps', 'abs']]],
  };
  // The plan the app's own generator makes from the wishes: the brain's week for a copy of this
  // person (their levels, equipment and joints, with the wishes applied), turned into a plan. It
  // only ever holds moves the brain picked for them, so it's always one they can do.
  function generate(S, day, w) {
    const b = B();
    const S2 = sandbox(S, w);
    const p = S2.profile;
    const tpl = b.templateFor(p, b.programFor(p));
    const ws = b.weekStart(day);
    const sessions = tpl.map((t) => b.buildSession(S2, ws + t.offset, t.idx, { cal: { weeks: {} }, noReadiness: true, forceMult: 1 }));
    const D = clampInt(w.days || p.days, 1, 6, 3);
    let days;
    if (w.split || D !== sessions.length) days = resplit(S2, sessions, w.split || 'full', D, p.minutes, day);
    else days = sessions.map((s) => ({ title: niceTitle(s.groups || []) || s.title, items: itemsOf(s) }));
    const wd = !w.days && Array.isArray(S.profile.weekdays) && S.profile.weekdays.length === days.length ? S.profile.weekdays : null;
    return normalize({ name: nameFor(w, days.length), note: noteFor(S, w, days.length, p.minutes), days, weekdays: wd, source: 'coach' }).plan;
  }
  // The same exercises regrouped into a split: each day takes its muscles' moves from the week's
  // pool, taking turns so the days differ, until it fills the time.
  function resplit(S2, sessions, split, D, minutes, day) {
    const b = B();
    const pool = [];
    const add = (it) => { if (it && !pool.some((x) => x.moveId === it.moveId)) pool.push(it); };
    for (const s of sessions) for (const it of s.items) add(Object.assign({}, it, { superset: null }));
    // Muscles the week had little room for get this person's current level of each of their moves.
    const ctx = context(S2, day);
    for (const [fam, lad] of Object.entries(M().LADDERS)) {
      if (lad.group === 'conditioning' || !UNIT_OF[lad.group]) continue;
      const ok = lad.rungs.filter((id) => check(ctx, id).ok);
      if (!ok.length) continue;
      const st = S2.prog[fam];
      const id = st && ok.includes(st.rung) ? st.rung : ok[0];
      const m = M().MOVES[id];
      add({ moveId: id, name: m.name, group: lad.group, fam, sets: 3, target: st && st.rung === id ? st.reps : m.start, timed: !!m.timed, uni: !!m.uni, rest: autoRest(S2, fam) });
    }
    for (const s of sessions) if (s.finisher) add({ moveId: s.finisher.moveId, group: 'conditioning', sets: s.finisher.rounds, target: s.finisher.work, timed: true, uni: !!s.finisher.uni, rest: s.finisher.rest, finisher: true });
    const budget = minutes - b.programFor(S2.profile).warmupMin;
    const kinds = SPLITS[split] || SPLITS.full;
    const used = new Map();
    const out = [];
    for (let k = 0; k < D; k++) {
      const [title, groups] = kinds[k % kinds.length];
      const turn = Math.floor(k / kinds.length);
      const byGroup = groups.map((g) => pool.filter((it) => it.group === g));
      const day = { warmup: [], tests: [], extras: [], finisher: null, mobility: [], items: [] };
      for (let round = 0; round < 6; round++) {
        let added = false;
        for (const list of byGroup) {
          if (!list.length) continue;
          const it = list[(turn + round) % list.length];
          if (day.items.some((x) => x.moveId === it.moveId)) continue;
          const sets = Math.max(2, Math.min(4, it.sets || 3));
          day.items.push(Object.assign({}, it, { sets, superset: null }));
          added = true;
          if (b.estimate(S2, day) > budget + 1 && day.items.length > 2) { day.items.pop(); added = false; break; }
        }
        if (!added || b.estimate(S2, day) >= budget - 2) break;
      }
      if (!day.items.length) for (const it of pool.slice(0, 4)) day.items.push(Object.assign({}, it, { sets: 3 }));
      for (const it of day.items) used.set(it.moveId, (used.get(it.moveId) || 0) + 1);
      out.push({ title: kinds.length === 1 && D > 1 ? `${title} ${String.fromCharCode(65 + (k % 26))}` : title, items: day.items.map((it) => (it.timed ? { move: it.moveId, sets: it.sets, secs: it.target, rest: it.finisher ? it.rest : undefined } : { move: it.moveId, sets: it.sets, reps: it.target })) });
    }
    return out;
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
  // A model's answer, kept only if it's a plan this person can do with the days they asked for;
  // anything else keeps the draft. Returns the plan, or null.
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
    }
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
  // The draft, refined by a model when there is one. Resolves { plan, by } (by: 'claude', 'device'
  // or null when the draft stands).
  async function refine(S, day, w, draft, signal) {
    const by = await modelFor(S);
    if (!by) return { plan: draft, by: null };
    const ids = allowedMoves(S, day, w, draft);
    let raw = null;
    try {
      if (by === 'claude') raw = await GH.ai.json(S, day, claudePrompt(S, w, draft, ids), planSchema(ids), { maxTokens: 6000 });
      else {
        const llm = await GH.lazy('llm');
        const id = GH.deviceCoach.pick(S, await llm.installed());
        await llm.load(id);
        const text = await llm.chat(planMessages(S, w, draft, ids), { grammar: planGrammar(ids, draft.days.length), maxTokens: 200 * draft.days.length + 150, temperature: 0.3, signal });
        raw = readJson(text);
      }
    } catch (e) { raw = null; }
    if (signal && signal.aborted) return { plan: draft, by: null };
    const plan = accept(S, day, w, draft, raw, ids);
    return plan ? { plan, by } : { plan: draft, by: null };
  }
  function readJson(text) {
    const s = String(text || '').trim();
    for (const tail of ['', '"}', '}', ']}', '}]}', '"}]}']) { try { return JSON.parse(s + tail); } catch (e) { /* try the next */ } }
    return null;
  }

  GH.customPlan = {
    VERSION, LIMITS, SHARE_URL, PATTERNS,
    normalize, problems, ready, dayName, titleOf, titleFrom, groupsOf, unitsOf, amountText, countItems, summary, fingerprint,
    ensure, migrate, list, get, activeId, create, add, update, duplicate, remove, restore, save,
    use, inForce, eventAt: (S, day) => eventAt(planEvents(S), day), startDay, weekSessions, owns, parseTpl, buildSession, minutes, progress, nextHarder,
    context, check, choose, whyText, swapsFor, catalog, offsetsFor,
    fromCoach, encode, decode, dataFrom, isLink, link, appLink, sharedTitle,
    wishes, generate, knows, allowedMoves, planMessages, planGrammar, planSchema, accept, refine, modelFor, readJson,
  };
})(typeof window !== 'undefined' ? window : globalThis);
