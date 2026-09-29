/* Moves: every ladder with its current level, and the move sheets (animated diagram, cues,
 * the common mistake and how to breathe) used across the app.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const M = () => GH.moves;

  const GROUP_TONE = { biceps: 'amber', triceps: 'rose', chest: 'indigo', legs: 'green', back: 'teal', shoulders: 'sky', abs: 'violet', conditioning: 'amber' };
  const GROUP_ICON = { biceps: 'bolt', triceps: 'bolt', chest: 'layers', legs: 'mountain', back: 'arrow-left', shoulders: 'sun', abs: 'grid', conditioning: 'wave' };
  const ORDER = ['biceps', 'triceps', 'chest', 'legs', 'back', 'shoulders', 'abs', 'conditioning'];
  const EQ_NAME = { db: 'dumbbells', kb: 'a kettlebell', ball: 'a ball', slam: 'a ball you can slam', band: 'a band', bar: 'a pull-up bar', chair: 'a chair', wall: 'a wall', towel: 'a towel', table: 'a sturdy table', door: 'a door anchor', bb: 'a barbell', ez: 'an EZ bar', rack: 'a squat rack', bench: 'a bench', incline: 'an adjustable bench', smith: 'a Smith machine', cable: 'a cable machine', pulldown: 'a lat pulldown', legPress: 'a leg press', legCurl: 'a leg curl machine', legExt: 'a leg extension machine', chestPress: 'a chest press machine', shoulderPress: 'a shoulder press machine', pecDeck: 'a pec deck', dip: 'dip bars', rower: 'a rower', bike: 'an exercise bike', treadmill: 'a treadmill' };
  const MUSCLE_NAME = (m) => String(m).replace(/([A-Z])/g, ' $1').toLowerCase();

  function needs(m, eq) {
    const miss = (m.req || []).filter((alt) => !alt.split('|').some((k) => M().has(eq, k)));
    return miss.map((alt) => alt.split('|').map((k) => EQ_NAME[k] || k).join(' or '));
  }

  /* ---------------------------------------------------------------- figure sheets */
  let sheetFig = null;
  function dropSheetFig() { if (sheetFig) { try { sheetFig.destroy(); } catch (e) { /* ignore */ } sheetFig = null; } }
  function moveBody(m, opts) {
    const S = U.S;
    const load = B().loadInfo(S, m);
    const cues = (m.cues || []).slice(0, S.complexity > 0 ? 1 : 3);
    const muscles = (m.muscles || []).map(MUSCLE_NAME);
    const views = U.figure3dOk && U.figure3dOk() && !U.reduced();
    return `<div class="sheet-fig-card"><div class="sheet-fig"></div>${U.tempoHtml ? U.tempoHtml(m) : ''}${views ? `<div class="fig-view">${U.seg('figView', [['three-quarter', 'Angle'], ['side', 'Side'], ['front', 'Front']], 'three-quarter', 'View', ' data-size="sm" data-on="figView"')}</div>` : ''}${U.reduced() ? '<button type="button" class="rf-btn" data-size="sm" data-act="figOnce">Play one rep</button>' : ''}</div>
      <div class="sheet-pad">
        <p class="t-footnote rf-muted">${U.esc([B().GROUP_NAME[m.group] || m.group].concat(muscles.length ? [muscles.join(', ')] : []).join(' · '))}${load && load.label ? ` · ${U.esc(load.label)}` : ''}${m.uni ? ' · one side at a time' : ''}</p>
        ${opts && opts.side ? `<p class="pl-side${opts.side === (S.catchup.arm.side || 'L') ? ' is-lead' : ''}">${U.side(opts.side)} side shown</p>` : ''}
        <ol class="cue-list">${cues.map((c) => `<li class="t-body">${U.esc(c)}</li>`).join('')}</ol>
        ${m.mistake ? `<p class="t-callout"><b>Watch out:</b> ${U.esc(m.mistake)}</p>` : ''}
        ${m.breathe ? `<p class="t-callout rf-muted">${U.esc(m.breathe)}</p>` : ''}
      </div>`;
  }
  function mountSheetFig(ctl, moveId, side) {
    dropSheetFig();
    const host = ctl.el.querySelector('.sheet-fig');
    if (host && U.figureFor) sheetFig = U.figureFor(host, moveId, side || ((M().MOVES[moveId] || {}).uni ? (U.S.catchup.arm.side || 'L') : null), true);
  }
  U.moveSheet = (moveId, opts) => {
    const m = M().MOVES[moveId];
    if (!m) return null;
    const first = U.markSeen ? U.markSeen('moveSheet') : false;
    return U.sheet({
      title: m.name, detents: 'medium large', detent: 'large',
      body: moveBody(m, opts),
      after: (ctl) => mountSheetFig(ctl, moveId, opts && opts.side),
      onClose: () => { dropSheetFig(); if (first && U.els().playerEl.hidden) { U.render(); if (U.checklistCheck) U.checklistCheck(); } },
    });
  };
  U.act.figOnce = () => { if (sheetFig && sheetFig.playOnce) sheetFig.playOnce(); };
  U.on.figView = (el, ev, v) => { if (sheetFig && sheetFig.setView) sheetFig.setView(v); };

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
          : i >= 0 ? `Level ${i + 1} of ${avail.length}${cur ? ` · now: ${U.target(mv, st.reps)}` : ''}` : miss.length ? `Needs ${miss.join(', ')}` : S.excluded.includes(id) ? 'Hidden by you' : mv.impact ? 'Has jumping or slamming' : 'Not for now';
        return `<li><button type="button" class="rf-list-row${id === showing ? ' is-showing' : ''}${i < 0 ? ' is-muted' : ''}" data-act="ladderShow" data-arg="${id}">
          <span class="rf-list-icon" data-tone="${cur ? 'green' : i >= 0 ? 'sky' : 'indigo'}">${U.icon(cur ? 'star' : i >= 0 ? 'check' : 'lock')}</span>
          <span class="rf-list-text"><span class="rf-list-title">${U.esc(mv.name)}</span><span class="rf-list-sub">${U.esc(why)}</span></span></button></li>`;
      }).join('');
      const hidden = S.excluded.includes(showing);
      return `${moveBody(m)}<h3 class="rf-list-header">${lad.gym ? 'Exercises, favourite first' : 'All levels, easiest first'}</h3><ul class="rf-list">${rows}</ul>
        ${hidden ? `<div class="sheet-pad"><button type="button" class="rf-btn" data-act="unhide" data-arg="${showing}">Show this move again</button></div>` : ''}`;
    };
    const ctl = U.sheet({ title: lad.name, detents: 'large', detent: 'large', body: body(), after: (c) => mountSheetFig(c, showing), onClose: dropSheetFig });
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

  /* ---------------------------------------------------------------- the screen */
  U.screens.moves = {
    render(S, day) {
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
      const wu = (S.profile.equipment.kb && S.profile.equipment.kb.length ? M().WARMUP.kb : M().WARMUP.none);
      const extra = wu.concat(M().MOBILITY, ['walk']).filter((id) => M().MOVES[id]).map((id) => U.row({ icon: M().MOBILITY.includes(id) ? 'leaf' : id === 'walk' ? 'navigate' : 'sun', tone: 'teal', title: U.esc(M().MOVES[id].name), act: 'moveInfo', arg: id, chevron: true })).join('');
      // A tab normally; a page (with a back button) when Food has the tab.
      const asPage = U.route && U.route.view === 'moves';
      return `${U.navbar('Moves', '', asPage ? U.glassBtn('chevron-left', 'Back', 'back') : '')}
        <h1 class="rf-large-title">Moves</h1>
        <div class="section moves-list">${U.tip ? U.tip('moves') : ''}${groups}
          <h3 class="rf-list-header">Warm-up and mobility</h3><ul class="rf-list">${extra}</ul>
        </div>`;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
