// Haptics in platform.js: a browser pattern for every kind (the same kinds as Haptics.java, every one
// of them in the Feel each one gallery once, and every haptic('…') in the app names one), stronger at a
// stronger setting, and the rules for when two meet: a moment reported twice plays once, a smaller
// haptic can't cut a bigger one short, an equal event waits its turn, a toast's haptic leaves its
// action's feel alone, and a player cue's buzz is that moment's haptic in the app with haptics on (the
// plain alarm-class buzz otherwise, and while the app is out of sight). The kinds for specific
// actions (a long press, a day picked, a sheet, a menu, closing and flicking away, save, copy, send,
// remove, refresh, a code scanned, start, cancel, skip, more rest, a swap) each have the character
// they're meant to, on the phone and in the browser, and each is played somewhere in the app.
// Usage: node test/haptics.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, load, check, section, done } from './lib.mjs';

// The clock and the timers, by hand: later(ms) moves time on and runs what falls due.
let now = 1e6;
Date.now = () => now;
const timers = [];
globalThis.setTimeout = (fn, ms) => { const t = { at: now + Math.max(0, Number(ms) || 0), fn }; timers.push(t); return t; };
globalThis.clearTimeout = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
const later = (ms = 5000) => {
  const end = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    if (!timers.length || timers[0].at > end) break;
    const t = timers.shift();
    now = Math.max(now, t.at);
    t.fn();
  }
  now = end;
};
const GH = load('src/platform.js', 'src/ui/hapticsui.js');
const P = GH.platform;
const kinds = P.hapticKinds;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('Kinds');
const javaSrc = readFileSync(join(root, 'android/src/com/shadowsdistant/gradienthealth/Haptics.java'), 'utf8');
const javaPuts = [...javaSrc.matchAll(/put\("(\w+)",\s*(ui|event),\s*(\w+),\s*c\(([^)]*)\)/g)].map((m) => ({ kind: m[1], ui: m[2] === 'ui', effect: m[3], comp: m[4] }));
const java = javaPuts.map((x) => x.kind);
check(`the browser has the same ${kinds.length} kinds as Haptics.java`, kinds.length >= 30 && java.length === kinds.length && same([...kinds].sort(), [...java].sort()), { web: kinds, java });
check('no kind twice', new Set(kinds).size === kinds.length && new Set(java).size === java.length);
const uiWeb = kinds.filter((k) => P.hapticRank(k) === 0).sort(), uiJava = javaPuts.filter((x) => x.ui).map((x) => x.kind).sort();
check('the UI kinds (rank 0) are the ones the phone skips with touch feedback off', same(uiWeb, uiJava), { uiWeb, uiJava });
check('every composition starts from a click, tick, thud, rise or fall the phone has (or a stand-in for it)', javaPuts.every((x) => x.comp.split(',').length % 3 === 0 && /^(CLICK|THUD|SPIN|QUICK_RISE|SLOW_RISE|QUICK_FALL|TICK|LOW_TICK)$/.test(x.comp.split(',')[0].trim())), javaPuts.filter((x) => x.comp.split(',').length % 3));
check('only the one-beat kinds and deny have a predefined effect', javaPuts.filter((x) => x.effect !== 'NONE').map((x) => x.kind).join() === 'tap,press,select,tick,edge,deny', javaPuts.filter((x) => x.effect !== 'NONE').map((x) => x.kind));
// Each kind's composition (primitive, scale, gap triples) and waveform (ms, strength pairs), read
// whole from its put(...): a number missing from either would shift every one after it.
const PRIMS = { CLICK: 1, THUD: 2, SPIN: 3, QUICK_RISE: 4, SLOW_RISE: 5, QUICK_FALL: 6, TICK: 7, LOW_TICK: 8 };
const javaKinds = {};
for (const m of javaSrc.matchAll(/put\("(\w+)",\s*(ui|event),\s*(\w+),\s*c\(([^)]*)\),\s*w\(([^)]*)\)\);/g)) {
  const comp = m[4].split(',').map((x) => x.trim());
  const wave = m[5].split(',').map((x) => parseFloat(x));
  const beats = [];
  for (let i = 0; i + 2 < comp.length; i += 3) beats.push({ p: comp[i], scale: parseFloat(comp[i + 1]), gap: parseFloat(comp[i + 2]) });
  javaKinds[m[1]] = { ui: m[2] === 'ui', comp, wave, beats };
}
check('every put(...) reads whole: its composition and its waveform', Object.keys(javaKinds).length === java.length, java.filter((k) => !javaKinds[k]));
const badShape = Object.entries(javaKinds).filter(([, k]) => k.comp.length % 3 || k.wave.length % 2 || k.beats.some((b) => !PRIMS[b.p] || !(b.scale > 0 && b.scale <= 1) || !(b.gap >= 0)) || k.wave.some((x, i) => (i % 2 ? !(x >= 0 && x <= 1) : !(x > 0))));
check('compositions are primitive, scale (0 to 1), gap (0 or more); waveforms ms, strength (0 to 1)', !badShape.length, badShape.map(([k]) => k));
check('every kind plays as media on the phone, so its touch intensity can\'t dull it', /USAGE_MEDIA/.test(javaSrc) && !/USAGE_TOUCH/.test(javaSrc));
check('Light 0.75, Medium full strength, Strong full strength with a body', /SCALE = \{0\.75f, 1f, 1f\}/.test(javaSrc) && /BODY_SCALE = 0\.7f/.test(javaSrc));
check('Java 8: no lambdas or method references', !/->|::/.test(javaSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));

