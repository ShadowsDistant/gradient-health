/* Switches, segmented controls and chip choices: gestures that never miss a tap, and liquid-glass
 * thumbs that stay glass at rest.
 *
 * Refract's own switch and segmented behaviours are replaced here, and a chip-choice behaviour is
 * added. Its behaviour registry (Refract.behaviors) is the very object Refract.init reads, and the
 * app's scripts run after Refract's and before its first init, so the vendored bundle stays as it is.
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
  const LENS_FADE = 180; // ms; matches the lens's opacity transition in controls.css
  const STATES = ['data-pressed', 'data-dragging', 'data-traveling'];

  // The lens over a thumb or a knob is a drop of glass: what's under it is drawn larger in the middle
  // and squeezed toward the rim. Refract's own lens maps only push pixels inward along the rim, which
  // suits a glass bar over a background; over text, any depth that shows mirrors and tears the glyphs.
  // This map pulls each point toward the centre by k·(1 - e²)² of its distance (e: 0 in the middle, 1
  // at the rim), which never folds over (k < 1) and fades to nothing at the rim, so the lens meets
  // what's around it without a seam.
  //
  // The filter is laid out in the element's own (unscaled) box, and scales with it when a held control
  // swells. One per size and strength, shared by every control that size, and kept: an app has only a
  // handful of control sizes. (An element carrying one must cast no outer shadow, nor anything in it:
  // Chrome then applies the filter to the wrong box. See the switch's knob in controls.css.)
  const NS = 'http://www.w3.org/2000/svg';
  let defsEl = null;
  const defs = () => {
    if (defsEl && defsEl.isConnected) return defsEl;
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defsEl = doc.createElementNS(NS, 'defs');
    svg.appendChild(defsEl);
    (doc.body || doc.documentElement).appendChild(svg);
    return defsEl;
  };
  let lensN = 0;
  const LENSES = new Map();
  function lensFor(w, h, kind) {
    const r = R();
    if (!r || !r.supports || !r.supports.lens) return '';
    w = Math.round(w); h = Math.round(h);
    if (w < 4 || h < 4) return '';
    const key = `${kind}:${w}x${h}`;
    if (LENSES.has(key)) return LENSES.get(key);
    let url = '';
    try {
      const k = kind === 'knob' ? 0.26 : 0.18; // the middle looks 1 / (1 - k) times larger
      const a = w / 2, b = h / 2;
      // The farthest any point moves (u(1 - u²)² peaks at 0.286) sets the filter's scale; the map holds
      // each move as a fraction of it.
      const scale = Math.ceil(2 * 0.3 * k * Math.max(a, b));
      const cv = doc.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const px = x + 0.5 - a, py = y + 0.5 - b;
          const e2 = (px / a) ** 2 + (py / b) ** 2;
          const pull = e2 < 1 ? k * (1 - e2) ** 2 : 0;
          const ox = -px * pull, oy = -py * pull;
          const i = (y * w + x) * 4;
          img.data[i] = Math.round(127.5 + (ox / scale) * 255);
          img.data[i + 1] = Math.round(127.5 + (oy / scale) * 255);
          img.data[i + 2] = 128;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const id = `gh-lens-${++lensN}`;
      const f = doc.createElementNS(NS, 'filter');
      for (const [a, v] of [['id', id], ['x', 0], ['y', 0], ['width', w], ['height', h], ['filterUnits', 'userSpaceOnUse'], ['primitiveUnits', 'userSpaceOnUse'], ['color-interpolation-filters', 'sRGB']]) f.setAttribute(a, String(v));
      const im = doc.createElementNS(NS, 'feImage');
      for (const [a, v] of [['href', cv.toDataURL('image/png')], ['x', 0], ['y', 0], ['width', w], ['height', h], ['preserveAspectRatio', 'none'], ['result', 'map']]) im.setAttribute(a, String(v));
      const dm = doc.createElementNS(NS, 'feDisplacementMap');
      for (const [a, v] of [['in', 'SourceGraphic'], ['in2', 'map'], ['scale', scale], ['xChannelSelector', 'R'], ['yChannelSelector', 'G']]) dm.setAttribute(a, String(v));
      f.append(im, dm);
      defs().appendChild(f);
      url = `url(#${id})`;
    } catch (e) { url = ''; }
    LENSES.set(key, url);
    return url;
  }

  // A control's settling: busy() while it's held or moving, then the promise U.controlSettled hands
  // out resolves.
  const settling = new WeakMap();
  function busy(host) {
    if (settling.has(host)) return;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    settling.set(host, { promise, resolve });
  }
  function settled(host) {
    const s = settling.get(host);
    if (s) { settling.delete(host); s.resolve(); }
  }

  // The lens's life on one control: on while it's held, dragged or moving. When all that's over the
  // lens fades (CSS), and then data-lens-idle turns its backdrop filter off, so a control at rest
  // costs the GPU nothing.
  function glass(host) {
    let t = 0;
    const active = () => STATES.some((a) => host.hasAttribute(a));
    host.setAttribute('data-lens-idle', '');
    return {
      on() { clearTimeout(t); t = 0; host.removeAttribute('data-lens-idle'); busy(host); },
      settle() {
        if (active()) return;
        settled(host);
        clearTimeout(t);
        t = setTimeout(() => { t = 0; if (!active()) host.setAttribute('data-lens-idle', ''); }, LENS_FADE + 40);
      },
      stop() { clearTimeout(t); settled(host); },
    };
  }

  // The stretch: --rf-stretch follows how fast the knob moves and springs back to 0 (the CSS turns it
  // into a squash and stretch). The one deformation a control has while it moves.
  function stretcher(el) {
    const r = R();
    const s = r && r.spring ? r.spring({ stiffness: 420, damping: 24, onUpdate: (x) => el.style.setProperty('--rf-stretch', x.toFixed(3)) }) : null;
    let lastX = 0, lastT = 0;
    return {
      track(x, t) {
        if (s && lastT && t > lastT) s.set(clamp(Math.abs(x - lastX) / (t - lastT) / 2.2, 0, 1));
        lastX = x; lastT = t;
      },
      release() { lastT = 0; if (s) s.to(0); },
      kick(a) { lastT = 0; if (s && !reduced()) { s.set(a); s.to(0); } },
      stop() { if (s) s.stop(); },
    };
  }

  // Runs fn once el's `prop` transition has finished, or after ms at most. Call it right after the
  // change that starts the move: getAnimations() brings the style up to date and hands back the
  // transition itself (its events can come frames late when it runs on the compositor). A move that
  // doesn't start (a dragged knob let go where it lands) ends after a short hold instead, and one cut
  // short by a new move waits for that one. Returns a function that calls it off.
  function afterMove(el, prop, ms, fn) {
    let live = true, hold = 0;
    const t = setTimeout(() => finish(), ms);
    const off = () => { live = false; clearTimeout(t); clearTimeout(hold); };
    function finish() { if (!live) return; off(); fn(); }
    const watch = () => {
      const a = el.getAnimations ? el.getAnimations().find((x) => x.transitionProperty === prop && x.playState !== 'finished') : null;
      if (!a) { hold = setTimeout(finish, 140); return; }
      a.finished.then(finish, () => { if (live) watch(); });
    };
    watch();
    return off;
  }

  // Click arbitration, in the capture phase on the control: a click the gesture rules don't allow is
  // stopped before it can toggle or select anything.
  function arbiter(T, onAllow) {
    return (e) => {
      if (T.click({ t: e.timeStamp, detail: e.detail }) === 'swallow') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.detail) onAllow();
    };
  }

  /* ---------------------------------------------------------------- switch */
  const travels = new WeakMap(); // a switch's track → its travel (U.revertSwitch moves it in glass)
  const changedTo = new WeakMap(); // a switch's input → what its last change set it to
  function ghSwitch(root) {
    const track = root.querySelector('.rf-switch-track');
    const input = root.querySelector('input[type="checkbox"]');
    const thumb = root.querySelector('.rf-switch-thumb');
    if (!track || !input || !thumb) return undefined;
    if (!input.hasAttribute('role')) input.setAttribute('role', 'switch');
    const T = tracker();
    const st = stretcher(track); // the track carries the knob's stretch and drag, for its shadow too
    const gl = glass(track);
    let liftTimer = 0, rescueTimer = 0, frame = 0, endMove = null;
    let base = 0, len = 0, side = false, pos = 0;
    const travelLen = () => track.clientWidth - thumb.offsetWidth - 6;

    // The knob's lens (one per knob size, shared), set the first time the knob turns to glass.
    let lensSet = false;
    const knobLens = () => {
      if (lensSet) return;
      lensSet = true;
      const url = lensFor(thumb.offsetWidth, thumb.offsetHeight, 'knob');
      if (url) root.style.setProperty('--_knob-lens', url);
    };
    // Held: the knob swells into a clear lens.
    const lift = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      if (track.hasAttribute('data-pressed')) return;
      knobLens();
      gl.on();
      track.setAttribute('data-pressed', '');
      haptic('press');
    };
    const drop = () => { clearTimeout(liftTimer); liftTimer = 0; track.removeAttribute('data-pressed'); };
    const endDrag = () => {
      if (frame) { G.cancelAnimationFrame(frame); frame = 0; }
      track.style.removeProperty('--_drag');
      track.removeAttribute('data-dragging');
      track.removeAttribute('data-drag-on');
      st.release();
    };
    // Any change of state (a tap, the keyboard, a drag, a revert) moves the knob in glass until it
    // lands: the travel lasts as long as the knob's translate, with a fallback for a move that never
    // started.
    const travel = () => {
      drop();
      knobLens();
      gl.on();
      if (!reduced()) st.kick(0.7);
      track.setAttribute('data-traveling', '');
      if (endMove) endMove();
      endMove = afterMove(thumb, 'translate', dur('duration-spring-bouncy', 680) + 80, () => {
        endMove = null;
        track.removeAttribute('data-traveling');
        gl.settle();
      });
    };
    travels.set(track, travel);
    const rescue = () => {
      rescueTimer = 0;
      if (T.rescue() && !input.disabled && root.isConnected) input.click(); // detail 0: it goes through, and its change moves the knob
      if (!track.hasAttribute('data-traveling')) { drop(); gl.settle(); }
    };
    const flushRescue = () => { if (rescueTimer) { clearTimeout(rescueTimer); rescue(); } };
    const follow = (x) => {
      pos = clamp(base + (x - T.get().x0), 0, len);
      if (!frame) frame = G.requestAnimationFrame(() => { frame = 0; track.style.setProperty('--_drag', `${(pos - base).toFixed(1)}px`); });
      const on = pos > len / 2;
      // The on colour follows the knob across, with a detent at the middle.
      if (on !== side) { side = on; track.toggleAttribute('data-drag-on', on); haptic('detent'); }
    };

    const offs = [];
    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };
    on(root, 'pointerdown', (e) => {
      if (input.disabled || e.button > 0 || !e.isPrimary) return;
      flushRescue();
      T.down({ id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: e.timeStamp });
      len = travelLen();
      base = input.checked ? len : 0;
      side = input.checked;
      if (e.pointerType === 'touch') { clearTimeout(liftTimer); liftTimer = setTimeout(lift, LIFT); } else lift();
    });
    on(root, 'pointermove', (e) => {
      const g = T.get();
      if (!g || g.end || e.pointerId !== g.id) return;
      const m = T.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (m === 'scroll') { drop(); gl.settle(); return; }
      if (m === 'drag') {
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
        lift();
        track.toggleAttribute('data-drag-on', side);
        track.setAttribute('data-dragging', '');
      }
      if (g.mode === 'drag') { follow(e.clientX); st.track(e.clientX, e.timeStamp); }
    });
    on(root, 'pointerup', (e) => {
      const g = T.get();
      const end = T.up({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!end) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (end === 'drag') {
        const next = landing(clamp(base + (e.clientX - g.x0), 0, len), len, T.speed(e.timeStamp));
        endDrag();
        if (next !== input.checked) {
          input.checked = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else travel(); // back where it was, in glass
        return;
      }
      if (end === 'tap') {
        // The knob stays lifted until the tap's click (or the rescue) moves it.
        if (!g.clicked) rescueTimer = setTimeout(rescue, RESCUE);
        return;
      }
      drop(); gl.settle();
    });
    const cancel = (e) => {
      if (!T.cancel(e.pointerId)) return;
      clearTimeout(liftTimer); liftTimer = 0;
      const dragged = track.hasAttribute('data-dragging');
      endDrag();
      if (dragged) travel(); // springs back
      else { drop(); gl.settle(); }
    };
    on(root, 'pointercancel', cancel);
    on(root, 'lostpointercapture', (e) => { if (e.target === root) cancel(e); });
    on(root, 'click', arbiter(T, () => {
      clearTimeout(rescueTimer); rescueTimer = 0;
      // Let go of the lift if nothing came of the click (something else stopped it).
      setTimeout(() => { if (!track.hasAttribute('data-traveling')) { drop(); gl.settle(); } }, 0);
    }), true);
    on(input, 'change', () => { changedTo.set(input, input.checked); travel(); });
    return () => {
      offs.forEach((f) => f());
      clearTimeout(liftTimer); clearTimeout(rescueTimer);
      if (frame) G.cancelAnimationFrame(frame);
      if (endMove) endMove();
      st.stop(); gl.stop();
      travels.delete(track);
    };
  }

  /* ---------------------------------------------------------------- segmented controls and chip choices */
  // The two kinds of single choice share one behaviour: a glass thumb under the picked option, a lens
  // over it while it's held or moving, taps with the rescue, and the keyboard. A segmented control's
  // options are radio inputs (their change is native); a chip choice's are role=radio buttons, picked
  // here, with a change fired from the button (its value is the option's).
  const SEG = {
    opts: (root) => Array.from(root.querySelectorAll(':scope > .rf-segment')),
    optOf: (t) => (t.closest ? t.closest('.rf-segment') : null),
    on: (o) => { const i = o.querySelector('input'); return !!(i && i.checked); },
    disabled: (o) => { const i = o.querySelector('input'); return !i || i.disabled; },
    thumb: 'rf-segmented-thumb',
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
    thumb: 'gh-chipseg-thumb',
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

  function picker(root, K) {
    const part = (cls) => {
      let el = root.querySelector(`:scope > .${cls}`);
      if (!el) {
        el = doc.createElement('span');
        el.className = cls;
        el.setAttribute('aria-hidden', 'true');
        if (cls === K.thumb) root.insertBefore(el, root.firstChild); else root.appendChild(el);
      }
      return el;
    };
    const thumb = part(K.thumb);
    const lens = part('gh-seg-lens');
    if (!root.hasAttribute('role')) root.setAttribute('role', 'radiogroup');
    const T = tracker();
    const st = stretcher(root);
    const gl = glass(root);
    const r = R();
    // While dragged, the thumb follows the finger on a spring: it jumps under it when the drag starts
    // on another option, then stays with it.
    const spring = r && r.spring ? r.spring({ stiffness: 900, damping: 50, onUpdate: (x) => root.style.setProperty('--_tx', `${x.toFixed(1)}px`) }) : null;
    let last = -1, lensKey = '', liftTimer = 0, rescueTimer = 0, endMove = null, d = null;
    const opts = () => K.opts(root);
    const current = () => opts().find(K.on) || null;

    // The thumb goes where the option is (with its size, for chips of any width on any line).
    const place = (o) => {
      root.style.setProperty('--_tx', `${o.offsetLeft}px`);
      root.style.setProperty('--_tw', `${o.offsetWidth}px`);
      if (!K.drag) {
        root.style.setProperty('--_ty', `${o.offsetTop}px`);
        root.style.setProperty('--_th', `${o.offsetHeight}px`);
      }
      // The lens filter for the thumb's size, rebuilt only when the size changes (a resize, another
      // chip's width), from a cache shared by every control.
      const k = `${o.offsetWidth}x${K.drag ? thumb.offsetHeight : o.offsetHeight}`;
      if (k !== lensKey) {
        lensKey = k;
        const url = lensFor(o.offsetWidth, K.drag ? thumb.offsetHeight : o.offsetHeight, 'thumb');
        if (url) root.style.setProperty('--_drag-lens', url); else root.style.removeProperty('--_drag-lens');
      }
    };
    // In glass from where it is to the picked option, until the thumb's translate ends (or a fallback
    // a little after the spring's length), then the lens fades.
    const travel = (dist) => {
      root.setAttribute('data-traveling', '');
      gl.on();
      if (dist) st.kick(clamp(dist * 0.45, 0.3, 0.9));
      if (endMove) endMove();
      endMove = afterMove(thumb, 'translate', dur('duration-spring-snappy', 460) + 80, () => {
        endMove = null;
        root.removeAttribute('data-traveling');
        gl.settle();
      });
    };
    const position = (kick) => {
      const o = current();
      root.toggleAttribute('data-empty', !o);
      if (!o) { last = -1; return; }
      const i = opts().indexOf(o);
      const moved = kick && last !== -1 && i !== last && !d;
      place(o);
      if (moved) travel(Math.abs(i - last)); // after the move starts, so it can wait for its end
      last = i;
    };
    refreshers.set(root, () => position(true));

    // Held: the option pressed sinks a little; on the picked one the thumb lifts into its lens.
    const press = (o, lift) => {
      clearTimeout(liftTimer); liftTimer = 0;
      o.setAttribute('data-pressed', '');
      if (lift) { root.setAttribute('data-pressed', ''); gl.on(); haptic('press'); }
    };
    const unpress = () => {
      clearTimeout(liftTimer); liftTimer = 0;
      for (const o of opts()) o.removeAttribute('data-pressed');
      root.removeAttribute('data-pressed');
    };
    const rescue = () => {
      rescueTimer = 0;
      const g = T.get();
      if (!T.rescue() || !g.opt.isConnected || K.disabled(g.opt)) { unpress(); gl.settle(); return; }
      unpress();
      K.click(g.opt); // detail 0: it goes through, and picks the option the finger was on
      gl.settle();
    };
    const flushRescue = () => { if (rescueTimer) { clearTimeout(rescueTimer); rescue(); } };

    const startDrag = (e) => {
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      const g = T.get();
      clearTimeout(liftTimer); liftTimer = 0;
      g.opt.removeAttribute('data-pressed');
      if (!root.hasAttribute('data-pressed')) { gl.on(); haptic('press'); }
      root.setAttribute('data-pressed', '');
      root.setAttribute('data-dragging', '');
      const list = opts();
      const box = root.getBoundingClientRect();
      const tx = parseFloat(root.style.getPropertyValue('--_tx')) || 0;
      const tw = thumb.offsetWidth;
      d = {
        left: box.left, min: 3, max: root.clientWidth - tw - 3, tw,
        // Grabbed on the thumb, it keeps the finger where it took it; from another option, it centres
        // under the finger.
        grab: K.on(g.opt) ? g.x0 - box.left - tx : tw / 2,
        centres: list.map((o) => o.offsetLeft + o.offsetWidth / 2),
        over: list.indexOf(current()),
        list,
      };
      if (spring) spring.set(tx);
    };
    const follow = (x) => {
      const tx = clamp(x - d.left - d.grab, d.min, d.max);
      if (spring) spring.to(tx); else root.style.setProperty('--_tx', `${tx}px`);
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
      if (spring) spring.stop();
      for (const o of d.list) o.removeAttribute('data-over');
      const pick = d.list[d.over];
      d = null;
      st.release();
      root.removeAttribute('data-dragging');
      unpress();
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
        unpress(); gl.settle();
        return;
      }
      if (m === 'drag') startDrag(e);
      if (d) { follow(e.clientX); st.track(e.clientX, e.timeStamp); }
    });
    on(root, 'pointerup', (e) => {
      const g = T.get();
      const end = T.up({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (!end) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (end === 'drag' && d) {
        const pick = endDrag();
        if (!pick || !K.pick(root, pick)) { const o = current(); if (o) place(o); travel(0); } // back to the picked one
        return;
      }
      if (end === 'tap') {
        // A tap on the picked option: the lift drops; on another one, its click (or the rescue) moves
        // the thumb there.
        root.removeAttribute('data-pressed');
        if (!g.clicked) rescueTimer = setTimeout(rescue, RESCUE);
        else unpress();
        gl.settle();
        return;
      }
      unpress(); gl.settle();
    });
    const cancel = (e) => {
      if (!T.cancel(e.pointerId)) return;
      clearTimeout(liftTimer); liftTimer = 0;
      if (d) { endDrag(); const o = current(); if (o) place(o); travel(0); } // springs back
      else { unpress(); gl.settle(); }
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
      if (recs.every((x) => x.type === 'childList' && [...x.addedNodes, ...x.removedNodes].every((n) => n === thumb || n === lens))) return;
      later(() => position(true));
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: K.drag ? ['checked'] : ['aria-checked'] });
    const ro = G.ResizeObserver ? new G.ResizeObserver(() => { if (!d) position(false); }) : null;
    if (ro) ro.observe(root);
    // Moves animate from the frame after the first placement (it doesn't slide in).
    later(() => { position(false); G.requestAnimationFrame(() => root.setAttribute('data-ready', '')); });
    return () => {
      gone = true;
      offs.forEach((f) => f());
      mo.disconnect();
      if (ro) ro.disconnect();
      clearTimeout(liftTimer); clearTimeout(rescueTimer);
      if (endMove) endMove();
      if (spring) spring.stop();
      st.stop(); gl.stop();
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
