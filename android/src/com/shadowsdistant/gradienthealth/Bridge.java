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
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * The object exposed to the page as window.AndroidBridge.
 *
 * The WebView calls these methods on its own background thread ("JavaBridge"), so anything that
 * touches the window or starts activities hops to the UI thread. Every method is defensive: it
 * never throws into the page. Nothing here logs its arguments (saveSecret carries the user's
 * Anthropic API key). Methods with side effects answer only the app's own page ({@link #trusted}).
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
    // Static, like the queue below: a new activity's Bridge writes the same file as the old one's.
    private static final Object stateLock = new Object();

    Bridge(MainActivity activity) {
        this.activity = activity;
    }

    /**
     * Whether the page calling in is the app's own (MainActivity.pageTrusted). Every method here that
     * reads or changes the person's data, reaches the network or another app, or runs a model checks
     * it first: a page that isn't the app's gets nothing from it.
     */
    private boolean trusted() {
        return activity.pageTrusted();
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
        if (!trusted()) {
            return false;
        }
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

    /**
     * False when the phone's own touch feedback is switched off: the touch and navigation kinds (taps,
     * ticks, toggles, tabs, ...) are then skipped, and the others (feedback, workout and moments) still
     * play.
     */
    @JavascriptInterface
    public boolean hapticsSystemEnabled() {
        return Haptics.systemTouchFeedback(activity);
    }

    /**
     * A haptic by name, each of the 31 kinds with its own feel (see Haptics). An unknown name plays a
     * tap. It plays from this thread: the vibrator takes calls from any thread, and waiting for the UI
     * thread (busy drawing the change the touch made) would make it land late. Only a phone without a
     * vibrator to drive needs the UI thread, for the view's own touch feedback.
     */
    @JavascriptInterface
    public void haptic(final String kind) {
        if (Haptics.play(activity, kind)) {
            return;
        }
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
        if (!trusted()) {
            return;
        }
        final String pkg = "claude".equals(target) ? MainActivity.CLAUDE_PACKAGE : null;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.shareText(text, pkg);
            }
        });
    }

    /**
     * Hands a picture (a badge's card: a PNG as base64, at most 10 MB) and a line of text to the app
     * the person picks on the share sheet. Anything that isn't a PNG is refused. Returns whether it
     * went to the share sheet.
     */
    @JavascriptInterface
    public boolean shareImage(String b64, String text) {
        if (!trusted()) {
            return false;
        }
        if (b64 == null || b64.isEmpty() || b64.length() > MAX_SHARE_B64) {
            return false;
        }
        final byte[] png;
        try {
            png = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return false;
        }
        if (png.length > MAX_SHARE_BYTES || !isPng(png)) {
            return false;
        }
        // Written here, off the UI thread; the share sheet opens on it.
        final File file = activity.saveSharedImage(png);
        if (file == null) {
            return false;
        }
        final String message = text == null ? "" : text;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.shareImage(file, message);
            }
        });
        return true;
    }

    private static final int MAX_SHARE_BYTES = 10 * 1024 * 1024;
    private static final int MAX_SHARE_B64 = (MAX_SHARE_BYTES / 3 + 1) * 4 + 64;
    private static final byte[] PNG_MAGIC = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};

    static boolean isPng(byte[] data) {
        if (data == null || data.length < PNG_MAGIC.length + 25) {
            return false;
        }
        for (int i = 0; i < PNG_MAGIC.length; i++) {
            if (data[i] != PNG_MAGIC[i]) {
                return false;
            }
        }
        return true;
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
        if (!trusted()) {
            return;
        }
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
     * over the old file, so a crash or power loss leaves either the old or the new state. Returns
     * once it's written: the page calls it as it's hidden, and saveAsync otherwise.
     */
    @JavascriptInterface
    public boolean save(String json) {
        if (!trusted()) {
            return false;
        }
        if (json == null) {
            return false;
        }
        synchronized (stateLock) {
            supersedeQueued();
            boolean ok = writeStateFile(json);
            if (ok) {
                asyncFailed = false;
            }
            return ok;
        }
    }

    /*
     * saveAsync hands the state to one background thread and returns at once, so a save never
     * holds up the page. While a write runs, only the newest state waits for the next one (an older
     * one waiting is dropped), so a burst of saves is two writes at most. Every save takes the next
     * number, and a state is only written if nothing newer was: a waiting state never lands after
     * a newer save(), and load() writes a waiting state before it reads. All static, so a write an
     * old activity queued is ordered with the new one's. If a background write fails, saveAsync
     * says no until a save() works, so the page saves the way that reports failure (and keeps a
     * copy of its own when it does).
     */
    private static final Object queueLock = new Object();
    private static String queuedState; // the newest state waiting to be written, or null
    private static long queuedSeq;
    private static long stateSeq; // the last number handed out
    private static long writtenSeq; // the newest number written (or superseded by save())
    private static volatile boolean asyncFailed;
    private static ExecutorService saveThread;

    /** Saves the state on a background thread and returns at once: true if it was taken. */
    @JavascriptInterface
    public boolean saveAsync(String json) {
        if (!trusted()) {
            return false;
        }
        if (json == null || asyncFailed) {
            return false;
        }
        boolean queued;
        synchronized (queueLock) {
            queued = queuedState != null; // a task is waiting already: it writes this one instead
            queuedState = json;
            queuedSeq = ++stateSeq;
        }
        if (queued) {
            return true;
        }
        try {
            saveExecutor().execute(new Runnable() {
                @Override
                public void run() {
                    writeQueued();
                }
            });
            return true;
        } catch (Throwable t) {
            return writeQueued(); // no thread for it: write it now
        }
    }

    private static ExecutorService saveExecutor() {
        synchronized (queueLock) {
            if (saveThread == null) {
                saveThread = Executors.newSingleThreadExecutor(new ThreadFactory() {
                    @Override
                    public Thread newThread(Runnable r) {
                        Thread t = new Thread(r, "gh-state-save");
                        t.setDaemon(true);
                        return t;
                    }
                });
            }
            return saveThread;
        }
    }

    /** Writes the waiting state, unless something newer was written meanwhile. */
    private boolean writeQueued() {
        String json;
        long seq;
        synchronized (queueLock) {
            json = queuedState;
            seq = queuedSeq;
            queuedState = null;
        }
        if (json == null) {
            return true;
        }
        synchronized (stateLock) {
            synchronized (queueLock) {
                if (seq <= writtenSeq) {
                    return true;
                }
            }
            boolean ok = writeStateFile(json);
            if (ok) {
                synchronized (queueLock) {
                    writtenSeq = Math.max(writtenSeq, seq);
                }
            } else {
                asyncFailed = true;
            }
            return ok;
        }
    }

    /** A save() is newer than any state still waiting: those are never written after it. */
    private static void supersedeQueued() {
        synchronized (queueLock) {
            writtenSeq = ++stateSeq;
        }
    }

    /** The atomic write itself; callers hold stateLock. */
    private boolean writeStateFile(String json) {
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

    /** The last saved state, or "" if there is none (or it can't be read). */
    @JavascriptInterface
    public String load() {
        if (!trusted()) {
            return "";
        }
        synchronized (stateLock) {
            writeQueued(); // a state still waiting (from a page before this one) goes first
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

    // Values are sealed with the app's Android Keystore key (SecretBox) in the "secrets" preferences,
    // which backups leave out. Opened ones are kept in memory for this run, so a screen asking whether
    // there's a key doesn't go to the Keystore every time it draws.
    private final Map<String, String> openedSecrets = new HashMap<String, String>();

    private SharedPreferences secrets() {
        return activity.getSharedPreferences(SECRETS_PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Stores a secret sealed (SecretBox); an empty value removes it. False when it can't be sealed:
     * then nothing new is stored, anywhere.
     */
    @JavascriptInterface
    public boolean saveSecret(String name, String value) {
        if (!trusted()) {
            return false;
        }
        if (name == null || name.isEmpty()) {
            return false;
        }
        synchronized (openedSecrets) {
            openedSecrets.remove(name);
            try {
                boolean empty = value == null || value.isEmpty();
                SharedPreferences.Editor edit = secrets().edit();
                if (empty) {
                    edit.remove(name);
                } else {
                    edit.putString(name, SecretBox.seal(value));
                }
                boolean ok = edit.commit();
                if (ok && !empty) {
                    openedSecrets.put(name, value);
                }
                return ok;
            } catch (Throwable t) {
                return false;
            }
        }
    }

    /**
     * The stored value, or "" if there's none. One saved as plain text before 1.6 is sealed in place
     * the first time it's read. One that can't be opened (its Keystore key is gone, after a restore
     * onto another phone, or it was changed), or a plain one that can't be sealed, is deleted: ""
     * makes the app ask for the key again rather than keep or use a value it can't protect.
     */
    @JavascriptInterface
    public String loadSecret(String name) {
        if (!trusted()) {
            return "";
        }
        if (name == null || name.isEmpty()) {
            return "";
        }
        synchronized (openedSecrets) {
            String opened = openedSecrets.get(name);
            if (opened != null) {
                return opened;
            }
            SharedPreferences prefs;
            String stored;
            try {
                prefs = secrets();
                stored = prefs.getString(name, "");
            } catch (Throwable t) {
                return "";
            }
            if (stored == null || stored.isEmpty()) {
                return "";
            }
            try {
                String value;
                if (SecretBox.isSealed(stored)) {
                    value = SecretBox.open(stored);
                } else {
                    value = stored;
                    if (!prefs.edit().putString(name, SecretBox.seal(value)).commit()) {
                        throw new IllegalStateException("not saved");
                    }
                }
                openedSecrets.put(name, value);
                return value;
            } catch (Throwable t) {
                try {
                    prefs.edit().remove(name).commit();
                } catch (Throwable ignored) {
                }
                return "";
            }
        }
    }

    @JavascriptInterface
    public boolean deleteSecret(String name) {
        if (!trusted()) {
            return false;
        }
        if (name == null || name.isEmpty()) {
            return false;
        }
        synchronized (openedSecrets) {
            openedSecrets.remove(name);
            try {
                return secrets().edit().remove(name).commit();
            } catch (Throwable t) {
                return false;
            }
        }
    }

    // ---------------------------------------------------------------- Health Connect

    /** "unsupported" (below Android 14) | "unavailable" | "denied" | "partial" | "granted". */
    @JavascriptInterface
    public String hcStatus() {
        if (!trusted()) {
            return "unavailable";
        }
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
        if (!trusted()) {
            return;
        }
        requestHealth(false);
    }

    /** The same, plus reading and writing nutrition (when food tracking is on). */
    @JavascriptInterface
    public void hcRequestFood() {
        if (!trusted()) {
            return;
        }
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
        if (!trusted()) {
            return;
        }
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
        if (!trusted()) {
            return;
        }
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
        if (!trusted()) {
            return "[]";
        }
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
        if (!trusted()) {
            return false;
        }
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
        if (!trusted()) {
            return;
        }
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
        if (!trusted()) {
            return;
        }
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
        if (!trusted()) {
            return;
        }
        FoodLookup.lookup(activity, kind, query, id);
    }

    /** True when the app may save its workouts to Health Connect. */
    @JavascriptInterface
    public boolean hcCanWrite() {
        if (!trusted()) {
            return false;
        }
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
        if (!trusted()) {
            return;
        }
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            return;
        }
        try {
            HealthBridge.writeWorkout(activity, json);
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- background sync (HealthSync)

    /**
     * {"supported", "granted", "on", "scheduled", "lastRun", "lastOk", "error", "pending"}: whether
     * this phone's Health Connect can read in the background, whether that's allowed, the Settings
     * switch, whether the job is scheduled, the last run and the last good one (epoch ms or null), why
     * the last run failed (or null) and how many reads wait for the page.
     */
    @JavascriptInterface
    public String hcBackground() {
        if (!trusted()) {
            return "{}";
        }
        try {
            return HealthSync.stateJson(activity);
        } catch (Throwable t) {
            return "{\"supported\":false,\"granted\":false,\"on\":false,\"scheduled\":false,"
                    + "\"lastRun\":null,\"lastOk\":null,\"error\":null,\"pending\":0}";
        }
    }

    /**
     * Asks for Health Connect's background-read permission. Answers like hcRequest (onHealthPerms),
     * and window.__gh.onHealthBackground gets the new hcBackground() state.
     */
    @JavascriptInterface
    public void hcBackgroundRequest() {
        if (!trusted()) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.requestBackgroundPermission();
            }
        });
    }

    /** The Settings switch: schedules or cancels the background sync; onHealthBackground follows. */
    @JavascriptInterface
    public void hcBackgroundSet(boolean on) {
        if (!trusted()) {
            return;
        }
        try {
            HealthSync.setOn(activity, on);
        } catch (Throwable ignored) {
        }
        activity.backgroundChanged(false);
    }

    /**
     * Up to 50 background reads waiting for the page, oldest first:
     * [{"id": "&lt;file name&gt;", "payload": &lt;what onHealth gets&gt;}].
     */
    @JavascriptInterface
    public String hcPending() {
        if (!trusted()) {
            return "[]";
        }
        try {
            return HealthSync.pendingJson(activity);
        } catch (Throwable t) {
            return "[]";
        }
    }

    /** Deletes the background reads the page has folded in (a JSON list of their ids). */
    @JavascriptInterface
    public void hcPendingDone(String jsonArrayOfIds) {
        if (!trusted()) {
            return;
        }
        try {
            HealthSync.done(activity, jsonArrayOfIds);
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- outdoor activities (ActivityService)

    /** {"gps", "steps", "hc", "locationOn"}: what this phone can record with. */
    @JavascriptInterface
    public String actSupport() {
        if (!trusted()) {
            return "{}";
        }
        try {
            return ActivityService.support(activity);
        } catch (Throwable t) {
            return "{\"gps\":false,\"steps\":false,\"hc\":false,\"locationOn\":false}";
        }
    }

    /** {"location", "activity", "notifications": "granted"|"denied"|"ask", "approximate"}. */
    @JavascriptInterface
    public String actPermissions() {
        if (!trusted()) {
            return "{}";
        }
        try {
            return ActivityPermissions.json(activity);
        } catch (Throwable t) {
            return "{\"location\":\"ask\",\"activity\":\"ask\",\"notifications\":\"ask\",\"approximate\":false}";
        }
    }

    /** Asks for location, physical activity and notifications; answers with window.__gh.onActPermissions. */
    @JavascriptInterface
    public void actRequestPermissions() {
        if (!trusted()) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.requestActivityPermissions();
            }
        });
    }

    /** Opens the app's page in the phone's settings (for a permission Android won't ask for again). */
    @JavascriptInterface
    public void actOpenSettings() {
        if (!trusted()) {
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.openAppSettings();
            }
        });
    }

    /**
     * Starts recording ({"id", "type": walk|run|hike|cycle|other, "title", "units"?: km|mi}). False
     * without precise location permission, or while another activity is recording.
     */
    @JavascriptInterface
    public boolean actStart(String json) {
        if (!trusted()) {
            return false;
        }
        try {
            return ActivityService.start(activity, json);
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public void actPause() {
        if (!trusted()) {
            return;
        }
        try {
            ActivityService.pause(activity);
        } catch (Throwable ignored) {
        }
    }

    @JavascriptInterface
    public void actResume() {
        if (!trusted()) {
            return;
        }
        try {
            ActivityService.resume(activity);
        } catch (Throwable ignored) {
        }
    }

    /** Auto-pause and the spoken splits, changed while it records ({"autoPause"?, "voice"?}). */
    @JavascriptInterface
    public void actSetOptions(String json) {
        if (!trusted()) {
            return;
        }
        try {
            ActivityService.setOptions(activity, json);
        } catch (Throwable ignored) {
        }
    }

    /** Finishes the recording; window.__gh.onActivity gets its final state (active false). */
    @JavascriptInterface
    public void actStop() {
        if (!trusted()) {
            return;
        }
        try {
            ActivityService.stop(activity);
        } catch (Throwable ignored) {
        }
    }

    /** The recording in progress, else the newest finished one not cleared yet (see ActivityTrack.stateJson). */
    @JavascriptInterface
    public String actState() {
        if (!trusted()) {
            return "{\"active\":false}";
        }
        try {
            return ActivityService.state(activity);
        } catch (Throwable t) {
            return "{\"active\":false}";
        }
    }

    /** The recording's points from index {@code from}: [[t, lat, lon, alt|null, acc, speed|null, paused], ...]. */
    @JavascriptInterface
    public String actPoints(int from) {
        if (!trusted()) {
            return "[]";
        }
        try {
            return ActivityService.points(activity, from);
        } catch (Throwable t) {
            return "[]";
        }
    }

    /** Deletes a finished recording's files once the page has saved it. */
    @JavascriptInterface
    public void actClear(String id) {
        if (!trusted()) {
            return;
        }
        try {
            ActivityService.clear(activity, id);
        } catch (Throwable ignored) {
        }
    }

    /**
     * An activity's window in Health Connect ({"id", "start", "end"}): steps, distance, calories and
     * heart rate from other apps and watches. Answers with window.__gh.onHcSession.
     */
    @JavascriptInterface
    public void hcSession(String json) {
        if (!trusted()) {
            return;
        }
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            answer("onHcSession", json, "{\"steps\":null,\"distanceM\":null,\"activeKcal\":null,"
                    + "\"totalKcal\":null,\"hr\":[],\"sources\":[]}");
            return;
        }
        try {
            HealthBridge.session(activity, json, HealthBridge.page(activity, "onHcSession"));
        } catch (Throwable t) {
            answer("onHcSession", json, "{\"steps\":null,\"distanceM\":null,\"activeKcal\":null,"
                    + "\"totalKcal\":null,\"hr\":[],\"sources\":[]}");
        }
    }

    /**
     * Saves a recorded activity to Health Connect (see HealthBridge.writeActivity). Answers with
     * window.__gh.onHcActivityWrite({"id", "ok", "error"?, "route"}).
     */
    @JavascriptInterface
    public void hcWriteActivity(String json) {
        if (!trusted()) {
            return;
        }
        if (Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK) {
            answer("onHcActivityWrite", json, "{\"route\":false}");
            return;
        }
        try {
            HealthBridge.writeActivity(activity, json, HealthBridge.page(activity, "onHcActivityWrite"));
        } catch (Throwable t) {
            answer("onHcActivityWrite", json, "{\"route\":false}");
        }
    }

    /** A failure answer ({"id" from the request, "ok": false, "error": "unsupported"} plus {@code rest}). */
    private void answer(String hook, String request, String rest) {
        try {
            JSONObject o = new JSONObject(rest);
            String id = "";
            try {
                id = new JSONObject(request == null ? "{}" : request).optString("id", "");
            } catch (Throwable ignored) {
            }
            o.put("id", id);
            o.put("ok", false);
            o.put("error", Build.VERSION.SDK_INT < HEALTH_CONNECT_MIN_SDK ? "unsupported" : "failed");
            activity.callJs(MainActivity.jsCall(hook, o.toString()));
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- plan links

    /** The plan link the app was opened with (gradienthealth://plan?d=… or a /gradient-health/p/ URL), once; else "". */
    @JavascriptInterface
    public String pendingLink() {
        if (!trusted()) {
            return "";
        }
        String link = activity.takePendingLink();
        return link == null ? "" : link;
    }

    // ---------------------------------------------------------------- on-device AI models (ModelStore)

    /** Installed models: [{"id","file","bytes"}]. */
    @JavascriptInterface
    public String modelList() {
        if (!trusted()) {
            return "[]";
        }
        try {
            return models().listJson();
        } catch (Throwable t) {
            return "[]";
        }
    }

    /** Downloads running, waiting, finished or failed this run, and paused ones from before. */
    @JavascriptInterface
    public String modelStatus() {
        if (!trusted()) {
            return "[]";
        }
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
        if (!trusted()) {
            return false;
        }
        try {
            return models().download(json);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Stops a download and deletes the partial file (a paused one too). */
    @JavascriptInterface
    public void modelCancel(String id) {
        if (!trusted()) {
            return;
        }
        try {
            models().cancel(id == null ? "" : id);
        } catch (Throwable ignored) {
        }
    }

    /** Deletes an installed model (and stops any download of it). */
    @JavascriptInterface
    public boolean modelDelete(String id) {
        if (!trusted()) {
            return false;
        }
        try {
            return models().delete(id == null ? "" : id);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Free bytes on the storage the models go to, or -1. */
    @JavascriptInterface
    public long modelFreeSpace() {
        if (!trusted()) {
            return -1;
        }
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

    // ---------------------------------------------------------------- the native engine (LlmService)

    /** {"ok":true,"threads","cores"} when this install can run the native engine here, else {"ok":false}. */
    @JavascriptInterface
    public String llmNative() {
        if (!trusted()) {
            return "{\"ok\":false}";
        }
        try {
            return activity.llm().availableJson();
        } catch (Throwable t) {
            return "{\"ok\":false}";
        }
    }

    /** Loads an installed model ({"id","ctx","batch"}); events arrive through window.__gh.onLlm. */
    @JavascriptInterface
    public boolean llmLoad(String json) {
        if (!trusted()) {
            return false;
        }
        try {
            JSONObject o = new JSONObject(json);
            File f = models().installedFile(o.optString("id", ""));
            if (f == null) {
                return false;
            }
            activity.llm().load(f, o.optInt("ctx", 2048), o.optInt("batch", 256));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Writes an answer ({"req","prompt",...sampling,"grammar"?}); see LlmClient for the events. */
    @JavascriptInterface
    public boolean llmGenerate(String json) {
        if (!trusted()) {
            return false;
        }
        try {
            activity.llm().generate(new JSONObject(json));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Stops the answer for this request (or drops it if it hasn't started). */
    @JavascriptInterface
    public void llmAbort(String req) {
        if (!trusted()) {
            return;
        }
        try {
            activity.llm().abort(req == null ? "" : req);
        } catch (Throwable ignored) {
        }
    }

    /** Frees the model's memory. */
    @JavascriptInterface
    public void llmUnload() {
        if (!trusted()) {
            return;
        }
        try {
            activity.llm().unload();
        } catch (Throwable ignored) {
        }
    }

    /**
     * How many times the page's renderer has crashed since the app started. The page uses it to tell
     * an out-of-memory crash while the in-app model worked from the app simply being closed.
     */
    @JavascriptInterface
    public int rendererGone() {
        return MainActivity.rendererGoneCount;
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

    // ---------------------------------------------------------------- scroll diagnostics (Diagnostics)

    /**
     * Android's timing of the app's frames and touches between two wall-clock times (ms since the
     * epoch), summed up as JSON (Diagnostics.summary), for the scroll diagnostics report.
     */
    @JavascriptInterface
    public String diagFrames(double from, double to) {
        if (!trusted()) {
            return "";
        }
        return activity.diagnostics().summary((long) from, (long) to);
    }

    /** The display's refresh rate now and the rates it can run at, as JSON. */
    @JavascriptInterface
    public String diagDisplay() {
        if (!trusted()) {
            return "";
        }
        return activity.diagnostics().display();
    }

    /** The display at its fastest refresh rate while true (the glass speed test), Android's choice after. */
    @JavascriptInterface
    public void diagRefresh(boolean high) {
        if (!trusted()) {
            return;
        }
        activity.diagnostics().highRefresh(high);
    }

    /** Starts recording the WebView's own trace events (Android 9+). False if it can't. */
    @JavascriptInterface
    public boolean traceStart() {
        if (!trusted()) {
            return false;
        }
        return activity.diagnostics().traceStart();
    }

    /**
     * Stops the recording and saves it to the app's cache; the page hears onTraceSaved(bytes) once
     * it's all written (bytes is -1 if it couldn't be). False if nothing was being recorded.
     */
    @JavascriptInterface
    public boolean traceStop() {
        if (!trusted()) {
            return false;
        }
        return activity.diagnostics().traceStop(new Diagnostics.SizeCallback() {
            @Override
            public void done(long bytes) {
                activity.callJs(MainActivity.jsCall("onTraceSaved", String.valueOf(bytes)));
            }
        });
    }

    /** The next piece (about 256 KB) of the saved recording, or null at its end. */
    @JavascriptInterface
    public String traceRead() {
        if (!trusted()) {
            return null;
        }
        return activity.diagnostics().traceRead();
    }

    /** The recording has been read (or isn't wanted): it's deleted. */
    @JavascriptInterface
    public void traceDone() {
        if (!trusted()) {
            return;
        }
        activity.diagnostics().traceDone();
    }
}
