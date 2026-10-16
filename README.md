<p align="center"><img src="docs/icon-512.png" width="96" alt="The Gradient Health icon: a white heart with a pulse line on a blue, green and amber gradient"></p>

<h1 align="center">Gradient Health</h1>

<p align="center"><b>Workouts that adjust to you, at home or at the gym.</b><br>
Training, food and health in one private Android app, with a coach that runs on your phone.</p>

<p align="center">
  <a href="../../releases/latest"><b>Download the latest APK</b></a> ·
  Android 8.0+ ·
  No account, no ads, no analytics
</p>

<p align="center"><a href="#credits"><img src="docs/refract-badge.svg" height="32" alt="Built with Refract"></a></p>

<p align="center">
  <img src="docs/screenshots/framed/today.png" width="200" alt="Today: a 35-day streak and today's workout">
  <img src="docs/screenshots/framed/workout.png" width="200" alt="The workout player: the 3D figure doing a dumbbell curl, with the tempo strip lit">
  <img src="docs/screenshots/framed/around.png" width="200" alt="Built around you: a plan for a 68-year-old with balance problems and a sore knee">
  <img src="docs/screenshots/framed/answer-dark.png" width="200" alt="The coach chat, in dark mode: a short answer with a card of how your curl has gone">
</p>

## Why it's different

**Built on research, and it shows its work.** Sets, reps, rest and how often each muscle trains come from the studies, not a template. Every rule is in the app with its sources and how strong the evidence is, and Why this plan explains your week.

**It learns from one question.** After each exercise it asks how many more reps you could have done. That answer moves you on (more reps, more weight, then a harder version), and a short night or sore muscles take a set off each exercise that day.

**It fits your body, not just your goals.** Your age, sore joints and weaker side change the plan. So do health conditions like osteoporosis, type 2 diabetes, high blood pressure, arthritis and back pain. From 60, leg days get fast reps and every muscle trains twice a week, and wheelchair users get a seated plan.

**A 3D figure shows every move.** 296 exercises for home or the gym, each at the right tempo with the working muscles lit. No equipment? A chair, a wall and a towel go a long way.

**A coach on your phone.** Ask about your numbers, or change your plan by saying what you want: "more legs, my knees hurt, 20 minutes". The AI runs offline, and every answer is checked against your own data. Or use Claude with your own API key and spending limits.

**Private by design.** No account, no ads, no analytics. Your health data stays on your phone, and your health conditions are never sent to Claude.

**Made to feel good.** Liquid glass, smooth motion and 59 distinct haptics, in light and dark.

<p align="center">
  <img src="docs/screenshots/framed/rest-dark.png" width="200" alt="Rest timer, in dark mode, asking how many more you could have done">
  <img src="docs/screenshots/framed/science.png" width="200" alt="How it works: how many reps to leave in the tank, with its research">
  <img src="docs/screenshots/framed/food.png" width="200" alt="Food in Health, under the week: calories left today, macros and the four meals">
  <img src="docs/screenshots/framed/badges.png" width="200" alt="Badges: the ones earned so far, with their tiers, what's next and five waiting to be opened">
</p>

## What's inside

| | |
|---|---|
| **Today** | Today's workout, and what the coach changed and why |
| **Plan** | Your week, why it's built that way, and an AI check you approve |
| **Your plans** | Build your own from pictures of every move or a ready-made split, or ask the coach, and share it with a QR code |
| **Activities** | Runs, walks, hikes and rides with GPS, auto-pause and spoken splits |
| **Food** | Calories and macros by meal, with a barcode scanner |
| **Health** | Sleep, steps, heart rate and weight from Health Connect |
| **Progress** | A body map of what you've trained and what's improved |
| **Badges** | 64 3D medals to earn, open and share |

## Privacy

Everything stays on your phone except what you choose to send: a summary for Claude (you see it first), a food you look up online, the on-device AI's one-time download, a plan you share, map tiles around an activity, and a daily update check with GitHub if you allow it. The [privacy policy](docs/PRIVACY.md) lists every piece of data and where it goes.

## Get it

1. Download `gradient-health.apk` from the [latest release](../../releases/latest).
2. Open it on your phone. You may need to allow installs from your browser or file manager.
3. From then on the app updates itself and keeps your data.

It needs Android 8.0 or newer. Health Connect needs Android 14 or newer; on older phones, log sleep and weight by hand.

> Gradient Health gives general guidance, not medical advice. If you have a health condition or an injury, check with your doctor before you start.

## Credits

Every screen is built with **Refract**, the liquid glass design system, which the app credits in Settings, under About. It also uses:

| Project | Used for | License |
|---|---|---|
| Host Grotesk, Geist Mono | Fonts | SIL Open Font License 1.1 |
| three.js | 3D figure | MIT |
| Anthropic TypeScript SDK | The Claude coach | MIT |
| wllama and llama.cpp | On-device AI runtime | MIT |
| Qwen3.5 | On-device AI models, downloaded on request | Apache 2.0 |
| zxing-wasm | Barcode reading | MIT |
| ZXing C++ | Barcode reading | Apache 2.0 |
| USDA SR28 | Built-in food list | Public domain |
| Open Food Facts | Online food search, when it's on | Open Database License |
| MapLibre GL JS | Activity maps | BSD 3-Clause |
| OpenStreetMap contributors and OpenMapTiles, served by OpenFreeMap | Map data, when maps are on | Open Database License and CC BY 4.0 |

The same list is in the app, under Settings, About, Open-source licenses.
