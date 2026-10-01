# Gradient Health privacy policy

Last updated September 30, 2026.

Gradient Health is a workout, health and food tracking app for Android. This policy explains exactly what the app collects, where it keeps it, what (if anything) leaves your phone, and how to delete it.

## The short version

There's no account, no ads, no analytics and no tracking. Everything you enter, and everything the app reads from Health Connect, is stored on your phone. Android's own device backup can keep a copy if you have backup turned on (see below).

If you allow it, the app also reads Health Connect in the background every 15 minutes, so your history stays complete on days you don't open it. When you record a run, walk, hike or ride, the app uses your location for its route, only while that activity is recording. The route stays on your phone, and goes to Health Connect only if you save the activity there.

Data only leaves your phone when you use one of these optional features, and only what the feature needs: a summary sent to Claude, once you've allowed it, when you ask it something and for your weekly report; a food search or barcode sent to Open Food Facts when you look a food up online; a one-time download of the on-device AI model; street map pieces for the area around an activity, from OpenFreeMap, when you tap Show streets; and a workout plan you choose to share, which goes only to the people you send it to. Each one is off until you turn it on.

Nobody is paid for your data, and it's never used for advertising.

## What the app collects and why

| Data | Where it comes from | What it's used for | Leaves the phone? |
|---|---|---|---|
| Set-up answers: age, sex (optional), height, weight, goals, experience, schedule, equipment, health conditions you choose to plan around (optional), injuries to be careful with, sleep habits, preferences | You | Building your plan and adjusting it, including the moves a health condition rules out; protein and calorie targets | Only in the Claude summary, if you use Claude: an age range instead of your age, sex if you gave it, goals, experience, schedule, equipment and joints you're careful with. Health conditions are never sent |
| Workouts: exercises, sets, reps, weights, rest, how hard it felt, pain you report, left vs right tests | You, in the workout player | Deciding what you do next time; your stats, streaks and achievements | Only as totals and trends in the Claude summary, if you use Claude |
| Health data you allow: steps, sleep, weight, height, body fat, resting heart rate, heart rate, heart rate variability, workouts from other apps, active and total calories, distance, nutrition logged in other apps | Health Connect, with your permission: when you open the app, and every 15 minutes in the background if you allow that too | Easier days after short sleep or poor recovery, light-day walks, weight trend, calorie burn estimate, trends and insights | Only as averages and trends in the Claude summary, if you use Claude |
| Activities you record (runs, walks, hikes and rides): the route, distance, time, pace, elevation and steps, and your heart rate, steps and calories from Health Connect for that time | Your phone's location and step counter, only while an activity you started is recording, and Health Connect if you allow it | The activity's map and summary, your history and your plan | No. If you save an activity to Health Connect, it goes there with its route (if you allow routes). Totals like distance and time can be in the Claude summary if you use Claude; the route and your location never are. Show streets downloads map pieces for the area around the route, which tells OpenFreeMap roughly where it was |
| Food log: foods, portions, calories, protein, carbs, fat, fibre, your custom foods and saved meals | You | Calorie and macro tracking, if you turn it on | Only as averages in the Claude summary, if you use Claude: your calorie target and what you ate on average, not the foods. Online food lookups send only the search words or the barcode number |
| Your workout plans: their names, notes, days, exercises, sets and reps, how each exercise has progressed, and who shared a plan with you (a first name, if they included it) | You, the coach, or a plan someone shared with you | Running the plan you pick instead of the coach's | Only a plan you share yourself: the code or link holds that plan (not your workouts or health data) and your first name if you leave it on. If you ask Claude to build a plan, your request and the moves you can do go with the Claude summary |
| Manual logs: weight, sleep, body measurements, how you feel, protein, activities outside the app | You | Trends, readiness and insights | Only as averages in the Claude summary, if you use Claude |
| Coach chats: questions you ask and the answers | You and the coach | Showing the conversation and answering follow-ups | Only questions you send to Claude. The built-in and on-device coaches run on your phone |
| Reports about AI answers: the answer you flag and the reason you pick | You | Hiding that answer, and telling the developer if you choose to | Only if you choose to send it: it opens as a GitHub issue that you can read and edit before posting |
| Anthropic API key (optional) | You | Letting the app call Claude on your behalf | Only to Anthropic, with each Claude request |
| On-device AI model file (optional) | Downloaded from Hugging Face when you ask | Running the on-device coach | No. It's a download, nothing is uploaded |

The app doesn't collect your name unless you type one in, uses your location only while an activity you started is recording, and never collects your contacts, photos, files, device identifiers or advertising ID.

## Health Connect

The app reads only the data types you allow on Health Connect's permission screen, and you can change that at any time in Health Connect. If you allow it, it also writes back the workouts you finish in the app and the activities you record, as exercise sessions (an activity with its route, if you allow routes, and its distance and active calories when no watch recorded them), and the meals you log, as nutrition records. That lets your other health apps see them. You can turn writing off in Settings or in Health Connect.

Reading in the background is a separate permission. With it, the app reads the last two days of the data types you allow every 15 minutes, even while it's closed, and keeps each read on your phone until it adds it to your history. It needs Android 15, or Android 14 with a recent Health Connect, and you can turn it off in Settings (Sync in the background) or in Health Connect.

