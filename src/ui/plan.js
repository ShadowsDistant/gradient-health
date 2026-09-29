/* Plan: this week's seven days (done, missed, frozen, moved), tap a day to preview or move it,
 * and next week at a glance.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function dayRow(S, day, d, cal, week) {
    const info = cal.days[d] || { planned: 'none' };
    const s = week && week.sessions.find((x) => x.day === d && !x.dropped);
    const log = S.log.find((l) => l.type === 'workout' && l.day === d && B().isDone(l));
    const light = S.log.find((l) => l.type === 'light' && l.day === d);
    const label = `<span class="plan-wd${d === day ? ' is-today' : ''}">${WD[B().weekday(d)]}</span>`;
    let o;
    if (d < S.profile.startDay) o = { title: `${label} Before you started`, icon: 'minus', tone: 'indigo', cls: 'is-muted' };
    else if (log) o = { title: `${label} ${U.esc(log.title)}`, sub: `${log.doneSets} of ${log.planned} sets`, icon: 'check', tone: 'green', detail: 'Done' };
    else if (info.missed) o = { title: `${label} Missed`, sub: info.frozen ? 'Freeze used, streak kept. The week moved forward a day.' : 'Streak reset. The week moved forward a day.', icon: info.frozen ? 'pause' : 'x-circle', tone: info.frozen ? 'sky' : 'rose' };
    else if (s) {
      const est = B().buildSession(S, d, s.tpl, { cal, noReadiness: d !== day }).estimateMin;
      o = { title: `${label} ${U.esc(B().templateTitle(s.units))}`, sub: d === day ? `Today · about ${est} min` : `About ${est} min`, icon: 'bolt', tone: 'indigo', act: d >= day ? 'planDay' : null, arg: d, chevron: d >= day };
    } else if (info.planned === 'light') {
      const both = light && light.walk && light.mobility;
      o = { title: `${label} Light day`, sub: both ? 'Walk and mobility done' : light && (light.walk || light.mobility) ? `${light.walk ? 'Walk' : 'Mobility'} done` : 'Walk and mobility', icon: both ? 'check' : 'leaf', tone: both ? 'green' : 'teal', detail: both ? 'Done' : null };
    } else o = { title: `${label} Rest`, icon: 'moon', tone: 'indigo' };
    return U.row(o);
  }

  U.screens.plan = {
    render(S, day) {
      const cal = B().calendar(S, day);
      const ws = B().weekStart(day);
      const week = cal.weeks[ws];
      const rows = [];
      for (let d = ws; d < ws + 7; d++) rows.push(dayRow(S, day, d, cal, week));
      const phase = week && week.phase;
      const phaseLine = !phase ? '' : phase.deload ? 'Deload week: about 40% less volume so you come back stronger.' : phase.onramp ? `Easing in: about ${Math.round(phase.mult * 100)}% of full volume.` : 'Full volume.';
      const notice = cal.notices.filter((n) => n.day >= ws).slice(-1)[0];
      // Next week from the current settings.
      const p = S.profile;
      const tpl = B().templateFor(p, B().programFor(p));
      const next = [];
      for (let wd = 0; wd < 7; wd++) {
        const t = tpl.find((x) => x.offset === wd);
        next.push(U.row({ title: `<span class="plan-wd">${WD[wd]}</span> ${t ? U.esc(B().templateTitle(t.units)) : p.lightDays === false ? 'Rest' : 'Light day'}`, icon: t ? 'bolt' : p.lightDays === false ? 'moon' : 'leaf', tone: t ? 'indigo' : 'teal', cls: 'is-muted' }));
      }
      return `${U.navbar('Plan')}
        <h1 class="rf-large-title">This week</h1>
        <p class="lt-sub t-callout rf-muted">Week ${week ? week.trainingWeek : 1} · ${U.esc(phaseLine)}</p>
        <div class="section">
          <ul class="rf-list plan-list">${rows.join('')}</ul>
          ${notice ? `<p class="t-footnote rf-muted">${U.esc(notice.text)} Two workouts never land on the same day; anything past Sunday is dropped.</p>` : '<p class="t-footnote rf-muted">Tap an upcoming workout to preview it or move it to a free day.</p>'}
        </div>
        <h2 class="sec-title t-title-3">Next week</h2>
        <div class="section"><ul class="rf-list plan-list">${next.join('')}</ul>
          <button type="button" class="rf-btn" data-act="daysSheet">Change days and time</button>
        </div>`;
    },
  };

  U.act.planDay = (el) => {
    const S = U.S;
    const day = U.today();
    const d = Number(el.dataset.arg);
    const cal = B().calendar(S, day);
    const week = cal.weeks[B().weekStart(day)];
    const s = week && week.sessions.find((x) => x.day === d && !x.dropped);
    if (!s) return;
    const sess = B().buildSession(S, d, s.tpl, { cal, noReadiness: d !== day });
    const free = [];
    for (let x = Math.max(day, week.ws); x < week.ws + 7; x++) if (x !== d && !week.sessions.some((y) => y.day === x && !y.dropped)) free.push(x);
    U.sheet({
      title: `${WD[B().weekday(d)]}: ${B().templateTitle(s.units)}`, detents: 'medium large',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">About ${sess.estimateMin} min · ${sess.groups.map((g) => U.esc(B().GROUP_NAME[g] || g)).join(', ')}</p></div>
        ${U.sessionRows(S, sess)}
        ${free.length ? `<div class="sheet-pad"><p class="t-headline">Move to</p><div class="ob-chips">${free.map((x) => `<button type="button" class="rf-chip" data-act="planMove" data-arg="${d}:${x}">${WD[B().weekday(x)]}${x === day ? ' (today)' : ''}</button>`).join('')}</div></div>` : ''}
        ${d === day ? '<div class="sheet-pad"><button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="planStart">Start now</button></div>' : ''}`,
    });
  };
  U.act.planMove = (el) => {
    const [from, to] = el.dataset.arg.split(':').map(Number);
    const ok = B().moveSession(U.S, from, to, U.today());
    const t = U.topSheet(); if (t) t.close('ok');
    if (ok) { U.commit(); U.toast(`Moved to ${B().fmtDay(to)}`, 'positive'); }
    else U.toast('Couldn\'t move it there', 'caution');
  };
  U.act.planStart = () => { const t = U.topSheet(); if (t) t.close('ok'); U.go('today'); U.act.startWorkout(); };
})(typeof window !== 'undefined' ? window : globalThis);
