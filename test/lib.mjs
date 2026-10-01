// Shared test helpers: load the app's plain scripts into this process and a tiny checklist.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function load(...files) {
  for (const f of files) {
    require(join(root, f));
    // The plan engine's optimizer goes with the brain, so tests that load brain.js get both.
    if (f === 'src/brain.js') require(join(root, 'src/optimizer.js'));
  }
  return globalThis.GH;
}

let failures = 0;
let passes = 0;
export function check(name, ok, detail) {
  if (ok) { passes++; console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}${detail != null ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
  return ok;
}
export function section(title) { console.log(`\n${title}`); }
export function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

// Serves dist/ over http on a free port, like the app's asset host (file:// can't fetch .wasm), with
// Range requests (the on-device model is read in slices). extra maps more paths to files on disk.
export async function serveDist(extra = {}) {
  const { createServer } = await import('node:http');
  const { statSync, createReadStream, existsSync } = await import('node:fs');
  const { extname, normalize, sep } = await import('node:path');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
  const base = join(root, 'dist');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = extra[path] || join(base, normalize(path === '/' ? 'gradient-health.html' : path).replace(/^[/\\]+/, ''));
    if (!extra[path] && !file.startsWith(base + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    const size = statSync(file).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0, end = size - 1, status = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else start = Math.max(0, size - Number(m[2]));
      if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
      status = 206;
    }
    const headers = { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/gradient-health.html`, close: () => new Promise((r) => server.close(r)) };
}
