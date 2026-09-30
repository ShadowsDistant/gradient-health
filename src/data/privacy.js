/* The privacy policy, in one place: the app's Privacy page renders it, and the build writes the same
 * text to docs/PRIVACY.md (the public copy linked from the Play listing). Keep it true to the code:
 * every data type, permission and outside service the app uses is listed here.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const CONTACT = 'https://github.com/ShadowsDistant/gradient-health/issues';

  GH.PRIVACY = {
    updated: '2026-09-29',
    contact: CONTACT,
    intro: [
      'Gradient Health is a workout, health and food tracking app for Android. This policy explains exactly what the app collects, where it keeps it, what (if anything) leaves your phone, and how to delete it.',
    ],
    sections: [
      {
        title: 'The short version',
        paras: [
          'There\'s no account, no ads, no analytics and no tracking. Everything you enter, and everything the app reads from Health Connect, is stored on your phone. Android\'s own device backup can keep a copy if you have backup turned on (see below).',
          'Data only leaves your phone when you use one of these optional features, and only what the feature needs: a summary sent to Claude, once you\'ve allowed it, when you ask it something and for your weekly report; a food search or barcode sent to Open Food Facts when you look a food up online; and a one-time download of the on-device AI model. Each one is off until you turn it on.',
          'Nobody is paid for your data, and it\'s never used for advertising.',
        ],
      },
      {
        title: 'What the app collects and why',
        table: {
          head: ['Data', 'Where it comes from', 'What it\'s used for', 'Leaves the phone?'],
          rows: [
            ['Set-up answers: age, sex (optional), height, weight, goals, experience, schedule, equipment, health conditions you choose to plan around (optional), injuries to be careful with, sleep habits, preferences', 'You', 'Building your plan and adjusting it, including the moves a health condition rules out; protein and calorie targets', 'Only in the Claude summary, if you use Claude: an age range instead of your age, sex if you gave it, goals, experience, schedule, equipment and joints you\'re careful with. Health conditions are never sent'],
            ['Workouts: exercises, sets, reps, weights, rest, how hard it felt, pain you report, left vs right tests', 'You, in the workout player', 'Deciding what you do next time; your stats, streaks and achievements', 'Only as totals and trends in the Claude summary, if you use Claude'],
            ['Health data you allow: steps, sleep, weight, height, body fat, resting heart rate, heart rate, heart rate variability, workouts from other apps, active calories, distance, nutrition logged in other apps', 'Health Connect, with your permission', 'Easier days after short sleep or poor recovery, light-day walks, weight trend, calorie burn estimate, trends and insights', 'Only as averages and trends in the Claude summary, if you use Claude'],
            ['Food log: foods, portions, calories, protein, carbs, fat, fibre, your custom foods and saved meals', 'You', 'Calorie and macro tracking, if you turn it on', 'Only as averages in the Claude summary, if you use Claude: your calorie target and what you ate on average, not the foods. Online food lookups send only the search words or the barcode number'],
            ['Manual logs: weight, sleep, body measurements, how you feel, protein, activities outside the app', 'You', 'Trends, readiness and insights', 'Only as averages in the Claude summary, if you use Claude'],
            ['Coach chats: questions you ask and the answers', 'You and the coach', 'Showing the conversation and answering follow-ups', 'Only questions you send to Claude. The built-in and on-device coaches run on your phone'],
            ['Reports about AI answers: the answer you flag and the reason you pick', 'You', 'Hiding that answer, and telling the developer if you choose to', 'Only if you choose to send it: it opens as a GitHub issue that you can read and edit before posting'],
            ['Anthropic API key (optional)', 'You', 'Letting the app call Claude on your behalf', 'Only to Anthropic, with each Claude request'],
            ['On-device AI model file (optional)', 'Downloaded from Hugging Face when you ask', 'Running the on-device coach', 'No. It\'s a download, nothing is uploaded'],
          ],
        },
        paras: ['The app doesn\'t collect your name unless you type one in, and never collects your contacts, location, photos, files, device identifiers or advertising ID.'],
      },
      {
        title: 'Health Connect',
        paras: [
          'The app reads only the data types you allow on Health Connect\'s permission screen, and you can change that at any time in Health Connect. If you allow it, it also writes two things back: the workouts you finish in the app, as exercise sessions, and the meals you log, as nutrition records. That lets your other health apps see them. You can turn writing off in Settings or in Health Connect.',
          'Gradient Health\'s use of information received from Health Connect adheres to the Health Connect Permissions policy, including the Limited Use requirements. Health Connect data is used only to provide the features described above, is never sold, never used for advertising, never used to decide credit or insurance, and never shared with anyone except when you choose to send a summary to Claude.',
        ],
      },
      {
        title: 'Outside services, only when you use them',
        list: [
          ['Anthropic (Claude)', 'Optional, and only after you allow it on a screen that lists what gets sent. With your own API key, the app sends a short summary of your data plus your question to Anthropic\'s API when you ask something, when you ask for suggestions, and for your weekly report (written when you open Health, at most once a week). The summary holds an age range, sex if you gave it, your goals, experience, schedule and equipment, joints you\'re careful with, averages and trends of your health data, your training numbers, and food averages if you track calories. It never includes your name, email, exact dates or device IDs. "Ask in the Claude app" hands the same summary and your question to the Claude app on your phone, only when you press the button. Settings, Coach, "What gets sent" shows the exact text. Anthropic\'s own privacy policy covers what happens after that.'],
          ['Open Food Facts', 'Optional. When you search online or scan a barcode, the search words or the barcode number are sent to Open Food Facts (openfoodfacts.org) to look the food up. Nothing else about you goes with it. Their data is published under the Open Database License.'],
          ['Hugging Face', 'Optional. If you download the on-device AI model, the file comes from Hugging Face (huggingface.co), like any download. After that the model runs entirely on your phone.'],
        ],
        paras: ['Any service you connect to sees your IP address, as with every internet request. The app adds no identifiers of its own.'],
      },
      {
        title: 'Permissions the app asks for',
        list: [
          ['Health Connect (read)', 'Steps, sleep, weight, height, body fat, heart rate, resting heart rate, heart rate variability, exercise, active calories burned, distance and nutrition, for the features above. Each one is optional.'],
          ['Health Connect (write)', 'Exercise and nutrition, so your workouts and meals show up in your other health apps. Optional.'],
          ['Camera', 'Only for scanning food barcodes, and only when you tap Scan. The image is read on your phone to find the barcode; no photo or video is saved or sent.'],
          ['Internet and network state', 'For the optional features above, and to wait for Wi-Fi before a large model download.'],
          ['Vibration', 'Haptic feedback and workout timer alerts.'],
        ],
      },
      {
        title: 'Where it\'s kept and how it\'s protected',
        paras: [
          'Everything is stored in the app\'s private storage on your phone, which other apps can\'t read. Connections to outside services use HTTPS. The app contains no third-party analytics, advertising or crash-reporting code.',
          'If you have Android\'s device backup turned on, it can keep a copy of the app\'s saved data. On Android 9 and newer the app only allows that when the backup is end-to-end encrypted with your screen lock (a PIN, pattern or password); Android 8 backs up without that encryption. Your API key and the on-device model are never in a backup, and the key is never in Copy my data.',
        ],
      },
      {
        title: 'How long it\'s kept, and deleting it',
        paras: [
          'Your data stays on your phone until you delete it. Settings, Reset everything, deletes all of it, including the API key and the downloaded model. Uninstalling the app deletes it from the phone; a copy in your Android device backup, if you have one, stays until that backup is replaced or you delete it in your Google account. You can delete the model on its own in Settings.',
          'Records the app wrote to Health Connect stay there until you remove them in Health Connect, and a meal you delete in the app is deleted from Health Connect too. To stop the app reading or writing health data, remove its access in Health Connect.',
          'Settings, Copy my data, gives you a copy of everything (except the API key) as text you control.',
        ],
      },
      {
        title: 'Children',
        paras: ['Gradient Health isn\'t directed at children under 13, and the app doesn\'t knowingly collect data from them.'],
      },
      {
        title: 'Changes',
        paras: ['If this policy changes, the new version is published here and in the app with a new date. The app won\'t start sending data anywhere new without asking you first.'],
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