Gradient Health's use of information received from Health Connect adheres to the Health Connect Permissions policy, including the Limited Use requirements. Health Connect data is used only to provide the features described above, is never sold, never used for advertising, never used to decide credit or insurance, and never shared with anyone except when you choose to send a summary to Claude.

## Outside services, only when you use them

Any service you connect to sees your IP address, as with every internet request. The app adds no identifiers of its own.

- **Anthropic (Claude).** Optional, and only after you allow it on a screen that lists what gets sent. With your own API key, the app sends a short summary of your data plus your question to Anthropic's API when you ask something, when you ask for suggestions, and for your weekly report (written when you open Health, at most once a week). The summary holds an age range, sex if you gave it, your goals, experience, schedule and equipment, joints you're careful with, averages and trends of your health data, your training numbers, and food averages if you track calories. It never includes your name, email, exact dates or device IDs. "Ask in the Claude app" hands the same summary and your question to the Claude app on your phone, only when you press the button. Settings, Coach, "What gets sent" shows the exact text. Anthropic's own privacy policy covers what happens after that.
- **Open Food Facts.** Optional. When you search online or scan a barcode, the search words or the barcode number are sent to Open Food Facts (openfoodfacts.org) to look the food up. Nothing else about you goes with it. Their data is published under the Open Database License.
- **Hugging Face.** Optional. If you download the on-device AI model, the file comes from Hugging Face (huggingface.co), like any download. After that the model runs entirely on your phone.
- **OpenFreeMap (street maps).** Optional, and only when you tap Show streets on an activity. The app then downloads map pieces and map fonts for the area around that route from OpenFreeMap (tiles.openfreemap.org). Which pieces it asks for tells OpenFreeMap roughly where the activity was; the route itself and the rest of your data aren't sent, and the app adds no identifier. Without Show streets the route is drawn on your phone with no map behind it, and nothing is downloaded. Map data © OpenStreetMap contributors, © OpenMapTiles.
- **Sharing a plan (GitHub Pages).** Optional, and only when you share one. Send a link hands the text to the app you pick on Android's share sheet; a QR code is read straight from your screen. Nothing goes through a server of ours. A link opened in a browser loads a small page from GitHub Pages (shadowsdistant.github.io), which sees the visit like any website but not the plan: the plan is in the part of the link after the #, which browsers keep to themselves, and the page reads it on the device and makes no other requests.

## Permissions the app asks for

- **Health Connect (read).** Steps, sleep, weight, height, body fat, heart rate, resting heart rate, heart rate variability, exercise, active and total calories burned, distance and nutrition, for the features above. Each one is optional.
- **Health Connect (read in the background).** Reading the data types you allow every 15 minutes while the app is closed, so your history has no gaps. Optional.
- **Health Connect (write).** Exercise (with routes), distance, active calories and nutrition, so your workouts, activities and meals show up in your other health apps. Optional.
- **Location (precise).** Only while a run, walk, hike or ride you started is recording, to draw its route and measure it, including with the screen off. The app never asks for location in the background.
- **Physical activity.** Counting your steps during an activity with the phone's step counter. Optional.
- **Notifications.** The notification you see while an activity records, with its time, distance, Pause and Finish. Optional.
- **Foreground service.** Keeps an activity recording with the screen off. It runs only while one you started is recording.
- **Run at startup.** Keeps the background sync scheduled after your phone restarts.
- **Camera.** Only for scanning food barcodes and shared plan codes, and only when you tap Scan or Add a shared plan. The image is read on your phone to find the code; no photo or video is saved or sent.
- **Internet and network state.** For the optional features above, and to wait for Wi-Fi before a large model download.
- **Vibration.** Haptic feedback and workout timer alerts.

## Where it's kept and how it's protected

Everything is stored in the app's private storage on your phone, which other apps can't read. Connections to outside services use HTTPS. The app contains no third-party analytics, advertising or crash-reporting code.

Background reads wait in the app's private storage until the app adds them to your history, and an activity's route is kept there while it records. Neither is in device backups. Once you save an activity, it's part of the app's saved data like everything else.

If you have Android's device backup turned on, it can keep a copy of the app's saved data. On Android 9 and newer the app only allows that when the backup is end-to-end encrypted with your screen lock (a PIN, pattern or password); Android 8 backs up without that encryption. Your API key and the on-device model are never in a backup, and the key is never in Copy my data.

## How long it's kept, and deleting it

Your data stays on your phone until you delete it. Settings, Reset everything, deletes all of it, including the API key and the downloaded model. Uninstalling the app deletes it from the phone; a copy in your Android device backup, if you have one, stays until that backup is replaced or you delete it in your Google account. You can delete the model on its own in Settings.

Records the app wrote to Health Connect stay there until you remove them in Health Connect, and a meal you delete in the app is deleted from Health Connect too. To stop the app reading or writing health data, remove its access in Health Connect.

Settings, Copy my data, gives you a copy of everything (except the API key) as text you control.

## Children

Gradient Health isn't directed at children under 13, and the app doesn't knowingly collect data from them.

## Changes

If this policy changes, the new version is published here and in the app with a new date. The app won't start sending data anywhere new without asking you first.

## Contact

Gradient Health is made by ShadowsDistant (https://github.com/ShadowsDistant). Questions or requests about privacy: open an issue at https://github.com/ShadowsDistant/gradient-health/issues.
