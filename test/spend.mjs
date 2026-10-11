// Claude's model, thinking level and spending limits (src/spend.js): how each request is shaped for
// the model and level picked, what a response cost from its usage (cache, a backup model's attempt,
// the long-prompt card), the monthly budget and its daily share, and the hard limit before a request
// (a backup dropped, the output limit lowered, or nothing sent).
import { load, check, section, done } from './lib.mjs';

const GH = load('src/brain.js', 'src/spend.js');
const B = GH.brain, SP = GH.spend;
const day = (s) => B.dayFromStr(s);
const person = (claude, budget) => ({ ai: Object.assign({ claude: Object.assign({ model: 'claude-opus-5-5', think: 'auto' }, claude || {}) }, budget ? { budget } : {}) });

section('The models and their thinking');
{
  const ids = SP.MODELS.map((m) => m.id);
  check('the current four first, then the older ones', JSON.stringify(ids.slice(0, 4)) === JSON.stringify(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) && SP.MODELS.slice(4).every((m) => m.older));
  check('Opus 5.5 is the default, and an unknown id falls back to it', SP.model({}).id === 'claude-opus-5-5' && SP.model(person({ model: 'claude-nope' })).id === 'claude-opus-5-5');
  const auto = SP.shape(person(), 'chat');
  check('Auto: a question at medium effort with adaptive thinking', auto.thinking.type === 'adaptive' && auto.effort === 'medium' && auto.maxTokens === 4000);
  check('Auto: Tailor at low, the weekly report at medium', SP.shape(person(), 'tailor').effort === 'low' && SP.shape(person(), 'report').effort === 'medium');
  const xh = SP.shape(person({ think: 'xhigh' }), 'chat');
  check('a level picked is used for every feature, with more room to think', xh.effort === 'xhigh' && xh.maxTokens === 16000 && SP.shape(person({ think: 'xhigh' }), 'tailor').effort === 'xhigh');
  const off = (model) => SP.shape(person({ model, think: 'off' }), 'report');
  check('Off on Haiku 5.5 turns thinking off, at an effort the API takes with it', off('claude-haiku-5-5').thinking.type === 'disabled' && ['low', 'medium', 'high'].includes(off('claude-haiku-5-5').effort));
  check('Off on Sonnet 5.5 is between_tools (disabled is a 400 there)', off('claude-sonnet-5-5').thinking.type === 'between_tools' && ['low', 'medium', 'high'].includes(off('claude-sonnet-5-5').effort));
  check('Off on a model that always thinks becomes Low', off('claude-opus-5-5').thinking.type === 'adaptive' && off('claude-opus-5-5').effort === 'low' && off('claude-fable-5-1').level === 'low');
  check('the levels offered: Off only where thinking can turn off', !SP.levelsFor(SP.byId('claude-opus-5-5')).includes('off') && SP.levelsFor(SP.byId('claude-haiku-5-5')).includes('off') && SP.levelsFor(SP.byId('claude-sonnet-5-5')).length === 7);
  check('a level that isn\'t one is Auto', SP.level(person({ think: 'ultra' })) === 'auto');
}

section('What a response cost');
{
  check('input and output at the model\'s prices, in millionths of a dollar', SP.costOf({ input_tokens: 1000, output_tokens: 500 }, 'claude-opus-5-5') === 1000 * 4 + 500 * 20);
  check('cache reads and writes at their own prices', SP.costOf({ input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000, output_tokens: 0 }, 'claude-opus-5-5') === 100 * 4 + 2000 * 0.2 + 1000 * 5);
  const fb = { input_tokens: 412, output_tokens: 264, iterations: [{ type: 'message', model: 'claude-fable-5-1', input_tokens: 535, output_tokens: 0 }, { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 412, output_tokens: 264 }] };
  check('with a backup model, every attempt at its own model\'s prices', SP.costOf(fb, 'claude-fable-5-1') === 535 * 10 + 412 * 5 + 264 * 25);
  check('a model the table doesn\'t know is priced as the dearest', SP.costOf({ input_tokens: 1000, output_tokens: 0, iterations: [{ type: 'fallback_message', model: 'claude-future-9', input_tokens: 1000, output_tokens: 0 }] }, 'claude-opus-5-5') === 1000 * 10);
  check('Haiku 5.5 over 100K prompt tokens is on its long card', SP.costOf({ input_tokens: 150000, output_tokens: 1000 }, 'claude-haiku-5-5') === Math.round(150000 * 0.5 + 1000 * 2.5) && SP.costOf({ input_tokens: 1000, output_tokens: 1000 }, 'claude-haiku-5-5') === Math.round(1000 * 0.1 + 1000 * 0.5));
  check('money: dollars and cents, small amounts as under 1¢', SP.money(320000) === '$0.32' && SP.money(4000) === 'under 1¢' && SP.money(4000, { exact: true }) === '$0.0040' && SP.money(200e6, { whole: true }) === '$200');
}

