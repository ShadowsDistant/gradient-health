/* Profile: your stats, achievements, plan at a glance, and the app itself (settings, how it works,
 * the tour, what's new, version).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  const GOAL_NAMES = { abs: 'Visible abs', arms: 'Bigger arms', chest: 'Bigger chest', legs: 'Legs and glutes', back: 'Back and posture', fat: 'Lose fat', strength: 'Overall strength', endurance: 'Endurance', mobility: 'Mobility', consistency: 'Consistency' };

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
    const x = stats(S, day);
    return ACH.map((a) => { const [have, need] = a.prog(x); return Object.assign({}, a, { have: Math.min(have, need), goal: need, earned: have >= need }); });
  };
  // New achievements since last time: celebrated once (after a workout, or when Profile opens).
  U.newAchievements = (S, day) => {
    const got = U.achievements(S, day).filter((a) => a.earned);
    const known = (S.seen && S.seen.ach) || [];
    const fresh = got.filter((a) => !known.includes(a.id));
    if (fresh.length) { S.seen = S.seen || {}; S.seen.ach = got.map((a) => a.id); U.save(); }
    return fresh;
  };

  /* ---------------------------------------------------------------- the screen */
  function hours(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${m ? m : ''}`.trim() : `${m} min`; }
  function tile(label, value, sub) {
    return `<div class="stat"><span class="t-footnote rf-muted">${U.esc(label)}</span><span class="t-title-2">${value}</span>${sub ? `<span class="t-caption rf-muted">${U.esc(sub)}</span>` : ''}</div>`;
  }
  U.screens.profile = {
    render(S, day) {
      const x = stats(S, day);
      const p = S.profile;
      const name = (p.name || '').trim();
      const initials = name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';
      const since = B().fmtDay(p.startDay, false);
      const week = x.cal.weeks[B().weekStart(day)];
      const ach = U.achievements(S, day);
      const earned = ach.filter((a) => a.earned).length;
      const eq = p.equipment || {};
      const ver = (GH.platform && GH.platform.appVersion()) || GH.VERSION || '';
      const verShort = String(ver).split(' ')[0];
      return `${U.navbar('Profile', U.glassBtn('sliders', 'Settings', 'openSettings'), U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Profile</h1>
        <div class="section">
          <button type="button" class="card me-card tap-card" data-key="me" data-act="editName">
            <span class="me-avatar" aria-hidden="true">${initials ? `<span>${U.esc(initials)}</span>` : U.icon('person')}</span>
            <span class="me-text"><span class="t-title-3">${U.esc(name || 'Add your name')}</span><span class="t-footnote rf-muted">Training since ${U.esc(since)}${week ? ` · week ${week.trainingWeek}` : ''}</span></span>
            ${U.icon('pencil', 'sm', 'me-edit')}
          </button>
          <div class="stat-grid" data-key="stats">
            ${tile('Workouts', U.roll(x.workouts, 't-title-2'), x.weeks ? U.plural(x.weeks, 'week') + ' with training' : 'Your first is waiting')}
            ${tile('Streak', `${U.roll(x.current)} <small>days</small>`, x.best > x.current ? `Best ${x.best}` : x.current ? 'Your best so far' : 'Starts with the next one')}
            ${tile('Sets done', U.roll(U.num(x.sets)), 'Across every workout')}
            ${tile('Time trained', U.esc(x.minutes ? hours(x.minutes) : '0 min'), 'In the workout player')}
            ${tile('Level-ups', U.roll(x.ups), 'Harder moves and heavier weights')}
            ${tile('Personal bests', U.roll(x.prs), 'Best sets beaten')}
          </div>
        </div>
        <h2 class="sec-title t-title-3">Achievements <span class="t-callout rf-muted">${earned} of ${ach.length}</span></h2>
        <div class="section">
          <div class="ach-grid" data-key="ach">${ach.map((a) => `<div class="ach${a.earned ? ' is-earned' : ''}" data-key="ach-${a.id}">
            <span class="rf-list-icon ach-badge" data-tone="${a.earned ? a.tone : 'none'}">${U.icon(a.earned ? a.icon : 'lock')}</span>
            <span class="t-footnote ach-title">${U.esc(a.title)}</span>
            <span class="t-caption rf-muted">${a.earned ? 'Earned' : a.goal > 1 ? `${U.num(a.have)} of ${U.num(a.goal)}` : U.esc(a.need)}</span>
          </div>`).join('')}</div>
        </div>
        <h2 class="sec-title t-title-3">Your plan</h2>
        <div class="section"><ul class="rf-list">
          ${U.row({ icon: 'flag', tone: 'green', title: 'Goals', sub: U.esc(U.cap((p.goals || []).map((g) => (GOAL_NAMES[g] || g).toLowerCase()).join(', '))), act: 'editStep', arg: 'goals', chevron: true })}
          ${U.row({ icon: 'calendar', tone: 'sky', title: 'Days and time', detail: `${p.days} days · ${p.minutes} min`, act: 'daysSheet', chevron: true })}
          ${U.row({ icon: 'bag', tone: 'amber', title: 'Equipment', detail: U.esc(U.equipSummary(p)), act: 'editEquipment', chevron: true })}
        </ul></div>
        <h2 class="sec-title t-title-3">The app</h2>
        <div class="section"><ul class="rf-list">
          ${U.row({ icon: 'sliders', tone: 'indigo', title: 'Settings', act: 'openSettings', chevron: true })}
          ${U.row({ icon: 'library', tone: 'violet', title: 'How it works', sub: 'The research behind every rule', act: 'openScience', chevron: true })}
          ${U.row({ icon: 'compass', tone: 'teal', title: 'Take the tour again', act: 'showTour', chevron: true })}
          ${U.row({ icon: 'sparkle', tone: 'amber', title: 'What\'s new', detail: U.esc(verShort ? `Version ${verShort}` : ''), act: 'openWhatsNew', chevron: true })}
          ${U.row({ icon: 'lock', tone: 'green', title: 'Privacy', act: 'openPrivacyView', chevron: true })}
        </ul>
        <p class="rf-list-footer">Gradient Health ${U.esc(ver || 'web')}. Not medical advice: check with a doctor before starting if you have a condition or an injury.</p></div>`;
    },
    shown(S, day) {
      const fresh = U.newAchievements(S, day);
      if (fresh.length) setTimeout(() => celebrate(fresh), 400);
    },
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

  U.act.openProfile = () => U.open('profile');
  U.act.openSettings = () => U.open('settings');
  U.act.openScience = (el) => U.open('science', el && el.dataset && el.dataset.arg ? el.dataset.arg : null);
  U.act.openWhatsNew = () => U.open('whatsnew');
  U.act.editName = () => {
    const ctl = U.sheet({
      title: 'Your name', detents: 'small medium', detent: 'small',
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
