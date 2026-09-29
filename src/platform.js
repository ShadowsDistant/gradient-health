/* Device glue: keep the screen awake, vibration, beeps, theme, the Android back button and the
 * hooks the Android shell calls on window.__gh. Everything works (or quietly does nothing) in a
 * plain browser too.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const doc = G.document;

  let prefs = { sound: true, vibrate: true };
  function setPrefs(p) { prefs = Object.assign({}, prefs, p || {}); }

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
    if (doc) {
      const meta = doc.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', currentTheme().startsWith('dark') ? '#0b0c10' : '#f1f2f6');
    }
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
  hooks.onResume = () => emit('resume');
  hooks.openRoute = (route) => emit('route', route);
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible' && !bridge()) emit('resume'); });

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
  function appVersion() { try { const b = bridge(); if (b && b.appVersion) return b.appVersion(); } catch (e) { /* ignore */ } return ''; }
  function reducedMotion() {
    const r = R();
    if (r && r.prefs) return r.prefs.reducedMotion;
    try { return G.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  const isApp = () => !!bridge();

  GH.platform = { setPrefs, keepAwake, vibrate, cue, unlockAudio, applyTheme, currentTheme, setDensity, onBack, on, emit, copy, openUrl, appVersion, reducedMotion, isApp };
})(typeof window !== 'undefined' ? window : globalThis);
