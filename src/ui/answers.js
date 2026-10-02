/* Set-up's answers as other screens show them: the detailed screens "Your answers" opens, and a short
 * line with the current answers for each (You, Plan and Settings list them). Set-up itself
 * (src/ui/onboarding.js) is a part that loads when it's needed (src/ui/lazy.js); this is what the
 * screens drawn without it read, and set-up reads it too (U.answers).
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  const B = () => GH.brain;
  const A = () => GH.access;

  const GOALS = [['abs', 'Visible abs'], ['arms', 'Bigger arms'], ['chest', 'Bigger chest'], ['legs', 'Legs and glutes'], ['back', 'Back and posture'], ['shoulders', 'Shoulders'], ['fat', 'Lose fat'], ['strength', 'Overall strength'], ['endurance', 'Endurance'], ['mobility', 'Mobility'], ['consistency', 'Consistency']];
  const JOINTS = [['knee', 'Knees'], ['shoulder', 'Shoulders'], ['back', 'Lower back'], ['wrist', 'Wrists'], ['elbow', 'Elbows'], ['hip', 'Hips'], ['ankle', 'Ankles'], ['neck', 'Neck']];
  // What food tracking the answers have: 'off', 'protein' or 'full'.
  const foodMode = (p) => (p.food && p.food.mode) || (p.protein && p.protein.track === false ? 'off' : 'protein');

  // Your answers: every detailed screen, one at a time from You or Settings, or all of them in a row.
  // workout: only when workouts are on. when(p): only when it applies to these answers.
  const STEPS = [
    { id: 'about', title: 'About you', section: 'About you' },
    { id: 'conditions', title: 'Anything we should plan around?', section: 'About you', workout: true },
    { id: 'goals', title: 'Goals', section: 'Training', workout: true },
    { id: 'experience', title: 'Experience', section: 'Training', workout: true },
    { id: 'schedule', title: 'Schedule', section: 'Training', workout: true },
    { id: 'equipment', title: 'Equipment', section: 'Training', workout: true },
    { id: 'body', title: 'Joints and sides', section: 'Training', workout: true },
    { id: 'nutrition', title: 'Weight and protein', section: 'Food', when: (p) => foodMode(p) !== 'full' },
    { id: 'food', title: 'Food', section: 'Food', when: (p) => foodMode(p) === 'full' },
    { id: 'plan', title: 'Your plan', section: 'Your plan' },
  ];
  U.answers = { GOALS, JOINTS, STEPS, foodMode };

  // The screens You and Settings list under "Your answers" for this person.
  U.editableSteps = () => {
    const p = U.S && U.S.profile;
    return STEPS.filter((s) => !s.modes && s.id !== 'plan' && (!s.workout || !p || p.workouts !== false) && (!s.when || !p || s.when(p)));
  };
  // Every piece of equipment the person has ticked (each weight counts once).
  U.equipCount = (eq) => (eq.db || []).length + (eq.kb || []).length + ['ball', 'band', 'bar', 'table'].filter((k) => eq[k]).length;
  // "Home · 5 items", "Gym · 14 items", "Home and gym": what the Equipment rows show.
  U.equipSummary = (p) => {
    const home = U.equipCount(p.equipment || {});
    const g = p.gym || {};
    const gymN = Object.entries(g).filter(([k, v]) => k !== 'dbMax' && k !== 'bar' && v === true).length + (g.dbMax > 0 ? 1 : 0);
    const w = p.where || 'home';
    if (w === 'gym') return gymN ? `Gym · ${U.plural(gymN, 'item')}` : 'Gym';
    if (w === 'both') return 'Home and gym';
    return home ? U.plural(home, 'item') : 'Bodyweight only';
  };
  const EXP = { never: 'Never really trained', onoff: 'Now and then', lt1: 'Under a year, steadily', '1to3': '1 to 3 years', '3plus': 'More than 3 years' };
  // A short line with the current answers on one set-up screen, for the "Your answers" list.
  U.answerSummary = (id, p) => {
    const w = p.weightKg ? U.fmtW(p.weightKg, 0) : null;
    const names = Object.fromEntries(GOALS);
    const pr = p.protein || {};
    switch (id) {
      case 'about': return [p.age ? `${p.age} years` : null, w, p.heightCm ? (U.lb() ? `${Math.floor(p.heightCm / 30.48)} ft ${Math.round(p.heightCm / 2.54 % 12)} in` : `${p.heightCm} cm`) : null].filter(Boolean).join(' · ') || 'Age, weight and height';
      case 'conditions': { const list = (p.conditions || []).map((c) => (A().CONDITIONS.find((x) => x.id === c) || {}).name).filter(Boolean); return list.length ? list.join(', ') : 'Nothing to plan around'; }
      case 'goals': return (p.goals || []).map((g) => names[g] || g).join(', ') || 'Consistency';
      case 'experience': return EXP[p.experience] || 'How long you\'ve trained';
      case 'schedule': return `${p.days} days a week · ${p.minutes} min`;
      case 'equipment': return U.equipSummary(p);
      case 'body': return (p.careful || []).length ? `Careful with ${(p.careful || []).map((j) => (JOINTS.find((x) => x[0] === j) || [j, j])[1].toLowerCase()).join(', ')}` : 'Injuries, stronger side, jumping';
      case 'nutrition': return `${p.weightGoal === 'lose' ? 'Lose' : p.weightGoal === 'gain' ? 'Gain' : 'Maintain'} weight · ${pr.track === false ? 'protein goal off' : proteinWords(p)}`;
      case 'food': return `${p.weightGoal === 'lose' ? 'Lose' : p.weightGoal === 'gain' ? 'Gain' : 'Maintain'} weight · calories and macros`;
      default: return '';
    }
  };
  // "About 120 g of protein a day" from the weight and the amount per weight picked.
  function proteinWords(p) {
    const kg = p.weightKg;
    const per = (p.protein && p.protein.perLb) || 0.8;
    return kg ? `about ${Math.round(per * kg * B().LB_PER_KG / 5) * 5} g of protein a day` : 'a protein goal';
  }
})(typeof window !== 'undefined' ? window : globalThis);
