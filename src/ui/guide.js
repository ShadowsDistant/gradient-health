/* Help for the first days: a checklist on Today for the first two weeks, Health Connect offered after
 * the first workout, a short tour once that workout's checked in (never before it), one tip per tab
 * on the first visits, and What's new after an update. What someone has already seen lives in S.seen.
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
  // One per tab (and Plan's Moves), shown until Got it. Today's waits while the Getting started
  // checklist is up (src/ui/today.js), so a new person sees one thing at a time.
  const TIPS = {
    today: ['home', 'accent', 'Your day at a glance: the workout, sized to your time, a quick feel check, and food or protein. Tap the streak for your progress, and the sparkle at the top left to ask the coach.'],
    plan: ['calendar', 'sky', 'Your week at a glance. Tap any day to see it, move a workout to a free day, or swipe for next week. Miss one and the rest of the week shifts forward, so nothing doubles up. Moves, at the top, has every exercise.'],
    moves: ['library', 'violet', 'Every exercise, grouped into ladders from easiest to hardest. You move up a level once you have 3 or more reps left at the top of the range. Tap one to see how it\'s done.'],
    food: ['food', 'green', 'Log what you eat by meal: search, scan a barcode, or just add the calories. The ring shows what\'s left for today, and your target learns from your logs and your weight.'],
    health: ['heart', 'rose', 'Your numbers from Health Connect plus anything you log by hand. Tap any number for its history, or to add or fix a value. Pull down to sync.'],
    progress: ['chart', 'green', 'How your training is going. The body map shows which muscles you\'ve trained and where you\'ve got stronger: tap one for its story. Your totals, levels and your weaker side are below.'],
    you: ['person', 'indigo', 'Everything about you in one place: your badges, your plans and your answers. Settings, help and What\'s new are at the bottom, and Settings is at the top right too.'],
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
  // Help, Show the tips again: every tab's tip comes back.
  U.resetTips = () => {
    const s = seen();
    for (const id of Object.keys(TIPS)) delete s[`tip_${id}`];
    U.save();
  };

  /* ---------------------------------------------------------------- first-week checklist */
  // The level check (push-ups, a plank and curls set where each exercise starts) suits a body with
  // nothing to plan around, under 65, that gets down to the floor: what set-up's baseline test asked.
  const levelCheckFits = (p) => !(p.conditions && p.conditions.length) && !(p.age >= 65) && p.floorOk !== false;
  const hcCanAsk = () => { const st = H().status(); return !!(GH.platform && GH.platform.isApp()) && st !== 'unsupported' && st !== 'unavailable'; };
  const doneWorkouts = (S) => (S.log || []).filter((l) => l.type === 'workout' && B().isDone(l)).length;
  function checkItems(S, day) {
    const b = B();
    const items = [];
    const workouts = S.profile.workouts !== false;
    const food = GH.food && GH.food.full(S);
    if (workouts) {
      const doneWorkout = doneWorkouts(S) > 0;
      let sub = 'Tap Start workout when you\'re ready.';
      if (!doneWorkout) {
        const plan = b.todayPlan(S, day);
        if (plan.type !== 'workout' && plan.next) sub = `Your first one is on ${b.fmtDay(plan.next.day)}.`;
      }
      items.push({ id: 'workout', icon: 'play', title: 'Finish your first workout', sub, done: doneWorkout });
      if (levelCheckFits(S.profile) && U.act.baselineSheet) items.push({ id: 'level', icon: 'timer', title: 'Do a level check', sub: 'Push-ups, a plank and curls, about 3 minutes. Every move starts at the right level.', done: U.seen('levelCheck'), act: 'ckLevel' });
      items.push({ id: 'howto', icon: 'eye', title: 'See how a move is done', sub: 'Tap any exercise name for an animated demo.', done: U.seen('moveSheet'), act: 'ckHowTo' });
    }
    if (food) items.push({ id: 'food', icon: 'food', title: 'Log your first meal', sub: 'Search, scan or quick-add the calories.', done: Object.keys(GH.food.data(S).days).some((d) => (GH.food.data(S).days[d] || []).length), act: 'foodAdd' });
    items.push({ id: 'feel', icon: 'sparkle', title: 'Do a feel check', sub: workouts ? 'Energy and soreness shape today\'s session.' : 'Two taps: energy and soreness.', done: Object.keys(S.feel || {}).length > 0, act: 'logFeel' });
    if (hcCanAsk()) items.push({ id: 'health', icon: 'heart', title: 'Connect Health Connect', sub: 'Sleep and steps fill in on their own.', done: H().connected(H().status()), act: 'hcConnect' });
    if (!workouts) items.push({ id: 'weight', icon: 'chart', title: 'Log your weight', sub: 'Your trend shows on the Health tab.', done: (S.weights || []).some((w) => w.src !== 'profile'), act: 'logWeight' });
    return items;
  }
  U.checklist = (S, day) => {
    // Today after the first workout's check-in: the tour, once (it waits for anything open on top).
    if (tourDue(S)) tourSoon();
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
  // The level check is Settings' sheet; saving it ticks the item off.
  U.act.ckLevel = () => {
    if (!U.act.baselineSheet) return;
    U.act.baselineSheet();
    const ctl = U.topSheet && U.topSheet();
    if (!ctl || !ctl.el) return;
    ctl.el.addEventListener('close', () => {
      if (ctl.el.returnValue !== 'ok' || !U.S) return;
      U.markSeen('levelCheck');
      U.render();
      U.checklistCheck();
    }, { once: true });
  };
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

  /* ---------------------------------------------------------------- Health Connect, after the first workout */
  // The first workout's Next screen offers Health Connect (src/ui/player.js), once: never during
  // set-up, before the person has seen what the app does. Then it's on the checklist and Health.
  U.hcInvite = (S) => {
    if (!S || U.seen('hcInvite') || !hcCanAsk() || H().connected(H().status()) || doneWorkouts(S) !== 1) return '';
    return `<div class="card hc-invite" data-key="hcinvite">
      <div class="hc-invite-row"><span class="rf-list-icon" data-tone="rose">${U.icon('heart')}</span>
        <span class="hc-invite-text"><span class="t-headline">Let sleep and steps shape your workouts</span><span class="t-footnote rf-muted">Connect Health Connect and each day fits how you slept and moved. It stays on this phone.</span></span></div>
      <div class="hc-invite-btns"><button type="button" class="rf-btn" data-variant="filled" data-act="hcInviteGo">Connect</button><button type="button" class="rf-btn" data-variant="plain" data-act="hcInviteLater">Not now</button></div>
    </div>`;
  };
  U.act.hcInviteGo = async (el) => {
    U.markSeen('hcInvite');
    const card = el.closest('.hc-invite');
    if (U.act.hcConnect) await U.act.hcConnect();
    if (!H().connected(H().status())) return;
    // The workout just finished goes to Health Connect too, as it would have with it connected.
    const S = U.S;
    if (S && S.health.write !== false && H().canWrite && H().canWrite() && H().writeRecent) H().writeRecent(S, 1);
    if (card && card.isConnected) card.innerHTML = `<div class="hc-invite-row"><span class="rf-list-icon" data-tone="green">${U.icon('check')}</span><span class="hc-invite-text"><span class="t-headline">Connected</span><span class="t-footnote rf-muted">Your next workouts fit how you slept and moved.</span></span></div>`;
  };
  U.act.hcInviteLater = (el) => { const card = el.closest('.hc-invite'); U.markSeen('hcInvite'); collapse(card).then(() => { if (card) card.remove(); }); };

  /* ---------------------------------------------------------------- the tour */
  // Three short cards, once the first workout is checked in: Today, the tab for the plan (or food),
  // and the rest. They're built from the tabs there are, so they only describe what's on screen, and
  // each shows the real tab bar with its tab lit.
  const TAB_WORDS = {
    food: 'Food logs your meals and counts what\'s left for today.',
    health: 'Health has your sleep, steps and heart rate.',
    progress: 'Progress shows your levels, streaks and records.',
    you: 'You has your badges, your plans and Settings.',
  };
  function tourPages() {
    const tabs = U.tabList().map((t) => t[0]);
    const pages = [{ tab: 'today', icon: 'home', title: 'Today is home base', text: tabs.includes('plan') ? 'Each day starts here: your workout, sized to your time, and a quick feel check that tunes it to how you slept and how sore you are.' : 'Each day starts here: what to eat and what\'s left, how you slept and how you feel.' }];
    if (tabs.includes('plan')) pages.push({ tab: 'plan', icon: 'calendar', title: 'Your week, your way', text: 'Plan shows every day ahead. Hold a workout to move it to a free day, and Moves has every exercise, from easiest to hardest.' });
    else if (tabs.includes('food')) pages.push({ tab: 'food', icon: 'food', title: 'Log what you eat', text: 'Search, scan a barcode or just add the calories. Your target learns from your logs and your weight.' });
    const rest = tabs.filter((t) => t !== 'today' && !pages.some((p) => p.tab === t));
    pages.push({ tab: rest.includes('you') ? 'you' : rest[rest.length - 1], lit: rest, icon: 'compass', title: 'Everything else', text: rest.map((t) => TAB_WORDS[t]).filter(Boolean).join(' ') });
    return pages;
  }
  // A small copy of the real tab bar (same capsule, pill and tabs), with this card's tab lit.
  const tourTabs = (p) => `<div class="tour-tabs" aria-hidden="true">${U.tabList().map(([id, ic, l]) => `<span class="tour-tab${id === p.tab ? ' is-on' : (p.lit || []).includes(id) ? ' is-lit' : ''}">${U.icon(ic)}<span class="tour-tab-label">${U.esc(l)}</span></span>`).join('')}</div>`;
  // Due once the first workout is done (and was checked in), in the first two weeks, for someone who
  // hasn't had it (someone who's used the app for longer knows their way around).
  const tourDue = (S) => !!S && !U.seen('tour') && S.profile.workouts !== false && U.today() - (S.profile.startDay != null ? S.profile.startDay : U.today()) <= 14 && doneWorkouts(S) > 0;
  let tourWait = 0;
  function tourSoon(tries) {
    if (tourWait && !tries) return;
    tourWait = setTimeout(() => {
      tourWait = 0;
      const S = U.S;
      if (!tourDue(S)) return;
      const els = U.els ? U.els() : {};
      // Not over the player, set-up or a sheet, and not over a toast either (a new badge's "See it"
      // would be hidden behind it).
      const toast = G.document && G.document.querySelector('.rf-toaster .rf-toast:not([data-leaving])');
      const busy = (els.playerEl && !els.playerEl.hidden) || (els.onboardEl && !els.onboardEl.hidden) || (U.topSheet && U.topSheet()) || (S && S.active) || toast;
      if (busy) { if ((tries || 0) < 40) tourSoon((tries || 0) + 1); return; }
      U.showTour();
    }, tries ? 1500 : 900);
  }
  U.showTour = () => {
    let i = 0;
    const pages = tourPages();
    const last = pages.length - 1;
    const body = () => {
      const p = pages[i];
      return `<div class="tour" data-page="${i}">
        <div class="tour-art" data-key="art-${i}"><div class="tour-icon" data-tab="${p.tab}">${U.icon(p.icon)}</div>${tourTabs(p)}</div>
        <div class="tour-copy" data-key="copy-${i}"><h3 class="t-title-2">${U.esc(p.title)}</h3><p class="t-body rf-muted">${U.esc(p.text)}</p></div>
        <div class="tour-dots" aria-hidden="true">${pages.map((_, k) => `<i${k === i ? ' class="on"' : ''}></i>`).join('')}</div>
        <div class="tour-btns">
          ${i < last ? '<button type="button" class="rf-btn" data-variant="plain" data-act="tourSkip">Skip</button>' : '<span></span>'}
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-lens data-act="tourNext">${i < last ? 'Next' : 'Let\'s go'}</button>
        </div>
      </div>`;
    };
    const show = (ctl, dir) => {
      ctl.update(body());
      if (!U.reduced()) for (const el of ctl.el.querySelectorAll('.tour-art, .tour-copy')) el.animate([{ opacity: 0, transform: `translateX(${dir * 40}px)` }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
      U.haptic('select');
    };
    U.markSeen('tour');
    const ctl = U.sheet({
      title: 'Find your way around', size: 'fit', cls: 'tour-sheet', body: body(),
      onClose: () => U.markSeen('tour'),
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
      title: `What's new in ${entry.version}`, size: 'auto',
      body: `<div class="sheet-pad"><p class="t-title-3">${U.esc(entry.title)}</p></div>${U.changesHtml(entry)}`,
    });
  };

  // After the app opens: What's new once per update, for people who used an earlier version. (Badges
  // already earned are marked seen by their own migration, src/achievements.js.)
  U.afterBoot = () => {
    const S = U.S;
    if (!S || !GH.VERSION) return;
    const last = U.seen('lastVersion') ? seen().lastVersion : '1.0.0';
    if (cmpVersion(GH.VERSION, last) > 0 && !S.active) setTimeout(() => U.showWhatsNew(), 700);
    U.markSeen('lastVersion', GH.VERSION);
  };
  // After set-up: nothing is "new" yet, and no tour either: the first workout comes first, and the
  // tour follows its check-in (U.checklist above).
  U.afterOnboarding = () => {
    U.markSeen('lastVersion', GH.VERSION || '1.0.0');
  };
})(typeof window !== 'undefined' ? window : globalThis);
