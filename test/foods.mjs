// The built-in food list (src/data/foods.js, made from USDA SR28 by scripts/build-foods.mjs): numbers
// that add up, usable portions, friendly and distinct names, the lazy chunk the app loads, and a
// search that puts the food people mean first, well inside a frame.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { LAZY } from '../scripts/build.mjs';
import { load, root, check, section, done } from './lib.mjs';

const F = load('src/data/foods.js').foods;
const all = F.all();
const show = (list) => list.map((f) => f.name + (f.detail ? ` (${f.detail})` : ''));

section('Data');
check(`${F.count} foods, about 1,500`, F.count === all.length && F.count >= 1300 && F.count <= 1700, F.count);
check('credits USDA SR28', F.source === 'USDA SR28 (public domain)');
const kb = statSync(join(root, 'src/data/foods.js')).size / 1024;
check(`file stays small (${kb.toFixed(0)} KB)`, kb < 250);
const ids = all.map((f) => f.id);
check('ids are unique NDB numbers', ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length);
const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const badNums = all.filter((f) => ![f.kcal, f.p, f.c, f.f].every(num) || !(f.fib === null || num(f.fib)));
check('no NaN, missing or negative nutrients (fiber may be null)', !badNums.length, show(badNums));
const over = all.filter((f) => f.p + f.c + f.f > 100.5 || f.kcal > 902 || (f.fib || 0) > f.c + 0.05);
check('per 100 g: at most 100 g of macros and the 902 kcal of pure fat, fiber within carbs', !over.length, show(over));

// SR28 works energy out with food-specific factors and about 2 kcal per gram of fiber, so compare
// with 4P + 4(C - fiber) + 2 fiber + 9F. Alcohol (7 kcal/g, not a macro) is skipped, and so are the
// foods SR28 gives much lower factors: brans, cocoa, spirulina, and jam and gum sweetened with polyols.
const ALCOHOL = /\b(beer|wine|liquor|liqueur|vodka|rum|gin|whiskey|tequila|daiquiri|pina colada|sake|hard cider|hard lemonade|merlot|cabernet|sauvignon|pinot|zinfandel|syrah|chardonnay|riesling|budweiser|bud light|vanilla extract)\b/i;
const LOW_FACTORS = [8001, 8244, 11667, 19165, 20033, 20077, 43028, 43060];
const energy = (f) => 4 * f.p + 4 * (f.c - (f.fib || 0)) + 2 * (f.fib || 0) + 9 * f.f;
const macroFoods = all.filter((f) => !ALCOHOL.test(`${f.name} ${f.detail}`) && !LOW_FACTORS.includes(f.id));
const off = macroFoods.filter((f) => Math.abs(f.kcal - energy(f)) > Math.max(20, 0.25 * f.kcal));
check(`kcal within 25% (or 20 kcal) of what the macros give, ${macroFoods.length} foods`, !off.length && LOW_FACTORS.every((id) => F.get(id)),
  off.map((f) => `${f.name}: ${f.kcal} vs ${energy(f).toFixed(0)}`));
const close = macroFoods.filter((f) => Math.abs(f.kcal - energy(f)) <= Math.max(10, 0.1 * f.kcal)).length;
check(`and within 10% (or 10 kcal) for nearly all: ${close}`, close >= 0.97 * macroFoods.length);
const spot = [[1123, 143, 12.6, 0.7, 9.5], [5064, 165, 31, 0, 3.6], [4053, 884, 0, 0, 100], [9040, 89, 1.1, 22.8, 0.3]];
check('spot checks against SR28: egg, chicken breast, olive oil, banana', spot.every(([id, kcal, p, c, f]) => {
  const x = F.get(id);
  return x && x.kcal === kcal && x.p === p && x.c === c && x.f === f;
}), spot.map(([id]) => F.get(id)));

const cats = Object.keys(F.categories);
const lost = all.filter((f) => !cats.includes(f.cat));
check(`${cats.length} categories, each food in one, none empty`, !lost.length && cats.every((c) => all.some((f) => f.cat === c)), show(lost));
const badPortions = all.filter((f) => !Array.isArray(f.portions)
  || f.portions.some(([label, g]) => typeof label !== 'string' || !label.trim() || label === '100 g' || !(g > 0 && g < 1000))
  || new Set(f.portions.map((p) => p[0])).size !== f.portions.length);
check('portions: a label and grams > 0, no repeats (100 g is implied)', !badPortions.length, show(badPortions));
const withPortions = all.filter((f) => f.portions.length).length;
check(`household portions for nearly every food: ${withPortions}`, withPortions >= 0.97 * all.length);