// haptic('x'), haptic(cond ? 'x' : 'y') and haptic(f(a) ? 'x' : 'y') everywhere in src/, and every
// data-haptic="x" on an action.
const used = new Map();
const marked = new Map();
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { walk(join(dir, f.name)); continue; }
    if (!f.name.endsWith('.js')) continue;
    const src = readFileSync(join(dir, f.name), 'utf8');
    for (const m of src.matchAll(/haptic\(((?:[^()]|\([^()]*\))*)\)/g)) {
      const args = m[1].includes('?') ? m[1].slice(m[1].indexOf('?')) : m[1];
      for (const q of args.matchAll(/'(\w+)'/g)) used.set(q[1], f.name);
    }
    for (const m of src.matchAll(/data-haptic="(\w+)"/g)) marked.set(m[1], f.name);
  }
};
walk(join(root, 'src'));
const unknown = [...used, ...marked].filter(([k]) => !kinds.includes(k));
check(`every haptic('…') and data-haptic in the app names a kind (${used.size} used)`, used.size >= 20 && !unknown.length, unknown);

section('The Feel each one gallery');
const groups = GH.ui.hapticGroups || [];
const listed = groups.flatMap((g) => g[5].map(([k]) => k));
check('the groups: Touch, Navigation, Feedback, Workout, Moments, then Activities', groups.map((g) => g[1]).join() === 'Touch,Navigation,Feedback,Workout,Moments,Activities', groups.map((g) => g[1]));
check('every kind is in it, once', listed.length === kinds.length && same([...listed].sort(), [...kinds].sort()), { missing: kinds.filter((k) => !listed.includes(k)), extra: listed.filter((k, i) => !kinds.includes(k) || listed.indexOf(k) !== i) });
check('each chip has a short name', groups.every((g) => g[5].every(([, t]) => typeof t === 'string' && t.length >= 2 && t.length <= 14)), groups.flatMap((g) => g[5]).filter(([, t]) => t.length > 14));
check('Touch and Navigation are the UI kinds, the rest the events', same(groups.slice(0, 2).flatMap((g) => g[5].map(([k]) => k)).sort(), uiWeb));

