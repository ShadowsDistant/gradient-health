// Toasts (U.toast, src/ui/core.js) in Chromium at phone size, with someone five weeks in:
// - two at most, one over the other: a third sends the oldest away, the same words again take the
//   old one's place, and the two are the same width (a tidy stack)
// - each long enough to read (its countdown: 4 s at least, 6 with a button, longer for more words,
//   9 at most)
// - never over a sheet's main buttons or a field being typed in, the keyboard up or not
// - a page's toasts give way to a sheet opened over it; one that came with the tap stays
// - a new badge's toast waits until nothing else is up (no sheet, no other toast)
// - in a workout, clear of the player's buttons from one step to the next (a set, its rest, the next)
// - thick glass, dense enough that the page's words don't read through it
// Usage: node test/ui-toast.mjs [--dark] [--width=390]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const H = 844;
const server = await serveDist();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(seedBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
await page.waitForTimeout(1500);
const wait = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);

// The toasts up now (not leaving), bottom last: their words, box and countdown.
const toasts = () => ev(() => [...document.querySelectorAll('.rf-toast:not([data-leaving])')].map((t) => {
  const r = t.getBoundingClientRect();
  const clock = [...t.querySelectorAll('.rf-toast-close')].flatMap((b) => b.getAnimations()).find((a) => a.id === 'rf-countdown');
  const cs = getComputedStyle(t);
  const alpha = (() => { const m = /rgba?\(([^)]+)\)|oklab\(([^)]+)\)/.exec(cs.backgroundColor); if (!m) return 1; const s = (m[1] || m[2]).split(/[\s,/]+/).filter(Boolean); return s.length > 3 ? parseFloat(s[3]) : 1; })();
  return { title: (t.querySelector('.rf-toast-title') || {}).textContent, top: r.top, bottom: r.bottom, left: r.left, width: r.width, ms: clock ? clock.effect.getTiming().duration : null, alpha, inDialog: !!t.closest('dialog') };
}));
const clear = async () => { await ev(() => { window.Refract.toast.dismissAll(); window.GH.ui.closeSheets(); }); await wait(900); };
const overlaps = (a, b) => a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
// (Until the toasts and the toaster are still: in, and done gliding to their place.)
const toastStill = () => page.waitForFunction(() => {
  const x = document.querySelector('.rf-toaster[data-position="bottom"]');
  return !!x && x.getAnimations({ subtree: true }).every((a) => a.id === 'rf-countdown' || a.playState !== 'running');
}, null, { timeout: 6000 }).catch(() => {});

section('Two at most, long enough to read');
await ev(() => { const U = window.GH.ui; U.toast('Saved', 'positive'); setTimeout(() => U.toast('Removed from today', 'neutral', 'Bent-over row', { label: 'Undo' }), 250); setTimeout(() => U.toast('Couldn\'t read Health Connect', 'caution', 'It took too long. Try again.'), 500); });
await wait(1400);
let t = await toasts();
check('three in a row leave two up, the newest', t.length === 2 && t[0].title === 'Removed from today' && t[1].title === 'Couldn\'t read Health Connect', t.map((x) => x.title));
check('a tidy stack: the same width, one over the other', t.length === 2 && Math.abs(t[0].width - t[1].width) <= 1 && Math.abs(t[0].left - t[1].left) <= 1 && t[0].bottom <= t[1].top + 1, t);
check('long enough to read: 6 s with a button, about 5 for a sentence', t.length === 2 && t[0].ms >= 6000 && t[1].ms >= 4800 && t[1].ms <= 9000, t.map((x) => x.ms));
await clear();
await ev(() => { const U = window.GH.ui; U.toast('Saved', 'positive'); setTimeout(() => U.toast('Saved', 'positive'), 300); });
await wait(1200);
t = await toasts();
check('the same words twice: one toast', t.length === 1 && t[0].title === 'Saved' && t[0].ms >= 4000, t);
await clear();
await ev(() => window.GH.ui.toast('A rather long note about what just happened to your plan', 'neutral', 'It moves the rest of this week along by a day, and next week starts as it was planned before.'));
await wait(900);
t = await toasts();
check('a long one stays up to 9 s, no longer', t.length === 1 && t[0].ms === 9000, t.map((x) => x.ms));
check('thick glass: the page\'s words don\'t read through (about 93% of its fill)', t.length === 1 && t[0].alpha >= 0.9, t.map((x) => x.alpha));
await clear();

