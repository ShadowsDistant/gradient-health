// Switches, segmented controls and chip choices under real touch gestures (CDP touch events at phone
// size) and the mouse and keyboard, each case repeated with seeded jitter:
// - switches: a clean tap, wobbly taps (6 and 11 px), a drag, a flick, a half drag, a drag the page
//   cancels, a vertical swipe (the page scrolls), a tap on the row's text (also right after a
//   cancelled drag), the mouse, Space, a re-render that adds a row above, a double tap, a switch in a
//   sheet right after the sheet was dragged, a disabled switch and a refused change (it springs back
//   with a deny);
// - segmented controls and chip choices: wobbly taps, dragging from any segment, a cancelled drag,
//   a vertical swipe and the arrow keys;
// - then the glass: thumbs glass at rest, the lens only while held or moving and off at rest, the
//   glass lasting until the move ends, toggle chips that keep their width, the tab bar's lens, and a
//   Settings change that no longer redraws every lens map.
// Desktop Chromium allows a tap to wobble about 15 px before it drops the click; a phone, about 8 dp.
// The wobbly cases run three ways: with the native click, with the phone's slop (the click is dropped
// before the page sees it, so the tap must be rescued), and with the click arriving 200 ms late (a
// busy phone: the rescue goes first and the late click must be swallowed).
// Usage: node test/ui-controls.mjs [--dark] [--reduced-motion] [--contrast] [--reduced-transparency] [--reps=20]
import { createRequire } from 'node:module';
import { check, section, done, serveDist, load } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const reducedMotion = process.argv.includes('--reduced-motion');
const contrast = process.argv.includes('--contrast');
const reducedTransparency = process.argv.includes('--reduced-transparency');
// With increased contrast or reduced transparency there's no glass: solid thumbs, no lens.
const solid = contrast || reducedTransparency;
const REPS = Number((process.argv.find((a) => a.startsWith('--reps=')) || '--reps=20').split('=')[1]);

/* ---------------------------------------------------------------- the rules, in node */
section('Gesture rules');
const SG = load('src/ui/controls.js').ui.switchGesture;
check('a tap may wobble: 11 px sideways is still a tap', SG.classify(11, 3) === 'pending');
check('12 px sideways is a drag', SG.classify(12, 2) === 'drag' && SG.classify(-12, 0) === 'drag');
check('more than 10 px up or down (and more than sideways) is a scroll', SG.classify(4, 11) === 'scroll' && SG.classify(3, -11) === 'scroll' && SG.classify(10, 10) === 'pending');
check('a release lands past the middle, or the way it was flicked', SG.landing(30, 50, 0) && !SG.landing(20, 50, 0) && SG.landing(10, 50, 0.5) && !SG.landing(40, 50, -0.5));
{
  const T = SG.tracker();
  T.down({ id: 1, x: 0, y: 0, t: 100 });
  T.up({ id: 1, x: 3, y: 1, t: 160 });
  const first = T.click({ t: 160, detail: 1 });
  const second = T.click({ t: 160, detail: 1 });
  check('a tap\'s own click goes through once', first === 'allow' && second === 'swallow', [first, second]);
  T.down({ id: 2, x: 0, y: 0, t: 300 });
  T.up({ id: 2, x: 9, y: 2, t: 380 });
  const rescued = T.rescue();
  check('a tap with no click is rescued, and its late click swallowed', rescued && T.click({ t: 380, detail: 1 }) === 'swallow');
  T.down({ id: 3, x: 0, y: 0, t: 500 });
  check('a click older than the gesture in progress is a late one: swallowed', T.click({ t: 380, detail: 2 }) === 'swallow');
  check('keyboard clicks (detail 0) always go through', T.click({ t: 520, detail: 0 }) === 'allow');
  T.move({ id: 3, x: 14, y: 0, t: 530 });
  T.up({ id: 3, x: 30, y: 0, t: 560 });
  check('a drag\'s click is swallowed', T.click({ t: 560, detail: 1 }) === 'swallow' && !T.rescue());
  T.down({ id: 4, x: 0, y: 0, t: 700 });
  T.move({ id: 4, x: 0, y: 20, t: 720 });
  check('so is a scroll\'s, and the next gesture starts clean', T.up({ id: 4, x: 0, y: 20, t: 760 }) === 'none' && T.click({ t: 760, detail: 1 }) === 'swallow');
  T.down({ id: 5, x: 0, y: 0, t: 900 });
  T.up({ id: 5, x: 1, y: 0, t: 950 });
  check('a clean tap after all that still gets its click', T.click({ t: 950, detail: 1 }) === 'allow');
}

