/* Moments: what moves at particular moments, on top of U.motion (src/ui/motion.js). A part of its own
 * (the `moments` chunk, loaded in an idle moment after launch), so launch pays nothing for it and
 * nothing here plays at launch; until it's in, each of these moments happens as it did before.
 * Everything moves by transform and opacity, on Refract's springs and curves, starts from where
 * things are, and takes no taps away: a new tap draws the next thing over it. With reduced motion a
 * moment is a short fade or just happens.
 *
 * U.motion.travel(src, to, o)  A picture travels: a copy of src (inert, hidden from assistive tech)
 *   moves from where src is into to's box, keeping its shape, and fades out over what's drawn there.
 *   o: { from (src's box, read earlier), layer (where the copy goes), ms, easing }.
 * U.motion.fill(root, where)  The rings and bars in root glide to their value (Refract's own fill):
 *   from nothing the first time `where` shows them, from what they last showed there after that,
 *   and not at all when that's what they show now.
 * U.motion.arrived(screen)  A route change put a new page in (motion.js calls it): its rings and bars
 *   fill.
 * U.motion.enterPlayer(el)  The workout player opening: its backdrop turns solid, its content rises
 *   out of where the tap was, and its main button grows out of the button that was tapped (Start
 *   workout, Resume), so one becomes the other. True when it played.
 * U.motion.scene(el)  The player between two scenes. Called before the patch (it reads where the
 *   figure is); the function it returns plays once the new scene is in: the figure travels between
 *   its card and Up next's picture when the move is the same one (a set done, the next set coming
 *   forward), the set's dot lands, a rest's ring fills and what was logged settles in, and the finish
 *   lands a part at a time. Null when nothing can play (the caller's own entrance does).
 * U.motion.count(el, text, dir)  A number rolls to its new value (Refract.roll), up or down.
 * U.motion.beat(el, big)  A beat on a number (the 3-2-1) or, big, on the ring as a rest ends.
 * U.motion.land(list, o)  Parts land one after another: each rises (or, o.pop, pops) into place.
 *
 * A sheet that opens from a row with a move's picture carries that picture into its figure's box
 * (Plan's rows, the player's figure and Up next), and its rings and bars fill.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const M = U.motion = U.motion || {};
  const doc = G.document;
  if (!doc || !M.tok) return;
  const R = () => G.Refract || null;
  const reduced = () => !!(U.reduced && U.reduced());
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const can = (el) => !!(el && el.isConnected && el.animate && !doc.hidden);
  const aside = (fn) => (U.morphKit ? U.morphKit.aside(fn) : fn());
  // After this frame's writes, in the frame's one read pass (src/ui/core.js).
  const read = (fn) => { if (U.readSoon) U.readSoon(fn); else fn(); };
  const bouncy = () => { const r = R(); return r && r.easing ? r.easing('spring-bouncy', M.tok().enter) : M.tok().enter; };

  /* ---------------------------------------------------------------- the last tap */
  // What was tapped last, and where it was (read as the click arrives, before anything it does has
  // changed the page): the source a moment grows out of.
  const PICTURE = '.pw-thumb, .cp-thumb, .pl-fig'; // a move's picture in what was tapped
  let tapped = null;
  doc.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-act], button, a') : null;
    if (!t) { tapped = null; return; }
    const p = t.matches(PICTURE) ? t : t.querySelector(PICTURE);
    tapped = { el: t, at: now(), box: t.getBoundingClientRect(), pic: p, picBox: p ? p.getBoundingClientRect() : null };
  }, true);
  const tap = (ms) => (tapped && now() - tapped.at < ms ? tapped : null);

  /* ---------------------------------------------------------------- a picture that travels */
  M.travel = (src, to, o) => {
    const opt = o || {};
    if (reduced() || !can(src) || !to) return false;
    const a = opt.from || src.getBoundingClientRect();
    const b = to.getBoundingClientRect ? to.getBoundingClientRect() : to;
    const h = U.viewH ? U.viewH() : G.innerHeight;
    if (!(a.width > 8 && a.height > 8 && b.width > 8 && b.height > 8) || a.bottom < 0 || a.top > h) return false;
    const c = src.cloneNode(true);
    c.classList.add('motion-copy');
    if (M.shield) M.shield(c);
    Object.assign(c.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0', zIndex: '6' });
    aside(() => (opt.layer || doc.body).appendChild(c));
    // Its shape kept: as large as fits to's box, in the middle of it.
    const s = Math.min(b.width / a.width, b.height / a.height);
    const x = b.left + b.width / 2 - (a.left + a.width / 2), y = b.top + b.height / 2 - (a.top + a.height / 2);
    const ms = opt.ms || 300;
    c.animate([{ transform: 'none' }, { transform: `translate(${x}px, ${y}px) scale(${s})` }], { duration: ms, easing: opt.easing || M.tok().snappy, fill: 'forwards' });
    const fade = c.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
    const gone = () => c.remove();
    M.track(fade.finished.then(gone, gone));
    return true;
  };

  /* ---------------------------------------------------------------- rings and bars that fill */
  // Refract's rings and bars glide whenever their value changes; one that's new on the page has no
  // value to glide from. So it starts from what it last showed there (nothing, the first time) and is
  // given its value once the page that brought it has come in. Only writes: nothing is measured.
  const shown = new Map(); // where|label|nth → the value it last showed
  const FILL_AFTER = 140, FILL_MOST = 8;
  // el's fill held at `from` without gliding there (it may already have been drawn at its value);
  // the function returned lets it go, on to `to` if given.
  function hold(el, from) {
    const part = el.querySelector('.rf-ring-fill, .rf-progress-fill');
    if (part) part.style.transition = 'none';
    el.style.setProperty('--rf-value', from);
    return (to) => { if (part) part.style.removeProperty('transition'); if (to != null) el.style.setProperty('--rf-value', to); };
  }
  M.fill = (root, where) => {
    if (reduced() || !root || !root.querySelectorAll) return;
    const list = [], nth = {};
    for (const el of root.querySelectorAll('.rf-ring, .rf-progress[aria-valuenow]')) {
      const v = el.style.getPropertyValue('--rf-value').trim();
      if (!v || el.hasAttribute('data-gh-fill')) continue;
      const label = el.getAttribute('aria-label') || '';
      const k = `${where}|${label}|${nth[label] = (nth[label] || 0) + 1}`;
      const was = shown.has(k) ? shown.get(k) : '0';
      shown.set(k, v);
      if (was === v || list.length >= FILL_MOST) continue;
      list.push([el, v, was, hold(el, was)]);
    }
    if (!list.length) return;
    // (One a re-render gave another value meanwhile keeps it.)
    setTimeout(() => G.requestAnimationFrame(() => {
      for (const [el, v, was, go] of list) go(el.isConnected && el.style.getPropertyValue('--rf-value').trim() === was ? v : null);
    }), FILL_AFTER);
  };
  const routeKey = () => { const r = U.route || {}; return r.view ? `${r.view}:${r.arg || ''}` : r.tab; };
  M.arrived = (screen) => M.fill(screen, routeKey());

  /* ---------------------------------------------------------------- parts that land */
  // o: { at (ms before the first), each (ms apart), pop (they pop on the bouncy spring), ms }.
  M.land = (list, o) => {
    const opt = o || {};
    if (reduced()) return;
    const t = M.tok();
    const from = opt.pop ? { opacity: 0, transform: 'translateY(14px) scale(.9)' } : { opacity: 0, transform: `translateY(${opt.y == null ? 12 : opt.y}px)` };
    Array.from(list).forEach((n, i) => {
      if (n && n.nodeType === 1 && n.animate) M.show(n, [from, { opacity: 1, transform: 'none' }], { duration: opt.ms || (opt.pop ? 420 : 280), delay: (opt.at || 0) + i * (opt.each == null ? 30 : opt.each), easing: opt.pop ? bouncy() : t.enter, fill: 'backwards' });
    });
  };

  /* ---------------------------------------------------------------- the workout player */
  // Opening: the backdrop turns solid fast and the content rises (as before), from the side the tap
  // was on; the main button grows out of the button that was tapped, both being the same tinted
  // glass, so Start workout seems to become the player's own button. All in by 400 ms.
  M.enterPlayer = (el) => {
    if (reduced() || !can(el)) return false;
    const t = M.tok(), src = tap(900);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    const acts = el.querySelector(':scope > .pl-actions');
    const btn = acts && acts.querySelector(':scope > .rf-btn[data-variant="tinted"]');
    const from = btn && src && src.el.matches('.rf-btn[data-variant="tinted"], .rf-btn[data-variant="filled"], [data-act="resumeWorkout"]') && src.box.width > 8 ? src.box : null;
    Array.from(el.children).forEach((c, i) => {
      if (c === acts && from) return;
      c.animate([{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: 30 + i * 30, easing: t.enter, fill: 'backwards' });
    });
    if (!from) return true;
    for (const c of acts.children) if (c !== btn) M.show(c, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120, easing: 'linear', fill: 'backwards' });
    // Placed in the frame's read pass (the frame that first shows it), where its box is known.
    read(() => {
      if (!can(btn)) return;
      const b = btn.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const s = Math.min(1, from.height / b.height);
      const x = from.left + from.width / 2 - (b.left + b.width / 2), y = from.top + from.height / 2 - (b.top + b.height / 2);
      M.show(btn, [{ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: t.snappy });
    });
    return true;
  };

  // Between two scenes. The figure's box: its card on a step, Up next's picture on a rest.
  const FIG = '.pl-fig-card, .pl-next-row .pl-fig-sm';
  const nameOf = (el) => { const n = el.querySelector('.pl-name, .pl-next .t-headline'); return n ? n.textContent : ''; };
  let sets = null; // the last step seen: { name, done } (its dots), for the dot that lands
  M.scene = (el) => {
    if (reduced() || !can(el)) return null;
    const f0 = el.querySelector(FIG);
    const was = { name: nameOf(el), box: f0 ? f0.getBoundingClientRect() : null, card: !!(f0 && f0.matches('.pl-fig-card')) };
    const dots0 = el.querySelectorAll('.pl-dots i').length;
    if (dots0) sets = { name: was.name, done: el.querySelectorAll('.pl-dots .done').length };
    return (phase) => {
      const t = M.tok();
      const main = el.querySelector('.pl-main, .pl-scroll'), acts = el.querySelector('.pl-actions');
      if (!main) return;
      if (acts) acts.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 60, easing: 'ease-out', fill: 'backwards' });
      // The finish: the title and the streak, then each thing the workout brought, one after
      // another, then what's next. (player.js rolls the streak and sets off the burst.)
      if (phase === 'next') {
        const kids = Array.from(main.children), cards = kids.filter((n) => n.matches('.celebrate, .bdg-card'));
        const cut = cards.length ? kids.indexOf(cards[0]) : Math.min(2, kids.length);
        const head = kids.slice(0, cut), rest = kids.slice(cut).filter((n) => !cards.includes(n));
        M.land(head, { each: 50 });
        M.land(cards.slice(0, 4), { pop: true, at: 150, each: 110 });
        M.land(cards.slice(4).concat(rest), { at: 150 + Math.min(4, cards.length) * 110 + (cards.length ? 80 : 0), each: 40 });
        return;
      }
      const f1 = el.querySelector(FIG);
      const same = !!was.box && !!f1 && was.name && nameOf(el) === was.name && was.card !== f1.matches('.pl-fig-card');
      if (!same) {
        // Another move, or no figure to carry: the scene rises in.
        main.animate([{ opacity: 0, transform: `translateY(${phase === 'rest' ? 18 : 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: t.enter });
      } else {
        // The same move: its figure travels between the card and Up next's picture, and the rest of
        // the scene comes in around it. (What holds the picture only fades, so it's where it will be.)
        const holder = f1.parentNode === main ? f1 : f1.closest('.pl-next-row');
        const others = Array.from(main.children).filter((n) => n !== holder);
        M.land(others, { y: 14, each: 22 });
        if (holder && holder !== f1) M.show(holder, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'linear' });
        read(() => {
          if (!can(f1)) return;
          const b = f1.getBoundingClientRect(), a = was.box;
          if (!b.height || !a.height) return;
          const s = a.height / b.height;
          const x = a.left + a.width / 2 - (b.left + b.width / 2), y = a.top + a.height / 2 - (b.top + b.height / 2);
          // (The scene scrolls when it's too long for the screen, so it clips what's in it: while the
          // figure comes up from where Up next was, below the scene's own end, it doesn't.)
          const clip = y > 0 && f1.parentNode === main;
          if (clip) main.style.overflow = 'visible';
          const back = () => { if (clip) main.style.removeProperty('overflow'); };
          const list = M.show(f1, [{ transform: `translate(${x}px, ${y}px) scale(${s})` }, { transform: 'none' }], { duration: 380, easing: t.snappy });
          if (list[0] && list[0].finished) list[0].finished.then(back, back); else back();
        });
      }
      if (phase === 'rest') {
        // The rest begins: its ring fills (player.js leaves it be meanwhile, data-gh-fill), and what
        // was logged settles in a beat later.
        const ring = main.querySelector('.pl-timer:not(.is-over) .rf-ring');
        if (ring) {
          ring.setAttribute('data-gh-fill', '');
          const go = hold(ring, '0');
          G.requestAnimationFrame(() => G.requestAnimationFrame(() => { ring.removeAttribute('data-gh-fill'); go(String((Number(ring.getAttribute('aria-valuenow')) || 0) / 100)); }));
        }
        const logged = main.querySelector('.pl-logged');
        if (logged) M.show(logged, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 120, easing: bouncy(), fill: 'backwards' });
      } else if (phase === 'step') {
        // A set of the same move done since its dots were last seen: the new dot lands, and the one
        // for this set comes forward.
        const name = nameOf(el), done = main.querySelectorAll('.pl-dots .done');
        if (sets && sets.name === name && done.length > sets.done) {
          const dot = done[done.length - 1], next = main.querySelector('.pl-dots .now');
          dot.animate([{ transform: 'scale(2.2)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 160, easing: bouncy(), fill: 'backwards' });
          if (next) next.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, delay: 260, easing: t.enter, fill: 'backwards' });
        }
        if (main.querySelector('.pl-dots i')) sets = { name, done: done.length };
        const big = main.querySelector('.pl-target');
        if (big && same) M.show(big, [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 60, easing: bouncy(), fill: 'backwards' });
      }
    };
  };

  // A hold's timer starting where its seconds were: the ring pops in around the count.
  M.timerIn = (el) => {
    const ring = el && el.querySelector('.pl-timer');
    if (reduced() || !can(ring)) return;
    ring.animate([{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: bouncy() });
    const meta = el.querySelector('.pl-meta');
    if (meta) meta.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 80, easing: 'linear', fill: 'backwards' });
  };

  M.count = (el, text, dir) => {
    const r = R();
    if (!reduced() && r && r.roll && can(el)) { try { r.roll(el, text, { dir: dir < 0 ? -1 : 1 }); return; } catch (e) { /* plain text below */ } }
    el.textContent = text;
  };
  M.beat = (el, big) => {
    if (reduced() || !can(el)) return;
    el.animate([{ transform: `scale(${big ? 1.07 : 1.18})` }, { transform: 'none' }], { duration: big ? 460 : 240, easing: big ? bouncy() : M.tok().standard });
  };

  /* ---------------------------------------------------------------- sheets */
  // A sheet's first move is its opening (sheet.js says so before its panel starts to slide, when the
  // panel is laid out where it will rest): the picture of the move that was tapped travels into the
  // sheet's figure box, and the sheet's rings and bars fill. A picture is an <img> or the flat
  // figure's drawing; a live 3D figure has no picture to copy, and its sheet just opens.
  const seen = new WeakSet();
  doc.addEventListener('gh-sheet-moving', (e) => {
    const ctl = e.detail && e.detail.moving && U.topSheet ? U.topSheet() : null;
    if (!ctl || seen.has(ctl.el)) return;
    seen.add(ctl.el);
    const title = ctl.el.querySelector('.rf-sheet-title');
    M.fill(ctl.body, `sheet:${title ? title.textContent : ''}`);
    const to = ctl.el.querySelector('.sheet-fig'), src = tap(700);
    if (!to || !src || reduced()) return;
    const pic = src.pic && src.pic.isConnected && !src.pic.querySelector('canvas') ? src.pic.querySelector('img, svg') : null;
    if (!pic) return;
    // Where the figure's box will rest (the panel has no motion on it yet), then, once the panel's
    // slide exists, the copy moves on the same curve over the same time: it rides up with the sheet.
    // What the sheet draws in the box stays out of sight until the copy is nearly there, then takes
    // over from it.
    const box = to.getBoundingClientRect();
    Promise.resolve().then(() => {
      const panel = ctl.el.querySelector('.gh-sheet-panel');
      const slide = panel && panel.getAnimations().find((a) => a.effect && a.effect.getKeyframes().some((k) => 'transform' in k));
      const time = slide ? slide.effect.getTiming() : null;
      const ms = time && Number(time.duration) > 0 ? Number(time.duration) : 240;
      if (!M.travel(pic, box, { from: src.picBox, layer: ctl.el, ms, easing: time ? time.easing : null })) return;
      M.show(to.closest('.sheet-fig-card') || to, [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1, offset: 0.8 }, { opacity: 1 }], { duration: ms, easing: 'linear' });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
