/* What's new, newest first. Shown once after an update and any time from You. Each version's
   entry also goes in its GitHub release's notes (scripts/release-notes.mjs), and its `store` text is
   the same news in 500 characters at most, for a store's What's new field (test/release.mjs checks). */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  GH.CHANGELOG = [
    {
      version: '1.8.6', date: '2026-10-09', title: 'Liquid glass, without the stutter',
      store: [
        '• Liquid glass is the default again, and it no longer stutters: smooth scrolling with the glass as designed',
        '• The light on the glass stays put instead of following the phone\'s tilt, which kept redrawing every piece of glass',
        '• The colours behind each page drift only once you\'ve left the app alone for a few seconds',
      ].join('\n'),
      items: [
        ['wave', 'Scrolling with the liquid glass on stuttered on some phones, and only Flat fixed it. The cause was work the phone kept doing when nothing on screen had changed: the light on the glass followed how the phone was tilted, and every step it took redrew every piece of glass, all the time while the phone was in your hand. The light now stays where it was designed to be, so a flick starts with the phone\'s graphics chip free.'],
        ['sparkle', 'Liquid is the default look again, the glass as designed while you scroll too. 1.8.5\'s Auto, which turned the glass plain while the page moved, is gone: if you picked it, you\'re on Liquid. Frosted and Flat are still there, in Settings under Look.'],
        ['bolt', 'The colours behind each page hold still while you\'re using the app and drift only once you\'ve left it alone for a few seconds. Each step of that drift redrew every piece of glass too.'],
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
        ['wave', 'On some phones the page didn\'t follow your finger: it only started moving when you let go, or froze in a fling and jumped. The glass over a moving page is a lot for a phone\'s graphics chip to redraw every frame, and turning it off (Flat) fixed it. Glass effects in Settings under Look is now Auto, the new default: the glass is as designed whenever the page is still, and as light as Flat from your first drag until half a second after the page stops.'],
        ['sparkle', 'Glass effects has four choices that mean what they say: Auto, Liquid (always as designed), Frosted (the blur without the lens effect, now with the glow behind the page) and Flat (no blur at all, the lightest).'],
        ['bolt', 'Glass speed test, in Settings under About, Scroll diagnostics: about 20 seconds, the page scrolls by itself in a few looks of the glass, and the report says which one your phone draws smoothly. Copy or share it with the developer. A touch stops it.'],
      ],
    },
    {
      version: '1.8.4', date: '2026-10-08', title: 'Glass you can turn down, and a report when scrolling freezes',
      store: [
        '• Glass effects: Liquid, Frosted or Flat (Settings, Look). Flat is the lightest to draw: try it if scrolling stutters',
        '• Scroll diagnostics (Settings, About): if a scroll freezes or jumps, copy a report of what happened for the developer',
      ].join('\n'),
      items: [
        ['sparkle', 'Glass effects, in Settings under Look: Liquid as designed, Frosted (the blur without the lenses) or Flat (no blur at all, the lightest to draw). If scrolling stutters on your phone, try Flat.'],
        ['bolt', 'Scroll diagnostics, in Settings under About: a record of what each touch, the scroll, the frames and the page\'s own work did in the last few minutes, to copy or share with the developer right after a scroll freezes or jumps. Nothing is sent anywhere by itself.'],
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
        ['wave', 'Fixed: a flick right after another could freeze for a moment and then jump, or only get going once your finger lifted. Filmed on a phone, the page was busy under the finger: the moment a scroll settled, the app took that as a quiet moment and started background work, which is exactly when the next flick comes.'],
        ['clock', 'That work (3D pictures of your moves, a page refreshing after a sync, the 3D figure warming up) now waits until nothing has happened for a second and a half, and never starts while a finger is on the screen.'],
        ['bolt', 'A 3D picture of a move is prepared in the background instead of holding the page while it\'s encoded, and its shaders compile in the background too, where the phone allows. The 3D warm-up after launch now covers the one shader a move at a wall or a door still compiled for every picture, and draws a first picture itself, so the first one you see costs no more than the rest.'],
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
        ['wave', 'Scrolling is smoother. The frosted glass over the page is redrawn every frame of a scroll, and that was more than a phone could keep up with. In testing at phone size, a fling now skips about half as many frames on Today, Health, Plan and You, and almost none on Progress.'],
        ['sparkle', 'While the page moves, the glass at the bottom (the tab bar and Today\'s buttons) stops bending what\'s under its edges, and eases back once the page is still. Its frost stays, and the buttons at the top keep their bend.'],
        ['bolt', 'Less work on every frame of a scroll: the frosted strip under the top bar costs less to draw for the same look, and the glass\'s light holds still while your finger is on the screen.'],
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
        ['map', 'Maps you\'ve seen open at once and work with no connection: the map pieces OpenFreeMap sent are kept on your phone (up to about 50 MB), and when OpenFreeMap updates its map, the newer pieces come in behind the ones you see. Clear them in Settings, under Walks, runs and rides.'],
        ['bolt', 'The first map opens sooner: it asks OpenFreeMap for what it needs while the map itself loads.'],
        ['refresh', 'A map that can\'t load (no connection, and never shown before) leaves your route drawn on the phone, says why, and comes by itself once you\'re back online, while you record too.'],
        ['moon', 'Maps change with the app\'s light or dark look without loading again, and show the names of rivers and lakes.'],
        ['check-circle', 'Maps stay with OpenFreeMap. Google Maps needed a key the app never had, so it never switched on, and it\'s gone.'],
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
        ['map', 'A map that follows you on runs, walks, hikes and rides, with a dot for how sure the GPS is and a beam for the way you\'re facing, and your route on the map in pace colours afterwards. Maps come from OpenFreeMap, and can be turned off in Settings.'],
        ['pause', 'Auto-pause: stop at a crossing and the clock stops with you, then starts again as you go. It\'s on for runs and rides and can be turned on for walks and hikes.'],
        ['volume', 'Spoken splits: at each kilometre or mile, your time and pace, spoken over your music, which dips meanwhile. Turn them on when you start, or in Settings.'],
        ['navigate', 'Steadier GPS. The distance no longer runs a few percent long from GPS noise or creeps up while you stand still, your pace is the pace you\'re going now, the route is drawn smoother, and the map shows roughly where you are while the GPS finds you. A badge shows how strong the signal is.'],
        ['bolt', '26 new haptics, so more actions have a feel of their own: saving, copying, sending, removing, a sheet or menu opening or swiped away, picking a day, starting, skipping, more rest, swapping a move, cancelling, and every moment of a run, from the start to each split and the finish. 57 in all, each one to try in Settings.'],
        ['x-circle', 'Cancelling a workout folds it away, and Today settles back as it was before you started. Discarding an activity folds it away too.'],
        ['wave', 'Scrolling down no longer flickers: the glass over the page keeps its look while the page moves, so the big title no longer turns sharp under the bar\'s buttons.'],
        ['clock', 'Pages switch faster: a new tab is there in a quarter of a second, where it took two thirds, and opening a page or going back is quicker too.'],
        ['check-circle', 'Switches in Settings glide all the way across instead of stuttering, and sheets keep their silver edge from the moment they appear, while you drag them and at full height.'],
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
        ['wave', 'Smoother scrolling. While a page moves, the glass over it keeps its frost but stops bending what is behind it, the bar\'s frosted edge is a single blur drawn only when it shows, and the background glow is cheaper to draw and rests after 20 seconds without a touch. Scrolling takes about a fifth less drawing on most screens, and set-up three quarters less.'],
        ['sparkle', 'New liquid glass, from Refract 1.4. Switches, segmented controls, choices and the tab bar rest as frosted beads, rise into a lens under your finger, follow it and land with a little squash. A tap that wobbles still counts.'],
        ['layers', 'Glass that forms. Today\'s buttons and the workout capsule form out of the glass and dissolve when they go, and change shape when their label does. Buttons in the top bar carry over from page to page, menus grow out of the button you tap, sheets are thick glass, and the day picked in Plan is a bead that travels between days.'],
        ['bolt', 'Work that can wait, like drawing the 3D figures, now waits until you stop scrolling.'],
        ['navigate', 'Pages no longer zoom by accident, by pinch or double tap. The street map of a run, walk or ride now moves and zooms with two fingers, and a button brings the whole route back.'],
        ['check-circle', 'In a workout, answering how many more reps you could have done no longer moves the workout on by itself while Continue is on screen, so a quick tap can\'t log the next set by mistake.'],
        ['heart', 'Built with Refract, the liquid glass design system behind every screen. It\'s credited in Settings, under About.'],
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
        ['sliders', 'Smarter plans. The planner weighs every way to share your muscle groups over your days and picks the week that fits your goals, time and recovery best. Workouts fill the time you set (an hour means an hour, and never more), and every muscle gets its weekly minimum; on the shortest days they take turns over two weeks.'],
        ['layers', 'Why this plan: see what the planner compared, how your week scores, and how full body, upper and lower, or push, pull and legs would do instead. Try one with a tap, and Undo puts it back.'],
        ['chip', 'Check my plan with AI. The on-device coach or Claude suggests up to three changes, each checked against your equipment, your joints and your time before you see it. Pick the ones you want. With Claude on, your weekly report brings plan ideas too.'],
        ['star', '64 badges to earn: streaks, milestones, strength, runs and rides, food, and a few secret ones. Once earned they\'re yours for good, with the date.'],
        ['share', 'Share a badge as a picture with friends and family. It shows the badge and what it took, and your name only if you choose.'],
        ['person', 'A new You tab with your profile, badges, plans and Settings in one place. Moves now lives in Plan, and Settings has a search.'],
        ['check-circle', 'Toggles answer every tap: a tap with a little wobble counts, and a switch never flips twice or gets stuck. Switches and segmented controls stay glass at rest, like the tab bar.'],
        ['bolt', 'Stronger haptics with 31 distinct feels: a tick for each tab, a bump at the end of a stepper, and a different feel for a finished set, a new best and a badge. Medium is now as strong as the old Strong. Feel each one in Settings.'],
        ['wave', 'Smoother motion: the page you leave slides away as the next comes in, and cards glide when something is added or removed.'],
        ['compass', 'A quicker set-up: six short steps, then your plan and why, and your first workout starts right away. Health Connect waits until after it. A friend\'s shared plan gets you started in three steps.'],
        ['lock', 'Safer: your Claude key is encrypted with your phone\'s keystore, backups only happen when they\'re end-to-end encrypted, model downloads are checked against fixed fingerprints, and a bad link or backup can\'t break the app.'],
        ['clock', 'Faster: the app opens about a fifth sooner, and a third sooner later the same day. It\'s over a quarter smaller, loads set-up and the plan check only when they\'re needed, and saving never holds up a tap.'],
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
