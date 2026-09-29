// Haptics in platform.js: a browser pattern for every kind (the same kinds as Haptics.java, and every
// haptic('…') in the app names one), never weaker at a stronger setting, and the rules for when two
// meet: a moment reported twice plays once, a smaller haptic can't cut a bigger one short, and a
// player cue's buzz is that moment's haptic in the app with haptics on (the plain alarm-class buzz
// otherwise, and while the app is out of sight).
// Usage: node test/haptics.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, load, check, section, done } from './lib.mjs';

let now = 1e6;
Date.now = () => now;
const later = (ms = 5000) => { now += ms; };
const P = load('src/platform.js').platform;
const kinds = P.hapticKinds;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

section('Kinds');
const java = [...readFileSync(join(root, 'android/src/com/shadowsdistant/gradienthealth/Haptics.java'), 'utf8').matchAll(/put\("(\w+)"/g)].map((m) => m[1]);
check('the browser has the same kinds as Haptics.java', kinds.length >= 14 && same([...kinds].sort(), [...java].sort()), { web: kinds, java });
// haptic('x') and haptic(cond ? 'x' : 'y') everywhere in src/.
const used = new Map();
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { walk(join(dir, f.name)); continue; }
    if (!f.name.endsWith('.js')) continue;
    for (const m of readFileSync(join(dir, f.name), 'utf8').matchAll(/haptic\(([^()]*)\)/g)) {
      const args = m[1].includes('?') ? m[1].slice(m[1].indexOf('?')) : m[1];
      for (const q of args.matchAll(/'(\w+)'/g)) used.set(q[1], f.name);
    }
  }
};
walk(join(root, 'src'));
const unknown = [...used].filter(([k]) => !kinds.includes(k));
check(`every haptic('…') in the app names a kind (${used.size} used)`, used.size >= 10 && !unknown.length, unknown);
const tryIt = [...readFileSync(join(root, 'src/ui/settings.js'), 'utf8').matchAll(/HAPTIC_TRY = \[(.*)\];/g)].flatMap((m) => [...m[1].matchAll(/\['(\w+)',/g)].map((x) => x[1]));
check('the Try it chips play known kinds', tryIt.length === 4 && tryIt.every((k) => kinds.includes(k)), tryIt);

section('Browser patterns');
const on = (p) => p.filter((_, i) => i % 2 === 0);
const total = (p) => on(p).reduce((a, x) => a + x, 0);
for (const k of kinds) {
  const [l, m, s] = ['light', 'medium', 'strong'].map((x) => P.hapticPattern(k, x));
  const shaped = [l, m, s].every((p) => p.length === s.length && p.length % 2 === 1 && p.every((x) => Number.isInteger(x) && x > 0));
  const order = on(s).every((x, i) => x >= on(m)[i] && on(m)[i] >= on(l)[i]);
  check(`${k}: [${s}] at Strong, strong ≥ medium ≥ light`, shaped && order && total(s) > total(l), { l, m, s });
}
check('the pauses stay the same at every strength', kinds.every((k) => same(P.hapticPattern(k, 'light').filter((_, i) => i % 2), P.hapticPattern(k, 'strong').filter((_, i) => i % 2))));
check('an unknown kind is a tap, and no strength is medium', same(P.hapticPattern('nope', 'strong'), P.hapticPattern('tap', 'strong')) && same(P.hapticPattern('success'), P.hapticPattern('success', 'medium')));
check('events are longer than taps', ['success', 'warning', 'error', 'heavy', 'done', 'celebrate'].every((k) => total(P.hapticPattern(k, 'strong')) > total(P.hapticPattern('tap', 'strong'))));

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
globalThis.AndroidBridge = { haptic: (k) => played.push(k), vibratePattern: (j) => alarms.push(JSON.parse(j)) };
const run = (fn) => { played.length = 0; alarms.length = 0; later(); fn(); return played.join(); };
P.setPrefs({ hapticStrength: 'medium' });
check('the bridge plays it by name, with no browser buzz', run(() => P.haptic('warning')) === 'warning' && buzzes.length === 0);
check('an unknown name plays a tap', run(() => P.haptic('bogus')) === 'tap');
check('a moment reported twice plays once', run(() => { P.haptic('success'); later(20); P.haptic('success'); }) === 'success');
check('ticks don\'t stack', run(() => { P.haptic('tick'); later(10); P.haptic('tick'); later(10); P.haptic('select'); later(40); P.haptic('tick'); }) === 'tick,tick');
check('a tap or a smaller event waits out celebrate', run(() => { P.haptic('celebrate'); later(100); P.haptic('tap'); P.haptic('success'); later(1000); P.haptic('tap'); }) === 'celebrate,tap');
check('a countdown tick waits out a done', run(() => { P.haptic('done'); later(150); P.haptic('countdown'); later(1000); P.haptic('countdown'); }) === 'done,countdown');
check('a bigger event does cut in', run(() => { P.haptic('success'); later(50); P.haptic('error'); }) === 'success,error');
check('the Haptic feedback switch turns every kind off', run(() => { P.setPrefs({ haptics: false }); for (const k of kinds) { later(1000); P.haptic(k); } P.setPrefs({ haptics: true }); }) === '');

section('Player cues in the app');
check('with haptics on, each cue buzzes as its own haptic', run(() => { P.cue('countdown'); later(1000); P.cue('go'); later(); P.cue('done'); }) === 'countdown,go,done' && alarms.length === 0, { played, alarms });
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
