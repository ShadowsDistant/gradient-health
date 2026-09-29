/* Barcode scanning for food: a sheet with the back camera, a framing box and a torch button. The
 * reader (lazy/barcode.js, ZXing in WebAssembly) loads on first use. A code counts once it's read
 * twice in a row and its check digit is right, so a half-seen barcode never looks up the wrong
 * food. The camera stops the moment the sheet closes. You can always type the number instead.
 * GH.scanner.scan() → Promise of the digits, or null if you closed it.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const doc = G.document;
  const U = () => GH.ui;

  // EAN-13, EAN-8, UPC-A (12) and UPC-E (8, expanded) all end in a mod-10 check digit.
  function checksumOk(code) {
    const s = String(code || '');
    if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
    const digits = s.split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }
  // UPC-E is a squeezed UPC-A; Open Food Facts knows the long form.
  function expandUpcE(s) {
    if (!/^[01]\d{7}$/.test(s)) return s;
    const d = s.slice(1, 7), last = d[5];
    let body;
    if ('012'.includes(last)) body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
    else if (last === '3') body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
    else if (last === '4') body = `${d.slice(0, 4)}00000${d[4]}`;
    else body = `${d.slice(0, 5)}0000${last}`;
    return `${s[0]}${body}${s[7]}`;
  }
  function normalise(raw, format) {
    let s = String(raw || '').replace(/\D/g, '');
    if (format === 'upc_e' && s.length === 8) s = expandUpcE(s);
    return s;
  }

  let active = null; // the scan in progress: { stream, sheet, resolve, timer, stopped }
  function stop() {
    if (!active) return;
    const a = active;
    active = null;
    a.stopped = true;
    clearTimeout(a.timer);
    if (a.stream) for (const t of a.stream.getTracks()) { try { t.stop(); } catch (e) { /* ignore */ } }
    const v = a.sheet && a.sheet.el.querySelector('video');
    if (v) { try { v.pause(); v.srcObject = null; } catch (e) { /* ignore */ } }
  }

  const body = (msg) => `<div class="sc-wrap">
      <div class="sc-view"><video class="sc-video" playsinline muted autoplay></video><div class="sc-frame" aria-hidden="true"><i></i></div>
        <p class="sc-msg t-callout" role="status">${msg}</p></div>
      <div class="btn-row sc-tools">
        <button type="button" class="rf-btn" data-act="scanTorch" hidden>${U().icon('bolt')}Light</button>
        <button type="button" class="rf-btn" data-variant="plain" data-act="scanType">Type the number</button>
      </div>
      <form class="sc-type" hidden><div class="rf-field"><label class="rf-field-label" for="scCode">Barcode number</label>
        <div class="rf-field-control"><input class="rf-input" id="scCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off"></div></div>
        <button type="submit" class="rf-btn rf-glass" data-variant="tinted">Look it up</button></form>
    </div>`;
  const say = (text) => { const el = active && active.sheet.el.querySelector('.sc-msg'); if (el) el.textContent = text; };

  function scan() {
    if (active) stop();
    return new Promise((resolve) => {
      const a = { stream: null, sheet: null, resolve, timer: 0, stopped: false, last: null, torch: false };
      active = a;
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        stop();
        if (a.sheet && !a.sheet.closed) a.sheet.close('ok');
        resolve(code || null);
      };
      a.finish = finish;
      a.sheet = U().sheet({ title: 'Scan a barcode', detents: 'large', detent: 'large', cls: 'sc-sheet', body: body('Starting the camera…'), onClose: () => finish(null) });
      const el = a.sheet.el;
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        const s = normalise((el.querySelector('#scCode') || {}).value);
        if (!checksumOk(s)) { U().toast('That number doesn\'t look right', 'caution', 'Barcodes are 8, 12 or 13 digits. Check the last one.'); return; }
        finish(s);
      });
      start(a);
    });
  }

  async function start(a) {
    const nav = G.navigator;
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) { say('The camera isn\'t available here. Type the number instead.'); showType(); return; }
    const reader = GH.lazy('barcode').then((m) => m.ready.then(() => m.detector()));
    let stream;
    try {
      stream = await nav.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      if (a.stopped) return;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      say(denied ? 'Camera access is off. Allow it in the app\'s Android settings, or type the number.' : 'Couldn\'t start the camera. Type the number instead.');
      showType();
      return;
    }
    // Closed while the camera was starting: turn it straight off again.
    if (a.stopped) { for (const t of stream.getTracks()) { try { t.stop(); } catch (e) { /* ignore */ } } return; }
    a.stream = stream;
    const video = a.sheet.el.querySelector('video');
    video.srcObject = a.stream;
    try { await video.play(); } catch (e) { /* autoplay with muted is allowed; keep going */ }
    const track = a.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (caps && caps.torch) { const t = a.sheet.el.querySelector('[data-act="scanTorch"]'); if (t) t.hidden = false; }
    let detector;
    try { detector = await reader; } catch (e) {
      if (a.stopped) return;
      say('The barcode reader didn\'t load. Type the number instead.');
      showType();
      return;
    }
    if (a.stopped) return;
    say('Hold the barcode inside the box');
    loop(a, video, detector);
  }

  function loop(a, video, detector) {
    const tick = async () => {
      if (a.stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          const found = await detector.detect(video);
          if (a.stopped) return;
          const hit = (found || []).map((b) => ({ code: normalise(b.rawValue, b.format) })).find((b) => checksumOk(b.code));
          if (hit) {
            if (a.last === hit.code) { if (U().haptic) U().haptic('success'); a.finish(hit.code); return; }
            a.last = hit.code;
          } else a.last = null;
        } catch (e) { /* a frame that couldn't be read; try the next */ }
      }
      a.timer = setTimeout(tick, 120);
    };
    tick();
  }

  function showType() {
    const f = active && active.sheet.el.querySelector('.sc-type');
    if (!f) return;
    f.hidden = false;
    const input = f.querySelector('input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  GH.scanner = { scan, stop, checksumOk, expandUpcE, normalise };

  if (doc) {
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden' && active) { const f = active.finish; if (f) f(null); } });
    const A = () => (GH.ui && GH.ui.act) || null;
    const bind = () => {
      const act = A();
      if (!act) return false;
      act.scanType = () => showType();
      act.scanTorch = async (el) => {
        const a = active;
        const track = a && a.stream && a.stream.getVideoTracks()[0];
        if (!track) return;
        a.torch = !a.torch;
        try { await track.applyConstraints({ advanced: [{ torch: a.torch }] }); el.setAttribute('aria-pressed', String(a.torch)); } catch (e) { a.torch = !a.torch; }
      };
      return true;
    };
    if (!bind()) doc.addEventListener('DOMContentLoaded', bind);
  }
})(typeof window !== 'undefined' ? window : globalThis);
