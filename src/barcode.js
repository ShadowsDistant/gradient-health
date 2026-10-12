/* The barcode reader, loaded the first time someone scans (lazy/barcode.js), with its worker
 * (lazy/barcode-worker.js: ZXing compiled to WebAssembly, MIT; the .wasm ships next to it, so it
 * works without Google Play services and nothing is downloaded). GH.scanner opens the sheet and the
 * camera at once; once this is in, run(a) does the rest of a scan:
 *  - The camera: continuous focus where the camera has it, a tap on the picture focuses there, and a
 *    zoom so a phone 15 to 20 cm away fills the box (closer than that, many phones can't focus). The
 *    camera's own zoom where the browser lets a page use it; Android's WebView never does (it
 *    always denies the camera's pan-tilt-zoom permission), so there the picture is magnified and
 *    the reader crops to match, which the 1920 x 1080 picture leaves room for.
 *  - Reading: each new frame goes to the worker (as a VideoFrame, so this thread copies nothing), in
 *    turn: the box with a margin; the whole picture, so a code outside the box still reads; and the
 *    box evened out, for a blurred, dim or noisy code (the worker only lets such a read through
 *    when a second setting agrees, see src/barcode-worker.js). Where the phone has its own
 *    BarcodeDetector for these formats (Android's comes with Play services), it reads the frames
 *    too: whichever reads first wins.
 *  - When a read counts (rule): an EAN-13 or UPC-A on its first read with a right check digit (that
 *    and ZXing's own checks make a misread very unlikely); an EAN-8 or UPC-E, shorter, once the same
 *    code is read twice within about a second, in any two frames (the pass that read it once goes
 *    again until then).
 *  - The lock-in: the picture holds, the code lights up where it is, the scan haptic plays, and the
 *    sheet closes.
 *  - Hints: after a few seconds without a read, what would help: closer, further, the light, steady.
 * GH.barcode = { FORMATS, ready, run(a), read(source, rect, o), native(formats), detector(formats),
 *   rule(), canon(raw, format), cover(...), hint(looks, o), HINTS }.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const doc = G.document;
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const median = (xs) => { const s = xs.filter((x) => x != null).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };
  const U = () => GH.ui || {};

  /* ---------------------------------------------------------------- the code's digits */
  // Every engine's read as the digits 1.11 handed back: UPC-A as the EAN-13 it is (a leading 0, as
  // ZXing reports it), and UPC-E written out as that too (Open Food Facts knows the long form).
  function canon(raw, format) {
    const S = GH.scanner;
    let s = S && S.normalise ? S.normalise(raw, format) : String(raw || '').replace(/\D/g, '');
    if (format === 'upc_e' && s.length === 12) s = `0${s}`;
    if (format === 'upc_a' && s.length === 12) s = `0${s}`;
    return s;
  }
  const checks = (code) => (GH.scanner && GH.scanner.checksumOk ? GH.scanner.checksumOk(code) : /^\d{8,14}$/.test(code));

  /* ---------------------------------------------------------------- when a read counts */
  // take(code, format, t, frame) says whether this read settles it. A frame read by both engines
  // counts once.
  const TWICE = { ean_8: true, upc_e: true };
  const WITHIN = 1200; // ms
  function rule() {
    const seen = new Map(); // code → { t, frame }
    return {
      take(code, format, t, frame) {
        if (!code || !checks(code)) return false;
        if (!TWICE[format]) return true;
        const last = seen.get(code);
        if (last && t - last.t <= WITHIN && last.frame !== frame) return true;
        if (!last || last.frame !== frame || t - last.t > WITHIN) seen.set(code, { t, frame });
        return false;
      },
    };
  }

  /* ---------------------------------------------------------------- the picture and the box */
  // A frame of vw x vh shown with object-fit: cover in a W x H view, magnified zoom times about the
  // view's centre: frame pixels per view pixel (s) and where the frame's corner lands (ox, oy).
  function cover(vw, vh, W, H, zoom) {
    const s = Math.max(W / vw, H / vh) * (zoom || 1);
    return { s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2 };
  }
  const toFrame = (c, x, y) => ({ x: (x - c.ox) / c.s, y: (y - c.oy) / c.s });
  const toView = (c, x, y) => ({ x: x * c.s + c.ox, y: y * c.s + c.oy });
  // How much to magnify. Food: 2.5, so a full-size EAN-13 fills the box with the phone about 14 cm
  // away, and four fifths of it at 18 (a phone's main camera sees about 45 degrees across, upright);
  // unmagnified, it filled 1.11's box at 6 cm. A plan's code on a screen: 1.4. Never so much that
  // fewer than 420 frame pixels span the view (a code filling the box keeps 3 pixels a module).
  const ZOOM = { food: 2.5, qr: 1.4 };
  const zoomFor = (qr, vw, vh, W, H) => {
    const across = W ? Math.min(vw, vh * (W / H)) : Math.min(vw, vh);
    return clamp(Math.min(qr ? ZOOM.qr : ZOOM.food, across / 420), 1, 4);
  };

  /* ---------------------------------------------------------------- hints */
  // From the box's last looks (light, change, bars as fractions of the box): what would help.
  const HINTS = {
    aim: 'Hold the barcode inside the box', aimQr: 'Point the camera at the code', closer: 'Move a little closer', further: 'Hold it a bit further away',
    dark: 'Turn on the light', darkNoTorch: 'Try somewhere brighter', steady: 'Hold steady',
  };
  function hint(looks, o) {
    const opts = o || {};
    if (!looks || !looks.length) return null;
    if (median(looks.map((l) => l.light)) < 45) return opts.torch ? 'dark' : 'darkNoTorch';
    const moving = median(looks.map((l) => l.change)) > 14;
    if (opts.qr) return moving ? 'steady' : 'aimQr';
    const withBars = looks.filter((l) => l.bars);
    if (withBars.length * 2 >= looks.length) {
      // A picture that moves can't say how far the code is: steady first.
      if (moving) return 'steady';
      if (withBars.filter((l) => l.bars.full).length * 2 >= withBars.length) return 'further';
      const spans = withBars.filter((l) => l.bars.span != null);
      if (spans.length && median(spans.map((l) => l.bars.span)) < 0.4) return 'closer';
      return 'steady';
    }
    return moving ? 'steady' : 'aim';
  }

  /* ---------------------------------------------------------------- the worker */
  const script = doc && doc.currentScript && doc.currentScript.src ? doc.currentScript.src : doc ? new URL('lazy/barcode.js', doc.baseURI).href : '';
  let worker = null, seq = 0;
  const waiting = new Map();
  function boot() {
    if (worker) return worker;
    worker = new G.Worker(new URL('barcode-worker.js', script).href);
    worker.onmessage = (e) => {
      const m = e.data || {};
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.ok) w.resolve(m); else w.reject(new Error(m.error || 'The reader failed'));
    };
    // A worker that couldn't start: everything waiting fails, and the next read starts a new one.
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      for (const w of waiting.values()) w.reject(new Error('The reader stopped'));
      waiting.clear();
      try { worker.terminate(); } catch (x) { /* gone */ }
      worker = null;
    };
    return worker;
  }
  function ask(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      try { boot().postMessage(Object.assign({ id }, msg), transfer || []); } catch (err) { waiting.delete(id); reject(err); }
    });
  }
  const ready = G.Worker && doc ? ask({ type: 'init' }) : Promise.reject(new Error('No workers here'));
  ready.catch(() => {});

  // A picture for the worker. From the video, the frame itself (a VideoFrame wraps the one showing
  // without copying it; the worker copies out only the part it reads, off this thread). Otherwise,
  // or where VideoFrame is missing, the part cut and scaled here: an ImageBitmap, or a canvas's
  // pixels. (Cutting a bitmap from a video drew the whole frame on this thread first: 45 to 100 ms a
  // frame at 1080 x 1920 here.)
  // Either way stops being tried after three failures in a row.
  const tries = { frame: 0, bitmap: 0 };
  let canvas = null;
  async function picture(source, rect, scale) {
    if (tries.frame < 3 && G.VideoFrame && source && source.tagName === 'VIDEO') {
      try { const image = new G.VideoFrame(source); tries.frame = 0; return { image, transfer: [image], whole: true }; } catch (e) { tries.frame++; }
    }
    const sx = Math.round(rect.x), sy = Math.round(rect.y), sw = Math.max(1, Math.round(rect.w)), sh = Math.max(1, Math.round(rect.h));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    if (tries.bitmap < 3 && G.createImageBitmap) {
      try {
        const image = await G.createImageBitmap(source, sx, sy, sw, sh, { resizeWidth: w, resizeHeight: h, resizeQuality: scale < 1 ? 'medium' : 'high' });
        tries.bitmap = 0;
        return { image, transfer: [image], w, h };
      } catch (e) { tries.bitmap++; }
    }
    if (!canvas) canvas = doc.createElement('canvas');
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    return { image, transfer: [image.data.buffer], w, h };
  }
  // Reads rect of source (a video, canvas or bitmap): { found: [{ format, rawValue, cornerPoints in
  // source pixels }], look, ms }. o: { formats, scale, look, qr, enhance, scan (whose looks these are) }.
  async function read(source, rect, o) {
    const p = await picture(source, rect, o.scale || 1);
    const m = await ask({ type: 'read', image: p.image, rect: p.whole ? rect : null, scale: p.whole ? o.scale || 1 : 1, formats: o.formats || FORMATS, qr: !!o.qr, look: !!o.look, enhance: !!o.enhance, scan: o.scan }, p.transfer);
    // The worker's corners are in the picture it got: the whole frame, or the part cut here.
    const kx = p.whole ? 1 : rect.w / p.w, ky = p.whole ? 1 : rect.h / p.h, dx = p.whole ? 0 : rect.x, dy = p.whole ? 0 : rect.y;
    const found = (m.found || []).map((b) => Object.assign({}, b, { cornerPoints: (b.cornerPoints || []).map((q) => ({ x: dx + q.x * kx, y: dy + q.y * ky })) }));
    return { found, look: m.look, ms: m.ms, how: m.how };
  }

  // The platform's own detector, when it reads every one of these formats (Chrome on Android has
  // one through Google Play services; a WebView may too).
  async function native(formats) {
    const BD = G.BarcodeDetector;
    if (typeof BD !== 'function' || typeof BD.getSupportedFormats !== 'function') return null;
    try {
      const have = await BD.getSupportedFormats();
      if (!formats.every((f) => have.includes(f))) return null;
      return new BD({ formats });
    } catch (e) { return null; }
  }

  // A BarcodeDetector-shaped reader on the worker: detect(source) → [{ format, rawValue, cornerPoints,
  // boundingBox }] for a whole canvas, bitmap or video.
  function detector(formats) {
    return {
      async detect(source) {
        const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
        const r = await read(source, { x: 0, y: 0, w, h }, { formats: formats || FORMATS, qr: !!(formats && formats.includes('qr_code')) });
        return r.found.map((b) => {
          const xs = b.cornerPoints.map((q) => q.x), ys = b.cornerPoints.map((q) => q.y);
          const x = Math.min(...xs), y = Math.min(...ys);
          return Object.assign({ boundingBox: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } }, b);
        });
      },
    };
  }

  /* ---------------------------------------------------------------- a scan */
  // The next frame the video shows (its number), or after 300 ms at the most.
  function nextFrame(video) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(-1); } }, 300);
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback((n, meta) => { if (!done) { done = true; clearTimeout(t); resolve(meta && meta.presentedFrames != null ? meta.presentedFrames : -1); } });
    });
  }

  // a: the scan GH.scanner started: { qr, accept, notThis, stream, sheet, finish(code), say(text),
  // showTorch(), stopped, cleanup: [] }.
  function run(a) {
    const el = a.sheet.el;
    const video = el.querySelector('video'), view = el.querySelector('.sc-view'), box = el.querySelector('.sc-frame');
    const formats = a.qr ? ['qr_code'] : FORMATS;
    const st = a.stats;
    const geo = { c: null, at: -1e9, vw: 0, vh: 0, zoom: 1, hw: 1 };
    a.looks = [];
    a.rule = rule();
    a.started = a.started || now();

    // Where the box is in the frame, read from the page at most twice a second.
    const geometry = () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      if (now() - geo.at < 500 && geo.vw === vw && geo.vh === vh) return geo;
      const vr = view.getBoundingClientRect(), br = box.getBoundingClientRect();
      if (!vr.width || !vr.height) return null;
      if (geo.vw !== vw || geo.vh !== vh) {
        geo.zoom = zoomFor(a.qr, vw, vh, vr.width, vr.height);
        view.style.setProperty('--sc-zoom', String(Math.round((geo.zoom / geo.hw) * 1000) / 1000));
        st.zoom = geo.zoom;
      }
      geo.vw = vw; geo.vh = vh; geo.at = now(); geo.W = vr.width; geo.H = vr.height;
      geo.c = cover(vw, vh, vr.width, vr.height, geo.zoom / geo.hw);
      const p0 = toFrame(geo.c, br.left - vr.left, br.top - vr.top), p1 = toFrame(geo.c, br.right - vr.left, br.bottom - vr.top);
      geo.box = { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
      // The box with a margin, inside the frame: a quarter of its width each side and half its height
      // above and below, so a code that fills the box (or a little more) keeps its quiet zones,
      // which ZXing needs (an eighth each side lost the dim and noisy test codes).
      const mx = geo.box.w * 0.25, my = geo.box.h * 0.5;
      const x0 = clamp(geo.box.x - mx, 0, vw), y0 = clamp(geo.box.y - my, 0, vh), x1 = clamp(geo.box.x + geo.box.w + mx, 0, vw), y1 = clamp(geo.box.y + geo.box.h + my, 0, vh);
      geo.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      st.size = `${vw}x${vh}`;
      return geo;
    };

    // A read: does it settle it? frame is the video's number for the frame read (the same whichever
    // engine read it), or -1 when it isn't known, which never matches another. pass: the reader's
    // pass that read it, which goes again while an EAN-8 or UPC-E waits for its second read.
    let unknown = 0;
    const take = (found, frame, engine, pass) => {
      if (a.stopped || a.locked || !found || !found.length) return;
      const key = frame >= 0 ? `f${frame}` : `u${++unknown}`;
      for (const b of found) {
        if (a.qr) {
          if (b.format && b.format !== 'qr_code') continue;
          const text = String(b.rawValue || '');
          if (text && (!a.accept || a.accept(text))) { lock(b, text, engine); return; }
          if (text && a.notThis) { a.say(a.notThis); a.hintAt = now(); }
          continue;
        }
        if (!FORMATS.includes(b.format)) continue;
        const code = canon(b.rawValue, b.format);
        if (a.rule.take(code, b.format, now(), key)) { lock(b, code, engine); return; }
        if (pass && TWICE[b.format] && checks(code)) again = { pass, until: now() + WITHIN };
      }
    };
    let again = null;

    // The lock-in: the picture holds, the code lights up where it is, the haptic, then the sheet closes.
    const lock = (b, code, engine) => {
      a.locked = true;
      st.engine = engine;
      st.readAt = Math.round(now() - a.started);
      try { video.pause(); } catch (e) { /* still showing */ }
      const g = geo.c ? geo : geometry();
      const mark = el.querySelector('.sc-lock');
      if (mark && g && g.c && b.cornerPoints && b.cornerPoints.length) {
        const pts = b.cornerPoints.map((q) => toView(g.c, q.x, q.y));
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        const pad = 6;
        const x = clamp(Math.min(...xs) - pad, 0, g.W), y = clamp(Math.min(...ys) - pad, 0, g.H);
        const w = Math.max(24, clamp(Math.max(...xs) + pad, 0, g.W) - x), h = Math.max(24, clamp(Math.max(...ys) + pad, 0, g.H) - y);
        mark.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
        mark.hidden = false;
      }
      box.setAttribute('data-locked', '');
      a.say(a.qr ? 'Got it' : code);
      if (U().haptic) U().haptic('scan');
      setTimeout(() => a.finish(code), U().reduced && U().reduced() ? 160 : 420);
    };

    // ZXing in the worker, each new frame, in turn: the box, the whole picture (a code outside the
    // box, on its side, or closer than it), and the box evened out (for a blurred, dim or noisy
    // code; it averages along the bars, so not for a plan's QR code).
    const PASSES = a.qr ? ['box', 'frame'] : ['box', 'frame', 'even'];
    const zxing = async () => {
      let n = 0, fails = 0;
      while (!a.stopped && !a.locked) {
        const f = await nextFrame(video);
        if (a.stopped || a.locked) return;
        const g = video.readyState >= 2 ? geometry() : null;
        if (!g) { await sleep(60); continue; }
        // The pass that read an EAN-8 or UPC-E once reads the next frames too, for its second read.
        const pass = again && now() < again.until ? again.pass : PASSES[n++ % PASSES.length], whole = pass === 'frame';
        const rect = whole ? { x: 0, y: 0, w: g.vw, h: g.vh } : g.crop;
        // Big pictures are made smaller (ZXing reads 1D codes along rows; more pixels than about
        // 1280 across only slow it down), small ones are left as they are.
        const scale = Math.min(1, 1280 / Math.max(rect.w, whole ? rect.h : 0));
        let r;
        try {
          r = await read(video, rect, { formats, scale, look: pass === 'box', enhance: pass === 'even', qr: a.qr, scan: a.started });
        } catch (e) {
          if (a.stopped) return;
          if (++fails >= 8 && !st.native) { a.fail(); return; }
          await sleep(120);
          continue;
        }
        fails = 0;
        if (st.firstAt == null) st.firstAt = Math.round(now() - a.started);
        st.zxing = (st.zxing || 0) + 1;
        st[pass] = (st[pass] || 0) + 1;
        st.how = r.how;
        st.ms = Math.round(((st.ms || 0) * (st.zxing - 1) + r.ms) / st.zxing);
        if (r.found && r.found.length) st.readBy = pass;
        if (r.look && !whole) {
          const l = r.look, bx = g.box, cr = g.crop;
          if (l.bars && l.bars.to != null) {
            // The bars' stretch as a fraction of the box's width.
            const from = cr.x + l.bars.from * cr.w, to = cr.x + l.bars.to * cr.w;
            l.bars.span = (Math.min(to, bx.x + bx.w) - Math.max(from, bx.x)) / bx.w;
          }
          a.looks.push(Object.assign({ t: now() }, l));
          if (a.looks.length > 40) a.looks.shift();
        }
        take(r.found, f, 'zxing', pass);
      }
    };

    // The phone's own detector, on the whole frame, about eight times a second.
    const platform = async (det) => {
      let last = 0, fails = 0;
      while (!a.stopped && !a.locked) {
        const f = await nextFrame(video);
        const wait = 120 - (now() - last);
        if (wait > 0) await sleep(wait);
        if (a.stopped || a.locked) return;
        if (video.readyState < 2 || !video.videoWidth) continue;
        last = now();
        let found;
        try { found = await det.detect(video); } catch (e) { if (++fails >= 5) return; continue; }
        st.native = (st.native || 0) + 1;
        take((found || []).map((b) => ({ format: b.format, rawValue: b.rawValue, cornerPoints: b.cornerPoints })), f, 'native');
      }
    };

    // Hints, after three seconds without a read; one stays at least a second and a half.
    a.hint = null;
    a.hintAt = 0;
    const tick = setInterval(() => {
      if (a.stopped || a.locked) return;
      const t = now();
      if (t - a.started < 3000 || t - a.hintAt < 1500) return;
      const h = hint(a.looks.filter((l) => t - l.t < 1500), { qr: a.qr, torch: !!a.hasTorch });
      if (h && h !== a.hint) {
        a.hint = h;
        a.hintAt = t;
        st.hint = h;
        a.say(HINTS[h]);
        const light = el.querySelector('[data-act="scanTorch"]');
        if (light) light.toggleAttribute('data-hint', h === 'dark');
      }
    }, 250);
    a.cleanup.push(() => clearInterval(tick));

    // A tap on the picture focuses there, where the camera can.
    const onTap = (e) => {
      if (a.stopped || a.locked || (e.target && e.target.closest && e.target.closest('button'))) return;
      const g = geometry();
      if (!g) return;
      const vr = view.getBoundingClientRect();
      const vx = e.clientX - vr.left, vy = e.clientY - vr.top;
      const p = toFrame(g.c, vx, vy);
      focusAt(a, { x: clamp(p.x / g.vw, 0, 1), y: clamp(p.y / g.vh, 0, 1) }, vx, vy);
    };
    view.addEventListener('click', onTap);
    a.cleanup.push(() => view.removeEventListener('click', onTap));

    tune(a, geo);
    zxing();
    native(formats).then((det) => {
      if (!det || a.stopped || a.locked) return;
      st.native = 0;
      platform(det);
    });
  }

  // The camera's own settings, where it has them: continuous focus, the light, and its own zoom. The
  // capabilities can come a moment after the stream does, so they're looked at again shortly.
  async function tune(a, geo) {
    const track = a.stream && a.stream.getVideoTracks ? a.stream.getVideoTracks()[0] : null;
    if (!track || !track.getCapabilities) return;
    const st = a.stats, done = {};
    for (const wait of [0, 500, 1500]) {
      if (wait) await sleep(wait);
      if (a.stopped || a.locked) return;
      let caps = {};
      try { caps = track.getCapabilities() || {}; } catch (e) { caps = {}; }
      if (caps.torch && !done.torch) { done.torch = true; a.hasTorch = true; st.torch = true; if (a.showTorch) a.showTorch(); }
      const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
      a.focusModes = modes;
      if (!done.focus && modes.includes('continuous')) {
        done.focus = true;
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); st.focus = 'continuous'; } catch (e) { /* stays as it was */ }
      }
      const z = caps.zoom;
      if (!done.zoom && z && z.max > 1.05 && z.min <= 1.01 && z.max <= 100 && geo.zoom > 1) {
        done.zoom = true;
        const hw = Math.round(clamp(geo.zoom, z.min, z.max) * 100) / 100;
        try {
          await track.applyConstraints({ advanced: [{ zoom: hw }] });
          geo.hw = hw;
          geo.at = -1e9;
          geo.vw = 0; // the next frame works the magnification out again, less what the camera does
          st.hwZoom = hw;
        } catch (e) { /* the picture is magnified instead */ }
      }
    }
  }

  // Focus where the finger is: a point of interest with a single-shot focus (or continuous where
  // that's all there is), then back to continuous after a few seconds, so it follows the next thing.
  async function focusAt(a, p, vx, vy) {
    const track = a.stream && a.stream.getVideoTracks ? a.stream.getVideoTracks()[0] : null;
    const modes = a.focusModes || [];
    if (!track || !modes.length) return;
    const set = { pointsOfInterest: [p], focusMode: modes.includes('single-shot') ? 'single-shot' : modes.includes('continuous') ? 'continuous' : modes[0] };
    try { await track.applyConstraints({ advanced: [set] }); } catch (e) { return; }
    a.stats.tapFocus = (a.stats.tapFocus || 0) + 1;
    const ring = a.sheet.el.querySelector('.sc-focus');
    if (ring) {
      ring.hidden = true;
      ring.style.left = `${vx}px`;
      ring.style.top = `${vy}px`;
      void ring.offsetWidth; // start its animation again
      ring.hidden = false;
      clearTimeout(a.ringOff);
      a.ringOff = setTimeout(() => { ring.hidden = true; }, 900);
    }
    clearTimeout(a.refocus);
    if (set.focusMode === 'single-shot' && modes.includes('continuous')) {
      a.refocus = setTimeout(() => { if (!a.stopped) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); }, 3000);
    }
  }

  GH.barcode = { FORMATS, ready, run, read, native, detector, rule, canon, cover, toFrame, toView, zoomFor, hint, HINTS };
})(typeof window !== 'undefined' ? window : globalThis);
