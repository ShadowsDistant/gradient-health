// Bottom sheets in Chromium at phone size, with someone five weeks in: where a sheet sits (anchored
// to the bottom edge, full width, square bottom corners, fit sheets as tall as their content), real
// touch drags on a CPU slowed 4x (a flick up, a slow drag, a flick down, and a scroll that hands over
// to the sheet), what a drag costs (no layout, no style work past the one transform a frame, frame
// times with the settle), how long opening, settling and closing take, sideways gestures, Back, Esc
// and the scrim, the keyboard, reduced motion, Refract staying out of it, the material (Refract's
// thick glass at medium, solid at large, while it moves, and with reduced transparency or increased
// contrast), and the food Edit sheet's width.
// Usage: node test/ui-sheet.mjs [--dark] [--width=390] [--cpu=4]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const cpu = Number((process.argv.find((a) => a.startsWith('--cpu=')) || '--cpu=4').split('=')[1]); // how much slower the drags' CPU is
const server = await serveDist();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(seedBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.evaluate(() => {
  const GH = window.GH, S = GH.store.load(), F = GH.food;
  F.setMode(S, 'full');
  F.add(S, GH.brain.dayOf(Date.now(), 4), { name: 'Oatmeal with milk', src: 'quick', portion: '1 bowl', kcal: 320, p: 14, c: 48, f: 8, meal: 'breakfast' }, Date.now());
  GH.store.save(S);
});
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
// The 3D figure warms up a few seconds after launch (heavy on the main thread); measure after it.
await page.waitForFunction(() => window.GH.figure3d, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
// Notes every move a sheet's panel plays (open, settle or close) and how long it runs.
await page.evaluate(() => {
  window.__moves = [];
  const seen = new WeakSet(), play = Element.prototype.animate;
  Element.prototype.animate = function (keys, o) {
    if (this.classList && this.classList.contains('gh-sheet-panel')) {
      const d = this.closest('dialog');
      window.__moves.push({ kind: d && d.hasAttribute('data-closing') ? 'close' : seen.has(this) ? 'settle' : 'open', ms: Math.round(typeof o === 'number' ? o : (o && o.duration) || 0) });
      seen.add(this);
    }
    return play.call(this, keys, o);
  };
});
const wait = (ms) => page.waitForTimeout(ms);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const throttle = (rate) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

// The top sheet: its size, detent, and where its panel is.
const sheet = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop();
  if (!d) return null;
  const p = d.querySelector('.gh-sheet-panel'), b = d.querySelector('.rf-sheet-body');
  const r = p.getBoundingClientRect(), cs = getComputedStyle(p);
  return { size: d.dataset.size, detent: d.dataset.detent, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), content: Math.round(b.offsetTop + b.scrollHeight), scroll: Math.round(b.scrollTop), vh: innerHeight, vw: innerWidth, radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius].join(' '), moving: d.hasAttribute('data-moving') };
});
const closeAll = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await wait(700); };
// Opens a sheet through the app and records what its onClose gets.
const open = async (expr) => {
  await page.evaluate((x) => { window.__closed = []; (0, eval)(x); }, expr); // eslint-disable-line no-eval
  await wait(900);
  return sheet();
};
const act = (name, arg) => `window.GH.ui.act.${name}({ dataset: { arg: ${JSON.stringify(arg == null ? '' : arg)} }, setAttribute() {}, removeAttribute() {}, closest: () => null })`;

