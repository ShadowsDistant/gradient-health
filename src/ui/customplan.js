/* Your plans (GH.customPlan on screen): the Plans page, a plan's page where it's built like a
 * playlist (add exercises, set sets and reps, drag to reorder), the exercise picker with 3D stills,
 * sharing as a QR code or a link, getting a shared plan (a scanned code, a link, the app link the
 * Android shell hands over), and Build me a plan with the coach. Opened from Plan's "Make it yours"
 * and Settings.
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
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const GROUP_HUE = { biceps: 'amber', triceps: 'rose', chest: 'indigo', legs: 'green', back: 'teal', shoulders: 'sky', abs: 'violet', conditioning: 'coral', mobility: 'teal' };
  const hue = (g) => `var(--hue-${GROUP_HUE[g] || 'sky'})`;
  const FILTERS = [['all', 'All'], ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['legs', 'Legs'], ['biceps', 'Biceps'], ['triceps', 'Triceps'], ['abs', 'Abs'], ['conditioning', 'Cardio'], ['mobility', 'Stretching']];
  const groupName = (g) => (g === 'conditioning' ? 'Cardio' : g === 'mobility' ? 'Stretching' : (B().GROUP_NAME || {})[g] || U.cap(String(g)));
  const listWords = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const firstName = () => String((U.S && U.S.profile && U.S.profile.name) || '').trim().split(/\s+/)[0].slice(0, 24);
  const GRIP = '<svg class="cp-grip-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6.5" r="1.6"/><circle cx="15" cy="6.5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="17.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/></svg>';

  const ui = { wd: {}, when: {}, fresh: null };

  /* ================================================================== stills */
  // Each tile shows its move's key pose: the 3D figure's still when 3D is on (drawn once, while the
  // phone is idle, only for tiles on screen), else the flat figure. Tiles fade in as they're drawn.
  const T = { svg: new Map(), q: [], busy: false, io: null, failed: false, loading: false };
  const thumb = (id, cls) => `<span class="cp-thumb${cls ? ` ${cls}` : ''}" data-morph="keep" data-move="${U.esc(id)}" aria-hidden="true"></span>`;
  const want3d = () => !T.failed && !!(U.figure3dOk && U.figure3dOk());
  function look() {
    const pr = (U.S && U.S.profile.prefs) || {};
    const dpr = Math.min(2, G.devicePixelRatio || 1);
    return { width: Math.round(120 * dpr), height: Math.round(120 * dpr), dark: String(GH.platform ? GH.platform.currentTheme() : '').startsWith('dark'), skin: pr.figSkin || 'sand', shirt: pr.figShirt || undefined, crop: true };
  }
  const lookKey = (lk) => `${lk.dark ? 'd' : 'l'}${lk.skin}${lk.shirt || ''}`;
  function personMove(id) {
    const m = M().MOVES[id];
    if (!m) return null;
    try { return M().forPerson ? M().forPerson(m, B().eqFor(U.S, U.today())) : m; } catch (e) { return m; }
  }
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 250 }) : setTimeout(() => fn(null), 24));
  function fillImg(host, url, tag) {
    host.textContent = '';
    const img = doc.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = url;
    host.appendChild(img);
    host.setAttribute('data-drawn', tag);
  }
  function drawThumbs(root) {
    if (!root || !U.S) return;
    const hosts = root.querySelectorAll('.cp-thumb[data-move]');
    if (!hosts.length) return;
    if (want3d()) {
      const f = GH.figure3d;
      if (!f) {
        if (!T.loading && GH.lazy) {
          T.loading = true;
          GH.lazy('figure3d').then(() => { T.loading = false; drawThumbs(doc.body); }, () => { T.loading = false; T.failed = true; drawThumbs(doc.body); });
        }
        return;
      }
      const lk = look();
      const lkk = lookKey(lk);
      for (const h of hosts) {
        const id = h.getAttribute('data-move');
        const tag = `${id}|${lkk}`;
        if (h.getAttribute('data-drawn') === tag && h.firstElementChild) continue;
        const m = personMove(id);
        const url = m && f.cachedStill(m, lk);
        if (url) { fillImg(h, url, tag); continue; }
        if (h.firstElementChild) h.textContent = '';
        h.removeAttribute('data-drawn');
        observe(h);
      }
      return;
    }
    for (const h of hosts) {
      const id = h.getAttribute('data-move');
      if (h.getAttribute('data-drawn') === id && h.firstElementChild) continue;
      const svg = flatStill(id);
      h.textContent = '';
      if (svg) { h.appendChild(svg.cloneNode(true)); h.setAttribute('data-drawn', id); }
    }
  }
  function observe(h) {
    if (!G.IntersectionObserver) { enqueue(h); return; }
    if (!T.io) {
      T.io = new G.IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { T.io.unobserve(e.target); enqueue(e.target); }
      }, { rootMargin: '120px' });
    }
    T.io.observe(h);
  }
  function enqueue(h) {
    if (!T.q.includes(h)) T.q.push(h);
    if (!T.busy) { T.busy = true; idle(drawNext); }
  }
  function drawNext(deadline) {
    const f = GH.figure3d;
    const t0 = Date.now();
    while (T.q.length && f) {
      const h = T.q.shift();
      if (!h.isConnected) continue;
      const id = h.getAttribute('data-move');
      const lk = look();
      const tag = `${id}|${lookKey(lk)}`;
      if (h.getAttribute('data-drawn') === tag) continue;
      const m = personMove(id);
      let url = null;
      try { url = m ? f.still(m, lk) : null; } catch (e) { url = null; }
      if (!url && m) { T.failed = true; T.q = []; T.busy = false; drawThumbs(doc.body); return; }
      if (url) for (const x of doc.querySelectorAll(`.cp-thumb[data-move="${id}"]`)) if (x.getAttribute('data-drawn') !== tag) fillImg(x, url, tag);
      if (deadline ? deadline.timeRemaining() < 8 : Date.now() - t0 > 12) break;
    }
    if (T.q.length) idle(drawNext); else T.busy = false;
  }
  // The flat figure's key pose, cropped to the figure (the Plan tab draws its tiles the same way).
  function flatStill(id) {
    if (T.svg.has(id)) return T.svg.get(id);
    const m = personMove(id);
    if (!m || !GH.pose) return null;
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
    T.svg.set(id, svg);
    return svg;
  }
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
  // A plan's cover: its first four different moves, like an album's artwork.
  function art(plan, cls) {
    const ids = [];
    for (const d of plan.days) for (const it of d.items) if (!ids.includes(it.move)) ids.push(it.move);
    const cells = ids.slice(0, 4);
    const tone = (M().MOVES[cells[0]] || {}).group;
    return `<span class="cp-art${cls ? ` ${cls}` : ''}" style="--c:${hue(tone)}" aria-hidden="true" data-n="${cells.length}">${cells.length ? cells.map((id) => thumb(id, 'is-art')).join('') : `<span class="cp-art-empty">${U.icon('list')}</span>`}</span>`;
  }

  /* ================================================================== words */
  const S0 = () => U.S;
  const itemMeta = (it) => {
    const m = M().MOVES[it.move] || {};
    const bits = [`${it.sets} × ${C().amountText(it)}${m.uni ? ' each side' : ''}`];
    if (it.rest != null) bits.push(it.rest ? `rest ${it.rest >= 120 && it.rest % 60 === 0 ? `${it.rest / 60} min` : `${it.rest} s`}` : 'no rest');
    return bits.join(' · ');
  };
  function sourceLine(plan) {
    if (plan.source === 'shared') return plan.from ? `From ${plan.from}` : 'Shared with you';
    if (plan.source === 'coach') return 'Built by the coach';
    return 'Yours';
  }
  // Which weekdays a plan's days fall on, in words: "Mon, Wed and Fri".
  function daysLine(plan) {
    const offs = C().offsetsFor(plan.days.length, plan.weekdays);
    return listWords(offs.map((o) => WD[o]));
  }
  function startsLine(S, day, plan) {
    const from = C().startDay(S, day);
    if (from > day) return 'Starts tomorrow, since today\'s workout is done or under way.';
    const offs = C().offsetsFor(plan.days.length, plan.weekdays);
    const wd = B().weekday(day);
    const first = offs.find((o) => o >= wd);
    if (first === wd) return `Starts today with ${C().titleOf(plan, plan.weekdays ? offs.indexOf(first) : 0).toLowerCase()}.`;
    if (first != null) return `First workout on ${WD_LONG[first]}.`;
    return `First workout next ${WD_LONG[offs[0]]}.`;
  }

  // Pulls a sheet up to full height (when a plan appears in it).
  function grow(ctl) {
    try {
      if (ctl.detent) ctl.detent('large');
      else if (G.Refract && G.Refract.sheet && G.Refract.sheet.detent) G.Refract.sheet.detent(ctl.el, 'large');
    } catch (e) { /* stays where it is */ }
  }

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
        <p class="lt-sub t-callout rf-muted">Build your own, ask the coach, or add one someone shared with you.</p>
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
    : `<div class="card cp-empty" data-key="empty"><span class="cp-empty-ico" aria-hidden="true">${U.icon('list')}</span><p class="t-headline">No plans yet</p><p class="t-callout rf-muted">Your plans show up here. Share one and anyone with Gradient Health can scan it.</p></div>`}
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
  U.act.openPlans = () => U.open('plans');
  U.act.cpOpen = (el) => { U.haptic('tap'); U.open('planEdit', el.dataset.arg); };

  /* ================================================================== new plan */
  U.act.cpNew = () => {
    const S = U.S;
    const n = C().list(S).length;
    const ctl = U.sheet({
      title: 'New plan', size: 'fit', cls: 'cp-sheet',
      body: `<div class="sheet-pad cp-new">
        <p class="t-callout rf-muted">Start from scratch, or from the week the coach made for you and change what you like.</p>
        <button type="button" class="cp-choice cp-press" data-act="cpNewBlank"><span class="cp-choice-ico" data-tone="indigo" aria-hidden="true">${U.icon('plus')}</span><span class="cp-choice-text"><span class="t-headline">An empty plan</span><span class="t-footnote rf-muted">Name it, add days, pick the exercises</span></span>${U.icon('chevron-right')}</button>
        <button type="button" class="cp-choice cp-press" data-act="cpNewCopy"><span class="cp-choice-ico" data-tone="sky" aria-hidden="true">${U.icon('copy')}</span><span class="cp-choice-text"><span class="t-headline">Start from my current plan</span><span class="t-footnote rf-muted">This week's days and exercises, ready to change</span></span>${U.icon('chevron-right')}</button>
        ${n ? '' : '<p class="t-footnote rf-muted">Nothing changes until you choose to use a plan.</p>'}
      </div>`,
    });
    U.act.cpNewBlank = () => {
      const plan = C().create(S, { name: uniqueName(S, 'My plan') });
      ui.fresh = plan.id;
      U.save();
      ctl.close('ok');
      U.haptic('success');
      U.open('planEdit', plan.id);
      setTimeout(() => { const el = doc.getElementById('cpName'); if (el) { el.focus(); el.select(); } }, 420);
    };
    U.act.cpNewCopy = () => {
      const draft = C().fromCoach(S, U.today());
      draft.name = uniqueName(S, 'My plan');
      const { plan } = C().add(S, draft);
      U.save();
      ctl.close('ok');
      U.haptic('success');
      U.open('planEdit', plan.id);
      U.toast('Copied your current plan', 'positive', 'Change anything. The coach\'s plan stays as it is.');
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
  function dayCard(S, plan, di, swaps, day) {
    const d = plan.days[di];
    const offs = C().offsetsFor(plan.days.length, plan.weekdays);
    const mins = C().minutes(S, plan, di, day);
    const groups = C().groupsOf(plan, di);
    return `<div class="card cp-day" data-key="day-${di}">
      <div class="cp-day-head">
        <span class="cp-day-eyebrow"><b>Day ${di + 1}</b><span>${U.esc(plan.weekdays ? WD_LONG[offs[di]] : WD[offs[di]])}</span></span>
        ${mins ? `<span class="pw-min" aria-label="${U.esc(`about ${mins} minutes`)}">${U.icon('timer')}<span>${U.roll(mins)} min</span></span>` : ''}
        <button type="button" class="rf-btn cp-day-more" data-shape="circle" data-size="sm" data-act="cpDayMenu" data-arg="${di}" aria-label="${U.esc(`Day ${di + 1} options`)}">${U.icon('more')}</button>
      </div>
      <input class="cp-day-title" type="text" maxlength="30" value="${U.esc(d.title)}" placeholder="${U.esc(d.items.length ? C().titleFrom(d.items) : 'Name this day')}" aria-label="${U.esc(`Day ${di + 1} name`)}" data-on="cpDayTitle" data-arg="${di}" enterkeyhint="done">
      ${groups.length ? `<div class="pw-tags" aria-label="Muscles">${groups.map((g) => `<span class="pw-tag" style="--c:${hue(g)}">${U.esc(groupName(g))}</span>`).join('')}</div>` : ''}
      ${d.items.length ? `<ul class="cp-exlist" data-day="${di}">${d.items.map((it, k) => exRow(plan, di, it, k, swaps.find((x) => x.day === di && x.i === k))).join('')}</ul>`
    : `<p class="t-callout rf-muted cp-day-empty">No exercises yet. Add a few to make this day a workout.</p>`}
      <button type="button" class="rf-btn cp-add" data-variant="soft" data-act="cpAdd" data-arg="${di}">${U.icon('plus')}Add exercises</button>
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
            ${active ? `<span class="cp-badge is-lg">${U.icon('check')}${pending ? 'In use from tomorrow' : 'In use'}</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpCoach">Back to the coach's plan</button>`
    : problems.length ? `<p class="t-footnote cp-todo">${U.icon('info')}<span>${U.esc(problems[0])}</span></p>`
      : `<button type="button" class="rf-btn rf-glass cp-use" data-variant="tinted" data-size="lg" data-act="cpUse" data-arg="${plan.id}">${U.icon('play')}Use this plan</button><p class="t-footnote rf-muted">${U.esc(startsLine(S, day, plan))}</p>`}
          </div>
        </div>`;
      return `${U.navbar(plan.name, trailing, back)}
        <h1 class="rf-large-title cp-title">${U.esc(plan.name)}</h1>
        <div class="section">
          ${hero}
          <div class="card cp-names" data-key="names">
            <div class="rf-field"><label class="rf-field-label" for="cpName">Name</label><div class="rf-field-control"><input class="rf-input" id="cpName" type="text" maxlength="40" value="${U.esc(plan.name)}" data-on="cpName" enterkeyhint="done" autocomplete="off"></div></div>
            <div class="rf-field"><label class="rf-field-label" for="cpNote">Note (optional)</label><div class="rf-field-control"><textarea class="rf-input" id="cpNote" rows="2" maxlength="200" placeholder="What it's for, how to do it" data-on="cpNote">${U.esc(plan.note || '')}</textarea></div></div>
          </div>
          ${schedule(plan)}
        </div>
        <h2 class="sec-title t-title-3">Days</h2>
        <div class="section cp-days">
          ${plan.days.map((d, di) => dayCard(S, plan, di, swaps, day)).join('')}
          ${plan.days.length < C().LIMITS.days ? `<button type="button" class="rf-btn cp-addday" data-size="lg" data-act="cpAddDay" data-key="addday">${U.icon('plus')}Add a day</button>` : ''}
          <p class="t-footnote rf-muted cp-foot" data-key="foot">Each workout starts with a short warm-up. Sets go down a little on a lighter week or after a short night, and your reps and weights go up as you answer how many more you could have done.</p>
        </div>`;
    },
    after(screen, S, day, id) {
      drawThumbs(screen);
      wireDrag(screen, id);
    },
  };
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
  U.act.cpDayMenu = (el) => {
    const di = Number(el.dataset.arg);
    const plan = C().get(U.S, U.route.arg);
    if (!plan) return;
    const n = plan.days.length;
    const ctl = U.sheet({
      title: `Day ${di + 1}${plan.days[di].title ? `: ${plan.days[di].title}` : ''}`, size: 'fit',
      body: `<ul class="rf-list">
        ${di > 0 ? U.row({ icon: 'chevron-up', tone: 'sky', title: 'Move day up', act: 'cpDayMove', arg: `${di}:-1` }) : ''}
        ${di < n - 1 ? U.row({ icon: 'chevron-down', tone: 'sky', title: 'Move day down', act: 'cpDayMove', arg: `${di}:1` }) : ''}
        ${n < C().LIMITS.days ? U.row({ icon: 'copy', tone: 'indigo', title: 'Duplicate day', act: 'cpDayCopy', arg: String(di) }) : ''}
        ${n > 1 ? U.row({ icon: 'trash', tone: 'rose', title: 'Delete day', act: 'cpDayDelete', arg: String(di) }) : ''}
      </ul>`,
    });
    const done = () => ctl.close('ok');
    U.act.cpDayMove = (b) => { const [a, dir] = b.dataset.arg.split(':').map(Number); done(); edit((p) => { const [d] = p.days.splice(a, 1); p.days.splice(a + dir, 0, d); }); U.haptic('select'); };
    U.act.cpDayCopy = (b) => { const a = Number(b.dataset.arg); done(); edit((p) => { p.days.splice(a + 1, 0, JSON.parse(JSON.stringify(p.days[a]))); }); delete ui.wd[plan.id]; U.haptic('select'); };
    U.act.cpDayDelete = (b) => {
      const a = Number(b.dataset.arg);
      done();
      const before = JSON.parse(JSON.stringify(plan.days));
      const wdBefore = plan.weekdays ? plan.weekdays.slice() : null;
      edit((p) => { p.days.splice(a, 1); p.weekdays = null; });
      delete ui.wd[plan.id];
      U.haptic('heavy');
      U.toast('Day deleted', 'neutral', undefined, { label: 'Undo', onClick: () => { if (U.route.arg === plan.id) edit((p) => { p.days = before; p.weekdays = wdBefore; }); } });
    };
  };

  /* ---------------------------------------------------------------- one exercise */
  U.act.cpItem = (el) => {
    const [di, k] = String(el.dataset.arg).split(':').map(Number);
    itemSheet(U.route.arg, di, k);
  };
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
      const rest = it.rest == null ? 'auto' : String(it.rest);
      const restOpts = [['auto', 'Auto'], ['0', 'None'], ['30', '30 s'], ['60', '60 s'], ['90', '90 s'], ['120', '2 min'], ['180', '3 min']];
      if (!restOpts.some(([v]) => v === rest)) restOpts.push([rest, `${rest} s`]);
      const n = plan.days[di].items.length;
      return `<div class="sheet-pad cp-item">
        <button type="button" class="cp-item-top cp-press" data-act="cpHowTo" data-arg="${it.move}">${thumb(it.move, 'is-xl')}
          <span class="cp-item-what"><span class="t-footnote rf-muted">${U.esc([groupName(m.group)].concat((m.muscles || []).map((x) => String(x).replace(/([A-Z])/g, ' $1').toLowerCase()).filter((x) => x !== String(m.group).toLowerCase()).slice(0, 3)).join(' · '))}</span>
          <span class="cp-link">${U.icon('info')}How to do it</span></span></button>
        ${swap ? `<p class="cp-swap is-box">${U.icon(swap.to ? 'shuffle' : 'alert')}<span>${U.esc(swap.to ? `You'll do ${M().MOVES[swap.to].name.toLowerCase()} instead: ${swap.why}.` : `Left out for now: ${swap.why}.`)}</span></p>` : ''}
        <div class="cp-steps">
          <div class="cp-step"><span class="t-subhead">Sets</span>${U.stepper('cpSets', it.sets, 1, 10, 'Sets', 'data-on="cpSets"')}</div>
          <div class="cp-step"><span class="t-subhead">${m.timed ? 'Seconds' : m.uni ? 'Reps each side' : 'Reps'}</span>${U.stepper('cpAmt', amt, m.timed ? 5 : 1, m.timed ? 600 : 100, m.timed ? 'Seconds' : 'Reps', 'data-on="cpAmt"', m.timed ? 5 : 1)}</div>
        </div>
        <p class="t-subhead cp-rest-label">Rest between sets</p>
        ${U.choice('cpRest', restOpts, rest, 'Rest between sets', ' class="ob-chips cp-rest" data-on="cpRestPick"')}
        <p class="t-footnote rf-muted">${m.timed ? 'Hold for this long each set.' : 'Your reps go up from here as it gets easier, then the weight, when there is one.'}${rest === 'auto' ? ' Auto rest is 90 s after big moves, 60 s after small ones.' : ''}</p>
        <div class="cp-item-acts">
          <button type="button" class="rf-btn" data-act="cpItemMove" data-arg="-1"${k === 0 ? ' disabled' : ''}>${U.icon('chevron-up')}Up</button>
          <button type="button" class="rf-btn" data-act="cpItemMove" data-arg="1"${k >= n - 1 ? ' disabled' : ''}>${U.icon('chevron-down')}Down</button>
          <button type="button" class="rf-btn" data-act="cpReplace">${U.icon('shuffle')}Replace</button>
          <button type="button" class="rf-btn" data-tone="critical" data-act="cpRemove">${U.icon('trash')}Remove</button>
        </div>
      </div>`;
    };
    const ctl = U.sheet({ title: M().MOVES[it0.move].name, size: 'fit', cls: 'cp-sheet', body: body(), after: (c) => drawThumbs(c.el), onClose: () => { U.render(); } });
    const change = (fn) => {
      if (U.route.arg !== planId) return;
      edit((p) => { const it = p.days[di] && p.days[di].items[k]; if (it) fn(it, p); });
    };
    U.on.cpSets = (el, ev, v) => change((it) => { it.sets = Math.max(1, Math.min(10, Math.round(v) || 1)); });
    U.on.cpAmt = (el, ev, v) => change((it) => { const m = M().MOVES[it.move]; if (m.timed) it.secs = Math.max(5, Math.min(600, Math.round(v) || 5)); else it.reps = Math.max(1, Math.min(100, Math.round(v) || 1)); });
    U.on.cpRestPick = (el, ev, v) => { change((it) => { if (v === 'auto') delete it.rest; else it.rest = Number(v); }); };
    U.act.cpItemMove = (b) => {
      const dir = Number(b.dataset.arg);
      const plan = C().get(S, planId);
      const n = plan ? plan.days[di].items.length : 0;
      if (k + dir < 0 || k + dir >= n) return;
      edit((p) => { const list = p.days[di].items; const [x] = list.splice(k, 1); list.splice(k + dir, 0, x); });
      k += dir;
      U.haptic('select');
      ctl.update(body());
      drawThumbs(ctl.el);
    };
    U.act.cpRemove = () => {
      const plan = C().get(S, planId);
      const it = get();
      if (!plan || !it) return;
      const at = k;
      ctl.close('ok');
      edit((p) => { p.days[di].items.splice(at, 1); });
      U.haptic('heavy');
      U.toast(`Removed ${M().MOVES[it.move].name.toLowerCase()}`, 'neutral', undefined, { label: 'Undo', onClick: () => { if (U.route.arg === planId) edit((p) => { if (p.days[di]) p.days[di].items.splice(at, 0, it); }); } });
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
        U.haptic('select');
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
      U.haptic('heavy');
      const move = (e) => {
        if (e.pointerId !== d.id) return;
        const dy = e.clientY - d.y0;
        const top = d.rects[0].top, bottom = d.rects[d.rects.length - 1].bottom;
        const clamped = Math.max(top - d.rects[d.k].top, Math.min(bottom - d.rects[d.k].bottom, dy));
        row.style.transform = `translate3d(0, ${clamped.toFixed(1)}px, 0) scale(1.02)`;
        // Its new place: how many of the other rows now sit above its middle.
        const mid = d.rects[d.k].top + d.h / 2 + clamped;
        let to = 0;
        d.rects.forEach((r, i) => { if (i !== d.k && mid > r.top + r.height / 2) to++; });
        if (to !== d.to) {
          d.to = to;
          U.haptic('select');
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
        if (e.type !== 'pointercancel' && d.to !== d.k) {
          edit((p) => { const items = p.days[d.di].items; const [x] = items.splice(d.k, 1); items.splice(d.to, 0, x); });
          U.haptic('success');
        }
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
    }
  }

  /* ---------------------------------------------------------------- the exercise picker */
  U.act.cpAdd = (el) => picker(U.route.arg, Number(el.dataset.arg), null);
  function picker(planId, di, replaceK) {
    const S = U.S;
    const st = { q: '', group: 'all', mine: true, added: [] };
    const cat = C().catalog(S, U.today());
    const order = (x) => {
      const gi = FILTERS.findIndex(([g]) => g === x.group);
      const m = M().MOVES[x.id];
      const lad = m.family && M().LADDERS[m.family];
      return [gi < 0 ? 99 : gi, lad ? Object.keys(M().LADDERS).indexOf(m.family) : 99, lad ? lad.rungs.indexOf(x.id) : 99];
    };
    const sorted = cat.slice().sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.name.localeCompare(b.name); });
    const inDay = () => { const p = C().get(S, planId); return p && p.days[di] ? p.days[di].items.map((x) => x.move) : []; };
    const tiles = () => {
      const q = st.q.trim().toLowerCase();
      const have = inDay();
      const hits = sorted.filter((x) => (st.group === 'all' || x.group === st.group) && (!st.mine || x.ok) && (!q || x.name.toLowerCase().includes(q) || groupName(x.group).toLowerCase().includes(q)));
      if (!hits.length) return `<p class="t-callout rf-muted cp-none">${st.mine && sorted.some((x) => !x.ok && x.name.toLowerCase().includes(q)) ? 'Nothing you can do matches that. Turn off "Only what I can do" to see the rest.' : 'No exercise matches that.'}</p>`;
      return `<ul class="cp-grid">${hits.map((x) => {
        const n = have.filter((id) => id === x.id).length;
        const sub = x.ok ? `${groupName(x.group)}${x.timed ? ' · held' : ''}${x.gym && !x.home && (S.profile.where || 'home') === 'both' ? ' · gym' : ''}` : U.cap(x.why || 'Not for you now');
        return `<li data-key="t-${x.id}"><button type="button" class="cp-tile cp-press${n ? ' is-added' : ''}${x.ok ? '' : ' is-off'}" data-act="cpPick" data-arg="${x.id}" aria-pressed="${n > 0}" aria-label="${U.esc(`${x.name}. ${sub}.${n ? ' In this day.' : ''}`)}">
          ${thumb(x.id, 'is-tile')}
          <span class="cp-tile-name">${U.esc(x.name)}</span>
          <span class="cp-tile-sub">${U.esc(sub)}</span>
          <span class="cp-tile-mark" aria-hidden="true">${U.icon(n ? 'check' : replaceK != null ? 'arrow-right' : 'plus')}</span>
        </button></li>`;
      }).join('')}</ul>`;
    };
    const body = () => `<div class="cp-pick">
        <div class="cp-pick-top">
          <div class="rf-search cp-q">${U.icon('search')}<input class="rf-input rf-search-input" type="search" id="cpQ" placeholder="Search exercises" aria-label="Search exercises" value="${U.esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>
          ${U.choice('cpGroup', FILTERS, st.group, 'Muscle group', ' class="cp-filters" data-hscroll data-on="cpGroup"')}
          <ul class="rf-list cp-mine">${U.sw('Only what I can do', st.mine, 'data-on="cpMine"', 'With your equipment, today')}</ul>
        </div>
        <div class="cp-results" data-key="res">${tiles()}</div>
      </div>`;
    const plan = C().get(S, planId);
    const title = replaceK != null ? 'Replace exercise' : `Add to day ${di + 1}`;
    const ctl = U.sheet({ title, size: 'full', cls: 'cp-sheet cp-picker', body: body(), action: { label: 'Done', act: 'cpPickDone' }, after: (c) => drawThumbs(c.el), onClose: () => U.render() });
    const refresh = () => { ctl.update(body()); drawThumbs(ctl.el); };
    const doneBtn = () => ctl.el.querySelector('.rf-sheet-header [data-act="cpPickDone"]');
    const count = () => { const b = doneBtn(); if (b) b.textContent = st.added.length ? `Done (${st.added.length})` : 'Done'; };
    let timer = 0;
    ctl.el.addEventListener('input', (e) => {
      if (e.target.id !== 'cpQ') return;
      st.q = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const res = ctl.el.querySelector('.cp-results');
        if (res) { U.morph(res, tiles()); drawThumbs(res); }
      }, 110);
    });
    U.on.cpGroup = (el, ev, v) => { st.group = v; refresh(); };
    U.on.cpMine = (el, ev, v) => { st.mine = !!v; refresh(); };
    U.act.cpPickDone = () => ctl.close('ok');
    U.act.cpPick = (b) => {
      const id = b.dataset.arg;
      const m = M().MOVES[id];
      const x = cat.find((c) => c.id === id);
      const item = m.timed ? { move: id, sets: 3, secs: Math.max(5, Math.min(600, m.start || 30)) } : { move: id, sets: 3, reps: Math.max(1, Math.min(100, m.start || 10)) };
      if (replaceK != null) {
        edit((p) => { const old = p.days[di].items[replaceK]; if (old) p.days[di].items[replaceK] = Object.assign(item, { sets: old.sets }, old.rest != null ? { rest: old.rest } : {}); });
        U.haptic('success');
        ctl.close('ok');
        return;
      }
      const p0 = C().get(S, planId);
      const have = p0 && p0.days[di] ? p0.days[di].items : [];
      // Tapping an exercise just added takes it back out; otherwise it's added to the end.
      const mine = st.added.lastIndexOf(id);
      if (mine >= 0 && have.some((h) => h.move === id)) {
        edit((p) => { const list = p.days[di].items; const at = list.map((h) => h.move).lastIndexOf(id); if (at >= 0) list.splice(at, 1); });
        st.added.splice(mine, 1);
        U.haptic('toggleOff');
      } else {
        if (have.length >= C().LIMITS.items) { U.toast(`A day holds up to ${C().LIMITS.items} exercises`, 'caution'); return; }
        edit((p) => { p.days[di].items.push(item); });
        st.added.push(id);
        U.haptic('toggleOn');
        if (x && !x.ok) U.toast(`${m.name} is in`, 'neutral', `${U.cap(x.why)}, so the app swaps in something similar until you can.`);
      }
      const res = ctl.el.querySelector('.cp-results');
      if (res) { U.morph(res, tiles()); drawThumbs(res); }
      const tile = ctl.el.querySelector(`.cp-tile[data-arg="${id}"]`);
      if (tile && !U.reduced() && tile.animate && st.added.includes(id)) tile.querySelector('.cp-tile-mark').animate([{ transform: 'scale(.4)' }, { transform: 'scale(1.18)' }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)' });
      count();
    };
  }

  /* ================================================================== using a plan */
  U.act.cpUse = (el) => {
    const S = U.S, day = U.today();
    const id = el.dataset.arg || U.route.arg;
    const plan = C().get(S, id);
    const before = C().activeId(S);
    const r = C().use(S, id, day);
    if (!r) { U.toast('Finish the plan first', 'caution', C().problems(plan)[0]); return; }
    U.save(true);
    U.render();
    U.haptic('success');
    U.toast(`Using ${plan.name}`, 'positive', r.from > day ? 'It starts tomorrow.' : 'Today and the Plan tab follow it now.', { label: 'Undo', onClick: () => { C().use(U.S, before, U.today()); U.save(true); U.render(); } });
  };
  U.act.cpCoach = () => {
    const S = U.S, day = U.today();
    const before = C().activeId(S);
    if (!before) return;
    const r = C().use(S, null, day);
    U.save(true);
    U.render();
    U.haptic('toggleOff');
    U.toast('Back to the coach\'s plan', 'neutral', r && r.from > day ? 'From tomorrow.' : 'It picks up from today.', { label: 'Undo', onClick: () => { C().use(U.S, before, U.today()); U.save(true); U.render(); } });
  };
  U.act.cpMenu = (el) => {
    const id = el.dataset.arg;
    const plan = C().get(U.S, id);
    if (!plan) return;
    const ctl = U.sheet({
      title: plan.name, size: 'fit',
      body: `<ul class="rf-list">
        ${U.row({ icon: 'share', tone: 'violet', title: 'Share', sub: 'A QR code or a link', act: 'cpShare', arg: id, chevron: true })}
        ${U.row({ icon: 'copy', tone: 'indigo', title: 'Duplicate', sub: 'A copy to change', act: 'cpDup', arg: id })}
        ${U.row({ icon: 'trash', tone: 'rose', title: 'Delete plan', act: 'cpDelete', arg: id })}
      </ul>`,
    });
    U.act.cpDup = () => {
      ctl.close('ok');
      const copy = C().duplicate(U.S, id);
      U.save();
      U.haptic('success');
      U.open('planEdit', copy.id);
      U.toast('Duplicated', 'positive', copy.name);
    };
    U.act.cpDelete = async () => {
      ctl.close('ok');
      const active = C().activeId(U.S) === id;
      const ok = await U.confirm(`Delete ${plan.name}?`, active ? 'You\'re using it now, so the coach\'s plan takes over.' : 'You can undo this for a few seconds.', 'Delete', 'critical', 'trash');
      if (!ok) return;
      const token = C().remove(U.S, id, U.today());
      U.save(true);
      if (U.route.view === 'planEdit' && U.route.arg === id) U.back(); else U.render();
      U.toast('Plan deleted', 'neutral', undefined, { label: 'Undo', onClick: () => { C().restore(U.S, token, U.today()); U.save(true); U.render(); } });
    };
  };

  /* ================================================================== sharing */
  U.act.cpShare = async (el) => {
    const top = U.topSheet();
    if (top && !top.el.classList.contains('cp-share-sheet')) top.close('ok');
    const S = U.S;
    const plan = C().get(S, el.dataset.arg || U.route.arg);
    if (!plan) return;
    if (C().problems(plan).length) { U.toast('Finish the plan first', 'caution', C().problems(plan)[0]); return; }
    const name = firstName();
    const st = { withName: !!name, data: null, error: null };
    const code = () => (st.data ? C().link(st.data) : '');
    const body = () => `<div class="sheet-pad cp-share">
        <div class="cp-qr" data-key="qr">${st.data ? GH.qr.svg(code(), { label: `A QR code for ${plan.name}`, cls: 'cp-qr-svg' }) : st.error ? `<p class="t-callout">${U.esc(st.error)}</p>` : '<span class="rf-spinner" data-size="sm"><i></i></span>'}</div>
        <div class="cp-share-what"><p class="t-headline">${U.esc(plan.name)}</p><p class="t-footnote rf-muted">${U.esc(`${C().summary(plan)}${st.withName ? ` · from ${name}` : ''}`)}</p></div>
        <div class="cp-share-btns">
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="cpSendLink"${st.data ? '' : ' disabled'}>${U.icon('share')}Send a link</button>
          <button type="button" class="rf-btn" data-size="lg" data-act="cpCopyLink"${st.data ? '' : ' disabled'}>${U.icon('copy')}Copy</button>
        </div>
        ${name ? `<ul class="rf-list">${U.sw(`Show my name (${name})`, st.withName, 'data-on="cpShareName"')}</ul>` : ''}
        <p class="t-footnote rf-muted">They scan it in Gradient Health (Your plans, then Add a shared plan) or tap the link. It holds only this plan: its name, days and exercises${st.withName ? ', and your first name' : ''}. Nothing goes through a server.</p>
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
      U.haptic('tap');
      if (!ok) U.act.cpCopyLink();
    };
    U.act.cpCopyLink = async () => {
      if (!st.data) return;
      const ok = GH.platform && await GH.platform.copy(code());
      U.toast(ok ? 'Link copied' : 'Couldn\'t copy the link', ok ? 'positive' : 'caution');
    };
    make();
  };

  /* ================================================================== getting a shared plan */
  U.act.cpScan = async () => {
    if (!GH.scanner) { U.toast('Scanning isn\'t available here', 'caution'); return; }
    const text = await GH.scanner.scan({ qr: true, title: 'Scan a plan code', accept: (t) => !!C().dataFrom(t), notThis: 'That code isn\'t a Gradient Health plan', badLink: 'That link doesn\'t hold a plan' });
    if (text) openShared(text);
  };
  let pendingLink = null;
  // A plan code or link from anywhere: the scanner, a link the app was opened with, a paste.
  async function openShared(text) {
    if (!U.S || !U.S.profile.onboarded) { pendingLink = text; return; }
    let got;
    try { got = await C().decode(text); } catch (e) {
      U.toast(e.code === 'newer' ? 'Update Gradient Health to open this plan' : 'That plan couldn\'t be opened', 'caution', e.message);
      return;
    }
    importSheet(got);
  }
  U.openSharedPlan = openShared;
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
        ${swaps.length ? `<p class="cp-swap is-box">${U.icon('shuffle')}<span>${U.esc(`${swaps.length === 1 ? 'One exercise needs' : `${swaps.length} exercises need`} something you don't have. The app swaps in the closest one you can do, shown below.`)}</span></p>` : ''}
        ${unknown ? `<p class="cp-swap is-box">${U.icon('alert')}<span>${U.esc(`${unknown === 1 ? 'One exercise needs' : `${unknown} exercises need`} a newer version of Gradient Health, so ${unknown === 1 ? 'it was' : 'they were'} left out.`)}</span></p>` : ''}
        ${done ? `<div class="cp-saved" data-key="saved"><p class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>${st.existed ? 'Already in your plans' : 'Saved to your plans'}</span></p>
            <div class="cp-imp-btns">${C().activeId(S) === done.id ? '' : `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="cpImpUse">${U.icon('play')}${S.profile.workouts === false ? 'Turn on workouts and use it' : 'Use it now'}</button>`}<button type="button" class="rf-btn" data-size="lg" data-act="cpImpOpen">Open it</button></div></div>`
    : `<div class="cp-imp-btns"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="cpImpSave">${U.icon('download')}Save to my plans</button></div>`}
        <div class="cp-imp-days">${dayRows}</div>
      </div>`;
    };
    const ctl = U.sheet({ title: C().sharedTitle(plan), size: 'full', cls: 'cp-sheet cp-import-sheet', body: body(), after: (c) => drawThumbs(c.el) });
    U.act.cpImpSave = () => {
      const r = C().save(U.S, plan);
      st.saved = r.plan; st.existed = r.existed;
      U.save(true);
      U.haptic('success');
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

  // Links: the Android shell calls __gh.onLink(url) when a plan link opens the running app, and
  // AndroidBridge.pendingLink() holds the one it was started with. Other handlers stay chained.
  const hooks = G.__gh || (G.__gh = {});
  const prevLink = hooks.onLink;
  hooks.onLink = (url) => {
    if (C() && C().isLink(url)) { openShared(String(url)); return true; }
    return typeof prevLink === 'function' ? prevLink(url) : false;
  };
  function coldLink() {
    try {
      const b = G.AndroidBridge;
      const url = b && typeof b.pendingLink === 'function' ? String(b.pendingLink() || '') : '';
      if (url && C().isLink(url)) pendingLink = url;
    } catch (e) { /* no link */ }
  }
  // After What's new or the tour (they open by themselves at start), so the plan isn't hidden
  // behind them or they behind it.
  function flushPending(delay) {
    if (!pendingLink || !U.S || !U.S.profile.onboarded) return;
    const url = pendingLink;
    pendingLink = null;
    let waits = 0;
    const open = () => {
      const top = U.topSheet && U.topSheet();
      if (top && !top.closed && waits++ < 240) { setTimeout(open, 500); return; }
      openShared(url);
    };
    setTimeout(open, delay);
  }
  const prevBoot = U.afterBoot;
  U.afterBoot = () => { if (prevBoot) prevBoot(); coldLink(); flushPending(900); };
  const prevOnb = U.afterOnboarding;
  U.afterOnboarding = () => { if (prevOnb) prevOnb(); flushPending(1200); };
  // A new install opened by a link starts with set-up; the plan waits for it.
  if (doc) doc.addEventListener('DOMContentLoaded', () => setTimeout(() => { if (!U.S || !U.S.profile.onboarded) coldLink(); }, 50));

  /* ================================================================== ask the coach */
  const ASK_CHIPS = ['3 days a week', '30 minutes', 'Full body', 'Upper and lower', 'Push, pull, legs', 'Bigger arms', 'Stronger legs', 'No equipment', 'Easy on my knees'];
  U.act.cpBuild = () => {
    const S = U.S;
    const st = { step: 'ask', text: '', plan: null, by: null, ctrl: null, saved: null };
    const planView = (plan) => plan.days.map((d, di) => `<div class="cp-imp-day"><p class="cp-day-eyebrow"><b>Day ${di + 1}</b><span class="cp-imp-title">${U.esc(C().titleOf(plan, di))}</span><span class="rf-num">${C().minutes(S, plan, di, U.today())} min</span></p>
        <ul class="cp-imp-list">${d.items.map((it) => `<li class="cp-imp-ex">${thumb(it.move)}<span class="cp-ex-text"><span class="cp-ex-name">${U.esc(M().MOVES[it.move].name)}</span><span class="cp-ex-meta rf-num">${U.esc(itemMeta(it))}</span></span></li>`).join('')}</ul></div>`).join('');
    const body = () => {
      if (st.step === 'propose' || st.step === 'refining' || st.step === 'saved') {
        const p = st.plan;
        const head = `<div class="cp-imp-head">${art(p, 'is-lg')}<div class="cp-imp-head-text"><span class="cp-src" data-src="coach">Built by the coach${st.by === 'claude' ? ' with Claude' : st.by === 'device' ? ' with the on-device AI' : ''}</span><p class="t-title-3 cp-name">${U.esc(p.name)}</p><p class="t-footnote rf-muted">${U.esc(`${C().summary(p)} · ${daysLine(p)}`)}</p></div></div>`;
        const note = p.note ? `<p class="t-callout tailor-note">${U.icon('sparkle', 'sm')}<span>${U.esc(p.note)}</span></p>` : '';
        const acts = st.step === 'refining'
          ? `<div class="cp-refining" role="status"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">The coach is fine-tuning it…</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="cpBuildSkip">Use this version</button></div>`
          : st.step === 'saved'
            ? `<div class="cp-saved"><p class="cp-eyebrow" data-tone="positive">${U.icon('check-circle')}<span>Saved to your plans</span></p><div class="cp-imp-btns"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="cpBuildUse">${U.icon('play')}Use it now</button><button type="button" class="rf-btn" data-size="lg" data-act="cpBuildOpen">Edit it</button></div></div>`
            : `<div class="cp-imp-btns"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="cpBuildSave">Save</button><button type="button" class="rf-btn" data-size="lg" data-act="cpBuildEdit">Change it</button></div>`;
        return `<div class="sheet-pad cp-import cp-build${st.step === 'refining' ? ' is-refining' : ''}">
          ${st.text ? `<p class="t-callout rf-muted tailor-asked">“${U.esc(st.text)}”</p>` : ''}
          ${head}${note}${acts}
          <div class="cp-imp-days">${planView(p)}</div>
          ${st.step === 'propose' ? '<p class="t-footnote rf-muted">Nothing changes until you save it and choose to use it. You can change anything after.</p>' : ''}
        </div>`;
      }
      const knows = C().knows(S);
      return `<div class="sheet-pad tailor cp-ask">
        <p class="t-callout rf-muted">Say what you want in a plan. The coach builds on what it already knows about you and shows you the plan first.</p>
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
      U.haptic('select');
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
    };
    U.act.cpBuildSkip = () => { if (st.ctrl) st.ctrl.abort(); st.ctrl = null; st.step = 'propose'; draw(); };
    U.act.cpBuildEdit = () => { st.step = 'ask'; st.plan = null; draw(); };
    U.act.cpBuildSave = () => {
      const r = C().save(S, st.plan);
      st.saved = r.plan;
      st.step = 'saved';
      U.save(true);
      U.haptic('success');
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

  /* ================================================================== elsewhere in the app */
  // Plan tab: the plan in use, above the week.
  U.customPlanBanner = (S, day) => {
    const id = C().activeId(S);
    const p = id ? C().get(S, id) : null;
    if (!p) return '';
    const running = C().inForce(S, day);
    const pending = !running || running.id !== p.id;
    return `<div class="card cp-banner" data-key="cpbanner"><button type="button" class="cp-banner-row cp-press" data-act="cpOpen" data-arg="${p.id}">
      ${art(p, 'is-sm')}<span class="cp-banner-text"><span class="cp-eyebrow" data-tone="violet">${U.icon('list')}<span>${pending ? 'Your plan, from tomorrow' : 'Your plan'}</span></span><span class="t-headline cp-name">${U.esc(p.name)}</span></span>
      <span class="cp-go">${U.icon('chevron-right')}</span></button></div>`;
  };
  // Today and Plan: what a custom day swapped, and why.
  U.customSwapNote = (s) => {
    const sw = s && s.custom && s.custom.swaps ? s.custom.swaps : [];
    if (!sw.length) return '';
    return `<p class="cp-swap is-box cp-swaps">${U.icon('shuffle')}<span>${U.esc(sw.map((x) => (x.to ? `${M().MOVES[x.from].name} → ${M().MOVES[x.to].name}: ${x.why}` : `${(M().MOVES[x.from] || { name: x.from }).name} left out: ${x.why}`)).join('. '))}.</span></p>`;
  };
  U.drawPlanThumbs = drawThumbs;
})(typeof window !== 'undefined' ? window : globalThis);
