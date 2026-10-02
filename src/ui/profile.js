/* Your numbers (workouts, streaks, sets, time trained, level-ups, personal bests), your name, and
 * What's new with every version. Profile itself became the You tab (src/ui/you.js); its numbers show
 * there and in Progress's Totals.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  /* ---------------------------------------------------------------- numbers */
  function stats(S, day) {
    const b = B();
    const cal = b.calendar(S, day);
    const done = S.log.filter((l) => l.type === 'workout' && b.isDone(l));
    let minutes = 0, sets = 0;
    for (const l of done) {
      sets += l.doneSets || 0;
      if (l.startedAt && l.endedAt && l.endedAt > l.startedAt) minutes += Math.min(180, (l.endedAt - l.startedAt) / 60000);
    }
    const cel = S.log.flatMap((l) => l.celebrate || []);
    const tests = S.catchup.arm.tests || [];
    // Longest run of days hitting the protein goal.
    let run = 0, bestRun = 0;
    for (let d = S.profile.startDay; d <= day; d++) {
      const g = b.proteinGoal(S, d);
      if (g && b.proteinToday(S, d) >= g * 0.95) { run++; bestRun = Math.max(bestRun, run); } else if (d < day) run = 0;
    }
    return {
      cal, workouts: done.length, minutes, sets, current: cal.streak.current, best: cal.streak.best,
      weekly: cal.streak.weekly, weeklyBest: Math.max(cal.streak.weeklyBest || 0, cal.streak.weekly || 0),
      ups: cel.filter((c) => c.kind !== 'pr').length, prs: cel.filter((c) => c.kind === 'pr').length,
      caughtUp: tests.length >= 2 && tests.some((t) => t.gap >= 0.1) && tests[tests.length - 1].gap < 0.1,
      proteinRun: bestRun, connected: H().connected(H().status()),
      weeks: new Set(done.map((l) => b.weekStart(l.day))).size,
    };
  }
  U.profileStats = stats;
  // Time trained: "45 min", "3 h 20", "12 h".
  U.fmtTrained = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${m ? m : ''}`.trim() : `${m} min`; };

  /* ---------------------------------------------------------------- your name, the app's pages */
  // Old ways in to Profile land on the You tab.
  U.act.openProfile = () => U.go('you');
  U.act.openSettings = () => U.open('settings');
  U.act.openTracking = () => U.open('settings', 'track');
  U.act.openScience = (el) => U.open('science', el && el.dataset && el.dataset.arg ? el.dataset.arg : null);
  U.act.openWhatsNew = () => U.open('whatsnew');
  U.act.editName = () => {
    const ctl = U.sheet({
      title: 'Your name', size: 'fit',
      body: `<div class="sheet-pad"><div class="rf-field"><div class="rf-field-control"><input class="rf-input" id="nameIn" type="text" maxlength="40" autocomplete="given-name" placeholder="First name" value="${U.esc(U.S.profile.name || '')}"></div><p class="rf-field-hint">Only shown here. It stays on this phone and is never sent to a coach.</p></div></div>`,
      action: { label: 'Save', act: 'nameSave' },
    });
    setTimeout(() => { const i = ctl.el.querySelector('#nameIn'); if (i) i.focus(); }, 350);
  };
  U.act.nameSave = () => {
    const v = ((document.getElementById('nameIn') || {}).value || '').trim().slice(0, 40);
    U.S.profile.name = v;
    const t = U.topSheet(); if (t) t.close('ok');
    U.commit();
  };

  /* ---------------------------------------------------------------- What's new (all versions) */
  U.screens.whatsnew = {
    render() {
      const list = GH.CHANGELOG || [];
      return `${U.navbar('What\'s new', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">What's new</h1>
        ${list.map((e) => `<h2 class="sec-title t-title-3">Version ${U.esc(e.version)} <span class="t-callout rf-muted">${U.esc(B().fmtDay(B().dayFromStr(e.date), false))}</span></h2>
          <div class="section"><p class="t-callout rf-muted news-title">${U.esc(e.title)}</p>${U.changesHtml(e)}</div>`).join('')}`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
