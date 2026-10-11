/* Food (calorie and macro tracking, when it's on): the day's rings and meals, a search over the
 * built-in foods (USDA, loaded on first use), recents, favourites, your own foods and saved meals,
 * quick add, and (only if you turn it on) Open Food Facts search and barcode scanning.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const F = () => GH.food;
  const doc = G.document;

  let foodDay = null; // the day the Food tab shows (today unless you step back)
  const dayShown = () => (foodDay != null && foodDay <= U.today() && foodDay >= U.today() - 30 ? foodDay : U.today());
  const kcal = (n) => `${U.num(Math.round(n))}`;
  const g1 = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  const MEAL_NAME = Object.fromEntries([['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']]);

  /* ---------------------------------------------------------------- the rings */
  // Calories as a ring, macros as bars, against today's targets.
  function summary(S, day, compact) {
    const t = F().targets(S, day);
    const tot = F().totals(S, day);
    if (!t) return `<p class="t-callout rf-muted">Add your weight and height for a calorie target.</p><button type="button" class="rf-btn" data-act="editStep" data-arg="about">Add them</button>`;
    const left = t.kcal - tot.kcal;
    const bar = (label, have, want, tone) => `<div class="fd-macro"><span class="t-footnote">${label}</span>${U.progress(want ? have / want : 0, label, have > want * 1.1 ? 'caution' : tone)}<span class="t-caption rf-muted rf-num">${g1(have)} / ${want} g</span></div>`;
    return `<div class="fd-sum${compact ? ' is-compact' : ''}">
        ${U.ring(Math.min(1, tot.kcal / t.kcal), 'Calories today', `<span class="fd-ring-n rf-num">${U.roll(kcal(Math.abs(left)))}</span><span class="fd-ring-l t-caption rf-muted">${left >= 0 ? 'left' : 'over'}</span>`, compact ? 'md' : 'lg', left < -t.kcal * 0.1 ? 'caution' : 'accent')}
        <div class="fd-macros">
          <p class="t-callout rf-num"><b>${U.roll(kcal(tot.kcal))}</b> of ${kcal(t.kcal)} kcal</p>
          ${bar('Protein', tot.p, t.protein, 'positive')}${bar('Carbs', tot.c, t.carbs, 'accent')}${bar('Fat', tot.f, t.fat, 'accent')}
        </div>
      </div>`;
  }

  // Today's card (calorie mode). Protein-only mode keeps the protein card.
  U.foodCard = (S, day) => {
    if (!F() || !F().full(S)) return '';
    return `<div class="card fd-card" data-key="food">
      <div class="row-between"><span class="t-headline">Food</span><button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="goFood">Open</button></div>
      ${summary(S, day, true)}
      <div class="btn-row"><button type="button" class="rf-btn" data-variant="soft" data-act="foodAdd">${U.icon('plus')}Log food</button>${GH.food.prefs(S).online ? `<button type="button" class="rf-btn" data-act="foodScan">${U.icon('scan')}Scan</button>` : ''}</div>
    </div>`;
  };
  U.act.goFood = () => U.go('food');

  /* ---------------------------------------------------------------- the screen */
  function entryRow(e, day) {
    const amount = e.portion ? e.portion : e.g ? `${e.g} g` : '';
    return U.row({ title: U.esc(e.name), sub: U.esc([amount, `P ${g1(e.p)} · C ${g1(e.c)} · F ${g1(e.f)}`].filter(Boolean).join(' · ')), detail: `${kcal(e.kcal)}`, act: 'foodEdit', arg: `${day}:${e.id}`, key: `fe-${e.id}` });
  }
  U.screens.food = {
    render(S) {
      const today = U.today();
      const day = dayShown();
      const meals = F().byMeal(S, day);
      const tot = F().totals(S, day);
      const t = F().targets(S, day);
      const label = day === today ? 'Today' : day === today - 1 ? 'Yesterday' : U.fmtDay(day);
      const mealCards = F().MEALS.map(([id, name]) => {
        const list = meals[id];
        const sum = list.reduce((a, e) => a + e.kcal, 0);
        return `<div class="card fd-meal" data-key="meal-${id}">
          <div class="fd-meal-head"><span class="t-headline">${name}</span><span class="t-footnote rf-muted rf-num">${list.length ? `${kcal(sum)} kcal` : ''}</span><span class="rf-spacer"></span>
            <button type="button" class="rf-btn" data-shape="circle" data-size="sm" aria-label="Add to ${name.toLowerCase()}" data-act="foodAdd" data-arg="${id}">${U.icon('plus')}</button></div>
          ${list.length ? `<ul class="rf-list fd-list">${list.map((e) => entryRow(e, day)).join('')}</ul>` : ''}
        </div>`;
      }).join('');
      const other = tot.other && tot.other.kcal ? `<div class="card" data-key="other"><div class="row-between"><span class="t-subhead">From other apps</span><span class="t-callout rf-num">${kcal(tot.other.kcal)} kcal</span></div><p class="t-footnote rf-muted">Shared through Health Connect, and counted in the total.</p></div>` : '';
      const why = t ? `${t.learned ? `Your burn, learned from your logs and weight, is about ${kcal(t.burn)} kcal a day` : `Your estimated burn is about ${kcal(t.burn)} kcal a day`}${t.delta ? `, ${t.delta < 0 ? 'minus' : 'plus'} ${kcal(Math.abs(t.delta))} to ${t.delta < 0 ? 'lose' : 'gain'} steadily` : ''}.` : '';
      return `${U.navbar('Food', U.glassBtn('plus', 'Log food', 'foodAdd'))}
        <h1 class="rf-large-title">Food</h1>
        <div class="lt-sub fd-days">
          <button type="button" class="rf-btn" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Day before" data-act="foodDayPrev"${day <= today - 30 ? ' aria-disabled="true"' : ''}>${U.icon('chevron-left')}</button>
          <span class="t-callout">${U.esc(label)}</span>
          <button type="button" class="rf-btn" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Day after" data-act="foodDayNext"${day >= today ? ' aria-disabled="true"' : ''}>${U.icon('chevron-right')}</button>
        </div>
        <div class="section">
          ${U.tip ? U.tip('food') : ''}
          <div class="card" data-key="sum">${summary(S, day, false)}${why ? `<p class="t-footnote rf-muted">${U.esc(why)} ${U.whyLink ? U.whyLink('calories', 'How it\'s worked out') : ''}</p>` : ''}</div>
          ${mealCards}
          ${other}
          <div class="btn-row fd-tools" data-key="tools">
            <button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="foodCopyYesterday">${U.icon('copy')}Copy yesterday</button>
            <button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="foodSavedMeals">${U.icon('bookmark')}Saved meals</button>
            ${F().entries(S, day).length ? `<button type="button" class="rf-btn" data-variant="soft" data-size="sm" data-act="foodSaveDay">${U.icon('star')}Save as a meal</button>` : ''}
          </div>
          <p class="t-footnote rf-muted" data-key="src">Built-in foods from the USDA's nutrient database.${F().prefs(S).online ? ' Online results and barcodes from Open Food Facts (ODbL).' : ''}</p>
        </div>`;
    },
    float() { return ''; },
  };
  U.act.foodDayPrev = () => { foodDay = Math.max(U.today() - 30, dayShown() - 1); U.haptic('day'); U.render(); };
  U.act.foodDayNext = () => { foodDay = Math.min(U.today(), dayShown() + 1); U.haptic('day'); U.render(); };

  /* ---------------------------------------------------------------- adding food */
  // The meal a new entry goes into: the one you tapped, else by the time of day.
  let addMeal = null;
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

  function listFor(S, tab) {
    const f = F().data(S);
    if (tab === 'recent') return remember(f.recent.map(lookup)).slice(0, 25);
    if (tab === 'favs') return remember(f.favs.map(lookup));
    if (tab === 'mine') return remember(f.custom.slice().reverse().map(fromCustom));
    return [];
  }
  let sheet = null;
  let tab = 'recent';
  let query = '';
  let online = { busy: false, items: null, error: null, q: '' };
  function addBody(S) {
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
    } else {
      const list = listFor(S, tab);
      const empty = { recent: 'Foods you log show up here.', favs: 'Tap the star on a food to keep it here.', mine: 'Foods you create from a label show up here.' }[tab];
      results = tab === 'meals'
        ? (f.saved.length ? `<ul class="rf-list">${f.saved.slice().reverse().map((m) => U.row({ title: U.esc(m.name), sub: `${m.items.length} items · ${kcal(m.items.reduce((a, x) => a + x.kcal, 0))} kcal`, act: 'foodAddSaved', arg: m.id, chevron: true })).join('')}</ul>` : '<p class="t-callout rf-muted fd-empty">Save a day\'s food as a meal to add it again in one tap.</p>')
        : list.length ? `<ul class="rf-list">${list.map(foodRow).join('')}</ul>` : `<p class="t-callout rf-muted fd-empty">${empty}</p>`;
    }
    return `<div class="fd-search">
        <div class="rf-search fd-q"><input class="rf-input" type="search" id="foodQ" placeholder="Search foods" aria-label="Search foods" value="${U.esc(query)}" autocomplete="off" enterkeyhint="search"></div>
        ${F().prefs(S).online ? `<button type="button" class="rf-btn" data-shape="circle" aria-label="Scan a barcode" data-act="foodScan">${U.icon('scan')}</button>` : ''}
      </div>
      ${q ? '' : `<div class="fd-tabs" data-hscroll>${U.seg('foodTab', [['recent', 'Recent'], ['favs', 'Favourites'], ['mine', 'My foods'], ['meals', 'Meals']], tab, 'Lists', ' data-on="foodTab" data-size="sm"')}</div>`}
      <div class="fd-results">${results}</div>
      <ul class="rf-list fd-more">
        ${U.row({ icon: 'flame', tone: 'coral', title: 'Quick add calories', sub: 'Just the numbers', act: 'foodQuick', chevron: true })}
        ${U.row({ icon: 'pencil', tone: 'indigo', title: 'Create a food', sub: 'From a nutrition label', act: 'foodCreate', chevron: true })}
      </ul>`;
  }
  function onlineBlock(q) {
    if (online.busy) return '<div class="fd-online"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-footnote rf-muted">Searching Open Food Facts…</span></div>';
    if (online.q === q && online.items) return online.items.length ? `<h3 class="rf-list-header">Open Food Facts</h3><ul class="rf-list">${remember(online.items).map(foodRow).join('')}</ul>` : '<p class="t-footnote rf-muted fd-empty">Nothing found online either.</p>';
    if (online.q === q && online.error) return `<p class="t-footnote rf-muted fd-empty">${U.esc(online.error)}</p>`;
    return `<button type="button" class="rf-btn fd-online-btn" data-variant="plain" data-size="sm" data-act="foodOnline">${U.icon('globe')}Search online for "${U.esc(q)}"</button>`;
  }
  function refresh() { if (sheet && !sheet.closed) sheet.update(addBody(U.S)); }
  U.act.foodAdd = (el) => {
    const S = U.S;
    addMeal = el && el.dataset && el.dataset.arg && MEAL_NAME[el.dataset.arg] ? el.dataset.arg : null;
    query = ''; online = { busy: false, items: null, error: null, q: '' };
    tab = F().data(S).recent.length ? 'recent' : 'mine';
    sheet = U.sheet({ title: addMeal ? `Add to ${MEAL_NAME[addMeal].toLowerCase()}` : 'Log food', size: 'full', cls: 'fd-sheet', body: addBody(S), onClose: () => { sheet = null; } });
    const input = sheet.el.querySelector('#foodQ');
    let timer = 0;
    // Search as you type (built-in list only; online search waits for Enter or the button).
    sheet.el.addEventListener('input', (e) => {
      if (e.target.id !== 'foodQ') return;
      query = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const pos = e.target.selectionStart;
        refresh();
        const again = sheet && sheet.el.querySelector('#foodQ');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
      }, 120);
    });
    sheet.el.addEventListener('keydown', (e) => { if (e.target.id === 'foodQ' && e.key === 'Enter') { e.preventDefault(); if (F().prefs(U.S).online && query.trim()) U.act.foodOnline(); } });
    if (!dbReady()) loadDb().then(() => refresh());
    if (input && !F().data(S).recent.length) setTimeout(() => input.focus(), 350);
  };
  U.on.foodTab = (el, ev, v) => { tab = v; refresh(); };
  U.act.foodOnline = async () => {
    const q = query.trim();
    if (!q || online.busy) return;
    online = { busy: true, items: null, error: null, q };
    refresh();
    try {
      const items = await GH.foodNet.search(q);
      online = { busy: false, items, error: null, q };
      rememberOff(items);
    } catch (e) {
      online = { busy: false, items: null, error: e.message || 'Online search didn\'t work. Try again in a minute.', q };
    }
    refresh();
  };
  function rememberOff(items) {
    const f = F().data(U.S);
    f.offCache = f.offCache || {};
    for (const x of items) f.offCache[x.ref] = x;
    const keys = Object.keys(f.offCache);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete f.offCache[k];
  }

  /* ---------------------------------------------------------------- portions */
  // How much: a portion (100 g, 1 cup, 1 serving…) times a quantity, or grams typed in.
  let pick = null; // { item, portion: [label, grams], qty, meal, day, edit? }
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
  function portionBody() {
    const { item, portion, qty, meal } = pick;
    const n = nutrientsFor(item, portion, qty);
    const favKey = item.key;
    const fav = F().data(U.S).favs.includes(favKey);
    const qtyStep = portion[1] === 1 ? 10 : 0.25;
    return `<div class="sheet-pad fd-portion">
        <p class="t-callout rf-muted">${U.esc([item.detail, item.brand].filter(Boolean).join(' · '))}</p>
        <div class="fd-big"><span class="t-large-title rf-num">${U.roll(kcal(n.kcal))}</span><span class="t-callout rf-muted">kcal</span></div>
        <p class="t-footnote rf-num fd-pcf">Protein ${g1(n.p)} g · Carbs ${g1(n.c)} g · Fat ${g1(n.f)} g${n.fib ? ` · Fibre ${g1(n.fib)} g` : ''}</p>
        <h3 class="rf-list-header">Portion</h3>
        <div class="ob-chips">${portionsOf(item).map((p, i) => U.chip(p[1] === 1 ? 'Grams' : p[0], p[0] === portion[0], `data-act="foodPortion" data-arg="${i}"`)).join('')}</div>
        <div class="fd-qty">${U.stepper('foodQty', portion[1] === 1 ? Math.round(qty) : qty, qtyStep, portion[1] === 1 ? 5000 : 50, portion[1] === 1 ? 'Grams' : 'Amount', 'data-on="foodQty"', qtyStep)}<span class="t-callout rf-muted">${U.esc(portion[1] === 1 ? 'g' : `× ${portion[0]}`)}</span></div>
        <h3 class="rf-list-header">Meal</h3>
        ${U.seg('foodMeal', F().MEALS.map(([id, name]) => [id, name]), meal, 'Meal', ' data-on="foodMeal" data-size="sm" data-block')}
        <div class="btn-row fd-actions">
          <button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodSave">${pick.edit ? 'Save' : 'Add'}</button>
          ${item.src !== 'quick' ? `<button type="button" class="rf-btn" data-shape="circle" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${fav}" data-act="foodFav">${U.icon('star')}</button>` : ''}
          ${pick.edit ? '<button type="button" class="rf-btn" data-tone="critical" data-act="foodDelete">Delete</button>' : ''}
        </div>
      </div>`;
  }
  let psheet = null;
  function openPortion(item, opts) {
    const o = opts || {};
    const list = portionsOf(item);
    const portion = o.portion || list[0];
    pick = { item, portion, qty: o.qty || 1, meal: o.meal || addMeal || F().mealFor(Date.now()), day: o.day != null ? o.day : dayShown(), edit: o.edit || null };
    psheet = U.sheet({ title: item.name, size: 'auto', body: portionBody(), onClose: () => { psheet = null; } });
  }
  const repaint = () => { if (psheet && !psheet.closed) psheet.update(portionBody()); };
  U.act.foodPick = (el) => {
    const item = lookup(el.dataset.arg);
    if (!item) { U.toast('That food isn\'t available right now', 'caution'); return; }
    openPortion(item); // its sheet's opening has the haptic
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
  U.on.foodMeal = (el, ev, v) => { pick.meal = v; };
  U.act.foodFav = () => { const on = F().toggleFav(U.S, pick.item.key); U.save(); U.haptic(on ? 'toggleOn' : 'toggleOff'); repaint(); };
  U.act.foodSave = () => {
    const S = U.S;
    const { item, portion, qty, meal, day, edit } = pick;
    const n = nutrientsFor(item, portion, qty);
    const label = portion[1] === 1 ? `${Math.round(qty)} g` : `${qty === 1 ? '' : `${qty} × `}${portion[0]}`;
    if (edit) F().update(S, day, edit, { meal, g: n.g != null ? Math.round(n.g) : null, portion: label, kcal: n.kcal, p: Math.round(n.p * 10) / 10, c: Math.round(n.c * 10) / 10, f: Math.round(n.f * 10) / 10, fib: Math.round(n.fib * 10) / 10 });
    else F().add(S, day, { name: item.name, detail: item.detail, src: item.src, ref: item.ref, g: n.g, portion: label, meal, kcal: n.kcal, p: n.p, c: n.c, f: n.f, fib: n.fib }, whenOn(day, meal));
    U.commit();
    U.haptic(edit ? 'save' : 'log');
    if (psheet) psheet.close('ok');
    if (sheet && !edit) sheet.close('ok');
    if (GH.health && GH.health.writeFood) GH.health.writeFood(S);
    if (!edit) U.toast(`${item.name} added`, 'positive');
  };
  // When an entry for a day happened: now for today, else that day at a usual time for the meal,
  // in local time, so its Health Connect copy lands on the right day and hour.
  const MEAL_HOUR = { breakfast: 8, lunch: 13, dinner: 19, snack: 16 };
  function whenOn(day, meal) {
    if (day === U.today()) return Date.now();
    const [y, m, d] = B().dayStr(day).split('-').map(Number);
    return Math.min(Date.now(), new Date(y, m - 1, d, MEAL_HOUR[meal] || 12, 0).getTime());
  }
  U.act.foodEdit = async (el) => {
    const [dStr, id] = el.dataset.arg.split(':');
    const day = Number(dStr);
    const e = F().entries(U.S, day).find((x) => x.id === id);
    if (!e) return;
    // A food from the built-in list edits by weight, which needs the list (it loads on first use).
    if (e.src === 'usda' && !dbReady()) await loadDb();
    const item = e.ref != null ? lookup(`${e.src}:${e.ref}`) : null;
    if (item && item.kcal != null && e.g) { openPortion(item, { portion: ['Grams', 1], qty: e.g, meal: e.meal, day, edit: id }); return; }
    // Quick adds and servings: edit the numbers directly.
    quickSheet({ day, edit: e });
  };
  U.act.foodDelete = () => {
    F().remove(U.S, pick.day, pick.edit);
    U.commit();
    U.haptic('remove');
    if (psheet) psheet.close('ok');
    if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S);
  };

  /* ---------------------------------------------------------------- quick add, create, saved */
  const numField = (id, label, v, extra) => `<div class="rf-field"><label class="rf-field-label" for="${id}">${U.esc(label)}</label><div class="rf-field-control"><input class="rf-input" id="${id}" type="number" inputmode="decimal" min="0" step="any" value="${v == null ? '' : U.esc(v)}" ${extra || ''}></div></div>`;
  const textField = (id, label, v, ph) => `<div class="rf-field"><label class="rf-field-label" for="${id}">${U.esc(label)}</label><div class="rf-field-control"><input class="rf-input" id="${id}" type="text" maxlength="60" value="${U.esc(v || '')}" placeholder="${U.esc(ph || '')}"></div></div>`;
  function quickSheet(o) {
    const e = o.edit;
    const meal = e ? e.meal : addMeal || F().mealFor(Date.now());
    U.sheet({
      title: e ? 'Edit' : 'Quick add', size: 'auto',
      body: `<div class="sheet-pad fd-form">
        ${textField('qName', 'Name (optional)', e ? e.name : '', 'Lunch out')}
        ${numField('qKcal', 'Calories', e ? e.kcal : null, 'required')}
        <div class="ob-row2">${numField('qP', 'Protein (g)', e ? e.p : null)}${numField('qC', 'Carbs (g)', e ? e.c : null)}</div>
        ${numField('qF', 'Fat (g)', e ? e.f : null)}
        ${U.seg('qMeal', F().MEALS.map(([id, name]) => [id, name]), meal, 'Meal', ' data-size="sm" data-block')}
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="foodQuickSave" data-arg="${e ? `${o.day}:${e.id}` : ''}">${e ? 'Save' : 'Add'}</button>
        ${e ? `<button type="button" class="rf-btn" data-tone="critical" data-act="foodQuickDelete" data-arg="${o.day}:${e.id}">Delete</button>` : ''}</div>
      </div>`,
    });
  }
  const val = (id) => { const x = parseFloat((doc.getElementById(id) || {}).value); return Number.isFinite(x) && x >= 0 ? x : null; };
  U.act.foodQuick = () => quickSheet({});
  U.act.foodQuickSave = (el) => {
    const k = val('qKcal');
    if (!(k > 0 && k < 10000)) { U.haptic('deny'); U.toast('Enter the calories', 'caution'); return; }
    const mealIn = doc.querySelector('.rf-sheet [name="qMeal"]:checked');
    const x = { name: ((doc.getElementById('qName') || {}).value || '').trim() || 'Quick add', kcal: k, p: val('qP') || 0, c: val('qC') || 0, f: val('qF') || 0, meal: mealIn ? mealIn.value : addMeal || undefined };
    // Editing keeps where the entry came from (a food from the list stays that food).
    if (el.dataset.arg) { const [d, id] = el.dataset.arg.split(':'); if (!x.meal) delete x.meal; F().update(U.S, Number(d), id, x); }
    else F().add(U.S, dayShown(), Object.assign({ src: 'quick' }, x), whenOn(dayShown(), x.meal));
    U.commit();
    U.haptic(el.dataset.arg ? 'save' : 'log');
    U.closeSheets();
    if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S);
  };
  U.act.foodQuickDelete = (el) => { const [d, id] = el.dataset.arg.split(':'); F().remove(U.S, Number(d), id); U.commit(); U.haptic('remove'); U.closeSheets(); if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S); };
  // Create a food from its label (optionally for a barcode that wasn't found).
  function createSheet(prefill) {
    const p = prefill || {};
    U.sheet({
      title: 'Create a food', size: 'auto',
      body: `<div class="sheet-pad fd-form">
        <p class="t-footnote rf-muted">Copy the numbers from the label, per serving.</p>
        ${textField('cName', 'Name', p.name || '', 'Protein bar')}
        ${numField('cG', 'Serving size (g, optional)', p.servingG || null)}
        ${numField('cKcal', 'Calories per serving', null)}
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
    const meal = addMeal || F().mealFor(Date.now());
    const added = F().addSaved(U.S, dayShown(), el.dataset.arg, meal, whenOn(dayShown(), meal));
    U.commit();
    U.haptic('log');
    U.closeSheets();
    if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S);
    U.toast(`${U.plural(added.length, 'item')} added`, 'positive');
  };
  U.act.foodSavedMeals = () => { tab = 'meals'; U.act.foodAdd({ dataset: {} }); tab = 'meals'; refresh(); };
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
  U.act.foodCopyYesterday = async () => {
    const day = dayShown();
    const src = F().entries(U.S, day - 1);
    if (!src.length) { U.toast('Nothing logged the day before', 'neutral'); return; }
    const ok = await U.confirm('Copy the day before?', `${U.plural(src.length, 'item')}, ${kcal(src.reduce((a, e) => a + e.kcal, 0))} kcal, go into ${day === U.today() ? 'today' : 'this day'}.`, 'Copy');
    if (!ok) return;
    F().copyMeal(U.S, day - 1, day, null, (meal) => whenOn(day, meal));
    U.commit();
    U.haptic('copy');
    if (GH.health && GH.health.writeFood) GH.health.writeFood(U.S);
  };

  /* ---------------------------------------------------------------- barcode */
  U.act.foodScan = async () => {
    if (!F().prefs(U.S).online) { U.open('settings', 'food'); return; }
    if (!GH.scanner) { U.toast('Scanning isn\'t available here', 'caution'); return; }
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
