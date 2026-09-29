/* What's new, newest first. Shown once after an update and any time from Profile. */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.CHANGELOG = [
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
        ['check-circle', 'Fixes: 7-day charts running off the card, cut-off titles, the Equipment screen freezing, sliders, the tour, the Resume button, the see-through workout bar and section spacing. Text now follows your phone\'s font size.'],
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
