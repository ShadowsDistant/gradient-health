// Haptics in the app, in Chromium at phone size with real touches (CDP), read from the fixture's
// Android bridge (what the phone would play) and from U.haptic (what the UI asked for):
// - the haptics controls play by themselves: data-haptic on an action; sheets (nav as one opens from
//   a tap, back as the person closes it with the close button, the scrim, a swipe down, Esc or Back,
//   and quiet when the app opens or closes one itself); a stepper's steps, held down too, with an edge
//   at its end; a slider's steps and its edges; toggle chips; a dialog's destructive OK and its
//   cancel; the tab bar's lens passing tabs; and, once the You tab work is in, tab, nav and back;
// - a toast's haptic after an action leaves the action its feel;
// - deferred change dispatch: with a 60 ms handler, a segmented control's thumb (and a switch's knob)
//   is on its way by the first frame after the tap, and the handler runs after it; data-sync runs
//   it at once instead;
// - the Settings rows (U.hapticRows) and the Feel each one gallery.
// Usage: node test/ui-haptics.mjs [--dark]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const server = await serveDist();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
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
// The 3D figure warms up a few seconds after launch (heavy on the main thread); start after it.
await page.waitForFunction(() => window.GH.figure3d, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);
const wait = (ms) => page.waitForTimeout(ms);
await page.evaluate(() => {
  // What the UI asks for (U.haptic) next to what the bridge plays (window.__haptics).
  window.__req = [];
  const U = window.GH.ui, h = U.haptic;
  U.haptic = (k, o) => { window.__req.push(k); return h(k, o); };
  window.__strengths = [];
  const b = window.AndroidBridge, hs = b.hapticStrength;
  b.hapticStrength = (v) => { window.__strengths.push(v); return hs(v); };
  // Test actions: a sheet to open from a tap (or quietly), and handlers that note when they ran.
  window.__acted = 0;
  U.act.__hxNoop = () => { window.__acted++; };
  U.act.__hxOpen = () => U.sheet({ title: 'A sheet', size: 'auto', body: '<div class="sheet-pad"><p>Something to read.</p><button type="button" class="rf-btn" id="hxDone" data-act="__hxDoneAct">Done</button></div>' });
  U.act.__hxOpenQuiet = () => U.sheet({ title: 'A quiet sheet', size: 'auto', quiet: true, body: '<div class="sheet-pad"><p>Opened without a buzz.</p></div>' });
  U.act.__hxDoneAct = () => { const t = U.topSheet(); if (t) t.close('ok'); };
  U.act.__hxPage = () => U.open('settings');
  U.on.__hxVal = () => {};
  U.on.__hxChip = () => {};
  // A button of the test's own, over the page (re-renders never touch it).
  const add = (id, act, top, label) => {
    const el = document.createElement('button');
    el.type = 'button'; el.id = id; el.className = 'rf-btn'; el.setAttribute('data-act', act); el.textContent = label;
    el.style.cssText = `position:fixed;left:24px;top:${top}px;z-index:30`;
    document.body.appendChild(el);
  };
  add('hxOpenBtn', '__hxOpen', 300, 'Open');
  add('hxQuietBtn', '__hxOpenQuiet', 360, 'Quiet');
  add('hxPageBtn', '__hxPage', 420, 'Page');
});
const cdp = await ctx.newCDPSession(page);
let clock = 0;
const touch = (type, x, y, t) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }], timestamp: t });
async function gesture(path, { hold = 40, stepMs = 16 } = {}) {
  clock = Math.max(clock + 0.05, Date.now() / 1000);
  let t = clock;
  await touch('touchStart', path[0][0], path[0][1], t);
  for (const [x, y] of path.slice(1)) { t += stepMs / 1000; await touch('touchMove', x, y, t); }
  t += hold / 1000;
  if (hold) await wait(hold);
  const [x, y] = path[path.length - 1];
  await touch('touchEnd', x, y, t);
  clock = t;
}
const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const centre = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right }; }, sel);
const tap = async (sel) => { const c = await centre(sel); if (!c) throw new Error(`nothing at ${sel}`); await gesture([[c.x, c.y]], { hold: 30 }); };
const clear = () => page.evaluate(() => { window.__req.length = 0; window.__haptics.length = 0; });
const log = () => page.evaluate(() => ({ req: window.__req.slice(), bridge: window.__haptics.slice() }));
const sheets = () => page.evaluate(() => document.querySelectorAll('dialog.gh-sheet[open]:not([data-closing])').length);
const closeAll = async () => { await page.evaluate(() => window.GH.ui.closeSheets()); await wait(600); };
// Waits out the second after a touch in which a sheet the app opens counts as opened from it.
const idle = () => wait(1100);

