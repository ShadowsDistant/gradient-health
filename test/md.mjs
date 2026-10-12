// The answers' Markdown renderer (src/ui/md.js) and the data embeds (src/ui/embeds.js): what an AI
// writes is escaped first and only the app's own tags are added; every element; an answer drawn at
// every length while it streams in (no broken markup, no stray marks); which embeds an answer names,
// what each shows from the app's own numbers, and which ones an answer gets from its question.
import { load, check, section, done } from './lib.mjs';

const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/data/science.js', 'src/engine/pose.js', 'src/brain.js', 'src/access.js', 'src/insights.js', 'src/body.js', 'src/health.js', 'src/food.js', 'src/store.js', 'src/coach.js', 'src/ui/md.js', 'src/ui/embeds.js');
const MD = GH.md, E = GH.embeds, B = GH.brain, C = GH.coach;
const r = (t, o) => MD.render(t, o);

// The tags the renderer may write (and the stand-in embed below), each opened and closed in order.
const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h3', 'h4', 'hr', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span']);
const VOID = new Set(['br', 'hr']);
function wellFormed(html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (!ALLOWED.has(tag)) return `tag <${tag}>`;
    if (/\son\w+=|javascript:|href=|src=/i.test(attrs)) return `attribute ${attrs}`;
    if (VOID.has(tag)) continue;
    if (!close) stack.push(tag);
    else if (stack.pop() !== tag) return `</${tag}> out of order`;
  }
  if (stack.length) return `unclosed ${stack.join(',')}`;
  const text = html.replace(/<[^>]*>/g, '');
  if (/[<>]/.test(text)) return 'a raw < or > in the text';
  if (/\*\*|\[\[|\]\]|^#{1,6}\s|```/m.test(text)) return `a stray mark in "${text.slice(0, 80)}"`;
  return null;
}

