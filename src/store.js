/* Persistence. Inside the app the state lives in an atomic file through the Android bridge; in a
 * plain browser (and with an app older than 1.6) it's in localStorage ("gh.v1") too. On load the
 * copy with the newer updatedAt wins. Backups are the state as JSON. The AI coach key is not part
 * of the state: it sits in the bridge's private preferences (or its own localStorage entry in a
 * plain browser) and never reaches a backup.
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
    flush(); // a save still waiting is written first, so this reads it
    const localTxt = lsGet(KEY);
    let fileTxt = null;
    try { const b = bridge(); if (b && b.load) fileTxt = b.load(); } catch (e) { fileTxt = null; }
    localCopy = !!localTxt;
    // Usually there's one copy (the app's file, or localStorage in a browser) or two with the same
    // text, and only that one is parsed. Two different ones (a write that failed, an older app)
    // are both read, and the newer valid one wins.
    if (!(localTxt && fileTxt) || localTxt === fileTxt) {
      const one = parse(fileTxt || localTxt);
      return valid(one) ? migrate(one) : null;
    }
    const local = parse(localTxt), file = parse(fileTxt);
    const a = valid(local) ? local : null;
    const b = valid(file) ? file : null;
    const pick = !a ? b : !b ? a : (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
    return pick ? migrate(pick) : null;
  }

  // Saving never runs in the tap that changed something: the state waits for the page to be idle
  // (a second at most), then its JSON goes to the app's bridge, which writes it on a thread of its
  // own (saveAsync). Changes made meanwhile ride along, so a burst of taps is one write. Inside the
  // app that file is the only copy; in a plain browser, the tests or an app too old for saveAsync,
  // it's written to localStorage and the bridge's file at once, as before 1.6. When the page is
  // hidden or goes away, a waiting save is written right away (flush), and the bridge's save()
  // returns only once the file is on disk. Without idle callbacks (node), save() writes at once.
  let waiting = null; // the state to write next
  let job = 0; // its idle callback or timer
  let localCopy = true; // whether localStorage may hold a full copy (dropped once the app has the file)
  const canWait = !!(G.requestIdleCallback && G.document);
  function save(S) {
    if (!S) return false;
    if (!canWait) { cancelWaiting(); return write(S, true); }
    schedule(S, 1000);
    return true;
  }
  function saveSoon(S, ms) {
    if (!S) return;
    schedule(S, ms != null ? ms : canWait ? 1000 : 300);
  }
  function schedule(S, ms) {
    waiting = S;
    if (job) return;
    const run = () => { job = 0; const s = waiting; waiting = null; if (s) write(s, false); };
    job = canWait ? G.requestIdleCallback(run, { timeout: ms }) : setTimeout(run, ms);
  }
  function cancelWaiting() {
    if (job) { if (canWait) G.cancelIdleCallback(job); else clearTimeout(job); job = 0; }
    waiting = null;
  }
  function flush() {
    if (!waiting) return;
    const S = waiting;
    cancelWaiting();
    write(S, true);
  }
  function write(S, now) {
    S.updatedAt = Date.now();
    stripSecrets(S);
    let txt;
    try { txt = JSON.stringify(S); } catch (e) { return false; }
    const b = bridge();
    const app = !!(b && b.saveAsync);
    if (app && !now) {
      let ok = false;
      try { ok = !!b.saveAsync(txt); } catch (e) { ok = false; }
      if (ok) { dropLocal(); return true; }
    }
    let okFile = false;
    try { if (b && b.save) okFile = !!b.save(txt); } catch (e) { okFile = false; }
    if (app && okFile) { dropLocal(); return true; }
    // A plain browser, or the app's file couldn't be written: localStorage keeps a copy.
    const okLocal = lsSet(KEY, txt);
    if (okLocal) localCopy = true;
    return okLocal || okFile;
  }
  function dropLocal() { if (localCopy) { lsDel(KEY); localCopy = false; } }
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
    cancelWaiting(); // a save still waiting would bring the old state back
    lsDel(KEY);
    // What's kept next to the state (gh.v1.*, like the insights a launch reuses) goes with it.
    try { for (let i = G.localStorage ? G.localStorage.length - 1 : -1; i >= 0; i--) { const k = G.localStorage.key(i); if (k && k.startsWith(KEY + '.')) lsDel(k); } } catch (e) { /* private mode */ }
    try { const b = bridge(); if (b && b.save) b.save(''); } catch (e) { /* nothing to clear */ }
    // 1.4: an outdoor activity recording (or finished and not saved yet) goes too.
    if (GH.activity && GH.activity.reset) GH.activity.reset();
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
