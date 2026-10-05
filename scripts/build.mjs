// Builds the single self-contained app file: dist/gradient-health.html.
//
// - Generates Refract's tokens.css from vendor/refract/tokens.json (the design system ships
//   tokens as JSON only), with its fonts inlined as data URIs so the APK works offline.
// - Inlines Refract's bundle.css/bundle.js and the app's own CSS/JS into src/shell.html.
// - Minifies every inline script and style sheet on the way, written all in ASCII (MINIFY=0 turns
//   that off, to debug with readable code). Names are kept (keepNames), so a function's .name is
//   what the source says. Refract's bundle arrives minified and ships as it is.
// - Bundles the parts that load on demand into dist/lazy/ with esbuild (see LAZY): the Claude
//   requests with the Anthropic SDK, the 3D figure, the on-device model runtime and more.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
export const MINIFY = process.env.MINIFY !== '0';

// One file at a time, so the page keeps one <script> per source file (an error names its file).
// The target is the lazy chunks' (Chrome 100): esbuild only rewrites syntax newer than that.
// Each script is wrapped in an IIFE of its own (format), because keepNames adds two helpers at the
// top: unwrapped, they'd be globals with minified names, and every script would overwrite the last
// one's. (Every app script is an IIFE already and declares no globals of its own.)
const MIN_JS = { loader: 'js', format: 'iife', minify: true, keepNames: true, target: 'chrome100', legalComments: 'none', charset: 'ascii', logLevel: 'silent' };
// Style sheets lose only whitespace and comments. Full minifying also rewrites values (160ms to
// .16s, 0.5 to .5), custom properties included, and scripts read those (Refract's durations and
// easings, the lens sizes): this way they read exactly what's written, for about 1 KB more.
const MIN_CSS = { loader: 'css', minifyWhitespace: true, target: 'chrome100', legalComments: 'none', charset: 'ascii', logLevel: 'silent' };
export async function minJs(code, file) {
  if (!MINIFY) return code;
  return asciiRegexps((await transform(code, Object.assign({ sourcefile: file }, MIN_JS))).code.trim());
}
export async function minCss(code, file) {
  if (!MINIFY) return code;
  return (await transform(code, Object.assign({ sourcefile: file }, MIN_CSS))).code.trim();
}
// The page is all ASCII (charset above). With even a few other characters, the browser decodes
// the page into two-byte text and keeps its scripts that way; all ASCII, the first frame came 50 to
// 90 ms sooner at 4x CPU (decoding the page alone went from 61 to 16 ms). esbuild escapes strings,
// templates and names, and leaves regular expression literals as written: asciiRegexps finds those
// and writes their other characters as \u escapes, which match the same text with or without the u
// flag. A tagged template's text can't be escaped (String.raw would see the escape), so it stays as
// it is, and so does a whole script whose tokens this doesn't follow: test/buildcheck.mjs names
// what's left.
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else']);
export function asciiRegexps(code) {
  if (!/[^\x00-\x7f]/.test(code)) return code;
  const n = code.length;
  let out = '', i = 0;
  // The token before: 'value' or 'word' (a / after it divides), one of REGEX_AFTER, or a punctuator.
  let prev = '';
  const parens = []; // per open (: whether it's an if/while/for/with condition (a regex may follow its ))
  const subs = []; // per open ${ in a template: the brace depth it opened at
  let depth = 0;
  while (i < n) {
    const c = code[i];
    let j = i + 1;
    if (c === '`' || (c === '}' && subs.length && subs[subs.length - 1] === depth)) {
      // Template text, to its end or the next ${.
      if (c === '}') subs.pop();
      while (j < n && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) j += code[j] === '\\' ? 2 : 1;
      if (j >= n) return code;
      if (code[j] === '`') { j++; prev = 'value'; } else { j += 2; subs.push(depth); prev = '('; }
    } else if (c === '"' || c === "'") {
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      if (code[j] !== c) return code;
      j++; prev = 'value';
    } else if (c === '/' && code[j] === '/') {
      j = code.indexOf('\n', i); if (j < 0) j = n;
    } else if (c === '/' && code[j] === '*') {
      j = code.indexOf('*/', i + 2); if (j < 0) return code; j += 2;
    } else if (c === '/' && !['value', 'word', ')', ']'].includes(prev)) {
      // A regular expression: to the closing / (not one in a [...] class), then its flags.
      let cls = false;
      for (; j < n && code[j] !== '\n'; j++) {
        if (code[j] === '\\') j++;
        else if (code[j] === '[') cls = true;
        else if (code[j] === ']') cls = false;
        else if (code[j] === '/' && !cls) break;
      }
      if (code[j] !== '/') return code;
      j++;
      while (j < n && /[a-z]/.test(code[j])) j++;
      // An escaped character (\\→, an identity escape) becomes just the \u escape.
      out += code.slice(i, j).replace(/(\\*)([^\x00-\x7f])/g, (m, bs, ch) => `${bs.slice(bs.length % 2)}\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      i = j; prev = 'value';
      continue;
    } else if (/[\w$\\]/.test(c)) {
      // A name, keyword or number (esbuild writes other letters in names as \u escapes).
      j = i;
      while (j < n && /[\w$\\]/.test(code[j])) j = code[j] !== '\\' ? j + 1 : code[j + 2] === '{' ? code.indexOf('}', j) + 1 : j + 6;
      const w = code.slice(i, j);
      prev = prev !== '.' && REGEX_AFTER.has(w) ? w : prev !== '.' && /^(if|while|for|with)$/.test(w) ? `cond:${w}` : 'word';
    } else if (/\s/.test(c)) {
      // Nothing changes.
    } else {
      if (c === '(') parens.push(prev.startsWith('cond:'));
      else if (c === ')') { if (!parens.length) return code; }
      else if (c === '{') depth++;
      else if (c === '}') { if (!depth) return code; depth--; }
      if ((c === '+' || c === '-') && code[j] === c) {
        j++; // ++ or --: after a value (a++) a / still divides
        if (prev !== 'value' && prev !== 'word' && prev !== ')' && prev !== ']') prev = c;
      } else prev = c === ')' ? (parens.pop() ? '(' : ')') : c;
    }
    out += code.slice(i, j);
    i = j;
  }
  return subs.length || depth || parens.length ? code : out;
}

// Refract's bundle arrives minified (vendor/refract/SOURCE.md), its manifest comment (@ds-bundle: the
// components it has) first: it ships as it is. Minifying it again only wraps it once more and adds
// keepNames' helpers (about 4 KB, for nothing).
async function refractJs() {
  return read('vendor/refract/bundle.js').trim();
}
// Refract's style sheet, without the rules for its demo landscapes (.rf-art, .rf-scene: six pictures
// as data URIs, about 49 KB the app never uses). A rule goes when every selector in its list names one
// of them outside :is() and the like, so a rule shared with other parts (:is(.rf-art, .rf-media) > x)
// stays, and an at-rule left empty goes too.
const DEMO_ART = /\.rf-(?:art|scene)(?![\w-])/;
export function pruneCss(css, drop = DEMO_ART) {
  let i = 0;
  const n = css.length;
  // Past a quoted string or a url(...) at i, which may hold braces or commas.
  const skipToken = () => {
    const c = css[i];
    if (c === '"' || c === '\'') {
      i++;
      while (i < n && css[i] !== c) i += css[i] === '\\' ? 2 : 1;
      i++;
      return true;
    }
    if (css.startsWith('url(', i)) {
      i += 4;
      while (i < n && /\s/.test(css[i])) i++;
      if (css[i] === '"' || css[i] === '\'') skipToken();
      while (i < n && css[i] !== ')') i++;
      i++;
      return true;
    }
    return false;
  };
  // The body of a block (after its {), up to and past its }.
  const skipBlock = () => {
    let depth = 1;
    while (i < n && depth) {
      if (skipToken()) continue;
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
  };
  // A selector list split at its top-level commas.
  const selectors = (s) => {
    const out = [];
    let depth = 0, start = 0;
    for (let j = 0; j < s.length; j++) {
      if (s[j] === '(' || s[j] === '[') depth++;
      else if (s[j] === ')' || s[j] === ']') depth--;
      else if (s[j] === ',' && !depth) { out.push(s.slice(start, j)); start = j + 1; }
    }
    out.push(s.slice(start));
    return out;
  };
  // What a selector names outside its functional pseudo-classes.
  const outside = (s) => {
    let out = '', depth = 0;
    for (const c of s) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (!depth) out += c;
    }
    return out;
  };
  const NESTING = /^@(media|layer|supports|container|scope|starting-style|document)\b/;
  function rules() {
    let out = '';
    while (i < n) {
      if (css[i] === '}') { i++; return out; }
      const start = i;
      while (i < n && css[i] !== '{' && css[i] !== ';' && css[i] !== '}') if (!skipToken()) i++;
      const prelude = css.slice(start, i);
      if (i >= n || css[i] === '}') { out += prelude; continue; }
      if (css[i] === ';') { out += `${prelude};`; i++; continue; }
      i++; // past {
      const head = prelude.trim();
      if (NESTING.test(head)) {
        const inner = rules();
        if (inner.trim()) out += `${prelude}{${inner}}`;
      } else if (head.startsWith('@')) {
        const from = i;
        skipBlock();
        out += `${prelude}{${css.slice(from, i - 1)}}`;
      } else {
        const from = i;
        skipBlock();
        const keep = selectors(prelude).filter((s) => !drop.test(outside(s)));
        if (keep.length) out += `${keep.join(',')}{${css.slice(from, i - 1)}}`;
      }
    }
    return out;
  }
  return rules();
}
// The app's styles: src/styles.css, then each file in src/styles/ in name order (one per area).
const appCss = () => [read('src/styles.css')].concat(existsSync(join(root, 'src/styles'))
  ? readdirSync(join(root, 'src/styles')).filter((f) => f.endsWith('.css')).sort().map((f) => `/* src/styles/${f} */\n${read(`src/styles/${f}`)}`)
  : []).join('\n');
const THEMES = ['light', 'dark', 'light-contrast', 'dark-contrast'];

export function tokensCss(tokens, { inlineFonts = true } = {}) {
  const out = [];
  if (inlineFonts) {
    for (const f of tokens.type.fonts) {
      const data = readFileSync(join(root, 'vendor/refract', f.file)).toString('base64');
      out.push(`@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:swap}`);
    }
  }
  const flat = [`--font-sans:${tokens.type.families.sans}`, `--font-mono:${tokens.type.families.mono}`];
  const themed = Object.fromEntries(THEMES.map((t) => [t, []]));
  const groups = ['color', 'spacing', 'radius', 'shadow', 'material', 'size', 'opacity', 'zIndex', 'duration', 'easing'];
  for (const g of groups) {
    for (const tok of tokens[g].tokens) {
      if (tok.value && typeof tok.value === 'object') {
        for (const t of THEMES) themed[t].push(`--${tok.name}:${tok.value[t]}`);
      } else {
        flat.push(`--${tok.name}:${tok.value}`);
      }
    }
  }
  out.push(`:root{${flat.join(';')}}`);
  const scheme = (t) => (t.startsWith('dark') ? 'dark' : 'light');
  out.push(`:root,[data-theme="light"]{color-scheme:light;${themed.light.join(';')}}`);
  for (const t of THEMES.slice(1)) out.push(`[data-theme="${t}"]{color-scheme:${scheme(t)};${themed[t].join(';')}}`);
  // Before Refract.theme.auto() runs, follow the OS so the first paint is right.
  out.push(`@media (prefers-color-scheme:dark){:root:not([data-theme]){color-scheme:dark;${themed.dark.join(';')}}}`);
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  for (const group of tokens.type.groups) {
    const family = `var(--font-${group.family})`;
    for (const s of group.styles) {
      const decl = [`font-family:${family}`];
      for (const [k, v] of Object.entries(s)) {
        if (['name', 'sample', 'usage'].includes(k)) continue;
        decl.push(`${kebab(k)}:${v}`);
      }
      out.push(`.${s.name}{${decl.join(';')}}`);
    }
  }
  return out.join('\n');
}

// A </script> inside inlined JS would end the script element early.
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script');
const safeCss = (css) => css.replace(/<\/style/gi, '<\\/style');

export const APP_SCRIPTS = [
  'src/data/brand.js',
  'src/data/privacy.js',
  'src/data/moves.js',
  'src/data/moves-access.js',
  'src/data/changelog.js',
  'src/engine/pose.js',
  'src/brain.js',
  'src/access.js',
  'src/optimizer.js',
  'src/planweek.js',
  'src/insights.js',
  'src/body.js',
  'src/health.js',
  'src/activity.js',
  'src/food.js',
  'src/achievements.js',
  'src/store.js',
  'src/platform.js',
  'src/foodnet.js',
  'src/coach.js',
  'src/tailor.js',
  'src/qr.js',
  'src/customplan.js',
  'src/devicecoach.js',
  'src/ai.js', // the Claude coach's inline part; its requests are the lazy 'claude' chunk
  'src/ui/core.js',
  'src/ui/lazy.js', // stand-ins for the parts in APP_CHUNKS below
  'src/ui/controls.js',
  'src/ui/motion.js',
  'src/ui/sheet.js',
  'src/ui/hapticsui.js',
  'src/ui/charts.js',
  'src/ui/guide.js',
  'src/ui/answers.js', // set-up's answers as You, Plan and Settings list them
  'src/ui/player.js',
  'src/ui/today.js',
  'src/ui/plan.js',
  'src/ui/healthtab.js',
  'src/ui/metric.js',
  'src/ui/chat.js',
  'src/ui/tailor.js',
  'src/ui/customplan.js',
  'src/ui/food.js',
  'src/scanner.js',
  'src/ui/bodymap.js',
  'src/ui/progress.js',
  'src/ui/activity.js',
  'src/ui/actlive.js',
  'src/ui/moves.js',
  'src/ui/profile.js',
  'src/ui/you.js',
  'src/ui/badges.js',
  'src/ui/coachpage.js',
  'src/ui/settings.js',
];

// Parts of the app itself that the first screen doesn't need, each a chunk of its own in dist/lazy/:
// the files' scripts minified as the page's are, one after another, then GH[name] set (to what the
// part set there itself, or true) so GH.lazy(name) knows it's in. Their style sheets stay in the
// page (other screens share their classes). src/ui/lazy.js has the small stand-ins that load a part
// the first time it's used, and warms the likely ones once the first frame is drawn.
export const APP_CHUNKS = [
  // Set-up: only someone who isn't set up yet, or who edits their answers, needs it.
  { name: 'setup', scripts: ['src/ui/onboarding.js'] },
  // The AI check of the plan, and Why this plan.
  { name: 'review', scripts: ['src/planreview.js', 'src/ui/review.js'] },
  // How it works: the rules behind the plan and their research.
  { name: 'science', scripts: ['src/data/science.js', 'src/ui/science.js'] },
  // A badge's share image.
  { name: 'shareCard', scripts: ['src/ui/sharecard.js'] },
];

// Heavy parts that load only when they're used (the 3D figure, the on-device model runtime, the
// barcode reader). Each is bundled or copied into dist/lazy/, which the APK serves next to the page
// and GH.lazy(name) loads on demand. Entries: { name, entry?, assets?: [[from, to]] }.
export const LAZY = [
  // The Claude coach's requests and the Anthropic SDK (src/claude.js), loaded the first time someone
  // who allowed Claude asks it something. Its small inline part is src/ai.js.
  { name: 'claude', entry: 'src/claude.js' },
  { name: 'barcode', entry: 'src/barcode.js', assets: [['node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'zxing_reader.wasm']] },
  // On-device AI: llama.cpp compiled to WebAssembly (@wllama/wllama). v3 ships one wasm for every mode.
  { name: 'llm', entry: 'src/llm.js', assets: [['node_modules/@wllama/wllama/esm/wasm/wllama.wasm', 'wllama/wllama.wasm']] },
  // The built-in food list (USDA SR28), loaded the first time someone searches for a food.
  { name: 'foods', entry: 'src/data/foods.js' },
  // The 3D exercise figure (three.js), loaded the first time a figure is shown.
  { name: 'figure3d', entry: 'src/engine/figure3d.js' },
  // Activity maps (an activity's route, and following you as you record), loaded only when a map is
  // about to show: Google's (the Maps JavaScript API, with the app's key; this chunk loads Google's
  // script), else MapLibre GL JS on OpenFreeMap, whose web worker is a chunk of its own, started
  // from the app's origin.
  { name: 'gmap', entry: 'src/gmap.js' },
  { name: 'actmap', entry: 'src/actmap.js' },
  { name: 'actmap-worker', entry: 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs' },
];

// An app chunk's file: its scripts (each minified, so each its own wrapper), then the mark GH.lazy
// waits for.
export async function appChunk(c) {
  const parts = await Promise.all(c.scripts.map((p) => minJs(read(p), p)));
  const key = JSON.stringify(c.name);
  return `${parts.map((code, i) => `/* ${c.scripts[i]} */\n${code}`).join('\n')}\n(window.GH = window.GH || {})[${key}] = window.GH[${key}] || true;\n`;
}

async function buildLazy(chunks) {
  const dir = join(root, 'dist/lazy');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const sizes = [];
  APP_CHUNKS.forEach((c, i) => {
    writeFileSync(join(dir, `${c.name}.js`), chunks[i]);
    sizes.push(`${c.name}.js ${(chunks[i].length / 1024).toFixed(0)} KB`);
  });
  for (const c of LAZY) {
    if (c.entry) {
      const result = await build({
        entryPoints: [join(root, c.entry)], bundle: true, write: false, format: 'iife', platform: 'browser',
        target: ['chrome100'], minify: MINIFY, legalComments: 'eof', logLevel: 'silent',
      });
      writeFileSync(join(dir, `${c.name}.js`), result.outputFiles[0].text);
      sizes.push(`${c.name}.js ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
    }
    for (const [from, to] of c.assets || []) {
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      copyFileSync(join(root, from), join(dir, to));
      sizes.push(`${to} ${(statSync(join(dir, to)).size / 1024).toFixed(0)} KB`);
    }
  }
  return sizes;
}

