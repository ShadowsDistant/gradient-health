/* The body map: a front and a back view of a figure with 17 muscle regions, each coloured on a
 * sequential scale (Trained: sets, Improved: progress), plus a list of the same regions as buttons
 * for screen readers. U.bodyMap(values, opts) returns the markup; tapping a region runs
 * U.act.muscleOpen, which opens that muscle's sheet.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {};

  /* ---------------------------------------------------------------- geometry */
  // Shapes are drawn on the figure's right half of a 200-wide canvas (x = 100 is the midline) and
  // mirrored. A point is [x, y] or [x, y, k]: k scales the curve's tangent there (0 = a corner).
  // About eight heads tall: head 6-48, shoulders 64, navel 138, crotch 184, knees 248, soles 342.
  const BODY = [
    { mid: true, pts: [[100, 6], [109, 8.5], [114, 17], [114.5, 28], [112, 38], [106, 46], [100, 48.5], [94, 46], [88, 38], [85.5, 28], [86, 17], [91, 8.5]] }, // head
    { mid: true, pts: [[91.5, 40], [108.5, 40], [109.5, 52, 0.5], [114, 60], [100, 63], [86, 60], [90.5, 52, 0.5]] }, // neck
    { pts: [[98, 56, 0], [109, 57], [121, 60], [133, 63], [140, 69], [143, 78], [141, 88], [136, 94], [133, 100], [133, 112], [130, 124], [126, 136], [127, 146], [130, 158], [133, 170], [134, 180], [129, 188], [114, 190], [98, 188, 0]] }, // torso
    { pts: [[132, 64], [141, 68], [147, 77], [150, 90], [152, 104], [154, 118], [157, 132], [161, 148], [163, 164], [164, 180], [166, 194], [165, 208], [160, 214], [155, 208], [154, 192], [151, 178], [148, 164], [144, 150], [141, 136], [138, 120], [136, 104], [133, 92]] }, // arm
    { pts: [[133, 172], [137, 190], [137, 210], [134, 228], [130, 244], [129, 256], [131, 272], [129, 290], [125, 306], [121, 318], [124, 330], [121, 340], [111, 341], [108, 332], [109, 318], [106, 300], [104, 282], [104, 262], [104, 246], [102, 226], [101, 204], [98, 188, 0]] }, // leg
  ];
  const FRONT = {
    upperBack: [[[108, 47], [111, 53], [120, 57], [131, 61], [126, 64.5], [115, 63], [109, 60], [107, 54]]],
    frontDelts: [[[126, 65], [133, 62], [138, 66], [140, 76], [140, 88], [141, 98], [136, 97], [132, 90], [130, 78]]],
    sideDelts: [[[135, 62], [142, 66], [147, 75], [149, 87], [146, 98], [141, 99], [140, 88], [140, 76], [138, 66]]],
    chest: [[[101, 68, 0], [110, 64], [121, 63], [127, 66], [130, 74], [132, 86], [131, 96], [125, 102], [114, 106], [104, 106], [101, 101, 0]]],
    biceps: [[[136, 101], [141, 99], [147, 101], [151, 110], [153, 122], [152, 132], [147, 137], [142, 133], [139, 122], [137, 110]]],
    forearms: [[[141, 140], [148, 137.5], [155, 140], [159.5, 150], [162, 164], [162, 178], [160, 190], [156, 191], [152, 180], [147, 166], [143, 153]]],
    abs: [
      [[101.5, 109, 0], [112, 108], [114, 116], [113, 124], [101.5, 125, 0]],
      [[101.5, 128, 0], [113, 127], [114, 135], [113, 143], [101.5, 144, 0]],
      [[101.5, 147, 0], [113, 146], [113, 154], [112, 162], [101.5, 163, 0]],
      [[101.5, 166, 0], [111, 166], [110, 176], [105, 184], [101.5, 186, 0]],
    ],
    obliques: [[[116, 110], [123, 105], [130, 101], [132, 110], [130, 122], [127, 134], [126, 144], [128, 154], [124, 162], [117, 164], [115, 152], [115, 138], [115, 124]]],
    hipFlexors: [[[124, 166], [129, 172], [126, 182], [118, 190], [109, 196], [104, 193], [109, 184], [117, 174]]],
    quads: [
      [[131, 174], [136, 183], [138, 200], [136, 220], [132, 236], [127, 248], [123, 246], [122, 228], [124, 208], [127, 188]],
      [[126, 185], [124.5, 200], [123, 216], [121.5, 232], [119, 246], [112, 244], [110, 228], [111, 210], [114, 198], [119, 190]],
      [[107, 214], [111, 224], [114, 237], [113, 250], [108, 252], [104, 246], [103, 230], [104, 218]],
    ],
    calves: [
      [[103.5, 256], [110, 255], [114, 263], [115, 278], [112.5, 294], [108.5, 306], [105, 296], [103, 278]],
      [[126, 264], [130.5, 272], [130.5, 286], [127, 298], [123.5, 302], [123, 288], [124, 274]],
    ],
  };
  const BACK = {
    upperBack: [
      [[101, 44, 0], [107, 47], [115, 53], [126, 59], [136, 64], [128, 68], [120, 72], [115, 81], [111, 94], [106, 108], [101, 120, 0]],
      [[116, 84, 0.6], [129, 74], [137, 78], [137, 89], [128, 97], [119, 99, 0.6]],
    ],
    rearDelts: [[[130, 67], [137, 63], [143, 68], [146, 78], [144, 90], [138, 88], [133, 80]]],
    sideDelts: [[[138, 62], [145, 66], [149, 75], [150, 87], [147, 97], [144, 90], [146, 78], [143, 68]]],
    triceps: [
      [[145, 94], [150, 98], [154, 110], [154, 124], [149, 133], [145, 126], [145, 108]],
      [[138, 94], [144, 93], [145, 108], [145, 126], [141, 133], [138, 120], [137, 106]],
    ],
    forearms: [[[142, 140], [149, 137], [155, 141], [159, 152], [162, 166], [162, 180], [159, 191], [155, 191], [151, 180], [147, 165], [143, 152]]],
    lats: [[[114, 101], [122, 99], [132, 95], [137, 100], [136, 112], [133, 124], [128, 136], [121, 146], [114, 151], [110, 148], [109, 136], [110, 121], [111, 108]]],
    lowerBack: [[[101.5, 124, 0], [106, 122], [108, 136], [109, 152], [111, 166], [105, 170], [101.5, 168, 0]]],
    glutes: [
      [[111, 162], [121, 157], [130, 158], [135, 165], [135, 176], [129, 176], [120, 171], [112, 169]],
      [[101.5, 172, 0], [110, 169], [121, 172], [131, 178], [135, 190], [132, 202], [122, 208], [110, 208], [101.5, 204, 0]],
    ],
    hamstrings: [
      [[121, 212], [131, 212], [134, 226], [131, 240], [125, 250], [120, 244], [120, 228]],
      [[104, 212], [118, 212], [117, 230], [116, 246], [112, 251], [107, 242], [104, 228]],
    ],
    calves: [
      [[104, 258], [111, 255], [115, 262], [115, 278], [111, 292], [106, 290], [103, 274]],
      [[117, 257], [125, 257], [129, 266], [128, 281], [123, 292], [118, 290], [116, 274]],
      [[107, 296], [115, 294], [124, 296], [121, 308], [114, 314], [109, 308]],
    ],
  };
  const VIEWS = { front: FRONT, back: BACK };
  const VIEWBOX = '30 3 140 342';
  const TOP = 3, HEIGHT = 342;

  const r1 = (v) => Math.round(v * 10) / 10;
  // A closed Catmull-Rom curve through the points, as cubic Béziers.
  function smooth(pts) {
    const n = pts.length;
    const P = (i) => pts[(i + n) % n];
    const k = (i) => (P(i)[2] == null ? 1 : P(i)[2]);
    let d = `M${r1(P(0)[0])} ${r1(P(0)[1])}`;
    for (let i = 0; i < n; i++) {
      const a = P(i), b = P(i + 1), pa = P(i - 1), nb = P(i + 2);
      const ka = k(i) / 6, kb = k(i + 1) / 6;
      d += `C${r1(a[0] + (b[0] - pa[0]) * ka)} ${r1(a[1] + (b[1] - pa[1]) * ka)} ${r1(b[0] - (nb[0] - a[0]) * kb)} ${r1(b[1] - (nb[1] - a[1]) * kb)} ${r1(b[0])} ${r1(b[1])}`;
    }
    return d + 'Z';
  }
  const mirror = (pts) => pts.map((p) => [200 - p[0], p[1], p[2]]).reverse();
  const both = (pts) => [smooth(pts), smooth(mirror(pts))];

  // Path data, worked out once: the silhouette and each muscle's shapes per view, with the
  // vertical middle of each muscle (0 top to 1 bottom) for the top-to-bottom fill sweep.
  let GEO = null;
  function geometry() {
    if (GEO) return GEO;
    const body = BODY.flatMap((s) => (s.mid ? [smooth(s.pts)] : both(s.pts)));
    GEO = {};
    for (const [view, shapes] of Object.entries(VIEWS)) {
      GEO[view] = { body, muscles: [] };
      for (const [m, list] of Object.entries(shapes)) {
        const ys = list.flat().map((p) => p[1]);
        const y = ((Math.min(...ys) + Math.max(...ys)) / 2 - TOP) / HEIGHT;
        GEO[view].muscles.push({ m, y: Math.round(y * 100) / 100, d: list.flatMap(both) });
      }
      GEO[view].muscles.sort((a, b) => a.y - b.y);
    }
    return GEO;
  }

  /* ---------------------------------------------------------------- markup */
  const NAMES = { chest: 'Chest', abs: 'Abs', obliques: 'Obliques', upperBack: 'Upper back', lats: 'Lats', lowerBack: 'Lower back', glutes: 'Glutes', hipFlexors: 'Hip flexors', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', frontDelts: 'Front delts', sideDelts: 'Side delts', rearDelts: 'Rear delts' };
  const nameOf = (m) => (GH.body && GH.body.NAME && GH.body.NAME[m]) || NAMES[m] || m;
  U.muscleName = nameOf;
  const LEVELS = 5;
  // A value's step on the scale: 0 is no data, 1..5 split the range up to the largest value.
  function levelOf(v, max) {
    if (!(v > 0) || !(max > 0)) return 0;
    return Math.max(1, Math.min(LEVELS, Math.ceil((v / max) * LEVELS - 1e-9)));
  }
  U.bodyLevel = levelOf;

  function figure(view, levels, o) {
    const g = geometry()[view];
    const act = o.act === false ? '' : ` data-act="${o.act || 'muscleOpen'}"`;
    return `<figure class="bm-view" data-view="${view}">
      <svg class="bm-fig" viewBox="${VIEWBOX}" aria-hidden="true" focusable="false">
        <g class="bm-body">${g.body.map((d) => `<path d="${d}"/>`).join('')}</g>
        ${g.muscles.map((x) => `<g class="bm-m" data-muscle="${x.m}" data-l="${levels[x.m] || 0}"${act} data-arg="${x.m}" style="--y:${x.y}">${x.d.map((d) => `<path d="${d}"/>`).join('')}</g>`).join('')}
      </svg>
      ${o.captions === false ? '' : `<figcaption class="bm-cap t-caption">${view === 'front' ? 'Front' : 'Back'}</figcaption>`}
    </figure>`;
  }

  // U.bodyMap(values, opts): values maps a muscle to a number (sets, progress); anything missing or
  // not above 0 is drawn as no data. opts: mode ('trained' | 'improved': the colour scale), max (the
  // top of the scale, default the largest value), views (['front', 'back']), label(muscle, level)
  // for the screen-reader list, act (the tap action, false for none), captions, cls, key.
  U.bodyMap = (values, opts) => {
    const o = opts || {};
    const v = values || {};
    const max = o.max != null ? o.max : Math.max(0, ...Object.values(v).filter((x) => isFinite(x)));
    const levels = {};
    for (const m of Object.keys(NAMES)) levels[m] = levelOf(v[m], max);
    const views = o.views || ['front', 'back'];
    const label = o.label || ((m, l) => `${nameOf(m)}: ${l ? `level ${l} of ${LEVELS}` : 'no data'}`);
    const list = o.act === false ? '' : `<ul class="bm-sr" aria-label="${U.esc(o.listLabel || 'Muscles')}">${Object.keys(NAMES).map((m) => `<li><button type="button" data-act="${o.act || 'muscleOpen'}" data-arg="${m}">${U.esc(label(m, levels[m]))}</button></li>`).join('')}</ul>`;
    return `<div class="bm${o.cls ? ' ' + o.cls : ''}" data-mode="${U.esc(o.mode || 'trained')}"${o.key ? ` data-key="${U.esc(o.key)}"` : ''}>
      <div class="bm-stage">${views.map((view) => figure(view, levels, o)).join('')}</div>${list}
    </div>`;
  };

  // The legend for the scale: five steps from less to more, and the no-data swatch.
  U.bodyLegend = (mode, none) => `<div class="bm-legend t-caption" data-mode="${U.esc(mode || 'trained')}" aria-hidden="true">
      <span class="bm-key"><span>Less</span>${[1, 2, 3, 4, 5].map((l) => `<i class="bm-sw" data-l="${l}"></i>`).join('')}<span>More</span></span>
      <span class="bm-key"><i class="bm-sw" data-l="0"></i><span>${U.esc(none || 'None')}</span></span>
    </div>`;
})(typeof window !== 'undefined' ? window : globalThis);
