/* Tailor my plan (GH.tailor): say what you want, see the changes, apply or change them, undo later.
 * Opened from the coach chat, Plan's "Make it yours", and a muscle on Progress's body map (its
 * data-arg is the muscle, e.g. "calves").
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {};
  const T = () => GH.tailor;
  const AI = () => GH.ai;
  const EXAMPLES = ['More legs and glutes', 'Bigger arms', 'My knees hurt', 'Shorter workouts', 'No jumping', '3 days a week'];

  let st = null; // { ctl, step: 'ask' | 'reading' | 'propose' | 'nothing', text, t, lines, note, ctrl }
  function body() {
    const chips = `<div class="ob-chips tailor-chips">${EXAMPLES.map((x) => `<button type="button" class="rf-chip" data-act="tailorChip" data-arg="${U.esc(x)}">${U.esc(x)}</button>`).join('')}</div>`;
    if (st.step === 'reading') return `<div class="sheet-pad tailor"><div class="chat-setup"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">The coach is reading that…</span></div></div>`;
    if (st.step === 'propose') {
      return `<div class="sheet-pad tailor">
        <p class="t-callout rf-muted tailor-asked">“${U.esc(st.text)}”</p>
        <p class="t-headline">Here's what would change</p>
        <ul class="rf-list tailor-lines">${st.lines.map((l) => `<li><div class="rf-list-row"><span class="rf-list-icon" data-tone="${l.tone === 'positive' ? 'green' : l.tone === 'caution' ? 'amber' : l.tone === 'neutral' ? 'neutral' : 'violet'}">${U.icon(l.icon)}</span><span class="rf-list-text"><span class="rf-list-title">${U.esc(l.text)}</span>${l.sub ? `<span class="rf-list-sub">${U.esc(l.sub)}</span>` : ''}</span></div></li>`).join('')}</ul>
        ${st.note ? `<p class="t-callout tailor-note">${U.icon('sparkle', 'sm')}<span>${U.esc(st.note)}</span></p>` : ''}
        <div class="btn-row tailor-btns"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="tailorApply">Apply</button><button type="button" class="rf-btn" data-size="lg" data-act="tailorEdit">Change it</button></div>
        <p class="t-footnote rf-muted">Nothing changes until you apply it, and you can undo it afterwards.</p>
      </div>`;
    }
    const none = st.step === 'nothing' ? `<p class="t-callout tailor-none">${U.icon('info', 'sm')}<span>There's no change to make from that. Try saying what you want more or less of, a sore joint, or the time you have.</span></p>` : '';
    return `<div class="sheet-pad tailor">
      <p class="t-callout rf-muted">Say what you'd like to change. The coach shows you what it would do first.</p>
      ${none}
      <div class="rf-field"><label class="rf-field-label" for="tailorQ">What would you like?</label><div class="rf-field-control"><textarea class="rf-input" id="tailorQ" rows="3" maxlength="400" placeholder="More legs, easy on my knees, 30 minutes">${U.esc(st.text || '')}</textarea></div></div>
      ${chips}
      <button type="button" class="rf-btn ob-wide" data-variant="filled" data-size="lg" data-act="tailorSuggest">Show the changes</button>
    </div>`;
  }
  const draw = () => { if (st && st.ctl && !st.ctl.closed) st.ctl.update(body()); };

  U.act.tailorPlan = (el) => {
    const arg = el && el.getAttribute ? el.getAttribute('data-arg') : null;
    const body0 = GH.body && GH.body.NAME || {};
    const text = arg && body0[arg] ? `Train my ${body0[arg].toLowerCase()} more` : arg && /\s/.test(arg) ? arg : '';
    if (st && st.ctl && !st.ctl.closed) st.ctl.close('ok');
    st = { step: 'ask', text };
    st.ctl = U.sheet({ title: 'Tailor my plan', size: 'auto', cls: 'tailor-sheet', body: body(), onClose: () => { if (st && st.ctrl) st.ctrl.abort(); st = null; } });
  };
  U.act.tailorChip = (el) => {
    const q = document.getElementById('tailorQ');
    if (!q) return;
    const v = q.value.trim();
    q.value = v ? `${v.replace(/[,.\s]+$/, '')}, ${el.dataset.arg.toLowerCase()}` : el.dataset.arg;
    U.haptic('select');
  };
  U.act.tailorEdit = () => { if (!st) return; st.step = 'ask'; draw(); };
  U.act.tailorSuggest = async () => {
    if (!st) return;
    const q = document.getElementById('tailorQ');
    const text = (q ? q.value : st.text || '').trim();
    if (!text) { if (q) q.focus(); return; }
    const S = U.S, day = U.today();
    st.text = text;
    let t = T().valid(S, T().parse(text));
    let note = '';
    // What the rules can't read, a model might: Claude when it's on, else the on-device model.
    if (T().empty(t)) {
      st.step = 'reading';
      draw();
      const me = st;
      me.ctrl = new AbortController();
      let got = null;
      if (S.ai.mode === 'api' && AI() && AI().hasKey() && S.ai.consentAt && AI().tailor) got = await AI().tailor(S, day, text).catch(() => null);
      else got = await T().ask(S, text, me.ctrl.signal);
      if (st !== me) return;
      if (got) { t = T().valid(S, T().merge(t, got)); note = String(got.note || '').trim(); }
    }
    if (T().empty(t)) { st.step = 'nothing'; draw(); U.haptic('error'); return; }
    const { lines } = T().plan(S, t);
    if (!lines.length) { st.step = 'nothing'; draw(); return; }
    Object.assign(st, { step: 'propose', t, lines, note });
    draw();
    U.haptic('tap');
  };
  U.act.tailorApply = () => {
    if (!st || !st.t) return;
    const S = U.S, day = U.today();
    const lines = T().apply(S, day, st.t);
    st.ctl.close('ok');
    if (!lines) return;
    U.commit();
    U.toast('Plan updated', 'positive', lines.length === 1 ? lines[0] : `${lines.length} changes, from your next workout`, { label: 'Undo', onClick: () => U.act.tailorUndo() });
  };
  U.act.tailorUndo = () => {
    const S = U.S;
    if (!T().undo(S, U.today())) return;
    U.commit();
    U.toast('Changes undone', 'neutral', 'Your plan is back to how it was.');
  };
})(typeof window !== 'undefined' ? window : globalThis);
