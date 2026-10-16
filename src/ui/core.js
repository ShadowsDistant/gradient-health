/* UI core: the layout, the router, rendering, delegated events, sheets and dialogs, formatting,
 * health sync and the boot sequence. Screens live in the other src/ui/*.js files and register
 * themselves on GH.ui.
 *
 * Rendering patches the page in place (U.morph) instead of replacing it: nodes that line up are
 * kept, so Refract's enhanced controls, running transitions, focus and scroll positions survive a
 * re-render, and nothing flickers. The navigation bar and the tab bar are built once; a screen's
 * <header class="rf-navbar"> is lifted into the shared bar.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const B = () => GH.brain;
  const R = () => G.Refract || null;
  const P = () => GH.platform || null;

  // Refract's light can follow the phone's tilt, and every step it takes repaints the rim and sheen
  // of each glass and has its backdrop filtered again. A phone in a hand tilts all the time, so the
  // GPU did that all the time too, scroll or not (measured at rest with a hand's tilt emulated: more
  // than twice the GPU's work, for rims turning a few degrees). The light holds still at its designed
  // angle instead, as it does with a mouse that's still: Refract listens to the tilt by itself only
  // where the browser doesn't ask for permission first, so it's asked to here (before Refract's
  // first glass registers, on DOMContentLoaded) and the sensor never starts. Nothing else uses it.
  if (G.DeviceOrientationEvent && typeof G.DeviceOrientationEvent.requestPermission !== 'function') {
    try { G.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); } catch (e) { /* read-only: the light then follows the tilt */ }
  }

  U.screens = U.screens || {};
  U.act = U.act || {};
  U.on = U.on || {};
  U.S = null;
  U.route = { tab: 'today', view: null, arg: null };

  /* ---------------------------------------------------------------- formatting */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  // Escaped, with a number kept on the line of its unit ("25 lb", "10 reps"), "about" or "at" on
  // the line of their number, a " · " on the line it ends (a line never starts with one), a change
  // between numbers whole ("20% → 7%") and any other "→" on the line of what it points to
  // ("Rope pushdown / → 13 reps"), however the line wraps.
  U.nb = (s) => U.esc(s).replace(/(\d) (?=[a-zA-Z½])/g, '$1&nbsp;').replace(/\b(about|at) (?=\d)/g, '$1&nbsp;').replace(/ · /g, '&nbsp;· ')
    .replace(/(\d%?) → (?=\d)/g, '$1&nbsp;→&nbsp;').replace(/ → /g, ' →&nbsp;');
  // Glyphs Refract doesn't have, drawn on its grid (24 px, 1.75 stroke, round ends).
  const EXTRA_ICONS = {
    food: '<path d="M7 3.5v6a2 2 0 0 0 4 0v-6M9 3.5V21M17 21V3.5c-2 1-3.25 3.4-3.25 6.25V14H17"/>',
    flame: '<path d="M12 20.75c3.5 0 5.75-2.4 5.75-5.5 0-3.4-2.5-5.4-3.75-8.6-.3-.8-1.35-.9-1.75-.15-.6 1.15-1.3 2.05-2.25 2.85C8.35 10.7 6.25 12.3 6.25 15.25c0 3.1 2.25 5.5 5.75 5.5z"/><path d="M12 20.75c-1.45 0-2.5-1-2.5-2.4 0-1.55 1.35-2.35 2.05-3.4a.55.55 0 0 1 .9 0c.7 1.05 2.05 1.85 2.05 3.4 0 1.4-1.05 2.4-2.5 2.4z"/>',
    scan: '<path d="M4 8.5V6.25A2.25 2.25 0 0 1 6.25 4H8.5M15.5 4h2.25A2.25 2.25 0 0 1 20 6.25V8.5M20 15.5v2.25A2.25 2.25 0 0 1 17.75 20H15.5M8.5 20H6.25A2.25 2.25 0 0 1 4 17.75V15.5M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/>',
    dumbbell: '<path d="M4.25 9.5v5M7.25 7v10M16.75 7v10M19.75 9.5v5M7.25 12h9.5"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="2.25"/><path d="M9.75 4v3M14.25 4v3M9.75 17v3M14.25 17v3M4 9.75h3M4 14.25h3M17 9.75h3M17 14.25h3M10.25 12h3.5"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.75 10a4.6 4.6 0 0 1 6.5 0M12 10.25l1.25-1.75"/>',
    stop: '<rect x="6.75" y="6.75" width="10.5" height="10.5" rx="2.25" fill="currentColor" stroke="none"/>',
    // A screen with a pulse on it: a recording of what the phone does (scroll diagnostics, What's new).
    activity: '<rect x="3.75" y="5" width="16.5" height="14" rx="3"/><path d="M6.75 12.5h2.25l1.75-3.5 2.75 7 1.75-3.5h2"/>',
    // The muscle groups (U.groupIcon): an exercise for most, a flexed arm, a six-pack, a heartbeat.
    'group-biceps': '<path d="M3.75 11.25c1.6-1.95 3.75-3 6.1-2.95 1.55.05 2.75.85 3.4 2.2l.1-3.1c0-.55-.3-1.05-.8-1.3l-.55-.25a1 1 0 0 1-.35-1.5l.55-.75a1.6 1.6 0 0 1 1.3-.65h1.55c.7 0 1.3.45 1.5 1.1l1.55 5.15c.6 2 .35 4.15-.7 5.95-1.15 1.95-3.25 3.1-5.5 3.1-2.6 0-5.35-.45-8.15-1.45"/><path d="M8 13.25c1.15-.75 2.6-.95 3.9-.55"/>',
    'group-triceps': '<circle cx="12" cy="4.5" r="1.75"/><path d="M12 7v6.25M8.75 8.25 12 7.5l3.25.75M8.75 8.25 6 11.5M15.25 8.25 18 11.5M12 13.25l-1.75 3 1 3M12 13.25l1.75 3-1 3M6 11.5v8.75M18 11.5v8.75"/>',
    'group-chest': '<circle cx="5.25" cy="11.75" r="1.75"/><path d="M7.75 13.5l12.5 5.25M7.75 13.5v6.25M3.75 20.25h16.5"/>',
    'group-back': '<circle cx="12" cy="7" r="1.6"/><path d="M3.75 3.75h16.5M7.5 3.75l2.5 6h4l2.5-6M12 9.75v6M12 15.75l-1.75 4.5M12 15.75l1.75 4.5"/>',
    'group-shoulders': '<circle cx="12" cy="7.25" r="1.6"/><path d="M4.75 4h14.5M6.25 2.5v3M17.75 2.5v3M8.75 4l1.25 5.75h4L15.25 4M12 9.75v6M12 15.75l-2.5 4.5M12 15.75l2.5 4.5"/>',
    'group-legs': '<circle cx="15.5" cy="4.5" r="1.75"/><path d="M14.75 7 9.5 12.25l5.75.5-1.25 7.5h3M14.25 8.5h5.25"/>',
    'group-abs': '<rect x="6.75" y="3.75" width="4.5" height="4.75" rx="1.75"/><rect x="12.75" y="3.75" width="4.5" height="4.75" rx="1.75"/><rect x="6.75" y="9.75" width="4.5" height="4.75" rx="1.75"/><rect x="12.75" y="9.75" width="4.5" height="4.75" rx="1.75"/><rect x="6.75" y="15.75" width="4.5" height="4.5" rx="1.75"/><rect x="12.75" y="15.75" width="4.5" height="4.5" rx="1.75"/>',
    'group-conditioning': '<path d="M12 20.25s-7.75-4.5-7.75-10.25A4.35 4.35 0 0 1 12 7.35 4.35 4.35 0 0 1 19.75 10c0 5.75-7.75 10.25-7.75 10.25z"/><path d="M7 12.25h2.25l1.25-2.25 2 4.25 1.25-2h3.25"/>',
    'group-mobility': '<circle cx="12.75" cy="6.25" r="1.75"/><path d="M12.25 8.75 11 14l-3.75 2.75v3.5M11 14l4.75 1.75 3.5 4.5M12.4 10.1l1.6-6.35"/>',
    'group-balance': '<circle cx="12" cy="4.5" r="1.75"/><path d="M12 7.75v6.5M5.75 9.75 12 8.5l6.25 1.25M12 14.25v6M12 14.25l3.5.75-1.75 2.25-1.75-.5"/>',
    'group-impact': '<circle cx="12" cy="4.25" r="1.75"/><path d="M12 6.75v5.5M7.75 4.25 12 8.25l4.25-4M12 12.25l-3.25 2.5.75 2.75M12 12.25l3.25 2.5-.75 2.75M5.5 20.75h13"/>',
  };
  U.icon = (name, size, cls) => {
    const r = R();
    if (r && r.icons && EXTRA_ICONS[name] && !r.icons[name]) r.icons[name] = EXTRA_ICONS[name];
    if (r && r.icon) { try { const svg = r.icon(name, { size: size || undefined, className: cls || '' }); if (svg) return svg; } catch (e) { /* unknown glyph */ } }
    return `<span class="${cls || ''}" data-icon="${U.esc(name)}" aria-hidden="true"></span>`;
  };
  // A muscle group's glyph: biceps, triceps, chest, legs, back, shoulders, abs, conditioning,
  // mobility, balance and impact (a dumbbell for anything else).
  U.groupIcon = (group, size, cls) => U.icon(EXTRA_ICONS[`group-${group}`] ? `group-${group}` : 'dumbbell', size, cls);

  // (Each formatter is made once: toLocaleString makes a new one on every call.)
  const NUMF = new Map();
  U.num = (n, d) => {
    if (n == null || !isFinite(n)) return '–';
    const max = d == null ? 0 : d, min = d || 0, k = `${max}|${min}`;
    let f = NUMF.get(k);
    if (!f) NUMF.set(k, (f = new Intl.NumberFormat('en-US', { maximumFractionDigits: max, minimumFractionDigits: min })));
    return f.format(Number(n));
  };
  // A number that rolls to its new value when a re-render changes it.
  U.roll = (v, cls) => `<span class="rf-num${cls ? ' ' + cls : ''}" data-roll="${U.esc(v)}">${U.esc(v)}</span>`;
  U.lb = () => !U.S || U.S.profile.units !== 'kg';
  U.wUnit = () => (U.lb() ? 'lb' : 'kg');
  U.kgTo = (kg) => (kg == null ? null : U.lb() ? kg * B().LB_PER_KG : kg);
  U.toKg = (v) => (v == null || !isFinite(v) ? null : U.lb() ? v / B().LB_PER_KG : v);
  U.fmtW = (kg, d) => (kg == null ? '–' : `${U.num(U.kgTo(kg), d == null ? 1 : d)} ${U.wUnit()}`);
  U.fmtMin = (m) => (m == null ? '–' : B().fmtMin(Math.round(m)));
  U.fmtDur = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  U.fmtClock = (ms) => { if (!ms) return '–'; const d = new Date(ms); const h = d.getHours(), m = d.getMinutes(); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  U.fmtDay = (n, wd) => B().fmtDay(n, wd);
  U.ago = (ms, now) => {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  };
  U.plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  U.cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  U.side = (s) => (s === 'R' ? 'Right' : 'Left');
  U.rollHour = () => (U.S && U.S.profile.prefs && U.S.profile.prefs.rollHour != null ? U.S.profile.prefs.rollHour : 4);
  U.today = () => B().dayOf(Date.now(), U.rollHour());
  U.target = (it, amount) => {
    const v = amount == null ? it.target : amount;
    return it.timed ? `${v} s` : `${v} ${v === 1 ? 'rep' : 'reps'}`;
  };

  /* ---------------------------------------------------------------- small markup builders */
  // `extra` on a control is a string of attributes for it; a class in it joins the control's own.
  const splitClass = (extra) => {
    const m = /\sclass="([^"]*)"/.exec(extra || '');
    return m ? { cls: ` ${m[1]}`, rest: (extra || '').replace(m[0], '') } : { cls: '', rest: extra || '' };
  };
  // A segmented control. Rows in lists pass data-size="sm" and stay compact. Its key comes from the
  // name, so a re-render never hands its node to another control; each option carries data-arg.
  U.seg = (name, options, value, label, extra) => {
    const { cls, rest } = splitClass(extra);
    return `<div class="rf-segmented${cls}"${/data-size="sm"/.test(rest) ? '' : ' data-block'} aria-label="${U.esc(label)}"${rest}${/\sdata-key=/.test(rest) ? '' : ` data-key="seg:${U.esc(name)}"`}>${options.map(([v, t]) => `<label class="rf-segment" data-arg="${U.esc(v)}"><input type="radio" name="${U.esc(name)}" value="${U.esc(v)}"${String(v) === String(value) ? ' checked' : ''}>${U.esc(t)}</label>`).join('')}</div>`;
  };
  // A single choice (contract: U.choice(name, opts, value, label, extra)). Up to four short options
  // are a segmented control; more, longer ones, or a sideways rail (data-hscroll) are a row of chips
  // with a glass indicator that slides to the one picked (role=radiogroup, arrow keys included).
  // Either way a pick fires a radio-style change whose value is the option's, so a data-on handler on
  // the control gets it, and each option carries data-arg. data-repick in `extra` is for a choice that
  // acts on every pick (a sheet that closes on it): always chips, and a tap on the option already
  // picked fires its change too.
  U.choice = (name, opts, value, label, extra) => {
    const { cls, rest } = splitClass(extra);
    const len = opts.map(([, t]) => String(t).length);
    const total = len.reduce((a, b) => a + b, 0);
    const short = opts.length >= 2 && opts.length <= 4 && Math.max(...len) <= 10 && total <= (opts.length === 4 ? 22 : 26);
    if (short && !/\sdata-(hscroll|repick)\b/.test(rest)) return U.seg(name, opts, value, label, `${cls ? ` class="${cls.trim()}"` : ''}${/\sdata-size=/.test(rest) ? '' : ' data-size="sm"'} data-block data-choice${rest}`);
    const sel = opts.findIndex(([v]) => String(v) === String(value));
    return `<div class="gh-chipseg${cls}" role="radiogroup" aria-label="${U.esc(label)}" data-rf="chipseg"${rest}${/\sdata-key=/.test(rest) ? '' : ` data-key="choice:${U.esc(name)}"`}>${opts.map(([v, t], i) => `<button type="button" class="rf-chip gh-chip" role="radio" aria-checked="${i === sel}" tabindex="${i === sel || (sel < 0 && i === 0) ? 0 : -1}" value="${U.esc(v)}" data-arg="${U.esc(v)}"><span class="rf-chip-text">${U.esc(t)}</span></button>`).join('')}</div>`;
  };
  // A chip that toggles. The check is always laid out (it fades and scales in), so pressing a chip
  // never changes its width or reflows the row around it.
  U.chip = (label, pressed, attrs) => `<button type="button" class="rf-chip" aria-pressed="${pressed ? 'true' : 'false'}" ${attrs || ''}>${U.icon('check', null, 'rf-chip-check')}<span class="rf-chip-text">${U.esc(label)}</span></button>`;
  // A switch row. Its key comes from what it sets (data-on and data-k, or its id, or its label), so a
  // re-render that adds a row above never hands its node, mid-move, to another switch.
  U.sw = (label, checked, attrs, sub) => {
    const a = attrs || '';
    const at = (n) => { const m = new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(a); return m ? m[1] : ''; };
    const key = `sw:${at('data-on')}:${at('data-k') || at('id') || label}`;
    return `<label class="rf-list-row rf-switch" data-layout="row" data-key="${U.esc(key)}"><span class="rf-list-text"><span class="rf-list-title">${U.esc(label)}</span>${sub ? `<span class="rf-list-sub">${U.esc(sub)}</span>` : ''}</span><span class="rf-switch-track"><input type="checkbox" role="switch"${checked ? ' checked' : ''} ${a}><span class="rf-switch-thumb" aria-hidden="true"></span></span></label>`;
  };
  U.stepper = (id, value, min, max, label, attrs, step) => `<div class="rf-stepper" role="group" aria-label="${U.esc(label)}"><button type="button" class="rf-stepper-btn" data-step="-${step || 1}" aria-label="Less ${U.esc(label.toLowerCase())}">${U.icon('minus')}</button><input class="rf-stepper-value" type="number" inputmode="numeric" id="${U.esc(id)}" value="${U.esc(value)}" min="${min}" max="${max}" step="${step || 1}" aria-label="${U.esc(label)}" ${attrs || ''}><button type="button" class="rf-stepper-btn" data-step="${step || 1}" aria-label="More ${U.esc(label.toLowerCase())}">${U.icon('plus')}</button></div>`;
  U.progress = (v, label, tone) => `<div class="rf-progress" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(Math.min(1, v) * 100)}" aria-valuemin="0" aria-valuemax="100" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}"${tone ? ` data-tone="${tone}"` : ''}><span class="rf-progress-fill"></span></div>`;
  U.ring = (v, label, inner, size, tone) => `<span class="rf-ring" data-size="${size || 'lg'}" style="--rf-value:${Math.max(0, Math.min(1, v)).toFixed(3)}" role="progressbar" aria-label="${U.esc(label)}" aria-valuenow="${Math.round(v * 100)}" aria-valuemin="0" aria-valuemax="100"${tone ? ` data-tone="${tone}"` : ''}><svg viewBox="0 0 72 72"><circle class="rf-ring-track" cx="36" cy="36" r="32" pathLength="100"/><circle class="rf-ring-fill" cx="36" cy="36" r="32" pathLength="100"/></svg><span class="rf-ring-label">${inner || ''}</span></span>`;
  U.row = (o) => {
    const tag = o.act ? 'button' : o.href ? 'a' : 'div';
    const attrs = o.act ? ` type="button" data-act="${U.esc(o.act)}"${o.arg != null ? ` data-arg="${U.esc(o.arg)}"` : ''}` : '';
    return `<li${o.key ? ` data-key="${U.esc(o.key)}"` : ''}><${tag} class="rf-list-row${o.cls ? ' ' + o.cls : ''}"${attrs}>${o.lead ? `<span class="rf-list-lead">${o.lead}</span>` : o.icon ? `<span class="rf-list-icon" data-tone="${o.tone || 'sky'}">${U.icon(o.icon)}</span>` : ''}<span class="rf-list-text"><span class="rf-list-title">${o.title}</span>${o.sub ? `<span class="rf-list-sub">${o.sub}</span>` : ''}</span>${o.detail != null ? `<span class="rf-list-detail">${o.detail}</span>` : ''}${o.chevron ? `<span class="rf-list-chevron">${U.icon('chevron-right')}</span>` : ''}</${tag}></li>`;
  };
  // The Refract mark (the design system the app is built with, credited in Settings, About): drawn by
  // Refract's style sheet, in the ink of the text around it. `once`: its halves come apart once as it
  // shows (it holds still under reduced motion).
  U.refractMark = (size, once) => `<span class="rf-mark"${size ? ` data-size="${size}"` : ''}${once ? ' data-animate="once"' : ''} role="img" aria-label="Refract"></span>`;
  U.navbar = (title, trailing, leading) => `<header class="rf-navbar"><div class="rf-navbar-leading">${leading || ''}</div><h2 class="rf-navbar-title">${U.esc(title)}</h2><div class="rf-navbar-trailing">${trailing || ''}</div></header>`;
  U.glassBtn = (iconName, label, act, extra) => `<button type="button" class="rf-btn rf-glass" data-shape="circle" data-lens aria-label="${U.esc(label)}" data-act="${act}" ${extra || ''}>${U.icon(iconName)}</button>`;
  U.badge = (text, tone, variant) => `<span class="rf-badge" data-variant="${variant || 'soft'}" data-tone="${tone || 'neutral'}">${U.esc(text)}</span>`;
  U.toneWord = { good: ['positive', 'check-circle', 'Good'], watch: ['caution', 'alert', 'Watch'], info: ['accent', 'info', 'Note'], alert: ['critical', 'alert', 'Check'] };

  /* ---------------------------------------------------------------- morph */
  // Nodes Refract (or controls.js) adds inside components. Re-renders leave them where they are.
  const INJECTED = ['rf-lens-layer', 'rf-segmented-thumb', 'rf-segmented-lens', 'rf-tabbar-pill', 'rf-tabbar-lens', 'rf-slider-ticks', 'rf-slider-track', 'rf-slider-fill', 'rf-slider-thumb', 'rf-pagedots-worm', 'rf-glass-bridge', 'rf-burst-layer', 'rf-ghost', 'rf-bead', 'rf-bead-ring', 'rf-ripple', 'gh-chipseg-thumb'];
  // Classes that carry a behavior: an element never turns into or out of one of these in place, it's
  // replaced instead (so no stale listeners or injected parts are left behind).
  const BEHAVIOR = ['rf-segmented', 'rf-switch', 'rf-slider', 'rf-stepper', 'rf-chip', 'rf-glass', 'rf-navbar', 'rf-scroll-edge', 'rf-search', 'rf-pagedots', 'rf-activity', 'rf-tabbar', 'gh-chipseg'];
  const BEHAVIOR_SEL = BEHAVIOR.map((c) => '.' + c).join(',');
  // Attributes behaviors set on our elements. Only matters for nodes the markup didn't create.
  const KEEP_ATTR = /^(data-(gh-flat|ready|lens-ready|lens-idle|scrolled|active|pressed|glow|magnet|dragging|drag-on|over|empty|bump|leaving|traveling|open|expanded|detent|entering|animate|minimized|revealed|hover|merged|tilting|fading|lifted|liquid|ring|scrubbing|rf-.*)|role|tabindex|style|aria-(checked|selected|expanded|controls|describedby|valuetext))$/;
  const owned = new WeakMap(); // element → { attrs, style } the markup set, so only those get removed

  // (A node's own few classes are looked up, rather than asking for each of these in turn: a patch
  // asks this of every node it passes.)
  const INJECTED_SET = new Set(INJECTED);
  const isInjected = (n) => {
    if (n.nodeType !== 1) return false;
    const cl = n.classList;
    for (let i = 0; i < cl.length; i++) if (INJECTED_SET.has(cl[i])) return true;
    return false;
  };
  // Nodes on their way out: a removed card src/ui/motion.js pins where it was while it fades, and the
  // copy of a button pinching off as Refract shape-shifts its row (data-rf-leaving). A patch passes
  // over them as it does Refract's parts.
  const leaving = new WeakSet();
  const passOver = (n) => isInjected(n) || leaving.has(n) || (n.nodeType === 1 && n.hasAttribute('data-rf-leaving'));
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null);
  // A control is also what it sets: a segmented control's first radio name, a switch's (or a chip
  // choice's) data-on and data-k. So a patch never hands one control's node, mid-move, to another
  // that happens to sit where it was, keyed or not.
  const CONTROLS = ['rf-segmented', 'rf-switch', 'gh-chipseg'];
  // The behaviour classes a node has, as one number (a bit each), from its own classes.
  const BEHAVIOR_BIT = new Map(BEHAVIOR.map((c, i) => [c, 1 << i]));
  const CONTROL_BITS = CONTROLS.reduce((m, c) => m | BEHAVIOR_BIT.get(c), 0);
  function sig(n) {
    if (n.nodeType !== 1) return String(n.nodeType);
    let s = n.nodeName;
    if (n.nodeName === 'INPUT') s += ':' + (n.getAttribute('type') || 'text');
    let bits = 0;
    const cl = n.classList;
    for (let i = 0; i < cl.length; i++) bits |= BEHAVIOR_BIT.get(cl[i]) || 0;
    if (bits) s += '.' + bits;
    const control = !!(bits & CONTROL_BITS);
    if (n.hasAttribute('data-lens')) s += '[lens]';
    if (control) {
      const i = n.querySelector('input');
      const on = n.getAttribute('data-on') || (i && i.getAttribute('data-on')) || '';
      s += `@${(i && i.getAttribute('name')) || ''}:${on}:${n.getAttribute('data-k') || (i && i.getAttribute('data-k')) || ''}`;
    }
    return s;
  }
  function styleProps(text) {
    const out = new Map();
    if (!text) return out;
    for (const part of text.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      if (k) out.set(k.startsWith('--') ? k : k.toLowerCase(), part.slice(i + 1).trim());
    }
    return out;
  }
  // (A page's elements have a few dozen kinds of attribute lists between them, so each list's record
  // is made once and shared: a new page records hundreds of elements in the render a route change
  // waits for. Records are never changed, only replaced.)
  const RECORDS = new Map(); // attribute names → { attrs, style: NO_STYLE }
  function record(el) {
    const names = el.getAttributeNames();
    const text = names.includes('style') ? el.getAttribute('style') : '';
    if (text) {
      owned.set(el, { attrs: new Set(names), style: new Set(styleProps(text).keys()) });
    } else {
      const sig = names.join(' ');
      let rec = RECORDS.get(sig);
      if (!rec) { rec = { attrs: new Set(names), style: NO_STYLE }; if (RECORDS.size < 4000) RECORDS.set(sig, rec); }
      owned.set(el, rec);
    }
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) record(c);
  }
  const NO_STYLE = new Set(); // (shared, never changed)
  function morphAttrs(from, to) {
    const rec = owned.get(from);
    const next = new Set();
    const list = to.attributes;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      next.add(a.name);
      if (a.name !== 'style' && from.getAttribute(a.name) !== a.value) {
        // A progress bar that moved: its sheen goes across it once more (src/styles/perf.css).
        if (a.name === 'aria-valuenow' && from.classList.contains('rf-progress')) from.toggleAttribute('data-sheen');
        from.setAttribute(a.name, a.value);
      }
    }
    const had = rec ? rec.attrs : Array.from(from.attributes, (a) => a.name).filter((n) => !KEEP_ATTR.test(n));
    for (const name of had) if (!next.has(name) && name !== 'style') from.removeAttribute(name);
    const text = to.getAttribute('style');
    const want = text ? styleProps(text) : null;
    if (rec) for (const k of rec.style) if (!want || !want.has(k)) from.style.removeProperty(k);
    if (want) for (const [k, v] of want) if (from.style.getPropertyValue(k).trim() !== v) from.style.setProperty(k, v);
    owned.set(from, { attrs: next, style: want && want.size ? new Set(want.keys()) : NO_STYLE });
  }
  // Some parts are positioned from JS (the segmented thumb, the slider fill). When a re-render changes
  // their input, they're asked to re-measure once the patch is done: controls.js's own controls
  // first, Refract's for the rest.
  // (At the next frame's read pass, once the render that changed them is done.)
  const toRefresh = new Set();
  function queueRefresh(el) {
    if (!el) return;
    toRefresh.add(el);
    readSoon('refresh', refreshNow);
  }
  function refreshNow() {
    const r = R();
    for (const x of toRefresh) if (x.isConnected) safe(() => { if (!(U.refreshControl && U.refreshControl(x)) && r && r.refresh) r.refresh(x); });
    toRefresh.clear();
  }
  function morphForm(from, to) {
    if (from.nodeName === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') {
        const c = to.hasAttribute('checked');
        if (from.checked !== c) { from.checked = c; if (c) queueRefresh(from.closest('.rf-segmented')); }
      } else if (from !== doc.activeElement) {
        const v = to.getAttribute('value') || '';
        if (from.value !== v) { from.value = v; if (from.type === 'range') queueRefresh(from.closest('.rf-slider')); }
      }
    } else if (from.nodeName === 'TEXTAREA' && from !== doc.activeElement) {
      const v = to.value;
      if (from.value !== v) from.value = v;
    }
  }
  function rollTo(el, next, prev) {
    const r = R();
    if (r && r.roll && !U.reduced() && el.isConnected) {
      const a = parseFloat(String(prev).replace(/,/g, '')), b = parseFloat(String(next).replace(/,/g, ''));
      try { r.roll(el, next, { from: prev, dir: isFinite(a) && isFinite(b) && b < a ? -1 : 1 }); return; } catch (e) { /* plain text below */ }
    }
    el.textContent = next;
  }
  function morphNode(from, to, fx, lvl) {
    if (from.nodeType !== 1) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
    if (from.hasAttribute('data-roll') && to.hasAttribute('data-roll')) {
      const prev = from.getAttribute('data-roll');
      morphAttrs(from, to);
      if (prev !== to.getAttribute('data-roll')) rollTo(from, to.textContent, prev);
      return;
    }
    morphAttrs(from, to);
    morphForm(from, to);
    if (from.nodeName === 'TEXTAREA' || to.getAttribute('data-morph') === 'keep') return;
    morphChildren(from, to, fx, lvl);
  }
  // What each block was last patched to (its template node), for a page's blocks and what's in them
  // (the first two levels down): a re-render passes over a block whose new template is the same
  // (isEqualNode, which compares a kept still's data URL without copying it), and whose nodes nothing
  // has touched since, without walking it. Plan re-renders all of its long page for a day picked, and
  // walking every node of it took most of that render (25 to 50 ms at 4x CPU). Anything that changes
  // a block's nodes in between (a toggle a tap pressed, a still drawn in, a thumb placed, U.morph
  // patching a part of it) takes it off the list (`touched`, a MutationObserver on what's patched; a
  // patch's own changes are let go), and a block with a form control in it is always walked (what's
  // typed or picked in one isn't in its nodes): a patch puts back all it did before. (So a template
  // kept here stays whole, what a patch adds inside a block is a copy of the template's node.)
  const patchedTo = new WeakMap();
  const SAME_LEVELS = 2;
  const FORMS = 'input, textarea, select';
  const WATCH = { subtree: true, childList: true, attributes: true, characterData: true };
  function untouch(recs) {
    const seen = new Set();
    for (const r of recs) for (let n = r.target; n && !seen.has(n); n = n.parentNode) { seen.add(n); patchedTo.delete(n); }
  }
  const touched = G.MutationObserver ? new G.MutationObserver(untouch) : null;
  function discard(n) {
    if (n.nodeType === 1) {
      const r = R();
      if (r && r.destroy) {
        const list = n.matches(BEHAVIOR_SEL) ? [n] : [];
        for (const el of n.querySelectorAll(BEHAVIOR_SEL)) list.push(el);
        for (const el of list) { try { r.destroy(el); } catch (e) { /* ignore */ } }
      }
    }
    n.remove();
  }
  // Makes `parent`'s children match `source`'s (a node or fragment). `fx` is an animated re-render's
  // motion (U.motion.snap): it was told where everything was before the patch, and hears what the
  // patch did to each container, so new blocks rise in, removed ones leave from where they were and
  // the rest glide to where they land (src/ui/motion.js). Without it, changes are instant.
  function morphChildren(parent, source, fx, lvl) {
    const level = lvl || 0;
    const top = !level && touched;
    // (What changed since the last patch first; then this patch's own changes are let go.)
    if (top) { untouch(touched.takeRecords()); touched.observe(parent, WATCH); }
    const want = Array.from(source.childNodes);
    const keyed = new Map();
    for (let n = parent.firstChild; n; n = n.nextSibling) { if (passOver(n)) continue; const k = keyOf(n); if (k) keyed.set(k, n); }
    let cur = parent.firstChild;
    const added = [];
    let moved = 0;
    for (const t of want) {
      while (cur && passOver(cur)) cur = cur.nextSibling;
      const k = keyOf(t);
      let match = null;
      if (k) {
        match = keyed.get(k) || null;
        if (match && sig(match) !== sig(t)) match = null;
        if (match) keyed.delete(k);
      } else if (cur && !keyOf(cur) && sig(cur) === sig(t)) match = cur;
      if (match) {
        if (match === cur) cur = cur.nextSibling;
        else { parent.insertBefore(match, cur); moved++; }
        if (level < SAME_LEVELS && t.nodeType === 1 && touched) {
          const was = patchedTo.get(match);
          if (was && was !== t && was.isEqualNode(t)) continue;
          morphNode(match, t, fx, level + 1);
          if (t.matches(FORMS) || t.querySelector(FORMS)) patchedTo.delete(match); else patchedTo.set(match, t);
          // (A block's template is kept on its own, not with the rest of the page's.)
          if (!level && t.parentNode) t.parentNode.removeChild(t);
        } else {
          // (Deeper down: a block U.morph patched on its own, inside a part of the page, is walked.)
          patchedTo.delete(match);
          morphNode(match, t, fx, level + 1);
        }
      } else {
        // (Inside a block, a copy of the template's node goes in, so the block's template stays whole.)
        const n = level && touched ? t.cloneNode(true) : t;
        if (n.nodeType === 1) record(n);
        parent.insertBefore(n, cur);
        added.push(n);
      }
    }
    const gone = [];
    while (cur) { const next = cur.nextSibling; if (!passOver(cur)) gone.push(cur); cur = next; }
    if (fx) fx.patched(parent, added, gone, moved);
    else for (const n of gone) discard(n);
    if (top) touched.takeRecords();
  }
  // U.morph(el, html | node, animate): patch el's children in place; `animate` moves what changes
  // (as a re-render of the page does).
  U.morph = (el, html, animate) => {
    let src = html;
    if (src == null || typeof src === 'string') { const tpl = doc.createElement('template'); tpl.innerHTML = src || ''; src = tpl.content; }
    // (The blocks around el no longer hold what they were last patched to: the next re-render walks
    // them, as before.)
    for (let n = el; n; n = n.parentNode) patchedTo.delete(n);
    const fx = animate && U.motion && U.motion.snap ? U.motion.snap(el) : null;
    morphChildren(el, src, fx);
    enhance(el);
    if (fx) fx.play();
    return el;
  };
  // Replace el's children with fresh nodes (a route change). With a kind, the old ones leave while
  // the new ones come in (U.motion.routeSwap); either way the new ones are in el when this returns.
  function replace(el, frag, kind) {
    for (let c = frag.firstElementChild; c; c = c.nextElementSibling) record(c);
    if (U.motion && U.motion.routeSwap) U.motion.routeSwap(el, frag, kind);
    else { for (const c of Array.from(el.childNodes)) discard(c); el.appendChild(frag); }
    enhance(el);
  }
  // What src/ui/motion.js does its part of a patch with: dropping a node the way a patch does
  // (Refract's cleanup runs), the nodes on their way out, and moving nodes Refract already set up
  // (an old page into its exit layer, a copy of a bar button) without it taking them for new ones.
  U.morphKit = {
    discard, leaving, passOver,
    aside(fn) {
      if (rfObserver) initAdded(rfObserver.takeRecords());
      try { return fn(); } finally { if (rfObserver) rfObserver.takeRecords(); }
    },
  };

  /* ---------------------------------------------------------------- layout */
  let root, topbar, screen, floatEl, playerEl, onboardEl, tabbar, accessory, ptrEl;
  const ALL_TABS = { today: ['today', 'home', 'Today'], plan: ['plan', 'calendar', 'Plan'], health: ['health', 'heart', 'Health'], progress: ['progress', 'chart', 'Progress'], you: ['you', 'person', 'You'] };
  // The tabs follow what you track, five at most: a sixth doesn't fit a 360 px phone. You (your
  // profile, badges, plans and Settings) is always last, and the moves are a section of Plan. With
  // workouts off, Plan and Progress go away. Food never takes a tab: it's a section of Health, and
  // its page opens from there (and from Today's card and the food route).
  function tabsFor(S) {
    const workouts = !S || !S.profile || S.profile.workouts !== false;
    return (workouts ? ['today', 'plan', 'health', 'progress', 'you'] : ['today', 'health', 'you']).map((id) => ALL_TABS[id]);
  }
  let TABS = tabsFor(null);
  U.tabList = () => TABS;
  U.hasTab = (id) => TABS.some((t) => t[0] === id);
  const tabsHtml = (cur) => TABS.map(([id, ic, label]) => `<button type="button" class="rf-tab" data-tab="${id}"${id === cur ? ' aria-current="page"' : ''}>${U.icon(ic)}<span class="rf-tab-label">${label}</span></button>`).join('');
  // Call after a change to what's tracked. Returns true if the tabs changed.
  U.refreshTabs = () => {
    const next = tabsFor(U.S);
    if (next.map((t) => t[0]).join() === TABS.map((t) => t[0]).join()) return false;
    TABS = next;
    if (!U.hasTab(U.route.tab)) U.route = { tab: 'today', view: U.route.view, arg: U.route.arg };
    if (tabbar) {
      U.morph(tabbar.querySelector('.rf-tabbar-bar'), tabsHtml(U.route.tab));
      tabbar.style.setProperty('--tab-count', TABS.length);
      if (R() && R().refresh) safe(() => R().refresh(tabbar));
    }
    return true;
  };
  function layout() {
    viewH();
    root = doc.getElementById('app');
    root.innerHTML = `
      <main id="screen" class="screen" tabindex="-1"></main>
      <header id="topbar" class="rf-navbar topbar" data-rf-managed>
        <div class="rf-scroll-edge" aria-hidden="true"></div>
        <div class="rf-navbar-leading"></div><h2 class="rf-navbar-title"></h2><div class="rf-navbar-trailing"></div>
      </header>
      <div id="ptr" class="ptr" aria-hidden="true"><span class="ptr-dot">${U.icon('refresh')}</span></div>
      <div id="float" class="float-actions" hidden></div>
      <nav class="rf-tabbar" data-position="bottom" aria-label="Main" id="tabbar" data-rf-effect="none" style="--tab-count:${TABS.length}">
        <div class="rf-tabbar-accessory rf-glass" data-variant="thick" data-lens id="accessory" hidden></div>
        <div class="rf-tabbar-bar rf-glass" data-lens>${tabsHtml('today')}</div>
      </nav>
      <section id="player" class="player" hidden aria-label="Workout"></section>
      <section id="onboard" class="onboard" hidden aria-label="Set up"></section>`;
    screen = doc.getElementById('screen');
    topbar = doc.getElementById('topbar');
    floatEl = doc.getElementById('float');
    playerEl = doc.getElementById('player');
    onboardEl = doc.getElementById('onboard');
    tabbar = doc.getElementById('tabbar');
    accessory = doc.getElementById('accessory');
    ptrEl = doc.getElementById('ptr');
    // Refract's tab bar emits rf-select (taps and drags; the new page is drawn after the frame that
    // shows the tap, see switchLater); a plain click covers the rest, and a tap on the current tab
    // scrolls it back to the top.
    let selected = 0;
    tabbar.addEventListener('rf-select', (e) => { const t = e.detail && e.detail.tab; if (t && t.dataset.tab) { selected = Date.now(); go(t.dataset.tab, false, true); } });
    tabbar.addEventListener('click', (e) => {
      const t = e.target.closest('.rf-tab');
      if (!t || Date.now() - selected < 400) return;
      go(t.dataset.tab);
    });
    // Dragging the lens along the bar ticks each time it passes onto another tab (Refract marks the
    // tab under the finger with data-hover while it's dragged).
    let hover = null;
    new G.MutationObserver(() => {
      const h = tabbar.querySelector('.rf-tab[data-hover]');
      if (h && hover && h !== hover) U.haptic('tick');
      hover = h;
    }).observe(tabbar.querySelector('.rf-tabbar-bar'), { subtree: true, attributes: true, attributeFilter: ['data-hover'] });
    // Refract sets up both bars in the first frame's read pass, with the first page in: its tab bar
    // measures where its glass goes as it's set up, which laid out the empty page once more.
    readSoon('bars', () => {
      const r = R();
      if (r && r.init) U.morphKit.aside(() => { safe(() => r.init(tabbar, RF_INIT)); safe(() => r.init(topbar, RF_INIT)); });
    });
    // The bar's height feeds the screen's top padding (its observer reports before the first frame
    // is drawn). It's written only when the padding isn't that already (the style sheet's own value,
    // the safe area and 60 px, usually is): a change on the root restyles every element on the page.
    // Its height is also where the large title goes under it (updateScrolled).
    const measure = () => {
      const h = topbar.offsetHeight;
      if (h && parseFloat(G.getComputedStyle(screen).paddingTop) !== h) doc.documentElement.style.setProperty('--topbar-h', h + 'px');
      if (h && h !== barH) { barH = h; if (ioKey) readSoon('scrolled', updateScrolled); }
    };
    if (G.ResizeObserver) new G.ResizeObserver(measure).observe(topbar); else measure();
    screen.addEventListener('scroll', onScroll, { passive: true });
    // (A scroll inside set-up doesn't bubble: it's heard on the way down.)
    onboardEl.addEventListener('scroll', onSetupScroll, { passive: true, capture: true });
    pullToRefresh();
  }
  U.els = () => ({ root, topbar, screen, floatEl, playerEl, onboardEl, tabbar, accessory });

  // The bar's frosted edge and small title appear once the large title slides under it (its last
  // 8 px), or, on a page without one, once the page is scrolled at all (more than 2 px). An
  // IntersectionObserver on the large title (or the page's first block) says when that changes, so
  // scrolling reads nothing from the layout: the title is out while none of it is lower than the
  // bar's edge plus 8 px, and the first block, while it's above where it starts less 2 px (all of it
  // below that line, with no bottom to the line, is the page at its top). The page's scroll position
  // and the title are watched again after each render (the read pass), and when the bar's height
  // changes (barH, from its ResizeObserver).
  let scrolled = null, barH = 0, io = null, ioKey = '', watched = null;
  function updateScrolled() {
    const lt = screen.querySelector(':scope > .rf-large-title');
    // (Without a title: the first block that's laid out in the page's flow.)
    let target = lt;
    for (let c = screen.firstElementChild; c && !target; c = c.nextElementSibling) if (c.getClientRects().length && !/^(absolute|fixed)$/.test(G.getComputedStyle(c).position)) target = c;
    if (!G.IntersectionObserver || !target) { if (io) { io.disconnect(); io = null; ioKey = ''; watched = null; } markScrolled(lt ? lt.offsetTop + lt.offsetHeight - 8 - screen.scrollTop < topbar.offsetHeight : screen.scrollTop > 2); return; }
    // Where the line is in the page's viewport: the bar's edge plus 8 px, or where the first block
    // starts (its place in the page, whatever the scroll) less 2 px.
    const line = lt ? (barH || topbar.offsetHeight) + 8 : target.offsetTop - 2;
    const key = `${lt ? 'title' : 'block'}:${Math.round(line)}`;
    if (key !== ioKey) {
      if (io) io.disconnect();
      io = new G.IntersectionObserver(onCrossed, { root: screen, rootMargin: `${-Math.round(line)}px 0px ${lt ? 0 : 100000}px 0px`, threshold: lt ? 0 : 1 });
      ioKey = key;
      watched = null;
    }
    if (watched === target) return;
    if (watched) io.unobserve(watched);
    watched = target;
    io.observe(target);
  }
  function onCrossed(entries) {
    // The latest for what's watched now (not one from before a route change, on its way out in
    // motion.js's layer).
    let e = null;
    for (const x of entries) if (x.target === watched) e = x;
    if (!e || !screen.contains(e.target)) return;
    markScrolled(ioKey.startsWith('title') ? !e.isIntersecting : e.intersectionRatio < 1);
  }
  // The glow behind the page rises and fades with it (#app[data-page-scrolled], src/styles.css): a
  // timed fade, as nothing may follow the scroll position itself (see there).
  function markScrolled(s) { if (s !== scrolled) { scrolled = s; topbar.toggleAttribute('data-scrolled', s); root.toggleAttribute('data-page-scrolled', s); } }
  // While the page scrolls (#app[data-scrolling]), the glow behind it holds still (src/styles/perf.css),
  // the light holds still, and the bottom glass's bend fades out (below): less to draw every frame of
  // a fling. That's over 150 ms after the last scroll. Set-up's own scroller does the same on its page
  // (.onboard[data-scrolling]).
  let scrollIdle = 0, obIdle = 0;
  function onScroll() {
    if (scrollIdle) clearTimeout(scrollIdle);
    else { root.setAttribute('data-scrolling', ''); steadyLight(true); bend(0); }
    scrollIdle = setTimeout(() => { scrollIdle = 0; root.removeAttribute('data-scrolling'); U.steadyLight(); bend(1); }, 150);
  }
  // The bend of the glass at the bottom (Refract's lens: what's under the tab bar, Today's floating
  // buttons and the workout capsule bent at their edges as through a lens) is redrawn every frame the
  // page moves under it, and it was about half of what made a fling miss frames. So while the page
  // moves it fades out, and once it stops it fades back: the lens's own strength (its displacement's
  // scale) eases to nothing over 160 ms, and only then is the lens taken off the glass
  // ([data-gh-flat], src/styles/perf.css), which looks the same as a lens of no strength; when the
  // page stops, the lens goes back on at no strength and eases up over 280 ms. The frost, the tint and
  // the rim stay as they are throughout. (1.7.0 took the lens off at once, all the glass: that showed,
  // the title going sharp under the bar's buttons, which keep theirs.) Reduced motion: at once.
  // Each change of strength has the glass's filter made again (a few ms of the page's thread, right
  // when the next flick may come): fading out, as a fling starts, it steps down in thirds; fading
  // back in, once the page is still, in sixths.
  const BEND_GLASS = '#tabbar .rf-glass, #float .rf-glass, #accessory.rf-glass';
  let bendNow = 1, bendTo = 1, bendFrom = 1, bendAt = 0, bendMs = 0, bendRaf = 0, bendShown = 1, bendEls = [];
  // The glass to bend, and each one's displacements (with the strength Refract gave them), as they are
  // when a fade starts.
  function bendFind() {
    bendEls = [];
    for (const g of doc.querySelectorAll(BEND_GLASS)) {
      const id = (/url\(#([\w-]+)\)/.exec(g.style.getPropertyValue('--_lens')) || [])[1];
      const filter = id && doc.getElementById(id);
      const fes = filter ? [...filter.querySelectorAll('feDisplacementMap')] : [];
      for (const fe of fes) if (!fe.dataset.ghScale) fe.dataset.ghScale = fe.getAttribute('scale') || '0';
      bendEls.push([g, fes]);
    }
  }
  function bendSet(f) {
    if (f === bendShown) return;
    bendShown = f;
    for (const [g, fes] of bendEls) {
      if (!g.isConnected) continue;
      for (const fe of fes) fe.setAttribute('scale', String(Math.round(Number(fe.dataset.ghScale) * f * 100) / 100));
      g.toggleAttribute('data-gh-flat', f === 0);
    }
  }
  function bendStep(t) {
    bendRaf = 0;
    const k = Math.max(0, Math.min(1, (t - bendAt) / bendMs));
    bendNow = k >= 1 ? bendTo : bendFrom + (bendTo - bendFrom) * k * k * (3 - 2 * k);
    bendSet(bendTo ? (k >= 1 ? 1 : Math.floor(bendNow * 6) / 6) : Math.ceil(bendNow * 3) / 3);
    if (k < 1) bendRaf = G.requestAnimationFrame(bendStep);
  }
  function bend(to) {
    // Only Liquid keeps the lenses while the page moves, fading them. Auto takes the whole glass off
    // for the move instead (below, "glass while the page moves"), and Frosted and Flat have no lenses.
    // (The glass speed test holds the glass as Liquid, whatever the setting: heldAs.)
    if ((heldAs || glassMode) !== 'liquid') {
      if (bendTo !== 1 || bendShown !== 1) { bendTo = 1; bendNow = 1; bendFind(); bendShown = -1; bendSet(1); }
      return;
    }
    if (to === bendTo) return;
    bendTo = to;
    bendFind();
    if (U.reduced() || !G.requestAnimationFrame) { bendShown = -1; bendNow = to; bendSet(to); return; }
    bendShown = bendNow;
    bendFrom = bendNow;
    bendAt = G.performance.now();
    bendMs = to ? 280 : 160;
    if (!bendRaf) bendRaf = G.requestAnimationFrame(bendStep);
  }
  function onSetupScroll() {
    if (obIdle) clearTimeout(obIdle);
    else onboardEl.setAttribute('data-scrolling', '');
    obIdle = setTimeout(() => { obIdle = 0; onboardEl.removeAttribute('data-scrolling'); }, 150);
  }
  // Refract's light: on a phone it holds still at its designed angle (it hears no tilt, see the top of
  // this file). With a mouse the glass rims turn to the pointer, and every step the light takes
  // repaints those rims and redraws their lenses, so it holds still where it is while the page
  // scrolls, while a sheet moves, while the workout player or a live activity is open, with Moving
  // background off and under reduced motion, and follows the pointer again once things are calm.
  let lightFixed = false, touching = 0; // touching: fingers on the screen (below)
  function steadyLight(fixed) {
    const r = R();
    if (fixed === lightFixed || !r || !r.light || !r.light.mode) return;
    lightFixed = fixed;
    // Held at the angle the rims show now, read off the tab bar's glass: with no element, current()
    // is the light's resting angle rather than the tilt's, and every rim would swing round to it.
    const glass = tabbar && tabbar.querySelector('.rf-tabbar-bar');
    safe(() => (fixed ? r.light.mode('fixed', r.light.current(glass || undefined)) : r.light.mode('pointer')));
  }
  U.steadyLight = () => steadyLight(!!(touching || scrollIdle || doc.documentElement.hasAttribute('data-sheet-moving') || doc.documentElement.hasAttribute('data-still-glow') || U.reduced() || (playerEl && !playerEl.hidden) || (U.actLiveShown && U.actLiveShown())));
  // Refract's light also hears every scroll on the page (on the window, as it's captured) and, a frame
  // later, reads where each glass it lights is. In a scroll that's every frame: the page's own thread
  // then makes a frame of its own each time (and hands it to the compositor, which is moving the page
  // meanwhile) only to find the same angles, since a phone's light follows its tilt rather than where
  // the glass is, and the light holds still while the page scrolls anyway. So that listener (it's the
  // light's own refresh) comes off at the first scroll, and the light is refreshed once a scroll has
  // ended instead, wherever it was (the page, a sheet, set-up); with a mouse, the rims turn to the
  // pointer once the page stops rather than as it moves.
  let lightAfter = 0;
  function lightAfterScroll() {
    const r = R();
    if (!r || !r.light || !r.light.refresh) return;
    G.removeEventListener('scroll', r.light.refresh, true);
    clearTimeout(lightAfter);
    lightAfter = setTimeout(() => safe(() => r.light.refresh()), 150);
  }
  if (doc) doc.addEventListener('scroll', lightAfterScroll, { passive: true, capture: true });
  // A finger on the screen holds it still too: a scroll starts with one, and on a phone in a moving
  // hand a step of the light just then repaints every rim as the page begins to move. A tap lets it
  // go again at once; a fling keeps it still until the page stops (scrollIdle).
  if (doc) {
    doc.addEventListener('touchstart', (e) => { touching = e.touches.length; steadyLight(true); }, { passive: true, capture: true });
    const lift = (e) => { touching = e.touches.length; if (!touching) U.steadyLight(); };
    doc.addEventListener('touchend', lift, { passive: true, capture: true });
    doc.addEventListener('touchcancel', lift, { passive: true, capture: true });
  }
  // A sheet's rim and sheen show while it slides and is dragged (src/styles/sheet.css), so the light
  // holds still meanwhile too: a step of it would repaint them every frame of the move.
  if (doc) doc.addEventListener('gh-sheet-moving', () => U.steadyLight());

  /* ---------------------------------------------------------------- glass while the page moves */
  // Glass effects (Settings, Look; prefs.glass), set on the root as data-glass:
  // - Auto (the default): the glass as designed at rest, and what Flat is while the page moves
  //   (:root[data-glass-lite], src/styles/perf.css: no backdrop, no lenses, solid fills, the glow
  //   hidden): from the first few pixels a finger drags it (or a
  //   wheel turns) until half a second after it stops, flings included, and for as long as a finger is
  //   down. A phone's GPU draws every backdrop filter (each glass is one: the tab bar, the buttons, the
  //   bar's frosted edge, the lenses) again every frame the page moves under it, and some can't: the
  //   page then waits for the GPU, which shows as a scroll that doesn't start until the finger lifts or
  //   freezes in a fling and jumps (reported on a phone, where Flat fixed it). Measured here, in
  //   software, the glass is about two thirds of what a scrolling frame costs to draw.
  //   1.8.6 made Liquid the default instead, once the GPU no longer redrew the glass for nothing at rest
  //   (the light holds still, the glow rests while the app is in use: above and below), and on the
  //   phone it still stuttered while the page moved, where Auto hadn't: what the phone can't keep up
  //   with is the glass drawn again every frame of the move itself. So Auto is the default again.
  // - Liquid: the glass as designed, always. Frosted: the blur without the lenses (perf.css). Flat: no
  //   backdrop drawn anywhere and the glow hidden (Refract's reduced transparency hides it).
  // The glass goes at the first drag, not at the first touch (a tap would flash it), and a scroll the
  // page makes by itself (a tab's scroll position coming back) never counts: only one that follows a
  // drag or a wheel closely (a fling's scrolls come a frame apart).
  const GLASS_REST_MS = 500, GLASS_DRAG_PX = 4, GLASS_FLING_MS = 600;
  let glassMode = 'auto', glassMoving = false, glassHeld = false, heldAs = null, glassTimer = 0, glassLastMove = 0, dragStart = null;
  function glassApply() {
    if (glassHeld) return;
    const html = doc.documentElement;
    if (html.getAttribute('data-glass') !== glassMode) html.setAttribute('data-glass', glassMode);
    // Flat is Refract's reduced transparency (which hides the glow too); Frosted is its own look (perf.css).
    if (glassMode === 'flat') { if (html.getAttribute('data-rf-transparency') !== 'reduced') html.setAttribute('data-rf-transparency', 'reduced'); }
    else if (html.hasAttribute('data-rf-transparency')) html.removeAttribute('data-rf-transparency');
    const lite = glassMode === 'flat' || (glassMode === 'auto' && glassMoving);
    if (html.hasAttribute('data-glass-lite') !== lite) html.toggleAttribute('data-glass-lite', lite);
  }
  function setGlassMode(v) {
    glassMode = v === 'liquid' || v === 'frosted' || v === 'flat' ? v : 'auto';
    glassMoving = false;
    clearTimeout(glassTimer); glassTimer = 0;
    glassApply();
    bend(1); // the lenses back at full strength where they were fading
  }
  // One timer, looked at when it fires, rather than one set per touchmove or scroll event.
  function glassRest() {
    glassTimer = 0;
    const left = glassLastMove + GLASS_REST_MS - Date.now();
    if (touching || left > 0) { glassTimer = setTimeout(glassRest, touching ? GLASS_REST_MS : left); return; }
    glassMoving = false;
    glassApply();
  }
  function glassMove() {
    if (glassMode !== 'auto' || glassHeld) return;
    const t = Date.now();
    glassLastMove = t;
    if (!glassMoving) { glassMoving = true; glassApply(); }
    if (!glassTimer) glassTimer = setTimeout(glassRest, GLASS_REST_MS);
  }
  if (doc) {
    const pageOf = (t) => (t && t.closest ? t.closest('#screen, .ob-scroll') : null);
    const inPage = (t) => !!pageOf(t);
    doc.addEventListener('touchstart', (e) => {
      const sc = e.touches.length === 1 ? pageOf(e.target) : null;
      dragStart = sc ? { x: e.touches[0].clientX, y: e.touches[0].clientY, sc } : null;
    }, { passive: true, capture: true });
    doc.addEventListener('touchmove', (e) => {
      if (glassMode !== 'auto' || !dragStart) return;
      if (glassMoving) { glassMove(); return; }
      const t = e.touches[0], dy = Math.abs(t.clientY - dragStart.y), dx = Math.abs(t.clientX - dragStart.x);
      // A vertical drag on a page that can scroll (a short page doesn't move, and nothing needs to go).
      if (dy >= GLASS_DRAG_PX && dy > dx && dragStart.sc.scrollHeight > dragStart.sc.clientHeight + 2) glassMove();
    }, { passive: true, capture: true });
    // Lifting the finger starts the half second (a fling's scroll events carry it on from there).
    const lifted = () => { if (glassMoving) glassLastMove = Date.now(); };
    doc.addEventListener('touchend', lifted, { passive: true, capture: true });
    doc.addEventListener('touchcancel', lifted, { passive: true, capture: true });
    doc.addEventListener('wheel', (e) => { if (glassMode === 'auto' && inPage(e.target)) glassMove(); }, { passive: true, capture: true });
    doc.addEventListener('scroll', (e) => {
      if (glassMode !== 'auto') return;
      const t = e.target;
      // A fling's scrolls follow one another a frame apart, from the finger's lift: one that comes a
      // good while after the last move, with no finger down, is the page's own.
      if ((t === screen || (t && t.classList && t.classList.contains('ob-scroll'))) && (touching || Date.now() - glassLastMove < GLASS_FLING_MS)) glassMove();
    }, { passive: true, capture: true });
  }
  // The glass speed test (src/ui/diag.js) sets the root's attributes itself, one look after another:
  // held, nothing here touches them; let go, they're worked out again from the setting. `as`: the
  // mode the glass behaves as meanwhile (the test's is Liquid, so the bottom glass bends as Liquid's
  // does while the page moves, whatever the setting).
  U.glassHold = (on, as) => {
    glassHeld = !!on;
    heldAs = on && as ? as : null;
    // (The root says which look it's held as: the bar's edge has its frost only in Liquid's and
    // Frosted's, src/styles/perf.css.)
    if (heldAs) doc.documentElement.setAttribute('data-glass', heldAs);
    if (!on) { glassMoving = false; clearTimeout(glassTimer); glassTimer = 0; glassApply(); bend(1); }
  };
  U.glassState = () => ({ mode: glassMode, moving: glassMoving, lite: !!doc.documentElement.hasAttribute('data-glass-lite') });

  /* ---------------------------------------------------------------- calm */
  // When someone last touched, typed, scrolled (anywhere: a sheet, set-up) or turned a wheel.
  // - U.calm(): nothing's happening: the page isn't scrolling, no input for 400 ms, no sheet moving
  //   and no switch, segmented control or chip choice held or still gliding (src/ui/controls.js).
  //   Heavy work that can wait (the 3D figure's warm-up and stills, Plan's tiles, background
  //   re-renders) waits for it, so it never lands in the middle of a fling, a drag or a knob's glide.
  // - U.whenCalm(fn): runs fn now if it's calm, or as soon as it is (never dropped).
  // - #app[data-in-use]: any input in the last 3 s (and the first 3 s after launch). The background
  //   glow holds still meanwhile (src/styles/perf.css): each step of its drift has every glass in
  //   front of it filtered again, and a flick that lands on one starts on a busy GPU. Someone using
  //   the app touches it again within a few seconds, so it drifts once they've stopped, and holds
  //   still at the first touch.
  // - #app[data-idle]: 20 s without any input. The glow stops drifting again (src/styles/perf.css),
  //   so a phone left on a page isn't drawing it every frame; the next input starts the clock again.
  // - U.quiet(): calm, and nothing for 1.5 s. Heavy work that would hold the page for a while (a 3D
  //   still, the 3D chunk and its warm-up, a background re-render, the 3D canvas shrinking) waits for
  //   this rather than calm: on a phone a touch's scroll waits for the page's thread, and the likeliest
  //   moment for the next flick is right after the last one settles (filmed: three flicks in a row
  //   froze for 100 to 330 ms each, a still or a re-render running under the finger). A finger on the
  //   screen is never calm or quiet, however still it holds.
  // - U.whenQuiet(fn): runs fn now if it's quiet, or as soon as it is (never dropped).
  const CALM_MS = 400, QUIET_MS = 1500, IDLE_MS = 20000, IN_USE_MS = 3000;
  let lastInput = 0, idleTimer = 0, calmTimer = 0, quietTimer = 0, inUseUntil = 0, inUseTimer = 0;
  const calmQueue = [], quietQueue = [];
  function onInput() {
    lastInput = Date.now();
    if (root && root.hasAttribute('data-idle')) root.removeAttribute('data-idle');
    if (!idleTimer) idleTimer = setTimeout(checkIdle, IDLE_MS);
    markInUse(lastInput);
  }
  // One timer, looked at when it fires, rather than one set per input event.
  function markInUse(now) {
    inUseUntil = now + IN_USE_MS;
    if (root && !root.hasAttribute('data-in-use')) root.setAttribute('data-in-use', '');
    if (!inUseTimer) inUseTimer = setTimeout(checkInUse, IN_USE_MS);
  }
  function checkInUse() {
    inUseTimer = 0;
    const left = inUseUntil - Date.now();
    if (left > 0) inUseTimer = setTimeout(checkInUse, left);
    else if (root) root.removeAttribute('data-in-use');
  }
  function checkIdle() {
    idleTimer = 0;
    const left = lastInput + IDLE_MS - Date.now();
    if (left > 0) idleTimer = setTimeout(checkIdle, left);
    else if (root) root.setAttribute('data-idle', '');
  }
  if (doc) for (const ev of ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'keydown', 'wheel', 'scroll']) doc.addEventListener(ev, onInput, { passive: true, capture: true });
  U.calm = () => !touching && !scrollIdle && Date.now() - lastInput >= CALM_MS && !doc.documentElement.hasAttribute('data-sheet-moving') && !(U.controlsMoving && U.controlsMoving());
  U.quiet = () => U.calm() && Date.now() - lastInput >= QUIET_MS;
  function calmCheck() {
    calmTimer = 0;
    if (!U.calm()) { calmTimer = setTimeout(calmCheck, Math.max(60, lastInput + CALM_MS - Date.now())); return; }
    for (const fn of calmQueue.splice(0)) safe(fn);
  }
  U.whenCalm = (fn) => {
    if (!calmQueue.length && U.calm()) { safe(fn); return; }
    calmQueue.push(fn);
    if (!calmTimer) calmTimer = setTimeout(calmCheck, Math.max(60, lastInput + CALM_MS - Date.now()));
  };
  function quietCheck() {
    quietTimer = 0;
    if (!U.quiet()) { quietTimer = setTimeout(quietCheck, Math.max(60, lastInput + QUIET_MS - Date.now())); return; }
    for (const fn of quietQueue.splice(0)) safe(fn);
  }
  U.whenQuiet = (fn) => {
    if (!quietQueue.length && U.quiet()) { safe(fn); return; }
    quietQueue.push(fn);
    if (!quietTimer) quietTimer = setTimeout(quietCheck, Math.max(60, lastInput + QUIET_MS - Date.now()));
  };

  // The bar's buttons are keyed by what they are, so a route change keeps the node of one both routes
  // have and Refract can shape-shift them (U.motion.barSwap): the button at the top left is one piece
  // of glass whatever it does there (the coach on a tab, Back on a page), each on the right its own.
  function barKeys(parent, lead) {
    let i = 0;
    for (const c of parent.children) {
      if (!c.matches('button, a') || c.hasAttribute('data-rf-key')) continue;
      const k = lead ? `lead${i++ || ''}` : c.getAttribute('data-act') || c.getAttribute('popovertarget') || c.getAttribute('aria-label') || `b${i++}`;
      c.setAttribute('data-rf-key', k);
      if (!c.hasAttribute('data-key')) c.setAttribute('data-key', `bar:${k}`);
    }
    return parent;
  }
  function applyNavbar(nb) {
    const part = (sel) => (nb ? nb.querySelector(sel) : null);
    const lead = part('.rf-navbar-leading'), title = part('.rf-navbar-title'), trail = part('.rf-navbar-trailing');
    const nodes = (html) => { const t = doc.createElement('template'); t.innerHTML = html; return t.content; };
    // Every tab's top left is the coach (a page opened on top has its Back button there instead).
    const leading = lead && lead.innerHTML.trim() ? lead : nodes(!U.route.view && U.coachBtn ? U.coachBtn() : '');
    U.morph(topbar.querySelector('.rf-navbar-leading'), barKeys(leading, true));
    U.morph(topbar.querySelector('.rf-navbar-trailing'), barKeys(trail || nodes(''), false));
    const t = topbar.querySelector('.rf-navbar-title');
    const text = title ? title.textContent : '';
    if (t.textContent !== text) t.textContent = text;
  }

  /* ---------------------------------------------------------------- motion */
  U.reduced = () => !!(P() && P().reducedMotion());
  const EASE_ENTER = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
  // Cards and titles rise into place one after another (first paint, after set-up, after a workout),
  // all of them in about 600 ms (1.9.0's took 850).
  function stagger(el) {
    if (U.reduced() || !el.animate) return;
    const items = [];
    for (const n of el.querySelectorAll(':scope > .rf-large-title, :scope > .lt-sub, :scope > .section > *, :scope > .sec-title')) {
      items.push(n);
      if (items.length >= 9) break;
    }
    items.forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 20 + i * 28, easing: EASE_ENTER, fill: 'backwards' }));
  }
  U.stagger = stagger;
  // A page drawn again with a motion of its own (the same page opened again, the first paint after
  // a workout): it comes in from the side, or its cards rise. A route change's motion is
  // U.motion.routeSwap's (src/ui/motion.js).
  function routeIn(kind) {
    if (U.reduced() || !screen.animate || !kind) return;
    if (kind === 'stagger') { stagger(screen); return; }
    const x = { push: 36, pop: -36, right: 18, left: -18 }[kind] || 0;
    screen.animate([{ opacity: 0, transform: `translateX(${x}px)` }, { opacity: 1, transform: 'none' }], { duration: kind === 'push' || kind === 'pop' ? 260 : 220, easing: EASE_ENTER });
  }
  // A floating button's place in the row ('side' or 'main'), as attributes: a re-render keeps its node
  // (data-key) and Refract follows it as it changes (data-rf-key), so a new label or time flows the
  // button to its new width instead of the row jumping.
  U.floatKey = (k) => ` data-key="float-${k}" data-rf-key="${k}"`;
  // The floating buttons form over the tab bar, each its own piece of glass growing up out of it
  // (U.motion.glassIn: Refract's materialize), one after the other. In the frame's read pass: it
  // measures them.
  function floatIn() {
    if (U.motion && U.motion.glassIn) U.motion.glassIn(floatEl);
  }

  /* ---------------------------------------------------------------- reading the layout back */
  // A render only writes. What it then reads back from the layout (whether the floating buttons fit,
  // the bar's frosted edge, where the tab bar's glass goes, a control's thumb) and the page's scroll
  // position (which needs the layout too) wait for the next frame, and are done there in one pass
  // after every write is in. Done mid-render, each read laid the page out again: a tab change paid
  // for three or four layouts where its frame needs one. Core's own reads go first, in a fixed order
  // (the scroll, then what depends on it); U.readSoon(fn) adds others (src/ui/controls.js), and
  // U.readNow() does the pass at once. A hidden page draws no frames, so a timer stands in.
  const READ_FIRST = ['bars', 'scroll', 'float', 'scrolled'], READ_LAST = ['refresh', 'tabbar', 'accessory'];
  const reads = new Map(); // one of those → fn
  const readsAfter = []; // U.readSoon's, between the two
  let readFrame = 0, readTimer = 0, pendingScroll = null;
  function readNow() {
    if (readFrame && G.cancelAnimationFrame) G.cancelAnimationFrame(readFrame);
    if (readTimer) clearTimeout(readTimer);
    readFrame = readTimer = 0;
    // Refract setting up the launch's page (enhance) goes before the rest, which then includes what
    // that asked for (a control placing its thumb).
    const init = reads.get('init');
    if (init) { reads.delete('init'); safe(init); }
    // (One that asks for another pass while this one runs gets it at the next frame.)
    const pick = (keys) => keys.filter((k) => reads.has(k)).map((k) => reads.get(k));
    const list = pick(READ_FIRST).concat(readsAfter.splice(0), pick(READ_LAST));
    reads.clear();
    for (const fn of list) safe(fn);
  }
  function readSoon(key, fn) {
    if (key) reads.set(key, fn); else readsAfter.push(fn);
    if (readFrame || readTimer) return;
    if (G.requestAnimationFrame) readFrame = G.requestAnimationFrame(readNow);
    readTimer = setTimeout(readNow, 100);
  }
  U.readSoon = (fn) => readSoon(null, fn);
  U.readNow = readNow;
  // The page's scroll position, as the next pass sets it (a route change), or as it is.
  const scrollNow = () => (pendingScroll != null ? pendingScroll : screen.scrollTop);
  function applyScroll() {
    if (pendingScroll == null) return;
    const top = pendingScroll;
    pendingScroll = null;
    reads.delete('scroll');
    screen.scrollTop = top;
  }
  function scrollSoon(top) {
    pendingScroll = top;
    readSoon('scroll', applyScroll);
  }

  /* ---------------------------------------------------------------- rendering */
  const cleanups = [];
  U.onCleanup = (fn) => cleanups.push(fn);
  function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* ignore */ } } }
  let lastKey = null;
  let nextMotion = null;
  const scrollMemo = {};
  const scrolledMemo = {}; // the bar's frosted edge as each tab was left (with its scroll)
  // Long pages lay out and draw a block out of sight only as it comes near (content-visibility: auto,
  // src/styles/perf.css), and until then it's as tall as a guess. A tab opened again where it was
  // left gets the heights its blocks had then (--cv-h), so it opens on exactly what was showing.
  const CV_BLOCKS = ':scope > .section, :scope > .section > .rf-list';
  const cvMemo = {};
  const cvHeights = () => Array.from(screen.querySelectorAll(CV_BLOCKS), (n) => n.offsetHeight);
  function cvRestore(key) {
    const h = cvMemo[key];
    if (!h) return;
    Array.from(screen.querySelectorAll(CV_BLOCKS)).forEach((n, i) => { if (h[i]) n.style.setProperty('--cv-h', `${h[i]}px`); });
  }
  // A tab tapped: the frame that brings its page in draws only what's in sight and about a screenful
  // more. The blocks after that are on the page, but not drawn ([data-gh-later], display: none,
  // src/styles/perf.css) until the frame after: styling, laying out and drawing a whole long page
  // (Health, Progress) in that first frame held it back 100 to 200 ms at 4x CPU, for blocks no one
  // sees until they scroll. Where the cut goes: from where each block of the page ended when it was
  // last left (blockEnds, kept for each tab), a screen and a quarter below where it opens; a page
  // not seen yet, or whose blocks have changed, opening at its top, by how much is in each block
  // (about what a screen of this app's blocks holds). Anything that re-renders the page draws them
  // at once (revealLater).
  // The viewport's height, read at launch and on each resize: asked for in the middle of a render,
  // innerHeight brings the page's style and layout up to date first. (src/ui/motion.js uses it too.)
  let viewHeight = 0;
  const viewH = () => viewHeight || (viewHeight = G.innerHeight || 800);
  U.viewH = viewH;
  if (G.addEventListener) G.addEventListener('resize', () => { viewHeight = G.innerHeight || 0; });
  const LATER = 'data-gh-later';
  const LATER_EVERY = 400; // elements: a page never seen keeps about this many drawn
  const blockMemo = {};
  let laterKey = null; // the page with blocks still to draw
  let drawFirst = false; // the next route change draws what's in sight first (switchLater)
  const blockEnds = () => Array.from(screen.children, (n) => n.offsetTop + n.offsetHeight);
  function holdBack(frag, key, top) {
    const kids = Array.from(frag.children);
    if (kids.length < 4) return;
    let cut = kids.length;
    const ends = blockMemo[key];
    if (ends && ends.length === kids.length) {
      const limit = top + 1.25 * viewH();
      cut = 1;
      while (cut < kids.length && ends[cut - 1] < limit) cut++;
    } else if (!top) {
      let n = 0;
      cut = 0;
      while (cut < kids.length && (cut < 3 || n < LATER_EVERY)) n += kids[cut++].getElementsByTagName('*').length + 1;
    }
    for (let i = Math.max(3, cut); i < kids.length; i++) kids[i].setAttribute(LATER, '');
    if (cut < kids.length) laterKey = key;
  }
  function revealLater() {
    if (!laterKey) return;
    laterKey = null;
    for (const n of screen.querySelectorAll(`:scope > [${LATER}]`)) n.removeAttribute(LATER);
  }
  let floatEnter = false; // the floating buttons rise in at the next read pass
  // From a tap, they form a frame after the page comes in: their glass forming (Refract's
  // materialize, 20 to 45 ms of script at 4x CPU) ran in that frame. Meanwhile the row is out of sight
  // ([data-forming], src/styles/perf.css), so it never shows before it forms.
  let floatLater = false;
  // A switch's change re-renders the page it's on (a setting that shows or hides rows, a sub-line that
  // changes) while its knob is still gliding to the other end. The glide is drawn from the main
  // thread, so a 30 to 60 ms render (a phone's) held up its frames and the knob jumped the rest of the
  // way. A re-render of the same page asked for then waits until the knob has landed (at most
  // HOLD_MS); a route change never waits.
  const HOLD_MS = 1200;
  const holds = new Set();
  let renderLater = false;
  function holdRenders(input) {
    const p = U.controlSettled ? U.controlSettled(input) : null;
    if (!p) return;
    const h = {};
    holds.add(h);
    const done = () => {
      if (!holds.delete(h) || holds.size || !renderLater) return;
      renderLater = false;
      render();
    };
    p.then(done);
    setTimeout(done, HOLD_MS);
  }
  function render(motion) {
    if (!U.S || !U.S.profile.onboarded) { U.showOnboarding(); return; }
    if (holds.size && !motion) {
      const r0 = U.route;
      if ((r0.view ? `${r0.view}:${r0.arg || ''}` : r0.tab) === lastKey) { renderLater = true; return; }
    }
    renderLater = false;
    if (!onboardEl.hidden) onboardEl.hidden = true;
    U.refreshTabs();
    // Food: the burn estimate learns from the logs once a day (cheap after the first call).
    if (GH.food && GH.food.refreshBurn) safe(() => GH.food.refreshBurn(U.S, U.today()));
    const r = U.route;
    const key = r.view ? `${r.view}:${r.arg || ''}` : r.tab;
    const changed = key !== lastKey;
    const first = drawFirst;
    drawFirst = false;
    // A page re-rendered before its last blocks were drawn: they're drawn now, so the patch finds it
    // whole. (A page that leaves goes as it is.)
    const partial = !!laterKey && laterKey === lastKey;
    if (partial && !changed) revealLater();
    laterKey = null;
    // On a route change, whether the floating buttons show, read before anything changes (asked once
    // they go, it would bring the new page's style up to date): only then does a copy fade.
    const floatSeen = changed && !floatEl.hidden ? !floatEl.checkVisibility || floatEl.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : undefined;
    // Two route changes before a frame: the first one's scroll is set now, so the page leaving
    // starts from where it is.
    if (changed) applyScroll();
    if (changed && lastKey && !lastKey.includes(':')) {
      scrollMemo[lastKey] = screen.scrollTop; scrolledMemo[lastKey] = !!scrolled; cvMemo[lastKey] = scrollMemo[lastKey] ? cvHeights() : null;
      if (!partial) blockMemo[lastKey] = blockEnds();
    }
    const M = U.motion || {};
    const kind = changed ? motion || nextMotion : motion;
    // A re-render of the same page: where everything is, measured before the patch changes it, so
    // whatever it moves glides there instead of jumping (src/ui/motion.js).
    const fx = !changed && !motion && M.snap ? safe(() => M.snap(screen)) || null : null;
    runCleanups();
    const scr = U.screens[r.view || r.tab] || U.screens.today;
    const day = U.today();
    let html = '';
    try { html = scr.render(U.S, day, r.arg); } catch (e) { html = errorBox(e); }
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    const nb = tpl.content.querySelector('header.rf-navbar');
    if (nb) nb.remove();
    // The bar's title cross-fades along with the page, and its buttons shape-shift.
    const bar = changed && lastKey && kind && M.barSwap ? safe(() => M.barSwap(topbar, kind)) || null : null;
    if (bar && bar.update) bar.update(() => applyNavbar(nb)); else applyNavbar(nb);
    // A new page: the old one leaves, with the look it had, while this one comes in. From a tap on the
    // tab bar, what's well out of sight is drawn a frame later (holdBack), and so it is on a page
    // opened on top, which opens at its top and slides in on the compositor meanwhile: How it works,
    // Food, Badges (styling, laying out and drawing the whole of a long one was most of the tap's
    // frame). Not on one opened at a row it then brings into view (focus), nor where the page's after
    // hook may measure what it drew (a map, a list to drag in), unless the screen says it can wait
    // (later: true).
    if (changed && first && !r.view) holdBack(tpl.content, key, scrollMemo[key] || 0);
    else if (changed && kind === 'push' && !(r.arg && scr.focus) && (!scr.after || scr.later)) holdBack(tpl.content, key, 0);
    if (changed) replace(screen, tpl.content, kind);
    if (laterKey) rightAfterFrame(() => { if (laterKey === key && lastKey === key) revealLater(); });
    screen.dataset.view = r.view || r.tab;
    screen.toggleAttribute('data-pushed', !!r.view);
    if (!changed) { morphChildren(screen, tpl.content, fx); enhance(screen); }
    const fl = scr.float ? safe(() => scr.float(U.S, day, r.arg)) : '';
    const wasHidden = floatEl.hidden;
    // Floating buttons that go (Today's, on the way to another page) dissolve where they were, sinking
    // back into the tab bar (a copy of them: the row itself hides at once), gone with the old page on
    // a route change.
    if (!wasHidden && !fl && M.glassOut) safe(() => M.glassOut(floatEl, { seen: floatSeen, ms: changed ? 280 : 340 }));
    // Buttons that stay shape-shift: a new label or time flows a button to its new width.
    if (!wasHidden && fl && !changed && M.shift) M.shift(floatEl, () => U.morph(floatEl, fl));
    else U.morph(floatEl, fl || '');
    floatEl.hidden = !fl;
    screen.toggleAttribute('data-float', !!fl);
    // Whether they fit is read at the next frame, and then they form (measured before they move).
    if (fl && (wasHidden || changed)) { floatEnter = true; floatLater = first; floatEl.toggleAttribute('data-forming', first); }
    readSoon('float', floatPass);
    if (scr.after) safe(() => scr.after(screen, U.S, day, r.arg, changed));
    if (changed) {
      const top = r.view ? 0 : scrollMemo[key] || 0;
      if (top) cvRestore(key);
      scrollSoon(top);
      // The bar's frosted edge for where the page will be: off at its top (the screen is padded by
      // the bar's height, so a large title there is all below it), else as it was when the page was
      // left there. The read pass checks it against the layout; the bar's cross-fade needs it now.
      markScrolled(pendingScroll ? !!scrolledMemo[key] : false);
      nextMotion = null;
      if (kind === 'stagger') routeIn(kind);
      if (r.view && r.arg && scr.focus) { applyScroll(); safe(() => scr.focus(screen, r.arg)); }
    } else if (motion) routeIn(motion);
    if (fx) safe(() => fx.play());
    lastKey = key;
    readSoon('scrolled', updateScrolled);
    if (bar) safe(() => bar(kind));
    tabbar.toggleAttribute('data-away', !!r.view);
    // The current tab is marked in the frame's read pass, after this render's writes: Refract's tab
    // bar measures where its glass goes as soon as it sees the change, which mid-render laid the
    // page out once more. Only a real change: it moves its glass on every one it hears of.
    readSoon('tabbar', () => {
      for (const t of tabbar.querySelectorAll('.rf-tab')) {
        if (t.dataset.tab === U.route.tab) { if (t.getAttribute('aria-current') !== 'page') t.setAttribute('aria-current', 'page'); } else if (t.hasAttribute('aria-current')) t.removeAttribute('aria-current');
      }
    });
    renderAccessory();
  }
  U.render = render;
  function floatPass() {
    fitFloat();
    if (floatEnter && floatLater) {
      floatEnter = floatLater = false;
      rightAfterFrame(() => { if (!floatEl.hasAttribute('data-forming')) return; floatEl.removeAttribute('data-forming'); if (!floatEl.hidden) floatIn(); });
      return;
    }
    if (floatEnter && !floatEl.hidden) floatIn();
    floatEnter = false;
  }
  // The floating buttons share one row. When they don't fit (a narrow phone, large text), the
  // secondary ones drop their words and keep their icon (their aria-label still says what they do).
  // Their laid-out boxes, not what's drawn: a button still swollen from the finger that pressed it
  // (Refract's glass grows a little while held) reached past the row on screen, and a tap on Short on
  // time read as a row that didn't fit, so the button lost its words. Parts on their way out don't
  // count.
  function fitFloat() {
    if (floatEl.hidden) return;
    floatEl.classList.remove('is-tight');
    const w = floatEl.clientWidth;
    const over = [...floatEl.children].some((c) => !c.hasAttribute('data-rf-leaving') && (c.offsetLeft < -1 || c.offsetLeft + c.offsetWidth > w + 1));
    if (over) floatEl.classList.add('is-tight');
  }
  if (G.addEventListener) G.addEventListener('resize', () => { if (floatEl) fitFloat(); });
  // The next route change plays this entrance (e.g. 'stagger' after set-up).
  U.nextMotion = (kind) => { nextMotion = kind; };
  function safe(fn) { try { return fn(); } catch (e) { if (G.console) G.console.error(e); return ''; } }
  function errorBox(e) {
    if (G.console) G.console.error(e);
    return `<div class="section"><div class="card"><p class="t-headline">Couldn't show this screen.</p><p class="t-footnote rf-muted">${U.esc(e && e.message)}</p><button class="rf-btn" data-act="goToday">Back to Today</button></div></div>`;
  }
  /* Refract's init() wires up its controls (switches, segments, steppers, chips, glass and lenses,
   * icons) in an element, looking through it once for each kind. A patch only needs that for the
   * nodes it inserted, so instead of Refract's own observer (which looked through every inserted
   * node again, after the whole screen had been looked through) one observer here collects the
   * inserted nodes. enhance() initializes the ones a patch just inserted, and only those that carry
   * something Refract handles; nodes inserted any other way (sheets, dialogs, toasts, a part added
   * by hand) are initialized when the observer reports them, as before. */
  // Refract 1.4 refracts every regular and clear glass surface unless told otherwise: here only those
  // the markup marks data-lens do (as before 1.4), since each lens is redrawn every frame the page
  // moves under it.
  // Its light is registered on every glass it sets up, and each time a page brings new glass the
  // light reads where every glass on screen is and starts a paused animation for each rim (a tab
  // change spent about 75 ms of a 4x-slowed CPU there, in the frames after it). All that is for a
  // mouse: with no pointer to follow (a phone's light holds still, see steadyLight), every rim gets
  // the light's resting angle, which is what an unregistered rim shows anyway (--rf-light's initial
  // value, 315deg). So only a screen with a fine pointer that hovers registers its glass.
  const RF_INIT = { lens: false, light: !!(G.matchMedia && G.matchMedia('(hover: hover) and (pointer: fine)').matches) };
  // What init() handles: the `auto` list in vendor/refract/bundle.js, plus glass, data-rf
  // behaviours and icon placeholders.
  const RF_SEL = '.rf-glass, [data-rf], [data-icon]:not(svg), .rf-switch, .rf-slider, .rf-stepper, .rf-search, .rf-chip, .rf-playpause, .rf-tabbar, .rf-segmented, .rf-pagedots, .rf-navbar, .rf-scroll-edge[data-watch], .rf-sidebar, .rf-toolbar, .rf-menu[popover], .rf-popover[popover], .rf-menu[id], .rf-popover[id], dialog.rf-dialog, .rf-sheet, .rf-activity, [data-rf-tooltip], [data-reveal], .rf-loupe, .rf-droplets, [data-rf-morph], [data-rf-tone], [data-rf-adapt]';
  let rfObserver = null;
  function initAdded(records) {
    const r = R();
    if (!r || !r.init || !records.length) return;
    const done = new Set();
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n.nodeType !== 1 || !n.isConnected || !(n.matches(RF_SEL) || n.querySelector(RF_SEL))) continue;
        let inDone = false;
        for (let p = n.parentElement; p && !inDone; p = p.parentElement) inDone = done.has(p);
        if (inDone) continue; // inside a node initialized just now
        done.add(n);
        safe(() => r.init(n, RF_INIT));
      }
    }
  }
  // At launch (the first render, U.firstFrame) what's inserted is set up at the start of the first
  // frame's read pass instead (still before that frame's layout and paint): Refract then queues its
  // own first work for each part (a glass's lens map, drawn pixel by pixel in JavaScript; its light)
  // into the frame after, and the first paint comes that much sooner.
  let launchRecords = null;
  function enhance(el) {
    const r = R();
    if (!r || !r.init) return;
    if (rfObserver && U.firstFrame) {
      (launchRecords || (launchRecords = [])).push(...rfObserver.takeRecords());
      readSoon('init', () => { const recs = launchRecords || []; launchRecords = null; initAdded(recs); });
      return;
    }
    if (rfObserver) initAdded(rfObserver.takeRecords());
    else safe(() => r.init(el, RF_INIT)); // before boot() starts the observer
  }
  // For other code: el is looked through as a whole when nothing was inserted in it since the last
  // pass (it was changed some other way).
  U.enhance = (el) => {
    const recs = rfObserver ? rfObserver.takeRecords() : [];
    initAdded(recs);
    const touched = recs.some((x) => el.contains(x.target) || Array.prototype.includes.call(x.addedNodes, el));
    if (!touched) { const r = R(); if (r && r.init) safe(() => r.init(el, RF_INIT)); }
  };
  function observeInserts() {
    if (!G.MutationObserver || rfObserver) return;
    rfObserver = new G.MutationObserver(initAdded);
    rfObserver.observe(doc.body, { childList: true, subtree: true });
  }

  const tabIndex = (t) => TABS.findIndex((x) => x[0] === t);
  const viewStack = []; // the pages opened on top of the current tab, for Back
  const toTop = () => screen.scrollTo({ top: 0, behavior: U.reduced() ? 'auto' : 'smooth' });
  // `quiet` leaves the haptic to the caller (Android's Back plays its own). `later`: a tap on the tab
  // bar, drawn after the frame that answers it (switchLater).
  function go(tab, quiet, later) {
    // Places that were tabs before 1.6: Profile is the You tab, and the moves are a section of Plan.
    if (tab === 'profile') tab = 'you';
    const moves = tab === 'moves' && U.hasTab('plan');
    if (moves) {
      const turned = U.planSection ? U.planSection('moves') : false;
      if (U.route.tab === 'plan' && !U.route.view) {
        if (turned) { if (!quiet) U.haptic('select'); render(); }
        toTop();
        return;
      }
      tab = 'plan';
    }
    // A section that isn't a tab opens as a page: Food with calorie tracking on, the moves with
    // workouts off. Food without it goes to Health, where it starts; anything else to Today.
    if (!U.hasTab(tab)) {
      if (tab === 'moves' || (tab === 'food' && GH.food && U.S && GH.food.full(U.S))) {
        if (U.route.view === tab) toTop();
        else U.open(tab);
        return;
      }
      tab = tab === 'food' ? 'health' : 'today';
    }
    if (U.route.tab === tab && !U.route.view) { if (!switching) toTop(); return; }
    // Plan opens on This week (as it opens on today), unless it's the moves that were asked for.
    if (tab === 'plan' && !moves && U.planSection) U.planSection('week');
    const from = U.route.view ? null : tabIndex(U.route.tab);
    const to = tabIndex(tab);
    if (!quiet) U.haptic('tab');
    if (U.markSeen) U.markSeen(`tab_${tab}`);
    // Pages opened on the tab we leave are left behind, so Back on the new tab never returns to one.
    viewStack.length = 0;
    U.route = { tab, view: null, arg: null };
    const kind = from == null ? 'pop' : to > from ? 'right' : to < from ? 'left' : null;
    if (later && G.requestAnimationFrame && !doc.hidden) { switchLater(tab, kind); return; }
    render(kind);
    if (U.screens[tab] && U.screens[tab].shown) safe(() => U.screens[tab].shown(U.S, U.today()));
  }
  U.go = go;
  // A tap on the tab bar is answered in the very next frame: the bar's glass sets off for the tab
  // (Refract's own, as it hears the tap) and the page starts to leave where it is (U.motion.leave);
  // the new page is drawn after that frame, and comes in as on any tab change. Drawn inside the tap,
  // the new page's style, layout and paint (and the bar measuring where its glass goes, which laid the
  // whole new page out inside the tap) held that first frame back 250 to 450 ms at 4x CPU, so nothing
  // answered the tap until the new page was there. The route is the new tab's from the tap on: a
  // render before then (a sync ending) is this change, with its motion; a second tap before the
  // frame only changes where it goes (back to the tab it left, and the page stays as it is).
  let switching = null; // { tab, kind, from } while a tab change waits for its frame
  function switchLater(tab, kind) {
    const first = !switching;
    switching = { tab, kind, from: first ? lastKey : switching.from };
    nextMotion = kind;
    if (!first) return;
    if (U.motion && U.motion.leave) safe(() => U.motion.leave(screen, kind));
    rightAfterFrame(() => {
      const s = switching;
      switching = null;
      if (!s || U.route.view || U.route.tab !== s.tab) return;
      if (lastKey !== s.tab) { drawFirst = true; render(s.kind); drawFirst = false; } else if (s.tab === s.from) { nextMotion = null; if (U.motion && U.motion.stay) U.motion.stay(screen); return; }
      // What a tab does once it shows (a badge to celebrate, a report to write) waits for its page's
      // frame too.
      const scr = U.screens[s.tab];
      if (scr && scr.shown) rightAfterFrame(() => { if (U.route.tab === s.tab && !U.route.view) safe(() => scr.shown(U.S, U.today())); });
    });
  }
  U.open = (view, arg) => {
    // Profile became the You tab: old links to it land there.
    if (view === 'profile') { go('you'); return; }
    if (U.route.view) viewStack.push({ view: U.route.view, arg: U.route.arg, scroll: scrollNow() });
    U.route = { tab: U.route.tab, view, arg: arg == null ? null : arg };
    U.haptic('nav');
    render('push');
    screen.focus({ preventScroll: true });
    if (U.screens[view] && U.screens[view].shown) safe(() => U.screens[view].shown(U.S, U.today(), arg));
  };
  U.back = () => {
    if (!U.route.view) return false;
    const prev = viewStack.pop();
    U.route = { tab: U.route.tab, view: prev ? prev.view : null, arg: prev ? prev.arg : null };
    U.haptic('back');
    render('pop');
    if (prev) scrollSoon(prev.scroll || 0);
    return true;
  };
  U.act.goToday = () => go('today');
  U.act.back = () => U.back();

  // A workout in progress rides above the tab bar on other tabs.
  let accEnter = false; // the capsule forms at the next read pass
  function renderAccessory() {
    const A = U.S && U.S.active;
    // An outdoor activity recording in the background takes the capsule (src/ui/actlive.js).
    const act = U.actAccessory ? safe(() => U.actAccessory()) : '';
    const show = (!!A || !!act) && playerEl.hidden && !(U.route.tab === 'today' && !U.route.view);
    const was = !accessory.hidden;
    // Going away: a copy of the capsule dissolves where it was, sinking into the tab bar (it hides at
    // once).
    if (was && !show && U.motion && U.motion.glassOut) safe(() => U.motion.glassOut(accessory));
    accessory.hidden = !show;
    screen.toggleAttribute('data-capsule', show);
    // Emptied with morph, not innerHTML: that keeps Refract's lens layer (the capsule's glass), which
    // Refract only puts back on a resize.
    if (!show) { U.morph(accessory, ''); return; }
    if (act) U.morph(accessory, act);
    else {
      const doneN = A.steps.slice(0, A.idx).filter((s) => s.kind === 'set').length;
      const total = A.steps.filter((s) => s.kind === 'set').length;
      U.morph(accessory, `<span class="rf-activity-leading" data-tone="coral" style="width:36px;height:36px">${U.icon('timer', 'sm')}</span>
      <span class="acc-text"><b>${U.esc(A.session.title)}</b><span class="t-caption rf-secondary">${doneN} of ${total} sets</span></span>
      <span class="rf-spacer"></span>
      <button type="button" class="rf-btn" data-size="sm" data-act="resumeWorkout" aria-label="Resume the workout, ${doneN} of ${total} sets done">Resume</button>`);
    }
    // Coming in: it forms out of the tab bar (U.motion.glassIn), in the frame's read pass (it's
    // measured first). A second change before that frame still forms it once.
    if (!was) accEnter = true;
    readSoon('accessory', () => {
      fitAccessory();
      if (accEnter && !accessory.hidden && U.motion && U.motion.glassIn) U.motion.glassIn(accessory);
      accEnter = false;
    });
  }
  // A long workout title with large text: two lines for the title and no set count, rather than a
  // title cut short.
  function fitAccessory() {
    if (accessory.hidden) return;
    accessory.classList.remove('is-tight');
    const b = accessory.querySelector('.acc-text b');
    if (b && b.scrollWidth > b.clientWidth + 1) accessory.classList.add('is-tight');
  }
  if (G.addEventListener) G.addEventListener('resize', () => { if (accessory) fitAccessory(); });
  U.renderAccessory = renderAccessory;

  /* ---------------------------------------------------------------- haptics */
  // U.haptic(kind, o): o.consequence marks a haptic that follows an action's own (a toast after a
  // switch), which then keeps its feel (see platform.js).
  U.haptic = (kind, o) => { const p = P(); if (p && p.haptic) p.haptic(kind, o); };

  /* ---------------------------------------------------------------- events */
  function dispatch(map, el, ev, value) {
    const name = el.getAttribute(map === U.act ? 'data-act' : 'data-on');
    const fn = map[name];
    if (!fn) return;
    try { fn(el, ev, value); } catch (e) { if (G.console) G.console.error(e); U.toast('Something went wrong', 'critical'); }
  }
  // After the next frame is drawn: a frame, then a task (a hidden page draws no frames, hence the
  // timer as well; whichever comes first).
  function afterFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    if (G.requestAnimationFrame) G.requestAnimationFrame(() => setTimeout(run, 0));
    setTimeout(run, 100);
  }
  // The same, as soon as that frame is done: a task of the highest priority posted from the frame's
  // animation callbacks (else a message), which runs before the timers due by then and before the
  // next frame. A tab change waited behind both, 40 to 60 ms at 4x CPU.
  function rightAfterFrame(fn) {
    let done = false;
    const run = () => { if (!done) { done = true; fn(); } };
    const post = () => {
      const sc = G.scheduler;
      if (sc && sc.postTask) { sc.postTask(run, { priority: 'user-blocking' }); return; }
      if (G.MessageChannel) { const ch = new G.MessageChannel(); ch.port1.onmessage = run; ch.port2.postMessage(0); return; }
      setTimeout(run, 0);
    };
    if (G.requestAnimationFrame) G.requestAnimationFrame(post);
    setTimeout(run, 100);
  }
  U.rightAfterFrame = rightAfterFrame;
  // A stepper's or slider's value at (or past) its end: a firmer edge instead of a tick.
  const atEnd = (t) => {
    const v = parseFloat(t.value), lo = parseFloat(t.min), hi = parseFloat(t.max);
    return isFinite(v) && ((isFinite(lo) && v <= lo) || (isFinite(hi) && v >= hi));
  };
  const lastValue = new WeakMap(); // a slider → the value it last ticked at
  /* The haptics that come with a control by themselves (the controls in controls.js play their own
   * press, detent and tick while held and dragged; chip choices their select):
   * - data-haptic="<kind>" on a [data-act] element plays that kind on its click;
   * - a segment, radio or switch change plays select, toggleOn or toggleOff, and a toggle chip
   *   toggleOn or toggleOff;
   * - a stepper ticks with each step of its value (held down too: it repeats without clicks), and a
   *   slider with each step it passes, both with an edge at the end;
   * - dialogs: heavy on a destructive OK, back on cancel (see U.dialog).
   * A segment's, switch's or chip choice's change runs its data-on handler after the next frame,
   * so the thumb or knob is already on its way (and the haptic played) before a re-render can hold
   * up the page. data-sync on the control (or its data-on element) runs it at once instead. */
  // A tap lets the player's sounds start (a browser plays a page's audio only after one), once the
  // tap has been answered: making the audio context, at the first tap after launch, held that tap's
  // frame back 60 to 220 ms at 4x CPU. A tap's activation outlasts that by seconds, and the app's
  // WebView doesn't ask for one.
  let audioWait = 0;
  function unlockSoon() {
    if (audioWait || !P()) return;
    const run = () => { audioWait = 0; safe(() => P().unlockAudio()); };
    audioWait = G.requestIdleCallback ? G.requestIdleCallback(run, { timeout: 1000 }) : setTimeout(run, 50);
  }
  function wire() {
    doc.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-act]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      unlockSoon();
      if (el.hasAttribute('data-haptic')) U.haptic(el.getAttribute('data-haptic'));
      dispatch(U.act, el, e);
    });
    const onChange = (e) => {
      const t = e.target;
      if (!t.matches) return;
      const seg = t.matches('.rf-segment input');
      const sw = !seg && t.matches('input[role="switch"]');
      if (seg || t.matches('.ob-radio')) U.haptic('select');
      else if (sw) U.haptic(t.checked ? 'toggleOn' : 'toggleOff');
      const el = t.closest('[data-on]');
      if (!el) return;
      const v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
      const later = (seg || sw || t.matches('.gh-chipseg > [role="radio"]')) && !t.hasAttribute('data-sync') && !el.hasAttribute('data-sync');
      if (sw && later) holdRenders(t);
      if (later) afterFrame(() => dispatch(U.on, el, e, v));
      else dispatch(U.on, el, e, v);
    };
    doc.addEventListener('change', onChange);
    doc.addEventListener('rf-toggle', (e) => {
      const d = e.detail;
      if (!d || !('pressed' in d)) return;
      if (e.target.closest && e.target.closest('.rf-chip')) U.haptic(d.pressed ? 'toggleOn' : 'toggleOff');
      const el = e.target.closest && e.target.closest('[data-on]');
      if (el) dispatch(U.on, el, e, d.pressed);
    });
    doc.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type === 'range') {
        if (lastValue.get(t) === t.value) return;
        lastValue.set(t, t.value);
        U.haptic(atEnd(t) ? 'edge' : 'tick');
      } else if (!e.isTrusted && t.classList && t.classList.contains('rf-stepper-value')) {
        // A stepper's own step (typing in it is the keyboard's business).
        U.haptic(atEnd(t) ? 'edge' : 'tick');
      }
    });
  }

  /* ---------------------------------------------------------------- dialogs, toasts */
  // Sheets (U.sheet, U.topSheet, U.closeSheets) live in sheet.js.
  // A dialog's answer has a feel of its own: heavy for a destructive choice, or the one its action
  // names (haptic: 'cancel' for Cancel workout), the moment it's made, not when the dialog opens;
  // back for cancelling it (Cancel, Esc, a tap outside, Android Back). Other choices leave it to what
  // they do.
  function dialogHaptic(o, v) {
    const a = (o.actions || []).find((x) => String(x.value != null ? x.value : x.label) === String(v));
    if (a && a.tone === 'critical') U.haptic(a.haptic || 'heavy');
    else if (!a || a.value === 'cancel') U.haptic('back');
  }
  U.dialog = (o) => {
    const r = R();
    if (r && r.dialog) return r.dialog.open(o).then((v) => { dialogHaptic(o, v); return v; });
    const labels = (o.actions || []).map((a) => a.label);
    return Promise.resolve(G.confirm(`${o.title}\n${o.message || ''}`) ? (o.actions || []).slice(-1)[0].value : 'cancel').then((v) => v || labels);
  };
  // cancelLabel names the safe choice when "Cancel" would be confusing (cancelling a workout).
  U.confirm = (title, message, label, tone, icon, cancelLabel) => U.dialog({
    title, message, icon, tone: tone === 'critical' ? 'critical' : undefined,
    actions: [{ label: cancelLabel || 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label, value: 'ok', variant: 'filled', tone: tone || 'accent' }],
  }).then((v) => v === 'ok');
  // A toast's haptic is a consequence of what was just done: a success merges into that action's own
  // feel, and a warning or an error waits for it to end (platform.js).
  U.toast = (title, tone, message, action) => {
    const after = { consequence: true };
    if (tone === 'positive') U.haptic('success', after);
    else if (tone === 'critical') U.haptic('error', after);
    else if (tone === 'caution') U.haptic('warning', after);
    const r = R();
    if (!r || !r.toast) return null;
    try {
      // Placed before it's put in: that reads where the buttons at the bottom are, in the layout the
      // toast's own entrance makes anyway.
      seatToaster();
      placeToasts();
      const t = r.toast({ title, message, tone: tone || 'neutral', action, position: 'bottom' });
      if (t && t.el) toastIn(t.el);
      return t;
    } catch (e) { if (G.console) G.console.error(e); return null; }
  };

  /* ---------------------------------------------------------------- toasts at the bottom */
  // Toasts come up from the bottom of the screen. At the top they covered the bar's Back button and
  // the page's title; down here they sit above whatever is there: the tab bar, Today's floating
  // buttons and the workout capsule, the player's, set-up's or a live activity's buttons, or an open
  // sheet's main buttons, so one never covers a main button (and at least clear of the system bar).
  // How high that is (--toast-lift on the toaster) is read as a toast comes, and again while one
  // shows whenever one of those comes or goes; the toaster glides there (src/styles.css). Refract's
  // toaster brings them in rising from below and lets them drop away, keeps three at most, and takes
  // a swipe down to dismiss the bottom one.
  const TOAST_GAP = 8; // px between a toast and the buttons under it (its slot adds 4 more)
  const TOAST_H = 64; // a toast's height with its slot, to check what it would cover
  // A sheet's main buttons: filled, tinted or large ones.
  const MAIN_BTN = '.gh-sheet-panel .rf-btn:is([data-variant="filled"], [data-variant="tinted"], [data-size="lg"], [data-size="xl"]), .rf-dialog-actions .rf-btn';
  const toaster = () => doc.querySelector('.rf-toaster[data-position="bottom"]');
  const shows = (el) => !!el && !el.hidden && el.isConnected && !el.hasAttribute('data-closing') && el.getClientRects().length > 0;
  // Where an element is laid out on the screen, without the transforms an entrance plays on it (the
  // player's actions rising in, a button forming).
  function laidOut(el) {
    let top = 0;
    for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
    return { top, bottom: top + el.offsetHeight };
  }
  // The open sheet or dialog toasts go over: the topmost modal one that isn't on its way out.
  function topModal() {
    let list = [];
    try { list = Array.from(doc.querySelectorAll('dialog:modal')); } catch (e) { list = Array.from(doc.querySelectorAll('dialog[open]')); }
    list = list.filter((d) => !d.hasAttribute('data-closing'));
    return list.length ? list[list.length - 1] : null;
  }
  // What a toast must stay clear of, as boxes on screen ({ top, bottom }).
  function toastObstacles() {
    const out = [];
    const modal = topModal();
    if (modal) {
      // A sheet at rest (read again once it settles), so these are read as drawn.
      for (const b of modal.querySelectorAll(MAIN_BTN)) { const r = b.getBoundingClientRect(); if (r.height && r.width) out.push({ top: r.top, bottom: r.bottom }); }
      return out;
    }
    const live = doc.getElementById('actlive');
    const over = [[playerEl, '.pl-actions > *'], [onboardEl, '.ob-actions > *'], [live, '.al-actions > *']].find(([el]) => shows(el));
    if (over) {
      for (const b of over[0].querySelectorAll(over[1])) if (b.offsetHeight) out.push(laidOut(b));
      return out;
    }
    if (shows(floatEl)) out.push(laidOut(floatEl));
    if (shows(accessory)) out.push(laidOut(accessory));
    const bar = tabbar && !tabbar.hasAttribute('data-away') ? tabbar.querySelector('.rf-tabbar-bar') : null;
    if (bar && bar.offsetHeight) out.push(laidOut(bar));
    return out;
  }
  // From the bottom up: a toast at the bottom that would cover one of them goes above it, and so on
  // up (a sheet's two buttons one over the other), but never past the middle of the screen.
  let toastLift = 0;
  function placeToasts() {
    const H = G.innerHeight || doc.documentElement.clientHeight;
    // (The app's shell writes the insets on the root's own style, read there at no cost; in a browser
    // they're env(), in the computed style only.)
    const rs = doc.documentElement.style;
    const sab = parseFloat(rs.getPropertyValue('--sab') || G.getComputedStyle(doc.documentElement).getPropertyValue('--sab')) || 0;
    let lift = sab + TOAST_GAP;
    const obs = toastObstacles().filter((o) => o.bottom > H / 2).sort((a, b) => b.bottom - a.bottom);
    for (const o of obs) if (o.bottom > H - lift - TOAST_H && o.top < H - lift) lift = Math.max(lift, H - o.top + TOAST_GAP);
    toastLift = Math.round(Math.min(lift, H / 2));
    liftToaster(toaster());
  }
  // (Written only when it changes: the toaster is restyled for it.)
  function liftToaster(t) {
    const v = `${toastLift}px`;
    if (t && toastLift && t.style.getPropertyValue('--toast-lift') !== v) t.style.setProperty('--toast-lift', v);
  }
  // Over an open sheet a toast goes in its dialog: outside the topmost modal dialog nothing takes a
  // tap (it's inert), so a toast left on the page couldn't be tapped, and a tap on its Undo would land
  // on the sheet under it. The toaster goes back where it was as that sheet starts to close (moving
  // a popover closes it, so it's shown again).
  const watchedModals = new WeakSet();
  const isOpen = (t) => { try { return t.matches(':popover-open'); } catch (e) { return true; } };
  function seatToaster() {
    const t = toaster();
    if (!t) return;
    const modal = topModal();
    const host = modal || doc.body;
    if (t.parentNode === host) return;
    const was = isOpen(t) || !!t.querySelector('.rf-toast');
    host.appendChild(t);
    if (was && t.showPopover && !isOpen(t)) {
      try { t.showPopover(); } catch (e) { /* not a popover here */ }
      // Its style as it shows now, where it was, so the move to its new place (the next read pass)
      // glides rather than jumps.
      void G.getComputedStyle(t).translate;
    }
    if (!modal || watchedModals.has(modal) || !G.MutationObserver) return;
    watchedModals.add(modal);
    const back = () => { const x = toaster(); if (x && x.parentNode === modal) { seatToaster(); toastsMoved(); } };
    new G.MutationObserver(() => { if (modal.hasAttribute('data-closing') || !modal.open) back(); }).observe(modal, { attributes: true, attributeFilter: ['data-closing', 'open'] });
    modal.addEventListener('close', back);
  }
  const toastsShowing = () => !!doc.querySelector('.rf-toast:not([data-leaving])');
  // Something at the bottom came or went: placed again in the frame's read pass.
  let placeWait = false;
  function toastsMoved() {
    if (placeWait || !toastsShowing()) return;
    placeWait = true;
    readSoon(null, () => { placeWait = false; if (toastsShowing()) { seatToaster(); placeToasts(); } });
  }
  // Watched from the first toast on: the parts at the bottom showing or hiding, a sheet opening or
  // settling, the keyboard, a live activity's screen added to the page.
  let toastWatch = null;
  function watchToasts() {
    if (toastWatch || !G.MutationObserver) return;
    toastWatch = new G.MutationObserver(() => toastsMoved());
    const attrs = { attributes: true, attributeFilter: ['hidden', 'data-away', 'data-closing'] };
    for (const el of [floatEl, tabbar, accessory, playerEl, onboardEl, doc.getElementById('actlive')]) if (el) toastWatch.observe(el, attrs);
    toastWatch.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-sheet-open', 'data-keyboard'] });
    if (root) {
      new G.MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) if (n.id === 'actlive') { toastWatch.observe(n, attrs); toastsMoved(); }
      }).observe(root, { childList: true });
    }
    doc.addEventListener('gh-sheet-moving', (e) => { if (!(e.detail && e.detail.moving)) toastsMoved(); });
    G.addEventListener('resize', toastsMoved);
  }
  // A toast's motion is Refract's: it rises in on a spring with its words and buttons after it (about
  // a second), and drops away, its slot closing up after it (about 0.6 s). Both play 1.6 times as fast,
  // the same curves; its countdown runs for as long as it should. Reduced motion: Refract's short fades.
  const TOAST_RATE = 1.6;
  const quicken = (list) => { if (!U.reduced()) for (const a of list) if (a.id !== 'rf-countdown') a.playbackRate = TOAST_RATE; };
  const toasterWatched = new WeakSet();
  function toastIn(el) {
    watchToasts();
    const t = el.closest('.rf-toaster');
    if (t && !toasterWatched.has(t) && G.MutationObserver) {
      toasterWatched.add(t);
      // Its exit starts as Refract marks it leaving, and its slot's as Refract sets the slot's height.
      new G.MutationObserver((list) => {
        for (const m of list) {
          const n = m.target;
          if (!n.getAnimations) continue;
          if (m.attributeName === 'data-leaving' && n.hasAttribute('data-leaving')) quicken(n.getAnimations({ subtree: true }));
          else if (m.attributeName === 'style' && n.classList.contains('rf-toast-slot') && n.style.height) quicken(n.getAnimations());
        }
      }).observe(t, { subtree: true, attributes: true, attributeFilter: ['data-leaving', 'style'] });
    }
    if (el.getAnimations) {
      quicken(el.getAnimations({ subtree: true }));
      if (el.parentElement && el.parentElement.classList.contains('rf-toast-slot')) quicken(el.parentElement.getAnimations());
      // (The squash as it lands starts a moment later.)
      setTimeout(() => { if (el.isConnected && !el.hasAttribute('data-leaving')) quicken(el.getAnimations({ subtree: true })); }, 340);
    }
    // The first toast made the toaster: it gets its place now, before its first frame.
    liftToaster(t);
    seatToaster();
  }

  /* ---------------------------------------------------------------- persistence */
  // Every saved change also fires 'gh-change' on the document, for anything that follows the state
  // (badges, for one) without each action having to call it.
  U.save = (now) => {
    if (!U.S) return;
    if (now) GH.store.save(U.S); else GH.store.saveSoon(U.S);
    document.dispatchEvent(new CustomEvent('gh-change'));
  };
  U.commit = () => { U.save(); render(); };
  // For background triggers (a sync that ended, the day rolling over, the app coming back, Today's
  // insight line worked out): one render however many ask, once it's quiet (no scroll or touch for a
  // while, U.whenQuiet: a page's render holds the page's thread for a few frames), none while the page
  // is hidden (it runs once it's shown again), and none under the player or set-up. It runs in an idle
  // moment of its own, and what the screen works out for it (its warm hook: Today's session, which a
  // sync's new night of sleep changes) in the one before, so neither shares a frame: drawn at the next
  // frame, the render (sync, then the insight line, a moment after launch) landed in the frames where
  // Refract draws its glass's lens maps, making 100 to 140 ms of the page's thread at 4x CPU.
  let renderFrame = 0, renderWait = false;
  U.renderSoon = () => {
    if (renderFrame || renderWait || !G.requestAnimationFrame) return;
    renderWait = true;
    U.whenQuiet(() => {
      const go = () => {
        renderFrame = 0;
        if (doc.hidden) { renderFrame = G.requestAnimationFrame(go); return; } // (no frames until it's shown)
        if (U.S && U.S.profile.onboarded && playerEl.hidden && onboardEl.hidden) render();
      };
      const draw = () => {
        renderWait = false;
        if (renderFrame) return;
        renderFrame = G.requestIdleCallback && !doc.hidden ? G.requestIdleCallback(go, { timeout: 300 }) : G.requestAnimationFrame(go);
      };
      const r = U.route, scr = U.screens[r.view || r.tab];
      if (!U.S || !scr || !scr.warm || !G.requestIdleCallback) { draw(); return; }
      G.requestIdleCallback(() => { if (U.S) safe(() => scr.warm(U.S, U.today(), r.arg)); draw(); }, { timeout: 300 });
    });
  };

  /* ---------------------------------------------------------------- back button */
  function onBack() {
    // An open menu (U.menu) closes first, even over a sheet it was opened from.
    if (U.closeMenu && U.closeMenu()) return true;
    const top = U.topSheet();
    if (top) { top.close('cancel'); return true; }
    if (doc.querySelector('dialog.rf-dialog[open]')) { const d = doc.querySelector('dialog.rf-dialog[open]'); try { if (R() && R().dialog) R().dialog.close(d, 'cancel'); else d.close('cancel'); } catch (e) { /* ignore */ } return true; }
    if (!playerEl.hidden) return U.playerBack ? U.playerBack() : false;
    if (!onboardEl.hidden) return U.onboardBack ? U.onboardBack() : false;
    if (U.route.view) return U.back();
    if (U.route.tab !== 'today') { U.haptic('back'); go('today', true); return true; }
    return false;
  }

  /* ---------------------------------------------------------------- health sync */
  // Reads Health Connect when the app opens or comes back (at most once a minute), every 15 minutes
  // while it's open, after a workout, and on pull-to-refresh or the refresh button.
  const SYNC_EVERY = 15 * 60000;
  const SYNC_GAP = 60000;
  let syncing = null;
  let lastTry = 0;
  let syncError = null;
  U.syncState = () => ({ busy: !!syncing, last: U.S && U.S.health.lastSync, error: syncError });
  U.syncHealth = (reason) => {
    const S = U.S;
    if (!S || !GH.health) return Promise.resolve(null);
    const manual = reason === true || reason === 'manual';
    const st = GH.health.status();
    const stChanged = S.health.status !== st;
    S.health.status = st;
    if (!GH.health.connected(st)) return Promise.resolve(null);
    if (syncing) return syncing;
    if (!manual && Date.now() - lastTry < SYNC_GAP) return Promise.resolve(null);
    lastTry = Date.now();
    const before = { last: S.health.lastSync, error: syncError };
    syncing = (async () => {
      try {
        const res = await GH.health.sync(S, Date.now());
        syncError = res && !res.ok ? res.error || 'failed' : null;
        if (res && res.ok) { if (GH.health.afterSync(S, U.today())) res.changed = true; U.save(); }
        return res;
      } catch (e) {
        syncError = 'failed';
        return { ok: false, error: 'failed' };
      }
    })();
    syncChanged();
    return syncing.then((res) => { syncing = null; syncChanged(res, before, stChanged); return res; });
  };
  // Spinners follow the sync. When it ends, the screen re-renders if the sync changed something it
  // shows (new data, a different status or error) or if it shows the sync itself (the Health tab,
  // Settings: their data-sync-spin buttons); otherwise the "Synced 3 min ago" labels just move on to
  // the new time, and a sync that brought nothing new costs no render.
  function syncChanged(res, before, stChanged) {
    const busy = !!syncing;
    for (const el of doc.querySelectorAll('[data-sync-spin]')) el.toggleAttribute('data-spinning', busy);
    if (busy || !before || !U.S) return;
    const quiet = res && res.ok && res.changed === false && !stChanged && syncError === before.error && !doc.querySelector('[data-sync-spin]');
    if (!quiet) { U.renderSoon(); return; }
    const last = U.S.health.lastSync;
    if (before.last && last !== before.last) for (const el of doc.querySelectorAll(`[data-ago="${before.last}"]`)) el.dataset.ago = last;
    tickAgo();
  }
  // "Updated 3 min ago" labels stay current without a re-render.
  function tickAgo() { for (const el of doc.querySelectorAll('[data-ago]')) { const t = U.ago(Number(el.dataset.ago)); if (el.textContent !== t) el.textContent = t; } }

  // Pull down at the top of Today or Health to read Health Connect now.
  function pullToRefresh() {
    let pull = null;
    const can = () => !U.route.view && (U.route.tab === 'today' || U.route.tab === 'health') && U.S && GH.health && GH.health.connected(GH.health.status());
    const reset = (animate) => {
      ptrEl.classList.remove('armed');
      if (animate && !U.reduced() && ptrEl.animate) ptrEl.animate([{ transform: ptrEl.style.transform, opacity: ptrEl.style.opacity || 1 }, { transform: 'translateY(0)', opacity: 0 }], { duration: 220, easing: 'ease-out' });
      ptrEl.style.transform = ''; ptrEl.style.opacity = '';
    };
    screen.addEventListener('touchstart', (e) => { pull = screen.scrollTop <= 0 && e.touches.length === 1 && can() && !syncing ? { y0: e.touches[0].clientY, armed: false, d: 0 } : null; }, { passive: true });
    screen.addEventListener('touchmove', (e) => {
      if (!pull) return;
      const dy = e.touches[0].clientY - pull.y0;
      if (dy <= 0 || screen.scrollTop > 0) { if (pull.d) reset(false); pull.d = 0; return; }
      const d = Math.min(120, dy * 0.45);
      pull.d = d;
      ptrEl.style.transform = `translateY(${d}px) rotate(${d * 3}deg)`;
      ptrEl.style.opacity = String(Math.min(1, d / 56));
      const armed = d >= 64;
      if (armed !== pull.armed) { pull.armed = armed; ptrEl.classList.toggle('armed', armed); if (armed) U.haptic('detent'); }
    }, { passive: true });
    const end = () => {
      if (!pull) return;
      const armed = pull.armed;
      pull = null;
      if (!armed) { reset(true); return; }
      ptrEl.classList.add('spinning');
      U.syncHealth('manual').then((res) => {
        ptrEl.classList.remove('spinning');
        reset(true);
        if (res && res.ok) U.haptic('refresh');
        else if (res && !res.ok) U.toast('Couldn\'t read Health Connect', 'caution', res.error === 'timeout' ? 'It took too long. Try again.' : undefined);
      });
    };
    screen.addEventListener('touchend', end, { passive: true });
    screen.addEventListener('touchcancel', () => { if (pull) { pull = null; reset(true); } }, { passive: true });
  }

  /* ---------------------------------------------------------------- boot */
  function applyPrefs() {
    const p = U.S ? U.S.profile.prefs : { theme: 'system', sound: true, vibrate: true, haptics: true, density: 0.5 };
    if (P()) {
      P().setPrefs({ sound: p.sound !== false, vibrate: p.vibrate !== false, haptics: p.haptics !== false, hapticStrength: p.hapticStrength || 'medium' });
      P().applyTheme(p.theme || 'system', !!p.contrast);
      if (p.density != null) P().setDensity(p.density);
    }
    // The background glow drifts unless it's switched off (Settings, Look).
    doc.documentElement.toggleAttribute('data-still-glow', p.glowMove === false);
    // Glass effects (Settings, Look): see "glass while the page moves" above.
    setGlassMode(p.glass);
    if (U.steadyLight) U.steadyLight();
  }
  U.applyPrefs = applyPrefs;

  /* The 3D figure warms up (loads its chunk and compiles its shaders: seconds of work on a slow
   * phone) only when today's workout will want it: workouts on, today's not done yet, a phone with
   * 3 GB of memory or more and the app on screen, about 8 s after launch once the page is idle and
   * calm (U.calm: no scroll or touch going on).
   * Otherwise it starts loading the first time a figure is about to show: a press on Start or on a
   * move. Set-up warms it for its own reveal (src/ui/onboarding.js).
   * With the 3D figure picked, the stills kept on the phone (src/ui/stills.js) are read in once the
   * first frame is drawn, so Plan's first frame has them. Once launch has settled (its first idle
   * moment that comes by itself), in a calm one, the ones Plan's cards would show this week and next
   * (U.planStills) that aren't kept yet are drawn ahead, the figure warming up for them at once (a
   * fresh install, an update that draws the figure differently, a new move in the plan), so Plan has
   * them, or soon will, when it's opened; when they're all kept, nothing loads for them. A press on
   * the Plan tab warms the figure up too if one is still missing. */
  const FIGURE_ACTS = ['startWorkout', 'planStart', 'resumeWorkout', 'startMobility', 'moveInfo', 'planMoveInfo', 'cpHowTo', 'ladder'].map((a) => `[data-act="${a}"]`).join(',');
  const PLAN_TAB = '#tabbar .rf-tab[data-tab="plan"]';
  const idle = (fn, ms) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 1));
  // fn in the first idle moment that comes by itself (not one a timeout forced), or after ms at the
  // latest. Right after launch, or a tap on Plan, the page's own work goes on and the GPU is still
  // drawing the page; a WebGL context made then (the check for WebGL 2, the 3D warm-up's) waits for
  // all of that, holding the page's thread (2 to 4 s each in a software-GL test).
  function settled(fn, ms) {
    const t0 = Date.now();
    const look = () => idle((d) => (d && d.didTimeout && Date.now() - t0 < ms ? look() : fn()), 1000);
    look();
  }
  function warmFigure() { safe(() => { const w = U.warmFigure || U.preloadFigure; if (w) w(); }); }
  function warmFigureLater() {
    const onDown = (e) => {
      if (!e.target.closest || !e.target.closest(FIGURE_ACTS)) return;
      doc.removeEventListener('pointerdown', onDown, true);
      warmFigure();
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointerdown', (e) => { if (U.stills && e.target.closest && e.target.closest(PLAN_TAB)) settled(() => safe(() => U.stills.prime()), 2000); }, { capture: true, passive: true });
    const wanted = () => {
      const S = U.S, nav = G.navigator || {};
      return !!(S && S.profile.onboarded && S.profile.workouts !== false && nav.deviceMemory >= 3 && B().todayPlan(S, U.today()).type === 'workout');
    };
    const later = () => {
      if (!wanted()) return;
      if (doc.hidden) { doc.addEventListener('visibilitychange', later, { once: true }); return; }
      // Not in the middle of a scroll or a touch, nor right after one: once it's quiet, at the next
      // idle moment (the chunk's load and its warm-up hold the page's thread for a while).
      if (!U.quiet()) { U.whenQuiet(() => idle(later, 4000)); return; }
      warmFigure();
    };
    setTimeout(() => idle(later, 4000), 8000);
    const S0 = U.S;
    if (U.stills && S0 && S0.profile.onboarded && (S0.profile.prefs.figure || '3d') === '3d') afterFrame(() => safe(() => U.stills.load()));
    U.stillsAhead();
  }
  // (Also after set-up, src/ui/stills.js: the first day starts there.)
  U.stillsAhead = () => afterFrame(() => settled(() => safe(stillsAhead), 6000));
  function stillsAhead() {
    const S = U.S, nav = G.navigator || {};
    if (!S || !S.profile.onboarded || S.profile.workouts === false || nav.deviceMemory < 3 || !U.stills || !U.planStills || !U.stills.ok()) return;
    if (doc.hidden) { doc.addEventListener('visibilitychange', stillsAhead, { once: true }); return; }
    if (!U.calm()) { U.whenCalm(() => idle(stillsAhead, 1000)); return; }
    U.stills.load().then((n) => {
      // None kept under this figure's id (a fresh install, an update that draws it differently): the
      // figure starts warming up at once, before the week's stills are worked out.
      if (!n) safe(() => U.stills.prime());
      idle(() => { if (U.S === S) safe(() => U.stills.ahead(U.planStills(S, U.today()))); }, 1000);
    });
  }

  // Tomorrow, worked out ahead (brain.dayWork: the calendar, the week's plan, the session as Today
  // builds it) a piece per quiet idle moment once launch has settled, and kept with the plan in the
  // state: the first launch of a new day finds its session, as a launch later the same day does,
  // where working it out held the first frame back 80 to 100 ms at 4x CPU. Again a moment after a
  // change (a workout logged, a setting); what's kept already costs next to nothing.
  let ahead = null, aheadTimer = 0;
  function workAhead() {
    const S = U.S;
    if (!S || !S.profile.onboarded || S.profile.workouts === false || !B().dayWork) return;
    if (ahead) { ahead.again = true; return; }
    // (Not under the player or set-up: their figure draws every frame.)
    if (!playerEl.hidden || !onboardEl.hidden) { workAheadSoon(); return; }
    const sessions = () => (S.planCache && Array.isArray(S.planCache.sessions) ? S.planCache.sessions : []);
    const job = ahead = { work: B().dayWork(S, U.today() + 1), was: sessions().slice(), again: false };
    const step = () => U.whenQuiet(() => idle(() => {
      if (!playerEl.hidden || !onboardEl.hidden) { setTimeout(step, 4000); return; }
      let r;
      try { r = U.S === S ? job.work.next() : { done: true }; } catch (e) { r = { done: true }; }
      if (!r.done) { step(); return; }
      ahead = null;
      const now = sessions();
      if (U.S === S && (now.length !== job.was.length || now.some((x, i) => x !== job.was[i]))) GH.store.saveSoon(S);
      if (job.again) workAheadSoon();
    }, 1000));
    step();
  }
  function workAheadSoon() { clearTimeout(aheadTimer); aheadTimer = setTimeout(workAhead, 4000); }
  if (doc) doc.addEventListener('gh-change', workAheadSoon);

  let lastDay = null;
  function boot() {
    layout();
    wire();
    // The glow holds still for the first 3 s (launch is busy enough), and stops drifting 20 s after
    // launch too if nothing's touched.
    markInUse(Date.now());
    if (!idleTimer) idleTimer = setTimeout(checkIdle, IDLE_MS);
    if (P()) {
      P().onBack(onBack);
      P().on('resume', () => {
        if (!U.S || !U.S.profile.onboarded) return;
        U.syncHealth('resume');
        if (U.today() !== lastDay) { lastDay = U.today(); U.renderSoon(); }
      });
      // The app is going to the background: a save still waiting is written now.
      P().on('pause', () => GH.store.flush());
      P().on('route', (route) => openRoute(route));
      P().on('insets', () => { updateScrolled(); });
    }
    // Migrations that can wait (the badges' first look at history) run once the first frame is drawn.
    const later = [];
    U.S = GH.store.load({ later });
    if (later.length) { const S0 = U.S; afterFrame(() => { for (const fn of later) safe(() => fn(S0)); }); }
    applyPrefs();
    observeInserts();
    // Before you start (src/ui/firstrun.js): health and privacy, once, over set-up or the first screen.
    const firstRun = (then) => !!(U.firstRun && safe(() => U.firstRun(then)));
    if (!U.S || !U.S.profile.onboarded) { U.showOnboarding(); firstRun(); }
    else {
      // Until the first frame is drawn, screens leave out what can come a moment later (Today's
      // insight line, when it has to be worked out).
      U.firstFrame = true;
      afterFrame(() => { U.firstFrame = false; });
      render('stagger');
      U.syncHealth('boot');
      // What could open over the first screen (a workout to pick up, What's new, a badge, a link's
      // page) waits until Before you start is put away.
      const greet = () => {
        if (U.S.active && U.resumePrompt) U.resumePrompt();
        if (U.afterBoot) safe(() => U.afterBoot());
      };
      if (!firstRun(greet)) greet();
    }
    warmFigureLater();
    afterFrame(() => settled(workAheadSoon, 6000));
    lastDay = U.today();
    setInterval(() => {
      const d = U.today();
      if (d !== lastDay) { lastDay = d; U.renderSoon(); }
      if (U.S && U.S.profile.onboarded && (!P() || P().visible()) && Date.now() - (U.S.health.lastSync || 0) >= SYNC_EVERY) U.syncHealth('interval');
      tickAgo();
    }, 30000);
    const hash = (G.location && G.location.hash || '').replace('#', '');
    if (hash) openRoute(hash);
    G.addEventListener('hashchange', () => openRoute((G.location.hash || '').replace('#', '')));
  }
  // Links into the app (#route, or the shell's route event). Tabs, and places that were tabs (moves,
  // profile, food) or are pages in some modes (progress), go through go(); the rest open as pages.
  function openRoute(route) {
    const ready = U.S && U.S.profile.onboarded;
    if (route === 'privacy') { if (ready) U.open('privacy'); else if (U.showPrivacySheet) U.showPrivacySheet(); }
    else if (['today', 'plan', 'food', 'health', 'progress', 'you', 'moves', 'profile'].includes(route)) { if (ready) go(route); }
    else if (['settings', 'science', 'coach'].includes(route) || (route === 'badges' && U.screens.badges)) {
      if (!ready) return;
      U.open(route);
      // A badge's notification: what's still sealed comes up over the gallery, ready to be opened.
      const A = GH.achievements;
      if (route === 'badges' && U.badgeReveal && A && A.unopened && A.unopened(U.S).length) {
        (U.motion && U.motion.settled ? U.motion.settled() : Promise.resolve()).then(() => { if (U.route.view === 'badges') U.badgeReveal(); });
      }
    }
  }
  U.boot = boot;
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
    else setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
