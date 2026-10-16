// Icons in Chromium at phone size, with someone five weeks in:
// - every icon name the app asks for resolves to a glyph (U.icon draws an empty span for one it
//   doesn't know): each name in src/ (U.icon('…'), icon: '…', U.glassBtn('…'), data-icon="…"), the
//   ones What's new lists, and none left as an empty span on the main screens and the sheets the
//   tests open
// - the warm-up is the illustrated sun (U.art('sun')) on Today, on Plan (in its warm tile) and in
//   the Moves library, its gradients drawn (a warm disc read from the pixels, light and dark), from
//   one shared set of definitions however many suns a page has; its neighbours (the cool-down's
//   moon, mobility's leaf, the walk's footprints) are illustrated too
// - nothing on it animates forever, under reduced motion nothing at all, and the first sun's one turn
//   is over in a second
// - every muscle group has its glyph (U.groupIcon), drawn on Refract's grid, and the Moves library
//   shows each ladder with its group's
// Usage: node test/ui-icons.mjs [--dark] [--shots]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const SHOTS = process.argv.includes('--shots');
const OUT = join(root, 'build/icons');
if (SHOTS) mkdirSync(OUT, { recursive: true });

// Every icon name written in the source.
function sourceNames() {
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|html)$/.test(f)) files.push(p); } })(join(root, 'src'));
  const names = new Map();
  const add = (n, where) => { if (!names.has(n)) names.set(n, where); };
  const PATTERNS = [/\bicon\(\s*'([a-z0-9-]+)'/g, /\bicon:\s*'([a-z0-9-]+)'/g, /\bglassBtn\(\s*'([a-z0-9-]+)'/g, /data-icon="([a-z0-9-]+)"/g, /\bart:\s*'([a-z0-9-]+)'/g];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const re of PATTERNS) for (const m of line.matchAll(re)) add(m[1], `${f.slice(root.length + 1)}:${i + 1}`);
    });
  }
  return names;
}

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
const GROUPS = ['biceps', 'triceps', 'chest', 'legs', 'back', 'shoulders', 'abs', 'conditioning', 'mobility', 'balance', 'impact'];
const themes = process.argv.includes('--dark') ? ['dark'] : ['light', 'dark'];

