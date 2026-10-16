// Your plans in Chromium at phone size, someone five weeks in. Build a plan like a playlist: New
// plan's ready-made plans; the picker (a windowed list with a picture in every row from its first
// frame, Suggested for the day and the week, the muscle chips, a Filters menu with equipment and
// Only what I can do, forgiving search, a tray that takes one out with Undo, a how-to from a row's
// picture or a long press); sets and reps for this person; this week by muscle, where a short muscle
// opens the picker at it; closing the picker without Add (a toast, with Undo); one exercise's
// steppers, rest on one line and Replace; reordering by dragging and with the keyboard; a day's
// tools (fold, rename, move, duplicate, delete with Undo); set weekdays. Then use it and run its
// first day in the player to the check-in (targets move on), share it (the QR code, the link in the
// share text), get a friend's plan from a link through window.__gh.onLink (the preview with its
// swaps, Save, Use it now, and the same link twice), ask the coach to build one (with a stand-in
// on-device model held to the moves this person can do), go back to the coach's plan, and pick the
// ready-made Full body plan, with the limits a plan keeps to (12 exercises a day, 6 days) saying
// why. No console errors. Screenshots of every screen go to build/ui-customplan/ for a visual pass.
// Usage: node test/ui-customplan.mjs [--dark] [--width=390] [--zoom=1.3]
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const zoom = Number((process.argv.find((a) => a.startsWith('--zoom=')) || '--zoom=1').split('=')[1]);
const tag = `${dark ? '-dark' : ''}${width !== 390 ? `-${width}` : ''}${zoom !== 1 ? '-zoom' : ''}`;
const OUT = join(root, 'build/ui-customplan');
if (!tag) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The share page (docs/p/, built with the app) is served where GitHub Pages would put it.
const server = await serveDist({ '/p/index.html': join(root, 'docs/p/index.html'), '/icon-512.png': join(root, 'docs/icon-512.png') });
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.clock.install({ time: new Date('2026-10-19T08:10:00') });
await page.addInitScript(seedBridge);
// The share sheet and the clipboard, recorded.
await page.addInitScript(() => {
  const t = setInterval(() => {
    if (!window.AndroidBridge) return;
    clearInterval(t);
    window.__shared = [];
    window.AndroidBridge.shareText = (text, target) => { window.__shared.push({ text, target }); };
    window.AndroidBridge.copy = (text) => { window.__copied = text; return true; };
  }, 1);
});
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"]');
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 300)); };
// Until fn() in the page is true: sheets slide in real time while timers run on the test's clock,
// so this steps both.
const until = async (fn, arg, tries = 30) => {
  let v = await page.evaluate(fn, arg);
  for (let i = 0; i < tries && !v; i++) { await page.clock.runFor(100); await page.waitForTimeout(100); v = await page.evaluate(fn, arg); }
  return v;
};
// WebView's text zoom scales every font size; this does the same to what's on screen now.
const zoomText = async () => {
  if (zoom === 1) return;
  await page.evaluate((f) => {
    // Sizes are all read first, so a scaled parent doesn't scale its children twice.
    const els = [...document.querySelectorAll('body *')].filter((x) => !x.closest('svg') && !x.dataset.zoomed);
    const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
    els.forEach((e, i) => { if (sizes[i]) { e.style.setProperty('font-size', `${sizes[i] * f}px`, 'important'); e.dataset.zoomed = '1'; } });
    window.dispatchEvent(new Event('resize'));
  }, zoom);
  await page.waitForTimeout(120);
};
const shot = async (name, keep) => {
  if (!keep) await page.evaluate(() => { if (!document.querySelector('dialog[open]')) document.getElementById('screen').scrollTop = 0; });
  await zoomText();
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(OUT, `${name}${tag}.png`) });
};
const shotSheet = async (name) => {
  await zoomText();
  await page.screenshot({ path: join(OUT, `${name}${tag}.png`) });
  const more = await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); return b ? b.scrollHeight - b.clientHeight : 0; });
  if (more > 40) {
    await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `${name}-end${tag}.png`) });
    await page.evaluate(() => { const b = document.querySelector('dialog[open] .rf-sheet-body'); b.scrollTop = 0; });
  }
};
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
// A toast's Undo, found by its words.
const undo = async (re) => { await page.evaluate((src) => { const t = [...document.querySelectorAll('.rf-toast')].reverse().find((x) => new RegExp(src).test(x.textContent)); const b = t && [...t.querySelectorAll('button')].find((x) => /Undo/.test(x.textContent)); if (b) b.click(); }, re.source); await settle(600); };
const S = (fn, arg) => page.evaluate(fn, arg);
const plan = () => S(() => { const U = window.GH.ui; return JSON.parse(JSON.stringify(window.GH.customPlan.get(U.S, U.route.arg))); });
const rows = (di) => page.evaluate((d) => [...document.querySelectorAll(`#screen .cp-exlist[data-day="${d}"] .cp-ex-name`)].map((e) => e.textContent), di);
const closeSheets = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await settle(600); };
// A day's options: the menu out of its ⋯ button, and one of them picked.
const dayMenu = async (key) => {
  await page.click(`#screen .cp-day[data-key="${key}"] [data-act="cpDayMenu"]`);
  await settle(600);
  return S(() => { const m = document.querySelector('.rf-menu:popover-open'); return m && { items: [...m.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()), sheet: !!document.querySelector('dialog.gh-sheet[open]') }; });
};
const pickMenu = async (act) => {
  await page.click(`.rf-menu:popover-open [data-act="${act}"]`);
  await settle(800);
  await until(() => !document.querySelector('.rf-menu:popover-open'));
};

