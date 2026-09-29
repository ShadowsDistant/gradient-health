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
    errors: {},
  });
  const store = { state: '', secrets: {} };
  window.__haptics = [];
  window.AndroidBridge = {
    hcStatus: () => 'granted', hcRequest: () => {}, hcOpenSettings: () => {}, hcCanWrite: () => true, hcWriteWorkout: () => {},
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
  const S = B.newState({ goals: ['abs', 'arms', 'chest', 'legs'], experience: 'onoff', days: 4, minutes: 25, age: 24, units: 'lb', weightKg: 68.4, weightGoal: 'maintain', equipment: { db: [10, 15], kb: [15], band: true, chair: true, wall: true, towel: true }, lead: { arm: 'L', leg: null }, name: 'Alex' }, { pushups: 18, plankSec: 55, curlL: 12, curlR: 15 }, start);
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
