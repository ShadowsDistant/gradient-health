/* Bottom sheets. U.sheet(o) → { el, body, closed, update(html), close(value), detent(name) }.
 *
 * A sheet is a <dialog> opened with showModal() (the page behind is inert; Back, Esc and focus work
 * as usual) covering the screen with a scrim and a panel anchored to the bottom edge. The panel only
 * ever moves with a transform, so nothing is laid out while it moves:
 *  - Detents are translateY offsets. An 'auto' sheet's panel is as tall as the screen: 'medium'
 *    shows its content up to 62% of the screen and 'large' all of it (up to full height). Content
 *    that fits in medium gets no large detent, so a swipe up never shows empty sheet. 'fit' sheets
 *    are as tall as their content and 'full' ones open at large; both only open and dismiss.
 *  - A drag writes one transform a frame (plus the scrim's opacity). It starts from the grabber and
 *    header, and from the content while the sheet is below its top detent. At the top the content
 *    scrolls, and pulling down at its top edge hands over to the sheet.
 *  - A release projects the finger's speed forward, picks a detent (or dismisses) and settles with a
 *    damped spring that starts at that speed: a Web Animation with a linear() easing sampled from the
 *    spring, which the compositor plays.
 * o: { title, body, action: { label, act, arg }, cls, size: 'fit' | 'auto' | 'full', onClose(value),
 * after(ctl), quiet (no nav haptic as it opens) }. Older calls pass detents/detent/fit instead: fit →
 * 'fit', detents 'large' → 'full', anything else → 'auto' (detent: 'large' opens it at large).
 * While any sheet moves, <html> has data-sheet-moving and the document hears 'gh-sheet-moving'
 * ({ detail: { moving } }), so other animations can wait; U.sheetMoving() says so too. While any is
 * open, <html> has data-sheet-open.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const R = () => G.Refract || null;
  if (!doc) return;

  const LOCK = 8; // px a finger moves before the gesture picks a direction
  const MEDIUM = 0.62; // medium shows at most this much of the screen
  const MIN_STEP = 48; // content this close to medium's height just shows whole (no sliver of a detent)
  const OUT = 24; // closed: this far below the panel's own height (clears its shadow)
  const BAND = 72; // the most a sheet stretches past its top detent
  const PROJECT = 200; // a release carries on at its speed for this long (ms) before picking a detent
  const FLICK = 0.35; // px/ms: a flick moves at least one detent its way
  const FLICK_OUT = 0.6; // px/ms: a flick down from the lowest detent dismisses
  // [response ms, damping ratio]. Settles take 250 to 350 ms (90% of the way in about 150): quick
  // with a little give, never a slow drift. Closing doesn't bounce.
  const SPRINGS = { open: [280, 0.9], snap: [290, 0.8], out: [240, 1] };
  const THERE = { open: 1, snap: 1, out: 4 }; // px from the end that counts as there (leaving: out of sight)

  const supports = (p, v) => { try { return !!(G.CSS && G.CSS.supports(p, v)); } catch (e) { return false; } };
  const LINEAR = supports('animation-timing-function', 'linear(0, 1)');
  // A closed sheet stays in the top layer while it slides out, so the page is usable at once. A
  // WebView without overlay transitions closes it when the slide ends instead.
  const DISCRETE = supports('overlay', 'auto') && supports('transition-behavior', 'allow-discrete');
  const safe = (fn) => { try { return fn(); } catch (e) { if (G.console) G.console.error(e); return undefined; } };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const reduced = () => !!(U.reduced && U.reduced());
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const tf = (y) => `translate3d(0,${Math.round(y * 100) / 100}px,0)`;
  const TEXT_INPUT = /^(text|search|email|number|tel|url|password)$/;
  const texty = (t) => !!t && ((t.tagName === 'TEXTAREA' && !t.readOnly) || (t.tagName === 'INPUT' && TEXT_INPUT.test(t.type) && !t.readOnly) || t.isContentEditable);

  /* ---------------------------------------------------------------- motion */
  // A damped spring from 0 to 1 that starts at velocity v (a fraction of the distance per ms).
  function springCurve(response, damping, v) {
    const w = 2 * Math.PI / response, z = damping;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z), b = (v - z * w) / wd;
      return (t) => 1 + Math.exp(-z * w * t) * (b * Math.sin(wd * t) - Math.cos(wd * t));
    }
    const b = v - w;
    return (t) => 1 + (b * t - 1) * Math.exp(-w * t);
  }
  // A move over `dist` px starting at v0 px/ms: how long it takes (until it stays THERE), an easing
  // for the compositor, and x(t) to find where it is mid-way. With reduced motion: a short ease with
  // no overshoot.
  function motion(dist, v0, kind) {
    if (reduced()) { const T = 160; return { T, easing: 'cubic-bezier(0.2, 0, 0, 1)', x: (t) => (t >= T ? 1 : 1 - Math.pow(1 - t / T, 3)) }; }
    const [response, damping] = SPRINGS[kind];
    const x = springCurve(response, damping, dist ? clamp(v0 / dist, -0.05, 0.05) : 0);
    const eps = THERE[kind] / Math.max(1, Math.abs(dist));
    let T = 0;
    for (let t = 0; t <= 2000; t += 5) if (Math.abs(1 - x(t)) > eps) T = t + 5;
    T = clamp(T, 90, 1500);
    if (!LINEAR) {
      // No linear() (older WebViews): a curve that starts fast and settles, over at most half a second.
      const T2 = Math.min(T, 520);
      return { T: T2, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)', x: (t) => (t >= T2 ? 1 : x(t * T / T2)) };
    }
    const n = clamp(Math.ceil(T / 10), 12, 100);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(Math.round(x(T * i / n) * 1e4) / 1e4);
    pts.push(1);
    return { T, easing: `linear(${pts.join(',')})`, x: (t) => (t >= T ? 1 : x(t)) };
  }

  /* ---------------------------------------------------------------- the page behind */
  // A sheet at large sets the page back a little, like a card: a transform only, played alongside a
  // sheet's settle. The first time it recedes the page gets a layer of its own, kept until the last
  // sheet closes (so going back and forth never repaints the whole page), and its rounded corners
  // (see sheet.css); neither changes while it moves. A sheet that never sets it back leaves it alone:
  // a new layer for the whole page means painting all of it again.
  const openSheets = []; // open sheets, bottom to top
  const page = { r: 0, from: 0, anim: null, m: null, sat: 0 };
  const appEl = () => doc.getElementById('app');
  const pageTf = (r) => (r > 0.0005 ? `translate3d(0,${(r * (page.sat + 6)).toFixed(2)}px,0) scale(${(1 - 0.06 * r).toFixed(4)})` : 'none');
  function pageNow() {
    const a = page.anim;
    return a && a.playState === 'running' ? page.from + (page.r - page.from) * page.m.x(a.currentTime || 0) : page.r;
  }
  // How far the page should be set back, with every open sheet where it's heading.
  function pageFor() {
    if (reduced()) return 0;
    let r = 0;
    for (const o of openSheets) r = Math.max(r, recedeAt(o, o.restY));
    return r;
  }
  // Sets the page back to r (0 to 1), with a settle's motion. A page already heading there keeps going.
  function setPage(r, m) {
    const app = appEl();
    if (!app) return;
    if (Math.abs(r - page.r) < 0.0005) { pageDone(); return; }
    const from = pageNow();
    if (page.anim) { page.anim.cancel(); page.anim = null; }
    page.r = r;
    app.style.transform = pageTf(r);
    // data-receded says where it's heading; data-set-back (its corners, and the dark around it) stays
    // until it's back at full size.
    const back = r > 0.0005;
    app.toggleAttribute('data-receded', back);
    if (back) { app.setAttribute('data-set-back', ''); app.setAttribute('data-sheeted', ''); }
    if (m && Math.abs(from - r) > 0.001 && app.animate) {
      page.from = from; page.m = m;
      const a = page.anim = app.animate({ transform: [pageTf(from), pageTf(r)] }, { duration: m.T, easing: m.easing });
      a.finished.then(() => { if (page.anim === a) { page.anim = null; if (page.r <= 0.0005) app.removeAttribute('data-set-back'); pageDone(); } }, () => {});
    } else {
      if (!back) app.removeAttribute('data-set-back');
      pageDone();
    }
  }
  // Nothing open or leaving any more: the page goes back to how it was.
  let leaving = 0;
  function pageDone() {
    const app = appEl();
    if (openSheets.length || leaving || !app || page.anim) return;
    app.style.transform = '';
    app.removeAttribute('data-receded');
    app.removeAttribute('data-set-back');
    app.removeAttribute('data-sheeted');
  }
  // The status bar's height, which the page clears as it recedes (read as the first sheet opens).
  function pageOpen() {
    if (openSheets.length === 1) page.sat = parseFloat(G.getComputedStyle(doc.documentElement).getPropertyValue('--sat')) || 0;
  }
  // The page's glass at the bottom (the tab bar and the floating buttons, with their blur and lens)
  // is hidden while a sheet at rest covers it: the scrim changes every frame a sheet moves, and the
  // compositor would redraw those filters under it each time. It comes back the moment a drag or a
  // close would show it.
  function bottomGlassTop() {
    let top = Infinity;
    for (const id of ['tabbar', 'float']) {
      const e = doc.getElementById(id);
      if (!e || e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.height) top = Math.min(top, r.top);
    }
    return top;
  }
  const covering = (o, y) => !o.closing && o.coverY != null && y <= o.coverY;
  function setCovered(on) {
    const app = appEl();
    if (app && app.hasAttribute('data-covered') !== on) app.toggleAttribute('data-covered', on);
  }
  const othersCover = (s) => openSheets.some((o) => o !== s && covering(o, o.restY));

  /* ---------------------------------------------------------------- moving */
  let moving = 0;
  function setMoving(s, on) {
    if (s.moving === on) return;
    s.moving = on;
    s.el.toggleAttribute('data-moving', on);
    moving += on ? 1 : -1;
    const any = moving > 0, root = doc.documentElement;
    if (root.hasAttribute('data-sheet-moving') === any) return;
    root.toggleAttribute('data-sheet-moving', any);
    doc.dispatchEvent(new CustomEvent('gh-sheet-moving', { detail: { moving: any } }));
  }
  // <html> has data-sheet-open while any sheet is open (not leaving), for things on the page behind
  // that can rest meanwhile.
  function markOpen() {
    const root = doc.documentElement, any = openSheets.length > 0;
    if (root.hasAttribute('data-sheet-open') !== any) root.toggleAttribute('data-sheet-open', any);
  }

  /* ---------------------------------------------------------------- geometry */
  // Reads the panel's size and works out the detents (never during a drag: see the ResizeObserver).
  function measure(s) {
    s.dirty = false;
    const vis = s.vvh || s.el.clientHeight || G.innerHeight;
    const H = s.panel.offsetHeight;
    s.H = H;
    s.closedY = H + OUT;
    s.lowY = s.topY = 0;
    if (s.size !== 'auto') return;
    const content = s.body.offsetTop + s.body.scrollHeight;
    const cap = Math.round(vis * MEDIUM);
    const whole = content <= cap + MIN_STEP;
    s.lowY = Math.max(0, H - (whole ? content : cap));
    s.topY = whole ? s.lowY : Math.max(0, H - content);
    if (s.lowY - s.topY < MIN_STEP) s.topY = s.lowY;
  }
  const hasLarge = (s) => s.size === 'full' || (s.size === 'auto' && s.topY < s.lowY);
  const yOf = (s, name) => (name === 'large' ? s.topY : s.lowY);
  function detents(s) {
    if (s.size === 'full') return [{ name: 'large', y: 0 }];
    return hasLarge(s) ? [{ name: 'large', y: s.topY }, { name: 'medium', y: s.lowY }] : [{ name: 'medium', y: s.lowY }];
  }
  const topName = (s) => (hasLarge(s) ? 'large' : 'medium');
  // The scrim: darker the more of the sheet is up, fading out as it leaves.
  function scrimAt(s, y) {
    const base = s.size === 'full' ? 1 : hasLarge(s) ? 0.6 : 0.75;
    if (y >= s.lowY) return clamp(base * (1 - (y - s.lowY) / Math.max(1, s.closedY - s.lowY)), 0, 1);
    return clamp(base + (1 - base) * (s.lowY - y) / Math.max(1, s.lowY - s.topY), 0, 1);
  }
  function recedeAt(s, y) {
    if (s.closing || s.size === 'fit') return 0;
    if (s.size === 'full') return clamp(1 - y / Math.max(1, s.closedY), 0, 1);
    return s.topY < s.lowY ? clamp((s.lowY - y) / (s.lowY - s.topY), 0, 1) : 0;
  }

  /* ---------------------------------------------------------------- the viewport and the keyboard */
  // A browser's keyboard covers the page instead of shrinking it: the panel then rides above it (the
  // Android app's WebView shrinks instead, which the panel's height follows by itself).
  let watching = false;
  function watchViewport(on) {
    const vv = G.visualViewport;
    if (!vv || on === watching) return;
    watching = on;
    for (const t of ['resize', 'scroll']) vv[on ? 'addEventListener' : 'removeEventListener'](t, onViewport);
  }
  function onViewport() {
    const vv = G.visualViewport;
    const kb = Math.abs((vv.scale || 1) - 1) > 0.01 ? 0 : Math.max(0, Math.round(G.innerHeight - vv.height - vv.offsetTop));
    for (const s of openSheets) {
      if (kb > 8) { s.el.style.setProperty('--kb', `${kb}px`); s.el.style.setProperty('--vvh', `${Math.round(vv.height)}px`); s.vvh = vv.height; }
      else if (s.vvh) { s.el.style.removeProperty('--kb'); s.el.style.removeProperty('--vvh'); s.vvh = 0; }
    }
  }
  // The field being typed in stays in sight above the keyboard.
  function keepFieldInView(s) {
    const a = doc.activeElement;
    if (s.closing || !a || !s.body.contains(a) || !texty(a)) return;
    const vv = G.visualViewport;
    const r = a.getBoundingClientRect(), b = s.body.getBoundingClientRect();
    const bottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : G.innerHeight) - 12, top = b.top + 8;
    if (r.bottom > bottom) s.body.scrollTop += Math.min(r.bottom - bottom, r.top - top);
    else if (r.top < top) s.body.scrollTop -= top - r.top;
  }

  /* ---------------------------------------------------------------- haptics */
  // A sheet opening plays nav, in answer to a touch or a key in the last second: one the app opens by
  // itself (at launch, after a long wait) stays quiet, and so does one opened with o.quiet. One the
  // person closes (the close button, a tap on the scrim, a swipe down, Esc, Back) plays back.
  let lastInput = -1e9;
  for (const t of ['pointerdown', 'pointerup', 'keydown']) doc.addEventListener(t, () => { lastInput = now(); }, true);
  const haptic = (kind) => { if (U.haptic) U.haptic(kind); };

  /* ---------------------------------------------------------------- a sheet */
  function sizeOf(o) {
    if (o.size === 'fit' || o.size === 'auto' || o.size === 'full') return o.size;
    if (o.fit) return 'fit';
    return String(o.detents || '').trim() === 'large' ? 'full' : 'auto';
  }

  U.sheet = (o) => {
    const size = sizeOf(o);
    const el = doc.createElement('dialog');
    el.className = 'rf-sheet gh-sheet' + (o.cls ? ' ' + o.cls : '');
    el.setAttribute('data-rf-managed', ''); // Refract binds its own sheet behaviour to .rf-sheet; this replaces it
    el.setAttribute('data-size', size);
    const tid = 'sh' + Math.random().toString(36).slice(2, 8);
    el.setAttribute('aria-labelledby', tid);
    el.innerHTML = `<div class="gh-sheet-scrim" aria-hidden="true"></div>
      <div class="gh-sheet-panel">
        <div class="rf-sheet-grabber"${size === 'auto' ? ' role="button" tabindex="0" aria-label="Resize sheet"' : ' aria-hidden="true"'}></div>
        <div class="rf-sheet-header">
          <button type="button" class="rf-btn" data-shape="circle" data-size="sm" aria-label="Close" data-sheet-close>${U.icon('close')}</button>
          <h2 class="rf-sheet-title" id="${tid}">${U.esc(o.title || '')}</h2>
          ${o.action ? `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="sm" data-act="${U.esc(o.action.act)}"${o.action.arg != null ? ` data-arg="${U.esc(o.action.arg)}"` : ''}>${U.esc(o.action.label)}</button>` : '<span class="sheet-spacer"></span>'}
        </div>
        <div class="rf-sheet-body" tabindex="-1"${/\sautofocus\b/.test(o.body || '') ? '' : ' autofocus'}>${o.body || ''}</div>
      </div>`;
    // Opening focuses the content, not the grabber or the close button: on a sheet the app opens by
    // itself (not from a tap) Chrome would draw its focus ring round them.
    doc.body.appendChild(el);
    if (U.enhance) U.enhance(el);
    // Its controls are placed now, in the one layout the sheet reads anyway to size itself, rather
    // than in the next frame's read pass (core.js): placed while it slid open, a sheet with a view
    // switch over a 3D figure drew no frames for most of a second.
    if (U.readNow) U.readNow();
    const s = {
      el, size, scrim: el.querySelector('.gh-sheet-scrim'), panel: el.querySelector('.gh-sheet-panel'),
      grab: el.querySelector('.rf-sheet-grabber'), header: el.querySelector('.rf-sheet-header'), body: el.querySelector('.rf-sheet-body'),
      H: 0, lowY: 0, topY: 0, closedY: 0, y: 0, restY: 0, detent: null, vvh: 0, coverY: null,
      run: null, moving: false, closing: false, dirty: false, wantTop: false, dragEnd: -1e9,
    };
    const ctl = { el, body: s.body, closed: false };
    s.ctl = ctl;

    /* ---------- where it is, and moving it */
    // Where the panel is now, mid-animation too (so a finger can catch a moving sheet).
    const current = () => {
      const r = s.run;
      return r && r.a.playState === 'running' ? r.from + (r.to - r.from) * r.m.x(r.a.currentTime || 0) : s.y;
    };
    const speed = () => {
      const r = s.run;
      if (!r || r.a.playState !== 'running') return 0;
      const t = r.a.currentTime || 0;
      return (r.to - r.from) * (r.m.x(t + 4) - r.m.x(t)) / 4;
    };
    const stop = () => {
      if (!s.run) return;
      const y = current();
      s.run.a.cancel(); if (s.run.b) s.run.b.cancel();
      s.run = null;
      put(y);
    };
    // One frame of a drag: the panel's transform and the scrim's opacity, each only when it changed.
    // The page's recede waits for the settle: moving the whole page layer every frame costs the
    // compositor about a third more per frame (measured), for a change hard to see under a finger.
    const put = (y) => {
      s.y = y;
      s.panel.style.transform = tf(y);
      const op = scrimAt(s, y).toFixed(3);
      if (s.scrim.style.opacity !== op) s.scrim.style.opacity = op;
      if (s.coverY != null && y > s.coverY && !s.closing && !othersCover(s)) setCovered(false);
    };
    // Settles at `to`, starting at velocity v (px/ms): transform and scrim on the compositor.
    const slide = (to, v, kind, done) => {
      const from = current();
      const vel = v == null ? speed() : v;
      stop();
      s.y = to;
      const m = motion(to - from, vel, kind);
      const fade = reduced() && (kind === 'open' || kind === 'out');
      s.panel.style.transform = tf(fade ? (kind === 'out' ? from : to) : to);
      const o0 = scrimAt(s, from), o1 = kind === 'out' ? 0 : scrimAt(s, to);
      s.scrim.style.opacity = o1.toFixed(3);
      setPage(pageFor(), m);
      if (s.coverY != null && to > s.coverY && !othersCover(s)) setCovered(false);
      if (!s.panel.animate || (Math.abs(to - from) < 0.5 && !fade)) {
        if (s.panel.animate) s.scrim.animate({ opacity: [o0, o1] }, { duration: m.T, easing: m.easing });
        if (done) done();
        settled();
        return m;
      }
      setMoving(s, true);
      // With reduced motion, opening and closing fade instead of sliding.
      const a = fade
        ? s.panel.animate({ opacity: kind === 'out' ? [1, 0] : [0, 1] }, { duration: m.T, easing: 'linear', fill: kind === 'out' ? 'forwards' : 'none' })
        : s.panel.animate({ transform: [tf(from), tf(to)] }, { duration: m.T, easing: m.easing });
      const b = s.scrim.animate({ opacity: [o0, o1] }, { duration: m.T, easing: fade ? 'linear' : m.easing });
      const run = s.run = { a, b, from: fade ? to : from, to, m };
      a.finished.then(() => { if (s.run === run) { s.run = null; settled(); if (done) done(); } }, () => {});
      return m;
    };
    // At rest: the material comes back, the page's glass under the sheet is hidden, and a field
    // being typed in is brought into view.
    const settled = () => {
      if (s.run || dragging()) return;
      setMoving(s, false);
      if (s.closing) return;
      if (s.dirty) { relayout(); return; }
      const limit = bottomGlassTop();
      s.coverY = limit === Infinity ? null : s.y + limit - s.panel.getBoundingClientRect().top;
      setCovered(openSheets.some((o) => covering(o, o.restY)));
      keepFieldInView(s);
    };
    const setDetent = (name) => {
      const top = s.size !== 'auto' || name === 'large' || !hasLarge(s);
      if (el.hasAttribute('data-at-top') !== top) el.toggleAttribute('data-at-top', top);
      if (name === s.detent) return;
      s.detent = name;
      el.setAttribute('data-detent', name);
      el.dispatchEvent(new CustomEvent('rf-detent', { detail: { detent: name }, bubbles: true }));
    };
    const goTo = (name, v, kind) => {
      setDetent(name);
      s.restY = yOf(s, name);
      return slide(s.restY, v, kind || 'snap');
    };
    ctl.detent = (name) => {
      if (s.closing || dragging()) return;
      const n = name === 'large' && hasLarge(s) ? 'large' : s.size === 'full' ? 'large' : 'medium';
      if (n !== s.detent || Math.abs(current() - yOf(s, n)) > 0.5) goTo(n, 0);
    };
    // The panel or its content changed size: new detents, and the sheet follows its own (or goes to
    // the top one while a field is being typed in, so the keyboard never hides it).
    const relayout = () => {
      measure(s);
      let name = s.wantTop ? topName(s) : s.detent;
      if (name === 'large' && !hasLarge(s)) name = 'medium';
      if (s.size === 'full') name = 'large';
      setDetent(name);
      const y = yOf(s, name);
      s.restY = y;
      if (s.run && Math.abs(s.run.to - y) < 0.5) return;
      if (Math.abs(current() - y) > 0.5) slide(y, null, 'snap');
      else keepFieldInView(s);
    };

    /* ---------- dragging */
    let g = null; // the gesture in progress
    let frame = 0;
    const dragging = () => !!g && g.state === 'drag';
    const band = (y) => { if (y >= s.topY) return y; const d = s.topY - y; return s.topY - BAND * (1 - 1 / (d * 0.55 / BAND + 1)); };
    const zoneOf = (t) => {
      if (!t || !t.closest || !s.panel.contains(t)) return null; // the scrim
      if (t.closest('[data-no-drag], input[type="range"], .rf-slider')) return null; // never a sheet drag
      return s.body.contains(t) ? 'body' : 'handle';
    };
    // What would scroll under the finger: the nearest box in the sheet that can scroll up or down.
    const scrollerOf = (t) => {
      for (let n = t; n && n !== s.panel; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1) {
          const oy = G.getComputedStyle(n).overflowY;
          if (oy === 'auto' || oy === 'scroll') return n;
        }
      }
      return null;
    };
    // Whether a vertical move of dy is the sheet's: from the grabber and header always; from the
    // content while the sheet is below its top detent (the content doesn't scroll there); at the top,
    // when nothing scrolls under the finger or it's pulled down at the scroller's top edge.
    const sheetTakes = (dy) => {
      if (g.zone === 'handle' || !el.hasAttribute('data-at-top')) return true;
      return !g.sc || (dy > 0 && g.sc.scrollTop <= 0);
    };
    // From the finger's first touch (so the sheet stays under it, the few pixels it took to pick a
    // direction included), or from where a scroll handed over.
    const begin = (fy, time, from) => {
      const y = current();
      stop();
      g.state = 'drag';
      g.from = y; g.fy = from == null ? fy : from; g.samples = [];
      g.startName = s.detent;
      g.fromLow = y >= s.lowY - 4;
      setMoving(s, true);
      follow(fy, time);
    };
    const follow = (fy, time) => {
      g.samples.push([time, fy]);
      while (g.samples.length > 2 && time - g.samples[0][0] > 120) g.samples.shift();
      g.y = band(g.from + fy - g.fy);
      if (!frame) frame = G.requestAnimationFrame(tick);
    };
    const tick = () => { frame = 0; if (g && g.state === 'drag' && g.y !== s.y) put(g.y); };
    // Velocity from the last ~100 ms of the finger (a least-squares line, so one jittery sample
    // doesn't throw it); none if the finger stopped before letting go.
    const velocity = (list, t1) => {
      const r = list.filter(([t]) => t1 - t <= 100);
      if (r.length < 2 || t1 - r[r.length - 1][0] > 60) return 0;
      const t0 = r[0][0];
      let n = 0, st = 0, sy = 0, stt = 0, sty = 0;
      for (const [t, y] of r) { const x = t - t0; n++; st += x; sy += y; stt += x * x; sty += x * y; }
      const den = n * stt - st * st;
      return den > 1e-6 ? (n * sty - st * sy) / den : 0;
    };
    const release = (v) => {
      const d = g;
      g = null;
      if (frame) { G.cancelAnimationFrame(frame); frame = 0; }
      s.dragEnd = now();
      if (s.dirty) measure(s);
      put(d.y);
      const y = s.y, list = detents(s), low = list[list.length - 1];
      const proj = y + v * PROJECT;
      // Dismissed: flicked down from the lowest detent, or thrown past halfway to gone. A flick down
      // from large stops at medium first.
      if ((d.fromLow || y > low.y) && (v > FLICK_OUT || proj > low.y + (s.closedY - low.y) / 2)) { ctl.close('cancel', Math.max(v, 0)); return; }
      let pick = list.reduce((a, b) => (Math.abs(b.y - proj) < Math.abs(a.y - proj) ? b : a));
      if (Math.abs(v) > FLICK && pick.name === d.startName) {
        const i = list.indexOf(pick) + (v > 0 ? 1 : -1);
        if (list[i]) pick = list[i];
      }
      if (pick.name !== d.startName && U.haptic) U.haptic('detent');
      goTo(pick.name, v);
    };
    const findTouch = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };

    el.addEventListener('touchstart', (e) => {
      if (s.closing || dragging()) return;
      const t = e.changedTouches[0], zone = zoneOf(e.target);
      if (!zone || e.touches.length > 1) return;
      // What would scroll under the finger is read now, before anything moves, so the moves that
      // follow never read layout.
      g = { kind: 'touch', id: t.identifier, x0: t.clientX, y0: t.clientY, zone, state: 'pending', ly: t.clientY, sc: zone === 'body' ? scrollerOf(e.target) : null };
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!g || g.kind !== 'touch') return;
      const t = findTouch(e.changedTouches, g.id);
      if (!t) return;
      const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
      if (g.state === 'pending') {
        const vertical = Math.abs(dy) > Math.abs(dx);
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK) {
          // Until the direction is clear, the browser mustn't start a scroll the sheet may want.
          if (vertical && e.cancelable && sheetTakes(dy)) e.preventDefault();
          return;
        }
        if (!vertical) { g.state = 'off'; return; } // sideways: chip rails, sliders, charts, pages
        g.ly = t.clientY;
        if (!sheetTakes(dy)) { g.state = 'native'; return; }
        if (e.cancelable) e.preventDefault();
        begin(t.clientY, e.timeStamp, g.y0);
        return;
      }
      if (g.state === 'native') {
        // Scrolled back to the top and still pulling down: the sheet takes over mid-gesture (the
        // browser owns this gesture's scroll by now, but it has nothing left to scroll).
        const down = t.clientY > g.ly;
        g.ly = t.clientY;
        if (down && g.sc && g.sc.scrollTop <= 0) { begin(t.clientY, e.timeStamp); g.handed = true; }
        return;
      }
      if (g.state !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      // Handed over from a scroll and pushed back up to the top: the content scrolls again.
      if (g.handed && t.clientY < g.ly && g.y <= s.topY) { put(s.topY); setMoving(s, false); g.state = 'native'; g.ly = t.clientY; return; }
      g.ly = t.clientY;
      follow(t.clientY, e.timeStamp);
    }, { passive: false });
    const touchEnd = (e) => {
      if (!g || g.kind !== 'touch') return;
      const t = findTouch(e.changedTouches, g.id);
      if (!t) return;
      if (g.state !== 'drag') { g = null; return; }
      if (e.type === 'touchcancel') { release(0); return; }
      follow(t.clientY, e.timeStamp);
      release(velocity(g.samples, e.timeStamp));
    };
    el.addEventListener('touchend', touchEnd);
    el.addEventListener('touchcancel', touchEnd);
    // A mouse (or pen) drags from the grabber and header, and from the content below the top detent,
    // but never from a control (that would eat its click).
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0 || s.closing || dragging()) return;
      const zone = zoneOf(e.target);
      if (!zone || e.target.closest('button, a, input, textarea, select, label, [contenteditable], .rf-segmented, .rf-chip')) return;
      if (zone === 'body' && el.hasAttribute('data-at-top')) return;
      g = { kind: 'mouse', id: e.pointerId, x0: e.clientX, y0: e.clientY, zone, state: 'pending' };
    });
    el.addEventListener('pointermove', (e) => {
      if (!g || g.kind !== 'mouse' || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (g.state === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        if (Math.abs(dx) > Math.abs(dy)) { g = null; return; }
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        begin(e.clientY, e.timeStamp, g.y0);
      }
      follow(e.clientY, e.timeStamp);
    });
    const pointerEnd = (e) => {
      if (!g || g.kind !== 'mouse' || e.pointerId !== g.id) return;
      if (g.state !== 'drag') { g = null; return; }
      release(e.type === 'pointercancel' ? 0 : velocity(g.samples, e.timeStamp));
    };
    el.addEventListener('pointerup', pointerEnd);
    el.addEventListener('pointercancel', pointerEnd);
    // A drag that started on a button doesn't also press it. Only that gesture's click is swallowed:
    // a tap that starts after the drag ended (a switch right after a pull) goes through.
    let downAt = -1e9;
    el.addEventListener('pointerdown', () => { downAt = now(); }, true);
    el.addEventListener('click', (e) => { if (e.detail && downAt <= s.dragEnd && now() - s.dragEnd < 350) { e.preventDefault(); e.stopPropagation(); } }, true);

    /* ---------- closing */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (o.onClose) safe(() => o.onClose(el.returnValue));
    };
    const remove = () => {
      if (!el.isConnected) return;
      if (ro) ro.disconnect();
      setMoving(s, false);
      const r = R();
      if (r && r.destroy) for (const x of el.querySelectorAll('*')) { try { r.destroy(x); } catch (e) { /* ignore */ } }
      el.remove();
      leaving--;
      if (!openSheets.length) watchViewport(false);
      pageDone();
    };
    // Slides out (at the finger's speed after a drag), then closes with `value` as its returnValue.
    // A cancel is the person closing it, with back's feel; any other value is the app closing it after
    // an action, which has its own.
    ctl.close = (value, v) => {
      if (s.closing) return;
      if (value === 'cancel' && !s.quiet) haptic('back');
      s.closing = true;
      ctl.closed = true;
      g = null;
      leaving++;
      const i = openSheets.indexOf(s);
      if (i >= 0) openSheets.splice(i, 1);
      markOpen();
      setCovered(othersCover(s));
      el.setAttribute('data-closing', '');
      const m = slide(s.closedY, v == null ? 0.4 : v, 'out');
      const T = m ? Math.round(m.T) : 0;
      const shut = () => { try { if (el.open) el.close(value); } catch (e) { /* ignore */ } };
      if (DISCRETE || !el.open) { el.style.transition = `display ${T}ms allow-discrete, overlay ${T}ms allow-discrete`; shut(); } else G.setTimeout(shut, T);
      if (s.run) s.run.a.finished.then(remove, remove);
      G.setTimeout(remove, T + 80);
    };
    // Closed by the browser itself (Esc before any tap, a form's method=dialog): it still slides out.
    el.addEventListener('close', () => { if (!s.closing) ctl.close(el.returnValue); finish(); });
    // Esc animates out like everything else.
    el.addEventListener('cancel', (e) => { e.preventDefault(); ctl.close('cancel'); });
    s.scrim.addEventListener('click', () => ctl.close('cancel'));
    el.querySelector('[data-sheet-close]').addEventListener('click', () => ctl.close('cancel'));
    ctl.update = (html) => { U.morph(s.body, html); };

    /* ---------- focus, the keyboard, and content below the fold */
    // Typing wants the whole sheet: a text field expands it to large and keeps it there.
    el.addEventListener('focusin', (e) => {
      s.wantTop = texty(e.target);
      if (s.wantTop && s.detent && !s.closing && !dragging() && s.detent !== topName(s)) goTo(topName(s), 0);
    });
    el.addEventListener('focusout', (e) => { if (!texty(e.relatedTarget)) s.wantTop = false; });
    // Something scrolled the dialog to show content below the fold (focus moving there, a find, a
    // scrollIntoView): it scrolls straight back, and an auto sheet expands to show it instead.
    // Content scrolling makes the material solid until it stops, like a move (see sheet.css).
    let scrollIdle = 0;
    el.addEventListener('scroll', (e) => {
      if (e.target !== el) {
        if (!el.hasAttribute('data-scrolling')) el.setAttribute('data-scrolling', '');
        G.clearTimeout(scrollIdle);
        scrollIdle = G.setTimeout(() => el.removeAttribute('data-scrolling'), 160);
        return;
      }
      if (!el.scrollTop && !el.scrollLeft) return;
      el.scrollTop = 0; el.scrollLeft = 0;
      if (!s.closing && !dragging() && s.detent === 'medium' && hasLarge(s)) goTo('large', 0);
    }, true);
    if (size === 'auto') {
      s.grab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          ctl.detent(e.key === 'ArrowUp' || (e.key !== 'ArrowDown' && s.detent !== 'large') ? 'large' : 'medium');
        }
      });
    }

    /* ---------- opening */
    openSheets.push(s);
    markOpen();
    pageOpen();
    watchViewport(true);
    if (G.visualViewport) onViewport();
    try { el.showModal(); } catch (e) { el.setAttribute('open', ''); }
    // Measured where it will rest (the panel's CSS transform is none, so focusing the content on
    // showModal never scrolled anything), then sent below the screen to slide up from.
    s.panel.style.transform = 'none';
    measure(s);
    const first = s.size === 'full' ? 'large' : (s.wantTop || (s.size === 'auto' && o.detent === 'large')) && hasLarge(s) ? 'large' : 'medium';
    s.y = s.closedY;
    put(s.closedY);
    goTo(first, 0, 'open');
    if (!o.quiet && now() - lastInput < 1000) haptic('nav');
    const ro = G.ResizeObserver ? new G.ResizeObserver(() => { if (s.closing) return; if (dragging()) s.dirty = true; else relayout(); }) : null;
    if (ro) for (const x of [s.panel, s.header, s.body]) ro.observe(x);
    if (o.after) safe(() => o.after(ctl));
    return ctl;
  };

  // The app closing them on its way somewhere else (that move has its own feel): no back.
  U.closeSheets = () => { for (const s of openSheets.slice()) { s.quiet = true; s.ctl.close('cancel'); } };
  U.topSheet = () => { const s = openSheets[openSheets.length - 1]; return s ? s.ctl : null; };
  U.sheetMoving = () => moving > 0;
})(typeof window !== 'undefined' ? window : globalThis);
