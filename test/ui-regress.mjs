// Layout regressions from real-phone reports, checked in Chromium at phone size with someone five
// weeks in: chart bounds, tab and button type, cut-off titles, the set-up overlay, sliders, the tour's
// tab bar, the Resume and Cancel buttons, the workout capsule's glass, section spacing, the current
// tab's glass lens, page ends that clear the tab bar, toasts at the bottom (above the workout
// capsule, Today's buttons, the system bar and an open sheet's main button; a swipe down dismisses
// one, and over a sheet a tap reaches it), and cancelling a workout (from Back and from
// Today, with Undo) as a moment of its own: the cancel haptic once, the player folding away or
// Today's buttons pinching away and its card settling back, the toast only after, and short fades
// with reduced motion.
// Usage: node test/ui-regress.mjs [--dark] [--width=360]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root, check, section, done } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
// A read the background sync saved while the app was closed: 50 days back, older than what the
// foreground read covers (40 days), so only folding it in can fill that day.
await page.addInitScript(() => {
  const t = Date.now() - 50 * 86400000;
  window.__pendingDate = new Date(t).toISOString().slice(0, 10);
  window.__pending = [{ id: `${t}.json`, payload: { ok: true, tz: 'UTC', from: new Date(t - 2 * 86400000).toISOString(), to: new Date(t).toISOString(), steps: [{ date: window.__pendingDate, count: 4321 }], errors: {} } }];
});
await page.goto('file://' + join(root, 'dist/gradient-health.html'));
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(); };

section('Charts');
await tab('health');
// Trend charts live in each number's sheet now: Steps over 7 days.
await page.evaluate(() => window.GH.ui.metricSheet('steps'));
await settle();
await page.click('dialog.ms-sheet [data-on="metricRange"] input[value="7"]', { force: true });
await settle();
check('the range is 7 days', await page.evaluate(() => document.querySelector('dialog.ms-sheet [data-on="metricRange"] input[value="7"]').checked));
const charts = await page.evaluate(() => [...document.querySelectorAll('dialog.ms-sheet .ch-plot')].map((p) => { const s = p.querySelector('.ch-svg'); const a = p.getBoundingClientRect(), b = s.getBoundingClientRect(); return { plot: Math.round(a.height), svg: Math.round(b.height), bottom: Math.round(b.bottom - a.bottom) }; }));
check('the metric sheet has its chart', charts.length === 1, charts.length);
check('7-day charts stay inside their plot', charts.every((c) => c.svg <= c.plot + 1 && c.bottom <= 1), JSON.stringify(charts));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Pages don\'t zoom');
// Two fingers spreading apart (a pinch to zoom in) leave the page at its size: the viewport says so
// (src/shell.html), the root takes no pinch (touch-action), and the WebView has zoom off (MainActivity).
{
  const cdp = await ctx.newCDPSession(page);
  const pinch = async (x, y, spread) => {
    let t = Date.now() / 1000;
    const at = (d) => [{ x: x - 24 - d, y, id: 1 }, { x: x + 24 + d, y, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0), timestamp: t });
    for (let i = 1; i <= 12; i++) { t += 0.016; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at((spread / 2) * (i / 12)), timestamp: t }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.016 });
  };
  const vp = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  check('the viewport doesn\'t let the page zoom', /maximum-scale=1(?![\d.])/.test(vp) && /user-scalable=no/.test(vp), vp);
  check('nor does the root take a pinch', await page.evaluate(() => getComputedStyle(document.documentElement).touchAction === 'pan-x pan-y' && getComputedStyle(document.body).touchAction === 'pan-x pan-y'));
  await pinch(195, 420, 200);
  await page.waitForTimeout(500);
  const scale = await page.evaluate(() => window.visualViewport.scale);
  check('a pinch on Today leaves the page at its size', scale === 1, scale);
  await cdp.detach();
}

section('Refract\'s light: still on a phone, and while the page scrolls');
// On a phone the light holds still at its designed angle: Refract never listens to the tilt (core.js
// asks it to, before its first glass registers), since each step it took repainted every rim and had
// every backdrop filtered again, all the time in a hand. While the page scrolls the light holds still
// where the rims are (they mustn't swing round and back), and once the page is still it follows the
// pointer again (a mouse; a finger isn't one).
{
  const r = await page.evaluate(async () => {
    const L = window.Refract.light;
    const glass = document.querySelector('#tabbar .rf-tabbar-bar');
    const frame = () => new Promise((f) => requestAnimationFrame(f));
    const tilt = new Event('deviceorientation');
    Object.defineProperty(tilt, 'beta', { value: 70 });
    Object.defineProperty(tilt, 'gamma', { value: 30 });
    window.dispatchEvent(tilt);
    for (let i = 0; i < 90; i++) await frame();
    const rest = L.current(glass), base = L.current();
    const sc = document.getElementById('screen');
    const top = sc.scrollTop, seen = [];
    for (let i = 0; i < 12; i++) { sc.scrollTop += 40; sc.dispatchEvent(new Event('scroll')); await frame(); seen.push({ mode: L.mode(), at: L.current(glass) }); }
    await new Promise((f) => setTimeout(f, 400));
    await frame();
    const after = L.mode();
    sc.scrollTop = top;
    return { rest, base, seen, after, asks: typeof DeviceOrientationEvent.requestPermission === 'function' };
  });
  check('a tilt doesn\'t turn the rims: they stay at the light\'s resting angle', r.asks && Math.abs(r.rest - r.base) < 2, r);
  check('scrolling holds the light still, where the rims were', r.seen.every((x) => x.mode === 'fixed' && Math.abs(x.at - r.rest) < 2), r.seen.map((x) => `${x.mode} ${Math.round(x.at)}`).join(', '));
  check('then it follows the pointer again (a mouse)', r.after === 'pointer', r.after);
}

