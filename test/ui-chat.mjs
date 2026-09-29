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
const TINY = { id: 'q35-2', tier: 'balanced', name: 'Balanced', label: 'Tiny test model', family: 'qwen35', file: 'tiny-qwen35.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny-qwen35.gguf', bytes: statSync(MODEL).size, minRamGB: 0, ctx: 2048, batch: 64, think: true, gen: { temperature: 0.6, top_p: 0.8, top_k: 20 } };

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

section('Engines');
await page.evaluate(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open] .chat-engine');
await wait(500);
check('the chat picks between the on-device model and Claude', await page.evaluate(() => [...document.querySelectorAll('.chat-sheet [data-on="setChatEngine"] input')].map((i) => i.value).join() === 'device,api'));
check('on-device is picked for someone who never chose', await page.evaluate(() => document.querySelector('.chat-sheet [data-on="setChatEngine"] input[value="device"]').checked && window.GH.ui.S.ai.mode === 'device'));
check('an old built-in chat setting and its log were moved over', await page.evaluate(() => { const S = JSON.parse(JSON.stringify(window.GH.ui.S)); S.ai.mode = 'local'; S.coachChat = [{ role: 'user', text: 'hi' }]; const m = window.GH.store.migrate(S); return m.ai.mode === 'device' && !('coachChat' in m); }));

section('Getting a model');
await page.evaluate(async () => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: l.MODELS }); await window.GH.ui.checkDevice(); window.GH.ui.refreshChat(); });
await wait(400);
const setup = await page.evaluate(() => {
  const c = document.querySelector('.chat-sheet .chat-setup');
  return c && { gets: [...c.querySelectorAll('[data-act="modelDownload"]')].map((x) => x.dataset.arg), rec: [...c.querySelectorAll('li')].filter((r) => /Recommended/.test(r.textContent)).map((r) => r.dataset.key), compose: !document.querySelector('.chat-sheet .chat-compose').hidden };
});
check('without a model, the chat offers the sizes this phone can run', setup && setup.gets.includes('q35-08') && setup.gets.includes('q35-2') && !setup.compose, setup);
check('Balanced is the one recommended', setup && setup.rec.join() === 'model-q35-2', setup);
check('older models aren\'t offered', setup && !setup.gets.includes('qwen05') && !setup.gets.includes('qwen15'), setup);
check('each size says what it\'s like', await page.evaluate(() => /Quickest/.test(document.querySelector('.chat-sheet [data-key="model-q35-08"]').textContent) && /slower/.test((document.querySelector('.chat-sheet [data-key="model-q35-4"]') || { textContent: 'slower' }).textContent)));

