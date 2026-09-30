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
src/planweek.js          one week of the plan for the Plan tab (GH.planWeek), cached
src/body.js              weighted sets per muscle, how training splits, what improved (GH.body)
src/health.js            Health Connect client (read and write), hand logs, per-day records
src/food.js              food tracking: targets, logging, meals, the learned burn, Health Connect writes
src/foodnet.js           Open Food Facts search and barcodes (through the Android shell)
src/scanner.js           the barcode camera sheet; src/barcode.js is its lazy ZXing reader
src/insights.js          on-device insights
src/coach.js             the built-in coach: report, answers, today's decisions, suggestions
src/tailor.js            Tailor my plan: a request into a proposal, applied and undone (GH.tailor)
src/devicecoach.js       the on-device model's prompt: rules, a compact data brief, safety routing
src/ai.js                the Claude API coach (bundled with the Anthropic SDK by esbuild)
src/llm.js               on-device AI runtime (native engine or llama.cpp in WebAssembly), a lazy
                         chunk: GH.lazy('llm')
src/store.js             local + file persistence, backup and restore, migrations
src/platform.js          haptics, vibration, sounds, theme and system bars, insets, back button, lazy chunks
src/ui/core.js           layout, tabs, router, in-place rendering (U.morph), transitions, sync, events
src/ui/sheet.js          the bottom sheets: detents, dragging, springs (U.sheet in core.js wraps it)
src/ui/chat.js           the coach chat and the coach button on every tab
src/ui/tailor.js         the Tailor my plan sheet
src/ui/metric.js         a health number's sheet: its history, chart, and adding or changing it
src/ui/bodymap.js        Progress's body map (front and back, 17 muscles) and the muscle sheet
src/ui/guide.js          tour, first-week checklist, tab tips, What's new
src/ui/*.js              screens: onboarding, player, today, plan, health, food, progress, moves,
                         coach page, profile, science (How it works), settings
src/styles.css, src/styles/*.css   the app's styles (the per-area files are appended in order)
android/src/…/HealthSync*.java     background Health Connect sync (a JobScheduler job every 15 minutes)
android/src/…/Activity*.java       outdoor activity recording (a location foreground service, the track)
android/jni/             the on-device coach's native engine (C++ over llama.cpp) and its host test
scripts/build-native.sh  builds android/jni for arm64 (or --host, and tests it)
scripts/build.mjs        inlines everything into dist/gradient-health.html; lazy chunks go to dist/lazy/
scripts/build-apk.sh     builds and signs the APK without Gradle
scripts/make-icons.mjs   the launcher icons from art/logo.webp
scripts/screenshots.mjs  renders docs/screenshots/ from the built page
scripts/make-tiny-gguf.py  a tiny random-weight model for test/llm.mjs
```

```sh
npm ci
npm test          # simulations, insights, AI (mocked API), coach, poses, persistence, food, health, gym
npm run build     # dist/gradient-health.html and dist/lazy/
npm run smoke     # end-to-end run in Chromium (needs Playwright); add --dark for dark mode
npm run test:ui   # layout regressions, food flows, the coach chat, the 3D figure (Chromium)
npm run test:llm  # on-device AI runtime in Chromium with a tiny model (see On-device AI)
node test/sweep.mjs [--quick]   # every screen at 360-600 px, light/dark, 100%/130% text, overflow checks
npm run apk       # build/gradient-health.apk (see below)
node scripts/screenshots.mjs          # docs/screenshots/, light and dark
node test/contact-sheet.mjs [filter,…] [--dark]   # every move's keyframes, to build/
```

## Rendering

Screens return HTML strings. `U.render()` doesn't replace the page: `U.morph()` patches it in
place, keeping nodes that line up (by `data-key`, `id`, or position and tag). That keeps Refract's
enhanced controls, running transitions, focus and scroll positions intact, so a tap never makes the
screen flicker. Parts Refract injects (lens layers, the segmented thumb) and attributes it sets are
left alone. A few conventions:

- Give top-level cards a `data-key` so adding or removing one doesn't shift the rest.
- `data-morph="keep"` on a container whose children are drawn by code (the exercise figures).
- `U.roll(value)` for numbers that should roll when they change.
- The navigation bar is shared: a screen's `<header class="rf-navbar">` is lifted into it.
- A route change gets fresh content and an entrance (tabs slide toward the tab you picked, pushed
  views come in from the side); a re-render of the same route only patches.

## 3D exercise figure

`src/engine/figure3d.js` builds the lazy chunk `dist/lazy/figure3d.js` (three.js, about 620 KB
minified), which `GH.lazy('figure3d')` loads when it's needed. It sets `GH.figure3d`:

- `supported()`: whether WebGL works here (checked once).
- `mount(el, move, opts)`: a controller shaped like `GH.pose.mount`'s, plus `setView(name)`,
  `phase()` and an `onPhase` callback.
- `still(move, opts)`: a thumbnail as a data URL, or `null` without WebGL. `cachedStill()` returns
  one only if it's already drawn, so a page render never waits on the GPU.
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

In the app, `figure()` in `src/ui/player.js` hands the player, move sheets and the tour one
controller that swaps what's underneath it: the flat figure while the chunk is still loading, 3D once
it's there, and flat again if `onFallback` fires. Set-up fetches the chunk; the GPU warm-up runs
a few seconds after launch. Settings keeps the choice in `profile.prefs.figure` (`'3d'` or `'flat'`), with
`figSkin` and `figShirt` for the look. The tempo strip under a figure comes from the move's `rep`
steps and lights up from `onPhase`.

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

**CI.** `.github/workflows/android.yml` runs the tests, rebuilds `dist/` and fails if the committed
file is stale, builds (or restores from its cache) and tests the native engine, then builds the APK
and the Android App Bundle. On every push to `main` or
`claude/**` it replaces the release tagged `latest`. Each run's APK and bundle are also attached as
the `gradient-health-apk` workflow artifact.

**Signing keys.** Builds are signed with the release key when it's given (from the repository's
secrets in CI; see Publishing), else with `android/gradient-health.keystore` (alias `gradient`,
password `gradient-health`), a test key committed so a local build works out of the box. Its
password is public: builds signed with it are for trying the app only, never for a store.

**Edge to edge.** The app draws behind the status and navigation bars. `MainActivity` sends the bar
and keyboard insets to the page (`__gh.setInsets`), which pads itself with `--sat`, `--sab`, `--sal`
and `--sar`. The page reports its theme back (`AndroidBridge.setSystemBars`) so the bar icons stay
readable when the app's theme differs from the phone's.

**Haptics.** `AndroidBridge.haptic(kind)` plays `tap`, `select`, `tick`, `toggleOn`, `toggleOff`,
`detent`, `countdown`, `warning`, `success`, `error`, `heavy`, `go`, `done` or `celebrate`, each its
own composition of the phone's haptic primitives (see `Haptics.java`: each primitive's support is
checked, with a stand-in for a missing one, and amplitude waveforms on phones without primitives),
scaled by the strength setting (0.55, 0.8, 1). Event kinds play as media vibrations, so a low system
touch intensity can't mute them; UI kinds follow the system touch-feedback setting. With the app out
of sight, workout timer alerts fall back to alarm-class vibrations (`vibrate`, `vibratePattern`), the
only kind Android lets through then.

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
`__gh.onActPermissions`), then `actStart({id, type, title, units?})`. The service takes a GPS fix
about once a second from the GPS provider (else the fused provider on Android 12+, else the network),
counts steps from the phone's step counter, and shows an ongoing, quiet notification,
"Run · 12:34 · 2.14 km" with the average pace, Pause or Resume and Finish; tapping it opens the app
(the page gets the route `activity`). Finish there ends the activity and leaves a note that opens the
summary. While the page is in front it gets `__gh.onActivity(state)` about once a second.

`ActivityTrack` keeps the recording in `noBackupFilesDir/activity/`: `<key>.json` with its details
(replaced atomically on every change and every 20 seconds) and `<key>.track`, one point a line,
`[t, lat, lon, alt|null, acc, speed|null, paused]`, appended as fixes come in. A fix is stored when
it's 3 m from the last one, 10 s after it, the first good one after bad ones or the first after a
pause. The distance leaves out points worse than 50 m, pauses (a pause ends the line), GPS jumps
(faster than 12 m/s from the last good point on a walk or hike, 25 m/s otherwise; three in a row
restart the line there) and standing still (the anchor only moves once the position has moved more
than the accuracy, and not while the GPS speed is under 0.4 m/s). Loading a recording runs the same
filter over its points, so a page reload, a crash or a restart gives the same numbers; if Android
stops the service mid-activity, it starts again the next time the app comes to the front. A finished
recording stays (actState reports it with `active: false`) until the page saves it and calls
`actClear(id)`; at most 20 finished ones are kept.

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

**Privacy.** Health data stays on the phone. Android's device backup can include the app's data;
`android/res/xml/*backup*` rules leave the API key out of it. Background reads and activity tracks
are in `noBackupFilesDir`, so backups never include them.

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
  1.2's Qwen2.5 models stay in the table as `legacy`, with their SHA-256 pinned: not offered, but one
  already on a phone keeps working.
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
  check. A file counts as installed once its size (the Hub's exact size, within 3% of the table's),
  GGUF magic and SHA-256 (pinned, or the Hub's `X-Linked-Etag`) check out. Progress goes to
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
  the owner and in the repository's GitHub secrets, never in the repository. Keep two copies of it
  and its password somewhere safe: a lost key means publishing a new app under a new name.
- **CI signs with it** when these repository secrets exist (Settings, Secrets and variables, Actions):

  | Secret | Value |
  |---|---|
  | `RELEASE_KEYSTORE_B64` | the keystore, base64-encoded (`base64 -w0 gradient-health-release.jks`) |
  | `RELEASE_KEYSTORE_PASS` | its password |
  | `RELEASE_KEY_ALIAS` | `gradienthealth` |
  | `RELEASE_KEY_PASS` | the same password (PKCS12 keys share the keystore's) |

  Without them CI still builds, signed with the public test key, and says so in the release notes.
- **Locally**, `scripts/build-apk.sh` and `scripts/build-aab.sh` read the same values from
  `RELEASE_KEYSTORE` (a path), `RELEASE_KEYSTORE_PASS`, `RELEASE_KEY_ALIAS` and `RELEASE_KEY_PASS`.
  The passwords reach the signing tools through the environment or a private temporary file, never a
  command line. Each build prints the certificate's SHA-256.
- **The test key** (`android/gradient-health.keystore`, password `gradient-health`) is public. Builds
  signed with it are for trying the app only. A release-signed build won't install over one: copy
  your data first (Settings, Copy my data), uninstall, install the release build, then Restore from a
  copy.

### Builds

Every push to `main` or a `claude/` branch runs `.github/workflows/android.yml`: tests, the web build,
`build-apk.sh` and `build-aab.sh` with one shared versionCode (minutes since 1970, so it only grows),
then the "latest" GitHub release with both files. The `.apk` is for APKPure and direct installs; the
`.aab` (Android App Bundle) is the upload for Google Play, which doesn't take APKs for new apps.
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
6. **Other permissions.** `CAMERA` (barcode scanning only, asked when Scan is tapped; the camera
   feature is declared not required), `INTERNET` (the optional Claude coach, Open Food Facts and the
   on-device model download), `ACCESS_NETWORK_STATE` (so a model download can wait for Wi-Fi),
   `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` (an activity's route, only while one the person
   started records; no `ACCESS_BACKGROUND_LOCATION`, so no location declaration form),
   `ACTIVITY_RECOGNITION` (steps during an activity), `POST_NOTIFICATIONS` (the recording's
   notification) and `RECEIVE_BOOT_COMPLETED` (keeps the background sync's job after a restart).
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
   - nothing else leaves the phone. The on-device model is a download from Hugging Face. Location
     (an activity's route) and the background Health Connect reads are processed only on the phone
     (Health Connect is on the phone too), so the form doesn't list them as collected.
10. **AI-generated content.** Every AI answer (on-device or Claude), Claude's weekly report and its
    suggestions have a Report action that hides the item and keeps a local record. Sending a report to
    the developer opens a prefilled GitHub issue in the browser. Play's policy asks that people can
    report without leaving the app, so a reviewer may flag this. The fix is an endpoint you run: point
    `REPORT_URL` in `src/ui/healthtab.js` at it and send the report from the app.
11. **App content forms.** Target audience 13 and over (18 and over avoids the teen-specific
    questions), no ads, the content rating questionnaire, and App access notes: everything works
    without an account; Claude needs the person's own Anthropic API key, and the on-device model is
    an optional download of 0.5 to 2.7 GB.
12. **Store listing.** The README and `docs/screenshots/` are a starting point for the description
    and phone screenshots.
13. **Release.** Upload `gradient-health.aab` from the latest CI release to internal testing, then the
    closed test, then production.

### APKPure

1. Sign up on APKPure's developer console and add the app with the same package name.
2. Upload `gradient-health.apk` from a release-signed CI build (the release notes say which key
   signed it). APKPure takes APKs up to 2 GB and reviews each upload by hand, usually in 24 to 48
   hours.
3. Every update must keep the package name and the signing key, or APKPure rejects it and phones
   won't install it over the old one.

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
