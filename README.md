# Gradient Health

An adaptive home workout app and health tracker for Android. It plans a routine for every day of the
week around your goals, equipment and schedule, shows each move as an animated diagram, learns from a
quick check-in after every workout, and reads your phone's health data (sleep, steps, weight, heart
rate, other workouts) to fit each day's session to how you slept and recovered.

**Install:** grab `gradient-health.apk` from the `latest` release (Releases → latest), open it on the
phone and allow installs from your browser or file manager. Updates install over the old version and
keep your data.

## What it does

- **Questionnaire (13 short screens).** Health Connect, about you, goals in priority order,
  experience, schedule, equipment, body check (pain, old injuries, stronger side), food, sleep, style,
  an optional 3-minute baseline test, and a summary of the plan. Everything is editable later.
- **Program.** The first two goals get the most work (3× a week), the next two 2×, the rest is kept
  up. A small search spreads muscle groups across your days. Weeks 1-2 ease in, every 5th week is a
  deload (sooner after two "too hard" check-ins with poor recovery). A missed day moves the week
  forward instead of doubling up.
- **Sessions.** Built from the time you have: warm-up, supersets, a left/right catch-up set, core, a
  finisher. "Short on time" makes a real 12-15 minute session.
- **Learning.** After each exercise: how many reps were left in the tank (0, 1-2, 3+). Reps go up,
  then heavier weights, then the next level of the ladder, then a suggestion of what to buy next.
  Falling short twice moves down a level. Ratings, "too complicated?" and pain adjust volume,
  complexity and exercise choice (pain swaps last two weeks).
- **Weaker side.** The weaker arm (or leg) goes first, the other side never does more reps, and it gets
  one extra set until a left vs right test every two weeks shows the gap under 10%.
- **Readiness.** Under 5 h of sleep, a resting heart rate or HRV far from your normal, or "very sore and
  low energy" means one less set per exercise. A long run yesterday means easier legs and no finisher.
- **Streaks.** Light days (a walk and 5 minutes of mobility) count; one freeze a week; weekly streaks.
- **Health tab.** Today's numbers, trends over 7/28/90 days with a table view, recent activity,
  hand logs (weight, sleep, feel, activities, measurements) and on-device insights: trends, unusual
  days, consistency, relationships (only with enough data), goal progress and safety flags.
- **AI coach (optional).** With your own Anthropic API key: a weekly report and questions about your
  data, answered by Claude. It gets a short summary without your name, dates or IDs (Settings shows the
  exact text), it only advises, and the key never leaves the phone or goes into a backup. The model is
  picked at run time from the models your key can use.
- **Design.** The Refract design system (vendored in `vendor/refract/`): liquid-glass navigation over
  plain content, light, dark and high-contrast themes, Reduce Motion respected.

## How it's built

A single self-contained web app (`dist/gradient-health.html`, built from `src/`) inside a thin
Android WebView shell (`android/`) with a Health Connect bridge.

```
src/data/moves.js     exercises, ladders, equipment tags, cues
src/engine/pose.js    2D skeleton (FK + IK), timing from tempo, SVG figures
src/brain.js          program, sessions, adaptation, calendar replay, streaks, readiness
src/health.js         Health Connect client, hand logs, per-day records
src/insights.js       on-device insights
src/ai.js             AI coach (bundled with the Anthropic SDK by esbuild)
src/store.js          local + file persistence, backup and restore
src/platform.js       wake lock, vibration, sounds, theme, back button
src/ui/*.js           screens (questionnaire, Today, Plan, Health, Progress, Moves, Settings, player)
scripts/build.mjs     inlines everything into dist/gradient-health.html
scripts/build-apk.sh  builds and signs the APK without Gradle
```

```sh
npm ci
npm test          # simulations, insights, AI (mocked API), poses, persistence
npm run build     # dist/gradient-health.html
npm run smoke     # end-to-end run in Chromium (needs Playwright)
npm run apk       # build/gradient-health.apk (see below)
```

`node test/contact-sheet.mjs [filter,…] [--dark]` renders every move's keyframes to `build/` for a
visual check.

## Android build

The APK is a thin WebView shell (`android/`) around the single-file web app
(`dist/gradient-health.html`) plus a Health Connect bridge. It is built without Gradle or the
Android SDK: `scripts/build-apk.sh` uses Ubuntu's packaged Android tools and compiles against the
Android 14 (API 34) framework jar from Maven Central (Robolectric's `android-all`, about 137 MB,
downloaded once to `~/.cache/gradient-health` and checked against a pinned SHA-1).

Build it locally on Ubuntu 24.04 or Debian, with JDK 17 or newer:

```sh
sudo apt-get install -y --no-install-recommends aapt dalvik-exchange zipalign apksigner
npm ci && npm run build && npm run apk
```

The signed APK is written to `build/gradient-health.apk`. You can override `APP_HTML`,
`VERSION_NAME`, `VERSION_CODE`, `OUT` and `CACHE_DIR` (see the top of the script). By default
`versionCode` is the current time in minutes, so every build installs over the previous one.

**CI.** `.github/workflows/android.yml` runs the tests, rebuilds `dist/` and fails if the
committed file is stale, then builds the APK. On every push to `main` or `claude/**` it replaces
the release tagged `latest`: go to **Releases → latest → gradient-health.apk**, or use
`https://github.com/<owner>/<repo>/releases/latest/download/gradient-health.apk`. Each run's APK is
also attached as the `gradient-health-apk` workflow artifact. To install, open the APK on the
phone and allow your browser or file manager to install unknown apps. Installing a newer build
over the old one keeps your data.

**Signing key.** `android/gradient-health.keystore` (alias `gradient`, password
`gradient-health`) is committed on purpose. That way every local and CI build carries the same
signature, and Android only installs an update over an app signed with the same key. Its password
is public, so treat it as a personal sideloading key only: don't reuse it for other apps or for
store distribution.

**Health Connect.** Reading steps, sleep, weight, height, body fat, resting heart rate, HRV and
workouts uses the platform Health Connect API, which needs **Android 14 or newer**. On older
phones the app works normally and reports Health Connect as unsupported. The app itself runs on
Android 8.0 (API 26) and newer.

**Privacy.** Health data stays on the phone. Android's device backup can include the app's data;
`android/res/xml/*backup*` rules leave the AI coach key out of it.

Not medical advice. Check with a doctor before starting if you have a condition or an injury.
