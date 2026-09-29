// The Health tab in Chromium at phone size with someone five weeks in: every number opens its
// metric sheet (resting heart rate's history, ranges, the chart inside its plot), Add or change for
// today's weight updates the tile and removing it brings Health Connect's back, the This week card
// has no paragraphs and opens the whole report, insights open in place, the + menu logs weight and
// sleep, and nothing in the sheets spills sideways at 360 px with 130% text.
// Usage: node test/ui-health.mjs [--dark] [--width=390]
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
const tab = async (t) => { await page.click(`.rf-tab[data-tab="${t}"]`); await settle(); };
const sheetOpen = (sel) => page.waitForSelector(`dialog.rf-sheet[open]${sel || ''}`, { timeout: 5000 }).then(() => true, () => false);
const closeSheets = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await settle(900); };
const S = (fn) => page.evaluate(fn);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent).join(' | '));
// A tile's value as its parts read ("160.4 lb", "7 h 45 min"); numbers that roll carry their
// settled value in data-roll.
const tileValue = (key) => page.evaluate((k) => { const t = document.querySelector(`#screen .hl-tile[data-arg="${k}"] .hl-tile-value`); return t ? [...t.querySelectorAll('.mv > *')].map((x) => x.getAttribute('data-roll') || x.textContent).join(' ') : null; }, key);

await tab('health');

section('Every number opens its metric sheet');
const tiles = await page.evaluate(() => [...document.querySelectorAll('#screen .hl-tile')].map((t) => ({ tag: t.tagName, act: t.dataset.act, arg: t.dataset.arg })));
check('four hero tiles and the smaller ones, all buttons that open a sheet', tiles.length >= 8 && tiles.every((t) => t.tag === 'BUTTON' && t.act === 'metricOpen' && t.arg), JSON.stringify(tiles));
check('the hero tiles are sleep, steps, resting heart rate and weight', (await page.evaluate(() => [...document.querySelectorAll('#screen .hl-hero')].map((t) => t.dataset.arg).join())) === 'sleepMin,steps,rhr,weightKg');
const trendRows = await page.evaluate(() => [...document.querySelectorAll('#screen .hl-tr')].map((r) => ({ arg: r.dataset.arg, spark: !!r.querySelector('.sp-svg'), value: r.querySelector('.hl-tr-value').textContent.trim() })));
check('trends are sparkline rows with the newest value, and open sheets too', trendRows.length >= 5 && trendRows.filter((r) => ['sleepMin', 'steps', 'rhr', 'weightKg'].includes(r.arg)).every((r) => r.spark && r.value !== '–'), JSON.stringify(trendRows));

