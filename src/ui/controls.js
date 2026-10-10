/* Switches, segmented controls and chip choices: gestures that never miss a tap, on Refract's liquid
 * glass (knobs and thumbs that rise into a lens under the finger and land with a squash).
 *
 * Refract's own switch and segmented behaviours are replaced here (Refract 1.4's take any movement
 * past 3 px as a drag, so a tap that wobbles would be lost), and a chip-choice behaviour is added. The
 * look and the motion are still Refract's: the knob and the thumb run on its liquid engine
 * (Refract.Liquid). Its behaviour registry (Refract.behaviors) is the very object Refract.init reads,
 * and the app's scripts run after Refract's and before its first init, so the vendored bundle stays as
 * it is.
 *
 * Every control follows one set of gesture rules (GH.ui.switchGesture, kept free of the DOM so node
 * can test it):
 * - A gesture starts on pointerdown anywhere on the control (a switch's whole row).
 * - More than 10 px up or down, and more than sideways, is a scroll: the control lets go.
 * - 12 px or more sideways is a drag: the knob or thumb follows the finger, and letting go picks the
 *   nearer end or option, or the way it was flicked.
 * - Anything less is a tap. Chrome drops a tap's click once the finger has moved past its slop (about
 *   8 dp on a phone), so a tap that gets no click within 120 ms is clicked here ("tap rescue"), and a
 *   click that still turns up after that is swallowed: a tap never toggles twice.
 * - pointercancel (the page took the gesture for a scroll) puts everything back.
 * - A click is matched to its gesture by its timeStamp, which is its pointerup's. Only a tap's own
 *   click goes through, and only once; a click from a drag, a scroll or a rescued tap is swallowed.
 *   That's scoped to one gesture: the next pointerdown starts clean. Keyboard clicks (detail 0) are
 *   never stopped.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const R = () => G.Refract || null;

  /* ---------------------------------------------------------------- the gesture rules */
  const DRAG = 12; // px sideways before it's a drag
  const SCROLL = 10; // px up or down (and more than sideways) before it's a scroll
  const FLICK = 0.3; // px/ms: a release this fast lands the way it was thrown
  const RESCUE = 120; // ms a tap waits for its own click before it's clicked here
  const LIFT = 80; // ms a resting finger waits before the glass lifts (a scroll starting on a row doesn't flash it)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 'scroll', 'drag', or 'pending' (still a tap) for a finger dx, dy from where it went down.
  function classify(dx, dy) {
    if (Math.abs(dy) > SCROLL && Math.abs(dy) > Math.abs(dx)) return 'scroll';
    if (Math.abs(dx) >= DRAG) return 'drag';
    return 'pending';
  }
  // Sideways speed in px/ms over the last ~100 ms of [time, x] samples (a least-squares line, so one
  // jittery sample doesn't throw it); none if the finger had stopped before letting go.
  function velocity(samples, t1) {
    const r = samples.filter(([t]) => t1 - t <= 100);
    if (r.length < 2 || t1 - r[r.length - 1][0] > 60) return 0;
    const t0 = r[0][0];
    let n = 0, st = 0, sx = 0, stt = 0, stx = 0;
    for (const [t, x] of r) { const u = t - t0; n++; st += u; sx += x; stt += u * u; stx += u * x; }
    const den = n * stt - st * st;
    return den > 1e-6 ? (n * stx - st * sx) / den : 0;
  }
  // Where a dragged knob lands: on (true) past the middle of its travel, or flicked that way.
  const landing = (pos, len, v) => (Math.abs(v) > FLICK ? v > 0 : pos > len / 2);

  // One control's gestures. down() starts one; move() returns 'drag' or 'scroll' the moment it
  // becomes one; up() returns what the release was ('tap', 'drag' or 'none'); click() says whether a
  // click event goes through; rescue() claims a tap that never got its click.
  function tracker() {
    let g = null;
    return {
      get: () => g,
      down(p) {
        g = { id: p.id, type: p.type, x0: p.x, y0: p.y, t0: p.t, mode: 'pending', end: null, clicked: false, rescued: false, samples: [[p.t, p.x]] };
        return g;
      },
      move(p) {
        if (!g || g.end || p.id !== g.id) return null;
        g.samples.push([p.t, p.x]);
        if (g.samples.length > 24) g.samples.shift();
        if (g.mode !== 'pending') return null;
        const m = classify(p.x - g.x0, p.y - g.y0);
        if (m === 'pending') return null;
        g.mode = m;
        return m;
      },
      up(p) {
        if (!g || g.end || p.id !== g.id) return null;
        g.samples.push([p.t, p.x]);
        g.end = g.mode === 'pending' ? 'tap' : g.mode === 'drag' ? 'drag' : 'none';
        return g.end;
      },
      // A pointercancel, or the drag's pointer capture lost: the gesture comes to nothing.
      cancel(id) {
        if (!g || g.end || (id != null && id !== g.id)) return false;
        g.end = 'none';
        return true;
      },
      click(c) {
        if (!c.detail) return 'allow'; // the keyboard, a script, or a label passing its click on
        if (!g) return 'allow';
        if (c.t < g.t0) return 'swallow'; // a late click from an earlier gesture, which had its turn
        if (g.end === 'tap' && !g.clicked && !g.rescued) { g.clicked = true; return 'allow'; }
        return 'swallow';
      },
      rescue() {
        if (!g || g.end !== 'tap' || g.clicked || g.rescued) return false;
        g.rescued = true;
        return true;
      },
      speed: (t1) => (g ? velocity(g.samples, t1) : 0),
    };
  }
  U.switchGesture = { DRAG, SCROLL, FLICK, RESCUE, LIFT, classify, velocity, landing, tracker };

  if (!doc) return;

  /* ---------------------------------------------------------------- shared parts */
  const haptic = (kind) => { if (U.haptic) U.haptic(kind); };
  const reduced = () => !!(U.reduced ? U.reduced() : R() && R().prefs && R().prefs.reducedMotion);
  const dur = (name, fallback) => { const r = R(); return r && r.duration ? r.duration(name, fallback) : fallback; };

  // Refract's liquid engine (Refract.Liquid): a knob or a selection made of glass, frosted at rest,
  // that rises and clears into a lens under the finger, follows it on springs that keep their speed
  // when interrupted, and lands with a squash. One transform a frame, plus --rf-lift and data-lifted;
  // Refract's style sheet draws the rest. Null without Refract (the controls then stay where the
  // style sheet puts them).
  const liquid = (els, o) => { const r = R(); return r && r.Liquid ? new r.Liquid(els, o) : null; };
  // Past either end, a dragged knob or thumb gives a little, like a rubber band.
  const rubber = (over, dim) => { const r = R(); return over && r && r.rubber ? r.rubber(over, dim) : 0; };

  // A control's settling: busy() while it's held or moving, then the promise U.controlSettled hands
  // out resolves.
  const settling = new WeakMap();
  const moving = new Set(); // the controls held or moving now (U.calm waits for them)
  function busy(host) {
    if (settling.has(host)) return;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    settling.set(host, { promise, resolve });
    moving.add(host);
  }
  function settled(host) {
    moving.delete(host);
    const s = settling.get(host);
    if (s) { settling.delete(host); s.resolve(); }
  }
  // Whether any control is held or still on its way (one taken off the page no longer counts).
  U.controlsMoving = () => {
    for (const h of moving) if (!h.isConnected) settled(h);
    return moving.size > 0;
  };

  // Click arbitration, in the capture phase on the control: a click the gesture rules don't allow is
  // stopped before it can toggle or select anything.
  function arbiter(T, onAllow) {
    return (e) => {
      if (T.click({ t: e.timeStamp, detail: e.detail }) === 'swallow') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.detail) onAllow();
    };
  }

  /* ---------------------------------------------------------------- switch */
  // Refract's own switch knob: it rises to 1.42 x 1.46 its size, and its lens pulls what's under it
  // back (zoom 0.8) with a refracting rim.
  const KNOB = { lift: [1.42, 1.46], stretch: 0.3, lens: { zoom: 0.8, refract: 6, bezel: 8 } };
  const travels = new WeakMap(); // a switch's track → its travel (U.revertSwitch moves it in glass)
  const changedTo = new WeakMap(); // a switch's input → what its last change set it to
  // The knob's lens maps (drawn pixel by pixel, then encoded) are made once, while nothing's
  // happening after the first switch shows, instead of at the first touch of one (20 ms at 4x CPU,
  // in the frame the knob starts to rise). Refract keeps them for every knob of that size after.
  let knobWarm = false;
  function warmKnob(thumb) {
    if (knobWarm) return;
    knobWarm = true;
    setTimeout(() => (U.whenCalm || ((f) => f()))(() => {
      const r = R(), w = thumb.offsetWidth, h = thumb.offsetHeight;
      if (!r || !r.liquidLens || !thumb.isConnected || w < 4 || h < 4) { knobWarm = false; return; }
      const o = KNOB.lens;
      const l = r.liquidLens(w, h, { radius: Math.min(w, h) / 2, bezel: o.bezel, refract: o.refract, rim: 1, zoom: o.zoom, rest: 1, dispersion: 0.03, profile: 'circle' });
      if (l) l.remove();
    }), 1500);
  }
  function ghSwitch(root) {
    const track = root.querySelector('.rf-switch-track');
    const input = root.querySelector('input[type="checkbox"]');
    const thumb = root.querySelector('.rf-switch-thumb');
    if (!track || !input || !thumb) return undefined;
    if (!input.hasAttribute('role')) input.setAttribute('role', 'switch');
    warmKnob(thumb);
    const T = tracker();
    let L = null, held = false, liftTimer = 0, rescueTimer = 0, flick = 0;
    let base = 0, len = 0, side = false;

    // The knob is the engine's only while it's held or moving. At rest Refract's style sheet puts it
    // at either end from whether the switch is on (and the on colour with it), so a re-render that
    // turns a switch on or off needs nothing from here, and a resting knob costs nothing. It's taken
    // on at the end it shows (`onEnd`) when it lifts (a finger held on it, a drag) or travels (a
    // change), and handed back once it has landed there. Not at the touch: most touches on a switch's
    // row in Settings are the start of a scroll, and an engine taken on then was never handed back
    // (the knob had neither lifted nor moved, so it never landed), leaving a liquid engine, its lens
    // filter and the switch marked as moving behind each one, which kept the page from ever being
    // calm (U.calm) while Settings was open.
    const measure = () => { len = Math.max(0, track.clientWidth - thumb.offsetWidth - 6); };
    const engage = (onEnd) => {
      if (L) return L;
      measure();
      L = liquid(thumb, KNOB);
      if (!L) return null;
      let p0 = -1;
      // The on colour floods in behind the knob as it goes (Refract's --rf-p, 0 to 1 along the track).
      L.onRender = (l) => {
        const p = len ? Math.round(clamp(l.x.value / len, 0, 1) * 1000) / 1000 : 0;
        if (p !== p0) { p0 = p; track.style.setProperty('--rf-p', String(p)); }
      };
      L.onRest = () => { if (!held) release(); };
      L.place(onEnd ? len : 0);
      busy(track);
      return L;
    };
    const release = () => {
      track.removeAttribute('data-traveling');
      if (L) {
        L.destroy();
        L = null;
        for (const k of ['transform', '--rf-lift', '--_lens']) thumb.style.removeProperty(k);
        thumb.removeAttribute('data-lifted');
        track.style.removeProperty('--rf-p');
      }
      settled(track);
    };
    // Held: the knob rises into a clear lens.
    const lift = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      if (held) return;
      held = true;
      const l = engage(input.checked);
      if (l) l.grab();
      track.setAttribute('data-pressed', '');
      haptic('press');
    };
    // Let go with nothing changed (a scroll, a click that didn't toggle): back to a solid face.
    const drop = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      track.removeAttribute('data-pressed');
      if (!held) { if (!L) settled(track); return; }
      held = false;
      if (L) L.drop(); else settled(track);
    };
    // Any change of state (a tap, the keyboard, a drag, a revert): the knob travels to its new end in
    // glass and lands there; a drag's release keeps its speed. It starts from where it is, or from the
    // end it was showing before the change.
    const travel = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      track.removeAttribute('data-pressed');
      held = false;
      const l = L || engage(!input.checked);
      if (!l) return;
      track.setAttribute('data-traveling', '');
      l.travel(input.checked ? len : 0, { lift: true, velocity: flick });
      flick = 0;
    };
    travels.set(track, travel);
    const rescue = () => {
      rescueTimer = 0;
      if (T.rescue() && !input.disabled && root.isConnected) input.click(); // detail 0: it goes through, and its change moves the knob
      if (!track.hasAttribute('data-traveling')) drop();
    };
    const flushRescue = () => { if (rescueTimer) { clearTimeout(rescueTimer); rescue(); } };
    const follow = (x) => {
      const raw = base + (x - T.get().x0);
      const pos = clamp(raw, 0, len);
      if (L) L.follow(pos + rubber(raw - pos, 10));
      const on = pos > len / 2;
      // A detent at the middle, where the on colour has filled half the track.
      if (on !== side) { side = on; haptic('detent'); }
    };

    const offs = [];
    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };
    on(root, 'pointerdown', (e) => {
      if (input.disabled || e.button > 0 || !e.isPrimary) return;
      flushRescue();
      T.down({ id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!L) measure(); // where a drag starts from (the engine, if the knob is still moving, has it)
      base = input.checked ? len : 0;
      side = input.checked;
      if (e.pointerType === 'touch') { clearTimeout(liftTimer); liftTimer = setTimeout(lift, LIFT); } else lift();
    });
    on(root, 'pointermove', (e) => {
      const g = T.get();
      if (!g || g.end || e.pointerId !== g.id) return;
      const m = T.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (m === 'scroll') { drop(); return; }
      if (m === 'drag') {
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
        lift();
        track.setAttribute('data-dragging', '');
      }
      if (g.mode === 'drag') follow(e.clientX);
    });
    on(root, 'pointerup', (e) => {
      const g = T.get();
      const end = T.up({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!end) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (end === 'drag') {
        const v = T.speed(e.timeStamp);
        const next = landing(clamp(base + (e.clientX - g.x0), 0, len), len, v);
        track.removeAttribute('data-dragging');
        flick = v * 1000; // px/s, for the engine
        if (next !== input.checked) {
          input.checked = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else travel(); // back where it was, in glass
        return;
      }
      if (end === 'tap') {
        // The knob stays up until the tap's click (or the rescue) moves it.
        if (!g.clicked) rescueTimer = setTimeout(rescue, RESCUE);
        return;
      }
      drop();
    });
    const cancel = (e) => {
      if (!T.cancel(e.pointerId)) return;
      clearTimeout(liftTimer); liftTimer = 0;
      const dragged = track.hasAttribute('data-dragging');
      track.removeAttribute('data-dragging');
      if (dragged) travel(); // springs back
      else drop();
    };
    on(root, 'pointercancel', cancel);
    on(root, 'lostpointercapture', (e) => { if (e.target === root) cancel(e); });
    on(root, 'click', arbiter(T, () => {
      clearTimeout(rescueTimer); rescueTimer = 0;
      // Let go of the lift if nothing came of the click (something else stopped it).
      setTimeout(() => { if (!track.hasAttribute('data-traveling')) drop(); }, 0);
    }), true);
    on(input, 'change', () => { changedTo.set(input, input.checked); travel(); });
    return () => {
      offs.forEach((f) => f());
      clearTimeout(liftTimer); clearTimeout(rescueTimer);
      held = false;
      release();
      travels.delete(track);
    };
  }

  /* ---------------------------------------------------------------- segmented controls and chip choices */
  // The two kinds of single choice share one behaviour: a thumb under the picked option, taps with the
  // rescue, and the keyboard. A segmented control's thumb is a bead of Refract's liquid glass with a
  // lens over its labels, and can be dragged; a chip choice's slides to the chip picked (across wrapped
  // rows). A segmented control's options are radio inputs (their change is native); a chip choice's
  // are role=radio buttons, picked here, with a change fired from the button (its value is the
  // option's).
  const SEG = {
    opts: (root) => Array.from(root.querySelectorAll(':scope > .rf-segment')),
    optOf: (t) => (t.closest ? t.closest('.rf-segment') : null),
    on: (o) => { const i = o.querySelector('input'); return !!(i && i.checked); },
    disabled: (o) => { const i = o.querySelector('input'); return !i || i.disabled; },
    drag: true,
    pick(root, o) {
      const i = o.querySelector('input');
      if (!i || i.checked || i.disabled) return false;
      i.checked = true;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    click(o) { const i = o.querySelector('input'); if (i) i.click(); },
  };
  const CHIPS = {
    opts: (root) => Array.from(root.querySelectorAll(':scope > [role="radio"]')),
    optOf: (t) => (t.closest ? t.closest('[role="radio"]') : null),
    on: (o) => o.getAttribute('aria-checked') === 'true',
    disabled: (o) => o.disabled || o.getAttribute('aria-disabled') === 'true',
    drag: false,
    pick(root, o) {
      if (CHIPS.on(o) || CHIPS.disabled(o)) return false;
      for (const b of CHIPS.opts(root)) { const sel = b === o; b.setAttribute('aria-checked', String(sel)); b.tabIndex = sel ? 0 : -1; }
      haptic('select');
      o.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    click(o) { o.click(); },
  };
  const refreshers = new WeakMap();
  const part = (root, cls, first) => {
    let el = root.querySelector(`:scope > .${cls}`);
    if (!el) {
      el = doc.createElement('span');
      el.className = cls;
      el.setAttribute('aria-hidden', 'true');
      if (first) root.insertBefore(el, root.firstChild); else root.appendChild(el);
    }
    return el;
  };

  // A segmented control's thumb, as Refract draws its own: the frosted bead under the labels and a lens
  // over them, moving as one (it rises to 1.1 x 1.24, and its lens magnifies the labels it passes).
  const BEAD = { lift: [1.1, 1.24], stretch: 0.22, lens: { zoom: 1.2, refract: 2.5, rim: 0.25, bezel: 10, dispersion: 0.04 } };
  // The bead is the engine's only while it's touched or moving, as a switch's knob is: at rest it's
  // placed by a plain transform, which looks the same (a resting bead's lens is off, controls.css).
  // So a control costs nothing until it's touched: the engine's lens is drawn pixel by pixel in
  // JavaScript (a map for the bead's size), which at launch held up the first frames (Today's feel
  // check is one of these). It's taken on where the bead is and handed back once it has landed.
  function beadMover(root) {
    const face = part(root, 'rf-segmented-thumb', true);
    const lens = part(root, 'rf-segmented-lens', false);
    let L = null, held = false, width = -1, x = 0;
    const rest = () => { face.style.transform = lens.style.transform = `translateX(${x}px)`; };
    const release = () => {
      if (!L) return;
      L.destroy();
      L = null;
      for (const el of [face, lens]) { el.style.removeProperty('--rf-lift'); el.style.removeProperty('--_lens'); el.removeAttribute('data-lifted'); }
      rest();
    };
    // The engine, from where the bead is now (`at`); null without Refract.
    const engage = (at) => {
      if (L) return L;
      L = liquid([face, lens], BEAD);
      if (!L) return null;
      L.onRest = () => { if (!held) { root.removeAttribute('data-traveling'); settled(root); release(); } };
      L.place(at);
      return L;
    };
    const size = (w) => { if (w !== width) { width = w; face.style.inlineSize = lens.style.inlineSize = `${w}px`; } };
    return {
      parts: [face, lens],
      at: () => x,
      width: () => width,
      // Where an option is, with no motion (the first layout, a resize).
      place(o) { x = o.offsetLeft; size(o.offsetWidth); if (L) L.place(x); else rest(); },
      // To an option in glass, rising for the trip and landing with a squash; `fresh` grows the bead out
      // of nothing (the first pick of a control that had none).
      travel(o, { velocity = 0, fresh = false } = {}) {
        const from = x;
        x = o.offsetLeft; size(o.offsetWidth);
        const l = engage(fresh ? x : from);
        if (!l) { this.place(o); return; }
        root.setAttribute('data-traveling', '');
        busy(root);
        held = false;
        if (fresh) l.place(x, 0.4);
        l.travel(x, { lift: true, velocity, width: 1 });
      },
      grab() { held = true; busy(root); const l = engage(x); if (l) l.grab(); },
      follow(tx) { if (L) L.follow(tx); },
      drop() { held = false; if (L) L.drop(); else settled(root); },
      destroy() { held = false; release(); },
    };
  }
  // A chip choice's indicator: it slides (CSS transitions) to the chip picked, on any line.
  function slideMover(root) {
    const thumb = part(root, 'gh-chipseg-thumb', true);
    const put = (name, v) => { if (root.style.getPropertyValue(name) !== v) root.style.setProperty(name, v); };
    let x = 0, endMove = 0;
    const at = (o) => { x = o.offsetLeft; const y = o.offsetTop, w = o.offsetWidth, h = o.offsetHeight; put('--_tx', `${x}px`); put('--_tw', `${w}px`); put('--_ty', `${y}px`); put('--_th', `${h}px`); };
    return {
      parts: [thumb],
      at: () => x,
      width: () => thumb.offsetWidth,
      place: at,
      travel(o) {
        at(o);
        root.setAttribute('data-traveling', '');
        busy(root);
        clearTimeout(endMove);
        endMove = setTimeout(() => { endMove = 0; root.removeAttribute('data-traveling'); settled(root); }, dur('duration-spring-snappy', 460) + 80);
      },
      grab() {},
      follow() {},
      drop() { settled(root); },
      destroy() { clearTimeout(endMove); },
    };
  }

  function picker(root, K) {
    const M = K.drag ? beadMover(root) : slideMover(root);
    if (!root.hasAttribute('role')) root.setAttribute('role', 'radiogroup');
    const T = tracker();
    let last = -1, liftTimer = 0, rescueTimer = 0, d = null;
    const opts = () => K.opts(root);
    const current = () => opts().find(K.on) || null;

    // The thumb goes where the picked option is: placed at once on the first layout and a resize, in
    // glass for a change (a pick, the keyboard, a re-render that picked another).
    const position = (kick, velocity) => {
      const o = current();
      const wasEmpty = root.hasAttribute('data-empty');
      root.toggleAttribute('data-empty', !o);
      if (!o) { last = -1; return; }
      const i = opts().indexOf(o);
      if (kick && !d && (i !== last || wasEmpty) && root.hasAttribute('data-ready')) M.travel(o, { velocity, fresh: wasEmpty });
      else M.place(o);
      last = i;
    };
    refreshers.set(root, () => position(true));

    // Held: the option pressed sinks a little; on the picked one the thumb rises.
    const press = (o, lift) => {
      clearTimeout(liftTimer); liftTimer = 0;
      o.setAttribute('data-pressed', '');
      if (lift) { root.setAttribute('data-pressed', ''); M.grab(); haptic('press'); }
    };
    const unpress = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      for (const o of opts()) o.removeAttribute('data-pressed');
      if (root.hasAttribute('data-pressed')) { root.removeAttribute('data-pressed'); M.drop(); }
    };
    const rescue = () => {
      rescueTimer = 0;
      const g = T.get();
      if (!T.rescue() || !g.opt.isConnected || K.disabled(g.opt)) { unpress(); return; }
      unpress();
      K.click(g.opt); // detail 0: it goes through, and picks the option the finger was on
    };
    const flushRescue = () => { if (rescueTimer) { clearTimeout(rescueTimer); rescue(); } };

    const startDrag = (e) => {
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      const g = T.get();
      clearTimeout(liftTimer); liftTimer = 0;
      g.opt.removeAttribute('data-pressed');
      if (!root.hasAttribute('data-pressed')) { M.grab(); haptic('press'); }
      root.setAttribute('data-pressed', '');
      root.setAttribute('data-dragging', '');
      const list = opts();
      const box = root.getBoundingClientRect();
      const tw = M.width();
      d = {
        left: box.left, min: 3, max: root.clientWidth - tw - 3, tw,
        // Grabbed on the thumb, it keeps the finger where it took it; from another option, it centres
        // under the finger.
        grab: K.on(g.opt) ? g.x0 - box.left - M.at() : tw / 2,
        centres: list.map((o) => o.offsetLeft + o.offsetWidth / 2),
        over: list.indexOf(current()),
        list,
      };
    };
    const follow = (x) => {
      const raw = x - d.left - d.grab;
      const tx = clamp(raw, d.min, d.max);
      M.follow(tx + rubber(raw - tx, 8));
      // The option under the thumb's centre lights up, with a tick each time it changes.
      const c = tx + d.tw / 2;
      let over = 0;
      d.centres.forEach((v, i) => { if (Math.abs(v - c) < Math.abs(d.centres[over] - c)) over = i; });
      if (over !== d.over) {
        if (d.list[d.over]) d.list[d.over].removeAttribute('data-over');
        d.over = over;
        d.list[over].setAttribute('data-over', '');
        haptic('tick');
      }
    };
    const endDrag = () => {
      for (const o of d.list) o.removeAttribute('data-over');
      const pick = d.list[d.over];
      d = null;
      root.removeAttribute('data-dragging');
      for (const o of opts()) o.removeAttribute('data-pressed');
      root.removeAttribute('data-pressed');
      return pick;
    };

    const offs = [];
    const on = (el, type, fn, o) => { el.addEventListener(type, fn, o); offs.push(() => el.removeEventListener(type, fn, o)); };
    on(root, 'pointerdown', (e) => {
      if (e.button > 0 || !e.isPrimary) return;
      const o = K.optOf(e.target);
      if (!o || o.parentNode !== root || K.disabled(o)) return;
      flushRescue();
      const g = T.down({ id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: e.timeStamp });
      g.opt = o;
      const lift = K.drag && K.on(o);
      if (e.pointerType === 'touch') liftTimer = setTimeout(() => press(o, lift), LIFT); else press(o, lift);
    });
    on(root, 'pointermove', (e) => {
      const g = T.get();
      if (!g || g.end || e.pointerId !== g.id) return;
      const m = T.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (m === 'scroll' || (m === 'drag' && !K.drag)) {
        // A scroll, or chips moved sideways (a rail scrolling): not a pick.
        T.cancel(e.pointerId);
        unpress();
        return;
      }
      if (m === 'drag') startDrag(e);
      if (d) follow(e.clientX);
    });
    on(root, 'pointerup', (e) => {
      const g = T.get();
      const end = T.up({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!end) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (end === 'drag' && d) {
        const v = T.speed(e.timeStamp) * 1000;
        const pick = endDrag();
        if (pick && K.on(pick)) { const o = current(); if (o) M.travel(o, { velocity: v }); } // where it was: back in glass
        else if (!pick || !K.pick(root, pick)) { const o = current(); if (o) M.travel(o, { velocity: v }); }
        return;
      }
      if (end === 'tap') {
        // A tap on the picked option: the lift drops; on another one, its click (or the rescue) moves
        // the thumb there.
        if (root.hasAttribute('data-pressed')) { root.removeAttribute('data-pressed'); M.drop(); }
        if (!g.clicked) rescueTimer = setTimeout(rescue, RESCUE);
        else unpress();
        return;
      }
      unpress();
    });
    const cancel = (e) => {
      if (!T.cancel(e.pointerId)) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (d) { endDrag(); const o = current(); if (o) M.travel(o); } // springs back
      else unpress();
    };
    on(root, 'pointercancel', cancel);
    on(root, 'lostpointercapture', (e) => { if (e.target === root) cancel(e); });
    on(root, 'click', arbiter(T, () => { clearTimeout(rescueTimer); rescueTimer = 0; unpress(); }), true);
    if (!K.drag) {
      // A chip choice picks on its click (a tap, the rescue, Enter or Space). One marked data-repick
      // acts on every pick, so the option already picked fires its change again.
      on(root, 'click', (e) => {
        const o = K.optOf(e.target);
        if (!o || o.parentNode !== root || K.disabled(o)) return;
        if (!K.pick(root, o) && root.hasAttribute('data-repick') && K.on(o)) { haptic('select'); o.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      // Arrows move to the next option and pick it, like radio buttons; Home and End too.
      on(root, 'keydown', (e) => {
        const list = opts().filter((o) => !K.disabled(o));
        const i = list.indexOf(doc.activeElement);
        if (i < 0) return;
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        const j = step ? (i + step + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        list[j].focus();
        if (list[j].scrollIntoView) list[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        K.pick(root, list[j]);
      });
    }
    // Native picks (a tap's click, the keyboard on radios) and ours land here.
    on(root, 'change', () => position(true));
    // Reading where the options are lays the page out, so a control a render made or changed is
    // placed in the read pass at the next frame (core.js), once that render's writes are all in:
    // read mid-render, it laid the whole page out again.
    let gone = false;
    const later = (fn) => { if (U.readSoon) U.readSoon(() => { if (!gone) fn(); }); else fn(); };
    // A re-render that picks another option, or changes the options, moves the thumb too.
    const mo = new G.MutationObserver((recs) => {
      if (recs.every((x) => x.type === 'childList' && [...x.addedNodes, ...x.removedNodes].every((n) => M.parts.includes(n)))) return;
      later(() => position(true));
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: K.drag ? ['checked'] : ['aria-checked'] });
    const ro = G.ResizeObserver ? new G.ResizeObserver(() => { if (!d) later(() => position(false)); }) : null;
    if (ro) ro.observe(root);
    // Moves animate from the frame after the first placement (it doesn't slide in).
    later(() => { position(false); G.requestAnimationFrame(() => root.setAttribute('data-ready', '')); });
    return () => {
      gone = true;
      offs.forEach((f) => f());
      mo.disconnect();
      if (ro) ro.disconnect();
      clearTimeout(liftTimer); clearTimeout(rescueTimer);
      M.destroy();
      settled(root);
      refreshers.delete(root);
    };
  }
  const ghSegmented = (root) => picker(root, SEG);
  const ghChipChoice = (root) => picker(root, CHIPS);

  /* ---------------------------------------------------------------- helpers for screens */
  // A switch whose change was refused: a deny buzz now, and the knob springs back in glass a moment
  // later, so it's clear the change didn't take. Call it before the toast that says why.
  U.revertSwitch = (input) => {
    if (!input) return;
    // Back to how it was before the change, even if a re-render already put it back meanwhile (a
    // handler that waited on a permission prompt).
    const back = changedTo.has(input) ? !changedTo.get(input) : !input.checked;
    haptic('deny');
    setTimeout(() => {
      if (!input.isConnected || input.checked === back) return;
      input.checked = back;
      const track = input.closest('.rf-switch-track');
      const t = track && travels.get(track);
      if (t) t();
    }, 180);
  };
  // Resolves once a control (or the control around el) has landed: not held, dragged or moving.
  U.controlSettled = (el) => {
    if (!el || !el.closest) return Promise.resolve();
    const host = el.closest('.rf-switch-track, .rf-segmented, .gh-chipseg') || (el.querySelector && el.querySelector('.rf-switch-track'));
    const s = host && settling.get(host);
    return s ? s.promise : Promise.resolve();
  };
  // Re-measures a segmented control or chip choice after a re-render changed it (core.js queueRefresh).
  // False for anything else, which Refract's own refresh handles.
  U.refreshControl = (el) => {
    const f = el && refreshers.get(el);
    if (f) f();
    return !!f;
  };

  /* ---------------------------------------------------------------- install */
  const r = R();
  if (r && r.behaviors) {
    r.behaviors.switch = ghSwitch;
    r.behaviors.segmented = ghSegmented;
    // Chip choices aren't in Refract's list of classes it looks for, so U.choice marks them
    // data-rf="chipseg", which Refract.init also attaches by.
    r.behaviors.chipseg = ghChipChoice;
  }
})(typeof window !== 'undefined' ? window : globalThis);
