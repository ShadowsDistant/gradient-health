// Activity maps from Google: the Maps JavaScript API behind an activity's route (its summary) and
// following you as you record. A lazy chunk: the page loads it with GH.lazy('gmap') only when a map
// is about to show and the app has a key (AndroidBridge.mapsKey, from the build), and this loads
// Google's script then. Sets GH.gmap = { mount(el, o) }, the same controller src/actmap.js gives for
// MapLibre, which stands in whenever there's no key or Google won't load: src/ui/activity.js
// (U.actMap) swaps one for the other, even after Google's map has shown.
//
// mount(el, o) → { provider, update({ route, here }), destroy() }. o: route [{ lat, lon, gap }]; for
// a summary, buckets (route index → pace step 0-4), colors (the five pace colours) and marks
// [{ lat, lon, n }] (each km or mile); for live, live: true, line (its colour) and here ({ lat, lon,
// acc, heading }); casing (colours are { hex, a }), dark, bg, key, onReady, onFail(why: 'load',
// 'timeout' or 'auth').
//
// As MapLibre's: two fingers move and zoom it while one finger scrolls the page (cooperative
// gestures), no turning or tilting, a summary's map stays around its route (no farther out than a
// little past the whole of it) with a button to fit it again once a finger has moved it, and a live
// map follows the position with a dot (and which way you're heading, once the GPS knows) until a
// finger moves it, when the button follows again. The route is Google's own polylines; the markers
// are the page's own (an overlay), drawn like the drawn route's. Dark when the app is: Google's dark
// colour scheme. Google's logo and attribution stay where Google puts them, and its links leave the
// app (MainActivity sends every other page to the browser).
const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const doc = G.document;

