// Claude's settings in Chromium, against a mocked API: adding a key leads to picking a model and a
// monthly budget; Settings shows the model, thinking level and today's spending; the model and
// thinking sheet changes what each request asks for; an answer drawn as a card (a table, the embed
// Claude placed, one it can't draw dropped, one the app adds when it placed none) and a chat's
// earlier turns going with a follow-up; Claude's page shows the limits and the usage; a limit's
// sheet saves an amount; and a request that could go over a limit isn't sent, with the chat
// pointing to the limits.
// Usage: node test/ui-claude.mjs [--dark] [--width=360]
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

// Claude's API, mocked: every request is answered as a stream that used 2,000 tokens in and 400 out.
// A request for a plan (Build me a plan, Improve) gets its own draft back with one set fewer on the
// first move of the first day that has more than one (so it still fits the time and the checks).
const anthropic = [];
let chatText = 'Keep your bedtime steady on weekends.'; // what a question gets back
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
function stream(text, model) {
  const chunks = text.match(/[\s\S]{1,12}/g) || [];
  return sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_t', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ...chunks.map((c) => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }]),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 400 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);
}
await ctx.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  anthropic.push({ url: req.url(), body });
  const fmt = body && body.output_config && body.output_config.format;
  let text = chatText;
  if (fmt && fmt.schema.properties.days) {
    const draft = JSON.parse(/Draft: (\{.*\})/.exec(body.messages[0].content)[1]);
    const it = draft.days[0].items.find((x) => x.sets > 1);
    if (it) it.sets -= 1;
    draft.note = 'One more set where you start each week.';
    text = JSON.stringify(draft);
  }
  return route.fulfill({ status: 200, contentType: 'text/event-stream', body: stream(text, body && body.model) });
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
const closeAll = async () => { await ev(() => window.GH.ui.closeSheets()); await wait(700); };
const sheetTitle = () => ev(() => { const t = window.GH.ui.topSheet(); return t ? t.el.querySelector('.rf-sheet-title').textContent : null; });
const sideways = () => ev(() => { const el = document.scrollingElement; const bad = [...document.querySelectorAll('#screen *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1); return el.scrollWidth > innerWidth + 1 ? 'page scrolls sideways' : bad.slice(0, 3).map((e) => e.className).join(); });
const messages = () => anthropic.filter((x) => /\/v1\/messages/.test(x.url));

section('Adding a key');
await ev(() => { const S = window.GH.ui.S; S.ai.mode = 'api'; window.GH.store.save(S); window.GH.ui.open('settings'); });
await wait(600);
let secret = '';
await ev(() => { window.AndroidBridge.saveSecret = (k, v) => { window.__secret = v; return true; }; window.AndroidBridge.loadSecret = () => window.__secret || ''; });
await ev(() => window.GH.ui.act.keySheet());
await page.waitForSelector('dialog[open] #apiKey');
await page.fill('#apiKey', `sk-ant-api03-${'a'.repeat(60)}`);
await page.click('dialog[open] [data-act="keySave"]');
await page.waitForSelector('dialog[open] [data-act="claudeAllow"]', { timeout: 10000 });
await wait(400);
await page.click('dialog[open] [data-act="claudeAllow"]');
await page.waitForFunction(() => { const t = window.GH.ui.topSheet(); return t && /Set up Claude/.test(t.el.querySelector('.rf-sheet-title').textContent); }, null, { timeout: 10000 });
await wait(500);
const setup = await ev(() => { const el = window.GH.ui.topSheet().el; return { models: [...el.querySelectorAll('[data-act="claudePickModel"]')].map((b) => b.dataset.arg), picked: (el.querySelector('[data-act="claudePickModel"][aria-checked="true"]') || {}).dataset, think: [...el.querySelectorAll('[data-key="choice:clSetupThink"] [data-arg]')].map((b) => b.dataset.arg), budget: !!el.querySelector('[data-key="choice:clSetupBudget"]') }; });
check('after the key and the OK, a sheet to pick the model, its thinking and a monthly budget', setup.models.join() === 'claude-fable-5-1,claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5' && setup.picked && setup.picked.arg === 'claude-opus-5-5' && setup.think.join() === 'auto,low,medium,high,xhigh,max' && setup.budget, setup);
await page.click('dialog[open] [data-act="claudePickModel"][data-arg="claude-sonnet-5-5"]');
await wait(300);
await page.click('dialog[open] [data-key="choice:clSetupThink"] [data-arg="high"]');
await wait(300);
await page.click('dialog[open] [data-key="choice:clSetupBudget"] [data-arg="20"]');
await wait(300);
await page.click('dialog[open] [data-act="claudeSetupDone"]');
await wait(900);
const after = await ev(() => ({ model: window.GH.ui.S.ai.claude.model, think: window.GH.ui.S.ai.claude.think, monthly: window.GH.ui.S.ai.budget.monthly, mode: window.GH.ui.S.ai.mode, sheet: !!window.GH.ui.topSheet() }));
check('what they picked is kept, and Claude is on', after.model === 'claude-sonnet-5-5' && after.think === 'high' && after.monthly === 20 && after.mode === 'api' && !after.sheet, after);

section('Settings');
await ev(() => window.GH.ui.render());
await wait(400);
const rows = await ev(() => ({ model: (document.querySelector('[data-key="claude-model"] .rf-list-detail') || {}).textContent, spend: (document.querySelector('[data-key="claude-spend"] .rf-list-sub') || {}).textContent }));
check('AI coach shows the model with its thinking level, and today\'s spending against the limit', rows.model === 'Sonnet 5.5 · High' && /^\$0\.00 of \$\d+\.\d\d today$/.test(rows.spend || ''), rows);
check('nothing was sent to Claude for any of this', messages().length === 0, messages().length);

section('Model and thinking');
await page.click('[data-key="claude-model"] .rf-list-row');
await page.waitForFunction(() => { const t = window.GH.ui.topSheet(); return t && /Model and thinking/.test(t.el.querySelector('.rf-sheet-title').textContent); }, null, { timeout: 10000 });
await wait(500);
const levels = (await ev(() => [...window.GH.ui.topSheet().el.querySelectorAll('[data-act="claudePickLevel"]')].map((b) => b.dataset.arg))).join();
check('Sonnet 5.5 offers every level, Off included', levels === 'auto,off,low,medium,high,xhigh,max', levels);
const priced = await ev(() => [...window.GH.ui.topSheet().el.querySelectorAll('.cl-price')].map((x) => x.textContent));
check('each model shows its prices and about what a question costs', priced.length === 7 && priced.every((t) => /per million tokens · (under 1¢|about (\d+¢|\$[\d.]+)) a question$/.test(t)), priced[0]);
await page.click('dialog[open] [data-act="claudePickModel"][data-arg="claude-opus-5-5"]');
await wait(400);
const opusLevels = (await ev(() => [...window.GH.ui.topSheet().el.querySelectorAll('[data-act="claudePickLevel"]')].map((b) => b.dataset.arg))).join();
check('Opus 5.5 always thinks a little, so it has no Off', opusLevels === 'auto,low,medium,high,xhigh,max', opusLevels);
await page.click('dialog[open] [data-act="claudePickModel"][data-arg="claude-haiku-5-5"]');
await wait(300);
await page.click('dialog[open] [data-act="claudePickLevel"][data-arg="off"]');
await wait(300);
check('a pick is kept at once', await ev(() => window.GH.ui.S.ai.claude.model === 'claude-haiku-5-5' && window.GH.ui.S.ai.claude.think === 'off'));
await closeAll();

section('A question with that model');
await ev(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open] .chat-compose:not([hidden])', { timeout: 10000 });
check('the chat\'s pill says which model and level answer', /Haiku 5\.5 · Off/.test(await ev(() => document.querySelector('.chat-sheet .chat-pill').textContent)));
await page.fill('#askQ', 'How is my sleep?');
await page.click('dialog.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => { const c = (window.GH.chats.current(window.GH.ui.S) || { msgs: [] }).msgs; return c.length && c[c.length - 1].role === 'assistant'; }, null, { timeout: 20000 });
await wait(500);
const q = messages().pop().body;
check('it went to Haiku 5.5 with thinking off and no backup model', q.model === 'claude-haiku-5-5' && q.thinking.type === 'disabled' && ['low', 'medium', 'high'].includes(q.output_config.effort) && !q.fallbacks, { model: q.model, thinking: q.thinking, effort: q.output_config.effort });
const meta = await ev(() => ([...document.querySelectorAll('.chat-sheet .msg.coach')].pop().querySelector('.msg-meta') || {}).textContent);
check('the answer says which model wrote it and what it cost', meta === 'Haiku 5.5 · under 1¢', meta);
await closeAll();

section('Answers as cards, and the chat\'s turns');
{
  const conv = () => ev(() => { const c = window.GH.chats.current(window.GH.ui.S); return c ? c.msgs : []; });
  const settled = (n) => page.waitForFunction((k) => { const c = window.GH.chats.current(window.GH.ui.S); return c && c.msgs.length >= k && !document.querySelector('.chat-sheet #chatLive'); }, n, { timeout: 30000 });
  chatText = 'Your steps are **steady** this week.\n\n| Day | Plan |\n|---|---|\n| Monday | Rest |\n| Tuesday | Walk |\n\n[[steps]]\n\n[[nonsense]]\n\nNext step: a walk after dinner.';
  await ev(() => window.GH.ui.act.askCoach());
  await page.waitForSelector('dialog.chat-sheet[open] .chat-compose:not([hidden])', { timeout: 10000 });
  let n0 = messages().length;
  await page.fill('#askQ', 'Am I walking enough?');
  await page.click('dialog.chat-sheet [data-act="askSend"]');
  await settled(4);
  await wait(500);
  const card = await ev(() => { const b = [...document.querySelectorAll('.chat-sheet .bubble.coach.answer')].pop(); return { rows: b.querySelectorAll('.md-table tbody tr').length, head: [...b.querySelectorAll('.md-table th')].map((x) => x.textContent).join(), scrolls: getComputedStyle(b.querySelector('.md-table')).overflowX, embs: [...b.querySelectorAll('.emb')].map((e) => e.dataset.kind), text: b.textContent, strong: (b.querySelector('strong') || {}).textContent }; });
  check('Claude\'s answer is a card: the number in bold, a small table in a box that scrolls sideways', card.rows === 2 && card.head === 'Day,Plan' && card.scrolls === 'auto' && card.strong === 'steady', card);
  check('with the embed it placed, drawn from the app\'s numbers, and one the app can\'t draw dropped', card.embs.join() === 'steps' && !/\[|\]|nonsense/.test(card.text), card);
  let q = messages().slice(n0).pop().body;
  check('a follow-up goes with the chat\'s earlier turns, as messages', q.messages.length === 3 && q.messages[0].content === 'How is my sleep?' && q.messages[2].content[0].text === 'Am I walking enough?', q.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content[0].text).slice(0, 30)));
  const last = (await conv()).pop();
  check('what it placed stays where it put it, and the app adds none', /\[\[steps\]\]/.test(last.text) && !last.embeds && last.engine === 'api');
  await page.click('dialog.chat-sheet [data-act="chatNew"]');
  await wait(300);
  chatText = 'Your sleep is **steady**, close to your usual.\n\n- Keep the same bedtime on weekends.';
  n0 = messages().length;
  await page.fill('#askQ', 'How is my sleep?');
  await page.click('dialog.chat-sheet [data-act="askSend"]');
  await settled(2);
  await wait(500);
  q = messages().slice(n0).pop().body;
  check('a new chat goes on its own', q.messages.length === 1 && q.messages[0].content[0].text === 'How is my sleep?');
  const placed = await ev(() => { const b = [...document.querySelectorAll('.chat-sheet .bubble.coach.answer')].pop(); return { embs: [...b.querySelectorAll('.emb')].map((e) => e.dataset.kind), kept: window.GH.chats.current(window.GH.ui.S).msgs[1].embeds }; });
  check('Claude placed no embed, so the app adds the one for the question, from its data', placed.embs.join() === 'sleep' && JSON.stringify(placed.kept) === '["sleep:7d"]', placed);
  await page.click('dialog.chat-sheet [data-act="chatList"]');
  await page.waitForSelector('dialog.chat-list-sheet[open] .chat-row', { timeout: 5000 });
  await wait(500);
  const rows = await ev(() => [...document.querySelectorAll('dialog.chat-list-sheet[open] .chat-row')].map((r) => `${r.querySelector('.rf-list-title').textContent}|${r.querySelector('.rf-list-icon').getAttribute('aria-label')}`));
  check('Chats has both, newest first, each answered by Claude', rows.join() === 'How is my sleep?|Claude,How is my sleep?|Claude', rows);
  chatText = 'Keep your bedtime steady on weekends.';
  await closeAll();
  check('nothing runs off the side', !(await sideways()), await sideways());
}

section('Claude\'s page');
await ev(() => window.GH.ui.open('claude'));
await page.waitForSelector('#screen[data-view="claude"] .cl-meters', { timeout: 10000 });
await wait(500);
const pg = await ev(() => ({
  meters: [...document.querySelectorAll('.cl-meter-top .t-footnote')].map((x) => x.textContent),
  limits: [...document.querySelectorAll('[data-key="cl-limits"] .rf-list-detail')].map((x) => x.textContent),
  recent: [...document.querySelectorAll('#screen .rf-list-title')].some((x) => x.textContent === 'Question'),
}));
check('today and the month against their limits, today\'s with about how many questions are left', pg.meters.length === 2 && /^(\$\d+\.\d\d|Under 1¢) of \$\d+\.\d\d · about [\d,]+ questions? left$/.test(pg.meters[0]) && /of \$20\.00 · \d+ days? to go$/.test(pg.meters[1]), pg.meters);
check('the three limits: $20 a month, Auto for the day, none per request', pg.limits[0] === '$20' && /^Auto · \$\d+\.\d\d$/.test(pg.limits[1]) && pg.limits[2] === 'None', pg.limits);
check('the usage lists the question just asked', pg.recent);
check('nothing runs off the side', !(await sideways()), await sideways());

section('A limit\'s sheet');
await page.click('[data-key="cl-limits"] [data-arg="request"]');
await page.waitForSelector('dialog[open] #clAmt', { timeout: 10000 });
await wait(400);
check('it says what the limit is for', /isn't sent/.test(await ev(() => window.GH.ui.topSheet().el.querySelector('.sheet-pad > p').textContent)));
await page.fill('#clAmt', '0.01');
await wait(200);
check('the line under it says what an amount means as it\'s typed', /typical questions/.test(await ev(() => document.getElementById('clAmtLine').textContent)));
await page.click('dialog[open] [data-act="claudeBudgetSave"]');
await wait(800);
check('Save keeps it', await ev(() => window.GH.ui.S.ai.budget.request === 0.01));

section('A request that could go over');
await ev(() => { const S = window.GH.ui.S; S.ai.claude.model = 'claude-fable-5-1'; S.ai.claude.think = 'max'; window.GH.store.save(S); });
const before = messages().length;
await ev(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open] .chat-compose:not([hidden])', { timeout: 10000 });
await page.fill('#askQ', 'What should I focus on?');
await page.click('dialog.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet .bubble.is-error', { timeout: 10000 });
const blocked = await ev(() => ({ text: document.querySelector('.chat-sheet .bubble.is-error').textContent, tool: !!document.querySelector('.chat-sheet [data-act="claudePage"]') }));
check('it isn\'t sent, and the chat says which limit and what it could cost', messages().length === before && /limit for one request is \$0\.01, and this could cost up to \$[\d.]+/.test(blocked.text) && blocked.tool, blocked);
await page.click('.chat-sheet [data-act="claudePage"]');
await wait(900);
check('its Limits button brings up Claude\'s page (here, the one under the chat)', await ev(() => window.GH.ui.route.view === 'claude' && !window.GH.ui.topSheet()));

section('Plans with Claude');
await ev(() => { const S = window.GH.ui.S; Object.assign(S.ai.claude, { model: 'claude-opus-5-5', think: 'auto' }); S.ai.budget.request = null; window.GH.store.save(S); window.GH.ui.go('plan'); });
await page.waitForSelector('#screen[data-view="plan"] ul[data-key="mine"]', { timeout: 10000 });
await wait(300);
const planRows = await ev(() => ({ build: (document.querySelector('#screen ul[data-key="mine"] [data-act="cpBuild"] .rf-list-title') || {}).textContent, check: (document.querySelector('#screen ul[data-key="mine"] [data-act="reviewPlan"] .rf-list-title') || {}).textContent }));
check('with Claude on, Plan offers to build a plan with it and to check this one', planRows.build === 'Build me a plan with Claude' && planRows.check === 'Check my plan with Claude', planRows);
await ev(() => { const S = window.GH.ui.S, C = window.GH.customPlan, day = window.GH.ui.today(); window.__plan = C.save(S, C.generate(S, day, C.wishes(S, '3 days, 30 minutes'))).plan.id; window.GH.store.save(S); window.GH.ui.open('planEdit', window.__plan); });
await page.waitForSelector('#screen [data-act="cpImprove"]', { timeout: 10000 });
check('a plan of their own has Improve with Claude', /Improve with Claude/.test(await ev(() => document.querySelector('#screen [data-act="cpImprove"]').textContent)));
const sets0 = await ev(() => window.GH.customPlan.get(window.GH.ui.S, window.__plan).days[0].items.map((x) => x.sets).join());
await page.click('#screen [data-act="cpImprove"]');
await page.waitForSelector('dialog[open] [data-act="cpImproveGo"]', { timeout: 10000 });
const n2 = messages().length;
await page.click('dialog[open] [data-act="cpImproveGo"]');
await page.waitForSelector('dialog[open] .cp-changes li', { timeout: 20000 });
await wait(400);
const prop = await ev(() => ({ changes: [...document.querySelectorAll('dialog[open] .cp-changes li')].map((x) => x.textContent), use: !!document.querySelector('dialog[open] [data-act="cpImproveReplace"]'), asNew: !!document.querySelector('dialog[open] [data-act="cpImproveNew"]') }));
const sentPlan = messages().slice(n2).pop();
check('Claude gets their plan, with the plan features\' summary', !!sentPlan && /Improve my own plan/.test(sentPlan.body.messages[0].content) && /TRAINING/.test(sentPlan.body.system[1].text));
check('what it would change comes first, in words, with both ways to keep it', prop.changes.length === 1 && /^Day 1: .+ \d+ × .+ → \d+ × /.test(prop.changes[0]) && prop.use && prop.asNew, prop);
check('their plan is unchanged until they choose', await ev((n) => window.GH.customPlan.get(window.GH.ui.S, window.__plan).days[0].items.map((x) => x.sets).join() === n, sets0));
await page.click('dialog[open] [data-act="cpImproveReplace"]');
await wait(900);
const sets1 = await ev(() => window.GH.customPlan.get(window.GH.ui.S, window.__plan).days[0].items.map((x) => x.sets).join());
check('Use these changes puts them in their plan', sets1 !== sets0 && await ev(() => !window.GH.ui.topSheet()), { before: sets0, after: sets1 });

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
