// Every sheet the app opens, sized right (src/ui/sheet.js): each one is opened the way the app opens
// it, in Chromium at phone size, light, at 390 px with the text as it comes and at 360 px with it at
// 130% (the most the app allows when the phone's font size is turned up; test/sweep.mjs does the
// same) and a three-button navigation bar, and once it has settled:
// - a full sheet is a long one (a list, a search, a long read): no big empty space under its content
// - an auto or fit sheet whose content fits in 86% of the screen shows all of it as it opens: nothing
//   cut off at the bottom, no sliver of a second detent to drag up for
// - its main buttons (filled, tinted or large) are in sight as it opens, unless it's an auto or fit
//   sheet too long for the screen and they're further down it than 86% of the screen (then they're
//   at the end of what scrolls)
// - nothing runs past its sides, no text is cut off and no label is wider than its button
// Not the food sheets (src/ui/food.js) or the scanner (src/scanner.js), and not the few that need a
// live activity, a running AI or an update to show. A sheet whose opener isn't in the app any more
// is listed as skipped; one whose opener is there and shows no sheet fails.
// Usage: node test/ui-sheetsize.mjs [--all] [--only=a,b] [--shots]
//   --all    390 and 360 px, each at 100% and 130% text
//   --shots  screenshots of every sheet to build/sheets/
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';
import { actBridge, seedActivities } from './actfixture.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : def; };
const ONLY = arg('only', '').split(',').filter(Boolean);
const SHOTS = process.argv.includes('--shots');
const COMBOS = process.argv.includes('--all') ? [[390, 1], [390, 1.3], [360, 1], [360, 1.3]] : [[390, 1], [360, 1.3]];
const OUT = join(root, 'build/sheets');
if (SHOTS) mkdirSync(OUT, { recursive: true });

