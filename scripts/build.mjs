// Builds the single self-contained app file: dist/gradient-health.html.
//
// - Generates Refract's tokens.css from vendor/refract/tokens.json (the design system ships
//   tokens as JSON only), with its fonts inlined as data URIs so the APK works offline.
// - Bundles src/ai.js (Claude coach, uses @anthropic-ai/sdk) into an IIFE with esbuild.
// - Inlines Refract's bundle.css/bundle.js and the app's own CSS/JS into src/shell.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
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
  'src/data/moves.js',
  'src/engine/pose.js',
  'src/brain.js',
  'src/insights.js',
  'src/health.js',
  'src/store.js',
  'src/platform.js',
  // ai bundle is injected here
  'src/ui/core.js',
  'src/ui/charts.js',
  'src/ui/onboarding.js',
  'src/ui/player.js',
  'src/ui/today.js',
  'src/ui/plan.js',
  'src/ui/healthtab.js',
  'src/ui/progress.js',
  'src/ui/moves.js',
  'src/ui/settings.js',
];

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

async function main() {
  const tokens = JSON.parse(read('vendor/refract/tokens.json'));
  const shell = read('src/shell.html');
  const aiJs = await bundleAi();
  const scripts = [];
  for (const p of APP_SCRIPTS) {
    if (p === 'src/ui/core.js') scripts.push(`<script>/* ai (bundled) */\n${safeJs(aiJs)}</script>`);
    scripts.push(`<script>/* ${p} */\n${safeJs(read(p))}</script>`);
  }
  const html = shell
    .replace('<!--@TOKENS-->', () => `<style>${safeCss(tokensCss(tokens))}</style>`)
    .replace('<!--@REFRACT_CSS-->', () => `<style>${safeCss(read('vendor/refract/bundle.css'))}</style>`)
    .replace('<!--@APP_CSS-->', () => `<style>${safeCss(read('src/styles.css'))}</style>`)
    .replace('<!--@REFRACT_JS-->', () => `<script>${safeJs(read('vendor/refract/bundle.js'))}</script>`)
    .replace('<!--@APP_JS-->', () => scripts.join('\n'));
  for (const marker of ['<!--@TOKENS-->', '<!--@REFRACT_CSS-->', '<!--@APP_CSS-->', '<!--@REFRACT_JS-->', '<!--@APP_JS-->']) {
    if (html.includes(marker)) throw new Error(`build: marker ${marker} was not replaced`);
  }
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/gradient-health.html'), html);
  console.log(`dist/gradient-health.html  ${(html.length / 1024).toFixed(0)} KB  (ai bundle ${(aiJs.length / 1024).toFixed(0)} KB)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
