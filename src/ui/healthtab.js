/* Health: this week at a glance (the coach's report, in full in a sheet), today's numbers, insights,
 * trends, recent activity and where the data comes from. Every number opens its metric sheet
 * (metric.js) with its history and a way to add or change it; the + button in the top bar logs
 * weight, sleep, a feel check, an activity or measurements.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const AI = () => GH.ai;
  const M = (key) => H().METRICS[key];

  const ai = { busy: false, error: null, tried: null };
  const TONE_HUE = { good: 'green', watch: 'amber', info: 'sky', alert: 'rose' };
  const canHandOff = () => !!(U.canHandOff && U.canHandOff());

  /* ---------------------------------------------------------------- this week */
  const claudeMode = (S) => S.ai.mode === 'api';
  const hasWeek = (S) => S.log.some((l) => l.type === 'workout') || Object.keys(S.health.days || {}).length >= 3;
  // Claude's glance items name their metric in words; the pills open that metric's sheet.
  const METRIC_WORDS = [[/^sleep/i, 'sleepMin'], [/^steps?/i, 'steps'], [/^resting/i, 'rhr'], [/^hrv|variability/i, 'hrv'], [/^weight/i, 'weightKg'], [/^active cal|^calories burn/i, 'activeKcal'], [/^active|^activity|^exercise/i, 'activeMin'], [/^distance/i, 'distanceM'], [/^protein/i, 'protein'], [/^calories|^eaten|^food/i, 'kcalIn']];
  const keyOf = (label) => { const hit = METRIC_WORDS.find(([re]) => re.test(String(label || '').trim())); return hit ? hit[1] : null; };
  // The first sentence of a focus item, for a report written before focus_one existed.
  function firstPart(text) {
    const s = String(text || '').split(/(?<=[.:])\s/)[0].replace(/[.:]$/, '').trim();
    return s && s.length <= 60 ? s : '';
  }
  // The report the card shows: Claude's when it's set up and written (and not reported), otherwise
  // the built-in one. Older saved reports get glance and focus_one from the phone's own numbers.
  function weekReport(S, day) {
    const api = claudeMode(S) && AI() && AI().hasKey();
    const rep0 = api ? AI().reportFor(S, day) : null;
    const rep = rep0 && !rep0.flagged ? rep0 : null;
    const own = GH.coach.report(S, day);
    const d = rep ? Object.assign({}, rep.data) : own;
    d.glance = d.glance && d.glance.length >= 2 ? d.glance.map((g) => (g.key ? g : Object.assign({ key: keyOf(g.metric) }, g))) : own.glance;
    if (!d.focus_one) d.focus_one = firstPart((d.focus || [])[0]) || own.focus_one;
    return { api, rep, data: d };
  }
  const winText = (t) => String(t || '').trim().replace(/\.$/, '');
  function weekCard(S, day) {
    if (!hasWeek(S)) return '';
    const w = weekReport(S, day);
    const d = w.data;
    const busy = w.api && ai.busy === 'report';
    const src = busy ? '<span class="hl-week-src is-busy"><span class="rf-spinner" data-size="sm"><i></i></span>Writing</span>'
      : `<span class="hl-week-src">${w.rep ? 'By Claude' : 'From your numbers'}</span>`;
    const glance = (d.glance || []).length >= 2 ? d.glance.slice(0, 4) : [];
    const wins = (d.wins || []).slice(0, 2);
    // A spending limit that stopped the report says so, with the way to the limits.
    const err = ai.error && w.api ? `<div class="notice" data-tone="${ai.budget ? 'caution' : 'critical'}">${U.icon('alert')}<span>${U.esc(ai.error)}${ai.budget ? ' <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="claudePage">Limits</button>' : ''}</span></div>` : '';
    const waiting = w.api && !S.ai.consentAt ? `<div class="notice" data-tone="info">${U.icon('info')}<span>Claude is waiting for your OK before it gets your data. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="claudeReview">Review</button></span></div>` : '';
    return `<div class="card hl-week" data-key="week">
      <button type="button" class="hl-week-main" data-act="healthReport">
        <span class="hl-week-head"><span class="hl-week-eyebrow">${U.icon('sparkle', 'sm')}This week</span>${src}<span class="hl-week-go">${U.icon('chevron-right', 'sm')}</span></span>
        <span class="hl-week-title">${U.esc(d.headline)}</span>
        ${glance.length ? `<span class="hl-glance" data-n="${glance.length}">${glance.map((g) => U.metricPill(g)).join('')}</span>` : ''}
        ${wins.length ? `<span class="hl-wins">${wins.map((x) => `<span class="hl-win">${U.icon('star', 'sm')}<span>${U.esc(winText(x))}</span></span>`).join('')}</span>` : ''}
        ${d.focus_one ? `<span class="hl-focus"><span class="hl-focus-ico">${U.icon('flag', 'sm')}</span><span class="hl-focus-text"><span class="hl-focus-k">Focus next</span><span>${U.esc(winText(d.focus_one))}</span></span></span>` : ''}
      </button>
      ${err}${waiting}
      ${d.ask_me && d.ask_me.length ? `<div class="hl-asks" data-hscroll role="group" aria-label="Ask the coach">${d.ask_me.slice(0, 3).map((q) => `<button type="button" class="rf-chip" data-act="askPreset" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  // The whole report, in a sheet from the card.
  function reportBody(S, day) {
    const w = weekReport(S, day);
    const d = w.data;
    const busy = w.api && ai.busy === 'report';
    const list = (title, arr, icon, state) => (arr && arr.length ? `<section class="rs-sec" data-state="${state}"><h3 class="rs-h">${U.icon(icon, 'sm')}<span>${title}</span></h3><ul class="rs-list">${arr.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul></section>` : '');
    const meta = w.rep ? `Written ${U.esc(U.fmtDay(w.rep.day))}${w.rep.model ? ` by ${U.esc(w.rep.model)}` : ''}. Not medical advice.`
      : w.api ? 'Claude hasn\'t written this week\'s report yet, so this one is worked out on this phone. Not medical advice.' : 'Worked out on this phone from your own numbers. Not medical advice.';
    const glance = (d.glance || []).length >= 2 ? d.glance.slice(0, 4) : [];
    return `<div class="rs">
      <div class="rs-top">${busy ? `<span class="rf-spinner" data-size="sm"><i></i></span><span class="t-footnote rf-muted">Claude is writing this week's report…</span>` : w.rep ? U.badge('Claude', 'accent') : U.badge('From your numbers', 'neutral')}</div>
      <h3 class="rs-title">${U.esc(d.headline)}</h3>
      ${glance.length ? `<div class="hl-glance rs-glance" data-n="${glance.length}">${glance.map((g) => U.metricPill(g, 'metricOpen')).join('')}</div>` : ''}
      ${list('Wins', (d.wins || []).map(winText), 'star', 'good')}
      ${list('Keep an eye on', d.watch, 'alert', 'watch')}
      ${list('Focus next', d.focus, 'flag', 'focus')}
      ${U.planIdeas && w.rep ? U.planIdeas(S, day, w.rep) : ''}
      ${d.ask_me && d.ask_me.length ? `<div class="hl-asks rs-asks" data-hscroll role="group" aria-label="Ask the coach">${d.ask_me.map((q) => `<button type="button" class="rf-chip" data-act="askPreset" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>` : ''}
      <p class="t-footnote rf-muted rs-meta">${meta}</p>
      <div class="btn-row rs-btns">
        ${w.api && S.ai.consentAt ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="aiReport"${ai.busy ? ' aria-disabled="true"' : ''}>${U.icon('refresh', 'sm')}${w.rep ? 'Write it again' : 'Write it with Claude'}</button>` : ''}
        ${w.rep && !busy ? `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="reportFlag">${U.icon('flag', 'sm')}Report</button>` : ''}
        ${canHandOff() ? `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="askClaudeApp">${U.icon('share', 'sm')}Ask in the Claude app</button>` : ''}
      </div>
    </div>`;
  }
  let reportCtl = null;
  const refreshReport = () => { if (reportCtl && !reportCtl.closed) reportCtl.update(reportBody(U.S, U.today())); };
  // (Also once the plan review loads, for the report's plan ideas: src/ui/lazy.js.)
  U.refreshReport = refreshReport;
  U.act.healthReport = () => {
    const ctl = U.sheet({ title: 'This week', size: 'auto', cls: 'rs-sheet', body: reportBody(U.S, U.today()), onClose: () => { if (reportCtl === ctl) reportCtl = null; } });
    reportCtl = ctl;
  };
  U.act.reportFlag = () => { if (reportCtl) reportCtl.close('ok'); if (U.act.flagReport) U.act.flagReport(); };
  async function writeReport(auto) {
    const S = U.S, day = U.today();
    if (ai.busy || !AI() || !AI().hasKey() || !claudeMode(S)) return;
    // The automatic weekly report only runs once the person has allowed Claude; asking by hand
    // shows the consent screen first.
    if (!S.ai.consentAt && (auto || !(await U.claudeConsent()))) return;
    ai.busy = 'report'; ai.error = null; ai.tried = day;
    if (!auto) U.haptic('send'); // asked by hand: sent off to Claude, and its end below
    if (U.route.tab === 'health' && !U.route.view) U.render();
    refreshReport();
    try {
      await AI().report(S, day);
      U.save(true);
    } catch (e) {
      ai.error = e.message || 'The coach couldn\'t write the report.';
      ai.budget = !!(AI().isBudget && AI().isBudget(e.code));
      if (auto && e.code === 'offline') ai.error = null;
    } finally {
      ai.busy = false;
      if (!auto) U.haptic(ai.error ? 'error' : 'success');
      if (U.route.tab === 'health' && !U.route.view) U.render();
      refreshReport();
    }
  }
  U.act.aiReport = () => writeReport(false);
  U.act.openCoachSettings = () => U.open('settings', 'coach');

  /* ---------------------------------------------------------------- today */
  const ago = (d, day) => (d === day ? 'Today' : d === day - 1 ? 'Yesterday' : `${day - d} days ago`);
  const noValue = '<span class="mv"><span class="rf-num">–</span></span>';
  // The four main numbers: the newest value, when it's from, and how it compares with the usual.
  function heroTile(S, day, key) {
    const h = H(), m = M(key);
    const connected = h.connected(h.status());
    let e, sub, chip = '', bar = '';
    if (key === 'steps') {
      e = h.entry(S, 'steps', day);
      const goal = B().stepsGoal(S, day).goal;
      sub = e ? `Goal ${U.num(goal)}` : connected ? 'None synced yet today' : 'Tap to add';
      if (e) bar = U.progress(e.value / goal, `${U.num(e.value)} of ${U.num(goal)} steps`);
    } else {
      e = h.latestEntry(S, key, day, key === 'sleepMin' ? 1 : key === 'weightKg' ? 60 : 3);
      const v = e ? h.versus(S, key, day, key === 'weightKg' ? 'week' : 'latest') : null;
      // Only a real change gets a chip (or a value worth watching whatever the usual); steady stays quiet.
      if (v && v.usual != null && v.dir && (v.dir !== 'flat' || v.tone === 'watch')) chip = U.trendChip({ trend: v.dir === 'flat' ? 'steady' : h.formatDelta(S, key, v.delta, v.rel), dir: v.dir, tone: v.tone });
      if (!e) sub = key === 'rhr' && connected ? 'Not shared by your watch app' : 'Tap to add';
      else if (key === 'sleepMin') { const bed = e.src === 'hc' && (S.health.days[day] || {}).bed; sub = e.day !== day ? 'The night before' : e.src === 'chip' ? 'From your check-in' : bed ? `Asleep ${U.fmtClock(bed)}` : 'Last night'; }
      else if (key === 'rhr') sub = `${ago(e.day, day)}${e.src === 'est' ? ' · estimated' : !chip && v && v.usual != null ? ` · usual ${Math.round(v.usual)}` : ''}`;
      else if (key === 'weightKg') { const avg = B().weightStats(S, day).avg7; sub = `${ago(e.day, day)}${avg != null && !chip ? ` · avg ${U.num(h.toDisplay(S, key, avg), 1)}` : ''}`; }
      else sub = ago(e.day, day);
    }
    return `<button type="button" class="stat hl-tile hl-hero" data-tone="${m.tone}" data-act="metricOpen" data-arg="${key}" data-key="t-${key}">
      <span class="hl-tile-top"><span class="hl-ico">${U.icon(m.icon)}</span><span class="hl-tile-label">${U.esc(m.short)}</span></span>
      <span class="hl-tile-value">${e ? U.metricNum(S, key, e.value, true) : noValue}</span>
      <span class="hl-tile-foot"><span class="hl-tile-sub">${U.esc(sub)}</span>${chip}</span>
      ${bar}
    </button>`;
  }
  function miniTile(o) {
    return `<button type="button" class="stat hl-tile hl-mini" data-tone="${o.tone}" data-act="${o.act || 'metricOpen'}" data-arg="${U.esc(o.key)}" data-key="t-${U.esc(o.key)}">
      <span class="hl-ico">${U.icon(o.icon)}</span>
      <span class="hl-mini-text"><span class="hl-mini-value">${o.value}</span><span class="hl-mini-label">${U.esc(o.label)}</span></span>
    </button>`;
  }
  function todaySection(S, day) {
    const h = H();
    const tile = (key, e, extra) => Object.assign({ key, tone: M(key).tone, icon: M(key).icon, label: M(key).short, value: e ? U.metricNum(S, key, e.value, true) : noValue }, extra || {});
    const minis = [];
    minis.push(tile('hrv', h.latestEntry(S, 'hrv', day, 3)));
    const act = h.activeMinutes(S, day, day);
    minis.push(tile('activeMin', { value: act }, { label: 'Active today' }));
    const kcal = h.latestEntry(S, 'activeKcal', day, 1);
    if (kcal) minis.push(tile('activeKcal', kcal));
    const dist = h.latestEntry(S, 'distanceM', day, 1);
    if (dist) minis.push(tile('distanceM', dist));
    const F = GH.food;
    if (F && F.full(S)) {
      const tot = F.totals(S, day), tg = F.targets(S, day);
      minis.push(tile('kcalIn', null, { value: `<span class="mv">${U.roll(U.num(tot.kcal))}<small>${tg ? `of ${U.esc(U.num(tg.kcal))}` : 'kcal'}</small></span>` }));
    } else if (!(S.profile.protein.track === false || (F && F.mode(S) === 'off'))) {
      const got = B().proteinToday(S, day), goal = B().proteinGoal(S, day);
      minis.push(tile('protein', null, { value: `<span class="mv">${U.roll(String(Math.round(got)))}<small>${goal ? `of ${goal} g` : 'g'}</small></span>` }));
    }
    const f = S.feel[day] || {};
    minis.push({ key: 'feel', tone: 'sky', icon: 'sparkle', label: 'Feel', value: f.energy ? `<span class="mv"><span>${U.esc({ low: 'Low', ok: 'OK', good: 'Good' }[f.energy] || U.cap(f.energy))}</span><small>energy</small></span>` : '<span class="mv"><span class="hl-mini-cta">Check in</span></span>' });
    const fat = h.latestEntry(S, 'bodyFat', day, 60);
    if (fat) minis.push(tile('bodyFat', fat));
    return `<div class="hl-hero-grid">${['sleepMin', 'steps', 'rhr', 'weightKg'].map((k) => heroTile(S, day, k)).join('')}</div>
      <div class="hl-mini-grid">${minis.map(miniTile).join('')}</div>`;
  }

  /* ---------------------------------------------------------------- insights */
  // One line each; tap to read more, see the numbers behind it, act on it or hide it.
  const INS_METRIC = { sleepMin: 'sleepMin', steps: 'steps', rhr: 'rhr', hrv: 'hrv', weight: 'weightKg', waist: 'waist', arms: 'armL', protein: 'protein', sleepTiming: 'sleepMin', 'sleep-rhr': 'rhr', 'feel-sleep': 'sleepMin', 'steps-weight': 'steps' };
  function insightRow(x) {
    const mk = INS_METRIC[x.metric];
    return `<details class="hl-ins" data-state="${U.esc(x.tone)}" data-key="ins-${U.esc(x.id)}">
      <summary class="hl-ins-sum"><span class="rf-list-icon" data-tone="${TONE_HUE[x.tone] || 'sky'}">${U.icon(x.icon)}</span><span class="hl-ins-title">${U.esc(x.title)}</span><span class="hl-ins-chev">${U.icon('chevron-down', 'sm')}</span></summary>
      <div class="hl-ins-body">
        <p class="t-callout">${U.esc(x.body)}</p>
        <p class="t-footnote rf-muted">Based on ${U.esc(x.evidence)}</p>
        <div class="hl-ins-acts">
          ${x.action ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="insightGo" data-arg="${U.esc(x.action.route)}">${U.esc(x.action.label)}</button>` : ''}
          ${mk && M(mk) ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="metricOpen" data-arg="${mk}">${U.icon('chart', 'sm')}See the numbers</button>` : ''}
          <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="dismissInsight" data-arg="${U.esc(x.id)}">Hide for 30 days</button>
        </div>
      </div>
    </details>`;
  }
  const insights = (list) => (list.length ? `<div class="hl-ins-list" data-key="ins">${list.map(insightRow).join('')}</div>`
    : '<div class="card hl-note" data-key="noins"><p class="t-callout rf-muted">Insights show up here after a few days of data: sleep, steps, weight, workouts and check-ins.</p></div>');
  U.act.dismissInsight = (el) => { GH.insights.dismiss(U.S, el.dataset.arg, U.today()); U.commit(); U.haptic('dismiss'); U.toast('Hidden for 30 days', 'neutral'); };
  U.act.insightGo = (el) => U.go(el.dataset.arg);

  /* ---------------------------------------------------------------- trends */
  // A sparkline row per metric over the last 28 days (measurements over a year), with the newest
  // value; each opens its metric sheet.
  const TREND_LABEL = { activeMin: 'Active minutes', kcalIn: 'Calories eaten' };
  function trendRow(S, day, key, days) {
    const h = H(), m = M(key);
    let from = day - days + 1;
    let hist = h.history(S, key, from, day);
    // Measurements are monthly: the line starts at the first one this year rather than squeezing
    // a few points into the last weeks of a year.
    if (m.group === 'measure' && hist.length) { from = Math.max(from, hist[0].day - 2); hist = h.history(S, key, from, day); }
    const last = hist[hist.length - 1];
    const spark = U.spark(hist, { from, to: day, kind: m.kind === 'bar' ? 'bar' : 'line', gap: m.group === 'measure' ? 120 : 7 });
    return `<li data-key="tr-${key}"><button type="button" class="hl-tr" data-tone="${m.tone}" data-act="metricOpen" data-arg="${key}">
      <span class="hl-tr-label">${U.esc(TREND_LABEL[key] || m.short)}${days > 28 && hist.length ? `<span class="hl-tr-sub">Since ${U.esc(U.fmtDay(hist[0].day, false))}</span>` : ''}</span>
      <span class="hl-tr-spark">${spark || '<span class="hl-tr-none t-caption">Not enough yet</span>'}</span>
      <span class="hl-tr-value rf-num">${last ? U.esc(h.format(S, key, last.value)) : '–'}</span>
      <span class="hl-tr-chev">${U.icon('chevron-right', 'sm')}</span>
    </button></li>`;
  }
  function trends(S, day) {
    const h = H();
    const has = (key, days) => h.history(S, key, day - days + 1, day).length > 0;
    const keys = ['sleepMin', 'steps'];
    if (has('rhr', 90)) keys.push('rhr');
    keys.push('weightKg');
    if (has('hrv', 90)) keys.push('hrv');
    keys.push('activeMin');
    if (has('activeKcal', 28)) keys.push('activeKcal');
    if (GH.food && GH.food.full(S)) keys.push('kcalIn');
    const rows = keys.map((k) => trendRow(S, day, k, 28));
    if (h.history(S, 'waist', day - 364, day).length >= 2) rows.push(trendRow(S, day, 'waist', 365));
    return `<div class="card hl-trends" data-key="trends"><ul class="rf-list">${rows.join('')}</ul></div>`;
  }

  /* ---------------------------------------------------------------- activity + sources */
  function activity(S, day) {
    const list = H().activity(S, day - 27, day);
    // Starting an outdoor activity; the ones recorded here open their summary (src/ui/activity.js).
    const start = U.actHealthStart ? U.actHealthStart(S) : '';
    if (!list.length) return `${start}<div class="card hl-note" data-key="noact"><p class="t-callout rf-muted">No workouts in the last 4 weeks yet. Record a walk, run or ride, log other exercise with the + button, or connect Health Connect.</p></div>`;
    const rows = list.slice(0, 4).map((a) => (a.src === 'activity' && U.actHealthRow && U.actHealthRow(a)) || U.row({
      icon: a.src === 'app' ? 'bolt' : a.src === 'manual' ? 'pencil' : 'heart', tone: a.src === 'app' ? 'indigo' : a.src === 'manual' ? 'amber' : 'rose',
      title: U.esc(U.cap(a.name || 'Workout')), sub: `${U.esc(U.fmtDay(a.day))}${a.src === 'app' ? ' · Gradient Health' : a.src === 'manual' ? ' · logged by you' : ' · Health Connect'}`,
      detail: a.minutes ? `${a.minutes} min` : '',
    }));
    if (list.length > 4) rows.push(U.row({ title: `See all ${list.length}`, act: 'metricOpen', arg: 'activeMin', chevron: true, cls: 'hl-seeall' }));
    return `${start}<ul class="rf-list hl-act" data-key="act">${rows.join('')}</ul>`;
  }
  const TYPE_LABEL = { steps: 'steps', sleep: 'sleep', weight: 'weight', height: 'height', bodyFat: 'body fat', restingHr: 'resting heart rate', hrv: 'HRV', exercise: 'workouts', heartRate: 'heart rate', activeKcal: 'active calories', distance: 'distance', nutrition: 'food' };
  const HC_TEXT = {
    granted: 'Connected', partial: 'Partly connected: some data types are off', denied: 'Not connected',
    unsupported: 'Needs Android 14 or newer', unavailable: 'Not available on this phone right now',
  };
  function sources(S) {
    const st = H().status();
    const app = GH.platform && GH.platform.isApp();
    const on = H().connected(st);
    const sync = U.syncState();
    const last = S.health.lastSync;
    const status = !app ? 'Works in the Android app' : on ? `${U.esc(HC_TEXT[st])} · ${sync.busy ? 'syncing now' : `updated <span data-ago="${last || 0}">${U.esc(U.ago(last))}</span>`}` : U.esc(HC_TEXT[st] || st);
    const canWrite = on && H().canWrite && H().canWrite();
    const rows = [`<li><div class="rf-list-row"><span class="rf-list-icon" data-tone="rose">${U.icon('heart')}</span><span class="rf-list-text"><span class="rf-list-title">Health Connect</span><span class="rf-list-sub">${status}</span></span><span class="rf-list-detail">${U.badge(on ? 'On' : 'Off', on ? 'positive' : 'neutral')}</span></div></li>`];
    if (app && on) {
      rows.push(`<li><button type="button" class="rf-list-row" data-act="hcSync" data-sync-spin${sync.busy ? ' data-spinning' : ''}><span class="rf-list-icon" data-tone="sky">${U.icon('refresh')}</span><span class="rf-list-text"><span class="rf-list-title">Sync now</span></span></button></li>`);
      rows.push(U.row({ icon: 'lock', tone: 'indigo', title: 'Permissions', sub: 'What Gradient Health can read and write', act: 'hcManage', chevron: true }));
      rows.push(`<li>${U.sw('Save workouts to Health Connect', !!(S.health.write !== false && canWrite), 'data-on="hcWriteToggle"', canWrite ? 'Other apps see your Gradient Health workouts' : 'Needs the Exercise permission in Health Connect')}</li>`);
    }
    const errs = (S.health.errors || []).length ? `<p class="t-footnote rf-muted">Couldn't read: ${U.esc(S.health.errors.map((k) => TYPE_LABEL[k] || k).join(', '))}. It'll try again on the next sync.</p>` : '';
    const failed = sync.error && !sync.busy ? `<div class="notice" data-tone="caution">${U.icon('alert')}<span>The last sync didn't finish${sync.error === 'timeout' ? ' (it took too long)' : ''}. Pull down or tap Sync now to try again.</span></div>` : '';
    const allow = on && !S.health.askedNew && H().missingTypes && H().missingTypes(S).length ? `<div class="notice" data-tone="info">${U.icon('info')}<span>This version can also read heart rate, active calories and distance${GH.food && GH.food.full(S) ? ', and share meals' : ''}. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="hcAllowNew">Allow</button><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="hcSkipNew">Not now</button></span></div>` : '';
    const connect = app && !on && st !== 'unsupported' && st !== 'unavailable' ? '<button type="button" class="rf-btn hl-connect" data-variant="filled" data-act="hcConnect">Connect Health Connect</button>' : '';
    return `${allow}${failed}<ul class="rf-list hl-src" data-key="sources">${rows.join('')}</ul>${connect}${errs}
      <p class="t-footnote rf-muted hl-src-note">Reads sleep, steps, weight, height, body fat, heart rate, resting heart rate, HRV, active calories, distance and workouts${GH.food && GH.food.full(S) ? ', plus meals from other apps' : ''}. Syncs when you open the app and every 15 minutes while it's open. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="openPrivacy">Privacy</button></p>`;
  }
  U.act.hcSync = async () => {
    U.haptic('tap');
    const r = await U.syncHealth('manual');
    if (r && !r.ok) U.toast('Couldn\'t read Health Connect', 'caution', r.error === 'timeout' ? 'It took too long. Try again.' : undefined);
    else if (r) { U.haptic('refresh'); U.toast('Health data updated', 'positive'); }
  };
  U.on.hcWriteToggle = async (el, ev, v) => {
    const S = U.S;
    if (v && !(H().canWrite && H().canWrite())) {
      const st = await H().request(S);
      if (!(H().canWrite && H().canWrite())) { U.revertSwitch(el); U.toast('Not allowed yet', 'caution', 'Turn on Exercise under Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() }); return; }
      S.health.status = st;
    }
    S.health.write = !!v;
    U.save();
    if (v) { const n = H().writeRecent ? H().writeRecent(S) : 0; if (n) U.toast(`Saving ${U.plural(n, 'workout')} to Health Connect`, 'positive'); }
  };
  U.act.hcManage = () => H().openSettings();
  // Asked once on the Health tab; Settings keeps a row for it until everything's allowed.
  U.act.hcAllowNew = async () => { U.S.health.askedNew = Date.now(); await U.act.hcConnect(); };
  U.act.hcSkipNew = () => { U.S.health.askedNew = Date.now(); U.commit(); U.haptic('dismiss'); };
  U.act.hcConnect = async () => {
    const st = await H().request(U.S);
    U.S.health.status = st;
    if (H().connected(st)) { await U.syncHealth('manual'); U.toast('Health Connect connected', 'positive'); if (U.checklistCheck) U.checklistCheck(); }
    else if (st === 'denied') U.toast('Not connected', 'caution', 'Allow access in Health Connect to use your data.', { label: 'Open', onClick: () => H().openSettings() });
    U.commit();
  };
  U.act.openPrivacy = () => { const t = U.topSheet(); if (t) t.close('ok'); U.open('privacy'); };
  // Older links into explainers now open the numbers themselves (the explanation is under About).
  U.act.whyEstimate = () => U.metricSheet('rhr');
  U.act.whyNoData = () => U.metricSheet('hrv');

  /* ---------------------------------------------------------------- logging (the + menu) */
  function logMenu() {
    const item = (act, icon, label) => `<button type="button" class="rf-menu-item" role="menuitem" data-act="${act}">${U.icon(icon)}<span>${label}</span></button>`;
    return `<button type="button" class="rf-btn rf-glass" data-shape="circle" data-lens aria-label="Log something" aria-haspopup="menu" popovertarget="hlLog">${U.icon('plus')}</button>
      <div class="rf-menu rf-glass hl-log" data-variant="thick" id="hlLog" popover="auto" aria-label="Log" data-placement="below">
        ${item('logWeight', 'scale', 'Weight')}${item('logSleep', 'moon', 'Sleep')}${item('logFeel', 'sparkle', 'Feel check')}${item('logActivity', 'bolt', 'Other exercise')}${item('logMeasure', 'pin', 'Measurements')}
      </div>`;
  }
  const unitLen = () => (U.S.profile.units === 'kg' ? 'cm' : 'in');
  // Weight and sleep use the same form as a metric's Add or change, for today.
  U.act.logWeight = () => U.metricEdit('weightKg', U.today());
  U.act.logSleep = () => U.metricEdit('sleepMin', U.today());
  U.act.logFeel = () => U.metricSheet('feel');
  // Each time it opens the type starts at Walk, as its picked chip does.
  U.act.logActivity = () => {
    actType = 'Walk';
    return U.sheet({
      title: 'Log other exercise', size: 'auto',
      body: `<div class="sheet-pad">${U.choice('actType', ['Walk', 'Run', 'Cycling', 'Sport', 'Gym', 'Swim', 'Yoga', 'Other'].map((t) => [t, t]), 'Walk', 'Activity', ' class="ob-chips" id="actTypes" data-on="actType"')}
        <p class="t-callout rf-muted">Minutes</p><div class="ob-center">${U.stepper('actMin', 30, 5, 300, 'Minutes', '', 5)}</div>
        <p class="t-footnote rf-muted">45 min or more of hard exercise means easier legs and no finisher the next day.</p></div>`,
      action: { label: 'Save', act: 'logActivitySave' },
    });
  };
  let actType = 'Walk';
  U.on.actType = (el, ev, v) => { if (v) actType = v; };
  U.act.logActivitySave = () => {
    const m = parseInt(document.getElementById('actMin').value, 10);
    if (m > 0) {
      H().logManual(U.S, U.today(), { exercise: { typeName: actType.toLowerCase(), minutes: m } });
      if (/walk/i.test(actType) && m >= 10) { const p = B().todayPlan(U.S, U.today()); if (p.type === 'light') B().logLight(U.S, U.today(), 'walk', 'manual-walk'); }
    }
    const t = U.topSheet(); if (t) t.close('ok');
    U.commit();
    if (U.refreshMetricSheet) U.refreshMetricSheet();
    U.haptic('log');
    U.toast('Activity saved', 'positive');
  };
  U.act.logMeasure = () => {
    const last = (U.S.measurements || []).slice(-1)[0] || {};
    const u = unitLen();
    const val = (k) => (last[k] == null ? '' : (u === 'cm' ? last[k] : last[k] / 2.54).toFixed(1));
    const f = (k, label) => `<div class="rf-field"><label class="rf-field-label" for="m-${k}">${label} (${u})</label><div class="rf-field-control"><input class="rf-input" id="m-${k}" type="number" inputmode="decimal" step="0.1" placeholder="${val(k)}"></div></div>`;
    U.sheet({
      title: 'Measurements', size: 'auto',
      body: `<div class="sheet-pad ob-fields">${f('waist', 'Waist, at the belly button')}<div class="ob-row2">${f('armL', 'Left arm, flexed')}${f('armR', 'Right arm, flexed')}</div>${f('chest', 'Chest')}${f('thigh', 'Thigh')}
        <p class="t-footnote rf-muted">Once a month, same time of day. Leave any blank. Arms show whether the left side is catching up.</p></div>`,
      action: { label: 'Save', act: 'logMeasureSave' },
    });
  };
  U.act.logMeasureSave = () => {
    const u = unitLen();
    const m = {};
    for (const k of ['waist', 'armL', 'armR', 'chest', 'thigh']) { const v = parseFloat(document.getElementById('m-' + k).value); if (v > 0) m[k] = u === 'cm' ? v : v * 2.54; }
    const saved = H().addMeasurement(U.S, U.today(), m);
    const t = U.topSheet(); if (t) t.close('ok');
    if (saved) { U.commit(); if (U.refreshMetricSheet) U.refreshMetricSheet(); U.haptic('log'); U.toast('Measurements saved', 'positive'); }
  };

  /* ---------------------------------------------------------------- the screen */
  let sparksSeen = false;
  U.screens.health = {
    render(S, day) {
      const ins = GH.insights.top(S, day, 5);
      GH.insights.markShown(S, ins, day);
      const connected = H().connected(H().status());
      const busy = U.syncState().busy;
      const top = `${U.tip ? U.tip('health') : ''}${weekCard(S, day)}`;
      return `${U.navbar('Health', `${logMenu()}${connected ? U.glassBtn('refresh', 'Sync health data now', 'hcSync', `data-sync-spin${busy ? ' data-spinning' : ''}`) : ''}`)}
        <h1 class="rf-large-title">Health</h1>
        ${connected ? `<p class="lt-sub t-footnote rf-muted">${busy ? 'Syncing with Health Connect…' : `Synced <span data-ago="${S.health.lastSync || 0}">${U.esc(U.ago(S.health.lastSync))}</span>. Pull down to sync.`}</p>` : ''}
        ${top ? `<div class="section">${top}</div>` : ''}
        <h2 class="sec-title t-title-3">Today</h2>
        <div class="section hl-today">${todaySection(S, day)}</div>
        <h2 class="sec-title t-title-3">Insights</h2>
        <div class="section">${insights(ins)}</div>
        <h2 class="sec-title t-title-3 hl-sec">Trends<span class="hl-sec-aside t-footnote">Last 28 days</span></h2>
        <div class="section">${trends(S, day)}</div>
        <h2 class="sec-title t-title-3">Activity</h2>
        <div class="section">${activity(S, day)}</div>
        <h2 class="sec-title t-title-3">Sources</h2>
        <div class="section">${sources(S)}</div>`;
    },
    shown(S, day) {
      if (AI() && AI().needsReport(S, day) && ai.tried !== day && !ai.busy) writeReport(true);
    },
    after(root, S, day) {
      // The sparklines draw in this once (src/styles/health.css).
      if (!sparksSeen) { sparksSeen = true; setTimeout(() => G.document.documentElement.setAttribute('data-sparks-seen', ''), 1200); }
      if (AI() && AI().needsReport(S, day) && ai.tried !== day && !ai.busy) setTimeout(() => writeReport(true), 50);
      // A sync or a change elsewhere: open sheets show the new numbers too.
      if (U.refreshMetricSheet) U.refreshMetricSheet();
      refreshReport();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
