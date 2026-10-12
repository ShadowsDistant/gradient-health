// Updates, the page's rules (src/update.js): versions compared, what the latest build is to this
// install, the automatic check (once a day at most, an hour after one that failed, never before
// set-up or during a workout or an activity, and only in the Android app), Today's card and Not now,
// What's new as a list, Settings' line for each state, a step's end kept for the next check, and that
// every reason Updater.java can give has plain words here. Then version.json as CI writes it
// (scripts/version-json.mjs), held to the limits Updater.java reads it with.
// Usage: node test/update.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { load, root, check, section, done } from './lib.mjs';
import { parseBadging, versionJson, MAX_APK_BYTES } from '../scripts/version-json.mjs';
import { entry } from '../scripts/release-notes.mjs';

// What this phone chose (the switch, the last check, a card put away) is kept in localStorage.
const kept = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); }, removeItem: (k) => { kept.delete(k); } } });
const GH = load('src/update.js');
const UP = GH.update;
const U = GH.ui;
const java = readFileSync(join(root, 'android/src/com/shadowsdistant/gradienthealth/Updater.java'), 'utf8');
const NOW = Date.UTC(2026, 9, 19, 12, 0);
const DAY = 864e5, HOUR = 36e5;
const INSTALLED = { versionName: '1.10.1', versionCode: 29862713 };

section('Versions');
{
  const c = UP.compare;
  check('1.11.0 is newer than 1.10.2, and 1.10.10 than 1.10.9', c('1.11.0', '1.10.2') > 0 && c('1.10.10', '1.10.9') > 0 && c('1.10.2', '1.11.0') < 0);
  check('the same version is the same (1.10 and 1.10.0 too)', c('1.10.1', '1.10.1') === 0 && c('1.10', '1.10.0') === 0);
  check('2.0 is newer than 1.99.99', c('2.0', '1.99.99') > 0);
  const k = (name, code) => UP.kind(INSTALLED, { versionName: name, versionCode: code });
  check('a higher versionCode with a newer name is a new version', k('1.11.1', INSTALLED.versionCode + 900) === 'version');
  check('a higher versionCode with the same name is a newer build of it', k('1.10.1', INSTALLED.versionCode + 5) === 'build');
  check('nothing newer: the same or a lower versionCode, whatever the name says', k('1.11.1', INSTALLED.versionCode) === 'none' && k('1.11.1', INSTALLED.versionCode - 1) === 'none' && UP.kind(INSTALLED, null) === 'none' && UP.kind(null, { versionName: '9', versionCode: 9e9 }) === 'none');
}

section('The automatic check: once a day at most');
{
  const due = (p) => UP.due(Object.assign({ auto: true, at: 0, failedAt: 0 }, p), NOW);
  check('on and never checked: due', due({}) === true);
  check('switched off: never', due({ auto: false }) === false);
  check('not asked yet: never (the app sends nothing anywhere new without asking)', due({ auto: null }) === false && due({ auto: undefined }) === false);
  check('23 hours after the last check: not yet; 24 hours: due', due({ at: NOW - 23 * HOUR }) === false && due({ at: NOW - DAY }) === true);
  check('half an hour after one that failed: not yet; an hour: due', due({ failedAt: NOW - HOUR / 2 }) === false && due({ failedAt: NOW - HOUR }) === true);
  check('a check stamped two days ahead (the clock was put back) doesn\'t hold it off', due({ at: NOW + 2 * DAY }) === true);
  check('it waits a few seconds after the app opens or comes back', UP.AUTO_DELAY >= 3000 && UP.AUTO_DELAY <= 10000, UP.AUTO_DELAY);
}

section('Today\'s card, and Not now');
{
  const st = (name, code) => ({ phase: 'available', installed: INSTALLED, latest: { versionName: name, versionCode: code, size: 4.8e7, notes: '' } });
  check('a new version that wasn\'t put away: the card shows', UP.card({ dismissed: '' }, st('1.11.1', INSTALLED.versionCode + 900)) === true);
  check('Not now on 1.11.1: not for 1.11.1 again', UP.card({ dismissed: '1.11.1' }, st('1.11.1', INSTALLED.versionCode + 900)) === false);
  check('but 1.11.2 brings it back', UP.card({ dismissed: '1.11.1' }, st('1.11.2', INSTALLED.versionCode + 2000)) === true);
  check('a newer build of the same version has no card (Settings still offers it)', UP.card({}, st('1.10.1', INSTALLED.versionCode + 5)) === false);
  check('nothing newer, nothing known: no card', UP.card({}, st('1.10.1', INSTALLED.versionCode)) === false && UP.card({}, { phase: 'idle' }) === false);
}

