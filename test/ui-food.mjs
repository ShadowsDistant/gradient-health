// Food tracking, in Chromium at phone size with someone five weeks in who tracks protein: the tabs
// with calorie tracking on and off (food never takes one), Health's Track calories invite and the
// + menu, starting in one sheet (and with no weight, asked for there), Health's food section and its
// numbers against the Food page, Add food with the meal the clock picks (Playwright's clock), quick
// add, the built-in food list, a food from a label, online search and a typed barcode (Open Food
// Facts mocked), recent foods most used first with a one-tap add and Undo, the same meal as
// yesterday, each entry's time and a new time moving it to another meal, meal times changing where
// food goes, every food sheet's size at 360 px, meals saved to Health Connect, the food route,
// workouts off, the Food page's part loading ahead of time only for someone tracking calories, and
// set-up's food-only path.
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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
const server = await serveDist();
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
// Now and then the page's deferred boot timer is lost across a reload under the fake clock (a race
// in the test harness, not the app); boot it by hand when that happens.
if (!(await page.waitForSelector('#screen[data-view="today"] .session', { timeout: 10000 }).then(() => true, () => false))) {
  await page.evaluate(() => window.GH.ui.boot());
  await page.waitForSelector('#screen[data-view="today"] .session');
}
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 400)); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(); };
const tabs = () => ev(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => t.dataset.tab).join(','));
const where = () => ev(() => ({ tab: window.GH.ui.route.tab, view: window.GH.ui.route.view }));
const home = async () => { await ev(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* to the tab */ } }); await settle(900); };
const openSettings = async () => { await ev(() => window.GH.ui.open('settings')); await settle(); };
const sheetOpen = (sel) => page.waitForSelector(`dialog.rf-sheet[open] ${sel || ''}`, { timeout: 8000 }).then(() => true, () => false);
const closeSheets = async () => { await ev(() => window.GH.ui.closeSheets()); await settle(900); };
const noSideScroll = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('screen').scrollWidth <= window.innerWidth + 1);
const kcalToday = () => ev(() => window.GH.food.totals(window.GH.ui.S, window.GH.ui.today(), false).kcal);
const meals = () => ev(() => { const m = window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()); return Object.fromEntries(Object.entries(m).map(([k, l]) => [k, l.map((e) => e.name)])); });
const sheetMeal = (name) => ev((n) => (document.querySelector(`dialog.rf-sheet[open] [name="${n}"]:checked`) || {}).value, name);
const menuFood = async () => { await page.click('#topbar [popovertarget="hlLog"]'); await page.waitForSelector('#hlLog [data-act="logFood"]', { state: 'visible', timeout: 5000 }); await settle(300); await page.click('#hlLog [data-act="logFood"]'); };
const undo = () => ev(() => { const b = [...document.querySelectorAll('.rf-toast button')].reverse().find((x) => /Undo/.test(x.textContent)); if (b) b.click(); return !!b; });
// The day's meals at a time on the test's day (it's Oct 19 for the page's clock).
const at = (hm) => page.clock.setSystemTime(new Date(`2026-10-19T${hm}:00`));
const lastHaptic = () => ev(() => window.__haptics[window.__haptics.length - 1]);
const recentHaptics = (n) => ev((k) => window.__haptics.slice(-k), n);
// What's out of line in a food card (or a page of them): the glance's ring label off its middle, the
// macros' slashes, targets and bars not in their columns, links and dividers off the card's text
// edges, a card with more room under its last line than the others, something to tap under 44 px.
// Returns what's wrong, one line each.
const lineUp = (root) => ev((rootSel) => {
  const out = [];
  const R = (e) => e.getBoundingClientRect();
  const ink = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((x) => x.width); return rs.length ? { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)), t: Math.min(...rs.map((x) => x.top)), b: Math.max(...rs.map((x) => x.bottom)), first: rs[0] } : null; };
  const off = (what, a, b, tol) => { if (!(Math.abs(a - b) <= tol)) out.push(`${what}: ${a.toFixed(1)} vs ${b.toFixed(1)}`); };
  const content = (card) => { const r = R(card), s = getComputedStyle(card); return { l: r.left + parseFloat(s.paddingLeft), r: r.right - parseFloat(s.paddingRight) }; };
  // How tall a thing is to a finger: its box, or a hit area its ::before reaches to.
  const hit = (e) => { const r = R(e), b = getComputedStyle(e, '::before'); if (b.content === 'none' || b.position !== 'absolute') return r.height; return Math.max(r.height, r.height - parseFloat(b.top) - parseFloat(b.bottom)); };
  const root = document.querySelector(rootSel);
  if (!root) return [`no ${rootSel}`];
  const scope = root.matches('.card') ? [root] : [...root.querySelectorAll('.card')];
  for (const sum of root.querySelectorAll('.fd-sum')) {
    const card = sum.closest('.card'), c = content(card);
    const ring = sum.querySelector('.rf-ring svg');
    if (ring) {
      const rr = R(ring), lab = R(sum.querySelector('.rf-ring-label'));
      off('the ring label across', (lab.left + lab.right) / 2, (rr.left + rr.right) / 2, 1);
      off('the ring label down', (lab.top + lab.bottom) / 2, (rr.top + rr.bottom) / 2, 1);
      for (const k of sum.querySelectorAll('.rf-ring-label > *')) { const t = ink(k); off(`"${k.textContent}" across the ring`, (t.l + t.r) / 2, (rr.left + rr.right) / 2, 1); }
    }
    const rows = [...sum.querySelectorAll('.fd-macro')];
    if (rows.length) {
      const have = rows.map((m) => ink(m.querySelector('.fd-mhave')).r), want = rows.map((m) => ink(m.querySelector('.fd-mwant')).l), bars = rows.map((m) => R(m.querySelector('.rf-progress')));
      have.forEach((x, i) => off(`the slash of ${rows[i].querySelector('.fd-mk').textContent}`, x, have[0], 0.5));
      want.forEach((x, i) => off(`the target of ${rows[i].querySelector('.fd-mk').textContent}`, x, want[0], 0.5));
      bars.forEach((b, i) => { off(`bar ${i} starts`, b.left, bars[0].left, 0.5); off(`bar ${i} ends at the card's text edge`, b.right, c.r, 1); });
      for (const m of rows) for (const s of ['.fd-mhave', '.fd-mwant']) if (!/tabular-nums/.test(getComputedStyle(m.querySelector(s)).fontVariantNumeric)) out.push(`${s} without tabular figures`);
    }
    const go = sum.querySelector('.fd-go');
    if (go) off('the chevron at the card\'s text edge', R(go).right, c.r, 1);
  }
  for (const card of scope) {
    const c = content(card);
    // A link that starts a line starts at the card's text edge.
    for (const a of card.querySelectorAll('.fd-link')) {
      const p = a.parentElement, line = p.tagName === 'P' ? ink(p).first : null;
      if (!line || R(a).top > line.top + 2) off(`"${a.textContent.trim()}" at the text edge`, R(a).left, line ? ink(p).l : c.l, 1);
    }
    // Dividers between foods: inset like the text, both sides.
    for (const li of card.querySelectorAll('.fd-list > li:not(:last-child)')) {
      const s = getComputedStyle(li, '::after'), r = R(li);
      off('a divider\'s start', r.left + parseFloat(s.left), c.l, 1);
      off('a divider\'s end', r.right - parseFloat(s.right), c.r, 1);
    }
    for (const m of card.querySelectorAll('.hf-meal')) { off('a meal row\'s start', R(m).left, c.l, 1); off('a meal row\'s end', R(m).right, c.r, 1); }
    // Things to tap.
    for (const b of card.querySelectorAll('button, .rf-segment')) if (R(b).height && hit(b) < 43.5) out.push(`"${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30)}" is ${hit(b).toFixed(1)} px to a finger`);
  }
  // A meal card ends 16 px or so under its last line, whatever's in it.
  // (A meal with only its title is centred on it, so it isn't counted.)
  const room = [...root.querySelectorAll('.card.fd-meal')].filter((card) => card.querySelector('.fd-list, .fd-same')).map((card) => {
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT); let b = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const x of rg.getClientRects()) b = Math.max(b, x.bottom); }
    return { key: card.dataset.key, room: R(card).bottom - b };
  });
  if (room.length) {
    const lo = Math.min(...room.map((x) => x.room)), hi = Math.max(...room.map((x) => x.room));
    if (hi - lo > 4 || hi > 22) out.push(`room under a meal's last line: ${room.map((x) => `${x.key} ${x.room.toFixed(1)}`).join(', ')}`);
  }
  // The day: as wide as the cards, the day in its middle, its arrows 44 px.
  const days = root.querySelector('.fd-days');
  if (days) {
    const card = root.querySelector('.card'), d = R(days), t = ink(days.querySelector('.fd-day'));
    off('the day control\'s start', d.left, R(card).left, 1);
    off('the day control\'s end', d.right, R(card).right, 1);
    off('the day across its control', (t.l + t.r) / 2, (d.left + d.right) / 2, 1);
    for (const b of days.querySelectorAll('button')) if (R(b).height < 43.5 || R(b).width < 43.5) out.push(`a day arrow is ${R(b).width.toFixed(0)} x ${R(b).height.toFixed(0)}`);
  }
  return out;
}, root);

