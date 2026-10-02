// The AI plan review in Chromium with someone five weeks in: Why this plan (no AI needed), the rows on
// You and in Plan's Make it yours, the Coach's review with no AI set up, with a stand-in on-device
// model (the grammar it's held to, the wait with progress and Stop, a card for each change that passes,
// the switches, Apply with undo, what wasn't applied and why, an error and Retry), a split tried from
// Why this plan, the weekly report's plan ideas from Claude (the API mocked), and Claude chat's red
// flags and number check.
// Usage: node test/ui-review.mjs [--dark] [--width=360]
import { createRequire } from 'node:module';
import { check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Claude's API, mocked: the model list, and each request answered from the schema it sent (the
// weekly report with plan ideas built from its own enums), or a chat answer as a stream.
const anthropic = [];
let chatAnswer = 'Keep your bedtime steady on weekends.';
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
function stream(text) {
  const chunks = text.match(/[\s\S]{1,12}/g) || [];
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_t', type: 'message', role: 'assistant', model: 'opus-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map((c) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}
await ctx.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  const url = req.url();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  anthropic.push({ url, body });
  if (url.includes('/v1/models')) {
    const m = { type: 'model', id: 'opus-test', display_name: 'Opus Test', created_at: '2026-09-01T00:00:00Z', capabilities: { effort: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } } } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [m], has_more: false, first_id: m.id, last_id: m.id }) });
  }
  const fmt = body && body.output_config && body.output_config.format;
  let text = chatAnswer;
  if (fmt) {
    const props = fmt.schema.properties;
    const report = { headline: 'A steady week.', glance: [], wins: ['4 of 4 workouts'], watch: [], focus: ['Keep going.'], focus_one: 'Keep going', ask_me: ['How is my sleep?'] };
    if (props.plan_suggestions) {
      const v = Object.fromEntries(props.plan_suggestions.items.anyOf.map((x) => [x.properties.kind.enum[0], x.properties]));
      report.plan_suggestions = [
        { kind: 'swap_move', family: v.swap_move.family.enum[0], move: v.swap_move.move.enum[0], title: 'A new move to try', why: 'It works the same muscles a new way.' },
        { kind: 'move_day', from: v.move_day.from.enum[v.move_day.from.enum.length - 1], to: v.move_day.to.enum[v.move_day.to.enum.length - 1], title: 'Move your last workout', why: 'More rest before it.' },
      ];
      report.plan_note = 'Your plan suits your goals.';
    }
    text = JSON.stringify(report);
  }
  return route.fulfill({ status: 200, contentType: 'text/event-stream', body: stream(text) });
});

await page.addInitScript(seedBridge);
const server = await serveDist();
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const go = async (t) => { await ev((x) => window.GH.ui.go(x), t); await wait(500); };
const closeAll = async () => { await ev(() => window.GH.ui.closeSheets()); await wait(700); };
const sheetTitle = () => ev(() => { const t = window.GH.ui.topSheet(); return t ? t.el.querySelector('.rf-sheet-title').textContent : null; });
const overflow = () => ev(() => { const d = window.GH.ui.topSheet(); if (!d) return 'no sheet'; const b = d.el.querySelector('.rf-sheet-body'); const bad = [...b.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1); return b.scrollWidth > b.clientWidth + 1 ? 'scrolls sideways' : bad.length ? bad.slice(0, 3).map((e) => e.className).join() : ''; });

section('Where it is');
check('the review is in the app', await ev(() => !!(window.GH.planReview && window.GH.planReview.available && window.GH.planReview.open && window.GH.ui.act.reviewPlan && window.GH.ui.act.whyPlan)));
await go('you');
check('You: Check my plan with AI, under Your plans', await ev(() => !!document.querySelector('#screen ul[data-key="plans"] [data-act="reviewPlan"]')));
await go('plan');
check('Plan\'s Make it yours: Why this plan and Check my plan with AI', await ev(() => !!document.querySelector('#screen ul[data-key="mine"] [data-act="whyPlan"]') && !!document.querySelector('#screen ul[data-key="mine"] [data-act="reviewPlan"]')));
check('with no AI set up, it says so', await ev(() => window.GH.planReview.available(window.GH.ui.S) === false));

