/* How it works: every rule the app follows, in four groups (training, recovery, food and body,
 * habits), one line each: what it does in a sentence and a dot for how strong the research is. A rule
 * opens in a sheet with the whole of what it does, why, any caveat, and the papers behind it (tap one
 * to open it). Opened from Profile and Settings, and from "Why?" links around the app, which open
 * that rule's sheet straight away.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.screens = U.screens || {};
  const SC = () => GH.science;
  const LEVEL_ORDER = ['strong', 'moderate', 'early'];
  let show = 'all'; // the group picked at the top
  let focusTimer = 0;

  const firstSentence = (t) => String(t || '').trim().split(/(?<=[.!?])\s+/)[0];
  const dot = (level) => `<span class="sci-dot" data-level="${U.esc(level)}" aria-hidden="true"></span>`;
  const levelWord = (level) => (SC().LEVELS[level] || { label: '' }).label;
  function row(r) {
    return `<li data-key="sci-${r.id}"><button type="button" class="rf-list-row sci-row" id="sci-${r.id}" data-act="sciOpen" data-arg="${r.id}" aria-label="${U.esc(`${r.title}. ${levelWord(r.level)}.`)}">
      <span class="rf-list-icon" data-tone="${r.tone}">${U.icon(r.icon)}</span>
      <span class="rf-list-text"><span class="rf-list-title">${U.esc(r.title)}</span><span class="rf-list-sub sci-sum">${U.esc(firstSentence(r.does))}</span></span>
      ${dot(r.level)}<span class="rf-list-chevron">${U.icon('chevron-right')}</span>
    </button></li>`;
  }

  U.screens.science = {
    render() {
      const sc = SC();
      const groups = sc.GROUPS.filter(([k]) => show === 'all' || show === k);
      return `${U.navbar('How it works', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">How it works</h1>
        <p class="lt-sub t-callout rf-muted">The rules behind your plan, and how sure the research is.</p>
        <div class="sci-top" data-key="sci-top">
          ${U.choice('sciShow', [['all', 'All']].concat(sc.GROUPS), show, 'Show', ' class="sci-filter" data-hscroll data-on="sciShow"')}
          <button type="button" class="sci-key" data-act="sciKey">${LEVEL_ORDER.map((l) => `<span class="sci-key-item">${dot(l)}${U.esc(levelWord(l).replace(/ evidence$/, ''))}</span>`).join('')}<span class="sci-key-more t-footnote">${U.icon('info', 'sm')}What these mean</span></button>
        </div>
        <div class="section sci-groups">
          ${groups.map(([k, t]) => {
            const rules = sc.RULES.filter((r) => r.cat === k);
            return `<h3 class="rf-list-header sci-head" data-key="sci-h-${k}">${U.esc(t)}<span class="sci-count t-footnote">${rules.length}</span></h3>
              <ul class="rf-list sci-list" data-key="sci-l-${k}">${rules.map(row).join('')}</ul>`;
          }).join('')}
          <p class="rf-list-footer">General information, not medical advice. Studies report group averages, so your results can differ.</p>
        </div>`;
    },
    // U.open('science', ruleId): the rule's row is brought into view and its sheet opens (once).
    focus(root, id) {
      if (!SC().RULES.some((r) => r.id === id)) return;
      clearTimeout(focusTimer);
      const bring = () => {
        const el = root.querySelector(`#sci-${CSS.escape(id)}`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          el.classList.add('is-flash');
          setTimeout(() => el.classList.remove('is-flash'), 1400);
        }
        focusTimer = setTimeout(() => openRule(id), 120);
      };
      if (show === 'all' || root.querySelector(`#sci-${CSS.escape(id)}`)) { bring(); return; }
      // A group picked earlier hides the rule: show them all, once the render that got here is done.
      show = 'all';
      focusTimer = setTimeout(() => { U.render(); bring(); }, 0);
    },
  };

  // One rule in full: its evidence, what the app does, why, the caveat, and the papers (folded away).
  function openRule(id) {
    const sc = SC();
    const r = sc.RULES.find((x) => x.id === id);
    if (!r) return null;
    const l = sc.LEVELS[r.level] || { label: '', text: '' };
    const refs = r.refs.map((k) => sc.REFS[k]).filter(Boolean);
    return U.sheet({
      title: r.title, size: 'auto', cls: 'sci-sheet',
      body: `<div class="sheet-pad sci-detail">
        <div class="sci-hero">
          <span class="rf-list-icon" data-tone="${r.tone}">${U.icon(r.icon)}</span>
          <span class="sci-hero-text"><span class="sci-level">${dot(r.level)}<b class="t-subhead">${U.esc(l.label)}</b></span><span class="t-footnote rf-muted">${U.esc(l.text)}</span></span>
        </div>
        <section class="sci-block"><h3 class="sci-label">What the app does</h3><p class="t-body">${U.esc(r.does)}</p></section>
        <section class="sci-block"><h3 class="sci-label">Why</h3><p class="t-body">${U.esc(r.why)}</p></section>
        ${r.caveat ? `<p class="sci-caveat t-footnote">${U.icon('info', 'sm')}<span>${U.esc(r.caveat)}</span></p>` : ''}
        ${refs.length ? `<details class="sci-studies gh-drop">
          <summary><span class="sci-label">The research</span><span class="t-footnote rf-muted">${U.plural(refs.length, 'source')}</span>${U.icon('chevron-down', 'sm', 'sci-chev')}</summary>
          <ul class="sci-refs">${refs.map((x) => `<li><button type="button" class="sci-ref" data-act="openRef" data-arg="${U.esc(sc.refUrl(x))}"><b class="t-footnote">${U.esc(x.cite)}</b><span class="t-caption">${U.esc(x.title)}</span><span class="t-caption rf-muted">${U.esc(x.journal)}</span></button></li>`).join('')}</ul>
        </details>` : ''}
      </div>`,
    });
  }
  U.openRule = openRule;
  U.act.sciOpen = (el) => openRule(el.dataset.arg);
  U.on.sciShow = (el, ev, v) => {
    show = v || 'all';
    U.render();
  };
  U.act.sciKey = () => U.sheet({
    title: 'Evidence', size: 'fit',
    body: `<ul class="rf-list sci-levels">${LEVEL_ORDER.map((k) => { const l = SC().LEVELS[k]; return `<li><div class="rf-list-row">${dot(k)}<span class="rf-list-text"><span class="rf-list-title">${U.esc(l.label)}</span><span class="rf-list-sub">${U.esc(l.text)}</span></span></div></li>`; }).join('')}</ul>
      <p class="sheet-pad t-footnote rf-muted">Each rule shows its strongest evidence. Tap one for the papers.</p>`,
  });
  U.act.openRef = (el) => { const url = el.dataset.arg; if (url && GH.platform) GH.platform.openUrl(url); };
  // (The "Why?" links elsewhere in the app, U.whyLink and U.whyChip, are drawn without this part:
  // src/ui/lazy.js.)
})(typeof window !== 'undefined' ? window : globalThis);
