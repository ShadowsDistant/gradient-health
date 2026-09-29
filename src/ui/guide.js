/* Help for the first days: a short tour after set-up, a checklist on Today for the first two weeks,
 * one tip per tab on the first visits, first-workout hints, and What's new after an update.
 * What someone has already seen lives in S.seen.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  const seen = () => (U.S ? (U.S.seen = U.S.seen || {}) : {});
  U.seen = (k) => !!seen()[k];
  U.markSeen = (k, v) => {
    if (!U.S) return false;
    const s = seen();
    const val = v == null ? true : v;
    if (s[k] === val) return false;
    s[k] = val;
    U.save();
    return true;
  };

  /* ---------------------------------------------------------------- collapse (tips, checklist) */
  function collapse(el) {
    if (!el || U.reduced() || !el.animate) return Promise.resolve();
    const h = el.offsetHeight;
    return el.animate([
      { opacity: 1, height: `${h}px`, transform: 'none' },
      { opacity: 0, height: '0px', marginTop: `calc(-1 * var(--space-3))`, paddingTop: '0px', paddingBottom: '0px', transform: 'scale(.97)' },
    ], { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' }).finished.catch(() => {});
  }

  /* ---------------------------------------------------------------- tips */
  const TIPS = {
    plan: ['calendar', 'sky', 'Your week at a glance. Tap an upcoming workout to preview it or move it to another day. Miss one and the rest of the week shifts forward, so nothing doubles up.'],
    health: ['heart', 'rose', 'Your numbers from Health Connect plus anything you log by hand. Pull down to sync. Insights start showing up after a few days of data.'],
    progress: ['chart', 'green', 'How your training is going: which days you trained, your level on each exercise, and how your weaker side is catching up.'],
    moves: ['library', 'violet', 'Every exercise, grouped into ladders from easiest to hardest. You move up a level once you have 3 or more reps left at the top of the range.'],
  };
  U.tip = (id) => {
    const t = TIPS[id];
    if (!t || U.seen(`tip_${id}`)) return '';
    return `<div class="card tip" data-key="tip-${id}"><div class="tip-row"><span class="rf-list-icon" data-tone="${t[1]}">${U.icon(t[0])}</span><p class="t-callout">${U.esc(t[2])}</p></div><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="tipDone" data-arg="${id}">Got it</button></div>`;
  };
  U.act.tipDone = (el) => {
    const card = el.closest('.tip');
    collapse(card).then(() => { U.markSeen(`tip_${el.dataset.arg}`); U.render(); });
  };

  /* ---------------------------------------------------------------- first-week checklist */
  function checkItems(S, day) {
    const b = B();
    const items = [];
    const doneWorkout = S.log.some((l) => l.type === 'workout' && b.isDone(l));
    let sub = 'Tap Start workout when you\'re ready.';
    if (!doneWorkout) {
      const plan = b.todayPlan(S, day);
      if (plan.type !== 'workout' && plan.next) sub = `Your first one is on ${b.fmtDay(plan.next.day)}.`;
    }
    items.push({ id: 'workout', icon: 'play', title: 'Finish your first workout', sub, done: doneWorkout });
    items.push({ id: 'howto', icon: 'eye', title: 'See how a move is done', sub: 'Tap any exercise name for an animated diagram.', done: U.seen('moveSheet'), act: 'ckHowTo' });
    items.push({ id: 'feel', icon: 'sparkle', title: 'Do a feel check', sub: 'Energy and soreness shape today\'s session.', done: Object.keys(S.feel || {}).length > 0, act: 'logFeel' });
    const st = H().status();
    if (GH.platform && GH.platform.isApp() && st !== 'unsupported' && st !== 'unavailable') items.push({ id: 'health', icon: 'heart', title: 'Connect Health Connect', sub: 'Sleep and steps fill in on their own.', done: H().connected(st), act: 'hcConnect' });
    items.push({ id: 'plan', icon: 'calendar', title: 'Look at your week', sub: 'The Plan tab shows every day.', done: U.seen('tab_plan'), act: 'ckPlan' });
    return items;
  }
  U.checklist = (S, day) => {
    if (U.seen('checklistHidden') || day - (S.profile.startDay || day) > 14) return '';
    const items = checkItems(S, day);
    const n = items.filter((x) => x.done).length;
    if (n === items.length) return '';
    return `<div class="card checklist" data-key="checklist">
      <div class="row-between"><span class="t-headline">Getting started</span><span class="t-footnote rf-muted"><span class="rf-num">${n}</span> of ${items.length}</span></div>
      ${U.progress(n / items.length, 'Getting started', 'positive')}
      <ul class="check-items">${items.map((x) => `<li data-key="ck-${x.id}"><${x.act && !x.done ? `button type="button" data-act="${x.act}"` : 'div'} class="ck${x.done ? ' is-done' : ''}">
        <span class="ck-mark" aria-hidden="true">${x.done ? U.icon('check') : U.icon(x.icon)}</span>
        <span class="ck-text"><span class="t-subhead">${U.esc(x.title)}</span>${x.done ? '' : `<span class="t-footnote rf-muted">${U.esc(x.sub)}</span>`}</span>
        ${x.act && !x.done ? U.icon('chevron-right', null, 'ck-go') : ''}</${x.act && !x.done ? 'button' : 'div'}></li>`).join('')}</ul>
      <button type="button" class="rf-btn ck-hide" data-variant="plain" data-size="sm" data-act="ckHide">Hide this</button>
    </div>`;
  };
  U.act.ckHide = (el) => collapse(el.closest('.checklist')).then(() => { U.markSeen('checklistHidden'); U.render(); });
  U.act.ckPlan = () => U.go('plan');
  U.act.ckHowTo = () => {
    const S = U.S, day = U.today();
    let id = 'push_std';
    try {
      const plan = B().todayPlan(S, day);
      if (plan.type === 'workout') { const s = B().buildSession(S, day, plan.tpl, {}); if (s.items[0]) id = s.items[0].moveId; }
    } catch (e) { /* default move */ }
    U.moveSheet(id);
  };
  // The checklist finishes with a small moment, once.
  U.checklistCheck = () => {
    const S = U.S;
    if (!S || U.seen('checklistDone') || U.seen('checklistHidden')) return;
    const day = U.today();
    if (day - (S.profile.startDay || day) > 14) return;
    const items = checkItems(S, day);
    if (items.every((x) => x.done)) { U.markSeen('checklistDone'); U.toast('You\'re all set', 'positive', 'That\'s everything to get started. The rest is showing up.'); U.haptic('celebrate'); }
  };

  /* ---------------------------------------------------------------- the tour */
  const TOUR = [
    { art: 'home', tone: 'accent', title: 'Today is home base', text: 'Your workout for the day lives here, sized to the time you picked. Tap any exercise to see how it\'s done, then press Start workout.' },
    { art: 'fig', move: 'push_std', title: 'One set at a time', text: 'The player shows the move, your target and a diagram you can tap for tips. Press Done set when you finish, then rest while the ring counts down.' },
    { art: 'rir', title: 'It learns from one question', text: 'After each exercise: how many more reps could you have done? 0 holds you steady, 1-2 adds a little, 3+ moves you up. Honest answers make the plan fit you.' },
    { art: 'tabs', title: 'Everything else', text: 'Plan shows your week and lets you move a day. Health has sleep, steps and trends. Progress tracks levels and streaks. Your profile has stats and settings.' },
  ];
  let tourFig = null;
  function tourArt(p) {
    if (p.art === 'fig') return '<div class="tour-fig" data-morph="keep"></div>';
    if (p.art === 'rir') return `<div class="tour-rir">${U.seg('tourRir', [['0', '0'], ['12', '1-2'], ['3', '3+']], '12', 'Reps left in the tank', '')}<p class="t-footnote rf-muted">Reps left in the tank</p></div>`;
    // A small copy of the real tab bar: same capsule, same selection pill, same tabs.
    if (p.art === 'tabs') return `<div class="tour-tabs" aria-hidden="true">${U.tabList().map(([id, ic, l], k) => `<span class="tour-tab${k === 0 ? ' is-on' : ''}">${U.icon(ic)}<span class="tour-tab-label">${U.esc(l)}</span></span>`).join('')}</div>`;
    return `<div class="tour-icon">${U.icon(p.art)}</div>`;
  }
  U.showTour = () => {
    let i = 0;
    const last = TOUR.length - 1;
    const body = () => {
      const p = TOUR[i];
      return `<div class="tour" data-page="${i}">
        <div class="tour-art" data-key="art-${i}">${tourArt(p)}</div>
        <div class="tour-copy" data-key="copy-${i}"><h3 class="t-title-2">${U.esc(p.title)}</h3><p class="t-body rf-muted">${U.esc(p.text)}</p></div>
        <div class="tour-dots" aria-hidden="true">${TOUR.map((_, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('')}</div>
        <div class="tour-btns">
          ${i < last ? '<button type="button" class="rf-btn" data-variant="plain" data-act="tourSkip">Skip</button>' : '<span></span>'}
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-lens data-act="tourNext">${i < last ? 'Next' : 'Let\'s go'}</button>
        </div>
      </div>`;
    };
    const mountFig = (ctl) => {
      if (tourFig) { try { tourFig.destroy(); } catch (e) { /* ignore */ } tourFig = null; }
      const host = ctl.el.querySelector('.tour-fig');
      if (host && U.figureFor) tourFig = U.figureFor(host, TOUR[i].move, null, true);
    };
    const show = (ctl, dir) => {
      ctl.update(body());
      mountFig(ctl);
      if (!U.reduced()) for (const el of ctl.el.querySelectorAll('.tour-art, .tour-copy')) el.animate([{ opacity: 0, transform: `translateX(${dir * 40}px)` }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
      U.haptic('select');
    };
    const ctl = U.sheet({
      title: 'Welcome', detents: 'large', detent: 'large', cls: 'tour-sheet', body: body(),
      after: (c) => mountFig(c),
      onClose: () => { if (tourFig) { try { tourFig.destroy(); } catch (e) { /* ignore */ } tourFig = null; } U.markSeen('tour'); },
    });
    U.act.tourNext = () => { if (i >= last) { ctl.close('ok'); return; } i++; show(ctl, 1); };
    U.act.tourSkip = () => ctl.close('skip');
    // Swipe between pages.
    let x0 = null;
    ctl.body.addEventListener('touchstart', (e) => { x0 = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    ctl.body.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (dx < -50 && i < last) { i++; show(ctl, 1); } else if (dx > 50 && i > 0) { i--; show(ctl, -1); }
    }, { passive: true });
    return ctl;
  };
  U.act.showTour = () => U.showTour();

  /* ---------------------------------------------------------------- What's new */
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let k = 0; k < 3; k++) { const d = (pa[k] || 0) - (pb[k] || 0); if (d) return d; }
    return 0;
  }
  U.cmpVersion = cmpVersion;
  U.changesHtml = (entry) => `<ul class="rf-list news-list">${entry.items.map(([ic, text]) => `<li><div class="rf-list-row"><span class="rf-list-icon" data-tone="sky">${U.icon(ic)}</span><span class="rf-list-text"><span class="t-callout">${U.esc(text)}</span></span></div></li>`).join('')}</ul>`;
  U.showWhatsNew = () => {
    const entry = (GH.CHANGELOG || [])[0];
    if (!entry) return null;
    return U.sheet({
      title: `What's new in ${entry.version}`, detents: 'large', detent: 'large',
      body: `<div class="sheet-pad"><p class="t-title-3">${U.esc(entry.title)}</p></div>${U.changesHtml(entry)}`,
    });
  };

  // Achievements already earned (before this version, or during set-up) count as seen, so only new
  // ones get celebrated.
  function seedAchievements() {
    const S = U.S;
    if (!S || !U.achievements || (S.seen && S.seen.ach)) return;
    U.markSeen('ach', U.achievements(S, U.today()).filter((a) => a.earned).map((a) => a.id));
  }

  // After the app opens: What's new once per update, for people who used an earlier version.
  U.afterBoot = () => {
    const S = U.S;
    seedAchievements();
    if (!S || !GH.VERSION) return;
    const last = U.seen('lastVersion') ? seen().lastVersion : '1.0.0';
    if (cmpVersion(GH.VERSION, last) > 0 && !S.active) setTimeout(() => U.showWhatsNew(), 700);
    U.markSeen('lastVersion', GH.VERSION);
  };
  // After set-up: the tour instead (nothing is "new" yet).
  U.afterOnboarding = () => {
    U.markSeen('lastVersion', GH.VERSION || '1.0.0');
    seedAchievements();
    if (!U.seen('tour')) setTimeout(() => U.showTour(), 650);
  };
})(typeof window !== 'undefined' ? window : globalThis);
