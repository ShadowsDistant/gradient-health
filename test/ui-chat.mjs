// The coach chat in Chromium with someone five weeks in: the two engines (on-device and Claude), the
// sizes offered before a model is on the phone, the on-device model (a tiny random-weight stand-in
// with Qwen3.5's layout, served with Range requests like the app serves real models) and the facts
// it gets with each question, Stop, the safety answer, and the model rows in Settings. The tiny
// model's words are nonsense; what's checked is that answers stream in, stop, and are kept. Needs
// build/tiny-qwen35.gguf (made here by scripts/make-tiny-gguf.py; see test/llm.mjs).
// Usage: node test/ui-chat.mjs [--dark] [--width=360]
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, check, section, done, serveDist } from './lib.mjs';
import { seedBridge, seedState } from './fixtures.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const MODEL = join(root, 'build/tiny-qwen35.gguf');
if (!existsSync(MODEL)) {
  const venv = join(root, 'build/venv/bin/python');
  const made = spawnSync(existsSync(venv) ? venv : 'python3', [join(root, 'scripts/make-tiny-gguf.py'), '--arch', 'qwen35'], { stdio: 'inherit' });
  if (made.status !== 0 || !existsSync(MODEL)) { console.error('Couldn\'t make build/tiny-qwen35.gguf. Run: python3 -m venv build/venv && build/venv/bin/pip install gguf numpy'); process.exit(1); }
}
// Stands in for the Balanced size, with the same settings (template flags, batch, sampling).
const TINY = { id: 'q35-2', tier: 'balanced', name: 'Balanced', label: 'Tiny test model', family: 'qwen35', file: 'tiny-qwen35.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny-qwen35.gguf', bytes: statSync(MODEL).size, minRamGB: 0, ctx: 4096, batch: 64, think: true, gen: { temperature: 0.6, top_p: 0.8, top_k: 20 } };

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const server = await serveDist({ '/models/tiny-qwen35.gguf': MODEL });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Looking for a model file that isn't on the phone is a 404, which Chromium logs.
page.on('console', (m) => { if (m.type() === 'error' && !/\/models\/[^/]+\.gguf$/.test((m.location() || {}).url || '')) errors.push(m.text()); });
await page.addInitScript(seedBridge);
await page.goto(server.url);
await page.waitForSelector('.onboard:not([hidden])');
await page.evaluate(seedState);
await page.reload();
await page.waitForSelector('#screen[data-view="today"] .session');
const wait = (ms) => page.waitForTimeout(ms);
const bubbles = () => page.evaluate(() => [...document.querySelectorAll('.chat-sheet .bubble')].map((b) => ({ cls: b.className, text: b.textContent })));

section('The coach button');
const tabs = await page.evaluate(async () => {
  const U = window.GH.ui, out = {};
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const t of ['today', 'plan', 'health', 'progress', 'moves']) { U.go(t); await pause(300); out[t] = !!document.querySelector('#topbar .rf-navbar-leading .coach-btn'); }
  U.open('settings'); await pause(400); out.settings = !!document.querySelector('#topbar .rf-navbar-leading .coach-btn');
  U.back(); await pause(300); U.go('today'); await pause(400);
  return out;
});
check('every tab has the coach button at its top left', tabs.today && tabs.plan && tabs.health && tabs.progress && tabs.moves, tabs);
check('a page opened on top has its Back button there instead', !tabs.settings, tabs);
await page.click('#topbar .coach-btn');
await page.waitForSelector('dialog.chat-sheet[open] .chat-pill');
await wait(500);
check('it opens the chat', true);

