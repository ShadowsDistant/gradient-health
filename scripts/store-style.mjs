// The look the store images and the promo video share: the app's type (Host Grotesk), a near-black
// page lit by the icon's four colours (src/styles.css: blue, mint, green and amber), headlines with a
// colour word, phones and glass chips. Used by scripts/store-assets.mjs and scripts/promo-video.mjs.
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const url = (p) => pathToFileURL(join(root, p)).href;

export const C = { blue: '62 149 249', mint: '52 199 174', green: '75 201 133', amber: '244 168 62', ink: '#05070d' };

// The page: near black, with soft glows of the brand colours. glows: [colour, x%, y%, w%, h%, alpha].
export const aurora = (glows) => `${glows.map(([c, x, y, w, h, a]) => `radial-gradient(${w}% ${h}% at ${x}% ${y}%, rgb(${C[c]} / ${a}), transparent 72%)`).join(', ')}, ${C.ink}`;

// A fine grain over the glows, so their fades don't band.
export const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;

export const BASE = `
@font-face { font-family: 'Host Grotesk'; src: url('${url('vendor/refract/fonts/HostGrotesk-Variable.woff2')}') format('woff2'); font-weight: 300 800; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { position: relative; color: #fff; font-family: 'Host Grotesk', system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
.grain { position: absolute; inset: 0; background-image: ${GRAIN}; opacity: .05; mix-blend-mode: overlay; pointer-events: none; }
/* A word in the icon's colours. */
.hue { background: linear-gradient(100deg, #8cc6ff 0%, #5fd9c4 52%, #a6e8a2 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hue-warm { background: linear-gradient(100deg, #ffd27a 0%, #f4a83e 55%, #ff8f5c 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
/* A phone: a dark frame with a lit edge, the screenshot inside, and a glow of colour behind it. */
.phone { position: absolute; padding: 1.9%; border-radius: 11.5% / 5.4%; background: linear-gradient(150deg, #5a5d68 0%, #1b1c22 22%, #0c0d11 60%, #23252c 88%, #4a4d57 100%);
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .16), inset 0 2px 1px rgb(255 255 255 / .14), 0 0 0 1px rgb(0 0 0 / .6), 0 50px 110px -30px rgb(0 0 0 / .85), 0 0 160px -30px var(--glow, rgb(62 149 249 / .55)); }
.phone img { display: block; width: 100%; border-radius: 10% / 4.6%; }
/* Glass: a frosted chip or card over whatever is behind it. */
.glass { background: linear-gradient(160deg, rgb(255 255 255 / .2), rgb(255 255 255 / .08)); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / .26), inset 0 1.5px 0 rgb(255 255 255 / .35), 0 24px 50px -18px rgb(0 0 0 / .65); }
.glass.dark { background: linear-gradient(160deg, rgb(28 32 46 / .78), rgb(10 12 20 / .82)); }
.chip { position: absolute; display: inline-flex; align-items: center; gap: .55em; padding: .62em 1.05em; border-radius: 999px; font-weight: 640; letter-spacing: -0.005em; white-space: nowrap; }
.chip i { width: .62em; height: .62em; border-radius: 50%; flex: none; box-shadow: 0 0 .7em currentColor; }
`;

// The icon's colours as chip dots.
export const DOT = { blue: '#5aa8ff', mint: '#3fdcbf', green: '#62d98f', amber: '#ffb54d' };
