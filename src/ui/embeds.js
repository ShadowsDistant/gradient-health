/* Data embeds (GH.embeds): an answer can show the app's own numbers next to its words. A model only
 * names one, alone on a line: [[sleep]], [[steps:30d]], [[weight:90d]], [[rhr]], [[hrv]],
 * [[protein]], [[workouts]] (this week's, done and planned), [[muscles]] (this week's sets per muscle
 * group against target), [[streak]], [[lift:push_std]] (how one move has gone, by id or by name).
 * What each shows is worked out here when it's drawn, from the same numbers the Health, Progress and
 * Plan screens show (GH.health's history and versus, the brain's calendar and weekly sets, Progress's
 * estimated maxes), so an embed can't be wrong; the chat (src/ui/chat.js) draws it as a small card
 * with a sparkline or bars from src/ui/charts.js, and a tap opens the sheet or screen it comes from.
 * Ranges: 7 days (the default; 30 for weight, 90 for a move), 30 or 90.
 *
 * With src/ui/md.js this is the chat's part that loads when it's needed (scripts/build.mjs APP_CHUNKS,
 * 'cards'). forQuestion() is what an on-device answer shows after its words, and a Claude answer
 * that didn't place one itself: at most two, from what the question is about, only with data.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  const METRIC = { sleep: 'sleepMin', steps: 'steps', rhr: 'rhr', hrv: 'hrv', weight: 'weightKg', protein: 'protein' };
  const KINDS = ['sleep', 'steps', 'rhr', 'hrv', 'weight', 'protein', 'workouts', 'muscles', 'streak', 'lift'];
  const ALIAS = { heart: 'rhr', resting: 'rhr', restinghr: 'rhr', hr: 'rhr', sets: 'muscles', week: 'workouts', move: 'lift', exercise: 'lift' };
  // What a token asks for: { kind, range, arg, token } (token: the same, written out in full), or
  // null for one the app can't draw.
  function spec(token) {
    const m = /^\s*([a-z]+)\s*(?::(.*))?$/i.exec(String(token || ''));
    if (!m) return null;
    const kind = ALIAS[m[1].toLowerCase()] || m[1].toLowerCase();
    if (!KINDS.includes(kind)) return null;
    let arg = (m[2] || '').trim();
    let range = kind === 'weight' ? 30 : kind === 'lift' ? 90 : 7;
    const r = /(?:^|:)\s*(\d{1,3})\s*([dwm])?\s*$/i.exec(arg);
    if (r && (kind !== 'lift' || r.index > 0)) {
      const days = Number(r[1]) * ({ w: 7, m: 30 }[(r[2] || 'd').toLowerCase()] || 1);
      range = days <= 14 ? 7 : days <= 45 ? 30 : 90;
      arg = arg.slice(0, r.index).trim();
    }
    if (kind === 'lift' && !arg) return null;
    const ranged = kind !== 'workouts' && kind !== 'muscles' && kind !== 'streak';
    return { kind, range: ranged ? range : 7, arg: kind === 'lift' ? arg : '', token: `${kind}${kind === 'lift' ? `:${arg}` : ''}${ranged ? `:${range}d` : ''}` };
  }
  // The embeds an answer names that the app can draw, each once.
  function tokens(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/\[\[([^[\]\n]{1,60})\]\]/g)) { const sp = spec(m[1]); if (sp && !out.includes(sp.token)) out.push(sp.token); }
    return out;
  }

  // A move named in [[lift:…]]: its id, a ladder's (its current rung) or a name.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  function moveOf(S, arg) {
    const MV = GH.moves;
    if (!MV) return null;
    const a = String(arg || '').trim();
    if (has(MV.MOVES, a)) return a;
    const n = norm(a);
    const fam = has(MV.LADDERS, a) ? a : Object.keys(MV.LADDERS).find((f) => norm(MV.LADDERS[f].name) === n);
    if (fam) { const st = S.prog && S.prog[fam]; return st && has(MV.MOVES, st.rung) ? st.rung : MV.LADDERS[fam].rungs[0]; }
    return Object.keys(MV.MOVES).find((id) => norm(MV.MOVES[id].name) === n) || null;
  }
  const WDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // A day as Progress's calendar marks it: work (a workout done), light, miss, plan, rest.
  function dayKind(cal, d, day) {
    const i = cal.days[d];
    if (!i || i.planned === 'none') return 'rest';
    if (i.done) return i.planned === 'workout' ? 'work' : 'light';
    if (i.missed) return 'miss';
    return i.planned === 'workout' && d >= day ? 'plan' : 'rest';
  }

  const DATA = {
    // A health number: this week's against the usual, as Health shows it, over the range asked.
    metric(S, day, sp) {
      const h = H(), key = METRIC[sp.kind], m = h.METRICS[key];
      if (key === 'protein' && (S.profile.protein.track === false || (GH.food && GH.food.mode && GH.food.mode(S) === 'off'))) return { kind: sp.kind, empty: 'Protein tracking is off' };
      const from = day - sp.range + 1;
      const points = h.history(S, key, from, day).map((e) => ({ day: e.day, value: e.value }));
      if (!points.length) return { kind: sp.kind, empty: `No ${{ rhr: 'resting heart rate', hrv: 'HRV' }[sp.kind] || m.label.toLowerCase()} data ${sp.range === 7 ? 'this week' : 'yet'}` };
      const v = h.versus(S, key, day, 'week');
      const out = {
        kind: sp.kind, key, token: sp.token, title: m.short, icon: m.icon, tone: m.tone,
        range: `Last ${sp.range} ${key === 'sleepMin' ? 'nights' : 'days'}`,
        value: v ? v.value : points[points.length - 1].value,
        per: `${{ sleepMin: 'a night', steps: 'a day', protein: 'a day', weightKg: '7-day average' }[key] || 'average'}${sp.range > 7 && key !== 'weightKg' ? ' this week' : ''}`,
        chart: { kind: m.kind === 'bar' ? 'bar' : 'line', points, from, to: day, gap: key === 'weightKg' ? 21 : 7 },
        open: { act: 'metric', arg: key, range: sp.range === 30 ? 28 : sp.range },
      };
      if (v && v.usual != null && v.dir) out.vs = { trend: v.dir === 'flat' ? 'steady' : h.formatDelta(S, key, v.delta, v.rel), dir: v.dir, tone: v.tone, text: key === 'weightKg' ? 'on the week before' : `against your usual ${h.format(S, key, v.usual)}` };
      if (sp.range > 7) {
        const st = h.rangeStats(S, key, from, m.daily ? day - 1 : day);
        if (st.change != null) out.over = `${Math.abs(st.change) < 1e-9 ? 'No change' : h.formatDelta(S, key, st.change, st.changeRel)} over ${sp.range} days`;
      }
      if (key === 'protein') { const g = B().proteinGoal(S, day); if (g) out.note = `Goal ${g} g a day`; }
      if (key === 'steps') out.note = `Goal ${h.format(S, key, B().stepsGoal(S, day).goal)} a day`;
      return out;
    },
    // This week's workouts, done and planned, a day each.
    workouts(S, day) {
      if (S.profile.workouts === false) return null;
      const b = B(), cal = b.calendar(S, day), ws = b.weekStart(day), week = cal.weeks[ws];
      const sessions = week ? week.sessions.filter((s) => !s.dropped && s.day != null) : [];
      if (!sessions.length) return { kind: 'workouts', empty: 'No workouts planned this week' };
      const days = [];
      for (let d = ws; d < ws + 7; d++) days.push({ day: d, k: dayKind(cal, d, day), today: d === day });
      const done = days.filter((x) => x.k === 'work').length, missed = days.filter((x) => x.k === 'miss').length;
      const next = days.find((x) => x.k === 'plan');
      return {
        kind: 'workouts', token: 'workouts', title: 'Workouts', icon: 'calendar', tone: 'indigo', range: 'This week',
        text: `${done} of ${Math.max(sessions.length, done)}`, per: 'done',
        note: missed ? `${missed === 1 ? 'One' : missed} missed` : next ? `Next: ${next.day === day ? 'today' : WDAY[next.day - ws]}` : 'All done this week',
        chart: { kind: 'days', days }, open: { act: 'tab', arg: 'plan' },
      };
    },
    // This week's sets per muscle group against their targets, as Progress shows them.
    muscles(S, day) {
      if (S.profile.workouts === false) return null;
      const b = B(), ws = b.weeklySets(S, day);
      const rows = b.GROUPS.filter((g) => ws[g] && ws[g].target > 0).map((g) => ({ name: b.GROUP_NAME[g], done: ws[g].done, target: ws[g].target }));
      if (!rows.length) return { kind: 'muscles', empty: 'No sets planned this week' };
      const done = rows.reduce((a, r) => a + r.done, 0), target = rows.reduce((a, r) => a + r.target, 0);
      const left = rows.filter((r) => r.done < r.target).length;
      return {
        kind: 'muscles', token: 'muscles', title: 'Sets per muscle group', icon: 'layers', tone: 'teal', range: 'This week',
        text: `${done} of ${target}`, per: 'sets', note: left ? `${left} of ${rows.length} groups to go` : 'Every group at its target',
        chart: { kind: 'meters', rows }, open: { act: 'progress' },
      };
    },
    // The streak, with the last four weeks a day each.
    streak(S, day) {
      if (!S.log.some((l) => l.type === 'workout' || l.type === 'light')) return { kind: 'streak', empty: 'No streak yet. It starts with your next workout' };
      const b = B(), cal = b.calendar(S, day), st = cal.streak;
      const days = [];
      for (let d = b.weekStart(day) - 21; d < b.weekStart(day) + 7; d++) days.push({ day: d, k: d > day ? 'future' : dayKind(cal, d, day), today: d === day });
      return {
        kind: 'streak', token: 'streak', title: 'Streak', icon: 'flame', tone: 'amber', range: 'Last 4 weeks',
        text: String(st.current), per: st.current === 1 ? 'day' : 'days',
        note: st.best > st.current ? `Best ${st.best}` : st.current ? 'Your best so far' : 'The next workout starts one',
        chart: { kind: 'days', days }, open: { act: 'progress' },
      };
    },
    // One move: a gym lift's estimated max (as Progress draws it), else each workout's best set: its
    // weight when that went up, else its reps (or seconds) at the weight it has.
    lift(S, day, sp) {
      const id = moveOf(S, sp.arg);
      const mv = id && GH.moves.MOVES[id];
      if (!mv) return null;
      const b = B(), from = day - sp.range + 1, units = S.profile.units === 'kg' ? 'kg' : 'lb';
      let points = [], what = 'max', at = '';
      const st = Object.values(S.prog || {}).find((x) => x && x.e1rm && x.e1rm[id] && (x.e1rm[id].hist || []).length);
      if (st) points = st.e1rm[id].hist.filter((x) => x[0] >= from && x[0] <= day).map(([d, kg]) => ({ day: d, value: b.toUnit(kg, units) }));
      else {
        const best = {}; // day → { load (kg), amount }
        for (const l of S.log) {
          if (l.type !== 'workout' || !l.checkedIn || l.day < from || l.day > day) continue;
          for (const it of l.items || []) {
            if (it.moveId !== id || it.kind !== 'move') continue;
            const t = best[l.day] || (best[l.day] = { load: 0, amount: 0 });
            for (const x of it.sets || []) if (x && x.amount > 0) { t.load = Math.max(t.load, x.load > 0 ? x.load : 0); t.amount = Math.max(t.amount, x.amount); }
          }
        }
        const loads = new Set(Object.values(best).map((t) => t.load).filter((x) => x > 0));
        const loaded = loads.size > 1;
        what = loaded ? 'weight' : mv.timed ? 'time' : 'reps';
        if (loads.size === 1) at = ` at ${Math.round(b.toUnit([...loads][0], units) * 2) / 2} ${units}`;
        points = Object.keys(best).map(Number).sort((a, c) => a - c).filter((d) => (loaded ? best[d].load > 0 : best[d].amount > 0)).map((d) => ({ day: d, value: loaded ? b.toUnit(best[d].load, units) : best[d].amount }));
      }
      if (!points.length) return { kind: 'lift', empty: `No ${mv.name.toLowerCase()} logged ${sp.range < 90 ? `in the last ${sp.range} days` : 'yet'}` };
      const unit = what === 'reps' ? 'reps' : what === 'time' ? 's' : units;
      const r = (v) => (unit === 'kg' ? Math.round(v * 2) / 2 : Math.round(v));
      const last = points[points.length - 1], first = points[0];
      const delta = r(last.value) - r(first.value);
      const fam = Object.keys(GH.moves.LADDERS).find((f) => S.prog && S.prog[f] && S.prog[f].rung === id && !GH.moves.LADDERS[f].gym);
      const lv = fam ? b.ladderLevel(S, fam, day) : null;
      return {
        kind: 'lift', token: sp.token, title: mv.name, icon: 'dumbbell', tone: 'indigo', range: `Last ${sp.range} days`,
        text: String(r(last.value)), unit, per: what === 'max' ? 'estimated max' : `best set${at}`,
        vs: points.length > 1 && delta ? { trend: `${delta > 0 ? '+' : '-'}${Math.abs(delta)} ${unit}`, dir: delta > 0 ? 'up' : 'down', tone: delta > 0 ? 'good' : 'neutral', text: `since ${b.fmtDay(first.day, false)}` } : null,
        note: lv ? `Level ${lv.level} of ${lv.of}` : '',
        chart: { kind: 'line', points, from: Math.min(from, first.day), to: day, gap: 45 }, open: { act: 'move', arg: id },
      };
    },
  };
  // What an embed shows: { kind, token, title, icon, tone, range, value (a metric's, stored units) |
  // text, unit?, per, vs?, over?, note?, chart, open }; { kind, empty } when it has nothing to show
  // yet; null for one the app can't draw.
  function data(S, day, token) {
    const sp = spec(token);
    if (!sp) return null;
    try { return (METRIC[sp.kind] ? DATA.metric : DATA[sp.kind])(S, day, sp); } catch (e) { return null; }
  }
  // At most two for a question, from what it's about (the built-in coach's topic), only with data.
  function forQuestion(S, day, question) {
    const topic = GH.coach ? GH.coach.topicOf(question) : null;
    let list = { sleep: ['sleep'], steps: ['steps'], weight: ['weight'], protein: ['protein'], heart: ['rhr', 'hrv'], streak: ['streak', 'workouts'], deload: ['workouts'], focus: ['workouts', 'muscles'] }[topic] || [];
    if (topic === 'today') {
      const kinds = B().readiness(S, day).reasons.map((x) => ({ sleep: 'sleep', rhr: 'rhr', hrv: 'hrv' })[x.kind]).filter(Boolean);
      list = kinds.length ? kinds : ['workouts'];
    }
    if (topic === 'strength') {
      const line = GH.body ? GH.body.improved(S, day, 4).lines.filter((x) => x.dir > 0).sort((a, c) => c.rank - a.rank)[0] : null;
      list = (line ? [`lift:${line.id}`] : []).concat(['muscles']);
    }
    const out = [];
    for (const t of list) {
      const d = out.length < 2 ? data(S, day, t) : null;
      if (d && !d.empty && !out.includes(d.token)) out.push(d.token);
    }
    return out;
  }

  /* ---------------------------------------------------------------- the card */
  function chart(d) {
    const c = d.chart;
    if (c.kind === 'meters') return U.meterRows(c.rows);
    if (c.kind === 'days') {
      const week = c.days.length === 7;
      return `<span class="emb-days" data-n="${c.days.length}">${c.days.map((x) => `<span class="emb-day"><i class="hm-cell hm-${x.k}${x.today ? ' hm-today' : ''}"></i>${week ? `<b>${'MTWTFSS'[x.day - c.days[0].day]}</b>` : ''}</span>`).join('')}</span>`;
    }
    return U.spark(c.points, { from: c.from, to: c.to, kind: c.kind, gap: c.gap }) || '';
  }
  // A card: the title and range, the number with its unit and how it compares, a line of context and
  // the chart. A tap opens where it comes from (U.act.embedOpen).
  function card(S, d) {
    const val = d.key ? U.metricNum(S, d.key, d.value) : `<span class="mv"><span class="rf-num">${U.esc(d.text)}</span>${d.unit ? `<small>${U.esc(d.unit)}</small>` : ''}</span>`;
    const cap = [d.vs && d.vs.text, d.over, d.note].filter(Boolean).map(U.esc).join(' · ');
    return `<button type="button" class="emb" data-tone="${U.esc(d.tone)}" data-kind="${U.esc(d.kind)}" data-act="embedOpen" data-arg="${U.esc(d.token)}" aria-label="${U.esc(`${d.title}, ${d.range}. Open`)}">
      <span class="emb-top"><span class="emb-ico" aria-hidden="true">${U.icon(d.icon, 'sm')}</span><span class="emb-title">${U.esc(d.title)}</span><span class="emb-range">${U.esc(d.range)}</span><span class="emb-go" aria-hidden="true">${U.icon('chevron-right', 'sm')}</span></span>
      <span class="emb-main"><span class="emb-val">${val}</span><span class="emb-per">${U.esc(d.per)}</span>${d.vs ? U.trendChip(d.vs) : ''}</span>
      ${cap ? `<span class="emb-cap">${cap}</span>` : ''}
      <span class="emb-chart">${chart(d)}</span>
    </button>`;
  }
  // An embed as the chat shows it: its card; one with nothing to show yet as a muted line; one the
  // app can't draw, nothing.
  function html(S, day, token) {
    const d = data(S, day, token);
    return !d ? '' : d.empty ? `<p class="emb-none">${U.icon('chart', 'sm')}<span>${U.esc(d.empty)}</span></p>` : card(S, d);
  }
  U.act.embedOpen = (el) => {
    const d = data(U.S, U.today(), el.dataset.arg);
    const o = d && d.open;
    if (!o) return;
    // A number's sheet and a move's open over the chat; Plan and Progress once it's put away.
    if (o.act === 'metric') { U.metricSheet(o.arg, { range: o.range }); return; }
    if (o.act === 'move') { U.moveSheet(o.arg); return; }
    U.closeSheets();
    setTimeout(() => { if (o.act === 'tab') U.go(o.arg); else if (U.hasTab('progress')) U.go('progress'); else U.open('progress'); }, 320);
  };

  GH.embeds = { KINDS, spec, tokens, data, forQuestion, card, html };
})(typeof window !== 'undefined' ? window : globalThis);
