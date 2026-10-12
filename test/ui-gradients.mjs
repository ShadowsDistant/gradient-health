// The brand's gradients in Chromium at phone size, with someone five weeks in (src/styles.css, "Brand
// gradients"; the rings' paints are in src/shell.html): the main call to action on Today, in the
// player and at the end of set-up (blue into mint, its white words at 4.5:1 or more all the way
// across, read from the pixels); progress bars and rings (blue into mint, green ones from mint into
// green, amber over a target, a health number's own hue and rest's sky kept); the faint glow at the
// top of a sheet; and with increased contrast, each of them flat.
// Usage: node test/ui-gradients.mjs [--dark]
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
await page.waitForTimeout(1500);
await page.evaluate(() => window.GH.ui.closeSheets());
const wait = (ms) => page.waitForTimeout(ms);
const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const contrast = (on) => page.evaluate(([o, dk, t]) => {
  if (o) document.documentElement.setAttribute('data-theme', dk ? 'dark-contrast' : 'light-contrast');
  else if (t == null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}, [on, dark, theme0]);

// Pixels, from a screenshot read in a page of its own: each row of a box as [r, g, b] per pixel.
const reader = await ctx.newPage();
async function pixels(clip) {
  const png = await page.screenshot({ clip });
  return reader.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, rows = [];
    for (let y = 0; y < c.height; y++) { const row = []; for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; row.push([d[i], d[i + 1], d[i + 2]]); } rows.push(row); }
    return rows;
  }, png.toString('base64'));
}
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const avg = (list) => [0, 1, 2].map((k) => list.reduce((t, p) => t + p[k], 0) / list.length);
// A filled button: two rows across the height of its words (the upper one where the glass's sheen
// lightens it), from 8% to 92% of its width (inside its rounded ends). The words and the icon are
// white: anything within 4 px of a white pixel, across or up and down, is a letter or its soft edge
// and is left out, and what's left is the fill. Its colour at either end, and the least contrast
// white words have anywhere on it.
async function button(sel) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, bg: getComputedStyle(e).backgroundImage }; }, sel);
  if (!r) return null;
  const rows = await pixels({ x: r.x, y: r.y, width: r.w, height: r.h });
  const W = rows[0].length, a = Math.round(W * 0.08), b = Math.round(W * 0.92);
  const white = rows.map((row) => row.map((p) => lum(p) > 0.45));
  const clear = (x, y) => { for (let j = Math.max(0, y - 4); j <= Math.min(rows.length - 1, y + 4); j++) for (let i = Math.max(0, x - 4); i <= Math.min(W - 1, x + 4); i++) if (white[j][i]) return false; return true; };
  const fill = [];
  for (const f of [0.38, 0.55]) { const y = Math.round(rows.length * f); for (let x = a; x < b; x++) if (clear(x, y)) fill.push(rows[y][x]); }
  const least = Math.min(...fill.map((p) => 1.05 / (lum(p) + 0.05)));
  const row = rows[Math.round(rows.length * 0.55)];
  const ends = [avg(row.slice(a, a + 10)), avg(row.slice(b - 10, b))].map((p) => p.map(Math.round));
  return { gradient: /linear-gradient/.test(r.bg), least: Math.round(least * 100) / 100, left: ends[0], right: ends[1], fill: fill.length };
}
// Blue into mint from left to right: the right end has more green and less blue.
const minty = (x) => x && x.right[1] - x.left[1] >= 15 && x.left[2] - x.right[2] >= 15;
const flat = (x) => x && [0, 1, 2].every((k) => Math.abs(x.left[k] - x.right[k]) <= 4);