// The page's content security policy allows exactly the inline scripts the build put in (by their
// SHA-256), not 'unsafe-inline': anything injected into the page later can't run.
function allowOnlyOurScripts(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) hashes.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  if (/<script\s[^>]*>(?!<\/script>)/.test(html)) throw new Error('build: inline scripts must be plain <script> tags so they can be hashed');
  const csp = "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'";
  if (!html.includes(csp)) throw new Error('build: the CSP in src/shell.html changed; update allowOnlyOurScripts');
  return html.replace(csp, `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`);
}

// The page a shared plan's link opens in a browser (docs/p/index.html, served by GitHub Pages from
// /docs): the plan from the link's #fragment, the move names and the QR encoder inline, and a
// content security policy that allows exactly its one script. No other requests, no trackers.
export function sharePage() {
  globalThis.GH = globalThis.GH || {};
  for (const p of APP_SCRIPTS.filter((x) => /^src\/data\/moves/.test(x))) new Function(read(p))();
  const moves = {};
  for (const [id, m] of Object.entries(globalThis.GH.moves.MOVES)) if (m && m.name) moves[id] = [m.name, m.group || '', m.timed ? 1 : 0];
  let html = read('src/share-page.html')
    .replace('/*@QR*/', () => safeJs(read('src/qr.js')))
    .replace('/*@MOVES*/{}', () => safeJs(JSON.stringify(moves)));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1 || !html.includes('@SCRIPT_HASH')) throw new Error('build: src/share-page.html needs exactly one inline script and the @SCRIPT_HASH marker');
  html = html.replace('@SCRIPT_HASH', `'sha256-${createHash('sha256').update(scripts[0][1], 'utf8').digest('base64')}'`);
  mkdirSync(join(root, 'docs/p'), { recursive: true });
  writeFileSync(join(root, 'docs/p/index.html'), html);
  return html.length;
}

