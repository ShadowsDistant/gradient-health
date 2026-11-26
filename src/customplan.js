/* Custom workout plans (GH.customPlan): plans people build themselves, ask the coach to build, or get
 * from someone else, run with the app's own player, progression and readiness, and shared as a QR
 * code, a link or a short plan code (src/plancode.js, which loads with the plan builder).
 *
 * A plan: { v, id, name, note, days: [{ title, items: [{ move, sets, reps | secs, rest? }] }],
 * weekdays: [0-6, one per day] | null (spread like the coach's plan), source: 'you' | 'coach' |
 * 'shared', from?, createdAt, updatedAt }. One the coach built also says why it's this person's
 * (src/planbuild.js): why, up to three lines, and a line on each day (day.why); they go when its
 * exercises are changed. They live in S.customPlans; S.activePlan is the one in use
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
  const LIMITS = { days: 6, items: 12, sets: [1, 10], reps: [1, 100], secs: [5, 600], rest: [0, 300], name: 40, note: 200, title: 30, from: 24, whys: 3, why: 160, dayWhy: 100 };
  const SHARE_URL = 'https://shadowsdistant.github.io/gradient-health/p/';
  const PATTERNS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const GROUP_ORDER = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'abs', 'conditioning', 'mobility'];
  const GROUP_GOAL = { legs: 'legs', chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'arms', triceps: 'arms', abs: 'abs' };
  const GOAL_GROUPS_OF = { legs: ['legs'], chest: ['chest'], back: ['back'], shoulders: ['shoulders'], arms: ['biceps', 'triceps'], abs: ['abs'] };
  const JOINT_NAME = { knee: 'knees', shoulder: 'shoulders', back: 'back', wrist: 'wrists', elbow: 'elbows', hip: 'hips', ankle: 'ankles', neck: 'neck' };
  const EQ_NAME = { db: 'dumbbells', kb: 'a kettlebell', ball: 'a ball', slam: 'a ball you can slam', band: 'a band', bar: 'a pull-up bar', chair: 'a chair', wall: 'a wall', towel: 'a towel', table: 'a sturdy table', door: 'a door anchor', bb: 'a barbell', ez: 'an EZ bar', rack: 'a squat rack', bench: 'a bench', incline: 'an adjustable bench', smith: 'a Smith machine', cable: 'a cable machine', pulldown: 'a lat pulldown', legPress: 'a leg press', legCurl: 'a leg curl machine', legExt: 'a leg extension machine', chestPress: 'a chest press machine', shoulderPress: 'a shoulder press machine', pecDeck: 'a pec deck', dip: 'dip bars', rower: 'a rower', bike: 'an exercise bike', treadmill: 'a treadmill' };
  // Big moves rest longer by default (the brain's auto rest: 90 s after multi-joint moves, 60 s else).
  const COMPOUND = ['push', 'chestDb', 'squat', 'hinge', 'row', 'pull', 'pressG', 'inclineG', 'squatG', 'hingeG', 'pullG', 'rowG', 'ohpG'];
  const GYM_LOADS = ['bb', 'smith', 'ez', 'cable', 'machine', 'db'];

  const clampInt = (x, lo, hi, def) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  // Names people type, or that come in a shared code: one line, no control or direction characters.
  // (Words only: an object from a crafted code or backup, which String() can throw on, is nothing.)
  const clean = (s, max) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
      const why = clean(dd.why, LIMITS.dayWhy);
      return Object.assign({ title: clean(dd.title, LIMITS.title), items }, why ? { why } : {});
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
    const why = (Array.isArray(r.why) ? r.why : []).map((x) => clean(x, LIMITS.why)).filter(Boolean).slice(0, LIMITS.whys);
    if (why.length) plan.why = why;
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
    // A built plan's reasons are about its exercises: once those change they go, unless the change
    // brought reasons of its own (Improve). Moving a day keeps them.
    const key = (p) => JSON.stringify(p.days.map((d) => JSON.stringify(d.items)).sort());
    if (JSON.stringify(draft.why || null) === JSON.stringify(plan.why || null) && key(draft) !== key(plan)) { delete draft.why; for (const d of draft.days) delete d.why; }
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
  // Every move someone could put in a plan, with whether they can do it at home and at the gym, what
  // it's done with (kit: every kind it can be done with; mine: the kinds of those this person has,
  // where they train), what it works (muscles), and the words it's found by (find). Kept for the day
  // and the state it was worked out for, so the picker opens without working it out again.
  let catalogKept = null;
  function catalog(S, day) {
    const stamp = catalogStamp(S, day);
    if (catalogKept && catalogKept.S === S && catalogKept.stamp === stamp) return catalogKept.list;
    const where = S.profile.where || 'home';
    const home = where !== 'gym' ? context(S, day, 'home') : null;
    const gym = where !== 'home' ? context(S, day, 'gym') : null;
    const have = (key) => (home && M().has(home.f.eq, key)) || (gym && M().has(gym.f.eq, key));
    const out = [];
    for (const [id, m] of Object.entries(M().MOVES)) {
      if (!m.name || !m.group) continue;
      const h = home ? check(home, id) : null, g = gym ? check(gym, id) : null;
      const k = known(m);
      const mine = k.kit[0] === 'body' ? ['body'] : k.kit.filter((x) => (m.req || []).some((alt) => alt.split('|').some((key) => KIT_OF[key] === x && have(key))));
      out.push({ id, name: m.name, group: m.group, timed: !!m.timed, ok: !!((h && h.ok) || (g && g.ok)), home: !!(h && h.ok), gym: !!(g && g.ok), why: whyText((h && !h.ok ? h : null) || g), kit: k.kit, mine, kitText: k.kitText, muscles: k.muscles, fam: m.family || null, find: k.find });
    }
    catalogKept = { S, stamp, list: out };
    return out;
  }
  // What the catalog reads from the state (the checks above: kit, joints, rules, levels, hidden moves).
  function catalogStamp(S, day) {
    const p = S.profile;
    return `${day}|${JSON.stringify([p.equipment, p.gym, p.where, p.careful, p.impactOk, p.gentle, p.age, p.conditions, p.oaJoints, p.floorOk, p.jumpsOk, p.fractures, p.retinopathy, p.experience, p.planTweaks, S.pain, S.excluded, S.complexity, S.place, S.lastPlace])}|${B().progStamp ? B().progStamp(S) : JSON.stringify(S.prog)}`;
  }

  /* ---------------------------------------------------------------- what a move is done with */
  // The picker's equipment filter, in the order it lists them: what moves are done with, from what
  // each one needs (req). A chair, a wall, a towel or a table is something anyone has: a move that
  // needs only those is body only. The filter shows the ones the catalog holds.
  const KIT = [['body', 'Body only'], ['db', 'Dumbbells'], ['kb', 'Kettlebell'], ['band', 'Bands'], ['bar', 'Bars'], ['ball', 'Ball'], ['barbell', 'Barbell'], ['cable', 'Cables'], ['machine', 'Gym machines'], ['cardio', 'Cardio machines']];
  const KIT_OF = { db: 'db', kb: 'kb', band: 'band', door: 'band', bar: 'bar', dip: 'bar', ball: 'ball', slam: 'ball', bb: 'barbell', ez: 'barbell', rack: 'barbell', cable: 'cable', smith: 'machine', pulldown: 'machine', legPress: 'machine', legCurl: 'machine', legExt: 'machine', chestPress: 'machine', shoulderPress: 'machine', pecDeck: 'machine', rower: 'cardio', bike: 'cardio', treadmill: 'cardio' };
  // The words a move's kit is found by ("db" and "kb" are how people write them).
  const KIT_WORDS = { body: 'bodyweight body weight no equipment', db: 'dumbbell db', kb: 'kettlebell kb', band: 'resistance band', bar: 'bar', ball: 'ball medicine', barbell: 'barbell', cable: 'cable', machine: 'machine', cardio: 'cardio machine' };
  // Muscles in words (the 17 the body map shows), and the words people use for groups.
  const MUSCLE_WORDS = { chest: 'chest', frontDelts: 'front delts', sideDelts: 'side delts', rearDelts: 'rear delts', upperBack: 'upper back', lats: 'lats', lowerBack: 'lower back', biceps: 'biceps', triceps: 'triceps', forearms: 'forearms', abs: 'abs', obliques: 'obliques', glutes: 'glutes', hipFlexors: 'hip flexors', quads: 'quads', hamstrings: 'hamstrings', calves: 'calves' };
  const GROUP_WORDS = { chest: 'chest pecs', back: 'back', shoulders: 'shoulders delts', legs: 'legs', biceps: 'biceps arms', triceps: 'triceps arms', abs: 'abs core', conditioning: 'cardio conditioning', mobility: 'stretching stretch mobility', impact: 'impact bones', balance: 'balance' };
  const ALSO = { glutes: 'bum butt', quads: 'thighs', abs: 'stomach' };
  const KIT_SHORT = { db: 'dumbbells', kb: 'kettlebell', band: 'band', door: 'door anchor', bar: 'pull-up bar', dip: 'dip bars', ball: 'ball', slam: 'slam ball', bb: 'barbell', ez: 'EZ bar', bench: 'bench', incline: 'adjustable bench', cable: 'cable', smith: 'Smith machine', pulldown: 'lat pulldown', legPress: 'leg press', legCurl: 'leg curl machine', legExt: 'leg extension machine', chestPress: 'chest press machine', shoulderPress: 'shoulder press machine', pecDeck: 'pec deck', rower: 'rower', bike: 'exercise bike', treadmill: 'treadmill' };
  const knownMoves = new Map();
  function known(m) {
    let k = knownMoves.get(m.id);
    if (k) return k;
    const kit = [];
    for (const alt of m.req || []) for (const key of alt.split('|')) { const x = KIT_OF[key]; if (x && !kit.includes(x)) kit.push(x); }
    if (!kit.length) kit.push('body');
    kit.sort((a, b) => KIT.findIndex(([x]) => x === a) - KIT.findIndex(([x]) => x === b));
    const muscles = uniq((m.muscles || []).map((x) => MUSCLE_WORDS[x]).filter(Boolean));
    const words = [m.name, GROUP_WORDS[m.group] || m.group, muscles.join(' '), (m.muscles || []).map((x) => ALSO[x] || '').join(' '),
      kit.map((x) => KIT_WORDS[x]).join(' '), (m.req || []).map((alt) => alt.split('|').map((key) => String(EQ_NAME[key] || '').replace(/^an? /, '')).join(' ')).join(' ')].join(' ');
    // What it's done with, in words ("dumbbells or kettlebell", "barbell, bench").
    const kitText = (m.req || []).map((alt) => uniq(alt.split('|').map((key) => KIT_SHORT[key]).filter(Boolean)).join(' or ')).filter(Boolean).join(', ') || 'no equipment';
    k = { kit, muscles, kitText, find: finding(m.name, words) };
    knownMoves.set(m.id, k);
    return k;
  }

  /* ---------------------------------------------------------------- search */
  // Forgiving: case, accents, spaces and hyphens don't matter ("pushup", "push up", "push-up"), a
  // plural finds the one ("lunges"), the British "press-up" finds push-ups, the words can come in any
  // order, and a word one letter off finds its move ("dumbell").
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');
  const SAME = [[/\bpress ?-?ups?\b/g, 'push-up'], [/\bsit ?-?ups?\b/g, 'situp'], [/\bchin ?-?ups?\b/g, 'chin-up'], [/\bpull ?-?ups?\b/g, 'pull-up'], [/\bdumb ?-?bells?\b/g, 'dumbbell'], [/\bkettle ?-?bells?\b/g, 'kettlebell']];
  const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  function finding(name, words) {
    const n = fold(name);
    return { name: n.replace(/[^a-z0-9]/g, ''), words: uniq(fold(words).split(/[^a-z0-9]+/).filter(Boolean)), first: n.split(/[^a-z0-9]+/).filter(Boolean) };
  }
  // At most one letter off (one added, missing, changed, or two swapped).
  function near(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  // A query into a scorer for catalog entries: 0 for no match, more for a better one (the name
  // starting with it, then the name holding it, then every word found, then words one letter off).
  // A short word only matches the start of a word ("db" isn't in "dea-db-ug", "row" isn't "throw").
  function matcher(q) {
    let s = fold(q);
    for (const [re, to] of SAME) s = s.replace(re, to);
    const words = s.split(/[^a-z0-9]+/).filter(Boolean).map(stem);
    if (!words.length) return null;
    const whole = words.join('');
    return (x) => {
      const f = x.find || finding(x.name, x.name);
      if (f.name.startsWith(whole)) return 100;
      if (whole.length >= 4 && f.name.includes(whole)) return 80 + (f.first.some((w) => w.startsWith(words[0])) ? 5 : 0);
      let score = 60, fuzzy = false;
      for (const w of words) {
        if ((w.length >= 4 && f.name.includes(w)) || f.first.some((x2) => x2.startsWith(w))) continue;
        if (f.words.some((x2) => x2.startsWith(w))) { score = Math.min(score, 40); continue; }
        if (w.length >= 4 && f.words.some((x2) => near(w, stem(x2)) || near(w, x2))) { fuzzy = true; continue; }
        return 0;
      }
      return fuzzy ? 20 : score;
    };
  }
  // The catalog entries a query finds, best first (the catalog's own order among equals).
  function search(list, q) {
    const score = matcher(q);
    if (!score) return list.slice();
    const out = [];
    list.forEach((x, i) => { const s = score(x); if (s) out.push({ x, s, i }); });
    return out.sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.x);
  }

  /* ---------------------------------------------------------------- a new exercise's numbers */
  // Sets and reps for a move someone adds, for them: sets from how much their goals want of its
  // muscles (the engine's tiers: a top goal gets more) and how long they've trained; reps from where
  // they are on its ladder (their own target on the level they're at, more on an easier level, fewer
  // on a harder one), within the range the engine gives them (a health condition can set it).
  function defaults(S, id, day) {
    const b = B(), m = M().MOVES[id];
    if (!m) return null;
    const p = S.profile;
    const prog = b.programFor(p);
    let sets;
    if (m.group === 'mobility' || m.group === 'balance' || m.group === 'impact') sets = 2;
    else if (m.group === 'conditioning') sets = 3;
    else {
      const tier = prog.tiers[m.group] || 3;
      sets = tier === 1 ? (prog.level >= 1 ? 4 : 3) : tier === 2 ? 3 : prog.level >= 1 ? 3 : 2;
      if (p.gentle) sets = Math.max(2, sets - 1);
    }
    const fam = m.family;
    const lad = fam && M().LADDERS[fam];
    const st = fam && S.prog ? S.prog[fam] : null;
    let base = m.start || (m.timed ? 30 : 10);
    if (st && st.rung === id && st.reps) base = st.reps;
    else if (st && lad && !lad.gym && lad.rungs.includes(st.rung) && lad.rungs.includes(id)) {
      const at = lad.rungs.indexOf(st.rung), i = lad.rungs.indexOf(id);
      const [lo, hi] = m.range || [base, base];
      if (i < at) base = Math.round(base + (hi - base) * 0.5); // easier than where they are
      else base = Math.max(lo, Math.round(base * 0.8)); // harder
    }
    let range = m.range || [1, 100];
    try { range = b.rangeFor(S, m, fam, day) || range; } catch (e) { /* the move's own */ }
    base = Math.max(range[0], Math.min(range[1], base));
    return m.timed
      ? { sets, secs: clampInt(base, LIMITS.secs[0], LIMITS.secs[1], 30) }
      : { sets, reps: clampInt(base, LIMITS.reps[0], LIMITS.reps[1], 10) };
  }
  // A move as an item of a plan, with this person's numbers.
  function itemFor(S, id, day) {
    const d = defaults(S, id, day);
    return d ? Object.assign({ move: id }, d) : null;
  }

  /* ---------------------------------------------------------------- the week by muscle */
  // The sets a week a plan gives each muscle group (every day runs once a week), against what this
  // person's goals call for: the engine's weekly sets for them (S.vol, which the coach's own plan
  // works toward as the time allows, kept within the floor and cap their goals set). status: 'none',
  // 'low' (under 70% of the aim), 'ok' or 'high' (past the cap).
  const WEEK_GROUPS = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'abs'];
  function weekSets(S, plan) {
    const prog = B().programFor(S.profile);
    const have = {};
    for (const d of (plan && plan.days) || []) for (const it of d.items) { const m = M().MOVES[it.move]; if (m) have[m.group] = (have[m.group] || 0) + it.sets; }
    return WEEK_GROUPS.map((g) => {
      const n = have[g] || 0;
      const aim = Math.max(1, Math.round(S.vol && S.vol[g] != null ? S.vol[g] : prog.start[g]));
      const cap = prog.cap[g] || aim * 2;
      const status = !n ? 'none' : n < Math.max(1, Math.round(aim * 0.7)) ? 'low' : n > cap ? 'high' : 'ok';
      return { group: g, sets: n, aim, floor: prog.floor[g], cap, tier: prog.tiers[g] || 3, status };
    });
  }

  /* ---------------------------------------------------------------- suggestions */
  // The moves most like one (for Replace): the same muscle group, this person can do them today,
  // nearest first (the same ladder's next levels, then the same muscles, done the same way).
  function similar(S, id, day, n) {
    const m0 = M().MOVES[id];
    if (!m0) return [];
    const ctx = context(S, day);
    const out = [];
    for (const [cid, m] of Object.entries(M().MOVES)) {
      if (cid === id || !m.name || m.name === m0.name || m.group !== m0.group || !check(ctx, cid).ok) continue;
      out.push({ id: cid, group: m.group, why: 'like', s: likeness(S, m0, m) });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, n || 6).map(({ id: x, group, why }) => ({ id: x, group, why }));
  }

  // Moves to add to a day (items: what it holds now): for the muscles it trains, another of their
  // exercises (a ladder it doesn't use yet), and for the muscles the plan's week leaves out or gives
  // little, their main one; each at the level this person is at, one they can do today, not one the
  // day has. [{ id, group, why: 'day' | 'none' | 'low' }], at most n.
  function suggest(S, plan, di, day, items, n) {
    const b = B();
    const ctx = context(S, day);
    const list = items || ((plan && plan.days[di]) || { items: [] }).items;
    const inDay = new Set(list.map((it) => it.move));
    // (A move of another ladder under the same name, a glute bridge in the hinge ladder and the glute
    // one, is the same exercise.)
    const named = new Set(list.map((it) => (M().MOVES[it.move] || {}).name));
    const famsIn = new Set(list.map((it) => (M().MOVES[it.move] || {}).family).filter(Boolean));
    const draft = { days: ((plan && plan.days) || []).map((d, i) => (i === di ? { items: list } : d)) };
    if (!draft.days[di]) draft.days[di] = { items: list };
    const week = weekSets(S, draft);
    const dayGroups = uniq(list.map((it) => (M().MOVES[it.move] || {}).group).filter((g) => WEEK_GROUPS.includes(g)));
    const gaps = week.filter((w) => w.status === 'none' || w.status === 'low').sort((x, y) => (x.status === y.status ? 0 : x.status === 'none' ? -1 : 1) || x.tier - y.tier || (x.sets / x.aim) - (y.sets / y.aim));
    // A copy of the levels, so a ladder this person hasn't started gets the rung they'd start on.
    const S2 = Object.assign({}, S, { prog: Object.assign({}, S.prog) });
    const atGym = b.placeOf(S, day) === 'gym';
    const pick = (g, used) => {
      const fams = Object.entries(M().LADDERS).filter(([f, lad]) => lad.group === g && !lad.alt && !!lad.gym === atGym && !famsIn.has(f) && !used.has(f))
        .sort((x, y) => (x[1].accessory ? 1 : 0) - (y[1].accessory ? 1 : 0));
      for (const [f] of fams) {
        let st = null;
        try { st = b.ensureProg(S2, f, day); } catch (e) { st = null; }
        const avail = b.rungs(S, f, day);
        const id = st && avail.includes(st.rung) ? st.rung : avail[0];
        if (id && !inDay.has(id) && !named.has((M().MOVES[id] || {}).name) && check(ctx, id).ok) { used.add(f); return id; }
      }
      return null;
    };
    const max = n || 6;
    const out = [];
    const used = new Set();
    const add = (g, why) => { const id = pick(g, used); if (id && !out.some((x) => x.id === id)) out.push({ id, group: g, why }); };
    // This day's muscles and the week's gaps take turns, then a second move for each gap.
    const dayQ = dayGroups.slice(), gapQ = gaps.slice();
    while (out.length < max && (dayQ.length || gapQ.length)) {
      if (dayQ.length) add(dayQ.shift(), 'day');
      if (gapQ.length && out.length < max) { const w = gapQ.shift(); add(w.group, w.status); }
    }
    for (const w of gaps) if (out.length < max) add(w.group, w.status);
    return out.slice(0, max);
  }

  /* ================================================================== a day's session */
  function autoRest(S, fam) {
    const pr = S.profile.prefs && S.profile.prefs.rest;
    if (pr === 60 || pr === 90 || pr === '60' || pr === '90') return Number(pr);
    return COMPOUND.includes(fam) ? 90 : 60;
  }
  // The rest a plan's move gets on Auto (its session's, as above).
  const restAuto = (S, id) => autoRest(S, (M().MOVES[id] || {}).family);
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
    const T = b.templateOf ? b.templateOf(S, b.weekStart(day), set) : b.templateFor(Object.assign({}, S.profile, { days: set.days, weekdays: set.weekdays }), b.programFor(Object.assign({}, S.profile, { days: set.days })));
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
    // 1.15: the weaker side's catch-up set, as the coach's plan has it (brain.js realize), from the
    // weeks on 1.15's rules (brain.personal, so the sessions of a plan used before then stay as they
    // were): one lead-side curl set beside the day's own biceps work, on the plan's first two days
    // that hold some (two days a week at most), and one lead-side squat set on a day with a squat.
    // None on a short night.
    const extras = [];
    if (plan && pd && !o.short && b.personal(S, day)) {
      const biceps = plan.days.map((d, i) => (d.items.some((x) => (M().MOVES[x.move] || {}).group === 'biceps') ? i : -1)).filter((i) => i >= 0).slice(0, 2);
      if (S.catchup.arm.active && biceps.includes(ref.idx) && items.some((it) => it.group === 'biceps')) { const x = b.extraItem(S, 'curl', 'arm', day); if (x) extras.push(x); }
      if (S.catchup.leg.active && items.some((it) => it.fam === 'squat')) { const x = b.extraItem(S, 'squat', 'leg', day); if (x) extras.push(x); }
    }
    const s = {
      day, tpl, units: pd ? unitsOf(pd.items) : [], title: plan ? titleOf(plan, ref.idx) : 'Workout', short: !!o.short,
      phase: week.phase, readiness: ready0, warmup: warmup(S, day, !!o.short), tests: [], items, extras, finisher: null,
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
    // The reps-left answer against the set's aim, as for the coach's plan (brain.effortStep): pace 0
    // holds, 1 is the usual step, 2 and 3 bigger ones; harder: 3 or more left.
    const go = b.effortStep(log);
    if (allHit && go.pace) {
      st.short = 0;
      if (st.reps >= top) {
        const label = gym || go.harder ? heavier() : null;
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
        const step = go.pace === 1 ? (m.timed ? 5 : st.reps < 12 ? 1 : 2) : (m.timed ? 5 : 1) * go.pace;
        const next = Math.min(top, st.reps + step);
        if (next > st.reps) {
          st.reps = next;
          out.line = { text: `${m.name} → ${next}${u}`, why: b.effortWords(log) };
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
    const ws = b.weekStart(day);
    // The coach's week as the engine builds it (the same split Plan shows).
    const tpl = b.templateOf ? b.templateOf(S, ws, set) : b.templateFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays }), b.programFor(Object.assign({}, p, { days: set.days })));
    const days = tpl.map((t) => {
      const s = b.buildSession(S, ws + t.offset, t.idx, { cal: { weeks: {} }, noReadiness: true, forceMult: 1 });
      // Named for what it holds (the fit to the time can leave out a muscle the template named).
      return { title: niceTitle(s.groups || []) || titleFrom(s.items), items: itemsOf(s) };
    });
    const wd = Array.isArray(set.weekdays) && set.weekdays.length === set.days ? set.weekdays : null;
    return normalize({ name: 'My plan', days, weekdays: wd, source: 'you' }).plan;
  }
  function itemsOf(s) {
    // (With the coach's short rest for an arm exercise done one arm at a time, 1.15: each arm rests
    // through the other's set, brain.js itemFor. Other rests are the plan's own, autoRest.)
    const one = (it) => it.uni && (it.group === 'biceps' || it.group === 'triceps') && it.rest < 60 ? { rest: it.rest } : null;
    const out = s.items.map((it) => Object.assign(it.timed ? { move: it.moveId, sets: it.sets, secs: it.target } : { move: it.moveId, sets: it.sets, reps: it.target }, one(it)));
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
  function codeError(code, words) {
    const text = words || {
      broken: 'That code doesn\'t hold a plan.',
      typo: 'That code has a typo. Check it and try again.',
      newer: 'It was shared from a newer version of the app.',
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
  // The plan's data out of anything someone might scan, open or type: the share link, the app's own
  // link, an Android intent link, the bare data, or a plan code (GH1A-2B3C-…, also as …plan?c=<code>).
  // Plan codes are read by src/plancode.js, a part that loads with the plan builder: once it's in, a
  // code is found wherever it is in the text; before that, only in the app's own link. A link's
  // data never starts with GH (its first byte is the version), which is how the two are told apart.
  const LINK = /^(https?|gradienthealth|intent):/i;
  const BARE = /^[A-Za-z0-9_-]{12,}$/;
  function dataFrom(text) {
    const s = String(text || '').trim();
    let m = /^https?:\/\/[^\s#]*\/p\/?(?:index\.html)?#(?:d=)?([A-Za-z0-9_-]+)\s*$/i.exec(s);
    if (m) return m[1];
    m = /^(?:gradienthealth|intent):\/\/plan\/?\?(?:[^#]*&)?(?:d=([A-Za-z0-9_-]+)|c=(GH[A-Za-z0-9-]+))/i.exec(s);
    if (m) return m[1] || m[2];
    const code = !LINK.test(s) && GH.planCode && GH.planCode.find(s);
    if (code) return code;
    return BARE.test(s) ? s : null;
  }
  const isLink = (text) => !!dataFrom(text) && LINK.test(String(text || '').trim());
  // Back to a plan (not saved yet), from a link or a plan code: { plan, report } or an Error with
  // .code (broken, typo, newer, unsupported).
  async function decode(text) {
    const s = String(text || '').trim();
    const url = LINK.test(s);
    const data = dataFrom(s);
    if (url && !/^GH/i.test(data || '')) return fromData(data);
    // A plan code: the one in the app's link, or anything that isn't a link.
    if (!GH.planCode && GH.lazy) await GH.lazy('planUi').catch(() => {});
    if (!GH.planCode) throw codeError('broken');
    try { return GH.planCode.fromCode(url ? data : s); } catch (e) {
      // A link's data on its own is still read as that. When it isn't that either, what's wrong
      // with it as a code is the thing to say, unless it starts as a link's data does.
      if (url || !BARE.test(s) || /^GH/i.test(s)) throw e;
      return fromData(s).catch((e2) => { throw /^[Ag]/.test(s) ? e2 : e; });
    }
  }
  // A link's data (a version byte, then the packed plan) back to a plan.
  async function fromData(data) {
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

  GH.customPlan = {
    VERSION, LIMITS, SHARE_URL, PATTERNS,
    normalize, problems, ready, dayName, titleOf, titleFrom, groupsOf, unitsOf, amountText, countItems, summary, fingerprint,
    ensure, migrate, list, get, activeId, create, add, update, duplicate, remove, restore, save,
    use, inForce, eventAt: (S, day) => eventAt(planEvents(S), day), startDay, weekSessions, owns, parseTpl, buildSession, minutes, progress, nextHarder,
    context, check, choose, whyText, swapsFor, catalog, offsetsFor,
    KIT, known, search, matcher, defaults, itemFor, weekSets, suggest, similar, restAuto, WEEK_GROUPS,
    fromCoach, encode, decode, dataFrom, isLink, link, appLink, sharedTitle, codeError,
    // (Build me a plan, the ready-made plans and Improve add themselves: src/planbuild.js.)
    itemsOf, niceTitle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
