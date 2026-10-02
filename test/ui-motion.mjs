// Motion in the app, in Chromium at phone size with someone five weeks in:
// - route changes: the new page is in the screen as soon as the change returns, while the old one
//   leaves from a layer of its own beside it (.screen-exit): inert, hidden from assistive tech, its
//   ids renamed (never two of one), starting exactly where the old page was scrolled to, and gone,
//   with Refract's cleanup, once its motion ends. Push, Back and tabs move the right way, only by
//   transform and opacity; the bar's title cross-fades; route changes in quick succession leave
//   nothing behind;
// - lists (FLIP): a re-render that adds, drops or resizes a block glides the blocks after it from
//   where they were (transforms only), so nothing jumps; a dropped block fades where it was, a new
//   one rises in; more than 8 changes in one container just change; an unkeyed control is never
//   handed to another control in place;
// - U.motion.collapse, expand and exit;
// - Today's feel check folds into its summary only once the thumb has landed, and the cards after
//   it glide;
// - reduced motion: a route change is a short fade, lists change at once;
// - the lint: no keyframes in src/ui touch layout (height, width, margin, padding, top, left and the
//   like), in the source and in every animation the app starts here;
// - frames while route changes play, with the CPU slowed 4x: the motion's own (route changes through
//   the router between light stand-in pages) p95 ≤ 20 ms, best of 3; the real pages' reported with
//   the motion and with the plain swap. The first frame after a change carries the new page's own
//   render (its style, layout and paint, which ui-perf budgets) and is counted apart.
// Usage: node test/ui-motion.mjs [--dark]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const LAYOUT = /^(height|width|min-?(height|width)|max-?(height|width)|margin.*|padding.*|top|left|right|bottom|inset.*|inline-?size|block-?size)$/i;
// Keyframes that may animate a size: none so far. Add 'file: why' here for an indicator whose width
// can't be a transform.
const LINT_ALLOW = [];