section('Engines');
check('a pill at the top says who answers', await page.evaluate(() => /On this phone/.test(document.querySelector('.chat-sheet .chat-pill').textContent) && window.GH.ui.S.ai.mode === 'device'));
await page.click('.chat-sheet .chat-pill');
await page.waitForSelector('dialog[open] [data-act="setChatEngine"]');
check('it opens the choice between the on-device model and Claude', await page.evaluate(() => [...document.querySelectorAll('dialog[open] [data-act="setChatEngine"]')].map((b) => b.dataset.arg).join() === 'device,api'));
check('on-device is picked for someone who never chose', await page.evaluate(() => document.querySelector('dialog[open] [data-act="setChatEngine"][data-arg="device"]').getAttribute('aria-pressed') === 'true'));
await page.evaluate(() => window.GH.ui.topSheet().close('ok'));
await wait(500);
check('an old built-in chat setting and its log were moved over', await page.evaluate(() => { const S = JSON.parse(JSON.stringify(window.GH.ui.S)); S.ai.mode = 'local'; S.coachChat = [{ role: 'user', text: 'hi' }]; const m = window.GH.store.migrate(S); return m.ai.mode === 'device' && !('coachChat' in m); }));

section('Getting a model');
await page.evaluate(async () => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: l.MODELS }); await window.GH.ui.checkDevice(); window.GH.ui.refreshChat(); });
await wait(400);
const setup = await page.evaluate(() => {
  const c = document.querySelector('.chat-sheet .chat-setup');
  return c && { gets: [...c.querySelectorAll('[data-act="modelDownload"]')].map((x) => x.dataset.arg), rec: [...c.querySelectorAll('li')].filter((r) => /Recommended/.test(r.textContent)).map((r) => r.dataset.key), compose: !document.querySelector('.chat-sheet .chat-compose').hidden };
});
check('without a model, the chat offers the sizes this phone can run', setup && setup.gets.includes('q35-08') && setup.gets.includes('q35-2') && !setup.compose, setup);
check('Fast is the one recommended', setup && setup.rec.join() === 'model-q35-08', setup);
check('older models aren\'t offered', setup && !setup.gets.includes('qwen05') && !setup.gets.includes('qwen15'), setup);
check('each size says what it\'s like', await page.evaluate(() => /Quickest/.test(document.querySelector('.chat-sheet [data-key="model-q35-08"]').textContent) && /slower/.test((document.querySelector('.chat-sheet [data-key="model-q35-4"]') || { textContent: 'slower' }).textContent)));

