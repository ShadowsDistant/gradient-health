/* Persistence. The state lives in localStorage ("gh.v1") and, inside the app, in an atomic file
 * through the Android bridge; on load the copy with the newer updatedAt wins. Backups are the
 * state as JSON. The AI coach key is not part of the state: it sits in the bridge's private
 * preferences (or its own localStorage entry in a plain browser) and never reaches a backup.
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
    return !!(S && typeof S === 'object' && S.profile && typeof S.profile === 'object' && Array.isArray(S.events) && Array.isArray(S.log) && S.prog && typeof S.prog === 'object');
  }

  // Older or partial states get every field the app expects.
  function migrate(S) {
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
    }
    // 1.2: food tracking. Its mode starts from the 1.1 protein switch, and the food log is empty.
    if (S.profile && GH.food) {
      const had = S.profile.food && S.profile.food.mode;
      GH.food.prefs(S);
      if (!had) S.profile.food.mode = S.profile.protein && S.profile.protein.track === false ? 'off' : 'protein';
      GH.food.data(S);
    }
    if (GH.brain && GH.brain.relink) GH.brain.relink(S);
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

  // Backup: the whole state, no key. Restore validates before it replaces anything.
  function exportJson(S) {
    const copy = stripSecrets(JSON.parse(JSON.stringify(S)));
    return JSON.stringify({ app: 'gradient-health', schema: SCHEMA, exportedAt: new Date().toISOString(), state: copy });
  }
  function importJson(txt) {
    const o = parse(typeof txt === 'string' ? txt.trim() : '');
    if (!o) return { ok: false, error: 'That isn\'t a Gradient Health backup. Paste the whole text from Copy my data.' };
    const S = o.app === 'gradient-health' && o.state ? o.state : o;
    if (!valid(S)) return { ok: false, error: 'That backup is missing parts. Paste the whole text from Copy my data.' };
    if ((o.schema || S.v || 1) > SCHEMA) return { ok: false, error: 'That backup is from a newer version of Gradient Health. Update the app first.' };
    return { ok: true, state: migrate(S), workouts: S.log.filter((l) => l.type === 'workout').length, since: S.profile.startDay };
  }

  function clear() {
    lsDel(KEY);
    try { const b = bridge(); if (b && b.save) b.save(''); } catch (e) { /* nothing to clear */ }
  }

  // Secrets (the AI coach key). Never logged, never in the state or a backup.
  function loadSecret(name) {
    try { const b = bridge(); if (b && b.loadSecret) { const v = b.loadSecret(name); if (v) return String(v); } } catch (e) { /* fall through */ }
    return lsGet(SECRET_PREFIX + name) || '';
  }
  function saveSecret(name, value) {
    let ok = false;
    try { const b = bridge(); if (b && b.saveSecret) ok = !!b.saveSecret(name, value); } catch (e) { ok = false; }
    if (ok) { lsDel(SECRET_PREFIX + name); return true; } // one copy, in the app's private preferences
    return lsSet(SECRET_PREFIX + name, value);
  }
  function deleteSecret(name) {
    try { const b = bridge(); if (b && b.deleteSecret) b.deleteSecret(name); } catch (e) { /* ignore */ }
    lsDel(SECRET_PREFIX + name);
  }

  GH.store = { KEY, SCHEMA, load, save, saveSoon, flush, exportJson, importJson, clear, migrate, valid, loadSecret, saveSecret, deleteSecret };
})(typeof window !== 'undefined' ? window : globalThis);