/* ---------------------------------------------------------------- the lint (source) */
section('Lint: keyframes in src/ui move by transform and opacity');
{
  // Every keyframe list: the first argument of .animate(...), and any array of objects that looks
  // like keyframes (it has opacity, transform, offset or easing) wherever it's passed.
  const bad = [];
  let seen = 0;
  const dir = join(root, 'src/ui');
  const balanced = (s, i, open, close) => {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\'' || c === '"' || c === '`') { const q = c; j++; while (j < s.length && s[j] !== q) { if (s[j] === '\\') j++; j++; } continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return s.slice(i, j + 1);
    }
    return null;
  };
  const keysOf = (txt) => Array.from(txt.matchAll(/[{,]\s*['"]?([A-Za-z-]+)['"]?\s*:/g), (m) => m[1]);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const lists = [];
    for (const m of src.matchAll(/\.animate\(\s*/g)) {
      const at = m.index + m[0].length;
      const c = src[at];
      const txt = c === '[' ? balanced(src, at, '[', ']') : c === '{' ? balanced(src, at, '{', '}') : null;
      if (txt) lists.push([txt, src.slice(0, m.index).split('\n').length]);
    }
    for (const m of src.matchAll(/\[\s*\{/g)) {
      const txt = balanced(src, m.index, '[', ']');
      if (txt && /\b(opacity|transform|offset|easing)\s*:/.test(txt) && !/\b(label|title|value)\s*:/.test(txt)) lists.push([txt, src.slice(0, m.index).split('\n').length]);
    }
    for (const [txt, line] of lists) {
      seen++;
      for (const k of keysOf(txt)) {
        if (LAYOUT.test(k) && !LINT_ALLOW.some((a) => a.startsWith(`${f}:`))) bad.push(`${f}:${line} ${k}`);
      }
    }
  }
  check(`no layout properties in ${seen} keyframe lists`, bad.length === 0, bad.join(', '));
  check('the old height animation in guide.js is gone', !/height:\s*`\$\{h\}px`/.test(readFileSync(join(root, 'src/ui/guide.js'), 'utf8')));
}

/* ---------------------------------------------------------------- the page */
const server = await serveDist();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(seedBridge);
// Every animation the page starts, with the properties its keyframes touch and where (the lint's
// runtime half).
await page.addInitScript(() => {
  window.__kf = [];
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (frames, o) {
    try {
      const props = new Set();
      if (Array.isArray(frames)) { for (const f of frames) for (const p of Object.keys(f || {})) props.add(p); } else if (frames) for (const p of Object.keys(frames)) props.add(p);
      ['offset', 'easing', 'composite'].forEach((p) => props.delete(p));
      const where = this.closest ? (this.closest('#screen') ? 'screen' : this.closest('.screen-exit') ? 'exit' : this.closest('#topbar') ? 'bar' : this.closest('#float') ? 'float' : this.closest('#tabbar') ? 'tabbar' : 'other') : 'other';
      window.__kf.push({ props: Array.from(props), where, cls: String(this.className && this.className.baseVal != null ? this.className.baseVal : this.className || this.tagName).slice(0, 40) });
    } catch (e) { /* only a record */ }
    return orig.call(this, frames, o);
  };
});
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
// The 3D figure warms up a few seconds after launch (heavy on the main thread); start after it.
await page.waitForFunction(() => window.GH.figure3d, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const wait = (ms) => page.waitForTimeout(ms);
const settle = async (ms = 150) => { await page.evaluate(() => window.GH.ui.motion.settled()); await wait(ms); };
await page.evaluate(() => {
  const U = window.GH.ui;
  // Helpers in the page: boxes, every animation on an element and its keyframes, pausing them all at
  // their start (what the first frame of a change shows), and ids that appear twice.
  window.__m = {
    box: (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10, h: Math.round(r.height) }; },
    anims: (el) => (el ? el.getAnimations().filter((a) => !a.transitionProperty && !a.animationName) : []),
    frames: (a) => a.effect.getKeyframes(),
    props: (a) => { const s = new Set(); for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) s.add(p); return Array.from(s); },
    // A glide (FLIP): a move by transform alone (a block rising in fades too).
    glides: (el) => (el ? el.getAnimations().filter((a) => !a.transitionProperty && !a.animationName && window.__m.props(a).join() === 'transform').length : 0),
    pauseAll: () => { const list = document.getAnimations().filter((a) => !a.transitionProperty && !a.animationName); for (const a of list) { a.pause(); a.currentTime = 0; } return list; },
    playAll: (list) => { for (const a of list) a.play(); },
    dupIds: () => { const m = new Map(); for (const el of document.querySelectorAll('[id]')) m.set(el.id, (m.get(el.id) || 0) + 1); return Array.from(m).filter(([, n]) => n > 1).map(([k]) => k); },
    leftovers: () => ({ exit: document.querySelectorAll('.screen-exit').length, copies: document.querySelectorAll('.motion-copy').length, leaving: document.querySelectorAll('.motion-leaving').length, fading: document.querySelectorAll('[data-fading]').length }),
  };
  // A test page of plain cards, for lists: window.__items in order, window.__h their heights.
  window.__items = [1, 2, 3, 4, 5];
  window.__h = {};
  window.__extra = '';
  U.screens.__motion = {
    render: () => `${U.navbar('Motion', '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">Motion</h1><div class="section" id="mSec">${window.__items.map((k) => `<div class="card" data-key="m${k}" id="m${k}" style="height:${window.__h[k] || 64}px;box-sizing:border-box">Card ${k}</div>`).join('')}</div>${window.__extra}`,
  };
});
const baseDups = new Set(await page.evaluate(() => window.__m.dupIds()));

/* ---------------------------------------------------------------- route changes */
section('A tab change');
{
  const r = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const screen = document.getElementById('screen');
    const old = screen.querySelector('[data-key="streak"]') || screen.firstElementChild;
    const BEH = '.rf-segmented, .rf-switch, .rf-slider, .rf-stepper, .rf-chip, .rf-glass, .rf-navbar, .rf-scroll-edge, .rf-search, .rf-pagedots, .rf-activity, .rf-tabbar, .gh-chipseg';
    const behaviours = Array.from(screen.querySelectorAll(BEH));
    const destroyed = new Set();
    const R = window.Refract, d0 = R.destroy;
    R.destroy = (el) => { destroyed.add(el); return d0(el); };
    U.go('plan');
    const sync = { view: screen.dataset.view, newIn: !!screen.querySelector('.rf-large-title') && screen.querySelector('.rf-large-title').textContent.trim(), oldOut: !screen.contains(old) };
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
    const layer = document.querySelector('.screen-exit');
    const out = { sync, layer: !!layer };
    if (layer) {
      const la = m.anims(layer), sa = m.anims(screen);
      out.sibling = screen.nextElementSibling === layer;
      out.holdsOld = layer.contains(old);
      out.inert = layer.inert && layer.getAttribute('aria-hidden') === 'true';
      out.shared = Array.from(layer.querySelectorAll('[id]')).filter((el) => document.querySelectorAll(`[id="${CSS.escape(el.id)}"]`).length > 1).map((el) => el.id);
      out.layerProps = Array.from(new Set(la.flatMap(m.props))).sort();
      out.screenProps = Array.from(new Set(sa.flatMap(m.props))).sort();
      const lt = la.find((a) => m.props(a).includes('transform')), st = sa.find((a) => m.props(a).includes('transform'));
      out.layerTo = lt ? m.frames(lt).slice(-1)[0].transform : null;
      out.screenFrom = st ? m.frames(st)[0].transform : null;
      out.ms = st ? st.effect.getTiming().duration : null;
      out.title = document.querySelector('#topbar .rf-navbar-title').textContent;
    }
    await U.motion.settled();
    await new Promise((res) => setTimeout(res, 100));
    R.destroy = d0;
    out.after = m.leftovers();
    out.oldGone = !old.isConnected;
    out.cleaned = behaviours.length ? behaviours.filter((el) => destroyed.has(el)).length / behaviours.length : 1;
    out.behaviours = behaviours.length;
    const cs = getComputedStyle(screen);
    out.rest = cs.opacity === '1' && cs.transform === 'none';
    return out;
  });
  check('the new page is in the screen as soon as the change returns', r.sync.view === 'plan' && r.sync.newIn === 'Plan' && r.sync.oldOut, r.sync);
  check('the old page leaves from a layer beside the screen', r.layer && r.sibling && r.holdsOld, r);
  check('the layer is inert and hidden from assistive tech', r.inert === true);
  check('no id in the layer is used anywhere else', r.shared && r.shared.length === 0, r.shared);
  check('both move by transform and opacity only', r.layerProps && r.layerProps.join() === 'opacity,transform' && r.screenProps.join() === 'opacity,transform', `${r.layerProps} / ${r.screenProps}`);
  check('a tab to the right: the old page shifts 12 px left, the new one comes from 12 px right', /translateX\(-12px\)/.test(r.layerTo) && /translateX\(12px\)/.test(r.screenFrom), `${r.layerTo} / ${r.screenFrom}`);
  check('a tab change takes about 240 ms', r.ms >= 200 && r.ms <= 280, r.ms);
  check('the bar has the new title', r.title === 'Plan', r.title);
  check('when it ends the layer is gone, with nothing left over', r.after.exit === 0 && r.after.copies === 0 && r.after.fading === 0 && r.oldGone, r.after);
  check('Refract cleans up the old page\'s controls', r.behaviours === 0 || r.cleaned === 1, `${Math.round(r.cleaned * 100)}% of ${r.behaviours}`);
  check('the new page rests in place', r.rest);
}

section('Push, Back, and where the old page starts');
{
  await page.evaluate(() => window.GH.ui.go('you'));
  await settle();
  const push = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    U.open('settings');
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
    const layer = document.querySelector('.screen-exit'), screen = document.getElementById('screen');
    const lt = m.anims(layer).find((a) => m.props(a).includes('transform')), st = m.anims(screen).find((a) => m.props(a).includes('transform'));
    const out = { to: lt && m.frames(lt).slice(-1)[0].transform, from: st && m.frames(st)[0].transform, ms: st && st.effect.getTiming().duration, view: screen.dataset.view };
    await U.motion.settled();
    return out;
  });
  check('a push: the old page goes a third of the way left, the new one comes from 36 px right', /translateX\(-30%\)/.test(push.to) && /translateX\(36px\)/.test(push.from), `${push.to} / ${push.from}`);
  check('a push takes about 300 ms', push.ms >= 260 && push.ms <= 340, push.ms);
  await wait(200);
  const pop = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const screen = document.getElementById('screen');
    screen.scrollTop = 420;
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    // A row in sight: where it is on screen before Back.
    const row = Array.from(screen.querySelectorAll('.rf-list-row')).find((el) => { const b = el.getBoundingClientRect(); return b.top > 200 && b.bottom < 700; });
    const before = m.box(row);
    U.back();
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
    const layer = document.querySelector('.screen-exit');
    const list = m.pauseAll();
    const at0 = m.box(row);
    const lt = m.anims(layer).find((a) => m.props(a).includes('transform')), st = m.anims(screen).find((a) => m.props(a).includes('transform'));
    const out = { before, at0, inLayer: layer && layer.contains(row), to: lt && m.frames(lt).slice(-1)[0].transform, from: st && m.frames(st)[0].transform, view: screen.dataset.view };
    m.playAll(list);
    await U.motion.settled();
    return out;
  });
  check('Back: the old page goes 36 px right, the one under it comes from a third of the way left', /translateX\(36px\)/.test(pop.to) && /translateX\(-30%\)/.test(pop.from), `${pop.to} / ${pop.from}`);
  check('the old page starts exactly where it was scrolled to', pop.inLayer && Math.abs(pop.before.top - pop.at0.top) <= 1 && Math.abs(pop.before.left - pop.at0.left) <= 1, `${JSON.stringify(pop.before)} → ${JSON.stringify(pop.at0)}`);
  check('Back lands on You', pop.view === 'you', pop.view);
}

