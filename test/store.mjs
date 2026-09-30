// Persistence: local and file copies (newer wins), empty and broken storage, backups without the
// AI key, restore validation, and resuming a workout after a reload.
import { load, check, section, done } from './lib.mjs';

// A fake browser: localStorage plus the Android bridge's file and secret store.
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
const file = { state: '', secrets: {} };
globalThis.AndroidBridge = {
  save: (s) => { file.state = s; return true; }, load: () => file.state,
  saveSecret: (k, v) => { file.secrets[k] = v; return true; }, loadSecret: (k) => file.secrets[k] || '', deleteSecret: (k) => { delete file.secrets[k]; return true; },
};
const GH = load('src/data/moves.js', 'src/data/moves-access.js', 'src/engine/pose.js', 'src/brain.js', 'src/store.js');
const B = GH.brain;
const store = GH.store;
const D0 = B.dayFromStr('2026-09-28');
const P = { goals: ['abs', 'arms'], equipment: { db: [8], kb: [10] }, weightKg: 67.5, lead: { arm: 'L' } };

section('Empty and broken storage');
check('first run: nothing stored → null', store.load() === null);
ls.set(store.KEY, '{not json');
file.state = '';
check('a corrupt copy is ignored', store.load() === null);
const saved = globalThis.localStorage;
globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
const S0 = B.newState(P, null, D0);
check('storage that throws (private mode) never breaks saving', store.save(S0) === true && store.load() !== null);
globalThis.localStorage = saved;

section('Two copies, newer wins');
ls.clear(); file.state = '';
const S = B.newState(P, { curlL: 14, curlR: 18 }, D0);
store.save(S);
check('saved to both localStorage and the app file', ls.has(store.KEY) && file.state.length > 100);
const a = JSON.parse(ls.get(store.KEY));
a.updatedAt += 60000; a.profile.minutes = 40;
file.state = JSON.stringify(a);
check('the newer app-file copy wins', store.load().profile.minutes === 40);
ls.set(store.KEY, JSON.stringify(Object.assign(JSON.parse(file.state), { updatedAt: a.updatedAt + 1, profile: Object.assign({}, a.profile, { minutes: 15 }) })));
check('the newer local copy wins', store.load().profile.minutes === 15);
file.state = '{"half":';
check('a broken app file falls back to the local copy', store.load().profile.minutes === 15);

section('Migration');
const old = JSON.parse(JSON.stringify(S));
delete old.health; delete old.ai; delete old.insightsDismissed; delete old.profile.prefs.rollHour;
const m = store.migrate(old);
check('missing parts are filled in', m.health && m.health.days && m.health.hc && m.health.manual && m.ai && Array.isArray(m.ai.reports) && m.insightsDismissed && m.profile.prefs.rollHour === 4);

section('The AI key never lands in the state or a backup');
store.saveSecret('anthropic_api_key', 'fakekey-test-0123456789abcdefghij');
check('the key lives in the app\'s private preferences', file.secrets.anthropic_api_key === 'fakekey-test-0123456789abcdefghij' && !ls.has('gh.secret.anthropic_api_key'));
S.ai.apiKey = 'fakekey-stray-0123456789'; // even if something put one there by mistake
store.save(S);
const exported = store.exportJson(S);
check('not in the saved state', !/fakekey/.test(ls.get(store.KEY)) && !/fakekey/.test(file.state));
check('not in Copy my data', !/fakekey/.test(exported));
check('loadSecret reads it back', store.loadSecret('anthropic_api_key') === 'fakekey-test-0123456789abcdefghij');
store.deleteSecret('anthropic_api_key');
check('delete removes it', store.loadSecret('anthropic_api_key') === '');

section('Restore');
check('rejects text that isn\'t a backup', !store.importJson('hello').ok && !store.importJson('{"a":1}').ok);
const newer = JSON.parse(exported); newer.schema = 99;
check('rejects a backup from a newer version', !store.importJson(JSON.stringify(newer)).ok);
const r = store.importJson(exported);
check('accepts Copy my data and summarizes it', r.ok && r.state.profile.goals.join() === 'abs,arms' && r.workouts === 0 && r.since === D0);
check('a bare state (older backups) also restores', store.importJson(JSON.stringify(S)).ok);

section('Resuming a workout after a reload');
const W = B.newState(P, null, D0);
B.startWorkout(W, D0, { now: D0 * B.DAY_MS });
B.completeStep(W, {}); B.completeStep(W, {});
store.save(W);
const back = store.load();
const A = back.active;
const st = A.steps[A.idx];
const pool = A.session.items.concat(A.session.extras, A.session.warmup, A.session.tests, A.session.mobility, A.session.finisher ? [A.session.finisher] : []);
check('steps point at the session\'s own items again (not copies)', A.steps.every((x) => !x.item || pool.includes(x.item)));
let guard = 0;
while (back.active && back.active.idx < back.active.steps.length && guard++ < 200) B.completeStep(back, {});
const res = B.finishWorkout(back, { rating: 'right', now: (D0 + 0.8) * B.DAY_MS });
check('the resumed workout finishes and counts', res && res.done && B.calendar(back, D0).streak.current === 1, st && st.kind);

done();
