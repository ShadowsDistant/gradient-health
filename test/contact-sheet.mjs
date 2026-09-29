// Renders every keyframe of every move into a PNG contact sheet for visual review.
// Usage: node test/contact-sheet.mjs [filter,filter…] [--dark]  → build/contact[-dark].png
// A filter matches part of a move id; "@gym" matches every gym move.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dark = args.includes('--dark');
const big = args.includes('--big'); // 3 large cells per row, for close review
const filter = args.find((a) => !a.startsWith('--')) || '';
const css = readFileSync(join(root, 'src/styles.css'), 'utf8').match(/\/\* @figure-start \*\/[\s\S]*?\/\* @figure-end \*\//)?.[0] || '';
const html = `<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><style>
:root{--label:#0c0d12;--label-secondary:#4b4f5b;--bg-raised:#fff;--separator:#0c0d121f;--fill-2:#7878803d;--hue-amber:#a2560a;--hue-coral:#c7402d;--hue-teal:#0b7471;--hue-green:#1d7a41;--bg:#f1f2f6}
[data-theme=dark]{--label:#f4f5f8;--label-secondary:#b4b8c4;--bg-raised:#17181e;--separator:#ffffff21;--fill-2:#8e8e9a42;--bg:#0b0c10}
body{margin:0;background:var(--bg);font:12px system-ui;color:var(--label)}
.grid{display:grid;grid-template-columns:repeat(${big ? 3 : 6},${big ? 468 : 230}px);gap:8px;padding:8px}
.cell{background:var(--bg-raised);border-radius:10px;padding:4px}
.cell svg{width:${big ? 460 : 222}px;height:${big ? 340 : 170}px;display:block}
.cell b{display:block;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${css}
</style></head><body><div class="grid" id="g"></div>
<script>${readFileSync(join(root, 'src/data/moves.js'), 'utf8')}</script>
<script>${readFileSync(join(root, 'src/engine/pose.js'), 'utf8')}</script>
<script>
const g=document.getElementById('g');const seen=new Set();
for (const [id,m] of Object.entries(GH.moves.MOVES)) {
  if (!${JSON.stringify(filter)}.split(',').some((f) => (f === '@gym' ? m.gym : id.includes(f)))) continue;
  const key=m.form+JSON.stringify(m.equip||[]); if (seen.has(key)) continue; seen.add(key);
  const eq={db:[8],kb:[10],ball:true,band:true,bar:true,table:true,door:true,
    bb:true,ez:true,rack:true,bench:true,benchIncline:true,smith:true,cable:true,pulldown:true,legPress:true,legCurl:true,legExt:true,
    chestPress:true,shoulderPress:true,pecDeck:true,dip:true,rower:true,bike:true,treadmill:true};
  const mm=GH.moves.forPerson(m,eq);
  for (const pose of Object.keys(mm.poses)) {
    const c=document.createElement('div');c.className='cell';g.appendChild(c);
    try{GH.pose.still(c,mm,pose,{lead:!!mm.uni});}catch(e){c.textContent='ERR '+e.message;}
    const b=document.createElement('b');b.textContent=id+' · '+pose;c.appendChild(b);
  }
}
</script></body></html>`;
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build/contact.html'), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setContent(html);
const out = join(root, `build/contact${dark ? '-dark' : ''}${big ? '-big' : ''}${filter ? '-' + filter.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) : ''}.png`);
await page.screenshot({ path: out, fullPage: true });
// Also write readable slices (tall sheets are hard to view whole).
const height = await page.evaluate(() => document.body.scrollHeight);
const sliceH = big ? 372 * 3 + 8 : 204 * 5 + 8;
for (let i = 0, y = 0; y < height; i++, y += sliceH) {
  await page.screenshot({ path: out.replace(/\.png$/, `-${i}.png`), clip: { x: 0, y, width: 1440, height: Math.min(sliceH, height - y) }, fullPage: true });
}
await browser.close();
console.log(out, errors.length ? '\nERRORS:\n' + errors.join('\n') : '');