const keys = all.map((f) => `${f.name}|${f.detail}`.toLowerCase());
check('name + detail never repeat', new Set(keys).size === keys.length);
const names = new Set(all.map((f) => f.name.toLowerCase()));
check(`names unique enough: ${names.size} names for ${all.length} foods`, names.size >= 0.95 * all.length);
// SR28's short descriptions shout in abbreviations ("CHICKEN,BROILERS OR FRYERS,BREAST,MEAT ONLY,CKD,RSTD").
const SR_ABBR = /\b(CKD|RSTD|UNENR|ENR|SWTND|UNSWTND|NFS|FRZ|CND|BRLD|PREP|DRND|HTD|W\/O)\b|\bwo?\/|[A-Z]{2},[A-Z]/i;
const ugly = all.filter((f) => SR_ABBR.test(`${f.name} ${f.detail}`) || !/^[A-Z0-9]/.test(f.name) || f.name === f.name.toUpperCase()
  || /\s{2}|,,|\s,|,\S|^\s|\s$/.test(f.name) || /\s{2}|,,|\s,|^\s|\s$/.test(f.detail));
check('friendly names: no SR28 abbreviations or capitals, tidy commas and spaces', !ugly.length, show(ugly));

section('Lookup');
check('get(id) returns the same food for every id', all.every((f) => F.get(f.id) === f));
const egg = F.get(1123);
check('get takes SR28\'s zero-padded NDB string too', F.get('01123') === egg && egg.name === 'Egg');
check('unknown id → null', F.get(99999999) === null && F.get('nope') === null && F.get() === null);
check('shape: id, name, detail, cat, kcal, p, c, f, fib, portions', Object.keys(egg).join() === 'id,name,detail,cat,kcal,p,c,f,fib,portions', Object.keys(egg));
check('a large egg is 50 g', egg.portions.some(([label, g]) => label === '1 large' && g === 50), egg.portions);
check('foods are read-only', Object.isFrozen(egg) && Object.isFrozen(egg.portions) && Object.isFrozen(egg.portions[0]) && Object.isFrozen(all));

section('Speed');
// The search index is built on the first search; after that a search has to fit well inside a frame.
let t0 = performance.now();
F.search('chicken breast');
const firstMs = performance.now() - t0;
check(`first search, building the index: ${firstMs.toFixed(1)} ms`, firstMs < 150);
const QUERIES = ['chicken', 'egg', 'banana', 'rice', 'oats', 'greek yogurt', 'peanut butter', 'milk', 'pizza', 'coke',
  'b', 'c', 's', 'p', 'ch', 'co', 'sweet potato fries', 'mac n cheese', 'straw', 'jalapeño', 'xyzzy', 'a b c d'];
const times = [];
for (let round = 0; round < 10; round++) {
  for (const q of QUERIES) {
    t0 = performance.now();
    F.search(q);
    times.push(performance.now() - t0);
  }
}
times.sort((a, b) => a - b);
const avg = times.reduce((s, x) => s + x, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)];
check(`then ${avg.toFixed(2)} ms per search on average, ${p95.toFixed(2)} ms at the 95th percentile (budget 5 ms)`, avg < 5 && p95 < 5);

section('Search');
function expect(label, query, ok, n = 3) {
  const r = F.search(query, { limit: n });
  check(label, r.length > 0 && ok(r), show(r));
}
const is = (name) => (f) => f && (name instanceof RegExp ? name.test(f.name) : f.name === name);
expect('"chicken" → a plain chicken breast in the top 3', 'chicken', (r) => r.some(is(/^Chicken breast, (roasted|grilled)$/)));
expect('"egg" → whole egg first', 'egg', (r) => r[0] === egg);
expect('"eggs" → whole egg first too', 'eggs', (r) => r[0] === egg);
expect('"banana" → banana', 'banana', (r) => is('Banana')(r[0]));
expect('"rice" → cooked white rice at the top', 'rice', (r) => is('White rice, cooked')(r[0]));
expect('"oats" → oats', 'oats', (r) => is('Oats')(r[0]));
expect('"oatmeal" → cooked oatmeal, then oats', 'oatmeal', (r) => is('Oatmeal, cooked')(r[0]) && is('Oats')(r[1]));
expect('"porridge" → oats', 'porridge', (r) => is(/^Oat(s|meal, cooked)$/)(r[0]));
expect('"greek yogurt" → plain Greek yogurt', 'greek yogurt', (r) => is(/^Greek yogurt, plain/)(r[0]));
expect('"peanut butter" → peanut butter', 'peanut butter', (r) => is(/^Peanut butter, (smooth|crunchy)$/)(r[0]));
expect('"olive oil" → olive oil', 'olive oil', (r) => is('Olive oil')(r[0]));
expect('"apple" → apple', 'apple', (r) => is('Apple')(r[0]));
expect('"salmon" → salmon, not smoked salmon', 'salmon', (r) => is(/^Salmon, cooked$/)(r[0]));
expect('"broccoli" → broccoli', 'broccoli', (r) => is(/^Broccoli, (raw|cooked)$/)(r[0]));
expect('"milk" → cow\'s milk first (whole, 2%, 1%, skim)', 'milk', (r) => r.every(is(/^Milk, (whole|2%|1%|skim)$/)), 4);
expect('"bread" → white or whole wheat bread', 'bread', (r) => is(/^(White|Whole wheat) bread$/)(r[0]));
expect('"pizza" → cheese pizza', 'pizza', (r) => is('Pizza, cheese')(r[0]));
expect('"coke" → cola', 'coke', (r) => is('Cola')(r[0]));
expect('"cola" → cola', 'cola', (r) => is('Cola')(r[0]));
expect('"diet coke" → diet cola', 'diet coke', (r) => is('Diet cola')(r[0]));
expect('"beer" → regular beer', 'beer', (r) => is('Beer, regular')(r[0]));
expect('"almonds" → almonds', 'almonds', (r) => is('Almonds')(r[0]));
expect('"almond" → almonds', 'almond', (r) => is('Almonds')(r[0]));
expect('"avocado" → avocado, not the oil', 'avocado', (r) => is(/^Avocado(, Hass)?$/)(r[0]));
expect('"potato" → a potato', 'potato', (r) => is(/^Potato, /)(r[0]) && r[0].cat === 'veg');
expect('"sweet potato" → a sweet potato', 'sweet potato', (r) => is(/^Sweet potato, /)(r[0]) && r[0].cat === 'veg');