section('What\'s new, as a short list');
{
  const store = entry().store;
  const list = UP.notesList(store);
  check(`this version's store text is ${store.split('\n').length} items, without their bullets`, list.length === store.split('\n').length && list.every((x) => x && !/^[•*-]/.test(x) && store.includes(x)), list);
  check('blank lines go, and twelve items at most', UP.notesList('• a\n\n- b\n* c').join('|') === 'a|b|c' && UP.notesList(Array.from({ length: 20 }, (_, i) => `• ${i}`).join('\n')).length === 12 && UP.notesList('').length === 0);
  check('sizes the way the sheet says them', UP.mb(46 * 1048576) === '46\u00a0MB' && UP.mb(838861) === '0.8\u00a0MB' && UP.mb(12.4 * 1048576) === '12\u00a0MB', [UP.mb(46 * 1048576), UP.mb(838861), UP.mb(12.4 * 1048576)]);
}

section('Settings\' line for each state');
{
  const L = { versionName: '1.11.1', versionCode: INSTALLED.versionCode + 900, size: 4.8e7, notes: '' };
  const v = (s) => UP.rowView(Object.assign({ installed: INSTALLED }, s), NOW);
  const r = {
    idle: v({ phase: 'idle' }),
    checking: v({ phase: 'checking' }),
    current: v({ phase: 'current', checkedAt: NOW - HOUR, latest: Object.assign({}, L, { versionCode: INSTALLED.versionCode }) }),
    stale: v({ phase: 'current', checkedAt: NOW - 3 * DAY }),
    available: v({ phase: 'available', latest: L }),
    build: v({ phase: 'available', latest: Object.assign({}, L, { versionName: '1.10.1' }) }),
    downloading: v({ phase: 'downloading', latest: L, loaded: 45, total: 100 }),
    ready: v({ phase: 'ready', latest: L }),
    aborted: v({ phase: 'ready', step: 'install', error: 'aborted', latest: L }),
    offline: v({ phase: 'failed', step: 'check', error: 'offline' }),
    offlineKnown: v({ phase: 'failed', step: 'check', error: 'offline', latest: L }),
    stopped: v({ phase: 'failed', step: 'download', error: 'network', latest: L }),
  };
  check('nothing checked yet: the version, and a tap checks', r.idle.line === 'Version 1.10.1' && r.idle.act === 'updateCheck', r.idle);
  check('checking: says so, with a spinner', /checking/.test(r.checking.line) && r.checking.spin, r.checking);
  check('up to date: says so; checked days ago: says when', r.current.line === 'Version 1.10.1 · you\'re up to date' && r.stale.line === 'Version 1.10.1 · checked 3 days ago', [r.current.line, r.stale.line]);
  check('"1.11.1 is ready" with Update, which opens the sheet', r.available.line === '1.11.1 is ready · you have 1.10.1' && r.available.btn === 'Update' && r.available.act === 'updateOpen', r.available);
  check('a newer build of the same version, offered as such', r.build.line === 'A newer build of 1.10.1 is ready' && r.build.btn === 'Update', r.build);
  check('downloading: how far along', r.downloading.line === 'Downloading 1.11.1 · 45%' && r.downloading.act === 'updateOpen', r.downloading);
  check('downloaded: Install; not installed after all: says that too', r.ready.btn === 'Install' && r.ready.line === '1.11.1 is downloaded' && /not installed yet/.test(r.aborted.line), [r.ready, r.aborted]);
  check('a check that failed: a short reason, and a tap tries again', r.offline.line === 'Version 1.10.1 · couldn\'t check: you\'re offline' && r.offline.act === 'updateCheck', r.offline);
  check('one that failed while a newer version is known still offers it', r.offlineKnown.btn === 'Update', r.offlineKnown);
  check('a download that stopped opens the sheet to try again', /the download stopped/.test(r.stopped.line) && r.stopped.act === 'updateOpen', r.stopped);
}

