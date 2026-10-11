package com.shadowsdistant.gradienthealth;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Notifications: a reminder on workout days, a nudge to walk or run on a rest day, a badge waiting to
 * be opened, a word the morning after a good night's sleep, and a gentle note after a few days away.
 * All local: the page works out what to say and when (src/notify.js) and hands over the whole
 * schedule each time the app is left or opened (AndroidBridge.notifySchedule). This keeps it, in
 * place of the last one, in the "notify" SharedPreferences and posts each item at its time. Nothing
 * is sent anywhere, and when the person stops opening the app, the schedule from their last visit
 * plays out (it holds the page's back-off: a few days, then weekly, then nothing).
 *
 * One alarm at a time, for the soonest item: AlarmManager.setWindow, which is inexact (no exact-alarm
 * permission) and, while the phone dozes, waits for it to wake, when a notification is seen anyway.
 * It's set again after each one, after a restart and after an update (NotifyReceiver). At its time
 * an item is posted only if nothing was posted today (one a day, whatever the page sent), it isn't
 * between 9:30 pm and 8 am, the app isn't on screen, no activity is recording, Android allows its kind
 * (one channel per kind, so each can be switched off in Android's settings too) and it's at most two
 * hours late. A walk nudge also waits for a day with no activity recorded yet.
 *
 * A sleep item is a question for the morning: the background sync's last read of Health Connect
 * (HealthSync hands each read's sleep sessions to {@link #sleepRead}) gives last night's sleep, and
 * the item's tiers, worked out by the page from the person's usual and best, say whether it's worth a
 * word and which. Until a read from this morning has the night, it looks again every 20 minutes, until
 * its `until`. An item that isn't posted for any reason but the day's one already being out hands
 * over to the one the page put behind it (alt: a walk later that day).
 *
 * The "notify" preferences (the schedule, what was posted, the last read's sleep and the nights
 * judged) are left out of backups (res/xml*): they're for this phone, and the page plans again on
 * the next.
 *
 * A notification opens the app on the item's screen (ACTION_OPEN, passed on like a plan link:
 * AndroidBridge.notifyTap() or window.__gh.onNotifyTap). Only one shows at a time: a new one takes
 * the last one's place, and each goes by itself once it's out of date.
 */
final class Notifier {
    private Notifier() {
    }

    /** The alarm's broadcast (NotifyReceiver). */
    static final String ACTION_ALARM = "com.shadowsdistant.gradienthealth.NOTIFY";
    /** A notification's tap: opens the app on its screen (MainActivity). */
    static final String ACTION_OPEN = "com.shadowsdistant.gradienthealth.OPEN_NOTIFICATION";
    static final String EXTRA_ID = "notifyId";
    static final String EXTRA_KIND = "notifyKind";
    static final String EXTRA_ROUTE = "notifyRoute";

    /** The kinds, each a channel of its own (ids are the kinds). */
    static final String[] KINDS = {"workout", "move", "badge", "sleep", "comeback"};
    private static final String[] CHANNEL_NAMES = {"Workout days", "Walks and runs", "New badges", "Good nights", "After a few days away"};
    private static final String[] CHANNEL_INFO = {
            "What today's workout is, at your reminder time",
            "On a rest day, now and then, a nudge to walk or run",
            "A badge you've earned that's waiting to be opened",
            "The morning after a good night's sleep",
            "A gentle note after a few days away, then weekly for a while",
    };
    // Reminders and badges make a sound; the nudges and notes come quietly.
    private static final int[] IMPORTANCE = {
            NotificationManager.IMPORTANCE_DEFAULT, NotificationManager.IMPORTANCE_LOW,
            NotificationManager.IMPORTANCE_DEFAULT, NotificationManager.IMPORTANCE_LOW,
            NotificationManager.IMPORTANCE_LOW,
    };
    /** The screens a notification can open (the page's routes). */
    private static final String[] ROUTES = {"today", "plan", "health", "badges", "progress", "you"};

    // What the page may send.
    static final int MAX_JSON = 64 * 1024;
    static final int MAX_ITEMS = 60;
    static final int MAX_TITLE = 80;
    static final int MAX_BODY = 200;
    private static final int MAX_TIERS = 3;
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9:_.-]{1,64}");
    private static final long MINUTE_MS = 60 * 1000L;
    private static final long HOUR_MS = 60 * MINUTE_MS;
    private static final long DAY_MS = 24 * HOUR_MS;
    /** Items are at most about two months ahead (the page's last one is 45 days out). */
    static final long MAX_AHEAD_MS = 62 * DAY_MS;
    /** A sleep item waits for the night's data at most this long. */
    private static final long MAX_WAIT_MS = 12 * HOUR_MS;

    // When they're posted.
    private static final int QUIET_FROM = 21 * 60 + 30; // minutes after midnight
    private static final int QUIET_TO = 8 * 60;
    private static final long LATE_MS = 2 * HOUR_MS;
    private static final long RETRY_MS = 20 * MINUTE_MS;
    private static final long WINDOW_MS = 15 * MINUTE_MS;
    private static final long SLACK_MS = MINUTE_MS;
    private static final long SENT_KEEP_MS = 60 * DAY_MS;
    private static final int SENT_MAX = 200;

    private static final String PREFS = "notify";
    private static final int NOTIFICATION_ID = 4501;
    private static final int ALARM_REQUEST = 4502;
    private static final int TAP_REQUEST = 4503;
    private static final int BRAND = 0xFF3E95F9; // the logo's blue, its gradient's first colour
    private static final Object LOCK = new Object();

    private static final int POSTED = 0;
    private static final int SKIPPED = 1; // not this one; its alt may still go
    private static final int DROPPED = 2; // nor its alt
    private static final int RETRY = 3; // a sleep question still waiting for the night's data

    // ---------------------------------------------------------------- the schedule

    /**
     * The page's schedule ({"on", "opened"?, "items": [...]}), checked (see {@link #clean}), in place
     * of the last one; the alarm follows. "opened": the app just came to the front, so what's in the
     * shade has done its job. False if it isn't a schedule.
     */
    static boolean schedule(Context context, String json) {
        long now = System.currentTimeMillis();
        JSONObject in;
        try {
            if (json == null || json.length() > MAX_JSON) {
                return false;
            }
            in = new JSONObject(json);
        } catch (Throwable t) {
            return false;
        }
        boolean on = in.optBoolean("on", false);
        JSONArray items = on ? clean(in.optJSONArray("items"), now) : new JSONArray();
        if (items == null) {
            return false;
        }
        synchronized (LOCK) {
            SharedPreferences.Editor e = prefs(context).edit().putString("items", items.toString()).putBoolean("on", on);
            if (!on) {
                e.remove("sleep").remove("sleepAt").remove("nights"); // kept only for the notes
            }
            e.apply();
        }
        if (on) {
            channels(context);
        }
        if (!on || in.optBoolean("opened", false)) {
            try {
                NotificationManager nm = context.getSystemService(NotificationManager.class);
                if (nm != null) {
                    nm.cancel(NOTIFICATION_ID);
                }
            } catch (Throwable ignored) {
            }
        }
        arm(context, now);
        return true;
    }

    /**
     * The items worth keeping, soonest first, or null when there are more than MAX_ITEMS (that isn't
     * a schedule the page makes). Each is checked on its own and dropped if anything's off: an id of
     * 1 to 64 plain characters (one of each), a known kind and screen, a title of 1 to 80 characters
     * and a text of at most 200, a time ahead and within about two months; a sleep item also has its
     * wait (until, half a day at most), the start of its night and 1 to 3 tiers (one that isn't right
     * is left out, and a question with none left goes); an alt is a plain item, after the sleep
     * question's wait, the same day.
     */
    static JSONArray clean(JSONArray in, long now) {
        if (in == null || in.length() > MAX_ITEMS) {
            return null;
        }
        List<JSONObject> out = new ArrayList<JSONObject>();
        Set<String> ids = new HashSet<String>();
        for (int i = 0; i < in.length(); i++) {
            JSONObject x = item(in.optJSONObject(i), now, true);
            if (x != null && ids.add(x.optString("id"))) {
                out.add(x);
            }
        }
        sort(out);
        JSONArray arr = new JSONArray();
        for (JSONObject x : out) {
            arr.put(x);
        }
        return arr;
    }

    private static JSONObject item(JSONObject o, long now, boolean top) {
        if (o == null) {
            return null;
        }
        try {
            String id = o.optString("id", "");
            String kind = o.optString("kind", "");
            String route = o.optString("route", "");
            String title = o.optString("title", "");
            String body = o.optString("body", "");
            long at = o.optLong("at", 0L);
            if (!ID.matcher(id).matches() || index(KINDS, kind) < 0 || index(ROUTES, route) < 0
                    || title.isEmpty() || title.length() > MAX_TITLE || body.length() > MAX_BODY
                    || at <= now || at > now + MAX_AHEAD_MS) {
                return null;
            }
            JSONObject x = new JSONObject();
            x.put("id", id).put("kind", kind).put("route", route).put("title", title).put("body", body).put("at", at);
            long until = at;
            if ("sleep".equals(kind)) {
                JSONObject s = o.optJSONObject("sleep");
                until = o.optLong("until", 0L);
                if (!top || s == null || until < at || until > at + MAX_WAIT_MS) {
                    return null;
                }
                long from = s.optLong("from", 0L);
                JSONArray tiers = s.optJSONArray("tiers");
                if (from > at || from < at - DAY_MS || tiers == null || tiers.length() < 1 || tiers.length() > MAX_TIERS) {
                    return null;
                }
                // A tier that isn't right is left out on its own; a question with none left goes.
                JSONArray kept = new JSONArray();
                for (int i = 0; i < tiers.length(); i++) {
                    JSONObject t = tiers.optJSONObject(i);
                    int min = t == null ? -1 : t.optInt("min", -1);
                    int max = t == null ? -1 : t.optInt("max", 24 * 60);
                    String tt = t == null ? "" : t.optString("title", "");
                    String tb = t == null ? "" : t.optString("body", "");
                    if (min < 60 || max < min || max > 24 * 60 || tt.isEmpty() || tt.length() > MAX_TITLE || tb.length() > MAX_BODY) {
                        continue;
                    }
                    kept.put(new JSONObject().put("min", min).put("max", max).put("best", t.optBoolean("best", false))
                            .put("title", tt).put("body", tb));
                }
                if (kept.length() == 0) {
                    return null;
                }
                x.put("until", until).put("sleep", new JSONObject().put("from", from).put("tiers", kept));
            }
            JSONObject alt = top ? o.optJSONObject("alt") : null;
            if (alt != null) {
                JSONObject a = item(alt, now, false);
                if (a != null && a.optLong("at") > until && dayKey(a.optLong("at")) == dayKey(at)) {
                    x.put("alt", a);
                }
            }
            return x;
        } catch (Throwable t) {
            return null;
        }
    }

    // ---------------------------------------------------------------- at its time

    /** The alarm went off: posts what's due (see the class comment), keeps the rest, sets the next alarm. */
    static void fire(Context context, long now) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(context);
            JSONArray items = array(p.getString("items", "[]"));
            List<JSONObject> keep = new ArrayList<JSONObject>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject x = items.optJSONObject(i);
                if (x == null) {
                    continue;
                }
                if (x.optLong("at", 0L) > now + SLACK_MS) {
                    keep.add(x);
                    continue;
                }
                int r;
                try {
                    r = handle(context, p, x, now);
                } catch (Throwable t) {
                    r = SKIPPED;
                }
                try {
                    if (r == RETRY) {
                        x.put("at", Math.min(now + RETRY_MS, x.optLong("until", now)));
                        keep.add(x);
                    } else if (r == SKIPPED && x.optJSONObject("alt") != null) {
                        keep.add(x.optJSONObject("alt"));
                    }
                } catch (Throwable ignored) {
                }
            }
            sort(keep);
            JSONArray out = new JSONArray();
            for (JSONObject x : keep) {
                out.put(x);
            }
            p.edit().putString("items", out.toString()).apply();
        }
        arm(context, now);
    }

    private static int handle(Context context, SharedPreferences p, JSONObject x, long now) throws Exception {
        String id = x.optString("id");
        String kind = x.optString("kind");
        if (sentIds(p).contains(id) || dayKey(now) == p.getInt("lastDay", 0)) {
            return DROPPED; // posted already, or today's one is out
        }
        boolean sleep = "sleep".equals(kind);
        long at = x.optLong("at");
        long until = x.optLong("until", at);
        if (sleep ? now > until : now - at > LATE_MS) {
            return SKIPPED;
        }
        if (quiet(now) || MainActivity.inFront() != null || !allowed(context, kind)) {
            return SKIPPED;
        }
        ActivityTrack track = ActivityTrack.get(context);
        if (track.isActive() || ("move".equals(kind) && dayKey(track.latestStart()) == dayKey(now))) {
            return SKIPPED;
        }
        String title = x.optString("title");
        String body = x.optString("body");
        if (sleep) {
            Night n = judge(context, p, x.optJSONObject("sleep"), now);
            if (n == null) {
                return now >= until ? SKIPPED : RETRY;
            }
            if (n.tier == null) {
                return SKIPPED;
            }
            String t = hm(n.minutes);
            title = n.tier.optString("title").replace("{t}", t);
            body = n.tier.optString("body").replace("{t}", t);
        }
        post(context, x, title, body, now);
        record(p, id, now);
        return POSTED;
    }

    /** Last night's sleep and the tier it reaches (null: not one to mention). */
    private static final class Night {
        final int minutes;
        final JSONObject tier;

        Night(int minutes, JSONObject tier) {
            this.minutes = minutes;
            this.tier = tier;
        }
    }

    /**
     * Last night's sleep, judged against the item's tiers; null while there's no read from this
     * morning with the night in it yet. With the background sync off there won't be one, so that's a
     * night not to mention rather than one to wait for.
     */
    private static Night judge(Context context, SharedPreferences p, JSONObject s, long now) {
        if (s == null) {
            return new Night(0, null);
        }
        String blocker;
        try {
            blocker = HealthSync.blocker(context);
        } catch (Throwable t) {
            blocker = "failed";
        }
        if (blocker != null) {
            return new Night(0, null);
        }
        long from = s.optLong("from");
        int night = p.getLong("sleepAt", 0L) >= from ? lastNight(array(p.getString("sleep", "[]")), from, now) : -1;
        if (night < 0) {
            return null;
        }
        int best = bestNight(p, now);
        rememberNight(p, now, night);
        return new Night(night, tier(s.optJSONArray("tiers"), night, best));
    }

    /**
     * A background read's sleep sessions (HealthSync, every 15 minutes or so), kept while notifications
     * are on, for the morning's question: the last read's, with when it was made.
     */
    static void sleepRead(Context context, String sessionsJson, long at) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(context);
            if (p.getBoolean("on", false)) {
                p.edit().putString("sleep", sessionsJson).putLong("sleepAt", at).apply();
            }
        }
    }

    /**
     * The minutes asleep in the sessions that ended between {@code from} (the start of this morning's
     * day, as the page counts sleep: toward the morning you woke up) and now, or -1 if none did.
     */
    static int lastNight(JSONArray sessions, long from, long now) {
        if (sessions == null) {
            return -1;
        }
        int total = 0;
        boolean any = false;
        for (int i = 0; i < sessions.length(); i++) {
            JSONObject x = sessions.optJSONObject(i);
            if (x == null) {
                continue;
            }
            long start = instant(x.optString("start", ""));
            long end = instant(x.optString("end", ""));
            if (end <= 0 || end < from || end > now || start <= 0 || start >= end) {
                continue;
            }
            double asleep = x.optDouble("asleepMin", (end - start) / 60000.0);
            total += (int) Math.max(0, Math.round(asleep));
            any = true;
        }
        return any ? total : -1;
    }

    /** The first tier the night reaches: within its minutes, and above the week's best where it asks. */
    static JSONObject tier(JSONArray tiers, int night, int bestSeen) {
        for (int i = 0; tiers != null && i < tiers.length(); i++) {
            JSONObject t = tiers.optJSONObject(i);
            if (t == null || night < t.optInt("min", Integer.MAX_VALUE) || night > t.optInt("max", 0)) {
                continue;
            }
            if (t.optBoolean("best", false) && night <= bestSeen) {
                continue;
            }
            return t;
        }
        return null;
    }

    // The nights this has judged, [[ms, minutes]], the last 8: "your best this week" holds against the
    // nights since the page last planned too.
    private static int bestNight(SharedPreferences p, long now) {
        JSONArray nights = array(p.getString("nights", "[]"));
        int best = 0;
        for (int i = 0; i < nights.length(); i++) {
            JSONArray n = nights.optJSONArray(i);
            if (n != null && n.optLong(0) > now - 6 * DAY_MS - 12 * HOUR_MS && n.optLong(0) < now - 12 * HOUR_MS) {
                best = Math.max(best, n.optInt(1));
            }
        }
        return best;
    }

    private static void rememberNight(SharedPreferences p, long now, int minutes) {
        JSONArray nights = array(p.getString("nights", "[]"));
        JSONArray out = new JSONArray();
        for (int i = Math.max(0, nights.length() - 7); i < nights.length(); i++) {
            JSONArray n = nights.optJSONArray(i);
            if (n != null && dayKey(n.optLong(0)) != dayKey(now)) {
                out.put(n);
            }
        }
        out.put(new JSONArray().put(now).put(minutes));
        p.edit().putString("nights", out.toString()).apply();
    }

    // ---------------------------------------------------------------- posting

    private static void post(Context context, JSONObject x, String title, String body, long now) {
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) {
            return;
        }
        channels(context);
        String kind = x.optString("kind");
        Intent open = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN)
                .putExtra(EXTRA_ID, x.optString("id"))
                .putExtra(EXTRA_KIND, kind)
                .putExtra(EXTRA_ROUTE, x.optString("route"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, TAP_REQUEST, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(context, kind)
                .setSmallIcon(icon(context))
                .setContentTitle(title)
                .setAutoCancel(true)
                .setColor(BRAND)
                .setCategory("workout".equals(kind) ? Notification.CATEGORY_REMINDER : Notification.CATEGORY_RECOMMENDATION)
                // It's about the person's health: the lock screen shows the app's name only, if
                // they've set it to hide what notifications say.
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setShowWhen(true)
                .setWhen(now)
                .setTimeoutAfter(Math.max(HOUR_MS, staleAt(kind, now) - now))
                .setContentIntent(tap);
        if (!body.isEmpty()) {
            b.setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body));
        }
        nm.notify(NOTIFICATION_ID, b.build());
    }

    /** When a notification of this kind has had its day: the day's own ones at midnight, a badge's in two. */
    private static long staleAt(String kind, long now) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if ("sleep".equals(kind)) {
            c.set(Calendar.HOUR_OF_DAY, 14);
            return c.getTimeInMillis();
        }
        c.add(Calendar.DAY_OF_MONTH, "badge".equals(kind) ? 2 : "comeback".equals(kind) ? 3 : 1);
        return c.getTimeInMillis();
    }

    /** The small icon the activity's notification uses (the build doesn't generate an R class). */
    private static int icon(Context context) {
        try {
            int id = context.getResources().getIdentifier("ic_stat_activity", "drawable", context.getPackageName());
            return id != 0 ? id : context.getApplicationInfo().icon;
        } catch (Throwable t) {
            return context.getApplicationInfo().icon;
        }
    }

    /** One channel per kind, made the first time notifications are on. */
    static void channels(Context context) {
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) {
                return;
            }
            for (int i = 0; i < KINDS.length; i++) {
                if (nm.getNotificationChannel(KINDS[i]) != null) {
                    continue;
                }
                NotificationChannel c = new NotificationChannel(KINDS[i], CHANNEL_NAMES[i], IMPORTANCE[i]);
                c.setDescription(CHANNEL_INFO[i]);
                c.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
                nm.createNotificationChannel(c);
            }
        } catch (Throwable ignored) {
        }
    }

    /** Android lets this kind through: notifications allowed for the app, and its channel not switched off. */
    private static boolean allowed(Context context, String kind) {
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null || !nm.areNotificationsEnabled()) {
                return false;
            }
            NotificationChannel c = nm.getNotificationChannel(kind);
            return c == null || c.getImportance() != NotificationManager.IMPORTANCE_NONE;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------------------------------------------------------------- the alarm

    /**
     * Sets the one alarm for the soonest item (a due one a second from now), or cancels it. Under the
     * lock, reading and setting together: when an alarm's run and a new schedule meet, whichever sets
     * the alarm last has read the newest schedule.
     */
    static void arm(Context context, long now) {
        synchronized (LOCK) {
            long next = Long.MAX_VALUE;
            JSONArray items = array(prefs(context).getString("items", "[]"));
            for (int i = 0; i < items.length(); i++) {
                JSONObject x = items.optJSONObject(i);
                if (x != null) {
                    next = Math.min(next, x.optLong("at", Long.MAX_VALUE));
                }
            }
            try {
                AlarmManager am = context.getSystemService(AlarmManager.class);
                if (am == null) {
                    return;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST,
                        new Intent(context, NotifyReceiver.class).setAction(ACTION_ALARM),
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                if (next == Long.MAX_VALUE) {
                    am.cancel(pi);
                    return;
                }
                am.setWindow(AlarmManager.RTC_WAKEUP, Math.max(next, now + 1000L), WINDOW_MS, pi);
            } catch (Throwable ignored) {
                // No alarm: the page plans again the next time it's opened.
            }
        }
    }

    // ---------------------------------------------------------------- for the page

    /**
     * {"permission": "granted"|"ask"|"denied", "blocked": [kinds whose channel is off], "lastPosted":
     * ms|null, "sent": [{"id", "at"}], "scheduled": n, "next": ms|null} for AndroidBridge.notifyState().
     */
    static String stateJson(Activity activity) {
        try {
            JSONObject o = new JSONObject();
            o.put("permission", ActivityPermissions.notifications(activity));
            JSONArray blocked = new JSONArray();
            NotificationManager nm = activity.getSystemService(NotificationManager.class);
            for (int i = 0; nm != null && i < KINDS.length; i++) {
                NotificationChannel c = nm.getNotificationChannel(KINDS[i]);
                if (c != null && c.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                    blocked.put(KINDS[i]);
                }
            }
            o.put("blocked", blocked);
            synchronized (LOCK) {
                SharedPreferences p = prefs(activity);
                long last = p.getLong("lastAt", 0L);
                o.put("lastPosted", last > 0 ? (Object) last : JSONObject.NULL);
                JSONArray sent = new JSONArray();
                JSONArray list = array(p.getString("sent", "[]"));
                for (int i = 0; i < list.length(); i++) {
                    JSONArray s = list.optJSONArray(i);
                    if (s != null) {
                        sent.put(new JSONObject().put("id", s.optString(0)).put("at", s.optLong(1)));
                    }
                }
                o.put("sent", sent);
                JSONArray items = array(p.getString("items", "[]"));
                o.put("scheduled", items.length());
                JSONObject first = items.optJSONObject(0);
                o.put("next", first != null ? (Object) first.optLong("at") : JSONObject.NULL);
            }
            return o.toString();
        } catch (Throwable t) {
            return "{\"permission\":\"ask\",\"blocked\":[],\"lastPosted\":null,\"sent\":[],\"scheduled\":0,\"next\":null}";
        }
    }

    /** A notification's tap, as the page gets it ({"id", "kind", "route"}), or null for any other intent. */
    static String tapFrom(Intent intent) {
        if (intent == null || !ACTION_OPEN.equals(intent.getAction())) {
            return null;
        }
        try {
            String route = intent.getStringExtra(EXTRA_ROUTE);
            String kind = intent.getStringExtra(EXTRA_KIND);
            String id = intent.getStringExtra(EXTRA_ID);
            if (route == null || index(ROUTES, route) < 0) {
                return null;
            }
            return new JSONObject()
                    .put("route", route)
                    .put("kind", kind != null && index(KINDS, kind) >= 0 ? kind : "")
                    .put("id", id != null && ID.matcher(id).matches() ? id : "")
                    .toString();
        } catch (Throwable t) {
            return null;
        }
    }

    // ---------------------------------------------------------------- small helpers

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** What was posted: the id and when, the last 60 days (200 at most), and today's day as the last. */
    private static void record(SharedPreferences p, String id, long now) {
        JSONArray list = array(p.getString("sent", "[]"));
        List<JSONArray> keep = new ArrayList<JSONArray>();
        for (int i = 0; i < list.length(); i++) {
            JSONArray s = list.optJSONArray(i);
            if (s != null && s.optLong(1) > now - SENT_KEEP_MS) {
                keep.add(s);
            }
        }
        keep.add(new JSONArray().put(id).put(now));
        JSONArray out = new JSONArray();
        for (int i = Math.max(0, keep.size() - SENT_MAX); i < keep.size(); i++) {
            out.put(keep.get(i));
        }
        p.edit().putString("sent", out.toString()).putInt("lastDay", dayKey(now)).putLong("lastAt", now).apply();
    }

    private static Set<String> sentIds(SharedPreferences p) {
        Set<String> ids = new HashSet<String>();
        JSONArray list = array(p.getString("sent", "[]"));
        for (int i = 0; i < list.length(); i++) {
            JSONArray s = list.optJSONArray(i);
            if (s != null) {
                ids.add(s.optString(0));
            }
        }
        return ids;
    }

    /** Between 9:30 pm and 8 am, local time. */
    static boolean quiet(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        int m = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        return m >= QUIET_FROM || m < QUIET_TO;
    }

    /** The local date as yyyymmdd (0 for no time). */
    static int dayKey(long ms) {
        if (ms <= 0) {
            return 0;
        }
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH);
    }

    /** Minutes as the app writes sleep: "7 h 52 m", "8 h". */
    static String hm(int minutes) {
        int h = minutes / 60;
        int m = minutes % 60;
        return m == 0 ? h + " h" : h + " h " + (m < 10 ? "0" : "") + m + " m";
    }

    private static long instant(String iso) {
        try {
            return iso.isEmpty() ? 0L : Instant.parse(iso).toEpochMilli();
        } catch (Throwable t) {
            return 0L;
        }
    }

    private static int index(String[] list, String s) {
        for (int i = 0; i < list.length; i++) {
            if (list[i].equals(s)) {
                return i;
            }
        }
        return -1;
    }

    private static JSONArray array(String json) {
        try {
            return new JSONArray(json == null ? "[]" : json);
        } catch (Throwable t) {
            return new JSONArray();
        }
    }

    private static void sort(List<JSONObject> list) {
        Collections.sort(list, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Long.compare(a.optLong("at"), b.optLong("at"));
            }
        });
    }
}