/* ------------------------------------------------------------------ the Plans page */
section('Your plans');
await page.click('.rf-tab[data-tab="plan"]');
await settle(900);
check('Plan\'s Make it yours opens Your plans', await page.locator('#screen [data-key="mine"] [data-act="openPlans"]').count() === 1);
await page.click('#screen [data-key="mine"] [data-act="openPlans"]');
await settle(900);
check('the Plans page opens', await S(() => window.GH.ui.route.view) === 'plans');
check('it says the coach\'s plan is in use', /In use\s*The coach's plan/.test(await page.locator('#screen .cp-inuse').innerText()));
check('with Build your own, Ask the coach and Add a shared plan', await page.locator('#screen .cp-make [data-act="cpNew"]').count() === 1 && await page.locator('#screen .cp-make [data-act="cpBuild"]').count() === 1 && await page.locator('#screen .cp-make [data-act="cpScan"]').count() === 1);
await shot('01-plans');

/* ------------------------------------------------------------------ building one */
section('Building a plan');
await page.click('#screen .cp-make [data-act="cpNew"]');
await settle(1500);
// Ready-made plans first, each built for this person, then an empty plan or a copy of the coach's.
const tpls = await S(() => [...document.querySelectorAll('dialog[open] .cp-tpls [data-act="cpNewTemplate"]')].map((b) => ({ id: b.dataset.arg, text: b.textContent.replace(/\s+/g, ' ').trim(), pics: [...b.querySelectorAll('.cp-thumb')].filter((h) => h.querySelector('img, svg')).length })));
check('New plan offers Full body, Upper and lower, Push, pull, legs and No equipment, each for your days and time', JSON.stringify(tpls.map((t) => t.id)) === '["full","upperlower","ppl","bodyweight"]' && tpls.every((t) => /\d days a week · about 25 min/.test(t.text)), tpls.map((t) => t.text));
check('each shows its moves once it\'s built (four pictures each)', tpls.every((t) => t.pics === 4), tpls.map((t) => t.pics));
check('then Start from scratch and Copy my current plan', await page.locator('dialog[open] [data-act="cpNewBlank"]').count() === 1 && await page.locator('dialog[open] [data-act="cpNewCopy"]').count() === 1);
await shotSheet('02-new');
await page.click('dialog[open] [data-act="cpNewBlank"]');
await settle(900);
check('an empty plan opens on its own page', await S(() => window.GH.ui.route.view) === 'planEdit' && (await plan()).days.length === 1);
await page.fill('#cpName', 'Morning strength');
await page.press('#cpName', 'Tab');
await settle(500);
check('renaming it saves the name', (await plan()).name === 'Morning strength' && /Morning strength/.test(await page.locator('#screen .cp-title').innerText()));
check('an empty plan can\'t be used yet, and says why', await page.locator('#screen [data-act="cpUse"]').count() === 0 && /Day 1 has no exercises yet/.test(await page.locator('#screen .cp-hero').innerText()));
// The name's limit, said kindly as it's reached.
await page.fill('#cpName', 'x'.repeat(40));
await settle(200);
check('a name at its 40 characters says so', /Names stop at 40 characters/.test(await page.locator('#screen .cp-names').innerText()));
await page.fill('#cpName', 'Morning strength');
await page.press('#cpName', 'Tab');
await settle(500);
check('and the note goes once it\'s shorter', !/Names stop/.test(await page.locator('#screen .cp-names').innerText()) && (await plan()).name === 'Morning strength');
// This week by muscle: an empty plan is short everywhere, and each gap is a way in.
const week0 = await S(() => [...document.querySelectorAll('#screen .cp-wk > li')].map((li) => ({ g: li.dataset.key.slice(3), status: li.dataset.status, button: !!li.querySelector('button[data-act="cpGap"]') })));
check('This week by muscle: seven groups, each a gap to add to while the plan is empty', week0.length === 7 && week0.every((w) => w.status === 'none' && w.button), week0);
await shot('03-empty');

// The picker: its first frame, from a real tap. Every tile on screen has a picture in it (a kept
// still, one of the same move in another size or look, or the flat figure), never a blank square.
await S(() => {
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('[data-act="cpAdd"]')) return;
    const d = document.querySelector('dialog[open].cp-picker');
    const hosts = d ? [...d.querySelectorAll('.cp-results .cp-thumb[data-move]')] : [];
    window.__first = { sheet: !!d, hosts: hosts.length, pictured: hosts.filter((h) => h.querySelector(':scope > img, :scope > svg')).length, rows: d ? d.querySelectorAll('.cp-row').length : 0 };
  }, { once: true });
});
await page.click('#screen [data-act="cpAdd"][data-arg="0"]');
const first = await S(() => window.__first);
check('the picker\'s first frame: a picture in every tile, not one blank', first && first.sheet && first.hosts >= 8 && first.pictured === first.hosts, first);
await settle(900);
check('it opens full height, a list of rows', await S(() => document.querySelector('dialog[open].cp-picker').dataset.size === 'full') && await page.locator('dialog[open] .cp-row').count() > 6);
check('by default only moves you can do', await S(() => [...document.querySelectorAll('dialog[open] .cp-row')].every((t) => !t.classList.contains('is-off'))));
// Only the rows near the screen are in the page, however long the list.
const win = await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); return { rows: sc.querySelectorAll('.cp-row').length, tall: sc.scrollHeight, view: sc.clientHeight, all: window.GH.customPlan.catalog(window.GH.ui.S, window.GH.ui.today()).filter((x) => x.ok).length }; });
check(`windowed: ${win.rows} rows in the page for ${win.all} moves, the list as tall as all of them`, win.all > 150 && win.rows < 40 && win.tall > win.view * 10, win);
await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); sc.scrollTop = sc.scrollHeight / 2; });
await settle(300);
const mid = await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); const r = sc.getBoundingClientRect(); const rs = [...sc.querySelectorAll('.cp-row')]; return { rows: rs.length, seen: rs.filter((x) => { const b = x.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom; }).length, blank: rs.filter((x) => !x.querySelector('.cp-thumb > img, .cp-thumb > svg')).length }; });
check('scrolled half-way, the rows there are in the page, with pictures, and the rest still aren\'t', mid.seen >= 4 && mid.rows < 40 && mid.blank === 0, mid);
await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); sc.scrollTop = sc.scrollHeight; });
await settle(300);
await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); sc.scrollTop = sc.scrollHeight; });
await settle(300);
const end = await S(() => { const sc = document.querySelector('dialog[open] .cp-results'); const vl = sc.querySelector('.cp-vl'); const r = sc.getBoundingClientRect(); const last = vl.lastElementChild; const b = last.getBoundingClientRect(); return { below: vl.style.paddingBottom, last: last.dataset.vkey, seen: b.top < r.bottom && b.bottom > r.top }; });
check('and at the end, the last rows, in sight', end.below === '0px' && /^r-/.test(end.last) && end.seen, end);
await S(() => { document.querySelector('dialog[open] .cp-results').scrollTop = 0; });
await settle(300);
// Suggested: for an empty day, the main move of the muscles the week leaves out, at your level.
const sug = await S(() => {
  const C = window.GH.customPlan, U = window.GH.ui, M = window.GH.moves;
  const cx = C.context(U.S, U.today());
  const ids = [...document.querySelectorAll('dialog[open] .cp-row.is-sug')].map((r) => r.dataset.id);
  return { head: !!document.querySelector('dialog[open] .cp-sec[data-vkey="h-sug"]'), ids, groups: [...new Set(ids.map((id) => M.MOVES[id].group))], ok: ids.every((id) => C.check(cx, id).ok), why: [...document.querySelectorAll('dialog[open] .cp-row.is-sug .cp-row-why')].map((w) => w.textContent) };
});
check('Suggested first: moves you can do for the muscles your week has none of yet', sug.head && sug.ids.length >= 4 && sug.groups.length >= 4 && sug.ok && sug.why.length === sug.ids.length && sug.why.every((w) => /None in your week yet/.test(w)), sug);
// Equipment: a menu out of the Filters button, from what the moves are done with.
await page.click('dialog[open] [data-act="cpKitMenu"]');
await settle(600);
const kitItems = await S(() => [...document.querySelectorAll('.rf-menu:popover-open [role="menuitem"]')].map((b) => b.textContent.trim()));
check('Filters: any equipment, the kinds of kit you have, and Only what I can do', JSON.stringify(kitItems) === JSON.stringify(['Any equipment', 'Body only', 'Dumbbells', 'Kettlebell', 'Bands', 'Only what I can do']), kitItems);
await shot('04-picker-filters', true);
await page.click('.rf-menu:popover-open [data-act="cpKit"][data-arg="db"]');
await settle(700);
const dbRows = await S(() => { const cat = window.GH.customPlan.catalog(window.GH.ui.S, window.GH.ui.today()); const ids = [...document.querySelectorAll('dialog[open] .cp-row')].map((r) => r.dataset.id); return { n: ids.length, all: ids.every((id) => cat.find((x) => x.id === id).kit.includes('db')), label: document.querySelector('dialog[open] .cp-kit').textContent.trim() }; });
check('Dumbbells: only moves done with dumbbells, and the button says so', dbRows.n > 5 && dbRows.all && dbRows.label === 'Dumbbells', dbRows);
await page.click('dialog[open] [data-act="cpKitMenu"]');
await settle(600);
await page.click('.rf-menu:popover-open [data-act="cpKit"][data-arg=""]');
await settle(600);
check('Any equipment takes the filter off', await S(() => document.querySelector('dialog[open] .cp-kit').textContent.trim()) === '');
// Search, forgiving: spacing, hyphens, plurals, the British name, a letter off, muscles and kit.
const searchFor = async (t) => { await page.fill('#cpQ', t); await settle(300); return S(() => [...document.querySelectorAll('dialog[open] .cp-row .cp-row-name')].map((e) => e.textContent)); };
const spell = {};
for (const t of ['pushup', 'push up', 'push-up', 'pushups', 'press-up']) spell[t] = (await searchFor(t))[0];
check('search: "pushup", "push up", "push-up", "pushups" and "press-up" all find the push-up first', Object.values(spell).every((n) => n === 'Push-up'), spell);
const dumbell = await searchFor('dumbell row');
check('a word a letter off finds its move ("dumbell row")', dumbell.includes('Bent-over row'), dumbell.slice(0, 5));
const glutes = await searchFor('glutes');
const kettle = await searchFor('kettlebell');
check('and a muscle ("glutes") or kit ("kettlebell") finds the moves that use it', glutes.includes('Glute bridge') && glutes.length > 10 && kettle.includes('Kettlebell deadlift') && kettle.length > 5, { glutes: glutes.length, kettle: kettle.length });
const order = await searchFor('squat goblet');
check('words in any order ("squat goblet")', order[0] === 'Goblet squat', order.slice(0, 3));
await searchFor('');
await shot('04-picker', true);
// Adding: three taps, each marked; the tray holds them, and the button says Add 3.
const tap = async (id, q) => { if (q != null) await searchFor(q); await page.click(`dialog[open] .cp-row-main[data-arg="${id}"]`); await settle(250); };
await tap('push_std', 'push-up');
await tap('row_db', 'bent-over row');
await tap('sq_goblet', 'goblet squat');
const tray1 = await S(() => ({ items: document.querySelectorAll('dialog[open] .cp-tray-item').length, fresh: document.querySelectorAll('dialog[open] .cp-tray-item.is-new').length, go: document.querySelector('dialog[open] [data-act="cpPickDone"]').textContent.trim(), n: document.querySelector('dialog[open] .cp-tray-n').textContent, marked: document.querySelectorAll('dialog[open] .cp-row.is-in').length }));
check('each tap adds one, marked on its row; the tray holds them, and Add 3', tray1.items === 3 && tray1.fresh === 3 && tray1.go === 'Add 3' && tray1.n === '3' && tray1.marked >= 1, tray1);
await tap('row_db', 'bent-over row');
check('tapping one just added takes it back out', await page.locator('dialog[open] .cp-tray-item').count() === 2);
await tap('row_db');
// The tray: a tap takes one out, with Undo.
await page.click('dialog[open] .cp-tray-item >> nth=0');
await settle(400);
const outT = await toasts();
check('a tap on one in the tray takes it out, with Undo', await page.locator('dialog[open] .cp-tray-item').count() === 2 && /Took out push-up/i.test(outT), outT);
await undo(/Took out push-up/);
check('and Undo puts it back where it was', await page.locator('dialog[open] .cp-tray-item').count() === 3 && await S(() => document.querySelector('dialog[open] .cp-tray-item').getAttribute('aria-label')) === 'Take out Push-up');
await shot('05-picker-tray', true);
// A how-to from the picture, over the picker, and back.
await page.click('dialog[open] .cp-row-fig >> nth=0');
await settle(900);
const how = await S(() => [...document.querySelectorAll('dialog[open] .rf-sheet-title')].map((t) => t.textContent));
check('a row\'s picture opens its how-to over the picker', how.length === 2 && how[0] === 'Add to day 1', how);
await page.keyboard.press('Escape');
await until(() => document.querySelectorAll('dialog[open]').length === 1);
check('and closing it comes back to the picker as it was', await S(() => document.querySelectorAll('dialog[open]').length === 1 && !!document.querySelector('dialog[open].cp-picker')) && await page.locator('dialog[open] .cp-tray-item').count() === 3);
// A long press on a row opens its how-to too, and doesn't add it.
{
  const lp = page.locator('dialog[open] .cp-row:not(.is-in) .cp-row-main >> nth=0');
  const id = await lp.getAttribute('data-arg');
  const box = await lp.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(600);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await settle(600);
  const lpHow = await S(() => [...document.querySelectorAll('dialog[open] .rf-sheet-title')].map((t) => t.textContent));
  const name = await S((x) => window.GH.moves.MOVES[x].name, id);
  check('a long press on a row opens its how-to, and doesn\'t add it', lpHow.length === 2 && lpHow[1] === name && await page.locator('dialog[open] .cp-tray-item').count() === 3 && !(await S((x) => document.querySelector(`dialog[open] .cp-row[data-id="${x}"]`).classList.contains('is-in'), id)), { lpHow, name });
  await page.keyboard.press('Escape');
  await until(() => document.querySelectorAll('dialog[open]').length === 1);
}
// Only what I can do, off: the rest show, marked with why.
await page.click('dialog[open] [data-act="cpKitMenu"]');
await settle(600);
await page.click('.rf-menu:popover-open [data-act="cpMine"]');
await settle(600);
await searchFor('barbell');
check('turning off Only what I can do shows the rest, marked with why', await page.locator('dialog[open] .cp-row.is-off').count() >= 3 && /needs a barbell/i.test(await page.locator('dialog[open] .cp-row.is-off .cp-row-meta >> nth=0').innerText()));
await shot('05-picker-all', true);
await searchFor('');
await page.click('dialog[open] [data-act="cpPickDone"]');
await settle(800);
check('Add: the day lists them in order', JSON.stringify(await rows(0)) === JSON.stringify(['Push-up', 'Goblet squat', 'Bent-over row']), await rows(0));
// Each came with sets and reps for this person: their goals' sets and their own level's reps.
const smart = await S(() => {
  const U = window.GH.ui, C = window.GH.customPlan, M = window.GH.moves, B = window.GH.brain;
  const p = C.get(U.S, U.route.arg);
  return p.days[0].items.map((it) => { const m = M.MOVES[it.move]; const st = U.S.prog[m.family]; const r = B.rangeFor(U.S, m, m.family, U.today()) || m.range || [1, 100]; return { it, want: C.defaults(U.S, it.move, U.today()), own: !!st && st.rung === it.move, ownReps: st ? Math.max(r[0], Math.min(r[1], st.reps)) : null }; });
});
check('new ones come with sets and reps for you: your goals\' sets, and your own reps on a move you\'re doing', smart.every((x) => x.it.sets === x.want.sets && x.it.reps === x.want.reps) && smart.some((x) => x.own) && smart.filter((x) => x.own).every((x) => x.it.reps === x.ownReps), smart);
const week1 = await S(() => Object.fromEntries([...document.querySelectorAll('#screen .cp-wk > li')].map((li) => [li.dataset.key.slice(3), li.dataset.status])));
check('This week by muscle follows: chest, back and legs have sets now', week1.chest !== 'none' && week1.back !== 'none' && week1.legs !== 'none' && week1.biceps === 'none', week1);
// A muscle that's short in the week: a tap opens the picker at it.
await page.evaluate(() => document.querySelector('#screen [data-act="cpGap"][data-arg="biceps"]').scrollIntoView({ block: 'center' }));
await settle(300);
await shot('03b-week', true);
await page.click('#screen [data-act="cpGap"][data-arg="biceps"]');
await settle(900);
const gapP = await S(() => {
  const d = document.querySelector('dialog[open].cp-picker');
  const M = window.GH.moves;
  const ids = [...d.querySelectorAll('.cp-row')].map((r) => r.dataset.id);
  const rail = d.querySelector('.cp-filters'), chip = rail.querySelector('[aria-checked="true"]');
  const rr = rail.getBoundingClientRect(), cr = chip.getBoundingClientRect();
  return { title: d.querySelector('.rf-sheet-title').textContent, chip: chip.textContent.trim(), seen: cr.left >= rr.left - 1 && cr.right <= rr.right + 1, all: ids.every((id) => M.MOVES[id].group === 'biceps'), n: ids.length };
});
check('a short muscle opens the picker at it: Biceps picked and in sight, biceps moves only', gapP.title === 'Add to day 1' && gapP.chip === 'Biceps' && gapP.seen && gapP.all && gapP.n >= 3, gapP);
await shot('05b-picker-gap', true);
// Closed without Add (its close button), what was added stays, and a toast says so, with Undo.
await page.click(`dialog[open] .cp-row-main[data-arg="${await S(() => document.querySelector('dialog[open] .cp-row:not(.is-in)').dataset.id)}"]`);
await settle(300);
await page.click('dialog[open].cp-picker [data-sheet-close]');
await settle(900);
const xT = await toasts();
check('closed with its close button, what was added stays, and a toast says so, with Undo', (await plan()).days[0].items.length === 4 && /Added 1 exercise to day 1/.test(xT) && /Undo/.test(xT), xT);
await undo(/Added 1 exercise/);
check('and Undo takes it back out', JSON.stringify(await rows(0)) === JSON.stringify(['Push-up', 'Goblet squat', 'Bent-over row']), await rows(0));

