// The built page (dist/gradient-health.html, so run `npm run build` first): its size budget, that
// it's all ASCII, that every inline script compiles and every style sheet parses, that the content
// security policy lists exactly the inline scripts' hashes, that the parts loaded on demand are
// there (the Anthropic SDK among them, and not in the page), and that Refract is the vendored
// release, unmodified.
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
// inlined by mistake. With the plan review, the motion and the new set-up merged, the page reached
// 2,012,805 bytes; the speed pass then moved set-up, the plan review, How it works and the share
// card into chunks of their own, and 1.6.0 shipped at 1,840,238 bytes, with a budget of that plus
// 5% (1,932,000) that held through 1.8.3 (1,930,412 bytes, with Refract 1.4 in). 1.8.4 adds the
// scroll diagnostics and the glass setting (11 KB) and ships at 1,941,415 bytes; the budget is that
// plus 2%, enough to catch an asset inlined by mistake.
const BUDGET = 1980000;

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
// Every action a button in the page's own code names (data-act, or a row's act) is there at launch:
// defined by inline code, or stood in for by src/ui/lazy.js until its part loads. An action that
// only exists in a part would do nothing until that part happened to load.
{
  const inline = APP_SCRIPTS.filter((p) => p.endsWith('.js') && !APP_CHUNKS.some((c) => c.scripts.includes(p)));
  const named = new Map(), defined = new Set();
  for (const p of inline) {
    const src = readFileSync(join(root, p), 'utf8');
    for (const m of src.matchAll(/data-act=\\?"([A-Za-z_]\w*)\\?"|\bact: '([A-Za-z_]\w*)'/g)) { const a = m[1] || m[2]; if (!named.has(a)) named.set(a, p); }
    for (const m of src.matchAll(/\bact\.([A-Za-z_]\w*)\s*=(?!=)|stand\(U\.act, '(\w+)'/g)) defined.add(m[1] || m[2]);
  }
  const none = [...named].filter(([a]) => !defined.has(a)).map(([a, p]) => `${a} (${p})`);
  check(`every action the page's buttons name is there at launch (${named.size} actions)`, named.size > 100 && none.length === 0, none);
}

section('Refract, as vendored');
// vendor/refract holds Refract 1.4.0 exactly as its design system ships it (SOURCE.md): minified, so
// the app no longer patches it. Its files' hashes are written in SOURCE.md, so an edited or swapped
// file shows up here.
const source = readFileSync(join(root, 'vendor/refract/SOURCE.md'), 'utf8');
const hashed = [...source.matchAll(/^\| ([\w.]+) \| ([0-9a-f]{64}) \|$/gm)].map((m) => [m[1], m[2]]);
const changed = hashed.filter(([f, h]) => createHash('sha256').update(readFileSync(join(root, 'vendor/refract', f))).digest('hex') !== h).map(([f]) => f);
check(`the vendored files match their hashes in SOURCE.md (${hashed.map(([f]) => f).join(', ')})`, hashed.length === 4 && changed.length === 0, changed);
const bundleJs = readFileSync(join(root, 'vendor/refract/bundle.js'), 'utf8');
check('it is Refract 1.4', /"1\.4\.\d+"/.test(bundleJs) && bundleJs.includes('liquidLens'));
check('the page ships the bundle as it is (not minified again)', html.includes(bundleJs.trim().slice(0, 400)));
// The demo landscapes' rules are dropped from the page (scripts/build.mjs pruneCss), and the app never
// uses them.
const pageCss = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
check('no rule for Refract\'s demo landscapes (.rf-art, .rf-scene) ships', !/\.rf-(?:art|scene)(?![\w-])/.test(pageCss.replace(/:is\([^)]*\)/g, '')));
const appUses = [...APP_SCRIPTS, ...APP_CHUNKS.flatMap((c) => c.scripts)].filter((p) => /rf-(?:art|scene)\b/.test(readFileSync(join(root, p), 'utf8')));
check('the app uses none of them', appUses.length === 0, appUses);

done();
