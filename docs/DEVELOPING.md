# Developing Gradient Health

Gradient Health is a single self-contained web app (`dist/gradient-health.html`, built from `src/`) inside a
thin Android WebView shell (`android/`) with a Health Connect bridge. There's no Gradle and no
Android SDK: the APK is built with Ubuntu's packaged Android tools.

## Layout

```
src/data/moves.js        exercises (home and gym), ladders and gym pools, equipment tags, cues
src/data/science.js      the rules behind the plan, with their research (the "How it works" page)
src/data/changelog.js    What's new, newest first
src/data/privacy.js      the privacy policy (the in-app page and docs/PRIVACY.md come from it)
src/data/brand.js        the logo as a data URI
src/engine/pose.js       2D skeleton (FK + IK), timing from tempo, SVG figures, gym props
src/brain.js             program, sessions, gym loads, adaptation, calendar replay, streaks, readiness
src/optimizer.js         the plan engine (GH.optimizer): the best weekly split, each day's sets, sessions
                         filled to the time set, the plan's score and its "Why this plan" lines
src/achievements.js      the badges (GH.achievements): what each takes, earned for good with a date,
                         sealed until opened
src/notify.js            notifications' planner (GH.notify, a lazy chunk): what to send and when;
                         src/ui/notify.js hands it to Android, with Settings' rows and Today's card
src/planweek.js          one week of the plan for the Plan tab (GH.planWeek), cached
src/body.js              weighted sets per muscle, how training splits, what improved (GH.body)
src/health.js            Health Connect client (read and write), hand logs, per-day records
src/food.js              food tracking: targets, logging, meals, the learned burn, Health Connect writes
src/foodnet.js           Open Food Facts search and barcodes (through the Android shell)
src/scanner.js           the barcode camera sheet; src/barcode.js is its lazy ZXing reader
src/activity.js          outdoor activities: the recorder (the Android shell's, or the browser's), and
                         the track's maths: distance, pace, splits, auto-pause, records (GH.activity)
src/actmap.js            the map behind a route: MapLibre on OpenFreeMap's tiles, a lazy chunk
                         (GH.lazy('actmap')); the pieces it shows are kept on the phone (U.mapPieces)
src/ui/activity.js       an activity's summary, the history and records, the maps (U.actMap) and an
                         activity leaving (U.actFoldAway); src/ui/actlive.js records one
src/insights.js          on-device insights
src/coach.js             the built-in coach: report, answers, today's decisions, suggestions, and the
                         number check every AI answer goes through (keepToGiven, grounded)
src/planreview.js        the AI check of the plan (GH.planReview): what's sent, the schema and grammar,
                         and every suggestion tried on a copy before it's offered
src/tailor.js            Tailor my plan: a request into a proposal, applied and undone (GH.tailor)
src/customplan.js        your own plans: checks, running them, swaps, progression, the share code and
                         Build me a plan (GH.customPlan)
src/qr.js                a QR code encoder that draws SVG (GH.qr), for sharing plans
src/share-page.html      the page a shared plan's link opens in a browser (built to docs/p/index.html)
src/devicecoach.js       the on-device model's prompt: rules, a compact data brief, safety routing
src/ai.js                the Claude coach's inline part: the key, consent, exactly what's sent, errors
src/claude.js            the Claude requests with the Anthropic SDK, a lazy chunk: GH.lazy('claude')
src/llm.js               on-device AI runtime (native engine or llama.cpp in WebAssembly), a lazy
                         chunk: GH.lazy('llm')
src/store.js             local + file persistence, backup and restore, migrations
src/platform.js          haptics, vibration, sounds, theme and system bars, insets, back button, lazy chunks
src/ui/core.js           layout, tabs, router, in-place rendering (U.morph), transitions, sync, events
src/ui/sheet.js          the bottom sheets: detents, dragging, springs (U.sheet in core.js wraps it)
src/ui/controls.js       switches, segmented controls and single-choice chips (U.choice): the touch
                         handling that makes every tap count, on Refract's liquid glass
src/ui/hapticsui.js      the haptics rows for Settings (U.hapticRows) and the Feel each one gallery
src/ui/you.js            the You tab: profile, badges, plans, your answers, Settings and help
src/ui/badges.js         the badge medals and sealed capsules, the strip, the gallery, the detail sheet
                         and the reveal, where a capsule is opened (see Badges)
src/ui/sharecard.js      a badge's share image (a 1080×1350 canvas) and sharing it
src/ui/chat.js           the coach chat and the coach button on every tab
src/ui/tailor.js         the Tailor my plan sheet
src/ui/customplan.js     Your plans: the list, the editor and exercise picker, sharing, a shared plan's
                         preview, Build me a plan
src/ui/metric.js         a health number's sheet: its history, chart, and adding or changing it
src/ui/bodymap.js        Progress's body map (front and back, 17 muscles) and the muscle sheet
src/ui/guide.js          tour (cards over Today after the first workout), first-week checklist, tab
                         tips, What's new
src/ui/motion.js         route changes, glides, collapse and expand, glass that forms and changes
                         shape (U.motion), menus (U.menu)
src/ui/lazy.js           stand-ins for the parts that load when they're needed (APP_CHUNKS)
src/ui/stills.js         the 3D figure's stills of the moves, kept on the phone (U.stills): Plan's
                         tiles, the plan builder's, set-up's reveal, Settings' preview
src/ui/answers.js        set-up's answers as You, Plan and Settings list them
src/ui/review.js         Why this plan, the Coach's review sheet and the weekly report's plan ideas
src/ui/*.js              screens: onboarding, player, today, plan, health, food, progress, moves,
                         coach page, profile, science (How it works), settings
src/styles.css, src/styles/*.css   the app's styles (the per-area files are appended in order)
android/src/…/HealthSync*.java     background Health Connect sync (a JobScheduler job every 15 minutes)
android/src/…/Activity*.java       outdoor activity recording (a location foreground service, the track)
android/src/…/Notif*.java          notifications: the schedule the page plans, its alarm, posting each one
android/jni/             the on-device coach's native engine (C++ over llama.cpp) and its host test
scripts/build-native.sh  builds android/jni for arm64 (or --host, and tests it)
scripts/build.mjs        inlines everything into dist/gradient-health.html, minified (MINIFY=0 to read
                         it); lazy chunks go to dist/lazy/
scripts/build-apk.sh     builds and signs the APK without Gradle
scripts/make-icons.mjs   the launcher icons from art/logo.webp
scripts/screenshots.mjs  renders docs/screenshots/ from the built page (the activity is a walk along
                         Venice Beach, on OpenFreeMap's map when it can be reached from where it runs)
scripts/frame-shots.mjs  puts the README's screenshots in a phone, in docs/screenshots/framed/
scripts/store-assets.mjs   the store images in docs/store/ from docs/screenshots/
scripts/release-notes.mjs  What's new for a version, for its GitHub release and the stores
scripts/make-tiny-gguf.py  a tiny random-weight model for test/llm.mjs
```

```sh
npm ci
npm test          # simulations, insights, AI (mocked API), coach, poses, persistence, food, health, gym,
                  # your plans, activities, release notes, the plan engine and every combination of
                  # answers (combos; --full before a release), badges, haptics, security, the build
npm run build     # dist/gradient-health.html, dist/lazy/, docs/PRIVACY.md and docs/p/index.html
npm run smoke     # end-to-end run in Chromium (needs Playwright); add --dark for dark mode
npm run test:ui   # layout regressions, food flows, the coach chat, the 3D figure, your plans, controls
                  # (real touches), haptics, motion, the You tab, badges, the plan review, speed
                  # and scrolling budgets (Chromium)
node test/ui-scroll.mjs --measure [--vs=<dir>] [--ablate=<part>]   # scrolling every main screen: frames
                  # dropped, the GPU's draw time; A/B against another build, or with one part switched off
npm run test:llm  # on-device AI runtime in Chromium with a tiny model (see On-device AI)
node test/sweep.mjs [--quick]   # every screen at 360-600 px, light/dark, 100%/130% text, overflow checks
npm run apk       # build/gradient-health.apk (see below)
node scripts/screenshots.mjs          # docs/screenshots/, light and dark
node scripts/frame-shots.mjs [name …] # the README's copies of them, in a phone
node test/contact-sheet.mjs [filter,…] [--dark]   # every move's keyframes, to build/
```

## Rendering