/* ---------------------------------------------------------------- data-haptic */
section('data-haptic on an action');
await page.evaluate(() => window.GH.ui.sheet({ title: 'Buttons', size: 'auto', quiet: true, body: '<div class="sheet-pad"><button type="button" class="rf-btn" id="hxA" data-act="__hxNoop" data-haptic="levelUp">Level up</button><button type="button" class="rf-btn" id="hxB" data-act="__hxNoop" data-haptic="levelUp" disabled>Off</button><button type="button" class="rf-btn" id="hxC" data-act="__hxNoop">Plain</button></div>' }));
await wait(700);
await clear();
await tap('#hxA');
await wait(300);
let l = await log();
check('it plays that kind on the click, and the action runs', l.bridge.join() === 'levelUp' && (await page.evaluate(() => window.__acted)) === 1, l);
await clear();
await tap('#hxB');
await tap('#hxC');
await wait(300);
l = await log();
check('a disabled one plays nothing, and an action without it plays nothing of itself', !l.bridge.length && (await page.evaluate(() => window.__acted)) === 2, l);
await closeAll();

/* ---------------------------------------------------------------- sheets */
section('Sheets');
await idle();
await clear();
await tap('#hxOpenBtn');
await wait(700);
l = await log();
check('opened from a tap: nav', (await sheets()) === 1 && l.bridge.join() === 'nav', l);
const closers = [
  ['the close button', async () => tap('dialog[open] [data-sheet-close]')],
  ['a tap on the scrim', async () => { await gesture([[195, 60]], { hold: 30 }); }],
  ['a swipe down', async () => { const c = await centre('dialog[open] .rf-sheet-header'); await gesture(line(c.x, c.y, c.x, c.y + 260, 6), { hold: 0, stepMs: 12 }); }],
  ['Esc', async () => { await page.keyboard.press('Escape'); }],
  ['Back', async () => { await page.evaluate(() => window.__gh.back()); }],
];
for (const [name, close] of closers) {
  if (!(await sheets())) { await tap('#hxOpenBtn'); await wait(700); }
  await clear();
  await close();
  await wait(700);
  l = await log();
  check(`closed with ${name}: back`, !(await sheets()) && l.bridge.join() === 'back', l);
}
await tap('#hxOpenBtn');
await wait(700);
await clear();
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(600);
l = await log();
check('closed by the app on its way somewhere (U.closeSheets): nothing', !l.req.length && !l.bridge.length, l);
await tap('#hxOpenBtn');
await wait(700);
await clear();
await tap('#hxDone');
await wait(700);
l = await log();
check('closed by an action\'s own close(\'ok\'): nothing from the sheet', !(await sheets()) && !l.bridge.length, l);
await idle();
await clear();
await page.evaluate(() => window.GH.ui.act.__hxOpen());
await wait(700);
l = await log();
check('opened by the app itself, with no touch just before: quiet', (await sheets()) === 1 && !l.bridge.length, l);
await closeAll();
await clear();
await tap('#hxQuietBtn');
await wait(700);
l = await log();
check('opened with quiet: no nav even from a tap', (await sheets()) === 1 && !l.bridge.length, l);
await closeAll();

