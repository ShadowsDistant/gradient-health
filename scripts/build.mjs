// Builds the single self-contained app file: dist/gradient-health.html.
//
// - Generates Refract's tokens.css from vendor/refract/tokens.json (the design system ships
//   tokens as JSON only), with its fonts inlined as data URIs so the APK works offline.
// - Bundles src/ai.js (Claude coach, uses @anthropic-ai/sdk) into an IIFE with esbuild.
// - Inlines Refract's bundle.css/bundle.js and the app's own CSS/JS into src/shell.html.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
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
  'src/data/science.js',
  'src/data/changelog.js',
  'src/engine/pose.js',
  'src/brain.js',
  'src/planweek.js',
  'src/insights.js',
  'src/body.js',
  'src/health.js',
  'src/food.js',
  'src/store.js',
  'src/platform.js',
  'src/foodnet.js',
  'src/coach.js',
  'src/tailor.js',
  'src/qr.js',
  'src/customplan.js',
  'src/devicecoach.js',
  // ai bundle is injected here
  'src/ui/core.js',
  'src/ui/sheet.js',
  'src/ui/charts.js',
  'src/ui/guide.js',
  'src/ui/onboarding.js',
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
  'src/ui/moves.js',
  'src/ui/profile.js',
  'src/ui/coachpage.js',
  'src/ui/science.js',
  'src/ui/settings.js',
];

// Heavy parts that load only when they're used (the 3D figure, the on-device model runtime, the
// barcode reader). Each is bundled or copied into dist/lazy/, which the APK serves next to the page
// and GH.lazy(name) loads on demand. Entries: { name, entry?, assets?: [[from, to]] }.
export const LAZY = [
  { name: 'barcode', entry: 'src/barcode.js', assets: [['node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'zxing_reader.wasm']] },
  // On-device AI: llama.cpp compiled to WebAssembly (@wllama/wllama). v3 ships one wasm for every mode.
  { name: 'llm', entry: 'src/llm.js', assets: [['node_modules/@wllama/wllama/esm/wasm/wllama.wasm', 'wllama/wllama.wasm']] },
  // The built-in food list (USDA SR28), loaded the first time someone searches for a food.
  { name: 'foods', entry: 'src/data/foods.js' },
  // The 3D exercise figure (three.js), loaded the first time a figure is shown.
  { name: 'figure3d', entry: 'src/engine/figure3d.js' },
];

async function buildLazy() {
  const dir = join(root, 'dist/lazy');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const sizes = [];
  for (const c of LAZY) {
    if (c.entry) {
      const result = await build({
        entryPoints: [join(root, c.entry)], bundle: true, write: false, format: 'iife', platform: 'browser',
        target: ['chrome100'], minify: true, legalComments: 'eof', logLevel: 'silent',
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

async function bundleAi() {
  const result = await build({
    entryPoints: [join(root, 'src/ai.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100'],
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
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
  const aiJs = await bundleAi();
  const version = JSON.parse(read('package.json')).version || '0.0.0';
  // The app's version, for Profile, What's new and the web build (the APK also reports its own).
  const scripts = [`<script>(window.GH = window.GH || {}).VERSION = ${JSON.stringify(version)};</script>`];
  for (const p of APP_SCRIPTS) {
    if (p === 'src/ui/core.js') scripts.push(`<script>/* ai (bundled) */\n${safeJs(aiJs)}</script>`);
    scripts.push(`<script>/* ${p} */\n${safeJs(read(p))}</script>`);
  }
  let html = shell
    .replace('<!--@TOKENS-->', () => `<style>${safeCss(tokensCss(tokens))}</style>`)
    .replace('<!--@REFRACT_CSS-->', () => `<style>${safeCss(read('vendor/refract/bundle.css'))}</style>`)
    .replace('<!--@APP_CSS-->', () => `<style>${safeCss(appCss())}</style>`)
    .replace('<!--@REFRACT_JS-->', () => `<script>${safeJs(read('vendor/refract/bundle.js'))}</script>`)
    .replace('<!--@APP_JS-->', () => scripts.join('\n'));
  for (const marker of ['<!--@TOKENS-->', '<!--@REFRACT_CSS-->', '<!--@APP_CSS-->', '<!--@REFRACT_JS-->', '<!--@APP_JS-->']) {
    if (html.includes(marker)) throw new Error(`build: marker ${marker} was not replaced`);
  }
  html = allowOnlyOurScripts(html);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/gradient-health.html'), html);
  console.log(`dist/gradient-health.html  ${(html.length / 1024).toFixed(0)} KB  (ai bundle ${(aiJs.length / 1024).toFixed(0)} KB)`);
  // The public privacy policy is generated from the same text the app shows.
  globalThis.GH = globalThis.GH || {};
  new Function(read('src/data/privacy.js'))();
  writeFileSync(join(root, 'docs/PRIVACY.md'), globalThis.GH.PRIVACY.markdown());
  console.log(`docs/p/index.html  ${(sharePage() / 1024).toFixed(0)} KB  (the share page)`);
  const lazy = await buildLazy();
  if (lazy.length) console.log(`dist/lazy/  ${lazy.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
