/* The questionnaire: 13 short screens, every answer defaulted, all of it editable later
 * ("Update my answers" reuses it without the health and baseline screens).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;

  const GOALS = [['abs', 'Visible abs'], ['arms', 'Bigger arms'], ['chest', 'Bigger chest'], ['legs', 'Legs and glutes'], ['back', 'Back and posture'], ['fat', 'Lose fat'], ['strength', 'Overall strength'], ['endurance', 'Endurance'], ['mobility', 'Mobility'], ['consistency', 'Consistency']];
  const JOINTS = [['knee', 'Knees'], ['shoulder', 'Shoulders'], ['back', 'Lower back'], ['wrist', 'Wrists'], ['elbow', 'Elbows'], ['hip', 'Hips'], ['ankle', 'Ankles'], ['neck', 'Neck']];
  const WEIGHTS = { db: { lb: [2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50], kg: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 25] }, kb: { lb: [10, 15, 18, 20, 26, 35, 44, 53], kg: [4, 6, 8, 10, 12, 16, 20, 24] } };
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // workout: only asked when workouts are on (food-and-health people skip them).
  const STEPS = [
    { id: 'welcome', title: 'Gradient Health', modes: ['new'], bare: true },
    { id: 'track', title: 'What to track', modes: ['new'] },
    { id: 'health', title: 'Health data', modes: ['new'] },
    { id: 'about', title: 'About you' },
    { id: 'goals', title: 'Goals', workout: true },
    { id: 'experience', title: 'Experience', workout: true },
    { id: 'schedule', title: 'Schedule', workout: true },
    { id: 'equipment', title: 'Equipment', workout: true },
    { id: 'body', title: 'Body check', workout: true },
    { id: 'food', title: 'Food' },
    { id: 'sleep', title: 'Sleep' },
    { id: 'style', title: 'Style', workout: true },
    { id: 'baseline', title: 'Baseline test', modes: ['new'], workout: true },
    { id: 'abs', title: 'About abs', when: () => Q.goals.includes('abs'), workout: true },
    { id: 'plan', title: 'Your plan' },
  ];
  const workoutsOn = () => !Q || Q.workouts !== false;

  let Q = null;       // the draft answers
  let mode = 'new';   // 'new' set-up, 'edit' (every screen), 'one' (a single screen with Save)
  let only = null;    // the screen 'one' mode edits
  let idx = 0;
  let tmpS = null;    // Health Connect data read during set-up, handed to the new state
  let plank = null;

  const clone = (x) => JSON.parse(JSON.stringify(x));
  function draftFrom(profile) {
    const p = clone(profile);
    const lb = p.units !== 'kg';
    p._w = p.weightKg ? Math.round((lb ? p.weightKg * B().LB_PER_KG : p.weightKg) * 10) / 10 : null;
    p._hcm = p.heightCm || null;
    p._hft = p.heightCm ? Math.floor(p.heightCm / 2.54 / 12) : null;
    p._hin = p.heightCm ? Math.round(p.heightCm / 2.54 - Math.floor(p.heightCm / 2.54 / 12) * 12) : null;
    p._strongArm = p.lead && p.lead.arm ? (p.lead.arm === 'L' ? 'R' : 'L') : 'same';
    p._strongLeg = p.lead && p.lead.leg ? (p.lead.leg === 'L' ? 'R' : 'L') : 'same';
    p._pain = [];
    p._base = { pushups: null, knees: false, plankSec: null, curlL: null, curlR: null };
    if (!Array.isArray(p.weekdays)) p.weekdays = [];
    return p;
  }
  function draftProfile() {
    const p = clone(Q);
    const lb = Q.units !== 'kg';
    p.weightKg = Q._w > 0 ? (lb ? Q._w / B().LB_PER_KG : Q._w) : null;
    p.heightCm = lb ? (Q._hft > 0 ? Math.round((Q._hft * 12 + (Q._hin || 0)) * 2.54) : null) : (Q._hcm > 0 ? Math.round(Q._hcm) : null);
    const weaker = (s) => (s === 'R' ? 'L' : s === 'L' ? 'R' : null);
    p.lead = { arm: weaker(Q._strongArm), leg: weaker(Q._strongLeg) };
    p.weekdays = Q.weekdays.length === Q.days ? Q.weekdays.slice().sort((a, b) => a - b) : null;
    if (!p.goals.length) p.goals = ['consistency'];
    if (p.food && p.food.mode) p.protein = Object.assign({}, p.protein, { track: p.food.mode !== 'off' });
    for (const k of Object.keys(p)) if (k[0] === '_') delete p[k];
    return p;
  }

  /* ---------------------------------------------------------------- show / hide */
  // The fade-out that's still running, if any. It holds its end state (fill: forwards) until it's
  // cancelled, so it must be cancelled before the set-up is shown again, or the page would sit there
  // invisible and catch every tap.
  let closing = null;
  function stopClosing() { if (closing) { const a = closing; closing = null; a.onfinish = null; a.cancel(); } }
  function open() {
    const el = U.els().onboardEl;
    stopClosing();
    const was = !el.hidden;
    el.hidden = false;
    shownStep = null;
    draw();
    if (!was && !U.reduced() && el.animate) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
      for (const [i, c] of Array.from(el.children).entries()) c.animate([{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 40 + i * 40, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)', fill: 'backwards' });
    }
  }
  U.showOnboarding = () => {
    if (!Q) { Q = draftFrom(B().defaultProfile()); mode = 'new'; idx = 0; }
    open();
    // Fetch the 3D figure and warm up the GPU while they answer, so the tour's figures draw at
    // once. The warm-up runs in idle slices, so taps never wait on it.
    if (U.preloadFigure) setTimeout(() => { U.preloadFigure().catch(() => {}); }, 3000);
  };
  // With a step id, only that screen opens, with Save: changing your equipment doesn't mean walking
  // through the whole set-up again.
  U.editAnswers = (stepId) => {
    Q = draftFrom(U.S.profile);
    mode = stepId ? 'one' : 'edit';
    only = stepId || null;
    idx = 0;
    dir = 1;
    open();
  };
  U.editableSteps = () => STEPS.filter((s) => !s.modes && !s.when && s.id !== 'plan' && (!s.workout || !U.S || U.S.profile.workouts !== false));
  // Every piece of equipment the person has ticked (each weight counts once).
  U.equipCount = (eq) => (eq.db || []).length + (eq.kb || []).length + ['ball', 'band', 'bar', 'table'].filter((k) => eq[k]).length;
  // "Home · 5 items", "Gym · 14 items", "Home and gym": what the Equipment rows show.
  U.equipSummary = (p) => {
    const home = U.equipCount(p.equipment || {});
    const g = p.gym || {};
    const gymN = Object.entries(g).filter(([k, v]) => k !== 'dbMax' && k !== 'bar' && v === true).length + (g.dbMax > 0 ? 1 : 0);
    const w = p.where || 'home';
    if (w === 'gym') return gymN ? `Gym · ${U.plural(gymN, 'item')}` : 'Gym';
    if (w === 'both') return 'Home and gym';
    return home ? U.plural(home, 'item') : 'Bodyweight only';
  };
  const EXP = { never: 'Never really trained', onoff: 'On and off', lt1: 'Under a year, steadily', '1to3': '1 to 3 years', '3plus': 'More than 3 years' };
  // A short line with the current answers on one set-up screen, for the "Your answers" list.
  U.answerSummary = (id, p) => {
    const eq = p.equipment || {};
    const w = p.weightKg ? U.fmtW(p.weightKg, 0) : null;
    const names = Object.fromEntries(GOALS);
    switch (id) {
      case 'about': return [p.age ? `${p.age} years` : null, w, p.heightCm ? (U.lb() ? `${Math.floor(p.heightCm / 30.48)} ft ${Math.round(p.heightCm / 2.54 % 12)} in` : `${p.heightCm} cm`) : null].filter(Boolean).join(' · ') || 'Age, weight and height';
      case 'goals': return (p.goals || []).map((g) => names[g] || g).join(', ') || 'Consistency';
      case 'experience': return EXP[p.experience] || 'How long you\'ve trained';
      case 'schedule': return `${p.days} days a week · ${p.minutes} min`;
      case 'equipment': return U.equipSummary(p);
      case 'body': return (p.careful || []).length ? `Careful with ${(p.careful || []).map((j) => (JOINTS.find((x) => x[0] === j) || [j, j])[1].toLowerCase()).join(', ')}` : 'Injuries, stronger side, impact';
      case 'food': { const fm = (p.food && p.food.mode) || (p.protein && p.protein.track === false ? 'off' : 'protein'); return `${p.weightGoal === 'lose' ? 'Lose' : p.weightGoal === 'gain' ? 'Gain' : 'Maintain'} weight · ${fm === 'full' ? 'calories and macros' : fm === 'off' ? 'food tracking off' : 'protein goal'}`; }
      case 'sleep': return p.sleepTypical ? `Usually ${p.sleepTypical.replace('<', 'under ')} h` : 'Your usual sleep';
      case 'style': return `Supersets ${p.prefs && p.prefs.supersets === false ? 'off' : 'on'} · rest ${p.prefs && p.prefs.rest !== 'auto' ? `${p.prefs.rest} s` : 'auto'}`;
      default: return '';
    }
  };
  // Slides the set-up away, then runs `after` (with the app already drawn underneath).
  function dismiss(after) {
    const el = U.els().onboardEl;
    const done = () => { el.hidden = true; el.innerHTML = ''; shownStep = null; };
    if (after) after();
    stopClosing();
    if (U.reduced() || !el.animate) { done(); return; }
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(24px)' }], { duration: 240, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)', fill: 'forwards' });
    closing = a;
    a.onfinish = () => { if (closing === a) closing = null; done(); a.cancel(); };
  }
  function close() {
    stopPlank();
    Q = null;
    dismiss(() => U.render());
  }
  U.onboardBack = () => {
    if (mode === 'one') { close(); return true; }
    if (idx > 0) { idx--; dir = -1; draw(); return true; }
    if (mode === 'edit') { close(); return true; }
    return false;
  };
  const visible = () => (mode === 'one' ? STEPS.filter((s) => s.id === only) : STEPS.filter((s) => (!s.modes || s.modes.includes(mode)) && (!s.when || s.when()) && (!s.workout || workoutsOn())));

  let shownStep = null;
  let dir = 1;
  function draw() {
    const el = U.els().onboardEl;
    const steps = visible();
    idx = Math.max(0, Math.min(idx, steps.length - 1));
    const st = steps[idx];
    let body = '';
    try { body = VIEW[st.id](); } catch (e) { body = `<p class="t-body">${U.esc(e.message)}</p>`; }
    const one = mode === 'one';
    const last = st.id === 'plan' || one;
    // The welcome screen isn't counted as a step.
    const counted = steps.filter((x) => !x.bare);
    const pos = counted.indexOf(st) + 1;
    const changed = shownStep !== st.id;
    // Top bar and buttons stay put; each step's content is fresh and slides in from the side it
    // comes from. Re-drawing the same step patches it in place, so scroll and focus stay.
    U.morph(el, `
      <div class="ob-top">
        ${idx > 0 && !one || mode !== 'new' ? U.glassBtn(idx > 0 && !one ? 'chevron-left' : 'close', idx > 0 && !one ? 'Back' : 'Close', 'obBack') : '<span class="ob-spacer"></span>'}
        ${one || st.bare ? '<span class="ob-progress"></span>' : `<div class="ob-progress">${U.progress(pos / counted.length, 'Set-up progress')}<span class="t-caption rf-muted rf-num">${pos} of ${counted.length}</span></div>`}
        <span class="ob-spacer"></span>
      </div>
      <div class="ob-scroll" id="obScroll">
        <div class="ob-page${st.bare ? ' is-bare' : ''}" data-key="step-${st.id}">
          ${st.bare ? '' : `<h1 class="rf-large-title">${U.esc(st.title)}</h1>`}
          <div class="ob-body">${body}</div>
        </div>
      </div>
      <div class="ob-actions">
        ${st.id === 'health' && !H().connected(H().status()) ? '<button type="button" class="rf-btn rf-glass" data-size="lg" data-act="obNext">Not now</button>' : ''}
        ${st.id === 'baseline' ? '<button type="button" class="rf-btn rf-glass" data-size="lg" data-act="obSkipTest">Skip the test</button>' : ''}
        <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="${last ? 'obFinish' : 'obNext'}">${last ? (one ? 'Save' : mode === 'edit' ? 'Save changes' : 'Start') : st.id === 'welcome' ? 'Get started' : 'Continue'}</button>
      </div>`);
    const sc = el.querySelector('#obScroll');
    if (changed) {
      if (sc) sc.scrollTop = 0;
      const page = el.querySelector('.ob-page');
      if (shownStep != null && page && !U.reduced() && page.animate) page.animate([{ opacity: 0, transform: `translateX(${dir * 44}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
    }
    shownStep = st.id;
    if (AFTER[st.id] && changed) AFTER[st.id](el);
  }
  U.act.obNext = () => { stopPlank(); idx++; dir = 1; U.haptic('tap'); draw(); };
  U.act.obSkipTest = () => { stopPlank(); Q._base = { pushups: null, knees: false, plankSec: null, curlL: null, curlR: null }; idx++; dir = 1; draw(); };
  U.act.obBack = () => { stopPlank(); if (!U.onboardBack()) { /* first screen of a new set-up: nothing behind it */ } };

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
    if (el.dataset.k === 'prefs.theme' && GH.platform) GH.platform.applyTheme(Q.prefs.theme);
    if (el.hasAttribute('data-redraw')) draw();
  };
  const bind = (k, type, redraw) => `data-on="q" data-k="${k}"${type ? ` data-type="${type}"` : ''}${redraw ? ' data-redraw' : ''}`;
  const listChip = (list, v, label, pressed, vt, redraw) => U.chip(label, pressed, `data-on="q" data-list="${list}" data-v="${U.esc(v)}"${vt ? ` data-vt="${vt}"` : ''}${redraw ? ' data-redraw' : ''}`);
  const field = (label, input, hint) => `<div class="rf-field"><label class="rf-field-label">${U.esc(label)}</label><div class="rf-field-control">${input}</div>${hint ? `<p class="rf-field-hint">${U.esc(hint)}</p>` : ''}</div>`;
  const numInput = (k, value, placeholder, extra) => `<input class="rf-input" type="number" inputmode="decimal" value="${value == null ? '' : U.esc(value)}" placeholder="${U.esc(placeholder || '')}" ${bind(k, 'num')} ${extra || ''}>`;
  const group = (title, html, foot) => `<div class="ob-group">${title ? `<h3 class="rf-list-header">${U.esc(title)}</h3>` : ''}${html}${foot ? `<p class="rf-list-footer">${U.esc(foot)}</p>` : ''}</div>`;
  const lead = (text) => `<p class="t-body ob-lead">${text}</p>`;
  const choice = (k, options, value, type, redraw) => `<ul class="rf-list ob-choice" role="radiogroup">${options.map(([v, t, sub]) => `<li><label class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(t)}</span>${sub ? `<span class="rf-list-sub">${U.esc(sub)}</span>` : ''}</span><input type="radio" class="ob-radio" name="${k}" value="${U.esc(v)}"${String(v) === String(value) ? ' checked' : ''} ${bind(k, type, redraw)}><span class="ob-check">${U.icon('check')}</span></label></li>`).join('')}</ul>`;

  /* ---------------------------------------------------------------- screens */
  const VIEW = {};
  const AFTER = {};

  VIEW.welcome = () => `<div class="ob-welcome">
      ${GH.LOGO ? `<img class="ob-logo" src="${GH.LOGO}" alt="" width="104" height="104">` : ''}
      <h1 class="rf-large-title">Gradient Health</h1>
      <p class="t-title-3 rf-muted ob-tagline">Workouts that adjust to you, every day.</p>
      <ul class="ob-points">
        <li>${U.icon('calendar')}<span>A plan built around your goals, your equipment and your time, at home or at the gym.</span></li>
        <li>${U.icon('heart')}<span>Sleep, steps and heart rate from Health Connect decide how hard today should be.</span></li>
        <li>${U.icon('lock')}<span>No account and no ads. Your data stays on your phone.</span></li>
      </ul>
    </div>`;
  // Workouts, food, or both. Changes which of the next screens are asked.
  const foodModeOf = () => (Q.food && Q.food.mode) || (Q.protein && Q.protein.track === false ? 'off' : 'protein');
  VIEW.track = () => {
    const cur = !workoutsOn() ? 'food' : foodModeOf() === 'full' ? 'both' : 'workouts';
    return lead('Pick what you want Gradient Health to do. You can change it any time in Settings.')
      + `<ul class="rf-list ob-choice" role="radiogroup">${[
        ['workouts', 'Workouts and health', 'A plan that adjusts to your sleep and activity, and a simple protein goal'],
        ['both', 'Workouts, health and food', 'All of that, plus calories and macros for what you eat'],
        ['food', 'Food and health', 'No workouts. Log meals and watch your calories, sleep, steps and weight.'],
      ].map(([v, t, sub]) => `<li><label class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(t)}</span><span class="rf-list-sub">${U.esc(sub)}</span></span><input type="radio" class="ob-radio" name="obTrack" value="${v}"${v === cur ? ' checked' : ''} data-on="obTrack"><span class="ob-check">${U.icon('check')}</span></label></li>`).join('')}</ul>`;
  };
  U.on.obTrack = (el, ev, v) => {
    if (!Q) return;
    Q.workouts = v !== 'food';
    const fm = foodModeOf();
    Q.food = Object.assign({}, Q.food || {}, { mode: v === 'workouts' ? (fm === 'full' ? 'protein' : fm) : 'full' });
    draw();
  };
  VIEW.health = () => {
    const st = H().status();
    const app = GH.platform && GH.platform.isApp();
    let status;
    if (!app) status = ['info', 'Health Connect works in the Android app. Here you can log sleep and weight by hand.'];
    else if (st === 'unsupported') status = ['info', 'Health Connect needs Android 14 or newer. You can still log sleep and weight by hand.'];
    else if (st === 'unavailable') status = ['caution', 'Health Connect isn\'t available on this phone right now. You can connect it later in Settings.'];
    else if (H().connected(st)) status = ['positive', Q._hcNote ? `Connected. Read ${Q._hcNote}.` : 'Connected.'];
    else status = null;
    const rows = [['moon', 'indigo', 'Sleep', 'Fewer sets after a short night'], ['navigate', 'green', 'Steps', 'Ticks off the walk on light days'], ['chart', 'teal', 'Weight and height', 'Trend, protein goal and warnings'], ['heart', 'coral', 'Resting heart rate and HRV', 'Spots when you need an easier day'], ['bolt', 'amber', 'Workouts from other apps', 'Easier on the legs after a long run'], ['check-circle', 'sky', 'Your workouts here', 'Saved back, so your other apps see them']];
    return lead('Gradient Health can read your health data from Health Connect to fit each day\'s session to how you slept and moved.')
      + `<ul class="rf-list">${rows.map(([ic, tone, t, sub]) => U.row({ icon: ic, tone, title: t, sub })).join('')}</ul>`
      + '<p class="t-footnote rf-muted ob-note">Everything stays on this phone, and you choose what to allow on the next screen. You can change it any time in Health Connect.</p>'
      + (status ? `<div class="ob-status" data-tone="${status[0]}">${U.icon(status[0] === 'positive' ? 'check-circle' : status[0] === 'caution' ? 'alert' : 'info')}<span>${U.esc(status[1])}</span></div>` : '')
      + (app && !['unsupported', 'unavailable'].includes(st) && !H().connected(st) ? '<button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="obConnect">Connect Health Connect</button>' : '');
  };
  U.act.obConnect = async (btn) => {
    btn.setAttribute('aria-busy', 'true');
    const st = await H().request(!!(Q.food && Q.food.mode === 'full'));
    if (H().connected(st)) {
      tmpS = tmpS || { profile: Q, health: { days: {}, hc: {}, manual: {}, lastSync: null, status: st }, weights: [], log: [], protein: {}, feel: {}, sleepChip: {} };
      const res = await H().sync(tmpS, Date.now(), 90);
      if (res && res.ok) prefill();
    } else if (st === 'denied') U.toast('Not connected', 'caution', 'You can connect Health Connect later in Settings.');
    draw();
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

  VIEW.about = () => {
    const lb = Q.units !== 'kg';
    return lead('Used for your protein goal, weight trend and a few age tweaks. It stays on this phone unless you turn on Claude later, which gets an age range instead of your age.')
      + group('Units', `<div class="ob-pad">${U.seg('units', [['lb', 'lb, ft'], ['kg', 'kg, cm']], Q.units, 'Units', ` ${bind('units', '', true)}`)}</div>`)
      + `<div class="ob-fields">
          ${field('Age', numInput('age', Q.age, 'e.g. 25', 'min="13" max="100" inputmode="numeric"'))}
          ${field(`Weight (${lb ? 'lb' : 'kg'})`, numInput('_w', Q._w, lb ? 'e.g. 150' : 'e.g. 68', 'min="30" max="700" step="0.1"'))}
          ${lb ? `<div class="ob-row2">${field('Height (ft)', numInput('_hft', Q._hft, '5', 'min="3" max="8" inputmode="numeric"'))}${field('(in)', numInput('_hin', Q._hin, '9', 'min="0" max="11" inputmode="numeric"'))}</div>`
      : field('Height (cm)', numInput('_hcm', Q._hcm, 'e.g. 175', 'min="100" max="250" inputmode="numeric"'))}
        </div>`
      + group('Sex (optional)', `<div class="ob-pad">${U.seg('sex', [['female', 'Female'], ['male', 'Male'], ['', 'Skip']], Q.sex || '', 'Sex', ` ${bind('sex')}`)}</div>`, foodModeOf() === 'full' ? 'Used for your calorie target. Skip it and an average is used.' : 'Only used to read your health trends. Skip it if you like.');
  };
  // Switching units converts the weights already picked.
  const unitsHandler = U.on.q;
  U.on.q = (el, ev, v) => {
    if (el.dataset && el.dataset.k === 'units' && Q && v !== Q.units) {
      const toKg = v === 'kg';
      const f = toKg ? 1 / B().LB_PER_KG : B().LB_PER_KG;
      if (Q._w) Q._w = Math.round(Q._w * f * 10) / 10;
      for (const k of ['db', 'kb']) {
        const list = WEIGHTS[k][toKg ? 'kg' : 'lb'];
        Q.equipment[k] = [...new Set((Q.equipment[k] || []).map((x) => list.reduce((a, c) => (Math.abs(c - x * f) < Math.abs(a - x * f) ? c : a), list[0])))];
      }
      if (Q.equipment.ballLb) Q.equipment.ballLb = Math.round(Q.equipment.ballLb * f);
      if (Q.gym) Q.gym.dbMax = B().convertDbMax(Q.gym.dbMax, toKg ? 'kg' : 'lb');
    }
    unitsHandler(el, ev, v);
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
    const names = (tier) => Object.entries(t).filter(([, v]) => v === tier).map(([g]) => B().GROUP_NAME[g].toLowerCase());
    const one = names(1);
    return one.length ? `Most work: ${one.join(', ')}. Everything else is kept up.` : 'A balanced plan for every muscle group.';
  }

  VIEW.experience = () => lead('This sets how gently you start and where each exercise begins.')
    + group('How long have you trained?', choice('experience', [['never', 'Never really'], ['onoff', 'On and off'], ['lt1', 'Under a year, steadily'], ['1to3', '1 to 3 years'], ['3plus', 'More than 3 years']], Q.experience))
    + group('', `<ul class="rf-list">${U.sw('Kept a routine for 2+ months before', Q.keptRoutine, bind('keptRoutine'))}</ul>`)
    + group('Last month', `<div class="ob-pad">${U.seg('recentActivity', [['none', 'Not active'], ['some', 'A little'], ['regular', 'Regularly']], Q.recentActivity, 'Activity last month', ` ${bind('recentActivity')}`)}</div>`, Q._hcNote ? 'Filled in from Health Connect.' : '');

  VIEW.schedule = () => {
    const picked = Q.weekdays.length;
    const hint = !picked ? `Leave these empty for a spread that suits ${Q.days} days.` : picked === Q.days ? 'Your workouts land on these days.' : `Pick ${Q.days} days to use your own (${picked} picked), or none for the default spread.`;
    return lead('Missed a day? The plan shifts forward instead of doubling up.')
      + group('Workouts a week', `<div class="ob-pad ob-center">${U.stepper('obDays', Q.days, 2, 6, 'Workouts a week', bind('days', 'num', true))}</div>`)
      + group('Which days (optional)', `<div class="ob-chips">${DAYS.map((d, i) => listChip('weekdays', i, d, Q.weekdays.includes(i), 'num', true)).join('')}</div>`, hint)
      + group('Minutes per workout', `<div class="ob-pad"><div class="ob-slider-value t-title-2 rf-num" id="obMin">${Q.minutes} min</div><div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="10" max="60" step="5" value="${Q.minutes}" aria-label="Minutes per workout" aria-valuetext="${Q.minutes} minutes" ${bind('minutes', 'num')}></div></div></div>`, 'Short on time mode fits a real session into 12-15 min any day.')
      + group('', `<ul class="rf-list">${U.sw('Light days', Q.lightDays !== false, bind('lightDays'), 'A walk and 5 min of mobility on off days. They count for your streak.')}</ul>`);
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
  function gymGroups() {
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    const g = Q.gym;
    return group('Your gym', `<div class="ob-chips">${Object.entries(B().GYM_PRESETS).map(([id, pr]) => `<button type="button" class="rf-chip" data-act="obGymPreset" data-arg="${id}">${U.esc(pr.name)}</button>`).join('')}</div>`, 'Start from one of these, then adjust below.')
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
      + (where !== 'home' ? gymGroups() : '')
      + (where !== 'gym' ? (where === 'both' ? '<h2 class="ob-section t-title-3">At home</h2>' : '') + homeEquipment() : '');
  };
  function homeEquipment() {
    const u = Q.units !== 'kg' ? 'lb' : 'kg';
    const eq = Q.equipment;
    const weights = (k) => {
      const list = [...new Set(WEIGHTS[k][u].concat(eq[k] || []))].sort((a, b) => a - b);
      return `<div class="ob-chips">${list.map((w) => listChip(`equipment.${k}`, w, `${w} ${u}`, (eq[k] || []).includes(w), 'num')).join('')}</div>
        <div class="ob-add"><input class="rf-input" type="number" inputmode="decimal" id="add-${k}" placeholder="Other weight (${u})" aria-label="Other ${k === 'db' ? 'dumbbell' : 'kettlebell'} weight"><button type="button" class="rf-btn" data-size="sm" data-act="obAddWeight" data-arg="${k}">Add</button></div>`;
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
  };
  U.act.obAddWeight = (btn) => {
    const k = btn.dataset.arg;
    const input = document.getElementById('add-' + k);
    const v = parseFloat(input && input.value);
    if (!(v > 0 && v < 400)) { U.toast('Enter a weight like 12', 'caution'); return; }
    const r = Math.round(v * 2) / 2;
    if (!Q.equipment[k].includes(r)) Q.equipment[k] = Q.equipment[k].concat(r);
    draw();
  };

  VIEW.body = () => lead('So nothing you do here makes an old injury worse.')
    + group('Does anything hurt right now?', `<div class="ob-chips">${JOINTS.map(([id, t]) => listChip('_pain', id, t, Q._pain.includes(id))).join('')}</div>`, 'Moves that load these are swapped out for two weeks.')
    + group('Old injuries to be careful with', `<div class="ob-chips">${JOINTS.map(([id, t]) => listChip('careful', id, t, (Q.careful || []).includes(id))).join('')}</div>`, 'Risky versions (jumps, tricky variations) are left out for these.')
    + group('Which arm is stronger?', `<div class="ob-pad">${U.seg('strongArm', [['L', 'Left'], ['same', 'About the same'], ['R', 'Right']], Q._strongArm, 'Stronger arm', ` ${bind('_strongArm')}`)}</div>`, 'The weaker side goes first, never does fewer reps than the other, and gets one extra set until it catches up.')
    + group('Which leg is stronger?', `<div class="ob-pad">${U.seg('strongLeg', [['L', 'Left'], ['same', 'About the same'], ['R', 'Right']], Q._strongLeg, 'Stronger leg', ` ${bind('_strongLeg')}`)}</div>`)
    + group('', `<ul class="rf-list">
        ${U.sw('A doctor told me to take it easy', Q.gentle, bind('gentle'), 'Gentler start, lower volume, no jumping.')}
        ${U.sw('Jumping and slamming is OK where I train', Q.impactOk !== false, bind('impactOk'), 'Turn off for apartments, bad knees or thin floors.')}
      </ul>`);

  VIEW.food = () => {
    const perKg = Q.units === 'kg';
    const opts = [[0.7, perKg ? '1.5 g/kg' : '0.7 g/lb'], [0.8, perKg ? '1.8 g/kg' : '0.8 g/lb'], [1, perKg ? '2.2 g/kg' : '1 g/lb']];
    const fm = foodModeOf();
    return lead(fm === 'full' ? 'Your calorie target comes from your size, your steps and your goal, and learns from your logs over time.' : 'No meal plans. Just a protein number to hit and a trend to watch.')
      + group('Weight goal', `<div class="ob-pad">${U.seg('weightGoal', [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']], Q.weightGoal, 'Weight goal', ` ${bind('weightGoal', '', true)}`)}</div>`, 'You get a heads-up if you\'re losing more than 1% a week.')
      + group('Food tracking', choice('food.mode', [['off', 'Off'], ['protein', 'Protein only', 'One number to hit, one tap to log'], ['full', 'Calories and macros', 'Log meals: search, your own foods, quick add']], fm, '', true))
      + (fm === 'full' && Q.weightGoal === 'lose' ? group('Pace', `<div class="ob-pad">${U.seg('pace', [['0.25', '0.25%'], ['0.5', '0.5%'], ['0.75', '0.75%'], ['1', '1%']], String((Q.food && Q.food.pace) || 0.5), 'Pace', ` ${bind('food.pace', 'num')}`)}</div>`, 'Of your body weight a week. Slower keeps more muscle.') : '')
      + (fm === 'protein' ? group('Your go-to protein', `<div class="ob-fields">
          ${field('Name', `<input class="rf-input" type="text" maxlength="24" value="${U.esc(Q.protein.quickName)}" ${bind('protein.quickName')}>`)}
          ${field('Grams', numInput('protein.quickG', Q.protein.quickG, '26', 'min="1" max="100" inputmode="numeric"'))}
        </div>`, 'One tap adds it on the Today screen.') : '')
      + (fm !== 'off' ? group('Protein per body weight', `<div class="ob-pad">${U.seg('perLb', opts, Q.protein.perLb, 'Protein per body weight', ` ${bind('protein.perLb', 'num')}`)}</div>`) : '');
  };

  VIEW.sleep = () => lead('Sleep changes what today\'s session looks like: under 5 hours means one less set per exercise.')
    + group('Most nights you sleep', `<div class="ob-pad">${U.seg('sleepTypical', [['<5', '<5 h'], ['5-6', '5-6'], ['6-7', '6-7'], ['7-8', '7-8'], ['8+', '8+']], Q.sleepTypical, 'Typical sleep', ` ${bind('sleepTypical')}`)}</div>`)
    + group('Your bedtime is', `<div class="ob-pad">${U.seg('sleepIrregular', [['false', 'Fairly regular'], ['true', 'All over the place']], String(!!Q.sleepIrregular), 'Bedtime', ` ${bind('sleepIrregular', 'bool')}`)}</div>`, Q._hcNote ? 'Filled in from Health Connect where it could be.' : 'Days roll over at 4 am, so a late night still counts as the day before.');

  VIEW.style = () => lead('How the workout player behaves.')
    + group('', `<ul class="rf-list">
        ${U.sw('Supersets', Q.prefs.supersets !== false, bind('prefs.supersets'), 'Pair exercises that don\'t share muscles. Saves time.')}
        ${U.sw('Sound', Q.prefs.sound !== false, bind('prefs.sound'))}
        ${U.sw('Vibration', Q.prefs.vibrate !== false, bind('prefs.vibrate'))}
      </ul>`)
    + group('Rest between sets', `<div class="ob-pad">${U.seg('rest', [['auto', 'Auto'], ['60', '60 s'], ['90', '90 s']], String(Q.prefs.rest), 'Rest between sets', ` ${bind('prefs.rest', 'numstr')}`)}</div>`, 'Auto rests 90 s after big moves like squats and rows, and 60 s after smaller ones and in supersets.')
    + group('Look', `<div class="ob-pad">${U.seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], Q.prefs.theme, 'Theme', ` ${bind('prefs.theme')}`)}</div>`);

  function curlEquip() { const e = Q.equipment; return (e.db && e.db.length) || e.band; }
  function baselineFrom() {
    const b = Q && Q._base;
    if (!b) return null;
    const out = {};
    if (b.pushups != null && b.pushups >= 0) { out.pushups = b.pushups; out.knees = !!b.knees; }
    if (b.plankSec > 0) out.plankSec = b.plankSec;
    if (b.curlL > 0 && b.curlR > 0) { out.curlL = b.curlL; out.curlR = b.curlR; }
    return Object.keys(out).length ? out : null;
  }
  VIEW.baseline = () => lead('Three quick tests put every exercise at the right starting point. About 3 minutes; skip any of them.')
    + group('1. Push-ups', `<div class="ob-fields">${field('Most in a row with good form', numInput('_base.pushups', Q._base.pushups, 'e.g. 12', 'min="0" max="150" inputmode="numeric"'))}</div><ul class="rf-list">${U.sw('I did them on my knees', Q._base.knees, bind('_base.knees'))}</ul>`)
    + group('2. Plank', `<div class="ob-plank"><div class="t-title-1 rf-num" id="plankTime">${Q._base.plankSec ? U.fmtDur(Q._base.plankSec) : '0:00'}</div><button type="button" class="rf-btn" data-variant="filled" data-act="obPlank" id="plankBtn">${plank ? 'Stop' : Q._base.plankSec ? 'Try again' : 'Start plank timer'}</button></div>`, 'Forearms down, body straight. Stop when your hips sag.')
    + (curlEquip() ? group('3. Curls, one arm at a time', `<div class="ob-fields ob-row2">${field('Left arm', numInput('_base.curlL', Q._base.curlL, 'reps', 'min="0" max="100" inputmode="numeric"'))}${field('Right arm', numInput('_base.curlR', Q._base.curlR, 'reps', 'min="0" max="100" inputmode="numeric"'))}</div>`, 'Left first, same weight, as many clean reps as you can. This is also the first left vs right check.') : '');
  U.act.obPlank = () => {
    if (plank) { Q._base.plankSec = Math.round((Date.now() - plank.start) / 1000); stopPlank(); if (GH.platform) GH.platform.cue('done'); draw(); return; }
    plank = { start: Date.now() + 3000, timer: null };
    let lastShown = null;
    const tick = () => {
      const el = document.getElementById('plankTime');
      const btn = document.getElementById('plankBtn');
      if (!el || !plank) return;
      const ms = Date.now() - plank.start;
      if (ms < 0) { const s = Math.ceil(-ms / 1000); el.textContent = String(s); if (s !== lastShown && GH.platform) GH.platform.cue('tick'); lastShown = s; }
      else { if (lastShown !== 0 && GH.platform) GH.platform.cue('go'); lastShown = 0; el.textContent = U.fmtDur(ms / 1000); }
      if (btn) btn.textContent = 'Stop';
    };
    plank.timer = setInterval(tick, 200);
    tick();
  };
  function stopPlank() { if (plank && plank.timer) clearInterval(plank.timer); plank = null; }

  VIEW.abs = () => lead('Visible abs are strong abs plus low enough body fat over them.')
    + `<div class="card ob-card"><ul class="ob-bullets">
        <li>Training builds the muscle. The app gives abs work three times a week and moves you up as you get stronger.</li>
        <li>The fat part comes from food and daily movement over months, and it's different for everyone, so there's no date promised here.</li>
        <li>What to watch instead: your waist measurement once a month, your weight trend, and your ab levels in Progress.</li>
        <li>Hitting your protein and your steps helps the most.</li>
      </ul></div>`;

  VIEW.plan = () => {
    const p = draftProfile();
    if (p.workouts === false) return summaryNoWorkouts(p);
    const prog = B().programFor(p);
    const tpl = B().templateFor(p, prog);
    const byFreq = {};
    for (const [unit, f] of Object.entries(prog.freq)) (byFreq[f] = byFreq[f] || []).push(unit);
    const order = ['abs', 'arms', 'chest', 'legs', 'back', 'shoulders'];
    const freqText = Object.keys(byFreq).map(Number).sort((a, b) => b - a).map((f) => `${byFreq[f].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(' + ')} ${f}×`).join(', ');
    const rows = [];
    for (let wd = 0; wd < 7; wd++) {
      const t = tpl.find((x) => x.offset === wd);
      rows.push(U.row({ title: DAYS[wd], detail: t ? U.esc(B().templateTitle(t.units)) : p.lightDays !== false ? 'Light day' : 'Rest', cls: t ? 'plan-day-work' : 'plan-day-light' }));
    }
    const kg = p.weightKg;
    const proteinG = kg && p.protein.track !== false ? Math.round(p.protein.perLb * kg * B().LB_PER_KG) : null;
    const notes = [];
    if (prog.onramp.weeks) notes.push(`First ${U.plural(prog.onramp.weeks, 'week')} at about ${Math.round(prog.onramp.mult * 100)}% to ease in.`);
    if (p.lead.arm) notes.push(`${U.side(p.lead.arm)} arm goes first, plus one extra ${U.side(p.lead.arm).toLowerCase()} set on arm days until it catches up.`);
    notes.push('A deload week every 5th week, sooner if you\'re run down.');
    if (proteinG) notes.push(`Protein goal: about ${proteinG} g a day.`);
    if (H().connected(H().status())) notes.push('Health Connect adjusts each day to your sleep, heart rate and activity.');
    return `<div class="card ob-card"><p class="t-title-3">${p.days} days · ~${p.minutes} min</p><p class="t-callout rf-muted">${U.esc(freqText)}</p></div>`
      + group('Your week', `<ul class="rf-list">${rows.join('')}</ul>`)
      + `<div class="card ob-card"><ul class="ob-bullets">${notes.map((n) => `<li>${U.esc(n)}</li>`).join('')}</ul></div>`;
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

  /* ---------------------------------------------------------------- finish */
  U.act.obFinish = () => {
    stopPlank();
    if (mode !== 'new') return saveEdit();
    const day = B().dayOf(Date.now(), 4);
    const p = draftProfile();
    const S = B().newState(p, baselineFrom(), day);
    for (const j of Q._pain || []) S.pain[j] = day + 14;
    if (tmpS) {
      S.health = Object.assign(S.health, tmpS.health);
      S.weights = tmpS.weights.concat(S.weights).sort((a, b) => a.day - b.day);
      // Food other apps logged, read along with the rest during set-up.
      if (tmpS.food && tmpS.food.other && GH.food) Object.assign(GH.food.data(S).other, tmpS.food.other);
    }
    S.health.status = H().status();
    GH.store.save(S);
    U.S = S;
    Q = null; tmpS = null;
    U.applyPrefs();
    U.route = { tab: 'today', view: null, arg: null };
    U.haptic('celebrate');
    dismiss(() => U.render('stagger'));
    U.syncHealth('manual');
    if (U.afterOnboarding) U.afterOnboarding();
  };
  function saveEdit() {
    const S = U.S;
    const day = U.today();
    const p = draftProfile();
    const lines = B().setEquipment(S, p.equipment, day);
    const patch = Object.assign({}, p);
    delete patch.equipment; delete patch.startDay; delete patch.onboarded;
    const oldW = S.profile.weightKg;
    B().reprogram(S, patch, day);
    if (p.weightKg && (!oldW || Math.abs(p.weightKg - oldW) > 0.05)) B().addWeight(S, day, p.weightKg, 'manual');
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
    U.toast('Plan updated', 'positive', lines.length ? lines.map((l) => l.text).join('. ') : undefined);
  }
})(typeof window !== 'undefined' ? window : globalThis);