async function main() {
  const tokens = JSON.parse(read('vendor/refract/tokens.json'));
  const shell = read('src/shell.html');
  const version = JSON.parse(read('package.json')).version || '0.0.0';
  const appJs = await Promise.all(APP_SCRIPTS.map((p) => minJs(read(p), p)));
  const chunks = await Promise.all(APP_CHUNKS.map(appChunk));
  // The app's version, for Profile, What's new and the web build (the APK also reports its own), and
  // an id of this build's code (its chunks' too), for things kept across launches that a code change
  // should drop.
  const buildId = createHash('sha256').update(appJs.concat(chunks).join('\n')).digest('hex').slice(0, 12);
  const scripts = [`<script>(window.GH = window.GH || {}).VERSION = ${JSON.stringify(version)}; window.GH.BUILD = ${JSON.stringify(buildId)};</script>`];
  APP_SCRIPTS.forEach((p, i) => scripts.push(`<script>/* ${p} */\n${safeJs(appJs[i])}</script>`));
  const [tokensMin, refractCss, appCssMin, refractMin] = await Promise.all([
    // The app's lowest layer, app-base, is named first so it sorts before Refract's (layers order by
    // first appearance): its defaults lose to anything Refract's or the app's other rules set.
    minCss(`@layer app-base;\n${tokensCss(tokens)}`, 'tokens.css'), minCss(pruneCss(read('vendor/refract/bundle.css')), 'vendor/refract/bundle.css'), minCss(appCss(), 'src/styles.css'), refractJs(),
  ]);
  let html = shell
    .replace('<!--@TOKENS-->', () => `<style>${safeCss(tokensMin)}</style>`)
    .replace('<!--@REFRACT_CSS-->', () => `<style>${safeCss(refractCss)}</style>`)
    .replace('<!--@APP_CSS-->', () => `<style>${safeCss(appCssMin)}</style>`)
    .replace('<!--@REFRACT_JS-->', () => `<script>${safeJs(refractMin)}</script>`)
    .replace('<!--@APP_JS-->', () => scripts.join('\n'));
  for (const marker of ['<!--@TOKENS-->', '<!--@REFRACT_CSS-->', '<!--@APP_CSS-->', '<!--@REFRACT_JS-->', '<!--@APP_JS-->']) {
    if (html.includes(marker)) throw new Error(`build: marker ${marker} was not replaced`);
  }
  // The scripts' hashes go into the CSP here, after minifying: they're of the exact text shipped.
  html = allowOnlyOurScripts(html);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/gradient-health.html'), html);
  const bytes = Buffer.byteLength(html, 'utf8');
  console.log(`dist/gradient-health.html  ${bytes} bytes (${(bytes / 1024).toFixed(0)} KB)${MINIFY ? '' : ', not minified (MINIFY=0)'}`);
  // The public privacy policy is generated from the same text the app shows.
  globalThis.GH = globalThis.GH || {};
  new Function(read('src/data/privacy.js'))();
  writeFileSync(join(root, 'docs/PRIVACY.md'), globalThis.GH.PRIVACY.markdown());
  console.log(`docs/p/index.html  ${(sharePage() / 1024).toFixed(0)} KB  (the share page)`);
  const lazy = await buildLazy(chunks);
  if (lazy.length) console.log(`dist/lazy/  ${lazy.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