section('On-device');
await page.evaluate(async (tiny) => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: [tiny] }); await window.GH.ui.checkDevice(); window.GH.ui.refreshChat(); }, TINY);
await page.waitForFunction(() => { const c = document.querySelector('.chat-sheet .chat-compose'); return c && !c.hidden; }, null, { timeout: 15000 });
check('with the model on the phone, the chat is ready', true);
check('it says what it is', await page.evaluate(() => /Runs on your phone/.test(document.querySelector('.chat-sheet .chat-foot').textContent)));
let b = await bubbles();
check('the chat starts empty', b.length === 0, b);
await page.fill('#askQ', 'How is my sleep?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => { const s = window.GH.ui.S.ai.deviceChat || []; return s.length >= 2; }, null, { timeout: 60000 });
b = await bubbles();
check('the answer streams into a bubble', b.length === 2 && b[1].text.trim().length > 0 && !b[1].cls.includes('is-error'), b);
check('and is kept for the next turn, with the model that wrote it', await page.evaluate(() => window.GH.ui.S.ai.deviceChat.length === 2 && window.GH.ui.S.ai.deviceChat[0].text === 'How is my sleep?' && window.GH.ui.S.ai.deviceChat[1].model === 'q35-2'));
check('how fast it answered on this phone is remembered', await page.evaluate(() => (window.GH.ui.S.ai.speed || {})['q35-2'] > 0));
check('the send button is back', await page.evaluate(() => !!document.querySelector('.chat-sheet [data-act="askSend"]')));
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

section('Stop');
await page.fill('#askQ', 'Write me a long answer about everything');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForSelector('.chat-sheet [data-act="askStop"]', { timeout: 5000 });
await page.waitForFunction(() => { const x = [...document.querySelectorAll('.chat-sheet .bubble.coach')].pop(); return x && x.textContent.trim().length > 0 && !x.classList.contains('is-typing'); }, null, { timeout: 60000 });
await page.click('.chat-sheet [data-act="askStop"]').catch(() => {});
await page.waitForSelector('.chat-sheet [data-act="askSend"]', { timeout: 20000 });
b = await bubbles();
check('Stop ends the answer without an error', !b[b.length - 1].cls.includes('is-error'), b[b.length - 1]);

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
check('AI answers get a Report button', await page.evaluate(() => { const b = [...document.querySelectorAll('.chat-sheet .bubble')].pop(); return !!(b && b.querySelector('[data-act="flagAnswer"]')); }));
const nFlags = await page.evaluate(() => (window.GH.ui.S.ai.flags || []).length);
await page.evaluate(() => [...document.querySelectorAll('.chat-sheet [data-act="flagAnswer"]')].pop().click());
await page.waitForSelector('dialog[open] [data-act="flagHide"]', { timeout: 5000 });
check('the report sheet shows the answer and the reasons', await page.evaluate(() => document.querySelectorAll('dialog[open] [data-act="flagReason"]').length === 4 && !!document.querySelector('dialog[open] .flag-quote')));
await page.click('dialog[open] [data-act="flagHide"]');
await wait(900);
check('a reported answer is hidden and kept in the list', await page.evaluate((n) => (window.GH.ui.S.ai.flags || []).length === n + 1 && /reported this answer/.test([...document.querySelectorAll('.chat-sheet .bubble.coach')].pop().textContent), nFlags));

section('Claude asks first');
const anthropic = [];
page.on('request', (r) => { if (/anthropic\.com/.test(r.url())) anthropic.push(r.url()); });
await page.evaluate(() => { window.AndroidBridge.loadSecret = () => 'sk-ant-api03-' + 'a'.repeat(60); });
await page.click('.chat-sheet [data-on="setChatEngine"] input[value="api"]', { force: true });
await page.waitForSelector('dialog[open] [data-act="claudeAllow"]', { timeout: 5000 });
check('turning Claude on shows what it would get', await page.evaluate(() => { const t = document.querySelector('dialog[open] .sheet-prose').textContent; return /age range/.test(t) && /sleep, steps, heart rate/.test(t) && /Never your name/.test(t); }));
await page.click('dialog[open] [data-act="claudeDeny"]');
await wait(800);
check('saying no keeps it off, and nothing is sent', await page.evaluate(() => window.GH.ui.S.ai.mode !== 'api' && !window.GH.ui.S.ai.consentAt) && anthropic.length === 0);
await page.click('.chat-sheet [data-on="setChatEngine"] input[value="api"]', { force: true });
await page.waitForSelector('dialog[open] [data-act="claudeAllow"]', { timeout: 5000 });
await page.click('dialog[open] [data-act="claudeAllow"]');
await wait(900);
check('allowing it turns Claude on and remembers the answer', await page.evaluate(() => window.GH.ui.S.ai.mode === 'api' && window.GH.ui.S.ai.consentAt > 0));
await page.evaluate(() => { const S = window.GH.ui.S; S.ai.mode = 'device'; S.ai.consentAt = null; window.GH.store.save(S); });

section('Settings');
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(600);
await page.evaluate(() => window.GH.ui.open('settings', 'coach'));
await wait(900);
check('the coach setting has two choices', await page.evaluate(() => [...document.querySelectorAll('#screen [data-on="setCoachMode"] input')].map((i) => i.value).join() === 'device,api' && document.querySelector('#screen [data-on="setCoachMode"] input[value="device"]').checked));
check('the model shows as in use, with its speed here', await page.evaluate(() => { const t = (document.querySelector('#screen [data-key="model-q35-2"]') || {}).textContent || ''; return /In use/.test(t) && /words a second here/.test(t); }));
check('nothing is cut off', await page.evaluate(() => ![...document.querySelectorAll('#screen .rf-list-title')].some((e) => e.scrollWidth > e.clientWidth + 1)));

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
