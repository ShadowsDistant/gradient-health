/* Notifications, the page's side (the planner is src/notify.js, a part that loads when it's needed):
 * - the hand-off: each time the app is left (the page hidden, or Android's pause) and each time it's
 *   opened, the whole schedule goes to the Android app (AndroidBridge.notifySchedule), which keeps it
 *   in place of the last one and posts each item at its time (Notifier.java);
 * - on for someone new: set-up turns them on as it ends (U.notifySetupAsk, U.notifySetupDone), with
 *   the permission Android 13 and newer asks for asked then, once; otherwise it's asked only when
 *   someone turns notifications on;
 * - a tapped notification opens its screen (window.__gh.onNotifyTap while the app runs, or
 *   AndroidBridge.notifyTap() for the one the app was started from, as plan links do);
 * - Settings' Notifications rows (U.notifyRows) and Today's one-time card that asks (U.notifyCard),
 *   for someone with them off who hasn't answered it (set-up answers it for someone new).
 * In a plain browser there's nothing to post with: Settings says they're in the Android app.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const doc = G.document;
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const B = () => GH.brain;
  const P = () => GH.platform || null;
  // The Android app (any version with notifications), not a plain browser.
  const can = () => { const b = bridge(); return !!(b && typeof b.notifySchedule === 'function'); };
  const parse = (v) => { if (v && typeof v === 'object') return v; try { const o = JSON.parse(v || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };

  // The settings, made whole (store.js fills them on load; a state made some other way may lack them).
  function prefs(S) {
    const pr = S.profile.prefs || (S.profile.prefs = {});
    if (!pr.notify || typeof pr.notify !== 'object') pr.notify = B().defaultProfile().prefs.notify;
    return pr.notify;
  }

  /* ---------------------------------------------------------------- what Android says */
  // { permission: 'granted' | 'ask' (Android can still ask) | 'denied' (only its settings can allow
  // it now), blocked: [kinds switched off in Android's settings], lastPosted, sent: [{ id, at }],
  // scheduled }.
  const NONE = { permission: 'ask', blocked: [], lastPosted: null, sent: [], scheduled: 0 };
  function state() {
    const b = bridge();
    let v = null;
    try { v = b && typeof b.notifyState === 'function' ? b.notifyState() : null; } catch (e) { v = null; }
    return Object.assign({}, NONE, parse(v) || {});
  }

  /* ---------------------------------------------------------------- the hand-off */
  // The schedule for now, handed over in place of the last one. When notifications are off (or the
  // person isn't set up) it's empty, which clears Android's. `why`: 'open' (the app came to the front:
  // what's showing in the shade can go, the person is here), 'leave' or 'settings'.
  let leftAt = 0;
  function sync(why) {
    if (!can()) return;
    const S = U.S;
    const p = S && S.profile && S.profile.onboarded ? prefs(S) : null;
    const on = !!(p && p.on);
    if (on && !GH.notify) { if (GH.lazy) GH.lazy('notify').then(() => sync(why), () => {}); return; }
    // Leaving the app is heard twice, as Android's pause and as the page hidden: planned once.
    if (why === 'leave') {
      if (Date.now() - leftAt < 3000) return;
      leftAt = Date.now();
    }
    let items = [];
    if (on) {
      const st = state();
      const bg = GH.health && GH.health.background ? GH.health.background() : null;
      try { items = GH.notify.plan(S, Date.now(), { sent: st.sent, lastPosted: st.lastPosted, sleepSync: !!(bg && bg.supported && bg.granted && bg.on) }); } catch (e) { if (G.console) G.console.error(e); return; }
    }
    const sched = { on, items };
    if (why === 'open') sched.opened = true;
    try { bridge().notifySchedule(JSON.stringify(sched)); } catch (e) { /* the next one goes through */ }
  }
  // Opening plans once the page is quiet (the first frame and a touch come first), and not at all if
  // the app went away meanwhile (leaving planned already).
  let openTimer = 0;
  function opened() {
    if (openTimer || !can()) return;
    openTimer = setTimeout(() => {
      openTimer = 0;
      const run = () => { if (!doc || doc.visibilityState !== 'hidden') sync('open'); };
      if (U.whenQuiet) U.whenQuiet(run); else run();
    }, 1500);
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') sync('leave'); else opened(); });
  if (P()) {
    P().on('pause', () => sync('leave'));
    // Back from Android's settings (a permission, a channel): Settings shows what changed.
    P().on('resume', () => { opened(); if (U.route && U.route.view === 'settings' && U.renderSoon) U.renderSoon(); });
  }

  /* ---------------------------------------------------------------- a tapped notification */
  // Its screen, once the app is up: one tapped while it runs comes through onNotifyTap, the one it
  // was started from through notifyTap() (and onNotifyTap, whichever comes first).
  let booted = false, tapWaiting = null;
  function openTap(t) {
    if (!t || typeof t.route !== 'string') return;
    if (!booted) { tapWaiting = t; return; }
    // (During set-up there's no screen to open; a schedule from before set-up is gone by now.)
    if (U.S && U.S.profile.onboarded && P() && P().emit) P().emit('route', t.route);
  }
  hooks.onNotifyTap = (t) => { openTap(parse(t)); return true; };
  const prevBoot = U.afterBoot;
  U.afterBoot = () => {
    if (prevBoot) prevBoot();
    booted = true;
    const b = bridge();
    if (b && typeof b.notifyTap === 'function') { try { const t = parse(b.notifyTap()); if (t) tapWaiting = t; } catch (e) { /* none */ } }
    if (tapWaiting) { const t = tapWaiting; tapWaiting = null; setTimeout(() => openTap(t), 300); }
    opened();
  };

  /* ---------------------------------------------------------------- the permission */
  // Android 13 and newer ask once (the answer comes to onNotifyPermission); after a no, only Android's
  // settings can allow them.
  let permWait = [];
  hooks.onNotifyPermission = (v) => {
    const st = Object.assign({}, NONE, parse(v) || {});
    const w = permWait;
    permWait = [];
    for (const f of w) f(st);
    if (U.route && U.route.view === 'settings' && U.render) U.render();
  };
  function askPermission() {
    const b = bridge();
    const st = state();
    if (st.permission === 'granted' || !b || typeof b.notifyRequest !== 'function') return Promise.resolve(st);
    return new Promise((resolve) => {
      let settled = false;
      const done = (s) => { if (!settled) { settled = true; clearTimeout(timer); resolve(s); } };
      const timer = setTimeout(() => done(state()), 180000);
      permWait.push(done);
      try { b.notifyRequest(); } catch (e) { done(state()); }
    });
  }
  function openSettings() { try { const b = bridge(); if (b && b.notifyOpenSettings) b.notifyOpenSettings(); } catch (e) { /* ignore */ } }
  U.act.notifyOpenSettings = () => openSettings();
  const blockedToast = () => U.toast('Notifications are off for Gradient Health', 'caution', 'Allow them in Android\'s settings to get reminders.', { label: 'Open', onClick: openSettings });

  // When workout reminders come, in words ("5:30 pm").
  const clock = (min) => U.fmtClock(new Date(2000, 0, 1, 0, min).getTime());
  // A time picked on the slider, to its quarter hour (minutes after midnight).
  const quarter = (v) => Math.round(Number(v) / 15) * 15;
  const when = (S) => (GH.notify ? clock(GH.notify.reminderTime(S, Date.now()).min) : null);

  // Turning them on (Settings' switch, Today's card): the setting, Android's permission, then the
  // schedule.
  async function turnOn() {
    const S = U.S;
    prefs(S).on = true;
    U.markSeen('notifyAsk');
    U.save();
    const [st] = await Promise.all([askPermission(), GH.lazy ? GH.lazy('notify').catch(() => null) : null]);
    sync('settings');
    if (st.permission !== 'granted') { blockedToast(); return st; }
    const at = S.profile.workouts !== false && prefs(S).workout ? when(S) : null;
    U.toast('Notifications are on', 'positive', `${at ? `Workout days at ${at}. ` : ''}One a day at most, never at night.`);
    return st;
  }

  /* ---------------------------------------------------------------- set-up */
  // Someone new gets them on as set-up ends (src/ui/onboarding.js). Android 13 and newer asks for the
  // permission then, once, as they tap the last button with their plan still showing, and set-up goes
  // once it's answered; a no leaves them off with nothing more said (Settings shows them off and
  // Today's card doesn't come). Older Androids allow them already. Resolves with whether they're on;
  // in a plain browser there's nothing to turn on.
  U.notifySetupAsk = () => {
    if (!can()) return Promise.resolve(false);
    return askPermission().then((st) => st.permission === 'granted', () => false);
  };
  // What set-up says above its last button, so the ask that follows makes sense ('' in a browser).
  U.notifySetupHint = (workouts) => (can()
    ? `${U.icon('bell', 'sm')}<span>${workouts ? 'A reminder on workout days, and a walk now and then.' : 'A nudge now and then.'} One a day at most, never at night.</span>`
    : '');
  // The new state, as set-up saves it: the setting, and the card answered either way.
  U.notifySetupDone = (S, on) => {
    if (!can() || !S) return;
    prefs(S).on = !!on;
    S.seen = S.seen || {};
    S.seen.notifyAsk = true;
  };
  // Then Android gets the first schedule.
  const prevOnboarding = U.afterOnboarding;
  U.afterOnboarding = () => {
    if (prevOnboarding) prevOnboarding();
    if (U.S && prefs(U.S).on) sync('settings');
  };

  /* ---------------------------------------------------------------- Today's card, once */
  // For people updating and for new people after their first workout (once the tour has been, so it
  // isn't one more thing on that first day): asked once, and never again whatever the answer.
  U.notifyCard = (S, day) => {
    if (!can() || !S || S.active || S.profile.workouts === false || U.seen('notifyAsk') || prefs(S).on) return '';
    if (!(S.log || []).some((l) => l && l.type === 'workout' && B().isDone(l))) return '';
    if (!U.seen('tour') && day - (S.profile.startDay != null ? S.profile.startDay : day) <= 14) return '';
    return `<div class="card nf-ask" data-key="notify-ask">
      <div class="hc-invite-row"><span class="rf-list-icon" data-tone="amber">${U.icon('bell')}</span>
        <span class="hc-invite-text"><span class="t-headline">Want a nudge on workout days?</span><span class="t-footnote rf-muted">The day's workout, and a walk now and then. One a day at most, never at night.</span></span></div>
      <div class="hc-invite-btns"><button type="button" class="rf-btn" data-variant="filled" data-act="notifyAskYes">Turn on</button><button type="button" class="rf-btn" data-variant="plain" data-act="notifyAskNo">Not now</button></div>
    </div>`;
  };
  // The card folds away as its answer is made (src/ui/motion.js), and the render after finds it gone.
  const fold = (el) => {
    const card = el && el.closest ? el.closest('.nf-ask') : null;
    const go = card && U.motion && U.motion.collapse ? U.motion.collapse(card) : Promise.resolve();
    return go.then(() => { if (U.render) U.render(); });
  };
  U.act.notifyAskYes = async (el) => {
    U.markSeen('notifyAsk');
    await turnOn();
    fold(el);
  };
  U.act.notifyAskNo = (el) => {
    U.markSeen('notifyAsk');
    U.haptic('dismiss');
    fold(el);
  };

  /* ---------------------------------------------------------------- Settings */
  const KIND_ROWS = [
    ['workout', 'Workout days', 'Today\'s workout, at your reminder time', 'reminder workout plan'],
    ['move', 'Walks and runs', 'On a rest day, twice a week at most', 'walk run ride hike rest day'],
    ['badge', 'New badges', 'When one is waiting to be opened', 'badge achievement award'],
    ['sleep', 'Good nights', 'The morning after a good night\'s sleep', 'sleep night health connect'],
    ['comeback', 'After a few days away', 'A gentle note on day 3, then once a week for six weeks', 'away break comeback'],
  ];
  const kw = (html, words) => html.replace(/^(\s*<(?:li|label)\b)/, `$1 data-keywords="${U.esc(words)}"`);
  // The rows under Settings' Notifications header (src/ui/settings.js).
  U.notifyRows = (S) => {
    if (!can()) return U.row({ key: 'nf-app', icon: 'bell', tone: 'amber', title: 'In the Android app', sub: 'Reminders and nudges come from the Gradient Health app on Android.' });
    const p = prefs(S);
    const workouts = S.profile.workouts !== false;
    const rows = [kw(U.sw('Notifications', !!p.on, 'data-on="notifyOn"', 'Workout reminders, and a nudge now and then. One a day at most, never at night.'), 'reminders nudges alerts notify push')];
    if (!p.on) return rows.join('');
    const st = state();
    if (st.permission !== 'granted') {
      const ask = st.permission === 'ask';
      rows.push(`<li data-key="nf-perm" data-keywords="permission allow android"><div class="rf-list-row"><span class="rf-list-icon" data-tone="amber">${U.icon('bell-off')}</span><span class="rf-list-text"><span class="rf-list-title">${ask ? 'Not allowed yet' : 'Off in Android\'s settings'}</span><span class="rf-list-sub">${ask ? 'Android asks once before any can show.' : 'Allow them for Gradient Health there.'}</span></span><button type="button" class="rf-btn" data-size="sm" data-act="${ask ? 'notifyAllow' : 'notifyOpenSettings'}">${ask ? 'Allow' : 'Open'}</button></div></li>`);
    }
    const blocked = new Set(Array.isArray(st.blocked) ? st.blocked : []);
    const bg = GH.health && GH.health.background ? GH.health.background() : null;
    for (const [k, title, sub, words] of KIND_ROWS) {
      if (k === 'workout' && !workouts) continue;
      let line = k === 'move' && !workouts ? 'On days you usually walk or run, twice a week at most' : sub;
      if (k === 'sleep' && !(bg && bg.supported && bg.granted && bg.on)) line = 'Needs Health Connect, with Sync in the background on';
      if (blocked.has(k)) line = 'Off in Android\'s settings';
      rows.push(kw(U.sw(title, p[k] !== false, `data-on="notifyKind" data-k="${k}"`, line), words));
    }
    // The time workout reminders (and the walks and notes that follow a plan) come.
    if (!GH.notify && GH.lazy) GH.lazy('notify').then(() => { if (U.route && U.route.view === 'settings') U.render(); }, () => {});
    const rt = GH.notify ? GH.notify.reminderTime(S, Date.now()) : null;
    const set = p.time != null;
    const auto = rt && rt.how !== 'set' ? `Auto: ${clock(rt.min)}, ${rt.how === 'usual' ? '30 minutes before you usually start' : 'until you\'ve done a few workouts'}` : 'Auto: 30 minutes before you usually start';
    rows.push(`<li data-key="nf-time" data-keywords="reminder time clock hour when"><div class="rf-list-row set-stack"><span class="rf-list-text"><span class="rf-list-title">Reminder time</span><span class="rf-list-sub">${U.esc(set ? 'For workouts, walks and notes after time away' : auto)}</span></span>${U.seg('nfTime', [['auto', 'Auto'], ['set', 'Pick a time']], set ? 'set' : 'auto', 'Reminder time', ' data-on="notifyTimeMode"')}</div></li>`);
    if (set) rows.push(`<li data-key="nf-at" data-keywords="reminder time clock hour"><div class="rf-list-row set-slider"><span class="rf-list-text"><span class="rf-list-title rf-num" data-nf-time>${U.esc(clock(p.time))}</span><span class="rf-list-sub">Between 8 am and 8 pm</span></span><div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="480" max="1200" step="15" value="${p.time}" aria-label="Reminder time" data-on="notifyTime"></div></div></div></li>`);
    return rows.join('');
  };
  U.notifyFoot = (S) => (can() && prefs(S).on
    ? 'Made on this phone from your plan and what you do, and nothing is sent anywhere. Quiet from 9:30 pm to 8 am. After a few days away they slow to weekly and stop after six weeks.'
    : can() ? 'Made on this phone from your plan and what you do. Nothing is sent anywhere.' : '');

  U.on.notifyOn = async (el, ev, v) => {
    const S = U.S;
    if (v) { await turnOn(); U.render(); return; }
    prefs(S).on = false;
    U.markSeen('notifyAsk');
    U.save();
    sync('settings');
    U.render();
  };
  U.on.notifyKind = (el, ev, v) => {
    const k = el.dataset.k;
    if (!KIND_ROWS.some((r) => r[0] === k)) return;
    prefs(U.S)[k] = !!v;
    U.save();
    sync('settings');
  };
  U.act.notifyAllow = async () => {
    const st = await askPermission();
    if (st.permission === 'granted') { U.toast('Notifications are on', 'positive'); sync('settings'); } else blockedToast();
    U.render();
  };
  U.on.notifyTimeMode = (el, ev, v) => {
    const S = U.S, p = prefs(S);
    if (v === 'set') p.time = GH.notify ? GH.notify.reminderTime(S, Date.now()).min : 18 * 60;
    else p.time = null;
    U.save();
    sync('settings');
    U.render();
  };
  U.on.notifyTime = (el, ev, v) => {
    const t = quarter(v);
    if (!(t >= 480 && t <= 1200)) return;
    prefs(U.S).time = t;
    U.save();
    sync('settings');
  };
  // The time shows as the slider moves.
  if (doc) {
    doc.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.matches || !t.matches('[data-on="notifyTime"]')) return;
      const out = doc.querySelector('#screen [data-nf-time]');
      if (out) out.textContent = clock(quarter(t.value));
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
