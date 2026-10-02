// The built page (dist/gradient-health.html, so run `npm run build` first): its size budget, that
// it's all ASCII, that every inline script compiles and every style sheet parses, that the content
// security policy lists exactly the inline scripts' hashes, that the parts loaded on demand are
// there (the Anthropic SDK among them, and not in the page), and that the marked patches in
// Refract's vendored bundle are well formed.
// Usage: node test/buildcheck.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { root, check, section, done } from './lib.mjs';
import { APP_SCRIPTS, APP_CHUNKS, LAZY, asciiRegexps } from '../scripts/build.mjs';

// The page was 2,551,794 bytes before 1.6.0. The target was 1.6 MB; minifying and moving the
// Anthropic SDK to its own chunk brought it to 1,645,383 bytes (inline JS is most of it, and
// keepNames costs about 30 KB). 1.6.0's own features then add their code (the plan optimizer is
// about 80 KB), so while 1.6.0 is put together the budget is a ceiling that still catches an asset
// inlined by mistake; it's set to the finished page plus 5% at the release. With the plan review,
// the motion and the new set-up merged the page passed 1.95 MB, so the ceiling is 2.1 MB until the
// speed pass moves what the first screen doesn't need into chunks of their own.
const BUDGET = 2100000;

const file = join(root, 'dist/gradient-health.html');
if (!existsSync(file)) { console.error('No dist/gradient-health.html: run npm run build first.'); process.exit(1); }
const html = readFileSync(file, 'utf8');
const bytes = statSync(file).size;

section('Size');
check(`the page is ${bytes} bytes, within ${BUDGET}`, bytes <= BUDGET, `${bytes - BUDGET} bytes over`);