section('The tabs, with calorie tracking off and on');
check('protein tracking: Today, Plan, Health, Progress and You', (await tabs()) === 'today,plan,health,progress,you', await tabs());
await openSettings();
await page.click('[data-on="setFoodMode"] input[value="full"]', { force: true });
await settle();
check('calories on: the same tabs, food doesn\'t take one', (await tabs()) === 'today,plan,health,progress,you', await tabs());
check('the food settings show up, with Meal times and Activity', await ev(() => !!document.querySelector('#food') && !!document.querySelector('[data-on="setWeightGoal"]') && !!document.querySelector('#screen [data-act="foodMealTimes"]') && !!document.querySelector('#screen [data-on="setFoodAct"]')));
const cut = await ev(() => [...document.querySelectorAll('#screen .rf-list-title')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
check('no setting title is cut off', cut.length === 0, cut.join(' | '));
check('no sideways scroll in Settings', await noSideScroll());
const foot = await ev(() => { const p = document.querySelector('#screen .rf-list-footer[data-group="track"]'); const a = p && p.querySelector('.fd-link'); if (!a) return null; const rg = document.createRange(); rg.selectNodeContents(p); const rs = [...rg.getClientRects()].filter((x) => x.width); const r = a.getBoundingClientRect(); return { ownLine: r.top > rs[0].top + 2, link: r.left, text: Math.min(...rs.map((x) => x.left)) }; });
check('the food rows\' How it\'s worked out starts at the footer\'s text edge when it starts a line', !!foot && (!foot.ownLine || Math.abs(foot.link - foot.text) <= 1), JSON.stringify(foot));
await page.fill('#setQ', 'breakfast');
await page.locator('#setQ').dispatchEvent('input');
await settle(300);
check('searching Settings for breakfast finds Meal times', await ev(() => { const r = document.querySelector('#screen [data-key="meal-times"]'); return !!r && r.offsetParent !== null; }));
await page.fill('#setQ', '');
await page.locator('#setQ').dispatchEvent('input');
await page.click('[data-on="setFoodMode"] input[value="protein"]', { force: true });
await settle();
check('and off again: still the same tabs', (await tabs()) === 'today,plan,health,progress,you' && await ev(() => window.GH.food.mode(window.GH.ui.S) === 'protein'), await tabs());
await home();

section('Health without calorie tracking');
await tab('health');
check('a small Track calories invite after the week, before Today', await ev(() => { const s = document.getElementById('screen'); const inv = s.querySelector('.hf-invite'), week = s.querySelector('.hl-week'), today = [...s.querySelectorAll('.sec-title')].find((h) => h.textContent.trim() === 'Today'); return !!inv && !!week && !!today && week.compareDocumentPosition(inv) & 4 && inv.compareDocumentPosition(today) & 4; }));
await page.click('#topbar [popovertarget="hlLog"]');
await page.waitForSelector('#hlLog [data-act="logFood"]', { state: 'visible', timeout: 5000 });
const items = await ev(() => [...document.querySelectorAll('#hlLog .rf-menu-item')].map((b) => b.textContent.trim()).join());
check('the + menu has Food first', items === 'Food,Weight,Sleep,Feel check,Other exercise,Measurements', items);
await page.click('#hlLog [data-act="logFood"]');
check('with calorie tracking off, Food opens Track calories', await sheetOpen('.fd-start'));
await closeSheets();
check('closing it starts nothing', await ev(() => window.GH.food.mode(window.GH.ui.S) === 'protein'));
await ev(() => { location.hash = '#food'; });
await settle(900);
check('the food route without calorie tracking goes to Health', (await where()).tab === 'health' && !(await where()).view, JSON.stringify(await where()));
await ev(() => { history.replaceState(null, '', location.pathname); });

section('Starting, with no weight yet: asked for in the sheet');
// No weigh-ins and no weight in the profile (kept aside, and put back after).
await ev(() => { const S = window.GH.ui.S; window.__w = S.weights; S.weights = []; window.__wk = S.profile.weightKg; S.profile.weightKg = null; window.GH.ui.render(); });
await settle();
await page.click('#screen .hf-invite [data-act="foodStart"]');
await sheetOpen('.fd-start');
await settle(700);
check('the weight is asked for right there, and there\'s no target yet', await ev(() => !!document.querySelector('dialog.rf-sheet[open] #fsW') && !document.querySelector('dialog.rf-sheet[open] .fd-target-n')));
await page.click('dialog.rf-sheet[open] [data-act="fsGo"]');
await settle(500);
check('Start without it says what\'s needed', await ev(() => window.GH.food.mode(window.GH.ui.S) === 'protein' && /Add your weight/.test([...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' '))));
await page.fill('dialog.rf-sheet[open] #fsW', '150');
await page.locator('dialog.rf-sheet[open] #fsW').dispatchEvent('change');
await settle(500);
check('typing it in shows the target', await ev(() => { const n = document.querySelector('dialog.rf-sheet[open] .fd-target-n [data-roll]'); return !!n && Number(n.dataset.roll.replace(/,/g, '')) > 1200; }));
await closeSheets();
await ev(() => { const S = window.GH.ui.S; S.weights = window.__w; S.profile.weightKg = window.__wk; window.GH.ui.render(); });
await settle();

section('Starting in one sheet');
await page.click('#screen .hf-invite [data-act="foodStart"]');
check('Track calories opens one short sheet', await sheetOpen('.fd-start'));
await settle(700);
const start = await ev(() => {
  const d = document.querySelector('dialog.rf-sheet[open]');
  const S = window.GH.ui.S;
  return { n: Number(d.querySelector('.fd-target-n [data-roll]').dataset.roll.replace(/,/g, '')), basis: d.querySelector('.fd-basis').textContent, goal: (d.querySelector('[name="fsGoal"]:checked') || {}).value, wanted: S.profile.weightGoal || 'maintain', fields: d.querySelectorAll('input.rf-input').length, detent: d.dataset.detent };
});
check('it suggests a target from what the app knows, with the goal picked', start.n > 1200 && start.goal === start.wanted && /lb/.test(start.basis) && /steps/.test(start.basis) && /age 24/.test(start.basis), JSON.stringify(start));
check('and nothing to fill in when it knows enough', start.fields === 0, start.fields);
await page.click('dialog.rf-sheet[open] [data-on="fsGoal"] input[value="lose"]', { force: true });
const target = () => ev(() => Number(document.querySelector('dialog.rf-sheet[open] .fd-target-n [data-roll]').dataset.roll.replace(/,/g, '')));
let lose = start.n;
for (let i = 0; i < 8 && lose === start.n; i++) { await settle(300); lose = await target(); }
check('picking Lose lowers it, with a pace to pick', lose < start.n && await ev(() => !!document.querySelector('dialog.rf-sheet[open] [data-on="fsPace"]')), `${start.n} → ${lose}`);
await page.click('dialog.rf-sheet[open] [data-act="fsMore"]');
await settle(900);
check('Change shows each part of it to change: weight, height, age, sex and activity', await ev(() => ['#fsW', '#fsFt', '#fsIn', '#fsAge', '[data-on="fsSex"]', '[data-on="fsAct"]'].every((s) => document.querySelector(`dialog.rf-sheet[open] ${s}`))));
await page.click('dialog.rf-sheet[open] [data-on="fsGoal"] input[value="maintain"]', { force: true });
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="fsGo"]');
await settle(1200);
const on = await ev(() => { const GH = window.GH, S = GH.ui.S; return { mode: GH.food.mode(S), goal: S.profile.weightGoal, sheets: document.querySelectorAll('dialog.rf-sheet[open]').length, view: GH.ui.route.view, tab: GH.ui.route.tab, target: GH.food.targets(S, GH.ui.today()).kcal }; });
check('Start turns calorie tracking on, with no other screens', on.mode === 'full' && on.goal === 'maintain' && on.sheets === 0 && on.tab === 'health' && !on.view, JSON.stringify(on));
check('at the target it showed', on.target === start.n, `${start.n} vs ${on.target}`);
check('the tabs stay as they were', (await tabs()) === 'today,plan,health,progress,you', await tabs());

section('Health\'s food section');
check('in the invite\'s place: after the week, before Today', await ev(() => { const s = document.getElementById('screen'); const f = s.querySelector('.hf'), week = s.querySelector('.hl-week'), today = [...s.querySelectorAll('.sec-title')].find((h) => h.textContent.trim() === 'Today'); return !!f && !s.querySelector('.hf-invite') && week.compareDocumentPosition(f) & 4 && f.compareDocumentPosition(today) & 4; }));
check('the four meals, each with its time while it\'s empty', await ev(() => { const m = [...document.querySelectorAll('#screen .hf-meal')]; return m.length === 4 && m.map((x) => x.querySelector('.hf-meal-k').textContent).join() === 'Breakfast,Lunch,Dinner,Snacks' && /5 to 11\sam/.test(m[0].textContent) && /Any other time/.test(m[3].textContent); }));
check('Add food is the main button, with Scan', await ev(() => { const b = document.querySelector('#screen .hf-btns'); return !!b.querySelector('[data-act="foodAdd"][data-variant="filled"]') && !!b.querySelector('[data-act="foodScan"]'); }));
check('no sideways scroll', await noSideScroll());

section('Add food from the + menu, the meal picked by the clock');
await at('08:10');
await menuFood();
check('at 8:10 am it opens Add food for breakfast', await sheetOpen('.fd-search') && (await sheetMeal('foodAddMeal')) === 'breakfast', await sheetMeal('foodAddMeal'));
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="foodQuick"]');
await settle(700);
check('quick add is there, with the meal and the time', (await sheetMeal('qMeal')) === 'breakfast' && await ev(() => document.querySelector('dialog.rf-sheet[open] #qTime').value === '08:10'));
await page.fill('#qKcal', '450');
await page.fill('#qP', '30');
await page.click('dialog.rf-sheet[open] [data-act="foodQuickSave"]');
await settle(900);
check('quick add counts toward today, in breakfast', (await kcalToday()) === 450 && (await meals()).breakfast.length === 1, await meals());
check('it was saved to Health Connect', await ev(() => window.__foodWrites.length === 1 && window.__foodWrites[0].kcal === 450 && window.__foodWrites[0].meal === 'breakfast'));
await at('12:35');
await menuFood();
await sheetOpen('.fd-search');
await settle(600);
check('at 12:35 pm, lunch', (await sheetMeal('foodAddMeal')) === 'lunch', await sheetMeal('foodAddMeal'));
await closeSheets();
await at('16:05');
await menuFood();
await sheetOpen('.fd-search');
await settle(600);
check('at 4:05 pm, between meals, snacks', (await sheetMeal('foodAddMeal')) === 'snack', await sheetMeal('foodAddMeal'));
await closeSheets();
await at('08:12');