section('Type in the tab bar, buttons and chips');
const type = await page.evaluate(() => {
  const label = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label');
  const pill = document.querySelector('.rf-tabbar-pill');
  const lr = label.getBoundingClientRect(), pr = pill.getBoundingClientRect();
  const fs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : null; };
  return { tabSize: getComputedStyle(label).fontSize, inside: lr.left >= pr.left - 0.5 && lr.right <= pr.right + 0.5, btn: fs('#screen .rf-btn:not([data-size])'), chip: fs('#screen .rf-chip') };
});
check('tab labels use the tab bar size', type.tabSize === '11px', type.tabSize);
check('the selected label sits inside its pill', type.inside);
check('buttons keep Refract\'s size', type.btn === null || type.btn !== '16px', type.btn);
check('chips keep Refract\'s size', type.chip === null || type.chip === '13px', type.chip);
for (const t of ['today', 'plan', 'health', 'progress', 'you']) {
  await tab(t);
  const ok = await page.evaluate(() => { const l = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label').getBoundingClientRect(); const p = document.querySelector('.rf-tabbar-pill').getBoundingClientRect(); return l.left >= p.left - 0.5 && l.right <= p.right + 0.5; });
  check(`"${t}" label fits its pill`, ok);
}

section('Titles that used to be cut off');
await tab('you');
await page.click('#screen [data-act="openSettings"]'); await settle();
const cut = await page.evaluate(() => [...document.querySelectorAll('#screen .rf-list-title, #screen .rf-list-sub')].filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth).map((e) => e.textContent.trim()));
check('no row title or description is cut off in Settings', cut.length === 0, cut.join(' | '));
const subs = await page.evaluate(() => { const s = document.querySelector('#screen .rf-list-sub'); return s ? getComputedStyle(s).fontSize : null; });
check('row descriptions use the small size', subs === '13px', subs);

section('Section spacing');
const gaps = await page.evaluate(() => [...document.querySelectorAll('#screen .section > .rf-list-header')].map((h) => { const next = h.nextElementSibling, prev = h.previousElementSibling; const r = h.getBoundingClientRect(); return { below: Math.round(next.getBoundingClientRect().top - r.bottom), above: prev ? Math.round(r.top - prev.getBoundingClientRect().bottom) : null }; }));
check('group headers sit close to their own list', gaps.every((g) => g.below <= 8), JSON.stringify(gaps));
check('and further from the group above', gaps.every((g) => g.above == null || g.above >= g.below + 12), JSON.stringify(gaps));

section('Sliders survive a re-render');
const hasSlider = () => page.evaluate(() => { const t = document.querySelector('#screen .rf-slider-track'); const th = document.querySelector('#screen .rf-slider-thumb'); return !!(t && th && t.getBoundingClientRect().width > 50); });
check('the Glass slider is drawn', await hasSlider());
await page.evaluate(() => { const sw = document.querySelector('#screen [data-k="supersets"]'); sw.click(); });
await settle();
check('still drawn after a setting changes', await hasSlider());
await page.evaluate(() => { const sw = document.querySelector('#screen [data-k="supersets"]'); sw.click(); });
await settle();

section('You → Your answers → Equipment');
await page.click('#topbar [data-act="back"]'); await settle();
const equipment = '#screen [data-act="editStep"][data-arg="equipment"]';
await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), equipment); await settle(300);
await page.click(equipment); await settle(900);
const ob = await page.evaluate(() => { const el = document.getElementById('onboard'); const cs = getComputedStyle(el); return { hidden: el.hidden, opacity: Number(cs.opacity) }; });
check('the equipment editor is visible', !ob.hidden && ob.opacity > 0.95, JSON.stringify(ob));
const one = await page.evaluate(() => ({ title: document.querySelector('.onboard .rf-large-title').textContent, btn: document.querySelector('.ob-actions [data-variant="tinted"]').textContent.trim(), close: !!document.querySelector('.ob-top [aria-label="Close"]') }));
check('it opens just the Equipment screen, with Save and Close', one.title === 'Equipment' && one.btn === 'Save' && one.close, JSON.stringify(one));
await page.evaluate(() => window.__gh.back());
await settle(900);
const back = await page.evaluate(() => ({ hidden: document.getElementById('onboard').hidden, view: document.getElementById('screen').dataset.view }));
check('back closes it and returns to You', back.hidden && back.view === 'you', JSON.stringify(back));
await page.click(equipment); await settle(900);
const again = await page.evaluate(() => { const el = document.getElementById('onboard'); return !el.hidden && Number(getComputedStyle(el).opacity) > 0.95; });
check('it opens again after closing (no invisible overlay)', again);
await page.evaluate(() => window.__gh.back()); await settle(900);
await page.click('#screen [data-act="openSettings"]'); await settle();
check('taps reach the page afterwards', await page.evaluate(() => document.getElementById('screen').dataset.view === 'settings'));
await page.click('#topbar [data-act="back"]'); await settle();
await tab('today');

section('Tour, last page');
await page.evaluate(() => window.GH.ui.showTour());
await settle(900);
// To the last card (its button says Let's go), however many there are.
for (let i = 0; i < 6 && (await page.locator('.tour-sheet [data-act="tourNext"]').innerText()).trim() !== 'Let\'s go'; i++) { await page.click('.tour-sheet [data-act="tourNext"]'); await settle(500); }
const tour = await page.evaluate(() => { const t = document.querySelector('.tour-tabs'); const b = document.querySelector('.tour-sheet .rf-sheet-body'); const r = t.getBoundingClientRect(); return { right: Math.round(r.right), left: Math.round(r.left), vw: innerWidth, scroll: b.scrollWidth - b.clientWidth, labels: [...t.querySelectorAll('.tour-tab-label')].every((l) => l.scrollWidth <= l.clientWidth + 1) }; });
check('the tab bar replica fits on screen', tour.left >= 0 && tour.right <= tour.vw, JSON.stringify(tour));
check('the page doesn\'t scroll sideways', tour.scroll <= 0, tour.scroll);
check('its labels aren\'t cut off', tour.labels);
await page.click('.tour-sheet [data-act="tourNext"]'); await settle(900);

section('The current tab is a bead of glass');
// Refract 1.4's tab bar: the current tab sits on a frosted pill (.rf-tabbar-pill) with a lens over its
// label (.rf-tabbar-lens) that only bends what's under it while lifted (src/styles/controls.css).
await tab('plan');
await settle(900);
const bead = () => page.evaluate(() => {
  const pill = document.querySelector('#tabbar .rf-tabbar-pill'), lens = document.querySelector('#tabbar .rf-tabbar-lens');
  const l = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label').getBoundingClientRect();
  const p = pill.getBoundingClientRect();
  const face = getComputedStyle(pill, '::before');
  return { under: l.left >= p.left - 0.5 && l.right <= p.right + 0.5, fill: face.backgroundColor, lensFilter: getComputedStyle(lens, '::after').backdropFilter, lifted: lens.hasAttribute('data-lifted') };
});
let bd = await bead();
check('at rest the current tab sits on a frosted pill, its lens off', bd.under && bd.fill !== 'rgba(0, 0, 0, 0)' && bd.lensFilter === 'none' && !bd.lifted, JSON.stringify(bd));
await page.evaluate(() => { window.GH.ui.S.profile.prefs.contrast = true; window.GH.ui.applyPrefs(); });
await settle(600);
bd = await bead();
check('with increased contrast the pill is solid and there is no lens', bd.under && bd.lensFilter === 'none', JSON.stringify(bd));
await page.evaluate(() => { window.GH.ui.S.profile.prefs.contrast = false; window.GH.ui.applyPrefs(); });
await settle(600);

