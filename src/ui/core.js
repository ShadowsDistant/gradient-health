/* UI core: the layout, the router, rendering, delegated events, sheets and dialogs, formatting,
 * health sync and the boot sequence. Screens live in the other src/ui/*.js files and register
 * themselves on GH.ui.
 *
 * Rendering patches the page in place (U.morph) instead of replacing it: nodes that line up are
 * kept, so Refract's enhanced controls, running transitions, focus and scroll positions survive a
 * re-render, and nothing flickers. The navigation bar and the tab bar are built once; a screen's
 * <header class="rf-navbar"> is lifted into the shared bar.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const B = () => GH.brain;
  const R = () => G.Refract || null;
  const P = () => GH.platform || null;

  U.screens = U.screens || {};
  U.act = U.act || {};
  U.on = U.on || {};
  U.S = null;
  U.route = { tab: 'today', view: null, arg: null };

  /* ---------------------------------------------------------------- formatting */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  // Glyphs Refract doesn't have, drawn on its grid (24 px, 1.75 stroke, round ends).
  const EXTRA_ICONS = {
    food: '<path d="M7 3.5v6a2 2 0 0 0 4 0v-6M9 3.5V21M17 21V3.5c-2 1-3.25 3.4-3.25 6.25V14H17"/>',
    flame: '<path d="M12 20.75c3.5 0 5.75-2.4 5.75-5.5 0-3.4-2.5-5.4-3.75-8.6-.3-.8-1.35-.9-1.75-.15-.6 1.15-1.3 2.05-2.25 2.85C8.35 10.7 6.25 12.3 6.25 15.25c0 3.1 2.25 5.5 5.75 5.5z"/><path d="M12 20.75c-1.45 0-2.5-1-2.5-2.4 0-1.55 1.35-2.35 2.05-3.4a.55.55 0 0 1 .9 0c.7 1.05 2.05 1.85 2.05 3.4 0 1.4-1.05 2.4-2.5 2.4z"/>',
    scan: '<path d="M4 8.5V6.25A2.25 2.25 0 0 1 6.25 4H8.5M15.5 4h2.25A2.25 2.25 0 0 1 20 6.25V8.5M20 15.5v2.25A2.25 2.25 0 0 1 17.75 20H15.5M8.5 20H6.25A2.25 2.25 0 0 1 4 17.75V15.5M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/>',
    dumbbell: '<path d="M4.25 9.5v5M7.25 7v10M16.75 7v10M19.75 9.5v5M7.25 12h9.5"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="2.25"/><path d="M9.75 4v3M14.25 4v3M9.75 17v3M14.25 17v3M4 9.75h3M4 14.25h3M17 9.75h3M17 14.25h3M10.25 12h3.5"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.75 10a4.6 4.6 0 0 1 6.5 0M12 10.25l1.25-1.75"/>',
    stop: '<rect x="6.75" y="6.75" width="10.5" height="10.5" rx="2.25" fill="currentColor" stroke="none"/>',
  };
  U.icon = (name, size, cls) => {
    const r = R();
    if (r && r.icons && EXTRA_ICONS[name] && !r.icons[name]) r.icons[name] = EXTRA_ICONS[name];
    if (r && r.icon) { try { const svg = r.icon(name, { size: size || undefined, className: cls || '' }); if (svg) return svg; } catch (e) { /* unknown glyph */ } }
    return `<span class="${cls || ''}" data-icon="${U.esc(name)}" aria-hidden="true"></span>`;
  };
  U.num = (n, d) => (n == null || !isFinite(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }));
  // A number that rolls to its new value when a re-render changes it.
  U.roll = (v, cls) => `<span class="rf-num${cls ? ' ' + cls : ''}" data-roll="${U.esc(v)}">${U.esc(v)}</span>`;
  U.lb = () => !U.S || U.S.profile.units !== 'kg';
  U.wUnit = () => (U.lb() ? 'lb' : 'kg');
  U.kgTo = (kg) => (kg == null ? null : U.lb() ? kg * B().LB_PER_KG : kg);
  U.toKg = (v) => (v == null || !isFinite(v) ? null : U.lb() ? v / B().LB_PER_KG : v);
  U.fmtW = (kg, d) => (kg == null ? '–' : `${U.num(U.kgTo(kg), d == null ? 1 : d)} ${U.wUnit()}`);
  U.fmtMin = (m) => (m == null ? '–' : B().fmtMin(Math.round(m)));
  U.fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  U.fmtClock = (ms) => { if (!ms) return '–'; const d = new Date(ms); const h = d.getHours(), m = d.getMinutes(); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  U.fmtDay = (n, wd) => B().fmtDay(n, wd);
  U.ago = (ms, now) => {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  };
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
  U.chip = (label, pressed, attrs) => `<button type="button" class="rf-chip" aria-pressed="${pressed ? 'true' : 'false'}" ${attrs || ''}>${U.icon('check', null, 'rf-chip-check')}${U.esc(label)}</button>`;
  U.sw = (label, checked, attrs, sub) => `<label class="rf-list-row rf-switch" data-layout="row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(label)}</span>${sub ? `<span class="rf-list-sub">${U.esc(sub)}</span>` : ''}</span><span class="rf-switch-track"><input type="checkbox" role="switch"${checked ? ' checked' : ''} ${attrs || ''}><span class="rf-switch-thumb" aria-hidden="true"></span></span></label>`;
  U.stepper = (id, value, min, max, label, attrs, step) => `<div class="rf-stepper" role="group" aria-label="${U.esc(label)}"><button type="button" class="rf-stepper-btn" data-step="-${step || 1}" aria-label="Less ${U.esc(label.toLowerCase())}">${U.icon('minus')}</button><input class="rf-stepper-value" type="number" inputmode="numeric" id="${U.esc(id)}" value="${U.esc(value)}" min="${min}" max="${max}" step="${step || 1}" aria-label="${U.esc(label)}" ${attrs || ''}><button type="button" class="rf-stepper-btn" data-step="${step || 1}" aria-label="More ${U.esc(label.toLowerCase())}">${U.icon('plus')}</button></div>`;
  U.progress = (v, label, tone) => `<div class="rf-progress" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(Math.min(1, v) * 100)}" aria-valuemin="0" aria-valuemax="100" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}"${tone ? ` data-tone="${tone}"` : ''}><span class="rf-progress-fill"></span></div>`;
  U.ring = (v, label, inner, size, tone) => `<span class="rf-ring" data-size="${size || 'lg'}" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(v * 100)}" aria-valuemin="0" aria-valuemax="100"${tone ? ` data-tone="${tone}"` : ''}><svg viewBox="0 0 72 72"><circle class="rf-ring-track" cx="36" cy="36" r="32" pathLength="100"/><circle class="rf-ring-fill" cx="36" cy="36" r="32" pathLength="100"/></svg><span class="rf-ring-label">${inner || ''}</span></span>`;
  U.row = (o) => {
    const tag = o.act ? 'button' : o.href ? 'a' : 'div';
    const attrs = o.act ? ` type="button" data-act="${U.esc(o.act)}"${o.arg != null ? ` data-arg="${U.esc(o.arg)}"` : ''}` : '';
    return `<li${o.key ? ` data-key="${U.esc(o.key)}"` : ''}><${tag} class="rf-list-row${o.cls ? ' ' + o.cls : ''}"${attrs}>${o.icon ? `<span class="rf-list-icon" data-tone="${o.tone || 'sky'}">${U.icon(o.icon)}</span>` : ''}<span class="rf-list-text"><span class="rf-list-title">${o.title}</span>${o.sub ? `<span class="rf-list-sub">${o.sub}</span>` : ''}</span>${o.detail != null ? `<span class="rf-list-detail">${o.detail}</span>` : ''}${o.chevron ? `<span class="rf-list-chevron">${U.icon('chevron-right')}</span>` : ''}</${tag}></li>`;
  };
  U.navbar = (title, trailing, leading) => `<header class="rf-navbar"><div class="rf-navbar-leading">${leading || ''}</div><h2 class="rf-navbar-title">${U.esc(title)}</h2><div class="rf-navbar-trailing">${trailing || ''}</div></header>`;
  U.glassBtn = (iconName, label, act, extra) => `<button type="button" class="rf-btn rf-glass" data-shape="circle" data-lens aria-label="${U.esc(label)}" data-act="${act}" ${extra || ''}>${U.icon(iconName)}</button>`;
  U.badge = (text, tone, variant) => `<span class="rf-badge" data-variant="${variant || 'soft'}" data-tone="${tone || 'neutral'}">${U.esc(text)}</span>`;
  U.toneWord = { good: ['positive', 'check-circle', 'Good'], watch: ['caution', 'alert', 'Watch'], info: ['accent', 'info', 'Note'], alert: ['critical', 'alert', 'Check'] };

  /* ---------------------------------------------------------------- morph */
  // Nodes Refract adds inside components. Re-renders leave them where they are.
  const INJECTED = ['rf-lens-layer', 'rf-segmented-thumb', 'rf-tabbar-lens', 'rf-slider-ticks', 'rf-slider-track', 'rf-slider-fill', 'rf-slider-thumb', 'rf-pagedots-worm', 'rf-glass-bridge', 'rf-burst-layer', 'rf-ghost', 'rf-bead', 'rf-bead-ring'];
  // Classes that carry a Refract behavior: an element never turns into or out of one of these in
  // place, it's replaced instead (so no stale listeners or injected parts are left behind).
  const BEHAVIOR = ['rf-segmented', 'rf-switch', 'rf-slider', 'rf-stepper', 'rf-chip', 'rf-glass', 'rf-navbar', 'rf-scroll-edge', 'rf-search', 'rf-pagedots', 'rf-activity', 'rf-tabbar'];
  const BEHAVIOR_SEL = BEHAVIOR.map((c) => '.' + c).join(',');
  // Attributes Refract sets on our elements. Only matters for nodes the markup didn't create.
  const KEEP_ATTR = /^(data-(ready|lens-ready|scrolled|active|pressed|glow|magnet|dragging|bump|leaving|traveling|open|expanded|detent|entering|animate|minimized|revealed|hover|merged|tilting|rf-.*)|role|tabindex|style|aria-(checked|selected|expanded|controls|describedby|valuetext))$/;
  const owned = new WeakMap(); // element → { attrs, style } the markup set, so only those get removed

  const isInjected = (n) => n.nodeType === 1 && INJECTED.some((c) => n.classList.contains(c));
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);
  function sig(n) {
    if (n.nodeType !== 1) return String(n.nodeType);
    let s = n.nodeName;
    if (n.nodeName === 'INPUT') s += ':' + (n.getAttribute('type') || 'text');
    for (const b of BEHAVIOR) if (n.classList.contains(b)) s += '.' + b;
    if (n.hasAttribute('data-lens')) s += '[lens]';
    return s;
  }
  function styleProps(text) {
    const out = new Map();
    if (!text) return out;
    for (const part of text.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      if (k) out.set(k.startsWith('--') ? k : k.toLowerCase(), part.slice(i + 1).trim());
    }
    return out;
  }
  function record(el) {
    owned.set(el, { attrs: new Set(Array.from(el.attributes, (a) => a.name)), style: new Set(styleProps(el.getAttribute('style')).keys()) });
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) record(c);
  }
  function morphAttrs(from, to) {
    const rec = owned.get(from);
    const next = new Set();
    for (const a of Array.from(to.attributes)) {
      next.add(a.name);
      if (a.name !== 'style' && from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
    const had = rec ? rec.attrs : Array.from(from.attributes, (a) => a.name).filter((n) => !KEEP_ATTR.test(n));
    for (const name of had) if (!next.has(name) && name !== 'style') from.removeAttribute(name);
    const want = styleProps(to.getAttribute('style'));
    if (rec) for (const k of rec.style) if (!want.has(k)) from.style.removeProperty(k);
    for (const [k, v] of want) if (from.style.getPropertyValue(k).trim() !== v) from.style.setProperty(k, v);
    owned.set(from, { attrs: next, style: new Set(want.keys()) });
  }
  // Refract positions some parts from JS (the segmented thumb, the slider fill). When a re-render
  // changes their input, they're asked to re-measure once the patch is done.
  const toRefresh = new Set();
  function queueRefresh(el) {
    if (!el) return;
    if (!toRefresh.size) Promise.resolve().then(() => { const r = R(); for (const x of toRefresh) if (r && r.refresh && x.isConnected) safe(() => r.refresh(x)); toRefresh.clear(); });
    toRefresh.add(el);
  }
  function morphForm(from, to) {
    if (from.nodeName === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') {
        const c = to.hasAttribute('checked');
        if (from.checked !== c) { from.checked = c; if (c) queueRefresh(from.closest('.rf-segmented')); }
      } else if (from !== doc.activeElement) {
        const v = to.getAttribute('value') || '';
        if (from.value !== v) { from.value = v; if (from.type === 'range') queueRefresh(from.closest('.rf-slider')); }
      }
    } else if (from.nodeName === 'TEXTAREA' && from !== doc.activeElement) {
      const v = to.value;
      if (from.value !== v) from.value = v;
    }
  }
  function rollTo(el, next, prev) {
    const r = R();
    if (r && r.roll && !U.reduced() && el.isConnected) {
      const a = parseFloat(String(prev).replace(/,/g, '')), b = parseFloat(String(next).replace(/,/g, ''));
      try { r.roll(el, next, { from: prev, dir: isFinite(a) && isFinite(b) && b < a ? -1 : 1 }); return; } catch (e) { /* plain text below */ }
    }
    el.textContent = next;
  }
  function morphNode(from, to) {
    if (from.nodeType !== 1) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
    if (from.hasAttribute('data-roll') && to.hasAttribute('data-roll')) {
      const prev = from.getAttribute('data-roll');
      morphAttrs(from, to);
      if (prev !== to.getAttribute('data-roll')) rollTo(from, to.textContent, prev);
      return;
    }
    morphAttrs(from, to);
    morphForm(from, to);
    if (from.nodeName === 'TEXTAREA' || to.getAttribute('data-morph') === 'keep') return;
    morphChildren(from, to, false);
  }
  function discard(n) {
    if (n.nodeType === 1) {
      const r = R();
      if (r && r.destroy) {
        const list = n.matches(BEHAVIOR_SEL) ? [n] : [];
        for (const el of n.querySelectorAll(BEHAVIOR_SEL)) list.push(el);
        for (const el of list) { try { r.destroy(el); } catch (e) { /* ignore */ } }
      }
    }
    n.remove();
  }
  function appear(el) {
    if (el.nodeType !== 1 || U.reduced() || !el.animate) return;
    el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
  }
  // Makes `parent`'s children match `source`'s (a node or fragment). `animate` plays a short
  // entrance on blocks that are new to a section.
  function morphChildren(parent, source, animate) {
    const want = Array.from(source.childNodes);
    const keyed = new Map();
    for (let n = parent.firstChild; n; n = n.nextSibling) { const k = keyOf(n); if (k) keyed.set(k, n); }
    let cur = parent.firstChild;
    for (const t of want) {
      while (cur && isInjected(cur)) cur = cur.nextSibling;
      const k = keyOf(t);
      let match = null;
      if (k) {
        match = keyed.get(k) || null;
        if (match && sig(match) !== sig(t)) match = null;
        if (match) keyed.delete(k);
      } else if (cur && !keyOf(cur) && sig(cur) === sig(t)) match = cur;
      if (match) {
        if (match === cur) cur = cur.nextSibling;
        else parent.insertBefore(match, cur);
        morphNode(match, t);
      } else {
        if (t.nodeType === 1) record(t);
        parent.insertBefore(t, cur);
        if (animate && t.nodeType === 1 && parent.classList && (parent.classList.contains('section') || parent.classList.contains('rf-list'))) appear(t);
      }
    }
    while (cur) { const next = cur.nextSibling; if (!isInjected(cur)) discard(cur); cur = next; }
  }
  // U.morph(el, html | node): patch el's children in place.
  U.morph = (el, html, animate) => {
    let src = html;
    if (src == null || typeof src === 'string') { const tpl = doc.createElement('template'); tpl.innerHTML = src || ''; src = tpl.content; }
    morphChildren(el, src, !!animate);
    enhance(el);
    return el;
  };
  // Replace el's children with fresh nodes (used when the route changes).
  function replace(el, frag) {
    for (const c of Array.from(el.childNodes)) discard(c);
    for (let c = frag.firstElementChild; c; c = c.nextElementSibling) record(c);
    el.appendChild(frag);
    enhance(el);
  }

  /* ---------------------------------------------------------------- layout */
  let root, topbar, screen, floatEl, playerEl, onboardEl, tabbar, accessory, ptrEl;
  const ALL_TABS = { today: ['today', 'home', 'Today'], plan: ['plan', 'calendar', 'Plan'], food: ['food', 'food', 'Food'], health: ['health', 'heart', 'Health'], progress: ['progress', 'chart', 'Progress'], moves: ['moves', 'library', 'Moves'] };
  // The tabs follow what you track. Food takes the Moves slot when calorie tracking is on (the moves
  // are then in Plan and Profile); with workouts off, Plan, Progress and Moves go away.
  function tabsFor(S) {
    const workouts = !S || !S.profile || S.profile.workouts !== false;
    const food = !!(S && S.profile && GH.food && GH.food.full(S));
    const ids = workouts ? (food ? ['today', 'plan', 'food', 'health', 'progress'] : ['today', 'plan', 'health', 'progress', 'moves']) : (food ? ['today', 'food', 'health'] : ['today', 'health']);
    return ids.map((id) => ALL_TABS[id]);
  }
  let TABS = tabsFor(null);
  U.tabList = () => TABS;
  U.hasTab = (id) => TABS.some((t) => t[0] === id);
  const tabsHtml = (cur) => TABS.map(([id, ic, label]) => `<button type="button" class="rf-tab" data-tab="${id}"${id === cur ? ' aria-current="page"' : ''}>${U.icon(ic)}<span class="rf-tab-label">${label}</span></button>`).join('');
  // Call after a change to what's tracked. Returns true if the tabs changed.
  U.refreshTabs = () => {
    const next = tabsFor(U.S);
    if (next.map((t) => t[0]).join() === TABS.map((t) => t[0]).join()) return false;
    TABS = next;
    if (!U.hasTab(U.route.tab)) U.route = { tab: 'today', view: U.route.view, arg: U.route.arg };
    if (tabbar) {
      U.morph(tabbar.querySelector('.rf-tabbar-bar'), tabsHtml(U.route.tab));
      tabbar.style.setProperty('--tab-count', TABS.length);
      if (R() && R().refresh) safe(() => R().refresh(tabbar));
    }
    return true;
  };
  function layout() {
    root = doc.getElementById('app');
    root.innerHTML = `
      <main id="screen" class="screen" tabindex="-1"></main>
      <header id="topbar" class="rf-navbar topbar" data-rf-managed>
        <div class="rf-scroll-edge" aria-hidden="true"></div>
        <div class="rf-navbar-leading"></div><h2 class="rf-navbar-title"></h2><div class="rf-navbar-trailing"></div>
      </header>
      <div id="ptr" class="ptr" aria-hidden="true"><span class="ptr-dot">${U.icon('refresh')}</span></div>
      <div id="float" class="float-actions" hidden></div>
      <nav class="rf-tabbar" data-position="bottom" aria-label="Main" id="tabbar" style="--tab-count:${TABS.length}">
        <div class="rf-tabbar-accessory rf-glass" data-variant="thick" data-lens id="accessory" hidden></div>
        <div class="rf-tabbar-bar rf-glass" data-lens>${tabsHtml('today')}</div>
      </nav>
      <section id="player" class="player" hidden aria-label="Workout"></section>
      <section id="onboard" class="onboard" hidden aria-label="Set up"></section>`;
    screen = doc.getElementById('screen');
    topbar = doc.getElementById('topbar');
    floatEl = doc.getElementById('float');
    playerEl = doc.getElementById('player');
    onboardEl = doc.getElementById('onboard');
    tabbar = doc.getElementById('tabbar');
    accessory = doc.getElementById('accessory');
    ptrEl = doc.getElementById('ptr');
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
    enhance(topbar);
    // The bar's height feeds the screen's top padding.
    const measure = () => { const h = topbar.offsetHeight; if (h) doc.documentElement.style.setProperty('--topbar-h', h + 'px'); };
    measure();
    if (G.ResizeObserver) new G.ResizeObserver(measure).observe(topbar);
    screen.addEventListener('scroll', onScroll, { passive: true });
    pullToRefresh();
  }
  U.els = () => ({ root, topbar, screen, floatEl, playerEl, onboardEl, tabbar, accessory });

  // The bar's frosted edge and small title appear once the large title slides under it.
  let scrolled = null, scrollFrame = 0;
  function updateScrolled() {
    scrollFrame = 0;
    const lt = screen.querySelector(':scope > .rf-large-title');
    const barH = topbar.offsetHeight;
    const s = lt ? lt.offsetTop + lt.offsetHeight - 8 - screen.scrollTop < barH : screen.scrollTop > 2;
    if (s !== scrolled) { scrolled = s; topbar.toggleAttribute('data-scrolled', s); }
  }
  function onScroll() { if (!scrollFrame) scrollFrame = G.requestAnimationFrame(updateScrolled); }

  function applyNavbar(nb) {
    const part = (sel) => (nb ? nb.querySelector(sel) : null);
    const lead = part('.rf-navbar-leading'), title = part('.rf-navbar-title'), trail = part('.rf-navbar-trailing');
    U.morph(topbar.querySelector('.rf-navbar-leading'), lead ? lead.innerHTML : '');
    U.morph(topbar.querySelector('.rf-navbar-trailing'), trail ? trail.innerHTML : '');
    const t = topbar.querySelector('.rf-navbar-title');
    const text = title ? title.textContent : '';
    if (t.textContent !== text) t.textContent = text;
  }

  /* ---------------------------------------------------------------- motion */
  U.reduced = () => !!(P() && P().reducedMotion());
  const EASE_ENTER = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
  // Cards and titles rise into place one after another (first paint, after set-up, after a workout).
  function stagger(el) {
    if (U.reduced() || !el.animate) return;
    const items = [];
    for (const n of el.querySelectorAll(':scope > .rf-large-title, :scope > .lt-sub, :scope > .section > *, :scope > .sec-title')) {
      items.push(n);
      if (items.length >= 9) break;
    }
    items.forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 30 + i * 45, easing: EASE_ENTER, fill: 'backwards' }));
  }
  U.stagger = stagger;
  // Route changes: tabs slide a little toward the tab you picked, pushed views come in from the side.
  function routeIn(kind) {
    if (U.reduced() || !screen.animate || !kind) return;
    if (kind === 'stagger') { stagger(screen); return; }
    const x = { push: 36, pop: -36, right: 18, left: -18 }[kind] || 0;
    screen.animate([{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }], { duration: kind === 'push' || kind === 'pop' ? 320 : 260, easing: EASE_ENTER });
  }
  function floatIn() {
    if (U.reduced() || !floatEl.animate) return;
    floatEl.animate([{ opacity: 0, transform: 'translateY(18px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' });
  }

  /* ---------------------------------------------------------------- rendering */
  const cleanups = [];
  U.onCleanup = (fn) => cleanups.push(fn);
  function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } }
  let lastKey = null;
  let nextMotion = null;
  const scrollMemo = {};
  function render(motion) {
    if (!U.S || !U.S.profile.onboarded) { U.showOnboarding(); return; }
    onboardEl.hidden = true;
    U.refreshTabs();
    const r = U.route;
    const key = r.view ? `${r.view}:${r.arg || ''}` : r.tab;
    const changed = key !== lastKey;
    if (changed && lastKey && !lastKey.includes(':')) scrollMemo[lastKey] = screen.scrollTop;
    runCleanups();
    const scr = U.screens[r.view || r.tab] || U.screens.today;
    const day = U.today();
    let html = '';
    try { html = scr.render(U.S, day, r.arg); } catch (e) { html = errorBox(e); }
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    const nb = tpl.content.querySelector('header.rf-navbar');
    if (nb) nb.remove();
    applyNavbar(nb);
    screen.dataset.view = r.view || r.tab;
    if (changed) replace(screen, tpl.content);
    else { morphChildren(screen, tpl.content, !motion); enhance(screen); }
    const fl = scr.float ? safe(() => scr.float(U.S, day, r.arg)) : '';
    const wasHidden = floatEl.hidden;
    U.morph(floatEl, fl || '');
    floatEl.hidden = !fl;
    if (fl && (wasHidden || changed)) floatIn();
    if (scr.after) safe(() => scr.after(screen, U.S, day, r.arg, changed));
    if (changed) {
      screen.scrollTop = r.view ? 0 : scrollMemo[key] || 0;
      const kind = motion || nextMotion;
      nextMotion = null;
      routeIn(kind);
      if (r.view && r.arg && scr.focus) safe(() => scr.focus(screen, r.arg));
    } else if (motion) routeIn(motion);
    lastKey = key;
    updateScrolled();
    tabbar.toggleAttribute('data-away', !!r.view);
    for (const t of tabbar.querySelectorAll('.rf-tab')) { if (t.dataset.tab === r.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
    if (R() && R().refresh) safe(() => R().refresh(tabbar));
    renderAccessory();
  }
  U.render = render;
  // The next route change plays this entrance (e.g. 'stagger' after set-up).
  U.nextMotion = (kind) => { nextMotion = kind; };
  function safe(fn) { try { return fn(); } catch (e) { if (G.console) G.console.error(e); return ''; } }
  function errorBox(e) {
    if (G.console) G.console.error(e);
    return `<div class="section"><div class="card"><p class="t-headline">Something went wrong drawing this screen.</p><p class="t-footnote rf-muted">${U.esc(e && e.message)}</p><button class="rf-btn" data-act="goToday">Back to Today</button></div></div>`;
  }
  function enhance(el) { const r = R(); if (r && r.init) safe(() => r.init(el)); }
  U.enhance = enhance;

  const tabIndex = (t) => TABS.findIndex((x) => x[0] === t);
  function go(tab) {
    // A section that isn't a tab right now opens as a page (Moves with Food on), or Today.
    if (!U.hasTab(tab)) {
      if (tab === 'moves' || (tab === 'food' && GH.food && U.S && GH.food.full(U.S))) { U.open(tab); return; }
      tab = 'today';
    }
    if (U.route.tab === tab && !U.route.view) { screen.scrollTo({ top: 0, behavior: U.reduced() ? 'auto' : 'smooth' }); return; }
    const from = U.route.view ? null : tabIndex(U.route.tab);
    const to = tabIndex(tab);
    U.haptic('select');
    if (U.markSeen) U.markSeen(`tab_${tab}`);
    U.route = { tab, view: null, arg: null };
    render(from == null ? 'pop' : to > from ? 'right' : to < from ? 'left' : null);
    if (U.screens[tab] && U.screens[tab].shown) safe(() => U.screens[tab].shown(U.S, U.today()));
  }
  U.go = go;
  const viewStack = [];
  U.open = (view, arg) => {
    if (U.route.view) viewStack.push({ view: U.route.view, arg: U.route.arg, scroll: screen.scrollTop });
    U.route = { tab: U.route.tab, view, arg: arg == null ? null : arg };
    render('push');
    screen.focus({ preventScroll: true });
    if (U.screens[view] && U.screens[view].shown) safe(() => U.screens[view].shown(U.S, U.today(), arg));
  };
  U.back = () => {
    if (!U.route.view) return false;
    const prev = viewStack.pop();
    U.route = { tab: U.route.tab, view: prev ? prev.view : null, arg: prev ? prev.arg : null };
    render('pop');
    if (prev) screen.scrollTop = prev.scroll || 0;
    return true;
  };
  U.act.goToday = () => go('today');
  U.act.back = () => U.back();

  // A workout in progress rides above the tab bar on other tabs.
  function renderAccessory() {
    const A = U.S && U.S.active;
    const show = !!A && playerEl.hidden && !(U.route.tab === 'today' && !U.route.view);
    const was = !accessory.hidden;
    accessory.hidden = !show;
    // Emptied with morph, not innerHTML: that keeps Refract's lens layer (the capsule's glass), which
    // Refract only puts back on a resize.
    if (!show) { U.morph(accessory, ''); return; }
    const doneN = A.steps.slice(0, A.idx).filter((s) => s.kind === 'set').length;
    const total = A.steps.filter((s) => s.kind === 'set').length;
    U.morph(accessory, `<span class="rf-activity-leading" data-tone="coral" style="width:36px;height:36px">${U.icon('timer', 'sm')}</span>
      <span class="acc-text"><b>${U.esc(A.session.title)}</b><span class="t-caption rf-secondary">${doneN} of ${total} sets</span></span>
      <span class="rf-spacer"></span>
      <button type="button" class="rf-btn" data-size="sm" data-act="resumeWorkout">Resume</button>`);
    if (!was && !U.reduced() && accessory.animate) accessory.animate([{ opacity: 0, transform: 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE_ENTER });
  }
  U.renderAccessory = renderAccessory;

  /* ---------------------------------------------------------------- haptics */
  U.haptic = (kind) => { const p = P(); if (p && p.haptic) p.haptic(kind); };

  /* ---------------------------------------------------------------- events */
  function dispatch(map, el, ev, value) {
    const name = el.getAttribute(map === U.act ? 'data-act' : 'data-on');
    const fn = map[name];
    if (!fn) return;
    try { fn(el, ev, value); } catch (e) { if (G.console) G.console.error(e); U.toast('Something went wrong', 'critical'); }
  }
  function wire() {
    doc.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.rf-stepper-btn')) U.haptic('tick');
      const el = e.target.closest && e.target.closest('[data-act]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (P()) P().unlockAudio();
      dispatch(U.act, el, e);
    });
    const onChange = (e) => {
      const t = e.target;
      if (t.matches && t.matches('.rf-segment input, .ob-radio')) U.haptic('select');
      else if (t.matches && t.matches('input[role="switch"]')) U.haptic(t.checked ? 'toggleOn' : 'toggleOff');
      const el = t.closest && t.closest('[data-on]');
      if (!el) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
      dispatch(U.on, el, e, v);
    };
    doc.addEventListener('change', onChange);
    doc.addEventListener('rf-toggle', (e) => {
      const el = e.target.closest && e.target.closest('[data-on]');
      if (e.target.closest && e.target.closest('.rf-chip')) U.haptic('select');
      if (el && e.detail && 'pressed' in e.detail) dispatch(U.on, el, e, e.detail.pressed);
    });
    // Sliders tick as they pass each step.
    doc.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type === 'range' && t.dataset.lastTick !== t.value) { t.dataset.lastTick = t.value; U.haptic('tick'); }
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
    ctl.update = (html) => { U.morph(ctl.body, html); };
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
  U.confirm = (title, message, label, tone, icon) => {
    if (tone === 'critical') U.haptic('heavy');
    return U.dialog({
      title, message, icon, tone: tone === 'critical' ? 'critical' : undefined,
      actions: [{ label: 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label, value: 'ok', variant: 'filled', tone: tone || 'accent' }],
    }).then((v) => v === 'ok');
  };
  U.toast = (title, tone, message, action) => {
    if (tone === 'positive') U.haptic('success');
    else if (tone === 'critical' || tone === 'caution') U.haptic('error');
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
  // Reads Health Connect when the app opens or comes back (at most once a minute), every 15 minutes
  // while it's open, after a workout, and on pull-to-refresh or the refresh button.
  const SYNC_EVERY = 15 * 60000;
  const SYNC_GAP = 60000;
  let syncing = null;
  let lastTry = 0;
  let syncError = null;
  U.syncState = () => ({ busy: !!syncing, last: U.S && U.S.health.lastSync, error: syncError });
  U.syncHealth = (reason) => {
    const S = U.S;
    if (!S || !GH.health) return Promise.resolve(null);
    const manual = reason === true || reason === 'manual';
    const st = GH.health.status();
    S.health.status = st;
    if (!GH.health.connected(st)) return Promise.resolve(null);
    if (syncing) return syncing;
    if (!manual && Date.now() - lastTry < SYNC_GAP) return Promise.resolve(null);
    lastTry = Date.now();
    syncing = (async () => {
      try {
        const res = await GH.health.sync(S, Date.now());
        syncError = res && !res.ok ? res.error || 'failed' : null;
        if (res && res.ok) { GH.health.afterSync(S, U.today()); U.save(); }
        return res;
      } catch (e) {
        syncError = 'failed';
        return { ok: false, error: 'failed' };
      }
    })();
    syncChanged();
    return syncing.finally(() => { syncing = null; syncChanged(); });
  };
  // Anything showing sync state re-renders; screens mark it with data-sync.
  function syncChanged() {
    const busy = !!syncing;
    for (const el of doc.querySelectorAll('[data-sync-spin]')) el.toggleAttribute('data-spinning', busy);
    if (!busy && U.S && U.S.profile.onboarded && playerEl.hidden && onboardEl.hidden) render();
  }
  // "Updated 3 min ago" labels stay current without a re-render.
  function tickAgo() { for (const el of doc.querySelectorAll('[data-ago]')) { const t = U.ago(Number(el.dataset.ago)); if (el.textContent !== t) el.textContent = t; } }

  // Pull down at the top of Today or Health to read Health Connect now.
  function pullToRefresh() {
    let pull = null;
    const can = () => !U.route.view && (U.route.tab === 'today' || U.route.tab === 'health') && U.S && GH.health && GH.health.connected(GH.health.status());
    const reset = (animate) => {
      ptrEl.classList.remove('armed');
      if (animate && !U.reduced() && ptrEl.animate) ptrEl.animate([{ transform: ptrEl.style.transform, opacity: ptrEl.style.opacity || 1 }, { transform: 'translateY(0)', opacity: 0 }], { duration: 220, easing: 'ease-out' });
      ptrEl.style.transform = ''; ptrEl.style.opacity = '';
    };
    screen.addEventListener('touchstart', (e) => { pull = screen.scrollTop <= 0 && e.touches.length === 1 && can() && !syncing ? { y0: e.touches[0].clientY, armed: false, d: 0 } : null; }, { passive: true });
    screen.addEventListener('touchmove', (e) => {
      if (!pull) return;
      const dy = e.touches[0].clientY - pull.y0;
      if (dy <= 0 || screen.scrollTop > 0) { if (pull.d) reset(false); pull.d = 0; return; }
      const d = Math.min(120, dy * 0.45);
      pull.d = d;
      ptrEl.style.transform = `translateY(${d}px) rotate(${d * 3}deg)`;
      ptrEl.style.opacity = String(Math.min(1, d / 56));
      const armed = d >= 64;
      if (armed !== pull.armed) { pull.armed = armed; ptrEl.classList.toggle('armed', armed); if (armed) U.haptic('tick'); }
    }, { passive: true });
    const end = () => {
      if (!pull) return;
      const armed = pull.armed;
      pull = null;
      if (!armed) { reset(true); return; }
      ptrEl.classList.add('spinning');
      U.syncHealth('manual').then((res) => {
        ptrEl.classList.remove('spinning');
        reset(true);
        if (res && res.ok) U.haptic('success');
        else if (res && !res.ok) U.toast('Couldn\'t read Health Connect', 'caution', res.error === 'timeout' ? 'It took too long. Try again.' : undefined);
      });
    };
    screen.addEventListener('touchend', end, { passive: true });
    screen.addEventListener('touchcancel', () => { if (pull) { pull = null; reset(true); } }, { passive: true });
  }

  /* ---------------------------------------------------------------- boot */
  function applyPrefs() {
    const p = U.S ? U.S.profile.prefs : { theme: 'system', sound: true, vibrate: true, haptics: true, density: 0.5 };
    if (P()) {
      P().setPrefs({ sound: p.sound !== false, vibrate: p.vibrate !== false, haptics: p.haptics !== false, hapticStrength: p.hapticStrength || 'medium' });
      P().applyTheme(p.theme || 'system', !!p.contrast);
      if (p.density != null) P().setDensity(p.density);
    }
  }
  U.applyPrefs = applyPrefs;

  let lastDay = null;
  function boot() {
    layout();
    wire();
    if (P()) {
      P().onBack(onBack);
      P().on('resume', () => {
        if (!U.S || !U.S.profile.onboarded) return;
        U.syncHealth('resume');
        if (U.today() !== lastDay) { lastDay = U.today(); if (playerEl.hidden) render(); }
      });
      P().on('route', (route) => openRoute(route));
      P().on('insets', () => { updateScrolled(); });
    }
    U.S = GH.store.load();
    applyPrefs();
    const r = R();
    if (r && r.observe) safe(() => r.observe(doc.body));
    if (!U.S || !U.S.profile.onboarded) U.showOnboarding();
    else {
      render('stagger');
      if (U.S.active && U.resumePrompt) U.resumePrompt();
      U.syncHealth('boot');
      if (U.afterBoot) safe(() => U.afterBoot());
    }
    lastDay = U.today();
    setInterval(() => {
      const d = U.today();
      if (d !== lastDay) { lastDay = d; if (U.S && U.S.profile.onboarded && playerEl.hidden) render(); }
      if (U.S && U.S.profile.onboarded && (!P() || P().visible()) && Date.now() - (U.S.health.lastSync || 0) >= SYNC_EVERY) U.syncHealth('interval');
      tickAgo();
    }, 30000);
    const hash = (G.location && G.location.hash || '').replace('#', '');
    if (hash) openRoute(hash);
    G.addEventListener('hashchange', () => openRoute((G.location.hash || '').replace('#', '')));
  }
  function openRoute(route) {
    const ready = U.S && U.S.profile.onboarded;
    if (route === 'privacy') { if (ready) U.open('privacy'); else if (U.showPrivacySheet) U.showPrivacySheet(); }
    else if (['health', 'plan', 'progress', 'moves', 'today', 'food'].includes(route)) { if (ready) go(route); }
    else if (['profile', 'settings', 'science', 'coach'].includes(route)) { if (ready) U.open(route); }
  }
  U.boot = boot;
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
