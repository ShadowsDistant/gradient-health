/* Settings: a short top page and a page for each part of the app, the coach set-up, backups and the
 * privacy page.
 *  - The top page: a search field, then the parts in three groups (Workouts, Tracking and Health
 *    Connect; Notifications, AI coach, Sound and haptics, Appearance and General; Your data and
 *    About), each a row with its icon, its name and a line on what's set there now. A row opens the
 *    part's page, U.open('settings', id), which pushes in as any page does.
 *  - A part's page: the settings used most first, in lists of one kind each. A list of controls
 *    (switches, segmented controls, sliders, swatches, and plain rows that open more of the same)
 *    has no icon tiles, so its titles, lines and hairlines start at one inset; a list of places to go
 *    and things to do has an icon on each row, as the top page does. Long explanations are footers.
 *  - The search finds rows in every page. It reads them from the pages' own markup, so a row another
 *    part draws (notifications', the haptics') is found too, and a result opens its page with the row
 *    brought into view and lit up a moment.
 *  - Links in: U.open('settings', id), and the older ids still land where they did (coach, track,
 *    food, feel, hc, notify). Back goes where the person came from: to the top page from a page it
 *    opened, and to the screen with the link from a page a link opened, as from any page. And
 *    U.open('settings', 'all') has every page on one, long enough for the scroll diagnostics' flicks.
 */
