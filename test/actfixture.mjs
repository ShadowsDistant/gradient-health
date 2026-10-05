// Browser-side fixtures for outdoor activities, shared by test/ui-activity.mjs and the sweep. Both
// functions are serialized into the page (addInitScript / evaluate), so they must not use anything
// from here.

// The Android shell's activity recorder, faked: it plays back a 5 km loop (one fix a second at about
// 5:00 per km, with GPS noise and a hill, the GPS's speed and heading) on the page's clock, through
// actState, actPoints and window.__gh.onActivity, and answers the permission and Health Connect
// calls. Like the real one it only starts with precise location allowed, takes auto-pause and the
// spoken splits at the start and from actSetOptions, and after a finish reports the recording (with
// endedAt) until it's cleared. Its recording lives in sessionStorage, so a reload finds it still
// going. window.__act has the knobs (standing: the runner stops, and with auto-pause on the clock
// stops after autoStopMs and goes on when they move again; mapsKey: the build's Google Maps key),
// what was called, and stopOutside() (Finish on the notification while the page hears nothing). Add
// after seedBridge (it extends window.AndroidBridge).
export function actBridge() {
  const KEY = 'act-fake';
  const R5 = 5000 / (2 * Math.PI), LAT0 = 40.7812, LON0 = -73.9665, M = 111195, ML = M * Math.cos((LAT0 * Math.PI) / 180);
  const pos = (d) => { const a = d / R5; return [LAT0 + (R5 - R5 * Math.cos(a)) / M, LON0 + (R5 * Math.sin(a)) / ML]; };
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 - 0.5; };
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const F = window.__act = Object.assign({
    perms: { location: 'ask', activity: 'ask', notifications: 'ask', approximate: false },
    support: { gps: true, steps: true, hc: true, locationOn: true },
    grant: { location: 'granted', activity: 'granted', notifications: 'granted', approximate: false },
    searchMs: 4000, mps: 1000 / 300, calls: [], writes: [], sessions: [], watch: 'full', rec: null,
    standing: false, autoStopMs: 6000, mapsKey: '',
  }, load() || {});
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ perms: F.perms, support: F.support, rec: F.rec, watch: F.watch, calls: F.calls.slice(-80), writes: F.writes, sessions: F.sessions, searchMs: F.searchMs, standing: F.standing, mapsKey: F.mapsKey })); } catch (e) { /* ignore */ } };
  const hook = (name, v) => { if (window.__gh && window.__gh[name]) window.__gh[name](JSON.stringify(v)); };
  // Fixes up to now, one a second: standing still while paused (and flagged) or standing, running
  // otherwise. With auto-pause on, standing for autoStopMs stops the clock, and moving starts it.
  function advance(now) {
    const r = F.rec;
    if (!r || !r.active) return;
    while (r.lastT + 1000 <= now) {
      r.lastT += 1000;
      if (r.opts && r.opts.autoPause) {
        if (F.standing) {
          r.stillSince = r.stillSince || r.lastT;
          if (!r.paused && r.lastT - r.stillSince >= F.autoStopMs) { r.paused = true; r.auto = true; r.pauseAt = r.lastT; }
        } else {
          r.stillSince = 0;
          if (r.paused && r.auto) { r.pausedMs += r.lastT - r.pauseAt; r.paused = false; r.auto = false; r.pauseAt = null; }
        }
      }
      const still = r.paused || F.standing;
      if (!still) r.moved += F.mps * (r.moved > 2000 && r.moved < 3000 ? 1.12 : 1);
      const [lat, lon] = pos(r.moved);
      const acc = r.lastT - r.startedAt < F.searchMs ? 32 : 5;
      r.points.push([r.lastT, lat + (rnd() * 3) / M, lon + (rnd() * 3) / ML, 40 + 12 * Math.sin(r.moved / 800), acc, still ? 0 : F.mps, r.paused ? 1 : 0]);
    }
  }
  // Which way the loop goes at d metres (degrees from north).
  const heading = (d) => { const a = d / R5; return ((Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI + 360) % 360; };
  function state() {
    const r = F.rec;
    if (!r) return { active: false, id: null, points: 0, gps: 'off', endedAt: null };
    const now = r.active ? Date.now() : r.endedAt;
    advance(now);
    const pausedMs = r.pausedMs + (r.paused && r.pauseAt ? now - r.pauseAt : 0);
    const last = r.points[r.points.length - 1];
    const searching = r.lastT - r.startedAt < F.searchMs;
    return {
      active: r.active, id: r.id, type: r.type, title: r.title, units: r.units, startedAt: r.startedAt, endedAt: r.active ? null : r.endedAt, paused: r.paused, autoPaused: !!(r.active && r.paused && r.auto), pausedMs, elapsedMs: Math.max(0, now - r.startedAt - pausedMs), distanceM: r.moved, steps: Math.round(r.moved * 1.32), points: r.points.length,
      lastFix: last ? { lat: last[1], lon: last[2], acc: last[4], t: last[0], speed: last[5], bearing: last[5] > 0 ? heading(r.moved) : null } : null,
      // While it looks: roughly where the phone is (the network's), for the map.
      coarse: r.active && searching ? { lat: LAT0 + 0.0004, lon: LON0 - 0.0005, acc: 350, t: r.startedAt } : null,
      gps: !last ? 'searching' : last[4] <= 20 ? 'ok' : 'searching', opts: r.opts || { autoPause: false, voice: false },
    };
  }
  function stop() {
    const r = F.rec;
    if (!r || !r.active) return false;
    advance(Date.now());
    if (r.paused) { r.pausedMs += Date.now() - r.pauseAt; r.paused = false; r.pauseAt = null; }
    r.active = false; r.endedAt = Date.now();
    save();
    return true;
  }
  // Finish on the notification while the app is away: the page isn't told.
  F.stopOutside = () => { F.calls.push('notification:finish'); stop(); return F.rec && F.rec.endedAt; };
  let ticker = null;
  const tick = () => { if (!ticker) ticker = setInterval(() => { if (F.rec && F.rec.active) { hook('onActivity', state()); save(); } }, 1000); };
  if (F.rec && F.rec.active) tick();
  const call = (name, arg) => { F.calls.push(arg == null ? name : `${name}:${typeof arg === 'string' ? arg.slice(0, 200) : arg}`); save(); };
  // seedBridge's init script runs first, so the bridge is there to extend before the app starts.
  const attach = () => {
    const B = window.AndroidBridge;
    Object.assign(B, {
      actSupport: () => JSON.stringify(F.support),
      actPermissions: () => JSON.stringify(F.perms),
      actRequestPermissions: () => { call('actRequestPermissions'); setTimeout(() => { F.perms = Object.assign({}, F.grant); save(); hook('onActPermissions', F.perms); }, 60); },
      actOpenSettings: () => call('actOpenSettings'),
      actStart: (json) => {
        call('actStart', json);
        if ((F.rec && F.rec.active) || F.perms.location !== 'granted') return false;
        const o = JSON.parse(json);
        F.rec = { id: o.id, type: o.type, title: o.title, units: o.units || 'km', startedAt: Date.now(), lastT: Date.now(), paused: false, auto: false, pauseAt: null, pausedMs: 0, moved: 0, points: [], active: true, opts: { autoPause: !!o.autoPause, voice: !!o.voice } };
        save(); tick();
        return true;
      },
      actPause: () => { call('actPause'); const r = F.rec; if (r && r.active && !r.paused) { advance(Date.now()); r.paused = true; r.auto = false; r.pauseAt = Date.now(); save(); } },
      actResume: () => { call('actResume'); const r = F.rec; if (r && r.active && r.paused) { advance(Date.now()); r.pausedMs += Date.now() - r.pauseAt; r.paused = false; r.auto = false; r.pauseAt = null; save(); } },
      // Auto-pause and the spoken splits, changed while it records (turning auto-pause off while it
      // had stopped the clock starts it again).
      actSetOptions: (json) => {
        call('actSetOptions', json);
        const r = F.rec;
        if (!r || !r.active) return;
        const o = JSON.parse(json);
        advance(Date.now());
        r.opts = { autoPause: o.autoPause != null ? !!o.autoPause : r.opts.autoPause, voice: o.voice != null ? !!o.voice : r.opts.voice };
        if (!r.opts.autoPause && r.paused && r.auto) { r.pausedMs += Date.now() - r.pauseAt; r.paused = false; r.auto = false; r.pauseAt = null; }
        save();
      },
      mapsKey: () => F.mapsKey || '',
      actStop: () => {
        call('actStop');
        if (!stop()) return;
        setTimeout(() => hook('onActivity', state()), 50);
      },
      actState: () => JSON.stringify(state()),
      actPoints: (from) => { advance(F.rec && F.rec.active ? Date.now() : 0); return JSON.stringify(F.rec ? F.rec.points.slice(from | 0) : []); },
      actClear: (id) => { call('actClear', id); if (F.rec && !F.rec.active && F.rec.id === id) { F.rec = null; save(); } },
      // The watch's data for a time: heart rate climbing through the run, steps and calories.
      hcSession: (json) => {
        const o = JSON.parse(json);
        F.sessions.push(o); save();
        setTimeout(() => {
          if (F.watch === 'none') { hook('onHcSession', { id: o.id, ok: true, steps: 0, distanceM: 0, activeKcal: 0, totalKcal: 0, hr: [], sources: [] }); return; }
          const hr = [];
          for (let t = o.start; t <= o.end; t += 5000) { const f = (t - o.start) / Math.max(1, o.end - o.start); hr.push([t, Math.round(118 + 52 * f + 6 * Math.sin(t / 40000))]); }
          hook('onHcSession', { id: o.id, ok: true, steps: 6420, distanceM: 5040, activeKcal: 377, totalKcal: 431, hr, sources: ['com.samsung.android.wear.shealth'] });
        }, 120);
      },
      hcWriteActivity: (json) => { const o = JSON.parse(json); F.writes.push(o); save(); setTimeout(() => hook('onHcActivityWrite', { id: o.id, ok: true, route: true }), 120); },
    });
  };
  if (window.AndroidBridge) attach();
  else { const wait = setInterval(() => { if (window.AndroidBridge) { clearInterval(wait); attach(); } }, 1); }
}