section('The bar\'s title cross-fades');
{
  await page.evaluate(() => window.GH.ui.go('health'));
  await settle();
  const r = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const screen = document.getElementById('screen'), bar = document.getElementById('topbar');
    screen.scrollTop = 700;
    await new Promise((res) => setTimeout(res, 500));
    const was = { scrolled: bar.hasAttribute('data-scrolled'), title: bar.querySelector('.rf-navbar-title').textContent };
    U.open('settings');
    const copy = Array.from(bar.querySelectorAll('.motion-copy')).find((c) => c.classList.contains('rf-navbar-title'));
    const title = bar.querySelector(':scope > .rf-navbar-title');
    const out = { was, copy: copy ? copy.textContent : null, copyInert: copy ? copy.inert : null, copyFades: copy ? m.anims(copy).some((a) => m.frames(a).slice(-1)[0].opacity === '0' || m.frames(a).slice(-1)[0].opacity === 0) : false, now: title.textContent };
    // The new page is at its top: its title isn't shown, and doesn't fade out with the new words.
    out.titleRunning = title.getAnimations().filter((a) => a.playState === 'running' && a.transitionProperty === 'opacity').length;
    await U.motion.settled();
    await new Promise((res) => setTimeout(res, 100));
    out.left = bar.querySelectorAll('.motion-copy').length;
    return out;
  });
  check('the old title was showing (the page was scrolled)', r.was.scrolled && r.was.title === 'Health', r.was);
  check('a copy of the old title fades out where it was', r.copy === 'Health' && r.copyInert && r.copyFades, r);
  check('the bar has the new title at once, not fading out', r.now === 'Settings' && r.titleRunning === 0, r);
  check('the copies are gone once it ends', r.left === 0, r.left);
  await page.evaluate(() => window.GH.ui.back());
  await settle();
}

