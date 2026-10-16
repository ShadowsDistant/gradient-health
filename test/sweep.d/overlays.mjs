// Sweep screens for what opens over the page (1.14): dialogs (two buttons, three, and one over a
// sheet), a menu (an activity's: its id starts with act- so the sweep clears the activities after
// it), two toasts stacked over Today and one over a sheet's button.
export async function screens({ page, settle, act, seedActs }) {
  const dialog = (o) => page.evaluate((x) => { window.GH.ui.dialog(x); }, o);
  return [
    ['dialog-two', async () => { await page.evaluate(() => { window.GH.ui.confirm('Train today instead?', 'The next workout moves to today, and the rest of the week follows.', 'Train today'); }); }],
    ['dialog-three', async () => { await dialog({ title: 'This can\'t be undone', message: 'Copy your data first if you might want it back.', icon: 'alert', tone: 'critical', actions: [{ label: 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label: 'Copy my data', value: 'copy', variant: 'gray' }, { label: 'Delete everything', value: 'delete', variant: 'filled', tone: 'critical' }] }); }],
    ['dialog-over-sheet', async () => { await act('chatList'); await settle(); await page.evaluate(() => { window.GH.ui.confirm('Delete all chats?', 'Every conversation with the coach goes from this phone. This can\'t be undone.', 'Delete all', 'critical', 'trash'); }); }],
    ['act-menu-open', async () => { await seedActs(); await page.evaluate(() => window.GH.ui.open('activity', 'seed-r3')); await settle(); await page.evaluate(() => { const b = document.querySelector('[data-act="actMenu"]'); if (b) b.click(); }); }],
    ['toasts-two', async () => { await page.evaluate(() => { const U = window.GH.ui; U.go('today'); U.toast('Removed from today', 'neutral', 'Bent-over row', { label: 'Undo' }); U.toast('Couldn\'t read Health Connect', 'caution', 'It took too long. Try again.'); }); }],
    ['toast-over-sheet', async () => { await act('planAround'); await settle(); await page.evaluate(() => window.GH.ui.toast('Saved', 'positive', 'Your plan updates from next week.')); }],
  ];
}
