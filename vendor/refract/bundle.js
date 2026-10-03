/* @ds-bundle: {"format":4,"namespace":"Refract","components":[{"name":"Glass"},{"name":"Lens"},{"name":"GlassGroup"},{"name":"Button"},{"name":"Toolbar"},{"name":"Menu"},{"name":"Popover"},{"name":"TabBar"},{"name":"NavBar"},{"name":"Sidebar"},{"name":"SegmentedControl"},{"name":"PageDots"},{"name":"Switch"},{"name":"Slider"},{"name":"TextField"},{"name":"SearchField"},{"name":"Stepper"},{"name":"Checkbox"},{"name":"Dialog"},{"name":"Sheet"},{"name":"Toast"},{"name":"ActivityCapsule"},{"name":"Card"},{"name":"List"},{"name":"Avatar"},{"name":"Badge"},{"name":"Chip"},{"name":"Progress"},{"name":"Spinner"},{"name":"Skeleton"},{"name":"MediaControls"},{"name":"SpecularLight"},{"name":"Morph"},{"name":"ScrollEdge"},{"name":"Reveal"},{"name":"Droplets"}]} */
(() => {
  // src/js/core/env.js
  var hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  var mq = (q) => hasDOM && window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {
  }, removeEventListener() {
  } };
  var media = {
    motion: mq("(prefers-reduced-motion: reduce)"),
    transparency: mq("(prefers-reduced-transparency: reduce)"),
    contrast: mq("(prefers-contrast: more)"),
    dark: mq("(prefers-color-scheme: dark)"),
    coarse: mq("(pointer: coarse)"),
    hover: mq("(hover: hover)")
  };
  var rootData = () => hasDOM ? document.documentElement.dataset : {};
  var prefs = {
    get reducedMotion() {
      return media.motion.matches || rootData().rfMotion === "reduced";
    },
    get reducedTransparency() {
      return media.transparency.matches || rootData().rfTransparency === "reduced";
    },
    get contrast() {
      return media.contrast.matches || /contrast/.test(rootData().theme || "");
    }
  };
  function detectLens() {
    if (!hasDOM) return false;
    try {
      const brands = navigator.userAgentData && navigator.userAgentData.brands;
      if (brands && brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))) return true;
    } catch (e) {
    }
    const ua = navigator.userAgent || "";
    return /(Chrome|Chromium)\/\d+/.test(ua) && !/(CriOS|FxiOS|EdgiOS|Firefox)/.test(ua);
  }
  var supports = {
    // Only Chromium renders SVG filters inside backdrop-filter; everyone else gets blur + rim + specular.
    lens: detectLens(),
    backdrop: hasDOM && typeof CSS !== "undefined" && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)")),
    popover: hasDOM && typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype,
    scrollTimeline: hasDOM && typeof CSS !== "undefined" && CSS.supports("(animation-timeline: view()) and (animation-range: entry)"),
    viewTransition: hasDOM && "startViewTransition" in document,
    closedBy: hasDOM && typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype,
    linear: hasDOM && typeof CSS !== "undefined" && CSS.supports("transition-timing-function", "linear(0, 1)")
  };
  var _modality = "pointer";
  if (hasDOM) {
    document.addEventListener("pointerdown", () => {
      _modality = "pointer";
    }, true);
    document.addEventListener("keydown", (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) _modality = "keyboard";
    }, true);
  }
  var modality = () => _modality;
  var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  var _uid = 0;
  var uid = (p = "rf") => `${p}-${(++_uid).toString(36)}`;
  function cssVar(el, name, fallback) {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }
  function cssNumber(el, name, fallback) {
    const v = parseFloat(cssVar(el, name, ""));
    return Number.isFinite(v) ? v : fallback;
  }
  function cssMs(el, name, fallback) {
    const v = cssVar(el, name, "");
    if (!v) return fallback;
    const n = parseFloat(v);
    return /ms$/.test(v) ? n : /s$/.test(v) ? n * 1e3 : n;
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    return () => target.removeEventListener(type, fn, opts);
  }
  function emit(el, name, detail) {
    el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
  }
  var attached = /* @__PURE__ */ new WeakMap();
  function once(el, key, fn) {
    let set = attached.get(el);
    if (!set) {
      set = /* @__PURE__ */ new Map();
      attached.set(el, set);
    }
    if (set.has(key)) return set.get(key);
    const cleanup = fn() || (() => {
    });
    set.set(key, cleanup);
    return cleanup;
  }
  function detach(el, key) {
    const set = attached.get(el);
    if (!set) return;
    if (key) {
      const c = set.get(key);
      if (c) c();
      set.delete(key);
      return;
    }
    set.forEach((c) => c && c());
    set.clear();
  }
  function easing(name, fallback = "cubic-bezier(0.2, 0, 0, 1)") {
    if (!hasDOM) return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    if (!v) return fallback;
    if (/^linear\(/.test(v) && !supports.linear) return fallback;
    return v;
  }
  function duration(name, fallback = 300) {
    return hasDOM ? cssMs(document.documentElement, `--${name}`, fallback) : fallback;
  }
  function animate(el, keyframes, { spring = "spring-snappy", duration: d, easing: e, fill = "both", reduced, ...rest } = {}) {
    if (!el || !el.animate) return { finished: Promise.resolve(), cancel() {
    } };
    if (prefs.reducedMotion) {
      const frames = reduced || keyframes.map((k) => "opacity" in k ? { opacity: k.opacity } : {});
      return el.animate(frames, { duration: 120, easing: "linear", fill, ...rest });
    }
    return el.animate(keyframes, {
      duration: d ?? duration(`duration-${spring}`, 450),
      easing: e ?? easing(spring),
      fill,
      ...rest
    });
  }
  function raf(fn) {
    let id = 0;
    const run2 = (...args) => {
      if (id) return;
      id = requestAnimationFrame(() => {
        id = 0;
        fn(...args);
      });
    };
    run2.cancel = () => {
      cancelAnimationFrame(id);
      id = 0;
    };
    return run2;
  }
  function springValue({ value = 0, stiffness = 380, damping = 32, mass = 1, onUpdate, onRest } = {}) {
    let x = value, v = 0, target = value, id = 0, last = 0;
    const step = (t) => {
      const dt = Math.min(0.032, (t - last) / 1e3 || 0.016);
      last = t;
      const f = -stiffness * (x - target) - damping * v;
      v += f / mass * dt;
      x += v * dt;
      onUpdate && onUpdate(x, v);
      if (Math.abs(v) < 0.01 && Math.abs(x - target) < 1e-3) {
        x = target;
        v = 0;
        id = 0;
        onUpdate && onUpdate(x, 0);
        onRest && onRest(x);
        return;
      }
      id = requestAnimationFrame(step);
    };
    return {
      get value() {
        return x;
      },
      get velocity() {
        return v;
      },
      set(val) {
        cancelAnimationFrame(id);
        id = 0;
        x = target = val;
        v = 0;
        onUpdate && onUpdate(x, 0);
      },
      to(val, velocity) {
        target = val;
        if (velocity != null) v = velocity;
        if (prefs.reducedMotion) {
          this.set(val);
          onRest && onRest(val);
          return;
        }
        if (!id) {
          last = performance.now();
          id = requestAnimationFrame(step);
        }
      },
      stop() {
        cancelAnimationFrame(id);
        id = 0;
      }
    };
  }
  var refreshers = /* @__PURE__ */ new WeakMap();
  function setRefresh(el, fn) {
    refreshers.set(el, fn);
  }
  function refresh(el) {
    const f = refreshers.get(el);
    if (f) f();
  }

  // src/js/core/lens.js
  var NS = "http://www.w3.org/2000/svg";
  var defsEl = null;
  function defs() {
    if (defsEl && defsEl.isConnected) return defsEl;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("data-rf-defs", "");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    defsEl = document.createElementNS(NS, "defs");
    svg.appendChild(defsEl);
    defsEl.insertAdjacentHTML(
      "beforeend",
      '<filter id="rf-goo" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter><filter id="rf-goo-sm" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter>'
    );
    (document.body || document.documentElement).appendChild(svg);
    return defsEl;
  }
  var PROFILES = {
    squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
    circle: (x) => Math.sqrt(1 - Math.pow(1 - x, 2)),
    soft: (x) => {
      const t = x * x * (3 - 2 * x);
      return Math.pow(t, 0.6);
    }
  };
  var LUTS = {};
  function lut(profile = "squircle") {
    if (LUTS[profile]) return LUTS[profile];
    const f = PROFILES[profile] || PROFILES.squircle;
    const N = 256, n = 1.5, out = new Float32Array(N);
    let max = 0;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N;
      const dx = 0.5 / N;
      const slope = (f(Math.min(1, x + dx)) - f(Math.max(0, x - dx))) / (Math.min(1, x + dx) - Math.max(0, x - dx));
      const t1 = Math.atan(Math.max(0, slope));
      const t2 = Math.asin(Math.sin(t1) / n);
      const thickness = 0.35 + f(x);
      const d = Math.tan(t1 - t2) * thickness;
      out[i] = d;
      if (d > max) max = d;
    }
    for (let i = 0; i < N; i++) out[i] = max ? out[i] / max : 0;
    LUTS[profile] = out;
    return out;
  }
  // gh-patch(map-memo): a map depends only on its size, radius, bezel and profile, so each one is
  // encoded once and shared (a lens that rebuilds, or many controls of one size, reuse the PNG).
  var MAP_MEMO = /* @__PURE__ */ new Map();
  // gh-patch-end(map-memo)
  function mapURL(w, h, r, b, profile) {
    const s = Math.min(1, 520 / Math.max(w, h));
    const W = Math.max(2, Math.round(w * s)), H = Math.max(2, Math.round(h * s));
    const R = Math.min(r * s, W / 2, H / 2), B = Math.max(1, Math.min(b * s, Math.min(W, H) / 2));
    // gh-patch(map-memo-get)
    const memoKey = `${W},${H},${R},${B},${profile}`;
    if (MAP_MEMO.has(memoKey)) return MAP_MEMO.get(memoKey);
    // gh-patch-end(map-memo-get)
    const table = lut(profile);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const px2 = new Uint32Array(img.data.buffer);
    const little = new Uint8Array(new Uint32Array([168496141]).buffer)[0] === 13;
    const neutral = little ? 255 << 24 | 128 << 16 | 128 << 8 | 128 : 128 << 24 | 128 << 16 | 128 << 8 | 255;
    px2.fill(neutral >>> 0);
    const hw = W / 2, hh = H / 2;
    const put = (x, y) => {
      const cx2 = x + 0.5 - hw, cy = y + 0.5 - hh;
      const ax = Math.abs(cx2), ay = Math.abs(cy);
      const qx = ax - (hw - R), qy = ay - (hh - R);
      let d, nx, ny;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        d = R - len;
        nx = qx / len * Math.sign(cx2);
        ny = qy / len * Math.sign(cy);
      } else if (qx > qy) {
        d = hw - ax;
        nx = Math.sign(cx2);
        ny = 0;
      } else {
        d = hh - ay;
        nx = 0;
        ny = Math.sign(cy);
      }
      if (d < 0 || d >= B) return;
      const m = table[Math.min(table.length - 1, Math.floor(d / B * table.length))];
      const vx = -nx * m, vy = -ny * m;
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(128 + vx * 127);
      img.data[i + 1] = Math.round(128 + vy * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    };
    const band = Math.ceil(B) + 1;
    for (let y = 0; y < H; y++) {
      if (y < band || y >= H - band) {
        for (let x = 0; x < W; x++) put(x, y);
      } else {
        for (let x = 0; x < Math.min(W, band + Math.ceil(R)); x++) put(x, y);
        for (let x = Math.max(0, W - band - Math.ceil(R)); x < W; x++) put(x, y);
      }
    }
    ctx.putImageData(img, 0, 0);
    // gh-patch(map-memo-set)
    const url = canvas.toDataURL("image/png");
    MAP_MEMO.set(memoKey, url);
    if (MAP_MEMO.size > 64) MAP_MEMO.delete(MAP_MEMO.keys().next().value);
    return url;
    // gh-patch-end(map-memo-set)
  }
  function radiusOf(el, w, h) {
    const cs = getComputedStyle(el);
    const raw = cs.borderTopLeftRadius || "0px";
    let r = parseFloat(raw) || 0;
    if (/%/.test(raw)) r = r / 100 * Math.min(w, h);
    return Math.min(r, w / 2, h / 2);
  }
  function buildFilter(id, w, h, href, scale) {
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    f.setAttribute("width", String(w));
    f.setAttribute("height", String(h));
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("color-interpolation-filters", "sRGB");
    const im = document.createElementNS(NS, "feImage");
    im.setAttribute("href", href);
    im.setAttribute("x", "0");
    im.setAttribute("y", "0");
    im.setAttribute("width", String(w));
    im.setAttribute("height", String(h));
    im.setAttribute("preserveAspectRatio", "none");
    im.setAttribute("result", "map");
    const dm = document.createElementNS(NS, "feDisplacementMap");
    dm.setAttribute("in", "SourceGraphic");
    dm.setAttribute("in2", "map");
    dm.setAttribute("scale", String(scale));
    dm.setAttribute("xChannelSelector", "R");
    dm.setAttribute("yChannelSelector", "G");
    f.append(im, dm);
    return f;
  }
  function lens(el, opts = {}) {
    if (!supports.lens || !el) return () => {
    };
    return once(el, "lens", () => {
      const id = uid("rf-lens");
      let key = "";
      let filter = null;
      let layer2 = null;
      let frame2 = 0;
      let wait = 0;
      const update = () => {
        frame2 = 0;
        if (prefs.reducedTransparency) {
          off();
          return;
        }
        if (el.closest("[data-rf-resizing]") && filter) {
          const w2 = el.offsetWidth, h2 = el.offsetHeight;
          filter.setAttribute("width", String(w2));
          filter.setAttribute("height", String(h2));
          const im = filter.firstElementChild;
          if (im) {
            im.setAttribute("width", String(w2));
            im.setAttribute("height", String(h2));
          }
          key = "";
          clearTimeout(wait);
          wait = setTimeout(schedule2, 140);
          return;
        }
        const w = el.offsetWidth, h = el.offsetHeight;
        if (w < 4 || h < 4) return;
        const r = radiusOf(el, w, h);
        const bezelTok = opts.bezel ?? parseFloat(el.dataset.lensBezel) ?? NaN;
        const bezel = Number.isFinite(bezelTok) ? bezelTok : Math.min(cssNumber(el, "--lens-bezel", 18), Math.min(w, h) / 2);
        const depthTok = opts.depth ?? parseFloat(el.dataset.lensDepth);
        const baseDepth = Number.isFinite(depthTok) ? depthTok : cssNumber(el, "--lens-depth", 48);
        const strength = el.dataset.lens === "strong" ? 1.5 : el.dataset.lens === "soft" ? 0.6 : 1;
        const depth = Math.round(baseDepth * strength * Math.max(0.35, Math.min(1, Math.min(w, h) / 90)));
        const profile = opts.profile || el.dataset.lensProfile || "squircle";
        const k = `${w}x${h}:${r}:${bezel}:${depth}:${profile}`;
        if (k === key) return;
        key = k;
        const next = buildFilter(id, w, h, mapURL(w, h, r, bezel, profile), depth);
        const host = defs();
        if (filter && filter.parentNode) filter.replaceWith(next);
        else host.appendChild(next);
        filter = next;
        if (!layer2 || !layer2.isConnected) {
          layer2 = document.createElement("span");
          layer2.className = "rf-lens-layer";
          layer2.setAttribute("aria-hidden", "true");
          el.insertBefore(layer2, el.firstChild);
        }
        el.style.setProperty("--_lens", `url(#${id})`);
        el.setAttribute("data-lens-ready", "");
      };
      const off = () => {
        if (layer2) {
          layer2.remove();
          layer2 = null;
        }
        el.removeAttribute("data-lens-ready");
        el.style.removeProperty("--_lens");
        key = "";
      };
      const schedule2 = () => {
        if (!frame2) frame2 = requestAnimationFrame(update);
      };
      const ro = new ResizeObserver(schedule2);
      ro.observe(el);
      schedule2();
      // gh-patch(lens-pref): a preference change re-measures but keeps the key, so the map is only
      // rebuilt if the lens's size or shape changed (every Settings change fires one). Reduced
      // transparency still goes through off(), which clears the key.
      const onPref = () => {
        schedule2();
      };
      // gh-patch-end(lens-pref)
      document.addEventListener("rf:preferences", onPref);
      return () => {
        ro.disconnect();
        cancelAnimationFrame(frame2);
        clearTimeout(wait);
        document.removeEventListener("rf:preferences", onPref);
        off();
        if (filter) filter.remove();
      };
    });
  }
  function lensFilter(w, h, { radius = Math.min(w, h) / 2, bezel = Math.min(w, h) / 2, depth = 24, profile = "squircle" } = {}) {
    if (!supports.lens) return null;
    const id = uid("rf-lens");
    defs().appendChild(buildFilter(id, w, h, mapURL(w, h, radius, bezel, profile), depth));
    return { id, url: `url(#${id})`, remove() {
      const n = document.getElementById(id);
      if (n) n.remove();
    } };
  }

  // src/js/core/light.js
  var els = /* @__PURE__ */ new Set();
  var state = /* @__PURE__ */ new WeakMap();
  var pointer = null;
  var frame = 0;
  var mode = "pointer";
  var fixedAngle = 315;
  var orbitStart = 0;
  var installed = false;
  function shortest(from, to) {
    let d = (to - from + 540) % 360 - 180;
    return from + d;
  }
  function targetAngle(el, r) {
    if (mode === "fixed" || prefs.reducedMotion) return fixedAngle;
    if (mode === "orbit") {
      const t = (performance.now() - orbitStart) / 1e3;
      return (fixedAngle + t * 24) % 360;
    }
    if (mode === "tilt" && tilt) return tilt.angle;
    if (!pointer) return fixedAngle;
    const cx2 = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.atan2(pointer.x - cx2, -(pointer.y - cy)) * 180 / Math.PI;
  }
  function tick() {
    frame = 0;
    let moving = mode === "orbit" && !prefs.reducedMotion;
    const vh = window.innerHeight, vw = window.innerWidth;
    for (const el of els) {
      if (!el.isConnected) {
        els.delete(el);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom < -40 || r.top > vh + 40 || r.right < -40 || r.left > vw + 40) continue;
      const s = state.get(el) || { a: fixedAngle };
      const target = shortest(s.a, targetAngle(el, r));
      const next = s.a + (target - s.a) * 0.18;
      if (Math.abs(target - next) > 0.2) moving = true;
      s.a = Math.abs(target - next) <= 0.2 ? target : next;
      state.set(el, s);
      el.style.setProperty("--rf-light", `${s.a.toFixed(2)}deg`);
      if (pointer) {
        el.style.setProperty("--rf-lx", `${((pointer.x - r.left) / r.width * 100).toFixed(1)}%`);
        el.style.setProperty("--rf-ly", `${((pointer.y - r.top) / r.height * 100).toFixed(1)}%`);
      }
    }
    if (moving) schedule();
  }
  function schedule() {
    if (!frame && hasDOM) frame = requestAnimationFrame(tick);
  }
  var tilt = null;
  function onOrientation(e) {
    if (e.gamma == null || e.beta == null) return;
    const gx = Math.max(-45, Math.min(45, e.gamma));
    const by = Math.max(-45, Math.min(45, (e.beta || 0) - 40));
    tilt = { angle: Math.atan2(gx, -by - 20) * 180 / Math.PI };
    schedule();
  }
  function install() {
    if (installed || !hasDOM) return;
    installed = true;
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      pointer = { x: e.clientX, y: e.clientY };
      schedule();
    }, { passive: true });
    document.addEventListener("pointerleave", () => {
      pointer = null;
      schedule();
    });
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
  }
  var light = {
    register(el) {
      install();
      els.add(el);
      schedule();
      return () => els.delete(el);
    },
    /** 'pointer' (default), 'orbit' (slow ambient drift), 'fixed', or 'tilt' (device motion). */
    mode(next, angle) {
      mode = next || "pointer";
      if (angle != null) fixedAngle = angle;
      if (mode === "orbit") orbitStart = performance.now();
      if (mode === "tilt") light.requestTilt();
      schedule();
      return mode;
    },
    /** Point the light at a fixed angle (0 = from above, 90 = from the right). */
    angle(deg) {
      fixedAngle = deg;
      schedule();
    },
    /** iOS asks permission for motion; call from a user gesture. */
    async requestTilt() {
      try {
        const D = window.DeviceOrientationEvent;
        if (D && typeof D.requestPermission === "function") {
          const res = await D.requestPermission();
          if (res !== "granted") return false;
        }
        window.addEventListener("deviceorientation", onOrientation, { passive: true });
        mode = "tilt";
        return true;
      } catch (e) {
        return false;
      }
    },
    refresh: schedule
  };

  // src/js/core/motion.js
  var EASE = {
    enter: () => easing("ease-enter", "cubic-bezier(0.05, 0.7, 0.1, 1)"),
    exit: () => easing("ease-exit", "cubic-bezier(0.3, 0, 0.8, 0.15)"),
    standard: () => easing("ease-standard", "cubic-bezier(0.2, 0, 0, 1)")
  };
  var px = (n) => `${Math.round(n * 10) / 10}px`;
  var noop = { finished: Promise.resolve(), cancel() {
  }, finish() {
  }, playState: "finished" };
  var done = (a) => a && a.finished ? a.finished.then(() => {
  }, () => {
  }) : Promise.resolve();
  function run(el, keyframes, options) {
    if (!el || !el.animate) return noop;
    try {
      return el.animate(keyframes, options);
    } catch (e) {
      return noop;
    }
  }
  var live = /* @__PURE__ */ new WeakMap();
  function keep(owner, anim) {
    if (!anim || anim === noop) return anim;
    const list = live.get(owner) || [];
    list.push(anim);
    live.set(owner, list);
    return anim;
  }
  function settle(el, props) {
    const list = el && live.get(el);
    if (!list) return null;
    let snap = null;
    if (props && list.some((a) => a.playState === "running")) {
      const cs = getComputedStyle(el);
      snap = {};
      props.forEach((p) => {
        snap[p] = cs.getPropertyValue(p).trim();
      });
    }
    list.forEach((a) => {
      try {
        a.cancel();
      } catch (e) {
      }
    });
    live.delete(el);
    return snap;
  }
  function radiusOf2(el, box = el.getBoundingClientRect()) {
    const raw = getComputedStyle(el).borderTopLeftRadius || "0px";
    let r = parseFloat(raw) || 0;
    if (/%/.test(raw)) r = r / 100 * Math.min(box.width, box.height);
    return Math.max(0, Math.min(r, box.width / 2, box.height / 2));
  }
  function scaleRect(r, k, ox = 0.5, oy = 0.5) {
    const w = r.width * k, h = r.height * k;
    return { left: r.left + (r.width - w) * ox, top: r.top + (r.height - h) * oy, width: w, height: h };
  }
  var REST = "translate(0px, 0px) scale(1)";
  var fullClip = (r, m = 0) => `inset(${px(-m)} round ${px(r + m)})`;
  function shapeFrom(S, F2, rf, s0) {
    const w0 = Math.min(S.width, F2.width / s0), h0 = Math.min(S.height, F2.height / s0);
    const fx = F2.left + F2.width / 2 - S.left, fy = F2.top + F2.height / 2 - S.top;
    const cx2 = clamp(fx, w0 / 2, S.width - w0 / 2), cy = clamp(fy, h0 / 2, S.height - h0 / 2);
    const r = Math.min(rf / s0, w0 / 2, h0 / 2);
    return {
      clip: `inset(${px(cy - h0 / 2)} ${px(S.width - cx2 - w0 / 2)} ${px(S.height - cy - h0 / 2)} ${px(cx2 - w0 / 2)} round ${px(r)})`,
      origin: `${px(cx2)} ${px(cy)}`,
      transform: `translate(${px(fx - cx2)}, ${px(fy - cy)}) scale(${s0})`,
      // content settles in from the side the surface grew from
      toward: fy > S.height * 0.6 ? 1 : -1
    };
  }
  function sourceOf(el, S, from, opts) {
    if (from && from.getBoundingClientRect) {
      const F2 = from.getBoundingClientRect();
      return { src: from, F: F2, rf: radiusOf2(from, F2) };
    }
    if (from && "width" in from) return { src: null, F: from, rf: opts.radius ?? Math.min(from.width, from.height) / 2 };
    const [ox, oy] = opts.origin || [0.5, 0.5];
    return { src: null, F: scaleRect(S, 0.72, ox, oy), rf: radiusOf2(el, S) * 0.72 };
  }
  var COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[\da-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi;
  function shadows(el) {
    const v = getComputedStyle(el).boxShadow;
    if (!v || v === "none") return [];
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of v) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && !depth) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    return parts.map((raw) => {
      const geo = raw.replace(COLOR, " ").replace(/\s+/g, " ").trim();
      const n = (geo.match(/-?[\d.]+px/g) || []).map(parseFloat);
      return {
        raw: raw.trim(),
        geo: geo.replace(/\binset\b/, "").trim(),
        inset: /\binset\b/.test(geo),
        reach: Math.abs(n[0] || 0) + Math.abs(n[1] || 0) + (n[2] || 0) + Math.max(0, n[3] || 0)
      };
    });
  }
  function shadowWith(list, { inset = false, outer = false } = {}) {
    if (!list.length) return "none";
    return list.map((s) => (s.inset ? inset : outer) ? s.raw : `${s.inset ? "inset " : ""}${s.geo} rgba(0, 0, 0, 0)`).join(", ");
  }
  var reachOf = (list) => list.reduce((m, s) => s.inset ? m : Math.max(m, s.reach), 0);
  function contentOf(el) {
    const out = [];
    for (const k of el.children) {
      if (k.classList.contains("rf-lens-layer") || k.classList.contains("rf-ghost") || k.hidden || /^(SCRIPT|TEMPLATE|STYLE)$/.test(k.tagName) || k.hasAttribute("data-rf-still")) continue;
      if (k.matches('[role="group"], [data-rf-stagger]') && k.children.length) out.push(...Array.from(k.children).filter((c) => !c.hidden));
      else out.push(k);
    }
    return out;
  }
  function materialize(el, opts = {}) {
    if (!hasDOM || !el || !el.animate) return Promise.resolve();
    const { from = null, scale: s0 = 0.9, hideSource = false, content = true, delay = 0 } = opts;
    settle(el);
    const S = opts.rect || el.getBoundingClientRect();
    const { src, F: F2, rf } = sourceOf(el, S, from, opts);
    el._rfShape = { from, scale: s0, hideSource: !!(src && hideSource), radius: opts.radius, origin: opts.origin };
    if (prefs.reducedMotion) {
      const a = keep(el, run(el, [{ opacity: 0, "--rf-mat": 0 }, { opacity: 1, "--rf-mat": 1 }], { duration: 160, delay, easing: "linear", fill: "backwards" }));
      if (src && hideSource) keep(el, run(src, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay, fill: "forwards" }));
      return done(a);
    }
    const D = opts.duration || 620;
    const sr = radiusOf2(el, S);
    const shape = shapeFrom(S, F2, rf, s0);
    const list = shadows(el);
    const room = Math.ceil(reachOf(list)) + 4;
    keep(el, run(el, [
      { clipPath: shape.clip, easing: easing("spring-snappy") },
      { clipPath: fullClip(sr), offset: 0.76, easing: EASE.standard() },
      { clipPath: fullClip(sr, room) }
    ], { duration: D, delay, easing: "linear", fill: "backwards" }));
    const main = keep(el, run(el, [
      { transform: shape.transform, transformOrigin: shape.origin },
      { transform: REST, transformOrigin: shape.origin }
    ], { duration: duration("duration-spring-bouncy", 680), delay, easing: easing("spring-bouncy"), fill: "backwards" }));
    keep(el, run(el, [{ "--rf-mat": 0 }, { "--rf-mat": 1 }], { duration: D * 0.72, delay, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)", fill: "backwards" }));
    keep(el, run(el, [{ "--rf-sweep": "-120deg" }, { "--rf-sweep": "0deg" }], { duration: D + 260, delay, easing: EASE.enter(), fill: "backwards" }));
    keep(el, run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 90, delay, easing: "linear", fill: "backwards" }));
    if (list.length) {
      keep(el, run(el, [
        { boxShadow: shadowWith(list) },
        { boxShadow: shadowWith(list, { inset: true }), offset: 0.3 },
        { boxShadow: shadowWith(list, { inset: true }), offset: 0.7 },
        { boxShadow: shadowWith(list, { inset: true, outer: true }) }
      ], { duration: D, delay, easing: "linear", fill: "backwards" }));
    }
    if (content) {
      const kids = contentOf(el);
      const order = shape.toward > 0 ? kids.reverse() : kids;
      order.forEach((k, i) => {
        const at = delay + 60 + Math.min(i, 8) * 26;
        keep(el, run(k, [{ opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 340, delay: at, easing: EASE.enter(), fill: "backwards" }));
        keep(el, run(k, [
          { transform: `translateY(${shape.toward * 10}px) scale(0.94)` },
          { transform: "translateY(0px) scale(1)" }
        ], { duration: duration("duration-spring-bouncy", 680), delay: at, easing: easing("spring-bouncy"), fill: "backwards" }));
      });
    }
    if (opts.wobble) keep(el, jiggle(el, { angle: 90, amount: opts.wobble, duration: 760, delay: delay + 150 }));
    if (src && hideSource) {
      keep(el, run(src, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.06)" }], { duration: 160, delay, easing: EASE.standard(), fill: "forwards" }));
    }
    return done(main);
  }
  function dematerialize(el, opts = {}) {
    if (!hasDOM || !el || !el.animate) return Promise.resolve();
    const prev = el._rfShape || {};
    const to = "to" in opts ? opts.to : prev.from || null;
    const s0 = opts.scale || prev.scale || 0.9;
    const showSource = "showSource" in opts ? opts.showSource : !!prev.hideSource;
    const snap = settle(el, ["clip-path", "transform", "--rf-mat", "opacity"]);
    const S = opts.rect || el.getBoundingClientRect();
    const { src, F: F2, rf } = sourceOf(el, S, to, { radius: prev.radius, origin: prev.origin, ...opts });
    if (prefs.reducedMotion) {
      const a = keep(el, run(el, [{ opacity: snap ? snap.opacity : 1 }, { opacity: 0 }], { duration: 140, easing: "linear", fill: "forwards" }));
      if (src && showSource) keep(el, run(src, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, fill: "backwards" }));
      return done(a);
    }
    const D = opts.duration || 420;
    const smooth = easing("spring-smooth");
    const sr = radiusOf2(el, S);
    const shape = shapeFrom(S, F2, rf, s0);
    const list = shadows(el);
    const room = Math.ceil(reachOf(list)) + 4;
    const clipNow = snap && snap["clip-path"] && snap["clip-path"] !== "none" ? snap["clip-path"] : null;
    const widened = !clipNow || /-\d/.test(clipNow);
    keep(el, run(
      el,
      widened ? [{ clipPath: clipNow || fullClip(sr, room), easing: "linear" }, { clipPath: fullClip(sr), offset: 0.08, easing: smooth }, { clipPath: shape.clip }] : [{ clipPath: clipNow, easing: smooth }, { clipPath: shape.clip }],
      { duration: D, easing: "linear", fill: "forwards" }
    ));
    const main = keep(el, run(el, [
      { transform: snap && snap.transform && snap.transform !== "none" ? snap.transform : REST, transformOrigin: shape.origin },
      { transform: shape.transform, transformOrigin: shape.origin }
    ], { duration: D, easing: smooth, fill: "forwards" }));
    const mat = snap && snap["--rf-mat"] !== "" ? parseFloat(snap["--rf-mat"]) : 1;
    keep(el, run(el, [{ "--rf-mat": Number.isFinite(mat) ? mat : 1, "--rf-sweep": "0deg" }, { "--rf-mat": 0, "--rf-sweep": "70deg" }], { duration: D, easing: "cubic-bezier(0.45, 0, 0.9, 0.55)", fill: "forwards" }));
    keep(el, run(el, [{ opacity: 1 }, { opacity: 1, offset: 0.62 }, { opacity: 0 }], { duration: D, easing: "linear", fill: "forwards" }));
    if (list.length) {
      keep(el, run(el, [
        { boxShadow: shadowWith(list, { inset: true, outer: true }) },
        { boxShadow: shadowWith(list, { inset: true }), offset: 0.1 },
        { boxShadow: shadowWith(list) }
      ], { duration: D, easing: "linear", fill: "forwards" }));
    }
    if (opts.content !== false) {
      contentOf(el).forEach((k) => keep(el, run(k, [
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0px) scale(1)" },
        { opacity: 0, filter: "blur(4px)", transform: `translateY(${shape.toward * 4}px) scale(0.98)` }
      ], { duration: 130, easing: EASE.exit(), fill: "forwards" })));
    }
    if (src && showSource) {
      keep(el, run(src, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: D * 0.42, easing: "linear", fill: "backwards" }));
      keep(el, run(src, [{ transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: duration("duration-spring-gel", 610), delay: D * 0.42, easing: easing("spring-gel"), fill: "backwards" }));
    }
    return done(main);
  }
  function sweep(el, { from = -100, to = 0, duration: d = 900 } = {}) {
    if (!el || prefs.reducedMotion) return noop;
    return run(el, [{ "--rf-sweep": `${from}deg` }, { "--rf-sweep": `${to}deg` }], { duration: d, easing: EASE.enter() });
  }
  function jiggle(el, { angle = 90, amount = 0.06, duration: d = 640, freq = 2.4, delay = 0, impact = false } = {}) {
    if (!el || !el.animate || prefs.reducedMotion || !amount) return noop;
    const T = d / 1e3, decay = 3.6 / T, N = 22, frames = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N * T, w = 2 * Math.PI * freq * t;
      const k = i === N ? 0 : amount * Math.exp(-decay * t) * (impact ? -Math.cos(w) : Math.sin(w));
      frames.push({ transform: `rotate(${angle}deg) scale(${(1 + k).toFixed(4)}, ${(1 - k * 0.85).toFixed(4)}) rotate(${-angle}deg)` });
    }
    return run(el, frames, { duration: d, delay, easing: "linear", composite: "add" });
  }
  function wiggle(el, { deg = 10, duration: d = 620, freq = 3, delay = 0 } = {}) {
    if (!el || !el.animate || prefs.reducedMotion || !deg) return noop;
    const T = d / 1e3, decay = 3.8 / T, N = 20, frames = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N * T;
      const a = i === N ? 0 : deg * Math.exp(-decay * t) * Math.sin(2 * Math.PI * freq * t);
      frames.push({ transform: `rotate(${a.toFixed(2)}deg)` });
    }
    return run(el, frames, { duration: d, delay, easing: "linear", composite: "add" });
  }
  var layer = null;
  function burstLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.className = "rf-burst-layer";
    layer.setAttribute("aria-hidden", "true");
    if (supports.popover) layer.setAttribute("popover", "manual");
    document.body.appendChild(layer);
    return layer;
  }
  function raise(l) {
    if (!l.hasAttribute("popover")) return;
    try {
      if (l.matches(":popover-open")) l.hidePopover();
      l.showPopover();
    } catch (e) {
    }
  }
  var HUES = ["--accent-fill", "--hue-sky", "--hue-violet", "--hue-rose", "--hue-amber", "--hue-teal", "--hue-coral", "--hue-green"];
  function paletteOf(el, hue) {
    const cs = getComputedStyle(el);
    const read = (n) => cs.getPropertyValue(n).trim();
    if (hue) {
      const c = read(`--hue-${hue}`) || read(`--${hue}`) || hue;
      return [c, c, `color-mix(in oklab, ${c} 70%, white)`];
    }
    const own = read("--_burst");
    const spectrum = HUES.map(read).filter(Boolean);
    return own ? [own, `color-mix(in oklab, ${own} 65%, white)`, own, ...spectrum.slice(1, 5)] : spectrum;
  }
  function burst(el, { count = 12, hue, colors, size = [6, 11], spread = 1, gravity = 1, ring = true, x, y, arc } = {}) {
    if (!hasDOM || !el || prefs.reducedMotion) return;
    const r = el.getBoundingClientRect();
    const cx2 = x ?? r.left + r.width / 2, cy = y ?? r.top + r.height / 2;
    const L = burstLayer();
    raise(L);
    const pal = colors || paletteOf(el, hue);
    const reach = clamp(Math.max(r.width, r.height) * 0.95, 30, 96) * spread;
    for (let i = 0; i < count; i++) {
      const b = document.createElement("i");
      b.className = "rf-bead";
      const sz = size[0] + Math.random() * (size[1] - size[0]);
      b.style.cssText = `left:${cx2}px;top:${cy}px;width:${sz.toFixed(1)}px;height:${sz.toFixed(1)}px;margin:${(-sz / 2).toFixed(1)}px 0 0 ${(-sz / 2).toFixed(1)}px;--_c:${pal[i % pal.length]}`;
      L.appendChild(b);
      const a = arc ? (arc[0] + (i + 0.5) / count * (arc[1] - arc[0])) * Math.PI / 180 + (Math.random() - 0.5) * 0.35 : i / count * Math.PI * 2 + (Math.random() - 0.5) * 0.7 - Math.PI / 2;
      const dist = reach * (0.55 + Math.random() * 0.65);
      const vx = Math.cos(a) * dist, vy = Math.sin(a) * dist, fall = 110 * gravity;
      const frames = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, e = 1 - Math.pow(1 - t, 2.4);
        const sc = t < 0.12 ? 0.35 + t / 0.12 * 0.65 : 1 - (t - 0.12) * 0.75;
        frames.push({
          transform: `translate(${(vx * e).toFixed(1)}px, ${(vy * e + fall * t * t).toFixed(1)}px) scale(${sc.toFixed(3)})`,
          opacity: t < 0.72 ? 1 : +(1 - (t - 0.72) / 0.28).toFixed(3)
        });
      }
      run(b, frames, { duration: 640 + Math.random() * 300, easing: "linear", fill: "forwards" }).finished.then(() => b.remove(), () => b.remove());
    }
    if (ring) {
      const o = document.createElement("i");
      o.className = "rf-bead-ring";
      const s = Math.max(r.width, r.height) * 1.25 * spread;
      o.style.cssText = `left:${cx2}px;top:${cy}px;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;margin:${(-s / 2).toFixed(1)}px 0 0 ${(-s / 2).toFixed(1)}px;--_c:${pal[0]}`;
      L.appendChild(o);
      run(o, [{ transform: "scale(0.35)", opacity: 0.85 }, { transform: "scale(1.2)", opacity: 0 }], { duration: 540, easing: "cubic-bezier(0.1, 0.7, 0.2, 1)", fill: "forwards" }).finished.then(() => o.remove(), () => o.remove());
    }
    clearTimeout(L._rfIdle);
    L._rfIdle = setTimeout(() => {
      if (!L.childElementCount && L.hasAttribute("popover")) {
        try {
          L.hidePopover();
        } catch (e) {
        }
      }
    }, 1200);
  }
  function layoutBox(e) {
    const p = e.offsetParent;
    const pr = p ? p.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: pr.left + e.offsetLeft, y: pr.top + e.offsetTop, w: e.offsetWidth, h: e.offsetHeight, p };
  }
  function flip(targets, mutate, { spring = "spring-snappy", scale = false } = {}) {
    const els2 = Array.from(targets || []).filter((e) => e && e.isConnected);
    const first = new Map(els2.map((e) => [e, layoutBox(e)]));
    if (mutate) mutate();
    if (prefs.reducedMotion) return Promise.resolve();
    const anims = [];
    first.forEach((a, e) => {
      if (!e.isConnected) return;
      const b = layoutBox(e);
      if (a.p !== b.p) return;
      const dx = a.x - b.x, dy = a.y - b.y;
      const sx = scale && b.w ? a.w / b.w : 1, sy = scale && b.h ? a.h / b.h : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 4e-3 && Math.abs(sy - 1) < 4e-3) return;
      anims.push(run(e, [
        { transform: `translate(${px(dx)}, ${px(dy)}) scale(${sx}, ${sy})`, transformOrigin: "0 0" },
        { transform: "translate(0px, 0px) scale(1, 1)", transformOrigin: "0 0" }
      ], { duration: duration(`duration-${spring}`, 460), easing: easing(spring), composite: "add" }));
    });
    return Promise.all(anims.map(done)).then(() => {
    });
  }
  function stagger(nodes, keyframes, { each = 24, max = 180, delay = 0, ...rest } = {}) {
    return Array.from(nodes || []).map((n, i) => animate(n, keyframes, { fill: "backwards", ...rest, delay: delay + Math.min(i * each, max) }));
  }
  function ghostOf(el, html) {
    if (getComputedStyle(el).position === "static") return null;
    const g = document.createElement("span");
    g.className = "rf-ghost";
    g.setAttribute("aria-hidden", "true");
    g.innerHTML = html;
    g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    el.appendChild(g);
    return g;
  }
  var boxFrames = (w, pad, gap) => ({ boxSizing: "border-box", width: px(w), minWidth: "0px", paddingLeft: px(pad[0]), paddingRight: px(pad[1]), marginInlineEnd: px(gap), flexGrow: 0, flexShrink: 0, flexBasis: "auto", overflow: "clip" });
  var bodyOf = (el) => Array.from(el.children).filter((c) => !c.matches(".rf-ghost, .rf-lens-layer"));
  var padsOf = (el) => {
    const cs = getComputedStyle(el);
    return [parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0];
  };
  var gapOf = (el) => el.parentElement ? parseFloat(getComputedStyle(el.parentElement).columnGap) || 0 : 0;
  var shifting = /* @__PURE__ */ new WeakMap();
  function restart(k, list) {
    (shifting.get(k) || []).forEach((a) => a.cancel());
    shifting.set(k, list.filter(Boolean));
  }
  function shapeshift(root, update, { spring = "spring-smooth" } = {}) {
    if (!root) return Promise.resolve();
    const keyed = () => Array.from(root.querySelectorAll("[data-rf-key]"));
    const shown = (k) => k.isConnected && !k.hidden && getComputedStyle(k).display !== "none";
    const before = new Map(keyed().map((k) => [k, {
      shown: shown(k),
      w: k.offsetWidth,
      pad: padsOf(k),
      gap: gapOf(k),
      html: k.innerHTML,
      parent: k.parentElement,
      next: k.nextSibling
    }]));
    update();
    const after = keyed();
    if (prefs.reducedMotion || !root.animate) {
      after.forEach((k) => {
        if (k._rfGhost) {
          k._rfGhost.remove();
          k._rfGhost = null;
        }
      });
      return Promise.resolve();
    }
    const D = duration(`duration-${spring}`, 640), ease = easing(spring);
    const anims = [];
    root.setAttribute("data-rf-resizing", "");
    const leave = (k, a) => {
      const g = k.cloneNode(true);
      g.removeAttribute("id");
      g.removeAttribute("data-rf-key");
      g.querySelectorAll("[id], [data-rf-key]").forEach((n) => {
        n.removeAttribute("id");
        n.removeAttribute("data-rf-key");
      });
      g.hidden = false;
      g.inert = true;
      g.setAttribute("aria-hidden", "true");
      g.setAttribute("data-rf-leaving", "");
      if (k.isConnected) k.after(g);
      else if (a.parent && a.parent.isConnected) a.parent.insertBefore(g, a.next && a.next.parentNode === a.parent ? a.next : null);
      else return;
      if (k._rfGhost) k._rfGhost.remove();
      k._rfGhost = g;
      restart(k, []);
      const w = run(g, [boxFrames(a.w, a.pad, 0), boxFrames(0, [0, 0], -a.gap)], { duration: D, easing: ease, fill: "forwards" });
      run(g, [{ opacity: 1, filter: "blur(0px)", transform: "scale(1)" }, { opacity: 0, filter: "blur(8px)", transform: "scale(0.5)" }], { duration: 220, easing: EASE.exit(), fill: "forwards" });
      anims.push(w);
      done(w).then(() => {
        g.remove();
        if (k._rfGhost === g) k._rfGhost = null;
      });
    };
    const enter = (k) => {
      const gap = gapOf(k), pad = padsOf(k), g = k._rfGhost;
      let from = boxFrames(0, [0, 0], -gap), fade = { opacity: 0, filter: "blur(8px)", transform: "scale(0.5)" };
      if (g && g.isConnected) {
        const cs = getComputedStyle(g);
        from = boxFrames(g.offsetWidth, [parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0], parseFloat(cs.marginInlineEnd) || 0);
        fade = { opacity: parseFloat(cs.opacity), filter: cs.filter === "none" ? "blur(0px)" : cs.filter, transform: cs.transform === "none" ? "scale(1)" : cs.transform };
        g.remove();
        k._rfGhost = null;
      }
      const w = run(k, [from, boxFrames(k.offsetWidth, pad, 0)], { duration: D, easing: ease });
      restart(k, [w, run(k, [fade, { opacity: 1, filter: "blur(0px)", transform: "scale(1)" }], { duration: duration("duration-spring-bouncy", 680), easing: easing("spring-bouncy") })]);
      anims.push(w);
    };
    before.forEach((a, k) => {
      if (a.shown && !shown(k)) leave(k, a);
    });
    after.forEach((k) => {
      const a = before.get(k) || { shown: false };
      const now = shown(k);
      if (!a.shown && now) enter(k);
      else if (now && (a.html !== k.innerHTML || Math.abs(a.w - k.offsetWidth) > 0.5)) {
        const list = [];
        if (Math.abs(a.w - k.offsetWidth) > 0.5) list.push(run(k, [boxFrames(a.w, a.pad, 0), boxFrames(k.offsetWidth, padsOf(k), 0)], { duration: D, easing: ease }));
        if (a.html !== k.innerHTML) {
          k.querySelectorAll(":scope > .rf-ghost").forEach((n) => n.remove());
          const g = ghostOf(k, a.html);
          if (g) done(run(g, [{ opacity: 1, filter: "blur(0px)", transform: "scale(1)" }, { opacity: 0, filter: "blur(6px)", transform: "scale(0.8)" }], { duration: 220, easing: EASE.exit(), fill: "forwards" })).then(() => g.remove());
          bodyOf(k).forEach((c) => run(c, [{ opacity: 0, filter: "blur(6px)", transform: "scale(0.8)" }, { opacity: 1, filter: "blur(0px)", transform: "scale(1)" }], { duration: 340, delay: 60, easing: EASE.enter(), fill: "backwards" }));
        }
        restart(k, list);
        anims.push(...list);
      }
    });
    const token = root._rfShift = {};
    return Promise.all(anims.map(done)).then(() => {
      if (root._rfShift === token) root.removeAttribute("data-rf-resizing");
    });
  }
  function roll(el, value, { dir, from } = {}) {
    if (!el) return;
    const next = String(value);
    const isInput = el.tagName === "INPUT";
    const prev = from != null ? String(from) : isInput ? el.value : el.textContent.trim();
    if (prev === next) return;
    const d = dir || (parseFloat(next) < parseFloat(prev) ? -1 : 1);
    if (isInput) {
      if (el.value !== next) el.value = next;
    } else el.textContent = next;
    if (el.classList.contains("rf-badge")) {
      bump(el);
      wiggle(el, { deg: d > 0 ? 12 : -8, duration: 560 });
    }
    if (prefs.reducedMotion || !el.animate) return;
    const host = isInput ? el.parentElement : el;
    if (!host) return;
    let target = el;
    if (!isInput) {
      target = document.createElement("span");
      target.className = "rf-roll";
      target.textContent = next;
      el.textContent = "";
      el.appendChild(target);
    }
    const g = document.createElement("span");
    g.className = "rf-ghost";
    g.setAttribute("aria-hidden", "true");
    g.textContent = prev;
    if (isInput) {
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      const cs = getComputedStyle(el);
      Object.assign(g.style, { inset: "auto", left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`, font: cs.font, color: cs.color, letterSpacing: cs.letterSpacing });
    } else if (getComputedStyle(el).position === "static") el.style.position = "relative";
    host.appendChild(g);
    done(run(g, [
      { transform: "translateY(0%)", opacity: 1, filter: "blur(0px)" },
      { transform: `translateY(${-d * 70}%)`, opacity: 0, filter: "blur(2px)" }
    ], { duration: 240, easing: EASE.exit(), fill: "forwards" })).then(() => g.remove());
    run(target, [{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: 200, easing: EASE.enter() });
    done(run(target, [
      { transform: `translateY(${d * 70}%) scale(0.9)` },
      { transform: "translateY(0%) scale(1)" }
    ], { duration: duration("duration-spring-bouncy", 680), easing: easing("spring-bouncy") })).then(() => {
      if (!isInput && target.isConnected && el.textContent === next) el.textContent = next;
    });
  }
  function bump(el) {
    if (!el || prefs.reducedMotion) return;
    el.removeAttribute("data-bump");
    void el.offsetWidth;
    el.setAttribute("data-bump", "");
    const off = () => {
      el.removeAttribute("data-bump");
      el.removeEventListener("animationend", off);
    };
    el.addEventListener("animationend", off);
  }
  function autoplay(step, { root, every = 3400, delay = 1800 } = {}) {
    const forced = hasDOM && window.RF_AUTOPLAY === true;
    if (!hasDOM || typeof step !== "function" || !forced && (prefs.reducedMotion || navigator.webdriver)) return () => {
    };
    const target = root || document.documentElement;
    const types = ["pointerdown", "keydown", "wheel", "touchstart"];
    let i = 0, timer = 0, visible = false, stopped = false;
    const plan = (ms) => {
      if (!timer && !stopped) timer = setTimeout(tick2, ms);
    };
    function tick2() {
      timer = 0;
      if (stopped || !visible || document.hidden) return;
      try {
        step(i++);
      } catch (e) {
        stop();
        return;
      }
      plan(every);
    }
    const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      visible = entries.some((en) => en.isIntersecting);
      if (visible) plan(i ? every : delay);
    }) : null;
    if (io) io.observe(target);
    else {
      visible = true;
      plan(delay);
    }
    const onVis = () => {
      if (!document.hidden && visible) plan(every);
    };
    document.addEventListener("visibilitychange", onVis);
    function stop() {
      stopped = true;
      clearTimeout(timer);
      if (io) io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      types.forEach((t) => document.removeEventListener(t, onInput, true));
    }
    function onInput(e) {
      if (e.isTrusted) stop();
    }
    types.forEach((t) => document.addEventListener(t, onInput, true));
    return stop;
  }
  var motion = { materialize, dematerialize, settle, sweep, flip, stagger, shapeshift, roll, bump, autoplay, jiggle, wiggle, burst, radiusOf: radiusOf2 };

  // src/js/core/press.js
  var SELECTOR = ".rf-glass:is(button, a[href], [data-interactive]), [data-rf-press]";
  var PROPS = ["--_pull-x", "--_pull-y", "--_flex-x", "--_flex-y"];
  var installed2 = false;
  function point(el, x, y, r = el.getBoundingClientRect()) {
    el.style.setProperty("--rf-px", `${((x - r.left) / r.width * 100).toFixed(1)}%`);
    el.style.setProperty("--rf-py", `${((y - r.top) / r.height * 100).toFixed(1)}%`);
  }
  function liftFor(r) {
    return clamp(6 / Math.sqrt(Math.max(1, r.width * r.height)), 0.025, 0.14);
  }
  function lift(el, r) {
    const l = liftFor(r);
    el.style.setProperty("--_lift", l.toFixed(3));
    return l;
  }
  function flex(el, r, x0, y0, x, y) {
    const nx = clamp((x - x0) / Math.max(24, r.width / 2), -1.4, 1.4);
    const ny = clamp((y - y0) / Math.max(24, r.height / 2), -1.4, 1.4);
    const ax = Math.abs(nx), ay = Math.abs(ny);
    el.style.setProperty("--_pull-x", (nx * Math.min(7, r.width * 0.06)).toFixed(2));
    el.style.setProperty("--_pull-y", (ny * Math.min(6, r.height * 0.08)).toFixed(2));
    el.style.setProperty("--_flex-x", (0.045 * ax - 0.022 * ay).toFixed(4));
    el.style.setProperty("--_flex-y", (0.045 * ay - 0.022 * ax).toFixed(4));
  }
  function neighbours(el) {
    const group2 = el.closest(".rf-glass-group, .rf-toolbar, .rf-tabbar");
    if (!group2) return [];
    return Array.from(group2.querySelectorAll(".rf-glass")).filter((n) => n !== el && !n.contains(el) && !el.contains(n));
  }
  function release(el) {
    el.removeAttribute("data-pressed");
    PROPS.forEach((p) => el.style.removeProperty(p));
    neighbours(el).forEach((n) => n.removeAttribute("data-glow"));
  }
  function pop(el, from = 0.8, spring = "spring-bouncy") {
    animate(el, [{ transform: `scale(${from})` }, { transform: "scale(1)" }], { spring, fill: "none", composite: "add", reduced: [{}, {}] });
  }
  var MAGNET_MAX = 72;
  function magnet(el) {
    if (el._rfMagnet) return;
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height) return;
    const small = Math.min(r0.width, r0.height) <= MAGNET_MAX;
    const reach = small ? clamp(Math.min(r0.width, r0.height) * 0.09, 1.5, 4) : 0;
    el._rfMagnet = true;
    el.setAttribute("data-magnet", small ? "lean" : "light");
    const move = raf((e) => {
      const r = el.getBoundingClientRect();
      const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      const ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
      if (!el.hasAttribute("data-pressed")) point(el, e.clientX, e.clientY, r);
      el.style.setProperty("--_mx", (nx * reach).toFixed(2));
      el.style.setProperty("--_my", (ny * reach * 0.8).toFixed(2));
    });
    const leave = () => {
      move.cancel();
      el._rfMagnet = false;
      el.removeAttribute("data-magnet");
      el.style.removeProperty("--_mx");
      el.style.removeProperty("--_my");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
  }
  function installPress() {
    if (installed2 || !hasDOM) return;
    installed2 = true;
    const fine = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : { matches: false };
    document.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse" || !fine.matches || prefs.reducedMotion) return;
      const el = e.target.closest && e.target.closest(SELECTOR);
      if (el && !el.matches(':disabled, [aria-disabled="true"]')) magnet(el);
    }, true);
    document.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      const el = e.target.closest && e.target.closest(SELECTOR);
      if (!el || el.matches(':disabled, [aria-disabled="true"]')) return;
      const r = el.getBoundingClientRect();
      point(el, e.clientX, e.clientY, r);
      const l = lift(el, r);
      el.setAttribute("data-pressed", "");
      neighbours(el).forEach((n) => {
        point(n, e.clientX, e.clientY);
        n.setAttribute("data-glow", "");
      });
      const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
      let x1 = x0, y1 = y0;
      const move = raf((ev) => {
        x1 = ev.clientX;
        y1 = ev.clientY;
        if (el.hasAttribute("data-pressed")) flex(el, r, x0, y0, x1, y1);
      });
      const up = (ev) => {
        move.cancel();
        release(el);
        if (ev.type === "pointerup" && l > 0.05) {
          const dx = x1 - x0, dy = y1 - y0, pulled = Math.hypot(dx, dy) > 6;
          const angle = pulled ? Math.atan2(dy, dx) * 180 / Math.PI : 90;
          const held = performance.now() - t0;
          jiggle(el, { angle, amount: clamp(l * (held > 350 ? 0.5 : 0.4), 0.02, 0.06), duration: 620 });
        }
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const el = e.target.closest && e.target.closest(SELECTOR);
      if (!el || e.repeat) return;
      el.style.setProperty("--rf-px", "50%");
      el.style.setProperty("--rf-py", "50%");
      const l = lift(el, el.getBoundingClientRect());
      el.setAttribute("data-pressed", "");
      setTimeout(() => {
        release(el);
        if (l > 0.05) jiggle(el, { amount: clamp(l * 0.4, 0.02, 0.05) });
      }, 180);
    }, true);
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches(".rf-checkbox")) {
        pop(t, t.checked ? 0.72 : 0.86, t.checked ? "spring-jelly" : "spring-bouncy");
        if (t.checked && !t.indeterminate) setTimeout(() => burst(t, { count: 8, hue: "accent", size: [4, 7], spread: 1, gravity: 0.35, ring: false }), 60);
      } else if (t.matches(".rf-radio") && t.checked) {
        pop(t, 0.8, "spring-jelly");
        burst(t, { count: 0, hue: "accent", spread: 0.8 });
      }
    }, true);
    document.addEventListener("click", (e) => {
      const chip = e.target.closest && e.target.closest(".rf-chip[aria-pressed]");
      if (chip && !e.target.closest(".rf-chip-remove")) {
        pop(chip, 0.88, "spring-jelly");
      }
      const b = e.target.closest && e.target.closest("[data-rf-burst]");
      if (b && !b.matches(':disabled, [aria-disabled="true"]')) {
        setTimeout(() => {
          if (b.getAttribute("aria-pressed") === "false" || b.getAttribute("aria-checked") === "false") return;
          const hue = b.getAttribute("data-rf-burst") || void 0;
          burst(b, { hue, count: 14 });
          const ic = b.querySelector(".rf-icon");
          if (ic) {
            pop(ic, 0.6, "spring-jelly");
            wiggle(ic, { deg: 14 });
          }
        }, 0);
      }
    }, true);
  }

  // src/js/core/icons.js
  var F = 'fill="currentColor" stroke="none"';
  var ICONS = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.25 4.25"/>',
    bell: '<path d="M18 16v-5a6 6 0 1 0-12 0v5l-1.5 2.5h15z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>',
    person: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.75 20c.9-3.6 3.8-5.5 7.25-5.5s6.35 1.9 7.25 5.5"/>',
    people: '<circle cx="9" cy="8.5" r="3.25"/><path d="M3.5 19c.7-3 2.9-4.75 5.5-4.75S13.8 16 14.5 19"/><path d="M15.5 5.6a3.25 3.25 0 0 1 0 6.1M17.25 14.4c1.6.6 2.8 2.1 3.25 4.6"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5 10 17.5 19 7"/>',
    "chevron-left": '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    "chevron-right": '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    "chevron-down": '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
    "chevron-up": '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
    more: `<circle cx="5.5" cy="12" r="1.6" ${F}/><circle cx="12" cy="12" r="1.6" ${F}/><circle cx="18.5" cy="12" r="1.6" ${F}/>`,
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5h-2A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5h-2"/>',
    heart: '<path d="M12 20.25s-7.75-4.5-7.75-10.25A4.35 4.35 0 0 1 12 7.35 4.35 4.35 0 0 1 19.75 10c0 5.75-7.75 10.25-7.75 10.25z"/>',
    star: '<path d="M12 3.8l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L12 16.6l-5.1 2.8 1.1-5.7-4.2-3.9 5.7-.7z"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15.5l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
    trash: '<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
    pencil: '<path d="M4.5 19.5l1-4L15.8 5.2a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.5 18.5z"/><path d="M14 7l3 3"/>',
    compose: '<path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13"/><path d="M9.5 14.5l.6-3 8-8a1.6 1.6 0 0 1 2.3 2.3l-8 8z"/>',
    filter: '<path d="M4 5.5h16l-6 7.5v5l-4 2v-7z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    list: `<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.75" cy="6.5" r="1.1" ${F}/><circle cx="4.75" cy="12" r="1.1" ${F}/><circle cx="4.75" cy="17.5" r="1.1" ${F}/>`,
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>',
    timer: '<circle cx="12" cy="13" r="7.25"/><path d="M12 13V9.5M9.5 3.5h5M18 7l1.25-1.25"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    map: '<path d="M9 5 3.75 6.75v12.5L9 17.5l6 2 5.25-1.75V5.25L15 7z"/><path d="M9 5v12.5M15 7v12.5"/>',
    compass: '<circle cx="12" cy="12" r="8.25"/><path d="m15.2 8.8-2.1 4.3-4.3 2.1 2.1-4.3z"/>',
    navigate: '<path d="M20 4 4 11l7 2 2 7z"/>',
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.75" r="3.5"/>',
    image: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5"/><circle cx="9" cy="9.75" r="1.6"/><path d="M4 17l4.5-4.5 3 3 3.5-4 5 5"/>',
    play: `<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8A.8.8 0 0 0 8 5.2z" ${F}/>`,
    pause: `<rect x="6.5" y="5" width="4" height="14" rx="1.2" ${F}/><rect x="13.5" y="5" width="4" height="14" rx="1.2" ${F}/>`,
    "skip-back": `<path d="M11 6.6v10.8a.6.6 0 0 1-.95.5L3.6 12.5a.6.6 0 0 1 0-1l6.45-5.4a.6.6 0 0 1 .95.5zM20 6.6v10.8a.6.6 0 0 1-.95.5L12.6 12.5a.6.6 0 0 1 0-1l6.45-5.4a.6.6 0 0 1 .95.5z" ${F}/>`,
    "skip-forward": `<path d="M13 6.6v10.8a.6.6 0 0 0 .95.5l6.45-5.4a.6.6 0 0 0 0-1l-6.45-5.4a.6.6 0 0 0-.95.5zM4 6.6v10.8a.6.6 0 0 0 .95.5l6.45-5.4a.6.6 0 0 0 0-1L4.95 6.1a.6.6 0 0 0-.95.5z" ${F}/>`,
    shuffle: '<path d="M4 7.5h2.6a4 4 0 0 1 3.2 1.6l4.4 5.8a4 4 0 0 0 3.2 1.6H20M4 16.5h2.6a4 4 0 0 0 3.2-1.6l.6-.8M13.6 9.9l.6-.8a4 4 0 0 1 3.2-1.6H20"/><path d="M17.5 5 20 7.5 17.5 10M17.5 14 20 16.5 17.5 19"/>',
    repeat: '<path d="M4.5 11V9.5a3 3 0 0 1 3-3h12M16.5 3.5l3 3-3 3M19.5 13v1.5a3 3 0 0 1-3 3h-12M7.5 20.5l-3-3 3-3"/>',
    volume: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    "volume-low": '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3"/>',
    music: '<path d="M9 18V6.5l10-2.5v11.5"/><circle cx="6.75" cy="18" r="2.25"/><circle cx="16.75" cy="15.5" r="2.25"/>',
    send: '<path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    chat: '<path d="M6.5 4.5h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4.5 3.5v-3.5a1 1 0 0 1-1-1v-9a2 2 0 0 1 2-2z"/>',
    reply: '<path d="M10 6.5 4.5 12l5.5 5.5M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5v1"/>',
    inbox: '<path d="M4 13.5l2.2-7.1A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.4l2.2 7.1V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
    archive: '<rect x="3.75" y="4.5" width="16.5" height="4.5" rx="1.25"/><path d="M5.25 9v8.75A1.75 1.75 0 0 0 7 19.5h10a1.75 1.75 0 0 0 1.75-1.75V9M10 12.5h4"/>',
    folder: '<path d="M3.75 7.5a2 2 0 0 1 2-2h3.6l2 2h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z"/>',
    doc: '<path d="M14 3.75H7.5a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.25z"/><path d="M14 3.75v4.5h4.5M9 13h6M9 16.5h4"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.25"/><path d="M15.5 8.5V6.25a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    eye: '<path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    cloud: '<path d="M7.5 18.5h9.5a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.2A3.5 3.5 0 0 0 7.5 18.5z"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z"/>',
    wave: '<path d="M3.5 9c2.1 0 2.1-1.5 4.25-1.5S9.9 9 12 9s2.1-1.5 4.25-1.5S18.4 9 20.5 9M3.5 14c2.1 0 2.1-1.5 4.25-1.5S9.9 14 12 14s2.1-1.5 4.25-1.5S18.4 14 20.5 14M3.5 19c2.1 0 2.1-1.5 4.25-1.5S9.9 19 12 19s2.1-1.5 4.25-1.5S18.4 19 20.5 19"/>',
    mountain: '<path d="M3.5 19 9.5 8.5l3.5 6 2-3.5 5.5 8z"/>',
    leaf: '<path d="M5 19c0-8 5-13.5 14.5-14.5C19 14 13.5 19 5 19z"/><path d="M5 19l8-8"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16v4M16.5 18h4"/>',
    bolt: '<path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z"/>',
    layers: '<path d="M12 4 3.75 8.25 12 12.5l8.25-4.25z"/><path d="m3.75 12.25 8.25 4.25 8.25-4.25M3.75 16.25 12 20.5l8.25-4.25"/>',
    globe: '<circle cx="12" cy="12" r="8.25"/><path d="M3.75 12h16.5M12 3.75c2.3 2.4 3.4 5.1 3.4 8.25S14.3 17.85 12 20.25C9.7 17.85 8.6 15.15 8.6 12S9.7 6.15 12 3.75z"/>',
    wifi: `<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.75a7.75 7.75 0 0 1 11 0M9.5 16a3.5 3.5 0 0 1 5 0"/><circle cx="12" cy="19" r="1.1" ${F}/>`,
    info: `<circle cx="12" cy="12" r="8.25"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r="1" ${F}/>`,
    alert: `<path d="M10.3 4.6 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="1" ${F}/>`,
    "check-circle": '<circle cx="12" cy="12" r="8.25"/><path d="M8.25 12.25 11 15l4.75-5.5"/>',
    "x-circle": '<circle cx="12" cy="12" r="8.25"/><path d="M9.25 9.25l5.5 5.5M14.75 9.25l-5.5 5.5"/>',
    "plus-circle": '<circle cx="12" cy="12" r="8.25"/><path d="M12 8.5v7M8.5 12h7"/>',
    "arrow-right": '<path d="M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5"/>',
    "arrow-left": '<path d="M19.5 12h-15M11 5.5 4.5 12l6.5 6.5"/>',
    "arrow-up-right": '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
    library: '<rect x="3.5" y="4.5" width="4" height="15" rx="1"/><rect x="9" y="4.5" width="4" height="15" rx="1"/><path d="M14.4 6.3l3.4-.9 3.1 11.8-3.4.9z"/>',
    bag: '<path d="M5.5 8h13l-.9 11.1a1.5 1.5 0 0 1-1.5 1.4H7.9a1.5 1.5 0 0 1-1.5-1.4z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
    tag: '<path d="M3.75 12.1V5.25a1.5 1.5 0 0 1 1.5-1.5h6.85a1.5 1.5 0 0 1 1.06.44l7.1 7.1a1.5 1.5 0 0 1 0 2.12l-6.86 6.86a1.5 1.5 0 0 1-2.12 0l-7.1-7.1a1.5 1.5 0 0 1-.44-1.06z"/><circle cx="8.25" cy="8.25" r="1.4"/>',
    flag: '<path d="M5.5 20.5V4.5M5.5 5h11.5l-2.5 4 2.5 4H5.5"/>',
    chart: '<path d="M4 19.5h16M6.5 16v-4M11 16V8M15.5 16v-6M20 16V5.5"/>',
    sort: '<path d="M7 4.5v15M4 16.5l3 3 3-3M17 19.5v-15M14 7.5l3-3 3 3"/>'
  };
  function icon(name, { size, label, className = "" } = {}) {
    const body = ICONS[name];
    if (!body) return "";
    const sz = size ? ` data-size="${size}"` : "";
    const a11y = label ? ` role="img" aria-label="${String(label).replace(/"/g, "&quot;")}"` : ' aria-hidden="true" focusable="false"';
    return `<svg class="rf-icon ${className}"${sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${a11y}>${body}</svg>`;
  }
  function injectIcons(root = document) {
    const nodes = root.querySelectorAll ? root.querySelectorAll("[data-icon]:not(svg)") : [];
    nodes.forEach((n) => {
      const name = n.getAttribute("data-icon");
      const html = icon(name, { size: n.getAttribute("data-size") || void 0, label: n.getAttribute("aria-label") || void 0, className: n.className || "" });
      if (!html) return;
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const svg = tpl.content.firstElementChild;
      if (n.style && n.style.cssText) svg.style.cssText = n.style.cssText;
      n.replaceWith(svg);
    });
  }

  // src/js/components/controls.js
  function stretcher(el) {
    const s = springValue({ stiffness: 520, damping: 26, onUpdate: (x) => el.style.setProperty("--rf-stretch", x.toFixed(3)) });
    let lastX = 0, lastT = 0;
    return {
      track(x) {
        const t = performance.now();
        if (lastT) {
          const v = (x - lastX) / Math.max(1, t - lastT);
          s.set(clamp(Math.abs(v) / 2.2, 0, 1));
        }
        lastX = x;
        lastT = t;
      },
      release() {
        lastT = 0;
        s.to(0);
      },
      kick(amount = 0.8) {
        s.set(amount);
        s.to(0);
      }
    };
  }
  function knobLens(el, box) {
    if (!supports.lens || prefs.reducedTransparency) return null;
    const w = Math.round(box.offsetWidth), h = Math.round(box.offsetHeight);
    if (!w || !h) return null;
    const f = lensFilter(w, h, { radius: h / 2, bezel: h / 2, depth: Math.round(h * 0.9), profile: "circle" });
    if (f) box.style.setProperty("--_knob-lens", `${f.url} saturate(170%) brightness(1.1)`);
    return f;
  }
  function switchBehavior(root) {
    const track = root.querySelector(".rf-switch-track");
    const input = root.querySelector('input[type="checkbox"]');
    const thumb = root.querySelector(".rf-switch-thumb");
    if (!track || !input || !thumb) return;
    if (!input.hasAttribute("role")) input.setAttribute("role", "switch");
    const st = stretcher(thumb);
    let lensObj = null;
    requestAnimationFrame(() => {
      lensObj = knobLens(root, thumb);
    });
    let start = null, suppressClick = false, travelTimer = 0;
    const travel2 = () => track.clientWidth - thumb.offsetWidth - 6;
    const offs = [];
    offs.push(on(input, "pointerdown", (e) => {
      if (input.disabled || e.button > 0) return;
      start = { x: e.clientX, checked: input.checked, moved: false };
      track.setAttribute("data-pressed", "");
      input.setPointerCapture && input.setPointerCapture(e.pointerId);
    }));
    offs.push(on(input, "pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!start.moved && Math.abs(dx) < 4) return;
      start.moved = true;
      track.setAttribute("data-dragging", "");
      const base = start.checked ? travel2() : 0;
      const x = clamp(base + dx, 0, travel2());
      thumb.style.setProperty("--_drag", `${x - base}px`);
      st.track(e.clientX);
    }));
    const end = (e) => {
      if (!start) return;
      track.removeAttribute("data-pressed");
      if (start.moved) {
        const base = start.checked ? travel2() : 0;
        const x = clamp(base + (e.clientX - start.x), 0, travel2());
        const next = x > travel2() / 2;
        suppressClick = true;
        thumb.style.removeProperty("--_drag");
        track.removeAttribute("data-dragging");
        if (next !== input.checked) {
          input.checked = next;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      st.release();
      start = null;
    };
    offs.push(on(input, "pointerup", end));
    offs.push(on(input, "pointercancel", end));
    offs.push(on(input, "click", (e) => {
      if (suppressClick) {
        e.preventDefault();
        suppressClick = false;
        return;
      }
      st.kick(0.7);
      if (!prefs.reducedMotion) {
        clearTimeout(travelTimer);
        track.setAttribute("data-traveling", "");
        travelTimer = setTimeout(() => track.removeAttribute("data-traveling"), 300);
        jiggle(thumb, { angle: 0, amount: 0.14, impact: true, duration: 560, delay: 190 });
      }
    }, true));
    return () => {
      offs.forEach((f) => f());
      if (lensObj) lensObj.remove();
    };
  }
  function sliderBehavior(root) {
    const input = root.querySelector('input[type="range"]');
    if (!input) return;
    const control = input.closest(".rf-slider-control") || root;
    let thumb = control.querySelector(".rf-slider-thumb");
    if (!control.querySelector(".rf-slider-track")) {
      control.insertAdjacentHTML("beforeend", '<div class="rf-slider-track" aria-hidden="true"><div class="rf-slider-fill"></div></div>');
    }
    if (!thumb) {
      control.insertAdjacentHTML("beforeend", '<div class="rf-slider-thumb" aria-hidden="true"></div>');
      thumb = control.querySelector(".rf-slider-thumb");
    }
    const ticks = parseInt(root.getAttribute("data-ticks"), 10);
    if (ticks > 1 && !control.querySelector(".rf-slider-ticks")) {
      const t = document.createElement("div");
      t.className = "rf-slider-ticks";
      t.setAttribute("aria-hidden", "true");
      t.innerHTML = "<i></i>".repeat(ticks);
      control.insertBefore(t, thumb);
    }
    const st = stretcher(thumb);
    let lensObj = null;
    requestAnimationFrame(() => {
      lensObj = knobLens(root, thumb);
    });
    const sync = () => {
      const min = parseFloat(input.min || "0"), max = parseFloat(input.max || "100");
      const v = (parseFloat(input.value) - min) / (max - min || 1);
      root.style.setProperty("--rf-value", clamp(v, 0, 1).toFixed(4));
    };
    sync();
    setRefresh(root, sync);
    const offs = [];
    offs.push(on(input, "input", sync));
    offs.push(on(input, "change", sync));
    offs.push(on(input, "pointerdown", (e) => {
      root.removeAttribute("data-animate");
      root.setAttribute("data-active", "");
      st.track(e.clientX);
    }));
    let rubber = 0;
    const band = (e) => {
      if (prefs.reducedMotion) return;
      const r = input.getBoundingClientRect();
      const over = e.clientX < r.left ? e.clientX - r.left : e.clientX > r.right ? e.clientX - r.right : 0;
      rubber = clamp(Math.sign(over) * Math.pow(Math.abs(over), 0.62), -14, 14);
      const k = Math.abs(rubber) / 14;
      thumb.style.transform = rubber ? `translateX(${rubber.toFixed(1)}px) scale(${(1 + k * 0.2).toFixed(3)}, ${(1 - k * 0.15).toFixed(3)})` : "";
    };
    const unband = () => {
      if (!rubber) return;
      const from = thumb.style.transform;
      thumb.style.transform = "";
      rubber = 0;
      animate(thumb, [{ transform: from }, { transform: "translateX(0px) scale(1, 1)" }], { spring: "spring-jelly", fill: "none" });
    };
    const tickEls = () => Array.from(control.querySelectorAll(".rf-slider-ticks > i"));
    let lastTick = -1;
    const tick2 = () => {
      const list = tickEls();
      if (list.length < 2) return;
      const v = parseFloat(getComputedStyle(root).getPropertyValue("--rf-value")) || 0;
      const i = Math.round(v * (list.length - 1));
      if (i !== lastTick && lastTick !== -1) {
        animate(list[i], [{ transform: "scale(2.6)" }, { transform: "scale(1)" }], { spring: "spring-jelly", fill: "none", composite: "add", reduced: [{}, {}] });
      }
      lastTick = i;
    };
    offs.push(on(input, "input", tick2));
    offs.push(on(input, "pointermove", (e) => {
      if (root.hasAttribute("data-active")) {
        st.track(e.clientX);
        band(e);
      }
    }));
    const up = () => {
      root.removeAttribute("data-active");
      st.release();
      unband();
    };
    offs.push(on(input, "pointerup", up));
    offs.push(on(input, "pointercancel", up));
    offs.push(on(input, "blur", up));
    offs.push(on(input, "keydown", () => root.setAttribute("data-animate", "")));
    const mo = new MutationObserver(sync);
    mo.observe(input, { attributes: true, attributeFilter: ["value", "min", "max"] });
    return () => {
      offs.forEach((f) => f());
      mo.disconnect();
      if (lensObj) lensObj.remove();
    };
  }
  function stepperBehavior(root) {
    const input = root.querySelector(".rf-stepper-value");
    const btns = Array.from(root.querySelectorAll("[data-step]"));
    if (!input) {
      const offs2 = btns.map((b) => on(b, "click", () => emit(root, "rf-step", { step: parseFloat(b.dataset.step) || 0 })));
      return () => offs2.forEach((f) => f());
    }
    const bounds = () => ({
      min: input.min !== "" ? parseFloat(input.min) : -Infinity,
      max: input.max !== "" ? parseFloat(input.max) : Infinity,
      step: parseFloat(input.step) || 1
    });
    const refresh2 = () => {
      const { min, max } = bounds();
      const v = parseFloat(input.value) || 0;
      btns.forEach((b) => {
        const d = parseFloat(b.dataset.step);
        b.disabled = d < 0 ? v <= min : v >= max;
      });
    };
    const bump2 = (dir) => {
      const { min, max, step } = bounds();
      const prev = parseFloat(input.value) || 0;
      const next = clamp(Math.round((prev + dir * step) / step) * step, min, max);
      if (next === prev) return;
      roll(input, String(next), { dir });
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      refresh2();
    };
    let timer = 0, rate = 0;
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const offs = [];
    btns.forEach((b) => {
      const dir = Math.sign(parseFloat(b.dataset.step)) || 1;
      offs.push(on(b, "click", (e) => {
        if (e.detail === 0 || !b._held) bump2(dir);
        b._held = false;
      }));
      offs.push(on(b, "pointerdown", () => {
        rate = 380;
        const repeat = () => {
          b._held = true;
          bump2(dir);
          rate = Math.max(60, rate * 0.8);
          timer = setTimeout(repeat, rate);
        };
        timer = setTimeout(repeat, 420);
      }));
      offs.push(on(b, "pointerup", stop));
      offs.push(on(b, "pointerleave", stop));
    });
    offs.push(on(input, "input", refresh2));
    refresh2();
    return () => {
      offs.forEach((f) => f());
      stop();
    };
  }
  function searchBehavior(root) {
    const input = root.querySelector(".rf-search-input");
    if (!input) return;
    const clear = root.querySelector(".rf-search-clear");
    const row = root.closest(".rf-search-row");
    const cancel = row && row.querySelector(".rf-search-cancel");
    const collapsible = root.hasAttribute("data-collapsible");
    const expand = () => {
      if (!collapsible || root.hasAttribute("data-expanded")) return;
      root.setAttribute("data-expanded", "");
      setTimeout(() => input.focus({ preventScroll: true }), 30);
      emit(root, "rf-expand", {});
    };
    const collapse = () => {
      if (!collapsible) return;
      root.removeAttribute("data-expanded");
      emit(root, "rf-collapse", {});
    };
    const offs = [];
    if (collapsible) {
      root.setAttribute("role", root.getAttribute("role") || "search");
      offs.push(on(root, "click", expand));
      offs.push(on(root, "keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && !root.hasAttribute("data-expanded")) {
          e.preventDefault();
          expand();
        }
      }));
      if (!root.hasAttribute("tabindex")) root.tabIndex = root.hasAttribute("data-expanded") ? -1 : 0;
      offs.push(on(root, "focusout", () => setTimeout(() => {
        if (!root.contains(document.activeElement) && !input.value && (!row || !row.contains(document.activeElement))) collapse();
      }, 60)));
    }
    if (clear) offs.push(on(clear, "click", (e) => {
      e.stopPropagation();
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }));
    if (cancel) offs.push(on(cancel, "click", () => {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      collapse();
    }));
    offs.push(on(input, "keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (collapsible) {
          input.blur();
          collapse();
        }
      }
    }));
    return () => offs.forEach((f) => f());
  }
  function chipBehavior(root) {
    const offs = [];
    if (root.hasAttribute("aria-pressed") && root.tagName === "BUTTON") {
      offs.push(on(root, "click", (e) => {
        if (e.target.closest(".rf-chip-remove")) return;
        const next = root.getAttribute("aria-pressed") !== "true";
        root.setAttribute("aria-pressed", String(next));
        emit(root, "rf-toggle", { pressed: next });
      }));
    }
    const remove = root.querySelector(".rf-chip-remove");
    if (remove) offs.push(on(remove, "click", (e) => {
      e.stopPropagation();
      const w = root.offsetWidth;
      const a = animate(root, [
        { opacity: 1, scale: "1", maxWidth: `${w}px`, marginInlineEnd: "0px" },
        { opacity: 0, scale: "0.6", maxWidth: "0px", marginInlineEnd: "calc(var(--rf-gap, 8px) * -1)" }
      ], { spring: "spring-smooth", fill: "forwards" });
      a.finished.then(() => {
        emit(root, "rf-remove", {});
        root.remove();
      });
    }));
    return () => offs.forEach((f) => f());
  }
  function playPauseBehavior(root) {
    if (!root.hasAttribute("aria-pressed")) root.setAttribute("aria-pressed", "false");
    const sync = () => root.setAttribute("aria-label", root.getAttribute("aria-pressed") === "true" ? root.dataset.labelPause || "Pause" : root.dataset.labelPlay || "Play");
    sync();
    return on(root, "click", () => {
      root.setAttribute("aria-pressed", root.getAttribute("aria-pressed") === "true" ? "false" : "true");
      sync();
      emit(root, "rf-toggle", { playing: root.getAttribute("aria-pressed") === "true" });
    });
  }

  // src/js/components/navigation.js
  function stretchKick(el, amount = 1) {
    if (prefs.reducedMotion) return;
    const s = springValue({ stiffness: 300, damping: 22, onUpdate: (x) => el.style.setProperty("--rf-stretch", x.toFixed(3)) });
    s.set(amount);
    s.to(0);
  }
  function travel(root, ms = 300) {
    if (prefs.reducedMotion) return;
    clearTimeout(root._rfTravel);
    root.setAttribute("data-traveling", "");
    root._rfTravel = setTimeout(() => root.removeAttribute("data-traveling"), ms);
  }
  function popIn(el) {
    if (!el) return;
    animate(el, [{ transform: "scale(0.7)" }, { transform: "scale(1)" }], { spring: "spring-jelly", fill: "none", composite: "add", reduced: [{}, {}] });
    wiggle(el, { deg: 11, duration: 640, delay: 40 });
  }
  function splat(el, distance, at = 170) {
    jiggle(el, { angle: 0, amount: Math.min(0.16, 0.06 + distance * 0.035), impact: true, duration: 600, delay: at });
  }
  function dragLens(target, cssVar2 = "--_drag-lens") {
    if (!supports.lens || prefs.reducedTransparency) return null;
    const w = Math.round(target.offsetWidth), h = Math.round(target.offsetHeight);
    if (!w || !h) return null;
    const f = lensFilter(w, h, { radius: h / 2, bezel: Math.min(h / 2, 22), depth: Math.round(h * 0.7), profile: "squircle" });
    if (f) target.style.setProperty(cssVar2, `${f.url} saturate(160%) brightness(1.06)`);
    return f;
  }
  function tabbarBehavior(root) {
    const bar = root.querySelector(".rf-tabbar-bar");
    if (!bar) return;
    const tabs = () => Array.from(bar.querySelectorAll(".rf-tab"));
    let lens2 = bar.querySelector(".rf-tabbar-lens");
    if (!lens2) {
      lens2 = document.createElement("span");
      lens2.className = "rf-tabbar-lens";
      lens2.setAttribute("aria-hidden", "true");
      bar.prepend(lens2);
    }
    const current = () => tabs().find((t) => t.getAttribute("aria-current") === "page" || t.getAttribute("aria-selected") === "true") || tabs()[0];
    let lastIndex = -1, lensObj = null;
    const position = (kick) => {
      const cur = current();
      if (!cur) return;
      lens2.style.setProperty("--_lx", `${cur.offsetLeft}px`);
      lens2.style.setProperty("--_lw", `${cur.offsetWidth}px`);
      const idx = tabs().indexOf(cur);
      if (kick && lastIndex !== -1 && idx !== lastIndex) {
        stretchKick(lens2, clamp(Math.abs(idx - lastIndex) * 0.6, 0.4, 1));
        if (!root.hasAttribute("data-dragging")) {
          if (!lensObj) lensObj = dragLens(lens2);
          travel(root, 260 + Math.min(3, Math.abs(idx - lastIndex)) * 40);
          popIn(cur.querySelector(".rf-icon"));
          splat(lens2, Math.abs(idx - lastIndex));
        }
      }
      lastIndex = idx;
    };
    const select = (tab) => {
      if (!tab || tab === current()) return;
      tabs().forEach((t) => {
        if (t.hasAttribute("aria-selected")) t.setAttribute("aria-selected", String(t === tab));
        else if (t === tab) t.setAttribute("aria-current", "page");
        else t.removeAttribute("aria-current");
      });
      emit(root, "rf-select", { tab, index: tabs().indexOf(tab) });
    };
    position(false);
    setRefresh(root, () => position(true));
    requestAnimationFrame(() => root.setAttribute("data-ready", ""));
    const offs = [];
    offs.push(on(bar, "click", (e) => {
      if (drag && drag.moved) {
        e.preventDefault();
        return;
      }
      const tab = e.target.closest(".rf-tab");
      if (!tab) return;
      if (tab.tagName === "A" && tab.getAttribute("href") && tab.getAttribute("href") !== "#") {
        select(tab);
        return;
      }
      e.preventDefault();
      select(tab);
    }));
    let drag = null;
    offs.push(on(bar, "pointerdown", (e) => {
      if (e.button > 0 || root.hasAttribute("data-minimized")) return;
      drag = { x: e.clientX, moved: false, id: e.pointerId };
    }));
    offs.push(on(bar, "pointermove", (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        bar.setPointerCapture && bar.setPointerCapture(drag.id);
        root.setAttribute("data-dragging", "");
        if (!lensObj) lensObj = dragLens(lens2);
      }
      const r = bar.getBoundingClientRect();
      const w = lens2.offsetWidth;
      const x = clamp(e.clientX - r.left - w / 2, 4, r.width - w - 4);
      lens2.style.transition = "none";
      lens2.style.setProperty("--_lx", `${x}px`);
      const over = tabs().find((t) => {
        const b = t.getBoundingClientRect();
        return e.clientX >= b.left && e.clientX <= b.right;
      });
      tabs().forEach((t) => t.toggleAttribute("data-hover", t === over));
    }));
    const end = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      if (moved) {
        lens2.style.transition = "";
        root.removeAttribute("data-dragging");
        const over = tabs().find((t) => {
          const b = t.getBoundingClientRect();
          return e.clientX >= b.left && e.clientX <= b.right;
        }) || current();
        tabs().forEach((t) => t.removeAttribute("data-hover"));
        if (over.tagName === "A" && over.getAttribute("href") && over.getAttribute("href") !== "#") {
          setTimeout(() => over.click(), 0);
        }
        select(over);
        position(false);
        setTimeout(() => {
          drag = null;
        }, 0);
      } else drag = null;
    };
    offs.push(on(bar, "pointerup", end));
    offs.push(on(bar, "pointercancel", end));
    // gh-patch(tabbar-frame): the lens follows a change of tab at the next frame. From the observer's
    // microtask it read the tabs' places before the frame, laying out the page the tab change had
    // just drawn once for that read and again for the frame.
    let moFrame = 0;
    const mo = new MutationObserver(() => {
      if (!moFrame) moFrame = requestAnimationFrame(() => { moFrame = 0; if (root.isConnected) position(true); });
    });
    // gh-patch-end(tabbar-frame)
    mo.observe(bar, { subtree: true, attributes: true, attributeFilter: ["aria-current", "aria-selected"] });
    const ro = new ResizeObserver(() => position(false));
    ro.observe(bar);
    const sel = root.getAttribute("data-minimize-on-scroll");
    if (sel != null) {
      const scroller = sel && sel !== "window" ? document.querySelector(sel) : null;
      const target = scroller || window;
      const read = () => scroller ? scroller.scrollTop : window.scrollY;
      let last = read();
      offs.push(on(target, "scroll", () => {
        const y = read();
        const dy = y - last;
        if (y < 24) root.removeAttribute("data-minimized");
        else if (dy > 6) root.setAttribute("data-minimized", "");
        else if (dy < -10) root.removeAttribute("data-minimized");
        last = y;
      }, { passive: true }));
    }
    offs.push(on(root, "transitionend", (e) => {
      if (e.target === bar) position(false);
    }));
    return () => {
      offs.forEach((f) => f());
      mo.disconnect();
      ro.disconnect();
      if (lensObj) lensObj.remove();
    };
  }
  function segmentedBehavior(root) {
    const segs = () => Array.from(root.querySelectorAll(".rf-segment"));
    let thumb = root.querySelector(".rf-segmented-thumb");
    if (!thumb) {
      thumb = document.createElement("span");
      thumb.className = "rf-segmented-thumb";
      thumb.setAttribute("aria-hidden", "true");
      root.insertBefore(thumb, root.firstChild);
    }
    if (!root.hasAttribute("role")) root.setAttribute("role", "radiogroup");
    const checked = () => segs().find((s) => s.querySelector("input:checked")) || segs()[0];
    let last = -1, lensObj = null;
    const position = (kick) => {
      const s = checked();
      if (!s) return;
      thumb.style.setProperty("--_tx", `${s.offsetLeft}px`);
      thumb.style.setProperty("--_tw", `${s.offsetWidth}px`);
      const i = segs().indexOf(s);
      if (kick && last !== -1 && i !== last) {
        stretchKick(thumb, clamp(Math.abs(i - last) * 0.5, 0.35, 1));
        if (!root.hasAttribute("data-dragging")) {
          if (!lensObj) lensObj = dragLens(thumb);
          travel(root, 240 + Math.min(3, Math.abs(i - last)) * 40);
          popIn(s.querySelector(".rf-icon") || s.querySelector("span:not(.rf-visually-hidden)"));
          splat(thumb, Math.abs(i - last), 150);
        }
      }
      last = i;
    };
    position(false);
    setRefresh(root, () => position(true));
    requestAnimationFrame(() => root.setAttribute("data-ready", ""));
    const offs = [];
    offs.push(on(root, "change", () => position(true)));
    let drag = null;
    offs.push(on(root, "pointerdown", (e) => {
      const seg = e.target.closest(".rf-segment");
      if (!seg || seg !== checked() || e.button > 0) return;
      const r = root.getBoundingClientRect();
      drag = { start: e.clientX, grab: e.clientX - r.left - seg.offsetLeft, moved: false, id: e.pointerId };
    }));
    offs.push(on(root, "pointermove", (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientX - drag.start) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        root.setPointerCapture && root.setPointerCapture(drag.id);
        root.setAttribute("data-dragging", "");
        if (!lensObj) lensObj = dragLens(thumb);
      }
      const r = root.getBoundingClientRect();
      const x = clamp(e.clientX - r.left - drag.grab, 3, r.width - thumb.offsetWidth - 3);
      thumb.style.transition = "none";
      thumb.style.setProperty("--_tx", `${x}px`);
    }));
    const end = (e) => {
      if (!drag) return;
      if (drag.moved) {
        thumb.style.transition = "";
        root.removeAttribute("data-dragging");
        const center = thumb.getBoundingClientRect();
        const cx2 = center.left + center.width / 2;
        const target = segs().reduce((best, s) => {
          const b = s.getBoundingClientRect();
          const d = Math.abs(b.left + b.width / 2 - cx2);
          return !best || d < best.d ? { s, d } : best;
        }, null);
        const input = target && target.s.querySelector("input");
        if (input && !input.checked && !input.disabled) {
          input.checked = true;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } else position(false);
        e.preventDefault();
      }
      drag = null;
    };
    offs.push(on(root, "pointerup", end));
    offs.push(on(root, "pointercancel", end));
    const ro = new ResizeObserver(() => position(false));
    ro.observe(root);
    const mo = new MutationObserver(() => position(true));
    mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["checked"] });
    return () => {
      offs.forEach((f) => f());
      ro.disconnect();
      mo.disconnect();
      if (lensObj) lensObj.remove();
    };
  }
  function pagedotsBehavior(root) {
    const dots = () => Array.from(root.querySelectorAll(".rf-dot"));
    let worm = root.querySelector(".rf-pagedots-worm");
    if (!worm) {
      worm = document.createElement("span");
      worm.className = "rf-pagedots-worm";
      worm.setAttribute("aria-hidden", "true");
      root.appendChild(worm);
    }
    const W = 18;
    const idx = () => Math.max(0, dots().findIndex((d) => d.getAttribute("aria-current") === "true" || d.getAttribute("aria-current") === "page"));
    let cur = idx();
    const xFor = (i) => {
      const d = dots()[i];
      return d ? d.offsetLeft + d.offsetWidth / 2 - W / 2 : 0;
    };
    const place2 = () => {
      worm.style.setProperty("--_wx", `${xFor(cur)}px`);
      worm.style.setProperty("--_ww", `${W}px`);
    };
    place2();
    const go = (next) => {
      if (next === cur) return;
      const x0 = xFor(cur), x1 = xFor(next);
      cur = next;
      place2();
      if (prefs.reducedMotion) return;
      animate(worm, [
        { translate: `${x0}px -50%`, width: `${W}px` },
        { translate: `${x1 > x0 ? x0 : x1}px -50%`, width: `${Math.abs(x1 - x0) + W}px`, offset: 0.42 },
        { translate: `${x1}px -50%`, width: `${W}px` }
      ], { duration: 520, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "none" });
      jiggle(worm, { angle: 0, amount: 0.22, impact: true, duration: 520, delay: 430 });
    };
    const setCurrent = (i) => {
      dots().forEach((d, j) => {
        if (j === i) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
    };
    const offs = [];
    offs.push(on(root, "click", (e) => {
      const d = e.target.closest(".rf-dot");
      if (!d) return;
      const i = dots().indexOf(d);
      setCurrent(i);
      emit(root, "rf-select", { index: i });
    }));
    offs.push(on(root, "keydown", (e) => {
      const list = dots();
      let i = cur;
      if (e.key === "ArrowRight") i = Math.min(list.length - 1, cur + 1);
      else if (e.key === "ArrowLeft") i = Math.max(0, cur - 1);
      else return;
      e.preventDefault();
      setCurrent(i);
      list[i].focus();
      emit(root, "rf-select", { index: i });
    }));
    setRefresh(root, () => go(idx()));
    const mo = new MutationObserver(() => go(idx()));
    mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
    const ro = new ResizeObserver(place2);
    ro.observe(root);
    return () => {
      offs.forEach((f) => f());
      mo.disconnect();
      ro.disconnect();
    };
  }
  function scrollerFor(el, sel) {
    if (sel && sel !== "window") return document.querySelector(sel);
    if (sel === "window") return null;
    let n = el.parentElement;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return null;
  }
  function navbarBehavior(root) {
    const scroller = scrollerFor(root, root.getAttribute("data-scroller"));
    const target = scroller || window;
    const titleSel = root.getAttribute("data-large-title");
    const large = titleSel ? document.querySelector(titleSel) : (scroller || document).querySelector(".rf-large-title");
    const read = () => scroller ? scroller.scrollTop : window.scrollY;
    const update = () => {
      let scrolled;
      if (large) {
        const r = large.getBoundingClientRect(), b = root.getBoundingClientRect();
        scrolled = r.bottom - 8 < b.bottom;
      } else scrolled = read() > 2;
      root.toggleAttribute("data-scrolled", scrolled);
    };
    update();
    return on(target, "scroll", update, { passive: true });
  }
  function scrollEdgeBehavior(el) {
    const scroller = scrollerFor(el, el.getAttribute("data-scroller")) || el.parentElement;
    if (!scroller) return;
    const bottom = el.getAttribute("data-edge") === "bottom";
    const update = () => {
      const active = bottom ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2 : scroller.scrollTop > 1;
      el.toggleAttribute("data-active", active);
    };
    update();
    const off = on(scroller, "scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => {
      off();
      ro.disconnect();
    };
  }
  function sidebarBehavior(root) {
    const btn = root.querySelector("[data-rf-sidebar-toggle]");
    if (!btn) return;
    const sync = () => btn.setAttribute("aria-expanded", String(!root.hasAttribute("data-collapsed")));
    sync();
    return on(btn, "click", () => {
      root.toggleAttribute("data-collapsed");
      sync();
      emit(root, "rf-toggle", { collapsed: root.hasAttribute("data-collapsed") });
    });
  }
  function toolbarBehavior(root) {
    if (!root.hasAttribute("role")) root.setAttribute("role", "toolbar");
    const items = () => Array.from(root.querySelectorAll('button:not(:disabled), a[href], input, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.closest("[popover]"));
    const list = items();
    list.forEach((n, i) => n.setAttribute("tabindex", i === 0 ? "0" : "-1"));
    return on(root, "keydown", (e) => {
      const l = items();
      const i = l.indexOf(document.activeElement);
      if (i < 0) return;
      let j = i;
      if (e.key === "ArrowRight") j = (i + 1) % l.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + l.length) % l.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = l.length - 1;
      else return;
      e.preventDefault();
      l[i].setAttribute("tabindex", "-1");
      l[j].setAttribute("tabindex", "0");
      l[j].focus();
    });
  }

  // src/js/core/anchor.js
  var MARGIN = 8;
  function measureHidden(el) {
    const prev = el.getAttribute("style") || "";
    el.style.setProperty("display", "block", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("position", "fixed");
    el.style.setProperty("left", "0px");
    el.style.setProperty("top", "0px");
    el.style.setProperty("translate", "none");
    el.style.setProperty("clip-path", "none");
    const r = el.getBoundingClientRect();
    el.setAttribute("style", prev);
    return { width: r.width, height: r.height };
  }
  function place(trigger, size, placement = "cover") {
    const t = trigger.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const rtl = getComputedStyle(trigger).direction === "rtl";
    let anchorX = rtl ? "end" : "start";
    let left = rtl ? t.right - size.width : t.left;
    if (left + size.width > vw - MARGIN) {
      left = t.right - size.width;
      anchorX = "end";
    }
    if (left < MARGIN) {
      left = t.left;
      anchorX = "start";
    }
    left = clamp(left, MARGIN, Math.max(MARGIN, vw - size.width - MARGIN));
    let top, anchorY = "top";
    const below = placement === "cover" ? t.top : t.bottom + MARGIN;
    const above = placement === "cover" ? t.bottom - size.height : t.top - MARGIN - size.height;
    if (placement === "above") {
      top = above >= MARGIN ? above : t.bottom + MARGIN;
      anchorY = above >= MARGIN ? "bottom" : "top";
    } else if (below + size.height <= vh - MARGIN || below + size.height - vh < MARGIN - above) {
      top = below;
    } else {
      top = above;
      anchorY = "bottom";
    }
    top = clamp(top, MARGIN, Math.max(MARGIN, vh - size.height - MARGIN));
    if (placement === "above" || placement === "tooltip") {
      left = clamp(t.left + t.width / 2 - size.width / 2, MARGIN, Math.max(MARGIN, vw - size.width - MARGIN));
    }
    return { left, top, anchorX, anchorY, trigger: t };
  }

  // src/js/components/menu.js
  var lastInvoker = null;
  var installed3 = false;
  function installInvokerTracking() {
    if (installed3) return;
    installed3 = true;
    document.addEventListener("pointerdown", (e) => {
      const inv = e.target.closest && e.target.closest("[popovertarget]");
      if (inv) lastInvoker = inv;
    }, true);
    document.addEventListener("keydown", (e) => {
      const inv = e.target.closest && e.target.closest("[popovertarget]");
      if (inv) lastInvoker = inv;
    }, true);
    if (!supports.popover) {
      document.addEventListener("click", (e) => {
        const inv = e.target.closest && e.target.closest("[popovertarget]");
        const openOnes = document.querySelectorAll(".rf-menu[data-open], .rf-popover[data-open]");
        openOnes.forEach((m) => {
          if (!m.contains(e.target) && (!inv || inv.getAttribute("popovertarget") !== m.id)) close(m);
        });
        if (!inv) return;
        const target = document.getElementById(inv.getAttribute("popovertarget"));
        if (!target) return;
        if (target.hasAttribute("data-open")) close(target);
        else open(target, inv);
      });
    }
  }
  var itemsOf = (menu2) => Array.from(menu2.querySelectorAll(".rf-menu-item, .rf-menu-tile")).filter((i) => !i.disabled && i.getAttribute("aria-disabled") !== "true");
  function invokerFor(el, e) {
    return e && e.source || el._rfInvoker || (lastInvoker && lastInvoker.getAttribute("popovertarget") === el.id ? lastInvoker : null) || document.querySelector(`[popovertarget="${el.id}"]`);
  }
  function geometry(el, trigger) {
    const size = measureHidden(el);
    const placement = el.getAttribute("data-placement") || (trigger.classList.contains("rf-glass") ? "cover" : "below");
    const pos = place(trigger, size, placement);
    const left = Math.round(pos.left), top = Math.round(pos.top);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    return { placement, rect: { left, top, width: size.width, height: size.height } };
  }
  function onBeforeToggle(el, e) {
    const trigger = invokerFor(el, e);
    if (e.newState === "open") {
      settle(el);
      if (!trigger) {
        el._rfTrigger = null;
        return materialize(el, { rect: { left: 0, top: 0, ...measureHidden(el) } });
      }
      el._rfTrigger = trigger;
      const { placement, rect } = geometry(el, trigger);
      trigger.setAttribute("aria-expanded", "true");
      const cover = placement === "cover";
      return materialize(el, { from: trigger, rect, hideSource: cover, scale: cover ? 0.8 : 0.9, wobble: cover ? 0.035 : 0.02 });
    }
    const t = el._rfTrigger;
    if (t) t.setAttribute("aria-expanded", "false");
    return dematerialize(el, { to: t && t.isConnected ? t : null });
  }
  function open(el, trigger, { focus = true } = {}) {
    if (trigger) el._rfInvoker = trigger;
    el._rfNoFocus = !focus;
    if (supports.popover && el.hasAttribute("popover")) {
      try {
        el.showPopover(trigger ? { source: trigger } : void 0);
      } catch (err) {
        el.showPopover();
      }
    } else {
      el._rfClosing = null;
      onBeforeToggle(el, { newState: "open", source: trigger });
      el.setAttribute("data-open", "");
      if (focus) focusFirst(el);
      el._rfNoFocus = false;
    }
  }
  function close(el) {
    if (supports.popover && el.hasAttribute("popover")) {
      try {
        el.hidePopover();
      } catch (e) {
      }
      return;
    }
    if (!el.hasAttribute("data-open") || el._rfClosing) return;
    const token = {};
    el._rfClosing = token;
    Promise.resolve(onBeforeToggle(el, { newState: "closed" })).then(() => {
      if (el._rfClosing !== token) return;
      el._rfClosing = null;
      el.removeAttribute("data-open");
    });
  }
  function toggle(el, trigger, opts) {
    const isOpen = supports.popover && el.matches(":popover-open") || el.hasAttribute("data-open") && !el._rfClosing;
    if (isOpen) close(el);
    else open(el, trigger, opts);
  }
  function focusFirst(el) {
    if (modality() !== "keyboard") {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      return;
    }
    const items = itemsOf(el);
    const checked = items.find((i) => i.getAttribute("aria-checked") === "true");
    const target = checked || items[0];
    if (target) target.focus({ preventScroll: true });
    else if (el.matches(".rf-popover")) {
      const f = el.querySelector('input, button, [href], textarea, select, [tabindex]:not([tabindex="-1"])');
      if (f) f.focus({ preventScroll: true });
    }
  }
  function menuBehavior(el) {
    installInvokerTracking();
    if (!el.id) el.id = `rf-menu-${Math.random().toString(36).slice(2, 8)}`;
    const isMenu = el.classList.contains("rf-menu");
    el.setAttribute("data-rf-motion", "");
    if (isMenu && !el.hasAttribute("role")) el.setAttribute("role", "menu");
    const offs = [];
    offs.push(on(el, "beforetoggle", (e) => onBeforeToggle(el, e)));
    offs.push(on(el, "toggle", (e) => {
      if (e.newState === "open" && !el._rfNoFocus) focusFirst(el);
      el._rfNoFocus = false;
    }));
    offs.push(on(el, "keydown", (e) => {
      const items = itemsOf(el);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      let next = null;
      if (i < 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        (e.key === "ArrowDown" ? items[0] : items[items.length - 1]).focus({ preventScroll: true });
        return;
      }
      if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
      else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
      else if (e.key === "Home") next = items[0];
      else if (e.key === "End") next = items[items.length - 1];
      else if (e.key === "Tab") {
        close(el);
        return;
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLowerCase();
        const start = i + 1;
        next = items.slice(start).concat(items.slice(0, start)).find((it) => (it.textContent || "").trim().toLowerCase().startsWith(k));
      }
      if (next) {
        e.preventDefault();
        next.focus({ preventScroll: true });
      }
    }));
    offs.push(on(el, "click", (e) => {
      const item = e.target.closest(".rf-menu-item, .rf-menu-tile");
      if (!item || item.disabled || item.getAttribute("aria-disabled") === "true") return;
      const role = item.getAttribute("role");
      if (role === "menuitemcheckbox") item.setAttribute("aria-checked", item.getAttribute("aria-checked") === "true" ? "false" : "true");
      if (role === "menuitemradio") {
        const group2 = item.closest('[role="group"]') || el;
        group2.querySelectorAll('[role="menuitemradio"]').forEach((r) => r.setAttribute("aria-checked", r === item ? "true" : "false"));
      }
      const label = Array.from(item.childNodes).filter((n) => !(n.nodeType === 1 && n.matches(".rf-kbd, .rf-menu-check, .rf-icon, svg, [data-icon]"))).map((n) => n.textContent).join("").trim();
      emit(el, "rf-select", { item, value: item.getAttribute("data-value") || label, label });
      if (!item.hasAttribute("data-keep-open")) close(el);
    }));
    return () => offs.forEach((f) => f());
  }
  var menu = { open, close, toggle };

  // src/js/components/dialog.js
  function dialogBehavior(el) {
    const offs = [];
    if (el.getAttribute("closedby") === "any" && !supports.closedBy) {
      offs.push(on(el, "click", (e) => {
        if (e.target !== el) return;
        const r = el.getBoundingClientRect();
        const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
        if (!inside) el.close("dismiss");
      }));
    }
    offs.push(on(el, "close", () => emit(el, "rf-close", { value: el.returnValue })));
    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(() => {
        if (!el.open || modality() === "keyboard") return;
        requestAnimationFrame(() => {
          const a = document.activeElement;
          if (!a || a === el || !el.contains(a)) return;
          if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
          el.focus({ preventScroll: true });
        });
      });
      mo.observe(el, { attributes: true, attributeFilter: ["open"] });
      offs.push(() => mo.disconnect());
    }
    return () => offs.forEach((f) => f());
  }
  var esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function open2(target) {
    if (target instanceof HTMLElement) {
      target.showModal();
      return new Promise((resolve) => target.addEventListener("close", () => resolve(target.returnValue), { once: true }));
    }
    const o = target || {};
    const d = document.createElement("dialog");
    const id = `rf-dlg-${Math.random().toString(36).slice(2, 8)}`;
    d.className = "rf-dialog rf-glass";
    d.setAttribute("data-variant", "thick");
    if (o.tone) d.setAttribute("data-tone", o.tone);
    if (o.dismissible !== false) d.setAttribute("closedby", "any");
    d.setAttribute("aria-labelledby", `${id}-t`);
    if (o.message) d.setAttribute("aria-describedby", `${id}-m`);
    const actions = o.actions || [{ label: "OK", value: "ok", variant: "filled" }];
    d.innerHTML = `<form method="dialog">
    ${o.icon ? `<div class="rf-dialog-icon">${icon(o.icon)}</div>` : ""}
    <h2 class="rf-dialog-title" id="${id}-t">${esc(o.title)}</h2>
    ${o.message ? `<p class="rf-dialog-message" id="${id}-m">${esc(o.message)}</p>` : ""}
    <div class="rf-dialog-actions"${actions.length > 2 ? " data-stack" : ""}>
      ${actions.map((a) => `<button class="rf-btn" value="${esc(a.value ?? a.label)}" data-variant="${esc(a.variant || "gray")}"${a.tone ? ` data-tone="${esc(a.tone)}"` : ""}${a.autofocus ? " autofocus" : ""}>${esc(a.label)}</button>`).join("")}
    </div></form>`;
    document.body.appendChild(d);
    dialogBehavior(d);
    d.showModal();
    return new Promise((resolve) => {
      d.addEventListener("close", () => {
        resolve(d.returnValue || "dismiss");
        setTimeout(() => d.remove(), 400);
      }, { once: true });
    });
  }
  var dialog = { open: open2, close: (el, value) => el.close(value) };

  // src/js/components/sheet.js
  var ORDER = ["small", "medium", "large"];
  function detentsOf(el) {
    const list = (el.getAttribute("data-detents") || "medium large").split(/\s+/).filter((d) => ORDER.includes(d));
    return list.length ? list : ["medium", "large"];
  }
  function setDetent(el, name) {
    const list = detentsOf(el);
    const d = list.includes(name) ? name : list[0];
    el.setAttribute("data-detent", d);
    emit(el, "rf-detent", { detent: d });
    return d;
  }
  function open3(el, { detent } = {}) {
    setDetent(el, detent || el.getAttribute("data-detent") || detentsOf(el)[0]);
    el.style.removeProperty("--_drag-y");
    if (el.tagName === "DIALOG" && !el.hasAttribute("data-inline")) {
      if (!el.open) el.showModal();
    } else el.removeAttribute("hidden");
    return new Promise((resolve) => el.addEventListener("close", () => resolve(el.returnValue), { once: true }));
  }
  function close2(el, value) {
    if (el.tagName === "DIALOG" && el.open) el.close(value);
    else if (el.hasAttribute("data-inline") && el.hasAttribute("data-dismissible")) {
      el.style.setProperty("--_drag-y", `${el.offsetHeight + 48}px`);
      setTimeout(() => {
        el.setAttribute("hidden", "");
        el.style.removeProperty("--_drag-y");
        el.dispatchEvent(new Event("close"));
      }, 420);
    }
  }
  function sheetBehavior(el) {
    const handles = Array.from(el.querySelectorAll(".rf-sheet-grabber, .rf-sheet-header"));
    const offs = [];
    let drag = null;
    const onDown = (e) => {
      if (e.button > 0 || e.target.closest("button, a, input, textarea, select")) return;
      drag = { y: e.clientY, t: performance.now(), v: 0, last: e.clientY, h: el.offsetHeight };
      el.setAttribute("data-dragging", "");
      e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag) return;
      const now = performance.now();
      drag.v = (e.clientY - drag.last) / Math.max(1, now - drag.t);
      drag.last = e.clientY;
      drag.t = now;
      let dy = e.clientY - drag.y;
      if (dy < 0) dy = -Math.pow(-dy, 0.7);
      el.style.setProperty("--_drag-y", `${dy}px`);
    };
    const onUp = (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      const v = drag.v;
      el.removeAttribute("data-dragging");
      el.style.setProperty("--_drag-y", "0px");
      const list = detentsOf(el);
      let i = list.indexOf(el.getAttribute("data-detent"));
      if (i < 0) i = 0;
      const flick = Math.abs(v) > 0.6;
      if (dy < -60 || flick && v < 0) i = Math.min(list.length - 1, i + 1);
      else if (dy > 80 || flick && v > 0) {
        if (i === 0) {
          if (el.tagName === "DIALOG" && !el.hasAttribute("data-inline")) {
            el.style.setProperty("--_drag-y", `${Math.max(0, dy)}px`);
            requestAnimationFrame(() => {
              el.style.removeProperty("--_drag-y");
              close2(el, "dismiss");
            });
            drag = null;
            return;
          }
          if (el.hasAttribute("data-dismissible")) {
            close2(el, "dismiss");
            drag = null;
            return;
          }
        }
        i = Math.max(0, i - 1);
      }
      setDetent(el, list[i]);
      drag = null;
    };
    handles.forEach((hdl) => {
      offs.push(on(hdl, "pointerdown", onDown));
      offs.push(on(hdl, "pointermove", onMove));
      offs.push(on(hdl, "pointerup", onUp));
      offs.push(on(hdl, "pointercancel", onUp));
    });
    const grab = el.querySelector(".rf-sheet-grabber");
    if (grab) {
      grab.setAttribute("role", "button");
      grab.setAttribute("tabindex", "0");
      if (!grab.getAttribute("aria-label")) grab.setAttribute("aria-label", "Resize sheet");
      offs.push(on(grab, "keydown", (e) => {
        const list = detentsOf(el);
        const i = list.indexOf(el.getAttribute("data-detent"));
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowUp") {
          e.preventDefault();
          setDetent(el, list[(i + 1) % list.length]);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setDetent(el, list[Math.max(0, i - 1)]);
        }
      }));
    }
    if (el.tagName === "DIALOG" && el.getAttribute("closedby") === "any" && !("closedBy" in HTMLDialogElement.prototype)) {
      offs.push(on(el, "click", (e) => {
        if (e.target !== el) return;
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top) close2(el, "dismiss");
      }));
    }
    if (!el.getAttribute("data-detent")) setDetent(el, detentsOf(el)[0]);
    return () => offs.forEach((f) => f());
  }
  var sheet = { open: open3, close: close2, detent: setDetent };

  // src/js/core/prefs.js
  var PAIR = { light: "dark", dark: "light", "light-contrast": "dark-contrast", "dark-contrast": "light-contrast" };
  var fire = (detail) => hasDOM && document.dispatchEvent(new CustomEvent("rf:preferences", { detail }));
  function toneTheme(tone, page) {
    if (!tone) return null;
    if (tone === "inverse") return PAIR[page] || "dark";
    const contrast = /contrast$/.test(page) ? "-contrast" : "";
    return (tone === "dark" ? "dark" : "light") + contrast;
  }
  function watchTheme(fn) {
    if (!hasDOM || typeof MutationObserver === "undefined") return () => {
    };
    const mo = new MutationObserver(() => fn());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("rf:preferences", fn);
    return () => {
      mo.disconnect();
      document.removeEventListener("rf:preferences", fn);
    };
  }
  function setDensity(value, el = hasDOM ? document.documentElement : null) {
    if (!el) return;
    const v = clamp(Number(value), 0, 1);
    el.style.setProperty("--rf-density", String(v));
    fire({ density: v });
    return v;
  }
  function setMotion(mode2 = "system") {
    const d = document.documentElement.dataset;
    if (mode2 === "system") delete d.rfMotion;
    else d.rfMotion = mode2;
    fire({ motion: mode2 });
  }
  function setTransparency(mode2 = "system") {
    const d = document.documentElement.dataset;
    if (mode2 === "system") delete d.rfTransparency;
    else d.rfTransparency = mode2;
    fire({ transparency: mode2 });
  }
  function systemTheme() {
    const dark = media.dark.matches, hc = media.contrast.matches;
    return (dark ? "dark" : "light") + (hc ? "-contrast" : "");
  }
  var autoOff = null;
  var theme = {
    get(el = document.documentElement) {
      const host = el.closest ? el.closest("[data-theme]") : null;
      return host && host.getAttribute("data-theme") || systemTheme();
    },
    set(id, el = document.documentElement) {
      el.setAttribute("data-theme", id);
      fire({ theme: id });
      return id;
    },
    /** Follow the OS: colour scheme and Increase Contrast. Returns a stop function. */
    auto(el = document.documentElement) {
      if (autoOff) autoOff();
      const apply = () => theme.set(systemTheme(), el);
      apply();
      media.dark.addEventListener("change", apply);
      media.contrast.addEventListener("change", apply);
      autoOff = () => {
        media.dark.removeEventListener("change", apply);
        media.contrast.removeEventListener("change", apply);
        autoOff = null;
      };
      return autoOff;
    },
    opposite(id) {
      return PAIR[id] || "dark";
    },
    /**
     * Small glass flips light/dark to stay legible over what scrolls beneath it.
     * Mark content regions with data-rf-tone="dark" or "light"; the element takes the matching theme.
     */
    adapt(el, { root = document } = {}) {
      let frame2 = 0;
      const check = () => {
        frame2 = 0;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const prev = el.style.pointerEvents;
        el.style.pointerEvents = "none";
        const stack = document.elementsFromPoint(x, y);
        el.style.pointerEvents = prev;
        let tone = null;
        for (const n of stack) {
          if (n === el || el.contains(n)) continue;
          const t = n.closest && n.closest("[data-rf-tone]");
          if (t) {
            tone = t.getAttribute("data-rf-tone");
            break;
          }
        }
        const page = theme.get(el.parentElement || document.documentElement);
        const want = toneTheme(tone, page);
        if (want && want !== page) el.setAttribute("data-theme", want);
        else el.removeAttribute("data-theme");
      };
      const schedule2 = () => {
        if (!frame2) frame2 = requestAnimationFrame(check);
      };
      const scroller = root === document ? window : root;
      scroller.addEventListener("scroll", schedule2, { passive: true, capture: true });
      window.addEventListener("resize", schedule2, { passive: true });
      const stop = watchTheme(schedule2);
      schedule2();
      return () => {
        scroller.removeEventListener("scroll", schedule2, { capture: true });
        window.removeEventListener("resize", schedule2);
        stop();
      };
    },
    /**
     * A content region with a fixed tone (a night photo, an inverse band): glass inside it takes
     * that tone. Glass marked data-rf-adapt is left to adapt(). Returns cleanup.
     */
    region(el) {
      const apply = () => {
        const page = theme.get(el.parentElement || document.documentElement);
        const want = toneTheme(el.getAttribute("data-rf-tone"), page);
        el.querySelectorAll(".rf-glass").forEach((g) => {
          if (g.closest("[data-rf-tone]") !== el || g.hasAttribute("data-rf-adapt")) return;
          if (g.hasAttribute("data-theme") && !g.hasAttribute("data-rf-toned")) return;
          if (want && want !== page) {
            g.setAttribute("data-theme", want);
            g.setAttribute("data-rf-toned", "");
          } else {
            g.removeAttribute("data-theme");
            g.removeAttribute("data-rf-toned");
          }
        });
      };
      apply();
      return watchTheme(apply);
    }
  };
  if (hasDOM) {
    media.motion.addEventListener("change", () => fire({ motion: "system" }));
    media.transparency.addEventListener("change", () => fire({ transparency: "system" }));
  }

  // src/js/components/effects.js
  function morphOpen(trigger, surface, { focus = true } = {}) {
    surface._rfMorphToken = null;
    surface.removeAttribute("hidden");
    surface.setAttribute("data-open", "");
    trigger.setAttribute("aria-expanded", "true");
    surface._rfMorphTrigger = trigger;
    const done2 = materialize(surface, { from: trigger, hideSource: true, wobble: 0.025 });
    if (focus) {
      const f = surface.querySelector('[autofocus], input, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
    }
    emit(surface, "rf-open", {});
    return done2;
  }
  function morphClose(surface) {
    const trigger = surface._rfMorphTrigger;
    if (surface.hasAttribute("hidden") || surface._rfMorphToken) return Promise.resolve();
    const token = {};
    surface._rfMorphToken = token;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    return dematerialize(surface, { to: trigger && trigger.isConnected ? trigger : null }).then(() => {
      if (surface._rfMorphToken !== token) return;
      surface._rfMorphToken = null;
      const hadFocus = surface.contains(document.activeElement);
      surface.setAttribute("hidden", "");
      surface.removeAttribute("data-open");
      settle(surface);
      if (hadFocus && trigger) trigger.focus({ preventScroll: true });
      emit(surface, "rf-close", {});
    });
  }
  function transition(update) {
    if (!supports.viewTransition || prefs.reducedMotion) {
      update();
      return Promise.resolve();
    }
    const vt = document.startViewTransition(update);
    return vt.finished;
  }
  var morph = {
    open: morphOpen,
    close: morphClose,
    toggle: (trigger, surface) => surface.hasAttribute("hidden") || surface._rfMorphToken ? morphOpen(trigger, surface) : morphClose(surface),
    transition
  };
  function morphTriggerBehavior(trigger) {
    const sel = trigger.getAttribute("data-rf-morph");
    const surface = sel && document.querySelector(sel);
    if (!surface) return;
    trigger.setAttribute("aria-controls", surface.id || "");
    trigger.setAttribute("aria-expanded", "false");
    const offs = [];
    offs.push(on(trigger, "click", () => morph.toggle(trigger, surface)));
    offs.push(on(surface, "keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        morphClose(surface);
      }
    }));
    offs.push(on(document, "pointerdown", (e) => {
      if (surface.hasAttribute("hidden") || surface._rfMorphToken || surface.contains(e.target) || trigger.contains(e.target)) return;
      morphClose(surface);
    }));
    surface.querySelectorAll("[data-rf-close]").forEach((b) => offs.push(on(b, "click", () => morphClose(surface))));
    return () => offs.forEach((f) => f());
  }
  function activityBehavior(el) {
    const btn = el.querySelector(".rf-activity-compact");
    if (!btn) return;
    const detail = el.querySelector(".rf-activity-detail");
    if (detail && !detail.id) detail.id = `rf-act-${Math.random().toString(36).slice(2, 7)}`;
    if (detail) btn.setAttribute("aria-controls", detail.id);
    const set = (expanded) => {
      const first = el.getBoundingClientRect();
      const r0 = getComputedStyle(el).borderTopLeftRadius;
      if (!expanded && detail && el.getAttribute("data-expanded") === "true" && !prefs.reducedMotion) {
        const ghost = detail.cloneNode(true);
        ghost.removeAttribute("id");
        ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
        Object.assign(ghost.style, { position: "absolute", left: `${detail.offsetLeft}px`, top: `${detail.offsetTop}px`, width: `${detail.offsetWidth}px`, display: "grid", pointerEvents: "none" });
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        el.appendChild(ghost);
        ghost.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(5px)", transform: "translateY(-6px)" }], { duration: 200, easing: easing("ease-exit"), fill: "forwards" }).finished.then(() => ghost.remove(), () => ghost.remove());
      }
      el.setAttribute("data-expanded", String(expanded));
      btn.setAttribute("aria-expanded", String(expanded));
      const last = el.getBoundingClientRect();
      const r1 = getComputedStyle(el).borderTopLeftRadius;
      const rr0 = Math.min(parseFloat(r0) || 0, first.height / 2), rr1 = Math.min(parseFloat(r1) || 0, last.height / 2);
      el.setAttribute("data-rf-resizing", "");
      const a = animate(el, [
        { width: `${first.width}px`, height: `${first.height}px`, borderRadius: `${rr0}px` },
        { width: `${last.width}px`, height: `${last.height}px`, borderRadius: `${rr1}px` }
      ], { spring: expanded ? "spring-gel" : "spring-smooth", fill: "none" });
      a.finished.then(() => el.removeAttribute("data-rf-resizing"), () => el.removeAttribute("data-rf-resizing"));
      if (expanded) {
        sweep(el, { from: -140, duration: 1e3 });
        jiggle(el, { angle: 90, amount: 0.025, duration: 700, delay: 180 });
        if (detail) {
          Array.from(detail.children).forEach((k, i) => animate(k, [
            { opacity: 0, filter: "blur(6px)", transform: "translateY(-8px) scale(0.97)" },
            { opacity: 1, filter: "blur(0px)", transform: "translateY(0px) scale(1)" }
          ], { duration: 420, delay: 110 + Math.min(i, 6) * 40, easing: easing("ease-enter"), fill: "backwards" }));
        }
      }
      emit(el, "rf-toggle", { expanded });
    };
    if (!el.hasAttribute("data-expanded")) el.setAttribute("data-expanded", "false");
    btn.setAttribute("aria-expanded", el.getAttribute("data-expanded"));
    const offs = [];
    offs.push(on(btn, "click", () => set(el.getAttribute("data-expanded") !== "true")));
    offs.push(on(el, "keydown", (e) => {
      if (e.key === "Escape" && el.getAttribute("data-expanded") === "true") {
        set(false);
        btn.focus();
      }
    }));
    el._rfActivity = { set };
    return () => offs.forEach((f) => f());
  }
  var tip = null;
  var tipTimer = 0;
  var tipFor = null;
  function tipEl() {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement("div");
    tip.className = "rf-tooltip rf-glass";
    tip.setAttribute("data-variant", "thick");
    tip.setAttribute("role", "tooltip");
    tip.id = "rf-tooltip";
    if (supports.popover) tip.setAttribute("popover", "manual");
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(el) {
    const t = tipEl();
    t.textContent = el.getAttribute("data-rf-tooltip");
    tipFor = el;
    el.setAttribute("aria-describedby", "rf-tooltip");
    if (supports.popover) {
      try {
        t.showPopover();
      } catch (e) {
      }
    } else t.setAttribute("data-open", "");
    const size = { width: t.offsetWidth, height: t.offsetHeight };
    const pos = place(el, size, "above");
    t.style.left = `${Math.round(pos.left)}px`;
    t.style.top = `${Math.round(pos.top)}px`;
    t.style.transformOrigin = pos.anchorY === "bottom" ? "50% 100%" : "50% 0%";
    t.style.setProperty("--_tip-from", pos.anchorY === "bottom" ? "6px" : "-6px");
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!tip) return;
    if (tipFor) tipFor.removeAttribute("aria-describedby");
    tipFor = null;
    if (supports.popover) {
      try {
        tip.hidePopover();
      } catch (e) {
      }
    } else tip.removeAttribute("data-open");
  }
  function tooltipBehavior(el) {
    const offs = [];
    offs.push(on(el, "pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(el), tip && tip.matches(":popover-open") ? 0 : 450);
    }));
    offs.push(on(el, "pointerleave", hideTip));
    offs.push(on(el, "focus", () => {
      if (el.matches(":focus-visible")) showTip(el);
    }));
    offs.push(on(el, "blur", hideTip));
    offs.push(on(el, "keydown", (e) => {
      if (e.key === "Escape") hideTip();
    }));
    offs.push(on(el, "pointerdown", hideTip));
    return () => offs.forEach((f) => f());
  }
  var revealIO = null;
  function revealBehavior(el) {
    if (supports.scrollTimeline || prefs.reducedMotion || !("IntersectionObserver" in window)) return;
    document.documentElement.setAttribute("data-rf-reveal-fallback", "");
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.setAttribute("data-revealed", "");
          revealIO.unobserve(en.target);
        }
      }), { threshold: 0.15 });
    }
    revealIO.observe(el);
    return () => revealIO && revealIO.unobserve(el);
  }
  function tiltBehavior(el) {
    const max = parseFloat(el.getAttribute("data-tilt-max")) || 7;
    const offs = [];
    offs.push(on(el, "pointermove", (e) => {
      if (prefs.reducedMotion || e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const px2 = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
      el.setAttribute("data-tilting", "");
      el.style.setProperty("--_ry", `${((px2 - 0.5) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--_rx", `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty("--_sx", `${(px2 * 100).toFixed(1)}%`);
      el.style.setProperty("--_sy", `${(py * 100).toFixed(1)}%`);
    }));
    offs.push(on(el, "pointerleave", () => {
      el.removeAttribute("data-tilting");
      el.style.setProperty("--_rx", "0deg");
      el.style.setProperty("--_ry", "0deg");
    }));
    return () => offs.forEach((f) => f());
  }
  function loupeBehavior(el) {
    if (!el.hasAttribute("data-lens")) el.setAttribute("data-lens", "strong");
    lens(el);
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", "Magnifier. Use arrow keys to move.");
    el.setAttribute("role", el.getAttribute("role") || "slider");
    const host = el.offsetParent || el.parentElement;
    let x = parseFloat(el.style.getPropertyValue("--_x")) || 40, y = parseFloat(el.style.getPropertyValue("--_y")) || 40;
    const set = (nx, ny) => {
      const w = host.clientWidth - el.offsetWidth, h = host.clientHeight - el.offsetHeight;
      x = clamp(nx, 0, w);
      y = clamp(ny, 0, h);
      el.style.setProperty("--_x", `${x}px`);
      el.style.setProperty("--_y", `${y}px`);
      el.setAttribute("aria-valuetext", `${Math.round(x)}, ${Math.round(y)}`);
    };
    set(x, y);
    let d = null;
    const offs = [];
    offs.push(on(el, "pointerdown", (e) => {
      d = { x: e.clientX - x, y: e.clientY - y };
      el.setPointerCapture(e.pointerId);
      el.setAttribute("data-dragging", "");
    }));
    offs.push(on(el, "pointermove", (e) => {
      if (d) set(e.clientX - d.x, e.clientY - d.y);
    }));
    const up = () => {
      d = null;
      el.removeAttribute("data-dragging");
    };
    offs.push(on(el, "pointerup", up));
    offs.push(on(el, "pointercancel", up));
    offs.push(on(el, "keydown", (e) => {
      const step = e.shiftKey ? 40 : 10;
      const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!m) return;
      e.preventDefault();
      set(x + m[0], y + m[1]);
    }));
    return () => offs.forEach((f) => f());
  }
  function dropletsBehavior(el) {
    const main = el.firstElementChild;
    if (!main) return;
    const rest = Array.from(el.children).slice(1);
    main.setAttribute("aria-expanded", "false");
    const setOpen = (open4, animateIt = true) => {
      el.toggleAttribute("data-open", open4);
      main.setAttribute("aria-expanded", String(open4));
      rest.forEach((b) => {
        b.tabIndex = open4 ? 0 : -1;
        b.setAttribute("aria-hidden", String(!open4));
      });
      if (!animateIt) return;
      jiggle(main, { angle: 90, amount: open4 ? 0.1 : 0.07, impact: open4, duration: 620 });
      if (open4) rest.forEach((b, i) => jiggle(b, { angle: 45 + i * 45, amount: 0.12, impact: true, duration: 600, delay: 260 + i * 40 }));
    };
    setOpen(false, false);
    const offs = [];
    offs.push(on(main, "click", () => setOpen(!el.hasAttribute("data-open"))));
    offs.push(on(el, "keydown", (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        main.focus();
      }
    }));
    rest.forEach((b) => offs.push(on(b, "click", () => {
      emit(el, "rf-select", { item: b });
      setOpen(false);
    })));
    return () => offs.forEach((f) => f());
  }
  var groupItems = (el) => Array.from(el.children).filter((c) => c.classList.contains("rf-glass") && !c.hasAttribute("data-leaving") && !c.hidden);
  var RADII = ["border-start-start-radius", "border-start-end-radius", "border-end-start-radius", "border-end-end-radius"];
  function fillOf(item) {
    const layer2 = item.hasAttribute("data-lens-ready") && item.querySelector(":scope > .rf-lens-layer");
    const bg = getComputedStyle(layer2 || item).backgroundColor;
    return bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? bg : null;
  }
  function groupMotion(el, items, p0) {
    const cs = getComputedStyle(el);
    const open4 = parseFloat(cs.getPropertyValue("--_gap-open")) || parseFloat(cs.columnGap) || 8;
    const st = { p: p0, dir: 0, bridges: [] };
    st.done = new Promise((resolve) => {
      st.resolve = resolve;
    });
    el.style.transition = "none";
    items.forEach((it) => {
      it.style.transitionProperty = "scale, translate, box-shadow, background-color";
    });
    for (let i = 0; i < items.length - 1; i++) {
      const b = document.createElement("span");
      b.className = "rf-glass-bridge";
      b.setAttribute("aria-hidden", "true");
      const f0 = fillOf(items[i]), f1 = fillOf(items[i + 1]);
      if (f0 || f1) b.style.backgroundImage = `linear-gradient(to right, ${f0 || f1}, ${f1 || f0})`;
      el.appendChild(b);
      st.bridges.push({ el: b, snap: null });
    }
    const neck = (b, i, p) => {
      const a = items[i], c = items[i + 1];
      const h = Math.min(a.offsetHeight, c.offsetHeight);
      const t = st.dir > 0 ? p < 0.55 ? h * (0.8 - p) : 0 : p < 0.5 ? h * (0.84 - 1.1 * p) : 0;
      if (st.dir > 0 && p >= 0.55) {
        if (!b.snap) {
          b.snap = b.el.animate([{ opacity: 1, transform: "scaleY(1)" }, { opacity: 0, transform: "scale(0.4, 0)" }], { duration: 140, easing: "cubic-bezier(0.3, 0, 0.6, 1)", fill: "forwards" });
          jiggle(items[i], { angle: 0, amount: 0.06, duration: 560 });
          jiggle(items[i + 1], { angle: 0, amount: 0.06, duration: 560 });
        }
        return;
      }
      if (b.snap) {
        b.snap.cancel();
        b.snap = null;
      }
      const ax1 = a.offsetLeft + a.offsetWidth, cx1 = c.offsetLeft + c.offsetWidth;
      const [g0, g1] = ax1 <= c.offsetLeft + 1 ? [ax1, c.offsetLeft] : [cx1, a.offsetLeft];
      const reach = h * 0.3;
      Object.assign(b.el.style, {
        left: `${g0 - reach}px`,
        width: `${Math.max(0, g1 - g0 + reach * 2)}px`,
        top: `${a.offsetTop + a.offsetHeight / 2 - t / 2}px`,
        height: `${Math.max(0, t)}px`,
        opacity: t > 0.5 ? "1" : "0"
      });
    };
    const frame2 = (p) => {
      st.p = p;
      el.style.columnGap = `${(Math.max(0, p) * open4).toFixed(2)}px`;
      const round = clamp(p / 0.35, 0, 1);
      items.forEach((it, i) => {
        const r = `${2 + (it.offsetHeight / 2 - 2) * round}px`;
        const first = i === 0, last = i === items.length - 1;
        if (!last) {
          it.style.borderStartEndRadius = r;
          it.style.borderEndEndRadius = r;
        }
        if (!first) {
          it.style.borderStartStartRadius = r;
          it.style.borderEndStartRadius = r;
        }
        it.style.transform = p < 0 ? `scale(${1 + p * 0.3}, ${1 - p * 0.22})` : "";
      });
      st.bridges.forEach((b, i) => neck(b, i, p));
    };
    st.spring = springValue({
      value: p0,
      stiffness: 150,
      damping: 13,
      onUpdate: frame2,
      onRest: () => {
        if (st.dir < 0) jiggle(el, { angle: 0, amount: 0.035, impact: true, duration: 620 });
        st.bridges.forEach((b) => b.el.remove());
        el.style.removeProperty("column-gap");
        el.style.removeProperty("transition");
        items.forEach((it) => {
          RADII.concat(["transform", "transition-property"]).forEach((prop) => it.style.removeProperty(prop));
        });
        el._rfGroup = null;
        st.resolve();
      }
    });
    frame2(p0);
    return st;
  }
  function merge(el, merged = true) {
    merged = !!merged;
    if (el.hasAttribute("data-merged") === merged && !el._rfGroup) return Promise.resolve();
    el.toggleAttribute("data-merged", merged);
    emit(el, "rf-merge", { merged });
    const items = groupItems(el);
    if (!hasDOM || prefs.reducedMotion || items.length < 2) return Promise.resolve();
    const st = el._rfGroup || (el._rfGroup = groupMotion(el, items, merged ? 1 : 0));
    st.dir = merged ? -1 : 1;
    st.spring.to(merged ? 0 : 1);
    return st.done;
  }
  var group = {
    merge,
    add(el, node) {
      node.setAttribute("data-entering", "");
      el.appendChild(node);
      setTimeout(() => node.removeAttribute("data-entering"), duration("duration-spring-gel", 600));
      if (window.Refract) window.Refract.init(node);
      return node;
    },
    remove(node) {
      node.setAttribute("data-leaving", "");
      setTimeout(() => node.remove(), duration("duration-spring-smooth", 640));
    }
  };

  // src/js/components/registry.js
  var behaviors = {
    switch: switchBehavior,
    slider: sliderBehavior,
    stepper: stepperBehavior,
    search: searchBehavior,
    chip: chipBehavior,
    playpause: playPauseBehavior,
    tabbar: tabbarBehavior,
    segmented: segmentedBehavior,
    pagedots: pagedotsBehavior,
    navbar: navbarBehavior,
    "scroll-edge": scrollEdgeBehavior,
    sidebar: sidebarBehavior,
    toolbar: toolbarBehavior,
    menu: menuBehavior,
    popover: menuBehavior,
    dialog: dialogBehavior,
    sheet: sheetBehavior,
    activity: activityBehavior,
    tooltip: tooltipBehavior,
    reveal: revealBehavior,
    tilt: tiltBehavior,
    loupe: loupeBehavior,
    droplets: dropletsBehavior,
    morph: morphTriggerBehavior,
    tone: (el) => theme.region(el),
    adapt: (el) => theme.adapt(el)
  };
  var auto = [
    [".rf-switch", "switch"],
    [".rf-slider", "slider"],
    [".rf-stepper", "stepper"],
    [".rf-search", "search"],
    [".rf-chip", "chip"],
    [".rf-playpause", "playpause"],
    [".rf-tabbar", "tabbar"],
    [".rf-segmented", "segmented"],
    [".rf-pagedots", "pagedots"],
    [".rf-navbar", "navbar"],
    [".rf-scroll-edge[data-watch]", "scroll-edge"],
    [".rf-sidebar", "sidebar"],
    [".rf-toolbar", "toolbar"],
    [".rf-menu[popover], .rf-popover[popover], .rf-menu[id], .rf-popover[id]", "menu"],
    ["dialog.rf-dialog", "dialog"],
    [".rf-sheet", "sheet"],
    [".rf-activity", "activity"],
    ["[data-rf-tooltip]", "tooltip"],
    ["[data-reveal]", "reveal"],
    [".rf-loupe", "loupe"],
    [".rf-droplets", "droplets"],
    ["[data-rf-morph]", "morph"],
    ["[data-rf-tone]", "tone"],
    ["[data-rf-adapt]", "adapt"]
  ];

  // src/js/components/toast.js
  var TONE_ICON = { positive: "check-circle", critical: "x-circle", caution: "alert", neutral: "info", accent: "info" };
  var MAX = 3;
  var toasters = {};
  function toaster(position = "top") {
    let t = toasters[position];
    if (t && t.isConnected) return t;
    t = document.createElement("section");
    t.className = "rf-toaster";
    t.setAttribute("data-position", position);
    t.setAttribute("aria-label", "Notifications");
    t.setAttribute("aria-live", "polite");
    if (supports.popover) t.setAttribute("popover", "manual");
    else t.setAttribute("data-static", "");
    document.body.appendChild(t);
    toasters[position] = t;
    return t;
  }
  var esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function dropIn(el, fromBelow) {
    if (prefs.reducedMotion || !el.animate) return el.animate ? el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }) : null;
    const w = el.offsetWidth, h = el.offsetHeight, r = h / 2, side = Math.max(0, (w - h) / 2);
    const fall = fromBelow ? "34px" : "-34px";
    Array.from(el.children).forEach((k, i) => k.animate([
      { opacity: 0, filter: "blur(6px)", transform: "scale(0.92)" },
      { opacity: 1, filter: "blur(0px)", transform: "scale(1)" }
    ], { duration: 360, delay: 230 + i * 30, easing: easing("ease-enter"), fill: "backwards" }));
    el.animate([{ "--rf-mat": 0.25, "--rf-sweep": "-150deg" }, { "--rf-mat": 1, "--rf-sweep": "0deg" }], { duration: 820, easing: easing("ease-enter"), fill: "backwards" });
    setTimeout(() => {
      if (!el.isConnected || el.hasAttribute("data-leaving")) return;
      jiggle(el, { angle: 90, amount: 0.09, impact: true, duration: 620 });
    }, 300);
    setTimeout(() => {
      if (!el.isConnected || el.hasAttribute("data-leaving")) return;
      const rc = el.getBoundingClientRect(), c = getComputedStyle(el).getPropertyValue("--_tone").trim();
      const colors = c ? [c, `color-mix(in oklab, ${c} 55%, white)`] : void 0, y = rc.top + rc.height / 2;
      const up = fromBelow ? 1 : -1;
      burst(el, { x: rc.left + rc.height * 0.3, y, count: 4, size: [4, 7], spread: 0.55, gravity: 1.3, ring: false, arc: up < 0 ? [-175, -125] : [125, 175], colors });
      burst(el, { x: rc.right - rc.height * 0.3, y, count: 4, size: [4, 7], spread: 0.55, gravity: 1.3, ring: false, arc: up < 0 ? [-55, -5] : [5, 55], colors });
    }, 400);
    return el.animate([
      { clipPath: `inset(0px ${side}px 0px ${side}px round ${r}px)`, translate: `0 ${fall}`, scale: "0.55", opacity: 0, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" },
      { clipPath: `inset(0px ${side}px 0px ${side}px round ${r}px)`, translate: "0 0", scale: "1", opacity: 1, offset: 0.34, easing: easing("spring-gel", "cubic-bezier(0.2, 0, 0, 1)") },
      { clipPath: `inset(0px 0px 0px 0px round ${r}px)`, translate: "0 0", scale: "1", opacity: 1 }
    ], { duration: 900 });
  }
  function liftOut(el, toBelow) {
    if (prefs.reducedMotion || !el.animate) return el.animate ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }) : null;
    const w = el.offsetWidth, h = el.offsetHeight, r = h / 2, side = Math.max(0, (w - h) / 2);
    Array.from(el.children).forEach((k) => k.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(4px)" }], { duration: 160, easing: easing("ease-exit"), fill: "forwards" }));
    el.animate([{ "--rf-mat": 1 }, { "--rf-mat": 1, offset: 0.4 }, { "--rf-mat": 0 }], { duration: 560, fill: "forwards" });
    return el.animate([
      { clipPath: `inset(0px 0px 0px 0px round ${r}px)`, translate: "0 0", scale: "1", opacity: 1, easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
      { clipPath: `inset(0px ${side}px 0px ${side}px round ${r}px)`, translate: "0 0", scale: "1", opacity: 1, offset: 0.5, easing: "cubic-bezier(0.5, 0, 0.9, 0.4)" },
      { clipPath: `inset(0px ${side}px 0px ${side}px round ${r}px)`, translate: `0 ${toBelow ? "30px" : "-30px"}`, scale: "0.4", opacity: 0 }
    ], { duration: 560, fill: "forwards" });
  }
  function toast(input) {
    const o = typeof input === "string" ? { title: input } : { ...input || {} };
    const tone = o.tone || "neutral";
    const host = toaster(o.position || "top");
    const el = document.createElement("div");
    el.className = "rf-toast rf-glass";
    el.setAttribute("data-tone", tone);
    el.setAttribute("role", tone === "critical" ? "alert" : "status");
    const ic = o.icon === false ? "" : `<span class="rf-toast-icon">${icon(o.icon || TONE_ICON[tone] || "info")}</span>`;
    el.innerHTML = `${ic}<div class="rf-toast-body"><span class="rf-toast-title">${esc2(o.title)}</span>${o.message ? `<span class="rf-toast-message">${esc2(o.message)}</span>` : ""}</div>` + (o.action ? `<button class="rf-btn" data-size="sm" data-variant="${tone === "critical" ? "soft" : "gray"}"${tone === "critical" ? ' data-tone="critical"' : ""} type="button">${esc2(o.action.label)}</button>` : "") + `<button class="rf-btn rf-toast-close" data-shape="circle" data-size="sm" type="button" aria-label="Dismiss">${icon("close", { size: "sm" })}</button>`;
    const bottom = (o.position || "top") === "bottom";
    flip(host.querySelectorAll(".rf-toast:not([data-leaving])"), () => {
      if (bottom) host.appendChild(el);
      else host.prepend(el);
    });
    if (supports.popover && !host.matches(":popover-open")) {
      try {
        host.showPopover();
      } catch (e) {
      }
    }
    const all = Array.from(host.querySelectorAll(".rf-toast:not([data-leaving])"));
    if (all.length > MAX) close3(all[bottom ? 0 : all.length - 1]);
    if (window.Refract && window.Refract.light) window.Refract.light.register(el);
    dropIn(el, bottom);
    let timer = 0, remaining = o.duration ?? (o.action ? 6e3 : 4e3);
    const start = () => {
      if (remaining > 0) {
        const t0 = performance.now();
        timer = setTimeout(() => close3(el), remaining);
        el._rfT0 = t0;
      }
    };
    const pause = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
        remaining -= performance.now() - (el._rfT0 || performance.now());
      }
    };
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", start);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", start);
    start();
    const actionBtn = o.action ? el.querySelector(".rf-btn:not(.rf-toast-close)") : null;
    if (actionBtn) actionBtn.addEventListener("click", () => {
      try {
        o.action.onClick && o.action.onClick();
      } finally {
        close3(el);
      }
    });
    el.querySelector(".rf-toast-close").addEventListener("click", () => close3(el));
    const away = bottom ? 1 : -1;
    let sy = null, lastY = 0, lastT = 0, vy = 0;
    const follow = (d) => Math.sign(d) === away ? d : Math.sign(d) * Math.pow(Math.abs(d), 0.55);
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      sy = lastY = e.clientY;
      lastT = performance.now();
      vy = 0;
      el.setPointerCapture(e.pointerId);
      el.style.transition = "none";
    });
    el.addEventListener("pointermove", (e) => {
      if (sy == null) return;
      const now = performance.now();
      vy = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
      el.style.translate = `0 ${follow(e.clientY - sy).toFixed(1)}px`;
    });
    const letGo = (e) => {
      if (sy == null) return;
      const d = e.clientY - sy;
      sy = null;
      el.style.transition = "";
      if (d * away > 24 || vy * away > 0.45) {
        close3(el, { fling: { away, v: vy } });
        return;
      }
      const from = el.style.translate;
      el.style.translate = "";
      if (from && !prefs.reducedMotion) el.animate([{ translate: from }, { translate: "0 0" }], { duration: 1020, easing: easing("spring-jelly", "ease-out") });
    };
    el.addEventListener("pointerup", letGo);
    el.addEventListener("pointercancel", letGo);
    return { el, close: () => close3(el) };
  }
  function fling(el, { away, v }) {
    const from = el.style.translate || "0 0";
    el.style.translate = "";
    const spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6);
    const speed = Math.min(1.6, Math.max(0.6, Math.abs(v)));
    return el.animate([
      { translate: from, rotate: "0deg", opacity: 1 },
      { translate: `0 ${away * (el.offsetHeight + 110)}px`, rotate: `${spin}deg`, opacity: 0 }
    ], { duration: 420 / speed, easing: "cubic-bezier(0.25, 0.6, 0.4, 1)", fill: "forwards" });
  }
  function close3(el, how = {}) {
    if (!el || el.hasAttribute("data-leaving")) return;
    const host = el.parentElement;
    const bottom = host && host.getAttribute("data-position") === "bottom";
    if (host && !prefs.reducedMotion) {
      const box = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth };
      flip(Array.from(host.querySelectorAll(".rf-toast:not([data-leaving])")).filter((t) => t !== el), () => {
        el.setAttribute("data-leaving", "");
        Object.assign(el.style, { position: "absolute", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, margin: "0" });
      });
    } else el.setAttribute("data-leaving", "");
    const a = how.fling && !prefs.reducedMotion ? fling(el, how.fling) : liftOut(el, bottom);
    const done2 = () => {
      el.remove();
      if (host && !host.querySelector(".rf-toast") && supports.popover && host.matches(":popover-open")) {
        try {
          host.hidePopover();
        } catch (e) {
        }
      }
    };
    if (a && a.finished) a.finished.then(done2, done2);
    else done2();
  }
  toast.close = close3;
  toast.dismissAll = () => Object.values(toasters).forEach((t) => t.querySelectorAll(".rf-toast").forEach(close3));

  // src/js/react/index.js
  var NAMES = [
    "Icon",
    "Scene",
    "Glass",
    "Button",
    "Toolbar",
    "ToolbarGroup",
    "Menu",
    "MenuItem",
    "MenuSeparator",
    "MenuLabel",
    "MenuRow",
    "MenuTile",
    "Popover",
    "TabBar",
    "NavBar",
    "LargeTitle",
    "ScrollEdge",
    "Sidebar",
    "SidebarHeading",
    "SidebarItem",
    "SegmentedControl",
    "PageDots",
    "Switch",
    "Slider",
    "TextField",
    "SearchField",
    "Stepper",
    "Checkbox",
    "Radio",
    "Dialog",
    "Sheet",
    "ActivityCapsule",
    "Card",
    "List",
    "ListRow",
    "Avatar",
    "AvatarStack",
    "Badge",
    "Chip",
    "Progress",
    "Ring",
    "Spinner",
    "Skeleton",
    "MediaControls",
    "PlayPause",
    "GlassGroup",
    "Loupe",
    "Lens",
    "Droplets",
    "Reveal",
    "Scrim"
  ];
  var cx = (...a) => a.filter(Boolean).join(" ");
  var dataAttrs = (o) => {
    const out = {};
    Object.keys(o).forEach((k) => {
      const v = o[k];
      if (v === void 0 || v === null || v === false) return;
      out[`data-${k}`] = v === true ? "" : String(v);
    });
    return out;
  };
  function build(React, api2) {
    const { useRef, useEffect, useLayoutEffect, useState, useId, forwardRef } = React;
    const useEnhance = (extRef) => {
      const ref = useRef(null);
      useEffect(() => {
        if (ref.current) api2.init(ref.current);
      }, []);
      const setRef = (node) => {
        ref.current = node;
        if (typeof extRef === "function") extRef(node);
        else if (extRef) extRef.current = node;
      };
      return [ref, setRef];
    };
    const svg = (name, size, label) => ({ __html: api2.icon(name, { size, label }) });
    const Icon = ({ name, size, label, className }) => /* @__PURE__ */ React.createElement("span", { className: cx("rf-icon-wrap", className), style: { display: "contents" }, dangerouslySetInnerHTML: svg(name, size, label) });
    const Scene = forwardRef(function Scene2({ scene, as: As = "div", className, children, ...rest }, ref) {
      return /* @__PURE__ */ React.createElement(As, { ref, className: cx("rf-scene", className), "data-scene": scene, ...rest }, children);
    });
    const Glass = forwardRef(function Glass2({ as: As = "div", variant, shape, tone, lens: lens2, interactive, className, children, ...rest }, extRef) {
      const [, setRef] = useEnhance(extRef);
      return /* @__PURE__ */ React.createElement(
        As,
        {
          ref: setRef,
          className: cx("rf-glass", className),
          ...dataAttrs({ variant, shape, tone, lens: lens2 === true ? "" : lens2, interactive }),
          ...rest
        },
        children
      );
    });
    const Button = forwardRef(function Button2({ variant, tone, size, shape, glass, lens: lens2, loading, icon: icon2, iconEnd, menu: menu2, block, className, children, ...rest }, extRef) {
      const isGlass = glass || variant === "tinted" || variant === "glass";
      const [, setRef] = useEnhance(extRef);
      const v = variant === "glass" ? void 0 : variant;
      const extra = menu2 ? { popovertarget: menu2 } : {};
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          ref: setRef,
          type: "button",
          className: cx("rf-btn", isGlass && "rf-glass", className),
          ...dataAttrs({ variant: v, tone, size, shape, lens: isGlass && lens2 !== false ? lens2 === true || lens2 == null ? "" : lens2 : void 0, block }),
          "aria-busy": loading ? "true" : void 0,
          ...extra,
          ...rest
        },
        icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null,
        children != null ? /* @__PURE__ */ React.createElement("span", null, children) : null,
        iconEnd ? /* @__PURE__ */ React.createElement(Icon, { name: iconEnd }) : null,
        loading ? /* @__PURE__ */ React.createElement("span", { className: "rf-spinner", "data-size": "sm" }, /* @__PURE__ */ React.createElement("i", null)) : null
      );
    });
    const Toolbar = ({ position, label, className, children, ...rest }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, role: "toolbar", "aria-label": label, className: cx("rf-toolbar", className), ...dataAttrs({ position }), ...rest }, children);
    };
    const ToolbarGroup = ({ className, children, lens: lens2 = true, ...rest }) => /* @__PURE__ */ React.createElement("div", { className: cx("rf-toolbar-group", "rf-glass", className), ...dataAttrs({ lens: lens2 ? "" : void 0 }), ...rest }, children);
    const Menu = ({ id, label, placement, className, onSelect, children, ...rest }) => {
      const [ref, setRef] = useEnhance();
      useEffect(() => {
        const el = ref.current;
        if (!el || !onSelect) return void 0;
        const h = (e) => onSelect(e.detail);
        el.addEventListener("rf-select", h);
        return () => el.removeEventListener("rf-select", h);
      }, [onSelect]);
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: setRef,
          id,
          popover: "auto",
          role: "menu",
          "aria-label": label,
          className: cx("rf-menu", "rf-glass", className),
          "data-variant": "thick",
          ...dataAttrs({ placement }),
          ...rest
        },
        children
      );
    };
    const MenuItem = ({ icon: icon2, shortcut, tone, checked, type, value, keepOpen, disabled, children, ...rest }) => {
      const role = type === "checkbox" ? "menuitemcheckbox" : type === "radio" ? "menuitemradio" : "menuitem";
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: "rf-menu-item",
          role,
          "aria-checked": role === "menuitem" ? void 0 : String(!!checked),
          disabled,
          ...dataAttrs({ tone, value, "keep-open": keepOpen }),
          ...rest
        },
        role !== "menuitem" ? /* @__PURE__ */ React.createElement("span", { className: "rf-menu-check", dangerouslySetInnerHTML: svg("check") }) : null,
        icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null,
        /* @__PURE__ */ React.createElement("span", null, children),
        shortcut ? /* @__PURE__ */ React.createElement("span", { className: "rf-kbd" }, shortcut) : null
      );
    };
    const MenuSeparator = () => /* @__PURE__ */ React.createElement("hr", { className: "rf-menu-sep" });
    const MenuLabel = ({ children }) => /* @__PURE__ */ React.createElement("div", { className: "rf-menu-label" }, children);
    const MenuRow = ({ children }) => /* @__PURE__ */ React.createElement("div", { className: "rf-menu-row" }, children);
    const MenuTile = ({ icon: icon2, children, ...rest }) => /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-menu-tile", role: "menuitem", ...rest }, icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null, children);
    const Popover = ({ id, label, placement, className, children, ...rest }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, id, popover: "auto", role: "dialog", "aria-label": label, className: cx("rf-popover", "rf-glass", className), "data-variant": "thick", ...dataAttrs({ placement }), ...rest }, children);
    };
    const TabBar = ({ items = [], value, onChange, position = "bottom", minimizeOnScroll, search, onSearch, accessory, label = "Main", lens: lens2 = true, className }) => {
      const [ref, setRef] = useEnhance();
      useLayoutEffect(() => {
        if (ref.current) api2.refresh(ref.current);
      }, [value]);
      useEffect(() => {
        const el = ref.current;
        if (!el) return void 0;
        const h = (e) => {
          const it = items[e.detail.index];
          if (it && onChange) onChange(it.id ?? e.detail.index);
        };
        el.addEventListener("rf-select", h);
        return () => el.removeEventListener("rf-select", h);
      }, [items, onChange]);
      const L = lens2 ? { "data-lens": "" } : {};
      return /* @__PURE__ */ React.createElement("nav", { ref: setRef, className: cx("rf-tabbar", className), "aria-label": label, ...dataAttrs({ position, "minimize-on-scroll": minimizeOnScroll }) }, accessory ? /* @__PURE__ */ React.createElement("div", { className: "rf-tabbar-accessory rf-glass", ...L }, accessory) : null, /* @__PURE__ */ React.createElement("div", { className: "rf-tabbar-bar rf-glass", ...L }, items.map((it, i) => {
        const current = (it.id ?? i) === value;
        const props = { key: it.id ?? i, className: "rf-tab", "aria-current": current ? "page" : void 0 };
        const inner = [/* @__PURE__ */ React.createElement(Icon, { key: "i", name: it.icon }), /* @__PURE__ */ React.createElement("span", { key: "l", className: "rf-tab-label" }, it.label), it.badge ? /* @__PURE__ */ React.createElement("span", { key: "b", className: "rf-badge" }, it.badge) : null];
        return it.href ? /* @__PURE__ */ React.createElement("a", { href: it.href, ...props }, inner) : /* @__PURE__ */ React.createElement("button", { type: "button", ...props }, inner);
      })), search ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-tabbar-search rf-glass", "data-shape": "circle", "aria-label": "Search", onClick: onSearch, ...L }, /* @__PURE__ */ React.createElement(Icon, { name: "search" })) : null);
    };
    const NavBar = ({ title, leading, trailing, scroller, inlineTitle, className }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("header", { ref: setRef, className: cx("rf-navbar", className), ...dataAttrs({ scroller, title: inlineTitle ? "inline" : void 0 }) }, /* @__PURE__ */ React.createElement("div", { className: "rf-scroll-edge", "aria-hidden": "true" }), /* @__PURE__ */ React.createElement("div", { className: "rf-navbar-leading" }, leading), /* @__PURE__ */ React.createElement("h2", { className: "rf-navbar-title" }, title), /* @__PURE__ */ React.createElement("div", { className: "rf-navbar-trailing" }, trailing));
    };
    const LargeTitle = ({ children, as: As = "h1" }) => /* @__PURE__ */ React.createElement(As, { className: "rf-large-title" }, children);
    const ScrollEdge = ({ edge, hard, scroller, sticky }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: "rf-scroll-edge", "aria-hidden": "true", ...dataAttrs({ edge, style: hard ? "hard" : void 0, watch: true, scroller, sticky }) });
    };
    const Sidebar = ({ collapsed, float = true, label, header, className, children, lens: lens2 = "soft" }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("aside", { ref: setRef, className: cx("rf-sidebar", "rf-glass", className), "data-variant": "thick", "aria-label": label, ...dataAttrs({ float, collapsed, lens: lens2 }) }, header ? /* @__PURE__ */ React.createElement("div", { className: "rf-sidebar-header" }, header) : null, children);
    };
    const SidebarHeading = ({ children }) => /* @__PURE__ */ React.createElement("div", { className: "rf-sidebar-heading" }, children);
    const SidebarItem = ({ icon: icon2, label, count, badge, current, href, onClick }) => {
      const Tag = href ? "a" : "button";
      return /* @__PURE__ */ React.createElement(Tag, { className: "rf-sidebar-item", href, onClick, type: href ? void 0 : "button", "aria-current": current ? "page" : void 0 }, icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null, /* @__PURE__ */ React.createElement("span", { className: "rf-sidebar-label" }, label), badge != null ? /* @__PURE__ */ React.createElement("span", { className: "rf-badge", "data-tone": "accent" }, badge) : count != null ? /* @__PURE__ */ React.createElement("span", { className: "rf-sidebar-count" }, count) : null);
    };
    const SegmentedControl = ({ options = [], value, defaultValue, onChange, name, label, size, glass, block, className }) => {
      const auto2 = useId();
      const nm = name || `seg-${auto2}`;
      const [ref, setRef] = useEnhance();
      const controlled = value !== void 0;
      useLayoutEffect(() => {
        if (ref.current) api2.refresh(ref.current);
      }, [value]);
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, role: "radiogroup", "aria-label": label, className: cx("rf-segmented", glass && "rf-glass", className), ...dataAttrs({ size, block, lens: glass ? "" : void 0 }) }, options.map((o) => /* @__PURE__ */ React.createElement("label", { className: "rf-segment", key: o.value }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "radio",
          name: nm,
          value: o.value,
          "aria-label": o.icon && !o.label ? o.ariaLabel || o.value : void 0,
          ...controlled ? { checked: value === o.value } : { defaultChecked: defaultValue === o.value },
          onChange: () => onChange && onChange(o.value)
        }
      ), o.icon ? /* @__PURE__ */ React.createElement(Icon, { name: o.icon }) : null, o.label)));
    };
    const PageDots = ({ count, index = 0, onChange, glass = true, label = "Pages", className }) => {
      const [ref, setRef] = useEnhance();
      useEffect(() => {
        const el = ref.current;
        if (!el) return void 0;
        const h = (e) => onChange && onChange(e.detail.index);
        el.addEventListener("rf-select", h);
        return () => el.removeEventListener("rf-select", h);
      }, [onChange]);
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: cx("rf-pagedots", glass && "rf-glass", className), "aria-label": label, ...dataAttrs({ variant: glass === "clear" ? "clear" : void 0 }) }, Array.from({ length: count }, (_, i) => /* @__PURE__ */ React.createElement("button", { type: "button", key: i, className: "rf-dot", "aria-label": `Page ${i + 1}`, "aria-current": i === index ? "true" : void 0 })));
    };
    const Switch = forwardRef(function Switch2({ label, tone, size, checked, defaultChecked, onChange, disabled, row, className, ...rest }, ref) {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("label", { ref: setRef, className: cx("rf-switch", className), ...dataAttrs({ tone, size, layout: row ? "row" : void 0 }) }, row ? /* @__PURE__ */ React.createElement("span", { className: "rf-switch-label" }, label) : null, /* @__PURE__ */ React.createElement("span", { className: "rf-switch-track" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          ref,
          type: "checkbox",
          role: "switch",
          checked,
          defaultChecked,
          disabled,
          onChange: (e) => onChange && onChange(e.target.checked, e),
          ...rest
        }
      ), /* @__PURE__ */ React.createElement("span", { className: "rf-switch-thumb", "aria-hidden": "true" })), !row && label ? /* @__PURE__ */ React.createElement("span", { className: "rf-switch-label" }, label) : null);
    });
    const Slider = forwardRef(function Slider2({ value, defaultValue, min = 0, max = 100, step = 1, onChange, label, iconStart, iconEnd, ticks, variant, disabled, className, ...rest }, ref) {
      const [root, setRef] = useEnhance();
      useLayoutEffect(() => {
        if (root.current) api2.refresh(root.current);
      }, [value]);
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: cx("rf-slider", className), ...dataAttrs({ ticks, variant }) }, iconStart ? /* @__PURE__ */ React.createElement(Icon, { name: iconStart }) : null, /* @__PURE__ */ React.createElement("div", { className: "rf-slider-control" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          ref,
          className: "rf-slider-input",
          type: "range",
          min,
          max,
          step,
          "aria-label": label,
          disabled,
          ...value !== void 0 ? { value } : { defaultValue },
          onChange: (e) => onChange && onChange(Number(e.target.value), e),
          ...rest
        }
      ), /* @__PURE__ */ React.createElement("div", { className: "rf-slider-track", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("div", { className: "rf-slider-fill" })), /* @__PURE__ */ React.createElement("div", { className: "rf-slider-thumb", "aria-hidden": "true" })), iconEnd ? /* @__PURE__ */ React.createElement(Icon, { name: iconEnd }) : null);
    });
    const TextField = forwardRef(function TextField2({ label, hint, error, icon: icon2, clearable, multiline, variant, id, className, onClear, ...rest }, ref) {
      const auto2 = useId();
      const fid = id || `tf-${auto2}`;
      const describe = error ? `${fid}-err` : hint ? `${fid}-hint` : void 0;
      const Input = multiline ? "textarea" : "input";
      return /* @__PURE__ */ React.createElement("div", { className: cx("rf-field", className), ...dataAttrs({ invalid: !!error, variant }) }, label ? /* @__PURE__ */ React.createElement("label", { className: "rf-field-label", htmlFor: fid }, label) : null, /* @__PURE__ */ React.createElement("div", { className: "rf-field-control" }, icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null, /* @__PURE__ */ React.createElement(Input, { ref, id: fid, className: "rf-input", "aria-describedby": describe, "aria-invalid": error ? "true" : void 0, placeholder: rest.placeholder || " ", ...rest }), clearable ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-field-clear", "aria-label": `Clear ${label || "field"}`, onClick: onClear }, /* @__PURE__ */ React.createElement(Icon, { name: "close" })) : null), hint && !error ? /* @__PURE__ */ React.createElement("p", { className: "rf-field-hint", id: `${fid}-hint` }, hint) : null, error ? /* @__PURE__ */ React.createElement("p", { className: "rf-field-error", id: `${fid}-err` }, /* @__PURE__ */ React.createElement(Icon, { name: "alert" }), error) : null);
    });
    const SearchField = forwardRef(function SearchField2({ placeholder = "Search", label, glass = true, collapsible, mic, onMic, className, ...rest }, ref) {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: setRef,
          role: "search",
          className: cx("rf-search", glass && "rf-glass", className),
          "aria-label": collapsible ? label || placeholder : void 0,
          ...dataAttrs({ collapsible, lens: glass ? "" : void 0 })
        },
        /* @__PURE__ */ React.createElement(Icon, { name: "search" }),
        /* @__PURE__ */ React.createElement("input", { ref, className: "rf-search-input", type: "search", placeholder, "aria-label": label || placeholder, ...rest }),
        mic ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-search-mic", "aria-label": "Dictate", onClick: onMic }, /* @__PURE__ */ React.createElement(Icon, { name: "mic" })) : null,
        /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-search-clear", "aria-label": "Clear search" }, /* @__PURE__ */ React.createElement(Icon, { name: "x-circle" }))
      );
    });
    const Stepper = ({ value, defaultValue = 0, min = -Infinity, max = Infinity, step = 1, onChange, label, glass, className }) => {
      const [inner, setInner] = useState(defaultValue);
      const v = value !== void 0 ? value : inner;
      const set = (n) => {
        const next = Math.min(max, Math.max(min, n));
        if (value === void 0) setInner(next);
        if (onChange) onChange(next);
      };
      const valRef = useRef(null);
      const prev = useRef(v);
      useLayoutEffect(() => {
        if (valRef.current && prev.current !== v) api2.roll(valRef.current, v, { from: prev.current, dir: v > prev.current ? 1 : -1 });
        prev.current = v;
      }, [v]);
      return /* @__PURE__ */ React.createElement("div", { role: "group", "aria-label": label, className: cx("rf-stepper", glass && "rf-glass", className), "data-rf-managed": "" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-stepper-btn", "aria-label": `Decrease ${label || ""}`.trim(), disabled: v <= min, onClick: () => set(v - step) }, /* @__PURE__ */ React.createElement(Icon, { name: "minus" })), /* @__PURE__ */ React.createElement(
        "input",
        {
          ref: valRef,
          className: "rf-stepper-value",
          type: "number",
          value: v,
          min: Number.isFinite(min) ? min : void 0,
          max: Number.isFinite(max) ? max : void 0,
          step,
          "aria-label": label,
          onChange: (e) => set(Number(e.target.value))
        }
      ), /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-stepper-btn", "aria-label": `Increase ${label || ""}`.trim(), disabled: v >= max, onClick: () => set(v + step) }, /* @__PURE__ */ React.createElement(Icon, { name: "plus" })));
    };
    const Checkbox = forwardRef(function Checkbox2({ label, description, indeterminate, className, ...rest }, ref) {
      const inner = useRef(null);
      useEffect(() => {
        if (inner.current) inner.current.indeterminate = !!indeterminate;
      }, [indeterminate]);
      return /* @__PURE__ */ React.createElement("label", { className: cx("rf-check", className) }, /* @__PURE__ */ React.createElement("input", { ref: (n) => {
        inner.current = n;
        if (typeof ref === "function") ref(n);
        else if (ref) ref.current = n;
      }, className: "rf-checkbox", type: "checkbox", ...rest }), description ? /* @__PURE__ */ React.createElement("span", { className: "rf-check-text" }, label, /* @__PURE__ */ React.createElement("small", null, description)) : label);
    });
    const Radio = forwardRef(function Radio2({ label, description, className, ...rest }, ref) {
      return /* @__PURE__ */ React.createElement("label", { className: cx("rf-check", className) }, /* @__PURE__ */ React.createElement("input", { ref, className: "rf-radio", type: "radio", ...rest }), description ? /* @__PURE__ */ React.createElement("span", { className: "rf-check-text" }, label, /* @__PURE__ */ React.createElement("small", null, description)) : label);
    });
    const Dialog = ({ open: open4, onClose, title, message, icon: icon2, tone, actions, dismissible = true, children, className }) => {
      const ref = useRef(null);
      const tid = useId();
      useEffect(() => {
        const d = ref.current;
        if (!d) return;
        if (open4 && !d.open) d.showModal();
        if (!open4 && d.open) d.close();
      }, [open4]);
      useEffect(() => {
        const d = ref.current;
        if (!d) return void 0;
        api2.init(d);
        const h = () => onClose && onClose(d.returnValue || "dismiss");
        d.addEventListener("close", h);
        return () => d.removeEventListener("close", h);
      }, [onClose]);
      return /* @__PURE__ */ React.createElement(
        "dialog",
        {
          ref,
          className: cx("rf-dialog", "rf-glass", className),
          "data-variant": "thick",
          ...dataAttrs({ tone }),
          closedby: dismissible ? "any" : "closerequest",
          "aria-labelledby": `${tid}-t`
        },
        /* @__PURE__ */ React.createElement("form", { method: "dialog" }, icon2 ? /* @__PURE__ */ React.createElement("div", { className: "rf-dialog-icon" }, /* @__PURE__ */ React.createElement(Icon, { name: icon2 })) : null, /* @__PURE__ */ React.createElement("h2", { className: "rf-dialog-title", id: `${tid}-t` }, title), message ? /* @__PURE__ */ React.createElement("p", { className: "rf-dialog-message" }, message) : null, children ? /* @__PURE__ */ React.createElement("div", { className: "rf-dialog-body" }, children) : null, /* @__PURE__ */ React.createElement("div", { className: "rf-dialog-actions", ...dataAttrs({ stack: (actions || []).length > 2 }) }, (actions || [{ label: "OK", value: "ok", variant: "filled" }]).map((a) => /* @__PURE__ */ React.createElement("button", { key: a.value ?? a.label, className: "rf-btn", value: a.value ?? a.label, ...dataAttrs({ variant: a.variant || "gray", tone: a.tone }), autoFocus: a.autoFocus }, a.label))))
      );
    };
    const Sheet = ({ open: open4, onClose, detent = "medium", detents = ["medium", "large"], onDetentChange, title, leading, trailing, inline, children, className }) => {
      const ref = useRef(null);
      const tid = useId();
      useEffect(() => {
        if (ref.current) api2.init(ref.current);
      }, []);
      useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open4) api2.sheet.open(el, { detent });
        else api2.sheet.close(el);
      }, [open4]);
      useEffect(() => {
        if (ref.current && open4) api2.sheet.detent(ref.current, detent);
      }, [detent]);
      useEffect(() => {
        const el = ref.current;
        if (!el) return void 0;
        const c = () => onClose && onClose(el.returnValue);
        const d = (e) => onDetentChange && onDetentChange(e.detail.detent);
        el.addEventListener("close", c);
        el.addEventListener("rf-detent", d);
        return () => {
          el.removeEventListener("close", c);
          el.removeEventListener("rf-detent", d);
        };
      }, [onClose, onDetentChange]);
      const Tag = inline ? "div" : "dialog";
      return /* @__PURE__ */ React.createElement(
        Tag,
        {
          ref,
          className: cx("rf-sheet", "rf-glass", className),
          role: inline ? "dialog" : void 0,
          "aria-labelledby": title ? `${tid}-t` : void 0,
          closedby: inline ? void 0 : "any",
          ...dataAttrs({ inline, detent, detents: detents.join(" ") })
        },
        /* @__PURE__ */ React.createElement("div", { className: "rf-sheet-grabber" }),
        title || leading || trailing ? /* @__PURE__ */ React.createElement("div", { className: "rf-sheet-header" }, /* @__PURE__ */ React.createElement("div", null, leading), /* @__PURE__ */ React.createElement("h2", { className: "rf-sheet-title", id: `${tid}-t` }, title), /* @__PURE__ */ React.createElement("div", null, trailing)) : null,
        /* @__PURE__ */ React.createElement("div", { className: "rf-sheet-body" }, children)
      );
    };
    const ActivityCapsule = ({ icon: icon2, tone, title, subtitle, trailing, expanded, onToggle, children, className }) => {
      const [ref, setRef] = useEnhance();
      useEffect(() => {
        const el = ref.current;
        if (!el) return void 0;
        const h = (e) => onToggle && onToggle(e.detail.expanded);
        el.addEventListener("rf-toggle", h);
        return () => el.removeEventListener("rf-toggle", h);
      }, [onToggle]);
      useEffect(() => {
        const el = ref.current;
        if (el && el._rfActivity && expanded !== void 0 && el.getAttribute("data-expanded") === "true" !== expanded) el._rfActivity.set(expanded);
      }, [expanded]);
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: cx("rf-activity", "rf-glass", className), "data-lens": "" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-activity-compact" }, /* @__PURE__ */ React.createElement("span", { className: "rf-activity-leading", ...dataAttrs({ tone }) }, /* @__PURE__ */ React.createElement(Icon, { name: icon2 || "bolt" })), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "rf-activity-title" }, title), subtitle ? /* @__PURE__ */ React.createElement("span", { className: "rf-activity-sub" }, subtitle) : null), trailing ? /* @__PURE__ */ React.createElement("span", { className: "rf-activity-trailing" }, trailing) : null), children ? /* @__PURE__ */ React.createElement("div", { className: "rf-activity-detail" }, children) : null);
    };
    const Scrim = ({ edge }) => /* @__PURE__ */ React.createElement("div", { className: "rf-scrim", ...dataAttrs({ edge }) });
    const Card = ({ variant, media: media2, art = 1, eyebrow, title, text, footer, caption, href, onClick, tilt: tilt2, className, children }) => {
      const [, setRef] = useEnhance();
      const Tag = href ? "a" : onClick ? "button" : "article";
      const rf = tilt2 ? "tilt" : void 0;
      if (variant === "media") {
        return /* @__PURE__ */ React.createElement(Tag, { ref: setRef, href, onClick, className: cx("rf-card", className), "data-variant": "media", ...dataAttrs({ rf }) }, media2 || /* @__PURE__ */ React.createElement("div", { className: "rf-card-art rf-art", "data-art": art }), /* @__PURE__ */ React.createElement(Scrim, null), /* @__PURE__ */ React.createElement("div", { className: "rf-glass", "data-variant": "clear", "data-lens": "" }, title ? /* @__PURE__ */ React.createElement("span", { className: "t-headline" }, title) : null, text ? /* @__PURE__ */ React.createElement("span", { className: "rf-secondary t-footnote" }, text) : null));
      }
      return /* @__PURE__ */ React.createElement(Tag, { ref: setRef, href, onClick, className: cx("rf-card", className), ...dataAttrs({ rf }) }, media2 !== void 0 ? /* @__PURE__ */ React.createElement("div", { className: "rf-card-media rf-art", "data-art": art }, media2, caption ? /* @__PURE__ */ React.createElement("span", { className: "rf-glass rf-chip" }, caption) : null) : null, /* @__PURE__ */ React.createElement("div", { className: "rf-card-body" }, eyebrow ? /* @__PURE__ */ React.createElement("span", { className: "rf-card-eyebrow" }, eyebrow) : null, title ? /* @__PURE__ */ React.createElement("h3", { className: "rf-card-title" }, title) : null, text ? /* @__PURE__ */ React.createElement("p", { className: "rf-card-text" }, text) : null, children), footer ? /* @__PURE__ */ React.createElement("div", { className: "rf-card-footer" }, footer) : null);
    };
    const List = ({ header, footer, className, children, label }) => /* @__PURE__ */ React.createElement("section", null, header ? /* @__PURE__ */ React.createElement("h3", { className: "rf-list-header" }, header) : null, /* @__PURE__ */ React.createElement("ul", { className: cx("rf-list", className), "aria-label": label }, React.Children.map(children, (c) => c ? /* @__PURE__ */ React.createElement("li", null, c) : null)), footer ? /* @__PURE__ */ React.createElement("p", { className: "rf-list-footer" }, footer) : null);
    const ListRow = ({ icon: icon2, tone, thumb, avatar, title, subtitle, detail, chevron, accessory, href, onClick }) => {
      const Tag = href ? "a" : onClick ? "button" : "div";
      return /* @__PURE__ */ React.createElement(Tag, { className: "rf-list-row", href, onClick, type: Tag === "button" ? "button" : void 0 }, icon2 ? /* @__PURE__ */ React.createElement("span", { className: "rf-list-icon", ...dataAttrs({ tone }) }, /* @__PURE__ */ React.createElement(Icon, { name: icon2 })) : null, thumb ? /* @__PURE__ */ React.createElement("span", { className: "rf-list-thumb rf-art", "data-art": thumb }) : null, avatar ? /* @__PURE__ */ React.createElement(Avatar, { ...avatar, size: "sm" }) : null, /* @__PURE__ */ React.createElement("span", { className: "rf-list-text" }, /* @__PURE__ */ React.createElement("span", { className: "rf-list-title" }, title), subtitle ? /* @__PURE__ */ React.createElement("span", { className: "rf-list-sub" }, subtitle) : null), detail != null ? /* @__PURE__ */ React.createElement("span", { className: "rf-list-detail" }, detail) : null, accessory, chevron ? /* @__PURE__ */ React.createElement("span", { className: "rf-list-chevron", dangerouslySetInnerHTML: svg("chevron-right") }) : null);
    };
    const Avatar = ({ initials, src, alt = "", size, tone, status, label }) => /* @__PURE__ */ React.createElement("span", { className: "rf-avatar", role: label ? "img" : void 0, "aria-label": label, ...dataAttrs({ size, tone, status }) }, src ? /* @__PURE__ */ React.createElement("img", { src, alt }) : initials);
    const AvatarStack = ({ people = [], max = 3, label }) => /* @__PURE__ */ React.createElement("span", { className: "rf-avatar-stack", "aria-label": label || `${people.length} people` }, people.slice(0, max).map((p, i) => /* @__PURE__ */ React.createElement(Avatar, { key: i, ...p })), people.length > max ? /* @__PURE__ */ React.createElement(Avatar, { initials: `+${people.length - max}`, tone: "rose" }) : null);
    const Badge = ({ tone, variant, icon: icon2, children, label }) => {
      const ref = useRef(null);
      const prev = useRef(children);
      useEffect(() => {
        if (ref.current && prev.current !== children) {
          ref.current.removeAttribute("data-bump");
          void ref.current.offsetWidth;
          ref.current.setAttribute("data-bump", "");
        }
        prev.current = children;
      }, [children]);
      return /* @__PURE__ */ React.createElement("span", { ref, className: "rf-badge", "aria-label": label, ...dataAttrs({ tone, variant }) }, icon2 ? /* @__PURE__ */ React.createElement(Icon, { name: icon2 }) : null, children);
    };
    const Chip = ({ pressed, onToggle, onRemove, glass, removeLabel, children, className }) => {
      if (onRemove) {
        return /* @__PURE__ */ React.createElement("span", { className: cx("rf-chip", glass && "rf-glass", className), "data-rf-managed": "" }, children, /* @__PURE__ */ React.createElement("button", { type: "button", className: "rf-chip-remove", "aria-label": removeLabel || `Remove ${typeof children === "string" ? children : ""}`.trim(), onClick: onRemove }, /* @__PURE__ */ React.createElement(Icon, { name: "close" })));
      }
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: cx("rf-chip", glass && "rf-glass", className),
          "data-rf-managed": "",
          "aria-pressed": pressed === void 0 ? void 0 : String(!!pressed),
          onClick: () => onToggle && onToggle(!pressed)
        },
        pressed !== void 0 ? /* @__PURE__ */ React.createElement("span", { className: "rf-chip-check", dangerouslySetInnerHTML: svg("check") }) : null,
        children
      );
    };
    const Progress = ({ value, label, size, tone }) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "rf-progress",
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": value == null ? void 0 : 0,
        "aria-valuemax": value == null ? void 0 : 100,
        "aria-valuenow": value == null ? void 0 : Math.round(value * 100),
        style: value == null ? void 0 : { "--rf-value": value },
        ...dataAttrs({ size, tone })
      },
      /* @__PURE__ */ React.createElement("span", { className: "rf-progress-fill" })
    );
    const Ring = ({ value = 0, size, label, tone, showValue }) => {
      const s = size === "sm" ? 24 : size === "lg" ? 72 : 44;
      const w = size === "sm" ? 3 : size === "lg" ? 7 : 5;
      const r = (s - w) / 2;
      return /* @__PURE__ */ React.createElement("span", { className: "rf-ring", role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(value * 100), style: { "--rf-value": value }, ...dataAttrs({ size, tone }) }, /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${s} ${s}` }, /* @__PURE__ */ React.createElement("circle", { className: "rf-ring-track", cx: s / 2, cy: s / 2, r, pathLength: "100" }), /* @__PURE__ */ React.createElement("circle", { className: "rf-ring-fill", cx: s / 2, cy: s / 2, r, pathLength: "100" })), showValue ? /* @__PURE__ */ React.createElement("span", { className: "rf-ring-label" }, Math.round(value * 100), "%") : null);
    };
    const Spinner = ({ size, variant, label = "Loading" }) => /* @__PURE__ */ React.createElement("span", { className: "rf-spinner", role: "status", "aria-label": label, ...dataAttrs({ size, variant }) }, /* @__PURE__ */ React.createElement("i", null));
    const Skeleton = ({ shape, width, height }) => /* @__PURE__ */ React.createElement("span", { className: "rf-skeleton", "aria-hidden": "true", style: { "--_w": width, "--_h": height }, ...dataAttrs({ shape }) });
    const PlayPause = ({ playing, onToggle, size, labelPlay = "Play", labelPause = "Pause" }) => /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "rf-btn rf-playpause",
        "data-shape": "circle",
        "data-rf-managed": "",
        ...dataAttrs({ size }),
        "aria-pressed": String(!!playing),
        "aria-label": playing ? labelPause : labelPlay,
        onClick: () => onToggle && onToggle(!playing)
      },
      /* @__PURE__ */ React.createElement("span", { className: "rf-playpause-glyph" })
    );
    const MediaControls = ({ title, subtitle, art = 3, artwork, playing, onToggle, position = 0, duration: duration2 = 1, onSeek, onPrevious, onNext, className }) => {
      const [, setRef] = useEnhance();
      const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: cx("rf-media", className) }, artwork || /* @__PURE__ */ React.createElement("div", { className: "rf-media-art rf-art", "data-art": art }), /* @__PURE__ */ React.createElement(Scrim, null), /* @__PURE__ */ React.createElement("div", { className: "rf-media-bar rf-glass", "data-variant": "clear", "data-lens": "" }, /* @__PURE__ */ React.createElement("div", { className: "rf-media-meta" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "rf-media-title" }, title), /* @__PURE__ */ React.createElement("span", { className: "rf-media-sub rf-secondary" }, subtitle))), /* @__PURE__ */ React.createElement(Slider, { variant: "scrubber", min: 0, max: duration2, value: position, label: "Playback position", onChange: onSeek }), /* @__PURE__ */ React.createElement("div", { className: "rf-media-times" }, /* @__PURE__ */ React.createElement("span", null, fmt(position)), /* @__PURE__ */ React.createElement("span", null, "-", fmt(Math.max(0, duration2 - position)))), /* @__PURE__ */ React.createElement("div", { className: "rf-media-buttons" }, /* @__PURE__ */ React.createElement(Button, { shape: "circle", size: "lg", "aria-label": "Previous", icon: "skip-back", onClick: onPrevious }), /* @__PURE__ */ React.createElement(PlayPause, { playing, onToggle }), /* @__PURE__ */ React.createElement(Button, { shape: "circle", size: "lg", "aria-label": "Next", icon: "skip-forward", onClick: onNext }))));
    };
    const GlassGroup = ({ merged, label, children, className }) => {
      const ref = useRef(null);
      const mounted = useRef(false);
      useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (!mounted.current) {
          mounted.current = true;
          el.toggleAttribute("data-merged", !!merged);
          return;
        }
        api2.group.merge(el, !!merged);
      }, [merged]);
      return /* @__PURE__ */ React.createElement("div", { ref, role: "toolbar", "aria-label": label, className: cx("rf-glass-group", className) }, children);
    };
    const Loupe = ({ size = 120, x = 40, y = 40, label }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: "rf-loupe rf-glass", "data-variant": "clear", "data-shape": "circle", "data-lens": "strong", "aria-label": label, style: { "--_s": `${size}px`, "--_x": `${x}px`, "--_y": `${y}px` } });
    };
    const Droplets = ({ icon: icon2 = "plus", label = "Quick actions", actions = [] }) => {
      const [ref, setRef] = useEnhance();
      useEffect(() => {
        const el = ref.current;
        if (!el) return void 0;
        const h = (e) => {
          const i = Array.from(el.children).indexOf(e.detail.item) - 1;
          const a = actions[i];
          if (a && a.onSelect) a.onSelect();
        };
        el.addEventListener("rf-select", h);
        return () => el.removeEventListener("rf-select", h);
      }, [actions]);
      return /* @__PURE__ */ React.createElement("div", { ref: setRef, className: "rf-droplets", "aria-label": label }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-label": label }, /* @__PURE__ */ React.createElement(Icon, { name: icon2 })), actions.slice(0, 3).map((a, i) => /* @__PURE__ */ React.createElement("button", { type: "button", key: i, "aria-label": a.label }, /* @__PURE__ */ React.createElement(Icon, { name: a.icon }))));
    };
    const Reveal = ({ as: As = "div", effect = true, children, ...rest }) => {
      const [, setRef] = useEnhance();
      return /* @__PURE__ */ React.createElement(As, { ref: setRef, "data-reveal": effect === true ? "" : effect, ...rest }, children);
    };
    return {
      Icon,
      Scene,
      Glass,
      Button,
      Toolbar,
      ToolbarGroup,
      Menu,
      MenuItem,
      MenuSeparator,
      MenuLabel,
      MenuRow,
      MenuTile,
      Popover,
      TabBar,
      NavBar,
      LargeTitle,
      ScrollEdge,
      Sidebar,
      SidebarHeading,
      SidebarItem,
      SegmentedControl,
      PageDots,
      Switch,
      Slider,
      TextField,
      SearchField,
      Stepper,
      Checkbox,
      Radio,
      Dialog,
      Sheet,
      ActivityCapsule,
      Card,
      List,
      ListRow,
      Avatar,
      AvatarStack,
      Badge,
      Chip,
      Progress,
      Ring,
      Spinner,
      Skeleton,
      MediaControls,
      PlayPause,
      GlassGroup,
      Loupe,
      Lens: Loupe,
      Droplets,
      Reveal,
      Scrim
    };
  }
  function reactComponents(api2) {
    let built = null;
    const get = () => {
      if (built) return built;
      const React = typeof window !== "undefined" ? window.React : null;
      if (!React) return null;
      built = build(React, api2);
      return built;
    };
    NAMES.forEach((name) => {
      Object.defineProperty(api2, name, {
        enumerable: true,
        configurable: true,
        get() {
          const all = get();
          if (all) return all[name];
          return function MissingReact() {
            throw new Error(`Refract.${name} needs React 18 on window.React`);
          };
        }
      });
    });
  }

  // src/js/index.js
  var VERSION = "1.0.0";
  function init(root = hasDOM ? document : null, options = {}) {
    if (!root) return api;
    defs();
    installPress();
    injectIcons(root);
    const scope = root.querySelectorAll ? root : document;
    const all = (sel) => {
      const list = Array.from(scope.querySelectorAll(sel));
      if (scope.matches && scope.matches(sel)) list.unshift(scope);
      return list;
    };
    if (options.light !== false) all(".rf-glass").forEach((el) => once(el, "light", () => light.register(el)));
    all(".rf-glass[data-lens]").forEach((el) => lens(el));
    auto.forEach(([sel, name]) => all(sel).forEach((el) => {
      if (!el.hasAttribute("data-rf-managed")) once(el, name, () => behaviors[name](el, options[name] || {}));
    }));
    all("[data-rf]").forEach((el) => {
      el.getAttribute("data-rf").split(/\s+/).forEach((name) => {
        const b = behaviors[name];
        if (b) once(el, name, () => b(el, options[name] || {}));
      });
    });
    return api;
  }
  var observer = null;
  function observe(root = document) {
    if (observer) observer.disconnect();
    observer = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => {
        if (n.nodeType === 1) init(n);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer && observer.disconnect();
  }
  var api = {
    version: VERSION,
    init,
    observe,
    destroy: (el) => detach(el),
    refresh,
    supports,
    prefs,
    media,
    // material
    lens,
    lensFilter,
    light,
    // preferences
    theme,
    setDensity,
    setMotion,
    setTransparency,
    // icons
    icons: ICONS,
    icon,
    // imperative components
    toast,
    sheet,
    dialog,
    morph,
    menu,
    group,
    transition: morph.transition,
    behaviors,
    // motion
    motion,
    materialize,
    dematerialize,
    shapeshift,
    flip,
    stagger,
    sweep,
    roll,
    bump,
    settle,
    jiggle,
    wiggle,
    burst,
    autoplay,
    animate,
    spring: springValue,
    easing,
    duration,
    emit
  };
  reactComponents(api);
  if (hasDOM) {
    const boot = () => init(document);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
    window.Refract = Object.defineProperties(window.Refract || {}, Object.getOwnPropertyDescriptors(api));
  }
  var index_default = api;
})();