Screens return HTML strings. `U.render()` doesn't replace the page: `U.morph()` patches it in
place, keeping nodes that line up (by `data-key`, `id`, or position and tag). That keeps Refract's
enhanced controls, running transitions, focus and scroll positions intact, so a tap never makes the
screen flicker. Parts Refract injects (lens layers, the tab bar's pill, the segmented thumb and lens) and attributes it sets are
left alone. A few conventions:

- Give top-level cards a `data-key` so adding or removing one doesn't shift the rest.
- `data-morph="keep"` on a container whose children are drawn by code (the exercise figures). Its
  HTML can bring children (Plan's kept 3D stills) for a new node; a patch leaves the ones it has.
- `U.roll(value)` for numbers that should roll when they change.
- The navigation bar is shared: a screen's `<header class="rf-navbar">` is lifted into it.
- A route change gets fresh content: the old page leaves in a layer of its own while the new one
  comes in (`U.motion.routeSwap` in `src/ui/motion.js`, on Refract 1.4's page motion: pushes and
  pops slide on the snappy spring in 280 ms, tabs morph in place in 200; the bar's title cross-fades
  with them, and its buttons and the tab bar land with the page). A re-render of the same route
  patches in place and glides what moved (FLIP, 340 ms): new blocks rise in, and removed ones fade
  from where they were for 180 ms before they go, so a test that checks one is gone waits for
  `U.motion.settled()`. Animate transform and opacity only; `test/ui-motion.mjs` checks for layout
  properties. Nothing that moves makes anyone wait: Refract's own motion the app asks for by name
  (glass forming, shape-shifting) plays quicker where it would run long (`U.motion.within`), on the
  same curves.
- Glass above the page moves as Refract's material does. The bar's buttons are keyed by what they
  are (`data-rf-key`; the top-left one by its place, the coach on a tab and Back on a page), so a
  push or Back shape-shifts them (`U.motion.shift`, `Refract.shapeshift`): one on both routes keeps
  its glass, one the new route lacks pinches off, a new one buds out. A tab change doesn't: the new
  tab's buttons fade in and the old ones fade out as pictures (`swapButtons` in `motion.js`), since
  shape-shifting animates widths, which laid the bar out and gave each button's lens a new size, and
  so a new filter, in every frame for half a second after every tab change. Today's floating buttons and
  the workout capsule form and dissolve (`U.motion.glassIn` and `glassOut`: `Refract.materialize`,
  `dematerialize`), and a button whose words change (`U.floatKey`) flows to its new width. That's
  Refract's own motion, asked for by name; the lint counts it apart and holds it to what Refract's
  API animates.
- Cancelling a workout is a moment of its own (`src/ui/player.js`): in the player, what's on it drops
  and shrinks away, then the panel dissolves into Today, whose cards rise back with the workout not
  started; from Today, its buttons pinch away and its card folds and settles back
  (`U.todayCancelled`); the toast with Undo only comes after. Reduced motion: short fades.
- Toasts (`U.toast` in `core.js`, Refract's toaster) come up from the bottom of the screen, above
  whatever is there: the tab bar, Today's floating buttons and the workout capsule, the player's,
  set-up's or a live activity's buttons, or an open sheet's main buttons (`--toast-lift`, read again
  whenever one of those comes or goes, and glided to). Over an open sheet the toaster goes in the
  sheet's dialog, the one part of the page that takes taps then, and back as the sheet closes. A
  swipe down dismisses the bottom one. Refract's toast motion plays 1.6 times as fast.

**Parts that load when they're needed.** Set-up (`src/ui/onboarding.js`), the plan review with
Why this plan (`src/planreview.js`, `src/ui/review.js`), How it works (`src/data/science.js`,
`src/ui/science.js`), a badge's share card (`src/ui/sharecard.js`) and notifications' planner
(`src/notify.js`, loaded by `src/ui/notify.js` for someone who has them on) aren't in the page: they're
`APP_CHUNKS` in `scripts/build.mjs`, built into `dist/lazy/` and loaded with `GH.lazy(name)`.
`src/ui/lazy.js` puts small stand-ins in their place: an action loads its part and then runs the
real one, a screen draws its bar and title until its part is in, and `GH.planReview.available`
answers at once. A couple of seconds after launch the likely parts load while the phone is idle,
so a tap rarely waits. A new module that the first frame of Today doesn't need belongs in a chunk.
`test/ui-perf.mjs` holds the launch, tab and save budgets (4× CPU), and `test/buildcheck.mjs` the
page's size.

**The first frame.** At launch Refract sets up what the first render inserts at the start of the
first frame's read pass rather than before it (`enhance()` in `src/ui/core.js`), so the lens maps it
draws pixel by pixel in JavaScript land in the frame after the first paint, and the tab bar's lens
(the glass over the picked tab) shows from the bar's second frame (`src/styles/perf.css`). The
controls take its liquid engine only when held or moving (Refract, the design system, below).

A scroll that stutters on a phone and not here (reported on one, where Flat fixed it every time, and
the glass shouldn't look flat): the GPU redrawing the glass. Each glass is a backdrop filter, drawn
again every frame the page moves under it, and also every frame anything behind it or on it changes,
scroll or not. Two things did that all the time on a phone and never here: Refract's light following
the tilt (every step repaints each rim and sheen and has each backdrop filtered again; with a hand's
tilt emulated at rest on Today, `deviceorientation` at 60 a second, the GPU process's time more than
doubled), and the glow's drift (each step has every glass filtered again). So the light holds still
at its designed angle: core.js gives `DeviceOrientationEvent` a `requestPermission` before Refract's
first glass registers, which is where Refract leaves the tilt alone, and the sensor never starts. And
the glow holds still while the app is in use (`#app[data-in-use]`, any input in the last 3 s, and the
first 3 s after launch; src/styles/perf.css), drifting only once it's left alone until 20 s after the
last input (`#app[data-idle]`). In use, at rest, the GPU then has nothing to do (about what it has with
every backdrop filter off), and a flick starts on a GPU that's free. That wasn't enough on its own:
1.8.6 kept the glass as designed while the page moved (Liquid), and the phone still stuttered there, so
the glass steps aside then. Settings, Look, "Glass effects" (`prefs.glass`, set as `data-glass` on the
root by `setGlassMode` in core.js) is Auto by default: the glass as designed at rest and Flat's
lightness (`:root[data-glass-lite]`, src/styles/perf.css: no backdrop anywhere, solid fills, no
control lenses) from the first few pixels of a vertical drag on the page (or a wheel turn) until half a
second after the page stops, flings included and for as long as a finger is down; a tap, a tab change
and a scroll the page makes by itself never count. Liquid is the glass as designed, always, its bottom
lenses fading out while the page moves (`bend`); Frosted is the blur without the lenses (the glow
kept); Flat is the lightness always, with the glow hidden (Refract's reduced transparency). In every
mode the glow holds still while the page moves (`#app[data-scrolling]`). `ui-scroll` checks Auto's
transitions (`GH.ui.glassState()`), that the light hears no tilt, Liquid's glass while the page moves
and the glow's in-use pause, `ui-you` the setting and the root's attributes.

Settings, About, "Scroll diagnostics" (`src/ui/diag.js`, `GH.diag.report()`) is for a freeze that
survives: a record, kept in memory for the last five minutes, of every touch (where, when, how late it
reached the page), the scroller's position once a frame around a touch or a scroll (read once the
frame is drawn, when the page's style and layout are already up to date: read in the frame itself it
made them catch up with each change twice a frame, all through a tab change), every long
animation frame with its scripts (or long tasks), and the Event Timing API's input delays, written up
as one report (the device, the settings that bear on scrolling, each gesture with how far the finger
and the page went, when the page first moved, the frames and their longest gap, any hold-then-jump of
a fling, the longest the thread was held and by what; a gesture the page didn't follow is marked) to
copy or share with the developer right after a freeze. `ui-you` checks the sheet; `ui-scroll` checks
the report after a fling.

The page can't see the rest of a scroll: Android's UI thread, which takes each touch and drives a
fling, and the drawing of the app's window. So the Android side (`Diagnostics.java`, behind the
`diag*` and `trace*` bridge methods, which answer only the app's page) keeps Android's own timing of
each frame of the window (FrameMetrics: the frame, its deadline, the GPU's time on Android 12+, how
long it waited for the UI thread, the RenderThread's part, where the WebView draws) and how late each
touch reached the app's UI thread, and the report adds them to each gesture, with the display's
refresh rate. The glass speed test reads them for each look too, with the display at its fastest rate
for the test (a finger switches most phones to it; a page scrolling by itself doesn't), since the
page's own frames can look even while Android draws them late. And "Record what the phone does" takes
12 seconds of the WebView's own trace events (android.webkit.TracingController: input latency, frame
reporting, the display compositor, the WebView's drawing, every thread's tasks), saved to the app's
cache, read back by the page 256 KB at a time and summed up by `src/tracesum.js` (each scroll update's
way from the finger to the screen, stage by stage, starting with its time on Android's UI thread;
the frames dropped while scrolling and each frame's steps; each fling's speed and how evenly it was
moved along; the GPU's drawing; the busiest threads and the longest tasks), then deleted. The sums go
in the report; the recording itself never leaves the phone. `test/tracesum.mjs` checks the sums on a
made-up trace read in pieces down to one character; `ui-you` runs a recording against a stand-in
for the Android side. Each gesture in the report carries the glass effects it ran under, so flicks
in different looks can be compared in one report.

The glass speed test has two halves. In the first the page scrolls itself (its `scrollTop` from a
frame callback), each look of the glass in turn, on Plan; on the owner's phone that was smooth in
every look while the page stuttered under a finger in Liquid, and a page that scrolls itself skips
everything a finger brings: Android's UI thread taking each touch, the WebView's touch handling, its
fling. So in the second the phone flicks the page itself (`diagFlick`, `Diagnostics.flick`: Android's
own touch events, a finger down, a move every 8 ms, the finger up at speed, sent through the app's
window as a finger's are; only a straight vertical move of 100 px or more, so it can scroll and never
tap), the same looks on Settings, four flicks each, every frame of the page timed with its scroll
position: how long after each touch the page moved, any time it held still mid-fling then jumped, and
Android's own frames. Then once more as designed, recorded, so the report has the trace of those
flicks too. Throughout, the glass is held as Liquid's (`U.glassHold(true, 'liquid')`, which bends the
bottom glass while the page moves whatever the setting). `ui-scroll` runs both halves, the phone's
flicks played by a stand-in that sends CDP touches.

**Nothing follows the scroll position.** Up to 1.8.9 the glow rose and faded with the page's
scroll, a scroll-linked animation (`animation-timeline` on the page's scroll timeline). With an
animation linked to a scroller, Chromium's compositor applies each step of a touch scroll on it only at
the start of a frame (`InputHandlerProxy`: the scroll needs frame alignment), so the page and the
animation move together. A WebView gets those frames only when the app asks it to draw, and on the
owner's phone in Liquid a flick's steps waited up to 2 s (1.8.9's recording: scroll updates queued in
the renderer's compositor 0.7 s at the median), then landed at once: a page that held still, then
jumped. Auto and Flat hid the glow while the page moved, which took the animation off the compositor
(Blink doesn't composite an animation on something that paints nothing), and scrolled smoothly; a
page scrolling itself (the speed test's first half) never goes through that queue. The glow now fades
on a timer once the page is scrolled down (`#app[data-page-scrolled]`, set with the bar's frosted
edge in `core.js`). `ui-scroll` checks that no animation runs on a scroll's timeline, and no page
names one, in every look; Refract's own scroll-driven effects (`data-reveal`, `data-parallax`,
`.rf-list-swipe`) stay unused.

**Scrolling, and work that can wait.** A fling should only move what's already drawn
(`src/styles/perf.css`). While the page scrolls (`#app[data-scrolling]`, set in `core.js` and
cleared 150 ms after the last scroll) the background glow holds still, and the glass at the bottom
(the tab bar, Today's floating buttons, the workout capsule) loses its bend: its lens's strength eases
to nothing in thirds over 160 ms, then the lens comes off (`[data-gh-flat]`), which looks the same;
once the page stops it goes back on at no strength and eases up over 280 ms (`bend` in `core.js`).
Its frost stays, and the bar's buttons keep their lens: 1.7.0 dropped every lens at once and the
title went sharp under them. The glow also stops drifting 20 s after the last touch, key or scroll
(`#app[data-idle]`), and fades out in its gradients' own stops rather than through a mask. The
bar's frosted edge is a single 12 px blur (Refract's is 8: the wider one looks the same under its
tint and is cheaper, as the renderer works a wide blur out at a lower resolution), drawn only while
it shows, and whether it shows comes from an IntersectionObserver on the large title, so a scroll
reads nothing from the layout. Refract's light no longer hears each scroll (it read where every
glass was, a frame at a time, to find the same angles): it's refreshed once a scroll ends. What
makes a fling miss frames is the glass: each piece over the page is filtered again every frame it
moves (1.8.1 dropped about 30% of a touch fling's frames on Today at 4× CPU in software; 1.8.2
about 16%). Under the workout player and set-up the page's bars and glass are hidden. Set-up's cards are
near-opaque rather than frosted, and its glow holds still while it scrolls. The badges
gallery lays out and draws a block only as it comes near (`content-visibility: auto`; on Health,
Progress, Settings and the moves it made no difference and moved rows by 1 px, so they don't); a
page opened again where it was left gets the heights its blocks had,
so it opens on what was showing. Medals share one set of gradients. Progress bars shine once, as
they show or change, not forever. Work that can wait waits for `U.calm()`: no finger on the screen,
no scroll or touch for 400 ms, no sheet moving and no control held or gliding (`U.controlsMoving`;
`U.whenCalm(fn)` runs it then): saves, Plan's flat stills, a control's lens maps. Work that would
hold the page's thread for a while (a 3D still, the 3D chunk and its warm-up, a background re-render
such as Today's insight line, the 3D canvas shrinking once no figure shows) waits for `U.quiet()`
instead: calm, and nothing for 1.5 s (`U.whenQuiet(fn)`). On a phone a touch's scroll waits for the
page's thread, and the likeliest moment for the next flick is right after the last one settles:
filmed on one, three flicks in a row froze for 100 to 330 ms each and then jumped, with a still's
encode or a re-render running under the finger, let loose by the calm moment 400 ms after the last
scroll. A 3D still now draws on the thread only its figure's frame and the copy out of the GL
canvas: its shaders compile in the background where the GPU allows (`compileAsync`) and its picture
is encoded in the background (`toBlob`; `figure3d.stillAsync` and `stillNow`), where `toDataURL`
took 110 ms and more on the thread. The warm-up (`figure3d.preload`) also keeps a wall's transparent material
compiled (a program of its own, which a still of a wall or door move compiled again every time) and
ends with one still the size of Plan's tiles drawn out through a 2D canvas, the first such copy being
the dear one (700 ms in a software-GL test, 130 ms after); `ui-figure` checks both. `ui-scroll` taps
the Plan tab with the figure warm and flings 400 ms on, then checks that from the flick until 1.1 s
after the page stops no task holds the thread for 120 ms (at 4× CPU), and that the tiles' stills
still come afterwards (on 1.8.2 the first still, let loose at calm 400 ms after the tap, held the
thread 1 to 2 s at 4× in mid-fling). `test/ui-scroll.mjs` scrolls every
main screen at 4× CPU, traced, and holds the budgets; `--vs=<dir>` compares two builds run by run, and
`--ablate=<part>` switches one part off to show what it costs. It also touch-scrolls (real touch
flings, `Input.dispatchTouchEvent`) on pages driven through raw CDP: Playwright's page helpers inject
a blocking `touchstart` listener on the window, which by itself makes any page scroll on the main
thread, so a touch scroll measured through them is wrong.

**Saving.** `U.save()` never writes in the tap that changed something. `GH.store` waits for the page
to be idle (a second at most), and while it's busy (a scroll, a drag, a knob gliding) for `U.calm()`
too (three seconds at most), then hands the JSON to `AndroidBridge.saveAsync`, which writes it on its
own thread, so a burst of taps is one write. A waiting save is written at once when the page is
hidden or goes away. Each save also fires `gh-change` on `document` (badges listen for it), and
`GH.migrations` holds the upgrades `store.migrate` runs on a loaded state. A restored backup goes
through `store.sanitize` first: a size cap, no `__proto__` keys, and every field's type and range
checked, so a crafted file can't break the app.

## Refract, the design system

Every screen is made of Refract, a liquid glass design system: its glass, controls, motion, icons,
type and tokens. `vendor/refract/` holds Refract 1.4.0 exactly as its design system ships it
(`vendor/refract/SOURCE.md` says where from, with each file's SHA-256, which `test/buildcheck.mjs`
checks). It arrives minified, so the app never patches it: what the app needs differently goes
through Refract's API, its attributes and the app's own CSS. To update it, copy the new
`bundle.js`, `bundle.css`, `index.d.ts` and `tokens.json` and write their hashes in `SOURCE.md`.
`scripts/build.mjs` ships the bundle as it is and drops the style sheet's demo landscapes
(`.rf-art`, `.rf-scene`, about 49 KB the app doesn't use; `pruneCss`).

What the app turns off, and why:

- **Refract's haptics** (`data-rf-haptics="off"` on `<html>`, `src/shell.html`): the app's own
  play instead (`src/platform.js`, `Haptics.java`), with their strengths and the on/off setting.
  Refract's would buzz a second time on every control.
- **Refraction by default** (`Refract.init(root, { lens: false })`, `RF_INIT` in `src/ui/core.js`):
  only glass marked `data-lens` refracts, since each lens is redrawn every frame the page moves
  under it.
- **The light while busy**: on a phone, glass rims follow how it's tilted. The light holds still
  while a finger is on the screen and the page scrolls, while a sheet moves, while the workout
  player or a live activity is open,
  with Moving background off and under reduced motion, and follows the tilt again when things are calm
  (`U.steadyLight`, `core.js`).
- **Click effects where a drag starts**: Refract's ripple, click ring and icon effects stay (they're
  part of its feel), except on Plan's week strip, whose day pills are dragged, and on the tab bar
  (`data-rf-effect="none"`): the ring reads where the tapped tab is after the click's handlers have
  drawn the new page, which laid the whole page out inside the tap (its glass bead is its answer).
- **The light only for a mouse**: `Refract.init` registers each glass with its light unless told
  not to (`RF_INIT` in `core.js`), and every page that brings new glass then had the light read
  where every glass on screen is and start a paused animation for each rim. Without a fine pointer
  that hovers, every rim gets the light's resting angle, which is what an unregistered rim shows,
  so only such a screen registers its glass.

The controls (`src/ui/controls.js`): Refract 1.4's own switch and segmented control take any
movement past 3 px as a drag, so a tap that wobbles would be lost. The app replaces those two
behaviours (and adds the chip choice) with its own gesture rules (`U.switchGesture`: 12 px to drag,
10 px up or down to scroll, the tap rescue), but draws them with Refract's liquid engine
(`Refract.Liquid`): a frosted bead that rises into a lens under the finger, follows it on springs
that keep their speed, and lands with a squash, exactly as Refract's own. A switch's knob and a
segmented control's bead are the engine's only while they're held (lifted, after 80 ms of a finger
on them, or dragged) or moving, and it's handed back once they've landed: at rest Refract's style
sheet puts the knob at either end, and the bead sits where a transform puts it. A touch alone
doesn't take it on, since most touches on a switch's row start a scroll: until 1.8.9 the switch took
it at the touch and, as the knob then neither lifted nor moved, never handed it back, so each scroll
from a row in Settings left an engine and its lens filter behind and the page never calm. The engine's
lens is drawn pixel by pixel in JavaScript, so a control costs nothing until it's touched (at launch
these held up the first frames); the knob's maps are drawn once, in a calm moment after the first
switch shows, so the first touch doesn't wait on them. The knob glides on the main thread, so
nothing heavy runs while it does: a switch's handler runs after the next frame, a re-render of the
same page it asks for waits until the knob has landed (1.2 s at most; `holdRenders` in `core.js`),
and work waiting for `U.calm()` waits for the knob too.
A resting bead's lens is a backdrop filter redrawn every frame the page moves behind it, for an
edge hidden under the frost, so it only works while the bead is lifted (`data-lifted`;
`src/styles/controls.css`). The tab bar is Refract's own (its pill and its lens); the app keeps
the bar from panning and ticks once per tab a drag passes.

Re-renders keep the parts Refract adds inside components (`INJECTED` in `core.js`: the tab bar's
pill, the segmented lens, the click ripple and the rest) and the attributes it sets (`KEEP_ATTR`).

Where the app uses Refract 1.4's newer parts:

- **Menus**: a button whose sheet would only be a list of actions opens Refract's menu instead,
  thick glass that grows out of the button and dissolves back into it (`U.menu` in
  `src/ui/motion.js`; the player's, an activity's, a plan day's and the chat's options). Each item
  is its action's own button; the arrow keys, Home, End and a letter move through it, Escape, a tap
  outside and Android's Back close it, and focus goes back to the button. Opened from a sheet, it
  goes in the sheet's dialog. A sheet that holds more than a list stays a sheet.
- **Sheets** (`src/ui/sheet.js`, `src/styles/sheet.css`): the panel's material is a layer of
  Refract's thick glass with its silver rim (the edge that catches the light) and sheen in every
  frame, from the slide up through a drag to the slide out. It's frosted at medium height, and
  solid under the rim and sheen at full height, while it moves and while its content scrolls (a
  blur under anything that moves is redrawn every frame; the rim and sheen move with their layer).
- **Page dots**: Refract's `.rf-pagedots` (its ink worm stretches to the page and splats there) for
  the badge reveal and the tour; they follow the page however it's turned (`aria-current`).
- **Plan's week strip**: the day picked is a bead of the liquid engine, as the segmented controls'
  thumbs are; it travels between days and holds the weekday while the weeks slide under it.
- **Bursts** are 8 to 14 beads, Refract 1.4's range (`test/ui-motion.mjs` checks every count).
- **Glass in the content** is for controls that float: a search field in a page is a `fill-3` well,
  and a page's own buttons are filled, not glass.

The credit: Settings > About has "Built with Refract" with its mark (`U.refractMark`, drawn by
Refract's `.rf-mark`), and the open-source licenses sheet opens with it.

## 3D exercise figure

`src/engine/figure3d.js` builds the lazy chunk `dist/lazy/figure3d.js` (three.js, about 620 KB
minified), which `GH.lazy('figure3d')` loads when it's needed. It sets `GH.figure3d`:

- `supported()`: whether WebGL works here (checked once).
- `mount(el, move, opts)`: a controller shaped like `GH.pose.mount`'s, plus `setView(name)`,
  `phase()` and an `onPhase` callback.
- `still(move, opts)`: a thumbnail as a data URL, or `null` without WebGL. `cachedStill()` returns
  one only if it's already drawn, so a page render never waits on the GPU. `stillAsync()` is the
  same with its shaders compiled and its picture encoded in the background (the player's and move
  sheet's stills).
- `stillNow(move, opts)`: a still drawn now, in the caller's idle moment (posed, one frame, the copy
  out and the crop: a few frames' work once warm), so a caller with time left can draw another;
  `{ url }` is a promise of the data URL, encoded in the background. One that needs shaders no warm
  view keeps compiled returns `{ wait }` instead, resolved once they've compiled in the background
  (its posed figure is held meanwhile, so they stay compiled), and the next call draws it.
- `preload()`: builds the renderer, the body, the equipment and the lighting, then compiles the
  shaders with a view it keeps, one small piece per idle callback so taps never wait on it.

The chunk authors no poses. Every frame it lifts the 2D joints from `GH.pose` into 3D. Side, front
and top views each have their own rules, and segment lengths stay constant. A fix to a move's 2D
data therefore fixes both figures. Everything is procedural: no textures, fonts or models.

All figures share one WebGL renderer. It draws at most 30 frames a second (60 while you drag) and
stops while a figure is off screen, covered by the how-to sheet or the page is hidden. With no figure
on screen the shared canvas shrinks after 2 seconds, and the GPU context is handed back after three
idle minutes, or 30 seconds after the app goes to the background. If WebGL is missing or the
context is lost, the figure frees everything it held, its canvas is removed and
`opts.onFallback(ctl)` is called asynchronously, so the player can mount the SVG figure instead.
Two losses while figures are on screen keep that session on the flat figure.

In the app, `figure()` in `src/ui/player.js` hands the player and move sheets one
controller that swaps what's underneath it: the flat figure while the chunk is still loading, 3D once
it's there, and flat again if `onFallback` fires. Set-up fetches the chunk. The GPU warm-up
(`U.warmFigure`) runs about 8 seconds after launch only when today is a workout day (once it's calm,
`U.calm()`: not in the middle of a scroll or a touch), or at once when a finger lands on something
that opens a figure. `GH.figure3d.warm()` turns true when the warm-up has finished compiling its
shaders, not when it starts: a figure opened in between would wait on the compile, so it shows its
kept still meanwhile. Stills of today's figures for those boxes (for the next launch, in
localStorage, `gh.figStills`) start 4 seconds after the warm-up, one per idle moment while no figure
is on screen. Settings keeps the choice in `profile.prefs.figure` (`'3d'` or `'flat'`), with
`figSkin` and `figShirt` for the look. The tempo strip under a figure comes from the move's `rep`
steps and lights up from `onPhase`.

**Stills kept on the phone.** With the 3D figure picked, Plan's tiles, the plan builder's, set-up's
reveal and Settings' preview show the 3D figure's stills of the moves; the flat figure shows only
when it's the setting, or where a still can't be drawn (no WebGL 2, the chunk didn't load, a still
that failed). `src/ui/stills.js` (`U.stills`) keeps them across launches in IndexedDB (`gh-stills`),
under the move as the person does it (`forPerson`: their kit), the look (theme, skin, shirt), the
size and `GH.FIGURE`, an id the build gives the figure (its chunk with three.js, the pose engine and
the moves), so a change to any of them draws it again, and only then. What's kept is read into
memory in one request once the first frame is drawn (with the 3D figure picked; nothing at boot
otherwise), so Plan puts a kept still straight into its tile's HTML (`U.stills.img`): it's there
from the page's first frame, without the 3D chunk. A tile without one shows its own background
(`U.stills.tile`) until its still is drawn, which then fades in (a tile in another look keeps its
old still until the new one is in). About 3 s after launch, once it's quiet, the stills of this
week's and next week's moves that aren't kept (`U.planStills` in `src/ui/plan.js`: what each day's
card shows) are drawn ahead, warming the figure up for them, so Plan finds them even on the first
day (after set-up too); when they're all kept nothing loads. New ones are drawn with `stillNow` once
the figure is warm, as many per idle moment as fit, only while it's quiet (`U.quiet`) and no
figure's box shows: what a screen waits for first, then what's drawn ahead. Up to 300 are kept; past
that the oldest that this week and next don't show go, and ones an older figure drew go once a
launch. The plan builder's large tiles (its picker's) are drawn as they come near the screen and
held for the launch only. Reset everything deletes them. `ui-plan` checks that no tile ever holds
the flat figure while 3D is picked, the drawing ahead, Plan's first render after a relaunch, a new
look and the flat setting; `ui-figure` Settings' preview after a relaunch, and that stills wait
while the page is in use and then go several per idle moment.

```sh
npm run build && node test/figure3d.mjs [filter,…] [--dark] [--mirrored]
node test/ui-figure.mjs [--dark] [--shots]   # the figure inside the app, and the no-WebGL fallback
```

The test renders every move in Chromium (SwiftShader), plus gym fixtures for barbells, cables,
benches, machines and cardio kit. It checks the frames, the API and the fallback, and writes
contact sheets to `build/fig3d/`. For looking at details, use `--size=WxH`, `--cols=N`,
`--view=side|front|three-quarter` and `--focus=head|hand|foot|trunk`.

## Android build

`scripts/build-apk.sh` compiles against the Android 14 (API 34) framework jar from Maven Central
(Robolectric's `android-all`, about 137 MB, downloaded once to `~/.cache/gradient-health` and checked
against a pinned SHA-1) and targets API 36. The packaged aapt can't read newer framework resources,
so the app links against 34 and only calls newer APIs behind `SDK_INT` checks (edge-to-edge insets,
predictive back, haptic constants).

Build it on Ubuntu 24.04 or Debian, with JDK 17 or newer:

```sh
sudo apt-get install -y --no-install-recommends aapt dalvik-exchange zipalign apksigner
npm ci && npm run build && npm run apk
```

The signed APK is written to `build/gradient-health.apk`. You can override `APP_HTML`,
`VERSION_NAME`, `VERSION_CODE`, `OUT`, `CACHE_DIR` and `NATIVE_LIB_DIR` (see the top of the script).
`versionName` comes from `package.json`; by default `versionCode` is the current time in minutes, so
every build installs over the previous one. When `scripts/build-native.sh` has built the on-device
coach's native engine (see On-device AI), its libraries go into the APK (installed extracted,
`extractNativeLibs`); without them the app uses its in-app engine.

**CI.** `.github/workflows/android.yml` builds `dist/` and runs the tests, fails if the committed
`dist/` is stale, builds (or restores from its cache) and tests the native engine, then builds the
APK and the Android App Bundle with the test key and attaches them to the run as the
`gradient-health-test-<commit>` artifact. Only on `main` does a second job sign them with the release
key and replace the release tagged `latest` (see Publishing, Builds).

**Signing keys.** Builds are signed with the release key when it's given (in CI only by the release
job on `main`; see Publishing), else with `android/gradient-health.keystore` (alias `gradient`,
password `gradient-health`), a test key committed so a local build works out of the box. Its
password is public: builds signed with it are for trying the app only, never for a store.

**Edge to edge.** The app draws behind the status and navigation bars. `MainActivity` sends the bar
and keyboard insets to the page (`__gh.setInsets`), which pads itself with `--sat`, `--sab`, `--sal`
and `--sar`. The page reports its theme back (`AndroidBridge.setSystemBars`) so the bar icons stay
readable when the app's theme differs from the phone's.

**Haptics.** `AndroidBridge.haptic(kind)` plays one of its kinds, in five groups: touch (`tap`,
`press`, `select`, `tick`, `edge`, `toggleOn`, `toggleOff`, `detent`, `hold` for a long press that
picks something up, `day` for a day picked), navigation (`tab`, `nav` for a page, `back`, `grab`,
`drop`, `sheet` as a sheet rises, `menu` as a menu blooms, `dismiss` as either is put away, `swipe`
for a sheet flicked down), feedback (`success`, `log`, `undo`, `deny`, `warning`, `error`, `heavy`,
`save`, `copy`, `send`, `remove` for an entry taken out with Undo, `refresh` when fresh data is in,
`scan` for a code read), workout (`countdown`, `go`, `pause`, `setDone`, `done`, `workoutDone`,
`levelUp`, `milestone`, `pr`, `start`, `cancel`, `skip`, `extend` for more rest, `swap`) and moments
(`wobble` and `crack`, a sealed badge's first two taps, then `badge`, `celebrate`). An action plays
the kind for what it does, one per tap: a tap that opens a sheet leaves it to the sheet's own, a
menu's pick to its action's. Each is its own composition of the phone's haptic primitives (see
`Haptics.java`: each primitive's support is checked, with a stand-in for a missing one), then a
predefined effect for the one-beat kinds, then an amplitude waveform, then on/off pulses. Light plays
at 0.75, Medium (the default) at full strength, and Strong adds a low tick after each click. Every
kind plays as a media vibration, so the phone's touch intensity can't dull it; the touch and
navigation kinds are skipped when its touch feedback is off. The bridge plays them from its own
thread, without waiting for the UI thread. `platform.js` has the same kinds as browser patterns, a
rank for each, and the rules for when two meet (a toast's haptic is a consequence that leaves its
action's feel alone); `core.js` (`wire`), `sheet.js` and `U.menu` play the ones that come with
controls, sheets, menus and dialogs by themselves (a dialog's action can name its own: `haptic:
'cancel'` on Cancel workout), `data-haptic="<kind>"` on an action plays that kind, and
`src/ui/hapticsui.js` has the Settings rows (`U.hapticRows`), the Feel each one gallery and the
haptics of menus Refract opens by itself (a popover a button points at). With the
app out of sight, workout timer alerts fall back to alarm-class vibrations (`vibrate`,
`vibratePattern`), the only kind Android lets through then.

**Health Connect.** The platform API needs Android 14 or newer. Gradient Health reads steps, sleep, weight,
height, body fat, resting heart rate, HRV and exercise, and since 1.2 heart rate (30-minute averages,
for an estimated resting heart rate), active calories, distance and, with calorie tracking on,
nutrition. It can write exercise sessions for the workouts finished in the app (keyed by day, so a
re-save updates instead of duplicating) and nutrition records for logged meals. It syncs
when the app opens or comes back (at most once a minute), every 15 minutes while open, after a
workout and on pull-to-refresh. The first read covers 90 days; later reads cover the gap since the
last one plus two days. With the app closed, the background sync below reads every 15 minutes.
1.4 adds, for outdoor activities, reading total calories and writing exercise routes, distance and
active calories; the permission request asks for them along with the rest.

**Background sync.** `HealthSyncJob` is a periodic JobScheduler job (15 minutes, Android's minimum,
with 5 minutes of flex; Doze can space runs out), persisted across reboots (`RECEIVE_BOOT_COMPLETED`)
and needing no network. `HealthSync` schedules it on app start and resume, after every Health Connect
permission answer and from the Settings switch, while four things hold: the switch is on (the
default), Health Connect is connected, this phone's Health Connect can read in the background, and
the person allowed `READ_HEALTH_DATA_IN_BACKGROUND`. That permission is part of the platform from
Android 15; on Android 14 it's there only with a Health Connect update, so the app checks
`PackageManager.getPermissionInfo` (and the Android 14 SDK extension 13 that brought it) and only
then asks for it, together with the other Health Connect permissions or on its own
(`hcBackgroundRequest`). A run that finds one of them missing records why and cancels the job.

Each run reads the last two days through the same `HealthBridge.read` the page uses (it takes a
`Context` and a callback, so no Activity is needed) and saves the JSON `onHealth` would get as
`noBackupFilesDir/health-sync/<epoch ms>.json` (no-backup storage: it's a queue, not data to restore).
A read with the same records as the last one saved isn't saved again, and one where every allowed
type failed isn't saved at all. The folder keeps reads older than a day at one per 6 hours (each
covers two days), then at most 300 files and 3 MB, dropping the oldest. `lastRun`, `lastOk` and
`error` go to the `health_sync` SharedPreferences.

The page asks with `hcPending()` (up to 50, oldest first) and deletes what it handled with
`hcPendingDone(ids)`. `GH.health.sync` folds them in before each foreground read, and again after it,
and so on boot and resume; so does the page when the app says a read finished
(`__gh.onHealthBackground`). They're folded in oldest first with the same `ingest`; one ending before
the last sync (or a newer background read) is only marked done. A read that starts before the last
sync leaves no gap, so the last sync moves up to it and the next foreground read is shorter. A type
whose read failed (timed out, rate-limited) keeps what earlier reads found instead of being wiped.
`hcBackground()` gives `{supported, granted, on, scheduled, lastRun, lastOk, error, pending}`;
Settings, Health data, shows the switch and "Every 15 minutes · last at 3:15 pm", or why it's off.

**Outdoor activities.** The page records runs, walks, hikes and rides through `ActivityService`, a
foreground service of type `location` that the page starts while it's in front (so no background
location permission is needed). It asks for precise location, physical activity (the step counter,
Android 10+) and notifications (13+) with `actRequestPermissions()` (answer:
`__gh.onActPermissions`), then `actStart({id, type, title, units?, autoPause?, voice?})`. The
service takes a GPS fix about once a second from the GPS provider (on Android 12+ with a
`LocationRequest` at high accuracy, every second and unbatched; else the fused provider on Android
12+, else the network). Until the GPS has a good fix it also passes the page a rough position (the
freshest one the phone has, then the fused or network provider's every 2 s, for 3 minutes at most),
for the map only, never into the track. It counts steps from the phone's step counter, and shows an
ongoing, quiet notification, "Run · 12:34 · 2.14 km" with the average pace (or "Auto-paused"), Pause
or Resume and Finish; tapping it opens the app (the page gets the route `activity`). Finish there
ends the activity and leaves a note that opens the summary. While the page is in front it gets
`__gh.onActivity(state)` about once a second (with `autoPaused`, `opts`, `coarse`, and the last
fix's speed and bearing). `actSetOptions({autoPause?, voice?})` changes the options while it records.

**Auto-pause and spoken splits.** With `autoPause` (to begin with on for runs and rides, off for
walks and hikes; the start sheet's chips, the live screen's options and Settings, What you track),
`ActivityAutoPause` stops the clock after 5 s without moving (20 s when the GPS gives no speed: then
a least-squares fit of the last 20 s decides) and starts it again after 2 s of moving, both dated
back to where the stop or the move began, so the fixes it was unsure of are stored flagged. It is
`autoPauser` in `src/activity.js` (the browser's recorder) in Java, and `test/activity.mjs` keeps the
two agreeing fix for fix. A pause or resume by hand takes over. With `voice`, `ActivityVoice` says
each km or mile ("2 kilometres. Time, 10 minutes 24 seconds. Pace, 5 minutes 12 seconds per
kilometre.", speed for a ride) through Android's TextToSpeech, with transient audio focus that ducks
other audio and no permission.

`ActivityTrack` keeps the recording in `noBackupFilesDir/activity/`: `<key>.json` with its details
(replaced atomically on every change and every 20 seconds) and `<key>.track`, one point a line,
`[t, lat, lon, alt|null, acc, speed|null, paused]`, appended as fixes come in. A fix is stored when
it's 3 m from the last one, 10 s after it, the first good one after bad ones or the first after a
pause. The distance leaves out points worse than 50 m, pauses (a pause ends the line), GPS jumps
(faster than 12 m/s from the last good point on a walk or hike, 25 m/s otherwise; three in a row
restart the line there) and standing still (the anchor only moves once the position has moved more
than the accuracy, and not while the GPS speed is under 0.4 m/s); between two kept points that both
have the GPS's own (Doppler) speed, the distance is that speed over the time between them, which
GPS noise doesn't lengthen. Loading a recording runs the same filter over its points, so a page
reload, a crash or a restart gives the same numbers; if Android stops the service mid-activity, it
starts again the next time the app comes to the front. A finished recording stays (actState reports
it with `active: false`) until the page saves it and calls `actClear(id)`; at most 20 finished ones
are kept.

**Maps.** An activity's route is drawn on the phone. With maps on (Show map on its summary, the map
button while recording, or Settings; Show streets from before 1.8 still counts as a yes), MapLibre
draws OpenFreeMap's tiles behind it (`src/actmap.js`, a lazy chunk): the route in the pace colours
(live: the activity's), the start, finish and km or mile markers, and where you are, following you
while it records until a finger moves it. Two fingers move it while one scrolls the page, and it
doesn't turn or tilt. Under reduced motion it jumps where it would glide.
- **Pieces kept on the phone** (`U.mapPieces` in `src/ui/activity.js`): every tile and range of the
  name font goes through a protocol of the app's own, `ghmap://`, which keeps it in Cache Storage
  (`gh-map-v1`, the newest 1,500, trimmed every 50 new ones). A map shown before draws at once with
  nothing asked of OpenFreeMap, offline too. OpenFreeMap rebuilds its tiles about weekly at new
  addresses (`/planet/<week>/z/x/y.pbf`), so a tile is kept under its address without the week: one
  from an earlier week is drawn at once (and offline), and this week's is fetched behind it to take
  its place. The TileJSON (which week is current) is fetched network first, once a session; offline
  the kept copy is used, and asked for again by the next map. Settings' Clear saved maps and Reset
  everything delete them.
- **Faster to the first map:** `U.actMap` asks for the TileJSON while the chunk loads, and the style
  takes the tiles from it directly, a round trip sooner than MapLibre fetching it after the style.
- **When it can't draw:** with none of its pieces (offline, never shown here) or no TileJSON, the page
  keeps the route it drew (a summary says why); the map tries again when the phone is back online,
  on a summary and while recording.
- **A theme change** recolours the same map (`restyle`: each layer's paint, and the route's), with
  nothing loaded again.
The CSP lets in OpenFreeMap and nothing else for maps (`test/security.mjs`, which also checks no
Google Maps key or code comes back).

The page reads `actState()` and `actPoints(from)`; `actSupport()` says whether the phone has GPS, a
step counter and Health Connect. For the summary, `hcSession({id, start, end})` answers
`__gh.onHcSession` with steps, distance, active and total calories and every heart rate sample in the
window from other apps and watches (the app's own records are left out, so a saved activity doesn't
count itself), plus which apps wrote them. `hcWriteActivity(...)` saves it as an exercise session
with its route (when routes are allowed), and distance and active calories only when the page
passes them, with client record ids from the activity's id so saving again updates it.

**Plan links.** `gradienthealth://plan?d=…` and `https://shadowsdistant.github.io/gradient-health/p/…`
(not verified, so Android opens the browser unless the person picks the app) open the app, which
hands the URL to `__gh.onLink(url)`. The link a cold start came with also waits for
`AndroidBridge.pendingLink()`, which returns it once.

**Claude app hand-off.** "Ask in the Claude app" sends an `ACTION_SEND` text intent to the Claude app
(`com.anthropic.claude`) when it's installed, and the share sheet otherwise. The text is the
question plus the same privacy-safe summary the API coach uses (`GH.ai.summary`).

**Privacy.** Health data stays on the phone. Android's device backup only gets the app's saved state
and settings when the backup is end-to-end encrypted with the screen lock: `res/xml/backup_rules.xml`
backs up nothing on Android 8 (it can't require encryption), `res/xml-v28/` requires it on 9 to 11,
and `data_extraction_rules.xml` on 12 and newer. The Claude API key is never in a backup, and on the
phone it's encrypted with a key from the Android Keystore (`SecretBox.java`, AES-GCM); a key saved
in plain text by an older version is encrypted on first read, and one that can't be decrypted (a
restored backup, a reset Keystore) is dropped so the person enters it again. Background reads,
activity tracks and models are in `noBackupFilesDir`, so backups never include them, and the backup
rules leave out notifications' preferences (`notify.xml`: the schedule, what was posted, the last
night's sleep), which are for this phone only.

**The bridge.** `AndroidBridge` only answers the app's own page: `MainActivity` follows the main
frame's address and sets `pageTrusted` only for `https://appassets.androidplatform.net/`, and every
bridge method that reads or changes the person's data, reaches the network or another app, or runs a
model checks it first. Only the app's own pages load in the WebView. Another http(s) page opens in
the browser, a frame never loads one, `javascript:`, `data:`, `blob:`, `intent:` and `file:`
navigations are blocked, and the WebView never opens a second window.

## On-device AI

A small open model runs on the phone with llama.cpp, one of two ways. `src/llm.js` (a lazy chunk:
`await GH.lazy('llm')` sets `GH.llm`) picks the engine, builds the prompt and streams the answer the same
way for both:

- **Native** (the default in the Android app): `android/jni/` is a small C API over llama.cpp
  (`ghllm_core.cpp`) with a thin JNI shim. `LlmService` runs it in its own `:llm` process, so a crash or
  an out-of-memory kill there can't take the app down; `LlmClient` binds it on first use, batches answer
  text every 50 ms and sends events to `window.__gh.onLlm`. `AndroidBridge.llmNative/llmLoad/
  llmGenerate/llmAbort/llmUnload` drive it. It uses 4 threads on 8-core phones (half the cores
  otherwise) and ships the arm64 CPU variants from armv8.0 to armv8.6 (`GGML_BACKEND_DL`); ggml loads
  the fastest one the phone supports from the app's native library directory.
- **In-app** (the fallback): llama.cpp compiled to WebAssembly
  ([@wllama/wllama](https://github.com/ngxson/wllama), whose one wasm is copied to `dist/lazy/wllama/`),
  on WebGPU only when a quick f16 self-test passes. Android's WebView is never cross-origin isolated, so
  it has no `SharedArrayBuffer` and runs on one thread: several times slower than native. It's used for
  a model the native engine couldn't start, for the rest of the session after the native process dies
  while working on screen, and in browsers and tests.

Both are the same llama.cpp release (b10663). Details:

- **Models.** Qwen3.5 in three sizes, Q4_K_M from unsloth's Hugging Face repos: Fast (0.8B, 533 MB),
  Balanced (2B, 1.28 GB, offered with 6 GB of RAM or more) and Best answers (4B, 2.74 GB, 12 GB or more).
  Balanced is the one suggested on phones with the native engine and 8 GB or more (on the model check's
  prompts it reads the facts clearly better than Fast, at about half the speed); Fast everywhere else. Qwen3.5 mixes gated delta-net (recurrent) layers with full attention.
  1.2's Qwen2.5 models stay in the table as `legacy`, with their SHA-256 pinned: never offered or
  downloaded again, but one already on a phone keeps working until it's deleted.
- **Prompts** are built in JS (`chatml()`), so neither engine depends on a template engine: ChatML, and
  for Qwen3.5 an empty `<think></think>` block after the assistant header, which is what its own
  template does with thinking off. `<|im_start|>`-style tags inside a message are defused. The in-app
  engine gets the text through wllama's raw `createCompletion`, the native one as UTF-8 bytes.
  `visible()` still hides any thinking that slips out.
- **The cache.** `devicecoach.js` puts the rules and a brief of the person's data first, the same every
  turn, and `GH.llm.prepare(system)` reads them before the first question. Recurrent layers can't be
  rewound, so the native core saves a copy of their state where the first turn ends
  (`llama_state_seq_*_ext` with `LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY`, like llama.cpp's server does) and
  restores it for the next question, keeping the attention cache up to there; each question then reads
  only its own turn. The in-app engine gets the same from llama.cpp's server code (`cache_prompt`, and
  checkpoints one batch apart, hence `batch: 64` there; the native engine reads in batches of 256).
- **Grounding.** `src/devicecoach.js` doesn't make a small model reason from raw numbers. Each question
  goes in with FACTS: what the built-in coach (`src/coach.js`) works out for its topic, the How it works
  rule behind it (`src/data/science.js`) and, for today, what the plan changed and why. The chat shows
  them under each answer ("What it used"). Emergencies get the built-in safety answer instead.
- **Checked answers.** Small models still slip, so `GH.deviceCoach` holds them to the app's reading. A
  yes-or-no question the numbers settle (`GH.coach.verdict`: "Am I getting stronger?") and a question
  built on something that isn't so (`GH.coach.correction`: "Why is today lighter?" on a full day) start
  from the app's own words, passed to `GH.llm.chat` as `lead` (written into the prompt, so the model
  carries on from it). Afterwards `keepToGiven` leaves out any sentence with a number that wasn't in the
  prompt (a rounded one counts), and `finish` puts the app's own answer in its place if too little is
  left, with a note under the answer saying so.
- **Nothing hangs silently.** Range reads time out after 30 s (three tries); a load with no progress
  for 45 s and an answer with nothing new for 60 s are "stalled"; a wllama worker that dies (wllama only
  logs that) or won't stop within 5 s of Stop is shut down, and everything waiting on it is rejected.
  A model stays loaded 10 minutes while the app is on screen and a minute in the background, and goes
  when `MainActivity.onTrimMemory` says memory is short (`__gh.onMemoryLow`).
- **Crashes.** The page marks the in-app engine's loads and answers; if the renderer dies mid-way (the
  app counts renderer crashes, `AndroidBridge.rendererGone()`), the next chat says so and moves to a
  smaller size that's on the phone.
- **Self-test.** Settings, Check the on-device AI (`GH.llm.selfTest`): which engine ran, start-up, time
  to the first word, words a second, the WebView version and the log, to copy or attach to an issue.
- **Tailor my plan** (`src/tailor.js`, `src/ui/tailor.js`) turns a request into a proposal with rules
  first; what they miss goes to Claude (structured output) or the on-device model, held to a GBNF
  grammar (`GH.tailor.GRAMMAR`, passed as `grammar` to either engine) so it can only write the fields and
  values the app reads. A muscle group ("more legs") puts that goal first; a single muscle ("calves",
  "rear delts") goes into `profile.focus` (up to 4), which lifts its group a tier and leans that group's
  days toward it.
- **Downloads** run in Java (`ModelStore.java`, started by `AndroidBridge.modelDownload`): one at a
  time, only from Hugging Face, resumable from a `.part` file, optionally Wi-Fi only, after a free-space
  check. Every file is pinned in `PINS` in `src/llm.js`: the repo commit its URL points at, its exact
  size and its SHA-256, which come from the `pins` job in `.github/workflows/model-check.yml`. A file
  without a pin isn't downloaded at all, and one counts as installed only when its size, GGUF magic and
  SHA-256 match the pin. The Hub's `X-Linked-Etag` and `X-Linked-Size` only stop a download early when
  they disagree. A model an older version installed without a hash is hashed once in the background,
  and one that doesn't match its pin counts as not installed, so it can be downloaded again. Progress goes to
  `__gh.onModelProgress` at most 4 times a second; after a page reload `AndroidBridge.modelStatus()`
  reports it again. Models live in `noBackupFilesDir/models/`, so they stay out of device backups. The
  native engine reads the file there directly (`ModelStore.installedFile`); the in-app engine reads it
  through `https://appassets.androidplatform.net/models/` with HTTP Range support and a Range-backed
  stand-in for a `Blob`, so a model is never copied into browser storage.
- **Building the native engine.** `scripts/build-native.sh` fetches llama.cpp b10663 with git, checks its
  commit hash, and builds `android/jni` for arm64-v8a with the NDK (`ANDROID_NDK_HOME`), API 26,
  `c++_shared`, every library linked for 16 KB pages (checked with `llvm-readelf`). The libraries land in
  `build/native/lib/arm64-v8a/`, where `build-apk.sh` and `build-aab.sh` pick them up; a build without
  them ships without the native engine and uses the in-app one. CI builds them, caches them by the
  source and NDK version, and first runs `build-native.sh --host`: the same core built for the runner
  and tested (`android/jni/test_host.cpp`) against the tiny model, including that an answer from the
  checkpoint matches one read from scratch.
- **Tests.** The real models can't be downloaded in tests, so `scripts/make-tiny-gguf.py` writes tiny
  random-weight models (it needs the `gguf` package): `--arch llama` (the default, `build/tiny.gguf`),
  `qwen3`, or `qwen35` (`build/tiny-qwen35.gguf`, Qwen3.5's hybrid layout). A model family goes into the
  table only after its tiny model loads here, since the real files can't be tried. `test/llm.mjs` serves
  them to the built page and checks the catalog, prompts, loading, streaming, the cache, reading ahead,
  abort, unloading, the Tailor grammar and the download API, and runs the native adapter against a fake
  `LlmService` (streaming, Stop, a restarted service, a stuck or crashed engine). `test/ui-chat.mjs`
  runs the chat and Tailor with the tiny Qwen3.5 model. On GitHub, `.github/workflows/model-check.yml`
  (on pushes to the AI code, or by hand) downloads the real models: `test/model-check.mjs` asks the
  in-app engine through `GH.deviceCoach.ask`, and `test/model-prompts.mjs` writes the app's exact
  prompts for `ghllm_ask` (the native core built for the runner) to answer with Fast and Balanced, then
  prints each answer as the chat would show it:

  ```sh
  python3 -m venv build/venv && build/venv/bin/pip install gguf numpy
  npm run build && npm run test:llm      # makes the tiny models on the first run
  bash scripts/build-native.sh --host    # the native core, built and tested on this computer
  bash scripts/build-native.sh           # the arm64 libraries (needs the NDK)
  ```

## Food

Food tracking is off until someone turns it on (Settings, What you track). `src/food.js` is pure logic
on the saved state and is unit-tested (`test/food.mjs`): Mifflin-St Jeor times an activity factor from
the person's steps and workouts, a pace from the goal, floors, macros, and a burn estimate that learns
from logged intake and the weight trend (a regression on raw weigh-ins, blended in slowly).

- **Built-in foods** load on demand from `dist/lazy/foods.js` (`GH.foods`), built from USDA data.
- **Open Food Facts** (only with Online search and barcodes on): `FoodLookup.java` makes the request with
  the User-Agent Open Food Facts asks for, so the page's CSP keeps every other host out. `src/foodnet.js`
  keeps to their rate limits (10 searches and 15 products a minute) and sanity-checks every product.
- **Barcodes**: `src/scanner.js` opens the back camera with `getUserMedia` (MainActivity grants the
  WebView's video request after the runtime CAMERA permission) and reads frames with the MIT
  `barcode-detector` ponyfill over ZXing in WebAssembly (`dist/lazy/barcode.js` and
  `zxing_reader.wasm`), so no Play services are needed. A code counts once it's read twice in a row with
  a valid check digit; typing the number always works too.
- **Health Connect**: meals are written as `NutritionRecord`s with the entry id as the client record id
  and a version that grows with each edit, so edits replace the record; deletes delete it. Food other
  apps logged comes back as per-day totals. The nutrition permissions are only requested when calorie
  tracking is on (`AndroidBridge.hcRequestFood`).

## The plan engine, its AI check, and set-up

`src/optimizer.js` (`GH.optimizer`) plans each week for the person. `split` searches every way to
share the six muscle units over the training days (an exact branch and bound over the usual weekly
frequencies and their one-step variants) and picks the best; `weekPlan` gives each day its sets (every
group's weekly floor first, then by what a minute is worth toward the goals); `fit` fills each session
to about 92% of the time set and never more than 30 seconds over it. `score` weighs goal fit,
coverage, time, recovery, balance and variety, `explain` gives the "Why this plan" lines and
`alternatives` scores the classic splits. Weeks before `S.engineFrom` replay 1.5's templates, so
history doesn't shift. Plans are cached, and kept in `S.planCache` for the next launch.
`test/optimizer.mjs` checks the engine; `test/combos.mjs` plans about 2,400 combinations of answers
(`--full`: 3-wise, with 12-week runs, before a release) and checks that every session fits its time,
every group gets its week, only allowed moves appear and the same answers give the same plan.

`src/planreview.js` (`GH.planReview`) is the AI check. It sends next week's plan as built (each day's
groups and moves, weekly sets against targets, minutes against the time set, the score and the
planner's reasons, and up to 60 moves to swap in) to Claude, held to a JSON schema, or to the
on-device model, held to a GBNF grammar from the same spec. Health conditions and the exact age only
ever go to the on-device model. Each suggestion becomes a plan tweak and is tried with
`GH.optimizer.applyTweaks` on a copy: a broken rule, or a score more than 0.03 lower, turns it down
with the reason in plain words, and its text goes through the number check. The person picks which
to apply (`S.profile.planTweaks`), with Undo. Claude's weekly report asks for plan ideas in the same
request. `test/ai.mjs` and `test/ui-review.mjs` cover it.

Set-up (`src/ui/onboarding.js`) is six screens with one decision each, ending on the plan the engine
built (`GH.optimizer.explainProfile`) with its first workout a tap away. With no weekdays picked, the
usual pattern is turned so today is a workout day. Health Connect is offered after the first workout
(`U.hcInvite`), never before the plan. Reminders come on as it ends (see Notifications).
`test/ui-onboarding.mjs` covers it.

## Your plans

People can build their own plans, ask the coach to build one, or add one someone shared, and run it
with the app's own player, progression and readiness. `src/customplan.js` is pure logic on the saved
state (`test/customplan.mjs`); `src/ui/customplan.js` is the screens (`test/ui-customplan.mjs`).

- **A plan** is `{ v, id, name, note, days: [{ title, items: [{ move, sets, reps | secs, rest? }] }],
  weekdays, source: 'you' | 'coach' | 'shared', from?, createdAt, updatedAt }`, kept in `S.customPlans`;
  `S.activePlan` is the one in use (null: the coach's plan). `normalize()` brings anything plan-like (an
  older save, a shared code, a model's answer) to what this version runs: known move ids, 1 to 6 days,
  1 to 12 exercises a day, 1 to 10 sets, 1 to 100 reps or 5 to 600 seconds.
- **Running one.** Switching is an event (`{ type: 'plan', day, id, n, wd }` in `S.events`), so the
  calendar replays each week with the plan that was in force and past days keep their meaning. Four
  hooks in `src/brain.js`, marked `[custom plans]`: `calendar()` takes a week's sessions from
  `weekSessions()`, a missed day only moves sessions within the same plan's stretch of the week
  (`regime`, `until`), `buildSession()` hands custom sessions (tpl `c:<plan id>:<day>`) to
  `GH.customPlan.buildSession()`, and `finishWorkout()` moves their exercises on with `progress()`.
  Readiness, lighter weeks and short-time trims apply as usual. Progress is kept per plan in
  `S.planProg` (more reps or seconds, then more weight, back down when well short twice). A move someone
  can't do (equipment, a joint in `profile.careful` or `S.pain`, no jumping, a hidden move, anything the
  brain's rules leave out) is swapped for the most similar one they can do, and the plan says why.
- **The share code.** `encode()` packs a plan as compact JSON (`[name, note, from, weekdays | 0,
  [[title, [move, sets, amount, rest?], …], …]]`), compresses it with `deflate-raw` when that's smaller,
  and writes a version byte (top bit: compressed) and the body in base64url. The link is
  `https://shadowsdistant.github.io/gradient-health/p/#<data>`; `decode()` also takes
  `gradienthealth://plan?d=<data>`, `intent://plan?d=<data>#Intent;…` and the bare data. A typical
  3-day plan's link is about 350 characters, a version 12 QR code. `src/qr.js` draws the code as SVG;
  `test/customplan.mjs` reads it back with ZXing. Scanning is the barcode sheet with `{ qr: true }`.
- **Links into the app.** The shell calls `window.__gh.onLink(url)` when a link opens the running app
  (it returns true when it took the link; other handlers stay chained), and `AndroidBridge.pendingLink()`
  returns the link the app was started with. A link that arrives during set-up is offered on its
  welcome (`U.peekSharedPlan`): three screens into that plan instead of six.
- **The share page.** `src/share-page.html` is built to `docs/p/index.html` with the QR encoder and the
  move names inlined, so it makes no requests (its CSP allows only its own script, by hash). It reads the
  plan from the part after `#`, which browsers never send, and shows it. On Android it offers "Open in
  Gradient Health" (an `intent://plan?d=…` link with the releases page as the fallback); elsewhere it
  shows the code to scan. **GitHub Pages must be on** for links to open in a browser (the repository's
  Settings, Pages, Deploy from a branch, `main`, `/docs`). QR codes, and links opened straight in the
  app, work without it.
- **Build me a plan.** `generate()` reads the request with Tailor's rules plus the split and the time,
  has the brain plan a week for a copy of the person with those wishes, and turns it into a plan, so it
  only holds moves they can do. With Claude on (`GH.ai.json`, a JSON schema) or an on-device model (a
  GBNF grammar of the allowed move ids and exactly the days asked for), a model then renames, regroups
  and re-picks from `allowedMoves()`. `accept()` keeps its answer only if it's a valid plan of moves this
  person can do that passes the plan review's checks: each day fits the time asked for (sets come off
  the move with the most to spare until it does), every muscle group keeps at least half its weekly
  sets, the focus groups keep two thirds, and pulling still balances pushing. Otherwise the app's own
  plan stands.

## Notifications

A reminder on workout days, a walk or run on a rest day, a badge waiting to be opened, a word the
morning after a good night and a gentle note after a few days away. All local: no server, no push
service, nothing sent anywhere. Set-up turns them on for someone new as it ends: its last screen says
so over the button that finishes it, and on Android 13 and newer Android asks for the permission as
that's tapped, once, with set-up still showing (`U.notifySetupAsk`, `U.notifySetupDone` in
`src/ui/notify.js`); a no leaves them off with nothing asking again. Someone set up before keeps what
they have (`brain.js`'s default and the store's migration are off), and if that's off, a one-time
card on Today asks (once they've done a workout and had the tour). Settings, Notifications, has a
switch per kind and the reminder time.

**The page plans, Android delivers.** `src/notify.js` (`GH.notify`, a chunk) is a pure planner:
`plan(S, now, o)` works out the next six weeks from the plan as Plan shows it (`GH.planWeek`), what's
done, walks and runs (recorded here or from Health Connect), sleep from Health Connect, badges
(`GH.achievements.unopened`, else `unseen`), the settings (`S.profile.prefs.notify`) and what
Android posted lately (`o.sent`, `o.lastPosted`). Each time the app goes to the background (the page
hidden, or Android's pause) and each time it opens, `src/ui/notify.js` hands the whole schedule to
Android (`AndroidBridge.notifySchedule`), which replaces the last one. So it always follows what the
person just did, and when they stop opening the app the schedule from their last visit plays out:
that's the back-off, with no page running. The rules (`test/notify.mjs`, in any time zone):

- One a day at most, by priority: badge, workout, sleep, move, comeback. Never 9:30 pm to 8 am, nor in
  the 15 minutes after the app is left; nothing more today during a workout or once one went out.
- workout: a planned day not done yet ("Chest, arms and abs, 25 min"), at the reminder time: 30
  minutes before the usual start (the median of 4 weeks, 8 am to 8 pm), else 6 pm, or the time set.
- move: a rest or light day, twice a week at most: their habit ("Saturday run?", 3 days on that
  weekday in 8 weeks, one in the last 3, half an hour before they usually set off, so not for a 7 am
  run), else a walk; not once they've walked or recorded something that day.
- badge: two hours after the app is left, or the next morning at 9; once per badge.
- sleep: a question for a rest day's morning, when the watch puts sleep in Health Connect and the
  background sync runs. Android answers it then: the night (sessions ended since the day began, from
  the sync's last read, which `HealthSync` hands to `Notifier.sleepRead`) against the page's tiers
  (above the week's best, or half an hour over the usual; 7 to 11 hours), looking again every 20
  minutes until a read has the night. Only good news; otherwise the day's walk (`alt`) goes instead.
- comeback: days 3, 10, 17, 24, 31, 38 and 45 after the last open, each worded differently, then
  nothing. The everyday kinds come only within 2 days of the last open.

**Android** (`Notifier.java`, `NotifyReceiver.java`) checks what the page sends (64 KB, 60 items,
plain ids, known kinds and screens, short texts, times ahead and within two months), keeps it in the
`notify` preferences (out of backups) and sets one alarm, for the soonest item: `setWindow`, inexact,
so no exact-alarm permission, and while the phone dozes it waits for it to wake. It's set again after
each item, a restart and an update. At its time an item is dropped if one went out today, it's quiet
hours, the app is on screen, an activity records (a walk also waits for a day with none recorded), or
Android has its kind off (a channel per kind) or it's two hours late. One notification shows at a
time, and each goes once it's out of date. `POST_NOTIFICATIONS` (Android 13+) is asked for at the end
of set-up and when they're turned on (`notifyRequest`, answered with `__gh.onNotifyPermission`);
after a no, Settings opens Android's settings for them. A tap opens its screen the way a plan link
does: `notifyTap()` for the one the app was started from, `__gh.onNotifyTap` while it runs. A badge's
opens Badges with what's still sealed coming up over it, ready to be opened (`openRoute` in
`src/ui/core.js`).
`test/ui-notify.mjs` covers the card, Settings, taps and the hand-off against a stand-in
(`test/fixtures.mjs`); compile the Java as `build-apk.sh` does.

## Badges

About 60 badges in ten categories and four tiers (bronze to platinum, Common to Very rare).
`src/achievements.js` (`GH.achievements`) is pure logic on the saved state (`test/achievements.mjs`):
what each takes, worked out from history, so a badge is dated the day it happened (the 10th
workout's, the day a streak reached 7). Once earned, a badge is kept for good: a broken streak or a
deleted log leaves it where it is. `src/ui/badges.js` draws the medals (one SVG each, the gradients
in one shared set), the You tab's card, the gallery, a badge's sheet and the reveal
(`test/ui-badges.mjs`). A saved change is checked 800 ms later, only for the categories it touched.

- **Sealed until opened.** A badge is earned sealed: `S.achievements.earned[id]` is `{ day, at,
  opened: false }` (the record's v 2). `GH.achievements.unopened(S)` lists the ones still sealed,
  oldest first (what the reveal opens by default, and what a reminder can say is waiting), and
  `markOpened(S, id)` opens one for good. Sealed or not, a badge is earned: counted, dated and kept
  the same. Every badge earned before they came sealed counts as opened (`migrateOpened`, one of the
  store's migrations), as does what 1.6's first load finds in history, and `store.sanitize` takes
  an `opened` that isn't true or false as opened.
- **The capsule.** A sealed badge is a glass capsule in its tier's colours, sealed round its middle
  with a band of the tier's metal: its rarity shows, its name and medal don't. Like a medal it's an
  object, the same in light and dark. The toast for a new one says its tier and rarity ("Bronze ·
  Common", Open it), the workout's Next screen card shows its capsule dropping in, the You tab's card
  says how many are waiting ("2 badges to open") and shows them first, and the gallery shows each in
  its place, marked New, with its rarity and "Tap to open". A tap on any of them opens it in the
  reveal, and so does a badge's sheet asked for a sealed one.
- **Opening it.** In the reveal the capsule floats, bobbing gently, until it's tapped three times.
  The first tap wobbles it with a hairline crack (`wobble`); the second shakes it harder, with
  cracks of light and light leaking round it (`crack`); the third bursts it at its seam: the halves
  fly apart, light floods out, and the medal springs out with its burst (14 beads) and the `badge`
  haptic, then its name, tier, what it took, Share and Done rise in. It's opened, and saved, the
  moment it bursts. Several page as before, each sealed, with Open all: the page showing bursts, the
  rest spring in as their pages show. What a sealed page says and what it will say sit in the same
  place, so the sheet keeps its height as it opens. Reduced motion: one tap, and a fade. Increased
  contrast and reduced transparency (and Flat): the glass is a solid fill.
- **Cheap to show.** Everything moves by transform and opacity, so the compositor plays it. The
  capsule bobs only while its page is on screen (an IntersectionObserver), and stops when the sheet
  closes; on a page nothing moves forever (a sealed tile nudges twice as it first shows, and the You
  tab shakes a newly earned one awake once, with Refract's wiggle). Refract's click effect is off on
  the capsule (`data-rf-effect="none"`), whose round shape it filled with a grey disc.

## Publishing (Google Play and APKPure)

The app targets API 36 (what Play requires for new apps and updates from Aug 31, 2026) and handles
edge-to-edge and predictive back. Its only native code is the on-device coach's engine (arm64-v8a,
every library linked for 16 KB pages, as Play requires). The model files the coach downloads are data
the engine reads, not code.

### Signing

Every store build has to be signed with the same private key for as long as the app exists: an
update only installs over a build signed with the same key, and Android developer verification ties
the package name to that key's certificate.

- **The release key** is a PKCS12 keystore (RSA 4096, valid to 2056, alias `gradienthealth`) kept by
  the owner and in GitHub's secrets (below), never in the repository. Keep two copies of it
  and its password somewhere safe: a lost key means publishing a new app under a new name. Its
  certificate's SHA-256 is in `android/release-cert.sha256`, and `build-apk.sh` stops a release build
  signed with any other key, so a wrong secret can't publish an APK that won't update.
- **CI signs with it only on `main`**, in the `release` job, with these secrets. They belong in a
  GitHub environment named `release` that only `main` may use (Settings, Environments, New
  environment, Deployment branches: `main`), so a workflow edited on another branch can't read them:

  | Secret | Value |
  |---|---|
  | `RELEASE_KEYSTORE_B64` | the keystore, base64-encoded (`base64 -w0 gradient-health-release.jks`) |
  | `RELEASE_KEYSTORE_PASS` | its password |
  | `RELEASE_KEY_ALIAS` | `gradienthealth` |
  | `RELEASE_KEY_PASS` | the same password (PKCS12 keys share the keystore's) |

  Without them the `release` job stops: CI never publishes a "latest" that isn't release-signed.
  A private repository needs GitHub Pro, Team or Enterprise for environments. On GitHub Free the
  secrets stay repository secrets: the job's `main`-only condition still keeps branch builds from
  publishing, but a workflow edited on a branch could read them.
- **Locally**, `scripts/build-apk.sh` and `scripts/build-aab.sh` read the same values from
  `RELEASE_KEYSTORE` (a path), `RELEASE_KEYSTORE_PASS`, `RELEASE_KEY_ALIAS` and `RELEASE_KEY_PASS`.
  The passwords reach the signing tools through the environment or a private temporary file, never a
  command line. Each build prints the certificate's SHA-256.
- **The test key** (`android/gradient-health.keystore`, password `gradient-health`) is public. Builds
  signed with it are for trying the app only. A release-signed build won't install over one: copy
  your data first (Settings, Copy my data), uninstall, install the release build, then Restore from a
  copy.

### Builds

Every push to `main` or a `claude/` branch runs `.github/workflows/android.yml`. Its `build` job runs
the tests and the web build, then `build-apk.sh` and `build-aab.sh` signed with the public test key,
and attaches both to the run as an artifact (kept 14 days) without publishing anything. Only on
`main`, the `release` job then builds the page again, with the parts that load on demand
(`dist/lazy/`, which isn't committed; `build-apk.sh` stops without it, and its log counts the files
it packed), checks it against the committed page, and builds both packages with the release key and
one shared versionCode (minutes since 1970, so it only grows). Then it replaces the "latest" GitHub
release. So only merged,
reviewed code is ever release-signed. The `.apk` is for APKPure and direct installs; the `.aab`
(Android App Bundle) is the upload for Google Play, which doesn't take APKs for new apps.
The release's notes start with What's new in the version, from its entry in `src/data/changelog.js`
(`scripts/release-notes.mjs`), with the entry's `store` text folded underneath for a store's What's
new field, then the commit, versionCode and signing key. So a new version needs a changelog entry
with a `store` text of 500 characters at most (Play's limit); `test/release.mjs` checks both.
`build-aab.sh` needs the Android SDK's `aapt2` and a platform `android.jar`, which the CI runner has,
plus `bundletool`, which it downloads from Google's GitHub release and checks against a pinned
SHA-256.

### Google Play

1. **Developer account.** A personal account made after Nov 13, 2023 has to run a closed test with at
   least 12 testers for 14 days before production. Start that early.
2. **Create the app** with package `com.shadowsdistant.gradienthealth`.
3. **Play App Signing.** Choose to use your own key and upload the release key with the PEPK tool the
   Console gives you ("Export and upload a key from a Java keystore"). Play then signs what it serves
   with the same key as the APKPure build, so people can move between the two without reinstalling.
   The same key uploads the bundles.
4. **Health apps declaration** (App content). Pick the features: activity and fitness, nutrition and
   weight management, sleep. Describe the optional Claude transfer: it only happens after the person
   allows it on a screen that lists what's sent (`U.claudeConsent`).
5. **Health Connect permissions declaration.** One justification per data type, with the reasons the
   privacy page gives: reads of steps, sleep, weight, height, body fat, heart rate, resting heart
   rate, HRV, exercise, active and total calories burned, distance and nutrition, and writes of
   exercise, exercise routes, distance, active calories and nutrition. Total calories, routes,
   distance and active calories are for outdoor activities: the summary shows total calories, and a
   saved run, walk, hike or ride goes to Health Connect with its route, plus distance and calories
   when no watch recorded them. **Background reads** (`READ_HEALTH_DATA_IN_BACKGROUND`) have their
   own justification: the app reads the last two days every 15 minutes while it's closed so the
   history and the plan's readiness have no gaps on days it isn't opened; the data stays on the
   phone, and the person can turn it off in Settings. Google reviews this separately; allow a few
   days.
6. **Other permissions.** `CAMERA` (scanning food barcodes and shared plan codes only, asked when
   Scan or Add a shared plan is tapped; the camera feature is declared not required), `INTERNET` (the optional Claude coach, Open Food Facts and the
   on-device model download), `ACCESS_NETWORK_STATE` (so a model download can wait for Wi-Fi),
   `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` (an activity's route, only while one the person
   started records; no `ACCESS_BACKGROUND_LOCATION`, so no location declaration form),
   `ACTIVITY_RECOGNITION` (steps during an activity), `POST_NOTIFICATIONS` (the recording's
   notification, and the reminders the person turns on, asked for then) and `RECEIVE_BOOT_COMPLETED`
   (keeps the background sync's job and the reminders' alarm after a restart). The reminders use
   inexact alarms only, so there's no exact-alarm permission to declare.
7. **Foreground service declaration** (App content, Foreground service permissions).
   `FOREGROUND_SERVICE_LOCATION` for `ActivityService`: the use case is fitness tracking the person
   starts ("Record a run, walk, hike or ride: the route, distance and pace with the screen off"). It
   runs only while an activity records, shows an ongoing notification with Pause and Finish, and
   stops when the person finishes. Play asks for a short video of the flow: start an activity, lock
   the phone, show the notification, finish it.
8. **Privacy policy.** Play needs a public URL. [docs/PRIVACY.md](PRIVACY.md) has the text; host it
   somewhere public (GitHub Pages works) and link it in the listing and the Console.
9. **Data safety form.** Declare what the optional features send, as optional and for app
   functionality, encrypted in transit, with in-app deletion (Reset everything):
   - shared with Anthropic when Claude is on: health info and fitness info (averages and trends),
     personal info (an age range, and sex if given) and app activity (the questions asked);
   - shared with Open Food Facts when online food search is on: the search words and barcodes;
   - a workout plan someone shares goes only where they send it themselves (Android's share sheet, or
     a QR code on their screen), never through a server;
   - nothing else leaves the phone. The on-device model is a download from Hugging Face. Location
     (an activity's route) and the background Health Connect reads are processed only on the phone
     (Health Connect is on the phone too). One exception to weigh: with maps on, the map pieces of an
     activity's area (and, while one records, of where the person is) come from OpenFreeMap, which
     hints at roughly where they were. Declaring "Approximate location, shared, optional, for app
     functionality" is the cautious answer.
10. **AI-generated content.** Every AI answer (on-device or Claude), Claude's weekly report and its
    suggestions have a Report action that hides the item and keeps a local record. Sending a report to
    the developer opens a prefilled GitHub issue in the browser. Play's policy asks that people can
    report without leaving the app, so a reviewer may flag this. The fix is an endpoint you run: point
    `REPORT_URL` in `src/ui/healthtab.js` at it and send the report from the app.
11. **App content forms.** Target audience 13 and over (18 and over avoids the teen-specific
    questions), no ads, the content rating questionnaire, and App access notes: everything works
    without an account; Claude needs the person's own Anthropic API key, and the on-device model is
    an optional download of 0.5 to 2.7 GB.
12. **Store listing.** `docs/store/LISTING.md` has the short and full description, and `docs/store/`
    the feature graphic, icon and phone screenshots (`node scripts/store-assets.mjs` renders them).
13. **Release.** Upload `gradient-health.aab` from the latest CI release to internal testing, then the
    closed test, then production. For the release notes, paste the short What's new from the end of
    the CI release's What's new between `<en-US>` and `</en-US>`.

### APKPure

1. Sign up on APKPure's developer console and add the app with the same package name.
2. Upload `gradient-health.apk` from a release-signed CI build (the release notes say which key
   signed it). APKPure takes APKs up to 2 GB and reviews each upload by hand, usually in 24 to 48
   hours.
3. Every update must keep the package name and the signing key, or APKPure rejects it and phones
   won't install it over the old one.
4. With each update, paste the short What's new from the end of the CI release's What's new (or
   `node scripts/release-notes.mjs --store`) into APKPure's What's new field.

### Android developer verification

From Sep 30, 2026 (Brazil, Indonesia, Singapore and Thailand first, then everywhere), certified
Android phones only install apps from verified developers, including apps from APKPure or a direct
download. In the Android Developer Console (or Play Console, if the account is there), verify your
identity, then register the package name `com.shadowsdistant.gradienthealth` with the release key's
certificate SHA-256 (from `keytool -list -v -keystore gradient-health-release.jks`, or printed by
each build).

### Large screens

From target SDK 36, Android ignores the portrait lock on screens 600 dp and wider, so tablets and
foldables get landscape too. `node test/sweep.mjs` includes a landscape tablet size.
