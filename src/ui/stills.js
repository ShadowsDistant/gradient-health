/* The 3D figure's stills of the moves, kept on the phone. A still is a move's key pose in the 3D
 * figure, as Plan's tiles, the plan builder, set-up's reveal and Settings' preview show it. Each is
 * drawn once by the 3D chunk and kept across launches (IndexedDB), under the move as the person does
 * it (the kit they have), the look (theme, skin, shirt), its size and the figure's own id (GH.FIGURE,
 * from the build: the chunk and the poses it lifts), so a change to any of them draws it again. What's
 * kept is read into memory once launch's first frame is drawn (core.js), so a screen puts a kept still
 * straight into its HTML: it's there from the screen's first frame, without the 3D chunk, and the
 * flat figure never stands in for it.
 *
 * One that isn't kept is drawn (figure3d.stillNow) once the figure is warm, in idle moments, as many
 * in each as fit, and only while it's quiet (U.quiet: nothing touched, scrolled or moving for a while)
 * and no live figure is on screen: each holds the page's thread for a few frames. The ones a screen
 * waits for go first, then the ones drawn ahead (this week's and next week's moves, after launch, so
 * Plan finds them kept). The phone keeps up to KEEP; past that, the ones no week of the plan shows go,
 * oldest first. A screen's tile waits on the tile's own background, and its still fades in.
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
  const mem = new Map(); // key → data URL: what's kept, read in, and what's been drawn since
  const temp = new Map(); // key → data URL, drawn for this launch only
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
  // A short hash of the kit a move is drawn with (forPerson swaps it for what the person has).
  function kit(m) {
    const s = JSON.stringify([m.equip || null, m.props || null]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  // Under what a still is kept: the figure's id first (what's kept is read in as that range), then
  // its size, the look, and the move with its kit.
  const key = (m, o) => [engine(), o.crop ? `c${o.crop}` : `${o.width}x${o.height}`, o.dark ? 'd' : 'l', o.skin || 'sand', o.shirt || '', m.id, kit(m)].join('|');
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
  // What's kept, read into memory in one request (once).
  function load() {
    if (!reads) {
      const lo = `${engine()}|`;
      reads = tx('readonly', (os) => os.getAll(G.IDBKeyRange.bound(lo, `${lo}\uffff`))).then((list) => {
        for (const r of list || []) if (r && typeof r.url === 'string' && r.url.startsWith('data:image/') && !mem.has(r.k)) mem.set(r.k, r.url);
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
  // Past KEEP stills, the oldest that this week and next don't show go; and once a launch, any an
  // older figure drew (nothing reads them again).
  let swept = false;
  function trim() {
    const lo = `${engine()}|`;
    return tx('readwrite', (os) => {
      if (!swept) { swept = true; os.delete(G.IDBKeyRange.upperBound(lo, true)); os.delete(G.IDBKeyRange.lowerBound(`${lo}\uffff`, true)); }
      const n = os.count();
      n.onsuccess = () => {
        let over = n.result - KEEP;
        if (over <= 0 || !need) return;
        const cur = os.index('at').openKeyCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || over <= 0) return;
          if (!need.has(c.primaryKey)) { os.delete(c.primaryKey); mem.delete(c.primaryKey); over--; }
          c.continue();
        };
      };
    });
  }
  // Reset everything: what's kept goes with the rest (it's drawn in the person's look).
  function clear() {
    for (const x of [mem, temp, dirty, failed, asked, ahead]) x.clear();
    clearTimeout(writing);
    writing = 0;
    reads = need = null;
    swept = false;
    return db().then((d) => new Promise((resolve) => {
      if (d) d.close();
      dbp = null;
      try { const req = G.indexedDB.deleteDatabase(DB); req.onsuccess = req.onerror = req.onblocked = () => resolve(); } catch (e) { resolve(); }
    }));
  }

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
  // A figure's box showing (the player, a move's sheet), whose live figure stills would take frames
  // from: they wait. (A workout put aside keeps its figure, hidden: that one doesn't count.)
  const figureShown = () => Array.prototype.some.call(doc.querySelectorAll('.pl-fig, .sheet-fig'), (h) => !!h.offsetParent);
  const go = () => { waiting = false; pump(); };
  // Draws what's asked for when it can: the figure warm, the app in front and quiet; then in an idle
  // moment with no figure on screen.
  function pump() {
    if (waiting || !(asked.size || ahead.size)) return;
    if (!ok()) { for (const j of [...asked.values(), ...ahead.values()]) done(j, null); return; }
    const f = GH.figure3d;
    if (!f || !f.warm()) { warm(); return; }
    waiting = true;
    if (doc.hidden) setTimeout(go, 1500);
    else if (!U.quiet()) U.whenQuiet(go);
    else {
      idle((deadline) => {
        if (figureShown()) { setTimeout(go, 1500); return; }
        waiting = false;
        draw(deadline);
        pump();
      });
    }
  }
  // The 3D chunk and its warm-up, once it's quiet: both hold the page's thread for a while. One that
  // didn't get there is tried again, twice.
  function warm() {
    if (warming || !U.preloadFigure) return;
    warming = true;
    U.whenQuiet(() => U.preloadFigure().then(() => {
      warming = false;
      if (!GH.figure3d) noChunk = true;
      else if (!GH.figure3d.warm()) tries++;
      pump();
    }, () => { warming = false; noChunk = true; pump(); }));
  }
  // As many stills as fit in this idle moment (one at least), while it stays quiet.
  function draw(deadline) {
    const f = GH.figure3d;
    const L = look(1);
    for (let n = 0; f && f.warm() && U.quiet(); n++) {
      const job = next(L);
      if (!job || (n && !(deadline && deadline.timeRemaining() > cost + 4))) return;
      const t0 = now();
      let r = null;
      try { r = f.stillNow(job.m, job.o); } catch (e) { r = null; }
      cost = now() - t0;
      // New shaders, compiling in the background: the others meanwhile, this one once they're in.
      if (r && r.wait) { job.wait = true; r.wait.then(() => { job.wait = false; pump(); }); continue; }
      job.busy = true;
      drawn++;
      const out = (u) => {
        if (!u) failed.add(job.k);
        else if (job.keep) keep(job.k, u);
        else { temp.set(job.k, u); if (temp.size > TEMP) temp.delete(temp.keys().next().value); }
        done(job, u);
      };
      if (r) r.url.then(out, () => out(null)); else out(null);
    }
  }
  // The next still to draw: what a screen waits for first. One in another look than the person's now
  // (the theme, skin or shirt changed since) is dropped, unless a tile on screen still waits for it
  // (its screen wasn't drawn again: the phone's theme changing doesn't redraw it).
  function next(L) {
    for (const list of [asked, ahead]) {
      for (const j of Array.from(list.values())) {
        if (j.busy || j.wait) continue;
        const stale = j.o.dark !== L.dark || (j.o.skin || 'sand') !== L.skin || (j.o.shirt || '') !== (L.shirt || '');
        if (stale && !j.fns.some((fn) => !fn.host || (fn.host.isConnected && fn.host.getAttribute('data-want') === j.k))) { list.delete(j.k); continue; }
        return j;
      }
    }
    return null;
  }
  // Stills drawn ahead, after what screens wait for ([{ m, o }]: this week's and next week's moves,
  // from the warm-up after launch, core.js). They stay kept past KEEP while they're the plan's.
  // Returns how many weren't kept yet.
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

  /* ---------------------------------------------------------------- tiles */
  // Puts a still in its tile: straight in, or (fade) fading in over what the tile showed, which goes
  // once it's covered, so a tile is never empty on the way (they share its one grid cell).
  function put(host, k, u, fade) {
    const img = doc.createElement('img');
    img.alt = '';
    img.draggable = false; // (the plan builder's rows are dragged)
    img.setAttribute('data-k', k);
    const old = Array.from(host.childNodes);
    if (fade && old.length && !U.reduced()) {
      const drop = () => { for (const n of old) if (n.parentNode === host) n.remove(); };
      img.addEventListener('animationend', drop, { once: true });
      setTimeout(drop, 900);
    } else for (const n of old) n.remove();
    if (fade) img.className = 'is-new';
    img.src = u;
    host.appendChild(img);
  }
  // A move's still in a screen's tile: straight in if it's kept; otherwise the tile shows its own
  // background (or the still it had in another look) until it's drawn, and then it fades in.
  // flat(host): what the tile shows instead if it can't be drawn.
  function tile(host, m, o, flat, opt) {
    const k = key(m, o);
    const shown = host.lastElementChild;
    if (host.getAttribute('data-want') !== k) host.setAttribute('data-want', k);
    if (shown && shown.getAttribute('data-k') === k) return;
    const fn = (v) => {
      const now0 = host.lastElementChild;
      if (host.getAttribute('data-want') !== k || (now0 && now0.getAttribute('data-k') === k)) return;
      if (v) put(host, k, v, true); else { host.removeAttribute('data-want'); flat(host); }
    };
    fn.host = host;
    const u = want(m, o, fn, opt);
    if (u) { put(host, k, u, false); return; }
    if (u === false) { host.removeAttribute('data-want'); flat(host); return; }
    for (const n of Array.from(host.children)) if (n.tagName !== 'IMG') n.remove();
  }
  // The <img> of a kept still for a screen's HTML ('' if it isn't kept), so it's there from the
  // screen's first frame; data-k says which still it is.
  function img(m, o) {
    const k = key(m, o), u = url(k);
    return u ? `<img alt="" draggable="false" src="${U.esc(u)}" data-k="${U.esc(k)}">` : '';
  }

  // After set-up the week's stills are drawn ahead as after a launch (core.js), so Plan has them on
  // the first day too.
  const prevOnb = U.afterOnboarding;
  U.afterOnboarding = () => { if (prevOnb) prevOnb(); if (U.stillsAhead) U.stillsAhead(); };

  U.stills = {
    ok, look, key, url, img, want, tile, put, load, clear,
    ahead: aheadOf,
    // Tests: write what's waiting now, and what's going on.
    flush: write,
    _stats: () => ({ kept: mem.size, temp: temp.size, asked: asked.size, ahead: ahead.size, failed: failed.size, drawn, need: need ? need.size : 0 }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
