// Food tracking and "what you track", in Chromium at phone size with someone five weeks in: turning
// calories on (tabs change, Moves moves into Plan), the Food tab, quick add, a food from a label,
// online search and a typed barcode (Open Food Facts mocked), meals saved to Health Connect, the
// Health tab's food tile and chart, and switching workouts off.
// Usage: node test/ui-food.mjs [--dark] [--width=360]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
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
page.on('console', (m) => { if (m.type() === 'error' && !/lazy\/foods\.js|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
const server = await serveDist();
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(); };
const tabs = () => page.evaluate(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => t.dataset.tab).join(','));
const openSettings = async () => { await page.evaluate(() => window.GH.ui.open('settings')); await settle(); };
const sheetOpen = (sel) => page.waitForSelector(`dialog.rf-sheet[open] ${sel || ''}`, { timeout: 5000 }).then(() => true, () => false);
const closeSheets = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await settle(900); };
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('screen').scrollWidth <= window.innerWidth + 1);
const kcalToday = () => page.evaluate(() => window.GH.food.totals(window.GH.ui.S, window.GH.ui.today(), false).kcal);

section('What you track');
check('workout people start with the usual tabs', (await tabs()) === 'today,plan,health,progress,moves', await tabs());
await openSettings();
check('Settings has the section', await page.evaluate(() => !!document.querySelector('#track') && !!document.querySelector('[data-on="setFoodMode"]')));
await page.click('[data-on="setFoodMode"] input[value="full"]', { force: true });
await settle();
check('calories on: Food takes the Moves tab', (await tabs()) === 'today,plan,food,health,progress', await tabs());
check('the food settings show up', await page.evaluate(() => !!document.querySelector('#food') && !!document.querySelector('[data-on="setWeightGoal"]')));
const cut = await page.evaluate(() => [...document.querySelectorAll('#screen .rf-list-title')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
check('no setting title is cut off', cut.length === 0, cut.join(' | '));
check('no sideways scroll in Settings', await noSideScroll());
await page.evaluate(() => { const b = document.querySelector('#screen [data-on="setFoodPref"][data-k="online"]'); if (!b.checked) b.click(); });
await settle();
check('online search switched on', await page.evaluate(() => window.GH.food.prefs(window.GH.ui.S).online === true));

section('Tab bar with Food');
for (const t of ['today', 'plan', 'food', 'health', 'progress']) {
  await tab(t);
  const ok = await page.evaluate(() => { const l = document.querySelector('.rf-tab[aria-current="page"] .rf-tab-label').getBoundingClientRect(); const p = document.querySelector('.rf-tabbar-lens').getBoundingClientRect(); return l.left >= p.left - 0.5 && l.right <= p.right + 0.5 && p.width > 20; });
  check(`"${t}" label fits its pill`, ok);
}
await tab('plan');
check('Plan links to all the moves', await page.evaluate(() => !!document.querySelector('#screen [data-act="openMoves"]')));
await page.click('#screen [data-act="openMoves"]');
await settle();
check('Moves opens as a page with a back button', await page.evaluate(() => document.getElementById('screen').dataset.view === 'moves' && !!document.querySelector('#topbar [data-act="back"]')));
await page.evaluate(() => window.GH.ui.back());
await settle();

section('Food tab');
await tab('food');
check('the day\'s ring and four meals', await page.evaluate(() => !!document.querySelector('#screen .fd-sum .rf-ring') && document.querySelectorAll('#screen .fd-meal').length === 4));
check('no sideways scroll', await noSideScroll());
await page.click('#screen [data-act="foodAdd"][data-arg="breakfast"]');
check('the add sheet opens', await sheetOpen('.fd-search'));
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="foodQuick"]');
await settle(700);
await page.fill('#qKcal', '450');
await page.fill('#qP', '30');
await page.click('dialog.rf-sheet[open] [data-act="foodQuickSave"]');
await settle(900);
check('quick add counts toward today', (await kcalToday()) === 450, await kcalToday());
check('and lands in breakfast', await page.evaluate(() => window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).breakfast.length === 1));
check('it was saved to Health Connect', await page.evaluate(() => window.__foodWrites.length === 1 && window.__foodWrites[0].kcal === 450));
check('the ring shows what\'s left', await page.evaluate(() => /left/.test(document.querySelector('#screen .fd-sum').textContent)));

