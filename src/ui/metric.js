/* The metric sheet: one number from the Health tab in full. The latest value, where it came from
 * and how it compares with the person's usual; a chart over 7 days to a year; the average, lowest,
 * highest and change; every day's value, with the person's own entries to change or remove; Add or
 * change (your number replaces Health Connect's for that day); and what the number means.
 *
 * U.metricSheet(key) opens it (keys from GH.health.METRICS, plus 'feel'); U.metricEdit(key, day)
 * opens just the Add or change form (the + menu's Log weight and Log sleep use it). The pieces the
 * Health tab shares (values, trend chips, glance pills) are here too.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const M = (key) => H().METRICS[key];

  /* ---------------------------------------------------------------- shared pieces */
  const ARROWS = { up: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>', down: '<path d="M12 5v13.5M6.5 13 12 18.5l5.5-5.5"/>', flat: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>' };
  U.trendArrow = (dir) => `<svg class="hl-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ARROWS[dir] || ARROWS.flat}</svg>`;
  // Which way a trend string points: "+20 min", "-9%", "↓ 0.3", "steady"; 'none' for words like
  // "on plan" that aren't a direction.
  const dirOf = (t) => (/^(\+|↑|up\b)/i.test(t) ? 'up' : /^(-|−|↓|down\b)/i.test(t) ? 'down' : /^(steady|flat|same|→)/i.test(t) ? 'flat' : 'none');
  // A trend chip: an arrow and the amount, coloured by how it's going. g: { trend, dir?, tone }.
  U.trendChip = (g) => {
    const t = String(g.trend || '').trim();
    if (!t) return '';
    const dir = g.dir || dirOf(t);
    const text = t.replace(/^[+\-−↑↓→]\s*/, '');
    return `<span class="hl-trend" data-state="${U.esc(g.tone || 'neutral')}" data-dir="${dir}">${dir === 'none' ? '' : U.trendArrow(dir)}<span>${U.esc(text)}</span></span>`;
  };
  // A value for display, with its unit in smaller type. roll: numbers roll to a new value on re-render.
  U.metricNum = (S, key, v, roll) => `<span class="mv">${H().formatParts(S, key, v).map((p) => (p.u ? `<small>${U.esc(p.t)}</small>` : roll ? U.roll(p.t) : `<span class="rf-num">${U.esc(p.t)}</span>`)).join('')}</span>`;
  // One of "this week's" numbers: metric, value, trend chip. Opens its metric sheet when act is set.
  U.metricPill = (g, act) => {
    const tone = g.key && M(g.key) ? M(g.key).tone : null;
    const tag = act && g.key && M(g.key) ? 'button' : 'span';
    return `<${tag}${tag === 'button' ? ` type="button" data-act="${act}" data-arg="${U.esc(g.key)}"` : ''} class="hl-pill" data-state="${U.esc(g.tone || 'neutral')}"${tone ? ` data-tone="${tone}"` : ''}>
      <span class="hl-pill-k">${U.esc(g.metric)}</span>
      <span class="hl-pill-v rf-num">${U.esc(g.value)}</span>
      ${g.trend ? U.trendChip(g) : '<span class="hl-trend" data-state="neutral" data-dir="none"><span>this week</span></span>'}
    </${tag}>`;
  };
  // "Today", "Yesterday", "Mon, Oct 12" (sleep: "Last night").
  U.dayName = (d, today, key) => {
    if (d === today) return key === 'sleepMin' ? 'Last night' : 'Today';
    if (d === today - 1) return key === 'sleepMin' ? 'The night before' : 'Yesterday';
    return U.fmtDay(d);
  };
  const SRC_ICON = { hc: 'heart', manual: 'pencil', est: 'wave', chip: 'check-circle', app: 'bolt', food: 'food' };

  /* ---------------------------------------------------------------- what each number means */
  const WHY_MISSING = ['Gradient Health can only show what your watch or phone app shares with Health Connect. Some apps don\'t share resting heart rate or HRV at all (Samsung Health and Garmin Connect, right now), even though they show them in their own app.',
    'To check, open Health Connect, then App permissions, pick your watch app and make sure it\'s allowed to write the data you want.'];
  const ESTIMATE = ['Your watch app shares heart rate but not a resting value, so Gradient Health works one out: it averages your heart rate over each half hour and takes the lowest half hour of the day. If you wear your watch in bed, that\'s deep sleep, close to what watches call resting heart rate.',
    'A day whose lowest half hour isn\'t at night is skipped, because it usually means the watch was off overnight. Use it to compare your days with each other; it can sit a few beats off your watch app\'s number.'];
  const ABOUT = {
    sleepMin: (S) => ['Time asleep, from your watch or phone app through Health Connect, from your check-in, or what you add here. A night counts toward the morning you wake up.',
      `Most adults do best on 7 hours or more. A steady bedtime, weekends included, helps more than catching up.${S.profile.workouts !== false ? ' A night under 5 hours takes a set off the next day\'s workout.' : ''}`],
    steps: (S) => { const g = B().stepsGoal(S, U.today()); return ['Steps from Health Connect for each calendar day, or what you add here.', `Your goal, ${U.num(g.goal)} a day, comes from your own usual: about 10% above it, between 5,000 and 10,000. In large studies the benefit kept growing up to about 8,000-10,000 steps a day.`]; },
    rhr: (S, est) => ['Your heart rate at complete rest, usually measured while you sleep. It\'s lower when you\'re fitter.', `A few beats above your usual can mean poor sleep, stress, alcohol or an illness coming on.${S.profile.workouts !== false ? ' The app takes a set off when that happens.' : ''} Over 100 at rest is worth checking with a doctor.`].concat(est ? ESTIMATE : []),
    hrv: () => ['Heart rate variability: how much the time between heartbeats varies, in milliseconds. Above your usual often means you\'re well recovered; well below it often follows poor sleep, stress or a run of hard days.', 'It differs a lot from person to person, so only compare yourself with yourself.'],
    weightKg: () => ['Day-to-day swings are mostly water and food, so watch the 7-day average, not single weigh-ins.', 'Weigh in the morning, after the bathroom and before breakfast, a few times a week. A weight you add here replaces Health Connect\'s for that day.'],
    bodyFat: () => ['From a smart scale that shares with Health Connect. Scales estimate body fat from a small electric current, so single readings jump around; the trend over weeks means more.'],
    activeKcal: () => ['Calories burned by moving, on top of what your body burns at rest, as counted by your watch or phone.'],
    distanceM: () => ['How far you walked, ran or rode each day, from Health Connect.'],
    activeMin: (S) => [`Minutes of exercise: workouts in Gradient Health, workouts other apps share with Health Connect, and activities you log with the + button.${S.profile.workouts !== false ? ' 45 minutes or more of hard exercise means easier legs and no finisher the next day.' : ''}`],
    kcalIn: () => ['Everything you log on the Food tab, plus meals other apps share with Health Connect when that\'s on.'],
    protein: (S) => { const g = B().proteinGoal(S, U.today()); return [`Protein from your quick adds and the food you log.${g ? ` Your goal is ${g} g a day, from your weight.` : ''} Past about 1.6 g per kg of body weight, extra protein adds little for most people.`]; },
    measure: () => ['Measure once a month, at the same time of day, relaxed, with the tape snug but not tight. Waist at the belly button; arms flexed, at the widest point.', 'Waist size tracks belly fat better than the scale does.'],
    feel: () => ['A two-tap check-in: your energy and how sore you are. Low energy or a lot of soreness makes the day\'s workout a little lighter.'],
  };
  const aboutOf = (S, key, est) => (ABOUT[key] || (M(key) && M(key).group === 'measure' ? ABOUT.measure : () => []))(S, est);

  /* ---------------------------------------------------------------- the sheet */
  const RANGES = [['7', '7 days'], ['28', '28 days'], ['90', '90 days'], ['365', '1 year']];
  const st = { ctl: null, key: null, range: 28, more: false };
  const LIST_MAX = 14;

  // The chart for a range: bars for daily totals (weekly averages on a year), lines or weigh-ins
  // otherwise, with a 7-day average where days vary a lot.
  function chartFor(S, key, from, to, range) {
    const h = H(), m = M(key);
    const conv = (e) => ({ day: e.day, value: h.toDisplay(S, key, e.value) });
    const pts = h.history(S, key, from - 6, to).map(conv);
    const inRange = pts.filter((p) => p.day >= from);
    const fmt = (v) => (key === 'sleepMin' || key === 'activeMin' ? h.hm(v) : `${U.num(v, key === 'weightKg' || key === 'distanceM' || m.group === 'measure' || key === 'bodyFat' ? 1 : 0)}${h.unitOf(S, key) && key !== 'bodyFat' ? ` ${h.unitOf(S, key)}` : key === 'bodyFat' ? '%' : ''}`);
    const color = `var(--hue-${m.tone})`;
    const avg7 = { name: '7-day average', kind: 'avg', color: 'var(--label)', points: U.rolling(pts, from, to, 7) };
    // Active minutes come in sessions, with no value on rest days: weeks add up, and a running
    // average of the active days alone would mislead.
    const sessions = key === 'activeMin';
    let series, dayLabel = null;
    if (m.kind === 'bar' && range > 90) {
      // A year of daily bars is a blur: one bar per week, the average of the days with data.
      const weeks = [];
      for (let w = B().weekStart(from); w <= to; w += 7) {
        const v = inRange.filter((p) => p.day >= w && p.day < w + 7);
        const sum = v.reduce((a, p) => a + p.value, 0);
        if (v.length) weeks.push({ day: Math.max(w, from), value: sessions ? sum : sum / v.length });
      }
      series = [{ name: `${m.label}, ${sessions ? 'weekly total' : 'weekly average'}`, kind: 'bar', color, span: 7, points: weeks }];
      dayLabel = (d) => `Week of ${U.fmtDay(d, false)}`;
    } else if (m.kind === 'bar') series = range > 7 && !sessions ? [{ name: m.label, kind: 'bar', color, points: inRange }, avg7] : [{ name: m.label, kind: 'bar', color, points: inRange }];
    else if (m.kind === 'dot') series = [{ name: 'Weigh-ins', kind: 'dot', color, points: inRange }].concat(range > 7 ? [avg7] : []);
    else series = [{ name: m.label, kind: 'line', color, gap: m.group === 'measure' ? 120 : 3, points: inRange }];
    return U.chartCard({ key: `m-${key}`, title: m.label, label: `${m.label}, last ${range === 365 ? 'year' : `${range} days`}`, head: false, table: false, fmt, from, to, zero: m.zero, series, cls: 'ms-chart', dayLabel });
  }

  function statsFor(S, key, from, to0) {
    const h = H(), m = M(key);
    // Today isn't over for whole-day totals (steps, calories): its count so far would drag the
    // average down and show up as the lowest day. (Active minutes count sessions: today's are in.)
    const to = m.daily && key !== 'activeMin' && to0 === U.today() ? to0 - 1 : to0;
    const s = h.rangeStats(S, key, from, to);
    if (!s.n) return '';
    const f = (v) => h.format(S, key, v);
    const cell = (k, v, d) => `<div class="ms-stat"><span class="ms-stat-k">${k}</span><span class="ms-stat-v rf-num">${v}</span>${d ? `<span class="ms-stat-d">${U.esc(d)}</span>` : ''}</div>`;
    const wrap = (cells) => `<div class="ms-stats-wrap"><div class="ms-stats">${cells}</div></div>`;
    if (key === 'activeMin') {
      const weeks = Math.max(1, (to - from + 1) / 7);
      return wrap(`${cell('Per week', U.esc(h.hm(s.total / weeks)), 'on average')}${cell('Active days', U.esc(String(s.n)), `of ${to - from + 1}`)}${cell('Longest', U.esc(f(s.max)), U.fmtDay(s.maxDay, false))}${cell('Total', U.esc(h.hm(s.total)))}`);
    }
    const change = s.change == null ? '–' : Math.abs(s.change) < 1e-9 ? 'None' : h.formatDelta(S, key, s.change, s.changeRel);
    return wrap(`${cell('Average', U.metricNum(S, key, s.avg), m.per || '')}${cell('Change', U.esc(change), (to - from) < 7 ? 'first day to last' : 'first week to last')}${cell('Lowest', U.metricNum(S, key, s.min), U.fmtDay(s.minDay, false))}${cell('Highest', U.metricNum(S, key, s.max), U.fmtDay(s.maxDay, false))}`);
  }

  // "3 bpm below your usual of 59": the latest value (or this week, for daily totals) against the usual.
  function compareFor(S, key, day) {
    const h = H(), m = M(key);
    if (m.group === 'measure' || key === 'kcalIn' || key === 'bodyFat') return '';
    const v = h.versus(S, key, day, m.daily ? 'week' : 'latest');
    if (!v) return '';
    if (v.usual == null) {
      const why = key === 'weightKg' ? 'Weigh in over two weeks and the change shows up here.' : 'Your usual shows up here after a week or two of data.';
      return `<p class="ms-compare" data-state="${v.tone}">${U.icon('clock', 'sm')}<span>${why}</span></p>`;
    }
    const word = (m.words || ['above', 'below'])[v.dir === 'up' ? 0 : 1];
    const usual = h.format(S, key, v.usual);
    let text;
    if (key === 'weightKg') text = `7-day average ${h.format(S, key, v.value)}, ${v.dir === 'flat' ? 'about the same as' : word} the week before`;
    else if (m.daily) text = `This week, ${h.format(S, key, v.value)} ${m.per}: ${v.dir === 'flat' ? 'close to' : word} your usual ${usual}`;
    else text = v.dir === 'flat' ? `Close to your usual ${usual}` : `${U.cap(word)} your usual ${usual}`;
    const amount = v.dir === 'flat' ? 'steady' : h.formatDelta(S, key, v.delta, v.rel);
    return `<p class="ms-compare" data-state="${v.tone}">${U.trendChip({ trend: amount, dir: v.dir, tone: v.tone })}<span>${U.esc(text)}</span></p>`;
  }

  // The newest value, big, with when and where it came from.
  function heroFor(S, key, day) {
    const h = H(), m = M(key);
    const e = h.latestEntry(S, key, day, m.daily ? 7 : 400);
    const bed = (S.health.days[day] || {}).bed;
    let when = e ? U.dayName(e.day, day, key) : 'No data yet';
    if (e && m.daily && e.day === day) when = 'Today so far';
    let src = e ? h.SOURCE[e.src] : '';
    if (e && key === 'steps' && e.day === day) src = `${src} · goal ${U.num(B().stepsGoal(S, day).goal)}`;
    if (e && key === 'sleepMin' && e.day === day && bed && e.src === 'hc') src = `${src} · asleep ${U.fmtClock(bed)}`;
    if (e && key === 'protein') { const g = B().proteinGoal(S, day); if (g) src = `${src} · goal ${g} g`; }
    if (e && key === 'kcalIn' && GH.food && GH.food.targets) { const tg = GH.food.targets(S, day); if (tg) src = `${src} · target ${U.num(tg.kcal)} kcal`; }
    return `<div class="ms-hero" data-tone="${m.tone}">
      <div class="ms-hero-text">
        <span class="ms-when">${U.esc(when)}</span>
        <span class="ms-value">${e ? U.metricNum(S, key, e.value, true) : '<span class="mv"><span class="rf-num">–</span></span>'}</span>
        ${e ? `<span class="ms-src">${U.icon(SRC_ICON[e.src] || 'info', 'sm')}<span>${U.esc(src)}</span></span>` : ''}
      </div>
      <span class="ms-ico" aria-hidden="true">${U.icon(m.icon)}</span>
    </div>`;
  }

  function rowFor(S, key, e, day) {
    const h = H(), m = M(key);
    const when = m.daily && e.day === day ? 'Today so far' : U.dayName(e.day, day, key);
    const val = U.esc(h.format(S, key, e.value));
    if (e.src === 'manual' && m.edit) {
      const sub = e.hc != null && Math.abs(e.hc - e.value) > 1e-9 ? `You · replaces ${h.format(S, key, e.hc)} from Health Connect` : 'You';
      return `<li data-key="h-${e.day}"><div class="rf-list-row ms-row is-mine">
        <span class="rf-list-text"><span class="rf-list-title">${U.esc(when)}</span><span class="rf-list-sub">${U.icon('pencil', 'sm')}${U.esc(sub)}</span></span>
        <span class="rf-list-detail rf-num">${val}</span>
        <span class="ms-row-acts"><button type="button" class="rf-btn" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Change ${U.esc(when)}" data-act="metricEdit" data-arg="${e.day}">${U.icon('pencil')}</button><button type="button" class="rf-btn ms-del" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Remove ${U.esc(when)}" data-act="metricDelete" data-arg="${e.day}">${U.icon('trash')}</button></span>
      </div></li>`;
    }
    // Health Connect is where most values come from: only other sources are named.
    const sub = e.src === 'hc' ? '' : `<span class="rf-list-sub">${U.esc(h.SOURCE[e.src] || '')}</span>`;
    return `<li data-key="h-${e.day}"><div class="rf-list-row ms-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(when)}</span>${sub}</span><span class="rf-list-detail rf-num">${val}</span></div></li>`;
  }
  // Active minutes list the activities themselves; ones you logged can be removed.
  function activityRows(S, from, to, day) {
    const list = H().activity(S, from, to);
    const idx = {};
    const rows = list.map((a) => {
      const when = U.dayName(a.day, day);
      const src = a.src === 'app' ? 'Gradient Health' : a.src === 'manual' ? 'You' : 'Health Connect';
      let del = '';
      if (a.src === 'manual') {
        const i = idx[a.day] = (idx[a.day] == null ? 0 : idx[a.day] + 1);
        del = `<span class="ms-row-acts"><button type="button" class="rf-btn ms-del" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Remove ${U.esc(a.name || 'activity')}, ${U.esc(when)}" data-act="metricDeleteActivity" data-arg="${a.day}:${i}">${U.icon('trash')}</button></span>`;
      }
      return `<li><div class="rf-list-row ms-row${del ? ' is-mine' : ''}"><span class="rf-list-text"><span class="rf-list-title">${U.esc(U.cap(a.name || 'Workout'))}</span><span class="rf-list-sub">${U.esc(`${when} · ${src}`)}</span></span><span class="rf-list-detail rf-num">${a.minutes ? `${a.minutes} min` : ''}</span>${del}</div></li>`;
    });
    return rows;
  }

  function actionsFor(S, key) {
    const m = M(key);
    if (m.edit) return `<button type="button" class="rf-btn ms-add" data-variant="soft" data-act="metricAdd">${U.icon('plus')}${m.group === 'measure' ? 'Add a measurement' : 'Add or change'}</button>`;
    if (key === 'activeMin') return `<button type="button" class="rf-btn ms-add" data-variant="soft" data-act="logActivity">${U.icon('plus')}Log other exercise</button>`;
    if (key === 'kcalIn' && U.hasTab && U.hasTab('food')) return `<button type="button" class="rf-btn ms-add" data-variant="soft" data-act="metricGo" data-arg="food">${U.icon('food')}Open Food</button>`;
    if (key === 'protein') return `<button type="button" class="rf-btn ms-add" data-variant="soft" data-act="addProtein">${U.icon('plus')}Add protein</button>`;
    return '';
  }

  function emptyFor(S, key) {
    const m = M(key);
    const app = GH.platform && GH.platform.isApp();
    const hcOn = H().connected(H().status());
    const shared = key === 'rhr' || key === 'hrv' || key === 'bodyFat';
    const text = shared ? WHY_MISSING[0] : m.group === 'measure' ? 'Nothing yet. Measure once a month and add it here.' : m.edit ? `Nothing yet. ${key === 'weightKg' ? 'Weigh in and add it here, or connect a scale through Health Connect.' : 'Add it here, or let Health Connect fill it in.'}` : key === 'kcalIn' ? 'Log food on the Food tab and it shows up here.' : key === 'protein' ? 'Add protein on Today or log food, and it shows up here.' : key === 'activeMin' ? 'Workouts and activities show up here.' : 'This comes from Health Connect. Nothing has come in yet.';
    return `<div class="ms-empty">
      <span class="ms-empty-ico" data-tone="${m.tone}">${U.icon(m.icon)}</span>
      <p class="t-headline">No ${U.esc(m.label.toLowerCase())} yet</p>
      <p class="t-callout rf-muted">${U.esc(text)}</p>
      ${shared && app ? `<p class="t-footnote rf-muted">${U.esc(WHY_MISSING[1])}</p><button type="button" class="rf-btn" data-variant="soft" data-act="hcManage">${U.icon('heart')}Open Health Connect</button>` : ''}
      ${!hcOn && !m.edit && !shared && app && key !== 'kcalIn' && key !== 'protein' && key !== 'activeMin' ? '<button type="button" class="rf-btn" data-variant="soft" data-act="hcConnect">Connect Health Connect</button>' : ''}
    </div>`;
  }

  function aboutFor(S, key, est) {
    const paras = aboutOf(S, key, est);
    if (!paras.length) return '';
    return `<details class="ms-about" data-key="about-${key}"><summary>${U.icon('info', 'sm')}<span>About this number</span><span class="ms-chev">${U.icon('chevron-down', 'sm')}</span></summary><div class="ms-about-body">${paras.map((p) => `<p class="t-callout">${U.esc(p)}</p>`).join('')}</div></details>`;
  }

  function body(S, day) {
    const key = st.key;
    if (key === 'feel') return feelBody(S, day);
    const h = H(), m = M(key);
    const range = st.range;
    const from = day - range + 1;
    const any = h.latestEntry(S, key, day, 400);
    const lr = key === 'rhr' ? h.latestEntry(S, 'rhr', day, 7) : null;
    const est = !!(lr && lr.src === 'est');
    const picks = m.group === 'measure' ? `<div class="ms-picks">${U.choice('metricPick', h.MEASURES.filter((k) => k === 'waist' || k === key || h.latestEntry(S, k, day, 400)).map((k) => [k, M(k).label]), key, 'Measurement', ' data-on="metricPick"')}</div>` : '';
    if (!any) return `<div class="ms" data-tone="${m.tone}">${picks}${emptyFor(S, key)}${actionsFor(S, key)}${aboutFor(S, key, est)}</div>`;
    const list = key === 'activeMin' ? activityRows(S, from, day, day) : h.history(S, key, from, day).reverse().map((e) => rowFor(S, key, e, day));
    const shown = st.more ? list : list.slice(0, LIST_MAX);
    const rangeName = range === 365 ? 'the last year' : `the last ${range} days`;
    return `<div class="ms" data-tone="${m.tone}">
      ${picks}
      ${heroFor(S, key, day)}
      ${compareFor(S, key, day)}
      <div class="ms-range">${U.seg('metricRange', RANGES, String(range), 'Range', ' data-on="metricRange" data-size="sm"')}</div>
      ${chartFor(S, key, from, day, range)}
      ${statsFor(S, key, from, day)}
      ${actionsFor(S, key)}
      <h3 class="ms-h t-footnote">${key === 'activeMin' ? 'Activities' : 'Every day'}, ${U.esc(rangeName)}${key !== 'activeMin' && m.group !== 'measure' && key !== 'kcalIn' && key !== 'protein' ? '<span class="ms-h-note">From Health Connect unless marked</span>' : ''}</h3>
      ${list.length ? `<ul class="rf-list ms-hist">${shown.join('')}</ul>` : `<p class="t-callout rf-muted ms-none">Nothing in ${U.esc(rangeName)}.</p>`}
      ${list.length > shown.length ? `<button type="button" class="rf-btn ms-more" data-variant="plain" data-size="sm" data-act="metricMore">Show all ${list.length}</button>` : ''}
      ${aboutFor(S, key, est)}
    </div>`;
  }

  /* ---------------------------------------------------------------- feel */
  const FEEL = { low: ['Low', 'amber'], ok: ['OK', 'sky'], good: ['Good', 'green'] };
  const SORE = { none: 'no soreness', some: 'some soreness', very: 'very sore' };
  function feelBody(S, day) {
    const f = S.feel[day] || {};
    const cells = [];
    const counts = { low: 0, ok: 0, good: 0 };
    for (let d = day - 27; d <= day; d++) {
      const x = S.feel[d] || {};
      if (x.energy && counts[x.energy] != null) counts[x.energy]++;
      const label = `${U.fmtDay(d)}: ${x.energy ? `${FEEL[x.energy][0].toLowerCase()} energy` : 'no check-in'}${x.sore ? `, ${SORE[x.sore] || x.sore}` : ''}`;
      cells.push(`<span class="ms-cell" data-v="${x.energy || 'none'}"${x.energy ? ` data-tone="${FEEL[x.energy][1]}"` : ''} title="${U.esc(label)}"></span>`);
    }
    const n = counts.low + counts.ok + counts.good;
    return `<div class="ms" data-tone="sky">
      <div class="ms-hero ms-feel-now" data-tone="sky">
        <div class="ms-hero-text"><span class="ms-when">Today</span><span class="t-callout rf-muted">${f.energy ? U.esc(`${FEEL[f.energy][0]} energy${f.sore ? `, ${SORE[f.sore] || f.sore}` : ''}`) : 'How are you today?'}</span></div>
        <span class="ms-ico" aria-hidden="true">${U.icon('sparkle')}</span>
      </div>
      <div class="feel-row"><span class="t-subhead">Energy</span>${U.seg('msE', [['low', 'Low'], ['ok', 'OK'], ['good', 'Good']], f.energy || '', 'Energy', ' data-on="msFeelEnergy"')}</div>
      <div class="feel-row"><span class="t-subhead">Soreness</span>${U.seg('msS', [['none', 'None'], ['some', 'Some'], ['very', 'Very']], f.sore || '', 'Soreness', ' data-on="msFeelSore"')}</div>
      <h3 class="ms-h t-footnote">Energy, the last 4 weeks</h3>
      <div class="ms-strip" role="img" aria-label="${U.esc(n ? `Energy check-ins in the last 4 weeks: ${counts.good} good, ${counts.ok} OK, ${counts.low} low` : 'No check-ins in the last 4 weeks')}">${cells.join('')}</div>
      <div class="ms-legend t-caption">${['good', 'ok', 'low'].map((k) => `<span><i class="ms-cell" data-v="${k}" data-tone="${FEEL[k][1]}"></i>${FEEL[k][0]} ${counts[k]}</span>`).join('')}<span><i class="ms-cell" data-v="none"></i>No check-in</span></div>
      ${aboutFor(S, 'feel')}
    </div>`;
  }
  U.on.msFeelEnergy = (el, ev, v) => { H().setFeel(U.S, U.today(), { energy: v }); U.save(); setTimeout(() => { U.render(); refresh(); if (U.checklistCheck) U.checklistCheck(); }, 240); };
  U.on.msFeelSore = (el, ev, v) => { H().setFeel(U.S, U.today(), { sore: v }); U.save(); setTimeout(() => { U.render(); refresh(); }, 240); };

  /* ---------------------------------------------------------------- opening it */
  const titleOf = (key) => (key === 'feel' ? 'Feel check' : M(key).group === 'measure' ? 'Measurements' : M(key).label);
  U.metricSheet = (key, o) => {
    if (key !== 'feel' && !M(key)) return null;
    if (st.ctl && !st.ctl.closed) st.ctl.close('cancel');
    st.key = key;
    st.range = (o && o.range) || (key !== 'feel' && M(key).group === 'measure' ? 365 : 28);
    st.more = false;
    const ctl = U.sheet({ title: titleOf(key), size: 'auto', cls: 'ms-sheet', body: body(U.S, U.today()), onClose: () => { if (st.ctl === ctl) st.ctl = null; } });
    st.ctl = ctl;
    return ctl;
  };
  function refresh() { if (st.ctl && !st.ctl.closed) st.ctl.update(body(U.S, U.today())); }
  U.refreshMetricSheet = refresh;
  U.act.metricOpen = (el) => U.metricSheet(el.dataset.arg);
  U.on.metricRange = (el, ev, v) => { st.range = Number(v) || 28; st.more = false; setTimeout(refresh, 200); };
  U.act.metricMore = () => { st.more = true; refresh(); };
  U.on.metricPick = (el, ev, v) => { if (!v || v === st.key) return; st.key = v; st.more = false; refresh(); };
  U.act.metricGo = (el) => { U.closeSheets(); U.go(el.dataset.arg); };

  /* ---------------------------------------------------------------- add or change */
  const ed = { ctl: null, key: null, day: null };
  const dayStr = (d) => B().dayStr(d);
  function field(id, label, value, o) {
    return `<div class="rf-field"><label class="rf-field-label" for="${id}">${U.esc(label)}</label><div class="rf-field-control"><input class="rf-input" id="${id}" type="number" inputmode="${o && o.int ? 'numeric' : 'decimal'}" step="${o && o.step || 'any'}" min="0" value="${value == null ? '' : U.esc(value)}" placeholder="${U.esc(o && o.ph || '')}"></div></div>`;
  }
  function editBody(S, key, day) {
    const h = H(), m = M(key);
    const today = U.today();
    const e = h.entry(S, key, day);
    const mine = h.hasManual(S, day, key);
    const last = h.latestEntry(S, key, today, 400);
    const unit = h.unitOf(S, key);
    const shown = (v) => (v == null ? null : Math.round(h.toDisplay(S, key, v) * 10) / 10);
    let fields;
    if (key === 'sleepMin') {
      const v = e ? Math.round(e.value) : null;
      fields = `<div class="ob-row2">${field('msH', 'Hours', v == null ? null : Math.floor(v / 60), { int: true, step: 1, ph: '7' })}${field('msM', 'Minutes', v == null ? null : v % 60, { int: true, step: 5, ph: '30' })}</div>`;
    } else {
      const label = key === 'steps' ? 'Steps' : `${m.label} (${unit})`;
      const ph = last ? String(key === 'steps' ? Math.round(last.value) : shown(last.value)) : '';
      fields = field('msVal', label, e ? (key === 'steps' || key === 'rhr' ? Math.round(e.value) : shown(e.value)) : null, { int: key === 'steps' || key === 'rhr', step: key === 'steps' || key === 'rhr' ? 1 : 0.1, ph });
    }
    let hint;
    if (mine && e && e.hc != null) hint = `This is your number. Remove it to go back to Health Connect's ${h.format(S, key, e.hc)}.`;
    else if (mine) hint = 'This is your number for the day.';
    else if (e && e.src !== 'manual' && e.hc != null) hint = `Health Connect has ${h.format(S, key, e.hc)} for this day. Yours will replace it.`;
    else if (key === 'weightKg') hint = 'Same time each morning is best. The trend uses a 7-day average.';
    else if (m.group === 'measure') hint = 'Once a month, same time of day.';
    else hint = 'Health Connect won\'t overwrite a number you add.';
    return `<div class="sheet-pad ms-form">
      ${fields}
      <div class="rf-field"><label class="rf-field-label" for="msDay">${key === 'sleepMin' ? 'Night ending on' : 'Day'}</label><div class="rf-field-control"><input class="rf-input" id="msDay" type="date" value="${dayStr(day)}" min="${dayStr(today - 365)}" max="${dayStr(today)}" data-on="metricDay"></div></div>
      <p class="rf-field-hint ms-hint">${U.esc(hint)}</p>
      ${mine ? `<button type="button" class="rf-btn ms-remove" data-variant="plain" data-act="metricRemove">${U.icon('trash')}${e && e.hc != null ? 'Remove mine, use Health Connect\'s' : 'Remove mine'}</button>` : ''}
    </div>`;
  }
  // Opens the Add or change form for a day (today by default).
  U.metricEdit = (key, day) => {
    const m = M(key);
    if (!m || !m.edit) return null;
    const d = day == null ? U.today() : day;
    ed.key = key; ed.day = d;
    const had = H().hasManual(U.S, d, key) || !!H().entry(U.S, key, d);
    const ctl = U.sheet({ title: `${had ? 'Change' : 'Add'} ${m.label.toLowerCase()}`, size: 'fit', cls: 'ms-edit', body: editBody(U.S, key, d), action: { label: 'Save', act: 'metricSave' }, onClose: () => { if (ed.ctl === ctl) ed.ctl = null; } });
    ed.ctl = ctl;
    return ctl;
  };
  U.act.metricAdd = () => U.metricEdit(st.key, U.today());
  U.act.metricEdit = (el) => U.metricEdit(st.key, Number(el.dataset.arg));
  U.on.metricDay = (el, ev, v) => {
    const d = v ? B().dayFromStr(String(v)) : null;
    if (d == null || !isFinite(d) || !ed.ctl || ed.ctl.closed) return;
    ed.day = Math.min(U.today(), Math.max(U.today() - 365, d));
    ed.ctl.update(editBody(U.S, ed.key, ed.day));
  };
  // Reads the form: the value in stored units, or null.
  function readValue(key) {
    const q = (id) => { const el = ed.ctl && ed.ctl.el.querySelector(`#${id}`); return el ? parseFloat(el.value) : NaN; };
    if (key === 'sleepMin') {
      const hh = q('msH'), mm = q('msM');
      if (!isFinite(hh) && !isFinite(mm)) return null;
      return (isFinite(hh) ? hh : 0) * 60 + (isFinite(mm) ? mm : 0);
    }
    const v = q('msVal');
    return isFinite(v) ? H().fromDisplay(U.S, key, v) : null;
  }
  function rangeText(key) {
    const h = H(), m = M(key);
    if (key === 'sleepMin') return 'between 30 min and 18 h';
    const lo = h.toDisplay(U.S, key, m.valid[0]), hi = h.toDisplay(U.S, key, m.valid[1]);
    const unit = key === 'steps' ? '' : ` ${h.unitOf(U.S, key)}`;
    return `between ${U.num(lo)} and ${U.num(hi)}${unit}`;
  }
  U.act.metricSave = () => {
    const S = U.S, key = ed.key, day = ed.day, m = M(key);
    if (!m) return;
    const dayEl = ed.ctl && ed.ctl.el.querySelector('#msDay');
    const d = dayEl && dayEl.value ? B().dayFromStr(dayEl.value) : day;
    const v = readValue(key);
    if (v == null || !H().setManual(S, Math.min(U.today(), d), key, v)) {
      U.haptic('deny');
      U.toast(v == null ? 'Enter a number first' : `Enter ${m.label.toLowerCase()} ${rangeText(key)}`, 'caution');
      return;
    }
    if (ed.ctl) ed.ctl.close('ok');
    U.commit();
    refresh();
    U.haptic('log'); // the toast's success merges into it
    const ws = key === 'weightKg' ? B().weightStats(S, U.today()) : null;
    U.toast(`${m.label} saved`, 'positive', ws && ws.warn ? ws.warn : undefined);
    if (U.checklistCheck) U.checklistCheck();
  };
  // Takes one of the person's values away; Health Connect's (if any) is back, and Undo restores it.
  function removeMine(key, day) {
    const S = U.S, h = H(), m = M(key);
    const e = h.entry(S, key, day);
    if (!e || !h.hasManual(S, day, key)) return;
    const was = e.mine != null ? e.mine : e.value;
    h.clearManual(S, day, key);
    U.commit();
    refresh();
    U.haptic('remove');
    const back = h.entry(S, key, day);
    U.toast(`Removed your ${m.label.toLowerCase()}`, 'neutral', back ? `${h.SOURCE[back.src]}'s ${h.format(S, key, back.value)} is back.` : undefined, { label: 'Undo', onClick: () => { h.setManual(U.S, day, key, was); U.commit(); refresh(); U.haptic('undo'); } });
  }
  U.act.metricRemove = () => { const key = ed.key, day = ed.day; if (ed.ctl) ed.ctl.close('ok'); removeMine(key, day); };
  U.act.metricDelete = (el) => removeMine(st.key, Number(el.dataset.arg));
  U.act.metricDeleteActivity = (el) => {
    const [d, i] = String(el.dataset.arg).split(':').map(Number);
    const m = U.S.health.manual[d];
    const x = m && m.exercise && m.exercise[i];
    if (!x) return;
    H().removeManual(U.S, d, 'exercise', i);
    U.commit();
    refresh();
    U.haptic('remove');
    U.toast('Activity removed', 'neutral', undefined, { label: 'Undo', onClick: () => { H().logManual(U.S, d, { exercise: { typeName: x.typeName, minutes: x.minutes } }); U.commit(); refresh(); U.haptic('undo'); } });
  };
})(typeof window !== 'undefined' ? window : globalThis);
