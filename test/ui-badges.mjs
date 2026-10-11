// The badge gallery, detail sheet, reveal and share card, in Chromium at phone size: the first 1.6
// load (history earns its badges, all seen and opened), the You tab's card, the gallery with its
// filter, a badge's sheet, a workout that earns one, sealed (the player's own card with its capsule,
// then the reveal: three taps open it, wobble, crack and burst, each with its haptic, moving only by
// transform and opacity, the capsule bobbing only while it's on screen); several at once page with
// Refract's page dots, which follow the page however it's turned, and several sealed ones offer Open
// all; a toast for one earned elsewhere, which opens it; a sealed one in the gallery and on the You
// tab, opened from there; no checks while the player is open; the share card: a 1080×1350 PNG with no
// name unless it's turned on, handed to the Android bridge (or downloaded in a browser); and reduced
// motion (one tap, a fade).
// Usage: node test/ui-badges.mjs [--dark] [--shots]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const dark = process.argv.includes('--dark');
const shots = process.argv.includes('--shots');
const OUT = join(root, 'build/ui-badges');
if (shots) mkdirSync(OUT, { recursive: true });

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light', reducedMotion: o.reduced ? 'reduce' : 'no-preference', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // A Monday at 6:30 in the morning: today's workout will be an early one.
  await page.clock.install({ time: new Date('2026-10-19T06:30:00') });
  await page.addInitScript(seedBridge);
  if (o.noBridgeShare) await page.addInitScript(() => { const t = setInterval(() => { if (window.AndroidBridge) { delete window.AndroidBridge.shareImage; clearInterval(t); } }, 1); });
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  return { ctx, page };
}
const { ctx, page } = await open();
const settle = async (ms = 700) => { await page.clock.runFor(ms); await page.waitForTimeout(Math.min(ms, 300)); };
const shot = async (name) => { if (shots) await page.screenshot({ path: join(OUT, `${dark ? 'dark' : 'light'}-${name}.png`) }); };
const S = (fn, arg) => page.evaluate(fn, arg);
const closeAll = async () => { await S(() => { window.GH.ui.closeSheets(); while (window.GH.ui.back()) { /* back to the tab */ } }); await settle(700); };
await settle(2500);

section('The first 1.6 load');
const mig = await S(() => { const A = window.GH.achievements, S = window.GH.ui.S; return { m: S.achievements.migrated, n: Object.keys(S.achievements.earned).length, first: S.achievements.earned.first, unseen: A.unseen(S), seenAt: S.achievements.seenAt }; });
check('five weeks of history earned their badges on the first load', mig.m && mig.m.n >= 8 && mig.first && mig.first.day <= await S(() => window.GH.ui.today() - 30), mig);
check('all of them counted as seen (no reveal at launch)', mig.seenAt > 0 && !(await S(() => !!document.querySelector('dialog[open]'))));
check('and opened: what history earned on the first load isn\'t sealed', await S(() => { const S = window.GH.ui.S, E = S.achievements.earned; return S.achievements.v === 2 && Object.values(E).filter((e) => e.at <= S.achievements.migrated.at).every((e) => e.opened === true); }));
check('a Health Connect sync after it earns quietly: no toast, just sealed and waiting', await S(() => ![...document.querySelectorAll('.rf-toast')].some((t) => /badge/i.test(t.textContent)) && window.GH.achievements.unopened(window.GH.ui.S).every((id) => window.GH.ui.S.achievements.earned[id].at > window.GH.ui.S.achievements.migrated.at)));

