/* UI core: the layout, the tab router, delegated events, sheets and dialogs, formatting and the
 * boot sequence. Screens live in the other src/ui/*.js files and register themselves on GH.ui.
 * Markup is Refract's (rf-* classes); Refract.init() enhances each render.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const B = () => GH.brain;
  const R = () => G.Refract || null;

  U.screens = U.screens || {};
  U.act = U.act || {};
  U.on = U.on || {};
  U.S = null;
  U.route = { tab: 'today', view: null, arg: null };

  /* ---------------------------------------------------------------- formatting */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  U.icon = (name, size) => {
    const r = R();
    if (r && r.icon) { try { return r.icon(name, size ? { size } : undefined); } catch (e) { /* unknown glyph */ } }
    return `<span data-icon="${U.esc(name)}" aria-hidden="true"></span>`;
  };
  U.num = (n, d) => (n == null || !isFinite(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }));
  U.lb = () => !U.S || U.S.profile.units !== 'kg';
  U.wUnit = () => (U.lb() ? 'lb' : 'kg');
  U.kgTo = (kg) => (kg == null ? null : U.lb() ? kg * B().LB_PER_KG : kg);
  U.toKg = (v) => (v == null || !isFinite(v) ? null : U.lb() ? v / B().LB_PER_KG : v);
  U.fmtW = (kg, d) => (kg == null ? '–' : `${U.num(U.kgTo(kg), d == null ? 1 : d)} ${U.wUnit()}`);
  U.fmtMin = (m) => (m == null ? '–' : B().fmtMin(Math.round(m)));
  U.fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  U.fmtClock = (ms) => { if (!ms) return '–'; const d = new Date(ms); const h = d.getHours(), m = d.getMinutes(); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  U.fmtDay = (n, wd) => B().fmtDay(n, wd);
  U.plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  U.cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  U.side = (s) => (s === 'R' ? 'Right' : 'Left');
  U.rollHour = () => (U.S && U.S.profile.prefs && U.S.profile.prefs.rollHour != null ? U.S.profile.prefs.rollHour : 4);
  U.today = () => B().dayOf(Date.now(), U.rollHour());
  U.target = (it, amount) => {
    const v = amount == null ? it.target : amount;
    return it.timed ? `${v} s` : `${v} ${v === 1 ? 'rep' : 'reps'}`;
  };

  /* ---------------------------------------------------------------- small markup builders */
  // A segmented control; `extra` adds attributes. Rows in lists pass data-size="sm" and stay compact.
  U.seg = (name, options, value, label, extra) => `<div class="rf-segmented"${/data-size="sm"/.test(extra || '') ? '' : ' data-block'} aria-label="${U.esc(label)}"${extra || ''}>${options.map(([v, t]) => `<label class="rf-segment"><input type="radio" name="${U.esc(name)}" value="${U.esc(v)}"${String(v) === String(value) ? ' checked' : ''}>${U.esc(t)}</label>`).join('')}</div>`;
  U.chip = (label, pressed, attrs) => `<button type="button" class="rf-chip" aria-pressed="${pressed ? 'true' : 'false'}" ${attrs || ''}><span class="rf-chip-check" data-icon="check"></span>${U.esc(label)}</button>`;
  U.sw = (label, checked, attrs, sub) => `<label class="rf-list-row rf-switch" data-layout="row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(label)}</span>${sub ? `<span class="rf-list-subtitle">${U.esc(sub)}</span>` : ''}</span><span class="rf-switch-track"><input type="checkbox" role="switch"${checked ? ' checked' : ''} ${attrs || ''}><span class="rf-switch-thumb" aria-hidden="true"></span></span></label>`;
  U.stepper = (id, value, min, max, label, attrs, step) => `<div class="rf-stepper" role="group" aria-label="${U.esc(label)}"><button type="button" class="rf-stepper-btn" data-step="-${step || 1}" aria-label="Less ${U.esc(label.toLowerCase())}">${U.icon('minus')}</button><input class="rf-stepper-value" type="number" inputmode="numeric" id="${U.esc(id)}" value="${U.esc(value)}" min="${min}" max="${max}" step="${step || 1}" aria-label="${U.esc(label)}" ${attrs || ''}><button type="button" class="rf-stepper-btn" data-step="${step || 1}" aria-label="More ${U.esc(label.toLowerCase())}">${U.icon('plus')}</button></div>`;
  U.progress = (v, label, tone) => `<div class="rf-progress" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(Math.min(1, v) * 100)}" aria-valuemin="0" aria-valuemax="100" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}"${tone ? ` data-tone="${tone}"` : ''}><span class="rf-progress-fill"></span></div>`;
  U.ring = (v, label, inner, size, tone) => `<span class="rf-ring" data-size="${size || 'lg'}" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(v * 100)}" aria-valuemin="0" aria-valuemax="100"${tone ? ` data-tone="${tone}"` : ''}><svg viewBox="0 0 72 72"><circle class="rf-ring-track" cx="36" cy="36" r="32" pathLength="100"/><circle class="rf-ring-fill" cx="36" cy="36" r="32" pathLength="100"/></svg><span class="rf-ring-label">${inner || ''}</span></span>`;
  U.row = (o) => {
    const tag = o.act ? 'button' : o.href ? 'a' : 'div';
    const attrs = o.act ? ` type="button" data-act="${U.esc(o.act)}"${o.arg != null ? ` data-arg="${U.esc(o.arg)}"` : ''}` : '';
    return `<li><${tag} class="rf-list-row${o.cls ? ' ' + o.cls : ''}"${attrs}>${o.icon ? `<span class="rf-list-icon" data-tone="${o.tone || 'sky'}">${U.icon(o.icon)}</span>` : ''}<span class="rf-list-text"><span class="rf-list-title">${o.title}</span>${o.sub ? `<span class="rf-list-subtitle">${o.sub}</span>` : ''}</span>${o.detail != null ? `<span class="rf-list-detail">${o.detail}</span>` : ''}${o.chevron ? `<span class="rf-list-chevron">${U.icon('chevron-right')}</span>` : ''}</${tag}></li>`;
  };
  U.navbar = (title, trailing, leading) => `<header class="rf-navbar" data-scroller="#screen"><div class="rf-scroll-edge" aria-hidden="true"></div><div class="rf-navbar-leading">${leading || ''}</div><h2 class="rf-navbar-title">${U.esc(title)}</h2><div class="rf-navbar-trailing">${trailing || ''}</div></header>`;
  U.glassBtn = (iconName, label, act, extra) => `<button type="button" class="rf-btn rf-glass" data-shape="circle" data-lens aria-label="${U.esc(label)}" data-act="${act}" ${extra || ''}>${U.icon(iconName)}</button>`;
  U.badge = (text, tone, variant) => `<span class="rf-badge" data-variant="${variant || 'soft'}" data-tone="${tone || 'neutral'}">${U.esc(text)}</span>`;
  U.toneWord = { good: ['positive', 'check-circle', 'Good'], watch: ['caution', 'alert', 'Watch'], info: ['accent', 'info', 'Note'], alert: ['critical', 'alert', 'Check'] };

  /* ---------------------------------------------------------------- layout */
  let root, screen, floatEl, playerEl, onboardEl, tabbar, accessory;
  const TABS = [['today', 'home', 'Today'], ['plan', 'calendar', 'Plan'], ['health', 'heart', 'Health'], ['progress', 'chart', 'Progress'], ['moves', 'library', 'Moves']];
  function layout() {
    root = doc.getElementById('app');
    root.innerHTML = `
      <main id="screen" class="screen" tabindex="-1"></main>
      <div id="float" class="float-actions"></div>
      <nav class="rf-tabbar" data-position="bottom" aria-label="Main" id="tabbar">
        <div class="rf-tabbar-accessory rf-glass" data-lens id="accessory" hidden></div>
        <div class="rf-tabbar-bar rf-glass" data-lens>
          ${TABS.map(([id, ic, label]) => `<button type="button" class="rf-tab" data-tab="${id}"${id === 'today' ? ' aria-current="page"' : ''}>${U.icon(ic)}<span class="rf-tab-label">${label}</span></button>`).join('')}
        </div>
      </nav>
      <section id="player" class="player" hidden aria-label="Workout"></section>
      <section id="onboard" class="onboard" hidden aria-label="Set up"></section>`;
    screen = doc.getElementById('screen');
    floatEl = doc.getElementById('float');
    playerEl = doc.getElementById('player');
    onboardEl = doc.getElementById('onboard');
    tabbar = doc.getElementById('tabbar');
    accessory = doc.getElementById('accessory');
    // Refract's tab bar emits rf-select (taps and drags); a plain click covers the rest, and a tap on
    // the current tab scrolls it back to the top.
    let selected = 0;
    tabbar.addEventListener('rf-select', (e) => { const t = e.detail && e.detail.tab; if (t && t.dataset.tab) { selected = Date.now(); go(t.dataset.tab); } });
    tabbar.addEventListener('click', (e) => {
      const t = e.target.closest('.rf-tab');
      if (!t || Date.now() - selected < 400) return;
      go(t.dataset.tab);
    });
    enhance(tabbar);
  }
  U.els = () => ({ root, screen, floatEl, playerEl, onboardEl, tabbar, accessory });

  /* ---------------------------------------------------------------- rendering */
  const cleanups = [];
  U.onCleanup = (fn) => cleanups.push(fn);
  function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } }
  let lastKey = null;
  function render() {
    if (!U.S || !U.S.profile.onboarded) { U.showOnboarding(); return; }
    onboardEl.hidden = true;
    const r = U.route;
    const key = r.view ? `${r.view}:${r.arg || ''}` : r.tab;
    const keepScroll = key === lastKey ? screen.scrollTop : 0;
    runCleanups();
    if (U.clearCharts) U.clearCharts();
    const scr = U.screens[r.view || r.tab] || U.screens.today;
    const day = U.today();
    let html = '';
    try { html = scr.render(U.S, day, r.arg); } catch (e) { html = errorBox(e); }
    screen.innerHTML = html;
    floatEl.innerHTML = scr.float ? safe(() => scr.float(U.S, day, r.arg)) : '';
    floatEl.hidden = !floatEl.innerHTML;
    screen.dataset.view = r.view || r.tab;
    enhance(screen); enhance(floatEl);
    if (scr.after) safe(() => scr.after(screen, U.S, day, r.arg));
    screen.scrollTop = keepScroll;
    lastKey = key;
    tabbar.hidden = !!r.view;
    for (const t of tabbar.querySelectorAll('.rf-tab')) { if (t.dataset.tab === r.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
    const bar = tabbar.querySelector('.rf-tabbar-bar');
    if (R() && R().refresh && bar) safe(() => R().refresh(tabbar));
    renderAccessory();
  }
  U.render = render;
  function safe(fn) { try { return fn(); } catch (e) { if (G.console) G.console.error(e); return ''; } }
  function errorBox(e) {
    if (G.console) G.console.error(e);
    return `<div class="section"><div class="card"><p class="t-headline">Something went wrong drawing this screen.</p><p class="t-footnote rf-muted">${U.esc(e && e.message)}</p><button class="rf-btn" data-act="goToday">Back to Today</button></div></div>`;
  }
  function enhance(el) { const r = R(); if (r && r.init) safe(() => r.init(el)); }
  U.enhance = enhance;

  function go(tab) {
    if (U.route.tab === tab && !U.route.view) { screen.scrollTo({ top: 0, behavior: U.reduced() ? 'auto' : 'smooth' }); return; }
    U.route = { tab, view: null, arg: null };
    render();
    if (U.screens[tab] && U.screens[tab].shown) safe(() => U.screens[tab].shown(U.S, U.today()));
  }
  U.go = go;
  U.open = (view, arg) => { U.route = { tab: U.route.tab, view, arg: arg == null ? null : arg }; render(); screen.focus({ preventScroll: true }); };
  U.back = () => { if (U.route.view) { U.route = { tab: U.route.tab, view: null, arg: null }; render(); return true; } return false; };
  U.act.goToday = () => go('today');
  U.act.back = () => U.back();
  U.reduced = () => !!(GH.platform && GH.platform.reducedMotion());

  // A workout in progress rides above the tab bar on other tabs.
  function renderAccessory() {
    const A = U.S && U.S.active;
    const show = !!A && playerEl.hidden && !(U.route.tab === 'today' && !U.route.view);
    accessory.hidden = !show;
    if (!show) { accessory.innerHTML = ''; return; }
    const doneN = A.steps.slice(0, A.idx).filter((s) => s.kind === 'set').length;
    const total = A.steps.filter((s) => s.kind === 'set').length;
    accessory.innerHTML = `<span class="rf-activity-leading" data-tone="coral" style="width:36px;height:36px">${U.icon('timer', 'sm')}</span>
      <span class="acc-text"><b>${U.esc(A.session.title)}</b><span class="t-caption rf-secondary">${doneN} of ${total} sets</span></span>
      <span class="rf-spacer"></span>
      <button type="button" class="rf-btn" data-size="sm" data-act="resumeWorkout">Resume</button>`;
  }
  U.renderAccessory = renderAccessory;

  /* ---------------------------------------------------------------- events */
  function dispatch(map, el, ev, value) {
    const name = el.getAttribute(map === U.act ? 'data-act' : 'data-on');
    const fn = map[name];
    if (!fn) return;
    try { fn(el, ev, value); } catch (e) { if (G.console) G.console.error(e); U.toast('Something went wrong', 'critical'); }
  }
  function wire() {
    doc.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-act]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (GH.platform) GH.platform.unlockAudio();
      dispatch(U.act, el, e);
    });
    const onChange = (e) => {
      const el = e.target.closest && e.target.closest('[data-on]');
      if (!el) return;
      const t = e.target;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
      dispatch(U.on, el, e, v);
    };
    doc.addEventListener('change', onChange);
    doc.addEventListener('rf-toggle', (e) => {
      const el = e.target.closest && e.target.closest('[data-on]');
      if (el && e.detail && 'pressed' in e.detail) dispatch(U.on, el, e, e.detail.pressed);
    });
  }

  /* ---------------------------------------------------------------- sheets, dialogs, toasts */
  const openSheets = [];
  // U.sheet({ title, body, detent, action: {label, act}, onClose, cls }) → { el, close, body }
  U.sheet = (o) => {
    const el = doc.createElement('dialog');
    el.className = 'rf-sheet rf-glass' + (o.cls ? ' ' + o.cls : '');
    el.setAttribute('data-detents', o.detents || 'medium large');
    el.setAttribute('closedby', 'any');
    const tid = 'sh' + Math.random().toString(36).slice(2, 8);
    el.setAttribute('aria-labelledby', tid);
    el.innerHTML = `<div class="rf-sheet-grabber"></div>
      <div class="rf-sheet-header">
        <button type="button" class="rf-btn" data-shape="circle" data-size="sm" aria-label="Close" data-sheet-close>${U.icon('close')}</button>
        <h2 class="rf-sheet-title" id="${tid}">${U.esc(o.title || '')}</h2>
        ${o.action ? `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="sm" data-act="${U.esc(o.action.act)}"${o.action.arg != null ? ` data-arg="${U.esc(o.action.arg)}"` : ''}>${U.esc(o.action.label)}</button>` : '<span class="sheet-spacer"></span>'}
      </div>
      <div class="rf-sheet-body">${o.body || ''}</div>`;
    doc.body.appendChild(el);
    enhance(el);
    const ctl = { el, body: el.querySelector('.rf-sheet-body'), closed: false };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; ctl.closed = true;
      const i = openSheets.indexOf(ctl); if (i >= 0) openSheets.splice(i, 1);
      if (o.onClose) safe(() => o.onClose(el.returnValue));
      setTimeout(() => { if (R() && R().destroy) safe(() => R().destroy(el)); el.remove(); }, 450);
    };
    ctl.close = (v) => { if (ctl.closed) return; const r = R(); if (r && r.sheet) r.sheet.close(el, v); else { try { el.close(v); } catch (e) { /* ignore */ } } };
    el.addEventListener('close', finish);
    el.querySelector('[data-sheet-close]').addEventListener('click', () => ctl.close('cancel'));
    openSheets.push(ctl);
    const r = R();
    if (r && r.sheet) r.sheet.open(el, { detent: o.detent || 'medium' }).then(finish, finish);
    else { try { el.showModal(); } catch (e) { el.setAttribute('open', ''); } }
    if (o.after) safe(() => o.after(ctl));
    return ctl;
  };
  U.closeSheets = () => { for (const s of openSheets.slice()) s.close('cancel'); };
  U.topSheet = () => openSheets[openSheets.length - 1] || null;

  U.dialog = (o) => {
    const r = R();
    if (r && r.dialog) return r.dialog.open(o);
    const labels = (o.actions || []).map((a) => a.label);
    return Promise.resolve(G.confirm(`${o.title}\n${o.message || ''}`) ? (o.actions || []).slice(-1)[0].value : 'cancel').then((v) => v || labels);
  };
  U.confirm = (title, message, label, tone, icon) => U.dialog({
    title, message, icon, tone: tone === 'critical' ? 'critical' : undefined,
    actions: [{ label: 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label, value: 'ok', variant: 'filled', tone: tone || 'accent' }],
  }).then((v) => v === 'ok');
  U.toast = (title, tone, message, action) => {
    const r = R();
    if (r && r.toast) { try { return r.toast({ title, message, tone: tone || 'neutral', action, position: 'top' }); } catch (e) { /* ignore */ } }
    return null;
  };

  /* ---------------------------------------------------------------- persistence */
  U.save = (now) => { if (!U.S) return; if (now) GH.store.save(U.S); else GH.store.saveSoon(U.S); };
  U.commit = () => { U.save(); render(); };

  /* ---------------------------------------------------------------- back button */
  function onBack() {
    const top = U.topSheet();
    if (top) { top.close('cancel'); return true; }
    if (doc.querySelector('dialog.rf-dialog[open]')) { const d = doc.querySelector('dialog.rf-dialog[open]'); try { if (R() && R().dialog) R().dialog.close(d, 'cancel'); else d.close('cancel'); } catch (e) { /* ignore */ } return true; }
    if (!playerEl.hidden) return U.playerBack ? U.playerBack() : false;
    if (!onboardEl.hidden) return U.onboardBack ? U.onboardBack() : false;
    if (U.route.view) return U.back();
    if (U.route.tab !== 'today') { go('today'); return true; }
    return false;
  }

  /* ---------------------------------------------------------------- health sync */
  let syncing = false;
  U.syncHealth = async (force) => {
    const S = U.S;
    if (!S || syncing || !GH.health) return null;
    const st = GH.health.status();
    S.health.status = st;
    if (!GH.health.connected(st)) return null;
    if (!force && S.health.lastSync && Date.now() - S.health.lastSync < 10 * 60000) return null;
    syncing = true;
    try {
      const res = await GH.health.sync(S, Date.now());
      if (res && res.ok) { GH.health.afterSync(S, U.today()); U.save(); render(); }
      return res;
    } finally { syncing = false; }
  };

  /* ---------------------------------------------------------------- boot */
  function applyPrefs() {
    const p = U.S ? U.S.profile.prefs : { theme: 'system', sound: true, vibrate: true, density: 0.5 };
    if (GH.platform) {
      GH.platform.setPrefs({ sound: p.sound !== false, vibrate: p.vibrate !== false });
      GH.platform.applyTheme(p.theme || 'system', !!p.contrast);
      if (p.density != null) GH.platform.setDensity(p.density);
    }
  }
  U.applyPrefs = applyPrefs;

  let lastDay = null;
  function boot() {
    layout();
    wire();
    if (GH.platform) {
      GH.platform.onBack(onBack);
      GH.platform.on('resume', () => { if (U.S && U.S.profile.onboarded) { U.syncHealth(); if (U.today() !== lastDay) render(); } });
      GH.platform.on('route', (route) => openRoute(route));
    }
    U.S = GH.store.load();
    applyPrefs();
    const r = R();
    if (r && r.observe) safe(() => r.observe(doc.body));
    if (!U.S || !U.S.profile.onboarded) U.showOnboarding();
    else {
      render();
      if (U.S.active && U.resumePrompt) U.resumePrompt();
      U.syncHealth(true);
    }
    lastDay = U.today();
    setInterval(() => { const d = U.today(); if (d !== lastDay) { lastDay = d; if (U.S && U.S.profile.onboarded && playerEl.hidden) render(); } }, 30000);
    const hash = (G.location && G.location.hash || '').replace('#', '');
    if (hash) openRoute(hash);
    G.addEventListener('hashchange', () => openRoute((G.location.hash || '').replace('#', '')));
  }
  function openRoute(route) {
    if (route === 'privacy') { if (U.S && U.S.profile.onboarded) U.open('privacy'); else if (U.showPrivacySheet) U.showPrivacySheet(); }
    else if (route === 'health' || route === 'plan' || route === 'progress' || route === 'moves' || route === 'today') { if (U.S && U.S.profile.onboarded) go(route); }
  }
  U.boot = boot;
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
