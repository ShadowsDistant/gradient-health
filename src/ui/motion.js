/* Motion: route changes, lists that glide, and cards that fold away or open up (U.motion).
 *
 * Everything here moves with transform and opacity only, so the compositor plays it and nothing is
 * laid out again while it moves. With reduced motion a route change is a short fade, and lists and
 * cards change at once (a card folding away fades first).
 *
 * U.motion.routeSwap(screen, frag, kind)  The route changed. The old page moves into a layer of its
 *   own beside the screen (.screen-exit: nothing in it takes a tap or is read out, and its ids are
 *   renamed) and leaves from where it was scrolled to, while frag, already in the screen when this
 *   returns, comes in. 'push' and 'pop' slide; a tab change ('left', 'right') cross-fades with a
 *   small shift toward the tab picked; any other kind just swaps.
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
 * were; play() then glides whatever moved, every glide starting in the same frame. barSwap(bar)
 * cross-fades the navigation bar's title and buttons across a route change.
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
  // How each kind moves. Both pages move over the same time on the standard curve (quick, then a
  // long settle), while each fade has a timeline of its own: the old page is gone well before the
  // end, and the new one starts to show a little after the start, so the two are rarely both half
  // there. A push sends the old page a third of the way off to the left as the new one comes in from
  // 36 px to the right; Back plays that in reverse. A tab cross-fades, both pages shifted 12 px
  // toward the tab picked.
  function routeSpec(kind) {
    if (kind === 'push') return { ms: 300, out: ['translateX(0)', 'translateX(-30%)'], in: ['translateX(36px)', 'translateX(0)'], gone: 0.42, show: 0.1 };
    if (kind === 'pop') return { ms: 300, out: ['translateX(0)', 'translateX(36px)'], in: ['translateX(-30%)', 'translateX(0)'], gone: 0.42, show: 0.1 };
    const dx = kind === 'right' ? 12 : kind === 'left' ? -12 : 0;
    return { ms: 240, out: ['translateX(0)', `translateX(${-dx}px)`], in: [`translateX(${dx}px)`, 'translateX(0)'], gone: 0.5, show: 0.16 };
  }
  const SLIDES = { push: 1, pop: 1, left: 1, right: 1, tab: 1 };
  const swaps = new Set(); // old pages still leaving: { layer, anims, done }
  let entering = []; // the screen's own entrance, while it plays

  // One moving part: a move on the standard curve over the whole time, and a fade through the given
  // stops (keyframe offsets, each step easing out).
  function slide(el, move, fade, ms, fill) {
    const t = tok();
    return [
      run(el, move.map((v) => ({ transform: v })), { duration: ms, easing: t.standard, fill }),
      run(el, fade.map(([o, at]) => (at == null ? { opacity: o, easing: t.standard } : { opacity: o, offset: at, easing: t.standard })), { duration: ms, easing: 'linear', fill }),
    ];
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

  M.routeSwap = (screen, frag, kind) => {
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
    // The old page, in a layer with the screen's look (its class and attributes), moved up by as far
    // as it was scrolled, so it starts exactly where it was. Its nodes are set aside (Refract keeps
    // what it set up on them, for the cleanup when they go).
    const layer = doc.createElement('div');
    layer.className = 'screen screen-exit';
    for (const a of ['data-view', 'data-pushed', 'data-float', 'data-capsule']) if (screen.hasAttribute(a)) layer.setAttribute(a, screen.getAttribute(a));
    layer.setAttribute('data-kind', kind);
    if (screen.scrollTop) layer.style.translate = `0 ${-screen.scrollTop}px`;
    aside(() => {
      while (screen.firstChild) layer.appendChild(screen.firstChild);
      screen.after(layer);
    });
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
    };
    swaps.add(x);
    const out = from ? [from.transform, f.out[1]] : f.out;
    x.anims = slide(layer, out, [[from ? from.opacity : 1], [0, f.gone], [0]], f.ms, 'forwards');
    entering = slide(screen, f.in, [[0], [0, f.show], [1]], f.ms);
    track(Promise.all(x.anims.map(ended)).then(() => x.done()));
    entering.forEach(track);
    // A page in the background draws no frames: the old one goes anyway.
    setTimeout(() => x.done(), f.ms + 400);
  };

  // The navigation bar across a route change. Before: what each part (title, leading and trailing
  // buttons) shows and where. After: a part that changed leaves as a copy fading out where it was,
  // and the new one fades in, a little from the side the page is coming from. A title with nothing
  // to show (the new page is at its top) goes at once, so its new words never fade out.
  const BAR = [['.rf-navbar-leading', false], ['.rf-navbar-title', true], ['.rf-navbar-trailing', false]];
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
    return (kind) => {
      const t = tok();
      // The way the old page moves (left on a push or a tab to the right).
      const dir = kind === 'push' || kind === 'right' ? -1 : kind === 'pop' || kind === 'left' ? 1 : 0;
      for (const p of parts) {
        if (!p.el.isConnected || showing(p.el, p.title) === p.was) continue;
        if (p.copy) {
          const c = p.copy;
          c.classList.add('motion-copy');
          Object.assign(c.style, { position: 'absolute', margin: '0', left: `${p.r.left - box.left}px`, top: `${p.r.top - box.top}px`, width: `${p.r.width}px`, height: `${p.r.height}px`, opacity: '1', translate: 'none', transition: 'none' });
          shield(c);
          aside(() => bar.appendChild(c));
          const a = run(c, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 10}px)${p.title ? '' : ' scale(.86)'}` }], { duration: 180, easing: t.standard, fill: 'forwards' });
          track(ended(a).then(() => c.remove()));
          if (!a) c.remove();
        }
        if (isShown(bar, p.el, p.title)) {
          // The title's own fade (data-scrolled) already brings it in when it wasn't showing.
          if (p.title && !p.copy) continue;
          track(run(p.el, [{ opacity: 0, transform: `translateX(${-dir * 10}px)${p.title ? '' : ' scale(.86)'}` }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 60, easing: t.enter, fill: 'backwards' }));
        } else if (p.title) {
          for (const a of p.el.getAnimations()) if (a.transitionProperty) a.finish();
        }
      }
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
  // under it), then it fades and shrinks there and is dropped. False when it can't be (core drops it).
  function pin(el, f) {
    const k = kit();
    if (!k || !el.style || !f || !f.w || !f.h || !f.op || f.op === doc.body) return false;
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
  // A block new to a list or a page rises into place, a beat after its neighbours start to make room.
  function rise(el, delay) {
    if (el.nodeType !== 1 || !el.animate) return null;
    return track(run(el, [{ opacity: 0, transform: 'translateY(8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: delay || 0, easing: tok().enter, fill: 'backwards' }));
  }
  // A pinned block fades and shrinks where it's drawn, then goes.
  function vanish(el, at) {
    const a = run(el, [{ opacity: 1, transform: at || 'none' }, { opacity: 0, transform: `${at && at !== 'none' ? at + ' ' : ''}scale(.96)` }], { duration: 200, easing: tok().standard, fill: 'forwards' });
    const gone = () => { const k = kit(); if (k) k.leaving.delete(el); drop(el); };
    if (!a) { gone(); return Promise.resolve(); }
    return track(ended(a).then(gone));
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
        const all = [];
        // Short moves on the snappy spring; a long one (the page's end coming up after a card folds
        // at the bottom) on the smooth one, which takes its time.
        const t = tok();
        const far = moves.some(([, dx, dy]) => Math.abs(dx) > 120 || Math.abs(dy) > 120);
        const time = far ? { duration: t.smoothMs, easing: t.smooth } : { duration: t.snappyMs, easing: t.snappy };
        for (const [el, dx, dy, now] of moves) all.push(glide(el, dx + (now ? now.x : 0), dy + (now ? now.y : 0), time));
        for (const [n, at] of outs) { glides.delete(n); all.push(vanish(n, at)); }
        for (const n of added) all.push(rise(n, moves.length ? 70 : 0));
        return Promise.all(all).then(() => {});
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
      const a = run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' });
      return track(ended(a).then(() => { swap(); if (a) a.cancel(); }));
    }
    const t = tok();
    const a = run(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 180, easing: t.standard, fill: 'forwards' });
    return track(ended(a).then(() => {
      if (change) {
        // A re-render folds it into something smaller (it keeps its node, and the re-render glides
        // what's after it): that fades in where it was.
        change();
        if (el.isConnected) run(el, [{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: t.enter });
        if (a) a.cancel();
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
      if (reduced() && can(el)) return track(run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' }));
      return Promise.resolve();
    }
    const s = around(parent);
    put();
    s.play();
    return track(run(el, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 90, easing: tok().enter, fill: 'backwards' }));
  };
})(typeof window !== 'undefined' ? window : globalThis);