section('The built-in food list');
await page.click('#screen .hf-btns [data-act="foodAdd"]');
await sheetOpen('.fd-search');
await settle(600);
await page.fill('#foodQ', 'banana');
await page.waitForFunction(() => document.querySelector('dialog.rf-sheet[open] [data-act="foodPick"][data-arg^="usda:"]'), null, { timeout: 10000 });
await settle(400);
const first = await ev(() => { const b = document.querySelector('dialog.rf-sheet[open] [data-act="foodPick"][data-arg^="usda:"]'); return b && b.querySelector('.rf-list-title').textContent; });
check('search as you type finds it first', first === 'Banana', first);
await page.click('dialog.rf-sheet[open] [data-act="foodPick"][data-arg^="usda:"]');
await sheetOpen('.fd-portion');
await settle(700);
const cup = await ev(() => { const c = [...document.querySelectorAll('dialog.rf-sheet[open] .fd-portion [data-act="foodPortion"]')].find((x) => /sliced/.test(x.textContent)); if (c) c.click(); return !!c; });
await settle(400);
check('with household portions', cup);
check('and its meal and time', (await sheetMeal('foodMeal')) === 'breakfast' && await ev(() => document.querySelector('dialog.rf-sheet[open] #foodTime').value === '08:12'));
const before = await kcalToday();
await page.click('dialog.rf-sheet[open] [data-act="foodSave"]');
await settle(900);
check('a cup of sliced banana is 134 kcal', (await kcalToday()) - before === 134, (await kcalToday()) - before);
check('and it shows up under Recent', await ev(() => window.GH.food.data(window.GH.ui.S).recent[0] === 'usda:9040'));

