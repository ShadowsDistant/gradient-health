/* Health: insights (the AI coach's weekly report first when it's on), today's numbers, trends,
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
    return `<div class="card insight" data-tone="${x.tone}">
      <div class="ins-head"><span class="rf-list-icon" data-tone="${TONE_TILE[x.tone] || 'sky'}">${U.icon(x.icon)}</span><span class="ins-word t-caption" data-tone="${tone}">${U.icon(ic, 'sm')}${word}</span>
        <button type="button" class="rf-btn ins-x" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Dismiss for 30 days" data-act="dismissInsight" data-arg="${U.esc(x.id)}">${U.icon('close')}</button></div>
      <p class="t-headline">${U.esc(x.title)}</p>
      <p class="t-callout">${U.esc(x.body)}</p>
      <p class="t-footnote rf-muted">Based on ${U.esc(x.evidence)}</p>
      ${x.action ? `<button type="button" class="rf-btn" data-size="sm" data-act="insightGo" data-arg="${U.esc(x.action.route)}">${U.esc(x.action.label)}</button>` : ''}
    </div>`;
  }
  function aiCard(S, day) {
    if (!AI()) return '';
    if (!S.ai.enabled) return '';
    if (!AI().hasKey()) return `<div class="card ai-card"><div class="ai-head">${U.icon('sparkle')}<span class="t-headline">AI coach</span></div><p class="t-callout rf-muted">Add your Anthropic API key to get a weekly report and ask questions.</p><button type="button" class="rf-btn" data-act="openCoachSettings">Set up</button></div>`;
    const rep = AI().reportFor(S, day);
    let body;
    if (ai.busy === 'report') body = '<div class="ai-busy"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout rf-muted">Writing this week\'s report…</span></div>';
    else if (rep) {
      const d = rep.data;
      const list = (title, arr, tone) => (arr.length ? `<p class="t-subhead ai-sub" data-tone="${tone}">${title}</p><ul class="plain-list">${arr.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>` : '');
      body = `<p class="t-headline">${U.esc(d.headline)}</p>
        ${list('Wins', d.wins, 'positive')}${list('Keep an eye on', d.watch, 'caution')}${list('Focus next week', d.focus, 'accent')}
        ${d.ask_me.length ? `<div class="ob-chips ai-asks">${d.ask_me.map((q) => `<button type="button" class="rf-chip" data-act="askPreset" data-arg="${U.esc(q)}">${U.esc(q)}</button>`).join('')}</div>` : ''}
        <p class="t-footnote rf-muted">Written ${U.esc(U.fmtDay(rep.day))}${rep.model ? ` by ${U.esc(rep.model)}` : ''}. Not medical advice.</p>`;
    } else body = '<p class="t-callout rf-muted">Your report for this week isn\'t written yet.</p>';
    const err = ai.error ? `<div class="notice" data-tone="critical">${U.icon('alert')}<span>${U.esc(ai.error)}</span></div>` : '';
    return `<div class="card ai-card">
      <div class="ai-head">${U.icon('sparkle')}<span class="t-headline">Weekly report</span><span class="rf-spacer"></span>
        <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="aiReport"${ai.busy ? ' aria-disabled="true"' : ''}>${rep ? 'Refresh' : 'Write it'}</button></div>
      ${body}${err}
      <button type="button" class="rf-btn ai-ask" data-variant="soft" data-act="askCoach">${U.icon('chat')}Ask the coach</button>
    </div>`;
  }
  async function writeReport(auto) {
    const S = U.S, day = U.today();
    if (ai.busy || !AI() || !AI().hasKey()) return;
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
  U.act.dismissInsight = (el) => { GH.insights.dismiss(U.S, el.dataset.arg, U.today()); U.commit(); U.toast('Hidden for 30 days', 'neutral'); };
  U.act.insightGo = (el) => U.go(el.dataset.arg);

  /* ---------------------------------------------------------------- chat */
  let chat = null;
  function bubbles(S) {
    const msgs = (S.ai.chat || []).slice(-12);
    if (!msgs.length) return '<p class="t-callout rf-muted chat-empty">Ask about your sleep, steps, training or what to focus on. The coach sees the same summary as the weekly report.</p>';
    return msgs.map((m) => `<div class="bubble ${m.role === 'user' ? 'me' : 'coach'}">${U.esc(m.text)}</div>`).join('');
  }
  U.act.askCoach = (el, ev, preset) => {
    const S = U.S;
    if (!AI() || !AI().hasKey()) { U.open('settings', 'coach'); return; }
    chat = U.sheet({
      title: 'Ask the coach', detents: 'large', detent: 'large', cls: 'chat-sheet',
      body: `<div class="chat-log" id="chatLog">${bubbles(S)}</div>
        <div class="chat-compose"><textarea class="rf-input" id="askQ" rows="2" maxlength="1000" placeholder="Ask a question" aria-label="Your question">${U.esc(preset || '')}</textarea>
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-shape="circle" aria-label="Send" data-act="askSend">${U.icon('send')}</button></div>
        <p class="t-footnote rf-muted chat-foot">The coach sees a summary without your name, not your raw data. Not medical advice. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="askClear">Clear chat</button></p>`,
      onClose: () => { if (AI()) AI().stop(); chat = null; },
      after: (c) => { const log = c.el.querySelector('#chatLog'); if (log) log.scrollTop = log.scrollHeight; },
    });
  };
  U.act.askPreset = (el) => U.act.askCoach(el, null, el.dataset.arg);
  U.act.askClear = () => { AI().clearChat(U.S); U.save(); const log = document.getElementById('chatLog'); if (log) log.innerHTML = bubbles(U.S); };
  U.act.askSend = async (btn) => {
    const S = U.S;
    const q = document.getElementById('askQ');
    const log = document.getElementById('chatLog');
    if (!q || !log || ai.busy) return;
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    const empty = log.querySelector('.chat-empty'); if (empty) empty.remove();
    log.insertAdjacentHTML('beforeend', `<div class="bubble me">${U.esc(text)}</div><div class="bubble coach is-typing"><span class="rf-spinner" data-size="sm"><i></i></span></div>`);
    const out = log.lastElementChild;
    log.scrollTop = log.scrollHeight;
    btn.setAttribute('aria-busy', 'true');
    ai.busy = 'chat';
    try {
      await AI().ask(S, U.today(), text, (delta, snapshot) => { out.classList.remove('is-typing'); out.textContent = snapshot; log.scrollTop = log.scrollHeight; });
      out.classList.remove('is-typing');
      U.save(true);
    } catch (e) {
      out.classList.remove('is-typing');
      out.classList.add('is-error');
      out.textContent = e.message || 'Something went wrong.';
    } finally {
      ai.busy = false;
      btn.removeAttribute('aria-busy');
    }
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
    return `<div class="stat-grid">
      ${tile('moon', 'indigo', 'Sleep', t.sleepMin != null ? U.esc(U.fmtMin(t.sleepMin)) : '–', t.bed ? `asleep ${U.fmtClock(t.bed)}` : t.sleepFromChip ? 'from your check-in' : 'no data', t.sleepMin == null ? 'logSleep' : null)}
      ${tile('navigate', 'green', 'Steps', t.steps != null ? U.num(t.steps) : '–', bs.n >= 5 ? `usual ${U.num(bs.avg)}` : '&nbsp;')}
      ${tile('heart', 'rose', 'Resting HR', t.rhr != null ? `${Math.round(t.rhr)} <small>bpm</small>` : '–', br.n >= 5 ? `usual ${Math.round(br.avg)}` : 'no data')}
      ${tile('wave', 'violet', 'HRV', t.hrv != null ? `${Math.round(t.hrv)} <small>ms</small>` : '–', bh.n >= 5 ? `usual ${Math.round(bh.avg)}` : 'no data')}
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
    const text = !app ? 'Health Connect works in the Android app' : HC_TEXT[st] || st;
    const sync = S.health.lastSync ? `Last read ${U.fmtClock(S.health.lastSync)}${B().dayOf(S.health.lastSync, U.rollHour()) !== U.today() ? `, ${U.fmtDay(B().dayOf(S.health.lastSync, U.rollHour()), false)}` : ''}` : 'Not read yet';
    const errs = (S.health.errors || []).length ? `<p class="t-footnote rf-muted">Couldn't read: ${U.esc(S.health.errors.join(', '))}.</p>` : '';
    const buttons = !app || st === 'unsupported' || st === 'unavailable' ? ''
      : H().connected(st) ? `<div class="btn-row"><button type="button" class="rf-btn" data-act="hcSync">${U.icon('refresh')}Read now</button><button type="button" class="rf-btn" data-variant="plain" data-act="hcManage">Permissions</button></div>`
        : '<button type="button" class="rf-btn" data-variant="filled" data-act="hcConnect">Connect Health Connect</button>';
    return `<div class="card">
      <div class="row-between"><span class="t-headline">Health Connect</span>${U.badge(H().connected(st) ? 'On' : 'Off', H().connected(st) ? 'positive' : 'neutral')}</div>
      <p class="t-callout rf-muted">${U.esc(text)}${H().connected(st) ? ` · ${U.esc(sync)}` : ''}</p>
      <p class="t-footnote rf-muted">Reads sleep, steps, weight, height, body fat, resting heart rate, HRV and workouts. Never writes. <button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="openPrivacy">Privacy</button></p>
      ${errs}${buttons}</div>`;
  }
  U.act.hcSync = async (btn) => { btn.setAttribute('aria-busy', 'true'); const r = await U.syncHealth(true); btn.removeAttribute('aria-busy'); if (r && !r.ok) U.toast('Couldn\'t read Health Connect', 'caution', r.error === 'timeout' ? 'It took too long. Try again.' : undefined); else if (r) U.toast('Health data updated', 'positive'); };
  U.act.hcManage = () => H().openSettings();
  U.act.hcConnect = async () => {
    const st = await H().request();
    U.S.health.status = st;
    if (H().connected(st)) { await U.syncHealth(true); U.toast('Health Connect connected', 'positive'); }
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
      return `${U.navbar('Health', connected ? U.glassBtn('refresh', 'Read health data now', 'hcSync') : '')}
        <h1 class="rf-large-title">Health</h1>
        <div class="section">
          ${aiCard(S, day)}
          ${ins.length ? ins.map(insightCard).join('') : '<div class="card"><p class="t-callout rf-muted">Insights show up here after a few days of data: sleep, steps, weight, workouts and check-ins.</p></div>'}
          ${AI() && !S.ai.enabled ? `<ul class="rf-list">${U.row({ icon: 'sparkle', tone: 'violet', title: 'AI coach', sub: 'A weekly report and answers about your data, with your own API key', act: 'openCoachSettings', chevron: true })}</ul>` : ''}
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
