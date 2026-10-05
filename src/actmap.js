// Street maps behind an activity's route: MapLibre GL JS (BSD-3) drawing OpenFreeMap's vector tiles
// (tiles.openfreemap.org, OpenMapTiles schema, © OpenMapTiles © OpenStreetMap contributors). A lazy
// chunk, loaded with GH.lazy('actmap') only after someone taps Show streets on an activity: until
// then nothing is requested from OpenFreeMap. Sets GH.actmap = { mount(el, o) → { destroy() } };
// o.interactive lets two fingers move and zoom it.
//
// The style is the app's own and small: land, parks, water, buildings, roads and their names, in the
// app's light or dark colours, with no icons. The route draws on top in the page's pace colours.
// MapLibre's web worker is its own chunk (dist/lazy/actmap-worker.js), from the app's own origin.
import { Map as MLMap, LngLatBounds, setWorkerUrl, setWorkerCount } from 'maplibre-gl';

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

// The route as features: one line per stretch of the same pace colour, plus the whole route for the
// casing, and the start and the end.
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
  const first = route[0], last = route[route.length - 1];
  return {
    lines: { type: 'FeatureCollection', features: lines },
    casing: { type: 'FeatureCollection', features: casing.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) },
    ends: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { k: 'end' }, geometry: { type: 'Point', coordinates: [last.lon, last.lat] } }, { type: 'Feature', properties: { k: 'start' }, geometry: { type: 'Point', coordinates: [first.lon, first.lat] } }] },
  };
}

// The bounds b grown by `by` times their own size on every side (a map can't be dragged farther off).
function grow(b, by) {
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const dx = Math.max(0.005, (ne.lng - sw.lng) * by), dy = Math.max(0.005, (ne.lat - sw.lat) * by);
  return new LngLatBounds([sw.lng - dx, sw.lat - dy], [ne.lng + dx, ne.lat + dy]);
}

let workerSet = false;
function mount(el, o) {
  if (!workerSet) {
    // The worker comes from the app's own origin, next to this chunk.
    setWorkerUrl(new URL('lazy/actmap-worker.js', G.document.baseURI).href);
    try { setWorkerCount(1); } catch (e) { /* older API */ }
    workerSet = true;
  }
  let map = null, done = false, timer = 0;
  const ok = () => { if (done) return; done = true; clearTimeout(timer); if (o.onReady) o.onReady(); };
  const fail = (e) => { if (done) return; done = true; clearTimeout(timer); if (o.onFail) o.onFail(e); };
  try {
    const b = new LngLatBounds();
    for (const p of o.route) b.extend([p.lon, p.lat]);
    // The attribution line sits along the bottom (the page's own, as MapLibre's control is off): the
    // route keeps clear of it.
    // With o.interactive (an activity's summary), two fingers move and zoom the map, the way a map in a
    // scrolling page works: one finger keeps scrolling the page, and a hint says to use two. It doesn't
    // turn or tilt, and it stays around the route: no farther out than a little past where it starts,
    // and no farther off than the route's own span.
    const pad = { top: 28, right: 28, bottom: 46, left: 28 };
    const touch = !!o.interactive;
    map = new MLMap({
      container: el, style: style(o.dark), bounds: b, fitBoundsOptions: { padding: pad }, interactive: touch, attributionControl: false,
      fadeDuration: 0, maxZoom: 17.5, pixelRatio: Math.min(2, G.devicePixelRatio || 1), cancelPendingTileRequestsWhileZooming: true,
      ...(touch ? {
        cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false, boxZoom: false,
        maxBounds: grow(b, 1), locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl and scroll to zoom the map', 'CooperativeGesturesHandler.MacHelpText': 'Use \u2318 and scroll to zoom the map', 'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move or zoom the map' },
      } : {}),
    });
    if (touch) {
      map.touchZoomRotate.disableRotation();
      // Back to the whole route: a small glass button, there once the map has been moved.
      const fit = G.document.createElement('button');
      fit.type = 'button';
      fit.className = 'rf-btn rf-glass am-fit';
      fit.setAttribute('data-size', 'sm');
      fit.setAttribute('data-shape', 'circle');
      fit.setAttribute('aria-label', 'Show the whole route');
      fit.hidden = true;
      fit.innerHTML = GH.ui && GH.ui.icon ? GH.ui.icon('expand') : '';
      fit.addEventListener('click', () => { fit.hidden = true; map.fitBounds(b, { padding: pad, duration: 420 }); });
      el.appendChild(fit);
      map.on('moveend', (e) => { if (e && e.originalEvent) fit.hidden = false; });
      // Its zoom, for anything that asks (the tests).
      map.on('zoomend', () => { el.dataset.zoom = map.getZoom().toFixed(2); });
      map.once('load', () => { el.dataset.zoom = map.getZoom().toFixed(2); try { map.setMinZoom(Math.max(0, map.getZoom() - 1)); } catch (err) { /* ignore */ } });
    }
  } catch (e) { setTimeout(() => fail(e), 0); return { destroy() {} }; }
  // Offline, or the map never came: the drawn route stays. (A tile that fails once the map is up
  // just leaves a gap.)
  let loaded = false;
  timer = setTimeout(() => fail(new Error('timeout')), 20000);
  map.on('error', (e) => { if (!loaded) fail(e && e.error); });
  map.on('load', () => {
    loaded = true;
    const f = features(o.route, o.buckets);
    map.addSource('route-case', { type: 'geojson', data: f.casing });
    map.addSource('route', { type: 'geojson', data: f.lines });
    map.addSource('ends', { type: 'geojson', data: f.ends });
    map.addLayer({ id: 'route-case', type: 'line', source: 'route-case', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': o.casing || '#ffffff', 'line-width': 9 } });
    const col = ['match', ['get', 'b'], 0, o.colors[0], 1, o.colors[1], 3, o.colors[3], 4, o.colors[4], o.colors[2]];
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': col, 'line-width': 5 } });
    map.addLayer({ id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-radius': ['match', ['get', 'k'], 'start', 6.5, 7.5], 'circle-color': ['match', ['get', 'k'], 'start', o.start || '#1d7a41', o.end || '#0c0d12'], 'circle-stroke-width': 2.5, 'circle-stroke-color': o.ring || '#ffffff' } });
    map.once('idle', ok);
  });
  return {
    destroy() { done = true; clearTimeout(timer); try { map.remove(); } catch (e) { /* already gone */ } },
  };
}

GH.actmap = { mount, style, features };
