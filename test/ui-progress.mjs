// The Progress screen's body map, in Chromium at phone size with someone five weeks in: the map
// draws 17 regions coloured by their sets, a region opens its muscle sheet (weekly sets, what trained
// it, progress), the Trained | Improved switch and the range chips redraw it, "Train … more" hands
// the muscle to Tailor my plan, the hidden list mirrors the map for screen readers, a new person
// sees an empty map, and nothing logs an error.
// Usage: node test/ui-progress.mjs [--dark] [--width=390]
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
await page.click('.rf-tab[data-tab="progress"]');
await settle(1200);

// The map as drawn: each region's muscle, level and fill colour, per view.
const map = () => page.evaluate(() => {
  const card = document.querySelector('#screen .bm-card');
  const regions = [...card.querySelectorAll('.bm-view .bm-m')].map((g) => ({ view: g.closest('.bm-view').dataset.view, m: g.dataset.muscle, l: Number(g.dataset.l), fill: getComputedStyle(g.querySelector('path')).fill }));
  return { mode: card.querySelector('.bm').dataset.mode, regions, sub: card.querySelector('.bm-head .t-footnote').textContent, take: card.querySelector('.bm-take').textContent.replace(/\s+/g, ' ').trim(), legend: card.querySelector('.bm-legend').textContent.replace(/\s+/g, ' ').trim(), list: [...card.querySelectorAll('.bm-sr button')].map((b) => b.textContent) };
});
const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

section('The map');
let m = await map();
const muscles = new Set(m.regions.map((r) => r.m));
check('17 regions over a front and a back view', muscles.size === 17 && m.regions.some((r) => r.view === 'front') && m.regions.some((r) => r.view === 'back'), [...muscles]);
check('the trained muscles are coloured, the untrained ones (calves at home) are not', m.regions.filter((r) => r.l > 0).length >= 12 && m.regions.filter((r) => r.m === 'calves').every((r) => r.l === 0), m.regions.map((r) => `${r.m}:${r.l}`).join(' '));
check('the most trained muscle is at the top of the scale', m.regions.some((r) => r.l === 5));
const top = m.regions.find((r) => r.l === 5), none = m.regions.find((r) => r.l === 0), low = m.regions.find((r) => r.l === 1 || r.l === 2);
check('the scale runs from grey to the accent', top && none && top.fill !== none.fill && (!low || (low.fill !== top.fill && low.fill !== none.fill)), [top && top.fill, low && low.fill, none && none.fill]);
check('a takeaway names the most and least trained', /^Most: .+ · Least: calves$/.test(m.take), m.take);
check('the legend reads less to more, with no sets', /Less\s*More\s*No sets/.test(m.legend), m.legend);
check('a list of the same 17 muscles for screen readers', m.list.length === 17 && m.list.some((t) => /^Chest: [\d.]+ sets?, \d+% of your training$/.test(t)) && m.list.includes('Calves: no sets'), m.list.slice(0, 4));
const svgHidden = await page.evaluate(() => [...document.querySelectorAll('#screen .bm-fig')].every((s) => s.getAttribute('aria-hidden') === 'true'));
check('the drawing itself is hidden from screen readers', svgHidden);
check('the least trained muscle has a "Train … more" link', (await page.evaluate(() => { const b = document.querySelector('#screen .bm-card [data-act="tailorPlan"]'); return b && b.getAttribute('data-arg'); })) === 'calves');
await page.click('#screen .bm-card [data-act="tailorPlan"]');
await settle(900);
check('which opens Tailor my plan asking for that muscle', (await page.evaluate(() => { const q = document.querySelector('dialog[open] #tailorQ'); return q && q.value; })) === 'Train my calves more');
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(700);

