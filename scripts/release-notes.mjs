// Release notes from the changelog (src/data/changelog.js): What's new in a version, as Markdown for
// the GitHub release CI publishes, with the entry's short store text folded underneath, ready to
// paste into a store's What's new field.
//
//   node scripts/release-notes.mjs                   the release notes for package.json's version
//   node scripts/release-notes.mjs --store           only the store text, as plain text
//   node scripts/release-notes.mjs --version 1.4.0   another version
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Google Play's limit for What's new. APKPure doesn't publish one, so the same text fits both.
export const STORE_MAX = 500;

export const version = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

export function changelog() {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(root, 'src/data/changelog.js'), 'utf8'), ctx);
  return ctx.GH.CHANGELOG;
}

export function entry(v = version()) {
  const e = changelog().find((x) => x.version === v);
  if (!e) throw new Error(`src/data/changelog.js has no entry for ${v}`);
  return e;
}

export function markdown(e) {
  const lines = [`## What's new in ${e.version}`, '', `**${e.title}**`, '', ...e.items.map(([, text]) => `- ${text}`)];
  if (e.store) lines.push('', '<details><summary>Short version, for a store\'s What\'s new field</summary>', '', '```text', e.store, '```', '', '</details>');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--version');
  try {
    const e = entry(at >= 0 ? args[at + 1] : version());
    if (!args.includes('--store')) console.log(markdown(e));
    else if (e.store) console.log(e.store);
    else throw new Error(`${e.version} has no store text in src/data/changelog.js`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