/* ---------------------------------------------------------------- the app */
const server = await serveDist();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: dark ? 'dark' : 'light', reducedMotion: reducedMotion ? 'reduce' : 'no-preference', contrast: contrast ? 'more' : 'no-preference',
});
const page = await ctx.newPage();
// Reduced transparency is the system's setting (the app has none of its own), emulated for the page.
if (reducedTransparency) await (await ctx.newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(seedBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.evaluate((hc) => { const S = window.GH.store.load(); if (hc) S.profile.prefs.contrast = true; window.GH.store.save(S); }, contrast);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const wait = (ms) => page.waitForTimeout(ms);
await page.evaluate(() => {
  // What the controls ask for (U.haptic's names; the bridge plays tap for a name it doesn't know yet).
  window.__req = [];
  const U = window.GH.ui, h = U.haptic;
  U.haptic = (k, o) => { window.__req.push(k); return h(k, o); };
  window.__changes = [];
  document.addEventListener('change', (e) => { const t = e.target; window.__changes.push({ key: t.getAttribute('data-k') || t.getAttribute('data-on') || t.name || t.closest('[data-on]')?.getAttribute('data-on') || '', value: t.type === 'checkbox' ? t.checked : t.value }); }, true);
  // A phone's tap slop (see the header): 'phone' drops a click once the touch moved past 8 px;
  // 'late' holds every touch click back and delivers it later.
  let s = null, moved = 0;
  window.__mode = 'native'; window.__lateMs = 200; window.__dropped = 0; window.__lated = 0;
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { s = { x: e.clientX, y: e.clientY }; moved = 0; } }, true);
  addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && s) moved = Math.max(moved, Math.hypot(e.clientX - s.x, e.clientY - s.y)); }, true);
  addEventListener('click', (e) => {
    if (!e.isTrusted || !e.detail || !s || window.__mode === 'native') return;
    if (window.__mode === 'phone' && moved <= 8) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (window.__mode === 'phone') { window.__dropped++; return; }
    const late = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: e.detail, clientX: e.clientX, clientY: e.clientY, view: window });
    const target = e.target;
    window.__lated++;
    setTimeout(() => target.dispatchEvent(late), window.__lateMs);
  }, true);
});
const cdp = await ctx.newCDPSession(page);

// Seeded jitter, so a failure can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r, lo, hi) => lo + (hi - lo) * r();

// Touches on their own timeline (events carry it, so a flick's speed doesn't depend on how fast this
// machine delivers them), kept a little ahead of the wall clock.
let clock = 0;
const touch = (type, x, y, t) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }], timestamp: t });
async function gesture(path, { hold = 40, stepMs = 16, cancel = false } = {}) {
  clock = Math.max(clock + 0.05, Date.now() / 1000);
  let t = clock;
  await touch('touchStart', path[0][0], path[0][1], t);
  for (const [x, y] of path.slice(1)) { t += stepMs / 1000; await touch('touchMove', x, y, t); }
  t += hold / 1000;
  if (hold) await wait(hold);
  const [x, y] = path[path.length - 1];
  await touch(cancel ? 'touchCancel' : 'touchEnd', x, y, t);
  clock = t;
}
// A wobble of `px` from (x, y), in a few steps, ending `px` away in a random direction (sideways at
// most `maxDx`, up or down at most 7 px so it never reads as a scroll).
function wobble(x, y, px, r) {
  const a = between(r, 0, Math.PI * 2);
  let dx = Math.cos(a) * px, dy = Math.sin(a) * px;
  if (Math.abs(dy) > 7) { dy = Math.sign(dy) * 7; dx = Math.sign(dx || 1) * Math.sqrt(px * px - 49); }
  const n = 2 + Math.floor(r() * 3);
  const path = [[x, y]];
  for (let i = 1; i <= n; i++) path.push([x + (dx * i) / n + between(r, -0.4, 0.4), y + (dy * i) / n + between(r, -0.4, 0.4)]);
  path[path.length - 1] = [x + dx, y + dy];
  return path;
}
const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const mode = (m) => page.evaluate((x) => { window.__mode = x; }, m);
const clear = () => page.evaluate(() => { window.__req.length = 0; window.__changes.length = 0; window.__haptics.length = 0; });
const log = () => page.evaluate(() => ({ req: window.__req.slice(), changes: window.__changes.slice(), bridge: window.__haptics.slice() }));
// Runs fn(i, r) n times; a run returns null when all is well, or what went wrong.
async function repeat(name, seed, fn, n = REPS) {
  const bad = [];
  for (let i = 0; i < n; i++) { const r = rng(seed * 1000 + i); const w = await fn(i, r); if (w) bad.push({ i, ...w }); }
  return check(`${name} (${n - bad.length} of ${n})`, !bad.length, bad.slice(0, 3));
}

/* ---------------------------------------------------------------- switches */
const settings = async () => { await page.evaluate(() => { window.GH.ui.closeSheets(); if (window.GH.ui.route.view !== 'settings') window.GH.ui.open('settings'); }); await wait(700); };
// Where a switch is: its track (the input covers it), the knob, and the row's title.
const where = (sel) => page.evaluate((s) => {
  const i = document.querySelector(s);
  if (!i) return null;
  const row = i.closest('.rf-switch');
  const r0 = i.getBoundingClientRect();
  // Brought into view on the page (in a sheet, moving it would move the sheet under the finger).
  if (!i.closest('dialog') && (r0.top < 120 || r0.bottom > innerHeight - 140)) { i.scrollIntoView({ block: 'center' }); }
  const r = i.getBoundingClientRect(), k = row.querySelector('.rf-switch-thumb').getBoundingClientRect(), t = row.querySelector('.rf-list-title').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, right: r.right, w: r.width, kx: k.x + k.width / 2, tx: t.x + Math.min(40, t.width / 2), ty: t.y + t.height / 2, checked: i.checked };
}, sel);
const checked = (sel) => page.evaluate((s) => document.querySelector(s).checked, sel);
// How many times a switch changed, and whether it ended the other way round from `from`.
async function outcome(sel, key, from, settleMs) {
  await wait(settleMs);
  const now = await checked(sel);
  const l = await log();
  const changes = l.changes.filter((c) => c.key === key).length;
  // The toggle haptics asked for, and the ones the bridge (the fixture's Android shell) played.
  const isToggle = (k) => k === 'toggleOn' || k === 'toggleOff';
  const toggles = l.req.filter(isToggle).length, played = l.bridge.filter(isToggle).length;
  return { now, flipped: now !== from, changes, toggles, played, req: l.req, bridge: l.bridge };
}
const once = (o) => (o.flipped && o.changes === 1 && o.toggles === 1 && o.played === 1 ? null : o);
const never = (o) => (!o.flipped && o.changes === 0 && o.toggles === 0 && o.played === 0 ? null : o);
const SUP = '#screen input[data-on="setPref"][data-k="supersets"]';
const SND = '#screen input[data-on="setPref"][data-k="sound"]';

