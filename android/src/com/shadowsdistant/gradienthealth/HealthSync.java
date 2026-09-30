package com.shadowsdistant.gradienthealth;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.ext.SdkExtensions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Background sync: Health Connect is read every 15 minutes while the app is closed, so the history
 * has no gaps on days the app isn't opened and the plan can use it.
 *
 * {@link HealthSyncJob} runs as a periodic JobScheduler job (15 minutes is Android's minimum; it can
 * run later when the phone is dozing), persisted across reboots, with no network needed. It is
 * scheduled while Health Connect is connected, this phone's Health Connect can read in the background
 * ({@link #supported}), the person allowed it ({@link #PERMISSION}) and the Settings switch is on. Each
 * run reads the last {@link #DAYS} days, the same JSON window.__gh.onHealth gets, and saves it as
 * noBackupFilesDir/health-sync/&lt;epoch ms&gt;.json. The page folds the files in, oldest first, through
 * AndroidBridge.hcPending() and deletes them with hcPendingDone(). A read identical to the last one
 * saved isn't saved again, reads older than a day are thinned to one per 6 hours (each covers two
 * days), and the folder keeps at most 300 files and 3 MB, dropping the oldest.
 *
 * The files are in no-backup storage: they're a queue the page empties, not data to restore.
 *
 * Nothing here touches android.health.connect types: {@link HealthBridge} is only called after the
 * SDK check, so this class loads on every Android version.
 */
final class HealthSync {
    private HealthSync() {
    }

    /** Reading while the app isn't in front (a platform permission from Android 15, API 35). */
    static final String PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND";
    static final int JOB_ID = 4301;
    static final long INTERVAL_MS = 15 * 60 * 1000L;
    private static final long FLEX_MS = 5 * 60 * 1000L;
    /** How far back each background read goes. */
    static final int DAYS = 2;

    private static final String PREFS = "health_sync";
    private static final String DIR = "health-sync";
    private static final int MAX_FILES = 300;
    private static final long MAX_BYTES = 3L * 1024 * 1024;
    private static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    private static final long DAY_MS = 24 * 3600 * 1000L;
    private static final long SLOT_MS = 6 * 3600 * 1000L;
    private static final int PENDING_MAX = 50;
    private static final Pattern FILE = Pattern.compile("\\d{1,19}\\.json");
    private static final String HEX = "0123456789abcdef";
    private static final Object LOCK = new Object();

    // ---------------------------------------------------------------- state

    /**
     * This phone's Health Connect can read in the background: Android 15 and newer, or Android 14
     * with a Health Connect update that knows the permission.
     */
    static boolean supported(Context context) {
        if (Build.VERSION.SDK_INT < Bridge.HEALTH_CONNECT_MIN_SDK || !HealthBridge.available(context)) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= 35) {
            return true;
        }
        try {
            context.getPackageManager().getPermissionInfo(PERMISSION, 0);
            return true;
        } catch (Throwable t) {
            // Not defined here; the SDK extension that brought the feature is another sign of it.
        }
        try {
            return SdkExtensions.getExtensionVersion(Build.VERSION_CODES.UPSIDE_DOWN_CAKE) >= 13;
        } catch (Throwable t) {
            return false;
        }
    }

    static boolean granted(Context context) {
        try {
            return context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** The Settings switch: on unless the person turned it off. */
    static boolean on(Context context) {
        return prefs(context).getBoolean("on", true);
    }

    /** Health Connect is connected (at least one data type may be read). */
    private static boolean connected(Context context) {
        if (Build.VERSION.SDK_INT < Bridge.HEALTH_CONNECT_MIN_SDK) {
            return false;
        }
        try {
            String status = HealthBridge.status(context);
            return "granted".equals(status) || "partial".equals(status);
        } catch (Throwable t) {
            return false;
        }
    }

    /** Why a background read can't run now ("off", "unsupported", "not granted", "not connected"), or null. */
    static String blocker(Context context) {
        if (!on(context)) {
            return "off";
        }
        if (!supported(context)) {
            return "unsupported";
        }
        if (!granted(context)) {
            return "not granted";
        }
        if (!connected(context)) {
            return "not connected";
        }
        return null;
    }

    /** {supported, granted, on, scheduled, lastRun, lastOk, error, pending}, for AndroidBridge.hcBackground(). */
    static String stateJson(Context context) {
        SharedPreferences p = prefs(context);
        try {
            JSONObject o = new JSONObject();
            o.put("supported", supported(context));
            o.put("granted", granted(context));
            o.put("on", on(context));
            o.put("scheduled", scheduled(context));
            long lastRun = p.getLong("lastRun", 0L);
            long lastOk = p.getLong("lastOk", 0L);
            String error = p.getString("error", null);
            o.put("lastRun", lastRun > 0 ? (Object) lastRun : JSONObject.NULL);
            o.put("lastOk", lastOk > 0 ? (Object) lastOk : JSONObject.NULL);
            o.put("error", error != null && !error.isEmpty() ? error : JSONObject.NULL);
            o.put("pending", pendingCount(context));
            return o.toString();
        } catch (Throwable t) {
            return "{\"supported\":false,\"granted\":false,\"on\":false,\"scheduled\":false,"
                    + "\"lastRun\":null,\"lastOk\":null,\"error\":null,\"pending\":0}";
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- the job

    /** The Settings switch. Schedules or cancels the job to match. */
    static void setOn(Context context, boolean on) {
        prefs(context).edit().putBoolean("on", on).apply();
        update(context);
    }

    static boolean scheduled(Context context) {
        try {
            JobScheduler js = context.getSystemService(JobScheduler.class);
            return js != null && js.getPendingJob(JOB_ID) != null;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Schedules the job when it can run and isn't scheduled yet (rescheduling would restart its
     * 15-minute clock), and cancels it when it can't. Called on app start, after permission answers,
     * from the Settings switch and by the job itself.
     */
    static synchronized void update(Context context) {
        try {
            JobScheduler js = context.getSystemService(JobScheduler.class);
            if (js == null) {
                return;
            }
            JobInfo current = js.getPendingJob(JOB_ID);
            if (blocker(context) != null) {
                if (current != null) {
                    js.cancel(JOB_ID);
                }
                return;
            }
            if (current != null && current.isPeriodic() && current.getIntervalMillis() == INTERVAL_MS
                    && current.isPersisted()) {
                return;
            }
            js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, HealthSyncJob.class))
                    .setPeriodic(INTERVAL_MS, FLEX_MS)
                    .setPersisted(true) // needs RECEIVE_BOOT_COMPLETED
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                    .build());
        } catch (Throwable ignored) {
            // No scheduler, or it refused the job: the app still syncs while it's open.
        }
    }

    /** {@link #update} off the calling thread (JobScheduler calls are binder calls). */
    static void updateLater(final Context context) {
        final Context app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        new Thread(new Runnable() {
            @Override
            public void run() {
                update(app);
            }
        }, "gradient-health-sync").start();
    }

    static void markRun(Context context, long at) {
        prefs(context).edit().putLong("lastRun", at).apply();
    }

    /**
     * Keeps one background read: saves the payload unless it failed or matches the last one saved,
     * and records how it went. Returns true when the read counts as a success.
     */
    static boolean finishRun(Context context, String json, long at) {
        String error;
        boolean ok = false;
        try {
            JSONObject payload = new JSONObject(json == null ? "{}" : json);
            error = problem(payload);
            if (error == null) {
                ok = true;
                String hash = contentHash(payload);
                SharedPreferences p = prefs(context);
                if (!hash.equals(p.getString("lastHash", ""))) {
                    if (save(context, payload.toString(), System.currentTimeMillis())) {
                        p.edit().putString("lastHash", hash).apply();
                    } else {
                        error = "couldn't save";
                        ok = false;
                    }
                }
            }
        } catch (Throwable t) {
            error = t.getClass().getSimpleName();
        }
        SharedPreferences.Editor e = prefs(context).edit();
        if (ok) {
            e.putLong("lastOk", at).remove("error");
        } else {
            e.putString("error", error == null ? "failed" : error);
        }
        e.apply();
        return ok;
    }

    /** Records why a run didn't read anything (see {@link #blocker}). */
    static void skipRun(Context context, long at, String why) {
        prefs(context).edit().putLong("lastRun", at).putString("error", why).apply();
    }

    /**
     * Null when the payload is worth keeping: it's ok and at least one data type was read. Types that
     * aren't allowed don't count as failures; ones that timed out or were refused do.
     */
    private static String problem(JSONObject payload) {
        if (!payload.optBoolean("ok", false)) {
            String error = payload.optString("error", "");
            return error.isEmpty() ? "failed" : error;
        }
        JSONObject errors = payload.optJSONObject("errors");
        int allowed = 0;
        int failed = 0;
        String first = null;
        JSONArray names = errors == null ? null : errors.names();
        Set<String> notGranted = new HashSet<String>();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String key = names.optString(i);
                String message = errors.optString(key, "");
                if ("not granted".equals(message)) {
                    notGranted.add(key);
                } else if (!message.startsWith("truncated")) {
                    failed++;
                    if (first == null) {
                        first = message;
                    }
                }
            }
        }
        JSONArray keys = payload.names();
        for (int i = 0; keys != null && i < keys.length(); i++) {
            String key = keys.optString(i);
            if (payload.optJSONArray(key) != null && !notGranted.contains(key)) {
                allowed++;
            }
        }
        if (allowed == 0) {
            return "not granted";
        }
        return failed >= allowed ? (first == null ? "failed" : first) : null;
    }

    /** The payload without its time window, so two reads of the same records match. */
    private static String contentHash(JSONObject payload) {
        try {
            JSONObject copy = new JSONObject(payload.toString());
            copy.remove("from");
            copy.remove("to");
            copy.remove("errors");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(copy.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) {
                sb.append(HEX.charAt((digest[i] >> 4) & 0xf)).append(HEX.charAt(digest[i] & 0xf));
            }
            return sb.toString();
        } catch (Throwable t) {
            return String.valueOf(System.nanoTime()); // never matches: the read is kept
        }
    }

    // ---------------------------------------------------------------- the files

    private static File dir(Context context) {
        return new File(context.getNoBackupFilesDir(), DIR);
    }

    /** Writes one payload as &lt;at&gt;.json (tmp file, fsync, rename), then trims the folder. */
    static boolean save(Context context, String json, long at) {
        synchronized (LOCK) {
            File dir = dir(context);
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return false;
            }
            File out = new File(dir, at + ".json");
            while (out.exists()) {
                at++;
                out = new File(dir, at + ".json");
            }
            File tmp = new File(dir, at + ".tmp");
            FileOutputStream stream = null;
            try {
                stream = new FileOutputStream(tmp);
                stream.write(json.getBytes(StandardCharsets.UTF_8));
                stream.flush();
                try {
                    stream.getFD().sync();
                } catch (IOException ignored) {
                }
                stream.close();
                stream = null;
                if (!tmp.renameTo(out)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    return false;
                }
            } catch (Throwable t) {
                return false;
            } finally {
                if (stream != null) {
                    try {
                        stream.close();
                    } catch (IOException ignored) {
                    }
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                }
            }
            prune(dir, System.currentTimeMillis());
            return true;
        }
    }

    /** The saved reads, oldest first. */
    private static File[] files(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return new File[0];
        }
        List<File> out = new ArrayList<File>();
        for (File f : files) {
            if (FILE.matcher(f.getName()).matches()) {
                out.add(f);
            }
        }
        File[] sorted = out.toArray(new File[0]);
        Arrays.sort(sorted, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                return Long.compare(stamp(a), stamp(b));
            }
        });
        return sorted;
    }

    private static long stamp(File f) {
        String name = f.getName();
        try {
            return Long.parseLong(name.substring(0, name.length() - ".json".length()));
        } catch (Throwable t) {
            return -1L;
        }
    }

    /**
     * Reads older than a day: the newest in each 6-hour slot is enough, since each covers two days and
     * the page folds them in order. Then at most MAX_FILES files and MAX_BYTES, dropping the oldest.
     * Leftover .tmp files from an interrupted save go too.
     */
    static void prune(File dir, long now) {
        File[] all = dir.listFiles();
        if (all != null) {
            for (File f : all) {
                if (f.getName().endsWith(".tmp") && now - f.lastModified() > 60000L) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }
        File[] files = files(dir);
        List<File> keep = new ArrayList<File>();
        Set<Long> slots = new HashSet<Long>();
        for (int i = files.length - 1; i >= 0; i--) {
            long t = stamp(files[i]);
            if (now - t > DAY_MS && !slots.add(t / SLOT_MS)) {
                //noinspection ResultOfMethodCallIgnored
                files[i].delete();
                continue;
            }
            keep.add(0, files[i]);
        }
        long total = 0L;
        for (File f : keep) {
            total += f.length();
        }
        int count = keep.size();
        for (int i = 0; i < keep.size() && (count > MAX_FILES || total > MAX_BYTES); i++) {
            total -= keep.get(i).length();
            count--;
            //noinspection ResultOfMethodCallIgnored
            keep.get(i).delete();
        }
    }

    static int pendingCount(Context context) {
        synchronized (LOCK) {
            return files(dir(context)).length;
        }
    }

    /**
     * Up to 50 saved reads, oldest first: [{"id": "&lt;file name&gt;", "payload": {...}}]. A file that
     * isn't valid JSON (cut off by a crash) is deleted instead.
     */
    static String pendingJson(Context context) {
        synchronized (LOCK) {
            JSONArray out = new JSONArray();
            for (File f : files(dir(context))) {
                if (out.length() >= PENDING_MAX) {
                    break;
                }
                try {
                    if (f.length() > MAX_FILE_BYTES) {
                        throw new IOException("too big");
                    }
                    JSONObject payload = new JSONObject(read(f));
                    JSONObject item = new JSONObject();
                    item.put("id", f.getName());
                    item.put("payload", payload);
                    out.put(item);
                } catch (Throwable t) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
            return out.toString();
        }
    }

    /** Deletes the reads the page has folded in (a JSON list of ids from {@link #pendingJson}). */
    static void done(Context context, String idsJson) {
        synchronized (LOCK) {
            try {
                JSONArray ids = new JSONArray(idsJson == null ? "[]" : idsJson);
                File dir = dir(context);
                for (int i = 0; i < ids.length() && i < 1000; i++) {
                    String id = ids.optString(i, "");
                    if (FILE.matcher(id).matches()) {
                        //noinspection ResultOfMethodCallIgnored
                        new File(dir, id).delete();
                    }
                }
            } catch (Throwable ignored) {
            }
        }
    }

    private static String read(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream((int) Math.min(f.length(), MAX_FILE_BYTES) + 16);
            byte[] chunk = new byte[16 * 1024];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, n);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }
}