section('Route changes in quick succession');
{
  const r = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const pause = (ms) => new Promise((res) => setTimeout(res, ms));
    let most = 0;
    const count = () => { most = Math.max(most, document.querySelectorAll('.screen-exit').length); };
    U.go('plan'); U.go('health'); count();
    await pause(30); count();
    U.open('settings'); await pause(10); count();
    U.back(); await pause(60); count();
    U.go('you'); await pause(5); count();
    U.open('settings'); U.back(); await pause(120); count();
    U.go('today'); await Promise.resolve(); count();
    await U.motion.settled();
    await pause(150);
    const screen = document.getElementById('screen');
    const cs = getComputedStyle(screen);
    return { most, left: m.leftovers(), view: screen.dataset.view, kids: screen.childElementCount, rest: cs.opacity === '1' && cs.transform === 'none', dups: m.dupIds() };
  });
  check('at most two old pages on screen at once', r.most <= 2, r.most);
  check('nothing is left over (layers, copies, leaving blocks, fading glass)', Object.values(r.left).every((n) => n === 0), r.left);
  check('the last route wins and rests in place', r.view === 'today' && r.kids > 0 && r.rest, r);
  check('no id appears twice', r.dups.every((d) => baseDups.has(d)), r.dups);
}

/* ---------------------------------------------------------------- lists */
section('Lists glide (FLIP)');
{
  await page.evaluate(() => window.GH.ui.open('__motion'));
  await settle();
  // A card in: the ones after it glide down from where they were, and it rises in.
  const ins = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const ids = [2, 3, 4, 5];
    const before = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    window.__items = [1, 9, 2, 3, 4, 5];
    U.render();
    const list = m.pauseAll();
    const at0 = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    const glides = ids.map((k) => m.glides(document.getElementById(`m${k}`)));
    const nine = document.getElementById('m9');
    const rise = m.anims(nine)[0];
    const out = { before, at0, glides, riseProps: rise ? m.props(rise).sort().join() : null, riseFrom: rise ? Number(m.frames(rise)[0].opacity) : null, props: Array.from(new Set(list.flatMap(m.props))).sort().join() };
    m.playAll(list);
    await U.motion.settled();
    out.after = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    return out;
  });
  const still = (a, b) => Object.keys(a).every((k) => Math.abs(a[k].top - b[k].top) <= 1);
  check('a card added: nothing jumps in the first frame', still(ins.before, ins.at0), JSON.stringify(ins.at0));
  check('the cards after it each glide', ins.glides.every((n) => n === 1), ins.glides);
  check('the new card rises in (fading from 0)', ins.riseFrom === 0 && /opacity/.test(ins.riseProps), ins.riseProps);
  check('they all move by transform and opacity only', ins.props === 'opacity,transform', ins.props);
  check('and land below the new card', Object.keys(ins.before).every((k) => ins.after[k].top > ins.before[k].top + 40), JSON.stringify(ins.after));

  // A card out: it fades where it was, out of the flow, and the ones after it glide up.
  const out = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const three = document.getElementById('m3');
    const ids = [4, 5];
    const before = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    const b3 = m.box(three);
    window.__items = [1, 9, 2, 4, 5];
    U.render();
    const list = m.pauseAll();
    const at0 = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    const cs = getComputedStyle(three);
    const r = { before, at0, b3, a3: m.box(three), pinned: cs.position === 'absolute', leaving: three.classList.contains('motion-leaving') && three.inert, fades: m.anims(three).some((a) => Number(m.frames(a).slice(-1)[0].opacity) === 0), glides: ids.map((k) => m.glides(document.getElementById(`m${k}`))), renamed: !document.getElementById('m3') };
    // A re-render while it's still leaving passes it by (five cards, and the one leaving).
    m.playAll(list);
    U.render();
    r.stillOne = document.querySelectorAll('#mSec > .card').length;
    await U.motion.settled();
    await new Promise((res) => setTimeout(res, 50));
    r.gone = !three.isConnected;
    r.after = Object.fromEntries(ids.map((k) => [k, m.box(document.getElementById(`m${k}`))]));
    return r;
  });
  check('a card removed: nothing jumps in the first frame', still(out.before, out.at0) && Math.abs(out.b3.top - out.a3.top) <= 1, `${JSON.stringify(out.at0)} ${JSON.stringify(out.a3)}`);
  check('it\'s pinned where it was, out of the flow and inert', out.pinned && out.leaving, out);
  check('its id is renamed while it leaves', out.renamed);
  check('it fades out, and the cards after it glide up', out.fades && out.glides.every((n) => n === 1), out);
  check('a re-render while it leaves doesn\'t bring it back or drop the rest', out.stillOne === 6, out.stillOne);
  check('then it\'s gone and the others have closed up', out.gone && Object.keys(out.before).every((k) => out.after[k].top < out.before[k].top - 40), JSON.stringify(out.after));

  // A card that only grows: the ones after it glide down.
  const grow = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const before = m.box(document.getElementById('m4'));
    window.__h[2] = 160;
    U.render();
    const list = m.pauseAll();
    const at0 = m.box(document.getElementById('m4'));
    const glides = m.glides(document.getElementById('m4'));
    m.playAll(list);
    await U.motion.settled();
    return { before, at0, glides, after: m.box(document.getElementById('m4')) };
  });
  check('a card that grows: the ones after it glide down, nothing jumps', grow.glides === 1 && Math.abs(grow.before.top - grow.at0.top) <= 1 && grow.after.top > grow.before.top + 80, grow);

  // More than 8 changes in one container: it just changes.
  const many = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const old = document.getElementById('m1');
    window.__items = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    U.render();
    const glides = Array.from(document.querySelectorAll('#mSec > .card')).filter((el) => m.glides(el)).length;
    const r = { oldGone: !old.isConnected, leaving: document.querySelectorAll('.motion-leaving').length, glides };
    await U.motion.settled();
    return r;
  });
  check('more than 8 changes: no glides, and what\'s removed goes at once', many.oldGone && many.leaving === 0 && many.glides === 0, many);

  // Unkeyed controls in the same place: a different control gets a node of its own.
  const ctl = await page.evaluate(async () => {
    const U = window.GH.ui;
    const seg = (name) => `<div class="rf-segmented" data-size="sm" aria-label="T"><label class="rf-segment"><input type="radio" name="${name}" value="a" checked>A</label><label class="rf-segment"><input type="radio" name="${name}" value="b">B</label></div>`;
    const sw = (on) => `<ul class="rf-list"><label class="rf-list-row rf-switch" data-layout="row"><span class="rf-list-text"><span class="rf-list-title">S</span></span><span class="rf-switch-track"><input type="checkbox" role="switch" data-on="${on}"><span class="rf-switch-thumb"></span></span></label></ul>`;
    window.__items = [1];
    window.__extra = `<div class="section" id="mCtl">${seg('__mA')}${sw('__mX')}</div>`;
    U.render();
    await new Promise((res) => setTimeout(res, 50));
    // (A control that's replaced may stay a moment, leaving: it fades where it was.)
    const q = (sel) => document.querySelector(`#mCtl ${sel}:not(.motion-leaving)`);
    const gone = (el) => !el.isConnected || !!el.closest('.motion-leaving');
    const a = { seg: q('.rf-segmented'), sw: q('.rf-switch') };
    U.render();
    const same = q('.rf-segmented') === a.seg && q('.rf-switch') === a.sw;
    window.__extra = `<div class="section" id="mCtl">${seg('__mB')}${sw('__mY')}</div>`;
    U.render();
    const b = { seg: q('.rf-segmented'), sw: q('.rf-switch') };
    const r = { same, newSeg: b.seg !== a.seg && gone(a.seg), newSw: b.sw !== a.sw && gone(a.sw), name: b.seg.querySelector('input').name, on: b.sw.querySelector('input').dataset.on };
    window.__extra = '';
    U.render();
    await U.motion.settled();
    return r;
  });
  check('the same control keeps its node', ctl.same);
  check('another segmented control in its place gets a node of its own', ctl.newSeg && ctl.name === '__mB', ctl);
  check('another switch in its place gets a node of its own', ctl.newSw && ctl.on === '__mY', ctl);
}

