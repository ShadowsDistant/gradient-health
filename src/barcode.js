/* The barcode reader, loaded the first time someone scans (lazy/barcode.js). ZXing compiled to
 * WebAssembly through the barcode-detector ponyfill (both MIT), so it works on phones without Google
 * Play services. The .wasm file ships in the app next to this script; nothing is downloaded.
 * Sets GH.barcode = { ready, detector() }.
 */
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';

const GH = window.GH || (window.GH = {});
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const script = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
const base = new URL('.', script).href;

// Without this the library would fetch the .wasm from a CDN (which the page's policy blocks anyway).
const ready = prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? base + path : prefix + path) },
  fireImmediately: true,
});

GH.barcode = {
  FORMATS,
  ready,
  detector: () => new BarcodeDetector({ formats: FORMATS }),
};