// A few weeks of finished activities for someone (runs getting faster, walks, a ride, a hike), built
// with the app's own code so every number is real. Saves the state.
export function seedActivities() {
  const GH = window.GH, A = GH.activity, U = GH.ui, S = U.S;
  const R = (km) => (km * 1000) / (2 * Math.PI);
  const LAT0 = 40.7812, LON0 = -73.9665, M = 111195, ML = M * Math.cos((LAT0 * Math.PI) / 180);
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 - 0.5; };
  const DAY = 86400000;
  const today = U.today();
  const mk = (id, type, daysAgo, hour, km, secPerKm, o = {}) => {
    const dt = new Date((today - daysAgo) * DAY);
    const start = new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), hour, 10).getTime();
    const r = R(km), pts = [];
    const v = 1000 / secPerKm;
    let d = 0, t = start;
    while (d <= km * 1000) {
      const a = d / r;
      pts.push([t, LAT0 + (r - r * Math.cos(a)) / M + (rnd() * 3) / M, LON0 + (r * Math.sin(a)) / ML + (rnd() * 3) / ML, o.flat ? null : 40 + 18 * Math.sin(d / 900), 5, v, 0]);
      d += v * (o.fast && d > 1000 && d < 2200 ? 1.15 : o.slow && d > 3000 ? 0.85 : 1);
      t += 1000;
    }
    let act = A.build(S, { id, type, title: o.title, start, end: t, points: pts, movingMs: t - start, steps: o.steps || null });
    if (o.watch) {
      const hr = [];
      for (let x = start; x <= t; x += 5000) hr.push([x, Math.round(112 + 55 * ((x - start) / (t - start)) + 5 * Math.sin(x / 30000))]);
      act = A.withWatch(S, act, { id, ok: true, steps: Math.round(km * 1300), activeKcal: Math.round(km * 72), hr, sources: ['com.samsung.android.wear.shealth'] });
    }
    if (o.saved) act.saved = { at: Date.now(), ok: true, route: true };
    A.add(S, act);
  };
  mk('seed-r1', 'run', 20, 7, 5, 318, { title: 'Morning run' });
  mk('seed-w1', 'walk', 16, 18, 3.2, 690, { title: 'Walk with Biscuit', steps: 4300 });
  mk('seed-r2', 'run', 12, 7, 5.2, 306, { title: 'Park loop' });
  mk('seed-c1', 'cycle', 9, 10, 18.5, 150, { title: 'Sunday ride', flat: true });
  mk('seed-h1', 'hike', 6, 9, 7.4, 820, { title: 'Ridge trail' });
  mk('seed-r3', 'run', 1, 7, 6.1, 297, { title: 'Tempo run with a long name for the sweep', fast: true, slow: true, watch: true, saved: true });
  GH.store.save(S);
}

