/* Motion: route changes, lists that glide, and cards that fold away or open up (U.motion).
 *
 * Everything here moves with transform and opacity only, so the compositor plays it and nothing is
 * laid out again while it moves. With reduced motion a route change is a short fade, and lists and
 * cards change at once (a card folding away fades first).
 *
 * U.motion.routeSwap(screen, frag, kind)  The route changed. The old page moves into a layer of its
 *   own beside the screen (.screen-exit: nothing in it takes a tap or is read out, and its ids are
 *   renamed) and leaves from where it was scrolled to, while frag, already in the screen when this
 *   returns, comes in, on Refract's springs: a push slides the new page in from the edge as the old
 *   one falls back a third of the way, Back plays that in reverse, and a tab change ('left',
 *   'right') morphs from one page to the other in place; any other kind just swaps.
 * U.motion.flip(els, mutate)  Measures els (an element's children, or a list of elements), runs
 *   mutate, then glides each from where it was to where it is now. Resolves when they've landed.
 * U.motion.exit(el)  el leaves from where it is: it's out of the flow at once, so what comes after it
 *   glides up into its room while it fades and shrinks there; then it's dropped.
 * U.motion.collapse(el, change)  el fades and shrinks where it is, then goes, or change() runs instead
 *   (a re-render that folds it into something smaller, which fades in), and what's after it glides
 *   up. Resolves once it's gone or changed.
 * U.motion.expand(el, parent, before)  el goes in before `before`, what's after it glides down to
 *   make room, and el fades and grows in. Resolves when it's in.
 * U.motion.settled()  Resolves once everything above that's playing has finished.
 *
 * For src/ui/core.js: snap(root) measures a page before a re-render patches it; the patch reports
 * each container it changes (patched), so new blocks rise in and removed ones leave from where they
 * were (one in sight stays in the page, inert, for the 200 ms its fade takes: code or a test that
 * looks for it to be gone waits for settled()); play() then glides whatever moved, every glide
 * starting in the same frame. barSwap(bar)
 * cross-fades the navigation bar's title and buttons across a route change. show(el, frames, o)
 * plays frames on a part with glass in it without the glass losing its frost, and fadeAway(el, ms, seen)
 * lets a part that hides at once (the workout capsule, the floating buttons) fade where it was.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const M = U.motion = U.motion || {};
  const doc = G.document;
  if (!doc) return;
  const R = () => G.Refract || null;
  // What core.js lends: dropping a node the way a patch does (Refract's cleanup runs), moving nodes
  // without Refract taking them for new ones, and the set of nodes on their way out.
  const kit = () => U.morphKit || null;
  const reduced = () => !!(U.reduced && U.reduced());
  // Motion wants a page that's on screen: a hidden one draws no frames, so nothing would end.
  const can = (el) => !!(el && el.isConnected && el.animate && !doc.hidden);
  const run = (el, frames, o) => { try { return el.animate(frames, o); } catch (e) { return null; } };
  const ended = (a) => (a && a.finished ? a.finished.then(() => true, () => false) : Promise.resolve(false));
  const drop = (n) => { const k = kit(); if (k) k.discard(n); else if (n.parentNode) n.parentNode.removeChild(n); };
  const aside = (fn) => { const k = kit(); return k ? k.aside(fn) : fn(); };
  const isLeaving = (n) => { const k = kit(); return !!(k && k.leaving.has(n)); };
  const passOver = (n) => { const k = kit(); return k ? k.passOver(n) : false; };

  /* ---------------------------------------------------------------- tokens */
  // The design system's curves and settle times (vendor/refract/tokens.json), read once for each
  // motion setting.
  const FALLBACK = 'cubic-bezier(0.2, 0, 0, 1)';
  const tokens = [null, null];
  function tok() {
    const i = reduced() ? 1 : 0;
    if (tokens[i]) return tokens[i];
    const r = R();
    const ease = (n, f) => (r && r.easing ? r.easing(n, f) : f);
    const ms = (n, f) => (r && r.duration ? r.duration(n, f) : f);
    tokens[i] = {
      standard: ease('ease-standard', FALLBACK),
      enter: ease('ease-enter', 'cubic-bezier(0.05, 0.7, 0.1, 1)'),
      exit: ease('ease-exit', 'cubic-bezier(0.3, 0, 0.8, 0.15)'),
      snappy: ease('spring-snappy', FALLBACK), snappyMs: ms('duration-spring-snappy', 460),
      smooth: ease('spring-smooth', FALLBACK), smoothMs: ms('duration-spring-smooth', 640),
    };
    return tokens[i];
  }

  /* ---------------------------------------------------------------- what's playing */
  const playing = new Set();
  function track(x) {
    const p = x && x.finished ? ended(x) : Promise.resolve(x).then(() => {}, () => {});
    playing.add(p);
    p.then(() => playing.delete(p));
    return p;
  }
  M.settled = () => (playing.size ? Promise.all(Array.from(playing)).then(() => M.settled()) : Promise.resolve());
  // The translation an element has from a glide that's still running (its layout box is that much
  // off from where it's drawn).
  function offsetNow(el) {
    const t = G.getComputedStyle(el).transform;
    const m = t && t !== 'none' ? /matrix(3d)?\(([^)]+)\)/.exec(t) : null;
    if (!m) return { x: 0, y: 0, t: 'none' };
    const v = m[2].split(',').map(parseFloat);
    return m[1] ? { x: v[12] || 0, y: v[13] || 0, t } : { x: v[4] || 0, y: v[5] || 0, t };
  }

  /* ---------------------------------------------------------------- glass that fades */
  // Glass shows what's behind it, frosted; but an element fading by opacity is where the backdrop of
  // everything inside it stops. Glass inside a fading part shows the page behind it sharp until the
  // fade ends, then frosts over at once. An element's own opacity doesn't cut off its own backdrop,
  // though, so glass fades by itself, carrying its frost on its own body meanwhile (data-fading: the
  // lens layer, a child, is off until the fade ends; src/styles/motion.css), and a part with glass in
  // it only moves, while its glass and its other parts fade each by themselves.
  const fadingNow = new WeakMap(); // glass → how many fades it's in
  function fadingGlass(el, a) {
    if (!a) return a;
    fadingNow.set(el, (fadingNow.get(el) || 0) + 1);
    el.setAttribute('data-fading', '');
    ended(a).then(() => {
      const n = (fadingNow.get(el) || 1) - 1;
      if (n) fadingNow.set(el, n);
      else { fadingNow.delete(el); el.removeAttribute('data-fading'); }
    });
    return a;
  }
  const only = (frames, prop) => frames.map((k) => { const f = {}; for (const p of Object.keys(k)) if (p === prop || p === 'offset' || p === 'easing') f[p] = k[p]; return f; });
  function show(el, frames, o) {
    const out = [];
    const walk = (n, kf) => {
      const glass = n.classList.contains('rf-glass');
      if (glass || !n.querySelector('.rf-glass')) {
        const a = run(n, kf, o);
        if (glass) fadingGlass(n, a);
        out.push(a);
        return;
      }
      if (kf.some((k) => 'transform' in k)) out.push(run(n, only(kf, 'transform'), o));
      const fade = only(kf, 'opacity');
      for (const c of n.children) walk(c, fade);
    };
    if (el && el.nodeType === 1) walk(el, frames);
    out.forEach(track);
    return out;
  }
  M.show = show;
  // A part positioned on its own (the workout capsule, the floating buttons) that hides at once: a
  // copy of it fades and sinks where it was, over ms (shorter on a route change, so it's gone with the
  // old page). One that wasn't showing (under a sheet that covers the app) just goes. The copy goes
  // last in the parent: being positioned, it's drawn in the same place, and nothing after it is
  // styled again for a node put in before it.
  // seen: whether it was showing, when the caller read that before changing anything (asked here,
  // after the change, it brings the page's style up to date).
  M.fadeAway = (el, ms, seen) => {
    if (reduced() || !can(el) || !el.parentNode) return Promise.resolve();
    if (seen === false || (seen == null && el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))) return Promise.resolve();
    const c = el.cloneNode(true);
    c.classList.add('motion-copy');
    c.hidden = false;
    shield(c);
    aside(() => el.parentNode.appendChild(c));
    const a = show(c, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.94)' }], { duration: ms || 220, easing: tok().standard, fill: 'forwards' });
    return track(Promise.all(a.map(ended)).then(() => c.remove()));
  };

  /* ---------------------------------------------------------------- parts on their way out */
  // A part that's leaving (the old page, a removed card, a copy of a bar button) takes no taps, isn't
  // read out and leaves its radio groups (a page coming in with the same names would uncheck it).
  // Its ids get a suffix of their own, so the page never has an id twice while it's still there; the
  // references inside it follow (a badge's medal fills with gradients defined next to it), so it
  // looks the same to the end.
  let gen = 0;
  const REFS = '[fill^="url(#"], [stroke^="url(#"], [clip-path^="url(#"], [mask^="url(#"], [filter^="url(#"], [href^="#"]';
  const REF_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'href'];
  function shield(el) {
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    for (const i of el.querySelectorAll('input[type="radio"][name]')) i.removeAttribute('name');
    const ids = Array.from(el.querySelectorAll('[id]'));
    if (el.id) ids.push(el);
    if (!ids.length) return;
    const tag = `--gone${++gen}`;
    const map = new Map();
    for (const n of ids) { const id = n.id + tag; map.set(n.id, id); n.id = id; }
    for (const n of el.querySelectorAll(REFS)) {
      for (const a of REF_ATTRS) {
        const v = n.getAttribute(a);
        const m = v && (/^url\(#(.+)\)$/.exec(v) || /^#(.+)$/.exec(v));
        if (m && map.has(m[1])) n.setAttribute(a, v.replace(m[1], map.get(m[1])));
      }
    }
  }

  /* ---------------------------------------------------------------- route changes */
  // How each kind moves: Refract 1.4's page motion (Refract.page), on its springs. A push slides the
  // new page in from the edge on the smooth spring (the glide for large surfaces) while the old one
  // falls back a third of the way and fades; Back plays that in reverse, the page under it coming
  // back from a third of the way over. A tab change morphs in place: the new page settles from 97% as
  // the old one grows to 103% and fades (360 ms). Each fade has a timeline of its own, so the old page
  // is gone well before the end and the two are rarely both half there.
  const TABS = { left: 1, right: 1, tab: 1 };
  const SLIDES = { push: 1, pop: 1, left: 1, right: 1, tab: 1 };
  function routeSpec(kind) {
    const t = tok();
    const spring = { duration: t.smoothMs, easing: t.smooth };
    if (TABS[kind]) {
      return {
        in: { move: ['scale(0.97)', 'scale(1)'], fade: [[0], [1, 0.45]], time: spring },
        out: { move: ['scale(1)', 'scale(1.03)'], fade: [[1], [0]], time: { duration: 360, easing: t.standard } },
      };
    }
    const push = kind === 'push';
    return {
      in: { move: [push ? 'translateX(100%)' : 'translateX(-30%)', 'translateX(0)'], fade: push ? null : [[0], [0, 0.04], [1, 0.5]], time: spring },
      out: { move: ['translateX(0)', push ? 'translateX(-30%)' : 'translateX(100%)'], fade: [[1], [0, 0.5], [0]], time: spring },
    };
  }
  const swaps = new Set(); // old pages still leaving: { layer, anims, done }
  let entering = []; // the screen's own entrance, while it plays

  // One moving part: a move on its spring, and a fade (if any) through the given stops (keyframe
  // offsets, each step easing out) over the same time.
  function slide(el, part, fill, from) {
    const t = tok();
    const move = from ? [from.transform, part.move[1]] : part.move;
    const fade = part.fade && from ? [[from.opacity], ...part.fade.slice(1)] : part.fade;
    const out = [run(el, move.map((v) => ({ transform: v })), Object.assign({ fill }, part.time))];
    if (fade) out.push(run(el, fade.map(([o, at]) => (at == null ? { opacity: o, easing: t.standard } : { opacity: o, offset: at, easing: t.standard })), { duration: part.time.duration, easing: 'linear', fill }));
    return out;
  }
  // Where an animated element is drawn right now (a transform and an opacity), to carry on from.
  function drawnAt(el) {
    const cs = G.getComputedStyle(el);
    return { transform: cs.transform === 'none' ? 'translateX(0)' : cs.transform, opacity: parseFloat(cs.opacity) };
  }
  // A route change while another is still playing: the old pages still leaving fade out fast from
  // where they are, and the screen's entrance stops where it got to (that page is about to leave from
  // there).
  function hurry() {
    for (const x of Array.from(swaps)) {
      // One already hurried away (route changes in quick succession) just goes: two old pages on
      // screen at most.
      if (x.hurried || !x.layer.isConnected) { x.done(); continue; }
      x.hurried = true;
      const at = drawnAt(x.layer);
      for (const a of x.anims) if (a) a.cancel();
      const a = run(x.layer, [{ transform: at.transform, opacity: at.opacity }, { transform: at.transform, opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' });
      x.anims = [a];
      ended(a).then(() => x.done());
    }
  }
  function stopEntrance(screen) {
    const at = entering.some((a) => a && a.playState === 'running') ? drawnAt(screen) : null;
    for (const a of entering) if (a) a.cancel();
    entering = [];
    return at;
  }

  // What's below the bottom of the screen never shows while the old page leaves (it moves sideways),
  // so it goes at once: the old page is styled, laid out and drawn again in its layer, and this is
  // that much less of it. From the end of the page, and on into each block that crosses the bottom
  // edge (a section, a card, a list) whose children stack one under another by themselves, so
  // dropping the last ones moves none of the others. Hidden parts (no box) are passed over.
  // Measured before anything changes (reads only, so one layout at most), dropped after.
  function stacks(el, r) {
    if (el.matches('.section, .rf-list')) return true;
    if (r.height < 200) return false; // a small part: little to gain
    const cs = G.getComputedStyle(el);
    if (cs.minHeight !== 'auto' && cs.minHeight !== '0px') return false; // room it would spread out to fill
    if (cs.display === 'flex') return cs.flexDirection === 'column' && cs.flexWrap === 'nowrap';
    if (cs.display === 'grid') return cs.gridAutoFlow.indexOf('row') === 0;
    return cs.display === 'block' || cs.display === 'flow-root' || cs.display === 'list-item';
  }
  function belowSight(screen) {
    const out = [];
    const bottom = (G.innerHeight || doc.documentElement.clientHeight) + 40;
    const walk = (parent) => {
      for (let c = parent.lastElementChild; c; c = c.previousElementSibling) {
        const r = c.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.top > bottom) { out.push(c); continue; }
        if (r.bottom > bottom && stacks(c, r)) walk(c);
        return;
      }
    };
    if (screen.firstElementChild) walk(screen);
    return out;
  }
  // barSwap measures it on its way (the bar is measured in the same layout, before the render
  // changes anything); routeSwap uses that, or measures it itself.
  let below = null;

  M.routeSwap = (screen, frag, kind) => {
    const pre = below;
    below = null;
    hurry();
    const from = stopEntrance(screen);
    const moving = !!SLIDES[kind] && !!screen.firstElementChild && can(screen);
    if (!moving || reduced()) {
      for (const c of Array.from(screen.childNodes)) drop(c);
      screen.appendChild(frag);
      // Reduced motion: the new page fades in, nothing slides.
      if (moving) entering = [run(screen, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' })];
      entering.forEach(track);
      return;
    }
    const f = routeSpec(kind);
    // Out of the page now; Refract's cleanup for them runs when the old page goes.
    const gone = (pre && pre.screen === screen ? pre.list : belowSight(screen)).filter((c) => screen.contains(c));
    for (const c of gone) c.remove();
    // The old page, in a layer with the screen's look (its class and attributes), moved up by as far
    // as it was scrolled, so it starts exactly where it was. Its nodes are set aside (Refract keeps
    // what it set up on them, for the cleanup when they go).
    const layer = doc.createElement('div');
    layer.className = 'screen screen-exit';
    for (const a of ['data-view', 'data-pushed', 'data-float', 'data-capsule']) if (screen.hasAttribute(a)) layer.setAttribute(a, screen.getAttribute(a));
    layer.setAttribute('data-kind', kind);
    const top = pre && pre.screen === screen ? pre.scroll : screen.scrollTop;
    if (top) layer.style.translate = `0 ${-top}px`;
    // A tab's morph scales about the middle of what was on screen (the layer is as tall as the page).
    if (TABS[kind]) layer.style.transformOrigin = `50% ${Math.round(top + (G.innerHeight || 800) / 2)}px`;
    aside(() => { while (screen.firstChild) layer.appendChild(screen.firstChild); });
    shield(layer);
    screen.appendChild(frag);
    const x = { layer, anims: [] };
    let finished = false;
    x.done = () => {
      if (finished) return;
      finished = true;
      swaps.delete(x);
      for (const a of x.anims) if (a) a.cancel();
      drop(layer);
      for (const c of gone) drop(c);
    };
    swaps.add(x);
    entering = slide(screen, f.in);
    entering.forEach(track);
    // The old page goes on the page once the render that called this is done (before the next
    // frame): the layout that render does for the new page then doesn't lay the old one out too. It
    // goes last in the app (it's drawn under the screen whatever its place, by its z-index), so the
    // bars and buttons after the screen aren't styled again for a node put in before them.
    const shown = new Promise((resolve) => Promise.resolve().then(() => {
      if (finished) { resolve(); return; }
      aside(() => screen.parentNode.appendChild(layer));
      x.anims = slide(layer, f.out, 'forwards', from);
      Promise.all(x.anims.map(ended)).then(() => x.done()).then(resolve);
    }));
    // (A page sent to the background meanwhile draws no frames: its motion ends, and the old page
    // goes, as soon as it's back.)
    track(shown);
  };

  // The navigation bar across a route change. Before: what each part (title, leading and trailing
  // buttons) shows and where. After: a part that changed leaves as a copy fading out where it was,
  // and the new one fades in, a little from the side the page is coming from. A title with nothing
  // to show (the new page is at its top) goes at once, so its new words never fade out. The copies
  // go in a stand-in for the bar laid over it (its classes, none of its content or its id), so the
  // bar itself only ever holds what it shows now.
  const BAR = [['.rf-navbar-leading', false], ['.rf-navbar-title', true], ['.rf-navbar-trailing', false]];
  // A title whose page is at its top goes at once, its fade off until the change has been drawn.
  // (Finishing the fade after the change instead meant asking for its transitions, which brings the
  // whole page's style up to date in the middle of the render that drew the new page.) Its own
  // transition comes back two frames later, unless another change has asked again meanwhile.
  const noFades = new WeakMap(); // title → the latest ask
  function noFade(el) {
    const ask = (noFades.get(el) || 0) + 1;
    noFades.set(el, ask);
    el.style.transition = 'none';
    const back = () => { if (noFades.get(el) === ask) { noFades.delete(el); el.style.removeProperty('transition'); } };
    if (G.requestAnimationFrame) G.requestAnimationFrame(() => G.requestAnimationFrame(back)); else setTimeout(back, 50);
  }
  // What a part shows: the title's words, or which buttons (by what they do and say, so a button
  // whose state alone changed isn't taken for a new one).
  const showing = (el, title) => (title ? el.textContent.trim() : Array.from(el.children, (c) => `${c.getAttribute('data-act') || c.tagName}|${c.getAttribute('aria-label') || ''}`).join());
  const isShown = (bar, el, title) => (title ? bar.hasAttribute('data-scrolled') && !!el.textContent.trim() : el.childElementCount > 0);
  M.barSwap = (bar) => {
    if (reduced() || !can(bar)) return null;
    const box = bar.getBoundingClientRect();
    const parts = [];
    for (const [sel, title] of BAR) {
      const el = bar.querySelector(`:scope > ${sel}`);
      if (!el) continue;
      const shown = isShown(bar, el, title);
      parts.push({ el, title, was: showing(el, title), r: shown ? el.getBoundingClientRect() : null, copy: shown ? el.cloneNode(true) : null });
    }
    const screen = doc.getElementById('screen');
    if (screen) below = { screen, list: belowSight(screen), scroll: screen.scrollTop };
    return (kind) => {
      const t = tok();
      // The way the old page moves (left on a push or a tab to the right).
      const dir = kind === 'push' || kind === 'right' ? -1 : kind === 'pop' || kind === 'left' ? 1 : 0;
      // A title slides a little; buttons shrink or grow in place, each by itself.
      const pieces = (el, title) => (title ? [el] : Array.from(el.children));
      const look = (title) => `translateX(${dir * 10}px)${title ? '' : ' scale(.8)'}`;
      let holder = null;
      const leaving = [];
      for (const p of parts) {
        if (!p.el.isConnected || showing(p.el, p.title) === p.was) continue;
        if (p.copy) {
          if (!holder) {
            holder = bar.cloneNode(false);
            holder.removeAttribute('id');
            holder.classList.add('motion-copy');
            shield(holder);
            aside(() => bar.parentNode.appendChild(holder));
          }
          const c = p.copy;
          c.classList.add('motion-copy');
          Object.assign(c.style, { position: 'absolute', margin: '0', left: `${p.r.left - box.left}px`, top: `${p.r.top - box.top}px`, width: `${p.r.width}px`, height: `${p.r.height}px`, opacity: '1', translate: 'none', transition: 'none' });
          shield(c);
          aside(() => holder.appendChild(c));
          for (const x of pieces(c, p.title)) leaving.push(...show(x, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: look(p.title) }], { duration: 180, easing: t.standard, fill: 'forwards' }));
        }
        if (isShown(bar, p.el, p.title)) {
          // The title's own fade (data-scrolled) already brings it in when it wasn't showing.
          if (p.title && !p.copy) continue;
          const from = p.title ? `translateX(${-dir * 10}px)` : 'scale(.8)';
          for (const x of pieces(p.el, p.title)) show(x, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: p.title ? 260 : 360, delay: 60, easing: p.title ? t.enter : t.snappy, fill: 'backwards' });
        } else if (p.title) noFade(p.el);
      }
      if (holder) { const h = holder; track(Promise.all(leaving.map(ended)).then(() => h.remove())); }
    };
  };

  /* ---------------------------------------------------------------- FLIP */
  // Lists, a page's sections and its cards: measured before a change (First), read again once after
  // it (Last), and everything that moved glides back from where it was (Invert, Play). Positions are
  // taken inside each container, so a row in a card that moves glides with the card, and a glide
  // still running carries on from where it's drawn.
  const FLIP_MAX = 8; // more changes than this in one container, and it just changes
  const CONTAINER = '.section, .rf-list, [data-flip]';
  const glides = new WeakMap(); // an element → its glide while it plays

  function measure(parent, box, only) {
    const kids = new Map();
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
      if (passOver(c) || (only && !only.has(c))) continue;
      // The box on screen, and where it sits in its offset parent (in case it leaves).
      kids.set(c, { r: c.getBoundingClientRect(), top: c.offsetTop, left: c.offsetLeft, w: c.offsetWidth, h: c.offsetHeight, op: c.offsetParent });
    }
    return { parent, box: box || parent.getBoundingClientRect(), kids, off: false };
  }
  // A child that's going: out of the flow at once, pinned where it was (what's after it closes up
  // under it), then it fades and shrinks there and is dropped. False when it can't be, or when it
  // wasn't in sight anyway (core drops it at once).
  function pin(el, f) {
    const k = kit();
    if (!k || !el.style || !f || !f.w || !f.h || !f.op || f.op === doc.body) return false;
    const h = G.innerHeight || doc.documentElement.clientHeight;
    if (f.r.bottom < 0 || f.r.top > h) return false;
    k.leaving.add(el);
    shield(el);
    el.classList.add('motion-leaving');
    Object.assign(el.style, { position: 'absolute', boxSizing: 'border-box', margin: '0', top: `${f.top}px`, left: `${f.left}px`, width: `${f.w}px`, height: `${f.h}px`, pointerEvents: 'none' });
    return true;
  }
  // One glide, on the timing its whole patch shares: a container that moves and a child that moves
  // the other way inside it cancel out exactly only if both run the same curve.
  function glide(el, x, y, time) {
    const old = glides.get(el);
    const a = run(el, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], time);
    if (old) old.cancel();
    if (!a) return null;
    glides.set(el, a);
    ended(a).then(() => { if (glides.get(el) === a) glides.delete(el); });
    return track(a);
  }
  const all = (list) => Promise.all(list.map(ended)).then(() => {});
  // A block new to a list or a page rises into place, a beat after its neighbours start to make room.
  function rise(el, delay) {
    if (el.nodeType !== 1 || !el.animate) return null;
    return all(show(el, [{ opacity: 0, transform: 'translateY(8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: delay || 0, easing: tok().enter, fill: 'backwards' }));
  }
  // A pinned block fades and shrinks where it's drawn, then goes.
  function vanish(el, at) {
    const list = show(el, [{ opacity: 1, transform: at || 'none' }, { opacity: 0, transform: `${at && at !== 'none' ? at + ' ' : ''}scale(.96)` }], { duration: 200, easing: tok().standard, fill: 'forwards' });
    const gone = () => { const k = kit(); if (k) k.leaving.delete(el); drop(el); };
    if (!list.some(Boolean)) { gone(); return Promise.resolve(); }
    return track(all(list).then(gone));
  }

  function session() {
    const groups = new Map();
    const pins = [];
    const added = [];
    const s = {
      // Measure parent's children (or only those in `only`) as they are now.
      add(parent, box, only) {
        if (!groups.has(parent) && parent.isConnected) groups.set(parent, measure(parent, box, only));
        return groups.get(parent);
      },
      // A patch went through parent's children: `add` are new, `gone` were removed, `moved` keyed
      // ones it moved. Removed ones in a container being followed leave from where they were; new
      // blocks in a list or a section rise in.
      patched(parent, add, gone, moved) {
        const g = groups.get(parent);
        if (g && add.length + gone.length + moved > FLIP_MAX) g.off = true;
        const follow = g && !g.off;
        for (const n of gone) {
          if (follow && n.nodeType === 1 && pin(n, g.kids.get(n))) pins.push(n);
          else drop(n);
        }
        if (follow || (parent.nodeType === 1 && parent.matches(CONTAINER))) for (const n of add) if (n.nodeType === 1) added.push(n);
      },
      // Last, Invert, Play: every read first (one layout), then every animation.
      play() {
        const moves = [];
        for (const g of groups.values()) {
          if (g.off || !g.parent.isConnected) continue;
          const box = g.parent.getBoundingClientRect();
          for (const [el, f] of g.kids) {
            if (!el.isConnected || isLeaving(el)) continue;
            const r = el.getBoundingClientRect();
            // Moved within its container, or (flip() on a node that changed parents) on the page.
            const same = el.parentNode === g.parent;
            const dx = same ? (f.r.left - g.box.left) - (r.left - box.left) : f.r.left - r.left;
            const dy = same ? (f.r.top - g.box.top) - (r.top - box.top) : f.r.top - r.top;
            if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push([el, dx, dy, glides.has(el) ? offsetNow(el) : null]);
          }
        }
        const outs = pins.map((n) => [n, glides.has(n) ? offsetNow(n).t : null]);
        const done = [];
        // Short moves on the snappy spring; a long one (the page's end coming up after a card folds
        // at the bottom) on the smooth one, which takes its time.
        const t = tok();
        const far = moves.some(([, dx, dy]) => Math.abs(dx) > 120 || Math.abs(dy) > 120);
        const time = far ? { duration: t.smoothMs, easing: t.smooth } : { duration: t.snappyMs, easing: t.snappy };
        for (const [el, dx, dy, now] of moves) done.push(glide(el, dx + (now ? now.x : 0), dy + (now ? now.y : 0), time));
        for (const [n, at] of outs) { glides.delete(n); done.push(vanish(n, at)); }
        for (const n of added) done.push(rise(n, moves.length ? 70 : 0));
        return Promise.all(done).then(() => {});
      },
    };
    return s;
  }

  // Core, before an animated re-render: the page and every section, list and [data-flip] block in
  // sight (or nearly). Their children glide whether the patch adds or drops some or only changes how
  // tall one of them is.
  M.snap = (root) => {
    if (reduced() || !can(root) || !root.firstElementChild) return null;
    const s = session();
    const box = root.getBoundingClientRect();
    s.add(root, box);
    const h = G.innerHeight || box.height;
    for (const c of root.querySelectorAll(CONTAINER)) {
      const r = c.getBoundingClientRect();
      if (r.bottom < -h * 0.25 || r.top > h * 1.25 || (!r.width && !r.height) || c.closest('.motion-leaving')) continue;
      s.add(c, r);
    }
    return s;
  };

  // el's container and each one above it, up to the page or the sheet it's in: everything after it,
  // at every level, glides when it goes or comes.
  function around(parent) {
    const s = session();
    for (let p = parent; p && p !== doc.body && p.nodeType === 1; p = p.parentElement) {
      s.add(p);
      if (p.classList.contains('screen') || p.classList.contains('rf-sheet-body') || p.id === 'app') break;
    }
    return s;
  }

  M.flip = (els, mutate) => {
    const list = !els ? [] : els.nodeType === 1 ? Array.from(els.children) : Array.from(els).filter((e) => e && e.nodeType === 1);
    if (reduced() || !list.length || !can(list[0])) { if (mutate) mutate(); return Promise.resolve(); }
    const s = session();
    const by = new Map();
    for (const e of list) if (e.parentElement) { if (!by.has(e.parentElement)) by.set(e.parentElement, new Set()); by.get(e.parentElement).add(e); }
    for (const [p, only] of by) s.add(p, null, only);
    if (mutate) mutate();
    return s.play();
  };

  M.exit = (el) => {
    const parent = el && el.parentElement;
    if (!parent) return Promise.resolve();
    if (reduced() || !can(el)) { drop(el); return Promise.resolve(); }
    const s = around(parent);
    const g = s.add(parent);
    if (!pin(el, g && g.kids.get(el))) { drop(el); return s.play(); }
    return Promise.all([s.play(), vanish(el, glides.has(el) ? offsetNow(el).t : null)]).then(() => {});
  };

  M.collapse = (el, change) => {
    const parent = el && el.parentElement;
    const swap = () => { if (change) change(); else if (el && el.parentNode) drop(el); };
    if (!parent || !can(el)) { swap(); return Promise.resolve(); }
    if (reduced()) {
      // Reduced motion: a short fade, then it changes or goes.
      const a = show(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' });
      return track(all(a).then(() => { swap(); for (const x of a) if (x) x.cancel(); }));
    }
    const t = tok();
    const a = show(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 180, easing: t.standard, fill: 'forwards' });
    return track(all(a).then(() => {
      if (change) {
        // A re-render folds it into something smaller (it keeps its node, and the re-render glides
        // what's after it): that fades in where it was.
        change();
        if (el.isConnected) show(el, [{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: t.enter });
        for (const x of a) if (x) x.cancel();
        return;
      }
      if (!el.parentNode) return;
      // Measured with it still there (faded out), so what's after it glides up into its room.
      const s = around(el.parentElement);
      drop(el);
      s.play();
    }));
  };

  M.expand = (el, parent, before) => {
    if (!el || !parent) return Promise.resolve();
    const put = () => parent.insertBefore(el, before && before.parentNode === parent ? before : null);
    if (!can(parent) || reduced()) {
      put();
      if (reduced() && can(el)) return all(show(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }));
      return Promise.resolve();
    }
    const s = around(parent);
    put();
    s.play();
    return all(show(el, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 90, easing: tok().enter, fill: 'backwards' }));
  };
})(typeof window !== 'undefined' ? window : globalThis);
