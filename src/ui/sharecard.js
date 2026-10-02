/* A badge's share card, drawn on a canvas and shared as an image.
 *
 * The card is 1080×1350 (4:5, what chats and stories show whole) in the app's look: the four-colour
 * glow, a glass card, the medal, its tier and name, how it was earned, and the app's name at the
 * foot. The preview sheet draws it into the very canvas it shows, and Share sends that canvas: only
 * what the preview shows leaves the phone, and only when Share is tapped. The name is off until the
 * person turns it on; the date is on.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const A = () => GH.achievements;
  const B = () => GH.brain;
  const doc = G.document;
  const W = 1080, H = 1350;

  // Both looks, for a card in the other theme than the app's (the app's own is read from its CSS).
  const LOOK = {
    light: {
      bg: '#f1f2f6', label: '#0c0d12', label2: '#4b4f5b', card: 'rgba(255,255,255,0.64)', rim: 'rgba(255,255,255,0.95)', edge: 'rgba(12,13,18,0.07)', shadow: 'rgba(30,34,60,0.16)', glow: 0.78,
      glows: ['rgb(111 227 200 / .55)', 'rgb(155 92 255 / .42)', 'rgb(58 168 255 / .5)', 'rgb(255 126 179 / .34)'],
      tier: { bronze: '#9a5626', silver: '#5a6470', gold: '#946800', platinum: '#5559b8' },
    },
    dark: {
      bg: '#0b0c10', label: '#f4f5f8', label2: '#b4b8c4', card: 'rgba(28,30,38,0.62)', rim: 'rgba(255,255,255,0.16)', edge: 'rgba(255,255,255,0.05)', shadow: 'rgba(0,0,0,0.5)', glow: 0.85,
      glows: ['rgb(70 190 170 / .26)', 'rgb(140 80 255 / .52)', 'rgb(60 130 255 / .5)', 'rgb(240 100 170 / .3)'],
      tier: { bronze: '#eaa974', silver: '#cdd5de', gold: '#f5c84c', platinum: '#bac6ff' },
    },
  };
  const GLOW_VARS = ['--glow-mint', '--glow-violet', '--glow-sky', '--glow-pink'];
  function look(theme) {
    const L = Object.assign({}, LOOK[theme === 'dark' ? 'dark' : 'light']);
    // The glow's colours from the app's own CSS, when the card is in the app's current theme.
    try {
      const cur = String(GH.platform && GH.platform.currentTheme ? GH.platform.currentTheme() : '').startsWith('dark') ? 'dark' : 'light';
      if (cur === theme && doc) {
        const cs = G.getComputedStyle(doc.documentElement);
        const got = GLOW_VARS.map((v) => cs.getPropertyValue(v).trim());
        if (got.every(Boolean)) L.glows = got;
      }
    } catch (e) { /* the defaults */ }
    return L;
  }
  const FONT = '"Host Grotesk", ui-sans-serif, system-ui, sans-serif';
  // The card waits for the app's font, so the name never draws in a fallback.
  function fontsReady() {
    if (!doc || !doc.fonts || !doc.fonts.load) return Promise.resolve();
    return Promise.all([`700 72px ${FONT}`, `400 38px ${FONT}`, `800 46px ${FONT}`].map((f) => doc.fonts.load(f).catch(() => null))).then(() => null);
  }
  function image(src) {
    const img = new G.Image();
    img.decoding = 'async';
    img.src = src;
    return (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; })).then(() => img);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  // Words into at most `max` lines of `width`, the last one cut with an ellipsis if it must be.
  function lines(ctx, text, width, max) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= width || !cur) cur = next;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length > max) {
      let last = out.slice(max - 1).join(' ');
      while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      out.length = max - 1;
      out.push(`${last.trim()}…`);
    }
    return out;
  }
  function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

  /* Draws the card for a badge into `canvas` (a new one if none). o: { theme: 'light' | 'dark',
   * date: text or '' (none), name: text or '' (none) }. Resolves with the canvas. */
  async function draw(def, o, canvas) {
    const cv = canvas || doc.createElement('canvas');
    cv.width = W; cv.height = H;
    const L = look(o.theme);
    const [medal, logo] = await Promise.all([
      image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(U.badgeSvg(def, { earned: true, size: 420, text: false }))}`),
      GH.LOGO ? image(GH.LOGO).catch(() => null) : Promise.resolve(null),
      fontsReady(),
    ]);
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.fillStyle = L.bg;
    ctx.fillRect(0, 0, W, H);
    // The glow: mint and violet, sky and pink, as behind the top of every page in the app.
    ctx.globalAlpha = L.glow;
    for (const [c, x, y, r] of [[L.glows[0], 230, 300, 560], [L.glows[1], 700, 640, 600], [L.glows[2], 880, 220, 520], [L.glows[3], 360, 860, 520]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    // The glass card, with its shadow, a fine rim and a lit top edge.
    ctx.save();
    ctx.shadowColor = L.shadow;
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 26;
    roundRect(ctx, 90, 170, 900, 1010, 64);
    ctx.fillStyle = L.card;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, 91, 171, 898, 1008, 63);
    ctx.lineWidth = 2;
    ctx.strokeStyle = L.rim;
    ctx.stroke();
    const sheen = ctx.createLinearGradient(0, 170, 0, 520);
    sheen.addColorStop(0, o.theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.5)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    roundRect(ctx, 92, 172, 896, 1006, 62);
    ctx.fillStyle = sheen;
    ctx.fill();
    // The medal, in its metal's glow.
    const tierC = { bronze: '227,154,91', silver: '169,184,200', gold: '240,185,42', platinum: '159,180,255' }[def.tier];
    const halo = ctx.createRadialGradient(540, 452, 40, 540, 452, 330);
    halo.addColorStop(0, `rgba(${tierC},0.5)`);
    halo.addColorStop(0.55, `rgba(${tierC},0.16)`);
    halo.addColorStop(1, `rgba(${tierC},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(90, 170, 900, 640);
    ctx.save();
    ctx.shadowColor = o.theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(30,24,10,0.24)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.drawImage(medal, 330, 236, 420, 420);
    ctx.restore();
    // The ribbon's number, in the app's font (an SVG drawn as an image can't use it).
    const S = 420 / 120;
    if (def.ribbon) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round((def.ribbon.length > 3 ? 11.5 : 13) * S)}px ${FONT}`;
      spaced(ctx, 1.4);
      ctx.fillText(def.ribbon, 540, 236 + 95.9 * S);
      spaced(ctx, 0);
    }
    // Tier, name, how it was earned.
    const T = A().TIERS[def.tier];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = L.tier[def.tier];
    ctx.font = `700 34px ${FONT}`;
    spaced(ctx, 6);
    ctx.fillText(`${T.name} · ${T.rarity}`.toUpperCase(), 540, 742);
    spaced(ctx, 0);
    ctx.fillStyle = L.label;
    ctx.font = `700 72px ${FONT}`;
    let y = 826;
    for (const ln of lines(ctx, def.title, 780, 2)) { ctx.fillText(ln, 540, y); y += 82; }
    ctx.fillStyle = L.label2;
    ctx.font = `400 38px ${FONT}`;
    y += 4;
    for (const ln of lines(ctx, def.how, 760, 2)) { ctx.fillText(ln, 540, y); y += 50; }
    // What the person chose to show: when, and who.
    const extra = [o.date, o.name ? `by ${o.name}` : ''].filter(Boolean);
    if (extra.length) {
      ctx.font = `600 34px ${FONT}`;
      ctx.fillStyle = L.label;
      let yy = 1122 - (extra.length - 1) * 48;
      for (const t of extra) { for (const ln of lines(ctx, t, 760, 1)) ctx.fillText(ln, 540, yy); yy += 48; }
    }
    // The app at the foot.
    ctx.textAlign = 'left';
    ctx.font = `700 40px ${FONT}`;
    const name = 'Gradient Health';
    const tw = ctx.measureText(name).width;
    const x0 = Math.round(540 - (76 + 22 + tw) / 2);
    if (logo) {
      ctx.save();
      roundRect(ctx, x0, 1222, 76, 76, 20);
      ctx.clip();
      ctx.drawImage(logo, x0, 1222, 76, 76);
      ctx.restore();
    }
    ctx.fillStyle = L.label;
    ctx.fillText(name, x0 + 98, 1258);
    ctx.font = `400 28px ${FONT}`;
    ctx.fillStyle = L.label2;
    ctx.fillText('Workouts that fit you', x0 + 98, 1294);
    ctx.restore();
    return cv;
  }

  // What's said with the picture: no name and no date unless the card shows them.
  const shareText = (def) => `I earned the ${def.title} badge in Gradient Health.`;
  const firstName = () => (((U.S && U.S.profile && U.S.profile.name) || '').trim().split(/\s+/)[0] || '').slice(0, 30);

  /* The preview sheet: the card as it will look, with Show my name (off), Show the date (on) and
   * light or dark, then Share. */
  U.shareBadge = (id) => {
    const S = U.S;
    const A0 = A();
    if (!S || !A0 || !Object.prototype.hasOwnProperty.call(A0.byId, id)) return null;
    const def = A0.byId[id];
    const rec = S.achievements && S.achievements.earned && S.achievements.earned[id];
    if (!rec) return null;
    const name = firstName();
    const cur = String(GH.platform && GH.platform.currentTheme ? GH.platform.currentTheme() : '').startsWith('dark') ? 'dark' : 'light';
    const st = { name: false, date: true, theme: cur, busy: false };
    const dateText = () => { const d = rec.day; const year = B().dayStr(d).slice(0, 4); return `${rec.approx ? 'Earned by' : 'Earned'} ${B().fmtDay(d, false)}, ${year}`; };
    const opts = () => ({ theme: st.theme, date: st.date ? dateText() : '', name: st.name && name ? name : '' });
    const body = `<div class="sheet-pad sc-share">
        <div class="sc-preview" data-theme-card="${st.theme}"><canvas class="sc-canvas" width="${W}" height="${H}" role="img" aria-label="${U.esc(`The ${def.title} badge card`)}"></canvas></div>
        <ul class="rf-list sc-opts">
          ${name ? U.sw(`Show my name (${name})`, false, 'data-on="scName"') : ''}
          ${U.sw('Show the date', true, 'data-on="scDate"')}
        </ul>
        ${U.choice('scTheme', [['light', 'Light'], ['dark', 'Dark']], st.theme, 'Card colours', ' data-on="scTheme"')}
        <p class="t-footnote rf-muted sc-note">Only this picture goes, and only to the app you pick. ${name ? 'Your name is on it only if you turn it on.' : 'It doesn\'t have your name on it.'}</p>
        <div class="bdg-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="scShare">${U.icon('share')}Share</button></div>
      </div>`;
    let drawing = Promise.resolve();
    const redraw = () => {
      const cv = ctl.el.querySelector('.sc-canvas');
      if (!cv) return drawing;
      drawing = drawing.then(() => draw(def, opts(), cv)).catch((e) => { if (G.console) G.console.error(e); });
      const box = ctl.el.querySelector('.sc-preview');
      if (box) box.setAttribute('data-theme-card', st.theme);
      return drawing;
    };
    const ctl = U.sheet({ title: 'Share badge', size: 'auto', detent: 'large', cls: 'sc-sheet', body, after: () => setTimeout(redraw, 0) });
    U.on.scName = (el, ev, v) => { st.name = !!v; redraw(); };
    U.on.scDate = (el, ev, v) => { st.date = !!v; redraw(); };
    U.on.scTheme = (el, ev, v) => { st.theme = v === 'dark' ? 'dark' : 'light'; redraw(); };
    U.act.scShare = async () => {
      if (st.busy) return;
      st.busy = true;
      try {
        await redraw();
        const cv = ctl.el.querySelector('.sc-canvas');
        const b64 = cv.toDataURL('image/png').split(',')[1];
        const ok = GH.platform && GH.platform.shareImage ? await GH.platform.shareImage(b64, shareText(def), `gradient-health-${def.id.toLowerCase()}.png`) : false;
        if (ok) {
          if (!ctl.closed) ctl.close('ok');
          if (U.badgeEvent) setTimeout(() => U.badgeEvent('sharedBadge'), 400);
        } else if (ok === false) U.toast('Couldn\'t share the picture', 'caution', 'Try again in a moment.');
        // null: the share sheet was closed without sharing, so the preview simply stays.
      } catch (e) {
        if (G.console) G.console.error(e);
        U.toast('Couldn\'t share the picture', 'caution');
      } finally { st.busy = false; }
    };
    return ctl;
  };
  GH.shareCard = { draw, shareText, W, H };
})(typeof window !== 'undefined' ? window : globalThis);
