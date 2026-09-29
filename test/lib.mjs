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
