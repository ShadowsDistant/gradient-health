/* Food tracking (optional): what you ate, your calorie and macro targets, and a burn estimate that
 * learns from your own intake and weight trend. Pure logic on the saved state; the Food tab and the
 * Today card draw it. Modes: 'off', 'protein' (the quick protein counter) or 'full'.
 *
 * Targets. Resting burn from Mifflin-St Jeor (Mifflin et al. 1990; the most accurate common
 * equation, Frankenfield et al. 2005) times an activity factor from your steps and workouts, in the
 * FAO/WHO/UNU (2004) activity bands. Weight change: lose 0.5% of body weight a week by default
 * (0.5-1% keeps muscle, Helms et al. 2014, Garthe et al. 2011), gain 0.25% (Iraki et al. 2019).
 * Never under 1,200 kcal (1,500 for men), the floors in the AHA/ACC/TOS guideline (Jensen et al.
 * 2014). After two weeks of logging with regular weigh-ins, the burn estimate learns from what you
 * actually ate and how your weight moved (7,700 kcal per kg, a rule of thumb, Hall 2008), blended
 * in slowly and never moved more than 150 kcal a week.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const KCAL_PER_KG = 7700;
  const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snacks']];
  const FLOOR = { female: 1200, male: 1500, '': 1350 };

  /* ---------------------------------------------------------------- state */
  function defaults() {
    return { mode: 'protein', pace: 0.5, online: false, hcWrite: true, hcRead: true };
  }
  // The profile's food settings, with defaults; the food log lives in S.food.
  function prefs(S) {
    const p = S.profile;
    p.food = Object.assign(defaults(), p.food || {});
    return p.food;
  }
  function data(S) {
    S.food = S.food || {};
    const f = S.food;
    f.days = f.days || {};
    f.custom = f.custom || [];
    f.saved = f.saved || [];
    f.recent = f.recent || [];
    f.favs = f.favs || [];
    f.other = f.other || {}; // food logged in other apps, per day, from Health Connect
    return f;
  }
  const mode = (S) => prefs(S).mode;
  const full = (S) => mode(S) === 'full';
  // Off, protein only or full; the protein counter follows (it's on unless food tracking is off).
  function setMode(S, m) {
    const next = ['off', 'protein', 'full'].includes(m) ? m : 'protein';
    prefs(S).mode = next;
    S.profile.protein = Object.assign({}, S.profile.protein || {}, { track: next !== 'off' });
    if (next === 'full') data(S);
    return next;
  }

  /* ---------------------------------------------------------------- targets */
  function age(S) { return S.profile.age || 30; }
  // Resting energy expenditure, kcal a day.
  function ree(S, day) {
    const p = S.profile;
    const w = B().weightStats(S, day).current || p.weightKg;
    if (!w) return null;
    const h = p.heightCm || (p.sex === 'female' ? 163 : p.sex === 'male' ? 177 : 170);
    const s = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
    return 10 * w + 6.25 * h - 5 * age(S) + s;
  }
  // Physical activity level from your own steps and planned workouts (FAO/WHO/UNU bands 1.4-1.9+).
  function activityFactor(S, day) {
    const hd = (S.health && S.health.days) || {};
    const steps = [];
    for (let d = day - 28; d < day; d++) if (hd[d] && hd[d].steps != null) steps.push(hd[d].steps);
    const med = steps.length >= 7 ? B().median(steps) : null;
    let pal = med == null ? 1.45 : med < 5000 ? 1.4 : med < 7500 ? 1.5 : med < 10000 ? 1.6 : med < 12500 ? 1.7 : 1.8;
    if (S.profile.workouts !== false) pal += Math.min(0.15, (S.profile.days || 0) * 0.025);
    return { pal: Math.min(2, Math.round(pal * 100) / 100), steps: med };
  }
  // The daily change the goal asks for, kcal (negative = deficit).
  function goalDelta(S, day) {
    const p = S.profile;
    const w = B().weightStats(S, day).current || p.weightKg || 70;
    const pace = prefs(S).pace;
    if (p.weightGoal === 'lose') return -Math.round(((w * Math.min(1, Math.max(0.25, pace))) / 100) * KCAL_PER_KG / 7);
    if (p.weightGoal === 'gain') return Math.round(((w * 0.25) / 100) * KCAL_PER_KG / 7);
    return 0;
  }
  function floorFor(S) { return FLOOR[S.profile.sex === 'male' ? 'male' : S.profile.sex === 'female' ? 'female' : '']; }

  // What you burn in a day: the learned estimate when there is one, else the formula.
  function burn(S, day) {
    const r = ree(S, day);
    if (r == null) return null;
    const act = activityFactor(S, day);
    const formula = Math.round(r * act.pal);
    const learned = data(S).tdee;
    const use = learned && learned.kcal && day - learned.day < 21 ? learned.kcal : formula;
    return { kcal: Math.round(use), formula, ree: Math.round(r), pal: act.pal, learned: !!(learned && learned.kcal && day - learned.day < 21), weight: learned && learned.w };
  }

  // Today's targets: calories and grams of protein, carbs and fat.
  function targets(S, day) {
    const b = burn(S, day);
    if (!b) return null;
    const kcal = Math.max(floorFor(S), Math.round((b.kcal + goalDelta(S, day)) / 10) * 10);
    const w = B().weightStats(S, day).current || S.profile.weightKg || 70;
    const protein = B().proteinGoal(S, day) || Math.round(1.6 * w);
    let fat = Math.max(Math.round(0.6 * w), Math.round((kcal * 0.27) / 9));
    let carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
    if (carbs < 50) { fat = Math.max(Math.round(0.5 * w), Math.round((kcal - protein * 4 - 50 * 4) / 9)); carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4)); }
    return { kcal, protein, carbs, fat, burn: b.kcal, learned: b.learned, delta: goalDelta(S, day), floor: floorFor(S), pal: b.pal, ree: b.ree };
  }

  /* ---------------------------------------------------------------- logging */
  const round1 = (x) => Math.round(x * 10) / 10;
  // Nutrients for an amount of a food given per 100 g.
  function scale(per100, grams) {
    const k = grams / 100;
    return { kcal: Math.round(per100.kcal * k), p: round1(per100.p * k), c: round1(per100.c * k), f: round1(per100.f * k), fib: round1((per100.fib || 0) * k) };
  }
  let seq = 0;
  const newId = () => `${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;
  function mealFor(ts) {
    const h = new Date(ts).getHours();
    return h >= 4 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 16 && h < 22 ? 'dinner' : 'snack';
  }
  // Adds an entry: { name, meal?, src, ref?, g?, kcal, p, c, f, fib? } → the entry.
  function add(S, day, e, now) {
    const f = data(S);
    const t = now || Date.now();
    const entry = {
      id: newId(), t, meal: e.meal || mealFor(t), name: String(e.name || 'Food').slice(0, 80), detail: e.detail || null,
      src: e.src || 'quick', ref: e.ref != null ? e.ref : null, g: e.g != null ? Math.round(e.g) : null, portion: e.portion || null,
      kcal: Math.max(0, Math.round(e.kcal || 0)), p: round1(Math.max(0, e.p || 0)), c: round1(Math.max(0, e.c || 0)), f: round1(Math.max(0, e.f || 0)), fib: round1(Math.max(0, e.fib || 0)),
    };
    (f.days[day] = f.days[day] || []).push(entry);
    if (entry.ref != null && entry.src !== 'quick') {
      const key = `${entry.src}:${entry.ref}`;
      f.recent = [key].concat(f.recent.filter((x) => x !== key)).slice(0, 40);
    }
    return entry;
  }
  function update(S, day, id, patch) {
    const list = data(S).days[day] || [];
    const e = list.find((x) => x.id === id);
    if (!e) return null;
    Object.assign(e, patch);
    e.v = (e.v || 0) + 1; // a new version: Health Connect's copy gets updated
    return e;
  }
  function remove(S, day, id) {
    const f = data(S);
    const list = f.days[day] || [];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [e] = list.splice(i, 1);
    f.removed = (f.removed || []).concat({ id: e.id, day }).slice(-200); // so Health Connect copies get deleted
    return e;
  }
  function entries(S, day) { return (data(S).days[day] || []).slice().sort((a, b) => a.t - b.t); }
  // Totals for a day. includeOther adds food logged in other apps (from Health Connect).
  function totals(S, day, includeOther) {
    const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, n: 0 };
    for (const e of data(S).days[day] || []) { t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; t.fib += e.fib || 0; t.n++; }
    const o = includeOther !== false && prefs(S).hcRead !== false ? data(S).other[day] : null;
    if (o) { t.kcal += o.kcal || 0; t.p += o.p || 0; t.c += o.c || 0; t.f += o.f || 0; t.other = o; }
    for (const k of ['p', 'c', 'f', 'fib']) t[k] = round1(t[k]);
    t.kcal = Math.round(t.kcal);
    return t;
  }
  function byMeal(S, day) {
    const out = {};
    for (const [id] of MEALS) out[id] = [];
    for (const e of entries(S, day)) (out[e.meal] || out.snack).push(e);
    return out;
  }
  // Copies a meal (or the whole day) from another day.
  function copyMeal(S, fromDay, toDay, meal, now) {
    const src = entries(S, fromDay).filter((e) => !meal || e.meal === meal);
    return src.map((e) => add(S, toDay, Object.assign({}, e, { meal: e.meal }), now));
  }
  // Saved meals: a named group of entries you can add in one tap.
  function saveMeal(S, name, list) {
    const f = data(S);
    const meal = { id: newId(), name: String(name || 'Meal').slice(0, 40), items: list.map((e) => ({ name: e.name, detail: e.detail, src: e.src, ref: e.ref, g: e.g, portion: e.portion, kcal: e.kcal, p: e.p, c: e.c, f: e.f, fib: e.fib })) };
    f.saved = f.saved.concat(meal).slice(-30);
    return meal;
  }
  function addSaved(S, day, savedId, meal, now) {
    const m = data(S).saved.find((x) => x.id === savedId);
    if (!m) return [];
    return m.items.map((it) => add(S, day, Object.assign({}, it, { meal }), now));
  }
  // Custom foods from a label: per serving → stored per 100 g when the serving size is known.
  function addCustom(S, c) {
    const f = data(S);
    const g = c.servingG > 0 ? c.servingG : null;
    const per = (x) => (g ? round1((x * 100) / g) : x);
    const food = { id: `c${newId()}`, name: String(c.name || 'My food').slice(0, 60), servingG: g, servingLabel: c.servingLabel || (g ? `1 serving (${g} g)` : '1 serving'), per100: g ? { kcal: Math.round((c.kcal * 100) / g), p: per(c.p || 0), c: per(c.c || 0), f: per(c.f || 0), fib: per(c.fib || 0) } : null, perServing: { kcal: Math.round(c.kcal || 0), p: round1(c.p || 0), c: round1(c.c || 0), f: round1(c.f || 0), fib: round1(c.fib || 0) } };
    f.custom = f.custom.filter((x) => x.name.toLowerCase() !== food.name.toLowerCase()).concat(food).slice(-100);
    return food;
  }
  function toggleFav(S, key) {
    const f = data(S);
    f.favs = f.favs.includes(key) ? f.favs.filter((x) => x !== key) : [key].concat(f.favs).slice(0, 60);
    return f.favs.includes(key);
  }

  /* ---------------------------------------------------------------- learning your burn */
  // Smoothed weight (10% exponential moving average per day) over a window, for the trend.
  function smoothWeights(S, from, to) {
    const w = (S.weights || []).filter((x) => x.day >= from - 30 && x.day <= to).sort((a, b) => a.day - b.day);
    if (!w.length) return [];
    let ema = w[0].kg;
    const out = [];
    let i = 0;
    for (let d = w[0].day; d <= to; d++) {
      while (i < w.length && w[i].day === d) { ema = ema + 0.1 * (w[i].kg - ema); i++; }
      if (d >= from) out.push({ day: d, kg: ema });
    }
    return out;
  }
  function slope(points) {
    const n = points.length;
    if (n < 2) return null;
    const mx = points.reduce((a, p) => a + p.day, 0) / n, my = points.reduce((a, p) => a + p.kg, 0) / n;
    let num = 0, den = 0;
    for (const p of points) { num += (p.day - mx) * (p.kg - my); den += (p.day - mx) * (p.day - mx); }
    return den ? num / den : null;
  }
  // Re-estimates what you burn from the last three weeks: mean intake on logged days minus
  // 7,700 kcal per kg of smoothed weight change. Needs 10+ logged days and 6+ weigh-ins, is kept
  // within 70-140% of the formula, blended in by how much data there is, and moves at most 150 kcal
  // a week. Returns the saved estimate (or null when there isn't enough yet).
  function learnBurn(S, day) {
    const f = data(S);
    const r = ree(S, day);
    if (r == null || !full(S)) return f.tdee || null;
    const formula = r * activityFactor(S, day).pal;
    const from = day - 21;
    const logged = [];
    for (let d = from; d < day; d++) { const t = totals(S, d, true); if (t.kcal >= formula * 0.4) logged.push(t.kcal); }
    const weighIns = (S.weights || []).filter((x) => x.day >= from && x.day < day).length;
    if (logged.length < 10 || weighIns < 6) return f.tdee || null;
    // The trend is a straight-line fit through the raw weigh-ins: day-to-day water swings average
    // out, and unlike a moving average it doesn't lag when weighing only just started.
    const trend = slope((S.weights || []).filter((x) => x.day >= from && x.day < day).map((x) => ({ day: x.day, kg: x.kg })));
    if (trend == null) return f.tdee || null;
    const intake = logged.reduce((a, x) => a + x, 0) / logged.length;
    const observed = Math.max(formula * 0.7, Math.min(formula * 1.4, intake - trend * KCAL_PER_KG));
    const weight = Math.min(0.8, ((logged.length - 9) / 12) * 0.8);
    let est = (1 - weight) * formula + weight * observed;
    const prev = f.tdee;
    if (prev && prev.kcal) {
      const weeks = Math.max(1, (day - prev.day) / 7);
      est = Math.max(prev.kcal - 150 * weeks, Math.min(prev.kcal + 150 * weeks, est));
    }
    f.tdee = { kcal: Math.round(est), day, formula: Math.round(formula), observed: Math.round(observed), days: logged.length, w: Math.round(weight * 100) / 100 };
    return f.tdee;
  }

  /* ---------------------------------------------------------------- coach hooks */
  // A week eaten well under target (or weight dropping fast) holds weekly set increases.
  function holdsVolume(S, ws) {
    if (!full(S)) return false;
    const t = targets(S, ws + 6);
    if (!t) return false;
    const days = [];
    for (let d = ws; d <= ws + 6; d++) { const x = totals(S, d, true); if (x.kcal >= t.kcal * 0.4) days.push(x.kcal); }
    const rate = B().weightStats(S, ws + 6).rate;
    if (rate != null && rate < -0.01) return true;
    if (days.length < 4) return false;
    return days.reduce((a, x) => a + x, 0) / days.length < t.burn - 500;
  }
  function watchItem(S, day) {
    if (!full(S)) return null;
    const t = targets(S, day);
    if (!t) return null;
    const days = [];
    for (let d = day - 7; d < day; d++) { const x = totals(S, d, true); if (x.kcal >= t.kcal * 0.4) days.push(x.kcal); }
    if (days.length < 3) return null;
    const avg = days.reduce((a, x) => a + x, 0) / days.length;
    const off = avg - t.kcal;
    return { icon: 'flame', label: 'Calories', value: `${Math.round(avg).toLocaleString('en-US')} a day`, status: Math.abs(off) <= t.kcal * 0.1 ? 'good' : 'info', note: `Target ${t.kcal.toLocaleString('en-US')}${t.learned ? ', learned from your logs' : ''}.` };
  }
  function suggestions(S, day) {
    if (!full(S)) return [];
    const out = [];
    const ws = B().weightStats(S, day);
    const goal = S.profile.weightGoal;
    if (goal === 'lose' && ws.rate != null && ws.rate < -0.01) out.push({ id: `food-fast-${B().weekStart(day)}`, icon: 'flame', title: 'Eat a little more', body: `You're losing ${Math.round(-ws.rate * 1000) / 10}% a week. Under 1% keeps more muscle. About 150 kcal more a day would slow it down.` });
    const t = targets(S, day);
    if (t) {
      let low = 0, n = 0;
      for (let d = day - 7; d < day; d++) { const x = totals(S, d, true); if (x.kcal >= t.kcal * 0.4) { n++; if (x.p < t.protein * 0.8) low++; } }
      if (n >= 4 && low >= n - 1) out.push({ id: `food-protein-${B().weekStart(day)}`, icon: 'check-circle', title: `Aim for ${t.protein} g of protein`, body: `You were under it on ${low} of the ${n} days you logged. A portion of meat, fish, tofu, eggs or Greek yogurt at each meal covers most of it.` });
    }
    return out;
  }
  function targetLine(S, day) {
    if (!full(S)) return null;
    const t = targets(S, day);
    return t ? `${t.kcal.toLocaleString('en-US')} kcal a day` : null;
  }
  // Protein logged as food (full mode), for the protein goal and the coach.
  function proteinOn(S, day) { return full(S) ? Math.round(totals(S, day, true).p) : 0; }

  /* ---------------------------------------------------------------- Health Connect */
  // Nutrition records for entries not yet written (or edited since), and ids removed since.
  function pendingWrites(S) {
    const f = data(S);
    if (!full(S) || prefs(S).hcWrite === false) return { upsert: [], remove: [] };
    const done = f.written || {};
    const upsert = [];
    for (const [dStr, list] of Object.entries(f.days)) {
      const d = Number(dStr);
      for (const e of list) if (done[e.id] == null || (e.v || 0) > done[e.id]) upsert.push({ id: `gradient-food-${e.id}`, entry: e.id, v: e.v || 0, day: d, start: e.t, end: e.t + 60000, meal: e.meal, name: e.name, kcal: e.kcal, p: e.p, c: e.c, f: e.f, fib: e.fib || 0 });
    }
    const remove = (f.removed || []).filter((x) => done[x.id] != null).map((x) => ({ id: `gradient-food-${x.id}`, entry: x.id }));
    return { upsert, remove };
  }
  // Records which version of an entry Health Connect has.
  function markWritten(S, entryId, ok, v) {
    const f = data(S);
    f.written = f.written || {};
    if (!ok) return;
    let ver = v;
    if (ver == null) for (const list of Object.values(f.days)) { const e = list.find((x) => x.id === entryId); if (e) ver = e.v || 0; }
    f.written[entryId] = ver || 0;
  }
  function markRemoved(S, entryId) {
    const f = data(S);
    f.removed = (f.removed || []).filter((x) => x.id !== entryId);
    if (f.written) delete f.written[entryId];
  }
  // Food other apps logged in Health Connect, as per-day totals: [{ day, kcal, p, c, f }].
  function ingestOther(S, days) {
    const f = data(S);
    for (const x of days || []) if (x && Number.isFinite(x.day)) f.other[x.day] = { kcal: Math.round(x.kcal || 0), p: round1(x.p || 0), c: round1(x.c || 0), f: round1(x.f || 0), n: x.n || 0 };
  }

  GH.food = {
    MEALS, prefs, data, mode, full, setMode, ree, activityFactor, goalDelta, burn, targets, scale, add, update, remove, entries, totals, byMeal,
    copyMeal, saveMeal, addSaved, addCustom, toggleFav, smoothWeights, slope, learnBurn, holdsVolume, watchItem, suggestions, targetLine,
    proteinOn, pendingWrites, markWritten, markRemoved, ingestOther, mealFor, KCAL_PER_KG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