section('Why this plan');
await page.click('#screen ul[data-key="mine"] [data-act="whyPlan"]');
await page.waitForSelector('dialog.why-sheet[open] .wy-hero');
await wait(600);
const why = await ev(() => {
  const el = document.querySelector('dialog.why-sheet[open]');
  const ex = window.GH.optimizer.explain(window.GH.ui.S, window.GH.ui.today());
  return {
    ex: { headline: ex.headline, considered: ex.considered, reasons: ex.reasons.length, parts: ex.parts },
    headline: el.querySelector('.wy-headline').textContent,
    compared: el.querySelector('.wy-compared').textContent.replace(/\s+/g, ' ').trim(),
    reasons: el.querySelectorAll('.wy-reasons > li').length,
    meters: [...el.querySelectorAll('.wy-meter')].map((m) => ({ name: m.querySelector('.wy-m-name').firstChild.textContent, v: Number(m.querySelector('[role="meter"]').getAttribute('aria-valuenow')) })),
    alts: [...el.querySelectorAll('.wy-alt')].map((a) => ({ name: a.querySelector('.wy-alt-name').textContent, score: Number(a.querySelector('.wy-alt-score b').textContent), current: a.classList.contains('is-current'), note: (a.querySelector('.wy-alt-note') || {}).textContent || '', days: a.querySelectorAll('.wy-day').length, tryIt: !!a.querySelector('[data-act="whyTry"]') })),
  };
});
check('the headline is the planner\'s', why.headline === why.ex.headline, why.headline);
check('"We compared N weekly plans", N from the planner', why.compared === `We compared ${why.ex.considered.toLocaleString('en-US')} weekly plans and picked this one.`, why.compared);
check('its reasons, each one', why.reasons === why.ex.reasons && why.reasons >= 3, why.reasons);
check('the six parts of the score as meters, with plain names', why.meters.map((m) => m.name).join() === 'Your goals,Every muscle,Your time,Recovery,Balance,Variety' && why.meters.every((m) => m.v === Math.round(why.ex.parts[{ 'Your goals': 'goal', 'Every muscle': 'coverage', 'Your time': 'time', Recovery: 'recovery', Balance: 'balance', Variety: 'variety' }[m.name]] * 100)), why.meters);
const cur = why.alts.filter((a) => a.current);
const others = why.alts.filter((a) => !a.current);
check('the plan in force, marked, then the other ways to split the week, each with its score', cur.length === 1 && others.length === 3 && why.alts.every((a) => a.score >= 0 && a.score <= 100 && a.days >= 2), why.alts);
check('each one says why the planner didn\'t pick it', others.every((a) => a.note.length > 10 && /\.$/.test(a.note)), others.map((a) => a.note));
check('full body, upper and lower, push, pull and legs are all there', ['Full body', 'Upper and lower', 'Push, pull and legs'].every((n) => why.alts.some((a) => a.name === n) || cur[0].name === n));
check('nothing runs off the side', (await overflow()) === '', await overflow());

section('Trying a split from Why this plan');
const tried = others.find((a) => a.tryIt);
if (tried) {
  await page.click(`dialog.why-sheet[open] .wy-alt [data-act="whyTry"]`);
  await page.waitForSelector('dialog.rv-sheet[open] .rv-result', { timeout: 10000 });
  await wait(500);
  const t = await ev(() => { const el = document.querySelector('dialog.rv-sheet[open]'); return { by: el.querySelector('.rv-by').textContent, cards: el.querySelectorAll('.rv-card').length, not: el.querySelectorAll('.rv-not li').length, reason: (el.querySelector('.rv-not-why') || {}).textContent || '' }; });
  check('it\'s checked like any suggestion: a card, or the reason it can\'t be', /Checked by the planner/.test(t.by) && t.cards + t.not === 1, t);
  await closeAll();
}