section('Browser patterns');
const on = (p) => p.filter((_, i) => i % 2 === 0);
const total = (p) => on(p).reduce((a, x) => a + x, 0);
for (const k of kinds) {
  const [l, m, s] = ['light', 'medium', 'strong'].map((x) => P.hapticPattern(k, x));
  const shaped = [l, m, s].every((p) => p.length === s.length && p.length % 2 === 1 && p.every((x) => Number.isInteger(x) && x > 0));
  const order = on(s).every((x, i) => x >= on(m)[i] && on(m)[i] >= on(l)[i]);
  check(`${k}: [${m}] at Medium, strong ≥ medium ≥ light`, shaped && order && total(s) > total(m) && total(m) > total(l), { l, m, s });
}
check('Light is 0.75 of Medium and Strong 1.3 (a tap: 15, 20, 26 ms)', same(['light', 'medium', 'strong'].map((x) => P.hapticPattern('tap', x)), [[15], [20], [26]]));
check('the pauses stay the same at every strength', kinds.every((k) => same(P.hapticPattern(k, 'light').filter((_, i) => i % 2), P.hapticPattern(k, 'strong').filter((_, i) => i % 2))));
check('an unknown kind is a tap, and no strength is medium', same(P.hapticPattern('nope', 'strong'), P.hapticPattern('tap', 'strong')) && same(P.hapticPattern('success'), P.hapticPattern('success', 'medium')));
check('names an object inherits aren\'t kinds or strengths', same(P.hapticPattern('constructor', 'toString'), P.hapticPattern('tap', 'medium')) && same(P.hapticPattern('__proto__', '__proto__'), P.hapticPattern('tap', 'medium')) && P.hapticRank('constructor') === 0);
check('events are longer than taps', ['success', 'log', 'undo', 'deny', 'warning', 'error', 'heavy', 'setDone', 'done', 'workoutDone', 'pr', 'badge', 'celebrate', 'save', 'copy', 'send', 'remove', 'refresh', 'scan', 'start', 'cancel', 'skip', 'extend', 'swap'].every((k) => total(P.hapticPattern(k, 'strong')) > total(P.hapticPattern('tap', 'strong'))));
check('ranks: the UI 0, the countdown 1, events 2, the big ones 3', P.hapticRank('tab') === 0 && P.hapticRank('countdown') === 1 && P.hapticRank('setDone') === 2 && ['error', 'heavy', 'workoutDone', 'pr', 'badge', 'celebrate'].every((k) => P.hapticRank(k) === 3));
check('no two kinds feel the same in the browser either', new Set(kinds.map((k) => P.hapticPattern(k, 'medium').join())).size === kinds.length);
const ACT = ['actGo', 'actPause', 'actResume', 'actAutoPause', 'actAutoResume', 'actSplit', 'actGps', 'actFinish', 'actDiscard'];
check('an activity\'s moments each have their own kind, the last block of both tables', ACT.every((k) => kinds.includes(k)) && kinds.slice(-ACT.length).join() === ACT.join() && java.slice(-ACT.length).join() === ACT.join(), { web: kinds.slice(-ACT.length), java: java.slice(-ACT.length) });
check('finishing and discarding are among the big ones, the rest events', ['actFinish', 'actDiscard'].every((k) => P.hapticRank(k) === 3) && ACT.slice(0, 7).every((k) => P.hapticRank(k) === 2));
check('a pause or resume the app made is softer than one by hand', total(P.hapticPattern('actAutoPause', 'medium')) < total(P.hapticPattern('actPause', 'medium')) && total(P.hapticPattern('actAutoResume', 'medium')) < total(P.hapticPattern('actResume', 'medium')));

