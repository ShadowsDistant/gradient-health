// Layout regressions from real-phone reports, checked in Chromium at phone size with someone five
// weeks in: chart bounds, tab and button type, cut-off titles, the set-up overlay, sliders, the tour's
// tab bar, the Resume and Cancel buttons, the workout capsule's glass, section spacing, the current
// tab's glass lens, page ends that clear the tab bar, and cancelling a workout (from Back and from
// Today, with Undo).
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

section('Refract\'s light while the page scrolls');
// On a phone the glass rims follow how it's tilted. While the page scrolls the light holds still
// where the rims are (they mustn't swing round to the light's resting angle and back), and it
// follows the tilt again once the page is still.
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
    return { rest, base, seen, after };
  });
  check('the tilt turns the rims (away from the resting angle)', Math.abs(r.rest - r.base) > 10, r);
  check('scrolling holds the light still, where the rims were', r.seen.every((x) => x.mode === 'fixed' && Math.abs(x.at - r.rest) < 2), r.seen.map((x) => `${x.mode} ${Math.round(x.at)}`).join(', '));
  check('then it follows the tilt again', r.after === 'pointer', r.after);
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
// What's new opens at medium; pulled up to large, it sets the page back.
await page.evaluate(() => window.GH.ui.topSheet().detent('large'));
await settle(900);
check('a sheet at full height sets the page back', await page.evaluate(() => document.getElementById('app').hasAttribute('data-receded')));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);
check('and closing it brings the page forward again', await page.evaluate(() => !document.getElementById('app').hasAttribute('data-receded')));

section('Cancelling a workout');
await tab('today');
const toast = () => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '));
await page.click('#float [data-act="cancelWorkout"]');
await settle(900);
const c1 = await page.evaluate(() => ({ active: !!window.GH.ui.S.active, start: !!document.querySelector('#float [data-act="startWorkout"]'), dialog: !!document.querySelector('dialog.rf-dialog[open]') }));
check('Today\'s Cancel ends a workout with nothing done, without asking', !c1.active && !c1.dialog, JSON.stringify(c1));
check('and today\'s workout can be started again', c1.start);
check('the toast says so and offers Undo', /Workout cancelled/.test(await toast()) && /Undo/.test(await toast()), await toast());
await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].pop(); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
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
check('Back with a set done offers keep, finish or cancel', leave && ['plKeep', 'plFinishNow', 'plCancel'].every((a) => leave.acts.includes(a)) && /done 1 of \d+ sets/.test(leave.text), JSON.stringify(leave && leave.acts));
await page.click('dialog.leave-sheet [data-act="plCancel"]');
await settle(900);
const ask = await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); return d ? d.textContent : ''; });
check('cancelling with sets done asks first, with a clear way out', /Cancel this workout\?/.test(ask) && /Keep it/.test(ask) && /1 set you did/.test(ask), ask);
await page.evaluate(() => { const d = document.querySelector('dialog.rf-dialog[open]'); [...d.querySelectorAll('button')].find((b) => /Cancel workout/.test(b.textContent)).click(); });
await settle(1200);
check('then the workout is gone and the player closed', await page.evaluate(() => !window.GH.ui.S.active && document.querySelector('.player').hidden && !!document.querySelector('#float [data-act="startWorkout"]')));
// Undo brings back the same workout (not a copy, which broke every set after it).
await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].pop(); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
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
await page.evaluate(() => { const U = window.GH.ui; U.act.plKeep(); window.GH.brain.cancelWorkout(U.S); window.GH.store.save(U.S); U.render(); });
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

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
done();
