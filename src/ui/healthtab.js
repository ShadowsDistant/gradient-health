/* Health: the coach's weekly report and insights, today's numbers, trends,
 * recent activity, hand logs and where the data comes from.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const AI = () => GH.ai;

  let range = 28;
  const ai = { busy: false, error: null, tried: null };
  const TONE_TILE = { good: 'green', watch: 'amber', info: 'sky', alert: 'rose' };

  /* ---------------------------------------------------------------- insights + AI */
  function insightCard(x) {
    const [tone, ic, word] = U.toneWord[x.tone] || U.toneWord.info;
    return `<div class="card insight" data-tone="${x.tone}" data-key="ins-${U.esc(x.id)}">
      <div class="ins-head"><span class="rf-list-icon" data-tone="${TONE_TILE[x.tone] || 'sky'}">${U.icon(x.icon)}</span><span class="ins-word t-caption" data-tone="${tone}">${U.icon(ic, 'sm')}${word}</span>
        <button type="button" class="rf-btn ins-x" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Dismiss for 30 days" data-act="dismissInsight" data-arg="${U.esc(x.id)}">${U.icon('close')}</button></div>
      <p class="t-headline">${U.esc(x.title)}</p>
      <p class="t-callout">${U.esc(x.body)}</p>
      <p class="t-footnote rf-muted">Based on ${U.esc(x.evidence)}</p>
      ${x.action ? `<button type="button" class="rf-btn" data-size="sm" data-act="insightGo" data-arg="${U.esc(x.action.route)}">${U.esc(x.action.label)}</button>` : ''}
    </div>`;
  }
  // The weekly report: from Claude when that's set up, otherwise from the built-in coach.
  function reportBody(d) {
    const list = (title, arr, tone) => (arr && arr.length ? `<p class="t-subhead ai-sub" data-tone="${tone}">${title}</p><ul class="plain-list">${arr.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '');
    return `<p class="t-headline">${U.esc(d.headline)}</p>
      ${list('Wins', d.wins, 'positive')}${list('Keep an eye on', d.watch, 'caution')}${list('Focus next', d.focus, 'accent')}
      ${d.ask_me && d.ask_me.length ? `<div class="ob-chips ai-asks">${d.ask_me.map((q) => `<button type="button" class="rf-chip" data-act="askPreset" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>` : ''}`;
  }
  const claudeMode = (S) => S.ai.mode === 'api';
  function aiCard(S, day) {
    if (!S.log.some((l) => l.type === 'workout') && Object.keys(S.health.days || {}).length < 3) return '';
    const api = claudeMode(S) && AI() && AI().hasKey();
    let body, badge, meta = '';
    const rep0 = api ? AI().reportFor(S, day) : null;
    const rep = rep0 && !rep0.flagged ? rep0 : null; // a reported one falls back to the built-in report
    if (api && ai.busy === 'report') {
      body = '<div class="ai-busy"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout rf-muted">Writing this week\'s report…</span></div>';
      badge = U.badge('Claude', 'accent');
    } else if (api && rep) {
      body = reportBody(rep.data);
      badge = U.badge('Claude', 'accent');
      meta = `Written ${U.esc(U.fmtDay(rep.day))}${rep.model ? ` by ${U.esc(rep.model)}` : ''}. Not medical advice.`;
    } else {
      body = reportBody(GH.coach.report(S, day));
      badge = U.badge('Built-in', 'neutral');
      meta = api ? 'Claude hasn\'t written this week\'s report yet, so this is the built-in one.' : 'From the built-in coach, worked out on this phone. Not medical advice.';
    }
    const err = ai.error && api ? `<div class="notice" data-tone="critical">${U.icon('alert')}<span>${U.esc(ai.error)}</span></div>` : '';
    const waiting = api && !S.ai.consentAt ? `<div class="notice" data-tone="info">${U.icon('info')}<span>Claude is waiting for your OK before it gets your data. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="claudeReview">Review</button></span></div>` : '';
    const byClaude = api && rep && ai.busy !== 'report';
    return `<div class="card ai-card" data-key="coach">
      <div class="ai-head">${U.icon('sparkle')}<span class="t-headline">Weekly report</span>${badge}<span class="rf-spacer"></span>
        ${api && S.ai.consentAt ? `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="aiReport"${ai.busy ? ' aria-disabled="true"' : ''}>${rep ? 'Refresh' : 'Write it'}</button>` : ''}</div>
      ${body}${err}${waiting}
      <p class="t-footnote rf-muted">${meta}${byClaude ? ` <button type="button" class="rf-btn ai-flag" data-variant="plain" data-size="sm" data-act="flagReport">${U.icon('flag', 'sm')}Report</button>` : ''}</p>
      <div class="btn-row"><button type="button" class="rf-btn" data-variant="soft" data-act="askCoach">${U.icon('chat')}Ask a question</button>
        ${canHandOff() ? `<button type="button" class="rf-btn" data-variant="plain" data-act="askClaudeApp">${U.icon('share')}Ask in the Claude app</button>` : ''}</div>
    </div>`;
  }
  const canHandOff = () => !!(GH.platform && (GH.platform.isApp() || (G.navigator && G.navigator.share)));
  async function writeReport(auto) {
    const S = U.S, day = U.today();
    if (ai.busy || !AI() || !AI().hasKey() || !claudeMode(S)) return;
    // The automatic weekly report only runs once the person has allowed Claude; asking by hand
    // shows the consent screen first.
    if (!S.ai.consentAt && (auto || !(await U.claudeConsent()))) return;
    ai.busy = 'report'; ai.error = null; ai.tried = day;
    if (U.route.tab === 'health' && !U.route.view) U.render();
    try {
      await AI().report(S, day);
      U.save(true);
    } catch (e) {
      ai.error = e.message || 'The coach couldn\'t write the report.';
      if (auto && e.code === 'offline') ai.error = null;
    } finally {
      ai.busy = false;
      if (U.route.tab === 'health' && !U.route.view) U.render();
    }
  }
  U.act.aiReport = () => writeReport(false);
  U.act.openCoachSettings = () => U.open('settings', 'coach');
  U.act.whyNoData = () => U.sheet({ title: 'Missing numbers', body: `<div class="sheet-prose">
      <p class="t-body">Gradient Health can only show what your watch or phone app shares with Health Connect.</p>
      <p class="t-body">Some apps don't share resting heart rate or HRV at all. Samsung Health and Garmin Connect are two of them right now, even though they show those numbers in their own app.</p>
      <p class="t-body">If your app shares heart rate while you sleep, Gradient Health works out an estimated resting heart rate from it. HRV can't be worked out from heart rate, so that tile stays empty.</p>
      <p class="t-body">To check what's shared, open Health Connect, then App permissions, pick your watch app and make sure it's allowed to write the data you want.</p>
      <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-act="hcManage">Open Health Connect</button>
    </div>` });
  U.act.whyEstimate = () => U.sheet({ title: 'Estimated resting heart rate', body: `<div class="sheet-prose">
      <p class="t-body">Your watch app shares heart rate with Health Connect but not a resting value, so Gradient Health works one out.</p>
      <p class="t-body">It averages your heart rate over each half hour and takes the lowest half hour of the day. For people who wear their watch in bed, that's deep sleep, which is close to what watches call resting heart rate.</p>
      <p class="t-body">A day whose lowest half hour isn't at night is skipped, because it usually means the watch was off overnight.</p>
      <p class="t-body">Use it to compare your own days with each other. It can sit a few beats off your watch app's number.</p>
    </div>` });
  U.act.dismissInsight = (el) => { GH.insights.dismiss(U.S, el.dataset.arg, U.today()); U.commit(); U.toast('Hidden for 30 days', 'neutral'); };
  U.act.insightGo = (el) => U.go(el.dataset.arg);

  /* ---------------------------------------------------------------- chat */
  // Three ways to get an answer, picked at the top of the chat: the built-in coach (instant, from
  // your numbers, no AI model), the on-device model (runs on the phone, nothing leaves it) or Claude
  // (your own API key; streams in). "Ask in the Claude app" hands the question to the Claude app.
  let chat = null;
  let stopper = null; // the on-device answer in progress, so Stop can end it
  const PRESETS = ['Why is today lighter?', 'How is my sleep?', 'Am I getting stronger?', 'How is my weight trending?', 'What should I focus on?'];
  const ENGINES = [['local', 'Built-in'], ['device', 'On-device'], ['api', 'Claude']];
  const engineOf = (S) => (S.ai.mode === 'api' || S.ai.mode === 'device' ? S.ai.mode : 'local');
  function chatLog(S) {
    const e = engineOf(S);
    return e === 'api' ? (S.ai.chat || []) : e === 'device' ? (S.ai.deviceChat || []) : (S.coachChat || []);
  }
  // What the on-device model needs before it can answer, or null when it's ready.
  function deviceGate() {
    const d = U.deviceState ? U.deviceState() : null;
    if (!d || !d.checked) return `<div class="chat-setup"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout rf-muted">Checking the on-device model…</span></div>`;
    if (!d.available.ok) return `<div class="chat-setup card"><p class="t-callout">${U.esc(d.available.reason)}</p><p class="t-footnote rf-muted">The built-in coach and Claude still work.</p></div>`;
    if (!d.installed.length) return `<div class="chat-setup card"><p class="t-headline">Download the on-device model</p><p class="t-callout rf-muted">It runs on your phone, so your questions and data never leave it, and it works offline. It's a one-time download.</p>${U.modelRows ? U.modelRows(U.S) : ''}</div>`;
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
        : e === 'device' ? 'Ask anything about your sleep, steps, training, weight or food. The model runs on your phone and sees a short summary of your numbers.'
          : 'Ask about your sleep, steps, weight, protein, training or recovery. Answers come from your own numbers, worked out on this phone.';
      return `<p class="t-callout rf-muted chat-empty">${hint}</p>
        <div class="ob-chips chat-presets">${PRESETS.map((q) => `<button type="button" class="rf-chip" data-act="askQuick" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>`;
    }
    // AI answers (on-device and Claude) can be reported; a reported one stays hidden.
    const byAi = e !== 'local';
    return msgs.map((m, i) => {
      if (m.role === 'user') return `<div class="bubble me">${U.esc(m.text)}</div>`;
      if (m.flagged) return '<div class="bubble coach is-flagged">You reported this answer, so it\'s hidden.</div>';
      return `<div class="bubble coach">${U.esc(m.text)}${byAi && !m.safety ? flagBtn(start + i) : ''}</div>`;
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
    U.flagSheet({ kind: 'chat answer', what: 'answer', engine: e === 'api' ? 'Claude' : 'the on-device model', model: e === 'api' ? S.ai.model && S.ai.model.name : GH.llm && GH.llm.loaded() ? GH.llm.loaded().id : S.ai.deviceModel, text: q ? `Q: ${q}\nA: ${m.text}` : m.text, onHide: () => { m.flagged = true; refreshChat(); } });
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
    local: 'The built-in coach isn\'t an AI model: it answers common questions from your data.',
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
    if (engineOf(S) === 'device' && U.checkDevice) U.checkDevice().then(() => { refreshChat(); if (!deviceGate() && GH.deviceCoach) GH.deviceCoach.prime(U.S, U.today()); });
    if (preset) {
      const q = chat.el.querySelector('#askQ');
      if (q) q.value = preset;
      setTimeout(() => { const b = chat && chat.el.querySelector('[data-act="askSend"]'); if (b && !chat.el.querySelector('.chat-compose').hidden) U.act.askSend(b); }, 380);
    }
  };
  U.on.setChatEngine = async (el, ev, v) => {
    const S = U.S;
    if (stopper) { stopper.abort(); stopper = null; }
    // Claude with a key: only after the person has allowed it to get their data.
    if (v === 'api' && AI() && AI().hasKey() && !S.ai.consentAt && !(await U.claudeConsent())) { refreshChat(); return; }
    S.ai.mode = v === 'api' || v === 'device' ? v : 'local';
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
    if (e === 'api' && AI()) AI().clearChat(S); else if (e === 'device') { if (GH.deviceCoach) GH.deviceCoach.clear(S); } else S.coachChat = [];
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
    if (e === 'local') {
      const res = GH.coach.ask(S, U.today(), text);
      S.coachChat = (S.coachChat || []).concat([{ role: 'user', text }, { role: 'coach', text: res.text }]).slice(-24);
      U.save();
      setTimeout(() => addBubble(log, 'coach', res.text), 220);
      return;
    }
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

  /* ---------------------------------------------------------------- today's numbers */
  function tile(icon, tone, label, value, sub, act) {
    return `<${act ? `button type="button" data-act="${act}"` : 'div'} class="stat"><span class="stat-top"><span class="rf-list-icon" data-tone="${tone}">${U.icon(icon)}</span><span class="t-footnote rf-muted">${U.esc(label)}</span></span><span class="t-title-3 rf-num">${value}</span><span class="t-caption rf-muted">${sub || '&nbsp;'}</span></${act ? 'button' : 'div'}>`;
  }
  // Calories eaten with calorie tracking on, the protein count with protein only, nothing when off.
  function foodTile(S, day, t) {
    const F = GH.food;
    if (F && F.full(S)) {
      const tot = F.totals(S, day);
      const tg = F.targets(S, day);
      return tile('food', 'green', 'Eaten', tg ? `${U.num(tot.kcal)} <small>of ${U.num(tg.kcal)}</small>` : `${U.num(tot.kcal)} <small>kcal</small>`, `protein ${Math.round(tot.p)} g`, 'goFood');
    }
    if (S.profile.protein.track === false || (F && F.mode(S) === 'off')) return '';
    return tile('check-circle', 'green', 'Protein', t.proteinGoal ? `${t.protein} <small>of ${t.proteinGoal} g</small>` : `${t.protein} <small>g</small>`, 'today');
  }
  function todayGrid(S, day) {
    const t = H().today(S, day);
    const base = (k) => H().baseline(S, k, day);
    const br = base('rhr'), bh = base('hrv'), bs = base('steps');
    const f = t.feel || {};
    // Latest reading with how old it is, instead of a blank tile when today's isn't in yet.
    const ago = (x, night) => (!x ? '' : x.day === day ? (night ? 'last night' : 'today') : x.day === day - 1 ? (night ? 'the night before' : 'yesterday') : `${day - x.day} days ago`);
    const join = (...parts) => parts.filter(Boolean).join(' · ') || '&nbsp;';
    const sl = t.sleepLast, rh = t.rhrLast, hv = t.hrvLast;
    const slSub = !sl ? 'tap to log' : sl.day === day && t.bed ? `asleep ${U.fmtClock(t.bed)}` : sl.day === day && t.sleepFromChip ? 'from your check-in' : ago(sl, true);
    return `<div class="stat-grid">
      ${tile('moon', 'indigo', 'Sleep', sl ? U.esc(U.fmtMin(sl.value)) : '–', slSub, !sl ? 'logSleep' : null)}
      ${tile('navigate', 'green', 'Steps', t.steps != null ? U.num(t.steps) : '–', t.steps != null ? `goal ${U.num(B().stepsGoal(S, day).goal)}` : H().connected(H().status()) ? 'none synced yet today' : 'needs Health Connect')}
      ${tile('heart', 'rose', 'Resting HR', rh ? `${Math.round(rh.value)} <small>bpm</small>` : '–', rh ? join(rh.day !== day ? ago(rh) : '', t.rhrEstimated ? 'estimated' : '', br.n >= 5 ? `usual ${Math.round(br.avg)}` : '') : 'not shared by your watch app', rh ? (t.rhrEstimated ? 'whyEstimate' : null) : 'whyNoData')}
      ${tile('wave', 'violet', 'HRV', hv ? `${Math.round(hv.value)} <small>ms</small>` : '–', hv ? join(hv.day !== day ? ago(hv) : '', bh.n >= 5 ? `usual ${Math.round(bh.avg)}` : '') : 'not shared by your watch app', hv ? null : 'whyNoData')}
      ${tile('chart', 'teal', 'Weight', t.weightAvg7 != null ? U.esc(U.fmtW(t.weightAvg7)) : '–', t.weightAvg7 != null ? '7-day average' : 'tap to log', t.weightAvg7 == null ? 'logWeight' : null)}
      ${tile('bolt', 'amber', 'Active', `${t.activeMin} <small>min</small>`, 'today')}
      ${t.activeKcal != null ? tile('flame', 'coral', 'Active calories', `${U.num(t.activeKcal)} <small>kcal</small>`, 'today') : ''}
      ${t.distanceM != null ? tile('pin', 'sky', 'Distance', U.lb() ? `${U.num(t.distanceM / 1609.34, 1)} <small>mi</small>` : `${U.num(t.distanceM / 1000, 1)} <small>km</small>`, 'today') : ''}
      ${foodTile(S, day, t)}
      ${tile('sparkle', 'sky', 'Feel', f.energy ? U.esc(`${U.cap(f.energy)} energy`) : '–', f.sore ? U.esc(`${f.sore} soreness`) : 'tap to check in', 'logFeel')}
    </div>`;
  }

  /* ---------------------------------------------------------------- trends */
  function charts(S, day) {
    const from = day - range + 1;
    const hrs = (m) => `${(m / 60).toFixed(1)} h`;
    const out = [];
    const steps = H().series(S, 'steps', from - 6, day);
    const inRange = (pts) => pts.filter((p) => p.day >= from);
    const avg = (pts) => (pts.length ? pts.reduce((a, p) => a + p.value, 0) / pts.length : null);
    out.push(U.chartCard({ title: 'Steps', value: steps.length ? `${U.num(avg(inRange(steps)))} a day` : '', fmt: (v) => U.num(v), from, to: day, zero: true,
      series: [{ name: 'Steps', kind: 'bar', color: 'var(--hue-green)', points: inRange(steps) }, { name: '7-day average', kind: 'avg', color: 'var(--label)', points: U.rolling(steps, from, day, 7) }] }));
    const sleep = H().series(S, 'sleepMin', from - 6, day);
    out.push(U.chartCard({ title: 'Sleep', value: sleep.length ? `${U.fmtMin(avg(inRange(sleep)))} a night` : '', fmt: hrs, from, to: day, zero: true,
      series: [{ name: 'Sleep', kind: 'bar', color: 'var(--hue-indigo)', points: inRange(sleep) }, { name: '7-day average', kind: 'avg', color: 'var(--label)', points: U.rolling(sleep, from, day, 7) }] }));
    const rhr = H().series(S, 'rhr', from, day);
    out.push(U.chartCard({ title: 'Resting heart rate', value: rhr.length ? `${Math.round(avg(rhr))} bpm` : '', fmt: (v) => `${Math.round(v)} bpm`, from, to: day,
      series: [{ name: 'Resting HR', kind: 'line', color: 'var(--hue-rose)', points: rhr }] }));
    const hrv = H().series(S, 'hrv', from, day);
    out.push(U.chartCard({ title: 'HRV', value: hrv.length ? `${Math.round(avg(hrv))} ms` : '', fmt: (v) => `${Math.round(v)} ms`, from, to: day,
      series: [{ name: 'HRV', kind: 'line', color: 'var(--hue-violet)', points: hrv }] }));
    const w = H().series(S, 'weightKg', from - 6, day).map((p) => ({ day: p.day, value: U.kgTo(p.value) }));
    out.push(U.chartCard({ title: 'Weight', value: w.length ? U.fmtW(B().weightStats(S, day).avg7 || B().weightStats(S, day).last) : '', fmt: (v) => `${U.num(v, 1)} ${U.wUnit()}`, from, to: day,
      series: [{ name: 'Weigh-ins', kind: 'dot', color: 'var(--hue-teal)', points: inRange(w) }, { name: '7-day average', kind: 'avg', color: 'var(--label)', points: U.rolling(w, from, day, 7) }] }));
    if (GH.food && GH.food.full(S)) {
      const eaten = [], target = [];
      for (let d = from; d <= day; d++) {
        const x = GH.food.totals(S, d);
        if (x.n || (x.other && x.other.kcal)) eaten.push({ day: d, value: x.kcal });
        const tg = GH.food.targets(S, d);
        if (tg) target.push({ day: d, value: tg.kcal });
      }
      out.push(U.chartCard({ title: 'Calories eaten', value: eaten.length ? `${U.num(avg(eaten))} a day` : '', fmt: (v) => `${U.num(v)} kcal`, from, to: day, zero: true,
        series: [{ name: 'Eaten', kind: 'bar', color: 'var(--hue-green)', points: eaten }, { name: 'Target', kind: 'line', color: 'var(--label)', points: target }] }));
    }
    const kcal = H().series(S, 'activeKcal', from, day);
    if (kcal.length) out.push(U.chartCard({ title: 'Active calories', value: `${U.num(avg(kcal))} a day`, fmt: (v) => `${U.num(v)} kcal`, from, to: day, zero: true,
      series: [{ name: 'Active calories', kind: 'bar', color: 'var(--hue-coral)', points: kcal }] }));
    const act = [];
    for (let d = from; d <= day; d++) { const m = H().activeMinutes(S, d, d); if (m) act.push({ day: d, value: m }); }
    out.push(U.chartCard({ title: 'Active minutes', value: act.length ? `${U.num(act.reduce((a, p) => a + p.value, 0) / Math.max(1, range / 7))} a week` : '', fmt: (v) => `${Math.round(v)} min`, from, to: day, zero: true,
      series: [{ name: 'Active minutes', kind: 'bar', color: 'var(--hue-amber)', points: act }] }));
    const ms = (S.measurements || []).filter((m) => m.day >= from - 60);
    if (ms.length >= 2) {
      const cm = S.profile.units === 'kg';
      const conv = (v) => (cm ? v : v / 2.54);
      const ser = (k, name, color) => ({ name, kind: 'line', color, gap: 60, points: ms.filter((m) => m[k] != null).map((m) => ({ day: m.day, value: conv(m[k]) })) });
      const series = [ser('waist', 'Waist', 'var(--hue-teal)'), ser('armL', 'Left arm', 'var(--hue-coral)'), ser('armR', 'Right arm', 'var(--hue-sky)')].filter((x) => x.points.length);
      if (series.length) out.push(U.chartCard({ title: 'Measurements', value: '', fmt: (v) => `${v.toFixed(1)} ${cm ? 'cm' : 'in'}`, from: Math.min(from, ms[0].day), to: day, series }));
    }
    return out.join('');
  }

  /* ---------------------------------------------------------------- activity + sources */
  function activity(S, day) {
    const list = H().activity(S, day - 27, day).slice(0, 10);
    if (!list.length) return '<p class="t-callout rf-muted">No workouts in the last 4 weeks yet.</p>';
    return `<ul class="rf-list">${list.map((a) => U.row({
      icon: a.src === 'app' ? 'bolt' : a.src === 'manual' ? 'pencil' : 'heart', tone: a.src === 'app' ? 'indigo' : a.src === 'manual' ? 'amber' : 'rose',
      title: U.esc(U.cap(a.name || 'Workout')), sub: `${U.esc(U.fmtDay(a.day))}${a.src === 'app' ? ' · Gradient Health' : a.src === 'manual' ? ' · logged by hand' : ' · Health Connect'}`,
      detail: a.minutes ? `${a.minutes} min` : '',
    })).join('')}</ul>`;
  }
  const TYPE_LABEL = { steps: 'steps', sleep: 'sleep', weight: 'weight', height: 'height', bodyFat: 'body fat', restingHr: 'resting heart rate', hrv: 'HRV', exercise: 'workouts', heartRate: 'heart rate', activeKcal: 'active calories', distance: 'distance', nutrition: 'food' };
  const HC_TEXT = {
    granted: 'Connected', partial: 'Partly connected: some data types are off', denied: 'Not connected',
    unsupported: 'Needs Android 14 or newer', unavailable: 'Not available on this phone right now',
  };
  function sources(S) {
    const st = H().status();
    const app = GH.platform && GH.platform.isApp();
    const on = H().connected(st);
    const text = !app ? 'Health Connect works in the Android app' : HC_TEXT[st] || st;
    const sync = U.syncState();
    const last = S.health.lastSync;
    const errs = (S.health.errors || []).length ? `<p class="t-footnote rf-muted">Couldn't read: ${U.esc(S.health.errors.map((k) => TYPE_LABEL[k] || k).join(', '))}. It'll try again on the next sync.</p>` : '';
    const failed = sync.error && !sync.busy ? `<div class="notice" data-tone="caution">${U.icon('alert')}<span>The last sync didn't finish${sync.error === 'timeout' ? ' (it took too long)' : ''}. Pull down or tap Sync now to try again.</span></div>` : '';
    const buttons = !app || st === 'unsupported' || st === 'unavailable' ? ''
      : on ? `<div class="btn-row"><button type="button" class="rf-btn" data-act="hcSync" data-sync-spin${sync.busy ? ' data-spinning' : ''}>${U.icon('refresh')}Sync now</button><button type="button" class="rf-btn" data-variant="plain" data-act="hcManage">Permissions</button></div>`
        : '<button type="button" class="rf-btn" data-variant="filled" data-act="hcConnect">Connect Health Connect</button>';
    const canWrite = on && H().canWrite && H().canWrite();
    const writes = on ? `<ul class="rf-list sheet-gap">${U.sw('Save workouts to Health Connect', !!(S.health.write !== false && canWrite), 'data-on="hcWriteToggle"', canWrite ? 'Other apps see your Gradient Health workouts' : 'Needs the Exercise permission in Health Connect')}</ul>` : '';
    return `<div class="card" data-key="sources">
      <div class="row-between"><span class="t-headline">Health Connect</span>${U.badge(on ? 'On' : 'Off', on ? 'positive' : 'neutral')}</div>
      <p class="t-callout rf-muted">${U.esc(text)}${on ? ` · ${sync.busy ? 'syncing now' : `updated <span data-ago="${last || 0}">${U.esc(U.ago(last))}</span>`}` : ''}</p>
      <p class="t-footnote rf-muted">Reads sleep, steps, weight, height, body fat, heart rate, resting heart rate, HRV, active calories, distance and workouts${GH.food && GH.food.full(S) ? ', plus meals from other apps' : ''}. Syncs when you open the app and every 15 minutes while it's open. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="openPrivacy">Privacy</button></p>
      ${on && !S.health.askedNew && H().missingTypes && H().missingTypes(S).length ? `<div class="notice" data-tone="info">${U.icon('info')}<span>This version can also read heart rate, active calories and distance${GH.food && GH.food.full(S) ? ', and share meals' : ''}. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="hcAllowNew">Allow</button><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="hcSkipNew">Not now</button></span></div>` : ''}
      ${failed}${errs}${buttons}${writes}</div>`;
  }
  U.act.hcSync = async () => {
    U.haptic('tap');
    const r = await U.syncHealth('manual');
    if (r && !r.ok) U.toast('Couldn\'t read Health Connect', 'caution', r.error === 'timeout' ? 'It took too long. Try again.' : undefined);
    else if (r) U.toast('Health data updated', 'positive');
  };
  U.on.hcWriteToggle = async (el, ev, v) => {
    const S = U.S;
    if (v && !(H().canWrite && H().canWrite())) {
      const st = await H().request(S);
      if (!(H().canWrite && H().canWrite())) { el.checked = false; U.toast('Not allowed yet', 'caution', 'Turn on Exercise under Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() }); return; }
      S.health.status = st;
    }
    S.health.write = !!v;
    U.save();
    if (v) { const n = H().writeRecent ? H().writeRecent(S) : 0; if (n) U.toast(`Saving ${U.plural(n, 'workout')} to Health Connect`, 'positive'); }
  };
  U.act.hcManage = () => H().openSettings();
  // Asked once on the Health tab; Settings keeps a row for it until everything's allowed.
  U.act.hcAllowNew = async () => { U.S.health.askedNew = Date.now(); await U.act.hcConnect(); };
  U.act.hcSkipNew = () => { U.S.health.askedNew = Date.now(); U.commit(); };
  U.act.hcConnect = async () => {
    const st = await H().request(U.S);
    U.S.health.status = st;
    if (H().connected(st)) { await U.syncHealth('manual'); U.toast('Health Connect connected', 'positive'); if (U.checklistCheck) U.checklistCheck(); }
    else if (st === 'denied') U.toast('Not connected', 'caution', 'Allow access in Health Connect to use your data.', { label: 'Open', onClick: () => H().openSettings() });
    U.commit();
  };
  U.act.openPrivacy = () => { const t = U.topSheet(); if (t) t.close('ok'); U.open('privacy'); };

  /* ---------------------------------------------------------------- logs */
  const unitLen = () => (U.S.profile.units === 'kg' ? 'cm' : 'in');
  U.act.logWeight = () => U.sheet({
    title: 'Log weight', detents: 'small medium', detent: 'small',
    body: `<div class="sheet-pad"><div class="rf-field"><label class="rf-field-label" for="wIn">Weight (${U.wUnit()})</label><div class="rf-field-control"><input class="rf-input" id="wIn" type="number" inputmode="decimal" step="0.1" placeholder="${U.lb() ? '150' : '68'}"></div><p class="rf-field-hint">Same time each morning is best. The trend uses a 7-day average.</p></div></div>`,
    action: { label: 'Save', act: 'logWeightSave' },
  });
  U.act.logWeightSave = () => {
    const v = parseFloat(document.getElementById('wIn').value);
    const kg = U.toKg(v);
    if (!(kg > 25 && kg < 350)) { U.toast(`Enter a weight in ${U.wUnit()}`, 'caution'); return; }
    H().logManual(U.S, U.today(), { weightKg: kg });
    const t = U.topSheet(); if (t) t.close('ok');
    U.commit();
    const ws = B().weightStats(U.S, U.today());
    U.toast('Weight saved', 'positive', ws.warn || undefined);
  };
  U.act.logSleep = () => U.sheet({
    title: 'Log sleep', detents: 'small medium', detent: 'small',
    body: `<div class="sheet-pad"><p class="t-callout rf-muted">Hours asleep last night</p><div class="ob-center">${U.stepper('sleepIn', 7, 0, 14, 'Hours of sleep', '', 0.5)}</div></div>`,
    action: { label: 'Save', act: 'logSleepSave' },
  });
  U.act.logSleepSave = () => {
    const v = parseFloat(document.getElementById('sleepIn').value);
    if (v >= 0 && v <= 16) H().logManual(U.S, U.today(), { sleepMin: Math.round(v * 60) });
    const t = U.topSheet(); if (t) t.close('ok');
    U.commit();
  };
  U.act.logFeel = () => {
    const f = U.S.feel[U.today()] || {};
    U.sheet({
      title: 'How are you today?', detents: 'medium',
      body: `<div class="sheet-pad"><div class="feel-row"><span class="t-subhead">Energy</span>${U.seg('fE', [['low', 'Low'], ['ok', 'OK'], ['good', 'Good']], f.energy || '', 'Energy', ' data-on="feelEnergy"')}</div>
        <div class="feel-row"><span class="t-subhead">Soreness</span>${U.seg('fS', [['none', 'None'], ['some', 'Some'], ['very', 'Very']], f.sore || '', 'Soreness', ' data-on="feelSore"')}</div></div>`,
    });
  };
  U.act.logActivity = () => U.sheet({
    title: 'Log an activity', detents: 'medium large',
    body: `<div class="sheet-pad"><div class="ob-chips" id="actTypes">${['Walk', 'Run', 'Cycling', 'Sport', 'Gym', 'Swim', 'Yoga', 'Other'].map((t, i) => `<button type="button" class="rf-chip" aria-pressed="${i === 0}" data-on="actType" data-v="${t}">${t}</button>`).join('')}</div>
      <p class="t-callout rf-muted">Minutes</p><div class="ob-center">${U.stepper('actMin', 30, 5, 300, 'Minutes', '', 5)}</div>
      <p class="t-footnote rf-muted">45 min or more of hard exercise means easier legs and no finisher the next day.</p></div>`,
    action: { label: 'Save', act: 'logActivitySave' },
  });
  let actType = 'Walk';
  U.on.actType = (el, ev, v) => {
    if (!v) { el.setAttribute('aria-pressed', 'true'); return; }
    actType = el.dataset.v;
    for (const c of document.querySelectorAll('#actTypes .rf-chip')) if (c !== el) c.setAttribute('aria-pressed', 'false');
  };
  U.act.logActivitySave = () => {
    const m = parseInt(document.getElementById('actMin').value, 10);
    if (m > 0) {
      H().logManual(U.S, U.today(), { exercise: { typeName: actType.toLowerCase(), minutes: m } });
      if (/walk/i.test(actType) && m >= 10) { const p = B().todayPlan(U.S, U.today()); if (p.type === 'light') B().logLight(U.S, U.today(), 'walk', 'manual-walk'); }
    }
    const t = U.topSheet(); if (t) t.close('ok');
    U.commit();
    U.toast('Activity saved', 'positive');
  };
  U.act.logMeasure = () => {
    const last = (U.S.measurements || []).slice(-1)[0] || {};
    const u = unitLen();
    const val = (k) => (last[k] == null ? '' : (u === 'cm' ? last[k] : last[k] / 2.54).toFixed(1));
    const f = (k, label) => `<div class="rf-field"><label class="rf-field-label" for="m-${k}">${label} (${u})</label><div class="rf-field-control"><input class="rf-input" id="m-${k}" type="number" inputmode="decimal" step="0.1" placeholder="${val(k)}"></div></div>`;
    U.sheet({
      title: 'Measurements', detents: 'large', detent: 'large',
      body: `<div class="sheet-pad ob-fields">${f('waist', 'Waist, at the belly button')}<div class="ob-row2">${f('armL', 'Left arm, flexed')}${f('armR', 'Right arm, flexed')}</div>${f('chest', 'Chest')}${f('thigh', 'Thigh')}
        <p class="t-footnote rf-muted">Once a month, same time of day. Leave any blank. Arms show whether the left side is catching up.</p></div>`,
      action: { label: 'Save', act: 'logMeasureSave' },
    });
  };
  U.act.logMeasureSave = () => {
    const u = unitLen();
    const m = {};
    for (const k of ['waist', 'armL', 'armR', 'chest', 'thigh']) { const v = parseFloat(document.getElementById('m-' + k).value); if (v > 0) m[k] = u === 'cm' ? v : v * 2.54; }
    const saved = H().addMeasurement(U.S, U.today(), m);
    const t = U.topSheet(); if (t) t.close('ok');
    if (saved) { U.commit(); U.toast('Measurements saved', 'positive'); }
  };
  U.on.healthRange = (el, ev, v) => { range = Number(v) || 28; U.render(); };

  /* ---------------------------------------------------------------- the screen */
  U.screens.health = {
    render(S, day) {
      const ins = GH.insights.top(S, day, 5);
      GH.insights.markShown(S, ins, day);
      const connected = H().connected(H().status());
      const busy = U.syncState().busy;
      return `${U.navbar('Health', connected ? U.glassBtn('refresh', 'Sync health data now', 'hcSync', `data-sync-spin${busy ? ' data-spinning' : ''}`) : '')}
        <h1 class="rf-large-title">Health</h1>
        ${connected ? `<p class="lt-sub t-footnote rf-muted">${busy ? 'Syncing with Health Connect…' : `Synced <span data-ago="${S.health.lastSync || 0}">${U.esc(U.ago(S.health.lastSync))}</span>. Pull down to sync.`}</p>` : ''}
        <div class="section">
          ${U.tip ? U.tip('health') : ''}
          ${aiCard(S, day)}
          ${ins.length ? ins.map(insightCard).join('') : '<div class="card" data-key="noins"><p class="t-callout rf-muted">Insights show up here after a few days of data: sleep, steps, weight, workouts and check-ins.</p></div>'}
        </div>
        <h2 class="sec-title t-title-3">Today</h2>
        <div class="section">${todayGrid(S, day)}</div>
        <h2 class="sec-title t-title-3">Trends</h2>
        <div class="section">
          ${U.seg('healthRange', [['7', '7 days'], ['28', '28 days'], ['90', '90 days']], String(range), 'Range', ' data-on="healthRange"')}
          ${charts(S, day)}
        </div>
        <h2 class="sec-title t-title-3">Activity</h2>
        <div class="section">${activity(S, day)}</div>
        <h2 class="sec-title t-title-3">Log</h2>
        <div class="section"><ul class="rf-list">
          ${U.row({ icon: 'chart', tone: 'teal', title: 'Weight', act: 'logWeight', chevron: true })}
          ${U.row({ icon: 'moon', tone: 'indigo', title: 'Sleep', act: 'logSleep', chevron: true })}
          ${U.row({ icon: 'sparkle', tone: 'sky', title: 'Feel check', act: 'logFeel', chevron: true })}
          ${U.row({ icon: 'bolt', tone: 'amber', title: 'Activity', sub: 'A run, a game, anything outside this app', act: 'logActivity', chevron: true })}
          ${U.row({ icon: 'pin', tone: 'violet', title: 'Measurements', sub: 'Waist, arms, chest, thigh', act: 'logMeasure', chevron: true })}
        </ul></div>
        <h2 class="sec-title t-title-3">Sources</h2>
        <div class="section">${sources(S)}</div>`;
    },
    shown(S, day) {
      if (AI() && AI().needsReport(S, day) && ai.tried !== day && !ai.busy) writeReport(true);
    },
    after(root, S, day) {
      if (AI() && AI().needsReport(S, day) && ai.tried !== day && !ai.busy) setTimeout(() => writeReport(true), 50);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