expect('British names: yoghurt', 'yoghurt', (r) => is(/yogurt/i)(r[0]));
expect('courgette → zucchini', 'courgette', (r) => is(/^Zucchini/)(r[0]));
expect('aubergine → eggplant', 'aubergine', (r) => is(/^Eggplant/)(r[0]));
expect('coriander → cilantro', 'coriander', (r) => is('Cilantro')(r[0]));
expect('prawns → shrimp', 'prawns', (r) => is(/^Shrimp/)(r[0]));
expect('crisps → potato chips', 'crisps', (r) => is('Potato chips')(r[0]));
expect('chips → potato chips', 'chips', (r) => is('Potato chips')(r[0]));
expect('fries → french fries', 'fries', (r) => is('French fries')(r[0]));
expect('soda → cola', 'soda', (r) => is('Cola')(r[0]));
expect('accents don\'t matter: jalapeno', 'jalapeno', (r) => is('Jalapeño pepper')(r[0]));
expect('nor case: JALAPEÑO', 'JALAPEÑO', (r) => is('Jalapeño pepper')(r[0]));
expect('singular finds plural: strawberry', 'strawberry', (r) => is('Strawberries')(r[0]));
expect('berry finds berries', 'goji berry', (r) => is('Goji berries')(r[0]));
expect('plural finds singular: tomatoes', 'tomatoes', (r) => is('Tomato')(r[0]));
expect('word starts: "straw"', 'straw', (r) => is('Strawberries')(r[0]));
expect('word starts: "broc"', 'broc', (r) => is(/^Broccoli/)(r[0]));
expect('any word order: "butter peanut"', 'butter peanut', (r) => is(/^Peanut butter/)(r[0]));
expect('small words ignored: "mac n cheese"', 'mac n cheese', (r) => is('Mac and cheese')(r[0]));
expect('hyphens: "hard boiled egg"', 'hard boiled egg', (r) => is('Egg, hard-boiled')(r[0]));
expect('hyphens run together: "hardboiled egg"', 'hardboiled egg', (r) => is('Egg, hard-boiled')(r[0]));
expect('"m&ms"', 'm&ms', (r) => is(/^M&M's/)(r[0]));
expect('brands: "big mac"', 'big mac', (r) => is('Big Mac')(r[0]));
expect('brands: "nutella"', 'nutella', (r) => is('Chocolate hazelnut spread')(r[0]));

check('nothing to search → nothing', [undefined, null, '', '   ', ',.;'].every((q) => F.search(q).length === 0));
check('no match → nothing', F.search('xyzzy').length === 0 && F.search('chicken xyzzy').length === 0);
check('limit is respected, 25 by default', F.search('chicken', { limit: 5 }).length === 5 && F.search('chicken').length === 25);
check('results are the foods themselves', F.search('egg').every((f) => F.get(f.id) === f));

section('Lazy chunk');
const chunk = LAZY.find((c) => c.name === 'foods');
check('registered in the build as the "foods" chunk', chunk && chunk.entry === 'src/data/foods.js', LAZY);
// Built the way the build builds it, then run in a fresh global, as GH.lazy('foods') would.
const out = await build({
  entryPoints: [join(root, 'src/data/foods.js')], bundle: true, write: false, format: 'iife', platform: 'browser',
  target: ['chrome100'], minify: true, legalComments: 'eof', logLevel: 'silent',
});
const ctx = vm.createContext({});
vm.runInContext(out.outputFiles[0].text, ctx);
const M = ctx.GH && ctx.GH.foods;
check('the minified chunk sets GH.foods: same foods, same search', M && M.count === F.count && M.source === F.source
  && JSON.stringify(M.get(1123)) === JSON.stringify(egg) && M.search('greek yogurt').map((f) => f.id).join() === F.search('greek yogurt').map((f) => f.id).join());

done();
