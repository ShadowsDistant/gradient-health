// Browser-side fixtures shared by the screenshot script and the UI tests. Both functions are
// serialized into the page (addInitScript / evaluate), so they must not use anything from here.

// The Android bridge, with Health Connect granted and 40 days of believable data.
export function seedBridge() {
  const DAY = 86400000, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const wave = (i, a, b) => Math.sin(i * 1.7) * a + Math.cos(i * 0.6) * b;
  const days = []; for (let i = 40; i >= 0; i--) days.push(now - i * DAY);
  const payload = () => ({
    ok: true, tz: 'America/New_York', from: iso(now - 40 * DAY), to: iso(now),
    steps: days.map((t, i) => ({ date: new Date(t - 5 * 3600000).toISOString().slice(0, 10), count: Math.round(7200 + wave(i, 1600, 900) + i * 25) })),
    sleep: days.map((t, i) => ({ start: iso(t - 9.2 * 3600000 + wave(i, 1500000, 900000)), end: iso(t - 1.6 * 3600000), asleepMin: Math.round(425 + wave(i, 22, 14)) })),
    weight: days.filter((_, i) => i % 2 === 0).map((t, i) => ({ time: iso(t - 3 * 3600000), kg: 68.4 - i * 0.03 + wave(i, 0.15, 0.1) })),
    height: [{ time: iso(now - 60 * DAY), m: 1.76 }], bodyFat: [],
    restingHr: days.map((t, i) => ({ time: iso(t - 3600000), bpm: Math.round(60 - i * 0.05 + wave(i, 1.5, 1)) })),
    hrv: days.map((t, i) => ({ time: iso(t - 3600000), ms: Math.round(54 + i * 0.1 + wave(i, 4, 3)) })),
    exercise: [{ start: iso(now - 5 * DAY - 2 * 3600000), end: iso(now - 5 * DAY - 2 * 3600000 + 42 * 60000), type: 33, typeName: 'running', title: '' }],
    heartRate: [],
    activeKcal: days.map((t, i) => ({ date: new Date(t - 5 * 3600000).toISOString().slice(0, 10), kcal: Math.round(420 + wave(i, 90, 60)) })),
    distance: days.map((t, i) => ({ date: new Date(t - 5 * 3600000).toISOString().slice(0, 10), m: Math.round(5400 + wave(i, 1200, 700)) })),
    nutrition: [],
    errors: {},
  });
  // Open Food Facts answers for the online search and barcode tests.
  const offProduct = { code: '3017620422003', product_name: 'Hazelnut spread', brands: 'Example', serving_size: '15 g', serving_quantity: 15, nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0 } };
  const foodLookup = (kind, q, id) => {
    const body = kind === 'barcode' ? (String(q) === offProduct.code ? { status: 1, product: offProduct } : { status: 0 }) : { products: [offProduct, { code: '1', product_name: 'Broken', nutriments: { 'energy-kcal_100g': 5000 } }] };
    setTimeout(() => window.__gh.onFoodResult({ id, ok: true, status: 200, body: JSON.stringify(body) }), 40);
  };
  window.__foodWrites = [];
  const store = { state: '', secrets: {} };
  window.__haptics = [];
  // Background sync: allowed and on, the last read five minutes ago. A test can put reads the app
  // saved meanwhile in window.__pending ([{ id, payload }]) before the page loads; the ids the page
  // marks done collect in window.__pendingDone.
  window.__bg = { supported: true, granted: true, on: true, scheduled: true, lastRun: now - 5 * 60000, lastOk: now - 5 * 60000, error: null };
  window.__pending = window.__pending || [];
  window.__pendingDone = [];
  const bgJson = () => JSON.stringify(Object.assign({}, window.__bg, { pending: window.__pending.length }));
  window.AndroidBridge = {
    hcStatus: () => 'granted', hcRequest: () => {}, hcRequestFood: () => {}, hcOpenSettings: () => {}, hcCanWrite: () => true, hcWriteWorkout: () => {},
    hcGranted: () => JSON.stringify(['steps', 'sleep', 'weight', 'height', 'bodyFat', 'restingHr', 'hrv', 'exercise', 'heartRate', 'activeKcal', 'distance', 'nutrition', 'writeExercise', 'writeNutrition', 'background']),
    hcBackground: bgJson,
    hcBackgroundRequest: () => { window.__bg.granted = true; window.__bg.scheduled = window.__bg.on; setTimeout(() => { window.__gh.onHealthPerms('granted'); window.__gh.onHealthBackground(bgJson()); }, 30); },
    hcBackgroundSet: (on) => { window.__bg.on = !!on; window.__bg.scheduled = !!on && window.__bg.granted; },
    hcPending: () => JSON.stringify(window.__pending.slice(0, 50)),
    hcPendingDone: (json) => { const ids = JSON.parse(json); window.__pendingDone.push(...ids); window.__pending = window.__pending.filter((p) => !ids.includes(p.id)); },
    pendingLink: () => '',
    hcCanWriteFood: () => true,
    hcWriteFood: (json) => { const list = JSON.parse(json); window.__foodWrites.push(...list); setTimeout(() => window.__gh.onFoodWrite({ ok: true, ids: list.map((x) => x.id) }), 20); },
    hcDeleteFood: (json) => { const ids = JSON.parse(json); setTimeout(() => window.__gh.onFoodDelete({ ok: true, ids }), 20); },
    foodLookup, hapticStrength: () => {}, hapticsSystemEnabled: () => true,
    hcRead: () => { setTimeout(() => window.__gh.onHealth(payload()), 30); },
    save: (s) => { store.state = s; try { sessionStorage.setItem('shot-state', s); } catch (e) { /* ignore */ } return true; },
    load: () => { try { return sessionStorage.getItem('shot-state') || store.state; } catch (e) { return store.state; } },
    saveSecret: () => true, loadSecret: () => '', deleteSecret: () => true,
    keepAwake: () => {}, vibrate: () => {}, vibratePattern: () => {}, copy: () => true, openUrl: () => {},
    isDark: () => window.matchMedia('(prefers-color-scheme: dark)').matches, appVersion: () => window.GH && window.GH.VERSION,
    haptic: (k) => { window.__haptics.push(k); }, setSystemBars: () => {}, insets: () => JSON.stringify({ top: 30, bottom: 20, left: 0, right: 0, keyboard: false }),
    shareText: () => {}, claudeInstalled: () => true,
  };
}