section('The You tab\'s card');
const strip = await S(() => { const U = window.GH.ui; const d = document.createElement('div'); d.innerHTML = U.badgeStrip(U.S, U.today()); return { html: d.innerHTML, text: d.textContent.replace(/\s+/g, ' '), tiles: [...d.querySelectorAll('[data-badge]')].map((t) => [t.dataset.badge, t.classList.contains('is-earned'), t.classList.contains('is-sealed')]) }; });
check('a summary: how many of how many, and what\'s next', /Badges\s*\d+ of \d+ · Next: /.test(strip.text), strip.text.slice(0, 120));
// Newest first, the sealed ones (waiting to be opened) before the rest.
const latest = await S(() => { const S = window.GH.ui.S, E = S.achievements.earned, sealed = (id) => (E[id].opened === false ? 0 : 1); return Object.keys(E).filter((id) => window.GH.achievements.byId[id]).sort((a, b) => (sealed(a) - sealed(b)) || (E[b].day - E[a].day) || (E[b].at - E[a].at)).slice(0, 8); });
check('the latest badges (sealed ones first, then newest first), each [data-badge] and .is-earned', strip.tiles.length === 8 && strip.tiles.every(([, e]) => e) && strip.tiles.map(([id]) => id).join() === latest.join(), [strip.tiles, latest]);
check('and a note: how many are waiting to be opened, or the one-time note about badges already earned, or what\'s new', /\d+ badges? to open|You've already earned \d+ badges|New badge|new badges/.test(strip.text), strip.text);

section('The gallery');
await S(() => window.GH.ui.open('badges'));
await settle(900);
const gal = await S(() => { const s = document.getElementById('screen'); return { view: s.dataset.view, tiles: s.querySelectorAll('[data-badge]').length, earned: s.querySelectorAll('[data-badge].is-earned').length, first: !!s.querySelector('[data-badge="first"].is-earned'), lifer: !!s.querySelector('[data-badge="w250"]:not(.is-earned)'), heads: [...s.querySelectorAll('.sec-title')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()), hero: s.querySelector('.bdg-hero').textContent.replace(/\s+/g, ' '), filter: !!s.querySelector('[data-on="badgeFilter"]') }; });
const total = await S(() => window.GH.achievements.evaluate(window.GH.ui.S, window.GH.ui.today()).filter((x) => x.shown).length);
check('a page of its own, every badge offered as a tile', gal.view === 'badges' && gal.tiles === total && total >= 50, gal);
check('earned ones marked, locked ones not', gal.first && gal.lifer && gal.earned >= 8);
check('in sections by category, with counts', gal.heads.length >= 8 && /^Consistency \d+ of \d+$/.test(gal.heads[0]), gal.heads);
check('a summary on top with the tiers', /\d+ of \d+ earned/.test(gal.hero) && /Bronze \d+/.test(gal.hero) && /Platinum \d+/.test(gal.hero), gal.hero);
check('opening it counts everything as seen', await S(() => window.GH.achievements.unseen(window.GH.ui.S).length === 0 && window.GH.ui.S.achievements.migrated.seen === true));
await shot('01-gallery');
await page.click('#screen [data-on="badgeFilter"] input[value="earned"]', { force: true });
await settle(600);
check('Earned: only earned ones', await S(() => { const t = document.querySelectorAll('#screen [data-badge]'); return t.length > 0 && [...t].every((x) => x.classList.contains('is-earned')); }));
await page.click('#screen [data-on="badgeFilter"] input[value="next"]', { force: true });
await settle(600);
const next = await S(() => [...document.querySelectorAll('#screen .bdg-next')].map((r) => ({ id: r.dataset.badge, bar: !!r.querySelector('.rf-progress') })));
check('Next up: the closest ones still to earn, with their progress', next.length >= 3 && next.length <= 10 && next.every((x) => x.bar), next);
await shot('02-next-up');
await page.click('#screen [data-on="badgeFilter"] input[value="all"]', { force: true });
await settle(600);

section('A badge\'s sheet');
await page.click('#screen [data-badge="first"]');
await settle(900);
const det = await S(() => { const d = document.querySelector('dialog.bdg-sheet[open]'); return d && { title: d.querySelector('.rf-sheet-title').textContent, badge: d.querySelector('.bdg-detail').dataset.badge, text: d.textContent.replace(/\s+/g, ' '), share: !!d.querySelector('[data-act="badgeShare"]'), medal: !!d.querySelector('.bdg-medal svg[role="img"]') }; });
check('tapping a medal opens its sheet: a large medal, its name and tier, how it was earned, the date, Share', det && det.badge === 'first' && det.title === 'Consistency' && /Day one/.test(det.text) && /Bronze · Common/i.test(det.text) && /Finish your first workout/.test(det.text) && /Earned/.test(det.text) && det.share && det.medal, det);
await shot('03-detail');
await closeAll();
await S(() => window.GH.ui.badgeDetail('w250'));
await settle(900);
const lock = await S(() => { const d = document.querySelector('dialog.bdg-sheet[open]'); return { text: d.textContent.replace(/\s+/g, ' '), bar: !!d.querySelector('.bdg-prog .rf-progress'), share: !!d.querySelector('[data-act="badgeShare"]'), ring: !!d.querySelector('.bdg-svg.is-locked .bdg-ring') }; });
check('a locked one: how to earn it, a progress bar, how many to go, no Share', /Finish 250 workouts/.test(lock.text) && /\d+ of 250/.test(lock.text) && /to go/.test(lock.text) && lock.bar && !lock.share && lock.ring, lock.text.slice(0, 160));
await closeAll();
const secret = await S(() => { window.GH.ui.badgeDetail('nightOwl'); const d = document.querySelector('dialog.bdg-sheet[open]'); return d.textContent.replace(/\s+/g, ' '); });
check('a secret one stays a secret until it\'s earned', /Secret badge/.test(secret) && !/Night owl/.test(secret) && !/9 at night/.test(secret), secret.slice(0, 120));
await closeAll();

section('A workout that earns one');
await S(() => { window.__haptics.length = 0; window.GH.ui.go('today'); });
await settle(600);
await S(() => window.GH.ui.act.startWorkout());
await settle(1500);
await S(() => { const S = window.GH.ui.S, B = window.GH.brain; for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 14 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); } window.GH.ui.openCheckin(); });
await settle(900);
await page.click('#player [data-act="plSaveCheckin"]');
await page.waitForSelector('#player .rf-large-title:has-text("Next time")');
await settle(2200);
const card = await S(() => { const c = document.querySelector('#player .bdg-card'); return c && { ids: c.dataset.arg.split(','), text: c.innerText.replace(/\s+/g, ' '), sealed: c.classList.contains('is-sealed'), capsule: !!c.querySelector('.bdg-cap-svg'), medal: !!c.querySelector('.bdg-svg') }; });
check('the Next screen shows its own badge card: an early workout earned Early bird, sealed', card && card.ids.includes('earlyBird') && card.sealed && await S(() => window.GH.ui.S.achievements.earned.earlyBird.opened === false), card);
check('a capsule in its tier\'s colours, the tier and "Tap to open": not its name or its medal', card && card.capsule && !card.medal && /New badge · Bronze/i.test(card.text) && /Tap to open/.test(card.text) && /A common badge is inside/.test(card.text) && !/Early bird/.test(card.text), card);
check('it plays the badge haptic as the capsule lands', await S(() => window.__haptics.includes('badge') || (!window.GH.platform.hapticKinds.includes('badge') && window.__haptics.includes('tap'))), await S(() => window.__haptics.slice(-8)));
check('the player shows it, so it counts as seen (no toast on top)', await S(() => window.GH.achievements.unseen(window.GH.ui.S).length === 0 && ![...document.querySelectorAll('.rf-toast')].some((t) => /New badge/.test(t.textContent))));
check('no sheet covers the Next screen: Done is right there', await S(() => !document.querySelector('dialog[open]')) && await page.locator('#player [data-act="plClose"]').isVisible());
await shot('04-next');
await page.click('#player .bdg-card');
await settle(1800);
// The reveal: what can be seen and read (innerText leaves out what's hidden), the capsule, and the
// animations running on the stage with what they animate (reading them brings the style up to date,
// so a tap's are there at once).
const revNow = () => S(() => {
  const d = document.querySelector('dialog.bdg-reveal-sheet[open]');
  if (!d) return null;
  const st = d.querySelector('.bdg-page .bdg-stage');
  const visible = (sel) => { const e = d.querySelector(sel); return !!e && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }); };
  const anims = st.getAnimations({ subtree: true }).map((a) => ({ name: a.animationName || a.constructor.name, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)))] }));
  return { title: d.querySelector('.rf-sheet-title').textContent, pages: [...d.querySelectorAll('.bdg-page')].map((p) => p.dataset.page), text: d.querySelector('.bdg-reveal').innerText.replace(/\s+/g, ' '), sealed: st.classList.contains('is-sealed'), taps: st.dataset.taps, bob: st.hasAttribute('data-bob'), opened: st.classList.contains('is-opened'), sprung: st.classList.contains('is-in'), cap: visible('.bdg-page .bdg-cap'), medalHidden: d.querySelector('.bdg-page .bdg-medal').getAttribute('aria-hidden') === 'true', share: visible('[data-act="badgeShareCur"]'), done: visible('[data-act="badgeDone"]'), dots: d.querySelectorAll('.bdg-dots > .rf-dot').length, anims };
});
const rev = await revNow();
check('the card opens the reveal, the badge sealed: a capsule, its tier and rarity, "Tap to open"', rev && rev.pages.includes('earlyBird') && rev.sealed && rev.cap && /Bronze · Common/i.test(rev.text) && /Tap to open/.test(rev.text) && /Earned today/.test(rev.text), rev);
check('its name and medal don\'t show yet (hidden from a screen reader too), nor do Share and Done', rev && !/Early bird/.test(rev.text) && rev.medalHidden && !rev.share && !rev.done && !rev.sprung, rev);
check('the capsule floats, bobbing while it\'s on screen: transform only, so the compositor plays it', rev && rev.bob && rev.anims.some((a) => a.name === 'bdg-bob') && rev.anims.filter((a) => /^bdg-bob/.test(a.name)).every((a) => a.props.every((p) => p === 'transform' || p === 'opacity')), rev && rev.anims);
await shot('05-sealed');
// Three taps: a wobble, then a shake and cracks, then it bursts. Each with its own haptic, in order.
const cap = 'dialog.bdg-reveal-sheet .bdg-page .bdg-cap';
await S(() => { window.__haptics.length = 0; });
await page.click(cap);
await settle(700);
const tap1 = await revNow();
check('the first tap: it wobbles (a hairline crack), still sealed', tap1.taps === '1' && tap1.sealed && !tap1.opened && await S(() => window.GH.ui.S.achievements.earned.earlyBird.opened === false) && !/Early bird/.test(tap1.text), tap1);
await page.click(cap);
const shake = await revNow();
await settle(700);
const tap2 = await revNow();
check('the second: a harder shake and cracks of light, still sealed', tap2.taps === '2' && tap2.sealed && shake.anims.some((a) => a.name === 'bdg-shake') && !/Early bird/.test(tap2.text), { taps: tap2.taps, anims: shake.anims.map((a) => a.name) });
await shot('05b-cracked');
await page.click(cap);
const burst = await revNow();
check('the third bursts it open: it\'s opened for good at once (saved), the halves fly apart, light floods out', await S(() => window.GH.ui.S.achievements.earned.earlyBird.opened === true && !window.GH.achievements.unopened(window.GH.ui.S).includes('earlyBird')) && ['bdg-split-top', 'bdg-split-bottom', 'bdg-flash'].every((n) => burst.anims.some((a) => a.name === n)), burst.anims.map((a) => a.name));
check('every animation of the opening moves by transform and opacity only', burst.anims.length >= 5 && [...shake.anims, ...burst.anims].every((a) => a.props.every((p) => p === 'transform' || p === 'opacity')), [...shake.anims, ...burst.anims].filter((a) => a.props.some((p) => p !== 'transform' && p !== 'opacity')));
await settle(1400);
await page.waitForTimeout(900); // Share and Done fade in on a CSS transition, which runs in real time
const out = await revNow();
check('the medal springs out, then its name, tier, what it took, the date, Share and Done', out.opened && out.sprung && !out.cap && !out.medalHidden && /Early bird/.test(out.text) && /Bronze · Common/i.test(out.text) && /Start a workout before 8 in the morning/.test(out.text) && /Earned today/.test(out.text) && out.share && out.done && !out.bob, out);
const hx = await S(() => window.__haptics.slice());
check('the haptics, in order: wobble, crack, then badge as it bursts', hx.join() === 'wobble,crack,badge', hx);
check('beads burst from it, within Refract\'s 8 to 14', await S(() => { const n = document.querySelectorAll('.rf-bead').length; return n === 0 || (n >= 8 && n <= 14); }));
await shot('05c-opened');
await page.click('dialog.bdg-reveal-sheet [data-act="badgeDone"]');
await settle(800);
check('Done closes it', await S(() => !document.querySelector('dialog.bdg-reveal-sheet[open]')));
const card2 = await S(() => { const c = document.querySelector('#player .bdg-card'); return c && { sealed: c.classList.contains('is-sealed'), medal: !!c.querySelector('.bdg-svg'), text: c.innerText.replace(/\s+/g, ' ') }; });
check('and the Next screen\'s card shows the medal now, with its name', card2 && !card2.sealed && card2.medal && /Early bird/.test(card2.text), card2);
await page.click('#player [data-act="plClose"]');
await settle(1200);

