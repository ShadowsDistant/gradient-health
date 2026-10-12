/* The coach chat: ask the on-device model (runs on the phone, grounded in what the built-in coach
 * works out) or Claude (your own API key), report an answer, or hand the question to the Claude app.
 * Opened from the coach button at the top left of every tab (U.coachBtn), or U.act.askCoach.
 *
 * Answers read like small cards: their Markdown drawn by src/ui/md.js, and the data embeds they name
 * ([[sleep]], [[workouts]]...) drawn from the app's own numbers (src/ui/embeds.js). Every
 * conversation is kept (src/chats.js): New chat starts another, Chats lists them to open, carry on or
 * delete.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const AI = () => GH.ai;
  const CH = () => GH.chats;
  const canHandOff = () => !!(GH.platform && (GH.platform.isApp() || (G.navigator && G.navigator.share)));
  U.canHandOff = canHandOff;

  /* ---------------------------------------------------------------- chat */
  // Two ways to get an answer, picked from the pill at the top of the chat: the on-device model (runs
  // on the phone, nothing leaves it, grounded in what the built-in coach works out) or Claude (your
  // own API key; streams in). "Ask in the Claude app" hands the question to the Claude app.
  let chat = null;      // the open chat sheet
  let engineSheet = null;
  // The exchange in progress (or the last one that failed or was stopped), kept here rather than in
  // the page so a redraw can't lose it: { id, engine, chat (its conversation), q, text, status,
  // fraction, error, note, done, ctl }. One at a time; it carries on in its own conversation whatever
  // is opened meanwhile.
  let live = null;
  let seq = 0;
  let unseen = false;   // an answer finished while the chat was closed: the coach button shows a dot
  let landed = null;    // ...or in a conversation that isn't the open one: Chats shows a dot
  let crashNote = null; // the page restarted while the in-app model worked (see GH.llm.lastCrash)
  let crashChecked = false;
  let earlier = false;  // the open conversation's earlier messages are shown
  const SHOWN = 24;     // the newest messages shown before "Show earlier"
  const engineOf = (S) => (S.ai.mode === 'api' ? 'api' : 'device');
  const openId = (S) => S.ai.chatId || null;
  const msgsOf = (S) => { const c = CH() && CH().current(S); return c ? c.msgs : []; };
  const busy = () => !!(live && !live.done);
  const liveHere = (S) => !!(live && live.chat && live.chat === openId(S));
  const modelName = (id) => { const m = GH.llm && GH.llm.MODELS.find((x) => x.id === id); return m ? m.name : null; };

  /* The coach button: top left on every tab (core.js puts it there). A ring while an answer is on
     its way with the chat closed, a dot once it has arrived: both drawn by a mark of their own
     (.coach-mark), so the glass keeps all of Refract's own look (its rim, sheen, press glow and click
     ring live on its ::before and ::after). */
  U.coachBtn = () => {
    const out = busy() && !(chat && !chat.closed);
    return `<button type="button" class="rf-btn rf-glass coach-btn" data-shape="circle" data-lens aria-label="Ask the coach" data-act="askCoach"${out ? ' data-busy' : ''}${unseen && !out ? ' data-unseen' : ''}>${U.icon('sparkle')}<span class="coach-mark" aria-hidden="true"></span></button>`;
  };
  function syncButtons() {
    const out = busy() && !(chat && !chat.closed);
    for (const b of document.querySelectorAll('.coach-btn')) { b.toggleAttribute('data-busy', out); b.toggleAttribute('data-unseen', unseen && !out); }
  }

  // What the on-device model needs before it can answer, or null when it's ready.
  function deviceGate() {
    const d = U.deviceState ? U.deviceState() : null;
    if (!d || !d.checked) return `<div class="chat-setup"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout rf-muted">Checking the on-device model…</span></div>`;
    if (!d.available.ok) return `<div class="chat-setup card"><p class="t-callout">${U.esc(d.available.reason)}</p><p class="t-footnote rf-muted">You can still use Claude with your own API key, or the Claude app.</p></div>`;
    if (!d.installed.length) return `<div class="chat-setup card"><span class="chat-setup-ico" aria-hidden="true">${U.icon('chip')}</span><p class="t-headline">Get the on-device coach</p><p class="t-callout rf-muted">A small AI model on your phone. It works offline, and your questions and data never leave it. You can change it later.</p>${U.modelRows ? `<ul class="rf-list">${U.modelRows(U.S, { compact: true })}</ul>` : ''}</div>`;
    return null;
  }
  function gate(S) {
    const e = engineOf(S);
    if (e === 'api' && !(AI() && AI().hasKey())) return `<div class="chat-setup card"><p class="t-headline">Add your API key</p><p class="t-callout rf-muted">Claude answers with your own Anthropic API key, which stays on this phone.</p><button type="button" class="rf-btn" data-variant="filled" data-act="keySheet">Add a key</button></div>`;
    if (e === 'api' && !S.ai.consentAt) return `<div class="chat-setup card"><p class="t-headline">Claude needs your OK</p><p class="t-callout rf-muted">It gets a summary of your data with each question. See what's in it first.</p><button type="button" class="rf-btn" data-variant="filled" data-act="chatConsent">Review</button></div>`;
    return e === 'device' ? deviceGate() : null;
  }

  // The pill at the top: who answers, with which model, and whether it's ready.
  function pill(S) {
    const e = engineOf(S);
    let name = 'Claude', sub = '', on = false;
    if (e === 'api') { sub = GH.spend ? `${GH.spend.model(S).short} · ${GH.spend.LEVEL_NAMES[GH.spend.level(S)]}` : ''; on = !!(AI() && AI().hasKey() && S.ai.consentAt); } else {
      const d = U.deviceState ? U.deviceState() : null;
      name = 'On this phone';
      const id = d && d.installed.length && GH.deviceCoach ? GH.deviceCoach.pick(S, d.installed) : null;
      const loaded = GH.llm && GH.llm.loaded();
      sub = id ? modelName(id) || '' : d && d.checked ? 'Not set up' : '';
      on = !!(loaded && loaded.id === id);
    }
    return `<button type="button" class="chat-pill" data-act="chatEngineSheet" aria-label="Who answers: ${U.esc(name)}${sub ? `, ${U.esc(sub)}` : ''}. Change">
      ${U.icon(e === 'api' ? 'sparkle' : 'chip', 'sm')}<span class="pill-text">${U.esc(name)}${sub ? `<span class="pill-sub"> · ${U.esc(sub)}</span>` : ''}</span><span class="pill-dot"${on ? ' data-on' : ''} aria-hidden="true"></span>${U.icon('chevron-down', 'sm')}</button>`;
  }

  /* ---------------------------------------------------------------- answers as cards */
  // Answers' Markdown (src/ui/md.js) and their embeds (src/ui/embeds.js) are a part that loads when
  // the chat is about to open (a finger on the coach button, or the chat itself); until it's in, an
  // answer is its words as they are, and it's drawn again as soon as it is.
  const part = () => (GH.md && GH.embeds ? Promise.resolve(true) : GH.lazy('cards').catch(() => false));
  document.addEventListener('pointerdown', (e) => { if (!GH.embeds && e.target && e.target.closest && e.target.closest('.coach-btn, [data-act="askPreset"]')) part(); }, { capture: true, passive: true });
  // Each embed drawn once per drawing of the chat (and kept while an answer streams in, so its card
  // isn't worked out again every frame).
  const embedCache = new Map();
  function embedHtml(token) {
    if (!GH.embeds) return '';
    if (!embedCache.has(token)) embedCache.set(token, GH.embeds.html(U.S, U.today(), token));
    return embedCache.get(token);
  }
  // An answer's words and the embeds the app added after them. streaming: still coming in, with the
  // caret at the end of its last line.
  function answerHtml(text, embeds, streaming) {
    let html = GH.md ? GH.md.render(text, { streaming, embed: embedHtml }) : `<p>${U.esc(GH.coach ? GH.coach.noEmbeds(text) : text).replace(/\n+/g, '<br>')}</p>`;
    if (streaming) {
      const caret = '<span class="caret" aria-hidden="true"></span>';
      const at = /(<\/(?:p|li|h3|h4|td|th)>)((?:<\/(?:ul|ol|li|tr|tbody|thead|table|div)>)*)$/;
      html = at.test(html) ? html.replace(at, `${caret}$1$2`) : html + caret;
    }
    return html + (embeds || []).map(embedHtml).join('');
  }

  const AVATAR = `<span class="msg-av" aria-hidden="true">${U.icon('sparkle', 'sm')}</span>`;
  const tool = (act, i, icon, label) => `<button type="button" class="msg-tool" data-act="${act}" data-arg="${i}">${U.icon(icon, 'sm')}${label}</button>`;
  const flagBtn = (i) => tool('flagAnswer', i, 'flag', 'Report');
  const userMsg = (text) => `<div class="msg me"><div class="bubble me">${U.esc(text)}</div></div>`;
  function coachMsg(m, i) {
    if (m.flagged) return `<div class="msg coach">${AVATAR}<div class="msg-main"><div class="bubble coach is-flagged">You reported this answer, so it's hidden.</div></div></div>`;
    // A Claude answer says which model wrote it and what it cost.
    const sp = GH.spend;
    const meta = m.cost != null && sp ? `<span class="msg-meta t-caption rf-num">${U.esc(`${sp.byId(m.model) ? sp.byId(m.model).short : 'Claude'} · ${sp.money(m.cost)}`)}</span>` : '';
    const tools = m.safety ? '' : `<div class="msg-tools">${tool('copyAnswer', i, 'copy', 'Copy')}${m.facts && m.facts.length ? tool('answerFacts', i, 'info', 'What it used') : ''}${flagBtn(i)}${meta}</div>`;
    const note = m.note ? `<p class="t-footnote rf-muted msg-note">${U.esc(m.note)}</p>` : '';
    return `<div class="msg coach">${AVATAR}<div class="msg-main"><div class="bubble coach answer${m.stopped ? ' is-stopped' : ''}${m.safety ? ' is-safety' : ''}">${answerHtml(m.text, m.embeds)}</div>${note}${tools}</div></div>`;
  }
  const STATUS = { loading: 'Starting the model', thinking: 'Thinking', reading: 'Reading your numbers', writing: 'Writing' };
  function liveInner(l) {
    if (l.error) return `<div class="bubble coach is-error">${U.esc(l.error)}</div><div class="msg-tools">${l.budget ? tool('claudePage', 0, 'card', 'Limits') : tool('askRetry', 0, 'refresh', 'Try again')}</div>`;
    if (l.text) return `<div class="bubble coach answer${l.done ? '' : ' is-writing'}">${answerHtml(l.text, null, !l.done)}</div>${l.done && l.note ? `<p class="t-footnote rf-muted msg-note">${U.esc(l.note)}</p>` : ''}`;
    if (l.done) return `<div class="bubble coach is-stopped">${U.esc(l.note || 'Stopped.')}</div>`;
    const f = l.fraction;
    const pct = f != null && f > 0 && l.status !== 'thinking' ? ` ${Math.round(f * 100)}%` : '…';
    return `<div class="bubble coach is-typing"><span class="bubble-status">${STATUS[l.status] || STATUS.thinking}${pct}</span>${f != null && l.status !== 'thinking' ? `<span class="chat-prog" aria-hidden="true"><i style="--p:${Math.max(0.02, Math.min(1, f)).toFixed(3)}"></i></span>` : ''}</div>`;
  }
  const liveHtml = (S) => (liveHere(S) ? `${userMsg(live.q)}<div class="msg coach" id="chatLive" aria-live="polite">${AVATAR}<div class="msg-main">${liveInner(live)}</div></div>` : '');

  // Questions worth asking today, from what the app knows (so they have good answers).
  function suggestions(S, day) {
    const B = GH.brain, H = GH.health;
    const out = [];
    const has = (k) => { try { return H.stats(S, k, day - 6, day).n >= 3; } catch (e) { return false; } };
    if (S.profile.workouts !== false) {
      try {
        const plan = B.todayPlan(S, day);
        if (plan.type === 'light' || B.readiness(S, day).reasons.length) out.push(['Why is today lighter?', 'leaf']);
        else if (plan.type === 'workout') out.push(['Why this workout today?', 'dumbbell']);
      } catch (e) { /* no plan */ }
    }
    if (has('sleepMin')) out.push(['How is my sleep?', 'moon']);
    if (S.profile.workouts !== false && S.log.filter((l) => l.type === 'workout').length >= 3) out.push(['Am I getting stronger?', 'chart']);
    if ((S.weights || []).length >= 3) out.push(['How is my weight trending?', 'scale']);
    if (has('steps')) out.push(['Am I moving enough?', 'compass']);
    return out.slice(0, 3).concat([['What should I focus on this week?', 'star']]);
  }
  function emptyState(S) {
    const e = engineOf(S);
    const cards = suggestions(S, U.today()).map(([q, icon]) => `<button type="button" class="chat-card" data-act="askQuick" data-arg="${U.esc(q)}">${U.icon(icon)}<span>${U.esc(q)}</span></button>`).join('');
    const tailor = U.act.tailorPlan && S.profile.workouts !== false ? `<button type="button" class="chat-card is-wide" data-act="tailorPlan">${U.icon('sliders')}<span>Tailor my plan<span class="chat-card-sub">Tell the coach what you want more or less of</span></span></button>` : '';
    return `<div class="chat-hello">${AVATAR}<p class="t-title3">Ask about your training, sleep or food</p><p class="t-callout rf-muted">${e === 'api' ? 'Claude sees the same summary as the weekly report.' : 'It answers from your own numbers, on this phone.'}</p></div>
      <div class="chat-cards">${cards}${tailor}</div>`;
  }
  function logBody(S) {
    const note = crashNote && engineOf(S) === 'device' ? `<div class="chat-note card"><span aria-hidden="true">${U.icon('alert', 'sm')}</span><p class="t-footnote">${U.esc(crashNote)}</p></div>` : '';
    const g = gate(S);
    if (g) return note + g;
    const all = msgsOf(S);
    const start = earlier ? 0 : Math.max(0, all.length - SHOWN);
    const msgs = all.slice(start);
    if (!msgs.length && !liveHere(S)) return note + emptyState(S);
    const more = start > 0 ? `<button type="button" class="rf-btn chat-earlier" data-variant="plain" data-size="sm" data-act="chatEarlier">Show ${U.plural(start, 'earlier message')}</button>` : '';
    // AI answers can be reported; a reported one stays hidden. Safety answers are the app's own.
    return note + more + msgs.map((m, i) => (m.role === 'user' ? userMsg(m.text) : coachMsg(m, start + i))).join('') + liveHtml(S);
  }
  U.act.chatEarlier = () => { earlier = true; refreshChat(); };
  const FOOT = {
    device: 'Runs on your phone and can be wrong.',
    api: 'Claude sees a summary without your name, not your raw data.',
  };
  function composeBtn() {
    return busy() && liveHere(U.S)
      ? `<button type="button" class="rf-btn rf-glass" data-shape="circle" aria-label="Stop" data-act="askStop">${U.icon('stop')}</button>`
      : `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-shape="circle" aria-label="Send" data-act="askSend">${U.icon('send')}</button>`;
  }
  function chatBody(S) {
    const e = engineOf(S);
    const ready = !gate(S);
    const small = (act, icon, label, extra) => `<button type="button" class="rf-btn chat-bar-btn" data-variant="plain" data-shape="circle" data-size="sm" aria-label="${label}" data-act="${act}"${extra || ''}>${U.icon(icon)}</button>`;
    return `<div class="chat-bar">${pill(S)}${small('chatNew', 'compose', 'New chat')}${small('chatList', 'chat', 'Chats', landed ? ' data-unseen' : '')}${small('chatMenu', 'more', 'More')}</div>
      <div class="chat-log" id="chatLog">${logBody(S)}</div>
      <div class="chat-compose"${ready ? '' : ' hidden'}><textarea class="rf-input" id="askQ" rows="1" maxlength="600" placeholder="Ask a question" aria-label="Your question" enterkeyhint="send"></textarea>${composeBtn()}</div>
      <p class="t-footnote rf-muted chat-foot">${FOOT[e]} Not medical advice.</p>`;
  }
  const nearBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < 96;
  // Redraws the chat (keeps what's typed, and the newest answer in view if it was). to: 'bottom' or
  // 'top' to scroll there (another conversation opened).
  function refreshChat(to) {
    embedCache.clear();
    if (engineSheet && !engineSheet.closed) engineSheet.update(engineBody(U.S));
    refreshList();
    if (!chat || chat.closed) return;
    const q = chat.el.querySelector('#askQ');
    const typed = q ? q.value : '';
    const log0 = chat.el.querySelector('#chatLog');
    const stick = !log0 || nearBottom(log0);
    chat.update(chatBody(U.S));
    const q2 = chat.el.querySelector('#askQ');
    if (q2 && typed) { q2.value = typed; grow(q2); }
    const log = chat.el.querySelector('#chatLog');
    if (log && (to === 'top')) log.scrollTop = 0;
    else if (log && (stick || to === 'bottom')) log.scrollTop = log.scrollHeight;
  }
  U.refreshChat = refreshChat;
  // The answer in progress, patched in place at most once a frame as words arrive (U.morph keeps
  // what's already there: an embed's card, the caret).
  let paintFrame = 0;
  function paintLive() {
    if (paintFrame) return;
    paintFrame = G.requestAnimationFrame(() => {
      paintFrame = 0;
      syncButtons();
      if (!chat || chat.closed || !live || !liveHere(U.S)) return;
      const box = chat.el.querySelector('#chatLive .msg-main');
      if (!box) { refreshChat(); return; }
      const log = chat.el.querySelector('#chatLog');
      const stick = log && nearBottom(log);
      U.morph(box, liveInner(live));
      if (log && stick) log.scrollTop = log.scrollHeight;
    });
  }
  // The question box grows with what's typed (up to about five lines).
  function grow(t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 132)}px`; }
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'askQ') grow(e.target); });
  document.addEventListener('keydown', (e) => {
    // Enter sends on a keyboard with Shift; the phone's own "send" key sends too.
    if (e.target && e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && (e.target.getAttribute('enterkeyhint') === 'send')) {
      e.preventDefault();
      U.act.askSend();
    }
  });

  U.act.askCoach = (el, ev, preset) => {
    const S = U.S;
    // Tapped: its sparkle beats once (Refract's symbol effect) as the chat comes up.
    const ico = el && el.classList && el.classList.contains('coach-btn') ? el.querySelector('.rf-icon') : null;
    if (ico && G.Refract && G.Refract.effect) { try { G.Refract.effect(ico, 'beat'); } catch (e) { /* only a flourish */ } }
    unseen = false;
    if (chat && !chat.closed) { syncButtons(); return; }
    earlier = false;
    // A suggested question starts a chat of its own.
    if (preset && !busy()) S.ai.chatId = null;
    embedCache.clear();
    if (!GH.embeds) part().then((ok) => { if (ok) refreshChat(); });
    chat = U.sheet({
      title: 'Ask the coach', size: 'full', cls: 'chat-sheet',
      body: chatBody(S),
      // Closing doesn't stop an answer: it carries on, and the coach button shows when it's there.
      onClose: () => { chat = null; syncButtons(); },
      after: (c) => { const log = c.el.querySelector('#chatLog'); if (log) log.scrollTop = log.scrollHeight; },
    });
    syncButtons();
    // A suggested question goes in once the sheet is up and, for the on-device coach, once it's
    // known whether the model is there (the box to type in waits for that).
    const me = chat;
    const send = () => {
      if (!preset || chat !== me || !chat || busy()) return;
      const q = chat.el.querySelector('#askQ');
      const box = chat.el.querySelector('.chat-compose');
      if (q && !q.value) q.value = preset;
      if (box && !box.hidden) U.act.askSend();
    };
    if (preset) { const q = chat.el.querySelector('#askQ'); if (q) q.value = preset; }
    const wait = new Promise((r) => setTimeout(r, 380));
    if (engineOf(S) === 'device' && U.checkDevice) {
      U.checkDevice().then(async () => {
        if (chat !== me) return;
        await checkCrash();
        refreshChat();
        if (!deviceGate() && GH.deviceCoach && !preset && !busy()) GH.deviceCoach.prime(U.S, U.today()).then(() => { if (chat === me) refreshChat(); });
        return wait.then(send);
      });
    } else if (preset) wait.then(send);
  };
  // Once per session: if the page crashed while the in-app model worked, say so, and move to a
  // smaller size that's on the phone.
  async function checkCrash() {
    if (crashChecked) return;
    crashChecked = true;
    let c = null;
    try { const llm = await GH.lazy('llm'); c = llm.lastCrash ? llm.lastCrash() : null; } catch (e) { c = null; }
    if (!c) return;
    const S = U.S;
    S.ai.tooBig = Object.assign({}, S.ai.tooBig, { [c.id]: Date.now() });
    const d = U.deviceState ? U.deviceState() : null;
    const models = (GH.llm && GH.llm.MODELS) || [];
    const size = (id) => { const m = models.find((x) => x.id === id); return m ? m.bytes : Infinity; };
    const smaller = (d ? d.installed : []).filter((x) => x.id !== c.id && size(x.id) < size(c.id)).sort((a, b) => size(a.id) - size(b.id))[0];
    const was = modelName(c.id) || 'That size';
    if (smaller) {
      S.ai.deviceModel = smaller.id;
      crashNote = `${was} ran this phone short of memory, so the app restarted. The chat now uses ${modelName(smaller.id)}.`;
    } else crashNote = `${was} ran this phone short of memory, so the app restarted. Fast, the smallest size, should work.`;
    U.save();
  }

  /* ---------------------------------------------------------------- who answers */
  function engineBody(S) {
    const e = engineOf(S);
    const row = (v, icon, tone, title, sub) => `<li><button type="button" class="rf-list-row chat-engine-row" data-act="setChatEngine" data-arg="${v}" aria-pressed="${e === v}"><span class="rf-list-icon" data-tone="${tone}">${U.icon(icon)}</span><span class="rf-list-text"><span class="rf-list-title">${title}</span><span class="rf-list-sub">${sub}</span></span>${e === v ? `<span class="chat-engine-on">${U.icon('check')}</span>` : ''}</button></li>`;
    return `<div class="sheet-pad">
      <ul class="rf-list">${row('device', 'chip', 'violet', 'On this phone', 'Private and works offline')}${row('api', 'sparkle', 'indigo', 'Claude', 'Sharper answers, with your own API key')}</ul>
      ${e === 'api' && GH.spend && AI() && AI().hasKey() ? `<ul class="rf-list">${U.row({ key: 'claude-model', icon: 'lightbulb', tone: 'amber', title: 'Model and thinking', detail: U.esc(`${GH.spend.model(S).short} · ${GH.spend.LEVEL_NAMES[GH.spend.level(S)]}`), act: 'claudeModel', chevron: true })}${U.row({ key: 'claude-spend', icon: 'card', tone: 'teal', title: 'Spending and usage', detail: U.esc(GH.spend.todayLine(S, U.today())), act: 'claudePage', chevron: true })}</ul>` : ''}
      ${e === 'device' && U.modelRows ? `<p class="sec-title">Model</p><ul class="rf-list">${U.modelRows(S, { compact: true })}</ul><p class="t-footnote rf-muted">Bigger sizes answer better but start slower. Settings has a self-test that times each one here.</p>` : ''}
    </div>`;
  }
  U.act.chatEngineSheet = () => {
    if (U.checkDevice) U.checkDevice().then(() => refreshChat());
    engineSheet = U.sheet({ title: 'Who answers', size: 'auto', body: engineBody(U.S), onClose: () => { engineSheet = null; } });
  };
  U.act.setChatEngine = (el) => U.on.setChatEngine(el, null, el.dataset.arg);
  U.on.setChatEngine = async (el, ev, v) => {
    const S = U.S;
    if (busy()) stopLive();
    // Claude with a key: only after the person has allowed it to get their data.
    if (v === 'api' && AI() && AI().hasKey() && !S.ai.consentAt && !(await U.claudeConsent())) { refreshChat(); return; }
    S.ai.mode = v === 'api' ? 'api' : 'device';
    S.ai.enabled = S.ai.mode === 'api';
    U.save();
    if (!ev) U.haptic('select'); // a segment's change has played it already
    refreshChat();
    if (S.ai.mode === 'device' && U.checkDevice) U.checkDevice().then(() => { refreshChat(); if (!deviceGate() && GH.deviceCoach && !busy()) GH.deviceCoach.prime(U.S, U.today()); });
    if (U.route.view === 'settings' || U.route.tab === 'health') setTimeout(() => U.render(), 60);
  };
  U.act.chatConsent = async () => { if (await U.claudeConsent()) { U.S.ai.enabled = true; U.save(true); } refreshChat(); };

  /* ---------------------------------------------------------------- chats */
  // New chat: the next question starts a conversation of its own (the one open stays in Chats, and
  // an answer still coming carries on in it).
  U.act.chatNew = () => {
    const S = U.S;
    earlier = false;
    if (openId(S)) { S.ai.chatId = null; U.save(); U.haptic('select'); }
    refreshChat('top');
    const q = chat && chat.el.querySelector('#askQ');
    if (q && !q.closest('[hidden]') && !(GH.platform && GH.platform.isApp())) q.focus({ preventScroll: true });
  };
  // Chats: every conversation, newest first, grouped by when it was last used, each with who
  // answered; tap one to carry on with it. Edit shows a delete button on each (with Undo), and
  // Delete all chats.
  let listSheet = null, editing = false;
  const DAY = 86400000;
  function listBody(S) {
    const list = CH() ? CH().recent(S) : [];
    if (!list.length) return `<div class="sheet-pad chat-list-none"><span class="chat-setup-ico" aria-hidden="true">${U.icon('chat')}</span><p class="t-headline">No chats yet</p><p class="t-callout rf-muted">Questions you ask the coach are kept here, on this phone, to go back to and carry on.</p></div>`;
    const today = U.today();
    const dayOf = (ms) => GH.brain.dayOf(ms, U.rollHour());
    const groups = [['Today', []], ['Yesterday', []], ['Earlier', []]];
    for (const c of list) { const d = dayOf(c.used || c.started || 0); groups[d >= today ? 0 : d === today - 1 ? 1 : 2][1].push(c); }
    const row = (c) => {
      const api = CH().engineOf(c) === 'api';
      const d = dayOf(c.used || 0);
      const when = d >= today - 1 ? U.fmtClock(c.used) : U.fmtDay(d);
      const n = c.msgs.filter((m) => m.role === 'user').length;
      const open = c.id === openId(S);
      return `<li data-key="cl-${U.esc(c.id)}"><div class="chat-row${open ? ' is-open' : ''}">
        <button type="button" class="rf-list-row chat-row-main" data-act="chatOpen" data-arg="${U.esc(c.id)}"${open ? ' aria-current="true"' : ''}>
          <span class="rf-list-icon" data-tone="${api ? 'indigo' : 'violet'}" aria-label="${api ? 'Claude' : 'On this phone'}">${U.icon(api ? 'sparkle' : 'chip')}</span>
          <span class="rf-list-text"><span class="rf-list-title">${U.esc(c.title || 'Chat')}</span><span class="rf-list-sub">${U.esc(`${when} · ${U.plural(n, 'question')}`)}${landed === c.id ? ' · <b class="chat-row-new">New answer</b>' : ''}</span></span>
          ${open && !editing ? `<span class="chat-engine-on" aria-hidden="true">${U.icon('check')}</span>` : ''}
        </button>
        ${editing ? `<button type="button" class="rf-btn chat-row-del" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Delete ${U.esc(c.title || 'this chat')}" data-act="chatDelete" data-arg="${U.esc(c.id)}">${U.icon('trash')}</button>` : ''}
      </div></li>`;
    };
    return `<div class="chat-list${editing ? ' is-editing' : ''}">${groups.filter((g) => g[1].length).map(([name, cs]) => `<h3 class="rf-list-header">${name}</h3><ul class="rf-list" data-key="cg-${name}">${cs.map(row).join('')}</ul>`).join('')}
      ${editing ? '<div class="sheet-pad"><button type="button" class="rf-btn chat-del-all" data-variant="soft" data-tone="critical" data-act="chatDeleteAll">' + U.icon('trash') + 'Delete all chats</button></div>' : ''}
      <p class="t-footnote rf-muted chat-list-foot">Chats stay on this phone and go in Copy my data. The newest ${CH().MAX_CHATS} are kept.</p></div>`;
  }
  function refreshList() {
    if (!listSheet || listSheet.closed) return;
    listSheet.update(listBody(U.S));
    const b = listSheet.el.querySelector('.rf-sheet-header [data-act="chatListEdit"]');
    if (b) { b.textContent = editing ? 'Done' : 'Edit'; b.hidden = !(CH() && CH().all(U.S).length); }
  }
  U.act.chatList = () => {
    editing = false;
    listSheet = U.sheet({ title: 'Chats', size: 'auto', detent: 'large', cls: 'chat-list-sheet', body: listBody(U.S), action: { label: 'Edit', act: 'chatListEdit' }, onClose: () => { listSheet = null; editing = false; } });
    refreshList();
  };
  U.act.chatListEdit = () => { editing = !editing; U.haptic('select'); refreshList(); };
  U.act.chatOpen = (el) => {
    const S = U.S, id = el.dataset.arg;
    if (!CH() || !CH().get(S, id)) return;
    if (landed === id) landed = null;
    earlier = false;
    S.ai.chatId = id;
    U.save();
    U.haptic('select');
    if (listSheet) listSheet.close('ok');
    refreshChat('bottom');
  };
  // Deletes one, with Undo; an answer still coming in it stops.
  function deleteChat(id) {
    const S = U.S;
    if (busy() && live.chat === id) stopLive();
    const was = CH().remove(S, id);
    if (!was) return;
    if (landed === id) landed = null;
    U.save();
    refreshChat();
    U.haptic('remove');
    U.toast('Chat deleted', 'neutral', undefined, { label: 'Undo', onClick: () => { CH().restore(U.S, was); U.save(); refreshChat(); U.haptic('undo'); } });
  }
  U.act.chatDelete = (el) => deleteChat(el.dataset.arg);
  U.act.chatDeleteAll = async () => {
    if (!(await U.confirm('Delete all chats?', 'Every conversation with the coach goes from this phone. This can\'t be undone.', 'Delete all', 'critical', 'trash'))) return;
    if (busy()) stopLive();
    live = null;
    landed = null;
    editing = false;
    CH().clear(U.S);
    U.save(true);
    refreshChat('top');
    U.toast('All chats deleted', 'neutral');
  };

  /* ---------------------------------------------------------------- more */
  // The chat's options: a menu that grows out of its button (U.menu), in the chat's sheet.
  U.act.chatMenu = (el) => {
    const S = U.S;
    const cur = !!(CH() && CH().current(S));
    U.menu(el, [
      canHandOff() ? { act: 'chatMenuPick', arg: 'askClaudeApp', icon: 'share', label: 'Ask in the Claude app' } : false,
      { act: 'chatMenuPick', arg: 'chatSettings', icon: 'sliders', label: 'AI coach settings' },
      cur ? null : false,
      cur ? { act: 'chatMenuPick', arg: 'askClear', icon: 'trash', label: 'Delete this chat', tone: 'critical' } : false,
    ], { label: 'Chat options' });
  };
  // A pick: the menu closes itself (Refract), then the action runs.
  U.act.chatMenuPick = (el) => {
    const fn = U.act[el.dataset.arg];
    if (fn) setTimeout(() => fn(el), 60);
  };
  U.act.chatSettings = () => { U.closeSheets(); setTimeout(() => U.open('settings', 'coach'), 320); };
  U.act.askPreset = (el) => U.act.askCoach(el, null, el.dataset.arg);
  U.act.askQuick = (el) => { const q = document.getElementById('askQ'); if (q) q.value = el.dataset.arg; U.act.askSend(); };
  // Delete this chat (the open one).
  U.act.askClear = () => { const id = openId(U.S); if (id && CH().get(U.S, id)) deleteChat(id); };
  const msgAt = (el) => msgsOf(U.S)[Number(el.dataset.arg)];
  U.act.copyAnswer = (el) => {
    const m = msgAt(el);
    if (!m || !GH.platform) return;
    GH.platform.copy(GH.md ? GH.md.plain(m.text) : m.text);
    U.haptic('copy');
    U.toast('Copied');
  };
  // What the app worked out and handed the model for this answer (the model only worded it).
  U.act.answerFacts = (el) => {
    const m = msgAt(el);
    if (!m || !m.facts) return;
    U.sheet({
      title: 'What it used', size: 'auto',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">The app worked these out from your data. The model only put them in plain words.</p>
        <ul class="facts-list">${m.facts.map((f) => `<li class="t-callout">${U.esc(f)}</li>`).join('')}</ul></div>`,
    });
  };

  /* ---------------------------------------------------------------- asking */
  function stopLive() {
    if (!live || live.done) return;
    if (live.ctl) live.ctl.abort();
    if (live.engine === 'api' && AI()) AI().stop();
  }
  U.act.askStop = () => { stopLive(); U.haptic('pause'); };
  U.act.askRetry = () => {
    if (!live || !live.done || !live.q) return;
    const q = document.getElementById('askQ');
    if (q) q.value = live.q;
    live = null;
    U.act.askSend();
  };
  U.act.askSend = async () => {
    const S = U.S;
    const q = document.getElementById('askQ');
    if (!q) return;
    // One answer at a time: one still coming in another conversation finishes there first.
    if (busy()) { if (!liveHere(S)) U.toast('An answer is still on its way', 'neutral', 'It goes in its own chat. Ask again once it\'s in.'); return; }
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    grow(q);
    lastQuestion = text;
    const e = engineOf(S);
    // The open conversation, or a new one (kept once its first answer is in).
    const cid = CH() ? CH().target(S) : null;
    const id = ++seq;
    const ctl = new AbortController();
    live = { id, engine: e, chat: cid, q: text, text: '', status: 'thinking', fraction: null, error: null, note: null, done: false, ctl };
    const mine = () => live && live.id === id;
    U.haptic('send');
    refreshChat('bottom');
    const finish = (ok) => {
      if (!mine()) return;
      live.done = true;
      if (!(chat && !chat.closed) && ok) unseen = true;
      if (ok && openId(U.S) !== cid) landed = cid;
      if (ok) { live = null; U.haptic('success'); } else if (live.error) U.haptic('error');
      U.save(true);
      refreshChat();
      syncButtons();
    };
    if (e === 'device') {
      try {
        const res = await GH.deviceCoach.ask(S, U.today(), text, {
          chat: cid,
          signal: ctl.signal,
          onStatus: (st, f) => { if (!mine() || live.text) return; live.status = st; live.fraction = f == null ? null : f; paintLive(); },
          onToken: (piece, soFar) => { if (!mine()) return; live.text = soFar; live.status = 'writing'; paintLive(); },
        });
        if (!mine()) return;
        if (!res.text) { live.note = res.aborted ? 'Stopped.' : 'No answer came back. Try asking another way.'; finish(false); return; }
        finish(true);
      } catch (err) {
        if (!mine()) return;
        live.error = err.message || 'The on-device model couldn\'t answer that.';
        finish(false);
        if (err.code === 'not-installed' && U.checkDevice) U.checkDevice().then(() => refreshChat());
      }
      return;
    }
    try {
      await AI().ask(S, U.today(), text, (delta, snapshot) => { if (!mine()) return; live.text = snapshot; live.status = 'writing'; paintLive(); }, { chat: cid });
      finish(true);
    } catch (err) {
      if (!mine()) return;
      if (live.text) { live.note = 'Stopped.'; finish(false); return; }
      live.error = err.message || 'Something went wrong.';
      live.budget = !!(AI() && AI().isBudget(err.code));
      finish(false);
    }
  };
  let lastQuestion = '';

  /* ---------------------------------------------------------------- reporting AI answers */
  // Anything an AI wrote (an on-device or Claude answer, Claude's report or suggestions) can be
  // reported from where it's shown. It's hidden right away and kept in a local list; sending it to
  // the developer opens a GitHub issue with the answer and the reason, to read before posting. The
  // repository is public, so the sheet says the issue is too.
  const REPORT_URL = 'https://github.com/ShadowsDistant/gradient-health/issues/new';
  const REASONS = [['unsafe', 'Harmful or unsafe'], ['wrong', 'Wrong or misleading'], ['offensive', 'Offensive'], ['other', 'Something else']];
  U.flagSheet = (o) => {
    let reason = 'wrong';
    const ctl = U.sheet({
      title: 'Report this answer', size: 'auto',
      body: `<div class="sheet-pad">
        <p class="t-callout rf-muted">AI can get things wrong. Reporting hides this ${U.esc(o.what || 'answer')} and helps fix the coach.</p>
        <blockquote class="flag-quote t-footnote">${U.esc(String(o.text || '').slice(0, 400))}${String(o.text || '').length > 400 ? '…' : ''}</blockquote>
        <p class="t-headline">What's wrong with it?</p>
        ${U.choice('flagReason', REASONS, reason, 'What\'s wrong with it', ' class="ob-chips" data-on="flagReason"')}
        <div class="rf-field"><label class="rf-field-label" for="flagNote">Anything to add (optional)</label><div class="rf-field-control"><textarea class="rf-input" id="flagNote" rows="2" maxlength="500"></textarea></div></div>
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="flagSend">Report</button><button type="button" class="rf-btn" data-size="lg" data-act="flagHide">Just hide it</button></div>
        <p class="t-footnote rf-muted">Report also opens a GitHub issue with the answer and your reason. Issues are posted publicly on GitHub, so read it and take out anything personal before you post it. Nothing is sent until you do.</p>
      </div>`,
    });
    const record = (send) => {
      const S = U.S;
      const note = ((ctl.el.querySelector('#flagNote') || {}).value || '').trim().slice(0, 500);
      S.ai.flags = (S.ai.flags || []).concat([{ at: Date.now(), kind: o.kind, engine: o.engine, model: o.model || null, reason, note, text: String(o.text || '').slice(0, 2000) }]).slice(-50);
      if (o.onHide) o.onHide();
      U.save(true);
      ctl.close('ok');
      U.haptic('success');
      if (send && GH.platform) {
        const body = [`**What:** ${o.kind} from ${o.engine}${o.model ? ` (${o.model})` : ''}`, `**Reason:** ${(REASONS.find((r) => r[0] === reason) || [, reason])[1]}`, note ? `**Note:** ${note}` : '', '', '**The answer:**', '', String(o.text || '').slice(0, 1500), '', `_Gradient Health ${GH.VERSION || ''}_`].filter((x) => x !== null).join('\n');
        GH.platform.openUrl(`${REPORT_URL}?${new URLSearchParams({ title: `AI answer report: ${(REASONS.find((r) => r[0] === reason) || [, reason])[1].toLowerCase()}`, body, labels: 'ai-report' }).toString()}`);
      }
      U.toast('Reported', 'positive', send ? 'It\'s hidden on your phone. Once you post the issue, it\'s public on GitHub.' : 'It\'s hidden on your phone.');
    };
    U.on.flagReason = (el, ev, v) => { if (v) reason = v; };
    U.act.flagSend = () => record(true);
    U.act.flagHide = () => record(false);
    return ctl;
  };
  U.act.flagAnswer = (el) => {
    const S = U.S;
    const i = Number(el.dataset.arg);
    const log = msgsOf(S);
    const m = log[i];
    if (!m) return;
    const api = (m.engine || engineOf(S)) === 'api';
    const q = log[i - 1] && log[i - 1].role === 'user' ? log[i - 1].text : '';
    U.flagSheet({ kind: 'chat answer', what: 'answer', engine: api ? 'Claude' : 'the on-device model', model: api ? (m.model && GH.spend && GH.spend.byId(m.model) ? GH.spend.byId(m.model).name : AI().modelName(S)) : m.model || (GH.llm && GH.llm.loaded() ? GH.llm.loaded().id : S.ai.deviceModel), text: q ? `Q: ${q}\nA: ${m.text}` : m.text, onHide: () => { m.flagged = true; refreshChat(); } });
  };
  U.act.flagReport = () => {
    const S = U.S;
    const rep = AI() && AI().reportFor(S, U.today());
    if (!rep) return;
    const d = rep.data || {};
    const text = [d.headline].concat(d.wins || [], d.watch || [], d.focus || []).filter(Boolean).join('\n');
    U.flagSheet({ kind: 'weekly report', what: 'report', engine: 'Claude', model: rep.model, text, onHide: () => { rep.flagged = true; U.render(); } });
  };

  /* ---------------------------------------------------------------- Claude app hand-off */
  // Your question plus the privacy-safe summary go to the Claude app, which answers with your own
  // Claude plan. Nothing is sent until you press the button, and you can read it all first.
  U.act.askClaudeApp = () => {
    const S = U.S;
    const typed = ((document.getElementById('askQ') || {}).value || '').trim();
    const installed = GH.platform.claudeInstalled();
    const ctl = U.sheet({
      title: 'Ask in the Claude app', size: 'auto',
      body: `<div class="sheet-pad">
          <p class="t-callout rf-muted">Your question and a summary of your data (no name or dates) open in the Claude app, on your own Claude plan. Nothing is sent until you tap the button.</p>
          <div class="rf-field"><label class="rf-field-label" for="handQ">Your question</label><div class="rf-field-control"><textarea class="rf-input" id="handQ" rows="3" maxlength="1000" placeholder="What should I focus on this week?">${U.esc(typed || lastQuestion)}</textarea></div></div>
          ${installed ? '' : '<p class="t-footnote rf-muted">The Claude app isn\'t installed, so this opens the share sheet, where you can pick any app.</p>'}
          <button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="handOff">${U.icon(installed ? 'arrow-up-right' : 'share')}${installed ? 'Open in Claude' : 'Share'}</button>
          <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="handPreview" aria-expanded="false">Show what gets sent</button>
        </div>
        <pre class="preview" id="handPrev" hidden></pre>`,
    });
    U.act.handPreview = (b) => {
      const pre = ctl.el.querySelector('#handPrev');
      const open = pre.hidden;
      pre.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Hide it' : 'Show what gets sent';
      if (open) pre.textContent = GH.coach.claudePrompt(U.S, U.today(), (ctl.el.querySelector('#handQ') || {}).value);
    };
    U.act.handOff = () => {
      const q = (ctl.el.querySelector('#handQ') || {}).value || '';
      const ok = GH.platform.share(GH.coach.claudePrompt(U.S, U.today(), q), 'claude');
      if (!ok) { U.toast('Couldn\'t open another app', 'caution'); return; }
      U.haptic('send');
      ctl.close('ok');
    };
    return ctl;
  };
})(typeof window !== 'undefined' ? window : globalThis);
