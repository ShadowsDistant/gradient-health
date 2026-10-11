/* The badges' 3D side, in the 3D chunk with the medals themselves (src/engine/chunk3d.js brings it in
 * after src/engine/medal3d.js): drawing the stills src/ui/badges.js asks for and keeping them on the
 * phone, a still drawn at once, and the live medal on a stage. badges.js reads what's kept and puts it
 * in its screens (GH.ui.medals: what's kept and wanted, the keys, the specs); this fills in the rest.
 *
 * Stills are drawn in quiet idle moments (U.quiet: nothing touched, scrolled or moving for a while),
 * as many in each as fit, only for medals still on screen, and not while a live medal is (it has the
 * renderer then). Each is encoded in the background and written with the others a couple of seconds
 * later, or as the app goes to the background.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui;
  const M = U && U.medals;
  const M3 = GH.medal3d;
  const doc = G.document;
  if (!M || !M3 || !doc) return; // (a page without the app: the 3D chunk on its own)
  const A = () => GH.achievements;
  const KEEP = 400;
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(() => fn(null), 50));
  const now = () => G.performance.now();

  /* ---------------------------------------------------------------- kept on the phone */
  let dbp = null, writing = 0, swept = false;
  const dirty = new Map(); // key → { k, b (the picture), at }, not written yet
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = G.indexedDB.open('gh-medals', 1);
          req.onupgradeneeded = () => { req.result.createObjectStore('m', { keyPath: 'k' }).createIndex('at', 'at'); };
          req.onsuccess = () => { const d = req.result; d.onversionchange = () => { d.close(); dbp = null; }; resolve(d); };
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbp;
  }
  function keep(k, blob) {
    M.kept.set(k, G.URL.createObjectURL(blob));
    dirty.set(k, { k, b: blob, at: Date.now() });
    if (!writing) writing = setTimeout(write, 2000);
  }
  // What's drawn since the last write, written together; then, once a launch, what an older revision
  // drew goes, and past KEEP the oldest.
  function write() {
    clearTimeout(writing);
    writing = 0;
    if (!dirty.size) return Promise.resolve();
    const recs = Array.from(dirty.values());
    dirty.clear();
    const lo = `${M.rev}|`;
    return db().then((d) => new Promise((resolve) => {
      if (!d) { resolve(); return; }
      try {
        const t = d.transaction('m', 'readwrite'), os = t.objectStore('m');
        t.oncomplete = t.onerror = t.onabort = () => resolve();
        for (const r of recs) os.put(r);
        if (!swept) { swept = true; os.delete(G.IDBKeyRange.upperBound(lo, true)); os.delete(G.IDBKeyRange.lowerBound(`${lo}\uffff`, true)); }
        const n = os.count();
        n.onsuccess = () => {
          let over = n.result - KEEP;
          if (over <= 0) return;
          const cur = os.index('at').openKeyCursor();
          cur.onsuccess = () => { const c = cur.result; if (!c || over-- <= 0) return; os.delete(c.primaryKey); M.kept.delete(c.primaryKey); c.continue(); };
        };
      } catch (e) { resolve(); }
    }));
  }
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && dirty.size) write(); });
  // Reset everything (src/ui/badges.js calls this after the rest is cleared).
  M.drop = () => {
    clearTimeout(writing);
    writing = 0;
    dirty.clear();
    Promise.resolve(dbp).then((d) => { if (d) d.close(); dbp = null; try { G.indexedDB.deleteDatabase('gh-medals'); } catch (e) { /* none kept */ } });
  };
  M.flush = write; // (tests)

  /* ---------------------------------------------------------------- drawing stills */
  let pumping = 0, waiting = false, cost = 0, live = 0;
  M.drawn = 0;
  // Draws what's wanted when it can: quiet, the app in front, no live medal; then in an idle moment.
  M.pump = () => {
    if (pumping || waiting || !M.want.size || M.off) return;
    pumping = setTimeout(() => U.whenQuiet(() => idle(draw)), 300);
  };
  function draw(deadline) {
    pumping = 0;
    for (const k of M.want.keys()) if (M.kept.has(k) || !doc.querySelector(`.bdg-m[data-mk="${k}"]`)) M.want.delete(k);
    if (!M.want.size) return;
    if (!U.quiet() || live || doc.hidden) { M.pump(); return; }
    for (const j of Array.from(M.want.values())) {
      const t0 = now();
      let r = null;
      try { r = M3.stillNow(M.spec(j.def, j.earned), { px: M.px(j.css), dark: j.dark }); } catch (e) { r = null; }
      if (!r) { M.off = true; M.want.clear(); return; } // no WebGL after all: the SVG medals stay
      // Its kind of medal is compiling in the background: the next moment draws it.
      if (r.wait) { waiting = true; r.wait.then(() => { waiting = false; M.pump(); }); return; }
      cost = now() - t0;
      M.want.delete(j.k);
      M.drawn++;
      M3.encode(r.canvas).then((b) => { if (b) { keep(j.k, b); M.swap(j.k); } });
      if (!deadline || deadline.timeRemaining() < cost + 4 || !U.quiet()) break;
    }
    if (M.want.size) M.pump();
  }
  // A badge's large still, drawn now (a sheet with reduced motion shows it where the live one would be).
  M.draw = (x) => {
    const dark = M.dark(), k = M.key(x, M.LARGE, dark);
    if (M.kept.has(k)) return;
    M3.stillAsync(M.spec(x.def, x.earned), { px: M.px(M.LARGE), dark }).then((cv) => (cv ? M3.encode(cv) : null)).then((b) => { if (b) { keep(k, b); M.swap(k); } }, () => {});
  };

  /* ---------------------------------------------------------------- live */
  // What's engraved on an earned medal's back: its tier, its name, the day, the app.
  function back(x) {
    const T = A().TIERS[x.def.tier], B = GH.brain;
    return [`${T.name} · ${T.rarity}`, x.def.title, `Earned ${B.fmtDay(x.day, false)}, ${B.dayStr(x.day).slice(0, 4)}`, 'Gradient Health'];
  }
  /* The live medal on its stage, over its still or SVG: it fades in once its first frame is drawn, but
   * never while the stage's medal is springing in (then once that's over). Spun by hand when
   * o.interactive, turning over with a light haptic; drawn only while its sheet (o.sheet) is on top.
   * Returns { spinIn() (spins it in from small with a flash of light, if it's ready: true then),
   * destroy() }. */
  M.live = (stage, x, o) => {
    let ctl = null, ready = false, dead = false, spun = false;
    live++;
    const show = () => {
      if (dead) return;
      const left = (Number(stage.dataset.popAt) || 0) + 1150 - Date.now();
      if (left > 0 && !spun) setTimeout(show, left);
      else stage.classList.add('is-live');
    };
    const h = {
      spinIn() { if (!ready) return false; spun = true; stage.classList.add('is-live'); ctl.spinIn(); return true; },
      destroy() { if (dead) return; dead = true; live--; if (ctl) ctl.destroy(); stage.classList.remove('is-live'); M.pump(); },
    };
    ctl = M3.mount(stage, M.spec(x.def, x.earned, x.earned ? back(x) : null), {
      size: o.size, dark: M.dark(), interactive: !!o.interactive, tilt: !!o.interactive, sway: !!o.sway,
      covered: () => !!o.sheet && U.topSheet() !== o.sheet,
      onFlip: () => U.haptic('tick'),
      onReady: () => { ready = true; show(); },
      onFail: () => h.destroy(),
    });
    if (!ctl) { if (!M3.supported()) M.off = true; h.destroy(); }
    return h;
  };
})(typeof window !== 'undefined' ? window : globalThis);