section('The monthly budget and its share of each day');
{
  const D = day('2026-10-11'); // 21 days left in October, today included
  const S = person({}, { monthly: 200, daily: null, request: null });
  SP.record(S, D - 3, { feature: 'chat', model: 'claude-opus-5-5', level: 'medium', usage: { input_tokens: 0, output_tokens: 2.5e6 } }); // $50 earlier this month
  let L = SP.limits(S, D);
  check('Auto: what\'s left of the month over the days left in it', L.month.daysLeft === 21 && L.today.limit === Math.floor((200e6 - 50e6) / 21) && L.today.auto, L.today);
  SP.record(S, D, { feature: 'chat', model: 'claude-opus-5-5', level: 'medium', usage: { input_tokens: 0, output_tokens: 100000 } }); // $2 today
  L = SP.limits(S, D);
  check('spending today doesn\'t move today\'s limit; it comes off what\'s left', L.today.limit === Math.floor(150e6 / 21) && L.today.left === L.today.limit - 2e6 && L.month.left === 148e6);
  check('the next day shares out what\'s left again', SP.limits(S, D + 1).today.limit === Math.floor((200e6 - 52e6) / 20));
  check('a new month starts again', SP.limits(S, day('2026-11-01')).month.spent === 0 && SP.limits(S, day('2026-11-01')).today.limit === Math.floor(200e6 / 30));
  const custom = person({}, { monthly: 200, daily: 1, request: 0.25 });
  check('a daily limit of their own replaces Auto', SP.limits(custom, D).today.limit === 1e6 && !SP.limits(custom, D).today.auto);
  check('and a limit per request caps any one request', SP.limits(custom, D).room === 0.25e6);
  check('no budget at all: no limit', SP.limits(person({}, { monthly: null, daily: null, request: null }), D).room === Infinity);
  const e = SP.data(S).log[SP.data(S).log.length - 1];
  check('each request is logged with its feature, model, level, tokens and cost', e.f === 'chat' && e.m === 'claude-opus-5-5' && e.lv === 'medium' && e.o === 100000 && e.c === 2e6);
  check('the month keeps a sum per feature and per model', SP.data(S).months['2026-10'].f.chat === 52e6 && SP.data(S).months['2026-10'].m['claude-opus-5-5'] === 52e6);
}

