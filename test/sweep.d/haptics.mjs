// The Feel each one gallery (src/ui/hapticsui.js): its top with the strength control, and the rest
// of it at full height, scrolled to the end.
export async function screens({ page, settle, act }) {
  return [
    ['sheet-haptics', async () => { await act('hapticGallery'); }],
    ['sheet-haptics-lower', async () => {
      await act('hapticGallery');
      await settle();
      await page.evaluate(() => {
        const top = window.GH.ui.topSheet();
        if (top && top.detent) top.detent('large');
        const d = [...document.querySelectorAll('dialog.hx-sheet[open]')].pop();
        const b = d && d.querySelector('.rf-sheet-body');
        if (b) b.scrollTop = b.scrollHeight;
      });
    }],
  ];
}