section('A food from its label');
await closeSheets();
await page.click('#screen [data-act="foodAdd"][data-arg="lunch"]');
await sheetOpen('.fd-search');
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="foodCreate"]');
await settle(700);
await page.fill('#cName', 'Protein bar');
await page.fill('#cG', '60');
await page.fill('#cKcal', '220');
await page.fill('#cP', '20');
await page.click('dialog.rf-sheet[open] [data-act="foodCreateSave"]');
check('the portion sheet opens for it', await sheetOpen('.fd-portion'));
await settle(700);
await page.click('dialog.rf-sheet[open] [data-act="foodSave"]');
await settle(900);
check('one bar is 220 kcal', (await kcalToday()) === 670, await kcalToday());
check('it\'s kept under My foods', await page.evaluate(() => window.GH.food.data(window.GH.ui.S).custom.some((c) => c.name === 'Protein bar' && c.per100.kcal === 367)));

section('Online search');
await closeSheets();
await page.click('#screen [data-act="foodAdd"][data-arg="snack"]');
await sheetOpen('.fd-search');
await settle(600);
await page.fill('#foodQ', 'hazelnut');
await settle(900);
check('the online search button shows', await page.evaluate(() => !!document.querySelector('dialog.rf-sheet[open] [data-act="foodOnline"]')));
await page.click('dialog.rf-sheet[open] [data-act="foodOnline"]');
await settle(900);
const found = await page.evaluate(() => [...document.querySelectorAll('dialog.rf-sheet[open] [data-act="foodPick"]')].map((b) => b.textContent));
check('results come back, cleaned up', found.length === 1 && /Hazelnut spread/.test(found[0]), found);
await page.click('dialog.rf-sheet[open] [data-act="foodPick"]');
check('picking one opens its portions', await sheetOpen('.fd-portion'));
await settle(700);
check('with its serving size', await page.evaluate(() => /1 serving/.test(document.querySelector('dialog.rf-sheet[open] .fd-portion').textContent)));
await page.click('dialog.rf-sheet[open] [data-act="foodSave"]');
await settle(900);
check('added (a serving is 15 g)', (await kcalToday()) === 670 + 81, await kcalToday());

section('Barcode, typed in');
await closeSheets();
await page.click('#screen [data-act="foodAdd"]');
await sheetOpen('.fd-search');
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="foodScan"]');
check('the scanner opens', await sheetOpen('.sc-wrap'));
await settle(1500);
await page.evaluate(() => { const a = window.GH.ui.act.scanType; if (a) a(); });
await settle(400);
await page.fill('#scCode', '3017620422004');
await page.press('#scCode', 'Enter');
await settle(600);
check('a wrong check digit is caught', await page.evaluate(() => !!document.querySelector('dialog.rf-sheet[open] .sc-wrap')));
await page.fill('#scCode', '3017620422003');
await page.press('#scCode', 'Enter');
check('the right one looks it up and opens it', await sheetOpen('.fd-portion'));
await settle(700);
check('it\'s the right product', await page.evaluate(() => /Hazelnut spread/.test(document.querySelector('dialog.rf-sheet[open] .rf-sheet-title').textContent)));
await closeSheets();

section('Health tab');
await tab('health');
check('an Eaten tile', await page.evaluate(() => [...document.querySelectorAll('#screen .stat')].some((s) => /Eaten/.test(s.textContent))));
check('active calories and distance tiles', await page.evaluate(() => { const t = [...document.querySelectorAll('#screen .stat')].map((s) => s.textContent).join(' '); return /Active calories/.test(t) && /Distance/.test(t); }));
check('a calories eaten chart', await page.evaluate(() => [...document.querySelectorAll('#screen .card')].some((c) => /Calories eaten/.test(c.textContent))));

