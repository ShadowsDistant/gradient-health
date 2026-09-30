package com.shadowsdistant.gradienthealth;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The runtime permissions an outdoor activity uses: precise location (the route), physical activity
 * (the phone's step counter, Android 10+) and notifications (the ongoing one with time and distance,
 * Android 13+). No background location: recording always starts from the app, in a foreground service.
 *
 * Each is "granted", "ask" (the dialog can still be shown) or "denied" (Android won't show it again,
 * so the page sends the person to the app's settings). Android doesn't say which of the last two it
 * is, so the app remembers: a request answered without a dialog, or a second denial in a row, means
 * denied.
 */
final class ActivityPermissions {
    private ActivityPermissions() {
    }

    static final String FINE = "android.permission.ACCESS_FINE_LOCATION";
    static final String COARSE = "android.permission.ACCESS_COARSE_LOCATION";
    static final String ACTIVITY = "android.permission.ACTIVITY_RECOGNITION"; // runtime from API 29
    static final String NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"; // runtime from API 33
    private static final String PREFS = "activity_permissions";
    /** A request answered faster than this showed no dialog. */
    private static final long NO_DIALOG_MS = 400;

    static boolean granted(Context context, String permission) {
        try {
            return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Recording needs precise location: approximate alone can't draw a route. */
    static boolean canTrack(Context context) {
        return granted(context, FINE);
    }

    /** The step counter's permission (none needed before Android 10). */
    static boolean canCountSteps(Context context) {
        return Build.VERSION.SDK_INT < 29 || granted(context, ACTIVITY);
    }

    /**
     * {"location", "activity", "notifications": "granted"|"denied"|"ask", "approximate": true when only
     * approximate location is allowed}.
     */
    static String json(Activity activity) {
        try {
            JSONObject o = new JSONObject();
            o.put("location", state(activity, FINE));
            o.put("activity", Build.VERSION.SDK_INT < 29 ? "granted" : state(activity, ACTIVITY));
            o.put("notifications", notifications(activity));
            o.put("approximate", !granted(activity, FINE) && granted(activity, COARSE));
            return o.toString();
        } catch (Throwable t) {
            return "{\"location\":\"ask\",\"activity\":\"ask\",\"notifications\":\"ask\",\"approximate\":false}";
        }
    }

    private static String state(Activity activity, String permission) {
        if (granted(activity, permission)) {
            return "granted";
        }
        boolean rationale = false;
        try {
            rationale = activity.shouldShowRequestPermissionRationale(permission);
        } catch (Throwable ignored) {
        }
        return !rationale && prefs(activity).getBoolean(permission, false) ? "denied" : "ask";
    }

    private static String notifications(Activity activity) {
        boolean enabled = true;
        try {
            NotificationManager nm = activity.getSystemService(NotificationManager.class);
            enabled = nm == null || nm.areNotificationsEnabled();
        } catch (Throwable ignored) {
        }
        if (Build.VERSION.SDK_INT >= 33 && !granted(activity, NOTIFICATIONS)) {
            return state(activity, NOTIFICATIONS);
        }
        return enabled ? "granted" : "denied"; // switched off in the phone's settings
    }

    /**
     * What to ask for: precise location (with approximate, which Android wants asked together),
     * physical activity and notifications, where they're runtime permissions and not granted yet.
     */
    static String[] missing(Context context) {
        List<String> out = new ArrayList<String>();
        if (!granted(context, FINE)) {
            out.add(FINE);
            out.add(COARSE);
        }
        if (Build.VERSION.SDK_INT >= 29 && !granted(context, ACTIVITY)) {
            out.add(ACTIVITY);
        }
        if (Build.VERSION.SDK_INT >= 33 && !granted(context, NOTIFICATIONS)) {
            out.add(NOTIFICATIONS);
        }
        return out.toArray(new String[0]);
    }

    /** Which of these Android would explain before asking (a sign they were denied once). */
    static boolean[] rationale(Activity activity, String[] permissions) {
        boolean[] out = new boolean[permissions.length];
        for (int i = 0; i < permissions.length; i++) {
            try {
                out[i] = activity.shouldShowRequestPermissionRationale(permissions[i]);
            } catch (Throwable ignored) {
            }
        }
        return out;
    }

    /**
     * After an answer: remembers the permissions Android won't ask for again (answered with no dialog,
     * or denied again right after a denial) and forgets that for the ones now granted.
     */
    static void onResult(Activity activity, String[] permissions, int[] results, boolean[] before, long tookMs) {
        if (permissions == null) {
            return;
        }
        SharedPreferences.Editor e = prefs(activity).edit();
        for (int i = 0; i < permissions.length; i++) {
            String p = permissions[i];
            if (granted(activity, p) || (results != null && i < results.length && results[i] == PackageManager.PERMISSION_GRANTED)) {
                e.remove(p);
                continue;
            }
            boolean after = false;
            try {
                after = activity.shouldShowRequestPermissionRationale(p);
            } catch (Throwable ignored) {
            }
            boolean wasExplained = before != null && i < before.length && before[i];
            if (!after && (tookMs < NO_DIALOG_MS || wasExplained)) {
                e.putBoolean(p, true);
            }
        }
        e.apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
