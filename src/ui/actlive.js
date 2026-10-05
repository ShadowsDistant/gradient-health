/* Recording an outdoor activity: the start sheet (the kind of activity, auto-pause and the spoken
 * splits, then what the app needs permission for and why), finding GPS, the 3-2-1, and the live
 * screen: time, distance, pace or speed, steps, the current split, the GPS signal and the route so far
 * (drawn here, or on a map that follows you), with pause and resume (auto-pause too) and a finish
 * button you press and hold (a tap in a pocket can't end it). Back or the chevron tucks the screen
 * away while the activity keeps recording: Today shows a pill and the other tabs a capsule to get
 * back. Opening the app again, or a reload, goes straight back to it. Discarding one folds it away.
 *
 * The recorder (src/activity.js) is the Android shell's foreground service, or navigator.geolocation
 * in a browser. The page keeps S.actLive: which activity, when its clock started and its pauses.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const A = () => GH.activity;
  const NOOP = { cue() {}, keepAwake() {}, unlockAudio() {}, onBack: () => () => {}, on() {}, visible: () => true };
  const plat = () => GH.platform || NOOP;
  const R = () => A().rec();

  // What's on screen now (S.actLive is what's saved): phase is search | countdown | live | saving.
  let L = null;
  let el = null;
  let timer = null, offBack = null, capTimer = null;
  // speedNow: the pace now, steadied (m/s); gpsReady: GPS has been ready once (its haptic played);
  // byHand: when Pause or Resume was last tapped (the recorder's change that follows isn't auto-pause's).
  const fresh = (phase) => ({ phase, st: null, pts: [], tr: null, trAt: 0, lastState: 0, goAt: 0, lastCue: null, splitBanner: null, speedNow: null, gpsReady: false, byHand: 0 });
  const live = () => !!(U.S && U.S.actLive);
  const shown = () => !!(el && !el.hidden);
  U.actIsLive = live;
  // While it's open the phone moves all the time: Refract's light holds still on its glass (core.js).
  U.actLiveShown = shown;
  const steady = () => { if (U.steadyLight) U.steadyLight(); };

  /* ---------------------------------------------------------------- starting */
  U.act.actStart = (btn) => {
    if (live()) { openLive(); return; }
    const pre = btn && btn.dataset && A().TYPES[btn.dataset.arg] ? btn.dataset.arg : null;
    typeSheet(pre, (U.S.profile.prefs && U.S.profile.prefs.actType) || null);
  };
  // Big tiles, one tap each. The one suggested for today (a light day's walk), or else the one you
  // did last, is marked. Under them, how it records: auto-pause for each kind (on for runs and rides
  // to begin with) and the spoken splits; both can change while it records (its options menu) and in
  // Settings.
  function typeSheet(pre, last) {
    const mark = pre || last;
    const tiles = A().ORDER.map((t) => {
      const tp = A().typeOf(t);
      return `<button type="button" class="at-tile${t === 'other' ? ' is-wide' : ''}" data-act="actPick" data-arg="${t}" data-hue="${tp.hue}"${t === mark ? ' data-last' : ''}>
        <span class="at-ic">${U.icon(tp.icon)}</span><span class="at-name">${U.esc(tp.label)}</span>${t === mark ? `<span class="at-last t-caption">${pre ? 'For today' : 'Last time'}</span>` : ''}</button>`;
    }).join('');
    U.sheet({
      title: 'Record a walk, run or ride', size: 'fit', cls: 'at-sheet',
      body: `<div class="sheet-pad at-pick"><div class="at-grid">${tiles}</div>
        <ul class="rf-list at-opts">${U.actOptionRows(U.S)}</ul>
        <p class="t-footnote rf-muted at-note">${U.icon('lock', 'sm')}<span>Your route stays on this phone. It goes to Health Connect only if you save it there.</span></p></div>`,
    });
  }
  // Auto-pause by kind of activity (chips) and the spoken splits (a switch): the start sheet's and
  // Settings' rows.
  const voiceOn = (S) => !!(S && S.profile.prefs && S.profile.prefs.actVoice);
  const KINDS = { walk: 'Walks', run: 'Runs', hike: 'Hikes', cycle: 'Rides', other: 'Other' };
  U.actOptionRows = (S) => `<li data-key="act-auto"><div class="rf-list-row set-stack"><span class="rf-list-text"><span class="rf-list-title">Auto-pause</span><span class="rf-list-sub">The clock stops while you stand still</span></span>
      <div class="ob-chips at-auto" role="group" aria-label="Auto-pause for">${A().ORDER.map((t) => U.chip(KINDS[t], A().autoOn(S, t), `data-on="actAutoType" data-v="${t}"`)).join('')}</div></div></li>
    ${U.sw('Spoken splits', voiceOn(S), 'data-on="actVoice"', `Each ${U.actUnitLong()}: the distance, the time and its pace, said aloud`)}`;
  U.on.actAutoType = (el, ev, v) => {
    const t = el.dataset.v;
    if (!A().TYPES[t]) return;
    const pr = U.S.profile.prefs;
    pr.actAuto = Object.assign({}, pr.actAuto || {}, { [t]: !!v });
    U.save();
    // The activity recording now, if it's this kind, takes it at once.
    if (live() && U.S.actLive.type === t && !U.S.actLive.noGps) { if (L) L.byHand = Date.now(); R().setOptions({ autoPause: !!v }); }
  };
  U.on.actVoice = (el, ev, v) => {
    U.S.profile.prefs.actVoice = !!v;
    U.save();
    if (live()) R().setOptions({ voice: !!v });
  };
  const pickSheet = () => { const t = U.topSheet(); return t && t.el.classList.contains('at-sheet') ? t : null; };
  // The recorder a new activity would use (not one the page may still be finishing).
  const NEW = () => A().starter();
  // Location is only good enough when it's allowed and precise (approximate is too rough for a route).
  const precise = (perm) => perm.location === 'granted' && !perm.approximate;
  let picking = null;
  let asking = null; // the kind of activity whose permission step is showing (checked again on return)
  U.act.actPick = async (btn) => {
    const type = btn.dataset.arg;
    if (!A().TYPES[type] || picking) return;
    picking = type;
    U.haptic('select');
    U.S.profile.prefs.actType = type;
    U.save();
    try { await check(type, false); } finally { picking = null; }
  };
  // What's missing before this activity can start with GPS: nothing (it starts), GPS itself, location
  // turned off on the phone, or a permission (asked with the reasons first).
  async function check(type, again) {
    const sup = NEW().support();
    const perm = await NEW().permissions();
    const sheet = pickSheet();
    const need = !sup.gps ? 'nogps'
      : !precise(perm) || (sup.steps && perm.activity === 'ask') || (A().hasNative() && perm.notifications === 'ask') ? 'ask'
        : sup.locationOn === false ? 'off' : null;
    if (!need) { asking = null; if (sheet) sheet.close('ok'); if (again) U.haptic('success'); begin(type, false); return; }
    asking = need === 'nogps' ? null : type;
    if (sheet) sheet.update(need === 'nogps' ? noGpsBody(type) : need === 'off' ? offBody(type) : permBody(type, perm, sup, again));
    else begin(type, need === 'nogps');
  }
  function permRow(icon, tone, title, text, state) {
    return `<li class="at-perm-row"><span class="rf-list-icon" data-tone="${tone}">${U.icon(icon)}</span><span class="at-perm-text"><span class="t-subhead">${U.esc(title)}${state === 'granted' ? ` <span class="at-ok" role="img" aria-label="allowed">${U.icon('check', 'sm')}</span>` : ''}</span><span class="t-footnote rf-muted">${U.esc(text)}</span></span></li>`;
  }
  const canSettings = () => !!(NEW().canOpenSettings && NEW().canOpenSettings());
  // perm.location: granted, ask (Android can still ask) or denied (it won't ask again: the app's
  // settings are the way). approximate: only approximate location is allowed. asked: Android was just
  // asked, and location still isn't allowed. The optional ones only show while they're still to ask.
  function permBody(type, perm, sup, asked) {
    const tp = A().typeOf(type);
    const app = A().hasNative();
    const approx = !!perm.approximate && !precise(perm);
    const blocked = perm.location === 'denied';
    const refused = !!asked && !precise(perm);
    const settings = blocked && canSettings();
    const rough = 'Gradient Health has your approximate location only, which is too rough to measure a route.';
    const note = approx ? `${rough} ${settings ? 'Choose Precise in Android\'s Settings, under Permissions, Location.' : 'Choose Precise when Android asks.'}`
      : blocked ? `Location is turned off for Gradient Health. ${settings ? 'Allow it in Android\'s Settings, under Permissions.' : app ? 'Allow it in Android\'s Settings, under Apps, Gradient Health, Permissions.' : 'Allow it for this site in your browser\'s settings.'}`
        : refused ? 'Without your location there\'s no distance or route. You can still start without GPS.' : '';
    return `<div class="sheet-pad at-perm">
      <p class="t-callout">${U.esc(`To track your ${tp.noun}, Gradient Health asks ${app ? 'Android' : 'your browser'} for:`)}</p>
      <ul class="at-perm-list">
        ${permRow('pin', 'sky', app ? 'Precise location' : 'Location', 'To measure distance and draw your route, while you record. It stays on this phone.', precise(perm) ? 'granted' : perm.location)}
        ${sup.steps && perm.activity !== 'granted' ? permRow('act-walk', 'green', 'Physical activity, optional', 'To count your steps with the phone. A watch in Health Connect counts them too.', perm.activity) : ''}
        ${app && perm.notifications !== 'granted' ? permRow('bell', 'amber', 'Notifications, optional', 'To show the time and distance on your lock screen while you\'re out.', perm.notifications) : ''}
      </ul>
      ${note ? `<div class="notice" data-tone="caution">${U.icon('alert')}<span>${U.esc(note)}</span></div>` : ''}
      <div class="at-perm-actions">
        ${settings ? '<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="actSettings">Open settings</button>'
    : `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="actPerm" data-arg="${type}">${refused || blocked ? 'Try again' : 'Continue'}</button>`}
        ${refused || blocked ? `<button type="button" class="rf-btn" data-variant="plain" data-act="actNoGps" data-arg="${type}">Start without GPS</button>` : ''}
      </div>
    </div>`;
  }
  function noGpsBody(type) {
    return `<div class="sheet-pad at-perm">
      <div class="notice" data-tone="caution">${U.icon('alert')}<span>This phone can't find its location, so there's no distance or route. The time, and your steps and heart rate from a watch, still count.</span></div>
      <div class="at-perm-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="actNoGps" data-arg="${type}">Start without GPS</button></div>
    </div>`;
  }
  // Location is switched off for the whole phone (quick settings).
  function offBody(type) {
    return `<div class="sheet-pad at-perm">
      <div class="notice" data-tone="caution">${U.icon('alert')}<span>Location is off on this phone. Swipe down from the top of the screen and turn it on, then try again.</span></div>
      <div class="at-perm-actions">
        <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="actRecheck" data-arg="${type}">Try again</button>
        <button type="button" class="rf-btn" data-variant="plain" data-act="actNoGps" data-arg="${type}">Start without GPS</button>
      </div>
    </div>`;
  }
  U.act.actPerm = async (btn) => {
    const type = btn.dataset.arg;
    btn.setAttribute('aria-disabled', 'true');
    const p = await NEW().request();
    btn.removeAttribute('aria-disabled');
    const sheet = pickSheet();
    if (precise(p)) { asking = null; if (sheet) sheet.close('ok'); U.haptic('success'); begin(type, false); return; }
    if (sheet) sheet.update(permBody(type, p, NEW().support(), true));
    U.haptic('warning');
  };
  U.act.actRecheck = (btn) => { U.haptic('tap'); check(btn.dataset.arg, true); };
  U.act.actSettings = () => { U.haptic('tap'); NEW().openSettings(); };
  U.act.actNoGps = (btn) => { asking = null; const sheet = pickSheet(); if (sheet) sheet.close('ok'); begin(btn.dataset.arg, true); };
  // Back from Android's settings (or the quick settings) with the permission step still showing: look again.
  plat().on('resume', () => { if (asking && pickSheet() && !picking) { picking = asking; check(asking, true).finally(() => { picking = null; }); } });

  function begin(type, noGps) {
    const S = U.S;
    if (live()) { openLive(); return; }
    const now = Date.now();
    const id = `act-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const title = A().defaultTitle(type, now);
    const o = { id, type, title, units: A().unitsOf(S), autoPause: !noGps && A().autoOn(S, type), voice: voiceOn(S) };
    let ok = NEW().start(o);
    // Without location allowed the phone's recorder won't start: the page keeps the clock instead.
    if (!ok && noGps && A().hasNative()) ok = A().web.start(Object.assign({ noGps: true }, o));
    if (!ok) {
      const set = NEW().canOpenSettings && NEW().canOpenSettings();
      U.toast('Couldn\'t start', 'caution', 'Gradient Health needs your precise location to record a route.', set ? { label: 'Settings', onClick: () => NEW().openSettings() } : undefined);
      return;
    }
    // The clock waits while GPS finds you and through the 3-2-1.
    R().pause();
    S.actLive = { id, type, title, startedAt: now, goAt: null, pauses: [], splits: 0, noGps: !!noGps };
    U.save(true);
    L = fresh(noGps ? 'countdown' : 'search');
    if (noGps) { L.goAt = now + 3000; plat().unlockAudio(); }
    openLive();
  }

  /* ---------------------------------------------------------------- showing and hiding */
  function ensureEl() {
    if (el && el.isConnected) return el;
    el = document.createElement('section');
    el.id = 'actlive';
    el.className = 'al';
    el.hidden = true;
    el.setAttribute('aria-label', 'Activity');
    document.getElementById('app').appendChild(el);
    wireHold(el);
    return el;
  }
  function openLive() {
    const S = U.S;
    if (!S || !S.actLive) return;
    ensureEl();
    if (!L) L = fresh(S.actLive.goAt ? 'live' : 'search');
    const was = shown();
    el.hidden = false;
    steady();
    if (!offBack) offBack = plat().onBack(onBack);
    pull(true);
    draw();
    startTimer();
    awake();
    U.render();
    if (!was && !U.reduced() && el.animate) {
      el.animate([{ opacity: 0, transform: 'translateY(24px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
    }
  }
  U.actOpenLive = openLive;
  U.act.actOpenLive = () => { U.haptic('nav'); openLive(); };
  function hideLive(animate) {
    if (!el) return;
    if (offBack) { offBack(); offBack = null; }
    plat().keepAwake(false);
    let hid = false;
    const done = () => { if (hid) return; hid = true; el.hidden = true; steady(); if (!live()) { el.textContent = ''; stopTimer(); } U.render(); capsuleClock(); };
    if (animate === false || U.reduced() || !el.animate || el.hidden) { done(); return; }
    const an = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(22px)' }], { duration: 220, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)', fill: 'forwards' });
    // A busy or throttled page can hold animation frames back: a timer finishes the job regardless.
    const t = setTimeout(done, 320);
    an.onfinish = () => { clearTimeout(t); done(); an.cancel(); };
  }
  U.act.alMin = () => { U.haptic('back'); hideLive(); };
  function onBack() {
    if (!shown()) return false;
    // A sheet or dialog over the screen closes first (the app's own Back does that).
    if (U.topSheet() || document.querySelector('dialog[open]')) return false;
    if (L && L.phase === 'countdown') { cancelCountdown(); return true; }
    if (L && L.phase === 'saving') return true;
    hideLive();
    return true;
  }
  // The screen stays on while GPS searches and through the 3-2-1; after that it's up to the phone.
  function awake() { plat().keepAwake(!!(shown() && L && (L.phase === 'search' || L.phase === 'countdown'))); }

  /* ---------------------------------------------------------------- the recorder's side */
  // Reads the state (the recorder also sends it about once a second) and, at most every 3 seconds,
  // the new fixes, and works the numbers out from them the same way the summary does.
  function pull(force) {
    const S = U.S;
    if (!L || !S.actLive) return;
    const now = Date.now();
    if (force || now - L.lastState > 1500) onState(R().state(), true);
    if (L.phase !== 'live' && L.phase !== 'saving') return;
    if (!force && now - L.trAt < 3000) return;
    const more = R().points(L.pts.length);
    if (more.length) Array.prototype.push.apply(L.pts, more);
    if (more.length || !L.tr || force) analyse(now);
    L.trAt = now;
  }
  function analyse(now) {
    const a = U.S.actLive;
    if (!a.goAt) return;
    L.tr = A().track(L.pts, { type: a.type, start: a.goAt, end: now, pauses: closedPauses(now), movingMs: moving(now) });
    // The pace now: the GPS's own speed over the last 20 s of this stretch (A.liveSpeed), steadied
    // from one look to the next, so it doesn't jump with every fix; straight to 0 when you stop.
    const v = A().liveSpeed(L.pts, a.type);
    L.speedNow = v == null ? null : v === 0 || L.speedNow == null || L.speedNow === 0 ? v : L.speedNow + 0.45 * (v - L.speedNow);
    const unit = U.actUnitM();
    const whole = Math.floor(L.tr.distanceM / unit + 1e-9);
    // A split done: a banner (and a buzz) on screen.
    if (whole > (a.splits || 0)) {
      const sp = A().splits(L.tr, unit, null).filter((s) => !s.part);
      const last = sp[whole - 1];
      a.splits = whole;
      U.save();
      if (last && shown()) {
        L.splitBanner = { n: whole, ms: last.ms, until: now + 8000 };
        U.haptic('actSplit');
      }
    }
  }
  const closedPauses = (now) => (U.S.actLive.pauses || []).map(([x, y]) => [x, y == null ? now : y]);
  // The activity clock: the recorder's, pauses taken out; before the start, 0.
  function moving(now) {
    const a = U.S && U.S.actLive;
    if (!a || !a.goAt) return 0;
    if (L && L.st && L.st.id === a.id && L.st.startedAt) return A().clockMs(L.st, now);
    return Math.max(0, now - a.goAt - closedPauses(now).reduce((s, [x, y]) => s + Math.max(0, Math.min(y, now) - Math.max(x, a.goAt)), 0));
  }
  function onState(st, polled) {
    if (!L || !U.S || !U.S.actLive) return;
    const a = U.S.actLive;
    if (st.id && st.id !== a.id) return;
    const was = L.st;
    L.st = st;
    L.lastState = Date.now();
    // Paused or resumed from outside the app (the notification, auto-pause): kept in the pause log.
    // It's only the time the page heard of it (the recorder's flagged fixes say when it really
    // happened).
    if (L.phase === 'live' && was && st.active && was.paused !== st.paused) {
      logPause(st.paused, Date.now());
      // Auto-pause stopped the clock or started it again: a feel of its own (a tap on Pause or
      // Resume plays its button's).
      if (shown() && Date.now() - L.byHand > 2500) {
        if (st.paused && st.autoPaused) U.haptic('actAutoPause');
        else if (!st.paused && was.autoPaused) U.haptic('actAutoResume');
      }
    }
    // GPS has you, while it looks: once.
    if (L.phase === 'search' && !L.gpsReady && gpsReady(st)) { L.gpsReady = true; if (shown()) U.haptic('actGps'); }
    if (!st.active && st.id === a.id && L.phase === 'live' && a.goAt && !polled) { finish(true); return; }
    if (shown()) update();
    else capsuleClock();
  }
  A().onState((st) => onState(st, false));
  function logPause(on, t) {
    const p = U.S.actLive.pauses;
    const open = p.length && p[p.length - 1][1] == null;
    if (on && !open) p.push([t, null]);
    else if (!on && open) p[p.length - 1][1] = t;
    U.save();
  }
  const paused = () => !!(L && L.st && L.st.paused && L.phase === 'live');
  const autoPaused = () => paused() && !!L.st.autoPaused;
  // Accurate to 20 m, now: good enough to start on.
  const gpsReady = (st) => !!(st && st.gps === 'ok' && st.lastFix && st.lastFix.acc != null && st.lastFix.acc <= 20);

  /* ---------------------------------------------------------------- the loop */
  function startTimer() { if (!timer) timer = setInterval(loop, 250); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function loop() {
    if (!L || !live()) { stopTimer(); return; }
    const now = Date.now();
    if (L.phase === 'countdown') {
      if (cancelling) return;
      const s = Math.ceil((L.goAt - now) / 1000);
      if (now >= L.goAt) { go(); return; }
      if (s !== L.lastCue) { L.lastCue = s; plat().cue('countdown'); if (shown()) draw(); }
      return;
    }
    if (!shown()) { if (now - L.lastState > 1500) onState(R().state(), true); capsuleClock(); return; }
    pull(false);
    update();
  }
  U.act.alGo = () => {
    if (!L || L.phase !== 'search') return;
    plat().unlockAudio();
    L.phase = 'countdown';
    L.goAt = Date.now() + 3000;
    L.lastCue = null;
    awake();
    draw();
  };
  // Back to finding GPS (without GPS there's nothing to go back to, so it's called off). The number
  // folds away first; the clock doesn't start meanwhile.
  let cancelling = false;
  function cancelCountdown() {
    if (!L || L.phase !== 'countdown' || cancelling) return;
    if (U.S.actLive.noGps) { discard(true); return; }
    U.haptic('back');
    cancelling = true;
    const l = L;
    U.actFoldAway(el ? el.querySelectorAll('.al-count, .al-actions > *') : [], { ms: 200 }).then(() => {
      cancelling = false;
      if (L !== l || L.phase !== 'countdown') return;
      L.phase = 'search';
      awake();
      draw();
    });
  }
  U.act.alCancelCount = () => cancelCountdown();
  function go() {
    const a = U.S.actLive;
    R().resume();
    a.goAt = Date.now();
    a.pauses = [];
    a.splits = 0;
    U.save(true);
    plat().cue('go', 'actGo');
    L.phase = 'live';
    L.pts = []; L.tr = null; L.trAt = 0;
    onState(R().state(), true);
    awake();
    draw();
  }
  U.act.alPause = () => {
    if (!L || L.phase !== 'live' || paused()) return;
    R().pause();
    logPause(true, Date.now());
    if (L.st) L.st = Object.assign({}, L.st, { paused: true, autoPaused: false, elapsedMs: A().clockMs(L.st, Date.now()), at: Date.now() });
    L.byHand = Date.now();
    U.haptic('actPause');
    pull(true);
    draw();
  };
  // Resume (from a pause by hand or auto-pause's).
  U.act.alResume = () => {
    if (!L || L.phase !== 'live' || !paused()) return;
    R().resume();
    logPause(false, Date.now());
    if (L.st) L.st = Object.assign({}, L.st, { paused: false, autoPaused: false, at: Date.now() });
    L.byHand = Date.now();
    U.haptic('actResume');
    pull(true);
    draw();
  };

  /* ---------------------------------------------------------------- drawing */
  const unitShort = () => U.actUnitShort();
  // The GPS signal: three bars by how accurate the last fix is (10 m or better all three, 25 m two,
  // 50 m one), green when it's good enough to measure by and amber when it's weak, said in words for a
  // screen reader too; none while it looks (the first bar blinks), and none without location.
  function gpsBars(st) {
    const fix = st && st.lastFix;
    if (!st || st.gps === 'off' || !fix || fix.acc == null || (fix.t && Date.now() - fix.t > 15000)) return 0;
    return fix.acc <= 10 ? 3 : fix.acc <= 25 ? 2 : fix.acc <= 50 ? 1 : 0;
  }
  function gpsBadge() {
    const st = L && L.st;
    const noGps = U.S.actLive && U.S.actLive.noGps;
    const g = noGps ? 'off' : st ? st.gps : 'searching';
    const bars = noGps ? 0 : gpsBars(st);
    const acc = bars ? Math.round(st.lastFix.acc) : null;
    const looking = g === 'searching' && bars < 2;
    const word = noGps ? 'No GPS' : g === 'off' ? 'GPS off' : looking ? 'Finding GPS' : 'GPS';
    const say = noGps || g === 'off' ? word : `${looking ? 'Finding GPS' : `GPS signal ${['', 'weak', 'good', 'strong'][bars]}`}${acc != null ? `, accurate to about ${acc} metres` : ''}`;
    return `<span class="al-gps" data-gps="${g}" data-bars="${bars}" role="status" aria-label="${U.esc(say)}"><span class="al-bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="al-gps-t">${U.esc(word)}${acc != null && !looking ? ` ±${acc} m` : ''}</span></span>`;
  }
  function numbers(now) {
    const a = U.S.actLive;
    const ms = moving(now);
    const tr = L.tr;
    const dist = tr && tr.pts.length ? tr.distanceM : (L.st && L.st.distanceM) || 0;
    const unit = U.actUnitM();
    const tp = A().typeOf(a.type);
    // Now: the steadied speed of the last 20 s (analyse), as a pace or a speed.
    const v = L.speedNow;
    const avg = tp.speed ? U.actFmtSpeed(A().speedOf(dist, ms, unit)) : U.actFmtPace(A().paceOf(dist, ms, unit));
    const cur = v == null || paused() ? null : v === 0 ? 'stopped' : tp.speed ? U.actFmtSpeed((v * 3600) / unit) : U.actFmtPace(unit / v);
    // The split you're in: its number, its time so far, how far through it you are.
    const k = Math.floor(dist / unit + 1e-9);
    let splitMs = ms, prevSplit = null;
    if (tr && k >= 1) {
      const x = A().at(tr.pts, k * unit);
      if (x) splitMs = Math.max(0, ms - x.mt);
      const sp = A().splits(tr, unit, null).filter((s) => !s.part);
      prevSplit = sp[k - 1] || null;
    }
    const steps = L.st && L.st.steps != null ? L.st.steps : null;
    return { ms, dist, avg, cur, k, splitMs, prevSplit, splitFrac: (dist - k * unit) / unit, steps, tp };
  }
  function liveBody(now) {
    const a = U.S.actLive;
    const n = numbers(now);
    const tp = n.tp;
    const route = liveRoute();
    const bn = L.splitBanner && L.splitBanner.until > now ? L.splitBanner : null;
    const kcal = n.steps == null ? liveKcal(n) : null;
    const clock = `<div class="al-clock${a.noGps ? ' al-clock-solo' : ''}">
        <span class="al-time" data-live="time">${U.esc(U.actClock(n.ms / 1000))}</span>
        <span class="al-cap" data-live="cap">${autoPaused() ? 'Auto-paused' : paused() ? 'Paused' : 'Time'}</span>
      </div>`;
    // Without GPS there's no distance, pace or split to show: the time, the phone's steps if it
    // counts them, and what comes later from a watch.
    if (a.noGps) {
      const watch = A().canSession() ? ' Steps, distance and heart rate from a watch are added when you finish.' : '';
      return `${clock}
      ${n.steps != null ? `<div class="al-grid"><div class="al-m al-m-wide rf-glass" data-variant="thick" data-interactive><span class="al-m-l">Steps</span><span class="al-m-v"><b data-live="steps">${U.num(n.steps)}</b></span><span class="al-m-s">from your phone</span></div></div>` : ''}
      <div class="al-map al-map-none rf-glass" data-variant="thick" data-interactive data-type="${U.esc(a.type)}"><p class="al-map-wait t-footnote">${U.icon('pin', 'sm')}<span>${U.esc(`No GPS, so no distance or route this time.${watch}`)}</span></p></div>`;
    }
    return `${clock}
      ${bn ? `<div class="al-banner" data-key="bn-${bn.n}" role="status">${U.icon('flag', 'sm')}<span>${U.esc(U.cap(U.actUnitLong()))} ${bn.n} · ${U.esc(U.actClock(bn.ms / 1000))}</span></div>` : ''}
      <div class="al-grid">
        <div class="al-m rf-glass" data-variant="thick" data-interactive><span class="al-m-l">Distance</span><span class="al-m-v"><b data-live="dist">${U.esc(U.actDistNum(n.dist))}</b><small>${U.esc(unitShort())}</small></span><span class="al-m-s">&nbsp;</span></div>
        <div class="al-m rf-glass" data-variant="thick" data-interactive><span class="al-m-l">${tp.speed ? 'Avg speed' : 'Avg pace'}</span><span class="al-m-v"><b data-live="avg">${U.esc(n.avg)}</b><small>${U.esc(tp.speed ? U.actSpeedUnit() : `/${unitShort()}`)}</small></span><span class="al-m-s" data-live="cur">${n.cur ? (n.cur === 'stopped' ? 'Now: stopped' : `Now ${U.esc(n.cur)}`) : '&nbsp;'}</span></div>
        ${n.steps != null
    ? `<div class="al-m rf-glass" data-variant="thick" data-interactive><span class="al-m-l">Steps</span><span class="al-m-v"><b data-live="steps">${U.num(n.steps)}</b></span><span class="al-m-s">from your phone</span></div>`
    : `<div class="al-m rf-glass" data-variant="thick" data-interactive><span class="al-m-l">Calories</span><span class="al-m-v"><b data-live="kcal">${U.num(kcal)}</b><small>kcal</small></span><span class="al-m-s">estimated</span></div>`}
        <div class="al-m rf-glass" data-variant="thick" data-interactive><span class="al-m-l" data-live="splitl">${U.esc(U.cap(U.actUnitLong()))} ${n.k + 1}</span><span class="al-m-v"><b data-live="split">${U.esc(U.actClock(n.splitMs / 1000))}</b></span><span class="al-m-bar" aria-hidden="true"><i data-live="splitbar" style="width:${(Math.max(0, Math.min(1, n.splitFrac)) * 100).toFixed(1)}%"></i></span></div>
      </div>
      ${mapCard(route.length > 1 ? U.actRouteSvg(route, { pace: false, marks: false, live: true, W: 360, H: 190, pad: 20, cls: 'rt-live' }) : '<p class="al-map-wait t-footnote">Your route draws here as you go.</p>')}`;
  }
  // The route so far as it's drawn (A.smoothRoute), worked out again only when the track is.
  function liveRoute() {
    if (!L || !L.tr || L.tr.pts.length < 2) return [];
    if (L.routeOf !== L.tr) {
      L.routeOf = L.tr;
      L.route = A().simplify(A().smoothRoute(L.tr.pts), 4).map((p, i, arr) => ({ lat: p.lat, lon: p.lon, gap: i > 0 && p.run !== arr[i - 1].run }));
    }
    return L.route;
  }
  // The map card: the route drawn here, or with maps on, the map that follows you over it (its box,
  // .al-map-slot, is where the one map of this activity goes; see liveMap). Its button turns maps on
  // and off; OpenFreeMap's credit is a line of the page's along its foot. With a map in it, the glass
  // doesn't answer a press (fingers on it move the map).
  function mapCard(inner, search) {
    const on = mapsWanted();
    const a = U.S.actLive;
    return `<div class="al-map${search ? ' al-map-search' : ''} rf-glass" data-variant="thick"${on ? '' : ' data-interactive'} data-type="${U.esc(a.type)}"${on ? ` data-streets="${lm ? lm.state : 'loading'}"` : ''}>
        ${inner}
        ${on ? '<div class="al-map-slot" data-morph="keep"></div><p class="am-attr t-caption"><button type="button" class="am-attr-btn" data-act="actOsm">© OpenMapTiles © OpenStreetMap contributors</button></p>' : ''}
        <button type="button" class="rf-btn rf-glass al-map-btn" data-variant="thick" data-size="sm" data-shape="circle" data-act="alMaps" aria-pressed="${on}" aria-label="${on ? 'Hide the map' : 'Show a map'}">${U.icon('map')}</button>
      </div>`;
  }

  /* ---------------------------------------------------------------- the live map */
  // With maps on (U.actMapsOn), a map that follows you, OpenFreeMap's (U.actMap): while GPS looks, at
  // where the phone roughly is (st.coarse) until the GPS has you, and as you go. One map for the whole
  // activity: its box moves from the search card to the live one, and waits out the 3-2-1 in between.
  // A theme change recolours it in place.
  let lm = null; // { el, ctl, dark, state, routeOf, at }
  const mapsWanted = () => !!(U.actMapsOn && U.actMapsOn() && U.S.actLive && !U.S.actLive.noGps);
  // Where you are, for the map: the last fix (a minute old at most), else the rough position; which
  // way you're heading once you're moving and the GPS knows.
  function hereNow() {
    const st = L && L.st;
    if (!st) return null;
    const f = st.lastFix && st.lastFix.acc != null && st.lastFix.acc <= 100 && !(st.lastFix.t && Date.now() - st.lastFix.t > 60000) ? st.lastFix : null;
    const p = f || st.coarse;
    if (!p) return null;
    const heading = f && f.bearing != null && f.speed != null && f.speed >= 0.6 && !paused() ? f.bearing : null;
    return { lat: p.lat, lon: p.lon, acc: p.acc, heading };
  }
  function liveMap() {
    if (!el || !L) return;
    if (!mapsWanted()) { dropMap(); return; }
    const slot = el.querySelector('.al-map-slot');
    const dark = U.actDark();
    const card = slot && slot.closest('.al-map');
    // The theme changed: the same map, in the new colours.
    if (lm && lm.dark !== dark && card) { lm.dark = dark; lm.ctl.restyle({ dark, line: U.actColor(card, '--al-line'), casing: U.actColor(card, '--rt-case') }); }
    if (!lm && slot) {
      const box = document.createElement('div');
      box.className = 'am-streets al-streets';
      const l = lm = { el: box, dark, state: 'loading', ctl: null, routeOf: L.tr, at: '' };
      const mark = () => { const c = l.el.closest('.al-map'); if (c && lm === l) c.dataset.streets = l.state; };
      l.ctl = U.actMap(box, {
        live: true, dark, route: liveRoute(), here: hereNow(),
        line: U.actColor(card, '--al-line'), casing: U.actColor(card, '--rt-case'),
        onReady: () => { l.state = 'ready'; mark(); },
        onFail: () => { l.state = 'failed'; mark(); },
      });
    }
    if (lm && slot && lm.el.parentNode !== slot) slot.appendChild(lm.el);
    feedMap();
  }
  // The route and where you are, as they change.
  function feedMap() {
    if (!lm || !lm.ctl) return;
    if (lm.routeOf !== L.tr) { lm.routeOf = L.tr; lm.ctl.update({ route: liveRoute() }); }
    const h = hereNow();
    const at = h ? `${h.lat.toFixed(6)},${h.lon.toFixed(6)},${Math.round(h.acc || 0)},${h.heading == null ? '' : Math.round(h.heading)}` : '';
    if (h && at !== lm.at) { lm.at = at; lm.ctl.update({ here: h }); }
  }
  function dropMap() {
    if (!lm) return;
    try { lm.ctl.destroy(); } catch (e) { /* gone */ }
    lm.el.remove();
    lm = null;
  }
  U.act.alMaps = async () => {
    if (!live()) return;
    const pr = U.S.profile.prefs;
    const on = !mapsWanted();
    // The first time, asked first: what the map's service sees.
    if (on && !U.actMapsAsked()) {
      if (!(await U.confirm('Show a map from OpenFreeMap?', 'The map comes from OpenFreeMap, which sees the area it shows: while you record, around where you are. Your route stays on this phone. You can turn the map off here, or on an activity.', 'Show map', undefined, 'map', 'Not now'))) return;
      if (!live()) return;
    }
    pr.actMaps = on;
    delete pr.actStreets;
    U.save();
    U.haptic(on ? 'toggleOn' : 'toggleOff');
    if (!on) dropMap();
    draw();
  };
  function liveKcal(n) {
    const tr = L.tr;
    if (!tr) return 0;
    return A().kcalEstimate(U.S.actLive.type, tr, null, (U.S.profile && U.S.profile.weightKg) || 70);
  }
  let holding = false; // a finger is on the finish button (redraws keep its ring filling)
  function holdBtn() {
    return `<button type="button" class="al-btn al-finish${holding ? ' is-holding' : ''}" data-hold aria-label="Finish. Press and hold, or tap to confirm">
      <span class="al-btn-disc"><svg class="al-ring" viewBox="0 0 72 72" aria-hidden="true"><circle class="al-ring-track" cx="36" cy="36" r="33" pathLength="100"/><circle class="al-ring-fill" cx="36" cy="36" r="33" pathLength="100"/></svg>${U.icon('stop')}</span>
      <span class="al-btn-l">Hold to finish</span></button>`;
  }
  function draw() {
    if (!el || el.hidden || !L || !live()) return;
    const S = U.S, a = S.actLive;
    const tp = A().typeOf(a.type);
    const now = Date.now();
    const phase = L.phase === 'live' && paused() ? (autoPaused() ? 'autopaused' : 'paused') : L.phase;
    el.dataset.type = a.type;
    el.dataset.hue = tp.hue;
    el.dataset.phase = phase;
    let body = '', actions = '';
    if (L.phase === 'search') {
      const st = L.st;
      const acc = st && st.lastFix && st.lastFix.acc != null ? Math.round(st.lastFix.acc) : null;
      const ready = gpsReady(st);
      const q = acc == null ? 0 : Math.max(0.06, Math.min(1, (50 - acc) / 40));
      const radar = `<div class="al-radar" aria-hidden="true"><span></span><span></span><span></span><i>${U.icon('navigate')}</i></div>`;
      // With maps on, the map shows where you are while GPS looks (roughly at first), the radar
      // over it until the map's there.
      body = `<div class="al-search${mapsWanted() ? ' has-map' : ''}" data-ready="${ready}">
          ${mapsWanted() ? mapCard(radar, true) : radar}
          <h1 class="al-h1">${ready ? 'GPS is ready' : 'Finding your location'}</h1>
          <p class="al-sub">${ready ? `Accurate to about ${acc} m. Start when you're ready.` : acc != null ? `Accurate to about ${acc} m so far. Stand still outside with a clear view of the sky.` : st && st.coarse ? 'Found roughly where you are. Stand still outside with a clear view of the sky.' : 'Stand still outside with a clear view of the sky.'}</p>
          <div class="al-acc" role="meter" aria-label="GPS accuracy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(q * 100)}"><i style="width:${(q * 100).toFixed(0)}%"></i></div>
        </div>`;
      actions = `<button type="button" class="rf-btn rf-glass al-cancel" data-size="lg" data-lens data-act="alDiscardNow">Cancel</button>
        <button type="button" class="rf-btn rf-glass al-start" data-variant="tinted" data-size="xl" data-act="alGo"${ready ? ' data-ready' : ''}>${U.icon('play')}${ready ? 'Start' : 'Start now'}</button>`;
    } else if (L.phase === 'countdown') {
      const s = Math.max(1, Math.ceil((L.goAt - now) / 1000));
      body = `<div class="al-count"><span class="al-count-n" data-key="n${s}">${s}</span><span class="al-sub">${U.esc(`Your ${tp.noun} starts`)}</span></div>`;
      actions = '<button type="button" class="rf-btn rf-glass al-cancel" data-size="lg" data-lens data-act="alCancelCount">Cancel</button>';
    } else if (L.phase === 'saving') {
      body = `<div class="al-count"><span class="rf-spinner"><i></i></span><span class="al-sub">Saving your ${U.esc(tp.noun)}…</span></div>`;
    } else {
      body = liveBody(now);
      actions = paused()
        ? `<button type="button" class="al-btn al-go" data-act="alResume" aria-label="Resume"><span class="al-btn-disc">${U.icon('play')}</span><span class="al-btn-l">Resume</span></button>${holdBtn()}`
        : `<button type="button" class="al-btn al-pause" data-act="alPause" aria-label="Pause"><span class="al-btn-disc rf-glass" data-interactive>${U.icon('pause')}</span><span class="al-btn-l">Pause</span></button>${holdBtn()}`;
    }
    U.morph(el, `<div class="al-bg" aria-hidden="true"><i></i><i></i></div>
      <div class="al-top">
        ${U.glassBtn('chevron-down', 'Minimize', 'alMin')}
        <div class="al-head"><span class="al-type">${U.actTypeIcon(a.type, 'sm')}<span>${U.esc(tp.label)}</span></span>${gpsBadge()}</div>
        ${L.phase === 'live' ? U.glassBtn('more', 'Activity options', 'alMenu') : '<span class="ob-spacer"></span>'}
      </div>
      <div class="al-body" data-key="al-${L.phase}">${body}</div>
      <div class="al-actions" data-key="alx-${phase === 'autopaused' ? 'paused' : phase}">${actions}</div>`);
    liveMap();
  }
  // Between draws, only the numbers change.
  let lastDraw = 0;
  function update() {
    if (!shown() || !L) return;
    const now = Date.now();
    feedMap();
    if (L.phase !== 'live') { if (now - lastDraw > 900) { lastDraw = now; draw(); } return; }
    const banner = L.splitBanner && L.splitBanner.until > now;
    const hasBanner = !!el.querySelector('.al-banner');
    if (now - lastDraw > 2500 || banner !== hasBanner || el.dataset.phase !== (autoPaused() ? 'autopaused' : paused() ? 'paused' : 'live')) { lastDraw = now; draw(); return; }
    const t = el.querySelector('[data-live="time"]');
    const txt = U.actClock(moving(now) / 1000);
    if (t && t.textContent !== txt) t.textContent = txt;
  }

  /* ---------------------------------------------------------------- hold to finish */
  // Press and hold for a second: the ring fills, and letting go early (or sliding off) stops it. A
  // plain tap, a keyboard or a screen reader asks first instead.
  const HOLD_MS = 1000;
  function wireHold(root) {
    let hold = null, justHeld = 0, released = { at: 0, held: 0 };
    const stop = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      holding = false;
      hold.btn.classList.remove('is-holding');
      released = { at: Date.now(), held: Date.now() - hold.at };
      hold = null;
      if (released.held > 250) hint();
    };
    root.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest && e.target.closest('[data-hold]');
      if (!btn || hold || (e.button != null && e.button > 0)) return;
      hold = { btn, at: Date.now(), id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        const b = hold && hold.btn;
        hold = null;
        holding = false;
        if (b) b.classList.remove('is-holding');
        justHeld = Date.now();
        U.haptic('detent');
        finish(false);
      }, HOLD_MS) };
      btn.classList.add('is-holding');
      holding = true;
      U.haptic('press');
    });
    document.addEventListener('pointermove', (e) => { if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 36) stop(); });
    document.addEventListener('pointerup', (e) => { if (hold && e.pointerId === hold.id) stop(); });
    document.addEventListener('pointercancel', (e) => { if (hold && e.pointerId === hold.id) stop(); });
    root.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('[data-hold]')) e.preventDefault(); });
    root.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-hold]');
      if (!btn) return;
      if (Date.now() - justHeld < 800 || (Date.now() - released.at < 600 && released.held > 250)) return;
      confirmFinish();
    });
  }
  function hint() {
    const l = el && el.querySelector('.al-finish .al-btn-l');
    if (!l) return;
    l.textContent = 'Keep holding';
    U.haptic('deny');
    setTimeout(() => { if (l.isConnected) l.textContent = 'Hold to finish'; }, 1400);
  }
  async function confirmFinish() {
    if (!L || L.phase !== 'live') return;
    const noun = A().typeOf(U.S.actLive.type).noun;
    if (await U.confirm(`Finish your ${noun}?`, 'Next time you can press and hold the button to finish straight away.', 'Finish', undefined, 'flag', 'Keep going')) finish(false);
  }

  /* ---------------------------------------------------------------- finishing */
  function waitStopped(id, ms) {
    return new Promise((resolve) => {
      let done = false;
      const off = A().onState((st) => { if (!st.active && (!st.id || st.id === id)) end(st); });
      const poll = setInterval(() => { const st = R().state(); if (!st.active) end(st); }, 250);
      const timer = setTimeout(() => end(R().state()), ms);
      function end(st) { if (done) return; done = true; off(); clearInterval(poll); clearTimeout(timer); resolve(st); }
    });
  }
  // outside: the recording ended somewhere else (the notification, or the app was closed).
  async function finish(outside) {
    const S = U.S;
    if (!L || !S.actLive || L.phase === 'saving') return;
    const a = S.actLive;
    if (!a.goAt) { discard(true); return; }
    L.phase = 'saving';
    const tapAt = Date.now();
    if (shown()) draw();
    if (!outside) R().stop();
    const st = await waitStopped(a.id, 4000);
    if (U.S !== S || S.actLive !== a) return; // saved meanwhile (the app coming back does that too)
    save(st, endOf(a, st, tapAt), true);
  }
  // When the recording ended: the recorder's own time (finished from the notification, the page may
  // only hear of it much later), else worked out from its clock, else `fallback`.
  function endOf(a, st, fallback) {
    let t = null;
    if (st && st.id === a.id && !st.active) {
      if (st.endedAt > 0) t = st.endedAt;
      else if (st.startedAt) t = st.startedAt + (st.elapsedMs || 0) + (st.pausedMs || 0);
    }
    if (t == null) t = fallback;
    return Math.max(a.goAt || a.startedAt || 0, Math.min(Date.now(), t));
  }
  // Turns the finished recording into a saved activity and shows it (open: go to its summary).
  function save(st0, endAt0, open) {
    const S = U.S;
    const a = S.actLive;
    if (!a) return null;
    const st = st0 || R().state();
    const endAt = endAt0 || endOf(a, st, Date.now());
    if (a.pauses.length && a.pauses[a.pauses.length - 1][1] == null) a.pauses[a.pauses.length - 1][1] = endAt;
    const points = R().points(0);
    const clockMs = st && st.id === a.id && st.startedAt ? A().clockMs(Object.assign({}, st, { active: false }), endAt) : null;
    const movingMs = clockMs != null && clockMs > 0 ? Math.min(clockMs, endAt - a.goAt) : Math.max(0, endAt - a.goAt - closedPauses(endAt).reduce((s, [x, y]) => s + Math.max(0, y - x), 0));
    const act = A().build(S, { id: a.id, type: a.type, title: a.title, start: a.goAt, end: endAt, points, pauses: a.pauses, pausedMs: Math.max(0, endAt - a.goAt - movingMs), movingMs, steps: st && st.steps, distanceM: st && st.distanceM });
    A().add(S, act);
    A().countLight(S, act);
    S.actLive = null;
    U.save(true);
    R().clear(act.id);
    L = null;
    stopTimer();
    dropMap();
    if (el) { el.hidden = true; el.textContent = ''; steady(); }
    if (offBack) { offBack(); offBack = null; }
    plat().keepAwake(false);
    if (open) {
      U.open('activity', act.id);
      // A record beaten: the record's feel; else the finish's own.
      U.haptic(act.records.length ? 'pr' : 'actFinish');
    } else U.render();
    if (U.checklistCheck) U.checklistCheck();
    if (U.actAfterFinish) U.actAfterFinish(act);
    if (U.badgeCheck) U.badgeCheck('activity'); // a first run, a 5K, a record: a toast with the medal
    return act;
  }
  // Discard: nothing is kept (quiet: no question, e.g. before the clock started). The screen folds
  // away rather than vanishing.
  async function discard(quiet) {
    const S = U.S;
    const a = S.actLive;
    if (!a || leaving) return;
    const noun = A().typeOf(a.type).noun;
    const ask = !quiet && a.goAt && moving(Date.now()) > 60000;
    if (ask && !(await U.confirm(`Discard this ${noun}?`, 'Nothing from it is saved.', 'Discard', 'critical', 'trash', 'Keep it'))) return;
    if (S.actLive !== a || leaving) return;
    const top = U.topSheet(); if (top) top.close('ok');
    // Forgotten first: the recorder's news of its stop (the page's own recorder tells at once) isn't
    // taken for a finish.
    S.actLive = null;
    L = null;
    U.save(true);
    R().stop();
    R().clear(a.id);
    stopTimer();
    if (offBack) { offBack(); offBack = null; }
    const said = !quiet || a.goAt;
    // Something recorded goes with the discard's own feel: at once, or once the screen has gone when
    // the question was asked (its Discard has a feel of its own); called off before the start, a step
    // back.
    if (!said) U.haptic('back');
    else if (!ask) U.haptic('actDiscard');
    await foldAway();
    if (said && ask) U.haptic('actDiscard');
    dropMap();
    hideLive(false);
    if (said) U.toast(`${U.cap(noun)} discarded`, 'neutral', 'Nothing from it was saved.');
  }
  // The live screen folding away: its glass dissolves where it is (Refract's dematerialize), the rest
  // sinks and fades a few at a time, and the colours behind it go, so the page beneath shows through.
  // Reduced motion: a short fade.
  let leaving = false;
  function foldAway() {
    if (!el || el.hidden || !el.animate) return Promise.resolve();
    leaving = true;
    el.classList.add('is-leaving');
    const quiet = U.reduced();
    const ms = quiet ? 140 : 300;
    const bg = el.querySelector('.al-bg');
    const fade = bg ? bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms + 120, delay: quiet ? 0 : 60, easing: 'linear', fill: 'forwards' }) : null;
    const parts = el.querySelectorAll('.al-top > *, .al-clock, .al-banner, .al-grid > *, .al-map, .al-search > *, .al-count, .al-actions > *');
    return Promise.all([U.actFoldAway(parts, { ms }), fade ? fade.finished.catch(() => {}) : null]).then(() => {
      leaving = false;
      el.classList.remove('is-leaving');
      if (fade) fade.cancel();
    });
  }
  U.act.alDiscardNow = () => discard(true);
  U.act.alDiscard = () => discard(false);
  // Its options while it records: auto-pause (for this kind of activity from now on too) and the
  // spoken splits, which the recorder takes at once, then discarding it.
  U.act.alMenu = () => {
    if (!live()) return;
    const a = U.S.actLive;
    const tp = A().typeOf(a.type);
    const st = L && L.st;
    const auto = st && st.active && st.opts ? st.opts.autoPause : A().autoOn(U.S, a.type);
    U.sheet({
      title: tp.label, size: 'fit', cls: 'al-menu',
      body: `<ul class="rf-list">
        ${a.noGps ? '' : `<li>${U.sw('Auto-pause', auto, 'data-on="alAuto"', 'The clock stops while you stand still')}</li>`}
        <li>${U.sw('Spoken splits', voiceOn(U.S), 'data-on="actVoice"', `Each ${U.actUnitLong()}: the distance, the time and its pace, said aloud`)}</li>
        ${U.row({ icon: 'trash', tone: 'rose', title: `Discard this ${U.esc(tp.noun)}`, sub: 'Stops recording and saves nothing', act: 'alDiscard' })}
      </ul>`,
    });
  };
  U.on.alAuto = (sw, ev, v) => {
    if (!live() || U.S.actLive.noGps) return;
    const t = U.S.actLive.type;
    const pr = U.S.profile.prefs;
    pr.actAuto = Object.assign({}, pr.actAuto || {}, { [t]: !!v });
    U.save();
    // Turned off while it had stopped the clock: the clock goes on (the switch's feel is enough).
    if (L) L.byHand = Date.now();
    R().setOptions({ autoPause: !!v });
  };

  /* ---------------------------------------------------------------- the way back, while tucked away */
  function clockText() { return U.actClock(moving(Date.now()) / 1000); }
  // Today: a pill in the floating row.
  U.actFloat = () => {
    if (!live() || shown()) return '';
    const tp = A().typeOf(U.S.actLive.type);
    const p = paused();
    return `<button type="button" class="rf-btn rf-glass btn-main act-pill" data-variant="tinted" data-size="lg"${U.floatKey ? U.floatKey('main') : ''} data-act="actOpenLive" data-hue="${tp.hue}" aria-label="${U.esc(`${tp.label} in progress, ${p ? 'paused' : 'recording'}. Open`)}"><span class="act-pill-dot"${p ? ' data-paused' : ''} aria-hidden="true"></span><span>${U.esc(tp.label)} · <span class="rf-num" data-act-clock>${U.esc(clockText())}</span></span></button>`;
  };
  // The other tabs: the capsule over the tab bar.
  U.actAccessory = () => {
    if (!live() || shown()) return '';
    const a = U.S.actLive;
    const tp = A().typeOf(a.type);
    const dist = L && L.tr && L.tr.pts.length ? L.tr.distanceM : L && L.st ? L.st.distanceM : 0;
    return `<span class="rf-activity-leading act-cap-ic" data-tone="${tp.hue}" style="width:36px;height:36px">${U.actTypeIcon(a.type, 'sm')}</span>
      <span class="acc-text"><b>${U.esc(tp.label)}${paused() ? ', paused' : ''}</b><span class="t-caption rf-secondary"><span class="rf-num" data-act-clock>${U.esc(clockText())}</span>${a.goAt && !a.noGps ? ` · ${U.esc(U.actFmtDist(dist))}` : ''}</span></span>
      <span class="rf-spacer"></span>
      <button type="button" class="rf-btn" data-size="sm" data-act="actOpenLive" aria-label="${U.esc(`Open the ${tp.noun}`)}">Open</button>`;
  };
  // The clocks tick in place. When Today's pill gains a digit (9:59, then 10:00) it shape-shifts to its
  // new width instead of jumping (U.motion.shift: the floating row's buttons are keyed).
  function capsuleClock() {
    if (!live() || shown()) { if (capTimer) { clearInterval(capTimer); capTimer = null; } return; }
    const txt = clockText();
    const set = (c) => { if (c.textContent !== txt) c.textContent = txt; };
    for (const c of document.querySelectorAll('[data-act-clock]')) {
      const row = c.textContent.length !== txt.length && c.closest('#float');
      if (row && U.motion && U.motion.shift) U.motion.shift(row, () => set(c)); else set(c);
    }
    if (!capTimer) capTimer = setInterval(capsuleClock, 1000);
  }

  /* ---------------------------------------------------------------- opening the app */
  // An activity still recording opens straight away; one that finished while the app was away (from
  // the notification, or the app was closed) is saved, and says so or opens (open: go to its summary).
  // Returns the activity it saved, if any.
  function resume(fromBoot, open) {
    const S = U.S;
    if (!S || !S.profile || !S.profile.onboarded) return null;
    if (fromBoot) A().web.wake();
    if (L && L.phase === 'saving') return null; // being saved already; that opens its summary
    let saved = null;
    const seen = new Set();
    // The recorder keeps finished recordings until they're cleared, newest first: one at a time.
    for (let i = 0; i < 5; i++) {
      const st = R().state();
      if (st.active) { adopt(st, fromBoot); return saved; }
      if (!st.id || seen.has(st.id)) break;
      seen.add(st.id);
      const a = S.actLive;
      if (a && a.id === st.id && a.goAt) {
        const act = keep(st, open, saved);
        saved = saved || act;
      } else if (A().get(S, st.id) || (a && a.id === st.id)) {
        // Saved already, or finished before its clock started: nothing to keep.
        R().clear(st.id);
        if (a && a.id === st.id) drop();
      } else if (!a && (st.elapsedMs || 0) >= 60000) {
        // Not one the page knows (a backup was restored while it recorded): kept all the same.
        S.actLive = fromState(st);
        const act = keep(st, open, saved);
        saved = saved || act;
      } else R().clear(st.id);
    }
    if (S.actLive && !(R().state().id === S.actLive.id)) drop();
    return saved;
  }
  const fromState = (st) => ({ id: st.id, type: A().TYPES[st.type] ? st.type : 'other', title: st.title || A().defaultTitle(st.type, st.startedAt || Date.now()), startedAt: st.startedAt || Date.now(), goAt: st.paused && !(st.elapsedMs > 1500) ? null : st.startedAt || Date.now(), pauses: [], splits: 0 });
  // Still recording: back to the live screen (or its pill and capsule).
  function adopt(st, fromBoot) {
    const S = U.S;
    if (!S.actLive || S.actLive.id !== st.id) {
      S.actLive = fromState(st);
      U.save(true);
      L = null;
    }
    if (!L) { L = fresh(S.actLive.goAt ? 'live' : 'search'); L.st = st; }
    if (fromBoot || shown()) openLive();
    else { onState(st, true); U.render(); }
  }
  // Finished while the page wasn't there: saved, then its summary opens (asked to, or the live screen
  // was showing) or a note says so.
  function keep(st, open, earlier) {
    const wasShown = shown();
    if (!L) L = fresh('saving');
    L.phase = 'saving';
    const act = save(st, null, !earlier && (open || wasShown));
    if (act && !earlier && !(open || wasShown)) U.toast(`Your ${A().typeOf(act.type).noun} was saved`, 'positive', `${act.distanceM > 0 ? `${U.actFmtDist(act.distanceM)} in ` : ''}${U.actFmtTime(act.movingMs)}`, { label: 'View', onClick: () => U.open('activity', act.id) });
    return act;
  }
  // The page's activity has no recording behind it any more.
  function drop() {
    U.S.actLive = null;
    L = null;
    stopTimer();
    dropMap();
    U.save(true);
    if (el) { el.hidden = true; el.textContent = ''; steady(); }
    if (offBack) { offBack(); offBack = null; }
    U.render();
  }
  U.actResume = resume;
  const earlierAfterBoot = U.afterBoot;
  U.afterBoot = () => {
    try { resume(true); } catch (e) { if (G.console) G.console.error(e); }
    if (U.actRecheck) setTimeout(() => U.actRecheck(), 2000);
    if (earlierAfterBoot) earlierAfterBoot();
  };
  plat().on('resume', () => { try { if (live() || R().state().id) resume(false); } catch (e) { /* ignore */ } });
  // The notification's tap: the live screen while recording, else the summary of the one that just
  // finished (saving it first if the page hadn't yet).
  plat().on('route', (route) => {
    if (route !== 'activity' || !U.S || !U.S.profile || !U.S.profile.onboarded) return;
    try {
      if (R().state().active) { resume(false); openLive(); return; }
      if (resume(false, true)) return;
      if (L && L.phase === 'saving') return;
      const last = A().list(U.S)[0];
      if (last && Date.now() - last.end < 6 * 3600000) { const top = U.topSheet(); if (top) top.close('cancel'); U.open('activity', last.id); }
    } catch (e) { if (G.console) G.console.error(e); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