section('A food from its label');
await page.click('#screen .hf-btns [data-act="foodAdd"]');
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
check('one bar is 220 kcal', (await kcalToday()) === 450 + 134 + 220, await kcalToday());
check('it\'s kept under My foods', await ev(() => window.GH.food.data(window.GH.ui.S).custom.some((c) => c.name === 'Protein bar' && c.per100.kcal === 367)));

section('Scanning a barcode, typed in');
// Scan with online lookups off asks to turn them on, once.
await page.click('#screen .hf-btns [data-act="foodScan"]');
await settle(700);
const asked = await ev(() => !!document.querySelector('.rf-dialog') || [...document.querySelectorAll('dialog[open]')].some((d) => /Open Food Facts/.test(d.textContent)));
check('Scan asks before looking barcodes up online', asked);
await ev(() => { const b = [...document.querySelectorAll('dialog[open] button')].find((x) => x.textContent.trim() === 'Turn on'); if (b) b.click(); });
check('the scanner opens', await sheetOpen('.sc-wrap'));
check('and online search and barcodes are on', await ev(() => window.GH.food.prefs(window.GH.ui.S).online === true));
await settle(1500);
await ev(() => { const a = window.GH.ui.act.scanType; if (a) a(); });
await settle(400);
check('Type the number plays a tap, and its field takes the button\'s place', (await lastHaptic()) === 'tap' && await ev(() => { const d = document.querySelector('dialog.rf-sheet[open]'); return d.querySelector('[data-act="scanType"]').hidden && !d.querySelector('.sc-type').hidden && !!d.querySelector('#scCode').getBoundingClientRect().height; }));
await page.fill('#scCode', '3017620422004');
await page.press('#scCode', 'Enter');
await settle(600);
check('a wrong check digit is caught', await ev(() => !!document.querySelector('dialog.rf-sheet[open] .sc-wrap')));
await page.fill('#scCode', '3017620422003');
await page.press('#scCode', 'Enter');
check('the right one looks it up and opens it', await sheetOpen('.fd-portion'));
await settle(700);
check('it\'s the right product', await ev(() => /Hazelnut spread/.test(document.querySelector('dialog.rf-sheet[open] .rf-sheet-title').textContent)));
await closeSheets();

section('Online search');
await page.click('#screen .hf-btns [data-act="foodAdd"]');
await sheetOpen('.fd-search');
await settle(600);
await page.fill('#foodQ', 'hazelnut');
await settle(900);
check('the online search button shows', await ev(() => !!document.querySelector('dialog.rf-sheet[open] [data-act="foodOnline"]')));
await page.click('dialog.rf-sheet[open] [data-act="foodOnline"]');
await settle(900);
const found = await ev(() => [...document.querySelectorAll('dialog.rf-sheet[open] [data-act="foodPick"][data-arg^="off:"]')].map((b) => b.textContent));
check('results come back, cleaned up', found.length === 1 && /Hazelnut spread/.test(found[0]), found);
await page.click('dialog.rf-sheet[open] [data-act="foodPick"][data-arg^="off:"]');
check('picking one opens its portions', await sheetOpen('.fd-portion'));
await settle(700);
check('with its serving size', await ev(() => /1 serving/.test(document.querySelector('dialog.rf-sheet[open] .fd-portion').textContent)));
await page.click('dialog.rf-sheet[open] [data-act="foodSave"]');
await settle(900);
check('added (a serving is 15 g)', (await kcalToday()) === 450 + 134 + 220 + 81, await kcalToday());

section('Health\'s section and the Food page agree');
// (Both draw the same glance: food.js.)
const glanceOf = (root) => ev((r) => { const s = document.querySelector(r); const n = (sel) => Number((s.querySelector(`${sel} [data-roll]`) || s.querySelector(sel)).getAttribute('data-roll').replace(/,/g, '')); return { view: window.GH.ui.route.view, back: !!document.querySelector('#topbar [data-act="back"]'), left: n('.fd-ring-n'), eaten: n('.fd-kcal b'), word: s.querySelector('.fd-ring-l').textContent, macros: [...s.querySelectorAll('.fd-macro')].map((x) => x.textContent.replace(/\s+/g, '')) }; }, root);
const sec = await glanceOf('#screen .hf .fd-sum');
await page.click('#screen .hf-main');
await settle(1200);
const pg = await glanceOf('#screen .fd-sumcard .fd-sum');
check('tapping the section opens the Food page, with Back', pg.view === 'food' && pg.back, JSON.stringify(pg));
check('the same calories left (or over) and eaten', sec.left === pg.left && sec.eaten === pg.eaten && sec.word === pg.word && sec.eaten === await kcalToday(), JSON.stringify({ sec, pg }));
check('and the same protein, carbs and fat', sec.macros.join() === pg.macros.join(), JSON.stringify({ sec: sec.macros, pg: pg.macros }));

section('Every entry shows its time');
const rows = await ev(() => [...document.querySelectorAll('#screen .fd-meal[data-key="meal-breakfast"] .fd-list .rf-list-sub')].map((x) => x.textContent));
check('each row starts with when it was added', rows.length === 4 && rows.every((r) => /^8:1\d\sam/.test(r)), rows);
check('sorted by time within the meal', await ev(() => { const l = window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).breakfast; return l.every((e, i) => !i || l[i - 1].t <= e.t); }));
// The quick add from the clock's pick: a new time moves it to that time's meal.
await page.click('#screen .fd-meal[data-key="meal-breakfast"] [data-act="foodEdit"]');
check('editing an entry offers its meal and time', await sheetOpen('#qTime'));
await settle(700);
await page.fill('dialog.rf-sheet[open] #qTime', '13:05');
await page.locator('dialog.rf-sheet[open] #qTime').dispatchEvent('change');
await settle(500);
check('a new time picks that time\'s meal', (await sheetMeal('qMeal')) === 'lunch', await sheetMeal('qMeal'));
await page.click('dialog.rf-sheet[open] [data-act="foodQuickSave"]');
await settle(900);
const moved = await ev(() => { const l = window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).lunch; const e = l.find((x) => x.kcal === 450); return e ? { t: new Date(e.t).toTimeString().slice(0, 5), at: e.at, v: e.v } : null; });
check('and the entry moves there, at that time', moved && moved.t === '13:05' && moved.at === 'set' && moved.v === 1, JSON.stringify(moved));
check('Health Connect gets the new version', await ev(() => window.__foodWrites.some((w) => w.kcal === 450 && w.meal === 'lunch' && w.v === 1)));
// One picked by hand stays in its meal.
await page.click('#screen .fd-meal[data-key="meal-snack"] [data-act="foodAdd"][data-arg="snack"]');
await sheetOpen('.fd-search');
await settle(600);
await page.click('dialog.rf-sheet[open] [data-act="foodQuick"]');
await settle(700);
check('a meal\'s + adds to that meal', (await sheetMeal('qMeal')) === 'snack');
await page.fill('#qKcal', '120');
await page.fill('dialog.rf-sheet[open] #qTime', '13:20');
await page.locator('dialog.rf-sheet[open] #qTime').dispatchEvent('change');
await settle(500);
check('then a new time keeps the meal picked by hand', (await sheetMeal('qMeal')) === 'snack');
await page.click('dialog.rf-sheet[open] [data-act="foodQuickSave"]');
await settle(900);
check('saved there, marked as picked, at the time set', await ev(() => { const e = window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).snack.find((x) => x.kcal === 120); return !!e && e.mh === 1 && e.at === 'set' && new Date(e.t).getHours() === 13; }));

