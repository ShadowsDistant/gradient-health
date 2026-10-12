/* Barcode scanning for food: a sheet with the back camera, a wide box to hold the code in, the light
 * and "Type the number". The camera starts at once (the back one, 1920 x 1080) while the reader
 * loads alongside (lazy/barcode.js and its worker: src/barcode.js says how it focuses, zooms and
 * reads). A code only counts when it's surely right (an EAN-13 or UPC-A on its first read with a
 * right check digit, an EAN-8 or UPC-E read twice within about a second), so a half-seen barcode
 * never looks up the wrong food. The camera stops the moment the sheet closes. You can always type
 * the number instead.
 * GH.scanner.scan() → Promise of the digits, or null if you closed it.
 * GH.scanner.scan({ qr: true, accept(text) }) reads QR codes instead (a shared plan): the first read
 * that accept() takes counts (QR codes carry their own error correction), and a link can be pasted.
 * GH.scanner.stats() → the last scan's numbers (which engine read it, frames, zoom, focus, hints).
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

  let active = null; // the scan in progress (see scan)
  let last = null; // its numbers, kept for stats()
  function stop() {
    if (!active) return;
    const a = active;
    active = null;
    a.stopped = true;
    for (const f of a.cleanup.splice(0)) { try { f(); } catch (e) { /* ignore */ } }
    if (a.stream) for (const t of a.stream.getTracks()) { try { t.stop(); } catch (e) { /* ignore */ } }
    const v = a.sheet && a.sheet.el.querySelector('video');
    if (v) { try { v.pause(); v.srcObject = null; } catch (e) { /* ignore */ } }
  }

  const body = (msg, qr) => `<div class="sc-wrap${qr ? ' sc-qr' : ''}">
      <div class="sc-view"><video class="sc-video" playsinline muted autoplay></video><div class="sc-frame" aria-hidden="true"><i></i></div><span class="sc-lock" aria-hidden="true" hidden></span><span class="sc-focus" aria-hidden="true" hidden></span>
        <p class="sc-msg t-callout" role="status">${msg}</p></div>
      <div class="btn-row sc-tools">
        <button type="button" class="rf-btn" data-act="scanTorch" aria-pressed="false" hidden>${U().icon('bolt')}Light</button>
        <button type="button" class="rf-btn" data-variant="plain" data-act="scanType">${qr ? 'Paste a link instead' : 'Type the number'}</button>
      </div>
      <form class="sc-type" hidden>${qr
    ? `<div class="rf-field"><label class="rf-field-label" for="scCode">Plan link</label>
        <div class="rf-field-control"><input class="rf-input" id="scCode" type="url" inputmode="url" maxlength="4000" autocomplete="off" placeholder="https://…"></div></div>
        <button type="submit" class="rf-btn rf-glass" data-variant="tinted">Open the plan</button>`
    : `<div class="rf-field"><label class="rf-field-label" for="scCode">Barcode number</label>
        <div class="rf-field-control"><input class="rf-input" id="scCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off"></div></div>
        <button type="submit" class="rf-btn rf-glass" data-variant="tinted">Look it up</button>`}</form>
    </div>`;

  function scan(opts) {
    const o = opts || {};
    if (active) stop();
    return new Promise((resolve) => {
      // stopped: the sheet closed; locked: a code was caught. cleanup runs as it stops.
      const a = { stream: null, sheet: null, stopped: false, locked: false, torch: false, cleanup: [], stats: {}, started: G.performance ? G.performance.now() : Date.now(), qr: !!o.qr, accept: o.accept || null, notThis: o.notThis || '' };
      active = a;
      last = a.stats;
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        stop();
        if (a.sheet && !a.sheet.closed) a.sheet.close('ok');
        resolve(code || null);
      };
      a.finish = finish;
      a.say = (text) => { const m = a.sheet && a.sheet.el.querySelector('.sc-msg'); if (m && m.textContent !== text) m.textContent = text; };
      a.showTorch = () => { const t = a.sheet.el.querySelector('[data-act="scanTorch"]'); if (t) t.hidden = false; };
      a.fail = () => { if (a.stopped) return; a.say(`The ${a.qr ? 'code' : 'barcode'} reader didn't load. ${a.qr ? 'Paste the link' : 'Type the number'} instead.`); showType(); };
      a.sheet = U().sheet({ title: o.title || (a.qr ? 'Scan a code' : 'Scan a barcode'), size: 'fit', cls: 'sc-sheet', body: body('Starting the camera…', a.qr), onClose: () => finish(null) });
      const el = a.sheet.el;
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        if (a.qr) {
          const text = String((el.querySelector('#scCode') || {}).value || '').trim();
          if (!text || (a.accept && !a.accept(text))) { if (U().haptic) U().haptic('deny'); U().toast(o.badLink || 'That link doesn\'t hold a plan', 'caution', 'Copy the whole link and paste it again.'); return; }
          finish(text);
          return;
        }
        const s = normalise((el.querySelector('#scCode') || {}).value);
        if (!checksumOk(s)) { if (U().haptic) U().haptic('deny'); U().toast('That number doesn\'t look right', 'caution', 'Barcodes are 8, 12 or 13 digits. Check the last one.'); return; }
        finish(s);
      });
      start(a);
    });
  }

  async function start(a) {
    const nav = G.navigator;
    const instead = a.qr ? 'paste the link' : 'type the number';
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) { a.say(`The camera isn't available here. ${a.qr ? 'Paste the link' : 'Type the number'} instead.`); showType(); return; }
    // The reader loads while the camera starts.
    const reader = GH.lazy('barcode');
    reader.catch(() => {});
    let stream;
    try {
      // The back camera at 1920 x 1080 as it comes (no scaling), so a code a hand's length away
      // still has pixels enough with the picture magnified.
      stream = await nav.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, resizeMode: { ideal: 'none' } } });
    } catch (e) {
      if (a.stopped) return;
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      a.say(denied ? `Camera access is off. Allow it in the app's Android settings, or ${instead}.` : `Couldn't start the camera. ${a.qr ? 'Paste the link' : 'Type the number'} instead.`);
      showType();
      return;
    }
    // Closed while the camera was starting: turn it straight off again.
    if (a.stopped) { for (const t of stream.getTracks()) { try { t.stop(); } catch (e) { /* ignore */ } } return; }
    a.stream = stream;
    const video = a.sheet.el.querySelector('video');
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay with muted is allowed; keep going */ }
    const since = () => Math.round((G.performance ? G.performance.now() : Date.now()) - a.started);
    a.stats.cameraAt = since();
    let m;
    try { m = await reader; } catch (e) { a.fail(); return; }
    if (a.stopped) return;
    a.stats.readerAt = since();
    a.say(m.HINTS[a.qr ? 'aimQr' : 'aim']);
    try { m.run(a); } catch (e) { a.fail(); }
  }

  function showType() {
    const f = active && active.sheet.el.querySelector('.sc-type');
    if (!f) return;
    f.hidden = false;
    const input = f.querySelector('input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  GH.scanner = { scan, stop, checksumOk, expandUpcE, normalise, stats: () => (last ? Object.assign({}, last) : null) };

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
        try { await track.applyConstraints({ advanced: [{ torch: a.torch }] }); el.setAttribute('aria-pressed', String(a.torch)); a.stats.torchOn = a.torch; } catch (e) { a.torch = !a.torch; }
      };
      return true;
    };
    if (!bind()) doc.addEventListener('DOMContentLoaded', bind);
  }
})(typeof window !== 'undefined' ? window : globalThis);
