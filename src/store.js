/* Persistence. The state lives in localStorage ("gh.v1") and, inside the app, in an atomic file
 * through the Android bridge; on load the copy with the newer updatedAt wins. Backups are the
 * state as JSON. The AI coach key is not part of the state: it sits in the bridge's private
 * preferences, encrypted with an Android Keystore key (or in its own localStorage entry in a plain
 * browser), and never reaches a backup.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const KEY = 'gh.v1';
  const SECRET_PREFIX = 'gh.secret.';
  const SCHEMA = 1;
  const bridge = () => G.AndroidBridge || null;

  function lsGet(k) { try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (!G.localStorage) return false; G.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { if (G.localStorage) G.localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  function parse(txt) {
    if (!txt || typeof txt !== 'string') return null;
    try { const o = JSON.parse(txt); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
  }

  // A state has to look like one before it replaces anything.
  function valid(S) {
    return !!(isObj(S) && isObj(S.profile) && Array.isArray(S.events) && Array.isArray(S.log) && isObj(S.prog));
  }

  /* ---------------------------------------------------------------- restore validation */
  // A backup is text someone pasted, so it can hold anything, and what it holds becomes the app's
  // state. Before it replaces anything: 20 MB at most; keys that would reach an object's prototype
  // ("__proto__", "constructor", "toString" and the rest) dropped as it's parsed; every field the
  // engine and screens read checked for its type and range; long lists and strings cut; moves and
  // ladders this version doesn't know left out; anything else kept only if it's plain JSON of a sane
  // size. A crafted backup then can't crash the app, hang it or change how its objects behave.
  const MAX_TEXT = 20 * 1024 * 1024;
  const BAD_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).concat('prototype'));
  const reviver = (k, v) => (BAD_KEYS.has(k) ? undefined : v);
  const CAP = { depth: 32, keys: 20000, items: 100000, str: 20000, extraKeys: 64, extraChars: 2 * 1024 * 1024 };
  // Longer lists keep their newest entries (the end; activities are newest first).
  const LISTS = { log: 10000, events: 50000, weights: 20000, measurements: 20000, activities: 500, customPlans: 200, pendingLines: 200, volWeeksDone: 5000, excluded: 1000 };
  // The top-level fields the app knows, by type ('?': or null). A field of the wrong type goes, and
  // migrate() puts back its default.
  const TOP = {
    v: 'number', createdAt: 'number', updatedAt: 'number', complexity: 'number', noStreak: 'number', hardStreak: 'number',
    profile: 'object', vol: 'object', prog: 'object', pain: 'object', catchup: 'object', protein: 'object', health: 'object', feel: 'object',
    sleepChip: 'object', celebrated: 'object', insightsDismissed: 'object', insightsShown: 'object', ai: 'object', seen: 'object', place: 'object',
    planProg: 'object', food: 'object', coachDismissed: 'object',
    events: 'array', log: 'array', weights: 'array', measurements: 'array', pendingLines: 'array', volWeeksDone: 'array', excluded: 'array',
    activities: 'array', customPlans: 'array',
    active: 'object?', actLive: 'object?', activePlan: 'string?', lastPlace: 'string?',
  };
  const DAY_MS = 86400000;
  const MIN_DAY = 18262; // 2020-01-01: no plan starts before the app existed
  const PLAN_ID = /^[a-z0-9]{3,24}$/;
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isDay = (x) => Number.isInteger(x) && Math.abs(x) < 1e6;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const tail = (a, n) => (a.length > n ? a.slice(a.length - n) : a);
  // The entries that pass ok (the same array when they all do, as they do in the app's own state,
  // so loading copies nothing), the newest n of them; [] for something that isn't a list.
  const listOf = (v, ok, n) => (Array.isArray(v) ? tail(v.every(ok) ? v : v.filter(ok), n || Infinity) : []);
  const objects = (a, n) => listOf(a, isObj, n);
  const typeOk = (v, t) => (t.endsWith('?') && v === null) || (t.startsWith('array') ? Array.isArray(v) : t.startsWith('object') ? isObj(v) : typeof v === t.replace('?', ''));

  // Plain JSON within the caps: strings cut, deep or huge branches dropped, prototype keys gone.
  // undefined for anything that isn't JSON at all.
  function plain(v, depth) {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > CAP.str ? v.slice(0, CAP.str) : v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'object' || depth > CAP.depth) return undefined;
    if (Array.isArray(v)) {
      const out = new Array(Math.min(v.length, CAP.items));
      for (let i = 0; i < out.length; i++) { const x = plain(v[i], depth + 1); out[i] = x === undefined ? null : x; }
      return out;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const out = {};
    const keys = Object.keys(v);
    for (let i = 0, n = 0; i < keys.length && n < CAP.keys; i++) {
      const k = keys[i];
      if (BAD_KEYS.has(k)) continue;
      const x = plain(v[k], depth + 1);
      if (x !== undefined) { out[k] = x; n++; }
    }
    return out;
  }

  // The profile: the ranges set-up and Settings allow (days 2-6, minutes 10-60, age 13-100 and so
  // on), lists of known words, booleans as booleans. A field that's the wrong type goes, and
  // migrate() fills in its default.
  function cleanProfile(p, today) {
    const B = GH.brain;
    const bool = (o, k) => { if (own(o, k) && typeof o[k] !== 'boolean') delete o[k]; };
    const text = (o, k, max) => { if (own(o, k) && o[k] !== null) { if (typeof o[k] === 'string') o[k] = o[k].slice(0, max); else delete o[k]; } };
    const pick = (o, k, list) => { if (own(o, k) && !list.includes(o[k])) delete o[k]; };
    const range = (o, k, lo, hi, int) => { if (own(o, k)) { if (isNum(o[k])) o[k] = clamp(int ? Math.round(o[k]) : o[k], lo, hi); else delete o[k]; } };
    const orNull = (o, k, lo, hi, int) => { if (own(o, k)) o[k] = isNum(o[k]) && o[k] > 0 ? clamp(int ? Math.round(o[k]) : o[k], lo, hi) : null; };
    const words = (o, k, max, allowed) => {
      if (!own(o, k)) return;
      if (!Array.isArray(o[k])) { delete o[k]; return; }
      o[k] = [...new Set(o[k].filter((x) => typeof x === 'string' && x.length <= 40 && (!allowed || allowed.includes(x))))].slice(0, max);
    };
    ['onboarded', 'keptRoutine', 'lightDays', 'workouts', 'impactOk', 'gentle', 'sleepIrregular'].forEach((k) => bool(p, k));
    pick(p, 'units', ['lb', 'kg']);
    pick(p, 'where', ['home', 'gym', 'both']);
    range(p, 'days', 2, 6, true);
    range(p, 'minutes', 10, 60, true);
    orNull(p, 'age', 13, 100, true);
    orNull(p, 'heightCm', 90, 275);
    orNull(p, 'weightKg', 20, 400);
    if (own(p, 'startDay') && p.startDay !== null) p.startDay = isNum(p.startDay) ? clamp(Math.round(p.startDay), MIN_DAY, today + 366) : null;
    if (own(p, 'weekdays')) p.weekdays = weekdaysOf(p.weekdays);
    ['sex', 'experience', 'weightGoal', 'sleepTypical'].forEach((k) => text(p, k, 20));
    text(p, 'recentActivity', 30);
    text(p, 'name', 60);
    words(p, 'goals', 12);
    words(p, 'careful', 8, B && B.JOINTS);
    if (own(p, 'conditions')) p.conditions = Array.isArray(p.conditions) ? p.conditions.filter((c) => (typeof c === 'string' && c.length <= 80) || isObj(c)).slice(0, 30) : [];
    if (own(p, 'lead')) {
      const l = isObj(p.lead) ? p.lead : {};
      p.lead = { arm: l.arm === 'L' || l.arm === 'R' ? l.arm : null, leg: l.leg === 'L' || l.leg === 'R' ? l.leg : null };
    }
    for (const k of ['equipment', 'gym', 'protein', 'prefs', 'food']) if (own(p, k) && !isObj(p[k])) delete p[k];
    const eq = p.equipment;
    if (eq) {
      for (const k of ['db', 'kb']) if (own(eq, k)) eq[k] = Array.isArray(eq[k]) ? [...new Set(eq[k].filter((x) => isNum(x) && x > 0 && x <= 500))].slice(0, 40) : [];
      for (const k of ['ball', 'ballSlam', 'band', 'bar', 'chair', 'wall', 'towel', 'table', 'door']) bool(eq, k);
      orNull(eq, 'ballLb', 1, 100);
    }
    if (p.gym) {
      if (B && B.defaultGym) for (const k of Object.keys(B.defaultGym())) if (k !== 'dbMax') bool(p.gym, k);
      range(p.gym, 'dbMax', 0, 500);
    }
    if (p.protein) { bool(p.protein, 'track'); range(p.protein, 'perLb', 0.1, 3); text(p.protein, 'quickName', 40); range(p.protein, 'quickG', 1, 200, true); }
    const pr = p.prefs;
    if (pr) {
      ['supersets', 'sound', 'vibrate', 'haptics'].forEach((k) => bool(pr, k));
      if (own(pr, 'rest') && !(typeof pr.rest === 'string' && pr.rest.length <= 10) && !isNum(pr.rest)) delete pr.rest;
      text(pr, 'theme', 20);
      range(pr, 'density', 0, 1);
      range(pr, 'rollHour', 0, 23, true);
    }
  }

  // A workout in progress, as the player needs it to carry on. One that doesn't hold together (or
  // names a move this version doesn't have) can't be resumed, so it goes.
  function activeOk(A, MOVES) {
    if (!isObj(A) || !isDay(A.day) || !isObj(A.session) || !Array.isArray(A.steps) || !Array.isArray(A.session.items)) return false;
    if (!Number.isInteger(A.idx) || A.idx < 0 || A.idx > A.steps.length || (A.logs != null && !Array.isArray(A.logs))) return false;
    if (!A.steps.every((st) => isObj(st) && typeof st.kind === 'string' && (st.item == null || isObj(st.item)))) return false;
    const s = A.session;
    if (['extras', 'warmup', 'tests', 'mobility'].some((k) => s[k] != null && !Array.isArray(s[k])) || (s.finisher != null && !isObj(s.finisher))) return false;
    const items = [].concat(s.items, s.extras || [], s.warmup || [], s.tests || [], s.mobility || [], s.finisher ? [s.finisher] : []);
    return items.every((it) => isObj(it) && (it.moveId == null || (typeof it.moveId === 'string' && (!MOVES || own(MOVES, it.moveId)))));
  }

  // Weekdays a schedule is pinned to: 2-6 different days, Monday (0) to Sunday (6); else none. (A list
  // that doesn't match the number of days is the engine's to ignore, as it always has.)
  const weekdaysOf = (w) => (Array.isArray(w) && w.length >= 2 && w.length <= 6 && w.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && new Set(w).size === w.length ? w : null);

  // Events the engine replays: settings (schedule changes), plan switches, moved and lighter days.
  // Ones of these kinds that don't hold together go; other kinds stay as they are.
  function eventOk(e) {
    if (!isObj(e) || typeof e.type !== 'string' || e.type.length > 40) return false;
    switch (e.type) {
      case 'settings':
        if (!isDay(e.day)) return false;
        if (own(e, 'days')) { if (!isNum(e.days)) return false; e.days = clamp(Math.round(e.days), 2, 6); }
        if (own(e, 'minutes')) { if (!isNum(e.minutes)) return false; e.minutes = clamp(Math.round(e.minutes), 10, 60); }
        if (own(e, 'weekdays')) e.weekdays = weekdaysOf(e.weekdays);
        return true;
      case 'plan':
        if (!isDay(e.day) || (e.id != null && !(typeof e.id === 'string' && PLAN_ID.test(e.id) && !BAD_KEYS.has(e.id)))) return false;
        if (e.id == null) return true;
        if (!Number.isInteger(e.n) || e.n < 1 || e.n > 6) return false;
        return e.wd == null || (Array.isArray(e.wd) && e.wd.length === e.n && e.wd.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && new Set(e.wd).size === e.n);
      case 'move': return isDay(e.from) && isDay(e.to) && isDay(e.at);
      case 'deloadNext': return isDay(e.day);
      default: return true;
    }
  }

  // The state as the app can run it (see above), or null if it isn't one. opts.deep (the default,
  // for a backup) first rebuilds the whole thing as plain JSON within the caps; loading the app's
  // own copy skips that and checks only what the engine and screens read, which is quick.
  function sanitize(input, opts) {
    const deep = !(opts && opts.deep === false);
    const S = deep ? plain(input, 0) : input;
    if (!isObj(S)) return null;
    const MV = GH.moves && GH.moves.MOVES ? GH.moves : null;
    const B = GH.brain;
    const today = Math.floor(Date.now() / DAY_MS);
    // Top level: the known fields by type; anything else only as small plain JSON (a newer
    // version's field, say), and only so many of them.
    let extra = 0;
    for (const k of Object.keys(S)) {
      if (BAD_KEYS.has(k)) { delete S[k]; continue; }
      if (own(TOP, k)) { if (!typeOk(S[k], TOP[k])) delete S[k]; continue; }
      if (deep && (++extra > CAP.extraKeys || S[k] === undefined || JSON.stringify(S[k]).length > CAP.extraChars)) delete S[k];
    }
    for (const k of ['v', 'createdAt', 'updatedAt']) if (own(S, k) && !isNum(S[k])) delete S[k];
    if (own(S, 'complexity')) S.complexity = clamp(Math.round(S.complexity) || 0, 0, 2);
    for (const k of ['noStreak', 'hardStreak']) if (own(S, k)) S[k] = clamp(Math.round(S[k]) || 0, 0, 10000);
    if (S.profile) cleanProfile(S.profile, today);

    // Lists of records: only objects (a null in one of them crashed whatever went through it).
    for (const k of ['measurements', 'pendingLines']) if (S[k]) S[k] = objects(S[k], LISTS[k]);
    if (S.weights) S.weights = listOf(S.weights, (w) => isObj(w) && isDay(w.day) && isNum(w.kg) && w.kg > 0 && w.kg < 1000, LISTS.weights);
    if (S.log) {
      S.log = listOf(S.log, (l) => isObj(l) && typeof l.type === 'string' && (l.day == null || isDay(l.day)) && ((l.type !== 'workout' && l.type !== 'light') || isDay(l.day)), LISTS.log);
      for (const l of S.log) {
        if (l.type !== 'workout') continue;
        l.items = objects(l.items);
        for (const it of l.items) if (own(it, 'sets')) it.sets = objects(it.sets);
        if (own(l, 'lines')) l.lines = objects(l.lines);
        if (own(l, 'checkin') && !isObj(l.checkin)) delete l.checkin;
        for (const k of ['pct', 'planned', 'doneSets']) if (own(l, k) && !isNum(l[k])) l[k] = 0;
      }
    }
    if (S.volWeeksDone) S.volWeeksDone = listOf(S.volWeeksDone, isDay, LISTS.volWeeksDone);
    if (S.activities) {
      const acts = listOf(S.activities, (a) => isObj(a) && typeof a.id === 'string' && isNum(a.start));
      const sorted = acts.every((a, i) => i === 0 || acts[i - 1].start >= a.start);
      S.activities = sorted && acts.length <= LISTS.activities ? acts : acts.slice().sort((a, b) => b.start - a.start).slice(0, LISTS.activities);
    }

    // Custom plans (customPlan.migrate checks each one when it runs): no plan may be called after a
    // prototype key, which a lookup by id would find in any object.
    if (S.customPlans) S.customPlans = listOf(S.customPlans, (p) => isObj(p) && !(typeof p.id === 'string' && BAD_KEYS.has(p.id)), LISTS.customPlans);
    const plans = new Set((S.customPlans || []).map((p) => p.id).filter((id) => typeof id === 'string'));
    if (own(S, 'activePlan') && S.activePlan !== null && !plans.has(S.activePlan)) S.activePlan = null;
    if (S.events) S.events = listOf(S.events, eventOk, LISTS.events);
    if (S.planProg) {
      for (const id of Object.keys(S.planProg)) {
        const book = S.planProg[id];
        if (!isObj(book) || BAD_KEYS.has(id)) { delete S.planProg[id]; continue; }
        for (const key of Object.keys(book)) if (!isObj(book[key]) || (MV && !own(MV.MOVES, key.split(':')[0]))) delete book[key];
      }
    }

    // Moves and ladders this version knows. A ladder that isn't one goes (a plan that uses a ladder
    // starts it from the person's level, brain.ensureProg); a level on a move that isn't one of its
    // ladder's rungs goes back to the first rung, as the engine does, keeping the bests.
    if (S.excluded) S.excluded = [...new Set(S.excluded.filter((id) => typeof id === 'string' && (!MV || own(MV.MOVES, id))))].slice(0, LISTS.excluded);
    if (S.prog && MV) {
      for (const fam of Object.keys(S.prog)) {
        const st = S.prog[fam];
        const lad = own(MV.LADDERS, fam) ? MV.LADDERS[fam] : null;
        const first = lad && (lad.rungs || []).find((id) => own(MV.MOVES, id));
        if (!first || !isObj(st)) { delete S.prog[fam]; continue; }
        if (!(typeof st.rung === 'string' && own(MV.MOVES, st.rung) && lad.rungs.includes(st.rung))) { st.rung = first; st.reps = MV.MOVES[first].start; }
        if (!isNum(st.reps)) st.reps = MV.MOVES[st.rung].start;
        for (const k of ['best', 'loads', 'e1rm']) if (own(st, k) && !isObj(st[k])) st[k] = {};
      }
    }
    if (S.vol && B) for (const g of Object.keys(S.vol)) { if (!B.GROUPS.includes(g) || !isNum(S.vol[g])) delete S.vol[g]; else S.vol[g] = clamp(S.vol[g], 0, 100); }
    if (S.pain) for (const j of Object.keys(S.pain)) if ((B && !B.JOINTS.includes(j)) || !isDay(S.pain[j])) delete S.pain[j];
    if (S.catchup) {
      const side = (c) => isObj(c) && (c.side === 'L' || c.side === 'R') && typeof c.active === 'boolean' && Array.isArray(c.tests);
      if (!side(S.catchup.arm) || !side(S.catchup.leg)) delete S.catchup; // migrate() starts it again
      else for (const k of ['arm', 'leg']) S.catchup[k].tests = objects(S.catchup[k].tests);
    }
    if (own(S, 'active') && S.active !== null && !activeOk(S.active, MV && MV.MOVES)) S.active = null;

    // Health, food, protein, the AI's chats: per day or per entry, the shapes the screens read.
    const h = S.health;
    if (h) {
      for (const k of ['days', 'hc', 'manual', 'written']) if (own(h, k) && !isObj(h[k])) delete h[k];
      if (h.days) {
        for (const d of Object.keys(h.days)) {
          const rec = h.days[d];
          if (!isObj(rec)) { delete h.days[d]; continue; }
          if (own(rec, 'exercise')) rec.exercise = objects(rec.exercise);
        }
      }
      if (own(h, 'lastSync') && h.lastSync !== null && !isNum(h.lastSync)) h.lastSync = null;
      if (own(h, 'status') && h.status !== null && typeof h.status !== 'string') h.status = null;
    }
    if (S.protein) for (const d of Object.keys(S.protein)) { if (Array.isArray(S.protein[d])) S.protein[d] = listOf(S.protein[d], isNum, 200); else delete S.protein[d]; }
    const f = S.food;
    if (f) {
      if (own(f, 'days')) {
        if (!isObj(f.days)) delete f.days;
        else for (const d of Object.keys(f.days)) { if (Array.isArray(f.days[d])) f.days[d] = objects(f.days[d], 500); else delete f.days[d]; }
      }
      for (const k of ['custom', 'saved', 'recent', 'favs']) if (own(f, k)) { if (Array.isArray(f[k])) f[k] = f[k].slice(0, 5000); else delete f[k]; }
      if (own(f, 'other') && !isObj(f.other)) delete f.other;
    }
    const ai = S.ai;
    if (ai) {
      for (const k of ['reports', 'chat', 'deviceChat']) if (own(ai, k)) ai[k] = objects(ai[k], 1000);
      if (own(ai, 'enabled') && typeof ai.enabled !== 'boolean') ai.enabled = false;
      if (own(ai, 'mode') && ai.mode !== 'api' && ai.mode !== 'device') delete ai.mode;
    }
    if (S.place) for (const d of Object.keys(S.place)) if (S.place[d] !== 'home' && S.place[d] !== 'gym') delete S.place[d];
    if (own(S, 'lastPlace') && S.lastPlace !== null && S.lastPlace !== 'home' && S.lastPlace !== 'gym') S.lastPlace = null;
    return S;
  }

  // Older or partial states get every field the app expects.
  function migrate(S) {
    // The quick checks first (sanitize above), so a state saved before them, or bent by a bug, can't
    // crash what follows.
    sanitize(S, { deep: false });
    const d = (k, v) => { if (S[k] == null) S[k] = v; };
    d('v', SCHEMA); d('vol', {}); d('complexity', 0); d('noStreak', 0); d('hardStreak', 0); d('pain', {}); d('excluded', []);
    d('weights', []); d('protein', {}); d('feel', {}); d('sleepChip', {}); d('measurements', []); d('active', null);
    d('celebrated', {}); d('pendingLines', []); d('insightsDismissed', {}); d('insightsShown', {}); d('volWeeksDone', []);
    d('health', {}); d('ai', {}); d('seen', {});
    // 1.4: outdoor activities (src/activity.js), newest first, and the one being recorded.
    d('activities', []); d('actLive', null);
    const h = S.health;
    if (!h.days) h.days = {};
    if (!h.hc) h.hc = {};
    if (!h.manual) h.manual = {};
    if (h.lastSync === undefined) h.lastSync = null;
    if (h.status === undefined) h.status = null;
    if (!h.written) h.written = {};
    const ai = S.ai;
    if (ai.enabled == null) ai.enabled = false;
    // 1.2 round 3: the chat is the on-device model or Claude. The built-in coach's chat ('local') is
    // gone (it still writes the weekly report and grounds the on-device answers), and so is its log.
    if (ai.mode !== 'api' && ai.mode !== 'device') ai.mode = ai.enabled ? 'api' : 'device';
    delete S.coachChat;
    if (!Array.isArray(ai.reports)) ai.reports = [];
    if (!Array.isArray(ai.chat)) ai.chat = [];
    if (!Array.isArray(ai.deviceChat)) ai.deviceChat = [];
    stripSecrets(S);
    if (!S.catchup) S.catchup = { arm: { side: 'L', active: false, tests: [] }, leg: { side: 'L', active: false, tests: [] } };
    if (S.profile && GH.brain) {
      const def = GH.brain.defaultProfile();
      for (const k of Object.keys(def)) if (S.profile[k] === undefined) S.profile[k] = def[k];
      S.profile.equipment = Object.assign(def.equipment, S.profile.equipment || {});
      S.profile.prefs = Object.assign(def.prefs, S.profile.prefs || {});
      S.profile.protein = Object.assign(def.protein, S.profile.protein || {});
      S.profile.lead = Object.assign({ arm: null, leg: null }, S.profile.lead || {});
      // Every muscle group has a weekly volume: one a backup lost starts again where a new plan
      // would (without it, that group's sets came out as NaN).
      const start = GH.brain.programFor(S.profile).start;
      for (const g of GH.brain.GROUPS) if (typeof S.vol[g] !== 'number' && start[g] != null) S.vol[g] = start[g];
    }
    // 1.2: food tracking. Its mode starts from the 1.1 protein switch, and the food log is empty.
    if (S.profile && GH.food) {
      const had = S.profile.food && S.profile.food.mode;
      GH.food.prefs(S);
      if (!had) S.profile.food.mode = S.profile.protein && S.profile.protein.track === false ? 'off' : 'protein';
      GH.food.data(S);
    }
    // Custom plans (src/customplan.js): the list, the plan in use and progress on its exercises.
    if (GH.customPlan) GH.customPlan.migrate(S);
    if (GH.brain && GH.brain.relink) GH.brain.relink(S);
    // Later modules add their own steps here (GH.migrations.push(fn)), each safe to run every load.
    for (const fn of GH.migrations || []) fn(S);
    S.v = SCHEMA;
    return S;
  }

  // Belt and braces: nothing that looks like a key is ever stored with the state.
  function stripSecrets(S) {
    if (S && S.ai) for (const k of Object.keys(S.ai)) if (/key|token|secret/i.test(k)) delete S.ai[k];
    return S;
  }

  function load() {
    const local = parse(lsGet(KEY));
    let file = null;
    try { const b = bridge(); if (b && b.load) file = parse(b.load()); } catch (e) { file = null; }
    const a = valid(local) ? local : null;
    const b = valid(file) ? file : null;
    const pick = !a ? b : !b ? a : (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
    return pick ? migrate(pick) : null;
  }

  let pending = null;
  let lastSaved = null;
  function save(S) {
    if (pending) { clearTimeout(pending); pending = null; }
    if (!S) return false;
    S.updatedAt = Date.now();
    stripSecrets(S);
    let txt;
    try { txt = JSON.stringify(S); } catch (e) { return false; }
    const ok1 = lsSet(KEY, txt);
    let ok2 = false;
    try { const b = bridge(); if (b && b.save) ok2 = !!b.save(txt); } catch (e) { ok2 = false; }
    lastSaved = S;
    return ok1 || ok2;
  }
  // Coalesces bursts of changes (taps during a workout) into one write.
  function saveSoon(S, ms) {
    lastSaved = S;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; save(S); }, ms == null ? 300 : ms);
  }
  function flush() { if (pending && lastSaved) save(lastSaved); }
  if (G.addEventListener) {
    G.addEventListener('pagehide', flush);
    if (G.document) G.document.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'hidden') flush(); });
  }

  // Backup: the whole state, no key. Restore checks all of it (sanitize) before it replaces anything.
  function exportJson(S) {
    const copy = stripSecrets(JSON.parse(JSON.stringify(S)));
    return JSON.stringify({ app: 'gradient-health', schema: SCHEMA, exportedAt: new Date().toISOString(), state: copy });
  }
  function importJson(txt) {
    const text = typeof txt === 'string' ? txt.trim() : '';
    if (text.length > MAX_TEXT) return { ok: false, error: 'That\'s too much text for a Gradient Health backup. Paste the text from Copy my data.' };
    let o = null;
    try { o = text ? JSON.parse(text, reviver) : null; } catch (e) { o = null; }
    if (!isObj(o)) return { ok: false, error: 'That isn\'t a Gradient Health backup. Paste the whole text from Copy my data.' };
    const S = sanitize(o.app === 'gradient-health' && o.state ? o.state : o);
    if (!valid(S)) return { ok: false, error: 'That backup is missing parts. Paste the whole text from Copy my data.' };
    if ((o.schema || S.v || 1) > SCHEMA) return { ok: false, error: 'That backup is from a newer version of Gradient Health. Update the app first.' };
    return { ok: true, state: migrate(S), workouts: S.log.filter((l) => l.type === 'workout').length, since: S.profile.startDay };
  }

  function clear() {
    lsDel(KEY);
    try { const b = bridge(); if (b && b.save) b.save(''); } catch (e) { /* nothing to clear */ }
    // 1.4: an outdoor activity recording (or finished and not saved yet) goes too.
    if (GH.activity && GH.activity.reset) GH.activity.reset();
  }

  // Secrets (the AI coach key). Never logged, never in the state or a backup. In the app they live
  // only in its private preferences, encrypted with a key in the Android Keystore (Bridge.saveSecret,
  // SecretBox.java): if that store can't take one, it isn't kept anywhere, and the app asks for the
  // key again. A plain browser has no such store, so there the key sits in this site's localStorage.
  function loadSecret(name) {
    const b = bridge();
    if (!(b && b.loadSecret)) return lsGet(SECRET_PREFIX + name) || '';
    let v = '';
    try { v = String(b.loadSecret(name) || ''); } catch (e) { v = ''; }
    // A copy an older version left in localStorage (when the app's store turned it down) moves into
    // the encrypted store, and leaves localStorage whatever happens.
    const old = lsGet(SECRET_PREFIX + name);
    if (old) {
      lsDel(SECRET_PREFIX + name);
      if (!v && saveSecret(name, old)) v = old;
    }
    return v;
  }
  function saveSecret(name, value) {
    const b = bridge();
    if (!(b && b.saveSecret)) return lsSet(SECRET_PREFIX + name, value);
    let ok = false;
    try { ok = !!b.saveSecret(name, value); } catch (e) { ok = false; }
    lsDel(SECRET_PREFIX + name); // one copy at most, the encrypted one
    return ok;
  }
  function deleteSecret(name) {
    try { const b = bridge(); if (b && b.deleteSecret) b.deleteSecret(name); } catch (e) { /* ignore */ }
    lsDel(SECRET_PREFIX + name);
  }

  GH.store = { KEY, SCHEMA, MAX_TEXT, load, save, saveSoon, flush, exportJson, importJson, clear, migrate, valid, sanitize, loadSecret, saveSecret, deleteSecret };
})(typeof window !== 'undefined' ? window : globalThis);
