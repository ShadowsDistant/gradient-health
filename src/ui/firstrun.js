/* Before you start: a page on health and privacy that comes before anything else, once. Someone new
 * sees it on their first launch, over set-up's welcome; someone who used the app before it existed
 * sees it on their next launch. "I understand" puts it away for good.
 *
 * It's kept with the state (S.seen.disclaimer, a backup carries it) and on this phone in localStorage
 * ('gh.disclaimer'), which also covers the time before there is a state, while set-up is under way.
 * A reset keeps the localStorage key: the same person, on the same phone, already read it.
 * U.disclaimerOk() says whether it's been accepted; U.firstRun(then) shows it if not (src/ui/core.js
 * boot), and runs then() once it's put away: what boot would open over the first screen (What's new,
 * a workout to pick up, a badge) waits for it. DISCLAIMER goes up when the words change enough to
 * ask again. */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui;
  const doc = G.document;
  const P = () => GH.platform;
  const KEY = 'gh.disclaimer';
  const DISCLAIMER = 1;
  const lsGet = () => { try { return G.localStorage ? G.localStorage.getItem(KEY) : null; } catch (e) { return null; } };
  const lsSet = (v) => { try { if (G.localStorage) G.localStorage.setItem(KEY, String(v)); } catch (e) { /* private mode */ } };

  // Accepted, by the state or on this phone. Accepted on this phone before set-up made the state, it's
  // copied into the state here.
  U.disclaimerOk = () => {
    const S = U.S;
    if (S && S.seen && Number(S.seen.disclaimer) >= DISCLAIMER) return true;
    if (Number(lsGet()) >= DISCLAIMER) {
      if (S && S.seen) { S.seen.disclaimer = DISCLAIMER; if (U.save) U.save(); }
      return true;
    }
    return false;
  };

  const POINTS = [
    ['info', 'sky', 'Not medical advice', 'General guidance only. It can\'t diagnose or treat anything.'],
    ['heart', 'rose', 'Check with your doctor first', 'Especially with a health condition, an injury, medicine or a pregnancy.'],
    ['alert', 'amber', 'Stop if something feels wrong', 'Pain, dizziness or chest pain: stop. If it\'s serious, call emergency services.'],
    ['lock', 'green', 'Your data stays on this phone', 'No account, ads or tracking. Claude and food search send only what they need.'],
  ];
  function markup() {
    const point = ([icon, tone, title, sub]) => `<li><span class="ob-ico is-sm" data-tone="${tone}">${U.icon(icon)}</span><span class="ob-point-text"><span class="ob-point-title">${U.esc(title)}</span><span class="ob-point-sub">${U.esc(sub)}</span></span></li>`;
    return `<div class="ob-scroll fr-scroll">
        <div class="ob-page fr-page">
          <div class="ob-hello fr-hello">
            <div class="ob-mark fr-mark" aria-hidden="true"><span class="ob-halo"></span>${GH.LOGO ? `<img class="ob-logo" src="${GH.LOGO}" alt="" width="104" height="104">` : ''}</div>
            <h1 class="rf-large-title ob-hero-title" id="frTitle" tabindex="-1">Before you start</h1>
            <p class="ob-tagline">A few things to know first.</p>
            <ul class="ob-points fr-points">${POINTS.map(point).join('')}</ul>
          </div>
        </div>
      </div>
      <div class="ob-actions is-col fr-actions">
        <button type="button" class="rf-btn rf-glass ob-go" data-variant="tinted" data-size="lg" data-act="firstRunOk"><span>I understand</span></button>
        <button type="button" class="rf-btn ob-alt" data-variant="plain" data-act="firstRunPrivacy">Read the privacy policy</button>
      </div>`;
  }

  let el = null, offBack = null, under = [], after = null;
  U.firstRun = (then) => {
    if (el || U.disclaimerOk()) return false;
    after = typeof then === 'function' ? then : null;
    el = doc.createElement('div');
    el.className = 'onboard gh-firstrun';
    el.setAttribute('data-step', 'welcome');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'frTitle');
    el.innerHTML = markup();
    doc.body.appendChild(el);
    if (U.enhance) U.enhance(el);
    // What's under it is out of reach (a sheet opened from here, like the privacy policy, comes in
    // above it and stays reachable).
    under = Array.from(doc.body.children).filter((n) => n !== el && !n.inert);
    for (const n of under) n.inert = true;
    // Back: a sheet opened from here closes (the app's own Back does that). With none, it's the first
    // screen's Back, which puts the app in the background, and this page is here when it comes back.
    // What's under it never moves meanwhile: a Back it would have taken (a page a link opened, another
    // tab, the player) is spent here. (Set-up is on its welcome, whose Back is the first screen's.)
    if (P() && P().onBack) offBack = P().onBack(() => {
      if (!el || U.topSheet() || doc.querySelector('dialog[open]')) return false;
      const r = U.route || {};
      const pl = U.els && U.els().playerEl;
      return !!(r.view || (r.tab && r.tab !== 'today') || (pl && !pl.hidden));
    });
    const h = el.querySelector('#frTitle');
    if (h) h.focus({ preventScroll: true });
    enter();
    return true;
  };
  // The logo blooms, then the words, the four points and the buttons rise one after another, as on
  // set-up's welcome.
  function enter() {
    if (U.reduced() || !el.animate) return;
    const mark = el.querySelector('.ob-mark');
    if (mark) mark.animate([{ opacity: 0, transform: 'scale(.6)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 560, easing: 'cubic-bezier(.34, 1.4, .64, 1)', fill: 'backwards' });
    const parts = Array.from(el.querySelectorAll('.ob-hello > :not(.ob-mark):not(.ob-points), .ob-points > li, .ob-actions > *'));
    parts.forEach((n, k) => n.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 100 + k * 45, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }));
  }
  function done() {
    const S = U.S;
    lsSet(DISCLAIMER);
    if (S && S.seen) { S.seen.disclaimer = DISCLAIMER; if (U.save) U.save(); }
    if (offBack) { offBack(); offBack = null; }
    for (const n of under) n.inert = false;
    under = [];
    const gone = el;
    el = null;
    gone.setAttribute('data-closing', '');
    const remove = () => { gone.remove(); };
    // Focus goes to what's under it: set-up's title, or the screen's.
    const h = doc.querySelector('#onboard:not([hidden]) .rf-large-title, #screen .rf-large-title');
    if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    const then = after;
    after = null;
    if (then) setTimeout(() => { try { then(); } catch (e) { if (G.console) G.console.error(e); } }, 0);
    if (U.reduced() || !gone.animate) { remove(); return; }
    const a = gone.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(24px)' }], { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    a.onfinish = remove;
  }
  U.act.firstRunOk = () => { U.haptic('success'); done(); };
  U.act.firstRunPrivacy = () => { if (U.showPrivacySheet) U.showPrivacySheet(); };
})(typeof window !== 'undefined' ? window : globalThis);
