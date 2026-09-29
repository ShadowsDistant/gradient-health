/* The coach chat: ask the on-device model (runs on the phone, grounded in what the built-in coach
 * works out) or Claude (your own API key), report an answer, or hand the question to the Claude app.
 * Opened with U.act.askCoach from anywhere in the app.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {};
  const AI = () => GH.ai;
  const ai = { busy: false }; // a Claude answer in progress
  const canHandOff = () => !!(GH.platform && (GH.platform.isApp() || (G.navigator && G.navigator.share)));
  U.canHandOff = canHandOff;

  /* ---------------------------------------------------------------- chat */
  // Two ways to get an answer, picked at the top of the chat: the on-device model (runs on the phone,
  // nothing leaves it, grounded in what the built-in coach works out) or Claude (your own API key;
  // streams in). "Ask in the Claude app" hands the question to the Claude app.
  let chat = null;
  let stopper = null; // the on-device answer in progress, so Stop can end it
  const PRESETS = ['Why is today lighter?', 'How is my sleep?', 'Am I getting stronger?', 'How is my weight trending?', 'What should I focus on?'];
  const ENGINES = [['device', 'On-device'], ['api', 'Claude']];
  const engineOf = (S) => (S.ai.mode === 'api' ? 'api' : 'device');
  const chatLog = (S) => (engineOf(S) === 'api' ? (S.ai.chat || []) : (S.ai.deviceChat || []));
  // What the on-device model needs before it can answer, or null when it's ready.
  function deviceGate() {
    const d = U.deviceState ? U.deviceState() : null;
    if (!d || !d.checked) return `<div class="chat-setup"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout rf-muted">Checking the on-device model…</span></div>`;
    if (!d.available.ok) return `<div class="chat-setup card"><p class="t-callout">${U.esc(d.available.reason)}</p><p class="t-footnote rf-muted">Claude still works with your own API key, and so does asking in the Claude app.</p></div>`;
    if (!d.installed.length) return `<div class="chat-setup card"><span class="chat-setup-ico" aria-hidden="true">${U.icon('chip')}</span><p class="t-headline">Get the on-device coach</p><p class="t-callout rf-muted">A small AI model that runs on your phone. Your questions and data never leave it, and it works offline. Pick a size once; you can change it later in Settings.</p>${U.modelRows ? `<ul class="rf-list">${U.modelRows(U.S, { compact: true })}</ul>` : ''}</div>`;
    return null;
  }
  function logBody(S) {
    const e = engineOf(S);
    if (e === 'api' && !(AI() && AI().hasKey())) return `<div class="chat-setup card"><p class="t-headline">Add your API key</p><p class="t-callout rf-muted">Claude answers with your own Anthropic API key, which stays on this phone.</p><button type="button" class="rf-btn" data-variant="filled" data-act="keySheet">Add a key</button></div>`;
    if (e === 'api' && !S.ai.consentAt) return `<div class="chat-setup card"><p class="t-headline">Claude needs your OK</p><p class="t-callout rf-muted">It gets a summary of your data with each question. See what's in it before you decide.</p><button type="button" class="rf-btn" data-variant="filled" data-act="chatConsent">Review</button></div>`;
    if (e === 'device') { const gate = deviceGate(); if (gate) return gate; }
    const all = chatLog(S);
    const start = Math.max(0, all.length - 12);
    const msgs = all.slice(start);
    if (!msgs.length) {
      const hint = e === 'api' ? 'Ask about your sleep, steps, training or what to focus on. Claude sees the same summary as the weekly report.'
        : 'Ask anything about your sleep, steps, training, weight or food. The model runs on your phone and answers from your own numbers.';
      return `<p class="t-callout rf-muted chat-empty">${hint}</p>
        <div class="ob-chips chat-presets">${PRESETS.map((q) => `<button type="button" class="rf-chip" data-act="askQuick" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>`;
    }
    // AI answers can be reported; a reported one stays hidden. Safety answers are the app's own.
    return msgs.map((m, i) => {
      if (m.role === 'user') return `<div class="bubble me">${U.esc(m.text)}</div>`;
      if (m.flagged) return '<div class="bubble coach is-flagged">You reported this answer, so it\'s hidden.</div>';
      return `<div class="bubble coach">${U.esc(m.text)}${!m.safety ? flagBtn(start + i) : ''}</div>`;
    }).join('');
  }
  const flagBtn = (i) => `<button type="button" class="bubble-flag" data-act="flagAnswer" data-arg="${i}" aria-label="Report this answer">${U.icon('flag', 'sm')}Report</button>`;

  /* ---------------------------------------------------------------- reporting AI answers */
  // Anything an AI wrote (an on-device or Claude answer, Claude's report or suggestions) can be
  // reported from where it's shown. It's hidden right away and kept in a local list; sending it to
  // the developer opens a GitHub issue with the answer and the reason, to read before posting.
  const REPORT_URL = 'https://github.com/ShadowsDistant/gradient-health/issues/new';
  const REASONS = [['unsafe', 'Harmful or unsafe'], ['wrong', 'Wrong or misleading'], ['offensive', 'Offensive'], ['other', 'Something else']];
  U.flagSheet = (o) => {
    let reason = 'wrong';
    const ctl = U.sheet({
      title: 'Report this answer', detents: 'large', detent: 'large',
      body: `<div class="sheet-pad">
        <p class="t-callout rf-muted">AI can get things wrong. Reporting hides this ${U.esc(o.what || 'answer')} on your phone and helps fix the coach.</p>
        <blockquote class="flag-quote t-footnote">${U.esc(String(o.text || '').slice(0, 400))}${String(o.text || '').length > 400 ? '…' : ''}</blockquote>
        <p class="t-headline">What's wrong with it?</p>
        <div class="ob-chips" data-on="flagReason">${REASONS.map(([v, t]) => `<button type="button" class="rf-chip" aria-pressed="${v === reason}" data-act="flagReason" data-arg="${v}">${U.esc(t)}</button>`).join('')}</div>
        <div class="rf-field"><label class="rf-field-label" for="flagNote">Anything to add (optional)</label><div class="rf-field-control"><textarea class="rf-input" id="flagNote" rows="2" maxlength="500"></textarea></div></div>
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="flagSend">Report</button><button type="button" class="rf-btn" data-size="lg" data-act="flagHide">Just hide it</button></div>
        <p class="t-footnote rf-muted">Report hides it and opens a GitHub issue for the developer with the answer and your reason. You can read and edit it before posting, and nothing is sent until you do.</p>
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
      U.toast('Reported', 'positive', send ? 'It\'s hidden on your phone. Post the issue to send it to the developer.' : 'It\'s hidden on your phone.');
    };
    U.act.flagReason = (el) => { reason = el.dataset.arg; for (const c of ctl.el.querySelectorAll('[data-act="flagReason"]')) c.setAttribute('aria-pressed', String(c.dataset.arg === reason)); U.haptic('select'); };
    U.act.flagSend = () => record(true);
    U.act.flagHide = () => record(false);
    return ctl;
  };
  U.act.flagAnswer = (el) => {
    const S = U.S;
    const i = Number(el.dataset.arg);
    const log = chatLog(S);
    const m = log[i];
    if (!m) return;
    const e = engineOf(S);
    const q = log[i - 1] && log[i - 1].role === 'user' ? log[i - 1].text : '';
    U.flagSheet({ kind: 'chat answer', what: 'answer', engine: e === 'api' ? 'Claude' : 'the on-device model', model: e === 'api' ? S.ai.model && S.ai.model.name : m.model || (GH.llm && GH.llm.loaded() ? GH.llm.loaded().id : S.ai.deviceModel), text: q ? `Q: ${q}\nA: ${m.text}` : m.text, onHide: () => { m.flagged = true; refreshChat(); } });
  };
  U.act.flagReport = () => {
    const S = U.S;
    const rep = AI() && AI().reportFor(S, U.today());
    if (!rep) return;
    const d = rep.data || {};
    const text = [d.headline].concat(d.wins || [], d.watch || [], d.focus || []).filter(Boolean).join('\n');
    U.flagSheet({ kind: 'weekly report', what: 'report', engine: 'Claude', model: rep.model, text, onHide: () => { rep.flagged = true; U.render(); } });
  };
  const FOOT = {
    device: 'Runs on your phone and can be wrong.',
    api: 'Claude sees a summary without your name, not your raw data.',
  };
  function chatBody(S) {
    const e = engineOf(S);
    const ready = !(e === 'api' && !(AI() && AI().hasKey() && S.ai.consentAt)) && !(e === 'device' && deviceGate());
    return `<div class="chat-engine">${U.seg('chatEngine', ENGINES, e, 'Who answers', ' data-on="setChatEngine" data-size="sm"')}</div>
      <div class="chat-log" id="chatLog">${logBody(S)}</div>
      <div class="chat-compose"${ready ? '' : ' hidden'}><textarea class="rf-input" id="askQ" rows="2" maxlength="600" placeholder="Ask a question" aria-label="Your question"></textarea>
        ${stopper ? `<button type="button" class="rf-btn rf-glass" data-shape="circle" aria-label="Stop" data-act="askStop">${U.icon('stop')}</button>` : `<button type="button" class="rf-btn rf-glass" data-variant="tinted" data-shape="circle" aria-label="Send" data-act="askSend">${U.icon('send')}</button>`}</div>
      <p class="t-footnote rf-muted chat-foot">${FOOT[e]} Not medical advice.</p>
      <div class="btn-row chat-btns">${canHandOff() ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="askClaudeApp">${U.icon('share')}Ask in the Claude app</button>` : ''}${chatLog(S).length ? '<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="askClear">Clear chat</button>' : ''}</div>`;
  }
  // Redraws the chat sheet (keeps what's typed and scrolls to the newest answer).
  function refreshChat() {
    if (!chat || chat.closed) return;
    const q = chat.el.querySelector('#askQ');
    const typed = q ? q.value : '';
    chat.update(chatBody(U.S));
    const q2 = chat.el.querySelector('#askQ');
    if (q2 && typed) q2.value = typed;
    const log = chat.el.querySelector('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }
  U.refreshChat = refreshChat;
  U.act.askCoach = (el, ev, preset) => {
    const S = U.S;
    chat = U.sheet({
      title: 'Ask the coach', detents: 'large', detent: 'large', cls: 'chat-sheet',
      body: chatBody(S),
      onClose: () => { if (AI()) AI().stop(); if (stopper) stopper.abort(); stopper = null; chat = null; },
      after: (c) => { const log = c.el.querySelector('#chatLog'); if (log) log.scrollTop = log.scrollHeight; },
    });
    // A suggested question goes in once the sheet is up and, for the on-device coach, once it's
    // known whether the model is there (the box to type in waits for that).
    const me = chat;
    const send = () => {
      if (!preset || chat !== me || !chat) return;
      const q = chat.el.querySelector('#askQ');
      const b = chat.el.querySelector('[data-act="askSend"]');
      const box = chat.el.querySelector('.chat-compose');
      if (q && !q.value) q.value = preset;
      if (b && box && !box.hidden) U.act.askSend(b);
    };
    if (preset) { const q = chat.el.querySelector('#askQ'); if (q) q.value = preset; }
    const wait = new Promise((r) => setTimeout(r, 380));
    if (engineOf(S) === 'device' && U.checkDevice) {
      U.checkDevice().then(() => {
        if (chat !== me) return;
        refreshChat();
        if (!deviceGate() && GH.deviceCoach && !preset) GH.deviceCoach.prime(U.S, U.today());
        return wait.then(send);
      });
    } else if (preset) wait.then(send);
  };
  U.on.setChatEngine = async (el, ev, v) => {
    const S = U.S;
    if (stopper) { stopper.abort(); stopper = null; }
    // Claude with a key: only after the person has allowed it to get their data.
    if (v === 'api' && AI() && AI().hasKey() && !S.ai.consentAt && !(await U.claudeConsent())) { refreshChat(); return; }
    S.ai.mode = v === 'api' ? 'api' : 'device';
    S.ai.enabled = S.ai.mode === 'api';
    U.save();
    refreshChat();
    if (S.ai.mode === 'device' && U.checkDevice) U.checkDevice().then(() => { refreshChat(); if (!deviceGate() && GH.deviceCoach) GH.deviceCoach.prime(U.S, U.today()); });
    if (U.route.view === 'settings' || U.route.tab === 'health') setTimeout(() => U.render(), 60);
  };
  U.act.chatConsent = async () => { if (await U.claudeConsent()) { U.S.ai.enabled = true; U.save(true); } refreshChat(); };
  U.act.askPreset = (el) => U.act.askCoach(el, null, el.dataset.arg);
  U.act.askQuick = (el) => { const q = document.getElementById('askQ'); if (q) q.value = el.dataset.arg; U.act.askSend(document.querySelector('.chat-sheet [data-act="askSend"]')); };
  U.act.askClear = () => {
    const S = U.S;
    const e = engineOf(S);
    if (e === 'api') { if (AI()) AI().clearChat(S); } else if (GH.deviceCoach) GH.deviceCoach.clear(S);
    U.save();
    refreshChat();
  };
  U.act.askStop = () => { if (stopper) stopper.abort(); };
  function addBubble(log, cls, text) {
    const empty = log.querySelectorAll('.chat-empty, .chat-presets'); for (const e of empty) e.remove();
    const b = document.createElement('div');
    b.className = `bubble ${cls}`;
    if (text != null) b.textContent = text;
    log.appendChild(b);
    if (!U.reduced() && b.animate) b.animate([{ opacity: 0, transform: `translateY(8px) scale(.96)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' });
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function setBusyButton(on) {
    const box = chat && chat.el.querySelector('.chat-compose');
    if (!box) return;
    const btn = box.querySelector('[data-act="askSend"], [data-act="askStop"]');
    if (!btn) return;
    if (on) { btn.setAttribute('data-act', 'askStop'); btn.setAttribute('aria-label', 'Stop'); btn.removeAttribute('data-variant'); btn.innerHTML = U.icon('stop'); }
    else { btn.setAttribute('data-act', 'askSend'); btn.setAttribute('aria-label', 'Send'); btn.setAttribute('data-variant', 'tinted'); btn.innerHTML = U.icon('send'); }
  }
  U.act.askSend = async (btn) => {
    const S = U.S;
    const q = document.getElementById('askQ');
    const log = document.getElementById('chatLog');
    if (!q || !log || ai.busy || stopper) return;
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    lastQuestion = text;
    addBubble(log, 'me', text);
    U.haptic('tap');
    const e = engineOf(S);
    const out = addBubble(log, 'coach is-typing');
    out.innerHTML = '<span class="rf-spinner" data-size="sm"><i></i></span>';
    const status = document.createElement('span');
    status.className = 't-footnote rf-muted bubble-status';
    if (e === 'device') {
      const ctl = new AbortController();
      stopper = ctl;
      setBusyButton(true);
      let shown = false;
      try {
        const res = await GH.deviceCoach.ask(S, U.today(), text, {
          signal: ctl.signal,
          onStatus: (st, f) => {
            if (shown) return;
            status.textContent = st === 'loading' ? `Starting the model${f ? ` ${Math.round(f * 100)}%` : '…'}` : 'Thinking…';
            if (!status.parentNode) out.appendChild(status);
          },
          onToken: (piece, soFar) => { shown = true; out.classList.remove('is-typing'); out.textContent = soFar; log.scrollTop = log.scrollHeight; },
        });
        out.classList.remove('is-typing');
        if (!res.text) out.textContent = res.aborted ? 'Stopped.' : 'No answer came back. Try asking another way.';
        else out.textContent = res.text;
        if (res.aborted && res.text) out.classList.add('is-stopped');
        if (res.text && !res.safety) out.insertAdjacentHTML('beforeend', flagBtn((S.ai.deviceChat || []).length - 1));
        U.save(true);
      } catch (err) {
        out.classList.remove('is-typing');
        out.classList.add('is-error');
        out.textContent = err.message || 'The on-device model couldn\'t answer that.';
        U.haptic('error');
        if (err.code === 'not-installed' && U.checkDevice) U.checkDevice().then(refreshChat);
      } finally {
        stopper = null;
        setBusyButton(false);
      }
      return;
    }
    if (btn) btn.setAttribute('aria-busy', 'true');
    ai.busy = 'chat';
    try {
      await AI().ask(S, U.today(), text, (delta, snapshot) => { out.classList.remove('is-typing'); out.textContent = snapshot; log.scrollTop = log.scrollHeight; });
      out.classList.remove('is-typing');
      out.insertAdjacentHTML('beforeend', flagBtn((S.ai.chat || []).length - 1));
      U.save(true);
    } catch (err) {
      out.classList.remove('is-typing');
      out.classList.add('is-error');
      out.textContent = err.message || 'Something went wrong.';
      U.haptic('error');
    } finally {
      ai.busy = false;
      if (btn) btn.removeAttribute('aria-busy');
    }
  };
  let lastQuestion = '';

  /* ---------------------------------------------------------------- Claude app hand-off */
  // Your question plus the privacy-safe summary go to the Claude app, which answers with your own
  // Claude plan. Nothing is sent until you press the button, and you can read it all first.
  U.act.askClaudeApp = () => {
    const S = U.S;
    const typed = ((document.getElementById('askQ') || {}).value || '').trim();
    const installed = GH.platform.claudeInstalled();
    const ctl = U.sheet({
      title: 'Ask in the Claude app', detents: 'large', detent: 'large',
      body: `<div class="sheet-pad">
          <p class="t-callout rf-muted">Your question and a summary of your data (no name or dates) open in the Claude app, where your own Claude plan answers it. Nothing is sent until you press the button.</p>
          <div class="rf-field"><label class="rf-field-label" for="handQ">Your question</label><div class="rf-field-control"><textarea class="rf-input" id="handQ" rows="3" maxlength="1000" placeholder="What should I focus on this week?">${U.esc(typed || lastQuestion)}</textarea></div></div>
          ${installed ? '' : '<p class="t-footnote rf-muted">The Claude app isn\'t installed, so this opens the share sheet. You can pick Claude there after installing it, or any other app.</p>'}
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
      U.haptic('go');
      ctl.close('ok');
    };
    return ctl;
  };
})(typeof window !== 'undefined' ? window : globalThis);
