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
        s.onload = () => (GH[name] ? resolve(GH[name]) : reject(new Error(`${name} did not load`)));
        s.onerror = () => reject(new Error(`${name} could not be loaded`));
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
  // False when the phone's own touch feedback is switched off (then taps don't buzz at all).
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

  // Short haptics for UI events (see Haptics.java for what each one feels like). The Android app plays
  // the phone's own tuned effects; a browser gets a short buzz where it can.
  const BUZZ = { tap: 8, select: 6, tick: 5, toggleOn: 10, toggleOff: 7, success: [10, 60, 16], error: [22, 50, 22], heavy: 24, go: [8, 40, 18], done: [20, 70, 10], celebrate: [10, 60, 10, 60, 26] };
  let lastHaptic = 0;
  function haptic(kind) {
    if (!prefs.haptics) return;
    const now = Date.now();
    if (now - lastHaptic < 35 && (kind === 'tick' || kind === 'select')) return; // don't stack ticks
    lastHaptic = now;
    try {
      const b = bridge();
      if (b && b.haptic) { b.haptic(String(kind)); return; }
      if (G.navigator && G.navigator.vibrate && G.navigator.userActivation && G.navigator.userActivation.hasBeenActive) {
        // Browser fallback: scale the pulse lengths with the chosen strength.
        const k = prefs.hapticStrength === 'light' ? 0.7 : prefs.hapticStrength === 'strong' ? 1.6 : 1.2;
        const buzz = BUZZ[kind] || 8;
        G.navigator.vibrate(Array.isArray(buzz) ? buzz.map((x, i) => (i % 2 ? x : Math.round(x * k))) : Math.round(buzz * k));
      }
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
  // Cues for the player: a countdown tick, go, and the end of a timer.
  function cue(kind) {
    if (prefs.sound) {
      if (kind === 'tick') tone(880, 90);
      else if (kind === 'go') tone(1320, 240);
      else if (kind === 'done') { tone(988, 150); tone(1319, 280, 170); }
      else tone(1047, 160);
    }
    if (kind === 'tick') vibrate(35);
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
  function setDensity(v) { const r = R(); if (r && r.setDensity) r.setDensity(v); }
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
  function claudeInstalled() { try { const b = bridge(); return !!(b && b.claudeInstalled && b.claudeInstalled()); } catch (e) { return false; } }
  function reducedMotion() {
    const r = R();
    if (r && r.prefs) return r.prefs.reducedMotion;
    try { return G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  const isApp = () => !!bridge();

  GH.platform = { setPrefs, hapticsSystemEnabled, keepAwake, haptic, vibrate, cue, unlockAudio, applyTheme, currentTheme, setDensity, onBack, on, emit, visible, copy, openUrl, share, claudeInstalled, appVersion, reducedMotion, isApp };
})(typeof window !== 'undefined' ? window : globalThis);
