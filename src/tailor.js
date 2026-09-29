/* Tailor my plan: someone says what they want ("more legs", "my knee hurts", "20-minute workouts",
 * "no jumping", "I got a band") and the coach turns it into a few plain changes to look over before
 * anything changes. The rules below understand most requests on their own; the on-device model
 * (held to a JSON grammar) or Claude read what they miss. Changes go through the same levers as the
 * questionnaire (brain.reprogram), are listed in the Coach timeline, and can be undone.
 *
 * A proposal: { focus: [groups], goals: [goal ids], minutes, days, avoid_joints: [joints],
 * avoid_moves: [move ids], no_jumping, gentle, add_equipment: [kit], note }. Missing is "no change".
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const B = () => GH.brain;
  const M = () => GH.moves;

  const GROUP_GOAL = { legs: 'legs', chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'arms', triceps: 'arms', abs: 'abs' };
  const EXTRA_GOALS = ['fat', 'strength', 'endurance', 'mobility'];
  const GOAL_TEXT = { fat: 'Losing fat: more walking and short finishers', strength: 'Strength: heavier, lower-rep work', endurance: 'Endurance: more walking and conditioning', mobility: 'Mobility: more stretching after workouts' };
  const KIT = ['band', 'bar', 'ball', 'table', 'door', 'chair', 'wall', 'towel'];
  const KIT_NAME = { band: 'a resistance band', bar: 'a pull-up bar', ball: 'a medicine ball', table: 'a sturdy table', door: 'a door anchor', chair: 'a chair', wall: 'a wall', towel: 'a towel' };
  const JOINT_NAME = { knee: 'knees', shoulder: 'shoulders', back: 'back', wrist: 'wrists', elbow: 'elbows', hip: 'hips', ankle: 'ankles', neck: 'neck' };

  /* ---------------------------------------------------------------- understanding a request */
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60 };
  const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[w] || null);
  const JOINT_WORDS = { knee: 'knee', knees: 'knee', shoulder: 'shoulder', shoulders: 'shoulder', back: 'back', 'lower back': 'back', wrist: 'wrist', wrists: 'wrist', elbow: 'elbow', elbows: 'elbow', hip: 'hip', hips: 'hip', ankle: 'ankle', ankles: 'ankle', neck: 'neck' };
  const HURT = '(?:hurts?|hurting|pain|painful|sore|injur(?:ed|y)|bad|aches?|aching|tweak(?:ed)?|twinge|problem|issues?|careful|weak|surgery)';
  const JOINT_RE = '(knees?|shoulders?|lower back|back|wrists?|elbows?|hips?|ankles?|neck)';
  const GROUP_WORDS = [
    ['legs', /\b(legs?|glutes?|butt|booty|quads?|hamstrings?|thighs?|calf|calves|lower body|leg day)\b/],
    ['chest', /\b(chest|pecs?|pectorals?)\b/],
    ['back', /\b(back|lats?|posture|upper back|pull-?ups?)\b/],
    ['shoulders', /\b(shoulders?|delts?|deltoids?)\b/],
    ['biceps', /\b(biceps?|arms?|guns)\b/],
    ['triceps', /\b(triceps?|arms?)\b/],
    ['abs', /\b(abs|core|stomach|belly|six.?pack|obliques?|waist)\b/],
  ];
  const MORE = /\b(more|bigger|stronger|grow|build|focus|work on|train|prioriti[sz]e|improve|extra|tone|sculpt|want)\b/;

  // What the rules make of a request. Only what's clearly asked for is filled in.
  function parse(text) {
    let t = ` ${String(text || '').toLowerCase().replace(/[’']/g, '\'').replace(/\s+/g, ' ')} `;
    const out = { focus: [], goals: [], minutes: null, days: null, avoid_joints: [], avoid_moves: [], no_jumping: null, gentle: null, add_equipment: [], note: '' };
    // Joints first ("my back hurts" is about the back, not training it), then take them out.
    const hurt = new RegExp(`\\b${JOINT_RE}\\b[^.,;!?]{0,40}?\\b${HURT}|\\b${HURT}\\b[^.,;!?]{0,30}?\\b(?:my |in my |on my )?${JOINT_RE}\\b|\\b(?:easy|gentle|careful) on (?:my )?${JOINT_RE}\\b|\\b(?:bad|weak|injured|sore|dodgy) ${JOINT_RE}\\b`, 'g');
    t = t.replace(hurt, (m, a, b, c, d) => {
      const j = JOINT_WORDS[a || b || c || d];
      if (j && !out.avoid_joints.includes(j)) out.avoid_joints.push(j);
      return ' ';
    });
    // Jumping and impact.
    if (/\b(no|without|avoid|stop|skip|hate|can'?t do|less|fewer|quiet|downstairs|neighbou?rs?|apartment)\b[^.,;!?]{0,30}\b(jump\w*|plyo\w*|impact|hops?|hopping|noise|noisy)\b/.test(t)
      || /\b(jump\w*|impact)\b[^.,;!?]{0,20}\b(hurts?|kills?|too loud|annoys?)\b/.test(t)) out.no_jumping = true;
    // Moves to leave out: "no burpees", "hate lunges", "skip the plank".
    const moves = M() ? Object.entries(M().MOVES) : [];
    for (const m of t.matchAll(/\b(?:no|without|avoid|skip|hate|drop|remove|not|can'?t do|don'?t like|stop)\s+(?:the |doing |any )?([a-z-]{4,}(?: [a-z-]{3,})?)/g)) {
      const words = m[1].replace(/s\b/g, '').split(' ');
      for (let n = words.length; n >= 1; n--) {
        const w = words.slice(0, n).join(' ');
        if (/^(jump|impact|plyo|hop|day|week|minute|more|less|equipment|weight|leg|arm|back)/.test(w)) break;
        const hit = moves.filter(([, mv]) => mv.name && mv.name.toLowerCase().replace(/-/g, ' ').includes(w.replace(/-/g, ' ')));
        if (hit.length && hit.length <= 8) { for (const [id] of hit) if (!out.avoid_moves.includes(id)) out.avoid_moves.push(id); break; }
      }
    }
    // Time and days.
    const mins = /\b(\d{1,2}|ten|fifteen|twenty|thirty|forty(?:-five)?|fifty|sixty)[ -]?(?:min|mins|minutes?)\b/.exec(t);
    if (mins) out.minutes = num(mins[1]);
    else if (/\b(shorter|quicker|less time|too long|busy|no time)\b/.test(t)) out.minutes_by = -10;
    else if (/\b(longer|more time)\b/.test(t)) out.minutes_by = 10;
    const days = /\b(\d|two|three|four|five|six)\s*(?:days?|times|sessions?|workouts?)\s*(?:a|per|each|every)\s*week\b/.exec(t) || /\b(\d|two|three|four|five|six)\s*(?:days?|times)\b/.exec(t);
    if (days) out.days = num(days[1]);
    else if (/\b(fewer days|less often|fewer workouts|train less often)\b/.test(t)) out.days_by = -1;
    else if (/\b(more days|more often|more workouts)\b/.test(t)) out.days_by = 1;
    // How hard.
    if (/\b(gentler|gentle|easier|go easy|too hard|too much|exhausted|burn(?:ed|t)? out|recovering|getting back|out of shape|sore all the time)\b/.test(t)) out.gentle = true;
    else if (/\b(harder|more intense|push me|too easy|challenge me|not enough)\b/.test(t)) out.gentle = false;
    // Goals.
    if (/\b(lose|losing|burn|drop|cut)\b[^.,;!?]{0,20}\b(fat|weight|pounds|lbs|kilos|kg|belly)\b|\blean(?:er)?\b/.test(t)) out.goals.push('fat');
    if (/\b(stronger|strength|lift heavier|heavier)\b/.test(t)) out.goals.push('strength');
    if (/\b(endurance|stamina|cardio|run(?:ning)?|fitter|out of breath)\b/.test(t)) out.goals.push('endurance');
    if (/\b(flexib\w+|mobility|stretch\w*|stiff|tight)\b/.test(t)) out.goals.push('mobility');
    // Kit they've got now.
    if (/\b(got|have|bought|own|use|using|with)\b[^.,;!?]{0,25}\b(resistance )?bands?\b/.test(t)) out.add_equipment.push('band');
    if (/\b(pull-?up|chin-?up) bar\b/.test(t)) out.add_equipment.push('bar');
    if (/\b(medicine|slam|med) ball\b/.test(t)) out.add_equipment.push('ball');
    // Muscles to train more ("more legs", "bigger arms", "focus on my back").
    const wantsMore = MORE.test(t) || /^\s*[a-z]+(?: and [a-z]+)?\s*$/.test(t);
    if (wantsMore) {
      for (const [g, re] of GROUP_WORDS) {
        const m = re.exec(t);
        if (!m) continue;
        // "less arms", "no leg day" aren't asks for more.
        const before = t.slice(Math.max(0, m.index - 14), m.index);
        if (/\b(less|fewer|no|not|skip|without|stop)\b[^a-z]*(?:[a-z]+ )?$/.test(before)) continue;
        if (!out.focus.includes(g)) out.focus.push(g);
      }
    }
    out.goals = [...new Set(out.goals)];
    return out;
  }

  /* ---------------------------------------------------------------- keeping it to what's possible */
  // Clamps a proposal (from the rules or a model) to changes this person's plan can make. Relative
  // minutes and days (-10, +1) become absolute here.
  function valid(S, raw) {
    const b = B(), p = S.profile;
    const t = raw && typeof raw === 'object' ? raw : {};
    const list = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]).map((v) => String(v).trim()).filter(Boolean);
    const out = { focus: [], goals: [], minutes: null, days: null, avoid_joints: [], avoid_moves: [], no_jumping: null, gentle: null, add_equipment: [], note: '' };
    // Body-map muscles ("calves", "upperBack") mean their group.
    const toGroup = (x) => (b.GROUPS.includes(x) ? x : GH.body && GH.body.GROUP_OF && GH.body.GROUP_OF[x] ? GH.body.GROUP_OF[x] : x === 'arms' ? 'biceps' : null);
    // Two goals can come first (arms counts once, for biceps and triceps).
    for (const g of list(t.focus).map(toGroup)) {
      if (!g || out.focus.includes(g)) continue;
      const goals = new Set(out.focus.concat([g]).map((x) => GROUP_GOAL[x]));
      if (goals.size <= 2) out.focus.push(g);
    }
    if (p.workouts === false) out.focus = [];
    for (const g of list(t.goals)) if (EXTRA_GOALS.includes(g) && !(p.goals || []).includes(g) && !out.goals.includes(g)) out.goals.push(g);
    // Minutes and days: a number, or a step from now ("shorter" is minutes_by -10).
    const mins = t.minutes != null ? Number(t.minutes) : t.minutes_by ? p.minutes + Number(t.minutes_by) : NaN;
    if (Number.isFinite(mins) && mins > 0) {
      const v = Math.max(10, Math.min(60, Math.round(mins / 5) * 5));
      if (v !== p.minutes) out.minutes = v;
    }
    const days = t.days != null ? Number(t.days) : t.days_by ? p.days + Number(t.days_by) : NaN;
    if (Number.isFinite(days) && days > 0) {
      const v = Math.max(2, Math.min(6, Math.round(days)));
      if (v !== p.days) out.days = v;
    }
    for (const j of list(t.avoid_joints)) if (b.JOINTS.includes(j) && !(p.careful || []).includes(j) && !out.avoid_joints.includes(j)) out.avoid_joints.push(j);
    const moves = M() ? M().MOVES : {};
    for (const id of list(t.avoid_moves)) if (moves[id] && !(S.excluded || []).includes(id) && !out.avoid_moves.includes(id)) out.avoid_moves.push(id);
    out.avoid_moves = out.avoid_moves.slice(0, 8);
    if (t.no_jumping === true && b.programFor(p).impactOk) out.no_jumping = true;
    if (typeof t.gentle === 'boolean' && t.gentle !== !!p.gentle) out.gentle = t.gentle;
    for (const k of list(t.add_equipment)) if (KIT.includes(k) && !p.equipment[k] && !out.add_equipment.includes(k)) out.add_equipment.push(k);
    out.note = String(t.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return out;
  }
  const empty = (t) => !t || (!t.focus.length && !t.goals.length && t.minutes == null && t.days == null && !t.avoid_joints.length && !t.avoid_moves.length && t.no_jumping == null && t.gentle == null && !t.add_equipment.length);
  // A model's reading adds to the rules' (the rules win where both say something).
  function merge(a, b) {
    if (!b) return a;
    const u = (x, y) => [...new Set((x || []).concat(y || []))];
    return {
      focus: u(a.focus, b.focus), goals: u(a.goals, b.goals), minutes: a.minutes != null ? a.minutes : b.minutes, days: a.days != null ? a.days : b.days,
      avoid_joints: u(a.avoid_joints, b.avoid_joints), avoid_moves: u(a.avoid_moves, b.avoid_moves), no_jumping: a.no_jumping != null ? a.no_jumping : b.no_jumping,
      gentle: a.gentle != null ? a.gentle : b.gentle, add_equipment: u(a.add_equipment, b.add_equipment), note: a.note || b.note || '',
    };
  }

  /* ---------------------------------------------------------------- what it would change */
  // The profile patch, and the changes in plain words (with the muscles that get less, when putting
  // one first means another moves down).
  function plan(S, t) {
    const b = B(), p = S.profile;
    const patch = {};
    const lines = [];
    if (t.focus.length) {
      const first = [...new Set(t.focus.map((g) => GROUP_GOAL[g]))];
      patch.goals = first.concat((p.goals || []).filter((g) => !first.includes(g)));
    }
    if (t.goals.length) patch.goals = (patch.goals || p.goals || []).filter((g) => g !== 'consistency').concat(t.goals);
    if (t.minutes != null) patch.minutes = t.minutes;
    if (t.days != null) { patch.days = t.days; patch.weekdays = null; }
    if (t.avoid_joints.length) patch.careful = [...new Set((p.careful || []).concat(t.avoid_joints))];
    if (t.no_jumping) patch.impactOk = false;
    if (t.gentle != null) patch.gentle = t.gentle;
    if (t.add_equipment.length) patch.equipment = Object.assign({}, p.equipment, Object.fromEntries(t.add_equipment.map((k) => [k, true])));
    // What moving a muscle up (or another down to make room) means: how often it's trained and how
    // many weekly sets it builds to. Arms (biceps and triceps) move together.
    if (patch.goals || patch.gentle != null) {
      const before = b.programFor(p), after = b.programFor(Object.assign({}, p, patch));
      const unitOf = (g) => (g === 'biceps' || g === 'triceps' ? 'arms' : g);
      const units = [...new Set(b.GROUPS.map(unitOf))];
      const name = (u) => (u === 'arms' ? 'Arms' : b.GROUP_NAME[u]);
      const cap = (prog, u) => Math.max(...b.GROUPS.filter((g) => unitOf(g) === u).map((g) => prog.cap[g]));
      const tier = (prog, u) => Math.min(...b.GROUPS.filter((g) => unitOf(g) === u).map((g) => prog.tiers[g]));
      const sub = (u) => `${after.freq[u]} ${after.freq[u] === 1 ? 'day' : 'days'} a week, building to ${cap(after, u)} sets (was ${before.freq[u]}, ${cap(before, u)})`;
      const up = units.filter((u) => tier(after, u) < tier(before, u));
      const down = units.filter((u) => tier(after, u) > tier(before, u));
      for (const u of up) lines.push({ icon: 'plus-circle', tone: 'positive', text: `${name(u)}: more each week`, sub: sub(u) });
      for (const u of down) lines.push({ icon: 'minus', tone: 'neutral', text: `${name(u)}: a little less, to make room`, sub: sub(u) });
      if (t.focus.length && !up.length) lines.push({ icon: 'check-circle', tone: 'neutral', text: `${[...new Set(t.focus.map(unitOf))].map(name).join(' and ')} already get the most work`, sub: 'Nothing to move' });
    }
    for (const g of t.goals) lines.push({ icon: 'star', tone: 'accent', text: GOAL_TEXT[g] });
    if (t.minutes != null) lines.push({ icon: 'timer', tone: 'accent', text: `Workouts of about ${t.minutes} minutes`, sub: `Now ${p.minutes}` });
    if (t.days != null) lines.push({ icon: 'calendar', tone: 'accent', text: `${t.days} workouts a week`, sub: `Now ${p.days}` });
    if (t.avoid_joints.length) lines.push({ icon: 'heart', tone: 'caution', text: `Easy on your ${t.avoid_joints.map((j) => JOINT_NAME[j]).join(' and ')}`, sub: 'Moves that load them hard or jump are left out' });
    if (t.no_jumping) lines.push({ icon: 'volume-low', tone: 'accent', text: 'No jumping', sub: 'Quiet, low-impact moves instead' });
    if (t.gentle === true) lines.push({ icon: 'leaf', tone: 'positive', text: 'A gentler plan', sub: 'Fewer sets to start, building up over two weeks' });
    if (t.gentle === false) lines.push({ icon: 'bolt', tone: 'accent', text: 'Back to the full plan', sub: 'The usual number of sets' });
    if (t.avoid_moves.length) {
      const names = [...new Set(t.avoid_moves.map((id) => M().MOVES[id].name))];
      lines.push({ icon: 'x-circle', tone: 'neutral', text: `Leaves out ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`, sub: 'Something similar takes its place' });
    }
    for (const k of t.add_equipment) lines.push({ icon: 'plus', tone: 'accent', text: `Uses ${KIT_NAME[k]}`, sub: 'More exercises to choose from' });
    return { patch, lines };
  }

  const KEEP = ['goals', 'minutes', 'days', 'weekdays', 'careful', 'impactOk', 'gentle', 'equipment'];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  // Makes the changes: the plan is rebuilt around them, and the old settings are kept for Undo.
  function apply(S, day, t) {
    const b = B();
    const { patch, lines } = plan(S, t);
    if (!lines.length) return null;
    const before = { profile: copy(Object.fromEntries(KEEP.map((k) => [k, S.profile[k]]))), excluded: (S.excluded || []).slice(), vol: Object.assign({}, S.vol) };
    if (Object.keys(patch).length) b.reprogram(S, patch, day);
    if (t.avoid_moves.length) S.excluded = [...new Set((S.excluded || []).concat(t.avoid_moves))];
    S.events = S.events || [];
    S.events.push({ type: 'tailor', day, at: Date.now(), lines: lines.map((l) => l.text), before });
    return lines;
  }
  // The last tailoring that can still be undone.
  const last = (S) => { const e = (S.events || []).filter((x) => x.type === 'tailor' && !x.undone).pop(); return e || null; };
  function undo(S, day) {
    const e = last(S);
    if (!e) return false;
    B().reprogram(S, copy(e.before.profile), day);
    S.excluded = e.before.excluded.slice();
    S.vol = Object.assign({}, S.vol, e.before.vol);
    e.undone = true;
    return true;
  }

  /* ---------------------------------------------------------------- for the models */
  // The on-device model's instructions, examples and a grammar holding its answer to this shape.
  const SYSTEM = [
    'You turn a request about a workout plan into JSON. Only include what the person asked for.',
    'focus: muscles to train more, at most 2, from: biceps, triceps, abs, chest, legs, back, shoulders.',
    'goals: goals to add, from: fat, strength, endurance, mobility.',
    'minutes: minutes per workout (10 to 60), or null. days: workouts a week (2 to 6), or null.',
    'avoid_joints: joints to go easy on, from: knee, shoulder, back, wrist, elbow, hip, ankle, neck.',
    'no_jumping: true if they want no jumping, else null. gentle: true for an easier plan, false for a harder one, else null.',
    'note: one short, friendly sentence saying what will change.',
  ].join('\n');
  const EXAMPLES = [
    ['I want bigger arms but my elbow hurts', '{"focus":["biceps","triceps"],"goals":[],"minutes":null,"days":null,"avoid_joints":["elbow"],"no_jumping":null,"gentle":null,"note":"More arm work, and easy on your elbow."}'],
    ['I only have half an hour three times a week and I want to get leaner', '{"focus":[],"goals":["fat"],"minutes":30,"days":3,"avoid_joints":[],"no_jumping":null,"gentle":null,"note":"Three 30-minute workouts with more walking to help you get leaner."}'],
  ];
  const GRAMMAR = [
    'root ::= "{\\"focus\\":" groups ",\\"goals\\":" goals ",\\"minutes\\":" (minutes | "null") ",\\"days\\":" ([2-6] | "null") ",\\"avoid_joints\\":" joints ",\\"no_jumping\\":" ("true" | "null") ",\\"gentle\\":" ("true" | "false" | "null") ",\\"note\\":" note "}"',
    'groups ::= "[" (group ("," group)?)? "]"',
    'group ::= "\\"biceps\\"" | "\\"triceps\\"" | "\\"abs\\"" | "\\"chest\\"" | "\\"legs\\"" | "\\"back\\"" | "\\"shoulders\\""',
    'goals ::= "[" (goal ("," goal){0,2})? "]"',
    'goal ::= "\\"fat\\"" | "\\"strength\\"" | "\\"endurance\\"" | "\\"mobility\\""',
    'minutes ::= [1-6] [05]',
    'joints ::= "[" (joint ("," joint){0,2})? "]"',
    'joint ::= "\\"knee\\"" | "\\"shoulder\\"" | "\\"back\\"" | "\\"wrist\\"" | "\\"elbow\\"" | "\\"hip\\"" | "\\"ankle\\"" | "\\"neck\\""',
    'note ::= "\\"" [a-zA-Z0-9 ,.\'!?-]{0,140} "\\""',
  ].join('\n');
  function messages(text) {
    const out = [{ role: 'system', content: SYSTEM }];
    for (const [q, a] of EXAMPLES) out.push({ role: 'user', content: q }, { role: 'assistant', content: a });
    out.push({ role: 'user', content: String(text || '').slice(0, 400) });
    return out;
  }
  // The on-device model's reading of a request, or null (not installed, or it didn't work out).
  async function ask(S, text, signal) {
    try {
      const llm = await GH.lazy('llm');
      if (!llm.available().ok || !GH.deviceCoach) return null;
      const id = GH.deviceCoach.pick(S, await llm.installed());
      if (!id) return null;
      await llm.load(id);
      const raw = await llm.chat(messages(text), { grammar: GRAMMAR, maxTokens: 160, temperature: 0.2, signal });
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  GH.tailor = { parse, valid, empty, merge, plan, apply, undo, last, ask, GRAMMAR, SYSTEM, messages };
})(typeof window !== 'undefined' ? window : globalThis);