section('Collapse, expand and exit');
{
  await page.evaluate(async () => { window.__items = [1, 2, 3, 4, 5]; window.__h = {}; window.GH.ui.render(); await window.GH.ui.motion.settled(); });
  const col = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const two = document.getElementById('m2'), four = document.getElementById('m4');
    const before = m.box(four);
    const p = U.motion.collapse(two);
    const first = { fades: m.anims(two).some((a) => Number(m.frames(a).slice(-1)[0].opacity) === 0), props: m.anims(two).flatMap(m.props).sort().join(), ms: m.anims(two)[0] ? m.anims(two)[0].effect.getTiming().duration : null };
    await new Promise((res) => setTimeout(res, 60));
    first.stillThere = two.isConnected && Math.abs(m.box(four).top - before.top) <= 1;
    await p;
    const r = { first, gone: !two.isConnected, glides: m.glides(four) };
    const list = m.pauseAll();
    r.at0 = m.box(four);
    m.playAll(list);
    await U.motion.settled();
    r.after = m.box(four);
    r.before = before;
    return r;
  });
  check('collapse: it fades and shrinks first, by transform and opacity', col.first.fades && /opacity/.test(col.first.props) && /transform/.test(col.first.props) && !/height|width|margin|padding|top|left/.test(col.first.props), col.first);
  check('collapse takes about 180 ms', col.first.ms >= 150 && col.first.ms <= 220, col.first.ms);
  check('while it fades, nothing else moves', col.first.stillThere);
  check('then it goes and the cards after it glide up, without a jump', col.gone && col.glides === 1 && Math.abs(col.at0.top - col.before.top) <= 1 && col.after.top < col.before.top - 40, col);

  const chg = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const one = document.getElementById('m1');
    let called = 0;
    await U.motion.collapse(one, () => { called++; window.__h[1] = 48; U.render(); });
    return { called, same: document.getElementById('m1') === one, fadesIn: m.anims(one).some((a) => Number(m.frames(a)[0].opacity) === 0), h: one.offsetHeight };
  });
  check('collapse with a change: the change runs once, the block stays and fades in as the smaller one', chg.called === 1 && chg.same && chg.fadesIn && chg.h === 48, chg);
  await settle();

  const exp = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const sec = document.getElementById('mSec'), four = document.getElementById('m4');
    const before = m.box(four);
    const el = document.createElement('div');
    el.className = 'card'; el.id = 'mX'; el.style.height = '90px'; el.style.boxSizing = 'border-box'; el.textContent = 'New';
    const p = U.motion.expand(el, sec, document.getElementById('m3'));
    const list = m.pauseAll();
    const r = { inNow: el.parentNode === sec && el.nextElementSibling === document.getElementById('m3'), at0: m.box(four), before, fromZero: m.anims(el).some((a) => Number(m.frames(a)[0].opacity) === 0), glides: m.glides(four) };
    m.playAll(list);
    await p;
    await U.motion.settled();
    r.after = m.box(four);
    el.remove();
    U.render();
    await U.motion.settled();
    return r;
  });
  check('expand: it\'s in at once, fading in from nothing', exp.inNow && exp.fromZero, exp);
  check('expand: the cards after it glide down to make room, without a jump', exp.glides === 1 && Math.abs(exp.at0.top - exp.before.top) <= 1 && exp.after.top > exp.before.top + 60, exp);

  const ex = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const three = document.getElementById('m3'), five = document.getElementById('m5');
    const before = m.box(five);
    const p = U.motion.exit(three);
    const r = { pinned: getComputedStyle(three).position === 'absolute' && three.inert, glides: m.glides(five) };
    await p;
    await U.motion.settled();
    r.gone = !three.isConnected;
    r.after = m.box(five);
    r.before = before;
    return r;
  });
  check('exit: out of the flow at once, the cards after it glide up, then it\'s gone', ex.pinned && ex.glides === 1 && ex.gone && ex.after.top < ex.before.top - 40, ex);
  await page.evaluate(async () => { window.__items = [1, 2, 3, 4, 5]; window.__h = {}; window.GH.ui.render(); await window.GH.ui.motion.settled(); });
}

