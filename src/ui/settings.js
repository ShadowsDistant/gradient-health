/* Settings, the coach set-up, backups and the privacy page. */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const AI = () => GH.ai;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------------------------------------------------------------- screen */
  U.screens.settings = {
    render(S) {
      const p = S.profile;
      const pr = p.prefs;
      const st = H().status();
      const app = GH.platform && GH.platform.isApp();
      const on = H().connected(st);
      const hcDetail = !app ? 'Android app only' : on ? 'On' : st === 'unsupported' ? 'Needs Android 14' : st === 'unavailable' ? 'Unavailable' : 'Off';
      const hasKey = AI() && AI().hasKey();
      const claude = S.ai.mode === 'api';
      const eqCount = (p.equipment.db || []).length + (p.equipment.kb || []).length + ['ball', 'band', 'bar', 'table'].filter((k) => p.equipment[k]).length;
      const canWrite = on && H().canWrite && H().canWrite();
      const ver = (GH.platform && GH.platform.appVersion()) || GH.VERSION || 'web';
      return `${U.navbar('Settings', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">Settings</h1>
        <div class="section">
          <h3 class="rf-list-header">Your plan</h3>
          <ul class="rf-list">
            ${U.row({ icon: 'pencil', tone: 'indigo', title: 'Update my answers', sub: 'Goals, experience, body check, food, sleep', act: 'editAnswers', chevron: true })}
            ${U.row({ icon: 'calendar', tone: 'sky', title: 'Days and time', detail: `${p.days} days · ${p.minutes} min`, act: 'daysSheet', chevron: true })}
            ${U.row({ icon: 'bag', tone: 'amber', title: 'Equipment', detail: eqCount ? U.plural(eqCount, 'item') : 'Bodyweight', act: 'editEquipment', chevron: true })}
            ${U.row({ icon: 'timer', tone: 'green', title: 'Retake the baseline test', sub: 'Push-ups, plank, curls', act: 'baselineSheet', chevron: true })}
          </ul>
          <h3 class="rf-list-header">Health data</h3>
          <ul class="rf-list">
            ${U.row({ icon: 'heart', tone: 'rose', title: 'Health Connect', detail: hcDetail, act: app && !['unsupported', 'unavailable'].includes(st) ? (on ? 'hcManage' : 'hcConnect') : null, chevron: app })}
            ${on ? U.sw('Save workouts to Health Connect', !!(S.health.write !== false && canWrite), 'data-on="hcWriteToggle"', canWrite ? 'Other apps see your Gradient workouts' : 'Needs the Exercise permission') : ''}
            <li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">Units</span></span>${U.seg('setUnits', [['lb', 'lb'], ['kg', 'kg']], p.units, 'Units', ' data-on="setUnits" data-size="sm"')}</div></li>
          </ul>
          <h3 class="rf-list-header" id="coach">Coach</h3>
          <ul class="rf-list">
            <li><div class="rf-list-row set-coach"><span class="rf-list-text"><span class="rf-list-title">Coach</span><span class="rf-list-subtitle">Weekly report and questions</span></span>${U.seg('setCoach', [['local', 'Built-in'], ['api', 'Claude']], claude ? 'api' : 'local', 'Coach', ' data-on="setCoachMode" data-size="sm"')}</div></li>
            ${claude ? `${hasKey ? U.row({ icon: 'lock', tone: 'green', title: 'API key saved on this phone', sub: S.ai.model && S.ai.model.name ? `Using ${U.esc(S.ai.model.name)}` : 'The model is picked on first use', act: 'keySheet', detail: 'Change', chevron: true }) : U.row({ icon: 'lock', tone: 'amber', title: 'Add your API key', sub: 'From the Claude Console, starts with sk-ant-', act: 'keySheet', chevron: true })}
              ${hasKey ? U.row({ icon: 'trash', tone: 'rose', title: 'Delete key', act: 'deleteKey' }) : ''}` : ''}
            ${U.row({ icon: 'share', tone: 'violet', title: 'Ask in the Claude app', sub: 'Uses your own Claude plan, no key needed', act: 'askClaudeApp', chevron: true })}
            ${U.row({ icon: 'eye', tone: 'sky', title: 'What gets sent', sub: 'The exact summary Claude sees', act: 'previewSheet', chevron: true })}
          </ul>
          <p class="rf-list-footer">${claude ? 'Claude mode uses your own Anthropic API key and its usage costs. The key stays on this phone and is never in backups.' : 'The built-in coach works offline from your own numbers. It isn\'t an AI model, so it sticks to common questions.'} Anything sent to Claude is a summary with no name, dates or IDs, and only when you ask.</p>
          <h3 class="rf-list-header">Workout</h3>
          <ul class="rf-list">
            ${U.sw('Sound', pr.sound !== false, 'data-on="setPref" data-k="sound"')}
            ${U.sw('Vibration', pr.vibrate !== false, 'data-on="setPref" data-k="vibrate"', 'Buzzes for timers and the end of rest')}
            ${U.sw('Haptic feedback', pr.haptics !== false, 'data-on="setPref" data-k="haptics"', 'Light taps when you press buttons and switches')}
            ${U.sw('Supersets', pr.supersets !== false, 'data-on="setPref" data-k="supersets"', 'Pair exercises that don\'t share muscles')}
            <li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">Rest</span><span class="rf-list-subtitle">Auto: 90 s after big moves, 60 s after small ones and in supersets</span></span>${U.seg('setRest', [['auto', 'Auto'], ['60', '60 s'], ['90', '90 s']], String(pr.rest), 'Rest between sets', ' data-on="setRest" data-size="sm"')}</div></li>
          </ul>
          <h3 class="rf-list-header">Look</h3>
          <ul class="rf-list">
            <li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">Theme</span></span>${U.seg('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], pr.theme || 'system', 'Theme', ' data-on="setTheme" data-size="sm"')}</div></li>
            ${U.sw('Increase contrast', !!pr.contrast, 'data-on="setPref" data-k="contrast"')}
            <li><div class="rf-list-row set-slider"><span class="rf-list-text"><span class="rf-list-title">Glass</span><span class="rf-list-subtitle">Clear to frosted</span></span><div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="0" max="1" step="0.05" value="${pr.density == null ? 0.5 : pr.density}" aria-label="Glass density" data-on="setDensity"></div></div></div></li>
          </ul>
          <h3 class="rf-list-header">Your data</h3>
          <ul class="rf-list">
            ${U.row({ icon: 'copy', tone: 'teal', title: 'Copy my data', sub: 'Everything except the API key, as text to keep somewhere safe', act: 'exportData' })}
            ${U.row({ icon: 'download', tone: 'indigo', title: 'Restore from a copy', act: 'restoreSheet', chevron: true })}
            ${U.row({ icon: 'trash', tone: 'rose', title: 'Reset everything', act: 'resetAll' })}
          </ul>
          <h3 class="rf-list-header">About</h3>
          <ul class="rf-list">
            ${U.row({ icon: 'library', tone: 'violet', title: 'How it works', sub: 'The research behind every rule', act: 'openScience', chevron: true })}
            ${U.row({ icon: 'sparkle', tone: 'amber', title: 'What\'s new', act: 'openWhatsNew', chevron: true })}
            ${U.row({ icon: 'lock', tone: 'green', title: 'Privacy', act: 'openPrivacyView', chevron: true })}
            ${U.row({ icon: 'info', tone: 'sky', title: 'Version', detail: U.esc(ver) })}
          </ul>
          <p class="rf-list-footer">Fonts: Host Grotesk and Geist Mono, SIL Open Font License. Not medical advice: check with a doctor before starting if you have a condition or an injury.</p>
        </div>`;
    },
    focus(root, arg) {
      if (arg === 'coach') { const el = root.querySelector('#coach'); if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: U.reduced() ? 'auto' : 'smooth' }), 60); }
    },
  };

  U.act.editAnswers = () => U.editAnswers();
  U.act.editEquipment = () => U.editAnswers('equipment');
  U.act.openPrivacyView = () => U.open('privacy');
  U.on.setPref = (el, ev, v) => {
    const k = el.dataset.k;
    U.S.profile.prefs[k] = !!v;
    U.applyPrefs();
    U.save();
    if (k === 'haptics' && v) U.haptic('toggleOn');
    if (k === 'supersets') U.render();
  };
  U.on.setRest = (el, ev, v) => { U.S.profile.prefs.rest = v === 'auto' ? 'auto' : Number(v); U.save(); };
  U.on.setTheme = (el, ev, v) => { U.S.profile.prefs.theme = v; U.applyPrefs(); U.save(); };
  U.on.setDensity = (el, ev, v) => { U.S.profile.prefs.density = v; U.applyPrefs(); U.save(); };
  U.on.setUnits = (el, ev, v) => { convertUnits(U.S, v); U.commit(); };
  // Switching units converts the equipment weights to the nearest real sizes.
  function convertUnits(S, to) {
    if (S.profile.units === to) return;
    const f = to === 'kg' ? 1 / B().LB_PER_KG : B().LB_PER_KG;
    const sizes = { db: { lb: [2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60], kg: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 25, 27.5, 30] }, kb: { lb: [10, 15, 18, 20, 26, 35, 44, 53, 62, 70], kg: [4, 6, 8, 10, 12, 16, 20, 24, 28, 32] } };
    for (const k of ['db', 'kb']) {
      const list = sizes[k][to];
      S.profile.equipment[k] = [...new Set((S.profile.equipment[k] || []).map((x) => list.reduce((a, c) => (Math.abs(c - x * f) < Math.abs(a - x * f) ? c : a), list[0])))].sort((a, b) => a - b);
    }
    if (S.profile.equipment.ballLb) S.profile.equipment.ballLb = Math.round(S.profile.equipment.ballLb * f);
    S.profile.units = to;
  }

  /* ---------------------------------------------------------------- days and time */
  U.act.daysSheet = () => {
    const p = U.S.profile;
    const d = { days: p.days, weekdays: Array.isArray(p.weekdays) ? p.weekdays.slice() : [], minutes: p.minutes, lightDays: p.lightDays !== false };
    const body = () => `<div class="sheet-pad">
        <p class="t-headline">Workouts a week</p><div class="ob-center">${U.stepper('dsDays', d.days, 2, 6, 'Workouts a week', 'data-on="dsDays"')}</div>
        <p class="t-headline">Which days (optional)</p><div class="ob-chips">${DAYS.map((n, i) => `<button type="button" class="rf-chip" aria-pressed="${d.weekdays.includes(i)}" data-on="dsWd" data-v="${i}"><span class="rf-chip-check" data-icon="check"></span>${n}</button>`).join('')}</div>
        <p class="t-footnote rf-muted">Pick ${d.days} days to use your own, or none for the default spread.</p>
        <p class="t-headline">Minutes per workout: <span id="dsMinOut" class="rf-num">${d.minutes}</span></p>
        <div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="10" max="60" step="5" value="${d.minutes}" aria-label="Minutes per workout" data-on="dsMin" id="dsMin"></div></div>
        <ul class="rf-list sheet-gap">${U.sw('Light days', d.lightDays, 'data-on="dsLight"', 'Walk and mobility on off days')}</ul>
        <p class="t-footnote rf-muted">If this week has started, new days begin next Monday. Time changes apply from today.</p>
      </div>`;
    const ctl = U.sheet({ title: 'Days and time', detents: 'large', detent: 'large', body: body(), action: { label: 'Save', act: 'daysSave' } });
    ctl.el.addEventListener('input', (e) => { if (e.target.id === 'dsMin') { const o = ctl.el.querySelector('#dsMinOut'); if (o) o.textContent = e.target.value; } });
    U.on.dsDays = (el, ev, v) => { d.days = Math.max(2, Math.min(6, Math.round(v))); };
    U.on.dsWd = (el, ev, v) => { const i = Number(el.dataset.v); d.weekdays = d.weekdays.filter((x) => x !== i); if (v) d.weekdays.push(i); };
    U.on.dsMin = (el, ev, v) => { d.minutes = v; };
    U.on.dsLight = (el, ev, v) => { d.lightDays = !!v; };
    U.act.daysSave = () => {
      const S = U.S;
      const res = B().updateSettings(S, U.today(), { days: d.days, weekdays: d.weekdays.length === d.days ? d.weekdays.slice().sort((a, b) => a - b) : null, minutes: d.minutes, lightDays: d.lightDays });
      ctl.close('ok');
      U.commit();
      U.toast('Saved', 'positive', res && res.shape && res.from > U.today() ? 'New days start next Monday.' : undefined);
    };
  };

  /* ---------------------------------------------------------------- baseline */
  U.act.baselineSheet = () => {
    const eq = U.S.profile.equipment;
    const curls = (eq.db && eq.db.length) || eq.band;
    U.sheet({
      title: 'Baseline test', detents: 'large', detent: 'large',
      body: `<div class="sheet-pad ob-fields">
        <div class="rf-field"><label class="rf-field-label" for="bPush">Push-ups in a row</label><div class="rf-field-control"><input class="rf-input" id="bPush" type="number" inputmode="numeric" placeholder="Leave blank to skip"></div></div>
        <ul class="rf-list">${U.sw('On my knees', false, 'id="bKnees"')}</ul>
        <div class="rf-field"><label class="rf-field-label" for="bPlank">Plank hold (seconds)</label><div class="rf-field-control"><input class="rf-input" id="bPlank" type="number" inputmode="numeric" placeholder="Leave blank to skip"></div></div>
        ${curls ? '<div class="ob-row2"><div class="rf-field"><label class="rf-field-label" for="bCL">Curls, left</label><div class="rf-field-control"><input class="rf-input" id="bCL" type="number" inputmode="numeric"></div></div><div class="rf-field"><label class="rf-field-label" for="bCR">Curls, right</label><div class="rf-field-control"><input class="rf-input" id="bCR" type="number" inputmode="numeric"></div></div></div>' : ''}
        <p class="t-footnote rf-muted">Results reset those exercises to a fitting level. The curls also count as a left vs right test.</p></div>`,
      action: { label: 'Save', act: 'baselineSave' },
    });
  };
  U.act.baselineSave = () => {
    const num = (id) => { const el = document.getElementById(id); const v = el ? parseInt(el.value, 10) : NaN; return isFinite(v) && v >= 0 ? v : null; };
    const b = {};
    const push = num('bPush');
    if (push != null) { b.pushups = push; b.knees = !!(document.getElementById('bKnees') || {}).checked; }
    const plank = num('bPlank');
    if (plank) b.plankSec = plank;
    const l = num('bCL'), r = num('bCR');
    if (l && r) { b.curlL = l; b.curlR = r; }
    const t = U.topSheet(); if (t) t.close('ok');
    if (!Object.keys(b).length) return;
    B().applyBaseline(U.S, b, U.today());
    U.commit();
    U.toast('Baseline saved', 'positive', 'Your starting levels are updated.');
  };

  /* ---------------------------------------------------------------- coach */
  U.on.setCoachMode = (el, ev, v) => {
    U.S.ai.mode = v === 'api' ? 'api' : 'local';
    U.S.ai.enabled = U.S.ai.mode === 'api';
    U.save();
    setTimeout(() => U.render(), 220);
    if (U.S.ai.mode === 'api' && AI() && !AI().hasKey()) setTimeout(() => U.act.keySheet(), 400);
  };
  U.act.keySheet = () => {
    U.sheet({
      title: 'Anthropic API key', detents: 'medium large', detent: 'medium',
      body: `<div class="sheet-pad">
        <div class="rf-field"><label class="rf-field-label" for="apiKey">API key</label><div class="rf-field-control"><input class="rf-input" id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"></div>
          <p class="rf-field-hint">Stored only on this phone, never in backups, never shown again.</p><p class="rf-field-error" id="keyErr" hidden></p></div>
        <button type="button" class="rf-btn" data-variant="plain" data-act="getKey">${U.icon('arrow-up-right')}Get a key in the Claude Console</button>
      </div>`,
      action: { label: 'Save', act: 'keySave' },
    });
  };
  U.act.getKey = () => GH.platform.openUrl(AI().KEY_URL);
  U.act.keySave = () => {
    const input = document.getElementById('apiKey');
    const err = document.getElementById('keyErr');
    const res = AI().setKey(input ? input.value : '');
    if (!res.ok) { if (err) { err.hidden = false; err.textContent = res.error || 'Couldn\'t save the key.'; } return; }
    if (input) input.value = '';
    U.S.ai.enabled = true;
    U.S.ai.mode = 'api';
    U.S.ai.model = null;
    U.save(true);
    const t = U.topSheet(); if (t) t.close('ok');
    U.render();
    U.toast('Key saved', 'positive', 'Claude writes your weekly report when you open Health.');
  };
  U.act.deleteKey = async () => {
    if (!(await U.confirm('Delete the API key?', 'The coach stops working until you add a key again. Reports you already have stay.', 'Delete', 'critical', 'trash'))) return;
    AI().deleteKey(U.S);
    U.commit();
  };
  U.act.previewSheet = () => {
    U.sheet({
      title: 'What gets sent', detents: 'large', detent: 'large',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">When you ask Claude, this summary goes along with your question: through your API key in Claude mode, or into the Claude app when you ask there. No name, email, dates or device IDs. The built-in coach sends nothing.</p></div><pre class="preview">${U.esc(AI().preview(U.S, U.today()))}</pre>`,
    });
  };

  /* ---------------------------------------------------------------- data */
  U.act.exportData = async () => {
    const txt = GH.store.exportJson(U.S);
    const ok = await GH.platform.copy(txt);
    if (ok) U.toast('Copied', 'positive', 'Paste it into a note or an email to yourself.');
    else U.sheet({ title: 'Your data', detents: 'large', detent: 'large', body: `<div class="sheet-pad"><p class="t-callout rf-muted">Copying didn't work. Select all of this and copy it.</p></div><textarea class="rf-input preview" readonly>${U.esc(txt)}</textarea>` });
  };
  U.act.restoreSheet = () => U.sheet({
    title: 'Restore', detents: 'large', detent: 'large',
    body: `<div class="sheet-pad"><p class="t-callout rf-muted">Paste the text from Copy my data. It replaces everything in the app now.</p></div>
      <div class="sheet-pad"><textarea class="rf-input preview" id="restoreTxt" rows="8" aria-label="Backup text" placeholder="{&quot;app&quot;:&quot;gradient-health&quot;, …}"></textarea><p class="rf-field-error" id="restoreErr" hidden></p></div>`,
    action: { label: 'Check', act: 'restoreCheck' },
  });
  U.act.restoreCheck = async () => {
    const txt = (document.getElementById('restoreTxt') || {}).value || '';
    const res = GH.store.importJson(txt);
    const err = document.getElementById('restoreErr');
    if (!res.ok) { if (err) { err.hidden = false; err.textContent = res.error; } return; }
    const since = res.since != null ? ` from ${B().fmtDay(res.since)}` : '';
    const ok = await U.confirm('Replace everything with this backup?', `It has ${U.plural(res.workouts, 'workout')}${since}. What's in the app now will be gone.`, 'Replace', 'critical');
    if (!ok) return;
    const t = U.topSheet(); if (t) t.close('ok');
    U.S = res.state;
    U.S.active = null;
    GH.store.save(U.S);
    U.applyPrefs();
    U.route = { tab: 'today', view: null, arg: null };
    U.render();
    U.toast('Restored', 'positive');
  };
  U.act.resetAll = async () => {
    const one = await U.confirm('Reset Gradient?', 'Your plan, history, health logs and the AI key are deleted from this phone.', 'Continue', 'critical', 'trash');
    if (!one) return;
    const two = await U.dialog({
      title: 'This can\'t be undone', message: 'Copy your data first if you might want it back.', icon: 'alert', tone: 'critical',
      actions: [{ label: 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label: 'Copy my data', value: 'copy', variant: 'gray' }, { label: 'Delete everything', value: 'delete', variant: 'filled', tone: 'critical' }],
    });
    if (two === 'copy') { await U.act.exportData(); return; }
    if (two !== 'delete') return;
    if (AI()) AI().deleteKey(U.S);
    GH.store.clear();
    U.S = null;
    G.location.hash = '';
    U.route = { tab: 'today', view: null, arg: null };
    U.showOnboarding();
  };

  /* ---------------------------------------------------------------- privacy */
  U.privacyHtml = () => `
    <div class="card prose">
      <h3 class="t-title-3">The short version</h3>
      <p class="t-body">No account, no ads, no analytics. Your data stays on this phone. The only thing that ever leaves it is a summary you choose to send to Claude.</p>
      <h3 class="t-title-3">What Gradient reads</h3>
      <p class="t-body">With your permission, from Health Connect: steps, sleep, weight, height, body fat, resting heart rate, heart rate variability and workouts from other apps. You can turn any of these off in Health Connect at any time.</p>
      <h3 class="t-title-3">What it writes</h3>
      <p class="t-body">If you allow it, the workouts you finish in Gradient are saved to Health Connect as exercise sessions so your other health apps see them. Nothing else is written. Turn it off in Settings or in Health Connect.</p>
      <h3 class="t-title-3">Why</h3>
      <p class="t-body">To fit each day's workout to how you slept and recovered, to tick off light-day walks from your steps, to track your weight trend and protein goal, and to show your trends and insights.</p>
      <h3 class="t-title-3">Where it's kept</h3>
      <p class="t-body">In the app's private storage on this phone. Android's own device backup can include it, encrypted with your screen lock; the API key is left out of that backup. Copy my data makes a text copy you control.</p>
      <h3 class="t-title-3">Coaches</h3>
      <p class="t-body">The built-in coach works on this phone and sends nothing. Claude is optional. In Claude mode, with your own Anthropic API key, a short summary (age range, goals, averages and trends, training numbers, but no name, dates or IDs) goes to Anthropic's API when a weekly report is written or you ask a question. Ask in the Claude app sends the same summary and your question to the Claude app, only when you press the button. Settings shows the exact text.</p>
      <h3 class="t-title-3">Deleting</h3>
      <p class="t-body">Settings, then Reset everything, deletes it all from this phone. Uninstalling the app does too. To stop Gradient reading or writing health data, remove its access in Health Connect.</p>
    </div>`;
  U.screens.privacy = {
    render() { return `${U.navbar('Privacy', '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">Privacy</h1><div class="section">${U.privacyHtml()}</div>`; },
  };
  U.showPrivacySheet = () => U.sheet({ title: 'Privacy', detents: 'large', detent: 'large', body: `<div class="sheet-pad">${U.privacyHtml()}</div>` });
})(typeof window !== 'undefined' ? window : globalThis);