section('Resting heart rate: its history');
await page.click('#screen .hl-tile[data-arg="rhr"]');
check('tapping Resting HR opens its sheet', await sheetOpen('.ms-sheet'));
await settle(700);
const rhr = await page.evaluate(() => {
  const d = document.querySelector('dialog.ms-sheet[open]');
  return {
    title: d.querySelector('.rf-sheet-title').textContent,
    value: d.querySelector('.ms-value').textContent.replace(/\s+/g, ' ').trim(),
    src: d.querySelector('.ms-src') && d.querySelector('.ms-src').textContent.trim(),
    compare: d.querySelector('.ms-compare') && d.querySelector('.ms-compare').textContent.replace(/\s+/g, ' ').trim(),
    chart: !!d.querySelector('.ch-plot .ch-svg'),
    stats: [...d.querySelectorAll('.ms-stat-k')].map((x) => x.textContent),
    rows: [...d.querySelectorAll('.ms-hist li')].map((li) => ({ when: li.querySelector('.rf-list-title').textContent, value: li.querySelector('.rf-list-detail').textContent.trim() })),
    more: d.querySelector('[data-act="metricMore"]') ? d.querySelector('[data-act="metricMore"]').textContent : null,
    ranges: [...d.querySelectorAll('[data-on="metricRange"] input')].map((i) => `${i.value}${i.checked ? '*' : ''}`).join(),
    about: d.querySelector('details.ms-about') ? { open: d.querySelector('details.ms-about').open, text: d.querySelector('details.ms-about').textContent } : null,
  };
});
check('the sheet is titled and shows the newest value in bpm', rhr.title === 'Resting heart rate' && /^\d+ ?bpm$/.test(rhr.value), JSON.stringify(rhr));
check('with where it came from and how it compares with the usual', rhr.src === 'Health Connect' && /usual/.test(rhr.compare), `${rhr.src} / ${rhr.compare}`);
check('a chart, and 7 days, 28 days, 90 days and a year to pick from', rhr.chart && rhr.ranges === '7,28*,90,365', rhr.ranges);
check('average, change, lowest and highest', rhr.stats.join() === 'Average,Change,Lowest,Highest', rhr.stats);
check('the actual daily values, newest first', rhr.rows.length === 14 && rhr.rows[0].when === 'Today' && rhr.rows[1].when === 'Yesterday' && rhr.rows.every((r) => /^\d+ bpm$/.test(r.value)), JSON.stringify(rhr.rows.slice(0, 3)));
check('the rest one tap away', /^Show all 2\d$/.test(rhr.more || ''), rhr.more);
check('what it means is folded away at the bottom', rhr.about && !rhr.about.open && /About this number/.test(rhr.about.text) && /rest/i.test(rhr.about.text));
await page.click('dialog.ms-sheet [data-act="metricMore"]');
await settle(400);
const all = await page.evaluate(() => document.querySelectorAll('dialog.ms-sheet .ms-hist li').length);
check('Show all lists every day of the range', all >= 25 && all <= 28 && !(await page.evaluate(() => !!document.querySelector('dialog.ms-sheet [data-act="metricMore"]'))), all);
await page.click('dialog.ms-sheet [data-on="metricRange"] input[value="7"]', { force: true });
await settle(700);
const week = await page.evaluate(() => {
  const d = document.querySelector('dialog.ms-sheet[open]');
  const p = d.querySelector('.ch-plot'), s = p.querySelector('.ch-svg');
  const a = p.getBoundingClientRect(), b = s.getBoundingClientRect();
  return { rows: d.querySelectorAll('.ms-hist li').length, key: s.getAttribute('data-key'), inside: b.height <= a.height + 1 && b.bottom <= a.bottom + 1, today: window.GH.ui.today() };
});
check('7 days: a week of rows', week.rows >= 5 && week.rows <= 7, week.rows);
check('and a week-long chart that stays inside its plot', week.key === `svg-${week.today - 6}-${week.today}` && week.inside, JSON.stringify(week));
await page.click('dialog.ms-sheet .ch-plot', { position: { x: 200, y: 40 } });
await settle(300);
check('tapping the chart shows a day\'s value', /: \d+ bpm/.test(await page.evaluate(() => document.querySelector('dialog.ms-sheet .ch-tip').textContent)));
await closeSheets();