section('Recent foods, most used first');
// Oats on three of the last days, a pear on one: oats come first.
await ev(() => { const GH = window.GH, S = GH.ui.S, F = GH.food, d = GH.ui.today(); for (let k = 1; k <= 3; k++) F.add(S, d - k, { name: 'Oatmeal, cooked', src: 'usda', ref: 8121, g: 234, portion: '1 cup', kcal: 166, p: 5.9, c: 28, f: 3.6 }, Date.now() - k * 86400000); F.add(S, d - 2, { name: 'Pear', src: 'usda', ref: 9252, g: 178, portion: '1 medium', kcal: 101, p: 0.6, c: 27, f: 0.3 }, Date.now() - 2 * 86400000); GH.store.save(S); });
await page.click('#topbar [data-act="foodAdd"]');
await sheetOpen('.fd-search');
await settle(900);
const recent = await ev(() => [...document.querySelectorAll('dialog.rf-sheet[open] .fd-reg')].map((r) => ({ name: r.querySelector('.rf-list-title').textContent, sub: r.querySelector('.rf-list-sub').textContent, plus: !!r.querySelector('[data-act="foodAgain"]') })));
check('Add food opens on Recent, the food logged most first', await ev(() => (document.querySelector('dialog.rf-sheet[open] [name="foodTab"]:checked') || {}).value === 'recent') && recent[0] && recent[0].name === 'Oatmeal, cooked', JSON.stringify(recent));
check('each with its last portion and a one-tap add', recent.length >= 3 && recent.every((r) => r.plus) && recent[0].sub === '1 cup · 166 kcal', JSON.stringify(recent));
const b0 = await kcalToday();
await page.click('dialog.rf-sheet[open] .fd-reg [data-act="foodAgain"][data-arg="usda:8121"]');
await settle(700);
check('one tap adds it as it was, to the meal picked, and the sheet stays for more', (await kcalToday()) - b0 === 166 && (await meals()).breakfast.includes('Oatmeal, cooked') && await ev(() => !!document.querySelector('dialog.rf-sheet[open] .fd-search')), await meals());
check('with Undo', await undo());
await settle(700);
check('which takes it back out', (await kcalToday()) === b0, await kcalToday());
await closeSheets();

section('The same meal as yesterday');
await ev(() => { const GH = window.GH, S = GH.ui.S, F = GH.food, d = GH.ui.today(); const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(19, 15, 0, 0); F.add(S, d - 1, { name: 'Salmon and potatoes', src: 'quick', kcal: 710, p: 40, c: 55, f: 30, meal: 'dinner' }, y.getTime()); F.add(S, d - 1, { name: 'Salad', src: 'quick', kcal: 90, p: 2, c: 8, f: 6, meal: 'dinner' }, y.getTime() + 60000); GH.store.save(S); GH.ui.render(); });
await settle(700);
check('an empty meal on the Food page offers yesterday\'s', await ev(() => /Same as yesterday, 800 kcal/.test(document.querySelector('#screen .fd-meal[data-key="meal-dinner"] .fd-same').textContent)));

section('Lined up: the Food page');
// Full meals and an empty one with yesterday's to add: the day, the glance, the links, the dividers
// and the room under each meal's last line, at this width and at 360.
for (const w of [...new Set([width, 360])]) {
  await page.setViewportSize({ width: w, height: 844 });
  await settle(700);
  const bad = await lineUp('#screen');
  check(`at ${w} px: everything in line, centred where it should be, and 44 px to a finger`, bad.length === 0, bad.join('\n      '));
}
await page.setViewportSize({ width, height: 844 });
await settle(600);
await page.click('#screen .fd-days [data-act="foodDayPrev"]');
await settle(700);
check('the day before is a tap away, with the day haptic', (await lastHaptic()) === 'day' && await ev(() => document.querySelector('#screen .fd-day').textContent === 'Yesterday'));
await page.click('#screen .fd-days [data-act="foodDayNext"]');
await settle(700);
check('and back', await ev(() => document.querySelector('#screen .fd-day').textContent === 'Today'));
await page.click('#screen .fd-days [data-act="foodDayNext"]', { force: true });
await settle(400);
check('no day after today: its arrow answers with an edge, and the day stays', (await lastHaptic()) === 'edge' && await ev(() => document.querySelector('#screen .fd-day').textContent === 'Today'));