// Scrolled to the end, how far the last content sits above whatever covers the bottom.
const endGap = () => page.evaluate(() => {
  const scr = document.getElementById('screen');
  scr.scrollTop = scr.scrollHeight;
  let cover = innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0);
  const tb = document.getElementById('tabbar');
  if (!tb.hasAttribute('data-away')) cover = Math.min(cover, tb.querySelector('.rf-tabbar-bar').getBoundingClientRect().top);
  for (const id of ['accessory', 'float']) { const el = document.getElementById(id); if (el && !el.hidden) for (const c of id === 'float' ? el.children : [el]) cover = Math.min(cover, c.getBoundingClientRect().top); }
  let low = 0;
  for (const e of scr.querySelectorAll('*')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let clip = false;
    for (let q = e.parentElement; q && q !== scr; q = q.parentElement) if (getComputedStyle(q).overflowY !== 'visible' && r.bottom > q.getBoundingClientRect().bottom + 1) { clip = true; break; }
    if (!clip) low = Math.max(low, r.bottom);
  }
  return Math.round(cover - low);
});
section('Page ends clear the bars');
for (const t of ['today', 'plan', 'health', 'progress', 'you']) { await tab(t); const g = await endGap(); check(`${t}: the last card scrolls clear of the bars`, g >= 8, g); }
await page.evaluate(() => window.GH.ui.open('settings'));
await settle(900);
let g = await endGap();
check('settings: the last row clears the system bar', g >= 8, g);
await page.click('#topbar [data-act="back"]'); await settle();
await tab('today');

section('A workout in progress');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
await page.click('.player [data-act="plMin"]').catch(async () => { await page.evaluate(() => window.__gh.back()); });
await settle(700);
check('leaving mid-workout asks first', await page.evaluate(() => !!document.querySelector('dialog.leave-sheet[open] [data-act="plKeep"]')));
await page.click('dialog.leave-sheet [data-act="plKeep"]');
await settle(900);
const resume = await page.evaluate(() => {
  const box = (b) => { if (!b) return null; const r = b.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), text: b.textContent.trim() }; };
  return { main: box(document.querySelector('#float .btn-main')), cancel: box(document.querySelector('#float [data-act="cancelWorkout"]')), w: innerWidth, player: !document.querySelector('.player').hidden };
});
check('Keep it for later goes back to Today', !resume.player && /Resume workout/.test((resume.main || {}).text || ''), JSON.stringify(resume));
check('with Cancel beside Resume, both on screen', resume.cancel && resume.main && resume.cancel.l >= 0 && resume.main.r <= resume.w && resume.cancel.r <= resume.main.l, JSON.stringify(resume));
for (const t of ['health', 'today', 'plan', 'health']) await tab(t);
const cap = await page.evaluate(() => { const a = document.getElementById('accessory'); const layer = a.querySelector(':scope > .rf-lens-layer'); const cs = layer ? getComputedStyle(layer) : getComputedStyle(a); return { shown: !a.hidden, layer: !!layer, bg: cs.backgroundColor }; });
check('the workout capsule shows on other tabs', cap.shown);
check('its glass layer is still there after switching tabs', cap.layer, JSON.stringify(cap));
g = await endGap();
check('with the capsule showing, the last card still scrolls clear', g >= 8, g);

section('Sheets');
await page.evaluate(() => window.GH.ui.showWhatsNew());
await settle(900);
const sh = await page.evaluate(() => { const a = document.activeElement; return { cls: a && a.className, ring: !!(a && a.matches('.rf-sheet-grabber')) }; });
check('a sheet the app opens by itself focuses its content, not the grabber (no blue ring)', /rf-sheet-body/.test(sh.cls || '') && !sh.ring, JSON.stringify(sh));
// Pulled up to large, a sheet sets the page back. Open-source licenses is long enough for a large
// detent whatever the release notes say: What's new fits in medium whole when they're short, and a
// sheet that fits there has no large detent (src/ui/sheet.js).
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);
await page.evaluate(() => window.GH.ui.act.licensesSheet());
await settle(900);
await page.evaluate(() => window.GH.ui.topSheet().detent('large'));
await settle(900);
const big = await page.evaluate(() => ({ detent: (document.querySelector('dialog[open][data-detent]') || { getAttribute: () => null }).getAttribute('data-detent'), receded: document.getElementById('app').hasAttribute('data-receded') }));
check('a sheet at full height sets the page back', big.detent === 'large' && big.receded, JSON.stringify(big));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);
check('and closing it brings the page forward again', await page.evaluate(() => !document.getElementById('app').hasAttribute('data-receded')));

section('Toasts at the bottom');
// They sat over the bar's buttons and the page's title at the top. Now they come up from the bottom,
// above whatever is down there and clear of the system bar (the stand-in's is 20 px), and take a tap
// and a swipe down, over an open sheet too. (Each one's countdown is held, as a finger on it holds
// it, so a slow moment here can't end it before it's measured.)
{
  const say = (title, undo) => page.evaluate(([title, undo]) => {
    window.GH.ui.toast(title, 'positive', 'Counted for today.', undo ? { label: 'Undo', onClick: () => { window.__undid = (window.__undid || 0) + 1; } } : undefined);
    for (const b of document.querySelectorAll('.rf-toast-close')) for (const a of b.getAnimations()) if (a.id === 'rf-countdown') a.pause();
  }, [title, undo]);
  const box = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }, sel);
  const newest = () => page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast:not([data-leaving])')].pop(); if (!t) return null; const r = t.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight }; });
  const clear = async () => { await page.evaluate(() => window.Refract.toast.dismissAll()); await settle(900); await page.evaluate(() => { for (const t of document.querySelectorAll('.rf-toast')) t.remove(); }); };
  // Health, with the workout capsule over the tab bar.
  await tab('health');
  await say('Walk logged');
  await settle(900);
  let t = await newest();
  const capsule = await box('#accessory'), top = await box('#topbar');
  check('over the workout capsule, just above it, and nowhere near the bar at the top', t && capsule && t.bottom <= capsule.top && capsule.top - t.bottom < 30 && t.top > top.bottom + 200, { t, capsule, top });
  await clear();
  // Today: above its floating buttons (Resume and Cancel), clear of the title.
  await tab('today');
  await say('Walk logged');
  await settle(900);
  t = await newest();
  const fl = await box('#float'), title = await box('#screen > .rf-large-title');
  check('on Today, just above the floating buttons, clear of the title', t && fl && t.bottom <= fl.top && fl.top - t.bottom < 30 && (!title || t.top > title.bottom), { t, fl, title });
  // A page pushed on top: the tab bar goes, and the toast that's showing glides down with it.
  await page.evaluate(() => window.GH.ui.open('settings'));
  await settle(900);
  const low = await newest();
  check('a page pushed on top: it goes down to just above the system bar', low && low.bottom <= low.h - 20 && low.bottom > low.h - 20 - 30 && low.top > t.top, { low, before: t });
  // A swipe down dismisses it (real touches).
  const cdp = await ctx.newCDPSession(page);
  const x = Math.round(width / 3), y0 = Math.round((low.top + low.bottom) / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + i * 11, id: 1 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(900);
  check('a swipe down dismisses it', !(await newest()));
  await page.click('#topbar [data-act="back"]'); await settle();
  // Over an open sheet: above its main button, and a tap reaches the toast, not the sheet under it.
  await page.evaluate(() => window.GH.ui.sheet({ title: 'Toast test', size: 'fit', body: '<div class="sheet-pad"><p class="t-body">Something to save.</p><button type="button" class="rf-btn" data-variant="filled" data-size="lg" id="ttSave">Save</button></div>' }));
  await settle(900);
  await say('Saved', true);
  await settle(900);
  t = await newest();
  const save = await box('#ttSave');
  check('over an open sheet, just above its main button', t && save && t.bottom <= save.top && save.top - t.bottom < 30, { t, save });
  const hit = await page.evaluate(() => { const b = [...document.querySelectorAll('.rf-toast')].pop().querySelector('.rf-btn:not(.rf-toast-close)'); const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const at = document.elementFromPoint(x, y); return { x, y, toast: !!(at && at.closest('.rf-toast')) }; });
  await page.mouse.click(hit.x, hit.y);
  await settle(600);
  const after = await page.evaluate(() => ({ undid: window.__undid || 0, sheet: !!document.querySelector('dialog.gh-sheet[open]:not([data-closing])') }));
  check('and its Undo takes the tap (the sheet stays open)', hit.toast && after.undid === 1 && after.sheet, { hit, after });
  await page.evaluate(() => window.GH.ui.closeSheets());
  await settle(900);
  check('when the sheet goes, the toaster is back on the page', await page.evaluate(() => { const t = document.querySelector('.rf-toaster[data-position="bottom"]'); return !t || t.parentNode === document.body; }));
  await clear();
}

