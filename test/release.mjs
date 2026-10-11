// Release notes: the changelog has an entry for package.json's version with a store text that fits
// a store's What's new field, and scripts/release-notes.mjs turns it into the notes CI publishes
// with each GitHub release.
// Usage: node test/release.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root, check, section, done } from './lib.mjs';
import { changelog, entry, markdown, version, STORE_MAX } from '../scripts/release-notes.mjs';

const script = join(root, 'scripts/release-notes.mjs');
const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' });
const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let k = 0; k < 3; k++) if (pa[k] !== pb[k]) return pa[k] - pb[k];
  return 0;
};

section('Changelog');
const list = changelog();
const v = version();
check('the newest entry is the version in package.json', list[0] && list[0].version === v, { newest: list[0] && list[0].version, package: v });
check('versions go newest first, each once', list.every((e, i) => i === 0 || cmp(list[i - 1].version, e.version) > 0), list.map((e) => e.version));
check('every entry has a date, a title and items', list.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title && e.items.length && e.items.every(([icon, text]) => icon && text)));
const e = entry();
check(`this version's store text fits ${STORE_MAX} characters`, typeof e.store === 'string' && e.store.length > 0 && e.store.length <= STORE_MAX, e.store ? e.store.length : 'none');
check('the store text is plain (no Markdown)', e.store && !/[*_`#[\]<>]/.test(e.store), e.store);

section('Release notes');
const md = markdown(e);
check('the notes have the heading, the title and every item', md.startsWith(`## What's new in ${v}\n`) && md.includes(`**${e.title}**`) && e.items.every(([, text]) => md.includes(`\n- ${text}`)));
check('the store text sits in a block that can be copied', md.includes('```text\n' + e.store + '\n```'));
check('the script prints the notes', run().trim() === md.trim());
check('--store prints the store text alone', run('--store').trim() === e.store.trim());
check('--version picks another entry', run('--version', list[1].version).startsWith(`## What's new in ${list[1].version}\n`));
let failed = false;
try { run('--version', '0.0.1'); } catch (err) { failed = /no entry for 0\.0\.1/.test(String(err.stderr)); }
check('a version with no entry fails and says why', failed);

section('Store listing');
// docs/store/LISTING.md: the short description is the app's line (it held two releases' What's new
// before this check: 1.8.4 and 1.8.5 pasted theirs into the first block), and the What's new block is
// this version's store text.
const listing = readFileSync(join(root, 'docs/store/LISTING.md'), 'utf8');
const block = (heading) => { const m = new RegExp(`## ${heading}[^\\n]*\\n[\\s\\S]*?\\\`\\\`\\\`text\\n([\\s\\S]*?)\\n\\\`\\\`\\\``).exec(listing); return m ? m[1] : null; };
const short = block('Short description');
check('the short description is one line of 80 characters at most', !!short && !short.includes('\n') && short.length <= 80, short);
const full = block('Full description');
check('the full description is 4,000 characters at most', !!full && full.length <= 4000, full && full.length);
const news = block('What\'s new');
check(`the What's new block is ${v}'s store text`, news === e.store && listing.includes(`This is ${v}'s.`), news);
const ci = readFileSync(join(root, '.github/workflows/android.yml'), 'utf8');
check('CI publishes the release with these notes', /node scripts\/release-notes\.mjs/.test(ci) && /--notes-file/.test(ci));

done();