section('Kinds for specific actions');
// Each: its gallery group, its rank, and the character it's meant to have, read from its phone
// composition (primitives and their scales and gaps) and its browser pattern (the beats at Medium).
const beats = (k) => (javaKinds[k] ? javaKinds[k].beats : []);
const ps = (k) => beats(k).map((b) => b.p).join();
const sc = (k) => beats(k).map((b) => b.scale);
const ons = (k) => on(P.hapticPattern(k, 'medium'));
const desc = (xs) => xs.length > 1 && xs.every((x, i) => i === 0 || x < xs[i - 1]);
const loudest = (xs) => xs.indexOf(Math.max(...xs));
const SPECIFIC = [
  ['hold', 'touch', 0, 'a long press: two soft beats pressing in, then the click, last and strongest', () => ps('hold') === 'LOW_TICK,LOW_TICK,CLICK' && loudest(sc('hold')) === 2 && loudest(ons('hold')) === 2],
  ['day', 'touch', 0, 'a day picked: a tick with a softer echo close behind', () => ps('day') === 'TICK,LOW_TICK' && desc(sc('day')) && beats('day')[1].gap <= 20 && desc(ons('day'))],
  ['sheet', 'navigation', 0, 'a sheet: a swell, its landing (the strongest), then a light settle', () => ps('sheet') === 'QUICK_RISE,LOW_TICK,TICK' && loudest(sc('sheet')) === 1 && loudest(ons('sheet')) === 1 && beats('sheet')[2].gap >= 40],
  ['menu', 'navigation', 0, 'a menu: a quick flutter of three light ticks', () => ps('menu') === 'TICK,TICK,TICK' && beats('menu').slice(1).every((b) => b.gap <= 20) && ons('menu').length === 3],
  ['dismiss', 'navigation', 0, 'put away: a soft knock that fades', () => ps('dismiss') === 'LOW_TICK,QUICK_FALL' && desc(sc('dismiss')) && desc(ons('dismiss'))],
  ['swipe', 'navigation', 0, 'flicked away: a fall that trails off, each beat softer', () => ps('swipe') === 'QUICK_FALL,LOW_TICK,LOW_TICK' && desc(sc('swipe')) && desc(ons('swipe'))],
  ['save', 'feedback', 2, 'saved: a latch, a click and then a firmer one with its body', () => ps('save') === 'CLICK,CLICK,LOW_TICK' && sc('save')[1] > sc('save')[0] && ons('save')[1] > ons('save')[0]],
  ['copy', 'feedback', 2, 'copied: two beats the same', () => ps('copy') === 'CLICK,CLICK' && sc('copy')[0] === sc('copy')[1] && ons('copy').length === 2 && ons('copy')[0] === ons('copy')[1]],
  ['send', 'feedback', 2, 'sent: a tap, then a softer whirr away', () => ps('send') === 'CLICK,SPIN' && desc(sc('send')) && ons('send')[0] === Math.max(...ons('send'))],
  ['remove', 'feedback', 2, 'removed: a thump swept away, fading', () => ps('remove') === 'THUD,QUICK_FALL,LOW_TICK' && desc(ons('remove'))],
  ['refresh', 'feedback', 2, 'refreshed: a whirr that clicks home', () => ps('refresh') === 'SPIN,CLICK' && loudest(sc('refresh')) === 1 && loudest(ons('refresh')) === ons('refresh').length - 1],
  ['scan', 'feedback', 2, 'a code read: a click that rings out', () => ps('scan') === 'CLICK,TICK,TICK' && desc(sc('scan')) && desc(ons('scan'))],
  ['start', 'workout', 2, 'a workout starting: a swell into a firm beat, and an echo', () => ps('start') === 'SLOW_RISE,CLICK,TICK' && loudest(sc('start')) === 1 && loudest(ons('start')) === ons('start').length - 2],
  ['cancel', 'workout', 2, 'a workout cancelled: it powers down, each beat softer', () => ps('cancel') === 'CLICK,QUICK_FALL,LOW_TICK,LOW_TICK' && desc(sc('cancel')) && desc(ons('cancel'))],
  ['skip', 'workout', 2, 'skipped: two quick flicks forward, the same twice', () => ps('skip') === 'QUICK_RISE,TICK,QUICK_RISE,TICK' && same(sc('skip').slice(0, 2), sc('skip').slice(2)) && ons('skip').length === 4],
  ['extend', 'workout', 2, 'more rest: four even notches', () => ps('extend') === 'LOW_TICK,LOW_TICK,LOW_TICK,LOW_TICK' && new Set(sc('extend')).size === 1 && ons('extend').length === 4 && new Set(ons('extend')).size === 1],
  ['swap', 'workout', 2, 'a swap: one fades out, the next comes in to a click', () => ps('swap') === 'QUICK_FALL,QUICK_RISE,CLICK' && loudest(sc('swap')) === 2],
];
const groupOf = (k) => (groups.find((g) => g[5].some(([x]) => x === k)) || [])[0];
for (const [k, g, rank, feel, ok] of SPECIFIC) {
  const there = kinds.includes(k) && !!javaKinds[k];
  check(`${k}, in ${g} at rank ${rank}: ${feel}`, there && groupOf(k) === g && P.hapticRank(k) === rank && javaKinds[k].ui === (rank === 0) && ok(), there ? { group: groupOf(k), rank: P.hapticRank(k), comp: ps(k), scales: sc(k), web: P.hapticPattern(k, 'medium') } : 'missing');
}
const harsh = SPECIFIC.map(([k]) => k).filter((k) => javaKinds[k] && (sc(k).filter((x) => x >= 1).length > 1 || beats(k).some((b) => (b.p === 'THUD' || b.p === 'SPIN') && b.scale > 0.6)));
check('none of them is harsh: one full-strength beat at most, and no thud or spin above 0.6', !harsh.length, harsh);
const unused = SPECIFIC.map(([k]) => k).filter((k) => !used.has(k) && !marked.has(k));
check('each is played somewhere in the app', !unused.length, unused);

