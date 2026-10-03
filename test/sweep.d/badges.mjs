// Badges in the sweep: the gallery (all, earned, next up), a badge's sheet (earned, locked), the
// reveal with several pages, the share preview and the player's Next screen with its badge card.
export async function screens({ page, settle, act }) {
  const earn = (ids) => page.evaluate((list) => { const U = window.GH.ui, S = U.S, now = Date.now(); for (const id of list) S.achievements.earned[id] = { day: U.today(), at: now }; }, ids);
  return [
    ['badges', async () => { await page.evaluate(() => window.GH.ui.open('badges')); }],
    ['badges-earned', async () => { await page.evaluate(() => window.GH.ui.open('badges')); await settle(); await page.click('#screen [data-on="badgeFilter"] input[value="earned"]', { force: true }); }],
    ['badges-next', async () => { await page.evaluate(() => window.GH.ui.open('badges')); await settle(); await page.click('#screen [data-on="badgeFilter"] input[value="next"]', { force: true }); }],
    ['badges-lower', async () => { await page.evaluate(() => window.GH.ui.open('badges')); await settle(); await page.evaluate(() => { const s = document.getElementById('screen'); s.scrollTop = s.scrollHeight * 0.6; }); }],
    ['badge-detail', async () => { await page.evaluate(() => window.GH.ui.badgeDetail('first')); await settle(1200); }],
    ['badge-detail-locked', async () => { await page.evaluate(() => window.GH.ui.badgeDetail('halfMarathon')); await settle(1200); }],
    ['badge-reveal', async () => { await earn(['w25', 'streak30', 'halfMarathon']); await page.evaluate(() => window.GH.ui.badgeReveal(['w25', 'streak30', 'halfMarathon'])); await settle(1600); }],
    ['badge-share', async () => { await act('badgeShare', 'first'); await settle(1600); }],
    ['badge-next-screen', async () => {
      await page.evaluate(() => {
        const U = window.GH.ui, S = U.S, B = window.GH.brain;
        window.GH.store.save = () => true; window.GH.store.saveSoon = () => {};
        delete S.achievements.earned.w10; // earned again by this workout's check: a card to show
        U.go('today');
        U.act.startWorkout();
        for (let g = 0; S.active && S.active.idx < S.active.steps.length && g < 400; g++) { const st = S.active.steps[S.active.idx]; B.completeStep(S, st.kind === 'test' ? { value: 12 } : {}); if (st.askRir) B.setRir(S, st.item, '12'); }
        U.openCheckin();
      });
      await settle(900);
      await page.click('#player [data-act="plSaveCheckin"]');
      await settle(2400);
    }],
  ];
}