section('A region opens its muscle sheet');
await page.evaluate(() => { window.__haptics.length = 0; });
await page.click('#screen .bm-view[data-view="front"] .bm-m[data-muscle="chest"] path');
await settle(900);
const sheet = await page.evaluate(() => {
  const d = document.querySelector('dialog.mu-sheet[open]');
  if (!d) return null;
  return { title: d.querySelector('.rf-sheet-title').textContent, facts: [...d.querySelectorAll('.mu-fact')].map((f) => f.textContent.replace(/\s+/g, ' ').trim()), bars: d.querySelectorAll('.mu-bar').length, tip: d.querySelector('.mu-tip').textContent, moves: [...d.querySelectorAll('[data-act="moveInfo"] .rf-list-title')].map((e) => e.textContent), lines: [...d.querySelectorAll('.rf-list-row .rf-badge')].map((e) => e.textContent), lit: [...d.querySelectorAll('.mu-fig .bm-m')].filter((g) => g.dataset.l === '5').length, haptic: window.__haptics.includes('sheet') && !window.__haptics.includes('select') };
});
check('tapping the chest opens the Chest sheet', sheet && sheet.title === 'Chest', sheet);
check('with its sets, share of training and times it went up', sheet && sheet.facts.length === 3 && /sets in the last 4 weeks/.test(sheet.facts[0]) && /of your training/.test(sheet.facts[1]) && /went up/.test(sheet.facts[2]), sheet && sheet.facts);
check('twelve weekly bars, this week read out', sheet && sheet.bars === 12 && /^This week: /.test(sheet.tip), sheet && [sheet.bars, sheet.tip]);
check('the exercises that trained it, push-ups first', sheet && sheet.moves.length >= 2 && /Push-up/.test(sheet.moves[0]), sheet && sheet.moves);
check('progress lines with how much', sheet && sheet.lines.length >= 1 && sheet.lines.every((t) => /^[+−]/.test(t)), sheet && sheet.lines);
check('its figure lights just that muscle', sheet && sheet.lit === 1);
check('the tap gives one haptic, the sheet\'s as it rises', sheet && sheet.haptic);
await page.click('dialog.mu-sheet .mu-bar:nth-child(11)');
check('tapping a bar reads that week out', /^Week of \w{3} \d+: /.test(await page.evaluate(() => document.querySelector('dialog.mu-sheet .mu-tip').textContent)));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);
await page.click('#screen .bm-view[data-view="back"] .bm-m[data-muscle="lats"] path');
await settle(900);
check('a back region opens its own sheet', await page.evaluate(() => { const d = [...document.querySelectorAll('dialog.mu-sheet[open]')].pop(); return d && d.querySelector('.rf-sheet-title').textContent === 'Lats'; }));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Trained | Improved');
await page.click('#screen [data-on="bodyMode"] input[value="improved"]', { force: true });
await settle(900);
const imp = await map();
check('the switch moves the map to Improved', imp.mode === 'improved' && /^Progress per muscle, last 4 weeks$/.test(imp.sub), [imp.mode, imp.sub]);
check('the legend says no progress, the takeaway names the most improved', /No progress/.test(imp.legend) && /^Most: .+ · Least: .+$/.test(imp.take), [imp.legend, imp.take]);
const was = Object.fromEntries(m.regions.map((r) => [`${r.view}:${r.m}`, r.l]));
check('the regions are recoloured by progress', imp.regions.some((r) => r.l !== was[`${r.view}:${r.m}`]) && imp.regions.some((r) => r.l === 5), imp.regions.map((r) => `${r.m}:${r.l}`).join(' '));
await settle(900);
const green = await page.evaluate(() => { const g = document.querySelector('#screen .bm-view .bm-m[data-l="5"] path'); return getComputedStyle(g).fill; });
const [r0, g0, b0] = rgb(green);
check('in the positive colour (green, not blue)', g0 > r0 && g0 > b0, green);
check('the screen-reader list says what went up', imp.list.some((t) => /: went up \d+ times?/.test(t)), imp.list.slice(0, 5));
const mi = await page.evaluate(() => [...document.querySelectorAll('#screen .mi-row')].map((r) => ({ name: r.querySelector('.rf-list-title').textContent, sub: r.querySelector('.rf-list-sub').textContent, badge: (r.querySelector('.rf-badge') || {}).textContent })));
check('Most improved lists muscle groups with what changed and by how much', mi.length >= 3 && mi.every((x) => /→/.test(x.sub) && /^\+/.test(x.badge || '')), mi);
await page.click('#screen [data-on="bodyMode"] input[value="trained"]', { force: true });
await settle(900);
check('and back to Trained', (await map()).mode === 'trained');