section('The hard limit before a request');
{
  const D = day('2026-10-11');
  const S = person({ think: 'medium' }, { monthly: 300, daily: null, request: null });
  const roomy = SP.allow(S, D, 'chat', 4000);
  check('with room, it goes as picked, with a backup model for a mistaken refusal', roomy.ok && roomy.maxTokens === 4000 && roomy.backup && !roomy.cut);
  SP.release(roomy.hold);
  // Room for the request itself, not for a backup's answer on top.
  const inTok = SP.tokensFor(4000);
  const one = SP.worst(SP.byId('claude-opus-5-5'), inTok, 4000, false);
  const tight = person({ think: 'medium' }, { monthly: 300, daily: null, request: SP.usd(one + 1000) });
  const t = SP.allow(tight, D, 'chat', 4000);
  check('a little less room: no backup model, the same answer', t.ok && !t.backup && t.maxTokens === 4000);
  SP.release(t.hold);
  const tighter = person({ think: 'medium' }, { monthly: 300, daily: null, request: SP.usd(Math.round(one * 0.6)) });
  const c = SP.allow(tighter, D, 'chat', 4000);
  check('less again: a shorter answer that fits, said to be cut to fit', c.ok && c.cut && c.maxTokens < 4000 && c.worst <= Math.round(one * 0.6), c);
  SP.release(c.hold);
  const none = person({ think: 'medium' }, { monthly: 300, daily: null, request: 0.001 });
  const n = SP.allow(none, D, 'chat', 4000);
  check('too little for a useful answer: not sent, and it says which limit and what it needs', !n.ok && n.code === 'budget-request' && n.need > 1000 && n.room === 1000, n);
  const spent = person({ think: 'medium' }, { monthly: 5, daily: null, request: null });
  SP.record(spent, D, { feature: 'report', model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 249900 } }); // $4.998
  const m = SP.allow(spent, D, 'chat', 4000);
  check('a month that\'s nearly spent stops it, as the month\'s budget', !m.ok && m.code === 'budget-month', m.code);
  const day1 = person({ think: 'medium' }, { monthly: 300, daily: 0.2, request: null });
  SP.record(day1, D, { feature: 'chat', model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 9900 } }); // $0.198
  const d = SP.allow(day1, D, 'chat', 4000);
  check('and a day that\'s nearly spent, as today\'s limit', !d.ok && d.code === 'budget-today', d.code);
  // Two at once: the first one's worst case is held until it's recorded.
  const two = person({ think: 'medium' }, { monthly: 300, daily: SP.usd(one * 1.5), request: null });
  const a = SP.allow(two, D, 'chat', 4000);
  const b = SP.allow(two, D, 'chat', 4000);
  check('a request in flight counts against the limit until it\'s done', a.ok && (!b.ok || b.maxTokens < 4000), { a: a.ok, b: b.ok && b.maxTokens });
  SP.release(a.hold); if (b.ok) SP.release(b.hold);
  const c2 = SP.allow(two, D, 'chat', 4000);
  check('and once it is, the room is back', c2.ok && c2.maxTokens === 4000);
  SP.release(c2.hold);
  const haiku = SP.allow(person({ model: 'claude-haiku-5-5', think: 'off' }, { monthly: 1, daily: null, request: null }), D, 'report', 16000);
  check('Haiku 5.5 never asks for a backup model (it has none)', haiku.ok && !haiku.backup && haiku.thinking.type === 'disabled');
  SP.release(haiku.hold);
}

section('Settings that came from an older version');
{
  const S = { ai: { model: { id: 'claude-opus-5', name: 'Claude Opus 5', day: 20000 } } };
  SP.ensure(S);
  check('the model the app last picked stays, when it\'s one they can pick now', S.ai.claude.model === 'claude-opus-5' && S.ai.claude.think === 'auto' && !('model' in S.ai));
  const T = { ai: { model: { id: 'claude-opus-9', name: 'Claude Opus 9' } } };
  SP.ensure(T);
  check('anything else starts on the default', T.ai.claude.model === 'claude-opus-5-5');
  check('everyone starts with a $10 monthly budget, shared out by day', S.ai.budget.monthly === 10 && S.ai.budget.daily === null && S.ai.budget.request === null);
  const U = { ai: { budget: { monthly: -3, daily: 'x', request: 0.5 }, claude: { model: 'claude-haiku-5-5', think: 'off' } } };
  SP.ensure(U);
  check('limits that aren\'t amounts mean none; a choice that is one stays', U.ai.budget.monthly === null && U.ai.budget.daily === null && U.ai.budget.request === 0.5 && U.ai.claude.think === 'off');
}

section('Keeping the record small');
{
  const S = person();
  const D = day('2026-10-11');
  for (let i = 0; i < 100; i++) SP.record(S, D - i, { feature: 'chat', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 10 } });
  const days = Object.keys(SP.data(S).days).map(Number);
  check('days older than about two months go; months stay', Math.min(...days) >= D - 62 && Object.keys(SP.data(S).months).length >= 4);
  check('the log keeps the last 40 requests', SP.data(S).log.length === 40);
}

done();
