/* The AI plan review's sheets (GH.planReview, src/planreview.js):
 *  - "Why this plan" (U.act.whyPlan): the planner's own account, no AI needed. The headline, how
 *    many weekly plans it compared, its reasons, the score's parts as meters, and the classic splits
 *    it weighed against this one, each with why it lost (and a way to try it, checked first).
 *  - "Coach's review" (U.openReview, U.act.reviewPlan): the on-device model or Claude looks the plan
 *    over. While it thinks: what it's doing, how far along, and Stop. Then one card per suggestion
 *    that passed the engine's checks (its title, why, what it changes and the score's change in
 *    words, with a switch that starts on), "Apply selected" with undo, and what wasn't applied and
 *    why. With no AI set up, the ways to get one, and Why this plan.
 *  - The weekly report's "Plan ideas" (U.planIdeas): Claude's suggestions from the report, opened in
 *    the same review.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const R = () => GH.planReview;
  const AI = () => GH.ai;
  const pct = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100);
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /* ================================================================== why this plan */
  // Each part of the score, in its own hue.
  const PART_HUE = { goal: 'violet', coverage: 'teal', time: 'sky', recovery: 'green', balance: 'amber', variety: 'coral' };
  function meter(p) {
    const v = pct(p.value);
    return `<li class="wy-meter" style="--v:${(v / 100).toFixed(3)};--c:var(--hue-${PART_HUE[p.key] || 'sky'})">
      <span class="wy-m-name">${U.esc(p.name)}<span class="wy-m-w">${Math.round(p.weight * 100)}%</span></span>
      <span class="wy-m-n rf-num">${v}</span>
      <span class="wy-m-bar" role="meter" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100" aria-label="${U.esc(`${p.name}: ${v} out of 100`)}"><i></i></span>
      <span class="wy-m-about">${U.esc(p.about)}</span>
    </li>`;
  }
  function weekDays(days) {
    return `<span class="wy-days">${days.map((d) => `<span class="wy-day" data-label="${U.esc(d.label)}"><b>${U.esc(d.wd)}</b><span>${U.esc(d.label)}</span></span>`).join('')}</span>`;
  }
  function altRow(a, current) {
    return `<li class="wy-alt${current ? ' is-current' : ''}" data-key="alt-${U.esc(a.split)}">
      <div class="wy-alt-top"><span class="wy-alt-name">${U.esc(a.name)}</span>${current ? U.badge('Your plan', 'accent') : ''}<span class="wy-alt-score" aria-label="${U.esc(`Scores ${pct(a.score)} out of 100`)}"><b class="rf-num">${pct(a.score)}</b></span></div>
      ${weekDays(a.days)}
      ${current ? '' : `<p class="wy-alt-note">${U.esc(a.note)}</p>`}
      ${current || a.same ? '' : `<button type="button" class="rf-btn wy-try" data-variant="soft" data-size="sm" data-act="whyTry" data-arg="${U.esc(a.split)}" data-name="${U.esc(a.name)}">Try it</button>`}
    </li>`;
  }
  function whyBody(w) {
    const score = pct(w.score);
    const compared = w.considered > 1
      ? `<p class="wy-compared">${U.icon('layers', 'sm')}<span>We compared <b class="rf-num">${fmtN(w.considered)}</b> weekly plans and picked this one.</span></p>`
      : `<p class="wy-compared">${U.icon('layers', 'sm')}<span>This week keeps the plan it started with.</span></p>`;
    return `<div class="sheet-pad wy">
      <div class="card wy-hero" data-key="hero">
        <div class="wy-hero-top">
          ${U.ring(w.score, `Plan score: ${score} out of 100`, `<span class="wy-ring-n rf-num">${score}</span>`, 'lg', 'accent')}
          <div class="wy-hero-text"><p class="wy-headline">${U.esc(w.headline)}</p><p class="t-footnote rf-muted">${U.esc(w.custom ? 'The coach\'s plan, which you can go back to, is scored below.' : `${w.current.name}. Plan score ${score} out of 100.`)}</p></div>
        </div>
        ${compared}
      </div>
      <h3 class="wy-h">How it scores</h3>
      <ul class="wy-meters" data-key="meters">${w.parts.map(meter).join('')}</ul>
      <p class="t-footnote rf-muted wy-foot">Each plan is scored out of 100. The percentages are how much each part counts.</p>
      <h3 class="wy-h">Why it's built this way</h3>
      <ul class="wy-reasons" data-key="reasons">${w.reasons.map((r) => `<li>${U.icon('check-circle', 'sm')}<span>${U.esc(r)}</span></li>`).join('')}</ul>
      <h3 class="wy-h">Other ways to split your week</h3>
      <ul class="wy-alts" data-key="alts">${altRow(w.current, true)}${w.others.map((a) => altRow(a, false)).join('')}</ul>
      <p class="t-footnote rf-muted wy-foot">Trying one checks it against your plan's rules first, and you can undo it.</p>
      ${U.act.reviewPlan ? `<button type="button" class="rf-btn ob-wide wy-ai" data-variant="soft" data-size="lg" data-act="reviewPlan" data-arg="why">${U.icon('sparkle')}Check my plan with AI</button>` : ''}
    </div>`;
  }
  let whyCtl = null;
  U.act.whyPlan = () => {
    const S = U.S;
    if (!S || !R()) return;
    let w;
    try { w = R().why(S, U.today()); } catch (e) { if (G.console) G.console.error(e); U.toast('Couldn\'t explain the plan', 'caution'); return; }
    if (whyCtl && !whyCtl.closed) whyCtl.close('ok');
    whyCtl = U.sheet({ title: 'Why this plan', size: 'auto', cls: 'why-sheet', body: whyBody(w), onClose: () => { whyCtl = null; } });
  };
  // Another split from Why this plan: the review checks it like any suggestion, with its own diff,
  // score and undo.
  U.act.whyTry = (el) => {
    const split = el.dataset.arg;
    const name = el.dataset.name || '';
    if (!R() || !R().SPLITS.includes(split)) return;
    const title = split === 'auto' ? 'Let the planner pick your split' : `Switch to ${name.toLowerCase()}`;
    if (whyCtl && !whyCtl.closed) whyCtl.close('ok');
    setTimeout(() => R().open('why', { engine: 'app', suggestions: [{ kind: 'split', split, title, why: '' }] }), 300);
  };

  /* ================================================================== the coach's review */
  // The sheet's state: { ctl, source, step, engine, review, picked (ids), status, value, error,
  // ctrl, startedAt, models (the on-device sizes shown), timer }. Steps: 'start' (getting ready),
  // 'none' (no AI set up), 'busy', 'stopped', 'error', 'custom' (their own plan), 'off' (workouts
  // off), 'result'.
  let rv = null;
  const STATUS = { loading: 'Starting the on-device coach', reading: 'Reading your plan', writing: 'Writing its suggestions', asking: 'Looking over your plan' };
  const WRITE_CHARS = 700; // about how long an answer runs, for the progress bar
  // How far along an on-device review is: loading the model, reading the plan, then writing.
  function progressOf(st) {
    if (st.status === 'loading') return 0.04 + 0.32 * (st.value || 0);
    if (st.status === 'reading') return 0.38 + 0.26 * (st.value || 0);
    if (st.status === 'writing') return 0.66 + 0.32 * Math.min(1, (st.value || 0) / WRITE_CHARS);
    return 0.02;
  }
  const elapsed = (st) => Math.max(0, Math.round((Date.now() - (st.startedAt || Date.now())) / 1000));
  function statusLine(st) {
    const base = STATUS[st.status] || STATUS.asking;
    const f = st.engine === 'device' ? ` ${pct(progressOf(st))}%` : '…';
    return `${base}${f} · ${elapsed(st)} s`;
  }
  const engineName = (e) => (e === 'claude' ? 'Claude' : e === 'device' ? 'the on-device coach' : 'the planner');

  function waitBody(st) {
    const device = st.engine === 'device';
    return `<div class="sheet-pad rv rv-wait" data-key="wait">
      <span class="rv-orb" aria-hidden="true">${U.icon(device ? 'chip' : 'sparkle')}</span>
      <p class="t-headline">${device ? 'The on-device coach is checking your plan' : 'Claude is checking your plan'}</p>
      <p class="t-callout rf-muted rv-status" aria-live="polite">${U.esc(statusLine(st))}</p>
      <div class="rv-bar"${device ? '' : ' data-indeterminate'}>${U.progress(device ? progressOf(st) : 0.3, 'How far the review has got')}</div>
      <p class="t-footnote rf-muted">${device ? 'On a phone this takes about a minute. Keep the app open; nothing leaves your phone.' : 'This usually takes under a minute.'}</p>
      <button type="button" class="rf-btn rv-stop" data-size="lg" data-act="reviewStop">${U.icon('stop')}Stop</button>
    </div>`;
  }
  function optionsBody(S) {
    const d = U.deviceState ? U.deviceState() : null;
    const ready = R().engine(S);
    const hasKey = !!(AI() && AI().hasKey());
    const claudeSub = !hasKey ? 'With your own Anthropic API key' : !S.ai.consentAt ? 'Allow Claude to get your summary first' : 'Ready';
    const deviceSub = d && d.checked && !d.available.ok ? d.available.reason : 'Runs on this phone and works offline. A one-time download.';
    return `<div class="sheet-pad rv rv-none">
      <div class="rv-intro">
        <span class="rv-orb" aria-hidden="true">${U.icon('check-circle')}</span>
        <p class="t-headline">A second opinion on your plan</p>
        <p class="t-callout rf-muted">The planner already compared every way to lay out your week. An AI coach can look it over too and suggest changes. Each one is checked against your plan's rules, and nothing changes until you approve it.</p>
      </div>
      ${ready ? `<button type="button" class="rf-btn rf-glass ob-wide" data-variant="tinted" data-size="lg" data-act="reviewStart">${U.icon('sparkle')}Check my plan now</button>` : ''}
      <ul class="rf-list rv-options" data-key="options">
        ${U.row({ key: 'device', icon: 'chip', tone: 'violet', title: 'Get the on-device coach', sub: U.esc(deviceSub), act: 'reviewModels', chevron: !st0().models })}
        ${st0().models && U.modelRows ? `<li class="rv-models" data-key="models"><ul class="rf-list">${U.modelRows(S, { compact: true })}</ul></li>` : ''}
        ${U.row({ key: 'claude', icon: 'sparkle', tone: 'indigo', title: 'Use Claude', sub: U.esc(claudeSub), act: 'reviewClaude', chevron: true })}
        ${U.row({ key: 'why', icon: 'layers', tone: 'sky', title: 'Why this plan', sub: 'What the planner weighed. No AI needed.', act: 'whyPlan', chevron: true })}
      </ul>
    </div>`;
  }
  const st0 = () => rv || {};
  function noteBody(icon, title, text, extra) {
    return `<div class="sheet-pad rv rv-msg">
      <div class="rv-intro"><span class="rv-orb" aria-hidden="true">${U.icon(icon)}</span><p class="t-headline">${U.esc(title)}</p><p class="t-callout rf-muted">${U.esc(text)}</p></div>
      ${extra || ''}
      <div class="rv-more btn-row"><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="whyPlan">${U.icon('layers', 'sm')}Why this plan</button></div>
    </div>`;
  }
  function card(it, on) {
    return `<li class="card rv-card" data-key="rv-${U.esc(it.id)}" data-kind="${U.esc(it.kind)}"${on ? '' : ' data-off'}>
      <div class="rv-card-top"><span class="rf-list-icon rv-ico" data-tone="${U.esc(it.tone)}">${U.icon(it.icon)}</span>${U.sw(it.title, on, `data-on="reviewPick" data-k="${U.esc(it.id)}"`, it.why || '')}</div>
      ${it.diff && it.diff.length ? `<ul class="rv-diff">${it.diff.map((l) => `<li>${U.esc(l)}</li>`).join('')}</ul>` : ''}
      <p class="rv-score" data-dir="${U.esc(it.score.dir)}">${U.icon(it.score.dir === 'up' ? 'arrow-up-right' : it.score.dir === 'down' ? 'minus' : 'check', 'sm')}<span>${U.esc(it.score.text)}</span></p>
    </li>`;
  }
  const applyLabel = (n, all) => (n === 0 ? 'Pick a change to apply' : n === all ? (n === 1 ? 'Apply this change' : `Apply all ${n}`) : `Apply ${n} selected`);
  function resultBody(st) {
    const r = st.review;
    const n = r.items.filter((x) => st.picked.has(x.id)).length;
    const ago = U.ago ? U.ago(r.at) : '';
    const head = `<div class="rv-head" data-key="head">
      <span class="rv-by" data-engine="${U.esc(r.engine)}">${U.icon(r.engine === 'claude' ? 'sparkle' : r.engine === 'device' ? 'chip' : 'layers', 'sm')}${U.esc(r.engine === 'app' ? 'Checked by the planner' : `Checked by ${engineName(r.engine)}${ago ? ` · ${ago}` : ''}`)}</span>
      ${r.note ? `<p class="t-callout rv-note">${U.esc(r.note)}</p>` : ''}
      ${r.cut ? '<p class="t-footnote rf-muted rv-cut">Left out a line with a number that isn\'t in your data.</p>' : ''}
    </div>`;
    const empty = !r.items.length ? `<div class="card rv-empty" data-key="empty">${U.icon('check-circle')}<p class="t-headline">${r.rejected.length ? 'Nothing to apply' : 'Your plan already fits'}</p><p class="t-callout rf-muted">${r.rejected.length ? 'What it suggested didn\'t pass your plan\'s checks. The reasons are below.' : 'The coach found nothing worth changing.'}</p></div>` : '';
    const cards = r.items.length ? `<ul class="rv-cards" data-key="cards">${r.items.map((it) => card(it, st.picked.has(it.id))).join('')}</ul>` : '';
    const tips = r.tips.length ? `<div class="rv-tips" data-key="tips"><p class="rv-h">Tips</p>${r.tips.map((t) => `<div class="rv-tip">${U.icon('sparkle', 'sm')}<span><b>${U.esc(t.title)}</b>${t.why ? ` ${U.esc(t.why)}` : ''}</span></div>`).join('')}</div>` : '';
    const not = r.rejected.length ? `<details class="rv-not gh-drop" data-key="not"><summary><span>Not applied (${r.rejected.length})</span>${U.icon('chevron-down', 'sm')}</summary><ul>${r.rejected.map((x) => `<li><span class="rv-not-title">${U.esc(x.title)}</span><span class="rv-not-why">${U.esc(x.reason)}</span></li>`).join('')}</ul></details>` : '';
    const apply = r.items.length ? `<div class="rv-actions" data-key="actions"><button type="button" class="rf-btn rf-glass ob-wide rv-apply" data-variant="tinted" data-size="lg" data-act="reviewApply"${n ? '' : ' aria-disabled="true"'}>${U.esc(applyLabel(n, r.items.length))}</button>
      <p class="t-footnote rf-muted">Each change passed your plan's checks: your equipment and joints, your time, every muscle's weekly minimum and rest between sessions. Nothing changes until you apply it, and you can undo it.</p></div>` : '';
    return `<div class="sheet-pad rv rv-result">${head}${cards}${empty}${tips}${not}${apply}
      <div class="rv-more btn-row" data-key="more">${r.engine !== 'app' && R().engine(U.S) ? `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="reviewAgain">${U.icon('refresh', 'sm')}Ask again</button>` : ''}<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="whyPlan">${U.icon('layers', 'sm')}Why this plan</button></div>
    </div>`;
  }
  function body() {
    const st = rv;
    if (!st) return '';
    switch (st.step) {
      case 'busy': return waitBody(st);
      case 'none': return optionsBody(U.S);
      case 'stopped': return noteBody('stop', 'Stopped', 'Nothing in your plan changed.', `<button type="button" class="rf-btn ob-wide" data-variant="soft" data-size="lg" data-act="reviewAgain">${U.icon('refresh')}Try again</button>`);
      case 'error': return `<div class="sheet-pad rv rv-msg"><div class="notice" data-tone="critical" data-key="error">${U.icon('alert')}<span>${U.esc(st.error || 'Something went wrong.')}</span></div>
        <button type="button" class="rf-btn ob-wide" data-variant="soft" data-size="lg" data-act="reviewAgain">${U.icon('refresh')}Retry</button>
        <div class="rv-more btn-row"><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="whyPlan">${U.icon('layers', 'sm')}Why this plan</button></div></div>`;
      // Their own plan: the coach can rework it (Improve, src/ui/customplan.js) rather than check it.
      case 'custom': return noteBody('list', 'You\'re following your own plan', 'The review checks the coach\'s plan. Your own can be improved instead: the coach reworks it from your data and shows you what it would change.', `${U.act.cpImprove && GH.customPlan && GH.customPlan.activeId(U.S) ? `<button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="reviewImprove">${U.icon('sparkle')}Improve my plan</button>` : ''}${U.act.openPlans ? `<button type="button" class="rf-btn ob-wide" data-variant="soft" data-size="lg" data-act="reviewPlans">${U.icon('list')}Your plans</button>` : ''}`);
      case 'off': return noteBody('info', 'Workouts are off', 'Turn workouts on in Settings, under What you track, to get a plan to check.');
      case 'result': return resultBody(st);
      default: return `<div class="sheet-pad rv rv-wait" data-key="start"><span class="rf-spinner" data-size="sm"><i></i></span><p class="t-callout rf-muted">Getting the coach ready…</p></div>`;
    }
  }
  const draw = () => { if (rv && rv.ctl && !rv.ctl.closed) rv.ctl.update(body()); };
  // While it thinks, only the status line and the bar change (several times a second).
  function tick() {
    if (!rv || rv.step !== 'busy' || !rv.ctl || rv.ctl.closed) return;
    const el = rv.ctl.el;
    const line = el.querySelector('.rv-status');
    if (!line) { draw(); return; }
    const t = statusLine(rv);
    if (line.textContent !== t) line.textContent = t;
    const bar = el.querySelector('.rv-bar .rf-progress');
    if (bar && rv.engine === 'device') { const f = progressOf(rv); bar.style.setProperty('--rf-value', f.toFixed(3)); bar.setAttribute('aria-valuenow', String(pct(f))); }
  }
  let tickFrame = 0;
  const tickSoon = () => { if (!tickFrame && G.requestAnimationFrame) tickFrame = G.requestAnimationFrame(() => { tickFrame = 0; tick(); }); };
  function stopTimer(st) { if (st && st.timer) { clearInterval(st.timer); st.timer = 0; } }

  // Opens the sheet (GH.planReview.open). o: { engine: 'app', suggestions, note, model } to check
  // suggestions already made (Why this plan, the weekly report's ideas) instead of asking an AI.
  U.openReview = (source, o) => {
    const S = U.S;
    if (!S || !S.profile || !R()) return null;
    const opt = o || {};
    if (rv && rv.ctl && !rv.ctl.closed) rv.ctl.close('ok');
    const me = rv = { source: source || 'plan', step: 'start', picked: new Set(), engine: null };
    me.ctl = U.sheet({
      title: 'Coach\'s review', size: 'auto', cls: 'rv-sheet', body: body(),
      // Closing stops a review in progress: nothing is left running.
      onClose: () => { stopTimer(me); if (me.step === 'busy') halt(me); if (rv === me) rv = null; },
    });
    const day = U.today();
    if (S.profile.workouts === false) { me.step = 'off'; draw(); return me.ctl; }
    if (opt.suggestions) {
      let review;
      try {
        review = R().validate(S, { suggestions: opt.suggestions, note: opt.note || '' }, day, { given: null });
      } catch (e) { me.step = 'error'; me.error = 'Couldn\'t check those suggestions.'; draw(); return me.ctl; }
      showResult(me, Object.assign(review, { v: 1, at: Date.now(), day, engine: opt.engine || 'app', model: opt.model || null, source }));
      if (source === 'report') seen(S, day);
      return me.ctl;
    }
    const kept = R().current(S, day);
    if (kept && !opt.fresh) { showResult(me, kept); return me.ctl; }
    // Settings knows what's on the phone once it has looked (the first time loads the runtime).
    const check = U.checkDevice ? U.checkDevice().catch(() => null) : Promise.resolve(null);
    check.then(() => {
      if (rv !== me) return;
      const who = R().engine(U.S);
      if (!who) { me.step = 'none'; draw(); watch(me); return; }
      start(me, who);
    });
    return me.ctl;
  };
  function showResult(me, review) {
    me.review = review;
    me.picked = new Set(review.items.map((x) => x.id));
    me.engine = review.engine;
    me.step = 'result';
    draw();
    // A longer review opens all the way, once the sheet has measured what it now holds.
    if (review.items.length + review.rejected.length + review.tips.length > 1) {
      setTimeout(() => { if (rv === me && me.ctl && !me.ctl.closed && me.ctl.detent) { try { me.ctl.detent('large'); } catch (e) { /* stays where it is */ } } }, 120);
    }
  }
  // With no AI set up, the sheet keeps an eye on the downloads it shows and on Claude being turned on.
  function watch(me) {
    stopTimer(me);
    let was = '';
    me.timer = setInterval(() => {
      if (rv !== me || me.step !== 'none') { stopTimer(me); return; }
      const d = U.deviceState ? U.deviceState() : null;
      const now = JSON.stringify([R().engine(U.S), d && d.installed.map((x) => x.id), d && Object.values(d.progress || {}).map((p) => [p.id, p.state, Math.round((p.loaded || 0) / 1e7)])]);
      if (now !== was) { was = now; draw(); }
    }, 1000);
  }
  async function start(me, who) {
    stopTimer(me);
    Object.assign(me, { step: 'busy', engine: who, status: who === 'claude' ? 'asking' : 'loading', value: 0, error: null, startedAt: Date.now(), ctrl: new AbortController() });
    draw();
    me.timer = setInterval(tick, 1000);
    try {
      const review = await R().run(U.S, U.today(), { engine: who, signal: me.ctrl.signal, source: me.source, onStatus: (status, value) => { if (rv !== me) return; me.status = status; me.value = value; tickSoon(); } });
      stopTimer(me);
      if (rv !== me) return;
      if (review.aborted) { me.step = 'stopped'; draw(); return; }
      U.save();
      showResult(me, review);
      U.haptic(review.items.length ? 'success' : 'tap');
    } catch (e) {
      stopTimer(me);
      if (rv !== me) return;
      if (e && e.code === 'aborted') me.step = 'stopped';
      else if (e && e.code === 'custom') me.step = 'custom';
      else { me.step = 'error'; me.error = (e && e.message) || 'Something went wrong checking your plan.'; U.haptic('error'); }
      draw();
    }
  }
  function halt(me) {
    if (me.ctrl) me.ctrl.abort();
    if (me.engine === 'claude' && AI()) AI().stop();
  }
  // A report's ideas, once opened, show as looked over (and, once applied, how many).
  function seen(S, day, applied) {
    const rep = AI() && AI().reportFor ? AI().reportFor(S, day) : null;
    if (!rep || !rep.plan) return;
    rep.plan.seen = rep.plan.seen || Date.now();
    if (applied) rep.plan.applied = applied;
    U.save();
  }

  U.act.reviewPlan = (el) => { if (R()) R().open((el && el.dataset && el.dataset.arg) || (U.route && U.route.tab) || 'plan'); };
  U.act.reviewStart = () => { if (rv && R().engine(U.S)) start(rv, R().engine(U.S)); };
  U.act.reviewStop = () => { if (!rv || rv.step !== 'busy') return; halt(rv); U.haptic('pause'); };
  U.act.reviewAgain = () => {
    if (!rv) return;
    const who = R().engine(U.S);
    if (!who) { rv.step = 'none'; draw(); watch(rv); return; }
    if (U.S.ai) U.S.ai.review = null;
    start(rv, who);
  };
  U.act.reviewModels = () => { if (!rv) return; rv.models = !rv.models; draw(); };
  U.act.reviewClaude = async () => {
    const S = U.S;
    if (!(AI() && AI().hasKey())) { if (U.act.keySheet) U.act.keySheet(); return; }
    if (!S.ai.consentAt) {
      if (!U.claudeConsent || !(await U.claudeConsent())) return;
      S.ai.enabled = true;
      U.save(true);
    }
    if (rv && rv.step === 'none') start(rv, 'claude');
  };
  U.act.reviewPlans = () => { U.closeSheets(); if (U.act.openPlans) setTimeout(() => U.act.openPlans(), 320); };
  U.act.reviewImprove = () => { const id = GH.customPlan && GH.customPlan.activeId(U.S); U.closeSheets(); if (id && U.act.cpImprove) setTimeout(() => U.act.cpImprove({ dataset: { arg: id } }), 320); };
  U.on.reviewPick = (el, ev, v) => {
    if (!rv || !rv.review) return;
    const id = el.getAttribute('data-k');
    if (v) rv.picked.add(id); else rv.picked.delete(id);
    const root = rv.ctl && rv.ctl.el;
    if (!root) return;
    const li = root.querySelector(`.rv-card[data-key="rv-${id}"]`);
    if (li) li.toggleAttribute('data-off', !v);
    const btn = root.querySelector('[data-act="reviewApply"]');
    const n = rv.review.items.filter((x) => rv.picked.has(x.id)).length;
    if (btn) { btn.textContent = applyLabel(n, rv.review.items.length); if (n) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true'); }
  };
  U.act.reviewApply = () => {
    if (!rv || rv.step !== 'result' || !rv.review) return;
    const S = U.S, day = U.today();
    const items = rv.review.items.filter((x) => rv.picked.has(x.id));
    if (!items.length) { U.haptic('deny'); return; }
    const res = R().apply(S, items, day, { engine: rv.review.engine, source: rv.source });
    if (!res.applied.length) { U.toast('Nothing was applied', 'caution', res.skipped.length ? res.skipped[0].reason : ''); return; }
    // A review's done with once it's applied: the next check looks at the plan as it is now.
    S.ai.review = null;
    const source = rv.source;
    if (source === 'report') seen(S, day, res.applied.length);
    if (source === 'report') U.closeSheets(); else rv.ctl.close('ok');
    U.commit();
    if (U.badgeEvent) U.badgeEvent('reviewed');
    const msg = res.skipped.length ? `${res.applied.length === 1 ? 'One change' : `${res.applied.length} changes`} applied. ${res.skipped[0].title}: ${res.skipped[0].reason}` : res.lines.length === 1 ? res.lines[0] : `${res.lines.length} changes, from your next workout`;
    U.toast('Plan updated', 'positive', msg, { label: 'Undo', onClick: () => U.act.reviewUndo() });
  };
  U.act.reviewUndo = () => {
    const S = U.S;
    if (!R() || !R().undo(S, U.today())) return;
    U.commit();
    U.haptic('undo');
    U.toast('Changes undone', 'neutral', 'Your plan is back to how it was.');
  };

  /* ================================================================== the weekly report's ideas */
  // Claude's plan ideas on the weekly report: their titles and a way to look them over in the review,
  // where they're checked against the plan. The report's sheet (reportBody in src/ui/healthtab.js)
  // places it after Focus next with `${U.planIdeas && w.rep ? U.planIdeas(S, day, w.rep) : ''}`.
  U.planIdeas = (S, day, rep) => {
    const plan = rep && rep.plan;
    if (!plan || !Array.isArray(plan.items) || !plan.items.length || !R() || (S.profile && S.profile.workouts === false)) return '';
    const done = plan.applied ? `You applied ${plan.applied === 1 ? 'one' : plan.applied} of them.` : '';
    return `<section class="rs-sec rv-ideas" data-state="plan" data-key="rv-ideas">
      <h3 class="rs-h">${U.icon('sparkle', 'sm')}<span>Plan ideas</span></h3>
      <ul class="rs-list">${plan.items.slice(0, 3).map((x) => `<li>${U.esc(x.title || R().ownTitle(x))}</li>`).join('')}</ul>
      ${plan.note ? `<p class="t-footnote rf-muted">${U.esc(plan.note)}</p>` : ''}
      ${done ? `<p class="t-footnote rv-ideas-done">${U.icon('check-circle', 'sm')}${U.esc(done)}</p>` : `<button type="button" class="rf-btn rv-ideas-go" data-variant="soft" data-size="sm" data-act="reviewPlanIdeas">${U.icon('check-circle', 'sm')}Look them over</button>`}
    </section>`;
  };
  U.act.reviewPlanIdeas = () => {
    const S = U.S;
    const rep = AI() && AI().reportFor ? AI().reportFor(S, U.today()) : null;
    if (!rep || !rep.plan || !R()) return;
    R().open('report', { engine: 'claude', suggestions: rep.plan.items, note: rep.plan.note, model: rep.model });
  };
})(typeof window !== 'undefined' ? window : globalThis);