section('In a browser');
const buzzes = [];
const activation = { hasBeenActive: true };
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => { buzzes.push(p); return true; }, userActivation: activation }, configurable: true, writable: true });
P.setPrefs({ haptics: true, vibrate: true, sound: false, hapticStrength: 'strong' });
later(); P.haptic('success');
check('a haptic plays its pattern at the chosen strength', same(buzzes.pop(), P.hapticPattern('success', 'strong')));
P.setPrefs({ hapticStrength: 'light' });
later(); P.haptic('success');
check('shorter at Light', same(buzzes.pop(), P.hapticPattern('success', 'light')));
later(); P.cue('done');
check('a timer cue is the plain buzz (the Vibration switch)', same(buzzes.pop(), [140, 90, 220]));
activation.hasBeenActive = false;
later(); P.haptic('tap');
check('nothing before the page has been touched', buzzes.length === 0);
activation.hasBeenActive = true;

section('In the app');
const played = [];
const alarms = [];
const at = [];
globalThis.AndroidBridge = { haptic: (k) => { played.push(k); at.push(now); }, vibratePattern: (j) => alarms.push(JSON.parse(j)) };
const run = (fn) => { played.length = 0; alarms.length = 0; at.length = 0; later(); const t0 = now; fn(); later(2000); at.forEach((x, i) => { at[i] = x - t0; }); return played.join(); };
P.setPrefs({ hapticStrength: 'medium' });
check('the bridge plays it by name, with no browser buzz', run(() => P.haptic('warning')) === 'warning' && buzzes.length === 0);
check('an unknown name plays a tap', run(() => P.haptic('bogus')) === 'tap' && run(() => P.haptic('constructor')) === 'tap');
check('a moment reported twice plays once', run(() => { P.haptic('success'); later(20); P.haptic('success'); }) === 'success');
check('ticks don\'t stack', run(() => { P.haptic('tick'); later(10); P.haptic('tick'); later(10); P.haptic('select'); later(40); P.haptic('tick'); }) === 'tick,tick');
check('nor does a press right after a tick', run(() => { P.haptic('tick'); later(20); P.haptic('press'); later(40); P.haptic('press'); }) === 'tick,press');
check('a tap or a smaller event waits out celebrate', run(() => { P.haptic('celebrate'); later(100); P.haptic('tap'); P.haptic('success'); later(1000); P.haptic('tap'); }) === 'celebrate,tap');
check('a countdown tick waits out a done', run(() => { P.haptic('done'); later(150); P.haptic('countdown'); later(1000); P.haptic('countdown'); }) === 'done,countdown');
check('a bigger event does cut in', run(() => { P.haptic('success'); later(50); P.haptic('error'); }) === 'success,error' && at[1] === 50);
check('the same rank cuts in for the UI: a tap right after a toggle', run(() => { P.haptic('toggleOn'); later(10); P.haptic('tap'); }) === 'toggleOn,tap' && at[1] === 10);
{
  const r = run(() => { P.haptic('success'); later(10); P.haptic('log'); });
  check('and waits its turn for an event: a log after a success, once the success is over', r === 'success,log' && at[1] >= P.hapticMs('success') + 20, { r, at });
}
check('one place in the queue, and the newest waits', run(() => { P.haptic('success'); later(10); P.haptic('log'); later(10); P.haptic('undo'); }) === 'success,undo');
check('the Haptic feedback switch turns every kind off', run(() => { P.setPrefs({ haptics: false }); for (const k of kinds) { later(1000); P.haptic(k); } P.setPrefs({ haptics: true }); }) === '');
check('and a haptic waiting its turn with it', run(() => { P.haptic('success'); later(10); P.haptic('log'); P.setPrefs({ haptics: false }); later(500); P.setPrefs({ haptics: true }); }) === 'success');