section('Escaped first');
{
  const h = r('Hi <script>alert(1)</script> & <b onclick="x()">bold</b> "quoted" \'single\'');
  check('raw HTML from a model is text, never markup', !/<script|<b /.test(h) && /&lt;script&gt;/.test(h) && /&lt;b onclick=&quot;x\(\)&quot;&gt;/.test(h) && /&amp;/.test(h) && /&#39;single&#39;/.test(h), h);
  const l = r('See [the study](javascript:alert(1)) and ![a cat](https://x.test/cat.png) now.');
  check('a link keeps its words without the link, and an image goes', h && /See the study and\s+now\./.test(l) && !/href|src|javascript|cat/.test(l), l);
  check('a table cell and a heading are escaped too', /&lt;i&gt;/.test(r('| a | <i>b</i> |\n|---|---|\n| 1 | 2 |')) && /&lt;img/.test(r('### <img src=x onerror=y>')));
  check('code marks and strike marks go, their words stay', r('Use `curls` and ~~not~~ this').includes('Use curls and not this'));
  check('every one of those is well formed', [h, l, r('| a | <i>b</i> |\n|---|---|\n| 1 | 2 |'), r('### <img src=x onerror=y>')].every((x) => wellFormed(x) === null));
}

section('Every element');
{
  check('paragraphs, and a line break inside one', r('One.\n\nTwo\nthree.') === '<p>One.</p><p>Two<br>three.</p>', r('One.\n\nTwo\nthree.'));
  check('bold and italic', r('**7 h 12** and *more* and _this_') === '<p><strong>7 h 12</strong> and <em>more</em> and <em>this</em></p>', r('**7 h 12** and *more* and _this_'));
  check('an id with underscores and a sum with stars stay as they are', r('push_std is 3 * 4') === '<p>push_std is 3 * 4</p>', r('push_std is 3 * 4'));
  check('a bullet list', r('- one\n- two\n* three') === '<ul><li>one</li><li>two</li><li>three</li></ul>', r('- one\n- two\n* three'));
  check('a numbered list, from where it starts', r('1. a\n2. b') === '<ol><li>a</li><li>b</li></ol>' && /<ol start="3">/.test(r('3. c\n4. d')));
  const nested = r('- top\n  - inner one\n  - inner two\n- next');
  check('one level of nesting', nested === '<ul><li>top<ul><li>inner one</li><li>inner two</li></ul></li><li>next</li></ul>', nested);
  check('a numbered list inside bullets', r('- a\n   1. b\n   2. c') === '<ul><li>a<ol><li>b</li><li>c</li></ol></li></ul>', r('- a\n   1. b\n   2. c'));
  check('a line indented under an item carries it on', r('- one\n  more\n- two') === '<ul><li>one more</li><li>two</li></ul>', r('- one\n  more\n- two'));
  check('a line that isn\'t indented ends the list', r('- one\nNext step: walk.') === '<ul><li>one</li></ul><p>Next step: walk.</p>', r('- one\nNext step: walk.'));
  check('small headings: ### and #### (and a bigger one drawn as small)', r('### Sleep') === '<h3 class="md-h">Sleep</h3>' && r('#### Steps') === '<h4 class="md-h4">Steps</h4>' && r('# Big') === '<h3 class="md-h">Big</h3>');
  check('#hashtag stays words', r('#hashtag') === '<p>#hashtag</p>');
  check('a rule', r('a\n\n---\n\nb') === '<p>a</p><hr class="md-hr"><p>b</p>' && r('***') === '<hr class="md-hr">');
  const t = r('| Week | Sleep | Steps |\n|---|:--:|---:|\n| This | 7 h 12 | 8,200 |\n| Last | 6 h 50 | 7,900 |');
  check('a pipe table, in a box that scrolls', t.startsWith('<div class="md-table"><table><thead><tr><th>Week</th>') && (t.match(/<tr>/g) || []).length === 3 && /<td class="md-num">7 h 12<\/td>/.test(t) && /<td>This<\/td>/.test(t), t);
  check('a short row is filled out, a long one keeps its cells', (r('| a | b | c |\n|---|---|---|\n| 1 |').match(/<td/g) || []).length === 3);
  check('a table without pipes at the ends', /<th>a<\/th><th>b<\/th>/.test(r('a | b\n---|---\n1 | 2')));
  check('all of them well formed', [nested, t, r('# Big\n\n- a\n  - b\n\n---\n\n| x |\n|---|\n| 1 |')].every((x) => wellFormed(x) === null));
}

section('Embeds');
{
  const seen = [];
  const embed = (tok) => { seen.push(tok); return tok === 'nothing' ? '' : `<div class="emb">${MD.esc(tok)}</div>`; };
  const h = r('Sleep is steady.\n\n[[sleep]]\n\n- More at weekends [[steps:30d]]\n\n[[nothing]]\n[[weight:90d]] [[hrv]]', { embed });
  check('an embed alone on a line is what the app draws there', /<p>Sleep is steady\.<\/p><div class="emb">sleep<\/div>/.test(h), h);
  check('one inside a line is drawn after its block, its marks gone', /<ul><li>More at weekends<\/li><\/ul><div class="emb">steps:30d<\/div>/.test(h), h);
  check('one the app can\'t draw is dropped, and two on a line both show', !/nothing/.test(h) && /weight:90d<\/div><div class="emb">hrv/.test(h), h);
  check('nothing ever shows as [[…]] text', !/\[\[|\]\]/.test(h) && wellFormed(h) === null && seen.join() === 'sleep,steps:30d,nothing,weight:90d,hrv', seen);
  check('without an embed hook, embeds just go', r('a\n[[sleep]]\nb') === '<p>a<br>b</p>' || r('a\n[[sleep]]\nb') === '<p>a</p><p>b</p>', r('a\n[[sleep]]\nb'));
  check('a stray [[ or ]] never shows', !/\[|\]/.test(r('Look [[here and there]] ok')) && !/\[\[/.test(r('Cut off [[sle')), r('Cut off [[sle'));
}

section('While it streams in');
{
  const answer = [
    'You averaged **7 h 12 min** a night, *more* than usual.',
    '',
    '### This week',
    '',
    '- Bedtime moved earlier on 4 nights.',
    '- Weekends were the shortest:',
    '  - Saturday 6 h 10',
    '  - Sunday 6 h 40',
    '',
    '| Night | Sleep |',
    '|---|---:|',
    '| Mon | 7 h 30 |',
    '| Sat | 6 h 10 |',
    '',
    '[[sleep:30d]]',
    '',
    '---',
    '',
    '1. Keep Saturday\'s bedtime.',
    '2. See [the guide](https://x.test) for more.',
  ].join('\n');
  const embed = (tok) => `<div class="emb">${MD.esc(tok)}</div>`;
  const bad = [], shrank = [];
  let prev = '';
  for (let n = 1; n <= answer.length; n++) {
    const h = r(answer.slice(0, n), { streaming: true, embed });
    const e = wellFormed(h);
    if (e) bad.push(`${n}: ${e}`);
    // The words shown only grow: a mark doesn't show and then go, a bullet doesn't flip to text.
    const text = h.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
    if (!text.startsWith(prev)) shrank.push(`${n}: "${prev.slice(-12)}" → "${text.slice(-12)}"`);
    prev = text;
  }
  check(`every length of an answer, ${answer.length} of them, is well formed with no stray marks`, bad.length === 0, bad.slice(0, 5));
  check('and what\'s shown only grows as it comes in', shrank.length === 0, shrank.slice(0, 5));
  check('an unclosed ** is bold to the end while it streams, and dropped once it\'s done', r('It was **7 h', { streaming: true }) === '<p>It was <strong>7 h</strong></p>' && r('It was **7 h') === '<p>It was 7 h</p>');
  check('a list marker with nothing after it waits', r('Text\n- ', { streaming: true }) === '<p>Text</p>' && r('Text\n-', { streaming: true }) === '<p>Text</p>' && r('Text\n2.', { streaming: true }) === '<p>Text</p>');
  check('a table half there is a table with what came', /<th>Night<\/th><th>Sle<\/th>/.test(r('| Night | Sle', { streaming: true })) && !/---/.test(r('| a | b |\n|--', { streaming: true })));
  check('an embed or a link not finished waits', r('See\n[[sle', { streaming: true, embed }) === '<p>See</p>' && r('See [the gui', { streaming: true }) === '<p>See</p>', r('See [the gui', { streaming: true }));
  check('a heading\'s marks wait for its words', r('Hi\n###', { streaming: true }) === '<p>Hi</p>' && r('Hi\n### ', { streaming: true }) === '<p>Hi</p>');
}

section('Copy');
{
  const p = MD.plain('**Yes**, *mostly*.\n\n### Week\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[[sleep]]\n- one [[steps]]');
  check('the words without the marks, embeds and table rules', p === 'Yes, mostly.\n\nWeek\n\na | b\n1 | 2\n\n- one', JSON.stringify(p));
}

section('The embeds\' grammar');
{
  const t = (x) => (E.spec(x) || {}).token || null;
  check('a kind, with 7 days unless it says (30 for weight, 90 for a move)', t('sleep') === 'sleep:7d' && t('weight') === 'weight:30d' && t('lift:push_std') === 'lift:push_std:90d' && t('workouts') === 'workouts');
  check('ranges in days, weeks or months, to the nearest of 7, 30 and 90', t('sleep:30d') === 'sleep:30d' && t('steps:90d') === 'steps:90d' && t('hrv:4w') === 'hrv:30d' && t('rhr:3m') === 'rhr:90d' && t('sleep:1w') === 'sleep:7d' && t('steps:14') === 'steps:7d');
  check('a few other names for the same, any case', t('Heart') === 'rhr:7d' && t('SETS') === 'muscles' && t('week') === 'workouts' && t('exercise:Goblet squat:30d') === 'lift:Goblet squat:30d');
  check('the week\'s own embeds take no range', t('workouts:90d') === 'workouts' && t('streak:30d') === 'streak' && t('muscles:7d') === 'muscles');
  check('anything else is none the app can draw', [t('nonsense'), t('lift'), t('lift:'), t(''), t('sleep sleep'), t('<b>')].every((x) => x === null));
  check('the ones an answer names, each once', JSON.stringify(E.tokens('A [[sleep]] b [[sleep:7d]] [[nonsense]]\n[[lift:Push-ups:30d]]')) === '["sleep:7d","lift:Push-ups:30d"]');
}

section('What an embed shows');
const D0 = B.dayFromStr('2026-09-28');
function person(o = {}) {
  const S = B.newState({ goals: ['abs', 'arms'], age: 30, equipment: { db: [8] }, weightKg: 68 }, { curlL: 14, curlR: 18 }, D0 - 35);
  for (let d = D0 - 40; d <= D0; d++) S.health.days[d] = o.health === false ? undefined : { steps: 6000 + (d % 5) * 200, sleepMin: (d >= D0 - 6 ? 450 : 420) + (d % 3) * 10, rhr: 60, hrv: 55 };
  if (o.health === false) S.health.days = {};
  for (let d = D0 - 35; d < D0; d++) {
    if (o.workouts === false || B.todayPlan(S, d).type !== 'workout') continue;
    B.startWorkout(S, d, { now: d * B.DAY_MS + 18 * 3600000 });
    let g = 0;
    while (S.active && S.active.idx < S.active.steps.length && g++ < 400) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '3'); }
    B.finishWorkout(S, { rating: 'easy', now: d * B.DAY_MS + 19 * 3600000 });
  }
  for (let d = D0 - 20; d <= D0; d += 2) B.addWeight(S, d, 68 - (D0 - d) * 0.02, 'hc');
  return GH.store.migrate(S);
}
{
  const S = person();
  const H = GH.health;
  const sl = E.data(S, D0, 'sleep');
  const v = H.versus(S, 'sleepMin', D0, 'week');
  check('a number is this week\'s, against the usual, as Health works it out', sl.value === v.value && sl.vs.dir === v.dir && sl.vs.tone === v.tone && sl.vs.text === `against your usual ${H.format(S, 'sleepMin', v.usual)}` && sl.open.act === 'metric' && sl.open.arg === 'sleepMin', sl);
  check('with its nights as bars', sl.chart.kind === 'bar' && sl.chart.points.length === 7 && sl.chart.points.every((p, i) => p.value === H.history(S, 'sleepMin', D0 - 6, D0)[i].value));
  const sl30 = E.data(S, D0, 'sleep:30d');
  check('a longer range draws more nights, says how much it changed over them and opens the sheet at that range', sl30.chart.points.length === 30 && /over 30 days$/.test(sl30.over) && sl30.open.range === 28 && sl30.range === 'Last 30 nights', sl30);
  const st = E.data(S, D0, 'steps');
  check('steps say their goal, a line for resting heart rate', /^Goal [\d,]+ a day$/.test(st.note) && st.chart.kind === 'bar' && E.data(S, D0, 'rhr').chart.kind === 'line');
  const w = E.data(S, D0, 'weight:90d');
  check('weight is its 7-day average on the week before', w.per === '7-day average' && w.vs.text === 'on the week before' && w.chart.points.length === 11);
  const wk = E.data(S, D0, 'workouts');
  const cal = B.calendar(S, D0);
  check('workouts: this week\'s days as Progress marks them, done of planned, and what\'s next', wk.chart.days.length === 7 && wk.text === `0 of ${cal.weeks[B.weekStart(D0)].sessions.filter((x) => !x.dropped).length}` && /^Next: today$/.test(wk.note) && wk.open.arg === 'plan', wk);
  const mu = E.data(S, D0, 'muscles');
  const sets = B.weeklySets(S, D0);
  check('muscles: this week\'s sets per group against target, as Progress shows them', mu.chart.rows.length === B.GROUPS.filter((g) => sets[g].target > 0).length && mu.chart.rows.every((x) => x.target === sets[B.GROUPS.find((g) => B.GROUP_NAME[g] === x.name)].target), mu.chart.rows);
  const sk = E.data(S, D0, 'streak');
  check('the streak, with four weeks of days', sk.text === String(cal.streak.current) && sk.chart.days.length === 28);
  const lift = E.data(S, D0, 'lift:Push-ups');
  check('a move by its ladder\'s name is the rung they\'re on, its best sets and level', lift && lift.open.arg === S.prog.push.rung && lift.unit === 'reps' && /^Level \d+ of \d+$/.test(lift.note) && lift.chart.points.length >= 2, lift);
  const curl = E.data(S, D0, `lift:${S.prog.curl.rung}`);
  check('at the same weight, a move\'s reps are its progress', curl && curl.unit === 'reps' && /^best set at 8 lb$/.test(curl.per), curl);
  check('one the app can\'t find is none; one with nothing logged says so', E.data(S, D0, 'lift:not a move') === null && /^No push-up logged/.test(E.data(S, D0, 'lift:push_std').empty));
  const none = person({ health: false, workouts: false });
  check('no data yet: a line that says so, never a number', /^No sleep data/.test(E.data(none, D0, 'sleep').empty) && /^No resting heart rate data/.test(E.data(none, D0, 'rhr').empty) && /^No streak yet/.test(E.data(none, D0, 'streak').empty));
  none.profile.workouts = false;
  check('workouts off: no workouts or muscles to show', E.data(none, D0, 'workouts') === null && E.data(none, D0, 'muscles') === null);
  none.profile.protein.track = false;
  check('protein tracking off says so', /off/.test(E.data(none, D0, 'protein').empty));

  section('Embeds from what the question is about');
  check('sleep, steps, the heart: their numbers', E.forQuestion(S, D0, 'How is my sleep?').join() === 'sleep:7d' && E.forQuestion(S, D0, 'Am I moving enough?').join() === 'steps:7d' && E.forQuestion(S, D0, 'Is my resting heart rate ok?').join() === 'rhr:7d,hrv:7d');
  const strong = E.forQuestion(S, D0, 'Am I getting stronger?');
  check('stronger: the move that went up most, and the week\'s sets', strong.length === 2 && /^lift:/.test(strong[0]) && strong[1] === 'muscles', strong);
  check('at most two, and none for a question the app knows nothing about', E.forQuestion(S, D0, 'What should I focus on this week?').length === 2 && E.forQuestion(S, D0, 'What is the capital of France?').length === 0);
  check('only with data to show', E.forQuestion(none, D0, 'How is my sleep?').length === 0 && E.forQuestion(none, D0, 'Is my heart rate ok?').length === 0);
  check('never for an emergency', E.forQuestion(S, D0, 'I have chest pain').length === 0);
}

section('The number check keeps an answer\'s shape');
{
  const given = 'Sleep 7 h 12 a night; 4 of 7 nights; level 3 of 8.';
  const k = C.keepToGiven('You slept **7 h 12** a night. That is 99% of people.\n\n### This week\n\n- Bedtime earlier 4 of 7 nights.\n- 12,345 steps is great.\n\n| Night | Sleep |\n|---|---|\n| Mon | 9 h 99 |\n\n[[sleep:30d]]\n\n1. Keep it up.\n2. Level 3 is next.', given);
  check('a list\'s numbers and an embed\'s range are no numbers of the answer\'s', !/99%|12,345|9 h 99/.test(k.text) && /\[\[sleep:30d\]\]/.test(k.text) && /^1\. Keep it up\.$/m.test(k.text) && /^2\. Level 3 is next\.$/m.test(k.text), k.text);
  check('a sentence goes, a bullet with nothing left goes, a table left with no rows goes, and the lines stay lines', k.cut === 3 && /^You slept \*\*7 h 12\*\* a night\.$/m.test(k.text) && /^- Bedtime earlier 4 of 7 nights\.$/m.test(k.text) && !/\|/.test(k.text) && /### This week/.test(k.text), k);
  const stray = C.noEmbeds('Sleep is fine [[sleep]].\n\n[[steps:30d]]\n- one [[ two ]] more\n[[par');
  check('a stray [[ from a small model goes, and the words close up', stray === 'Sleep is fine.\n\n- one more', JSON.stringify(stray));
}

done();