section('On-device');
await page.evaluate(async (tiny) => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: [tiny] }); await window.GH.ui.checkDevice(); window.GH.ui.refreshChat(); }, TINY);
await page.waitForFunction(() => { const c = document.querySelector('.chat-sheet .chat-compose'); return c && !c.hidden; }, null, { timeout: 15000 });
check('with the model on the phone, the chat is ready', true);
check('it says what it is', await page.evaluate(() => /Runs on your phone/.test(document.querySelector('.chat-sheet .chat-foot').textContent)));
let b = await bubbles();
check('the chat starts empty', b.length === 0, b);
const cards = await page.evaluate(() => [...document.querySelectorAll('.chat-sheet .chat-card[data-act="askQuick"]')].map((c) => c.dataset.arg));
check('with questions worth asking today, from their data', cards.length >= 3 && cards.includes('How is my sleep?') && cards.includes('What should I focus on this week?'), cards);
await page.fill('#askQ', 'How is my sleep?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => { const s = window.GH.ui.S.ai.deviceChat || []; return s.length >= 2; }, null, { timeout: 60000 });
b = await bubbles();
check('the answer streams into a bubble', b.length === 2 && b[1].text.trim().length > 0 && !b[1].cls.includes('is-error'), b);
check('and is kept for the next turn, with the model that wrote it', await page.evaluate(() => window.GH.ui.S.ai.deviceChat.length === 2 && window.GH.ui.S.ai.deviceChat[0].text === 'How is my sleep?' && window.GH.ui.S.ai.deviceChat[1].model === 'q35-2'));
check('how fast it answered on this phone is remembered', await page.evaluate(() => (window.GH.ui.S.ai.speed || {})['q35-2'] > 0));
check('the send button is back', await page.evaluate(() => !!document.querySelector('.chat-sheet [data-act="askSend"]')));
check('an answer can be copied, and shows what the app gave the model', await page.evaluate(() => { const m = [...document.querySelectorAll('.chat-sheet .msg.coach')].pop(); return !!(m && m.querySelector('[data-act="copyAnswer"]') && m.querySelector('[data-act="answerFacts"]')); }));
await page.evaluate(() => [...document.querySelectorAll('.chat-sheet [data-act="answerFacts"]')].pop().click());
await page.waitForSelector('dialog[open] .facts-list');
check('"What it used" lists the facts the app worked out', await page.evaluate(() => /What the app worked out/.test(document.querySelector('dialog[open] .facts-list').textContent)));
await page.evaluate(() => window.GH.ui.topSheet().close('ok'));
await wait(500);
const brief = await page.evaluate(() => window.GH.deviceCoach.messages(window.GH.ui.S, window.GH.ui.today(), 'x')[0].content);
check('the model gets a short brief with real numbers', brief.length < 2200 && /Sleep: /.test(brief) && /Steps: /.test(brief) && /Workouts: /.test(brief), brief.length);
check('without a name', !/Alex/.test(brief));
const prompt = await page.evaluate(() => {
  const D = window.GH.deviceCoach, S = window.GH.ui.S, day = window.GH.ui.today();
  const a = D.messages(S, day, 'How is my sleep?'), b2 = D.messages(S, day, 'Am I getting stronger?'), c = D.messages(S, day, 'What is the capital of France?');
  return { same: a[0].content === b2[0].content, sleep: a[a.length - 1].content, strong: b2[b2.length - 1].content, none: c[c.length - 1].content, turns: a.length };
});
check('each question comes with what the app worked out for it', /^FACTS\n- What the app worked out: /.test(prompt.sleep) && /QUESTION\nHow is my sleep\?$/.test(prompt.sleep), prompt.sleep);
check('and the How it works rule behind it', /How the app decides \(An easier day after a short night\)/.test(prompt.sleep) && /How the app decides \(Reps first, then weight/.test(prompt.strong), prompt.strong);
check('a question the app can\'t work out says so', /FACTS\n- None for this question\./.test(prompt.none), prompt.none);
check('the rules and data stay the same from question to question (so they stay cached)', prompt.same);
check('with the last exchange before the question', prompt.turns === 4, prompt.turns);
const lighter = await page.evaluate(() => {
  const B = window.GH.brain, D = window.GH.deviceCoach, S = window.GH.ui.S, day = window.GH.ui.today();
  const real = B.todayPlan, out = {};
  for (const type of ['done', 'rest', 'light']) {
    B.todayPlan = () => ({ type, light: { walk: false, mobility: false } });
    try { out[type] = D.facts(S, day, 'Why is today lighter?').join(' | '); } finally { B.todayPlan = real; }
  }
  return out;
});
check('a finished or rest day isn\'t explained to the model as a light day', !/Light day/.test(lighter.done) && !/Light day/.test(lighter.rest), lighter);
check('a light day still is', /Today's changes: Light day/.test(lighter.light), lighter.light);

section('While it answers');
await page.fill('#askQ', 'How are my steps?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet #chatLive .bubble.is-typing', { timeout: 5000 });
check('the answer on its way says what the model is doing', await page.evaluate(() => /Thinking|Reading your numbers|Starting the model/.test(document.querySelector('.chat-sheet #chatLive').textContent)));
// Download progress (and anything else) redraws the chat several times a second.
await page.evaluate(() => { window.__redraws = setInterval(() => window.GH.ui.refreshChat(), 60); });
await page.waitForFunction(() => { const c = window.GH.ui.S.ai.deviceChat || []; return c.length >= 4; }, null, { timeout: 60000 });
await page.evaluate(() => clearInterval(window.__redraws));
b = await bubbles();
check('redraws don\'t lose it: the question and its answer are both there', b.length === 4 && b[2].text === 'How are my steps?' && b[3].text.trim().length > 0 && !b[3].cls.includes('is-error'), b.slice(2));

section('Answering with the chat closed');
await page.fill('#askQ', 'What should I focus on this week?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet #chatLive', { timeout: 5000 });
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(200);
const ring = await page.evaluate(() => document.querySelector('#topbar .coach-btn').hasAttribute('data-busy'));
await page.waitForFunction(() => { const c = window.GH.ui.S.ai.deviceChat || []; return c.length >= 6; }, null, { timeout: 60000 });
await wait(300);
const dot = await page.evaluate(() => { const btn = document.querySelector('#topbar .coach-btn'); return btn.hasAttribute('data-unseen') && !btn.hasAttribute('data-busy'); });
check('closing the chat doesn\'t stop the answer: the coach button shows a ring, then a dot', ring && dot, { ring, dot });
await page.click('#topbar .coach-btn');
await page.waitForSelector('dialog.chat-sheet[open] .chat-pill');
await wait(500);
b = await bubbles();
check('reopened, the answer is there, and the dot is gone', b.length === 6 && b[5].text.trim().length > 0 && !(await page.evaluate(() => document.querySelector('#topbar .coach-btn').hasAttribute('data-unseen'))), b.slice(4));

section('Stop');
await page.fill('#askQ', 'Write me a long answer about everything');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet [data-act="askStop"]', { timeout: 5000 });
await page.waitForFunction(() => { const x = [...document.querySelectorAll('.chat-sheet .bubble.coach')].pop(); return x && x.textContent.trim().length > 0 && !x.classList.contains('is-typing'); }, null, { timeout: 60000 });
await page.click('.chat-sheet [data-act="askStop"]').catch(() => {});
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 20000 });
b = await bubbles();
check('Stop ends the answer without an error', !b[b.length - 1].cls.includes('is-error'), b[b.length - 1]);
// Stop, then ask again at once: the new question keeps its own Stop button.
await page.fill('#askQ', 'And my heart rate?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet [data-act="askStop"]', { timeout: 5000 });
await page.click('.chat-sheet [data-act="askStop"]');
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 20000 });
await page.fill('#askQ', 'Tell me about my weight');
await page.click('.chat-sheet [data-act="askSend"]');
await wait(150);
check('a question asked right after a stopped one can still be stopped', await page.evaluate(() => !!document.querySelector('.chat-sheet [data-act="askStop"]')));
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 60000 });