section('Add or change today\'s weight');
const before = await tileValue('weightKg');
await page.click('#screen .hl-tile[data-arg="weightKg"]');
await sheetOpen('.ms-sheet');
await settle(600);
await page.click('dialog.ms-sheet [data-act="metricAdd"]');
check('Add or change opens a form for a value and a day', await sheetOpen('.ms-edit') && await page.evaluate(() => !!document.querySelector('dialog.ms-edit #msVal') && document.querySelector('dialog.ms-edit #msDay').type === 'date'));
await settle(500);
const form = await page.evaluate(() => ({ label: document.querySelector('dialog.ms-edit label[for="msVal"]').textContent, value: document.getElementById('msVal').value, day: document.getElementById('msDay').value, hint: document.querySelector('dialog.ms-edit .ms-hint').textContent }));
check('it\'s for today, in lb, filled in with Health Connect\'s number', form.label === 'Weight (lb)' && form.day === '2026-10-19' && form.value !== '' && /Health Connect has .* Yours will replace it/.test(form.hint), JSON.stringify(form));
await page.fill('dialog.ms-edit #msVal', '160.4');
await page.click('dialog.ms-edit [data-act="metricSave"]');
await settle(900);
const after = await tileValue('weightKg');
check('saving updates the Weight tile', /160\.4/.test(after) && after !== before, `${before} → ${after}`);
check('it\'s stored as your weigh-in for today, one per day', await S(() => { const U = window.GH.ui; const w = U.S.weights.filter((x) => x.day === U.today() && x.src !== 'profile'); return w.length === 1 && w[0].src === 'manual' && Math.abs(w[0].kg * 2.20462 - 160.4) < 0.05; }));
check('the toast says so', /Weight saved/.test(await toasts()), await toasts());
const mine = await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); const li = d.querySelector('.ms-hist li'); return { hero: d.querySelector('.ms-value').textContent.replace(/\s+/g, ''), src: d.querySelector('.ms-src').textContent.trim(), first: li.textContent.replace(/\s+/g, ' ').trim(), edit: !!li.querySelector('[data-act="metricEdit"]'), del: !!li.querySelector('[data-act="metricDelete"]'), others: [...d.querySelectorAll('.ms-hist li')].slice(1).some((x) => x.querySelector('[data-act="metricDelete"]')) }; });
check('the open sheet shows it too, marked as yours with edit and remove', /160\.4lb/.test(mine.hero) && mine.src === 'You' && /replaces .* from Health Connect/.test(mine.first) && mine.edit && mine.del && !mine.others, JSON.stringify(mine));
await page.click('dialog.ms-sheet .ms-hist li [data-act="metricDelete"]');
await settle(900);
const reverted = await tileValue('weightKg');
check('removing yours brings Health Connect\'s back', reverted === before && await S(() => { const U = window.GH.ui; return U.S.weights.filter((x) => x.day === U.today() && x.src !== 'profile').map((x) => x.src).join() === 'hc'; }), `${reverted} vs ${before}`);
check('with an Undo', /Removed your weight/.test(await toasts()) && /Undo/.test(await toasts()), await toasts());
await page.evaluate(() => { const t = [...document.querySelectorAll('.rf-toast')].filter((x) => /Removed your weight/.test(x.textContent)).pop(); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
await settle(900);
check('Undo puts yours back', /160\.4/.test(await tileValue('weightKg')));
await closeSheets();
// Health Connect's next sync doesn't overwrite it.
await page.evaluate(() => { window.GH.ui.syncHealth('manual'); });
await settle(1500);
check('a sync keeps your number', /160\.4/.test(await tileValue('weightKg')), await tileValue('weightKg'));

section('This week');
const card = await page.evaluate(() => {
  const c = document.querySelector('#screen .hl-week');
  if (!c) return null;
  const leaves = [...c.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const lines = (e) => { const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3; return Math.round(e.getBoundingClientRect().height / lh); };
  return {
    paragraphs: c.querySelectorAll('p, li').length,
    longest: Math.max(...leaves.map((e) => e.textContent.trim().length)),
    maxLines: Math.max(...leaves.map(lines)),
    words: c.querySelector('.hl-week-main').textContent.trim().split(/\s+/).length,
    pills: c.querySelectorAll('.hl-glance .hl-pill').length,
    wins: c.querySelectorAll('.hl-win').length,
    focus: c.querySelector('.hl-focus') ? c.querySelector('.hl-focus').textContent.replace(/\s+/g, ' ').trim() : null,
    chips: [...c.querySelectorAll('.hl-asks [data-act="askPreset"]')].length,
    askButton: !!c.querySelector('[data-act="askCoach"]'),
  };
});
check('there\'s a This week card', !!card);
check('no paragraphs: short pieces of at most two lines', card && card.paragraphs === 0 && card.longest <= 60 && card.maxLines <= 2 && card.words <= 70, JSON.stringify(card));
check('the week\'s numbers two by two, wins as badges, one line to focus on', card && card.pills === 4 && card.wins >= 1 && card.wins <= 2 && /^Focus next ?\S/.test(card.focus), JSON.stringify(card));
check('question chips stay, the Ask a question button is gone', card && card.chips >= 2 && !card.askButton);
await page.click('#screen .hl-week-main');
check('tapping the card opens the whole report', await sheetOpen('.rs-sheet'));
await settle(700);
const rep = await page.evaluate(() => { const d = document.querySelector('dialog.rs-sheet[open]'); return { title: d.querySelector('.rf-sheet-title').textContent, sections: [...d.querySelectorAll('.rs-h')].map((h) => h.textContent.trim()), pills: [...d.querySelectorAll('.rs-glance button.hl-pill')].map((b) => b.dataset.arg) }; });
check('with its sections', rep.title === 'This week' && rep.sections.includes('Wins') && rep.sections.includes('Focus next'), JSON.stringify(rep));
check('and its numbers open their own sheets', rep.pills.length === 4 && rep.pills.includes('rhr'), JSON.stringify(rep.pills));
await page.click('dialog.rs-sheet .rs-glance button.hl-pill[data-arg="sleepMin"]');
check('Sleep from the report opens the sleep sheet on top', await sheetOpen('.ms-sheet') && (await page.evaluate(() => document.querySelector('dialog.ms-sheet[open] .rf-sheet-title').textContent)) === 'Sleep');
await closeSheets();

section('Insights, one line each');
const ins = await page.evaluate(() => [...document.querySelectorAll('#screen details.hl-ins')].map((d) => ({ open: d.open, h: Math.round(d.getBoundingClientRect().height) })));
check('each insight is a single closed row', ins.length >= 1 && ins.every((x) => !x.open && x.h <= 80), JSON.stringify(ins));
await page.click('#screen details.hl-ins summary');
await settle(500);
const opened = await page.evaluate(() => { const d = document.querySelector('#screen details.hl-ins'); return { open: d.open, body: d.querySelector('.hl-ins-body').textContent.replace(/\s+/g, ' ').trim(), acts: [...d.querySelectorAll('.hl-ins-acts [data-act]')].map((b) => b.dataset.act) }; });
check('tapping one opens it in place: the detail, what it\'s based on, and what to do', opened.open && /Based on/.test(opened.body) && opened.acts.includes('dismissInsight'), JSON.stringify(opened));

section('Logging from the + menu');
check('the + button sits in the top bar next to sync', await page.evaluate(() => { const t = document.querySelector('#topbar .rf-navbar-trailing'); const b = t.querySelector('[popovertarget="hlLog"]'); return !!b && !!t.querySelector('[data-act="hcSync"]') && b.getAttribute('aria-label') === 'Log something'; }));
check('the Log rows are gone from the page', !(await page.evaluate(() => !!document.querySelector('#screen [data-act="logWeight"], #screen [data-act="logMeasure"]'))));
await page.click('#topbar [popovertarget="hlLog"]');
await page.waitForSelector('#hlLog [data-act="logWeight"]', { state: 'visible', timeout: 5000 });
await settle(400);
const items = await page.evaluate(() => [...document.querySelectorAll('#hlLog .rf-menu-item')].map((b) => b.textContent.trim()));
check('the menu offers weight, sleep, a feel check, an activity and measurements', items.join() === 'Weight,Sleep,Feel check,Activity,Measurements', items);
await page.click('#hlLog [data-act="logWeight"]');
check('Weight opens the same form', await sheetOpen('.ms-edit'));
await settle(500);
await page.fill('dialog.ms-edit #msVal', '158.2');
await page.click('dialog.ms-edit [data-act="metricSave"]');
await settle(900);
check('and logs it: the tile and the data', /158\.2/.test(await tileValue('weightKg')) && await S(() => { const U = window.GH.ui; const w = U.S.weights.filter((x) => x.day === U.today() && x.src === 'manual'); return w.length === 1 && Math.abs(w[0].kg * 2.20462 - 158.2) < 0.05; }));
check('the menu closed behind it', await page.evaluate(() => !document.querySelector('#hlLog:popover-open')));
await page.click('#topbar [popovertarget="hlLog"]');
await page.waitForSelector('#hlLog [data-act="logSleep"]', { state: 'visible', timeout: 5000 });
await settle(300);
await page.click('#hlLog [data-act="logSleep"]');
await sheetOpen('.ms-edit');
await settle(500);
await page.fill('dialog.ms-edit #msH', '7');
await page.fill('dialog.ms-edit #msM', '45');
await page.click('dialog.ms-edit [data-act="metricSave"]');
await settle(900);
check('Sleep logs hours and minutes for last night', await S(() => window.GH.ui.S.health.manual[window.GH.ui.today()].sleepMin === 465) && /7 h 45 min/.test(await tileValue('sleepMin')), await tileValue('sleepMin'));
const bad = await page.evaluate(() => { window.GH.ui.metricEdit('rhr', window.GH.ui.today()); return true; });
await settle(500);
await page.fill('dialog.ms-edit #msVal', '400');
await page.click('dialog.ms-edit [data-act="metricSave"]');
await settle(500);
check('an impossible value is turned away with a reason', bad && await sheetOpen('.ms-edit') && /Enter resting heart rate between 25 and 150 bpm/.test(await toasts()), await toasts());
await closeSheets();

section('Narrow screen, large text');
await page.setViewportSize({ width: 360, height: 780 });
await settle(400);
// The phone's text zoom at 130%, like the sweep: every font size under `root`, once (it multiplies).
const zoom = (root) => page.evaluate((r) => { const els = [...document.querySelectorAll(`${r} *`)].filter((e) => !e.closest('svg')); const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i) => { if (sizes[i]) e.style.setProperty('font-size', `${sizes[i] * 1.3}px`, 'important'); }); window.dispatchEvent(new Event('resize')); }, root);
// Sheets scroll, so the screen sweep doesn't look inside them: check their contents here.
const spill = () => page.evaluate(() => {
  const out = [];
  for (const d of document.querySelectorAll('dialog.rf-sheet[open]')) {
    const body = d.querySelector('.rf-sheet-body');
    const box = body.getBoundingClientRect();
    for (const e of body.querySelectorAll('*')) {
      if (e.closest('svg') || e.closest('.hl-asks')) continue;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > box.right + 1 || r.left < box.left - 1) out.push(`${e.className || e.tagName} ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(box.left)}..${Math.round(box.right)}`);
      const cs = getComputedStyle(e);
      if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 2) out.push(`clipped ${e.className}`);
    }
  }
  return [...new Set(out)].slice(0, 8);
});
for (const key of ['rhr', 'weightKg', 'sleepMin', 'steps', 'activeMin', 'waist', 'feel']) {
  await page.evaluate((k) => window.GH.ui.metricSheet(k), key);
  await settle(700);
  await page.evaluate(() => { const d = document.querySelector('dialog.ms-sheet[open]'); if (d && window.Refract) window.Refract.sheet.detent(d, 'large'); });
  await settle(700);
  await zoom('dialog.rf-sheet[open]');
  await page.waitForTimeout(150);
  const s = await spill();
  check(`${key}: nothing spills out of the sheet`, s.length === 0, s.join(' | '));
  await closeSheets();
}
await page.evaluate(() => window.GH.ui.act.healthReport());
await settle(700);
await zoom('dialog.rf-sheet[open]');
await page.waitForTimeout(150);
const rs = await spill();
check('the report sheet fits too', rs.length === 0, rs.join(' | '));
await closeSheets();
await zoom('#screen');
await page.waitForTimeout(150);
// A label narrower than its longest word has to break inside that word.
const wordBreaks = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('2d');
  return [...document.querySelectorAll('#screen .hl-tr-label, #screen .hl-tile-label, #screen .hl-pill-k, #screen .hl-mini-label, #screen .hl-ins-title')].filter((e) => {
    const cs = getComputedStyle(e);
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const words = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().split(/\s+/).filter(Boolean);
    const room = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return words.some((w) => c.measureText(w).width > room + 2);
  }).map((e) => e.textContent.trim());
});
check('labels on the page wrap between words, never inside one', wordBreaks.length === 0, wordBreaks.join(' | '));

section('Console');
check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
done();
