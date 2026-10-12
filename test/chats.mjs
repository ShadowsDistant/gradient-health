// Chat history (src/chats.js): conversations with a title from their first question, kept to 50 of
// 60 messages each, oldest first to go; deleting one (and Undo), and an answer on its way to a
// deleted one not bringing it back; the earlier turns a follow-up goes with; the one-time move of the
// two logs from before 1.11 into conversations; and the store's checks of what a backup holds.
import { load, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/health.js', 'src/food.js', 'src/store.js', 'src/chats.js');
const B = GH.brain, C = GH.chats, store = GH.store;
const D0 = B.dayFromStr('2026-09-28');
const fresh = () => store.migrate(B.newState({ goals: ['abs'], age: 30 }, null, D0 - 7));
const ex = (q, a, engine) => [{ role: 'user', text: q, engine }, { role: 'assistant', text: a, engine }];

section('Conversations');
{
  const S = fresh();
  check('a new state has none, and none open', Array.isArray(S.ai.chats) && S.ai.chats.length === 0 && S.ai.chatId === null && !('chat' in S.ai) && !('deviceChat' in S.ai));
  const id = C.target(S);
  check('a question with none open starts one, which is open from then on', typeof id === 'string' && S.ai.chatId === id && !C.get(S, id));
  const c = C.add(S, id, ex('   How is my   sleep\nthis week?', 'Fine.', 'device'), 1000);
  check('it\'s kept once its answer is in, titled with its first question on one line', c.id === id && c.title === 'How is my sleep this week?' && c.started === 1000 && c.used === 1000 && C.current(S) === c);
  C.add(S, id, ex('And steps?', 'Good.', 'api'), 2000);
  check('a follow-up goes in the same one, each message saying who answered', c.msgs.length === 4 && c.used === 2000 && c.title === 'How is my sleep this week?' && c.msgs.map((m) => m.engine).join() === 'device,device,api,api' && C.engineOf(c) === 'api');
  check('the target of an answer is the one it was asked in, even with another open', C.target(S, 'cOther') === 'cOther' && S.ai.chatId === id);
  const long = C.titleOf('What should I focus on this week to get stronger without hurting my knees again please');
  check('a long question is cut at a word for its title', long.length <= 60 && long.endsWith('…') && !/\s…$/.test(long), long);
  const two = C.add(S, null, ex('Second?', 'Yes.', 'device'), 3000);
  check('newest used first', C.recent(S)[0] === two && C.recent(S)[1] === c);
}

section('Kept small');
{
  const S = fresh();
  const one = C.add(S, 'c1', [], 1);
  for (let i = 0; i < 40; i++) C.add(S, 'c1', ex(`Q${i}`, `A${i}`, 'device'), 10 + i);
  check('60 messages a conversation, the oldest go first', one.msgs.length === 60 && one.msgs[0].text === 'Q10' && one.msgs[59].text === 'A39');
  for (let i = 0; i < 55; i++) C.add(S, `k${i}`, ex(`Q${i}`, 'A', 'api'), 1000 + i);
  check('50 conversations, the one used longest ago going first', S.ai.chats.length === 50 && !C.get(S, 'c1') && !C.get(S, 'k0') && !C.get(S, 'k4') && !!C.get(S, 'k5') && !!C.get(S, 'k54'));
  C.add(S, 'k5', ex('Again', 'A', 'api'), 5000);
  C.add(S, 'n1', ex('New', 'A', 'api'), 5001);
  check('carrying on an old one keeps it', !!C.get(S, 'k5') && !C.get(S, 'k6') && S.ai.chats.length === 50);
  const json = JSON.stringify(S.ai.chats).length;
  check(`so the saved chats stay small (${Math.round(json / 1024)} KB here)`, json < 400000, json);
}

section('Deleting, and Undo');
{
  const S = fresh();
  C.add(S, 'a', ex('One?', 'A', 'device'), 1);
  C.add(S, 'b', ex('Two?', 'B', 'device'), 2);
  C.add(S, 'c', ex('Three?', 'C', 'device'), 3);
  S.ai.chatId = 'b';
  const was = C.remove(S, 'b');
  check('a deleted one goes, and the chat is a new one if it was open', !C.get(S, 'b') && S.ai.chats.length === 2 && S.ai.chatId === null && was.open && was.index === 1);
  check('an answer still on its way to it doesn\'t bring it back', C.add(S, 'b', ex('Two?', 'late', 'device')) === null && !C.get(S, 'b'));
  C.restore(S, was);
  check('Undo puts it back where it was, open again', S.ai.chats.map((x) => x.id).join() === 'a,b,c' && S.ai.chatId === 'b' && C.get(S, 'b').msgs.length === 2);
  check('and it takes answers again', C.add(S, 'b', ex('More?', 'M', 'device')).msgs.length === 4);
  C.clear(S);
  check('Delete all leaves none, none open', S.ai.chats.length === 0 && S.ai.chatId === null && C.add(S, 'a', ex('x', 'y', 'device')) === null);
}

section('What a follow-up goes with');
{
  const S = fresh();
  C.add(S, 'f', ex('How is my sleep?', 'Fine.', 'device'), 1);
  C.add(S, 'f', [{ role: 'user', text: 'Chest pain', engine: 'device', safety: true }, { role: 'assistant', text: 'See a doctor.', engine: 'device', safety: true }], 2);
  C.add(S, 'f', ex('And steps?', 'Good.', 'api'), 3);
  C.get(S, 'f').msgs[5].flagged = true;
  C.add(S, 'f', ex('And weight?', 'Steady.', 'api'), 4);
  C.add(S, 'f', [{ role: 'user', text: 'Unanswered', engine: 'api' }], 5);
  const t = C.turns(S, 'f');
  check('whole exchanges only, without the app\'s safety answers or ones the person reported', t.length === 2 && t[0][0].text === 'How is my sleep?' && t[1][1].text === 'Steady.', t.map((x) => x[0].text));
  check('nothing for a chat that isn\'t there', C.turns(S, 'nope').length === 0 && C.turns(S, null).length === 0);
}

section('From the logs before 1.11, once');
{
  const S = B.newState({ goals: ['abs'], age: 30 }, null, D0 - 7);
  S.ai.mode = 'api';
  S.ai.chat = [{ role: 'user', text: 'How is my sleep?', day: D0 - 2 }, { role: 'assistant', text: 'About 7 h.', day: D0 - 2, cost: 1200, model: 'claude-opus-5-5' }, { role: 'user', content: 'And steps?', day: D0 - 1 }, { role: 'assistant', content: 'Good.', day: D0 - 1 }, null, 'junk'];
  S.ai.deviceChat = [{ role: 'user', text: 'Am I stronger?', safety: false }, { role: 'assistant', text: 'Yes.', model: 'q35-08', facts: ['Level up'] }];
  const M = store.migrate(S);
  const [api, dev] = M.ai.chats;
  check('each log is a conversation, nothing lost', M.ai.chats.length === 2 && api.msgs.length === 4 && dev.msgs.length === 2 && api.msgs[3].text === 'Good.' && !('content' in api.msgs[2]));
  check('each message says which coach answered, keeping what it had', api.msgs.every((m) => m.engine === 'api') && dev.msgs.every((m) => m.engine === 'device') && api.msgs[1].cost === 1200 && dev.msgs[1].facts[0] === 'Level up');
  check('titled with their first question, Claude\'s dated from its days', api.title === 'How is my sleep?' && dev.title === 'Am I stronger?' && api.started === (D0 - 2) * B.DAY_MS + B.DAY_MS / 2 && api.used === (D0 - 1) * B.DAY_MS + B.DAY_MS / 2);
  check('the one for the coach in use is open, as the log was', M.ai.chatId === api.id);
  check('the old logs are gone, so it runs once', !('chat' in M.ai) && !('deviceChat' in M.ai) && store.migrate(M).ai.chats.length === 2);
  const back = store.importJson(JSON.stringify({ app: 'gradient-health', schema: 1, state: Object.assign(B.newState({ goals: ['abs'] }, null, D0), { ai: { mode: 'device', deviceChat: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello.' }] } }) }));
  check('a backup from before 1.11 comes back with its chat as a conversation', back.ok && back.state.ai.chats.length === 1 && back.state.ai.chats[0].msgs.length === 2 && back.state.ai.chatId === back.state.ai.chats[0].id, back.error);
}

section('A backup\'s chats are checked');
{
  const S = fresh();
  for (let i = 0; i < 3; i++) C.add(S, `c${i}`, ex(`Q${i}`, `A${i}`, 'device'), i + 1);
  S.ai.chatId = 'c1';
  const back = store.importJson(store.exportJson(S));
  check('they go in Copy my data and come back unchanged', back.ok && JSON.stringify(back.state.ai.chats) === JSON.stringify(S.ai.chats) && back.state.ai.chatId === 'c1');
  const T = JSON.parse(store.exportJson(S));
  const chats = T.state.ai.chats;
  for (let i = 0; i < 50; i++) chats.push({ id: `z${i}`, msgs: [] });
  chats.push({ id: 'z9', title: 'twice', msgs: [] }, { id: 'x'.repeat(80), msgs: [] }, { id: 'ok', title: 7, started: 'no', msgs: [{ role: 'system', text: 'hi' }, { role: 'user', text: 5 }, { role: 'user', text: 'fine', engine: 'gpt', facts: 'x', embeds: ['sleep', 3] }] }, null, 'junk');
  T.state.ai.chatId = 42;
  const R = store.importJson(JSON.stringify(T));
  const rc = R.ok ? R.state.ai.chats : [];
  const ok = rc.find((c) => c.id === 'ok');
  check('the newest 50, each once, with plain ids', R.ok && rc.length <= 50 && new Set(rc.map((c) => c.id)).size === rc.length && rc.every((c) => typeof c.id === 'string' && c.id.length <= 40), R.error);
  check('titles and times of the right type, messages a role and words', !!ok && (ok.title === '' && ok.started === 0 && ok.msgs.length === 1 && ok.msgs[0].text === 'fine' && !('engine' in ok.msgs[0]) && JSON.stringify(ok.msgs[0].facts) === '[]' && JSON.stringify(ok.msgs[0].embeds) === '["sleep"]'), ok);
  check('and an open chat that isn\'t an id is none', R.ok && R.state.ai.chatId === null);
}

done();
