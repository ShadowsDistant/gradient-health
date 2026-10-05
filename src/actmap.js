// Activity maps without Google: MapLibre GL JS (BSD-3) drawing OpenFreeMap's vector tiles
// (tiles.openfreemap.org, OpenMapTiles schema, © OpenMapTiles © OpenStreetMap contributors), behind an
// activity's route (its summary) and following you as you record. A lazy chunk, loaded with
// GH.lazy('actmap') only when a map is about to show and there's no Google key or Google's map won't
// load (src/ui/activity.js, U.actMap; src/gmap.js is Google's): until then nothing is requested from
// OpenFreeMap. Sets GH.actmap = { mount(el, o) }, the same controller as Google's: mount(el, o) →
// { provider, update({ route, here }), destroy() }, with the options src/gmap.js describes.
//
// The style is the app's own and small: land, parks, water, buildings, roads and their names, in the
// app's light or dark colours, with no icons. The route draws on top in the page's pace colours (live:
// the activity's colour), and the markers are the page's own (start, finish, each km or mile, and
// where you are), drawn as Google's are. MapLibre's web worker is its own chunk
// (dist/lazy/actmap-worker.js), from the app's own origin.
import { Map as MLMap, LngLatBounds, Marker, setWorkerUrl, setWorkerCount } from 'maplibre-gl';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];

const LOOKS = {
  light: { land: '#f2f1ec', park: '#dcebd3', wood: '#d2e4c8', water: '#b5d3ea', waterLine: '#9cc3e2', building: '#e3e1da', buildingLine: '#d6d3cb', residential: '#ecebe5', minor: '#ffffff', minorCase: '#d9d7d0', major: '#ffffff', majorCase: '#cfccc3', motorway: '#fde2b3', motorwayCase: '#e7c07f', path: '#b9b4a8', rail: '#c3c0b9', text: '#5f6472', halo: '#ffffff' },
  dark: { land: '#1b1d23', park: '#1f2a22', wood: '#1d271f', water: '#152636', waterLine: '#1c3246', building: '#24262d', buildingLine: '#2b2e36', residential: '#1e2026', minor: '#30333b', minorCase: '#23252b', major: '#3b3f48', majorCase: '#262930', motorway: '#4b4336', motorwayCase: '#302b24', path: '#4a4d57', rail: '#3a3d45', text: '#aeb3bf', halo: '#16181d' },
};
const zw = (a, b) => ['interpolate', ['exponential', 1.5], ['zoom'], 12, a, 18, b];

