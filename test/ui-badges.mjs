// The badge gallery, detail sheet, reveal and share card, in Chromium at phone size: the first 1.6
// load (history earns its badges, all seen), the You tab's card, the gallery with its filter, a
// badge's sheet, a workout that earns one (the player's own card, then the reveal), a toast for one
// earned elsewhere, no checks while the player is open, and the share card: a 1080×1350 PNG with no
// name unless it's turned on, handed to the Android bridge (or downloaded in a browser).
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
check('a Health Connect sync after it earns quietly: no toast, just New', await S(() => ![...document.querySelectorAll('.rf-toast')].some((t) => /badge/i.test(t.textContent))));

section('The You tab\'s card');
const strip = await S(() => { const U = window.GH.ui; const d = document.createElement('div'); d.innerHTML = U.badgeStrip(U.S, U.today()); return { html: d.innerHTML, text: d.textContent.replace(/\s+/g, ' '), tiles: [...d.querySelectorAll('[data-badge]')].map((t) => [t.dataset.badge, t.classList.contains('is-earned')]) }; });
check('a summary: how many of how many, and what\'s next', /Badges\s*\d+ of \d+ · Next: /.test(strip.text), strip.text.slice(0, 120));
const latest = await S(() => { const S = window.GH.ui.S, E = S.achievements.earned; return Object.keys(E).filter((id) => window.GH.achievements.byId[id]).sort((a, b) => (E[b].day - E[a].day) || (E[b].at - E[a].at)).slice(0, 8); });
check('the latest medals (newest first), each [data-badge] and .is-earned', strip.tiles.length === 8 && strip.tiles.every(([, e]) => e) && strip.tiles.map(([id]) => id).join() === latest.join(), [strip.tiles, latest]);
check('and the one-time note about badges already earned, or what\'s new', /You've already earned \d+ badges|New badge|new badges/.test(strip.text), strip.text);

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
const card = await S(() => { const c = document.querySelector('#player .bdg-card'); return c && { ids: c.dataset.arg.split(','), text: c.textContent.replace(/\s+/g, ' '), medal: !!c.querySelector('.bdg-svg') }; });
check('the Next screen shows its own badge card: an early workout earned Early bird', card && card.ids.includes('earlyBird') && /Early bird/.test(card.text) && card.medal, card);
check('it plays the badge haptic', await S(() => window.__haptics.includes('badge') || (!window.GH.platform.hapticKinds.includes('badge') && window.__haptics.includes('tap'))), await S(() => window.__haptics.slice(-8)));
check('the player shows it, so it counts as seen (no toast on top)', await S(() => window.GH.achievements.unseen(window.GH.ui.S).length === 0 && ![...document.querySelectorAll('.rf-toast')].some((t) => /New badge/.test(t.textContent))));
check('no sheet covers the Next screen: Done is right there', await S(() => !document.querySelector('dialog[open]')) && await page.locator('#player [data-act="plClose"]').isVisible());
await shot('04-next');
await page.click('#player .bdg-card');
await settle(1800);
const rev = await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); return d && { title: d.querySelector('.rf-sheet-title').textContent, pages: [...d.querySelectorAll('.bdg-page')].map((p) => p.dataset.page), text: d.textContent.replace(/\s+/g, ' '), sprung: !!d.querySelector('.bdg-page .bdg-stage.is-in'), share: !!d.querySelector('[data-act="badgeShareCur"]'), done: !!d.querySelector('[data-act="badgeDone"]'), dots: d.querySelectorAll('.bdg-dot').length }; });
check('the card opens the reveal: the medal springs in, then tier, rarity and "Earned today"', rev && rev.pages.includes('earlyBird') && rev.sprung && /Bronze · Common/i.test(rev.text) && /Earned today/.test(rev.text), rev);
check('with Share and Done, and dots when there are several', rev && rev.share && rev.done && (rev.pages.length > 1 ? rev.dots === rev.pages.length : rev.dots === 0), rev && rev.pages);
await shot('05-reveal');
await page.click('dialog.bdg-reveal-sheet [data-act="badgeDone"]');
await settle(800);
check('Done closes it', await S(() => !document.querySelector('dialog.bdg-reveal-sheet[open]')));
await page.click('#player [data-act="plClose"]');
await settle(1200);

