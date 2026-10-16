/* Your plans (GH.customPlan on screen), the part that's in the page: each move's picture (3D still,
 * or a stand-in from the first frame), a plan's cover, the plan in use on the Plan tab and the swaps
 * on Today, and links to a shared plan (the scanner, a link the app was opened with or that opens it).
 * The screens and sheets themselves (the Plans page, a plan's page, the exercise picker, one
 * exercise, New plan, sharing, a shared plan's preview, Build me a plan and Improve) are a part of
 * their own, src/ui/planbuilder.js (scripts/build.mjs APP_CHUNKS, 'planUi'), which loads the first
 * time one is wanted, or in an idle moment after launch; until then the stand-ins at the end of this
 * file take its place.
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


  /* ================================================================== stills */
  // Each tile shows its move's key pose, with a picture from its first frame, never a blank square.
  // With the 3D figure: its still in the person's look (kept on the phone, src/ui/stills.js) when
  // it's kept; otherwise a kept still of the same move in another size or look, or else the flat
  // figure, stands in, and the 3D still fades in over it once it's drawn. Rows and small tiles are
  // Plan's size (52) and share its stills, kept across launches; the item sheet's large one is drawn
  // for the launch only. With the flat figure picked (or no WebGL), the quick flat figure shows at
  // once and the full one, with its chair, bench or wall, takes its place in a calm moment.
  const T = { svg: new Map(), quick: new Map(), queue: new Set(), pending: 0 };
  const SMALL = 52, LARGE = 120;
  const want3d = () => !!(U.stills && U.stills.ok());
  const sizeOf = (h) => (h.classList.contains('is-xl') ? LARGE : SMALL);
  const thumb = (id, cls) => `<span class="cp-thumb${cls ? ` ${cls}` : ''}" data-morph="keep" data-move="${U.esc(id)}" aria-hidden="true">${standIn(id, cls && /\bis-xl\b/.test(cls) ? LARGE : SMALL)}</span>`;
  function personMove(id) {
    const m = M().MOVES[id];
    if (!m) return null;
    try { return M().forPerson ? M().forPerson(m, B().eqFor(U.S, U.today())) : m; } catch (e) { return m; }
  }
  // A tile's picture for its first frame: the kept 3D still (or an older figure's of it), a kept
  // still of the same move in another size or look, or the quick flat figure.
  function standIn(id, size) {
    if (want3d() && U.S) {
      const m = personMove(id);
      if (m) {
        const o = U.stills.look(size);
        const img = U.stills.img(m, o);
        if (img) return img;
        const alt = otherStill(m, o, size);
        if (alt) return alt;
      }
    }
    return quickFlat(id);
  }
  // A kept still of the same move in the person's look at another size, or in the other theme.
  function otherStill(m, o, size) {
    const tries = [];
    for (const css of size === LARGE ? [SMALL] : [LARGE]) tries.push(U.stills.look(css));
    tries.push(Object.assign({}, o, { dark: !o.dark }));
    for (const css of size === LARGE ? [SMALL] : [LARGE]) tries.push(Object.assign({}, U.stills.look(css), { dark: !o.dark }));
    for (const x of tries) {
      const k = U.stills.key(m, x), u = U.stills.url(k);
      if (u) return `<img alt="" draggable="false" src="${U.esc(u)}" data-k="${U.esc(k)}" data-other="">`;
    }
    return '';
  }
  // Asks for each tile's 3D still (it fades in over the stand-in), or with the flat figure, puts the
  // full flat figure in when it's calm.
  function drawThumbs(root) {
    if (!root || !U.S) return;
    const hosts = root.querySelectorAll('.cp-thumb[data-move]');
    for (const h of hosts) tileFor(h);
  }
  function tileFor(h) {
    const id = h.getAttribute('data-move');
    if (!h.firstElementChild) h.innerHTML = quickFlat(id);
    if (want3d()) {
      const m = personMove(id);
      if (!m) return;
      const size = sizeOf(h);
      U.stills.tile(h, m, U.stills.look(size), keepFlat, size === LARGE ? { keep: false, standIn: true } : { standIn: true });
      return;
    }
    h.removeAttribute('data-want');
    if (h.getAttribute('data-drawn') !== id) { T.queue.add(h); fullFlatSoon(); }
  }
  // A still that can't be drawn: what the tile shows stays (a still in another look, or the flat
  // figure), and the full flat figure takes the quick one's place when it's calm.
  function keepFlat(h) {
    if (!h.firstElementChild) h.innerHTML = quickFlat(h.getAttribute('data-move'));
    if (h.querySelector(':scope > svg[data-quick]')) { T.queue.add(h); fullFlatSoon(); }
  }
  function fullFlatSoon() {
    if (T.pending || !T.queue.size) return;
    const run = (deadline) => {
      T.pending = 0;
      for (const h of T.queue) {
        if (U.calm && !U.calm()) break;
        T.queue.delete(h);
        const id = h.getAttribute('data-move');
        if (!h.isConnected || h.getAttribute('data-drawn') === id || (want3d() && h.hasAttribute('data-want'))) continue;
        const svg = flatStill(id);
        if (svg) { h.textContent = ''; h.appendChild(svg.cloneNode(true)); h.setAttribute('data-drawn', id); }
        if (!deadline || deadline.timeRemaining() < 12) break;
      }
      if (T.queue.size) T.pending = setTimeout(() => { T.pending = 0; fullFlatSoon(); }, 250);
    };
    T.pending = G.requestIdleCallback ? G.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(() => run(null), 60);
  }
  // The flat figure in the move's key pose as markup, quickly: the pose engine's own drawing
  // (GH.pose.drawList, in the figure's classes, so it looks like the flat figure) cropped to what's
  // drawn, without the chair, bench or wall and without working out the whole rep's bounds first,
  // which takes 30 to 40 ms a move at 4x CPU (this takes one or two). Kept for the launch.
  const OUTLINE = 1.9;
  const f1 = (n) => Math.round(n * 10) / 10;
  function quickFlat(id) {
    if (T.quick.has(id)) return T.quick.get(id);
    let out = '';
    try { out = drawQuick(personMove(id)); } catch (e) { out = ''; }
    T.quick.set(id, out);
    return out;
  }
  function drawQuick(m) {
    const P = GH.pose;
    if (!m || !P || !P.drawList || !P.framePose) return '';
    const tl = m.$tl || (m.$tl = P.timeline(m));
    const dl = P.drawList(m, P.framePose(m, m.key || tl.steps[0].to), {});
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (p, r) => { if (!p || !isFinite(p[0]) || !isFinite(p[1])) return; x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r); y0 = Math.min(y0, p[1] - r); y1 = Math.max(y1, p[1] + r); };
    const xy = (p) => `${f1(p[0])},${f1(p[1])}`;
    const line = (cls, a, b, w) => `<line${cls ? ` class="${cls}"` : ''} x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"${w != null ? ` stroke-width="${f1(w)}"` : ''}/>`;
    const circle = (cls, c, r) => `<circle class="${cls}" cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(r)}"/>`;
    const eq = { back: '', far: '', near: '', front: '' };
    for (const e of dl.eq) {
      const where = e.layer === 'back' || e.layer === 'far' || e.layer === 'near' ? e.layer : 'front';
      eq[where] += `<g class="fig-${U.esc(e.k)}">${quickEq(e, take, line, circle, xy)}</g>`;
    }
    let body = '';
    for (const ly of ['back', 'far', 'core', 'near', 'front']) {
      let o = '', f = '', bd = '';
      for (const it of dl.layers[ly] || []) {
        take(it.a, it.w / 2); take(it.b, it.w / 2);
        o += line(it.lead ? 'lead' : '', it.a, it.b, it.w);
        f += line('', it.a, it.b, Math.max(0.5, it.w - 2 * OUTLINE));
        for (const b of it.bands) bd += line('', b.a, b.b, b.w);
      }
      if (ly === 'core' && dl.head && dl.head.c) {
        const c = dl.head.c, r = dl.head.r;
        take(c, r + OUTLINE);
        o += circle('fig-head', c, r + OUTLINE / 2);
        f += circle('fig-head-fill', c, r - OUTLINE / 2);
        if (dl.view === 'side' && P.dir) { const d = P.dir(dl.head.dir + 72); bd += circle('fig-eye', [c[0] + (dl.mirrored ? -d[0] : d[0]) * r * 0.5, c[1] + d[1] * r * 0.5], 1.3); }
      }
      body += `<g class="fig-layer fig-${ly}"><g class="fig-outline">${o}</g><g class="fig-fill">${f}</g><g class="fig-bands">${bd}</g>${ly === 'core' ? '' : `<g class="fig-eq">${eq[ly]}</g>`}</g>`;
    }
    if (!isFinite(x0)) return '';
    const floor = dl.view !== 'top';
    if (floor) y1 = Math.max(y1, 1.5);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.09;
    const vb = `${f1(x0 - pad)} ${f1(y0 - pad)} ${f1(x1 - x0 + 2 * pad)} ${f1(y1 - y0 + 1.6 * pad)}`;
    return `<svg class="fig" data-quick viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${floor ? `<g class="fig-props"><line class="fig-floor" x1="${f1(x0 - pad)}" x2="${f1(x1 + pad)}" y1="0.8" y2="0.8"/></g>` : ''}<g class="fig-body">${body}</g></svg>`;
  }
  // One piece of equipment, as the figure draws it (src/engine/pose.js, updateFigure).
  function quickEq(e, take, line, circle, xy) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
    const len = (a) => Math.hypot(a[0], a[1]);
    for (const k of ['a', 'b', 'h']) if (e[k]) take(e[k], 4);
    if (e.c) take(e.c, (e.r || 4) + 1);
    for (const q of e.pts || []) take(q, 2);
    switch (e.k) {
      case 'db': {
        const u = sub(e.b, e.a), n = mul(u, 1 / (len(u) || 1));
        return line('eq-handle', e.a, e.b) + line('eq-plate', e.a, add(e.a, mul(n, 6))) + line('eq-plate', add(e.b, mul(n, -6)), e.b);
      }
      case 'dbEnd': {
        const pts = [];
        for (let k = 0; k < 6; k++) { const a = ((k * 60 + 30) * Math.PI) / 180; pts.push(xy([e.c[0] + Math.cos(a) * e.r, e.c[1] + Math.sin(a) * e.r])); }
        return `<polygon class="eq-plate-end" points="${pts.join(' ')}"/>`;
      }
      case 'kb': {
        const top = sub(e.h, e.c), tu = mul(top, 1 / (len(top) || 1)), n = [tu[1], -tu[0]];
        const a = add(e.c, add(mul(tu, e.r * 0.55), mul(n, 5))), b = add(e.c, add(mul(tu, e.r * 0.55), mul(n, -5)));
        const c1 = add(a, add(mul(tu, 7), mul(n, 0.5))), c2 = add(b, add(mul(tu, 7), mul(n, -0.5)));
        return `<path class="eq-kb-handle" d="M${xy(a).replace(',', ' ')}C${xy(c1).replace(',', ' ')} ${xy(c2).replace(',', ' ')} ${xy(b).replace(',', ' ')}"/>${circle('eq-kb', e.c, e.r)}`;
      }
      case 'ball': return `${circle('eq-ball', e.c, e.r)}<path class="eq-ball-seam" d="M${f1(e.c[0] - e.r * 0.92)} ${f1(e.c[1] - 1)}Q${f1(e.c[0])} ${f1(e.c[1] + e.r * 0.55)} ${f1(e.c[0] + e.r * 0.92)} ${f1(e.c[1] - 1)}"/>`;
      case 'plate': return circle('eq-plate-disc', e.c, e.r) + circle('eq-plate-hub', e.c, Math.min(4.5, e.r * 0.3));
      case 'barEnd': return circle('eq-bar-end', e.c, e.r);
      case 'knob': return circle('eq-knob', e.c, e.r);
      case 'dhandle': return `<polygon class="eq-dhandle" points="${e.pts.map(xy).join(' ')}"/>`;
      case 'band': case 'towel': case 'rope': return line(`eq-${e.k}`, e.a, e.b);
      case 'pad': return line('fig-pad-o', e.a, e.b, e.w) + line('fig-pad-f', e.a, e.b, Math.max(0.5, e.w - 2.4));
      case 'tube': case 'gbar': case 'cable': return line(e.cls || (e.k === 'tube' ? 'fig-frame' : e.k === 'gbar' ? 'fig-bar' : 'fig-cable'), e.a, e.b, e.w || (e.k === 'cable' ? 1.2 : e.k === 'gbar' ? 5 : 3.4));
      case 'rect': take([e.x, e.y], 1); take([e.x + e.w, e.y + e.h], 1); return `<rect class="${e.cls || 'fig-prop'}" x="${f1(e.x)}" y="${f1(e.y)}" width="${f1(e.w)}" height="${f1(e.h)}" rx="${f1(e.rx || 0)}"/>`;
      case 'circ': return circle(e.cls || 'fig-prop', e.c, e.r);
      case 'poly': return `<polygon class="${e.cls || 'fig-prop'}" points="${(e.pts || []).map(xy).join(' ')}"/>`;
      case 'pline': return `<polyline class="${e.cls || 'fig-hook'}" points="${(e.pts || []).map(xy).join(' ')}"/>`;
      default: return e.a && e.b ? line('', e.a, e.b) : '';
    }
  }
  // The full flat figure's key pose, cropped to the figure (the Plan tab draws its tiles the same way).
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

  let pendingLink = null;
  // A plan code or link from anywhere: the scanner, a link the app was opened with, a paste. During
  // set-up it waits, and set-up hears of it (its welcome offers the plan, src/ui/onboarding.js).
  async function openShared(text) {
    if (!U.S || !U.S.profile.onboarded) { pendingLink = text; doc.dispatchEvent(new CustomEvent('gh-shared-plan')); return; }
    let got;
    try { got = await C().decode(text); } catch (e) {
      U.toast(e.code === 'newer' ? 'Update Gradient Health to open this plan' : 'That plan couldn\'t be opened', 'caution', e.message);
      return;
    }
    U.cpImport(got);
  }
  U.openSharedPlan = openShared;
  // Set-up's invited-friend path looks at the plan a link is waiting to open, without opening it:
  // { plan, report, take() } or null. take() hands it over to set-up (which saves it, and uses it if
  // they start with it), so it doesn't open again once set-up is done.
  U.peekSharedPlan = async () => {
    if (!pendingLink && (!U.S || !U.S.profile.onboarded)) coldLink();
    const link = pendingLink;
    if (!link) return null;
    let got;
    try { got = await C().decode(link); } catch (e) { return null; }
    return Object.assign({}, got, { take: () => { if (pendingLink === link) pendingLink = null; } });
  };
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

  /* ================================================================== the part that loads later */
  // What src/ui/planbuilder.js shares with this file.
  U.cpKit = { WD, WD_LONG, GROUP_HUE, FILTERS, SMALL, LARGE, hue, groupName, listWords, firstName, thumb, art, standIn, personMove, drawThumbs, tileFor, quickFlat, flatStill, itemMeta, sourceLine, daysLine, startsLine, grow };
  const PART = 'planUi';
  const part = () => GH.lazy(PART).catch((e) => { if (U.toast) U.toast('Something went wrong', 'critical'); throw e; });
  // map[name] until the part replaces it: it loads the part, then calls what the part put there.
  function stand(map, name) {
    const self = map[name] = function (...args) {
      return part().then(() => {
        const f = map[name];
        if (!f || f === self) return undefined;
        try { return f.apply(this, args); } catch (e) { if (G.console) G.console.error(e); if (U.toast) U.toast('Something went wrong', 'critical'); return undefined; }
      }, () => undefined);
    };
  }
  // A screen until the part is in: its bar and title (Back, as it's opened on top), then the page.
  function screen(name, title) {
    const self = U.screens[name] = {
      render() {
        part().then(() => { const r = U.route; if (U.screens[name] !== self && r.view === name) U.render(); }, () => {});
        const t = title();
        return `${U.navbar(t, '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">${U.esc(t)}</h1>`;
      },
    };
  }
  screen('plans', () => 'Your plans');
  screen('planEdit', () => { const p = U.S && C().get(U.S, U.route.arg); return p && !p.deleted ? p.name : 'Plan'; });
  U.act.openPlans = () => U.open('plans');
  U.act.cpOpen = (el) => U.open('planEdit', el.dataset.arg); // the page's opening has its own haptic
  // Ways in from elsewhere (Plan, You, Claude's page, the plan review) and from a test.
  stand(U.act, 'cpNew');
  stand(U.act, 'cpBuild');
  stand(U.act, 'cpImprove');
  stand(U.act, 'cpScan');
  stand(U.act, 'cpShare');
  stand(U.act, 'cpMenu');
  stand(U.act, 'cpUse');
  stand(U.act, 'cpCoach');
  stand(U.act, 'cpAdd');
  stand(U.act, 'cpItem');
  stand(U.act, 'cpGap');
  stand(U, 'cpImport');
  // It loads ahead: a finger on a way into it, and an idle moment a few seconds after launch.
  const WAYS_IN = ['openPlans', 'cpOpen', 'cpBuild', 'cpImprove', 'reviewPlans', 'reviewImprove'].map((a) => `[data-act="${a}"]`).join(',');
  if (doc) doc.addEventListener('pointerdown', (e) => { if (!GH[PART] && e.target.closest && e.target.closest(WAYS_IN)) GH.lazy(PART).catch(() => {}); }, { capture: true, passive: true });
  const before = U.afterBoot;
  U.afterBoot = () => {
    if (before) before();
    setTimeout(() => { const go = () => { if (!GH[PART] && !doc.hidden) GH.lazy(PART).catch(() => {}); }; if (G.requestIdleCallback) G.requestIdleCallback(go, { timeout: 4000 }); else go(); }, 3500);
  };
})(typeof window !== 'undefined' ? window : globalThis);
