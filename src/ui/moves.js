/* Moves: every ladder with its current level (Plan's Moves section, or a page of its own), and the
 * move sheets (animated diagram, cues, the common mistake and how to breathe) used across the app.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;

  const GROUP_TONE = { biceps: 'amber', triceps: 'rose', chest: 'indigo', legs: 'green', back: 'teal', shoulders: 'sky', abs: 'violet', conditioning: 'amber', balance: 'teal', impact: 'violet' };
  // Each group's glyph (U.groupIcon's, src/ui/core.js): an exercise for most of them.
  const GROUP_ICON = { biceps: 'group-biceps', triceps: 'group-triceps', chest: 'group-chest', legs: 'group-legs', back: 'group-back', shoulders: 'group-shoulders', abs: 'group-abs', conditioning: 'group-conditioning', balance: 'group-balance', impact: 'group-impact' };
  const ORDER = ['balance', 'impact', 'biceps', 'triceps', 'chest', 'legs', 'back', 'shoulders', 'abs', 'conditioning'];
  const EQ_NAME = { db: 'dumbbells', kb: 'a kettlebell', ball: 'a ball', slam: 'a ball you can slam', band: 'a band', bar: 'a pull-up bar', chair: 'a chair', wall: 'a wall', towel: 'a towel', table: 'a sturdy table', door: 'a door anchor', bb: 'a barbell', ez: 'an EZ bar', rack: 'a squat rack', bench: 'a bench', incline: 'an adjustable bench', smith: 'a Smith machine', cable: 'a cable machine', pulldown: 'a lat pulldown', legPress: 'a leg press', legCurl: 'a leg curl machine', legExt: 'a leg extension machine', chestPress: 'a chest press machine', shoulderPress: 'a shoulder press machine', pecDeck: 'a pec deck', dip: 'dip bars', rower: 'a rower', bike: 'an exercise bike', treadmill: 'a treadmill' };
  const MUSCLE_NAME = (m) => String(m).replace(/([A-Z])/g, ' $1').toLowerCase();

  function needs(m, eq) {
    const miss = (m.req || []).filter((alt) => !alt.split('|').some((k) => M().has(eq, k)));
    return miss.map((alt) => alt.split('|').map((k) => EQ_NAME[k] || k).join(' or '));
  }

  /* ---------------------------------------------------------------- figure sheets */
  // Each sheet owns its figure, so a sheet that finishes closing after the next one has opened
  // (easy on a slow phone) only ever takes its own figure with it, never the new one's.
  const figs = new WeakMap(); // sheet element → figure
  function dropSheetFig(ctl) {
    const f = ctl && figs.get(ctl.el);
    if (!f) return;
    figs.delete(ctl.el);
    try { f.destroy(); } catch (e) { /* ignore */ }
  }
  const figOf = (el) => { const d = el && el.closest ? el.closest('dialog') : null; return d ? figs.get(d) : null; };
  function moveBody(m, opts) {
    const S = U.S;
    const load = B().loadInfo(S, m);
    const cues = (m.cues || []).slice(0, S.complexity > 0 ? 1 : 3);
    // The muscles doing the work (the move's first `prime`), then the ones helping.
    const muscles = (m.muscles || []).map(MUSCLE_NAME);
    const and = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0] || '');
    const works = muscles.length ? `${U.cap(and(muscles.slice(0, m.prime || 1)))}${muscles.length > (m.prime || 1) ? `, with ${and(muscles.slice(m.prime || 1))} helping` : ''}` : '';
    const views = U.figure3dOk && U.figure3dOk();
    // The figure always moves (the movement is the instruction); with reduced motion on there's a
    // button to stop it.
    const pause = U.reduced() ? '<button type="button" class="rf-btn fig-pause" data-size="sm" data-act="figPause" aria-pressed="false">Pause</button>' : '';
    return `<div class="sheet-fig-card"><div class="sheet-fig"></div>${U.tempoHtml ? U.tempoHtml(m) : ''}${views || pause ? `<div class="fig-view" data-key="figview">${views ? U.seg('figView', [['three-quarter', 'Angle'], ['side', 'Side'], ['front', 'Front']], 'three-quarter', 'View', ' data-size="sm" data-on="figView"') : ''}${pause}</div>` : ''}</div>
      <div class="sheet-pad">
        <p class="t-footnote rf-muted">${U.esc([B().GROUP_NAME[m.group] || m.group].concat(works ? [works] : []).join(' · '))}${load && load.label ? ` · ${U.esc(load.label)}` : ''}${m.uni ? ' · one side at a time' : ''}</p>
        ${opts && opts.side ? `<p class="pl-side${opts.side === (S.catchup.arm.side || 'L') ? ' is-lead' : ''}">${U.side(opts.side)} side shown</p>` : ''}
        <ol class="cue-list">${cues.map((c) => `<li class="t-body">${U.esc(c)}</li>`).join('')}</ol>
        ${m.mistake ? `<p class="t-callout"><b>Watch out:</b> ${U.esc(m.mistake)}</p>` : ''}
        ${m.breathe ? `<p class="t-callout rf-muted">${U.esc(m.breathe)}</p>` : ''}
      </div>`;
  }
  const sideOf = (moveId, side) => side || ((M().MOVES[moveId] || {}).uni ? (U.S.catchup.arm.side || 'L') : null);
  function mountSheetFig(ctl, moveId, side) {
    dropSheetFig(ctl);
    const host = ctl.el.querySelector('.sheet-fig');
    if (host && U.figureFor) figs.set(ctl.el, U.figureFor(host, moveId, sideOf(moveId, side), true));
  }
  // A sheet's figure: a kept 3D still goes in with the sheet's first frame (an <img>); a figure
  // that has to be drawn (the flat one, the live 3D one) right after it (src/ui/sheet.js, later),
  // so the tap is answered by the sheet on its way up a frame sooner.
  const sheetFig = (moveId, side) => ({
    after: (c) => { const host = c.el.querySelector('.sheet-fig'); if (host && U.figureStillFirst && U.figureStillFirst(host, moveId, sideOf(moveId, side))) mountSheetFig(c, moveId, side); },
    later: (c) => { if (!figs.has(c.el)) mountSheetFig(c, moveId, side); },
  });
  U.moveSheet = (moveId, opts) => {
    const m = M().MOVES[moveId];
    if (!m) return null;
    const first = U.markSeen ? U.markSeen('moveSheet') : false;
    const ctl = U.sheet({
      title: m.name, size: 'auto', detent: 'large',
      body: moveBody(m, opts),
      ...sheetFig(moveId, opts && opts.side),
      onClose: () => { dropSheetFig(ctl); if (opts && opts.onClose) opts.onClose(); if (first && U.els().playerEl.hidden) { U.render(); if (U.checklistCheck) U.checklistCheck(); } },
    });
    return ctl;
  };
  U.act.figPause = (el) => {
    const f = figOf(el);
    if (!f) return;
    const stop = el.getAttribute('aria-pressed') !== 'true';
    if (stop) f.pause(); else f.play();
    U.haptic(stop ? 'toggleOff' : 'toggleOn');
    el.setAttribute('aria-pressed', String(stop));
    el.textContent = stop ? 'Play' : 'Pause';
  };
  U.on.figView = (el, ev, v) => { const f = figOf(el); if (f && f.setView) f.setView(v); };

  // A ladder: its rungs in order, the current one marked; tap a rung to see it.
  U.act.ladder = (el) => {
    const fam = el.dataset.arg;
    const lad = M().LADDERS[fam];
    const S = U.S;
    const st = S.prog[fam];
    let showing = st ? st.rung : lad.rungs[0];
    const avail = B().rungs(S, fam, U.today(), lad.gym ? { place: 'gym' } : undefined);
    const body = () => {
      const m = M().MOVES[showing];
      const rows = lad.rungs.map((id) => {
        const mv = M().MOVES[id];
        const i = avail.indexOf(id);
        const cur = st && st.rung === id;
        const miss = needs(mv, lad.gym ? B().eqAt(S, 'gym') : S.profile.equipment);
        const why = lad.gym
          ? (i >= 0 ? (cur ? `Now: ${U.target(mv, st.reps)}${st.loads && st.loads[id] != null ? ` at ${B().fmtLoad(S, st.loads[id], String(mv.load || '').split('|')[0], mv)}` : ''}` : i === 0 ? 'First pick at your gym' : 'Also at your gym') : miss.length ? `Needs ${miss.join(', ')}` : S.excluded.includes(id) ? 'Hidden by you' : 'Not for now')
          : i >= 0 ? `Level ${i + 1} of ${avail.length}${cur ? ` · now: ${U.target(mv, st.reps)}` : ''}` : miss.length ? `Needs ${miss.join(', ')}` : S.excluded.includes(id) ? 'Hidden by you' : (GH.access && GH.access.why(S.profile, mv, U.today())) || (mv.impact ? 'Has jumping or slamming' : 'Not for now');
        return `<li><button type="button" class="rf-list-row${id === showing ? ' is-showing' : ''}${i < 0 ? ' is-muted' : ''}" data-act="ladderShow" data-arg="${id}">
          <span class="rf-list-icon" data-tone="${cur ? 'green' : i >= 0 ? 'sky' : 'indigo'}">${U.icon(cur ? 'star' : i >= 0 ? 'check' : 'lock')}</span>
          <span class="rf-list-text"><span class="rf-list-title">${U.esc(mv.name)}</span><span class="rf-list-sub">${U.esc(why)}</span></span></button></li>`;
      }).join('');
      const hidden = S.excluded.includes(showing);
      return `${moveBody(m)}<h3 class="rf-list-header">${lad.gym ? 'Exercises, favourite first' : 'All levels, easiest first'}</h3><ul class="rf-list">${rows}</ul>
        ${hidden ? `<div class="sheet-pad"><button type="button" class="rf-btn" data-act="unhide" data-arg="${showing}">Show this move again</button></div>` : ''}`;
    };
    const ctl = U.sheet({ title: lad.name, size: 'auto', body: body(), ...sheetFig(showing), onClose: () => dropSheetFig(ctl) });
    U.act.ladderShow = (b) => {
      showing = b.dataset.arg;
      U.haptic('select');
      ctl.update(body());
      mountSheetFig(ctl, showing);
      ctl.body.scrollTo({ top: 0, behavior: U.reduced() ? 'auto' : 'smooth' });
    };
  };
  U.act.unhide = (el) => {
    U.S.excluded = U.S.excluded.filter((x) => x !== el.dataset.arg);
    U.save();
    const t = U.topSheet(); if (t) t.close('ok');
    U.render();
    U.toast('It can show up again', 'positive');
  };

  /* ---------------------------------------------------------------- the list */
  // Every ladder by muscle group, then the warm-ups and stretches: Plan's Moves section and the Moves
  // page. `lead` goes first (the section's tip).
  U.movesBody = (S, day, lead) => {
    // Home ladders (levels you climb) for everyone who trains at home; gym exercises (a weight you
    // add to) for people who train at a gym.
    const where = S.profile.where || 'home';
    const by = {};
    for (const [fam, lad] of Object.entries(M().LADDERS)) {
      const place = lad.gym ? 'gym' : 'home';
      if (lad.gym ? where === 'home' : where === 'gym' && !B().rungs(S, fam, day, { place: 'gym' }).length) continue;
      const list = B().rungs(S, fam, day, { place });
      if (!list.length) continue;
      (by[lad.group] = by[lad.group] || []).push(fam);
    }
    const groups = ORDER.filter((g) => by[g]).map((g) => {
      const rows = by[g].map((fam) => {
        const lad = M().LADDERS[fam];
        const st = S.prog[fam];
        if (lad.gym) {
          const list = B().rungs(S, fam, day, { place: 'gym' });
          const id = st && list.includes(st.rung) ? st.rung : list[0];
          const mv = M().MOVES[id];
          const kg = st && st.loads ? st.loads[id] : null;
          const key = mv && mv.load ? String(mv.load).split('|')[0] : null;
          return U.row({
            icon: 'dumbbell', tone: GROUP_TONE[g] || 'sky', title: `${U.esc(lad.name)} <span class="mv-gym">Gym</span>`,
            sub: U.esc(st ? `${mv.name} · ${U.target(mv, st.reps)}` : `${mv.name} · starts on your first gym day`), detail: kg != null && key ? U.esc(B().fmtLoad(S, kg, key, mv)) : '', act: 'ladder', arg: fam, chevron: true,
          });
        }
        const lv = B().ladderLevel(S, fam, day);
        const mv = st && M().MOVES[st.rung];
        return U.row({
          icon: GROUP_ICON[g] || 'bolt', tone: GROUP_TONE[g] || 'sky', title: U.esc(lad.name),
          sub: mv ? `${U.esc(mv.name)} · ${U.esc(U.target(mv, st.reps))}` : '', detail: lv && lv.level > 0 ? `${lv.level}/${lv.of}` : '', act: 'ladder', arg: fam, chevron: true,
        });
      }).join('');
      return `<h3 class="rf-list-header">${U.esc(B().GROUP_NAME[g] || g)}</h3><ul class="rf-list">${rows}</ul>`;
    }).join('');
    // The warm-ups and stretches this person's kit and body allow (the halo needs a kettlebell, the
    // pull-apart a band; plans built around age or a health condition add gentler and seated ones).
    const ok = (id) => M().MOVES[id] && (!M().allowed || M().allowed(M().MOVES[id], S.profile.equipment)) && (!GH.access || GH.access.moveOk(S.profile, id));
    const wu = [...new Set(((GH.access && GH.access.warmupIds(S.profile)) || []).concat(M().WARMUP.all || M().WARMUP.kb))].filter(ok);
    const mob = [...new Set(M().MOBILITY.concat(B().mobilityFlow(S).map((x) => x.moveId)))].filter(ok);
    const extra = wu.concat(mob, ['walk']).filter((id) => M().MOVES[id]).map((id) => U.row({ icon: mob.includes(id) ? 'leaf' : id === 'walk' ? 'navigate' : 'sun', tone: 'teal', title: U.esc(M().MOVES[id].name), act: 'moveInfo', arg: id, chevron: true })).join('');
    return `<div class="section moves-list" data-key="moves">${lead || ''}${groups}
        <h3 class="rf-list-header">Warm-up and mobility</h3><ul class="rf-list">${extra}</ul>
      </div>`;
  };

  /* ---------------------------------------------------------------- the page */
  // Moves opens as a page of its own where Plan isn't there to hold it (workouts off), or when
  // something opens it on top.
  U.screens.moves = {
    render(S, day) {
      const asPage = U.route && U.route.view === 'moves';
      return `${U.navbar('Moves', '', asPage ? U.glassBtn('chevron-left', 'Back', 'back') : '')}
        <h1 class="rf-large-title">Moves</h1>
        ${U.movesBody(S, day, U.tip ? U.tip('moves') : '')}`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