section('Several at once: pages with dots');
await S(() => { const S = window.GH.ui.S, now = Date.now(), d = window.GH.ui.today(); for (const id of ['w25', 'streak30', 'halfMarathon']) S.achievements.earned[id] = { day: d, at: now }; window.GH.ui.badgeReveal(['w25', 'streak30', 'halfMarathon']); });
await settle(1200);
const multi = await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); return { title: d.querySelector('.rf-sheet-title').textContent, pages: d.querySelectorAll('.bdg-page').length, dots: d.querySelectorAll('.bdg-dot').length, sel: [...d.querySelectorAll('.bdg-dot')].findIndex((x) => x.getAttribute('aria-selected') === 'true') }; });
check('three new badges: three pages and three dots, the first one showing', multi.title === '3 new badges' && multi.pages === 3 && multi.dots === 3 && multi.sel === 0, multi);
await page.click('dialog.bdg-reveal-sheet .bdg-dot[data-arg="2"]');
await settle(1500);
const third = await S(() => { const d = document.querySelector('dialog.bdg-reveal-sheet[open]'); const p = d.querySelectorAll('.bdg-page')[2]; return { sel: [...d.querySelectorAll('.bdg-dot')].findIndex((x) => x.getAttribute('aria-selected') === 'true'), sprung: p.querySelector('.bdg-stage').classList.contains('is-in'), text: p.textContent.replace(/\s+/g, ' ') }; });
check('a dot pages to its badge, which springs in then', third.sel === 2 && third.sprung && /Half marathon/.test(third.text) && /Platinum · Very rare/i.test(third.text), third);
await shot('06-reveal-3');
await closeAll();

section('Earned somewhere else: a toast with the medal');
await S(() => { window.__haptics.length = 0; window.GH.ui.go('today'); });
await settle(600);
await S(() => { const U = window.GH.ui, C = window.GH.customPlan; C.add(U.S, { name: 'Upper body', days: [{ title: 'Push', items: [{ move: 'push_std', sets: 3, reps: 10 }] }], source: 'you' }); U.save(); });
await settle(1600);
const toast = await S(() => { const t = [...document.querySelectorAll('.rf-toast')].find((x) => /New badge/.test(x.textContent)); return t && { text: t.textContent.replace(/\s+/g, ' '), medal: !!t.querySelector('.bdg-toast-medal .bdg-svg'), see: !!t.querySelector('.rf-btn:not(.rf-toast-close)') }; });
check('a saved change is checked a moment later: a plan of their own earns Your way', await S(() => !!window.GH.ui.S.achievements.earned.ownPlan));
check('told with a toast: the medal, its name and See it (nothing pops up over the screen)', toast && /New badge/.test(toast.text) && /Your way/.test(toast.text) && toast.medal && toast.see && !(await S(() => !!document.querySelector('dialog[open]'))), toast);
await shot('07-toast');
await S(() => { const t = [...document.querySelectorAll('.rf-toast')].find((x) => /New badge/.test(x.textContent)); t.querySelector('.rf-btn:not(.rf-toast-close)').click(); });
await settle(1500);
check('See it opens the reveal', await S(() => !!document.querySelector('dialog.bdg-reveal-sheet[open] .bdg-page[data-page="ownPlan"]')));
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
    p2.evaluate(async () => { const cv = await window.GH.shareCard.draw(window.GH.achievements.byId.first, { theme: 'light', date: '', name: '' }); return window.GH.platform.shareImage(cv.toDataURL('image/png').split(',')[1], 'I earned it', 'gradient-health-first.png'); }),
  ]);
  check('without the app\'s share sheet (and no Web Share for files), the picture downloads', !!dl && dl.suggestedFilename() === 'gradient-health-first.png', dl && dl.suggestedFilename());
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
  await c3.close();
}

section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 6).join('\n'));
await browser.close();
await server.close();
done();
