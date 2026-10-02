/* The You tab: who you are and what you've done (your card, Progress when Food has its tab, your
 * badges), your plans, your answers, and the way to Settings, help, What's new and privacy. It took
 * over from Profile, which only opened from an unlabelled button on Today.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  /* ---------------------------------------------------------------- achievements */
  // The twelve achievements from before 1.6, moved here from Profile unchanged. src/ui/badges.js
  // (loaded after this file) replaces all three exports with the badges; the workout check-in uses
  // whichever is there.
  const ACH = [
    { id: 'first', icon: 'play', tone: 'green', title: 'First workout', need: 'Finish a workout', prog: (x) => [x.workouts, 1] },
    { id: 'streak7', icon: 'flag', tone: 'amber', title: '7-day streak', need: 'Keep a streak for a week', prog: (x) => [x.best, 7] },
    { id: 'levelup', icon: 'arrow-up-right', tone: 'green', title: 'Level up', need: 'Move up a level', prog: (x) => [x.ups, 1] },
    { id: 'w10', icon: 'bolt', tone: 'indigo', title: '10 workouts', need: 'Finish 10 workouts', prog: (x) => [x.workouts, 10] },
    { id: 'weeks4', icon: 'calendar', tone: 'sky', title: 'Four full weeks', need: 'Four weeks in a row with every workout done', prog: (x) => [x.weeklyBest, 4] },
    { id: 'pr', icon: 'star', tone: 'amber', title: 'Personal best', need: 'Beat a best set', prog: (x) => [x.prs, 1] },
    { id: 'protein7', icon: 'check-circle', tone: 'teal', title: 'Protein week', need: 'Hit your protein goal 7 days in a row', prog: (x) => [x.proteinRun, 7] },
    { id: 'even', icon: 'shuffle', tone: 'coral', title: 'Caught up', need: 'Even out your sides', prog: (x) => [x.caughtUp ? 1 : 0, 1] },
    { id: 'streak30', icon: 'flag', tone: 'rose', title: '30-day streak', need: 'Keep a streak for 30 days', prog: (x) => [x.best, 30] },
    { id: 'w50', icon: 'bolt', tone: 'violet', title: '50 workouts', need: 'Finish 50 workouts', prog: (x) => [x.workouts, 50] },
    { id: 'connected', icon: 'heart', tone: 'rose', title: 'Connected', need: 'Connect Health Connect', prog: (x) => [x.connected ? 1 : 0, 1] },
    { id: 'w100', icon: 'star', tone: 'amber', title: '100 workouts', need: 'Finish 100 workouts', prog: (x) => [x.workouts, 100] },
  ];
  U.achievements = (S, day) => {
    const x = U.profileStats(S, day);
    return ACH.map((a) => { const [have, need] = a.prog(x); return Object.assign({}, a, { have: Math.min(have, need), goal: need, earned: have >= need }); });
  };
  // New achievements since last time: celebrated once (after a workout, or when You opens).
  U.newAchievements = (S, day) => {
    const got = U.achievements(S, day).filter((a) => a.earned);
    const known = (S.seen && S.seen.ach) || [];
    const fresh = got.filter((a) => !known.includes(a.id));
    if (fresh.length) { S.seen = S.seen || {}; S.seen.ach = got.map((a) => a.id); U.save(); }
    return fresh;
  };
  function celebrate(list) {
    const grid = document.querySelector('.ach-grid');
    for (const a of list) {
      const el = grid && grid.querySelector(`[data-key="ach-${a.id}"] .ach-badge`);
      if (el && G.Refract && G.Refract.burst && !U.reduced()) { try { G.Refract.burst(el, { count: 14 }); } catch (e) { /* ignore */ } }
    }
    U.haptic('celebrate');
  }
  U.celebrateAchievements = celebrate;
  // Until the badges arrive: the achievements as tiles (badge tiles carry data-badge, like the
  // badges' own).
  function achievementTiles(S, day) {
    const ach = U.achievements(S, day);
    const earned = ach.filter((a) => a.earned).length;
    return `<div class="card you-ach" data-key="badges">
      <div class="row-between"><span class="t-headline">Achievements</span><span class="t-footnote rf-muted rf-num">${earned} of ${ach.length}</span></div>
      <div class="ach-grid">${ach.map((a) => `<div class="ach${a.earned ? ' is-earned' : ''}" data-key="ach-${a.id}" data-badge="${a.id}">
        <span class="rf-list-icon ach-badge" data-tone="${a.earned ? a.tone : 'none'}">${U.icon(a.earned ? a.icon : 'lock')}</span>
        <span class="t-footnote ach-title">${U.esc(a.title)}</span>
        <span class="t-caption rf-muted">${a.earned ? 'Earned' : a.goal > 1 ? `${U.num(a.have)} of ${U.num(a.goal)}` : U.esc(a.need)}</span>
      </div>`).join('')}</div>
    </div>`;
  }
  // Earned badges: the badges' own record when it's there (they're kept for good), else the count.
  function badgeCount(S, day) {
    const e = S.achievements && S.achievements.earned;
    if (e && typeof e === 'object') return Object.keys(e).length;
    return U.achievements ? U.achievements(S, day).filter((a) => a && a.earned).length : 0;
  }

  /* ---------------------------------------------------------------- your card */
  function youCard(S, day) {
    const p = S.profile;
    const name = (p.name || '').trim();
    const initials = name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';
    const since = B().fmtDay(p.startDay, false);
    const workouts = p.workouts !== false;
    let line, stats;
    if (workouts) {
      const x = U.profileStats(S, day);
      const week = x.cal.weeks[B().weekStart(day)];
      line = `Training since ${since}${week ? ` · week ${week.trainingWeek}` : ''}`;
      stats = [[x.workouts, x.workouts === 1 ? 'Workout' : 'Workouts'], [x.current, 'Day streak']];
    } else {
      // Without workouts: what's been tracked instead.
      const F = GH.food;
      const weighIns = (S.weights || []).filter((w) => w.src !== 'profile').length;
      line = `Using Gradient Health since ${since}`;
      if (F && F.mode(S) === 'full') {
        let foodDays = 0;
        for (let d = day - 27; d <= day; d++) if (F.totals(S, d).n) foodDays++;
        stats = [[foodDays, 'Food days'], [weighIns, weighIns === 1 ? 'Weigh-in' : 'Weigh-ins']];
      } else stats = [[weighIns, weighIns === 1 ? 'Weigh-in' : 'Weigh-ins'], [H().stats(S, 'sleepMin', day - 27, day).n, 'Nights logged']];
    }
    const n = badgeCount(S, day);
    stats.push([n, n === 1 ? 'Badge' : 'Badges']);
    return `<div class="card you-card" data-key="me">
      <button type="button" class="you-me" data-act="editName" aria-label="${U.esc(name ? `${name}. Change your name` : 'Add your name')}">
        <span class="you-avatar" aria-hidden="true">${initials ? `<span>${U.esc(initials)}</span>` : U.icon('person')}</span>
        <span class="you-who"><span class="you-name">${U.esc(name || 'Add your name')}</span><span class="t-footnote you-since">${U.esc(line)}</span></span>
        ${U.icon('pencil', 'sm', 'you-edit')}
      </button>
      <div class="you-stats">${stats.map(([v, l]) => `<div class="you-stat"><span class="you-n">${U.roll(U.num(v))}</span><span class="you-l">${U.esc(l)}</span></div>`).join('')}</div>
    </div>`;
  }

  // With Food on, Progress isn't a tab: it opens from here (and from Today's streak and Plan).
  function progressCard(S, day) {
    const b = B();
    const recent = S.log.filter((l) => l.type === 'workout' && l.day > day - 28 && l.day <= day && b.isDone(l));
    const ups = recent.reduce((a, l) => a + (l.celebrate || []).filter((c) => c.kind !== 'pr').length, 0);
    const sub = recent.length ? `${U.plural(recent.length, 'workout')}${ups ? ` and ${U.plural(ups, 'level-up')}` : ''} in the last 4 weeks` : 'Your body map, levels and records';
    return `<button type="button" class="card you-link tap-card" data-key="progress" data-act="openProgress">
      <span class="rf-list-icon" data-tone="green">${U.icon('chart')}</span>
      <span class="you-link-text"><span class="t-headline">Progress</span><span class="t-footnote rf-muted">${U.esc(sub)}</span></span>
      ${U.icon('chevron-right', 'sm', 'you-link-go')}
    </button>`;
  }
  U.act.openProgress = () => U.go('progress');

  /* ---------------------------------------------------------------- your plans */
  function plans(S) {
    const rows = [];
    const cp = GH.customPlan;
    if (cp && U.act.openPlans) {
      const id = cp.activeId(S);
      const mine = id ? cp.get(S, id) : null;
      rows.push(U.row({ key: 'plans', icon: 'list', tone: 'violet', title: 'Your plans', sub: U.esc(mine ? `Using ${mine.name}` : 'Using the coach\'s plan. Build your own, or add a shared one.'), act: 'openPlans', chevron: true }));
    }
    if (U.act.tailorPlan) rows.push(U.row({ key: 'tailor', icon: 'sparkle', tone: 'violet', title: 'Tailor my plan', sub: 'Tell the coach what you want more or less of', act: 'tailorPlan', chevron: true }));
    // The AI plan review, once it's in the app (src/planreview.js).
    if (GH.planReview && U.act.reviewPlan) rows.push(U.row({ key: 'review', icon: 'check-circle', tone: 'teal', title: 'Check my plan with AI', sub: 'The coach looks it over and suggests changes for you to approve', act: 'reviewPlan', chevron: true }));
    if (!rows.length) return '';
    return `<h2 class="sec-title t-title-3">Your plans</h2>
      <div class="section"><ul class="rf-list" data-key="plans">${rows.join('')}</ul></div>`;
  }

  /* ---------------------------------------------------------------- the screen */
  U.screens.you = {
    render(S, day) {
      const workouts = S.profile.workouts !== false;
      const food = !!(GH.food && GH.food.full(S));
      const ver = (GH.platform && GH.platform.appVersion()) || GH.VERSION || '';
      const verShort = String(ver).split(' ')[0];
      return `${U.navbar('You', U.glassBtn('sliders', 'Settings', 'openSettings'))}
        <h1 class="rf-large-title">You</h1>
        <div class="section">
          ${U.tip ? U.tip('you') : ''}
          ${youCard(S, day)}
          ${workouts && food ? progressCard(S, day) : ''}
        </div>
        <h2 class="sec-title t-title-3">Badges</h2>
        <div class="section you-badges">${U.badgeStrip ? U.badgeStrip(S, day) : achievementTiles(S, day)}</div>
        ${workouts ? plans(S) : ''}
        <h2 class="sec-title t-title-3">Your answers</h2>
        <div class="section">
          <ul class="rf-list" data-key="answers">${U.answerRows ? U.answerRows(S.profile) : ''}</ul>
          <p class="rf-list-footer">Change any of them. Your plan follows when you save.</p>
        </div>
        <div class="section you-app">
          <ul class="rf-list" data-key="app">
            ${U.row({ key: 'settings', icon: 'sliders', tone: 'indigo', title: 'Settings', sub: 'What you track, the AI coach, sound, look and your data', act: 'openSettings', chevron: true })}
            ${U.row({ key: 'help', icon: 'compass', tone: 'teal', title: 'Help and tour', sub: 'Where everything is, and the tips on each tab', act: 'openHelp', chevron: true })}
            ${U.row({ key: 'news', icon: 'sparkle', tone: 'amber', title: 'What\'s new', detail: U.esc(verShort ? `Version ${verShort}` : ''), act: 'openWhatsNew', chevron: true })}
            ${U.row({ key: 'privacy', icon: 'lock', tone: 'green', title: 'Privacy', sub: 'What stays on this phone, and what can leave it', act: 'openPrivacyView', chevron: true })}
          </ul>
          <p class="rf-list-footer">Gradient Health ${U.esc(ver || 'web')}. Not medical advice: check with a doctor before starting if you have a condition or an injury.</p>
        </div>`;
    },
    shown(S, day) {
      const fresh = U.newAchievements ? U.newAchievements(S, day) : [];
      if (fresh && fresh.length && U.celebrateAchievements) setTimeout(() => U.celebrateAchievements(fresh), 400);
    },
  };

  /* ---------------------------------------------------------------- help */
  U.act.openHelp = () => U.sheet({
    title: 'Help', size: 'fit',
    body: `<ul class="rf-list">
      ${U.row({ icon: 'compass', tone: 'teal', title: 'Take the tour', sub: 'Where everything is, in a few short pages', act: 'helpTour', chevron: true })}
      ${U.row({ icon: 'info', tone: 'sky', title: 'Show the tips again', sub: 'Each tab explains itself the next time you open it', act: 'helpTips' })}
    </ul>
    <p class="t-footnote rf-muted sheet-lead">Questions about your plan, sleep or food? Ask the coach: the sparkle at the top left of every tab.</p>`,
  });
  U.act.helpTour = () => { U.closeSheets(); if (U.showTour) setTimeout(() => U.showTour(), 320); };
  U.act.helpTips = () => {
    U.closeSheets();
    if (U.resetTips) U.resetTips();
    U.render();
    U.toast('Tips are back', 'positive', 'Each tab shows its tip again until you tap Got it.');
  };
})(typeof window !== 'undefined' ? window : globalThis);