section('Cancelling a workout');
await tab('today');
const toast = () => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '));
// Until fn is true in the page (its clock runs on meanwhile), for up to ms.
const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { if (await page.evaluate(fn)) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(50); } };
// It's a moment of its own: the cancel haptic as it's tapped, then motion. Taps sel (a click in the
// page, so the first frame after it can be read) and reads the animations it started there: on the
// session card, on the copy of the floating buttons dissolving, on the player and its parts: their
// properties, and how long each takes (with its delay).
const cancelMoment = (sel) => page.evaluate(async (sel) => {
  window.__haptics.length = 0;
  const before = new Set(document.getAnimations());
  const card = document.querySelector('#screen [data-key="main"]');
  document.querySelector(sel).click();
  const toastAtOnce = !!document.querySelector('.rf-toast');
  await new Promise((r) => requestAnimationFrame(() => r()));
  const props = (a) => Object.keys(a.effect.getKeyframes()[0] || {}).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort().join();
  const fresh = document.getAnimations().filter((a) => !before.has(a) && a.effect && a.effect.target && !a.transitionProperty);
  const on = (test) => fresh.filter((a) => test(a.effect.target)).map((a) => ({ props: props(a), ms: a.effect.getTiming().duration + (a.effect.getTiming().delay || 0) }));
  return {
    toastAtOnce,
    card: on((t) => t === card),
    copy: on((t) => !!(t.closest && t.closest('.float-actions.motion-copy'))),
    floatHidden: document.getElementById('float').hidden,
    haptics: window.__haptics.slice(),
  };
}, sel);
// The player's own: taps the open dialog's Cancel workout, and reads the player's panel and the
// parts on it the moment it starts to close (and whether the toast is there yet).
const playerMoment = () => page.evaluate(async () => {
  window.__haptics.length = 0;
  for (const t of document.querySelectorAll('.rf-toast')) t.remove(); // (an earlier one, done with)
  const pl = document.getElementById('player');
  const closing = new Promise((resolve) => {
    const mo = new MutationObserver(() => { if (pl.hasAttribute('data-closing') || pl.hidden) { mo.disconnect(); resolve(); } });
    mo.observe(pl, { attributes: true, attributeFilter: ['data-closing', 'hidden'] });
    setTimeout(() => { mo.disconnect(); resolve(); }, 4000);
  });
  const d = document.querySelector('dialog.rf-dialog[open]');
  [...d.querySelectorAll('button')].find((b) => /Cancel workout/.test(b.textContent)).click();
  await closing;
  const props = (a) => Object.keys(a.effect.getKeyframes()[0] || {}).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).sort().join();
  const list = (el) => el.getAnimations().filter((a) => !a.transitionProperty).map((a) => ({ props: props(a), ms: a.effect.getTiming().duration + (a.effect.getTiming().delay || 0) }));
  return { closing: pl.hasAttribute('data-closing'), panel: list(pl), parts: [...pl.children].map(list), haptics: window.__haptics.slice(), toastAtOnce: !!document.querySelector('.rf-toast') };
});
const after = () => page.evaluate(() => ({
  active: !!window.GH.ui.S.active,
  player: !document.querySelector('.player').hidden,
  eyebrow: ((document.querySelector('#screen [data-key="main"] .rf-card-eyebrow') || {}).textContent || '').trim(),
  floats: [...document.querySelectorAll('#float [data-act]')].map((b) => b.dataset.act).join(),
  copies: document.querySelectorAll('.motion-copy').length,
  dialog: !!document.querySelector('dialog.rf-dialog[open]'),
  toast: [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '),
}));
const only = (list, props) => list.length > 0 && list.every((a) => a.props === props);
const toastUndo = () => page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].pop(); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
let m = await cancelMoment('#float [data-act="cancelWorkout"]');
check('Today\'s Cancel: the cancel haptic, once', m.haptics.join() === 'cancel', m.haptics);
check('its buttons pinch away: a copy of them dissolves where they were (Refract\'s dematerialize), the row hidden at once', m.floatHidden && m.copy.some((a) => /--rf-mat/.test(a.props)), m);
check('the session card folds, by transform and opacity only', only(m.card, 'opacity,transform') && m.card.every((a) => a.ms <= 400), m.card);
check('and the toast waits for the moment', !m.toastAtOnce);
await until(() => !!document.querySelector('.rf-toast'));
const c1 = await after();
check('Today\'s Cancel ends a workout with nothing done, without asking', !c1.active && !c1.dialog, JSON.stringify(c1));
check('the card settles back to not started, and today\'s workout can be started again', /^Workout/.test(c1.eyebrow) && c1.floats === 'toggleShort,startWorkout', JSON.stringify(c1));
await until(() => !document.querySelector('.motion-copy'));
check('then the toast says so and offers Undo, with nothing left over', /Workout cancelled/.test(await toast()) && /Undo/.test(await toast()) && (await after()).copies === 0, await toast());
await toastUndo();
await settle(900);
check('Undo puts it back', await page.evaluate(() => !!window.GH.ui.S.active && !!document.querySelector('#float [data-act="resumeWorkout"]')));
// With sets done: Back offers finishing too, and cancelling asks first.
await page.click('#float [data-act="resumeWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
await page.evaluate(() => { const S = window.GH.ui.S; const a = S.active; while (a.idx < a.steps.length && a.steps[a.idx].kind !== 'set') a.idx++; a.idx++; window.GH.store.save(S); });
await page.evaluate(() => window.__gh.back());
await settle(700);
const leave = await page.evaluate(() => { const d = document.querySelector('dialog.leave-sheet[open]'); return d ? { acts: [...d.querySelectorAll('[data-act]')].map((b) => b.dataset.act), text: d.textContent } : null; });
check('Back with a set done offers keep, finish or cancel', leave && ['plKeep', 'plFinishNow', 'plCancel'].every((a) => leave.acts.includes(a)) && /1 of \d+ sets done/.test(leave.text), JSON.stringify(leave && leave.acts));
await page.click('dialog.leave-sheet [data-act="plCancel"]');
await settle(900);
const ask = await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); return d ? d.textContent : ''; });
check('cancelling with sets done asks first, with a clear way out', /Cancel this workout\?/.test(ask) && /Keep it/.test(ask) && /1 set you did/.test(ask), ask);
m = await playerMoment();
check('its Cancel workout plays the cancel haptic, once (not heavy as well)', m.haptics.join() === 'cancel', m.haptics);
check('the player folds away: what\'s on it drops and shrinks (transform and opacity), then the panel dissolves into Today', m.closing && m.parts.length >= 2 && m.parts.every((p) => only(p, 'opacity,transform')) && only(m.panel, 'opacity') && [...m.panel, ...m.parts.flat()].every((a) => a.ms <= 400), m);
check('and the toast waits for it', !m.toastAtOnce);
await until(() => !!document.querySelector('.rf-toast'));
const c2 = await after();
check('then the workout is gone and the player closed', !c2.active && !c2.player && /^Workout/.test(c2.eyebrow) && c2.floats === 'toggleShort,startWorkout', JSON.stringify(c2));
check('the toast offers Undo once it\'s gone', /Workout cancelled/.test(c2.toast) && /Undo/.test(c2.toast), c2.toast);
// Undo brings back the same workout (not a copy, which broke every set after it).
await toastUndo();
await settle(900);
await page.click('#float [data-act="resumeWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
const undone = await page.evaluate(() => {
  const a = window.GH.ui.S.active;
  if (!a) return { err: 'no workout' };
  while (a.idx < a.steps.length && a.steps[a.idx].kind !== 'set') a.idx++;
  const n = () => a.logs.reduce((k, l) => k + l.sets.length, 0);
  const before = n();
  try { window.GH.ui.act.plDone(); } catch (e) { return { err: e.message }; }
  return { logged: n() - before };
});
check('after Undo, sets log as usual', undone && !undone.err && undone.logged === 1, JSON.stringify(undone));
// Reduced motion: the same moment as short fades only (opacity, 150 ms at most), from the player
// (its menu's Cancel workout, then the question, as a set is done) and from Today.
await page.emulateMedia({ reducedMotion: 'reduce' });
await settle(300);
await page.click('.player [data-act="plMenu"]');
await settle(600);
await page.click('.gh-menu [data-act="plCancel"]');
await until(() => !!document.querySelector('dialog.rf-dialog[open]'));
await settle(300);
m = await playerMoment();
check('reduced motion, from the player: the panel only fades, briefly, and nothing on it moves', only(m.panel, 'opacity') && m.panel.every((a) => a.ms <= 150) && m.parts.every((p) => !p.length), m);
await until(() => !!document.querySelector('.rf-toast'));
let r = await after();
check('and it ends the same: no workout, the player closed, Today ready to start, the toast with Undo', !r.active && !r.player && /^Workout/.test(r.eyebrow) && r.floats === 'toggleShort,startWorkout' && /Undo/.test(r.toast), JSON.stringify(r));
await page.evaluate(() => { for (const t of document.querySelectorAll('.rf-toast')) t.remove(); });
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
await page.evaluate(() => window.GH.ui.act.plKeep());
await settle(900);
m = await cancelMoment('#float [data-act="cancelWorkout"]');
check('reduced motion, from Today: the buttons and the card only fade, briefly', m.haptics.join() === 'cancel' && only(m.card, 'opacity') && only(m.copy, 'opacity') && [...m.card, ...m.copy].every((a) => a.ms <= 150) && !m.toastAtOnce, m);
await until(() => !!document.querySelector('.rf-toast'));
r = await after();
check('and ends the same', !r.active && /^Workout/.test(r.eyebrow) && r.floats === 'toggleShort,startWorkout' && /Undo/.test(r.toast) && r.copies === 0, JSON.stringify(r));
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.evaluate(() => { const U = window.GH.ui; if (U.S.active) { U.act.plKeep(); window.GH.brain.cancelWorkout(U.S); window.GH.store.save(U.S); } for (const t of document.querySelectorAll('.rf-toast')) t.remove(); U.render(); });
await settle(700);

section('How it works');
await page.evaluate(() => window.GH.ui.open('science'));
await settle(900);
await page.click('#screen [data-on="sciShow"] [data-arg="recovery"]');
await settle(600);
await page.evaluate(() => window.GH.ui.back());
await settle(700);
// A "Why" link to a training rule while Recovery is picked.
await page.evaluate(() => window.GH.ui.open('science', 'volume'));
await settle(1500);
const sci = await page.evaluate(() => ({ sheets: document.querySelectorAll('dialog.sci-sheet[open]').length, row: !!document.querySelector('#screen #sci-volume'), shift: document.getElementById('app').scrollLeft }));
check('a Why link opens its rule once, with the rule\'s group showing', sci.sheets === 1 && sci.row, JSON.stringify(sci));
check('and nothing scrolls the page sideways', sci.shift === 0, JSON.stringify(sci));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);
check('also after the sheet closes', await page.evaluate(() => document.getElementById('app').scrollLeft === 0 && document.querySelector('#screen h1').getBoundingClientRect().left >= 0));
await page.evaluate(() => { while (window.GH.ui.back()) { /* back to the tab */ } });
await settle(700);

