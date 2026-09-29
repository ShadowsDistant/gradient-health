// The coach chat in Chromium with someone five weeks in: the built-in coach, the on-device model (a
// tiny random-weight stand-in, served with Range requests like the app serves real models), Stop,
// the safety answer, and the model rows in Settings. The tiny model's words are nonsense; what's
// checked is that answers stream in, stop, and are kept. Needs build/tiny.gguf (see test/llm.mjs).
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

const MODEL = join(root, 'build/tiny.gguf');
if (!existsSync(MODEL)) {
  const venv = join(root, 'build/venv/bin/python');
  const made = spawnSync(existsSync(venv) ? venv : 'python3', [join(root, 'scripts/make-tiny-gguf.py')], { stdio: 'inherit' });
  if (made.status !== 0 || !existsSync(MODEL)) { console.error('Couldn\'t make build/tiny.gguf. Run: python3 -m venv build/venv && build/venv/bin/pip install gguf numpy'); process.exit(1); }
}
const TINY = { id: 'qwen05', name: 'Standard', label: 'Tiny test model', file: 'tiny.gguf', url: 'https://huggingface.co/test/tiny/resolve/main/tiny.gguf', bytes: statSync(MODEL).size, minRamGB: 0, ctx: 2048 };

const dark = process.argv.includes('--dark');
const width = Number((process.argv.find((a) => a.startsWith('--width=')) || '--width=390').split('=')[1]);
const server = await serveDist({ '/models/tiny.gguf': MODEL });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? 'dark' : 'light' });
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
const wait = (ms) => page.waitForTimeout(ms);
const bubbles = () => page.evaluate(() => [...document.querySelectorAll('.chat-sheet .bubble')].map((b) => ({ cls: b.className, text: b.textContent })));

section('Built-in');
await page.evaluate(() => window.GH.ui.act.askCoach());
await page.waitForSelector('dialog.chat-sheet[open] .chat-engine');
await wait(500);
check('the chat opens with the engine picker', await page.evaluate(() => document.querySelectorAll('.chat-sheet [data-on="setChatEngine"] input').length === 3));
check('built-in is picked for someone who never chose', await page.evaluate(() => document.querySelector('.chat-sheet [data-on="setChatEngine"] input[value="local"]').checked));
await page.click('.chat-sheet [data-act="askQuick"]');
await wait(700);
let b = await bubbles();
check('a preset question gets an answer', b.length === 2 && b[1].cls.includes('coach') && b[1].text.length > 20, b);

section('On-device');
await page.evaluate(async (tiny) => { const l = await window.GH.lazy('llm'); l.configure({ baseUrl: 'models/', models: [tiny] }); }, TINY);
await page.click('.chat-sheet [data-on="setChatEngine"] input[value="device"]', { force: true });
await page.waitForFunction(() => { const c = document.querySelector('.chat-sheet .chat-compose'); return c && !c.hidden; }, null, { timeout: 15000 });
check('with the model on the phone, the chat is ready', true);
check('it says what it is', await page.evaluate(() => /Runs on your phone/.test(document.querySelector('.chat-sheet .chat-foot').textContent)));
check('the built-in answers aren\'t mixed in', (await bubbles()).length === 0);
await page.fill('#askQ', 'How is my sleep?');
await page.click('.chat-sheet [data-act="askSend"]');
await page.waitForFunction(() => { const s = window.GH.ui.S.ai.deviceChat || []; return s.length >= 2; }, null, { timeout: 60000 });
b = await bubbles();
check('the answer streams into a bubble', b.length === 2 && b[1].text.trim().length > 0 && !b[1].cls.includes('is-error'), b);
check('and is kept for the next turn', await page.evaluate(() => window.GH.ui.S.ai.deviceChat.length === 2 && window.GH.ui.S.ai.deviceChat[0].text === 'How is my sleep?'));
check('the send button is back', await page.evaluate(() => !!document.querySelector('.chat-sheet [data-act="askSend"]')));
const brief = await page.evaluate(() => window.GH.deviceCoach.messages(window.GH.ui.S, window.GH.ui.today(), 'x')[0].content);
check('the model gets a short brief with real numbers', brief.length < 2200 && /Sleep: /.test(brief) && /Steps: /.test(brief) && /Workouts: /.test(brief), brief.length);
check('without a name', !/Alex/.test(brief));

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

section('Settings');
await page.evaluate(() => window.GH.ui.closeSheets());
await wait(600);
await page.evaluate(() => window.GH.ui.open('settings', 'coach'));
await wait(900);
check('the coach setting has three choices', await page.evaluate(() => document.querySelectorAll('#screen [data-on="setCoachMode"] input').length === 3 && document.querySelector('#screen [data-on="setCoachMode"] input[value="device"]').checked));
check('the model shows as in use', await page.evaluate(() => /In use/.test((document.querySelector('#screen [data-key="model-qwen05"]') || {}).textContent || '')));
check('nothing is cut off', await page.evaluate(() => ![...document.querySelectorAll('#screen .rf-list-title')].some((e) => e.scrollWidth > e.clientWidth + 1)));

section('Console');
check('no console errors', errors.length === 0, errors.join('\n'));
await browser.close();
await server.close();
done();