/* ---------------------------------------------------------------- Today's feel check */
section('The feel check folds once its thumb has landed');
{
  // Both answered, opened again with Change: the last answer moves a thumb that's already there.
  await page.evaluate(async () => {
    const U = window.GH.ui;
    U.go('today');
    await U.motion.settled();
    U.S.feel[U.today()] = { energy: 'ok', sore: 'some' };
    U.render();
    await U.motion.settled();
  });
  await page.click('#screen [data-act="feelEdit"]');
  await wait(600);
  await page.evaluate(() => document.querySelector('#screen [data-key="feel"]').scrollIntoView({ block: 'center' }));
  await wait(500);
  await page.evaluate(() => {
    const U = window.GH.ui, m = window.__m;
    window.__fold = { renders: [] };
    const card = document.querySelector('#screen [data-key="feel"]');
    const col = U.motion.collapse;
    U.motion.collapse = (el, change) => {
      window.__fold.at = performance.now();
      window.__fold.moving = !!card.querySelector('[data-traveling]');
      window.__fold.card = el === card;
      return col(el, change);
    };
    // Each render while it folds: where the cards after the feel check were just before it, and where
    // the first frame after it shows them.
    const render = U.render;
    U.render = (...a) => {
      const after = Array.from(document.querySelectorAll('#screen .section > [data-key]'));
      const i = after.findIndex((el) => el.dataset.key === 'feel');
      const later = after.slice(i + 1);
      const b = later.map(m.box);
      const res = render(...a);
      const list = m.pauseAll();
      const a0 = later.map(m.box);
      window.__fold.renders.push({ jump: Math.max(0, ...later.map((el, k) => Math.abs(b[k].top - a0[k].top))), glides: later.filter((el) => m.glides(el)).length, n: later.length, done: !!document.querySelector('#screen .feel-done') });
      m.playAll(list);
      return res;
    };
    window.__fold.restore = () => { U.render = render; U.motion.collapse = col; };
  });
  const t0 = await page.evaluate(() => performance.now());
  await page.click('#screen [data-on="feelSore"] .rf-segment:nth-of-type(1)');
  await wait(120);
  const early = await page.evaluate(() => !!document.querySelector('#screen [data-on="feelSore"]'));
  await wait(1200);
  const f = await page.evaluate(() => { const x = window.__fold; x.restore(); return { at: x.at, moving: x.moving, card: x.card, renders: x.renders, done: !!document.querySelector('#screen .feel-done') }; });
  const folded = f.renders.find((x) => x.done);
  check('the questions stay while the thumb moves', early);
  check('it folds once the thumb has landed (within about half a second)', f.card && f.moving === false && f.at - t0 > 200 && f.at - t0 < 1200, `${Math.round(f.at - t0)} ms, still moving: ${f.moving}`);
  check('it folds into its summary', f.done);
  check('the cards after it don\'t jump: they glide', folded && folded.jump <= 1 && (folded.n === 0 || folded.glides > 0 || folded.jump === 0), folded);
  await page.evaluate(() => { const U = window.GH.ui; U.S.feel[U.today()] = { energy: 'good', sore: 'some' }; U.render(); });
  await settle();
}