section(`Switches, ${dark ? 'dark' : 'light'}${contrast ? ', increased contrast' : ''}${reducedTransparency ? ', reduced transparency' : ''}${reducedMotion ? ', reduced motion' : ''}`);
if (reducedTransparency) check('reduced transparency is on, for the page and for Refract', await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches && window.Refract.prefs.reducedTransparency));
await settings();
// A tap on the knob or the track, `px` of wobble, in each of the three click modes.
async function tapCase(name, seed, px, sel, key, m, settle) {
  await mode(m);
  const ok = await repeat(name, seed, async (i, r) => {
    const b = await where(sel);
    const x = b.x + between(r, -b.w / 2 + 6, b.w / 2 - 6), y = b.y + between(r, -5, 5);
    await clear();
    await gesture(px ? wobble(x, y, px, r) : [[x, y]], { hold: Math.round(between(r, 20, 110)) });
    return once(await outcome(sel, key, b.checked, settle));
  });
  await mode('native');
  return ok;
}
await tapCase('a clean tap toggles once', 1, 0, SUP, 'supersets', 'native', 160);
await tapCase('a tap that wobbles 6 px toggles once', 2, 6, SND, 'sound', 'native', 160);
await tapCase('11 px of wobble, with the click: once', 3, 11, SUP, 'supersets', 'native', 200);
await tapCase('11 px, with a phone\'s slop (no click): once, rescued', 4, 11, SUP, 'supersets', 'phone', 260);
check('those taps really had no click', await page.evaluate(() => window.__dropped) >= REPS, await page.evaluate(() => window.__dropped));
await tapCase('a clean tap whose click comes 200 ms late: once, the late click swallowed', 5, 0, SND, 'sound', 'late', 330);
await tapCase('6 px of wobble, its click late: once', 6, 6, SUP, 'supersets', 'late', 330);

// Drags: from the knob toward the other end.
await repeat('a 30 px drag toggles once, with no trailing toggle from a click', 7, async (i, r) => {
  const b = await where(SND);
  const dir = b.checked ? -1 : 1, x0 = b.kx + between(r, -3, 3), y = b.y + between(r, -4, 4);
  await clear();
  await gesture(line(x0, y, x0 + dir * 30, y + between(r, -3, 3), 5 + Math.floor(r() * 4)), { hold: Math.round(between(r, 0, 60)) });
  const o = await outcome(SND, 'sound', b.checked, 300);
  return once(o) || (o.req.includes('detent') ? null : o);
});
await repeat('a quick flick that ends short of the middle still toggles', 8, async (i, r) => {
  const b = await where(SND);
  const dir = b.checked ? -1 : 1, x0 = b.kx, y = b.y;
  await clear();
  await gesture(line(x0, y, x0 + dir * 14, y, 2), { hold: 0, stepMs: 8 });
  return once(await outcome(SND, 'sound', b.checked, 300));
});
// The knob travels 16 px and a drag starts at 12, so a half drag goes out and comes back.
await repeat('a half drag let go before the middle doesn\'t toggle, and the next tap does', 9, async (i, r) => {
  const b = await where(SUP);
  const dir = b.checked ? -1 : 1, x0 = b.kx, y = b.y;
  await clear();
  await gesture([...line(x0, y, x0 + dir * 14, y, 3), ...line(x0 + dir * 14, y, x0 + dir * Math.round(between(r, 1, 5)), y + between(r, -2, 2), 3).slice(1)], { hold: 140, stepMs: 20 });
  const half = await outcome(SUP, 'supersets', b.checked, 260);
  if (never(half)) return { half };
  await clear();
  await gesture([[b.x + between(r, -6, 6), b.y]], { hold: 30 });
  const tap = await outcome(SUP, 'supersets', b.checked, 200);
  return once(tap) ? { tap } : null;
});
await repeat('a drag the page cancels doesn\'t toggle, and the knob goes back', 10, async (i, r) => {
  const b = await where(SND);
  const dir = b.checked ? -1 : 1, x0 = b.kx, y = b.y;
  await clear();
  await gesture(line(x0, y, x0 + dir * 26, y, 5), { hold: 20, cancel: true });
  const o = await outcome(SND, 'sound', b.checked, 120);
  const knob = await page.evaluate(async (s) => { const i = document.querySelector(s); await window.GH.ui.controlSettled(i); await new Promise((res) => setTimeout(res, 50)); const th = i.closest('.rf-switch').querySelector('.rf-switch-thumb'); return { drag: i.closest('.rf-switch-track').style.getPropertyValue('--_drag'), dragging: i.closest('.rf-switch-track').hasAttribute('data-dragging'), x: Math.round(th.getBoundingClientRect().x + th.getBoundingClientRect().width / 2) }; }, SND);
  const home = Math.abs(knob.x - b.kx) <= 2;
  return never(o) || knob.drag || knob.dragging || !home ? { o, knob, kx: b.kx } : null;
});
await repeat('a vertical swipe that starts on the switch scrolls the page and doesn\'t toggle', 11, async (i, r) => {
  const b = await where(SUP);
  const top = await page.evaluate(() => document.getElementById('screen').scrollTop);
  const dy = (i % 2 ? 1 : -1) * Math.round(between(r, 60, 110));
  await clear();
  await gesture(line(b.x, b.y, b.x + between(r, -4, 4), b.y + dy, 8), { hold: 10 });
  const o = await outcome(SUP, 'supersets', b.checked, 260);
  const moved = Math.abs((await page.evaluate(() => document.getElementById('screen').scrollTop)) - top);
  return never(o) || (moved < 20 && dy < 0 && top > 0) ? { o, moved } : null;
});
await mode('phone');
await repeat('a tap on the row\'s text toggles, also right after a cancelled drag (phone slop)', 12, async (i, r) => {
  const b = await where(SUP);
  if (i % 2) { await gesture(line(b.kx, b.y, b.kx + (b.checked ? -20 : 20), b.y, 4), { hold: 10, cancel: true }); await wait(60); }
  await clear();
  await gesture(i % 4 < 2 ? [[b.tx, b.ty]] : wobble(b.tx, b.ty, 10, r), { hold: Math.round(between(r, 20, 90)) });
  return once(await outcome(SUP, 'supersets', b.checked, 260));
});
await mode('native');
await repeat('a double tap toggles twice, with two haptics', 13, async (i, r) => {
  const b = await where(SND);
  await clear();
  await gesture([[b.x + between(r, -8, 8), b.y]], { hold: 25 });
  await wait(Math.round(between(r, 40, 120)));
  await gesture([[b.x + between(r, -8, 8), b.y + between(r, -3, 3)]], { hold: 25 });
  const o = await outcome(SND, 'sound', b.checked, 220);
  return !o.flipped && o.changes === 2 && o.toggles === 2 && o.played === 2 ? null : o;
});

