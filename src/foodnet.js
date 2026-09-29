/* Online food lookups (only when you turn them on): Open Food Facts search and barcodes, asked for
 * by the Android shell (it sets the User-Agent Open Food Facts requires) and returned here. Results
 * are cleaned up before use: missing calories are worked out from kJ or from the macros, impossible
 * values are dropped, and only products with usable numbers come back. Open Food Facts allows about
 * 10 searches and 15 product reads a minute, so this never asks faster than that.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const hooks = G.__gh || (G.__gh = {});
  const bridge = () => G.AndroidBridge || null;
  const LIMIT = { search: 10, barcode: 15 }; // per minute
  const sent = { search: [], barcode: [] };
  const waiting = {};
  let seq = 0;

  const prev = hooks.onFoodResult;
  hooks.onFoodResult = (res) => {
    if (typeof res === 'string') { try { res = JSON.parse(res); } catch (e) { return; } }
    const w = res && waiting[res.id];
    if (w) { delete waiting[res.id]; clearTimeout(w.timer); w.done(res); }
    if (prev) { try { prev(res); } catch (e) { /* ignore */ } }
  };
  function ask(kind, q) {
    const b = bridge();
    if (!b || !b.foodLookup) return Promise.reject(new Error('Online food search works in the Android app.'));
    const now = Date.now();
    sent[kind] = sent[kind].filter((t) => now - t < 60000);
    if (sent[kind].length >= LIMIT[kind]) return Promise.reject(new Error('That\'s a lot of lookups in a minute. Try again shortly.'));
    sent[kind].push(now);
    const id = `f${++seq}`;
    return new Promise((resolve, reject) => {
      const done = (res) => {
        if (!res.ok) { reject(new Error(res.status === 0 ? 'You\'re offline. The built-in foods still work.' : 'Open Food Facts didn\'t answer. Try again in a minute.')); return; }
        try { resolve(JSON.parse(res.body)); } catch (e) { reject(new Error('Open Food Facts sent something unreadable.')); }
      };
      waiting[id] = { done, timer: setTimeout(() => { delete waiting[id]; reject(new Error('Open Food Facts took too long. Try again.')); }, 20000) };
      try { b.foodLookup(kind, String(q), id); } catch (e) { delete waiting[id]; reject(new Error('Couldn\'t reach Open Food Facts.')); }
    });
  }

  const num = (x) => { const n = typeof x === 'string' ? parseFloat(x.replace(',', '.')) : x; return Number.isFinite(n) ? n : null; };
  const r1 = (x) => Math.round(x * 10) / 10;
  // One Open Food Facts product → a food in the app's shape, or null when its numbers can't be used.
  function parseProduct(p) {
    if (!p || typeof p !== 'object') return null;
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    const kj = num(n['energy-kj_100g']) != null ? num(n['energy-kj_100g']) : num(n.energy_100g);
    if (kcal == null && kj != null) kcal = kj / 4.184;
    const pr = num(n.proteins_100g), c = num(n.carbohydrates_100g), f = num(n.fat_100g), fib = num(n.fiber_100g);
    const macros = pr != null && c != null && f != null ? pr * 4 + c * 4 + f * 9 : null;
    if (kcal == null && macros != null) kcal = macros;
    if (kcal == null || kcal < 0 || kcal > 950) return null;
    for (const x of [pr, c, f, fib]) if (x != null && (x < 0 || x > 100)) return null;
    if ((pr || 0) + (c || 0) + (f || 0) > 105) return null;
    // Energy that disagrees wildly with the macros is usually a unit mix-up: trust the macros.
    if (macros != null && macros > 20 && Math.abs(kcal - macros) / macros > 0.35) kcal = macros;
    const name = String(p.product_name || p.product_name_en || p.generic_name || '').trim();
    if (!name) return null;
    const brand = String(p.brands || '').split(',')[0].trim();
    const sq = num(p.serving_quantity);
    const portions = sq > 0 && sq < 2000 ? [[p.serving_size ? `1 serving (${String(p.serving_size).slice(0, 24)})` : `1 serving (${sq} g)`, Math.round(sq)]] : [];
    const code = String(p.code || p._id || '').replace(/\D/g, '');
    return { key: `off:${code || name}`, src: 'off', ref: code || name, name: name.slice(0, 80), brand: brand.slice(0, 40), detail: '', kcal: Math.round(kcal), p: r1(pr || 0), c: r1(c || 0), f: r1(f || 0), fib: r1(fib || 0), portions };
  }
  const cache = { search: new Map(), barcode: new Map() };
  async function search(q) {
    const key = q.trim().toLowerCase();
    if (cache.search.has(key)) return cache.search.get(key);
    const data = await ask('search', key);
    const items = (data.products || []).map(parseProduct).filter(Boolean).slice(0, 20);
    cache.search.set(key, items);
    return items;
  }
  async function barcode(code) {
    const c = String(code).replace(/\D/g, '');
    if (!c) return null;
    if (cache.barcode.has(c)) return cache.barcode.get(c);
    const data = await ask('barcode', c);
    const item = data && (data.status === 1 || data.status === 'success') ? parseProduct(Object.assign({ code: c }, data.product)) : null;
    cache.barcode.set(c, item);
    return item;
  }
  GH.foodNet = { search, barcode, parseProduct, LIMIT };
})(typeof window !== 'undefined' ? window : globalThis);