for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme}: ${m.text()}`); });
  await page.addInitScript(seedBridge);
  // Counts the sun's turns (its rays' animations) in this page's life.
  await page.addInitScript(() => {
    window.__turns = 0;
    const play = Element.prototype.animate;
    Element.prototype.animate = function (k, o) { if (this.classList && this.classList.contains('gh-art-rays')) window.__turns++; return play.call(this, k, o); };
  });
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await page.waitForTimeout(1200);
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const ev = (f, a) => page.evaluate(f, a);

  if (theme === themes[0]) {
    section('Every icon name resolves');
    const names = sourceNames();
    const news = await ev(() => [...new Set((window.GH.CHANGELOG || []).flatMap((e) => (e.items || []).map((x) => x[0])))]);
    for (const n of news) if (!names.has(n)) names.set(n, 'src/data/changelog.js');
    const unknown = await ev((list) => list.filter(([n]) => !/^<svg[\s>]/.test(window.GH.ui.icon(n))), [...names.entries()]);
    check(`all ${names.size} icon names in the source and What's new draw a glyph`, names.size > 80 && unknown.length === 0, unknown.map(([n, w]) => `${n} (${w})`).join(', '));
    check('a name it doesn\'t know still draws its empty stand-in (the fallback the test above rules out)', await ev(() => /^<span[^>]*data-icon="no-such-glyph"/.test(window.GH.ui.icon('no-such-glyph'))));
  }

  // No empty stand-in left on a screen: a [data-icon] that isn't an <svg>.
  const blanks = () => ev(() => [...document.querySelectorAll('#app [data-icon]:not(svg), dialog[open] [data-icon]:not(svg)')].map((e) => e.getAttribute('data-icon')));
  section(`Screens and sheets, ${theme}`);
  for (const [name, open] of [
    ['Today', () => window.GH.ui.go('today')], ['Plan', () => window.GH.ui.go('plan')], ['Health', () => window.GH.ui.go('health')],
    ['Progress', () => window.GH.ui.go('progress')], ['You', () => window.GH.ui.go('you')], ['Settings', () => window.GH.ui.open('settings')],
    ['Moves', () => window.GH.ui.open('moves')], ['Help', () => { window.GH.ui.go('you'); window.GH.ui.act.openHelp(); }],
    ['What\'s new', () => window.GH.ui.showWhatsNew()], ['Scroll diagnostics', () => window.GH.ui.act.scrollDiag()],
  ]) {
    await ev(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* back to the tab */ } });
    await settle(500);
    await ev(open);
    await settle(1100);
    const b = await blanks();
    check(`${name}: no icon left blank`, b.length === 0, b);
  }
  await ev(() => { const U = window.GH.ui; U.closeSheets(); while (U.back()) { /* */ } U.go('today'); });
  await settle(900);

  section(`The warm-up's sun, ${theme}`);
  // The sun on screen: what it is, its parts, and the colour at the middle of its disc and of a ray
  // (read from a screenshot of it).
  const sunAt = async (sel) => {
    const info = await ev((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const parts = { glow: !!el.querySelector('.gh-art-glow'), rays: el.querySelectorAll('.gh-art-rays path').length, long: (el.querySelector('.gh-art-rays path:last-child').getAttribute('d').match(/M/g) || []).length, short: (el.querySelector('.gh-art-rays path:first-child').getAttribute('d').match(/M/g) || []).length, disc: !!el.querySelector('.gh-art-disc circle'), hi: !!el.querySelector('.gh-art-disc ellipse') };
      const refs = [...el.querySelectorAll('[fill^="url(#"], [stroke^="url(#"]')].flatMap((x) => ['fill', 'stroke'].map((a) => x.getAttribute(a) || '').filter((v) => v.startsWith('url(#')).map((v) => v.slice(5, -1)));
      return { x: r.left, y: r.top, w: r.width, h: r.height, parts, refs, missing: refs.filter((id) => !document.getElementById(id)) };
    }, sel);
    if (!info) return null;
    // Read once what moves on the page (its entrance, the sun's one turn) has finished.
    await ev(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2500))]));
    await settle(300);
    const box = await ev((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
    const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    info.px = await reader.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const at = (fx, fy) => { const d = g.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data; return [d[0], d[1], d[2]]; };
      return { disc: at(0.5, 0.56), ray: at(0.5, 0.2) };
    }, png.toString('base64'));
    return info;
  };
  // Warm: red high, blue well below it, green in between (yellow to orange).
  const warm = ([r, g, b]) => r > 200 && b < r - 90 && g > b && g <= r + 4;
  const reader = await ctx.newPage();
  const where = [
    ['Today', () => window.GH.ui.go('today'), '#screen .ex-tag.is-art .gh-art[data-art="sun"]', 22, 26],
    ['Plan', () => window.GH.ui.go('plan'), '#screen .pw-thumb.is-art .gh-art[data-art="sun"]', 38, 42],
    ['Moves', () => window.GH.ui.open('moves'), '#screen .rf-list-icon.is-art .gh-art[data-art="sun"]', 26, 30],
  ];
  for (const [name, open, sel, lo, hi] of where) {
    await ev(() => { const U = window.GH.ui; while (U.back()) { /* */ } });
    await ev(open);
    await settle(1200);
    const s = await sunAt(sel);
    check(`${name}: the warm-up shows the illustrated sun`, !!s, sel);
    if (!s) continue;
    check(`${name}: a glowing disc, a soft corona, 8 long and 8 short rays and a highlight`, s.parts.glow && s.parts.disc && s.parts.hi && s.parts.long === 8 && s.parts.short === 8, s.parts);
    check(`${name}: ${lo} to ${hi} px, crisp at its size`, s.w >= lo && s.w <= hi && Math.abs(s.w - s.h) < 0.5, `${s.w} × ${s.h}`);
    check(`${name}: its gradients are all on the page`, s.refs.length >= 4 && s.missing.length === 0, s.missing);
    check(`${name}: its disc and its rays are warm, yellow to orange (${s.px.disc}, ${s.px.ray})`, warm(s.px.disc) && warm(s.px.ray), s.px);
  }
  // The neighbours: the walk's footprints and mobility's leaf in Moves, the cool-down's moon on Today
  // (when today's workout has a cool-down).
  await ev(() => window.GH.ui.open('moves'));
  await settle(1000);
  const nb = await ev(() => ({ leaf: document.querySelectorAll('#screen .rf-list-icon.is-art .gh-art[data-art="leaf"]').length, walk: document.querySelectorAll('#screen .rf-list-icon.is-art .gh-art[data-art="walk"]').length, sun: document.querySelectorAll('#screen .gh-art[data-art="sun"]').length, plain: [...document.querySelectorAll('#screen .rf-list-icon:not(.is-art) [data-icon="leaf"], #screen .rf-list-icon:not(.is-art) [data-icon="navigate"]')].length }));
  check('Moves: mobility\'s leaf and the walk\'s footprints are illustrated too', nb.leaf >= 3 && nb.walk === 1 && nb.plain === 0, nb);
  const moon = await ev(() => { const html = window.GH.ui.sessionRows(window.GH.ui.S, { warmup: [{ name: 'Arm circles' }], items: [], mobility: [{ moveId: 'hamstring_stretch', name: 'Hamstring stretch', target: 30 }] }); return { moon: /data-art="moon"/.test(html), sun: /data-art="sun"/.test(html) }; });
  check('Today: the cool-down\'s stretches have the illustrated moon', moon.moon && moon.sun, moon);
  // Today on a light day: its walk and mobility flow are the same pictures. (Today's plan is made a
  // light day here: this person has a workout to catch up on every day from today.)
  const light = await ev(() => {
    const U = window.GH.ui, B = window.GH.brain, real = B.todayPlan;
    B.todayPlan = () => ({ type: 'light', light: { walk: false, mobility: false }, next: null });
    try {
      const box = document.createElement('div');
      box.innerHTML = U.screens.today.render(U.S, U.today());
      const card = box.querySelector('.card.light');
      return card ? { walk: !!card.querySelector('.rf-list-icon.is-art [data-art="walk"]'), leaf: !!card.querySelector('.rf-list-icon.is-art [data-art="leaf"]'), plain: card.querySelectorAll('.rf-list-icon:not(.is-art)').length } : null;
    } finally { B.todayPlan = real; }
  });
  check('Today on a light day: its walk and mobility flow are the illustrated footprints and leaf', light && light.walk && light.leaf && light.plain === 0, light);
  // Many on one page share one set of definitions.
  const shared = await ev(() => {
    const box = document.createElement('div');
    box.innerHTML = ['sun', 'sun', 'moon', 'leaf', 'walk', 'sun'].map((n) => window.GH.ui.art(n)).join('');
    document.body.appendChild(box);
    const ids = [...document.querySelectorAll('[id^="gh-art-"]')].map((e) => e.id);
    const out = { defs: document.querySelectorAll('svg.gh-art-defs').length, ids: ids.length, unique: new Set(ids).size, inArt: box.querySelectorAll('[id]').length, suns: document.querySelectorAll('.gh-art[data-art="sun"]').length };
    box.remove();
    return out;
  });
  check('any number of suns share one set of gradients: one <defs>, each id once, none inside a sun', shared.defs === 1 && shared.ids === shared.unique && shared.ids >= 10 && shared.inArt === 0 && shared.suns >= 4, shared);
  if (SHOTS) {
    for (const [name, open, sel] of where) {
      await ev(() => { const U = window.GH.ui; while (U.back()) { /* */ } });
      await ev(open);
      await settle(1200);
      await ev((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'center' }); }, sel);
      await settle(400);
      await page.screenshot({ path: join(OUT, `${theme}-${name.toLowerCase()}.png`) });
    }
  }

  section(`Motion, ${theme}`);
  await ev(() => { const U = window.GH.ui; while (U.back()) { /* */ } U.go('today'); });
  await settle(2600);
  const anims = await ev(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.gh-art')).map((a) => ({ state: a.playState, iterations: a.effect.getTiming().iterations, ms: a.effect.getTiming().duration })));
  check('nothing on the art animates forever; anything that moved has finished within its second', anims.every((a) => a.iterations !== Infinity && (a.state === 'finished' || a.ms <= 1000)), anims);
  const turns = await ev(() => window.__turns);
  check('the sun turns its rays in once at most, however many screens show it', turns <= 1, turns);
  await ev(() => window.Refract.setMotion('reduced', { persist: true }));
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await settle(2600);
  const still = await ev(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.gh-art')).length);
  check('with reduced motion the sun never moves', still === 0, still);
  await ev(() => window.Refract.setMotion('system', { persist: true }));
  await reader.close();

  if (theme === themes[0]) {
    section('Muscle groups');
    const groups = await ev((list) => list.map((g) => {
      const html = window.GH.ui.groupIcon(g);
      const box = document.createElement('div'); box.innerHTML = html; document.body.appendChild(box);
      const svg = box.querySelector('svg');
      const out = { g, svg: !!svg, name: svg && svg.getAttribute('data-icon'), grid: svg && svg.getAttribute('viewBox'), stroke: svg && svg.getAttribute('stroke-width'), shapes: svg ? svg.querySelectorAll('path, circle, rect').length : 0, sm: /data-size="sm"/.test(window.GH.ui.groupIcon(g, 'sm')) };
      if (svg) { const b = svg.getBBox(); out.box = [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10) / 10); }
      box.remove();
      return out;
    }), GROUPS);
    for (const x of groups) check(`${x.g}: its own glyph (group-${x.g}), on the 24 px grid with the 1.75 stroke, inside it`, x.svg && x.name === `group-${x.g}` && x.grid === '0 0 24 24' && x.stroke === '1.75' && x.shapes > 0 && x.sm && x.box[0] >= 2 && x.box[1] >= 2 && x.box[0] + x.box[2] <= 22 && x.box[1] + x.box[3] <= 22, x);
    check('a group it doesn\'t know gets the dumbbell', await ev(() => /data-icon="dumbbell"/.test(window.GH.ui.groupIcon('nothing'))));
    await ev(() => window.GH.ui.open('moves'));
    await settle(1100);
    const rows = await ev(() => {
      const out = {};
      let g = null;
      for (const el of document.querySelectorAll('#screen .moves-list > *')) {
        if (el.matches('.rf-list-header')) { g = el.textContent.trim().toLowerCase(); continue; }
        if (!g || !el.matches('ul.rf-list')) continue;
        out[g] = [...el.querySelectorAll('.rf-list-icon svg')].map((s) => s.getAttribute('data-icon') || `art:${s.getAttribute('data-art')}`);
      }
      return out;
    });
    const want = { biceps: 'group-biceps', triceps: 'group-triceps', chest: 'group-chest', legs: 'group-legs', back: 'group-back', shoulders: 'group-shoulders', abs: 'group-abs' };
    const wrong = Object.entries(want).filter(([g, n]) => !(rows[g] || []).some((x) => x === n));
    check('Moves: each group\'s ladders show the group\'s glyph (gym ones the dumbbell)', Object.keys(rows).length >= 7 && wrong.length === 0, { wrong, rows });
  }
  await ctx.close();
}
section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 6).join('\n      '));
await browser.close();
await server.close();
done();
