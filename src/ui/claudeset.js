/* Claude's own page and pickers, for someone who added an API key: the model and thinking level, the
 * spending limits, and what Claude has cost (this month by day, by feature and by model, and the last
 * few requests). A lazy part ('claudeUi'): src/ui/lazy.js has its stand-ins, and Settings' rows read
 * what they show from GH.spend (src/spend.js), which also holds Claude to the limits.
 *
 *  - U.screens.claude: the page (Settings, AI coach, Claude).
 *  - U.act.claudeModel: the model and thinking sheet (the page, and the chat's pill).
 *  - U.act.claudeBudget: one limit's sheet (arg: monthly, daily or request).
 *  - U.claudeSetup(): the sheet right after a key is added and allowed: a model and a monthly
 *    budget, with the defaults picked. Resolves when it closes.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const SP = () => GH.spend;
  const AI = () => GH.ai;
  const doc = G.document;
  const LIMITS_URL = 'https://platform.claude.com/settings/limits';

  /* ---------------------------------------------------------------- words and numbers */
  const TONE = { 'claude-fable-5-1': 'indigo', 'claude-opus-5-5': 'violet', 'claude-sonnet-5-5': 'sky', 'claude-haiku-5-5': 'teal' };
  const ONE = { chat: 'Question', report: 'Weekly report', review: 'Plan check', build: 'Plan built', suggest: 'Suggestions', tailor: 'Tailor request' };
  const dollars = (x) => (x < 1 ? x.toFixed(2) : String(x));
  const price = (m) => `$${dollars(m.in)} in, $${dollars(m.out)} out per million tokens`;
  // "3¢", "under 1¢", "$1.20": what a typical request costs.
  function cents(micro) {
    const d = micro / 1e6;
    if (d < 0.01) return 'under 1¢';
    if (d < 1) return `${Math.round(d * 100)}¢`;
    return `$${d.toFixed(2)}`;
  }
  // The person's state with another model or level, to price a choice before it's made.
  const withChoice = (S, c) => Object.assign({}, S, { ai: Object.assign({}, S.ai, { claude: Object.assign({}, S.ai.claude, c) }) });
  const each = (S, feature) => cents(SP().typical(S, feature));
  // "about 3¢", or "under 1¢" (never "about under 1¢").
  const about = (S, feature) => { const c = SP().typical(S, feature); return c < 5000 ? 'under 1¢' : `about ${cents(c)}`; };
  const toks = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = (day) => MONTHS[Number(GH.brain.dayStr(day).slice(5, 7)) - 1];
  // A limit as the page shows it.
  function limitText(S, day, kind) {
    const b = SP().budget(S), L = SP().limits(S, day), money = SP().money;
    if (kind === 'monthly') return b.monthly == null ? 'None' : money(SP().micro(b.monthly), { whole: true });
    if (kind === 'daily') return b.daily != null ? money(SP().micro(b.daily)) : L.today.limit != null ? `Auto · ${money(L.today.limit)}` : 'None';
    return b.request == null ? 'None' : money(SP().micro(b.request));
  }
  const refresh = () => { if (U.route && ['settings', 'claude'].includes(U.route.view)) U.render(); };

  /* ---------------------------------------------------------------- the model and thinking */
  function modelRow(S, m) {
    const on = m.id === SP().model(S).id;
    const note = m.note || 'An older model, still available';
    return `<li data-key="m-${m.id}"><button type="button" class="rf-list-row cl-pick" role="radio" aria-checked="${on}" data-act="claudePickModel" data-arg="${m.id}">
      <span class="rf-list-icon" data-tone="${TONE[m.id] || 'neutral'}">${U.icon('sparkle')}</span>
      <span class="rf-list-text"><span class="rf-list-title">${U.esc(m.name)}${m.id === SP().DEFAULT_MODEL ? ` ${U.badge('Recommended', 'accent')}` : ''}</span><span class="rf-list-sub">${U.esc(note)}</span><span class="rf-list-sub cl-price rf-num">${U.esc(`${price(m)} · ${about(withChoice(S, { model: m.id }), 'chat')} a question`)}</span></span>
      <span class="cl-check" aria-hidden="true">${on ? U.icon('check-circle') : ''}</span></button></li>`;
  }
  function levelRow(S, lv) {
    const on = SP().level(S) === lv || (lv === 'low' && SP().level(S) === 'off' && !SP().model(S).off);
    return `<li data-key="lv-${lv}"><button type="button" class="rf-list-row cl-pick" role="radio" aria-checked="${on}" data-act="claudePickLevel" data-arg="${lv}">
      <span class="rf-list-text"><span class="rf-list-title">${U.esc(SP().LEVEL_NAMES[lv])}</span><span class="rf-list-sub">${U.esc(SP().LEVEL_NOTES[lv])}</span></span>
      <span class="rf-list-detail rf-num">${U.esc(each(withChoice(S, { think: lv }), 'chat'))}</span>
      <span class="cl-check" aria-hidden="true">${on ? U.icon('check-circle') : ''}</span></button></li>`;
  }
  function modelBody(S) {
    const m = SP().model(S);
    const current = SP().MODELS.filter((x) => !x.older), older = SP().MODELS.filter((x) => x.older);
    const olderOpen = older.some((x) => x.id === m.id);
    return `<div class="sheet-pad cl-models">
      <h3 class="rf-list-header">Model</h3>
      <ul class="rf-list" role="radiogroup" aria-label="Model">${current.map((x) => modelRow(S, x)).join('')}</ul>
      <details class="cl-older gh-drop"${olderOpen ? ' open' : ''}><summary class="t-subhead">Older models${U.icon('chevron-down', 'sm')}</summary>
        <ul class="rf-list" role="radiogroup" aria-label="Older models">${older.map((x) => modelRow(S, x)).join('')}</ul></details>
      <h3 class="rf-list-header">Thinking</h3>
      <ul class="rf-list" role="radiogroup" aria-label="Thinking">${SP().levelsFor(m).map((lv) => levelRow(S, lv)).join('')}</ul>
      <p class="rf-list-footer">Thinking is billed as output, so more of it costs more. Prices are for a typical question with your data: estimates at first, then your own average.${m.off ? '' : ` ${U.esc(m.short)} always thinks a little, so it has no Off.`}</p>
    </div>`;
  }
  U.act.claudeModel = () => {
    const S = U.S;
    SP().ensure(S);
    const ctl = U.sheet({ title: 'Model and thinking', size: 'auto', cls: 'cl-sheet', body: modelBody(S) });
    const draw = () => { if (!ctl.closed) ctl.update(modelBody(S)); };
    U.act.claudePickModel = (el) => {
      const m = SP().byId(el.dataset.arg);
      if (!m) return;
      S.ai.claude.model = m.id;
      if (S.ai.claude.think === 'off' && !m.off) S.ai.claude.think = 'low';
      U.save(true);
      U.haptic('select');
      draw();
      refresh();
    };
    U.act.claudePickLevel = (el) => {
      if (!SP().LEVEL_NAMES[el.dataset.arg]) return;
      S.ai.claude.think = el.dataset.arg;
      U.save(true);
      U.haptic('select');
      draw();
      refresh();
    };
  };

  /* ---------------------------------------------------------------- the limits */
  const PRESETS = { monthly: [5, 10, 20, 50, 100, 200], daily: [0.25, 0.5, 1, 2, 5, 10], request: [0.05, 0.1, 0.25, 0.5, 1, 2] };
  const TITLES = { monthly: 'Monthly budget', daily: 'Daily limit', request: 'Most for one request' };
  const INTRO = {
    monthly: 'The most Claude may cost in a calendar month. Each day gets an equal share of what\'s left, so it lasts the month.',
    daily: 'The most Claude may cost in a day. Auto is an equal share of what\'s left this month.',
    request: 'The most any one question, report or plan may cost. A request that could cost more isn\'t sent.',
  };
  const NONE = { monthly: 'No budget', daily: 'No daily limit', request: 'No limit' };
  // What an amount means, in words: "$200 a month is about $6.45 a day for the rest of October."
  function amountLine(S, day, kind, v) {
    const money = SP().money;
    const md = SP().monthDays(day);
    const spent = SP().limits(S, day).month.spent - SP().limits(S, day).today.spent;
    if (kind === 'monthly') {
      if (v == null) return 'No monthly budget: only a daily limit you set holds Claude back.';
      const per = Math.max(0, Math.floor((SP().micro(v) - spent) / md.left));
      return `${money(SP().micro(v), { whole: true })} a month is about ${money(per)} a day for the rest of ${monthName(day)}.`;
    }
    if (kind === 'daily') {
      if (v === 'auto') { const L = SP().limits(withBudget(S, { daily: null }), day); return L.today.limit == null ? 'Auto needs a monthly budget; without one there\'s no daily limit.' : `Today that\'s ${money(L.today.limit)}, an equal share of what\'s left of the month.`; }
      if (v == null) return 'No daily limit: the monthly budget still holds.';
      return `Up to ${money(SP().micro(v))} a day, and never past the monthly budget.`;
    }
    if (v == null) return 'No limit for one request: the daily and monthly limits still hold.';
    return `About ${Math.max(1, Math.floor(SP().micro(v) / Math.max(1, SP().typical(S, 'chat'))))} typical questions' worth, for any one request.`;
  }
  const withBudget = (S, b) => Object.assign({}, S, { ai: Object.assign({}, S.ai, { budget: Object.assign({}, SP().budget(S), b) }) });
  function parseAmount(s) {
    const n = Number(String(s || '').replace(/[$,\s]/g, ''));
    return isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
  }
  U.act.claudeBudget = (el) => {
    const kind = ['monthly', 'daily', 'request'].includes(el && el.dataset && el.dataset.arg) ? el.dataset.arg : 'monthly';
    const S = U.S;
    SP().ensure(S);
    const b = SP().budget(S);
    // The pick: 'none', 'auto' (daily only), or an amount (custom when it isn't a preset).
    let pick = kind === 'daily' && b.daily == null && b.monthly != null ? 'auto' : b[kind] == null ? 'none' : String(b[kind]);
    const day = U.today();
    const opts = (kind === 'daily' ? [['auto', 'Auto']] : []).concat(PRESETS[kind].map((v) => [String(v), SP().money(SP().micro(v), { whole: kind === 'monthly' })]), [['none', NONE[kind]]]);
    const value = () => (pick === 'none' ? null : pick === 'auto' ? 'auto' : parseAmount(pick));
    const body = () => `<div class="sheet-pad cl-budget">
      <p class="t-callout rf-muted">${U.esc(INTRO[kind])}</p>
      <div class="cl-amount${pick === 'none' || pick === 'auto' ? ' is-off' : ''}"><span class="cl-cur" aria-hidden="true">$</span><input class="rf-input rf-num" id="clAmt" type="text" inputmode="decimal" autocomplete="off" aria-label="${U.esc(TITLES[kind])} in dollars" value="${pick === 'none' || pick === 'auto' ? '' : U.esc(pick)}" placeholder="${pick === 'auto' ? 'Auto' : 'None'}"></div>
      ${U.choice('clAmtPick', opts, opts.some(([v]) => v === pick) ? pick : '', TITLES[kind], ' data-on="claudeAmtPick" data-repick')}
      <p class="t-footnote cl-amt-line" id="clAmtLine">${U.esc(amountLine(S, day, kind, value()))}</p>
      <p class="rf-field-error" id="clAmtErr" hidden></p>
    </div>`;
    const ctl = U.sheet({ title: TITLES[kind], size: 'auto', cls: 'cl-sheet', body: body(), action: { label: 'Save', act: 'claudeBudgetSave' } });
    const line = () => { const p = doc.getElementById('clAmtLine'); if (p) p.textContent = amountLine(S, day, kind, value()); };
    const input = ctl.el.querySelector('#clAmt');
    if (input) input.addEventListener('input', () => { pick = input.value.trim() || 'none'; ctl.el.querySelector('.cl-amount').classList.remove('is-off'); line(); });
    U.on.claudeAmtPick = (x, ev, v) => {
      pick = v;
      const box = ctl.el.querySelector('.cl-amount');
      if (box) box.classList.toggle('is-off', v === 'none' || v === 'auto');
      if (input) { input.value = v === 'none' || v === 'auto' ? '' : v; input.placeholder = v === 'auto' ? 'Auto' : 'None'; }
      U.haptic('select');
      line();
    };
    U.act.claudeBudgetSave = () => {
      const v = value();
      const err = doc.getElementById('clAmtErr');
      if (pick !== 'none' && pick !== 'auto' && v == null) { if (err) { err.hidden = false; err.textContent = 'Type an amount in dollars, like 10 or 2.50.'; } U.haptic('deny'); return; }
      S.ai.budget = Object.assign(SP().budget(S), { [kind]: v === 'auto' ? null : v });
      U.save(true);
      U.haptic('success');
      ctl.close('ok');
      refresh();
    };
  };

  /* ---------------------------------------------------------------- the page */
  function meter(label, spent, limit, extra) {
    const money = SP().money;
    if (limit == null) return `<div class="cl-meter"><div class="cl-meter-top"><span class="t-subhead">${U.esc(label)}</span><span class="t-footnote rf-num">${U.esc(`${money(spent, { exact: true })} · no limit`)}</span></div></div>`;
    const v = limit > 0 ? spent / limit : 1;
    const tone = v >= 1 ? 'critical' : v >= 0.8 ? 'caution' : null;
    const sp = money(spent);
    return `<div class="cl-meter"><div class="cl-meter-top"><span class="t-subhead">${U.esc(label)}</span><span class="t-footnote rf-num">${U.esc(`${sp[0].toUpperCase()}${sp.slice(1)} of ${money(limit)}${extra ? ` · ${extra}` : ''}`)}</span></div>${U.progress(Math.min(1, v), label, tone)}</div>`;
  }
  // How many typical questions are left today, under every limit.
  function questionsLeft(S, day) {
    const L = SP().limits(S, day);
    if (!isFinite(L.room)) return null;
    return Math.max(0, Math.floor(Math.min(L.today.left, L.month.left) / Math.max(1, SP().typical(S, 'chat'))));
  }
  function usage(S, day) {
    const sp = SP().data(S), money = SP().money;
    const md = SP().monthDays(day);
    const from = day - md.date + 1;
    const month = sp.months[SP().monthOf(day)] || { c: 0, n: 0, f: {}, m: {} };
    const points = [];
    for (let d = from; d <= day; d++) if (sp.days[d] && sp.days[d].c > 0) points.push({ day: d, value: sp.days[d].c / 1e6 });
    const chart = points.length && U.chartCard ? U.chartCard({ title: `${monthName(day)} by day`, key: 'claude-days', value: money(month.c, { exact: true }), from, to: day, zero: true, fmt: (v) => `$${v.toFixed(2)}`, label: 'What Claude cost each day this month', series: [{ name: 'Spent', kind: 'bar', color: 'var(--rf-accent, var(--accent))', points }] }) : '';
    const rows = (obj, name) => Object.entries(obj).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(name(k))}</span></span><span class="rf-list-detail rf-num">${U.esc(money(c, { exact: true }))}</span></div></li>`).join('');
    const byFeature = rows(month.f, (k) => (SP().FEATURES[k] ? SP().FEATURES[k].name : k));
    const byModel = rows(month.m, (k) => (SP().byId(k) ? SP().byId(k).name : k));
    const recent = sp.log.slice(-8).reverse().map((e) => {
      const m = SP().byId(e.m), by = e.by && SP().byId(e.by);
      const when = GH.brain.dayOf(e.t, U.rollHour()) === day ? U.fmtClock(e.t) : `${U.fmtDay(GH.brain.dayOf(e.t, U.rollHour()))}, ${U.fmtClock(e.t)}`;
      const bits = [when, m ? m.short : e.m, `${toks(e.i + e.r + e.w)} in, ${toks(e.o)} out`];
      if (by) bits.push(`answered by ${by.short}`);
      if (e.est) bits.push('stopped early, estimated');
      return `<li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(ONE[e.f] || e.f)}</span><span class="rf-list-sub rf-num">${U.esc(bits.join(' · '))}</span></span><span class="rf-list-detail rf-num">${U.esc(money(e.c, { exact: true }))}</span></div></li>`;
    }).join('');
    // The months before this one, newest first (the last six).
    const cur = SP().monthOf(day);
    const earlier = Object.keys(sp.months).filter((k) => k < cur && sp.months[k].c > 0).sort().reverse().slice(0, 6).map((k) => `<li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(`${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`)}</span><span class="rf-list-sub">${U.esc(U.plural(sp.months[k].n, 'request'))}</span></span><span class="rf-list-detail rf-num">${U.esc(money(sp.months[k].c, { exact: true }))}</span></div></li>`).join('');
    if (!month.n && !recent && !earlier) return `<h2 class="sec-title t-title-3">Usage</h2><div class="section"><div class="card cl-empty"><p class="t-callout rf-muted">Nothing yet this month. Each request's cost shows up here.</p></div></div>`;
    return `<h2 class="sec-title t-title-3">Usage</h2>
      <div class="section">
        ${chart}
        ${byFeature ? `<h3 class="rf-list-header">${U.esc(monthName(day))} by feature</h3><ul class="rf-list">${byFeature}</ul>` : ''}
        ${byModel ? `<h3 class="rf-list-header">${U.esc(monthName(day))} by model</h3><ul class="rf-list">${byModel}</ul>` : ''}
        ${recent ? `<h3 class="rf-list-header">Latest</h3><ul class="rf-list">${recent}</ul>` : ''}
        ${earlier ? `<h3 class="rf-list-header">Earlier months</h3><ul class="rf-list">${earlier}</ul>` : ''}
        <p class="rf-list-footer">Worked out from the tokens Anthropic reports, at list prices. Your bill in the Claude Console is the final word.</p>
      </div>`;
  }
  U.screens.claude = {
    render(S, day) {
      SP().ensure(S);
      const m = SP().model(S), lv = SP().level(S);
      const L = SP().limits(S, day);
      const left = questionsLeft(S, day);
      const hasKey = AI() && AI().hasKey();
      const does = [
        U.act.askCoach ? U.row({ key: 'ask', icon: 'chat', tone: 'violet', title: 'Ask the coach', sub: `Your training, health or food · ${about(S, 'chat')} a question`, act: 'askCoach', chevron: true }) : '',
        U.act.cpBuild ? U.row({ key: 'build', icon: 'wand', tone: 'indigo', title: 'Build me a plan', sub: `Claude builds a plan around you · ${about(S, 'build')}`, act: 'cpBuild', chevron: true }) : '',
        U.act.reviewPlan ? U.row({ key: 'review', icon: 'check-circle', tone: 'teal', title: 'Check my plan', sub: `Claude suggests changes to your week · ${about(S, 'review')}`, act: 'reviewPlan', chevron: true }) : '',
      ].join('');
      return `${U.navbar('Claude', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Claude</h1>
        <p class="lt-sub t-callout rf-muted">${hasKey ? 'Your coach, on your own Anthropic API key. Pick how it thinks and what it may spend.' : 'Add your API key in Settings, under AI coach, to use Claude.'}</p>
        <div class="section">
          <ul class="rf-list" data-key="cl-model">
            ${U.row({ key: 'model', icon: 'sparkle', tone: TONE[m.id] || 'violet', title: U.esc(m.name), sub: U.esc(m.note || 'An older model, still available'), act: 'claudeModel', detail: 'Change', chevron: true })}
            ${U.row({ key: 'think', icon: 'lightbulb', tone: 'amber', title: 'Thinking', sub: U.esc(SP().LEVEL_NOTES[lv]), act: 'claudeModel', detail: U.esc(SP().LEVEL_NAMES[lv]), chevron: true })}
          </ul>
          <p class="rf-list-footer">${U.esc(`${(() => { const a = about(S, 'chat'); return a[0].toUpperCase() + a.slice(1); })()} a question and ${about(S, 'report')} a weekly report with these.`)}</p>
        </div>
        <h2 class="sec-title t-title-3">Spending</h2>
        <div class="section">
          <div class="card cl-meters" data-key="cl-meters">
            ${meter('Today', L.today.spent, L.today.limit, left != null ? `about ${U.num(left)} ${left === 1 ? 'question' : 'questions'} left` : '')}
            ${meter(monthName(day), L.month.spent, L.month.limit, `${U.plural(L.month.daysLeft, 'day')} to go`)}
          </div>
          <ul class="rf-list" data-key="cl-limits">
            ${U.row({ key: 'monthly', icon: 'calendar', tone: 'indigo', title: 'Monthly budget', act: 'claudeBudget', arg: 'monthly', detail: U.esc(limitText(S, day, 'monthly')), chevron: true })}
            ${U.row({ key: 'daily', icon: 'sun', tone: 'amber', title: 'Daily limit', act: 'claudeBudget', arg: 'daily', detail: U.esc(limitText(S, day, 'daily')), chevron: true })}
            ${U.row({ key: 'request', icon: 'shield', tone: 'teal', title: 'Most for one request', act: 'claudeBudget', arg: 'request', detail: U.esc(limitText(S, day, 'request')), chevron: true })}
          </ul>
          <p class="rf-list-footer">Hard limits: Claude isn't asked anything that could go over them. They count only this phone's spending. To cap your key everywhere, set a spend limit in the Claude Console, under Settings, Limits.</p>
          <button type="button" class="rf-btn cl-console" data-variant="plain" data-act="claudeConsole">${U.icon('arrow-up-right')}Open the Console's limits</button>
        </div>
        ${usage(S, day)}
        ${does ? `<h2 class="sec-title t-title-3">What Claude does here</h2><div class="section"><ul class="rf-list">${does}</ul></div>` : ''}`;
    },
  };
  U.act.claudeConsole = () => { if (GH.platform) GH.platform.openUrl(LIMITS_URL); };

  /* ---------------------------------------------------------------- right after a key */
  // A model, how much it thinks, and a monthly budget (the defaults picked, or what they had), then
  // Done.
  U.claudeSetup = () => new Promise((resolve) => {
    const S = U.S;
    SP().ensure(S);
    const day = U.today();
    const body = () => {
      const b = SP().budget(S);
      const opts = PRESETS.monthly.map((v) => [String(v), SP().money(SP().micro(v), { whole: true })]);
      return `<div class="sheet-pad cl-setup">
        <p class="t-callout rf-muted">Pick a model, how much it thinks and a monthly budget. Change them any time in Settings, under AI coach.</p>
        <h3 class="rf-list-header">Model</h3>
        <ul class="rf-list" role="radiogroup" aria-label="Model">${SP().MODELS.filter((x) => !x.older).map((x) => modelRow(S, x)).join('')}</ul>
        <h3 class="rf-list-header">Thinking</h3>
        ${U.choice('clSetupThink', SP().levelsFor(SP().model(S)).map((lv) => [lv, SP().LEVEL_NAMES[lv]]), SP().level(S) === 'off' && !SP().model(S).off ? 'low' : SP().level(S), 'Thinking', ' data-on="claudeSetupThink" data-repick')}
        <p class="t-footnote cl-amt-line">${U.esc(SP().LEVEL_NOTES[SP().level(S)])}. ${U.esc(`About ${each(S, 'chat')} a question.`)}</p>
        <h3 class="rf-list-header">Monthly budget</h3>
        ${U.choice('clSetupBudget', opts, b.monthly != null ? String(b.monthly) : '', 'Monthly budget', ' data-on="claudeSetupBudget" data-repick')}
        <p class="t-footnote cl-amt-line">${U.esc(amountLine(S, day, 'monthly', b.monthly))} Claude isn't asked anything that could go over it.</p>
      </div>`;
    };
    const ctl = U.sheet({ title: 'Set up Claude', size: 'full', cls: 'cl-sheet', body: body(), action: { label: 'Done', act: 'claudeSetupDone' }, onClose: () => resolve() });
    const draw = () => { if (!ctl.closed) ctl.update(body()); };
    U.act.claudePickModel = (el) => {
      const m = SP().byId(el.dataset.arg);
      if (!m) return;
      S.ai.claude.model = m.id;
      if (S.ai.claude.think === 'off' && !m.off) S.ai.claude.think = 'low';
      U.save(true);
      U.haptic('select');
      draw();
    };
    U.on.claudeSetupThink = (x, ev, v) => {
      if (!SP().LEVEL_NAMES[v]) return;
      S.ai.claude.think = v;
      U.save(true);
      U.haptic('select');
      draw();
    };
    U.on.claudeSetupBudget = (x, ev, v) => {
      const n = parseAmount(v);
      if (n == null) return;
      S.ai.budget = Object.assign(SP().budget(S), { monthly: n });
      U.save(true);
      U.haptic('select');
      draw();
    };
    U.act.claudeSetupDone = () => { U.haptic('success'); ctl.close('ok'); };
  });
})(typeof window !== 'undefined' ? window : globalThis);
