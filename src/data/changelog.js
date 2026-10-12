/* What's new, newest first. Shown once after an update and any time from You. Each version's
   entry also goes in its GitHub release's notes (scripts/release-notes.mjs), and its `store` text is
   the same news in 500 characters at most, for a store's What's new field (test/release.mjs checks). */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.CHANGELOG = [
    {
      version: '1.11.0', date: '2026-10-12', title: 'Answers you can scan, kept chats, and updates in the app',
      store: [
        '• Coach answers you can scan, with cards of your own data',
        '• Your chats are kept: start a new one or go back to an old one',
        '• Updates in the app: download and install the next version in a tap',
        '• Sheets fade softly under their header as you scroll',
        '• Subtle gradients in the icon\'s colours',
      ].join('\n'),
      items: [
        ['chat', 'Coach answers are short and easy to scan'],
        ['chart', 'Answers can show cards of your own data'],
        ['clock', 'Your chats are saved: start new ones, reopen old ones'],
        ['download', 'Download and install updates inside the app'],
        ['layers', 'Sheets and the chat fade softly as you scroll'],
        ['sparkle', 'Subtle gradients on main buttons and progress'],
        ['check-circle', 'Fixed: food bars over target now show amber'],
      ],
    },
    {
      version: '1.10.1', date: '2026-10-11', title: 'Shorter, plainer words',
      // The store text covers 1.10.0 too, for a store that skipped it.
      store: [
        '• Shorter, plainer words across the app',
        '• Pick Claude\'s model and how much it thinks, with hard spending limits',
        '• Claude builds plans and improves your own',
        '• Badges are 3D medals you can spin',
        '• A new icon and matching colours',
        '• Plan\'s 3D figures show at once after an update',
        '• Messages come up from the bottom; quicker pages, sheets and dialogs',
        '• Reminders on after set-up',
        '• Health: a tidier This week, and dropdowns that fold open',
      ].join('\n'),
      items: [
        ['pencil', 'Shorter, plainer words across the app'],
        ['check-circle', 'Fixed: a leg test was called an arm test'],
      ],
    },
    {
      version: '1.10.0', date: '2026-10-11', title: 'Claude your way, 3D medals, a new icon and a quicker feel',
      store: [
        '• Pick Claude\'s model and how much it thinks, with hard spending limits',
        '• Claude builds plans and improves your own',
        '• Badges are 3D medals you can spin',
        '• A new icon and matching colours',
        '• Plan\'s 3D figures show at once after an update',
        '• Messages come up from the bottom; quicker pages, sheets and dialogs',
        '• Reminders on after set-up',
        '• Health: a tidier This week, and dropdowns that fold open',
      ].join('\n'),
      items: [
        ['sparkle', 'Pick Claude\'s model and how much it thinks'],
        ['card', 'Spending limits for Claude that always hold'],
        ['wand', 'Claude can build and improve your plans'],
        ['trophy', 'Badges are 3D medals you can spin'],
        ['heart', 'A new icon, with matching colours'],
        ['bolt', 'Quicker pages, sheets and dialogs'],
        ['chat', 'Messages pop up from the bottom; swipe down to clear'],
        ['bell', 'Reminders are on after set-up (Android asks first)'],
      ],
    },
    {
      version: '1.9.0', date: '2026-10-11', title: 'Reminders, badges to open, and a quicker feel',
      store: [
        '• Reminders, if you want them: your workout, a walk now and then, a badge to open, a good night\'s sleep. One a day at most, never at night',
        '• New badges arrive sealed: tap to crack them open',
        '• 3D figures on Plan show up at once',
        '• Quicker switching between tabs',
        '• Fixed: scrolling could stutter, freeze or jump with the glass effects on',
        '• Glass effects setting: Auto, Liquid, Frosted or Flat',
        '• Maps you\'ve seen open at once, even offline',
      ].join('\n'),
      items: [
        ['bell', 'Optional reminders: one a day at most, never at night'],
        ['gift', 'New badges arrive sealed: tap to crack them open'],
        ['person', '3D figures on Plan show up at once'],
        ['bolt', 'Quicker switching between tabs'],
        ['sparkle', 'Supersets are numbered in order: A1, then A2'],
      ],
    },
    {
      version: '1.8.10', date: '2026-10-11', title: 'Liquid, without the hold-then-jump',
      store: [
        '• Scrolling with Liquid glass no longer holds still and then jumps: the glow behind each page followed the scroll in a way that made the phone hold back each step of a scroll, up to 2 seconds',
        '• The glow still rises and fades as you scroll down, now as a short fade of its own',
      ].join('\n'),
      items: [
        ['wave', 'Fixed: Liquid glass scrolling could hold, then jump'],
        ['sparkle', 'The background glow fades as you scroll down'],
      ],
    },
    {
      version: '1.8.9', date: '2026-10-10', title: 'Switches that let go, and a speed test with a finger',
      store: [
        '• Scrolling Settings no longer leaves a piece of a switch\'s glass running each time a scroll starts on its row, which kept the app from ever settling there',
        '• The glass speed test now also flicks the page the way a finger does, since a page that scrolls by itself was smooth where a finger\'s scroll stuttered',
        '• Scroll diagnostics note the glass effects each gesture ran under',
      ].join('\n'),
      items: [
        ['wave', 'Fixed: switches in Settings kept the app from settling'],
        ['bolt', 'The glass speed test now flicks like a finger'],
        ['activity', 'Scroll diagnostics note the glass look for each flick'],
      ],
    },
    {
      version: '1.8.8', date: '2026-10-10', title: 'Finding the stutter in Liquid',
      store: [
        '• Scroll diagnostics can record what your phone does while a scroll stutters: how it handled each touch, frame and fling',
        '• The glass speed test now times the phone\'s own drawing of each frame, at its fastest refresh rate',
      ].join('\n'),
      items: [
        ['activity', 'Scroll diagnostics can record a stutter for the developer'],
        ['bolt', 'The glass speed test times your phone\'s own frames'],
      ],
    },
    {
      version: '1.8.7', date: '2026-10-09', title: 'Auto is back',
      store: [
        '• Glass effects is back on Auto: the glass as designed at rest and lighter while the page moves, which keeps scrolling smooth',
        '• Liquid keeps the glass while you scroll too, for phones that can keep up',
        '• Still in: the light on the glass holds still, and the glow rests while you use the app',
      ].join('\n'),
      items: [
        ['wave', 'Glass effects is back on Auto, for smooth scrolling'],
        ['sparkle', 'Pick Auto, Liquid, Frosted or Flat in Settings, Look'],
        ['bolt', 'The glass light holds still while you use the app'],
      ],
    },
    {
      version: '1.8.6', date: '2026-10-09', title: 'Liquid glass, without the stutter',
      store: [
        '• Liquid glass is the default again, and it no longer stutters: smooth scrolling with the glass as designed',
        '• The light on the glass stays put instead of following the phone\'s tilt, which kept redrawing every piece of glass',
        '• The colours behind each page drift only once you\'ve left the app alone for a few seconds',
      ].join('\n'),
      items: [
        ['wave', 'Liquid glass is the default again, without the stutter'],
        ['sparkle', 'The glass light no longer follows the phone\'s tilt'],
        ['bolt', 'The background colours drift only when you leave the app'],
      ],
    },
    {
      version: '1.8.5', date: '2026-10-08', title: 'The glass steps aside while you scroll',
      store: [
        '• Glass effects (Settings, Look) is now Auto: the glass is as designed at rest and lightens while the page moves',
        '• For scrolling that froze or only started once your finger lifted, on phones that can\'t keep up with the glass',
        '• Glass speed test (Settings, About, Scroll diagnostics): which look your phone draws smoothly',
      ].join('\n'),
      items: [
        ['wave', 'New Auto glass: lighter while the page moves'],
        ['sparkle', 'Glass effects: Auto, Liquid, Frosted or Flat'],
        ['bolt', 'A glass speed test in Settings, About'],
      ],
    },
    {
      version: '1.8.4', date: '2026-10-08', title: 'Glass you can turn down, and a report when scrolling freezes',
      store: [
        '• Glass effects: Liquid, Frosted or Flat (Settings, Look). Flat is the lightest to draw: try it if scrolling stutters',
        '• Scroll diagnostics (Settings, About): if a scroll freezes or jumps, copy a report of what happened for the developer',
      ].join('\n'),
      items: [
        ['sparkle', 'Glass effects: Liquid, Frosted or Flat (Settings, Look)'],
        ['bolt', 'Scroll diagnostics to report a freeze to the developer'],
      ],
    },
    {
      version: '1.8.3', date: '2026-10-08', title: 'Scrolling that never freezes',
      store: [
        '• Fixed: a flick right after another could freeze for a moment, then jump',
        '• Background work (3D pictures, the coach\'s notes) now waits until you\'ve stopped for a while',
        '• 3D pictures are prepared in the background instead of holding the page',
      ].join('\n'),
      items: [
        ['wave', 'Fixed: a quick second flick could freeze, then jump'],
        ['clock', 'Background work waits until you stop touching the screen'],
        ['bolt', '3D pictures are prepared in the background'],
      ],
    },
    {
      version: '1.8.2', date: '2026-10-08', title: 'Smoother scrolling',
      store: [
        '• Smoother scrolling: in testing, about half as many skipped frames on Today, Health, Plan and You',
        '• The glass at the bottom stops bending while the page moves, and eases back when it stops',
        '• Less work for your phone on every frame of a scroll',
      ].join('\n'),
      items: [
        ['wave', 'Smoother scrolling: about half as many skipped frames'],
        ['sparkle', 'The bottom glass stops bending while the page moves'],
        ['bolt', 'Less drawing work on every frame of a scroll'],
      ],
    },
    {
      version: '1.8.1', date: '2026-10-05', title: 'Maps that open at once, even offline',
      store: [
        '• Maps you\'ve seen open at once, even with no connection',
        '• The first map opens sooner',
        '• A map that can\'t load keeps your route, and comes once you\'re back online',
        '• Maps change with the app\'s light or dark look without loading again',
        '• Names of rivers and lakes on the map',
        '• Maps stay with OpenFreeMap: Google Maps is gone',
      ].join('\n'),
      items: [
        ['map', 'Maps you\'ve seen open at once, even offline'],
        ['bolt', 'The first map opens sooner'],
        ['refresh', 'A map that can\'t load shows your route and retries'],
        ['moon', 'Maps follow light and dark, and name rivers and lakes'],
        ['check-circle', 'Maps stay with OpenFreeMap; Google Maps is gone'],
      ],
    },
    {
      version: '1.8.0', date: '2026-10-05', title: 'A live map, smarter runs, and a smoother feel',
      store: [
        '• A live map that follows you on runs, walks, hikes and rides',
        '• Auto-pause, spoken splits and your pace right now',
        '• Steadier GPS distance and a smoother route',
        '• Haptics with a feel of their own for saving, sending, swiping away and more',
        '• Scrolling down no longer flickers, and pages switch faster',
        '• Switches glide smoothly, and sheets keep their silver edge',
        '• Cancelling a workout or an activity folds it away',
      ].join('\n'),
      items: [
        ['map', 'A live map that follows you on runs, walks and rides'],
        ['pause', 'Auto-pause when you stop'],
        ['volume', 'Spoken splits at each kilometre or mile'],
        ['navigate', 'Steadier GPS distance and a smoother route'],
        ['bolt', '26 new haptics, 57 in all'],
        ['x-circle', 'Cancelling a workout or activity folds it away'],
        ['wave', 'Fixed: scrolling down no longer flickers'],
        ['clock', 'Pages switch faster'],
      ],
    },
    {
      version: '1.7.0', date: '2026-10-04', title: 'Smoother scrolling and new liquid glass',
      store: [
        '• Smoother scrolling on every screen',
        '• New liquid glass: switches, tabs and pickers rise into a lens as you touch them and flow where you let go',
        '• Buttons form out of the glass and change shape, and menus grow out of the button you tap',
        '• Pages no longer zoom by accident; pinch the route map to zoom it',
        '• Answering how many reps you had left no longer moves on under your finger',
        '• Built with Refract 1.4, now credited in Settings',
      ].join('\n'),
      items: [
        ['wave', 'Smoother scrolling on every screen'],
        ['sparkle', 'New liquid glass controls that follow your finger'],
        ['layers', 'Buttons form out of the glass and change shape'],
        ['bolt', 'Heavy work waits until you stop scrolling'],
        ['navigate', 'Pages no longer zoom by accident; maps pinch to zoom'],
        ['check-circle', 'Fixed: a quick tap can\'t log the next set by mistake'],
        ['heart', 'Built with Refract, credited in Settings'],
      ],
    },
    {
      version: '1.6.0', date: '2026-10-02', title: 'Smarter plans, badges to share, and a stronger, smoother feel',
      store: [
        '• Smarter plans: every way to split your week is weighed, and workouts fill the time you set',
        '• Why this plan, and an AI check of your plan whose suggestions you pick',
        '• 64 badges to earn and share as pictures with friends and family',
        '• A new You tab, and Settings you can search',
        '• Toggles that answer every tap, and glass switches',
        '• Stronger haptics with 31 distinct feels, and smoother motion',
        '• A quicker set-up that starts your first workout',
        '• Faster and safer',
      ].join('\n'),
      items: [
        ['sliders', 'Smarter plans that fill the time you set'],
        ['chip', 'Why this plan, and an AI check whose ideas you pick'],
        ['star', '64 badges to earn and share'],
        ['person', 'A new You tab, and Settings you can search'],
        ['check-circle', 'Toggles answer every tap'],
        ['bolt', 'Stronger haptics with 31 distinct feels'],
        ['compass', 'A quicker set-up that starts your first workout'],
        ['lock', 'Faster to open, and safer with your data'],
      ],
    },
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
        ['navigate', 'Record runs, walks, hikes and rides with GPS'],
        ['refresh', 'Health Connect can sync in the background'],
        ['people', 'Plans adapt to your age and conditions, with 71 new moves'],
        ['compose', 'Make your own plan, or have the coach build one'],
        ['share', 'Share a plan with a QR code or a link'],
        ['sparkle', 'A clearer set-up and smoother exercise animations'],
        ['bolt', '3D figures appear at once'],
      ],
    },
    {
      version: '1.4.0', date: '2026-09-30', title: 'A coach that answers, and a new Plan, Health and Progress',
      items: [
        ['chip', 'The on-device coach answers several times faster'],
        ['sparkle', 'Ask the coach from any tab'],
        ['sliders', 'Tailor my plan: say what you want changed'],
        ['calendar', 'A new Plan tab with your week and 3D exercises'],
        ['heart', 'A redesigned Health tab, with history for every number'],
        ['person', 'Progress shows a map of the muscles you trained'],
        ['dumbbell', '46 new exercises, 212 in all'],
        ['layers', 'Sheets slide up and follow your finger'],
      ],
    },
    {
      version: '1.3.1', date: '2026-09-29', title: 'A round of fixes',
      items: [
        ['refresh', 'Fixed: Undo after cancelling a workout'],
        ['person', 'Fixed: exercise animations going missing'],
        ['chip', 'On-device coach fixes; a new model is used at once'],
        ['lock', 'Fixed: the privacy link on the Claude screen'],
        ['library', 'Fixed: How it works shifted to one side'],
      ],
    },
    {
      version: '1.3.0', date: '2026-09-29', title: 'A smarter coach, and workouts you can cancel',
      items: [
        ['chip', 'A smarter on-device coach, in three sizes'],
        ['close', 'Cancel a workout, with Undo'],
        ['person', 'Exercise animations always play'],
        ['library', 'A redesigned How it works'],
        ['sparkle', 'A more polished look'],
        ['check-circle', 'Fixes for sheets and the how-to'],
      ],
    },
    {
      version: '1.2.0', date: '2026-09-29', title: 'Gradient Health: gym, food and a coach you can see',
      items: [
        ['heart', 'A new name, Gradient Health, and a new icon'],
        ['person', 'A 3D figure shows every exercise'],
        ['dumbbell', 'Gym mode, with 45 gym exercises'],
        ['food', 'Food tracking, if you want it'],
        ['sliders', 'Choose what the app tracks'],
        ['sparkle', 'The coach shows what it changed and why'],
        ['chip', 'An AI chat that runs on your phone'],
        ['wave', 'More from Health Connect'],
      ],
    },
    {
      version: '1.1.0', date: '2026-09-29', title: 'Smoother, smarter, easier to start',
      items: [
        ['sparkle', 'Screens update in place, and tabs slide in'],
        ['bolt', 'Haptics for tabs, switches and finished sets'],
        ['refresh', 'Health Connect syncs each time you open the app'],
        ['heart', 'Workouts can be saved to Health Connect'],
        ['person', 'A profile with your stats and achievements'],
        ['library', 'How it works: the rules and the research'],
        ['chat', 'A built-in coach that works offline'],
        ['flag', 'A short tour, tab tips and a first-week checklist'],
      ],
    },
    {
      version: '1.0.0', date: '2026-09-28', title: 'First release',
      items: [
        ['home', 'A workout for every day, built around you'],
        ['play', 'Animated exercises, a rest timer and a check-in'],
        ['heart', 'Health Connect data, with trends and insights'],
      ],
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