section('Several at once: pages with dots');
// Badges recorded without opened (as before 1.8.11) count as opened: each springs in as its page shows.
await S(() => { const S = window.GH.ui.S, now = Date.now(), d = window.GH.ui.today(); for (const id of ['w25', 'streak30', 'halfMarathon']) S.achievements.earned[id] = { day: d, at: now }; window.GH.ui.badgeReveal(['w25', 'streak30', 'halfMarathon']); });
await settle(1200);
// Refract's page dots: the dot marked current (aria-current) is the page showing, and its ink worm
// sits on that dot.
const dotsNow = () => S(() => {
  const d = document.querySelector('dialog.bdg-reveal-sheet[open]'), row = d.querySelector('.bdg-dots');
  const dots = [...row.querySelectorAll(':scope > .rf-dot')], sel = dots.findIndex((x) => x.getAttribute('aria-current') === 'true');
  const worm = row.querySelector('.rf-pagedots-worm'), at = worm && parseFloat(worm.style.getPropertyValue('--_wx'));
  const on = sel >= 0 && worm ? Math.abs(at + 9 - (dots[sel].offsetLeft + dots[sel].offsetWidth / 2)) <= 1 : false;
  const box = d.querySelector('.bdg-pages');
  return { dots: dots.length, sel, worm: !!worm, wormOn: on, page: Math.round(box.scrollLeft / box.clientWidth), pagedots: row.matches('.rf-pagedots') };
});
const multi = await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); return { title: d.querySelector('.rf-sheet-title').textContent, pages: d.querySelectorAll('.bdg-page').length }; });
let pd = await dotsNow();
check('three new badges: three pages and three of Refract\'s page dots, the first one showing', multi.title === '3 new badges' && multi.pages === 3 && pd.pagedots && pd.dots === 3 && pd.sel === 0 && pd.worm && pd.wormOn, { multi, pd });
await page.click('dialog.bdg-reveal-sheet .bdg-dots > .rf-dot:nth-child(3)');
await settle(1500);
const third = await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); const p = d.querySelectorAll('.bdg-page')[2]; return { sprung: p.querySelector('.bdg-stage').classList.contains('is-in'), text: p.textContent.replace(/\s+/g, ' ') }; });
pd = await dotsNow();
check('a dot pages to its badge, which springs in then', pd.sel === 2 && pd.page === 2 && third.sprung && /Half marathon/.test(third.text) && /Platinum · Very rare/i.test(third.text), { third, pd });
check('and the worm has gone to that dot', pd.wormOn, pd);
// Paging with a finger: the dots follow the page.
await S(() => { const box = document.querySelector('dialog.bdg-reveal-sheet[open] .bdg-pages'); box.scrollTo({ left: box.clientWidth, behavior: 'auto' }); });
await settle(1200);
pd = await dotsNow();
check('paging by swiping: the dots follow the page', pd.page === 1 && pd.sel === 1 && pd.wormOn, pd);
// The arrow keys on the dots page too.
await page.focus('dialog.bdg-reveal-sheet .bdg-dots > .rf-dot:nth-child(2)');
await page.keyboard.press('ArrowLeft');
await settle(1500);
pd = await dotsNow();
check('and the arrow keys on the dots page back', pd.sel === 0 && pd.page === 0 && pd.wormOn, pd);
await shot('06-reveal-3');
await closeAll();