// Google's Maps JavaScript API, faked (only what src/gmap.js uses), so a test never loads Google's:
// window.google.maps with importLibrary('maps' | 'core'). What the page does with it is in
// window.__gm: the maps (with the options they were made with, and their fitBounds and panTo
// calls), the lines and the overlays. A map is "drawn" (tilesloaded, idle) a moment after it's made,
// and map.trigger(name) fires its listeners the way a finger would (dragstart).
export function googleMapsStub() {
  const GM = window.__gm = { maps: [], lines: [], overlays: [], imports: [] };
  class LatLng {
    constructor(a, b) { if (a && typeof a === 'object') { this.y = a.lat; this.x = a.lng; } else { this.y = a; this.x = b; } }
    lat() { return this.y; }
    lng() { return this.x; }
  }
  const ll = (p) => (p instanceof LatLng ? p : new LatLng(p));
  class LatLngBounds {
    constructor(sw, ne) { this.s = Infinity; this.w = Infinity; this.n = -Infinity; this.e = -Infinity; if (sw) this.extend(sw); if (ne) this.extend(ne); }
    extend(p) { const q = ll(p); this.s = Math.min(this.s, q.lat()); this.n = Math.max(this.n, q.lat()); this.w = Math.min(this.w, q.lng()); this.e = Math.max(this.e, q.lng()); return this; }
    isEmpty() { return !(this.s <= this.n); }
    getCenter() { return new LatLng((this.s + this.n) / 2, (this.w + this.e) / 2); }
    getSouthWest() { return new LatLng(this.s, this.w); }
    getNorthEast() { return new LatLng(this.n, this.e); }
  }
  const listen = (obj, name, fn, once) => { const l = { name, fn, once, remove() { obj.ls = obj.ls.filter((x) => x !== l); } }; (obj.ls = obj.ls || []).push(l); return l; };
  const fire = (obj, name) => { for (const l of (obj.ls || []).slice()) if (l.name === name) { if (l.once) l.remove(); l.fn(); } };
  class GMap {
    constructor(el, opts) {
      this.el = el; this.opts = Object.assign({}, opts); this.center = ll(opts.center); this.zoom = opts.zoom; this.calls = []; this.ls = [];
      // Like Google's: the box becomes position: relative, and the map is drawn inside it.
      el.style.position = 'relative'; el.style.overflow = 'hidden';
      this.div = document.createElement('div'); this.div.className = 'gm-style'; this.div.style.cssText = 'position:absolute;inset:0';
      // Its marker pane's origin is the middle of the map, where this projection puts the centre.
      this.panes = { markerLayer: document.createElement('div') };
      this.panes.markerLayer.style.cssText = 'position:absolute;left:50%;top:50%';
      this.div.appendChild(this.panes.markerLayer);
      el.appendChild(this.div);
      GM.maps.push(this);
      setTimeout(() => { this.idle(); fire(this, 'tilesloaded'); }, 30);
    }
    addListener(name, fn) { return listen(this, name, fn); }
    idle() { for (const o of GM.overlays) if (o.map === this) o.draw(); fire(this, 'idle'); }
    getZoom() { return this.zoom; }
    setOptions(o) { Object.assign(this.opts, o); this.calls.push(['setOptions', o]); }
    fitBounds(b, pad) { this.calls.push(['fitBounds', pad]); this.center = b.getCenter(); this.zoom = 15; fire(this, 'zoom_changed'); setTimeout(() => this.idle(), 20); }
    panTo(p) { const q = ll(p); this.calls.push(['panTo', { lat: q.lat(), lng: q.lng() }]); this.center = q; setTimeout(() => this.idle(), 20); }
    trigger(name) { fire(this, name); }
  }
  class Polyline {
    constructor(o) { this.o = o; this.path = o.path; this.map = o.map; GM.lines.push(this); }
    setPath(p) { this.path = p; }
    setMap(m) { this.map = m; }
  }
  class OverlayView {
    setMap(m) {
      if (!m) { if (this.map) { this.map = null; this.onRemove(); } return; }
      this.map = m; GM.overlays.push(this); this.onAdd(); this.draw();
    }
    getPanes() { return this.map && this.map.panes; }
    getProjection() {
      const m = this.map;
      if (!m) return null;
      const s = (256 * 2 ** m.zoom) / 360;
      return { fromLatLngToDivPixel: (p) => ({ x: (p.lng() - m.center.lng()) * s, y: (m.center.lat() - p.lat()) * s * 1.32 }) };
    }
  }
  const event = { addListenerOnce: (obj, name, fn) => listen(obj, name, fn, true), clearInstanceListeners: (obj) => { obj.ls = []; } };
  window.google = { maps: {
    ColorScheme: { LIGHT: 'LIGHT', DARK: 'DARK', FOLLOW_SYSTEM: 'FOLLOW_SYSTEM' },
    importLibrary: (name) => { GM.imports.push(name); return Promise.resolve(name === 'maps' ? { Map: GMap, Polyline, OverlayView } : { LatLng, LatLngBounds, event }); },
  } };
}
