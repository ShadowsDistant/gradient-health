/* Progress: the training picture. Heat map of the last 12 weeks, the left/right gap, this week's
 * sets against target, bests per ladder and the moments worth celebrating.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;
  const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function heatmap(S, day, cal) {
    const last = B().weekStart(day);
    const first = last - 7 * 11;
    const cols = [];
    for (let ws = first; ws <= last; ws += 7) {
      const cells = [];
      for (let d = ws; d < ws + 7; d++) {
        const i = cal.days[d];
        let k = 'none', label = 'nothing planned';
        if (d > day) {
          const wk = cal.weeks[B().weekStart(d)];
          const planned = wk && wk.sessions.some((x) => x.day === d && !x.dropped);
          k = planned ? 'plan' : 'future'; label = planned ? 'workout planned' : 'coming up';
        } else if (i) {
          if (i.done && i.planned === 'workout') { k = 'work'; label = 'workout done'; }
          else if (i.done) { k = 'light'; label = 'light day done'; }
          else if (i.missed) { k = i.frozen ? 'freeze' : 'miss'; label = i.frozen ? 'missed, freeze used' : 'missed'; }
          else if (i.planned === 'workout' && d === day) { k = 'plan'; label = 'workout today'; }
          else if (i.planned === 'none') { k = 'none'; label = 'before you started'; }
          else { k = 'rest'; label = 'light day not done'; }
        }
        cells.push(`<i class="hm-cell hm-${k}${d === day ? ' hm-today' : ''}" title="${U.esc(U.fmtDay(d))}: ${label}" aria-label="${U.esc(U.fmtDay(d))}: ${label}"></i>`);
      }
      cols.push(`<div class="hm-col">${cells.join('')}</div>`);
    }
    return `<div class="card">
      <div class="row-between"><span class="t-headline">Last 12 weeks</span><span class="t-footnote rf-muted">${U.esc(U.fmtDay(first, false))} – ${U.esc(U.fmtDay(last + 6, false))}</span></div>
      <div class="hm" role="img" aria-label="Calendar of the last 12 weeks"><div class="hm-days t-caption rf-muted">${WD.map((d) => `<span>${d}</span>`).join('')}</div><div class="hm-grid">${cols.join('')}</div></div>
      <div class="hm-legend t-caption">${[['work', 'Workout'], ['light', 'Light day'], ['freeze', 'Freeze'], ['miss', 'Missed'], ['plan', 'Planned']].map(([k, t]) => `<span><i class="hm-cell hm-${k}"></i>${t}</span>`).join('')}</div>
    </div>`;
  }

  function leftRight(S, day) {
    const c = S.catchup.arm;
    const tests = c.tests || [];
    const side = c.side || 'L';
    const other = side === 'L' ? 'R' : 'L';
    const last = tests[tests.length - 1];
    const lastDay = last ? last.day : S.profile.startDay;
    const due = Math.max(0, 14 - (day - lastDay));
    if (!tests.length && !c.active) return '';
    const status = c.active ? `Extra ${U.side(side).toLowerCase()} set: on, until the gap is under 10%.` : `Extra ${U.side(side).toLowerCase()} set: off. It comes back if the gap reaches 15%.`;
    let chart = '';
    if (tests.length >= 2) {
      const pts = tests.map((t) => ({ day: t.day, value: t.gap * 100 }));
      chart = U.chartCard({ title: 'Curl gap over time', value: `${Math.round(last.gap * 100)}%`, fmt: (v) => `${Math.round(v)}%`, from: tests[0].day, to: Math.max(day, last.day), zero: true,
        series: [{ name: 'Gap', kind: 'line', color: 'var(--hue-coral)', points: pts }, { name: '10% target', kind: 'avg', color: 'var(--label-tertiary)', points: [{ day: tests[0].day, value: 10 }, { day: Math.max(day, last.day), value: 10 }] }] });
    }
    const ms = (S.measurements || []).filter((m) => m.armL != null && m.armR != null);
    const arm = ms.length ? ms[ms.length - 1] : null;
    const u = S.profile.units === 'kg' ? 'cm' : 'in';
    const conv = (v) => (u === 'cm' ? v : v / 2.54).toFixed(1);
    return `<div class="card lr">
      <span class="t-headline">Left vs right</span>
      ${last ? `<div class="lr-row"><span class="lr-side is-lead"><span class="t-caption">${U.side(side)}</span><span class="t-title-2 rf-num">${side === 'L' ? last.left : last.right}</span></span>
        <span class="lr-side"><span class="t-caption rf-muted">${U.side(other)}</span><span class="t-title-2 rf-num">${side === 'L' ? last.right : last.left}</span></span>
        <span class="lr-gap"><span class="t-caption rf-muted">Gap</span><span class="t-title-2 rf-num">${Math.round(last.gap * 100)}%</span></span></div>
        <p class="t-footnote rf-muted">Max curls on ${U.esc(U.fmtDay(last.day, false))}.</p>` : ''}
      ${arm ? `<p class="t-callout">Arms: ${U.side('L').toLowerCase()} ${conv(arm.armL)} ${u}, ${U.side('R').toLowerCase()} ${conv(arm.armR)} ${u}</p>` : ''}
      <p class="t-callout">${U.esc(status)}</p>
      <p class="t-footnote rf-muted">${due ? `Next test in ${U.plural(due, 'day')}, on an arm day.` : 'Next test: your next arm day.'}</p>
    </div>${chart}`;
  }

  function weekSets(S, day) {
    const ws = B().weeklySets(S, day);
    const rows = B().GROUPS.filter((g) => ws[g] && ws[g].target > 0).map((g) => ({ name: B().GROUP_NAME[g], done: ws[g].done, target: ws[g].target, planned: ws[g].planned }));
    const short = rows.filter((r) => r.planned < r.target);
    return `<div class="card"><div class="row-between"><span class="t-headline">Sets this week</span><span class="t-footnote rf-muted">done of target</span></div>
      ${U.meterRows(rows)}
      ${short.length ? `<p class="t-footnote rf-muted">Your time budget fits fewer sets than the target for ${U.esc(short.map((r) => r.name.toLowerCase()).join(', '))}. A few more minutes a session closes it.</p>` : ''}</div>`;
  }

  function bests(S, day) {
    const rows = [];
    for (const [fam, lad] of Object.entries(M().LADDERS)) {
      const st = S.prog[fam];
      if (!st || fam === 'finisher') continue;
      const lv = B().ladderLevel(S, fam, day);
      if (!lv || lv.level < 1) continue;
      const mv = M().MOVES[st.rung];
      const best = Math.max(0, ...Object.entries(st.best || {}).filter(([id]) => id === st.rung).map(([, v]) => v));
      rows.push(U.row({ title: U.esc(lad.name), sub: `${U.esc(mv.name)} · level ${lv.level} of ${lv.of}`, detail: best ? U.esc(U.target(mv, best)) : '', act: 'ladder', arg: fam, chevron: true }));
    }
    return `<ul class="rf-list">${rows.join('')}</ul><p class="t-footnote rf-muted">Detail shows your best set at the current level.</p>`;
  }

  function moments(S) {
    const list = [];
    for (const l of S.log) if (l.type === 'workout') for (const c of l.celebrate || []) list.push({ day: l.day, c });
    list.sort((a, b) => b.day - a.day);
    if (!list.length) return '<p class="t-callout rf-muted">Level-ups, heavier weights and personal bests show up here.</p>';
    return `<ul class="rf-list">${list.slice(0, 12).map((x) => U.row({ icon: x.c.kind === 'pr' ? 'star' : x.c.kind === 'weight' ? 'bolt' : 'sparkle', tone: x.c.kind === 'pr' ? 'amber' : 'green', title: U.esc(x.c.text), sub: U.esc(U.fmtDay(x.day)) })).join('')}</ul>`;
  }

  U.screens.progress = {
    render(S, day) {
      const cal = B().calendar(S, day);
      const done = S.log.filter((l) => l.type === 'workout' && B().isDone(l)).length;
      const ups = S.log.reduce((a, l) => a + (l.celebrate || []).filter((c) => c.kind !== 'pr').length, 0);
      return `${U.navbar('Progress')}
        <h1 class="rf-large-title">Progress</h1>
        <div class="section">
          <div class="stat-row">
            <div class="stat"><span class="t-footnote rf-muted">Workouts</span><span class="t-title-2 rf-num">${done}</span></div>
            <div class="stat"><span class="t-footnote rf-muted">Best streak</span><span class="t-title-2 rf-num">${cal.streak.best}</span></div>
            <div class="stat"><span class="t-footnote rf-muted">Level-ups</span><span class="t-title-2 rf-num">${ups}</span></div>
          </div>
          ${heatmap(S, day, cal)}
          ${leftRight(S, day)}
          ${weekSets(S, day)}
        </div>
        <h2 class="sec-title t-title-3">Levels</h2>
        <div class="section">${bests(S, day)}</div>
        <h2 class="sec-title t-title-3">Moments</h2>
        <div class="section">${moments(S)}</div>`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