section('Several sealed: Open all');
// Three sealed ones (any a sync brought earlier are opened first, so these are all that wait).
await S(() => {
  const S = window.GH.ui.S, A = window.GH.achievements, now = Date.now(), d = window.GH.ui.today();
  for (const id of A.unopened(S)) A.markOpened(S, id);
  ['firstActivity', 'run5k', 'weeks26'].forEach((id, i) => { S.achievements.earned[id] = { day: d, at: now + i, opened: false }; });
  window.__haptics.length = 0;
  window.GH.ui.badgeReveal();
});
await settle(1400);
const many = await S(() => {
  const d = document.querySelector('dialog.bdg-reveal-sheet[open]');
  const vis = (sel) => { const e = d.querySelector(sel); return !!e && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }); };
  return { title: d.querySelector('.rf-sheet-title').textContent, pages: [...d.querySelectorAll('.bdg-page')].map((p) => [p.dataset.page, p.classList.contains('is-sealed')]), waiting: window.GH.achievements.unopened(window.GH.ui.S), bobs: [...d.querySelectorAll('.bdg-page .bdg-stage')].map((s) => s.hasAttribute('data-bob')), all: vis('[data-act="badgeOpenAll"]'), share: vis('[data-act="badgeShareCur"]'), dots: d.querySelectorAll('.bdg-dots > .rf-dot').length, text: d.querySelector('.bdg-reveal').innerText.replace(/\s+/g, ' ') };
});
check('the reveal opens every badge still sealed, oldest first, each a page of its own, sealed', many.title === '3 new badges' && many.pages.map(([id]) => id).join() === 'firstActivity,run5k,weeks26' && many.waiting.join() === 'firstActivity,run5k,weeks26' && many.pages.every(([, s]) => s) && many.dots === 3, many);
check('with Open all (and no Share or Done while the page showing is sealed)', many.all && !many.share && !/Out the door|Iron habit/.test(many.text), many);
check('only the capsule on screen bobs (the other pages are off to the side)', many.bobs.join() === 'true,false,false', many.bobs);
await shot('06b-sealed-3');
await page.click('dialog.bdg-reveal-sheet [data-act="badgeOpenAll"]');
await settle(1500);
await page.waitForTimeout(900); // Share and Done fade in in real time
const all = await S(() => {
  const d = document.querySelector('dialog.bdg-reveal-sheet[open]');
  const vis = (sel) => { const e = d.querySelector(sel); return !!e && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }); };
  const p0 = d.querySelectorAll('.bdg-page')[0];
  return { waiting: window.GH.achievements.unopened(window.GH.ui.S), opened: ['firstActivity', 'run5k', 'weeks26'].every((id) => window.GH.ui.S.achievements.earned[id].opened === true), sealedPages: d.querySelectorAll('.bdg-page.is-sealed').length, first: p0.innerText.replace(/\s+/g, ' '), sprung: p0.querySelector('.bdg-stage').classList.contains('is-in'), all: vis('[data-act="badgeOpenAll"]'), share: vis('[data-act="badgeShareCur"]'), done: vis('[data-act="badgeDone"]'), hx: window.__haptics.slice(), bobbing: document.getAnimations().filter((a) => /^bdg-bob/.test(a.animationName || '')).length };
});
check('Open all opens every one of them for good, the page showing bursting open with the badge haptic', all.opened && all.waiting.length === 0 && all.sealedPages === 0 && all.sprung && /Out the door/.test(all.first) && all.hx.filter((k) => k === 'badge').length === 1, all);
check('then Share and Done, and no capsule bobs any more', !all.all && all.share && all.done && all.bobbing === 0, all);
await page.click('dialog.bdg-reveal-sheet .bdg-dots > .rf-dot:nth-child(3)');
await settle(1500);
const last = await S(() => { const p = document.querySelectorAll('dialog.bdg-reveal-sheet[open] .bdg-page')[2]; return { sprung: p.querySelector('.bdg-stage').classList.contains('is-in'), text: p.innerText.replace(/\s+/g, ' '), hx: window.__haptics.slice() }; });
check('the others spring in as their page shows, as an opened one does', last.sprung && /Iron habit/.test(last.text) && /Platinum · Very rare/i.test(last.text) && last.hx.filter((k) => k === 'badge').length === 2, last);
await shot('06c-open-all');
// Sharing works as it did, from the page showing.
await page.click('dialog.bdg-reveal-sheet [data-act="badgeShareCur"]');
await settle(2000);
check('Share on an opened one opens its share card', await S(() => { const d = document.querySelector('dialog.sc-sheet[open]'); return !!d && !!d.querySelector('.sc-canvas'); }));
await closeAll();

