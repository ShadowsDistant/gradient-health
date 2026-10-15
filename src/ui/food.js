/* Food (calorie and macro tracking, when it's on), the part in the page. It lives in Health: a section
 * near the top (U.healthFood: today's calories and macros, the four meals, Add food and Scan) that
 * opens the Food page; without calorie tracking, a small "Track calories" invite in its place. Also
 * Today's card (U.foodCard) and Settings' meal times line. The Food page and every food sheet (adding,
 * portions, quick add, starting, meal times) are src/ui/foodpage.js, a part that loads the first time
 * one is wanted (the 'foodUi' chunk): the stand-ins here load it and then do what was asked, and it
 * loads ahead of time, once the app is idle, for someone tracking calories.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const F = () => GH.food;

  const kcal = (n) => `${U.num(Math.round(n))}`;
  const g1 = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const MEAL_NAME = Object.fromEntries([['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']]);
  // Meals go to Health Connect as they change.
  const toHc = () => { if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S); };
  // Minutes after midnight as the clock reads them ("8:14 am"; short: "8 am"), and a meal's window in
  // words ("5 to 11 am", "11 am to 3 pm").
  // (A time keeps its am or pm on its line.)
  const clockText = (m, short) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}${short && !mm ? '' : `:${String(mm).padStart(2, '0')}`}\u00a0${h < 12 ? 'am' : 'pm'}`; };
  const spanText = (w) => { const a = clockText(w[0], true), b = clockText(w[1], true); return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`; };

  /* ---------------------------------------------------------------- the day at a glance */
  // Calories left (or over) in a ring, what was eaten of the target, and protein, carbs and fat each
  // against its own: Health's food section, the Food page and Today's card all draw this one. It's
  // spans only, so it can sit in a button (Health's and Today's open the Food page). A macro's grams
  // so far and its target are columns the three rows share (src/styles/food.css), so the slashes
  // line up one under another. go: the chevron of a block that opens the Food page.
  const nb = (s) => String(s).replace(/ /g, '\u00a0');
  function macroRow(label, have, want, tone) {
    const v = want ? Math.min(1, have / want) : 0;
    return `<span class="fd-macro"><span class="fd-mk">${label}</span><span class="fd-mhave rf-num">${g1(have)}<span class="fd-msl"> /</span></span><span class="fd-mwant rf-num">${want}\u00a0g</span><span class="rf-progress" role="progressbar" aria-label="${label}" aria-valuenow="${Math.round(v * 100)}" aria-valuemin="0" aria-valuemax="100" style="--rf-value:${v.toFixed(3)}" data-tone="${have > want * 1.1 ? 'caution' : tone}"><span class="rf-progress-fill"></span></span></span>`;
  }
  function glance(S, day, o) {
    const t = F().targets(S, day), tot = F().totals(S, day);
    const go = o && o.go ? `<span class="fd-go">${U.icon('chevron-right', 'sm')}</span>` : '';
    if (!t) return `<span class="fd-sum is-bare"><span class="fd-side"><span class="fd-kcal rf-num"><span><b>${U.roll(kcal(tot.kcal))}</b> kcal ${day === U.today() ? 'today' : 'eaten'}</span>${go}</span><span class="t-footnote rf-muted">Add your weight for a calorie target.</span></span></span>`;
    const left = t.kcal - tot.kcal;
    return `<span class="fd-sum${o && o.compact ? ' is-compact' : ''}">${U.ring(Math.min(1, tot.kcal / t.kcal), 'Calories', `<span class="fd-ring-n rf-num">${U.roll(kcal(Math.abs(left)))}</span><span class="fd-ring-l">${left >= 0 ? 'left' : 'over'}</span>`, 'lg', left < -t.kcal * 0.1 ? 'caution' : 'accent')}<span class="fd-side"><span class="fd-kcal rf-num"><span><b>${U.roll(kcal(tot.kcal))}</b> of ${kcal(t.kcal)}\u00a0kcal</span>${go}</span><span class="fd-macros">${macroRow('Protein', tot.p, t.protein, 'positive')}${macroRow('Carbs', tot.c, t.carbs, 'accent')}${macroRow('Fat', tot.f, t.fat, 'accent')}</span></span></span>`;
  }
  // The Food page's (with a way to add what the target needs when there's none yet).
  function summary(S, day) {
    if (!F().targets(S, day)) return `<p class="t-callout rf-muted">Add your weight and height for a calorie target.</p><button type="button" class="rf-btn" data-act="editStep" data-arg="about">Add them</button>`;
    return glance(S, day);
  }
  // A link among words (How it's worked out, Same as yesterday, Change): its words start at the text
  // edge, with a hit area 44 px high round them (food.css).
  const link = (act, arg, words, icon, cls) => `<button type="button" class="rf-btn fd-link${cls ? ` ${cls}` : ''}" data-variant="plain" data-size="sm" data-act="${act}"${arg ? ` data-arg="${U.esc(arg)}"` : ''}>${icon ? U.icon(icon) : ''}${U.esc(words)}</button>`;
  U.foodKit = { kcal, g1, nb, MEAL_NAME, summary, toHc, spanText, link };

  // Today's card (calorie mode): the glance and its title open the Food page, with Add food and Scan
  // under them. Protein-only mode keeps the protein card.
  U.foodCard = (S, day) => {
    if (!F() || !F().full(S)) return '';
    const t = F().targets(S, day), left = t ? t.kcal - F().totals(S, day).kcal : 0;
    return `<div class="card fd-card" data-key="food">
      <button type="button" class="fd-open" data-act="goFood" aria-label="Food today${t ? `: ${kcal(Math.abs(left))} kcal ${left >= 0 ? 'left' : 'over'}` : ''}. Open the day's meals">
        <span class="fd-card-head"><span class="t-headline">Food</span><span class="fd-go">${U.icon('chevron-right', 'sm')}</span></span>
        ${glance(S, day, { compact: true })}
      </button>
      <div class="fd-btns"><button type="button" class="rf-btn" data-variant="soft" data-act="foodAdd">${U.icon('plus')}Add food</button>${F().prefs(S).online ? `<button type="button" class="rf-btn" data-act="foodScan">${U.icon('scan')}Scan</button>` : ''}</div>
    </div>`;
  };
  U.act.goFood = () => U.go('food');

  /* ---------------------------------------------------------------- Health's food section */
  // Right under the week on Health: today's calories (left or over) and macros, the four meals with
  // what was eaten (or when they are), Add food and Scan. The section opens the Food page. Without
  // calorie tracking: a small invite to start it, until it's put away (the + menu still has it).
  U.healthFood = (S, day) => {
    if (!F()) return '';
    if (!F().full(S)) {
      if (U.seen('foodInvite')) return '';
      return `<div class="section"><div class="card hf-invite" data-key="food-invite">
        <div class="hf-inv-row"><span class="rf-list-icon" data-tone="coral">${U.icon('flame')}</span>
          <span class="hf-inv-text"><span class="t-headline">Track calories</span><span class="t-footnote rf-muted">A daily target from your size, steps and goal, set up in one step.</span></span></div>
        <div class="hf-inv-btns"><button type="button" class="rf-btn" data-variant="plain" data-act="foodInviteHide">Not now</button><button type="button" class="rf-btn" data-variant="filled" data-act="foodStart">Start</button></div>
      </div></div>`;
    }
    const t = F().targets(S, day), tot = F().totals(S, day), meals = F().byMeal(S, day), win = F().mealTimes(S, day).win;
    const left = t ? t.kcal - tot.kcal : 0;
    const rows = F().MEALS.map(([id, name]) => {
      const list = meals[id];
      const what = list.length ? list.map((e) => e.name).join(', ') : id === 'snack' ? 'Any other time' : spanText(win[id]);
      return `<span class="hf-meal${list.length ? '' : ' is-empty'}" data-key="hm-${id}"><span class="hf-meal-k">${name}</span><span class="hf-meal-what">${U.esc(what)}</span><span class="hf-meal-n rf-num">${list.length ? kcal(list.reduce((a, e) => a + e.kcal, 0)) : ''}</span></span>`;
    }).join('');
    return `<h2 class="sec-title t-title-3">Food</h2>
      <div class="section"><div class="card hf" data-key="food">
        <button type="button" class="hf-main fd-open" data-act="goFood" aria-label="Food today: ${t ? `${kcal(Math.abs(left))} kcal ${left >= 0 ? 'left' : 'over'}` : `${kcal(tot.kcal)} kcal`}. Open the day's meals">
          ${glance(S, day, { go: true })}
          <span class="hf-meals">${rows}</span>
        </button>
        <div class="fd-btns hf-btns"><button type="button" class="rf-btn" data-variant="filled" data-act="foodAdd">${U.icon('plus')}Add food</button><button type="button" class="rf-btn" data-act="foodScan">${U.icon('scan')}Scan</button></div>
      </div></div>`;
  };
  U.act.foodInviteHide = (el) => {
    U.haptic('dismiss');
    const card = el.closest('.hf-invite');
    const done = () => { U.markSeen('foodInvite'); U.render(); };
    if (card && U.motion && U.motion.collapse) U.motion.collapse(card).then(done); else done();
  };
  // Settings' Meal times row.
  U.mealTimesLine = (S) => (F().prefs(S).learn !== false ? 'Learning from your logs' :['breakfast', 'lunch', 'dinner'].map((k) => `${MEAL_NAME[k]} ${spanText(F().mealTimes(S, U.today()).win[k])}`).join(', '));

  /* ---------------------------------------------------------------- the page and sheets, until they're in */
  // As src/ui/lazy.js stands in for its parts: an action loads the part, then runs the real one; the
  // page draws its bar and title, and the rest once the part is in.
  const part = () => GH.lazy('foodUi').catch((e) => { U.toast('Something went wrong', 'critical'); throw e; });
  function stand(map, name) {
    const self = map[name] = function (...args) {
      return part().then(() => { const f = map[name]; return f && f !== self ? f.apply(this, args) : undefined; }, () => undefined);
    };
  }
  if (GH.lazy) {
    stand(U.act, 'foodAdd');
    stand(U.act, 'foodScan');
    stand(U.act, 'logFood');
    stand(U.act, 'foodStart');
    stand(U.act, 'foodMealTimes');
    stand(U.act, 'foodQuick');
    stand(U.act, 'foodCreate');
    const self = U.screens.food = {
      render() {
        part().then(() => { if (U.screens.food !== self && (U.route.view || U.route.tab) === 'food') U.render(); }, () => {});
        return `${U.navbar('Food', '', U.route.view ? U.glassBtn('chevron-left', 'Back', 'back') : '')}<h1 class="rf-large-title">Food</h1>`;
      },
    };
    // Someone tracking calories gets it ahead of time, once the app is idle.
    const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
    const prevBoot = U.afterBoot;
    U.afterBoot = () => {
      if (prevBoot) prevBoot();
      setTimeout(() => idle(() => { if (U.S && F() && F().full(U.S) && !G.document.hidden) GH.lazy('foodUi').catch(() => {}); }), 2500);
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