section('A toast after its action');
const toast = (k) => P.haptic(k, { consequence: true });
check('a toggle then its toast\'s success: the toggle keeps its feel', run(() => { P.haptic('toggleOn'); later(30); toast('success'); }) === 'toggleOn');
check('a quick log then its toast: one log', run(() => { P.haptic('log'); later(15); toast('success'); }) === 'log');
check('a success long after the action is its own moment', run(() => { P.haptic('toggleOn'); later(250); toast('success'); }) === 'toggleOn,success');
check('a toast on its own plays at once', run(() => toast('success')) === 'success' && at[0] === 0);
{
  const r = run(() => { P.haptic('toggleOn'); later(10); toast('warning'); });
  check('a toggle then a warning: the toggle plays whole, the warning 20 ms after it ends', r === 'toggleOn,warning' && at[1] === P.hapticMs('toggleOn') + 20, { r, at });
}
check('an error after a set waits for it too', run(() => { P.haptic('setDone'); later(5); toast('error'); }) === 'setDone,error' && at[1] === P.hapticMs('setDone') + 20);
check('a refusal says so once: a deny then its toast\'s warning', run(() => { P.haptic('deny'); later(20); toast('warning'); }) === 'deny');
check('but an error after a deny still comes, after it', run(() => { P.haptic('deny'); later(20); toast('error'); }) === 'deny,error' && at[1] === P.hapticMs('deny') + 20);
check('a warning waiting its turn gives way to a bigger event meanwhile', run(() => { P.haptic('toggleOn'); later(5); toast('warning'); later(10); P.haptic('workoutDone'); }) === 'toggleOn,workoutDone');
check('the gallery plays one at once over anything', run(() => { P.haptic('celebrate'); later(10); P.haptic('tap', { force: true }); }) === 'celebrate,tap' && at[1] === 10);

section('Player cues in the app');
check('with haptics on, each cue buzzes as its own haptic', run(() => { P.cue('countdown'); later(1000); P.cue('go'); later(); P.cue('done'); }) === 'countdown,go,done' && alarms.length === 0, { played, alarms });
check('a cue can carry its moment\'s own haptic (an activity\'s start), and an unknown one is the cue\'s', run(() => P.cue('go', 'actGo')) === 'actGo' && run(() => P.cue('go', 'nope')) === 'go' && alarms.length === 0);
check('\'tick\', the old name, is the countdown', run(() => P.cue('tick')) === 'countdown');
globalThis.__gh.onPause();
check('out of sight (only alarm-class buzzes get through), the plain buzzes', run(() => { P.cue('countdown'); later(); P.cue('done'); }) === '' && same(alarms, [[0, 35], [0, 140, 90, 220]]), { played, alarms });
globalThis.__gh.onResume();
check('and the haptics again once back', run(() => P.cue('done')) === 'done' && alarms.length === 0);
P.setPrefs({ haptics: false });
check('with haptics off, the plain alarm-class buzzes', run(() => { P.cue('countdown'); later(); P.cue('done'); }) === '' && same(alarms, [[0, 35], [0, 140, 90, 220]]), alarms);
P.setPrefs({ haptics: true, vibrate: false });
check('with Vibration off, no buzz of either kind', run(() => { P.cue('countdown'); later(); P.cue('done'); }) === '' && alarms.length === 0);

done();