/* ---------------------------------------------------------------- steppers, sliders, toggle chips */
section('Steppers, sliders and toggle chips');
await page.evaluate(() => {
  const U = window.GH.ui;
  U.sheet({
    title: 'Controls', size: 'full', quiet: true,
    body: `<div class="sheet-pad">
      <div class="ob-center">${U.stepper('hxHold', 6, 0, 10, 'Held', 'data-on="__hxVal"')}</div>
      <div class="ob-center">${U.stepper('hxEdge', 5, 2, 6, 'Edge', 'data-on="__hxVal"')}</div>
      <div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" id="hxSlider" type="range" min="10" max="60" step="5" value="35" aria-label="Minutes" data-on="__hxVal"></div></div>
      <div class="ob-chips">${U.chip('Monday', false, 'id="hxChip" data-on="__hxChip"')}</div>
    </div>`,
  });
});
await wait(900);
const stepBtn = (id, dir) => `dialog[open] .rf-stepper:has(#${id}) .rf-stepper-btn[data-step="${dir}"]`;
const steps = (r) => r.filter((k) => k === 'tick' || k === 'edge');
await clear();
await tap(stepBtn('hxEdge', '1'));
await wait(250);
await tap(stepBtn('hxEdge', '-1'));
await wait(250);
l = await log();
check('a step to the end is an edge, a step back a tick', steps(l.req).join() === 'edge,tick' && steps(l.bridge).join() === 'edge,tick' && (await page.evaluate(() => document.getElementById('hxEdge').value)) === '5', l);
await clear();
await tap(stepBtn('hxEdge', '-1'));
await tap(stepBtn('hxEdge', '-1'));
await tap(stepBtn('hxEdge', '-1'));
await wait(250);
l = await log();
check('down to the lower end the same way: tick, tick, edge', steps(l.req).join() === 'tick,tick,edge', l);
// Held down: Refract repeats the step on a timer (no clicks), faster and faster, up to the end.
{
  const c = await centre(stepBtn('hxHold', '1'));
  await clear();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await wait(1900);
  await page.mouse.up();
  await wait(300);
  l = await log();
  const v = await page.evaluate(() => document.getElementById('hxHold').value);
  check('held down, it ticks with every step and ends on an edge at 10', v === '10' && steps(l.req).join() === 'tick,tick,tick,edge' && steps(l.bridge).join() === 'tick,tick,tick,edge', { v, ...l });
}
await clear();
await page.focus('#hxEdge');
await page.keyboard.press('Control+A');
await page.keyboard.type('4');
await wait(200);
l = await log();
check('typing a number into a stepper doesn\'t tick (the keyboard has its own feel)', !steps(l.req).length, l);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
// A slider: a tick per step it passes, an edge at either end.
{
  const s = await centre('#hxSlider');
  await clear();
  // From its value (35) to past the right end.
  const x0 = s.left + (s.right - s.left) * 0.5;
  await gesture(line(x0, s.y, s.right + 30, s.y, 14), { hold: 60, stepMs: 30 });
  await wait(300);
  l = await log();
  const v = await page.evaluate(() => document.getElementById('hxSlider').value);
  const st = steps(l.req);
  check('dragged to the right end: ticks on the way, then an edge', v === '60' && st.length >= 3 && st[st.length - 1] === 'edge' && st.slice(0, -1).every((k) => k === 'tick') && l.bridge.includes('edge'), { v, ...l });
  await page.focus('#hxSlider');
  await clear();
  await page.keyboard.press('Home');
  await wait(120);
  await page.keyboard.press('ArrowRight');
  await wait(120);
  l = await log();
  check('and the keys: Home is an edge at the left end, a step from it a tick', steps(l.req).join() === 'edge,tick' && steps(l.bridge).join() === 'edge,tick', l);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}
await clear();
await tap('#hxChip');
await wait(250);
await tap('#hxChip');
await wait(250);
l = await log();
check('a toggle chip: toggleOn as it turns on, toggleOff as it turns off', l.req.join() === 'toggleOn,toggleOff' && l.bridge.join() === 'toggleOn,toggleOff', l);
await closeAll();

/* ---------------------------------------------------------------- dialogs */
section('Dialogs');
const dialog = async (tone, answer) => {
  await clear();
  await page.evaluate((t) => { window.__answer = null; window.GH.ui.confirm('Delete this?', 'It can\'t be brought back.', 'Delete', t).then((v) => { window.__answer = v; }); }, tone);
  await wait(400);
  const opened = await log();
  if (answer === 'Escape') await page.keyboard.press('Escape');
  else await page.click(`dialog.rf-dialog[open] button[value="${answer}"]`);
  await wait(400);
  return { opened, after: await log(), answer: await page.evaluate(() => window.__answer) };
};
let d = await dialog('critical', 'ok');
check('a destructive one: nothing as it opens, heavy on its OK', !d.opened.req.length && d.after.bridge.join() === 'heavy' && d.answer === true, d);
d = await dialog('critical', 'cancel');
check('its Cancel: back', d.after.bridge.join() === 'back' && d.answer === false, d);
d = await dialog('critical', 'Escape');
check('Esc: back', d.after.bridge.join() === 'back' && d.answer === false, d);
d = await dialog(undefined, 'ok');
check('an everyday OK leaves it to what it does', !d.after.bridge.length && d.answer === true, d);

