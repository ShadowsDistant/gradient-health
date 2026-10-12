/* Chat history (GH.chats): the coach's conversations, kept on the phone. Pure functions of the
 * state; the chat sheet (src/ui/chat.js) draws them and the coaches (src/devicecoach.js, src/claude.js)
 * add each exchange to the one it belongs to.
 *
 * S.ai.chats: [{ id, title, started, used, msgs: [{ role: 'user' | 'assistant', text, engine:
 * 'device' | 'api', ...what the answer kept (model, facts, note, cost, embeds, safety, flagged) }] }]
 * in the order they were started; S.ai.chatId is the one open in the chat (null: a new chat, which
 * is only kept once its first answer is in). The title is the first question, trimmed (no model is
 * asked to name it). At most 50 conversations of 60 messages each: past that the oldest go first, so
 * the saved state stays small. Before 1.11 there was one log per engine (S.ai.chat for Claude,
 * S.ai.deviceChat for the phone): migrate() turns each into a conversation, once.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const MAX_CHATS = 50;
  const MAX_MSGS = 60;
  const DAY_MS = 86400000;
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  // Conversations deleted this session: an answer still on its way to one doesn't bring it back.
  const gone = new Set();

  function all(S) {
    const ai = S.ai || (S.ai = {});
    if (!Array.isArray(ai.chats)) ai.chats = [];
    return ai.chats;
  }
  const get = (S, id) => (id ? all(S).find((c) => c.id === id) || null : null);
  // The open conversation, or null for a new chat.
  const current = (S) => get(S, S.ai && S.ai.chatId);
  // Newest first: the one used last at the top.
  const recent = (S) => all(S).slice().sort((a, b) => (b.used || 0) - (a.used || 0));
  function newId(S) {
    let id;
    do id = `c${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`; while (get(S, id) || gone.has(id));
    return id;
  }
  // The conversation a question goes in: the one asked for (the chat passes the one it was asked
  // in, which an answer still lands in when another is opened meanwhile), else the open one, else a
  // new one that's open from now on.
  function target(S, id) {
    if (id !== undefined && id !== null) return id;
    return S.ai.chatId || (S.ai.chatId = newId(S));
  }
  // The first question as a title: one line, at most 60 characters, cut at a word.
  function titleOf(q) {
    const t = String(q || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 60) return t || 'Chat';
    const cut = t.slice(0, 59);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
  }
  // Adds messages to a conversation (made when it doesn't exist yet, with its first question as its
  // title), keeps the newest 60 and the newest 50 conversations, and returns it; null when it was
  // deleted while its answer was on the way.
  function add(S, id, msgs, now) {
    const t = now || Date.now();
    if (id && gone.has(id)) return null;
    let c = get(S, id);
    if (!c) {
      const q = (msgs || []).find((m) => m && m.role === 'user');
      c = { id: id || newId(S), title: titleOf(q && q.text), started: t, used: t, msgs: [] };
      all(S).push(c);
    }
    c.msgs = c.msgs.concat((msgs || []).filter(isObj));
    if (c.msgs.length > MAX_MSGS) c.msgs = c.msgs.slice(c.msgs.length - MAX_MSGS);
    c.used = t;
    const list = all(S);
    while (list.length > MAX_CHATS) {
      const old = list.filter((x) => x !== c).sort((a, b) => (a.used || 0) - (b.used || 0))[0];
      list.splice(list.indexOf(old), 1);
    }
    return c;
  }
  // Takes one away: { chat, index, open } for Undo (restore), or null.
  function remove(S, id) {
    const list = all(S);
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) return null;
    const chat = list.splice(index, 1)[0];
    gone.add(id);
    const open = S.ai.chatId === id;
    if (open) S.ai.chatId = null;
    return { chat, index, open };
  }
  function restore(S, was) {
    if (!was || !was.chat || get(S, was.chat.id)) return;
    gone.delete(was.chat.id);
    const list = all(S);
    list.splice(Math.min(was.index, list.length), 0, was.chat);
    if (was.open) S.ai.chatId = was.chat.id;
  }
  function clear(S) {
    for (const c of all(S)) gone.add(c.id);
    S.ai.chats = [];
    S.ai.chatId = null;
  }
  // The whole exchanges of a conversation (a question and its answer), oldest first, leaving out the
  // app's own safety answers and answers the person reported: what a follow-up goes with.
  function turns(S, id) {
    const c = get(S, id);
    const log = c ? c.msgs : [];
    const out = [];
    for (let i = 0; i + 1 < log.length; i++) {
      const u = log[i], a = log[i + 1];
      if (u.role !== 'user' || a.role !== 'assistant') continue;
      i++;
      if (u.safety || a.safety || a.flagged || !a.text) continue;
      out.push([u, a]);
    }
    return out;
  }
  // Who answered last in a conversation: 'device' or 'api'.
  function engineOf(c) {
    for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].role === 'assistant' && c.msgs[i].engine) return c.msgs[i].engine;
    return 'device';
  }

  // 1.11: the two logs become conversations, once (their fields go). Each message notes which engine
  // answered. The one for the coach in use is open in the chat, as the log was.
  function migrate(S) {
    const ai = S && S.ai;
    if (!isObj(ai)) return;
    all(S);
    if (ai.chatId !== null && typeof ai.chatId !== 'string') ai.chatId = null;
    for (const [engine, k] of [['api', 'chat'], ['device', 'deviceChat']]) {
      const log = ai[k];
      delete ai[k];
      if (!Array.isArray(log)) continue;
      const msgs = log.filter((m) => isObj(m) && (m.role === 'user' || m.role === 'assistant')).map((m) => {
        const x = Object.assign({}, m, { text: String(m.text != null ? m.text : m.content || ''), engine });
        delete x.content;
        return x;
      }).filter((m) => m.text);
      if (!msgs.length) continue;
      // Claude's messages kept their day; the phone's didn't.
      const days = msgs.map((m) => m.day).filter((d) => Number.isInteger(d));
      const at = days.length ? Math.max(...days) * DAY_MS + DAY_MS / 2 : Date.now();
      const c = add(S, null, msgs, at);
      c.started = days.length ? Math.min(...days) * DAY_MS + DAY_MS / 2 : at;
      if ((ai.mode === 'api' ? 'api' : 'device') === engine) ai.chatId = c.id;
    }
  }
  (GH.migrations = GH.migrations || []).push(migrate);

  GH.chats = { MAX_CHATS, MAX_MSGS, all, get, current, recent, newId, target, titleOf, add, remove, restore, clear, turns, engineOf, migrate };
})(typeof window !== 'undefined' ? window : globalThis);