// One exercise: sets and reps with steppers, rest on one line.
await page.click('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-ex-row');
await settle(800);
await shotSheet('06-item');
const it0 = (await plan()).days[0].items[0];
await page.click('dialog[open] .cp-step:nth-child(1) .rf-stepper-btn[data-step="1"]');
await page.click('dialog[open] .cp-step:nth-child(2) .rf-stepper-btn[data-step="1"]');
await page.click('dialog[open] [data-act="cpRestStep"][data-arg="1"]');
await settle(500);
let p = await plan();
const restRow = await S(() => { const r = document.querySelector('dialog[open] .cp-rest'); const l = r.querySelector('.t-subhead').getBoundingClientRect(), c = r.querySelector('.cp-rest-ctl').getBoundingClientRect(); return { text: r.textContent.replace(/\s+/g, ' ').trim(), oneLine: c.top < l.bottom && l.top < c.bottom, auto: !!r.querySelector('[data-act="cpRestAuto"]') }; });
check('steppers set sets and reps, and rest steps up from Auto (90 s for a push-up) to 2 min', p.days[0].items[0].sets === it0.sets + 1 && p.days[0].items[0].reps === it0.reps + 1 && p.days[0].items[0].rest === 120 && /2 min/.test(restRow.text) && restRow.auto, { it: p.days[0].items[0], restRow });
check('rest is one line: its label, the stepper and Auto side by side', restRow.oneLine, restRow);
await page.click('dialog[open] [data-act="cpRestAuto"]');
await settle(300);
check('Auto takes it back', (await plan()).days[0].items[0].rest == null && /Auto/.test(await page.locator('dialog[open] .cp-rest').innerText()));
await page.click('dialog[open] [data-act="cpRestStep"][data-arg="-1"]');
await settle(300);
check('and a step down from Auto is 75 s', (await plan()).days[0].items[0].rest === 75);
await page.click('dialog[open] [data-act="cpRestStep"][data-arg="1"]');
await page.click('dialog[open] [data-act="cpRestStep"][data-arg="1"]');
await settle(300);
p = await plan();
await closeSheets();
const meta0 = await page.locator('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-ex-meta').innerText();
check('the row shows it', /\d+ × \d+ reps · rest 2 min/.test(meta0), meta0);
// A name inside a sentence ("Took out …", "In place of …", "Starts today with …").
const said = await S(() => ['Push-up', 'Russian twist', 'Staggered-stance RDL', 'V-up', 'Full body A'].map((n) => window.GH.ui.cpKit.inSentence(n)));
check('a name in a sentence: its first word in lower case, names and letters kept', JSON.stringify(said) === JSON.stringify(['push-up', 'Russian twist', 'staggered-stance RDL', 'V-up', 'full body A']), said);
// Replace: from its sheet, the picker says what it replaces and suggests the moves most like it.
await page.click('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-ex-row');
await settle(800);
await page.click('dialog[open] [data-act="cpReplace"]');
await settle(900);
const rep = await S(() => { const d = document.querySelector('dialog[open].cp-picker'); const M = window.GH.moves; return d && { title: d.querySelector('.rf-sheet-title').textContent, what: d.querySelector('.cp-replacing').innerText.replace(/\s+/g, ' ').trim(), head: (d.querySelector('.cp-sec[data-vkey="h-sug"]') || {}).textContent, sug: [...d.querySelectorAll('.cp-row.is-sug')].map((r) => r.dataset.id), chest: [...d.querySelectorAll('.cp-row.is-sug')].every((r) => M.MOVES[r.dataset.id].group === 'chest'), why: d.querySelectorAll('.cp-row-why').length, tray: !!d.querySelector('.cp-tray') }; });
check('Replace: the sheet says which one, the moves most like it first, and no tray', rep && rep.title === 'Replace exercise' && /^Replacing Push-up/.test(rep.what) && rep.head === 'Most like it' && rep.sug.length >= 3 && rep.chest && !rep.sug.includes('push_std') && !rep.tray, rep);
await shot('06b-replace', true);
const before = (await plan()).days[0].items[0];
await page.click(`dialog[open] .cp-row.is-sug .cp-row-main[data-arg="${rep.sug[0]}"]`);
await settle(800);
const after = (await plan()).days[0].items[0];
const repT = await toasts();
const toName = await S((x) => window.GH.moves.MOVES[x].name, rep.sug[0]);
check('a tap swaps it in place, keeping its sets and rest, with Undo', after.move === rep.sug[0] && after.sets === before.sets && after.rest === before.rest && repT.includes(`${toName} in`) && /In place of push-up/.test(repT), { before, after, repT });
await undo(/In place of push-up/);
check('and Undo puts the push-up back as it was', JSON.stringify((await plan()).days[0].items[0]) === JSON.stringify(before));