section('Background sync');
const bgBoot = await page.evaluate(() => { const d = window.GH.brain.dayFromStr(window.__pendingDate); const day = window.GH.ui.S.health.days[d]; return { steps: day && day.steps, done: window.__pendingDone.length, left: window.__pending.length }; });
check('a read saved while the app was closed is folded in when it starts', bgBoot.steps === 4321, JSON.stringify(bgBoot));
check('and marked done', bgBoot.done >= 1 && bgBoot.left === 0, JSON.stringify(bgBoot));
await page.evaluate(() => window.GH.ui.open('settings'));
await settle(900);
const bgRow = () => page.evaluate(() => {
  const title = [...document.querySelectorAll('#screen .rf-list-title')].find((e) => e.textContent === 'Sync in the background');
  if (!title) return null;
  const row = title.closest('.rf-list-row');
  const sw = row.querySelector('input[role="switch"]');
  return { sub: (row.querySelector('.rf-list-sub') || {}).textContent || '', sw: !!sw, on: !!(sw && sw.checked), allow: !!row.querySelector('[data-act="hcBgAllow"]') };
});
let bgr = await bgRow();
check('Settings shows background sync on, with when it last read', bgr && bgr.sw && bgr.on && /^Every 15 minutes · last at \d{1,2}:\d{2} (am|pm)$/.test(bgr.sub), JSON.stringify(bgr));
await page.evaluate(() => document.querySelector('#screen [data-on="hcBgToggle"]').click());
await settle(600);
bgr = await bgRow();
check('switching it off stops the job and says so', bgr && !bgr.on && /^Off\. /.test(bgr.sub) && await page.evaluate(() => !window.__bg.on && !window.__bg.scheduled), JSON.stringify(bgr));
await page.evaluate(() => document.querySelector('#screen [data-on="hcBgToggle"]').click());
await settle(600);
check('and back on', await page.evaluate(() => window.__bg.on && window.__bg.scheduled) && (await bgRow()).on);
await page.evaluate(() => { window.__bg.granted = false; window.GH.ui.render(); });
await settle(600);
bgr = await bgRow();
check('without the permission it says so, with Allow', bgr && !bgr.sw && bgr.sub === 'Needs permission' && bgr.allow, JSON.stringify(bgr));
await page.click('#screen [data-act="hcBgAllow"]');
await settle(900);
bgr = await bgRow();
check('Allow asks for it, and the switch comes back', bgr && bgr.sw && bgr.on && await page.evaluate(() => window.__bg.granted), JSON.stringify(bgr));
await page.evaluate(() => { window.__bg.error = 'HealthConnectException(2)'; window.__bg.lastRun = Date.now(); window.GH.ui.render(); });
await settle(600);
check('a failed read says so', (await bgRow()).sub === 'Every 15 minutes · the last try didn\'t work', (await bgRow()).sub);
await page.evaluate(() => { window.__bg.supported = false; window.GH.ui.render(); });
await settle(600);
bgr = await bgRow();
check('with an older Health Connect it says what it needs', bgr && !bgr.sw && bgr.sub === 'Needs Android 15 or a newer Health Connect', JSON.stringify(bgr));
// A background read that finishes while the app is open (newer than the last sync) is folded in
// right away.
const late = await page.evaluate(() => {
  Object.assign(window.__bg, { supported: true, error: null, lastRun: Date.now(), lastOk: Date.now() });
  const t = Date.now();
  const date = new Date(t).toISOString().slice(0, 10);
  window.__pending.push({ id: `${t}.json`, payload: { ok: true, tz: 'UTC', from: new Date(t - 2 * 86400000).toISOString(), to: new Date(t).toISOString(), steps: [{ date, count: 5432 }], errors: {} } });
  window.__gh.onHealthBackground(window.AndroidBridge.hcBackground());
  const day = window.GH.ui.S.health.days[window.GH.brain.dayFromStr(date)];
  return { steps: day && day.steps, left: window.__pending.length };
});
check('a read finishing while the app is open is folded in', late.steps === 5432 && late.left === 0, JSON.stringify(late));
await settle(600);
check('and the row shows it', /^Every 15 minutes · last at /.test((await bgRow()).sub), (await bgRow()).sub);
await page.click('#topbar [data-act="back"]'); await settle();