/* ---------------------------------------------------------------- toasts */
section('A toast after an action');
const toastRun = async (fn) => { await clear(); await page.evaluate(fn); await wait(400); return log(); };
l = await toastRun(() => { window.GH.ui.haptic('toggleOn'); window.GH.ui.toast('Saved', 'positive'); });
check('a toggle then its toast\'s success: the toggle keeps its feel', l.bridge.join() === 'toggleOn', l);
await wait(300);
l = await toastRun(() => { window.GH.ui.haptic('toggleOn'); window.GH.ui.toast('Careful', 'caution'); });
check('a toggle then a warning: the toggle, then the warning once it\'s over', l.bridge.join() === 'toggleOn,warning', l);
await wait(300);
l = await toastRun(() => window.GH.ui.toast('Saved', 'positive'));
check('a toast on its own plays its success', l.bridge.join() === 'success', l);
await page.evaluate(() => { for (const t of document.querySelectorAll('.rf-toast')) t.remove(); });

/* ---------------------------------------------------------------- the tab bar and pages */
section('The tab bar and pages');
await page.evaluate(() => window.GH.ui.go('today'));
await wait(600);
{
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => { const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: t.dataset.tab }; }));
  await clear();
  await gesture(line(tabs[0].x, tabs[0].y, tabs[2].x, tabs[2].y + 2, 14), { hold: 40, stepMs: 20 });
  await wait(700);
  l = await log();
  const route = await page.evaluate(() => window.GH.ui.route.tab);
  check('dragging the lens across two tabs ticks as it passes each', l.req.filter((k) => k === 'tick').length === 2 && l.bridge.includes('tick') && route === tabs[2].id, { ...l, route });
  await page.evaluate(() => window.GH.ui.go('today'));
  await wait(600);
  // Tabs, pages and Back play tab, nav and back from the You tab work's go(), U.open and U.back.
  if (await page.evaluate(() => window.GH.ui.hasTab('you'))) {
    await clear();
    await gesture([[tabs[1].x, tabs[1].y]], { hold: 30 });
    await wait(600);
    l = await log();
    check('a tab: tab', l.bridge.includes('tab') && !l.bridge.includes('select'), l);
    await clear();
    await tap('#hxPageBtn');
    await wait(700);
    l = await log();
    check('a page opening: nav', l.bridge.includes('nav'), l);
    await clear();
    await page.evaluate(() => window.__gh.back());
    await wait(700);
    l = await log();
    check('Back from it: back', l.bridge.includes('back') && !(await page.evaluate(() => window.GH.ui.route.view)), l);
    await page.evaluate(() => window.GH.ui.go('today'));
    await wait(500);
  } else console.log('  (tab, nav and back for tabs and pages: waiting for the You tab work, which plays them in go, U.open and U.back)');
}