// Someone five weeks in who also tracks food, trains at home and at a gym, and has a plan of their own.
function seedMore() {
  const GH = window.GH, S = GH.ui.S, F = GH.food;
  const day = GH.ui.today();
  F.setMode(S, 'full');
  F.add(S, day, { name: 'Oatmeal with milk', src: 'quick', g: 250, portion: '1 bowl', kcal: 320, p: 14, c: 48, f: 8, meal: 'breakfast' }, Date.now());
  S.profile.where = 'both';
  S.profile.gym = GH.brain.gymPreset('basic', S.profile.units);
  const C = GH.customPlan;
  if (C && !C.list(S).length) C.add(S, C.fromCoach(S, day));
  GH.store.save(S);
}
// WebView's text zoom scales every font size; this does the same to the open sheet.
function zoomText(f) {
  if (f === 1) return;
  const d = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop();
  if (!d) return;
  const els = [...d.querySelectorAll('*')].filter((e) => !e.closest('svg'));
  const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize));
  els.forEach((e, i) => { if (sizes[i]) e.style.setProperty('font-size', `${sizes[i] * f}px`, 'important'); });
  window.dispatchEvent(new Event('resize'));
}
// The top sheet as it rests.
function measure() {
  const d = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop();
  if (!d) return null;
  const W = innerWidth, H = innerHeight;
  const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0;
  const panel = d.querySelector('.gh-sheet-panel'), body = d.querySelector('.rf-sheet-body'), head = d.querySelector('.rf-sheet-header');
  const pr = panel.getBoundingClientRect(), br = body.getBoundingClientRect();
  const content = Math.round(body.offsetTop + body.scrollHeight);
  // The lowest content laid out in the body, and what's on screen of the panel.
  let low = br.top;
  for (const e of body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.height && r.width && getComputedStyle(e).visibility !== 'hidden') low = Math.max(low, r.bottom); }
  const mains = [...body.querySelectorAll('.rf-btn:is([data-variant="filled"], [data-variant="tinted"], [data-size="lg"], [data-size="xl"])')].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
  // Each one out of sight, and whether it's far down the content (its bottom, and the gap the
  // content ends with, past 86% of the screen: only then may an auto or fit sheet leave it to a scroll).
  const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
  const hidden = mains.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > H - sab + 1 || r.top < br.top - 1; }).map((b) => ({ label: (b.textContent || '').trim().slice(0, 30), far: body.offsetTop + body.scrollTop + b.getBoundingClientRect().bottom - br.top + pad > Math.round(H * 0.86) }));
  const problems = [];
  const name = (e) => `${e.tagName.toLowerCase()}.${String(e.className || '').trim().split(/\s+/).slice(0, 2).join('.')} "${(e.textContent || '').trim().slice(0, 30)}"`;
  const scrolls = (p) => { const ox = getComputedStyle(p).overflowX; return ox === 'auto' || ox === 'scroll'; };
  for (const e of panel.querySelectorAll('*')) {
    if (e.closest('svg') || e.closest('[aria-hidden="true"]') || e.classList.contains('rf-dot') || !e.getClientRects().length) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    let rail = false;
    for (let p = e.parentElement; p && p !== panel; p = p.parentElement) if (p.hasAttribute('data-hscroll')) { rail = true; break; }
    if (rail) continue;
    const r = e.getBoundingClientRect();
    if (r.right > Math.min(W, pr.right) + 1.5 || r.left < Math.max(0, pr.left) - 1.5) { problems.push(`past the edge: ${name(e)}`); continue; }
    const text = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (text && s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) problems.push(`cut off: ${name(e)}`);
    else if (text && (s.overflowX === 'hidden' || s.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 2 && s.whiteSpace === 'nowrap') problems.push(`clipped: ${name(e)}`);
    // (The label: the control's own nodes against its box, not a ::before that reaches past it as a
    // 44 px hit area, src/styles/controls.css, which scrollWidth would count.)
    if ((e.tagName === 'BUTTON' || e.classList.contains('rf-chip') || e.classList.contains('rf-segment')) && (() => { const rg = document.createRange(); rg.selectNodeContents(e); const c = rg.getBoundingClientRect(); return c.width > 0 && c.right > r.left + e.clientLeft + e.clientWidth + 2; })()) problems.push(`label wider than its control: ${name(e)}`);
    if (scrolls(e) && e.scrollWidth > e.clientWidth + 1 && !e.hasAttribute('data-hscroll')) problems.push(`scrolls sideways: ${name(e)}`);
  }
  const title = head.querySelector('.rf-sheet-title');
  if (title && title.scrollWidth > title.clientWidth + 1) problems.push(`title cut off: "${title.textContent.slice(0, 40)}"`);
  return { size: d.dataset.size, detent: d.dataset.detent, H: Math.round(pr.height), content, shown: Math.round(H - pr.top), gap: Math.round(Math.min(H, pr.bottom) - low), vh: H, hidden, problems: [...new Set(problems)].slice(0, 6) };
}