/* ---------------------------------------------------------------- reduced motion */
section('Reduced motion');
{
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await wait(100);
  const r = await page.evaluate(async () => {
    const U = window.GH.ui, m = window.__m;
    const screen = document.getElementById('screen');
    U.go('plan');
    await Promise.resolve();
    await new Promise((res) => setTimeout(res, 0));
    const sa = m.anims(screen);
    const out = { layer: document.querySelectorAll('.screen-exit').length, props: Array.from(new Set(sa.flatMap(m.props))).join(), ms: sa[0] ? sa[0].effect.getTiming().duration : 0 };
    await U.motion.settled();
    U.open('__motion');
    await U.motion.settled();
    const three = document.getElementById('m3');
    window.__items = [1, 2, 4, 5, 6];
    U.render();
    out.listAnims = Array.from(document.querySelectorAll('#mSec > .card')).filter((el) => m.anims(el).length).length;
    out.removedNow = !three.isConnected;
    const two = document.getElementById('m2');
    const p = U.motion.collapse(two);
    out.collapseProps = m.anims(two).flatMap(m.props).join();
    out.collapseMs = m.anims(two)[0] ? m.anims(two)[0].effect.getTiming().duration : 0;
    await p;
    out.collapsed = !two.isConnected;
    window.__items = [1, 2, 3, 4, 5];
    U.back();
    await U.motion.settled();
    U.go('today');
    await U.motion.settled();
    return out;
  });
  check('a route change: no exit layer, a short fade (opacity only)', r.layer === 0 && (r.props === '' || r.props === 'opacity') && r.ms <= 150, r);
  check('lists change at once: no glides, removed blocks go at once', r.listAnims === 0 && r.removedNow, r);
  check('collapse: a short fade only, then it goes', r.collapseProps === 'opacity' && r.collapseMs <= 150 && r.collapsed, r);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await wait(100);
}

/* ---------------------------------------------------------------- the lint (runtime) */
section('Lint: every animation started here moves by transform and opacity');
{
  const kf = await page.evaluate(() => window.__kf);
  const mine = kf.filter((k) => ['screen', 'exit', 'bar', 'float'].includes(k.where));
  const bad = mine.filter((k) => k.props.some((p) => LAYOUT.test(p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))));
  const other = Array.from(new Set(mine.flatMap((k) => k.props))).filter((p) => !['opacity', 'transform'].includes(p));
  check(`${mine.length} animations on the page, the bar and the floating buttons: none animates layout`, bad.length === 0, bad.slice(0, 5));
  check('and they animate only transform and opacity', other.length === 0, other);
}