section('Copy yesterday and Delete: one tap each, with Undo');
const k0 = await kcalToday(), yk = await ev(() => window.GH.food.totals(window.GH.ui.S, window.GH.ui.today() - 1, false).kcal);
await page.click('#screen .fd-tools [data-act="foodCopyYesterday"]');
await settle(800);
check('Copy yesterday adds the whole day before in one tap, with nothing to confirm', (await kcalToday()) - k0 === yk && !(await ev(() => !!document.querySelector('dialog[open]:not(.rf-sheet)'))) && (await recentHaptics(3)).includes('copy'), `${k0} + ${yk} → ${await kcalToday()}`);
check('with Undo', await undo());
await settle(800);
check('which takes it all back out', (await kcalToday()) === k0 && (await recentHaptics(2)).includes('undo'), await kcalToday());
await page.click('#screen .fd-meal[data-key="meal-snack"] [data-act="foodEdit"]');
await sheetOpen('[data-act="foodQuickDelete"]');
await settle(700);
check('Delete is red, beside Save', await ev(() => { const b = document.querySelector('dialog.rf-sheet[open] [data-act="foodQuickDelete"]'); const c = getComputedStyle(b).color, red = getComputedStyle(document.documentElement).getPropertyValue('--critical').trim(); const probe = document.createElement('span'); probe.style.color = red; document.body.appendChild(probe); const want = getComputedStyle(probe).color; probe.remove(); return c === want; }));
await page.click('dialog.rf-sheet[open] [data-act="foodQuickDelete"]');
await settle(900);
check('Delete takes it out at once, with the remove haptic', (await kcalToday()) === k0 - 120 && (await recentHaptics(3)).includes('remove'), await kcalToday());
check('with Undo', await undo());
await settle(800);
check('which puts it back as it was, in the meal it was in', (await kcalToday()) === k0 && await ev(() => window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).snack.some((e) => e.kcal === 120 && e.mh === 1)) && (await recentHaptics(2)).includes('undo'), await kcalToday());
// Moving it to another meal: open it, pick the meal, Save (and back again).
const moveTo = async (from, to) => {
  const arg = await ev(([f]) => { const d = window.GH.ui.today(), e = window.GH.food.byMeal(window.GH.ui.S, d)[f].find((x) => x.kcal === 120); return e ? `${d}:${e.id}` : null; }, [from]);
  await page.click(`#screen [data-act="foodEdit"][data-arg="${arg}"]`);
  await sheetOpen('[data-on="quickMeal"]');
  await settle(700);
  await page.click(`dialog.rf-sheet[open] [data-on="quickMeal"] input[value="${to}"]`, { force: true });
  await settle(400);
  await page.click('dialog.rf-sheet[open] [data-act="foodQuickSave"]');
  await settle(900);
  return ev(([t]) => { const m = window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()); return m[t].some((e) => e.kcal === 120) && /120/.test(document.querySelector(`#screen .fd-meal[data-key="meal-${t}"]`).textContent); }, [to]);
};
check('an entry moves to another meal: open it, pick the meal, Save', await moveTo('snack', 'lunch') && (await recentHaptics(3)).includes('save'));
check('and back', await moveTo('lunch', 'snack'));
await page.click('#screen .fd-meal[data-key="meal-dinner"] [data-act="foodAdd"]');
await sheetOpen('.fd-search');
await settle(700);
check('and so does Add food, for that meal', await ev(() => { const r = document.querySelector('dialog.rf-sheet[open] .fd-same-list [data-act="foodSame"]'); return !!r && r.dataset.arg === 'dinner' && /Salmon and potatoes, Salad · 800 kcal/.test(r.textContent); }));
const b1 = await kcalToday();
await page.click('dialog.rf-sheet[open] .fd-same-list [data-act="foodSame"]');
await settle(900);
const din = await ev(() => window.GH.food.byMeal(window.GH.ui.S, window.GH.ui.today()).dinner.map((e) => ({ name: e.name, h: new Date(e.t).getHours(), m: new Date(e.t).getMinutes(), at: e.at })));
check('one tap adds them, at the same time of day', (await kcalToday()) - b1 === 800 && din.length === 2 && din[0].h === 19 && din[0].m === 15 && din.every((e) => e.at === 'copy'), JSON.stringify(din));
check('the sheet goes once the meal is in', await ev(() => !document.querySelector('dialog.rf-sheet[open]')));

section('Meal times');
await ev(() => window.GH.ui.act.foodMealTimes());
check('the sheet opens: breakfast, lunch and dinner from and to, snacks any other time', await sheetOpen('.fd-times') && await ev(() => document.querySelectorAll('dialog.rf-sheet[open] .fd-trow input[type="time"]').length === 6 && /Any other time/.test(document.querySelector('dialog.rf-sheet[open] .fd-times').textContent)));
await settle(700);
check('learning from the logs is on to start with, and says what it does', await ev(() => { const s = document.querySelector('dialog.rf-sheet[open] [data-on="mtLearn"]'); return s.checked && /when you usually log it/.test(s.closest('.rf-list-row').textContent); }));
await page.fill('dialog.rf-sheet[open] #mt-breakfast-1', '08:00');
await page.locator('dialog.rf-sheet[open] #mt-breakfast-1').dispatchEvent('change');
await settle(600);
check('setting a time yourself turns learning off', await ev(() => !document.querySelector('dialog.rf-sheet[open] [data-on="mtLearn"]').checked));
await page.click('dialog.rf-sheet[open] [data-act="mtSave"]');
await settle(900);
check('saved: breakfast ends at 8 am', await ev(() => { const p = window.GH.food.prefs(window.GH.ui.S); return p.learn === false && p.meals.breakfast[1] === 480; }));
check('and Settings\' Meal times row says so', await ev(() => /^Breakfast 5 to 8\sam, Lunch 11\sam to 3\spm, Dinner 5 to 10\spm$/.test(window.GH.ui.mealTimesLine(window.GH.ui.S))), await ev(() => window.GH.ui.mealTimesLine(window.GH.ui.S)));
await home();
await at('08:30');
await menuFood();
await sheetOpen('.fd-search');
await settle(600);
check('so food added at 8:30 am goes in snacks', (await sheetMeal('foodAddMeal')) === 'snack', await sheetMeal('foodAddMeal'));
await closeSheets();
await ev(() => window.GH.ui.act.foodMealTimes());
await sheetOpen('.fd-times');
await settle(700);
await page.fill('dialog.rf-sheet[open] #mt-lunch-0', '10:30');
await page.locator('dialog.rf-sheet[open] #mt-lunch-0').dispatchEvent('change');
await page.fill('dialog.rf-sheet[open] #mt-breakfast-1', '11:00');
await page.locator('dialog.rf-sheet[open] #mt-breakfast-1').dispatchEvent('change');
await page.click('dialog.rf-sheet[open] [data-act="mtSave"]');
await settle(700);
check('meals that overlap aren\'t saved', await ev(() => !!document.querySelector('dialog.rf-sheet[open] .fd-times') && window.GH.food.prefs(window.GH.ui.S).meals.breakfast[1] === 480));
await ev(() => { const s = document.querySelector('dialog.rf-sheet[open] [data-on="mtLearn"]'); if (!s.checked) s.click(); });
await settle(900);
await page.click('dialog.rf-sheet[open] [data-act="mtSave"]');
await settle(900);
check('learning back on', await ev(() => window.GH.food.prefs(window.GH.ui.S).learn === true));
// (The usual times again for what follows.)
await ev(() => { delete window.GH.food.prefs(window.GH.ui.S).meals; window.GH.ui.save(); });
await at('08:40');