// Reorder: drag the last one to the top, then the keyboard.
await page.evaluate(() => document.querySelector('#screen .cp-exlist[data-day="0"]').scrollIntoView({ block: 'center' }));
await settle(300);
const grip = async (i) => { const b = await page.locator(`#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(${i + 1}) .cp-grip`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const a = await grip(2), top = await grip(0);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x, a.y + (top.y - 20 - a.y) * k / 8); await page.waitForTimeout(16); }
check('a row lifts while it\'s dragged', await page.locator('#screen .cp-ex[data-lifted]').count() === 1);
await shot('07-drag', true);
await page.mouse.up();
await settle(600);
check('dropping it on top moves it there', JSON.stringify(await rows(0)) === JSON.stringify(['Bent-over row', 'Push-up', 'Goblet squat']), await rows(0));
await page.focus('#screen .cp-exlist[data-day="0"] .cp-ex:nth-child(1) .cp-grip');
await page.keyboard.press('ArrowDown');
await settle(500);
check('the arrow keys move it too, and focus follows', JSON.stringify(await rows(0)) === JSON.stringify(['Push-up', 'Bent-over row', 'Goblet squat']) && await S(() => document.activeElement && document.activeElement.dataset.grip) === '0:1', await rows(0));

// A second day.
await page.click('#screen [data-act="cpAddDay"]');
await settle(700);
await page.click('#screen [data-act="cpAdd"][data-arg="1"]');
await settle(800);
check('a new day\'s picker suggests for the week: arms and abs, none of it yet', await S(() => [...document.querySelectorAll('dialog[open] .cp-row.is-sug')].some((r) => ['biceps', 'triceps', 'abs'].includes(window.GH.moves.MOVES[r.dataset.id].group))));
await tap('curl_std', 'curl');
await tap('tri_oh', 'overhead extension');
await page.click('dialog[open] [data-act="cpPickDone"]');
await settle(700);
await page.fill('#screen .cp-day[data-key="day-1"] .cp-day-title', 'Arms');
await page.press('#screen .cp-day[data-key="day-1"] .cp-day-title', 'Tab');
await settle(400);
check('day 2, named, with its two', JSON.stringify(await rows(1)) === JSON.stringify(['Dumbbell curl', 'Overhead extension']) && (await plan()).days[1].title === 'Arms', await rows(1));
// A day's tools: it folds to one line, and its options are in a menu out of its button.
await page.click('#screen .cp-day[data-key="day-0"] [data-act="cpDayFold"]');
await settle(500);
const folded = await S(() => { const d = document.querySelector('#screen .cp-day[data-key="day-0"]'); const s = d.querySelector('.cp-day-sum'); return { on: d.classList.contains('is-folded'), list: !!d.querySelector('.cp-exlist'), add: !!d.querySelector('[data-act="cpAdd"]'), sum: s ? s.textContent.replace(/\s+/g, ' ').trim() : '', exp: d.querySelector('.cp-day-fold').getAttribute('aria-expanded') }; });
check('a day folds to one line that names its exercises', folded.on && !folded.list && !folded.add && folded.exp === 'false' && folded.sum === '3 exercises: Push-up, bent-over row and goblet squat', folded);
await page.evaluate(() => document.querySelector('#screen .cp-day[data-key="day-0"]').scrollIntoView({ block: 'start' }));
await settle(300);
await shot('08a-folded', true);
await page.click('#screen .cp-day[data-key="day-0"] .cp-day-sum');
await settle(500);
check('and a tap on that line opens it again', await page.locator('#screen .cp-exlist[data-day="0"] .cp-ex').count() === 3 && await S(() => document.querySelector('#screen .cp-day[data-key="day-0"] .cp-day-fold').getAttribute('aria-expanded')) === 'true');
{
  const dm0 = await dayMenu('day-0');
  check('a day\'s options open as a menu out of its button: Rename day, Move day down, Duplicate day, Delete day', dm0 && !dm0.sheet && JSON.stringify(dm0.items) === JSON.stringify(['Rename day', 'Move day down', 'Duplicate day', 'Delete day']), dm0);
  await shot('08b-daymenu', true);
  await pickMenu('cpDayRename');
  check('Rename day puts the cursor in its name', await S(() => document.activeElement && document.activeElement.id) === 'cpDay0');
  await S(() => document.activeElement.blur());
  await settle(300);
  const dm1 = await dayMenu('day-1');
  check('the last day\'s menu: Move day up', dm1 && JSON.stringify(dm1.items) === JSON.stringify(['Rename day', 'Move day up', 'Duplicate day', 'Delete day']), dm1);
  await pickMenu('cpDayCopy');
  const dup = await plan();
  const dupT = await toasts();
  check('Duplicate day: a copy right after it, and a toast says where', dup.days.length === 3 && dup.days[2].title === 'Arms' && JSON.stringify(dup.days[2].items) === JSON.stringify(dup.days[1].items) && /Day 2 duplicated/.test(dupT) && /day 3 now/.test(dupT), { days: dup.days.map((d) => d.title), dupT });
  await dayMenu('day-2');
  await pickMenu('cpDayDelete');
  const delT = await toasts();
  check('Delete day: gone at once, with Undo', (await plan()).days.length === 2 && /Arms deleted/.test(delT), delT);
  await undo(/Arms deleted/);
  check('and Undo brings it back', (await plan()).days.length === 3 && await page.locator('#screen .cp-day').count() === 3);
  await dayMenu('day-2');
  await pickMenu('cpDayDelete');
  check('(deleted again: two days)', (await plan()).days.length === 2);
  await dayMenu('day-0');
  await pickMenu('cpDayMove');
  const moved = (await plan()).days.map((d) => d.title);
  await dayMenu('day-1');
  await pickMenu('cpDayMove');
  const back = (await plan()).days.map((d) => d.title);
  check('Move day down moves it, and Move day up puts it back', moved[0] === 'Arms' && back[1] === 'Arms' && !(await S(() => !!document.querySelector('.rf-menu:popover-open'))), { moved, back });
}
// Set days.
await page.click('#screen .cp-sched input[value="set"]', { force: true });
await settle(600);
p = await plan();
check('two days, the second named, on Monday and Thursday', p.days.length === 2 && p.days[1].title === 'Arms' && JSON.stringify(p.weekdays) === '[0,3]', { days: p.days.length, title: p.days[1].title, wd: p.weekdays });
await page.click('#screen .cp-wds [data-v="3"]');
await page.click('#screen .cp-wds [data-v="4"]');
await settle(500);
p = await plan();
check('picking other days moves day 2 to Friday', JSON.stringify(p.weekdays) === '[0,4]' && /day 2 on Fri/.test(await page.locator('#screen .cp-sched').innerText()), p.weekdays);
await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
await settle(300);
await shot('08-plan');
await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight; });
await settle(300);
await shot('09-plan-days', true);

