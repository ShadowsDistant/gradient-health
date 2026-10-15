// Sweep screens for set-up (1.6): the first run's screens in their longest states (Build muscle with
// its areas, days picked that skip today, every kit chip with the weights open, home and gym, an
// answer out of range), "Anything to plan around?" with a lot picked (and with the questions
// osteoporosis and type 2 diabetes bring, answered), the plan (plain, and built
// around someone), a friend's plan's three screens, Just tracking food?'s four, the detailed screens
// Your answers keeps, the first week's checklist with the level check, and the tour's first and
// last cards.
export async function screens({ page, settle, act, setup, chips }) {
  const next = async (n = 1) => { for (let i = 0; i < n; i++) { await page.locator('.ob-actions [data-variant="tinted"]').click(); await settle(400); } };
  const fill = async (k, v) => { const el = page.locator(`.onboard input[data-k="${k}"]`); await el.fill(String(v)); await el.dispatchEvent('change'); await settle(200); };
  const open = async (key) => { await page.evaluate((k) => { const d = document.querySelector(`.onboard details[data-more="${k}"]`); if (d) d.open = true; }, key); await settle(300); };
  const around = async (picks) => { await page.click('.onboard [data-act="obAround"]'); await settle(700); await chips(picks.map((p) => `dialog[open] .rf-chip[data-list="${p[0]}"][data-v="${p[1]}"]`)); };
  // "See my plan": "Building your plan" for a moment, then the plan.
  const toPlan = async () => { await next(); await settle(1600); };
  // A plan a friend sent, waiting while set-up shows (not saved: the next screen starts from a reload).
  const friend = async (n) => {
    await page.evaluate(async () => {
      const GH = window.GH, U = GH.ui, C = GH.customPlan;
      GH.store.save = () => true; GH.store.saveSoon = () => {};
      U.S.profile.onboarded = false;
      const plan = C.normalize({ name: 'Sam\'s gym split with a long name', note: 'Heavy first, then the rest.', days: [{ title: 'Upper body and a long title', items: [{ move: 'bench_bb', sets: 4, reps: 6 }, { move: 'row_cable', sets: 3, reps: 10 }, { move: 'side_plank', sets: 2, secs: 30 }, { move: 'curl_std', sets: 3, reps: 12 }, { move: 'press_db', sets: 3, reps: 10 }, { move: 'push_std', sets: 2, reps: 12 }] }, { title: 'Lower', items: [{ move: 'squat_bb', sets: 4, reps: 6 }, { move: 'hg_rdl', sets: 3, reps: 10 }] }, { title: 'Upper again', items: [{ move: 'push_std', sets: 3, reps: 10 }] }] }).plan;
      window.__gh.onLink(C.link(await C.encode(plan, { from: 'Samantha' })));
      U.showOnboarding();
    });
    await settle(1200);
    if (n) await next(n);
    await settle(600);
  };
  // Just tracking food?, n screens past its first.
  const food = async (n, pick) => {
    await setup(0);
    await page.click('.ob-actions [data-act="obFood"]');
    await settle(500);
    if (n) { await fill('_w', 182); await next(n); }
    if (pick) await pick();
  };
  return [
    ['setup-welcome', async () => { await setup(0); await settle(1200); }],
    ['setup-want', async () => { await setup(1, async () => { await chips(['.ob-opt[data-arg="muscle"]', '.ob-areas [data-v="legs"]', '.ob-areas [data-v="shoulders"]', '.ob-opt[data-arg="mobility"]', '.ob-opt[data-arg="fat"]']); }); }],
    // Five days, then today (a Monday) tapped off: "Your days. First workout: Tuesday."
    ['setup-time', async () => { await setup(2, async () => { await page.click('.onboard input[name="obDaysN"][value="5"]', { force: true }); await settle(300); await page.click('.onboard .ob-wd[data-arg="0"]'); }); }],
    ['setup-where', async () => { await setup(3, async () => { await chips(['.onboard .ob-kit [data-v="db"]', '.onboard .ob-kit [data-v="kb"]', '.onboard .ob-kit [data-v="band"]', '.onboard .ob-kit [data-v="ball"]']); await open('weights'); await open('house'); }); }],
    ['setup-where-both', async () => { await setup(3, async () => { await page.click('.onboard .ob-tile[data-arg="both"]'); await settle(300); await chips(['.onboard .ob-kit [data-v="db"]']); await open('gym'); }); }],
    ['setup-you', async () => { await setup(4, async () => { await fill('age', 72); await page.click('.onboard .ob-opt[data-arg="3plus"]'); await settle(200); await open('size'); }); }],
    ['setup-you-error', async () => { await setup(4, async () => { await fill('age', 150); await page.locator('.ob-actions [data-variant="tinted"]').click(); }); }],
    ['setup-around', async () => { await setup(4, async () => { await fill('age', 68); await around([['_pain', 'knee'], ['careful', 'shoulder'], ['conditions', 'oa'], ['conditions', 'bp'], ['conditions', 'balance']]); }); }],
    // 1.13: osteoporosis and type 2 diabetes, each with its question answered, scrolled to them.
    ['setup-around-follow-ups', async () => {
      await setup(4, async () => {
        await fill('age', 66);
        await around([['conditions', 'osteo'], ['conditions', 'diabetes']]);
        await chips(['dialog[open] .rf-segmented[data-follow="osteo"] .rf-segment[data-arg="no"]', 'dialog[open] .rf-segmented[data-follow="diabetes"] .rf-segment[data-arg="unsure"]']);
        await page.locator('dialog[open] .rf-segmented[data-follow="osteo"]').scrollIntoViewIfNeeded();
      });
    }],
    ['setup-plan', async () => { await setup(4, async () => { await toPlan(); }); }],
    ['setup-plan-around', async () => { await setup(4, async () => { await fill('age', 72); await around([['conditions', 'balance'], ['conditions', 'bp']]); await page.click('dialog[open] [data-act="obAroundDone"]'); await settle(600); await toPlan(); }); }],
    ['setup-friend', () => friend(0)],
    ['setup-friend-where', () => friend(2)],
    ['setup-friend-plan', () => friend(3)],
    ['setup-food-about', () => food(0)],
    ['setup-food-goal', () => food(1, async () => { await page.click('.onboard .ob-opt[data-arg="lose"]'); }) ],
    ['setup-food-targets', () => food(2)],
    ['setup-food-health', () => food(3)],
    // Your answers: the detailed screens (as before 1.6), one with an answer out of range, and the
    // last screen of the whole list.
    ['edit-about', async () => { await page.evaluate(() => window.GH.ui.editAnswers('about')); await settle(600); await fill('age', 150); await page.locator('.ob-actions [data-variant="tinted"]').click(); }],
    ['edit-goals', async () => { await page.evaluate(() => window.GH.ui.editAnswers('goals')); }],
    ['edit-body', async () => { await page.evaluate(() => window.GH.ui.editAnswers('body')); }],
    ['edit-nutrition', async () => { await page.evaluate(() => window.GH.ui.editAnswers('nutrition')); }],
    ['edit-plan', async () => { await page.evaluate(() => window.GH.ui.editAnswers()); await settle(600); for (let i = 0; i < 12 && await page.locator('.ob-actions [data-act="obNext"]').count(); i++) await next(); }],
    // The first week (not saved): Getting started, with the level check still to do.
    ['checklist', async () => {
      await page.evaluate(() => { const GH = window.GH, U = GH.ui, S = U.S; GH.store.save = () => true; GH.store.saveSoon = () => {}; delete S.seen.checklistHidden; S.profile.startDay = U.today() - 2; U.go('today'); U.render(); });
      await settle();
      await page.evaluate(() => { const c = document.querySelector('#screen .checklist'); if (c) c.scrollIntoView({ block: 'center' }); });
    }],
    ['tour', async () => { await act('showTour'); }],
    ['tour-last', async () => { await act('showTour'); await settle(); for (let i = 0; i < 2; i++) { await page.click('dialog[open] [data-act="tourNext"]'); await settle(600); } }],
  ];
}