/* ---------------------------------------------------------------- frames */
// The motion's own frames: route changes through the real router (tab cross-fades with the bar's
// buttons changing, pushes and Back, the floating buttons) between light stand-in pages, plain cards
// with no entrances or drawing of their own, so what costs the frames is the motion alone. Then the
// real tabs and pages, with the motion and with the plain swap it replaced, side by side: there each
// page's own work (its render's layout and paint, its CSS entrances, Plan drawing its thumbnails)
// shares those frames, the same with the motion or without it, so those numbers are reported, not
// budgeted. Each route change starts with a pointerdown, as a tap's does (work that waits for the
// person to stop touching the screen waits here too).
section('Frames while route changes play (CPU 4x slower, best of 3)');
{
  const cdp = await ctx.newCDPSession(page);
  const p95 = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
  // In the page: run the steps, and collect the first frame of each (the new page's own render)
  // apart from the frames after it, while the motion plays.
  const play = (steps) => page.evaluate(async (steps) => {
    const U = window.GH.ui;
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    const motion = [], first = [];
    // Someone moving around the app keeps touching it: work that waits for them to stop (Plan's
    // thumbnails drawing 3D stills, each a long task here with WebGL in software) keeps waiting.
    const touching = setInterval(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), 150);
    for (const [how, a] of steps) {
      await frame();
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      const t0 = performance.now();
      if (how === 'go') U.go(a); else if (how === 'open') U.open(a); else U.back();
      let last = await frame();
      first.push(last - t0);
      const end = last + 340;
      while (last < end) { const t = await frame(); motion.push(t - last); last = t; }
      await U.motion.settled();
      await new Promise((res) => setTimeout(res, 250));
    }
    clearInterval(touching);
    return { motion, first };
  }, steps);
  // Light stand-ins for Today and Plan (and two pages to push), with bars that differ.
  await page.evaluate(async () => {
    const U = window.GH.ui;
    const cards = (n, tag) => Array.from({ length: n }, (_, i) => `<div class="card" data-key="${tag}${i}"><p class="t-headline">${tag} ${i}</p><p class="t-footnote rf-muted">Two lines of words to lay out and paint, as a card on a phone this wide has.</p></div>`).join('');
    window.__real = {};
    const light = (id, title, n, trailing) => {
      window.__real[id] = U.screens[id];
      U.screens[id] = { render: () => `${U.navbar(title, trailing ? U.glassBtn('sliders', 'Settings', 'openSettings') : '')}<h1 class="rf-large-title">${title}</h1><div class="section">${cards(n, id)}</div>`, float: () => `<button type="button" class="rf-btn rf-glass btn-main" data-variant="tinted" data-size="lg" data-lens data-act="goToday">${U.icon('play')}Go</button>` };
    };
    light('today', 'Light A', 10, false);
    light('plan', 'Light B', 10, true);
    U.screens.__la = { render: () => `${U.navbar('Light C', '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">Light C</h1><div class="section">${cards(10, 'c')}</div>` };
    U.go('today');
    await U.motion.settled();
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await wait(500);
  // Pushes and Back (the old page sliding off, the bar's buttons swapping, the floating button going
  // and coming back) are the motion alone. A tab change also glides the tab bar's lens, on a spring
  // that restyles the bar every frame (Refract's), so tab changes are reported beside them.
  const PUSHES = [['open', '__la'], ['back'], ['open', '__la'], ['back']];
  const TABS = [['go', 'plan'], ['go', 'today'], ['go', 'plan'], ['go', 'today']];
  const to = (tab) => page.evaluate(async (t) => { window.GH.ui.go(t); await window.GH.ui.motion.settled(); await new Promise((res) => setTimeout(res, 300)); }, tab);
  const light = [];
  for (let i = 0; i < 3; i++) {
    // From each stand-in tab (one with a floating button, one with a bar button).
    const a = await play(PUSHES);
    await to('plan');
    const b = await play(PUSHES);
    await to('today');
    const motion = a.motion.concat(b.motion), first = a.first.concat(b.first);
    light.push(p95(motion));
    console.log(`  light pages, pushes and Back, run ${i + 1}: p95 ${p95(motion).toFixed(1)} ms over ${motion.length} frames (max ${Math.max(...motion).toFixed(1)}); first frames ${first.map((x) => Math.round(x)).join(', ')} ms`);
  }
  const tabs = await play(TABS);
  console.log(`  light pages, tab changes: p95 ${p95(tabs.motion).toFixed(1)} ms over ${tabs.motion.length} frames; first frames ${tabs.first.map((x) => Math.round(x)).join(', ')} ms`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.evaluate(async () => {
    const U = window.GH.ui;
    for (const [id, scr] of Object.entries(window.__real)) U.screens[id] = scr;
    U.go('today');
    await U.motion.settled();
    U.render();
  });
  await wait(800);
  check('the motion\'s frames: p95 ≤ 20 ms while route changes play', Math.min(...light) <= 20, `${Math.min(...light).toFixed(1)} ms`);

  // The real pages: reported, the motion and the plain swap side by side.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await wait(500);
  const REAL = [['go', 'plan'], ['go', 'health'], ['go', 'you'], ['open', 'settings'], ['back'], ['go', 'progress'], ['go', 'today']];
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  for (const mode of ['motion', 'plain']) {
    // The plain swap: core.js drops the old page and puts the new one in, with no motion at all.
    if (mode === 'plain') await page.evaluate(() => { window.__swap = window.GH.ui.motion.routeSwap; window.GH.ui.motion.routeSwap = undefined; });
    const r = await play(REAL);
    if (mode === 'plain') await page.evaluate(() => { window.GH.ui.motion.routeSwap = window.__swap; });
    console.log(`  real pages, ${mode}: frames p95 ${p95(r.motion).toFixed(1)} ms, median ${median(r.motion).toFixed(1)} ms; first frames ${r.first.map((x) => Math.round(x)).join(', ')} ms (median ${Math.round(median(r.first))})`);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
await server.close();
done();
