/* Notifications, worked out on the phone (GH.notify): what to send over the next weeks and when,
 * from the plan, what's done, walks and runs, sleep from Health Connect, badges and the settings.
 * Nothing is sent anywhere. Each time the app is left or opened, src/ui/notify.js hands the whole
 * schedule to the Android app (AndroidBridge.notifySchedule), which keeps it and posts each one at
 * its time (android/src/.../Notifier.java). So the schedule always follows what the person just did,
 * and when they stop opening the app, the one laid down at their last visit plays out: the everyday
 * kinds for two days, then a gentle note on day 3 and once a week until day 45, then nothing.
 *
 * plan(S, now, o) is pure: it reads the state, the time it's given and o (what Android has posted
 * lately), and changes nothing. A chunk of its own (GH.lazy('notify')): Today's first frame doesn't
 * need it.
 *
 * The rules:
 * - Kinds, by priority when two fall on one day: badge, workout, sleep, move, comeback. One a day at
 *   most (Android holds to that too), never between 9:30 pm and 8 am.
 * - workout: a planned workout day that isn't done, at the reminder time: 30 minutes before the
 *   person usually starts (the median of the last 4 weeks, kept between 8 am and 8 pm), else 6 pm,
 *   or the time they set. Leaving the app after the workout plans again without it.
 * - move: on a rest or light day, twice a week at most: their own habit when they have one ("You
 *   usually run on Saturdays"), else a walk on a light day.
 * - badge: one earned and not opened yet, two hours after the app is left, or the next morning.
 * - sleep: the morning after a good night. The page isn't running then, so Android decides from
 *   the background sync's read of Health Connect; this says when to look, what counts as good (the
 *   person's own usual and best) and the words, and what to send instead later that day (alt) when
 *   the night isn't one to mention. Only good news.
 * - comeback: 3 days after the app was last opened, then on days 10, 17, 24, 31, 38 and 45, each
 *   worded differently, then nothing until it's opened again.
 * - The everyday kinds (all but comeback) only within 2 days of now: the app was just used. Nothing
 *   more today while a workout is in progress, or once Android has posted one today.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;

  const DAY_MS = 86400000, MIN_MS = 60000, HOUR_MS = 3600000;
  // Priority, highest first: the one of these a day keeps.
  const KINDS = ['badge', 'workout', 'sleep', 'move', 'comeback'];
  // Minutes after midnight.
  const QUIET_FROM = 21 * 60 + 30, QUIET_TO = 8 * 60;
  const EARLIEST = 8 * 60, LATEST = 20 * 60, DEFAULT_TIME = 18 * 60;
  const EVERYDAY_DAYS = 2;
  const COMEBACK_DAYS = [3, 10, 17, 24, 31, 38, 45];
  const MOVE_PER_WEEK = 2;
  // Nothing in the first 15 minutes after the app is left: the person just saw it.
  const LEAD_MS = 15 * MIN_MS;
  // Sleep: a night counts as good from 7 hours (and up to 11: a very long one may be illness).
  const SLEEP_GOOD = 7 * 60, SLEEP_MAX = 11 * 60;
  const ROUTES = { badge: 'badges', workout: 'today', sleep: 'health', move: 'today', comeback: 'today' };
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const round5 = (m) => Math.round(m / 5) * 5;
  const median = (list) => B().median(list);
  // Day numbers are local dates (GH.brain): day d at `min` minutes after its midnight, in local time.
  function local(d, min) {
    const x = new Date(d * DAY_MS);
    return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 0, min).getTime();
  }
  const minuteOf = (ts) => { const x = new Date(ts); return x.getHours() * 60 + x.getMinutes(); };
  const rollOf = (S) => (S && S.profile && S.profile.prefs && num(S.profile.prefs.rollHour) ? S.profile.prefs.rollHour : 4);
  // Notification times are between 8 am and 9:30 pm, where the app's day (which rolls over at the
  // start of the day, 6 am at the latest) is the calendar date.
  const dayAt = (S, ts) => B().dayOf(ts, rollOf(S));
  const quiet = (ts) => { const m = minuteOf(ts); return m >= QUIET_FROM || m < QUIET_TO; };

  /* ---------------------------------------------------------------- settings */
  // The settings as the planner reads them (S.profile.prefs.notify, with brain.js's defaults; store.js
  // fills and checks it).
  function prefs(S) {
    const p = S && S.profile && S.profile.prefs && S.profile.prefs.notify;
    const o = Object.assign(B().defaultProfile().prefs.notify, p && typeof p === 'object' ? p : {});
    o.on = o.on === true;
    for (const k of KINDS) o[k] = o[k] !== false;
    o.time = num(o.time) ? clamp(Math.round(o.time / 15) * 15, EARLIEST, LATEST) : null;
    return o;
  }

  // When the reminders come: the time set in Settings, else 30 minutes before the person usually
  // starts a workout (the median start of the last 4 weeks, three workouts at least), else 6 pm.
  // { min: minutes after midnight, how: 'set' | 'usual' | 'default', usual? }.
  function reminderTime(S, now) {
    const p = prefs(S);
    if (p.time != null) return { min: p.time, how: 'set' };
    const today = dayAt(S, num(now) ? now : Date.now());
    const starts = [];
    for (const l of (S && S.log) || []) if (l && l.type === 'workout' && num(l.startedAt) && num(l.day) && l.day >= today - 28 && l.day <= today) starts.push(minuteOf(l.startedAt));
    if (starts.length < 3) return { min: DEFAULT_TIME, how: 'default' };
    const usual = median(starts);
    return { min: clamp(round5(usual - 30), EARLIEST, LATEST), how: 'usual', usual };
  }

  /* ---------------------------------------------------------------- what the person does */
  // The plan's day d as the Plan tab sees it (GH.planWeek: this week and next).
  function planDay(w, d) {
    if (!w) return null;
    if (d >= w.ws && d < w.ws + 7) return w.days[d - w.ws];
    if (w.next && d >= w.next.ws && d < w.next.ws + 7) return w.next.days[d - w.next.ws];
    return null;
  }
  // A workout day's title and minutes ("Chest, arms and abs", 25), from the session as Today and Plan
  // build it.
  function workoutOf(S, e) {
    let s = null;
    try { s = e.session; } catch (err) { s = null; }
    return { title: (s && s.title) || e.title || 'Workout', min: Math.round((s && s.estimateMin) || S.profile.minutes || 25) };
  }

  // Walks, runs, hikes and rides the person does on the same weekday: the app's own recordings and
  // Health Connect's sessions from other apps, the last 8 weeks. A habit is 3 days or more on that
  // weekday, one of them in the last 3 weeks, and one that can be nudged half an hour ahead within the
  // day (a 7 am run can't: by 8 it's done or skipped). weekday → { type, n, min (when to nudge) }.
  const HC_TYPES = [['run', /run/i], ['walk', /walk/i], ['hike', /hik/i], ['cycle', /cycl|bik/i]];
  const TYPE_ORDER = ['run', 'walk', 'cycle', 'hike'];
  function habits(S, today) {
    const seen = {}; // `${type}:${day}` → start
    const add = (type, start) => {
      if (!TYPE_ORDER.includes(type) || !num(start)) return;
      const d = dayAt(S, start);
      if (d < today - 56 || d > today) return;
      const k = `${type}:${d}`;
      if (!(k in seen)) seen[k] = start;
    };
    for (const a of (S && S.activities) || []) if (a) add(a.type, a.start);
    const days = (S && S.health && S.health.days) || {};
    for (let d = today - 56; d <= today; d++) {
      for (const x of (days[d] && days[d].exercise) || []) {
        if (!x || x.fromApp || !num(x.start)) continue;
        const t = HC_TYPES.find(([, re]) => re.test(String(x.typeName || '')));
        if (t) add(t[0], x.start);
      }
    }
    const by = {};
    for (const [k, start] of Object.entries(seen)) {
      const [type, d] = k.split(':');
      const wd = B().weekday(Number(d));
      const o = (by[`${wd}:${type}`] = by[`${wd}:${type}`] || { type, days: [], starts: [] });
      o.days.push(Number(d));
      o.starts.push(minuteOf(start));
    }
    const out = {};
    for (const [k, o] of Object.entries(by)) {
      const min = round5(median(o.starts) - 30);
      if (o.days.length < 3 || Math.max(...o.days) < today - 21 || min < EARLIEST) continue;
      const wd = Number(k.split(':')[0]);
      const cur = out[wd];
      const better = !cur || o.days.length > cur.n || (o.days.length === cur.n && TYPE_ORDER.indexOf(o.type) < TYPE_ORDER.indexOf(cur.type));
      if (better) out[wd] = { type: o.type, n: o.days.length, min: Math.min(min, LATEST) };
    }
    return out;
  }
  // Moved today already: a walk on the light day, an activity recorded, or the day's steps.
  function movedToday(S, e, today) {
    if (e && e.light && e.light.walk) return true;
    if (((S && S.activities) || []).some((a) => a && num(a.start) && dayAt(S, a.start) === today)) return true;
    const h = S.health && S.health.days && S.health.days[today];
    if (h && num(h.steps) && B().stepsGoal) { try { return h.steps >= B().stepsGoal(S, today).goal; } catch (err) { return false; } }
    return false;
  }

  // Sleep from Health Connect, when there's enough of it to judge a night: 5 nights of the last 14
  // from Health Connect, one of them in the last 3. Its usual (the median of 4 weeks), the usual
  // wake time, and each night's sleep by the day it ended.
  function sleepOf(S, today) {
    const h = (S && S.health) || {}, days = h.days || {}, hc = h.hc || {};
    const vals = [], wakes = [];
    let nights = 0, recent = false;
    for (let d = today - 27; d <= today; d++) {
      const r = days[d];
      if (r && r.sleepMin > 0) vals.push(r.sleepMin);
      if (d <= today - 14) continue;
      if (r && num(r.wake)) wakes.push(minuteOf(r.wake));
      if (hc[d] && hc[d].sleepMin > 0) { nights++; if (d >= today - 2) recent = true; }
    }
    if (nights < 5 || !recent || vals.length < 5) return null;
    return { usual: median(vals), wake: wakes.length >= 3 ? median(wakes) : null, night: (d) => (days[d] && days[d].sleepMin > 0 ? days[d].sleepMin : null) };
  }

  // Badges earned and not opened yet (GH.achievements.unopened where it's there, else unseen), as ids.
  function unopened(S) {
    const A = GH.achievements;
    if (!A || !S) return [];
    const f = typeof A.unopened === 'function' ? A.unopened : typeof A.unseen === 'function' ? A.unseen : null;
    let list = [];
    try { list = (f && f(S)) || []; } catch (err) { list = []; }
    return (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter((x) => typeof x === 'string' && x);
  }

  /* ---------------------------------------------------------------- the words */
  // Plain and short: titles under 40 characters, the rest under 100. Never guilt, never "you missed".
  function fit(s, n) {
    if (s.length <= n) return s;
    const cut = s.slice(0, n - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 12)).replace(/[\s,]+$/, '')}…`;
  }
  const WORKOUT_LINES = ['Today\'s workout, ready when you are.', 'It\'s on your plan for today. Start whenever suits you.', 'Your session for today is set up and ready.'];
  function workoutWords(S, w, d, first) {
    return { title: `${fit(w.title, 30)}, ${w.min} min`, body: first ? 'Your first workout, ready when you are.' : WORKOUT_LINES[((d % 3) + 3) % 3] };
  }
  const VERB = { run: 'run', walk: 'walk', hike: 'hike', cycle: 'ride' };
  function moveWords(S, e, d, habit) {
    const wd = WEEKDAYS[B().weekday(d)];
    const kind = e ? e.kind : null;
    if (habit) {
      const verb = VERB[habit.type];
      const tail = kind === 'light' ? ', and it\'s a light day.' : kind === 'rest' ? ', and your plan has today off.' : '.';
      return { title: `${wd} ${verb}?`, body: `You usually ${verb} on ${wd}s${tail}` };
    }
    if (kind === 'light') return { title: 'A walk today?', body: `It's a light day: a ${B().programFor(S.profile).walkMin} minute walk and a few minutes of mobility.` };
    return { title: 'A walk today?', body: 'Your plan has today off. A short walk outside still feels good.' };
  }
  const badgeWords = (n) => (n > 1
    ? { title: `You earned ${n} new badges`, body: 'They\'re waiting for you. Tap to open them.' }
    : { title: 'You earned a new badge', body: 'It\'s waiting for you. Tap to open it.' });
  // Android fills in {t}, the night's sleep ("7 h 52 m").
  const SLEEP_TITLE = 'A good night\'s sleep';
  // Day 3, then weekly to day 45: each says something new, none of it about what wasn't done.
  function comebackWords(S, i) {
    const min = S.profile.minutes || 20;
    const walk = B().programFor(S.profile).walkMin || 20;
    const lines = S.profile.workouts === false ? [
      ['How\'s your week going?', 'A quick check-in takes a minute.'],
      ['A walk counts', 'A short walk outside is an easy way to start again.'],
      ['No catching up needed', 'Pick up wherever suits you.'],
      ['Small steps count', 'One short walk this week is plenty.'],
      ['Still here for you', 'Everything you logged is on this phone, where you left it.'],
      ['Fresh start, any day', 'Whenever you\'re ready, today is a fine day to start.'],
      ['We\'ll leave you be', 'This is the last nudge for now.'],
    ] : [
      ['Your plan\'s ready when you are', `${min} minutes keeps it going.`],
      ['Fancy a short one?', 'Even 15 minutes counts, and your plan eases you back in.'],
      ['A walk counts too', `Not up for a workout? A ${walk} minute walk is a good way back.`],
      ['No catching up needed', 'Your plan adjusts to where you are now. Just start with today.'],
      ['One workout is a good week', 'Start small. One session this week is plenty.'],
      ['Fresh start, any day', 'Open the app and today\'s workout fits the time you have.'],
      ['We\'ll leave you be', 'This is the last nudge for now. Your plan\'s here whenever you want it.'],
    ];
    const [title, body] = lines[Math.min(i, lines.length - 1)];
    return { title, body };
  }

  /* ---------------------------------------------------------------- the plan */
  // The schedule: [{ id, at, kind, title, body, route, until?, sleep?, alt? }], soonest first. A sleep
  // item is a question for the morning (until: how long to wait for the night's data; sleep: { from,
  // tiers: [{ min, max, best?, title, body }] }), with alt: what to send that day if it says nothing.
  // o: { sent: [{ id, at }] (posted lately), lastPosted (ms), sleepSync (false: no background reads,
  // so no night can be judged in the morning) }.
  function plan(S, now, o) {
    const opts = o || {};
    if (!S || !S.profile || !S.profile.onboarded || !GH.brain) return [];
    const p = prefs(S);
    if (!p.on) return [];
    const t0 = num(now) ? now : Date.now();
    const today = dayAt(S, t0);
    const sent = Array.isArray(opts.sent) ? opts.sent.filter((x) => x && typeof x.id === 'string') : [];
    const sentIds = new Set(sent.map((x) => x.id));
    const workouts = S.profile.workouts !== false;
    // Today is full once Android has posted one, and while a workout is in progress.
    const full = (num(opts.lastPosted) && dayAt(S, opts.lastPosted) === today) || !!(S.active && S.active.day === today);
    const ok = (at, d) => at >= t0 + LEAD_MS && !quiet(at) && dayAt(S, at) === d && !(full && d === today);
    const remind = reminderTime(S, t0).min;
    let week = null;
    if (workouts && GH.planWeek) { try { week = GH.planWeek(S, today); } catch (err) { week = null; } }
    const done = (S.log || []).some((l) => l && l.type === 'workout' && B().isDone(l));
    const habit = p.move ? habits(S, today) : {};
    const sleep = p.sleep && opts.sleepSync !== false ? sleepOf(S, today) : null;
    // Move nudges this week so far (posted) and planned below: twice a week at most.
    const moves = {};
    for (const x of sent) if (x.id.startsWith('move:') && num(x.at)) { const ws = B().weekStart(dayAt(S, x.at)); moves[ws] = (moves[ws] || 0) + 1; }

    const byDay = {}; // day → candidates
    const add = (d, item) => { if (!sentIds.has(item.id)) (byDay[d] = byDay[d] || []).push(item); };
    const make = (kind, id, at, words) => Object.assign({ id, at, kind }, words, { route: ROUTES[kind] });

    // A badge waiting to be opened: two hours after the app is left, or the next morning.
    const ids = p.badge ? unopened(S) : [];
    if (ids.length) {
      let at = Math.ceil((t0 + 2 * HOUR_MS) / (5 * MIN_MS)) * 5 * MIN_MS;
      const m = minuteOf(at), cd = B().dayOf(at, 0);
      if (m >= QUIET_FROM - 30) at = local(cd + 1, 9 * 60);
      else if (m < 8 * 60 + 30) at = local(cd, 9 * 60);
      if (full && dayAt(S, at) === today) at = local(today + 1, 9 * 60);
      const d = dayAt(S, at);
      if (d - today <= EVERYDAY_DAYS && ok(at, d)) add(d, make('badge', `badge:${ids[ids.length - 1]}`, at, badgeWords(ids.length)));
    }

    for (let d = today; d <= today + EVERYDAY_DAYS; d++) {
      const e = planDay(week, d);
      const kind = e ? e.kind : null;
      // The day's workout, at the reminder time.
      if (p.workout && workouts && (kind === 'today' || kind === 'workout')) {
        const at = local(d, remind);
        if (ok(at, d)) add(d, make('workout', `workout:${d}`, at, workoutWords(S, workoutOf(S, e), d, !done)));
      }
      // The morning after a good night, as Android finds it: from 45 minutes after the usual wake time
      // (8:30 to 10:30), until two and a half hours later.
      if (sleep && kind !== 'today' && kind !== 'workout') {
        const at = local(d, clamp(round5((sleep.wake != null ? sleep.wake : 7 * 60) + 45), 8 * 60 + 30, 10 * 60 + 30));
        const tiers = [];
        const before = [];
        for (let x = d - 6; x < d; x++) if (x <= today && sleep.night(x) != null) before.push(sleep.night(x));
        if (before.length >= 3) tiers.push({ min: Math.max(SLEEP_GOOD, Math.round(Math.max(...before)) + 1), max: SLEEP_MAX, best: true, title: SLEEP_TITLE, body: '{t} of sleep: your best this week.' });
        tiers.push({ min: Math.max(SLEEP_GOOD, Math.round(sleep.usual) + 30), max: SLEEP_MAX, title: SLEEP_TITLE, body: '{t} of sleep, more than you usually get.' });
        // A bar above 11 hours (a week with a very long night in it, or someone who usually sleeps
        // over ten and a half) can't be reached: that one isn't asked.
        const reach = tiers.filter((t) => t.min <= t.max);
        if (reach.length && ok(at, d)) {
          const item = make('sleep', `sleep:${d}`, at, { title: SLEEP_TITLE, body: '' });
          item.until = Math.min(at + 150 * MIN_MS, local(d, 13 * 60));
          item.sleep = { from: local(d, rollOf(S) * 60), tiers: reach };
          add(d, item);
        }
      }
      // A walk, or the person's own run, on a rest or light day (with workouts off, only their habit).
      const h = habit[B().weekday(d)];
      const restDay = workouts ? kind === 'light' || kind === 'rest' : !!h;
      if (p.move && restDay && !(d === today && movedToday(S, e, today))) {
        const at = local(d, h ? h.min : remind);
        if (ok(at, d)) add(d, make('move', `move:${d}`, at, moveWords(S, e, d, h)));
      }
    }

    // After a few days away: day 3, then once a week to day 45.
    if (p.comeback) {
      COMEBACK_DAYS.forEach((n, i) => {
        const d = today + n;
        const at = local(d, remind);
        if (ok(at, d)) add(d, make('comeback', `comeback:${today}:${i + 1}`, at, comebackWords(S, i)));
      });
    }

    // One a day: the first kind in KINDS, a move nudge only while its week has room for one. A sleep
    // question keeps the next one that comes after it as its alt, which Android sends instead when
    // the night isn't one to mention (counted as used: twice a week stays twice at most).
    const weekOf = (x) => B().weekStart(dayAt(S, x.at));
    const room = (x) => x.kind !== 'move' || (moves[weekOf(x)] || 0) < MOVE_PER_WEEK;
    const use = (x) => { if (x.kind === 'move') moves[weekOf(x)] = (moves[weekOf(x)] || 0) + 1; return x; };
    const out = [];
    for (const d of Object.keys(byDay).map(Number).sort((a, b) => a - b)) {
      const list = byDay[d].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.at - b.at);
      const top = list.find(room);
      if (!top) continue;
      use(top);
      if (top.kind === 'sleep') {
        const alt = list.find((x) => x !== top && x.at >= top.until + 30 * MIN_MS && room(x));
        if (alt) top.alt = use(alt);
      }
      out.push(top);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  GH.notify = { KINDS, QUIET_FROM, QUIET_TO, EARLIEST, LATEST, DEFAULT_TIME, EVERYDAY_DAYS, COMEBACK_DAYS, MOVE_PER_WEEK, prefs, reminderTime, habits, plan, local };
})(typeof window !== 'undefined' ? window : globalThis);
