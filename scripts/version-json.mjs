// version.json, what the app's own update check reads (Updater.java, src/update.js) from the GitHub
// release tagged "latest": this build's versionName and versionCode, the APK's name, size and SHA-256
// (the phone checks the download against them), and What's new in the store's words (the version's
// store text in src/data/changelog.js, as `node scripts/release-notes.mjs --store` prints it). CI's
// release job writes it next to the APK and publishes them together.
//
//   node scripts/version-json.mjs build/gradient-health.apk build/version.json
//
// The version is read from the APK itself (`aapt dump badging`; CI's runner has aapt), so the file can't
// describe another build, and VERSION_CODE, when it's set (as CI sets it), has to be the APK's.
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entry } from './release-notes.mjs';

export const PACKAGE = 'com.shadowsdistant.gradienthealth';
export const MAX_APK_BYTES = 150 * 1024 * 1024; // Updater.java won't download more

// What aapt says an APK is: { name, versionCode, versionName }, or null.
export function parseBadging(text) {
  const m = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(String(text || ''));
  return m ? { name: m[1], versionCode: Number(m[2]), versionName: m[3] } : null;
}

export function sha256File(file) {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

// version.json for the APK at `file`, with the limits the app holds it to (Updater.Release.from).
export function versionJson({ file, versionName, versionCode, notes }) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(String(versionName))) throw new Error(`versionName '${versionName}' isn't one the app reads`);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error(`versionCode ${versionCode} isn't one the app reads`);
  const name = basename(file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.apk$/.test(name)) throw new Error(`${name} isn't an APK name the app reads`);
  const size = statSync(file).size;
  if (!(size > 0 && size <= MAX_APK_BYTES)) throw new Error(`${file} is ${size} bytes; the app downloads 150 MB at most`);
  if (typeof notes !== 'string' || !notes.trim()) throw new Error(`${versionName} has no store text for What's new`);
  return { versionName, versionCode, apk: { name, size, sha256: sha256File(file) }, notes: notes.trim() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [apk, out] = process.argv.slice(2);
  try {
    if (!apk || !out) throw new Error('usage: node scripts/version-json.mjs <the APK> <version.json to write>');
    let badging;
    try {
      badging = parseBadging(execFileSync('aapt', ['dump', 'badging', apk], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      throw new Error(`aapt couldn't read ${apk}: ${String(e.stderr || e.message).trim()}`);
    }
    if (!badging || badging.name !== PACKAGE) throw new Error(`${apk} isn't ${PACKAGE} (aapt says ${badging ? badging.name : 'nothing'})`);
    if (process.env.VERSION_CODE && Number(process.env.VERSION_CODE) !== badging.versionCode) {
      throw new Error(`${apk} has versionCode ${badging.versionCode}, not VERSION_CODE ${process.env.VERSION_CODE}`);
    }
    const json = versionJson({ file: apk, versionName: badging.versionName, versionCode: badging.versionCode, notes: entry(badging.versionName).store });
    writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`${out}: ${json.versionName} (${json.versionCode}), ${json.apk.name} ${json.apk.size} bytes, sha256 ${json.apk.sha256}`);
  } catch (err) {
    console.error(`version-json: ${err.message}`);
    process.exit(1);
  }
}