/* ------------------------------------------------------------------ using it */
section('Using it');
await page.evaluate(() => { document.getElementById('screen').scrollTop = 0; });
await page.click('#screen [data-act="cpUse"]');
await settle(700);
check('Use this plan puts it in use', await S(() => window.GH.ui.S.activePlan) === p.id && /Using Morning strength/.test(await toasts()), await toasts());
check('its page says so', /In use/.test(await page.locator('#screen .cp-hero').innerText()));
await page.evaluate(() => window.GH.ui.go('plan'));
await settle(900);
const w = await S(() => { const U = window.GH.ui, w = window.GH.planWeek(U.S, U.today()); return { kinds: w.days.map((d) => d.kind), titles: w.days.map((d) => d.title) }; });
check('the Plan tab follows it: Monday and Friday', w.kinds[0] === 'today' && w.kinds[4] === 'workout' && w.kinds[1] !== 'workout' && w.titles[4] === 'Arms', w);
check('with the plan above the week', /Your plan\s*Morning strength/.test(await page.locator('#screen .cp-banner').innerText()));
await settle(7000);
await shot('10-plan-tab');
await page.click('.rf-tab[data-tab="today"]');
await settle(900);
check('Today shows the plan\'s first day', /Morning strength/.test(await page.locator('#screen .session').innerText()) && /Push-up/.test(await page.locator('#screen .session').innerText()));
await shot('11-today');

section('Running it in the player');
await page.click('#float [data-act="startWorkout"]');
await page.waitForSelector('.player:not([hidden]) .pl-name');
const pstate = () => page.evaluate(() => {
  const pl = document.querySelector('.player');
  const q = (sel) => pl.querySelector(sel);
  const t = q('.pl-actions [data-variant="tinted"]');
  return { checkin: !!(q('.rf-large-title') && q('.rf-large-title').textContent === 'Check-in'), act: t ? t.getAttribute('data-act') : null, rir: !!q('.pl-rir'), rirChosen: !!q('.pl-rir input:checked'), skipRest: !!q('[data-act="plSkipRest"]'), name: q('.pl-name') ? q('.pl-name').textContent : '' };
});
let guard = 0, rirAsked = 0, sawRest = false;
const names = new Set();
while (guard++ < 300) {
  const st = await pstate();
  if (st.checkin) break;
  if (st.name) names.add(st.name);
  if (st.rir && !st.rirChosen) { rirAsked++; if (rirAsked === 1) await shot('12-rest'); await page.click('.player .pl-rir input[value="3"]', { force: true }); await page.waitForTimeout(80); continue; }
  if (st.skipRest) { sawRest = true; await page.clock.fastForward(125000); await page.waitForTimeout(150); continue; }
  if (st.act === 'plStartTimer') { await page.click('.player [data-act="plStartTimer"]'); await page.clock.fastForward(3500); await page.waitForTimeout(100); await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act === 'plStopEarly' || st.act === 'plCancelTimer') { await page.clock.fastForward(70000); await page.waitForTimeout(150); continue; }
  if (st.act) { await page.click(`.player [data-act="${st.act}"]`); await page.waitForTimeout(100); continue; }
  await page.waitForTimeout(150);
}
check('the player ran the plan\'s exercises', ['Push-up', 'Bent-over row', 'Goblet squat'].every((n) => names.has(n)), [...names]);
check('with rests and the how-many-more question on each', sawRest && rirAsked === 3, { sawRest, rirAsked });
check('to the check-in', (await pstate()).checkin);
await page.click('.player [data-act="plSaveCheckin"]');
await page.waitForSelector('.player .rf-large-title:has-text("Next time")', { timeout: 5000 });
const next = await page.locator('.player').innerText();
// (A number keeps to its unit and the arrow to its number: no-break spaces, which \s takes.)
check('Next time: its targets move on', /Push-up →\s\d+\sreps/.test(next) && /Goblet squat →\s\d+\sreps/.test(next), next.slice(0, 300));
await shot('13-next');
await page.click('.player [data-act="plClose"]');
await settle(900);
const logged = await S(() => { const U = window.GH.ui, S = U.S; const l = S.log.find((x) => x.type === 'workout' && x.day === U.today()); return l ? { title: l.title, moves: l.items.map((it) => it.moveId), done: window.GH.brain.isDone(l), prog: Object.keys(S.planProg[S.activePlan] || {}) } : null; });
check('the workout is saved and counts', logged && logged.done && logged.moves.join() === 'push_std,row_db,sq_goblet' && logged.prog.length === 3, logged);