section('Reps left, answered after the rest');
// With the rest over and the question still open, an answer stays on screen and Continue (right
// under it) moves on: the screen never changes under a finger already on its way to Continue, which
// would land on the next set's Done and log it.
// Tomorrow: today's workout was cancelled with a set done above, so today counts as done.
await page.clock.fastForward('24:00:00');
await settle(700);
await tab('today');
await page.evaluate(() => window.GH.ui.act.startWorkout());
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
const asked = await page.evaluate(() => {
  const U = window.GH.ui, a = U.S.active;
  const k = a.steps.findIndex((st, i) => i >= a.idx && st.kind === 'set' && st.askRir);
  if (k < 0) return { err: 'no set asks' };
  a.idx = k;
  U.act.plDone();
  U.act.plSkipRest();
  const p = document.querySelector('.player');
  // 1.13: four answers, each label whole inside its segment, the control inside its card.
  const segs = [...p.querySelectorAll('.pl-rir .rf-segment')];
  const box = p.querySelector('.pl-rir').getBoundingClientRect(), ctl = p.querySelector('.pl-rir .rf-segmented').getBoundingClientRect();
  const fits = segs.every((s) => s.scrollWidth <= s.clientWidth + 1) && ctl.left >= box.left - 0.5 && ctl.right <= box.right + 0.5;
  return { rir: !!p.querySelector('.pl-rir'), cont: !!p.querySelector('.pl-actions [data-act="plContinue"]'), idx: a.idx, k, opts: segs.map((s) => `${s.querySelector('input').value}:${s.textContent.trim()}`).join(' '), fits };
});
check('the rest over with the question open: the question and Continue', asked.rir && asked.cont, JSON.stringify(asked));
check('it offers 0, 1-2, 3 and 4+, each fitting its segment', asked.opts === '0:0 12:1-2 3:3 4:4+' && asked.fits, JSON.stringify(asked));
await page.click('.player .pl-rir input[value="12"]', { force: true });
await settle(900);
const stayed = await page.evaluate((k) => {
  const p = document.querySelector('.player');
  const a = window.GH.ui.S.active;
  const log = a.logs[a.session.items.concat(a.session.extras).indexOf(a.steps[k].item)];
  return { picked: !!p.querySelector('.pl-rir input[value="12"]:checked'), cont: !!p.querySelector('.pl-actions [data-act="plContinue"]'), idx: a.idx, rir: log && log.rir, aim: log && log.aim };
}, asked.k);
check('an answer stays on screen with Continue (it doesn\'t move on by itself)', stayed.picked && stayed.cont && stayed.idx === asked.idx, JSON.stringify(stayed));
check('and it\'s kept with the exercise\'s aim', stayed.rir === '12' && ['12', '13', '23', '24'].includes(stayed.aim), JSON.stringify(stayed));
await page.click('.player [data-act="plContinue"]');
await settle(700);
const moved = await page.evaluate(() => { const p = document.querySelector('.player'); return { rir: !!p.querySelector('.pl-rir'), done: !!p.querySelector('.pl-actions [data-act="plDone"], .pl-actions [data-act="plStartTimer"]') }; });
check('and Continue moves on to the next set', !moved.rir && moved.done, JSON.stringify(moved));
await page.evaluate(() => { const U = window.GH.ui; U.act.plKeep(); window.GH.brain.cancelWorkout(U.S); window.GH.store.save(U.S); U.render(); });
await settle(700);

