// Sweep screens for the workout player's reps left (src/ui/player.js): a set whose line names its
// aim (a top goal's 1-2 when there is one), and "How many more could you have done?" with its four
// answers (0, 1-2, 3, 4+). Nothing is saved, so the reload after each screen leaves no workout going.
export async function screens({ page, settle, act }) {
  const start = async () => {
    await page.evaluate(() => { const GH = window.GH; GH.store.save = () => true; GH.store.saveSoon = () => {}; GH.ui.go('today'); });
    await settle();
    await act('startWorkout');
    await settle(1500);
  };
  return [
    ['player-aim', async () => {
      await start();
      await page.evaluate(() => {
        const U = window.GH.ui, a = U.S.active;
        const sets = a.steps.map((st, i) => [st, i]).filter(([st]) => st.kind === 'set' && !st.item.timed && !st.leadOnly);
        const pick = sets.find(([st]) => st.item.effort && st.item.effort.why === 'size') || sets[0];
        a.idx = pick[1];
        U.openPlayer();
      });
    }],
    ['player-reps-left', async () => {
      await start();
      await page.evaluate(() => {
        const U = window.GH.ui, a = U.S.active;
        a.idx = a.steps.findIndex((st) => st.kind === 'set' && st.askRir && !st.item.timed);
        U.act.plDone();
        U.act.plSkipRest();
      });
    }],
  ];
}
