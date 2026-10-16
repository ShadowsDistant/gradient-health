/* Your plans, the screens and sheets (a part of its own, 'planUi' in scripts/build.mjs, loaded the
 * first time one is wanted; src/ui/customplan.js has the rest, and stands in until this is in): the
 * Plans page, a plan's page where it's built like a playlist (add exercises, set sets and reps, drag
 * to reorder, this week by muscle), the exercise picker, one exercise, New plan with ready-made
 * plans, sharing as a QR code or a link, a shared plan's preview, Build me a plan with the coach,
 * and Improve.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;
  const C = () => GH.customPlan;
  const doc = G.document;
  const { WD, WD_LONG, GROUP_HUE, FILTERS, SMALL, LARGE, hue, groupName, listWords, firstName, thumb, art, standIn, personMove, drawThumbs, tileFor, quickFlat, flatStill, itemMeta, restWords, sourceLine, daysLine, startsLine, grow } = U.cpKit;
  const GRIP = '<svg class="cp-grip-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6.5" r="1.6"/><circle cx="15" cy="6.5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="17.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/></svg>';

  const ui = { wd: {}, when: {}, fresh: null, fold: {} };

  /* ================================================================== the Plans page */
  function inUse(S, day) {
    const id = C().activeId(S);
    const plan = id ? C().get(S, id) : null;
    if (!plan) {
      return `<div class="card cp-inuse" data-key="inuse">
        <div class="cp-inuse-row"><span class="cp-coach-ico" aria-hidden="true">${U.icon('sparkle')}</span>
          <span class="cp-inuse-text"><span class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>In use</span></span><span class="t-headline">The coach's plan</span>
          <span class="t-footnote rf-muted">Built from your goals, days and equipment. It adjusts every week.</span></span></div>
      </div>`;
    }
    const pending = C().startDay(S, day) > day && !(C().inForce(S, day) && C().inForce(S, day).id === plan.id);
    return `<div class="card cp-inuse" data-key="inuse">
      <button type="button" class="cp-inuse-row cp-press" data-act="cpOpen" data-arg="${plan.id}">${art(plan, 'is-md')}
        <span class="cp-inuse-text"><span class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>${pending ? 'In use from tomorrow' : 'In use'}</span></span><span class="t-headline cp-name">${U.esc(plan.name)}</span>
        <span class="t-footnote rf-muted">${U.esc(`${C().summary(plan)} · ${daysLine(plan)}`)}</span></span>
        <span class="cp-go">${U.icon('chevron-right')}</span></button>
      <button type="button" class="rf-btn cp-back" data-variant="plain" data-size="sm" data-act="cpCoach">${U.icon('refresh')}Back to the coach's plan</button>
    </div>`;
  }
  const makeTile = (act, icon, tone, title, sub) => `<button type="button" class="cp-make-tile cp-press" data-act="${act}" data-tone="${tone}">
      <span class="cp-make-ico" aria-hidden="true">${U.icon(icon)}</span><span class="cp-make-title">${U.esc(title)}</span><span class="cp-make-sub">${U.esc(sub)}</span></button>`;
  function planCard(S, plan) {
    const active = C().activeId(S) === plan.id;
    const problems = C().problems(plan);
    return `<li class="cp-plan" data-key="p-${plan.id}"><button type="button" class="cp-plan-row cp-press" data-act="cpOpen" data-arg="${plan.id}">
      ${art(plan)}
      <span class="cp-plan-text"><span class="cp-name">${U.esc(plan.name)}</span>
        <span class="cp-plan-sub">${U.esc(problems.length ? 'Not finished yet' : C().summary(plan))}</span>
        <span class="cp-src" data-src="${plan.source}">${U.esc(sourceLine(plan))}</span></span>
      ${active ? `<span class="cp-badge">${U.icon('check')}In use</span>` : `<span class="cp-go">${U.icon('chevron-right')}</span>`}
    </button></li>`;
  }
  U.screens.plans = {
    render(S, day) {
      C().ensure(S);
      pruneFresh(S);
      const plans = C().list(S).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return `${U.navbar('Your plans', U.glassBtn('plus', 'New plan', 'cpNew'), U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Your plans</h1>
        <p class="lt-sub t-callout rf-muted">Build your own, ask the coach, or add a shared one.</p>
        <div class="section">
          ${inUse(S, day)}
          <div class="cp-make" data-key="make">
            ${makeTile('cpNew', 'plus', 'indigo', 'Build your own', 'Pick exercises like songs for a playlist')}
            ${makeTile('cpBuild', 'sparkle', 'violet', 'Ask the coach', 'Say what you want, get a plan')}
            ${makeTile('cpScan', 'scan', 'teal', 'Add a shared plan', 'Scan a code or paste a link')}
          </div>
        </div>
        <h2 class="sec-title t-title-3">Saved plans</h2>
        <div class="section">
          ${plans.length ? `<ul class="cp-plans" data-key="plans">${plans.map((p) => planCard(S, p)).join('')}</ul>`
    : `<div class="card cp-empty" data-key="empty"><span class="cp-empty-ico" aria-hidden="true">${U.icon('list')}</span><p class="t-headline">No plans yet</p><p class="t-callout rf-muted">Share one and anyone with Gradient Health can scan it.</p></div>`}
        </div>`;
    },
    after(screen) { drawThumbs(screen); },
  };
  // A new plan left without a single exercise isn't kept.
  function pruneFresh(S) {
    const id = ui.fresh;
    if (!id || (U.route && U.route.view === 'planEdit' && U.route.arg === id)) return;
    const p = C().get(S, id);
    ui.fresh = null;
    if (p && !C().countItems(p) && C().activeId(S) !== id) { C().remove(S, id, U.today()); U.save(); }
  }

  /* ================================================================== new plan */
  // Ready-made plans first (each built for this person's days, time and kit when it's picked, or as
  // soon as the sheet is up, to show its moves), then an empty plan or a copy of the coach's week.
  const TPL_ICON = { full: 'person', upperlower: 'layers', ppl: 'repeat', bodyweight: 'home' };
  const TPL_TONE = { full: 'indigo', upperlower: 'teal', ppl: 'violet', bodyweight: 'green' };
  U.act.cpNew = () => {
    const S = U.S, day = U.today();
    const list = C().templates(S);
    const made = new Map();
    const tplRow = (t) => {
      const p = made.get(t.id);
      return `<li data-key="tpl-${t.id}"><button type="button" class="cp-choice cp-tpl cp-press" data-act="cpNewTemplate" data-arg="${t.id}">
        ${p ? art(p, 'is-tpl').replace('<span class="cp-art', '<span data-key="art" class="cp-art') : `<span class="cp-art is-tpl" data-key="wait" style="--c:var(--hue-${TPL_TONE[t.id] || 'sky'})" data-n="0" aria-hidden="true"><span class="cp-art-empty">${U.icon(TPL_ICON[t.id] || 'list')}</span></span>`}
        <span class="cp-choice-text"><span class="t-headline">${U.esc(t.name)}</span><span class="t-footnote rf-muted">${U.esc(t.about)}</span><span class="cp-tpl-meta rf-num">${U.nb(`${t.days} ${t.days === 1 ? 'day' : 'days'} a week · about ${t.minutes} min`)}</span></span>
        <span class="cp-go">${U.icon('chevron-right')}</span></button></li>`;
    };
    const body = () => `<div class="sheet-pad cp-new">
        <p class="t-subhead cp-new-label">Ready-made for you</p>
        <ul class="cp-tpls">${list.map(tplRow).join('')}</ul>
        <p class="t-footnote rf-muted cp-new-note">Built for your days, time and equipment, with moves at your level. Change anything after.</p>
        <p class="t-subhead cp-new-label">Or start your own</p>
        <div class="cp-new-more">
          <button type="button" class="cp-choice cp-press" data-act="cpNewBlank"><span class="cp-choice-ico" data-tone="indigo" aria-hidden="true">${U.icon('plus')}</span><span class="cp-choice-text"><span class="t-headline">Start from scratch</span><span class="t-footnote rf-muted">Name it, add days, pick the exercises</span></span><span class="cp-go">${U.icon('chevron-right')}</span></button>
          <button type="button" class="cp-choice cp-press" data-act="cpNewCopy"><span class="cp-choice-ico" data-tone="sky" aria-hidden="true">${U.icon('copy')}</span><span class="cp-choice-text"><span class="t-headline">Copy my current plan</span><span class="t-footnote rf-muted">This week's days and exercises, ready to change</span></span><span class="cp-go">${U.icon('chevron-right')}</span></button>
        </div>
        <p class="t-footnote rf-muted">Nothing changes until you use a plan.</p>
      </div>`;
    // Each ready-made plan is built after the sheet is up, one per idle moment, so its tile shows
    // its moves (the sheet's first frame doesn't wait for them).
    const build = (i) => {
      if (ctl.closed || i >= list.length) return;
      const t = list[i];
      if (!made.has(t.id)) { try { made.set(t.id, C().template(S, day, t.id)); } catch (e) { /* built when it's picked */ } }
      const row = ctl.el.querySelector(`.cp-tpls > [data-key="tpl-${t.id}"]`);
      if (row && made.get(t.id)) { U.morph(row.parentNode, list.map(tplRow).join('')); drawThumbs(row.parentNode); }
      const next = () => build(i + 1);
      if (G.requestIdleCallback) G.requestIdleCallback(next, { timeout: 400 }); else setTimeout(next, 30);
    };
    const ctl = U.sheet({ title: 'New plan', size: 'auto', cls: 'cp-sheet cp-new-sheet', body: body(), later: () => build(0) });
    const open = (plan, haptic, toast) => {
      U.save();
      ctl.close('ok');
      U.haptic(haptic);
      U.open('planEdit', plan.id);
      if (toast) U.toast(toast[0], 'positive', toast[1]);
    };
    U.act.cpNewTemplate = (b) => {
      const id = b.dataset.arg;
      const t = list.find((x) => x.id === id);
      let draft = made.get(id);
      if (!draft) { try { draft = C().template(S, day, id); } catch (e) { draft = null; } }
      if (!draft || !t) { U.haptic('deny'); U.toast('That one couldn\'t be built', 'caution', 'Try another, or start from scratch.'); return; }
      const copy = JSON.parse(JSON.stringify(draft));
      copy.name = uniqueName(S, t.name);
      const { plan } = C().add(S, copy);
      plan.source = 'you';
      open(plan, 'success', [`${plan.name} is ready`, 'Built for your days, time and equipment. Change anything you like.']);
    };
    U.act.cpNewBlank = () => {
      const plan = C().create(S, { name: uniqueName(S, 'My plan') });
      ui.fresh = plan.id;
      open(plan, 'success');
      setTimeout(() => { const el = doc.getElementById('cpName'); if (el) { el.focus(); el.select(); } }, 420);
    };
    U.act.cpNewCopy = () => {
      const draft = C().fromCoach(S, U.today());
      draft.name = uniqueName(S, 'My plan');
      const { plan } = C().add(S, draft);
      open(plan, 'copy', ['Copied your current plan', 'The coach\'s plan stays as it is.']);
    };
  };
  function uniqueName(S, base) {
    const names = new Set(C().list(S).map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; i < 99; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
    return base;
  }

  /* ================================================================== a plan's page */
  function exRow(plan, di, it, k, swap) {
    const m = M().MOVES[it.move] || { name: it.move };
    const n = plan.days[di].items.slice(0, k).filter((x) => x.move === it.move).length;
    const key = `${di}-${it.move}-${n}`;
    const warn = swap ? `<span class="cp-swap">${U.icon(swap.to ? 'shuffle' : 'alert')}<span>${U.esc(swap.to ? `${M().MOVES[swap.to].name} instead: ${swap.why}` : `Left out: ${swap.why}`)}</span></span>` : '';
    return `<li class="cp-ex" data-key="e-${U.esc(key)}" data-i="${k}">
      <button type="button" class="cp-grip" data-grip="${di}:${k}" aria-label="${U.esc(`Reorder ${m.name}. Use the up and down arrow keys.`)}">${GRIP}</button>
      <button type="button" class="cp-ex-row" data-act="cpItem" data-arg="${di}:${k}">
        ${thumb(it.move)}
        <span class="cp-ex-text"><span class="cp-ex-name">${U.esc(m.name)}</span><span class="cp-ex-meta rf-num">${U.esc(itemMeta(it))}</span>${warn}</span>
        <span class="cp-go">${U.icon('chevron-right')}</span>
      </button></li>`;
  }
  // A day: its weekday, time and muscles, its name (typed in place), its exercises, and Add
  // exercises. A long day folds to one line (its exercises named) with the button by its time; its
  // options are in a menu out of the ⋯ button.
  function dayCard(S, plan, di, swaps, day) {
    const d = plan.days[di];
    const offs = C().offsetsFor(plan.days.length, plan.weekdays);
    const mins = C().minutes(S, plan, di, day);
    const groups = C().groupsOf(plan, di);
    const folded = !!(ui.fold[plan.id] && ui.fold[plan.id][di]) && d.items.length > 0;
    const full = d.items.length >= C().LIMITS.items;
    const names = d.items.map((it) => (M().MOVES[it.move] || { name: it.move }).name);
    return `<div class="card cp-day${folded ? ' is-folded' : ''}" data-key="day-${di}">
      <div class="cp-day-head">
        <span class="cp-day-eyebrow"><b>Day ${di + 1}</b><span>${U.esc(plan.weekdays ? WD_LONG[offs[di]] : WD[offs[di]])}</span></span>
        ${mins ? `<span class="pw-min" aria-label="${U.esc(`about ${mins} minutes`)}">${U.icon('timer')}<span>${U.roll(mins)} min</span></span>` : ''}
        ${d.items.length ? `<button type="button" class="rf-btn cp-day-fold" data-shape="circle" data-size="sm" data-act="cpDayFold" data-arg="${di}" aria-expanded="${!folded}" aria-label="${U.esc(`${folded ? 'Show' : 'Fold'} day ${di + 1}`)}">${U.icon('chevron-down')}</button>` : ''}
        <button type="button" class="rf-btn cp-day-more" data-shape="circle" data-size="sm" data-act="cpDayMenu" data-arg="${di}" aria-label="${U.esc(`Day ${di + 1} options`)}">${U.icon('more')}</button>
      </div>
      <input class="cp-day-title" id="cpDay${di}" type="text" maxlength="${C().LIMITS.title}" value="${U.esc(d.title)}" placeholder="${U.esc(d.items.length ? C().titleFrom(d.items) : 'Name this day')}" aria-label="${U.esc(`Day ${di + 1} name`)}" data-on="cpDayTitle" data-arg="${di}" data-limit="day" enterkeyhint="done">
      ${groups.length ? `<div class="pw-tags" aria-label="Muscles">${groups.map((g) => `<span class="pw-tag" style="--c:${hue(g)}">${U.esc(groupName(g))}</span>`).join('')}</div>` : ''}
      ${folded ? `<button type="button" class="cp-day-sum cp-press" data-act="cpDayFold" data-arg="${di}" data-key="sum"><span class="t-footnote rf-muted">${U.esc(`${U.plural(names.length, 'exercise')}: ${names.length > 3 ? `${names.slice(0, 3).map((n, i) => (i ? n.toLowerCase() : n)).join(', ')} and ${names.length - 3} more` : listWords(names.map((n, i) => (i ? n.toLowerCase() : n)))}`)}</span></button>`
    : d.items.length ? `<ul class="cp-exlist" data-day="${di}" data-key="list">${d.items.map((it, k) => exRow(plan, di, it, k, swaps.find((x) => x.day === di && x.i === k))).join('')}</ul>`
      : `<p class="t-callout rf-muted cp-day-empty" data-key="empty">No exercises yet.</p>`}
      ${folded ? '' : full ? `<p class="t-footnote rf-muted cp-limit" data-key="add">${U.icon('info')}<span>${U.esc(`That's ${C().LIMITS.items}, the most a day holds. Take one out to add another.`)}</span></p>`
    : `<button type="button" class="rf-btn cp-add" data-variant="soft" data-act="cpAdd" data-arg="${di}" data-key="add">${U.icon('plus')}Add exercises</button>`}
    </div>`;
  }
  // This week by muscle: the sets a week the plan gives each group across its days, against the
  // coach's aim for this person. A gap (none, or under 70% of the aim) is a button that opens the
  // picker at that muscle; past the most their goals call for says so.
  function weekCard(S, plan) {
    const rows = C().weekSets(S, plan).map((w) => {
      const name = groupName(w.group);
      const gap = w.status === 'none' || w.status === 'low';
      const v = Math.max(0, Math.min(1, w.sets / Math.max(w.aim, 1)));
      const ico = U.groupIcon ? U.groupIcon(w.group, 20) : '';
      const label = `${name}: ${w.sets} of ${w.aim} sets a week${gap ? '. Add exercises' : w.status === 'high' ? ', more than your goals need' : ''}`;
      const inner = `<span class="cp-wk-name">${ico ? `<span class="cp-wk-ico" aria-hidden="true">${ico}</span>` : ''}<span>${U.esc(name)}</span></span>
        <span class="cp-wk-val rf-num" aria-hidden="true">${U.roll(w.sets)}<span class="cp-wk-of"> of ${w.aim}</span></span>
        <span class="cp-wk-end" aria-hidden="true">${gap ? `${U.icon('plus')}<span>Add</span>` : w.status === 'high' ? '<span>A lot</span>' : U.icon('check')}</span>
        <span class="cp-wk-bar" aria-hidden="true"><span class="cp-wk-fill" style="--v:${v.toFixed(3)}"></span></span>`;
      return `<li data-key="wk-${w.group}" data-status="${w.status}">${gap ? `<button type="button" class="cp-wk-row cp-press" data-act="cpGap" data-arg="${w.group}" aria-label="${U.esc(label)}">${inner}</button>` : `<div class="cp-wk-row" role="group" aria-label="${U.esc(label)}">${inner}</div>`}</li>`;
    }).join('');
    const gaps = C().weekSets(S, plan).filter((w) => w.status === 'none' || w.status === 'low').length;
    return `<div class="card cp-week" data-key="week">
      <p class="t-footnote rf-muted">${U.esc(gaps ? 'Sets a week for each muscle, against what your goals call for. Tap one that\'s short to add to it.' : 'Sets a week for each muscle, against what your goals call for. Every one gets its share.')}</p>
      <ul class="cp-wk">${rows}</ul>
    </div>`;
  }
  function schedule(plan) {
    const n = plan.days.length;
    const when = ui.when[plan.id] || (plan.weekdays ? 'set' : 'spread');
    const picks = ui.wd[plan.id] || (plan.weekdays || []).slice();
    const chips = WD.map((w, i) => `<button type="button" class="rf-chip cp-wd" aria-pressed="${picks.includes(i)}" data-on="cpWd" data-v="${i}" aria-label="${WD_LONG[i]}">${U.icon('check', null, 'rf-chip-check')}${w}</button>`).join('');
    const offs = C().offsetsFor(n, when === 'set' && picks.length === n ? picks.slice().sort((a, b) => a - b) : null);
    const foot = when === 'set' && picks.length !== n
      ? `Pick ${n} ${n === 1 ? 'day' : 'days'}, one for each workout (${picks.length} picked).`
      : when === 'set' ? `Day ${offs.map((o, i) => `${i + 1} on ${WD[o]}`).join(', day ')}.` : `${listWords(offs.map((o) => WD_LONG[o]))}, spread out like the coach's plan. Miss one and the week moves along.`;
    return `<div class="card cp-sched" data-key="sched">
      <div class="cp-row"><span class="t-headline">Schedule</span><span class="t-callout rf-muted rf-num">${n} ${n === 1 ? 'day' : 'days'} a week</span></div>
      ${U.seg(`cpWhen-${plan.id}`, [['spread', 'Spread out'], ['set', 'Set days']], when, 'When you train', ' data-on="cpWhen"')}
      ${when === 'set' ? `<div class="ob-chips cp-wds" data-key="wds">${chips}</div>` : ''}
      <p class="t-footnote rf-muted">${U.esc(foot)}</p>
    </div>`;
  }
  U.screens.planEdit = {
    render(S, day, id) {
      const plan = C().get(S, id);
      const back = U.glassBtn('chevron-left', 'Back', 'back');
      if (!plan || plan.deleted) return `${U.navbar('Plan', '', back)}<h1 class="rf-large-title">Plan</h1><div class="section"><div class="card"><p class="t-callout">This plan was deleted.</p></div></div>`;
      const active = C().activeId(S) === plan.id;
      const problems = C().problems(plan);
      const swaps = C().swapsFor(S, plan, day);
      const pending = active && C().startDay(S, day) > day && !(C().inForce(S, day) && C().inForce(S, day).id === plan.id);
      const trailing = `${U.glassBtn('share', 'Share this plan', 'cpShare', `data-arg="${plan.id}"`)}${U.glassBtn('more', 'More', 'cpMenu', `data-arg="${plan.id}"`)}`;
      const hero = `<div class="card cp-hero" data-key="hero">
          ${art(plan, 'is-lg')}
          <div class="cp-hero-text">
            <span class="cp-src" data-src="${plan.source}">${U.esc(sourceLine(plan))}</span>
            <p class="t-callout rf-muted rf-num">${U.esc(C().summary(plan))}</p>
            ${plan.note ? `<p class="t-footnote cp-note">${U.esc(plan.note)}</p>` : ''}
          </div>
          <div class="cp-hero-act">
            ${improveBtn(S, plan)}
            ${active ? `<span class="cp-badge is-lg">${U.icon('check')}${pending ? 'In use from tomorrow' : 'In use'}</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpCoach">Back to the coach's plan</button>`
    : problems.length ? `<p class="t-footnote cp-todo">${U.icon('info')}<span>${U.esc(problems[0])}</span></p>`
      : `<button type="button" class="rf-btn cp-use" data-variant="filled" data-size="lg" data-act="cpUse" data-arg="${plan.id}">${U.icon('play')}Use this plan</button><p class="t-footnote rf-muted">${U.esc(startsLine(S, day, plan))}</p>`}
          </div>
        </div>`;
      return `${U.navbar(plan.name, trailing, back)}
        <h1 class="rf-large-title cp-title">${U.esc(plan.name)}</h1>
        <div class="section">
          ${hero}
          <div class="card cp-names" data-key="names">
            <div class="rf-field"><label class="rf-field-label" for="cpName">Name</label><div class="rf-field-control"><input class="rf-input" id="cpName" type="text" maxlength="${C().LIMITS.name}" value="${U.esc(plan.name)}" data-on="cpName" data-limit="name" enterkeyhint="done" autocomplete="off"></div></div>
            <div class="rf-field"><label class="rf-field-label" for="cpNote">Note (optional)</label><div class="rf-field-control"><textarea class="rf-input" id="cpNote" rows="2" maxlength="${C().LIMITS.note}" placeholder="What it's for, how to do it" data-on="cpNote" data-limit="note">${U.esc(plan.note || '')}</textarea></div></div>
          </div>
          ${schedule(plan)}
        </div>
        <h2 class="sec-title t-title-3">This week by muscle</h2>
        <div class="section">${weekCard(S, plan)}</div>
        <h2 class="sec-title t-title-3">Days</h2>
        <div class="section cp-days">
          ${plan.days.map((d, di) => dayCard(S, plan, di, swaps, day)).join('')}
          ${plan.days.length < C().LIMITS.days ? `<button type="button" class="rf-btn cp-addday" data-size="lg" data-act="cpAddDay" data-key="addday">${U.icon('plus')}Add a day</button>`
    : `<p class="t-footnote rf-muted cp-limit" data-key="addday">${U.icon('info')}<span>${U.esc(`Six days is the most a plan holds, so there's always a day to rest.`)}</span></p>`}
          <p class="t-footnote rf-muted cp-foot" data-key="foot">Each workout starts with a short warm-up. Lighter weeks and short nights trim a few sets. Reps and weights go up as you say how many more you could have done.</p>
        </div>`;
    },
    after(screen, S, day, id) {
      drawThumbs(screen);
      wireDrag(screen, id);
      wireLimits(screen);
      warmPicker(S, id);
    },
  };
  // A name typed to its limit says so, kindly, under the field, while it's at it.
  const LIMIT_WORDS = { name: () => `Names stop at ${C().LIMITS.name} characters.`, note: () => `Notes stop at ${C().LIMITS.note} characters.`, day: () => `Day names stop at ${C().LIMITS.title} characters.` };
  function wireLimits(screen) {
    for (const el of screen.querySelectorAll('[data-limit]')) {
      if (el._limit) continue;
      el._limit = true;
      el.addEventListener('input', () => {
        const at = el.value.length >= Number(el.getAttribute('maxlength') || 1e9);
        const box = el.closest('.rf-field') || el.parentNode;
        let hint = box.querySelector(':scope > .cp-hint');
        if (at && !hint) {
          hint = doc.createElement('p');
          hint.className = 'cp-hint t-footnote';
          hint.setAttribute('role', 'status');
          hint.textContent = LIMIT_WORDS[el.getAttribute('data-limit')]();
          (el.closest('.rf-field') ? box : el.parentNode).insertBefore(hint, el.closest('.rf-field') ? null : el.nextSibling);
          U.haptic('edge');
        } else if (!at && hint) hint.remove();
      });
    }
  }
  // Improve: with Claude on (or the on-device AI there), for a plan with something to improve.
  function improveBtn(S, plan) {
    if (!C().countItems(plan)) return '';
    const claude = S.ai && S.ai.mode === 'api' && S.ai.consentAt && GH.ai && GH.ai.hasKey && GH.ai.hasKey();
    const device = !!(S.ai && S.ai.deviceModel);
    if (!claude && !device) return '';
    return `<button type="button" class="rf-btn cp-improve" data-variant="soft" data-size="sm" data-act="cpImprove" data-arg="${plan.id}">${U.icon('sparkle')}Improve with ${claude ? 'Claude' : 'the coach'}</button>`;
  }
  // Every change is saved as it's made; the plan in use picks it up from today.
  function edit(fn) {
    const S = U.S, id = U.route.arg;
    if (!C().get(S, id)) return null;
    const plan = C().update(S, id, fn, U.today());
    if (ui.fresh === id && C().countItems(plan)) ui.fresh = null;
    U.save();
    U.render();
    return plan;
  }
  U.on.cpName = (el, ev, v) => { const name = String(v || '').trim(); if (name) edit((p) => { p.name = name; }); else U.render(); };
  U.on.cpNote = (el, ev, v) => edit((p) => { p.note = String(v || ''); });
  U.on.cpDayTitle = (el, ev, v) => { const di = Number(el.dataset.arg); edit((p) => { if (p.days[di]) p.days[di].title = String(v || ''); }); };
  U.on.cpWhen = (el, ev, v) => {
    const id = U.route.arg;
    const plan = C().get(U.S, id);
    if (!plan) return;
    ui.when[id] = v;
    if (v === 'spread') { delete ui.wd[id]; edit((p) => { p.weekdays = null; }); return; }
    ui.wd[id] = (plan.weekdays || C().offsetsFor(plan.days.length, null)).slice();
    edit((p) => { p.weekdays = ui.wd[id].slice(); });
  };
  U.on.cpWd = (el, ev, v) => {
    const id = U.route.arg;
    const plan = C().get(U.S, id);
    if (!plan) return;
    const i = Number(el.dataset.v);
    let picks = (ui.wd[id] || plan.weekdays || []).filter((x) => x !== i);
    if (v) picks.push(i);
    picks = picks.sort((a, b) => a - b);
    ui.wd[id] = picks;
    if (picks.length === plan.days.length) edit((p) => { p.weekdays = picks.slice(); });
    else { if (plan.weekdays) edit((p) => { p.weekdays = null; }); else U.render(); }
  };
  U.act.cpAddDay = () => {
    const plan = edit((p) => { p.days.push({ title: '', items: [] }); });
    if (!plan) return;
    delete ui.wd[plan.id];
    U.haptic('select');
    setTimeout(() => { const cards = doc.querySelectorAll('#screen .cp-day'); const last = cards[cards.length - 1]; if (last) last.scrollIntoView({ block: 'center', behavior: U.reduced() ? 'auto' : 'smooth' }); }, 60);
  };
  // A day's options: a menu that grows out of its button (U.menu), which closes itself as one is
  // picked.
  U.act.cpDayMenu = (el) => {
    const di = Number(el.dataset.arg);
    const plan = C().get(U.S, U.route.arg);
    if (!plan) return;
    const n = plan.days.length;
    U.menu(el, [
      { act: 'cpDayRename', arg: String(di), icon: 'pencil', label: 'Rename day' },
      di > 0 ? { act: 'cpDayMove', arg: `${di}:-1`, icon: 'arrow-up', label: 'Move day up' } : false,
      di < n - 1 ? { act: 'cpDayMove', arg: `${di}:1`, icon: 'arrow-down', label: 'Move day down' } : false,
      n < C().LIMITS.days ? { act: 'cpDayCopy', arg: String(di), icon: 'copy', label: 'Duplicate day' } : false,
      n > 1 ? null : false,
      n > 1 ? { act: 'cpDayDelete', arg: String(di), icon: 'trash', label: 'Delete day', tone: 'critical' } : false,
    ], { label: `Day ${di + 1}${plan.days[di].title ? `: ${plan.days[di].title}` : ''}` });
    // (A fold travels with its day.)
    const folds = () => ui.fold[plan.id] || (ui.fold[plan.id] = {});
    U.act.cpDayRename = (b) => {
      const a = Number(b.dataset.arg);
      // After the menu has dissolved, so focus lands in the field and the keyboard comes up for it.
      setTimeout(() => { const f = doc.getElementById(`cpDay${a}`); if (f) { f.scrollIntoView({ block: 'center', behavior: U.reduced() ? 'auto' : 'smooth' }); f.focus({ preventScroll: true }); f.select(); } }, 260);
      U.haptic('tap');
    };
    U.act.cpDayMove = (b) => {
      const [a, dir] = b.dataset.arg.split(':').map(Number);
      const f = folds(), fa = f[a], fb = f[a + dir];
      f[a] = fb; f[a + dir] = fa;
      edit((p) => { const [d] = p.days.splice(a, 1); p.days.splice(a + dir, 0, d); });
      U.haptic('drop');
    };
    U.act.cpDayCopy = (b) => {
      const a = Number(b.dataset.arg);
      const f = folds();
      for (let i = plan.days.length; i > a + 1; i--) f[i] = f[i - 1];
      f[a + 1] = false;
      edit((p) => { p.days.splice(a + 1, 0, JSON.parse(JSON.stringify(p.days[a]))); });
      delete ui.wd[plan.id];
      U.haptic('copy');
      U.toast(`Day ${a + 1} duplicated`, 'positive', `It's day ${a + 2} now.`);
    };
    U.act.cpDayDelete = (b) => {
      const a = Number(b.dataset.arg);
      const before = JSON.parse(JSON.stringify(plan.days));
      const wdBefore = plan.weekdays ? plan.weekdays.slice() : null;
      const foldBefore = Object.assign({}, folds());
      const f = folds();
      for (let i = a; i < plan.days.length; i++) f[i] = f[i + 1];
      const name = plan.days[a].title || `Day ${a + 1}`;
      edit((p) => { p.days.splice(a, 1); p.weekdays = null; });
      delete ui.wd[plan.id];
      U.haptic('remove');
      U.toast(`${name} deleted`, 'neutral', undefined, { label: 'Undo', onClick: () => { if (U.route.arg === plan.id) { ui.fold[plan.id] = foldBefore; edit((p) => { p.days = before; p.weekdays = wdBefore; }); U.haptic('undo'); } } });
    };
  };
  // Folding a day: its list goes, and one line naming its exercises takes its place (and back).
  U.act.cpDayFold = (el) => {
    const id = U.route.arg, di = Number(el.dataset.arg);
    const f = ui.fold[id] || (ui.fold[id] = {});
    f[di] = !f[di];
    U.haptic(f[di] ? 'toggleOff' : 'toggleOn');
    U.render();
  };
  // A muscle that's short in the week: the picker at that muscle, for the day with the most room
  // (the fewest minutes; the first day of an empty plan).
  U.act.cpGap = (el) => {
    const S = U.S, id = U.route.arg, plan = C().get(S, id);
    if (!plan) return;
    let di = -1, best = Infinity;
    plan.days.forEach((d, i) => { if (d.items.length >= C().LIMITS.items) return; const m = C().minutes(S, plan, i, U.today()); if (m < best) { best = m; di = i; } });
    if (di < 0) { U.haptic('deny'); U.toast('Every day is full', 'caution', `A day holds ${C().LIMITS.items} exercises. Take one out, or add a day.`); return; }
    picker(id, di, null, { group: el.dataset.arg });
  };

  /* ---------------------------------------------------------------- one exercise */
  U.act.cpItem = (el) => {
    const [di, k] = String(el.dataset.arg).split(':').map(Number);
    itemSheet(U.route.arg, di, k);
  };
  // Rest between sets, one line: a stepper over these, starting from Auto (what the coach uses for
  // the move: 90 s after big moves, 60 after the rest, plus what age adds), with Auto to go back.
  const RESTS = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  // Auto: what the plan's session gives the move (src/customplan.js: 90 s after big moves, 60 after
  // the rest, or the person's own pick in Settings).
  const autoRestOf = (S, m) => C().restAuto(S, m.id);
  function itemSheet(planId, di, k) {
    const S = U.S;
    const get = () => { const p = C().get(S, planId); return p && p.days[di] ? p.days[di].items[k] : null; };
    const it0 = get();
    if (!it0) return;
    const body = () => {
      const plan = C().get(S, planId);
      const it = get();
      if (!it) return '<div class="sheet-pad"><p class="t-callout rf-muted">This exercise was removed.</p></div>';
      const m = M().MOVES[it.move];
      const swap = C().swapsFor(S, { days: [{ items: [it] }] }, U.today()).find(() => true);
      const amt = m.timed ? it.secs : it.reps;
      const auto = autoRestOf(S, m);
      const rest = it.rest == null ? null : it.rest;
      const n = plan.days[di].items.length;
      const what = [groupName(m.group)].concat((m.muscles || []).map((x) => String(x).replace(/([A-Z])/g, ' $1').toLowerCase()).filter((x) => x !== String(m.group).toLowerCase()).slice(0, 3)).join(' · ');
      return `<div class="sheet-pad cp-item">
        <button type="button" class="cp-item-top cp-press" data-act="cpHowTo" data-arg="${it.move}">${thumb(it.move, 'is-xl')}
          <span class="cp-item-what"><span class="t-footnote rf-muted">${U.esc(what)}</span>
          <span class="cp-link">${U.icon('info')}How to do it</span></span></button>
        ${swap ? `<p class="cp-swap is-box">${U.icon(swap.to ? 'shuffle' : 'alert')}<span>${U.esc(swap.to ? `You'll do ${M().MOVES[swap.to].name.toLowerCase()} instead: ${swap.why}.` : `Left out for now: ${swap.why}.`)}</span></p>` : ''}
        <div class="cp-steps">
          <div class="cp-step"><span class="t-subhead">Sets</span>${U.stepper('cpSets', it.sets, 1, 10, 'Sets', 'data-on="cpSets"')}</div>
          <div class="cp-step"><span class="t-subhead">${m.timed ? 'Seconds' : m.uni ? 'Reps each side' : 'Reps'}</span>${U.stepper('cpAmt', amt, m.timed ? 5 : 1, m.timed ? 600 : 100, m.timed ? 'Seconds' : 'Reps', 'data-on="cpAmt"', m.timed ? 5 : 1)}</div>
        </div>
        <div class="cp-rest" data-key="rest">
          <span class="t-subhead" id="cpRestLabel">Rest between sets</span>
          <div class="cp-rest-ctl" role="group" aria-labelledby="cpRestLabel">
            <button type="button" class="rf-btn cp-rest-btn" data-shape="circle" data-size="sm" data-act="cpRestStep" data-arg="-1" aria-label="Less rest"${rest === 0 ? ' disabled' : ''}>${U.icon('minus')}</button>
            <span class="cp-rest-val rf-num" aria-live="polite">${rest == null ? `<b>Auto</b><span>${U.esc(restWords(auto))}</span>` : `<b>${U.esc(restWords(rest))}</b>`}</span>
            <button type="button" class="rf-btn cp-rest-btn" data-shape="circle" data-size="sm" data-act="cpRestStep" data-arg="1" aria-label="More rest"${rest != null && rest >= RESTS[RESTS.length - 1] ? ' disabled' : ''}>${U.icon('plus')}</button>
          </div>
          ${rest == null ? '' : '<button type="button" class="rf-btn cp-rest-auto" data-variant="plain" data-size="sm" data-act="cpRestAuto">Auto</button>'}
        </div>
        <p class="t-footnote rf-muted cp-item-note">${m.timed ? 'Hold for this long each set.' : 'Reps go up as it gets easier, then the weight, if it has one.'}${rest == null ? ` Auto rest is ${restWords(auto)} for this one.` : ''}</p>
        <div class="cp-item-acts">
          <button type="button" class="rf-btn" data-variant="soft" data-act="cpItemMove" data-arg="-1"${k === 0 ? ' disabled' : ''}>${U.icon('arrow-up')}Move up</button>
          <button type="button" class="rf-btn" data-variant="soft" data-act="cpItemMove" data-arg="1"${k >= n - 1 ? ' disabled' : ''}>${U.icon('arrow-down')}Move down</button>
          <button type="button" class="rf-btn" data-variant="soft" data-act="cpReplace">${U.icon('shuffle')}Replace</button>
          <button type="button" class="rf-btn" data-variant="soft" data-tone="critical" data-act="cpRemove">${U.icon('trash')}Remove</button>
        </div>
      </div>`;
    };
    const ctl = U.sheet({ title: M().MOVES[it0.move].name, size: 'fit', cls: 'cp-sheet cp-item-sheet', body: body(), after: (c) => drawThumbs(c.el), onClose: () => { U.render(); } });
    const redraw = () => { if (!ctl.closed) { ctl.update(body()); drawThumbs(ctl.el); } };
    // Each change is saved at once; the page behind is drawn again as the sheet closes.
    const change = (fn) => {
      if (U.route.arg !== planId) return;
      C().update(S, planId, (p) => { const it = p.days[di] && p.days[di].items[k]; if (it) fn(it, p); }, U.today());
      if (ui.fresh === planId) ui.fresh = null;
      U.save();
    };
    U.on.cpSets = (el, ev, v) => change((it) => { it.sets = Math.max(1, Math.min(10, Math.round(v) || 1)); });
    U.on.cpAmt = (el, ev, v) => change((it) => { const m = M().MOVES[it.move]; if (m.timed) it.secs = Math.max(5, Math.min(600, Math.round(v) || 5)); else it.reps = Math.max(1, Math.min(100, Math.round(v) || 1)); });
    U.act.cpRestStep = (b) => {
      const it = get();
      if (!it) return;
      const dir = Number(b.dataset.arg);
      const from = it.rest == null ? autoRestOf(S, M().MOVES[it.move]) : it.rest;
      const next = dir > 0 ? RESTS.find((x) => x > from) : RESTS.slice().reverse().find((x) => x < from);
      if (next == null) { U.haptic('edge'); return; }
      change((x) => { x.rest = next; });
      U.haptic(next === 0 || next === RESTS[RESTS.length - 1] ? 'edge' : 'tick');
      redraw();
    };
    U.act.cpRestAuto = () => { change((x) => { delete x.rest; }); U.haptic('select'); redraw(); };
    U.act.cpItemMove = (b) => {
      const dir = Number(b.dataset.arg);
      const plan = C().get(S, planId);
      const n = plan ? plan.days[di].items.length : 0;
      if (k + dir < 0 || k + dir >= n) return;
      change((x, p) => { const list = p.days[di].items; const [y] = list.splice(k, 1); list.splice(k + dir, 0, y); });
      k += dir;
      U.haptic('drop');
      redraw();
    };
    U.act.cpRemove = () => {
      const plan = C().get(S, planId);
      const it = get();
      if (!plan || !it) return;
      const at = k;
      ctl.close('ok');
      edit((p) => { p.days[di].items.splice(at, 1); });
      U.haptic('remove');
      U.toast(`Removed ${M().MOVES[it.move].name.toLowerCase()}`, 'neutral', undefined, { label: 'Undo', onClick: () => { if (U.route.arg === planId) { edit((p) => { if (p.days[di]) p.days[di].items.splice(at, 0, it); }); U.haptic('undo'); } } });
    };
    U.act.cpReplace = () => { ctl.close('ok'); picker(planId, di, k); };
  }
  U.act.cpHowTo = (el) => U.moveSheet(el.dataset.arg);

  /* ---------------------------------------------------------------- drag to reorder */
  // Hold the grip and drag: the row lifts, the others make room, and it drops where you let go.
  // Arrow keys on the grip move it one place up or down.
  function wireDrag(screen, planId) {
    for (const list of screen.querySelectorAll('.cp-exlist')) {
      if (list._wired) continue;
      list._wired = true;
      list.addEventListener('pointerdown', (ev) => start(ev, list));
      list.addEventListener('keydown', (ev) => {
        const g = ev.target.closest && ev.target.closest('.cp-grip');
        if (!g || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
        ev.preventDefault();
        const [di, k] = g.dataset.grip.split(':').map(Number);
        const to = k + (ev.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= list.children.length) return;
        edit((p) => { const items = p.days[di].items; const [x] = items.splice(k, 1); items.splice(to, 0, x); });
        U.haptic('tick');
        const again = doc.querySelector(`#screen .cp-grip[data-grip="${di}:${to}"]`);
        if (again) again.focus();
      });
    }
    function start(ev, list) {
      const g = ev.target.closest && ev.target.closest('.cp-grip');
      if (!g || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      const [di, k] = g.dataset.grip.split(':').map(Number);
      const rows = Array.from(list.children);
      const row = rows[k];
      if (!row) return;
      const rects = rows.map((r) => r.getBoundingClientRect());
      const d = { di, k, to: k, y0: ev.clientY, rows, rects, row, h: rects[k].height, id: ev.pointerId };
      try { g.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      row.setAttribute('data-lifted', '');
      list.setAttribute('data-dragging', '');
      U.haptic('grab');
      const move = (e) => {
        if (e.pointerId !== d.id) return;
        const dy = e.clientY - d.y0;
        const top = d.rects[0].top, bottom = d.rects[d.rects.length - 1].bottom;
        const clamped = Math.max(top - d.rects[d.k].top, Math.min(bottom - d.rects[d.k].bottom, dy));
        row.style.transform = `translate3d(0, ${clamped.toFixed(1)}px, 0) scale(1.02)`;
        // Its new place: past each row whose middle its leading edge has crossed (an edge, not its
        // middle, so a tall row still gets to the top or the bottom of a list of short ones).
        const topEdge = d.rects[d.k].top + clamped, bottomEdge = topEdge + d.h;
        const midOf = (i) => d.rects[i].top + d.rects[i].height / 2;
        let to = d.k;
        if (clamped < 0) while (to > 0 && topEdge < midOf(to - 1)) to--;
        else while (to < d.rects.length - 1 && bottomEdge > midOf(to + 1)) to++;
        if (to !== d.to) {
          d.to = to;
          U.haptic('tick');
          d.rows.forEach((r, i) => {
            if (i === d.k) return;
            const shift = d.k < to && i > d.k && i <= to ? -d.h : d.k > to && i >= to && i < d.k ? d.h : 0;
            r.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
          });
        }
      };
      const end = (e) => {
        if (e.pointerId !== d.id) return;
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', end);
        g.removeEventListener('pointercancel', end);
        for (const r of d.rows) r.style.transform = '';
        row.removeAttribute('data-lifted');
        list.removeAttribute('data-dragging');
        if (e.type !== 'pointercancel') {
          if (d.to !== d.k) edit((p) => { const items = p.days[d.di].items; const [x] = items.splice(d.k, 1); items.splice(d.to, 0, x); });
          U.haptic('drop');
        }
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
    }
  }

  /* ---------------------------------------------------------------- the exercise picker */
  // Choosing a day's exercises, in a full-height sheet:
  //  - search, forgiving ("pushup", "push up", "press-up", "dumbell"), then one line of filters: the
  //    muscle chips, and a Filters button whose menu holds what the moves are done with (from what
  //    the catalog holds) and Only what I can do;
  //  - the moves as a list (picture, name, muscles and kit, and a mark), Suggested first (more for
  //    the muscles this day trains, and the ones the week leaves short), then by muscle under All;
  //  - only the rows near the screen are in the page (windowed), so the sheet opens in a frame and a
  //    filter or a letter typed never waits on 200 rows; each row's picture is there from its first
  //    frame (see stills, above);
  //  - a tap on a row adds it with sets and reps for this person (or takes it out); its picture, or
  //    a long press, opens its how-to over the picker, and closing that comes back here;
  //  - the tray at the bottom holds what's in the day: a tap takes one out (with Undo), then Done, or
  //    Add N. The day changes once, as the sheet closes, whichever way it's closed; closed without
  //    Add (its close button, a swipe), a toast says what changed, with Undo.
  // Replacing an exercise: the sheet says which, suggests the moves most like it, and a tap swaps it.
  U.act.cpAdd = (el) => picker(U.route.arg, Number(el.dataset.arg), null);
  // The picker's order: by muscle group as the chips go, then each ladder easiest first (a fast-up
  // version right after its move), the seated and supported stand-ins after the usual ladders, and
  // moves of no ladder last. A move in two ladders under one name (a glute bridge is in the hinge
  // ladder and the glute one) shows once: the first, which stands for both (TWIN).
  const SORTED = new WeakMap(); // a catalog → its moves in the picker's order
  const TWIN = new Map(); // a move left out → the one that shows for it
  function sortedOf(cat) {
    let s = SORTED.get(cat);
    if (s) return s;
    const fams = Object.keys(M().LADDERS);
    const key = (x) => {
      const gi = FILTERS.findIndex(([g]) => g === x.group);
      const lad = x.fam && M().LADDERS[x.fam];
      const m = M().MOVES[x.id] || {};
      const base = m.powerOf && lad && lad.rungs.includes(m.powerOf) ? m.powerOf : x.id;
      const at = lad ? lad.rungs.indexOf(base) : -1;
      return [gi < 0 ? 99 : gi, lad ? (lad.alt ? 500 : 0) + fams.indexOf(x.fam) : 999, at < 0 ? 99 : at + (base !== x.id ? 0.5 : 0)];
    };
    const keyed = cat.map((x) => [key(x), x]);
    keyed.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[0][2] - b[0][2] || a[1].name.localeCompare(b[1].name));
    const first = new Map();
    s = [];
    for (const [, x] of keyed) {
      const k = `${x.group}|${x.name}`;
      const had = first.get(k);
      if (had && had.ok === x.ok) { TWIN.set(x.id, had.id); continue; }
      if (!had) first.set(k, x);
      s.push(x);
    }
    SORTED.set(cat, s);
    return s;
  }
  const twinOf = (id) => TWIN.get(id) || id;
  // What the picker opens with is worked out in an idle moment once a plan's page shows (the
  // catalog, its order, the first rows' pictures), so a tap on Add exercises finds it ready.
  function warmPicker(S, id) {
    const run = () => {
      try {
        if (!U.S || U.route.view !== 'planEdit' || U.route.arg !== id) return;
        const day = U.today();
        const plan = C().get(U.S, id);
        const list = sortedOf(C().catalog(U.S, day)).filter((x) => x.ok).slice(0, 12);
        const sug = plan && plan.days[0] ? C().suggest(U.S, plan, 0, day, null, 6) : [];
        for (const x of sug.map((y) => y.id).concat(list.map((y) => y.id))) standIn(x, SMALL);
      } catch (e) { /* worked out as it opens */ }
    };
    if (G.requestIdleCallback) G.requestIdleCallback(run, { timeout: 3000 }); else setTimeout(run, 400);
  }
  const KIT_NAME = () => Object.fromEntries(C().KIT);
  const WHY = { day: 'More for this day', none: 'None in your week yet', low: 'Light in your week' };
  function picker(planId, di, replaceK, opts) {
    const S = U.S, day = U.today();
    const o = opts || {};
    const plan0 = C().get(S, planId);
    if (!plan0 || !plan0.days[di]) return;
    const LIM = C().LIMITS.items;
    const orig = plan0.days[di].items.map((x) => Object.assign({}, x));
    const replacing = replaceK != null && orig[replaceK] ? orig[replaceK] : null;
    const fresh = new WeakSet(); // exercises picked here
    const st = { q: '', group: FILTERS.some(([g]) => g === o.group) ? o.group : 'all', kit: '', mine: true, items: orig.map((x) => Object.assign({}, x)) };
    const cat = C().catalog(S, day);
    const byId = new Map(cat.map((x) => [x.id, x]));
    const sorted = sortedOf(cat);
    const sugg = replacing ? C().similar(S, replacing.move, day, 6) : C().suggest(S, plan0, di, day, st.items, 6);
    const kits = KIT_NAME();
    const nameOf = (id) => (M().MOVES[id] || { name: id }).name;
    const inDay = (id) => st.items.some((x) => twinOf(x.move) === twinOf(id));
    const added = () => st.items.filter((x) => fresh.has(x)).length;

    /* ---------- rows */
    // What it works (its first two muscles) and what it's done with; or why it's not for them now.
    const meta = (x) => {
      if (!x.ok) return U.cap(x.why || 'not for you now');
      const mus = x.muscles.slice(0, 2);
      return `${U.cap(mus.length ? mus.join(', ') : groupName(x.group).toLowerCase())} · ${x.kitText}`;
    };
    const rowHtml = (e) => {
      const x = e.row, on = inDay(x.id);
      return `<div class="cp-row${on ? ' is-in' : ''}${x.ok ? '' : ' is-off'}${e.why ? ' is-sug' : ''}" data-vkey="${e.key}" data-id="${x.id}" role="listitem">
        <button type="button" class="cp-row-fig" data-act="cpHowTo" data-arg="${x.id}" aria-label="${U.esc(`How to do ${x.name}`)}">${thumb(x.id, 'is-row')}<span class="cp-row-info" aria-hidden="true">${U.icon('info')}</span></button>
        <button type="button" class="cp-row-main" data-act="cpPick" data-arg="${x.id}"${replacing ? '' : ` aria-pressed="${on}"`}>
          <span class="cp-row-text"><span class="cp-row-name">${U.esc(x.name)}</span><span class="cp-row-meta">${U.esc(meta(x))}</span>${e.why && WHY[e.why] ? `<span class="cp-row-why" data-why="${e.why}">${U.esc(WHY[e.why])}</span>` : ''}</span>
          <span class="cp-row-mark" aria-hidden="true">${U.icon(replacing ? 'arrow-right' : on ? 'check' : 'plus')}</span>
        </button>
      </div>`;
    };
    const headHtml = (e) => `<div class="cp-sec" data-vkey="${e.key}" role="heading" aria-level="3"><span>${U.esc(e.head)}</span>${e.n != null ? `<span class="cp-sec-n rf-num">${e.n}</span>` : ''}</div>`;
    const itemHtml = (e) => (e.head ? headHtml(e) : rowHtml(e));
    // The list as it stands: the filters, then the search (best first) or Suggested and the groups.
    const build = () => {
      const pass = (x) => (st.group === 'all' || x.group === st.group) && (!st.mine || x.ok) && (!st.kit || x.kit.includes(st.kit));
      const base = sorted.filter(pass);
      const out = [];
      if (st.q.trim()) { for (const x of C().search(base, st.q)) out.push({ key: `r-${x.id}`, row: x }); return out; }
      const sug = sugg.map((s) => Object.assign({}, s, { x: byId.get(s.id) })).filter((s) => s.x && pass(s.x));
      if (sug.length) {
        out.push({ key: 'h-sug', head: replacing ? 'Most like it' : 'Suggested' });
        for (const s of sug) out.push({ key: `s-${s.id}`, row: s.x, why: s.why });
      }
      let g = null;
      for (const x of base) {
        if (st.group === 'all' && x.group !== g) { g = x.group; out.push({ key: `h-${g}`, head: groupName(g), n: base.filter((y) => y.group === g).length }); }
        else if (st.group !== 'all' && sug.length && !g) { g = x.group; out.push({ key: `h-${g}`, head: `All ${groupName(g).toLowerCase()}`, n: base.length }); }
        out.push({ key: `r-${x.id}`, row: x });
      }
      return out;
    };
    const emptyHtml = () => {
      const q = st.q.trim();
      const more = st.mine && (q ? C().search(sorted.filter((x) => !x.ok), q).length : sorted.some((x) => !x.ok && (st.group === 'all' || x.group === st.group) && (!st.kit || x.kit.includes(st.kit))));
      return `<div class="cp-none" data-vkey="none"><p class="t-callout rf-muted">${U.esc(more ? 'Nothing you can do today matches that.' : 'No exercise matches that.')}</p>${more ? '<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="cpShowAll">Show the ones you can\'t do</button>' : ''}${st.kit || st.group !== 'all' || q ? '<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpClearFilters">Clear the filters</button>' : ''}</div>`;
    };

    /* ---------- windowing: rows in the page from a little above the screen to a little below it */
    const V = { items: build(), h: new Map(), est: 64, estHead: 44, a: 0, b: 0, nodes: new Map(), raf: 0 };
    const hOf = (e) => V.h.get(e.key) || (e.head ? V.estHead : V.est);
    const sum = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += hOf(V.items[i]); return s; };
    const firstCount = () => { let y = 0, b = 0; const need = (G.innerHeight || 800) * 1.1; while (b < V.items.length && y < need) { y += hOf(V.items[b]); b++; } return b; };
    V.b = firstCount();
    let sc = null, vl = null;
    const apply = (a, b, padTop) => {
      const want = new Set();
      for (let i = a; i < b; i++) want.add(V.items[i].key);
      for (const [key, el] of V.nodes) if (!want.has(key)) { el.remove(); V.nodes.delete(key); }
      const none = vl.querySelector(':scope > .cp-none');
      if (none && V.items.length) none.remove();
      const missing = [];
      for (let i = a; i < b; i++) if (!V.nodes.has(V.items[i].key)) missing.push(i);
      let made = [];
      if (missing.length) {
        const t = doc.createElement('template');
        t.innerHTML = missing.map((i) => itemHtml(V.items[i])).join('');
        made = Array.from(t.content.children);
        missing.forEach((i, j) => V.nodes.set(V.items[i].key, made[j]));
      }
      let prev = null;
      for (let i = a; i < b; i++) {
        const el = V.nodes.get(V.items[i].key);
        const next = prev ? prev.nextElementSibling : vl.firstElementChild;
        if (el !== next) vl.insertBefore(el, next || null);
        prev = el;
      }
      vl.style.paddingTop = `${Math.round(padTop)}px`;
      vl.style.paddingBottom = `${Math.round(sum(b, V.items.length))}px`;
      V.a = a; V.b = b;
      for (const el of made) for (const h of el.querySelectorAll('.cp-thumb[data-move]')) tileFor(h);
    };
    // Reads what's drawn first (the layout is as the last frame left it), then changes the page.
    const update = () => {
      V.raf = 0;
      if (ctl.closed || !sc) return;
      let n = 0, tot = 0;
      for (const [key, el] of V.nodes) { const h = el.offsetHeight; if (h > 0) { V.h.set(key, h); if (key[0] !== 'h') { n++; tot += h; } } }
      if (n) V.est = tot / n;
      const top = sc.scrollTop, height = sc.clientHeight || G.innerHeight;
      const over = Math.max(320, height * 0.8);
      let y = 0, a = 0;
      while (a < V.items.length && y + hOf(V.items[a]) < top - over) { y += hOf(V.items[a]); a++; }
      let b = a, y2 = y;
      while (b < V.items.length && y2 < top + height + over) { y2 += hOf(V.items[b]); b++; }
      apply(a, b, y);
    };
    const soon = () => { if (!V.raf) V.raf = G.requestAnimationFrame(update); };
    // The list again (a filter, a search): from its top, rows enough for the screen at once.
    const relist = () => {
      V.items = build();
      if (sc) sc.scrollTop = 0;
      if (!V.items.length) {
        for (const el of V.nodes.values()) el.remove();
        V.nodes.clear();
        vl.style.paddingTop = vl.style.paddingBottom = '0px';
        if (!vl.querySelector(':scope > .cp-none')) vl.insertAdjacentHTML('beforeend', emptyHtml());
        else vl.querySelector(':scope > .cp-none').outerHTML = emptyHtml();
        return;
      }
      apply(0, firstCount(), 0);
      soon();
    };
    // A move's rows (it can be in Suggested and in its group) after it's added or taken out.
    const mark = (id) => {
      const on = inDay(id);
      for (const el of vl.querySelectorAll('.cp-row')) {
        if (twinOf(el.dataset.id) !== twinOf(id)) continue;
        el.classList.toggle('is-in', on);
        const b = el.querySelector('.cp-row-main');
        if (!replacing) b.setAttribute('aria-pressed', String(on));
        const m = el.querySelector('.cp-row-mark');
        m.innerHTML = U.icon(on ? 'check' : 'plus');
        if (on && !U.reduced() && m.animate) m.animate([{ transform: 'scale(.5)' }, { transform: 'scale(1.15)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' });
      }
    };

    /* ---------- the tray */
    const trayHtml = () => {
      const n = st.items.length, k = added();
      const seen = {};
      const chips = st.items.map((it, i) => {
        seen[it.move] = (seen[it.move] || 0) + 1;
        const name = nameOf(it.move);
        return `<li data-key="t-${it.move}-${seen[it.move]}"><button type="button" class="cp-tray-item${fresh.has(it) ? ' is-new' : ''}" data-act="cpTrayOut" data-arg="${i}" aria-label="${U.esc(`Take out ${name}`)}">${thumb(it.move, 'is-tray')}<span class="cp-tray-x" aria-hidden="true">${U.icon('close')}</span></button></li>`;
      }).join('');
      return `<div class="cp-tray-what" role="status" aria-label="${U.esc(`${U.plural(n, 'exercise')} in day ${di + 1}, ${LIM} at most`)}"><b class="cp-tray-n rf-num">${n}</b><span class="cp-tray-of rf-num">of ${LIM}</span></div>
        ${n ? `<ul class="cp-tray-list" data-hscroll aria-label="${U.esc(`In day ${di + 1}. Tap one to take it out.`)}">${chips}</ul>` : `<p class="cp-tray-empty t-footnote rf-muted">Tap a move to add it</p>`}
        <button type="button" class="rf-btn cp-tray-go" data-variant="${k ? 'filled' : 'tinted'}" data-size="lg" data-act="cpPickDone">${U.esc(k ? `Add ${k}` : 'Done')}</button>`;
    };
    const tray = () => {
      const el = ctl.el.querySelector('.cp-tray');
      if (!el) return;
      U.morph(el, trayHtml());
      for (const h of el.querySelectorAll('.cp-thumb[data-move]')) if (!h.hasAttribute('data-want') && !h.querySelector(':scope > img:not([data-other])')) tileFor(h);
      const list = el.querySelector('.cp-tray-list');
      if (list) list.scrollLeft = list.scrollWidth;
    };

    /* ---------- the filters */
    const kitLabel = () => (st.kit ? kits[st.kit] : !st.mine ? 'Everything' : '');
    const filterBtn = () => `<button type="button" class="rf-btn cp-kit${kitLabel() ? ' is-on' : ''}" data-act="cpKitMenu" aria-label="${U.esc(`Filters${kitLabel() ? `: ${kitLabel()}` : ''}`)}">${U.icon('sliders')}${kitLabel() ? `<span class="cp-kit-label">${U.esc(kitLabel())}</span>` : ''}</button>`;
    const redoFilter = () => { const b = ctl.el.querySelector('.cp-kit'); if (b) b.outerHTML = filterBtn(); };

    const replacingHtml = () => {
      if (!replacing) return '';
      return `<div class="cp-replacing">${thumb(replacing.move, 'is-tray')}<span class="cp-replacing-text"><span class="t-footnote rf-muted">Replacing</span><span class="cp-row-name">${U.esc(nameOf(replacing.move))}</span></span><span class="t-footnote rf-muted rf-num cp-replacing-meta">${U.nb(itemMeta(replacing))}</span></div>`;
    };
    const body = () => `<div class="cp-pick${replacing ? ' is-replace' : ''}">
        <div class="cp-pick-top">
          ${replacingHtml()}
          <div class="rf-search cp-q">${U.icon('search')}<input class="rf-input rf-search-input" type="search" id="cpQ" placeholder="Search name, muscle or kit" aria-label="Search exercises" autocomplete="off" enterkeyhint="search"><button type="button" class="cp-q-clear" data-act="cpQClear" aria-label="Clear the search" hidden>${U.icon('close')}</button></div>
          <div class="cp-filterrow">${filterBtn()}${U.choice('cpGroup', FILTERS, st.group, 'Muscle group', ' class="cp-filters" data-hscroll data-on="cpGroup"')}</div>
        </div>
        <div class="cp-results" data-key="res"><div class="cp-vl" role="list" aria-label="Exercises" style="padding-bottom:${Math.round(sum(V.b, V.items.length))}px">${V.items.length ? V.items.slice(0, V.b).map(itemHtml).join('') : emptyHtml()}</div></div>
        ${replacing ? '' : `<div class="cp-tray" data-key="tray">${trayHtml()}</div>`}
      </div>`;

    /* ---------- closing: the day changes once, now */
    const commit = (value) => {
      if (replacing) { U.render(); return; }
      const changed = JSON.stringify(st.items) !== JSON.stringify(orig);
      if (changed && C().get(S, planId)) {
        C().update(S, planId, (p) => { if (p.days[di]) p.days[di].items = st.items.slice(0, LIM).map((x) => Object.assign({}, x)); }, U.today());
        if (ui.fresh === planId && st.items.length) ui.fresh = null;
        U.save();
        if (value !== 'ok') {
          const k = added();
          U.toast(k ? `Added ${U.plural(k, 'exercise')} to day ${di + 1}` : `Day ${di + 1} changed`, 'positive', undefined, { label: 'Undo', onClick: () => { if (!C().get(U.S, planId)) return; C().update(U.S, planId, (p) => { if (p.days[di]) p.days[di].items = orig.map((x) => Object.assign({}, x)); }, U.today()); U.save(); U.render(); U.haptic('undo'); } });
        }
      }
      U.render();
    };
    const title = replacing ? 'Replace exercise' : `Add to day ${di + 1}`;
    const ctl = U.sheet({
      title, size: 'full', cls: 'cp-sheet cp-picker', body: body(),
      // Before its first frame: the rows that are in it, and the gestures.
      after: (c) => {
        sc = c.el.querySelector('.cp-results');
        vl = c.el.querySelector('.cp-vl');
        for (const el of vl.children) if (el.dataset.vkey && el.dataset.vkey !== 'none') V.nodes.set(el.dataset.vkey, el);
        V.a = 0;
        wire(c.el);
      },
      // Right after it: each row's 3D still asked for, the window measured, the picked chip in sight.
      later: (c) => {
        for (const h of c.el.querySelectorAll('.cp-pick .cp-thumb[data-move]')) tileFor(h);
        soon();
        const rail = c.el.querySelector('.cp-filters');
        const chip = rail && rail.querySelector('[aria-checked="true"]');
        if (chip && st.group !== 'all') rail.scrollLeft = Math.max(0, chip.offsetLeft - (rail.clientWidth - chip.offsetWidth) / 2);
      },
      onClose: (v) => commit(v),
    });

    /* ---------- gestures: scroll, search, a long press */
    let lp = null;
    function wire(el) {
      sc.addEventListener('scroll', soon, { passive: true });
      if (G.ResizeObserver) new G.ResizeObserver(() => soon()).observe(sc);
      const q = el.querySelector('#cpQ');
      const clear = el.querySelector('.cp-q-clear');
      let timer = 0;
      q.addEventListener('input', () => {
        st.q = q.value;
        clear.hidden = !q.value;
        clearTimeout(timer);
        timer = setTimeout(relist, 90);
      });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q.blur(); } });
      // A long press on a row opens its how-to (and its click doesn't then add it).
      vl.addEventListener('pointerdown', (e) => {
        const b = e.target.closest && e.target.closest('.cp-row-main');
        if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if (lp) clearTimeout(lp.t);
        lp = { id: b.dataset.arg, x: e.clientX, y: e.clientY, fired: false };
        lp.t = setTimeout(() => { if (lp && !lp.gone) { lp.fired = true; U.act.cpHowTo({ dataset: { arg: lp.id } }); } }, 480);
      });
      const cancel = (e) => { if (lp && (e.type !== 'pointermove' || Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10)) { clearTimeout(lp.t); lp.gone = true; } };
      vl.addEventListener('pointermove', cancel, { passive: true });
      vl.addEventListener('pointercancel', cancel);
      vl.addEventListener('pointerup', () => { if (lp) clearTimeout(lp.t); });
      vl.addEventListener('click', (e) => { if (lp && lp.fired && e.target.closest('.cp-row-main')) { e.preventDefault(); e.stopPropagation(); } lp = null; }, true);
      vl.addEventListener('contextmenu', (e) => { if (e.target.closest('.cp-row')) e.preventDefault(); });
    }

    /* ---------- actions */
    const outToast = (it, at) => {
      U.toast(`Took out ${nameOf(it.move).toLowerCase()}`, 'neutral', undefined, { label: 'Undo', onClick: () => {
        if (ctl.closed) { if (U.route.view === 'planEdit' && U.route.arg === planId) edit((p) => { const l = p.days[di] && p.days[di].items; if (l) l.splice(Math.min(at, l.length), 0, it); }); }
        else { st.items.splice(Math.min(at, st.items.length), 0, it); mark(it.move); tray(); }
        U.haptic('undo');
      } });
    };
    U.act.cpPick = (b) => {
      const id = b.dataset.arg;
      const x = byId.get(id);
      if (replacing) { swapTo(id); return; }
      let at = -1;
      st.items.forEach((it, i) => { if (twinOf(it.move) === twinOf(id)) at = i; });
      if (at >= 0) {
        const [it] = st.items.splice(at, 1);
        U.haptic('toggleOff');
        if (!fresh.has(it)) outToast(it, at);
      } else {
        if (st.items.length >= LIM) { U.haptic('deny'); U.toast(`Day ${di + 1} is full`, 'caution', `${LIM} exercises is the most a day holds. Take one out to add another.`); return; }
        const it = C().itemFor(S, id, day);
        if (!it) return;
        fresh.add(it);
        st.items.push(it);
        U.haptic('toggleOn');
        if (x && !x.ok) U.toast(`${x.name} is in`, 'neutral', `${U.cap(x.why)}, so the app swaps in something similar until you can.`);
      }
      mark(id);
      tray();
    };
    U.act.cpTrayOut = (b) => {
      const i = Number(b.dataset.arg);
      const it = st.items[i];
      if (!it) return;
      st.items.splice(i, 1);
      U.haptic('remove');
      mark(it.move);
      tray();
      outToast(it, i);
    };
    U.act.cpPickDone = () => { U.haptic(added() ? 'success' : 'dismiss'); ctl.close('ok'); };
    const swapTo = (id) => {
      const old = replacing;
      const it = Object.assign(C().itemFor(S, id, day) || { move: id, sets: old.sets }, { sets: old.sets }, old.rest != null ? { rest: old.rest } : {});
      C().update(S, planId, (p) => { if (p.days[di] && p.days[di].items[replaceK]) p.days[di].items[replaceK] = it; }, U.today());
      U.save();
      U.haptic('swap');
      ctl.close('ok');
      U.toast(`${nameOf(id)} in`, 'positive', `In place of ${nameOf(old.move).toLowerCase()}.`, { label: 'Undo', onClick: () => { if (!C().get(U.S, planId)) return; C().update(U.S, planId, (p) => { if (p.days[di] && p.days[di].items[replaceK]) p.days[di].items[replaceK] = old; }, U.today()); U.save(); U.render(); U.haptic('undo'); } });
    };
    U.on.cpGroup = (el, ev, v) => { st.group = v; relist(); };
    U.act.cpQClear = () => { const q = ctl.el.querySelector('#cpQ'); q.value = ''; st.q = ''; ctl.el.querySelector('.cp-q-clear').hidden = true; relist(); q.focus(); U.haptic('tap'); };
    U.act.cpShowAll = () => { st.mine = false; redoFilter(); relist(); U.haptic('toggleOn'); };
    U.act.cpClearFilters = () => {
      st.kit = ''; st.q = ''; st.group = 'all';
      const q = ctl.el.querySelector('#cpQ'); q.value = ''; ctl.el.querySelector('.cp-q-clear').hidden = true;
      const all = ctl.el.querySelector('.cp-filters [data-arg="all"]');
      if (all && all.getAttribute('aria-checked') !== 'true') all.click(); else relist();
      redoFilter();
      U.haptic('tap');
    };
    // Filters: what the moves are done with (the kinds the list holds), and Only what I can do.
    U.act.cpKitMenu = (btn) => {
      const have = C().KIT.filter(([k]) => cat.some((x) => x.kit.includes(k) && (!st.mine || x.ok)));
      const m = U.menu(btn, [{ act: 'cpKit', arg: '', icon: 'check', label: 'Any equipment' }]
        .concat(have.map(([k, label]) => ({ act: 'cpKit', arg: k, icon: 'check', label })), [null, { act: 'cpMine', icon: 'check', label: 'Only what I can do' }]), { label: 'Filters' });
      if (!m) return;
      m.classList.add('cp-kit-menu');
      for (const b of m.querySelectorAll('[data-act="cpKit"]')) if ((b.dataset.arg || '') === st.kit) b.setAttribute('aria-current', 'true');
      if (st.mine) m.querySelector('[data-act="cpMine"]').setAttribute('aria-current', 'true');
    };
    U.act.cpKit = (b) => { st.kit = b.dataset.arg || ''; U.haptic('select'); redoFilter(); relist(); };
    U.act.cpMine = () => { st.mine = !st.mine; if (st.mine && st.kit && !cat.some((x) => x.ok && x.kit.includes(st.kit))) st.kit = ''; U.haptic(st.mine ? 'toggleOn' : 'toggleOff'); redoFilter(); relist(); };
  }

  /* ================================================================== using a plan */
  U.act.cpUse = (el) => {
    const S = U.S, day = U.today();
    const id = el.dataset.arg || U.route.arg;
    const plan = C().get(S, id);
    const before = C().activeId(S);
    const r = C().use(S, id, day);
    if (!r) { U.haptic('deny'); U.toast('Finish the plan first', 'caution', C().problems(plan)[0]); return; }
    U.save(true);
    U.render();
    U.haptic('success');
    U.toast(`Using ${plan.name}`, 'positive', r.from > day ? 'It starts tomorrow.' : 'Today and the Plan tab follow it now.', { label: 'Undo', onClick: () => { C().use(U.S, before, U.today()); U.save(true); U.render(); U.haptic('undo'); } });
  };
  U.act.cpCoach = () => {
    const S = U.S, day = U.today();
    const before = C().activeId(S);
    if (!before) return;
    const r = C().use(S, null, day);
    U.save(true);
    U.render();
    U.haptic('toggleOff');
    U.toast('Back to the coach\'s plan', 'neutral', r && r.from > day ? 'From tomorrow.' : 'It picks up from today.', { label: 'Undo', onClick: () => { C().use(U.S, before, U.today()); U.save(true); U.render(); U.haptic('undo'); } });
  };
  U.act.cpMenu = (el) => {
    const id = el.dataset.arg;
    const plan = C().get(U.S, id);
    if (!plan) return;
    const ctl = U.sheet({
      title: plan.name, size: 'fit',
      body: `<ul class="rf-list">
        ${U.row({ icon: 'share', tone: 'violet', title: 'Share', sub: 'A QR code or a link', act: 'cpShare', arg: id, chevron: true })}
        ${C().countItems(plan) ? U.row({ icon: 'sparkle', tone: 'violet', title: 'Improve it', sub: 'Claude or the on-device AI reworks it from your data', act: 'cpImproveFromMenu', arg: id, chevron: true }) : ''}
        ${U.row({ icon: 'copy', tone: 'indigo', title: 'Duplicate', sub: 'A copy to change', act: 'cpDup', arg: id })}
        ${U.row({ icon: 'trash', tone: 'rose', title: 'Delete plan', act: 'cpDelete', arg: id })}
      </ul>`,
    });
    U.act.cpImproveFromMenu = () => { ctl.close('ok'); setTimeout(() => U.act.cpImprove({ dataset: { arg: id } }), 320); };
    U.act.cpDup = () => {
      ctl.close('ok');
      const copy = C().duplicate(U.S, id);
      U.save();
      U.haptic('copy');
      U.open('planEdit', copy.id);
      U.toast('Duplicated', 'positive', copy.name);
    };
    // Deleted at once, with Undo: the question before it said "You can undo this for a few seconds",
    // a step the toast's Undo already covers.
    U.act.cpDelete = () => {
      ctl.close('ok');
      const active = C().activeId(U.S) === id;
      const token = C().remove(U.S, id, U.today());
      U.save(true);
      U.haptic('remove');
      if (U.route.view === 'planEdit' && U.route.arg === id) U.back(); else U.render();
      U.toast('Plan deleted', 'neutral', active ? 'The coach\'s plan takes over.' : undefined, { label: 'Undo', onClick: () => { C().restore(U.S, token, U.today()); U.save(true); U.render(); U.haptic('undo'); } });
    };
  };

  /* ================================================================== sharing */
  U.act.cpShare = async (el) => {
    const top = U.topSheet();
    if (top && !top.el.classList.contains('cp-share-sheet')) top.close('ok');
    const S = U.S;
    const plan = C().get(S, el.dataset.arg || U.route.arg);
    if (!plan) return;
    if (C().problems(plan).length) { U.haptic('deny'); U.toast('Finish the plan first', 'caution', C().problems(plan)[0]); return; }
    const name = firstName();
    const st = { withName: !!name, data: null, error: null };
    const code = () => (st.data ? C().link(st.data) : '');
    const body = () => `<div class="sheet-pad cp-share">
        <div class="cp-qr" data-key="qr">${st.data ? GH.qr.svg(code(), { label: `A QR code for ${plan.name}`, cls: 'cp-qr-svg' }) : st.error ? `<p class="t-callout">${U.esc(st.error)}</p>` : '<span class="rf-spinner" data-size="sm"><i></i></span>'}</div>
        <div class="cp-share-what"><p class="t-headline">${U.esc(plan.name)}</p><p class="t-footnote rf-muted">${U.esc(`${C().summary(plan)}${st.withName ? ` · from ${name}` : ''}`)}</p></div>
        <div class="cp-share-btns">
          <button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpSendLink"${st.data ? '' : ' disabled'}>${U.icon('share')}Send a link</button>
          <button type="button" class="rf-btn" data-size="lg" data-act="cpCopyLink"${st.data ? '' : ' disabled'}>${U.icon('copy')}Copy</button>
        </div>
        ${name ? `<ul class="rf-list">${U.sw(`Show my name (${name})`, st.withName, 'data-on="cpShareName"')}</ul>` : ''}
        <p class="t-footnote rf-muted">They scan it in Gradient Health, under Your plans, or tap the link. It holds only the plan's name, days and exercises${st.withName ? ', and your first name' : ''}. Nothing goes through a server.</p>
      </div>`;
    const ctl = U.sheet({ title: 'Share this plan', size: 'fit', cls: 'cp-sheet cp-share-sheet', body: body() });
    const make = async () => {
      try { st.data = await C().encode(plan, { from: st.withName ? name : '' }); st.error = null; } catch (e) { st.error = 'Couldn\'t make the code. Try again.'; }
      if (!ctl.closed) ctl.update(body());
      const svg = ctl.el.querySelector('.cp-qr-svg');
      if (svg && !U.reduced() && svg.animate) svg.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
    };
    U.on.cpShareName = (e2, ev, v) => { st.withName = !!v; make(); };
    U.act.cpSendLink = () => {
      if (!st.data) return;
      const who = st.withName && name ? `${name} shared a workout plan with you` : 'Here\'s a workout plan for you';
      const text = `${who}: ${plan.name} (${C().summary(plan)}). Open it in Gradient Health: ${code()}`;
      const ok = GH.platform && GH.platform.share(text);
      if (ok) U.haptic('send'); // (else the link is copied, with copy's)
      if (U.badgeEvent) U.badgeEvent('sharedPlan');
      if (!ok) U.act.cpCopyLink();
    };
    U.act.cpCopyLink = async () => {
      if (!st.data) return;
      const ok = GH.platform && await GH.platform.copy(code());
      if (ok) U.haptic('copy');
      U.toast(ok ? 'Link copied' : 'Couldn\'t copy the link', ok ? 'positive' : 'caution');
    };
    make();
  };

  /* ================================================================== getting a shared plan */
  U.act.cpScan = async () => {
    if (!GH.scanner) { U.toast('Scanning isn\'t available here', 'caution'); return; }
    const text = await GH.scanner.scan({ qr: true, title: 'Scan a plan code', accept: (t) => !!C().dataFrom(t), notThis: 'That code isn\'t a Gradient Health plan', badLink: 'That link doesn\'t hold a plan' });
    if (text) U.openSharedPlan(text);
  };
  function importSheet(got) {
    const S = U.S, day = U.today();
    const plan = got.plan;
    const fp = C().fingerprint(plan);
    const have = C().list(S).find((p) => C().fingerprint(p) === fp) || null;
    const st = { saved: have, existed: !!have };
    const swaps = C().swapsFor(S, plan, day);
    const dayRows = plan.days.map((d, di) => {
      const offs = C().offsetsFor(plan.days.length, plan.weekdays);
      return `<div class="cp-imp-day"><p class="cp-day-eyebrow"><b>Day ${di + 1}</b><span>${U.esc(WD[offs[di]])}</span><span class="cp-imp-title">${U.esc(C().titleOf(plan, di))}</span></p>
        <ul class="cp-imp-list">${d.items.map((it, i) => {
          const sw = swaps.find((x) => x.day === di && x.i === i);
          const m = M().MOVES[it.move];
          return `<li class="cp-imp-ex">${thumb(it.move)}<span class="cp-ex-text"><span class="cp-ex-name">${U.esc(m.name)}</span><span class="cp-ex-meta rf-num">${U.esc(itemMeta(it))}</span>${sw ? `<span class="cp-swap">${U.icon(sw.to ? 'shuffle' : 'alert')}<span>${U.esc(sw.to ? `${M().MOVES[sw.to].name} for you: ${sw.why}` : `Left out for you: ${sw.why}`)}</span></span>` : ''}</span></li>`;
        }).join('')}</ul></div>`;
    }).join('');
    const body = () => {
      const done = st.saved;
      const unknown = got.report.unknown.length;
      return `<div class="sheet-pad cp-import">
        <div class="cp-imp-head">${art(plan, 'is-lg')}<div class="cp-imp-head-text"><span class="cp-src" data-src="shared">${U.esc(plan.from ? `From ${plan.from}` : 'Shared with you')}</span><p class="t-title-3 cp-name">${U.esc(plan.name)}</p><p class="t-footnote rf-muted">${U.esc(`${C().summary(plan)} · ${daysLine(plan)}`)}</p></div></div>
        ${plan.note ? `<p class="t-callout cp-note is-box">${U.esc(plan.note)}</p>` : ''}
        ${swaps.length ? `<p class="cp-swap is-box">${U.icon('shuffle')}<span>${U.esc(`${swaps.length === 1 ? 'One exercise needs' : `${swaps.length} exercises need`} something you don't have. You'll get the closest one you can do, shown below.`)}</span></p>` : ''}
        ${unknown ? `<p class="cp-swap is-box">${U.icon('alert')}<span>${U.esc(`${unknown === 1 ? 'One exercise needs' : `${unknown} exercises need`} a newer Gradient Health, so ${unknown === 1 ? 'it was' : 'they were'} left out.`)}</span></p>` : ''}
        ${done ? `<div class="cp-saved" data-key="saved"><p class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>${st.existed ? 'Already in your plans' : 'Saved to your plans'}</span></p>
            <div class="cp-imp-btns">${C().activeId(S) === done.id ? '' : `<button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpImpUse">${U.icon('play')}${S.profile.workouts === false ? 'Turn on workouts and use it' : 'Use it now'}</button>`}<button type="button" class="rf-btn" data-size="lg" data-act="cpImpOpen">Open it</button></div></div>`
    : `<div class="cp-imp-btns"><button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpImpSave">${U.icon('download')}Save to my plans</button></div>`}
        <div class="cp-imp-days">${dayRows}</div>
      </div>`;
    };
    const ctl = U.sheet({ title: C().sharedTitle(plan), size: 'auto', detent: 'large', cls: 'cp-sheet cp-import-sheet', body: body(), after: (c) => drawThumbs(c.el) });
    U.act.cpImpSave = () => {
      const r = C().save(U.S, plan);
      st.saved = r.plan; st.existed = r.existed;
      U.save(true);
      U.haptic('save');
      ctl.update(body());
      drawThumbs(ctl.el);
      if (U.route.view === 'plans') U.render();
    };
    U.act.cpImpUse = () => {
      const id = st.saved && st.saved.id;
      const r = id ? C().use(U.S, id, U.today()) : null;
      if (!r) return;
      // Someone who tracks only food and health turns workouts back on by choosing to use a plan.
      const wasOff = U.S.profile.workouts === false;
      if (wasOff) U.S.profile.workouts = true;
      U.save(true);
      ctl.close('ok');
      U.haptic('success');
      if (wasOff) U.render();
      U.go('plan');
      U.toast(`Using ${st.saved.name}`, 'positive', `${wasOff ? 'Workouts are on again. ' : ''}${r.from > U.today() ? 'It starts tomorrow.' : 'Your week follows it from today.'}`);
    };
    U.act.cpImpOpen = () => { const id = st.saved && st.saved.id; ctl.close('ok'); if (id) U.open('planEdit', id); };
  }

  U.cpImport = importSheet;

  /* ================================================================== ask the coach */
  const ASK_CHIPS = ['3 days a week', '30 minutes', 'Full body', 'Upper and lower', 'Push, pull, legs', 'Bigger arms', 'Stronger legs', 'No equipment', 'Easy on my knees'];
  // A plan's days as Build me a plan and Improve show them: each day's moves with their sets.
  const planView = (S, plan) => plan.days.map((d, di) => `<div class="cp-imp-day"><p class="cp-day-eyebrow"><b>Day ${di + 1}</b><span class="cp-imp-title">${U.esc(C().titleOf(plan, di))}</span><span class="rf-num">${C().minutes(S, plan, di, U.today())} min</span></p>
      <ul class="cp-imp-list">${d.items.map((it) => `<li class="cp-imp-ex">${thumb(it.move)}<span class="cp-ex-text"><span class="cp-ex-name">${U.esc(M().MOVES[it.move].name)}</span><span class="cp-ex-meta rf-num">${U.esc(itemMeta(it))}</span></span></li>`).join('')}</ul></div>`).join('');
  // About what a Claude request for a plan costs with the person's model ("about 4¢ with Opus 5.5"),
  // or nothing for the on-device AI.
  function costHint(S, by) {
    const sp = GH.spend;
    if (by !== 'claude' || !sp) return '';
    const c = sp.typical(S, 'build');
    return `About ${c < 10000 ? 'under 1¢' : c < 1e6 ? `${Math.round(c / 10000)}¢` : sp.money(c)} with ${sp.model(S).short}.`;
  }
  U.act.cpBuild = () => {
    const S = U.S;
    const st = { step: 'ask', text: '', plan: null, by: null, ctrl: null, saved: null };
    const body = () => {
      if (st.step === 'propose' || st.step === 'refining' || st.step === 'saved') {
        const p = st.plan;
        const head = `<div class="cp-imp-head">${art(p, 'is-lg')}<div class="cp-imp-head-text"><span class="cp-src" data-src="coach">Built by the coach${st.by === 'claude' ? ' with Claude' : st.by === 'device' ? ' with the on-device AI' : ''}</span><p class="t-title-3 cp-name">${U.esc(p.name)}</p><p class="t-footnote rf-muted">${U.esc(`${C().summary(p)} · ${daysLine(p)}`)}</p></div></div>`;
        const note = p.note ? `<p class="t-callout tailor-note">${U.icon('sparkle', 'sm')}<span>${U.esc(p.note)}</span></p>` : '';
        const acts = st.step === 'refining'
          ? `<div class="cp-refining" role="status"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">The coach is fine-tuning it…</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpBuildSkip">Use this version</button></div>`
          : st.step === 'saved'
            ? `<div class="cp-saved"><p class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>Saved to your plans</span></p><div class="cp-imp-btns"><button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpBuildUse">${U.icon('play')}Use it now</button><button type="button" class="rf-btn" data-size="lg" data-act="cpBuildOpen">Edit it</button></div></div>`
            : `<div class="cp-imp-btns"><button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpBuildSave">Save</button><button type="button" class="rf-btn" data-size="lg" data-act="cpBuildEdit">Change it</button></div>`;
        return `<div class="sheet-pad cp-import cp-build${st.step === 'refining' ? ' is-refining' : ''}">
          ${st.text ? `<p class="t-callout rf-muted tailor-asked">"${U.esc(st.text)}"</p>` : ''}
          ${head}${note}${acts}
          <div class="cp-imp-days">${planView(S, p)}</div>
          ${st.step === 'propose' ? '<p class="t-footnote rf-muted">Nothing changes until you save and use it. You can edit it after.</p>' : ''}
        </div>`;
      }
      const knows = C().knows(S);
      return `<div class="sheet-pad tailor cp-ask">
        <p class="t-callout rf-muted">Say what you want. The coach builds on what it knows about you and shows you the plan first.</p>
        <div class="rf-field"><label class="rf-field-label" for="cpAskQ">What would you like?</label><div class="rf-field-control"><textarea class="rf-input" id="cpAskQ" rows="3" maxlength="400" placeholder="3 days, 30 minutes, bigger arms, easy on my knees">${U.esc(st.text)}</textarea></div></div>
        <div class="ob-chips tailor-chips">${ASK_CHIPS.map((x) => `<button type="button" class="rf-chip" data-act="cpAskChip" data-arg="${U.esc(x)}">${U.esc(x)}</button>`).join('')}</div>
        <button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="cpBuildGo">${U.icon('sparkle')}Build my plan</button>
        <div class="cp-knows"><p class="t-subhead">What the coach uses</p><ul class="cp-knows-list">${knows.map(([k, v]) => `<li><span class="t-footnote rf-muted">${U.esc(k)}</span><span class="t-footnote">${U.esc(v)}</span></li>`).join('')}</ul></div>
      </div>`;
    };
    const ctl = U.sheet({ title: 'Build me a plan', size: 'auto', cls: 'cp-sheet cp-build-sheet', body: body(), onClose: () => { if (st.ctrl) st.ctrl.abort(); } });
    const draw = () => { if (!ctl.closed) { ctl.update(body()); drawThumbs(ctl.el); } };
    U.act.cpAskChip = (b) => {
      const q = doc.getElementById('cpAskQ');
      if (!q) return;
      const v = q.value.trim();
      q.value = v ? `${v.replace(/[,.\s]+$/, '')}, ${b.dataset.arg.toLowerCase()}` : b.dataset.arg;
      U.haptic('tick');
    };
    U.act.cpBuildGo = async () => {
      const q = doc.getElementById('cpAskQ');
      st.text = (q ? q.value : st.text || '').trim();
      const day = U.today();
      const w = C().wishes(S, st.text);
      let draft;
      try { draft = C().generate(S, day, w); } catch (e) { if (G.console) G.console.error(e); U.toast('The coach couldn\'t build that one', 'caution', 'Try saying it another way.'); return; }
      st.plan = draft; st.by = null;
      const by = await C().modelFor(S);
      st.step = by ? 'refining' : 'propose';
      draw();
      grow(ctl);
      U.haptic('tap');
      if (!by) return;
      const me = st.ctrl = new AbortController();
      const r = await C().refine(S, day, w, draft, me.signal).catch(() => ({ plan: draft, by: null }));
      if (st.ctrl !== me || me.signal.aborted || st.step !== 'refining') return;
      st.plan = r.plan; st.by = r.by; st.step = 'propose';
      draw();
      U.haptic('tap');
      // A Claude limit that stopped its take: the coach's plan stands, and they're told why.
      if (r.error && GH.ai && GH.ai.isBudget(r.error.code)) U.toast('Claude didn\'t refine it', 'caution', r.error.message);
    };
    U.act.cpBuildSkip = () => { if (st.ctrl) st.ctrl.abort(); st.ctrl = null; st.step = 'propose'; draw(); };
    U.act.cpBuildEdit = () => { st.step = 'ask'; st.plan = null; draw(); };
    U.act.cpBuildSave = () => {
      const r = C().save(S, st.plan);
      st.saved = r.plan;
      st.step = 'saved';
      U.save(true);
      U.haptic('save');
      draw();
      if (U.route.view === 'plans') U.render();
    };
    U.act.cpBuildUse = () => {
      const r = st.saved ? C().use(S, st.saved.id, U.today()) : null;
      if (!r) return;
      U.save(true);
      ctl.close('ok');
      U.haptic('success');
      U.go('plan');
      U.toast(`Using ${st.saved.name}`, 'positive', r.from > U.today() ? 'It starts tomorrow.' : 'Your week follows it from today.');
    };
    U.act.cpBuildOpen = () => { const id = st.saved && st.saved.id; ctl.close('ok'); if (id) U.open('planEdit', id); };
  };

  /* ================================================================== improve a plan of their own */
  // Claude (or the on-device AI) reworks one of their plans from their training, their health and
  // anything they ask, under the same checks as a plan built from scratch. What changes is listed
  // first and the new version under it; their plan stays as it is until they replace it or save the
  // new one as a plan of its own.
  const IMPROVE_CHIPS = ['Shorter workouts', 'More for my arms', 'Easier on my knees', 'A bit harder', 'More variety'];
  U.act.cpImprove = async (el) => {
    const id = (el && el.dataset && el.dataset.arg) || U.route.arg;
    const S = U.S;
    const plan0 = C().get(S, id);
    if (!plan0) return;
    const by = await C().modelFor(S);
    if (!by) { U.toast('Set up an AI coach first', 'neutral', 'Turn on Claude or the on-device AI in Settings, under AI coach.'); return; }
    const who = by === 'claude' ? 'Claude' : 'The on-device AI';
    const st = { step: 'ask', text: '', plan: null, changes: [], ctrl: null, error: null };
    const body = () => {
      if (st.step === 'working') return `<div class="sheet-pad cp-import cp-build"><div class="cp-refining" role="status"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">${U.esc(who)} is reworking it…</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpImproveStop">Stop</button></div></div>`;
      if (st.step === 'none') {
        return `<div class="sheet-pad cp-import"><p class="t-headline">Your plan stays as it is</p><p class="t-callout rf-muted">${U.esc(st.error || `${who} couldn't make a version that passes the checks this time.`)}</p>
          <div class="cp-imp-btns"><button type="button" class="rf-btn" data-size="lg" data-act="cpImproveAgain">Try again</button></div></div>`;
      }
      if (st.step === 'propose') {
        const p = st.plan;
        if (!st.changes.length) return `<div class="sheet-pad cp-import"><p class="t-headline">${U.esc(who)} kept it as it is</p><p class="t-callout rf-muted">${U.esc(p.note || 'It already fits what you asked for and what your data shows.')}</p><div class="cp-imp-btns"><button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpImproveDone">Done</button></div></div>`;
        return `<div class="sheet-pad cp-import cp-build">
          ${st.text ? `<p class="t-callout rf-muted tailor-asked">"${U.esc(st.text)}"</p>` : ''}
          ${p.note ? `<p class="t-callout tailor-note">${U.icon('sparkle', 'sm')}<span>${U.esc(p.note)}</span></p>` : ''}
          <p class="t-subhead">What changes</p>
          <ul class="cp-changes t-footnote">${st.changes.slice(0, 12).map((x) => `<li>${U.esc(x)}</li>`).join('')}${st.changes.length > 12 ? `<li>${U.esc(`and ${st.changes.length - 12} more`)}</li>` : ''}</ul>
          <div class="cp-imp-btns"><button type="button" class="rf-btn" data-variant="filled" data-size="lg" data-act="cpImproveReplace">Use these changes</button><button type="button" class="rf-btn" data-size="lg" data-act="cpImproveNew">Save as a new plan</button></div>
          <div class="cp-imp-days">${planView(S, p)}</div>
          <p class="t-footnote rf-muted">Your plan stays as it is until you choose.</p>
        </div>`;
      }
      return `<div class="sheet-pad tailor cp-ask">
        <p class="t-callout rf-muted">${U.esc(who)} reworks it from your training, health and requests, then shows what it would change. ${U.esc(costHint(S, by))}</p>
        <div class="rf-field"><label class="rf-field-label" for="cpImpQ">Anything you'd like? (optional)</label><div class="rf-field-control"><textarea class="rf-input" id="cpImpQ" rows="2" maxlength="300" placeholder="Shorter workouts, more for my arms">${U.esc(st.text)}</textarea></div></div>
        <div class="ob-chips tailor-chips">${IMPROVE_CHIPS.map((x) => `<button type="button" class="rf-chip" data-act="cpImpChip" data-arg="${U.esc(x)}">${U.esc(x)}</button>`).join('')}</div>
        <button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="cpImproveGo">${U.icon('sparkle')}Improve it</button>
      </div>`;
    };
    const ctl = U.sheet({ title: `Improve ${plan0.name}`, size: 'auto', cls: 'cp-sheet cp-build-sheet', body: body(), onClose: () => { if (st.ctrl) st.ctrl.abort(); } });
    const draw = () => { if (!ctl.closed) { ctl.update(body()); drawThumbs(ctl.el); } };
    U.act.cpImpChip = (b) => {
      const q = doc.getElementById('cpImpQ');
      if (!q) return;
      const v = q.value.trim();
      q.value = v ? `${v.replace(/[,.\s]+$/, '')}, ${b.dataset.arg.toLowerCase()}` : b.dataset.arg;
      U.haptic('tick');
    };
    U.act.cpImproveGo = async () => {
      const q = doc.getElementById('cpImpQ');
      st.text = (q ? q.value : st.text || '').trim();
      const me = st.ctrl = new AbortController();
      st.step = 'working';
      draw();
      U.haptic('tap');
      const plan = C().get(S, id);
      const r = await C().improve(S, U.today(), plan || plan0, st.text, me.signal).catch((e) => ({ plan: null, error: e }));
      if (st.ctrl !== me || me.signal.aborted) return;
      st.ctrl = null;
      if (!r.plan) {
        st.step = 'none';
        st.error = r.error && GH.ai && GH.ai.isBudget(r.error.code) ? r.error.message : null;
        draw();
        U.haptic('deny');
        return;
      }
      st.plan = r.plan; st.changes = r.changes; st.step = 'propose';
      draw();
      grow(ctl);
      U.haptic('tap');
    };
    U.act.cpImproveStop = () => { if (st.ctrl) st.ctrl.abort(); st.ctrl = null; st.step = 'ask'; draw(); };
    U.act.cpImproveAgain = () => { st.step = 'ask'; st.error = null; draw(); };
    U.act.cpImproveDone = () => ctl.close('ok');
    U.act.cpImproveReplace = () => {
      const was = C().get(S, id);
      if (!was || !st.plan) return;
      const before = JSON.parse(JSON.stringify({ days: was.days, note: was.note }));
      C().update(S, id, (p) => { p.days = st.plan.days; if (st.plan.note) p.note = st.plan.note; }, U.today());
      U.save(true);
      ctl.close('ok');
      U.haptic('success');
      U.render();
      U.toast('Plan updated', 'positive', undefined, { label: 'Undo', onClick: () => { C().update(U.S, id, (p) => { p.days = before.days; p.note = before.note; }, U.today()); U.save(true); U.render(); U.haptic('undo'); } });
    };
    U.act.cpImproveNew = () => {
      if (!st.plan) return;
      const r = C().save(S, Object.assign({}, st.plan, { name: `${plan0.name} (improved)`.slice(0, 40) }));
      U.save(true);
      ctl.close('ok');
      U.haptic('save');
      if (r && r.plan) U.open('planEdit', r.plan.id);
      U.toast('Saved to your plans', 'positive', 'Yours stays as it was.');
    };
  };

})(typeof window !== 'undefined' ? window : globalThis);
