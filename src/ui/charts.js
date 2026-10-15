/* Small charts drawn as SVG strings: bars, lines, dots and a 7-day average, with hairline axes,
 * labels in HTML (so they stay crisp and use the text tokens), a tap tooltip and a Numbers table.
 * spec: { title, value, fmt(v), from, to, zero?, series: [{ name, kind: bar|line|dot|avg, color, points: [{day,value}], span? }] }
 * Optional: key (a unique id when two charts could share a title), head: false (no title row),
 * table: false (no Numbers table), label (what the chart is, for screen readers). A bar series with
 * span: 7 draws each point as a bar a week wide (weekly averages on a year).
 * U.spark(points, { from, to, kind }) draws a sparkline for list rows.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {};
  const specs = {};
  const openTables = new Set();
  const W = 10;   // x units per day
  const HT = 100; // plot height in y units

  function rolling(points, from, to, n) {
    const byDay = new Map(points.map((p) => [p.day, p.value]));
    const out = [];
    for (let d = from; d <= to; d++) {
      const v = [];
      for (let k = d - n + 1; k <= d; k++) if (byDay.has(k)) v.push(byDay.get(k));
      if (v.length >= Math.min(3, n)) out.push({ day: d, value: v.reduce((a, b) => a + b, 0) / v.length });
    }
    return out;
  }
  U.rolling = rolling;

  function extent(spec) {
    let lo = Infinity, hi = -Infinity;
    for (const s of spec.series) for (const p of s.points) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
    if (!isFinite(lo)) return null;
    if (spec.zero) lo = 0;
    if (hi === lo) { hi += 1; lo = spec.zero ? 0 : lo - 1; }
    const pad = (hi - lo) * 0.08;
    return { lo: spec.zero ? 0 : lo - pad, hi: hi + pad };
  }

  function svg(spec, ex) {
    const n = spec.to - spec.from + 1;
    const w = n * W;
    const y = (v) => (HT - ((v - ex.lo) / (ex.hi - ex.lo)) * HT).toFixed(2);
    const x = (d) => ((d - spec.from) * W + W / 2).toFixed(2);
    const parts = [`<line class="ch-axis" x1="0" x2="${w}" y1="${HT}" y2="${HT}"/>`];
    for (const s of spec.series) {
      const pts = s.points.filter((p) => p.day >= spec.from && p.day <= spec.to);
      const col = `style="--c:${s.color || 'var(--label)'}"`;
      if (s.kind === 'bar') {
        const span = s.span || 1;
        const bw = Math.max(2, W * span * (span > 1 ? 0.72 : n > 60 ? 0.8 : 0.62));
        for (const p of pts) parts.push(`<rect class="ch-bar" ${col} x="${(Number(x(p.day + (span - 1) / 2)) - bw / 2).toFixed(2)}" y="${y(p.value)}" width="${bw.toFixed(2)}" height="${(HT - Number(y(p.value))).toFixed(2)}"/>`);
      } else if (s.kind === 'dot') {
        for (const p of pts) parts.push(`<line class="ch-dot" ${col} x1="${x(p.day)}" x2="${x(p.day)}" y1="${y(p.value)}" y2="${y(p.value)}"/>`);
      } else {
        // Lines break over gaps longer than 3 days instead of drawing through missing data. Sparse
        // series (tests, gym sessions) set their own gap.
        const gap = s.gap != null ? s.gap : 3;
        let d = '';
        let prev = null;
        for (const p of pts) {
          d += `${prev == null || p.day - prev > gap ? 'M' : 'L'}${x(p.day)} ${y(p.value)}`;
          prev = p.day;
        }
        if (d) parts.push(`<path class="ch-line${s.kind === 'avg' ? ' ch-avg' : ''}" ${col} d="${d}"/>`);
        if (s.kind === 'line' && pts.length <= 45) for (const p of pts) parts.push(`<line class="ch-dot ch-dot-sm" ${col} x1="${x(p.day)}" x2="${x(p.day)}" y1="${y(p.value)}" y2="${y(p.value)}"/>`);
      }
    }
    parts.push('<line class="ch-mark" x1="-10" x2="-10" y1="0" y2="100" visibility="hidden"/>');
    // Keyed by its range: a new range draws in fresh, other re-renders leave it alone.
    return `<svg class="ch-svg" data-key="svg-${spec.from}-${spec.to}" viewBox="0 0 ${w} ${HT}" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
  }

  // Ids come from the key or the title, so a chart keeps its identity (and its open table) across
  // re-renders; pass a key when another chart on screen could have the same title.
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  U.chartCard = (spec) => {
    const id = 'ch-' + slug(spec.key || spec.title);
    specs[id] = spec;
    const open = openTables.has(id);
    const fmt = spec.fmt || ((v) => U.num(v));
    const ex = extent(spec);
    const withTable = spec.table !== false;
    const legend = spec.series.length > 1 ? `<div class="ch-legend t-caption">${spec.series.map((s) => `<span class="ch-key"><i class="ch-swatch ch-swatch-${s.kind}" style="--c:${s.color || 'var(--label)'}"></i>${U.esc(s.name)}</span>`).join('')}</div>` : '';
    const body = ex
      ? `<div class="ch-plot" data-act="chartTap" data-arg="${id}" role="img" aria-label="${U.esc(spec.label || spec.title)} chart. Tap for values${withTable ? ', or open Numbers' : ''}.">
          <div class="ch-y t-caption rf-num"><span>${U.esc(fmt(ex.hi))}</span><span>${U.esc(fmt(ex.lo))}</span></div>
          ${svg(spec, ex)}
        </div>
        <div class="ch-x t-caption rf-num"><span>${U.esc(U.fmtDay(spec.from, false))}</span><span>${U.esc(U.fmtDay(spec.to, false))}</span></div>
        <div class="ch-tip t-footnote rf-num" aria-live="polite">Tap the chart for values.</div>`
      : '<p class="t-footnote rf-muted ch-empty">No data in this range yet.</p>';
    return `<div class="card ch-card${spec.cls ? ` ${spec.cls}` : ''}" data-chart="${id}" data-key="${id}">
      ${spec.head === false ? '' : `<div class="ch-head"><span class="t-headline">${U.esc(spec.title)}</span><span class="ch-value t-callout rf-num">${spec.value == null ? '' : U.esc(spec.value)}</span></div>`}
      ${legend}${body}
      ${ex && withTable ? `<button type="button" class="rf-btn ch-toggle" data-variant="plain" data-size="sm" data-act="chartTable" data-arg="${id}" aria-expanded="${open}">${open ? 'Hide numbers' : 'Numbers'}</button><div class="ch-table"${open ? '' : ' hidden'}>${open ? table(spec) : ''}</div>` : ''}
    </div>`;
  };

  // A sparkline for a list row: bars for daily totals, otherwise a line with a soft fill under it
  // and a dot on the newest value. Colour from --c (the row's hue). Lines break over gaps of more
  // than o.gap days (a week by default). Empty string with fewer than two values.
  U.spark = (points, o) => {
    const pts = points.filter((p) => p.day >= o.from && p.day <= o.to && isFinite(p.value));
    if (pts.length < 2) return '';
    const n = o.to - o.from + 1;
    const SW = 100, SH = 30, PAD = 3;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
    if (o.kind === 'bar') lo = 0;
    if (hi === lo) { hi += 1; lo -= o.kind === 'bar' ? 0 : 1; }
    const x = (d) => ((d - o.from + 0.5) / n) * SW;
    const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (SH - PAD * 2);
    const parts = [];
    if (o.kind === 'bar') {
      const bw = Math.max(0.8, (SW / n) * 0.62);
      for (const p of pts) { const top = y(p.value); parts.push(`<rect class="sp-bar" x="${(x(p.day) - bw / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.6, SH - PAD - top).toFixed(2)}" rx="${Math.min(0.9, bw / 2).toFixed(2)}"/>`); }
    } else {
      let line = '', area = '', run = [];
      const flush = () => {
        if (run.length > 1) area += `M${x(run[0].day).toFixed(2)} ${SH}` + run.map((p) => `L${x(p.day).toFixed(2)} ${y(p.value).toFixed(2)}`).join('') + `L${x(run[run.length - 1].day).toFixed(2)} ${SH}Z`;
        run = [];
      };
      let prev = null;
      const gap = o.gap || 7;
      for (const p of pts) {
        if (prev != null && p.day - prev > gap) flush();
        line += `${prev == null || p.day - prev > gap ? 'M' : 'L'}${x(p.day).toFixed(2)} ${y(p.value).toFixed(2)}`;
        run.push(p);
        prev = p.day;
      }
      flush();
      if (area) parts.push(`<path class="sp-area" d="${area}"/>`);
      parts.push(`<path class="sp-line" d="${line}"/>`);
      const last = pts[pts.length - 1];
      parts.push(`<line class="sp-dot" x1="${x(last.day).toFixed(2)}" x2="${x(last.day).toFixed(2)}" y1="${y(last.value).toFixed(2)}" y2="${y(last.value).toFixed(2)}"/>`);
    }
    return `<svg class="sp-svg${o.cls ? ` ${o.cls}` : ''}" viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
  };

  U.act.chartTap = (el, ev) => {
    const spec = specs[el.dataset.arg];
    if (!spec) return;
    const svgEl = el.querySelector('svg');
    const r = svgEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.9999, (ev.clientX - r.left) / r.width));
    const n = spec.to - spec.from + 1;
    let day = spec.from + Math.floor(frac * n);
    // Snap to the nearest day that has a value.
    const has = (d) => spec.series.some((s) => s.points.some((p) => p.day === d));
    for (let k = 0; k < n && !has(day); k++) { if (has(day - k)) { day -= k; break; } if (has(day + k)) { day += k; break; } }
    const fmt = spec.fmt || ((v) => U.num(v));
    const vals = spec.series.map((s) => { const p = s.points.find((q) => q.day === day); return p ? `${spec.series.length > 1 ? s.name + ' ' : ''}${fmt(p.value)}` : null; }).filter(Boolean);
    const card = el.closest('.ch-card');
    const tip = card.querySelector('.ch-tip');
    const label = spec.dayLabel ? spec.dayLabel(day) : U.fmtDay(day);
    tip.textContent = vals.length ? `${label}: ${vals.join(' · ')}` : `${label}: no data`;
    const mark = svgEl.querySelector('.ch-mark');
    const span = Math.max(1, ...spec.series.filter((s) => s.points.some((p) => p.day === day)).map((s) => s.span || 1));
    const x = ((day + (span - 1) / 2 - spec.from) * W + W / 2).toFixed(2);
    mark.setAttribute('x1', x); mark.setAttribute('x2', x); mark.setAttribute('visibility', 'visible');
    U.haptic('tick');
  };

  function table(spec) {
    const fmt = spec.fmt || ((v) => U.num(v));
    const days = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.day)))].filter((d) => d >= spec.from && d <= spec.to).sort((a, b) => b - a);
    return `<table class="ch-tbl t-footnote rf-num"><thead><tr><th scope="col">Day</th>${spec.series.map((s) => `<th scope="col">${U.esc(s.name)}</th>`).join('')}</tr></thead><tbody>${days.map((d) => `<tr><th scope="row">${U.esc(U.fmtDay(d))}</th>${spec.series.map((s) => { const p = s.points.find((q) => q.day === d); return `<td>${p ? U.esc(fmt(p.value)) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  }
  U.act.chartTable = (btn) => {
    const id = btn.dataset.arg;
    const spec = specs[id];
    const box = btn.nextElementSibling;
    if (!spec || !box) return;
    const open = box.hidden;
    U.haptic('tap');
    if (open) openTables.add(id); else openTables.delete(id);
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide numbers' : 'Numbers';
    box.innerHTML = open ? table(spec) : '';
    if (open && !U.reduced() && box.animate) box.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  };

  // Horizontal "done of target" bars (weekly sets per muscle).
  U.meterRows = (rows) => `<div class="meters">${rows.map((r) => {
    const max = Math.max(r.target, r.done, r.planned || 0, 1);
    return `<div class="meter"><div class="meter-top"><span class="t-subhead">${U.esc(r.name)}</span><span class="t-footnote rf-num rf-muted">${r.done} of ${r.target}${r.planned != null && r.planned < r.target ? ` · plan fits ${r.planned}` : ''}</span></div>
      <div class="meter-track" role="img" aria-label="${U.esc(r.name)}: ${r.done} of ${r.target} sets"><span class="meter-fill" style="width:${(Math.min(r.done, max) / max * 100).toFixed(1)}%"></span>${r.target ? `<span class="meter-target" style="left:${(r.target / max * 100).toFixed(1)}%"></span>` : ''}</div></div>`;
  }).join('')}</div>`;

  U.clearCharts = () => { for (const k of Object.keys(specs)) delete specs[k]; openTables.clear(); };
})(typeof window !== 'undefined' ? window : globalThis);