section('Workouts off');
await openSettings();
await page.evaluate(() => document.querySelector('#screen [data-on="setWorkouts"]').click());
await settle(900);
check('Plan, Progress and Moves go away', (await tabs()) === 'today,food,health', await tabs());
await tab('today');
check('Today leads with the day instead of a workout', await page.evaluate(() => !!document.querySelector('#screen .day-card') && !document.querySelector('#screen .session') && !document.querySelector('#screen .streak')));
check('no Start workout button', await page.evaluate(() => document.getElementById('float').hidden));
check('the food card is on Today', await page.evaluate(() => !!document.querySelector('#screen .fd-card')));
await openSettings();
await page.evaluate(() => document.querySelector('#screen [data-on="setWorkouts"]').click());
await settle(900);
check('and back on', (await tabs()) === 'today,plan,food,health,progress', await tabs());

section('Calories off again');
await page.click('[data-on="setFoodMode"] input[value="protein"]', { force: true });
await settle();
check('Moves is a tab again', (await tabs()) === 'today,plan,health,progress,moves', await tabs());
check('what was logged is kept', (await kcalToday()) > 0);

section('The barcode reader itself');
// An EAN-13 drawn on a canvas, read by the bundled ZXing build (lazy/barcode.js + the .wasm).
const read = await page.evaluate(async () => {
  const code = '3017620422003';
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map((p) => p.split('').reverse().map((b) => (b === '1' ? '0' : '1')).join('')); // R reversed
  const R = L.map((p) => p.split('').map((b) => (b === '1' ? '0' : '1')).join(''));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const c = document.createElement('canvas');
  const unit = 4, quiet = 12;
  c.width = (bits.length + quiet * 2) * unit; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') x.fillRect((quiet + i) * unit, 10, unit, 140);
  const m = await window.GH.lazy('barcode');
  await m.ready;
  const found = await m.detector().detect(c);
  return found.map((b) => `${b.format}:${b.rawValue}`);
});
check('decodes an EAN-13 with the bundled ZXing', read.includes('ean_13:3017620422003'), read);
check('its check digit rule agrees', await page.evaluate(() => window.GH.scanner.checksumOk('3017620422003') && !window.GH.scanner.checksumOk('3017620422004') && window.GH.scanner.expandUpcE('04252614') === '042100005264'));

section('Set-up for food and health only');
{
  const ctx2 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await p2.addInitScript(seedBridge);
  await p2.goto(server.url);
  await p2.waitForSelector('.onboard:not([hidden]) .rf-large-title');
  const title = () => p2.locator('.onboard .rf-large-title').innerText();
  const next = async () => { await p2.locator('.ob-actions [data-variant="tinted"]').click(); await p2.clock.runFor(500); await p2.waitForTimeout(150); };
  await next();
  await p2.click('input[name="obTrack"][value="food"]', { force: true });
  await p2.waitForTimeout(150);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const t = await title();
    seen.push(t);
    if (t === 'About you') { await p2.fill('input[data-k="_w"]', '150'); await p2.locator('input[data-k="_w"]').dispatchEvent('change'); await p2.fill('input[data-k="age"]', '30'); await p2.locator('input[data-k="age"]').dispatchEvent('change'); }
    if (t === 'Your plan') break;
    await next();
  }
  check('workout screens are skipped', !seen.some((t) => ['Goals', 'Experience', 'Schedule', 'Equipment', 'Body check', 'Style', 'Baseline test'].includes(t)), seen.join(' → '));
  check('food is set to calories', seen.includes('Food') && seen.includes('Your plan'), seen.join(' → '));
  check('the last screen shows daily targets', await p2.evaluate(() => /Calories/.test(document.querySelector('.onboard').textContent) && /Steps/.test(document.querySelector('.onboard').textContent)));
  await p2.locator('.ob-actions [data-variant="tinted"]').click();
  await p2.clock.runFor(900); await p2.waitForTimeout(300);
  check('the app opens with Today, Food and Health', await p2.evaluate(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => t.dataset.tab).join(',')) === 'today,food,health');
  check('Today has no workout', await p2.evaluate(() => !!document.querySelector('#screen .day-card') && !document.querySelector('#screen .session')));
  await ctx2.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