// The mouse and the keyboard.
await repeat('a mouse click toggles once', 14, async (i, r) => {
  const b = await where(SUP);
  await clear();
  await page.mouse.click(b.x + between(r, -10, 10), b.y + between(r, -4, 4));
  return once(await outcome(SUP, 'supersets', b.checked, 160));
});
await repeat('a mouse drag toggles once (its click is swallowed)', 15, async (i, r) => {
  const b = await where(SND);
  const dir = b.checked ? -1 : 1;
  await clear();
  await page.mouse.move(b.kx, b.y);
  await page.mouse.down();
  await page.mouse.move(b.kx + dir * 28, b.y + between(r, -2, 2), { steps: 6 });
  await page.mouse.up();
  return once(await outcome(SND, 'sound', b.checked, 260));
});
await repeat('Space toggles', 16, async () => {
  const b = await where(SUP);
  await page.focus(SUP);
  await clear();
  await page.keyboard.press('Space');
  return once(await outcome(SUP, 'supersets', b.checked, 160));
});
await page.evaluate(() => document.activeElement && document.activeElement.blur());

// A disabled switch never moves.
await page.evaluate((s) => window.GH.ui.controlSettled(document.querySelector(s)), SUP);
await wait(300);
await page.evaluate((s) => { document.querySelector(s).disabled = true; }, SUP);
await repeat('a disabled switch never toggles', 17, async (i, r) => {
  const b = await where(SUP);
  await clear();
  if (i % 3 === 0) await gesture([[b.x, b.y]], { hold: 30 });
  else if (i % 3 === 1) await gesture(line(b.kx, b.y, b.kx + (b.checked ? -28 : 28), b.y, 5), { hold: 10 });
  else await gesture([[b.tx, b.ty]], { hold: 30 });
  const o = await outcome(SUP, 'supersets', b.checked, 220);
  const lifted = await page.evaluate((s) => document.querySelector(s).closest('.rf-switch-track').matches('[data-pressed], [data-dragging], [data-traveling]'), SUP);
  return never(o) || lifted ? { o, lifted } : null;
});
await page.evaluate((s) => { document.querySelector(s).disabled = false; }, SUP);

