/* Small charts drawn as SVG strings: bars, lines, dots and a 7-day average, with hairline axes,
 * labels in HTML (so they stay crisp and use the text tokens), a tap tooltip and a Numbers table.
 * spec: { title, value, fmt(v), from, to, zero?, series: [{ name, kind: bar|line|dot|avg, color, points: [{day,value}] }] }
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {};
  const specs = {};
  let seq = 0;
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
        const bw = Math.max(2, W * (n > 60 ? 0.8 : 0.62));
        for (const p of pts) parts.push(`<rect class="ch-bar" ${col} x="${(Number(x(p.day)) - bw / 2).toFixed(2)}" y="${y(p.value)}" width="${bw.toFixed(2)}" height="${(HT - Number(y(p.value))).toFixed(2)}"/>`);
      } else if (s.kind === 'dot') {
        for (const p of pts) parts.push(`<line class="ch-dot" ${col} x1="${x(p.day)}" x2="${x(p.day)}" y1="${y(p.value)}" y2="${y(p.value)}"/>`);
      } else {
        // Lines break over gaps longer than 3 days instead of drawing through missing data.
        let d = '';
        let prev = null;
        for (const p of pts) {
          d += `${prev == null || p.day - prev > 3 ? 'M' : 'L'}${x(p.day)} ${y(p.value)}`;
          prev = p.day;
        }
        if (d) parts.push(`<path class="ch-line${s.kind === 'avg' ? ' ch-avg' : ''}" ${col} d="${d}"/>`);
        if (s.kind === 'line' && pts.length <= 45) for (const p of pts) parts.push(`<line class="ch-dot ch-dot-sm" ${col} x1="${x(p.day)}" x2="${x(p.day)}" y1="${y(p.value)}" y2="${y(p.value)}"/>`);
      }
    }
    parts.push('<line class="ch-mark" x1="-10" x2="-10" y1="0" y2="100" visibility="hidden"/>');
    return `<svg class="ch-svg" viewBox="0 0 ${w} ${HT}" preserveAspectRatio="none" aria-hidden="true">${parts.join('')}</svg>`;
  }

  U.chartCard = (spec) => {
    const id = 'ch' + (++seq);
    specs[id] = spec;
    const fmt = spec.fmt || ((v) => U.num(v));
    const ex = extent(spec);
    const legend = spec.series.length > 1 ? `<div class="ch-legend t-caption">${spec.series.map((s) => `<span class="ch-key"><i class="ch-swatch ch-swatch-${s.kind}" style="--c:${s.color || 'var(--label)'}"></i>${U.esc(s.name)}</span>`).join('')}</div>` : '';
    const body = ex
      ? `<div class="ch-plot" data-act="chartTap" data-arg="${id}" role="img" aria-label="${U.esc(spec.title)} chart. Tap for values, or open Numbers.">
          <div class="ch-y t-caption rf-num"><span>${U.esc(fmt(ex.hi))}</span><span>${U.esc(fmt(ex.lo))}</span></div>
          ${svg(spec, ex)}
        </div>
        <div class="ch-x t-caption rf-num"><span>${U.esc(U.fmtDay(spec.from, false))}</span><span>${U.esc(U.fmtDay(spec.to, false))}</span></div>
        <div class="ch-tip t-footnote rf-num" aria-live="polite">Tap the chart for values.</div>`
      : '<p class="t-footnote rf-muted ch-empty">No data in this range yet.</p>';
    return `<div class="card ch-card" data-chart="${id}">
      <div class="ch-head"><span class="t-headline">${U.esc(spec.title)}</span><span class="ch-value t-callout rf-num">${spec.value == null ? '' : U.esc(spec.value)}</span></div>
      ${legend}${body}
      ${ex ? `<button type="button" class="rf-btn ch-toggle" data-variant="plain" data-size="sm" data-act="chartTable" data-arg="${id}" aria-expanded="false">Numbers</button><div class="ch-table" hidden></div>` : ''}
    </div>`;
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
    tip.textContent = vals.length ? `${U.fmtDay(day)}: ${vals.join(' · ')}` : `${U.fmtDay(day)}: no data`;
    const mark = svgEl.querySelector('.ch-mark');
    const x = ((day - spec.from) * W + W / 2).toFixed(2);
    mark.setAttribute('x1', x); mark.setAttribute('x2', x); mark.setAttribute('visibility', 'visible');
  };

  U.act.chartTable = (btn) => {
    const spec = specs[btn.dataset.arg];
    const box = btn.nextElementSibling;
    if (!spec || !box) return;
    const open = box.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide numbers' : 'Numbers';
    if (!open) return;
    const fmt = spec.fmt || ((v) => U.num(v));
    const days = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.day)))].filter((d) => d >= spec.from && d <= spec.to).sort((a, b) => b - a);
    box.innerHTML = `<table class="ch-tbl t-footnote rf-num"><thead><tr><th scope="col">Day</th>${spec.series.map((s) => `<th scope="col">${U.esc(s.name)}</th>`).join('')}</tr></thead><tbody>${days.map((d) => `<tr><th scope="row">${U.esc(U.fmtDay(d))}</th>${spec.series.map((s) => { const p = s.points.find((q) => q.day === d); return `<td>${p ? U.esc(fmt(p.value)) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
  };

  // Horizontal "done of target" bars (weekly sets per muscle).
  U.meterRows = (rows) => `<div class="meters">${rows.map((r) => {
    const max = Math.max(r.target, r.done, r.planned || 0, 1);
    return `<div class="meter"><div class="meter-top"><span class="t-subhead">${U.esc(r.name)}</span><span class="t-footnote rf-num rf-muted">${r.done} of ${r.target}${r.planned != null && r.planned < r.target ? ` · plan fits ${r.planned}` : ''}</span></div>
      <div class="meter-track" role="img" aria-label="${U.esc(r.name)}: ${r.done} of ${r.target} sets"><span class="meter-fill" style="width:${(Math.min(r.done, max) / max * 100).toFixed(1)}%"></span>${r.target ? `<span class="meter-target" style="left:${(r.target / max * 100).toFixed(1)}%"></span>` : ''}</div></div>`;
  }).join('')}</div>`;

  U.clearCharts = () => { for (const k of Object.keys(specs)) delete specs[k]; };
})(typeof window !== 'undefined' ? window : globalThis);
