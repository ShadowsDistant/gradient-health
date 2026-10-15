/* The Food page and food's sheets, a part that loads the first time it's wanted (the 'foodUi' chunk;
 * src/ui/food.js has Today's card, Health's food section and the stand-ins until this is in, and loads
 * it ahead of time for someone tracking calories). The page (U.screens.food): the day's ring and
 * macros, the four meals with each entry's time, other days, copying, saved meals and meal times.
 * Adding food: the meal the clock picks at the top (src/food.js has the meal times), recent foods
 * most used first with a one-tap add of the last portion, the same meal as yesterday, a search over
 * the built-in foods (USDA, loaded on first use), favourites, your own foods and saved meals, quick
 * add, and (only if you turn it on) Open Food Facts search and barcode scanning. The add and edit
 * sheets change an entry's meal and time. Starting calorie tracking takes one short sheet: the target
 * the app suggests from what it knows, each part of it changeable, and Start.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const F = () => GH.food;
  const doc = G.document;
  const { kcal, g1, nb, MEAL_NAME, summary, toHc, link } = U.foodKit;

  let foodDay = null; // the day the Food page shows (today unless you step back)
  const dayShown = () => (foodDay != null && foodDay <= U.today() && foodDay >= U.today() - 30 ? foodDay : U.today());
  const mealSeg = (name, v, on) => U.seg(name, F().MEALS, v, 'Meal', `${on ? ` data-on="${on}"` : ''} data-size="sm" data-block`);
  const dayWord = (day) => (day === U.today() ? 'today' : day === U.today() - 1 ? 'yesterday' : U.fmtDay(day));
  // A time field's value from minutes after midnight, and back.
  const fieldTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const readTime = (v) => { const x = /^(\d{1,2}):(\d{2})/.exec(v || ''); return x && Number(x[1]) < 24 && Number(x[2]) < 60 ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const timeField = (id, m, on) => `<label class="fd-time"><span class="t-subhead">Time</span><span class="rf-field-control"><input class="rf-input" type="time" id="${id}" value="${fieldTime(m)}" data-on="${on}" aria-label="Time"></span></label>`;
  // Health's + menu: Add food with the meal the clock picks; without calorie tracking, it starts first.
  U.act.logFood = () => { if (F().full(U.S)) openAdd(U.today(), null); else startSheet(true); };

  /* ---------------------------------------------------------------- the page */
  // A food logged: when, how much, and its macros, each number kept with its letter (and a line that
  // breaks does so after a dot, never before one).
  function entryRow(e, day) {
    const amount = e.portion ? e.portion : e.g ? `${e.g} g` : '';
    return U.row({ title: U.esc(e.name), sub: U.esc([nb(U.fmtClock(e.t)), amount, nb(`P ${g1(e.p)}`), nb(`C ${g1(e.c)}`), nb(`F ${g1(e.f)}`)].filter(Boolean).join('\u00a0· ')), detail: `${kcal(e.kcal)}`, act: 'foodEdit', arg: `${day}:${e.id}`, key: `fe-${e.id}` });
  }
  // The same meal the day before, to add again: its entries (none if this day has that meal already).
  const sameAs = (S, day, meal) => (F().byMeal(S, day)[meal].length ? [] : F().byMeal(S, day - 1)[meal]);
  const sameWords = (day) => (day === U.today() ? 'Same as yesterday' : 'Same as the day before');
  let seenRoute = null;
  U.screens.food = {
    render(S) {
      // Opened again, it starts on today.
      if (U.route !== seenRoute) { seenRoute = U.route; if (U.route.view === 'food') foodDay = null; }
      const today = U.today();
      const day = dayShown();
      const meals = F().byMeal(S, day);
      const tot = F().totals(S, day);
      const t = F().targets(S, day);
      const label = day === today ? 'Today' : day === today - 1 ? 'Yesterday' : U.fmtDay(day);
      const mealCards = F().MEALS.map(([id, name]) => {
        const list = meals[id];
        const sum = list.reduce((a, e) => a + e.kcal, 0);
        const again = list.length ? [] : sameAs(S, day, id);
        return `<div class="card fd-meal${list.length ? '' : ' is-empty'}" data-key="meal-${id}">
          <div class="fd-meal-head"><span class="t-headline">${name}</span><span class="t-footnote rf-muted rf-num">${list.length ? `${kcal(sum)}\u00a0kcal` : ''}</span>
            <button type="button" class="rf-btn" data-shape="circle" data-size="sm" aria-label="Add to ${name.toLowerCase()}" data-act="foodAdd" data-arg="${id}">${U.icon('plus')}</button></div>
          ${list.length ? `<ul class="rf-list fd-list">${list.map((e) => entryRow(e, day)).join('')}</ul>` : ''}
          ${again.length ? link('foodSame', id, `${sameWords(day)}, ${kcal(again.reduce((a, e) => a + e.kcal, 0))} kcal`, 'repeat', 'fd-same') : ''}
        </div>`;
      }).join('');
      const other = tot.other && tot.other.kcal ? `<div class="card" data-key="other"><div class="row-between"><span class="t-subhead">From other apps</span><span class="t-callout rf-num">${kcal(tot.other.kcal)} kcal</span></div><p class="t-footnote rf-muted">Shared through Health Connect, and counted in the total.</p></div>` : '';
      const why = t ? `${t.learned ? `Your burn, learned from your logs and weight, is about ${kcal(t.burn)} kcal a day` : `Your estimated burn is about ${kcal(t.burn)} kcal a day`}${t.delta ? `, ${t.delta < 0 ? 'minus' : 'plus'} ${kcal(Math.abs(t.delta))} to ${t.delta < 0 ? 'lose' : 'gain'} steadily` : ''}.` : '';
      const asPage = U.route.view === 'food';
      // What else the day can do: copy the day before (when it had food), saved meals, save this day
      // (when it has food), and meal times.
      const before = F().entries(S, day - 1);
      const tools = [
        before.length ? U.row({ key: 'copy', icon: 'copy', tone: 'teal', title: day === today ? 'Copy yesterday' : 'Copy the day before', sub: `${U.plural(before.length, 'item')}, ${kcal(before.reduce((a, e) => a + e.kcal, 0))} kcal`, act: 'foodCopyYesterday' }) : '',
        U.row({ key: 'saved', icon: 'bookmark', tone: 'indigo', title: 'Saved meals', sub: F().data(S).saved.length ? U.plural(F().data(S).saved.length, 'meal') : 'To add again in one tap', act: 'foodSavedMeals', chevron: true }),
        F().entries(S, day).length ? U.row({ key: 'save', icon: 'star', tone: 'amber', title: 'Save as a meal', sub: `Everything logged ${day === today ? 'today' : 'on this day'}`, act: 'foodSaveDay', chevron: true }) : '',
        U.row({ key: 'times', icon: 'clock', tone: 'sky', title: 'Meal times', sub: U.esc(U.mealTimesLine(S)), act: 'foodMealTimes', chevron: true }),
      ].join('');
      return `${U.navbar('Food', U.glassBtn('plus', 'Add food', 'foodAdd'), asPage ? U.glassBtn('chevron-left', 'Back', 'back') : '')}
        <h1 class="rf-large-title">Food</h1>
        <div class="fd-days" role="group" aria-label="Day">
          <button type="button" class="rf-btn" data-variant="plain" data-shape="circle" aria-label="Day before" data-act="foodDayPrev"${day <= today - 30 ? ' aria-disabled="true"' : ''}>${U.icon('chevron-left')}</button>
          <span class="fd-day t-callout" aria-live="polite">${U.esc(label)}</span>
          <button type="button" class="rf-btn" data-variant="plain" data-shape="circle" aria-label="Day after" data-act="foodDayNext"${day >= today ? ' aria-disabled="true"' : ''}>${U.icon('chevron-right')}</button>
        </div>
        <div class="section">
          <div class="card fd-sumcard" data-key="sum">${summary(S, day)}${why ? `<p class="t-footnote rf-muted">${U.esc(why)} ${U.whyLink ? link('openScience', 'calories', 'How it\'s worked out') : ''}</p>` : ''}</div>
          ${mealCards}
          ${other}
          <div class="card fd-tools" data-key="tools"><ul class="rf-list">${tools}</ul></div>
          <p class="t-footnote rf-muted fd-src" data-key="src">Built-in foods from the USDA's nutrient database.${F().prefs(S).online ? ' Online results and barcodes from Open Food Facts (ODbL).' : ''}</p>
        </div>`;
    },
    float() { return ''; },
  };
  U.act.foodDayPrev = () => { foodDay = Math.max(U.today() - 30, dayShown() - 1); U.haptic('day'); U.render(); };
  U.act.foodDayNext = () => { foodDay = Math.min(U.today(), dayShown() + 1); U.haptic('day'); U.render(); };
  // An arrow with no day past it (today, or 30 days back) answers with an edge.
  doc.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.fd-days [aria-disabled="true"]')) U.haptic('edge'); });

  /* ---------------------------------------------------------------- adding food */
  // What a new entry is for: the day (the Food page's, else today) and the meal (the one tapped, or
  // picked in the sheet, is by hand; otherwise the clock's).
  let addDay = null, addMeal = 'snack', addHand = false;
  function ready(day, meal) {
    addDay = day != null ? day : U.route.view === 'food' ? dayShown() : U.today();
    addHand = !!meal;
    addMeal = meal || F().mealFor(Date.now(), U.S);
  }
  const dbReady = () => GH.foods || null;
  let dbFailed = false;
  function loadDb() {
    if (!GH.lazy) { dbFailed = true; return Promise.resolve(null); }
    dbFailed = false;
    return GH.lazy('foods').catch(() => { dbFailed = true; return null; });
  }

  function foodRow(item) {
    const per = item.kcal != null ? `${kcal(item.kcal)} kcal per 100 g` : '';
    return U.row({ title: U.esc(item.name), sub: U.esc([item.detail, item.brand, per].filter(Boolean).join(' · ')), act: 'foodPick', arg: item.key, chevron: true, key: `fr-${item.key}` });
  }
  // A food from any source, in one shape: { key, name, detail, brand?, kcal, p, c, f, fib, portions }.
  const found = new Map(); // key → item, for the rows on screen
  function fromDb(x) {
    if (!x) return null;
    return { key: `usda:${x.id}`, src: 'usda', ref: x.id, name: x.name, detail: x.detail || '', kcal: x.kcal, p: x.p, c: x.c, f: x.f, fib: x.fib || 0, portions: (x.portions || []).map(([l, gr]) => [l, gr]) };
  }
  function fromCustom(c) {
    const per = c.per100 || null;
    return { key: `custom:${c.id}`, src: 'custom', ref: c.id, name: c.name, detail: c.servingLabel, kcal: per ? per.kcal : null, p: per ? per.p : null, c: per ? per.c : null, f: per ? per.f : null, fib: per ? per.fib : 0, perServing: c.perServing, servingG: c.servingG, portions: c.servingG ? [[c.servingLabel, c.servingG]] : [] };
  }
  function lookup(key) {
    if (found.has(key)) return found.get(key);
    const [src, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (src === 'usda' && dbReady()) return fromDb(GH.foods.get(Number(ref)));
    if (src === 'custom') { const c = F().data(U.S).custom.find((x) => x.id === ref); return c ? fromCustom(c) : null; }
    if (src === 'off') { const c = (F().data(U.S).offCache || {})[ref]; return c || null; }
    return null;
  }
  function remember(items) { for (const x of items) if (x) found.set(x.key, x); return items.filter(Boolean); }

  // A recent food: its name and how it was last logged, with a one-tap add of that portion.
  function regRow(r) {
    const item = lookup(r.key), l = r.last;
    if (item) found.set(item.key, item);
    const name = l ? l.name : item ? item.name : '';
    if (!name) return '';
    const amount = l ? l.portion || (l.g ? `${l.g} g` : '') : '';
    const sub = l ? [amount, `${kcal(l.kcal)} kcal`].filter(Boolean).join(' · ') : [item.detail, item.kcal != null ? `${kcal(item.kcal)} kcal per 100 g` : ''].filter(Boolean).join(' · ');
    return `<li data-key="rg-${U.esc(r.key)}"><div class="rf-list-row fd-reg">
      <button type="button" class="fd-reg-main" data-act="foodPick" data-arg="${U.esc(r.key)}"><span class="rf-list-text"><span class="rf-list-title">${U.esc(name)}</span><span class="rf-list-sub">${U.esc(sub)}</span></span></button>
      ${l ? `<button type="button" class="rf-btn fd-again" data-shape="circle" data-size="sm" data-variant="soft" aria-label="${U.esc(`Add ${name}${amount ? `, ${amount}` : ''}`)}" data-act="foodAgain" data-arg="${U.esc(r.key)}">${U.icon('plus')}</button>` : ''}
    </div></li>`;
  }
  function listFor(S, which) {
    const f = F().data(S);
    if (which === 'favs') return remember(f.favs.map(lookup));
    if (which === 'mine') return remember(f.custom.slice().reverse().map(fromCustom));
    return [];
  }
  let sheet = null;
  let tab = 'recent';
  let query = '';
  let online = { busy: false, items: null, error: null, q: '' };
  // What's found (or the list picked): the part of Add food that changes while typing.
  function resultsHtml(S) {
    const f = F().data(S);
    const q = query.trim();
    let results = '';
    if (q) {
      const db = dbReady();
      const hits = db ? remember(db.search(q, { limit: 30 }).map(fromDb)) : [];
      const mine = remember(f.custom.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).map(fromCustom));
      const all = mine.concat(hits);
      results = `${all.length ? `<ul class="rf-list">${all.map(foodRow).join('')}</ul>` : `<p class="t-callout rf-muted fd-empty">${db ? 'No built-in food matches that.' : dbFailed ? 'The built-in food list didn\'t load. Quick add and your own foods still work.' : 'Loading the food list…'}</p>`}
        ${F().prefs(S).online ? onlineBlock(q) : ''}`;
    } else if (tab === 'meals') {
      results = f.saved.length ? `<ul class="rf-list">${f.saved.slice().reverse().map((m) => U.row({ title: U.esc(m.name), sub: `${U.plural(m.items.length, 'item')} · ${kcal(m.items.reduce((a, x) => a + x.kcal, 0))} kcal`, act: 'foodAddSaved', arg: m.id, chevron: true, key: `sm-${m.id}` })).join('')}</ul>` : '<p class="t-callout rf-muted fd-empty">Save a day\'s food as a meal to add it again in one tap.</p>';
    } else if (tab === 'recent') {
      const same = sameAs(S, addDay, addMeal);
      const sameRow = same.length ? `<ul class="rf-list fd-same-list">${U.row({ icon: 'repeat', tone: 'teal', title: sameWords(addDay), sub: U.esc(`${same.map((e) => e.name).join(', ')} · ${kcal(same.reduce((a, e) => a + e.kcal, 0))} kcal`), act: 'foodSame', arg: addMeal, key: 'same' })}</ul>` : '';
      const rows = F().regulars(S, addDay).slice(0, 25).map(regRow).filter(Boolean);
      results = `${sameRow}${rows.length ? `<ul class="rf-list">${rows.join('')}</ul>` : sameRow ? '' : '<p class="t-callout rf-muted fd-empty">Foods you log show up here, the ones you have most first.</p>'}`;
    } else {
      const list = listFor(S, tab);
      results = list.length ? `<ul class="rf-list">${list.map(foodRow).join('')}</ul>` : `<p class="t-callout rf-muted fd-empty">${tab === 'favs' ? 'Tap the star on a food to keep it here.' : 'Foods you create from a label show up here.'}</p>`;
    }
    return results;
  }
  function addBody(S) {
    const q = query.trim();
    shownQ = q;
    return `<div class="fd-pick">${mealSeg('foodAddMeal', addMeal, 'foodAddMeal')}</div>
      <div class="fd-search">
        <div class="rf-search fd-q"><input class="rf-input" type="search" id="foodQ" placeholder="Search foods" aria-label="Search foods" value="${U.esc(query)}" autocomplete="off" enterkeyhint="search"></div>
        ${F().prefs(S).online ? `<button type="button" class="rf-btn" data-shape="circle" aria-label="Scan a barcode" data-act="foodScan">${U.icon('scan')}</button>` : ''}
      </div>
      ${q ? '' : `<div class="fd-tabs" data-hscroll>${U.seg('foodTab', [['recent', 'Recent'], ['favs', 'Favourites'], ['mine', 'My foods'], ['meals', 'Meals']], tab, 'Lists', ' data-on="foodTab" data-size="sm"')}</div>`}
      <div class="fd-results">${resultsHtml(S)}</div>
      <ul class="rf-list fd-more">
        ${U.row({ icon: 'flame', tone: 'coral', title: 'Quick add calories', sub: 'Just the numbers', act: 'foodQuick', chevron: true })}
        ${U.row({ icon: 'pencil', tone: 'indigo', title: 'Create a food', sub: 'From a nutrition label', act: 'foodCreate', chevron: true })}
      </ul>`;
  }
  function onlineBlock(q) {
    if (online.busy) return '<div class="fd-online"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-footnote rf-muted">Searching Open Food Facts…</span></div>';
    if (online.q === q && online.items) return online.items.length ? `<h3 class="rf-list-header">Open Food Facts</h3><ul class="rf-list">${remember(online.items).map(foodRow).join('')}</ul>` : '<p class="t-footnote rf-muted fd-empty">Nothing found online either.</p>';
    if (online.q === q && online.error) return `<p class="t-footnote rf-muted fd-empty">${U.esc(online.error)}</p>`;
    return `<button type="button" class="rf-btn fd-online-btn" data-variant="soft" data-size="sm" data-act="foodOnline" data-haptic="tap">${U.icon('globe')}Search online for "${U.esc(q)}"</button>`;
  }
  function refresh() { if (sheet && !sheet.closed) sheet.update(addBody(U.S)); }
  // Only what's found (or listed) drawn again: the field, its caret and the keyboard's word in progress
  // are never touched. The rest is drawn again when the lists' switch comes or goes with the query.
  let shownQ = '';
  function refreshResults() {
    if (!sheet || sheet.closed) return;
    const box = sheet.el.querySelector('.fd-results');
    if (!box || !query.trim() !== !shownQ) { refresh(); return; }
    shownQ = query.trim();
    U.morph(box, resultsHtml(U.S));
  }
  // Add food: on Recent (the foods you have most, first), with the meal picked at the top.
  function openAdd(day, meal) {
    const S = U.S;
    ready(day, meal);
    query = ''; online = { busy: false, items: null, error: null, q: '' };
    const f = F().data(S);
    tab = f.recent.length || sameAs(S, addDay, addMeal).length ? 'recent' : 'mine';
    sheet = U.sheet({ title: addDay === U.today() ? 'Add food' : `Add food for ${dayWord(addDay)}`, size: 'full', cls: 'fd-sheet', body: addBody(S), onClose: () => { sheet = null; } });
    const input = sheet.el.querySelector('#foodQ');
    let timer = 0;
    // Search as you type (built-in list only; online search waits for Enter or the button): what's
    // found is drawn again a moment after the last key.
    sheet.el.addEventListener('input', (e) => {
      if (e.target.id !== 'foodQ') return;
      query = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const pos = e.target.selectionStart;
        const whole = !query.trim() !== !shownQ;
        refreshResults();
        const again = whole && sheet && sheet.el.querySelector('#foodQ');
        if (again && G.document.activeElement !== again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
      }, 120);
    });
    sheet.el.addEventListener('keydown', (e) => { if (e.target.id === 'foodQ' && e.key === 'Enter') { e.preventDefault(); if (F().prefs(U.S).online && query.trim()) U.act.foodOnline(); } });
    // The built-in list loads now: recents from it show their names, and search is ready (its index
    // built in a calm moment, so the first letters typed don't wait on it).
    const warm = () => { if (GH.foods && GH.foods.warm) (U.whenCalm || ((fn) => setTimeout(fn, 400)))(() => GH.foods.warm()); };
    if (!dbReady()) loadDb().then(() => { refreshResults(); warm(); }); else warm();
    if (input && !f.recent.length && !f.custom.length) setTimeout(() => input.focus(), 350);
  }
  U.act.foodAdd = (el) => openAdd(null, el && el.dataset && MEAL_NAME[el.dataset.arg] ? el.dataset.arg : null);
  U.on.foodTab = (el, ev, v) => { tab = v; refreshResults(); };
  U.on.foodAddMeal = (el, ev, v) => { if (!MEAL_NAME[v]) return; addMeal = v; addHand = true; refreshResults(); };
  U.act.foodOnline = async () => {
    const q = query.trim();
    if (!q || online.busy) return;
    online = { busy: true, items: null, error: null, q };
    refreshResults();
    try {
      const items = await GH.foodNet.search(q);
      online = { busy: false, items, error: null, q };
      rememberOff(items);
    } catch (e) {
      online = { busy: false, items: null, error: e.message || 'Online search didn\'t work. Try again in a minute.', q };
    }
    refreshResults();
  };
  function rememberOff(items) {
    const f = F().data(U.S);
    f.offCache = f.offCache || {};
    for (const x of items) f.offCache[x.ref] = x;
    const keys = Object.keys(f.offCache);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete f.offCache[k];
  }
  // Added in one tap, with Undo.
  function added(list, day, title) {
    U.commit();
    toHc();
    U.toast(title, 'positive', undefined, { label: 'Undo', onClick: () => { for (const e of list) F().remove(U.S, day, e.id); U.commit(); toHc(); U.haptic('undo'); } });
  }
  // A recent food again, as it was last logged, into the meal picked.
  U.act.foodAgain = (el) => {
    const S = U.S;
    const r = F().regulars(S, addDay).find((x) => x.key === el.dataset.arg);
    if (!r || !r.last) return;
    const l = r.last;
    const w = F().timeFor(S, addDay, addMeal);
    const e = F().add(S, addDay, { name: l.name, detail: l.detail, src: l.src, ref: l.ref, g: l.g, portion: l.portion, kcal: l.kcal, p: l.p, c: l.c, f: l.f, fib: l.fib, meal: addMeal, mh: addHand, at: w.at }, w.t);
    U.haptic('log');
    added([e], addDay, `${l.name} added to ${MEAL_NAME[addMeal].toLowerCase()}`);
  };
  // The same meal as the day before, in one tap.
  U.act.foodSame = (el) => {
    const S = U.S, meal = el.dataset.arg;
    const day = sheet ? addDay : dayShown();
    if (!MEAL_NAME[meal]) return;
    const list = F().copyMeal(S, day - 1, day, meal);
    if (!list.length) return;
    U.haptic('copy');
    if (sheet) sheet.close('ok');
    added(list, day, `${MEAL_NAME[meal]} added, ${kcal(list.reduce((a, e) => a + e.kcal, 0))} kcal`);
  };

  /* ---------------------------------------------------------------- portions */
  // How much: a portion (100 g, 1 cup, 1 serving…) times a quantity, or grams typed in; and the meal
  // and time.
  let pick = null; // { item, portion: [label, grams], qty, meal, mh, day, min, timeSet, edit? }
  function portionsOf(item) {
    const list = [];
    if (item.perServing && !item.servingG) list.push(['1 serving', null]);
    for (const p of item.portions || []) if (p[1] > 0 && !list.some((x) => x[0] === p[0])) list.push(p);
    // By weight only when the food's numbers per 100 g are known (a label without a serving weight
    // only gives them per serving).
    if (item.kcal != null) list.push(['100 g', 100], ['1 g', 1]);
    return list;
  }
  function nutrientsFor(item, portion, qty) {
    if (portion[1] == null && item.perServing) {
      const s = item.perServing;
      return { kcal: Math.round(s.kcal * qty), p: s.p * qty, c: s.c * qty, f: s.f * qty, fib: (s.fib || 0) * qty, g: null };
    }
    const grams = portion[1] * qty;
    return Object.assign(F().scale({ kcal: item.kcal || 0, p: item.p || 0, c: item.c || 0, f: item.f || 0, fib: item.fib || 0 }, grams), { g: grams });
  }
  // "Protein 2.5 g · Carbs 51 g · Fat 0.7 g", each kept whole on its line.
  const macroLine = (m) => [`Protein ${g1(m.p)} g`, `Carbs ${g1(m.c)} g`, `Fat ${g1(m.f)} g`, m.fib ? `Fibre ${g1(m.fib)} g` : ''].filter(Boolean).map(nb).join('\u00a0· ');
  // When a new entry would be: now (today), or the meal's usual time on an earlier day.
  const newMin = (day, meal) => (day === U.today() ? F().minOf(Date.now()) : F().usualMin(U.S, day, meal));
  function portionBody() {
    const { item, portion, qty, meal } = pick;
    const n = nutrientsFor(item, portion, qty);
    const fav = F().data(U.S).favs.includes(item.key);
    const qtyStep = portion[1] === 1 ? 10 : 0.25;
    const about = [item.detail, item.brand].filter(Boolean).join(' · ');
    return `<div class="sheet-pad fd-portion">
        ${about ? `<p class="t-footnote rf-muted">${U.esc(about)}</p>` : ''}
        <div class="fd-big"><span class="t-large-title rf-num">${U.roll(kcal(n.kcal))}</span><span class="t-callout rf-muted">kcal</span><span class="rf-spacer"></span>
          ${item.src !== 'quick' ? `<button type="button" class="rf-btn" data-shape="circle" data-variant="plain" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${fav}" data-act="foodFav">${U.icon('star')}</button>` : ''}</div>
        <p class="t-footnote rf-num fd-pcf">${macroLine({ p: n.p, c: n.c, f: n.f, fib: n.fib })}</p>
        <div class="ob-chips" role="group" aria-label="Portion">${portionsOf(item).map((p, i) => U.chip(p[1] === 1 ? 'Grams' : p[0], p[0] === portion[0], `data-act="foodPortion" data-arg="${i}"`)).join('')}</div>
        <div class="fd-qty">${U.stepper('foodQty', portion[1] === 1 ? Math.round(qty) : qty, qtyStep, portion[1] === 1 ? 5000 : 50, portion[1] === 1 ? 'Grams' : 'Amount', 'data-on="foodQty"', qtyStep)}<span class="t-callout rf-muted">${U.esc(portion[1] === 1 ? 'g' : `× ${portion[0]}`)}</span></div>
        ${mealSeg('foodMeal', meal, 'foodMeal')}
        ${timeField('foodTime', pick.min, 'foodTime')}
        <div class="btn-row fd-actions">
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodSave">${pick.edit ? 'Save' : 'Add'}</button>
          ${pick.edit ? '<button type="button" class="rf-btn" data-tone="critical" data-act="foodDelete">Delete</button>' : ''}
        </div>
      </div>`;
  }
  let psheet = null;
  function openPortion(item, opts) {
    const o = opts || {};
    const list = portionsOf(item);
    if (addDay == null) ready();
    const day = o.day != null ? o.day : addDay;
    const meal = o.meal || addMeal;
    pick = { item, portion: o.portion || list[0], qty: o.qty || 1, meal, mh: o.edit ? !!o.mh : addHand, day, min: o.min != null ? o.min : newMin(day, meal), timeSet: false, edit: o.edit || null };
    psheet = U.sheet({ title: item.name, size: 'auto', detent: 'large', body: portionBody(), onClose: () => { psheet = null; } });
  }
  const repaint = () => { if (psheet && !psheet.closed) psheet.update(portionBody()); };
  // The portion an entry was logged with, as the sheet offers it ("2 × 1 cup" is 2 of "1 cup"); one
  // the food no longer has is its weight in grams.
  function lastPortion(item, l) {
    const list = portionsOf(item);
    const m = /^(?:([\d.]+) × )?(.+)$/.exec(l.portion || '');
    const p = m && list.find((x) => x[0] === m[2]);
    if (p) return { portion: p, qty: m[1] ? Number(m[1]) : 1 };
    const grams = list.find((x) => x[1] === 1);
    return grams && l.g ? { portion: grams, qty: l.g } : {};
  }
  U.act.foodPick = async (el) => {
    const key = el.dataset.arg;
    const recent = !!(el.closest && el.closest('.fd-reg'));
    if (key.startsWith('usda:') && !dbReady()) await loadDb();
    const item = lookup(key);
    if (!item) { U.toast('That food isn\'t available right now', 'caution'); return; }
    // A recent food opens at the portion it was last logged with.
    const r = recent ? F().regulars(U.S, addDay).find((x) => x.key === key) : null;
    openPortion(item, r && r.last ? lastPortion(item, r.last) : undefined); // its sheet's opening has the haptic
  };
  U.act.foodPortion = (el) => {
    const list = portionsOf(pick.item);
    const next = list[Number(el.dataset.arg)];
    if (!next) return;
    // Keep the same amount when switching to grams.
    if (next[1] === 1 && pick.portion[1] > 1) pick.qty = Math.round(pick.portion[1] * pick.qty);
    else if (next[1] !== 1 && pick.portion[1] === 1) pick.qty = 1;
    pick.portion = next;
    U.haptic('select');
    repaint();
  };
  U.on.foodQty = (el, ev, v) => { const n = Number(v); if (n > 0) { pick.qty = n; repaint(); } };
  // A meal picked by hand stays; a new entry for an earlier day moves to that meal's usual time.
  U.on.foodMeal = (el, ev, v) => {
    if (!pick || !MEAL_NAME[v]) return;
    pick.meal = v; pick.mh = true;
    if (!pick.edit && !pick.timeSet && pick.day !== U.today()) { pick.min = F().usualMin(U.S, pick.day, v); repaint(); }
  };
  // A new time moves the entry to that time's meal, unless the meal was picked by hand.
  U.on.foodTime = (el, ev, v) => {
    const m = readTime(v);
    if (!pick || m == null) return;
    pick.min = m; pick.timeSet = true;
    if (!pick.mh) { pick.meal = F().mealFor(F().atClock(U.S, pick.day, m), U.S); repaint(); }
  };
  U.act.foodFav = () => { const on = F().toggleFav(U.S, pick.item.key); U.save(); U.haptic(on ? 'toggleOn' : 'toggleOff'); repaint(); };
  // The time an entry gets on saving: the one set in the sheet, else now (or the usual time).
  const whenFor = (o) => (o.timeSet ? { t: F().atClock(U.S, o.day, o.min), at: 'set' } : o.edit ? {} : F().timeFor(U.S, o.day, o.meal));
  U.act.foodSave = () => {
    const S = U.S;
    const { item, portion, qty, meal, day, edit } = pick;
    const n = nutrientsFor(item, portion, qty);
    const label = portion[1] === 1 ? `${Math.round(qty)} g` : `${qty === 1 ? '' : `${qty} × `}${portion[0]}`;
    const w = whenFor(pick);
    if (edit) F().update(S, day, edit, Object.assign({ meal, mh: pick.mh ? 1 : 0, g: n.g != null ? Math.round(n.g) : null, portion: label, kcal: n.kcal, p: Math.round(n.p * 10) / 10, c: Math.round(n.c * 10) / 10, f: Math.round(n.f * 10) / 10, fib: Math.round(n.fib * 10) / 10 }, w));
    else F().add(S, day, { name: item.name, detail: item.detail, src: item.src, ref: item.ref, g: n.g, portion: label, meal, mh: pick.mh, at: w.at, kcal: n.kcal, p: n.p, c: n.c, f: n.f, fib: n.fib }, w.t);
    U.commit();
    U.haptic(edit ? 'save' : 'log');
    if (psheet) psheet.close('ok');
    if (sheet && !edit) sheet.close('ok');
    toHc();
    if (!edit) U.toast(`${item.name} added to ${MEAL_NAME[meal].toLowerCase()}`, 'positive');
  };
  U.act.foodEdit = async (el) => {
    const [dStr, id] = el.dataset.arg.split(':');
    const day = Number(dStr);
    const e = F().entries(U.S, day).find((x) => x.id === id);
    if (!e) return;
    // A food from the built-in list edits by weight, which needs the list (it loads on first use).
    if (e.src === 'usda' && !dbReady()) await loadDb();
    const item = e.ref != null ? lookup(`${e.src}:${e.ref}`) : null;
    if (item && item.kcal != null && e.g) { openPortion(item, { portion: portionsOf(item).find((x) => x[1] === 1), qty: e.g, meal: e.meal, mh: e.mh, day, min: F().minOf(e.t), edit: id }); return; }
    // Quick adds and servings: edit the numbers directly.
    quickSheet({ day, edit: e });
  };
  // Taken out in one tap, with Undo, which puts it back as it was.
  function removed(day, id) {
    const e = F().remove(U.S, day, id);
    U.commit();
    U.haptic('remove');
    toHc();
    if (e) U.toast(`${e.name} removed`, 'neutral', undefined, { label: 'Undo', onClick: () => { if (F().restore(U.S, day, e)) { U.commit(); toHc(); U.haptic('undo'); } } });
  }
  U.act.foodDelete = () => {
    if (!pick || !pick.edit) return;
    if (psheet) psheet.close('ok');
    removed(pick.day, pick.edit);
  };

  /* ---------------------------------------------------------------- quick add, create, saved */
  const numField = (id, label, v, extra) => `<div class="rf-field"><label class="rf-field-label" for="${id}">${U.esc(label)}</label><div class="rf-field-control"><input class="rf-input" id="${id}" type="number" inputmode="decimal" min="0" step="any" value="${v == null ? '' : U.esc(v)}" ${extra || ''}></div></div>`;
  const textField = (id, label, v, ph) => `<div class="rf-field"><label class="rf-field-label" for="${id}">${U.esc(label)}</label><div class="rf-field-control"><input class="rf-input" id="${id}" type="text" maxlength="60" value="${U.esc(v || '')}" placeholder="${U.esc(ph || '')}"></div></div>`;
  const val = (id) => { const x = parseFloat((doc.getElementById(id) || {}).value); return Number.isFinite(x) && x >= 0 ? x : null; };
  // Quick add (and editing what isn't by weight): the numbers, the meal and the time.
  let quick = null; // { day, edit?, meal, mh, min, timeSet, vals }
  let qctl = null;
  function quickBody() {
    const e = quick.edit, v = quick.vals || {};
    const pickV = (k, from) => (v[k] != null ? v[k] : e ? from : null);
    return `<div class="sheet-pad fd-form">
        ${textField('qName', 'Name (optional)', v.qName != null ? v.qName : e ? e.name : '', 'Lunch out')}
        <div class="ob-row2">${numField('qKcal', 'Calories', pickV('qKcal', e && e.kcal), 'required')}${numField('qP', 'Protein (g)', pickV('qP', e && e.p))}</div>
        <div class="ob-row2">${numField('qF', 'Fat (g)', pickV('qF', e && e.f))}${numField('qC', 'Carbs (g)', pickV('qC', e && e.c))}</div>
        ${mealSeg('qMeal', quick.meal, 'quickMeal')}
        ${timeField('qTime', quick.min, 'quickTime')}
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodQuickSave">${e ? 'Save' : 'Add'}</button>
        ${e ? '<button type="button" class="rf-btn" data-tone="critical" data-act="foodQuickDelete">Delete</button>' : ''}</div>
      </div>`;
  }
  function quickSheet(o) {
    const e = o.edit;
    if (!e && addDay == null) ready();
    const day = e ? o.day : addDay;
    const meal = e ? e.meal : addMeal;
    quick = { day, edit: e || null, meal, mh: e ? !!e.mh : addHand, min: e ? F().minOf(e.t) : newMin(day, meal), timeSet: false, vals: null };
    qctl = U.sheet({ title: e ? 'Edit' : 'Quick add', size: 'auto', detent: 'large', body: quickBody(), onClose: () => { qctl = null; } });
  }
  // Redrawn with what's typed so far.
  const quickRepaint = () => {
    if (!qctl || qctl.closed) return;
    quick.vals = {};
    for (const id of ['qName', 'qKcal', 'qP', 'qC', 'qF']) { const el = doc.getElementById(id); if (el) quick.vals[id] = el.value; }
    qctl.update(quickBody());
  };
  U.on.quickMeal = (el, ev, v) => {
    if (!quick || !MEAL_NAME[v]) return;
    quick.meal = v; quick.mh = true;
    if (!quick.edit && !quick.timeSet && quick.day !== U.today()) { quick.min = F().usualMin(U.S, quick.day, v); quickRepaint(); }
  };
  U.on.quickTime = (el, ev, v) => {
    const m = readTime(v);
    if (!quick || m == null) return;
    quick.min = m; quick.timeSet = true;
    if (!quick.mh) { quick.meal = F().mealFor(F().atClock(U.S, quick.day, m), U.S); quickRepaint(); }
  };
  U.act.foodQuick = () => quickSheet({});
  U.act.foodQuickSave = () => {
    const k = val('qKcal');
    if (!(k > 0 && k < 10000)) { U.haptic('deny'); U.toast('Enter the calories', 'caution'); return; }
    const S = U.S, o = quick;
    const x = { name: ((doc.getElementById('qName') || {}).value || '').trim() || 'Quick add', kcal: k, p: val('qP') || 0, c: val('qC') || 0, f: val('qF') || 0 };
    const w = whenFor(o);
    // Editing keeps where the entry came from (a food from the list stays that food).
    if (o.edit) F().update(S, o.day, o.edit.id, Object.assign(x, { meal: o.meal, mh: o.mh ? 1 : 0 }, w));
    else F().add(S, o.day, Object.assign({ src: 'quick', meal: o.meal, mh: o.mh, at: w.at }, x), w.t);
    U.commit();
    U.haptic(o.edit ? 'save' : 'log');
    U.closeSheets();
    toHc();
  };
  U.act.foodQuickDelete = () => { if (!quick || !quick.edit) return; U.closeSheets(); removed(quick.day, quick.edit.id); };
  // Create a food from its label (optionally for a barcode that wasn't found).
  function createSheet(prefill) {
    const p = prefill || {};
    U.sheet({
      title: 'Create a food', size: 'auto', detent: 'large',
      body: `<div class="sheet-pad fd-form">
        <p class="t-footnote rf-muted">Copy the numbers from the label, per serving.</p>
        ${textField('cName', 'Name', p.name || '', 'Protein bar')}
        <div class="ob-row2">${numField('cKcal', 'Calories', null)}${numField('cG', 'Serving (g)', p.servingG || null)}</div>
        <div class="ob-row2">${numField('cP', 'Protein (g)', null)}${numField('cC', 'Carbs (g)', null)}</div>
        <div class="ob-row2">${numField('cF', 'Fat (g)', null)}${numField('cFib', 'Fibre (g)', null)}</div>
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodCreateSave" data-arg="${U.esc(p.barcode || '')}">Save and add</button></div>
      </div>`,
    });
  }
  U.act.foodCreate = () => createSheet({ name: query.trim() });
  U.act.foodCreateSave = (el) => {
    const name = ((doc.getElementById('cName') || {}).value || '').trim();
    const k = val('cKcal');
    if (!name) { U.haptic('deny'); U.toast('Give it a name', 'caution'); return; }
    if (!(k >= 0 && k < 5000)) { U.haptic('deny'); U.toast('Enter the calories per serving', 'caution'); return; }
    const c = F().addCustom(U.S, { name, servingG: val('cG'), kcal: k, p: val('cP') || 0, c: val('cC') || 0, f: val('cF') || 0, fib: val('cFib') || 0 });
    if (el.dataset.arg) { const f = F().data(U.S); f.barcodes = f.barcodes || {}; f.barcodes[el.dataset.arg] = c.id; }
    U.save();
    U.closeSheets();
    openPortion(fromCustom(c));
  };
  U.act.foodAddSaved = (el) => {
    const S = U.S;
    const w = F().timeFor(S, addDay, addMeal);
    const list = F().addSaved(S, addDay, el.dataset.arg, addMeal, { t: w.t, at: w.at, mh: addHand });
    U.haptic('log');
    U.closeSheets();
    added(list, addDay, `${U.plural(list.length, 'item')} added to ${MEAL_NAME[addMeal].toLowerCase()}`);
  };
  U.act.foodSavedMeals = () => { tab = 'meals'; openAdd(dayShown(), null); tab = 'meals'; refresh(); };
  U.act.foodSaveDay = () => {
    if (!F().entries(U.S, dayShown()).length) return;
    U.sheet({ title: 'Save as a meal', size: 'fit', body: `<div class="sheet-pad fd-form">${textField('mName', 'Name', '', 'My usual breakfast')}<p class="t-footnote rf-muted">Everything logged ${dayShown() === U.today() ? 'today' : 'on this day'} goes under Meals, to add again in one tap.</p>
      <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodSaveDayOk">Save</button></div></div>` });
  };
  U.act.foodSaveDayOk = () => {
    const name = ((doc.getElementById('mName') || {}).value || '').trim() || 'My meal';
    F().saveMeal(U.S, name, F().entries(U.S, dayShown()));
    U.save();
    U.closeSheets();
    U.haptic('save');
    U.toast('Saved to Meals', 'positive');
  };
  // The whole day before, each entry at the same time in the same meal: one tap, with Undo.
  U.act.foodCopyYesterday = () => {
    const day = dayShown();
    const list = F().copyMeal(U.S, day - 1, day, null);
    if (!list.length) { U.haptic('deny'); U.toast('Nothing logged the day before', 'neutral'); return; }
    U.haptic('copy');
    added(list, day, `${U.plural(list.length, 'item')} added, ${kcal(list.reduce((a, e) => a + e.kcal, 0))} kcal`);
  };

  /* ---------------------------------------------------------------- starting */
  // Track calories: one short sheet with the target the app suggests from what it knows (weight,
  // height, age, sex, activity, and your goal and its pace), each of them changeable, and Start. A
  // missing weight is asked for right there; everything else waits for Settings.
  let st = null, sctl = null;
  function startDraft() {
    const S = U.S, p = S.profile, fp = F().prefs(S), day = U.today();
    const kg = B().weightStats(S, day).current || p.weightKg || null;
    // (askW: there was no weight, so its field stays at the top while the sheet is open.)
    return { goal: p.weightGoal || 'maintain', pace: fp.pace || 0.5, activity: fp.activity || 'auto', kg, kg0: kg, askW: !kg, cm: p.heightCm || null, age: p.age || null, sex: p.sex || '', more: false };
  }
  // The target for the draft, worked out on a copy of the state.
  function draftTargets(S, d) {
    const day = U.today();
    const profile = Object.assign({}, S.profile, { weightGoal: d.goal, heightCm: d.cm, age: d.age, sex: d.sex || null, weightKg: d.kg, food: Object.assign({}, F().prefs(S), { pace: d.pace, activity: d.activity }) });
    const weights = d.kg && d.kg !== d.kg0 ? S.weights.filter((w) => w.day !== day).concat({ day, kg: d.kg, src: 'manual' }) : S.weights;
    try { return F().targets({ profile, weights, health: S.health, food: S.food, protein: S.protein, log: S.log }, day); } catch (e) { return null; }
  }
  // The fields as they show a draft's values (what was typed is only read when it differs, so
  // rounding for display never changes a number nobody touched).
  const wNum = (kg) => (kg ? String(Math.round(U.kgTo(kg) * 10) / 10) : '');
  const ftIn = (cm) => { const n = Math.round(cm / 2.54); return [Math.floor(n / 12), n % 12]; };
  function startBody() {
    const S = U.S, d = st, lb = U.lb();
    const t = draftTargets(S, d);
    const af = F().activityFactor(S, U.today());
    const height = d.cm ? (lb ? `${ftIn(d.cm)[0]} ft ${ftIn(d.cm)[1]} in` : `${Math.round(d.cm)} cm`) : null;
    const moves = d.activity !== 'auto' ? `${d.activity} activity` : af.steps ? `about ${U.num(Math.round(af.steps / 100) * 100)} steps a day` : 'light activity until your steps sync';
    const basis = [d.kg ? U.fmtW(d.kg) : null, height, d.age ? `age ${d.age}` : null, d.sex || null].filter(Boolean).join(', ');
    const missing = d.askW;
    const kgField = numField('fsW', `Your weight (${U.wUnit()})`, wNum(d.kg), 'data-on="fsField" data-k="w" enterkeyhint="done"');
    const ageField = numField('fsAge', 'Age', d.age || '', 'data-on="fsField" data-k="age"');
    const more = d.more ? `<div class="fd-start-more">
        ${lb ? `<div class="ob-row2">${missing ? '' : kgField}${ageField}</div><div class="ob-row2">${numField('fsFt', 'Height (ft)', d.cm ? ftIn(d.cm)[0] : '', 'data-on="fsField" data-k="ft"')}${numField('fsIn', '(in)', d.cm ? ftIn(d.cm)[1] : '', 'data-on="fsField" data-k="in"')}</div>`
          : `<div class="ob-row2">${missing ? '' : kgField}${numField('fsCm', 'Height (cm)', d.cm ? Math.round(d.cm) : '', 'data-on="fsField" data-k="cm"')}</div>${ageField}`}
        ${U.seg('fsSex', [['female', 'Female'], ['male', 'Male'], ['', 'Skip']], d.sex || '', 'Sex', ' data-on="fsSex" data-size="sm" data-block')}
        <div class="fd-start-k"><span class="t-subhead">Activity</span>${U.choice('fsAct', [['auto', 'From steps'], ['light', 'Light'], ['moderate', 'Moderate'], ['active', 'Active']], d.activity, 'Activity', ' data-on="fsAct"')}</div>
      </div>` : '';
    return `<div class="sheet-pad fd-start">
        <div class="fd-target" data-key="target">${t ? `<span class="fd-target-n rf-num">${U.roll(kcal(t.kcal))}</span><span class="t-callout">calories a day</span><span class="t-footnote rf-muted rf-num">${macroLine({ p: t.protein, c: t.carbs, f: t.fat })}</span>` : '<span class="t-callout">Your weight sets the target.</span>'}</div>
        ${missing ? kgField : ''}
        ${U.seg('fsGoal', [['lose', 'Lose'], ['maintain', 'Keep'], ['gain', 'Gain']], d.goal, 'Goal', ' data-on="fsGoal" data-block')}
        ${d.goal === 'lose' ? `<div class="fd-start-k"><span class="t-subhead">A week</span>${U.seg('fsPace', [['0.25', '0.25%'], ['0.5', '0.5%'], ['0.75', '0.75%'], ['1', '1%']], String(d.pace), 'Pace', ' data-on="fsPace" data-size="sm" data-block')}</div>` : ''}
        <p class="t-footnote rf-muted fd-basis">${U.esc(`From ${basis ? `${basis} and ` : ''}${moves}.`)}${d.more ? '' : ` ${link('fsMore', '', 'Change')}`}</p>
        ${more}
        <button type="button" class="rf-btn rf-glass fd-start-go" data-variant="tinted" data-size="lg" data-act="fsGo">Start</button>
      </div>`;
  }
  function startSheet(thenAdd) {
    st = startDraft();
    st.then = !!thenAdd;
    sctl = U.sheet({ title: 'Track calories', size: 'auto', detent: 'large', body: startBody(), onClose: () => { sctl = null; } });
  }
  // (Never inside another redraw: a field it takes away can fire its change as it goes.)
  let painting = false;
  const startRepaint = () => {
    if (!sctl || sctl.closed || painting) return;
    painting = true;
    try { sctl.update(startBody()); } finally { painting = false; }
  };
  U.act.foodStart = () => startSheet(false);
  U.on.fsGoal = (el, ev, v) => { if (st) { st.goal = v; startRepaint(); } };
  U.on.fsPace = (el, ev, v) => { if (st) { st.pace = Number(v) || 0.5; startRepaint(); } };
  U.on.fsSex = (el, ev, v) => { if (st) { st.sex = v || ''; startRepaint(); } };
  U.on.fsAct = (el, ev, v) => { if (st && (v === 'auto' || F().ACTIVITY[v])) { st.activity = v; startRepaint(); } };
  // The fields typed in: weight in the person's units, height in ft and in (or cm), age. A field
  // still showing the draft's value is left as it is.
  function readStart() {
    const get = (id) => { const el = doc.getElementById(id); return el ? el.value.trim() : null; };
    const num = (s) => { const x = parseFloat(s); return Number.isFinite(x) ? x : null; };
    const w = get('fsW');
    if (w != null && w !== wNum(st.kg)) st.kg = num(w) > 0 ? U.toKg(num(w)) : null;
    const cm = get('fsCm');
    if (cm != null && cm !== (st.cm ? String(Math.round(st.cm)) : '')) st.cm = num(cm) >= 90 && num(cm) <= 250 ? num(cm) : null;
    const ft = get('fsFt'), inch = get('fsIn');
    const was = st.cm ? ftIn(st.cm).map(String) : ['', ''];
    if (ft != null && (ft !== was[0] || inch !== was[1])) st.cm = num(ft) >= 3 && num(ft) <= 8 ? Math.round((num(ft) * 12 + (num(inch) || 0)) * 2.54) : null;
    const age = get('fsAge');
    if (age != null && age !== String(st.age || '')) st.age = num(age) >= 13 && num(age) <= 100 ? Math.round(num(age)) : null;
  }
  U.on.fsField = () => { if (st) { readStart(); startRepaint(); } };
  U.act.fsMore = () => { if (!st) return; st.more = true; U.haptic('select'); startRepaint(); if (sctl && sctl.detent) setTimeout(() => sctl && sctl.detent('large'), 60); };
  U.act.fsGo = async () => {
    if (!st || !sctl) return;
    readStart();
    const S = U.S, p = S.profile, day = U.today(), d = st;
    if (!(d.kg >= 25 && d.kg <= 320)) { U.haptic('deny'); U.toast('Add your weight for your target', 'caution'); const el = doc.getElementById('fsW'); if (el) el.focus(); return; }
    if (d.kg !== d.kg0) { B().addWeight(S, day, d.kg, 'manual'); if (!p.weightKg) p.weightKg = Math.round(d.kg * 10) / 10; }
    Object.assign(p, { weightGoal: d.goal, heightCm: d.cm || p.heightCm || null, sex: d.sex || null });
    // Age shapes the workout plan too: it goes in the way Your answers puts it in.
    if (d.age && d.age !== p.age) B().reprogram(S, { age: d.age }, day);
    const fp = F().prefs(S);
    fp.pace = d.pace; fp.activity = d.activity;
    F().setMode(S, 'full');
    const t = F().targets(S, day);
    U.save(true);
    U.haptic('success');
    sctl.close('ok');
    U.render();
    U.toast('Calorie tracking is on', 'positive', t ? `Your target is about ${kcal(t.kcal)} kcal a day. Your food is at the top of Health.` : 'Your food is at the top of Health.');
    if (d.then) setTimeout(() => openAdd(U.today(), null), 360);
  };

  /* ---------------------------------------------------------------- meal times */
  // Settings (and the Food page): when breakfast, lunch and dinner are, and whether they follow the
  // logs. Times changed here are yours: learning goes off until it's turned on again.
  let mt = null, mctl = null;
  const learnedWin = (S) => { const fp = F().prefs(S), was = fp.learn; fp.learn = true; const w = F().mealTimes(S, U.today()).win; fp.learn = was; return w; };
  function timesBody() {
    const input = (k, i) => `<span class="rf-field-control"><input class="rf-input" type="time" id="mt-${k}-${i}" value="${fieldTime(mt.win[k][i])}" data-on="mtTime" data-k="${k}" data-i="${i}" aria-label="${MEAL_NAME[k]} ${i ? 'until' : 'from'}"></span>`;
    const row = (k) => `<div class="fd-trow" data-key="t-${k}"><span class="t-subhead">${MEAL_NAME[k]}</span><span class="fd-tspan">${input(k, 0)}<span class="t-footnote rf-muted">to</span>${input(k, 1)}</span></div>`;
    return `<div class="sheet-pad fd-times">
        <p class="t-footnote rf-muted">Food goes in the meal for the time you add it. You can always pick another.</p>
        ${['breakfast', 'lunch', 'dinner'].map(row).join('')}
        <div class="fd-trow is-any"><span class="t-subhead">Snacks</span><span class="t-footnote rf-muted">Any other time</span></div>
        <ul class="rf-list fd-tlearn">${U.sw('Learn from my logs', mt.learn, 'data-on="mtLearn"', 'Moves each meal to when you usually log it, over the last 4 weeks')}</ul>
        <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="mtSave">Save</button>
      </div>`;
  }
  U.act.foodMealTimes = () => {
    const S = U.S, fp = F().prefs(S);
    const w = F().mealTimes(S, U.today()).win;
    mt = { learn: fp.learn !== false, win: { breakfast: w.breakfast.slice(), lunch: w.lunch.slice(), dinner: w.dinner.slice() }, edited: false };
    mctl = U.sheet({ title: 'Meal times', size: 'auto', detent: 'large', body: timesBody(), onClose: () => { mctl = null; } });
  };
  const timesRepaint = () => { if (mctl && !mctl.closed) mctl.update(timesBody()); };
  U.on.mtTime = (el, ev, v) => {
    const m = readTime(v), k = el.dataset.k;
    if (!mt || m == null || !mt.win[k]) return;
    mt.win[k][Number(el.dataset.i) ? 1 : 0] = m;
    mt.edited = true;
    if (mt.learn) { mt.learn = false; timesRepaint(); }
  };
  U.on.mtLearn = (el, ev, v) => {
    if (!mt) return;
    mt.learn = !!v;
    if (v) { const w = learnedWin(U.S); mt.win = { breakfast: w.breakfast.slice(), lunch: w.lunch.slice(), dinner: w.dinner.slice() }; mt.edited = false; timesRepaint(); }
  };
  U.act.mtSave = () => {
    if (!mt || !mctl) return;
    const S = U.S, fp = F().prefs(S), w = mt.win;
    // In the day's order (from the start of the day), each with some length, none overlapping.
    const r = (m) => (m - U.rollHour() * 60 + 1440) % 1440;
    const len = (x) => (x[1] - x[0] + 1440) % 1440;
    const ok = ['breakfast', 'lunch', 'dinner'].every((k) => len(w[k]) >= 30) && r(w.breakfast[0]) + len(w.breakfast) <= r(w.lunch[0]) && r(w.lunch[0]) + len(w.lunch) <= r(w.dinner[0]);
    if (!mt.learn && !ok) { U.haptic('deny'); U.toast('Meals can\'t overlap', 'caution', 'Breakfast, lunch and dinner each need their own time, in that order.'); return; }
    if (!mt.learn) fp.meals = { breakfast: w.breakfast.slice(), lunch: w.lunch.slice(), dinner: w.dinner.slice() };
    fp.learn = mt.learn;
    U.save();
    U.haptic('save');
    mctl.close('ok');
    U.render();
  };

  /* ---------------------------------------------------------------- barcode */
  U.act.foodScan = async () => {
    const S = U.S;
    if (!F().prefs(S).online) {
      const ok = await U.confirm('Look up barcodes online?', 'Each barcode is looked up on Open Food Facts. Only barcodes and search words are sent. You can turn it off in Settings.', 'Turn on');
      if (!ok) return;
      F().prefs(S).online = true;
      U.save();
      U.render();
      refresh();
    }
    if (!GH.scanner) { U.toast('Scanning isn\'t available here', 'caution'); return; }
    if (!sheet) ready();
    try {
      const code = await GH.scanner.scan();
      if (!code) return; // the scanner played scan as it caught the code; logging it has its own
      const f = F().data(U.S);
      if (f.barcodes && f.barcodes[code]) { const c = f.custom.find((x) => x.id === f.barcodes[code]); if (c) { U.closeSheets(); openPortion(fromCustom(c)); return; } }
      U.toast('Looking it up…', 'neutral');
      const item = await GH.foodNet.barcode(code);
      if (!item) {
        const ok = await U.confirm('Not found', 'Open Food Facts doesn\'t know this barcode yet. Create it from the label? It\'s kept for next time.', 'Create it');
        if (ok) createSheet({ barcode: code });
        return;
      }
      rememberOff([item]);
      found.set(item.key, item);
      U.closeSheets();
      openPortion(item);
    } catch (e) {
      U.toast(e.message || 'Couldn\'t scan', 'caution');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
