/* The week as the Plan tab shows it. GH.planWeek(S, day) returns this week's seven days (what each
 * holds, whether it's done, missed or can still move, and to which days), next week's preview and
 * the week's sets by muscle. Plain data built only from GH.brain's public functions; nothing here
 * touches the page or changes the state.
 *
 * Cached: the answer is kept until something it reads changes. Each call takes a fingerprint of those
 * parts of the state (much cheaper than replaying the calendar and building every session), so a
 * re-render that only changes the selected day costs next to nothing. Sessions, minutes and the
 * sets by muscle are worked out the first time they're read. Treat the result as read-only.
 *
 * Day kinds: 'before' (before the plan started), 'done' (a workout that counted), 'today' (today's
 * workout, still to do), 'workout' (a later one), 'light', 'rest', 'missed' (streak reset) and
 * 'frozen' (missed, a freeze kept the streak). A light or rest day that's today is 'light' / 'rest'
 * with isToday set.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // A value worked out the first time it's read, then kept on the object.
  function lazy(o, key, fn) {
    Object.defineProperty(o, key, {
      enumerable: true, configurable: true,
      get() { const v = fn(); Object.defineProperty(o, key, { value: v, enumerable: true, configurable: true, writable: false }); return v; },
    });
  }
  const uniq = (list) => list.filter((x, i) => x != null && list.indexOf(x) === i);

  function dateParts(d) {
    const b = B();
    const w = b.weekday(d);
    return { day: d, wd: WD[w], wdLong: WD_LONG[w], letter: WD[w][0], num: new Date(d * b.DAY_MS).getUTCDate(), date: b.fmtDay(d), short: b.fmtDay(d, false) };
  }

  // A saved workout, as the Plan tab tells it: sets done, minutes, how it felt and each exercise.
  function logSummary(l) {
    const M = GH.moves;
    const items = (l.items || []).filter((it) => it && it.sets && it.sets.length).map((it) => {
      const bySet = new Map();
      for (const x of it.sets) { const prev = bySet.get(x.set); if (prev == null || x.amount > prev) bySet.set(x.set, x.amount); }
      const loads = it.sets.map((x) => x.load).filter((x) => x != null && isFinite(x));
      const m = M && M.MOVES ? M.MOVES[it.moveId] : null;
      return {
        moveId: it.moveId, name: m ? m.name : String(it.moveId || ''), group: it.group || (m && m.group) || null, extra: it.kind === 'extra',
        sets: bySet.size, amounts: Array.from(bySet.values()), timed: !!it.timed, uni: !!it.uni,
        load: loads.length ? Math.max.apply(null, loads) : null, outcome: it.outcome || null,
      };
    });
    return {
      day: l.day, title: l.title || '', doneSets: l.doneSets || 0, planned: l.planned || 0, pct: l.pct || 0, counted: B().isDone(l),
      minutes: l.startedAt && l.endedAt && l.endedAt > l.startedAt ? Math.max(1, Math.round((l.endedAt - l.startedAt) / 60000)) : null,
      rating: (l.checkin && l.checkin.rating) || null, short: !!l.short, items, groups: uniq(items.filter((x) => !x.extra).map((x) => x.group)),
    };
  }

  function activeSummary(A) {
    const sets = (A.steps || []).filter((x) => x.kind === 'set');
    return { done: (A.steps || []).slice(0, A.idx).filter((x) => x.kind === 'set').length, total: sets.length, title: (A.session && A.session.title) || '' };
  }

  function sessionFields(e, build) {
    if (build) lazy(e, 'session', build); else e.session = null;
    lazy(e, 'groups', () => (e.session ? (e.session.groups || []).slice() : e.log ? e.log.groups.slice() : []));
    lazy(e, 'estimateMin', () => (e.session ? e.session.estimateMin : null));
  }

  function compute(S, day) {
    const b = B();
    const p = S.profile;
    const start = p.startDay;
    const cal = b.calendar(S, day);
    const ws = b.weekStart(day);
    const week = cal.weeks[ws] || null;
    const sessions = week ? week.sessions : [];
    const live = sessions.filter((s) => !s.dropped && s.day != null);
    const at = (d) => live.find((s) => s.day === d) || null;
    const plan = b.todayPlan(S, day, cal);
    const A = S.active && S.active.session ? S.active : null;
    const prog = b.programFor(p);
    // Where a workout can go: this week, from today on, a day with nothing planned or done on it.
    const free = [];
    for (let d = Math.max(day, ws, start == null ? day : start); d < ws + 7; d++) if (!at(d) && !(A && A.day === d)) free.push(d);
    const moves = (S.events || []).filter((e) => e && e.type === 'move' && b.weekStart(e.from) === ws);
    const days = [];
    for (let d = ws; d < ws + 7; d++) {
      const info = cal.days[d] || null;
      const s = at(d);
      const logs = S.log.filter((l) => l.type === 'workout' && l.day === d);
      const doneLog = logs.find((l) => b.isDone(l)) || null;
      const lastLog = doneLog || logs[logs.length - 1] || null;
      let kind;
      if (start == null || d < start) kind = 'before';
      else if (doneLog) kind = 'done';
      else if (info && info.missed) kind = info.frozen ? 'frozen' : 'missed';
      else if (s) kind = d < day ? 'missed' : d === day ? 'today' : 'workout';
      else kind = (info && info.planned === 'rest') || p.lightDays === false ? 'rest' : 'light';
      const e = dateParts(d);
      e.isToday = d === day;
      e.isPast = d < day;
      e.preview = false;
      e.kind = kind;
      e.tpl = s ? s.tpl : doneLog && doneLog.tpl != null ? doneLog.tpl : null;
      e.units = s ? s.units.slice() : [];
      e.title = kind === 'done' ? doneLog.title || b.templateTitle(e.units) : s ? s.title || b.templateTitle(s.units)
        : kind === 'light' ? 'Light day' : kind === 'rest' ? 'Rest day' : kind === 'before' ? 'Before you started' : 'Missed';
      e.active = A && A.day === d ? activeSummary(A) : null;
      e.log = lastLog && kind !== 'before' ? logSummary(lastLog) : null;
      e.light = null;
      if (kind === 'light' || kind === 'rest') {
        const l = S.log.find((x) => x.type === 'light' && x.day === d);
        e.light = { walk: !!(l && l.walk), mobility: !!(l && l.mobility), walkSrc: (l && l.walkSrc) || null, walkMin: prog.walkMin };
        e.light.done = e.light.walk && e.light.mobility;
      }
      e.missed = kind === 'missed' || kind === 'frozen' ? { frozen: kind === 'frozen', broken: !!(info && info.broken) } : null;
      const mv = s && kind !== 'done' ? moves.filter((m) => m.to === d && m.from !== d).pop() : null;
      e.movedFrom = mv ? mv.from : null;
      e.moveTo = (kind === 'today' || kind === 'workout') && !e.active ? free.filter((x) => x !== d) : [];
      e.canMove = e.moveTo.length > 0;
      // The next workout, when today is a light or rest day: it can be trained today instead.
      e.canTrainToday = !A && (plan.type === 'light' || plan.type === 'rest') && !!plan.next && plan.next.day === d;
      // Today's session as Today shows it (with readiness); later ones without.
      sessionFields(e, kind === 'today' || kind === 'workout' ? () => (e.active ? A.session : b.buildSession(S, d, s.tpl, { cal, noReadiness: d !== day })) : null);
      days.push(e);
    }

    // Next week, from the settings in force then (a change of days made this week starts there).
    const nws = ws + 7;
    const set = b.settingsAt(S, nws);
    const cur = b.settingsAt(S, ws);
    // The split the engine will use that week (it depends on more than the days: time, how simple
    // sessions are, the person's tweaks), with 1.5's for weeks before the new engine took over.
    const tpl = b.templateOf ? b.templateOf(S, nws, set) : b.templateFor(Object.assign({}, p, { days: set.days, weekdays: set.weekdays }), b.programFor(Object.assign({}, p, { days: set.days })));
    // A custom plan in force next week shapes it instead (src/customplan.js).
    const custom = GH.customPlan ? GH.customPlan.weekSessions(S, nws, tpl) : null;
    const slot = (d) => {
      if (!custom) return tpl.find((x) => x.offset === b.weekday(d)) || null;
      const x = custom.find((c) => c.day === d);
      return x ? { idx: x.tpl, units: x.units, title: x.title } : null;
    };
    const nextDays = [];
    for (let d = nws; d < nws + 7; d++) {
      const t = slot(d);
      const e = dateParts(d);
      e.isToday = false; e.isPast = false; e.preview = true;
      e.kind = t ? 'workout' : p.lightDays === false ? 'rest' : 'light';
      e.tpl = t ? t.idx : null;
      e.units = t ? t.units.slice() : [];
      e.title = t ? t.title || b.templateTitle(t.units) : e.kind === 'light' ? 'Light day' : 'Rest day';
      e.active = null; e.log = null; e.missed = null; e.movedFrom = null; e.moveTo = []; e.canMove = false; e.canTrainToday = false;
      e.light = e.kind === 'light' ? { walk: false, mobility: false, walkSrc: null, walkMin: prog.walkMin, done: false } : null;
      sessionFields(e, t ? () => b.buildSession(S, d, t.idx, { cal, noReadiness: true }) : null);
      nextDays.push(e);
    }
    const norm = (w) => (Array.isArray(w) && w.length ? w.slice().sort((x, y) => x - y).join() : '');

    const ph = (week && week.phase) || { deload: false, onramp: false, idle: false, mult: 1 };
    const key = ph.deload ? 'deload' : ph.onramp ? (ph.idle ? 'comeback' : 'onramp') : 'full';
    const trainToday = !A && (plan.type === 'light' || plan.type === 'rest') && plan.next ? { from: plan.next.day, title: plan.next.title || b.templateTitle(plan.next.units) } : null;
    const out = {
      day, ws, last: ws + 6,
      trainingWeek: week ? week.trainingWeek : 1,
      phase: { key, deload: !!ph.deload, onramp: !!ph.onramp, idle: !!ph.idle, mult: ph.mult || 1, pct: Math.round((ph.mult || 1) * 100), fullFrom: key === 'onramp' ? prog.onramp.weeks + 1 : null },
      planned: live.length,
      done: live.filter((s) => s.done).length,
      dropped: sessions.filter((s) => s.dropped).length,
      freezeUsed: !!(week && week.freezeUsed),
      streak: Object.assign({}, cal.streak),
      notices: cal.notices.filter((n) => n.day >= ws && n.day < ws + 7).map((n) => Object.assign({}, n)),
      free, trainToday, days,
      next: {
        ws: nws, last: nws + 6, days: nextDays,
        workouts: nextDays.filter((x) => x.kind === 'workout').length,
        newSchedule: set.days !== cur.days || norm(set.weekdays) !== norm(cur.weekdays),
      },
    };
    out.allDone = out.planned > 0 && out.done >= out.planned;
    lazy(out, 'muscles', () => {
      const w = b.weeklySets(S, day);
      return b.GROUPS.filter((g) => w[g] && w[g].target > 0).map((g) => ({ group: g, name: b.GROUP_NAME[g] || g, done: w[g].done, planned: w[g].planned, target: w[g].target }));
    });
    return out;
  }

  /* ---------------------------------------------------------------- cache */
  // Everything the calendar and the sessions read, cheaply. Unknown top-level fields are included
  // as they are, so a new setting still refreshes the plan; the long logs are skipped or cut down to
  // what matters here. Outdoor activities reach the plan only through the health days (today's and
  // yesterday's are in the stamp), and badges never do, so neither is stringified on every render.
  // Nor are the plans the optimizer keeps in the state (planCache), which come from the rest.
  const SKIP = new Set(['log', 'health', 'feel', 'sleepChip', 'active', 'ai', 'seen', 'weights', 'measurements', 'food', 'protein', 'pendingLines', 'insightsShown', 'insightsDismissed', 'coachDismissed', 'celebrated', 'createdAt', 'updatedAt', 'activities', 'actLive', 'achievements', 'planCache']);
  const js = (v) => (v === undefined ? '' : JSON.stringify(v));
  function stamp(S, day) {
    const out = [day];
    for (const k of Object.keys(S)) if (!SKIP.has(k)) out.push(k, js(S[k]));
    let lg = '';
    for (const l of S.log || []) lg += `${l.type}.${l.day}.${l.checkedIn ? 1 : 0}.${l.pct == null ? '' : l.pct}.${l.walk ? 1 : 0}${l.mobility ? 1 : 0}.${l.walkSrc || ''}.${l.endedAt || ''};`;
    out.push(lg);
    const h = S.health || {};
    const hd = h.days || {};
    out.push(h.lastSync || '', js(hd[day]), js(hd[day - 1]), js((S.feel || {})[day]), js((S.sleepChip || {})[day]));
    const a = S.active;
    out.push(a ? `${a.day}.${a.idx}.${a.steps ? a.steps.length : 0}.${a.startedAt || ''}` : '');
    return out.join('\u0001');
  }

  let memo = new WeakMap(); // S → { key, value }
  const stats = { hits: 0, misses: 0 };
  function planWeek(S, day) {
    if (!S || !S.profile || !GH.brain) return null;
    const key = stamp(S, day);
    const m = memo.get(S);
    if (m && m.key === key) { stats.hits++; return m.value; }
    stats.misses++;
    const value = compute(S, day);
    memo.set(S, { key, value });
    return value;
  }
  planWeek.clear = () => { memo = new WeakMap(); };
  planWeek.stats = stats;
  GH.planWeek = planWeek;
})(typeof window !== 'undefined' ? window : globalThis);