section('Clear of a sheet\'s buttons and of a field being typed in');
// A sheet with its main button at the end, and one in the middle of the screen.
const btnSheet = (after) => ev((a) => window.GH.ui.sheet({ title: 'Toasts', size: 'fit', body: `<div class="sheet-pad"><p class="t-body">Something to save.</p><div style="height:${a}px"></div><button type="button" class="rf-btn" data-variant="filled" data-size="lg" id="tMain">Save</button></div>` }), after);
for (const after of [40, 260]) {
  await btnSheet(after);
  await wait(900);
  await ev(() => window.GH.ui.toast('Saved', 'positive', 'Your plan updates from next week.'));
  await wait(700);
  await toastStill();
  t = await toasts();
  const btn = await ev(() => { const r = document.getElementById('tMain').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  check(`over a sheet whose main button is ${after > 100 ? 'in the middle' : 'at the bottom'}: the toast stays clear of it, in the sheet's dialog`, t.length === 1 && !overlaps(t[0], btn) && t[0].inDialog, { t, btn });
  await clear();
}
// A field near the bottom of a sheet, typed in, with the keyboard up (the app's WebView shrinks).
await ev(() => window.GH.ui.sheet({ title: 'Your note', size: 'fit', body: '<div class="sheet-pad"><p class="t-body">Something above it.</p><div style="height:220px"></div><div class="rf-field"><div class="rf-field-control"><input class="rf-input" id="tField" aria-label="Note"></div></div><button type="button" class="rf-btn" data-variant="filled" data-size="lg" id="tMain">Save</button></div>' }));
await wait(900);
await page.focus('#tField');
await page.setViewportSize({ width, height: H - 320 });
await wait(900);
await ev(() => window.GH.ui.toast('Saved', 'positive', 'Your note is kept on this phone.'));
await wait(1200);
t = await toasts();
let field = await ev(() => { const a = document.activeElement, r = a.getBoundingClientRect(), b = document.getElementById('tMain').getBoundingClientRect(); return { id: a.id, top: r.top, bottom: r.bottom, btn: { top: b.top, bottom: b.bottom }, vh: innerHeight }; });
check('with the keyboard up: the toast covers neither the field being typed in nor the main button, and sits above the keyboard', t.length === 1 && field.id === 'tField' && !overlaps(t[0], field) && !overlaps(t[0], field.btn) && t[0].bottom <= field.vh, { t, field });
// Focus moves to a field lower down: the toast moves out of its way.
await ev(() => { document.getElementById('tField').blur(); });
await wait(600);
await page.setViewportSize({ width, height: H });
await clear();
await ev(() => window.GH.ui.sheet({ title: 'Two fields', size: 'fit', body: '<div class="sheet-pad"><div class="rf-field"><div class="rf-field-control"><input class="rf-input" id="tA" aria-label="First"></div></div><div style="height:300px"></div><div class="rf-field"><div class="rf-field-control"><input class="rf-input" id="tB" aria-label="Second"></div></div></div>' }));
await wait(900);
await page.focus('#tA');
await ev(() => window.GH.ui.toast('Saved', 'positive', 'Kept on this phone.'));
await wait(1000);
await page.focus('#tB');
await wait(900);
t = await toasts();
field = await ev(() => { const r = document.getElementById('tB').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
check('focus moving to a field lower down: the toast moves out of its way', t.length === 1 && !overlaps(t[0], field), { t, field });
await clear();

section('A page\'s toasts give way to a sheet');
await ev(() => window.GH.ui.toast('Copied your current plan', 'positive', 'The coach\'s plan stays as it is.'));
await wait(1100);
await ev(() => window.GH.ui.act.editName());
await wait(700);
t = await toasts();
check('a sheet opened over a toast sends it away', t.length === 0, t);
await clear();
await ev(() => { const U = window.GH.ui; U.toast('Saved', 'positive'); U.act.editName(); });
await wait(900);
t = await toasts();
check('one that came with the tap that opened the sheet stays, over it', t.length === 1 && t[0].inDialog, t);
await clear();

section('A new badge waits its turn');
const badgeUp = () => ev(() => [...document.querySelectorAll('.rf-toast:not([data-leaving]) .rf-toast-title')].some((x) => /new badge/i.test(x.textContent)));
// A sheet open: the badge's toast waits; closed, it shows on its own.
await ev(() => window.GH.ui.showPrivacySheet());
await wait(900);
const earned = await ev(() => { const before = Object.keys(window.GH.ui.S.achievements.earned).length; window.GH.ui.badgeEvent('tailored'); return Object.keys(window.GH.ui.S.achievements.earned).length - before; });
await wait(2200);
const during = await badgeUp();
await ev(() => window.GH.ui.closeSheets());
let after = false;
for (let i = 0; i < 12 && !after; i++) { await wait(400); after = await badgeUp(); }
check('a badge earned while a sheet is open: its toast waits, then shows once the sheet is closed', earned === 1 && !during && after, { earned, during, after });
await clear();
// Another toast up: it waits for that one to go.
await ev(() => { window.GH.ui.toast('Saved', 'positive'); window.GH.ui.badgeEvent('reviewed'); });
await wait(2000);
const waited = await ev(() => [...document.querySelectorAll('.rf-toast:not([data-leaving]) .rf-toast-title')].map((x) => x.textContent));
let shown = false;
for (let i = 0; i < 20 && !shown; i++) { await wait(400); shown = await badgeUp(); }
check('while another toast is up it waits, then shows on its own', waited.length === 1 && waited[0] === 'Saved' && shown, { waited, shown });
await clear();

section('In a workout, from one step to the next');
// The player's buttons change from step to step (a rest without the reps question has none): a
// toast up through a set, its rest and the next set stays clear of whatever buttons are there. (Its
// countdown is made a minute long so it's up the whole way; the taps are real ones, focus moving
// with them.)
await ev(() => {
  const U = window.GH.ui;
  U.act.startWorkout();
  const a = U.S.active, set = (st) => st.kind === 'set' && !st.item.timed && !st.leadOnly && st.rest;
  const i = a.steps.findIndex((st) => set(st) && !st.askRir);
  a.idx = i >= 0 ? i : a.steps.findIndex(set);
  U.openPlayer();
});
await wait(1800);
const plActs = () => ev(() => [...document.querySelectorAll('.player .pl-actions > *')].filter((b) => b.offsetHeight).map((b) => { const r = b.getBoundingClientRect(); return { act: b.dataset.act || b.className.split(' ')[0], top: r.top, bottom: r.bottom }; }));
await ev(() => {
  const t = window.GH.ui.toast('Swapped to hammer curl', 'neutral');
  const c = t && t.el && [...t.el.querySelectorAll('.rf-toast-close')].flatMap((b) => b.getAnimations()).find((a) => a.id === 'rf-countdown');
  if (c) c.effect.updateTiming({ duration: 60000 });
});
await wait(600);
await toastStill();
t = await toasts();
let acts = await plActs();
const clearOfAll = (list) => t.length === 1 && list.length > 0 && list.every((b) => !overlaps(t[0], b));
check('a set: the toast sits above Done set and the reps', clearOfAll(acts) && acts.some((b) => b.act === 'plDone'), { t, acts });
await page.click('.player [data-act="plDone"]');
await wait(900);
const rested = await ev(() => !!document.querySelector('.player .pl-rest'));
if (await page.locator('.player .pl-rir').count()) { await page.click('.player .pl-rir input[value="12"]', { force: true }); await wait(400); }
if (await page.locator('.player [data-act="plSkipRest"]').count()) await page.click('.player [data-act="plSkipRest"]');
await wait(500);
if (await page.locator('.player [data-act="plContinue"]').count()) await page.click('.player [data-act="plContinue"]');
await wait(600);
await toastStill();
t = await toasts();
acts = await plActs();
check('after its rest, the next step: the toast is above its buttons again', rested && clearOfAll(acts), { rested, t, acts });
await ev(() => { window.Refract.toast.dismissAll(); window.GH.ui.act.plMin(); });
await wait(600);

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
await server.close();
done();