section('Every reason Updater.java gives, in plain words');
{
  const codes = new Set();
  for (const m of java.matchAll(/new Failure\("(\w+)"/g)) codes.add(m[1]);
  for (const m of java.matchAll(/end\("\w+", "\w+", "\w+", "(\w+)"\)/g)) codes.add(m[1]);
  const installError = java.slice(java.indexOf('static String installError('), java.indexOf('static String installError(') + 1200);
  for (const m of installError.matchAll(/return "(\w+)";/g)) codes.add(m[1]);
  codes.delete('cancelled'); // not an error: the person stopped it
  const missing = [...codes].filter((c) => !UP.WHY[c]);
  check(`each of Updater.java's ${codes.size} reasons has its words (${[...codes].join(', ')})`, codes.size >= 20 && missing.length === 0, missing);
  const checkBody = java.slice(java.indexOf('private Release fetchRelease('), java.indexOf('private HttpURLConnection open('));
  const checkCodes = new Set([...checkBody.matchAll(/(?:new Failure\(|\? |: )"(\w+)"/g)].map((m) => m[1]).concat(['toobig', 'http']));
  const noShort = [...checkCodes].filter((c) => !UP.SHORT[c]);
  check('and each reason a check can fail for has a short one for Settings', noShort.length === 0, noShort);
  check('each reason updates don\'t check here says where they come from', ['store', 'play', 'key', 'app', 'web'].every((w) => UP.WHERE[w]) && ['store', 'play', 'key'].every((w) => java.includes(`return "${w}";`)));
  const src = readFileSync(join(root, 'src/update.js'), 'utf8');
  const words = [...Object.values(UP.WHY), ...Object.values(UP.SHORT), ...Object.values(UP.WHERE)];
  const bad = words.filter((w) => /[–—‘’“”]|\b(crucial|seamless|robust|leverage|delve|elevate|enhance)/i.test(w) || /\bnot\b[^.]*\bbut\b/i.test(w));
  check('plain words: no long dashes, curly quotes or stock words, in the messages or anywhere in src/update.js', bad.length === 0 && !/[–—‘’“”]|\b(crucial|seamless|robust|leverage|delve|elevate|enhance)\b/i.test(src), bad);
}

section('In a browser, or an app without the updater: nothing checks');
{
  delete globalThis.AndroidBridge;
  U.S = { profile: { onboarded: true } };
  check('a browser: no update support, updates come from where the app was installed', UP.support().ok === false && UP.support().why === 'web' && UP.autoOk(NOW) === false);
  globalThis.AndroidBridge = { haptic() {} };
  check('a bridge without the update methods: the same', UP.support().why === 'app' && UP.autoOk(NOW) === false);
}

section('The automatic check: never before set-up, during a workout or an activity');
{
  let state = { phase: 'idle', installed: INSTALLED };
  globalThis.AndroidBridge = { updateSupport: () => '{"ok":true,"canInstall":true}', updateState: () => JSON.stringify(state), updateCheck: () => true };
  kept.clear();
  check('the phone, set up, nothing going on, not asked yet: no check', UP.support().ok === true && UP.prefs().auto === null && UP.autoOk(NOW) === false);
  localStorage.setItem(UP.KEY, JSON.stringify({ auto: true }));
  check('once the person said yes: it checks', UP.support().ok === true && UP.autoOk(NOW) === true);
  U.S = { profile: { onboarded: true }, active: { day: 1 } };
  check('not during a workout', UP.autoOk(NOW) === false);
  U.S = { profile: { onboarded: true }, actLive: { id: 'a1' } };
  check('not while an activity records', UP.autoOk(NOW) === false);
  U.S = { profile: { onboarded: false } };
  check('not before set-up', UP.autoOk(NOW) === false);
  U.S = { profile: { onboarded: true } };
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'downloading', installed: INSTALLED, loaded: 1, total: 9 }));
  check('not while a download runs', UP.autoOk(NOW) === false);
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'confirm', installed: INSTALLED }));
  check('nor while Android\'s install screen is up', UP.autoOk(NOW) === false);
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'ready', installed: INSTALLED }));
  check('but with a download waiting to be installed, yes (a newer version replaces it)', UP.autoOk(NOW) === true);
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'idle', installed: INSTALLED }));
  localStorage.setItem(UP.KEY, JSON.stringify({ auto: false }));
  check('not with Check automatically off', UP.prefs().auto === false && UP.autoOk(NOW) === false);
  kept.clear();
  check('off until the person is asked', UP.prefs().auto === null);
}

