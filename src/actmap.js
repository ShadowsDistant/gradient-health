// Activity maps: MapLibre GL JS (BSD-3) drawing OpenFreeMap's vector tiles (tiles.openfreemap.org,
// OpenMapTiles schema, © OpenMapTiles © OpenStreetMap contributors), behind an activity's route (its
// summary) and following you as you record. A lazy chunk, loaded with GH.lazy('actmap') only when a
// map is about to show (src/ui/activity.js, U.actMap): until then nothing is asked of OpenFreeMap.
// Sets GH.actmap = { mount(el, o), style, features }.
//
// What it asks of OpenFreeMap goes through the page's U.mapPieces, which keeps every piece on the
// phone (src/ui/activity.js): the tiles and the type for names are asked for as ghmap:// (a protocol of
// the app's, registered here), so a map shown before draws at once, and with no connection (a tile
// kept from an earlier week of OpenFreeMap's too). The TileJSON (which week's tiles are current)
// comes from U.actMap, fetched while this chunk loads (o.tilejson), so the map starts one round trip
// sooner; offline, it's the one kept from last time.
//
// The style is the app's own and small: land, parks, water, buildings, roads and the names of water,
// streets and places, in the app's light or dark colours, with no icons. A theme change recolours
// it in place (restyle), without loading anything again. The route draws on top in the page's pace
// colours (live: the activity's colour), and the markers are the page's own (start, finish, each km or
// mile, and where you are). MapLibre's web worker is its own chunk (dist/lazy/actmap-worker.js), from
// the app's own origin. Under reduced motion the map jumps where it would glide.
//
// mount(el, o) → { provider, update({ route, here }), restyle({ dark, colors, casing, line }), destroy() }
// o: { route, buckets, marks, colors, casing, line, dark, live, here, tilejson, onReady, onFail }
// - route: [{ lat, lon, gap? }]; buckets: Map(index → pace bucket 0-4) (a summary); marks: the km or
//   mile discs, [{ lat, lon, n }]; colors: the five pace colours, casing: under the line, line: a live
//   map's one colour (each { hex, a }); dark: the app's theme.
// - live: a map that follows you (here: { lat, lon, acc, heading }), else a summary fitted to the route.
// - tilejson: a promise of OpenFreeMap's TileJSON. onReady: drawn; onFail(e): it couldn't be (offline
//   with nothing kept, an engine error): the page keeps the route it drew itself.
import { Map as MLMap, LngLatBounds, Marker, setWorkerUrl, setWorkerCount, addProtocol } from 'maplibre-gl';

const G = typeof window !== 'undefined' ? window : globalThis;
const GH = G.GH || (G.GH = {});
const HOST = 'tiles.openfreemap.org';
const GLYPHS = `ghmap://${HOST}/fonts/{fontstack}/{range}.pbf`;
const FONT = ['Noto Sans Regular'];

const LOOKS = {
  light: { land: '#f2f1ec', park: '#dcebd3', wood: '#d2e4c8', water: '#b5d3ea', waterLine: '#9cc3e2', building: '#e3e1da', buildingLine: '#d6d3cb', residential: '#ecebe5', minor: '#ffffff', minorCase: '#d9d7d0', major: '#ffffff', majorCase: '#cfccc3', motorway: '#fde2b3', motorwayCase: '#e7c07f', path: '#b9b4a8', rail: '#c3c0b9', text: '#5f6472', textWater: '#4a7aa3', halo: '#ffffff' },
  dark: { land: '#1b1d23', park: '#1f2a22', wood: '#1d271f', water: '#152636', waterLine: '#1c3246', building: '#24262d', buildingLine: '#2b2e36', residential: '#1e2026', minor: '#30333b', minorCase: '#23252b', major: '#3b3f48', majorCase: '#262930', motorway: '#4b4336', motorwayCase: '#302b24', path: '#4a4d57', rail: '#3a3d45', text: '#aeb3bf', textWater: '#7ea6c9', halo: '#16181d' },
};
const zw = (a, b) => ['interpolate', ['exponential', 1.5], ['zoom'], 12, a, 18, b];
const NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