section('Earned somewhere else: a toast with the medal');
await S(() => { window.__haptics.length = 0; window.GH.ui.go('today'); });
await settle(600);
await S(() => { const U = window.GH.ui, C = window.GH.customPlan; C.add(U.S, { name: 'Upper body', days: [{ title: 'Push', items: [{ move: 'push_std', sets: 3, reps: 10 }] }], source: 'you' }); U.save(); });
await settle(1600);
const toast = await S(() => { const t = [...document.querySelectorAll('.rf-toast')].find((x) => /New badge/.test(x.textContent)); const b = t && t.querySelector('.rf-btn:not(.rf-toast-close)'); return t && { text: t.textContent.replace(/\s+/g, ' '), capsule: !!t.querySelector('.bdg-toast-medal .bdg-cap-svg'), medal: !!t.querySelector('.bdg-toast-medal .bdg-svg'), go: b && b.textContent.trim() }; });
check('a saved change is checked a moment later: a plan of their own earns Your way, sealed', await S(() => !!window.GH.ui.S.achievements.earned.ownPlan && window.GH.ui.S.achievements.earned.ownPlan.opened === false));
check('told with a toast: the capsule, its tier and rarity and Open it, not its name (nothing pops up over the screen)', toast && /New badge/.test(toast.text) && /Bronze · Common/.test(toast.text) && !/Your way/.test(toast.text) && toast.capsule && !toast.medal && toast.go === 'Open it' && !(await S(() => !!document.querySelector('dialog[open]'))), toast);
await shot('07-toast');
await S(() => { const t = [...document.querySelectorAll('.rf-toast')].find((x) => /New badge/.test(x.textContent)); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
await settle(1500);
check('Open it opens the reveal, sealed', await S(() => !!document.querySelector('dialog.bdg-reveal-sheet[open] .bdg-page.is-sealed[data-page="ownPlan"]')));
await closeAll();
check('closed without opening it, it stays sealed, waiting', await S(() => window.GH.ui.S.achievements.earned.ownPlan.opened === false && window.GH.achievements.unopened(window.GH.ui.S).includes('ownPlan')));

section('Sealed in the gallery and on the You tab');
await S(() => window.GH.ui.go('you'));
await settle(1500);
const you = await S(() => { const c = document.querySelector('#screen .bdg-strip'); const m = c.querySelector('[data-badge="ownPlan"]'); return { note: c.querySelector('.bdg-note') && c.querySelector('.bdg-note').innerText.replace(/\s+/g, ' '), first: c.querySelector('.bdg-row [data-badge]').dataset.badge, sealed: !!m && m.classList.contains('is-sealed') && !!m.querySelector('.bdg-cap-svg'), text: m && m.innerText.replace(/\s+/g, ' ') }; });
check('the You tab\'s card says how many are waiting ("1 badge to open"), and shows the sealed one first, as a capsule', /^1 badge to open Open it$/.test(you.note) && you.first === 'ownPlan' && you.sealed && /Common/.test(you.text) && !/Your way/.test(you.text), you);
await shot('07b-you-sealed');
await S(() => window.GH.ui.open('badges'));
await settle(1200);
const tileNow = () => S(() => { const t = document.querySelector('#screen [data-badge="ownPlan"]'); return { sealed: t.classList.contains('is-sealed'), earned: t.classList.contains('is-earned'), capsule: !!t.querySelector('.bdg-cap-svg'), medal: !!t.querySelector('.bdg-svg'), isNew: !!t.querySelector('.bdg-new'), text: t.textContent.replace(/\s+/g, ' '), hero: document.querySelector('#screen .bdg-hero').innerText.replace(/\s+/g, ' ') }; });
const t0 = await tileNow();
check('in the gallery it\'s sealed in its place, a capsule marked New: its rarity and "Tap to open", not its name', t0.sealed && t0.earned && t0.capsule && !t0.medal && t0.isNew && /Common/.test(t0.text) && /Tap to open/.test(t0.text) && !/Your way/.test(t0.text) && /1 badge to open/.test(t0.hero), t0);
check('increased contrast and reduced transparency: the glass is a solid fill', await S(() => {
  const html = document.documentElement, solid = () => getComputedStyle(document.querySelector('#screen [data-badge="ownPlan"] .bdg-cap-solid')).opacity;
  const before = solid();
  html.setAttribute('data-rf-transparency', 'reduced'); const flat = solid(); html.removeAttribute('data-rf-transparency');
  const theme = html.getAttribute('data-theme'); html.setAttribute('data-theme', `${(theme || 'light').replace(/-contrast$/, '')}-contrast`); const hc = solid(); if (theme) html.setAttribute('data-theme', theme); else html.removeAttribute('data-theme');
  return before === '0' && flat === '1' && hc === '1';
}));
await page.evaluate(() => document.querySelector('#screen [data-badge="ownPlan"]').scrollIntoView({ block: 'center' }));
await settle(600);
await shot('07c-gallery-sealed');
await S(() => { window.__haptics.length = 0; });
await page.click('#screen [data-badge="ownPlan"]');
await settle(1500);
check('a tap opens it right there in the reveal, sealed', await S(() => !!document.querySelector('dialog.bdg-reveal-sheet[open] .bdg-page.is-sealed[data-page="ownPlan"]')));
for (let i = 0; i < 3; i++) { await page.click('dialog.bdg-reveal-sheet .bdg-page .bdg-cap'); await settle(500); }
await settle(1200);
check('three taps open it: its name, Share and Done', await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); return /Your way/.test(d.querySelector('.bdg-reveal').innerText) && window.GH.ui.S.achievements.earned.ownPlan.opened === true; }) && (await S(() => window.__haptics.join())).includes('wobble,crack,badge'));
await page.click('dialog.bdg-reveal-sheet [data-act="badgeDone"]');
await settle(1500);
const t1 = await tileNow();
check('closed, the gallery shows its medal in its place, its name and date, and nothing left to open', !t1.sealed && t1.earned && t1.medal && !t1.capsule && /Your way/.test(t1.text) && !/to open/.test(t1.hero), t1);
check('and its sheet is the detail sheet again, as before', await S(() => { window.GH.ui.badgeDetail('ownPlan'); const d = document.querySelector('dialog.bdg-sheet[open]'); return !!d && !!d.querySelector('.bdg-detail[data-badge="ownPlan"]') && /Your way/.test(d.textContent); }));
await closeAll();