// [id, the opener it needs (null: always there), open]. open runs here with the helpers and leaves
// the sheet open.
const SHEETS = ({ page, act, ev, settle }) => {
  // A workout at the gym, on its first set with a weight to it.
  // A gym day, at a gym lift's set: only those have the weight button (a fast home squat from 60 can
  // carry dumbbells too).
  const workout = async () => { await ev(() => { const U = window.GH.ui; window.GH.brain.setPlace(U.S, U.today(), 'gym'); U.go('today'); }); await settle(600); await act('startWorkout'); await settle(1400); await ev(() => { const a = window.GH.ui.S.active; const i = a.steps.findIndex((x) => x.kind === 'set' && x.item && x.item.load && x.item.load.kg != null && window.GH.brain.isGymFam(x.item.fam)); a.idx = i >= 0 ? i : a.steps.findIndex((x) => x.kind === 'set'); }); };
  const plan = (fn) => ev(fn);
  return [
    ['act-rename', 'actRename', async () => { await page.evaluate(seedActivities); await settle(600); await ev(() => window.GH.ui.open('activity', 'seed-w1')); await settle(900); await act('actRename', 'seed-w1'); }],
    ['act-type', 'actStart', async () => { await act('actStart'); }],
    ['badge', 'badgeDetail', async () => { await ev(() => window.GH.ui.badgeDetail('first')); }],
    ['badge-locked', 'badgeDetail', async () => { await ev(() => window.GH.ui.badgeDetail('halfMarathon')); }],
    ['badge-reveal', 'badgeReveal', async () => { await ev(() => { const S = window.GH.ui.S; for (const id of ['w25', 'streak30']) S.achievements.earned[id] = { day: window.GH.ui.today(), at: Date.now(), opened: false }; window.GH.ui.badgeReveal(['w25', 'streak30']); }); }],
    ['share-badge', 'badgeShare', async () => { await act('badgeShare', 'first'); }],
    ['muscle', 'muscleSheet', async () => { await ev(() => window.GH.ui.go('progress')); await settle(900); await ev(() => window.GH.ui.muscleSheet('chest')); }],
    ['chat', 'askCoach', async () => { await act('askCoach'); }],
    ['chat-engine', 'chatEngineSheet', async () => { await act('askCoach'); await settle(900); await act('chatEngineSheet'); }],
    ['chat-list', 'chatList', async () => { await act('chatList'); }],
    ['chat-report', 'flagSheet', async () => { await ev(() => window.GH.ui.flagSheet({ kind: 'answer', text: 'Keep the same bedtime on weekends.', q: 'How do I sleep more?' })); }],
    ['claude-app', 'askClaudeApp', async () => { await act('askClaudeApp'); }],
    ['claude-model', 'claudeModel', async () => { await ev(() => { window.GH.ui.S.ai.mode = 'api'; window.AndroidBridge.loadSecret = () => 'sk-ant-api03-' + 'a'.repeat(60); }); await act('claudeModel'); }],
    ['claude-budget', 'claudeBudget', async () => { await act('claudeBudget', 'month'); }],
    ['claude-setup', 'claudeSetup', async () => { await ev(() => { window.GH.ui.claudeSetup(); }); }],
    ['consent', 'claudeConsent', async () => { await ev(() => { window.GH.ui.claudeConsent(); }); }],
    ['plans-new', 'cpNew', async () => { await act('cpNew'); }],
    ['plans-item', 'cpItem', async () => { await plan(() => { const U = window.GH.ui; U.open('planEdit', window.GH.customPlan.list(U.S)[0].id); }); await settle(900); await ev(() => window.GH.ui.act.cpItem({ dataset: { arg: '0:0' } })); }],
    ['plans-picker', 'cpAdd', async () => { await plan(() => { const U = window.GH.ui; U.open('planEdit', window.GH.customPlan.list(U.S)[0].id); }); await settle(900); await ev(() => window.GH.ui.act.cpAdd({ dataset: { arg: '0' } })); }],
    ['plans-menu', 'cpMenu', async () => { await ev(() => window.GH.ui.open('plans')); await settle(900); await ev(() => window.GH.ui.act.cpMenu({ dataset: { arg: window.GH.customPlan.list(window.GH.ui.S)[0].id }, getAttribute: () => null, closest: () => null, isConnected: false })); }],
    ['plans-share', 'cpShare', async () => { await plan(() => { const U = window.GH.ui, id = window.GH.customPlan.list(U.S)[0].id; U.open('planEdit', id); U.act.cpShare({ dataset: { arg: id } }); }); }],
    ['plans-import', null, async () => { await ev(async () => { const C = window.GH.customPlan; const p = C.normalize({ name: 'Sam\'s gym split', note: 'Heavy first, then the rest.', days: [{ title: 'Upper body', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'row_cable', sets: 3, reps: 10 }] }, { title: 'Lower', items: [{ move: 'squat_bb', sets: 4, reps: 6 }] }] }).plan; window.__gh.onLink(C.link(await C.encode(p, { from: 'Samantha' }))); }); }],
    ['plans-build', 'cpBuild', async () => { await act('cpBuild'); }],
    ['diag', 'scrollDiag', async () => { await act('scrollDiag'); }],
    ['tour', 'showTour', async () => { await ev(() => window.GH.ui.showTour()); }],
    ['whatsnew', 'showWhatsNew', async () => { await ev(() => window.GH.ui.showWhatsNew()); }],
    ['haptics', 'hapticGallery', async () => { await act('hapticGallery'); }],
    ['health-report', 'healthReport', async () => { await act('healthReport'); }],
    ['log-activity', 'logActivity', async () => { await act('logActivity'); }],
    ['log-measure', 'logMeasure', async () => { await act('logMeasure'); }],
    ['metric', 'metricSheet', async () => { await ev(() => window.GH.ui.metricSheet('weightKg')); }],
    ['metric-feel', 'metricSheet', async () => { await ev(() => window.GH.ui.metricSheet('feel')); }],
    ['metric-edit', 'metricEdit', async () => { await ev(() => window.GH.ui.metricEdit('rhr', window.GH.ui.today() - 1)); }],
    ['move', 'moveInfo', async () => { await ev(() => window.GH.ui.go('today')); await settle(700); await ev(() => { const b = document.querySelector('#screen .ex-name[data-act="moveInfo"]'); if (b) b.click(); }); await settle(900); }],
    ['ladder', 'ladder', async () => { await ev(() => { const L = window.GH.moves && window.GH.moves.LADDERS; window.GH.ui.act.ladder({ dataset: { arg: L ? Object.keys(L)[0] : 'push' } }); }); }],
    ['plan-around', 'planAround', async () => { await ev(() => { window.GH.ui.S.profile.conditions = ['ra', 'bp']; window.GH.ui.S.profile.age = 67; window.GH.ui.act.planAround(); }); }],
    ['setup-around', 'showOnboarding', async () => { await ev(() => window.GH.ui.showOnboarding()); await settle(900); for (let i = 0; i < 4; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(500); } await page.click('.onboard [data-act="obAround"]'); }],
    ['plan-phase', 'planPhase', async () => { await ev(() => window.GH.ui.go('plan')); await settle(900); await act('planPhase'); }],
    ['player-leave', 'startWorkout', async () => { await ev(() => window.GH.ui.go('today')); await settle(600); await act('startWorkout'); await settle(1400); await ev(() => window.__gh.back()); }],
    ['player-load', 'plLoad', async () => { await workout(); await act('plLoad'); }],
    ['player-swap', 'plSwap', async () => { await workout(); await act('plSwap'); }],
    ['name', 'editName', async () => { await act('editName'); }],
    ['why-plan', 'whyPlan', async () => { await act('whyPlan'); }],
    ['review', 'reviewPlan', async () => { await act('reviewPlan'); }],
    ['rule', null, async () => { await ev(() => window.GH.lazy('science').then(() => window.GH.ui.openRule(window.GH.science.RULES[2].id))); }],
    ['evidence', 'sciKey', async () => { await ev(() => window.GH.ui.open('science')); await settle(900); await act('sciKey'); }],
    ['answers', 'editAnswers', async () => { await act('editAnswers'); }],
    ['licenses', 'licensesSheet', async () => { await act('licensesSheet'); }],
    ['days', 'daysSheet', async () => { await act('daysSheet'); }],
    ['level-check', 'baselineSheet', async () => { await act('baselineSheet'); }],
    ['api-key', 'keySheet', async () => { await act('keySheet'); }],
    ['what-gets-sent', 'previewSheet', async () => { await act('previewSheet'); }],
    ['restore', 'restoreSheet', async () => { await act('restoreSheet'); }],
    ['privacy', 'showPrivacySheet', async () => { await ev(() => window.GH.ui.showPrivacySheet()); }],
    ['tailor', 'tailorPlan', async () => { await act('tailorPlan'); }],
    ['protein', 'addProtein', async () => { await act('addProtein'); }],
    ['help', 'openHelp', async () => { await act('openHelp'); }],
  ].filter(([id]) => !ONLY.length || ONLY.includes(id));
};