function style(dark) {
  const c = dark ? LOOKS.dark : LOOKS.light;
  const cls = (...v) => ['in', ['get', 'class'], ['literal', v]];
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: 'vector', url: TILES } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      { id: 'residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: cls('residential', 'suburb', 'neighbourhood'), paint: { 'fill-color': c.residential } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('wood', 'forest', 'scrub'), paint: { 'fill-color': c.wood } },
      { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: cls('grass', 'meadow', 'park'), paint: { 'fill-color': c.park } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.park } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': c.waterLine, 'line-width': zw(0.8, 4) } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine } },
      { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('path', 'track', 'pedestrian'), paint: { 'line-color': c.path, 'line-width': zw(0.6, 2.4), 'line-dasharray': [2, 1.5] } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('rail', 'transit'), paint: { 'line-color': c.rail, 'line-width': zw(0.6, 2) } },
      { id: 'minor-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('minor', 'service'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.minorCase, 'line-width': zw(1.4, 13) } },
      { id: 'major-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('primary', 'secondary', 'tertiary', 'trunk'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.majorCase, 'line-width': zw(2.2, 19) } },
      { id: 'motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('motorway'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorwayCase, 'line-width': zw(2.6, 22) } },
      { id: 'minor', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('minor', 'service'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.minor, 'line-width': zw(0.8, 11) } },
      { id: 'major', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('primary', 'secondary', 'tertiary', 'trunk'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.major, 'line-width': zw(1.4, 16) } },
      { id: 'motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: cls('motorway'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorway, 'line-width': zw(1.8, 18) } },
      { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': FONT, 'text-size': 11, 'text-max-angle': 30 }, paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
      { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('suburb', 'neighbourhood', 'quarter', 'village', 'town', 'city'), layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': FONT, 'text-size': 12 }, paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
    ],
  };
}

// The route as features: one line per stretch of the same pace colour (live: one colour), plus each
// stretch whole for the casing.
function features(route, buckets) {
  const lines = [], casing = [];
  let cur = null, coords = [], all = [];
  const flush = () => { if (coords.length > 1) lines.push({ type: 'Feature', properties: { b: cur }, geometry: { type: 'LineString', coordinates: coords } }); coords = []; };
  for (let i = 0; i < route.length; i++) {
    const p = [route[i].lon, route[i].lat];
    if (i > 0 && route[i].gap) { flush(); if (all.length > 1) casing.push(all); all = []; cur = null; }
    all.push(p);
    if (i === 0 || route[i].gap) { coords = [p]; continue; }
    const b = buckets && buckets.has(i) ? buckets.get(i) : 2;
    if (b !== cur) { flush(); coords = [[route[i - 1].lon, route[i - 1].lat]]; cur = b; }
    coords.push(p);
  }
  flush();
  if (all.length > 1) casing.push(all);
  return {
    lines: { type: 'FeatureCollection', features: lines },
    casing: { type: 'FeatureCollection', features: casing.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) },
  };
}

// The bounds b grown by `by` times their own size on every side (a map can't be dragged farther off).
function grow(b, by) {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const dx = Math.max(0.005, (ne.lng - sw.lng) * by), dy = Math.max(0.005, (ne.lat - sw.lat) * by);
  return new LngLatBounds([sw.lng - dx, sw.lat - dy], [ne.lng + dx, ne.lat + dy]);
}

// The page's markers (src/styles/activity.css), in a wrapper MapLibre positions: start and finish, a
// numbered disc per km or mile, and where you are (a dot in its accuracy, with a wedge for which way
// you're heading).
function markEl(cls, text) {
  const e = G.document.createElement('div');
  const inner = G.document.createElement('div');
  inner.className = `mk ${cls}`;
  if (text != null) inner.textContent = String(text);
  else if (cls === 'mk-here') inner.innerHTML = '<span class="mk-acc"></span><span class="mk-dir"></span><span class="mk-dot"></span>';
  e.appendChild(inner);
  return e;
}
// A colour as MapLibre takes it, from the page's { hex, a }.
const css = (c, d) => {
  if (!c || !c.hex) return d;
  if (!(c.a < 1)) return c.hex;
  const n = (i) => parseInt(c.hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${c.a})`;
};

let workerSet = false;
function mount(el, o) {
  const opt = o || {};
  if (!workerSet) {
    // The worker comes from the app's own origin, next to this chunk.
    setWorkerUrl(new URL('lazy/actmap-worker.js', G.document.baseURI).href);
    try { setWorkerCount(1); } catch (e) { /* older API */ }
    workerSet = true;
  }
  let map = null, done = false, dead = false, timer = 0, loaded = false, follow = true, fitting = false;
  let route = opt.route || [], lastHere = opt.here || null, here = null, startMark = null, fit = null;
  const marks = [];
  const ok = () => { if (done) return; done = true; clearTimeout(timer); if (opt.onReady) opt.onReady(); };
  const fail = (e) => { if (done || dead) return; done = true; clearTimeout(timer); if (opt.onFail) opt.onFail(e); };
  const pad = { top: 28, right: 28, bottom: 46, left: 28 };
  const b = new LngLatBounds();
  for (const p of route) b.extend([p.lon, p.lat]);
  // Where a live map opens: where you are, else the route's end. It waits for one of those.
  const liveAt = () => (lastHere ? [lastHere.lon, lastHere.lat] : route.length ? [route[route.length - 1].lon, route[route.length - 1].lat] : null);
  const ctl = { provider: 'maplibre', update, destroy };
  if (!opt.live || liveAt()) build();
  return ctl;

  function build() {
    try {
      // Two fingers move and zoom the map, the way a map in a scrolling page works: one finger keeps
      // scrolling the page, and a hint says to use two. It doesn't turn or tilt; a summary's stays
      // around the route (no farther out than a little past where it starts, and no farther off than
      // the route's own span), and a live one follows you until a finger moves it. The attribution
      // line sits along the bottom (the page's own, as MapLibre's control is off): the route keeps
      // clear of it.
      map = new MLMap({
        container: el, style: style(opt.dark), attributionControl: false,
        fadeDuration: 0, maxZoom: 17.5, pixelRatio: Math.min(2, G.devicePixelRatio || 1), cancelPendingTileRequestsWhileZooming: true,
        ...(opt.live ? { center: liveAt(), zoom: 15.5 } : { bounds: b, fitBoundsOptions: { padding: pad }, maxBounds: grow(b, 1) }),
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false, boxZoom: false,
        locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl and scroll to zoom the map', 'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ and scroll to zoom the map', 'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move or zoom the map' },
      });
      map.touchZoomRotate.disableRotation();
      // Back to the whole route (a summary) or to following you (live): a small glass button, there
      // once a finger has moved the map.
      fit = G.document.createElement('button');
      fit.type = 'button';
      fit.className = 'rf-btn rf-glass am-fit';
      fit.setAttribute('data-size', 'sm');
      fit.setAttribute('data-variant', 'thick');
      fit.setAttribute('data-shape', 'circle');
      fit.setAttribute('aria-label', opt.live ? 'Follow your position' : 'Show the whole route');
      fit.hidden = true;
      fit.innerHTML = GH.ui && GH.ui.icon ? GH.ui.icon(opt.live ? 'navigate' : 'expand') : '';
      fit.addEventListener('click', () => {
        fit.hidden = true;
        if (!opt.live) { fitting = true; map.fitBounds(b, { padding: pad, duration: 420 }); return; }
        follow = true;
        if (lastHere) map.easeTo({ center: [lastHere.lon, lastHere.lat], duration: 420 });
      });
      el.appendChild(fit);
      map.on('dragstart', (e) => { if (e && e.originalEvent) { follow = false; fit.hidden = false; } });
      map.on('moveend', (e) => { if (e && e.originalEvent && !opt.live) fit.hidden = false; });
      // Its zoom, for anything that asks (the tests).
      map.on('zoomend', () => { el.dataset.zoom = map.getZoom().toFixed(2); fitting = false; });
      map.on('zoom', () => sizeHere());
      map.once('load', () => {
        el.dataset.zoom = map.getZoom().toFixed(2);
        if (!opt.live) { try { map.setMinZoom(Math.max(0, map.getZoom() - 1)); } catch (err) { /* ignore */ } }
      });
    } catch (e) { setTimeout(() => fail(e), 0); return; }
    // Offline, or the map never came: the drawn route stays. (A tile that fails once the map is up
    // just leaves a gap.)
    timer = setTimeout(() => fail(new Error('timeout')), 20000);
    map.on('error', (e) => { if (!loaded) fail(e && e.error); });
    map.on('load', () => {
      loaded = true;
      const f = features(route, opt.live ? null : opt.buckets);
      map.addSource('route-case', { type: 'geojson', data: f.casing });
      map.addSource('route', { type: 'geojson', data: f.lines });
      map.addLayer({ id: 'route-case', type: 'line', source: 'route-case', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': css(opt.casing, '#ffffff'), 'line-width': opt.live ? 11 : 9 } });
      const cols = opt.colors || [];
      const col = opt.live ? css(opt.line, '#e5674f') : ['match', ['get', 'b'], 0, css(cols[0], '#0465af'), 1, css(cols[1], '#5492c5'), 3, css(cols[3], '#cb7960'), 4, css(cols[4], '#bd3c22'), css(cols[2], '#a4a4a4')];
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 5 } });
      // The markers: each km or mile, then the finish and the start on top (a summary); the start and
      // where you are (live).
      const add = (cls, at, text) => { const m = new Marker({ element: markEl(cls, text), anchor: 'center' }).setLngLat(at).addTo(map); marks.push(m); return m; };
      if (!opt.live) {
        for (const m of opt.marks || []) add('mk-km', [m.lon, m.lat], m.n);
        if (route.length) { add('mk-end', [route[route.length - 1].lon, route[route.length - 1].lat]); add('mk-start', [route[0].lon, route[0].lat]); }
      } else {
        if (route.length) startMark = add('mk-start', [route[0].lon, route[0].lat]);
        here = add('mk-here', liveAt());
        placeHere();
      }
      map.once('idle', ok);
    });
  }

  // Where you are: the dot, its accuracy in pixels at this zoom (MapLibre's 512 px tiles), the wedge.
  function placeHere() {
    if (!here || !lastHere) return;
    here.setLngLat([lastHere.lon, lastHere.lat]);
    const dot = here.getElement().firstChild;
    const h = lastHere.heading;
    dot.toggleAttribute('data-heading', h != null);
    if (h != null) dot.style.setProperty('--mk-heading', `${Math.round(h)}deg`);
    sizeHere();
  }
  function sizeHere() {
    if (!here || !lastHere || !map) return;
    const mpp = (40075016.686 * Math.cos((lastHere.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    here.getElement().firstChild.style.setProperty('--mk-acc', `${Math.min(400, (lastHere.acc > 0 ? lastHere.acc : 0) / mpp).toFixed(1)}px`);
  }

  // Live: the route so far, and where you are now (kept in sight while it follows).
  function update(u) {
    if (dead || !u) return;
    if (u.route) route = u.route;
    if (u.here) lastHere = u.here;
    if (!map) { if (opt.live && liveAt()) build(); return; }
    if (!loaded) return;
    if (u.route) {
      const f = features(route, null);
      map.getSource('route-case').setData(f.casing);
      map.getSource('route').setData(f.lines);
      if (!startMark && route.length) startMark = new Marker({ element: markEl('mk-start'), anchor: 'center' }).setLngLat([route[0].lon, route[0].lat]).addTo(map);
      if (startMark && !marks.includes(startMark)) marks.push(startMark);
    }
    if (u.here) {
      placeHere();
      if (follow) map.easeTo({ center: [lastHere.lon, lastHere.lat], duration: 600 });
    }
  }

  function destroy() {
    dead = true;
    done = true;
    clearTimeout(timer);
    for (const m of marks) { try { m.remove(); } catch (e) { /* gone */ } }
    try { if (map) map.remove(); } catch (e) { /* already gone */ }
    map = null;
    if (fit) fit.remove();
  }
}

GH.actmap = { mount, style, features };
