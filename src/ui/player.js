/* The workout player: one step at a time (warm-up, tests, sets, finisher, cool-down), rest with a
 * ring, the reps-in-reserve tap, swaps, then the check-in and the "Next time" lines. Everything is
 * saved after each step, so a closed app resumes where it stopped. Also runs the mobility flow.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const B = () => GH.brain;
  const M = () => GH.moves;
  const plat = () => GH.platform || { cue() {}, keepAwake() {}, vibrate() {} };

  let P = null;     // player state (not saved; the workout itself lives in S.active)
  let fig = null;   // { key, ctl }
  let timer = null;
  const LEG_FAMS = ['squat', 'hinge', 'glute'];
  const JOINTS = [['knee', 'Knees'], ['shoulder', 'Shoulders'], ['back', 'Lower back'], ['wrist', 'Wrists'], ['elbow', 'Elbows'], ['hip', 'Hips'], ['ankle', 'Ankles'], ['neck', 'Neck']];

  const root = () => U.els().playerEl;
  const A = () => U.S && U.S.active;
  function cur() {
    if (!P) return null;
    if (P.mode === 'mobility') return P.mob.steps[P.mob.idx] || null;
    return A() ? A().steps[A().idx] || null : null;
  }
  function stepsLeft() {
    if (P.mode === 'mobility') return P.mob.steps.slice(P.mob.idx + 1);
    return A().steps.slice(A().idx + 1);
  }

  /* ---------------------------------------------------------------- open / close */
  U.openPlayer = () => {
    if (!A()) return;
    if (!P || P.mode !== 'workout') P = { mode: 'workout', phase: 'step' };
    show();
  };
  U.openMobility = () => {
    const flow = B().mobilityFlow(U.S);
    const steps = [];
    for (const it of flow) {
      if (it.uni) { steps.push({ kind: 'cooldown', item: it, side: 'L', target: it.target }); steps.push({ kind: 'cooldown', item: it, side: 'R', target: it.target }); }
      else steps.push({ kind: 'cooldown', item: it, target: it.target });
    }
    P = { mode: 'mobility', phase: 'step', mob: { steps, idx: 0 } };
    show();
  };
  U.act.resumeWorkout = () => { U.haptic('go'); U.openPlayer(); };
  // An unfinished workout from an earlier day goes straight to its check-in.
  U.openCheckin = () => { if (!A()) return; P = { mode: 'workout', phase: 'checkin' }; show(); };
  let scene = null; // what's on screen (phase + step), so a change of scene can animate in
  let closing = null;
  let folding = []; // a cancelled workout's parts on their way out (see hide)
  function show() {
    const el = root();
    const was = !el.hidden;
    if (closing) { closing.cancel(); closing = null; }
    for (const a of folding.splice(0)) a.cancel();
    el.removeAttribute('data-closing');
    el.hidden = false;
    if (U.steadyLight) U.steadyLight();
    plat().keepAwake(true);
    if (!timer) timer = setInterval(loop, 200);
    scene = null;
    draw();
    U.renderAccessory();
    // The backdrop turns solid fast; the content rises in a little slower, all of it in under 0.45 s.
    if (!was && !U.reduced() && el.animate) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
      for (const [i, c] of Array.from(el.children).entries()) c.animate([{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: 30 + i * 30, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)', fill: 'backwards' });
    }
  }
  // The player goes: it fades and sinks (220 ms). A cancelled workout ('cancel') folds away instead:
  // what's on it drops and shrinks away at once, the actions first and the bar last, and then the
  // empty panel dissolves into Today under it (about 330 ms in all). With reduced motion it simply
  // goes, and a cancelled one fades for 150 ms. Resolves once it's gone (or shown again meanwhile).
  const EXIT = 'cubic-bezier(0.3, 0, 0.8, 0.15)', STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
  function hide(how) {
    const el = root();
    if (timer) { clearInterval(timer); timer = null; }
    plat().keepAwake(false);
    const done = () => { closing = null; folding = []; el.hidden = true; el.removeAttribute('data-closing'); el.innerHTML = ''; dropFig(); scene = null; if (U.steadyLight) U.steadyLight(); };
    const cancel = how === 'cancel';
    if (el.hidden || !el.animate || (U.reduced() && !cancel)) { done(); return Promise.resolve(); }
    // Fading out: the page shows through again, so its bars come back now (src/styles/perf.css).
    el.setAttribute('data-closing', '');
    if (cancel && U.reduced()) closing = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' });
    else if (cancel) {
      folding = Array.from(el.children).reverse().map((c, i) => c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(28px) scale(.9)' }], { duration: 240, delay: i * 35, easing: STANDARD, fill: 'forwards' }));
      closing = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 110, easing: STANDARD, fill: 'forwards' });
    } else closing = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(22px)' }], { duration: 220, easing: EXIT, fill: 'forwards' });
    const me = closing;
    return new Promise((resolve) => {
      me.onfinish = () => { if (closing === me) { me.cancel(); done(); } resolve(); };
      me.oncancel = () => resolve();
    });
  }
  // Minimize: the workout keeps going; Today and the tab bar show a way back.
  function minimize() {
    if (P && (P.phase === 'countdown' || P.phase === 'running')) { P.phase = 'step'; }
    hide();
    U.render();
  }
  function closeDone() { P = null; hide(); U.route = { tab: 'today', view: null, arg: null }; U.nextMotion('stagger'); U.render('stagger'); }
  // Closed or minimized, the player is put away (dismiss). Mid-workout the leave sheet asks first,
  // with its own haptic as it rises.
  U.playerBack = () => {
    if (P && (P.phase === 'next' || P.phase === 'mobdone')) { U.haptic('dismiss'); closeDone(); return true; }
    if (P && P.mode === 'mobility') { U.haptic('dismiss'); P = null; hide(); U.render(); return true; }
    // Mid-workout, Back asks what to do with it: keep it for later, finish now or cancel it.
    if (P && P.mode === 'workout' && A() && P.phase !== 'checkin') { leaveSheet(); return true; }
    U.haptic('dismiss');
    minimize();
    return true;
  };
  U.act.plMin = () => U.playerBack();
  const setsDone = (a) => a.steps.slice(0, a.idx).filter((s) => s.kind === 'set').length;
  function leaveSheet() {
    const a = A();
    const top = U.topSheet();
    if (!a || (top && top.el.classList.contains('leave-sheet'))) return;
    const done = setsDone(a);
    const total = a.steps.filter((s) => s.kind === 'set').length;
    U.sheet({
      title: 'Leave the workout?', size: 'fit', cls: 'leave-sheet',
      body: `<div class="sheet-pad leave">
        <p class="t-callout rf-muted">${done ? `${done} of ${total} sets done.` : 'No sets done yet.'}</p>
        <div class="leave-actions">
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="plKeep">${U.icon('pause')}Keep it for later</button>
          ${done ? `<button type="button" class="rf-btn" data-variant="soft" data-size="lg" data-act="plFinishNow">${U.icon('flag')}Finish now and check in</button>` : ''}
          <button type="button" class="rf-btn" data-variant="soft" data-tone="critical" data-size="lg" data-act="plCancel">${U.icon('close')}Cancel workout</button>
        </div>
        <p class="t-footnote rf-muted">Cancel it and nothing is saved or counts toward your streak. You can start again today.</p>
      </div>`,
    });
  }
  U.act.plKeep = () => { const top = U.topSheet(); if (top) top.close('ok'); U.haptic('pause'); minimize(); };
  // Cancel: nothing from the workout is kept and it doesn't count, so today's plan can be started
  // again. Sets already done are worth a question first. It's a moment of its own: the cancel haptic
  // as it's tapped; the player folds away, uncovering Today with the workout not started (or, from
  // Today, its buttons pinch away and its card settles back, U.todayCancelled in src/ui/today.js);
  // and once that has settled, the toast can put it all back.
  U.cancelDialog = (title, message, label, icon) => U.dialog({
    title, message, icon, tone: 'critical',
    actions: [{ label: 'Keep it', value: 'cancel', variant: 'gray', autofocus: true }, { label, value: 'ok', variant: 'filled', tone: 'critical', haptic: 'cancel' }],
  }).then((v) => v === 'ok');
  // In the player: it folds away, and Today comes back under it as it was before the workout began,
  // its cards rising into place and its buttons forming again (they were the workout's).
  function foldAway() {
    P = null;
    const gone = hide('cancel');
    const { floatEl } = U.els();
    if (!floatEl.hidden) { U.morph(floatEl, ''); floatEl.hidden = true; }
    U.route = { tab: 'today', view: null, arg: null };
    U.nextMotion('stagger');
    U.render('stagger');
    return gone;
  }
  async function cancelWorkout() {
    const a = A();
    if (!a) return false;
    const done = setsDone(a);
    // The question's Cancel workout plays the cancel haptic as it's tapped (core.js, dialogHaptic).
    if (done && !(await U.cancelDialog('Cancel this workout?', `The ${U.plural(done, 'set')} you did won't be saved or count for your streak.`, 'Cancel workout', 'close'))) return false;
    if (A() !== a) return false;
    if (!done) U.haptic('cancel');
    const S = U.S;
    const gone = B().cancelWorkout(S);
    U.save(true);
    const shown = !!P && P.mode === 'workout' && !root().hidden;
    if (P && P.mode === 'workout' && !shown) P = null;
    const moment = shown ? foldAway() : U.todayCancelled ? U.todayCancelled() : Promise.resolve(U.render());
    await moment;
    // Not when something else began meanwhile (another workout, a backup restored).
    if (U.S !== S || S.active) return true;
    U.toast('Workout cancelled', 'neutral', 'Nothing was saved.', {
      label: 'Undo',
      onClick: () => {
        // Not over another workout, or into data restored from a copy meanwhile.
        if (U.S !== S || !B().restoreWorkout(S, gone)) return;
        U.save(true);
        U.render();
        U.haptic('undo');
      },
    });
    return true;
  }
  U.act.plCancel = () => { const top = U.topSheet(); if (top) top.close('ok'); cancelWorkout(); };
  U.act.cancelWorkout = () => cancelWorkout();

  /* ---------------------------------------------------------------- figures */
  // The 3D figure (a lazy three.js chunk) when the phone has WebGL and it's picked in Settings, else
  // the flat one. Callers hold a controller that swaps its figure underneath. Once 3D is warm a new
  // figure is 3D from its first frame. Until then the box shows a 3D still of the figure's first
  // frame if one was drawn before (kept across launches for the day's moves), else the flat figure;
  // the 3D one mounts out of sight on top once the chunk is loaded and the GPU is warmed up, and
  // takes over when its first frame is drawn, so the box is never empty. If 3D hasn't drawn within
  // 3 s, or the GPU gives up, the flat figure takes over.
  const want3d = () => ((U.S && U.S.profile.prefs.figure) || '3d') === '3d';
  function load3d() {
    if (!want3d() || !GH.lazy) return Promise.resolve(null);
    return GH.lazy('figure3d').catch(() => null);
  }
  // Loading only fetches the chunk; preloading also warms up the GPU, in idle slices.
  U.loadFigure = () => load3d();
  U.preloadFigure = () => load3d().then((f) => (f && f.preload ? f.preload() : false));
  // Whether 3D can be drawn here: asks the chunk once it's loaded, else checks for WebGL 2 itself
  // (once per app version on this phone: the answer is kept with the stills, since making a test
  // context can take a noticeable moment right when a sheet opens).
  let gl2 = null;
  function hasGl2() {
    const ua = (G.navigator && G.navigator.userAgent) || '';
    if (GH.figure3d) {
      const ok = GH.figure3d.supported();
      const d = stills();
      if (d.gl2 !== ok || d.ua !== ua) { d.gl2 = ok; d.ua = ua; stillsSave(); }
      return ok;
    }
    if (gl2 == null) {
      const d = stills();
      if (typeof d.gl2 === 'boolean' && d.ua === ua) return (gl2 = d.gl2);
      try {
        const g = document.createElement('canvas').getContext('webgl2');
        gl2 = !!g;
        const lose = g && g.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) { gl2 = false; }
      d.gl2 = gl2; d.ua = ua; stillsSave();
    }
    return gl2;
  }
  U.canDraw3d = hasGl2;
  U.figure3dOk = () => want3d() && hasGl2();
  function look() {
    const pr = (U.S && U.S.profile.prefs) || {};
    return { dark: String(P2().currentTheme()).startsWith('dark'), skin: pr.figSkin || 'sand', shirt: pr.figShirt || undefined };
  }
  const P2 = () => GH.platform;
  // Figures that went flat because the phone took the GPU back while the app was in the background
  // try 3D again once it's in front, after a moment so the app settles first.
  const whenShownFns = new Set();
  let whenShownHooked = false;
  function whenShown(fn) {
    // Already back in front (a loss is often only reported then): just the moment's wait.
    if (!document.hidden) { setTimeout(fn, 500); return; }
    whenShownFns.add(fn);
    if (whenShownHooked) return;
    whenShownHooked = true;
    const go = () => {
      if (document.hidden || !whenShownFns.size) return;
      const fns = [...whenShownFns];
      whenShownFns.clear();
      setTimeout(() => { for (const f of fns) { try { f(); } catch (e) { /* one figure mustn't stop the rest */ } } }, 500);
    };
    document.addEventListener('visibilitychange', go);
    if (P2() && P2().on) P2().on('resume', go);
  }
  const idleCall = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 32));

  // Stills of figures' first frames, for the boxes a 3D figure isn't ready for yet. Drawn in idle
  // time for the moves on screen today (both boxes: move sheet and player) at the sizes those boxes
  // last had, and kept across launches in this browser's storage, so a sheet or workout opened right
  // after launch shows a 3D picture at once, before the 3D chunk has even loaded.
  const STILLS_KEY = 'gh.figStills';
  const STILLS_CHARS = 700000; // data URLs kept across launches, at most (about as many bytes)
  const stillsVersion = () => (GH.VERSION || 'dev') + ':1'; // a new app (or look) draws them afresh
  let stillsMem = null; // { v, sizes: { sheet, player: [w, h] }, items: [{ k, w, h, url, at }] }
  function stills() {
    if (stillsMem) return stillsMem;
    let d = null;
    try { d = JSON.parse(G.localStorage.getItem(STILLS_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || d.v !== stillsVersion() || !Array.isArray(d.items)) d = { v: stillsVersion(), sizes: {}, items: [] };
    return (stillsMem = d);
  }
  let stillsTimer = 0;
  function stillsSave() {
    if (stillsTimer) return;
    stillsTimer = setTimeout(() => {
      stillsTimer = 0;
      idleCall(() => { try { G.localStorage.setItem(STILLS_KEY, JSON.stringify(stills())); } catch (e) { /* full or private: kept for this launch */ } });
    }, 800);
  }
  // Which box a figure is in: its still is drawn at that box's shape.
  const boxKind = (host) => (!host || !host.classList ? null : host.classList.contains('sheet-fig') ? 'sheet' : host.classList.contains('pl-fig') ? 'player' : null);
  const stillKey = (m, o, lk) => [m.id, JSON.stringify(m.equip || []), !!o.mirrored, lk.dark, lk.skin, lk.shirt || ''].join('|');
  // A kept still for this figure in a w×h box: the same move, kit, side and look, drawn at the same
  // shape (the camera frames the move by the box's shape, so it lines up with the live figure).
  function stillFor(m, o, w, h) {
    if (!(w > 16 && h > 16)) return null;
    const k = stillKey(m, o, look()), a = w / h;
    let best = null;
    for (const it of stills().items) {
      if (it.k !== k || Math.abs(it.w / it.h - a) > a * 0.03) continue;
      if (!best || Math.abs(it.w - w) < Math.abs(best.w - w)) best = it;
    }
    return best;
  }
  function keepStill(m, o, w, h, url) {
    const d = stills(), k = stillKey(m, o, look());
    d.items = d.items.filter((it) => !(it.k === k && it.w === w && it.h === h));
    d.items.push({ k, w, h, url, at: Date.now() });
    // Newest first, within the budget.
    let chars = 0;
    d.items.sort((x, y) => y.at - x.at);
    d.items = d.items.filter((it) => (chars += it.url.length) <= STILLS_CHARS);
    stillsSave();
  }
  // Moves whose figures were opened lately get stills too (they tend to be opened again).
  let recentTimer = 0;
  function noteRecent(id) {
    const d = stills();
    const r = Array.isArray(d.recent) ? d.recent : [];
    if (r[0] === id) return;
    d.recent = [id].concat(r.filter((x) => x !== id)).slice(0, 8);
    stillsSave();
    // Its stills for next time, once the app is idle again (after the figure's box closes).
    if (recentTimer) clearTimeout(recentTimer);
    recentTimer = setTimeout(() => { recentTimer = 0; stillsForToday(); }, 3000);
  }
  function rememberBox(host) {
    const kind = boxKind(host);
    if (!kind) return;
    const w = Math.round(host.clientWidth), h = Math.round(host.clientHeight);
    if (!(w > 16 && h > 16)) return;
    const d = stills(), was = d.sizes[kind];
    if (was && was[0] === w && was[1] === h) return;
    d.sizes[kind] = [w, h];
    stillsSave();
  }
  // The shape a box usually has on this screen, before it's ever been seen.
  function boxGuess(kind) {
    const vw = G.innerWidth || 390, vh = G.innerHeight || 800;
    return kind === 'sheet' ? [Math.round(Math.min(vw, 640) - 56), 220] : [Math.round(Math.min(vw - 32, 520) - 24), Math.round(Math.max(170, Math.min(vh * 0.38, 420)) - 44)];
  }
  // Draw what's missing for moves opened lately, the moves on screen (today's session) and the
  // workout in progress, a few seconds after 3D is warm: one still per idle moment, a second apart,
  // only while no figure is on screen (a still never takes time from one) and it's calm (U.calm: no
  // scroll, touch or moving sheet; the still waits for that, it isn't dropped), a dozen a launch at
  // most, and none more on a phone slow enough that one took long (it gets the few it has).
  let stillsRun = null; // the queue being drawn
  let stillsDrawn = 0, stillsSlow = false;
  function stillsForToday() {
    const f = GH.figure3d;
    if (!f || !f.warm || !f.warm() || !f.still || !want3d() || !U.S || stillsSlow || stillsDrawn >= 12) return;
    const ids = new Set(stills().recent || []);
    for (const b of document.querySelectorAll('[data-act="moveInfo"][data-arg]')) ids.add(b.dataset.arg);
    const act = U.S.active;
    if (act && act.steps) for (const st of act.steps.slice(act.idx || 0, (act.idx || 0) + 6)) if (st.item && st.item.moveId) ids.add(st.item.moveId);
    const jobs = [];
    for (const id of ids) {
      const m0 = M().MOVES[id];
      if (!m0) continue;
      for (const kind of ['sheet', 'player']) {
        // A one-sided move is drawn for each side in the player; the sheet shows the catch-up side.
        const sides = m0.uni ? (kind === 'player' ? ['L', 'R'] : [(U.S.catchup && U.S.catchup.arm && U.S.catchup.arm.side) || 'L']) : [null];
        for (const side of sides) jobs.push({ id, kind, side });
      }
    }
    if (stillsRun) {
      // Already drawing: what's new goes first (a move just opened).
      const have = new Set(stillsRun.map((j) => `${j.id}|${j.kind}|${j.side}`));
      stillsRun.unshift(...jobs.filter((j) => !have.has(`${j.id}|${j.kind}|${j.side}`)));
      return;
    }
    stillsRun = jobs;
    const later = () => setTimeout(() => idleCall(step), 1000);
    const step = () => {
      if (!GH.figure3d || !GH.figure3d.warm() || stillsSlow || stillsDrawn >= 12) { stillsRun = null; return; }
      // Not while any figure box is showing (one may be getting its live figure ready) or a 3D figure
      // runs anywhere: stills are for later, and never take time from a figure on screen.
      const busyNow = document.hidden || document.querySelector('.fig3d[data-ready]') || [...document.querySelectorAll('.pl-fig, .sheet-fig')].some((h) => h.offsetParent);
      if (busyNow) { setTimeout(() => idleCall(step), 1500); return; }
      // Nor in the middle of a scroll, a touch or a sheet's move, nor right after one (U.quiet): a
      // still holds the page's thread for a few frames, and on a phone a scroll that starts
      // meanwhile waits for it. It waits for quiet.
      const quiet = U.quiet || U.calm;
      if (quiet && !quiet()) { (U.whenQuiet || U.whenCalm)(() => idleCall(step)); return; }
      while (jobs.length) {
        const j = jobs.shift();
        const m0 = M().MOVES[j.id];
        const { m, o } = figOpts({ side: j.side, item: { moveId: j.id } }, m0);
        const [w, h] = stills().sizes[j.kind] || boxGuess(j.kind);
        if (stillFor(m, o, w, h)) continue;
        // 1.5 pixels a point: sharp enough for the moment it shows, small enough to keep. Drawn
        // now, encoded in the background (stillAsync), kept once it's back.
        const t0 = Date.now();
        const opts = Object.assign({ width: Math.round(w * 1.5), height: Math.round(h * 1.5), t: 0, mirrored: !!o.mirrored }, look());
        const f3 = GH.figure3d;
        (f3.stillAsync ? f3.stillAsync(m, opts) : Promise.resolve(f3.still(m, opts))).then((url) => { if (url) keepStill(m, o, w, h, url); }, () => {});
        stillsDrawn++;
        if (Date.now() - t0 > 400) stillsSlow = true;
        break; // one per idle moment
      }
      if (jobs.length && !stillsSlow) later();
      else stillsRun = null;
    };
    idleCall(step);
  }
  // Tests: draw the stills now (again after a slow one, too).
  U.figureStills = (again) => { if (again) { stillsSlow = false; stillsDrawn = 0; } stillsForToday(); };
  // A still standing in for a figure: the figure's first frame (the live figure takes over from the
  // start of the rep, so the two line up).
  function stillFig(at, m, url, o) {
    const el = document.createElement('div');
    el.className = 'fig3d fig-still';
    el.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    const img = document.createElement('img');
    img.alt = (o && o.label) || m.name || 'Exercise diagram';
    img.decoding = 'sync';
    img.src = url;
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain';
    el.appendChild(img);
    if (at) at.appendChild(el);
    return { el, still: true, duration: (m.$tl || GH.pose.timeline(m)).total, play() {}, pause() {}, time: () => 0, destroy() { el.remove(); } };
  }

  // Warm 3D up a small piece per idle moment, then draw stills of today's moves for next time.
  // core.js decides when (U.warmFigure): only when today's workout will show a figure, after the
  // app has gone idle, or on the first press of Start or a move.
  // The stills wait a few seconds: once warm, a live figure is ready at once, so they only help the
  // next launch, and copying one out holds the page for a moment, which shouldn't be the moment a
  // move is opened (likeliest right after launch).
  const STILLS_AFTER_WARM = 4000;
  function warmSoon(tries) {
    const S = U.S;
    if (!S) { if (tries < 40) setTimeout(() => warmSoon(tries + 1), 250); return; }
    if (!S.profile.onboarded || S.profile.workouts === false || !want3d() || !GH.lazy) return;
    G.requestAnimationFrame(() => G.requestAnimationFrame(() => idleCall(() => {
      U.preloadFigure().then((ok) => { if (ok) setTimeout(stillsForToday, STILLS_AFTER_WARM); }, () => {});
    })));
  }
  U.warmFigure = () => { if (G.document && G.requestAnimationFrame) warmSoon(0); };

  let chunkFails = 0; // the chunk didn't load: tried again a couple of times, then left flat
  function figure(host, m, o) {
    let inner = null, pending = null, at = host, playing = false, dead = false, is3d = false;
    let view = null, giveUp = 0, retries = 0, busy = false, flatShown = false, stayFlat = false;
    const ctl = {
      get el() { return inner.el; },
      get duration() { return inner.duration; },
      get is3d() { return is3d; },
      onPhase: null,
      // Move the figure into another box (the player redraws its card between steps).
      attach(el) {
        at = el;
        for (const f of [inner, pending]) if (f && f.el.parentNode !== el) el.appendChild(f.el);
        wake();
        upgrade();
      },
      play() { playing = true; inner.play(); if (pending) pending.play(); upgrade(); },
      pause() { playing = false; inner.pause(); if (pending) pending.pause(); },
      playOnce() { if (inner.playOnce) inner.playOnce(); },
      setView(v) { view = v; if (is3d && inner.setView) inner.setView(v); },
      destroy() { dead = true; whenShownFns.delete(retry); dropPending(); inner.destroy(); },
    };
    const wake = () => { for (const f of [inner, pending]) if (f && f.wake) f.wake(); };
    const retry = () => { if (!dead) { stayFlat = false; upgrade(); } };
    const flat = () => {
      is3d = false;
      inner = GH.pose.mount(at, m, o);
      if (playing) inner.play();
      flatShown = false;
      G.requestAnimationFrame(() => { flatShown = true; }); // on screen from the next paint
    };
    // A still standing in, and 3D isn't coming after all: the flat figure takes its place.
    const stillToFlat = () => {
      if (!inner || !inner.still) return;
      const old = inner;
      flat();
      old.destroy();
      fadeIn(inner.el);
    };
    // The first figure: a kept 3D still of it while 3D isn't warm yet, else the flat one (which a warm
    // 3D figure replaces before it's ever painted).
    const first = () => {
      rememberBox(host);
      if (boxKind(host) && m.id) noteRecent(m.id);
      const f = GH.figure3d;
      if (want3d() && GH.lazy && chunkFails < 3 && !(f && f.warm && f.warm()) && !(f && !f.supported())) {
        const st = stillFor(m, o, host.clientWidth, host.clientHeight);
        if (st) {
          is3d = false;
          inner = stillFig(at, m, st.url, o);
          flatShown = false;
          G.requestAnimationFrame(() => { flatShown = true; });
          return;
        }
      }
      flat();
    };
    function dropPending() {
      if (giveUp) { clearTimeout(giveUp); giveUp = 0; }
      const p = pending;
      pending = null;
      if (p) { try { p.destroy(); } catch (e) { /* already gone */ } }
    }
    // The 3D figure has drawn a frame: it takes over at the same point in the rep. A flat figure that
    // never reached the screen is simply swapped; one that did crossfades out.
    function promote(p) {
      if (giveUp) { clearTimeout(giveUp); giveUp = 0; }
      pending = null;
      const old = inner;
      if (old.time && p.seek) p.seek(old.time());
      inner = p;
      is3d = true;
      p.onPhase = (ph) => { if (!dead && ctl.onPhase) ctl.onPhase(ph); };
      if (ctl.onPhase && p.phase) ctl.onPhase(p.phase());
      if (view && p.setView) p.setView(view, true);
      if (playing) p.play(); else p.pause();
      p.el.removeAttribute('aria-hidden');
      p.el.classList.remove('fig-pending');
      if (!flatShown || U.reduced() || !p.el.animate) { old.destroy(); return; }
      const a = p.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      a.onfinish = a.oncancel = () => old.destroy();
    }
    function onFail(p, info) {
      try { p.destroy(); } catch (e) { /* already gone */ }
      if (dead) return;
      if (p === pending) { dropPending(); stillToFlat(); } // never shown: the flat figure stays, or takes over from a still
      else if (p === inner) { // it was showing: back to flat
        flat();
        fadeIn(inner.el);
        if (ctl.onPhase) ctl.onPhase(null);
      } else return;
      if (info && info.reason === 'lost' && info.hidden && retries < 2) { retries++; whenShown(retry); }
    }
    // Mount the 3D figure out of sight once the chunk is here and the GPU is warm.
    function upgrade() {
      if (dead || is3d || pending || busy || stayFlat || chunkFails >= 3 || !want3d() || !GH.lazy) return;
      if (!at || !at.isConnected) return; // tried again on the next attach() or play()
      busy = true;
      load3d().then((f) => {
        if (!f) { if (++chunkFails < 3) setTimeout(retry, 10000); return null; }
        if (!f.supported()) return null;
        return f.warm && !f.warm() && f.preload ? f.preload().then(() => f) : f;
      }).then((f) => {
        busy = false;
        if (!dead && (!f || !f.supported())) stillToFlat(); // no 3D coming: a still gives way to the flat figure
        if (!f || dead || is3d || pending || !f.supported() || !at.isConnected) return;
        if (document.hidden) { whenShown(retry); return; }
        const p = f.mount(at, m, Object.assign({}, o, look(), {
          onReady: (c) => { if (c === pending && !dead) promote(c); },
          onFallback: (c, info) => onFail(c, info),
        }));
        pending = p;
        p.el.classList.add('fig-pending');
        p.el.setAttribute('aria-hidden', 'true');
        if (playing) p.play();
        // Only time in front counts: a hidden app gets a fresh 3 s once it's back.
        const check = () => {
          giveUp = 0;
          if (pending !== p) return;
          if (document.hidden) whenShown(() => { if (pending === p) giveUp = setTimeout(check, 3000); });
          else { dropPending(); stayFlat = true; stillToFlat(); } // this figure stays flat
        };
        giveUp = setTimeout(check, 3000);
      }).catch((e) => { busy = false; if (G.console) G.console.error('figure3d:', e); });
    }
    first();
    upgrade();
    return ctl;
  }
  // "Control 2 s · Drive 1 s": how long each half of a rep takes, in the order the move starts.
  // Holds and flowing moves (jacks, crawls) have no tempo.
  function tempoOf(m) {
    const rep = (m && m.rep) || [];
    if (rep.length < 2 || rep.some((x) => x.ph !== 'con' && x.ph !== 'ecc') || !rep.some((x) => x.ph === 'con') || !rep.some((x) => x.ph === 'ecc')) return null;
    const secs = (ph) => Math.max(0.5, Math.round(rep.filter((x) => x.ph === ph).reduce((a, x) => a + x.ms, 0) / 500) / 2);
    const parts = { ecc: ['ecc', 'Control', secs('ecc')], con: ['con', 'Drive', secs('con')] };
    return rep[0].ph === 'ecc' ? [parts.ecc, parts.con] : [parts.con, parts.ecc];
  }
  U.tempoHtml = (m) => {
    const t = tempoOf(m);
    // Keyed by move: a swap or another rung gets a fresh strip; the lit half (data-on) is set by
    // code, and a re-render leaves attributes it didn't set alone.
    return t ? `<div class="fig-tempo" data-key="tempo-${U.esc(m.id)}" aria-hidden="true">${t.map(([ph, word, s]) => `<span data-ph="${ph}">${word} <b class="rf-num">${String(s).replace('.5', '½')} s</b></span>`).join('')}</div>` : '';
  };
  // Light up the half of the rep the figure is in (the 3D figure reports it; the flat one doesn't).
  function tempoSync(ctl, box) {
    ctl.onPhase = (p) => {
      const strip = box && box.querySelector('.fig-tempo');
      if (strip) strip.dataset.on = p && (p.ph === 'con' || p.ph === 'ecc') ? p.ph : '';
    };
  }
  let covered = false; // the how-to sheet is over the player
  function dropFig() { if (fig) { try { fig.ctl.destroy(); } catch (e) { /* ignore */ } fig = null; } }
  function leadSideFor(fam) { const c = U.S.catchup; return (LEG_FAMS.includes(fam) ? c.leg.side : c.arm.side) || 'L'; }
  function figOpts(st, m0) {
    // The kit where this workout happens: a goblet squat shows a dumbbell at the gym.
    const S = U.S;
    const m = M().forPerson(m0, B().eqFor(S, S.active ? S.active.day : U.today()));
    const side = st.side || null;
    const o = { reducedMotion: U.reduced() };
    if (m.uni && side) { o.mirrored = M().mirrorFor(m, side); o.lead = side === leadSideFor(m0.family); }
    const lk = look();
    return { m, o, key: `${m0.id}:${side}:${o.mirrored}:${want3d()}:${lk.dark}:${lk.skin}:${lk.shirt}` };
  }
  function mountFig(host, st, playing) {
    const m0 = st && st.item && M().MOVES[st.item.moveId];
    if (!host || !m0 || !GH.pose) return;
    const { m, o, key } = figOpts(st, m0);
    if (fig && fig.key === key) fig.ctl.attach(host); // same move: keep the running animation
    else {
      dropFig();
      try { fig = { key, ctl: figure(host, m, o) }; } catch (e) {
        fig = null;
        if (G.console) G.console.error('figure:', e);
        try { host.textContent = ''; GH.pose.thumb(host, m, o); } catch (e2) { /* nothing to show */ }
        return;
      }
      fadeIn(host);
    }
    tempoSync(fig.ctl, host.parentNode);
    if (playing && !covered) fig.ctl.play(); else fig.ctl.pause();
  }
  function fadeIn(el) { if (el && !U.reduced() && el.animate) el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }); }
  U.figureFor = (host, moveId, side, playing) => {
    const m0 = M().MOVES[moveId];
    if (!m0 || !GH.pose) return null;
    const { m, o } = figOpts({ side, item: { moveId } }, m0);
    const ctl = figure(host, m, o);
    fadeIn(host);
    tempoSync(ctl, host.parentNode);
    if (playing) ctl.play();
    return ctl;
  };
  // Whether U.figureFor would start this box with a kept 3D still (an <img>, as figure()'s first()
  // picks it): quick to put in, so a sheet puts it in with its first frame (src/ui/moves.js).
  U.figureStillFirst = (host, moveId, side) => {
    const m0 = M().MOVES[moveId], f = GH.figure3d;
    if (!m0 || !GH.pose || !want3d() || !GH.lazy || chunkFails >= 3 || (f && f.warm && f.warm()) || (f && !f.supported())) return false;
    const { m, o } = figOpts({ side, item: { moveId } }, m0);
    return !!stillFor(m, o, host.clientWidth, host.clientHeight);
  };

  /* ---------------------------------------------------------------- step facts */
  function isTimed(st) { return st.kind === 'interval' || st.kind === 'cooldown' || (!!st.item.timed && st.kind !== 'test'); }
  function durationOf(st) {
    if (st.kind === 'interval') return st.work;
    if (st.kind === 'set') return B().currentTarget(A(), st);
    return st.target || st.item.target || 30;
  }
  function limbOf(st) { const fam = st.item.fam || (M().MOVES[st.item.moveId] || {}).family; return LEG_FAMS.includes(fam) ? 'leg' : 'arm'; }
  function eyebrow(st) {
    const it = st.item;
    if (st.kind === 'warmup') return 'Warm-up';
    if (st.kind === 'test') return 'Left vs right test';
    if (st.kind === 'interval') return `Finisher · round ${st.round + 1} of ${st.of}`;
    if (st.kind === 'cooldown') return P.mode === 'mobility' ? `Mobility · ${P.mob.idx + 1} of ${P.mob.steps.length}` : it.cardio ? 'Easy cardio' : 'Cool-down';
    if (st.leadOnly) return `Extra ${U.side(st.side).toLowerCase()} set`;
    return `${it.superset ? it.superset + ' · ' : ''}${B().GROUP_NAME[it.group] || ''} · set ${st.set + 1} of ${st.of}`;
  }
  function sideLine(st) {
    if (!st.side) return '';
    const lead = leadSideFor(st.item.fam || (M().MOVES[st.item.moveId] || {}).family);
    const isLead = st.side === lead;
    const txt = st.kind === 'test' ? `${U.side(st.side)} ${limbOf(st)}: max clean reps`
      : `${U.side(st.side)} ${st.kind === 'interval' || st.kind === 'cooldown' ? 'side' : limbOf(st)}${st.first === true && !st.leadOnly ? ' first' : ''}`;
    return `<p class="pl-side${isLead ? ' is-lead' : ''}">${U.esc(txt)}</p>`;
  }
  function dots(st) {
    if (st.kind !== 'set' || st.leadOnly || st.of <= 1) return '';
    return `<div class="pl-dots" aria-label="Set ${st.set + 1} of ${st.of}">${Array.from({ length: st.of }, (_, i) => `<i class="${i < st.set ? 'done' : i === st.set ? 'now' : ''}"></i>`).join('')}</div>`;
  }
  // The weight for a gym exercise (what the person picked this session, else the planned load), or
  // null for moves without a tracked weight.
  function weightOf(it) {
    if (!it || !it.load || it.load.kg == null || !B().isGymFam(it.fam)) return null;
    const kg = it.curLoad != null ? it.curLoad : it.load.kg;
    const m = M().MOVES[it.moveId];
    return { kg, label: B().fmtLoad(U.S, kg, it.load.key, m), first: !!it.load.guess && it.curLoad == null };
  }
  function upNext(st) {
    if (!st) return '<p class="t-callout rf-muted">Last one.</p>';
    const it = st.item;
    const w = st.kind === 'set' ? weightOf(it) : null;
    const what = st.kind === 'set' ? U.target(it, B().currentTarget(A(), st)) + (w ? ` at ${w.label}` : '') : st.kind === 'interval' ? `${st.work} s` : st.kind === 'test' ? 'max reps' : isTimed(st) ? (it.cardio ? `${Math.max(1, Math.round(durationOf(st) / 60))} min` : `${durationOf(st)} s`) : U.target(it);
    return `<div class="pl-next"><span class="t-caption rf-muted">Up next</span><span class="t-headline">${U.esc(it.name)}</span><span class="t-footnote rf-muted">${U.nb(`${eyebrow(st)} · ${what}${st.side ? ` · ${U.side(st.side).toLowerCase()}` : ''}`)}</span></div>`;
  }

  /* ---------------------------------------------------------------- drawing */
  function progressBar() {
    if (P.mode === 'mobility') return U.progress(P.mob.idx / Math.max(1, P.mob.steps.length), 'Mobility progress');
    const a = A();
    if (!a) return U.progress(1, 'Workout progress');
    return U.progress(a.idx / Math.max(1, a.steps.length), 'Workout progress');
  }
  function top(title) {
    return `<div class="pl-top">
      ${U.glassBtn('chevron-down', P.mode === 'mobility' ? 'Close' : 'Minimize', 'plMin')}
      <div class="pl-prog">${progressBar()}<span class="t-caption rf-muted">${U.esc(title || '')}</span></div>
      ${P.mode === 'workout' ? U.glassBtn('more', 'Workout options', 'plMenu') : '<span class="ob-spacer"></span>'}
    </div>`;
  }
  function draw() {
    const el = root();
    if (!P || el.hidden) return;
    if (P.mode === 'workout' && !A() && !['next'].includes(P.phase)) { closeDone(); return; }
    let html = '';
    const st = cur();
    if (P.phase === 'checkin') html = viewCheckin();
    else if (P.phase === 'next') html = viewNext();
    else if (P.phase === 'mobdone') html = viewMobDone();
    else if (P.phase === 'rest') html = viewRest();
    else if (!st) { if (P.mode === 'mobility') { finishMobility(); return; } P.phase = 'checkin'; html = viewCheckin(); }
    else html = viewStep(st);
    // Patch in place: the bar, buttons and diagram stay put while the content changes.
    const phase = P.phase === 'countdown' || P.phase === 'running' ? 'step' : P.phase;
    const next = `${phase}:${P.mode === 'mobility' ? P.mob.idx : A() ? A().idx : ''}`;
    const changed = scene !== next;
    // Each scene gets fresh content (so controls never carry over from the last one); within a
    // scene, updates patch in place.
    html = html.replace(/<div class="(pl-main|pl-scroll)/, (m) => m.replace('<div', `<div data-key="scene-${next}"`));
    U.morph(el, html);
    if (phase === 'rest') fitRest(el);
    if (changed && scene != null) sceneIn(el, phase);
    scene = next;
    const host = el.querySelector('.pl-fig');
    const nx = P.phase === 'rest' ? cur() : null;
    if (host && st && (P.phase === 'step' || P.phase === 'countdown' || P.phase === 'running')) mountFig(host, st, true);
    else if (host && nx) mountFig(host, nx, false);
    else if (fig) fig.ctl.pause(); // no figure on this view (the check-in, say): stop drawing it
    loop();
  }

  // A rest that doesn't fit (a small phone with large text: the ring, the question, Up next and the
  // place held for Continue) draws its ring smaller, decided as the rest is drawn, so it never
  // changes size during the rest.
  function fitRest(el) {
    const main = el.querySelector('.pl-main.pl-rest');
    if (!main) return;
    main.classList.remove('is-tight');
    if (main.scrollHeight > main.clientHeight + 1) main.classList.add('is-tight');
  }
  if (G.addEventListener) G.addEventListener('resize', () => { if (P && P.phase === 'rest' && !root().hidden) fitRest(root()); });

  // A new step or phase slides in: the main block rises, the action row settles. It plays after
  // every set, so it's quick: in by 300 ms (1.9.0's took 380).
  function sceneIn(el, phase) {
    if (U.reduced()) return;
    const main = el.querySelector('.pl-main, .pl-scroll');
    const acts = el.querySelector('.pl-actions');
    if (main && main.animate) main.animate([{ opacity: 0, transform: `translateY(${phase === 'rest' ? 18 : 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
    if (acts && acts.animate) acts.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 60, easing: 'ease-out', fill: 'backwards' });
  }

  function viewStep(st) {
    const it = st.item;
    const timed = isTimed(st);
    const m = M().MOVES[it.moveId] || {};
    const cue = (m.cues || [])[0];
    let target = '', actions = '', hint = '';
    if (P.phase === 'countdown' || P.phase === 'running') {
      const total = P.dur;
      target = `<div class="pl-timer">${U.ring(1, 'Time left', `<span class="pl-count rf-num">${P.phase === 'countdown' ? 3 : U.fmtDur(total)}</span>`, 'lg')}</div>`;
      actions = P.phase === 'countdown'
        ? '<button type="button" class="rf-btn rf-glass" data-size="lg" data-act="plCancelTimer">Cancel</button>'
        : `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plStopEarly">${st.kind === 'cooldown' || st.kind === 'interval' || st.kind === 'warmup' ? 'Skip' : 'Stop early'}</button>`;
    } else if (st.kind === 'test') {
      const prev = st.side && A().tests && A().tests[it.test] && A().tests[it.test][st.side === 'L' ? 'R' : 'L'];
      const last = (U.S.catchup[it.test].tests || []).slice(-1)[0];
      const def = prev || (last ? (st.side === 'L' ? last.left : last.right) : 10);
      target = `<div class="pl-target"><span class="pl-unit">Max reps</span></div><div class="pl-adjust">${U.stepper('plTest', def, 0, 200, 'Reps done')}</div>`;
      hint = `<p class="pl-hint t-callout rf-muted">${U.esc(it.load ? it.load.label + '. ' : '')}Same weight both sides, full range, stop when form breaks.</p>`;
      actions = '<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plSaveTest">Save</button>';
    } else if (timed) {
      const d = durationOf(st);
      target = `<div class="pl-target"><span class="pl-big rf-num">${d}</span><span class="pl-unit">seconds</span></div>`;
      if (st.kind === 'set') hint = `<p class="pl-hint t-callout rf-muted">${U.esc((GH.access && GH.access.setHint(U.S.profile, it, true)) || 'Hold with good form. Stop early if it breaks.')}</p>`;
      actions = `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plStartTimer">${U.icon('play')}Start</button>`;
    } else if (st.kind === 'set') {
      const t = B().currentTarget(A(), st);
      P.reps = t;
      const w = weightOf(it);
      target = `<div class="pl-target"><span class="pl-big rf-num">${t}</span><span class="pl-unit">${t === 1 ? 'rep' : 'reps'}</span></div>
        ${w ? `<button type="button" class="pl-load" data-act="plLoad" aria-label="Weight: ${U.esc(w.label)}. Change">${U.icon('dumbbell', 'sm')}<span class="rf-num">${U.esc(w.label)}</span>${U.icon('pencil', 'sm')}</button>` : ''}`;
      hint = w && w.first
        ? `<p class="pl-hint t-callout rf-muted">New exercise: pick a weight you could lift about ${t + 2} times. It's remembered for next time.</p>`
        : `<p class="pl-hint t-callout rf-muted">${st.leadOnly ? 'One set on this side only.' : U.esc((GH.access && GH.access.setHint(U.S.profile, it)) || 'Stop with 1-3 reps left in the tank.')}${st.first === false ? ' Match the first side, never more.' : ''}</p>`;
      actions = `<div class="pl-adjust"><span class="t-footnote rf-muted">Did fewer?</span>${U.stepper('plReps', t, 0, t, 'Reps done', 'data-on="plReps"')}</div>
        <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plDone">${U.icon('check')}Done set</button>`;
    } else {
      target = `<div class="pl-target"><span class="pl-big rf-num">${U.esc(st.target || it.target)}</span><span class="pl-unit">reps</span></div>`;
      actions = '<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plDone">Done</button>';
    }
    return `${top(P.mode === 'workout' ? U.S.active.session.title : 'Mobility flow')}
      <div class="pl-main">
        <p class="pl-eyebrow t-footnote rf-muted">${U.esc(eyebrow(st))}</p>
        <h1 class="pl-name">${U.esc(it.name)}</h1>
        ${sideLine(st)}
        <button type="button" class="pl-fig-card" data-act="plHowTo" aria-label="How to do ${U.esc(it.name)}"><div class="pl-fig" data-morph="keep"></div>${U.tempoHtml(m)}${!U.seen('playerHint') && P.phase === 'step' ? '<span class="pl-fig-hint t-caption">Tap for how-to</span>' : ''}</button>
        ${target}
        ${hint}
        ${cue && P.phase === 'step' && st.kind !== 'test' ? `<p class="pl-cue t-callout">${U.esc(cue)}</p>` : ''}
        <div class="pl-meta">${dots(st)}${it.load && it.load.label && st.kind !== 'test' && !weightOf(it) ? `<span class="t-footnote rf-muted">${U.esc(it.load.label)}</span>` : ''}</div>
      </div>
      <div class="pl-actions">${actions}</div>`;
  }

  function viewRest() {
    const next = cur();
    const done = P.justDone;
    const left = P.restEnd ? Math.max(0, (P.restEnd - Date.now()) / 1000) : 0;
    const rirQ = P.askRir ? `<div class="pl-rir">
        <p class="t-headline">How many more could you have done?</p>
        ${U.seg('plRir', [['0', '0'], ['12', '1-2'], ['3', '3'], ['4', '4+']], P.rirAnswered || '', 'Reps left in the tank', ' data-on="plRir" data-sync')}
        <p class="t-footnote rf-muted">${P.askRir.kind === 'finisher' ? 'For the whole finisher.' : `For ${U.esc(P.askRir.name.toLowerCase())}. This sets next time.`}${((U.S.seen || {}).rirCount || 0) < 3 ? ' Only count reps with good form. A rough guess is fine.' : ''}</p>
      </div>` : '';
    const logged = done && done.kind === 'set' ? loggedLine(done) : '';
    // The rest ran out (or was skipped) with the question still waiting: the ring stays where it was,
    // empty, and "Rest over" takes its buttons' place in the same row, so the question and what's up
    // next stay put under a finger that may be on its way to an answer.
    const over = !P.restEnd && P.restTotal > 0;
    const timerBlock = P.restEnd || over
      ? `<div class="pl-timer${over ? ' is-over' : ''}">${U.ring(over ? 0 : left / Math.max(1, P.restTotal), over ? 'Rest over' : 'Rest left', `<span class="pl-count rf-num">${U.fmtDur(left)}</span>`, 'lg', 'sky')}</div>
         <div class="pl-rest-btns">${over ? '<p class="t-headline pl-rest-over">Rest over</p>' : '<button type="button" class="rf-btn" data-act="plMore">+15 s</button><button type="button" class="rf-btn" data-act="plSkipRest">Skip rest</button>'}</div>`
      : '';
    const needCont = !P.restEnd && (P.askRir || !P.restTotal);
    // While a rest runs with the question asked, Continue's place is held (it comes once the rest is
    // over and the question still waits), so nothing above it moves when it does.
    const hold = !needCont && next && P.askRir ? '<span class="pl-actions-hold" aria-hidden="true"></span>' : '';
    return `${top(P.mode === 'workout' ? U.S.active.session.title : '')}
      <div class="pl-main pl-rest">
        <p class="pl-eyebrow t-footnote rf-muted">${P.restEnd || P.restTotal ? 'Rest' : 'Nice work'}</p>
        ${timerBlock}
        ${logged}
        ${rirQ}
        ${next ? `<button type="button" class="pl-next-row" data-act="plHowTo" aria-label="Up next, ${U.esc(next.item.name)}: how to do it"><div class="pl-fig pl-fig-sm" data-morph="keep"></div>${upNext(next)}<span class="pl-next-go" aria-hidden="true">${U.icon('chevron-right', 'sm')}</span></button>` : ''}
      </div>
      <div class="pl-actions">${needCont || !next ? `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plContinue">${next ? 'Continue' : 'Finish'}</button>` : hold}</div>`;
  }
  function loggedLine(st) {
    const log = A().logs[A().session.items.concat(A().session.extras).indexOf(st.item)];
    const last = log && log.sets[log.sets.length - 1];
    if (!last) return '';
    const at = last.load != null && st.item.load ? ` at ${B().fmtLoad(U.S, last.load, st.item.load.key, M().MOVES[st.item.moveId])}` : '';
    return `<p class="pl-logged t-callout">Logged ${U.esc(U.target(st.item, last.amount) + at)}${st.side ? ` (${U.side(st.side).toLowerCase()})` : ''} <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="plAmend">Change</button></p>`;
  }

  /* ---------------------------------------------------------------- timing */
  // Timer moments go through plat().cue: a beep (Sound) and a buzz (Vibration), which in the app with
  // haptics on is that moment's own haptic: countdown for each of the 3-2-1, go, and done at the end.
  function loop() {
    if (!P || root().hidden) return;
    const now = Date.now();
    const el = root();
    const setCount = (txt) => { const c = el.querySelector('.pl-count'); if (c && c.textContent !== txt) c.textContent = txt; };
    const setRing = (v) => { const r = el.querySelector('.rf-ring'); if (r) { r.style.setProperty('--rf-value', Math.max(0, Math.min(1, v)).toFixed(3)); r.setAttribute('aria-valuenow', String(Math.round(v * 100))); } };
    if (P.phase === 'countdown') {
      const s = Math.min(3, Math.ceil((P.goAt - now) / 1000)); // 3-2-1, however late a tick runs
      if (s > 0 && s !== P.lastCue) { plat().cue('countdown'); P.lastCue = s; }
      if (now >= P.goAt) { plat().cue('go'); P.phase = 'running'; P.startAt = now; P.endAt = now + P.dur * 1000; P.lastCue = null; draw(); return; }
      setCount(String(Math.max(1, s)));
      setRing(1);
    } else if (P.phase === 'running') {
      const left = (P.endAt - now) / 1000;
      const s = Math.ceil(left);
      if (left > 0 && s <= 3 && s !== P.lastCue) { plat().cue('countdown'); P.lastCue = s; }
      if (left <= 0) { plat().cue('done'); finishTimed(P.dur, true); return; }
      setCount(U.fmtDur(left));
      setRing(left / P.dur);
    } else if (P.phase === 'rest' && P.restEnd) {
      const left = (P.restEnd - now) / 1000;
      const s = Math.ceil(left);
      if (left > 0 && s <= 3 && s !== P.lastCue) { plat().cue('countdown'); P.lastCue = s; }
      if (left <= 0) {
        plat().cue('done');
        P.restEnd = null; P.lastCue = null;
        if (P.askRir && P.rirAnswered == null) { draw(); return; } // keep the question up
        endRest();
        return;
      }
      setCount(U.fmtDur(left));
      setRing(left / Math.max(1, P.restTotal));
    }
  }
  function startTimer() {
    const st = cur();
    if (!st) return;
    P.dur = durationOf(st);
    P.phase = 'countdown';
    P.goAt = Date.now() + 3000;
    P.lastCue = null;
    draw();
  }
  function endRest() {
    const next = cur();
    const auto = P.autoStart && next && next.kind === 'interval';
    P.phase = 'step'; P.askRir = null; P.rirAnswered = null; P.justDone = null; P.restTotal = 0; P.autoStart = false;
    if (!next) { if (P.mode === 'mobility') finishMobility(); else { P.phase = 'checkin'; draw(); } return; }
    if (auto) startTimer(); else draw();
  }
  // byTimer: the timer ran out, and its cue already buzzed (so nothing more here to cut it short);
  // also a skip, whose haptic comes after (Skip, below).
  function finishTimed(secs, byTimer) {
    const st = cur();
    if (!st) return;
    if (P.mode === 'mobility') {
      P.mob.idx++; P.phase = 'step';
      if (P.mob.idx >= P.mob.steps.length) finishMobility(byTimer);
      else { if (!byTimer) U.haptic('nav'); startTimer(); }
      return;
    }
    complete(st.kind === 'set' ? { secs: Math.round(secs) } : {}, byTimer);
  }
  // A step that starts the next hold's 3-2-1 at once (a mobility flow, a finisher round) has that
  // first beat as its feel: a haptic played over it would drop it.
  const counting = () => !!P && P.phase === 'countdown';
  U.act.plStartTimer = () => { plat().unlockAudio(); startTimer(); };
  U.act.plCancelTimer = () => { if (!P) return; U.haptic('back'); P.phase = 'step'; draw(); };
  // Stop early logs a timed set (setDone); on a warm-up, cool-down or finisher round it's Skip.
  U.act.plStopEarly = () => {
    const st = cur();
    const elapsed = P.phase === 'running' ? (Date.now() - P.startAt) / 1000 : 0;
    if (st && st.kind === 'set') { finishTimed(Math.max(1, Math.round(elapsed))); return; }
    finishTimed(0, true);
    if (!counting()) U.haptic('skip');
  };
  U.act.plMore = () => { if (P && P.restEnd) { P.restEnd += 15000; P.restTotal += 15; loop(); U.haptic('extend'); } };
  U.act.plSkipRest = () => {
    if (!P) return;
    P.restEnd = null;
    if (P.askRir && P.rirAnswered == null) draw(); else endRest();
    if (!counting()) U.haptic('skip');
  };
  // Continue: the next set (go), or the check-in after the last one (nav).
  U.act.plContinue = () => {
    endRest();
    if (P && P.phase === 'step') U.haptic('go');
    else if (P && P.phase === 'checkin') U.haptic('nav');
  };

  /* ---------------------------------------------------------------- completing steps */
  function complete(result, byTimer) {
    const S = U.S;
    const a = A();
    const st = a.steps[a.idx];
    // A timer that ran out has had its done cue. A tap gets setDone for a set or test it logged, and
    // nav for moving on past a warm-up, cool-down or finisher round.
    if (!byTimer) U.haptic(st.kind === 'set' || st.kind === 'test' ? 'setDone' : 'nav');
    const linesBefore = (a.testLines || []).length;
    B().completeStep(S, result);
    U.save();
    if ((a.testLines || []).length > linesBefore) U.toast(a.testLines[a.testLines.length - 1], 'neutral');
    const next = a.steps[a.idx];
    const rest = (st.kind === 'set' || st.kind === 'interval') ? (st.rest || 0) : 0;
    P.justDone = st;
    P.askRir = st.askRir ? st.item : null;
    P.rirAnswered = null;
    P.autoStart = st.kind === 'interval' && next && next.kind === 'interval';
    if (rest > 0 && next) {
      P.phase = 'rest'; P.restTotal = rest; P.restEnd = Date.now() + rest * 1000; P.lastCue = null;
    } else if (P.askRir) {
      P.phase = 'rest'; P.restTotal = 0; P.restEnd = null;
    } else if (!next) {
      P.phase = 'checkin';
    } else {
      // Switching sides has no buzz of its own: one here landed on top of the done or success
      // just played and cut it short. The screen says which side is next.
      P.phase = 'step';
      if (P.autoStart) { startTimer(); return; }
    }
    draw();
  }
  U.act.plDone = () => {
    const st = cur();
    if (!st) return;
    if (P.mode === 'mobility') { finishTimed(0); return; }
    if (st.kind === 'set' && !st.item.timed) {
      const input = root().querySelector('#plReps');
      const v = input ? parseInt(input.value, 10) : P.reps;
      complete({ reps: isFinite(v) ? Math.max(0, v) : P.reps });
    } else complete({});
  };
  // (A control in the player can still change as it's put away, once the workout is gone.)
  U.on.plReps = (el, ev, v) => { if (P) P.reps = v; };
  U.act.plSaveTest = () => {
    const input = root().querySelector('#plTest');
    const v = parseInt(input && input.value, 10);
    complete({ value: isFinite(v) ? Math.max(0, v) : 0 });
  };
  // Taken at once (data-sync on the control), not a frame later like other segmented controls: a
  // redraw in between (the rest ending, a toast) would draw the question with nothing picked.
  U.on.plRir = (el, ev, v) => {
    if (!P || !P.askRir) return;
    B().setRir(U.S, P.askRir, String(v));
    P.rirAnswered = String(v);
    U.S.seen = U.S.seen || {};
    U.S.seen.rirCount = (U.S.seen.rirCount || 0) + 1;
    U.save();
    // With the rest over, the answer stays on screen and Continue (right under it) moves on. Moving
    // on by itself would change the screen under a finger already on its way to Continue, and that
    // tap would land on the next set's Done and log it. The screen is redrawn once the thumb has
    // landed.
    if (!P.restEnd) setTimeout(() => { if (P && P.rirAnswered === String(v)) draw(); }, 280);
  };
  U.act.plAmend = () => {
    const st = P.justDone;
    const a = A();
    if (!st || !a) return;
    const log = a.logs[a.session.items.concat(a.session.extras).indexOf(st.item)];
    const last = log && log.sets[log.sets.length - 1];
    if (!last) return;
    const loaded = last.load != null && weightOf(st.item);
    P.amendLoad = loaded ? last.load : null;
    U.sheet({
      title: 'Change what you logged', size: 'fit',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">${U.esc(st.item.name)}${st.side ? `, ${U.side(st.side).toLowerCase()}` : ''}</p><div class="ob-center">${U.stepper('amendVal', last.amount, 0, Math.max(last.target, last.amount) + 20, st.item.timed ? 'Seconds' : 'Reps')}</div>
        ${loaded ? `<p class="t-footnote rf-muted load-label">Weight</p>${loadChips(st.item, last.load, 'plAmendLoad')}` : ''}</div>`,
      action: { label: 'Save', act: 'plAmendSave' },
    });
  };
  U.on.plAmendLoad = (el, ev, v) => { if (P && isFinite(parseFloat(v))) P.amendLoad = parseFloat(v); };
  U.act.plAmendSave = () => {
    const input = document.getElementById('amendVal');
    const v = parseInt(input && input.value, 10);
    B().amendLast(U.S, isFinite(v) ? v : null, P.amendLoad);
    U.save();
    U.haptic('save');
    P.amendLoad = null;
    const top = U.topSheet(); if (top) top.close('ok');
    draw();
  };

  // Weight choices around the current one, as chips, plus "Other" for anything else.
  function loadChips(it, curKg, act) {
    const choices = B().loadChoices(U.S, Object.assign({}, it, { curLoad: curKg }), A().day);
    // Picking a weight to use closes its sheet, the one it's on too (data-repick).
    const now = choices.find((c) => Math.abs(c.kg - curKg) < 1e-6);
    return `<div class="load-chips">${U.choice(act, choices.map((c) => [c.kg, c.label]), now ? now.kg : '', 'Weight', ` data-on="${act}"${act === 'plLoadPick' ? ' data-repick' : ''}`)}</div>
      <div class="ob-add"><input class="rf-input" type="number" inputmode="decimal" id="plLoadOther" placeholder="Other weight (${U.wUnit()})" aria-label="Other weight"><button type="button" class="rf-btn" data-size="sm" data-act="plLoadOther" data-arg="${act}">Use</button></div>`;
  }
  U.act.plLoad = () => {
    const st = cur();
    const w = st && weightOf(st.item);
    if (!w) return;
    U.sheet({
      title: 'Weight', size: 'auto',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">${U.esc(st.item.name)}. ${w.first ? `A first guess. Pick one you could lift about ${B().currentTarget(A(), st) + 2} times.` : 'For the rest of this exercise.'}</p>${loadChips(st.item, w.kg, 'plLoadPick')}</div>`,
    });
  };
  U.on.plLoadPick = (el, ev, v) => {
    const st = cur();
    if (!st || !isFinite(parseFloat(v))) return;
    B().setItemLoad(U.S, st.item, parseFloat(v));
    U.save();
    const top = U.topSheet(); if (top) top.close('ok');
    draw();
  };
  U.act.plLoadOther = (el) => {
    const input = document.getElementById('plLoadOther');
    const v = parseFloat(input && input.value);
    if (!(v > 0 && v < 1000)) { U.haptic('deny'); U.toast('Enter a weight like 60', 'caution'); return; }
    const kg = B().fromUnit(v, U.wUnit());
    if (el.dataset.arg === 'plAmendLoad') { P.amendLoad = kg; U.act.plAmendSave(); return; }
    const st = cur();
    if (st) B().setItemLoad(U.S, st.item, kg);
    U.save();
    U.haptic('save');
    const top = U.topSheet(); if (top) top.close('ok');
    draw();
  };

  /* ---------------------------------------------------------------- options: how to, swap, skip, end */
  U.act.plHowTo = () => {
    const st = cur();
    if (!st) return;
    covered = true;
    if (fig) fig.ctl.pause();
    const sh = U.moveSheet(st.item.moveId, { side: st.side, onClose: () => { covered = false; if (P && !root().hidden) draw(); } });
    if (!sh) { covered = false; if (fig) fig.ctl.play(); } // no sheet opened: keep the figure going
  };
  // The workout's options: a menu that grows out of its button (U.menu). Cancel asks first.
  U.act.plMenu = (el) => {
    const st = cur();
    const canSwap = st && st.kind === 'set' && !st.leadOnly;
    const items = st ? [
      { act: 'plHowTo', icon: 'info', label: 'How to do it' },
      canSwap ? { act: 'plSwap', icon: 'shuffle', label: 'Swap this exercise' } : false,
      st.kind === 'set' ? { act: 'plSkipItem', icon: 'skip-forward', label: 'Skip remaining sets' } : false,
      null,
    ] : [];
    items.push({ act: 'plFinishNow', icon: 'flag', label: 'Finish now and check in' }, { act: 'plCancel', icon: 'close', label: 'Cancel workout', tone: 'critical' });
    U.menu(el && el.closest ? el : document.querySelector('.player [data-act="plMenu"]'), items, { label: 'Workout options' });
  };
  U.act.plSwap = () => {
    const st = cur();
    if (!st) return;
    const top = U.topSheet(); if (top) top.close('swap');
    const opts = B().swapOptions(U.S, st.item, U.today());
    U.sheet({
      title: 'Swap exercise', size: 'auto',
      // A tap swaps at once, so the rows carry no chevron (that promises another page).
      body: opts.length ? `<ul class="rf-list">${opts.map((o) => U.row({ title: U.esc(o.name), sub: U.esc(o.why), act: 'plSwapTo', arg: o.id })).join('')}</ul>
        <ul class="rf-list sheet-gap">${U.row({ icon: 'eye', tone: 'rose', title: 'Don\'t show this move again', sub: 'Swaps it out now and keeps it out of future plans', act: 'plExclude', arg: opts[0].id })}</ul>`
        : '<p class="sheet-pad t-callout rf-muted">No other move fits your equipment.</p>',
    });
  };
  function swapTo(id, exclude) {
    const st = cur();
    if (!st) return;
    if (exclude && !U.S.excluded.includes(st.item.moveId)) U.S.excluded.push(st.item.moveId);
    B().swapItem(U.S, st.item, id);
    U.save();
    const top = U.topSheet(); if (top) top.close('ok');
    P.phase = 'step';
    draw();
    U.haptic('swap');
    U.toast(`Swapped to ${M().MOVES[id].name.toLowerCase()}`, 'neutral');
  }
  U.act.plSwapTo = (el) => swapTo(el.dataset.arg, false);
  U.act.plExclude = (el) => swapTo(el.dataset.arg, true);
  U.act.plSkipItem = () => {
    const st = cur();
    const a = A();
    if (!st || !a) return;
    a.steps = a.steps.filter((s, k) => k < a.idx || s.item !== st.item);
    U.save();
    const top = U.topSheet(); if (top) top.close('ok');
    P.phase = 'step';
    draw();
    U.haptic('skip');
  };
  U.act.plFinishNow = () => { const top = U.topSheet(); if (top) top.close('ok'); if (!P) return; U.haptic('nav'); P.phase = 'checkin'; draw(); };
  U.act.plDiscard = U.act.plCancel; // 1.2's name for it

  /* ---------------------------------------------------------------- check-in */
  function counts() {
    const a = A();
    const planned = a.session.items.reduce((x, it) => x + it.sets, 0) + a.session.extras.length;
    const doneSets = a.logs.reduce((x, l) => x + new Set(l.sets.map((s) => s.set + (l.kind === 'extra' ? 'x' : ''))).size, 0);
    return { planned, doneSets };
  }
  function viewCheckin() {
    if (!P.ck) P.ck = { rating: 'right', complicated: false, pain: [], weight: null };
    const { planned, doneSets } = counts();
    const pct = planned ? doneSets / planned : 1;
    const ck = P.ck;
    // A flare day (gentle range of motion only) has no sets to rate.
    const flare = !!(A() && A().session && A().session.flare);
    return `${top('Check-in')}
      <div class="pl-scroll">
        <h1 class="rf-large-title">Check-in</h1>
        <p class="t-callout rf-muted pl-pad">${flare ? 'A gentle day done. It counts for your streak.' : `${doneSets} of ${planned} sets done.${pct < 0.5 ? ' Under half, so it\'s saved but won\'t count for your streak.' : ''}`}</p>
        ${flare ? '' : `<div class="ob-group"><h3 class="rf-list-header">How was it?</h3><div class="ob-pad">${U.seg('ckRating', [['easy', 'Too easy'], ['right', 'About right'], ['hard', 'Too hard']], ck.rating, 'How was it', ' data-on="ckRating"')}</div></div>
        <div class="ob-group"><h3 class="rf-list-header">Too complicated?</h3><div class="ob-pad">${U.seg('ckComplicated', [['false', 'No'], ['true', 'Yes, simpler please']], String(ck.complicated), 'Too complicated', ' data-on="ckComplicated"')}</div></div>`}
        <div class="ob-group"><h3 class="rf-list-header">Anything hurt?</h3><div class="ob-chips">${JOINTS.map(([id, t]) => U.chip(t, ck.pain.includes(id), `data-on="ckPain" data-v="${id}"`)).join('')}</div><p class="rf-list-footer">Moves that load it get swapped out for two weeks.</p></div>
        <div class="ob-group"><h3 class="rf-list-header">Weight today (optional)</h3><div class="ob-fields"><div class="rf-field"><div class="rf-field-control"><input class="rf-input" type="number" inputmode="decimal" placeholder="${U.wUnit()}" aria-label="Weight in ${U.wUnit()}" data-on="ckWeight" value="${ck.weight == null ? '' : ck.weight}"></div></div></div></div>
      </div>
      <div class="pl-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plSaveCheckin">Save check-in</button></div>`;
  }
  U.on.ckRating = (el, ev, v) => { P.ck.rating = v; };
  U.on.ckComplicated = (el, ev, v) => { P.ck.complicated = v === 'true'; };
  U.on.ckPain = (el, ev, v) => { const id = el.dataset.v; P.ck.pain = P.ck.pain.filter((x) => x !== id); if (v) P.ck.pain.push(id); };
  U.on.ckWeight = (el, ev, v) => { P.ck.weight = v > 0 ? v : null; };
  U.act.plSaveCheckin = () => {
    // The workout's own finish plays on the tap, before the saving and the Next screen's drawing
    // (they took 400 ms on a slow phone, the buzz with them).
    U.haptic('workoutDone');
    const tapped = Date.now();
    const S = U.S;
    const ck = P.ck || {};
    const before = B().calendar(S, A().day).streak.current;
    const res = B().finishWorkout(S, { rating: ck.rating, complicated: ck.complicated, pain: ck.pain, weightKg: ck.weight ? U.toKg(ck.weight) : null, now: Date.now() });
    S.pendingLines = res ? res.lines : [];
    if (U.markSeen) U.markSeen('playerHint');
    // Badges this workout earned (and any not shown yet): the Next screen shows them itself.
    const fresh = U.badgeCheck ? U.badgeCheck('workout') : [];
    U.save(true);
    P.result = res; P.ck = null; P.streakFrom = before; P.ach = fresh;
    P.phase = 'next';
    plat().keepAwake(false);
    draw();
    // Saved to Health Connect (when allowed), then a fresh read so today's numbers catch up.
    if (res && res.entry && GH.health && GH.health.writeWorkout(S, res.entry)) setTimeout(() => U.syncHealth('manual'), 2500);
    const el = root();
    const big = res && (res.celebrate.length || fresh.length);
    // Once the finish is over, the biggest thing the workout brought: a personal best, or a harder
    // move or heavier weight. New badges play their own as their card springs.
    const kinds = res && res.celebrate ? res.celebrate.map((c) => c.kind) : [];
    const then = kinds.includes('pr') ? 'pr' : kinds.includes('level') || kinds.includes('weight') ? 'levelUp' : null;
    if (then) setTimeout(() => U.haptic(then), Math.max(0, 700 - (Date.now() - tapped)));
    if (big && G.Refract && G.Refract.burst && !U.reduced()) {
      // Each burst within Refract 1.4's 8 to 14 beads: one card gets 14, several get 8 each, three at
      // most.
      setTimeout(() => { const cards = Array.from(el.querySelectorAll('.celebrate')); for (const c of cards.slice(0, 3)) { try { G.Refract.burst(c, { count: cards.length > 1 ? 8 : 14 }); } catch (e) { /* ignore */ } } }, 350);
    }
    const n = el.querySelector('.streak-roll');
    if (n && G.Refract && G.Refract.roll && !U.reduced()) setTimeout(() => { try { G.Refract.roll(n, n.dataset.to, { from: n.dataset.from, dir: 1 }); } catch (e) { /* ignore */ } }, 250);
    if (fresh.length && U.badgeSpring) U.badgeSpring(el);
  };

  function viewNext() {
    const res = P.result || { lines: [], celebrate: [], done: true };
    const S = U.S;
    const streak = B().calendar(S, U.today()).streak.current;
    const lines = res.lines.filter((l) => l && l.text);
    return `${top('Done')}
      <div class="pl-scroll">
        <h1 class="rf-large-title">Next time</h1>
        ${res.done ? `<p class="t-callout pl-pad">Streak <span class="streak-roll rf-num t-headline" data-from="${P.streakFrom || 0}" data-to="${streak}">${streak}</span> ${streak === 1 ? 'day' : 'days'}</p>` : '<p class="t-callout rf-muted pl-pad">Saved. Under half the sets, so it doesn\'t count for your streak.</p>'}
        ${res.celebrate.map((c) => `<div class="card celebrate">${U.icon(c.kind === 'pr' ? 'star' : c.kind === 'weight' ? 'bolt' : 'sparkle')}<span class="t-headline">${U.esc(c.text)}</span></div>`).join('')}
        ${U.badgeCard ? U.badgeCard(P.ach) : ''}
        ${U.hcInvite ? U.hcInvite(S) : ''}
        ${lines.length ? `<ul class="rf-list next-lines">${lines.map((l) => U.row({ title: U.nb(l.text), sub: l.why ? U.esc(U.cap(l.why)) : '', icon: l.buy ? 'bag' : /Deload|less/.test(l.text) ? 'moon' : 'arrow-up-right', tone: l.buy ? 'amber' : /Deload|less|Eat/.test(l.text) ? 'indigo' : 'green' })).join('')}</ul>` : '<p class="t-callout rf-muted pl-pad">Same targets next time. Keep it up.</p>'}
        ${lines.length && U.whyLink ? `<p class="pl-pad">${U.whyLink('overload', 'How the plan decides this')}</p>` : ''}
      </div>
      <div class="pl-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plClose">Done</button></div>`;
  }
  U.act.plClose = () => { U.haptic('dismiss'); closeDone(); };

  /* ---------------------------------------------------------------- mobility */
  function finishMobility(byTimer) {
    const S = U.S;
    const day = U.today();
    B().logLight(S, day, 'mobility', true);
    U.save(true);
    P.phase = 'mobdone';
    const l = S.log.find((x) => x.type === 'light' && x.day === day);
    P.lightDone = !!(l && l.walk && l.mobility);
    plat().keepAwake(false);
    dropFig();
    draw();
    // After the last hold's done buzz when the timer ended it, so the two play one after the other.
    if (byTimer) setTimeout(() => U.haptic('workoutDone'), 450); else U.haptic('workoutDone');
    // Badges it earned (ten sessions, a streak kept going), told once that buzz is over.
    if (U.badgeCheck) setTimeout(() => U.badgeCheck('mobility'), 900);
  }
  function viewMobDone() {
    return `${top('Mobility')}
      <div class="pl-scroll"><h1 class="rf-large-title">Mobility done</h1>
        <p class="t-callout pl-pad">${P.lightDone ? 'Walk and mobility both done: today counts for your streak.' : 'Add a walk to make today count for your streak.'}</p></div>
      <div class="pl-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="xl" data-act="plClose">Done</button></div>`;
  }

  // Opening the app mid-workout.
  U.resumePrompt = () => {
    const a = A();
    if (!a) return;
    if (a.day === U.today()) U.toast('Workout in progress', 'neutral', `${a.session.title}`, { label: 'Resume', onClick: () => { U.haptic('go'); U.openPlayer(); } });
  };
})(typeof window !== 'undefined' ? window : globalThis);