const server = await serveDist();
const browser = await chromium.launch();
const errors = [];
for (const [width, zoom] of COMBOS) {
  const tag = `${width} px, text at ${Math.round(zoom * 100)}%`;
  section(tag);
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  await page.addInitScript(seedBridge);
  await page.addInitScript(actBridge);
  // Small phones get a three-button navigation bar (48 px); the rest a gesture bar.
  if (width === 360) await page.addInitScript(() => { const t = setInterval(() => { if (window.AndroidBridge) { window.AndroidBridge.insets = () => JSON.stringify({ top: 30, bottom: 48, left: 0, right: 0, keyboard: false }); clearInterval(t); } }, 1); });
  await page.goto(server.url);
  await page.waitForSelector('.onboard:not([hidden])');
  await page.evaluate(seedState);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"] .session');
  await page.evaluate(seedMore);
  await page.reload();
  await page.waitForSelector('#screen[data-view="today"]');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.GH.ui.closeSheets());
  const settle = (ms = 700) => page.waitForTimeout(ms);
  // The top sheet at rest: not moving, and in the same place two looks running (a fixed pause alone
  // measured a sheet still on its way when the machine was busy).
  const rest = () => page.waitForFunction(() => {
    const d = [...document.querySelectorAll('dialog.gh-sheet[open]')].pop();
    if (!d) return true;
    const y = Math.round(d.querySelector('.gh-sheet-panel').getBoundingClientRect().top);
    const same = window.__restY === y;
    window.__restY = y;
    return same && !d.hasAttribute('data-moving');
  }, null, { polling: 150, timeout: 6000 }).catch(() => {});
  const ev = (fn) => page.evaluate(fn);
  const act = (name, a) => page.evaluate(([n, x]) => { const f = window.GH.ui.act[n]; return f ? f({ dataset: { arg: x }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, closest: () => null, classList: { contains: () => false } }) : null; }, [name, a]);
  const has = (name) => page.evaluate((n) => !!(window.GH.ui.act[n] || window.GH.ui[n]), name);
  const skipped = [];
  for (const [id, needs, open] of SHEETS({ page, act, ev, settle })) {
    if (needs && !await has(needs)) { skipped.push(id); continue; }
    let r = null, err = '';
    try {
      await open();
      await settle(1000);
      await rest();
      await page.evaluate(zoomText, zoom);
      await settle(600);
      await rest();
      r = await page.evaluate(measure);
      if (r && SHOTS) await page.screenshot({ path: join(OUT, `${width}-${Math.round(zoom * 100)}-${id}.png`) });
    } catch (e) { err = e.message.split('\n')[0]; }
    if (!check(`${id}: it opens`, !!r, err || 'no sheet')) { await page.evaluate(() => window.GH.ui.closeSheets()); continue; }
    const fits = r.content <= Math.round(r.vh * 0.86);
    const what = `${r.size} at ${r.detent}: content ${r.content} px, ${r.shown} px of it on screen, ${r.gap} px empty under it`;
    if (r.size === 'full') check(`${id}: full, and long enough to fill it`, r.content >= r.H - 100 && r.gap < 160, what);
    else check(`${id}: ${r.size}, ${fits ? 'all of it in sight as it opens' : 'too long for the screen, so it scrolls'}`, !fits || r.shown >= r.content - 2, what);
    check(`${id}: its main buttons in sight`, r.hidden.every((b) => r.size !== 'full' && !fits && b.far), `${r.hidden.map((b) => `${b.label}${b.far ? '' : ' (within 86% of the screen)'}`).join(', ')} out of sight (${what})`);
    check(`${id}: nothing past its sides or cut off`, !r.problems.length, r.problems.join('\n      '));
    // Back to Today with nothing open: no sheet, no player, no page on top.
    await page.evaluate(() => { const U = window.GH.ui, S = U.S, pl = document.querySelector('.player'); U.closeSheets(); S.active = null; if (pl && !pl.hidden && U.playerBack) U.playerBack(); while (U.back()) { /* back */ } U.go('today'); });
    await settle(700);
  }
  if (skipped.length) console.log(`  skipped (their opener isn't in the app): ${skipped.join(', ')}`);
  await ctx.close();
}
section('Console');
check('no console errors', errors.length === 0, errors.slice(0, 6).join('\n      '));
await browser.close();
await server.close();
done();
