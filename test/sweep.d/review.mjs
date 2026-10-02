// Sweep screens for the AI plan review (src/ui/review.js): Why this plan, the Coach's review with no
// AI set up, and a review's cards (suggestions checked by the planner itself, so no model is needed).
export async function screens({ page, settle, act }) {
  const large = async () => { await settle(500); await page.evaluate(() => { const t = window.GH.ui.topSheet(); if (t && t.detent) t.detent('large'); }); };
  return [
    ['why-plan', async () => { await act('whyPlan'); await large(); }],
    ['review-none', async () => { await act('reviewPlan'); await settle(1500); }],
    ['review-cards', async () => {
      await page.evaluate(() => {
        const GH = window.GH, U = GH.ui;
        const ctx = GH.planReview.context(U.S, U.today(), 'device');
        const sw = ctx.swaps[0];
        GH.planReview.open('why', { engine: 'app', note: 'Two changes the planner checked, and one it turned down.', suggestions: [
          sw ? { kind: 'swap_move', family: sw.family, move: sw.options[0], title: 'A new move to try for the same muscles', why: 'It works the same muscles in a slightly different way, which keeps the work fresh.' } : null,
          { kind: 'move_day', from: ctx.workDays[ctx.workDays.length - 1], to: ctx.freeDays[ctx.freeDays.length - 1], title: 'Move your last workout of the week', why: 'More rest before it.' },
          { kind: 'split', split: 'auto', title: 'Keep the planner\'s split', why: 'It already fits.' },
        ].filter(Boolean) });
      });
      await large();
    }],
  ];
}
