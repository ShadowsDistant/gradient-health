/* Plan: the week at a glance. A strip of seven days on top (tap a day; swipe or tap for next week),
 * the picked day in a card below it (its exercises, and Start, Move or Train today instead), then
 * the week's sets by muscle, next week, and the settings that shape the plan. The data comes from
 * GH.planWeek (src/planweek.js), which is cached, so picking a day re-renders cheaply.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;
  const doc = G.document;
  const week = (S, day) => GH.planWeek(S, day);
  const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';

  // Each muscle group's colour (the hues the Moves tab uses).
  const GROUP_HUE = { biceps: 'amber', triceps: 'rose', chest: 'indigo', legs: 'green', back: 'teal', shoulders: 'sky', abs: 'violet', conditioning: 'coral', mobility: 'teal' };
  const hue = (g) => `var(--hue-${GROUP_HUE[g] || 'sky'})`;
  const PHASE = { full: 'Full volume', deload: 'Deload week', onramp: 'Easing in', comeback: 'Easing back in' };

  // What's picked: a day (this week or next) and whether its "Move to" choices are open. Coming back
  // to the tab (or a new day) starts from today again.
  const view = { route: null, today: null, day: null, moving: null };
  function syncView(w, day) {
    if (U.route !== view.route || view.today !== day) { view.route = U.route; view.today = day; view.day = day; view.moving = null; }
    if (view.day == null || view.day < w.ws || view.day > w.next.last) view.day = day;
    if (view.moving != null && view.moving !== view.day) view.moving = null;
  }
  const findDay = (w, d) => w.days.find((e) => e.day === d) || w.next.days.find((e) => e.day === d) || null;

  /* ---------------------------------------------------------------- words */
  function range(first) {
    const a = B().fmtDay(first, false), b = B().fmtDay(first + 6, false);
    return a.split(' ')[0] === b.split(' ')[0] ? `${a} – ${b.split(' ')[1]}` : `${a} – ${b}`;
  }
  const when = (e, day) => (e.day === day ? 'Today' : e.day === day + 1 ? 'Tomorrow' : e.day === day - 1 ? 'Yesterday' : e.date);
  // "Today", "Tomorrow", else "Sat 24".
  const chipName = (d, day) => (d === day ? 'Today' : d === day + 1 ? 'Tomorrow' : `${B().fmtDay(d).split(',')[0]} ${new Date(d * B().DAY_MS).getUTCDate()}`);
  const listWords = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  function fmtLoad(kg) {
    if (kg == null || !isFinite(kg)) return '';
    const v = Math.round(U.kgTo(kg) * 2) / 2;
    return `${v % 1 ? v.toFixed(1) : v} ${U.wUnit()}`;
  }
  const RATING = { easy: 'felt too easy', right: 'felt about right', hard: 'felt too hard' };

  /* ---------------------------------------------------------------- the strip */
  function markInner(k) {
    if (k === 'done' || k === 'light-done') return U.icon('check');
    if (k === 'light') return U.icon('leaf');
    if (k === 'missed') return U.icon('close');
    if (k === 'frozen') return U.icon('pause');
    return '';
  }
  function markKind(e) {
    switch (e.kind) {
      case 'done': return 'done';
      case 'today': return e.active ? 'active' : 'work';
      case 'workout': return 'work';
      case 'light': return e.light && e.light.done ? 'light-done' : 'light';
      case 'rest': return 'rest';
      case 'missed': return 'missed';
      case 'frozen': return 'frozen';
      default: return 'none';
    }
  }
  const markHtml = (k) => `<span class="pw-mark" data-mark="${k}" data-key="m-${k}" aria-hidden="true">${markInner(k)}</span>`;
  const KIND_WORDS = { done: 'done', today: 'workout today', workout: 'workout', light: 'light day', rest: 'rest day', missed: 'missed', frozen: 'missed, freeze used', before: 'before you started' };
  // Only one day per week is in the Tab order (the picked one); arrow keys move between days.
  function pill(e, day, focusDay) {
    const sel = e.day === view.day;
    const k = markKind(e);
    const what = e.kind === 'light' && e.light && e.light.done ? 'light day, done' : e.kind === 'today' || e.kind === 'workout' || e.kind === 'done' ? `${KIND_WORDS[e.kind]}: ${e.title}` : KIND_WORDS[e.kind];
    const label = `${e.wdLong}, ${e.short}${e.isToday ? ', today' : ''}: ${what}`;
    return `<li class="pw-day" role="presentation" data-key="d${e.day}" data-kind="${e.kind}"${e.isToday ? ' data-today' : ''}${e.isPast ? ' data-past' : ''}>
      <button type="button" class="pw-pill" role="tab" aria-selected="${sel}" tabindex="${e.day === focusDay ? 0 : -1}" data-act="planPick" data-arg="${e.day}"${e.canMove ? ' data-drag' : ''} aria-label="${U.esc(label)}">
        <span class="pw-wd">${U.esc(e.letter)}</span><span class="pw-num rf-num">${e.num}</span>${markHtml(k)}
      </button></li>`;
  }
  function strip(w, day, page) {
    const pageHtml = (list, idx) => {
      const at = list.findIndex((x) => x.day === view.day);
      const focusDay = at >= 0 ? view.day : (list.find((x) => x.isToday) || list[0]).day;
      return `<div class="pw-page" data-key="p${idx}" style="--n:${idx}"${idx !== page ? ' aria-hidden="true" inert' : ''}>
        <span class="pw-sel${at < 0 ? ' is-off' : ''}" aria-hidden="true" style="--i:${Math.max(0, at)}"></span>
        <ul class="plan-list pw-days" role="tablist" aria-label="${idx ? 'Next week' : 'This week'}">${list.map((e) => pill(e, day, focusDay)).join('')}</ul>
      </div>`;
    };
    const first = page ? w.next.ws : w.ws;
    return `<div class="card pw-strip" data-key="strip">
      <div class="pw-head">
        <p class="pw-head-text"><span class="t-headline">${page ? 'Next week' : 'This week'}</span> <span class="t-footnote rf-muted">${U.esc(range(first))}</span></p>
        ${page ? `<button type="button" class="rf-btn pw-wk" data-variant="plain" data-size="sm" data-act="planWeek" data-arg="0">${U.icon('chevron-left')}This week</button>`
    : `<button type="button" class="rf-btn pw-wk" data-variant="plain" data-size="sm" data-act="planWeek" data-arg="1">Next week${U.icon('chevron-right')}</button>`}
      </div>
      <div class="pw-viewport"><div class="pw-track" style="--page:${page}">${pageHtml(w.days, 0)}${pageHtml(w.next.days, 1)}</div></div>
    </div>`;
  }

  /* ---------------------------------------------------------------- the day card */
  function top(icon, label, tone, right) {
    return `<div class="pw-top"><span class="pw-eyebrow"${tone ? ` data-tone="${tone}"` : ''}>${icon ? U.icon(icon) : ''}<span>${U.esc(label)}</span></span>${right || ''}</div>`;
  }
  const minutes = (n, label) => (n ? `<span class="pw-min" aria-label="${U.esc(label || `about ${n} minutes`)}">${U.icon('timer')}<span>${U.roll(n)} min</span></span>` : '');
  const tags = (groups) => (groups && groups.length ? `<div class="pw-tags" aria-label="Muscles">${groups.map((g) => `<span class="pw-tag" style="--c:${hue(g)}">${U.esc(B().GROUP_NAME[g] || g)}</span>`).join('')}</div>` : '');
  function exRow(o) {
    const inner = `${o.move ? `<span class="pw-thumb" data-morph="keep" data-move="${U.esc(o.move)}" aria-hidden="true"></span>` : `<span class="pw-thumb is-icon" aria-hidden="true">${U.icon(o.icon || 'sun')}</span>`}
      <span class="pw-ex-text"><span class="pw-ex-name">${U.esc(o.name)}${o.tag ? ` <span class="pw-ss">${U.esc(o.tag)}</span>` : ''}</span>${o.meta ? `<span class="pw-ex-meta">${o.meta}</span>` : ''}</span>
      ${o.badge || ''}${o.move ? `<span class="pw-ex-go">${U.icon('chevron-right')}</span>` : ''}`;
    return `<li class="pw-ex${o.cls ? ' ' + o.cls : ''}" data-key="x-${U.esc(o.key)}">${o.move
      ? `<button type="button" class="pw-ex-row" data-act="planMoveInfo" data-arg="${U.esc(o.move)}">${inner}</button>`
      : `<div class="pw-ex-row">${inner}</div>`}</li>`;
  }
  // The session's exercises: warm-up, tests, the main moves (supersets lettered), the extra lead-side
  // set, the finisher and the cool-down, each with a still of the move.
  function sessionList(S, s) {
    const rows = [];
    const lead = (S.catchup && S.catchup.arm && S.catchup.arm.side) || 'L';
    if (s.warmup && s.warmup.length) rows.push(exRow({ key: 'warmup', icon: 'sun', name: 'Warm-up', meta: U.esc(U.cap(s.warmup.map((x) => x.name.toLowerCase()).join(', '))), cls: 'is-muted' }));
    for (const t of s.tests || []) rows.push(exRow({ key: `t-${t.moveId}`, move: t.moveId, name: t.name, meta: `${U.esc(U.side(t.side))} side first, as many as you can`, cls: 'is-lead' }));
    const extra = (x) => exRow({ key: `x-${x.uid || x.moveId}`, move: x.moveId, name: x.name, meta: `Extra set, ${U.esc(U.side(x.leadOnly || lead).toLowerCase())} side only · ${U.esc(U.target(x))}`, cls: 'is-lead' });
    for (const it of s.items) {
      const load = it.load && it.load.label ? ` · ${U.esc(it.load.label.replace(/ (dumbbells?|kettlebell)$/, ''))}` : '';
      rows.push(exRow({ key: `${it.uid || ''}-${it.moveId}`, move: it.moveId, name: it.name, tag: it.superset || '', meta: `${it.sets} × ${U.esc(U.target(it))}${it.uni ? ' each side' : ''}${load}${it.swappedFrom ? ' · swapped' : ''}` }));
      for (const x of s.extras || []) if (x.fam === it.fam) rows.push(extra(x));
    }
    for (const x of s.extras || []) if (!s.items.some((it) => it.fam === x.fam)) rows.push(extra(x));
    if (s.finisher) rows.push(exRow({ key: `fin-${s.finisher.moveId}`, move: s.finisher.moveId, name: `Finisher: ${s.finisher.name.toLowerCase()}`, meta: `${s.finisher.rounds} rounds · ${s.finisher.work} s on, ${s.finisher.rest} s off` }));
    for (const mb of s.mobility || []) rows.push(exRow({ key: `mob-${mb.moveId}`, move: mb.moveId, name: mb.name, meta: `Cool-down · ${mb.target} s` }));
    const ss = s.items.some((it) => it.superset);
    return `<ul class="pw-ex-list">${rows.join('')}</ul>${ss ? '<p class="t-footnote rf-muted pw-note">Moves with the same letter are a superset: do them back to back, then rest.</p>' : ''}`;
  }
  // A saved workout's exercises, with what was done.
  function logList(l) {
    const rows = l.items.map((x, i) => {
      const unit = x.timed ? 's' : 'reps';
      const same = x.amounts.every((a) => a === x.amounts[0]);
      const amt = same ? `${x.sets} × ${x.amounts[0]} ${unit}` : `${x.amounts.join(', ')} ${unit}`;
      const meta = `${x.extra ? 'Extra set · ' : ''}${amt}${x.uni ? ' each side' : ''}${x.load != null ? ` · ${fmtLoad(x.load)}` : ''}`;
      const badge = x.outcome === 'up' ? `<span class="pw-up" role="img" aria-label="Goes up next time">${U.icon('arrow-up-right')}</span>` : '';
      return exRow({ key: `l${i}-${x.moveId}`, move: x.moveId, name: x.name, meta: U.esc(meta), badge, cls: x.extra ? 'is-lead' : '' });
    });
    const up = l.items.some((x) => x.outcome === 'up');
    return rows.length ? `<ul class="pw-ex-list">${rows.join('')}</ul>${up ? `<p class="t-footnote rf-muted pw-note pw-up-note"><span class="pw-up" aria-hidden="true">${U.icon('arrow-up-right')}</span>Goes up next time: more reps, more weight or a harder version.</p>` : ''}` : '';
  }

  function actions(w, e) {
    const out = [];
    if (e.kind === 'today') {
      out.push(e.active
        ? `<button type="button" class="rf-btn pw-go" data-variant="filled" data-size="lg" data-act="resumeWorkout">${U.icon('play')}Resume</button>`
        : `<button type="button" class="rf-btn pw-go" data-variant="filled" data-size="lg" data-act="planStart">${U.icon('play')}Start workout</button>`);
    }
    if (e.canMove) {
      const open = view.moving === e.day;
      out.push(`<button type="button" class="rf-btn pw-mv" data-variant="${e.kind === 'today' ? 'gray' : 'soft'}" data-size="lg" data-act="planMoveOpen" data-arg="${e.day}" aria-expanded="${open}">${U.icon(open ? 'close' : 'calendar')}${open ? 'Cancel' : e.kind === 'today' ? 'Move' : 'Move to another day'}</button>`);
    }
    const train = e.canTrainToday && w.trainToday ? `<button type="button" class="rf-btn pw-train" data-variant="plain" data-act="planTrainToday">${U.icon('bolt')}Train today instead</button>` : '';
    return (out.length ? `<div class="pw-actions">${out.join('')}</div>` : '') + train;
  }
  function movePanel(e, day) {
    if (view.moving !== e.day || !e.canMove) return '';
    return `<div class="pw-move" data-key="move">
      <p class="t-subhead">Move it to</p>
      <div class="pw-move-chips">${e.moveTo.map((x) => `<button type="button" class="rf-chip pw-chip" data-act="planMoveTo" data-arg="${e.day}:${x}">${U.esc(chipName(x, day))}</button>`).join('')}</div>
      <p class="t-footnote rf-muted">Free days left this week. Two workouts never share a day.</p>
    </div>`;
  }

  function workoutBody(S, w, e, day) {
    const s = e.session;
    const a = e.active;
    const head = e.preview ? top('calendar', e.date, '', minutes(e.estimateMin))
      : a ? top('timer', 'In progress', 'accent', minutes(e.estimateMin))
        : top('bolt', e.isToday ? 'Today' : when(e, day), e.isToday ? 'accent' : '', minutes(e.estimateMin));
    const moved = e.movedFrom != null ? `<p class="t-footnote rf-muted pw-note">Moved here from ${U.esc(B().fmtDay(e.movedFrom))}.</p>` : '';
    return `${head}
      <h2 class="t-title-2 pw-title">${U.esc(e.title)}</h2>
      ${tags(e.groups)}
      ${a ? `<div class="pw-prog">${U.progress(a.done / Math.max(1, a.total), 'Workout progress')}<span class="t-footnote rf-muted rf-num">${a.done} of ${a.total} sets</span></div>` : ''}
      ${moved}
      ${e.preview ? '<p class="t-footnote rf-muted pw-note">A preview. Sets and exercises adjust to how this week goes.</p>' : actions(w, e) + movePanel(e, day)}
      ${s ? sessionList(S, s) : ''}`;
  }
  function doneBody(e, day) {
    const l = e.log;
    const bits = [`${l.doneSets} of ${l.planned} sets`];
    if (l.rating) bits.push(RATING[l.rating] || '');
    return `${top('check-circle', `Done · ${when(e, day)}`, 'positive', l.minutes ? minutes(l.minutes, `${l.minutes} minutes`) : '')}
      <h2 class="t-title-2 pw-title">${U.esc(e.title)}</h2>
      <p class="t-callout rf-muted">${U.esc(bits.filter(Boolean).join(' · '))}</p>
      ${tags(e.groups)}
      ${logList(l)}`;
  }
  function missedBody(w, e, day) {
    const frozen = e.kind === 'frozen';
    const l = e.log;
    const moved = `The rest of the week moved a day${w.dropped ? ' (the last workout no longer fit)' : ''}, so nothing doubles up.`;
    return `${top(frozen ? 'pause' : 'x-circle', `${frozen ? 'Freeze used' : 'Missed'} · ${when(e, day)}`, frozen ? 'sky' : 'critical')}
      <h2 class="t-title-2 pw-title">${frozen ? 'Missed, streak kept' : 'Missed workout'}</h2>
      <p class="t-callout">${frozen ? 'A freeze covered it.' : 'Your streak restarted.'} ${U.esc(moved)}</p>
      ${l && !l.counted ? `<p class="t-footnote rf-muted">You logged ${l.doneSets} of ${l.planned} sets. A workout counts once half of it is done.</p>` : ''}`;
  }
  function lightBody(S, w, e, day) {
    const L = e.light || { walk: false, mobility: false, walkMin: 12 };
    const today = e.isToday;
    const h = today ? (S.health && S.health.days && S.health.days[day]) || {} : {};
    const walkSub = L.walk ? (L.walkSrc === 'health-steps' ? 'Ticked from your steps' : L.walkSrc === 'health-walk' ? 'Ticked from Health Connect' : 'Done')
      : today && h.steps != null ? `${U.num(h.steps)} steps so far today` : 'Any pace. Outside if you can.';
    const flow = B().mobilityFlow ? B().mobilityFlow(S) : [];
    const mins = Math.max(1, Math.round(flow.reduce((a, m) => a + (m.target || 30) * (m.uni ? 2 : 1), 0) / 60));
    const check = (done, icon, title, sub, btn, extra, key) => `<li class="pw-check${done ? ' is-done' : ''}" data-key="${key}">
        <span class="pw-check-mark" data-key="${key}-${done ? 'y' : 'n'}"${done ? ' role="img" aria-label="Done"' : ' aria-hidden="true"'}>${U.icon(done ? 'check' : icon)}</span>
        <span class="pw-check-text"><span class="t-subhead">${U.esc(title)}</span><span class="t-footnote rf-muted">${U.esc(sub)}</span></span>
        ${done ? '' : btn || ''}${extra || ''}</li>`;
    const mob = flow.length ? `<div class="pw-mob" aria-label="Mobility moves">${flow.map((m) => `<button type="button" class="pw-mob-btn" data-act="planMoveInfo" data-arg="${U.esc(m.moveId)}" aria-label="${U.esc(m.name)}: how to do it"><span class="pw-thumb" data-morph="keep" data-move="${U.esc(m.moveId)}" aria-hidden="true"></span></button>`).join('')}</div>` : '';
    const label = today ? 'Today · Light day' : `Light day · ${when(e, day)}`;
    const lead = e.preview || !e.isPast || L.done ? 'A walk and a short mobility flow. Do both and the day counts toward your streak.' : 'Not ticked off. Light days only add to your streak, so nothing is lost.';
    return `${top(L.done ? 'check-circle' : 'leaf', e.preview ? `Light day · ${e.date}` : label, L.done ? 'positive' : 'teal')}
      <h2 class="t-title-2 pw-title">Walk and mobility</h2>
      <p class="t-callout rf-muted">${U.esc(lead)}</p>
      <ul class="pw-checks">
        ${check(L.walk, 'navigate', `Walk ${L.walkMin}+ min`, walkSub, today ? '<button type="button" class="rf-btn" data-size="sm" data-act="logWalk">Log walk</button>' : '', '', 'walk')}
        ${check(L.mobility, 'leaf', 'Mobility flow', `${U.plural(flow.length || 5, 'move')}, about ${mins} min`, today ? '<button type="button" class="rf-btn" data-size="sm" data-act="startMobility">Start</button>' : '', mob, 'mob')}
      </ul>
      ${today && w.trainToday ? `<button type="button" class="rf-btn pw-train" data-variant="plain" data-act="planTrainToday">${U.icon('bolt')}Train today instead: ${U.esc(w.trainToday.title.toLowerCase())}</button>` : ''}`;
  }
  function restBody(w, e, day) {
    const next = w.days.find((x) => x.day > e.day && (x.kind === 'today' || x.kind === 'workout'));
    const label = e.preview ? `Rest day · ${e.date}` : e.isToday ? 'Today · Rest day' : `Rest day · ${when(e, day)}`;
    return `${top('moon', label, 'indigo')}
      <h2 class="t-title-2 pw-title">Rest and recover</h2>
      <p class="t-callout rf-muted">${next && !e.preview ? `Nothing planned. Next: ${U.esc(next.title.toLowerCase())} on ${U.esc(next.wdLong)}.` : 'Nothing planned. Muscles grow while you rest.'}</p>
      ${e.isToday && w.trainToday ? `<button type="button" class="rf-btn pw-train" data-variant="plain" data-act="planTrainToday">${U.icon('bolt')}Train today instead: ${U.esc(w.trainToday.title.toLowerCase())}</button>` : ''}`;
  }
  function beforeBody(S, e) {
    const st = S.profile.startDay;
    return `${top('', `Before your plan · ${e.date}`, '')}
      <h2 class="t-title-2 pw-title">Before you started</h2>
      <p class="t-callout rf-muted">${st != null ? `Your plan began on ${U.esc(B().fmtDay(st))}.` : ''}</p>`;
  }
  function dayCard(S, w, e, day) {
    if (!e) return '';
    let body;
    if (e.kind === 'today' || e.kind === 'workout') body = workoutBody(S, w, e, day);
    else if (e.kind === 'done' && e.log) body = doneBody(e, day);
    else if (e.kind === 'missed' || e.kind === 'frozen') body = missedBody(w, e, day);
    else if (e.kind === 'light') body = lightBody(S, w, e, day);
    else if (e.kind === 'rest') body = restBody(w, e, day);
    else body = beforeBody(S, e);
    return `<div class="card pw-card" data-key="day" data-kind="${e.kind}"${e.isToday ? ' data-today' : ''}${e.preview ? ' data-preview' : ''} role="tabpanel" aria-label="${U.esc(`${e.wdLong}, ${e.short}`)}">
      <div class="pw-card-in">${body}</div></div>`;
  }

  /* ---------------------------------------------------------------- below the card */
  // Each part stays on one line when the summary wraps.
  const keep = (t) => U.esc(t).replace(/ /g, '\u00a0');
  function summary(w) {
    const bits = [`Week ${w.trainingWeek}`, PHASE[w.phase.key]];
    const done = w.planned ? ` · <span class="pw-nb">${U.roll(w.done)}\u00a0of\u00a0${w.planned}\u00a0done</span>` : '';
    return `<p class="lt-sub t-callout rf-muted pw-sub">${bits.map(keep).join(' · ')}${done}<button type="button" class="pw-info" data-act="planPhase" aria-label="What ${U.esc(PHASE[w.phase.key].toLowerCase())} means, and how to read the week">${U.icon('info')}</button></p>`;
  }
  function muscles(w) {
    const rows = w.muscles;
    if (!rows.length) return '';
    const short = rows.filter((r) => r.planned < r.target).map((r) => r.name.toLowerCase());
    const li = rows.map((r) => {
      const max = Math.max(r.target, r.planned, r.done, 1);
      const pct = (v) => `${(Math.min(v, max) / max * 100).toFixed(1)}%`;
      return `<li class="pw-mu" data-key="mu-${r.group}" style="--c:${hue(r.group)}">
        <span class="pw-mu-name t-subhead">${U.esc(r.name)}</span>
        <span class="pw-bar" role="img" aria-label="${U.esc(`${r.name}: ${r.done} of ${r.target} sets done, ${r.planned} in this week's plan`)}"><span class="pw-bar-plan" style="width:${pct(r.planned)}"></span><span class="pw-bar-done" style="width:${pct(r.done)}"></span><span class="pw-bar-target" style="left:${pct(r.target)}"></span></span>
        <span class="pw-mu-n t-footnote rf-num"><b>${U.roll(r.done)}</b> of ${r.target}</span>
      </li>`;
    }).join('');
    return `<h2 class="sec-title t-title-3">This week by muscle</h2>
      <div class="section"><div class="card pw-mus-card" data-key="mus">
        <ul class="pw-mus">${li}</ul>
        <p class="pw-legend t-caption rf-muted" aria-hidden="true"><span><i class="pw-sw is-done"></i>Sets done</span><span><i class="pw-sw is-plan"></i>In the plan</span><span><i class="pw-sw is-target"></i>Weekly target</span></p>
        ${short.length ? `<p class="t-footnote rf-muted">${short.length > 3 ? 'Your time per workout fits fewer sets than your weekly targets.' : `Your time per workout fits fewer sets than the target for ${U.esc(listWords(short))}.`} A few more minutes a workout closes the gap.</p>` : ''}
      </div></div>`;
  }
  function comingUp(w) {
    const n = w.next;
    const work = n.days.filter((e) => e.kind === 'workout');
    const light = n.days.filter((e) => e.kind === 'light').map((e) => e.wdLong);
    const rows = work.map((e) => `<li data-key="cu-${e.day}"><button type="button" class="rf-list-row pw-cu-row" data-act="planPick" data-arg="${e.day}" aria-label="${U.esc(`${e.wdLong}, ${e.short}: ${e.title}`)}">
        <span class="pw-cu-date" aria-hidden="true"><span>${U.esc(e.wd)}</span><b class="rf-num">${e.num}</b></span>
        <span class="rf-list-text"><span class="rf-list-title">${U.esc(e.title)}</span></span>
        <span class="rf-list-chevron">${U.icon('chevron-right')}</span></button></li>`).join('');
    const foot = [light.length ? `Light days on ${listWords(light)}.` : '', n.newSchedule ? 'Your new days start here.' : ''].filter(Boolean).join(' ');
    return `<h2 class="sec-title t-title-3">Coming up</h2>
      <div class="section">
        <h3 class="rf-list-header">Next week · ${U.esc(range(n.ws))}</h3>
        ${rows ? `<ul class="rf-list pw-cu" data-key="cu">${rows}</ul>` : '<p class="t-callout rf-muted">No workouts planned next week.</p>'}
        ${foot ? `<p class="rf-list-footer">${U.esc(foot)}</p>` : ''}
      </div>`;
  }
  function makeItYours(S) {
    const p = S.profile;
    const rows = [];
    if (U.act.tailorPlan) rows.push(U.row({ icon: 'sparkle', tone: 'violet', title: 'Tailor my plan', act: 'tailorPlan', chevron: true }));
    rows.push(U.row({ icon: 'calendar', tone: 'sky', title: 'Days and time', sub: U.esc(`${U.plural(p.days, 'workout')} a week · ${p.minutes} min each`), act: 'daysSheet', chevron: true }));
    if (U.editAnswers) rows.push(U.row({ icon: 'bag', tone: 'amber', title: 'Equipment', sub: U.equipSummary ? U.esc(U.equipSummary(p)) : '', act: 'planEquipment', chevron: true }));
    if (U.hasTab && !U.hasTab('moves')) rows.push(U.row({ icon: 'library', tone: 'indigo', title: 'All moves', sub: 'Every exercise, your level in each and how to do it', act: 'openMoves', chevron: true }));
    return `<h2 class="sec-title t-title-3">Make it yours</h2>
      <div class="section"><ul class="rf-list" data-key="mine">${rows.join('')}</ul></div>`;
  }

  /* ---------------------------------------------------------------- the screen */
  U.screens.plan = {
    render(S, day) {
      const w = week(S, day);
      syncView(w, day);
      const page = view.day > w.last ? 1 : 0;
      return `${U.navbar('Plan', `<button type="button" class="rf-btn rf-glass pw-sched" data-lens data-act="daysSheet" aria-label="Schedule: days and time">${U.icon('calendar')}<span class="pw-sched-label">Schedule</span></button>`)}
        <h1 class="rf-large-title">Plan</h1>
        ${summary(w)}
        <div class="section pw-main">
          ${U.tip ? U.tip('plan') : ''}
          ${strip(w, day, page)}
          ${dayCard(S, w, findDay(w, view.day), day)}
        </div>
        ${muscles(w)}
        ${comingUp(w)}
        ${makeItYours(S)}`;
    },
    after(screen, S, day) {
      const st = screen.querySelector('.pw-strip');
      if (st) wireStrip(st);
      travel(screen);
      drawThumbs(screen, S, day);
    },
  };

  /* ---------------------------------------------------------------- motion */
  // The selection slides like a drop of glass: it stretches while it travels, then settles.
  let lastSel = null;
  function travel(screen) {
    const vp = screen.querySelector('.pw-viewport');
    if (!vp) { lastSel = null; return; }
    const page = Number(vp.querySelector('.pw-track').style.getPropertyValue('--page')) || 0;
    const sel = vp.querySelectorAll('.pw-sel')[page];
    if (!sel) return;
    const now = `${page}:${sel.style.getPropertyValue('--i').trim()}`;
    if (lastSel && lastSel !== now && lastSel.split(':')[0] === String(page) && !U.reduced()) {
      sel.setAttribute('data-traveling', '');
      clearTimeout(sel._t);
      sel._t = setTimeout(() => sel.removeAttribute('data-traveling'), 240);
    }
    lastSel = now;
  }
  // The picked day's card slides in from the side it came from.
  function slideCard(dir) {
    if (U.reduced()) return;
    const el = doc.querySelector('#screen .pw-card-in');
    if (!el || !el.animate) return;
    el.animate([{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE });
  }
  function scrollToStrip() {
    const scr = U.els().screen, st = doc.querySelector('#screen .pw-strip');
    if (!scr || !st) return;
    const bar = (U.els().topbar && U.els().topbar.offsetHeight) || 0;
    const top = st.getBoundingClientRect().top - scr.getBoundingClientRect().top + scr.scrollTop - bar - 8;
    if (top < scr.scrollTop) scr.scrollTo({ top: Math.max(0, top), behavior: U.reduced() ? 'auto' : 'smooth' });
  }

  /* ---------------------------------------------------------------- still figures */
  // Each move's key pose, drawn once and cloned into every tile that shows it. A figure is slow to
  // draw the first time, so new ones are drawn while the phone is idle and fade into their tiles:
  // the screen never waits for them.
  const stills = new Map(); // `${moveId}|${place}` → svg, cropped to the figure
  const queue = new Set(); // keys still to draw
  let pending = 0;
  let drawFor = null; // { S, day } the queued stills are for
  function fill(host, svg) {
    host.textContent = '';
    host.appendChild(svg.cloneNode(true));
    host.setAttribute('data-drawn', host.getAttribute('data-move'));
  }
  function drawThumbs(root, S, day) {
    if (!GH.pose || !M()) return;
    const place = B().placeOf ? B().placeOf(S, day) : 'home';
    for (const host of root.querySelectorAll('.pw-thumb[data-move]')) {
      const id = host.getAttribute('data-move');
      if (host.getAttribute('data-drawn') === id && host.firstElementChild) continue;
      const svg = stills.get(`${id}|${place}`);
      if (svg) fill(host, svg);
      else { if (host.firstElementChild) host.textContent = ''; queue.add(`${id}|${place}`); }
    }
    drawFor = { S, day };
    if (queue.size && !pending) pending = idle(drawSome);
  }
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 150 }) : setTimeout(() => fn(null), 16));
  function drawSome(deadline) {
    pending = 0;
    const t0 = Date.now();
    for (const key of queue) {
      queue.delete(key);
      const svg = drawStill(key);
      const id = key.split('|')[0];
      if (svg) for (const host of doc.querySelectorAll('.pw-thumb[data-move]')) if (host.getAttribute('data-move') === id && !host.firstElementChild) fill(host, svg);
      if (deadline ? deadline.timeRemaining() < 10 : Date.now() - t0 > 12) break;
    }
    if (queue.size) pending = idle(drawSome);
  }
  function drawStill(key) {
    const id = key.split('|')[0];
    const m0 = M().MOVES[id];
    if (!m0 || !drawFor) return null;
    const { S, day } = drawFor;
    const m = M().forPerson ? M().forPerson(m0, B().eqFor ? B().eqFor(S, day) : S.profile.equipment) : m0;
    // Drawn in a hidden box on the page, so the figure's size can be measured for the crop.
    const box = doc.createElement('div');
    box.className = 'pw-measure';
    doc.body.appendChild(box);
    let svg = null;
    try {
      const tl = m.$tl || (m.$tl = GH.pose.timeline(m));
      svg = GH.pose.still(box, m, m.key || tl.steps[0].to, {});
      const vb = svg && tightBox(svg);
      if (vb) svg.setAttribute('viewBox', vb);
    } catch (e) { svg = null; }
    box.remove();
    if (!svg) return null;
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-label');
    stills.set(key, svg);
    return svg;
  }
  // The figure's own bounds (the body and any bench or chair, not the floor line), with room for the
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
      y1 = Math.max(y1, 1.5);
      return `${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${(x1 - x0 + 2 * pad).toFixed(1)} ${(y1 - y0 + 1.6 * pad).toFixed(1)}`;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- gestures */
  // Swipe the strip for next week (it follows the finger); a long press on a workout picks it up to
  // drop on a free day.
  const wired = new WeakSet();
  let blockClick = 0;
  function wireStrip(stripEl) {
    const vp = stripEl.querySelector('.pw-viewport');
    if (!vp || wired.has(vp)) return;
    wired.add(vp);
    let g = null;
    const track = () => vp.querySelector('.pw-track');
    const pageOf = () => Number(track().style.getPropertyValue('--page')) || 0;
    vp.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      g = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, t: ev.timeStamp, v: 0, mode: null, w: vp.clientWidth || 1, page: pageOf() };
      const p = ev.target.closest && ev.target.closest('.pw-pill[data-drag]');
      if (p && g.page === 0) g.hold = setTimeout(() => startDrag(ev, p), 420);
    });
    vp.addEventListener('pointermove', (ev) => {
      if (!g || ev.pointerId !== g.id) return;
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
      if (g.mode === 'drag') { moveDrag(ev); return; }
      if (!g.mode) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(g.hold);
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          g.mode = 'swipe';
          try { vp.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
          vp.setAttribute('data-swiping', '');
        } else if (Math.abs(dy) > 12) { g = null; return; } else return;
      }
      // Past either end it gives, like a rubber band.
      let off = dx;
      if (g.page === 0 && off > 0) off *= 0.3;
      else if (g.page === 1 && off < 0) off *= 0.3;
      off = Math.max(-g.w, Math.min(g.w, off));
      track().style.setProperty('--drag', `${off.toFixed(1)}px`);
      const dt = ev.timeStamp - g.t;
      if (dt > 0) g.v = 0.7 * ((ev.clientX - g.x) / dt) + 0.3 * g.v;
      g.x = ev.clientX; g.t = ev.timeStamp;
    });
    const end = (ev) => {
      if (!g || ev.pointerId !== g.id) return;
      const was = g;
      g = null;
      clearTimeout(was.hold);
      if (was.mode === 'drag') { endDrag(ev, was); return; }
      if (was.mode !== 'swipe') return;
      vp.removeAttribute('data-swiping');
      const dx = ev.clientX - was.x0;
      let page = was.page;
      if (ev.type !== 'pointercancel') {
        if (dx < -was.w * 0.22 || was.v < -0.3) page = 1;
        else if (dx > was.w * 0.22 || was.v > 0.3) page = 0;
      }
      track().style.removeProperty('--drag');
      blockClick = Date.now() + 350;
      if (page !== was.page) showWeek(page);
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('click', (ev) => { if (Date.now() < blockClick) { ev.stopPropagation(); ev.preventDefault(); } }, true);
    vp.addEventListener('contextmenu', (ev) => ev.preventDefault());
    // Keyboard: arrows move between the days of the week shown, Home and End go to either end.
    vp.addEventListener('keydown', (ev) => {
      const p = ev.target.closest && ev.target.closest('.pw-pill');
      if (!p) return;
      const list = Array.from(p.closest('.pw-days').querySelectorAll('.pw-pill'));
      const i = list.indexOf(p);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[ev.key];
      if (to == null) return;
      ev.preventDefault();
      if (to < 0 || to >= list.length || to === i) return;
      const d = list[to].dataset.arg;
      U.act.planPick(list[to]);
      const again = vp.querySelector(`.pw-pill[data-arg="${d}"]`);
      if (again) again.focus();
    });
    // While a workout is picked up, the finger moves it, not the page.
    vp.addEventListener('touchmove', (ev) => { if (drag && ev.cancelable) ev.preventDefault(); }, { passive: false });

    let drag = null;
    function startDrag(ev, p) {
      if (!g || g.mode) return;
      const li = p.closest('.pw-day');
      const from = Number(p.dataset.arg);
      const w = week(U.S, U.today());
      const e = w.days.find((x) => x.day === from);
      if (!e || !e.canMove) return;
      g.mode = 'drag';
      try { vp.setPointerCapture(g.id); } catch (e2) { /* ignore */ }
      const cells = Array.from(vp.querySelectorAll('.pw-page')[0].querySelectorAll('.pw-day'));
      drag = { li, from, ok: new Set(e.moveTo), cells, rects: cells.map((c) => c.getBoundingClientRect()), x0: g.x0, over: null };
      li.setAttribute('data-lifted', '');
      stripEl.setAttribute('data-dragging', '');
      for (const c of cells) if (drag.ok.has(Number(c.querySelector('.pw-pill').dataset.arg))) c.setAttribute('data-drop', '');
      U.haptic('heavy');
    }
    function moveDrag(ev) {
      if (!drag) return;
      const dx = ev.clientX - drag.x0;
      drag.li.style.transform = `translate3d(${dx.toFixed(1)}px,-4px,0) scale(1.08)`;
      const i = drag.rects.findIndex((r) => ev.clientX >= r.left && ev.clientX <= r.right);
      const d = i >= 0 ? Number(drag.cells[i].querySelector('.pw-pill').dataset.arg) : null;
      const over = d != null && drag.ok.has(d) ? d : null;
      if (over !== drag.over) {
        for (const c of drag.cells) c.removeAttribute('data-over');
        if (over != null) { drag.cells[i].setAttribute('data-over', ''); U.haptic('select'); }
        drag.over = over;
      }
    }
    function endDrag(ev) {
      const dr = drag;
      drag = null;
      if (!dr) return;
      blockClick = Date.now() + 350;
      stripEl.removeAttribute('data-dragging');
      for (const c of dr.cells) { c.removeAttribute('data-over'); c.removeAttribute('data-drop'); }
      dr.li.removeAttribute('data-lifted');
      dr.li.style.transform = '';
      if (ev.type !== 'pointercancel' && dr.over != null) moveTo(dr.from, dr.over);
    }
  }

  /* ---------------------------------------------------------------- actions */
  U.act.planPick = (el) => {
    const d = Number(el.dataset.arg);
    const w = week(U.S, U.today());
    if (!isFinite(d) || !findDay(w, d)) return;
    const prev = view.day;
    const fromList = !!(el.closest && el.closest('.pw-cu'));
    view.day = d;
    view.moving = null;
    U.haptic('select');
    U.render();
    if (prev !== d) slideCard(d > prev ? 1 : -1);
    if (fromList) scrollToStrip();
  };
  function showWeek(page) {
    const w = week(U.S, U.today());
    const inNext = view.day > w.last;
    if ((page === 1) === inNext) return;
    view.day = page ? Math.min(w.next.last, view.day + 7) : Math.max(w.ws, view.day - 7);
    view.moving = null;
    U.haptic('select');
    U.render();
    slideCard(page ? 1 : -1);
  }
  U.act.planWeek = (el) => showWeek(Number(el.dataset.arg) ? 1 : 0);
  U.act.planMoveOpen = (el) => {
    const d = Number(el.dataset.arg);
    view.moving = view.moving === d ? null : d;
    U.haptic('select');
    U.render();
  };
  function moveTo(from, to) {
    const S = U.S, day = U.today();
    const e = findDay(week(S, day), from);
    const title = e ? e.title : 'Workout';
    view.moving = null;
    if (!B().moveSession(S, from, to, day)) { U.toast('Couldn\'t move it there', 'caution'); U.render(); return; }
    view.day = to;
    U.commit();
    slideCard(to > from ? 1 : -1);
    U.toast(`Moved to ${B().fmtDay(to)}`, 'positive', title, { label: 'Undo', onClick: () => undoMove(from, to, day) });
  }
  // Undo takes back exactly the move that was added (unless that workout has been started since).
  function undoMove(from, to, at) {
    const S = U.S;
    if (S.active && S.active.day === to) return;
    const i = S.events.map((e) => e.type === 'move' && e.from === from && e.to === to && e.at === at).lastIndexOf(true);
    if (i < 0) return;
    S.events.splice(i, 1);
    if (view.day === to) view.day = from;
    U.haptic('select');
    U.commit();
  }
  U.act.planMoveTo = (el) => {
    const [from, to] = String(el.dataset.arg).split(':').map(Number);
    if (isFinite(from) && isFinite(to)) moveTo(from, to);
  };
  U.act.planStart = () => { U.go('today'); U.act.startWorkout(); };
  // The next workout, today: the same flow as Today's "Train today instead" (cancelling it puts the
  // week back as it was).
  U.act.planTrainToday = async () => {
    const ok = await U.confirm('Train today instead?', 'The next workout moves to today and the rest of the week follows it.', 'Train today');
    if (!ok) return;
    U.go('today');
    U.act.startWorkout();
  };
  U.act.planMoveInfo = (el) => U.moveSheet(el.dataset.arg);
  U.act.planEquipment = () => U.editAnswers('equipment');
  U.act.openMoves = () => U.go('moves');
  U.act.planWhy = (el) => { U.closeSheets(); U.open('science', el.dataset.arg); };
  // What this week's phase means, and how to read the marks on the strip.
  U.act.planPhase = () => {
    const w = week(U.S, U.today());
    const ph = w.phase;
    const text = {
      full: 'This week you do every set your plan calls for. About every fifth week is a lighter deload week, so tiredness can clear and you keep getting stronger.',
      deload: `A lighter week: about ${100 - ph.pct}% fewer sets than usual, so built-up tiredness can clear. Your weights and levels stay where they are, and next week you're back to full volume.`,
      onramp: `Your first weeks use about ${ph.pct}% of the full number of sets while your body gets used to training.${ph.fullFrom ? ` Full volume starts in week ${ph.fullFrom}.` : ''}`,
      comeback: `After more than a week without a workout, this week eases back in with about ${ph.pct}% of the sets. Strength comes back quickly once you start again.`,
    }[ph.key];
    const key = [['work', 'A workout'], ['done', 'Done'], ['light', 'Light day: a walk and a short mobility flow'], ['missed', 'Missed: the rest of the week moves a day'], ['frozen', 'Freeze used: missed, but the streak is kept (one a week)']];
    const why = ph.key === 'comeback' ? ['comeback', 'How coming back works'] : ['deload', 'How deload weeks work'];
    U.sheet({
      title: PHASE[ph.key], size: 'fit',
      body: `<div class="sheet-pad pw-sheet">
        <p class="t-body">${U.esc(text)}</p>
        <p class="t-headline pw-key-title">Reading your week</p>
        <ul class="pw-key">${key.map(([k, t]) => `<li><span class="pw-key-mark">${markHtml(k)}</span><span class="t-callout">${U.esc(t)}</span></li>`).join('')}</ul>
        <div class="pw-why"><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="planWhy" data-arg="${why[0]}">${U.esc(why[1])}</button><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="planWhy" data-arg="habits">Why missed days work this way</button></div>
      </div>`,
    });
  };
  // Opens the Plan tab on a day (for other screens).
  U.planShow = (d) => { U.go('plan'); if (d != null) { view.route = U.route; view.today = U.today(); view.day = d; view.moving = null; U.render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