// Touches, with their own timeline (8 ms apart), so a flick's speed doesn't depend on how fast the
// test machine delivers them.
let clock = 0;
const touch = (type, x, y, t) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }], timestamp: t });
// A straight drag from (x0, y0) to (x1, y1) over `ms`, optionally held still before letting go. It
// reports the frames drawn while the finger moved, and the layouts and style recalcs (and their time)
// meanwhile; with `settle` (ms), also every frame from the first touch until that long after letting
// go, so the settle is timed too.
async function swipe(x0, y0, x1, y1, ms, { hold = 0, settle = 0 } = {}) {
  clock = Math.max(clock + 0.2, Date.now() / 1000);
  let t = clock;
  await page.evaluate(() => { window.__fr = []; window.__frOn = true; let last = 0; const f = (ts) => { if (!window.__frOn) return; if (last) window.__fr.push(ts - last); last = ts; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const m0 = await metrics();
  await touch('touchStart', x0, y0, t);
  const n = Math.max(2, Math.round(ms / 8));
  for (let i = 1; i <= n; i++) { t += 0.008; await touch('touchMove', Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), t); }
  await wait(50); // the last move's frame
  const m1 = await metrics();
  const frames = await page.evaluate((keep) => { if (!keep) window.__frOn = false; return window.__fr.slice(); }, settle > 0);
  if (hold) { t += hold / 1000; await wait(hold); }
  await touch('touchEnd', x1, y1, t + 0.004);
  clock = t + 0.004;
  let all = frames;
  if (settle) { await wait(settle); all = await page.evaluate(() => { window.__frOn = false; return window.__fr; }); }
  return { frames, all, layout: m1.LayoutCount - m0.LayoutCount, style: m1.RecalcStyleCount - m0.RecalcStyleCount, styleMs: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 };
}
const drag = (x, y0, y1, ms, o) => swipe(x, y0, x, y1, ms, o);

section('Where a sheet sits');
let s = await open('window.GH.ui.showWhatsNew()');
check('an auto sheet opens at medium', s && s.size === 'auto' && s.detent === 'medium', s);
check('anchored to the bottom edge, with no gap under it', s && s.bottom >= s.vh - 1, s);
check(`full width at ${width} px`, s && s.left === Math.max(0, Math.round((s.vw - 640) / 2)) && s.width === Math.min(s.vw, 640), s);
check('28 px top corners, square bottom corners', s && s.radius === '28px 28px 0px 0px', s && s.radius);
check('medium shows the content up to 62% of the screen', s && Math.abs((s.vh - s.top) - Math.min(s.content, Math.round(s.vh * 0.62))) <= 2, s);
const inner = await page.evaluate(() => { const d = document.querySelector('dialog.gh-sheet[open]'); const a = document.activeElement; return { managed: d.hasAttribute('data-rf-managed'), glass: d.classList.contains('rf-glass'), backdrop: getComputedStyle(d, '::backdrop').backgroundColor, focus: a && a.className, grabber: !!(a && a.matches('.rf-sheet-grabber')), scrim: !!d.querySelector(':scope > .gh-sheet-scrim') }; });
check('opening focuses the content, never the grabber', /rf-sheet-body/.test(inner.focus || '') && !inner.grabber, inner);
check('Refract doesn\'t manage it, and it isn\'t glass', inner.managed && !inner.glass, inner);
check('its own scrim; the backdrop is see-through', inner.scrim && /rgba\(0, 0, 0, 0\)|transparent/.test(inner.backdrop), inner);
{
  // The material: a layer of Refract's thick glass under the content. At medium it's glass (a blur,
  // and Refract's rim that catches the light); at large, while the sheet moves, and with reduced
  // transparency or increased contrast, it's solid (no blur, no rim).
  const mat = () => page.evaluate(() => {
    const d = document.querySelector('dialog.gh-sheet[open]'), g = d && d.querySelector('.gh-sheet-panel > .gh-sheet-glass');
    if (!g) return null;
    const cs = getComputedStyle(g), rim = getComputedStyle(g, '::before');
    const lit = rim.display !== 'none' && rim.visibility !== 'hidden';
    const solid = cs.backdropFilter === 'none' && !lit;
    return { thick: g.matches('.rf-glass[data-variant="thick"]'), hidden: g.getAttribute('aria-hidden') === 'true', under: cs.zIndex === '-1' && cs.pointerEvents === 'none', blur: cs.backdropFilter, rim: lit, solid, opaque: /^rgb\(/.test(cs.backgroundColor), detent: d.dataset.detent };
  });
  const med = await mat();
  check('the material is Refract\'s thick glass, on a layer under the content, hidden from assistive tech', med && med.thick && med.hidden && med.under, med);
  check('at medium it\'s glass: frosted, with the lit rim', med && med.detent === 'medium' && /blur/.test(med.blur) && med.rim && !med.solid, med);
  await page.evaluate(() => document.querySelector('dialog.gh-sheet[open]').setAttribute('data-moving', ''));
  const moving = await mat();
  await page.evaluate(() => document.querySelector('dialog.gh-sheet[open]').removeAttribute('data-moving'));
  check('while it moves it\'s solid', moving && moving.solid && moving.opaque, moving);
  await page.evaluate(() => window.GH.ui.topSheet().detent('large'));
  await wait(700);
  const large = await mat();
  check('at large it\'s solid', large && large.detent === 'large' && large.solid && large.opaque, large);
  await page.evaluate(() => window.GH.ui.topSheet().detent('medium'));
  await wait(700);
  await page.evaluate(() => document.documentElement.setAttribute('data-rf-transparency', 'reduced'));
  const rt = await mat();
  await page.evaluate(() => document.documentElement.removeAttribute('data-rf-transparency'));
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate((dk) => document.documentElement.setAttribute('data-theme', dk ? 'dark-contrast' : 'light-contrast'), dark);
  const hc = await mat();
  await page.evaluate((t) => { if (t == null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, theme);
  check('with reduced transparency, and with increased contrast, it\'s solid at medium too', rt && rt.detent === 'medium' && !/blur/.test(rt.blur) && rt.opaque && hc && !/blur/.test(hc.blur) && hc.opaque, { rt, hc });
}
await page.dispatchEvent('dialog.gh-sheet[open] .rf-sheet-header', 'pointerdown', { pointerType: 'mouse', button: 0, clientX: 30, clientY: s.top + 30, isPrimary: true });
check('Refract\'s own drag doesn\'t run on it', await page.evaluate(() => !document.querySelector('dialog.gh-sheet[open]').hasAttribute('data-dragging')));
await page.dispatchEvent('dialog.gh-sheet[open] .rf-sheet-header', 'pointerup', { pointerType: 'mouse', button: 0 });
await closeAll();
s = await open(act('sciKey'));
check('a fit sheet is as tall as its content', s && s.size === 'fit' && Math.abs(s.height - s.content) <= 1, s);
check('and sits on the bottom edge', s && Math.abs(s.bottom - s.vh) <= 1, s);
await closeAll();
s = await open(act('editName'));
check('so does a one-field one', s && s.size === 'fit' && Math.abs(s.height - s.content) <= 1 && Math.abs(s.bottom - s.vh) <= 1, s);
await closeAll();

// The four drags on fresh sheets: a flick up, a slow drag, a flick down, and scroll then pull. Returns
// where each left the sheet, and what each cost.
async function fourDrags() {
  const r = { cost: [] };
  const measured = (name, x) => r.cost.push(Object.assign(x, { name }));
  await page.evaluate(() => { window.__det = []; window.__haptics.length = 0; if (!window.__detOn) { window.__detOn = true; document.addEventListener('rf-detent', (e) => window.__det.push(e.detail.detent)); } });
  let s = await open('window.GH.ui.showWhatsNew()');
  r.medTop = s.top;
  measured('flick up', await drag(200, s.top + 260, s.top + 150, 64, { settle: 600 })); // on the content
  await wait(500);
  s = r.up = await sheet();
  r.detents = await page.evaluate(() => window.__det.slice());
  r.haptics = await page.evaluate(() => window.__haptics.filter((k) => k === 'detent').length);
  // The header, slowly, most of the way down to medium, held still, then let go.
  measured('slow drag', await drag(200, s.top + 30, s.top + 30 + Math.round((r.medTop - s.top) * 0.7), 700, { hold: 150, settle: 600 }));
  await wait(500);
  s = r.slow = await sheet();
  measured('flick down', await drag(200, s.top + 120, s.top + 250, 64, { settle: 600 })); // from medium
  await wait(500);
  r.down = { sheet: await sheet(), top: await page.evaluate(() => !!window.GH.ui.topSheet()) };
  // A long sheet scrolled a little, then one pull down: the content scrolls back to its top and the
  // sheet takes over from there.
  s = await open('window.__closed = []; window.GH.ui.sheet({ title: "Privacy", size: "full", body: `<div class="sheet-pad">${window.GH.ui.privacyHtml()}</div>`, onClose: (v) => window.__closed.push(v) })');
  await drag(200, 700, 480, 300, { hold: 120 });
  await wait(700);
  r.scrolled = (await sheet()).scroll;
  await page.evaluate(() => { const d = document.querySelector('dialog.gh-sheet[open]'); const b = d.querySelector('.rf-sheet-body'); window.__handover = null; b.addEventListener('scroll', () => { if (b.scrollTop <= 0 && window.__handover == null) window.__handover = d.querySelector('.gh-sheet-panel').getBoundingClientRect().top; }); });
  measured('scroll then pull', await drag(200, 150, Math.min(s.vh - 20, 150 + r.scrolled + 420), 520, { settle: 600 }));
  await wait(500);
  r.pulled = await page.evaluate(() => ({ handover: window.__handover, closed: window.__closed.slice(), open: !!document.querySelector('dialog.gh-sheet[open]') }));
  await closeAll();
  return r;
}
const pct = (list, p) => { const a = list.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };
// A set of drags: every frame from first touch to settled (for frame times), and while fingers moved,
// the frames, layouts and style recalcs (and their time).
const stats = (cost) => {
  const all = cost.flatMap((c) => c.all), moving = cost.reduce((a, c) => a + c.frames.length, 0);
  return { frames: all.length, moving, layouts: cost.reduce((a, c) => a + c.layout, 0), styles: cost.reduce((a, c) => a + c.style, 0), styleMs: cost.reduce((a, c) => a + c.styleMs, 0), p50: pct(all, 0.5), p95: pct(all, 0.95) };
};

section(`Drags on a ${cpu}x slower CPU`);
await throttle(cpu);
const run1 = await fourDrags();
s = run1.up;
check('a flick up on the content opens it to large', s && s.detent === 'large', s);
check('large shows all of it, no empty sheet below', s && Math.abs((s.vh - s.top) - Math.min(s.content, s.height)) <= 2, s);
check('rf-detent tells the page', run1.detents.includes('large'), run1.detents);
check('with the detent haptic', run1.haptics >= 1, run1.haptics);
s = run1.slow;
check('a slow drag down, let go without a flick, settles at medium', s && s.detent === 'medium' && Math.abs(s.top - run1.medTop) <= 2, s);
check('a flick down from medium dismisses it', !run1.down.sheet && !run1.down.top, run1.down);
check('at large the content scrolls', run1.scrolled > 120, run1.scrolled);
check('scroll then pull: the content went back to its top first', run1.pulled.handover != null && run1.pulled.handover < 60, run1.pulled);
check('then the sheet followed and dismissed', !run1.pulled.open && run1.pulled.closed[0] === 'cancel', run1.pulled);

section(`What a drag costs (${cpu}x slower CPU)`);
// Frame times (first touch to settled) depend on the machine as well as the page (the tests may share
// it with other work), so a slow first set of drags is tried again, up to twice, and the best set
// counts. Layout and style work doesn't depend on the machine: every set must be clean.
const runs = [run1];
while (stats(runs[runs.length - 1].cost).p95 >= 20 && runs.length < 3) runs.push(await fourDrags());
await throttle(1);
const ms = (x) => x.toFixed(1);
runs.forEach((run, i) => {
  const set = runs.length > 1 ? `set ${i + 1}, ` : '';
  for (const c of run.cost) console.log(`      ${set}${c.name}: ${c.all.length} frames, p95 ${ms(pct(c.all, 0.95))} ms, ${c.all.filter((x) => x > 20).length} over 20 ms; while the finger moved ${c.frames.length} frames, ${c.layout} layouts, ${c.style} style recalcs (${ms(c.styleMs)} ms)`);
  const t = stats(run.cost);
  console.log(`      ${set}all: ${t.frames} frames, p50 ${ms(t.p50)} ms, p95 ${ms(t.p95)} ms; while fingers moved ${t.moving} frames, ${t.layouts} layouts, ${t.styles} style recalcs, ${(t.styleMs / Math.max(1, t.moving)).toFixed(3)} ms of style work a frame`);
});
const sets = runs.map((run) => stats(run.cost));
check('no layout while dragging', sets.every((t) => t.layouts === 0), sets.map((t) => t.layouts));
// Writing the panel's transform is itself one recalc of that element a frame (so is a running
// animation): anything past that, in number or in time, would be work the drag caused.
check('no style work past the one transform a frame', sets.every((t) => t.styles <= t.moving + 8), sets.map((t) => `${t.styles}/${t.moving}`));
const best = Math.min(...sets.map((t) => t.p95));
check('frame time p95 under 20 ms, settles included', best < 20, sets.map((t) => ms(t.p95)).join(', '));
// And that recalc touches only what the drag writes to (the panel and the scrim), never the content
// or the page: a trace of one drag, frame by frame (the frame a move starts in also switches the
// material and pauses animations, a few elements more).
s = await open('window.GH.ui.showWhatsNew()');
await page.evaluate(() => window.GH.ui.topSheet().detent('large'));
await wait(700);
s = await sheet();
await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
await drag(200, s.top + 30, s.top + 330, 480);
const traced = JSON.parse((await browser.stopTracing()).toString());
await wait(700);
await closeAll();
const restyles = (() => {
  const evs = traced.traceEvents || traced, by = {};
  for (const e of evs) if (e.name === 'UpdateLayoutTree' && e.ph === 'X') (by[`${e.pid}:${e.tid}`] = by[`${e.pid}:${e.tid}`] || []).push(e);
  const main = Object.values(by).sort((a, b) => b.length - a.length)[0] || [];
  return main.sort((a, b) => a.ts - b.ts).map((e) => (e.args && e.args.elementCount) || 0);
})();
console.log(`      a traced drag: ${restyles.length} style recalcs, restyling ${Math.min(...restyles)} to ${Math.max(...restyles)} elements each`);
check('each frame restyles only the panel and the scrim (8 elements at most, 16 as the move starts)', restyles.length > 10 && restyles.every((n) => n <= 16) && restyles.filter((n) => n > 8).length <= 2, restyles.join(' '));

section('Quick, never sluggish');
// Every open, settle and close the sheets played so far (drags included), by how long it ran.
const played = await page.evaluate(() => window.__moves.slice());
const span = (k) => { const d = played.filter((x) => x.kind === k).map((x) => x.ms); return d.length ? `${Math.min(...d)} to ${Math.max(...d)} ms (${d.length})` : 'none'; };
console.log(`      opens ${span('open')}, settles ${span('settle')}, closes ${span('close')}`);
check('opening, settling and closing each take 400 ms or less', played.length > 8 && played.every((x) => x.ms <= 400), played.filter((x) => x.ms > 400));

section('Sideways gestures stay put');
s = await open(act('daysSheet'));
const slider = await page.evaluate(() => { const r = document.querySelector('dialog.gh-sheet[open] #dsMin').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) }; });
await swipe(slider.x, slider.y, slider.x + 120, slider.y + 4, 240); // along the slider
await wait(700);
const s2 = await sheet();
check('dragging along a slider doesn\'t move the sheet', s2 && s2.top === s.top && s2.detent === s.detent, { before: s, after: s2 });
await drag(slider.x, slider.y, slider.y + 160, 300);
await wait(700);
const s3 = await sheet();
check('nor does a drag that starts on the slider', s3 && s3.top === s.top, { before: s, after: s3 });
const chips = await page.evaluate(() => { const r = document.querySelector('dialog.gh-sheet[open] .ob-chips').getBoundingClientRect(); return { x: Math.round(r.left + 10), y: Math.round(r.top + 18) }; });
await swipe(chips.x, chips.y, chips.x + 200, chips.y + 12, 200);
await wait(700);
const s4 = await sheet();
check('a sideways swipe across the content leaves it where it is', s4 && s4.top === s.top, { before: s, after: s4 });
await closeAll();

section('Back, Esc and the scrim');
await open('window.__closed = []; window.GH.ui.sheet({ title: "Test", size: "auto", body: "<p class=\\"sheet-pad\\">Hello</p>", onClose: (v) => window.__closed.push(v) })');
const back = await page.evaluate(() => new Promise((res) => {
  const d = document.querySelector('dialog.gh-sheet[open]'), p = d.querySelector('.gh-sheet-panel');
  const top0 = p.getBoundingClientRect().top;
  window.__gh.back();
  requestAnimationFrame(() => requestAnimationFrame(() => res({ closed: !d.open, shown: getComputedStyle(d).display !== 'none', sliding: p.getAnimations().some((a) => a.playState === 'running'), top0, top1: p.getBoundingClientRect().top, onClose: window.__closed.slice() })));
}));
check('Back closes the top sheet at once (the page is usable)', back.closed, back);
check('while it slides out', back.shown && back.sliding && back.top1 >= back.top0, back);
await wait(800);
check('then it\'s gone and onClose heard cancel', await page.evaluate(() => !document.querySelector('dialog.gh-sheet') && window.__closed[0] === 'cancel'));
await open('window.__closed = []; window.GH.ui.sheet({ title: "Test", size: "fit", body: "<p class=\\"sheet-pad\\">Hello</p>", onClose: (v) => window.__closed.push(v) })');
await page.keyboard.press('Escape');
const esc = await page.evaluate(() => { const d = document.querySelector('dialog.gh-sheet'); return { closed: d && !d.open, sliding: !!d && d.querySelector('.gh-sheet-panel').getAnimations().length > 0 }; });
await wait(800);
check('Esc slides it out too', esc.closed && esc.sliding && await page.evaluate(() => window.__closed[0] === 'cancel'), esc);
s = await open('window.__closed = []; window.GH.ui.sheet({ title: "Test", size: "fit", body: "<p class=\\"sheet-pad\\">Hello</p>", onClose: (v) => window.__closed.push(v) })');
await page.touchscreen.tap(30, Math.round(s.top / 2));
await wait(800);
check('a tap on the scrim closes it', await page.evaluate(() => !document.querySelector('dialog.gh-sheet[open]') && window.__closed[0] === 'cancel'));
await open('window.__closed = []; window.GH.ui.sheet({ title: "Test", size: "fit", body: "<p class=\\"sheet-pad\\">Hello</p>", onClose: (v) => window.__closed.push(v) })');
await page.click('dialog.gh-sheet[open] [data-sheet-close]');
await wait(800);
check('so does the close button', await page.evaluate(() => !document.querySelector('dialog.gh-sheet[open]') && window.__closed[0] === 'cancel'));
await open('window.__closed = []; window.GH.ui.sheet({ title: "Test", size: "fit", body: "<p class=\\"sheet-pad\\">Hello</p>", onClose: (v) => window.__closed.push(v) }).close("ok")');
check('close(value) reaches onClose as the returnValue', await page.evaluate(() => window.__closed[0] === 'ok'));
// Two sheets: the top one closes, the one under it stays.
await page.evaluate(() => { window.GH.ui.showPrivacySheet(); window.GH.ui.sheet({ title: 'On top', size: 'fit', body: '<p class="sheet-pad">Hi</p>' }); });
await wait(900);
await page.evaluate(() => window.__gh.back());
await wait(800);
const stack = await page.evaluate(() => ({ open: document.querySelectorAll('dialog.gh-sheet[open]').length, top: window.GH.ui.topSheet() && window.GH.ui.topSheet().el.querySelector('.rf-sheet-title').textContent, receded: document.getElementById('app').hasAttribute('data-receded') }));
check('with two open, Back closes the top one only', stack.open === 1 && stack.top === 'Privacy', stack);
check('and a full sheet under it keeps the page set back', stack.receded, stack);
await closeAll();
check('closing it brings the page forward', await page.evaluate(() => !document.getElementById('app').hasAttribute('data-receded') && !document.getElementById('app').hasAttribute('data-sheeted')));

section('The keyboard');
await page.evaluate(() => window.GH.ui.go('food'));
await wait(500);
s = await open(act('foodCreate'));
check('the food Create sheet opens at medium', s && s.detent === 'medium', s);
await page.focus('#cName');
await wait(900);
s = await sheet();
check('focusing a text field expands it to large', s && s.detent === 'large', s);
// The Android app's WebView shrinks above the keyboard.
await page.focus('#cFib');
await page.setViewportSize({ width, height: 844 - 330 });
await wait(1000);
const kb = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const p = document.querySelector('dialog.gh-sheet[open] .gh-sheet-panel').getBoundingClientRect(); return { field: Math.round(r.bottom), fieldTop: Math.round(r.top), vh: innerHeight, panelBottom: Math.round(p.bottom), id: document.activeElement.id }; });
check('with the keyboard up, the sheet sits above it', Math.abs(kb.panelBottom - kb.vh) <= 1, kb);
check('and the field being typed in stays in sight', kb.field <= kb.vh && kb.fieldTop >= 0, kb);
await page.setViewportSize({ width, height: 844 });
await closeAll();

section('The food Edit sheet');
await page.evaluate(() => { const b = document.querySelector('#screen [data-act="foodEdit"]'); if (b) b.click(); });
await wait(1000);
const edit = await page.evaluate(() => {
  const d = document.querySelector('dialog.gh-sheet[open]');
  if (!d) return null;
  const p = d.querySelector('.gh-sheet-panel').getBoundingClientRect();
  const over = [...d.querySelectorAll('.gh-sheet-panel *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > p.right + 0.5 || r.left < p.left - 0.5); }).map((e) => `${e.tagName}.${e.className}#${e.id}`);
  const seg = d.querySelector('.rf-segmented').getBoundingClientRect(), name = d.querySelector('#qName').closest('.rf-field').getBoundingClientRect();
  const carbs = d.querySelector('#qC').closest('.rf-field-control').getBoundingClientRect();
  return { title: d.querySelector('.rf-sheet-title').textContent, over, seg: Math.round(seg.width), name: Math.round(name.width), carbsRight: Math.round(carbs.right), padRight: Math.round(d.querySelector('.sheet-pad').getBoundingClientRect().right - 16), scrollW: d.querySelector('.rf-sheet-body').scrollWidth - d.querySelector('.rf-sheet-body').clientWidth };
});
check('it opens', edit && edit.title === 'Edit', edit);
check('nothing in it runs past the edge', edit && edit.over.length === 0 && edit.scrollW <= 0, edit);
check('the Carbs field ends at the content edge', edit && Math.abs(edit.carbsRight - edit.padRight) <= 1, edit);
check('the meal control is full width', edit && Math.abs(edit.seg - edit.name) <= 1, edit);
await closeAll();

section('Reduced motion');
await page.evaluate(() => window.Refract.setMotion('reduced'));
await page.evaluate(() => { window.GH.ui.showWhatsNew(); });
const rm = await page.evaluate(() => { const p = document.querySelector('dialog.gh-sheet[open] .gh-sheet-panel'); return p.getAnimations().map((a) => Object.keys(a.effect.getKeyframes()[0]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)).join()); });
check('it fades in instead of sliding', rm.length > 0 && rm.every((k) => k === 'opacity'), rm);
await wait(600);
check('and the page isn\'t set back', await page.evaluate(() => !document.getElementById('app').hasAttribute('data-receded')));
await closeAll();
await page.evaluate(() => window.Refract.setMotion('system'));

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
await server.close();
done();
