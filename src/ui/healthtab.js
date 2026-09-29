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
    const rep = api ? AI().reportFor(S, day) : null;
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
    return `<div class="card ai-card" data-key="coach">
      <div class="ai-head">${U.icon('sparkle')}<span class="t-headline">Weekly report</span>${badge}<span class="rf-spacer"></span>
        ${api ? `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="aiReport"${ai.busy ? ' aria-disabled="true"' : ''}>${rep ? 'Refresh' : 'Write it'}</button>` : ''}</div>
      ${body}${err}
      <p class="t-footnote rf-muted">${meta}</p>
      <div class="btn-row"><button type="button" class="rf-btn" data-variant="soft" data-act="askCoach">${U.icon('chat')}Ask a question</button>
        ${canHandOff() ? `<button type="button" class="rf-btn" data-variant="plain" data-act="askClaudeApp">${U.icon('share')}Ask in the Claude app</button>` : ''}</div>
    </div>`;
  }
  const canHandOff = () => !!(GH.platform && (GH.platform.isApp() || (G.navigator && G.navigator.share)));
  async function writeReport(auto) {
    const S = U.S, day = U.today();
    if (ai.busy || !AI() || !AI().hasKey() || !claudeMode(S)) return;
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
  U.act.dismissInsight = (el) => { GH.insights.dismiss(U.S, el.dataset.arg, U.today()); U.commit(); U.toast('Hidden for 30 days', 'neutral'); };
  U.act.insightGo = (el) => U.go(el.dataset.arg);

  /* ---------------------------------------------------------------- chat */
  // Claude (API key) answers stream in; the built-in coach answers right away from your numbers.
  // Either way, "Ask in the Claude app" hands the question to the Claude app instead.
  let chat = null;
  const PRESETS = ['Why is today lighter?', 'How is my sleep?', 'Am I getting stronger?', 'How is my weight trending?', 'What should I focus on?'];
  function chatLog(S) { return claudeMode(S) && AI() && AI().hasKey() ? (S.ai.chat || []) : (S.coachChat || []); }
  function bubbles(S) {
    const msgs = chatLog(S).slice(-12);
    const api = claudeMode(S) && AI() && AI().hasKey();
    if (!msgs.length) {
      return `<p class="t-callout rf-muted chat-empty">${api ? 'Ask about your sleep, steps, training or what to focus on. Claude sees the same summary as the weekly report.' : 'Ask about your sleep, steps, weight, protein, training or recovery. Answers come from your own numbers, worked out on this phone.'}</p>
        <div class="ob-chips chat-presets">${PRESETS.map((q) => `<button type="button" class="rf-chip" data-act="askQuick" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>`;
    }
    return msgs.map((m) => `<div class="bubble ${m.role === 'user' ? 'me' : 'coach'}">${U.esc(m.text)}</div>`).join('');
  }
  U.act.askCoach = (el, ev, preset) => {
    const S = U.S;
    const api = claudeMode(S);
    if (api && (!AI() || !AI().hasKey())) { U.open('settings', 'coach'); return; }
    chat = U.sheet({
      title: api ? 'Ask Claude' : 'Ask the coach', detents: 'large', detent: 'large', cls: 'chat-sheet',
      body: `<div class="chat-log" id="chatLog">${bubbles(S)}</div>
        <div class="chat-compose"><textarea class="rf-input" id="askQ" rows="2" maxlength="1000" placeholder="Ask a question" aria-label="Your question">${U.esc(preset || '')}</textarea>
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-shape="circle" aria-label="Send" data-act="askSend">${U.icon('send')}</button></div>
        <p class="t-footnote rf-muted chat-foot">${api ? 'Claude sees a summary without your name, not your raw data.' : 'The built-in coach isn\'t an AI model: it answers common questions from your data.'} Not medical advice.</p>
        <div class="btn-row chat-btns">${canHandOff() ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="askClaudeApp">${U.icon('share')}Ask in the Claude app</button>` : ''}<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="askClear">Clear chat</button></div>`,
      onClose: () => { if (AI()) AI().stop(); chat = null; },
      after: (c) => { const log = c.el.querySelector('#chatLog'); if (log) log.scrollTop = log.scrollHeight; },
    });
    if (preset) setTimeout(() => U.act.askSend(chat.el.querySelector('[data-act="askSend"]')), 380);
  };
  U.act.askPreset = (el) => U.act.askCoach(el, null, el.dataset.arg);
  U.act.askQuick = (el) => { const q = document.getElementById('askQ'); if (q) q.value = el.dataset.arg; U.act.askSend(document.querySelector('.chat-sheet [data-act="askSend"]')); };
  U.act.askClear = () => {
    if (claudeMode(U.S) && AI()) AI().clearChat(U.S); else U.S.coachChat = [];
    U.save();
    const log = document.getElementById('chatLog'); if (log) U.morph(log, bubbles(U.S));
  };
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
  U.act.askSend = async (btn) => {
    const S = U.S;
    const q = document.getElementById('askQ');
    const log = document.getElementById('chatLog');
    if (!q || !log || ai.busy) return;
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    lastQuestion = text;
    addBubble(log, 'me', text);
    U.haptic('tap');
    if (!(claudeMode(S) && AI() && AI().hasKey())) {
      const res = GH.coach.ask(S, U.today(), text);
      S.coachChat = (S.coachChat || []).concat([{ role: 'user', text }, { role: 'coach', text: res.text }]).slice(-24);
      U.save();
      setTimeout(() => addBubble(log, 'coach', res.text), 220);
      return;
    }
    const out = addBubble(log, 'coach is-typing');
    out.innerHTML = '<span class="rf-spinner" data-size="sm"><i></i></span>';
    if (btn) btn.setAttribute('aria-busy', 'true');
    ai.busy = 'chat';
    try {
      await AI().ask(S, U.today(), text, (delta, snapshot) => { out.classList.remove('is-typing'); out.textContent = snapshot; log.scrollTop = log.scrollHeight; });
      out.classList.remove('is-typing');
      U.save(true);
    } catch (e) {
      out.classList.remove('is-typing');
      out.classList.add('is-error');
      out.textContent = e.message || 'Something went wrong.';
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
      ${tile('navigate', 'green', 'Steps', t.steps != null ? U.num(t.steps) : '–', t.steps != null ? join(bs.n >= 5 ? `usual ${U.num(bs.avg)}` : '') : H().connected(H().status()) ? 'none synced yet today' : 'needs Health Connect')}
      ${tile('heart', 'rose', 'Resting HR', rh ? `${Math.round(rh.value)} <small>bpm</small>` : '–', rh ? join(rh.day !== day ? ago(rh) : '', br.n >= 5 ? `usual ${Math.round(br.avg)}` : '') : 'not shared by your watch app', rh ? null : 'whyNoData')}
      ${tile('wave', 'violet', 'HRV', hv ? `${Math.round(hv.value)} <small>ms</small>` : '–', hv ? join(hv.day !== day ? ago(hv) : '', bh.n >= 5 ? `usual ${Math.round(bh.avg)}` : '') : 'not shared by your watch app', hv ? null : 'whyNoData')}
      ${tile('chart', 'teal', 'Weight', t.weightAvg7 != null ? U.esc(U.fmtW(t.weightAvg7)) : '–', t.weightAvg7 != null ? '7-day average' : 'tap to log', t.weightAvg7 == null ? 'logWeight' : null)}
      ${tile('bolt', 'amber', 'Active', `${t.activeMin} <small>min</small>`, 'today')}
      ${S.profile.protein.track !== false ? tile('check-circle', 'green', 'Protein', t.proteinGoal ? `${t.protein} <small>of ${t.proteinGoal} g</small>` : `${t.protein} <small>g</small>`, 'today') : ''}
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
    const act = [];
    for (let d = from; d <= day; d++) { const m = H().activeMinutes(S, d, d); if (m) act.push({ day: d, value: m }); }
    out.push(U.chartCard({ title: 'Active minutes', value: act.length ? `${U.num(act.reduce((a, p) => a + p.value, 0) / Math.max(1, range / 7))} a week` : '', fmt: (v) => `${Math.round(v)} min`, from, to: day, zero: true,
      series: [{ name: 'Active minutes', kind: 'bar', color: 'var(--hue-amber)', points: act }] }));
    const ms = (S.measurements || []).filter((m) => m.day >= from - 60);
    if (ms.length >= 2) {
      const cm = S.profile.units === 'kg';
      const conv = (v) => (cm ? v : v / 2.54);
      const ser = (k, name, color) => ({ name, kind: 'line', color, points: ms.filter((m) => m[k] != null).map((m) => ({ day: m.day, value: conv(m[k]) })) });
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
      title: U.esc(U.cap(a.name || 'Workout')), sub: `${U.esc(U.fmtDay(a.day))}${a.src === 'app' ? ' · Gradient' : a.src === 'manual' ? ' · logged by hand' : ' · Health Connect'}`,
      detail: a.minutes ? `${a.minutes} min` : '',
    })).join('')}</ul>`;
  }
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
    const errs = (S.health.errors || []).length ? `<p class="t-footnote rf-muted">Couldn't read: ${U.esc(S.health.errors.join(', '))}.</p>` : '';
    const failed = sync.error && !sync.busy ? `<div class="notice" data-tone="caution">${U.icon('alert')}<span>The last sync didn't finish${sync.error === 'timeout' ? ' (it took too long)' : ''}. Pull down or tap Sync now to try again.</span></div>` : '';
    const buttons = !app || st === 'unsupported' || st === 'unavailable' ? ''
      : on ? `<div class="btn-row"><button type="button" class="rf-btn" data-act="hcSync" data-sync-spin${sync.busy ? ' data-spinning' : ''}>${U.icon('refresh')}Sync now</button><button type="button" class="rf-btn" data-variant="plain" data-act="hcManage">Permissions</button></div>`
        : '<button type="button" class="rf-btn" data-variant="filled" data-act="hcConnect">Connect Health Connect</button>';
    const canWrite = on && H().canWrite && H().canWrite();
    const writes = on ? `<ul class="rf-list sheet-gap">${U.sw('Save workouts to Health Connect', !!(S.health.write !== false && canWrite), 'data-on="hcWriteToggle"', canWrite ? 'Other apps see your Gradient workouts' : 'Needs the Exercise permission in Health Connect')}</ul>` : '';
    return `<div class="card" data-key="sources">
      <div class="row-between"><span class="t-headline">Health Connect</span>${U.badge(on ? 'On' : 'Off', on ? 'positive' : 'neutral')}</div>
      <p class="t-callout rf-muted">${U.esc(text)}${on ? ` · ${sync.busy ? 'syncing now' : `updated <span data-ago="${last || 0}">${U.esc(U.ago(last))}</span>`}` : ''}</p>
      <p class="t-footnote rf-muted">Reads sleep, steps, weight, height, body fat, resting heart rate, HRV and workouts. Syncs when you open the app and every 15 minutes while it's open. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="openPrivacy">Privacy</button></p>
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
      const st = await H().request();
      if (!(H().canWrite && H().canWrite())) { el.checked = false; U.toast('Not allowed yet', 'caution', 'Turn on Exercise under Gradient in Health Connect.', { label: 'Open', onClick: () => H().openSettings() }); return; }
      S.health.status = st;
    }
    S.health.write = !!v;
    U.save();
    if (v) { const n = H().writeRecent ? H().writeRecent(S) : 0; if (n) U.toast(`Saving ${U.plural(n, 'workout')} to Health Connect`, 'positive'); }
  };
  U.act.hcManage = () => H().openSettings();
  U.act.hcConnect = async () => {
    const st = await H().request();
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