section('Range');
await page.click('#screen .bm-range [data-arg="1"]');
await settle(900);
let rng = await page.evaluate(() => ({ pressed: [...document.querySelectorAll('#screen .bm-range input')].map((c) => String(c.checked)), sub: document.querySelector('#screen .bm-head .t-footnote').textContent }));
check('1 week: its chip is pressed and the subtitle follows', rng.pressed.join() === 'true,false,false' && /last 7 days/.test(rng.sub), rng);
const week = await map();
check('fewer sets in a week than in four: lower top or more greys', week.regions.filter((r) => r.l === 0).length >= m.regions.filter((r) => r.l === 0).length, [week.regions.filter((r) => r.l === 0).length, m.regions.filter((r) => r.l === 0).length]);
await page.click('#screen .bm-range [data-arg="12"]');
await settle(900);
rng = await page.evaluate(() => ({ pressed: [...document.querySelectorAll('#screen .bm-range input')].map((c) => String(c.checked)), sub: document.querySelector('#screen .bm-head .t-footnote').textContent }));
check('12 weeks', rng.pressed.join() === 'false,false,true' && /last 12 weeks/.test(rng.sub), rng);
await page.click('#screen .bm-range [data-arg="4"]');
await settle(900);

section('Train … more');
await page.evaluate(() => { window.GH.ui.act.tailorPlan = (el) => { window.__tailor = el.getAttribute('data-arg'); }; window.GH.ui.render(); });
await settle(600);
const more = await page.evaluate(() => { const b = document.querySelector('#screen .bm-card [data-act="tailorPlan"]'); return b && { text: b.textContent.trim(), arg: b.dataset.arg }; });
check('with Tailor my plan there, the hero offers to train the least trained muscle', more && more.arg === 'calves' && more.text === 'Train calves more', more);
await page.click('#screen .bm-card [data-act="tailorPlan"]');
check('and hands it the muscle', await page.evaluate(() => window.__tailor === 'calves'));
await page.click('#screen .bm-view[data-view="back"] .bm-m[data-muscle="glutes"] path');
await settle(900);
await page.click('dialog.mu-sheet [data-act="tailorPlan"]');
check('the sheet\'s "Train this more" hands over its muscle', await page.evaluate(() => window.__tailor === 'glutes'));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Keyboard');
await page.focus('#screen .bm-sr [data-arg="quads"]');
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
const focus = await page.evaluate(() => [...document.querySelectorAll('#screen .bm-m.is-focus')].map((g) => g.dataset.muscle));
check('focusing a muscle in the hidden list outlines its region', focus.length >= 1 && focus.every((x) => x === 'quads'), focus);
await page.keyboard.press('Enter');
await settle(900);
check('and Enter opens its sheet', await page.evaluate(() => { const d = [...document.querySelectorAll('dialog.mu-sheet[open]')].pop(); return d && d.querySelector('.rf-sheet-title').textContent === 'Quads'; }));
await page.evaluate(() => window.GH.ui.closeSheets());
await settle(900);

section('Nobody trained yet');
await page.evaluate(() => { const S = window.GH.ui.S; S.log = S.log.filter((l) => l.type !== 'workout'); for (const st of Object.values(S.prog)) if (st && st.e1rm) st.e1rm = {}; window.GH.store.save(S); });
await page.reload();
await page.waitForSelector('#screen[data-view]');
await page.evaluate(() => window.GH.ui.go('progress'));
await settle(1000);
const empty = await map();
check('an empty map: every region grey', empty.regions.every((r) => r.l === 0), empty.regions.filter((r) => r.l).map((r) => r.m));
check('with a line on what to expect', /Finish a workout/.test(empty.take), empty.take);
check('and Most improved explains itself', /After a few workouts/.test(await page.evaluate(() => document.querySelector('#screen [data-key="mi-none"]').textContent)));

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
done();
