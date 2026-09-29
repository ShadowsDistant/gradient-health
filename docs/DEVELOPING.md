# Developing Gradient

Gradient is a single self-contained web app (`dist/gradient-health.html`, built from `src/`) inside a
thin Android WebView shell (`android/`) with a Health Connect bridge. There's no Gradle and no
Android SDK: the APK is built with Ubuntu's packaged Android tools.

## Layout

```
src/data/moves.js        exercises, ladders, equipment tags, cues
src/data/science.js      the rules behind the plan, with their research (the "How it works" page)
src/data/changelog.js    What's new, newest first
src/engine/pose.js       2D skeleton (FK + IK), timing from tempo, SVG figures
src/brain.js             program, sessions, adaptation, calendar replay, streaks, readiness, rest
src/health.js            Health Connect client (read and write), hand logs, per-day records
src/insights.js          on-device insights
src/coach.js             the built-in coach (weekly report, answers) and the Claude app hand-off
src/ai.js                the Claude API coach (bundled with the Anthropic SDK by esbuild)
src/store.js             local + file persistence, backup and restore, migrations
src/platform.js          haptics, vibration, sounds, theme and system bars, insets, back button
src/ui/core.js           layout, router, in-place rendering (U.morph), transitions, sync, events
src/ui/guide.js          tour, first-week checklist, tab tips, What's new
src/ui/*.js              screens: onboarding, player, today, plan, health, progress, moves,
                         profile, science (How it works), settings
scripts/build.mjs        inlines everything into dist/gradient-health.html
scripts/build-apk.sh     builds and signs the APK without Gradle
scripts/screenshots.mjs  renders docs/screenshots/ from the built page
```

```sh
npm ci
npm test          # simulations, insights, AI (mocked API), coach and sync, poses, persistence
npm run build     # dist/gradient-health.html
npm run smoke     # end-to-end run in Chromium (needs Playwright); add --dark for dark mode
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
tuned effects where it has them and following the system touch-feedback setting.

**Health Connect.** The platform API needs Android 14 or newer. Gradient reads steps, sleep, weight,
height, body fat, resting heart rate, HRV and exercise, and can write exercise sessions for the
workouts finished in the app (keyed by day, so a re-save updates instead of duplicating). It syncs
when the app opens or comes back (at most once a minute), every 15 minutes while open, after a
workout and on pull-to-refresh. The first read covers 90 days; later reads cover the gap since the
last one plus two days.

**Claude app hand-off.** "Ask in the Claude app" sends an `ACTION_SEND` text intent to the Claude app
(`com.anthropic.claude`) when it's installed, and the share sheet otherwise. The text is the
question plus the same privacy-safe summary the API coach uses (`GH.ai.summary`).

**Privacy.** Health data stays on the phone. Android's device backup can include the app's data;
`android/res/xml/*backup*` rules leave the API key out of it.

## Publishing on Google Play

The app targets API 36 and handles edge-to-edge and predictive back. Before a Play release:

1. **App bundle.** Play wants an `.aab`. Build one with `aapt2 link --proto-format` and
   [bundletool](https://github.com/google/bundletool) `build-bundle`, then sign it with a private
   upload key (not the committed keystore) and enroll in Play App Signing.
2. **Health Connect declaration.** In Play Console, fill in the health permissions declaration for
   each read permission and `WRITE_EXERCISE`, with the reasons the privacy page gives.
3. **Privacy policy.** Play needs a public URL. [docs/PRIVACY.md](PRIVACY.md) has the text; host it
   somewhere public (GitHub Pages works) and link it in the listing.
4. **Data safety form.** Health and fitness data is collected on the device only, never shared, and
   the optional Claude features send a summary only when the person asks.
5. **Store listing.** The README and `docs/screenshots/` are a starting point for the description
   and phone screenshots.