/* ---------------------------------------------------------------- deferred dispatch */
section('A change\'s handler runs after the next frame');
await page.evaluate(() => {
  const U = window.GH.ui;
  // A handler that holds the main thread for 60 ms, like a heavy re-render.
  U.on.__hxSlow = () => { const t = performance.now(); window.__ran = t; while (performance.now() - t < 60) { /* busy */ } };
  const opts = [['a', 'One'], ['b', 'Two'], ['c', 'Three']];
  U.sheet({
    title: 'Slow handlers', size: 'full', quiet: true,
    body: `<div class="sheet-pad">${U.seg('hxSlow', opts, 'a', 'Slow', ' id="hxSeg" data-on="__hxSlow"')}${U.seg('hxSync', opts, 'a', 'Sync', ' id="hxSegSync" data-on="__hxSlow" data-sync')}<ul class="rf-list">${U.sw('Slow switch', false, 'id="hxSw" data-on="__hxSlow"')}</ul></div>`,
  });
  // Notes each frame after the next tap's click: when it came and where the thumb or knob was.
  window.__probe = (rootSel, partSel) => {
    const root = document.querySelector(rootSel), part = root.querySelector(partSel);
    const x0 = part.getBoundingClientRect().x;
    const out = { click: 0, frames: [], x0 };
    window.__ran = 0;
    root.addEventListener('click', () => { if (!out.click) out.click = performance.now(); }, { capture: true });
    const loop = () => {
      if (out.click) {
        // On its way: a transition running, or Refract's liquid engine moving it (it marks the control
        // data-traveling when the move starts, and drives the part frame by frame).
        const moving = part.getAnimations().some((a) => a.transitionProperty === 'translate' || a.transitionProperty === 'transform') || !!part.closest('[data-traveling]');
        out.frames.push({ t: performance.now(), x: part.getBoundingClientRect().x, moving, ran: window.__ran });
      }
      if (out.frames.length < 10) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__probeOut = out;
  };
});
await wait(900);
const probe = async (rootSel, partSel, tapSel) => {
  await page.evaluate(([r, p]) => window.__probe(r, p), [rootSel, partSel]);
  await clear();
  await tap(tapSel);
  await wait(700);
  const o = await page.evaluate(() => window.__probeOut);
  const f = o.frames[0] || {};
  const reqs = await page.evaluate(() => window.__req.slice());
  // first: ms from the click to the first frame; moving: the thumb's transition running in it; moved:
  // the thumb has left where it was within the frames noted; ranBeforeFrame: the handler had run by it.
  return { first: f.t ? Math.round(f.t - o.click) : null, moving: !!f.moving, moved: o.frames.some((x) => Math.abs(x.x - o.x0) > 2), ranBeforeFrame: !!f.ran, reqs, frames: o.frames.map((x) => [Math.round(x.t - o.click), Math.round(x.x), x.moving, !!x.ran]) };
};
// The thumb is on its way as soon as the pick lands.
let p = await probe('#hxSeg', '.rf-segmented-thumb', '#hxSeg .rf-segment:nth-of-type(2)');
check('a segment with a 60 ms handler: the first frame comes within a frame of the tap, with the thumb on its way', p.first != null && p.first < 40 && p.moving && p.moved, p);
check('the select played at once, and the handler ran only after that frame', p.reqs[0] === 'select' && !p.ranBeforeFrame && (await page.evaluate(() => window.__ran)) > 0, p);
p = await probe('.rf-switch:has(#hxSw)', '.rf-switch-thumb', '#hxSw');
check('a switch the same: its knob is on its way by the first frame, its handler after it', p.first != null && p.first < 40 && p.moving && p.moved && !p.ranBeforeFrame && p.reqs.includes('toggleOn'), p);
p = await probe('#hxSegSync', '.rf-segmented-thumb', '#hxSegSync .rf-segment:nth-of-type(3)');
check('data-sync runs the handler at once: no frame until it\'s done (60 ms)', p.first != null && p.first >= 60 && p.ranBeforeFrame, p);
await closeAll();

/* ---------------------------------------------------------------- the rows and the gallery */
section('Settings rows and the Feel each one gallery');
check('touch feedback off in the phone\'s settings: the switch says what still buzzes', await page.evaluate(() => {
  const b = window.AndroidBridge, was = b.hapticsSystemEnabled;
  b.hapticsSystemEnabled = () => false;
  const html = window.GH.ui.hapticRows(window.GH.ui.S);
  b.hapticsSystemEnabled = was;
  return /Touch feedback is off/.test(html) && !/Touch feedback is off/.test(window.GH.ui.hapticRows(window.GH.ui.S));
}));
await page.evaluate(() => window.GH.ui.sheet({ title: 'Sound and haptics', size: 'full', quiet: true, body: `<ul class="rf-list" id="hxRows">${window.GH.ui.hapticRows(window.GH.ui.S)}</ul>` }));
await wait(900);
const rows = await page.evaluate(() => {
  const ul = document.getElementById('hxRows');
  return {
    sw: !!ul.querySelector('input[role="switch"][data-on="hapticsOn"]:checked'),
    strength: [...ul.querySelectorAll('.rf-segmented input')].map((i) => `${i.value}${i.checked ? '*' : ''}`).join(),
    gallery: !!ul.querySelector('[data-act="hapticGallery"]'),
  };
});
check('the rows: the switch (on), the strength (Medium), and Feel each one', rows.sw && rows.strength === 'light,medium*,strong' && rows.gallery, rows);
await clear();
await tap('#hxRows .rf-segment:nth-of-type(3)');
await wait(500);
l = await log();
const pref = () => page.evaluate(() => window.GH.ui.S.profile.prefs.hapticStrength);
check('Strong picked: saved, the phone told, and a tap at the new strength after the select', (await pref()) === 'strong' && (await page.evaluate(() => window.__strengths.slice(-1)[0])) === 'strong' && l.bridge.join() === 'select,tap', { pref: await pref(), ...l });
await clear();
await tap('#hxRows [data-act="hapticGallery"]');
await wait(900);
l = await log();
const gallery = await page.evaluate(() => {
  const d = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop();
  const chips = [...d.querySelectorAll('.hx-chip')].map((c) => c.dataset.arg);
  return { title: d.querySelector('.rf-sheet-title').textContent, groups: [...d.querySelectorAll('.hx-title')].map((t) => t.textContent), chips, kinds: window.GH.platform.hapticKinds, strength: [...d.querySelectorAll('.hx-top .rf-segmented input')].map((i) => `${i.value}${i.checked ? '*' : ''}`).join(), waves: d.querySelectorAll('.hx-chip .hx-wave > i').length };
});
check('Feel each one opens from its row with nav', l.bridge.join() === 'nav' && gallery.title === 'Feel each one', { ...l, title: gallery.title });
check('the strength on top, then Touch, Navigation, Feedback, Workout and Moments', gallery.strength === 'light,medium,strong*' && gallery.groups.join() === 'Touch,Navigation,Feedback,Workout,Moments', gallery);
check('a chip for every kind, once, each with its rhythm drawn', gallery.chips.length === gallery.kinds.length && [...gallery.chips].sort().join() === [...gallery.kinds].sort().join() && gallery.waves >= gallery.kinds.length, gallery);
// Three chips in view together, tapped quickly: workoutDone is still playing when undo comes (a
// smaller event, otherwise dropped), and deny right after undo (an equal one, otherwise queued).
await page.evaluate(() => { const t = window.GH.ui.topSheet(); if (t) t.detent('large'); });
await wait(700);
await page.evaluate(() => document.querySelector('dialog[open] .hx-chip[data-arg="undo"]').scrollIntoView({ block: 'start' }));
await wait(500);
{
  const spots = [];
  for (const k of ['workoutDone', 'undo', 'deny']) spots.push(await centre(`dialog[open] .hx-chip[data-arg="${k}"]`));
  const inView = spots.every((c) => c && c.y > 120 && c.y < 800);
  await clear();
  for (const c of spots) await gesture([[c.x, c.y]], { hold: 20 });
  await wait(400);
  l = await log();
  check('each chip plays its kind at once, even over a bigger or equal one still playing', inView && l.bridge.join() === 'workoutDone,undo,deny', { inView, spots, ...l });
}
await page.evaluate(() => document.querySelector('dialog[open] .hx-top').scrollIntoView({ block: 'center' }));
await wait(500);
await clear();
await tap('dialog[open] .hx-top .rf-segment:nth-of-type(1)');
await wait(500);
l = await log();
check('the gallery\'s own strength control: Light saved, with its tap', (await pref()) === 'light' && l.bridge.join() === 'select,tap', { pref: await pref(), ...l });
await page.evaluate(() => { const t = window.GH.ui.topSheet(); if (t) t.close('cancel'); });
await wait(600);
// The switch: off, and nothing plays; on again, with its own toggle.
await clear();
await tap('#hxRows input[data-on="hapticsOn"]');
await wait(400);
await page.evaluate(() => window.GH.ui.haptic('success'));
await wait(200);
l = await log();
check('switched off: saved, and nothing plays (its own toggle came before it went off)', (await page.evaluate(() => window.GH.ui.S.profile.prefs.haptics)) === false && l.bridge.join() === 'toggleOff', l);
await clear();
await tap('#hxRows input[data-on="hapticsOn"]');
await wait(400);
l = await log();
check('on again: its toggle plays once haptics are back', (await page.evaluate(() => window.GH.ui.S.profile.prefs.haptics)) === true && l.bridge.join() === 'toggleOn', l);
await page.evaluate(() => { window.GH.ui.S.profile.prefs.hapticStrength = 'medium'; window.GH.ui.applyPrefs(); });
await closeAll();

check('no errors on the page', !errors.length, errors.slice(0, 5));
await browser.close();
await server.close();
done();