section('Each food sheet at 360 px');
await page.setViewportSize({ width: 360, height: 780 });
await settle(600);
// Every button in the sheet shows (none below the screen, none off its sides; a full sheet's list
// scrolls, so there only the sides count), nothing scrolls sideways, and an auto sheet that fits
// isn't padded out with empty space.
const fits = () => ev(() => {
  const d = [...document.querySelectorAll('dialog.rf-sheet[open]')].pop();
  if (!d) return { ok: false, why: 'no sheet' };
  const body = d.querySelector('.rf-sheet-body'), panel = d.querySelector('.gh-sheet-panel').getBoundingClientRect();
  const btns = [...body.querySelectorAll('button, .rf-btn')].filter((b) => b.getBoundingClientRect().height && !b.closest('[data-hscroll]'));
  const full = d.dataset.size === 'full';
  const off = btns.filter((b) => { const r = b.getBoundingClientRect(); return (!full && r.bottom > innerHeight + 1) || r.right > innerWidth + 1 || r.left < -1; }).map((b) => b.textContent.trim() || b.getAttribute('aria-label'));
  const side = body.scrollWidth > body.clientWidth + 1;
  const content = body.offsetTop + body.scrollHeight;
  const empty = d.dataset.size === 'auto' ? Math.round((innerHeight - panel.top) - content) : 0;
  return { ok: !off.length && !side && empty < 48, off, side, empty, size: d.dataset.size, detent: d.dataset.detent };
});
const sizes = {};
const sheetCheck = async (name, open, sel) => {
  await open();
  await sheetOpen(sel);
  await settle(1100);
  sizes[name] = await fits();
  check(`${name}: every button shows, nothing spills, no empty space`, sizes[name].ok, JSON.stringify(sizes[name]));
  await closeSheets();
};
await sheetCheck('Add food', () => ev(() => window.GH.ui.act.foodAdd()), '.fd-search');
await sheetCheck('a portion', async () => { await ev(() => window.GH.ui.act.foodAdd()); await sheetOpen('.fd-reg'); await settle(700); await page.click('dialog.rf-sheet[open] .fd-reg-main'); }, '.fd-portion');
await sheetCheck('quick add', () => ev(() => window.GH.ui.act.foodQuick()), '#qKcal');
await sheetCheck('create a food', () => ev(() => window.GH.ui.act.foodCreate()), '#cName');
await sheetCheck('saved meals', async () => { await ev(() => window.GH.ui.act.foodSaveDay()); await sheetOpen('#mName'); await settle(600); await page.fill('#mName', 'Usual breakfast'); await page.click('dialog.rf-sheet[open] [data-act="foodSaveDayOk"]'); await settle(900); await ev(() => window.GH.ui.act.foodSavedMeals()); }, '[data-act="foodAddSaved"]');
await sheetCheck('meal times', () => ev(() => window.GH.ui.act.foodMealTimes()), '.fd-times');
await sheetCheck('track calories', () => ev(() => window.GH.ui.act.foodStart()), '.fd-start');
await sheetCheck('track calories, with each part open', async () => { await ev(() => window.GH.ui.act.foodStart()); await sheetOpen('.fd-start'); await settle(600); await page.click('dialog.rf-sheet[open] [data-act="fsMore"]'); }, '#fsAge');
await sheetCheck('save as a meal', () => ev(() => window.GH.ui.act.foodSaveDay()), '#mName');
check('the forms open showing all of themselves', ['a portion', 'quick add', 'create a food', 'meal times', 'track calories'].every((n) => sizes[n].size === 'auto'), JSON.stringify(sizes));

section('The keyboard never covers the field or the main button');
// On a phone the app's page gets shorter by the keyboard's height, and the shell says it's up. With
// the last field of each form typed in (the scanner's camera doesn't start here, so its number field
// opens by itself), the field and the button that sends it are both in sight, and nothing is on them.
const keyboard = async (on) => { await page.setViewportSize({ width: 360, height: on ? 844 - 320 : 780 }); await ev((o) => window.__gh.setInsets({ top: 30, bottom: o ? 0 : 20, left: 0, right: 0, keyboard: o }), on); await settle(900); };
const inSight = (f, m) => ev(([field, main]) => {
  const d = [...document.querySelectorAll('dialog.rf-sheet[open]')].pop();
  const body = d.querySelector('.rf-sheet-body').getBoundingClientRect();
  const why = [];
  const seen = (sel) => { const e = d.querySelector(sel), r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const ok = r.top >= body.top - 1 && r.bottom <= Math.min(body.bottom, innerHeight) + 1 && !!top && (top === e || e.contains(top) || top.contains(e)); if (!ok) why.push(`${sel} at ${Math.round(r.top)}..${Math.round(r.bottom)} in ${Math.round(body.top)}..${Math.round(Math.min(body.bottom, innerHeight))}, under ${top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : 'nothing'}`); return ok; };
  return { field: seen(field), main: seen(main), focused: document.activeElement === d.querySelector(field), why, detent: d.dataset.detent, sheets: document.querySelectorAll('dialog.rf-sheet[open]').length };
}, [f, m]);
for (const [name, open, field, main] of [
  ['quick add', () => ev(() => window.GH.ui.act.foodQuick()), '#qC', '[data-act="foodQuickSave"]'],
  ['create a food', () => ev(() => window.GH.ui.act.foodCreate()), '#cFib', '[data-act="foodCreateSave"]'],
  ['a barcode\'s number', () => ev(() => { window.GH.ui.act.foodScan(); }), '#scCode', '.sc-type [type="submit"]'],
]) {
  await open();
  await sheetOpen(field);
  await settle(1500);
  await page.focus(`dialog.rf-sheet[open] ${field}`);
  await keyboard(true);
  // (The sheet slides to fit what's left of the screen: under load that can take a moment.)
  let r = await inSight(field, main);
  for (let i = 0; i < 6 && !(r.field && r.main); i++) { await settle(500); r = await inSight(field, main); }
  check(`${name}: the field and its button above the keyboard`, r.field && r.main && r.focused, JSON.stringify(r));
  await ev(() => document.activeElement && document.activeElement.blur());
  await keyboard(false);
  await closeSheets();
}
await page.setViewportSize({ width, height: 844 });
await settle(600);
await home();

section('Health tab');
await tab('health');
check('an Eaten tile', await ev(() => [...document.querySelectorAll('#screen .stat')].some((s) => /Eaten/.test(s.textContent))));
check('active calories and distance tiles', await ev(() => { const t = [...document.querySelectorAll('#screen .stat')].map((s) => s.textContent).join(' '); return /Active calories/.test(t) && /Distance/.test(t); }));
check('a calories eaten chart', await ev(() => [...document.querySelectorAll('#screen .card')].some((c) => /Calories eaten/.test(c.textContent))));
check('the section lists what was eaten in each meal', await ev(() => /Oatmeal|Banana|Protein bar/.test(document.querySelector('#screen .hf-meal[data-key="hm-breakfast"]').textContent) && /Salmon and potatoes, Salad/.test(document.querySelector('#screen .hf-meal[data-key="hm-dinner"]').textContent)));
const hfBad = await lineUp('#screen .card.hf');
check('the section lines up: its glance\'s columns, the chevron and the meals at the text edges, 44 px to a finger', hfBad.length === 0, hfBad.join('\n      '));

section('Today\'s card and the food route');
await tab('today');
check('Today has the food card', await ev(() => !!document.querySelector('#screen .fd-card')));
const cardBad = await lineUp('#screen .fd-card');
check('and its glance lines up as Health\'s does', cardBad.length === 0, cardBad.join('\n      '));
await page.click('#screen .fd-card [data-act="goFood"]');
await settle(1200);
check('Open on it opens the Food page, over Today', (await where()).tab === 'today' && (await where()).view === 'food', JSON.stringify(await where()));
await home();
await ev(() => { location.hash = '#food'; });
await settle(1200);
check('a #food link opens it too', (await where()).view === 'food', JSON.stringify(await where()));
await ev(() => { history.replaceState(null, '', location.pathname); });
await home();

