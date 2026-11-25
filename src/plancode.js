/* The plan code (GH.planCode; toCode and fromCode on GH.customPlan too): a plan as a short text code
 * to copy into a message, read out or type, such as GH1A-2B3C-4D5E-…. There is no server: the code is
 * the plan. This part loads with the plan builder (planUi in scripts/build.mjs), and
 * GH.customPlan.decode() waits for it, so every way in takes a code or a link.
 *
 * The text: "GH", then Crockford base32 (0-9 and A-Z without I, L, O and U), 5 bits a symbol, in
 * groups of four joined by hyphens. Reading one ignores case, spaces, hyphens and line breaks, takes
 * O for 0 and I or L for 1, and finds a code among other words.
 *
 * The frame is the same for every format to come, so an older app can tell a newer code from a typo:
 *
 *   G H | format, one symbol | the plan's bits | 0 bits up to a whole group | check, 4 symbols
 *
 * The check is a 20-bit CRC over the symbols from the format to the padding. Its generator is
 * x^20 + x^19 + x^6 + x^5 + x^3 + 1, which is x + 1 times a primitive polynomial of degree 19, and it
 * starts from all ones and is flipped at the end. It catches every single wrong character and every
 * two neighbours swapped (any burst up to 20 bits), any three wrong bits, and all but one in a million
 * of anything else. A code is whole groups, so one with a character dropped or doubled never fits.
 *
 * Format 1, the plan's bits, most significant first:
 *
 *   days - 1 (3) · set weekdays? (1) [Monday to Sunday, a bit each (7)] · name? (1) [text] · rests? (1)
 *   each day:      exercises - 1 (4) · title? (1) [text]
 *   each exercise: move (9; 511 means 511 + the next 9) · sets (2: 3, 2 or 4; else the next 3: 1, 5-10)
 *                  · amount · with rests: rest? (1) [4: one of RESTS; 15 means the next 9, in seconds]
 *   amount: 0 + 3: one of AMOUNTS · 10 + 5: 1 to 32 · 110 + 5: 5 to 160 in fives · 111 + 10: 1 to 1024
 *   text:   0 + length (6) + 5-bit letters, or 1 + length (7) + UTF-8 bytes
 *   letters: 0-25 a to z · 26 a space · 27 the next letter's case the other way (a text starts with
 *            a capital and goes on in small letters) · 28 one of MARKS, by the next 5 · 29 a space,
 *            then a capital
 *
 * An amount is reps, or seconds for a move that's held: which one follows from the move, so the
 * bits read the same for a move this version doesn't know. A move is its number in
 * GH.PLAN_CODE_MOVES (src/data/plancode-moves.js), a list that only grows. A plan's name and a day's
 * title are in the code only when they differ from what the app would call them anyway ("My plan", a
 * single workout by its day, a day by its muscles). The note and who shared it are never in it.
 *
 * All of this is format 1 for good: a change to a table or a field here is format 2.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const C = () => GH.customPlan;

  const FORMAT = 1;
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const SYM_G = 16, SYM_H = 17;
  const GROUP = 4, CHECK = 4;
  // The longest code a plan can make is about 1,800 symbols (six days of twelve, every name long and
  // in another script). Nothing longer is looked at, and no more than a few places it could start.
  const MAX_SYMBOLS = 2048, MAX_TEXT = 8192, MIN_SYMBOLS = 16, MAX_STARTS = 12;
  const AMOUNTS = [5, 6, 8, 10, 12, 15, 20, 30];
  const SETS = [3, 2, 4], SETS_MORE = [1, 5, 6, 7, 8, 9, 10];
  const RESTS = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 10, 20, 40];
  const MARKS = '0123456789\'-,.&+/()!?:#%"@*=;_’–';
  const POLY = 0x80069;

  const VALUE = Object.create(null);
  for (let i = 0; i < 32; i++) { VALUE[ALPHABET[i]] = i; VALUE[ALPHABET[i].toLowerCase()] = i; }
  for (const [ch, v] of [['O', 0], ['I', 1], ['L', 1]]) { VALUE[ch] = v; VALUE[ch.toLowerCase()] = v; }
  // What may sit between a code's symbols: white space, and hyphens and dashes of every kind
  // (keyboards turn one into another), with the characters that can't be seen.
  const WHITE = /\s/;
  const JOINS = /[-_­‐-―−​-‍⁠]/;
  const WORD = /[0-9A-Za-z]/;
  const broken = () => C().codeError('broken');

  /* ---------------------------------------------------------------- bits and the check */
  function writer() {
    const sym = [];
    let acc = 0, n = 0;
    const put = (v, bits) => {
      for (let i = bits - 1; i >= 0; i--) {
        acc = (acc << 1) | ((v >>> i) & 1);
        if (++n === 5) { sym.push(acc); acc = 0; n = 0; }
      }
    };
    return { sym, put, flush() { while (n) put(0, 1); return sym; } };
  }
  // Bits out of sym[from .. to). Reading past the end is a broken code, never a wait or a guess.
  function reader(sym, from, to) {
    let at = from * 5;
    const end = to * 5;
    return {
      get(bits) {
        if (at + bits > end) throw broken();
        let v = 0;
        for (let i = 0; i < bits; i++, at++) v = (v << 1) | ((sym[(at / 5) | 0] >>> (4 - (at % 5))) & 1);
        return v;
      },
      // After the plan only padding may follow: under a group of it, all 0.
      done() {
        if (end - at >= GROUP * 5) throw broken();
        while (at < end) if (this.get(1)) throw broken();
      },
    };
  }
  function crcAdd(crc, v) {
    for (let i = 4; i >= 0; i--) {
      const bit = ((crc >>> 19) ^ (v >>> i)) & 1;
      crc = (crc << 1) & 0xfffff;
      if (bit) crc ^= POLY;
    }
    return crc;
  }
  const checkOf = (crc) => { const x = crc ^ 0xfffff; return [x >>> 15, (x >>> 10) & 31, (x >>> 5) & 31, x & 31]; };
  const pretty = (sym) => sym.map((v) => ALPHABET[v]).join('').replace(/(.{4})(?=.)/g, '$1-');
  // The format and the plan's bits as a whole code: the prefix, padding to whole groups, the check.
  function seal(body, bare) {
    const sym = body.slice();
    while ((2 + sym.length + CHECK) % GROUP) sym.push(0);
    let crc = 0xfffff;
    for (const v of sym) crc = crcAdd(crc, v);
    const all = [SYM_G, SYM_H].concat(sym, checkOf(crc));
    return bare ? all.map((v) => ALPHABET[v]).join('') : pretty(all);
  }

  /* ---------------------------------------------------------------- names */
  const isUpper = (ch) => ch >= 'A' && ch <= 'Z';
  const isLetter = (ch) => isUpper(ch) || (ch >= 'a' && ch <= 'z');
  // A name in the 5-bit letters, or null when it holds something they don't have.
  function toLetters(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === ' ' && isUpper(s[i + 1] || '')) out.push(29, s.charCodeAt(++i) - 65);
      else if (ch === ' ') out.push(26);
      else if (isLetter(ch)) { if (isUpper(ch) !== (i === 0)) out.push(27); out.push((s.charCodeAt(i) | 32) - 97); }
      else { const k = MARKS.indexOf(ch); if (k < 0) return null; out.push(28, k); }
    }
    return out;
  }
  function putText(w, s) {
    const five = toLetters(s);
    const bytes = new G.TextEncoder().encode(s);
    if (five && five.length < 64 && 6 + five.length * 5 <= 7 + bytes.length * 8) {
      w.put(0, 1); w.put(five.length, 6);
      for (const c of five) w.put(c, 5);
    } else {
      w.put(1, 1); w.put(bytes.length, 7);
      for (const b of bytes) w.put(b, 8);
    }
  }
  function getText(r) {
    if (r.get(1)) {
      const bytes = new Uint8Array(r.get(7));
      for (let i = 0; i < bytes.length; i++) bytes[i] = r.get(8);
      return new G.TextDecoder().decode(bytes);
    }
    let s = '', flip = false;
    for (let left = r.get(6); left > 0; left--) {
      const c = r.get(5);
      if (c < 26) { s += String.fromCharCode(((s === '') !== flip ? 65 : 97) + c); flip = false; }
      else if (c === 26) s += ' ';
      else if (c === 27) flip = true;
      else {
        // 28 and 29 come with a second one, counted in the length too.
        if (c > 29 || left < 2) throw broken();
        left--;
        const k = r.get(5);
        if (c === 29 && k > 25) throw broken();
        s += c === 28 ? MARKS[k] : ` ${String.fromCharCode(65 + k)}`;
      }
    }
    return s;
  }
  // What the app calls a plan nobody named: a single workout by its day, any other "My plan".
  const autoName = (plan) => (plan.days.length === 1 ? C().titleOf(plan, 0) : 'My plan').slice(0, C().LIMITS.name);

  /* ---------------------------------------------------------------- a plan into bits, and back */
  function numberOf(id) {
    const n = GH.PLAN_CODE_MOVES.indexOf(id);
    if (n < 0) throw new Error(`${id} has no plan code number: add it at the end of src/data/plancode-moves.js`);
    return n;
  }
  function putAmount(w, v) {
    const k = AMOUNTS.indexOf(v);
    if (k >= 0) w.put(k, 4);
    else if (v <= 32) { w.put(2, 2); w.put(v - 1, 5); }
    else if (v % 5 === 0 && v <= 160) { w.put(6, 3); w.put(v / 5 - 1, 5); }
    else { w.put(7, 3); w.put(v - 1, 10); }
  }
  function getAmount(r) {
    if (!r.get(1)) return AMOUNTS[r.get(3)];
    if (!r.get(1)) return r.get(5) + 1;
    return r.get(1) ? r.get(10) + 1 : (r.get(5) + 1) * 5;
  }
  // plan: one that normalize() made (every day has exercises, every number is in range).
  function pack(plan) {
    const w = writer();
    w.put(FORMAT, 5);
    w.put(plan.days.length - 1, 3);
    w.put(plan.weekdays ? 1 : 0, 1);
    if (plan.weekdays) w.put(plan.weekdays.reduce((a, d) => a | (64 >> d), 0), 7);
    // (A single workout called "My plan" all the same: a name with nothing in it, which reads as that.)
    const named = plan.name !== autoName(plan);
    w.put(named ? 1 : 0, 1);
    if (named) putText(w, plan.name === 'My plan' ? '' : plan.name);
    const rests = plan.days.some((d) => d.items.some((it) => it.rest != null));
    w.put(rests ? 1 : 0, 1);
    for (const d of plan.days) {
      w.put(d.items.length - 1, 4);
      const titled = !!d.title && d.title !== C().titleFrom(d.items);
      w.put(titled ? 1 : 0, 1);
      if (titled) putText(w, d.title);
      for (const it of d.items) {
        const n = numberOf(it.move);
        if (n < 511) w.put(n, 9); else { w.put(511, 9); w.put(n - 511, 9); }
        const s = SETS.indexOf(it.sets);
        if (s >= 0) w.put(s, 2); else { w.put(3, 2); w.put(SETS_MORE.indexOf(it.sets), 3); }
        putAmount(w, it.secs != null ? it.secs : it.reps);
        if (!rests) continue;
        w.put(it.rest != null ? 1 : 0, 1);
        if (it.rest == null) continue;
        const q = RESTS.indexOf(it.rest);
        if (q >= 0) w.put(q, 4); else { w.put(15, 4); w.put(it.rest, 9); }
      }
    }
    return w.flush();
  }
  // Format 1's bits (sym[1 .. end), after the format) as something plan-like for normalize(). A
  // number past this version's list is a move from a newer one: it's named '#<number>', which
  // normalize() leaves out and reports.
  function unpack(sym, end) {
    const L = C().LIMITS;
    const r = reader(sym, 1, end);
    const n = r.get(3) + 1;
    if (n > L.days) throw broken();
    let weekdays = null;
    if (r.get(1)) {
      const mask = r.get(7);
      weekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (64 >> d));
      if (weekdays.length !== n) throw broken();
    }
    const name = r.get(1) ? getText(r) : null;
    const rests = r.get(1);
    const days = [];
    for (let i = 0; i < n; i++) {
      const k = r.get(4) + 1;
      if (k > L.items) throw broken();
      const title = r.get(1) ? getText(r) : '';
      const items = [];
      for (let j = 0; j < k; j++) {
        let num = r.get(9);
        if (num === 511) num += r.get(9);
        const s = r.get(2);
        const sets = s < 3 ? SETS[s] : SETS_MORE[r.get(3)];
        if (!sets) throw broken();
        const it = { move: GH.PLAN_CODE_MOVES[num] || `#${num}`, sets, reps: getAmount(r) };
        if (rests && r.get(1)) { const q = r.get(4); it.rest = q < 15 ? RESTS[q] : r.get(9); }
        items.push(it);
      }
      days.push({ title, items });
    }
    r.done();
    return { name, weekdays, days, source: 'shared' };
  }

  /* ---------------------------------------------------------------- the code as text */
  // The code for a plan: 'GH1A-2B3C-…' (opts.bare: without the hyphens). Anything plan-like goes
  // through normalize() first; a plan with no exercises has no code.
  function toCode(plan, opts) {
    const p = C().normalize(plan).plan;
    if (!p.days.length) throw new Error(C().problems(p)[0]);
    return seal(pack(p), !!(opts && opts.bare));
  }
  // Each place in a text where a code could start (a G, then an H, not in the middle of a word),
  // with the symbols from there on and where white space breaks them: a code in a message can have
  // words after it that read as symbols too ("thanks").
  function starts(text) {
    const s = String(text == null ? '' : text).slice(0, MAX_TEXT);
    const out = [];
    for (let i = 0; i < s.length && out.length < MAX_STARTS; i++) {
      if (VALUE[s[i]] !== SYM_G || (i && WORD.test(s[i - 1]))) continue;
      const sym = [], cuts = [];
      let gap = false;
      for (let j = i; j < s.length && sym.length < MAX_SYMBOLS; j++) {
        const v = VALUE[s[j]];
        if (v == null) { if (WHITE.test(s[j])) gap = true; else if (!JOINS.test(s[j])) break; continue; }
        if (sym.length === 1 && v !== SYM_H) break;
        if (gap) cuts.push(sym.length);
        gap = false;
        sym.push(v);
      }
      if (sym.length > 1) { cuts.push(sym.length); out.push({ sym, cuts }); }
    }
    return out;
  }
  // The whole codes in a text: the symbols of each (the prefix first) that end, at the text's own
  // end or at white space, in whole groups with the right check, the longest from each start
  // first. like: how many symbols the longest run that starts like a code has (0: none does).
  function frames(text) {
    const list = starts(text);
    const whole = [];
    for (const { sym, cuts } of list) {
      // at[k]: the check as it stands over sym[2 .. k), so every length is tried in one pass.
      const at = [0, 0, 0xfffff];
      for (let k = 2; k < sym.length; k++) at[k + 1] = crcAdd(at[k], sym[k]);
      for (let c = cuts.length - 1; c >= 0; c--) {
        const n = cuts[c];
        if (n < MIN_SYMBOLS || n % GROUP) continue;
        if (checkOf(at[n - CHECK]).every((v, q) => v === sym[n - CHECK + q])) whole.push(sym.slice(0, n));
      }
    }
    return { whole, like: list.reduce((a, x) => Math.max(a, x.sym.length), 0) };
  }
  function read(sym) {
    const format = sym[2];
    if (format > FORMAT) throw C().codeError('newer');
    if (format < 1) throw broken();
    const raw = unpack(sym.slice(2), sym.length - 2 - CHECK);
    const out = C().normalize(raw);
    // Every exercise from a newer version: nothing left to show, and that's why.
    if (!out.plan.days.length) throw C().codeError(out.report.unknown.length ? 'newer' : 'broken');
    if (raw.name == null) out.plan.name = autoName(out.plan);
    out.plan.source = 'shared';
    out.code = pretty(sym);
    return out;
  }
  // A plan (not saved yet) out of a code, however it was typed and whatever is around it:
  // { plan, report, code } (code: as the app writes it), or an Error with .code: 'typo' (it starts
  // like a code and doesn't check out; .symbols is how many characters of it there are), 'newer',
  // or 'broken' (it checks out and holds no plan, or there's no code there at all).
  function fromCode(text) {
    let found = frames(text);
    const like = found.like;
    // Typed without the GH it starts with: read as if it were there.
    if (!like) found = frames(`GH ${String(text == null ? '' : text).slice(0, MAX_TEXT)}`);
    let err = null;
    for (const sym of found.whole) {
      try { return read(sym); } catch (e) { if (!e || !e.code) throw e; err = err || e; }
    }
    if (!err) { err = C().codeError(like ? 'typo' : 'broken', like ? null : 'That isn\'t a plan code. A code starts with GH.'); err.symbols = like; }
    throw err;
  }
  // The first whole code in a text, as the app writes it (it may still be from a newer version), or null.
  function find(text) {
    const f = frames(text).whole[0];
    return f ? pretty(f) : null;
  }
  // What's typed so far the way a code is written: capitals, 0 for O, 1 for I and L, groups of four.
  // null when it holds anything a code doesn't (a field then leaves it as it was typed).
  function tidy(text) {
    const sym = [];
    for (const ch of String(text == null ? '' : text).slice(0, MAX_TEXT)) {
      const v = VALUE[ch];
      if (v != null) sym.push(v);
      else if (!WHITE.test(ch) && !JOINS.test(ch)) return null;
    }
    return pretty(sym);
  }
  // One day of a plan as a plan of its own, named for the day, to share a single workout.
  function dayPlan(plan, di) {
    const d = plan && plan.days[di];
    return d ? C().normalize({ name: C().titleOf(plan, di), days: [d] }).plan : null;
  }

  GH.planCode = { FORMAT, ALPHABET, MAX_SYMBOLS, toCode, fromCode, find, tidy, dayPlan, seal };
  if (C()) Object.assign(C(), { toCode, fromCode, dayPlan });
})(typeof window !== 'undefined' ? window : globalThis);
