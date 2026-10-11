/* Claude: which model answers, how much it thinks, and what it may spend.
 *
 * The person picks the model and the thinking level in Settings, under AI coach, and every Claude
 * feature uses them. Spending has hard limits: a monthly budget, a daily limit (by default what's
 * left of the month spread over the days left in it, so the budget lasts to the end of the month),
 * and, if they set one, a limit for any one request. Before a request goes, its worst case must fit
 * what's left under all of them: every input token at the cache-write price, every output token the
 * request allows (thinking counts as output), and a backup model's whole answer when one may step in
 * after a refusal. When it doesn't fit, the backup goes first, then the output limit comes down to
 * what's left; a request whose smallest useful answer still couldn't fit isn't sent. Afterwards what
 * it really cost, from the usage the API reports, goes on the day and the month.
 *
 * Inline and small: Settings and the chat read it without the Claude chunk (src/claude.js), which
 * asks it how to send each request (shape) and whether it may (allow), and reports what each cost
 * (record). Amounts are kept in millionths of a dollar, so sums stay exact.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;

  /* ------------------------------------------------------------------ the models */
  // Dollars per million tokens: input, output, cache reads and 5-minute cache writes (1.25x input).
  // off: how the model's thinking turns off ('disabled', or 'between_tools' on Sonnet 5.5), null where
  // it can't. backup: the prices of the model a server-side fallback runs after a refusal, on the
  // models the app asks for one (Haiku 5.5 has none; the older Sonnet and Opus 4.8 aren't asked).
  // long: Haiku 5.5's rate card for a prompt over 100K tokens.
  const OPUS_BACKUP = { in: 5, out: 25, write: 6.25 };
  const MODELS = [
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', short: 'Fable 5.1', note: 'The most capable, and the priciest', in: 10, out: 50, read: 0.25, write: 12.5, off: null, backup: OPUS_BACKUP },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5', note: 'Very capable, right for most people', in: 4, out: 20, read: 0.2, write: 5, off: null, backup: OPUS_BACKUP },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5', note: 'Quick and capable, half the price of Opus', in: 2, out: 10, read: 0.2, write: 2.5, off: 'between_tools', backup: { in: 2, out: 10, write: 2.5 } },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', short: 'Haiku 5.5', note: 'The quickest, for a fraction of the price', in: 0.1, out: 0.5, read: 0.01, write: 0.125, off: 'disabled', backup: null, long: { over: 100000, in: 0.5, out: 2.5, read: 0.05, write: 0.625 } },
    { id: 'claude-opus-5', name: 'Claude Opus 5', short: 'Opus 5', older: true, in: 5, out: 25, read: 0.5, write: 6.25, off: 'disabled', backup: OPUS_BACKUP },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', short: 'Sonnet 5', older: true, in: 2, out: 10, read: 0.2, write: 2.5, off: 'disabled', backup: null },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', short: 'Opus 4.8', older: true, in: 5, out: 25, read: 0.5, write: 6.25, off: 'disabled', backup: null },
  ];
  const DEFAULT_MODEL = 'claude-opus-5-5';
  const byId = (id) => MODELS.find((m) => m.id === id) || null;
  // A model the table doesn't know (a fallback the API picked that came out after this version) is
  // priced as the dearest one, so what's counted is never less than what's billed.
  const DEAREST = MODELS[0];

  /* ------------------------------------------------------------------ thinking */
  // The levels, as the API's effort (off: the model's own way of not thinking). Auto lets each feature
  // use its own: more for the weekly report and plans, less for quick questions and small changes.
  const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
  const LEVEL_NAMES = { auto: 'Auto', off: 'Off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
  const LEVEL_NOTES = {
    auto: 'More for plans and reports, less for quick questions',
    off: 'Answers without thinking first',
    low: 'A little thinking: quick and cheap',
    medium: 'A balance of depth, speed and cost',
    high: 'Thinks things through',
    xhigh: 'Thinks longer, for the hardest questions',
    max: 'Thinks as long as it needs: the slowest and costliest',
  };
  // Each feature: its name in the usage list, its level on Auto, the most it may write at each level
  // (thinking included, in the order of LEVELS), and the least worth sending: an answer the size of
  // what it has to show. A limit that can't leave room for that sends nothing.
  const FEATURES = {
    chat: { name: 'Questions', auto: 'medium', tokens: [1200, 2000, 4000, 8000, 16000, 32000], need: 600 },
    report: { name: 'Weekly reports', auto: 'medium', tokens: [3000, 4000, 8000, 12000, 20000, 32000], need: 1500 },
    review: { name: 'Plan checks', auto: 'medium', tokens: [2500, 3500, 7000, 10000, 16000, 24000], need: 1000 },
    build: { name: 'Plans built', auto: 'medium', tokens: [4000, 5000, 8000, 12000, 20000, 32000], need: 2000 },
    suggest: { name: 'Suggestions', auto: 'low', tokens: [1500, 2500, 5000, 8000, 12000, 16000], need: 500 },
    tailor: { name: 'Tailor requests', auto: 'low', tokens: [800, 1500, 3000, 6000, 10000, 16000], need: 300 },
  };
  // Thinking needs room of its own before the answer.
  const THINK_ROOM = 1000;

  // The person's model and level, sound whatever was saved.
  function model(S) { const c = S && S.ai && S.ai.claude; return byId(c && c.model) || byId(DEFAULT_MODEL); }
  function level(S) { const c = S && S.ai && S.ai.claude; const v = c && c.think; return v === 'auto' || LEVELS.includes(v) ? v : 'auto'; }
  // The levels a model offers: Off only where its thinking can turn off.
  function levelsFor(m) { return ['auto'].concat(m.off ? LEVELS : LEVELS.slice(1)); }
  // How one feature's request goes: { model, level, thinking, effort, maxTokens }. Off becomes Low on a
  // model that always thinks; with thinking off, effort stays at high or below (the API's rule).
  function shape(S, feature) {
    const m = model(S);
    const f = FEATURES[feature] || FEATURES.chat;
    let lv = level(S);
    if (lv === 'auto') lv = f.auto;
    if (lv === 'off' && !m.off) lv = 'low';
    const off = lv === 'off';
    return {
      model: m, level: lv,
      thinking: off ? { type: m.off } : { type: 'adaptive' },
      effort: off ? f.auto : lv,
      maxTokens: f.tokens[LEVELS.indexOf(lv)],
    };
  }

  /* ------------------------------------------------------------------ money */
  // Millionths of a dollar: tokens × dollars per million tokens.
  const usd = (micro) => micro / 1e6;
  const micro = (dollars) => Math.round(Number(dollars) * 1e6);
  // "$0.32", "$12", "$1.05", "under 1¢".
  function money(m, o) {
    const d = usd(Math.max(0, m || 0));
    if (d > 0 && d < 0.005 && !(o && o.exact)) return 'under 1¢';
    if (d >= 100 || (o && o.whole && Math.abs(d - Math.round(d)) < 0.005)) return `$${Math.round(d)}`;
    if (o && o.exact && d > 0 && d < 0.01) return `$${d.toFixed(4)}`;
    return `$${d.toFixed(2)}`;
  }
  // What one attempt cost, at its model's prices (the long-prompt card when it applies).
  function attemptCost(u, id) {
    const m = byId(id) || DEAREST;
    const n = (k) => Math.max(0, Number(u && u[k]) || 0);
    const input = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens');
    const p = m.long && input > m.long.over ? m.long : m;
    return Math.round(n('input_tokens') * p.in + n('cache_read_input_tokens') * p.read + n('cache_creation_input_tokens') * p.write + n('output_tokens') * p.out);
  }
  // What a response cost. When a backup model stepped in, usage.iterations has every attempt, each at
  // its own model's prices (the top-level counts are only the last one's). Every attempt counts: a
  // refusal before any output is billed only in some categories, and counting it anyway can only
  // make what's counted higher than what's billed, never lower.
  function costOf(usage, modelId) {
    if (!usage) return 0;
    const its = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : null;
    if (its) return its.reduce((a, it) => a + attemptCost(it, (it && it.model) || modelId), 0);
    return attemptCost(usage, modelId);
  }
  // The tokens a text of n characters could be, at worst (numbers and symbols run about 2.5
  // characters a token; plain words nearer 4).
  const tokensFor = (chars) => Math.ceil(Math.max(0, chars) / 2.5) + 64;
  // The most a request could cost: every input token written to the cache, every output token used,
  // and (backup) a fallback model's whole answer after a refusal that used them all.
  function worst(m, inTok, outTok, backup) {
    const p = m.long && inTok > m.long.over ? m.long : m;
    let c = inTok * Math.max(p.in, p.write) + outTok * p.out;
    if (backup && m.backup) c += inTok * Math.max(m.backup.in, m.backup.write) + outTok * m.backup.out;
    return Math.ceil(c);
  }

  /* ------------------------------------------------------------------ the record */
  // S.ai.spend: days { day: { c, n } } (the last 62), months { 'YYYY-MM': { c, n, f: { feature: c },
  // m: { model: c } } } and log, the last 40 requests ({ t, f, m, lv, by?, i, o, r, w, c, est? }: when,
  // the feature, the model asked and its thinking level, the one that answered when a backup did, the
  // tokens in, out, read from and written to the cache, the cost, and whether it was reckoned because
  // the request stopped before the API said what it used).
  const DAYS_KEPT = 62, LOG_KEPT = 40;
  function data(S) {
    const ai = S.ai || (S.ai = {});
    const sp = ai.spend && typeof ai.spend === 'object' ? ai.spend : (ai.spend = {});
    if (!sp.days || typeof sp.days !== 'object') sp.days = {};
    if (!sp.months || typeof sp.months !== 'object') sp.months = {};
    if (!Array.isArray(sp.log)) sp.log = [];
    return sp;
  }
  const monthOf = (day) => B().dayStr(day).slice(0, 7);
  // The days left in day's month, day included, and how many it has.
  function monthDays(day) {
    const [y, mo, d] = B().dayStr(day).split('-').map(Number);
    const len = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { left: len - d + 1, len, date: d };
  }
  function spentOn(S, day) { const x = data(S).days[day]; return (x && x.c) || 0; }
  function spentIn(S, day) { const x = data(S).months[monthOf(day)]; return (x && x.c) || 0; }

  // One request's cost, added to its day and month. u: { feature, model (the one asked), level,
  // usage, estimated? }. Returns the entry.
  function record(S, day, u) {
    const sp = data(S);
    const asked = u.model || DEFAULT_MODEL;
    const its = u.usage && Array.isArray(u.usage.iterations) ? u.usage.iterations : [];
    const served = its.length ? its[its.length - 1].model : asked;
    const c = costOf(u.usage, asked);
    const sum = (k) => (its.length ? its.reduce((a, it) => a + (Number(it[k]) || 0), 0) : Number(u.usage && u.usage[k]) || 0);
    const e = { t: Date.now(), f: u.feature, m: asked, lv: u.level || null, i: sum('input_tokens'), o: sum('output_tokens'), r: sum('cache_read_input_tokens'), w: sum('cache_creation_input_tokens'), c };
    if (served && served !== asked) e.by = served;
    if (u.estimated) e.est = 1;
    const dd = sp.days[day] || (sp.days[day] = { c: 0, n: 0 });
    dd.c += c; dd.n++;
    const mk = monthOf(day);
    const mm = sp.months[mk] || (sp.months[mk] = { c: 0, n: 0, f: {}, m: {} });
    mm.c += c; mm.n++;
    mm.f[u.feature] = (mm.f[u.feature] || 0) + c;
    mm.m[e.by || asked] = (mm.m[e.by || asked] || 0) + c;
    sp.log = sp.log.concat(e).slice(-LOG_KEPT);
    const newest = Math.max(...Object.keys(sp.days).map(Number));
    for (const k of Object.keys(sp.days)) if (Number(k) < newest - DAYS_KEPT) delete sp.days[k];
    return e;
  }

  /* ------------------------------------------------------------------ the limits */
  // S.ai.budget: { monthly, daily, request } in dollars; monthly null is no monthly budget, daily null
  // is Auto (what's left of the month over the days left in it), request null is no limit per request.
  const DEFAULT_BUDGET = { monthly: 10, daily: null, request: null };
  function budget(S) {
    const b = S && S.ai && S.ai.budget;
    const pos = (x) => (typeof x === 'number' && isFinite(x) && x > 0 ? x : null);
    return b && typeof b === 'object' ? { monthly: pos(b.monthly), daily: pos(b.daily), request: pos(b.request) } : Object.assign({}, DEFAULT_BUDGET);
  }
  // Requests in flight: their worst cases count as spent until they're recorded.
  const held = new Map();
  let holdId = 0;
  const heldNow = () => { let a = 0; for (const v of held.values()) a += v; return a; };
  // Where the limits stand on day, in millionths: { month: { limit, spent, left, daysLeft },
  // today: { limit, spent, left, auto }, request, room }. room is what one more request may cost at
  // most (Infinity with no limits at all).
  function limits(S, day) {
    const b = budget(S);
    const md = monthDays(day);
    const today = spentOn(S, day), month = spentIn(S, day), hold = heldNow();
    const mLimit = b.monthly != null ? micro(b.monthly) : null;
    // Auto: what was left of the month this morning, spread over the days left. Fixed for the day, so
    // spending today doesn't move today's limit.
    const auto = mLimit != null ? Math.max(0, Math.floor((mLimit - (month - today)) / md.left)) : null;
    const dLimit = b.daily != null ? micro(b.daily) : auto;
    const left = (limit, spent) => (limit == null ? Infinity : Math.max(0, limit - spent - hold));
    const out = {
      month: { limit: mLimit, spent: month, left: left(mLimit, month), daysLeft: md.left },
      today: { limit: dLimit, spent: today, left: left(dLimit, today), auto: b.daily == null && mLimit != null },
      request: b.request != null ? micro(b.request) : null,
    };
    out.room = Math.min(out.month.left, out.today.left, out.request == null ? Infinity : out.request);
    return out;
  }
  // Which limit stops a request that needs `need`: the month's when it can't fit what's left of the
  // month (a higher daily limit wouldn't help), else today's, else the one for a request.
  function bound(L, need) {
    if (L.month.left < need) return 'month';
    if (L.today.left < need) return 'today';
    return 'request';
  }

  // Whether one feature's request may go, and how: inputChars is everything it sends (system,
  // messages and schema). Returns { ok: true, model, thinking, effort, maxTokens, backup, worst, hold }
  // (hold: pass it back to release, or to record), or { ok: false, code, need, room, limits } when even
  // its smallest useful answer could go over a limit (code: budget-today, budget-month or
  // budget-request).
  function allow(S, day, feature, inputChars) {
    const sh = shape(S, feature);
    const m = sh.model;
    const f = FEATURES[feature] || FEATURES.chat;
    const inTok = tokensFor(inputChars);
    const L = limits(S, day);
    const room = L.room;
    let maxTokens = sh.maxTokens;
    let backup = !!m.backup;
    if (worst(m, inTok, maxTokens, backup) > room) backup = false;
    if (worst(m, inTok, maxTokens, false) > room) {
      const p = m.long && inTok > m.long.over ? m.long : m;
      maxTokens = Math.floor((room - inTok * Math.max(p.in, p.write)) / p.out);
    }
    const least = f.need + (sh.thinking.type === 'adaptive' ? THINK_ROOM : 0);
    if (!(maxTokens >= least)) {
      const need = worst(m, inTok, least, false);
      return { ok: false, code: `budget-${bound(L, need)}`, need, room: isFinite(room) ? room : null, limits: L };
    }
    const w = worst(m, inTok, maxTokens, backup);
    const hold = ++holdId;
    held.set(hold, w);
    return { ok: true, model: m.id, thinking: sh.thinking, effort: sh.effort, level: sh.level, maxTokens, backup, worst: w, hold, cut: maxTokens < sh.maxTokens };
  }
  function release(hold) { held.delete(hold); }

  /* ------------------------------------------------------------------ what people see */
  // The usual cost of a feature's request with the person's model and level: the average of the
  // last ones like it (same feature, model and level), else an estimate from typical sizes.
  const TYPICAL = { chat: [3500, 450], report: [6500, 900], review: [5500, 600], build: [6000, 1400], suggest: [3500, 350], tailor: [2500, 200] };
  const THINKS = { off: 0, low: 0.4, medium: 1.2, high: 2.5, xhigh: 5, max: 8 };
  function typical(S, feature) {
    const sh = shape(S, feature);
    const log = data(S).log.filter((e) => e.f === feature && e.m === sh.model.id && !e.est && e.lv === sh.level);
    if (log.length >= 2) return Math.round(log.reduce((a, e) => a + e.c, 0) / log.length);
    const [inTok, outTok] = TYPICAL[feature] || TYPICAL.chat;
    const m = sh.model;
    return Math.round(inTok * m.in + outTok * (1 + THINKS[sh.level]) * m.out);
  }
  // A short line for Settings: "$0.12 of $0.32 today".
  function todayLine(S, day) {
    const L = limits(S, day);
    if (L.today.limit == null) return `${money(L.today.spent, { exact: true })} today`;
    return `${money(L.today.spent)} of ${money(L.today.limit)} today`;
  }
  // The person's choice, with defaults for whatever is missing (a migration, and Settings).
  function ensure(S) {
    const ai = S.ai || (S.ai = {});
    if (!ai.claude || typeof ai.claude !== 'object') ai.claude = {};
    // 1.10: the model was picked by the app (the newest Opus, re-checked weekly). The last pick stays
    // the model when it's one the person can now pick; anything else starts on the default.
    const was = ai.model && typeof ai.model === 'object' ? ai.model.id : null;
    if (!byId(ai.claude.model)) ai.claude.model = byId(was) ? was : DEFAULT_MODEL;
    delete ai.model;
    if (ai.claude.think !== 'auto' && !LEVELS.includes(ai.claude.think)) ai.claude.think = 'auto';
    if (!ai.budget || typeof ai.budget !== 'object') ai.budget = Object.assign({}, DEFAULT_BUDGET);
    else ai.budget = budget(S);
    data(S);
    return ai.claude;
  }
  (GH.migrations || (GH.migrations = [])).push(ensure);

  GH.spend = {
    MODELS, DEFAULT_MODEL, LEVELS, LEVEL_NAMES, LEVEL_NOTES, FEATURES, DEFAULT_BUDGET,
    byId, model, level, levelsFor, shape, costOf, worst, tokensFor, money, usd, micro,
    data, record, budget, limits, allow, release, typical, todayLine, monthDays, monthOf, ensure,
  };
})(typeof window !== 'undefined' ? window : globalThis);