// The map's layers in the light or dark colours (the same ids and properties either way, so a theme
// change only sets paint values).
function layers(dark) {
  const c = dark ? LOOKS.dark : LOOKS.light;
  const cls = (...v) => ['in', ['get', 'class'], ['literal', v]];
  const name = (color, halo) => ({ 'text-color': color, 'text-halo-color': c.halo, 'text-halo-width': halo });
  return [
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
    // Names: rivers and lakes to find your way by, then streets, then places.
    { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 13, layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 }, paint: name(c.textWater, 1.2) },
    { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': 11, 'text-max-angle': 30 }, paint: name(c.text, 1.4) },
    { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: cls('suburb', 'neighbourhood', 'quarter', 'village', 'town', 'city'), layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12 }, paint: name(c.text, 1.6) },
  ];
}

// The style: OpenFreeMap's tiles as the TileJSON gives them, asked for through ghmap:// (kept on the
// phone; only OpenFreeMap's own addresses are), and the type for names the same way.
function style(dark, tj) {
  const tiles = ((tj && tj.tiles) || []).filter((u) => typeof u === 'string' && u.startsWith(`https://${HOST}/`)).map((u) => `ghmap://${u.slice(8)}`);
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { omt: { type: 'vector', tiles, minzoom: (tj && tj.minzoom) || 0, maxzoom: (tj && tj.maxzoom) || 14, attribution: (tj && tj.attribution) || '' } },
    layers: layers(dark),
  };
}

// ghmap://<host>/<path>: OpenFreeMap's https://<host>/<path>, through the page's kept pieces.
let protocolSet = false;
function useProtocol() {
  if (protocolSet) return;
  protocolSet = true;
  addProtocol('ghmap', async (params, abort) => {
    const url = `https://${params.url.slice('ghmap://'.length)}`;
    if (!url.startsWith(`https://${HOST}/`)) throw new Error('not an OpenFreeMap address');
    const P = GH.ui && GH.ui.mapPieces;
    const res = P ? await P.get(url, { signal: abort.signal }) : await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.arrayBuffer() };
  });
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
// The route's paint: the casing, and the line in the pace colours (a summary) or one colour (live).
function routePaint(o) {
  const cols = o.colors || [];
  return {
    casing: css(o.casing, '#ffffff'),
    line: o.live ? css(o.line, '#e5674f') : ['match', ['get', 'b'], 0, css(cols[0], '#0465af'), 1, css(cols[1], '#5492c5'), 3, css(cols[3], '#cb7960'), 4, css(cols[4], '#bd3c22'), css(cols[2], '#a4a4a4')],
  };
}
const still = () => !!(GH.ui && GH.ui.reduced && GH.ui.reduced());

