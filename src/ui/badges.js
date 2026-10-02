/* Badges in the UI: the medals, the gallery, the detail sheet, the reveal, and when to celebrate.
 *
 * The badges themselves are src/achievements.js (GH.achievements). Hooks for other screens:
 *  - U.badgeStrip(S, day): the You tab's card (a summary, what's next, the latest medals).
 *  - U.open('badges'): the gallery page.
 *  - U.badgeCheck(reason): check now ('workout' and 'mobility' come from the player, which shows
 *    its own; 'activity', 'boot' and the rest say so with a toast). Returns what's new to show.
 *  - U.badgeEvent(name): a moment the state doesn't keep ('sharedPlan', 'tailored', 'reviewed',
 *    'sharedBadge'), then a check.
 * Otherwise every saved change (the 'gh-change' event) is checked 800 ms later, only for the
 * categories it touched, and never while the player or set-up is open. New badges never pop up
 * over what someone is doing: the player's Next screen shows its own card, and elsewhere a toast
 * with the medal offers the reveal. A badge that came in with a Health Connect sync, or whose day
 * is in the past, waits quietly on the You tab as "New".
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const A = () => GH.achievements;
  const B = () => GH.brain;
  const doc = G.document;
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  /* ---------------------------------------------------------------- glyphs */
  // Glyphs Refract doesn't have, on its grid (24 px, 1.75 stroke, round ends). The rest come from
  // Refract and core.js's extra icons.
  const GLYPHS = {
    trophy: '<path d="M7.75 4.25h8.5v5a4.25 4.25 0 0 1-8.5 0z"/><path d="M7.75 6H5.5a2.25 2.25 0 0 0 2.5 3.95M16.25 6h2.25a2.25 2.25 0 0 1-2.5 3.95M12 13.5v3M9 20.25h6M10 16.5h4l.75 3.75h-5.5z"/>',
    sunrise: '<path d="M3.25 17.25h17.5M7.1 17.25a4.9 4.9 0 0 1 9.8 0M12 6.5v3M5.75 10.75l1.9 1.9M18.25 10.75l-1.9 1.9M7.5 20.75h9"/>',
    moonstar: '<path d="M19.25 14.25A7.75 7.75 0 0 1 9.75 4.75a7.75 7.75 0 1 0 9.5 9.5z"/><path d="M16.75 3.5v3.5M15 5.25h3.5"/>',
    hourglass: '<path d="M7 3.75h10M7 20.25h10M8.25 3.75c0 4.75 7.5 5.25 7.5 8.25s-7.5 3.5-7.5 8.25M15.75 3.75c0 4.75-7.5 5.25-7.5 8.25s7.5 3.5 7.5 8.25"/>',
    ladder: '<path d="M8 3.25v17.5M16 3.25v17.5M8 7.5h8M8 12h8M8 16.5h8"/>',
    pullup: '<path d="M3.25 4.25h17.5M7.5 4.25l2 6.25h5l2-6.25"/><circle cx="12" cy="7.6" r="1.65"/><path d="M12 10.5v5M12 15.5l-2.1 4.75M12 15.5l2.1 4.75"/>',
    steps: '<path d="M8.4 14c-1.45.2-2.5-1.3-2.8-3.5-.35-2.5.35-5.2 2.2-5.45 1.85-.25 2.8 2.3 2.85 4.75.1 2.3-.8 4-2.25 4.2zM6.5 16.5l3.2-.45.2 1.55a1.6 1.6 0 0 1-3.15.45z"/><path d="M15.4 11.5c1.45.2 2.5-1.3 2.8-3.5.35-2.5-.35-5.2-2.2-5.45-1.85-.25-2.8 2.3-2.85 4.75-.1 2.3.8 4 2.25 4.2zM17.3 14l-3.2-.45-.2 1.55a1.6 1.6 0 0 0 3.15.45z"/>',
    tape: '<path d="M14.25 17.5h-7.5a3.25 3.25 0 0 1-3.25-3.25v-4.5A3.25 3.25 0 0 1 6.75 6.5h6.5a3.25 3.25 0 0 1 3.25 3.25v7.75h4"/><circle cx="10" cy="12" r="2.25"/><path d="M18.25 17.5v-1.75M20.25 17.5v-1.75"/>',
    cake: '<path d="M4.5 20.25h15M6 20.25v-5.75a1.75 1.75 0 0 1 1.75-1.75h8.5A1.75 1.75 0 0 1 18 14.5v5.75"/><path d="M6 16.25c1 .8 2 .8 3 0s2-.8 3 0 2 .8 3 0 2-.8 3 0M12 12.75v-3"/><path d="M12 4.75c.75.85 1.1 1.55 1.1 2.05a1.1 1.1 0 0 1-2.2 0c0-.5.35-1.2 1.1-2.05z"/>',
    question: '<path d="M9.4 9.1a2.75 2.75 0 1 1 3.95 2.45c-.8.4-1.35 1-1.35 1.9v.6"/><circle cx="12" cy="17.1" r="1.05" fill="currentColor" stroke="none"/>',
  };
  // Ours go into Refract's set too, so U.icon draws them (the old Profile grid does).
  (function register() { const r = G.Refract; if (r && r.icons) for (const [k, v] of Object.entries(GLYPHS)) if (!r.icons[k]) r.icons[k] = v; })();
  function glyph(name) {
    if (GLYPHS[name]) return GLYPHS[name];
    const r = G.Refract;
    if (r && r.icons && !r.icons[name] && U.icon) U.icon(name); // core.js registers its extra icons on first use
    return (r && r.icons && r.icons[name]) || GLYPHS.question;
  }

  /* ---------------------------------------------------------------- medals */
  const f1 = (n) => Math.round(n * 100) / 100;
  // A closed polygon with rounded corners (a curve from `r` before each corner to `r` after it).
  function rounded(pts, r) {
    let d = '';
    pts.forEach((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
      const at = (q) => { const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy), k = Math.min(r / len, 0.5); return `${f1(p[0] + dx * k)} ${f1(p[1] + dy * k)}`; };
      d += `${i ? 'L' : 'M'}${at(a)}Q${f1(p[0])} ${f1(p[1])} ${at(b)}`;
    });
    return `${d}Z`;
  }
  const ring = (n, r1, r2, rot) => Array.from({ length: n }, (_, i) => { const a = ((rot + (i * 360) / n) * Math.PI) / 180, r = r2 != null && i % 2 ? r2 : r1; return [60 + r * Math.cos(a), 60 + r * Math.sin(a)]; });
  const circle = (r, cy) => `M60 ${f1((cy || 60) - r)}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}z`;
  // Each shape in a 120 box: the medal, its face (where the enamel and glyph go, centred on cy),
  // all within 53 of the centre so a progress ring fits round any of them.
  const SHAPES = {
    circle: { outer: circle(51), face: circle(39), cy: 60 },
    hexagon: { outer: rounded(ring(6, 53, null, -90), 9), face: rounded(ring(6, 41, null, -90), 6), cy: 60 },
    shield: { outer: 'M25 12H95Q105 12 105 22V55C105 82 86 100 60 112C34 100 15 82 15 55V22Q15 12 25 12Z', face: 'M32 24H88Q93 24 93 29V55C93 75 79 89 60 98C41 89 27 75 27 55V29Q27 24 32 24Z', cy: 57 },
    square: { outer: 'M42 16H78Q104 16 104 42V78Q104 104 78 104H42Q16 104 16 78V42Q16 16 42 16Z', face: 'M45 27H75Q93 27 93 45V75Q93 93 75 93H45Q27 93 27 75V45Q27 27 45 27Z', cy: 60 },
    star: { outer: rounded(ring(24, 53, 45.5, -90), 3.2), face: circle(36.5), cy: 60 },
  };
  // Metal stops along the rim's diagonal: a dark edge, two bright bands and a deep turn, so it reads
  // as polished metal rather than a flat colour.
  function metalStops(t) {
    if (t === 'platinum') return [[0, '#efdcff'], [0.16, '#ffffff'], [0.34, '#8fb3ff'], [0.5, '#d2f4ff'], [0.66, '#a38cf0'], [0.82, '#f6e2ff'], [1, '#7f97e2']];
    if (t === 'lock') return [[0, '#d5d9df'], [0.3, '#eef0f3'], [0.55, '#b3b9c2'], [0.8, '#c9ced5'], [1, '#9aa1ab']];
    const [dk, body, lt, hi] = A().TIERS[t].metal;
    return [[0, lt], [0.2, hi], [0.42, body], [0.6, lt], [0.82, dk], [1, body]];
  }
  const stops = (list) => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('');
  // The defs one medal needs. Ids are the same for the same tier, category and shape, so the same
  // medal twice on a page shares identical definitions.
  function defs(tier, cat, shape, locked) {
    const t = locked ? 'lock' : tier;
    const en = locked ? ['#a4aab3', '#7b828c', '#565c66'] : A().CAT[cat].enamel;
    const e = locked ? 'lock' : cat;
    const rib = locked ? ['#8d939c', '#6b717a'] : { bronze: ['#b06a2c', '#7a4012'], silver: ['#8a96a3', '#5c6670'], gold: ['#c89412', '#8a5f00'], platinum: ['#8f8cd9', '#5d63b5'] }[tier];
    return `<defs>
      <linearGradient id="ghb-m-${t}" x1=".1" y1="0" x2=".9" y2="1">${stops(metalStops(t))}</linearGradient>
      <radialGradient id="ghb-e-${e}" cx=".38" cy=".3" r=".9">${stops([[0, en[0]], [0.55, en[1]], [1, en[2]]])}</radialGradient>
      <linearGradient id="ghb-r-${t}" x1="0" y1="0" x2="0" y2="1">${stops([[0, rib[0]], [1, rib[1]]])}</linearGradient>
      <linearGradient id="ghb-edge" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#fff', 0.95], [0.38, '#fff', 0.15], [0.55, '#fff', 0], [1, '#000', 0.22]])}</linearGradient>
      <radialGradient id="ghb-spec" cx=".32" cy=".18" r=".7">${stops([[0, '#fff', 0.6], [0.45, '#fff', 0.12], [1, '#fff', 0]])}</radialGradient>
      <radialGradient id="ghb-shadow">${stops([[0, '#000', 0.32], [1, '#000', 0]])}</radialGradient>
      <clipPath id="ghb-k-${shape}"><path d="${SHAPES[shape].face}"/></clipPath>
      <clipPath id="ghb-o-${shape}"><path d="${SHAPES[shape].outer}"/></clipPath>
    </defs>`;
  }
  // A four-pointed sparkle for platinum.
  const sparkle = (x, y, s) => `<path d="M${x} ${y - s}C${x + s * 0.16} ${y - s * 0.16} ${x + s * 0.16} ${y - s * 0.16} ${x + s} ${y}C${x + s * 0.16} ${y + s * 0.16} ${x + s * 0.16} ${y + s * 0.16} ${x} ${y + s}C${x - s * 0.16} ${y + s * 0.16} ${x - s * 0.16} ${y + s * 0.16} ${x - s} ${y}C${x - s * 0.16} ${y - s * 0.16} ${x - s * 0.16} ${y - s * 0.16} ${x} ${y - s}Z" fill="#fff"/>`;
  /* A badge's medal as SVG: a shape per category, the tier's metal rim, an enamel face with fine
   * engraving, the glyph embossed in it, a specular highlight and, for numbered badges, a ribbon
   * with the count. Locked: matte grey with a lock and a progress ring (have of goal). A secret one
   * still locked shows a question mark.
   * o: { earned, size, have, goal, text (false: the ribbon without its number, for drawing it
   * elsewhere), cls, label, sweep (a light sweep across it, for the reveal) }. */
  function badgeSvg(def, o) {
    o = o || {};
    const locked = !o.earned;
    const sh = SHAPES[def.shape] || SHAPES.circle;
    const shape = SHAPES[def.shape] ? def.shape : 'circle';
    const t = locked ? 'lock' : def.tier;
    const secret = locked && def.secret;
    const g = glyph(secret ? 'question' : def.glyph).replace(/currentColor/g, '#fff');
    const cy = sh.cy;
    const rib = def.ribbon && !secret;
    const gy = rib ? cy - 5.5 : cy; // the glyph sits a little higher over a ribbon, a little smaller
    const gs = rib ? 1.55 : 1.65;
    const size = o.size || 72;
    // Engraving: fine rays from the face's centre, clipped to it.
    let rays = '';
    for (let i = 0; i < 36; i++) { const a = (i * Math.PI) / 18; rays += `M60 ${cy}L${f1(60 + 60 * Math.cos(a))} ${f1(cy + 60 * Math.sin(a))}`; }
    const pct = locked && o.goal ? Math.max(0, Math.min(1, (o.have || 0) / o.goal)) : 0;
    const label = o.label ? ` role="img" aria-label="${U.esc(o.label)}"` : ' aria-hidden="true"';
    return `<svg class="bdg-svg${o.cls ? ` ${o.cls}` : ''}${locked ? ' is-locked' : ''}" viewBox="0 0 120 120" width="${size}" height="${size}" data-tier="${locked ? 'locked' : def.tier}"${label} xmlns="http://www.w3.org/2000/svg">${defs(def.tier, def.cat, shape, locked)}
      <ellipse cx="60" cy="113" rx="34" ry="5.5" fill="url(#ghb-shadow)"/>
      <g${locked ? ' opacity=".62"' : ''}>
        <path d="${sh.outer}" fill="url(#ghb-m-${t})"/>
        <path d="${sh.outer}" fill="none" stroke="url(#ghb-edge)" stroke-width="2.2" transform="translate(60 60) scale(.965) translate(-60 -60)"/>
        ${shape === 'circle' ? `<circle cx="60" cy="60" r="45.2" fill="none" stroke="#000" stroke-opacity="${locked ? 0.06 : 0.12}" stroke-width="7" pathLength="360" stroke-dasharray=".9 2.1"/><circle cx="60" cy="60" r="45.2" fill="none" stroke="#fff" stroke-opacity="${locked ? 0.1 : 0.24}" stroke-width="7" pathLength="360" stroke-dasharray=".7 2.3" stroke-dashoffset="-1.2"/>` : ''}
        <path d="${sh.face}" fill="#000" fill-opacity=".28" transform="translate(0 1.4)"/>
        <path d="${sh.face}" fill="url(#ghb-e-${locked ? 'lock' : def.cat})"/>
        <g clip-path="url(#ghb-k-${shape})">
          <path d="${rays}" stroke="#fff" stroke-opacity="${locked ? 0.05 : 0.09}" stroke-width=".8"/>
          <ellipse cx="46" cy="${cy - 22}" rx="40" ry="26" fill="url(#ghb-spec)" transform="rotate(-24 46 ${cy - 22})"/>
        </g>
        <path d="${sh.face}" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="2.4"/>
        <path d="${sh.face}" fill="none" stroke="url(#ghb-m-${t})" stroke-width="1.2"/>
        <g transform="translate(${f1(60 - 12 * gs)} ${f1(gy - 12 * gs)}) scale(${gs})" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8">
          <g stroke="#000" stroke-opacity=".38" transform="translate(0 .9)">${g}</g>
          <g stroke="#fff"${locked ? ' stroke-opacity=".8"' : ''}>${g}</g>
        </g>
        ${o.sweep && !locked ? `<g clip-path="url(#ghb-o-${shape})"><g transform="rotate(20 60 60)"><rect class="bdg-sweep" x="-60" y="-20" width="34" height="160" fill="#fff" fill-opacity=".38"/></g></g>` : ''}
        ${rib ? `<g class="bdg-ribbon">
          <path d="M23 89.5l12-4.5v20.5l-12-1.5 4.5-7.25z" fill="url(#ghb-r-${t})" opacity=".85"/>
          <path d="M97 89.5l-12-4.5v20.5l12-1.5-4.5-7.25z" fill="url(#ghb-r-${t})" opacity=".85"/>
          <path d="M33 85.5h54v19H33z" fill="url(#ghb-r-${t})"/>
          <path d="M33 86.25h54" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>
          ${o.text === false ? '' : `<text x="60" y="95.6" text-anchor="middle" dominant-baseline="central" font-family="'Host Grotesk', system-ui, sans-serif" font-weight="800" font-size="${def.ribbon.length > 3 ? 11.5 : 13}" letter-spacing=".4" fill="#fff">${U.esc(def.ribbon)}</text>`}
        </g>` : ''}
        ${!locked && def.tier === 'platinum' ? `${sparkle(93, 21, 6)}${sparkle(103, 37, 3.4)}${sparkle(20, 84, 3)}` : ''}
      </g>
      ${locked ? `${o.goal > 1 && !secret ? `<circle cx="60" cy="60" r="57.5" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="3.5"/><circle class="bdg-ring" cx="60" cy="60" r="57.5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${f1(pct * 100)} 100" transform="rotate(-90 60 60)"/>` : ''}
        <g transform="translate(91 91)"><circle r="12.5" fill="#3c424d" stroke="#fff" stroke-width="2"/><g transform="translate(-7.5 -7.75) scale(.625)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyph('lock')}</g></g>` : ''}
    </svg>`;
  }
  U.badgeSvg = badgeSvg;

  /* ---------------------------------------------------------------- reading the state */
  const live = () => ({ hc: GH.health && GH.health.status ? GH.health.status() : null });
  const list = (S, day) => A().evaluate(S, day, { live: live() });
  const fmtDate = (d, year) => { if (d == null) return ''; const s = B().fmtDay(d, false); return year ? `${s}, ${B().dayStr(d).slice(0, 4)}` : s; };
  // "Earned today", "Earned yesterday", "Earned Sep 28" (with the year when it isn't this one).
  function earnedWhen(item, day) {
    if (!item.earned) return '';
    if (item.approx) return `Earned by ${fmtDate(item.day, B().dayStr(item.day).slice(0, 4) !== B().dayStr(day).slice(0, 4))}`;
    if (item.day === day) return 'Earned today';
    if (item.day === day - 1) return 'Earned yesterday';
    return `Earned ${fmtDate(item.day, B().dayStr(item.day).slice(0, 4) !== B().dayStr(day).slice(0, 4))}`;
  }
  // Progress in words: "4 of 10", "3.2 of 5 km"; a one-off badge is just Locked (or Secret).
  function progressText(item) {
    const u = item.def.unit;
    const n = (v) => (Math.round(v * 10) / 10).toLocaleString('en-US');
    if (item.goal <= 1) return item.def.secret ? 'Secret' : 'Locked';
    return `${n(item.have)} of ${n(item.goal)}${u === 'km' || u === 'm' || u === 'h' ? ` ${u}` : ''}`;
  }
  const tierLine = (def) => `${A().TIERS[def.tier].name} · ${A().TIERS[def.tier].rarity}`;
  function nextLine(sum) {
    if (!sum.next) return sum.earned ? 'Every badge you can earn now is yours' : '';
    const it = sum.next;
    return `Next: ${it.def.next || it.def.title.toLowerCase()}${it.goal > 1 && it.have > 0 ? `, ${A().toGo(it)}` : ''}`;
  }
  const sorted = (items) => items.slice().sort((a, b) => (b.day - a.day) || (b.at - a.at) || (A().TIERS[b.def.tier].rank - A().TIERS[a.def.tier].rank));

  /* ---------------------------------------------------------------- the You tab's card */
  // A summary ("12 of 64 · Next: 25 workouts, 4 to go"), a note about new badges or (once, after
  // 1.6) the ones history already earned, and the latest medals; before any, the next ones to earn.
  U.badgeStrip = (S, day) => {
    if (!S || !A()) return '';
    const items = list(S, day);
    const sum = A().summary(S, day, items);
    const ach = S.achievements || {};
    const mig = ach.migrated && ach.migrated.n > 0 && !ach.migrated.seen ? ach.migrated.n : 0;
    const earned = sorted(items.filter((x) => x.earned)).slice(0, 8);
    const shown = earned.length ? earned : items.filter((x) => x.shown && !x.earned && !x.def.secret).sort((a, b) => b.pct - a.pct).slice(0, 4);
    const fresh = items.filter((x) => x.isNew);
    const note = fresh.length
      ? `<button type="button" class="bdg-note" data-act="badgeReveal">${U.icon('sparkle', 'sm')}<span class="t-subhead">${fresh.length === 1 ? `New badge: ${U.esc(fresh[0].def.title)}` : `${fresh.length} new badges`}</span><span class="bdg-note-go t-subhead">See ${fresh.length === 1 ? 'it' : 'them'}</span></button>`
      : mig ? `<button type="button" class="bdg-note" data-act="openBadges">${U.icon('sparkle', 'sm')}<span class="t-subhead">You've already earned ${U.plural(mig, 'badge')}</span><span class="bdg-note-go t-subhead">See them</span></button>` : '';
    return `<div class="card bdg-strip" data-key="badge-strip">
      <button type="button" class="bdg-strip-head" data-act="openBadges" aria-label="Badges: ${sum.earned} of ${sum.total}. See all">
        <span class="bdg-strip-text"><span class="t-headline">Badges</span><span class="t-footnote rf-muted">${U.roll(sum.earned)} of ${sum.total}${sum.next ? ` · ${U.esc(nextLine(sum))}` : ''}</span></span>
        <span class="bdg-strip-all t-subhead">See all${U.icon('chevron-right', 'sm')}</span>
      </button>
      ${note}
      <div class="bdg-row" data-hscroll>${shown.map((x) => `<button type="button" class="bdg-mini${x.earned ? ' is-earned' : ''}${x.isNew ? ' is-new' : ''}" data-badge="${x.id}" data-key="bdg-mini-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(`${x.def.title}, ${x.earned ? earnedWhen(x, day).toLowerCase() : progressText(x)}`)}">${badgeSvg(x.def, { earned: x.earned, size: 56, have: x.have, goal: x.goal })}<span class="bdg-mini-title t-caption">${U.esc(x.def.title)}</span></button>`).join('')}</div>
    </div>`;
  };
  U.badgeSummary = (S, day) => A().summary(S, day, list(S, day));
  U.act.openBadges = () => U.open('badges');

  /* ---------------------------------------------------------------- the gallery */
  let filter = 'all';
  function tile(x, day) {
    const sub = x.earned ? fmtDate(x.day) : x.def.secret ? 'Secret' : progressText(x);
    const title = x.def.secret && !x.earned ? 'Secret badge' : x.def.title;
    return `<button type="button" class="bdg-tile${x.earned ? ' is-earned' : ''}${x.isNew ? ' is-new' : ''}" data-badge="${x.id}" data-key="bdg-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(`${title}, ${x.earned ? earnedWhen(x, day).toLowerCase() : sub}`)}">
      <span class="bdg-tile-medal">${badgeSvg(x.def, { earned: x.earned, size: 68, have: x.have, goal: x.goal })}${x.isNew ? '<span class="bdg-new t-caption">New</span>' : ''}</span>
      <span class="bdg-tile-title t-footnote">${U.esc(title)}</span>
      <span class="bdg-tile-sub t-caption rf-muted">${U.esc(sub)}</span>
    </button>`;
  }
  function nextRow(x) {
    return `<button type="button" class="bdg-next" data-badge="${x.id}" data-key="bdg-next-${x.id}" data-act="badgeOpen" data-arg="${x.id}">
      ${badgeSvg(x.def, { earned: false, size: 52, have: x.have, goal: x.goal })}
      <span class="bdg-next-text"><span class="t-subhead">${U.esc(x.def.title)}</span><span class="t-footnote rf-muted">${U.esc(x.def.how)}</span>${U.progress(x.pct, `${x.def.title} progress`, 'positive')}</span>
      <span class="bdg-next-n t-footnote rf-muted">${U.esc(progressText(x))}</span>
    </button>`;
  }
  U.screens.badges = {
    render(S, day) {
      const items = list(S, day);
      const sum = A().summary(S, day, items);
      const T = A().TIERS;
      const shown = items.filter((x) => x.shown);
      const pick = filter === 'earned' ? shown.filter((x) => x.earned) : shown;
      let body = '';
      if (filter === 'next') {
        const open = shown.filter((x) => !x.earned && !x.def.secret).sort((a, b) => (b.pct - a.pct) || (T[a.def.tier].rank - T[b.def.tier].rank)).slice(0, 10);
        body = open.length ? `<h2 class="sec-title t-title-3">Closest to earning</h2><div class="section"><div class="bdg-nexts" data-key="nexts">${open.map(nextRow).join('')}</div></div>`
          : '<div class="section"><div class="card"><p class="t-callout rf-muted">Every badge you can earn right now is yours. New ones open up as you track more.</p></div></div>';
      } else {
        for (const c of A().CATS) {
          const its = pick.filter((x) => x.def.cat === c.id);
          if (!its.length) continue;
          const got = shown.filter((x) => x.def.cat === c.id && x.earned).length;
          const all = shown.filter((x) => x.def.cat === c.id).length;
          body += `<h2 class="sec-title t-title-3" data-key="bh-${c.id}">${U.esc(c.name)} <span class="t-callout rf-muted">${got} of ${all}</span></h2>
            <div class="section" data-key="bs-${c.id}"><div class="bdg-grid">${its.map((x) => tile(x, day)).join('')}</div></div>`;
        }
        if (!body) body = '<div class="section"><div class="card"><p class="t-callout rf-muted">No badges yet. Your first one is a workout away.</p></div></div>';
      }
      return `${U.navbar('Badges', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Badges</h1>
        <div class="section">
          <div class="card bdg-hero" data-key="bdg-hero">
            <div class="bdg-hero-top"><span class="t-title-2">${U.roll(sum.earned, 't-title-2')} <small class="t-callout rf-muted">of ${sum.total} earned</small></span></div>
            ${U.progress(sum.total ? sum.earned / sum.total : 0, 'Badges earned', 'positive')}
            <div class="bdg-tiers">${A().TIER_ORDER.map((t) => `<span class="bdg-tier-n" data-tier="${t}"><i aria-hidden="true"></i><span class="t-footnote">${U.esc(T[t].name)} <b>${sum.tiers[t]}</b></span></span>`).join('')}</div>
            ${sum.next ? `<p class="t-footnote rf-muted">${U.esc(nextLine(sum))}</p>` : ''}
          </div>
          ${U.choice('badgeFilter', [['all', 'All'], ['earned', 'Earned'], ['next', 'Next up']], filter, 'Show badges', ' data-on="badgeFilter"')}
        </div>
        ${body}`;
    },
    // Opening the gallery is seeing what's new (the New marks stay for this visit).
    shown(S) {
      const ach = S && S.achievements;
      if (!ach) return;
      let changed = false;
      if (A().unseen(S).length) { A().markSeen(S); changed = true; }
      if (ach.migrated && !ach.migrated.seen) { ach.migrated.seen = true; changed = true; }
      if (changed) U.save();
    },
  };
  U.on.badgeFilter = (el, ev, v) => { filter = ['all', 'earned', 'next'].includes(v) ? v : 'all'; U.render(); };

  /* ---------------------------------------------------------------- the detail sheet */
  function detailBody(x, day, total) {
    const def = x.def;
    const secret = def.secret && !x.earned;
    return `<div class="sheet-pad bdg-detail" data-badge="${x.id}">
      <div class="bdg-stage is-detail" data-tier="${x.earned ? def.tier : 'locked'}"><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${badgeSvg(def, { earned: x.earned, size: 148, have: x.have, goal: x.goal, sweep: x.earned, label: `${secret ? 'Secret badge' : def.title}${x.earned ? '' : ', locked'}` })}</span></div>
      <p class="bdg-tierline t-caption">${x.earned ? U.esc(tierLine(def)) : secret ? 'Secret' : `${U.esc(A().TIERS[def.tier].name)} · Locked`}</p>
      <h3 class="t-title-2 bdg-title">${U.esc(secret ? 'Secret badge' : def.title)}</h3>
      <p class="t-callout rf-muted bdg-how">${U.esc(secret ? 'A surprise. Keep going and it will find you.' : def.how)}</p>
      ${!x.earned && !secret && x.goal > 1 ? `<div class="bdg-prog">${U.progress(x.pct, 'Progress', 'positive')}<span class="t-footnote rf-muted">${U.esc(progressText(x))}${x.have > 0 ? ` · ${U.esc(A().toGo(x))}` : ''}</span></div>` : ''}
      ${x.earned ? `<p class="t-footnote bdg-when">${U.esc(earnedWhen(x, day))} · ${U.esc(`Badge ${rankOf(x)} of ${total}`)}</p>` : ''}
      ${x.earned ? `<div class="bdg-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="badgeShare" data-arg="${x.id}">${U.icon('share')}Share</button></div>` : ''}
    </div>`;
  }
  // Which badge this was, in the order they were earned ("the 14th"): its place among the earned.
  let rankMap = null;
  function rankOf(x) { return (rankMap && rankMap[x.id]) || 1; }
  function ranks(items) {
    const got = items.filter((i) => i.earned).sort((a, b) => (a.day - b.day) || (a.at - b.at));
    rankMap = {};
    got.forEach((i, k) => { rankMap[i.id] = k + 1; });
  }
  U.badgeDetail = (id) => {
    const S = U.S, day = U.today();
    if (!S || !A() || !own(A().byId, id)) return null;
    const items = list(S, day);
    ranks(items);
    const x = items.find((i) => i.id === id);
    const total = items.filter((i) => i.shown).length;
    return U.sheet({ title: A().CAT[x.def.cat].name, size: 'fit', cls: 'bdg-sheet', body: detailBody(x, day, total), after: (c) => { if (x.earned) spring(c.el.querySelector('.bdg-stage'), x.def, null); } });
  };
  U.act.badgeOpen = (el) => { const id = el && el.dataset ? el.dataset.arg : null; if (id) U.badgeDetail(id); };

  /* ---------------------------------------------------------------- the reveal */
  // The medal springs in (and spins round once), with a burst in its metal's colours and the badge
  // haptic. With reduced motion it's simply there.
  const BURST = { bronze: ['#e0a577', '#b87333', '#f9dcb8'], silver: ['#e6ebf0', '#9aa4ae', '#ffffff'], gold: ['#ffe08a', '#c9971c', '#fff6cf'], platinum: ['#a1c4fd', '#e0c3fc', '#c2e9fb'] };
  function spring(stage, def, o) {
    if (!stage) return;
    stage.classList.remove('is-in');
    if (!U.reduced()) { void stage.offsetWidth; stage.classList.add('is-in'); } else stage.classList.add('is-still');
    if (o && o.buzz) U.haptic('badge');
    const medal = stage.querySelector('.bdg-medal');
    if (o && o.burst && medal && G.Refract && G.Refract.burst && !U.reduced()) setTimeout(() => { try { G.Refract.burst(medal, { count: 22, colors: BURST[def.tier], spread: 1.25, size: [6, 12] }); } catch (e) { /* ignore */ } }, 300);
  }
  function revealPage(x, day, total) {
    const def = x.def;
    return `<section class="bdg-page" data-page="${x.id}" aria-label="${U.esc(def.title)}">
      <div class="bdg-stage" data-tier="${def.tier}"><span class="bdg-rays" aria-hidden="true"></span><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${badgeSvg(def, { earned: true, size: 176, sweep: true, label: def.title })}</span></div>
      <p class="bdg-tierline t-caption">${U.esc(tierLine(def))}</p>
      <h3 class="t-title-1 bdg-title">${U.esc(def.title)}</h3>
      <p class="t-callout rf-muted bdg-how">${U.esc(def.how)}</p>
      <p class="t-footnote bdg-when">${U.esc(earnedWhen(x, day))} · ${U.esc(`Badge ${rankOf(x)} of ${total}`)}</p>
    </section>`;
  }
  /* The reveal: a sheet with the new badges as pages (with dots when there are several), each
   * springing in as it comes into view, then Share and Done. Opening it counts them as seen.
   * ids: the badges to show (default: everything not shown yet). */
  U.badgeReveal = (ids) => {
    const S = U.S, day = U.today();
    if (!S || !A()) return null;
    const want = (ids && ids.length ? ids : A().unseen(S)).filter((id) => own(A().byId, id));
    if (!want.length) return null;
    const items = list(S, day);
    ranks(items);
    const pages = want.map((id) => items.find((i) => i.id === id)).filter((x) => x && x.earned);
    if (!pages.length) return null;
    const total = items.filter((i) => i.shown).length;
    A().markSeen(S);
    U.save();
    const many = pages.length > 1;
    let cur = 0;
    const done = new Set();
    const body = `<div class="bdg-reveal${many ? ' is-many' : ''}">
      <div class="bdg-pages"${many ? ' data-hscroll' : ''}>${pages.map((x) => revealPage(x, day, total)).join('')}</div>
      ${many ? `<div class="bdg-dots" role="tablist" aria-label="Badges">${pages.map((x, i) => `<button type="button" class="bdg-dot" role="tab" aria-selected="${i === 0}" aria-label="${U.esc(x.def.title)}" data-act="badgePage" data-arg="${i}"></button>`).join('')}</div>` : ''}
      <div class="bdg-actions">
        <button type="button" class="rf-btn rf-glass" data-size="lg" data-act="badgeShareCur">${U.icon('share')}Share</button>
        <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="badgeDone">Done</button>
      </div>
    </div>`;
    const show = (i, el) => {
      cur = i;
      for (const [k, d] of [...el.querySelectorAll('.bdg-dot')].entries()) d.setAttribute('aria-selected', String(k === i));
      if (done.has(i)) return;
      done.add(i);
      spring(el.querySelectorAll('.bdg-page')[i].querySelector('.bdg-stage'), pages[i].def, { buzz: true, burst: true });
    };
    // quiet: the medal's own badge haptic is the moment, not the sheet opening.
    const ctl = U.sheet({
      title: many ? `${pages.length} new badges` : 'New badge', size: 'fit', cls: 'bdg-sheet bdg-reveal-sheet', body, quiet: true,
      after: (c) => {
        const el = c.el;
        const box = el.querySelector('.bdg-pages');
        // The first medal waits for the sheet to rise.
        setTimeout(() => { if (!c.closed) show(0, el); }, U.reduced() ? 0 : 260);
        // A swipe settles on a page (scrollend; a pause in scrolling where it isn't supported). A dot
        // goes straight to its page, and the scroll it starts doesn't count on the way there.
        if (many && box) {
          let t = 0;
          const settled = () => {
            const i = Math.round(box.scrollLeft / Math.max(1, box.clientWidth));
            const was = jumpTo;
            jumpTo = null;
            if (was === i) return;
            if (i !== cur && i >= 0 && i < pages.length) { show(i, el); U.haptic('select'); }
          };
          if ('onscrollend' in G) box.addEventListener('scrollend', settled);
          else box.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(settled, 120); }, { passive: true });
        }
      },
    });
    let jumpTo = null;
    U.act.badgePage = (el) => {
      const i = Math.max(0, Math.min(pages.length - 1, Number(el.dataset.arg) || 0));
      const box = ctl.el.querySelector('.bdg-pages');
      if (!box) return;
      jumpTo = Math.abs(box.scrollLeft - i * box.clientWidth) < 4 ? null : i;
      box.scrollTo({ left: i * box.clientWidth, behavior: U.reduced() ? 'auto' : 'smooth' });
      show(i, ctl.el);
    };
    U.act.badgeShareCur = () => U.act.badgeShare({ dataset: { arg: pages[cur].id } });
    U.act.badgeDone = () => ctl.close('ok');
    return ctl;
  };
  U.act.badgeReveal = (el) => {
    const ids = el && el.dataset && el.dataset.arg ? el.dataset.arg.split(',') : null;
    U.badgeReveal(ids);
  };

  /* ---------------------------------------------------------------- the player's own card */
  // The Next screen's card: the newest medal (and how many more), opening the reveal. The medal
  // springs in after the screen does (U.badgeSpring).
  U.badgeCard = (fresh) => {
    const items = (fresh || []).filter((x) => x && x.def);
    if (!items.length) return '';
    const x = items[items.length - 1];
    const more = items.length - 1;
    return `<button type="button" class="card bdg-card" data-key="bdg-card" data-act="badgeReveal" data-arg="${items.map((i) => i.id).join(',')}" aria-label="${U.esc(more ? `${items.length} new badges. See them` : `New badge: ${x.def.title}. See it`)}">
      <span class="bdg-stage is-card" data-tier="${x.def.tier}"><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${badgeSvg(x.def, { earned: true, size: 72 })}</span></span>
      <span class="bdg-card-text">
        <span class="t-caption bdg-tierline">${more ? `${items.length} new badges` : `New badge · ${U.esc(A().TIERS[x.def.tier].name)}`}</span>
        <span class="t-headline">${U.esc(x.def.title)}</span>
        <span class="t-footnote rf-muted">${more ? U.esc(`And ${items.slice(0, -1).map((i) => i.def.title).join(', ')}`) : U.esc(x.def.how)}</span>
      </span>
      ${U.icon('chevron-right', null, 'bdg-card-go')}
    </button>`;
  };
  U.badgeSpring = (root) => {
    const stage = root && root.querySelector('.bdg-card .bdg-stage');
    const card = root && root.querySelector('.bdg-card');
    if (!stage || !card) return;
    const ids = (card.dataset.arg || '').split(',');
    const def = A().byId[ids[ids.length - 1]];
    if (def) setTimeout(() => spring(stage, def, { buzz: true, burst: true }), 700);
  };

  /* ---------------------------------------------------------------- checking and telling */
  let quietUntil = 0; // set-up's own first moments are quiet
  // Announces new badges: a toast with the medal that opens the reveal. Only for badges earned
  // today or yesterday (history found later just waits as New).
  function announce(ids) {
    const S = U.S, day = U.today();
    const defs = ids.map((id) => A().byId[id]).filter((d) => d && S.achievements.earned[d.id] && S.achievements.earned[d.id].day >= day - 1);
    if (!defs.length) return;
    setTimeout(() => {
      if (U.S !== S) return;
      const one = defs.length === 1;
      const t = U.toast(one ? 'New badge' : `${defs.length} new badges`, 'neutral', one ? defs[0].title : defs.map((d) => d.title).join(', '), { label: one ? 'See it' : 'See them', onClick: () => U.badgeReveal(defs.map((d) => d.id)) });
      const ic = t && t.el && t.el.querySelector('.rf-toast-icon');
      if (ic) { ic.innerHTML = badgeSvg(defs[defs.length - 1], { earned: true, size: 30 }); ic.classList.add('bdg-toast-medal'); }
      U.haptic('badge');
    }, 450);
  }
  function run(reason, cats) {
    const S = U.S;
    if (!S || !S.profile || !S.profile.onboarded || !A()) return [];
    const day = U.today();
    const fresh = A().check(S, day, reason, { cats, live: live() });
    lastStamps = A().stamps(S, day);
    return fresh;
  }
  // The player: everything not shown yet, as items for its Next screen card, counted as seen.
  function forPlayer() {
    const S = U.S, day = U.today();
    const ids = A().unseen(S);
    if (!ids.length) return [];
    const items = list(S, day);
    A().markSeen(S);
    return ids.map((id) => items.find((i) => i.id === id)).filter(Boolean).map((x) => Object.assign({}, x, { title: x.def.title, icon: x.def.glyph, tone: 'amber', need: x.def.how }));
  }
  U.badgeCheck = (reason) => {
    let fresh = [];
    try { fresh = run(reason || 'manual'); } catch (e) { if (G.console) G.console.error(e); return []; }
    if (reason === 'workout') return forPlayer();
    // At launch only the badges time itself brings (a year in) are told; anything else found then
    // came with data from before, and waits as New.
    if (fresh.length) { U.save(); announce(reason === 'boot' ? fresh.filter((id) => A().byId[id].cat === 'moments') : fresh); }
    return fresh.map((id) => A().byId[id]);
  };
  U.badgeEvent = (name) => {
    const S = U.S;
    if (!S || !A() || !A().EVENTS.includes(name)) return;
    A().event(S, name, U.today());
    U.save();
    U.badgeCheck(`event:${name}`);
  };

  // Saved changes, checked 800 ms after the last one, only for the categories they touched. Not
  // while the player or set-up is open (the player checks for itself as a workout ends); a change
  // that came with a Health Connect sync is checked quietly.
  let lastStamps = null, timer = 0, loud = false;
  function onChange() {
    if (!(U.syncState && U.syncState().busy) && Date.now() > quietUntil) loud = true;
    clearTimeout(timer);
    timer = setTimeout(pending, 800);
  }
  function pending() {
    timer = 0;
    const S = U.S;
    if (!S || !S.profile || !S.profile.onboarded || !A()) return;
    const els = U.els ? U.els() : {};
    if ((els.playerEl && !els.playerEl.hidden) || (els.onboardEl && !els.onboardEl.hidden)) { timer = setTimeout(pending, 1500); return; }
    const day = U.today();
    const now = A().stamps(S, day);
    const cats = lastStamps ? Object.keys(now).filter((k) => now[k] !== lastStamps[k]) : null;
    const said = loud;
    loud = false;
    if (cats && !cats.length) return;
    let fresh = [];
    try { fresh = run('change', cats); } catch (e) { if (G.console) G.console.error(e); return; }
    if (!fresh.length) return;
    U.save();
    if (said) announce(fresh);
  }
  if (doc) doc.addEventListener('gh-change', onChange);

  // After the app opens: time-based badges (a year in) and anything a closed app didn't get to.
  const prevBoot = U.afterBoot;
  U.afterBoot = () => {
    if (prevBoot) prevBoot();
    setTimeout(() => { if (U.S && U.S.profile.onboarded && U.els().onboardEl.hidden) U.badgeCheck('boot'); }, 1500);
  };
  // After set-up: what it already earned (Health Connect connected, say) counts as seen, quietly.
  const prevOnboarding = U.afterOnboarding;
  U.afterOnboarding = () => {
    if (prevOnboarding) prevOnboarding();
    const S = U.S;
    if (!S || !A()) return;
    const ach = A().ensure(S, U.today());
    if (!ach.migrated) ach.migrated = { at: Date.now(), n: 0 };
    try { run('setup'); } catch (e) { /* checked again on the next change */ }
    A().markSeen(S);
    quietUntil = Date.now() + 4000; // the first sync's history comes in quietly
    U.save();
  };

  /* ---------------------------------------------------------------- sharing a badge */
  U.act.badgeShare = (el) => {
    const id = el && el.dataset ? el.dataset.arg : null;
    if (!id || !U.shareBadge) return;
    U.shareBadge(id);
  };

  /* ---------------------------------------------------------------- the older names */
  // Profile (until the You tab replaces it), the player before 1.6 and guide.js read badges through
  // these, in the shape the 12 achievements had.
  const TONE = { consistency: 'amber', workouts: 'indigo', strength: 'coral', body: 'teal', moments: 'violet', activities: 'green', health: 'rose', food: 'green', plans: 'sky', start: 'teal' };
  const oldShape = (x) => ({ id: x.id, icon: x.def.glyph, tone: TONE[x.def.cat], title: x.def.secret && !x.earned ? 'Secret badge' : x.def.title, need: x.def.secret && !x.earned ? 'A surprise' : x.def.how, have: x.have, goal: x.goal, earned: x.earned, def: x.def });
  U.achievements = (S, day) => (S && A() ? list(S, day).filter((x) => x.shown).map(oldShape) : []);
  U.newAchievements = (S, day) => {
    if (!S || !A()) return [];
    try { A().check(S, day, 'profile', { live: live() }); } catch (e) { return []; }
    const ids = A().unseen(S);
    if (!ids.length) return [];
    const items = list(S, day);
    A().markSeen(S);
    U.save();
    return ids.map((id) => items.find((i) => i.id === id)).filter(Boolean).map(oldShape);
  };
  U.celebrateAchievements = (items) => U.badgeReveal((items || []).map((x) => x.id));
})(typeof window !== 'undefined' ? window : globalThis);
