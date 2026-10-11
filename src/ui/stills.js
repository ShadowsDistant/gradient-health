/* The 3D figure's stills of the moves, kept on the phone. A still is a move's key pose in the 3D
 * figure, as Plan's tiles, the plan builder, set-up's reveal and Settings' preview show it. Each is
 * drawn once by the 3D chunk and kept across launches (IndexedDB), under the move as the person does
 * it (the kit they have), the look (theme, skin, shirt), its size, the figure's own id (GH.FIGURE,
 * from the build: the code that draws it) and what the move's figure is drawn from (its poses and
 * steps, not its words), so a change to any of them draws it again. What's kept is read into memory
 * once launch's first frame is drawn (core.js), so a screen puts a kept still straight into its HTML:
 * it's there from the screen's first frame, without the 3D chunk, and the flat figure never stands in
 * for it. After an update that draws the figure differently, the stills the last version kept stand
 * in, in their tiles, until this version's are drawn.
 *
 * One that isn't kept is drawn as soon as it can be: the 3D chunk and its warm-up start as soon as a
 * still is missing (core.js asks for this week's and next week's after launch), each step in a calm
 * moment (U.calm: nothing touched or scrolled for a moment); then each still is drawn in an idle
 * moment, those a screen waits for first, whenever nothing is in the person's hands (no finger on the
 * screen, the page not scrolling, no sheet or control moving) and no live figure is on screen, and
 * the ones drawn ahead when it's calm. A still holds the page's thread for a frame or two only: the
 * GPU's work and the encoding run in the background (figure3d.stillNow), and it shows at once. The
 * phone keeps up to KEEP; past that, the ones no week of the plan shows go, oldest first. A screen's
 * tile waits on the tile's own background, and its still fades in.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const doc = G.document;
  const DB = 'gh-stills', OS = 'stills';
  const KEEP = 300; // stills kept on the phone, at most, once the ones no week shows can go
  const TEMP = 150; // stills held for this launch only (the plan builder's large tiles), at most
  const engine = () => GH.FIGURE || GH.BUILD || 'dev';
  const mem = new Map(); // key → URL: what's kept, read in, and what's been drawn since
  const temp = new Map(); // key → URL, drawn for this launch only
  const stale = new Map(); // key without the figure's id → { k, url, at }: kept by an older figure
  const asked = new Map(), ahead = new Map(); // key → job { k, m, o, keep, fns }: for a screen, ahead
  const failed = new Set(); // keys that couldn't be drawn this launch: their tiles show the flat figure
  const dirty = new Map(); // key → record, drawn and not written yet
  let need = null; // the keys of this week's and next week's stills, which stay past KEEP
  let reads = null; // what's kept, being read in (a promise)
  let tries = 0; // warm-ups that failed: at 3, the flat figure for this launch
  let noChunk = false; // the 3D chunk didn't load (until a figure loads it)
  let waiting = false, warming = false, writing = 0, cost = 0, drawn = 0;
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn(null), 50));
  const now = () => (G.performance ? G.performance.now() : Date.now());
  const safe = (fn) => { try { fn(); } catch (e) { if (G.console) G.console.error(e); } };

  /* ---------------------------------------------------------------- which still */
  // A short hash of a string (FNV-1a).
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  // The kit a move is drawn with (forPerson swaps it for what the person has).
  const kit = (m) => hash(JSON.stringify([m.equip || null, m.props || null]));
  // What else a move's figure is drawn from: its poses, steps, view and the rest of its own data, but
  // not its words or what only the plan reads. GH.FIGURE covers the code that draws it, so an update
  // that only changes a move's cues, or adds moves, keeps every still, and one that changes how a move
  // goes draws that move's again. Worked out once per move (forPerson's copies share their move's).
  const WORDS = new Set(['name', 'cues', 'mistake', 'breathe', 'group', 'joints', 'load', 'req', 'range', 'start', 'prime', 'pos', 'family', 'grip', 'timed', 'ratio', 'gym', 'spine', 'equipBy', 'propsBy', 'overhead', 'complex', 'oneLeg', 'hands', 'mobFor', 'support', 'deep', 'headDown', 'ballistic', 'quick', 'impact', 'powerOf']);
  const shapes = new Map(); // move id → hash
  function shape(m) {
    const base = GH.moves && GH.moves.MOVES ? GH.moves.MOVES[m.id] : null;
    const same = !!base && (base === m || (base.form === m.form && base.rep === m.rep && base.poses === m.poses && base.view === m.view));
    if (same && shapes.has(m.id)) return shapes.get(m.id);
    const src = same ? base : m, o = {};
    for (const k of Object.keys(src)) if (k[0] !== '$' && k !== 'equip' && k !== 'props' && !WORDS.has(k)) o[k] = src[k];
    const h = hash(JSON.stringify(o));
    if (same) shapes.set(m.id, h);
    return h;
  }
  // Under what a still is kept: the figure's id first (an older figure's stills are told apart by it),
  // then its size, the look, and the move with its kit and what it's drawn from.
  const key = (m, o) => [engine(), o.crop ? `c${o.crop}` : `${o.width}x${o.height}`, o.dark ? 'd' : 'l', o.skin || 'sand', o.shirt || '', m.id, kit(m), shape(m)].join('|');
  // A key without the figure's id or what the move's drawn from: an older figure's still of the same
  // move, size, look and kit stands in for it until it's drawn.
  const rest = (k) => k.split('|').slice(1, 7).join('|');
  // The person's look for a still css px across (a square around the figure), or css × h px (the
  // whole move), at the screen's pixel density (2x at most).
  function look(css, h) {
    const pr = (U.S && U.S.profile.prefs) || {};
    const d = Math.min(2, G.devicePixelRatio || 1);
    const o = { dark: String(GH.platform ? GH.platform.currentTheme() : '').startsWith('dark'), skin: pr.figSkin || 'sand', shirt: pr.figShirt || undefined };
    if (h) { o.width = Math.round(css * d); o.height = Math.round(h * d); } else o.crop = Math.round(css * d);
    return o;
  }
  // Whether screens show 3D stills: the 3D figure picked and possible here; else the flat figure.
  const ok = () => tries < 3 && (!noChunk || !!GH.figure3d) && !!(U.figure3dOk && U.figure3dOk());
  const url = (k) => mem.get(k) || temp.get(k) || null;
  // An older figure's still standing in for k, if one is kept: { k, url }.
  const standIn = (k) => stale.get(rest(k)) || null;

  /* ---------------------------------------------------------------- kept on the phone */
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = G.indexedDB.open(DB, 1);
          req.onupgradeneeded = () => { req.result.createObjectStore(OS, { keyPath: 'k' }).createIndex('at', 'at'); };
          req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); } // no IndexedDB here: kept for this launch only
      });
    }
    return dbp;
  }
  // One transaction: fn(store) makes its requests; resolves with the result of the one it returns
  // once it's done (null if it failed).
  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve) => {
      if (!d) { resolve(null); return; }
      try {
        const t = d.transaction(OS, mode);
        const req = fn(t.objectStore(OS));
        t.oncomplete = () => resolve(req ? req.result : true);
        t.onerror = t.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }
  // What's kept, read into memory in one request (once). Stills an older figure drew are read too
  // (after an update): one per move, size, look and kit stands in until this figure's is drawn, and
  // the rest go with the next write.
  let old = []; // keys an older figure drew that nothing stands in for
  function load() {
    if (!reads) {
      const lo = `${engine()}|`;
      reads = tx('readonly', (os) => os.getAll()).then((list) => {
        for (const r of list || []) {
          if (!r || typeof r.k !== 'string' || typeof r.url !== 'string' || !r.url.startsWith('data:image/')) continue;
          if (r.k.startsWith(lo)) { if (!mem.has(r.k)) mem.set(r.k, r.url); continue; }
          const s = rest(r.k), was = stale.get(s);
          if (was && (was.at || 0) >= (r.at || 0)) { old.push(r.k); continue; }
          if (was) old.push(was.k);
          stale.set(s, { k: r.k, url: r.url, at: r.at || 0 });
        }
        return mem.size;
      });
    }
    return reads;
  }
  function keep(k, u) {
    mem.set(k, u);
    dirty.set(k, { k, url: u, at: Date.now() });
    if (!writing) writing = setTimeout(write, 2000);
  }
  // What's been drawn since the last write, written together (a transaction each would add up), then
  // what's kept trimmed. Also when the app goes to the background.
  function write() {
    clearTimeout(writing);
    writing = 0;
    if (!dirty.size) return Promise.resolve();
    const recs = Array.from(dirty.values());
    dirty.clear();
    return tx('readwrite', (os) => { for (const r of recs) os.put(r); }).then(trim);
  }
  if (doc) doc.addEventListener('visibilitychange', () => { if (doc.hidden && dirty.size) write(); });
  // Past KEEP stills, the oldest that this week and next don't show go. An older figure's go once
  // this figure's still of the same is in, or if this week and next don't show it.
  function trim() {
    const cur = new Set(Array.from(mem.keys(), rest));
    const shown = need ? new Set(Array.from(need, rest)) : null;
    const gone = old.splice(0);
    for (const [s, v] of stale) if (cur.has(s) || (shown && !shown.has(s))) { gone.push(v.k); stale.delete(s); }
    return tx('readwrite', (os) => {
      for (const k of gone) os.delete(k);
      const n = os.count();
      n.onsuccess = () => {
        let over = n.result - KEEP;
        if (over <= 0 || !need) return;
        const c0 = os.index('at').openKeyCursor();
        c0.onsuccess = () => {
          const c = c0.result;
          if (!c || over <= 0) return;
          const k = c.primaryKey, s = stale.get(rest(k));
          if (!need.has(k)) { os.delete(k); mem.delete(k); if (s && s.k === k) stale.delete(rest(k)); over--; }
          c.continue();
        };
      };
    });
  }
  // Reset everything: what's kept goes with the rest (it's drawn in the person's look).
  function clear() {
    for (const u of [...mem.values(), ...temp.values()]) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    for (const x of [mem, temp, stale, dirty, failed, asked, ahead]) x.clear();
    old = [];
    clearTimeout(writing);
    writing = 0;
    reads = need = null;
    return db().then((d) => new Promise((resolve) => {
      if (d) d.close();
      dbp = null;
      try { const req = G.indexedDB.deleteDatabase(DB); req.onsuccess = req.onerror = req.onblocked = () => resolve(); } catch (e) { resolve(); }
    }));
  }

  /* ---------------------------------------------------------------- when */
  // Something in the person's hands: a finger on the screen (or a mouse button held), the page
  // scrolling or settling (#app[data-scrolling], set by core.js until 150 ms after the last scroll;
  // set-up's scroller too), a sheet moving or a control held or gliding. A still is never drawn then.
  let fingers = 0, pressed = false;
  if (doc) {
    const opt = { passive: true, capture: true };
    doc.addEventListener('touchstart', (e) => { fingers = e.touches.length; }, opt);
    const lift = (e) => { fingers = e.touches.length; };
    doc.addEventListener('touchend', lift, opt);
    doc.addEventListener('touchcancel', lift, opt);
    doc.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') pressed = true; }, opt);
    for (const ev of ['pointerup', 'pointercancel']) doc.addEventListener(ev, (e) => { if (e.pointerType === 'mouse') pressed = false; }, opt);
    if (G.addEventListener) G.addEventListener('blur', () => { fingers = 0; pressed = false; });
  }
  const scrolling = () => !!doc.querySelector('#app[data-scrolling], .onboard[data-scrolling]');
  const busy = () => fingers > 0 || pressed || scrolling() || doc.documentElement.hasAttribute('data-sheet-moving') || !!(U.controlsMoving && U.controlsMoving());
  const calm = () => !busy() && (!U.calm || U.calm());
  // A figure's box showing (the player, a move's sheet), whose live figure stills would take frames
  // from: they wait. (A workout put aside keeps its figure, hidden: that one doesn't count.)
  const figureShown = () => Array.prototype.some.call(doc.querySelectorAll('.pl-fig, .sheet-fig'), (h) => !!h.offsetParent);
  // fn(deadline) in the next idle moment that's free (nothing in the person's hands; calm too if
  // lax, for the work that can wait longer: true, or a function asked each time), the app in front.
  function whenFree(fn, lax) {
    const again = () => setTimeout(() => whenFree(fn, lax), 100);
    if (doc.hidden) { doc.addEventListener('visibilitychange', again, { once: true }); return; }
    idle((deadline) => {
      if (doc.hidden || ((typeof lax === 'function' ? lax() : lax) ? !calm() : busy())) { again(); return; }
      fn(deadline);
    });
  }
  // The chunk's run and the warm-up's steps hold the page's thread for a while: calm moments only.
  const whenCalm = (fn) => whenFree(fn, true);

  /* ---------------------------------------------------------------- drawing */
  // A still for a screen: its URL if it's kept; false if it can't be drawn (the flat figure, then);
  // otherwise null, and it's drawn: fn(url) once it's in (fn(null) if it can't be). opt.ahead: after
  // what screens wait for; opt.keep false: for this launch only, not kept on the phone.
  function want(m, o, fn, opt) {
    const k = key(m, o);
    const u = url(k);
    if (u) return u;
    if (failed.has(k)) return false;
    const later = !!(opt && opt.ahead);
    let job = asked.get(k) || ahead.get(k);
    if (!job) {
      job = { k, m, o, keep: !(opt && opt.keep === false), fns: [] };
      (later ? ahead : asked).set(k, job);
      // Maybe kept, but not read in yet (just after launch): read in first, drawn only if it isn't.
      load().then(() => { const kept = mem.get(k); if (kept) done(job, kept); else pump(); });
    } else if (!later && ahead.delete(k)) asked.set(k, job);
    // (A tile asking again while it waits replaces its own callback.)
    if (fn) { if (fn.host) job.fns = job.fns.filter((x) => x.host !== fn.host); job.fns.push(fn); }
    return null;
  }
  // A still is in (or can't be drawn, null): off the lists, and to whatever waits for it.
  function done(job, u) {
    if (asked.get(job.k) === job) asked.delete(job.k);
    if (ahead.get(job.k) === job) ahead.delete(job.k);
    for (const fn of job.fns.splice(0)) safe(() => fn(u));
  }
  const ready = (f) => !!f && (f.stillsReady ? f.stillsReady() : f.warm());
  // A still a screen waits for, not drawn yet.
  const urgent = () => { for (const j of asked.values()) if (!j.busy && !j.wait) return true; return false; };
  // Draws what's asked for when it can: the figure ready, then in a free idle moment with no live
  // figure on screen (a calm one if only stills drawn ahead are waiting).
  function pump() {
    if (waiting || !(asked.size || ahead.size)) return;
    if (!ok()) { for (const j of [...asked.values(), ...ahead.values()]) done(j, null); return; }
    const f = GH.figure3d;
    if (!ready(f)) { warm(); return; }
    waiting = true;
    // (Calm only while no screen waits: one that asks meanwhile doesn't wait for calm.)
    whenFree((deadline) => {
      waiting = false;
      if (figureShown()) { waiting = true; setTimeout(() => { waiting = false; pump(); }, 1500); return; }
      const busy = draw(deadline);
      // The GPU still on the last stills: the next once they're back.
      if (busy) { waiting = true; busy.then(() => { waiting = false; pump(); }); return; }
      pump();
    }, () => !urgent());
  }
  // The 3D chunk, asked for at once (it's fetched and parsed off the page's thread), and its warm-up,
  // each step in a calm moment. One that didn't get there is tried again, twice. The stills go as
  // soon as its shaders are compiled (before its last step).
  function warm() {
    if (warming || !GH.lazy) return;
    warming = true;
    const fail = () => { warming = false; noChunk = true; pump(); };
    GH.lazy('figure3d').then((f) => {
      if (!f || !f.preload) { fail(); return; }
      if (!ok()) { warming = false; pump(); return; }
      f.preload({ when: whenCalm, ready: pump, busy: urgent }).then(() => {
        warming = false;
        if (!ready(GH.figure3d)) tries++;
        pump();
      }, () => { warming = false; tries++; pump(); });
    }, fail);
  }
  // As many stills as fit in this idle moment (one at least; the ones a screen waits for go together,
  // a few at a time, so a tile's neighbours come with it). Those drawn in one go are copied out of the
  // GL canvas together. Returns a promise if the GPU is still busy with the last ones.
  function draw(deadline) {
    const f = GH.figure3d;
    const L = look(1);
    const t0 = now();
    for (let n = 0; ready(f); n++) {
      const job = next(L);
      // (One drawn ahead only once it's calm too.)
      if (!job || (!asked.has(job.k) && !calm())) return null;
      const left = deadline ? deadline.timeRemaining() : 0;
      if (n && !(left > cost + 4 || (asked.has(job.k) && n < 3 && now() - t0 + cost < 50))) return null;
      const t1 = now();
      let r = null;
      try { r = f.stillNow(job.m, job.o); } catch (e) { r = null; }
      if (r && r.busy) return r.busy;
      cost = now() - t1;
      // New shaders, compiling in the background: the others meanwhile, this one once they're in.
      if (r && r.wait) { job.wait = true; r.wait.then(() => { job.wait = false; pump(); }); continue; }
      job.busy = true;
      drawn++;
      take(job, r);
    }
    return null;
  }
  // A drawn still into its tiles: at once, from its picture (an object URL); kept on the phone as a
  // data URL, made in the background (the next launch shows it from its first frame).
  function take(job, r) {
    const out = (u) => {
      if (!u) failed.add(job.k);
      else if (!job.keep) { temp.set(job.k, u); if (temp.size > TEMP) temp.delete(temp.keys().next().value); }
      else if (u.startsWith('data:')) keep(job.k, u);
      else mem.set(job.k, u);
      done(job, u);
    };
    if (!r) { out(null); return; }
    if (!r.blob) { (r.url || Promise.resolve(null)).then(out, () => out(null)); return; }
    r.blob.then((b) => {
      // The GPU taken back while it was drawn: drawn again once the figure's back.
      if (!b && !ready(GH.figure3d)) { job.busy = false; pump(); return; }
      if (!b) { out(null); return; }
      out(URL.createObjectURL(b));
      if (!job.keep) return;
      const fr = new FileReader();
      fr.onload = () => { if (typeof fr.result === 'string' && mem.get(job.k)) keep(job.k, fr.result); };
      fr.readAsDataURL(b);
    }, () => out(null));
  }
  // The next still to draw: what a screen waits for first. One in another look than the person's now
  // (the theme, skin or shirt changed since) is dropped, unless a tile on screen still waits for it
  // (its screen wasn't drawn again: the phone's theme changing doesn't redraw it).
  function next(L) {
    for (const list of [asked, ahead]) {
      for (const j of Array.from(list.values())) {
        if (j.busy || j.wait) continue;
        const other = j.o.dark !== L.dark || (j.o.skin || 'sand') !== L.skin || (j.o.shirt || '') !== (L.shirt || '');
        if (other && !j.fns.some((fn) => !fn.host || (fn.host.isConnected && fn.host.getAttribute('data-want') === j.k))) { list.delete(j.k); continue; }
        return j;
      }
    }
    return null;
  }
  // Stills drawn ahead, after what screens wait for ([{ m, o }]: this week's and next week's moves,
  // after launch, core.js). They stay kept past KEEP while they're the plan's. Returns how many
  // weren't kept yet.
  function aheadOf(list) {
    const keys = new Set();
    let n = 0;
    for (const { m, o } of list) {
      const k = key(m, o);
      if (keys.has(k)) continue;
      keys.add(k);
      if (!url(k) && !failed.has(k)) { want(m, o, null, { ahead: true }); n++; }
    }
    need = keys;
    trim();
    return n;
  }
  // Plan's tab pressed: the figure warms up now if a still of this week's or next week's is missing
  // (it usually started after launch already).
  function prime() {
    if (warming || !ok() || ready(GH.figure3d) || !U.S || !U.planStills) return;
    load().then(() => idle(() => {
      const keys = need || new Set(U.planStills(U.S, U.today()).map((j) => key(j.m, j.o)));
      for (const k of keys) if (!url(k) && !failed.has(k)) { warm(); return; }
    }));
  }

  /* ---------------------------------------------------------------- tiles */
  // Puts a still in its tile: straight in, or (fade) fading in over what the tile showed, which goes
  // once it's covered, so a tile is never empty on the way (they share its one grid cell).
  function put(host, k, u, fade) {
    const img = doc.createElement('img');
    img.alt = '';
    img.draggable = false; // (the plan builder's rows are dragged)
    img.setAttribute('data-k', k);
    const before = Array.from(host.childNodes);
    if (fade && before.length && !U.reduced()) {
      const drop = () => { for (const n of before) if (n.parentNode === host) n.remove(); };
      img.addEventListener('animationend', drop, { once: true });
      setTimeout(drop, 900);
    } else for (const n of before) n.remove();
    if (fade) img.className = 'is-new';
    img.src = u;
    host.appendChild(img);
  }
  // A move's still in a screen's tile: straight in if it's kept; otherwise the tile shows the still
  // it had in another look, or an older figure's of the same, or its own background, until it's
  // drawn, and then it fades in. flat(host): what the tile shows instead if it can't be drawn.
  function tile(host, m, o, flat, opt) {
    const k = key(m, o);
    const shown = host.lastElementChild;
    if (host.getAttribute('data-want') !== k) host.setAttribute('data-want', k);
    if (shown && shown.getAttribute('data-k') === k) return;
    const fn = (v) => {
      const now0 = host.lastElementChild;
      if (host.getAttribute('data-want') !== k || (now0 && now0.getAttribute('data-k') === k)) return;
      // (Not in the middle of a touch or a fling: it fades in once the page is let go.)
      if (v && busy()) { whenFree(() => fn(v)); return; }
      if (v) put(host, k, v, true); else { host.removeAttribute('data-want'); flat(host); }
    };
    fn.host = host;
    const u = want(m, o, fn, opt);
    if (u) { put(host, k, u, false); return; }
    if (u === false) { host.removeAttribute('data-want'); flat(host); return; }
    for (const n of Array.from(host.children)) if (n.tagName !== 'IMG') n.remove();
    const s = standIn(k);
    if (s && !host.querySelector(':scope > img')) put(host, s.k, s.url, false);
  }
  // The <img> of a kept still for a screen's HTML ('' if it isn't kept, nor an older figure's of the
  // same), so it's there from the screen's first frame; data-k says which still it is.
  function img(m, o) {
    const k = key(m, o), u = url(k), s = u ? null : standIn(k);
    if (!u && !s) return '';
    return `<img alt="" draggable="false" src="${U.esc(u || s.url)}" data-k="${U.esc(u ? k : s.k)}">`;
  }

  // After set-up the week's stills are drawn ahead as after a launch (core.js), so Plan has them on
  // the first day too.
  const prevOnb = U.afterOnboarding;
  U.afterOnboarding = () => { if (prevOnb) prevOnb(); if (U.stillsAhead) U.stillsAhead(); };

  U.stills = {
    ok, look, key, url, img, want, tile, put, load, clear, prime,
    ahead: aheadOf,
    // Tests: write what's waiting now, and what's going on.
    flush: write,
    _stats: () => ({ kept: mem.size, temp: temp.size, stale: stale.size, asked: asked.size, ahead: ahead.size, failed: failed.size, drawn, need: need ? need.size : 0 }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