section('All ASCII');
// Any other character makes the browser decode the page into two-byte text and keep its scripts
// that way, which cost the first frame 50 to 90 ms at 4x CPU (see asciiRegexps in scripts/build.mjs).
const wide = [];
for (let i = 0; i < html.length && wide.length < 5; i++) {
  if (html.charCodeAt(i) > 0x7f) {
    const at = html.lastIndexOf('<script>/* ', i);
    wide.push(`${at >= 0 ? html.slice(at + 11, html.indexOf(' */', at)) : 'the page'}: ...${html.slice(Math.max(0, i - 30), i + 10)}... (write it as a \\u escape)`);
  }
}
check('the page is all ASCII', wide.length === 0, wide);
// The escaping of regular expressions, on cases a minifier's output can have: each function must give
// the same answers once escaped.
const RX = [
  [(s) => s.replace(/[’']/g, '-'), ['it’s', 'its']],
  [(s) => /\→/.test(s), ['a→b', 'ab']],
  [(s) => /[😀]/u.test(s), ['x😀', 'x\ud83d']],
  [(s) => /^😀+$/.test(s), ['😀😀', 'x']],
  [(s) => { let r = 0; if (s) /→/.test(s) && (r = 1); return r; }, ['→', 'x']],
  [(s) => `<${s.replace(/→/g, '>')}>`, ['a→b']],
  [(s) => s.replace(/['"`]→/g, ''), ['"→x', 'x']],
  [(s) => { let i = 4; const a = i++ / 2; return [a, /→/.test(s), i]; }, ['→']],
  [(s) => { const o = { return: 4 }; return [o.return / 2, /→/.test(s)]; }, ['→']],
  [(s) => [String.raw`→`.length, 6 / 2 / 3, /→/.test(s)], ['→']],
  [(s) => { for (const x of [1]) /→/g.test(s + x); return s.split(/[·•]/); }, ['a·b•c']],
];
const rxBad = [];
for (const [fn, inputs] of RX) {
  const src = `(${fn})`;
  const out = asciiRegexps(src);
  let same = false;
  try { const g = vm.runInNewContext(out); same = JSON.stringify(inputs.map(fn)) === JSON.stringify(inputs.map(g)); } catch (e) { same = false; }
  const left = out.replace(/String\.raw`[^`]*`/g, '');
  if (!same || /[^\x00-\x7f]/.test(left)) rxBad.push(out);
}
check('regular expressions are written in ASCII and match the same (tagged templates are left alone)', rxBad.length === 0, rxBad);

section('Scripts');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check('only plain inline <script> tags (no src, type or nonce)', !/<script\s[^>]*>/i.test(html));
check('one script per app file, plus Refract and the version', scripts.length === APP_SCRIPTS.length + 2, `${scripts.length} vs ${APP_SCRIPTS.length + 2}`);
const named = APP_SCRIPTS.filter((p) => scripts.some((s) => s.startsWith(`/* ${p} */`)));
check('each app file is its own script, named in a comment at its top', named.length === APP_SCRIPTS.length, APP_SCRIPTS.filter((p) => !named.includes(p)));
const broken = [];
scripts.forEach((s, i) => { try { new vm.Script(s, { filename: `inline-${i}.js` }); } catch (e) { broken.push(`${(s.match(/^\/\* (\S+)/) || [])[1] || `#${i}`}: ${e.message}`); } });
check('every inline script compiles', broken.length === 0, broken);
check('none of them is cut short by a "</script" inside it', scripts.every((s) => !/<\/script/i.test(s)));
const appScripts = scripts.filter((s) => /^\/\* src\//.test(s));
check('minified, each in a wrapper of its own (MINIFY=0 is for debugging only)', appScripts.length === APP_SCRIPTS.length && appScripts.every((s) => /^\/\* \S+ \*\/\n\(\(\)=>\{/.test(s)), appScripts.filter((s) => !/^\/\* \S+ \*\/\n\(\(\)=>\{/.test(s)).map((s) => s.slice(0, 40)));

section('Style sheets');
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const cssErrors = [];
for (const [i, css] of styles.entries()) {
  try { const r = await transform(css, { loader: 'css', logLevel: 'silent' }); if (r.warnings.length) cssErrors.push(`#${i}: ${r.warnings[0].text}`); } catch (e) { cssErrors.push(`#${i}: ${e.message.split('\n')[0]}`); }
}
check('three style sheets (tokens, Refract, the app), each of which parses', styles.length === 3 && cssErrors.length === 0, cssErrors.concat(styles.length !== 3 ? [`${styles.length} sheets`] : []));
check('the fonts are inline', /@font-face\{[^}]*url\(data:font\/woff2;base64,/.test(styles[0] || ''));

section('Content security policy');
const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
const csp = meta ? meta[1] : '';
const listed = new Set([...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));
const hashes = scripts.map((s) => createHash('sha256').update(s, 'utf8').digest('base64'));
check('there is a policy, without unsafe-inline or unsafe-eval for scripts', !!csp && /script-src 'self'/.test(csp) && !/script-src[^;]*'unsafe-(inline|eval)'/.test(csp), csp.slice(0, 120));
check('it lists the hash of every inline script', hashes.every((h) => listed.has(h)), hashes.filter((h) => !listed.has(h)).length);
check('and nothing else', listed.size === hashes.length, `${listed.size} hashes for ${hashes.length} scripts`);

section('Parts loaded on demand');
const missing = LAZY.filter((c) => c.entry && !existsSync(join(root, 'dist/lazy', `${c.name}.js`))).map((c) => c.name);
check('every chunk is in dist/lazy/', missing.length === 0, missing);
const claude = existsSync(join(root, 'dist/lazy/claude.js')) ? readFileSync(join(root, 'dist/lazy/claude.js'), 'utf8') : '';
check('the Anthropic SDK is in the claude chunk', /anthropic-dangerous-direct-browser-access/.test(claude) && /GH\.claude|\.claude=/.test(claude));
check('and not in the page', !/anthropic-dangerous-direct-browser-access/.test(html));

// The app's own parts (APP_CHUNKS: set-up, the plan review, How it works, the share card): each in
// dist/lazy/ as its scripts minified, which compiles, is all ASCII and sets its mark for GH.lazy; and
// none of that code is in the page any more (src/ui/lazy.js stands in for it there).
const inPage = APP_SCRIPTS.filter((p) => APP_CHUNKS.some((c) => c.scripts.includes(p)));
check('no script of an app part is also inline in the page', inPage.length === 0, inPage);
for (const c of APP_CHUNKS) {
  const f = join(root, 'dist/lazy', `${c.name}.js`);
  const text = existsSync(f) ? readFileSync(f, 'utf8') : '';
  let compiles = true;
  try { new vm.Script(text, { filename: `${c.name}.js` }); } catch (e) { compiles = false; }
  const mark = `(window.GH = window.GH || {})[${JSON.stringify(c.name)}]`;
  const ok = !!text && compiles && !/[^\x00-\x7f]/.test(text) && c.scripts.every((p) => text.includes(`/* ${p} */\n(()=>{`)) && text.includes(mark);
  check(`the ${c.name} part (${c.scripts.join(', ')}) is in dist/lazy/${c.name}.js, minified, all ASCII, and compiles`, ok, { exists: !!text, compiles });
  const bodies = text.split(/\n\/\* src\/\S+ \*\/\n/).map((s) => s.replace(/^\/\* src\/\S+ \*\/\n/, '').trim()).filter((s) => s.startsWith('(()=>{'));
  const kept = bodies.filter((b) => html.includes(b.slice(0, 2000)));
  check(`and none of its code is in the page`, bodies.length === c.scripts.length && kept.length === 0, `${kept.length} of ${bodies.length} still inline`);
}
check('the stand-ins for them are in the page (src/ui/lazy.js)', scripts.some((s) => s.startsWith('/* src/ui/lazy.js */')));

section('Patches to Refract');
// Edits to vendor/refract/bundle.js are fenced: // gh-patch(<id>) ... // gh-patch-end(<id>), one
// level, ids made of letters, digits and dashes, each used once. A Refract update that drops one
// shows up here and in the tests of what it fixed.
const bundle = readFileSync(join(root, 'vendor/refract/bundle.js'), 'utf8');
const marks = [...bundle.matchAll(/gh-patch(-end)?\(([^)]*)\)/g)].map((m) => ({ end: !!m[1], id: m[2], line: bundle.slice(0, m.index).split('\n').length }));
const problems = [];
const seen = new Set();
let open = null;
for (const m of marks) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(m.id)) problems.push(`line ${m.line}: id "${m.id}"`);
  if (!m.end) {
    if (open) problems.push(`line ${m.line}: gh-patch(${m.id}) inside gh-patch(${open.id})`);
    if (seen.has(m.id)) problems.push(`line ${m.line}: gh-patch(${m.id}) used twice`);
    seen.add(m.id);
    open = m;
  } else {
    if (!open || open.id !== m.id) problems.push(`line ${m.line}: gh-patch-end(${m.id}) without its start`);
    open = null;
  }
}
if (open) problems.push(`line ${open.line}: gh-patch(${open.id}) never ends`);
check(`${seen.size} marked patch${seen.size === 1 ? '' : 'es'}, each well formed and closed`, problems.length === 0, problems);
// The patches 1.6.0 relies on: lens maps encoded once per size and kept, and a preference change
// that no longer throws every lens's map away (test/ui-controls.mjs checks what they fix).
const WANT = ['map-memo', 'map-memo-get', 'map-memo-set', 'lens-pref'];
check(`the 1.6.0 patches are all there (${WANT.join(', ')})`, WANT.every((id) => seen.has(id)), WANT.filter((id) => !seen.has(id)));

done();