section('With no AI set up');
await ev(() => window.GH.ui.act.reviewPlan());
await page.waitForSelector('dialog.rv-sheet[open] .rv-none', { timeout: 10000 });
check('the Coach\'s review offers the on-device coach, Claude and Why this plan', await ev(() => ['reviewModels', 'reviewClaude', 'whyPlan'].every((a) => !!document.querySelector(`dialog.rv-sheet[open] .rv-options [data-act="${a}"]`))));
check('it\'s called the Coach\'s review', (await sheetTitle()) === 'Coach\'s review');
await page.click('dialog.rv-sheet[open] [data-act="reviewModels"]');
await wait(400);
check('the on-device sizes show right there', await ev(() => !!document.querySelector('dialog.rv-sheet[open] .rv-models')));
await page.click('dialog.rv-sheet[open] .rv-options [data-act="whyPlan"]');
await page.waitForSelector('dialog.why-sheet[open]', { timeout: 5000 });
check('and Why this plan opens from it', (await sheetTitle()) === 'Why this plan');
await closeAll();

section('The on-device coach');
// A stand-in on-device model: it answers with suggestions made from what its grammar allows (a swap,
// a day moved, a split, more sets, a tip), word by word, as slowly as asked; or fails once on request.
await ev(() => {
  const GH = window.GH, U = GH.ui;
  const real = GH.lazy;
  window.__llm = { delay: 20, fail: 0, calls: 0, grammar: '', msgs: null };
  const L = window.__llm;
  const fake = {
    MODELS: [], available: () => ({ ok: true, reason: '' }), installed: async () => [{ id: 'stand-in' }], loaded: () => ({ id: 'stand-in' }), load: async () => ({}), stats: { aborted: false },
    chat: async (msgs, o) => {
      L.calls++; L.grammar = o.grammar; L.msgs = msgs;
      if (L.fail > 0) { L.fail--; const e = new Error('The on-device model stopped answering. Try again.'); e.code = 'stalled'; throw e; }
      const vals = (rule) => { const line = o.grammar.split('\n').find((l) => l.startsWith(`${rule} ::=`)); return line ? [...line.slice(line.indexOf('::=') + 3).matchAll(/"((?:\\"|[^"])*)"/g)].map((m) => m[1].replace(/\\"/g, '"')) : []; };
      const fam = JSON.parse(vals('family')[0]), move = JSON.parse(vals('move')[0]);
      const from = Number(vals('from').pop()), to = Number(vals('to').pop());
      const out = JSON.stringify({ suggestions: [
        { kind: 'swap_move', family: fam, move, title: 'A new move to try', why: 'It works the same muscles a new way.' },
        { kind: 'move_day', from, to, title: 'Move your last workout', why: 'More rest before it.' },
        { kind: 'split', split: 'auto', title: 'Keep the planner\'s split', why: 'It already fits.' },
      ], note: 'Your plan fits your goals.' });
      if (o.onPrompt) o.onPrompt(40, 100);
      let s = '';
      for (const piece of out.match(/[\s\S]{1,24}/g)) {
        if (o.signal && o.signal.aborted) { fake.stats = { aborted: true }; return s; }
        s += piece;
        if (o.onToken) o.onToken(piece, s);
        await new Promise((r) => setTimeout(r, L.delay));
      }
      fake.stats = { aborted: false };
      return s;
    },
  };
  GH.lazy = async (name) => (name === 'llm' ? fake : real(name));
  Object.assign(U.deviceState(), { checked: true, available: { ok: true, reason: '' }, installed: [{ id: 'stand-in' }] });
  U.checkDevice = async () => U.deviceState();
  GH.deviceCoach.pick = () => 'stand-in';
  U.S.ai.mode = 'device';
});
check('with a model on the phone, the review is available', await ev(() => window.GH.planReview.available(window.GH.ui.S) && window.GH.planReview.engine(window.GH.ui.S) === 'device'));
await ev(() => { window.__llm.delay = 60; window.GH.ui.act.reviewPlan(); });
await page.waitForSelector('dialog.rv-sheet[open] .rv-wait .rv-status', { timeout: 10000 });
await page.waitForFunction(() => /\d+% · \d+ s$/.test((document.querySelector('dialog.rv-sheet[open] .rv-status') || {}).textContent || ''), null, { timeout: 10000 });
const busy = await ev(() => { const el = document.querySelector('dialog.rv-sheet[open]'); return { status: el.querySelector('.rv-status').textContent, bar: !!el.querySelector('.rv-bar .rf-progress'), stop: !!el.querySelector('[data-act="reviewStop"]') }; });
check('while it thinks: what it\'s doing, how far along, and Stop', /^(Starting the on-device coach|Reading your plan|Writing its suggestions) \d+% · \d+ s$/.test(busy.status) && busy.bar && busy.stop, busy);
await ev(() => { window.__llm.delay = 0; });
await page.waitForSelector('dialog.rv-sheet[open] .rv-result', { timeout: 30000 });
await wait(700);
const gram = await ev(() => window.__llm.grammar);
check('the model is held to the review\'s grammar', /^root ::= "\{\\"suggestions\\":\["/.test(gram) && /swap-move ::= /.test(gram) && gram.split('\n').find((l) => l.startsWith('move ::=')).split('|').length <= 60);
check('and reads the plan and the person, on the phone', await ev(() => { const s = window.__llm.msgs[0].content; return /PLAN \(next week/.test(s) && /PERSON/.test(s) && /MOVES/.test(s); }));
const res = await ev(() => {
  const GH = window.GH, U = GH.ui, el = document.querySelector('dialog.rv-sheet[open]');
  const r = U.S.ai.review;
  return {
    stored: r ? { items: r.items.map((x) => x.title), rejected: r.rejected.map((x) => x.reason) } : null,
    by: el.querySelector('.rv-by').textContent,
    note: (el.querySelector('.rv-note') || {}).textContent || '',
    cards: [...el.querySelectorAll('.rv-card')].map((c) => ({ title: c.querySelector('.rf-list-title').textContent, why: (c.querySelector('.rf-list-sub') || {}).textContent || '', diff: [...c.querySelectorAll('.rv-diff li')].map((l) => l.textContent), score: c.querySelector('.rv-score').textContent, on: c.querySelector('input[role="switch"]').checked })),
    not: [...el.querySelectorAll('.rv-not li')].map((l) => ({ title: l.querySelector('.rv-not-title').textContent, why: l.querySelector('.rv-not-why').textContent })),
    apply: (el.querySelector('[data-act="reviewApply"]') || {}).textContent || '',
  };
});
check('it says who checked it, and its note', /Checked by the on-device coach/.test(res.by) && res.note === 'Your plan fits your goals.', res);
check('a card for each change that passed, with its title, why, what it changes and the score in words', res.cards.length >= 1 && res.cards.every((c) => c.title && c.why && c.diff.length && /out of 100/.test(c.score)), res.cards);
check('each switch starts on', res.cards.every((c) => c.on) && /^Apply (this change|all \d)/.test(res.apply), res.apply);
check('what wasn\'t applied, and why: the split it already has', res.not.some((x) => x.title === 'Keep the planner\'s split' && /already picks your split/.test(x.why)), res.not);
check('the sheet matches the checked review the app kept', res.stored && res.stored.items.join('|') === res.cards.map((c) => c.title).join('|') && res.stored.rejected.length === res.not.length);
check('nothing runs off the side', (await overflow()) === '', await overflow());
// Turn the first one off: the button follows, and only the rest is applied.
const before = await ev(() => JSON.stringify({ t: window.GH.ui.S.profile.planTweaks || null, w: window.GH.ui.S.profile.weekdays || null }));
await ev(() => document.querySelector('dialog.rv-sheet[open] .rv-card input[role="switch"]').click());
await wait(400);
const off = await ev(() => { const el = document.querySelector('dialog.rv-sheet[open]'); return { label: el.querySelector('[data-act="reviewApply"]').textContent, dim: el.querySelector('.rv-card').hasAttribute('data-off'), disabled: el.querySelector('[data-act="reviewApply"]').getAttribute('aria-disabled') }; });
check('a switch turned off fades its card, and the button says how many', off.dim && (res.cards.length === 1 ? off.disabled === 'true' && /Pick a change/.test(off.label) : /Apply \d+ selected/.test(off.label)), off);
await ev(() => document.querySelector('dialog.rv-sheet[open] .rv-card input[role="switch"]').click());
await wait(400);
const reviewed0 = await ev(() => { const a = window.GH.ui.S.achievements; return (a && a.events && a.events.reviewed && a.events.reviewed.n) || 0; });
await page.click('dialog.rv-sheet[open] [data-act="reviewApply"]');
await wait(900);
const applied = await ev(() => {
  const GH = window.GH, U = GH.ui, S = U.S;
  const e = S.events[S.events.length - 1];
  const a = S.achievements;
  return { open: !!document.querySelector('dialog.rv-sheet[open]'), event: e.type, lines: e.lines, engine: e.engine, tweaks: S.profile.planTweaks || null, weekdays: S.profile.weekdays, reviewed: (a && a.events && a.events.reviewed && a.events.reviewed.n) || 0, timeline: GH.coach.timeline(S, U.today(), 2).map((x) => x.text), kept: S.ai.review };
});
check('Apply writes the changes and closes the sheet', !applied.open && applied.event === 'review' && applied.engine === 'device' && applied.lines.length === res.cards.length, applied);
check('the swap is in the plan', !!(applied.tweaks && Object.keys(applied.tweaks.swaps || {}).length), applied.tweaks);
check('it counts toward the Second opinion badge', applied.reviewed === reviewed0 + 1, { before: reviewed0, after: applied.reviewed });
check('the coach\'s notes list it', applied.timeline.some((x) => /^Plan checked: /.test(x)), applied.timeline);
check('the next check starts afresh', applied.kept === null);
await ev(() => window.GH.ui.act.reviewUndo());
await wait(500);
check('Undo puts the plan back as it was', await ev((b) => JSON.stringify({ t: window.GH.ui.S.profile.planTweaks || null, w: window.GH.ui.S.profile.weekdays || null }) === b, before));

section('Stop');
await ev(() => { window.__llm.delay = 250; window.GH.ui.act.reviewPlan(); });
await page.waitForSelector('dialog.rv-sheet[open] [data-act="reviewStop"]', { timeout: 10000 });
await page.waitForFunction(() => /Writing/.test((document.querySelector('dialog.rv-sheet[open] .rv-status') || {}).textContent || ''), null, { timeout: 10000 });
await page.click('dialog.rv-sheet[open] [data-act="reviewStop"]');
await page.waitForSelector('dialog.rv-sheet[open] .rv-msg', { timeout: 10000 });
check('Stop ends it, and says nothing changed', await ev(() => /Stopped/.test(document.querySelector('dialog.rv-sheet[open] .rv-msg').textContent) && /Nothing in your plan changed/.test(document.querySelector('dialog.rv-sheet[open] .rv-msg').textContent) && !window.GH.ui.S.ai.review));
await closeAll();

section('An error, then Retry');
await ev(() => { window.__llm.delay = 0; window.__llm.fail = 1; window.GH.ui.act.reviewPlan(); });
await page.waitForSelector('dialog.rv-sheet[open] .notice[data-tone="critical"]', { timeout: 10000 });
check('the error shows in the sheet, with Retry', await ev(() => /stopped answering/.test(document.querySelector('dialog.rv-sheet[open] .notice').textContent) && !!document.querySelector('dialog.rv-sheet[open] [data-act="reviewAgain"]')));
await page.click('dialog.rv-sheet[open] [data-act="reviewAgain"]');
await page.waitForSelector('dialog.rv-sheet[open] .rv-result', { timeout: 30000 });
check('Retry asks again and shows the review', await ev(() => document.querySelectorAll('dialog.rv-sheet[open] .rv-card').length >= 1));
await closeAll();
check('opened again with the plan as it was, the review is still there (no new wait)', await ev(async () => { const n = window.__llm.calls; window.GH.ui.act.reviewPlan(); await new Promise((r) => setTimeout(r, 600)); return !!document.querySelector('dialog.rv-sheet[open] .rv-result') && window.__llm.calls === n; }));
await closeAll();

section('Claude: the weekly report\'s plan ideas');
await ev(() => {
  const U = window.GH.ui, S = U.S;
  window.AndroidBridge.loadSecret = () => `sk-ant-api03-${'a'.repeat(60)}`;
  S.ai.mode = 'api'; S.ai.enabled = true; S.ai.consentAt = Date.now(); S.ai.review = null;
  window.GH.store.save(S);
});
check('with Claude on, the review is Claude\'s', await ev(() => window.GH.planReview.engine(window.GH.ui.S) === 'claude'));
await go('health');
const n0 = anthropic.length;
await ev(() => window.GH.ui.act.aiReport());
await page.waitForFunction(() => { const r = window.GH.ai.reportFor(window.GH.ui.S, window.GH.ui.today()); return !!(r && r.plan); }, null, { timeout: 30000 });
const sent = anthropic.slice(n0).filter((x) => /\/v1\/messages/.test(x.url));
check('the report\'s one request asks for plan ideas too', sent.length === 1 && !!sent[0].body.output_config.format.schema.properties.plan_suggestions && /PLAN IDEAS/.test(sent[0].body.messages[0].content), sent.length);
await ev(() => window.GH.ui.act.healthReport());
await page.waitForSelector('dialog.rs-sheet[open] .rv-ideas', { timeout: 10000 });
await wait(500);
const ideas = await ev(() => { const el = document.querySelector('dialog.rs-sheet[open] .rv-ideas'); return { titles: [...el.querySelectorAll('.rs-list li')].map((l) => l.textContent), go: !!el.querySelector('[data-act="reviewPlanIdeas"]') }; });
check('the report shows its Plan ideas, with a way to look them over', ideas.titles.join('|') === 'A new move to try|Move your last workout' && ideas.go, ideas);
await page.click('dialog.rs-sheet[open] [data-act="reviewPlanIdeas"]');
await page.waitForSelector('dialog.rv-sheet[open] .rv-result', { timeout: 10000 });
await wait(500);
const fromRep = await ev(() => { const el = document.querySelector('dialog.rv-sheet[open]'); return { by: el.querySelector('.rv-by').textContent, cards: el.querySelectorAll('.rv-card').length, not: el.querySelectorAll('.rv-not li').length }; });
check('they open in the Coach\'s review, checked against the plan as it is', /Checked by Claude/.test(fromRep.by) && fromRep.cards + fromRep.not === 2, fromRep);
check('without asking Claude again', anthropic.slice(n0).filter((x) => /\/v1\/messages/.test(x.url)).length === 1);
if (fromRep.cards) {
  await page.click('dialog.rv-sheet[open] [data-act="reviewApply"]');
  await wait(900);
  check('applied from the report, the report says so', await ev(() => { const r = window.GH.ai.reportFor(window.GH.ui.S, window.GH.ui.today()); return r.plan.applied >= 1 && !document.querySelector('dialog.rv-sheet[open]'); }));
  await ev(() => window.GH.ui.act.reviewUndo());
  await wait(400);
}
await closeAll();

section('Claude chat: red flags and the number check');
await ev(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open] .chat-compose:not([hidden])', { timeout: 10000 });
const n1 = anthropic.length;
await page.fill('#askQ', 'I get chest pain when I train');
await page.click('dialog.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => /doctor/.test(([...document.querySelectorAll('.chat-sheet .bubble.coach')].pop() || {}).textContent || ''), null, { timeout: 10000 });
check('a red-flag question gets the app\'s own safety answer, and nothing goes to Claude', anthropic.length === n1 && await ev(() => { const c = window.GH.ui.S.ai.chat; return c[c.length - 1].safety === true; }));
chatAnswer = 'Your sleep looks steady this week. Studies say 64% of people sleep less than you do.';
await page.fill('#askQ', 'How is my sleep?');
await page.click('dialog.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => { const c = window.GH.ui.S.ai.chat; return c.length && c[c.length - 1].role === 'assistant' && !c[c.length - 1].safety; }, null, { timeout: 20000 });
await wait(500);
const chat = await ev(() => { const m = [...document.querySelectorAll('.chat-sheet .msg.coach')].pop(); return { text: m.querySelector('.bubble').textContent, note: (m.querySelector('.msg-note') || {}).textContent || '' }; });
check('after it streams in, a sentence with a number that wasn\'t sent is left out, with the same note as on the phone', !/64%/.test(chat.text) && /steady/.test(chat.text) && /Left out a line with a number that isn't in your data/.test(chat.note), chat);
check('the safety exchange wasn\'t sent with it', !JSON.stringify(anthropic.slice(n1).filter((x) => x.body && x.body.messages).map((x) => x.body.messages)).includes('I get chest pain'));
await closeAll();

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