/* ------------------------------------------------------------------ sharing */
section('Sharing');
await page.evaluate((id) => window.GH.ui.open('planEdit', id), p.id);
await settle(800);
await page.click('#topbar [data-act="cpShare"]');
await settle(900);
check('the share sheet draws a QR code', await page.locator('dialog[open] .cp-qr svg path').count() === 1 && /A QR code for Morning strength/.test(await page.locator('dialog[open] .cp-qr svg').getAttribute('aria-label')));
check('with the plan and who it\'s from', /Morning strength/.test(await page.locator('dialog[open] .cp-share-what').innerText()) && /from Alex/.test(await page.locator('dialog[open] .cp-share-what').innerText()));
await shotSheet('14-share');
await page.click('dialog[open] [data-act="cpSendLink"]');
await settle(300);
const shared = await S(() => window.__shared.slice(-1)[0]);
const link = shared && (/https:\/\/shadowsdistant\.github\.io\/gradient-health\/p\/#[A-Za-z0-9_-]+/.exec(shared.text) || [])[0];
check('Send a link opens the share sheet with a short message and the link', !!link && /^Alex shared a workout plan with you: Morning strength \(2 days · 5 exercises\)\. Open it in Gradient Health: /.test(shared.text), shared);
const sharedBack = link && await S(async (l) => (await window.GH.customPlan.decode(l)).plan, link);
check('the link holds the plan', sharedBack && sharedBack.name === 'Morning strength' && sharedBack.days[1].title === 'Arms' && sharedBack.from === 'Alex' && JSON.stringify(sharedBack.weekdays) === '[0,4]', sharedBack);
await page.evaluate(() => { const i = document.querySelector('dialog[open] .rf-list input[role="switch"]'); i.click(); });
await settle(500);
check('Show my name off: the code leaves it out', !/from Alex/.test(await page.locator('dialog[open] .cp-share-what').innerText()));
await page.click('dialog[open] [data-act="cpCopyLink"]');
await settle(300);
const copied = await S(() => window.__copied);
check('Copy puts the link on the clipboard', /\/p\/#/.test(copied) && !(await S(async (l) => (await window.GH.customPlan.decode(l)).plan.from, copied)));
await closeSheets();

/* ------------------------------------------------------------------ getting one */
section('Getting a shared plan');
const friend = await S(async () => {
  const C = window.GH.customPlan;
  const plan = C.normalize({ name: 'Sam\'s gym split', note: 'Heavy first, then the rest.', weekdays: [1, 3, 5], days: [
    { title: 'Upper', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'curl_std', sets: 3, reps: 12 }] },
    { title: 'Lower', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'hg_rdl', sets: 3, reps: 10 }] },
    { title: 'Core', items: [{ move: 'ab_deadbug', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, secs: 30 }] },
  ] }).plan;
  return C.link(await C.encode(plan, { from: 'Sam' }));
});
check('other links go on to the next handler', await S(() => window.__gh.onLink('https://example.com/elsewhere')) === false);
check('a plan link is taken', await S((l) => window.__gh.onLink(l), friend) === true);
await settle(1200);
check('the preview opens: Sam\'s 3-day plan', /Sam's 3-day plan/.test(await page.locator('dialog[open] .rf-sheet-title').innerText()));
const preview = await page.locator('dialog[open] .cp-import').innerText();
check('with its days and exercises', /Upper/.test(preview) && /Barbell bench press/.test(preview) && /Lower/.test(preview) && /Core/.test(preview));
check('and what replaces the moves you have no equipment for', /Floor press for you: needs a barbell, a bench and a squat rack/.test(preview) && await page.locator('dialog[open] .cp-imp-list .cp-swap').count() >= 3, preview.slice(0, 400));
await settle(1500);
await shotSheet('15-import');
await page.click('dialog[open] [data-act="cpImpSave"]');
await settle(600);
check('Save to my plans saves it, from Sam', /Saved to your plans/.test(await page.locator('dialog[open] .cp-saved').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).some((x) => x.name === 'Sam\'s gym split' && x.from === 'Sam' && x.source === 'shared')));
await shotSheet('16-import-saved');
await page.click('dialog[open] [data-act="cpImpUse"]');
await settle(900);
check('Use it now switches to it and shows the Plan tab', await S(() => window.GH.ui.route.tab) === 'plan' && await S(() => window.GH.customPlan.get(window.GH.ui.S, window.GH.ui.S.activePlan).name) === 'Sam\'s gym split');
check('from tomorrow, since today\'s workout is done', /from tomorrow/.test(await page.locator('#screen .cp-banner').innerText()));
await S((l) => window.__gh.onLink(l), friend);
await settle(1200);
check('the same link again finds the saved copy', /Already in your plans/.test(await page.locator('dialog[open] .cp-import').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).filter((x) => x.name === 'Sam\'s gym split').length) === 1);
await closeSheets();

/* ------------------------------------------------------------------ the coach builds one */
section('Ask the coach');
// A stand-in on-device model: it answers with the draft's days (moves its grammar allows, and the
// draft's own sets, so it keeps to the plan's checks whatever the draft holds), named and noted
// its own way.
await page.evaluate(() => {
  const GH = window.GH;
  window.__grammar = null;
  GH.llm = {
    MODELS: [], available: () => ({ ok: true, reason: '' }), installed: async () => [{ id: 'stand-in' }], load: async () => ({}),
    chat: async (messages, opts) => {
      window.__grammar = opts.grammar;
      const draft = JSON.parse(messages[messages.length - 1].content.split('\nDraft: ')[1]);
      return JSON.stringify({ name: 'Arms first, knees easy', note: 'Arms twice a week and nothing hard on your knees.', days: draft.days.map((d, k) => ({ title: `Day ${String.fromCharCode(65 + k)}`, items: d.items })) });
    },
  };
  GH.deviceCoach.pick = () => 'stand-in';
  GH.ui.S.ai.mode = 'device';
});
await page.evaluate(() => window.GH.ui.open('plans'));
await settle(800);
await page.click('#screen .cp-make [data-act="cpBuild"]');
await settle(800);
check('the coach shows what it already knows', /Equipment/.test(await page.locator('dialog[open] .cp-knows').innerText()) && /dumbbells 10\/15 lb/.test(await page.locator('dialog[open] .cp-knows').innerText()));
await shotSheet('17-build');
await page.fill('#cpAskQ', '3 days, 30 minutes, I want bigger arms, bad knees');
await page.click('dialog[open] [data-act="cpBuildGo"]');
await settle(1500);
const built = await page.locator('dialog[open] .cp-import').innerText();
check('it builds a plan and a model refines it', /Arms first, knees easy/.test(built) && /with the on-device AI/.test(built) && /Arms twice a week/.test(built), built.slice(0, 300));
const gramOk = await S(() => {
  const C = window.GH.customPlan, U = window.GH.ui;
  const ids = [...window.__grammar.split('\n').find((l) => l.startsWith('move ::=')).matchAll(/\\"([a-z0-9_]+)\\"/g)].map((m) => m[1]);
  const S2 = JSON.parse(JSON.stringify(U.S)); S2.profile.careful = ['knee'];
  const cx = C.context(S2, U.today());
  return { n: ids.length, ok: ids.every((id) => C.check(cx, id).ok), jump: ids.includes('sq_jump'), days: (window.__grammar.match(/ day /g) || []).length };
});
check('the model could only use moves this person can do, for three days', gramOk.n > 10 && gramOk.ok && !gramOk.jump && gramOk.days === 3, gramOk);
await shotSheet('18-build-plan');
await page.click('dialog[open] [data-act="cpBuildSave"]');
await settle(600);
check('Save keeps it, built by the coach', /Saved to your plans/.test(await page.locator('dialog[open] .cp-saved').innerText()) && await S(() => window.GH.customPlan.list(window.GH.ui.S).some((x) => x.source === 'coach' && x.name === 'Arms first, knees easy')));
await page.click('dialog[open] [data-act="cpBuildOpen"]');
await settle(900);
check('Edit it opens it like any plan', await S(() => window.GH.ui.route.view) === 'planEdit' && /Arms first, knees easy/.test(await page.locator('#screen .cp-title').innerText()));
await shot('19-coach-plan');
// A model's answer that breaks the rules is dropped, and the app's own plan stands.
await page.evaluate(() => { window.GH.llm.chat = async () => JSON.stringify({ name: 'Bad', note: '', days: [{ title: 'X', items: [{ move: 'sq_jump', sets: 3, reps: 10 }, { move: 'bench_bb', sets: 3, reps: 10 }] }] }); });
await page.evaluate(() => window.GH.ui.back());
await settle(700);
await page.click('#screen .cp-make [data-act="cpBuild"]');
await settle(700);
await page.fill('#cpAskQ', '3 days, bigger arms, bad knees');
await page.click('dialog[open] [data-act="cpBuildGo"]');
await settle(1500);
const kept = await page.locator('dialog[open] .cp-import').innerText();
check('a model answer with moves they can\'t do is dropped: the coach\'s own plan stands', /3-day plan for bigger arms/.test(kept) && !/Bad/.test(kept) && /Built by the coach\n/.test(kept + '\n'), kept.slice(0, 200));
await closeSheets();

