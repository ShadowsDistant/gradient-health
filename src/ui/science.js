/* How it works: every rule the app follows, what it does, why, how strong the research is, and the
 * papers behind it (tap one to open it). Opened from Profile, and from "Why?" links around the app.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.screens = U.screens || {};
  const SC = () => GH.science;

  function levelBadge(level) {
    const l = SC().LEVELS[level];
    return l ? U.badge(l.label, l.tone) : '';
  }
  function ruleCard(r) {
    const refs = r.refs.map((id) => SC().REFS[id]).filter(Boolean);
    return `<details class="card sci" id="sci-${r.id}" data-key="sci-${r.id}">
      <summary class="sci-head"><span class="rf-list-icon" data-tone="${r.tone}">${U.icon(r.icon)}</span><span class="sci-title"><span class="t-headline">${U.esc(r.title)}</span>${levelBadge(r.level)}</span>${U.icon('chevron-down', null, 'sci-chev')}</summary>
      <div class="sci-body">
        <p class="t-footnote sci-label">What the app does</p><p class="t-callout">${U.esc(r.does)}</p>
        <p class="t-footnote sci-label">Why</p><p class="t-callout">${U.esc(r.why)}</p>
        ${r.caveat ? `<p class="t-footnote rf-muted sci-caveat">${U.icon('info', 'sm')}<span>${U.esc(r.caveat)}</span></p>` : ''}
        <p class="t-footnote sci-label">Research</p>
        <ul class="sci-refs">${refs.map((x) => `<li><button type="button" class="sci-ref" data-act="openRef" data-arg="${U.esc(SC().refUrl(x))}"><span class="t-footnote"><b>${U.esc(x.cite)}.</b> ${U.esc(x.title)}.</span><span class="t-caption rf-muted">${U.esc(x.journal)}</span></button></li>`).join('')}</ul>
      </div>
    </details>`;
  }

  U.screens.science = {
    render() {
      const levels = SC().LEVELS;
      return `${U.navbar('How it works', '', U.glassBtn('chevron-left', 'Back', 'back'))}
        <h1 class="rf-large-title">How it works</h1>
        <p class="lt-sub t-callout rf-muted">Every rule Gradient Health follows, what it's based on, and how sure the research is. Tap a rule to open it.</p>
        <div class="section">
          <div class="card sci-legend">${Object.keys(levels).map((k) => `<div class="sci-level">${levelBadge(k)}<span class="t-footnote rf-muted">${U.esc(levels[k].text)}</span></div>`).join('')}</div>
          ${SC().RULES.map(ruleCard).join('')}
          <p class="t-footnote rf-muted">General information, not medical advice. Research findings are averages across groups of people, so your results can differ.</p>
        </div>`;
    },
    // U.open('science', ruleId) opens that rule and scrolls to it.
    focus(root, id) {
      const el = root.querySelector(`#sci-${CSS.escape(id)}`);
      if (!el) return;
      el.open = true;
      setTimeout(() => el.scrollIntoView({ block: 'start', behavior: U.reduced() ? 'auto' : 'smooth' }), 60);
    },
  };
  U.act.openRef = (el) => { const url = el.dataset.arg; if (url && GH.platform) GH.platform.openUrl(url); };
  // "Why?" links elsewhere in the app.
  U.whyLink = (ruleId, label) => `<button type="button" class="rf-btn why-link" data-variant="plain" data-size="sm" data-act="openScience" data-arg="${U.esc(ruleId)}">${U.esc(label || 'Why?')}</button>`;
})(typeof window !== 'undefined' ? window : globalThis);