section('Not while the player is open');
await S(() => window.GH.ui.openMobility()); // today's workout is done: the mobility flow opens the player
await settle(1200);
const opened = await S(() => !document.getElementById('player').hidden);
await S(() => { window.GH.achievements.event(window.GH.ui.S, 'tailored', window.GH.ui.today()); window.GH.ui.save(); });
await settle(2500);
check('a change during a workout waits', opened && !(await S(() => !!window.GH.ui.S.achievements.earned.tailored)));
await S(() => window.GH.ui.playerBack());
await settle(3000);
check('and is checked once the player closes', await S(() => !!window.GH.ui.S.achievements.earned.tailored));
await closeAll();

section('Events from elsewhere');
await S(() => window.GH.ui.badgeEvent('sharedPlan'));
await settle(1200);
check('U.badgeEvent records it and checks: Pass it on', await S(() => !!window.GH.ui.S.achievements.earned.sharedPlan && window.GH.ui.S.achievements.events.sharedPlan.n === 1));
await S(() => window.GH.ui.badgeEvent('nonsense'));
check('an unknown event is ignored', await S(() => !window.GH.ui.S.achievements.events.nonsense));
await closeAll();

section('The share card');
await S(() => { window.__drawn = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__drawn.push(String(t)); return f.call(this, t, ...a); }; });
await S(() => window.GH.ui.badgeDetail('first'));
await settle(900);
await page.click('dialog.bdg-sheet [data-act="badgeShare"]');
await settle(2000);
const card1 = await S(() => {
  const d = document.querySelector('dialog.sc-sheet[open]');
  const cv = d && d.querySelector('.sc-canvas');
  if (!cv) return null;
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const colors = new Set();
  for (let i = 0; i < px.length; i += 4 * 997) colors.add(`${px[i] >> 4},${px[i + 1] >> 4},${px[i + 2] >> 4}`);
  return { w: cv.width, h: cv.height, colors: colors.size, name: !!d.querySelector('[data-on="scName"]'), nameOn: d.querySelector('[data-on="scName"]') && d.querySelector('[data-on="scName"]').checked, date: d.querySelector('[data-on="scDate"]').checked, theme: !!d.querySelector('[data-on="scTheme"]'), drawn: window.__drawn.slice() };
});
check('a preview of the card: a 1080×1350 canvas, not blank', card1 && card1.w === 1080 && card1.h === 1350 && card1.colors > 40, card1 && { w: card1.w, h: card1.h, colors: card1.colors });
check('Show my name is there and off, Show the date on, light or dark', card1.name && card1.nameOn === false && card1.date === true && card1.theme);
check('it draws the badge\'s name and the date, never the person\'s name', card1.drawn.includes('Day one') && card1.drawn.some((t) => /^Earned /.test(t)) && !card1.drawn.some((t) => /Alex/.test(t)), card1.drawn);
await shot('08-share');
await page.click('dialog.sc-sheet [data-act="scShare"]');
await settle(1500);
const sent1 = await S(() => (window.__sharedImages || []).slice(-1)[0]);
check('Share hands the Android bridge a PNG (base64 iVBOR…) and a line of text', sent1 && /^iVBOR/.test(sent1.b64) && sent1.b64.length > 50000 && /Day one/.test(sent1.text), sent1 && { len: sent1.b64.length, text: sent1.text });
check('with no name in it', !/Alex/.test(sent1.text));
check('the share sheet closes, and sharing a badge is a secret badge of its own', await S(() => !document.querySelector('dialog.sc-sheet[open]') && !!window.GH.ui.S.achievements.earned.shareBadge && window.GH.ui.S.achievements.events.sharedBadge.n === 1));
await closeAll();
await S(() => { window.__drawn = []; window.GH.ui.shareBadge('first'); });
await settle(1500);
await S(() => { const i = document.querySelector('dialog.sc-sheet [data-on="scName"]'); i.click(); });
await settle(900);
await S(() => { window.__drawn = []; const i = document.querySelector('dialog.sc-sheet [data-on="scDate"]'); i.click(); });
await settle(900);
const named = await S(() => window.__drawn.slice());
check('Show my name on and the date off: the card says "by Alex" and no date', named.includes('by Alex') && !named.some((t) => /^Earned /.test(t)), named);
await page.click('dialog.sc-sheet [data-act="scShare"]');
await settle(1500);
const sent2 = await S(() => (window.__sharedImages || []).slice(-1)[0]);
check('and that is the picture shared (a different one), the text still without the name', sent2 && /^iVBOR/.test(sent2.b64) && sent2.b64 !== sent1.b64 && !/Alex/.test(sent2.text));
await closeAll();
await ctx.close();

