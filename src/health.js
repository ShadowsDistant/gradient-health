/* Health data: Health Connect (through the Android bridge) plus anything logged by hand, kept as
 * one record per day in S.health.days (what the brain and the insights read). Raw Health Connect
 * days live in S.health.hc and hand logs in S.health.manual; a day is rebuilt from both, hand
 * logs winning, so a re-sync never duplicates or overwrites what was typed in. Weigh-ins also go
 * to S.weights, one per day: yours when you typed one in, otherwise Health Connect's.
 *
 * METRICS describes every number the Health tab shows (label, unit, formatting, which way is
 * better, whether it can be typed in); history() and versus() read them back per day, with where
 * each value came from and how it compares with the person's usual.
 *
 * The Android app also reads Health Connect every 15 minutes while it's closed and keeps each read
 * on the phone; sync() folds those in first, oldest first, so days the app wasn't opened fill in.
 *
 * Finished workouts can also be written back to Health Connect as exercise sessions, keyed by day,
 * so saving one again updates it instead of adding a copy.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const KEEP_DAYS = 400;
  const SCALARS = ['steps', 'sleepMin', 'bed', 'wake', 'stages', 'rhr', 'hrv', 'weightKg', 'bodyFat', 'rhrEst', 'activeKcal', 'distanceM'];
  const DAILY = ['steps', 'activeKcal', 'distanceM']; // whole calendar days from Health Connect

  /* ---------------------------------------------------------------- Health Connect */
  function status() {
    const b = bridge();
    if (!b || !b.hcStatus) return 'unsupported';
    try { return String(b.hcStatus() || 'unavailable'); } catch (e) { return 'unavailable'; }
  }
  const connected = (st) => st === 'granted' || st === 'partial';

  let permWaiters = [];
  const permListeners = [];
  hooks.onHealthPerms = (st) => {
    const w = permWaiters; permWaiters = [];
    for (const f of w) f(String(st));
    for (const f of permListeners) { try { f(String(st)); } catch (e) { /* ignore */ } }
  };
  function onPerms(fn) { permListeners.push(fn); }
  // Shows the Health Connect permission dialog; resolves with the new status. withFood (or a state
  // with calorie tracking on) adds the nutrition permissions.
  function request(withFood) {
    const b = bridge();
    if (!b || !b.hcRequest) return Promise.resolve('unsupported');
    const food = withFood === true || (withFood && typeof withFood === 'object' && GH.food && GH.food.full(withFood));
    return new Promise((resolve) => {
      let settled = false, timer = 0;
      const done = (st) => { if (!settled) { settled = true; clearTimeout(timer); resolve(st); } };
      permWaiters.push(done);
      timer = setTimeout(() => done(status()), 180000);
      try { if (food && b.hcRequestFood) b.hcRequestFood(); else b.hcRequest(); } catch (e) { done('unavailable'); }
    });
  }
  function openSettings() { try { const b = bridge(); if (b && b.hcOpenSettings) b.hcOpenSettings(); } catch (e) { /* ignore */ } }

  let readWaiters = [];
  hooks.onHealth = (payload) => { const w = readWaiters; readWaiters = []; for (const f of w) f(payload); };
  function read(days) {
    const b = bridge();
    if (!b || !b.hcRead) return Promise.resolve({ ok: false, error: 'unsupported' });
    return new Promise((resolve) => {
      let settled = false;
      const done = (p) => { if (!settled) { settled = true; clearTimeout(timer); readWaiters = readWaiters.filter((f) => f !== done); resolve(p || { ok: false, error: 'empty' }); } };
      const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 40000);
      readWaiters.push(done);
      try { b.hcRead(days); } catch (e) { done({ ok: false, error: 'bridge' }); }
    });
  }

  // How far back to read: 90 days the first time, then the gap since the last sync plus two days
  // (so late-arriving records from a watch still land), at least 3 and at most 30.
  function syncDays(S, now) {
    if (!S.health.lastSync) return 90;
    const gap = Math.ceil(Math.max(0, now - S.health.lastSync) / 86400000);
    return Math.max(3, Math.min(30, gap + 2));
  }
  // Reads what changed and folds it in, after the reads the background sync saved meanwhile (which
  // can make this read shorter: see ingestPending).
  async function sync(S, now, days) {
    const st = status();
    S.health.status = st;
    if (!connected(st)) return { ok: false, status: st };
    const bg = drainPending(S, now);
    const payload = await read(days || syncDays(S, now));
    if (!payload || !payload.ok) return { ok: false, status: st, error: payload && payload.error, bg };
    const res = ingest(S, payload, now);
    S.health.lastSync = now;
    drainPending(S, now); // reads saved while this one ran: already covered, just marked done
    // Real read failures only: types that aren't allowed show up as "partly connected" and the
    // Allow prompt instead (and nutrition isn't asked for unless calorie tracking is on).
    const errs = payload.errors || {};
    S.health.errors = Object.keys(errs).filter((k) => errs[k] !== 'not granted');
    return Object.assign({ ok: true, status: st, bg }, res);
  }

  /* ---------------------------------------------------------------- background sync */
  // The Android app reads the last two days every 15 minutes while it's closed (HealthSyncJob.java)
  // and keeps each read, the same object onHealth gets, as a file. hcBackground() says how that's
  // going: { supported, granted, on, scheduled, lastRun, lastOk, error, pending }.
  const BG_OFF = { supported: false, granted: false, on: false, scheduled: false, lastRun: null, lastOk: null, error: null, pending: 0 };
  const bgState = (v) => Object.assign({}, BG_OFF, v && typeof v === 'object' ? v : {});
  function background() {
    const b = bridge();
    if (!b || !b.hcBackground) return bgState(null);
    try { return bgState(JSON.parse(b.hcBackground() || '{}')); } catch (e) { return bgState(null); }
  }
  // The Settings switch. Returns the new state.
  function setBackground(on) {
    const b = bridge();
    if (b && b.hcBackgroundSet) { try { b.hcBackgroundSet(!!on); } catch (e) { /* ignore */ } }
    return background();
  }
  let bgWaiters = [];
  const bgListeners = [];
  // The app says the state changed: a permission answer, the switch, or a background read that just
  // finished (then there's something to fold in).
  hooks.onHealthBackground = (st) => {
    if (typeof st === 'string') { try { st = JSON.parse(st); } catch (e) { st = null; } }
    const v = bgState(st);
    const w = bgWaiters; bgWaiters = [];
    for (const f of w) f(v);
    for (const f of bgListeners) { try { f(v); } catch (e) { /* ignore */ } }
  };
  function onBackground(fn) { bgListeners.push(fn); }
  // Asks for Health Connect's background-read permission; resolves with the new state.
  function requestBackground() {
    const b = bridge();
    if (!b || !b.hcBackgroundRequest) return Promise.resolve(background());
    return new Promise((resolve) => {
      let settled = false, timer = 0;
      const done = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        bgWaiters = bgWaiters.filter((f) => f !== done); permWaiters = permWaiters.filter((f) => f !== done);
        resolve(background());
      };
      bgWaiters.push(done); permWaiters.push(done);
      timer = setTimeout(done, 180000);
      try { b.hcBackgroundRequest(); } catch (e) { done(); }
    });
  }
  // The saved reads, as [{ id, payload }] (at most 50, oldest first), or [].
  function pending() {
    const b = bridge();
    if (!b || !b.hcPending) return [];
    try { const v = JSON.parse(b.hcPending() || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  // Folds saved reads in, oldest first. One that ends before what the app already has (the last
  // sync, or a newer background read) is skipped: something newer covered its days. A read that
  // starts before the last sync leaves no gap, so the last sync moves up to it, and the next
  // foreground read can be shorter. Returns { ids (everything handled, to mark done), n (folded in) }.
  function ingestPending(S, list, now) {
    const h = S.health;
    const items = [];
    const ids = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || x.id == null) continue;
      ids.push(String(x.id));
      const p = x.payload;
      if (!p || typeof p !== 'object' || !p.ok) continue;
      const to = ms(p.to);
      if (to == null) continue;
      items.push({ id: String(x.id), p, to, from: ms(p.from) });
    }
    items.sort((a, c) => a.to - c.to || (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
    let newest = Math.max(h.lastSync || 0, h.bgTo || 0);
    let n = 0;
    for (const x of items) {
      if (x.to <= newest) continue;
      ingest(S, x.p, now);
      n++;
      newest = h.bgTo = x.to;
      if (h.lastSync && x.from != null && x.from <= h.lastSync) h.lastSync = x.to;
    }
    return { ids, n };
  }
  // Takes the saved reads from the app, folds them in and marks them done. Returns how many were
  // folded in (and saves the state if any were).
  function drainPending(S, now) {
    const b = bridge();
    if (!S || !b || !b.hcPending || !b.hcPendingDone) return 0;
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const list = pending();
      if (!list.length) break;
      const res = ingestPending(S, list, now || Date.now());
      total += res.n;
      if (!res.ids.length) break;
      try { b.hcPendingDone(JSON.stringify(res.ids)); } catch (e) { break; }
      if (list.length < 50) break;
    }
    if (total && GH.store && GH.store.saveSoon) { try { GH.store.saveSoon(S); } catch (e) { /* ignore */ } }
    return total;
  }
  // Deletes the saved reads without folding them in (Reset everything). Returns how many went.
  function clearPending() {
    const b = bridge();
    if (!b || !b.hcPending || !b.hcPendingDone) return 0;
    let n = 0;
    for (let round = 0; round < 20; round++) {
      const ids = pending().filter((x) => x && x.id != null).map((x) => String(x.id));
      if (!ids.length) break;
      try { b.hcPendingDone(JSON.stringify(ids)); } catch (e) { break; }
      n += ids.length;
    }
    return n;
  }

  /* ---------------------------------------------------------------- folding data in */
  const roll = (S) => (S.profile && S.profile.prefs && S.profile.prefs.rollHour != null ? S.profile.prefs.rollHour : 4);
  const ms = (iso) => { const t = Date.parse(iso); return isFinite(t) ? t : null; };
  // What each data type of a read fills in on a day.
  const TYPE_KEYS = { steps: ['steps'], sleep: ['sleepMin', 'bed', 'wake', 'stages'], weight: ['weightKg'], bodyFat: ['bodyFat'], restingHr: ['rhr'], hrv: ['hrv'], heartRate: ['rhrEst'], activeKcal: ['activeKcal'], distance: ['distanceM'], exercise: ['exercise'] };

  function ingest(S, p, now) {
    const b = B();
    const rh = roll(S);
    const h = S.health;
    h.hc = h.hc || {}; h.manual = h.manual || {}; h.days = h.days || {};
    const fromMs = ms(p.from), toMs = ms(p.to) || now || Date.now();
    const first = fromMs != null ? b.dayOf(fromMs, rh) : null;
    const last = b.dayOf(toMs, rh);
    const fresh = {};
    const day = (d) => (fresh[d] = fresh[d] || {});
    // A type whose read failed (it timed out, Health Connect was busy) keeps what earlier reads found
    // on the days this one covers, instead of losing it. Types that aren't allowed are cleared as usual.
    const errs = p.errors || {};
    const failed = (k) => errs[k] != null && errs[k] !== 'not granted' && !/^truncated/.test(String(errs[k]));
    const keep = [].concat(...Object.keys(TYPE_KEYS).filter(failed).map((k) => TYPE_KEYS[k]));
    // Steps come as whole local calendar days.
    for (const x of p.steps || []) {
      if (!x || !x.date || !(x.count >= 0)) continue;
      day(b.dayFromStr(x.date)).steps = Math.round(x.count);
    }
    // Sleep counts toward the morning you woke up; the longest session gives bed and wake times.
    const sleepBy = {};
    for (const x of p.sleep || []) {
      const s = ms(x.start), e = ms(x.end);
      if (s == null || e == null || e <= s) continue;
      const d = b.dayOf(e, rh);
      (sleepBy[d] = sleepBy[d] || []).push({ s, e, min: Math.max(0, Math.round(x.asleepMin != null ? x.asleepMin : (e - s) / 60000)), stages: x.stages || null });
    }
    for (const [d, list] of Object.entries(sleepBy)) {
      const main = list.slice().sort((a, c) => (c.e - c.s) - (a.e - a.s))[0];
      const r = day(d);
      r.sleepMin = list.reduce((a, x) => a + x.min, 0);
      r.bed = main.s; r.wake = main.e;
      if (main.stages) r.stages = main.stages;
    }
    const lastOfDay = (list, key, digits) => {
      const by = {};
      for (const x of list || []) { const t = ms(x.time); if (t == null || !(x[key] > 0)) continue; const d = b.dayOf(t, rh); if (!by[d] || by[d].t < t) by[d] = { t, v: x[key] }; }
      const out = {};
      for (const [d, o] of Object.entries(by)) out[d] = round(o.v, digits);
      return out;
    };
    const avgOfDay = (list, key, digits) => {
      const by = {};
      for (const x of list || []) { const t = ms(x.time); if (t == null || !(x[key] > 0)) continue; const d = b.dayOf(t, rh); (by[d] = by[d] || []).push(x[key]); }
      const out = {};
      for (const [d, v] of Object.entries(by)) out[d] = round(v.reduce((a, c) => a + c, 0) / v.length, digits);
      return out;
    };
    for (const [d, v] of Object.entries(lastOfDay(p.weight, 'kg', 2))) day(d).weightKg = v;
    for (const [d, v] of Object.entries(lastOfDay(p.bodyFat, 'pct', 1))) day(d).bodyFat = v;
    for (const [d, v] of Object.entries(avgOfDay(p.restingHr, 'bpm', 0))) day(d).rhr = v;
    for (const [d, v] of Object.entries(avgOfDay(p.hrv, 'ms', 1))) day(d).hrv = v;
    // Estimated resting heart rate for watches that record heart rate but don't share a resting
    // value (Samsung Health, Garmin): the lowest half hour of each local day, which is deep sleep
    // for people who wear the watch at night. A low in the daytime means the watch was off overnight,
    // so it isn't a resting value and is skipped.
    // The read starts partway through its first calendar day, so that day's low is only the low of
    // the part that was read: keep the lower of it and what earlier reads found.
    const calFirst = fromMs != null ? b.dayOf(fromMs, 0) : null;
    for (const x of p.heartRate || []) {
      const t = ms(x.time);
      if (t == null || !(x.bpm >= 25 && x.bpm <= 150)) continue;
      const hour = new Date(t).getHours();
      if (hour >= 10 && hour < 21) continue;
      const d = b.dayOf(t, 0);
      let v = Math.round(x.bpm);
      const before = calFirst != null && d <= calFirst && h.hc[d] ? h.hc[d].rhrEst : null;
      if (before != null && before < v) v = before;
      day(d).rhrEst = v;
    }
    // Daily totals from Health Connect, by local calendar day.
    for (const x of p.activeKcal || []) if (x && x.date && x.kcal > 0 && x.kcal < 10000) day(b.dayFromStr(x.date)).activeKcal = Math.round(x.kcal);
    for (const x of p.distance || []) if (x && x.date && x.m > 0 && x.m < 500000) day(b.dayFromStr(x.date)).distanceM = Math.round(x.m);
    // Workouts from other apps. One that overlaps a workout done in this app is that workout, and one
    // that overlaps an activity recorded here (src/activity.js: its saved copy, or the watch's own
    // recording of the same run) is that activity.
    const appSpans = S.log.filter((l) => l.type === 'workout' && l.startedAt && l.endedAt).map((l) => [l.startedAt, l.endedAt])
      .concat(GH.activity ? GH.activity.spans(S) : []);
    for (const x of p.exercise || []) {
      const s = ms(x.start), e = ms(x.end);
      if (s == null || e == null || e <= s) continue;
      const minutes = Math.round((e - s) / 60000);
      if (minutes < 5) continue;
      const fromApp = !!x.mine || appSpans.some(([a, c]) => s < c && e > a);
      const d = b.dayOf(s, rh);
      (day(d).exercise = day(d).exercise || []).push({ typeName: prettyType(x.typeName), minutes, start: s, title: x.title || '', fromApp, src: 'hc' });
    }
    // Height fills the profile if it's empty.
    const heights = (p.height || []).filter((x) => x && x.m > 0.9 && x.m < 2.5).sort((a, c) => (ms(a.time) || 0) - (ms(c.time) || 0));
    if (heights.length && !S.profile.heightCm) S.profile.heightCm = Math.round(heights[heights.length - 1].m * 100);
    // Food logged in other apps, as totals per day (this app's own records are left out by the bridge).
    if (Array.isArray(p.nutrition) && GH.food && !failed('nutrition')) {
      const eaten = {};
      for (const x of p.nutrition) {
        const t = ms(x && x.start);
        if (t == null || !(x.kcal >= 0) || x.kcal > 20000) continue;
        const d = b.dayOf(t, rh);
        const o = eaten[d] = eaten[d] || { day: d, kcal: 0, p: 0, c: 0, f: 0, n: 0 };
        o.kcal += x.kcal || 0; o.p += x.p || 0; o.c += x.c || 0; o.f += x.f || 0; o.n++;
      }
      // Whole days only: the read's first day is partial, so it keeps what earlier reads found.
      const other = GH.food.data(S).other;
      if (first != null) for (let d = first + 1; d <= last; d++) if (!eaten[d]) delete other[d];
      GH.food.ingestOther(S, Object.values(eaten).filter((o) => first == null || o.day > first));
    }
    // Replace every day the read covered (so deleted records go away), keep older days. The read
    // starts partway through its first day, so that day is merged instead: records from before the
    // start time weren't part of this read.
    const touched = new Set(Object.keys(fresh).map(Number));
    if (first != null) for (let d = first; d <= last; d++) touched.add(d);
    // Daily totals (steps, active calories, distance) come as whole calendar days, starting a day
    // later than the records; a day the records cover but the totals don't keeps its old totals
    // (a sync between midnight and 4 am would otherwise wipe that day's steps).
    const span = fromMs != null ? Math.round((toMs - fromMs) / 86400000) : 0;
    const dailyFirst = span > 0 ? b.dayOf(toMs, 0) - (span - 1) : null;
    let newest = null;
    const weightFailed = failed('weight');
    for (const d of touched) {
      const partial = first != null && d <= first;
      if (!partial && dailyFirst != null && d < dailyFirst && h.hc[d]) {
        for (const k of DAILY) if (h.hc[d][k] != null && !(fresh[d] && fresh[d][k] != null)) day(d)[k] = h.hc[d][k];
      }
      if (!partial && keep.length && h.hc[d]) {
        for (const k of keep) if (h.hc[d][k] != null && !(fresh[d] && fresh[d][k] != null)) day(d)[k] = h.hc[d][k];
      }
      if (partial) {
        if (fresh[d]) {
          const old = h.hc[d] || {};
          const merged = Object.assign({}, old, fresh[d]);
          if (old.exercise && fresh[d].exercise) { const have = new Set(fresh[d].exercise.map((x) => x.start)); merged.exercise = fresh[d].exercise.concat(old.exercise.filter((x) => !have.has(x.start))); }
          h.hc[d] = merged;
        }
      } else if (fresh[d]) h.hc[d] = fresh[d]; else delete h.hc[d];
      // A partial day without a weigh-in in this read keeps the one found before, and a failed
      // weight read leaves the weights list as it was.
      if (!weightFailed) {
        if (fresh[d] && fresh[d].weightKg) newest = d;
        if (!partial || (fresh[d] && fresh[d].weightKg)) syncWeight(S, d);
      }
      rebuild(S, d);
    }
    prune(S, last);
    return { days: Object.keys(fresh).length, weight: newest };
  }
  const round = (v, digits) => { const f = Math.pow(10, digits || 0); return Math.round(v * f) / f; };
  const TYPE_NAMES = { high_intensity_interval_training: 'HIIT', biking: 'cycling', biking_stationary: 'stationary bike', running_treadmill: 'treadmill run', strength_training: 'strength training', swimming_pool: 'swimming', swimming_open_water: 'open-water swim', football_american: 'American football', football_australian: 'Australian football', frisbee_disc: 'frisbee', stair_climbing_machine: 'stair machine', rowing_machine: 'rowing machine', other: 'workout' };
  function prettyType(t) { const k = String(t || 'other'); return TYPE_NAMES[k] || k.replace(/_/g, ' '); }

  function rebuild(S, d) {
    const h = S.health;
    const hc = h.hc[d], man = h.manual[d];
    // Activities recorded in the app count as that day's exercise, like a session from Health Connect.
    const acts = GH.activity ? GH.activity.exerciseOn(S, Number(d)) : [];
    if (!hc && !man && !acts.length) { delete h.days[d]; return; }
    const out = {};
    for (const k of SCALARS) {
      if (man && man[k] != null) out[k] = man[k];
      else if (hc && hc[k] != null) out[k] = hc[k];
    }
    // No resting heart rate shared: use the estimate from heart rate, and say so where it shows.
    if (out.rhr == null && out.rhrEst != null) { out.rhr = out.rhrEst; out.rhrFromEst = true; }
    const ex = [].concat((hc && hc.exercise) || [], (man && man.exercise) || [], acts);
    if (ex.length) out.exercise = ex;
    out.src = { hc: !!hc, manual: !!man };
    if (acts.length) out.src.activity = true;
    h.days[d] = out;
  }
  function prune(S, today) {
    const h = S.health;
    for (const store of [h.hc, h.manual, h.days]) for (const k of Object.keys(store)) if (Number(k) < today - KEEP_DAYS) delete store[k];
  }

  /* ---------------------------------------------------------------- hand logs */
  // patch: { sleepMin } | { steps } | { weightKg } | { exercise: { typeName, minutes } } | { rhr }
  function logManual(S, day, patch) {
    const m = S.health.manual[day] = S.health.manual[day] || {};
    for (const k of SCALARS) if (patch[k] != null) m[k] = patch[k];
    if (patch.exercise) m.exercise = (m.exercise || []).concat([{ typeName: String(patch.exercise.typeName || 'workout').slice(0, 40), minutes: Math.max(1, Math.round(patch.exercise.minutes || 0)), src: 'manual' }]);
    if (patch.weightKg) { B().addWeight(S, day, patch.weightKg, 'manual'); syncWeight(S, day); }
    rebuild(S, day);
    return S.health.days[day];
  }
  function removeManual(S, day, key, index) {
    const m = S.health.manual[day];
    if (m) {
      if (key === 'exercise' && Array.isArray(m.exercise)) m.exercise.splice(index, 1);
      else delete m[key];
      if (!Object.keys(m).some((k) => (k === 'exercise' ? m.exercise.length : m[k] != null))) delete S.health.manual[day];
    }
    // Weigh-ins typed in at a workout's check-in live in S.weights only, so this runs without a hand log too.
    if (key === 'weightKg') { S.weights = S.weights.filter((w) => !(w.day === day && w.src === 'manual')); syncWeight(S, day); }
    rebuild(S, day);
  }
  // One weigh-in per day in S.weights: the person's when they typed one in, otherwise Health
  // Connect's (kept in S.health.hc, so removing the person's brings it back).
  function syncWeight(S, d) {
    const mine = S.weights.some((w) => w.day === d && w.src === 'manual');
    S.weights = S.weights.filter((w) => !(w.day === d && w.src === 'hc'));
    const kg = S.health.hc[d] && S.health.hc[d].weightKg;
    if (kg && !mine) B().addWeight(S, d, kg, 'hc');
  }
  function setFeel(S, day, feel) { S.feel[day] = Object.assign({}, S.feel[day] || {}, feel); }
  function setSleepChip(S, day, chip) { if (chip) S.sleepChip[day] = chip; else delete S.sleepChip[day]; }
  // Body measurements in cm: waist, armL, armR, chest, thigh. Merged into that day's entry, so
  // saving one doesn't wipe the others.
  const MEASURES = ['waist', 'armL', 'armR', 'chest', 'thigh'];
  function addMeasurement(S, day, m) {
    const clean = {};
    for (const k of MEASURES) if (m[k] > 0) clean[k] = round(m[k], 1);
    if (!Object.keys(clean).length) return null;
    const old = S.measurements.find((x) => x.day === day) || {};
    S.measurements = S.measurements.filter((x) => x.day !== day);
    S.measurements.push(Object.assign({}, old, clean, { day }));
    S.measurements.sort((a, b) => a.day - b.day);
    return clean;
  }
  function removeMeasurement(S, day, key) {
    const x = S.measurements.find((y) => y.day === day);
    if (!x) return;
    delete x[key];
    if (!MEASURES.some((k) => x[k] != null)) S.measurements = S.measurements.filter((y) => y !== x);
  }
  function measureDue(S, day) {
    const last = S.measurements.length ? S.measurements[S.measurements.length - 1].day : null;
    if (last == null) return day - (S.profile.startDay || day) >= 7;
    return day - last >= 28;
  }

  /* ---------------------------------------------------------------- reading it back */
  function value(S, key, d) {
    const r = S.health.days[d];
    if (key === 'sleepMin' && (!r || r.sleepMin == null)) {
      const chip = S.sleepChip && S.sleepChip[d];
      return chip ? CHIP_MIN[chip] : null;
    }
    return r && r[key] != null ? r[key] : null;
  }
  const CHIP_MIN = { '<5': 270, '5-6': 330, '6-7': 390, '7-8': 450, '8+': 510 };
  // The most recent value on or before `day`, looking back at most `back` days: { value, day } or null.
  // Some watch apps sync late or skip days, and a night that ends before the 4 am rollover is filed
  // under the day before, so "today only" would show a blank tile.
  function latest(S, key, day, back) {
    for (let d = day; d >= day - (back || 0); d--) { const v = value(S, key, d); if (v != null) return { value: v, day: d }; }
    return null;
  }
  function series(S, key, from, to) {
    const out = [];
    for (let d = from; d <= to; d++) { const v = key === 'weightKg' ? weightOn(S, d) : value(S, key, d); if (v != null) out.push({ day: d, value: v }); }
    return out;
  }
  // The day's weigh-in: the person's own when there is one (a check-in weight, say), else the latest.
  function weightOn(S, d) {
    const w = S.weights.filter((x) => x.day === d && x.src !== 'profile');
    if (!w.length) return null;
    const mine = w.filter((x) => x.src === 'manual');
    return (mine.length ? mine[mine.length - 1] : w[w.length - 1]).kg;
  }
  function stats(S, key, from, to) {
    const v = series(S, key, from, to).map((x) => x.value);
    if (!v.length) return { n: 0, avg: null, median: null, sd: null, values: v };
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - avg) * (b - avg), 0) / (v.length - 1)) : 0;
    return { n: v.length, avg, median: B().median(v), sd, values: v };
  }
  // Your normal: the 28 days before `day`.
  function baseline(S, key, day) { return stats(S, key, day - 28, day - 1); }

  function appWorkouts(S, from, to) {
    return S.log.filter((l) => l.type === 'workout' && l.day >= from && l.day <= to && l.checkedIn)
      .map((l) => ({ day: l.day, name: l.title, minutes: l.startedAt && l.endedAt ? Math.max(1, Math.round((l.endedAt - l.startedAt) / 60000)) : null, src: 'app', pct: l.pct, rating: l.checkin && l.checkin.rating }));
  }
  function activity(S, from, to) {
    const out = appWorkouts(S, from, to);
    for (let d = from; d <= to; d++) {
      const r = S.health.days[d];
      for (const e of (r && r.exercise) || []) if (!e.fromApp) out.push({ day: d, name: e.typeName, minutes: e.minutes, src: e.src || 'hc', title: e.title || '', id: e.id, start: e.start });
    }
    return out.sort((a, b) => b.day - a.day);
  }
  function activeMinutes(S, from, to) { return activity(S, from, to).reduce((a, x) => a + (x.minutes || 0), 0); }

  // Everything the Health tab's Today card shows.
  function today(S, day) {
    const r = S.health.days[day] || {};
    const ws = B().weightStats(S, day);
    const rl = latest(S, 'rhr', day, 3);
    return {
      rhrEstimated: !!(rl && S.health.days[rl.day] && S.health.days[rl.day].rhrFromEst),
      sleepMin: value(S, 'sleepMin', day), sleepFromChip: r.sleepMin == null && !!(S.sleepChip && S.sleepChip[day]),
      sleepLast: latest(S, 'sleepMin', day, 1), rhrLast: rl, hrvLast: latest(S, 'hrv', day, 3),
      activeKcal: value(S, 'activeKcal', day), distanceM: value(S, 'distanceM', day),
      bed: r.bed || null, wake: r.wake || null, stages: r.stages || null,
      steps: r.steps != null ? r.steps : null, rhr: r.rhr != null ? r.rhr : null, hrv: r.hrv != null ? r.hrv : null,
      weightAvg7: ws.avg7, weightLast: ws.last, activeMin: activeMinutes(S, day, day),
      protein: B().proteinToday(S, day), proteinGoal: B().proteinGoal(S, day), feel: S.feel[day] || null,
    };
  }

  /* ---------------------------------------------------------------- metrics */
  // Every number the Health tab shows. Values are stored in one unit (minutes, kg, metres, cm) and
  // shown in the person's (lb and miles unless they picked kg). Per metric:
  //   unit (stored), from (where values come from, the first that has one winning: 'manual' is the
  //   person's own, then Health Connect, then 'est' / 'chip' stand-ins; see SOURCE),
  //   label, short (tiles), icon, tone (hue), kind (chart: bar | line | dot), zero (axis from 0),
  //   better (up | down | goal: from the weight goal | null), edit (can be typed in), back (how old
  //   the latest value may be, days), daily (a whole-day total: today isn't over yet), per (a day,
  //   a night), near / far (a change smaller than near is "steady"; one past far in the wrong
  //   direction is worth watching; abs in stored units or rel as a fraction), valid (typed-in range).
  const LB_PER_KG = 2.20462;
  const M_PER_MI = 1609.344;
  const CM_PER_IN = 2.54;
  const imperial = (S) => !(S && S.profile && S.profile.units === 'kg');
  const METRICS = {
    sleepMin: { unit: 'min', from: ['manual', 'hc', 'chip'], label: 'Sleep', icon: 'moon', tone: 'indigo', kind: 'bar', zero: true, better: 'up', edit: true, back: 1, per: 'a night', words: ['more than', 'less than'], near: { abs: 15 }, far: { abs: 45 }, watch: { below: 360 }, valid: [30, 1080] },
    steps: { unit: 'steps', from: ['manual', 'hc'], label: 'Steps', icon: 'navigate', tone: 'green', kind: 'bar', zero: true, better: 'up', edit: true, back: 0, daily: true, per: 'a day', near: { rel: 0.08 }, far: { rel: 0.2 }, valid: [0, 100000] },
    rhr: { unit: 'bpm', from: ['manual', 'hc', 'est'], label: 'Resting heart rate', short: 'Resting HR', icon: 'heart', tone: 'rose', kind: 'line', better: 'down', edit: true, back: 3, near: { abs: 2 }, far: { abs: 5 }, watch: { above: 99 }, valid: [25, 150] },
    hrv: { unit: 'ms', from: ['hc'], label: 'Heart rate variability', short: 'HRV', icon: 'wave', tone: 'violet', kind: 'line', better: 'up', edit: false, back: 3, near: { rel: 0.07 }, far: { rel: 0.15 } },
    weightKg: { unit: 'kg', from: ['manual', 'hc'], label: 'Weight', icon: 'scale', tone: 'teal', kind: 'dot', better: 'goal', edit: true, back: 60, words: ['higher than', 'lower than'], near: { abs: 0.2 }, far: { abs: 1 }, valid: [25, 350] },
    bodyFat: { unit: '%', from: ['hc'], label: 'Body fat', icon: 'drop', tone: 'sky', kind: 'line', better: null, edit: false, back: 60, near: { abs: 0.5 }, far: { abs: 2 } },
    activeKcal: { unit: 'kcal', from: ['hc'], label: 'Active calories', icon: 'flame', tone: 'coral', kind: 'bar', zero: true, better: 'up', edit: false, back: 0, daily: true, per: 'a day', near: { rel: 0.1 }, far: { rel: 0.3 } },
    distanceM: { unit: 'm', from: ['hc'], label: 'Distance', icon: 'map', tone: 'sky', kind: 'bar', zero: true, better: 'up', edit: false, back: 0, daily: true, per: 'a day', near: { rel: 0.1 }, far: { rel: 0.3 } },
    activeMin: { unit: 'min', from: ['app', 'hc', 'manual'], label: 'Active minutes', short: 'Active', icon: 'bolt', tone: 'amber', kind: 'bar', zero: true, better: 'up', edit: false, back: 0, daily: true, per: 'a day', near: { rel: 0.15 }, far: { rel: 0.4 } },
    kcalIn: { unit: 'kcal', from: ['food'], label: 'Calories eaten', short: 'Eaten', icon: 'food', tone: 'green', kind: 'bar', zero: true, better: null, edit: false, back: 0, daily: true, per: 'a day', near: { rel: 0.08 }, far: { rel: 0.25 } },
    protein: { unit: 'g', from: ['food'], label: 'Protein', icon: 'check-circle', tone: 'green', kind: 'bar', zero: true, better: 'up', edit: false, back: 0, daily: true, per: 'a day', near: { rel: 0.1 }, far: { rel: 0.3 } },
    waist: { unit: 'cm', from: ['manual'], label: 'Waist', icon: 'pin', tone: 'violet', kind: 'line', group: 'measure', better: null, edit: true, back: 400, near: { abs: 0.5 }, far: { abs: 2 }, valid: [20, 250] },
    armL: { unit: 'cm', from: ['manual'], label: 'Left arm', icon: 'pin', tone: 'violet', kind: 'line', group: 'measure', better: null, edit: true, back: 400, near: { abs: 0.3 }, far: { abs: 1.5 }, valid: [10, 80] },
    armR: { unit: 'cm', from: ['manual'], label: 'Right arm', icon: 'pin', tone: 'violet', kind: 'line', group: 'measure', better: null, edit: true, back: 400, near: { abs: 0.3 }, far: { abs: 1.5 }, valid: [10, 80] },
    chest: { unit: 'cm', from: ['manual'], label: 'Chest', icon: 'pin', tone: 'violet', kind: 'line', group: 'measure', better: null, edit: true, back: 400, near: { abs: 0.5 }, far: { abs: 2 }, valid: [40, 200] },
    thigh: { unit: 'cm', from: ['manual'], label: 'Thigh', icon: 'pin', tone: 'violet', kind: 'line', group: 'measure', better: null, edit: true, back: 400, near: { abs: 0.5 }, far: { abs: 2 }, valid: [20, 120] },
  };
  for (const [k, m] of Object.entries(METRICS)) { m.key = k; m.short = m.short || m.label; }
  const isMeasure = (key) => MEASURES.includes(key);

  // The unit a metric is shown in, and conversions between stored and shown values.
  function unitOf(S, key) {
    if (key === 'weightKg') return imperial(S) ? 'lb' : 'kg';
    if (key === 'distanceM') return imperial(S) ? 'mi' : 'km';
    if (isMeasure(key)) return imperial(S) ? 'in' : 'cm';
    return { rhr: 'bpm', hrv: 'ms', activeKcal: 'kcal', kcalIn: 'kcal', protein: 'g', bodyFat: '%', activeMin: 'min', sleepMin: 'min' }[key] || '';
  }
  function toDisplay(S, key, v) {
    if (v == null) return null;
    if (key === 'weightKg') return imperial(S) ? v * LB_PER_KG : v;
    if (key === 'distanceM') return v / (imperial(S) ? M_PER_MI : 1000);
    if (isMeasure(key)) return imperial(S) ? v / CM_PER_IN : v;
    return v;
  }
  function fromDisplay(S, key, x) {
    if (x == null || !isFinite(x)) return null;
    if (key === 'weightKg') return imperial(S) ? x / LB_PER_KG : x;
    if (key === 'distanceM') return x * (imperial(S) ? M_PER_MI : 1000);
    if (isMeasure(key)) return imperial(S) ? x * CM_PER_IN : x;
    return x;
  }
  const digitsOf = (key) => (key === 'weightKg' || key === 'distanceM' || key === 'bodyFat' || isMeasure(key) ? 1 : 0);
  const num = (v, d) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  // Minutes as "7 h 05", or "45 min" under an hour.
  function hm(min) {
    const t = Math.max(0, Math.round(min));
    const h = Math.floor(t / 60), m = t % 60;
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }
  // A value as the pieces it's shown in: [{ t: text, u: true when it's a unit }].
  function formatParts(S, key, v) {
    if (v == null || !isFinite(v)) return [{ t: '–', u: false }];
    if (key === 'sleepMin' || key === 'activeMin') {
      const t = Math.max(0, Math.round(v));
      const h = Math.floor(t / 60), m = t % 60;
      return h ? [{ t: String(h), u: false }, { t: 'h', u: true }, { t: String(m).padStart(2, '0'), u: false }, { t: 'min', u: true }] : [{ t: String(m), u: false }, { t: 'min', u: true }];
    }
    if (key === 'steps') return [{ t: num(Math.round(v)), u: false }];
    if (key === 'bodyFat') return [{ t: `${num(v, 1)}%`, u: false }];
    const unit = unitOf(S, key);
    return [{ t: num(toDisplay(S, key, v), digitsOf(key)), u: false }].concat(unit ? [{ t: unit, u: true }] : []);
  }
  // "7 h 05", "8,234", "149.6 lb", "5.4 km". o.compact shortens big step counts ("8.2k").
  function format(S, key, v, o) {
    if (v == null || !isFinite(v)) return '–';
    if (key === 'sleepMin' || key === 'activeMin') return hm(v);
    if (key === 'steps' && o && o.compact && v >= 1000) return `${num(v / 1000, v >= 100000 ? 0 : 1)}k`;
    if (o && o.unit === false) return formatParts(S, key, v).filter((p) => !p.u).map((p) => p.t).join(key === 'sleepMin' ? ':' : ' ');
    return formatParts(S, key, v).map((p) => p.t).join(' ');
  }
  // A change as signed text: "+20 min", "-2 bpm", "-0.3 lb", or a percentage for counts ("+9%").
  function formatDelta(S, key, delta, rel) {
    if (delta == null || !isFinite(delta)) return '';
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    const m = METRICS[key];
    if (m && m.near && m.near.rel != null && rel != null && isFinite(rel)) return `${rel > 0 ? '+' : rel < 0 ? '-' : ''}${Math.round(Math.abs(rel) * 100)}%`;
    if (key === 'sleepMin' || key === 'activeMin') return `${sign}${hm(Math.abs(delta))}`;
    if (key === 'bodyFat') return `${sign}${num(Math.abs(delta), 1)}`;
    const unit = unitOf(S, key);
    return `${sign}${num(Math.abs(toDisplay(S, key, delta)), digitsOf(key))}${unit ? ` ${unit}` : ''}`;
  }

  // Where a value came from: 'hc' (Health Connect), 'manual' (typed in by the person), 'est' (worked
  // out from heart rate), 'chip' (the sleep check-in), 'app' (a workout in this app), 'food' (the food
  // log, protein adds included).
  const SOURCE = { hc: 'Health Connect', manual: 'You', est: 'Estimated from heart rate', chip: 'Your check-in', app: 'Gradient Health', food: 'Your food log' };
  // One day of a metric: { day, value, src, mine (the person's value), hc (Health Connect's, also
  // when the person's replaces it) } or null.
  function entry(S, key, d) {
    const h = S.health;
    if (key === 'weightKg') {
      const w = S.weights.filter((x) => x.day === d && x.src !== 'profile');
      const mine = w.filter((x) => x.src === 'manual').pop();
      const hcw = w.filter((x) => x.src === 'hc').pop();
      const hcKg = hcw ? hcw.kg : (h.hc[d] && h.hc[d].weightKg) || null;
      if (mine) return { day: d, value: mine.kg, src: 'manual', mine: mine.kg, hc: hcKg };
      const any = hcw || w[w.length - 1];
      return any ? { day: d, value: any.kg, src: any.src === 'hc' ? 'hc' : 'manual', mine: null, hc: hcKg } : null;
    }
    if (isMeasure(key)) {
      const x = S.measurements.find((y) => y.day === d);
      return x && x[key] != null ? { day: d, value: x[key], src: 'manual', mine: x[key], hc: null } : null;
    }
    if (key === 'activeMin') {
      const list = activity(S, d, d);
      const v = list.reduce((a, x) => a + (x.minutes || 0), 0);
      if (!(v > 0)) return null;
      const src = list.some((x) => x.src === 'app') ? 'app' : list.some((x) => x.src === 'manual') ? 'manual' : 'hc';
      return { day: d, value: v, src, mine: null, hc: null };
    }
    if (key === 'kcalIn') {
      const F = GH.food;
      if (!F || !F.totals) return null;
      const t = F.totals(S, d);
      return t.n || (t.other && t.other.kcal) ? { day: d, value: Math.round(t.kcal), src: 'food', mine: null, hc: null } : null;
    }
    if (key === 'protein') {
      const g = B().proteinToday(S, d);
      return g > 0 ? { day: d, value: Math.round(g), src: 'food', mine: null, hc: null } : null;
    }
    const v = value(S, key, d);
    if (v == null) return null;
    const man = h.manual[d], hc = h.hc[d], r = h.days[d];
    const mine = man && man[key] != null ? man[key] : null;
    const hcv = hc ? (hc[key] != null ? hc[key] : key === 'rhr' && hc.rhrEst != null ? hc.rhrEst : null) : null;
    let src = 'hc';
    if (mine != null) src = 'manual';
    else if (key === 'rhr' && r && r.rhrFromEst) src = 'est';
    else if (key === 'sleepMin' && !(r && r.sleepMin != null)) src = 'chip';
    return { day: d, value: v, src, mine, hc: hcv };
  }
  // Every day with a value from `from` to `to`, oldest first.
  function history(S, key, from, to) {
    const out = [];
    for (let d = from; d <= to; d++) { const e = entry(S, key, d); if (e) out.push(e); }
    return out;
  }
  // The newest value on or before `day`, at most `back` days old (the metric's own limit by default).
  function latestEntry(S, key, day, back) {
    const b = back != null ? back : METRICS[key] ? METRICS[key].back : 0;
    for (let d = day; d >= day - b; d--) { const e = entry(S, key, d); if (e) return e; }
    return null;
  }
  // Average, lowest, highest and change over a range. change: the last week's average minus the
  // first week's with data (last value minus first for a week or less); null when the two weeks
  // would overlap.
  function rangeStats(S, key, from, to) {
    const list = history(S, key, from, to);
    const out = { n: list.length, avg: null, min: null, max: null, minDay: null, maxDay: null, first: null, last: null, change: null, changeRel: null, total: null, list };
    if (!list.length) return out;
    let lo = list[0], hi = list[0], sum = 0;
    for (const e of list) { sum += e.value; if (e.value < lo.value) lo = e; if (e.value > hi.value) hi = e; }
    Object.assign(out, { avg: sum / list.length, total: sum, min: lo.value, minDay: lo.day, max: hi.value, maxDay: hi.day, first: list[0], last: list[list.length - 1] });
    let base = null;
    if (to - from < 7) { if (list.length >= 2) { base = out.first.value; out.change = out.last.value - base; } }
    else {
      const mean = (a) => (a.length ? a.reduce((x, e) => x + e.value, 0) / a.length : null);
      const start = list[0].day;
      const a = mean(list.filter((e) => e.day <= start + 6)), z = mean(list.filter((e) => e.day >= to - 6));
      if (a != null && z != null && start + 6 < to - 6) { base = a; out.change = z - a; }
    }
    if (out.change != null && base) out.changeRel = out.change / base;
    return out;
  }
  // How a metric compares with the person's usual. mode 'week': the average of the last 7 days (the
  // last 7 whole days for daily totals); 'latest': the newest value (daily totals use the week too,
  // since today isn't over). Usual: the 28 days before that, at least 5 of them with data. Weight
  // compares its 7-day average with the week before instead.
  // → { value, usual, delta, rel, dir: up | down | flat | null, tone: good | watch | neutral, n, un }
  function versus(S, key, day, mode) {
    const m = METRICS[key];
    if (!m) return null;
    let cur, n, un, usual, start;
    if (key === 'weightKg') {
      const w = rangeStats(S, key, day - 6, day);
      if (!w.n) return null;
      const prev = rangeStats(S, key, day - 13, day - 7);
      cur = w.avg; n = w.n; un = prev.n; usual = prev.n ? prev.avg : null;
    } else {
      if (mode === 'week' || m.daily) {
        const end = m.daily ? day - 1 : day;
        const st = rangeStats(S, key, end - 6, end);
        if (!st.n) return null;
        cur = st.avg; n = st.n; start = end - 6;
      } else {
        const e = latestEntry(S, key, day);
        if (!e) return null;
        cur = e.value; n = 1; start = e.day;
      }
      const base = rangeStats(S, key, start - 28, start - 1);
      un = base.n; usual = base.n >= 5 ? base.avg : null;
    }
    const out = { key, value: cur, usual, delta: null, rel: null, dir: null, tone: 'neutral', n, un };
    // Some values are worth watching whatever the person's usual (under 6 hours of sleep, a resting
    // heart rate of 100 or more).
    const limit = m.watch && ((m.watch.below != null && cur < m.watch.below) || (m.watch.above != null && cur > m.watch.above));
    if (usual == null) { if (limit) out.tone = 'watch'; return out; }
    out.delta = cur - usual;
    out.rel = usual ? out.delta / usual : null;
    const size = (t) => (t.rel != null ? Math.abs(out.rel || 0) : Math.abs(out.delta));
    const lim = (t) => (t.rel != null ? t.rel : t.abs);
    out.dir = size(m.near) < lim(m.near) ? 'flat' : out.delta > 0 ? 'up' : 'down';
    let better = m.better;
    const goal = (S.profile && S.profile.weightGoal) || 'maintain';
    if (better === 'goal') better = goal === 'lose' ? 'down' : goal === 'gain' ? 'up' : null;
    const far = size(m.far) >= lim(m.far);
    if (out.dir === 'flat') out.tone = m.better === 'goal' && goal === 'maintain' ? 'good' : 'neutral';
    else if (better && out.dir === better) out.tone = 'good';
    else if (better || m.better === 'goal') out.tone = far ? 'watch' : 'neutral';
    if (limit) out.tone = 'watch';
    return out;
  }
  // The person's own value for a day, in stored units (minutes, kg, cm...). It replaces Health
  // Connect's for that day and sync never overwrites it. False when it can't be typed in or is
  // out of range.
  function setManual(S, day, key, v) {
    const m = METRICS[key];
    if (!m || !m.edit || v == null || !isFinite(v)) return false;
    if (m.valid && (v < m.valid[0] || v > m.valid[1])) return false;
    if (isMeasure(key)) return !!addMeasurement(S, day, { [key]: v });
    const val = key === 'steps' || key === 'sleepMin' || key === 'rhr' ? Math.round(v) : round(v, 2);
    logManual(S, day, { [key]: val });
    return true;
  }
  // Takes the person's value away again: Health Connect's (if any) is back for that day.
  function clearManual(S, day, key) {
    if (isMeasure(key)) removeMeasurement(S, day, key);
    else removeManual(S, day, key);
  }
  function hasManual(S, day, key) {
    if (key === 'weightKg') return S.weights.some((w) => w.day === day && w.src === 'manual');
    if (isMeasure(key)) return S.measurements.some((x) => x.day === day && x[key] != null);
    const m = S.health.manual[day];
    return !!(m && m[key] != null);
  }

  /* ---------------------------------------------------------------- writing workouts */
  function canWrite() { try { const b = bridge(); return !!(b && b.hcCanWrite && b.hcCanWrite()); } catch (e) { return false; } }
  const recordId = (day) => `gradient-${B().dayStr(day)}`;
  // A finished workout as a Health Connect exercise session, or null if it can't be one.
  function workoutRecord(S, l) {
    if (!l || l.type !== 'workout' || !l.checkedIn || !l.startedAt || !l.endedAt) return null;
    const start = l.startedAt, end = Math.max(l.endedAt, start + 60000);
    if (end - start > 4 * 3600000) return null; // checked in much later: no honest end time
    return { id: recordId(l.day), start, end, version: Math.round(l.endedAt / 1000), type: 'strength_training', title: l.title || 'Workout', notes: `${l.doneSets || 0} of ${l.planned || 0} sets in Gradient Health` };
  }
  const pendingWrites = {};
  const writeListeners = [];
  hooks.onHealthWrite = (res) => {
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { return; } }
    if (!res || !res.id) return;
    const S = pendingWrites[res.id];
    delete pendingWrites[res.id];
    if (S && res.ok) (S.health.written = S.health.written || {})[res.id] = Date.now();
    for (const f of writeListeners) { try { f(res); } catch (e) { /* ignore */ } }
  };
  function onWrite(fn) { writeListeners.push(fn); }
  // Saves one workout if writing is on and allowed. Returns true if it was sent.
  function writeWorkout(S, l) {
    if (S.health.write === false || !canWrite()) return false;
    const rec = workoutRecord(S, l);
    if (!rec) return false;
    try { bridge().hcWriteWorkout(JSON.stringify(rec)); } catch (e) { return false; }
    pendingWrites[rec.id] = S;
    return true;
  }
  // Catches up on recent workouts that were never saved (e.g. writing was just turned on).
  function writeRecent(S, days) {
    const today = B().dayOf(Date.now(), roll(S));
    const done = S.health.written || {};
    let n = 0;
    for (const l of S.log) if (l.type === 'workout' && l.day >= today - (days || 14) && !done[recordId(l.day)] && writeWorkout(S, l)) n++;
    return n;
  }

  /* ---------------------------------------------------------------- writing food */
  // Meals logged here become nutrition records in Health Connect. The record id is the entry's id,
  // so an edit replaces the earlier copy (higher version) and a deleted entry is deleted there too.
  const FOOD_PREFIX = 'gradient-food-';
  function canWriteFood() { try { const b = bridge(); return !!(b && b.hcCanWriteFood && b.hcCanWriteFood()); } catch (e) { return false; } }
  const food = { S: null, busy: false, again: false, pending: 0, sent: {}, timer: null };
  function foodDone(kind, res) {
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { res = null; } }
    const S = food.S;
    if (S && GH.food && res && res.ok) {
      for (const id of res.ids || []) {
        const entry = String(id).slice(FOOD_PREFIX.length);
        if (kind === 'write') GH.food.markWritten(S, entry, true, food.sent[id]);
        else GH.food.markRemoved(S, entry);
      }
    }
    // Entries Health Connect can't take (bad values) aren't sent again and again.
    if (S && GH.food && res && kind === 'write') for (const id of res.failed || []) GH.food.markWritten(S, String(id).slice(FOOD_PREFIX.length), true, food.sent[id]);
    for (const id of ((res && res.ids) || []).concat((res && res.failed) || [])) delete food.sent[id];
    if (S && res && !res.ok) S.food.hcError = String(res.error || 'failed').slice(0, 120);
    else if (S && S.food) delete S.food.hcError;
    food.pending--;
    if (food.pending <= 0) {
      clearTimeout(food.timer);
      food.busy = false;
      if (S && GH.store && GH.store.saveSoon) { try { GH.store.saveSoon(S); } catch (e) { /* ignore */ } }
      if (food.again) { food.again = false; writeFood(S); }
    }
  }
  hooks.onFoodWrite = (res) => foodDone('write', res);
  hooks.onFoodDelete = (res) => foodDone('delete', res);
  // Sends whatever changed since the last write. Returns how many records went out.
  function writeFood(S) {
    if (!S || !GH.food || !GH.food.full(S) || !canWriteFood()) return 0;
    if (food.busy) { food.again = true; return 0; }
    const pw = GH.food.pendingWrites(S);
    const up = pw.upsert.slice(0, 200), rm = pw.remove.slice(0, 200);
    if (!up.length && !rm.length) return 0;
    food.S = S; food.busy = true; food.pending = 0;
    const b = bridge();
    try {
      if (up.length) {
        for (const r of up) food.sent[r.id] = r.v;
        food.pending++;
        b.hcWriteFood(JSON.stringify(up.map((r) => ({ id: r.id, v: r.v, start: r.start, end: r.end, meal: r.meal, name: r.name, kcal: r.kcal, p: r.p, c: r.c, f: r.f, fib: r.fib }))));
      }
      if (rm.length) { food.pending++; b.hcDeleteFood(JSON.stringify(rm.map((r) => r.id))); }
    } catch (e) { food.busy = false; return 0; }
    // No answer in a minute (an old bridge, a stuck call): let the next change try again.
    food.timer = setTimeout(() => { food.busy = false; food.pending = 0; }, 60000);
    return up.length + rm.length;
  }

  // Data types added after 1.1: people who connected earlier are asked once to allow them.
  // Nutrition only counts with calorie tracking on: it's only asked for then.
  const NEW_TYPES = ['heartRate', 'activeKcal', 'distance'];
  const FOOD_TYPES = ['nutrition', 'writeNutrition'];
  function granted() {
    const b = bridge();
    if (!b || !b.hcGranted) return null;
    try { const v = JSON.parse(b.hcGranted() || '[]'); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function missingTypes(S) {
    const g = granted();
    if (!g || !connected(status())) return [];
    const want = NEW_TYPES.concat(GH.food && GH.food.full(S) ? FOOD_TYPES : []);
    return want.filter((t) => !g.includes(t));
  }

  // Light days: a walk from Health Connect ticks itself.
  function afterSync(S, day) {
    const plan = B().todayPlan(S, day);
    if (plan.type === 'light' && !(plan.light && plan.light.walk)) return B().autoWalk(S, day);
    return false;
  }

  GH.health = {
    status, connected, request, onPerms, openSettings, read, sync, syncDays, ingest, rebuild, logManual, removeManual, setFeel, setSleepChip,
    background, setBackground, requestBackground, onBackground, pending, ingestPending, drainPending, clearPending,
    canWrite, workoutRecord, writeWorkout, writeRecent, onWrite, canWriteFood, writeFood, granted, missingTypes, NEW_TYPES,
    addMeasurement, removeMeasurement, measureDue, value, latest, series, stats, baseline, weightOn, activity, activeMinutes, appWorkouts, today, afterSync, prettyType, CHIP_MIN,
    METRICS, MEASURES, SOURCE, unitOf, toDisplay, fromDisplay, format, formatParts, formatDelta, hm, entry, history, latestEntry, rangeStats, versus, setManual, clearManual, hasManual,
  };
})(typeof window !== 'undefined' ? window : globalThis);
