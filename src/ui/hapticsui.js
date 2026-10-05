/* Haptics in the UI: the rows Settings shows for them (U.hapticRows: the Haptic feedback switch, the
 * strength and "Feel each one") and the Feel each one gallery (U.act.hapticGallery), a sheet with
 * the strength control on top and every kind of haptic, in its groups, to try. The haptics that
 * come with the controls by themselves are in core.js (wire) and sheet.js; the kinds themselves, in
 * platform.js and Haptics.java.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const P = () => GH.platform || null;

  // Every kind, once, in the gallery's groups: [id, title, what's in it, tone, icon, [[kind, chip label]]].
  const GROUPS = [
    ['touch', 'Touch', 'Buttons, switches and sliders', 'sky', 'sliders',
      [['tap', 'Tap'], ['press', 'Press'], ['select', 'Pick'], ['tick', 'Step'], ['edge', 'Limit'], ['toggleOn', 'Switch on'], ['toggleOff', 'Switch off'], ['detent', 'Snap']]],
    ['navigation', 'Navigation', 'Tabs, pages, sheets and dragging', 'violet', 'navigate',
      [['tab', 'Tab'], ['nav', 'Open'], ['back', 'Back'], ['grab', 'Pick up'], ['drop', 'Put down']]],
    ['feedback', 'Feedback', 'How something went', 'green', 'check-circle',
      [['success', 'Saved'], ['log', 'Logged'], ['undo', 'Undo'], ['deny', 'Not allowed'], ['warning', 'Warning'], ['error', 'Error'], ['heavy', 'Delete']]],
    ['workout', 'Workout', 'Sets, timers and records', 'coral', 'timer',
      [['countdown', '3, 2, 1'], ['go', 'Go'], ['pause', 'Pause'], ['setDone', 'Set done'], ['done', 'Rest over'], ['workoutDone', 'Workout done'], ['levelUp', 'Level up'], ['milestone', 'Goal reached'], ['pr', 'New best']]],
    ['moments', 'Moments', 'The big ones', 'amber', 'star',
      [['badge', 'Badge'], ['celebrate', 'Celebrate']]],
    ['activities', 'Activities', 'Runs, walks, hikes and rides', 'green', 'act-run',
      [['actGo', 'Start'], ['actPause', 'Pause'], ['actResume', 'Resume'], ['actAutoPause', 'Auto-pause'], ['actAutoResume', 'Auto-resume'], ['actSplit', 'Split'], ['actGps', 'GPS ready'], ['actFinish', 'Finish'], ['actDiscard', 'Discard']]],
  ];
  U.hapticGroups = GROUPS;
  const STRENGTHS = [['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']];
  const strengthOf = (S) => { const v = S && S.profile && S.profile.prefs && S.profile.prefs.hapticStrength; return STRENGTHS.some(([k]) => k === v) ? v : 'medium'; };
  if (!G.document) return;

  const touchOff = () => { const p = P(); return !!(p && p.hapticsSystemEnabled && !p.hapticsSystemEnabled()); };
  // The strength control: one on Settings, one at the top of the gallery (their own names, so the two
  // radio groups never share a pick).
  const strength = (S, name) => U.seg(name, STRENGTHS, strengthOf(S), 'Haptic strength', ' data-on="hapticStrength"');

  /* ---------------------------------------------------------------- Settings */
  // Contract: U.hapticRows(S) → the rows for Settings' Sound and haptics group.
  U.hapticRows = (S) => {
    const on = !(S && S.profile && S.profile.prefs && S.profile.prefs.haptics === false);
    const sub = touchOff() ? 'Touch feedback is off in your phone\'s settings, so taps won\'t buzz. Workouts and alerts still will.' : 'A feel of its own for each kind of moment';
    return `${U.sw('Haptic feedback', on, 'data-on="hapticsOn" data-k="haptics"', sub)}${on ? `
      <li data-key="hapticStrength"><div class="rf-list-row set-stack"><span class="rf-list-text"><span class="rf-list-title">Strength</span></span>${strength(S, 'hapticStrength')}</div></li>
      ${U.row({ key: 'hapticGallery', icon: 'wave', tone: 'violet', title: 'Feel each one', sub: 'Try every kind at this strength', act: 'hapticGallery', chevron: true })}` : ''}`;
  };
  // Turned on, it plays its own switch's toggle (that came while haptics were still off); the rows
  // under it come and go with it.
  U.on.hapticsOn = (el, ev, v) => {
    if (!U.S) return;
    U.S.profile.prefs.haptics = !!v;
    U.applyPrefs();
    U.save();
    if (v) U.haptic('toggleOn');
    U.render();
  };
  // A new strength plays a tap at it (the haptic felt most often), right after the pick's select.
  U.on.hapticStrength = (el, ev, v) => {
    if (!U.S || !STRENGTHS.some(([k]) => k === v)) return;
    U.S.profile.prefs.hapticStrength = v;
    U.applyPrefs();
    U.save();
    U.haptic('tap', { force: true });
    // Picked in the gallery: the page behind shows it too.
    if (el && el.closest && el.closest('dialog')) U.render();
  };

  /* ---------------------------------------------------------------- the gallery */
  // A chip's rhythm, drawn: a bar for each beat (at Medium) and the gaps between, on a square-root scale
  // so a tick and a long buzz both fit: the longer a beat, the wider and taller its bar.
  const px = (ms) => Math.round(1.15 * Math.sqrt(ms) * 10) / 10;
  function wave(kind) {
    const p = P();
    const pat = p ? p.hapticPattern(kind, 'medium') : [20];
    let at = 0, gap = 0, out = '';
    pat.forEach((ms, i) => {
      if (i % 2) { gap += ms; at += ms; return; }
      const h = Math.min(14, Math.round(5 + 1.1 * Math.sqrt(ms)));
      out += `<i style="width:${Math.max(3, px(ms))}px;height:${h}px${gap ? `;margin-inline-start:${Math.max(2, px(gap))}px` : ''}" data-at="${at}" data-ms="${ms}"></i>`;
      at += ms; gap = 0;
    });
    return `<span class="hx-wave" aria-hidden="true">${out}</span>`;
  }
  function galleryBody(S) {
    const off = S && S.profile && S.profile.prefs && S.profile.prefs.haptics === false;
    const note = off ? '<div class="notice" data-tone="info">' + U.icon('info') + '<span>Haptic feedback is off, so these won\'t buzz. Turn it on in Settings to feel them.</span></div>'
      : touchOff() ? '<div class="notice" data-tone="info">' + U.icon('info') + '<span>Touch feedback is off in your phone\'s settings, so Touch and Navigation won\'t buzz.</span></div>' : '';
    return `<div class="hx">
      <div class="hx-top">${strength(S, 'hapticStrengthG')}<p class="t-footnote rf-muted">Tap one to feel it. Each kind of moment in the app has its own.</p>${note}</div>
      ${GROUPS.map(([id, title, sub, tone, icon, kinds]) => `<section class="hx-group" data-key="hx:${id}" data-tone="${tone}" aria-labelledby="hx-${id}">
        <div class="hx-head"><span class="hx-ico">${U.icon(icon, 'sm')}</span><h3 class="hx-title" id="hx-${id}">${U.esc(title)}</h3><span class="hx-sub">${U.esc(sub)}</span></div>
        <div class="hx-grid">${kinds.map(([k, label]) => `<button type="button" class="hx-chip" data-act="hapticTry" data-arg="${U.esc(k)}"><span class="hx-name">${U.esc(label)}</span>${wave(k)}</button>`).join('')}</div>
      </section>`).join('')}
    </div>`;
  }
  let gallery = null;
  // Contract: U.act.hapticGallery opens it.
  U.act.hapticGallery = () => {
    if (gallery && !gallery.closed) return;
    gallery = U.sheet({ title: 'Feel each one', size: 'auto', cls: 'hx-sheet', body: galleryBody(U.S), onClose: () => { gallery = null; } });
  };
  // A chip plays its kind at once, whatever is playing (trying one after another shouldn't wait), and
  // its bars light up in time with it.
  U.act.hapticTry = (el) => {
    const kind = el.dataset.arg;
    const p = P();
    if (p) p.haptic(kind, { force: true });
    for (const b of el.querySelectorAll('.hx-wave i')) {
      if (!b.animate) break;
      const delay = Number(b.dataset.at) || 0, ms = Math.max(90, Number(b.dataset.ms) || 0);
      b.animate(U.reduced() ? [{ opacity: 0.35 }, { opacity: 1 }] : [{ transform: 'scaleY(1)', opacity: 0.55 }, { transform: 'scaleY(1.9)', opacity: 1, offset: 0.25 }, { transform: 'scaleY(1)', opacity: 0.55 }], { duration: ms + 80, delay, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
