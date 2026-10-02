/* Parts of the app that load the first time they're needed (scripts/build.mjs APP_CHUNKS): set-up,
 * the plan review with Why this plan, How it works, and a badge's share card. Until a part is in,
 * the rest of the app calls the small stand-ins here: an action loads its part, then runs the real
 * one with the same element and event; a screen draws its bar and title, and the page itself once
 * its part is in. Each part replaces its stand-ins as it runs. Once the first frame is drawn, the
 * likely ones load while the phone is idle, so a tap rarely waits.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  if (!GH.lazy) return;

  // A part, loaded once (GH.lazy). One that can't load says so, as a failed action does.
  const part = (name) => GH.lazy(name).catch((e) => { if (U.toast) U.toast('Something went wrong', 'critical'); throw e; });
  // map[name] until `chunk` replaces it: it loads the part, then calls what the part put there (an
  // error in it says so as a failed action does, src/ui/core.js dispatch).
  function stand(map, name, chunk) {
    const self = map[name] = function (...args) {
      return part(chunk).then(() => {
        const f = map[name];
        if (!f || f === self) return undefined;
        try { return f.apply(this, args); } catch (e) { if (G.console) G.console.error(e); if (U.toast) U.toast('Something went wrong', 'critical'); return undefined; }
      }, () => undefined);
    };
  }
  // U.screens[name] until `chunk` is in: the page's bar and large title (Back on a page opened on
  // top), then the page as it would have been drawn at once: its focus and shown hooks run then.
  function screen(name, chunk, title) {
    const self = U.screens[name] = {
      render() {
        part(chunk).then(() => {
          const now = U.screens[name], r = U.route;
          if (now === self || (r.view || r.tab) !== name) return;
          U.render();
          const el = U.els().screen;
          if (r.arg && now.focus) now.focus(el, r.arg);
          if (now.shown) now.shown(U.S, U.today(), r.arg);
        }, () => {});
        return `${U.navbar(title, '', U.route.view ? U.glassBtn('chevron-left', 'Back', 'back') : '')}<h1 class="rf-large-title">${U.esc(title)}</h1>`;
      },
    };
  }

  /* ---------------------------------------------------------------- set-up (src/ui/onboarding.js) */
  // Someone who isn't set up yet gets it at launch (core's boot asks for it); everyone else only
  // when they edit their answers, or look at what their plan works around.
  stand(U, 'showOnboarding', 'setup');
  stand(U, 'editAnswers', 'setup');
  stand(U.act, 'planAround', 'setup');

  /* ---------------------------------------------------------------- the plan review (src/planreview.js, src/ui/review.js) */
  // Whether a coach can check the plan, and which one, are asked as screens draw (Plan, You,
  // set-up's plan), so they answer here at once: the same answers as src/planreview.js's own engine
  // and available, which replace these with the rest of GH.planReview when it loads.
  function deviceReady(S) {
    const d = U.deviceState ? U.deviceState() : null;
    if (d && d.checked) return !!(d.available && d.available.ok && d.installed && d.installed.length);
    return !!(S && S.ai && S.ai.deviceModel);
  }
  const claudeReady = (S) => !!(S && S.ai && S.ai.consentAt && GH.ai && GH.ai.hasKey && GH.ai.hasKey());
  function engine(S) {
    const c = claudeReady(S), d = deviceReady(S);
    if (S && S.ai && S.ai.mode === 'api' && c) return 'claude';
    return d ? 'device' : c ? 'claude' : null;
  }
  GH.planReview = { engine, available: (S) => !!engine(S) };
  stand(GH.planReview, 'open', 'review');
  stand(U, 'openReview', 'review');
  stand(U.act, 'reviewPlan', 'review');
  stand(U.act, 'whyPlan', 'review');
  stand(U.act, 'reviewPlanIdeas', 'review');
  // The weekly report's plan ideas (Health's report sheet): drawn once the review is in.
  U.planIdeas = (S, day, rep) => {
    const plan = rep && rep.plan;
    if (plan && Array.isArray(plan.items) && plan.items.length) part('review').then(() => { if (U.refreshReport) U.refreshReport(); }, () => {});
    return '';
  };

  /* ---------------------------------------------------------------- How it works (src/data/science.js, src/ui/science.js) */
  screen('science', 'science', 'How it works');
  stand(U, 'openRule', 'science');
  // "Why?" links around the app open How it works at their rule (U.act.openScience, src/ui/profile.js).
  // The chip form is for lists where a link under every row would repeat (the Coach page).
  U.whyLink = (ruleId, label) => `<button type="button" class="rf-btn why-link" data-variant="plain" data-size="sm" data-act="openScience" data-arg="${U.esc(ruleId)}">${U.esc(label || 'Why?')}</button>`;
  U.whyChip = (ruleId) => `<button type="button" class="why-chip" data-act="openScience" data-arg="${U.esc(ruleId)}" aria-label="Why: the research behind this">${U.icon('info', 'sm')}Why</button>`;

  /* ---------------------------------------------------------------- a badge's share card (src/ui/sharecard.js) */
  stand(U, 'shareBadge', 'shareCard');

  /* ---------------------------------------------------------------- warming */
  // A couple of seconds after launch, the parts a tap is likely to want next load one at a time
  // while the phone is idle: the plan review (Plan and You), How it works (the Why links) and the
  // share card (badges). Set-up only loads for someone who needs it.
  const WARM = ['review', 'science', 'shareCard'];
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
  function warm(list) {
    const next = list.find((n) => !GH[n]);
    if (!next || G.document.hidden) return;
    GH.lazy(next).then(() => idle(() => warm(list)), () => {});
  }
  const prevBoot = U.afterBoot;
  U.afterBoot = () => {
    if (prevBoot) prevBoot();
    setTimeout(() => idle(() => warm(WARM)), 2000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
