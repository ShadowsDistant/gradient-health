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
src/health.js            Health Connect client (read and write), hand logs, per-day records
src/food.js              food tracking: targets, logging, meals, the learned burn, Health Connect writes
src/foodnet.js           Open Food Facts search and barcodes (through the Android shell)
src/scanner.js           the barcode camera sheet; src/barcode.js is its lazy ZXing reader
src/insights.js          on-device insights
src/coach.js             the built-in coach: report, answers, today's decisions, suggestions
src/devicecoach.js       the on-device model's prompt: rules, a compact data brief, safety routing
src/ai.js                the Claude API coach (bundled with the Anthropic SDK by esbuild)
src/llm.js               on-device AI runtime (llama.cpp in WebAssembly), a lazy chunk: GH.lazy('llm')
src/store.js             local + file persistence, backup and restore, migrations
src/platform.js          haptics, vibration, sounds, theme and system bars, insets, back button, lazy chunks
src/ui/core.js           layout, tabs, router, in-place rendering (U.morph), transitions, sync, events
src/ui/guide.js          tour, first-week checklist, tab tips, What's new
src/ui/*.js              screens: onboarding, player, today, plan, health, food, progress, moves,
                         coach page, profile, science (How it works), settings
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
`VERSION_NAME`, `VERSION_CODE`, `OUT` and `CACHE_DIR` (see the top of the script). `versionName`
comes from `package.json`; by default `versionCode` is the current time in minutes, so every build
installs over the previous one.

**CI.** `.github/workflows/android.yml` runs the tests, rebuilds `dist/` and fails if the committed
file is stale, then builds the APK. On every push to `main` or `claude/**` it replaces the release
tagged `latest`. Each run's APK is also attached as the `gradient-health-apk` workflow artifact.

**Signing key.** `android/gradient-health.keystore` (alias `gradient`, password `gradient-health`)
is committed on purpose, so every local and CI build carries the same signature and installs as an
update. Its password is public: treat it as a sideloading key only, never as a Play upload key.

**Edge to edge.** The app draws behind the status and navigation bars. `MainActivity` sends the bar
and keyboard insets to the page (`__gh.setInsets`), which pads itself with `--sat`, `--sab`, `--sal`
and `--sar`. The page reports its theme back (`AndroidBridge.setSystemBars`) so the bar icons stay
readable when the app's theme differs from the phone's.

**Haptics.** `AndroidBridge.haptic(kind)` plays `tap`, `select`, `tick`, `toggleOn`, `toggleOff`,
`success`, `error`, `heavy`, `go`, `done` or `celebrate` (see `Haptics.java`), using the phone's own
tuned effects where it has them and following the system touch-feedback setting. Workout timer
alerts (`vibrate`, `vibratePattern`) are alarm-class vibrations, so they still buzz when touch
feedback is off.

**Health Connect.** The platform API needs Android 14 or newer. Gradient Health reads steps, sleep, weight,
height, body fat, resting heart rate, HRV and exercise, and since 1.2 heart rate (30-minute averages,
for an estimated resting heart rate), active calories, distance and, with calorie tracking on,
nutrition. It can write exercise sessions for the workouts finished in the app (keyed by day, so a
re-save updates instead of duplicating) and nutrition records for logged meals. It syncs
when the app opens or comes back (at most once a minute), every 15 minutes while open, after a
workout and on pull-to-refresh. The first read covers 90 days; later reads cover the gap since the
last one plus two days.

**Claude app hand-off.** "Ask in the Claude app" sends an `ACTION_SEND` text intent to the Claude app
(`com.anthropic.claude`) when it's installed, and the share sheet otherwise. The text is the
question plus the same privacy-safe summary the API coach uses (`GH.ai.summary`).

**Privacy.** Health data stays on the phone. Android's device backup can include the app's data;
`android/res/xml/*backup*` rules leave the API key out of it.

## On-device AI

`src/llm.js` runs a small open model on the phone: llama.cpp compiled to WebAssembly
([@wllama/wllama](https://github.com/ngxson/wllama), whose one wasm is copied to `dist/lazy/wllama/`),
on WebGPU only when a quick f16 self-test passes. wllama picks its own thread count; Android WebView is
never cross-origin isolated, so it has no `SharedArrayBuffer` and runs on one thread (a load that
fails with threads is retried on one). It's a lazy chunk: `await GH.lazy('llm')` sets `GH.llm`.

- **Models.** Qwen3.5 in three sizes, Q4_K_M from unsloth's Hugging Face repos: Fast (0.8B, 533 MB),
  Balanced (2B, 1.28 GB, recommended with 6 GB of RAM or more) and Best answers (4B, 2.74 GB, offered
  with 8 GB or more). Qwen3.5 mixes gated delta-net layers with full attention. Each entry in the table
  at the top of `src/llm.js` says how to run it: `ctx`, `batch` (64: llama.cpp keeps a cache checkpoint
  one batch before the end of each prompt, so on a hybrid model a follow-up question reuses nearly all
  of the prompt instead of reprocessing it), `think` (the template is told `enable_thinking: false`, and
  `visible()` hides any `<think>` block that slips out) and `gen` (sampling). 1.2's Qwen2.5 models stay
  in the table as `legacy`, with their SHA-256 pinned: they aren't offered, but one already on a phone
  keeps working.
- **Grounding.** `src/devicecoach.js` doesn't make a small model reason from raw numbers. Each question
  goes in with FACTS: what the built-in coach (`src/coach.js`) works out for its topic, the How it works
  rule behind it (`src/data/science.js`) and, for today, what the plan changed and why. The rules and a
  brief of the person's data (no name, no dates) come first and are the same every turn, so they stay
  cached. Emergencies get the built-in safety answer instead of the model's.

- **Downloads** run in Java (`ModelStore.java`, started by `AndroidBridge.modelDownload`): one at a
  time, only from Hugging Face, resumable from a `.part` file, optionally Wi-Fi only, after a free-space
  check. A file counts as installed once its size (the Hub's exact size, within 3% of the table's),
  GGUF magic and SHA-256 (pinned, or the Hub's `X-Linked-Etag`) check out. Progress goes to
  `__gh.onModelProgress` at most 4 times a second; after a page reload `AndroidBridge.modelStatus()`
  reports it again. Models live in `noBackupFilesDir/models/`, so they stay out of device backups.
- **Loading.** `MainActivity` serves installed models at `https://appassets.androidplatform.net/models/`
  with HTTP Range support, and wllama reads them through a Range-backed stand-in for a `Blob`, so a model
  is never copied into browser storage. WebView applies a request's Range a second time to what
  `shouldInterceptRequest` returns (it skips the range's start on the stream), so a ranged body starts
  with that many skippable bytes (`ModelStore.Slice`).
- **Tests.** The real models can't be downloaded in tests, so `scripts/make-tiny-gguf.py` writes tiny
  random-weight models (it needs the `gguf` package): `--arch llama` (the default, `build/tiny.gguf`),
  `qwen3`, or `qwen35` (`build/tiny-qwen35.gguf`, Qwen3.5's hybrid layout). A model family goes into the
  table only after its tiny model loads here, since the real files can't be tried. `test/llm.mjs`
  serves them to the built page and checks the catalog, loading, streaming, the KV cache (and the
  hybrid model's reuse), abort, unloading and the download API (against a fake bridge), and prints the
  tiny model's speed. `test/ui-chat.mjs` runs the chat with the tiny Qwen3.5 model:

  ```sh
  python3 -m venv build/venv && build/venv/bin/pip install gguf numpy
  npm run build && npm run test:llm      # makes the tiny models on the first run
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

## Publishing on Google Play

The app targets API 36 and handles edge-to-edge and predictive back. Before a Play release:

1. **App bundle.** Play wants an `.aab`. Build one with `aapt2 link --proto-format` and
   [bundletool](https://github.com/google/bundletool) `build-bundle`, then sign it with `jarsigner`
   (apksigner can't sign bundles) using a private upload key, not the committed keystore, and enroll
   in Play App Signing.
2. **Health Connect declaration.** In Play Console, fill in the health permissions declaration for
   each permission, with the reasons the privacy page gives: reads of steps, sleep, weight, height,
   body fat, heart rate, resting heart rate, HRV, exercise, active calories burned, distance and
   nutrition, and writes of exercise and nutrition. Pick the matching health features (activity and
   fitness, nutrition and weight management, sleep) and describe the optional Claude transfer: it
   only happens after the person allows it on a screen that lists what's sent (`U.claudeConsent`).
3. **Other permissions.** `CAMERA` (barcode scanning only, requested when Scan is tapped; the camera
   feature is declared not required), `INTERNET` (the optional Claude coach, Open Food Facts and the
   on-device model download) and `ACCESS_NETWORK_STATE` (so a model download can wait for Wi-Fi).
4. **Privacy policy.** Play needs a public URL. [docs/PRIVACY.md](PRIVACY.md) has the text; host it
   somewhere public (GitHub Pages works) and link it in the listing.
5. **Data safety form.** Declare what the optional features send, as optional and for app
   functionality, encrypted in transit, with in-app deletion (Reset everything):
   - shared with Anthropic when Claude is on: health info and fitness info (averages and trends),
     personal info (an age range, and sex if given) and app activity (the questions asked);
   - shared with Open Food Facts when online food search is on: the search words and barcodes;
   - nothing else leaves the phone. The on-device model is a download from Hugging Face.
6. **AI-generated content.** Every AI answer (on-device or Claude), Claude's weekly report and its
   suggestions have a Report action that hides the item and keeps a local record. Sending a report to
   the developer opens a prefilled GitHub issue. If Play asks for reports to reach you without leaving
   the app, point `REPORT_URL` in `src/ui/healthtab.js` at an endpoint you run instead.
7. **App content forms.** Target audience 13 and over, no ads, a content rating questionnaire, and App
   access notes: everything works without an account; Claude needs the person's own Anthropic API key
   and the on-device model is an optional download of 0.5 to 2.7 GB.
8. **Store listing.** The README and `docs/screenshots/` are a starting point for the description
   and phone screenshots.
9. **Large screens.** From target SDK 36, Android ignores the portrait lock on screens 600 dp and wider,
   so tablets and foldables get landscape too. `node test/sweep.mjs` includes a landscape tablet size.