section('Workouts off');
await openSettings();
await ev(() => document.querySelector('#screen [data-on="setWorkouts"]').click());
await settle(900);
check('Plan and Progress go away: Today, Health and You', (await tabs()) === 'today,health,you', await tabs());
await home();
await tab('today');
check('Today leads with the day instead of a workout', await ev(() => !!document.querySelector('#screen .day-card') && !document.querySelector('#screen .session') && !document.querySelector('#screen .streak')));
check('no Start workout button', await ev(() => document.getElementById('float').hidden));
check('the food card is on Today', await ev(() => !!document.querySelector('#screen .fd-card')));
await tab('health');
check('and Health holds the food', await ev(() => !!document.querySelector('#screen .hf')));
await openSettings();
await ev(() => document.querySelector('#screen [data-on="setWorkouts"]').click());
await settle(900);
check('and back on', (await tabs()) === 'today,plan,health,progress,you', await tabs());

section('Calories off again');
await page.click('[data-on="setFoodMode"] input[value="protein"]', { force: true });
await settle();
check('the tabs don\'t change', (await tabs()) === 'today,plan,health,progress,you', await tabs());
check('what was logged is kept', (await kcalToday()) > 0);
await home();
await tab('health');
check('Health offers to track calories again', await ev(() => !!document.querySelector('#screen .hf-invite') && !document.querySelector('#screen .hf')));
await page.click('#screen .hf-invite [data-act="foodInviteHide"]');
await settle(1200);
check('Not now puts the invite away', await ev(() => !document.querySelector('#screen .hf-invite') && window.GH.ui.seen('foodInvite')));
await page.reload();
await page.waitForSelector('#screen[data-view]', { timeout: 15000 }).catch(async () => { await ev(() => window.GH.ui.boot()); });
await settle(900);
await settle(4000);
check('without calorie tracking, the Food page\'s part waits until it\'s wanted', await ev(() => !window.GH.foodUi));
await tab('health');
check('and it stays away', await ev(() => !document.querySelector('#screen .hf-invite')));
await menuFood();
check('the + menu still starts it', await sheetOpen('.fd-start'));
await settle(700);
await page.click('dialog.rf-sheet[open] [data-act="fsGo"]');
await settle(1500);
check('and Start goes on to Add food, the clock\'s meal picked', await ev(() => window.GH.food.full(window.GH.ui.S)) && await sheetOpen('.fd-search') && (await sheetMeal('foodAddMeal')) === 'breakfast', await sheetMeal('foodAddMeal'));
await closeSheets();
// With calorie tracking on, the Food page and its sheets load once the app is idle, before any of
// them is wanted.
await page.reload();
await page.waitForSelector('#screen[data-view]', { timeout: 15000 }).catch(async () => { await ev(() => window.GH.ui.boot()); });
let warmed = false;
for (let i = 0; i < 20 && !warmed; i++) { await settle(500); warmed = await ev(() => !!window.GH.foodUi && !document.querySelector('dialog.rf-sheet[open]') && window.GH.ui.route.view !== 'food'); }
check('with calorie tracking on, the Food page\'s part loads ahead of time', warmed);
// So do the parts a tap is likely to want next (src/ui/lazy.js): the plan review, How it works and the
// badge share card, one at a time while the phone is idle. (Every script that hangs work on
// U.afterBoot keeps what was there before; guide.js once didn't, and this warm-up never ran.)
let rest = false;
for (let i = 0; i < 20 && !rest; i++) { await settle(500); rest = await ev(() => !!(window.GH.review && window.GH.science && window.GH.shareCard)); }
check('and so do the plan review, How it works and the share card', rest, await ev(() => ({ review: !!window.GH.review, science: !!window.GH.science, shareCard: !!window.GH.shareCard })));

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
check('its check digit rule agrees', await ev(() => window.GH.scanner.checksumOk('3017620422003') && !window.GH.scanner.checksumOk('3017620422004') && window.GH.scanner.expandUpcE('04252614') === '042100005264'));

section('Set-up for food and health only');
{
  const ctx2 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await p2.addInitScript(seedBridge);
  await p2.goto(server.url);
  await p2.waitForSelector('.onboard:not([hidden]) .rf-large-title');
  const title = () => p2.locator('.onboard .rf-large-title').first().innerText();
  const next = async () => { await p2.locator('.ob-actions [data-variant="tinted"]').click(); await p2.clock.runFor(500); await p2.waitForTimeout(150); };
  // The welcome's "Just tracking food?".
  await p2.click('.ob-actions [data-act="obFood"]');
  await p2.clock.runFor(500); await p2.waitForTimeout(150);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const t = await title();
    seen.push(t);
    if (t === 'A little about you') { await p2.fill('.onboard input[data-k="_w"]', '150'); await p2.locator('.onboard input[data-k="_w"]').dispatchEvent('change'); await p2.fill('.onboard input[data-k="age"]', '30'); await p2.locator('.onboard input[data-k="age"]').dispatchEvent('change'); }
    if (t === 'Your daily targets') break;
    await next();
  }
  check('workout screens are skipped', !seen.some((t) => ['What do you want most?', 'How much time do you have?', 'Where do you train?', 'Goals', 'Experience', 'Schedule', 'Equipment'].includes(t)), seen.join(' → '));
  check('a goal, then the daily targets', seen.includes('What\'s your goal?') && seen[seen.length - 1] === 'Your daily targets', seen.join(' → '));
  check('the targets: calories, protein and steps, and where the food is', await p2.evaluate(() => { const t = document.querySelector('.onboard').textContent; return /calories a day/.test(t) && /protein a day/.test(t) && /steps a day/.test(t) && /from Health/.test(t); }));
  // Health Connect (granted here) is the optional last screen; then the app.
  await next();
  if (await p2.locator('.ob-actions [data-act="obConnect"]').count()) await p2.click('.ob-actions [data-act="obLook"]');
  else await p2.locator('.ob-actions [data-variant="tinted"]').click();
  await p2.clock.runFor(900); await p2.waitForTimeout(300);
  check('the app opens on Today, with Today, Health and You', await p2.evaluate(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => t.dataset.tab).join(',') === 'today,health,you' && window.GH.ui.route.tab === 'today' && !window.GH.ui.route.view));
  check('Today has no workout, and the food card', await p2.evaluate(() => !!document.querySelector('#screen .day-card') && !document.querySelector('#screen .session') && !!document.querySelector('#screen .fd-card')));
  await p2.click('.rf-tab[data-tab="health"]');
  await p2.clock.runFor(900); await p2.waitForTimeout(300);
  check('and Health holds the food', await p2.evaluate(() => !!document.querySelector('#screen .hf')));
  await ctx2.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