/* ------------------------------------------------------------------ back to the coach */
section('Back to the coach\'s plan');
await page.evaluate(() => window.GH.ui.render());
await settle(500);
await page.click('#screen .cp-inuse [data-act="cpCoach"]');
await settle(700);
check('back to the coach\'s plan', await S(() => window.GH.ui.S.activePlan) === null && /Back to the coach's plan/.test(await toasts()));
check('the Plans page shows the coach\'s plan in use and your plans saved', /The coach's plan/.test(await page.locator('#screen .cp-inuse').innerText()) && await page.locator('#screen .cp-plan').count() === 3);
await shot('20-plans-saved');
await page.evaluate(() => window.GH.ui.go('plan'));
await settle(900);
const w2 = await S(() => { const U = window.GH.ui, w = window.GH.planWeek(U.S, U.today()); return { banner: !!document.querySelector('#screen .cp-banner'), next: w.next.days.filter((d) => d.kind === 'workout').map((d) => d.title) }; });
check('the Plan tab has the coach\'s week again', !w2.banner && w2.next.length === 4 && !w2.next.includes('Upper'), w2);
await page.click('#screen [data-key="mine"] [data-act="openPlans"]');
await settle(800);
await page.click('#screen .cp-plan:nth-child(1) [data-act="cpOpen"]');
await settle(800);
await page.click('#topbar [data-act="cpMenu"]');
await settle(600);
await page.click('dialog[open] [data-act="cpDelete"]');
await settle(900);
// At once, with Undo (no question first: the toast's Undo is the way back).
check('deleting a plan: at once, no question, with Undo', await S(() => window.GH.customPlan.list(window.GH.ui.S).length) === 2 && /Plan deleted/.test(await toasts()) && await S(() => !document.querySelector('dialog.rf-dialog[open]')), await toasts());
// (Its own toast's Undo: the one from going back to the coach's plan, just before, can still be up.)
await undo(/Plan deleted/);
await settle(300);
check('and Undo brings it back', await S(() => window.GH.customPlan.list(window.GH.ui.S).length) === 3);
await page.click('#screen .cp-plan:nth-child(1) [data-act="cpOpen"]');
await settle(800);
await page.click('#topbar [data-act="cpMenu"]');
await settle(600);
await page.click('dialog[open] [data-act="cpDelete"]');
await settle(900);

/* ------------------------------------------------------------------ a ready-made plan */
section('A ready-made plan, and the limits');
await page.evaluate(() => { if (window.GH.ui.route.view !== 'plans') window.GH.ui.open('plans'); });
await settle(800);
await page.click('#screen .cp-make [data-act="cpNew"]');
await settle(1500);
await page.click('dialog[open] [data-act="cpNewTemplate"][data-arg="full"]');
await settle(900);
const full = await S(() => {
  const U = window.GH.ui, C = window.GH.customPlan, pl = C.get(U.S, U.route.arg), cx = C.context(U.S, U.today());
  return { view: U.route.view, name: pl.name, source: pl.source, titles: pl.days.map((d) => d.title), n: pl.days.map((d) => d.items.length), ok: pl.days.every((d) => d.items.every((it) => C.check(cx, it.move).ok)), mins: pl.days.map((d, i) => C.minutes(U.S, pl, i, U.today())), use: !!document.querySelector('#screen [data-act="cpUse"]') };
});
check('Full body: its own page, a day for each of your four, A to D, every move one you can do', full.view === 'planEdit' && full.name === 'Full body' && full.source === 'you' && JSON.stringify(full.titles) === '["Full body A","Full body B","Full body C","Full body D"]' && full.n.every((k) => k >= 3) && full.ok && full.use, full);
check('each about your 25 minutes', full.mins.every((m) => m >= 20 && m <= 30), full.mins);
check('and a toast says it\'s ready', /Full body is ready/.test(await toasts()), await toasts());
await shot('21a-template');
// Twelve exercises a day: the 13th says why, and so does the day.
await page.click('#screen [data-act="cpAdd"][data-arg="0"]');
await settle(900);
const room = 12 - (await plan()).days[0].items.length;
for (let i = 0; i < room; i++) { await S(() => document.querySelector('dialog[open] .cp-row:not(.is-in) .cp-row-main').click()); await settle(150); }
check('the tray fills to 12 of 12', await S(() => document.querySelector('dialog[open] .cp-tray-n').textContent) === '12' && /of 12/.test(await S(() => document.querySelector('dialog[open] .cp-tray-of').textContent)));
await S(() => document.querySelector('dialog[open] .cp-row:not(.is-in) .cp-row-main').click());
await settle(400);
const fullDay = await toasts();
check('a 13th says the day is full, and why', /Day 1 is full/.test(fullDay) && /12 exercises is the most a day holds/.test(fullDay) && await S(() => document.querySelector('dialog[open] .cp-tray-n').textContent) === '12', fullDay);
await shot('21b-picker-full', true);
await page.click('dialog[open] [data-act="cpPickDone"]');
await settle(800);
check('the day says so where Add exercises was', /That's 12, the most a day holds/.test(await page.locator('#screen .cp-day[data-key="day-0"]').innerText()) && await page.locator('#screen [data-act="cpAdd"][data-arg="0"]').count() === 0);
// Six days a plan.
await page.click('#screen [data-act="cpAddDay"]');
await settle(700);
await page.click('#screen [data-act="cpAddDay"]');
await settle(700);
const six = await S(() => ({ days: document.querySelectorAll('#screen .cp-day').length, note: (document.querySelector('#screen .cp-limit[data-key="addday"]') || {}).textContent, add: !!document.querySelector('#screen [data-act="cpAddDay"]') }));
check('six days: Add a day gives way to why', six.days === 6 && !six.add && /Six days is the most a plan holds, so there's always a day to rest/.test(six.note), six);
const dm6 = await dayMenu('day-0');
check('and a day can\'t be duplicated then', dm6 && !dm6.items.includes('Duplicate day') && dm6.items.includes('Delete day'), dm6);
await pickMenu('cpDayRename');
await S(() => document.activeElement && document.activeElement.blur());
await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight; });
await settle(300);
await shot('21c-six-days', true);

/* ------------------------------------------------------------------ the share page */
section('The share page (a link opened in a browser)');
const pageUrl = `${server.url.replace('/gradient-health.html', '')}/p/index.html#${link.split('#')[1]}`;
for (const [who, ua] of [['Android', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'], ['desktop', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36']]) {
  const c2 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', userAgent: ua });
  const p2 = await c2.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  p2.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const outside = [];
  p2.on('request', (r) => { if (!r.url().startsWith(server.url.replace('/gradient-health.html', ''))) outside.push(r.url()); });
  await p2.goto(pageUrl);
  await p2.waitForSelector('#plan:not([hidden])', { timeout: 5000 }).catch(() => {});
  const info = await p2.evaluate(() => ({ name: document.getElementById('name').textContent, meta: document.getElementById('meta').textContent, days: [...document.querySelectorAll('.day h2')].map((h) => h.textContent), ex: [...document.querySelectorAll('.day .ex')].map((e) => e.firstChild.textContent), open: document.getElementById('open').hidden ? null : document.getElementById('open').getAttribute('href'), qr: !!document.querySelector('#scan:not([hidden]) svg path') }));
  check(`${who}: the page shows the plan from the link`, info.name === 'Morning strength' && /2 days a week · 5 exercises/.test(info.meta) && info.days.length === 2 && /Arms/.test(info.days[1]) && info.ex.includes('Push-up'), info);
  if (who === 'Android') check('Android: Open in Gradient Health goes to the app', !!info.open && info.open.startsWith(`intent://plan?d=${link.split('#')[1]}#Intent;scheme=gradienthealth;package=com.shadowsdistant.gradienthealth;`) && info.open.endsWith(';end'), info.open);
  else check('elsewhere: a code to scan with the app instead', info.qr && info.open === null);
  check(`${who}: no other requests, no errors (its policy allows only its own script)`, outside.length === 0 && errs.length === 0, { outside, errs });
  await p2.screenshot({ path: join(OUT, `22-share-page-${who}${tag}.png`), fullPage: true });
  await c2.close();
}
{
  const c3 = await browser.newContext({ viewport: { width, height: 700 }, colorScheme: dark ? 'dark' : 'light' });
  const p3 = await c3.newPage();
  await p3.goto(`${server.url.replace('/gradient-health.html', '')}/p/index.html#AQnotaplan`);
  await p3.waitForTimeout(300);
  check('a broken link says so', await p3.evaluate(() => !document.getElementById('error').hidden && document.getElementById('plan').hidden));
  await c3.close();
}

/* ------------------------------------------------------------------ a link that starts the app */
section('A link that starts the app');
const joLink = await S(async () => {
  const C = window.GH.customPlan;
  const plan = C.normalize({ name: 'Lunch break', days: [{ title: 'Quick one', items: [{ move: 'push_std', sets: 3, reps: 10 }, { move: 'sq_goblet', sets: 3, reps: 12 }] }] }).plan;
  return C.link(await C.encode(plan, { from: 'Jo' }));
});
// The link MainActivity was started with, as AndroidBridge.pendingLink() gives it.
const startedWith = (l) => {
  try { sessionStorage.setItem('pending-link', l); } catch (e) { /* ignore */ }
  if (window.AndroidBridge) window.AndroidBridge.pendingLink = () => { try { return sessionStorage.getItem('pending-link') || ''; } catch (e) { return ''; } };
};
const titles = (p) => p.evaluate(() => [...document.querySelectorAll('dialog[open] .rf-sheet-title')].map((e) => e.textContent));
// Sheets animate in real time while timers run on the test's clock: step both until ok(titles).
const sheetsUntil = async (p, ok) => {
  let t = await titles(p);
  for (let i = 0; i < 40 && !ok(t); i++) { await p.clock.runFor(250); await p.waitForTimeout(120); t = await titles(p); }
  return t;
};
{
  // Someone who just updated the app: What's new comes first, then the plan.
  const c4 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const p4 = await c4.newPage();
  p4.on('pageerror', (e) => errors.push(e.message));
  p4.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p4.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await p4.addInitScript(seedBridge);
  await p4.goto(server.url);
  await p4.waitForSelector('.onboard:not([hidden])');
  await p4.evaluate(seedState);
  await p4.evaluate(() => { const GH = window.GH, S = GH.store.load(); S.seen.lastVersion = '1.0.0'; GH.store.save(S); });
  await p4.addInitScript(startedWith, joLink);
  await p4.reload();
  await p4.waitForSelector('#screen[data-view="today"]');
  const first4 = await sheetsUntil(p4, (t) => t.length > 0);
  await p4.clock.runFor(2500); await p4.waitForTimeout(300);
  first4.push(...(await titles(p4)).slice(1));
  check('What\'s new comes first, on its own', first4.length === 1 && /What's new/.test(first4[0]), first4);
  await p4.evaluate(() => window.GH.ui.closeSheets());
  const then = await sheetsUntil(p4, (t) => t.length === 1 && !/What's new/.test(t[0]));
  check('then the plan the app was opened with', then.length === 1 && then[0] === 'Jo\'s 1-day plan', then);
  // Someone who turned workouts off (food and health only) can still take a plan and use it.
  await p4.evaluate(() => window.GH.ui.closeSheets());
  await sheetsUntil(p4, (t) => t.length === 0);
  await p4.evaluate(() => { const U = window.GH.ui; U.S.profile.workouts = false; U.save(true); U.render(); });
  await p4.clock.runFor(700); await p4.waitForTimeout(200);
  await p4.evaluate((l) => window.__gh.onLink(l), joLink);
  await sheetsUntil(p4, (t) => t.length === 1);
  await p4.clock.runFor(600); await p4.waitForTimeout(300);
  await p4.click('dialog[open] [data-act="cpImpSave"]');
  await p4.clock.runFor(600); await p4.waitForTimeout(200);
  check('with workouts off, the plan offers to turn them on', (await p4.locator('dialog[open] [data-act="cpImpUse"]').innerText()).trim() === 'Turn on workouts and use it');
  await p4.click('dialog[open] [data-act="cpImpUse"]');
  await p4.clock.runFor(900); await p4.waitForTimeout(300);
  const on = await p4.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan; return { workouts: U.S.profile.workouts, plan: C.activeId(U.S) && C.get(U.S, C.activeId(U.S)).name, tab: U.route.tab, tabs: U.tabList().map((t) => t[0]).join(','), toast: [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' ') }; });
  check('and doing so turns workouts on and uses it, on the Plan tab', on.workouts === true && on.plan === 'Lunch break' && on.tab === 'plan' && /plan/.test(on.tabs) && /Workouts are on again/.test(on.toast), on);
  await c4.close();
}
{
  // A new install opened by a link: set-up's welcome offers the plan, and two quick questions later
  // it's in use, with no tour and no import sheet over the app (the rest is test/ui-onboarding.mjs).
  const c5 = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
  const p5 = await c5.newPage();
  p5.on('pageerror', (e) => errors.push(e.message));
  p5.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p5.clock.install({ time: new Date('2026-10-19T08:10:00') });
  await p5.addInitScript(seedBridge);
  await p5.addInitScript(startedWith, joLink);
  await p5.goto(server.url);
  await p5.waitForSelector('.onboard:not([hidden])');
  await p5.clock.runFor(2500); await p5.waitForTimeout(300);
  check('a new install starts with set-up, not the plan', (await titles(p5)).length === 0);
  await p5.waitForSelector('.onboard .ob-shared', { timeout: 5000 }).catch(() => null);
  check('its welcome offers the plan, from Jo', /Jo sent you a plan/.test(await p5.locator('.onboard').innerText()) && (await p5.locator('.ob-actions [data-variant="tinted"]').innerText()).trim() === 'Start with Jo\'s plan');
  for (let i = 0; i < 3; i++) { await p5.locator('.ob-actions [data-variant="tinted"]').click(); await p5.clock.runFor(100); await p5.waitForTimeout(500); }
  check('two quick questions, then the plan as it\'ll be done', await p5.locator('.onboard .ob-friend').count() === 1 && /Lunch break/.test(await p5.locator('.onboard').innerText()));
  await p5.click('.ob-actions [data-act="obLook"]');
  await p5.clock.runFor(3000); await p5.waitForTimeout(300);
  const st = await p5.evaluate(() => { const U = window.GH.ui, C = window.GH.customPlan, S = U.S; const id = C.activeId(S); return { plan: id && C.get(S, id).name, tour: !!S.seen.tour, sheets: [...document.querySelectorAll('dialog[open] .rf-sheet-title')].map((e) => e.textContent) }; });
  check('then it\'s in use, with no tour and no plan sheet over the app', st.plan === 'Lunch break' && st.tour && st.sheets.length === 0, st);
  await c5.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 10).join('\n'));
await browser.close();
await server.close();
console.log(`\nscreenshots in build/ui-customplan/`);
done();