(function (G) {
  'use strict';
  const GH = G.GH || (G.GH = {});
  const U = GH.ui = GH.ui || {};
  U.act = U.act || {}; U.on = U.on || {}; U.screens = U.screens || {};
  const B = () => GH.brain;
  const H = () => GH.health;
  const AI = () => GH.ai;
  const SP = () => GH.spend;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------------------------------------------------------------- building blocks */
  // A page is lists, a header over one where it helps and a footer under one that needs explaining.
  // Each list and footer carries its page (data-group). Every row has a data-key, which a search
  // result brings into view, and data-keywords holds the other words it's found by. `id` names a
  // list a link can open the page at (set-<id>), as a header's id does.
  const head = (id, title) => `<h3 class="rf-list-header" id="set-${id}">${U.esc(title)}</h3>`;
  const form = (page, rows, id) => `<ul class="rf-list set-form" data-group="${page}"${id ? ` id="set-${id}"` : ''}>${rows}</ul>`;
  const menu = (page, rows) => `<ul class="rf-list set-menu" data-group="${page}">${rows}</ul>`;
  const foot = (page, html) => `<p class="rf-list-footer" data-group="${page}">${html}</p>`;
  const kw = (html, words) => html.replace(/^(\s*<(?:li|label)\b)/, `$1 data-keywords="${U.esc(words)}"`);
  // A row with its control under the words (a segmented control or chips).
  const stack = (title, subline, control, words, key) => `<li${key ? ` data-key="${key}"` : ''}${words ? ` data-keywords="${U.esc(words)}"` : ''}><div class="rf-list-row set-stack"><span class="rf-list-text"><span class="rf-list-title">${U.esc(title)}</span>${subline ? `<span class="rf-list-sub">${U.esc(subline)}</span>` : ''}</span>${control}</div></li>`;
  // A row in a list of controls that opens more of them (a sheet, Health Connect): no icon, a chevron.
  const more = (o) => U.row(Object.assign({}, o, { icon: null, chevron: true }));
  const REST_FOOT = 'Auto rests 90 s after big moves and 60 s after small ones and supersets, and about 2.5 min after the main lifts on a strength plan when there\'s time.';
  const DAY_STARTS = [['0', 'Midnight'], ['2', '2 am'], ['4', '4 am'], ['6', '6 am']];

  /* ---------------------------------------------------------------- the parts */
  // Each part: its row on the top page (icon, tone, title, and line(S): what's set there now) and its
  // page (body(S)). on(S): whether it shows (Workouts, with workouts on). words: what the search
  // finds the part itself by. The functions are further down, with the rows they draw.
  const PAGES = [
    { id: 'workouts', title: 'Workouts', icon: 'dumbbell', tone: 'coral', words: 'your plan training exercises sets reps', on: (S) => S.profile.workouts !== false, line: workoutsLine, body: workoutsPage },
    { id: 'track', title: 'Tracking', icon: 'checklist', tone: 'green', words: 'what you track tracking calories protein food workouts nutrition diet meals walks runs rides activities', on: () => true, line: trackLine, body: trackPage },
    { id: 'hc', title: 'Health Connect', icon: 'heart', tone: 'rose', words: 'health data sync steps sleep heart rate weight permissions android google fit', on: () => true, line: hcLine, body: hcPage },
    { id: 'notify', title: 'Notifications', icon: 'bell', tone: 'amber', words: 'notifications reminders reminder nudges alerts notify push bell quiet hours', on: () => true, line: notifyLine, body: notifyPage },
    { id: 'coach', title: 'AI coach', icon: 'sparkle', tone: 'violet', words: 'ai chat assistant questions claude on-device model', on: () => true, line: coachLine, body: coachPage },
    { id: 'feel', title: 'Sound and haptics', icon: 'volume', tone: 'sky', words: 'vibration vibrate buzz haptic haptics feedback feel touch beep audio', on: () => true, line: feelLine, body: feelPage },
    { id: 'look', title: 'Appearance', icon: 'appearance', tone: 'indigo', words: 'look theme appearance dark mode light mode night colour color display glass', on: () => true, line: lookLine, body: lookPage },
    { id: 'general', title: 'General', icon: 'settings', tone: 'teal', words: 'language region', on: () => true, line: generalLine, body: generalPage },
    { id: 'data', title: 'Your data', icon: 'archive', tone: 'green', words: 'backup export import save transfer', on: () => true, line: () => 'Copy, restore or reset', body: dataPage },
    { id: 'about', title: 'About', icon: 'info', tone: 'sky', words: 'version licenses research science', on: () => true, line: aboutLine, body: aboutPage },
  ];
  // The top page's groups: what you train and track, how the app behaves, and the app itself.
  const GROUPS = [['workouts', 'track', 'hc'], ['notify', 'coach', 'feel', 'look', 'general'], ['data', 'about']];
  const page = (id) => PAGES.find((p) => p.id === id) || null;
  // Older ids, and places in a page a link opens at: 'food' is Tracking, at Food.
  const AT = { plan: ['workouts'], food: ['track', 'food'], acts: ['track', 'acts'], appearance: ['look'], figure: ['look', 'figure'] };
  function target(S, arg) {
    const a = AT[arg] || [arg];
    const pg = page(a[0]);
    return pg && S && pg.on(S) ? { pg, at: a[1] || null } : null;
  }

  /* ---------------------------------------------------------------- the screens */
  let query = '', queryRoute = null; // the search, and the top page's route it was typed on
  let lastArg = null; // the page Settings drew last (null: the top page)
  let focusTo = null; // { page, key }: the row a search result opens its page at
  const wired = new WeakSet(); // search fields already listening
  const back = () => U.glassBtn('chevron-left', 'Back', 'back');
  U.screens.settings = {
    render(S, day, arg) {
      // (The screen still holds the page before this one: what it was says where this came from.)
      const scr = G.document && G.document.getElementById('screen');
      const from = scr ? scr.dataset.view : '';
      if (arg === 'all') { lastArg = arg; return allScreen(S); }
      const t = arg ? target(S, arg) : null;
      if (t) { lastArg = arg; return pageScreen(S, t.pg); }
      // The top page. A new visit starts with an empty search; a re-render keeps what's typed, and so
      // does Back from a page it opened (a result, to try the next one).
      if (U.route !== queryRoute) {
        if (!(from === 'settings' && lastArg)) query = '';
        queryRoute = U.route;
      }
      lastArg = null;
      index = null; // read again: what's set may have changed
      return homeScreen(S);
    },
    after(root) {
      const input = root.querySelector('#setQ');
      if (!input || wired.has(input)) return;
      wired.add(input);
      input.addEventListener('input', () => { query = input.value; paint(root); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      // The rows are read in a quiet moment once the field is touched, so the first letter finds them.
      input.addEventListener('focus', () => idle(() => { if (!index && U.S && U.route.view === 'settings' && !U.route.arg) index = readPages(U.S); }));
    },
    // A page opened at a row (a search result) or at a part of it (a link: 'food').
    focus(root, arg) {
      const t = target(U.S, arg);
      const want = focusTo && t && focusTo.page === t.pg.id ? focusTo.key : null;
      focusTo = null;
      if (!t) return;
      if (want) {
        const row = [...root.querySelectorAll('.set-page [data-key]')].find((n) => n.dataset.key === want);
        if (row) light(row);
      } else if (t.at) {
        const el = root.querySelector(`#set-${t.at}`);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    },
  };
  const idle = (fn) => (G.requestIdleCallback ? G.requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 60));
  // The row a result opened its page at: brought to the middle, lit up a moment (src/styles/you.css).
  function light(row) {
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
    row.classList.add('set-flash');
    setTimeout(() => row.classList.remove('set-flash'), 1800);
  }

  // The top page: the search, then each part with what's set there; with workouts off, Your answers
  // (age, weight, height) takes Workouts' place.
  function homeScreen(S) {
    const searching = !!norm(query);
    const groups = GROUPS.map((ids, i) => {
      const rows = ids.map(page).filter((pg) => pg.on(S)).map((pg) => U.row({ key: `p-${pg.id}`, icon: pg.icon, tone: pg.tone, title: U.esc(pg.title), sub: U.esc(pg.line(S)), act: 'setPage', arg: pg.id, chevron: true }));
      if (i === 0 && S.profile.workouts === false) rows.unshift(answersRow(S, { icon: 'person', tone: 'sky' }));
      return `<ul class="rf-list set-menu" data-key="g${i}">${rows.join('')}</ul>`;
    }).join('');
    return `${U.navbar('Settings', '', back())}
      <h1 class="rf-large-title">Settings</h1>
      <div class="section set-top" data-key="top">
        <div class="rf-search set-search" role="search" data-key="search">${U.icon('search')}<input class="rf-search-input" type="search" id="setQ" placeholder="Search settings" aria-label="Search settings" value="${U.esc(query)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button type="button" class="rf-search-clear" aria-label="Clear search">${U.icon('x-circle')}</button></div>
      </div>
      <div class="section set-home" data-key="home"${searching ? ' hidden' : ''}>${groups}</div>
      <div class="section set-results" data-key="results"${searching ? '' : ' hidden'}>${searching ? results(S) : ''}</div>`;
  }
  function pageScreen(S, pg) {
    return `${U.navbar(pg.title, '', back())}
      <h1 class="rf-large-title">${U.esc(pg.title)}</h1>
      <div class="section set-page" data-key="page-${pg.id}" data-page="${pg.id}">${pg.body(S)}</div>`;
  }
  // Every page on one: long enough to flick (Scroll diagnostics' glass speed test, src/ui/diag.js).
  function allScreen(S) {
    return `${U.navbar('All settings', '', back())}
      <h1 class="rf-large-title">All settings</h1>
      ${PAGES.filter((pg) => pg.on(S)).map((pg) => `<h2 class="sec-title t-title-3" data-key="t-${pg.id}">${U.esc(pg.title)}</h2>
      <div class="section set-page" data-key="page-${pg.id}" data-page="${pg.id}">${pg.body(S)}</div>`).join('')}`;
  }
  U.act.setPage = (el) => { const pg = page(el.dataset.arg); if (pg) U.open('settings', pg.id); };
  // A search result: its page, at the row ("look glass-fx"), or a row of the top page's own.
  U.act.setFind = (el) => {
    const a = String(el.dataset.arg || ''), i = a.indexOf(' ');
    const id = i < 0 ? a : a.slice(0, i);
    if (!page(id)) return;
    const input = G.document && G.document.getElementById('setQ');
    if (input) input.blur();
    focusTo = i < 0 ? null : { page: id, key: a.slice(i + 1) };
    U.open('settings', id);
  };

  /* ---------------------------------------------------------------- search */
  // The search reads every page's rows from the page itself (drawn for it, never shown): its title,
  // its words (title, line, the control's options), its keywords and the header it's under. Every
  // word typed has to start a word there: "rest" finds Rest between sets, and a short word doesn't
  // turn up in the middle of others. A part whose name or words match is a result too, before its
  // rows; a row then has to match by its own words, not just its part's name. Typing paints the
  // results in place (nothing re-renders, so the field keeps its keyboard).
  const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const has = (w, text) => ` ${norm(text)}`.includes(` ${w}`);
  const hits = (words, text) => words.every((w) => has(w, text));
  let index = null; // the rows, read once the search needs them; null after each render of the top page
  let indexing = false; // a page drawn for the search alone: nothing slow (the figure's still waits)
  const ANSWERS_OFF_WORDS = 'questionnaire age weight height goals';
  function readPages(S) {
    const out = [];
    const tpl = G.document.createElement('template');
    const words = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
    if (S.profile.workouts === false) out.push({ key: 'answers', act: 'editAnswers', icon: 'person', tone: 'sky', title: 'Your answers', path: 'Age, weight, height and more', text: 'Your answers', words: ANSWERS_OFF_WORDS });
    for (const pg of PAGES) {
      if (!pg.on(S)) continue;
      out.push({ page: pg.id, icon: pg.icon, tone: pg.tone, title: pg.title, path: pg.line(S), text: pg.title, words: pg.words });
      indexing = true;
      try { tpl.innerHTML = pg.body(S); } catch (e) { tpl.innerHTML = ''; } finally { indexing = false; }
      let section = '';
      for (const el of tpl.content.children) {
        if (el.matches('.rf-list-header')) { section = words(el); continue; }
        if (!el.matches('ul.rf-list')) continue;
        for (const row of el.children) {
          const key = row.getAttribute('data-key');
          for (const b of row.querySelectorAll('.rf-badge')) b.remove();
          const title = row.getAttribute('data-title') || words(row.querySelector('.rf-list-title'));
          if (!key || !title) continue;
          out.push({ page: pg.id, key, icon: pg.icon, tone: pg.tone, title, path: section ? `${pg.title} · ${section}` : pg.title, text: `${words(row)} ${section}`, words: row.getAttribute('data-keywords') || '', of: `${pg.title} ${pg.words}` });
        }
      }
    }
    return out;
  }
  function find(S, words) {
    if (!index) index = readPages(S);
    const out = [], parts = new Set();
    for (const e of index) {
      const own = `${e.text} ${e.words}`;
      if (!e.of) { if (hits(words, own)) { out.push(e); if (e.page) parts.add(e.page); } continue; }
      // A row: by its own words, or by its part's name with at least one of its own ("haptics
      // strength"), unless its part is a result already.
      const ok = hits(words, own) || (!parts.has(e.page) && words.some((w) => has(w, own)) && hits(words, `${own} ${e.of}`));
      // (A part's main switch, named as the part is, is the part's result.)
      if (ok && !(parts.has(e.page) && norm(e.title) === norm(page(e.page).title))) out.push(e);
    }
    return out;
  }
  function results(S) {
    const found = find(S, norm(query).split(' ').filter(Boolean));
    const rows = found.map((e) => U.row({ key: `r-${e.page || 'top'}-${e.key || ''}`, icon: e.icon, tone: e.tone, title: U.esc(e.title), sub: U.esc(e.path), act: e.act || 'setFind', arg: e.act ? null : `${e.page}${e.key ? ` ${e.key}` : ''}`, chevron: true })).join('');
    return `<ul class="rf-list set-menu" data-key="found"${rows ? '' : ' hidden'}>${rows}</ul>
      <p class="set-none t-callout rf-muted" data-key="none"${rows ? ' hidden' : ''}>No settings match. Try dark, kg, vibration or backup.</p>`;
  }
  // What's typed, painted in place: the parts while it's empty, the results otherwise.
  function paint(root) {
    const home = root.querySelector('.set-home'), res = root.querySelector('.set-results');
    if (!home || !res) return;
    const on = !!norm(query);
    if (on) res.innerHTML = results(U.S);
    home.hidden = on;
    res.hidden = !on;
  }
  U.filterSettings = (q) => {
    query = q || '';
    const root = G.document && G.document.getElementById('screen');
    const input = root && root.querySelector('#setQ');
    if (!input) return;
    input.value = query;
    paint(root);
  };

  /* ---------------------------------------------------------------- the pages, one by one */
  // Each part's line on the top page (what's set there now, in a few words), then its page.

  // Workouts: your answers and the level check, then how sets and rests run.
  const ANSWER_WORDS = 'questionnaire goals experience schedule days time minutes equipment weights joints injuries age weight height health conditions arthritis osteoporosis bones fractures diabetes eyes retinopathy blood pressure heart balance';
  function answersRow(S, o) {
    const on = S.profile.workouts !== false;
    return kw(U.row(Object.assign({ key: 'answers', icon: 'pencil', tone: 'indigo', title: 'Your answers', sub: on ? 'Goals, days, time, equipment and more' : 'Age, weight, height and more', act: 'editAnswers', chevron: true }, o)), on ? ANSWER_WORDS : ANSWERS_OFF_WORDS);
  }
  function workoutsLine(S) {
    const p = S.profile, pr = p.prefs;
    const parts = [`${p.days} days a week`, `${p.minutes} min`];
    if (pr.rest && pr.rest !== 'auto') parts.push(`${pr.rest} s rest`);
    if (pr.supersets === false) parts.push('no supersets');
    return parts.join(' · ');
  }
  function workoutsPage(S) {
    const pr = S.profile.prefs;
    return `${menu('workouts', `${answersRow(S)}
        ${kw(U.row({ key: 'level', icon: 'timer', tone: 'green', title: 'Retake the level check', sub: 'Push-ups, plank and curls set where you start', act: 'baselineSheet', chevron: true }), 'baseline test levels push-ups plank curls')}`)}
      ${form('workouts', `${kw(U.sw('Supersets', pr.supersets !== false, 'data-on="setPref" data-k="supersets"', 'Pair exercises that don\'t share muscles'), 'pairs back to back')}
        ${stack('Rest between sets', 'Auto picks it for each exercise', U.seg('setRest', [['auto', 'Auto'], ['60', '60 s'], ['90', '90 s']], String(pr.rest), 'Rest between sets', ' data-on="setRest"'), 'timer seconds minutes pause', 'rest')}`)}
      ${foot('workouts', U.esc(REST_FOOT))}`;
  }

  // Tracking: what the app tracks, then food's settings (with calories on) and walks, runs and rides.
  function trackLine(S) {
    const w = S.profile.workouts !== false;
    const fm = GH.food ? GH.food.mode(S) : 'protein';
    const food = fm === 'full' ? 'calories' : fm === 'protein' ? 'protein' : '';
    return w && food ? `Workouts and ${food}` : w ? 'Workouts' : food ? U.cap(food) : 'Health only';
  }
  function trackPage(S) {
    const workouts = S.profile.workouts !== false;
    const fm = GH.food ? GH.food.mode(S) : 'protein';
    return `${form('track', `${U.sw('Workouts', workouts, 'data-on="setWorkouts"', workouts ? 'Your plan, the workout player and progress' : 'Off. Today shows your health and food.')}
        ${stack('Food', FOOD_SUB[fm] || '', U.seg('setFood', [['off', 'Off'], ['protein', 'Protein'], ['full', 'Calories']], fm, 'Food tracking', ' data-on="setFoodMode"'), 'calories protein nutrition diet', 'foodmode')}`)}
      ${fm === 'full' ? foodSettings(S) : ''}
      ${U.actOptionRows ? actSettings(S) : ''}`;
  }

  // Health Connect: the connection and the background sync, then what goes to and comes from other
  // apps through it (workouts, and meals with calories on).
  function hcLine() {
    if (!(GH.platform && GH.platform.isApp())) return 'In the Android app';
    const st = H().status();
    if (H().connected(st)) {
      const bg = H().background ? H().background() : null;
      return bg && bg.supported && bg.granted && bg.on ? 'On · syncs every 15 minutes' : 'On';
    }
    return st === 'unsupported' ? 'Needs Android 14' : st === 'unavailable' ? 'Unavailable on this phone' : 'Off';
  }
  function hcPage(S) {
    const st = H().status();
    const app = GH.platform && GH.platform.isApp();
    const on = H().connected(st);
    const can = app && !['unsupported', 'unavailable'].includes(st);
    const detail = !app ? 'Android app only' : on ? 'On' : st === 'unsupported' ? 'Needs Android 14' : st === 'unavailable' ? 'Unavailable' : 'Off';
    const missing = on && H().missingTypes ? H().missingTypes(S) : [];
    const food = !!(GH.food && GH.food.full(S));
    const fp = food ? GH.food.prefs(S) : null;
    const canWrite = on && H().canWrite && H().canWrite();
    const canWriteFood = on && H().canWriteFood && H().canWriteFood();
    const others = on ? `${S.profile.workouts !== false ? U.sw('Save workouts to Health Connect', !!(S.health.write !== false && canWrite), 'data-on="hcWriteToggle"', canWrite ? 'Other apps see your Gradient Health workouts' : 'Needs the Exercise permission') : ''}
      ${food ? U.sw('Save meals to Health Connect', fp.hcWrite !== false && canWriteFood, 'data-on="setFoodPref" data-k="hcWrite"', canWriteFood ? 'Other apps see what you log here' : 'Needs the Nutrition permission') : ''}
      ${food ? U.sw('Count food from other apps', fp.hcRead !== false, 'data-on="setFoodPref" data-k="hcRead"', 'Meals logged in other apps add to your day') : ''}`.trim() : '';
    return `${form('hc', `${U.row({ key: 'hc', title: 'Health Connect', sub: on ? 'Choose what it reads and writes' : can ? 'Steps, sleep, heart rate and more from your phone and watch' : '', detail, act: can ? (on ? 'hcManage' : 'hcConnect') : null, chevron: !!app })}
        ${missing.length ? kw(more({ key: 'hc-new', title: 'Allow the new data types', sub: U.esc(missingText(missing)), act: 'hcConnect' }), 'permissions allow new types') : ''}
        ${on && app ? kw(bgRow(), 'background closed every 15 minutes') : ''}`)}
      ${others ? `${head('hc-others', 'With other apps')}${form('hc', others)}` : ''}`;
  }

  // Notifications: the switch, what they're for and when, from src/ui/notify.js's rows, shared out.
  const canNotify = () => !!(G.AndroidBridge && typeof G.AndroidBridge.notifySchedule === 'function');
  const clock = (min) => U.fmtClock(new Date(2000, 0, 1, 0, min).getTime());
  function notifyLine(S) {
    if (!canNotify()) return 'In the Android app';
    const p = S.profile.prefs.notify;
    if (!p || !p.on) return 'Off';
    let min = p.time;
    if (min == null && GH.notify && GH.notify.reminderTime) { const rt = GH.notify.reminderTime(S, Date.now()); min = rt ? rt.min : null; }
    if (min == null) return 'On';
    return `${S.profile.workouts !== false && p.workout !== false ? 'Workout reminders' : 'Reminders'} at ${clock(min)}`;
  }
  // Rows another part draws, shared out into lists by their keys: the first pattern a row's key
  // matches takes it, and one none match goes in the first list, so nothing is ever lost.
  function shareOut(html, patterns) {
    const out = patterns.map(() => []);
    const tpl = G.document.createElement('template');
    tpl.innerHTML = html;
    for (const el of tpl.content.children) {
      const i = patterns.findIndex((re) => re.test(el.getAttribute('data-key') || ''));
      out[Math.max(0, i)].push(el.outerHTML);
    }
    return out.map((x) => x.join(''));
  }
  function notifyPage(S) {
    if (!U.notifyRows) return form('notify', U.row({ key: 'nf-app', title: 'In the Android app', sub: 'Reminders and nudges come from the Gradient Health app on Android.' }));
    const [main, kinds, when] = shareOut(U.notifyRows(S), [/^(sw:notifyOn:|nf-perm$|nf-app$)/, /^sw:notifyKind:/, /^nf-(time|at)$/]);
    const f = U.notifyFoot ? U.notifyFoot(S) : '';
    return `${form('notify', main)}
      ${kinds ? `${head('notify-kinds', 'What they\'re for')}${form('notify', kinds)}` : ''}
      ${when ? form('notify', when, 'notify-when') : ''}
      ${f ? foot('notify', U.esc(f)) : ''}`;
  }

  // AI coach: who answers, then the model on this phone or Claude's key, model and spending.
  const ENGINE_SUB = { device: 'On-device: an AI model on your phone', api: 'Claude: your own API key, model, thinking and spending limits' };
  function coachLine(S) {
    if (S.ai.mode === 'api') {
      if (!(AI() && AI().hasKey())) return 'Claude · add your API key';
      if (!S.ai.consentAt) return 'Claude · waiting for your OK';
      return SP() ? `Claude · ${SP().model(S).short}` : 'Claude';
    }
    // The model in use, once Settings has looked at what's on the phone (the AI coach page does).
    const have = dev.checked ? dev.installed : [];
    const id = !have.length ? null : have.some((x) => x.id === S.ai.deviceModel) ? S.ai.deviceModel : GH.deviceCoach ? GH.deviceCoach.pick(S, have) : have[0].id;
    const name = id ? modelName(id) : null;
    return name ? `On-device · ${name}` : 'On-device';
  }
  function coachPage(S) {
    const engine = S.ai.mode === 'api' ? 'api' : 'device';
    if (engine === 'device' && !dev.checked && !indexing) checkDevice().then(() => { if (U.route.view === 'settings') U.render(); });
    const hasKey = AI() && AI().hasKey();
    const claude = engine === 'api';
    const phone = engine === 'device' ? `${U.modelRows(S)}${dev.installed.length ? kw(more({ key: 'selftest', title: 'Check the on-device AI', sub: 'Starts the model and times a short answer', act: 'aiSelfTest' }), 'test speed problem report') : ''}` : '';
    const rows = [
      claude ? kw(hasKey ? U.row({ key: 'key', icon: 'lock', tone: 'green', title: 'API key saved on this phone', sub: 'Encrypted here, never in backups', act: 'keySheet', detail: 'Change', chevron: true }) : U.row({ key: 'key', icon: 'lock', tone: 'amber', title: 'Add your API key', sub: 'From the Claude Console, starts with sk-ant-', act: 'keySheet', chevron: true }), 'api key anthropic console') : '',
      claude && hasKey && SP() ? kw(U.row({ key: 'claude-model', icon: 'sparkle', tone: 'violet', title: 'Model and thinking', detail: U.esc(`${SP().model(S).short} · ${SP().LEVEL_NAMES[SP().level(S)]}`), act: 'claudeModel', chevron: true }), 'claude model opus sonnet haiku fable thinking effort reasoning') : '',
      claude && hasKey && SP() ? kw(U.row({ key: 'claude-spend', icon: 'card', tone: 'teal', title: 'Spending and usage', sub: U.esc(SP().todayLine(S, U.today())), act: 'claudePage', chevron: true }), 'budget spending limit cost usage money dollars price tokens bill monthly daily') : '',
      claude && hasKey && !S.ai.consentAt ? U.row({ key: 'consent', icon: 'alert', tone: 'amber', title: 'Claude is waiting for your OK', sub: 'Review what it gets before it turns on', act: 'claudeReview', chevron: true }) : '',
      claude && hasKey && S.ai.consentAt ? U.row({ key: 'consent', icon: 'check-circle', tone: 'green', title: 'You allowed Claude to get your summary', sub: 'Turn it off by picking another coach, or withdraw it', act: 'claudeWithdraw', chevron: true }) : '',
      claude && hasKey ? kw(U.row({ key: 'delkey', icon: 'trash', tone: 'rose', title: 'Delete key', act: 'deleteKey' }), 'api key remove') : '',
      U.row({ key: 'claudeapp', icon: 'share', tone: 'violet', title: 'Ask in the Claude app', sub: 'Uses your own Claude plan, no key needed', act: 'askClaudeApp', chevron: true }),
      kw(U.row({ key: 'sent', icon: 'eye', tone: 'sky', title: 'What gets sent', sub: 'The exact summary Claude sees', act: 'previewSheet', chevron: true }), 'privacy data summary'),
    ].join('');
    return `${form('coach', stack('Who answers your questions', ENGINE_SUB[engine], U.seg('setCoach', [['device', 'On-device'], ['api', 'Claude']], engine, 'Coach', ' data-on="setCoachMode"'), 'claude anthropic api key on-device model engine', 'engine'))}
      ${phone ? `${head('coach-phone', 'On this phone')}${form('coach', phone)}` : ''}
      ${head('coach-claude', 'Claude')}
      ${menu('coach', rows)}
      ${foot('coach', `${claude ? 'Claude uses your own Anthropic API key, and each request costs money. Set hard limits under Spending and usage.' : 'The on-device coach runs Qwen3.5 on your phone. It answers from your numbers, works offline and can be wrong. Nothing you ask leaves the phone.'} Claude gets a summary with no name, exact dates or IDs, and only after you allow it.`)}`;
  }

  // Sound and haptics: sound and vibration for timers, then the haptics (src/ui/hapticsui.js).
  const STRENGTH = { light: 'light', medium: 'medium', strong: 'strong' };
  function feelLine(S) {
    const pr = S.profile.prefs;
    return `Sound ${pr.sound !== false ? 'on' : 'off'} · Haptics ${pr.haptics === false ? 'off' : STRENGTH[pr.hapticStrength] || 'medium'}`;
  }
  function feelPage(S) {
    const pr = S.profile.prefs;
    return `${form('feel', `${U.sw('Sound', pr.sound !== false, 'data-on="setPref" data-k="sound"', 'Beeps for the 3-2-1, and when a timer or rest ends')}
        ${U.sw('Vibration', pr.vibrate !== false, 'data-on="setPref" data-k="vibrate"', 'Buzzes for timers and the end of rest')}`)}
      ${head('haptics', 'Haptics')}
      ${form('feel', U.hapticRows ? U.hapticRows(S) : hapticRows(pr))}`;
  }

  // Appearance: the theme, the glass, and the exercise figure's look (with workouts on).
  const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };
  const GLASSES = { auto: 'Auto', liquid: 'Liquid', frosted: 'Frosted', flat: 'Flat' };
  function lookLine(S) {
    const pr = S.profile.prefs;
    return `${THEMES[pr.theme] || 'System'} theme · ${GLASSES[pr.glass] || 'Auto'} glass`;
  }
  function lookPage(S) {
    const pr = S.profile.prefs;
    return `${form('look', `${stack('Theme', '', U.seg('setTheme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], pr.theme || 'system', 'Theme', ' data-on="setTheme"'), 'dark mode light mode night', 'theme')}
        ${kw(U.sw('Increase contrast', !!pr.contrast, 'data-on="setPref" data-k="contrast"'), 'accessibility readable')}
        ${kw(U.sw('Moving background', pr.glowMove !== false, 'data-on="setPref" data-k="glowMove"', 'The colours behind each page drift slowly'), 'animation motion glow')}`)}
      ${form('look', `${stack('Glass effects', 'Auto lightens it while you scroll', U.seg('setGlass', [['auto', 'Auto'], ['liquid', 'Liquid'], ['frosted', 'Frosted'], ['flat', 'Flat']], ['liquid', 'frosted', 'flat'].includes(pr.glass) ? pr.glass : 'auto', 'Glass effects', ' data-on="setGlass"'), 'blur lens transparency performance smooth stutter lag freeze jump', 'glass-fx')}
        <li data-key="glass" data-keywords="blur transparency frosted density"><div class="rf-list-row set-slider"><span class="rf-list-text"><span class="rf-list-title">Glass</span><span class="rf-list-sub">Clear to frosted</span></span><div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="0" max="1" step="0.05" value="${pr.density == null ? 0.5 : pr.density}" aria-label="Glass density" data-on="setDensity"></div></div></div></li>`, 'glass')}
      ${foot('look', 'Liquid is the glass as designed. Frosted keeps the blur without the lens. Flat is the lightest.')}
      ${S.profile.workouts !== false ? form('look', figureRows(pr), 'figure') : ''}`;
  }

  // General: units and when a day starts.
  function generalLine(S) {
    const h = U.rollHour();
    const at = (DAY_STARTS.find(([v]) => Number(v) === h) || [null, `${h} am`])[1];
    return `${S.profile.units === 'kg' ? 'kg, cm' : 'lb, ft, in'} · Day starts at ${at.toLowerCase()}`;
  }
  function generalPage(S) {
    return form('general', `${stack('Units', '', U.seg('setUnits', [['lb', 'lb, ft, in'], ['kg', 'kg, cm']], S.profile.units, 'Units', ' data-on="setUnits"'), 'kg lb pounds kilograms metric imperial cm inches feet weight height', 'units')}
      ${stack('Start of the day', 'Late nights count as the day before until then', U.choice('setRollHour', DAY_STARTS, String(U.rollHour()), 'Start of the day', ' data-on="setRollHour"'), 'midnight night owl day begins rollover', 'daystart')}`);
  }

  // Your data: a copy to keep, restoring one, and starting over.
  function dataPage() {
    return `${menu('data', `${kw(U.row({ key: 'export', icon: 'copy', tone: 'teal', title: 'Copy my data', sub: 'Everything but the API key, as text to keep safe', act: 'exportData' }), 'backup export')}
        ${kw(U.row({ key: 'restore', icon: 'download', tone: 'indigo', title: 'Restore from a copy', act: 'restoreSheet', chevron: true }), 'backup import')}
        ${kw(U.row({ key: 'reset', icon: 'trash', tone: 'rose', title: 'Reset everything', act: 'resetAll' }), 'delete erase start over')}`)}
      ${foot('data', 'Keep the copy in a note or an email to yourself, then paste it into Restore, here or on a new phone.')}`;
  }

  // About: updates, then how it works, the credits and the scroll diagnostics.
  const version = () => (GH.platform && GH.platform.appVersion()) || GH.VERSION || 'web';
  function aboutLine() { return `Version ${String(version()).split(' ')[0]}`; }
  function aboutPage(S) {
    return `${form('about', U.updateRows ? U.updateRows(S) : U.row({ key: 'version', title: 'Version', detail: U.esc(version()) }))}
      ${menu('about', `${kw(U.row({ key: 'science', icon: 'library', tone: 'violet', title: 'How it works', sub: 'The research behind every rule', act: 'openScience', chevron: true }), 'science research studies rules why')}
        ${kw(U.row({ key: 'licenses', icon: 'doc', tone: 'indigo', title: 'Open-source licenses', act: 'licensesSheet', chevron: true }), 'credits open source')}
        ${kw(U.row({ key: 'refract', lead: U.refractMark('sm'), title: 'Built with Refract', sub: 'The liquid glass design system behind every screen', act: 'licensesSheet', chevron: true }), 'refract design system glass credits')}
        ${kw(U.row({ key: 'diag', icon: 'bolt', tone: 'amber', title: 'Scroll diagnostics', sub: 'For the developer, if a scroll freezes or jumps', act: 'scrollDiag', chevron: true }), 'scroll freeze jump stutter lag debug diagnostics report')}`)}
      ${foot('about', 'Built-in foods from the USDA\'s nutrient database. Not medical advice. Check with a doctor first if you have a condition or injury.')}`;
  }

  /* ---------------------------------------------------------------- sound and haptics */
  // Until the haptics rows (U.hapticRows, src/ui/hapticsui.js) are there: the switch, the strength
  // and a few to try at it.
  function hapticRows(pr) {
    const tries = [['tap', 'Tap'], ['success', 'Success'], ['warning', 'Warning'], ['celebrate', 'Celebrate']];
    return `${U.sw('Haptic feedback', pr.haptics !== false, 'data-on="setPref" data-k="haptics"', GH.platform && GH.platform.hapticsSystemEnabled && !GH.platform.hapticsSystemEnabled() ? 'Touch feedback is off in your phone\'s settings, so taps won\'t buzz. Workout alerts still will.' : 'A click for buttons and switches, and a different feel for sets, timers and warnings')}
      ${pr.haptics !== false ? `${stack('Haptic strength', '', U.seg('setHaptic', [['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']], pr.hapticStrength || 'medium', 'Haptic strength', ' data-on="setHapticStrength"'), '', 'hstrength')}
      ${stack('Try it', 'Each one at this strength', `<div class="ob-chips">${tries.map(([k, t]) => `<button type="button" class="rf-chip" data-act="tryHaptic" data-arg="${k}">${t}</button>`).join('')}</div>`, '', 'htry')}` : ''}`;
  }

  /* ---------------------------------------------------------------- exercise figure */
  // Skin tones and shirt colours for the 3D figure (the names are for screen readers).
  const SKINS = [['porcelain', '#efcfbc', 'Light'], ['sand', '#d9a982', 'Medium light'], ['olive', '#b17c4e', 'Medium'], ['umber', '#7d4c2d', 'Medium dark'], ['ebony', '#482c1c', 'Dark']];
  const SHIRTS = [['#3b5bdb', 'Blue'], ['#0c8599', 'Teal'], ['#2b8a3e', 'Green'], ['#c92a2a', 'Red'], ['#343a40', 'Charcoal']];
  function figureRows(pr) {
    const can = !U.canDraw3d || U.canDraw3d();
    const is3d = (pr.figure || '3d') === '3d' && can;
    const sub = !can ? 'This phone can\'t draw 3D, so it uses the simple figure' : is3d ? 'A lifelike person. Drag it to turn it around.' : 'A flat outline that\'s lighter on the battery';
    const swatches = (act, list, cur, label) => `<div class="swatches" role="group" aria-label="${label}">${list.map(([v, hex, name]) => `<button type="button" class="swatch" data-act="${act}" data-arg="${v}" aria-label="${U.esc(name || hex)}" aria-pressed="${v === cur ? 'true' : 'false'}" style="--sw:${hex}"></button>`).join('')}</div>`;
    return `<li data-key="figure" data-keywords="3d figure animation person avatar"><div class="rf-list-row set-stack"><span class="rf-list-text"><span class="rf-list-title">Exercise figure</span><span class="rf-list-sub">${sub}</span></span>${can ? U.seg('setFigure', [['3d', '3D'], ['flat', 'Simple']], is3d ? '3d' : 'flat', 'Exercise figure', ' data-on="setFigure"') : ''}</div></li>
      ${is3d ? `<li data-key="figlook" data-title="Skin tone and shirt" data-keywords="exercise figure skin tone shirt colour color"><div class="rf-list-row set-fig-row"><div class="set-fig" aria-hidden="true">${figPreview(pr)}</div><div class="set-fig-pick">
        <span class="rf-list-title">Skin tone</span>${swatches('setFigSkin', SKINS, pr.figSkin || 'sand', 'Skin tone')}
        <span class="rf-list-title">Shirt</span>${swatches('setFigShirt', SHIRTS.map(([hex, n]) => [hex, hex, n]), pr.figShirt || SHIRTS[0][0], 'Shirt colour')}
      </div></div></li>` : ''}`;
  }
  // A still of the figure in the chosen look, kept on the phone with the others (src/ui/stills.js),
  // so a look seen before shows at once. A new one takes a moment to draw, so meanwhile the last one
  // shows (dimmed), and the new one is swapped in once it's drawn.
  let lastPreview = '';
  function figPreview(pr) {
    const m = GH.moves.MOVES.curl_std || GH.moves.MOVES.sq_bw;
    if (!m || !U.stills || indexing) return '<span class="set-fig-wait"></span>';
    const look = U.stills.look(96, 120), k = U.stills.key(m, look);
    const img = (url, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${U.esc(url)}" alt="" width="96" height="120">`;
    const ready = U.stills.want(m, look, (url) => {
      const box = document.querySelector('#screen .set-fig');
      // (Not over a newer look picked meanwhile.)
      if (!url || !box || U.stills.key(m, U.stills.look(96, 120)) !== k) return;
      lastPreview = url;
      box.innerHTML = img(url);
    });
    if (ready) { lastPreview = ready; return img(ready); }
    return lastPreview ? img(lastPreview, 'is-stale') : '<span class="set-fig-wait"></span>';
  }
  U.on.setFigure = (el, ev, v) => { U.S.profile.prefs.figure = v; U.save(); U.render(); };
  U.act.setFigSkin = (el) => { U.S.profile.prefs.figSkin = el.dataset.arg; U.save(); U.haptic('select'); U.render(); };
  U.act.setFigShirt = (el) => { U.S.profile.prefs.figShirt = el.dataset.arg; U.save(); U.haptic('select'); U.render(); };

  /* ---------------------------------------------------------------- background sync */
  // Health Connect read every 15 minutes with the app closed (see GH.health.background): its switch
  // and what it's doing, or why it can't.
  const BG_TITLE = 'Sync in the background';
  function bgRow() {
    const bg = H().background ? H().background() : null;
    if (!bg) return '';
    if (!bg.supported) return U.row({ key: 'hc-bg', title: BG_TITLE, sub: 'Needs Android 15 or a newer Health Connect' });
    if (!bg.granted) return `<li data-key="hc-bg"><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${BG_TITLE}</span><span class="rf-list-sub">Needs permission</span></span><button type="button" class="rf-btn" data-size="sm" data-act="hcBgAllow">Allow</button></div></li>`;
    return U.sw(BG_TITLE, !!bg.on, 'data-on="hcBgToggle"', bgSub(bg));
  }
  function bgSub(bg, now) {
    if (!bg.on) return 'Off. The app reads Health Connect while it\'s open.';
    const at = bg.lastOk;
    if (bg.error && bg.lastRun && (!at || bg.lastRun > at)) return 'Every 15 minutes · the last try didn\'t work';
    if (!at) return 'Every 15 minutes';
    const today = new Date(now || Date.now()).toDateString() === new Date(at).toDateString();
    return `Every 15 minutes · last ${today ? `at ${U.fmtClock(at)}` : U.ago(at, now)}`;
  }
  U.on.hcBgToggle = (el, ev, v) => {
    H().setBackground(!!v);
    U.render();
  };
  U.act.hcBgAllow = async () => {
    const bg = await H().requestBackground();
    U.render();
    if (bg.granted) U.toast('Background sync is on', 'positive', 'The app reads Health Connect every 15 minutes, even when closed.');
    else U.toast('Not allowed yet', 'caution', 'Turn on background access for Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() });
  };
  // A background read just finished (or its state changed): fold the reads in while the app is open,
  // and keep this row current.
  if (H() && H().onBackground) {
    H().onBackground(() => {
      const S = U.S;
      if (S && S.profile && S.profile.onboarded && H().drainPending(S, Date.now())) { H().afterSync(S, U.today()); U.save(); }
      if (U.route && U.route.view === 'settings' && U.render) U.render();
    });
  }

  /* ---------------------------------------------------------------- what you track */
  const FOOD_SUB = { off: 'Nothing about food', protein: 'A protein goal with one-tap logging', full: 'Calories, macros and meals, at the top of Health' };
  const TYPE_NAMES = { heartRate: 'heart rate', activeKcal: 'active calories', distance: 'distance', nutrition: 'nutrition', writeNutrition: 'saving meals' };
  function missingText(list) {
    const names = list.map((t) => TYPE_NAMES[t] || t);
    return U.cap(names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]);
  }
  // Food, on Tracking with calories on: the goal and what the target is worked out from, then meal
  // times and online search. (Saving meals to Health Connect and counting other apps' food are on the
  // Health Connect page, with the rest of what goes through it.)
  function foodSettings(S) {
    const p = S.profile;
    const fp = GH.food.prefs(S);
    const t = GH.food.targets(S, U.today());
    return `${head('food', 'Food')}
      ${form('track', `${stack('Weight goal', '', U.seg('setWGoal', [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']], p.weightGoal || 'maintain', 'Weight goal', ' data-on="setWeightGoal"'), 'lose maintain gain weight', 'wgoal')}
        ${p.weightGoal === 'lose' ? stack('Pace', 'Of your body weight a week. Slower keeps more muscle.', U.seg('setPace', [['0.25', '0.25%'], ['0.5', '0.5%'], ['0.75', '0.75%'], ['1', '1%']], String(fp.pace), 'Pace', ' data-on="setFoodPace"'), 'how fast lose speed', 'pace') : ''}
        ${stack('Activity', 'How much you move in a day, workouts aside', U.choice('setFoodAct', [['auto', 'From steps'], ['light', 'Light'], ['moderate', 'Moderate'], ['active', 'Active']], fp.activity || 'auto', 'Activity', ' data-on="setFoodAct"'), 'steps active moving calories burn', 'foodact')}
        ${kw(more({ key: 'meal-times', title: 'Meal times', sub: U.esc(U.mealTimesLine ? U.mealTimesLine(S) : ''), act: 'foodMealTimes' }), 'meals breakfast lunch dinner snacks clock time')}
        ${kw(U.sw('Online search and barcodes', !!fp.online, 'data-on="setFoodPref" data-k="online"', 'From Open Food Facts. Only barcodes and search words are sent.'), 'open food facts scan barcode')}
        ${stack('Sex', 'For the calorie estimate. Skip it to use an average.', U.seg('setSex', [['female', 'Female'], ['male', 'Male'], ['', 'Skip']], p.sex || '', 'Sex', ' data-on="setSex"'), 'female male', 'sex')}`)}
      ${foot('track', `${t ? `Your target is about ${U.num(t.kcal)} kcal a day${t.learned ? ', tuned to your own logs and weight' : ''}.` : 'Add your weight and height to get a calorie target.'} ${U.whyLink ? U.foodKit.link('openScience', 'calories', 'How it\'s worked out') : ''}`)}`;
  }
  U.on.setWorkouts = async (el, ev, v) => {
    const S = U.S;
    if (!v && S.active) { U.revertSwitch(el); U.toast('Finish or discard the workout in progress first', 'caution'); return; }
    S.profile.workouts = !!v;
    U.save();
    U.render();
    U.toast(v ? 'Workouts are back on' : 'Workouts are off', 'neutral', v ? 'Your plan picks up where it left off.' : 'Your plan and progress are kept.');
  };
  U.on.setFoodMode = async (el, ev, v) => {
    const S = U.S;
    const before = GH.food.mode(S);
    GH.food.setMode(S, v);
    U.save();
    U.render();
    if (v === 'full' && before !== 'full') {
      U.toast('Calorie tracking is on', 'positive', 'Your food is at the top of Health, and on Today.');
      // Saving meals to Health Connect needs the nutrition permissions.
      if (H().connected(H().status()) && H().missingTypes && H().missingTypes(S).some((t) => t === 'nutrition' || t === 'writeNutrition')) {
        const ok = await U.confirm('Share food with Health Connect?', 'Meals you log go to Health Connect, and meals from other apps count toward your day.', 'Allow');
        if (ok) { await H().request(true); U.render(); }
      }
    }
  };
  U.on.setWeightGoal = (el, ev, v) => { U.S.profile.weightGoal = v; U.save(); U.render(); };
  U.on.setFoodPace = (el, ev, v) => { GH.food.prefs(U.S).pace = Number(v) || 0.5; U.save(); U.render(); };
  U.on.setFoodAct = (el, ev, v) => { if (v !== 'auto' && !GH.food.ACTIVITY[v]) return; GH.food.prefs(U.S).activity = v; U.save(); U.render(); };
  U.on.setSex = (el, ev, v) => { U.S.profile.sex = v || null; U.save(); U.render(); };
  U.on.setFoodPref = async (el, ev, v) => {
    const S = U.S;
    const k = el.dataset.k;
    const fp = GH.food.prefs(S);
    if (k === 'hcWrite' && v && !(H().canWriteFood && H().canWriteFood())) {
      await H().request(true);
      if (!(H().canWriteFood && H().canWriteFood())) { U.revertSwitch(el); U.toast('Not allowed yet', 'caution', 'Turn on Nutrition under Gradient Health in Health Connect.', { label: 'Open', onClick: () => H().openSettings() }); return; }
    }
    fp[k] = !!v;
    U.save();
    if (k === 'hcWrite' && v && H().writeFood) H().writeFood(S);
    if (k === 'hcRead' && v) U.syncHealth('manual');
    U.render();
  };

  // Each answer opens on its own screen with Save, so nothing else has to be gone through again.
  const STEP_ICON = { about: ['person', 'sky'], conditions: ['heart', 'rose'], goals: ['flag', 'green'], experience: ['chart', 'indigo'], schedule: ['calendar', 'teal'], equipment: ['bag', 'amber'], body: ['shuffle', 'coral'], nutrition: ['food', 'green'], food: ['food', 'green'] };
  // One row per set-up screen, with its current answer: on You, and in this sheet from Settings.
  U.answerRows = (p) => U.editableSteps().map((st) => { const [ic, tone] = STEP_ICON[st.id] || ['pencil', 'sky']; return U.row({ key: `ans-${st.id}`, icon: ic, tone, title: U.esc(st.title), sub: U.esc(U.answerSummary(st.id, p)), act: 'editStep', arg: st.id, chevron: true }); }).join('');
  U.act.editAnswers = () => {
    U.sheet({ title: 'Your answers', size: 'auto', body: `<p class="t-footnote rf-muted sheet-lead">Your plan updates when you save a change.</p>
      <ul class="rf-list">${U.answerRows(U.S.profile)}</ul>` });
  };
  U.act.editStep = (el) => { U.closeSheets(); U.haptic('nav'); U.editAnswers(el.dataset.arg); };
  U.act.editEquipment = () => { U.haptic('nav'); U.editAnswers('equipment'); };
  U.act.openPrivacyView = () => U.open('privacy');
  U.act.openLink = (el, ev) => { if (ev && ev.preventDefault) ev.preventDefault(); const url = el.dataset.arg; if (url && /^https:\/\//.test(url) && GH.platform) { U.haptic('tap'); GH.platform.openUrl(url); } };
  U.on.setPref = (el, ev, v) => {
    const k = el.dataset.k;
    U.S.profile.prefs[k] = !!v;
    U.applyPrefs();
    U.save();
    if (k === 'haptics') { if (v) U.haptic('toggleOn'); U.render(); }
    if (k === 'supersets') U.render();
  };
  // A new strength plays a tap at it, the haptic felt most often. Try it has the bigger ones.
  U.on.setHapticStrength = (el, ev, v) => { U.S.profile.prefs.hapticStrength = v; U.applyPrefs(); U.save(); U.haptic('tap'); };
  U.act.tryHaptic = (el) => U.haptic(el.dataset.arg);
  U.on.setRest = (el, ev, v) => { U.S.profile.prefs.rest = v === 'auto' ? 'auto' : Number(v); U.save(); };
  U.on.setTheme = (el, ev, v) => { U.S.profile.prefs.theme = v; U.applyPrefs(); U.save(); };
  U.on.setGlass = (el, ev, v) => { U.S.profile.prefs.glass = ['liquid', 'frosted', 'flat'].includes(v) ? v : 'auto'; U.applyPrefs(); U.save(); };
  U.on.setDensity = (el, ev, v) => { U.S.profile.prefs.density = v; U.applyPrefs(); U.save(); };
  U.on.setUnits = (el, ev, v) => { convertUnits(U.S, v); U.commit(); };
  // The hour a new day starts: until then, a late night still counts as the day before.
  U.on.setRollHour = (el, ev, v) => {
    const h = Number(v);
    if (!(h >= 0 && h <= 23)) return;
    U.S.profile.prefs.rollHour = h;
    U.commit();
  };
  // Switching units converts the equipment weights to the nearest real sizes.
  function convertUnits(S, to) {
    if (S.profile.units === to) return;
    const f = to === 'kg' ? 1 / B().LB_PER_KG : B().LB_PER_KG;
    const sizes = { db: { lb: [2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60], kg: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 17.5, 20, 22.5, 25, 27.5, 30] }, kb: { lb: [10, 15, 18, 20, 26, 35, 44, 53, 62, 70], kg: [4, 6, 8, 10, 12, 16, 20, 24, 28, 32] } };
    for (const k of ['db', 'kb']) {
      const list = sizes[k][to];
      S.profile.equipment[k] = [...new Set((S.profile.equipment[k] || []).map((x) => list.reduce((a, c) => (Math.abs(c - x * f) < Math.abs(a - x * f) ? c : a), list[0])))].sort((a, b) => a - b);
    }
    if (S.profile.equipment.ballLb) S.profile.equipment.ballLb = Math.round(S.profile.equipment.ballLb * f);
    if (S.profile.gym) S.profile.gym.dbMax = B().convertDbMax(S.profile.gym.dbMax, to);
    S.profile.units = to;
  }

  /* ---------------------------------------------------------------- walks, runs and rides */
  // Under What you track: how an outdoor activity records (the start sheet's rows, auto-pause for each
  // kind and the spoken splits; src/ui/actlive.js) and the map behind its route (src/ui/activity.js).
  // The map pieces a map has downloaded are kept on the phone (src/ui/activity.js, U.mapPieces): Clear
  // saved maps deletes them.
  function actSettings(S) {
    return `${head('acts', 'Walks, runs and rides')}
      ${form('track', `${kw(U.actOptionRows(S), 'activity activities outdoor gps record running walking hiking cycling bike stops')}
        ${kw(U.sw('Maps', !!(U.actMapsOn && U.actMapsOn()), 'data-on="actMapsPref"', 'Your route on a map from OpenFreeMap'), 'map openfreemap streets route')}
        ${kw(U.row({ key: 'map-pieces', cls: 'set-do', title: 'Clear saved maps', sub: 'Maps you\'ve seen are kept here, to open fast and offline', act: 'mapPiecesClear' }), 'map cache offline storage space delete')}`)}
      ${foot('track', 'OpenFreeMap sees the area a map shows. With maps off, only your route shows, drawn on this phone.')}`;
  }
  U.act.mapPiecesClear = async () => {
    const ok = U.mapPieces ? await U.mapPieces.clear() : false;
    U.haptic(ok ? 'remove' : 'deny');
    U.toast(ok ? 'Saved maps cleared' : 'No saved maps', 'neutral', ok ? 'Maps download again the next time they show.' : undefined);
  };

  /* ---------------------------------------------------------------- licenses */
  // What ships in the app (or is downloaded or looked up by it) and under which license.
  const LICENSES = [
    ['Host Grotesk, Geist Mono', 'Fonts', 'SIL Open Font License 1.1'],
    ['three.js', '3D figure', 'MIT'],
    ['Anthropic TypeScript SDK', 'The Claude coach', 'MIT'],
    ['wllama and llama.cpp', 'On-device AI runtime', 'MIT'],
    ['Qwen3.5 (and Qwen2.5, if one is still on the phone)', 'On-device AI models, downloaded on request', 'Apache 2.0'],
    ['zxing-wasm', 'Barcode reading', 'MIT'],
    ['ZXing C++', 'Barcode reading', 'Apache 2.0'],
    ['USDA SR28', 'Built-in food list', 'Public domain'],
    ['Open Food Facts', 'Online food search, when it\'s on', 'Open Database License'],
    ['MapLibre GL JS', 'Activity maps', 'BSD 3-Clause'],
    ['OpenStreetMap contributors and OpenMapTiles, served by OpenFreeMap', 'Map data, when maps are on', 'Open Database License and CC BY 4.0'],
  ];
  // The design system first: everything on screen is made of it. Its mark comes apart once as the
  // sheet opens.
  const refractCredit = () => {
    const v = G.Refract && G.Refract.version ? String(G.Refract.version).replace(/\.0$/, '') : '';
    return `<div class="credit-refract" data-key="credit-refract">${U.refractMark('lg', true)}<div class="credit-text"><p class="t-headline">Built with Refract${v ? ` ${U.esc(v)}` : ''}</p><p class="t-footnote rf-muted">The liquid glass design system behind every screen: its glass, controls, motion, icons and type.</p></div></div>`;
  };
  U.act.licensesSheet = () => U.sheet({
    title: 'Open-source licenses', size: 'auto',
    body: `${refractCredit()}<ul class="rf-list">${LICENSES.map(([name, what, lic]) => U.row({ title: U.esc(name), sub: U.esc(`${what} · ${lic}`) })).join('')}</ul>
      <p class="t-footnote rf-muted sheet-lead">Thanks to everyone who made these. The full license texts ship with the source code.</p>`,
  });

  /* ---------------------------------------------------------------- days and time */
  // What the day chips mean right now.
  function daysNote(d) {
    if (d.note === 'max') return 'Six workout days is the most: one day stays for rest.';
    if (d.weekdays.length >= 2) return `Your ${d.weekdays.length} workouts land on these days. + and − add or drop a day.`;
    if (d.weekdays.length === 1) return 'Pick at least one more day, or none for a spread that suits your plan.';
    return `Leave these empty for a spread that suits ${d.days} days, or pick your own.`;
  }
  U.daysNote = daysNote;
  U.act.daysSheet = () => {
    const p = U.S.profile;
    // Workouts a week and the days picked stay in step (brain.pickWeekday / setWorkoutDays).
    const d = { days: p.days, weekdays: Array.isArray(p.weekdays) ? p.weekdays.slice() : [], minutes: p.minutes, lightDays: p.lightDays !== false, note: null };
    const body = () => `<div class="sheet-pad">
        <p class="t-headline">Workouts a week</p><div class="ob-center">${U.stepper('dsDays', d.days, 2, 6, 'Workouts a week', 'data-on="dsDays"')}</div>
        <p class="t-headline">Which days (optional)</p><div class="ob-chips">${DAYS.map((n, i) => `<button type="button" class="rf-chip" aria-pressed="${d.weekdays.includes(i)}" data-on="dsWd" data-v="${i}"><span class="rf-chip-check" data-icon="check"></span>${n}</button>`).join('')}</div>
        <p class="t-footnote rf-muted" id="dsDaysNote">${U.esc(daysNote(d))}</p>
        <p class="t-headline">Minutes per workout: <span id="dsMinOut" class="rf-num">${d.minutes}</span></p>
        <div class="rf-slider"><div class="rf-slider-control"><input class="rf-slider-input" type="range" min="10" max="60" step="5" value="${d.minutes}" aria-label="Minutes per workout" data-on="dsMin" id="dsMin"></div></div>
        <ul class="rf-list sheet-gap">${U.sw('Light days', d.lightDays, 'data-on="dsLight"', 'Walk and mobility on off days')}</ul>
        <p class="t-footnote rf-muted">If this week has started, new days begin next Monday. Time changes apply from today.</p>
      </div>`;
    const ctl = U.sheet({ title: 'Days and time', size: 'auto', body: body(), action: { label: 'Save', act: 'daysSave' } });
    ctl.el.addEventListener('input', (e) => { if (e.target.id === 'dsMin') { const o = ctl.el.querySelector('#dsMinOut'); if (o) o.textContent = e.target.value; } });
    const redraw = () => { if (!ctl.closed) ctl.update(body()); };
    U.on.dsDays = (el, ev, v) => { Object.assign(d, B().setWorkoutDays(d.weekdays, Math.round(v))); redraw(); };
    U.on.dsWd = (el, ev, v) => {
      Object.assign(d, B().pickWeekday(d.days, d.weekdays, Number(el.dataset.v), !!v));
      if (d.note === 'max') U.haptic('warning');
      redraw();
    };
    U.on.dsMin = (el, ev, v) => { d.minutes = v; };
    U.on.dsLight = (el, ev, v) => { d.lightDays = !!v; };
    U.act.daysSave = () => {
      const S = U.S;
      const res = B().updateSettings(S, U.today(), { days: d.days, weekdays: d.weekdays.length >= 2 ? d.weekdays.slice().sort((a, b) => a - b) : null, minutes: d.minutes, lightDays: d.lightDays });
      ctl.close('ok');
      U.commit();
      U.haptic('save');
      U.toast('Saved', 'positive', res && res.shape && res.from > U.today() ? 'New days start next Monday.' : undefined);
    };
  };

  /* ---------------------------------------------------------------- baseline */
  U.act.baselineSheet = () => {
    const eq = U.S.profile.equipment;
    const curls = (eq.db && eq.db.length) || eq.band;
    U.sheet({
      title: 'Level check', size: 'auto',
      body: `<div class="sheet-pad ob-fields">
        <div class="rf-field"><label class="rf-field-label" for="bPush">Push-ups in a row</label><div class="rf-field-control"><input class="rf-input" id="bPush" type="number" inputmode="numeric" placeholder="Leave blank to skip"></div></div>
        <ul class="rf-list">${U.sw('On my knees', false, 'id="bKnees"')}</ul>
        <div class="rf-field"><label class="rf-field-label" for="bPlank">Plank hold (seconds)</label><div class="rf-field-control"><input class="rf-input" id="bPlank" type="number" inputmode="numeric" placeholder="Leave blank to skip"></div></div>
        ${curls ? '<div class="ob-row2"><div class="rf-field"><label class="rf-field-label" for="bCL">Curls, left</label><div class="rf-field-control"><input class="rf-input" id="bCL" type="number" inputmode="numeric"></div></div><div class="rf-field"><label class="rf-field-label" for="bCR">Curls, right</label><div class="rf-field-control"><input class="rf-input" id="bCR" type="number" inputmode="numeric"></div></div></div>' : ''}
        <p class="t-footnote rf-muted">Each result sets that exercise's level. The curls also count as a left vs right test.</p></div>`,
      action: { label: 'Save', act: 'baselineSave' },
    });
  };
  U.act.baselineSave = () => {
    const num = (id) => { const el = document.getElementById(id); const v = el ? parseInt(el.value, 10) : NaN; return isFinite(v) && v >= 0 ? v : null; };
    const b = {};
    const push = num('bPush');
    if (push != null) { b.pushups = push; b.knees = !!(document.getElementById('bKnees') || {}).checked; }
    const plank = num('bPlank');
    if (plank) b.plankSec = plank;
    const l = num('bCL'), r = num('bCR');
    if (l && r) { b.curlL = l; b.curlR = r; }
    const t = U.topSheet(); if (t) t.close('ok');
    if (!Object.keys(b).length) return;
    B().applyBaseline(U.S, b, U.today());
    U.commit();
    U.haptic('save');
    U.toast('Level check saved', 'positive', 'Your starting levels are updated.');
  };

  /* ---------------------------------------------------------------- coach */
  U.on.setCoachMode = async (el, ev, v) => {
    const S = U.S;
    const before = S.ai.mode;
    if (v === 'api' && AI() && AI().hasKey() && !(await U.claudeConsent())) { S.ai.mode = before === 'api' ? 'device' : before; U.save(); U.render(); return; }
    S.ai.mode = v === 'api' ? 'api' : 'device';
    S.ai.enabled = S.ai.mode === 'api';
    U.save();
    setTimeout(() => U.render(), 220);
    if (S.ai.mode === 'api' && AI() && !AI().hasKey()) setTimeout(() => U.act.keySheet(), 400);
    if (S.ai.mode === 'device') checkDevice().then(() => U.render());
  };

  // Claude gets a summary of the person's health data, so it only turns on after they've seen what
  // goes and said yes. Resolves true once allowed (remembered), false if they said no.
  U.claudeConsent = () => new Promise((resolve) => {
    const S = U.S;
    if (S.ai.consentAt) { resolve(true); return; }
    let answered = false;
    const done = (ok) => {
      if (answered) return;
      answered = true;
      if (ok) { S.ai.consentAt = Date.now(); U.save(true); }
      resolve(ok);
    };
    const food = GH.food && GH.food.full(S);
    const ctl = U.sheet({
      title: 'Share your data with Claude?', size: 'full', cls: 'consent-sheet',
      body: `<div class="sheet-prose">
        <p class="t-body">Claude is Anthropic's AI. Gradient Health sends Anthropic a summary of your data with each question, suggestion or plan check, and weekly for your report.</p>
        <p class="t-headline">The summary holds</p>
        <ul class="plain-list">
          <li>An age range (not your age), and your sex if you gave it</li>
          <li>Your goals, experience, schedule and equipment, and joints you're careful with</li>
          <li>Averages and trends of your sleep, steps, heart rate, HRV, active calories and weight</li>
          <li>Your training: workouts done, sets, levels and how they felt</li>
          ${food ? '<li>Your calorie target and what you ate on average (not the foods)</li>' : ''}
          <li>To check your plan (here or in the weekly report): next week's plan, its exercises, sets and minutes</li>
        </ul>
        <p class="t-body">Never your name, email, exact dates, device IDs or the health conditions you plan around. Anthropic's privacy policy applies there. Turn Claude off any time in Settings.</p>
        <div class="btn-row"><button type="button" class="rf-btn" data-variant="plain" data-act="previewSheet">${U.icon('eye')}See exactly what gets sent</button><button type="button" class="rf-btn" data-variant="plain" data-act="privacySheet">${U.icon('lock')}Privacy policy</button></div>
        <div class="btn-row fd-actions"><button type="button" class="rf-btn rf-glass" data-variant="tinted" data-size="lg" data-act="claudeAllow">Allow</button><button type="button" class="rf-btn" data-size="lg" data-act="claudeDeny">Not now</button></div>
      </div>`,
      onClose: () => done(false),
    });
    U.act.claudeAllow = () => { done(true); U.haptic('success'); ctl.close('ok'); };
    U.act.claudeDeny = () => { done(false); ctl.close('cancel'); };
  });
  U.act.claudeReview = async () => { if (await U.claudeConsent()) { U.S.ai.enabled = U.S.ai.mode === 'api'; U.save(true); U.render(); U.toast('Claude is on', 'positive'); } };
  U.act.claudeWithdraw = async () => {
    if (!(await U.confirm('Stop sending your data to Claude?', 'Claude turns off and the on-device coach takes over. Nothing more is sent, and your reports and chats stay on this phone.', 'Stop', 'critical'))) return;
    const S = U.S;
    S.ai.consentAt = null;
    S.ai.enabled = false;
    if (S.ai.mode === 'api') S.ai.mode = 'device';
    U.save(true);
    U.render();
  };

  /* ---------------------------------------------------------------- on-device model */
  // What's on the phone and what's downloading, from GH.llm (loaded on demand). Progress events
  // redraw Settings and the chat sheet a few times a second at most.
  const dev = { checked: false, available: { ok: false, reason: '' }, offered: [], all: [], recommended: null, installed: [], progress: {}, free: null };
  let devLoading = null, unsub = null, redrawAt = 0, redrawTimer = 0;
  U.deviceState = () => dev;
  function redraw() {
    const go = () => { redrawAt = Date.now(); redrawTimer = 0; if (U.route.view === 'settings') U.render(); if (U.refreshChat) U.refreshChat(); };
    const wait = 250 - (Date.now() - redrawAt);
    if (wait <= 0) go(); else if (!redrawTimer) redrawTimer = setTimeout(go, wait);
  }
  function checkDevice() {
    if (devLoading) return devLoading;
    devLoading = (async () => {
      try {
        const llm = await GH.lazy('llm');
        dev.available = llm.available();
        dev.offered = llm.offered();
        dev.all = llm.MODELS.slice();
        dev.recommended = llm.recommended ? (llm.recommended() || {}).id || null : null;
        dev.installed = dev.available.ok || (GH.platform && GH.platform.isApp()) ? await llm.installed() : [];
        dev.free = llm.freeSpace ? llm.freeSpace() : null;
        if (!unsub) {
          unsub = llm.onProgress((p) => {
            if (!p || !p.id) return;
            if (p.state === 'done' || p.state === 'cancelled') {
              delete dev.progress[p.id];
              if (p.state === 'done') {
                llm.installed().then((x) => {
                  dev.installed = x;
                  // The new model takes over from none, or from an older one picked (or set) in 1.2.
                  const was = U.S && dev.all.find((m) => m.id === U.S.ai.deviceModel);
                  const got = dev.all.find((m) => m.id === p.id);
                  if (U.S && got && !got.legacy && (!U.S.ai.deviceModel || (was && was.legacy))) { U.S.ai.deviceModel = p.id; U.save(); }
                  redraw();
                  U.toast('The on-device model is ready', 'positive', 'Ask it anything about your numbers.');
                });
              }
            } else dev.progress[p.id] = p;
            redraw();
          });
        }
        for (const x of llm.status ? llm.status() : []) if (x && x.id && !['done', 'cancelled'].includes(x.state)) dev.progress[x.id] = x;
      } catch (e) {
        dev.available = { ok: false, reason: 'On-device AI couldn\'t be loaded here.' };
      }
      dev.checked = true;
      devLoading = null;
      return dev;
    })();
    return devLoading;
  }
  U.checkDevice = checkDevice;
  const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
  const BLURB = { fast: 'Quickest, for simple questions', balanced: 'Good answers at a steady pace', best: 'The best answers, noticeably slower' };
  // How fast a model answered on this phone, once it has: "about 9 words a second".
  const pace = (S, id) => { const t = S.ai.speed && S.ai.speed[id]; return t > 0 ? `about ${Math.max(1, Math.round(t * 0.75))} words a second here` : ''; };
  const modelIcon = (m) => `<span class="rf-list-icon" data-tone="${m.legacy ? 'neutral' : m.tier === 'best' ? 'indigo' : m.tier === 'fast' ? 'teal' : 'violet'}">${U.icon(m.tier === 'fast' ? 'bolt' : m.tier === 'best' ? 'sparkle' : 'chip')}</span>`;
  // One row per model: the sizes this phone can run (download, progress, or use and delete), then any
  // older model still on it. { compact } leaves out the delete buttons and the Wi-Fi switch's footnote.
  U.modelRows = (S, o) => {
    if (!dev.checked) return `<li><div class="rf-list-row"><span class="rf-spinner" data-size="sm"><i></i></span><span class="rf-list-text"><span class="rf-list-sub">Checking this phone…</span></span></div></li>`;
    if (!dev.available.ok) return `<li><div class="rf-list-row"><span class="rf-list-icon" data-tone="amber">${U.icon('info')}</span><span class="rf-list-text"><span class="rf-list-sub">${U.esc(dev.available.reason)}</span></span></div></li>`;
    const compact = !!(o && o.compact) || !!(U.topSheet() && U.topSheet().el.classList.contains('chat-sheet'));
    const use = S.ai.deviceModel;
    const haveIds = dev.installed.map((x) => x.id);
    const inUse = use && haveIds.includes(use) ? use : GH.deviceCoach ? GH.deviceCoach.pick(S, dev.installed) : haveIds[0];
    const older = dev.all.filter((m) => m.legacy && (haveIds.includes(m.id) || dev.progress[m.id]));
    const rows = dev.offered.concat(older).map((m) => {
      const have = haveIds.includes(m.id);
      const p = dev.progress[m.id];
      const rec = !have && m.id === dev.recommended;
      const title = `<span class="rf-list-title">${U.esc(m.name)}${rec ? ` ${U.badge('Recommended', 'accent')}` : ''}</span>`;
      const row = (sub, right, extra) => `<li data-key="model-${m.id}"><div class="rf-list-row model-row">${modelIcon(m)}<span class="rf-list-text">${title}<span class="rf-list-sub">${U.esc(sub)}</span>${extra || ''}</span>${right}</div></li>`;
      // An older model is never downloaded again: a piece of one left from 1.2 can only go.
      if (p && !have && m.legacy) return row(p.loaded > 0 ? `${size(p.loaded)} of an older model's unfinished download` : 'An older model\'s unfinished download', `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="modelCancel" data-arg="${m.id}">Discard</button>`);
      if (p && !have) {
        const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
        const sub = p.state === 'error' ? p.message || 'The download stopped.' : p.state === 'waiting-wifi' || p.state === 'waiting-network' || p.state === 'paused' ? p.message || 'Paused' : p.state === 'verifying' ? 'Checking the download…' : `Downloading · ${pct}% of ${size(m.bytes)}`;
        const right = p.state === 'error' || p.state === 'paused'
          ? `<button type="button" class="rf-btn" data-size="sm" data-act="modelDownload" data-arg="${m.id}">Retry</button>`
          : `<button type="button" class="rf-btn" data-variant="plain" data-size="sm" data-act="modelCancel" data-arg="${m.id}">Cancel</button>`;
        return row(sub, right, p.state === 'downloading' || p.state === 'verifying' ? U.progress(p.total ? p.loaded / p.total : 0, `${m.name} download`) : '');
      }
      if (have) {
        const sub = m.legacy ? `${m.label} · an older model. The new ones answer better.` : [m.label, pace(S, m.id) || 'on this phone'].join(' · ');
        const right = (inUse === m.id ? `<span class="t-footnote model-on">${U.icon('check-circle', 'sm')}In use</span>` : `<button type="button" class="rf-btn" data-size="sm" data-act="modelUse" data-arg="${m.id}">Use</button>`)
          + (compact ? '' : `<button type="button" class="rf-btn" data-variant="plain" data-shape="circle" data-size="sm" aria-label="Delete ${U.esc(m.name)}" data-act="modelDelete" data-arg="${m.id}">${U.icon('trash')}</button>`);
        return row(sub, right);
      }
      const right = `<button type="button" class="rf-btn" data-variant="${rec ? 'filled' : 'soft'}" data-size="sm" data-act="modelDownload" data-arg="${m.id}">${U.icon('download')}Get</button>`;
      return row(`${size(m.bytes)} · ${BLURB[m.tier] || m.label}`, right);
    }).join('');
    const wifi = U.sw('Download on Wi-Fi only', S.ai.wifiOnly !== false, 'data-on="setWifiOnly"');
    return `${rows}${wifi}`;
  };
  U.on.setWifiOnly = (el, ev, v) => { U.S.ai.wifiOnly = !!v; U.save(); };
  U.act.modelDownload = async (el) => {
    const id = el.dataset.arg;
    const m = dev.offered.find((x) => x.id === id);
    if (!m) return;
    const llm = await GH.lazy('llm');
    if (dev.free != null && dev.free < m.bytes * 1.1) { U.toast('Not enough free space', 'caution', `It needs about ${size(m.bytes * 1.1)} free.`); return; }
    dev.progress[id] = { id, state: 'queued', loaded: 0, total: m.bytes };
    redraw();
    U.haptic('tap');
    llm.download(id, { wifiOnly: U.S.ai.wifiOnly !== false }).catch((e) => {
      if (e && e.code === 'cancelled') return;
      dev.progress[id] = { id, state: 'error', message: e && e.message ? e.message : 'The download stopped.' };
      redraw();
    });
  };
  U.act.modelCancel = async (el) => {
    const llm = await GH.lazy('llm');
    await llm.cancel(el.dataset.arg);
    delete dev.progress[el.dataset.arg];
    redraw();
  };
  U.act.modelUse = (el) => { U.S.ai.deviceModel = el.dataset.arg; U.save(); redraw(); U.haptic('select'); };
  U.act.modelDelete = async (el) => {
    const m = dev.all.find((x) => x.id === el.dataset.arg);
    if (!m) return;
    if (!(await U.confirm(`Delete ${m.name}?`, `This frees ${size(m.bytes)}. You can download it again any time.`, 'Delete', 'critical', 'trash'))) return;
    const llm = await GH.lazy('llm');
    await llm.remove(m.id);
    dev.installed = await llm.installed();
    if (U.S.ai.deviceModel === m.id) U.S.ai.deviceModel = null;
    U.save();
    redraw();
  };
  // The self-test: which engine runs here, how long the model takes to start and to answer, and the
  // log, to copy or send with a report when the coach misbehaves.
  U.act.aiSelfTest = async () => {
    const S = U.S;
    const id = GH.deviceCoach ? GH.deviceCoach.pick(S, dev.installed) : null;
    if (!id) return;
    let result = null;
    const body = (step) => {
      if (!result) return `<div class="sheet-pad"><div class="chat-setup"><span class="rf-spinner" data-size="sm"><i></i></span><span class="t-callout">${U.esc(step || 'Starting')}…</span></div><p class="t-footnote rf-muted">This takes up to a minute. Keep the app open.</p></div>`;
      const r = result, st = r.stats || {};
      const engine = r.engine === 'native' ? `On this phone's processor${r.threads ? `, ${r.threads} threads` : ''}` : r.engine === 'wasm' ? `In the app (slower${r.gpu ? ', on the GPU' : ', one thread'})` : 'Didn\'t start';
      const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
      const rows = [
        ['Result', r.ok ? 'Working' : 'Not working'],
        ['Engine', engine],
        ['Model', modelName(r.model) || r.model],
        ['Start-up', sec(r.loadMs)],
        ['First word after', sec(st.firstMs)],
        ['Speed', st.tokensPerSec > 0 ? `about ${Math.max(1, Math.round(st.tokensPerSec * 0.75))} words a second` : '–'],
        ['Memory', r.ram ? `${r.ram} GB` : '–'],
        ['WebView', r.webview || '–'],
      ];
      return `<div class="sheet-pad">
        <ul class="rf-list">${rows.map(([k, v]) => `<li><div class="rf-list-row"><span class="rf-list-text"><span class="rf-list-title">${U.esc(k)}</span></span><span class="rf-list-detail">${U.esc(v)}</span></div></li>`).join('')}</ul>
        ${r.error ? `<p class="t-callout">${U.esc(r.error)}</p>` : ''}
        ${r.reply ? `<p class="t-footnote rf-muted">Its answer: "${U.esc(r.reply)}"</p>` : ''}
        <details class="selftest-log"><summary class="t-footnote">The log</summary><pre class="preview">${U.esc((r.log || []).join('\n'))}</pre></details>
        <div class="btn-row"><button type="button" class="rf-btn" data-variant="soft" data-act="selfTestCopy">${U.icon('copy')}Copy</button><button type="button" class="rf-btn" data-variant="soft" data-act="selfTestReport">${U.icon('flag')}Report a problem</button></div>
        <p class="t-footnote rf-muted">Report a problem opens a GitHub issue with this check, for you to read and edit. Once you post it, the issue is public on GitHub.</p>
      </div>`;
    };
    const ctl = U.sheet({ title: 'On-device AI check', size: 'auto', body: body() });
    const text = () => JSON.stringify(Object.assign({}, result, { app: GH.VERSION || '' }), null, 1);
    U.act.selfTestCopy = () => { if (result && GH.platform) { GH.platform.copy(text()); U.haptic('copy'); U.toast('Copied'); } };
    U.act.selfTestReport = () => {
      if (!result || !GH.platform) return;
      const q = new URLSearchParams({ title: `On-device AI check: ${result.ok ? 'working but' : 'not working'}`, labels: 'ai-selftest', body: `What happened (fill in):\n\n\n**Check:**\n\n\`\`\`json\n${text().slice(0, 5500)}\n\`\`\`\n` });
      GH.platform.openUrl(`https://github.com/ShadowsDistant/gradient-health/issues/new?${q.toString()}`);
    };
    try {
      const llm = await GH.lazy('llm');
      result = await llm.selfTest(id, (step) => { if (!ctl.closed) ctl.update(body(step)); });
    } catch (e) {
      result = { ok: false, error: e.message, log: [] };
    }
    if (!ctl.closed) ctl.update(body());
    U.haptic(result.ok ? 'success' : 'error');
    redraw();
  };
  const modelName = (id) => { const m = dev.all.find((x) => x.id === id); return m ? m.name : null; };
  U.act.keySheet = () => {
    U.sheet({
      title: 'Anthropic API key', size: 'auto',
      body: `<div class="sheet-pad">
        <div class="rf-field"><label class="rf-field-label" for="apiKey">API key</label><div class="rf-field-control"><input class="rf-input" id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"></div>
          <p class="rf-field-hint">Encrypted on this phone, never in backups, never shown again.</p><p class="rf-field-error" id="keyErr" hidden></p></div>
        <button type="button" class="rf-btn" data-variant="plain" data-act="getKey">${U.icon('arrow-up-right')}Get a key in the Claude Console</button>
      </div>`,
      action: { label: 'Save', act: 'keySave' },
    });
  };
  U.act.getKey = () => GH.platform.openUrl(AI().KEY_URL);
  U.act.keySave = () => {
    const input = document.getElementById('apiKey');
    const err = document.getElementById('keyErr');
    const res = AI().setKey(input ? input.value : '');
    if (!res.ok) { if (err) { err.hidden = false; err.textContent = res.error || 'Couldn\'t save the key.'; } return; }
    if (input) input.value = '';
    U.save(true);
    const t = U.topSheet(); if (t) t.close('ok');
    // Claude turns on only once the person has allowed it to get their data; then they pick the
    // model and the monthly budget (the defaults are picked for them).
    setTimeout(async () => {
      const ok = await U.claudeConsent();
      U.S.ai.enabled = ok;
      U.S.ai.mode = ok ? 'api' : 'device';
      U.save(true);
      U.render();
      if (!ok) { U.toast('Key saved', 'neutral', 'Claude stays off until you allow it in Settings, under AI coach.'); return; }
      if (U.claudeSetup) await U.claudeSetup();
      U.render();
      U.toast('Claude is on', 'positive', 'It writes your weekly report when you open Health. Ask it anything.');
    }, 350);
  };
  // Claude's page (src/ui/claudeset.js): over a sheet, the sheet goes first.
  U.act.claudePage = () => {
    const top = U.topSheet && U.topSheet();
    const here = U.route && U.route.view === 'claude';
    if (top && !top.closed) { U.closeSheets(); if (!here) setTimeout(() => U.open('claude'), 320); } else if (!here) U.open('claude');
  };
  U.act.deleteKey = async () => {
    if (!(await U.confirm('Delete the API key?', 'Claude stops working until you add a key again. Your reports stay.', 'Delete', 'critical', 'trash'))) return;
    AI().deleteKey(U.S);
    U.commit();
  };
  U.act.previewSheet = () => {
    U.sheet({
      title: 'What gets sent', size: 'auto',
      body: `<div class="sheet-pad"><p class="t-callout rf-muted">Claude gets this with each question, weekly report and suggestion once you allow it, and the Claude app when you ask there. Plan builds, checks and improvements send less, plus the plan and the moves you can do. No name, email, exact dates or device IDs. The on-device coach and the phone's own report send nothing.</p></div><pre class="preview">${U.esc(AI().preview(U.S, U.today()))}</pre>`,
    });
  };

  /* ---------------------------------------------------------------- data */
  U.act.exportData = async () => {
    const txt = GH.store.exportJson(U.S);
    const ok = await GH.platform.copy(txt);
    if (ok) { U.haptic('copy'); U.toast('Copied', 'positive', 'Paste it into a note or an email to yourself.'); }
    else U.sheet({ title: 'Your data', size: 'full', body: `<div class="sheet-pad"><p class="t-callout rf-muted">Copying didn't work. Select all of this and copy it.</p></div><textarea class="rf-input preview" readonly>${U.esc(txt)}</textarea>` });
  };
  U.act.restoreSheet = () => U.sheet({
    title: 'Restore', size: 'auto',
    body: `<div class="sheet-pad"><p class="t-callout rf-muted">Paste the text from Copy my data. It replaces everything in the app now.</p></div>
      <div class="sheet-pad"><textarea class="rf-input preview" id="restoreTxt" rows="8" aria-label="Backup text" placeholder="{&quot;app&quot;:&quot;gradient-health&quot;, …}"></textarea><p class="rf-field-error" id="restoreErr" hidden></p></div>`,
    action: { label: 'Check', act: 'restoreCheck' },
  });
  U.act.restoreCheck = async () => {
    const txt = (document.getElementById('restoreTxt') || {}).value || '';
    const res = GH.store.importJson(txt);
    const err = document.getElementById('restoreErr');
    if (!res.ok) { if (err) { err.hidden = false; err.textContent = res.error; } return; }
    const since = res.since != null ? ` from ${B().fmtDay(res.since)}` : '';
    const ok = await U.confirm('Replace everything with this backup?', `It has ${U.plural(res.workouts, 'workout')}${since}. What's in the app now will be gone.`, 'Replace', 'critical');
    if (!ok) return;
    const t = U.topSheet(); if (t) t.close('ok');
    U.S = res.state;
    U.S.active = null;
    GH.store.save(U.S);
    U.applyPrefs();
    U.route = { tab: 'today', view: null, arg: null };
    U.render();
    U.toast('Restored', 'positive');
  };
  U.act.resetAll = async () => {
    const one = await U.confirm('Reset Gradient Health?', 'This deletes your plan, history, health and food logs, the AI key, the on-device model and saved maps from this phone.', 'Continue', 'critical', 'trash');
    if (!one) return;
    const two = await U.dialog({
      title: 'This can\'t be undone', message: 'Copy your data first if you might want it back.', icon: 'alert', tone: 'critical',
      actions: [{ label: 'Cancel', value: 'cancel', variant: 'gray', autofocus: true }, { label: 'Copy my data', value: 'copy', variant: 'gray' }, { label: 'Delete everything', value: 'delete', variant: 'filled', tone: 'critical' }],
    });
    if (two === 'copy') { await U.act.exportData(); return; }
    if (two !== 'delete') return;
    if (AI()) AI().deleteKey(U.S);
    // The on-device model too: stop any download and delete what's there.
    if (GH.platform && GH.platform.isApp()) {
      try {
        const llm = await GH.lazy('llm');
        for (const x of llm.status()) if (!['done', 'cancelled', 'error'].includes(x.state)) await llm.cancel(x.id);
        for (const m of await llm.installed()) await llm.remove(m.id);
      } catch (e) { /* nothing to delete */ }
    }
    // Health Connect reads saved in the background and not added yet go too, and the map pieces kept
    // on the phone.
    try { if (GH.health && GH.health.clearPending) GH.health.clearPending(); } catch (e) { /* none waiting */ }
    try { if (U.mapPieces) await U.mapPieces.clear(); } catch (e) { /* none kept */ }
    GH.store.clear();
    U.S = null;
    G.location.hash = '';
    U.route = { tab: 'today', view: null, arg: null };
    U.showOnboarding();
  };

  /* ---------------------------------------------------------------- privacy */
  U.privacyHtml = () => `<div class="card prose">${GH.PRIVACY.html()}</div>`;
  U.screens.privacy = {
    render() { return `${U.navbar('Privacy', '', U.glassBtn('chevron-left', 'Back', 'back'))}<h1 class="rf-large-title">Privacy</h1><div class="section">${U.privacyHtml()}</div>`; },
  };
  // On top of a sheet that must stay open (closing the Claude consent sheet would decline it).
  U.act.privacySheet = () => U.showPrivacySheet();
  U.showPrivacySheet = () => U.sheet({ title: 'Privacy', size: 'full', body: `<div class="sheet-pad">${U.privacyHtml()}</div>` });
})(typeof window !== 'undefined' ? window : globalThis);
