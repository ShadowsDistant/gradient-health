# Store listing

Text for APKPure (and Google Play), plus the images next to this file. `node scripts/store-assets.mjs`
renders the images again from `docs/screenshots/`.

## Short description (80 characters at most)

```text
Workouts that adapt to you every day, with a 3D coach and a private AI coach
```

## Full description (4,000 characters at most)

```text
Gradient Health is a personal trainer on your phone. It plans each workout around your goals, your equipment and the time you have, then adjusts as you go. A 3D coach shows every move. After each exercise, tell it how many more reps you could have done, and your next workout changes to match. Slept badly? Today gets a little lighter.

WORKOUTS MADE FOR YOU
• 10 minutes to an hour, 2 to 6 days a week, at home or at the gym
• No equipment? A chair, a wall and a towel are enough to start
• More reps, then more weight, then a harder move as you get stronger
• Easier days after a short night or a high resting heart rate
• 282 exercises, and plans that fit your age, your joints and your health

SEE EVERY MOVE IN 3D
• A 3D figure shows each exercise at the right tempo
• The working muscles light up, and you can turn the figure to any angle

MORE THAN WORKOUTS
• Sleep, steps, heart rate, weight and more from Health Connect
• Runs, walks, hikes and rides with GPS, auto-pause and spoken splits
• Calories and macros by meal, with a barcode scanner, or just protein
• 64 badges as 3D medals to earn, open and share

A PRIVATE AI COACH
Ask about your sleep, your steps or your training. The AI runs on your phone after a one-time download, so it works offline and nothing you ask leaves the phone. Or connect Claude with your own API key.

YOUR DATA STAYS WITH YOU
There's no account, no ads and no analytics. Your data stays on your phone unless you choose to send it.

Gradient Health gives general fitness guidance, not medical advice. If you have a health condition, check with your doctor before you start.

Needs Android 8.0 or newer. Health Connect features need Android 14 or newer.
```

## What's new (500 characters at most)

Paste this into the What's new field with each update. This is 1.12.0's. Each GitHub release carries
its own version's text at the end of its What's new, under "Short version, for a store's What's new
field". It comes from the `store` text of the version's entry in `src/data/changelog.js`
(`node scripts/release-notes.mjs --store` prints it).

```text
• Food lives in Health now, so tracking calories never costs a tab
• Start in one short sheet, then add food from Health's + menu
• Food goes in the right meal by the clock: set your meal times or let the app learn them
• Your usual foods and yesterday's meals in a tap
• Barcode scanning that reads: quicker, with zoom, tap to focus and tips
• Tabs respond the moment you tap
• Sheets open at the right size, with softer fades at the top
```

## Images

| File | Size | Use |
|---|---|---|
| `feature-graphic-1024x500.jpg` (or `.png`) | 1024 × 500 | Feature graphic / banner |
| `icon-512.png` (or `.jpg`) | 512 × 512, 24-bit PNG / JPEG | App icon (the app's own `docs/icon-512.png` has an alpha channel, which stores turn down) |
| `screenshots/jpg/01-adapts.jpg` … `05-medals.jpg` | 1080 × 1800, JPEG | Screenshots, in this order |
| `screenshots/1080x1800/` | 1080 × 1800, 24-bit PNG | The same five as PNG |
| `screenshots/480x800/` | 480 × 800, 24-bit PNG | The same five, for a store that wants exactly 480 × 800 |
| `promo-1080p.mp4` | 1920 × 1080, H.264, 33 s, no sound | Promo video (upload it to YouTube for a store that takes a link) |
| `promo-thumbnail-1280x720.jpg` | 1280 × 720, JPEG | The video's thumbnail |

None of these has an alpha channel. `node scripts/store-assets.mjs` renders the images and `node scripts/promo-video.mjs` the video (both from `docs/screenshots/` and the 3D renders `scripts/store-3d.mjs` makes).