section('Safety');
await page.fill('#askQ', 'I have chest pain when I train');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => /doctor/.test(([...document.querySelectorAll('.chat-sheet .bubble.coach')].pop() || {}).textContent || ''), null, { timeout: 20000 });
check('worrying questions get the safety answer, not the model', true);

section('Reporting an AI answer');
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 20000 });
const before = await page.evaluate(() => (window.GH.ui.S.ai.deviceChat || []).length);
await page.fill('#askQ', 'One more question');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForFunction((n) => (window.GH.ui.S.ai.deviceChat || []).length >= n + 2, before, { timeout: 60000 });
await wait(300);
check('AI answers get a Report button', await page.evaluate(() => { const m = [...document.querySelectorAll('.chat-sheet .msg')].pop(); return !!(m && m.querySelector('[data-act="flagAnswer"]')); }));
const nFlags = await page.evaluate(() => (window.GH.ui.S.ai.flags || []).length);
await page.evaluate(() => [...document.querySelectorAll('.chat-sheet [data-act="flagAnswer"]')].pop().click());
await page.waitForSelector('dialog[open] [data-act="flagHide"]', { timeout: 5000 });
check('the report sheet shows the answer and the reasons', await page.evaluate(() => document.querySelectorAll('dialog[open] [data-on="flagReason"] [role="radio"]').length === 4 && !!document.querySelector('dialog[open] .flag-quote')));
await page.click('dialog[open] [data-act="flagHide"]');
await wait(900);
check('a reported answer is hidden and kept in the list', await page.evaluate((n) => (window.GH.ui.S.ai.flags || []).length === n + 1 && /reported this answer/.test([...document.querySelectorAll('.chat-sheet .bubble.coach')].pop().textContent), nFlags));

