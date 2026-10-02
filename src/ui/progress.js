/* Progress: the training picture. First your body: which muscles your training reaches and which
 * are getting stronger, on a front and back figure. Then your totals, what improved most, this week's
 * sets, the last 12 weeks, the left/right gap, strength trends for gym lifts, levels and the moments
 * worth celebrating. A tab, or a page opened from You, Today's streak and Plan when Food has the tab.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;
  const Y = () => GH.body;
  const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const RANGES = [[1, '1 week'], [4, '4 weeks'], [12, '12 weeks']];

  U.bodyView = U.bodyView || { mode: 'trained', weeks: 4 };
  const view = () => U.bodyView;
  const rangeText = (w) => (w === 1 ? 'last 7 days' : `last ${w} weeks`);
  const lower = (m) => Y().NAME[m].toLowerCase();
  const setsText = (v) => { const r = Math.round(v * 2) / 2; return `${U.num(r, r % 1 ? 1 : 0)} ${r === 1 ? 'set' : 'sets'}`; };
  const hasWorkouts = (S) => S.log.some((l) => l.type === 'workout');

  /* ---------------------------------------------------------------- your body */
  // Named muscles in the takeaway carry a swatch of their colour on the map.
  const named = (list, values, max) => list.map((m) => `<span class="bm-name"><i class="bm-sw" data-l="${U.bodyLevel(values[m], max)}"></i>${U.esc(lower(m))}</span>`).join(', ');

  function bodyCard(S, day, t, imp) {
    const { mode, weeks } = view();
    const values = {};
    for (const m of Y().MUSCLES) values[m] = mode === 'trained' ? t.sets[m] || 0 : Math.max(0, imp.score[m] || 0);
    const max = mode === 'trained' ? t.max : imp.max;
    const label = (m) => {
      const name = Y().NAME[m];
      if (mode === 'trained') return t.sets[m] > 0 ? `${name}: ${setsText(t.sets[m])}, ${Math.round(t.share[m] * 100)}% of your training` : `${name}: no sets`;
      const top = (imp.byMuscle[m] || []).find((l) => l.dir > 0);
      return imp.score[m] > 0 ? `${name}: went up ${U.plural(imp.ups[m] || 0, 'time')}${top ? `. ${top.text}` : ''}` : `${name}: ${t.sets[m] > 0 ? 'no progress yet' : 'not trained'}`;
    };
    // "Most: chest, triceps · Least: calves", as two halves that wrap as a whole when they must.
    const clause = (label, list) => `<span class="bm-clause">${label}: ${named(list, values, max)}</span>`;
    const SEP = '<span class="bm-vh"> · </span>';
    let take, target = null;
    if (mode === 'trained') {
      if (t.sum) { take = clause('Most', t.most.slice(0, 2)) + SEP + clause('Least', t.least.slice(0, 1)); target = t.least[0]; }
      else take = hasWorkouts(S) ? `No sets in the ${rangeText(weeks)}. Your next workout lights up the muscles it trains.` : 'Finish a workout and the muscles it trained light up here.';
    } else if (imp.max > 0) {
      take = clause('Most', imp.most.slice(0, 2)) + SEP + clause('Least', imp.least.slice(0, 1));
      target = imp.least[0];
    } else take = t.sum ? `No progress to show in the ${rangeText(weeks)} yet. It shows up here as your reps, weights and levels go up.` : 'Progress shows up here as your reps, weights and levels go up.';
    // Offer to train the least one more only when it's clearly behind, not in an even split.
    const main = Y().MUSCLES.filter((m) => !Y().MINOR.includes(m));
    const mean = main.reduce((a, m) => a + (t.sets[m] || 0), 0) / main.length;
    if (target && (mode === 'trained' ? (t.sets[target] || 0) >= mean / 2 : (imp.score[target] || 0) > imp.max / 4)) target = null;
    const more = target && U.act.tailorPlan
      ? `<button type="button" class="rf-btn bm-more" data-variant="soft" data-act="tailorPlan" data-arg="${U.esc(target)}">${U.icon('plus-circle')}Train ${U.esc(lower(target))} more</button>` : '';
    return `<div class="card bm-card" data-key="body" data-mode="${mode}">
      <div class="bm-head"><h2 class="t-title-3">Your body</h2><span class="t-footnote rf-muted">${mode === 'trained' ? 'Sets per muscle' : 'Progress per muscle'}, ${rangeText(weeks)}</span></div>
      ${U.seg('bodyMode', [['trained', 'Trained'], ['improved', 'Improved']], mode, 'Show', ' data-on="bodyMode"')}
      <div class="bm-range">${U.choice('bodyRange', RANGES, weeks, 'Range', ' data-on="bodyRange"')}</div>
      ${U.bodyMap(values, { mode, max, label, key: 'bm', listLabel: `Muscles, ${mode === 'trained' ? 'sets' : 'progress'} in the ${rangeText(weeks)}` })}
      ${U.bodyLegend(mode, mode === 'trained' ? 'No sets' : 'No progress')}
      <p class="bm-take t-callout" data-key="take">${take}</p>
      ${more}
    </div>`;
  }
  U.on.bodyMode = (el, ev, v) => { view().mode = v === 'improved' ? 'improved' : 'trained'; U.render(); };
  U.on.bodyRange = (el, ev, v) => {
    const w = Number(v);
    if (!RANGES.some(([x]) => x === w)) return;
    view().weeks = w;
    U.render();
  };

  // What improved most, per muscle group: the group's best lines and how much.
  function mostImproved(S, imp) {
    const { weeks } = view();
    const rows = B().GROUPS.map((g) => ({ g, x: imp.groups[g] })).filter((r) => r.x.score > 0).sort((a, b) => b.x.score - a.x.score).slice(0, 5);
    if (!rows.length) return `<div class="card" data-key="mi-none"><p class="t-callout rf-muted">${hasWorkouts(S) ? `Nothing went up in the ${rangeText(weeks)} yet. The muscle groups` : 'After a few workouts, the muscle groups'} getting stronger show here, with what changed: levels, weights and reps.</p></div>`;
    const vals = {};
    for (const m of Y().MUSCLES) vals[m] = Math.max(0, imp.score[m] || 0);
    return `<ul class="rf-list mi-list" data-key="mi">${rows.map(({ g, x }) => {
      const ups = x.lines.filter((l) => l.dir > 0);
      const top = ups[0];
      const own = {};
      for (const m of Y().MUSCLES) if (Y().GROUP_OF[m] === g) own[m] = vals[m];
      return `<li data-key="mi-${g}"><div class="rf-list-row mi-row">${U.bodyThumb(g, own, 'improved')}
        <span class="rf-list-text"><span class="rf-list-title">${U.esc(B().GROUP_NAME[g])}</span><span class="rf-list-sub">${ups.slice(0, 2).map((l) => U.progressText(l.text)).join(' · ') || U.esc(`Went up ${U.plural(x.ups, 'time')}`)}</span></span>
        ${top ? `<span class="rf-list-detail">${U.badge(top.delta, 'positive')}</span>` : ''}</div></li>`;
    }).join('')}</ul>
    <p class="rf-list-footer">${U.esc(U.cap(rangeText(weeks)))}. Tap the figure above for each muscle.</p>`;
  }

  /* ---------------------------------------------------------------- the rest */
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
    return `<div class="card" data-key="heatmap">
      <div class="row-between"><span class="t-headline">Last 12 weeks</span><span class="t-footnote rf-muted">${U.esc(U.fmtDay(first, false))} to ${U.esc(U.fmtDay(last + 6, false))}</span></div>
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
        series: [{ name: 'Gap', kind: 'line', color: 'var(--hue-coral)', points: pts, gap: 35 }, { name: '10% target', kind: 'avg', color: 'var(--label-tertiary)', points: [{ day: tests[0].day, value: 10 }, { day: Math.max(day, last.day), value: 10 }] }] });
    }
    const ms = (S.measurements || []).filter((m) => m.armL != null && m.armR != null);
    const arm = ms.length ? ms[ms.length - 1] : null;
    const u = S.profile.units === 'kg' ? 'cm' : 'in';
    const conv = (v) => (u === 'cm' ? v : v / 2.54).toFixed(1);
    return `<h2 class="sec-title t-title-3">Left vs right</h2>
      <div class="section"><div class="card lr" data-key="lr">
      ${last ? `<div class="lr-row"><span class="lr-side is-lead"><span class="t-caption">${U.side(side)}</span><span class="t-title-2 rf-num">${side === 'L' ? last.left : last.right}</span></span>
        <span class="lr-side"><span class="t-caption rf-muted">${U.side(other)}</span><span class="t-title-2 rf-num">${side === 'L' ? last.right : last.left}</span></span>
        <span class="lr-gap"><span class="t-caption rf-muted">Gap</span><span class="t-title-2 rf-num">${Math.round(last.gap * 100)}%</span></span></div>
        <p class="t-footnote rf-muted">Max curls on ${U.esc(U.fmtDay(last.day, false))}.</p>` : ''}
      ${arm ? `<p class="t-callout">Arms: ${U.side('L').toLowerCase()} ${conv(arm.armL)} ${u}, ${U.side('R').toLowerCase()} ${conv(arm.armR)} ${u}</p>` : ''}
      <p class="t-callout">${U.esc(status)}</p>
      <p class="t-footnote rf-muted">${due ? `Next test in ${U.plural(due, 'day')}, on an arm day.` : 'Next test: your next arm day.'}</p>
    </div>${chart}</div>`;
  }

  function weekSets(S, day) {
    const ws = B().weeklySets(S, day);
    const rows = B().GROUPS.filter((g) => ws[g] && ws[g].target > 0).map((g) => ({ name: B().GROUP_NAME[g], done: ws[g].done, target: ws[g].target, planned: ws[g].planned }));
    const short = rows.filter((r) => r.planned < r.target);
    return `<div class="card" data-key="sets"><div class="row-between"><span class="t-headline">Sets this week</span><span class="t-footnote rf-muted">done of target</span></div>
      ${U.meterRows(rows)}
      ${short.length ? `<p class="t-footnote rf-muted">Your time budget fits fewer sets than the target for ${U.esc(short.map((r) => r.name.toLowerCase()).join(', '))}. A few more minutes a session closes it.</p>` : ''}</div>`;
  }

  // Gym lifts: the estimated one-rep max over time, from the heaviest set and the reps left in the
  // tank (Epley). Up to three lifts, the most recently trained first.
  function strength(S, day) {
    const lifts = [];
    for (const st of Object.values(S.prog || {})) {
      if (!st || !st.gym || !st.e1rm) continue;
      for (const [id, e] of Object.entries(st.e1rm)) {
        const m = M().MOVES[id];
        if (m && e && (e.hist || []).length >= 2) lifts.push({ m, e });
      }
    }
    if (!lifts.length) return '';
    lifts.sort((a, b) => b.e.day - a.e.day || b.e.hist.length - a.e.hist.length);
    const u = S.profile.units === 'kg' ? 'kg' : 'lb';
    const cards = lifts.slice(0, 3).map(({ m, e }) => {
      const pts = e.hist.map(([d, v]) => ({ day: d, value: B().toUnit(v, u) }));
      const last = pts[pts.length - 1];
      return U.chartCard({ title: m.name, value: `${Math.round(last.value)} ${u}`, fmt: (v) => `${Math.round(v)} ${u}`, from: pts[0].day, to: Math.max(day, last.day),
        series: [{ name: 'Estimated max', kind: 'line', color: 'var(--hue-indigo)', points: pts, gap: 28 }] });
    });
    return `<h2 class="sec-title t-title-3">Strength</h2>
      <div class="section">${cards.join('')}<p class="t-footnote rf-muted">Your estimated one-rep max, worked out from your heaviest set and the reps you had left. Watch the trend; there's no need to test it.</p></div>`;
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

  // Everything so far: workouts, the streak, sets, time, level-ups and personal bests.
  function totals(S, day) {
    const x = U.profileStats(S, day);
    const tile = (label, value, sub) => `<div class="stat"><span class="t-footnote rf-muted">${U.esc(label)}</span><span class="t-title-2">${value}</span>${sub ? `<span class="t-caption rf-muted">${U.esc(sub)}</span>` : ''}</div>`;
    return `<div class="stat-grid" data-key="totals">
      ${tile('Workouts', U.roll(x.workouts, 't-title-2'), x.weeks ? `${U.plural(x.weeks, 'week')} with training` : 'Your first is waiting')}
      ${tile('Streak', `${U.roll(x.current)} <small>days</small>`, x.best > x.current ? `Best ${x.best}` : x.current ? 'Your best so far' : 'Starts with the next one')}
      ${tile('Sets done', U.roll(U.num(x.sets)), 'Across every workout')}
      ${tile('Time trained', U.esc(x.minutes ? U.fmtTrained(x.minutes) : '0 min'), 'In the workout player')}
      ${tile('Level-ups', U.roll(x.ups), 'Harder moves and heavier weights')}
      ${tile('Personal bests', U.roll(x.prs), 'Best sets beaten')}
    </div>`;
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
      const trained = Y().trained(S, day, view().weeks);
      const improved = Y().improved(S, day, view().weeks);
      // A page (with Back) when it's opened on top of another tab.
      const asPage = U.route && U.route.view === 'progress';
      return `${U.navbar('Progress', '', asPage ? U.glassBtn('chevron-left', 'Back', 'back') : '')}
        <h1 class="rf-large-title">Progress</h1>
        <div class="section">
          ${U.tip ? U.tip('progress') : ''}
          ${bodyCard(S, day, trained, improved)}
        </div>
        <h2 class="sec-title t-title-3">Totals</h2>
        <div class="section">${totals(S, day)}</div>
        <h2 class="sec-title t-title-3">Most improved</h2>
        <div class="section">${mostImproved(S, improved)}</div>
        <h2 class="sec-title t-title-3">Training</h2>
        <div class="section">
          ${weekSets(S, day)}
          ${heatmap(S, day, cal)}
        </div>
        ${U.actRecordsSection ? U.actRecordsSection(S, true) : ''}
        ${strength(S, day)}
        ${leftRight(S, day)}
        <h2 class="sec-title t-title-3">Levels</h2>
        <div class="section">${bests(S, day)}</div>
        <h2 class="sec-title t-title-3">Moments</h2>
        <div class="section">${moments(S)}</div>`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
