/* Updates from the app's own GitHub release, the page's side (Updater.java fetches, checks and
 * installs; docs/DEVELOPING.md, Updates):
 * - Settings, About: Check for updates, with the version and what the last check found, and Check
 *   automatically (U.updateRows);
 * - the automatic check: once a day at most, a few seconds after the app opens or comes back, only in
 *   the Android app, never during a workout or an activity, and only once the person has said yes
 *   (Today asks once: the app sends nothing anywhere new without asking);
 * - Today's card when a new version is ready (U.updateCard): Not now waits for the next version;
 * - the update sheet: what's new, the size, Update (a progress bar and Cancel), then Install, which
 *   hands it to Android's own install screen.
 * In a browser, the Play build (it has no permission to install apps) or one Google Play installed,
 * nothing checks: Settings says where updates come from. GH.update holds the rules
 * (test/update.mjs). What the person chose (the switch, the last check, a card dismissed) is kept for
 * this phone in localStorage ('gh.v1.update', which Reset everything deletes with the state).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const P = () => GH.platform || null;
  const DAY = 864e5, HOUR = 36e5;
  const AUTO_DELAY = 5000; // after the app opens or comes back
  const KEY = 'gh.v1.update';

  /* ---------------------------------------------------------------- the rules */
  // Two versions, "1.11.0" against "1.10.2": > 0 when a is newer, number by number.
  function compare(a, b) {
    const pa = String(a || '').split('.'), pb = String(b || '').split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || '0', y = pb[i] || '0';
      const nx = /^\d+$/.test(x) ? Number(x) : NaN, ny = /^\d+$/.test(y) ? Number(y) : NaN;
      if (nx === nx && ny === ny) { if (nx !== ny) return nx - ny; } else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  // What the latest build is to this install: 'none' (nothing newer), 'version' (a new version) or
  // 'build' (a newer build of the same version: main built again without a new one).
  function kind(installed, latest) {
    if (!installed || !latest || !(Number(latest.versionCode) > Number(installed.versionCode))) return 'none';
    return compare(latest.versionName, installed.versionName) > 0 ? 'version' : 'build';
  }
  // Whether the automatic check is due: switched on (not just not asked yet), a day after the last one
  // and an hour after one that failed. A time ahead of now (the clock was put back) doesn't count.
  function due(p, now) {
    if (!p || p.auto !== true) return false;
    const recent = (t, gap) => t > 0 && t <= now + HOUR && now - t < gap;
    return !recent(p.at, DAY) && !recent(p.failedAt, HOUR);
  }
  // Whether Today's card shows: a new version (not only a new build) that hasn't been dismissed.
  function card(p, st) {
    const L = st && st.latest;
    if (kind(st && st.installed, L) !== 'version') return false;
    return !(p && p.dismissed) || compare(L.versionName, p.dismissed) > 0;
  }
  // The store text as a short list: a line each, without the bullets.
  function notesList(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*[•*·-]\s*/, '').trim()).filter(Boolean).slice(0, 12);
  }
  // A size the way the sheet says it: "46 MB", "0.8 MB", the number and its unit kept on one line.
  function mb(bytes) {
    const m = Math.max(0, Number(bytes) || 0) / 1048576;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}\u00a0MB`;
  }
  // Each reason, in plain words: why a check, a download or an install didn't go through.
  const MISMATCH = 'The download didn\'t match what GitHub listed. Try again.';
  const NOT_IT = 'The download wasn\'t the update GitHub listed, so it was deleted.';
  const WHY = {
    offline: 'You\'re offline. Connect and try again.',
    timeout: 'GitHub took too long to answer. Try again in a bit.',
    notfound: 'GitHub had nothing to offer just now. Try again later.',
    http: 'GitHub didn\'t answer properly. Try again later.',
    network: 'Couldn\'t reach GitHub. Check your connection and try again.',
    bad: 'The details on GitHub didn\'t look right, so nothing was downloaded.',
    toobig: 'This update is too big to download in the app. Get it from GitHub instead.',
    space: 'There isn\'t enough free space for it.',
    size: MISMATCH,
    checksum: MISMATCH,
    format: NOT_IT,
    package: NOT_IT,
    version: NOT_IT,
    signature: 'The download isn\'t signed with Gradient Health\'s key, so it was deleted.',
    io: 'The update couldn\'t be saved on this phone.',
    missing: 'The download is gone. Download it again.',
    aborted: 'Not installed. Tap Install when you\'re ready.',
    blocked: 'This phone doesn\'t allow the install.',
    conflict: 'Android couldn\'t install it over this version.',
    incompatible: 'This update doesn\'t work on this phone.',
    invalid: 'Android couldn\'t read the update. Download it again.',
    storage: 'There isn\'t enough space to install it. Free some up and try again.',
    failed: 'Android couldn\'t install the update. Try again.',
  };
  // The same, shorter, after "Couldn't check:" in Settings.
  const SHORT = { offline: 'you\'re offline', timeout: 'GitHub took too long', notfound: 'nothing on GitHub just now', http: 'GitHub didn\'t answer', network: 'couldn\'t reach GitHub', bad: 'the details looked wrong', toobig: 'the update is too big' };
  // Where updates come from when this install doesn't check (Updater.whyNot, or no updater at all).
  const WHERE = {
    store: 'Updates come from Google Play', play: 'Updates come from Google Play',
    key: 'This test build doesn\'t check for updates', app: 'Updates come from where you installed the app', web: 'Updates come from where you installed the app',
  };
  // What Settings' row says for a snapshot: { line, act, btn?, spin? }. act opens the sheet
  // ('updateOpen') or checks again ('updateCheck'); btn is a button's label.
  function rowView(st, now) {
    const s = st || {}, L = s.latest, inst = s.installed || {};
    const k = kind(inst, L), name = L ? L.versionName : '';
    const ver = `Version ${inst.versionName || ''}`.trim();
    switch (s.phase) {
      case 'checking': return { line: `${ver} · checking…`, act: 'updateCheck', spin: true };
      case 'downloading': return { line: `Downloading ${name} · ${s.total ? Math.floor((s.loaded / s.total) * 100) : 0}%`, act: 'updateOpen' };
      case 'verifying': return { line: `Checking the download of ${name}…`, act: 'updateOpen' };
      case 'ready': return { line: s.error ? `${name} is downloaded, not installed yet` : `${name} is downloaded`, act: 'updateOpen', btn: 'Install' };
      case 'permission': return { line: `${name} needs your OK to install`, act: 'updateOpen' };
      case 'installing': case 'confirm': return { line: `Installing ${name}…`, act: 'updateOpen' };
      default: break;
    }
    if (s.phase === 'failed' && s.step !== 'check' && k !== 'none') return { line: `${name} · ${s.step === 'install' ? 'couldn\'t install' : 'the download stopped'}`, act: 'updateOpen' };
    if (k !== 'none') return { line: k === 'build' ? `A newer build of ${name} is ready` : `${name} is ready · you have ${inst.versionName}`, act: 'updateOpen', btn: 'Update' };
    if (s.phase === 'failed') return { line: `${ver} · couldn't check: ${SHORT[s.error] || 'try again later'}`, act: 'updateCheck' };
    if (s.phase === 'current') {
      const old = s.checkedAt > 0 && now - s.checkedAt > DAY;
      return { line: `${ver} · ${old ? `checked ${ago(s.checkedAt, now)}` : 'you\'re up to date'}`, act: 'updateCheck' };
    }
    return { line: ver, act: 'updateCheck' };
  }
  // "3 days ago", "yesterday" (the app's U.ago when it's there).
  function ago(t, now) {
    if (U.ago) return U.ago(t, now);
    const d = Math.round((now - t) / DAY);
    return d <= 1 ? 'yesterday' : `${d} days ago`;
  }
  GH.update = { compare, kind, due, card, notesList, mb, rowView, WHY, SHORT, WHERE, AUTO_DELAY, KEY };

  /* ---------------------------------------------------------------- this phone's choices */
  // { auto: check once a day (true or false once the person has answered, null until then), at: the
  // last check that worked, failedAt: the last that didn't, dismissed: the version whose card was put
  // away }.
  function prefs() {
    let o = null;
    try { o = JSON.parse(G.localStorage.getItem(KEY) || 'null'); } catch (e) { o = null; }
    o = o && typeof o === 'object' ? o : {};
    const num = (v) => (typeof v === 'number' && v > 0 && v < 1e14 ? v : 0);
    return { auto: o.auto === true || o.auto === false ? o.auto : null, at: num(o.at), failedAt: num(o.failedAt), dismissed: typeof o.dismissed === 'string' ? o.dismissed.slice(0, 32) : '' };
  }
  function setPrefs(p) { try { G.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: this launch only */ } }
  GH.update.prefs = prefs;

  /* ---------------------------------------------------------------- the Android side */
  const parse = (v) => { if (v && typeof v === 'object') return v; try { const o = JSON.parse(v || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  // An app with the updater (a plain browser, or a bridge without it, has none).
  const can = () => { const b = bridge(); return !!(b && typeof b.updateSupport === 'function' && typeof b.updateState === 'function'); };
  // Whether this install updates itself: { ok, why?, canInstall }, read once a launch and again as
  // the app comes back (the permission to install apps may have changed meanwhile).
  let sup = null;
  function support() {
    if (sup) return sup;
    if (!can()) return { ok: false, why: bridge() ? 'app' : 'web' };
    const o = (() => { try { return parse(bridge().updateSupport()); } catch (e) { return null; } })();
    sup = o ? Object.assign({ ok: false }, o) : { ok: false, why: 'app' };
    return sup;
  }
  // Updater's latest snapshot (see its snapshot()): asked for once, then kept up to date by onUpdate.
  let st = null;
  function state() {
    if (!st && can()) { try { st = parse(bridge().updateState()); } catch (e) { st = null; } }
    return st || { phase: 'idle' };
  }
  GH.update.support = support;
  let manual = false; // the person tapped Check for updates
  hooks.onUpdate = (v) => {
    const s = parse(v);
    if (!s || typeof s.phase !== 'string') return;
    const before = st ? st.phase : null;
    st = s;
    if (s.done) finished(s);
    redraw(before !== s.phase || !!s.done);
  };
  // A step just ended: what's kept for the next automatic check, and how it feels. (A download reads
  // version.json first, so one that got anywhere counts as a check too.)
  const BAD = ['size', 'checksum', 'format', 'package', 'version', 'signature'];
  const haptic = (k) => { if (U.haptic) U.haptic(k); };
  function finished(s) {
    const p = prefs(), now = Date.now();
    if (s.done === 'check' || (s.done === 'download' && s.phase !== 'failed')) {
      if (s.phase === 'failed') p.failedAt = now; else { p.at = now; p.failedAt = 0; }
      setPrefs(p);
    }
    if (s.done === 'check' && manual) haptic(s.phase === 'failed' ? 'warning' : 'refresh');
    if (s.done === 'check') manual = false;
    if (s.done === 'download' && s.phase === 'ready') haptic('success');
    if (s.done === 'download' && s.phase === 'failed') haptic(BAD.includes(s.error) ? 'error' : 'warning');
    if (s.done === 'install' && s.error && s.error !== 'aborted') haptic('error');
  }
  const call = (name) => { const b = bridge(); try { return !!(b && typeof b[name] === 'function' && b[name]()); } catch (e) { return false; } };

  /* ---------------------------------------------------------------- the automatic check */
  // Not before set-up, nor during a workout or a recorded activity: the app comes back to it later.
  const busy = (S) => !!(!S || !S.profile || !S.profile.onboarded || S.active || S.actLive);
  let autoTimer = 0;
  function later() {
    if (autoTimer || !can()) return;
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      const run = () => { if (autoOk(Date.now())) call('updateCheck'); };
      if (U.whenQuiet) U.whenQuiet(run); else run();
    }, AUTO_DELAY);
  }
  // (With a download waiting to be installed too: a newer version replaces it.)
  function autoOk(now) {
    const ph = state().phase;
    return support().ok && due(prefs(), now) && !busy(U.S) && (!P() || P().visible()) && ['idle', 'current', 'available', 'ready', 'failed'].includes(ph);
  }
  GH.update.autoOk = autoOk;
  const prevBoot = U.afterBoot;
  U.afterBoot = () => {
    if (prevBoot) prevBoot();
    later();
  };
  if (P()) {
    P().on('resume', () => {
      if (!can()) return;
      sup = null;
      st = null;
      // Back from Settings with installs allowed: on with the install.
      if (state().phase === 'permission' && support().canInstall) call('updateInstall');
      redraw(true);
      later();
    });
  }

  /* ---------------------------------------------------------------- what's on screen */
  let sheet = null, drawAt = 0, drawTimer = 0, drawAll = false;
  // The sheet and Settings follow every change (four times a second at most, as a download moves);
  // Today only a change of phase, for its card.
  function redraw(phaseChanged) {
    drawAll = drawAll || phaseChanged;
    const go = () => {
      drawAt = Date.now();
      drawTimer = 0;
      const all = drawAll;
      drawAll = false;
      if (sheet && !sheet.closed) sheet.update(sheetBody());
      const r = U.route || {};
      if (r.view === 'settings' && U.render) U.render();
      else if (all && !r.view && r.tab === 'today' && U.renderSoon) U.renderSoon();
    };
    const wait = 250 - (Date.now() - drawAt);
    if (wait <= 0) go(); else if (!drawTimer) drawTimer = setTimeout(go, wait);
  }
  const esc = (s) => (U.esc ? U.esc(s) : String(s));
  const kw = (html, words) => html.replace(/^(\s*<(?:li|label)\b)/, `$1 data-keywords="${esc(words)}"`);
  const appVer = () => (P() && P().appVersion()) || GH.VERSION || 'web';

  // Settings, About: the row, and the switch when this install checks.
  U.updateRows = () => {
    const sp = support();
    if (!sp.ok) return kw(U.row({ key: 'version', icon: 'info', tone: 'sky', title: 'Version', sub: esc(WHERE[sp.why] || WHERE.app), detail: esc(appVer()) }), 'update updates upgrade new version');
    const v = rowView(state(), Date.now());
    const right = v.spin ? '<span class="rf-spinner" data-size="sm"><i></i></span>'
      : v.btn ? `<button type="button" class="rf-btn" data-size="sm" data-variant="filled" data-act="updateOpen">${esc(v.btn)}</button>` : '';
    const row = v.btn
      ? `<li data-key="update"><div class="rf-list-row"><span class="rf-list-icon" data-tone="green">${U.icon('download')}</span><span class="rf-list-text"><span class="rf-list-title">Check for updates</span><span class="rf-list-sub">${esc(v.line)}</span></span>${right}</div></li>`
      : `<li data-key="update"><button type="button" class="rf-list-row" data-act="${v.act}"><span class="rf-list-icon" data-tone="green">${U.icon('download')}</span><span class="rf-list-text"><span class="rf-list-title">Check for updates</span><span class="rf-list-sub">${esc(v.line)}</span></span>${right || (v.act === 'updateOpen' ? `<span class="rf-list-chevron">${U.icon('chevron-right')}</span>` : '')}</button></li>`;
    return `${kw(row, 'update updates upgrade new version download install github')}
      ${kw(U.sw('Check automatically', prefs().auto === true, 'data-on="updateAuto"', 'Once a day. GitHub sees your IP address and app version, nothing about you.'), 'update automatic daily github')}`;
  };
  U.on.updateAuto = (el, ev, v) => { const p = prefs(); p.auto = !!v; setPrefs(p); if (v) later(); };
  U.act.updateCheck = () => {
    if (!can()) return;
    manual = true;
    if (!call('updateCheck')) { manual = false; haptic('deny'); }
    else haptic('tap');
  };

  // Today: a new version, until it's installed or put away. Before that, once, whether to check by
  // itself (askCard).
  U.updateCard = (S, day) => {
    if (!can() || busy(S) || !support().ok) return '';
    const s = state();
    if (!card(prefs(), s) || s.phase === 'current') return askCard(S, day);
    const L = s.latest, first = notesList(L.notes)[0];
    return `<div class="card up-card" data-key="update-card">
      <div class="hc-invite-row"><span class="rf-list-icon" data-tone="green">${U.icon('download')}</span>
        <span class="hc-invite-text"><span class="t-headline">Version ${esc(L.versionName)} is ready</span><span class="t-footnote rf-muted">${first ? `${esc(first)}. ` : ''}A ${mb(L.size)} download.</span></span></div>
      <div class="hc-invite-btns"><button type="button" class="rf-btn" data-variant="filled" data-act="updateOpen">Update</button><button type="button" class="rf-btn" data-variant="plain" data-act="updateDismiss">Not now</button></div>
    </div>`;
  };
  // The question, asked once: for people updating, and for new people from their second day (not one
  // more thing on the first), after the reminders' question if that's up. Either answer is kept, and
  // Settings' Check automatically changes it.
  function askCard(S, day) {
    const start = S.profile.startDay;
    if (prefs().auto !== null || day == null || (start != null && !(day > start))) return '';
    if (U.notifyCard && U.notifyCard(S, day)) return '';
    return `<div class="card up-card" data-key="update-ask">
      <div class="hc-invite-row"><span class="rf-list-icon" data-tone="green">${U.icon('download')}</span>
        <span class="hc-invite-text"><span class="t-headline">Keep the app up to date?</span><span class="t-footnote rf-muted">Once a day it asks GitHub if there's a new version. GitHub sees your IP address, like any website. Nothing about you is sent.</span></span></div>
      <div class="hc-invite-btns"><button type="button" class="rf-btn" data-variant="filled" data-act="updateAskYes">Check daily</button><button type="button" class="rf-btn" data-variant="plain" data-act="updateAskNo">Not now</button></div>
    </div>`;
  }
  const fold = (el) => {
    const c = el && el.closest ? el.closest('.up-card') : null;
    const go = c && U.motion && U.motion.collapse ? U.motion.collapse(c) : Promise.resolve();
    return go.then(() => { if (U.render) U.render(); });
  };
  U.act.updateAskYes = (el) => {
    const p = prefs();
    p.auto = true;
    setPrefs(p);
    haptic('toggleOn');
    fold(el);
    later();
  };
  U.act.updateAskNo = (el) => {
    const p = prefs();
    p.auto = false;
    setPrefs(p);
    haptic('dismiss');
    fold(el);
  };
  // Not now: the card folds away and waits for the next version.
  U.act.updateDismiss = (el) => {
    const s = state(), p = prefs();
    if (s.latest) { p.dismissed = s.latest.versionName; setPrefs(p); }
    haptic('dismiss');
    fold(el);
  };

  /* ---------------------------------------------------------------- the update sheet */
  function sheetBody() {
    const s = state(), L = s.latest, inst = s.installed || {};
    const k = kind(inst, L);
    if (k === 'none') return `<div class="sheet-pad up-head" data-key="up-head"><p class="t-title-3">You're up to date</p><p class="t-callout rf-muted">You have version ${esc(inst.versionName || appVer())}.</p></div>`;
    const list = notesList(L.notes);
    return `<div class="sheet-pad up-head" data-key="up-head"><p class="t-title-3">${k === 'build' ? `A newer build of ${esc(L.versionName)}` : `Version ${esc(L.versionName)}`}</p>
        <p class="t-footnote rf-muted">You have ${esc(inst.versionName)} · ${mb(L.size)} download</p></div>
      ${list.length ? `<div class="sheet-pad up-news" data-key="up-news"><p class="t-headline">What's new</p><ul class="up-notes">${list.map((x) => `<li class="t-callout">${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="sheet-pad up-act" data-key="up-act">${actionHtml(s, L)}</div>`;
  }
  const bigBtn = (act, label, icon) => `<button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="${act}" data-key="up-main">${icon ? U.icon(icon) : ''}${esc(label)}</button>`;
  const note = (text, cls) => `<p class="${cls || 't-footnote rf-muted'}">${esc(text)}</p>`;
  const spin = (text) => `<div class="up-wait"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">${esc(text)}</span></div>`;
  function actionHtml(s, L) {
    switch (s.phase) {
      case 'checking': return spin('Checking GitHub…');
      case 'downloading': case 'verifying': {
        const frac = s.total ? Math.min(1, s.loaded / s.total) : 0;
        const what = s.phase === 'verifying' ? 'Checking the download…' : `${mb(s.loaded)} of ${mb(s.total || L.size)}`;
        return `<div class="up-prog">${U.progress(frac, 'Download')}<div class="up-prog-row"><span class="t-footnote rf-muted rf-num">${esc(what)}</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="updateCancel">Cancel</button></div></div>`;
      }
      case 'ready': return `${s.error ? note(WHY[s.error] || WHY.failed, 't-callout up-err') : ''}${bigBtn('updateInstall', 'Install', 'download')}
        ${note('Android asks you to confirm. The app closes while it updates: open it again when it\'s done. Your data stays as it is.')}`;
      case 'permission': return `<p class="t-headline">Allow updates from Gradient Health</p>
        ${note('Android asks once. In the screen that opens, turn on Allow from this source, then come back here.', 't-callout rf-muted')}
        ${bigBtn('updateInstall', 'Open settings')}`;
      case 'installing': return spin('Handing it to Android…');
      case 'confirm': return `${spin('Waiting for you in Android\'s screen…')}${note('If it didn\'t show, try again.')}<button type="button" class="rf-btn" data-size="sm" data-act="updateInstall">Try again</button>`;
      case 'failed': if (s.step !== 'check') {
        // Trying again downloads it again: what was there is gone, or wasn't whole.
        const why = s.error === 'space' && s.needed > 0 ? `${WHY.space} It needs about ${mb(s.needed)} free.` : (WHY[s.error] || WHY.network);
        return `${note(why, 't-callout up-err')}${bigBtn('updateGet', 'Try again', 'refresh')}`;
      } break;
      default: break;
    }
    return `${bigBtn('updateGet', 'Update', 'download')}${note(`Downloads ${mb(L.size)} from GitHub. Android asks you before anything installs.`)}`;
  }
  U.act.updateOpen = () => {
    if (!can()) return;
    if (sheet && !sheet.closed) return;
    sheet = U.sheet({ title: 'Update', size: 'auto', cls: 'up-sheet', body: sheetBody(), onClose: () => { sheet = null; } });
  };
  U.act.updateGet = () => {
    if (call('updateDownload')) haptic('tap');
    else haptic('deny');
  };
  U.act.updateCancel = () => { call('updateCancel'); haptic('dismiss'); };
  // The app closes while Android replaces it: not mid-workout or mid-activity, and the state is
  // written first.
  U.act.updateInstall = () => {
    const S = U.S;
    if (S && (S.active || S.actLive)) {
      U.toast(S.active ? 'Finish your workout first' : 'Finish your activity first', 'caution', 'The app closes while it updates.');
      return;
    }
    if (U.save) U.save(true);
    if (call('updateInstall')) haptic('tap');
    else haptic('deny');
  };
})(typeof window !== 'undefined' ? window : globalThis);