section('A step\'s end is kept for the next automatic check');
{
  const on = () => localStorage.setItem(UP.KEY, JSON.stringify({ auto: true }));
  on();
  const t0 = Date.now();
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'current', done: 'check', installed: INSTALLED, checkedAt: t0 }));
  const a = UP.prefs();
  check('a check that worked: the next one is a day away', a.auto === true && a.at >= t0 && a.failedAt === 0 && UP.due(a, Date.now()) === false && UP.due(a, Date.now() + DAY) === true, a);
  on();
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'failed', step: 'check', error: 'offline', done: 'check', installed: INSTALLED }));
  const b = UP.prefs();
  check('one that failed: an hour away', b.failedAt >= t0 && !b.at && UP.due(b, Date.now()) === false && UP.due(b, Date.now() + HOUR) === true, b);
  on();
  globalThis.__gh.onUpdate(JSON.stringify({ phase: 'ready', done: 'download', installed: INSTALLED, latest: { versionName: '1.11.1', versionCode: INSTALLED.versionCode + 9, size: 9, notes: '' } }));
  check('a download read version.json first: that counts as a check', UP.prefs().at >= t0);
  localStorage.setItem(UP.KEY, '{"auto":"yes","at":"soon","failedAt":-5,"dismissed":{"x":1}}');
  const junk = UP.prefs();
  check('what\'s kept is read safely (junk becomes the defaults)', junk.auto === null && junk.at === 0 && junk.failedAt === 0 && junk.dismissed === '', junk);
}

section('version.json, as CI writes it');
{
  const b = parseBadging("package: name='com.shadowsdistant.gradienthealth' versionCode='29862713' versionName='1.10.1' platformBuildVersionName='14' compileSdkVersion='34'\nsdkVersion:'26'");
  check('aapt\'s line is read: the package, versionCode and versionName', b && b.name === 'com.shadowsdistant.gradienthealth' && b.versionCode === 29862713 && b.versionName === '1.10.1', b);
  check('anything else isn\'t', parseBadging('ERROR: dump failed') === null && parseBadging('') === null);
  const dir = mkdtempSync(join(tmpdir(), 'gh-version-'));
  try {
    const file = join(dir, 'gradient-health.apk');
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256));
    writeFileSync(file, bytes);
    const j = versionJson({ file, versionName: '1.10.1', versionCode: 29862713, notes: `${entry().store}\n` });
    check('the brief\'s shape: versionName, versionCode, the APK\'s name, size and SHA-256, and the notes', JSON.stringify(Object.keys(j)) === '["versionName","versionCode","apk","notes"]' && JSON.stringify(Object.keys(j.apk)) === '["name","size","sha256"]');
    check('the APK\'s size and SHA-256 are the file\'s, and the notes the store text', j.apk.name === 'gradient-health.apk' && j.apk.size === 5000 && j.apk.sha256 === createHash('sha256').update(bytes).digest('hex') && j.notes === entry().store);
    const refuses = (o) => { try { versionJson(Object.assign({ file, versionName: '1.10.1', versionCode: 29862713, notes: 'x' }, o)); return false; } catch (e) { return true; } };
    const other = join(dir, 'app.zip');
    writeFileSync(other, 'x');
    check('it won\'t write one the app would turn down: an odd versionName or versionCode, a file that isn\'t an .apk, no notes', refuses({ versionName: '1.10 beta' }) && refuses({ versionCode: 0 }) && refuses({ versionCode: 2100000001 }) && refuses({ file: other }) && refuses({ notes: ' ' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The same limits as Updater.Release.from, which reads it on the phone.
  const javaPattern = (name) => ((new RegExp(`${name} = Pattern\\.compile\\("([^"]+)"\\)`).exec(java) || [])[1] || '').replace(/\\\\/g, '\\');
  const scriptSrc = readFileSync(join(root, 'scripts/version-json.mjs'), 'utf8');
  check('the same versionName and APK name rules as Updater.java', scriptSrc.includes(`/^${javaPattern('VERSION_NAME')}$/`) && scriptSrc.includes(`/^${javaPattern('APK_NAME')}$/`), [javaPattern('VERSION_NAME'), javaPattern('APK_NAME')]);
  check('the same 150 MB cap, and room for this version\'s store text in the notes', MAX_APK_BYTES === 150 * 1024 * 1024 && /MAX_APK_BYTES = 150L \* 1024 \* 1024;/.test(java) && Number((/MAX_NOTES = (\d+);/.exec(java) || [])[1]) >= entry().store.length);
}

done();
