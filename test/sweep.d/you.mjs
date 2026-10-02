// Sweep screens for where things are (1.6): the You tab's help sheet, Settings with a search typed
// in (and with nothing found), and You for someone who only tracks their health.
export async function screens({ page, settle }) {
  const search = (q) => async () => {
    await page.evaluate(() => window.GH.ui.open('settings'));
    await settle();
    await page.fill('#setQ', q);
    await page.locator('#setQ').dispatchEvent('input');
  };
  return [
    ['you-help', async () => { await page.evaluate(() => window.GH.ui.go('you')); await settle(); await page.evaluate(() => window.GH.ui.act.openHelp()); }],
    ['settings-search', search('sound')],
    ['settings-search-none', search('nothing like this')],
    // Not saved (the next screen starts from a reload): workouts and calories off.
    ['you-health-only', async () => {
      await page.evaluate(() => {
        const GH = window.GH, U = GH.ui, S = U.S;
        GH.store.save = () => true; GH.store.saveSoon = () => {};
        S.profile.workouts = false;
        GH.food.setMode(S, 'protein');
        U.go('you');
        U.render();
      });
    }],
  ];
}
