/* What's new, newest first. Shown once after an update and any time from Profile. Each version's
   entry also goes in its GitHub release's notes (scripts/release-notes.mjs), and its `store` text is
   the same news in 500 characters at most, for a store's What's new field (test/release.mjs checks). */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.CHANGELOG = [
    {
      version: '1.5.0', date: '2026-10-01', title: 'Runs with GPS, plans for every body, and plans of your own',
      store: [
        '• GPS for runs, walks, hikes and rides: a route map, splits, and heart rate from your watch',
        '• Plans that adapt to your age and to arthritis, back pain, balance problems and more, with 71 new seated and supported moves',
        '• Make your own plan, or have the coach build one, and share it with a QR code or a link',
        '• Health Connect syncs in the background every 15 minutes',
        '• A clearer set-up, smoother exercise animations, and 3D figures that show at once',
      ].join('\n'),
      items: [
        ['navigate', 'Record a run, walk, hike or ride from Today or Health. You see your route, distance, pace and steps as you go, with a notification to pause or finish from. Afterwards there\'s a summary with your map, splits and elevation, heart rate and calories from your watch through Health Connect, and your personal records.'],
        ['refresh', 'Health Connect can sync in the background every 15 minutes, so your history has no gaps on days you don\'t open the app. Turn it on in Settings.'],
        ['people', 'Plans for every body. Your plan adapts to your age: livelier under 30, gentler warm-ups and balance work from 50, and supported moves from 65. It also adapts to arthritis (with a flare-day switch), osteoporosis, back pain, blood pressure, balance, painful wrists or a wheelchair. There are 71 new seated, supported and balance moves.'],
        ['compose', 'Make your own plan like a playlist from the move library, or describe what you want and let the coach build one. It runs like the coach\'s plan, and anything you can\'t do is swapped for the closest move you can.'],
        ['share', 'Share a plan with a QR code or a link. Your friend scans or taps it, sees the whole plan and saves it, with swaps for anything their kit or body rules out.'],
        ['sparkle', 'A clearer set-up: fewer steps in named sections, gentle checks as you type, and a summary of your plan at the end. "Workouts and health" no longer asks about food.'],
        ['person', 'Every exercise animation is checked frame by frame. The triceps moves no longer spin, hands and dumbbells don\'t flip, feet stay planted, arms swing against the legs, and a dozen moves show better technique.'],
        ['bolt', '3D figures appear at once: they warm up right after launch, and a picture of the figure shows until it starts moving.'],
      ],
    },
    {
      version: '1.4.0', date: '2026-09-30', title: 'A coach that answers, and a new Plan, Health and Progress',
      items: [
        ['chip', 'The on-device coach answers now. It runs on your phone\'s fast cores in its own engine, several times quicker than before, reads your data ahead so answers start in seconds, and checks each one against your numbers. Phones with 8 GB or more get the Balanced size suggested, for better answers.'],
        ['sparkle', 'Ask the coach from any tab with the sparkle at the top left. The chat suggests questions from your data, shows what each answer used, and keeps answering when you close it.'],
        ['sliders', 'Tailor my plan: say what you want ("more legs, my knees hurt, 20 minutes", "train my calves more") and the coach shows the changes before anything changes. Undo is always there.'],
        ['calendar', 'A new Plan tab: your week as a strip of days, any day a tap away with its exercises shown in 3D, workouts you can move by tapping or dragging, and sets per muscle against their targets.'],
        ['heart', 'Health is redesigned: your week at a glance, and every number opens its history, with a chart, where each value came from, and a way to add or fix your own.'],
        ['person', 'Progress shows your body: a map of the muscles you\'ve trained and where you\'ve got stronger, with each muscle\'s story a tap away.'],
        ['dumbbell', '46 new exercises (212 in all) that fit your kit: overhead presses, rows, calf raises and hamstring curls with just a chair, a wall and a towel. Warm-ups and cool-downs follow the day\'s muscles, and the kettlebell halo circles your head properly now.'],
        ['layers', 'Sheets slide up from the bottom and follow your finger: swipe up for the full view or down to close, with a springy settle and no more stutter.'],
        ['bolt', 'Haptics you can feel: stronger, with a different feel for taps, toggles, timers, finished sets and new bests. Try them in Settings.'],
        ['wave', 'The colours behind each page drift slowly. Turn it off in Settings, Appearance.'],
        ['check-circle', 'Fixes: picking your workout days sets how many a week (Monday to Friday means five), and food sheets no longer run off the edge.'],
      ],
    },
    {
      version: '1.3.1', date: '2026-09-29', title: 'A round of fixes',
      items: [
        ['refresh', 'Undo after cancelling a workout brings it back properly. Before, logging a set afterwards could fail until the app restarted.'],
        ['library', 'A "Why" link opens its rule once, and How it works no longer ends up shifted to one side.'],
        ['person', 'Exercise animations no longer go missing when you open a move right after closing another, and the 3D figure comes back after the app has been in the background.'],
        ['chip', 'The on-device coach no longer calls a finished workout day a light day, switches to a new model as soon as it has downloaded, and can clear an old unfinished download. Questions picked from the weekly report always get sent.'],
        ['lock', 'The privacy policy link on the Claude screen opens on top instead of turning Claude down.'],
      ],
    },
    {
      version: '1.3.0', date: '2026-09-29', title: 'A smarter coach, and workouts you can cancel',
      items: [
        ['chip', 'The on-device coach is much better: newer Qwen3.5 models in three sizes (Fast, Balanced and Best answers), and every answer starts from what the app has already worked out from your numbers and the research behind it. Follow-up questions start answering sooner. The chat is now the on-device coach or Claude.'],
        ['close', 'Cancel a workout: go back and pick Cancel workout, or tap Cancel on Today. Nothing from it is saved or counts against your streak, and Undo brings it back.'],
        ['person', 'Exercise animations always play, even with Battery Saver or reduced animations on, and the box never sits empty while the 3D figure loads. With reduced animations there\'s a Pause button.'],
        ['library', 'How it works is redesigned: rules grouped by training, recovery, food and habits, a one-line summary for each, and the research a tap away.'],
        ['sparkle', 'A more polished look: the app\'s colours glow softly behind each page, sheets have thicker glass and set the page back when pulled up, and the chat shimmers while the coach thinks.'],
        ['check-circle', 'Fixes: a blue ring round the sheet handle, sheets taller than what\'s in them, and the how-to sheet leaving an exercise paused.'],
      ],
    },
    {
      version: '1.2.0', date: '2026-09-29', title: 'Gradient Health: gym, food and a coach you can see',
      items: [
        ['heart', 'A new name, Gradient Health, and a new icon.'],
        ['person', 'A 3D figure shows every exercise: a realistic body, smooth motion at the right tempo, the working muscles lit up, and you can drag it to see it from any side. A strip under it shows how long to take on each half of a rep. Pick its skin tone and shirt in Settings.'],
        ['dumbbell', 'Gym mode: barbells, racks, cables and machines, 45 gym exercises, and weights that go up once you hit the top of your reps, with strength charts on Progress. Train at home, at a gym, or pick each day.'],
        ['food', 'Food tracking if you want it: calories and macros, a built-in food list, your own foods, quick add, saved meals, online search and barcode scanning. Or keep just the protein goal, or turn food off.'],
        ['sliders', 'Choose what the app tracks. Workouts, food, or both, and food and health without workouts works too.'],
        ['sparkle', 'Your coach shows its work: what it changed today and why, what it suggests, what it\'s keeping an eye on, and every change it made lately.'],
        ['chip', 'Chat with an AI model that runs on your phone. It works offline and nothing you ask leaves the phone.'],
        ['chart', 'Workouts fit your goals more closely: your top goals go first, rep ranges match the goal, sets per muscle follow how you recover, and the first session back after a break is lighter.'],
        ['pencil', 'Change your equipment, goals or schedule on one screen, without going through the set-up again.'],
        ['wave', 'More from Health Connect: heart rate, active calories and distance, an estimated resting heart rate when your watch app doesn\'t share one, and your latest numbers even before today\'s are in.'],
        ['bolt', 'Stronger haptics, with a Light, Medium or Strong setting.'],
        ['lock', 'A full privacy policy: every piece of data, where it\'s kept, who it\'s shared with, and how to delete it.'],
        ['check-circle', 'Fixes: 7-day charts running off the card, cut-off titles, the Equipment screen freezing, sliders, the tour, the Resume button, the see-through workout bar, section spacing and the end of each page hiding under the tab bar. The tab you\'re on keeps its glass look, and text follows your phone\'s font size.'],
      ],
    },
    {
      version: '1.1.0', date: '2026-09-29', title: 'Smoother, smarter, easier to start',
      items: [
        ['sparkle', 'Screens update in place instead of redrawing, tabs and pages slide in, and numbers roll when they change.'],
        ['bolt', 'Haptics: a light tap when you switch tabs or flip a switch, a firmer one when you finish a set, and a little celebration when you level up.'],
        ['refresh', 'Health Connect syncs every time you open the app and every 15 minutes while it\'s open. Pull down on Today or Health to sync right away.'],
        ['heart', 'Finished workouts can be saved to Health Connect, so your other apps see them too.'],
        ['person', 'A profile with your stats, achievements and the app version.'],
        ['library', 'How it works: every rule the app follows, the research behind it, and how strong that research is.'],
        ['chat', 'A built-in coach that works offline, and a way to ask the Claude app about your data.'],
        ['flag', 'A short tour when you start, a tip on each tab and a checklist for your first week.'],
        ['clock', 'Auto rest now gives big moves like squats and rows 90 seconds. Small moves and supersets keep 60, since each muscle rests while you do the other move.'],
        ['sun', 'The status bar blends into the app instead of sitting on a colored strip.'],
      ],
    },
    {
      version: '1.0.0', date: '2026-09-28', title: 'First release',
      items: [
        ['home', 'A workout for every day, built around your goals, equipment and time.'],
        ['play', 'Animated diagrams for every exercise, a rest timer and a check-in after each workout.'],
        ['heart', 'Sleep, steps, weight, heart rate and workouts from Health Connect, with trends and insights.'],
      ],
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
