// Layout regressions from real-phone reports, checked in Chromium at phone size with someone five
// weeks in: chart bounds, tab and button type, cut-off titles, the set-up overlay, sliders, the tour's
// tab bar, the Resume button, the workout capsule's glass and section spacing.
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
await page.goto('file://' + join(root, 'dist/gradient-health.html'));
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(); };

section('Charts');
await tab('health');
await page.click('[data-on="healthRange"] input[value="7"]', { force: true });
await settle();
check('the range is 7 days', await page.evaluate(() => document.querySelector('[data-on="healthRange"] input[value="7"]').checked));
const charts = await page.evaluate(() => [...document.querySelectorAll('#screen .ch-plot')].map((p) => { const s = p.querySelector('.ch-svg'); const a = p.getBoundingClientRect(), b = s.getBoundingClientRect(); return { plot: Math.round(a.height), svg: Math.round(b.height), bottom: Math.round(b.bottom - a.bottom) }; }));
check('the Health tab has charts', charts.length >= 4, charts.length);
check('7-day charts stay inside their plot', charts.every((c) => c.svg <= c.plot + 1 && c.bottom <= 1), JSON.stringify(charts));

section('Type in the tab bar, buttons and chips');
const type = await page.evaluate(() => {
  const label = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label');
  const lens = document.querySelector('.rf-tabbar-lens');
  const lr = label.getBoundingClientRect(), pr = lens.getBoundingClientRect();
  const fs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : null; };
  return { tabSize: getComputedStyle(label).fontSize, inside: lr.left >= pr.left - 0.5 && lr.right <= pr.right + 0.5, btn: fs('#screen .rf-btn:not([data-size])'), chip: fs('#screen .rf-chip') };
});
check('tab labels use the tab bar size', type.tabSize === '11px', type.tabSize);
check('the selected label sits inside its pill', type.inside);
check('buttons keep Refract\'s size', type.btn === null || type.btn !== '16px', type.btn);
check('chips keep Refract\'s size', type.chip === null || type.chip === '13px', type.chip);
for (const t of ['today', 'plan', 'health', 'progress']) {
  await tab(t);
  const ok = await page.evaluate(() => { const l = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label').getBoundingClientRect(); const p = document.querySelector('.rf-tabbar-lens').getBoundingClientRect(); return l.left >= p.left - 0.5 && l.right <= p.right + 0.5; });
  check(`"${t}" label fits its pill`, ok);
}

section('Titles that used to be cut off');
await tab('today');
await page.click('#topbar [data-act="openProfile"]'); await settle();
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

section('Profile → Equipment');
await page.click('#topbar [data-act="back"]'); await settle();
await page.click('#screen [data-act="editEquipment"]'); await settle(900);
const ob = await page.evaluate(() => { const el = document.getElementById('onboard'); const cs = getComputedStyle(el); return { hidden: el.hidden, opacity: Number(cs.opacity) }; });
check('the equipment editor is visible', !ob.hidden && ob.opacity > 0.95, JSON.stringify(ob));
const one = await page.evaluate(() => ({ title: document.querySelector('.onboard .rf-large-title').textContent, btn: document.querySelector('.ob-actions [data-variant="tinted"]').textContent.trim(), close: !!document.querySelector('.ob-top [aria-label="Close"]') }));
check('it opens just the Equipment screen, with Save and Close', one.title === 'Equipment' && one.btn === 'Save' && one.close, JSON.stringify(one));
await page.evaluate(() => window.__gh.back());
await settle(900);
const back = await page.evaluate(() => ({ hidden: document.getElementById('onboard').hidden, view: document.getElementById('screen').dataset.view }));
check('back closes it and returns to Profile', back.hidden && back.view === 'profile', JSON.stringify(back));
await page.click('#screen [data-act="editEquipment"]'); await settle(900);
const again = await page.evaluate(() => { const el = document.getElementById('onboard'); return !el.hidden && Number(getComputedStyle(el).opacity) > 0.95; });
check('it opens again after closing (no invisible overlay)', again);
await page.evaluate(() => window.__gh.back()); await settle(900);
await page.click('#screen [data-act="openSettings"]'); await settle();
check('taps reach the page afterwards', await page.evaluate(() => document.getElementById('screen').dataset.view === 'settings'));
await page.click('#topbar [data-act="back"]'); await settle();
await page.click('#topbar [data-act="back"]'); await settle();

section('Tour, last page');
await page.evaluate(() => window.GH.ui.showTour());
await settle(900);
for (let i = 0; i < 3; i++) { await page.click('.tour-sheet [data-act="tourNext"]'); await settle(500); }
const tour = await page.evaluate(() => { const t = document.querySelector('.tour-tabs'); const b = document.querySelector('.tour-sheet .rf-sheet-body'); const r = t.getBoundingClientRect(); return { right: Math.round(r.right), left: Math.round(r.left), vw: innerWidth, scroll: b.scrollWidth - b.clientWidth, labels: [...t.querySelectorAll('.tour-tab-label')].every((l) => l.scrollWidth <= l.clientWidth + 1) }; });
check('the tab bar replica fits on screen', tour.left >= 0 && tour.right <= tour.vw, JSON.stringify(tour));
check('the page doesn\'t scroll sideways', tour.scroll <= 0, tour.scroll);
check('its labels aren\'t cut off', tour.labels);
await page.click('.tour-sheet [data-act="tourNext"]'); await settle(900);

section('A workout in progress');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
await settle(600);
await page.click('.player [data-act="plMin"]').catch(async () => { await page.evaluate(() => window.__gh.back()); });
await settle(900);
const resume = await page.evaluate(() => { const b = document.querySelector('#float .btn-main'); if (!b) return null; const r = b.getBoundingClientRect(); return { off: Math.round((r.left + r.right) / 2 - innerWidth / 2), w: Math.round(r.width), text: b.textContent.trim() }; });
check('Resume is centred on Today', resume && Math.abs(resume.off) <= 1, JSON.stringify(resume));
for (const t of ['health', 'today', 'plan', 'health']) await tab(t);
const cap = await page.evaluate(() => { const a = document.getElementById('accessory'); const layer = a.querySelector(':scope > .rf-lens-layer'); const cs = layer ? getComputedStyle(layer) : getComputedStyle(a); return { shown: !a.hidden, layer: !!layer, bg: cs.backgroundColor }; });
check('the workout capsule shows on other tabs', cap.shown);
check('its glass layer is still there after switching tabs', cap.layer, JSON.stringify(cap));

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
done();
