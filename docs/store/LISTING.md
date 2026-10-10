# Store listing

Text for APKPure (and Google Play), plus the images next to this file. `node scripts/store-assets.mjs`
renders the images again from `docs/screenshots/`.

## Short description (80 characters at most)

```text
Workouts that adjust to you every day, plus GPS runs and a private AI coach.
```

## Full description (4,000 characters at most)

```text
Gradient Health plans a workout for each day of your week around your goals, your equipment and the time you have. A 3D figure shows you every move. After each exercise it asks one question, and your answer, with how you slept and recovered, decides what you do next time. Track your runs, your food and your health too, or only the parts you want.

WORKOUTS THAT ADJUST TO YOU
• A plan built from your goals, your days and your time: 10 minutes to an hour, 2 to 6 days a week
• The planner weighs every way to split your week and picks the best fit, and "Why this plan" shows you how
• Workouts fill the time you set, never more, and every muscle gets its weekly minimum
• Easier days after short sleep, a high resting heart rate or a hard workout the day before
• One question after each exercise moves you up: more reps, then more weight, then a harder move
• At home with just a chair, a wall and a towel, or at the gym with barbells, cables and machines
• Short on time? One tap turns today's workout into a 12 to 15 minute version

A PLAN BUILT AROUND YOUR BODY
• It adapts to your age: livelier under 30, gentler warm-ups and balance work from 50, supported moves from 65
• It works around rheumatoid arthritis (with a flare-day switch), osteoarthritis, osteoporosis, back pain, high blood pressure, balance problems, painful wrists, heart conditions or a wheelchair
• 282 exercises, 71 of them seated, supported and balance moves

A 3D COACH FOR EVERY MOVE
• Every move shown in 3D at the right tempo, with the working muscles lit
• Drag the figure to see it from any side

RUNS, WALKS, HIKES AND RIDES
• Record with GPS, even with the screen off, with Pause and Finish in the notification
• A live map that follows you, and maps you've seen open even offline
• Auto-pause, spoken splits and your pace right now
• A summary with your route on the map, pace, splits, elevation and steps
• Heart rate and calories from your watch through Health Connect
• Personal records: fastest mile, longest run and more

BADGES TO SHARE
• 64 badges, from your first workout to a 100-day streak, and a few secret ones
• Share one as a picture with friends and family, with your name only if you choose

YOUR OWN PLANS
• Build a plan like a playlist, or describe what you want and let the coach build it
• Share it with a QR code or a link: friends scan it and train

HEALTH AND FOOD
• Sleep, steps, heart rate, HRV, weight and more from Health Connect, synced in the background every 15 minutes if you allow it
• Tap any number for its history and what it means
• Count calories and macros, just protein, or nothing at all

A PRIVATE AI COACH
• Ask about your numbers. The AI model runs on your phone after a one-time download, so it works offline
• Or use Claude with your own Anthropic API key
• Tailor your plan by saying what you want: "more legs, my knees hurt, 20 minutes"
• Check your plan with AI: up to three suggestions, each checked against your equipment, joints and time, and you pick which to apply

MADE TO FEEL GOOD
• Glass controls that answer every tap, and smooth motion between screens
• Haptics with 57 distinct feels, from a tick for each tab to saving, a finished set and a new best
• A quick set-up: six short steps, then your plan and your first workout

PRIVATE BY DESIGN
No account, no ads and no analytics. Your data stays on your phone, and health conditions you add are never sent anywhere.

Gradient Health gives general fitness guidance, not medical advice. If a move hurts, stop. If you have a health condition, check with your doctor before you start.

Needs Android 8.0 or newer. Health Connect features need Android 14 or newer.
```

## What's new (500 characters at most)

Paste this into the What's new field with each update. This is 1.8.8's. Each GitHub release carries
its own version's text at the end of its What's new, under "Short version, for a store's What's new
field". It comes from the `store` text of the version's entry in `src/data/changelog.js`
(`node scripts/release-notes.mjs --store` prints it).

```text
• Scroll diagnostics can record what your phone does while a scroll stutters: how it handled each touch, frame and fling
• The glass speed test now times the phone's own drawing of each frame, at its fastest refresh rate
```

## Images

| File | Size | Use |
|---|---|---|
| `banner-1024x500.jpg` | 1024 × 500, JPEG | Banner / feature graphic |
| `icon-512.png` (or `.jpg`) | 512 × 512, 24-bit PNG / JPEG | App icon (the app's own `docs/icon-512.png` has an alpha channel, which stores turn down) |
| `screenshots/jpg/01-today.jpg` … `08-coach.jpg` | 1080 × 1800, JPEG | Screenshots, in this order |
| `screenshots/1080x1800/` | 1080 × 1800, 24-bit PNG | The same eight as PNG |
| `screenshots/480x800/` | 480 × 800, 24-bit PNG | The same eight, for a store that wants exactly 480 × 800 |

None of these has an alpha channel.