// Quieter than Google's default: no shops and businesses, no place or transit icons (they compete
// with the route); parks, water, streets and their names stay.
const STYLES = [
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
const PAD = { top: 28, right: 28, bottom: 46, left: 28 };
const LIVE_ZOOM = 16;

let api = null; // a promise of google.maps
let refused = false; // Google turned the key down this session
const mounted = new Set();
// Google calls this when it turns the key down (a wrong key, the API not enabled, a website it isn't
// allowed on): every map of ours goes over to OpenFreeMap.
const earlier = G.gm_authFailure;
G.gm_authFailure = function () {
  refused = true;
  for (const c of [...mounted]) c.fail('auth');
  if (typeof earlier === 'function') { try { earlier(); } catch (e) { /* ignore */ } }
};

// Google's script, once (tried again after a failed load). A page that already has google.maps (a
// test's stand-in) uses it.
function load(key) {
  if (refused) return Promise.reject(new Error('auth'));
  const have = G.google && G.google.maps;
  if (have && have.importLibrary) return Promise.resolve(have);
  if (!api) {
    api = new Promise((resolve, reject) => {
      const cb = `__ghMaps${Math.random().toString(36).slice(2, 8)}`;
      const s = doc.createElement('script');
      let timer = 0;
      const end = (err) => {
        clearTimeout(timer);
        try { delete G[cb]; } catch (e) { G[cb] = undefined; }
        if (!err) return;
        s.remove();
        api = null;
        reject(err);
      };
      G[cb] = () => {
        const gm = G.google && G.google.maps;
        if (gm && gm.importLibrary) { end(); resolve(gm); } else end(new Error('load'));
      };
      // Only the page's origin goes to Google with the key's check (auth_referrer_policy).
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly&loading=async&auth_referrer_policy=origin&callback=${cb}`;
      s.async = true;
      s.onerror = () => end(new Error('load'));
      timer = setTimeout(() => end(new Error('timeout')), 20000);
      doc.head.appendChild(s);
    });
  }
  return api;
}

// The page's markers: start and finish, a numbered disc per km or mile, and where you are (a dot in
// its accuracy, with a wedge for which way you're heading).
function markEl(cls, text) {
  const e = doc.createElement('div');
  e.className = `mk ${cls}`;
  if (text != null) e.textContent = String(text);
  return e;
}
function hereEl() {
  const e = markEl('mk-here');
  e.innerHTML = '<span class="mk-acc"></span><span class="mk-dir"></span><span class="mk-dot"></span>';
  return e;
}

// Each stretch whole (between pauses), for the casing, and lines of one pace step each.
function pieces(route, buckets) {
  const casing = [], lines = [];
  let all = [], cur = null, run = [];
  const ll = (p) => ({ lat: p.lat, lng: p.lon });
  const flush = () => { if (run.length > 1) lines.push({ b: cur, path: run }); run = []; };
  route.forEach((p, i) => {
    if (i > 0 && p.gap) { flush(); if (all.length > 1) casing.push(all); all = []; cur = null; }
    all.push(ll(p));
    if (i === 0 || p.gap) { run = [ll(p)]; return; }
    const b = buckets && buckets.has(i) ? buckets.get(i) : 2;
    if (b !== cur) { flush(); run = [ll(route[i - 1])]; cur = b; }
    run.push(ll(p));
  });
  flush();
  if (all.length > 1) casing.push(all);
  return { casing, lines };
}

// The bounds b grown by their own size on every side.
function grow(b, LatLngBounds) {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const s = sw.lat(), w = sw.lng(), n = ne.lat(), e = ne.lng();
  const dy = Math.max(0.005, n - s), dx = Math.max(0.005, e - w);
  return new LatLngBounds({ lat: s - dy, lng: w - dx }, { lat: n + dy, lng: e + dx });
}

function mount(el, o) {
  const opt = o || {};
  let lib = null; // { maps, core }
  let map = null, overlay = null, dead = false, ready = false, timer = 0;
  let casings = [], strokes = [], marks = [], here = null, fitBtn = null, bounds = null;
  let follow = true, fitting = false, fitZoom = null;
  let route = opt.route || [], lastHere = opt.here || null;
  const listeners = [], checks = [];
  // Google drew its own refusal instead of (or over) the map: its error page, or its "This page can't
  // load Google Maps correctly" over a watermarked one (a key it won't serve: billing off, the API not
  // enabled, a website the key isn't allowed on). Either way it turned the key down.
  const turnedDown = () => !!el.querySelector('.gm-err-container, .gm-err-message, .dismissButton');
  const ctl = {
    provider: 'google',
    update,
    destroy,
    // Google won't (or can't) draw it: everything goes, and the page swaps in OpenFreeMap's.
    fail(why) {
      if (dead) return;
      destroy();
      if (opt.onFail) opt.onFail(why);
    },
  };
  mounted.add(ctl);
  timer = setTimeout(() => { if (!ready) ctl.fail('timeout'); }, 20000);
  load(opt.key)
    .then((g) => Promise.all([g.importLibrary('maps'), g.importLibrary('core')]))
    .then(([maps, core]) => {
      if (dead) return;
      lib = { maps, core, LatLng: core.LatLng, LatLngBounds: core.LatLngBounds, event: core.event };
      // A live map waits for somewhere to show.
      if (!opt.live || lastHere || route.length) build();
    })
    .catch((e) => ctl.fail(e && /^(auth|timeout)$/.test(e.message) ? e.message : 'load'));

  function build() {
    const { maps, LatLng, LatLngBounds, event } = lib;
    bounds = new LatLngBounds();
    for (const p of route) bounds.extend({ lat: p.lat, lng: p.lon });
    const last = route.length ? route[route.length - 1] : null;
    const center = opt.live ? (lastHere ? { lat: lastHere.lat, lng: lastHere.lon } : { lat: last.lat, lng: last.lon }) : bounds.getCenter();
    const g = G.google && G.google.maps;
    const scheme = g && g.ColorScheme ? (opt.dark ? g.ColorScheme.DARK : g.ColorScheme.LIGHT) : opt.dark ? 'DARK' : 'LIGHT';
    map = new maps.Map(el, {
      center, zoom: opt.live ? LIVE_ZOOM : 14,
      gestureHandling: 'cooperative', disableDefaultUI: true, keyboardShortcuts: false, clickableIcons: false,
      colorScheme: scheme, styles: STYLES, backgroundColor: opt.bg || undefined,
      tilt: 0, heading: 0, rotateControl: false, headingInteractionEnabled: false, tiltInteractionEnabled: false,
      isFractionalZoomEnabled: false, maxZoom: 19, minZoom: 3,
      // A summary's map stays around its route: no farther off than the route's own span.
      restriction: !opt.live && route.length ? { latLngBounds: grow(bounds, LatLngBounds), strictBounds: false } : undefined,
    });
    draw();
    // The markers, as the page draws them.
    const Overlay = class extends maps.OverlayView {
      onAdd() {
        this.box = doc.createElement('div');
        this.box.className = 'mk-layer';
        for (const m of marks) this.box.appendChild(m.el);
        if (here) this.box.appendChild(here.el);
        this.getPanes().markerLayer.appendChild(this.box);
      }
      onRemove() { if (this.box) this.box.remove(); this.box = null; }
      draw() {
        const pr = this.getProjection();
        if (!pr || !this.box) return;
        const at = (lat, lon) => pr.fromLatLngToDivPixel(new LatLng(lat, lon));
        const put = (e, p) => { e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`; };
        for (const m of marks) { const p = at(m.lat, m.lon); if (p) put(m.el, p); }
        if (!here || !here.pos) return;
        const p = at(here.pos.lat, here.pos.lon);
        if (!p) return;
        put(here.el, p);
        // The accuracy circle in pixels at this zoom: how far a point that many metres north is.
        const n = here.pos.acc > 0 ? at(here.pos.lat + here.pos.acc / 111195, here.pos.lon) : null;
        here.el.style.setProperty('--mk-acc', `${Math.min(400, n ? Math.abs(p.y - n.y) : 0).toFixed(1)}px`);
        const h = here.pos.heading;
        here.el.toggleAttribute('data-heading', h != null);
        if (h != null) here.el.style.setProperty('--mk-heading', `${Math.round(h)}deg`);
      }
    };
    if (!opt.live) {
      for (const m of opt.marks || []) marks.push({ el: markEl('mk-km', m.n), lat: m.lat, lon: m.lon });
      if (last) {
        marks.push({ el: markEl('mk-end'), lat: last.lat, lon: last.lon });
        marks.push({ el: markEl('mk-start'), lat: route[0].lat, lon: route[0].lon });
      }
    } else {
      if (route.length) marks.push({ el: markEl('mk-start'), lat: route[0].lat, lon: route[0].lon });
      here = { el: hereEl(), pos: lastHere };
      here.el.hidden = !lastHere;
    }
    overlay = new Overlay();
    overlay.setMap(map);
    // The button that fits the route again (a summary) or follows you again (live): there once a
    // finger has moved the map.
    fitBtn = doc.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'rf-btn rf-glass am-fit';
    fitBtn.setAttribute('data-size', 'sm');
    fitBtn.setAttribute('data-variant', 'thick');
    fitBtn.setAttribute('data-shape', 'circle');
    fitBtn.setAttribute('aria-label', opt.live ? 'Follow your position' : 'Show the whole route');
    fitBtn.hidden = true;
    fitBtn.innerHTML = GH.ui && GH.ui.icon ? GH.ui.icon(opt.live ? 'navigate' : 'expand') : '';
    fitBtn.addEventListener('click', () => {
      fitBtn.hidden = true;
      if (!opt.live) { fit(); return; }
      follow = true;
      if (lastHere) map.panTo({ lat: lastHere.lat, lng: lastHere.lon });
    });
    el.appendChild(fitBtn);
    const on = (name, fn) => listeners.push(map.addListener(name, fn));
    on('dragstart', () => { follow = false; fitBtn.hidden = false; });
    on('zoom_changed', () => { if (ready && !fitting && !opt.live) fitBtn.hidden = false; });
    on('idle', () => {
      const z = map.getZoom();
      if (z != null) el.dataset.zoom = Number(z).toFixed(2);
      if (fitting) {
        fitting = false;
        // No farther out than a little past the whole route.
        if (fitZoom == null && z != null) { fitZoom = z; map.setOptions({ minZoom: Math.max(3, z - 1) }); }
      }
      if (turnedDown()) ctl.fail('auth');
    });
    // Its "can't load Google Maps correctly" comes a moment after the map: looked for then too.
    for (const ms of [1500, 4000, 10000]) checks.push(setTimeout(() => { if (!dead && turnedDown()) ctl.fail('auth'); }, ms));
    listeners.push(event.addListenerOnce(map, 'tilesloaded', () => {
      if (dead || ready) return;
      ready = true;
      clearTimeout(timer);
      if (opt.onReady) opt.onReady();
    }));
    if (!opt.live && route.length > 1) { fitting = true; map.fitBounds(bounds, PAD); }
  }

  // The route as Google's lines: a soft casing under each stretch, then the pace's colours (or the
  // live colour). A live update moves the lines it has rather than drawing them again.
  function draw() {
    const { maps } = lib;
    const col = (c, d) => (c && c.hex ? c : d);
    const casing = col(opt.casing, { hex: '#ffffff', a: 1 });
    const { casing: stretches, lines } = pieces(route, opt.live ? null : opt.buckets);
    const want = opt.live ? stretches.map((path) => ({ path, c: col(opt.line, { hex: '#e5674f', a: 1 }) }))
      : lines.map(({ b, path }) => ({ path, c: col(opt.colors && opt.colors[b], { hex: '#a4a4a4', a: 1 }) }));
    const line = (path, c, weight, z) => new maps.Polyline({ map, path, clickable: false, strokeColor: c.hex, strokeOpacity: c.a, strokeWeight: weight, zIndex: z });
    if (opt.live && casings.length === stretches.length && strokes.length === want.length) {
      stretches.forEach((path, i) => casings[i].setPath(path));
      want.forEach((w, i) => strokes[i].setPath(w.path));
      return;
    }
    for (const l of casings.concat(strokes)) l.setMap(null);
    casings = stretches.map((path) => line(path, casing, opt.live ? 11 : 9, 1));
    strokes = want.map((w) => line(w.path, w.c, 5, 2));
  }

  // Back to the whole route (a summary).
  function fit() {
    if (!map || !bounds || bounds.isEmpty()) return;
    fitting = true;
    map.fitBounds(bounds, PAD);
  }

  // Live: the route so far, and where you are now (kept in sight while it follows).
  function update(u) {
    if (dead || !u) return;
    if (u.route) route = u.route;
    if (u.here) lastHere = u.here;
    if (!lib) return;
    if (!map) { if (lastHere || route.length) build(); return; }
    if (u.route) {
      draw();
      if (route.length && opt.live && !marks.length && overlay) {
        const m = { el: markEl('mk-start'), lat: route[0].lat, lon: route[0].lon };
        marks.push(m);
        if (overlay.box) overlay.box.insertBefore(m.el, overlay.box.firstChild);
      }
    }
    if (u.here && here) {
      here.pos = u.here;
      here.el.hidden = false;
      if (follow) map.panTo({ lat: u.here.lat, lng: u.here.lon });
      if (overlay) overlay.draw();
    }
  }

  function destroy() {
    if (dead) return;
    dead = true;
    mounted.delete(ctl);
    clearTimeout(timer);
    for (const t of checks) clearTimeout(t);
    for (const l of listeners) { try { l.remove(); } catch (e) { /* gone */ } }
    for (const l of casings.concat(strokes)) { try { l.setMap(null); } catch (e) { /* gone */ } }
    if (overlay) { try { overlay.setMap(null); } catch (e) { /* gone */ } }
    try { if (map && lib && lib.event) lib.event.clearInstanceListeners(map); } catch (e) { /* gone */ }
    map = null; overlay = null; casings = []; strokes = []; marks = [];
    el.textContent = '';
  }
  return ctl;
}

GH.gmap = { mount, load, pieces, STYLES };