section('Stopped before its turn');
const early = await page.evaluate(async () => {
  const D = window.GH.deviceCoach, S = window.GH.ui.S, day = window.GH.ui.today();
  await D.ask(S, day, 'How many steps did I do?', {});
  const speed = (S.ai.speed || {})['q35-2'];
  const ctl = new AbortController();
  const r = await D.ask(S, day, 'And my sleep?', { signal: ctl.signal, onStatus: (st) => { if (st === 'thinking') ctl.abort(); } });
  return { aborted: r.aborted, text: r.text, speedKept: (S.ai.speed || {})['q35-2'] === speed };
});
check('a question stopped before it starts comes back as stopped', early.aborted === true && !early.text, early);
check('and the last answer\'s speed isn\'t counted again', early.speedKept, early);

section('A suggested question');
await page.evaluate(() => { window.GH.ui.closeSheets(); window.GH.deviceCoach.clear(window.GH.ui.S); });
await wait(700);
const asked = await page.evaluate(() => (window.GH.ui.S.ai.deviceChat || []).length);
// The first open after starting the app, when the check for the model takes a while.
await page.evaluate(() => {
  const U = window.GH.ui, real = U.checkDevice;
  U.deviceState().checked = false;
  U.checkDevice = () => new Promise((r) => setTimeout(r, 1200)).then(real);
  try { U.act.askCoach(null, null, 'Why is today lighter?'); } finally { U.checkDevice = real; }
});
await page.waitForFunction((n) => (window.GH.ui.S.ai.deviceChat || []).length >= n + 2, asked, { timeout: 60000 }).catch(() => {});
check('is sent once the coach is ready', await page.evaluate((n) => { const c = window.GH.ui.S.ai.deviceChat || []; return c.length >= n + 2 && c[n].text === 'Why is today lighter?'; }, asked));
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 20000 });

section('Claude asks first');
const anthropic = [];
page.on('request', (r) => { if (/anthropic\.com/.test(r.url())) anthropic.push(r.url()); });
await page.evaluate(() => { window.AndroidBridge.loadSecret = () => 'sk-ant-api03-' + 'a'.repeat(60); });
const pickClaude = async () => {
  await page.click('.chat-sheet .chat-pill');
  await page.waitForSelector('dialog[open] [data-act="setChatEngine"][data-arg="api"]');
  await wait(400);
  await page.click('dialog[open] [data-act="setChatEngine"][data-arg="api"]');
};
await pickClaude();
await page.waitForSelector('dialog[open] [data-act="claudeAllow"]', { timeout: 5000 });
check('turning Claude on shows what it would get', await page.evaluate(() => { const t = document.querySelector('dialog[open] .sheet-prose').textContent; return /age range/.test(t) && /sleep, steps, heart rate/.test(t) && /Never your name/.test(t); }));
await page.click('dialog[open] [data-act="privacySheet"]');
await wait(900);
const policy = await page.evaluate(() => { const top = window.GH.ui.topSheet(); return { title: top && top.el.querySelector('.rf-sheet-title').textContent, asking: !!document.querySelector('dialog[open] [data-act="claudeAllow"]'), mode: window.GH.ui.S.ai.mode, consent: !!window.GH.ui.S.ai.consentAt }; });
check('its privacy policy link opens the policy on top, without answering the question', policy.title === 'Privacy' && policy.asking && policy.mode !== 'api' && !policy.consent, policy);
await page.evaluate(() => window.GH.ui.topSheet().close('ok'));
await wait(800);
check('closing the policy goes back to the question', await page.evaluate(() => !!window.GH.ui.topSheet().el.querySelector('[data-act="claudeAllow"]')));
await page.click('dialog[open] [data-act="claudeDeny"]');
await wait(800);
check('saying no keeps it off, and nothing is sent', await page.evaluate(() => window.GH.ui.S.ai.mode !== 'api' && !window.GH.ui.S.ai.consentAt) && anthropic.length === 0);
await page.evaluate(() => { const t = window.GH.ui.topSheet(); if (t && !t.el.classList.contains('chat-sheet')) t.close('ok'); });
await wait(500);
await pickClaude();
await page.waitForSelector('dialog[open] [data-act="claudeAllow"]', { timeout: 5000 });
await page.click('dialog[open] [data-act="claudeAllow"]');
await wait(900);
check('allowing it turns Claude on and remembers the answer', await page.evaluate(() => window.GH.ui.S.ai.mode === 'api' && window.GH.ui.S.ai.consentAt > 0));
check('and the pill says so', await page.evaluate(() => /Claude/.test(document.querySelector('.chat-sheet .chat-pill').textContent)));
await page.evaluate(() => { const S = window.GH.ui.S; S.ai.mode = 'device'; S.ai.consentAt = null; window.GH.store.save(S); });