let workerSet = false, made = 0;
function mount(el, o) {
  const opt = Object.assign({}, o || {});
  if (!workerSet) {
    // The worker comes from the app's own origin, next to this chunk.
    setWorkerUrl(new URL('lazy/actmap-worker.js', G.document.baseURI).href);
    try { setWorkerCount(1); } catch (e) { /* older API */ }
    workerSet = true;
  }
  useProtocol();
  let map = null, done = false, dead = false, timer = 0, loaded = false, follow = true, tilesOk = 0, tilesBad = 0;
  let route = opt.route || [], lastHere = opt.here || null, here = null, startMark = null, fit = null;
  const marks = [];
  const ok = () => { if (done) return; done = true; clearTimeout(timer); if (opt.onReady) opt.onReady(); };
  const fail = (e) => { if (done || dead) return; done = true; clearTimeout(timer); if (opt.onFail) opt.onFail(e); };
  const pad = { top: 28, right: 28, bottom: 46, left: 28 };
  const b = new LngLatBounds();
  for (const p of route) b.extend([p.lon, p.lat]);
  // Where a live map opens: where you are, else the route's end. It waits for one of those.
  const liveAt = () => (lastHere ? [lastHere.lon, lastHere.lat] : route.length ? [route[route.length - 1].lon, route[route.length - 1].lat] : null);
  let tj = null; // the TileJSON, once it's here
  const ctl = { provider: 'maplibre', update, restyle, destroy };
  Promise.resolve(opt.tilejson).then((t) => {
    if (dead) return;
    if (!style(false, t).sources.omt.tiles.length) { fail(new Error('no tiles')); return; }
    tj = t;
    if (!opt.live || liveAt()) build();
  }, (e) => fail(e));
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
        container: el, style: style(opt.dark, tj), attributionControl: false,
        fadeDuration: 0, maxZoom: 17.5, pixelRatio: Math.min(2, G.devicePixelRatio || 1), cancelPendingTileRequestsWhileZooming: true,
        ...(opt.live ? { center: liveAt(), zoom: 15.5 } : { bounds: b, fitBoundsOptions: { padding: pad }, maxBounds: grow(b, 1) }),
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false, boxZoom: false,
        locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl and scroll to zoom the map', 'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ and scroll to zoom the map', 'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move or zoom the map' },
      });
      // For anything that asks (the tests): the map itself, which one this is, its theme, and how
      // often it has followed you.
      el.ghMap = map;
      el.dataset.map = String(++made);
      el.dataset.dark = opt.dark ? '1' : '0';
      el.dataset.follows = '0';
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
        if (!opt.live) { map.fitBounds(b, { padding: pad, duration: still() ? 0 : 420 }); return; }
        follow = true;
        if (lastHere) go([lastHere.lon, lastHere.lat], 420);
      });
      el.appendChild(fit);
      map.on('dragstart', (e) => { if (e && e.originalEvent) { follow = false; fit.hidden = false; } });
      map.on('moveend', (e) => { if (e && e.originalEvent && !opt.live) fit.hidden = false; });
      // Its zoom, for anything that asks (the tests).
      map.on('zoomend', () => { el.dataset.zoom = map.getZoom().toFixed(2); });
      map.on('zoom', () => sizeHere());
      map.once('load', () => {
        el.dataset.zoom = map.getZoom().toFixed(2);
        if (!opt.live) { try { map.setMinZoom(Math.max(0, map.getZoom() - 1)); } catch (err) { /* ignore */ } }
      });
    } catch (e) { setTimeout(() => fail(e), 0); return; }
    // The style is inline, so it loads at once; what can fail is the tiles. A map with none of its
    // pieces (offline, and nothing kept for here) isn't shown: the page keeps the route it drew. One
    // that never settles goes the same way after 20 s. (A tile that fails once some have come just
    // leaves a gap.)
    timer = setTimeout(() => fail(new Error('timeout')), 20000);
    map.on('sourcedata', (e) => { if (e && e.sourceId === 'omt' && e.tile) tilesOk++; });
    map.on('error', (e) => { if (e && e.tile) tilesBad++; else if (!loaded) fail(e && e.error); });
    map.on('load', () => {
      loaded = true;
      const f = features(route, opt.live ? null : opt.buckets);
      const paint = routePaint(opt);
      map.addSource('route-case', { type: 'geojson', data: f.casing });
      map.addSource('route', { type: 'geojson', data: f.lines });
      map.addLayer({ id: 'route-case', type: 'line', source: 'route-case', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': paint.casing, 'line-width': opt.live ? 11 : 9 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': paint.line, 'line-width': 5 } });
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
      const settled = () => { if (!tilesOk && tilesBad) fail(new Error('no map pieces')); else ok(); };
      map.once('idle', settled);
    });
  }

  // The camera to a point: a glide, or a jump under reduced motion.
  function go(at, ms) {
    if (still()) map.jumpTo({ center: at });
    else map.easeTo({ center: at, duration: ms });
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

  // Live: the route so far, and where you are now (kept in sight while it follows; not while the
  // page is hidden, when nothing is drawn: the next fix after it shows again moves it).
  function update(u) {
    if (dead || !u) return;
    if (u.route) route = u.route;
    if (u.here) lastHere = u.here;
    if (!map) { if (opt.live && tj && liveAt()) build(); return; }
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
      if (follow && !G.document.hidden) { go([lastHere.lon, lastHere.lat], 600); el.dataset.follows = String(Number(el.dataset.follows || 0) + 1); }
    }
  }

  // The app's theme changed (or the page's colours did): the same map, recoloured in place.
  function restyle(s) {
    if (dead || !s) return;
    Object.assign(opt, s);
    if (!map || !loaded) { if (map) map.once('load', () => restyle({})); return; }
    for (const l of layers(opt.dark)) for (const [k, v] of Object.entries(l.paint || {})) map.setPaintProperty(l.id, k, v);
    const paint = routePaint(opt);
    map.setPaintProperty('route-case', 'line-color', paint.casing);
    map.setPaintProperty('route', 'line-color', paint.line);
    el.dataset.dark = opt.dark ? '1' : '0';
  }

  function destroy() {
    dead = true;
    done = true;
    clearTimeout(timer);
    for (const m of marks) { try { m.remove(); } catch (e) { /* gone */ } }
    try { if (map) map.remove(); } catch (e) { /* already gone */ }
    map = null;
    el.ghMap = null;
    if (fit) fit.remove();
  }
}

GH.actmap = { mount, style, layers, features };