section('In a browser: a download');
{
  const { ctx: c2, page: p2 } = await open({ noBridgeShare: true });
  await p2.clock.runFor(2500);
  const [dl] = await Promise.all([
    p2.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    p2.evaluate(async () => { await window.GH.lazy('shareCard'); const cv = await window.GH.shareCard.draw(window.GH.achievements.byId.first, { theme: 'light', date: '', name: '' }); return window.GH.platform.shareImage(cv.toDataURL('image/png').split(',')[1], 'I earned it', 'gradient-health-first.png'); }),
  ]);
  check('without the app\'s share sheet (and no Web Share for files), the picture downloads', !!dl && dl.suggestedFilename() === 'gradient-health-first.png', dl && dl.suggestedFilename());
  // Web Share that the person closes without sharing: the preview stays, with no error.
  await p2.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('Share canceled', 'AbortError')) });
    window.GH.ui.shareBadge('first');
  });
  await p2.clock.runFor(1200);
  await p2.waitForTimeout(400);
  await p2.click('dialog.sc-sheet [data-act="scShare"]');
  await p2.clock.runFor(1500);
  await p2.waitForTimeout(400);
  const cancel = await p2.evaluate(() => ({ open: !!document.querySelector('dialog.sc-sheet[open]'), toast: [...document.querySelectorAll('.rf-toast')].map((t) => t.textContent.trim()).filter((t) => /share/i.test(t)) }));
  check('closing the share sheet without sharing keeps the preview open, with no error', cancel.open && !cancel.toast.length, cancel);
  await c2.close();
}

