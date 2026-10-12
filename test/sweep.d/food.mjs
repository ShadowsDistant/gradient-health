// Sweep screens for food in Health (1.12): the section in view, the Track calories invite for someone
// tracking protein, starting (the short sheet, and with each part open, and with no weight yet), meal
// times, and Add food from the + menu. The sweep's own list has the Food page and its other sheets.
// Nothing here is saved: the next screen starts from a reload.
export async function screens({ page, settle, act }) {
  const health = async () => { await page.evaluate(() => window.GH.ui.go('health')); await settle(); };
  const unsaved = (fn) => page.evaluate(fn);
  return [
    ['health-food', async () => {
      await health();
      await page.evaluate(() => { const s = document.getElementById('screen'); const f = s.querySelector('.hf'); if (f) s.scrollTop = f.getBoundingClientRect().top + s.scrollTop - 120; });
    }],
    ['health-food-invite', async () => {
      await unsaved(() => { const GH = window.GH; GH.store.save = () => true; GH.store.saveSoon = () => {}; GH.food.setMode(GH.ui.S, 'protein'); GH.ui.go('health'); GH.ui.render(); });
      await settle();
      await page.evaluate(() => { const s = document.getElementById('screen'); const f = s.querySelector('.hf-invite'); if (f) s.scrollTop = f.getBoundingClientRect().top + s.scrollTop - 120; });
    }],
    ['sheet-foodstart', async () => {
      await unsaved(() => { const GH = window.GH; GH.store.save = () => true; GH.store.saveSoon = () => {}; GH.food.setMode(GH.ui.S, 'protein'); GH.ui.go('health'); GH.ui.render(); });
      await settle();
      await act('foodStart');
    }],
    ['sheet-foodstart-more', async () => {
      await health();
      await act('foodStart');
      await settle(900);
      await page.evaluate(() => { const b = document.querySelector('dialog.rf-sheet[open] [data-act="fsMore"]'); if (b) b.click(); });
    }],
    ['sheet-foodstart-weight', async () => {
      await unsaved(() => { const GH = window.GH, S = GH.ui.S; GH.store.save = () => true; GH.store.saveSoon = () => {}; S.weights = []; S.profile.weightKg = null; GH.food.setMode(S, 'protein'); GH.ui.go('health'); GH.ui.render(); });
      await settle();
      await act('foodStart');
    }],
    ['sheet-mealtimes', async () => { await health(); await act('foodMealTimes'); }],
    ['sheet-addfood', async () => { await health(); await act('logFood'); }],
  ];
}