// A re-render that adds a row above: the "Allow the new data types" row shows up when Health Connect
// lacks one of the newer types. The switch keeps its node (its key), so the next tap moves it, and no
// other switch on the page moves at all.
section('A re-render that adds a row above');
const HCW = '#screen input[data-on="hcWriteToggle"]';
await page.evaluate(() => {
  window.__granted = window.AndroidBridge.hcGranted;
  window.AndroidBridge.hcGranted = () => JSON.stringify(JSON.parse(window.__granted()).filter((t) => t !== 'heartRate'));
});
const nodeBefore = await page.evaluate((s) => { window.__hcw = document.querySelector(s); return !!window.__hcw; }, HCW);
await page.evaluate(() => window.GH.ui.render());
await wait(400);
const reRender = await page.evaluate((s) => ({ allow: [...document.querySelectorAll('#screen .rf-list-title')].some((t) => /Allow the new data types/.test(t.textContent)), same: document.querySelector(s) === window.__hcw }), HCW);
check('the row is there, and the switch below it kept its node', nodeBefore && reRender.allow && reRender.same, reRender);
await repeat('the next tap toggles that switch, and nothing else moves', 18, async (i, r) => {
  const b = await where(HCW);
  const write0 = await page.evaluate(() => window.GH.ui.S.health.write !== false);
  await clear();
  await gesture([[b.x + between(r, -8, 8), b.y + between(r, -4, 4)]], { hold: 30 });
  await wait(60);
  const others = await page.evaluate((s) => {
    const mine = document.querySelector(s).closest('.rf-switch-track');
    const tracks = [...document.querySelectorAll('#screen .rf-switch-track')].filter((t) => t !== mine);
    return { traveling: tracks.filter((t) => t.hasAttribute('data-traveling')).length, moving: document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && tracks.some((t) => t.contains(a.effect.target))).length };
  }, HCW);
  const o = await outcome(HCW, 'hcWriteToggle', b.checked, 160);
  const write1 = await page.evaluate(() => window.GH.ui.S.health.write !== false);
  return !once(o) && write1 !== write0 && !others.traveling && !others.moving ? null : { o, write0, write1, others };
});
await page.evaluate(() => { window.AndroidBridge.hcGranted = window.__granted; window.GH.ui.S.health.write = true; window.GH.ui.render(); });
await wait(300);

// A switch in a sheet, right after the sheet was dragged: the drag's own click is swallowed, never
// the next tap's.
section('A switch in a sheet after a sheet drag');
await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.ui.act.daysSheet(); });
await wait(900);
const DSL = 'dialog[open] input[data-on="dsLight"]';
await repeat('100 ms after a drag of the sheet, a tap on its switch toggles', 19, async (i, r) => {
  const hd = await page.evaluate(() => { const h = document.querySelector('dialog[open] .rf-sheet-header').getBoundingClientRect(); return { x: h.x + 60, y: h.y + h.height / 2 }; });
  await gesture(line(hd.x, hd.y, hd.x + between(r, -3, 3), hd.y + Math.round(between(r, 40, 70)), 6), { hold: 30, stepMs: 20 });
  await wait(100);
  const b = await where(DSL);
  await clear();
  await gesture([[b.x + between(r, -8, 8), b.y + between(r, -3, 3)]], { hold: 30 });
  const o = await outcome(DSL, 'dsLight', b.checked, 200);
  await wait(500);
  return once(o);
});
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(500);

// A refused change: turning workouts off with a workout going springs back, with a deny.
section('A refused change springs back');
await page.evaluate(() => { const U = window.GH.ui; window.GH.brain.startWorkout(U.S, U.today(), { now: Date.now() }); U.save(); });
await settings();
const WRK = '#screen input[data-on="setWorkouts"]';
const noToasts = () => page.evaluate(() => { for (const t of document.querySelectorAll('.rf-toast')) t.remove(); });
await repeat('turning workouts off mid-workout springs back with a deny', 20, async (i, r) => {
  await noToasts(); // the warning sits over the top of the page, where this switch is
  const b = await where(WRK);
  await clear();
  await gesture([[b.x + between(r, -8, 8), b.y]], { hold: 30 });
  await wait(90);
  const mid = await checked(WRK);
  await wait(500);
  const l = await log();
  const end = await page.evaluate((s) => ({ checked: document.querySelector(s).checked, workouts: window.GH.ui.S.profile.workouts !== false }), WRK);
  // The deny reaches the bridge too: as deny once the haptics work knows the name, as a tap until then.
  const denied = l.req.includes('deny') && (l.bridge.includes('deny') || l.bridge.includes('tap'));
  return !mid && end.checked && end.workouts && denied ? null : { mid, end, req: l.req, bridge: l.bridge };
});
await page.evaluate(() => { const U = window.GH.ui; window.GH.brain.cancelWorkout(U.S); U.save(); });
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(300);

