package com.shadowsdistant.gradienthealth;

import android.app.ActivityManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.VibrationAttributes;
import android.os.PersistableBundle;
import android.media.AudioAttributes;
import android.os.Vibrator;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * The object exposed to the page as window.AndroidBridge.
 *
 * The WebView calls these methods on its own background thread ("JavaBridge"), so anything that
 * touches the window or starts activities hops to the UI thread. Every method is defensive: it
 * never throws into the page. Nothing here logs its arguments (saveSecret carries the user's
 * Anthropic API key).
 *
 * Health Connect needs Android 14 (API 34). The hc* methods check the SDK level before touching
 * {@link HealthBridge}, which is the only class that references android.health.connect types.
 */
public final class Bridge {
    static final int HEALTH_CONNECT_MIN_SDK = 34; // Android 14 (UPSIDE_DOWN_CAKE)

    private static final String STATE_FILE = "state.json";
    private static final String STATE_TMP_FILE = "state.json.tmp";
    private static final String SECRETS_PREFS = "secrets";
    private static final int MAX_VIBRATION_MS = 10000;

    private final MainActivity activity;
    private final Object stateLock = new Object();

    Bridge(MainActivity activity) {
        this.activity = activity;
    }

    // ---------------------------------------------------------------- device

    /** Keeps the screen on while true (e.g. during a workout). */
    @JavascriptInterface
    public void keepAwake(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window w = activity.getWindow();
                    if (on) {
                        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                } catch (Throwable ignored) {
                }
            }
        });
    }

    /** One vibration of {@code ms} milliseconds (capped at 10 s): a workout timer alert. */
    @JavascriptInterface
    public void vibrate(int ms) {
        if (ms <= 0) {
            return;
        }
        try {
            Vibrator v = vibrator();
            if (v != null) {
                alert(v, VibrationEffect.createOneShot(Math.min(ms, MAX_VIBRATION_MS),
                        VibrationEffect.DEFAULT_AMPLITUDE));
            }
        } catch (Throwable ignored) {
        }
    }

    /**
     * Timer alerts vibrate as alarms, not touch feedback: Android drops touch-class vibrations when
     * the phone's touch feedback is off, and short ones count as touch unless they say otherwise.
     */
    private static void alert(Vibrator v, VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM));
        } else {
            v.vibrate(effect, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
    }

    /** "[off, on, off, on, ...]" in ms, like navigator.vibrate(); plays once. */
    @JavascriptInterface
    public void vibratePattern(String jsonArray) {
        if (jsonArray == null) {
            return;
        }
        try {
            JSONArray arr = new JSONArray(jsonArray);
            int n = Math.min(arr.length(), 64);
            long[] timings = new long[n];
            boolean any = false;
            for (int i = 0; i < n; i++) {
                long t = Math.max(0L, Math.min((long) MAX_VIBRATION_MS, arr.optLong(i, 0L)));
                timings[i] = t;
                any |= t > 0;
            }
            Vibrator v = vibrator();
            if (any && v != null) {
                alert(v, VibrationEffect.createWaveform(timings, -1));
            }
        } catch (Throwable ignored) {
        }
    }

    @SuppressWarnings("deprecation") // VibratorManager is API 31+; this works on all versions
    private Vibrator vibrator() {
        Object service = activity.getSystemService(Context.VIBRATOR_SERVICE);
        return service instanceof Vibrator ? (Vibrator) service : null;
    }

    /** Copies plain text to the clipboard. Very large texts (~1 MB) can fail: returns false. */
    @JavascriptInterface
    public boolean copy(String text) {
        try {
            Object service = activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (!(service instanceof ClipboardManager)) {
                return false;
            }
            ClipData clip = ClipData.newPlainText("Gradient Health", text == null ? "" : text);
            // It's health data: keep it out of the clipboard preview and suggestions.
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
            ((ClipboardManager) service).setPrimaryClip(clip);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean isDark() {
        return activity.isDarkMode();
    }

    /** Haptic strength picked in Settings: light, medium or strong. */
    @JavascriptInterface
    public void hapticStrength(String level) {
        Haptics.setLevel(level);
    }

    /** False when the phone's own touch feedback is switched off (UI taps are then skipped). */
    @JavascriptInterface
    public boolean hapticsSystemEnabled() {
        return Haptics.systemTouchFeedback(activity);
    }

    /**
     * A short haptic by name: tap, select, tick, toggleOn, toggleOff, success, error, heavy, go,
     * done, celebrate. Follows the system's touch-feedback setting.
     */
    @JavascriptInterface
    public void haptic(final String kind) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.haptic(kind);
            }
        });
    }

    /** The page's theme, so the status and navigation bar icons stay readable over it. */
    @JavascriptInterface
    public void setSystemBars(final boolean dark) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.setPageTheme(dark);
            }
        });
    }

    /** Safe-area insets in CSS pixels: {"top","bottom","left","right","keyboard"}. */
    @JavascriptInterface
    public String insets() {
        return activity.insetsJson();
    }

    /**
     * Hands text to another app. target "claude" sends it straight to the Claude app when it's
     * installed; anything else (or no Claude app) opens the share sheet.
     */
    @JavascriptInterface
    public void shareText(final String text, final String target) {
        final String pkg = "claude".equals(target) ? MainActivity.CLAUDE_PACKAGE : null;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.shareText(text, pkg);
            }
        });
    }

    @JavascriptInterface
    public boolean claudeInstalled() {
        return activity.isInstalled(MainActivity.CLAUDE_PACKAGE);
    }

    /** e.g. "1.0.0 (29830012)". */
    @SuppressWarnings("deprecation")
    @JavascriptInterface
    public String appVersion() {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            String name = info.versionName == null ? "" : info.versionName;
            return name + " (" + info.versionCode + ")";
        } catch (Throwable t) {
            return "";
        }
    }

    /** Opens an http(s) URL outside the app; anything else is ignored. */
    @JavascriptInterface
    public void openUrl(String url) {
        final Uri uri = MainActivity.httpUri(url);
        if (uri == null) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openExternal(uri);
            }
        });
    }

    // ---------------------------------------------------------------- app state

    /**
     * Atomically replaces filesDir/state.json: writes state.json.tmp, fsyncs it, then renames it
     * over the old file, so a crash or power loss leaves either the old or the new state.
     */
    @JavascriptInterface
    public boolean save(String json) {
        if (json == null) {
            return false;
        }
        synchronized (stateLock) {
            File dir = activity.getFilesDir();
            File target = new File(dir, STATE_FILE);
            File tmp = new File(dir, STATE_TMP_FILE);
            FileOutputStream out = null;
            try {
                out = new FileOutputStream(tmp);
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.flush();
                try {
                    out.getFD().sync();
                } catch (IOException ignored) {
                    // Still better to save than to fail.
                }
                out.close();
                out = null;
                if (tmp.renameTo(target)) {
                    return true;
                }
                // rename(2) replaces atomically, so this is unexpected; retry once without the old file.
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                return tmp.renameTo(target);
            } catch (Throwable t) {
                return false;
            } finally {
                if (out != null) {
                    try {
                        out.close();
                    } catch (IOException ignored) {
                    }
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                }
            }
        }
    }

    /** The last saved state, or "" if there is none (or it can't be read). */
    @JavascriptInterface
    public String load() {
        synchronized (stateLock) {
            File file = new File(activity.getFilesDir(), STATE_FILE);
            if (!file.isFile()) {
                return "";
            }
            InputStream in = null;
            try {
                in = new FileInputStream(file);
                ByteArrayOutputStream buffer = new ByteArrayOutputStream((int) Math.min(file.length(), 1 << 24) + 16);
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = in.read(chunk)) != -1) {
                    buffer.write(chunk, 0, n);
                }
                return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            } catch (Throwable t) {
                return "";
            } finally {
                if (in != null) {
                    try {
                        in.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------- secrets (never logged)

    private SharedPreferences secrets() {
        return activity.getSharedPreferences(SECRETS_PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public boolean saveSecret(String name, String value) {
        if (name == null || name.isEmpty()) {
            return false;
        }
        try {
            return secrets().edit().putString(name, value == null ? "" : value).commit();
        } catch (Throwable t) {
            return false;
        }
    }

    /** The stored value, or "" if none. */
    @JavascriptInterface
    public String loadSecret(String name) {
        if (name == null || name.isEmpty()) {
            return "";
        }
        try {
            String value = secrets().getString(name, "");
            return value == null ? "" : value;
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean deleteSecret(String name) {
        if (name == null || name.isEmpty()) {
            return false;
        }
        try {
            return secrets().edit().remove(name).commit();
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------------------------------------------------------------- Health Connect

    /** "unsupported" (below Android 14) | "unavailable" | "denied" | "partial" | "granted". */
    @JavascriptInterface
    public String hcStatus() {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return "unsupported";
        }
        try {
            return HealthBridge.status(activity);
        } catch (Throwable t) {
            return "unavailable";
        }
    }

    /** Asks for the health permissions; answers with window.__gh.onHealthPerms(status). */
    @JavascriptInterface
    public void hcRequest() {
        requestHealth(false);
    }

    /** The same, plus reading and writing nutrition (when food tracking is on). */
    @JavascriptInterface
    public void hcRequestFood() {
        requestHealth(true);
    }

    private void requestHealth(final boolean withFood) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.requestHealthPermissions(withFood);
            }
        });
    }

    /** Opens Health Connect's permission screen for this app (to re-grant after denials). */
    @JavascriptInterface
    public void hcOpenSettings() {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openHealthSettings();
            }
        });
    }

    /**
     * Reads the last {@code days} days (1..90) of every granted data type in the background and
     * answers once with window.__gh.onHealth({...}).
     */
    @JavascriptInterface
    public void hcRead(int days) {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            deliverHealthFailure("unsupported");
            return;
        }
        try {
            HealthBridge.read(activity, days);
        } catch (Throwable t) {
            deliverHealthFailure(t.getClass().getSimpleName() + ": " + t.getMessage());
        }
    }

    /** The Health Connect data types this app may read or write now (a JSON list of names). */
    @JavascriptInterface
    public String hcGranted() {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return "[]";
        }
        try {
            return HealthBridge.granted(activity);
        } catch (Throwable t) {
            return "[]";
        }
    }

    /** True when the app may save logged meals to Health Connect. */
    @JavascriptInterface
    public boolean hcCanWriteFood() {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return false;
        }
        try {
            return HealthBridge.canWriteNutrition(activity);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Saves meals as nutrition records; answers with window.__gh.onFoodWrite. */
    @JavascriptInterface
    public void hcWriteFood(String json) {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return;
        }
        try {
            HealthBridge.writeNutrition(activity, json);
        } catch (Throwable ignored) {
        }
    }

    /** Deletes meals this app saved (by client id); answers with window.__gh.onFoodDelete. */
    @JavascriptInterface
    public void hcDeleteFood(String json) {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return;
        }
        try {
            HealthBridge.deleteNutrition(activity, json);
        } catch (Throwable ignored) {
        }
    }

    /**
     * Looks a food up on Open Food Facts ("barcode" or "search"). Only called when online food
     * search is on; the answer comes back through window.__gh.onFoodResult with the same id.
     */
    @JavascriptInterface
    public void foodLookup(String kind, String query, String id) {
        FoodLookup.lookup(activity, kind, query, id);
    }

    /** True when the app may save its workouts to Health Connect. */
    @JavascriptInterface
    public boolean hcCanWrite() {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return false;
        }
        try {
            return HealthBridge.canWriteExercise(activity);
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Saves a finished workout as an exercise session ({id, start, end, type, title, notes}; see
     * HealthBridge.writeWorkout). Answers with window.__gh.onHealthWrite({id, ok, error?}).
     */
    @JavascriptInterface
    public void hcWriteWorkout(String json) {
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return;
        }
        try {
            HealthBridge.writeWorkout(activity, json);
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- on-device AI models (ModelStore)

    /** Installed models: [{"id","file","bytes"}]. */
    @JavascriptInterface
    public String modelList() {
        try {
            return models().listJson();
        } catch (Throwable t) {
            return "[]";
        }
    }

    /** Downloads running, waiting, finished or failed this run, and paused ones from before. */
    @JavascriptInterface
    public String modelStatus() {
        try {
            return models().statusJson();
        } catch (Throwable t) {
            return "[]";
        }
    }

    /**
     * Downloads a model in the background ({"id","url","file","bytes","sha256"?,"wifiOnly"}); a
     * partial one resumes. Progress arrives through window.__gh.onModelProgress. False if invalid.
     */
    @JavascriptInterface
    public boolean modelDownload(String json) {
        try {
            return models().download(json);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Stops a download and deletes the partial file (a paused one too). */
    @JavascriptInterface
    public void modelCancel(String id) {
        try {
            models().cancel(id == null ? "" : id);
        } catch (Throwable ignored) {
        }
    }

    /** Deletes an installed model (and stops any download of it). */
    @JavascriptInterface
    public boolean modelDelete(String id) {
        try {
            return models().delete(id == null ? "" : id);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Free bytes on the storage the models go to, or -1. */
    @JavascriptInterface
    public long modelFreeSpace() {
        try {
            return models().freeSpace();
        } catch (Throwable t) {
            return -1;
        }
    }

    /** The phone's total RAM in bytes (a little under what it was sold with), or 0. */
    @JavascriptInterface
    public long deviceMemory() {
        try {
            ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(info);
            return info.totalMem;
        } catch (Throwable t) {
            return 0;
        }
    }

    private ModelStore models() {
        return ModelStore.get(activity);
    }

    private void deliverHealthFailure(String error) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("error", error);
            activity.callJs(MainActivity.jsCall("onHealth", result.toString()));
        } catch (Throwable ignored) {
        }
    }
}
