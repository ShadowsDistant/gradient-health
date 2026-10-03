/* Outdoor activities, after the fact: the summary of one (a route map drawn here, offline, coloured
 * by pace, with a street map behind it on request; splits, elevation, heart rate and zones from the
 * watch, steps, calories, records, saving to Health Connect), the history and personal records, and
 * the ways in (Today, Health, Progress). Recording lives in src/ui/actlive.js; the maths in
 * src/activity.js.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const A = () => GH.activity;
  const B = () => GH.brain;
  const H = () => GH.health;
  const plat = () => GH.platform || null;

  /* ---------------------------------------------------------------- icons */
  // Figures Refract doesn't have, on its grid (24 px, 1.75 stroke, round ends).
  const ICONS = {
    'act-walk': '<circle cx="13.2" cy="4.4" r="1.9"/><path d="M12.7 7.7 11.3 13.4M12.4 9.1 9.5 11.6M12.4 9.1l2.6 2.7M11.3 13.4l-2 3.4-1.4 3.6M11.3 13.4l2.5 3.2 1.7 3.8"/>',
    'act-run': '<circle cx="15.4" cy="4.3" r="1.9"/><path d="M13.9 7.8 11.2 12.9M13.6 8.3l-3.3 1.3-1.9 2.6M13.6 8.3l1.8 3.1 3 .7M11.2 12.9l2.9 2.5-.8 4.9M11.2 12.9 8.8 15.6l-3.9.8"/>',
    'act-cycle': '<circle cx="5.8" cy="16.2" r="3.6"/><circle cx="18.2" cy="16.2" r="3.6"/><path d="M5.8 16.2 9.6 9.9h6.2l2.4 6.3M9.6 9.9l2.3 6.3 3.9-6.3M8.3 8h2.8M15.8 9.9l-.9-2.6h2.2"/>',
  };
  function registerIcons() {
    const r = G.Refract;
    if (!r || !r.icons) return;
    for (const [k, v] of Object.entries(ICONS)) if (!r.icons[k]) r.icons[k] = v;
  }
  registerIcons();
  const typeIcon = (type, size) => U.icon(A().typeOf(type).icon, size);
  U.actTypeIcon = typeIcon;

  /* ---------------------------------------------------------------- formatting */
  const unitId = () => A().unitsOf(U.S);
  const UNIT = () => A().UNITS[unitId()];
  const metric = () => unitId() === 'km';
  // 5.21 (km or mi), whole numbers from 100 up.
  const distNum = (m) => { const v = (m || 0) / UNIT().m; return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); };
  const fmtDist = (m) => `${distNum(m)} ${UNIT().short}`;
  // 5:07 (a pace) or 1:02:03 (a time), from seconds.
  function clock(sec) {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }
  const fmtTime = (ms) => clock((ms || 0) / 1000);
  const pace = (m, ms) => A().paceOf(m, ms, UNIT().m);
  const speed = (m, ms) => A().speedOf(m, ms, UNIT().m);
  const fmtPace = (sec) => (sec == null || !isFinite(sec) || sec > 5999 ? '–' : clock(sec));
  const fmtSpeed = (v) => (v == null || !isFinite(v) ? '–' : v.toFixed(1));
  const paceUnit = () => `/${UNIT().short}`;
  const speedUnit = () => UNIT().speed;
  const isSpeed = (type) => A().typeOf(type).speed;
  // Average pace or speed as [value, unit, label].
  function paceOrSpeed(type, m, ms) {
    return isSpeed(type) ? [fmtSpeed(speed(m, ms)), speedUnit(), 'Avg speed'] : [fmtPace(pace(m, ms)), paceUnit(), 'Avg pace'];
  }
  const fmtElev = (m) => (m == null ? '–' : metric() ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`);
  const whenText = (a) => `${U.fmtDay(a.day)} · ${U.fmtClock(a.start)}`;
  const recValue = (r) => (r.kind === 'time' || r.kind === 'dur' ? fmtTime(r.v) : r.kind === 'dist' ? fmtDist(r.v) : r.kind === 'steps' ? `${U.num(r.v)} steps` : String(r.v));
  Object.assign(U, { actDistNum: distNum, actFmtDist: fmtDist, actClock: clock, actFmtTime: fmtTime, actFmtPace: fmtPace, actFmtSpeed: fmtSpeed, actPaceUnit: paceUnit, actSpeedUnit: speedUnit, actUnitShort: () => UNIT().short, actUnitM: () => UNIT().m, actUnitLong: () => UNIT().long });

  /* ---------------------------------------------------------------- the route, drawn here */
  // Fits lat/lon into a W × H box: a flat projection around the route's middle latitude, y down.
  function projector(bounds, W, H, pad) {
    const [s, w, n, e] = bounds;
    const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
    const bw = Math.max(1e-7, (e - w) * kx), bh = Math.max(1e-7, n - s);
    const k = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * k) / 2, oy = (H - bh * k) / 2;
    return (lat, lon) => [ox + (lon - w) * kx * k, oy + (n - lat) * k];
  }
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  // Pace as five steps round your own average: much slower, slower, about average, faster, much
  // faster. Speed over the stretch around each segment (at least 60 m), so a single GPS hop doesn't
  // colour the line.
  function paceBuckets(route) {
    const segs = A().routeSegments(route);
    const totalM = segs.reduce((a, s) => a + s.m, 0), totalS = segs.reduce((a, s) => a + s.s, 0);
    const avg = totalS > 0 ? totalM / totalS : 0;
    const out = new Map();
    for (let k = 0; k < segs.length; k++) {
      let m = segs[k].m, s = segs[k].s, lo = k - 1, hi = k + 1;
      while (m < 60 && (lo >= 0 || hi < segs.length)) {
        if (lo >= 0) { m += segs[lo].m; s += segs[lo].s; lo--; }
        if (hi < segs.length && m < 60) { m += segs[hi].m; s += segs[hi].s; hi++; }
      }
      const r = avg > 0 && s > 0 ? (m / s) / avg : 1;
      out.set(segs[k].i, r < 0.9 ? 0 : r < 0.96 ? 1 : r <= 1.04 ? 2 : r <= 1.1 ? 3 : 4);
    }
    return { buckets: out, avg };
  }
  U.actPaceBuckets = paceBuckets;
  // The route as SVG: a soft casing, the line (by pace, or one colour), start and end markers and a
  // marker at each km or mile. o: { W, H, pace, marks, live (a current-position dot), cls }.
  function routeSvg(route, o) {
    const opt = Object.assign({ W: 360, H: 240, pad: 22, pace: true, marks: true }, o || {});
    if (!route || route.length < 2) return '';
    const bounds = A().boundsOf(route);
    const P = projector(bounds, opt.W, opt.H, opt.pad);
    const xy = route.map((p) => P(p.lat, p.lon));
    let all = '';
    route.forEach((p, i) => { all += `${i === 0 || p.gap ? 'M' : 'L'}${f1(xy[i][0])} ${f1(xy[i][1])}`; });
    const parts = [`<path class="rt-case" d="${all}"/>`];
    if (opt.pace) {
      const { buckets } = paceBuckets(route);
      let d = '', cur = null;
      const flush = () => { if (d) parts.push(`<path class="rt-line" data-b="${cur}" d="${d}"/>`); d = ''; };
      for (let i = 1; i < route.length; i++) {
        if (route[i].gap) { flush(); cur = null; continue; }
        const b = buckets.has(i) ? buckets.get(i) : 2;
        if (b !== cur) { flush(); cur = b; d = `M${f1(xy[i - 1][0])} ${f1(xy[i - 1][1])}`; }
        d += `L${f1(xy[i][0])} ${f1(xy[i][1])}`;
      }
      flush();
    } else parts.push(`<path class="rt-line" d="${all}"/>`);
    if (opt.marks && opt.unitM) {
      // A dot at each whole km or mile along the stored route (every 5th on long ones).
      let dist = 0, next = opt.unitM, n = 1;
      const every = opt.total / opt.unitM > 20 ? 5 : 1;
      for (let i = 1; i < route.length; i++) {
        if (route[i].gap) continue;
        const a = route[i - 1], b = route[i];
        const seg = A().haversine(a.lat, a.lon, b.lat, b.lon);
        while (seg > 0 && dist + seg >= next) {
          const f = (next - dist) / seg;
          const x = xy[i - 1][0] + f * (xy[i][0] - xy[i - 1][0]), y = xy[i - 1][1] + f * (xy[i][1] - xy[i - 1][1]);
          if (n % every === 0) parts.push(`<g class="rt-km" transform="translate(${f1(x)} ${f1(y)})"><circle r="10"/><text dy="3.8">${n}</text></g>`);
          n++; next += opt.unitM;
        }
        dist += seg;
      }
    }
    const s = xy[0], e = xy[xy.length - 1];
    parts.push(`<circle class="rt-end" cx="${f1(e[0])}" cy="${f1(e[1])}" r="7.5"/>`);
    parts.push(`<circle class="rt-start" cx="${f1(s[0])}" cy="${f1(s[1])}" r="6.5"/>`);
    if (opt.live) parts.push(`<circle class="rt-here-pulse" cx="${f1(e[0])}" cy="${f1(e[1])}" r="9"/><circle class="rt-here" cx="${f1(e[0])}" cy="${f1(e[1])}" r="6"/>`);
    return `<svg class="rt ${opt.cls || ''}" viewBox="0 0 ${opt.W} ${opt.H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${parts.join('')}</svg>`;
  }
  U.actRouteSvg = routeSvg;

  /* ---------------------------------------------------------------- charts */
  // Heart rate over the activity: one line, your average as a hairline with its label, the highest
  // reading marked. Tap for the reading at that time.
  const hrSpecs = {};
  function hrChart(a) {
    const pts = (a.hr && a.hr.pts) || [];
    if (pts.length < 3) return '';
    const W = 600, HT = 150;
    const t1 = Math.max(pts[pts.length - 1][0], 1);
    let lo = Infinity, hi = -Infinity;
    for (const [, b] of pts) { lo = Math.min(lo, b); hi = Math.max(hi, b); }
    lo = Math.floor((lo - 5) / 10) * 10; hi = Math.ceil((hi + 5) / 10) * 10;
    const x = (t) => (t / t1) * W, y = (b) => HT - ((b - lo) / (hi - lo)) * HT;
    let d = '';
    let prev = null;
    for (const [t, b] of pts) { d += `${prev == null || t - prev > 180 ? 'M' : 'L'}${f1(x(t))} ${f1(y(b))}`; prev = t; }
    const top = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]);
    hrSpecs[a.id] = { pts, t1 };
    const avgY = y(a.hr.avg);
    return `<div class="hr-plot" data-act="actHrTap" data-arg="${U.esc(a.id)}" role="img" aria-label="Heart rate over the ${U.esc(A().typeOf(a.type).noun)}: average ${a.hr.avg}, highest ${a.hr.max} beats a minute. Tap for the reading at a time.">
        <div class="ch-y t-caption rf-num"><span>${hi}</span><span>${lo}</span></div>
        <svg class="hr-svg" viewBox="0 0 ${W} ${HT}" preserveAspectRatio="none" aria-hidden="true">
          <line class="ch-axis" x1="0" x2="${W}" y1="${HT}" y2="${HT}"/>
          <line class="hr-avg" x1="0" x2="${W}" y1="${f1(avgY)}" y2="${f1(avgY)}"/>
          <path class="hr-area" d="${d}L${W} ${HT}L0 ${HT}Z"/>
          <path class="hr-line" d="${d}"/>
          <line class="ch-dot hr-top" x1="${f1(x(top[0]))}" x2="${f1(x(top[0]))}" y1="${f1(y(top[1]))}" y2="${f1(y(top[1]))}"/>
          <line class="ch-mark" x1="-10" x2="-10" y1="0" y2="${HT}" visibility="hidden"/>
        </svg>
        <span class="hr-avg-label t-caption rf-num" style="top:${(avgY / HT * 100).toFixed(1)}%">avg ${a.hr.avg}</span>
      </div>
      <div class="ch-x t-caption rf-num"><span>0:00</span><span>${U.esc(fmtTime(t1 * 1000))}</span></div>
      <div class="ch-tip t-footnote rf-num" aria-live="polite">Tap the chart for a reading.</div>`;
  }
  U.act.actHrTap = (el, ev) => {
    const sp = hrSpecs[el.dataset.arg];
    const svg = el.querySelector('svg');
    if (!sp || !svg) return;
    const r = svg.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * sp.t1;
    let best = sp.pts[0];
    for (const p of sp.pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    const tip = el.parentNode.querySelector('.ch-tip');
    if (tip) tip.textContent = `${fmtTime(best[0] * 1000)} in: ${best[1]} bpm`;
    const mark = svg.querySelector('.ch-mark');
    const xx = ((best[0] / sp.t1) * 600).toFixed(1);
    mark.setAttribute('x1', xx); mark.setAttribute('x2', xx); mark.setAttribute('visibility', 'visible');
  };
  // Time in each heart-rate zone: labelled bars on one ordinal scale.
  function zoneBars(a) {
    const z = a.hr.zones, total = z.reduce((s, v) => s + v, 0) || 1;
    const max = Math.max(...z, 1);
    return `<div class="hz">${A().ZONES.map(([share, name], i) => {
      const lowBpm = Math.round(share * a.hr.hrMax), highBpm = i < 4 ? Math.round(A().ZONES[i + 1][0] * a.hr.hrMax) - 1 : null;
      const range = i === 0 ? `under ${Math.round(A().ZONES[1][0] * a.hr.hrMax)}` : highBpm ? `${lowBpm}-${highBpm}` : `${lowBpm}+`;
      const pct = Math.round((z[i] / total) * 100);
      return `<div class="hz-row" data-z="${i + 1}">
        <span class="hz-name"><span class="t-subhead">Zone ${i + 1}</span><span class="t-caption rf-muted">${U.esc(name)} · ${range}</span></span>
        <span class="hz-track" role="img" aria-label="Zone ${i + 1}: ${U.esc(fmtTime(z[i]))}, ${pct}%"><span class="hz-fill" style="width:${((z[i] / max) * 100).toFixed(1)}%"></span></span>
        <span class="hz-val t-footnote rf-num">${U.esc(fmtTime(z[i]))}<span class="rf-muted"> ${pct}%</span></span>
      </div>`;
    }).join('')}</div>`;
  }
  // Height along the way: a quiet area chart over distance.
  function elevChart(a, route) {
    const pts = route.filter((p) => p.alt != null);
    if (!a.elev || pts.length < 4) return '';
    let dist = 0;
    const ser = [[0, pts[0].alt]];
    for (let i = 1; i < pts.length; i++) { if (!pts[i].gap) dist += A().haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon); ser.push([dist, pts[i].alt]); }
    if (!(dist > 0)) return '';
    // A light smoothing so GPS height noise doesn't draw spikes.
    const sm = ser.map((p, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - 2); k <= Math.min(ser.length - 1, i + 2); k++) { s += ser[k][1]; n++; } return [p[0], s / n]; });
    let lo = Math.min(...sm.map((p) => p[1])), hi = Math.max(...sm.map((p) => p[1]));
    if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = mid - 10; hi = mid + 10; }
    const W = 600, HT = 110;
    const x = (m) => (m / dist) * W, y = (v) => HT - ((v - lo) / (hi - lo)) * HT;
    const d = sm.map((p, i) => `${i ? 'L' : 'M'}${f1(x(p[0]))} ${f1(y(p[1]))}`).join('');
    const conv = (m) => (metric() ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`);
    return `<div class="card el-card" data-key="elev">
      <div class="ch-head"><span class="t-headline">Elevation</span><span class="ch-value t-callout rf-num">${U.esc(fmtElev(a.elev.gain))} up · ${U.esc(fmtElev(a.elev.loss))} down</span></div>
      <div class="el-plot" role="img" aria-label="Elevation from ${U.esc(conv(a.elev.min))} to ${U.esc(conv(a.elev.max))}">
        <div class="ch-y t-caption rf-num"><span>${U.esc(conv(hi))}</span><span>${U.esc(conv(lo))}</span></div>
        <svg class="el-svg" viewBox="0 0 ${W} ${HT}" preserveAspectRatio="none" aria-hidden="true"><line class="ch-axis" x1="0" x2="${W}" y1="${HT}" y2="${HT}"/><path class="el-area" d="${d}L${W} ${HT}L0 ${HT}Z"/><path class="el-line" d="${d}"/></svg>
      </div>
      <div class="ch-x t-caption rf-num"><span>0</span><span>${U.esc(fmtDist(dist))}</span></div>
    </div>`;
  }

  /* ---------------------------------------------------------------- the summary */
  const openId = () => (U.route.view === 'activity' ? U.route.arg : null);
  const cur = () => (openId() ? A().get(U.S, openId()) : null);
  const busy = { watch: {}, save: {} };
  function statTile(label, value, unit, sub, act) {
    return `<${act ? `button type="button" data-act="${act}"` : 'div'} class="stat as-tile"><span class="t-footnote rf-muted">${U.esc(label)}</span><span class="as-val"><span class="t-title-3">${value}</span>${unit ? `<small>${U.esc(unit)}</small>` : ''}</span><span class="t-caption rf-muted">${sub || '&nbsp;'}</span></${act ? 'button' : 'div'}>`;
  }
  function hero(a) {
    // Without GPS (a treadmill, say), the watch's distance when it has one.
    const watch = !(a.distanceM > 0) && a.hc && a.hc.distanceM > 0 ? a.hc.distanceM : 0;
    const dm = a.distanceM > 0 ? a.distanceM : watch;
    const [pv, pu, pl] = paceOrSpeed(a.type, dm, a.movingMs);
    const tp = A().typeOf(a.type);
    return `<div class="card as-hero" data-key="hero" data-hue="${tp.hue}">
      <div class="as-stats">
        <div class="as-stat"><span class="as-num">${dm > 0 ? U.esc(distNum(dm)) : '–'} <small>${U.esc(UNIT().short)}</small></span><span class="as-lab">${watch ? 'Watch distance' : 'Distance'}</span></div>
        <div class="as-stat"><span class="as-num">${U.esc(fmtTime(a.movingMs))}</span><span class="as-lab">Time</span></div>
        <div class="as-stat"><span class="as-num">${U.esc(pv)} <small>${U.esc(pu)}</small></span><span class="as-lab">${U.esc(pl)}</span></div>
      </div>
    </div>`;
  }
  // New records, in one card: what, the new best and the one it beat.
  function recordCards(a) {
    const list = a.records || [];
    if (!list.length) return '';
    return `<div class="card as-recs" data-key="recs">
      <div class="as-recs-head">${U.icon('star')}<span class="t-headline">${list.length === 1 ? 'New record' : `${list.length} new records`}</span></div>
      <ul class="as-recs-list">${list.map((r) => `<li class="as-rec" data-key="rec-${U.esc(r.key)}"><span class="as-rec-l t-subhead">${U.esc(r.label)}</span><span class="as-rec-v t-headline rf-num">${U.esc(recValue(r))}</span><span class="as-rec-p t-caption rf-muted">was ${U.esc(recValue({ kind: r.kind, v: r.prev }))}</span></li>`).join('')}</ul>
    </div>`;
  }
  const streetsOn = () => !!(U.S && U.S.profile.prefs && U.S.profile.prefs.actStreets);
  function mapCard(a) {
    const route = A().decodeRoute(a.route, a.start);
    if (route.length < 2) {
      return `<div class="card am-card am-empty" data-key="map"><span class="rf-list-icon" data-tone="sky">${U.icon('map')}</span><p class="t-callout rf-muted">${a.trimmed ? 'Routes are kept for your newest activities. This one\'s totals are still here.' : 'No route for this one: GPS didn\'t find you, or it was off.'}</p></div>`;
    }
    const { avg } = paceBuckets(route);
    const avgTxt = isSpeed(a.type) ? `${fmtSpeed(avg * 3600 / UNIT().m)} ${speedUnit()}` : `${fmtPace(avg > 0 ? UNIT().m / avg : null)} ${paceUnit()}`;
    const on = streetsOn();
    return `<div class="card am-card" data-key="map">
      <div class="am-box${on ? ' has-streets' : ''}" data-type="${U.esc(a.type)}">
        ${routeSvg(route, { unitM: UNIT().m, total: a.distanceM })}
        <div class="am-streets" data-morph="keep" data-for="${U.esc(a.id)}"></div>
        ${on ? '<p class="am-attr t-caption"><button type="button" class="am-attr-btn" data-act="actOsm">© OpenMapTiles © OpenStreetMap contributors</button></p>' : ''}
      </div>
      <div class="am-legend t-caption" role="img" aria-label="The line shows pace against your average of ${U.esc(avgTxt)}: blue where you were slower, red where you were faster.">
        <span>Slower</span><span class="am-scale"><i data-b="0"></i><i data-b="1"></i><i data-b="2"></i><i data-b="3"></i><i data-b="4"></i></span><span>Faster</span>
        <span class="am-avg rf-muted">Middle: your average, ${U.esc(avgTxt)}</span>
      </div>
      <div class="am-foot">
        <button type="button" class="rf-btn" data-size="sm" data-variant="${on ? 'plain' : 'soft'}" data-act="actStreets" aria-pressed="${on}">${U.icon('map')}${on ? 'Hide streets' : 'Show streets'}</button>
        <p class="t-caption rf-muted am-note">${on ? 'Street maps load from OpenFreeMap, which sees the area of the map.' : 'The route is drawn on this phone. Streets load from OpenFreeMap, which sees the area of the map.'}</p>
      </div>
    </div>`;
  }
  function statGrid(a) {
    const out = [];
    const st = A().stepsOf(a), ss = A().stepsSrc(a);
    out.push(statTile('Steps', st != null ? U.num(st) : '–', '', st != null ? (ss === 'watch' ? 'from your watch' : 'from your phone') : 'none recorded'));
    const kc = A().kcalOf(a), ks = A().kcalSrc(a);
    out.push(statTile('Calories', kc != null ? U.num(kc) : '–', kc != null ? 'kcal' : '', kc != null ? (ks === 'watch' ? 'active, from your watch' : 'active, estimated') : ''));
    if (a.elev) out.push(statTile('Elevation gain', U.esc(fmtElev(a.elev.gain).split(' ')[0]), metric() ? 'm' : 'ft', `${U.esc(fmtElev(a.elev.loss))} down`));
    if (a.hr) out.push(statTile('Heart rate', String(a.hr.avg), 'bpm', `average · highest ${a.hr.max}`));
    const pausedMs = Math.max(0, a.elapsedMs - a.movingMs);
    out.push(statTile('Total time', U.esc(fmtTime(a.elapsedMs)), '', pausedMs >= 60000 ? `${U.esc(fmtTime(pausedMs))} paused` : `${U.esc(U.fmtClock(a.start))} to ${U.esc(U.fmtClock(a.end))}`));
    if (a.maxMps > 0 && a.distanceM > 0) {
      const v = a.maxMps * 3600 / UNIT().m;
      out.push(isSpeed(a.type) ? statTile('Top speed', fmtSpeed(v), speedUnit(), 'held for 10 seconds or more') : statTile('Best pace', fmtPace(UNIT().m / a.maxMps), paceUnit(), 'held for 10 seconds or more'));
    }
    return `<div class="stat-grid as-grid" data-key="grid">${out.join('')}</div>`;
  }
  function splitsCard(a) {
    const list = (a.splits && a.splits[unitId()]) || [];
    if (!list.length || list.length === 1 && list[0].part) return '';
    const whole = list.filter((s) => !s.part && s.ms > 0);
    const fastest = whole.length ? whole.reduce((m, s) => (s.ms < m.ms ? s : m), whole[0]) : null;
    const paces = list.map((s) => (s.ms > 0 && s.m > 0 ? (s.ms / 1000) / (s.m / UNIT().m) : null));
    const best = Math.min(...paces.filter((p) => p)), worst = Math.max(...paces.filter((p) => p));
    const up = list.some((s) => s.up != null);
    const sp = isSpeed(a.type);
    return `<div class="card sp-card" data-key="splits" data-hue="${A().typeOf(a.type).hue}">
      <div class="ch-head"><span class="t-headline">Splits</span><span class="t-footnote rf-muted">per ${U.esc(UNIT().long)}</span></div>
      <table class="sp-tbl t-footnote rf-num">
        <thead><tr><th scope="col">${U.esc(U.cap(UNIT().short))}</th><th scope="col">${sp ? 'Speed' : 'Pace'}</th><th scope="col" class="sp-bar-h" aria-label="Compared"></th>${up ? `<th scope="col">Elev</th>` : ''}</tr></thead>
        <tbody>${list.map((s, i) => {
          const p = paces[i];
          // Longer bar = faster, from a sliver for your slowest to full for your fastest.
          const w = p && worst > best ? 25 + 75 * ((worst - p) / (worst - best)) : 100;
          const label = s.part ? distNum(s.m) : String(i + 1);
          const val = sp ? `${fmtSpeed(s.ms > 0 ? (s.m / UNIT().m) / (s.ms / 3600000) : null)}` : fmtPace(p);
          const net = s.up != null ? s.up - s.dn : null;
          const elev = up ? `<td>${net == null ? '–' : `${net > 0 ? '+' : net < 0 ? '−' : ''}${U.esc(fmtElev(Math.abs(net)).split(' ')[0])}`}</td>` : '';
          return `<tr${s === fastest ? ' class="is-best"' : ''}><th scope="row">${U.esc(label)}</th><td>${U.esc(val)}${s === fastest ? ` <span class="sp-best" role="img" aria-label="fastest">${U.icon('star', 'sm')}</span>` : ''}</td><td class="sp-bar"><span style="width:${w.toFixed(0)}%"></span></td>${elev}</tr>`;
        }).join('')}</tbody>
      </table>
      ${up ? `<p class="t-caption rf-muted">Elevation is the climb minus the drop in each ${U.esc(UNIT().long)}, in ${metric() ? 'metres' : 'feet'}.</p>` : ''}
    </div>`;
  }
  function hrCard(a) {
    const hc = a.hc || {};
    const can = A().canSession() && H().connected(H().status());
    const checking = !!busy.watch[a.id];
    if (a.hr) {
      return `<div class="card hr-card" data-key="hr">
        <div class="ch-head"><span class="t-headline">Heart rate</span><span class="ch-value t-callout rf-num">avg ${a.hr.avg} · max ${a.hr.max} bpm</span></div>
        ${hrChart(a)}
        <p class="t-subhead hz-title">Time in zones</p>
        ${zoneBars(a)}
        <p class="t-caption rf-muted">Zones are shares of a maximum of ${a.hr.hrMax} bpm, worked out from your age (208 − 0.7 × age, Tanaka 2001).${hc.sources && hc.sources.length ? ` From ${U.esc(hc.sources.map(prettySource).join(', '))}.` : ''}</p>
      </div>`;
    }
    if (!can) return '';
    const recent = Date.now() - a.end < 86400000;
    return `<div class="card hr-card" data-key="hr">
      <div class="ch-head"><span class="t-headline">Heart rate</span></div>
      <p class="t-callout rf-muted">${checking ? 'Checking Health Connect for your watch\'s data…' : hc.at ? `No heart rate from a watch for this time${recent ? ' yet. It can take a few minutes to reach Health Connect after you stop.' : '.'}` : 'Heart rate, steps and calories come from your watch through Health Connect.'}</p>
      ${checking ? '<span class="rf-spinner" data-size="sm"><i></i></span>' : `<div class="btn-row"><button type="button" class="rf-btn" data-size="sm" data-act="actWatch" data-arg="${U.esc(a.id)}">${U.icon('refresh')}${hc.at ? 'Check again' : 'Check now'}</button></div>`}
      ${hc.at ? `<p class="t-caption rf-muted">Checked <span data-ago="${hc.at}">${U.esc(U.ago(hc.at))}</span>.</p>` : ''}
    </div>`;
  }
  // "com.samsung.android.wear.shealth" → "Samsung Health"
  const SOURCES = { 'com.sec.android.app.shealth': 'Samsung Health', 'com.samsung.android.wear.shealth': 'Samsung Health', 'com.google.android.apps.fitness': 'Google Fit', 'com.fitbit.FitbitMobile': 'Fitbit', 'com.garmin.android.apps.connectmobile': 'Garmin Connect', 'com.google.android.apps.wearables.maestro.companion': 'Pixel Watch', 'com.withings.wiscale2': 'Withings', 'com.polar.polarflow': 'Polar Flow', 'com.suunto.connect': 'Suunto', 'com.huawei.health': 'Huawei Health', 'com.xiaomi.wearable': 'Mi Fitness', 'com.coros.coros': 'Coros', 'com.strava': 'Strava' };
  const prettySource = (s) => SOURCES[s] || String(s).split('.').filter((x) => !/^(com|android|app|apps)$/.test(x)).slice(-1)[0] || String(s);
  function hcCard(a) {
    const app = plat() && plat().isApp && plat().isApp();
    const st = H().status();
    const on = H().connected(st);
    if (!app) return `<div class="card as-hc" data-key="hc"><div class="as-hc-row"><span class="rf-list-icon" data-tone="rose">${U.icon('heart')}</span><span class="as-hc-text"><span class="t-headline">Health Connect</span><span class="t-footnote rf-muted">Saving to Health Connect works in the Android app.</span></span></div></div>`;
    if (!on) return `<div class="card as-hc" data-key="hc"><div class="as-hc-row"><span class="rf-list-icon" data-tone="rose">${U.icon('heart')}</span><span class="as-hc-text"><span class="t-headline">Health Connect</span><span class="t-footnote rf-muted">${st === 'unsupported' ? 'Health Connect needs Android 14 or newer.' : 'Connect it to save this and read your watch\'s heart rate.'}</span></span></div>${st === 'unsupported' || st === 'unavailable' ? '' : '<div class="btn-row"><button type="button" class="rf-btn" data-size="sm" data-act="hcConnect">Connect Health Connect</button></div>'}</div>`;
    const sv = a.saved || {};
    const saving = !!busy.save[a.id];
    let body;
    if (saving) body = '<span class="t-footnote rf-muted">Saving…</span>';
    else if (sv.ok) body = `<span class="t-footnote rf-muted">${sv.route === false ? 'Saved without the route. Allow exercise routes and it goes with it.' : 'Saved as an exercise session with your route. Your other health apps can see it.'}</span>`;
    else if (sv.error) body = `<span class="t-footnote rf-muted">Couldn't save it${sv.error === 'timeout' ? ': Health Connect took too long' : ''}. Try again in a moment.</span>`;
    else body = '<span class="t-footnote rf-muted">Saves it as an exercise session with your route, so your other health apps see it. The route goes to Health Connect only if you save it.</span>';
    const icon = sv.ok ? `<span class="rf-list-icon" data-tone="green">${U.icon('check-circle')}</span>` : `<span class="rf-list-icon" data-tone="rose">${U.icon('heart')}</span>`;
    return `<div class="card as-hc" data-key="hc"${sv.ok ? ' data-saved' : ''}>
      <div class="as-hc-row">${icon}<span class="as-hc-text"><span class="t-headline">${sv.ok ? 'Saved to Health Connect' : 'Health Connect'}</span>${body}</span></div>
      ${saving ? '' : sv.ok ? (sv.route === false && a.route ? `<div class="btn-row"><button type="button" class="rf-btn" data-variant="tinted" data-size="sm" data-act="actAllowRoutes" data-arg="${U.esc(a.id)}">Allow routes</button></div>` : '') : `<div class="btn-row"><button type="button" class="rf-btn" data-variant="filled" data-size="sm" data-act="actSave" data-arg="${U.esc(a.id)}">${sv.error ? 'Try again' : 'Save to Health Connect'}</button></div>`}
    </div>`;
  }
  U.screens.activity = {
    render(S, day, id) {
      const a = A().get(S, id);
      if (!a) return `${U.navbar('Activity', '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">Activity</h1><div class="section"><div class="card"><p class="t-callout rf-muted">This activity isn't here any more.</p></div></div>`;
      const tp = A().typeOf(a.type);
      const route = A().decodeRoute(a.route, a.start);
      return `${U.navbar(tp.label, U.glassBtn('more', 'Activity options', 'actMenu', `data-arg="${U.esc(a.id)}"`), U.glassBtn('chevron-left', 'Back', 'back'))}
        <div class="as-top" data-hue="${tp.hue}">
          <span class="as-type rf-list-icon" data-tone="${tp.hue}">${typeIcon(a.type)}</span>
          <div class="as-titles">
            <h1 class="rf-large-title as-title">${U.esc(a.title || A().defaultTitle(a.type, a.start))}</h1>
            <p class="t-callout rf-muted as-when">${U.esc(tp.label)} · ${U.esc(whenText(a))}</p>
          </div>
        </div>
        <div class="section">
          ${hero(a)}
          ${recordCards(a)}
          ${mapCard(a)}
          ${statGrid(a)}
        </div>
        ${splitsCard(a) || elevChart(a, route) ? `<h2 class="sec-title t-title-3">Pace and terrain</h2><div class="section">${splitsCard(a)}${elevChart(a, route)}</div>` : ''}
        ${hrCard(a) ? `<h2 class="sec-title t-title-3">From your watch</h2><div class="section">${hrCard(a)}</div>` : ''}
        <div class="section as-bottom">
          ${hcCard(a)}
          <ul class="rf-list">
            ${U.row({ icon: 'pencil', tone: 'sky', title: 'Rename', act: 'actRename', arg: a.id, chevron: true })}
            ${U.row({ icon: 'trash', tone: 'rose', title: `Delete this ${U.esc(tp.noun)}`, act: 'actDelete', arg: a.id })}
          </ul>
        </div>`;
    },
    after(root, S, day, id, changed) {
      const a = A().get(S, id);
      if (!a) return;
      if (streetsOn()) mountStreets(root, a);
      if (changed && (a.records || []).length && !U.reduced() && G.Refract && G.Refract.burst && !celebrated.has(a.id)) {
        celebrated.add(a.id);
        setTimeout(() => { const c = root.querySelector('.as-recs-head'); if (c) { try { G.Refract.burst(c, { count: 22 }); } catch (e) { /* ignore */ } } }, 420);
      }
    },
  };
  const celebrated = new Set();
  U.act.actOpen = (el) => { const id = el.dataset.arg; if (id && A().get(U.S, id)) U.open('activity', id); };
  U.act.actOsm = () => { if (plat()) plat().openUrl('https://www.openstreetmap.org/copyright'); };

  // Options: rename, delete. A menu that grows out of its button (U.menu).
  U.act.actMenu = (el) => {
    const a = A().get(U.S, el.dataset.arg || openId());
    if (!a) return;
    U.menu(el, [
      { act: 'actRename', arg: a.id, icon: 'pencil', label: 'Rename' },
      { act: 'actDelete', arg: a.id, icon: 'trash', label: `Delete this ${A().typeOf(a.type).noun}`, tone: 'critical' },
    ], { label: `${A().typeOf(a.type).label} options` });
  };
  U.act.actRename = (el) => {
    const a = A().get(U.S, el.dataset.arg || openId());
    if (!a) return;
    const top = U.topSheet(); if (top) top.close('ok');
    U.sheet({
      title: 'Rename', size: 'fit',
      body: `<div class="sheet-pad"><div class="rf-field"><label class="rf-field-label" for="actTitleIn">Name</label><div class="rf-field-control"><input class="rf-input" id="actTitleIn" maxlength="60" value="${U.esc(a.title || '')}" placeholder="${U.esc(A().defaultTitle(a.type, a.start))}" autofocus></div></div></div>`,
      action: { label: 'Save', act: 'actRenameSave', arg: a.id },
    });
  };
  U.act.actRenameSave = (el) => {
    const a = A().get(U.S, el.dataset.arg);
    const input = document.getElementById('actTitleIn');
    if (a && input) {
      a.title = (input.value || '').trim().slice(0, 60) || A().defaultTitle(a.type, a.start);
      H().rebuild(U.S, a.day);
      U.save();
      U.haptic('success');
    }
    const top = U.topSheet(); if (top) top.close('ok');
    U.render();
  };
  U.act.actDelete = async (el) => {
    const S = U.S;
    const a = A().get(S, el.dataset.arg || openId());
    if (!a) return;
    const top = U.topSheet(); if (top) top.close('ok');
    const noun = A().typeOf(a.type).noun;
    const saved = a.saved && a.saved.ok;
    if (!(await U.confirm(`Delete this ${noun}?`, saved ? 'It stays in Health Connect. You can delete it there too.' : 'Its route and numbers go, and your records are worked out again.', 'Delete', 'critical', 'trash'))) return;
    const gone = A().remove(S, a.id);
    // A light-day walk this activity ticked goes with it.
    const light = S.log.find((l) => l.type === 'light' && l.day === a.day && l.walk && l.walkSrc === 'activity');
    const others = A().list(S).some((x) => x.day === a.day && x.movingMs >= 600000);
    const unticked = light && !others;
    if (unticked) { light.walk = false; delete light.walkSrc; }
    U.save(true);
    if (U.route.view === 'activity') U.back(); else U.render();
    U.haptic('heavy');
    U.toast(`${U.cap(noun)} deleted`, 'neutral', undefined, {
      label: 'Undo',
      onClick: () => {
        if (U.S !== S || !A().restore(S, gone)) return;
        if (unticked) { light.walk = true; light.walkSrc = 'activity'; }
        U.save(true);
        U.render();
        U.haptic('undo');
      },
    });
  };

  /* ---------------------------------------------------------------- the street map */
  // Loaded only when someone taps Show streets (the tiles come from OpenFreeMap), and remembered.
  U.act.actStreets = () => {
    const S = U.S;
    const on = !streetsOn();
    S.profile.prefs.actStreets = on;
    if (!on) delete S.profile.prefs.actStreets;
    U.save();
    U.haptic(on ? 'toggleOn' : 'toggleOff');
    if (!on) for (const el of document.querySelectorAll('.am-streets')) unmount(el);
    U.render();
  };
  const maps = new WeakMap();
  function unmount(el) {
    const m = maps.get(el);
    if (m) { try { m.destroy(); } catch (e) { /* ignore */ } maps.delete(el); }
    el.textContent = '';
    el.removeAttribute('data-state');
    const box = el.closest('.am-box');
    if (box) box.removeAttribute('data-streets');
  }
  const cssVar = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
  function mountStreets(root, a) {
    const el = root.querySelector('.am-streets');
    if (!el || maps.has(el) || el.dataset.state === 'loading' || el.dataset.state === 'failed') return;
    const route = A().decodeRoute(a.route, a.start);
    if (route.length < 2) return;
    const box = el.closest('.am-box');
    el.dataset.state = 'loading';
    box.setAttribute('data-streets', 'loading');
    const { buckets } = paceBuckets(route);
    const colors = [0, 1, 2, 3, 4].map((b) => cssVar(box, `--pc${b}`));
    const dark = String(plat() ? plat().currentTheme() : '').startsWith('dark');
    GH.lazy('actmap').then((M) => {
      if (!el.isConnected || !streetsOn()) { el.dataset.state = ''; return; }
      const ctl = M.mount(el, {
        route, buckets, dark, colors, interactive: true,
        casing: cssVar(box, '--rt-case'), start: cssVar(box, '--rt-start'), end: cssVar(box, '--rt-end'), ring: cssVar(box, '--rt-ring'),
        onReady: () => { el.dataset.state = 'ready'; box.setAttribute('data-streets', 'ready'); },
        onFail: () => fail(),
      });
      maps.set(el, ctl);
    }).catch(() => fail());
    function fail() {
      const m = maps.get(el);
      if (m) { try { m.destroy(); } catch (e) { /* ignore */ } maps.delete(el); }
      el.textContent = '';
      el.dataset.state = 'failed';
      box.setAttribute('data-streets', 'failed');
      U.toast('Couldn\'t load the street map', 'caution', 'Check your connection. Your route is still here.');
    }
  }

  /* ---------------------------------------------------------------- Health Connect */
  const recent = (a) => Date.now() - a.end < 86400000;
  // The watch's heart rate, steps and calories for an activity. quiet: no toast (automatic checks).
  async function watchCheck(a, quiet) {
    const S = U.S;
    if (!a || busy.watch[a.id] || !A().canSession() || !H().connected(H().status())) return null;
    busy.watch[a.id] = true;
    rerender(a.id);
    let res = null;
    try { res = await A().hcSession(a); } catch (e) { res = { ok: false, error: 'failed' }; }
    busy.watch[a.id] = false;
    if (U.S !== S || !A().get(S, a.id)) return null;
    const tries = ((a.hc && a.hc.tries) || 0) + 1;
    if (res && res.ok) A().withWatch(S, a, res);
    else a.hc = Object.assign({}, a.hc || {}, { at: Date.now(), error: (res && res.error) || 'failed' });
    a.hc.tries = tries;
    a.records = A().newRecords(A().list(S), a);
    U.save();
    rerender(a.id);
    if (!quiet) {
      if (res && res.ok && a.hc.found) U.toast('Watch data added', 'positive', a.hr ? `Average heart rate ${a.hr.avg} bpm` : undefined);
      else if (res && res.ok) U.toast('Nothing from your watch yet', 'neutral', 'It can take a few minutes after you stop. Check again soon.');
      else U.toast('Couldn\'t read Health Connect', 'caution', res && res.error === 'timeout' ? 'It took too long. Try again.' : undefined);
    }
    // Saved earlier with our own distance or calories, and now the watch has them: save again
    // without ours, so Health Connect doesn't count them twice.
    const sv = a.saved;
    if (sv && sv.ok && ((sv.sentDistance && a.hc.distanceM > 0) || (sv.sentKcal && a.hc.activeKcal > 0))) saveHc(a, true);
    return res;
  }
  U.actWatchCheck = watchCheck;
  U.act.actWatch = (el) => { const a = A().get(U.S, el.dataset.arg); if (a) watchCheck(a, false); }; // what it finds plays its own
  async function saveHc(a, quiet) {
    const S = U.S;
    if (!a || busy.save[a.id]) return;
    if (!A().canWrite()) {
      const st = await H().request(S);
      S.health.status = st;
      if (!A().canWrite()) {
        if (!quiet) U.toast('Not allowed yet', 'caution', 'Turn on Exercise under Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() });
        return;
      }
    }
    const rec = A().writeRecord(a);
    busy.save[a.id] = true;
    rerender(a.id);
    let res = null;
    try { res = await A().hcWrite(a); } catch (e) { res = { ok: false, error: 'failed' }; }
    busy.save[a.id] = false;
    if (U.S !== S || !A().get(S, a.id)) return;
    a.saved = res && res.ok
      ? { at: Date.now(), ok: true, route: res.route !== false, sentDistance: typeof res.distance === 'boolean' ? res.distance : rec.distanceM != null, sentKcal: typeof res.activeKcal === 'boolean' ? res.activeKcal : rec.activeKcal != null }
      : { at: Date.now(), ok: false, error: String((res && res.error) || 'failed').slice(0, 60) };
    U.save();
    rerender(a.id);
    if (a.saved.ok) {
      if (!quiet) U.toast('Saved to Health Connect', 'positive', a.saved.route ? undefined : 'Without the route: allow exercise routes in Health Connect.');
      setTimeout(() => U.syncHealth('manual'), 2500);
    } else if (!quiet) U.toast('Couldn\'t save to Health Connect', 'caution', a.saved.error === 'timeout' ? 'It took too long. Try again.' : undefined);
  }
  U.actSaveHc = saveHc;
  U.act.actSave = (el) => { const a = A().get(U.S, el.dataset.arg); if (a) { U.haptic('tap'); saveHc(a, false); } };
  // Saved without its route (exercise routes weren't allowed, as for anyone who connected Health
  // Connect before activities): ask for the permissions, then save it again with the route.
  U.act.actAllowRoutes = async (el) => {
    const S = U.S, a = A().get(S, el.dataset.arg);
    if (!a) return;
    U.haptic('tap');
    S.health.status = await H().request(S);
    if (U.S !== S || !A().get(S, a.id)) return;
    const g = H().granted ? H().granted() : null;
    if (g && g.includes('writeRoute')) { a.saved = null; saveHc(a, false); }
    else U.toast('Routes are still off', 'caution', 'Allow exercise routes for Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() });
  };
  function rerender(id) { if (openId() === id && U.els().playerEl.hidden) U.render(); }
  // Straight after an activity: read the watch, then save it if saving workouts is on.
  U.actAfterFinish = async (a) => {
    const S = U.S;
    if (!H().connected(H().status())) return;
    await watchCheck(a, true);
    const x = A().get(S, a.id);
    if (x && !(x.saved && x.saved.ok) && S.health.write !== false && A().canWrite()) saveHc(x, true);
  };
  // The watch's data can reach Health Connect minutes after an activity: activities from the last
  // day that have none yet are checked again when the app opens (at most every 3 minutes, 8 times).
  let lastSweep = 0;
  U.actRecheck = () => {
    const S = U.S;
    if (!S || Date.now() - lastSweep < 60000 || !A().canSession() || !H().connected(H().status())) return;
    lastSweep = Date.now();
    const due = A().list(S).filter((a) => recent(a) && !(a.hc && a.hc.found) && (!a.hc || !a.hc.at || Date.now() - a.hc.at > 180000) && ((a.hc && a.hc.tries) || 0) < 8);
    (async () => {
      for (const a of due.slice(0, 3)) {
        await watchCheck(a, true);
        const x = A().get(S, a.id);
        if (x && x.hc && x.hc.found && !(x.saved && x.saved.ok) && S.health.write !== false && A().canWrite()) await saveHc(x, true);
      }
    })();
  };

  /* ---------------------------------------------------------------- records */
  // Every record, grouped by kind of activity: [{ type, items: [{ key, label, x, value, icon, tone }] }]
  // plus the most steps in one go. Fastest times come first, then the longest.
  const REC_LOOK = { time: ['bolt', 'amber'], dist: ['navigate', 'sky'], dur: ['timer', 'indigo'], steps: ['act-walk', 'green'] };
  function recordList(S) {
    const rec = A().records(A().list(S));
    const groups = [];
    for (const type of A().ORDER) {
      const r = rec.byType[type];
      if (!r) continue;
      const tp = A().typeOf(type);
      const items = [];
      const add = (key, kind, label, x, value) => items.push({ key, kind, label, x, value, icon: REC_LOOK[kind][0], tone: REC_LOOK[kind][1] });
      if (type === 'run') for (const [k, , label] of A().EFFORTS) if (r.best[k]) add(k, 'time', label, r.best[k], fmtTime(r.best[k].v));
      if (r.dist) add('dist', 'dist', `Longest ${tp.noun}`, r.dist, fmtDist(r.dist.v));
      if (r.time) add('time', 'dur', `Longest ${tp.noun} by time`, r.time, fmtTime(r.time.v));
      groups.push({ type, label: tp.label === 'Other' ? 'Other activities' : `${tp.label}s`, items });
    }
    const steps = rec.steps ? { key: 'steps', kind: 'steps', label: 'Most steps', x: rec.steps, value: U.num(rec.steps.v), icon: REC_LOOK.steps[0], tone: REC_LOOK.steps[1] } : null;
    return { groups, steps };
  }
  const recSub = (S, x) => `${U.fmtDay(B().dayOf(x.start, U.rollHour()), false)} · ${(A().get(S, x.id) || {}).title || ''}`;
  const recRow = (S, it) => U.row({ icon: it.icon, tone: it.tone, title: U.esc(it.label), sub: U.esc(recSub(S, it.x)), detail: U.esc(it.value), act: 'actOpen', arg: it.x.id, chevron: true });
  function recordRows(S) {
    const { groups, steps } = recordList(S);
    const out = groups.map((g) => `<h3 class="rf-list-header">${U.esc(g.label)}</h3><ul class="rf-list" data-key="rec-${g.type}">${g.items.map((it) => recRow(S, it)).join('')}</ul>`);
    if (steps) out.push(`<h3 class="rf-list-header">Any activity</h3><ul class="rf-list" data-key="rec-steps">${recRow(S, steps)}</ul>`);
    return out.join('');
  }
  // The highlights, as tiles: fastest 5 km, 1 km or mile (your units) and 10 km, then the longest of
  // each kind and the most steps; at most six.
  function recordTiles(S) {
    const { groups, steps } = recordList(S);
    const find = (type, key) => { const g = groups.find((x) => x.type === type); return g ? g.items.find((it) => it.key === key && (it.kind !== 'dur')) : null; };
    const pick = [find('run', '5k'), find('run', unitId() === 'km' ? '1k' : '1mi'), find('run', '10k'), find('run', 'half'), find('run', 'dist'), find('walk', 'dist'), find('cycle', 'dist'), find('hike', 'dist'), find('other', 'dist'), steps].filter(Boolean).slice(0, 6);
    return `<div class="stat-grid rec-tiles" data-key="rec-tiles">${pick.map((it) => `<button type="button" class="stat rec-tile" data-act="actOpen" data-arg="${U.esc(it.x.id)}">
      <span class="stat-top"><span class="rf-list-icon" data-tone="${it.tone}">${U.icon(it.icon)}</span><span class="t-footnote rf-muted">${U.esc(it.label)}</span></span>
      <span class="t-title-3 rf-num">${U.esc(it.value)}</span><span class="t-caption rf-muted">${U.esc(U.fmtDay(B().dayOf(it.x.start, U.rollHour()), false))}</span></button>`).join('')}</div>`;
  }
  // Progress: the highlights and a way into everything. The history page: every record.
  U.actRecordsSection = (S, compact) => {
    const n = A().list(S).length;
    const empty = `<div class="card" data-key="rec-none"><p class="t-callout rf-muted">Your bests show up here: fastest 1 km, mile, 5 km and 10 km, your longest walk, run and ride, and the most steps in one go.</p><div class="btn-row"><button type="button" class="rf-btn" data-size="sm" data-act="actStart">${U.icon('navigate')}Record a walk, run or ride</button></div></div>`;
    if (compact) {
      return `<h2 class="sec-title t-title-3">Personal records</h2>
        <div class="section act-records">
          ${n && recordList(S).groups.length ? recordTiles(S) : empty}
          ${n ? `<ul class="rf-list" data-key="act-all">${U.row({ icon: 'list', tone: 'sky', title: 'All activities and records', sub: U.plural(n, 'activity', 'activities'), act: 'actHistory', chevron: true })}</ul>` : ''}
        </div>`;
    }
    const rows = recordRows(S);
    return `<h2 class="sec-title t-title-3">Personal records</h2>
      <div class="section act-records">${rows ? `${rows}<p class="rf-list-footer">Your own bests from the activities you track. Fastest times come from runs, anywhere along the way.</p>` : empty}</div>`;
  };

  /* ---------------------------------------------------------------- history */
  let filter = 'all';
  function actRow(a) {
    const tp = A().typeOf(a.type);
    const detail = a.distanceM > 0 ? fmtDist(a.distanceM) : fmtTime(a.movingMs);
    const sub = [`${U.fmtDay(a.day)} · ${U.fmtClock(a.start)}`, a.distanceM > 0 ? fmtTime(a.movingMs) : ''].filter(Boolean).join(' · ');
    return U.row({ key: `a-${a.id}`, icon: tp.icon, tone: tp.hue, title: U.esc(a.title || A().defaultTitle(a.type, a.start)), sub: U.esc(sub), detail: U.esc(detail), act: 'actOpen', arg: a.id, chevron: true });
  }
  U.actRow = actRow;
  U.act.actHistory = () => U.open('activities');
  U.on.actFilter = (el, ev, v) => { filter = v || 'all'; U.render(); };
  U.screens.activities = {
    render(S, day) {
      const all = A().list(S);
      const types = A().ORDER.filter((t) => all.some((a) => a.type === t));
      if (filter !== 'all' && !types.includes(filter)) filter = 'all';
      const list = all.filter((a) => filter === 'all' || a.type === filter);
      const ws = B().weekStart(day);
      const sum = (from, to) => { const x = all.filter((a) => a.day >= from && a.day <= to && (filter === 'all' || a.type === filter)); return { n: x.length, m: x.reduce((s, a) => s + (a.distanceM || 0), 0), ms: x.reduce((s, a) => s + (a.movingMs || 0), 0) }; };
      const wk = sum(ws, ws + 6);
      const d0 = new Date(day * B().DAY_MS);
      const monthStart = day - (d0.getUTCDate() - 1);
      const mo = sum(monthStart, day);
      const groups = [];
      let month = null;
      for (const a of list) {
        const d = new Date(a.day * B().DAY_MS);
        const m = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        if (m !== month) { groups.push({ m, rows: [] }); month = m; }
        groups[groups.length - 1].rows.push(actRow(a));
      }
      return `${U.navbar('Activities', U.glassBtn('plus', 'Record a walk, run or ride', 'actStart'), U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Activities</h1>
        <div class="section">
          <div class="stat-row ah-totals" data-key="totals">
            <div class="stat"><span class="t-footnote rf-muted">This week</span><span class="t-title-3 rf-num">${U.esc(distNum(wk.m))} <small>${U.esc(UNIT().short)}</small></span><span class="t-caption rf-muted">${U.plural(wk.n, 'activity', 'activities')}</span></div>
            <div class="stat"><span class="t-footnote rf-muted">This month</span><span class="t-title-3 rf-num">${U.esc(distNum(mo.m))} <small>${U.esc(UNIT().short)}</small></span><span class="t-caption rf-muted">${U.esc(fmtTime(mo.ms))}</span></div>
            <div class="stat"><span class="t-footnote rf-muted">All time</span><span class="t-title-3 rf-num">${U.num(list.length)}</span><span class="t-caption rf-muted">${U.esc(fmtDist(list.reduce((s, a) => s + (a.distanceM || 0), 0)))}</span></div>
          </div>
          ${types.length > 1 ? U.choice('actFilter', [['all', 'All']].concat(types.map((t) => [t, A().typeOf(t).label])), filter, 'Show', ' class="ah-filter" data-hscroll data-on="actFilter"') : ''}
          ${groups.length ? groups.map((g) => `<h3 class="rf-list-header">${U.esc(g.m)}</h3><ul class="rf-list">${g.rows.join('')}</ul>`).join('') : `<div class="card" data-key="none"><p class="t-callout rf-muted">No activities yet. Start one from Today when you head out for a walk, run, hike or ride.</p><div class="btn-row"><button type="button" class="rf-btn" data-variant="filled" data-size="sm" data-act="actStart">${U.icon('navigate')}Record a walk, run or ride</button></div></div>`}
        </div>
        ${all.length ? U.actRecordsSection(S, false) : ''}`;
    },
  };

  /* ---------------------------------------------------------------- ways in */
  // Today: a card to start one (on a light day it offers to track the walk).
  U.actTodayCard = (S, day, plan) => {
    if (U.actIsLive && U.actIsLive()) return '';
    const last = A().list(S)[0];
    const lightWalk = plan && plan.type === 'light' && !(plan.light && plan.light.walk);
    const title = lightWalk ? 'Track today\'s walk' : 'Record a walk, run or ride';
    const sub = lightWalk ? 'With GPS. It ticks off the walk when you finish.' : last ? `Last: ${last.distanceM > 0 ? `${fmtDist(last.distanceM)} ` : ''}${A().typeOf(last.type).noun}, ${U.ago(last.end)}` : 'Time, distance and your route, with GPS';
    return `<button type="button" class="card act-cta tap-card" data-key="act-cta" data-act="actStart"${lightWalk ? ' data-arg="walk"' : ''}>
      <span class="act-cta-art" aria-hidden="true"><span data-tone="green">${U.icon('act-walk')}</span><span data-tone="coral">${U.icon('act-run')}</span><span data-tone="sky">${U.icon('act-cycle')}</span></span>
      <span class="act-cta-text"><span class="t-headline">${U.esc(title)}</span><span class="t-footnote rf-muted">${U.esc(sub)}</span></span>
      <span class="act-cta-go" aria-hidden="true">${U.icon('play')}</span>
    </button>`;
  };
  // Health: start one, and the activity list's rows for them.
  U.actHealthStart = (S) => `<ul class="rf-list" data-key="act-start">${U.row({ icon: 'navigate', tone: 'green', title: 'Record a walk, run or ride', sub: 'Time, distance and your route, with GPS', act: 'actStart', chevron: true })}${A().list(S).length ? U.row({ icon: 'list', tone: 'sky', title: 'All activities and records', act: 'actHistory', chevron: true }) : ''}</ul>`;
  U.actHealthRow = (x) => {
    const a = A().get(U.S, x.id);
    if (!a) return null;
    const tp = A().typeOf(a.type);
    return U.row({ icon: tp.icon, tone: tp.hue, title: U.esc(a.title || tp.label), sub: `${U.esc(U.fmtDay(a.day))} · ${a.distanceM > 0 ? U.esc(fmtDist(a.distanceM)) : 'Gradient Health'}`, detail: `${x.minutes} min`, act: 'actOpen', arg: a.id, chevron: true });
  };

  /* ---------------------------------------------------------------- boot */
  // After the app opens or comes back: recheck recent activities' watch data.
  if (plat() && plat().on) plat().on('resume', () => { if (U.S && U.S.profile.onboarded) setTimeout(() => U.actRecheck(), 1500); });
})(typeof window !== 'undefined' ? window : globalThis);
