# Store listing

Text for APKPure (and Google Play), plus the images next to this file. `node scripts/store-assets.mjs`
renders the images again from `docs/screenshots/`.

## Short description (80 characters at most)

```text
Workouts that adapt to you every day, GPS runs, reminders and a private AI coach
```

## Full description (4,000 characters at most)

```text
Gradient Health plans a workout for each day of your week around your goals, your equipment and the time you have. A 3D figure shows you every move. After each exercise it asks one question, and your answer, with how you slept and recovered, decides what you do next time. Track your runs, your food and your health too, or only the parts you want.

WORKOUTS THAT ADJUST TO YOU
• A plan built from your goals, your days and your time: 10 minutes to an hour, 2 to 6 days a week
• It weighs every way to split your week and picks the best, and "Why this plan" shows how
• Workouts fill the time you set, never more, and every muscle gets its weekly minimum
• Easier days after short sleep, a high resting heart rate or a hard day before
• One question after each exercise moves you up: more reps, then more weight, then a harder move
• At home with just a chair, a wall and a towel, or at the gym with barbells, cables and machines
• Short on time? One tap turns today's workout into a 12 to 15 minute version

A PLAN BUILT AROUND YOUR BODY
• It adapts to your age: livelier under 30, gentler warm-ups and balance work from 50, supported moves from 65
• It works around arthritis (with a flare-day switch), osteoporosis, back pain, high blood pressure, balance problems, painful wrists, heart conditions or a wheelchair
• 282 exercises, 71 of them seated, supported and balance moves

A 3D COACH FOR EVERY MOVE
• Every move shown in 3D at the right tempo, with the working muscles lit
• Drag the figure to see it from any side
• Your week's moves show up in 3D the moment you open your plan

RUNS, WALKS, HIKES AND RIDES
• Record with GPS, even with the screen off, with Pause and Finish in the notification
• A live map that follows you, and maps you've seen open even offline
• Auto-pause, spoken splits and your pace right now
• A summary with your route on the map, pace, splits, elevation and steps
• Heart rate and calories from your watch through Health Connect
• Personal records: fastest mile, longest run and more

BADGES TO OPEN AND SHARE
• 64 badges, from your first workout to a 100-day streak, and a few secret ones
• Each new badge arrives sealed: tap to crack it open
• Share one as a picture with friends and family, with your name only if you choose

REMINDERS THAT DON'T NAG
• A nudge on workout days, a walk now and then on rest days, a badge to open, good news after a great night
• Never more than one a day, never late at night, and at most one a week if you've been away
• Switch each kind on or off. They're worked out on your phone

YOUR OWN PLANS
• Build a plan like a playlist, or ask the coach to build one
• Share it with a QR code or a link

HEALTH AND FOOD
• Sleep, steps, heart rate, HRV, weight and more from Health Connect, synced in the background
• Tap any number for its history and what it means
• Count calories and macros, just protein, or nothing at all

A PRIVATE AI COACH
• Ask about your numbers. The AI model runs on your phone after a one-time download, so it works offline
• Or use Claude with your own Anthropic API key
• Tailor your plan by saying what you want: "more legs, my knees hurt, 20 minutes"
• Check your plan with AI: its suggestions are checked against your equipment, joints and time, and you pick which to apply

MADE TO FEEL GOOD
• Liquid glass controls that answer every tap, and smooth motion between screens
• Smooth scrolling, with the glass as designed or lighter: your choice
• Haptics with distinct feels, from a tick for each tab to a finished set and a new best
• A quick set-up: six short steps, then your plan and your first workout

PRIVATE BY DESIGN
No account, no ads and no analytics. Your data stays on your phone, and health conditions you add are never sent anywhere.

Gradient Health gives general fitness guidance, not medical advice. If a move hurts, stop. If you have a health condition, check with your doctor before you start.

Needs Android 8.0 or newer. Health Connect features need Android 14 or newer.
```

## What's new (500 characters at most)

Paste this into the What's new field with each update. This is 1.10.0's. Each GitHub release carries
its own version's text at the end of its What's new, under "Short version, for a store's What's new
field". It comes from the `store` text of the version's entry in `src/data/changelog.js`
(`node scripts/release-notes.mjs --store` prints it).

```text
• Pick Claude's model and how much it thinks, with spending limits that hold
• Claude builds plans and improves your own
• Badges are 3D medals you can spin
• A new icon, and colours to match
• Plan's 3D figures show at once after an update
• Messages come up from the bottom; quicker pages, sheets and dialogs
• Reminders on after set-up
• Health: a tidier This week, and dropdowns that fold open
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