/* ---------------------------------------------------------------- segmented controls */
section('Segmented controls');
await settings();
const REST = '#screen [data-on="setRest"]';
const segBox = () => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r0 = el.getBoundingClientRect();
  if (r0.top < 120 || r0.bottom > innerHeight - 140) el.scrollIntoView({ block: 'center' });
  const segs = [...el.querySelectorAll('.rf-segment')].map((g) => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, v: g.querySelector('input').value, on: g.querySelector('input').checked }; });
  return segs;
}, REST);
const picked = () => page.evaluate((s) => { const i = document.querySelector(`${s} input:checked`); return i && i.value; }, REST);
const segOutcome = async (from, settle) => {
  await wait(settle);
  const now = await picked();
  const l = await log();
  return { now, from, changes: l.changes.filter((c) => c.key === 'setRest').length, req: l.req };
};
for (const [m, name, settle] of [['native', 'with the click', 200], ['phone', 'with a phone\'s slop (rescued)', 260], ['late', 'its click late', 330]]) {
  await mode(m);
  await repeat(`a wobbly tap on another segment picks it once, ${name}`, 21 + ['native', 'phone', 'late'].indexOf(m), async (i, r) => {
    const segs = await segBox();
    const cur = segs.findIndex((g) => g.on), to = (cur + 1 + Math.floor(r() * 2)) % segs.length;
    await clear();
    await gesture(wobble(segs[to].x + between(r, -10, 10), segs[to].y + between(r, -4, 4), m === 'native' ? 6 : 11, r), { hold: Math.round(between(r, 20, 90)) });
    const o = await segOutcome(segs[cur].v, settle);
    return o.now === segs[to].v && o.changes === 1 ? null : o;
  });
}
await mode('native');
await repeat('a drag from any segment picks where it\'s let go, ticking per segment crossed', 24, async (i, r) => {
  const segs = await segBox();
  const from = Math.floor(r() * segs.length);
  let to = Math.floor(r() * segs.length);
  if (to === from) to = (from + 1) % segs.length;
  await clear();
  await gesture(line(segs[from].x + between(r, -8, 8), segs[from].y, segs[to].x + between(r, -6, 6), segs[to].y + between(r, -3, 3), 8), { hold: 60, stepMs: 18 });
  const o = await segOutcome(segs.find((g) => g.on).v, 320);
  const ticks = o.req.filter((k) => k === 'tick').length;
  const cur = segs.findIndex((g) => g.on);
  const changed = segs[to].v !== segs[cur].v;
  return o.now === segs[to].v && o.changes === (changed ? 1 : 0) && ticks >= 1 ? null : { ...o, ticks, from, to };
});
await repeat('a drag the page cancels leaves the pick as it was', 25, async (i, r) => {
  const segs = await segBox();
  const cur = segs.findIndex((g) => g.on), to = (cur + 1) % segs.length;
  await clear();
  await gesture(line(segs[cur].x, segs[cur].y, segs[to].x, segs[to].y, 6), { hold: 30, cancel: true });
  const o = await segOutcome(segs[cur].v, 300);
  // Once it has landed back (it springs there, keeping the drag's speed).
  const thumb = await page.evaluate(async (s) => { const el = document.querySelector(s); await window.GH.ui.controlSettled(el); const t = el.querySelector('.rf-segmented-thumb').getBoundingClientRect(); const c = el.querySelector('input:checked').closest('.rf-segment').getBoundingClientRect(); return { dx: Math.abs((t.x + t.width / 2) - (c.x + c.width / 2)), dragging: el.hasAttribute('data-dragging') }; }, REST);
  return o.now === segs[cur].v && !o.changes && thumb.dx < 3 && !thumb.dragging ? null : { ...o, thumb };
});
await repeat('a vertical swipe from a segment picks nothing', 26, async (i, r) => {
  const segs = await segBox();
  const cur = segs.findIndex((g) => g.on), to = (cur + 1) % segs.length;
  await clear();
  await gesture(line(segs[to].x, segs[to].y, segs[to].x + between(r, -4, 4), segs[to].y - Math.round(between(r, 60, 100)), 8), { hold: 10 });
  const o = await segOutcome(segs[cur].v, 260);
  return o.now === segs[cur].v && !o.changes ? null : o;
});
{
  await page.focus(`${REST} input:checked`);
  const before = await picked();
  await clear();
  await page.keyboard.press('ArrowRight');
  await wait(200);
  const after = await picked();
  const l = await log();
  check('the arrow keys move the pick, with its change', after !== before && l.changes.filter((c) => c.key === 'setRest').length === 1, { before, after, changes: l.changes });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

/* ---------------------------------------------------------------- chip choices */
section('Chip choices');
// How it works: a sideways rail of groups (U.choice with many options).
await page.evaluate(() => window.GH.ui.open('science'));
await wait(900);
const RAIL = '#screen .gh-chipseg[data-on="sciShow"]';
const chips = () => page.evaluate((s) => {
  const el = document.querySelector(s);
  return [...el.querySelectorAll('[role="radio"]')].map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, v: b.value, on: b.getAttribute('aria-checked') === 'true', seen: r.x > 8 && r.right < innerWidth - 8 }; });
}, RAIL);
check('it\'s a radiogroup of radios, one checked, with a glass indicator', await page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.getAttribute('role') === 'radiogroup' && el.querySelectorAll('[role="radio"][aria-checked="true"]').length === 1 && !!el.querySelector(':scope > .gh-chipseg-thumb'); }, RAIL));
for (const [m, name, settle] of [['native', 'a tap', 200], ['phone', 'a wobbly tap with a phone\'s slop', 260]]) {
  await mode(m);
  await repeat(`${name} picks a chip once`, 27 + (m === 'phone' ? 1 : 0), async (i, r) => {
    const list = (await chips()).filter((c) => c.seen && !c.on);
    const c = list[Math.floor(r() * list.length)];
    await clear();
    await gesture(m === 'phone' ? wobble(c.x + between(r, -6, 6), c.y, 10, r) : [[c.x + between(r, -6, 6), c.y + between(r, -3, 3)]], { hold: 40 });
    await wait(settle);
    const l = await log();
    const now = (await chips()).find((x) => x.on);
    const shown = await page.evaluate(() => document.querySelectorAll('#screen .sci-list').length);
    return now && now.v === c.v && l.changes.filter((x) => x.key === 'sciShow').length === 1 && l.req.filter((k) => k === 'select').length === 1 && (c.v === 'all' || shown === 1) ? null : { want: c.v, now: now && now.v, changes: l.changes, req: l.req, shown };
  });
}
await mode('native');
await repeat('a sideways swipe on the rail scrolls it and picks nothing', 29, async (i, r) => {
  const list = await chips();
  const c = list.find((x) => x.seen && !x.on) || list[1];
  const cur = list.find((x) => x.on);
  await clear();
  await gesture(line(c.x, c.y, c.x + (i % 2 ? 1 : -1) * Math.round(between(r, 50, 90)), c.y + between(r, -3, 3), 7), { hold: 10 });
  await wait(250);
  const now = (await chips()).find((x) => x.on);
  return now.v === cur.v && !(await log()).changes.length ? null : { now: now.v, cur: cur.v };
});
{
  const list = await chips();
  const cur = list.findIndex((x) => x.on);
  await page.focus(`${RAIL} [role="radio"][aria-checked="true"]`);
  await clear();
  await page.keyboard.press('ArrowRight');
  await wait(200);
  const after = await chips();
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.value);
  check('arrow keys move the pick and the focus, like radios', after[(cur + 1) % list.length].on && focus === after[(cur + 1) % list.length].v && (await log()).changes.length === 1, { cur, focus });
  await page.keyboard.press('Home');
  await wait(200);
  check('Home goes to the first', (await chips())[0].on);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}