section('Settings');
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(600);
await page.evaluate(() => window.GH.ui.open('settings', 'coach'));
await wait(900);
check('the coach setting has two choices', await page.evaluate(() => [...document.querySelectorAll('#screen [data-on="setCoachMode"] input')].map((i) => i.value).join() === 'device,api' && document.querySelector('#screen [data-on="setCoachMode"] input[value="device"]').checked));
check('the model shows as in use, with its speed here', await page.evaluate(() => { const t = (document.querySelector('#screen [data-key="model-q35-2"]') || {}).textContent || ''; return /In use/.test(t) && /words a second here/.test(t); }));
check('nothing is cut off', await page.evaluate(() => ![...document.querySelectorAll('#screen .rf-list-title')].some((e) => e.scrollWidth > e.clientWidth + 1)));
await page.click('#screen [data-act="aiSelfTest"]');
await page.waitForSelector('dialog[open] .selftest-log', { timeout: 90000 });
const selfTest = await page.evaluate(() => document.querySelector('dialog[open] .sheet-pad').textContent);
check('the on-device AI check starts the model, times an answer and says which engine ran', /Working/.test(selfTest) && /In the app/.test(selfTest) && /Start-up\s*\d/.test(selfTest) && /words a second/.test(selfTest), selfTest.slice(0, 300));
await page.evaluate(() => window.GH.ui.topSheet().close('ok'));
await wait(500);
// A piece of an older model's download left from 1.2 (it's never downloaded again) can be cleared.
await page.evaluate(() => {
  const d = window.GH.ui.deviceState();
  d.all = d.all.concat([{ id: 'qwen05', name: 'Qwen2.5 0.5B', label: 'Older, smaller', tier: 'fast', legacy: true, bytes: 491400032 }]);
  d.progress.qwen05 = { id: 'qwen05', state: 'paused', loaded: 3e8, total: 491400032 };
  window.GH.ui.render();
});
await wait(400);
check('an older model\'s unfinished download can be discarded', await page.evaluate(() => { const r = document.querySelector('#screen [data-key="model-qwen05"]'); return !!(r && r.querySelector('[data-act="modelCancel"]') && /unfinished download/.test(r.textContent) && !r.querySelector('[data-act="modelDownload"]')); }));
await page.evaluate(() => { const d = window.GH.ui.deviceState(); delete d.progress.qwen05; d.all = d.all.filter((m) => m.id !== 'qwen05'); window.GH.ui.render(); });

