// Shared test helpers: load the app's plain scripts into this process and a tiny checklist.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function load(...files) {
  for (const f of files) require(join(root, f));
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

// Serves dist/ over http on a free port, like the app's asset host (file:// can't fetch .wasm).
export async function serveDist() {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, normalize } = await import('node:path');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.gguf': 'application/octet-stream' };
  const base = join(root, 'dist');
  const server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      const file = join(base, path || 'gradient-health.html');
      if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/gradient-health.html`, close: () => new Promise((r) => server.close(r)) };
}