section('Reduced motion');
{
  const { ctx: c3, page: p3 } = await open({ reduced: true });
  await p3.clock.runFor(2500);
  await p3.evaluate(() => { const S = window.GH.ui.S; S.achievements.earned.w25 = { day: window.GH.ui.today(), at: Date.now() }; window.GH.ui.badgeReveal(['w25']); });
  await p3.clock.runFor(1500);
  await p3.waitForTimeout(400);
  const rm = await p3.evaluate(() => { const st = document.querySelector('dialog.bdg-reveal-sheet[open] .bdg-stage'); const m = st.querySelector('.bdg-medal'); return { still: st.classList.contains('is-still'), sprung: st.classList.contains('is-in'), anim: getComputedStyle(m).animationName, beads: document.querySelectorAll('.rf-bead').length, visible: getComputedStyle(m).opacity }; });
  check('no burst and no spin: the medal is simply there', rm.still && !rm.sprung && rm.anim === 'none' && rm.beads === 0 && rm.visible === '1', rm);
  await p3.evaluate(() => window.GH.ui.closeSheets());
  await p3.clock.runFor(800);
  // A sealed one: no bob, and one tap opens it, with a fade.
  await p3.evaluate(() => { const S = window.GH.ui.S; S.achievements.earned.w50 = { day: window.GH.ui.today(), at: Date.now(), opened: false }; window.__haptics.length = 0; window.GH.ui.badgeReveal(['w50']); });
  await p3.clock.runFor(1500);
  await p3.waitForTimeout(400);
  const stageNow = () => p3.evaluate(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'), st = d.querySelector('.bdg-stage'); return { sealed: st.classList.contains('is-sealed'), bob: st.hasAttribute('data-bob'), taps: st.dataset.taps, fading: st.classList.contains('is-fading'), opening: st.classList.contains('is-opening'), anims: st.getAnimations({ subtree: true }).map((a) => a.animationName || 'web'), text: d.querySelector('.bdg-reveal').innerText.replace(/\s+/g, ' '), opened: window.GH.ui.S.achievements.earned.w50.opened, hx: window.__haptics.slice(), beads: document.querySelectorAll('.rf-bead').length, medal: getComputedStyle(st.querySelector('.bdg-medal')).opacity }; });
  const rs = await stageNow();
  check('a sealed one shows still: no bob, nothing moving', rs.sealed && !rs.bob && rs.anims.length === 0 && /Tap to open/.test(rs.text), rs);
  await p3.click('dialog.bdg-reveal-sheet .bdg-cap');
  const r1 = await stageNow();
  check('one tap opens it, for good: no wobble or crack, no burst, just a fade, with the badge haptic', r1.opened === true && r1.fading && !r1.opening && r1.taps === '0' && r1.hx.join() === 'badge' && r1.anims.every((a) => !/^bdg-(split|flash|wobble|shake|bob)/.test(a)), r1);
  await p3.clock.runFor(1200);
  await p3.waitForTimeout(500);
  const r2 = await stageNow();
  check('and the medal is there (no burst), with its name', !r2.sealed && r2.medal === '1' && /Fifty and counting/.test(r2.text) && r2.beads === 0, r2);
  await c3.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 6).join('\n'));
await browser.close();
await server.close();
done();