section('The rest running out holds the screen still');
// When a rest runs out (or is skipped) with the question still open, nothing on the screen moves: the
// ring stays (empty, 0:00) with "Rest over" in its buttons' row, the question and Up next stay put,
// and Continue comes into the place held for it. (Before, the ring and buttons gave way to a line of
// text and everything under them jumped up 100 to 300 px, a layout shift of 0.14.)
await page.evaluate(() => window.GH.ui.act.startWorkout());
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
const where = () => page.evaluate(() => {
  const p = document.querySelector('.player');
  const top = (s) => { const e = p.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top * 2) / 2 : null; };
  const acts = p.querySelector('.pl-actions');
  return {
    ring: top('.pl-timer .rf-ring'), row: top('.pl-rest-btns'), rir: top('.pl-rir'), next: top('.pl-next-row'),
    actsTop: Math.round(acts.getBoundingClientRect().top * 2) / 2,
    over: !!p.querySelector('.pl-timer.is-over') && /Rest over/.test(p.querySelector('.pl-rest-btns').textContent),
    count: (p.querySelector('.pl-count') || {}).textContent, cont: !!p.querySelector('.pl-actions [data-act="plContinue"]'),
    held: !!p.querySelector('.pl-actions .pl-actions-hold'), skip: !!p.querySelector('[data-act="plSkipRest"]'),
  };
});
const restOn = async () => {
  // A set that asks, with a rest after it: Done, from a click, answers inside it (the rest is drawn
  // before the click returns, so the first frame after it has it) with the set's own haptic.
  return page.evaluate(() => {
    const U = window.GH.ui, a = U.S.active;
    const asks = (st) => st.kind === 'set' && !st.item.timed && st.askRir && st.rest;
    const k = a.steps.findIndex((st, i) => i > a.idx && asks(st));
    a.idx = k >= 0 ? k : a.steps.findIndex(asks);
    U.openPlayer();
    window.__haptics.length = 0;
    document.querySelector('#player [data-act="plDone"]').click();
    return { rest: !!document.querySelector('#player .pl-rest .pl-timer'), haptics: window.__haptics.slice() };
  });
};
let r0 = await restOn();
check('Done set answers inside the tap: the rest is on screen by the next frame, with setDone', r0.rest && r0.haptics.includes('setDone'), JSON.stringify(r0));
await settle(600);
const resting = await where();
check('resting with the question open: ring, buttons, question and Up next, Continue\'s place held', resting.ring != null && resting.skip && resting.rir != null && resting.next != null && resting.held && !resting.cont, JSON.stringify(resting));
// Layout shifts from now until read (the page's clock is a test clock: no timers of its own here).
const watchShifts = () => page.evaluate(() => { const w = window.__shiftW = { all: [] }; w.o = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.all.push(e.value); }); w.o.observe({ type: 'layout-shift' }); });
const readShifts = () => page.evaluate(() => { const w = window.__shiftW; w.o.takeRecords().forEach((e) => w.all.push(e.value)); w.o.disconnect(); return w.all.reduce((a, b) => a + b, 0); });
await watchShifts();
await page.evaluate(() => window.GH.ui.act.plSkipRest());
await settle(700);
const shiftSkip = await readShifts();
const skipped = await where();
const same = (a, b) => ['ring', 'row', 'rir', 'next', 'actsTop'].every((k) => a[k] === b[k]);
check('Skip rest with the question open: the ring stays, empty at 0:00, "Rest over" in its row', skipped.over && skipped.count === '0:00' && skipped.ring === resting.ring, JSON.stringify(skipped));
check('and nothing moves: the question, Up next and the action bar are where they were', same(resting, skipped), JSON.stringify({ resting, skipped }));
check('Continue comes into the place held for it', skipped.cont && !skipped.held);
check('no layout shift (it was 0.14)', shiftSkip < 0.01, shiftSkip);
await page.evaluate(() => window.GH.ui.act.plContinue());
await settle(600);
// The same when the timer runs out by itself.
r0 = await restOn();
await settle(600);
const resting2 = await where();
const restSecs = await page.evaluate(() => { const s = window.GH.ui.S.active; return s.steps[s.idx - 1].rest; });
await watchShifts();
await page.clock.runFor((restSecs + 1) * 1000);
await settle(700);
const shiftTimer = await readShifts();
const ranOut = await where();
check('the rest running out by itself: the same, nothing moves and Continue comes', ranOut.over && ranOut.cont && same(resting2, ranOut) && shiftTimer < 0.01, JSON.stringify({ resting2, ranOut, shiftTimer }));
// Up next keeps a number with its unit ("10 reps", "25 lb"), however its line wraps, and no line
// starts with a "·".
const nextLine = await page.evaluate(() => (document.querySelector('#player .pl-next .t-footnote') || {}).textContent || '');
check('Up next keeps each number with its unit, and each "·" on the line it ends', /\d\u00a0(reps?|lb|kg|s)\b/.test(nextLine) && !/\d (reps?|lb|kg)\b/.test(nextLine) && !/ · /.test(nextLine), JSON.stringify(nextLine));
// While resting, Up next opens how to do the next move.
const howNext = await page.evaluate(async () => {
  const row = document.querySelector('#player button.pl-next-row[data-act="plHowTo"]');
  const want = window.GH.ui.S.active.steps[window.GH.ui.S.active.idx].item.name;
  if (!row) return null;
  row.click();
  await new Promise((r) => setTimeout(r, 50));
  const d = [...document.querySelectorAll('dialog[open]')].pop();
  return { want, title: d ? (d.querySelector('.rf-sheet-title') || {}).textContent : null };
});
check('Up next opens how to do the next move', howNext && howNext.title === howNext.want, JSON.stringify(howNext));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(700);
// A small phone with large text (360 x 844, a three-button bar of 48 px, text at 130%): the rest
// draws its ring smaller so everything fits above the actions (Up next and the place held for
// Continue).
await page.setViewportSize({ width: 360, height: 844 });
await page.evaluate(() => window.__gh.setInsets({ top: 30, bottom: 48, left: 0, right: 0, keyboard: false }));
await page.evaluate(() => window.GH.ui.act.plContinue());
await settle(600);
await restOn();
await settle(300);
const largeText = await page.evaluate(() => {
  for (const e of document.querySelectorAll('#player *')) { const f = parseFloat(getComputedStyle(e).fontSize); if (f && !e.closest('svg')) e.style.setProperty('font-size', `${f * 1.3}px`, 'important'); }
  window.dispatchEvent(new Event('resize'));
  const m = document.querySelector('#player .pl-main');
  const next = m.querySelector('.pl-next-row').getBoundingClientRect(), box = m.getBoundingClientRect();
  return { tight: m.classList.contains('is-tight'), over: Math.round(next.bottom - box.bottom), ring: Math.round(m.querySelector('.rf-ring').getBoundingClientRect().width) };
});
check('large text on a small phone: the ring draws smaller and Up next fits above the actions', largeText.tight && largeText.over <= 0, JSON.stringify(largeText));
await page.evaluate(() => { for (const e of document.querySelectorAll('#player [style*="font-size"]')) e.style.removeProperty('font-size'); window.__gh.setInsets({ top: 30, bottom: 20, left: 0, right: 0, keyboard: false }); });
await page.setViewportSize({ width: 390, height: 844 });
await settle(600);
await page.evaluate(() => window.GH.ui.act.plContinue());
await settle(600);
// The swap sheet: a tap on a move swaps at once, so its rows promise no other page (no chevron).
await page.evaluate(() => { const U = window.GH.ui, a = U.S.active; a.idx = a.steps.findIndex((st, i) => i >= a.idx && st.kind === 'set' && !st.leadOnly); U.openPlayer(); U.act.plSwap(); });
await settle(900);
const swapRows = await page.evaluate(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); return d ? { rows: d.querySelectorAll('[data-act="plSwapTo"]').length, chevrons: d.querySelectorAll('[data-act="plSwapTo"] .rf-list-chevron').length } : null; });
check('the swap sheet\'s moves carry no chevron (a tap swaps at once)', swapRows && swapRows.rows > 0 && swapRows.chevrons === 0, JSON.stringify(swapRows));
await page.evaluate(() => { const U = window.GH.ui; U.closeSheets(); U.act.plKeep(); window.GH.brain.cancelWorkout(U.S); window.GH.store.save(U.S); U.render(); });
await settle(700);

