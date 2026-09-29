/* The Coach page: what the coach changed today and why, what it suggests (you apply or dismiss),
 * what it's keeping an eye on, this week's targets, and everything it changed lately. The chat
 * opens from here too. Nothing here changes the plan without a tap.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const C = () => GH.coach;

  const STATUS = { good: ['positive', 'On track'], info: ['accent', 'Note'], watch: ['caution', 'Watch'] };

  // Today's session (or null on a light/rest day), built the same way Today builds it.
  function todaySession(S, day) {
    if (S.active && S.active.day === day) return S.active.session;
    const cal = B().calendar(S, day);
    const plan = B().todayPlan(S, day, cal);
    if (plan.type !== 'workout') return null;
    return B().buildSession(S, day, plan.tpl, { cal });
  }

  function decisionRow(d, links) {
    return `<li class="co-dec"><span class="co-ico rf-list-icon" data-tone="${U.esc(d.tone || 'sky')}">${U.icon(d.icon || 'sparkle', 'sm')}</span>
      <span class="co-dec-text"><span class="t-subhead">${U.esc(d.text)}</span>${d.why ? `<span class="t-footnote rf-muted">${U.esc(d.why)}</span>` : ''}</span>${links && d.rule && U.whyChip ? U.whyChip(d.rule) : ''}</li>`;
  }

  // The card on Today: the first few decisions, or a line saying today runs as planned.
  U.coachCard = (S, day, session) => {
    const list = C().decisions(S, day, session);
    const calm = !list.length;
    const rows = calm
      ? `<p class="t-callout rf-muted">${U.esc(session ? 'Full session as planned: sleep, heart rate and how you feel look normal.' : 'Nothing to adjust today.')}</p>`
      : `<ul class="co-list">${list.slice(0, 3).map((d) => decisionRow(d, false)).join('')}</ul>${list.length > 3 ? `<p class="t-footnote rf-muted">and ${list.length - 3} more</p>` : ''}`;
    return `<div class="card co-card tap-card" data-key="coach" role="button" tabindex="0" data-act="openCoach" aria-label="Open your coach">
      <div class="co-head">${U.icon('sparkle')}<span class="t-headline">${calm ? 'Your coach' : 'What your coach changed'}</span><span class="rf-spacer"></span><span class="t-footnote co-more">See all ${U.icon('chevron-right', 'sm')}</span></div>
      ${rows}
    </div>`;
  };
  U.act.openCoach = () => U.open('coach');

  function suggestionCard(x) {
    const a = x.action;
    return `<div class="card co-sug" data-key="sug-${U.esc(x.id)}">
      <div class="co-sug-head"><span class="rf-list-icon" data-tone="violet">${U.icon(x.icon || 'sparkle', 'sm')}</span><span class="t-headline">${U.esc(x.title)}</span>${x.fromClaude ? U.badge('Claude', 'accent') : ''}</div>
      <p class="t-callout rf-muted">${U.esc(x.body)}</p>
      <div class="btn-row">
        ${a ? `<button type="button" class="rf-btn" data-variant="filled" data-size="sm" data-act="coachApply" data-arg="${U.esc(x.id)}">${U.esc(a.label || 'Apply')}</button>` : ''}
        <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="coachDismiss" data-arg="${U.esc(x.id)}">${a ? 'Not now' : 'Got it'}</button>
        ${x.fromClaude ? `<button type="button" class="rf-btn ai-flag" data-variant="plain" data-size="sm" data-act="coachFlag" data-arg="${U.esc(x.id)}">${U.icon('flag', 'sm')}Report</button>` : ''}
      </div>
    </div>`;
  }

  function watchGrid(items) {
    if (!items.length) return '<div class="card"><p class="t-callout rf-muted">After a few days of workouts and health data, this shows what the coach is watching: sleep, recovery, effort, steps and your weight trend.</p></div>';
    return `<div class="co-watch">${items.map((w) => {
      const [tone, word] = STATUS[w.status] || STATUS.info;
      return `<div class="co-w" data-status="${U.esc(w.status)}"><span class="co-w-top">${U.icon(w.icon || 'info', 'sm')}<span class="t-footnote rf-muted">${U.esc(w.label)}</span></span>
        <span class="t-headline rf-num">${U.esc(w.value)}</span>
        <span class="co-w-note t-caption"><span class="co-dot" data-tone="${tone}" aria-label="${word}"></span>${U.esc(w.note || '')}</span></div>`;
    }).join('')}</div>`;
  }

  // This week's sets per muscle: planned (from the weekly volume) and done so far.
  function weekTargets(S, day) {
    const b = B();
    const prog = b.programFor(S.profile);
    const sets = b.weeklySets(S, day);
    const rows = b.GROUPS.map((g) => {
      const target = sets[g] ? sets[g].target : S.vol[g] || 0;
      const have = sets[g] ? sets[g].done : 0;
      const tier = prog.tiers[g];
      return `<li class="co-t"><span class="co-t-name">${U.esc(b.GROUP_NAME[g])}${tier === 1 ? ' <span class="co-goal">goal</span>' : ''}</span>
        ${U.progress(target ? Math.min(1, have / target) : 0, `${b.GROUP_NAME[g]} sets this week`, have >= target && target ? 'positive' : null)}
        <span class="t-footnote rf-muted rf-num">${have} of ${target}</span></li>`;
    }).join('');
    const sg = b.stepsGoal(S, day);
    const pg = b.proteinGoal(S, day);
    const extra = [`Steps goal ${sg.goal.toLocaleString('en-US')} a day${sg.personal ? ', 10% above your usual' : ''}`];
    if (pg && S.profile.protein.track !== false) extra.push(`protein ${pg} g a day`);
    if (GH.food && GH.food.targetLine) { const t = GH.food.targetLine(S, day); if (t) extra.push(t); }
    return `<div class="card"><p class="t-footnote rf-muted">Hard sets per muscle this week, done and planned.</p><ul class="co-targets">${rows}</ul>
      <p class="t-footnote rf-muted">${U.esc(U.cap(extra.join(', ')))}.</p></div>`;
  }

  function timelineCard(S, day) {
    const items = C().timeline(S, day, 42);
    if (!items.length) return '<div class="card"><p class="t-callout rf-muted">Changes show up here after your first workouts: reps and weights going up, lighter weeks, swaps and schedule changes, each with the reason.</p></div>';
    const byDay = new Map();
    for (const x of items.slice(0, 40)) { if (!byDay.has(x.day)) byDay.set(x.day, []); byDay.get(x.day).push(x); }
    return `<div class="card co-time">${[...byDay.entries()].map(([d, xs]) => `<div class="co-day"><p class="t-footnote rf-muted co-day-label">${U.esc(d === day ? 'Today' : d === day - 1 ? 'Yesterday' : U.fmtDay(d))}</p>
      <ul class="plain-list">${xs.map((x) => `<li><span>${U.esc(x.text)}</span>${x.why ? `<span class="t-footnote rf-muted">${U.esc(U.cap(x.why))}</span>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }

  U.screens.coach = {
    render(S, day) {
      const session = todaySession(S, day);
      const decisions = C().decisions(S, day, session);
      const sugs = C().suggestions(S, day);
      const api = S.ai.mode === 'api' && GH.ai && GH.ai.hasKey();
      return `${U.navbar('Coach', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Coach</h1>
        <p class="lt-sub t-footnote rf-muted">What it changed and why, what it suggests, and what it's watching. Your plan only changes when you apply something.</p>
        <h2 class="sec-title t-title-3">Today</h2>
        <div class="section"><div class="card">${decisions.length ? `<ul class="co-list">${decisions.map((d) => decisionRow(d, true)).join('')}</ul>` : `<p class="t-callout rf-muted">${session ? 'Full session as planned. Sleep, heart rate and how you feel look normal, so nothing was taken off.' : 'Nothing to adjust today.'}</p>`}</div></div>
        <h2 class="sec-title t-title-3">Suggestions</h2>
        <div class="section">
          ${sugs.length ? sugs.map(suggestionCard).join('') : '<div class="card" data-key="nosug"><p class="t-callout rf-muted">No suggestions right now. They show up when a pattern needs your say, like a day that keeps getting missed.</p></div>'}
          ${api ? `<button type="button" class="rf-btn co-ask-ai" data-variant="soft" data-act="coachAskClaude">${U.icon('sparkle')}Ask Claude for suggestions</button>` : ''}
        </div>
        <h2 class="sec-title t-title-3">What it's watching</h2>
        <div class="section">${watchGrid(C().watching(S, day))}</div>
        <h2 class="sec-title t-title-3">This week</h2>
        <div class="section">${weekTargets(S, day)}</div>
        <h2 class="sec-title t-title-3">Recent changes</h2>
        <div class="section">${timelineCard(S, day)}</div>
        <div class="section"><button type="button" class="rf-btn rf-glass co-chat" data-variant="tinted" data-size="lg" data-act="askCoach">${U.icon('chat')}Ask the coach</button></div>`;
    },
  };

  function findSug(id) { return C().suggestions(U.S, U.today()).find((x) => x.id === id) || null; }
  U.act.coachApply = async (el) => {
    const x = findSug(el.dataset.arg);
    if (!x) return;
    const ok = await U.confirm(x.title, `${x.body} You can change it back in Settings.`, x.action.label || 'Apply');
    if (!ok) return;
    const line = C().apply(U.S, x, U.today());
    if (!line) { U.toast('That no longer applies', 'neutral'); U.render(); return; }
    U.S.pendingLines = [line].concat(U.S.pendingLines || []).slice(0, 6);
    U.commit();
    U.haptic('success');
    U.toast(line.text, 'positive');
  };
  U.act.coachDismiss = (el) => { C().dismiss(U.S, el.dataset.arg, U.today()); U.commit(); U.haptic('tap'); };
  // A suggestion Claude wrote can be reported; it's dismissed right away.
  U.act.coachFlag = (el) => {
    const x = findSug(el.dataset.arg);
    if (!x || !U.flagSheet) return;
    U.flagSheet({ kind: 'suggestion', what: 'suggestion', engine: 'Claude', model: U.S.ai.model && U.S.ai.model.name, text: `${x.title}\n${x.body}`, onHide: () => { C().dismiss(U.S, x.id, U.today()); U.render(); } });
  };
  U.act.coachAskClaude = async (btn) => {
    if (!GH.ai || !GH.ai.suggest) return;
    if (!U.S.ai.consentAt && !(await U.claudeConsent())) return;
    btn.setAttribute('aria-busy', 'true');
    try {
      const n = await GH.ai.suggest(U.S, U.today());
      U.save(true);
      U.toast(n ? `Claude suggested ${U.plural(n, 'change')}` : 'Claude had nothing to change', 'neutral');
    } catch (e) {
      U.toast(e.message || 'Claude couldn\'t help with that right now', 'caution');
    } finally { btn.removeAttribute('aria-busy'); U.render(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
