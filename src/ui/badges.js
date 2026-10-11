/* Badges in the UI: the medals, the sealed capsules, the gallery, the detail sheet, the reveal (where
 * a capsule is opened), and when to celebrate.
 *
 * The badges themselves are src/achievements.js (GH.achievements). Hooks for other screens:
 *  - U.badgeStrip(S, day): the You tab's card (a summary, how many are waiting to be opened, the
 *    latest badges).
 *  - U.open('badges'): the gallery page.
 *  - U.badgeReveal(ids): the reveal (by default, every badge still sealed).
 *  - U.badgeCheck(reason): check now ('workout' and 'mobility' come from the player, which shows
 *    its own; 'activity', 'boot' and the rest say so with a toast). Returns what's new to show.
 *  - U.badgeEvent(name): a moment the state doesn't keep ('sharedPlan', 'tailored', 'reviewed',
 *    'sharedBadge'), then a check.
 * Otherwise every saved change (the 'gh-change' event) is checked 800 ms later, only for the
 * categories it touched, and never while the player or set-up is open. A new badge arrives sealed,
 * a glass capsule in its tier's colours (its rarity shows, its name and medal don't), and is opened
 * in the reveal with three taps. It never pops up over what someone is doing: the player's Next
 * screen shows its own card, and elsewhere a toast offers to open it. A badge that came in with a
 * Health Connect sync, or whose day is in the past, waits quietly on the You tab, sealed.
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
  // The gradients and clips medals use. Ids are the same for the same tier, category and shape.
  const RIBBON = { bronze: ['#b06a2c', '#7a4012'], silver: ['#8a96a3', '#5c6670'], gold: ['#c89412', '#8a5f00'], platinum: ['#8f8cd9', '#5d63b5'], lock: ['#8d939c', '#6b717a'] };
  const metalDef = (t) => `<linearGradient id="ghb-m-${t}" x1=".1" y1="0" x2=".9" y2="1">${stops(metalStops(t))}</linearGradient>`;
  const ribbonDef = (t) => `<linearGradient id="ghb-r-${t}" x1="0" y1="0" x2="0" y2="1">${stops([[0, RIBBON[t][0]], [1, RIBBON[t][1]]])}</linearGradient>`;
  const enamelDef = (e) => {
    const en = e === 'lock' ? ['#a4aab3', '#7b828c', '#565c66'] : A().CAT[e].enamel;
    return `<radialGradient id="ghb-e-${e}" cx=".38" cy=".3" r=".9">${stops([[0, en[0]], [0.55, en[1]], [1, en[2]]])}</radialGradient>`;
  };
  const clipDefs = (shape) => `<clipPath id="ghb-k-${shape}"><path d="${SHAPES[shape].face}"/></clipPath><clipPath id="ghb-o-${shape}"><path d="${SHAPES[shape].outer}"/></clipPath>`;
  const common = () => `<linearGradient id="ghb-edge" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#fff', 0.95], [0.38, '#fff', 0.15], [0.55, '#fff', 0], [1, '#000', 0.22]])}</linearGradient>
      <radialGradient id="ghb-spec" cx=".32" cy=".18" r=".7">${stops([[0, '#fff', 0.6], [0.45, '#fff', 0.12], [1, '#fff', 0]])}</radialGradient>
      <radialGradient id="ghb-shadow">${stops([[0, '#000', 0.32], [1, '#000', 0]])}</radialGradient>`;
  // The defs one medal needs, for a medal that stands on its own (drawn into an image: the share card).
  function defs(tier, cat, shape, locked) {
    const t = locked ? 'lock' : tier;
    return `<defs>${metalDef(t)}${enamelDef(locked ? 'lock' : cat)}${ribbonDef(t)}${common()}${clipDefs(shape)}</defs>`;
  }
  // On the page, every medal uses one shared set of them (every tier, category and shape, in a hidden
  // SVG of its own) instead of carrying a copy: the gallery has some 60 medals.
  function sharedDefs() {
    if (!doc || !doc.body || doc.getElementById('ghb-defs')) return;
    const tiers = A().TIER_ORDER.concat('lock');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'ghb-defs';
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.innerHTML = `<defs>${tiers.map((t) => metalDef(t) + ribbonDef(t)).join('')}${A().CATS.map((c) => enamelDef(c.id)).join('')}${enamelDef('lock')}${common()}${Object.keys(SHAPES).map(clipDefs).join('')}${capDefs()}</defs>`;
    doc.body.appendChild(svg);
  }
  // A four-pointed sparkle for platinum (and inside a sealed capsule, fainter).
  const sparkle = (x, y, s, op) => `<path d="M${x} ${y - s}C${x + s * 0.16} ${y - s * 0.16} ${x + s * 0.16} ${y - s * 0.16} ${x + s} ${y}C${x + s * 0.16} ${y + s * 0.16} ${x + s * 0.16} ${y + s * 0.16} ${x} ${y + s}C${x - s * 0.16} ${y + s * 0.16} ${x - s * 0.16} ${y + s * 0.16} ${x - s} ${y}C${x - s * 0.16} ${y - s * 0.16} ${x - s * 0.16} ${y - s * 0.16} ${x} ${y - s}Z" fill="#fff"${op != null ? ` fill-opacity="${op}"` : ''}/>`;
  /* A badge's medal as SVG: a shape per category, the tier's metal rim, an enamel face with fine
   * engraving, the glyph embossed in it, a specular highlight and, for numbered badges, a ribbon
   * with the count. Locked: matte grey with a lock and a progress ring (have of goal). A secret one
   * still locked shows a question mark.
   * o: { earned, size, have, goal, text (false: the ribbon without its number, for drawing it
   * elsewhere), cls, label, sweep (a light sweep across it, for the reveal), shared (its gradients
   * are the page's one set, sharedDefs: every medal drawn on the page; without it, the medal carries
   * its own, to stand alone in an image) }. */
  function badgeSvg(def, o) {
    o = o || {};
    if (o.shared) sharedDefs();
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
    // The rim's knurling, a ring of fine dashes, dark and light. Below 100 px each dash is a pixel or
    // two (a lot of drawing for a texture that can't be made out), so there it's two plain rings at
    // the dashes' average strength.
    const knurl = (dash, gap, op, colour, extra) => (size < 100
      ? `<circle cx="60" cy="60" r="45.2" fill="none" stroke="${colour}" stroke-opacity="${Math.round((1000 * op * dash) / (dash + gap)) / 1000}" stroke-width="7"/>`
      : `<circle cx="60" cy="60" r="45.2" fill="none" stroke="${colour}" stroke-opacity="${op}" stroke-width="7" pathLength="360" stroke-dasharray="${dash} ${gap}"${extra || ''}/>`);
    return `<svg class="bdg-svg${o.cls ? ` ${o.cls}` : ''}${locked ? ' is-locked' : ''}" viewBox="0 0 120 120" width="${size}" height="${size}" data-tier="${locked ? 'locked' : def.tier}"${label} xmlns="http://www.w3.org/2000/svg">${o.shared ? '' : defs(def.tier, def.cat, shape, locked)}
      <ellipse cx="60" cy="113" rx="34" ry="5.5" fill="url(#ghb-shadow)"/>
      <g${locked ? ' opacity=".62"' : ''}>
        <path d="${sh.outer}" fill="url(#ghb-m-${t})"/>
        <path d="${sh.outer}" fill="none" stroke="url(#ghb-edge)" stroke-width="2.2" transform="translate(60 60) scale(.965) translate(-60 -60)"/>
        ${shape === 'circle' ? `${knurl(0.9, 2.1, locked ? 0.06 : 0.12, '#000')}${knurl(0.7, 2.3, locked ? 0.1 : 0.24, '#fff', ' stroke-dashoffset="-1.2"')}` : ''}
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
      ${locked ? lockMarks(o.goal > 1 && !secret ? pct : null) : ''}
    </svg>`;
  }
  U.badgeSvg = badgeSvg;
  // A locked medal's progress ring (pct, or none) and its lock, in the medal's 120 box.
  const lockMarks = (pct) => `${pct != null ? `<circle cx="60" cy="60" r="57.5" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="3.5"/><circle class="bdg-ring" cx="60" cy="60" r="57.5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${f1(pct * 100)} 100" transform="rotate(-90 60 60)"/>` : ''}
        <g transform="translate(91 91)"><circle r="12.5" fill="#3c424d" stroke="#fff" stroke-width="2"/><g transform="translate(-7.5 -7.75) scale(.625)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyph('lock')}</g></g>`;

  /* ---------------------------------------------------------------- sealed capsules */
  // A badge not opened yet is a glass capsule in its tier's colours, sealed round its middle with a
  // band of the tier's metal: its rarity shows, its name and its medal don't. Like a medal it's an
  // object, the same in light and dark. The glass by tier: deep, body, light, glint.
  const GLASS = { bronze: ['#7a3a12', '#c4713a', '#f2b27c', '#ffe3c6'], silver: ['#56606e', '#98a6b6', '#dbe4ee', '#fff'], gold: ['#8a5a00', '#e0a412', '#ffd75e', '#fff3c4'], platinum: ['#5a5fc4', '#8f9dff', '#c9d6ff', '#f4e6ff'] };
  // The orb sits in the medals' 120 box (centre 60 57, radius 43). Its seam is its equator seen from a
  // little above, so it dips toward you; it splits there when it bursts.
  const seam = (dy) => `M17 ${57 + dy}A43 8.6 0 0 0 103 ${57 + dy}`;
  // Its gradients and clips, in the page's one set (sharedDefs). The glass is clear where you look
  // straight through it and deeper toward its edge, where the light goes through more of it; inside
  // is the light the badge gives off, gathered at the bottom by the glass; platinum has a film of
  // colour, as a soap bubble does.
  const capDefs = () => A().TIER_ORDER.map((t) => { const [deep, body, lt, hi] = GLASS[t]; return `<radialGradient id="ghc-${t}" cx=".42" cy=".36" r=".7" fx=".4" fy=".3">${stops([[0, hi, 0.42], [0.45, lt, 0.4], [0.78, body, 0.66], [0.94, deep, 0.86], [1, deep, 0.95]])}</radialGradient>`; }).join('')
    + `<radialGradient id="ghc-in">${stops([[0, '#fff', 0.95], [0.35, '#fff', 0.5], [1, '#fff', 0]])}</radialGradient>`
    + `<linearGradient id="ghc-rim" x1=".2" y1="0" x2=".8" y2="1">${stops([[0, '#fff', 0.95], [0.3, '#fff', 0.25], [0.55, '#fff', 0], [1, '#fff', 0.8]])}</linearGradient>`
    + `<linearGradient id="ghc-film" x1="0" y1=".1" x2="1" y2=".9">${stops([[0, '#ffc8f0', 0.5], [0.28, '#9fd4ff', 0.12], [0.5, '#d4b0ff', 0.45], [0.72, '#a8fff0', 0.15], [1, '#ffd0f4', 0.5]])}</linearGradient>`
    + '<clipPath id="ghc-orb"><circle cx="60" cy="57" r="43"/></clipPath>'
    + `<clipPath id="ghc-top"><path d="M-5-5H125V57H103A43 8.6 0 0 1 17 57H-5Z"/></clipPath><clipPath id="ghc-bottom"><path d="M-5 125H125V57H103A43 8.6 0 0 1 17 57H-5Z"/></clipPath>`;
  /* A sealed badge's capsule as SVG (with the page's shared gradients). o: { size, part ('top' or
   * 'bottom': that half alone, cut at the seam, for the reveal to split) }. Its solid layer
   * (.bdg-cap-solid) shows with increased contrast and reduced transparency, where the glass is a
   * solid fill. */
  function capsuleSvg(tier, o) {
    o = o || {};
    sharedDefs();
    const t = GLASS[tier] ? tier : 'bronze';
    const size = o.size || 72;
    const big = size >= 44;
    return `<svg class="bdg-cap-svg" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true"><g${o.part ? ` clip-path="url(#ghc-${o.part})"` : ''}>`
      + `<circle class="bdg-cap-solid" cx="60" cy="57" r="43" fill="${GLASS[t][1]}" opacity="0"/><circle cx="60" cy="57" r="43" fill="url(#ghc-${t})"/>${t === 'platinum' ? '<circle cx="60" cy="57" r="43" fill="url(#ghc-film)"/>' : ''}`
      + `<circle cx="60" cy="65" r="27" fill="url(#ghc-in)" opacity=".8"/>${big ? `${sparkle(47, 45, 4.2, 0.85)}${sparkle(72, 66, 2.8, 0.7)}${sparkle(54, 71, 1.9, 0.6)}` : ''}`
      + `<g clip-path="url(#ghc-orb)"><path d="${seam(-0.4)}" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="7.4"/><path d="${seam(0)}" fill="none" stroke="url(#ghb-m-${t})" stroke-width="6.2"/>${big ? `<path d="${seam(-2.6)}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".8"/>` : ''}<ellipse cx="65" cy="88" rx="24" ry="9" fill="url(#ghc-in)" opacity=".7"/></g>`
      + `<ellipse cx="45" cy="35" rx="23" ry="14" fill="url(#ghb-spec)" transform="rotate(-32 45 35)"/><ellipse cx="41.5" cy="31.5" rx="8" ry="4.2" fill="url(#ghc-in)" transform="rotate(-36 41.5 31.5)"/>`
      + `<circle cx="60" cy="57" r="42.2" fill="none" stroke="url(#ghc-rim)" stroke-width="1.6"/><circle class="bdg-cap-edge" cx="60" cy="57" r="43" fill="none" stroke="${GLASS[t][0]}" stroke-opacity=".35" stroke-width=".8"/></g></svg>`;
  }
  // Cracks of light across the glass from a knock near its top, the light inside showing through:
  // the first tap's hairline from the knock, or the second's fissure and the cracks off it. Each is
  // [trunk, twigs], drawn wide in the glass's colour, then in its glint, then a white core.
  const CRACKS = [['M74 30L72 35L73 37L69 42', 'M74 30L78 28L82 29'],
    ['M74 30L72 35L73 37L69 42L70 44L67 49L68 52L64 56L65 59L61 63L62 67L59 71', 'M69 42L64 41L62 43L57 41L54 44M70 44L75 47L79 46L82 49L87 49M64 56L59 56L56 60L51 61M74 30L78 28L82 29L85 26M62 67L66 70L66 75L70 79M73 37L76 38M67 49L63 47M61 63L58 66']];
  function crackSvg(tier, n) {
    const g = GLASS[tier] || GLASS.bronze;
    const [trunk, twigs] = CRACKS[n - 1];
    const line = (d, c, w, op) => `<path d="${d}" stroke="${c}" stroke-width="${w}"${op ? ` stroke-opacity="${op}"` : ''}/>`;
    return `<svg class="bdg-cap-svg" viewBox="0 0 120 120" width="176" height="176" aria-hidden="true"><g clip-path="url(#ghc-orb)" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="74" cy="30" r="${n === 1 ? 8 : 12}" fill="url(#ghc-in)" stroke="none"/>`
      + `${line(trunk, g[1], 6.5, 0.4)}${line(twigs, g[1], 4.4, 0.32)}${line(trunk, g[3], 2.6)}${line(twigs, g[3], 1.7)}${line(trunk, '#fff', 1.15)}${line(twigs, '#fff', 0.7)}</g></svg>`;
  }

  /* ---------------------------------------------------------------- 3D medals */
  // Wherever WebGL works a medal is the 3D one (src/engine/medal3d.js, in the 3D figure's chunk): live
  // in a badge's sheet and as it bursts from its capsule, and everywhere else a still of it, kept on the
  // phone (IndexedDB) under the medal's revision, the size, the theme, the badge and its tier (or the
  // blank). What's kept is read in here, so a screen has it from its first frame without the chunk;
  // drawing new ones and keeping them is src/ui/badges3d.js's, in the chunk, which loads once medals
  // missing one have been on screen a couple of seconds and it's quiet. Until a still is drawn the SVG
  // medal stands in, and it stays where WebGL can't draw.
  // MEDAL_REV: one more whenever a medal's look changes, so phones draw their stills again.
  const MEDAL_REV = 1, SMALL = 72, LARGE = 176; // css px: the stills lists show (scaled), a stage's
  const M = U.medals = { kept: new Map(), want: new Map(), off: false, rev: MEDAL_REV, LARGE };
  const can3d = () => !M.off && !!(U.canDraw3d && U.canDraw3d());
  M.dark = () => String(GH.platform ? GH.platform.currentTheme() : '').startsWith('dark');
  M.px = (css) => Math.round(css * Math.min(3, G.devicePixelRatio || 1));
  M.key = (x, css, dark) => `${MEDAL_REV}|${M.px(css)}|${dark ? 'd' : 'l'}|${x.id}|${x.earned ? x.def.tier : 'lock'}`;
  // What the chunk builds a medal from. back: the lines engraved on an earned one's back.
  M.spec = (def, earned, back) => {
    const secret = !earned && def.secret;
    return { shape: SHAPES[def.shape] ? def.shape : 'circle', glyph: glyph(secret ? 'question' : def.glyph), tier: earned ? def.tier : 'lock', enamel: A().CAT[def.cat].enamel, ribbon: secret ? '' : def.ribbon || '', back: earned ? back : null };
  };
  // What's kept, read in once, in one request: key → object URL.
  let reads = null;
  M.load = () => reads || (reads = new Promise((done) => {
    try {
      const req = G.indexedDB.open('gh-medals', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('m', { keyPath: 'k' }).createIndex('at', 'at'); };
      req.onerror = () => done();
      req.onsuccess = () => {
        const d = req.result, end = () => { d.close(); done(); };
        try {
          const all = d.transaction('m').objectStore('m').getAll(G.IDBKeyRange.bound(`${MEDAL_REV}|`, `${MEDAL_REV}|\uffff`));
          all.onsuccess = () => { for (const r of all.result || []) if (r && r.b && !M.kept.has(r.k)) M.kept.set(r.k, G.URL.createObjectURL(r.b)); end(); };
          all.onerror = end;
        } catch (e) { end(); }
      };
    } catch (e) { done(); } // no IndexedDB: kept for this launch only
  }));
  // Reset everything: they go with the rest (they show what was earned).
  const clear0 = GH.store && GH.store.clear;
  if (clear0) GH.store.clear = function clear() { clear0.apply(this, arguments); M.kept.clear(); M.want.clear(); reads = null; if (M.drop) M.drop(); else try { G.indexedDB.deleteDatabase('gh-medals'); } catch (e) { /* none kept */ } };
  // A kept still: this theme's, else the other's until this one is drawn.
  M.still = (k) => M.kept.get(k) || M.kept.get(k.replace(/\|([dl])\|/, (m, t) => (t === 'd' ? '|l|' : '|d|'))) || null;

  /* A badge's medal for a screen's HTML, size css px: its 3D still when one is kept, else its SVG medal
   * (and the still is asked for). A locked one's progress ring and lock go over its still as they go
   * over the SVG. o: the SVG's own options (sweep), label (what it is, for a screen reader). */
  function medal(x, size, o) {
    o = o || {};
    const k = M.key(x, size > 100 ? LARGE : SMALL, M.dark());
    const ring = x.earned ? null : x.goal > 1 && !x.def.secret ? Math.max(0, Math.min(1, (x.have || 0) / x.goal)) : -1;
    const at = `class="bdg-m" data-mk="${k}" data-size="${size}"${ring != null ? ` data-ring="${ring}"` : ''}${o.label ? ` role="img" aria-label="${U.esc(o.label)}"` : ' aria-hidden="true"'}`;
    const u = can3d() ? M.still(k) : null;
    // (The other theme's still stands in until this theme's is drawn.)
    if (can3d() && !M.kept.has(k)) ask(k, x, size > 100 ? LARGE : SMALL);
    if (u) return `<span ${at}>${stillImg(u, size, ring)}</span>`;
    return `<span ${at}>${badgeSvg(x.def, Object.assign({}, o, { shared: true, earned: x.earned, size, have: x.have, goal: x.goal, label: null }))}</span>`;
  }
  const stillImg = (u, size, ring, fresh) => `<img class="bdg-img${fresh ? ' is-new' : ''}" alt="" src="${u}" width="${size}" height="${size}" decoding="async">${ring != null ? `<svg class="bdg-svg is-locked bdg-marks" viewBox="0 0 120 120" width="${size}" height="${size}">${lockMarks(ring >= 0 ? ring : null)}</svg>` : ''}`;
  // A still that's in goes into each medal on screen waiting for it, fading in over its SVG (in place
  // of the other theme's still, at once).
  M.swap = (k) => {
    const u = M.kept.get(k);
    if (u) for (const h of doc.querySelectorAll(`.bdg-m[data-mk="${k}"]`)) { const i = h.querySelector('.bdg-img'); if (!i || i.getAttribute('src') !== u) h.innerHTML = stillImg(u, h.dataset.size, h.dataset.ring != null ? Number(h.dataset.ring) : null, !i && !U.reduced()); }
  };
  // Asked for: drawn in quiet idle moments while their medals are on screen (src/ui/badges3d.js). Not on
  // a phone with little memory, as the 3D figure isn't warmed up there.
  let soon = 0;
  const shown = () => [...M.want.keys()].some((k) => doc.querySelector(`.bdg-m[data-mk="${k}"]`));
  function ask(k, x, css) {
    if (!M.want.has(k)) M.want.set(k, { k, def: x.def, earned: x.earned, css, dark: k.split('|')[2] === 'd' });
    if (!reads) M.load().then(() => { for (const j of M.want.keys()) if (M.kept.has(j)) { M.want.delete(j); M.swap(j); } });
    if (M.pump) M.pump();
    else if (!soon && !((G.navigator || {}).deviceMemory < 3)) soon = setTimeout(() => U.whenQuiet(() => { soon = 0; if (shown()) GH.lazy('figure3d').then(() => { if (M.pump) M.pump(); }, () => { M.off = true; }); else M.want.clear(); }), 2500);
  }
  // The live medal on a stage (a badge's sheet, the reveal), once the chunk's in: src/ui/badges3d.js.
  // Returns a handle whose spinIn() spins it in if it's ready (and says so), or null (no WebGL, reduced
  // motion: the still).
  function liveMedal(stage, x, o) {
    if (!stage || !can3d() || U.reduced()) return null;
    const h = { ctl: null, dead: false, spinIn: () => !!(h.ctl && h.ctl.spinIn()), destroy() { h.dead = true; if (h.ctl) h.ctl.destroy(); } };
    U.whenCalm(() => GH.lazy('figure3d').then(() => { if (!h.dead && M.live) h.ctl = M.live(stage, x, o); }, () => { M.off = true; }));
    return h;
  }
  // fn, once, as soon as a sheet starts to close (its onClose comes once it has closed, which a busy
  // page can hold up for a while).
  function onClosing(c, fn) {
    const close = c.close;
    c.close = function () { const was = c.closed, r = close.apply(this, arguments); if (!was && c.closed) fn(); return r; };
  }
  // A still drawn now, with reduced motion (a sheet's, where the live one would be).
  const stillNow = (x) => { if (can3d()) GH.lazy('figure3d').then(() => M.draw && M.draw(x), () => {}); };

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
  // A sealed one says no more than its tier and rarity: "Sealed badge, gold, rare. Tap to open",
  // "A rare badge is inside.", and for several "2 Bronze · 1 Gold".
  const capLabel = (def, rest) => `Sealed badge, ${A().TIERS[def.tier].name.toLowerCase()}, ${A().TIERS[def.tier].rarity.toLowerCase()}. ${rest || 'Tap to open'}`;
  const inside = (def) => { const r = A().TIERS[def.tier].rarity.toLowerCase(); return `${/^[aeiou]/.test(r) ? 'An' : 'A'} ${r} badge is inside.`; };
  const tierCount = (defs) => A().TIER_ORDER.map((t) => [t, defs.filter((d) => d.tier === t).length]).filter(([, n]) => n).map(([t, n]) => `${n} ${A().TIERS[t].name}`).join(' · ');
  // Whether a badge is sealed now, from the saved record (a card drawn earlier may be out of date).
  const sealedNow = (id) => { const E = U.S && U.S.achievements && U.S.achievements.earned; return !!(E && own(E, id) && E[id] && E[id].opened === false); };
  // The note on the You tab's card and the gallery's: how many are waiting, and the way to them.
  const openNote = (ids) => `<button type="button" class="bdg-note" data-act="badgeReveal" data-arg="${ids.join(',')}" data-key="bdg-open-note">${U.icon('sparkle', 'sm')}<span class="t-subhead">${ids.length === 1 ? '1 badge to open' : `${ids.length} badges to open`}</span><span class="bdg-note-go t-subhead">Open ${ids.length === 1 ? 'it' : 'them'}</span></button>`;
  // A sealed one's capsule where its medal would be, with a glow in its tier's colour.
  const capArt = (def, size, cls) => `<span class="bdg-cap-art${cls ? ` ${cls}` : ''}" data-tier="${def.tier}">${capsuleSvg(def.tier, { size })}</span>`;
  function nextLine(sum) {
    if (!sum.next) return sum.earned ? 'Every badge you can earn now is yours' : '';
    const it = sum.next;
    return `Next: ${it.def.next || it.def.title.toLowerCase()}${it.goal > 1 && it.have > 0 ? `, ${A().toGo(it)}` : ''}`;
  }
  const sorted = (items) => items.slice().sort((a, b) => (b.day - a.day) || (b.at - a.at) || (A().TIERS[b.def.tier].rank - A().TIERS[a.def.tier].rank));

  /* ---------------------------------------------------------------- the You tab's card */
  // A summary ("12 of 64 · Next: 25 workouts, 4 to go"), a note about badges waiting to be opened
  // ("2 badges to open"), new ones or (once, after 1.6) the ones history already earned, and the shelf:
  // the sealed ones first as capsules, then the best medals, the rarest first (the newest first within
  // a tier), standing on a glass ledge, each with its tier's glow; before any, the next ones to earn.
  function mini(x, day) {
    if (x.sealed) return `<button type="button" class="bdg-mini is-earned is-sealed" data-tier="${x.def.tier}" data-badge="${x.id}" data-key="bdg-mini-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(capLabel(x.def))}">${capArt(x.def, 60, 'is-nudge')}<span class="bdg-mini-title t-caption">${U.esc(A().TIERS[x.def.tier].rarity)}</span></button>`;
    return `<button type="button" class="bdg-mini${x.earned ? ' is-earned' : ''}${x.isNew ? ' is-new' : ''}"${x.earned ? ` data-tier="${x.def.tier}"` : ''} data-badge="${x.id}" data-key="bdg-mini-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(`${x.def.title}, ${x.earned ? `${A().TIERS[x.def.tier].name}, ${earnedWhen(x, day).toLowerCase()}` : progressText(x)}`)}"><span class="bdg-mini-medal">${medal(x, 60)}</span><span class="bdg-mini-title t-caption">${U.esc(x.def.title)}</span></button>`;
  }
  const rank = (x) => A().TIERS[x.def.tier].rank;
  const best = (items) => sorted(items).sort((a, b) => rank(b) - rank(a));
  U.badgeStrip = (S, day) => {
    if (!S || !A()) return '';
    const items = list(S, day);
    const sum = A().summary(S, day, items);
    const ach = S.achievements || {};
    const mig = ach.migrated && ach.migrated.n > 0 && !ach.migrated.seen ? ach.migrated.n : 0;
    const earned = sorted(items.filter((x) => x.sealed)).concat(best(items.filter((x) => x.earned && !x.sealed))).slice(0, 8);
    const shown = earned.length ? earned : items.filter((x) => x.shown && !x.earned && !x.def.secret).sort((a, b) => b.pct - a.pct).slice(0, 4);
    const fresh = items.filter((x) => x.isNew);
    const waiting = A().unopened(S);
    const note = waiting.length ? openNote(waiting)
      : fresh.length ? `<button type="button" class="bdg-note" data-act="badgeReveal">${U.icon('sparkle', 'sm')}<span class="t-subhead">${fresh.length === 1 ? `New badge: ${U.esc(fresh[0].def.title)}` : `${fresh.length} new badges`}</span><span class="bdg-note-go t-subhead">See ${fresh.length === 1 ? 'it' : 'them'}</span></button>`
      : mig ? `<button type="button" class="bdg-note" data-act="openBadges">${U.icon('sparkle', 'sm')}<span class="t-subhead">You've already earned ${U.plural(mig, 'badge')}</span><span class="bdg-note-go t-subhead">See them</span></button>` : '';
    return `<div class="card bdg-strip" data-key="badge-strip">
      <button type="button" class="bdg-strip-head" data-act="openBadges" aria-label="Badges: ${sum.earned} of ${sum.total}${sum.unopened ? `, ${sum.unopened} to open` : ''}. See all">
        <span class="bdg-strip-text"><span class="t-headline">Badges</span><span class="t-footnote rf-muted">${U.roll(sum.earned)} of ${sum.total}${sum.next ? ` · ${U.esc(nextLine(sum))}` : ''}</span></span>
        <span class="bdg-strip-all t-subhead">See all${U.icon('chevron-right', 'sm')}</span>
      </button>
      ${note}
      <div class="bdg-row bdg-shelf" data-hscroll>${shown.map((x) => mini(x, day)).join('')}</div>
    </div>`;
  };
  U.badgeSummary = (S, day) => A().summary(S, day, list(S, day));
  U.act.openBadges = () => U.open('badges');

  /* ---------------------------------------------------------------- the gallery */
  let filter = 'all';
  function tile(x, day) {
    // A sealed one: its capsule in its place, marked New until it's opened; a tap opens the reveal.
    if (x.sealed) {
      return `<button type="button" class="bdg-tile is-earned is-sealed is-new" data-tier="${x.def.tier}" data-badge="${x.id}" data-key="bdg-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(capLabel(x.def))}">
      <span class="bdg-tile-medal">${capArt(x.def, 68, 'is-nudge')}<span class="bdg-new t-caption">New</span></span>
      <span class="bdg-tile-title t-footnote">${U.esc(A().TIERS[x.def.tier].rarity)}</span>
      <span class="bdg-tile-sub t-caption rf-muted">Tap to open</span>
    </button>`;
    }
    const sub = x.earned ? fmtDate(x.day) : x.def.secret ? 'Secret' : progressText(x);
    const title = x.def.secret && !x.earned ? 'Secret badge' : x.def.title;
    return `<button type="button" class="bdg-tile${x.earned ? ' is-earned' : ''}${x.isNew ? ' is-new' : ''}"${x.earned ? ` data-tier="${x.def.tier}"` : ''} data-badge="${x.id}" data-key="bdg-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(`${title}, ${x.earned ? `${A().TIERS[x.def.tier].name}, ${earnedWhen(x, day).toLowerCase()}` : sub}`)}">
      <span class="bdg-tile-medal">${medal(x, 68)}${x.isNew ? '<span class="bdg-new t-caption">New</span>' : ''}</span>
      <span class="bdg-tile-title t-footnote">${U.esc(title)}</span>
      <span class="bdg-tile-sub t-caption rf-muted">${U.esc(sub)}</span>
    </button>`;
  }
  // Where a badge sits in its series: a pip a badge, in its tier's colour, lit once it's earned.
  function pips(x, items) {
    const s = A().seriesOf(x.id);
    if (!s) return '';
    return `<span class="bdg-pips" aria-hidden="true">${s.map((id) => { const i = items.find((y) => y.id === id); return `<i data-tier="${A().byId[id].tier}"${i && i.earned ? ' class="is-on"' : id === x.id ? ' class="is-now"' : ''}></i>`; }).join('')}</span>`;
  }
  // The next one to earn in its series (or one in none).
  const nextInSeries = (x, items) => { const s = A().seriesOf(x.id); return !s || s.find((id) => { const i = items.find((y) => y.id === id); return i && i.shown && !i.earned; }) === x.id; };
  function nextRow(x, items) {
    const T = A().TIERS[x.def.tier];
    return `<button type="button" class="bdg-next" data-badge="${x.id}" data-key="bdg-next-${x.id}" data-act="badgeOpen" data-arg="${x.id}" aria-label="${U.esc(`${x.def.title}, ${T.name}. ${x.def.how} ${progressText(x)}`)}">
      ${medal(x, 52)}
      <span class="bdg-next-text"><span class="t-subhead">${U.esc(x.def.title)}</span><span class="t-footnote rf-muted">${U.esc(x.def.how)}</span>${U.progress(x.pct, `${x.def.title} progress`, 'positive')}${pips(x, items)}</span>
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
        // The closest ones still to earn, each series' next tier only (the ones after it wait their turn).
        const open = shown.filter((x) => !x.earned && !x.def.secret && nextInSeries(x, items)).sort((a, b) => (b.pct - a.pct) || (T[a.def.tier].rank - T[b.def.tier].rank)).slice(0, 10);
        body = open.length ? `<h2 class="sec-title t-title-3">Closest to earning</h2><div class="section"><div class="bdg-nexts" data-key="nexts">${open.map((x) => nextRow(x, items)).join('')}</div></div>`
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
            ${sum.unopened ? openNote(A().unopened(S)) : ''}
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
  function detailBody(x, day, total, items) {
    const def = x.def;
    const secret = def.secret && !x.earned;
    return `<div class="sheet-pad bdg-detail" data-badge="${x.id}">
      <div class="bdg-stage is-detail" data-tier="${x.earned ? def.tier : 'locked'}"><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${medal(x, 148, { sweep: x.earned, label: `${secret ? 'Secret badge' : def.title}${x.earned ? '' : ', locked'}` })}</span></div>
      <p class="bdg-tierline t-caption">${x.earned ? U.esc(tierLine(def)) : secret ? 'Secret' : `${U.esc(A().TIERS[def.tier].name)} · Locked`}</p>
      <h3 class="t-title-2 bdg-title">${U.esc(secret ? 'Secret badge' : def.title)}</h3>
      <p class="t-callout rf-muted bdg-how">${U.esc(secret ? 'A surprise. Keep going and it will find you.' : def.how)}</p>
      ${!x.earned && !secret && x.goal > 1 ? `<div class="bdg-prog">${U.progress(x.pct, 'Progress', 'positive')}<span class="t-footnote rf-muted">${U.esc(progressText(x))}${x.have > 0 ? ` · ${U.esc(A().toGo(x))}` : ''}</span></div>` : ''}
      ${x.earned ? `<p class="t-footnote bdg-when">${U.esc(earnedWhen(x, day))} · ${U.esc(`Badge ${rankOf(x)} of ${total}`)}</p>` : ''}
      ${secret ? '' : seriesBlock(x, items)}
      ${x.earned ? `<div class="bdg-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="badgeShare" data-arg="${x.id}">${U.icon('share')}Share</button></div>` : ''}
    </div>`;
  }
  // Its series: each badge in it, lowest first, this one marked, the earned ones in their metal; and for
  // an earned one, the next one up and how far along it is.
  function seriesBlock(x, items) {
    const s = A().seriesOf(x.id);
    const its = s ? s.map((id) => items.find((i) => i.id === id)).filter((i) => i && i.shown) : [];
    if (its.length < 2) return '';
    const next = its.find((i) => !i.earned);
    const got = its.filter((i) => i.earned).length;
    const line = x.earned && next ? `Next: ${next.def.title}, ${A().TIERS[next.def.tier].name}${next.goal > 1 && next.have > 0 ? ` · ${A().toGo(next)}` : ''}` : !next ? 'You have every one in this series' : '';
    return `<div class="bdg-series">
      <p class="t-caption bdg-tierline">${got} of ${its.length} in this series</p>
      <div class="bdg-series-row" aria-hidden="true">${its.map((i) => `<span class="bdg-series-m${i === x ? ' is-this' : ''}"${i.earned ? ` data-tier="${i.def.tier}"` : ''}>${medal(i, 40)}</span>`).join('')}</div>
      ${line ? `<p class="t-footnote rf-muted">${U.esc(line)}</p>` : ''}
      ${x.earned && next && next.goal > 1 ? U.progress(next.pct, `${next.def.title} progress`, 'positive') : ''}
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
  // A sealed one opens in the reveal instead, right there: its medal is its own to see first.
  U.badgeDetail = (id) => {
    const S = U.S, day = U.today();
    if (!S || !A() || !own(A().byId, id)) return null;
    if (sealedNow(id)) return U.badgeReveal([id]);
    const items = list(S, day);
    ranks(items);
    const x = items.find((i) => i.id === id);
    const total = items.filter((i) => i.shown).length;
    // Its medal live in 3D (drag or flick to spin it; it sways in the light at rest), over its still;
    // with reduced motion, the still.
    let live3d = null;
    return U.sheet({
      title: A().CAT[x.def.cat].name, size: 'fit', cls: 'bdg-sheet', body: detailBody(x, day, total, items),
      after: (c) => {
        const stage = c.el.querySelector('.bdg-stage');
        if (x.earned) spring(stage, x.def, null);
        if (U.reduced()) stillNow(x);
        else live3d = liveMedal(stage, x, { size: 148, sheet: c, interactive: true, sway: true });
        // It stops as the sheet starts to close, and goes once the sheet has slid away.
        onClosing(c, () => setTimeout(() => { if (live3d) live3d.destroy(); }, 400));
      },
      onClose: () => { if (live3d) live3d.destroy(); },
    });
  };
  U.act.badgeOpen = (el) => { const id = el && el.dataset ? el.dataset.arg : null; if (id) U.badgeDetail(id); };

  /* ---------------------------------------------------------------- the reveal */
  // The medal springs in (and spins round once), with a burst in its metal's colours and the badge
  // haptic. With reduced motion it's simply there.
  const BURST = { bronze: ['#e0a577', '#b87333', '#f9dcb8'], silver: ['#e6ebf0', '#9aa4ae', '#ffffff'], gold: ['#ffe08a', '#c9971c', '#fff6cf'], platinum: ['#a1c4fd', '#e0c3fc', '#c2e9fb'] };
  function spring(stage, def, o) {
    if (!stage) return;
    stage.classList.remove('is-in');
    // (A live medal waits for the pop to end before it fades in over it.)
    if (!U.reduced()) { void stage.offsetWidth; stage.classList.add('is-in'); stage.dataset.popAt = Date.now(); } else stage.classList.add('is-still');
    if (o && o.buzz) U.haptic('badge');
    const medal = stage.querySelector('.bdg-medal');
    // Refract 1.4's burst is 8 to 14 beads: the medal's is its biggest, 14.
    if (o && o.burst && medal && G.Refract && G.Refract.burst && !U.reduced()) setTimeout(() => { try { G.Refract.burst(medal, { count: 14, colors: BURST[def.tier], spread: 1.25, size: [6, 12] }); } catch (e) { /* ignore */ } }, 300);
  }
  /* A page of the reveal: the stage, then what it says. A sealed one has its capsule on the stage over
   * the medal, and says its tier, its rarity and "Tap to open"; what the badge is waits in the same
   * place, hidden (from a screen reader too) until it's opened, so the sheet keeps its height as it
   * opens. The capsule: its shadow, then (each a layer the compositor moves) the float that bobs, the
   * shake that wobbles and shakes, its two halves (split at the seam, to fly apart), the cracks of
   * the first and second taps and the light inside. */
  function revealPage(x, day, total) {
    const def = x.def;
    const when = `${earnedWhen(x, day)} · Badge ${rankOf(x)} of ${total}`;
    const copy = (title, how, cls) => `<div class="${cls}">
        <p class="bdg-tierline t-caption">${U.esc(tierLine(def))}</p>
        <h3 class="t-title-1 bdg-title" tabindex="-1">${U.esc(title)}</h3>
        <p class="t-callout rf-muted bdg-how">${U.esc(how)}</p>
        <p class="t-footnote bdg-when">${U.esc(when)}</p>
      </div>`;
    const art = medal(x, 176, { sweep: true, label: def.title });
    if (!x.sealed) {
      return `<section class="bdg-page" data-page="${x.id}" aria-label="${U.esc(def.title)}">
      <div class="bdg-stage" data-tier="${def.tier}"><span class="bdg-rays" aria-hidden="true"></span><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${art}</span></div>
      <div class="bdg-copy">${copy(def.title, def.how, 'bdg-copy-open')}</div>
    </section>`;
    }
    const half = (part) => `<span class="bdg-cap-half is-${part}">${capsuleSvg(def.tier, { size: 176, part })}</span>`;
    const crack = (n) => `<span class="bdg-cap-crack is-${n}">${crackSvg(def.tier, n)}</span>`;
    return `<section class="bdg-page is-sealed" data-page="${x.id}" aria-label="New badge, sealed">
      <div class="bdg-stage is-sealed" data-tier="${def.tier}" data-taps="0">
        <span class="bdg-rays" aria-hidden="true"></span><span class="bdg-glow" aria-hidden="true"></span>
        <span class="bdg-medal" aria-hidden="true">${art}</span>
        <button type="button" class="bdg-cap" data-rf-effect="none" data-act="badgeCrack" data-arg="${x.id}" aria-label="${U.esc(capLabel(def))}">
          <span class="bdg-cap-shadow"></span>
          <span class="bdg-cap-float"><span class="bdg-cap-shake">${half('top')}${half('bottom')}${crack(1)}${crack(2)}<span class="bdg-cap-light"></span></span></span>
        </button>
        <span class="bdg-flash" aria-hidden="true"></span>
      </div>
      <div class="bdg-copy">${copy('Tap to open', inside(def), 'bdg-copy-sealed')}${copy(def.title, def.how, 'bdg-copy-open')}</div>
    </section>`;
  }
  /* The reveal: a sheet with the new badges as pages (with Refract's page dots when there are several:
   * its ink worm stretches to the page picked and splats there), then Share and Done. A sealed badge
   * is a capsule, bobbing gently while it's on screen, and it opens in three taps: it wobbles, then
   * it shakes and cracks with light, then it bursts, light floods out and the medal springs out of
   * it (with reduced motion, one tap and a fade). Several sealed ones offer Open all. An opened one
   * springs in as its page comes into view. A dot (tapped, or scrubbed along the row, or the arrow
   * keys) goes to its page. Opening the sheet counts them as seen; a badge counts as opened once it
   * has burst. ids: the badges to show (default: every one still sealed, then any opened one not
   * shown yet). */
  U.badgeReveal = (ids) => {
    const S = U.S, day = U.today();
    if (!S || !A()) return null;
    const waiting = () => A().unopened(S).concat(A().unseen(S).filter((id) => !sealedNow(id)));
    const want = (ids && ids.length ? ids : waiting()).filter((id) => own(A().byId, id));
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
    // Each page: sealed or not, and how many taps it has taken. Opened ones change what's behind.
    const state = pages.map((x) => ({ sealed: x.sealed, taps: 0, busy: false }));
    let opened = false, io = null, ctl = null, left = false;
    // As it starts to close: the capsules stop, and what shows the badges behind it shows the opened ones
    // as medals. (Its live medal goes once it has slid away.)
    const leave = () => { if (left) return; left = true; if (io) io.disconnect(); if (opened) behind(); };
    // The page showing has its medal live in 3D, ready behind its capsule for when it bursts (one live
    // medal at a time); with reduced motion, its still.
    let live3d = null, liveAt = -1;
    const goLive = (i) => {
      if (liveAt === i) return;
      if (live3d) live3d.destroy();
      liveAt = i;
      const page = pageEls()[i];
      // (A sealed one's still is drawn once it's opened: nothing shows it before.)
      if (U.reduced()) { if (!state[i].sealed) stillNow(pages[i]); live3d = null; return; }
      // Several pages turn with a sideways swipe, so only a page on its own spins by hand.
      live3d = page ? liveMedal(page.querySelector('.bdg-stage'), pages[i], { size: 176, sheet: ctl, interactive: !many }) : null;
    };
    const stillSealed = () => state.filter((s) => s.sealed).length;
    const dotLabel = (x, i) => (state[i].sealed ? `${A().TIERS[x.def.tier].name} badge, sealed` : x.def.title);
    const body = `<div class="bdg-reveal${many ? ' is-many' : ''}" data-cur="${state[0].sealed ? 'sealed' : 'open'}">
      <div class="bdg-pages"${many ? ' data-hscroll' : ''}>${pages.map((x) => revealPage(x, day, total)).join('')}</div>
      ${many ? `<div class="rf-pagedots bdg-dots" role="group" aria-label="Badges">${pages.map((x, i) => `<button type="button" class="rf-dot" aria-label="${U.esc(dotLabel(x, i))}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('')}</div>` : ''}
      <div class="bdg-actions">
        <div class="bdg-acts is-open">
          <button type="button" class="rf-btn rf-glass" data-size="lg" data-act="badgeShareCur">${U.icon('share')}Share</button>
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="badgeDone">Done</button>
        </div>
        <div class="bdg-acts is-sealed"><button type="button" class="rf-btn rf-glass" data-size="lg" data-act="badgeOpenAll"${stillSealed() > 1 ? '' : ' hidden'}>${U.icon('sparkle')}Open all</button></div>
      </div>
    </div>`;
    const pageEls = () => (ctl ? ctl.el.querySelectorAll('.bdg-page') : []);
    // Share and Done for an opened page; for a sealed one, Open all while more than one is.
    const setActions = () => {
      const r = ctl && ctl.el.querySelector('.bdg-reveal');
      if (!r) return;
      r.dataset.cur = state[cur] && state[cur].sealed ? 'sealed' : 'open';
      const all = r.querySelector('[data-act="badgeOpenAll"]');
      if (all) all.hidden = stillSealed() < 2;
    };
    const show = (i, el) => {
      cur = i;
      // The worm follows the dot marked current (Refract watches aria-current).
      for (const [k, d] of [...el.querySelectorAll('.bdg-dots > .rf-dot')].entries()) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); }
      setActions();
      goLive(i);
      if (done.has(i)) return;
      done.add(i);
      // A sealed one waits for its taps.
      if (!state[i].sealed) spring(el.querySelectorAll('.bdg-page')[i].querySelector('.bdg-stage'), pages[i].def, { buzz: true, burst: true });
    };
    // A sealed one opens: it's opened for good at once (saved), then it bursts, the medal springs out
    // with its haptic and burst, and what it is rises in. o.still: opened off screen (Open all), so
    // it springs in like any opened one when its page comes into view.
    const open = (i, o) => {
      const st = state[i];
      const page = pageEls()[i];
      if (!st || !st.sealed || !page) return;
      const x = pages[i];
      st.sealed = false;
      st.busy = true;
      opened = true;
      A().markOpened(S, x.id);
      U.save();
      const stage = page.querySelector('.bdg-stage');
      const cap = stage.querySelector('.bdg-cap');
      const focused = !!cap && doc.activeElement === cap;
      if (io) io.unobserve(stage);
      stage.removeAttribute('data-bob');
      page.classList.remove('is-sealed');
      page.setAttribute('aria-label', x.def.title);
      const medal = stage.querySelector('.bdg-medal');
      if (medal) medal.removeAttribute('aria-hidden');
      if (cap) { cap.disabled = true; cap.setAttribute('aria-hidden', 'true'); }
      const dot = ctl.el.querySelectorAll('.bdg-dots > .rf-dot')[i];
      if (dot) dot.setAttribute('aria-label', x.def.title);
      if (o && o.still) {
        stage.classList.remove('is-sealed');
        stage.classList.add('is-opened');
        st.busy = false;
        done.delete(i);
        return;
      }
      // With reduced motion it simply fades (badges.css): no burst, no flying halves, nothing rising.
      const r = ctl.el.querySelector('.bdg-reveal');
      const calm = U.reduced();
      if (calm) { stage.classList.add('is-fading'); stillNow(x); }
      else { stage.dataset.taps = '3'; for (const n of [r, stage, page]) n.classList.add('is-opening'); }
      // The 3D medal spins out of it when it's ready (else the still or SVG one springs out, and the 3D
      // one takes over once it's still).
      if (live3d && liveAt === i) live3d.spinIn();
      spring(stage, x.def, { buzz: true, burst: true });
      setActions();
      setTimeout(() => {
        st.busy = false;
        stage.classList.remove('is-sealed', 'is-opening', 'is-fading');
        stage.classList.add('is-opened');
        if (!state.some((s) => s.busy)) r.classList.remove('is-opening');
        // A key opened it: focus goes to what it is (its name, which a screen reader then reads).
        if (focused && !ctl.closed) { const h = page.querySelector('.bdg-copy-open .bdg-title'); if (h) h.focus({ preventScroll: true }); }
      }, calm ? 400 : 1000);
    };
    // A tap on a sealed one: a wobble, then a shake and cracks, then it bursts (one tap with reduced
    // motion). Taps come as fast as a finger likes; each moves it on.
    const crack = (i) => {
      const st = state[i];
      const page = pageEls()[i];
      if (!st || !st.sealed || st.busy || !page) return;
      if (U.reduced() || st.taps >= 2) { open(i); return; }
      st.taps++;
      const stage = page.querySelector('.bdg-stage');
      stage.dataset.taps = String(st.taps);
      U.haptic(st.taps === 1 ? 'wobble' : 'crack');
      const cap = stage.querySelector('.bdg-cap');
      if (cap) cap.setAttribute('aria-label', capLabel(pages[i].def, st.taps === 1 ? 'Tap twice more to open' : 'Tap once more to open'));
    };
    // quiet: an opened medal's own badge haptic is the moment, not the sheet opening; a sealed one's
    // moment comes with its taps, so the sheet plays its own as it rises.
    ctl = U.sheet({
      title: many ? `${pages.length} new badges` : 'New badge', size: 'fit', cls: 'bdg-sheet bdg-reveal-sheet', body, quiet: !state[0].sealed,
      after: (c) => {
        const el = c.el;
        const box = el.querySelector('.bdg-pages');
        // A capsule bobs only while it's on screen (and never with reduced motion): its page showing,
        // the sheet open.
        if (G.IntersectionObserver && el.querySelector('.bdg-stage.is-sealed')) {
          io = new G.IntersectionObserver((entries) => { for (const e of entries) e.target.toggleAttribute('data-bob', e.isIntersecting && e.target.classList.contains('is-sealed') && !U.reduced()); });
          for (const st of el.querySelectorAll('.bdg-stage.is-sealed')) io.observe(st);
        }
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
          // A dot picked (Refract's page dots tell which, however it was picked).
          const dots = el.querySelector('.bdg-dots');
          if (dots) dots.addEventListener('rf-select', (e) => { if (e.detail && e.detail.index != null) goTo(e.detail.index); });
        }
        onClosing(c, () => { leave(); setTimeout(() => { if (live3d) live3d.destroy(); }, 400); });
      },
      onClose: () => { leave(); if (live3d) live3d.destroy(); },
    });
    let jumpTo = null;
    const goTo = (n) => {
      const i = Math.max(0, Math.min(pages.length - 1, Number(n) || 0));
      const box = ctl.el.querySelector('.bdg-pages');
      if (!box) return;
      jumpTo = Math.abs(box.scrollLeft - i * box.clientWidth) < 4 ? null : i;
      box.scrollTo({ left: i * box.clientWidth, behavior: U.reduced() ? 'auto' : 'smooth' });
      if (i !== cur) U.haptic('select');
      show(i, ctl.el);
    };
    U.act.badgePage = (el) => goTo(el && el.dataset ? el.dataset.arg : 0);
    U.act.badgeCrack = (el) => { const i = pages.findIndex((x) => el && el.dataset && x.id === el.dataset.arg); if (i >= 0) crack(i); };
    // Open all: this page bursts; the others open as they are, each springing in when it shows.
    U.act.badgeOpenAll = () => {
      state.forEach((s, k) => { if (k !== cur && s.sealed) open(k, { still: true }); });
      if (state[cur].sealed) open(cur); else setActions();
    };
    U.act.badgeShareCur = () => { if (state[cur] && !state[cur].sealed) U.act.badgeShare({ dataset: { arg: pages[cur].id } }); };
    U.act.badgeDone = () => { U.haptic('dismiss'); ctl.close('ok'); };
    return ctl;
  };
  U.act.badgeReveal = (el) => {
    const ids = el && el.dataset && el.dataset.arg ? el.dataset.arg.split(',') : null;
    U.badgeReveal(ids);
  };
  // After a reveal that opened some: the page behind shows their medals (the You tab's card and the
  // gallery re-render once it's calm), and so does the workout's Next screen card.
  function behind() {
    const card = doc.querySelector('#player .bdg-card');
    if (card && card.dataset.arg) {
      const items = list(U.S, U.today());
      const tpl = doc.createElement('template');
      tpl.innerHTML = U.badgeCard(card.dataset.arg.split(',').map((id) => items.find((i) => i.id === id)).filter(Boolean)).trim();
      if (tpl.content.firstElementChild) card.replaceWith(tpl.content.firstElementChild);
    }
    const view = () => (U.els && U.els().screen ? U.els().screen.dataset.view : '');
    if (view() === 'you' || view() === 'badges') {
      const go = () => { if (view() === 'you' || view() === 'badges') U.render(); };
      if (U.whenCalm) U.whenCalm(go); else go();
    }
  }

  /* ---------------------------------------------------------------- the player's own card */
  // The Next screen's card: the newest badge (and how many more), opening the reveal. A sealed one
  // shows its capsule, which drops into the card after the screen arrives, with the badge haptic as
  // it lands; an opened one, its medal springing in (U.badgeSpring). Drawn from the saved record, so
  // once they're opened it shows the medal.
  U.badgeCard = (fresh) => {
    const items = (fresh || []).filter((x) => x && x.def);
    if (!items.length) return '';
    const x = items[items.length - 1];
    const more = items.length - 1;
    const ids = items.map((i) => i.id).join(',');
    if (sealedNow(x.id)) {
      const T = A().TIERS[x.def.tier];
      return `<button type="button" class="card bdg-card is-sealed" data-key="bdg-card" data-act="badgeReveal" data-arg="${ids}" aria-label="${U.esc(more ? `${items.length} new badges to open` : capLabel(x.def))}">
      <span class="bdg-stage is-card is-sealed" data-tier="${x.def.tier}"><span class="bdg-glow" aria-hidden="true"></span>${capArt(x.def, 72)}</span>
      <span class="bdg-card-text">
        <span class="t-caption bdg-tierline">${more ? `${items.length} new badges` : `New badge · ${U.esc(T.name)}`}</span>
        <span class="t-headline">${more ? 'Tap to open them' : 'Tap to open'}</span>
        <span class="t-footnote rf-muted">${U.esc(more ? tierCount(items.map((i) => i.def)) : inside(x.def))}</span>
      </span>
      ${U.icon('chevron-right', null, 'bdg-card-go')}
    </button>`;
    }
    // The others by name, but not one still sealed ("And Day one · 1 still to open").
    const others = items.slice(0, -1);
    const named = others.filter((i) => !sealedNow(i.id)).map((i) => i.def.title);
    const rest = [named.length ? `And ${named.join(', ')}` : '', others.length > named.length ? `${others.length - named.length} still to open` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="card bdg-card" data-key="bdg-card" data-act="badgeReveal" data-arg="${ids}" aria-label="${U.esc(more ? `${items.length} new badges. See them` : `New badge: ${x.def.title}. See it`)}">
      <span class="bdg-stage is-card" data-tier="${x.def.tier}"><span class="bdg-glow" aria-hidden="true"></span><span class="bdg-medal">${medal(Object.assign({}, x, { earned: true }), 72)}</span></span>
      <span class="bdg-card-text">
        <span class="t-caption bdg-tierline">${more ? `${items.length} new badges` : `New badge · ${U.esc(A().TIERS[x.def.tier].name)}`}</span>
        <span class="t-headline">${U.esc(x.def.title)}</span>
        <span class="t-footnote rf-muted">${U.esc(more ? rest : x.def.how)}</span>
      </span>
      ${U.icon('chevron-right', null, 'bdg-card-go')}
    </button>`;
  };
  U.badgeSpring = (root) => {
    const stage = root && root.querySelector('.bdg-card .bdg-stage');
    const card = root && root.querySelector('.bdg-card');
    if (!stage || !card) return;
    if (stage.classList.contains('is-sealed')) { setTimeout(() => U.haptic('badge'), U.reduced() ? 700 : 1150); return; }
    const ids = (card.dataset.arg || '').split(',');
    const def = A().byId[ids[ids.length - 1]];
    if (def) setTimeout(() => spring(stage, def, { buzz: true, burst: true }), 700);
  };

  /* ---------------------------------------------------------------- checking and telling */
  let quietUntil = 0; // set-up's own first moments are quiet
  // Announces new badges: a toast that opens the reveal. Only for badges earned today or yesterday
  // (history found later just waits, sealed). Sealed, it shows the capsule and says the tier and
  // rarity, never a name ("Gold · Rare", Open it); only when every one is opened already does it
  // show the medal and the names.
  function announce(ids) {
    const S = U.S, day = U.today();
    const defs = ids.map((id) => A().byId[id]).filter((d) => d && S.achievements.earned[d.id] && S.achievements.earned[d.id].day >= day - 1);
    if (!defs.length) return;
    setTimeout(() => {
      if (U.S !== S) return;
      const one = defs.length === 1;
      const last = defs[defs.length - 1];
      const sealed = defs.some((d) => sealedNow(d.id));
      const say = sealed ? (one ? tierLine(last) : tierCount(defs)) : one ? last.title : defs.map((d) => d.title).join(', ');
      const t = U.toast(one ? 'New badge' : `${defs.length} new badges`, 'neutral', say, { label: sealed ? (one ? 'Open it' : 'Open them') : (one ? 'See it' : 'See them'), onClick: () => U.badgeReveal(defs.map((d) => d.id)) });
      const ic = t && t.el && t.el.querySelector('.rf-toast-icon');
      if (ic) { ic.innerHTML = sealed ? capsuleSvg(last.tier, { size: 30 }) : badgeSvg(last, { shared: true, earned: true, size: 30 }); ic.classList.add('bdg-toast-medal'); }
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

  // After the app opens: time-based badges (a year in) and anything a closed app didn't get to; and the
  // medals' stills kept on the phone are read in (one request, while it's idle), so You and the
  // gallery have them from their first frame.
  const prevBoot = U.afterBoot;
  U.afterBoot = () => {
    if (prevBoot) prevBoot();
    setTimeout(() => { if (U.S && U.S.profile.onboarded && U.els().onboardEl.hidden) U.badgeCheck('boot'); }, 1500);
    setTimeout(() => (G.requestIdleCallback || setTimeout)(M.load), 2000);
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
  // Badges earned since they were last seen are celebrated where they are, on the You tab, with one
  // badge haptic: a sealed one's capsule shakes itself awake (Refract's wiggle; its beads are for
  // when it bursts open), an opened one's tile bursts. A sheet that opened by itself on arrival would
  // get in the way; the toast, the workout's card and a tap on a badge open the reveal when asked.
  U.celebrateAchievements = (items) => {
    const tiles = (items || []).map((x) => document.querySelector(`#screen [data-badge="${x.id}"]`)).filter(Boolean);
    if (!tiles.length) return;
    U.haptic('badge');
    if (!G.Refract || U.reduced()) return;
    // Each burst within Refract's 8 to 14 beads: one tile gets 12, several get 8 each, three at most.
    for (const t of tiles.slice(0, 3)) {
      const cap = t.querySelector('.bdg-cap-art');
      try {
        if (cap) { if (G.Refract.wiggle) G.Refract.wiggle(cap, { deg: 12, duration: 720 }); } else if (G.Refract.burst) G.Refract.burst(t, { count: tiles.length > 1 ? 8 : 12 });
      } catch (e) { /* ignore */ }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
