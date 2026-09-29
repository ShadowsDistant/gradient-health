/* What's new, newest first. Shown once after an update and any time from Profile. */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.CHANGELOG = [
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