section('Tailor my plan');
await page.evaluate(() => { const U = window.GH.ui; U.closeSheets(); window.GH.deviceCoach.clear(U.S); if (U.route.view) U.back(); U.go('today'); });
await wait(800);
await page.click('#topbar .coach-btn');
await page.waitForSelector('dialog.chat-sheet[open] .chat-card[data-act="tailorPlan"]', { timeout: 15000 });
await page.click('dialog.chat-sheet .chat-card[data-act="tailorPlan"]');
await page.waitForSelector('dialog[open] #tailorQ');
const planBefore = await page.evaluate(() => { const p = window.GH.ui.S.profile; return JSON.stringify({ goals: p.goals, minutes: p.minutes, careful: p.careful }); });
await page.fill('dialog[open] #tailorQ', 'More legs, my knees hurt');
await page.click('dialog[open] [data-act="tailorChip"][data-arg="Shorter workouts"]');
check('an example adds to what\'s typed', await page.evaluate(() => document.querySelector('dialog[open] #tailorQ').value === 'More legs, my knees hurt, shorter workouts'));
await page.click('dialog[open] [data-act="tailorSuggest"]');
await page.waitForSelector('dialog[open] .tailor-lines', { timeout: 10000 });
const proposal = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .tailor-lines .rf-list-title')].map((x) => x.textContent));
check('it lists the changes before making them', proposal.some((x) => /^Legs: more each week/.test(x)) && proposal.some((x) => /knees/.test(x)) && proposal.some((x) => /minutes/.test(x)), proposal);
check('nothing has changed yet', await page.evaluate((b) => { const p = window.GH.ui.S.profile; return JSON.stringify({ goals: p.goals, minutes: p.minutes, careful: p.careful }) === b; }, planBefore));
await page.click('dialog[open] [data-act="tailorApply"]');
await wait(600);
const after = await page.evaluate(() => { const p = window.GH.ui.S.profile; return { goals: p.goals, minutes: p.minutes, careful: p.careful }; });
check('Apply changes the plan', after.goals[0] === 'legs' && after.careful.includes('knee') && after.minutes < JSON.parse(planBefore).minutes, after);
await page.evaluate(() => window.GH.ui.act.tailorUndo());
await wait(300);
check('and Undo puts it back', await page.evaluate((b) => { const p = window.GH.ui.S.profile; return JSON.stringify({ goals: p.goals, minutes: p.minutes, careful: p.careful }) === b; }, planBefore));
await page.evaluate(() => window.GH.ui.act.tailorPlan({ getAttribute: () => 'calves' }));
await page.waitForSelector('dialog[open] #tailorQ');
check('from a muscle on the body map, the request is written for you', await page.evaluate(() => document.querySelector('dialog[open] #tailorQ').value === 'Train my calves more'));
// The tiny test model writes random (if well-formed) JSON, so here the model's reading is "nothing".
await page.evaluate(() => { window.__tailorAsk = window.GH.tailor.ask; window.GH.tailor.ask = async () => ({ focus: [], goals: [], minutes: null, days: null, avoid_joints: [], no_jumping: null, gentle: null, note: '' }); });
await page.fill('dialog[open] #tailorQ', 'hello there');
await page.click('dialog[open] [data-act="tailorSuggest"]');
await page.waitForSelector('dialog[open] .tailor-none', { timeout: 60000 });
check('a request with nothing to change says so', true);
await page.evaluate(() => { window.GH.tailor.ask = window.__tailorAsk; });
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(600);

section('After a crash');
// The page died while the in-app engine was answering with Balanced (the app counts the crash).
const crashedAt = Date.now() - 5000;
await page.evaluate((at) => {
  window.GH.ui.closeSheets();
  localStorage.setItem('gh.llm.active', JSON.stringify({ id: 'q35-2', at }));
  window.AndroidBridge.rendererGone = () => 1;
}, crashedAt);
await page.reload();
await page.waitForSelector('#screen[data-view="today"]');
await page.evaluate(async (tiny) => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: [tiny] }); }, TINY);
await page.click('#topbar .coach-btn');
await page.waitForSelector('.chat-sheet .chat-note', { timeout: 15000 }).catch(() => {});
const crash = await page.evaluate(() => ({ note: (document.querySelector('.chat-sheet .chat-note') || {}).textContent || '', big: (window.GH.ui.S.ai.tooBig || {})['q35-2'] > 0, mark: localStorage.getItem('gh.llm.active') }));
check('the chat says the phone ran short of memory, and remembers that size was too big', /short of memory/.test(crash.note) && crash.big && !(crash.mark && JSON.parse(crash.mark).at === crashedAt), crash);

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
