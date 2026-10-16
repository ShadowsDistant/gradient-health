// Sweep screens for where things are (1.6): the You tab's help sheet, each of Settings' pages (the
// top page and AI coach's are in sweep.mjs), Notifications with them on, the search (something found,
// nothing found, and a result opened at its row), and You for someone who only tracks their health.
export async function screens({ page, settle }) {
  const open = (arg) => async () => { await page.evaluate((a) => window.GH.ui.open('settings', a), arg); };
  const search = (q) => async () => {
    await page.evaluate(() => window.GH.ui.open('settings'));
    await settle();
    await page.fill('#setQ', q);
    await page.locator('#setQ').dispatchEvent('input');
  };
  return [
    ['you-help', async () => { await page.evaluate(() => window.GH.ui.go('you')); await settle(); await page.evaluate(() => window.GH.ui.act.openHelp()); }],
    ...['workouts', 'track', 'hc', 'notify', 'feel', 'look', 'general', 'data', 'about'].map((id) => [`settings-${id}`, open(id)]),
    // Not saved (the next screen starts from a reload): notifications on, at a time picked.
    ['settings-notify-on', async () => {
      await page.evaluate(() => {
        const GH = window.GH, S = GH.ui.S;
        GH.store.save = () => true; GH.store.saveSoon = () => {};
        Object.assign(S.profile.prefs.notify, { on: true, time: 18 * 60 });
        GH.ui.open('settings', 'notify');
      });
    }],
    ['settings-search', search('sound')],
    ['settings-search-none', search('nothing like this')],
    ['settings-found', async () => { await search('spoken')(); await settle(); await page.click('#screen .set-results [data-act="setFind"]'); }],
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