section('Today: titles, links and the floating row');
await page.evaluate(() => {
  const GH = window.GH, U = GH.ui, S = U.S, d = U.today();
  delete S.seen.tip_today;
  GH.health.setFeel(S, d, { energy: 'good', sore: 'none' });
  GH.health.setSleepChip(S, d, '7-8');
  U.go('today');
  U.render();
  document.getElementById('screen').scrollTop = 0;
});
await settle(900);
const today = await page.evaluate(() => {
  const s = document.querySelector('#screen'), card = s.querySelector('.card.session');
  const ink = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const inset = (el, c) => { const cr = c.getBoundingClientRect(); return Math.round((cr.right - ink(el).right) * 10) / 10; };
  const tip = s.querySelector('.tip'), got = tip && tip.querySelector('.rf-btn');
  const feel = s.querySelector('.feel-done'), change = feel && feel.querySelector('[data-act="feelEdit"]');
  const head = card && card.querySelector('.session-head'), title = card && card.querySelector('h2');
  return {
    gap: head && title ? Math.round(title.getBoundingClientRect().top - head.getBoundingClientRect().bottom) : null,
    got: got ? inset(got, tip) : null, change: change ? inset(change, feel) : null,
    pad: tip ? parseFloat(getComputedStyle(tip).paddingRight) : null,
  };
});
check('the workout card\'s title sits in the card\'s gap under its eyebrow (it kept 18 px heading margins)', today.gap != null && today.gap <= 12, JSON.stringify(today));
check('the tip\'s Got it ends on the card\'s inset', today.got != null && Math.abs(today.got - today.pad) <= 1.5, JSON.stringify(today));
check('the feel summary\'s Change sits at the card\'s right edge, on its inset', today.change != null && Math.abs(today.change - today.pad) <= 1.5, JSON.stringify(today));
// A tap on a move's second line (its sets and weight) opens that move, like a tap on its name.
const rowHit = await page.evaluate(() => {
  const m = document.querySelector('#screen .ex-list .ex button.ex-name');
  const meta = m && m.parentElement.querySelector('.ex-meta');
  if (!meta) return null;
  meta.scrollIntoView({ block: 'center' });
  const r = meta.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
  return { hit: !!(h && h.closest('[data-act="moveInfo"]')), same: h && h.closest('[data-act="moveInfo"]') === m };
});
check('a move\'s row opens it from its second line too (its name alone was a 24 px target)', rowHit && rowHit.hit && rowHit.same, JSON.stringify(rowHit));
// The floating row measures its buttons as laid out: Short on time still swollen from the finger
// that pressed it (Refract's glass grows while held) kept its words; it went to a bare icon.
const swollen = await page.evaluate(async () => {
  const fl = document.getElementById('float');
  const side = fl.querySelector('[data-act="toggleShort"]');
  side.style.scale = '1.08';
  window.dispatchEvent(new Event('resize'));
  const out = { tight: fl.classList.contains('is-tight') };
  side.style.scale = '';
  return out;
});
check('Short on time, swollen from a press, keeps its words', swollen && !swollen.tight, JSON.stringify(swollen));
await page.evaluate(() => { const S = window.GH.ui.S; S.seen.tip_today = true; window.GH.ui.render(); });
await settle(600);

section('Large text on a small phone: words stay whole');
// 360 px with text at 130%: You's badge titles grow their tiles with the text, so no word is split
// between two lines ("Unstoppa / ble"), and an insight's change stays whole ("20% → / 7%").
await page.setViewportSize({ width: 360, height: 844 });
const bigText = (on) => page.evaluate((v) => {
  if (!v) { for (const e of document.querySelectorAll('#screen [style*="font-size"]')) e.style.removeProperty('font-size'); return; }
  const els = [...document.querySelectorAll('#screen *')].filter((e) => !e.closest('svg'));
  const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
  els.forEach((e, i) => { if (sizes[i]) e.style.setProperty('font-size', `${sizes[i] * 1.3}px`, 'important'); });
}, on);
// The words (split at a hyphen too, a fair place to break) that run over two lines.
const splitWords = (sel) => page.evaluate((s) => {
  const out = [];
  for (const el of document.querySelectorAll(s)) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const m of n.data.matchAll(/[^\s-]+-?/g)) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (tops.size > 1) out.push(m[0]);
      }
    }
  }
  return out;
}, sel);
await page.evaluate(() => { window.GH.ui.go('you'); document.getElementById('screen').scrollTop = 0; });
await settle(900);
await bigText(true);
await settle(300);
const minis = await page.evaluate(() => [...document.querySelectorAll('#screen .bdg-mini')].map((b) => Math.round(b.getBoundingClientRect().width)));
const bdgSplit = await splitWords('#screen .bdg-mini-title');
check('You\'s badge titles keep their words whole, their tiles wider with the text', minis.length > 0 && minis.every((w) => w > 76) && bdgSplit.length === 0, JSON.stringify({ minis, bdgSplit }));
await bigText(false);
await page.evaluate(() => {
  const U = window.GH.ui, S = U.S, d = U.today(), c = S.catchup && S.catchup.arm;
  if (c && !(c.tests.length >= 2 && c.tests[c.tests.length - 1].gap < c.tests[0].gap - 0.03)) c.tests = [{ day: d - 28, left: 12, right: 15, gap: 0.2 }, { day: d - 1, left: 14, right: 15, gap: 0.067 }];
  U.go('health');
  U.render();
});
await settle(900);
await bigText(true);
await settle(300);
const change = await page.evaluate(() => {
  const t = [...document.querySelectorAll('#screen .hl-ins-title')].find((e) => /→/.test(e.textContent));
  if (!t) return null;
  const n = t.firstChild, i = n.data.search(/\d+%\s→/), j = n.data.search(/→\s\d+%/);
  const r = document.createRange(); r.setStart(n, i); r.setEnd(n, n.data.indexOf('%', j) + 1);
  return { text: t.textContent, lines: new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size };
});
check('an insight\'s change ("20% → 7%") stays on one line', change && change.lines === 1, JSON.stringify(change));
// The Next screen's lines (and the rest of U.nb's): an arrow after a name keeps to what it points
// to, so "Rope pushdown → 13 / reps" breaks as "Rope pushdown / → 13 reps".
const arrows = await page.evaluate(() => [window.GH.ui.nb('Left arm gap: 20% → 7%'), window.GH.ui.nb('Rope pushdown → 13 reps')]);
check('a change between numbers is whole, and an arrow after a name goes with its number and unit', arrows[0] === 'Left arm gap: 20%&nbsp;→&nbsp;7%' && arrows[1] === 'Rope pushdown →&nbsp;13&nbsp;reps', JSON.stringify(arrows));
await bigText(false);
await page.setViewportSize({ width: 390, height: 844 });
await settle(400);

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
done();
