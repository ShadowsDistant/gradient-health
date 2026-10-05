/* Outdoor activities: walks, runs, hikes and rides you start yourself, recorded with GPS.
 *
 * Three parts:
 * - The maths: distance, moving time, pace, splits, elevation, calories, heart-rate zones, personal
 *   records, auto-pause, the pace now, the route as it's drawn, route simplification and a compact
 *   route encoding. Pure functions, tested in test/activity.mjs.
 * - The history: S.activities, newest first. Each finished activity also counts as exercise for its
 *   day (health.js asks exerciseOn), so a long run makes tomorrow's legs lighter the same way a run
 *   from Health Connect does.
 * - The recorder: the Android shell's (AndroidBridge.act*, a foreground service that keeps going with
 *   the screen off) or, in a browser, one built on navigator.geolocation that answers in the same
 *   shape. Either way the page hears about it through window.__gh.onActivity.
 *
 * Points, from either recorder: [t, lat, lon, alt|null, acc, speed|null, paused 0|1]. GPS points stay
 * on the phone: they go to Health Connect only when the person saves an activity there.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const B = () => GH.brain;

  /* ---------------------------------------------------------------- types and units */
  // maxMps: faster than this between two fixes is a GPS jump, not movement.
  const TYPES = {
    walk: { id: 'walk', label: 'Walk', noun: 'walk', hcName: 'walking', hue: 'green', icon: 'act-walk', speed: false, maxMps: 7 },
    run: { id: 'run', label: 'Run', noun: 'run', hcName: 'running', hue: 'coral', icon: 'act-run', speed: false, maxMps: 12 },
    hike: { id: 'hike', label: 'Hike', noun: 'hike', hcName: 'hiking', hue: 'amber', icon: 'mountain', speed: false, maxMps: 7 },
    cycle: { id: 'cycle', label: 'Ride', noun: 'ride', hcName: 'cycling', hue: 'sky', icon: 'act-cycle', speed: true, maxMps: 35 },
    other: { id: 'other', label: 'Other', noun: 'activity', hcName: 'outdoor activity', hue: 'violet', icon: 'compass', speed: true, maxMps: 35 },
  };
  const ORDER = ['walk', 'run', 'hike', 'cycle', 'other'];
  const typeOf = (id) => TYPES[id] || TYPES.other;
  const UNITS = { km: { id: 'km', m: 1000, short: 'km', long: 'km', speed: 'km/h' }, mi: { id: 'mi', m: 1609.344, short: 'mi', long: 'mile', speed: 'mph' } };
  // Metric with kg, imperial with lb (the profile's one units switch).
  const unitsOf = (S) => (S && S.profile && S.profile.units === 'kg' ? 'km' : 'mi');
  const MILE = 1609.344;

  /* ---------------------------------------------------------------- geometry */
  const R_EARTH = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const num = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);
  // A point in the recorder's shape, or null if it isn't one.
  function norm(p) {
    if (!Array.isArray(p) || p.length < 3) return null;
    const t = num(p[0]), lat = num(p[1]), lon = num(p[2]);
    if (t == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
    const acc = num(p[4]), spd = num(p[5]);
    return [t, lat, lon, num(p[3]), acc == null ? null : Math.max(0, acc), spd == null || spd < 0 ? null : spd, p[6] ? 1 : 0];
  }
  function median(a) {
    const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------------------------------------------------------------- pauses */
  function mergeIv(list) {
    const s = list.filter((x) => x && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0]).map((x) => [x[0], x[1]]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const iv of s) {
      const last = out[out.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else out.push(iv);
    }
    return out;
  }
  // How much of [a, b] the intervals cover.
  function covered(ivs, a, b) {
    let ms = 0;
    for (const [x, y] of ivs) { const lo = Math.max(a, x), hi = Math.min(b, y); if (hi > lo) ms += hi - lo; }
    return ms;
  }
  const inside = (ivs, t) => ivs.some(([x, y]) => t >= x && t < y);
  const crosses = (ivs, a, b) => ivs.some(([x, y]) => x < b && y > a);

  /* ---------------------------------------------------------------- cleaning */
  // The accuracy gate: 50 m, looser when the whole recording was poor (a narrow valley, a city of
  // tall buildings), so it still has a route.
  function gateFor(pts) {
    const med = median(pts.map((p) => p[4]));
    return med != null && med > 25 ? Math.min(100, med * 2) : 50;
  }
  // Drops what can't be right, one fix at a time: worse than the accuracy gate, or a jump from the
  // last good fix faster than the activity allows (a GPS spike). A fix much better than the last one,
  // inside its error circle, replaces it. Returns true to keep the fix.
  function spikeGate(type, gate) {
    const tp = typeOf(type);
    let last = null;
    return {
      reset() { last = null; },
      keep(p) {
        const acc = p[4] == null ? 5 : p[4];
        if (acc > gate) return false;
        if (last) {
          const lAcc = last[4] == null ? 5 : last[4];
          const d = haversine(last[1], last[2], p[1], p[2]);
          const dt = Math.max(1, p[0] - last[0]);
          if (!(lAcc > 2 * acc + 5 && d <= lAcc + acc) && (d / dt) * 1000 > tp.maxMps && dt < 30000) return false;
        }
        last = p;
        return true;
      },
    };
  }
  // GPS fixes wobble by metres from second to second, and summing those wobbles adds distance that was
  // never covered. Each run is smoothed with a constant-velocity Kalman filter per axis (metres east
  // and north), which trusts each fix by its accuracy, then smoothed backwards (Rauch-Tung-Striebel).
  // Q: how sharply the path can turn or change speed (m²/s³), by activity. Stretches slower than
  // STILL m/s (standing at a crossing) add no distance.
  const Q = { walk: 0.5, hike: 0.5, run: 1.5, cycle: 4, other: 2 };
  const STILL = 0.4;
  const sigOf = (acc) => Math.max(2, (acc == null ? 5 : acc) * 0.6);
  function kalman1(zs, ts, sig, q, smooth) {
    const n = zs.length;
    const xp = new Float64Array(n * 2), Pp = new Float64Array(n * 3), xf = new Float64Array(n * 2), Pf = new Float64Array(n * 3);
    let p = zs[0], v = 0, a = sig[0] * sig[0], b = 0, c = 9;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        const dt = Math.max(0.05, (ts[k] - ts[k - 1]) / 1000);
        p += dt * v;
        const a2 = a + 2 * dt * b + dt * dt * c + (q * dt * dt * dt) / 3, b2 = b + dt * c + (q * dt * dt) / 2, c2 = c + q * dt;
        a = a2; b = b2; c = c2;
      }
      xp[2 * k] = p; xp[2 * k + 1] = v; Pp[3 * k] = a; Pp[3 * k + 1] = b; Pp[3 * k + 2] = c;
      const S = a + sig[k] * sig[k], k0 = a / S, k1 = b / S, y = zs[k] - p;
      p += k0 * y; v += k1 * y;
      const na = (1 - k0) * a, nb = (1 - k0) * b, nc = c - k1 * b;
      a = na; b = nb; c = nc;
      xf[2 * k] = p; xf[2 * k + 1] = v; Pf[3 * k] = a; Pf[3 * k + 1] = b; Pf[3 * k + 2] = c;
    }
    if (smooth) {
      for (let k = n - 2; k >= 0; k--) {
        const dt = Math.max(0.05, (ts[k + 1] - ts[k]) / 1000);
        const fa = Pf[3 * k], fb = Pf[3 * k + 1], fc = Pf[3 * k + 2];
        const pa = Pp[3 * (k + 1)], pb = Pp[3 * (k + 1) + 1], pc = Pp[3 * (k + 1) + 2];
        const det = pa * pc - pb * pb;
        if (!(det > 1e-12)) continue;
        // C = Pf·Fᵀ·Pp⁻¹
        const m00 = fa + dt * fb, m01 = fb, m10 = fb + dt * fc, m11 = fc;
        const i00 = pc / det, i01 = -pb / det, i11 = pa / det;
        const c00 = m00 * i00 + m01 * i01, c01 = m00 * i01 + m01 * i11, c10 = m10 * i00 + m11 * i01, c11 = m10 * i01 + m11 * i11;
        const d0 = xf[2 * (k + 1)] - xp[2 * (k + 1)], d1 = xf[2 * (k + 1) + 1] - xp[2 * (k + 1) + 1];
        xf[2 * k] += c00 * d0 + c01 * d1;
        xf[2 * k + 1] += c10 * d0 + c11 * d1;
      }
    }
    return xf;
  }
  // Whether the stretch into each fix was movement. Standing still, the smoothed track only wanders
  // by a metre or two; moving, it spreads out, even when it turns straight back (an out-and-back's
  // turning point). So: the spread of the smoothed fixes over the 20 seconds around each one, against
  // what STILL m/s would cover in that time.
  const STILL_WINDOW = 20000;
  function stillness(run, sm) {
    const n = run.length;
    const out = new Array(n).fill(false);
    if (n < 2) return out;
    const ky = R_EARTH * rad(1), kx = ky * Math.cos(rad(sm[0].lat));
    const xs = sm.map((p) => p.lon * kx), ys = sm.map((p) => p.lat * ky);
    let a = 0, b = 0;
    for (let k = 1; k < n; k++) {
      const t = run[k][0];
      while (a < k - 1 && run[a][0] < t - STILL_WINDOW / 2) a++;
      if (b < k) b = k;
      while (b + 1 < n && run[b + 1][0] <= t + STILL_WINDOW / 2) b++;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = a; i <= b; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
      const dt = (run[b][0] - run[a][0]) / 1000;
      out[k] = Math.hypot(x1 - x0, y1 - y0) >= Math.max(2, STILL * dt);
    }
    return out;
  }
  // The route as it's drawn: each point moved toward its neighbours within a few metres along the way
  // (by the track's own distance, so a ride's corners are kept as well as a walk's), weighted by how
  // near they are and by their accuracy, within its own stretch. The window is the same on both
  // sides, narrowing to nothing at a stretch's ends, so those stay put without a kink. It takes out
  // the zigzag poor fixes leave, and the scribble of standing at a crossing (all there at one
  // distance) draws as one point. Only for drawing: distance, splits and pace come from track()'s
  // own filter. pts: track()'s points ({ t, lat, lon, acc, d, run }); returns copies.
  const DRAW_M = 5;
  function smoothRoute(pts) {
    const out = pts.map((p) => Object.assign({}, p));
    const n = pts.length;
    if (n < 3) return out;
    const ky = R_EARTH * rad(1), kx = ky * Math.cos(rad(pts[0].lat));
    let s = 0;
    for (let e = 1; e <= n; e++) {
      if (e < n && pts[e].run === pts[s].run) continue;
      // One stretch: s..e-1.
      const d0 = pts[s].d, d1 = pts[e - 1].d;
      let a = s;
      for (let i = s; i < e; i++) {
        const p = pts[i];
        const half = Math.min(2 * DRAW_M, p.d - d0, d1 - p.d);
        if (!(half > 0.5)) continue;
        while (pts[a].d < p.d - half) a++;
        let wSum = 0, x = 0, y = 0;
        for (let j = a; j < e && pts[j].d <= p.d + half; j++) {
          const q = pts[j], dd = (q.d - p.d) / DRAW_M;
          const acc = Math.max(3, q.acc == null ? 5 : q.acc);
          const w = Math.exp(-dd * dd) / (acc * acc);
          wSum += w; x += w * (q.lon - p.lon) * kx; y += w * (q.lat - p.lat) * ky;
        }
        if (wSum > 0) { out[i].lat = p.lat + y / wSum / ky; out[i].lon = p.lon + x / wSum / kx; }
      }
      s = e;
    }
    return out;
  }
  // Smooths one run of fixes: [{ lat, lon, spd (m/s, from the filter) }].
  function smoothRun(run, type) {
    const n = run.length;
    if (n < 3) return run.map((p) => ({ lat: p[1], lon: p[2], spd: 0 }));
    const lat0 = run[0][1], lon0 = run[0][2];
    const ky = R_EARTH * rad(1), kx = ky * Math.cos(rad(lat0));
    const ts = run.map((p) => p[0]), sig = run.map((p) => sigOf(p[4]));
    const q = Q[type] || Q.other;
    const fy = kalman1(run.map((p) => (p[1] - lat0) * ky), ts, sig, q, true);
    const fx = kalman1(run.map((p) => (p[2] - lon0) * kx), ts, sig, q, true);
    const out = [];
    for (let k = 0; k < n; k++) out.push({ lat: lat0 + fy[2 * k] / ky, lon: lon0 + fx[2 * k] / kx, spd: Math.hypot(fy[2 * k + 1], fx[2 * k + 1]) });
    return out;
  }
  // The moving track: the fixes recorded while moving, cleaned, each with its distance from the start
  // (d) and its moving time (mt, pauses taken out), in runs that break at every pause.
  // o: { type, start, end, pauses: [[a, b]] the page saw, pausedMs: what the recorder says was
  // paused after the start, movingMs: the recorder's clock }.
  function track(points, o) {
    const opt = o || {};
    const pts = (points || []).map(norm).filter(Boolean).sort((a, b) => a[0] - b[0]);
    const start = opt.start != null ? opt.start : pts.length ? pts[0][0] : 0;
    const end = opt.end != null ? opt.end : pts.length ? pts[pts.length - 1][0] : start;
    // Pauses: runs of paused fixes. A recorder that flags them is believed over the page, which only
    // hears of a pause made from the notification when it's back in front (so its times can be late);
    // the page's pauses count only when no fix is flagged. A run that began before the start is the
    // wait for GPS and the 3-2-1, which ended at the start.
    const ivs = [];
    let open = null, flagged = false;
    for (const p of pts) {
      if (p[6]) flagged = true;
      if (p[6] && open == null) open = p[0];
      else if (!p[6] && open != null) { if (open >= start) ivs.push([open, p[0]]); open = null; }
    }
    if (open != null) ivs.push([Math.max(open, start), Math.max(open, end)]);
    let pauses = mergeIv(ivs.concat(flagged ? [] : opt.pauses || []).map(([a, b]) => [Math.max(a, start), Math.min(b == null ? end : b, end)]));
    const moving = pts.filter((p) => !p[6] && p[0] >= start - 2000 && p[0] <= end + 2000 && !inside(pauses, p[0]));
    // A recorder that doesn't log fixes while paused leaves a hole instead: when it says more time was
    // paused than the fixes show, the longest holes between fixes are those pauses.
    let known = covered(pauses, start, end);
    if (opt.pausedMs != null && opt.pausedMs - known > 5000) {
      const holes = [];
      for (let i = 1; i < moving.length; i++) {
        const a = moving[i - 1][0], b = moving[i][0];
        if (b - a > 10000 && !crosses(pauses, a, b)) holes.push([a, b]);
      }
      holes.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
      let left = opt.pausedMs - known;
      const extra = [];
      for (const [a, b] of holes) {
        if (left <= 3000) break;
        const len = Math.min(b - a, left);
        extra.push([b - len, b]);
        left -= len;
      }
      pauses = mergeIv(pauses.concat(extra));
      known = covered(pauses, start, end);
    }
    const mtAt = (t) => Math.max(0, Math.min(t, end) - start - covered(pauses, start, Math.min(t, end)));
    const gate = gateFor(moving);
    // Runs break at pauses; each drops what can't be right and is smoothed on its own.
    const runs = [];
    let cur = [], prev = null;
    const sg = spikeGate(opt.type, gate);
    for (const p of moving) {
      if (prev && crosses(pauses, prev[0], p[0])) { if (cur.length) runs.push(cur); cur = []; sg.reset(); }
      prev = p;
      if (sg.keep(p)) cur.push(p);
    }
    if (cur.length) runs.push(cur);
    const out = [];
    let dist = 0;
    runs.forEach((run, r) => {
      const sm = smoothRun(run, opt.type);
      const moved = stillness(run, sm);
      for (let k = 0; k < run.length; k++) {
        const p = run[k], s = sm[k];
        if (k > 0 && moved[k]) dist += haversine(sm[k - 1].lat, sm[k - 1].lon, s.lat, s.lon);
        out.push({ t: p[0], lat: s.lat, lon: s.lon, alt: p[3], acc: p[4], spd: s.spd, d: dist, mt: mtAt(p[0]), run: r });
      }
    });
    const movingMs = opt.movingMs != null && opt.movingMs >= 0 ? opt.movingMs : Math.max(0, end - start - known);
    return { pts: out, pauses, distanceM: dist, movingMs, start, end, gate };
  }

  /* ---------------------------------------------------------------- auto-pause */
  // The clock stops when you stop and goes on when you go (the Android shell's recorder runs the same
  // rules: ActivityAutoPause.java). A fix is still when the GPS's own speed (Doppler, steady to a few
  // tenths of a m/s) is under the activity's still speed, moving when it's over its move speed, and
  // neither in between. STOP_MS of still fixes pause the clock from the first of them; moving fixes
  // over MOVE_MS start it again from the first of those. A fix in between calls a stop off (a runner
  // walking up a hill keeps going), and one worse than 50 m decides nothing. Without speeds (a
  // network position, some browsers) it's slower and more careful: still is the last 20 s of fixes
  // moving slower than the still speed, by a straight-line fit through them (single fixes wander by
  // their error, the fit much less), and moving is being well outside the stop's circle. Fixes in
  // doubt are held back until it's decided, then handed on flagged paused or not, so the track's
  // pauses are exactly the clock's. It's armed by the first moving fix (after the start, or a resume
  // by hand, standing still doesn't pause straight away).
  // [still, move] in m/s.
  const AUTO = { walk: [0.35, 0.8], hike: [0.3, 0.7], run: [0.9, 1.6], cycle: [1.2, 2.4], other: [0.5, 1.0] };
  const AUTO_STOP_MS = 5000, AUTO_STOP_BLIND_MS = 20000, AUTO_MOVE_MS = 2000, AUTO_BAD_ACC = 50;
  // Defaults: on for runs and rides, off for walks, hikes and the rest.
  const AUTO_DEFAULT = { walk: false, run: true, hike: false, cycle: true, other: false };
  const autoOn = (S, type) => {
    const pr = S && S.profile && S.profile.prefs && S.profile.prefs.actAuto;
    const t = TYPES[type] ? type : 'other';
    return pr && typeof pr[t] === 'boolean' ? pr[t] : AUTO_DEFAULT[t];
  };
  // feed(p) → { out: [[point, paused 0|1]], pause: t?, resume: t? }: the fixes to keep now, and when
  // the clock stopped or went on (in the past: where the stop or the move began). The recorder feeds
  // it only while auto-pause is on and it isn't paused by hand. paused: it starts out auto-paused (a
  // recording picked up again after a reload), with the stop where the next fix is.
  function autoPauser(type, paused) {
    const [vStill, vMove] = AUTO[type] || AUTO.other;
    let mode = paused ? 'paused' : 'moving'; // moving | stopping | paused | starting
    let held = [], anchor = null, since = 0, armed = !!paused, ref = null;
    const accOf = (p) => (p[4] == null ? 5 : p[4]);
    const dist = (a, b) => haversine(a[1], a[2], b[1], b[2]);
    const near = (p) => dist(anchor, p) <= Math.max(10, 2 * accOf(p));
    const outside = (p) => !!anchor && dist(anchor, p) > Math.max(15, 2 * accOf(p));
    // How fast the fixes move, m/s: the slope of a least-squares line through them, east and north.
    // Their middle, for where a stop is: [t, lat, lon].
    function drift(list) {
      const ok = list.filter((x) => accOf(x) <= AUTO_BAD_ACC);
      if (ok.length < 6) return Infinity;
      const ky = R_EARTH * rad(1), kx = ky * Math.cos(rad(ok[0][1]));
      let st = 0, sx = 0, sy = 0;
      for (const x of ok) { st += x[0] / 1000; sx += (x[2] - ok[0][2]) * kx; sy += (x[1] - ok[0][1]) * ky; }
      const n = ok.length, tm = st / n, xm = sx / n, ym = sy / n;
      let tt = 0, tx = 0, ty = 0;
      for (const x of ok) { const dt = x[0] / 1000 - tm; tt += dt * dt; tx += dt * ((x[2] - ok[0][2]) * kx - xm); ty += dt * ((x[1] - ok[0][1]) * ky - ym); }
      return tt > 0 ? Math.hypot(tx / tt, ty / tt) : Infinity;
    }
    const middle = (list) => { const n = list.length; let t = 0, la = 0, lo = 0; for (const x of list) { t += x[0] / n; la += x[1] / n; lo += x[2] / n; } return [t, la, lo, null, accOf(list[0]), null, 1]; };
    const flush = (paused) => { const out = held.map((p) => [p, paused]); held = []; return out; };
    const pausedNow = () => (mode === 'paused' || mode === 'starting' ? 1 : 0);
    return {
      get mode() { return mode; },
      get paused() { return pausedNow() === 1; },
      // A pause or resume by hand: what's held goes as it stood, and it waits to be armed again.
      manual() { const out = flush(pausedNow()); mode = 'moving'; armed = false; anchor = null; ref = null; return out; },
      // Everything held, as it stands (the recording ends, or auto-pause is turned off).
      drain() { return flush(pausedNow()); },
      feed(p) {
        const v = p[5], bad = accOf(p) > AUTO_BAD_ACC;
        if (!armed && !bad) {
          if (v != null) armed = v >= vMove;
          else if (!ref) ref = p;
          else armed = dist(ref, p) > Math.max(15, 2 * accOf(p));
        }
        if (mode === 'moving') {
          // Without a speed, any fix could be where a stop begins: the next ones say whether it was.
          if (bad || !armed || (v != null && v >= vStill)) return { out: [[p, 0]] };
          mode = 'stopping'; since = p[0]; anchor = p; held = [p];
          return { out: [] };
        }
        if (mode === 'stopping') {
          held.push(p);
          if (bad) return { out: [] };
          if (v != null ? v < vStill : near(p)) {
            const blind = held.some((x) => x[5] == null);
            if (p[0] - since < (blind ? AUTO_STOP_BLIND_MS : AUTO_STOP_MS)) return { out: [] };
            if (!blind || drift(held) < vStill) {
              // Without speeds the stop is where the fixes' middle was (any one of them could be off).
              if (blind) anchor = middle(held.filter((x) => accOf(x) <= AUTO_BAD_ACC));
              mode = 'paused';
              return { out: flush(1), pause: since };
            }
            // Drifting along slowly: the oldest fix goes on as moving, and the window moves with it.
            const first = held.shift();
            since = held[0][0]; anchor = held[0];
            return { out: [[first, 0]] };
          }
          // Called off: kept as moving. A fix without a speed may start the next stop.
          held.pop();
          const out = flush(0);
          if (v == null) { since = p[0]; anchor = p; held = [p]; return { out }; }
          mode = 'moving'; anchor = null;
          out.push([p, 0]);
          return { out };
        }
        if (mode === 'paused') {
          if (!anchor && !bad) anchor = p;
          if (bad || !(v != null ? v >= vMove || outside(p) : outside(p))) return { out: [[p, 1]] };
          mode = 'starting'; since = p[0]; held = [p];
          return { out: [] };
        }
        // starting
        held.push(p);
        if (bad) return { out: [] };
        if (!(v != null ? v >= vMove || outside(p) : outside(p))) { mode = 'paused'; return { out: flush(1) }; }
        if (p[0] - since < AUTO_MOVE_MS) return { out: [] };
        mode = 'moving'; anchor = null;
        return { out: flush(0), resume: since };
      },
    };
  }

  /* ---------------------------------------------------------------- the pace now */
  // How fast you're going now, in m/s: the fixes of the last LIVE_MS of this stretch (none from before
  // a pause), from the GPS's own speeds where they have one (their median trimmed of the outer
  // fifths, which a stray reading doesn't move), else from the distance covered. 0 when stopped, null
  // until there's enough to say. points: the recorder's, oldest first.
  const LIVE_MS = 20000;
  function liveSpeed(points, type) {
    const pts = points || [];
    const [vStill] = AUTO[type] || AUTO.other;
    const last = pts.length ? norm(pts[pts.length - 1]) : null;
    if (!last || last[6]) return last ? 0 : null;
    const win = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = norm(pts[i]);
      if (!p || p[6] || p[0] < last[0] - LIVE_MS) break;
      if (p[4] == null || p[4] <= AUTO_BAD_ACC) win.unshift(p);
    }
    if (win.length < 3 || win[win.length - 1][0] - win[0][0] < 6000) return null;
    const sp = win.map((p) => p[5]).filter((v) => v != null).sort((x, y) => x - y);
    let v;
    if (sp.length >= win.length * 0.6) {
      const cut = Math.floor(sp.length / 5);
      const mid = sp.slice(cut, sp.length - cut);
      v = mid.reduce((a, x) => a + x, 0) / mid.length;
    } else {
      let m = 0;
      for (let i = 1; i < win.length; i++) m += haversine(win[i - 1][1], win[i - 1][2], win[i][1], win[i][2]);
      // Straight-line wobble adds a little: about the fixes' own error, taken off.
      const err = median(win.map((p) => p[4])) || 5;
      v = Math.max(0, m - err) / ((win[win.length - 1][0] - win[0][0]) / 1000);
    }
    return v < vStill ? 0 : v;
  }

  /* ---------------------------------------------------------------- elevation */
  // GPS height is noisy (often ±10 m, and it drifts): a 30-second moving average, then a climb only
  // counts once it's 5 m or more above the last turning point (hysteresis). Gain and loss are kept as
  // running totals per point, so splits can take their share. Null without enough heights.
  const ELEV_STEP = 5, ELEV_WINDOW = 30000;
  function elevation(pts) {
    const idx = [];
    for (let i = 0; i < pts.length; i++) if (pts[i].alt != null) idx.push(i);
    if (idx.length < 8 || idx.length < pts.length * 0.3) return null;
    const sm = new Array(idx.length);
    let w0 = 0, w1 = 0, sum = 0;
    for (let k = 0; k < idx.length; k++) {
      const t = pts[idx[k]].t;
      while (w1 < idx.length && pts[idx[w1]].t <= t + ELEV_WINDOW / 2) { sum += pts[idx[w1]].alt; w1++; }
      while (pts[idx[w0]].t < t - ELEV_WINDOW / 2) { sum -= pts[idx[w0]].alt; w0++; }
      sm[k] = sum / (w1 - w0);
    }
    const gain = new Array(pts.length).fill(0), loss = new Array(pts.length).fill(0);
    let ref = sm[0], g = 0, l = 0, lo = Infinity, hi = -Infinity, k = 0;
    for (let i = 0; i < pts.length; i++) {
      if (k < idx.length && idx[k] === i) {
        const a = sm[k];
        lo = Math.min(lo, a); hi = Math.max(hi, a);
        if (a - ref >= ELEV_STEP) { g += a - ref; ref = a; } else if (ref - a >= ELEV_STEP) { l += ref - a; ref = a; }
        k++;
      }
      gain[i] = g; loss[i] = l;
    }
    return { gain: Math.round(g), loss: Math.round(l), min: Math.round(lo), max: Math.round(hi), cumGain: gain, cumLoss: loss, smooth: sm, at: idx };
  }

  /* ---------------------------------------------------------------- splits and best efforts */
  // Where the track passes `dist` metres: its moving time, clock time and point index (the point
  // just past it). Null past the end.
  function at(pts, dist) {
    let lo = 0, hi = pts.length - 1;
    if (!pts.length || pts[hi].d < dist) return null;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].d < dist) lo = mid + 1; else hi = mid; }
    const b = pts[lo], a = lo > 0 ? pts[lo - 1] : null;
    if (!a || b.d === a.d) return { mt: b.mt, t: b.t, i: lo };
    const f = (dist - a.d) / (b.d - a.d);
    return { mt: a.mt + f * (b.mt - a.mt), t: a.t + f * (b.t - a.t), i: lo };
  }
  // One entry per whole km or mile, then what's left (if it's more than a sliver): m metres, ms moving
  // time, up and dn metres climbed and dropped.
  function splits(tr, unitM, elev) {
    const pts = tr.pts;
    const out = [];
    if (!pts.length || !(tr.distanceM > 0)) return out;
    const eAt = (i) => (elev && i != null ? [elev.cumGain[Math.min(i, pts.length - 1)], elev.cumLoss[Math.min(i, pts.length - 1)]] : [0, 0]);
    let prevMt = 0, prevI = 0;
    const whole = Math.floor(tr.distanceM / unitM + 1e-9);
    for (let k = 1; k <= whole; k++) {
      const x = at(pts, k * unitM);
      if (!x) break;
      const [g1, l1] = eAt(x.i), [g0, l0] = eAt(prevI);
      out.push({ m: Math.round(unitM), ms: Math.max(0, Math.round(x.mt - prevMt)), up: elev ? Math.round(g1 - g0) : null, dn: elev ? Math.round(l1 - l0) : null });
      prevMt = x.mt; prevI = x.i;
    }
    const rest = tr.distanceM - whole * unitM;
    if (rest >= unitM * 0.02) {
      const [g1, l1] = eAt(pts.length - 1), [g0, l0] = eAt(prevI);
      out.push({ m: Math.round(rest), ms: Math.max(0, Math.round(tr.movingMs - prevMt)), up: elev ? Math.round(g1 - g0) : null, dn: elev ? Math.round(l1 - l0) : null, part: true });
    }
    return out;
  }
  // Personal-record distances (runs): the fastest stretch of each length anywhere in the run.
  const EFFORTS = [['1k', 1000, 'Fastest 1 km'], ['1mi', MILE, 'Fastest mile'], ['5k', 5000, 'Fastest 5 km'], ['10k', 10000, 'Fastest 10 km'], ['half', 21097.5, 'Fastest half marathon']];
  // Faster than this over a whole stretch isn't a run (world records are about 6.3 m/s over 1 km).
  const RUN_LIMIT_MPS = 6.5;
  function bestEffort(pts, dist, limitMps) {
    if (pts.length < 2 || pts[pts.length - 1].d < dist) return null;
    let best = null, i = 0;
    for (let j = 1; j < pts.length; j++) {
      const target = pts[j].d - dist;
      if (target < 0) continue;
      while (i + 1 < j && pts[i + 1].d <= target) i++;
      const a = pts[i], b = pts[i + 1];
      const f = b.d > a.d ? Math.min(1, Math.max(0, (target - a.d) / (b.d - a.d))) : 0;
      const ms = pts[j].mt - (a.mt + f * (b.mt - a.mt));
      if (!(ms > 0)) continue;
      if (limitMps && dist / (ms / 1000) > limitMps) continue;
      if (best == null || ms < best) best = ms;
    }
    return best == null ? null : Math.round(best);
  }
  function efforts(tr) {
    const out = {};
    for (const [k, m] of EFFORTS) { const ms = bestEffort(tr.pts, m, RUN_LIMIT_MPS); if (ms) out[k] = ms; }
    return out;
  }
  // The fastest 10 seconds or more, m/s.
  function maxSpeed(pts, cap) {
    let best = 0, j = 0;
    for (let i = 1; i < pts.length; i++) {
      while (j < i - 1 && pts[i].mt - pts[j + 1].mt >= 10000) j++;
      const dt = pts[i].mt - pts[j].mt;
      if (dt >= 10000 && pts[i].run === pts[j].run) best = Math.max(best, (pts[i].d - pts[j].d) / (dt / 1000));
    }
    return Math.round(Math.min(best, cap || Infinity) * 100) / 100;
  }

  /* ---------------------------------------------------------------- calories */
  // Active calories (what's burned on top of resting), estimated when no watch measured them.
  // Walking and hiking: the ACSM walking equation, VO2 = 0.1·v + 1.8·v·grade (+3.5 at rest), with v in
  // m/min; running: 0.2·v + 0.9·v·grade. Net VO2 × kg × minutes ÷ 1000 × 5 kcal per litre of oxygen.
  // Only climbs add (the equations aren't made for downhill), hikes add 15% for rough ground. Rides:
  // Compendium of Physical Activities METs by speed; other activities a general 4 MET. Active kcal
  // from METs is (MET − 1) × kg × hours.
  const CYCLE_MET = [[16, 4], [19.3, 6.8], [22.5, 8], [25.7, 10], [30.6, 12], [Infinity, 15.8]];
  function kcalFor(type, meters, ms, climb, kg) {
    const min = ms / 60000;
    if (!(min > 0) || !(kg > 0)) return 0;
    const v = meters / min; // m/min
    const grade = meters > 0 ? Math.min(0.3, Math.max(0, (climb || 0) / meters)) : 0;
    if (type === 'cycle') {
      const kmh = (v * 60) / 1000;
      if (kmh < 3) return 0;
      const met = CYCLE_MET.find(([top]) => kmh < top)[1];
      return (met - 1) * kg * (min / 60);
    }
    if (type === 'other') return 3 * kg * (min / 60);
    const running = type === 'run' && v >= 110;
    const vo2 = running ? 0.2 * v + 0.9 * v * grade : 0.1 * v + 1.8 * v * grade;
    return ((vo2 * kg * min) / 1000) * 5 * (type === 'hike' ? 1.15 : 1);
  }
  // Over the whole track, a minute at a time (pace and slope change along the way). Other activities
  // burn by the minute, moving or not.
  function kcalEstimate(type, tr, elev, kg) {
    if (type === 'other') return Math.round(kcalFor('other', 0, tr.movingMs, 0, kg));
    const pts = tr.pts;
    const chunk = (a, b) => kcalFor(type, pts[b].d - pts[a].d, pts[b].mt - pts[a].mt, elev ? Math.max(0, elev.cumGain[b] - elev.cumGain[a]) : 0, kg);
    let total = 0, a = 0;
    for (let b = 1; b < pts.length; b++) {
      if (pts[b].run !== pts[a].run) { if (b - 1 > a) total += chunk(a, b - 1); a = b; continue; }
      if (pts[b].mt - pts[a].mt >= 60000 || b === pts.length - 1) { total += chunk(a, b); a = b; }
    }
    return Math.round(total);
  }

  /* ---------------------------------------------------------------- heart rate */
  // Maximum heart rate from age, Tanaka, Monahan & Seals 2001: 208 − 0.7 × age.
  const hrMaxFor = (age) => Math.round(208 - 0.7 * (age > 0 ? age : 35));
  // Zones as a share of that maximum: 1 under 60%, 2 60-70%, 3 70-80%, 4 80-90%, 5 90% and up.
  const ZONES = [[0, 'Easy'], [0.6, 'Light'], [0.7, 'Moderate'], [0.8, 'Hard'], [0.9, 'Maximum']];
  const zoneOf = (bpm, max) => { let z = 0; for (let i = 1; i < ZONES.length; i++) if (bpm >= ZONES[i][0] * max) z = i; return z; };
  // samples: [[t, bpm], …] from Health Connect. Average and zones are time-weighted over the moving
  // part (each reading counts until the next, at most a minute); pts is a downsampled series for the
  // chart, [seconds from the start, bpm].
  function hrStats(samples, o) {
    const opt = o || {};
    const start = opt.start || 0, end = opt.end || Infinity;
    const pauses = opt.pauses || [];
    const s = (samples || []).map((x) => [num(x && x[0]), num(x && x[1])]).filter((x) => x[0] != null && x[1] >= 30 && x[1] <= 240 && x[0] >= start - 60000 && x[0] <= end + 60000)
      .sort((a, b) => a[0] - b[0]).filter((x, i, arr) => i === 0 || x[0] !== arr[i - 1][0]);
    if (!s.length) return null;
    const max = hrMaxFor(opt.age);
    const gaps = [];
    for (let i = 1; i < s.length; i++) gaps.push(s[i][0] - s[i - 1][0]);
    const typical = Math.min(60000, Math.max(1000, median(gaps) || 5000));
    const zones = [0, 0, 0, 0, 0];
    let wSum = 0, bSum = 0, top = 0;
    for (let i = 0; i < s.length; i++) {
      const [t, bpm] = s[i];
      if (t < start || t > end || inside(pauses, t)) continue;
      const next = i + 1 < s.length ? s[i + 1][0] - t : Math.min(typical, Math.max(0, end - t));
      const w = Math.min(60000, next) || typical;
      wSum += w; bSum += bpm * w;
      zones[zoneOf(bpm, max)] += w;
      top = Math.max(top, bpm);
    }
    if (!wSum) return null;
    const inRange = s.filter((x) => x[0] >= start && x[0] <= end);
    const N = 240;
    const pts = [];
    if (inRange.length <= N) for (const [t, bpm] of inRange) pts.push([Math.round((t - start) / 1000), Math.round(bpm)]);
    else {
      const span = (inRange[inRange.length - 1][0] - inRange[0][0]) / N;
      let bucket = [], b0 = inRange[0][0];
      for (const x of inRange) {
        if (x[0] >= b0 + span && bucket.length) { pts.push([Math.round((bucket[0][0] - start) / 1000), Math.round(bucket.reduce((a, y) => a + y[1], 0) / bucket.length)]); bucket = []; b0 = x[0]; }
        bucket.push(x);
      }
      if (bucket.length) pts.push([Math.round((bucket[0][0] - start) / 1000), Math.round(bucket.reduce((a, y) => a + y[1], 0) / bucket.length)]);
    }
    return { avg: Math.round(bSum / wSum), max: Math.round(top), hrMax: max, zones: zones.map(Math.round), pts };
  }

  /* ---------------------------------------------------------------- simplification + encoding */
  // Douglas-Peucker on metres (a flat projection around the route), each run on its own so pauses
  // stay where they were. tol 5 m keeps a street route's shape with a fraction of the points.
  function simplify(pts, tol) {
    const tolM = tol == null ? 5 : tol;
    if (pts.length <= 2) return pts.slice();
    const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const kx = R_EARTH * rad(1) * Math.cos(rad(lat0)), ky = R_EARTH * rad(1);
    const xy = pts.map((p) => [p.lon * kx, p.lat * ky]);
    const keep = new Uint8Array(pts.length);
    const segDist = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = dx * dx + dy * dy;
      let f = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
      f = Math.max(0, Math.min(1, f));
      const x = a[0] + f * dx - p[0], y = a[1] + f * dy - p[1];
      return Math.sqrt(x * x + y * y);
    };
    let s = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && pts[i].run === pts[s].run) continue;
      const e = i - 1;
      keep[s] = 1; keep[e] = 1;
      const stack = [[s, e]];
      while (stack.length) {
        const [a, b] = stack.pop();
        let far = -1, fd = tolM;
        for (let k = a + 1; k < b; k++) { const d = segDist(xy[k], xy[a], xy[b]); if (d > fd) { fd = d; far = k; } }
        if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
      }
      s = i;
    }
    return pts.filter((_, i) => keep[i]);
  }
  // A route stored small: deltas of tenths of a second, 1e-5 degrees (about a metre) and whole metres
  // of height, plus where each run after a pause starts.
  const E5 = 1e5;
  function encodeRoute(pts, start) {
    const t = [], y = [], x = [], z = [], g = [];
    const alt = pts.some((p) => p.alt != null);
    let pt = 0, py = 0, px = 0, pz = 0, lastAlt = null;
    pts.forEach((p, i) => {
      const ti = Math.round((p.t - start) / 100), yi = Math.round(p.lat * E5), xi = Math.round(p.lon * E5);
      t.push(ti - pt); y.push(yi - py); x.push(xi - px);
      pt = ti; py = yi; px = xi;
      if (alt) { const zi = Math.round(p.alt != null ? p.alt : lastAlt != null ? lastAlt : 0); z.push(zi - pz); pz = zi; if (p.alt != null) lastAlt = p.alt; }
      if (i > 0 && p.run !== pts[i - 1].run) g.push(i);
    });
    return { v: 1, t, y, x, z: alt ? z : null, g };
  }
  // [{ t, lat, lon, alt, gap }] where gap marks the first point after a pause.
  function decodeRoute(r, start) {
    if (!r || !Array.isArray(r.t)) return [];
    const out = [];
    const gaps = new Set(r.g || []);
    let t = 0, y = 0, x = 0, z = 0;
    for (let i = 0; i < r.t.length; i++) {
      t += r.t[i]; y += r.y[i]; x += r.x[i];
      if (r.z) z += r.z[i];
      out.push({ t: (start || 0) + t * 100, lat: y / E5, lon: x / E5, alt: r.z ? z : null, gap: gaps.has(i) });
    }
    return out;
  }
  function boundsOf(pts) {
    if (!pts.length) return null;
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of pts) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    return [s, w, n, e];
  }
  // Metres and moving seconds between stored points, for colouring the route by pace (pauses break it).
  function routeSegments(route) {
    const out = [];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (b.gap) continue;
      out.push({ i, m: haversine(a.lat, a.lon, b.lat, b.lon), s: Math.max(0.1, (b.t - a.t) / 1000) });
    }
    return out;
  }

  /* ---------------------------------------------------------------- titles */
  function defaultTitle(type, start) {
    const h = new Date(start).getHours();
    const part = h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night';
    return `${part} ${typeOf(type).noun}`;
  }

  /* ---------------------------------------------------------------- building an activity */
  const roll = (S) => (S && S.profile && S.profile.prefs && S.profile.prefs.rollHour != null ? S.profile.prefs.rollHour : 4);
  function weightKg(S, day) {
    const b = B();
    const ws = b && b.weightStats ? b.weightStats(S, day) : null;
    return (ws && (ws.current || ws.avg7 || ws.last)) || (S && S.profile && S.profile.weightKg) || 70;
  }
  // A finished recording as a saved activity. rec: { id, type, title, start (when the clock started),
  // end, points, pauses, pausedMs, movingMs, steps (the phone's step counter), distanceM (the
  // recorder's own total, used only when there are no fixes to work from) }.
  function build(S, rec) {
    const type = TYPES[rec.type] ? rec.type : 'other';
    const tp = typeOf(type);
    const start = rec.start, end = Math.max(rec.end || start, start);
    const tr = track(rec.points, { type, start, end, pauses: rec.pauses, pausedMs: rec.pausedMs, movingMs: rec.movingMs });
    if (!tr.pts.length && rec.distanceM > 0) tr.distanceM = rec.distanceM;
    const elev = elevation(tr.pts);
    const day = B() ? B().dayOf(start, roll(S)) : null;
    const kg = weightKg(S, day);
    const simple = simplify(smoothRoute(tr.pts), 5);
    const act = {
      v: 1, id: String(rec.id), type, title: String(rec.title || defaultTitle(type, start)).slice(0, 60), start, end, day,
      distanceM: Math.round(tr.distanceM), movingMs: Math.round(tr.movingMs), elapsedMs: end - start,
      steps: rec.steps > 0 ? Math.round(rec.steps) : null,
      kcalEst: kcalEstimate(type, tr, elev, kg), kg: Math.round(kg * 10) / 10,
      elev: elev ? { gain: elev.gain, loss: elev.loss, min: elev.min, max: elev.max } : null,
      splits: { km: splits(tr, 1000, elev), mi: splits(tr, MILE, elev) },
      best: type === 'run' ? efforts(tr) : null,
      maxMps: maxSpeed(tr.pts, tp.maxMps),
      route: simple.length ? encodeRoute(simple, start) : null,
      bounds: boundsOf(tr.pts),
      pauses: tr.pauses.filter(([a, b]) => b - a >= 1000).map(([a, b]) => [Math.round((a - start) / 1000), Math.round((b - start) / 1000)]),
      hr: null, hc: null, saved: null, records: [],
    };
    return act;
  }
  // Heart rate, steps and calories from Health Connect (the watch), when they arrive.
  function withWatch(S, act, res) {
    if (!res || !res.ok) return act;
    const hr = hrStats(res.hr, { start: act.start, end: act.end, age: S && S.profile && S.profile.age, pauses: (act.pauses || []).map(([a, b]) => [act.start + a * 1000, act.start + b * 1000]) });
    const pos = (v) => (num(v) > 0 ? Math.round(num(v)) : null);
    act.hc = {
      at: Date.now(), steps: pos(res.steps), distanceM: pos(res.distanceM), activeKcal: pos(res.activeKcal), totalKcal: pos(res.totalKcal),
      sources: Array.isArray(res.sources) ? res.sources.map((s) => String(s).slice(0, 60)).slice(0, 4) : [],
      found: !!(hr || pos(res.steps) || pos(res.activeKcal) || pos(res.distanceM)),
    };
    if (hr) act.hr = hr;
    return act;
  }
  // What the summary shows: the watch's numbers first, then the phone's.
  const stepsOf = (a) => (a.hc && a.hc.steps > 0 ? a.hc.steps : a.steps > 0 ? a.steps : null);
  const stepsSrc = (a) => (a.hc && a.hc.steps > 0 ? 'watch' : a.steps > 0 ? 'phone' : null);
  const kcalOf = (a) => (a.hc && a.hc.activeKcal > 0 ? a.hc.activeKcal : a.kcalEst > 0 ? a.kcalEst : null);
  const kcalSrc = (a) => (a.hc && a.hc.activeKcal > 0 ? 'watch' : a.kcalEst > 0 ? 'estimate' : null);
  // Pace in seconds per km or mile, speed in km/h or mph.
  const paceOf = (m, ms, unitM) => (m > 0 && ms > 0 ? (ms / 1000) / (m / unitM) : null);
  const speedOf = (m, ms, unitM) => (m > 0 && ms > 0 ? (m / unitM) / (ms / 3600000) : null);

  /* ---------------------------------------------------------------- personal records */
  // Only activities of a minute or more count; best efforts only come from runs.
  function records(list) {
    const out = { byType: {}, steps: null };
    for (const a of list || []) {
      if (!a || !(a.movingMs >= 60000)) continue;
      const r = out.byType[a.type] = out.byType[a.type] || { n: 0, dist: null, time: null, best: {} };
      r.n++;
      if (a.distanceM > 0 && (!r.dist || a.distanceM > r.dist.v)) r.dist = { v: a.distanceM, id: a.id, start: a.start };
      if (!r.time || a.movingMs > r.time.v) r.time = { v: a.movingMs, id: a.id, start: a.start };
      if (a.type === 'run' && a.best) for (const [k] of EFFORTS) if (a.best[k] > 0 && (!r.best[k] || a.best[k] < r.best[k].v)) r.best[k] = { v: a.best[k], id: a.id, start: a.start };
      const st = stepsOf(a);
      if (st > 0 && (!out.steps || st > out.steps.v)) out.steps = { v: st, id: a.id, start: a.start, type: a.type };
    }
    return out;
  }
  // Records this activity set against everything before it. A first activity of a kind sets its
  // records quietly; after that, beating one is worth saying.
  function newRecords(list, act) {
    if (!act || !(act.movingMs >= 60000)) return [];
    const before = records((list || []).filter((a) => a && a.id !== act.id && a.start < act.start));
    const r = before.byType[act.type];
    const out = [];
    const noun = typeOf(act.type).noun;
    if (r) {
      if (act.type === 'run' && act.best) for (const [k, , label] of EFFORTS) if (act.best[k] > 0 && r.best[k] && act.best[k] < r.best[k].v) out.push({ key: k, label, v: act.best[k], prev: r.best[k].v, kind: 'time' });
      if (r.dist && act.distanceM > r.dist.v) out.push({ key: 'dist', label: `Longest ${noun}`, v: act.distanceM, prev: r.dist.v, kind: 'dist' });
      if (r.time && act.movingMs > r.time.v) out.push({ key: 'time', label: `Longest ${noun} by time`, v: act.movingMs, prev: r.time.v, kind: 'dur' });
    }
    const st = stepsOf(act);
    if (before.steps && st > before.steps.v) out.push({ key: 'steps', label: 'Most steps', v: st, prev: before.steps.v, kind: 'steps' });
    return out;
  }

  /* ---------------------------------------------------------------- history */
  const KEEP = 500;        // activities kept
  const KEEP_ROUTES = 60;  // the newest ones keep their route and heart-rate chart
  const list = (S) => (S ? (Array.isArray(S.activities) ? S.activities : (S.activities = [])) : []);
  const get = (S, id) => list(S).find((a) => a.id === String(id)) || null;
  function trim(S) {
    const l = list(S);
    l.sort((a, b) => b.start - a.start);
    if (l.length > KEEP) l.length = KEEP;
    for (let i = KEEP_ROUTES; i < l.length; i++) { if (l[i].route) { l[i].route = null; l[i].trimmed = true; } if (l[i].hr && l[i].hr.pts) delete l[i].hr.pts; }
  }
  function add(S, act) {
    const l = list(S);
    const i = l.findIndex((a) => a.id === act.id);
    if (i >= 0) l.splice(i, 1);
    l.push(act);
    trim(S);
    act.records = newRecords(l, act);
    touch(S, act.day);
    return act;
  }
  function remove(S, id) {
    const l = list(S);
    const i = l.findIndex((a) => a.id === String(id));
    if (i < 0) return null;
    const [gone] = l.splice(i, 1);
    touch(S, gone.day);
    return { act: gone, index: i };
  }
  function restore(S, gone) {
    if (!gone || !gone.act || get(S, gone.act.id)) return false;
    list(S).splice(Math.min(gone.index, list(S).length), 0, gone.act);
    trim(S);
    touch(S, gone.act.day);
    return true;
  }
  // The day's health record is rebuilt so the activity counts (or stops counting) as exercise.
  function touch(S, day) { if (day != null && GH.health && GH.health.rebuild && S && S.health) { try { GH.health.rebuild(S, day); } catch (e) { /* ignore */ } } }
  // The day's activities as exercise, the shape health.js uses for Health Connect sessions.
  function exerciseOn(S, day) {
    const out = [];
    for (const a of list(S)) {
      if (a.day !== day || !(a.movingMs >= 60000)) continue;
      out.push({ typeName: typeOf(a.type).hcName, minutes: Math.max(1, Math.round(a.movingMs / 60000)), start: a.start, title: a.title || '', src: 'activity', id: a.id, distanceM: a.distanceM || null, fromApp: false });
    }
    return out;
  }
  const spans = (S) => list(S).map((a) => [a.start, a.end]);
  // A light day's walk: any activity of 10 minutes or more ticks it off, the way a walk from Health
  // Connect or one logged by hand does. Returns true if it did.
  function countLight(S, act) {
    const b = B();
    if (!b || !act || !(act.movingMs >= 600000)) return false;
    try {
      const plan = b.todayPlan(S, act.day);
      if (plan.type !== 'light' || (plan.light && plan.light.walk)) return false;
      b.logLight(S, act.day, 'walk', 'activity');
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------- the recorder */
  const parse = (x) => { if (x == null) return null; if (typeof x !== 'string') return x; try { return JSON.parse(x); } catch (e) { return null; } };
  function call(name, ...args) {
    try { const b = bridge(); return b && typeof b[name] === 'function' ? b[name](...args) : null; } catch (e) { return null; }
  }
  const hasNative = () => { const b = bridge(); return !!(b && typeof b.actStart === 'function' && typeof b.actState === 'function'); };
  // Chained: whatever hook was there first keeps getting called.
  function chain(name, fn) {
    const earlier = hooks[name];
    hooks[name] = function (x) {
      if (typeof earlier === 'function') { try { earlier.apply(this, arguments); } catch (e) { /* ignore */ } }
      fn(x);
    };
  }
  const EMPTY = { active: false, id: null, type: null, title: null, startedAt: null, endedAt: null, paused: false, autoPaused: false, pausedMs: 0, elapsedMs: 0, distanceM: 0, steps: null, points: 0, lastFix: null, coarse: null, gps: 'off', opts: { autoPause: false, voice: false } };
  // A position from the recorder: { lat, lon, acc, t, bearing (degrees, null when unknown), speed }.
  const fixOf = (f) => {
    if (!f || num(f.lat) == null || num(f.lon) == null || Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) return null;
    const b = num(f.bearing), sp = num(f.speed);
    return { lat: +f.lat, lon: +f.lon, acc: num(f.acc), t: num(f.t), bearing: b != null && b >= 0 && b <= 360 ? b : null, speed: sp != null && sp >= 0 ? sp : null };
  };
  function normState(x) {
    const s = parse(x);
    if (!s || typeof s !== 'object') return Object.assign({}, EMPTY, { at: Date.now() });
    const o = s.opts && typeof s.opts === 'object' ? s.opts : {};
    return {
      active: !!s.active, id: s.id != null ? String(s.id) : null, type: s.type || null, title: s.title || null,
      startedAt: num(s.startedAt), endedAt: s.active ? null : num(s.endedAt), paused: !!s.paused, autoPaused: !!(s.active && s.paused && s.autoPaused), pausedMs: Math.max(0, num(s.pausedMs) || 0), elapsedMs: Math.max(0, num(s.elapsedMs) || 0),
      distanceM: Math.max(0, num(s.distanceM) || 0), steps: num(s.steps), points: Math.max(0, num(s.points) || 0), lastFix: fixOf(s.lastFix),
      // Where the phone roughly is (the network's or the fused provider's guess) while GPS looks: for
      // the map, never for the distance.
      coarse: fixOf(s.coarse),
      gps: s.gps === 'ok' || s.gps === 'searching' ? s.gps : 'off', opts: { autoPause: !!o.autoPause, voice: !!o.voice }, at: Date.now(),
    };
  }
  // The activity clock, pauses taken out, at `now`. elapsedMs is read as the clock itself; a recorder
  // whose elapsedMs turns out to be wall time (it matches now − startedAt while pausedMs doesn't) has
  // the pauses taken off here. Between updates the clock runs on from when the state arrived.
  function clockMs(st, now) {
    if (!st) return 0;
    let ms = st.elapsedMs || 0;
    if (st.startedAt && st.pausedMs > 1500) {
      const wall = (st.at || now) - st.startedAt;
      if (Math.abs(ms - wall) <= 2000 && Math.abs(ms + st.pausedMs - wall) > 2000) ms = Math.max(0, ms - st.pausedMs);
    }
    if (st.active && !st.paused && st.at) ms += Math.max(0, Math.min(5000, (now || Date.now()) - st.at));
    return ms;
  }

  const stateListeners = new Set();
  let quiet = false; // while everything is reset, the page isn't told
  function emit(st) { if (quiet) return; for (const f of [...stateListeners]) { try { f(st); } catch (e) { if (G.console) G.console.error(e); } } }
  chain('onActivity', (x) => { const st = normState(x); emit(st); });
  let permWaiters = [];
  chain('onActPermissions', (x) => { const p = parse(x) || {}; const w = permWaiters; permWaiters = []; for (const f of w) f(p); });

  // The Android shell's recorder. It only starts with precise location allowed (approximate is too
  // rough for a route); support() says whether location is on (locationOn) and permissions() whether
  // only approximate location was allowed (approximate).
  const native = {
    kind: 'android',
    support() { return Object.assign({ gps: false, steps: false, hc: false }, parse(call('actSupport')) || {}); },
    permissions() { return Promise.resolve(Object.assign({ location: 'ask', activity: 'ask', notifications: 'ask' }, parse(call('actPermissions')) || {})); },
    // The app's page in Android's settings, for a permission Android won't ask for again.
    canOpenSettings() { const b = bridge(); return !!(b && typeof b.actOpenSettings === 'function'); },
    openSettings() { call('actOpenSettings'); },
    request() {
      return new Promise((resolve) => {
        let settled = false;
        const done = (p) => { if (settled) return; settled = true; clearTimeout(timer); resolve(Object.assign({ location: 'ask', activity: 'ask', notifications: 'ask' }, p || {})); };
        const timer = setTimeout(() => native.permissions().then(done), 180000);
        const b = bridge();
        if (!b || typeof b.actRequestPermissions !== 'function') { native.permissions().then(done); return; }
        permWaiters.push(done);
        try { b.actRequestPermissions(); } catch (e) { permWaiters = permWaiters.filter((f) => f !== done); native.permissions().then(done); }
      });
    },
    // o: { id, type, title, units?, autoPause?, voice? }
    start(o) { return !!call('actStart', JSON.stringify(o)); },
    pause() { call('actPause'); },
    resume() { call('actResume'); },
    stop() { call('actStop'); },
    // Auto-pause and the spoken splits, changed while it records: { autoPause?, voice? }.
    setOptions(o) { call('actSetOptions', JSON.stringify(o || {})); },
    state() { return normState(call('actState')); },
    points(from) { const p = parse(call('actPoints', Math.max(0, from | 0))); return Array.isArray(p) ? p : []; },
    clear(id) { call('actClear', String(id)); },
  };

  // A browser's recorder: navigator.geolocation, the same state shape, kept in localStorage so a
  // reload picks it up. No step counter and no Health Connect. On the phone it also records an
  // activity without GPS when location isn't allowed (the shell's recorder won't start then): the
  // clock only, with steps and heart rate from a watch afterwards. Auto-pause runs the same rules as
  // the shell's (autoPauser); a pause it makes starts where the stop began (r.auto marks it).
  const web = (() => {
    const KEY = 'gh.act.rec';
    let r = null, loaded = false, watch = null, tick = null, saveAt = 0, measured = { at: 0, n: -1, m: 0 }, det = null;
    const geo = () => (G.navigator && G.navigator.geolocation) || null;
    const ls = () => { try { return G.localStorage || null; } catch (e) { return null; } };
    function load() { try { const s = ls(); const o = s ? JSON.parse(s.getItem(KEY) || 'null') : null; return o && o.id ? o : null; } catch (e) { return null; } }
    // Whether it holds a recording, going or waiting to be saved (read from storage the first time).
    function holds() { if (!loaded) { loaded = true; if (!r) r = load(); } return !!r; }
    function persist(force) {
      const t = Date.now();
      if (!force && t - saveAt < 5000) return;
      saveAt = t;
      try { const s = ls(); if (!s) return; if (r) s.setItem(KEY, JSON.stringify(r)); else s.removeItem(KEY); } catch (e) { /* storage full: keep going in memory */ }
    }
    // Distance the same way the summary measures it, at most every 3 seconds.
    function distance() {
      const t = Date.now();
      if (measured.n !== r.pts.length && (t - measured.at >= 3000 || !r.active)) measured = { at: t, n: r.pts.length, m: track(r.pts, { type: r.type, start: r.startedAt, end: r.active ? t : r.endedAt }).distanceM };
      return measured.m;
    }
    function state() {
      if (!holds()) return normState(null);
      const t = r.active ? Date.now() : r.endedAt;
      const pausedMs = r.pausedMs + (r.paused && r.pauseAt ? Math.max(0, t - r.pauseAt) : 0);
      return normState({ active: r.active, id: r.id, type: r.type, title: r.title, startedAt: r.startedAt, endedAt: r.active ? null : r.endedAt, paused: r.paused, autoPaused: r.paused && r.auto, pausedMs, elapsedMs: Math.max(0, t - r.startedAt - pausedMs), distanceM: distance(), steps: null, points: r.pts.length, lastFix: r.lastFix, coarse: r.coarse, gps: r.noGps ? 'off' : r.gps, opts: r.opts });
    }
    // Fixes the auto-pause has decided on, flagged as it says; and the clock stopped or going on.
    function keep(res) {
      for (const [p, paused] of res.out || []) { p[6] = paused; r.pts.push(p); }
      if (res.pause != null && !r.paused) { r.paused = true; r.auto = true; r.pauseAt = Math.max(r.startedAt, res.pause); }
      if (res.resume != null && r.paused && r.auto) { r.pausedMs += Math.max(0, res.resume - r.pauseAt); r.paused = false; r.auto = false; r.pauseAt = null; }
    }
    const detector = () => { if (!det && r && r.opts && r.opts.autoPause) det = autoPauser(r.type, r.paused && r.auto); return det; };
    function onFix(pos) {
      if (!r || !r.active || !pos || !pos.coords) return;
      const c = pos.coords;
      // Stamped on arrival: a fix's own timestamp can be on another clock (GPS time on some phones).
      const p = [Date.now(), c.latitude, c.longitude, c.altitude == null ? null : c.altitude, c.accuracy == null ? null : c.accuracy, c.speed == null || !(c.speed >= 0) ? null : c.speed, r.paused ? 1 : 0];
      const n = norm(p);
      if (!n) return;
      r.lastFix = { lat: n[1], lon: n[2], acc: n[4], t: n[0], bearing: c.heading == null || !(c.heading >= 0) ? null : c.heading, speed: n[5] };
      r.gps = n[4] != null && n[4] > 30 ? 'searching' : 'ok';
      // Paused by hand (or still waiting for the 3-2-1): kept as it comes. Otherwise auto-pause has
      // its say.
      if (r.paused && !r.auto) r.pts.push(n);
      else if (detector()) keep(det.feed(n));
      else r.pts.push(n);
      persist();
    }
    function onErr(e) { if (r) r.gps = e && e.code === 1 ? 'off' : 'searching'; }
    function run() {
      const g = geo();
      if (g && watch == null && !r.noGps) { try { watch = g.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }); } catch (e) { watch = null; } }
      // A rough position at once (the network's, or one the phone already had) for the map while
      // GPS looks: never part of the track.
      if (g && !r.noGps && !r.lastFix && !r.coarse) {
        try { g.getCurrentPosition((pos) => { if (r && r.active && pos && pos.coords && !r.lastFix) { r.coarse = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() }; emit(state()); } }, () => {}, { enableHighAccuracy: false, maximumAge: 120000, timeout: 15000 }); } catch (e) { /* none, then */ }
      }
      if (!tick) {
        tick = setInterval(() => {
          if (!r || !r.active) return;
          if (r.lastFix && Date.now() - r.lastFix.t > 15000 && r.gps === 'ok') r.gps = 'searching';
          emit(state());
        }, 1000);
      }
    }
    function halt() {
      const g = geo();
      if (g && watch != null) { try { g.clearWatch(watch); } catch (e) { /* ignore */ } }
      watch = null;
      if (tick) { clearInterval(tick); tick = null; }
    }
    function permState() {
      const P = G.navigator && G.navigator.permissions;
      if (!geo()) return Promise.resolve('denied');
      if (!P || !P.query) return Promise.resolve('ask');
      return P.query({ name: 'geolocation' }).then((s) => (s.state === 'granted' ? 'granted' : s.state === 'denied' ? 'denied' : 'ask'), () => 'ask');
    }
    const api = {
      kind: 'web',
      support() { return { gps: !!geo(), steps: false, hc: false }; },
      permissions() { return permState().then((location) => ({ location, activity: 'granted', notifications: 'granted' })); },
      request() {
        return new Promise((resolve) => {
          const g = geo();
          if (!g) { resolve({ location: 'denied', activity: 'granted', notifications: 'granted' }); return; }
          g.getCurrentPosition(() => resolve({ location: 'granted', activity: 'granted', notifications: 'granted' }),
            (e) => resolve({ location: e && e.code === 1 ? 'denied' : 'granted', activity: 'granted', notifications: 'granted' }),
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
        });
      },
      // o: { id, type, title, noGps: the clock only, autoPause, voice }
      start(o) {
        if (holds() && r.active) return false;
        r = { id: String(o.id), type: o.type, title: o.title || '', startedAt: Date.now(), paused: false, auto: false, pausedMs: 0, pauseAt: null, pts: [], lastFix: null, coarse: null, gps: o.noGps ? 'off' : 'searching', noGps: !!o.noGps, active: true, opts: { autoPause: !!o.autoPause && !o.noGps, voice: !!o.voice } };
        measured = { at: 0, n: -1, m: 0 };
        det = null;
        persist(true);
        run();
        return true;
      },
      // By hand: what auto-pause was holding goes as it stood, and a pause it made becomes yours (it
      // won't end by itself).
      pause() {
        if (!r || !r.active || (r.paused && !r.auto)) return;
        if (det) keep({ out: det.manual() });
        if (r.paused) r.auto = false;
        else { r.paused = true; r.auto = false; r.pauseAt = Date.now(); }
        persist(true); emit(state());
      },
      resume() {
        if (!r || !r.active || !r.paused) return;
        if (det) keep({ out: det.manual() });
        r.pausedMs += Math.max(0, Date.now() - (r.pauseAt || Date.now())); r.paused = false; r.auto = false; r.pauseAt = null;
        persist(true); emit(state());
      },
      setOptions(o) {
        if (!r || !r.active || !o) return;
        r.opts = { autoPause: o.autoPause != null ? !!o.autoPause && !r.noGps : r.opts.autoPause, voice: o.voice != null ? !!o.voice : r.opts.voice };
        if (!r.opts.autoPause && det) {
          // Off while it had stopped the clock: the clock goes on now.
          keep({ out: det.drain() });
          det = null;
          if (r.paused && r.auto) { r.pausedMs += Math.max(0, Date.now() - r.pauseAt); r.paused = false; r.auto = false; r.pauseAt = null; }
        }
        persist(true); emit(state());
      },
      stop() {
        if (!r || !r.active) return;
        if (det) { keep({ out: det.drain() }); det = null; }
        if (r.paused) { r.pausedMs += Math.max(0, Date.now() - (r.pauseAt || Date.now())); r.paused = false; r.auto = false; r.pauseAt = null; }
        r.active = false; r.endedAt = Date.now();
        halt();
        persist(true);
        emit(state());
      },
      state,
      points(from) { return holds() ? r.pts.slice(Math.max(0, from | 0)) : []; },
      clear(id) { if (holds() && (id == null || String(id) === r.id) && !r.active) { r = null; persist(true); } },
      holds,
      // After a reload: an activity still recording starts listening again.
      wake() { if (holds() && r.active) run(); },
    };
    return api;
  })();
  // The recorder for the activity going now: one the page is keeping (a browser, or no GPS on the
  // phone) is finished by the page; otherwise the shell's. starter() is the one a new activity uses.
  const starter = () => (hasNative() ? native : web);
  const rec = () => (web.holds() ? web : starter());
  function onState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); }
  // "Reset everything": what's recording, or finished and waiting to be saved, is deleted too.
  function reset() {
    quiet = true;
    try {
      for (const R of hasNative() ? [web, native] : [web]) {
        const seen = new Set();
        for (let i = 0; i < 25; i++) {
          const st = R.state();
          if (!st.id || seen.has(st.id)) break;
          seen.add(st.id);
          if (st.active) R.stop();
          R.clear(st.id);
        }
      }
    } catch (e) { /* nothing to delete */ } finally { quiet = false; }
  }

  /* ---------------------------------------------------------------- Health Connect */
  const waits = { session: new Map(), write: new Map() };
  function answer(kind, x) {
    const r = parse(x);
    if (!r || r.id == null) return;
    const f = waits[kind].get(String(r.id));
    if (f) f(r);
  }
  chain('onHcSession', (x) => answer('session', x));
  chain('onHcActivityWrite', (x) => answer('write', x));
  function ask(kind, method, o, ms) {
    return new Promise((resolve) => {
      const id = String(o.id);
      const b = bridge();
      if (!b || typeof b[method] !== 'function') { resolve({ id, ok: false, error: 'unsupported' }); return; }
      let timer = 0;
      const done = (r) => { if (waits[kind].get(id) !== done) return; waits[kind].delete(id); clearTimeout(timer); resolve(Object.assign({ id }, r)); };
      waits[kind].set(id, done);
      timer = setTimeout(() => done({ ok: false, error: 'timeout' }), ms);
      try { b[method](JSON.stringify(o)); } catch (e) { done({ ok: false, error: 'bridge' }); }
    });
  }
  const canSession = () => { const b = bridge(); return !!(b && typeof b.hcSession === 'function'); };
  const canWrite = () => { const b = bridge(); return !!(b && typeof b.hcWriteActivity === 'function' && (!b.hcCanWrite || b.hcCanWrite())); };
  // The watch's heart rate, steps and calories for the activity's time.
  const hcSession = (act) => ask('session', 'hcSession', { id: act.id, start: act.start, end: act.end }, 30000);
  // Saves the activity as an exercise session with its route. Distance and calories only go when no
  // watch recorded them for that time, so Health Connect doesn't count them twice.
  function writeRecord(act) {
    const hc = act.hc || {};
    const route = decodeRoute(act.route, act.start).map((p) => [Math.round(p.t), p.lat, p.lon, p.alt]);
    return {
      id: act.id, type: act.type, title: act.title || defaultTitle(act.type, act.start), start: act.start, end: act.end,
      distanceM: hc.distanceM > 0 || !(act.distanceM > 0) ? null : act.distanceM,
      activeKcal: hc.activeKcal > 0 || !(act.kcalEst > 0) ? null : act.kcalEst,
      route,
    };
  }
  const hcWrite = (act) => ask('write', 'hcWriteActivity', writeRecord(act), 30000);

  GH.activity = {
    TYPES, ORDER, UNITS, MILE, EFFORTS, ZONES, typeOf, unitsOf, haversine, norm, median,
    AUTO, AUTO_DEFAULT, autoOn, autoPauser, liveSpeed, smoothRoute,
    spikeGate, smoothRun, track, elevation, splits, at, bestEffort, efforts, maxSpeed, kcalFor, kcalEstimate, hrMaxFor, zoneOf, hrStats,
    simplify, encodeRoute, decodeRoute, boundsOf, routeSegments, defaultTitle, build, withWatch, stepsOf, stepsSrc, kcalOf, kcalSrc,
    paceOf, speedOf, records, newRecords, list, get, add, remove, restore, trim, exerciseOn, spans, countLight, KEEP, KEEP_ROUTES,
    rec, starter, native, web, hasNative, onState, normState, clockMs, mergeIv, covered, reset,
    canSession, canWrite, hcSession, hcWrite, writeRecord,
  };
})(typeof window !== 'undefined' ? window : globalThis);
