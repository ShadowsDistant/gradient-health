/* Device glue: keep the screen awake, haptics, vibration, beeps, theme and system bars, safe-area
 * insets, the Android back button and the hooks the Android shell calls on window.__gh. Everything
 * works (or quietly does nothing) in a plain browser too.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const doc = G.document;

  /* ---------------------------------------------------------------- lazy parts */
  // Heavy modules (the 3D figure, the on-device model runtime, the barcode reader) live in lazy/ next
  // to the page and load the first time they're needed. Each one sets GH[name] when it runs.
  const lazyLoads = {};
  GH.lazy = (name) => {
    if (GH[name]) return Promise.resolve(GH[name]);
    if (!lazyLoads[name]) {
      lazyLoads[name] = new Promise((resolve, reject) => {
        if (!doc) { reject(new Error('no document')); return; }
        const s = doc.createElement('script');
        s.src = `lazy/${name}.js`;
        s.async = true;
        // A failed script tag goes, so the next try adds a fresh one.
        s.onload = () => { if (GH[name]) resolve(GH[name]); else { s.remove(); reject(new Error(`${name} did not load`)); } };
        s.onerror = () => { s.remove(); reject(new Error(`${name} could not be loaded`)); };
        doc.head.appendChild(s);
      }).catch((e) => { delete lazyLoads[name]; throw e; });
    }
    return lazyLoads[name];
  };

  let prefs = { sound: true, vibrate: true, haptics: true };
  function setPrefs(p) {
    const before = prefs.hapticStrength;
    prefs = Object.assign({}, prefs, p || {});
    if (prefs.hapticStrength !== before) {
      const b = bridge();
      if (b && b.hapticStrength) { try { b.hapticStrength(String(prefs.hapticStrength || 'medium')); } catch (e) { /* ignore */ } }
    }
  }
  // False when the phone's own touch feedback is switched off (then the UI kinds of haptic don't buzz;
  // events like the workout timer's still do).
  function hapticsSystemEnabled() {
    const b = bridge();
    try { return b && b.hapticsSystemEnabled ? !!b.hapticsSystemEnabled() : true; } catch (e) { return true; }
  }

  /* ---------------------------------------------------------------- screen on */
  let wakeLock = null;
  let wantAwake = false;
  async function requestWakeLock() {
    try {
      if (G.navigator && G.navigator.wakeLock && doc && doc.visibilityState === 'visible') {
        wakeLock = await G.navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  function keepAwake(on) {
    wantAwake = !!on;
    const b = bridge();
    if (b && b.keepAwake) { try { b.keepAwake(!!on); } catch (e) { /* ignore */ } return; }
    if (on) requestWakeLock();
    else if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (wantAwake && !bridge() && doc.visibilityState === 'visible' && !wakeLock) requestWakeLock(); });

  /* ---------------------------------------------------------------- vibration + sound */
  function vibrate(pattern) {
    if (!prefs.vibrate) return;
    const arr = (Array.isArray(pattern) ? pattern : [pattern]).map((x) => Math.max(0, Math.round(x)));
    try {
      const b = bridge();
      if (b && b.vibratePattern) { b.vibratePattern(JSON.stringify([0].concat(arr))); return; } // [off, on, off, …]
      if (G.navigator && G.navigator.vibrate) G.navigator.vibrate(arr);
    } catch (e) { /* ignore */ }
  }

  // Haptics, each kind with a feel of its own (Haptics.java has what each one is). UI kinds: tap, select,
  // tick (slider steps), toggleOn, toggleOff, detent (a sheet snapping to a height). Events: countdown
  // (the 3-2-1 before a timer ends), go, done (a hold or rest is over), success, warning, error, heavy
  // (destructive confirmations), celebrate. The Android app plays its own compositions; a browser gets
  // these on/off patterns with the same rhythm, [on, off, on, …] in ms at Strong. Light and Medium
  // shorten the pulses by the same 0.55 and 0.8 the app scales its strength by.
  const HAPTIC_PATTERNS = {
    tap: [18], select: [11], tick: [8], toggleOn: [8, 24, 18], toggleOff: [16, 24, 8], detent: [22, 20, 8],
    countdown: [26], go: [10, 30, 16, 30, 34], done: [22, 90, 22, 90, 50], success: [14, 70, 24], warning: [48],
    error: [40, 60, 40], heavy: [70], celebrate: [10, 30, 24, 70, 20, 60, 30, 20, 50],
  };
  const HAPTIC_STRENGTH = { light: 0.55, medium: 0.8, strong: 1 };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const hapticKind = (kind) => (own(HAPTIC_PATTERNS, kind) ? kind : 'tap'); // an unknown name is a tap
  function hapticPattern(kind, strength) {
    const k = own(HAPTIC_STRENGTH, strength) ? HAPTIC_STRENGTH[strength] : HAPTIC_STRENGTH.medium;
    return HAPTIC_PATTERNS[hapticKind(kind)].map((x, i) => (i % 2 ? x : Math.max(4, Math.round(x * k))));
  }
  // A phone plays one vibration at a time, and a new one cuts the last short. So a haptic doesn't cut
  // in on a bigger one that's still playing: UI kinds rank lowest, then the countdown, then events,
  // with errors, heavy and celebrate on top.
  const HAPTIC_RANK = { countdown: 1, go: 2, done: 2, success: 2, warning: 2, error: 3, heavy: 3, celebrate: 3 };
  let last = { kind: '', at: -1e9, until: 0, rank: 0 };
  function haptic(kind) {
    if (!prefs.haptics) return;
    const k = hapticKind(kind);
    const now = Date.now();
    const rank = HAPTIC_RANK[k] || 0;
    // Ticks (slider steps) don't stack; otherwise the same kind twice at once is one moment reported
    // twice (a toast after its action's own haptic).
    if (k === 'tick' || k === 'select' ? now - last.at < 35 : k === last.kind && now - last.at < 80) return;
    if (rank < last.rank && now < last.until) return;
    last = { kind: k, at: now, until: now + HAPTIC_PATTERNS[k].reduce((a, x) => a + x, 0) + 60, rank };
    try {
      const b = bridge();
      if (b && b.haptic) { b.haptic(k); return; }
      if (G.navigator && G.navigator.vibrate && G.navigator.userActivation && G.navigator.userActivation.hasBeenActive) G.navigator.vibrate(hapticPattern(k, prefs.hapticStrength));
    } catch (e) { /* ignore */ }
  }

  let audio = null;
  function ctx() {
    if (!audio) {
      const AC = G.AudioContext || G.webkitAudioContext;
      if (!AC) return null;
      try { audio = new AC(); } catch (e) { return null; }
    }
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  }
  function tone(freq, ms, delay, vol) {
    const a = ctx();
    if (!a) return;
    try {
      const t0 = a.currentTime + (delay || 0) / 1000;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + ms / 1000 + 0.03);
    } catch (e) { /* ignore */ }
  }
  // Audio needs a user gesture before it may start.
  function unlockAudio() { if (prefs.sound) ctx(); }
  // Cues for the player and the plank test: 'countdown' (each of the 3-2-1 before a timer starts or
  // ends; 'tick' is the old name), 'go', and 'done' (the end of a timer or rest). The sound follows
  // the Sound switch and the buzz the Vibration switch. In the app with haptics on, that buzz is the
  // haptic for the moment instead of a plain one on top of it: Android plays one vibration at a time,
  // so the two would cut each other short (and the plain one, an alarm-class buzz, would win). Not
  // while the app is out of sight, though (a rest counting down under another app, or with the screen
  // off): Android only lets alarm-class vibrations through then, so it's the plain buzz.
  const CUE_HAPTIC = { countdown: 'countdown', tick: 'countdown', go: 'go', done: 'done' };
  function cue(kind) {
    if (prefs.sound) {
      if (CUE_HAPTIC[kind] === 'countdown') tone(880, 90);
      else if (kind === 'go') tone(1320, 240);
      else if (kind === 'done') { tone(988, 150); tone(1319, 280, 170); }
      else tone(1047, 160);
    }
    if (!prefs.vibrate) return;
    const b = bridge();
    if (prefs.haptics && b && b.haptic && own(CUE_HAPTIC, kind) && visible()) { haptic(CUE_HAPTIC[kind]); return; }
    if (CUE_HAPTIC[kind] === 'countdown') vibrate(35);
    else if (kind === 'go') vibrate(140);
    else if (kind === 'done') vibrate([140, 90, 220]);
    else vibrate(60);
  }

  /* ---------------------------------------------------------------- theme */
  let themePref = 'system';
  let themeContrast = false;
  let stopAuto = null;
  let osDark = null; // what the Android shell last said
  const R = () => G.Refract;
  function contrastWanted() { try { return !!(G.matchMedia && G.matchMedia('(prefers-contrast: more)').matches); } catch (e) { return false; } }
  function setThemeId(id) {
    const r = R();
    if (r && r.theme && r.theme.set) r.theme.set(id);
    else if (doc) doc.documentElement.setAttribute('data-theme', id);
  }
  function systemDark() {
    if (osDark != null) return osDark;
    try { const b = bridge(); if (b && b.isDark) return !!b.isDark(); } catch (e) { /* ignore */ }
    try { return !!(G.matchMedia && G.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }
  // pref: system | light | dark; contrast: the Increase contrast setting on top of it.
  function applyTheme(pref, contrast) {
    // Nothing to do when it comes out the same: Settings applies the prefs after every change, and a
    // theme change makes every glass lens on the page re-measure.
    const nextPref = pref || 'system', nextContrast = contrast != null ? !!contrast : themeContrast;
    if (nextPref === themePref && nextContrast === themeContrast && doc && doc.documentElement.hasAttribute('data-theme')) {
      const hc = nextContrast || contrastWanted();
      const following = nextPref === 'system' && !(bridge() || nextContrast) && R() && R().theme && R().theme.auto;
      const want = (nextPref === 'system' ? (systemDark() ? 'dark' : 'light') : nextPref === 'dark' ? 'dark' : 'light') + (hc ? '-contrast' : '');
      if (following ? !!stopAuto : !stopAuto && doc.documentElement.getAttribute('data-theme') === want) return;
    }
    themePref = pref || 'system';
    if (contrast != null) themeContrast = !!contrast;
    if (stopAuto) { try { stopAuto(); } catch (e) { /* ignore */ } stopAuto = null; }
    const hc = themeContrast || contrastWanted();
    if (themePref === 'system') {
      if (bridge() || themeContrast || !(R() && R().theme && R().theme.auto)) setThemeId((systemDark() ? 'dark' : 'light') + (hc ? '-contrast' : ''));
      else stopAuto = R().theme.auto();
    } else setThemeId((themePref === 'dark' ? 'dark' : 'light') + (hc ? '-contrast' : ''));
    const dark = currentTheme().startsWith('dark');
    if (doc) {
      const meta = doc.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', dark ? '#0b0c10' : '#f1f2f6');
    }
    // Status and navigation bar icons follow the page, which can differ from the phone's theme.
    try { const b = bridge(); if (b && b.setSystemBars) b.setSystemBars(dark); } catch (e) { /* ignore */ }
  }
  function currentTheme() {
    const r = R();
    if (r && r.theme && r.theme.get) return r.theme.get();
    return (doc && doc.documentElement.getAttribute('data-theme')) || 'light';
  }
  // The same density again is no change (and setting it makes every lens re-measure).
  let density = null;
  function setDensity(v) { if (v === density) return; const r = R(); if (r && r.setDensity) { r.setDensity(v); density = v; } }
  hooks.setTheme = (mode) => { osDark = mode === 'dark'; if (themePref === 'system') applyTheme('system'); };

  /* ---------------------------------------------------------------- back button + shell hooks */
  const backStack = [];
  // Handlers run newest first; one that returns true consumed the press.
  function onBack(fn) { backStack.push(fn); return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); }; }
  hooks.back = () => {
    for (let i = backStack.length - 1; i >= 0; i--) {
      try { if (backStack[i]() === true) return true; } catch (e) { /* keep going */ }
    }
    return false;
  };
  const listeners = { resume: [], route: [] };
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, arg) { for (const fn of listeners[evt] || []) { try { fn(arg); } catch (e) { /* ignore */ } } }
  let shown = true;
  hooks.onResume = () => { shown = true; emit('resume'); };
  hooks.onPause = () => { shown = false; emit('pause'); };
  hooks.openRoute = (route) => emit('route', route);
  if (doc) doc.addEventListener('visibilitychange', () => { if (!bridge()) { shown = doc.visibilityState === 'visible'; if (shown) emit('resume'); } });
  const visible = () => shown && (!doc || doc.visibilityState !== 'hidden');

  /* ---------------------------------------------------------------- safe-area insets */
  // The app draws behind the status and navigation bars. The shell reports their size in CSS pixels
  // and the page pads itself with --sat/--sab/--sal/--sar (env() is the fallback in a browser).
  hooks.setInsets = (o) => {
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return; } }
    if (!o || !doc) return;
    const st = doc.documentElement.style;
    for (const [k, v] of [['--sat', o.top], ['--sab', o.bottom], ['--sal', o.left], ['--sar', o.right]]) st.setProperty(k, `${Math.max(0, Number(v) || 0)}px`);
    doc.documentElement.toggleAttribute('data-keyboard', !!o.keyboard);
    emit('insets', o);
  };
  try { const b = bridge(); if (b && b.insets) hooks.setInsets(b.insets()); } catch (e) { /* ignore */ }

  /* ---------------------------------------------------------------- misc */
  async function copy(text) {
    try { const b = bridge(); if (b && b.copy) return !!b.copy(text); } catch (e) { /* fall through */ }
    try { await G.navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }
  function openUrl(url) {
    if (!/^https:\/\//.test(url)) return;
    try { const b = bridge(); if (b && b.openUrl) { b.openUrl(url); return; } } catch (e) { /* fall through */ }
    try { G.open(url, '_blank', 'noopener'); } catch (e) { /* ignore */ }
  }
  // e.g. "1.1.0 (29844162)" in the app, "1.1.0" in a browser.
  function appVersion() { try { const b = bridge(); if (b && b.appVersion) { const v = b.appVersion(); if (v) return v; } } catch (e) { /* ignore */ } return GH.VERSION || ''; }
  // Sends text to another app: the Claude app when it's installed (target 'claude'), else the share sheet.
  function share(text, target) {
    try { const b = bridge(); if (b && b.shareText) { b.shareText(String(text), target || ''); return true; } } catch (e) { /* fall through */ }
    try { if (G.navigator && G.navigator.share) { G.navigator.share({ text: String(text) }).catch(() => {}); return true; } } catch (e) { /* ignore */ }
    return false;
  }
  // Sends a picture (a PNG as base64) and a line of text to another app: Android's share sheet in
  // the app; in a browser the Web Share API with a file where there is one, else a download (and,
  // if even that fails, the text is copied). Resolves true once it's on its way.
  async function shareImage(b64, text, name) {
    const msg = String(text || '');
    try { const b = bridge(); if (b && b.shareImage) return !!b.shareImage(String(b64), msg); } catch (e) { return false; }
    const file = /^[\w.-]{1,80}\.png$/.test(name || '') ? name : 'badge.png';
    let blob;
    try {
      const bin = G.atob(String(b64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new G.Blob([bytes], { type: 'image/png' });
    } catch (e) { return false; }
    const nav = G.navigator || {};
    try {
      const f = new G.File([blob], file, { type: 'image/png' });
      if (nav.canShare && nav.share && nav.canShare({ files: [f] })) { await nav.share({ files: [f], text: msg }); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    try {
      const url = G.URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url; a.download = file; a.rel = 'noopener';
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => G.URL.revokeObjectURL(url), 30000);
      return true;
    } catch (e) { /* below */ }
    return copy(msg);
  }
  function claudeInstalled() { try { const b = bridge(); return !!(b && b.claudeInstalled && b.claudeInstalled()); } catch (e) { return false; } }
  function reducedMotion() {
    const r = R();
    if (r && r.prefs) return r.prefs.reducedMotion;
    try { return G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  const isApp = () => !!bridge();

  GH.platform = { setPrefs, hapticsSystemEnabled, keepAwake, haptic, hapticPattern, hapticKinds: Object.keys(HAPTIC_PATTERNS), vibrate, cue, unlockAudio, applyTheme, currentTheme, setDensity, onBack, on, emit, visible, copy, openUrl, share, shareImage, claudeInstalled, appVersion, reducedMotion, isApp };
})(typeof window !== 'undefined' ? window : globalThis);