section('The main call to action');
let t = await button('#float .btn-main');
check('Today\'s Start workout is blue into mint', t && t.gradient && minty(t), t);
check(`its white words keep 4.5:1 or more all the way across (${t && t.least})`, t && t.fill > 100 && t.least >= 4.5, t);
// Set-up's last button takes it once the plan is ready, not while it's being worked out.
const ob = await page.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'ob-actions';
  host.innerHTML = '<button type="button" class="rf-btn rf-glass ob-go" data-variant="tinted" data-act="obGo">Start my first workout</button><button type="button" class="rf-btn rf-glass ob-go" data-variant="tinted" data-act="obGo" disabled>Start my first workout</button><button type="button" class="rf-btn rf-glass ob-go" data-variant="tinted" data-act="obNext">Continue</button>';
  document.body.appendChild(host);
  const [ready, building, next] = [...host.children].map((b) => /linear-gradient/.test(getComputedStyle(b).backgroundImage));
  host.remove();
  return { ready, building, next };
});
check('set-up\'s Start my first workout takes it, once the plan is ready (and Continue doesn\'t)', ob.ready && !ob.building && !ob.next, ob);

section('Progress');
// Bars and rings as the app draws them (U.progress, U.ring), in a box over the page.
const prog = await page.evaluate(() => {
  const U = window.GH.ui;
  const host = document.createElement('div');
  host.id = 'ghTest';
  host.style.cssText = 'position:fixed;left:16px;right:16px;top:120px;z-index:2147483000;padding:16px;display:grid;gap:12px;background:var(--bg-raised)';
  host.innerHTML = `${U.progress(1, 'plain')}${U.progress(1, 'positive', 'positive')}${U.progress(1, 'caution', 'caution')}
    <div style="display:flex;gap:16px">${U.ring(0.75, 'plain', '', 'lg')}${U.ring(0.75, 'accent', '', 'lg', 'accent')}${U.ring(0.75, 'positive', '', 'lg', 'positive')}${U.ring(0.75, 'caution', '', 'lg', 'caution')}</div>
    <div class="pl-timer">${U.ring(0.75, 'rest', '', 'lg', 'sky')}</div>`;
  document.body.appendChild(host);
  const bars = [...host.querySelectorAll('.rf-progress-fill')].map((f) => { const cs = getComputedStyle(f); return { image: cs.backgroundImage, color: cs.backgroundColor }; });
  const rings = [...host.querySelectorAll('.rf-ring-fill')].map((f) => getComputedStyle(f).stroke);
  const probe = document.createElement('i');
  probe.style.color = 'var(--caution-fill)';
  host.appendChild(probe);
  const caution = getComputedStyle(probe).color;
  probe.style.color = 'var(--hue-sky)';
  const sky = getComputedStyle(probe).color;
  const stops = [...document.querySelectorAll('#gh-paint-prog stop, #gh-paint-pos stop')].map((s) => getComputedStyle(s).stopColor);
  return { bars, rings, caution, sky, stops };
});
check('a bar is blue into mint, a green one mint into green', /linear-gradient/.test(prog.bars[0].image) && /linear-gradient/.test(prog.bars[1].image) && prog.bars[0].image !== prog.bars[1].image, prog.bars);
check('one over its target is amber, with no gradient (Refract has no colour for it)', prog.bars[2].image === 'none' && prog.bars[2].color === prog.caution, { bar: prog.bars[2], caution: prog.caution });
check('a ring is painted with the SVG gradients in the page, green ones with their own', /url\("?#gh-paint-prog"?\)/.test(prog.rings[0]) && /url\("?#gh-paint-prog"?\)/.test(prog.rings[1]) && /url\("?#gh-paint-pos"?\)/.test(prog.rings[2]), prog.rings);
check('an amber ring stays amber, and rest\'s ring in the player its sky', prog.rings[3] === prog.caution && prog.rings[4] === prog.sky, prog.rings);
check('the paints\' colours come from the theme', prog.stops.length === 4 && prog.stops.every((c) => /^rgb/.test(c)) && prog.stops[0] !== prog.stops[1], prog.stops);
// A ring three quarters full fills from the top round to the left: blue where it starts, mint at the
// bottom.
const ringEnds = async () => {
  const r = await page.evaluate(() => { const b = document.querySelector('#ghTest .rf-ring').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const rows = await pixels({ x: r.x, y: r.y, width: r.w, height: r.h });
  const n = rows.length, cx = Math.round(rows[0].length / 2), at = (y) => avg(rows[y].slice(cx - 3, cx + 4));
  // The stroke is 7 px of the ring's 72: 2 to 5 px in from its edge, 2 px a CSS px.
  return { top: avg([at(4), at(6), at(8)]).map(Math.round), bottom: avg([at(n - 5), at(n - 7), at(n - 9)]).map(Math.round) };
};
let ends = await ringEnds();
check('the ring\'s arc goes from blue at the top into mint at the bottom', ends.bottom[1] - ends.top[1] >= 15 && ends.top[2] - ends.bottom[2] >= 15, ends);
await page.evaluate(() => window.GH.ui.go('health'));
await wait(1500);
const hero = await page.evaluate(() => { const f = document.querySelector('#screen .hl-hero .rf-progress-fill'); return f ? { image: getComputedStyle(f).backgroundImage } : null; });
check('a health number\'s bar keeps its own colour', !hero || hero.image === 'none', hero);
await page.evaluate(() => window.GH.ui.go('today'));
await wait(1200);

section('A faint glow at the top of a sheet');
await page.evaluate(() => window.GH.ui.showPrivacySheet());
await wait(900);
const glowAt = async () => {
  const r = await page.evaluate(() => { const p = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop().querySelector('.gh-sheet-panel').getBoundingClientRect(); return { x: p.left, y: p.top, w: p.width }; });
  const rows = await pixels({ x: r.x, y: r.y + 4, width: r.w, height: 76 });
  const near = rows[8], far = rows[rows.length - 4]; // 8 px down, and 76 px down (past the glow)
  const tint = (row, f) => { const p = avg(row.slice(Math.round(row.length * f) - 4, Math.round(row.length * f) + 4)); return [p[2] - p[0], p[1] - p[0]]; };
  return { left: tint(near, 0.18), right: tint(near, 0.82), leftLow: tint(far, 0.18), rightLow: tint(far, 0.82), image: await page.evaluate(() => getComputedStyle([...document.querySelectorAll('dialog.gh-sheet[open]')].pop().querySelector('.gh-sheet-glass')).backgroundImage) };
};
let glow = await glowAt();
check('blue at its top left and mint at its top right, very light', (glow.image.match(/radial-gradient/g) || []).length === 2 && glow.left[0] - glow.leftLow[0] >= 3 && glow.right[1] - glow.rightLow[1] >= 3 && glow.left[0] - glow.leftLow[0] <= 24, glow);
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(700);

section('With increased contrast, flat');
await contrast(true);
await wait(400);
t = await button('#float .btn-main');
check('Start workout is one colour', t && flat(t), t);
check(`its words keep the 7:1 increased contrast promises (${t && t.least})`, t && t.least >= 7, t);
ends = await ringEnds();
check('a ring is one colour', [0, 1, 2].every((k) => Math.abs(ends.top[k] - ends.bottom[k]) <= 6), ends);
const bar = await page.evaluate(() => { const f = document.querySelector('#ghTest .rf-progress-fill'); return getComputedStyle(f).backgroundImage; });
check('a bar is one colour', (() => { const c = bar.match(/(oklab|rgba?)\([^)]*\)/g) || []; return c.length === 2 && c[0] === c[1]; })(), bar);
await page.evaluate(() => window.GH.ui.showPrivacySheet());
await wait(900);
glow = await page.evaluate(() => getComputedStyle([...document.querySelectorAll('dialog.gh-sheet[open]')].pop().querySelector('.gh-sheet-glass')).backgroundImage);
check('a sheet has no glow', glow === 'none', glow);
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(700);
await contrast(false);
await page.evaluate(() => document.getElementById('ghTest').remove());

section('The player');
await page.evaluate(() => { window.GH.ui.act.startWorkout(); });
await wait(1500);
await page.evaluate(() => { const U = window.GH.ui, a = U.S.active; const i = a.steps.findIndex((s) => s.kind === 'set' && !s.item.timed); if (i >= 0) a.idx = i; U.openPlayer(); });
await wait(1200);
t = await button('.player .pl-actions [data-act="plDone"]');
check('Done set is blue into mint', t && t.gradient && minty(t), t);
check(`its white words keep 4.5:1 or more all the way across (${t && t.least})`, t && t.fill > 200 && t.least >= 4.5, t);

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await reader.close();
await browser.close();
await server.close();
done();