await page.evaluate(() => window.GH.ui.back());
await wait(500);

/* ---------------------------------------------------------------- the glass */
section('The glass');
await settings();
// Refract's liquid glass (src/ui/controls.js): a segmented control's thumb is a frosted bead with a lens
// over its labels; held, it rises (data-lifted) and the lens bends what's under it. At rest the lens's
// backdrop filter is off (src/styles/controls.css): it would be redrawn every frame the page moves.
const look = (s) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const th = el.querySelector(':scope > .rf-segmented-thumb'), lens = el.querySelector(':scope > .rf-segmented-lens');
  const face = getComputedStyle(th, '::before'), ls = lens && getComputedStyle(lens, '::after');
  // A computed colour's alpha, whatever its form: rgba(r, g, b, a), or a / a at the end (oklab, color()).
  const alpha = (c) => { let m = /\/\s*([\d.]+)\s*\)\s*$/.exec(c); if (m) return parseFloat(m[1]); m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(c); return m ? parseFloat(m[1]) : 1; };
  const scale = (t) => { const m = /matrix\(([^,]+),[^,]+,[^,]+,([^,]+),/.exec(getComputedStyle(t).transform); return m ? parseFloat(m[1]) : 1; };
  return {
    fill: alpha(face.backgroundColor), width: th.getBoundingClientRect().width,
    lens: ls ? { display: getComputedStyle(lens).display, content: ls.content, filter: ls.backdropFilter } : null,
    lifted: th.hasAttribute('data-lifted'), scale: scale(th), traveling: el.hasAttribute('data-traveling'),
    label: getComputedStyle(el.querySelector('input:checked, [aria-checked="true"]').closest('.rf-segment, [role="radio"]')).color,
  };
}, s);
const rest = await look(REST);
if (solid) {
  check(`${contrast ? 'increased contrast' : 'reduced transparency'}: the thumb is solid, with no lens`, rest.fill === 1 && rest.lens && (rest.lens.display === 'none' || rest.lens.content === 'none'), rest);
} else {
  check('at rest the thumb is a frosted bead under the picked option', rest.fill > 0.5 && rest.width > 20 && !rest.lifted && Math.abs(rest.scale - 1) < 0.01, rest);
  check('at rest its lens draws nothing: no backdrop filter', rest.lens && rest.lens.filter === 'none', rest.lens);
}
// Held: the bead rises and its lens comes on over the labels.
{
  const segs = await segBox();
  const cur = segs.find((g) => g.on);
  await touch('touchStart', cur.x, cur.y, (clock = Math.max(clock + 0.05, Date.now() / 1000)));
  await wait(300);
  const held = await look(REST);
  await touch('touchMove', cur.x + 14, cur.y, clock + 0.03);
  await touch('touchMove', cur.x + 24, cur.y, clock + 0.05);
  await wait(200);
  const dragged = await look(REST);
  await touch('touchCancel', cur.x + 24, cur.y, clock + 0.3);
  clock += 0.3;
  if (!solid) {
    check('held, the bead rises (data-lifted, larger) and its lens comes on, with a backdrop filter', held.lifted && held.scale > (reducedMotion ? 0.99 : 1.04) && held.lens.filter !== 'none', held);
    check('dragged, the lens bends the labels it passes', dragged.lifted && /url\(|saturate/.test(dragged.lens.filter), dragged.lens);
  } else check('held and dragged, still no lens', held.lens.content === 'none' || held.lens.display === 'none');
  await wait(900);
}
// Moving: the glass stays until the thumb lands, then the bead is at rest again.
{
  const segs = await segBox();
  const cur = segs.findIndex((g) => g.on), to = (cur + 1) % segs.length;
  await gesture([[segs[to].x, segs[to].y]], { hold: 20 });
  const samples = [];
  for (let k = 0; k < 8; k++) { await wait(50); samples.push(await page.evaluate((s) => { const el = document.querySelector(s); const t = el.querySelector('.rf-segmented-thumb'); const c = el.querySelector('input:checked').closest('.rf-segment').getBoundingClientRect(); const b = t.getBoundingClientRect(); return { traveling: el.hasAttribute('data-traveling'), off: Math.round(Math.abs((b.x + b.width / 2) - (c.x + c.width / 2))) }; }, REST)); }
  await page.evaluate((s) => window.GH.ui.controlSettled(document.querySelector(s)), REST);
  await wait(200);
  const after = await look(REST);
  const movingWhileTravel = samples.filter((x) => x.off > 2).every((x) => x.traveling);
  check('the thumb is glass for the whole move: data-traveling until it has landed', movingWhileTravel && samples.some((x) => x.traveling), samples);
  check('then it settles: at rest, its lens off', !after.traveling && !after.lifted && (solid || after.lens.filter === 'none'), after);
  if (!contrast) check('the picked label is the accent colour', after.label === (await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--accent)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })), after.label);
}
// Reduced motion: no rise, no squash, and a short move.
if (reducedMotion) {
  const segs = await segBox();
  const cur = segs.findIndex((g) => g.on), to = (cur + 1) % segs.length;
  const t0 = Date.now();
  await gesture([[segs[to].x, segs[to].y]], { hold: 20 });
  await page.evaluate((s) => window.GH.ui.controlSettled(document.querySelector(s)), REST);
  check('reduced motion: the thumb lands within half a second', Date.now() - t0 < 900, Date.now() - t0);
}
// The switch knob: a frosted bead at rest, left where Refract's style sheet puts it; held, it rises
// into a lens.
{
  const b = await where(SUP);
  const knob = () => page.evaluate((s) => { const t = document.querySelector(s).closest('.rf-switch-track'); const th = t.querySelector('.rf-switch-thumb'); const a = getComputedStyle(th, '::after'); return { coat: parseFloat(getComputedStyle(th, '::before').opacity), body: a.content, filter: a.backdropFilter, lifted: th.hasAttribute('data-lifted'), inline: th.style.transform }; }, SUP);
  const k0 = await knob();
  await touch('touchStart', b.x, b.y, (clock = Math.max(clock + 0.05, Date.now() / 1000)));
  await wait(300);
  const k1 = await knob();
  await touch('touchCancel', b.x, b.y, clock + 0.3);
  clock += 0.3;
  await wait(900);
  const k2 = await knob();
  if (!solid) {
    check('a knob at rest is a frosted bead with its lens off, placed by the style sheet', k0.filter === 'none' && !k0.lifted && !k0.inline, k0);
    check('held, it rises into a lens', k1.lifted && k1.filter !== 'none', k1);
    check('let go, it settles back and the style sheet has it again', !k2.lifted && !k2.inline && k2.filter === 'none', k2);
  } else check('with no glass the knob is solid, held or not', k0.coat === 1 && k0.body === 'none' && k1.coat === 1, { k0, k1 });
}
// Toggle chips keep their width: the Days sheet's weekdays.
{
  await page.evaluate(() => window.GH.ui.act.daysSheet());
  await wait(900);
  const w = () => page.evaluate(() => [...document.querySelectorAll('dialog[open] [data-on="dsWd"]')].map((c) => c.offsetWidth));
  const w0 = await w();
  await page.click('dialog[open] [data-on="dsWd"][aria-pressed="false"]');
  await wait(500);
  const w1 = await w();
  check('pressing a toggle chip doesn\'t change its width', w0.join() === w1.join(), [w0, w1]);
  await page.evaluate(() => window.GH.ui.closeSheets());
  await wait(500);
}
// The tab bar: a drag along it is never taken over by the page, and ticks once per tab.
{
  await page.evaluate(() => window.GH.ui.go('today'));
  await page.evaluate(() => window.GH.ui.back && window.GH.ui.back());
  await page.evaluate(() => window.GH.ui.go('today'));
  await wait(600);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#tabbar .rf-tab')].map((t) => { const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: t.dataset.tab }; }));
  check('the bar takes every touch itself (touch-action: none)', await page.evaluate(() => getComputedStyle(document.querySelector('#tabbar .rf-tabbar-bar')).touchAction) === 'none');
  await clear();
  await gesture(line(tabs[0].x, tabs[0].y, tabs[2].x, tabs[2].y + 2, 14), { hold: 40, stepMs: 20 });
  await wait(700);
  const l = await log();
  const route = await page.evaluate(() => window.GH.ui.route.tab);
  check('dragging the lens across two tabs ticks twice and lands on the third', l.req.filter((k) => k === 'tick').length === 2 && route === tabs[2].id, { req: l.req, route });
  await page.evaluate(() => window.GH.ui.go('today'));
  await wait(500);
}
// A Settings change no longer redraws every lens map.
{
  await settings();
  await page.evaluate(() => { window.__maps = 0; const f = HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL = function (...a) { window.__maps++; return f.apply(this, a); }; window.__prefs = 0; document.addEventListener('rf:preferences', () => window.__prefs++); });
  const b = await where(SND);
  for (let k = 0; k < 4; k++) { await gesture([[b.x, b.y]], { hold: 20 }); await wait(350); }
  const n = await page.evaluate(() => ({ maps: window.__maps, prefs: window.__prefs }));
  check('flipping Sound 4 times encodes no lens maps and fires no preference changes', n.maps === 0 && n.prefs === 0, n);
}

check('no errors on the page', !errors.length, errors.slice(0, 5));
await browser.close();
await server.close();
done();
