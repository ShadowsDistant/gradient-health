/* Why the plan is as it is, in words (GH.optimizer.explain, explainProfile, alternatives). Only
 * set-up's plan (src/ui/onboarding.js) and the plan review's Why this plan (src/planreview.js,
 * src/ui/review.js) read them, so this file comes with both of their chunks (scripts/build.mjs
 * APP_CHUNKS), not with the page: whichever loads first puts them in place, and the other only puts
 * the same functions there again. The engine's parts they read are GH.optimizer._explain; the
 * person's own answers a plan used (personalFacts) stay with the engine, at launch, for the coach.
 * In Node, test/lib.mjs loads it with the brain.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const O = GH.optimizer;
  if (!O || !O._explain) return;
  const B = () => GH.brain;
  const M = () => GH.moves;
  const A = () => GH.access;
  const { phaseOf, tweaksOf, withTweaks, clamp, joinList, lower, setsWord, GROUPS } = O._explain;
  const { weekPlan, personalFacts, LABEL, UNITS } = O;
  const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Groups by name, with biceps and triceps together as arms when both are there.
  function groupNames(list) {
    const b = B();
    const out = list.slice();
    const both = out.includes('biceps') && out.includes('triceps');
    return out.filter((g) => !(both && g === 'triceps')).map((g) => (both && g === 'biceps' ? 'arms' : b.GROUP_NAME[g].toLowerCase()));
  }
  // explain(S, day): why the plan is as it is, for the week of `day`, in plain English.
  // { headline, week: [{ day, weekday, title, units, minutes, sets, done, today }], today (the
  // session for `day`, or the next one this week) , reasons: [lines], parts, score, considered }.
  function explain(S, day) {
    const b = B();
    const ws = b.weekStart(day);
    const cal = b.calendar(S, day);
    const week = cal.weeks[ws];
    const wp = weekPlan(S, ws, { phase: week ? week.phase : undefined });
    const live = week ? week.sessions.filter((x) => !x.dropped && x.day != null) : [];
    const custom = GH.customPlan && live.some((x) => GH.customPlan.owns(x.tpl));
    const built = live.map((x) => ({ x, s: b.buildSession(S, x.day, x.tpl, { cal, noReadiness: x.day !== day }) }));
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekOut = built.map(({ x, s }) => ({ day: x.day, weekday: wd[b.weekday(x.day)], title: s.title, units: s.units.slice(), minutes: s.estimateMin, sets: s.items.reduce((a, it) => a + (it.skill ? 0 : it.sets), 0), done: !!x.done, today: x.day === day }));
    const pick = built.find(({ x }) => x.day === day) || built.find(({ x }) => x.day > day && !x.done) || null;
    const today = pick ? {
      day: pick.x.day, title: pick.s.title, minutes: pick.s.estimateMin, budget: pick.s.budget, light: !!pick.s.light,
      items: pick.s.items.map((it) => ({ moveId: it.moveId, name: it.name, group: it.group, sets: it.sets, target: it.target, timed: !!it.timed, skill: !!it.skill })),
      finisher: pick.s.finisher ? { moveId: pick.s.finisher.moveId, name: pick.s.finisher.name, rounds: pick.s.finisher.rounds } : null,
      cooldown: (pick.s.mobility || []).map((mb) => ({ moveId: mb.moveId, name: mb.name, target: mb.target, cardio: !!mb.cardio })),
    } : null;
    const minutes = clamp(Math.round(Number(b.settingsAt(S, day).minutes) || Number(S.profile.minutes) || 25), 10, 60);
    const prog = b.programFor(S.profile);
    const top = GROUPS.filter((g) => prog.tiers[g] === 1 && wp.perGroup[g].trainable);
    const headline = custom ? 'You\'re following your own plan this week'
      : `${live.length} workout${live.length === 1 ? '' : 's'} a week, about ${minutes} minutes each${top.length ? `, built around your ${joinList(groupNames(top))}` : ''}`;
    // (1.15: facts, the person's own answers this week's plan used. They lead the reasons.)
    const facts = custom ? [] : personalFacts(S, day, { wp, sessions: built.map((x) => x.s) });
    return { headline, week: weekOut, today, facts, reasons: custom ? customReasons(S) : reasonLines(S, wp, built.map((x) => x.s), minutes, facts), parts: wp.parts, score: wp.score, considered: wp.considered, split: { kind: wp.split.kind, label: wp.split.label, name: LABEL[wp.split.label] || LABEL.mixed } };
  }

  function customReasons(S) {
    return ['These sessions come from your own plan, still fitted to your body\'s rules and your time.'];
  }
  // The reasons, most telling first.
  function reasonLines(S, wp, sessions, minutes, facts) {
    const b = B(), ac = A(), p = S.profile;
    const prog = b.programFor(p);
    const tw = tweaksOf(p);
    const out = [];
    const pg = wp.perGroup;
    const D = wp.days.length;
    // The split.
    if (wp.legacy) out.push('This week keeps the plan it started with. The new planner takes over next week.');
    else if (wp.split.kind !== 'auto') out.push(`You picked ${lower(LABEL[wp.split.kind])}. Of ${fmtN(wp.considered)} ways to lay it over your ${D} days, this one rests each muscle best.`);
    else out.push(`Of ${fmtN(wp.considered)} ways to share your muscle groups over ${D} days, this one spreads the work most evenly, with rest between sessions.`);
    // A healthy weekly dose: in large studies the lowest risks of disease went with about 30 to 60
    // minutes of strength work a week (Momma et al. 2022). A plan with less (two sessions of 10
    // minutes) says so once, with the fix; the plan itself stays as it is.
    const weekly = D * minutes;
    if (D > 0 && weekly < 30) out.push(`Your plan has ${weekly} minutes of strength work a week. In large studies, the lowest risks of disease went with about 30 to 60 minutes a week, so ${D < 3 ? 'a third short session or longer ones' : 'longer sessions'} would help.`);
    // 1.15: the person's own answers the plan used (personalFacts), the goals among them.
    const mine15 = facts || [];
    for (const f of mine15) out.push(f.text);
    // The goals.
    const top = GROUPS.filter((g) => prog.tiers[g] === 1 && pg[g].trainable && pg[g].aim > 0);
    if (top.length && !mine15.some((f) => f.id === 'goals')) {
      const parts = [];
      const both = top.includes('biceps') && top.includes('triceps');
      for (const g of top) {
        if (both && g === 'triceps') continue;
        const sets = both && g === 'biceps' ? pg.biceps.aim + pg.triceps.aim : pg[g].aim;
        const name = both && g === 'biceps' ? 'arms' : b.GROUP_NAME[g].toLowerCase();
        // "12 sets for arms and 6 for legs".
        parts.push(parts.length ? `${sets} for ${name}` : `${setsWord(sets)} for ${name}`);
      }
      out.push(`Your top goals get the most work: ${joinList(parts)} this week.`);
    }
    // Recovery.
    const units = wp.days.map((d) => d.units);
    const offs = wp.days.map((d) => d.offset);
    const backToBack = UNITS.filter((u) => {
      const on = offs.filter((o, i) => units[i].includes(u)).sort((a, x) => a - x);
      return on.some((o, i) => (i ? o - on[i - 1] : on[0] + 7 - on[on.length - 1]) <= 1) && on.length > 1;
    });
    if (D > 1 && !backToBack.length) out.push('No muscle group trains two days in a row, so each one recovers.');
    else if (D > 1 && !backToBack.includes('legs') && units.filter((u) => u.includes('legs')).length > 1) out.push('Your legs always get a day off between sessions.');
    // The time.
    const setMin = wp.days.length ? Math.round(wp.days.reduce((a, d) => a + d.planned - d.fixed, 0) / wp.days.length) : 0;
    const fin = sessions.some((s) => s.finisher), cool = sessions.some((s) => (s.mobility || []).some((mb) => !mb.cardio)), walk = sessions.some((s) => (s.mobility || []).some((mb) => mb.cardio));
    const extras = ['a warm-up'].concat(fin ? ['a finisher'] : [], walk ? ['an easy cardio block'] : [], cool ? ['a cool-down'] : []);
    if (setMin > 0) out.push(`Each session fits your ${minutes} minutes: about ${setMin} minutes of sets, then ${joinList(extras)}.`);
    // Coverage, or groups taking turns.
    if (wp.parity) out.push('Not every muscle group fits in each week, so they take turns: what misses out comes first next week.');
    else if (GROUPS.every((g) => !pg[g].trainable || pg[g].effective >= pg[g].floor - 1e-9)) out.push('Every muscle group gets at least its weekly minimum, counting help from bigger moves.');
    // The phase.
    const ph = wp.phase;
    if (ph.deload) out.push(`A lighter week to recover: about ${Math.round(ph.mult * 100)}% of your usual sets.`);
    else if (ph.onramp && ph.idle) out.push(`Back after a break: about ${Math.round(ph.mult * 100)}% of your usual sets while you settle in again.`);
    else if (ph.onramp) out.push(`This week eases you in: about ${Math.round(ph.mult * 100)}% of a normal week's sets.`);
    // Changes you made.
    const mine = tweakWords(tw);
    if (mine.length) out.push(`Your changes: ${joinList(mine)}.`);
    // The body.
    const around = ac && ac.plannedAround(p);
    if (around) out.push(`${around}.`);
    return out;
  }
  // Plan tweaks in words.
  function tweakWords(t) {
    const b = B();
    const out = [];
    for (const [g, n] of Object.entries(t.sets)) out.push(`${b.GROUP_NAME[g].toLowerCase()} ${n > 0 ? '+' : ''}${setsWord(n)} a week`);
    for (const [f, id] of Object.entries(t.swaps)) { const m = M().MOVES[id]; const lad = M().LADDERS[f]; if (m) out.push(`${m.name.toLowerCase()} for ${lad ? lad.name.toLowerCase() : 'that exercise'}`); }
    if (t.split !== 'auto') out.push(lower(LABEL[t.split]));
    if (t.rest !== 'auto') out.push(`${t.rest === 60 ? '1 minute' : t.rest === 90 ? '90 s' : '2 minutes'} of rest`);
    if (t.finisher !== 'auto') out.push(t.finisher === 'on' ? 'a finisher every session' : 'no finishers');
    if (t.mobility !== 'auto') out.push(t.mobility === 'on' ? 'a cool-down every session' : 'no optional cool-downs');
    if (t.avoid.length) out.push(`leaving out ${joinList(t.avoid.map((id) => M().MOVES[id].name.toLowerCase()))}`);
    return out;
  }
  // explainProfile(p, day): the same for set-up's answers, before there's a state.
  function explainProfile(p, day) {
    const b = B();
    const S = b.newState(p || {}, null, day);
    return explain(S, day);
  }

  /* ================================================================== the classic splits */
  // alternatives(S, ws): the best fit and the three classic splits (full body, upper and lower,
  // push, pull and legs), each planned for the week and scored, best first.
  const KINDS = ['auto', 'full_body', 'upper_lower', 'ppl'];
  function alternatives(S, ws) {
    const phase = phaseOf(S, ws);
    const cur = tweaksOf(S.profile).split;
    const out = KINDS.map((kind) => {
      const S2 = withTweaks(S, { split: kind });
      const wp = weekPlan(S2, ws, { phase });
      return {
        split: kind, name: kind === 'auto' ? 'Best fit' : LABEL[kind], shape: wp.split.label, shapeName: LABEL[wp.split.label] || LABEL.mixed,
        score: wp.score, parts: wp.parts, considered: wp.considered, current: kind === cur,
        days: wp.days.map((d) => ({ offset: d.offset, units: d.units.slice(), minutes: Math.round(d.planned) })),
      };
    });
    return out.sort((a, x) => x.score - a.score || KINDS.indexOf(a.split) - KINDS.indexOf(x.split));
  }

  Object.assign(O, { explain, explainProfile, alternatives });
})(typeof window !== 'undefined' ? window : globalThis);
