/* The set-up. A first run asks one thing a screen and ends on the plan it made, with the first
 * workout a tap away: what you want most, how much time you have, where you train and a little
 * about you (the core path). "Just tracking food?" takes a shorter path to daily food targets, and a
 * plan a friend shared takes a shorter one still, straight into that plan. The rest waits for later:
 * joints and sides and food details in Your answers, the level check in the first week's checklist,
 * Health Connect after the first workout (and on the Health tab). It never asks for Health Connect
 * before the plan is shown; the food path offers it as an optional last screen.
 * Modes: 'new' (first run), 'edit' (Your answers: every detailed screen, as before) and 'one' (a
 * single detailed screen with Save, from You or Settings).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const A = () => GH.access;
  const M = () => GH.moves;
  const C = () => GH.customPlan;

  // The goals, the joints and the detailed screens of Your answers (STEPS), which the other screens
  // list too: src/ui/answers.js.
  const { GOALS, JOINTS, STEPS } = U.answers;
  const WEIGHTS = { db: { lb: [2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50], kg: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 25] }, kb: { lb: [10, 15, 18, 20, 26, 35, 44, 53], kg: [4, 6, 8, 10, 12, 16, 20, 24] } };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // What you want most: a card each. Build muscle is the body areas picked under it (none: all over).
  const WANT = [
    { id: 'muscle', icon: 'dumbbell', tone: 'coral', title: 'Build muscle', sub: 'Bigger, more defined muscles' },
    { id: 'strength', icon: 'bolt', tone: 'amber', title: 'Get stronger', sub: 'Lift more and feel solid' },
    { id: 'fat', icon: 'flame', tone: 'rose', title: 'Lose fat', sub: 'Burn more and keep your muscle' },
    { id: 'endurance', icon: 'heart', tone: 'green', title: 'Get fitter', sub: 'More stamina, less out of breath' },
    { id: 'mobility', icon: 'leaf', tone: 'teal', title: 'Move better', sub: 'Looser hips, back and shoulders' },
    { id: 'consistency', icon: 'repeat', tone: 'indigo', title: 'Stay consistent', sub: 'A habit that sticks' },
  ];
  const AREAS = [['arms', 'Arms'], ['chest', 'Chest'], ['back', 'Back'], ['legs', 'Legs and glutes'], ['abs', 'Abs'], ['shoulders', 'Shoulders']];
  const UNIT_GROUPS = { arms: ['biceps', 'triceps'], chest: ['chest'], back: ['back'], legs: ['legs'], abs: ['abs'], shoulders: ['shoulders'] };
  const MINUTES = [10, 15, 20, 30, 45, 60];
  // How much you've trained: the level the plan starts at, and how gently its first weeks go.
  const LEVELS = [
    { id: 'onoff', recent: 'none', icon: 'sun', tone: 'green', title: 'New or coming back', sub: 'Start gently and build up' },
    { id: '1to3', recent: 'some', icon: 'arrow-up-right', tone: 'sky', title: 'About a year', sub: 'You know the basics' },
    { id: '3plus', recent: 'regular', icon: 'star', tone: 'violet', title: 'Several years', sub: 'Ready for more from the start' },
  ];
  const PLACES = [['home', 'home', 'sky', 'Home'], ['gym', 'dumbbell', 'violet', 'Gym'], ['both', 'shuffle', 'teal', 'Both']];
  const KIT = [['db', 'Dumbbells'], ['kb', 'Kettlebell'], ['band', 'Resistance band'], ['bar', 'Pull-up bar'], ['ball', 'Medicine ball']];
  // Weights for a tick that hasn't picked any yet: a common pair set, one kettlebell.
  const KIT_START = { db: { lb: [10, 15, 20], kg: [4, 6, 8] }, kb: { lb: [20], kg: [8] } };
  const PRESET_SUB = { full: 'Racks, barbells, cables and machines', basic: 'Barbells, a cable station and dumbbells', small: 'Dumbbells, a bench and cardio machines' };

  // The first run's screens, by path. The welcome isn't counted in "2 of 5".
  const PATHS = {
    core: ['welcome', 'want', 'time', 'where', 'you', 'reveal'],
    food: ['welcome', 'fabout', 'fgoal', 'ftargets', 'fhealth'],
    friend: ['welcome', 'want', 'where', 'friend'],
  };
  const FIRST = {
    welcome: { id: 'welcome', bare: true },
    want: { id: 'want', title: 'What do you want most?' },
    time: { id: 'time', title: 'How much time do you have?' },
    where: { id: 'where', title: 'Where do you train?' },
    you: { id: 'you', title: 'A little about you' },
    reveal: { id: 'reveal', bare: true },
    friend: { id: 'friend', bare: true },
    fabout: { id: 'fabout', title: 'A little about you' },
    fgoal: { id: 'fgoal', title: 'What\'s your goal?' },
    ftargets: { id: 'ftargets', bare: true },
    fhealth: { id: 'fhealth', title: 'Fill in the rest for you?', when: () => hcOffered() },
  };

  const workoutsOn = (p) => { const x = p || Q; return !x || x.workouts !== false; };
  // Health Connect is only offered where it can work: the Android app on Android 14 or newer.
  function hcOffered() {
    if (!(GH.platform && GH.platform.isApp())) return false;
    const st = H().status();
    return st !== 'unsupported';
  }
  const foodModeOf = (p) => U.answers.foodMode(p || Q);

  let Q = null;       // the draft answers
  let mode = 'new';   // 'new' set-up, 'edit' (every screen), 'one' (a single screen with Save)
  let only = null;    // the screen 'one' mode edits
  let cur = null;     // the screen showing (by id, so the list can change under it)
  let tmpS = null;    // Health Connect data read during set-up, handed to the new state
  let errs = {};      // field → message, for the screen showing

  const clone = (x) => JSON.parse(JSON.stringify(x));
  // The day set-up starts on, as the new state will count it (its day rolls over at 4 am).
  const dayNow = () => B().dayOf(Date.now(), Q && Q.prefs && Q.prefs.rollHour != null ? Q.prefs.rollHour : 4);
  function draftFrom(profile, S) {
    const p = clone(profile);
    const lb = p.units !== 'kg';
    // Editing: the weight shown is your latest one, not the one you started with.
    const kg = S ? (B().weightStats(S, U.today()).current || p.weightKg) : p.weightKg;
    p._w = kg ? Math.round((lb ? kg * B().LB_PER_KG : kg) * 10) / 10 : null;
    p._w0 = p._w;
    p._hcm = p.heightCm || null;
    p._hft = p.heightCm ? Math.floor(p.heightCm / 2.54 / 12) : null;
    p._hin = p.heightCm ? Math.round(p.heightCm / 2.54 - Math.floor(p.heightCm / 2.54 / 12) * 12) : null;
    p._strongArm = p.lead && p.lead.arm ? (p.lead.arm === 'L' ? 'R' : 'L') : 'same';
    p._strongLeg = p.lead && p.lead.leg ? (p.lead.leg === 'L' ? 'R' : 'L') : 'same';
    p._pain = [];
    if (!Array.isArray(p.weekdays)) p.weekdays = [];
    if (!Array.isArray(p.conditions)) p.conditions = [];
    if (!Array.isArray(p.oaJoints)) p.oaJoints = [];
    return p;
  }
  // US-style phones weigh in pounds; everyone else in kilograms.
  function localeUnits() {
    const nav = G.navigator || {};
    const lang = String(nav.language || (nav.languages || [])[0] || 'en-US');
    return /-(US|LR|MM)\b/i.test(lang) ? 'lb' : 'kg';
  }
  // A first run's draft: three 30-minute workouts a week to start, in this phone's units.
  function newDraft() {
    const p = draftFrom(B().defaultProfile());
    p.units = localeUnits();
    p.days = 3;
    p.minutes = 30;
    p._path = 'core';
    p._want = [];
    p._areas = [];
    p._open = {};
    return p;
  }
  function draftProfile() {
    const p = clone(Q);
    const lb = Q.units !== 'kg';
    p.weightKg = Q._w > 0 ? (lb ? Q._w / B().LB_PER_KG : Q._w) : null;
    p.heightCm = lb ? (Q._hft > 0 ? Math.round((Q._hft * 12 + (Q._hin || 0)) * 2.54) : null) : (Q._hcm > 0 ? Math.round(Q._hcm) : null);
    const weaker = (s) => (s === 'R' ? 'L' : s === 'L' ? 'R' : null);
    p.lead = { arm: weaker(Q._strongArm), leg: weaker(Q._strongLeg) };
    p.weekdays = Q.weekdays.length >= 2 ? Q.weekdays.slice().sort((a, b) => a - b) : null;
    if (p.weekdays) p.days = p.weekdays.length;
    // A first run with no days picked: the usual spread, turned so today is a workout day.
    else if (mode === 'new' && Q._path === 'core') { const auto = autoDays(p.days); p.weekdays = sameDays(auto, B().weekdaysFor({ days: p.days })) ? null : auto; }
    if (!p.goals.length) p.goals = ['consistency'];
    if (p.age != null) p.age = Math.round(p.age);
    if (!p.conditions.includes('oa')) p.oaJoints = [];
    if (p.food && p.food.mode) p.protein = Object.assign({}, p.protein, { track: p.food.mode !== 'off' });
    for (const k of Object.keys(p)) if (k[0] === '_') delete p[k];
    return p;
  }
  const sameDays = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // The usual spread of D days (Mon, Wed, Fri for three) when today is one of them; otherwise the
  // same spread started today (Sun, Tue, Thu), so the first workout is today and the next one
  // follows as it would.
  function autoDays(D) {
    const base = B().weekdaysFor({ days: D });
    const wd = B().weekday(dayNow());
    if (base.includes(wd)) return base;
    return base.map((x) => (x - base[0] + wd) % 7).sort((a, b) => a - b);
  }
  // The days showing on the time screen: those picked, else the usual spread from today.
  const shownDays = () => (Q.weekdays.length >= 2 ? Q.weekdays.slice().sort((a, b) => a - b) : autoDays(Q.days));
  // Goals in the order picked, with Build muscle's areas where it was picked.
  function syncGoals() {
    const out = [];
    for (const w of Q._want) {
      if (w === 'muscle') out.push(...Q._areas);
      else out.push(w);
    }
    Q.goals = out.filter((g, i) => out.indexOf(g) === i);
  }

  /* ---------------------------------------------------------------- show / hide */
  // The fade-out that's still running, if any. It holds its end state (fill: forwards) until it's
  // cancelled, so it must be cancelled before the set-up is shown again, or the page would sit there
  // invisible and catch every tap.
  let closing = null;
  function stopClosing() { if (closing) { const a = closing; closing = null; a.onfinish = null; a.cancel(); } }
  let wired = false;
  function wireOnce(el) {
    if (wired) return;
    wired = true;
    // A field that gets focus scrolls to the middle, clear of the keyboard and the buttons.
    el.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!t.matches || !t.matches('input[type="number"], input[type="text"]')) return;
      setTimeout(() => { if (doc().activeElement === t) t.scrollIntoView({ block: 'center', behavior: U.reduced() ? 'auto' : 'smooth' }); }, 280);
    });
    // Enter moves to the next field, and from the last one, on to the next screen.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('.ob-scroll input[type="number"], .ob-scroll input[type="text"]')) return;
      if (e.target.closest('.ob-add')) return;
      e.preventDefault();
      const fields = Array.from(el.querySelectorAll('.ob-scroll input[type="number"], .ob-scroll input[type="text"]')).filter((x) => !x.closest('.ob-add') && x.offsetParent);
      const next = fields[fields.indexOf(e.target) + 1];
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      if (next) next.focus(); else { const b = el.querySelector('.ob-actions [data-variant="tinted"]'); if (b) b.click(); }
    });
    // A disclosure opened or closed stays that way while the screen redraws.
    el.addEventListener('toggle', (e) => {
      const d = e.target;
      if (Q && d.matches && d.matches('details[data-more]')) { Q._open = Q._open || {}; Q._open[d.dataset.more] = d.open; }
    }, true);
    // In a browser the keyboard doesn't shrink the page: lift the buttons above it.
    const vv = G.visualViewport;
    if (vv) vv.addEventListener('resize', () => { el.style.setProperty('--ob-kb', `${Math.max(0, Math.round(G.innerHeight - vv.height - vv.offsetTop))}px`); });
  }
  const doc = () => G.document;
  function open() {
    const el = U.els().onboardEl;
    stopClosing();
    wireOnce(el);
    const was = !el.hidden;
    el.hidden = false;
    el.toggleAttribute('data-edit', mode !== 'new');
    shownStep = null;
    errs = {};
    draw();
    if (!was && !U.reduced() && el.animate) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      if (cur === 'welcome') hello(el);
      else for (const [i, c] of Array.from(el.querySelectorAll('.ob-top, .ob-page, .ob-actions')).entries()) c.animate([{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 40 + i * 50, easing: EASE_ENTER, fill: 'backwards' });
    }
  }
  U.showOnboarding = () => {
    const fresh = !Q;
    if (fresh) { Q = newDraft(); mode = 'new'; cur = null; }
    open();
    // Fetch the 3D figure and warm up the GPU while they answer, so the plan's moves show the 3D
    // figure at once. The warm-up runs in idle slices, so taps never wait on it; a phone with little
    // memory keeps the flat figures.
    const nav = G.navigator || {};
    if (fresh && U.preloadFigure && !(nav.deviceMemory < 3)) setTimeout(() => { if (Q && mode === 'new') U.preloadFigure().catch(() => {}); }, 3000);
  };
  // With a step id, only that screen opens, with Save: changing your equipment doesn't mean walking
  // through the whole set-up again.
  U.editAnswers = (stepId) => {
    Q = draftFrom(U.S.profile, U.S);
    mode = stepId ? 'one' : 'edit';
    only = stepId || null;
    cur = null;
    dir = 1;
    open();
  };
  // (What the other screens list of the answers, U.editableSteps, U.answerSummary and the
  // equipment's, is in src/ui/answers.js.)
  // Runs `after` (which draws the app underneath), then slides the set-up away over it. Drawing the
  // app hides the set-up, so it's shown again for the fade, letting taps through to the app.
  function dismiss(after) {
    const el = U.els().onboardEl;
    const done = () => { el.hidden = true; el.innerHTML = ''; el.removeAttribute('data-closing'); shownStep = null; };
    if (after) after();
    stopClosing();
    if (U.reduced() || !el.animate || !el.firstElementChild) { done(); return; }
    el.hidden = false;
    el.setAttribute('data-closing', '');
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(24px)' }], { duration: 240, easing: EASE_EXIT, fill: 'forwards' });
    closing = a;
    a.onfinish = () => { if (closing === a) closing = null; done(); a.cancel(); };
  }
  function close() {
    stopBuild();
    Q = null;
    dismiss(() => U.render());
  }
  function visible() {
    if (mode === 'one') return STEPS.filter((s) => s.id === only);
    if (mode === 'edit') return STEPS.filter((s) => (!s.when || s.when(Q)) && (!s.workout || workoutsOn()));
    return (PATHS[Q._path] || PATHS.core).map((id) => FIRST[id]).filter((s) => !s.when || s.when(Q));
  }
  function position() {
    const steps = visible();
    let i = steps.findIndex((s) => s.id === cur);
    if (i < 0) i = 0;
    return { steps, i };
  }
  function go(delta) {
    const { steps, i } = position();
    const j = i + delta;
    if (j < 0 || j >= steps.length) return false;
    stopBuild();
    cur = steps[j].id;
    dir = delta > 0 ? 1 : -1;
    errs = {};
    note = null;
    draw();
    return true;
  }
  // Android Back (and the button at the top left): the screen before, or out of an edit.
  U.onboardBack = () => {
    if (!Q) return !!closing; // fading away after it finished: nothing to go back to
    if (mode === 'one') { U.haptic('dismiss'); close(); return true; }
    if (go(-1)) { U.haptic('back'); return true; }
    if (mode === 'edit') { U.haptic('dismiss'); close(); return true; }
    return false;
  };

  /* ---------------------------------------------------------------- drawing */
  const EASE_ENTER = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
  const EASE_EXIT = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
  // A quick move with a touch of overshoot: the spring the app's controls settle with.
  const SPRING = 'cubic-bezier(0.2, 1.18, 0.36, 1)';
  let shownStep = null;
  let dir = 1;
  let note = null; // a passing word for the screen showing ('full': four goals picked; 'max', 'min': days)
  function draw() {
    const el = U.els().onboardEl;
    const { steps, i } = position();
    const st = steps[i];
    cur = st.id;
    const neu = mode === 'new';
    let body = '';
    try { body = VIEW[st.id](); } catch (e) { if (G.console) G.console.error(e); body = `<p class="t-body">${U.esc(e.message)}</p>`; }
    const changed = shownStep !== st.id;
    // The screen going: a copy of it slides out while the new one comes in (see slide()).
    const leaving = changed && shownStep != null && !U.reduced() ? snapshot(el) : null;
    const title = st.bare ? '' : st.title;
    // Top bar and buttons stay put; each step's content is fresh and comes in from the side it comes
    // from. Re-drawing the same step patches it in place, so scroll and focus stay.
    U.morph(el, `${neu ? topNew(steps, i, st) : topEdit(steps, i, st)}
      <div class="ob-scroll" id="obScroll">
        <div class="ob-page${st.bare ? ' is-bare' : ''}" data-key="step-${st.id}" data-step="${st.id}">
          ${title ? `<h1 class="rf-large-title ob-title">${U.esc(title)}</h1>` : ''}
          <div class="ob-body">${body}</div>
        </div>
      </div>
      <div class="ob-actions${neu ? ' is-col' : ''}">${neu ? actionsNew(st) : actionsEdit(st)}</div>`);
    el.setAttribute('data-step', st.id);
    if (aroundCtl && !aroundCtl.closed) aroundCtl.update(aroundBody());
    if (changed) {
      const sc = el.querySelector('#obScroll');
      if (sc) sc.scrollTop = 0;
      if (shownStep != null) slide(el, leaving, dir);
    }
    shownStep = st.id;
    if (AFTER[st.id] && changed) AFTER[st.id](el);
  }
  // Your answers: the screen's section and where it is in the list, as before.
  function topEdit(steps, i, st) {
    const one = mode === 'one';
    const pos = i + 1;
    const back = i > 0 && !one;
    return `<div class="ob-top">
        ${U.glassBtn(back ? 'chevron-left' : 'close', back ? 'Back' : 'Close', 'obBack')}
        ${one ? '<span class="ob-progress"></span>' : `<div class="ob-progress">${U.progress(pos / steps.length, 'Set-up progress')}<span class="t-caption rf-muted ob-where"><span>${U.esc(st.section || '')}</span><span class="rf-num">${pos} of ${steps.length}</span></span></div>`}
        <span class="ob-spacer"></span>
      </div>`;
  }
  // The first run: a dash a screen (the welcome isn't one), filled up to this one.
  function topNew(steps, i, st) {
    const counted = steps.filter((x) => x.id !== 'welcome');
    const n = counted.length;
    const pos = counted.indexOf(st) + 1;
    return `<div class="ob-top">
        ${i > 0 ? U.glassBtn('chevron-left', 'Back', 'obBack') : '<span class="ob-spacer"></span>'}
        ${pos ? `<div class="ob-progress"><div class="ob-steps" role="progressbar" aria-label="Set-up" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${pos}" aria-valuetext="${pos} of ${n}">${counted.map((x, k) => `<i${k < pos - 1 ? ' class="is-done"' : k === pos - 1 ? ' class="is-on"' : ''}></i>`).join('')}</div><span class="t-caption rf-muted ob-count rf-num" aria-hidden="true">${pos} of ${n}</span></div>` : '<span class="ob-progress"></span>'}
        <span class="ob-spacer"></span>
      </div>`;
  }
  function actionsEdit(st) {
    const one = mode === 'one';
    const last = st.id === 'plan' || one;
    return `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-key="primary" data-act="${last ? 'obFinish' : 'obNext'}">${last ? (one ? 'Save' : 'Save changes') : 'Continue'}</button>`;
  }
  // The first run's buttons: a passing word above them, the main one, another way below it.
  function actionsNew(st) {
    const a = (ACT[st.id] && ACT[st.id]()) || {};
    const [act, label, icon, off] = a.primary || ['obNext', 'Continue'];
    return `${a.hint != null ? `<p class="ob-hint${a.hintTone ? ` is-${a.hintTone}` : ''}" data-key="hint" aria-live="polite">${a.hint}</p>` : ''}
      <button type="button" class="rf-btn rf-glass ob-go" data-variant="tinted" data-size="lg" data-key="primary" data-act="${act}"${off ? ' disabled' : ''}>${icon ? U.icon(icon) : ''}<span>${U.esc(label)}</span></button>
      ${a.secondary ? `<button type="button" class="rf-btn ob-alt" data-variant="plain" data-key="secondary" data-act="${a.secondary[0]}"${a.secondary[2] ? ' disabled' : ''}>${U.esc(a.secondary[1])}</button>` : ''}
      ${a.links || ''}`;
  }
  // A still copy of the screen showing, to slide out over the new one (no ids, out of the
  // accessibility tree and unclickable).
  function snapshot(el) {
    const page = el.querySelector('.ob-page');
    const sc = el.querySelector('#obScroll');
    if (!page || !sc || !page.animate) return null;
    const box = sc.getBoundingClientRect(), host = el.getBoundingClientRect();
    const copy = page.cloneNode(true);
    copy.removeAttribute('data-key');
    for (const n of copy.querySelectorAll('[id]')) n.removeAttribute('id');
    // Where the page sits in its scroller: scrolled up, or centred (the welcome).
    return { copy, top: box.top - host.top, left: box.left - host.left, width: box.width, height: box.height, shift: page.getBoundingClientRect().top - box.top };
  }
  // The screen changing: the old one slides out the way the person is going while the new one's
  // parts come in from the other side a beat apart, with a little spring. Transform and opacity only.
  function slide(el, leaving, d) {
    if (U.reduced()) return;
    const page = el.querySelector('.ob-page');
    if (!page || !page.animate) return;
    if (leaving) {
      const exit = doc().createElement('div');
      exit.className = 'ob-exit';
      exit.setAttribute('aria-hidden', 'true');
      exit.inert = true;
      exit.style.cssText = `top:${leaving.top}px;left:${leaving.left}px;width:${leaving.width}px;height:${leaving.height}px`;
      leaving.copy.style.transform = `translateY(${leaving.shift}px)`;
      exit.appendChild(leaving.copy);
      el.appendChild(exit);
      const drop = () => { if (exit.isConnected) exit.remove(); };
      const a = exit.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-d * 18}%) scale(.98)` }], { duration: 230, easing: EASE_EXIT, fill: 'forwards' });
      a.onfinish = drop;
      setTimeout(drop, 500);
    }
    const parts = Array.from(page.querySelectorAll(':scope > .ob-title, :scope > .ob-body > *')).slice(0, 10);
    parts.forEach((n, k) => n.animate([{ opacity: 0, transform: `translateX(${d * 52}px)` }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 40 + k * 38, easing: SPRING, fill: 'backwards' }));
  }
  // The welcome comes in: the logo blooms, then the words and the buttons rise one after another.
  function hello(el) {
    const mark = el.querySelector('.ob-mark');
    if (mark) mark.animate([{ opacity: 0, transform: 'scale(.6)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 760, easing: SPRING, fill: 'backwards' });
    const parts = Array.from(el.querySelectorAll('.ob-hello > :not(.ob-mark):not(.ob-points), .ob-points > li, .ob-actions > *'));
    parts.forEach((n, k) => n.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 160 + k * 70, easing: EASE_ENTER, fill: 'backwards' }));
  }
  // Checks the screen's answers; on a problem, says what's wrong under the field and stays.
  function valid() {
    errs = CHECK[cur] ? CHECK[cur]() : {};
    const keys = Object.keys(errs);
    if (!keys.length) return true;
    U.haptic('deny');
    draw();
    const el = U.els().onboardEl.querySelector(`[data-k="${keys[0]}"]`);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', behavior: U.reduced() ? 'auto' : 'smooth' }); }
    return false;
  }
  U.act.obNext = () => { if (!valid()) return; U.haptic('nav'); go(1); };
  U.act.obBack = () => { U.onboardBack(); };

  /* ---------------------------------------------------------------- generic answer binding */
  const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, path, v) => { const ks = path.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] = a[k] || {}; a[ks[ks.length - 1]] = v; };
  function cast(el, v) {
    const t = el.dataset.type;
    if (t === 'num') return v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);
    if (t === 'bool') return v === true || v === 'true';
    if (t === 'numstr') return /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v;
    return v;
  }
  U.on.q = (el, ev, v) => {
    if (!Q) return;
    const list = el.dataset.list;
    if (list) {
      const arr = (getPath(Q, list) || []).slice();
      const val = el.dataset.vt === 'num' ? Number(el.dataset.v) : el.dataset.v;
      const i = arr.indexOf(val);
      if (v && i < 0) arr.push(val);
      if (!v && i >= 0) arr.splice(i, 1);
      setPath(Q, list, arr);
    } else setPath(Q, el.dataset.k, cast(el, v));
    let redraw = el.hasAttribute('data-redraw');
    // A corrected field loses its message.
    const k = el.dataset.k || el.dataset.list;
    if (k && errs[k]) { delete errs[k]; redraw = true; }
    if (redraw) draw();
  };
  const bind = (k, type, redraw) => `data-on="q" data-k="${k}"${type ? ` data-type="${type}"` : ''}${redraw ? ' data-redraw' : ''}`;
  const listChip = (list, v, label, pressed, vt, redraw) => U.chip(label, pressed, `data-on="q" data-list="${list}" data-v="${U.esc(v)}"${vt ? ` data-vt="${vt}"` : ''}${redraw ? ' data-redraw' : ''}`);
  // A labelled field; a problem with its answer shows under it (and is read out).
  const field = (label, input, hint, k) => {
    const err = k && errs[k];
    const id = k ? `err-${k.replace(/\W/g, '')}` : '';
    const inp = err ? input.replace('<input ', `<input aria-invalid="true" aria-describedby="${id}" `) : input;
    return `<div class="rf-field"${err ? ' data-invalid' : ''}><label class="rf-field-label">${U.esc(label)}</label><div class="rf-field-control">${inp}</div>${hint ? `<p class="rf-field-hint">${U.esc(hint)}</p>` : ''}${err ? `<p class="rf-field-error" id="${id}" role="alert">${U.icon('alert')}<span>${U.esc(err)}</span></p>` : ''}</div>`;
  };
  const numInput = (k, value, placeholder, extra) => `<input class="rf-input" type="number" inputmode="decimal" enterkeyhint="next" value="${value == null ? '' : U.esc(value)}" placeholder="${U.esc(placeholder || '')}" ${bind(k, 'num')} ${extra || ''}>`;
  const group = (title, html, foot) => `<div class="ob-group">${title ? `<h3 class="rf-list-header">${U.esc(title)}</h3>` : ''}${html}${foot ? `<p class="rf-list-footer">${U.esc(foot)}</p>` : ''}</div>`;
  const lead = (text) => `<p class="t-body ob-lead">${text}</p>`;
  const choice = (k, options, value, type, redraw) => `<ul class="rf-list ob-choice" role="radiogroup">${options.map(([v, t, sub]) => `<li><label class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(t)}</span>${sub ? `<span class="rf-list-sub">${U.esc(sub)}</span>` : ''}</span><input type="radio" class="ob-radio" name="${k}" value="${U.esc(v)}"${String(v) === String(value) ? ' checked' : ''} ${bind(k, type, redraw)}><span class="ob-check">${U.icon('check')}</span></label></li>`).join('')}</ul>`;
  const status = (tone, text) => `<div class="ob-status" data-tone="${tone}">${U.icon(tone === 'positive' ? 'check-circle' : tone === 'caution' ? 'alert' : 'info')}<span>${U.esc(text)}</span></div>`;
  // A big card to tap: one choice of several (role radio) or one of a few picks (aria-pressed, with
  // its place in the order on its badge).
  const opt = (o) => `<button type="button" class="ob-opt${o.on ? ' is-on' : ''}${o.cls ? ` ${o.cls}` : ''}" data-act="${o.act}" data-arg="${U.esc(o.arg)}" data-key="opt-${U.esc(o.arg)}" ${o.multi ? `aria-pressed="${!!o.on}"` : `role="radio" aria-checked="${!!o.on}"`}>
      <span class="ob-ico" data-tone="${o.tone}">${U.icon(o.icon)}</span>
      <span class="ob-opt-text"><span class="ob-opt-title">${U.esc(o.title)}</span>${o.sub ? `<span class="ob-opt-sub">${U.esc(o.sub)}</span>` : ''}</span>
      <span class="ob-mark-n" aria-hidden="true">${o.badge ? `<b class="rf-num">${o.badge}</b>` : U.icon('check')}</span>
    </button>`;
  // A row that opens something (a sheet), with what it holds now.
  const linkRow = (act, icon, tone, title, sub, key) => `<button type="button" class="ob-opt ob-link" data-act="${act}" data-key="${key || act}">
      <span class="ob-ico" data-tone="${tone}">${U.icon(icon)}</span>
      <span class="ob-opt-text"><span class="ob-opt-title">${U.esc(title)}</span>${sub ? `<span class="ob-opt-sub">${U.esc(sub)}</span>` : ''}</span>
      ${U.icon('chevron-right', null, 'ob-go-ico')}
    </button>`;
  // A disclosure for details most people skip; it stays open or closed across redraws.
  const more = (key, title, html, openIt, sub) => `<details class="ob-more" data-more="${key}" data-key="more-${key}"${openIt || (Q._open && Q._open[key]) ? ' open' : ''}><summary><span class="ob-more-text"><span class="ob-more-title">${U.esc(title)}</span>${sub ? `<span class="ob-more-sub">${U.esc(sub)}</span>` : ''}</span>${U.icon('chevron-down', 'sm', 'ob-more-chev')}</summary><div class="ob-more-body">${html}</div></details>`;
  const unitsSeg = () => `<div class="ob-pad">${U.seg('units', [['lb', 'lb, ft'], ['kg', 'kg, cm']], Q.units, 'Units', ` ${bind('units', '', true)}`)}</div>`;
  // Age, weight and height, and sex: the same fields on About you, the first run's "A little about
  // you" and the food path's. The age says what it changes in the plan, when workouts are on.
  const ageField = (hint) => {
    const age = A() && workoutsOn() && Q.age >= 13 && Q.age <= 100 ? A().planLines({ age: Q.age }).find((l) => l.kind === 'age') : null;
    return field('Age (optional)', numInput('age', Q.age, 'e.g. 35', 'min="13" max="100" inputmode="numeric" data-redraw'), age ? age.text : hint || '', 'age');
  };
  const sizeFields = (hint) => {
    const lb = Q.units !== 'kg';
    return field(`Weight (${lb ? 'lb' : 'kg'}, optional)`, numInput('_w', Q._w, lb ? 'e.g. 150' : 'e.g. 68', 'min="30" max="700" step="0.1"'), hint || '', '_w')
      + (lb ? `<div class="ob-row2">${field('Height (ft, optional)', numInput('_hft', Q._hft, '5', 'min="3" max="8" inputmode="numeric"'), '', '_hft')}${field('(in)', numInput('_hin', Q._hin, '9', 'min="0" max="11" inputmode="numeric"'), '', '_hin')}</div>`
        : field('Height (cm, optional)', numInput('_hcm', Q._hcm, 'e.g. 175', 'min="100" max="250" inputmode="numeric"'), '', '_hcm'));
  };
  const sexGroup = () => group('Sex (optional)', `<div class="ob-pad">${U.seg('sex', [['female', 'Female'], ['male', 'Male'], ['', 'Skip']], Q.sex || '', 'Sex', ` ${bind('sex')}`)}</div>`, foodModeOf() === 'full' ? 'Used for your calorie target. Skip it and an average is used.' : 'Only used to read your health trends. Skip it if you like.');

  // A weight that isn't in the list: typed in a field of its own, with Add beside it.
  const addRow = (k, u) => `<div class="ob-add"><div class="rf-field-control"><input class="rf-input" type="number" inputmode="decimal" id="add-${k}" placeholder="Other weight (${u})" aria-label="Other ${k === 'db' ? 'dumbbell' : 'kettlebell'} weight"></div><button type="button" class="rf-btn" data-size="sm" data-act="obAddWeight" data-arg="${k}">Add</button></div>`;

  /* ---------------------------------------------------------------- checks */
  const CHECK = {};
  const inRange = (v, lo, hi) => v == null || (v >= lo && v <= hi);
  CHECK.about = () => {
    const out = {};
    const lb = Q.units !== 'kg';
    if (!inRange(Q.age, 13, 100)) out.age = 'Enter an age from 13 to 100.';
    const [wlo, whi] = lb ? [60, 700] : [27, 320];
    if (!inRange(Q._w, wlo, whi)) out._w = `Enter a weight from ${wlo} to ${whi} ${lb ? 'lb' : 'kg'}.`;
    if (lb) {
      if (!inRange(Q._hft, 3, 8)) out._hft = 'Feet from 3 to 8.';
      else if (Q._hft == null && Q._hin != null) out._hft = 'Add the feet too.';
      if (!inRange(Q._hin, 0, 11)) out._hin = 'Inches from 0 to 11.';
    } else if (!inRange(Q._hcm, 100, 250)) out._hcm = 'Enter a height from 100 to 250 cm.';
    return out;
  };
  CHECK.you = CHECK.about;
  CHECK.fabout = CHECK.about;
  CHECK.nutrition = () => (Q.protein && !inRange(Q.protein.quickG, 1, 100) ? { 'protein.quickG': 'Grams from 1 to 100.' } : {});

  /* ---------------------------------------------------------------- the first run */
  const VIEW = {};
  const AFTER = {};
  const ACT = {};

  // Welcome: what this is, in three lines, and the way in. A plan a friend sent takes the lead.
  VIEW.welcome = () => {
    const sh = Q._shared;
    const point = (icon, tone, title, sub) => `<li><span class="ob-ico is-sm" data-tone="${tone}">${U.icon(icon)}</span><span class="ob-point-text"><span class="ob-point-title">${U.esc(title)}</span><span class="ob-point-sub">${U.esc(sub)}</span></span></li>`;
    return `<div class="ob-hello" data-key="hello">
      <div class="ob-mark" aria-hidden="true"><span class="ob-halo"></span>${GH.LOGO ? `<img class="ob-logo" src="${GH.LOGO}" alt="" width="104" height="104">` : ''}</div>
      <h1 class="rf-large-title ob-hero-title">Gradient Health</h1>
      <p class="ob-tagline">Workouts that fit your goals, your time and your body.</p>
      ${sh ? sharedCard(sh) : `<ul class="ob-points">
        ${point('sparkle', 'violet', 'Your plan in under a minute', 'Four quick questions, then your first workout.')}
        ${point('refresh', 'green', 'It adapts after every workout', 'Too easy and it steps up. A rough night and it eases off.')}
        ${point('lock', 'sky', 'No account, no ads', 'Everything stays on your phone.')}
      </ul>`}
    </div>`;
  };
  const sender = (sh) => (sh && sh.plan && sh.plan.from ? String(sh.plan.from) : '');
  function sharedCard(sh) {
    const plan = sh.plan;
    const n = plan.days.length;
    const who = sender(sh);
    const titles = C() ? plan.days.slice(0, 4).map((d, i) => C().titleOf(plan, i)) : [];
    return `<div class="card ob-shared" data-key="shared">
      <span class="ob-shared-eyebrow">${U.icon('share', 'sm')}<span>${U.esc(who ? `${who} sent you a plan` : 'Someone sent you a plan')}</span></span>
      <span class="ob-shared-name">${U.esc(plan.name)}</span>
      <span class="ob-shared-meta">${U.esc(`${U.plural(n, 'day')} a week · ${U.plural(plan.days.reduce((a, d) => a + d.items.length, 0), 'exercise')}`)}</span>
      ${titles.length ? `<ol class="ob-shared-days">${titles.map((t, i) => `<li><b class="rf-num">${i + 1}</b><span>${U.esc(t)}</span></li>`).join('')}</ol>` : ''}
      <span class="ob-shared-foot">${U.esc('Two quick questions and you\'re in. It\'s fitted to your kit and your body.')}</span>
    </div>`;
  }
  ACT.welcome = () => {
    const sh = Q._shared;
    const who = sender(sh);
    const links = `<div class="ob-links" data-key="links"><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="obRestore">Restore from a backup</button><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="obFood">Just tracking food?</button></div>`;
    return sh ? { primary: ['obFriend', who ? `Start with ${who}'s plan` : 'Start with this plan', 'play'], secondary: ['obStart', 'Make my own plan instead'], links }
      : { primary: ['obStart', 'Get started'], links };
  };
  // A plan link waiting (the app was opened by one, or one arrived while this shows): its card.
  AFTER.welcome = () => peekShared();
  function peekShared() {
    if (!Q || mode !== 'new' || Q._shared || !U.peekSharedPlan) return;
    U.peekSharedPlan().then((got) => {
      if (!got || !got.plan || !Q || mode !== 'new' || Q._shared) return;
      Q._shared = got;
      if (cur === 'welcome' && !U.els().onboardEl.hidden) {
        draw();
        const card = U.els().onboardEl.querySelector('.ob-shared');
        if (card && card.animate && !U.reduced()) card.animate([{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 560, easing: SPRING });
      }
    }, () => {});
  }
  if (G.document) G.document.addEventListener('gh-shared-plan', () => peekShared());
  U.act.obStart = () => {
    Q._path = 'core';
    Q.workouts = true;
    Q.food = Object.assign({}, Q.food || {}, { mode: 'protein' });
    U.haptic('nav');
    go(1);
  };
  U.act.obFood = () => {
    Q._path = 'food';
    Q.workouts = false;
    Q.food = Object.assign({}, Q.food || {}, { mode: 'full' });
    U.haptic('nav');
    go(1);
  };
  // A friend's plan: what they want is filled in from what the plan trains, the days come from it.
  U.act.obFriend = () => {
    const sh = Q._shared;
    if (!sh) return;
    Q._path = 'friend';
    Q.workouts = true;
    Q.food = Object.assign({}, Q.food || {}, { mode: 'protein' });
    if (!Q._wantSet) {
      const w = wantsOf(sh.plan);
      Q._want = w.want; Q._areas = w.areas; Q._wantSet = true;
      syncGoals();
    }
    Q.days = Math.max(2, Math.min(6, sh.plan.days.length));
    Q.weekdays = Array.isArray(sh.plan.weekdays) && sh.plan.weekdays.length >= 2 ? sh.plan.weekdays.slice(0, 6) : [];
    U.haptic('nav');
    go(1);
  };
  // What a plan trains most: Build muscle with its top two areas, Get fitter when it's half cardio.
  function wantsOf(plan) {
    const sets = {};
    let cardio = 0, all = 0;
    for (const d of plan.days) {
      for (const it of d.items) {
        const m = M().MOVES[it.move];
        if (!m) continue;
        const n = Number(it.sets) || 1;
        all += n;
        if (m.group === 'conditioning') { cardio += n; continue; }
        const u = Object.keys(UNIT_GROUPS).find((k) => UNIT_GROUPS[k].includes(m.group));
        if (u) sets[u] = (sets[u] || 0) + n;
      }
    }
    const areas = Object.keys(sets).sort((a, b) => sets[b] - sets[a]).slice(0, 2);
    const want = [];
    if (areas.length) want.push('muscle');
    if (all && cardio / all >= 0.5) want.push('endurance');
    if (!want.length) want.push('consistency');
    return { want, areas };
  }
  // Restore from a backup: the restore sheet Settings uses. Restored, the set-up is done with.
  U.act.obRestore = () => {
    if (!U.act.restoreSheet) return;
    U.act.restoreSheet();
    const ctl = U.topSheet && U.topSheet();
    if (ctl && ctl.el) ctl.el.addEventListener('close', () => setTimeout(afterRestore, 0), { once: true });
  };
  function afterRestore() {
    if (!(U.S && U.S.profile && U.S.profile.onboarded) || mode !== 'new') return;
    stopBuild();
    Q = null; tmpS = null; cur = null; errs = {};
    const el = U.els().onboardEl;
    el.hidden = true;
    el.innerHTML = '';
    shownStep = null;
    // As if the app had just opened with it: What's new if it's from an older version, badges.
    if (U.afterBoot) { try { U.afterBoot(); } catch (e) { if (G.console) G.console.error(e); } }
  }

  // What do you want most? Up to three, most important first; a line says how the plan leans.
  VIEW.want = () => {
    const pos = (id) => Q._want.indexOf(id) + 1;
    const cards = WANT.map((w) => {
      const n = pos(w.id);
      const card = opt({ act: 'obWant', arg: w.id, icon: w.icon, tone: w.tone, title: w.title, sub: w.sub, on: n > 0, badge: n || null, multi: true });
      if (w.id !== 'muscle' || !n) return card;
      const all = !Q._areas.length;
      return `<div class="ob-opt-group" data-key="muscle">${card}<div class="ob-areas" data-key="areas"><p class="ob-areas-title">Where do you want it most?</p><div class="ob-chips">${U.chip('All over', all, 'data-on="obArea" data-v="all"')}${AREAS.map(([id, t]) => U.chip(t, Q._areas.includes(id), `data-on="obArea" data-v="${id}"`)).join('')}</div></div></div>`;
    }).join('');
    return lead('Pick up to 3, the most important first. You can change them any time.') + `<div class="ob-opts" data-key="wants">${cards}</div>`;
  };
  ACT.want = () => (note === 'full' ? { hint: `${U.icon('alert', 'sm')}<span>Up to 3. Tap one to take it off.</span>`, hintTone: 'caution' } : { hint: `${U.icon('sparkle', 'sm')}<span>${U.esc(leanLine())}</span>` });
  U.act.obWant = (el) => {
    if (!Q) return;
    const id = el.dataset.arg;
    const i = Q._want.indexOf(id);
    if (i >= 0) { Q._want.splice(i, 1); U.haptic('toggleOff'); note = null; }
    else if (Q._want.length >= 3) { U.haptic('deny'); note = 'full'; draw(); shake(U.els().onboardEl.querySelector(`.ob-opt[data-arg="${id}"]`)); return; }
    else { Q._want.push(id); U.haptic('toggleOn'); note = null; }
    syncGoals();
    draw();
    const card = U.els().onboardEl.querySelector(`.ob-opt[data-arg="${id}"]`);
    if (card && i < 0) pop(card.querySelector('.ob-mark-n'));
    const areas = id === 'muscle' && i < 0 && U.els().onboardEl.querySelector('.ob-areas');
    if (areas && areas.animate && !U.reduced()) areas.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE_ENTER });
  };
  // Areas for Build muscle, in the order tapped. All over is none in particular.
  U.on.obArea = (el, ev, v) => {
    if (!Q) return;
    const id = el.dataset.v;
    if (id === 'all') { if (v) Q._areas = []; }
    else if (v && !Q._areas.includes(id)) Q._areas.push(id);
    else if (!v) Q._areas = Q._areas.filter((x) => x !== id);
    syncGoals();
    draw();
  };
  // How the plan leans, from what's picked: "Your plan leans on legs and arms, then chest."
  function leanLine() {
    if (!Q._want.length) return 'Pick what matters most and your plan leans that way.';
    const p = draftProfile();
    const t = B().programFor(p).tiers;
    const tierOf = (u) => Math.min(...UNIT_GROUPS[u].map((g) => t[g] || 3));
    const word = (u) => (u === 'legs' ? 'legs' : u);
    const picked = Q._want.includes('muscle') ? Q._areas : [];
    const one = picked.filter((u) => tierOf(u) === 1), two = picked.filter((u) => tierOf(u) === 2);
    const out = [];
    if (one.length) out.push(`Your plan leans on ${joinWords(one.map(word))}${two.length ? `, then ${joinWords(two.map(word))}` : ''}.`);
    else if (Q._want.includes('muscle')) out.push('An all-over plan: every muscle gets the same attention.');
    else if (Q._want.includes('strength')) out.push('Every muscle, with fewer, harder reps on the big moves.');
    else out.push('A balanced plan for every muscle.');
    if (one.length && Q._want.includes('strength')) out.push('Harder reps on the big moves.');
    if (Q._want.includes('fat')) out.push('Plus a short burst at the end to burn more.');
    else if (Q._want.includes('endurance')) out.push('Plus short bursts to build stamina.');
    if (Q._want.includes('mobility')) out.push('Extra stretching after each workout.');
    return out.slice(0, 2).join(' ');
  }
  const joinWords = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  // A tap refused: the card shakes its head.
  function shake(el) {
    if (!el || !el.animate || U.reduced()) return;
    el.animate([{ transform: 'none' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
  }
  // A badge or a check landing.
  function pop(el) {
    if (!el || !el.animate || U.reduced()) return;
    el.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'ease-out' });
  }

  // How much time do you have? Days and minutes, and the week they make: tap a day to choose your own.
  VIEW.time = () => {
    const shown = shownDays();
    const today = B().weekday(dayNow());
    const picked = Q.weekdays.length >= 2;
    const strip = DAYS.map((d, wd) => {
      const on = shown.includes(wd);
      return `<button type="button" class="ob-wd${on ? ' is-on' : ''}${wd === today ? ' is-today' : ''}" data-act="obDay" data-arg="${wd}" aria-pressed="${on}" aria-label="${DAY_NAMES[wd]}${wd === today ? ', today' : ''}"><span class="ob-wd-l">${d.slice(0, 1)}</span><span class="ob-wd-dot" aria-hidden="true">${U.icon('dumbbell')}</span><span class="ob-wd-cap" aria-hidden="true">${wd === today ? 'Today' : ''}</span></button>`;
    }).join('');
    return group('Workouts a week', `<div class="ob-pad">${U.seg('obDaysN', [2, 3, 4, 5, 6].map((n) => [String(n), String(n)]), String(Q.days), 'Workouts a week', ' data-on="obDaysN"')}</div>`)
      + `<div class="ob-week-box" data-key="week"><div class="ob-week" role="group" aria-label="Your workout days">${strip}</div>
        <p class="ob-week-foot">${picked ? `Your days.${shown.includes(today) ? '' : ` First workout: ${DAY_NAMES[nextOf(shown, today)]}.`} <button type="button" class="rf-btn ob-inline-btn" data-variant="plain" data-size="sm" data-act="obDaysAuto">Let the app pick</button>` : 'Tap a day to choose your own (optional).'}</p></div>`
      + group('Minutes each', `<div class="ob-pad">${U.seg('obMins', MINUTES.map((m) => [String(m), String(m)]), String(Q.minutes), 'Minutes each workout', ' data-on="obMins"')}</div>`, 'Short on time on the day? A 12 to 15 minute version is a tap away.');
  };
  const nextOf = (days, wd) => { for (let k = 1; k <= 7; k++) if (days.includes((wd + k) % 7)) return (wd + k) % 7; return wd; };
  ACT.time = () => {
    if (note === 'max') return { hint: `${U.icon('alert', 'sm')}<span>Six days at most: one stays for rest.</span>`, hintTone: 'caution' };
    if (note === 'min') return { hint: `${U.icon('alert', 'sm')}<span>Two days a week at least.</span>`, hintTone: 'caution' };
    const today = B().weekday(dayNow());
    const on = shownDays().includes(today);
    return { hint: on ? `${U.icon('play', 'sm')}<span>Your first workout is today, about ${Q.minutes} minutes.</span>` : `${U.icon('calendar', 'sm')}<span>Your first workout is on ${DAY_NAMES[nextOf(shownDays(), today)]}.</span>` };
  };
  U.on.obDaysN = (el, ev, v) => {
    if (!Q) return;
    const n = Number(v);
    if (Q.weekdays.length >= 2) { const r = B().setWorkoutDays(Q.weekdays, n); Q.days = r.days; Q.weekdays = r.weekdays; } else Q.days = n;
    note = null;
    draw();
  };
  U.on.obMins = (el, ev, v) => { if (!Q) return; Q.minutes = Number(v) || 30; draw(); };
  U.act.obDay = (el) => {
    if (!Q) return;
    const wd = Number(el.dataset.arg);
    const shown = shownDays();
    const on = !shown.includes(wd);
    if (!on && shown.length <= 2) { note = 'min'; U.haptic('deny'); draw(); return; }
    const r = B().pickWeekday(Q.days, shown, wd, on);
    if (r.note === 'max') { note = 'max'; U.haptic('deny'); draw(); return; }
    Q.days = r.days;
    Q.weekdays = r.weekdays.slice();
    note = null;
    U.haptic(on ? 'toggleOn' : 'toggleOff');
    draw();
    if (on) pop(U.els().onboardEl.querySelector(`.ob-wd[data-arg="${wd}"] .ob-wd-dot`));
  };
  U.act.obDaysAuto = () => { if (!Q) return; Q.weekdays = []; note = null; U.haptic('select'); draw(); };

  // Where do you train? Home, gym or both; what's there in a few taps, the details folded away.
  VIEW.where = () => {
    const where = Q.where || 'home';
    Q.gym = Object.assign(B().defaultGym(), Q.gym || {});
    const tiles = `<div class="ob-tiles" role="radiogroup" aria-label="Where you train" data-key="places">${PLACES.map(([id, icon, tone, label]) => `<button type="button" class="ob-tile${where === id ? ' is-on' : ''}" data-act="obPlace" data-arg="${id}" role="radio" aria-checked="${where === id}"><span class="ob-ico" data-tone="${tone}">${U.icon(icon)}</span><span class="ob-tile-label">${label}</span></button>`).join('')}</div>`;
    return tiles
      + (where !== 'gym' ? homeKit(where === 'both') : '')
      + (where !== 'home' ? gymKit(where === 'both') : '');
  };
  ACT.where = () => {
    if (Q._path !== 'friend' || !Q._shared) return {};
    const n = friendSwaps().length;
    return { hint: n ? `${U.icon('shuffle', 'sm')}<span>${U.esc(`${n === 1 ? '1 exercise' : `${n} exercises`} in ${sender(Q._shared) || 'this'}${sender(Q._shared) ? '\'s' : ''} plan ${n === 1 ? 'is' : 'are'} swapped for ${n === 1 ? 'one' : 'ones'} you can do here.`)}</span>` : `${U.icon('check-circle', 'sm')}<span>Everything in this plan works with what you have.</span>` };
  };
  function homeKit(both) {
    const eq = Q.equipment;
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    const has = { db: (eq.db || []).length > 0, kb: (eq.kb || []).length > 0, band: !!eq.band, bar: !!eq.bar, ball: !!eq.ball };
    const none = !Object.values(has).some(Boolean);
    const chips = `<div class="ob-chips ob-kit">${U.chip('Just my body', none, 'data-on="obKit" data-v="none"')}${KIT.map(([k, t]) => U.chip(t, has[k], `data-on="obKit" data-v="${k}"`)).join('')}</div>`;
    const weights = (k, name) => {
      const list = [...new Set(WEIGHTS[k][u].concat(eq[k] || []))].sort((a, b) => a - b);
      return `<p class="ob-more-label">${name}</p><div class="ob-chips">${list.map((w) => listChip(`equipment.${k}`, w, `${w} ${u}`, (eq[k] || []).includes(w), 'num', true)).join('')}</div>
        ${addRow(k, u)}`;
    };
    const exact = has.db || has.kb ? more('weights', 'Exact weights', `${unitsSeg()}${has.db ? weights('db', 'Dumbbells') : ''}${has.kb ? weights('kb', 'Kettlebells') : ''}`, false, [has.db ? `Dumbbells: ${eq.db.slice().sort((a, b) => a - b).join(', ')} ${u}` : '', has.kb ? `Kettlebells: ${eq.kb.slice().sort((a, b) => a - b).join(', ')} ${u}` : ''].filter(Boolean).join(' · ')) : '';
    const house = more('house', 'Around the house', `<ul class="rf-list">
        ${U.sw('Chair or couch', eq.chair !== false, bind('equipment.chair'))}
        ${U.sw('Clear wall space', eq.wall !== false, bind('equipment.wall'))}
        ${U.sw('Towel', eq.towel !== false, bind('equipment.towel'))}
        ${U.sw('Sturdy table (for rows under it)', eq.table, bind('equipment.table'))}
        ${eq.band ? U.sw('Door anchor for the band', eq.door, bind('equipment.door')) : ''}
        ${eq.ball ? U.sw('It\'s OK to slam the ball', eq.ballSlam, bind('equipment.ballSlam')) : ''}
      </ul>`, false, 'A chair, a wall, a towel: used if you have them');
    return group(both ? 'At home' : 'What do you have?', `${chips}${exact}${house}`);
  }
  function gymKit(both) {
    const pick = Q._preset || null;
    const cards = Object.entries(B().GYM_PRESETS).map(([id, pr]) => opt({ act: 'obPreset', arg: id, icon: id === 'full' ? 'dumbbell' : id === 'basic' ? 'bolt' : 'home', tone: id === 'full' ? 'violet' : id === 'basic' ? 'indigo' : 'teal', title: pr.name, sub: PRESET_SUB[id], on: pick === id, cls: 'is-compact' })).join('');
    return group(both ? 'At the gym' : 'What\'s your gym like?', `<div class="ob-opts" role="radiogroup" aria-label="Your gym">${cards}</div>${more('gym', 'Adjust', gymGroups(), false, 'The exact machines and weights')}`);
  }
  U.act.obPlace = (el) => {
    if (!Q) return;
    const w = el.dataset.arg;
    if (Q.where === w) return;
    Q.where = w;
    // A gym starts as a full gym: most are.
    if (w !== 'home' && !Q._preset) { Q._preset = 'full'; Q.gym = B().gymPreset('full', Q.units); }
    U.haptic('select');
    draw();
  };
  U.act.obPreset = (el) => {
    if (!Q) return;
    const pr = B().gymPreset(el.dataset.arg, Q.units);
    if (!pr) return;
    Q.gym = pr;
    Q._preset = el.dataset.arg;
    U.haptic('select');
    draw();
  };
  // The kit chips: each weight set starts from a common one (Exact weights changes it); Just my body
  // clears the rest.
  U.on.obKit = (el, ev, v) => {
    if (!Q) return;
    const k = el.dataset.v;
    const eq = Q.equipment;
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    Q._kitWas = Q._kitWas || {};
    if (k === 'none') {
      if (v) { for (const x of ['db', 'kb']) { if ((eq[x] || []).length) Q._kitWas[x] = eq[x].slice(); eq[x] = []; } eq.band = false; eq.bar = false; eq.ball = false; }
    } else if (k === 'db' || k === 'kb') {
      if (v) eq[k] = (Q._kitWas[k] && Q._kitWas[k].length ? Q._kitWas[k] : KIT_START[k][u]).slice();
      else { if ((eq[k] || []).length) Q._kitWas[k] = eq[k].slice(); eq[k] = []; }
    } else eq[k] = !!v;
    draw();
  };

  // A little about you: age, how much you've trained, anything to plan around, and (folded away)
  // weight and height.
  VIEW.you = () => {
    const sizeErr = ['_w', '_hft', '_hin', '_hcm'].some((k) => errs[k]);
    const levels = `<div class="ob-opts" role="radiogroup" aria-label="How much have you trained?" data-key="levels">${LEVELS.map((l) => opt({ act: 'obLevel', arg: l.id, icon: l.icon, tone: l.tone, title: l.title, sub: l.sub, on: levelOf() === l.id })).join('')}</div>`;
    const size = `${unitsSeg()}<div class="ob-fields">${sizeFields()}</div>${sexGroup()}`;
    return `<div class="ob-fields" data-key="age">${ageField('A plan that suits your age.')}</div>`
      + group('How much have you trained?', levels)
      + linkRow('obAround', 'heart', 'rose', 'Anything to plan around?', aroundSummary() || 'Sore joints, old injuries, health conditions (optional)', 'around')
      + more('size', 'Weight and height (optional)', size, sizeErr, Q._w || Q._hcm || Q._hft ? sizeWords() : 'For your protein goal and your weight trend');
  };
  ACT.you = () => ({ primary: ['obNext', 'See my plan', 'sparkle'] });
  // The three cards cover the five answers: the two below a year count as new.
  const levelOf = () => (Q.experience === '3plus' ? '3plus' : Q.experience === '1to3' || Q.experience === 'lt1' ? '1to3' : 'onoff');
  U.act.obLevel = (el) => {
    if (!Q) return;
    const l = LEVELS.find((x) => x.id === el.dataset.arg);
    if (!l) return;
    Q.experience = l.id;
    Q.recentActivity = l.recent;
    U.haptic('select');
    draw();
  };
  function sizeWords() {
    const lb = Q.units !== 'kg';
    const w = Q._w ? `${Q._w} ${lb ? 'lb' : 'kg'}` : '';
    const h = lb ? (Q._hft ? `${Q._hft} ft ${Q._hin || 0} in` : '') : (Q._hcm ? `${Q._hcm} cm` : '');
    return [w, h].filter(Boolean).join(' · ');
  }
  // What's planned around, in a few words, for the row that opens the sheet.
  function aroundSummary() {
    const bits = [];
    const names = (list) => list.map((j) => (JOINTS.find((x) => x[0] === j) || [j, j])[1].toLowerCase());
    for (const c of Q.conditions || []) { const x = A() && A().CONDITIONS.find((y) => y.id === c); if (x) bits.push(x.name); }
    if ((Q._pain || []).length) bits.push(`sore ${joinWords(names(Q._pain))}`);
    if ((Q.careful || []).length) bits.push(`careful with ${joinWords(names(Q.careful))}`);
    if (Q.gentle) bits.push('taking it easy');
    if (Q.floorOk === false) bits.push('staying off the floor');
    const s = bits.join(' · ');
    return s ? U.cap(s) : '';
  }

  // "Anything to plan around?": sore joints, old injuries, health conditions and taking it easy, in a
  // sheet over the screen (the same answers Your answers asks in two screens).
  let aroundCtl = null;
  U.act.obAround = () => {
    if (!Q || (aroundCtl && !aroundCtl.closed)) return;
    aroundCtl = U.sheet({
      title: 'Anything to plan around?', size: 'full', cls: 'ob-around-sheet', body: aroundBody(),
      action: { label: 'Done', act: 'obAroundDone' },
      onClose: () => { aroundCtl = null; if (Q && cur === 'you' && !U.els().onboardEl.hidden) draw(); },
    });
  };
  U.act.obAroundDone = () => { if (aroundCtl) { U.haptic('save'); aroundCtl.close('ok'); } };
  function aroundBody() {
    if (!Q) return '';
    const h = healthParts('Not medical advice. If a move hurts, stop, and say so after your workout.');
    return `<div class="sheet-pad ob-around-body">
      <p class="t-callout rf-muted">Pick anything that applies and your plan works around it. All optional, and it stays on this phone.</p>
      ${jointGroups(true)}${h.pick}
      <ul class="rf-list">${U.sw('A doctor told me to take it easy', Q.gentle, bind('gentle', '', true), 'A gentler start, fewer sets, no jumping.')}</ul>
      ${h.after}
    </div>`;
  }
  // Sore joints and old injuries (the sheet, and Joints and sides). redraw: the sheet's summary of
  // what's planned around follows each tap.
  const jointGroups = (redraw) => group('Does anything hurt right now?', `<div class="ob-chips">${JOINTS.map(([id, t]) => listChip('_pain', id, t, Q._pain.includes(id), '', redraw)).join('')}</div>`, 'Moves that load these are swapped out for two weeks.')
    + group('Old injuries to be careful with', `<div class="ob-chips">${JOINTS.map(([id, t]) => listChip('careful', id, t, (Q.careful || []).includes(id), '', redraw)).join('')}</div>`, 'Jumps and tricky versions are left out for these.');
  // Health conditions (the sheet, and Anything we should plan around?): the chips with the questions
  // they bring (which joints, the floor), then what they change and when to ask a doctor.
  function healthParts(foot) {
    const ac = A();
    const p = draftProfile();
    const has = (id) => Q.conditions.includes(id);
    const floorQ = !has('seated') && (Q.age >= 60 || ['balance', 'ra', 'oa', 'osteo'].some(has));
    const lines = ac.planLines(p);
    return {
      pick: group('Health', `<div class="ob-chips">${ac.CONDITIONS.map((c) => listChip('conditions', c.id, c.name, has(c.id), '', true)).join('')}</div>`, foot)
        + (has('oa') ? group('Which joints?', `<div class="ob-chips">${ac.OA_JOINTS.map(([id, t]) => listChip('oaJoints', id, t, Q.oaJoints.includes(id), '', true)).join('')}</div>`, 'Knees and hips if you don\'t pick any.') : '')
        + (floorQ ? group('Getting down to the floor and back up', `<div class="ob-pad">${U.seg('floorOk', [['true', 'Easy enough'], ['false', 'Hard']], Q.floorOk === false ? 'false' : 'true', 'Getting down to the floor', ` ${bind('floorOk', 'bool', true)}`)}</div>`, 'If it\'s hard, nothing in your plan is on the floor.') : ''),
      after: (lines.length ? `<div class="card ob-card ob-around" data-key="around"><p class="t-headline">${U.esc(ac.plannedAround(p) || 'Your plan')}</p><ul class="ob-bullets">${lines.map((l) => `<li>${U.esc(l.text)}</li>`).join('')}</ul></div>` : '')
        + ac.doctorLines(p).map((t) => status('caution', t)).join('')
        + '<p class="t-footnote rf-muted ob-note">Pregnant? This plan isn\'t built for pregnancy. Ask your midwife or doctor what\'s right for you.</p>',
    };
  }

  /* ---------------------------------------------------------------- the plan, revealed */
  // The plan the answers make, worked out by the engine (GH.optimizer.explainProfile): the next
  // seven days from today, the first workout with its moves, and why it's this plan. It's worked
  // out behind a short "Building your plan" moment (the engine compares thousands of weeks) and kept
  // while the answers stay the same, so Back and forward again shows it at once.
  let rv = null;     // { key, ... } the plan for the answers it was made from
  let rvGen = 0;     // the build in progress (a newer one, or leaving, stops an older one)
  const stopBuild = () => { rvGen++; };
  const revealKey = () => `${dayNow()}|${JSON.stringify(draftProfile())}`;
  VIEW.reveal = () => (rv && rv.key === revealKey() ? revealHtml(rv) : buildHtml());
  ACT.reveal = () => {
    const ready = rv && rv.key === revealKey();
    if (!ready) return { primary: ['obGo', 'Start my first workout', 'play', true], secondary: ['obLook', 'Look around first', true] };
    if (rv.error) return { primary: ['obLook', 'Let\'s go'] };
    return rv.startable ? { primary: ['obGo', 'Start my first workout', 'play'], secondary: ['obLook', 'Look around first'] } : { primary: ['obLook', 'Let\'s go'] };
  };
  AFTER.reveal = (el) => {
    if (rv && rv.key === revealKey()) { revealIn(el, true); return; }
    const gen = ++rvGen;
    const finish = () => {
      if (gen !== rvGen || cur !== 'reveal' || !Q) return;
      draw();
      revealIn(U.els().onboardEl, false);
    };
    if (U.reduced()) { rv = revealData(); finish(); return; }
    // Each line ticks off a beat apart while the plan is worked out (after the first frame is up).
    [280, 540, 800].forEach((ms, k) => setTimeout(() => {
      if (gen !== rvGen) return;
      const li = el.querySelector(`.ob-build-steps li[data-i="${k}"]`);
      if (li) { li.classList.add('is-done'); U.haptic('tick'); }
    }, ms));
    const t0 = Date.now();
    setTimeout(() => {
      if (gen !== rvGen || !Q) return;
      rv = revealData();
      setTimeout(finish, Math.max(120, 1050 - (Date.now() - t0)));
    }, 90);
  };
  function buildHtml() {
    const kit = (Q.where || 'home') === 'gym' ? 'your gym' : U.equipCount(Q.equipment || {}) ? 'your kit' : 'no equipment';
    return `<div class="ob-build" data-key="build" role="status">
      <div class="ob-orb" aria-hidden="true"><span class="ob-orb-glow"></span><span class="ob-orb-ring"></span>${GH.LOGO ? `<img class="ob-orb-logo" src="${GH.LOGO}" alt="" width="64" height="64">` : ''}</div>
      <h1 class="rf-large-title ob-build-title">Building your plan</h1>
      <ul class="ob-build-steps">
        <li data-i="0"><span class="ob-tick">${U.icon('check')}</span>Matching your goals</li>
        <li data-i="1"><span class="ob-tick">${U.icon('check')}</span>Fitting it into ${Q.minutes} minutes</li>
        <li data-i="2"><span class="ob-tick">${U.icon('check')}</span>Picking moves for ${kit}</li>
      </ul>
    </div>`;
  }
  function revealData() {
    const day = dayNow();
    const key = revealKey();
    const p = draftProfile();
    try {
      const x = GH.optimizer.explainProfile(p, day);
      const S0 = B().newState(p, null, day);
      const ws = B().weekStart(day);
      const next = GH.optimizer.weekPlan(S0, ws + 7);
      // The next seven days from today: this week's sessions as planned, then next week's.
      const days = [];
      for (let d = day; d < day + 7; d++) {
        const wd = B().weekday(d);
        let title = null;
        if (d <= ws + 6) { const s = x.week.find((w) => w.day === d); title = s ? s.title : null; }
        else { const t = next.days.find((w) => w.offset === d - ws - 7); title = t ? B().templateTitle(t.units) : null; }
        days.push({ day: d, wd, kind: title ? 'work' : p.lightDays !== false ? 'light' : 'rest', title, today: d === day });
      }
      let first = x.today;
      // Nothing left this week (days picked that skip today, late in the week): next week's first.
      if (!first) { const d = days.find((z) => z.kind === 'work'); if (d) first = GH.optimizer.explain(S0, d.day).today; }
      const around = A() ? A().plannedAround(p) : null;
      const reasons = (x.reasons || []).slice(1).filter((r) => !around || r.indexOf(around) !== 0).slice(0, 3);
      const plan = B().todayPlan(S0, day);
      // The coach's review, when there's a coach to ask (GH.planReview says; a promise counts as no).
      const can = GH.planReview && GH.planReview.available ? GH.planReview.available(S0) : false;
      const review = !!can && typeof can.then !== 'function';
      return { key, day, p, x, days, first, reasons, around, startable: plan.type === 'workout', review, eq: B().eqFor(S0, day) };
    } catch (e) {
      if (G.console) G.console.error(e);
      return { key, day, p, error: true, days: [], reasons: [] };
    }
  }
  function revealHtml(r) {
    const p = r.p;
    if (r.error) return `<div class="ob-reveal" data-key="reveal" data-ready><h1 class="rf-large-title ob-title">Your plan</h1><p class="t-body">${U.esc(`${U.plural(p.days, 'workout')} a week, ${p.minutes} minutes each. Today shows your first one.`)}</p></div>`;
    const lean = Q._want.length ? leanLine() : 'A balanced plan for every muscle.';
    const n = r.days.filter((d) => d.kind === 'work').length;
    const rest = r.days.filter((d) => d.kind === 'light').length;
    const dayCell = (d) => `<li class="rv-day is-${d.kind}${d.today ? ' is-today' : ''}" aria-label="${U.esc(`${d.today ? 'Today' : DAY_NAMES[d.wd]}: ${d.kind === 'work' ? d.title : d.kind === 'light' ? 'walk and stretch' : 'rest'}`)}"><span class="rv-wd">${d.today ? 'Today' : DAYS[d.wd]}</span><span class="rv-dot">${d.kind === 'work' ? U.icon('dumbbell') : d.kind === 'light' ? U.icon('leaf') : ''}</span></li>`;
    return `<div class="ob-reveal" data-key="reveal" data-ready>
      <div class="rv-hero">
        <span class="rv-badge" aria-hidden="true">${U.icon('check')}</span>
        <h1 class="rf-large-title ob-title rv-title">Your plan</h1>
        <p class="rv-head">${U.esc(`${U.plural(p.days, 'workout')} a week,`)} <span class="ob-nobr">${U.esc(`${p.minutes} minutes each`)}</span></p>
        <p class="rv-sub">${U.esc(lean)}</p>
      </div>
      <div class="rv-week-box"><ol class="rv-week" aria-label="Your next 7 days">${r.days.map(dayCell).join('')}</ol>
        <p class="rv-week-foot">${U.esc(`The next 7 days: ${U.plural(n, 'workout')}${rest ? ', and a walk and a stretch on the days between' : ''}. Miss one and the week moves forward.`)}</p></div>
      ${firstCard(r)}
      ${whyBlock(r)}
      ${r.around ? aroundCard(r) : ''}
      ${r.review ? linkRow('obReview', 'sparkle', 'violet', 'Ask the coach to check it', 'It looks your plan over and suggests changes for you to approve.', 'review') : ''}
    </div>`;
  }
  const moveMeta = (it) => `${U.plural(it.sets, 'set')} · ${it.timed ? `${it.target} s` : `${it.target} reps`}`;
  function firstCard(r) {
    const f = r.first;
    if (!f) return '';
    const today = f.day === r.day;
    const shown = f.items.slice(0, 4);
    const more = f.items.length - shown.length;
    const cardio = (f.cooldown || []).find((c) => c.cardio);
    const rows = shown.map((it) => `<li class="rv-move"><span class="ob-thumb" data-morph="keep" data-move="${U.esc(it.moveId)}" aria-hidden="true"></span><span class="rv-move-text"><span class="rv-move-name">${U.esc(it.name)}</span><span class="rv-move-meta rf-num">${U.esc(moveMeta(it))}</span></span></li>`).join('')
      + (cardio ? `<li class="rv-move"><span class="ob-thumb is-icon" aria-hidden="true">${U.icon('heart')}</span><span class="rv-move-text"><span class="rv-move-name">${U.esc(`Easy cardio · ${Math.max(1, Math.round(cardio.target / 60))} min`)}</span><span class="rv-move-meta">${U.esc(cardio.name)}</span></span></li>` : '');
    const extras = [more > 0 ? U.plural(more, 'more move') : null, f.finisher ? 'a finisher' : null].filter(Boolean);
    return `<div class="card rv-first" data-key="first">
      <div class="rv-first-head"><span class="rv-tag${today ? ' is-today' : ''}">${today ? 'Today' : U.esc(DAY_NAMES[B().weekday(f.day)])}</span><span class="rv-mins rf-num">${U.esc(`About ${f.minutes} min`)}</span></div>
      <p class="rv-first-title">${U.esc(f.title)}</p>
      <ul class="rv-moves">${rows}</ul>
      <p class="rv-more">${U.esc(`A warm-up first${extras.length ? `, then ${joinWords(extras)}` : ''}.`)}</p>
    </div>`;
  }
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function whyBlock(r) {
    const n = r.x.considered || 0;
    return `<section class="rv-why" data-key="why">
      <h2 class="rv-h">Why this plan</h2>
      ${n > 1 ? `<div class="rv-stat"><span class="rv-n rf-num">${fmtN(n)}</span><span class="rv-stat-text">weekly plans compared. This one fits you best.</span></div>` : ''}
      ${r.reasons.length ? `<ul class="rv-reasons">${r.reasons.map((t) => `<li>${U.icon('check-circle', 'sm')}<span>${U.esc(t)}</span></li>`).join('')}</ul>` : ''}
    </section>`;
  }
  function aroundCard(r) {
    const lines = A().planLines(r.p);
    const doctor = A().doctorLines(r.p);
    return `<div class="card rv-around" data-key="around">
      <p class="rv-h is-sm">${U.icon('heart', 'sm')}<span>Built around you</span></p>
      <p class="t-headline">${U.esc(r.around)}</p>
      ${lines.length ? `<ul class="ob-bullets">${lines.map((l) => `<li>${U.esc(l.text)}</li>`).join('')}</ul>` : ''}
      ${doctor.map((t) => status('caution', t)).join('')}
    </div>`;
  }
  // The plan comes in: the badge springs, the days pop in one by one, the rest rises after them.
  function revealIn(el, again) {
    const page = el.querySelector('.ob-reveal');
    if (!page) return;
    if (rv && rv.eq) thumbs(page, rv.eq);
    if (again) return;
    U.haptic('success');
    if (U.reduced() || !page.animate) return;
    const badge = page.querySelector('.rv-badge');
    if (badge) {
      badge.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 620, easing: 'ease-out', fill: 'backwards' });
      // (Refract 1.4's burst is 8 to 14 beads.)
      if (G.Refract && G.Refract.burst) setTimeout(() => { try { G.Refract.burst(badge, { count: 14 }); } catch (e) { /* ignore */ } }, 260);
    }
    const rise = (n, delay) => n.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay, easing: EASE_ENTER, fill: 'backwards' });
    for (const [k, n] of Array.from(page.querySelectorAll('.rv-hero > :not(.rv-badge)')).entries()) rise(n, 80 + k * 60);
    for (const [k, n] of Array.from(page.querySelectorAll('.rv-day')).entries()) n.animate([{ opacity: 0, transform: 'translateY(10px) scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 260 + k * 45, easing: SPRING, fill: 'backwards' });
    const parts = Array.from(page.querySelectorAll('.rv-week-foot, .rv-first, .rv-why, .rv-around, .ob-link, .ft-grid > *'));
    parts.forEach((n, k) => rise(n, 520 + k * 90));
    for (const n of el.querySelectorAll('.ob-actions > *')) rise(n, 700);
    const num = page.querySelector('.rv-n');
    if (num && G.Refract && G.Refract.roll) setTimeout(() => { try { G.Refract.roll(num, num.textContent, { from: '0', dir: 1 }); } catch (e) { /* plain number */ } }, 640);
  }

  /* ---------------------------------------------------------------- pictures of the moves */
  // The plan's moves show their key pose, as Plan's tiles do. With the 3D figure, its still in the
  // person's look, kept on the phone at Plan's tiles' size (src/ui/stills.js), so Plan has them
  // later: the tile's own background until it's drawn (set-up starts warming the figure up while
  // they answer), then it fades in, so the plan's entrance never waits on them. The flat figure
  // where 3D can't be drawn.
  const flatStills = new Map();
  function thumbs(root, eq) {
    const S3 = U.stills && U.stills.ok() ? U.stills : null;
    const look = S3 && S3.look(52);
    for (const h of root.querySelectorAll('.ob-thumb[data-move]')) {
      const m = personMove(h.getAttribute('data-move'), eq);
      if (!m) continue;
      if (S3) S3.tile(h, m, look, (x) => flatInto(x, m));
      else if (!h.firstElementChild) flatInto(h, m);
    }
  }
  function flatInto(h, m) {
    const svg = flatStill(m);
    h.textContent = '';
    if (svg) h.appendChild(svg.cloneNode(true));
  }
  function personMove(id, eq) {
    const m0 = M() && M().MOVES[id];
    if (!m0) return null;
    try { return M().forPerson ? M().forPerson(m0, eq) : m0; } catch (e) { return m0; }
  }
  function flatStill(m) {
    if (!GH.pose) return null;
    const key = `${m.id}|${JSON.stringify(m.equip || [])}`;
    if (flatStills.has(key)) return flatStills.get(key);
    // Drawn in a hidden box on the page, so the figure can be measured for the crop.
    const box = doc().createElement('div');
    box.className = 'ob-measure';
    doc().body.appendChild(box);
    let svg = null;
    try {
      const tl = m.$tl || (m.$tl = GH.pose.timeline(m));
      svg = GH.pose.still(box, m, m.key || tl.steps[0].to, {});
      const vb = svg && tightBox(svg);
      if (vb) svg.setAttribute('viewBox', vb);
    } catch (e) { svg = null; }
    box.remove();
    if (svg) { svg.setAttribute('aria-hidden', 'true'); svg.removeAttribute('role'); svg.removeAttribute('aria-label'); }
    flatStills.set(key, svg);
    return svg;
  }
  // The figure's own bounds (its body and any bench or chair, not the floor line), with room for the
  // strokes, so a small tile shows the body instead of empty space.
  function tightBox(svg) {
    try {
      const parts = Array.from(svg.querySelectorAll('.fig-body')).concat(Array.from(svg.querySelectorAll('.fig-props > :not(.fig-floor)')));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of parts) {
        const b = p.getBBox();
        if (!b.width && !b.height) continue;
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      }
      if (!isFinite(x0) || x1 - x0 < 1) return null;
      const pad = Math.max(x1 - x0, y1 - y0) * 0.09;
      return `${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${(x1 - x0 + 2 * pad).toFixed(1)} ${(y1 - y0 + 1.6 * pad).toFixed(1)}`;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- a friend's plan */
  // The last screen of a friend's plan: what it is, its first day as this person does it (with what's
  // swapped for them), and the way in.
  function friendState() {
    const p = draftProfile();
    const day = dayNow();
    return { S: B().newState(p, null, day), day };
  }
  function friendSwaps() {
    const sh = Q._shared;
    if (!sh || !C()) return [];
    try { const f = friendState(); return C().swapsFor(f.S, sh.plan, f.day); } catch (e) { return []; }
  }
  VIEW.friend = () => {
    const sh = Q._shared;
    if (!sh) return '';
    const plan = sh.plan;
    const who = sender(sh);
    const f = friendState();
    let swaps = [], mins = null;
    try { swaps = C().swapsFor(f.S, plan, f.day); mins = C().minutes(f.S, plan, 0, f.day); } catch (e) { /* shown without */ }
    const d0 = plan.days[0] || { items: [] };
    const rows = d0.items.slice(0, 5).map((it, i) => {
      const sw = swaps.find((x) => x.day === 0 && x.i === i);
      const id = sw ? sw.to : it.move;
      const m = id && M().MOVES[id];
      if (!m) return `<li class="rv-move is-out"><span class="ob-thumb is-icon" aria-hidden="true">${U.icon('close')}</span><span class="rv-move-text"><span class="rv-move-name">${U.esc((M().MOVES[it.move] || { name: it.move }).name)}</span><span class="rv-move-meta">${U.esc(`Left out for you: ${sw ? sw.why : ''}`)}</span></span></li>`;
      const amount = it.secs != null ? `${it.secs} s` : `${it.reps} reps`;
      return `<li class="rv-move"><span class="ob-thumb" data-morph="keep" data-move="${U.esc(id)}" aria-hidden="true"></span><span class="rv-move-text"><span class="rv-move-name">${U.esc(m.name)}</span><span class="rv-move-meta rf-num">${U.esc(`${U.plural(it.sets, 'set')} · ${amount}${sw ? ` · for you, in place of ${M().MOVES[it.move].name.toLowerCase()}` : ''}`)}</span></span></li>`;
    }).join('');
    const later = plan.days.slice(1).map((d, i) => `<li><span class="rv-tag">${U.esc(`Day ${i + 2}`)}</span><span>${U.esc(C().titleOf(plan, i + 1))}</span></li>`).join('');
    return `<div class="ob-reveal ob-friend" data-key="friend" data-ready>
      <div class="rv-hero">
        <span class="rv-badge is-share" aria-hidden="true">${U.icon('share')}</span>
        <p class="rv-from">${U.esc(who ? `${who} sent you this plan` : 'A plan for you')}</p>
        <h1 class="rf-large-title ob-title rv-title">${U.esc(plan.name)}</h1>
        <p class="rv-head">${U.esc(`${U.plural(plan.days.length, 'day')} a week${mins ? ` · about ${mins} min` : ''}`)}</p>
        ${plan.note ? `<p class="rv-note">${U.esc(plan.note)}</p>` : ''}
      </div>
      <div class="card rv-first" data-key="first">
        <div class="rv-first-head"><span class="rv-tag is-today">Day 1</span>${mins ? `<span class="rv-mins rf-num">${U.esc(`About ${mins} min`)}</span>` : ''}</div>
        <p class="rv-first-title">${U.esc(C().titleOf(plan, 0))}</p>
        <ul class="rv-moves">${rows}</ul>
        ${d0.items.length > 5 ? `<p class="rv-more">${U.esc(`And ${U.plural(d0.items.length - 5, 'more move')}.`)}</p>` : ''}
      </div>
      ${later ? `<div class="card rv-days" data-key="days"><p class="rv-h is-sm">Then</p><ul class="rv-day-list">${later}</ul></div>` : ''}
      ${swaps.length ? `<p class="rv-swaps">${U.icon('shuffle', 'sm')}<span>${U.esc(`${swaps.length === 1 ? 'One exercise is' : `${swaps.length} exercises are`} swapped for the closest one you can do with your kit and body.`)}</span></p>` : ''}
    </div>`;
  };
  ACT.friend = () => {
    const who = sender(Q._shared);
    return { primary: ['obGo', who ? `Start with ${who}'s plan` : 'Start with this plan', 'play'], secondary: ['obLook', 'Look around first'] };
  };
  AFTER.friend = (el) => {
    const page = el.querySelector('.ob-friend');
    if (!page) return;
    try { const f = friendState(); thumbs(page, B().eqFor(f.S, f.day)); } catch (e) { /* flat figures */ }
    U.haptic('success');
  };

  /* ---------------------------------------------------------------- just tracking food */
  // Weight first: the targets come from it.
  VIEW.fabout = () => lead('For your calorie and protein targets. It all stays on this phone.')
    + group('Units', unitsSeg())
    + `<div class="ob-fields">${sizeFields('Your targets come from it.')}${ageField()}</div>`
    + sexGroup();
  const WEIGHT_GOALS = [['lose', 'flame', 'rose', 'Lose weight', 'A steady calorie deficit'], ['maintain', 'scale', 'sky', 'Keep it steady', 'Eat to stay where you are'], ['gain', 'arrow-up-right', 'amber', 'Gain weight', 'A small surplus to build on']];
  VIEW.fgoal = () => `<div class="ob-opts" role="radiogroup" aria-label="Your goal" data-key="wgoal">${WEIGHT_GOALS.map(([id, icon, tone, title, sub]) => opt({ act: 'obWeightGoal', arg: id, icon, tone, title, sub, on: (Q.weightGoal || 'maintain') === id })).join('')}</div>`
    + (Q.weightGoal === 'lose' ? group('How fast?', `<div class="ob-pad">${U.seg('pace', paceOpts(), String((Q.food && Q.food.pace) || 0.5), 'How fast', ` ${bind('food.pace', 'num')}`)}</div>`, `${Q._w ? 'A week. ' : ''}Slower keeps more muscle.`) : '')
    + group('Protein', `<div class="ob-pad">${U.seg('perLb', perOpts(), Q.protein.perLb, 'Protein a day', ` ${bind('protein.perLb', 'num', true)}`)}</div>`, proteinFoot());
  ACT.fgoal = () => ({ primary: ['obNext', 'See my targets', 'sparkle'] });
  U.act.obWeightGoal = (el) => { if (!Q) return; Q.weightGoal = el.dataset.arg; U.haptic('select'); draw(); };
  VIEW.ftargets = () => {
    const p = draftProfile();
    const day = dayNow();
    const tmp = { profile: p, weights: p.weightKg ? [{ day, kg: p.weightKg, src: 'profile' }] : [], health: (tmpS && tmpS.health) || { days: {} }, food: {}, log: [], protein: {} };
    let t = null;
    try { t = GH.food && GH.food.targets(tmp, day); } catch (e) { t = null; }
    const steps = B().stepsGoal(tmp, day).goal;
    const kg = p.weightKg;
    const proteinG = t ? t.protein : kg ? Math.round(p.protein.perLb * kg * B().LB_PER_KG) : null;
    const cell = (icon, tone, n, unit, label) => `<div class="card ft-cell"><span class="ob-ico is-sm" data-tone="${tone}">${U.icon(icon)}</span><span class="ft-n rf-num">${n}</span><span class="ft-l">${U.esc(unit ? `${unit} ${label}` : label)}</span></div>`;
    return `<div class="ob-reveal ob-ftargets" data-key="ftargets" data-ready>
      <div class="rv-hero">
        <span class="rv-badge" aria-hidden="true">${U.icon('check')}</span>
        <h1 class="rf-large-title ob-title rv-title">Your daily targets</h1>
        <p class="rv-sub">${U.esc(t ? 'An estimate to start. After two weeks of logging and weighing in, it tunes itself to what your weight actually does.' : 'Add your weight any time for a calorie target.')}</p>
      </div>
      <div class="ft-grid">
        ${t ? `<div class="card ft-big"><span class="ob-ico" data-tone="coral">${U.icon('flame')}</span><span class="ft-n rf-num">${U.num(t.kcal)}</span><span class="ft-l">calories a day</span></div>` : ''}
        ${proteinG ? cell('check-circle', 'green', `${proteinG} g`, '', 'protein a day') : ''}
        ${cell('navigate', 'sky', U.num(steps), '', 'steps a day')}
      </div>
      <p class="rv-week-foot">Workouts are off. You can turn them on any time in Settings.</p>
    </div>`;
  };
  ACT.ftargets = () => (visible().some((s) => s.id === 'fhealth') ? { primary: ['obNext', 'Continue'] } : { primary: ['obLook', 'Start tracking', 'play'] });
  AFTER.ftargets = (el) => revealIn(el, false);
  // The food path's optional last screen: Health Connect fills in sleep, steps, weight and meals.
  VIEW.fhealth = () => {
    const st = H().status();
    let msg = null;
    if (st === 'unavailable') msg = ['caution', 'Health Connect isn\'t available on this phone right now. You can connect it later in Settings.'];
    else if (H().connected(st)) msg = ['positive', Q._hcNote ? `Connected. Read ${Q._hcNote}.` : 'Connected.'];
    const rows = [['moon', 'indigo', 'Sleep', 'How you slept, next to what you ate'], ['navigate', 'green', 'Steps', 'Counted toward your calories'], ['chart', 'teal', 'Weight', 'Your trend and targets, without typing it in'], ['food', 'green', 'Meals', 'Food from other apps counts toward your day']];
    return lead('Optional. Gradient Health can read these from Health Connect, so you don\'t type them in.')
      + `<ul class="rf-list">${rows.map(([ic, tone, t, sub]) => U.row({ icon: ic, tone, title: t, sub })).join('')}</ul>`
      + '<p class="t-footnote rf-muted ob-note">Everything stays on this phone, and you choose what to allow. You can change it any time in Health Connect.</p>'
      + (msg ? status(msg[0], msg[1]) : '');
  };
  ACT.fhealth = () => {
    const st = H().status();
    if (H().connected(st) || st === 'unavailable') return { primary: ['obLook', 'Start tracking', 'play'] };
    return { primary: ['obConnect', 'Connect Health Connect'], secondary: ['obLook', 'Not now'] };
  };
  U.act.obConnect = async (btn) => {
    if (btn && btn.setAttribute) btn.setAttribute('aria-busy', 'true');
    const st = await H().request(foodModeOf() === 'full');
    if (!Q) return;
    if (H().connected(st)) {
      tmpS = tmpS || { profile: Q, health: { days: {}, hc: {}, manual: {}, lastSync: null, status: st }, weights: [], log: [], protein: {}, feel: {}, sleepChip: {} };
      const res = await H().sync(tmpS, Date.now(), 90);
      if (res && res.ok) prefill();
      U.haptic('success');
    } else if (st === 'denied') U.toast('Not connected', 'caution', 'You can connect Health Connect later in Settings.');
    if (Q) draw();
  };
  // Answers Health Connect can already give: weight, height, sleep, how active you've been.
  function prefill() {
    const b = B(), h = H();
    const day = b.dayOf(Date.now(), 4);
    const got = [];
    const w = tmpS.weights.filter((x) => x.src === 'hc').pop();
    if (w) { Q._w = Math.round((Q.units === 'kg' ? w.kg : w.kg * b.LB_PER_KG) * 10) / 10; got.push('weight'); }
    if (tmpS.profile.heightCm) { const cm = tmpS.profile.heightCm; Q._hcm = cm; Q._hft = Math.floor(cm / 2.54 / 12); Q._hin = Math.round(cm / 2.54 - Q._hft * 12); got.push('height'); }
    const sl = h.stats(tmpS, 'sleepMin', day - 28, day);
    if (sl.n >= 5) {
      const hrs = sl.median / 60;
      Q.sleepTypical = hrs < 5 ? '<5' : hrs < 6 ? '5-6' : hrs < 7 ? '6-7' : hrs < 8 ? '7-8' : '8+';
      const mids = [];
      for (let d = day - 14; d <= day; d++) { const r = tmpS.health.days[d]; if (r && r.bed && r.wake) { const m = new Date((r.bed + r.wake) / 2); mids.push(((m.getHours() * 60 + m.getMinutes()) - 720 + 1440) % 1440); } }
      if (mids.length >= 5) Q.sleepIrregular = GH.insights.sd(mids) >= 60;
      got.push(`${sl.n} nights of sleep`);
    }
    const stp = h.stats(tmpS, 'steps', day - 28, day);
    const ex = h.activity(tmpS, day - 28, day).length;
    if (stp.n >= 5 || ex) {
      Q.recentActivity = stp.avg >= 7500 || ex >= 6 ? 'regular' : stp.avg >= 4500 || ex >= 2 ? 'some' : 'none';
      if (stp.n) got.push(`${stp.n} days of steps`);
    }
    Q._hcNote = got.length ? got.join(', ') : 'no data yet';
  }

  /* ---------------------------------------------------------------- Your answers: the detailed screens */
  VIEW.about = () => lead(`Used for your protein goal, weight trend${workoutsOn() ? ' and a plan that suits your age' : ''}. It stays on this phone.`)
    + group('Units', unitsSeg())
    + `<div class="ob-fields">${ageField()}${sizeFields()}</div>`
    + sexGroup();
  // Switching units converts what's been entered: weight, height, dumbbells, the ball, the gym rack.
  // Switching straight back (nothing changed meanwhile) restores what was there, rather than
  // rounding it twice (10, 15 and 20 lb would come back as 12 and 20).
  const UNIT_FIELDS = ['_w', '_hft', '_hin', '_hcm'];
  const unitsSnap = () => JSON.stringify([UNIT_FIELDS.map((k) => Q[k]), Q.equipment.db, Q.equipment.kb, Q.equipment.ballLb, Q.gym && Q.gym.dbMax, Q._kitWas]);
  let unitsBack = null; // { units, values, after }: what the last switch converted, to restore on the way back
  const unitsHandler = U.on.q;
  U.on.q = (el, ev, v) => {
    if (el.dataset && el.dataset.k === 'units' && Q && v !== Q.units) {
      const toKg = v === 'kg';
      if (unitsBack && unitsBack.q === Q && unitsBack.units === v && unitsBack.after === unitsSnap()) Object.assign(Q, clone(unitsBack.values));
      else {
        const values = clone({ _w: Q._w, _hft: Q._hft, _hin: Q._hin, _hcm: Q._hcm, equipment: Q.equipment, gym: Q.gym, _kitWas: Q._kitWas || null });
        const f = toKg ? 1 / B().LB_PER_KG : B().LB_PER_KG;
        if (Q._w) Q._w = Math.round(Q._w * f * 10) / 10;
        if (toKg && Q._hft > 0) Q._hcm = Math.round((Q._hft * 12 + (Q._hin || 0)) * 2.54);
        if (!toKg && Q._hcm > 0) { Q._hft = Math.floor(Q._hcm / 2.54 / 12); Q._hin = Math.round(Q._hcm / 2.54 - Q._hft * 12); if (Q._hin === 12) { Q._hft++; Q._hin = 0; } }
        const near = (list, x) => list.reduce((a, c) => (Math.abs(c - x * f) < Math.abs(a - x * f) ? c : a), list[0]);
        for (const k of ['db', 'kb']) {
          const list = WEIGHTS[k][toKg ? 'kg' : 'lb'];
          Q.equipment[k] = [...new Set((Q.equipment[k] || []).map((x) => near(list, x)))];
          if (Q._kitWas && Q._kitWas[k]) Q._kitWas[k] = [...new Set(Q._kitWas[k].map((x) => near(list, x)))];
        }
        if (Q.equipment.ballLb) Q.equipment.ballLb = Math.round(Q.equipment.ballLb * f);
        if (Q.gym) Q.gym.dbMax = B().convertDbMax(Q.gym.dbMax, toKg ? 'kg' : 'lb');
        unitsBack = { q: Q, units: Q.units, values, after: null };
      }
      errs = {};
      unitsHandler(el, ev, v);
      if (unitsBack && unitsBack.q === Q) unitsBack.after = unitsSnap();
      return;
    }
    unitsHandler(el, ev, v);
  };

  // Health conditions: optional, private, and what they change is said right there.
  VIEW.conditions = () => {
    const h = healthParts('Not medical advice. If a move hurts, stop, and say so after your workout: moves that load it are swapped out.');
    return lead('Pick anything that applies, and your plan works around it. It\'s optional, and it stays on this phone.') + h.pick + h.after;
  };

  VIEW.goals = () => lead('Tap them in order of priority. Your first two get the most work.')
    + `<div class="ob-chips">${GOALS.map(([id, label]) => {
      const i = Q.goals.indexOf(id);
      return U.chip(i >= 0 ? `${i + 1}. ${label}` : label, i >= 0, `data-on="q" data-list="goals" data-v="${id}" data-redraw`);
    }).join('')}</div>`
    + (Q.goals.length ? `<p class="t-footnote rf-muted ob-note">${U.esc(goalLine())}</p>` : '');
  function goalLine() {
    const p = draftProfile();
    const t = B().programFor(p).tiers;
    const names = (tier) => B().GROUPS.filter((g) => t[g] === tier).map((g) => B().GROUP_NAME[g].toLowerCase());
    const one = names(1);
    return one.length ? `Most work: ${one.join(', ')}. Everything else is kept up.` : 'A balanced plan for every muscle group.';
  }

  VIEW.experience = () => lead('This sets how gently you start and where each exercise begins.')
    + group('How long have you trained?', choice('experience', [['never', 'Never really'], ['onoff', 'Now and then'], ['lt1', 'Under a year, steadily'], ['1to3', '1 to 3 years'], ['3plus', 'More than 3 years']], Q.experience))
    + group('Last month', `<div class="ob-pad">${U.seg('recentActivity', [['none', 'Not active'], ['some', 'A little'], ['regular', 'Regularly']], Q.recentActivity, 'Activity last month', ` ${bind('recentActivity')}`)}</div>`, Q._hcNote ? 'Filled in from Health Connect.' : '');

  // Workouts a week and the days picked stay in step: picking days sets the count, and + or − with
  // days picked adds or drops one (brain.pickWeekday / setWorkoutDays).
  let dayNote = null;
  const scheduleHandler = U.on.q;
  U.on.q = (el, ev, v) => {
    if (Q && el.dataset && el.dataset.list === 'weekdays') {
      const r = B().pickWeekday(Q.days, Q.weekdays, Number(el.dataset.v), !!v);
      Q.days = r.days; Q.weekdays = r.weekdays; dayNote = r.note;
      if (r.note === 'max') U.haptic('deny');
      draw();
      return;
    }
    if (Q && el.dataset && el.dataset.k === 'days' && Q.weekdays.length) {
      const r = B().setWorkoutDays(Q.weekdays, Number(v));
      Q.days = r.days; Q.weekdays = r.weekdays; dayNote = null;
      draw();
      return;
    }
    scheduleHandler(el, ev, v);
  };
  VIEW.schedule = () => {
    const hint = U.daysNote ? U.daysNote({ days: Q.days, weekdays: Q.weekdays, note: dayNote }) : '';
    return lead('Missed a day? The plan shifts forward instead of doubling up.')
      + group('Workouts a week', `<div class="ob-pad ob-center">${U.stepper('obDays', Q.days, 2, 6, 'Workouts a week', bind('days', 'num', true))}</div>`)
      + group('Which days (optional)', `<div class="ob-chips">${DAYS.map((d, i) => listChip('weekdays', i, d, Q.weekdays.includes(i), 'num', true)).join('')}</div>`, hint)
      + group('Minutes per workout', `<div class="ob-pad"><div class="ob-slider-value t-title-2 rf-num" id="obMin">${Q.minutes} min</div><div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="10" max="60" step="5" value="${Q.minutes}" aria-label="Minutes per workout" aria-valuetext="${Q.minutes} minutes" ${bind('minutes', 'num')}></div></div></div>`, 'Short on time mode fits a real session into 12 to 15 minutes any day.')
      + group('', `<ul class="rf-list">${U.sw('Walk-and-stretch days', Q.lightDays !== false, bind('lightDays'), 'A walk and 5 minutes of stretching on days off. They count for your streak.')}</ul>`);
  };
  AFTER.schedule = (el) => {
    const r = el.querySelector('input[type="range"]');
    const out = el.querySelector('#obMin');
    if (r && out) r.addEventListener('input', () => { out.textContent = `${r.value} min`; r.setAttribute('aria-valuetext', `${r.value} minutes`); });
  };

  // Gym kit, grouped the way people think about a gym floor.
  const GYM_KIT = [
    ['Free weights', [['bb', 'Barbell and plates'], ['rack', 'Squat rack'], ['bench', 'Flat bench'], ['benchIncline', 'Adjustable bench'], ['ez', 'EZ curl bar'], ['dip', 'Dip bars'], ['bar', 'Pull-up bar']]],
    ['Cables and machines', [['cable', 'Cable station'], ['pulldown', 'Lat pulldown'], ['legPress', 'Leg press'], ['legCurl', 'Leg curl'], ['legExt', 'Leg extension'], ['chestPress', 'Chest press'], ['shoulderPress', 'Shoulder press'], ['pecDeck', 'Pec deck'], ['smith', 'Smith machine']]],
    ['Cardio', [['rower', 'Rowing machine'], ['bike', 'Exercise bike'], ['treadmill', 'Treadmill']]],
  ];
  const DB_MAX = B().DB_MAX_OPTIONS;
  // The gym's kit in detail; Your answers also starts it from a preset.
  function gymGroups(presets) {
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    const g = Q.gym;
    return (presets ? group('Your gym', `<div class="ob-chips">${Object.entries(B().GYM_PRESETS).map(([id, pr]) => `<button type="button" class="rf-chip" data-act="obGymPreset" data-arg="${id}">${U.esc(pr.name)}</button>`).join('')}</div>`, 'Start from one of these, then adjust below.') : '')
      + group('Dumbbells up to', `<div class="ob-chips">${DB_MAX[u].map((w) => U.chip(w ? `${w}${w === DB_MAX[u][DB_MAX[u].length - 1] ? '+' : ''} ${u}` : 'None', Number(g.dbMax || 0) === w, `data-act="obGymDb" data-arg="${w}"`)).join('')}</div>`)
      + GYM_KIT.map(([title, items]) => group(title, `<ul class="rf-list">${items.map(([k, label]) => U.sw(label, k === 'bar' ? g.bar !== false : !!g[k], bind(`gym.${k}`))).join('')}</ul>`)).join('');
  }
  U.act.obGymPreset = (btn) => {
    const pr = B().gymPreset(btn.dataset.arg, Q.units);
    if (!pr) return;
    Q.gym = pr;
    U.haptic('select');
    draw();
  };
  U.act.obGymDb = (btn) => { Q.gym.dbMax = Number(btn.dataset.arg) || 0; U.haptic('select'); draw(); };

  VIEW.equipment = () => {
    const where = Q.where || 'home';
    Q.gym = Object.assign(B().defaultGym(), Q.gym || {});
    return lead(where === 'home' ? 'Pick everything you have. Exercises only use what\'s here, and you get told when it\'s time to buy heavier.' : 'Pick what your gym has. Exercises only use what\'s there, and the weights go up as you get stronger.')
      + group('Where do you train?', `<div class="ob-pad">${U.seg('where', [['home', 'Home'], ['gym', 'Gym'], ['both', 'Both']], where, 'Where you train', ` ${bind('where', '', true)}`)}</div>`, where === 'both' ? 'Pick home or gym on the day. Each keeps its own progress.' : '')
      + (where !== 'home' ? gymGroups(true) : '')
      + (where !== 'gym' ? (where === 'both' ? '<h2 class="ob-section t-title-3">At home</h2>' : '') + homeEquipment() : '');
  };
  function homeEquipment() {
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    const eq = Q.equipment;
    const weights = (k) => {
      const list = [...new Set(WEIGHTS[k][u].concat(eq[k] || []))].sort((a, b) => a - b);
      return `<div class="ob-chips">${list.map((w) => listChip(`equipment.${k}`, w, `${w} ${u}`, (eq[k] || []).includes(w), 'num')).join('')}</div>
        ${addRow(k, u)}`;
    };
    return group('Dumbbells', weights('db'), 'Tap each weight you own, pairs or singles.')
      + group('Kettlebells', weights('kb'))
      + group('Other equipment', `<ul class="rf-list">
          ${U.sw('Small ball or medicine ball', eq.ball, bind('equipment.ball', '', true))}
          ${eq.ball ? `<li><div class="rf-list-row ob-inline"><span class="rf-list-text"><span class="rf-list-title">Ball weight (${u}, optional)</span></span><input class="rf-input ob-num" type="number" inputmode="decimal" value="${eq.ballLb == null ? '' : eq.ballLb}" ${bind('equipment.ballLb', 'num')} aria-label="Ball weight"></div></li>${U.sw('It\'s OK to slam it', eq.ballSlam, bind('equipment.ballSlam'))}` : ''}
          ${U.sw('Resistance band', eq.band, bind('equipment.band', '', true))}
          ${eq.band ? U.sw('Door anchor for the band', eq.door, bind('equipment.door')) : ''}
          ${U.sw('Pull-up bar', eq.bar, bind('equipment.bar'))}
          ${U.sw('Chair or couch', eq.chair !== false, bind('equipment.chair'))}
          ${U.sw('Clear wall space', eq.wall !== false, bind('equipment.wall'))}
          ${U.sw('Towel', eq.towel !== false, bind('equipment.towel'))}
          ${U.sw('Sturdy table (for rows under it)', eq.table, bind('equipment.table'))}
        </ul>`);
  }
  U.act.obAddWeight = (btn) => {
    const k = btn.dataset.arg;
    const input = G.document.getElementById('add-' + k);
    const v = parseFloat(input && input.value);
    if (!(v > 0 && v < 400)) { U.toast('Enter a weight like 12', 'caution'); return; }
    const r = Math.round(v * 2) / 2;
    if (!Q.equipment[k].includes(r)) Q.equipment[k] = Q.equipment[k].concat(r);
    U.haptic('select');
    draw();
  };

  // Injuries, the stronger side, and jumping (opt-in from 50; never with a condition that rules it out).
  VIEW.body = () => {
    const p = draftProfile();
    const r = A() ? A().rulesOf(p) : { noImpact: false };
    const from50 = p.age >= 50;
    const jump = r.noImpact
      ? `<li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">Jumping and slamming</span><span class="rf-list-sub">Left out of your plan, for ${U.esc(joinShort(p))}.</span></span></div></li>`
      : from50 ? U.sw('Include jumping and slamming', Q.jumpsOk === true, bind('jumpsOk'), 'Off by default from 50. Turn it on if your knees and hips are happy with it and your floor allows it.')
        : U.sw('Jumping and slamming is OK where I train', Q.impactOk !== false, bind('impactOk'), 'Turn off for apartments, sore knees or thin floors.');
    return lead('So nothing here makes an old injury worse, and a weaker side catches up.')
      + jointGroups(false)
      + group('Which arm is stronger?', `<div class="ob-pad">${U.seg('strongArm', [['L', 'Left'], ['same', 'About the same'], ['R', 'Right']], Q._strongArm, 'Stronger arm', ` ${bind('_strongArm')}`)}</div>`, 'The weaker side goes first, never does fewer reps than the other, and gets one extra set until it catches up.')
      + group('Which leg is stronger?', `<div class="ob-pad">${U.seg('strongLeg', [['L', 'Left'], ['same', 'About the same'], ['R', 'Right']], Q._strongLeg, 'Stronger leg', ` ${bind('_strongLeg')}`)}</div>`)
      + group('', `<ul class="rf-list">
        ${U.sw('A doctor told me to take it easy', Q.gentle, bind('gentle', '', true), 'Gentler start, lower volume, no jumping.')}
        ${Q.gentle ? '' : jump}
      </ul>`);
  };
  function joinShort(p) {
    const list = (p.conditions || []).map((id) => (A().CONDITIONS.find((c) => c.id === id) || {}).short).filter(Boolean);
    return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  }

  // Protein: how much a day, in grams when the weight is known ("120 g", under "Protein a day"). Short
  // labels, so the three fit side by side with the phone's text turned up.
  function perOpts() {
    const kg = Q._w > 0 ? (Q.units !== 'kg' ? Q._w / B().LB_PER_KG : Q._w) : null;
    const words = ['Standard', 'Higher', 'Highest'];
    return [0.7, 0.8, 1].map((per, i) => [per, kg ? `${Math.round(per * kg * B().LB_PER_KG / 5) * 5} g` : words[i]]);
  }
  const proteinFoot = () => (Q._w > 0 ? 'About that much a day, from your weight. More helps you keep muscle while you lose fat.' : 'Add your weight to see grams a day.');
  // Pace: how much a week, in the person's units when the weight is known.
  function paceOpts() {
    const lb = Q.units !== 'kg';
    const words = ['Gentle', 'Steady', 'Faster', 'Fastest'];
    return [0.25, 0.5, 0.75, 1].map((pct, i) => [String(pct), Q._w > 0 ? `${(Math.round(Q._w * pct / 10) / 10).toFixed(1)} ${lb ? 'lb' : 'kg'}` : words[i]]);
  }
  const weightGoal = () => group('Weight goal', `<div class="ob-pad">${U.seg('weightGoal', [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']], Q.weightGoal, 'Weight goal', ` ${bind('weightGoal', '', true)}`)}</div>`, 'You get a heads-up if you\'re losing more than 1% a week.');
  // Workouts and health: a protein number and a weight trend, no food tracking.
  VIEW.nutrition = () => {
    const fm = foodModeOf();
    return lead('No meal plans. Just a protein number to hit and a weight trend to watch.')
      + weightGoal()
      + (fm === 'off' ? '<p class="t-footnote rf-muted ob-note">Your protein goal is off. You can turn it on in Settings, under What you track.</p>'
        : group('Protein a day', `<div class="ob-pad">${U.seg('perLb', perOpts(), Q.protein.perLb, 'Protein a day', ` ${bind('protein.perLb', 'num', true)}`)}</div>`, proteinFoot())
          + group('Your go-to protein', `<div class="ob-fields ob-row2">
          ${field('Name', `<input class="rf-input" type="text" maxlength="24" enterkeyhint="next" value="${U.esc(Q.protein.quickName)}" ${bind('protein.quickName')}>`)}
          ${field('Grams', numInput('protein.quickG', Q.protein.quickG, '26', 'min="1" max="100" inputmode="numeric" enterkeyhint="done"'), '', 'protein.quickG')}
        </div>`, 'One tap adds it on the Today screen.'));
  };
  // Calories and macros (food tracking on).
  VIEW.food = () => lead('Your calorie target comes from your size, your steps and your goal, and learns from your logs over time.')
    + weightGoal()
    + (Q.weightGoal === 'lose' ? group('Pace', `<div class="ob-pad">${U.seg('pace', paceOpts(), String((Q.food && Q.food.pace) || 0.5), 'Pace', ` ${bind('food.pace', 'num')}`)}</div>`, `${Q._w > 0 ? 'A week. ' : ''}Slower keeps more muscle.`) : '')
    + group('Protein a day', `<div class="ob-pad">${U.seg('perLb', perOpts(), Q.protein.perLb, 'Protein a day', ` ${bind('protein.perLb', 'num', true)}`)}</div>`, proteinFoot());

  // Your answers' last screen: the week, what gets the most work, and everything built around you.
  VIEW.plan = () => {
    const p = draftProfile();
    if (p.workouts === false) return summaryNoWorkouts(p);
    const prog = B().programFor(p);
    const tpl = B().templateFor(p, prog);
    const byFreq = {};
    for (const [unit, f] of Object.entries(prog.freq)) (byFreq[f] = byFreq[f] || []).push(unit);
    const order = ['abs', 'arms', 'chest', 'legs', 'back', 'shoulders'];
    const freqLines = Object.keys(byFreq).map(Number).sort((a, b) => b - a).map((f) => `${U.cap(joinWords(byFreq[f].sort((a, b) => order.indexOf(a) - order.indexOf(b))))}: ${f === 1 ? 'once' : f === 2 ? 'twice' : `${f} times`} a week`);
    const rows = [];
    for (let wd = 0; wd < 7; wd++) {
      const t = tpl.find((x) => x.offset === wd);
      rows.push(U.row({ title: DAYS[wd], detail: t ? U.esc(B().templateTitle(t.units)) : p.lightDays !== false ? 'Walk and stretch' : 'Rest', cls: t ? 'plan-day-work' : 'plan-day-light' }));
    }
    const kg = p.weightKg;
    const proteinG = kg && p.protein.track !== false ? Math.round(p.protein.perLb * kg * B().LB_PER_KG) : null;
    const notes = [];
    if (prog.onramp.weeks) notes.push(`The first ${U.plural(prog.onramp.weeks, 'week')} at about ${Math.round(prog.onramp.mult * 100)}%, to ease in.`);
    if (p.lead.arm) notes.push(`${U.side(p.lead.arm)} arm goes first, plus one extra ${U.side(p.lead.arm).toLowerCase()} set on arm days until it catches up.`);
    notes.push('An easier week about every 5th week, sooner if you\'re run down.');
    if (proteinG) notes.push(`Protein goal: about ${proteinG} g a day.`);
    if (H().connected(H().status())) notes.push('Health Connect adjusts each day to your sleep, heart rate and activity.');
    if (p.goals.includes('abs')) notes.push('About abs: training builds them, and seeing them comes down to body fat, from food and daily movement over months. So there\'s no date promised here: watch your waist, your weight trend and your ab levels in Progress.');
    const ac = A();
    const around = ac ? ac.plannedAround(p) : null;
    const lines = ac ? ac.planLines(p) : [];
    const doctor = ac ? ac.doctorLines(p) : [];
    const focus = goalLine();
    return `<div class="card ob-card ob-hero-card"><p class="ob-hero-num rf-num">${p.days} days · ~${p.minutes} min</p><p class="t-callout rf-muted">${U.esc(freqLines.join('. '))}.</p><p class="t-callout">${U.esc(focus)}</p></div>`
      + (lines.length ? group('Built around you', `<div class="card ob-card ob-around"><p class="t-headline">${U.esc(around || 'Your plan')}</p><ul class="ob-bullets">${lines.map((l) => `<li>${U.esc(l.text)}</li>`).join('')}</ul></div>`) : '')
      + doctor.map((t) => status('caution', t)).join('')
      + group('Your week', `<ul class="rf-list">${rows.join('')}</ul>`)
      + group('Good to know', `<div class="card ob-card"><ul class="ob-bullets">${notes.map((n) => `<li>${U.esc(n)}</li>`).join('')}</ul></div>`);
  };

  // Food and health only: the targets instead of a week of workouts.
  function summaryNoWorkouts(p) {
    const day = B().dayOf(Date.now(), 4);
    const tmp = { profile: p, weights: p.weightKg ? [{ day, kg: p.weightKg, src: 'profile' }] : [], health: (tmpS && tmpS.health) || { days: {} }, food: {}, log: [], protein: {} };
    const t = GH.food && p.food && p.food.mode === 'full' ? GH.food.targets(tmp, day) : null;
    const steps = B().stepsGoal(tmp, day).goal;
    const kg = p.weightKg;
    const proteinG = kg && p.protein.track !== false ? Math.round(p.protein.perLb * kg * B().LB_PER_KG) : null;
    const rows = [];
    if (t) rows.push(U.row({ icon: 'flame', tone: 'coral', title: 'Calories', detail: `${U.num(t.kcal)} a day` }));
    if (proteinG) rows.push(U.row({ icon: 'check-circle', tone: 'green', title: 'Protein', detail: `${proteinG} g a day` }));
    rows.push(U.row({ icon: 'navigate', tone: 'sky', title: 'Steps', detail: `${U.num(steps)} a day` }));
    const notes = [];
    if (t) notes.push('The calorie target is an estimate. After two weeks of logging and weighing in, it tunes itself to what your weight actually does.');
    if (!kg) notes.push('Add your weight to get calorie and protein targets.');
    notes.push('Workouts are off. You can turn them on any time in Settings.');
    return group('Your daily targets', `<ul class="rf-list">${rows.join('')}</ul>`)
      + `<div class="card ob-card"><ul class="ob-bullets">${notes.map((n) => `<li>${U.esc(n)}</li>`).join('')}</ul></div>`;
  }

  // "Built around you" (Today and Plan): what age and health change in the plan, and where to edit it.
  U.act.planAround = () => {
    const p = U.S.profile;
    const ac = A();
    const lines = ac.planLines(p);
    const doctor = ac.doctorLines(p);
    const body = lines.length
      ? `<p class="t-headline sheet-lead">${U.esc(ac.plannedAround(p) || 'Your plan')}</p><ul class="ob-bullets around-list">${lines.map((l) => `<li>${U.esc(l.text)}</li>`).join('')}</ul>${doctor.map((t) => status('caution', t)).join('')}`
      : '<p class="t-callout sheet-lead">Nothing to plan around yet. Your age, sore joints, balance and health conditions like arthritis or high blood pressure can all shape your plan.</p>';
    U.sheet({
      title: 'Built around you', size: 'auto',
      body: `<div class="sheet-pad sheet-prose">${body}<p class="t-footnote rf-muted">It stays on this phone and is never sent to Claude. Not medical advice: if a move hurts, stop.</p>
        <button type="button" class="rf-btn" data-variant="filled" data-act="aroundEdit">${lines.length ? 'Change what\'s planned around' : 'Add something'}</button>
        ${U.whyLink ? U.whyLink('age', 'The research behind it') : ''}</div>`,
    });
  };
  U.act.aroundEdit = () => { U.closeSheets(); U.haptic('nav'); U.editAnswers('conditions'); };

  /* ---------------------------------------------------------------- finish */
  // Low back pain rules out heavy spinal loading for its first weeks, counted from when it's added.
  function stampSince(p, before, day) {
    const had = (before && before.conditions) || [];
    p.conditionsSince = Object.assign({}, (before && before.conditionsSince) || {});
    for (const id of p.conditions || []) if (!had.includes(id) || p.conditionsSince[id] == null) p.conditionsSince[id] = day;
    for (const id of Object.keys(p.conditionsSince)) if (!(p.conditions || []).includes(id)) delete p.conditionsSince[id];
  }
  U.act.obGo = () => finishNew('start');
  U.act.obLook = () => finishNew('look');
  U.act.obReview = () => finishNew('review');
  U.act.obFinish = () => {
    if (!valid()) return;
    if (mode !== 'new') return saveEdit();
    return finishNew('look');
  };
  // The first run done: the new state, and then the first workout ('start'), the app ('look') or the
  // coach's review of the plan ('review'). A friend's plan is saved and put in use (and the tour, made
  // for the coach's plan, is skipped); a friend's plan they passed over is kept in Your plans, so it
  // doesn't open over them later.
  function finishNew(how) {
    if (!Q) return;
    stopBuild();
    const day = dayNow();
    const p = draftProfile();
    stampSince(p, null, day);
    const S = B().newState(p, null, day);
    for (const j of Q._pain || []) S.pain[j] = day + 14;
    if (tmpS) {
      S.health = Object.assign(S.health, tmpS.health);
      S.weights = tmpS.weights.concat(S.weights).sort((a, b) => a.day - b.day);
      // Food other apps logged, read along with the rest during set-up.
      if (tmpS.food && tmpS.food.other && GH.food) Object.assign(GH.food.data(S).other, tmpS.food.other);
    }
    S.health.status = H().status();
    const sh = Q._shared;
    const friend = Q._path === 'friend' && sh;
    let kept = null;
    if (sh && C()) {
      try {
        const r = C().save(S, sh.plan);
        if (friend) C().use(S, r.plan.id, day);
        else kept = r.plan;
      } catch (e) { if (G.console) G.console.error(e); }
      if (sh.take) sh.take();
    }
    if (friend) S.seen.tour = true;
    GH.store.save(S);
    U.S = S;
    Q = null; tmpS = null;
    U.applyPrefs();
    U.route = { tab: 'today', view: null, arg: null };
    const plan = B().todayPlan(S, day);
    const start = how === 'start' && S.profile.workouts !== false && (plan.type === 'workout' || ((plan.type === 'light' || plan.type === 'rest') && plan.next));
    if (!start) U.haptic('celebrate');
    dismiss(() => U.render('stagger'));
    U.syncHealth('manual');
    if (U.afterOnboarding) U.afterOnboarding();
    if (start) { U.act.startWorkout(); return; }
    // The review opens as it does from You and Plan (their "Check my plan with AI").
    if (how === 'review') {
      setTimeout(() => {
        try {
          if (U.act.reviewPlan) U.act.reviewPlan({ dataset: { arg: 'setup' }, closest: () => null, setAttribute() {}, removeAttribute() {} });
          else if (GH.planReview && GH.planReview.open) GH.planReview.open('setup');
        } catch (e) { if (G.console) G.console.error(e); }
      }, 450);
    }
    else if (friend) setTimeout(() => U.toast(`Using ${sh.plan.name}`, 'positive', 'Your week follows it from today.'), 500);
    else if (kept) setTimeout(() => U.toast(`${sender(sh) ? `${sender(sh)}'s plan is` : 'The plan you were sent is'} in Your plans`, 'neutral', 'Open it from You whenever you like.'), 500);
  }
  function saveEdit() {
    const S = U.S;
    const day = U.today();
    const p = draftProfile();
    stampSince(p, S.profile, day);
    const lines = B().setEquipment(S, p.equipment, day);
    const patch = Object.assign({}, p);
    delete patch.equipment; delete patch.startDay; delete patch.onboarded;
    // A weight changed here is logged as today's weigh-in; an unchanged one isn't.
    const changedW = Q._w != null && Q._w !== Q._w0;
    B().reprogram(S, patch, day);
    if (changedW && p.weightKg) B().addWeight(S, day, p.weightKg, 'manual');
    for (const kind of ['arm', 'leg']) {
      const side = p.lead[kind];
      const c = S.catchup[kind];
      if (side && side !== c.side) { c.side = side; c.active = true; c.tests = []; }
      else if (!side && !c.tests.length) c.active = false;
    }
    for (const j of Q._pain || []) S.pain[j] = day + 14;
    U.applyPrefs();
    close();
    U.save(true);
    U.haptic('save');
    U.toast('Plan updated', 'positive', lines.length ? lines.map((l) => l.text).join('. ') : undefined);
  }
})(typeof window !== 'undefined' ? window : globalThis);