// Five weeks of history, built with the app's own brain so every number is real.
export function seedState() {
  const B = window.GH.brain;
  const today = B.dayOf(Date.now(), 4);
  const start = today - 35;
  // Four workouts a week on the usual Mon, Tue, Thu, Fri, moved along the week when today falls on
  // one of the other days, so today is always a workout day whatever the date.
  const wd = today - B.weekStart(today);
  let shift = 0;
  while (![0, 1, 3, 4].map((x) => (x + shift) % 7).includes(wd)) shift++;
  const weekdays = shift ? [0, 1, 3, 4].map((x) => (x + shift) % 7).sort((a, b) => a - b) : null;
  const S = B.newState({ goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, weekdays, minutes: 25, age: 24, units: 'lb', weightKg: 68.4, weightGoal: 'maintain', equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null }, name: 'Alex' }, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, start);
  S.health.status = 'granted';
  for (let d = start; d < today; d++) {
    const plan = B.todayPlan(S, d);
    if (plan.type === 'workout') {
      const t0 = d * B.DAY_MS + (4 + 13 + (d % 3)) * 3600000;
      B.startWorkout(S, d, { now: t0 });
      let g = 0;
      while (S.active && S.active.idx < S.active.steps.length && g++ < 400) {
        const st = S.active.steps[S.active.idx];
        B.completeStep(S, st.kind === 'test' ? { value: st.side === 'L' ? 14 : 15 } : {});
        if (st.askRir) B.setRir(S, st.item, (d + S.active.idx) % 4 === 0 ? '3' : '12');
      }
      const res = B.finishWorkout(S, { rating: 'right', now: t0 + 24 * 60000 });
      S.pendingLines = res.lines;
    } else if (plan.type === 'light') { B.logLight(S, d, 'walk', true); B.logLight(S, d, 'mobility', true); }
    if (d % 7 !== 3) { B.addProtein(S, d, 26); B.addProtein(S, d, 40); B.addProtein(S, d, 35); B.addProtein(S, d, 30); }
  }
  B.addProtein(S, today, 26); B.addProtein(S, today, 32);
  S.feel[today] = { energy: 'good', sore: 'some' };
  S.seen = { tour: true, checklistHidden: true, lastVersion: window.GH.VERSION, tip_plan: true, tip_health: true, tip_progress: true, tip_moves: true, playerHint: true, rirCount: 5, moveSheet: true };
  S.measurements = [{ day: start + 1, waist: 81.5, armL: 30.4, armR: 31.6 }, { day: today - 1, waist: 80.6, armL: 31.1, armR: 31.8 }];
  window.GH.store.save(S);
}
