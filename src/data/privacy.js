/* The privacy policy, in one place: the app's Privacy page renders it, and the build writes the same
 * text to docs/PRIVACY.md (the public copy linked from the Play listing). Keep it true to the code:
 * every data type, permission and outside service the app uses is listed here.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const CONTACT = 'https://github.com/ShadowsDistant/gradient-health/issues';

  GH.PRIVACY = {
    updated: '2026-10-12',
    contact: CONTACT,
    intro: [
      'Gradient Health is a workout, health and food tracking app for Android. This policy covers what the app collects, where it\'s kept, what leaves your phone, and how to delete it.',
    ],
    sections: [
      {
        title: 'The short version',
        paras: [
          'There\'s no account, no ads, no analytics and no tracking. Everything you enter, and everything the app reads from Health Connect, is stored on your phone. Android\'s device backup can keep a copy if you have backup on (see below).',
          'If you allow it, the app also reads Health Connect every 15 minutes in the background. Recording a run, walk, hike or ride uses your location for its route, and only then. The route stays on your phone, and goes to Health Connect only if you save it there.',
          'Reminders are on after set-up unless you say no when Android asks to allow notifications (Android 13 and newer asks at the end of set-up). The app plans them on your phone and sends nothing about them. You can turn them off in Settings.',
          'Data leaves your phone only through optional features you use, and only what each needs: a summary for Claude once you\'ve allowed it, a food search or barcode for Open Food Facts, a one-time download of the on-device AI model, map pieces from OpenFreeMap with maps on, and a plan you share, only with the people you send it to.',
          'The app from GitHub or APKPure also asks GitHub once a day whether there\'s a new version, unless you turn off Check automatically in Settings. GitHub sees your IP address and which version you have, as any website would, and nothing about you is sent. The Google Play version gets its updates from Play and never asks.',
          'Your data is never sold or used for advertising.',
        ],
      },
      {
        title: 'What the app collects and why',
        table: {
          head: ['Data', 'Where it comes from', 'What it\'s used for', 'Leaves the phone?'],
          rows: [
            ['Set-up answers: age, sex (optional), height, weight, goals, experience, schedule, equipment, health conditions to plan around (optional), injuries to be careful with, sleep habits, preferences', 'You', 'Building and adjusting your plan, including moves a health condition rules out; protein and calorie targets', 'Only in the Claude summary, if you use Claude: an age range (not your age), sex if you gave it, goals, experience, schedule, equipment and joints you\'re careful with. Health conditions are never sent'],
            ['Workouts: exercises, sets, reps, weights, rest, how hard it felt, pain you report, left vs right tests', 'You, in the workout player', 'Deciding what you do next time; your stats, streaks and achievements', 'Only as totals and trends in the Claude summary, if you use Claude'],
            ['Health data you allow: steps, sleep, weight, height, body fat, resting heart rate, heart rate, heart rate variability, workouts from other apps, active and total calories, distance, nutrition logged in other apps', 'Health Connect, with your permission: when you open the app, and every 15 minutes in the background if you allow that', 'Easier days after short sleep or poor recovery, light-day walks, weight trend, calorie burn estimate, trends and insights', 'Only as averages and trends in the Claude summary, if you use Claude'],
            ['Activities you record (runs, walks, hikes and rides): the route, distance, time, pace, elevation and steps, and your heart rate, steps and calories from Health Connect for that time', 'Your phone\'s location and step counter, only while an activity you started is recording, and Health Connect if you allow it', 'The activity\'s map and summary, your history and your plan', 'No. If you save an activity to Health Connect, it goes there with its route (if you allow routes). The Claude summary, if you use Claude, can include totals like distance and time, never the route or your location. With maps on, the map pieces the app fetches tell OpenFreeMap roughly where the route is, or where you are while recording (see Outside services). Spoken splits, if on, hand each split\'s words to your phone\'s text-to-speech'],
            ['Food log: foods, portions, calories, protein, carbs, fat, fibre, your custom foods and saved meals', 'You', 'Calorie and macro tracking, if you turn it on', 'Only as averages in the Claude summary, if you use Claude: your calorie target and average intake, not the foods. Online lookups send only the search words or barcode number'],
            ['Your workout plans: their names, notes, days, exercises, sets and reps, each exercise\'s progress, and who shared a plan with you (a first name, if they included it)', 'You, the coach, or a plan someone shared with you', 'Running the plan you pick instead of the coach\'s', 'Only a plan you share yourself: the code or link holds that plan (not your workouts or health data), and your first name if you leave it on. If you ask Claude to build or improve a plan, your request, that plan\'s days and exercises and the moves you can do go with the Claude summary'],
            ['Manual logs: weight, sleep, body measurements, how you feel, protein, activities outside the app', 'You', 'Trends, readiness and insights', 'Only as averages in the Claude summary, if you use Claude'],
            ['Notifications (optional): when to remind you and what to say, worked out from your plan, workouts, activities, badges and, for the morning note, last night\'s sleep from Health Connect', 'Your phone, while notifications are on (from set-up unless you say no, or once you turn them on in Settings)', 'Workout reminders, an occasional nudge to walk or run, a new badge, a note after a good night\'s sleep, and an occasional note after a break', 'No. The schedule, which ones were shown and the nights it looked at stay on your phone, out of backups'],
            ['Badges you share: a picture of the badge, its name and the date you earned it, and your first name only if you turn it on', 'You, when you tap Share on a badge you earned', 'Showing friends and family what you did', 'Only when you tap Share, to the app you pick on Android\'s share sheet: exactly the picture the preview shows. Nothing goes through a server'],
            ['Coach chats: questions you ask and the answers', 'You and the coach', 'Showing the conversation and answering follow-ups', 'Only questions you send to Claude. The built-in and on-device coaches run on your phone'],
            ['Reports about AI answers: the answer you flag and the reason you pick', 'You', 'Hiding that answer, and telling the developer if you choose to', 'Only if you choose to send it, as a GitHub issue you can read and edit before posting'],
            ['Scroll diagnostics (optional): the last few minutes of touches (where, when and how late each reached the app), how far the page moved, frame times (from the page and from Android), your phone\'s model, screen size, refresh rate and graphics chip, and, if you record one, 12 seconds of the app\'s own web view timing each touch, frame and fling', 'Your phone, while the app is open', 'Showing you what a freeze looked like (Settings, About, Scroll diagnostics), and which look of the glass your phone draws smoothly', 'No. It stays in memory and is gone when the app closes, unless you Copy or Share the report yourself. A recording sits in the app\'s own storage only while the app reads it, then it\'s deleted; the report keeps its sums'],
            ['Claude usage: each request\'s time, model, tokens in and out, and cost; your spending limits', 'The app, from what Anthropic reports with each answer', 'Holding Claude to the limits you set, and showing what it has cost', 'No. It stays on your phone (and in Copy my data)'],
            ['Anthropic API key (optional)', 'You', 'Letting the app call Claude for you. It\'s stored encrypted on your phone, with a key Android keeps for the app that never leaves the phone', 'Only to Anthropic, with each Claude request. Never in a backup or in Copy my data'],
            ['On-device AI model file (optional)', 'Downloaded from Hugging Face when you ask', 'Running the on-device coach', 'No. It\'s a download; nothing is uploaded'],
            ['Updates (the app from GitHub or APKPure): which version you have', 'The app, once a day unless you turn off Check automatically, and when you tap Check for updates', 'Telling you when a new version is ready, and downloading it when you tap Update', 'Only to GitHub, which sees your IP address and which version you have, as any website would. Nothing about you is sent. A new version is a download; it waits in the app\'s cache, never in a backup, and Android asks you before it installs. The Google Play version doesn\'t check'],
          ],
        },
        paras: ['The app doesn\'t collect your name unless you type it, uses your location only while an activity you started records, and never collects your contacts, photos, files, device identifiers or advertising ID.'],
      },
      {
        title: 'Health Connect',
        paras: [
          'The app reads only the data types you allow on Health Connect\'s permission screen, which you can change there any time. If you allow it, the app also writes your finished workouts and recorded activities as exercise sessions (an activity with its route if you allow routes, plus distance and active calories when no watch recorded them) and your logged meals as nutrition records, so your other health apps see them. You can turn writing off in Settings or in Health Connect.',
          'Background reading is a separate permission. With it, the app reads the last two days of your allowed data types every 15 minutes, even while closed, and keeps each read on your phone until it adds it to your history. It needs Android 15, or Android 14 with a recent Health Connect. You can turn it off in Settings (Sync in the background) or in Health Connect.',
          'With notifications and background reads on, each morning the app checks last night\'s sleep from the latest background read, on your phone, to decide whether a good night is worth a note. Nothing about it leaves the phone.',
          'Gradient Health\'s use of information received from Health Connect adheres to the Health Connect Permissions policy, including the Limited Use requirements. Health Connect data is used only for the features above, and is never sold, used for advertising or used to decide credit or insurance. It\'s shared only when you choose to send a summary to Claude.',
        ],
      },
      {
        title: 'Outside services, only when you use them',
        list: [
          ['Anthropic (Claude)', 'Optional, and only after you allow it on a screen that lists what\'s sent. Using your own API key, the app sends a short summary of your data and your request to Anthropic\'s API when you ask a question, ask for suggestions, or ask it to build, check or improve a plan, and for your weekly report (written when you open Health, at most once a week). Requests that could go over your spending limits aren\'t sent. The summary holds an age range, sex if you gave it, your goals, experience, schedule and equipment, joints you\'re careful with, averages and trends of your health data, your training numbers, and food averages if you track calories. To check your plan, here or with the weekly report, Claude also gets next week\'s plan: each day\'s muscle groups and exercises, weekly sets against targets, minutes against the time you set, the plan\'s score and the planner\'s reasons, and up to 60 exercises you could swap in. Health conditions you plan around and your exact age are never sent (only the on-device coach sees them, on your phone), and neither are your name, email, exact dates or device IDs. Questions that sound like an emergency get the app\'s own answer, and nothing is sent. "Ask in the Claude app" hands the same summary and your question to the Claude app on your phone, only when you tap it. Settings, AI coach, "What gets sent" shows the exact text. After that, Anthropic\'s own privacy policy applies.'],
          ['Open Food Facts', 'Optional. When you search online or scan a barcode, only the search words or barcode number go to Open Food Facts (openfoodfacts.org) to look the food up. Their data is published under the Open Database License.'],
          ['Hugging Face', 'Optional. If you download the on-device AI model, the file comes from Hugging Face (huggingface.co). After that the model runs entirely on your phone.'],
          ['GitHub (updates)', 'Only in the app from GitHub or APKPure. Once a day, a few seconds after the app opens (unless you turn off Check automatically in Settings, About), and whenever you tap Check for updates, the app asks GitHub (github.com) for a small file that says which version is the newest. If you tap Update, the new version downloads from GitHub too, and Android asks you before it installs. GitHub sees your IP address and which version you have, as any website would; nothing about you is sent, and the app adds no identifier. The Google Play version gets its updates from Play and never asks.'],
          ['OpenFreeMap (maps)', 'Optional, and only with maps on: Show map on an activity, the map button while one records (the app asks first), or Maps in Settings. The app then downloads map pieces and fonts from OpenFreeMap (tiles.openfreemap.org) for the area shown: around an activity\'s route, or around you while one records. Which pieces it asks for tells OpenFreeMap roughly where the activity was, or where you are; your route and other data aren\'t sent, and the app adds no identifier. Pieces are kept on your phone (the newest 1,500, about 25 to 50 MB at most), so a map you\'ve seen opens at once, even offline, and its area is fetched again only after OpenFreeMap updates its map (about weekly). Settings, Clear saved maps, and Reset everything delete them. With maps off, the route is drawn on your phone with no map behind it and nothing is downloaded. Map data © OpenStreetMap contributors, © OpenMapTiles.'],
          ['Sharing a plan (GitHub Pages)', 'Optional. Send a link hands the text to the app you pick on Android\'s share sheet, and a QR code is read straight off your screen; nothing goes through a server of ours. A link opened in a browser loads a small page from GitHub Pages (shadowsdistant.github.io), which sees the visit like any website but not the plan: the plan sits after the # in the link, which browsers never send, and the page reads it on the device with no other requests.'],
        ],
        paras: ['Any service you connect to sees your IP address, as with every internet request. The app adds no identifiers of its own.'],
      },
      {
        title: 'Permissions the app asks for',
        list: [
          ['Health Connect (read)', 'Steps, sleep, weight, height, body fat, heart rate, resting heart rate, heart rate variability, exercise, active and total calories burned, distance and nutrition, for the features above. Each is optional.'],
          ['Health Connect (read in the background)', 'Reading the data types you allow every 15 minutes while the app is closed, so your history has no gaps. Optional.'],
          ['Health Connect (write)', 'Exercise (with routes), distance, active calories and nutrition, so your workouts, activities and meals show up in your other health apps. Optional.'],
          ['Location (precise)', 'Only while a run, walk, hike or ride you started is recording, to draw and measure its route, even with the screen off. The app never asks for background location.'],
          ['Physical activity', 'Counting your steps during an activity with the phone\'s step counter. Optional.'],
          ['Notifications', 'The notification shown while an activity records (time, distance, Pause and Finish), and your reminders, which are on after set-up unless you say no when Android asks (on Android 13 and newer). You can turn reminders on or off in Settings. Optional.'],
          ['Foreground service', 'Keeps an activity you started recording with the screen off, and runs only while it records.'],
          ['Run at startup', 'Keeps the background sync and your reminders scheduled after your phone restarts or the app updates.'],
          ['Camera', 'Only to scan food barcodes and shared plan codes, when you tap Scan or Add a shared plan. The image is read on your phone; no photo or video is saved or sent.'],
          ['Internet and network state', 'For the optional features above, and to wait for Wi-Fi before a large model download.'],
          ['Install apps (the app from GitHub or APKPure)', 'Handing a new version you downloaded to Android\'s installer, which asks you before it installs. Android has you allow this once, in its settings. The Google Play version doesn\'t ask for it.'],
          ['Vibration', 'Haptic feedback and workout timer alerts.'],
        ],
      },
      {
        title: 'Where it\'s kept and how it\'s protected',
        paras: [
          'Everything is stored in the app\'s private storage on your phone, which other apps can\'t read. Connections to outside services use HTTPS. The app has no third-party analytics, advertising or crash-reporting code.',
          'Background reads (until the app adds them to your history), an activity\'s route while it records, and the notifications\' schedule are kept there too, and none of them goes into device backups. Once saved, an activity is part of the app\'s saved data like everything else.',
          'With Android\'s device backup on, it can keep a copy of the app\'s saved data, but only when the backup is end-to-end encrypted with your screen lock (a PIN, pattern or password). That needs Android 9 or newer; on Android 8 the app\'s data isn\'t backed up at all. Your API key and the on-device model are never backed up.',
        ],
      },
      {
        title: 'How long it\'s kept, and deleting it',
        paras: [
          'Your data stays on your phone until you delete it. Settings, Reset everything, deletes all of it, including the API key, the downloaded model, saved map pieces and any reminders waiting to be shown. Uninstalling deletes it from the phone; a copy in your Android device backup, if any, stays until that backup is replaced or you delete it in your Google account. You can also delete just the model in Settings.',
          'Records the app wrote to Health Connect stay until you remove them there, and a meal you delete in the app is removed from Health Connect too. To stop all reading and writing, remove the app\'s access in Health Connect.',
          'Settings, Copy my data, gives you a copy of everything (except the API key) as text you control.',
        ],
      },
      {
        title: 'Children',
        paras: ['Gradient Health isn\'t directed at children under 13 and doesn\'t knowingly collect their data.'],
      },
      {
        title: 'Changes',
        paras: ['If this policy changes, the new version goes here and in the app with a new date. The app won\'t send data anywhere new without asking you first.'],
      },
      {
        title: 'Contact',
        paras: [`Gradient Health is made by ShadowsDistant (https://github.com/ShadowsDistant). Questions or requests about privacy: open an issue at ${CONTACT}.`],
      },
    ],
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
  const link = (s) => esc(s).replace(/https:\/\/[^\s<]+[^\s<.,)]/g, (u) => `<a href="${u}" data-act="openLink" data-arg="${u}">${u.replace(/^https:\/\//, '')}</a>`);

  // HTML for the in-app page. Tables become stacked cards on a phone.
  GH.PRIVACY.html = () => {
    const P = GH.PRIVACY;
    const d = new Date(P.updated + 'T12:00:00');
    const out = [`<p class="t-footnote rf-muted">Last updated ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>`];
    for (const p of P.intro) out.push(`<p class="t-body">${link(p)}</p>`);
    for (const s of P.sections) {
      out.push(`<h3 class="t-title-3">${esc(s.title)}</h3>`);
      if (s.table) {
        out.push('<div class="pv-table">');
        for (const r of s.table.rows) {
          out.push(`<div class="pv-row"><b class="t-callout">${esc(r[0])}</b>${s.table.head.slice(1).map((h, i) => `<span class="t-footnote"><span class="rf-muted">${esc(h)}:</span> ${esc(r[i + 1])}</span>`).join('')}</div>`);
        }
        out.push('</div>');
      }
      for (const p of s.paras || []) out.push(`<p class="t-body">${link(p)}</p>`);
      if (s.list) out.push(`<ul class="pv-list">${s.list.map(([k, v]) => `<li><b>${esc(k)}.</b> ${link(v)}</li>`).join('')}</ul>`);
    }
    return out.join('\n');
  };

  // Markdown for docs/PRIVACY.md.
  GH.PRIVACY.markdown = () => {
    const P = GH.PRIVACY;
    const d = new Date(P.updated + 'T12:00:00Z');
    const out = ['# Gradient Health privacy policy', '', `Last updated ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.`, ''];
    for (const p of P.intro) out.push(p, '');
    for (const s of P.sections) {
      out.push(`## ${s.title}`, '');
      if (s.table) {
        out.push(`| ${s.table.head.join(' | ')} |`, `|${s.table.head.map(() => '---').join('|')}|`);
        for (const r of s.table.rows) out.push(`| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
        out.push('');
      }
      for (const p of s.paras || []) out.push(p, '');
      if (s.list) { for (const [k, v] of s.list) out.push(`- **${k}.** ${v}`); out.push(''); }
    }
    return out.join('\n').replace(/\n+$/, '\n');
  };
})(typeof window !== 'undefined' ? window : globalThis);
