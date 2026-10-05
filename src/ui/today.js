/* Today: streak tallies (a tap opens Progress), readiness, the session (or light day), the feel
 * check, protein and one insight. The main actions float in glass above the tab bar.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;

  let shortDay = null;
  let feelOpen = false;
  const isShort = (day) => shortDay === day;

  /* ---------------------------------------------------------------- streak tallies */
  function tallies(n) {
    const shown = Math.min(n, 30);
    const groups = Math.ceil(shown / 5);
    const w = Math.max(1, groups) * 34;
    let d = '';
    for (let g = 0; g < groups; g++) {
      const inGroup = Math.min(5, shown - g * 5);
      const x0 = g * 34 + 4;
      for (let k = 0; k < Math.min(4, inGroup); k++) d += `M${x0 + k * 6} 4V26`;
      if (inGroup === 5) d += `M${x0 - 3} 22L${x0 + 21} 8`;
    }
    return `<svg class="tally" viewBox="0 0 ${w} 30" width="${w}" height="30" aria-hidden="true"><path d="${d || 'M0 0'}"/></svg>${n > 30 ? `<span class="t-footnote rf-muted">+${n - 30}</span>` : ''}`;
  }

  /* ---------------------------------------------------------------- session list */
  function sessionRows(S, s) {
    const rows = [];
    const lead = S.catchup.arm.side || 'L';
    if (s.warmup.length) rows.push(`<li class="ex ex-muted"><span class="ex-tag">${U.icon('sun', 'sm')}</span><span class="ex-name">Warm-up</span><span class="ex-meta">${s.warmup.map((w) => U.esc(w.name.toLowerCase())).join(', ')}</span></li>`);
    for (const t of s.tests || []) rows.push(`<li class="ex is-lead"><span class="ex-tag">${U.icon('layers', 'sm')}</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${t.moveId}">${U.esc(t.name)}</button><span class="ex-meta">${U.side(t.side)} first, max reps</span></li>`);
    for (const it of s.items) {
      rows.push(`<li class="ex"><span class="ex-tag rf-num">${it.superset ? U.esc(it.superset) : ''}</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${it.moveId}">${U.esc(it.name)}${it.swappedFrom ? ` <span class="t-caption rf-muted">(swapped)</span>` : ''}</button><span class="ex-meta rf-num">${it.sets} × ${U.esc(U.target(it))}${it.uni ? ' each side' : ''}${it.power ? ' · fast up' : ''}${it.load && it.load.label ? ` · ${U.esc(it.load.label.replace(/ (dumbbells?|kettlebell)$/, ''))}` : ''}</span></li>`);
      for (const x of s.extras || []) if (x.fam === it.fam) rows.push(`<li class="ex is-lead"><span class="ex-tag">+1</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${x.moveId}">${U.esc(x.name)}</button><span class="ex-meta rf-num">${U.side(x.leadOnly || lead).toLowerCase()} only · ${U.esc(U.target(x))}</span></li>`);
    }
    for (const x of s.extras || []) if (!s.items.some((it) => it.fam === x.fam)) rows.push(`<li class="ex is-lead"><span class="ex-tag">+1</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${x.moveId}">${U.esc(x.name)}</button><span class="ex-meta rf-num">${U.side(x.leadOnly || lead).toLowerCase()} only · ${U.esc(U.target(x))}</span></li>`);
    if (s.finisher) rows.push(`<li class="ex"><span class="ex-tag">${U.icon('bolt', 'sm')}</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${s.finisher.moveId}">Finisher: ${U.esc(s.finisher.name.toLowerCase())}</button><span class="ex-meta rf-num">${s.finisher.rounds} × ${s.finisher.work} s on, ${s.finisher.rest} s off</span></li>`);
    // The cool-down: stretches held for seconds, and the easy cardio block (its target is in seconds
    // too, but it runs for minutes), which is a move to look up like the others.
    for (const mb of s.mobility || []) {
      rows.push(mb.cardio
        ? `<li class="ex"><span class="ex-tag">${U.icon('heart', 'sm')}</span><button type="button" class="ex-name" data-act="moveInfo" data-arg="${U.esc(mb.moveId)}">${U.esc(mb.name)}</button><span class="ex-meta rf-num">Easy cardio · ${Math.max(1, Math.round(mb.target / 60))} min</span></li>`
        : `<li class="ex ex-muted"><span class="ex-tag">${U.icon('moon', 'sm')}</span><span class="ex-name">${U.esc(mb.name)}</span><span class="ex-meta">${mb.target} s</span></li>`);
    }
    return `<ul class="ex-list">${rows.join('')}</ul>`;
  }
  U.sessionRows = sessionRows;
  function phaseBadges(week, s) {
    const b = [];
    if (week && week.phase.deload) b.push(U.badge('Deload week', 'accent'));
    else if (week && week.phase.onramp) b.push(U.badge('Easing in', 'accent'));
    if (s && s.short) b.push(U.badge('Short', 'neutral'));
    if (s && s.readiness && (s.readiness.minus || s.readiness.legsMinus)) b.push(U.badge('Lighter today', 'caution'));
    return b.join('');
  }

  /* ---------------------------------------------------------------- cards */
  function workoutCard(S, day, plan, cal, session) {
    const s = session || B().buildSession(S, day, plan.tpl, { short: isShort(day), cal });
    const budget = isShort(day) ? '12-15' : (S.profile.minutes || 25);
    const where = S.profile.where || 'home';
    // Age and health (src/access.js): what the plan works around, and any reminders for today.
    const around = GH.access ? GH.access.plannedAround(S.profile) : null;
    const notes = (s.notes || []).filter((n) => n && n.text);
    return `<div class="card session" data-key="main">
        <div class="session-head"><span class="rf-card-eyebrow">${s.flare ? 'Flare day' : 'Workout'} · about ${U.roll(s.estimateMin)} min${where === 'gym' ? ' · gym' : ''}</span><span class="session-badges">${phaseBadges(plan.week, s)}</span></div>
        <h2 class="t-title-2">${U.esc(s.title)}</h2>
        ${s.groups.length || (s.custom && s.custom.name) ? `<p class="t-footnote rf-muted session-groups">${s.custom && s.custom.name ? `${U.esc(s.custom.name)} · ` : ''}${s.groups.map((g) => U.esc(B().GROUP_NAME[g] || g)).join(' · ')}</p>` : ''}
        ${around ? `<button type="button" class="around-line t-footnote" data-act="planAround">${U.icon('heart', 'sm')}<span>${U.esc(around)}</span>${U.icon('chevron-right', 'sm')}</button>` : ''}
        ${notes.map((n) => `<p class="t-footnote session-note">${U.esc(n.text)}</p>`).join('')}
        ${where === 'both' ? `<div class="place-row">${U.seg('place', [['home', 'At home'], ['gym', 'At the gym']], s.place, 'Where you train today', ' data-on="setPlace"')}</div>` : ''}
        ${sessionRows(S, s)}
        ${s.custom && U.customSwapNote ? U.customSwapNote(s) : ''}
        ${s.trimmed && s.trimmed.length ? `<p class="t-footnote rf-muted">Trimmed to fit ${U.esc(budget)} min: ${U.esc(s.trimmed.map((x) => x.toLowerCase()).join(', '))}.</p>` : ''}
      </div>
`;
  }
  U.on.setPlace = (el, ev, v) => { B().setPlace(U.S, U.today(), v); U.save(); U.render(); };
  function activeCard(S, day) {
    const a = S.active;
    const doneN = a.steps.slice(0, a.idx).filter((x) => x.kind === 'set').length;
    const total = a.steps.filter((x) => x.kind === 'set').length;
    if (a.day < day) {
      return `<div class="card session" data-key="main"><span class="rf-card-eyebrow">Unfinished</span><h2 class="t-title-2">${U.esc(a.session.title)}</h2>
        <p class="t-callout rf-muted">From ${U.esc(U.fmtDay(a.day))}: ${doneN} of ${total} sets. Check in to save it, or discard it.</p>
        <div class="btn-row"><button type="button" class="rf-btn" data-variant="filled" data-act="checkinStale">Check in</button><button type="button" class="rf-btn" data-tone="critical" data-act="discardStale">Discard</button></div></div>`;
    }
    return `<div class="card session" data-key="main"><span class="rf-card-eyebrow">In progress</span><h2 class="t-title-2">${U.esc(a.session.title)}</h2>
      ${U.progress(doneN / Math.max(1, total), 'Workout progress')}
      <p class="t-callout rf-muted">${doneN} of ${total} sets done.</p></div>`;
  }
  function doneCard(S, log) {
    const mins = log.startedAt && log.endedAt ? Math.round((log.endedAt - log.startedAt) / 60000) : null;
    const lines = (log.lines || []).filter((l) => l && l.text);
    return `<div class="card session done" data-key="main">
      <span class="rf-card-eyebrow done-eyebrow">${U.icon('check-circle', 'sm')} Done</span>
      <h2 class="t-title-2">${U.esc(log.title)}</h2>
      <p class="t-callout rf-muted">${log.doneSets} of ${log.planned} sets${mins ? ` · ${mins} min` : ''}${log.checkin && log.checkin.rating ? ` · ${log.checkin.rating === 'easy' ? 'too easy' : log.checkin.rating === 'hard' ? 'too hard' : 'about right'}` : ''}</p>
      ${lines.length ? `<p class="t-headline done-next">Next time</p><ul class="plain-list">${lines.map((l) => `<li><span>${U.esc(l.text)}</span>${l.why ? `<span class="t-footnote rf-muted">${U.esc(U.cap(l.why))}</span>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`;
  }
  function lightCard(S, day, plan) {
    const prog = B().programFor(S.profile);
    const h = S.health.days[day] || {};
    const l = plan.light || {};
    const next = plan.next;
    const walkSub = l.walk ? (l.walkSrc === 'health-steps' ? 'Ticked from your steps' : l.walkSrc === 'health-walk' ? 'Ticked from Health Connect' : l.walkSrc === 'activity' ? 'Ticked from the activity you tracked' : 'Logged') : h.steps != null ? `${U.num(h.steps)} steps so far today` : 'Any pace. Outside if you can.';
    return `<div class="card light" data-key="main">
      <span class="rf-card-eyebrow">Light day</span>
      <h2 class="t-title-2">Walk and mobility</h2>
      <p class="t-callout rf-muted">Do both and today counts for your streak.</p>
      <ul class="rf-list check-list">
        <li><div class="rf-list-row"><span class="rf-list-icon" data-tone="green">${U.icon('navigate')}</span><span class="rf-list-text"><span class="rf-list-title">Walk ${prog.walkMin}+ min</span><span class="rf-list-sub">${U.esc(walkSub)}</span></span>${l.walk ? `<span class="check-done" aria-label="Done">${U.icon('check-circle')}</span>` : '<button type="button" class="rf-btn" data-size="sm" data-act="logWalk">Log walk</button>'}</div></li>
        <li><div class="rf-list-row"><span class="rf-list-icon" data-tone="teal">${U.icon('leaf')}</span><span class="rf-list-text"><span class="rf-list-title">Mobility flow</span><span class="rf-list-sub">5 moves, about 5 min</span></span>${l.mobility ? `<span class="check-done" aria-label="Done">${U.icon('check-circle')}</span>` : '<button type="button" class="rf-btn" data-size="sm" data-act="startMobility">Start</button>'}</div></li>
      </ul>
      ${next ? `<button type="button" class="rf-btn light-train" data-variant="plain" data-act="trainToday">Train today instead: ${U.esc((next.title || B().templateTitle(next.units)).toLowerCase())}</button>` : ''}
    </div>`;
  }
  function restCard(S, day, plan) {
    const next = plan.next;
    return `<div class="card light" data-key="main"><span class="rf-card-eyebrow">Rest day</span><h2 class="t-title-2">Recover</h2>
      <p class="t-callout rf-muted">${next ? `Next: ${U.esc((next.title || B().templateTitle(next.units)).toLowerCase())} on ${U.esc(U.fmtDay(next.day))}.` : 'Nothing planned for the rest of the week.'}</p></div>`;
  }
  // With arthritis, a flare swaps a workout day's session for gentle range of motion (src/access.js).
  function flareRow(S, day, plan) {
    if (!GH.access || !GH.access.flareOk(S.profile) || S.profile.workouts === false || S.active || !plan || plan.type !== 'workout') return '';
    const on = !!(S.feel[day] && S.feel[day].flare);
    return `<ul class="rf-list feel-flare">${U.sw('Joints flaring today', on, 'data-on="feelFlare"', on ? 'Today is gentle range of motion instead. It still counts.' : 'Swaps today\'s workout for gentle range of motion.')}</ul>`;
  }
  function feelCard(S, day, plan) {
    const f = S.feel[day] || {};
    const hasSleep = S.health.days[day] && S.health.days[day].sleepMin != null;
    const chip = S.sleepChip[day];
    const complete = f.energy && f.sore && (hasSleep || chip);
    if (complete && !feelOpen) {
      const bits = [`Energy ${f.energy}`, `sore: ${f.sore}`];
      if (!hasSleep && chip) bits.push(`${chip} h sleep`);
      const flare = flareRow(S, day, plan);
      return `<div class="card feel-done${flare ? ' has-flare' : ''}" data-key="feel"><div class="feel-done-row"><span class="t-callout">${U.esc(bits.join(' · '))}</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="feelEdit">Change</button></div>${flare}</div>`;
    }
    return `<div class="card feel" data-key="feel">
      <p class="t-headline">How are you today?</p>
      <div class="feel-row"><span class="t-subhead">Energy</span>${U.seg('feelEnergy', [['low', 'Low'], ['ok', 'OK'], ['good', 'Good']], f.energy || '', 'Energy', ' data-on="feelEnergy"')}</div>
      <div class="feel-row"><span class="t-subhead">Soreness</span>${U.seg('feelSore', [['none', 'None'], ['some', 'Some'], ['very', 'Very']], f.sore || '', 'Soreness', ' data-on="feelSore"')}</div>
      ${hasSleep ? '' : `<div class="feel-row"><span class="t-subhead">Sleep</span>${U.seg('sleepChip', [['<5', '<5 h'], ['5-6', '5-6'], ['6-7', '6-7'], ['7-8', '7-8'], ['8+', '8+']], chip || '', 'Sleep last night', ' data-on="sleepChip"')}</div>`}
      ${flareRow(S, day, plan)}
      ${S.profile.workouts !== false ? '<p class="t-footnote rf-muted">Very sore with low energy, or under 5 h of sleep, means one less set per exercise today.</p>' : ''}
    </div>`;
  }
  // With workouts off, Today leads with the day's movement and last night's sleep.
  function dayCard(S, day) {
    const H = GH.health;
    const t = H.today(S, day);
    const goal = B().stepsGoal(S, day).goal;
    const steps = t.steps;
    const sl = t.sleepLast;
    const lines = [];
    lines.push(sl ? `Slept ${U.fmtMin(sl.value)}${sl.day !== day ? ' the night before' : ''}` : 'No sleep logged yet');
    if (t.activeMin) lines.push(`${t.activeMin} active min`);
    if (t.weightAvg7 != null) lines.push(`Weight ${U.fmtW(t.weightAvg7)} (7-day average)`);
    return `<div class="card day-card" data-key="main">
      <span class="rf-card-eyebrow">Today</span>
      <div class="day-row">
        ${U.ring(steps != null ? steps / goal : 0, 'Steps today', `<span class="fd-ring-n rf-num">${steps != null ? U.roll(U.num(steps)) : '–'}</span><span class="t-caption rf-muted">steps</span>`, 'md', steps != null && steps >= goal ? 'positive' : 'accent')}
        <div class="day-lines">
          <p class="t-headline">Goal ${U.num(goal)} steps</p>
          ${lines.map((l) => `<p class="t-footnote rf-muted">${U.esc(l)}</p>`).join('')}
        </div>
      </div>
      ${sl ? '' : '<div class="btn-row"><button type="button" class="rf-btn" data-size="sm" data-act="logSleep">Log sleep</button></div>'}
    </div>`;
  }
  function proteinCard(S, day) {
    const pr = S.profile.protein || {};
    if (pr.track === false || (GH.food && GH.food.mode(S) === 'off')) return '';
    const goal = B().proteinGoal(S, day);
    const got = B().proteinToday(S, day);
    if (!goal) return `<div class="card protein" data-key="protein"><span class="t-headline">Protein</span><p class="t-callout rf-muted">Add your weight to get a daily protein goal.</p><button type="button" class="rf-btn" data-act="logWeight">Log weight</button></div>`;
    return `<div class="card protein" data-key="protein">
      <div class="row-between"><span class="t-headline">Protein</span><span class="t-callout rf-num"><b>${U.roll(got)}</b> of ${goal} g</span></div>
      ${U.progress(got / goal, 'Protein today', got >= goal ? 'positive' : '')}
      <div class="btn-row">
        <button type="button" class="rf-btn" data-variant="soft" data-act="addQuick">${U.icon('plus')}${U.esc(pr.quickName || 'Shake')} ${pr.quickG || 26} g</button>
        <button type="button" class="rf-btn" data-act="addProtein">Other</button>
        ${got ? '<button type="button" class="rf-btn" data-variant="plain" data-act="undoProtein">Undo</button>' : ''}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- the screen */
  U.screens.today = {
    render(S, day) {
      const cal = B().calendar(S, day);
      const plan = B().todayPlan(S, day, cal);
      const week = cal.weeks[B().weekStart(day)];
      const st = cal.streak;
      const workouts = S.profile.workouts !== false;
      const sub = [U.fmtDay(day)];
      if (week && workouts) sub.push(`week ${week.trainingWeek}`);
      // Today's session, built once for the workout card and the coach card.
      const session = workouts && !S.active && plan.type === 'workout' ? B().buildSession(S, day, plan.tpl, { short: isShort(day), cal }) : null;
      let main;
      if (S.active) main = activeCard(S, day);
      else if (!workouts) main = dayCard(S, day);
      else if (plan.type === 'done') main = doneCard(S, plan.log);
      else if (plan.type === 'workout') main = workoutCard(S, day, plan, cal, session);
      else if (plan.type === 'light') main = lightCard(S, day, plan);
      else main = restCard(S, day, plan);
      // The insight line sits at the end of the page. On the first frame after launch it's there only
      // if it's already worked out (the last launch the same day kept it); otherwise it's worked out
      // once that frame is drawn, a little at a time while the phone is idle, and comes in then.
      const ins = GH.insights ? GH.insights.top(S, day, 1, U.firstFrame || insightJob ? { ready: true } : null) : [];
      if (!ins) insightLater();
      const top = ins ? ins[0] || null : null;
      if (top && GH.insights.markShown) GH.insights.markShown(S, [top], day);
      const measure = GH.health && GH.health.measureDue(S, day);
      // Today's tip waits while the Getting started checklist is up: one thing at a time.
      const ck = U.checklist ? U.checklist(S, day) : '';
      return `${U.navbar('Today')}
        <h1 class="rf-large-title">${U.esc(greeting(S))}</h1>
        <p class="lt-sub t-callout rf-muted">${U.esc(sub.join(' · '))}</p>
        <div class="section">
          ${!ck && U.tip ? U.tip('today') : ''}
          ${workouts ? `<button type="button" class="card streak tap-card" data-key="streak" data-act="openProgress">
            <span class="streak-main">
              <span class="streak-n">${U.roll(st.current, 't-large-title')}<span class="t-callout rf-muted">day streak</span></span>
              <span class="streak-tally">${tallies(st.current)}</span>
            </span>
            <span class="streak-foot"><span class="t-footnote rf-muted">${st.weekly ? `${U.plural(st.weekly, 'full week')} in a row · ` : ''}${st.freezeThisWeek ? 'Freeze used this week' : '1 freeze left this week'}${st.best > st.current ? ` · best ${st.best}` : ''}</span><span class="streak-go t-footnote">Progress${U.icon('chevron-right', 'sm')}</span></span>
          </button>` : ''}
          ${main}
          ${workouts && plan.type !== 'done' && !S.active && U.coachCard ? U.coachCard(S, day, session) : ''}
          ${U.actTodayCard ? U.actTodayCard(S, day, plan) : ''}
          ${ck}
          ${GH.food && GH.food.full(S) && U.foodCard ? U.foodCard(S, day) : proteinCard(S, day)}
          ${feelCard(S, day, plan)}
          ${measure ? `<ul class="rf-list" data-key="measure">${U.row({ icon: 'pin', tone: 'violet', title: 'Time to measure', sub: 'Waist and arms, once a month', act: 'logMeasure', chevron: true })}</ul>` : ''}
          ${top ? `<button type="button" class="insight-line" data-key="insight" data-act="goHealth"><span class="rf-list-icon" data-tone="${top.tone === 'good' ? 'green' : top.tone === 'watch' ? 'amber' : top.tone === 'alert' ? 'rose' : 'sky'}">${U.icon(top.icon)}</span><span class="insight-text"><span class="t-subhead">${U.esc(top.title)}</span><span class="t-footnote rf-muted">${U.esc(top.evidence)}</span></span>${U.icon('chevron-right')}</button>` : ''}
        </div>`;
    },
    // The floating buttons: at most a secondary one (regular glass, which refracts) and the main one
    // (tinted glass, which doesn't). Each keeps its glass across a change of what it says (keyed by
    // its place, U.floatKey in core.js), so Start workout becoming Resume, or Short on time becoming
    // Full session, shape-shifts the button to its new width (U.motion.shift).
    float(S, day) {
      // An outdoor activity recording in the background: the way back to it (src/ui/actlive.js).
      const act = U.actFloat ? U.actFloat(S, day) : '';
      if (act) return act;
      const cal = B().calendar(S, day);
      const plan = B().todayPlan(S, day, cal);
      const side = U.floatKey('side'), main = U.floatKey('main');
      if (S.active && S.active.day === day) {
        return `<button type="button" class="rf-btn rf-glass" data-size="lg" data-lens${side} data-act="cancelWorkout" aria-label="Cancel the workout">${U.icon('close')}<span class="btn-label">Cancel</span></button>
          <button type="button" class="rf-btn rf-glass btn-main" data-variant="tinted" data-size="lg"${main} data-act="resumeWorkout">${U.icon('play')}Resume workout</button>`;
      }
      if (S.active || S.profile.workouts === false) return '';
      if (plan.type === 'workout') {
        const on = isShort(day);
        // A flare day is one gentle flow: no short version, and the button says what it starts.
        if (GH.access && GH.access.flareOn(S, day)) return `<button type="button" class="rf-btn rf-glass btn-main" data-variant="tinted" data-size="lg"${main} data-act="startWorkout">${U.icon('play')}Start gentle session</button>`;
        return `<button type="button" class="rf-btn rf-glass" data-size="lg" data-lens${side} data-act="toggleShort" aria-pressed="${on}" aria-label="${on ? 'Full session' : 'Short on time'}">${U.icon('timer')}<span class="btn-label">${on ? 'Full session' : 'Short on time'}</span></button>
          <button type="button" class="rf-btn rf-glass btn-main" data-variant="tinted" data-size="lg"${main} data-act="startWorkout">${U.icon('play')}Start workout</button>`;
      }
      if (plan.type === 'light' && !(plan.light && plan.light.mobility)) return `<button type="button" class="rf-btn rf-glass btn-main" data-variant="tinted" data-size="lg"${main} data-act="startMobility">${U.icon('play')}Start mobility</button>`;
      return '';
    },
  };
  // (Until it's done, Today's renders leave the line out too, rather than working it all out at once.)
  let insightJob = 0;
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30));
  function insightLater() {
    if (insightJob) return;
    const step = () => {
      const t0 = Date.now();
      if (U.S && GH.insights && !GH.insights.warm(U.S, U.today(), () => Date.now() - t0 < 40)) { insightJob = idle(step); return; }
      insightJob = 0;
      if (U.S && U.route.tab === 'today' && !U.route.view) U.renderSoon();
    };
    insightJob = idle(step);
  }

  // "Good morning" until noon, and so on; with a name when there is one.
  function greeting(S) {
    const h = new Date().getHours();
    const part = h < 4 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = (S.profile.name || '').trim().split(/\s+/)[0];
    return name ? `${part}, ${name}` : part;
  }

  /* ---------------------------------------------------------------- actions */
  U.act.goHealth = () => U.go('health');
  U.act.toggleShort = () => { const d = U.today(); shortDay = isShort(d) ? null : d; U.haptic(shortDay != null ? 'toggleOn' : 'toggleOff'); U.render(); };
  U.act.startWorkout = () => {
    const S = U.S;
    if (S.active) { U.openPlayer(); return; }
    const day = U.today();
    const r = B().startWorkout(S, day, { short: isShort(day), now: Date.now() });
    if (r.error) { U.toast(r.error === 'done' ? 'Already done today' : 'Nothing left to train this week', 'neutral'); return; }
    shortDay = null;
    U.save(true);
    U.haptic('go');
    U.openPlayer();
  };
  U.act.trainToday = async () => {
    const ok = await U.confirm('Train today instead?', 'The next workout moves to today and the rest of the week follows it.', 'Train today');
    if (ok) U.act.startWorkout();
  };
  U.act.logWalk = () => { B().logLight(U.S, U.today(), 'walk', true); U.commit(); U.toast('Walk logged', 'positive'); if (U.checklistCheck) U.checklistCheck(); };
  U.act.startMobility = () => U.openMobility();
  U.act.checkinStale = () => { if (U.openCheckin) U.openCheckin(); };
  U.act.discardStale = async () => {
    if (await U.confirm('Discard this workout?', 'Nothing from it is saved.', 'Discard', 'critical', 'trash')) { B().cancelWorkout(U.S); U.commit(); }
  };
  U.act.feelEdit = () => { feelOpen = true; U.render(); };
  U.on.feelEnergy = (el, ev, v) => { GH.health.setFeel(U.S, U.today(), { energy: v }); U.save(); maybeClose(); };
  U.on.feelSore = (el, ev, v) => { GH.health.setFeel(U.S, U.today(), { sore: v }); U.save(); maybeClose(); };
  U.on.sleepChip = (el, ev, v) => { GH.health.setSleepChip(U.S, U.today(), v); U.save(); maybeClose(); };
  U.on.feelFlare = (el, ev, v) => {
    GH.health.setFeel(U.S, U.today(), { flare: !!v });
    U.save();
    setTimeout(() => U.render(), 200);
    U.toast(v ? 'A gentle day' : 'Back to today\'s workout', v ? 'neutral' : 'positive', v ? 'Today is range of motion for every joint, done seated. It counts for your streak.' : undefined);
  };
  function maybeClose() {
    const S = U.S, d = U.today();
    const f = S.feel[d] || {};
    const hasSleep = (S.health.days[d] && S.health.days[d].sleepMin != null) || S.sleepChip[d];
    const change = () => { U.render(); if (U.checklistCheck) U.checklistCheck(); };
    if (!(f.energy && f.sore && hasSleep)) { setTimeout(change, 0); return; }
    feelOpen = false;
    // All three answered. Once the thumb that moved has landed (half a second at most), the card
    // folds into its one-line summary: the questions fade and shrink, the summary fades in where they
    // were, and the cards under it glide up.
    const card = document.querySelector('#screen [data-key="feel"]');
    const moving = card && U.controlSettled ? Array.from(card.querySelectorAll('.rf-segmented, .gh-chipseg, .rf-switch-track'), (el) => U.controlSettled(el)) : [];
    Promise.race([Promise.all(moving), new Promise((r) => setTimeout(r, 500))]).then(() => {
      const now = document.querySelector('#screen [data-key="feel"]');
      if (now && now === card && !feelOpen && U.motion && U.motion.collapse) U.motion.collapse(now, change);
      else change();
    });
  }
  U.act.addQuick = () => {
    const S = U.S, d = U.today();
    B().addProtein(S, d, S.profile.protein.quickG || 26);
    U.commit();
    U.haptic('log');
    const goal = B().proteinGoal(S, d);
    // The goal reached: a milestone after the log's click.
    if (goal && B().proteinToday(S, d) >= goal && B().proteinToday(S, d) - (S.profile.protein.quickG || 26) < goal) { U.haptic('milestone'); U.toast('Protein goal hit', 'positive'); }
  };
  U.act.undoProtein = () => { B().undoProtein(U.S, U.today()); U.commit(); U.haptic('undo'); };
  U.act.addProtein = () => {
    U.sheet({
      title: 'Add protein', size: 'fit',
      body: `<div class="sheet-pad"><div class="ob-center">${U.stepper('protG', 20, 1, 150, 'Grams of protein', '', 5)}</div><p class="t-footnote rf-muted">A palm of meat or fish is about 25 g, a cup of milk 8 g, an egg 6 g.</p></div>`,
      action: { label: 'Add', act: 'addProteinSave' },
    });
  };
  U.act.addProteinSave = () => {
    const v = parseInt(document.getElementById('protG').value, 10);
    if (v > 0) { B().addProtein(U.S, U.today(), v); U.commit(); U.haptic('log'); }
    const t = U.topSheet(); if (t) t.close('ok');
  };
  U.act.moveInfo = (el) => U.moveSheet(el.dataset.arg);
})(typeof window !== 'undefined' ? window : globalThis);
