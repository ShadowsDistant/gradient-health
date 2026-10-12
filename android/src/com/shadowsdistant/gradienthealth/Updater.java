package com.shadowsdistant.gradienthealth;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.os.StatFs;
import android.provider.Settings;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Updates from the app's own GitHub release (the page's side is src/update.js; docs/DEVELOPING.md,
 * Updates). CI's release job publishes version.json next to the APK on the release tagged "latest":
 * the build's versionName and versionCode, the APK's name, size and SHA-256, and What's new in the
 * store's words.
 *
 * Check: version.json over HTTPS only, following redirects by hand and only to github.com and
 * *.githubusercontent.com, 64 KB at most, with timeouts and a deadline; its versionCode against this
 * install's.
 *
 * Download: the APK to the app's cache (cache/updates/), on one background thread, with progress to
 * window.__gh.onUpdate at most 4 times a second. version.json is read again first, so it's always the
 * newest build. Cancel stops it and deletes what it had; a download cut short (the connection, the
 * app closed) carries on from its .part with a Range request, or starts again when the server sends
 * the whole file. 150 MB at most. Then its size and SHA-256 must be version.json's, and Android must
 * read it as this app (the package name) at version.json's versionCode, signed with the same
 * certificate as the app that's running. Anything else is deleted, and the page hears why.
 *
 * Install: a PackageInstaller session (no FileProvider), with its bytes hashed again as they're
 * written in. Android answers through a PendingIntent to {@link Receiver}: when it needs the person
 * to confirm, its confirmation screen is started. On Android 8 and newer, an app not yet allowed to
 * install apps opens Settings at "Install unknown apps" for Gradient Health instead, and the page
 * hears "permission", so it can explain and try again when the person comes back.
 *
 * Only where it makes sense ({@link #whyNot}): an install that declares REQUEST_INSTALL_PACKAGES (the
 * Play bundle goes without it, scripts/build-aab.sh: Play updates the app there), wasn't installed by
 * Google Play, and is signed with the release key (android/release-cert.sha256), the only key a
 * release is ever signed with. Every change goes to the page as one snapshot ({@link #snapshot}).
 * Nothing here is logged.
 */
public final class Updater {
    static final String RELEASE = "https://github.com/ShadowsDistant/gradient-health/releases/download/latest/";
    static final String VERSION_URL = RELEASE + "version.json";
    static final String PLAY_STORE = "com.android.vending";
    static final String INSTALL_PERMISSION = "android.permission.REQUEST_INSTALL_PACKAGES";
    /** android/release-cert.sha256, the release key's certificate (test/security.mjs keeps them the same). */
    static final String RELEASE_CERT_SHA256 = "f32f5e8302cb9ec6f470254af7f9c894b6ac105a9f173988edf5ed536dc3f55f";
    static final String ACTION_STATUS = "com.shadowsdistant.gradienthealth.UPDATE_STATUS";

    static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    private static final int MAX_JSON_BYTES = 64 * 1024;
    private static final int MAX_NOTES = 2000;
    private static final int MAX_REDIRECTS = 5;
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final long CHECK_DEADLINE_MS = 30000;
    private static final long REPORT_MS = 250;
    private static final int MAX_TRIES = 4;
    /** Room for the download, the copy Android's installer makes of it, and this much more. */
    private static final long SPACE_MARGIN = 32L * 1024 * 1024;
    private static final int BUFFER_BYTES = 64 * 1024;
    private static final String DIR = "updates";
    private static final String LATEST_FILE = "latest.json";

    private static final Pattern VERSION_NAME = Pattern.compile("[0-9A-Za-z][0-9A-Za-z._+-]{0,31}");
    private static final Pattern APK_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,79}\\.apk");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern CONTENT_RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+|\\*)", Pattern.CASE_INSENSITIVE);

    private static Updater instance;

    private final Context context;
    private final String installedName;
    private final long installedCode;
    private ExecutorService executor;

    // Guarded by this: where the update stands (see snapshot()).
    private String phase = "idle";
    private String step;
    private String error;
    private String done;
    private Release latest;
    private long checkedAt;
    private long loaded;
    private long total;
    private long bps;
    private long needed = -1;
    private long free = -1;
    private long reportedAt;
    private long reportedLoaded;
    private boolean restored;
    /** The install session handed to Android last: a status for any other is old news. */
    private int sessionId = -1;

    // The download running now, for Cancel.
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    private Updater(Context context) {
        this.context = context;
        String name = "";
        long code = 0;
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            name = info.versionName == null ? "" : info.versionName;
            code = versionCode(info);
        } catch (Throwable ignored) {
        }
        installedName = name;
        installedCode = code;
    }

    static synchronized Updater get(Context context) {
        if (instance == null) {
            Context app = context.getApplicationContext();
            instance = new Updater(app != null ? app : context);
        }
        return instance;
    }

    /** What version.json says, checked field by field. */
    static final class Release {
        final String versionName;
        final long versionCode;
        final String apk;
        final long size;
        final String sha256;
        final String notes;

        private Release(String versionName, long versionCode, String apk, long size, String sha256, String notes) {
            this.versionName = versionName;
            this.versionCode = versionCode;
            this.apk = apk;
            this.size = size;
            this.sha256 = sha256;
            this.notes = notes;
        }

        static Release from(JSONObject o) throws Failure {
            String name = o.optString("versionName", "");
            long code = o.optLong("versionCode", -1);
            JSONObject apk = o.optJSONObject("apk");
            if (!VERSION_NAME.matcher(name).matches() || code < 1 || code > 2100000000L || apk == null) {
                throw new Failure("bad", false, "version");
            }
            String file = apk.optString("name", "");
            long size = apk.optLong("size", -1);
            String sha = apk.optString("sha256", "").toLowerCase(Locale.ROOT);
            if (!APK_NAME.matcher(file).matches() || size <= 0 || !SHA256.matcher(sha).matches()) {
                throw new Failure("bad", false, "apk");
            }
            if (size > MAX_APK_BYTES) {
                throw new Failure("toobig", false, "size " + size);
            }
            String notes = o.optString("notes", "").trim();
            if (notes.length() > MAX_NOTES) {
                notes = notes.substring(0, MAX_NOTES);
            }
            return new Release(name, code, file, size, sha, notes);
        }

        /** For the page: no file name or hash, which only this side uses. */
        JSONObject forPage() throws JSONException {
            return new JSONObject().put("versionName", versionName).put("versionCode", versionCode)
                    .put("size", size).put("notes", notes);
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject().put("versionName", versionName).put("versionCode", versionCode)
                    .put("apk", new JSONObject().put("name", apk).put("size", size).put("sha256", sha256))
                    .put("notes", notes);
        }
    }

    /** Why a step stopped: retry means a download may try again after a pause. */
    static final class Failure extends Exception {
        final String code;
        final boolean retry;
        long needed = -1;
        long free = -1;

        Failure(String code, boolean retry, String detail) {
            super(detail);
            this.code = code;
            this.retry = retry;
        }
    }

    // ---------------------------------------------------------------- for Bridge

    /** {"ok", "why"?, "canInstall"}: whether this install updates itself (see whyNot). */
    String supportJson() {
        JSONObject o = new JSONObject();
        try {
            String why = whyNot();
            o.put("ok", why == null);
            if (why != null) {
                o.put("why", why);
            }
            o.put("canInstall", canInstall());
        } catch (JSONException ignored) {
        }
        return o.toString();
    }

    /**
     * Why this install doesn't update itself, or null when it does: "store" (no install permission:
     * the Play bundle, where Play updates it), "play" (installed by Google Play) or "key" (not signed
     * with the release key, like a test build: a release couldn't install over it).
     */
    String whyNot() {
        if (!declares(INSTALL_PERMISSION)) {
            return "store";
        }
        if (PLAY_STORE.equals(installer())) {
            return "play";
        }
        if (!Collections.singleton(RELEASE_CERT_SHA256).equals(installedSigners())) {
            return "key";
        }
        return null;
    }

    /** Where the update stands, for a page that was just loaded (or reloaded). */
    synchronized String stateJson() {
        restore();
        return snapshot().toString();
    }

    /** Reads version.json in the background. False (with the state as it is) while another step runs. */
    boolean check() {
        synchronized (this) {
            restore();
            if (!idleNow()) {
                send();
                return false;
            }
            setPhase("checking", null, null);
        }
        executor().execute(new Runnable() {
            @Override
            public void run() {
                runCheck();
            }
        });
        return true;
    }

    /** Downloads the newest version and checks it. False (with the state as it is) while another step runs. */
    boolean download() {
        synchronized (this) {
            restore();
            if (!idleNow()) {
                send();
                return false;
            }
            cancelled = false;
            loaded = 0;
            total = latest != null ? latest.size : 0;
            bps = 0;
            needed = -1;
            free = -1;
            setPhase("downloading", null, null);
        }
        executor().execute(new Runnable() {
            @Override
            public void run() {
                runDownload();
            }
        });
        return true;
    }

    /** Stops the download and deletes what it had. */
    void cancel() {
        synchronized (this) {
            if (!"downloading".equals(phase) && !"verifying".equals(phase)) {
                return;
            }
            cancelled = true;
        }
        HttpURLConnection c = connection;
        if (c != null) {
            try {
                c.disconnect(); // unblocks a read in progress
            } catch (Throwable ignored) {
            }
        }
    }

    /**
     * Hands the downloaded update to Android's installer. Without the permission to install apps,
     * opens Settings at it instead (phase "permission"). False if nothing is ready to install.
     */
    boolean install() {
        final Release r;
        final File apk;
        synchronized (this) {
            restore();
            if (!"ready".equals(phase) && !"permission".equals(phase) && !"confirm".equals(phase)) {
                send();
                return false;
            }
            r = latest;
            apk = r == null ? null : readyFile(r);
            if (apk == null) {
                end("install", "failed", "install", "missing");
                return false;
            }
            if (!canInstall()) {
                setPhase("permission", null, null);
                openInstallSettings();
                return true;
            }
            setPhase("installing", null, null);
        }
        executor().execute(new Runnable() {
            @Override
            public void run() {
                runInstall(r, apk);
            }
        });
        return true;
    }

    // ---------------------------------------------------------------- checking (background thread)

    private void runCheck() {
        Release r;
        try {
            r = fetchRelease(false);
        } catch (Failure f) {
            synchronized (this) {
                end("check", "failed", "check", f.code);
            }
            return;
        }
        synchronized (this) {
            found(r);
            end("check", r.versionCode > installedCode ? (readyFile(r) != null ? "ready" : "available") : "current", null, null);
        }
    }

    /** A release just read: kept (in cache/updates/latest.json too), and files of any other dropped. */
    private void found(Release r) {
        latest = r;
        checkedAt = System.currentTimeMillis();
        try {
            writeAtomically(new File(dir(), LATEST_FILE), r.toJson().put("checkedAt", checkedAt).toString());
        } catch (JSONException ignored) {
        }
        dropFiles(r.versionCode > installedCode ? r : null);
    }

    /** version.json, read and checked, within CHECK_DEADLINE_MS. cancellable: for a download, which Cancel stops. */
    private Release fetchRelease(boolean cancellable) throws Failure {
        if (!online()) {
            throw new Failure("offline", false, "no network");
        }
        long deadline = System.nanoTime() + CHECK_DEADLINE_MS * 1000000L;
        HttpURLConnection c = null;
        InputStream in = null;
        try {
            c = open(VERSION_URL, 0, deadline, cancellable);
            int code = c.getResponseCode();
            if (code == 404) {
                throw new Failure("notfound", false, "HTTP 404"); // no such release yet, or the repository is private
            }
            if (code != 200) {
                throw new Failure("http", false, "HTTP " + code);
            }
            if (c.getContentLengthLong() > MAX_JSON_BYTES) {
                throw new Failure("bad", false, "too long");
            }
            in = c.getInputStream();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                body.write(buf, 0, n);
                if (body.size() > MAX_JSON_BYTES) {
                    throw new Failure("bad", false, "too long");
                }
                if (System.nanoTime() > deadline) {
                    throw new Failure("timeout", false, "too slow");
                }
            }
            JSONObject o;
            try {
                o = new JSONObject(new String(body.toByteArray(), StandardCharsets.UTF_8));
            } catch (JSONException e) {
                throw new Failure("bad", false, "not JSON");
            }
            return Release.from(o);
        } catch (IOException e) {
            if (cancellable && cancelled) {
                throw cancelledFailure(); // Cancel closed the connection
            }
            throw new Failure(e instanceof SocketTimeoutException ? "timeout" : online() ? "network" : "offline", false, e.toString());
        } finally {
            closeQuietly(in);
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    /**
     * Opens an address on GitHub, following redirects by hand: HTTPS only, and only to github.com and
     * *.githubusercontent.com (where release files are served from). Returns once the last one
     * answers. deadline: System.nanoTime() to give up at (Long.MAX_VALUE for none).
     */
    private HttpURLConnection open(String address, long from, long deadline, boolean cancellable) throws IOException, Failure {
        URL url = new URL(address);
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            if (!allowed(url)) {
                throw new Failure("http", false, "redirected to " + url.getHost());
            }
            long left = deadline == Long.MAX_VALUE ? Long.MAX_VALUE : (deadline - System.nanoTime()) / 1000000L;
            if (left <= 0) {
                throw new Failure("timeout", false, "too slow");
            }
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            if (cancellable) {
                connection = c;
                if (cancelled) {
                    c.disconnect();
                    throw cancelledFailure();
                }
            }
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout((int) Math.min(CONNECT_TIMEOUT_MS, left));
            c.setReadTimeout((int) Math.min(READ_TIMEOUT_MS, left));
            c.setUseCaches(false);
            // The app's version, and nothing about the phone (the default names its model and build).
            c.setRequestProperty("User-Agent", "GradientHealth/" + installedName);
            c.setRequestProperty("Accept-Encoding", "identity");
            if (from > 0) {
                c.setRequestProperty("Range", "bytes=" + from + "-");
            }
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Failure("http", true, "redirect without a location");
                }
                url = new URL(url, location);
                continue;
            }
            return c;
        }
        throw new Failure("http", false, "too many redirects");
    }

    /** HTTPS, on the usual port, at github.com or a host under githubusercontent.com. */
    static boolean allowed(URL url) {
        if (url == null || !"https".equalsIgnoreCase(url.getProtocol()) || url.getHost() == null
                || (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null) {
            return false;
        }
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return "github.com".equals(host) || host.endsWith(".githubusercontent.com");
    }

    // ---------------------------------------------------------------- downloading (background thread)

    private void runDownload() {
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        } catch (Throwable ignored) {
        }
        File part = null;
        try {
            if (cancelled) {
                throw cancelledFailure();
            }
            Release r = fetchRelease(true); // what's there now: the newest build, and its hash
            synchronized (this) {
                found(r);
                if (r.versionCode <= installedCode) {
                    end("download", "current", null, null);
                    return;
                }
                total = r.size;
            }
            File dir = dir();
            File apk = new File(dir, r.versionCode + ".apk");
            if (!apk.isFile() || apk.length() != r.size) {
                part = new File(dir, r.versionCode + ".apk.part");
                fetch(r, part);
                synchronized (this) {
                    setPhase("verifying", null, null);
                }
                verify(r, part);
                if (!part.renameTo(apk)) {
                    throw new Failure("io", false, "can't rename the download");
                }
                part = null;
            }
            synchronized (this) {
                loaded = r.size;
                end("download", "ready", null, null);
            }
        } catch (Failure f) {
            boolean stopped = "cancelled".equals(f.code);
            // What it has stays for the next try to carry on from, unless it's cancelled or wrong.
            if (part != null && (stopped || badBytes(f.code))) {
                deleteFile(part);
            }
            synchronized (this) {
                if (stopped) {
                    end("download", latest != null && latest.versionCode > installedCode ? "available" : "idle", null, null);
                } else {
                    needed = f.needed;
                    free = f.free;
                    end("download", "failed", "download", f.code);
                }
            }
        } catch (Throwable t) {
            synchronized (this) {
                end("download", "failed", "download", "io");
            }
        } finally {
            connection = null;
        }
    }

    /** Failures that mean the file itself is wrong: it's deleted, never carried on from. */
    static boolean badBytes(String code) {
        return "size".equals(code) || "checksum".equals(code) || "format".equals(code) || "package".equals(code)
                || "version".equals(code) || "signature".equals(code);
    }

    /** The whole APK into the .part, carrying on from what it has, trying again while it gets somewhere. */
    private void fetch(Release r, File part) throws Failure {
        int failures = 0;
        while (true) {
            if (cancelled) {
                throw cancelledFailure();
            }
            long before = part.isFile() ? part.length() : 0;
            try {
                transfer(r, part);
                return;
            } catch (Failure f) {
                if (!f.retry) {
                    throw f;
                }
                if (part.length() > before) {
                    failures = 0; // it got somewhere: only give up on a download that's stuck
                }
                if (++failures >= MAX_TRIES) {
                    throw new Failure(f.code, false, f.getMessage());
                }
                pause(Math.min(8000L, 1000L << failures));
            }
        }
    }

    /** One attempt: continues the .part from its end and returns once it holds the whole file. */
    private void transfer(Release r, File part) throws Failure {
        long have = part.isFile() ? part.length() : 0;
        if (have > r.size) {
            truncate(part);
            have = 0;
        }
        HttpURLConnection c = null;
        InputStream in = null;
        FileOutputStream out = null;
        try {
            if (!online()) {
                throw new Failure("offline", true, "no network");
            }
            c = open(RELEASE + r.apk, have, Long.MAX_VALUE, true);
            int code = c.getResponseCode();
            if (code == 416 && have > 0) {
                if (have == r.size) {
                    return; // it was all there already: verify() decides
                }
                truncate(part);
                throw new Failure("network", true, "HTTP 416");
            }
            if (code == 206) {
                long[] range = contentRange(c.getHeaderField("Content-Range"));
                if (range == null || range[0] != have) {
                    truncate(part);
                    throw new Failure("network", true, "unexpected Content-Range");
                }
                if (range[2] >= 0 && range[2] != r.size) {
                    throw new Failure("size", false, "size " + range[2]); // another build than version.json's
                }
            } else if (code == 200) {
                long length = c.getContentLengthLong();
                if (length >= 0 && length != r.size) {
                    throw new Failure("size", false, "size " + length); // another build than version.json's
                }
                if (have > 0) {
                    truncate(part); // the server sent the whole file: start again
                    have = 0;
                }
            } else if (code == 404) {
                throw new Failure("notfound", false, "HTTP 404");
            } else {
                throw new Failure("http", code == 408 || code == 429 || code >= 500, "HTTP " + code);
            }
            long room = freeSpace();
            long need = (r.size - have) + r.size + SPACE_MARGIN;
            if (room >= 0 && room < need) {
                throw space(need, room);
            }
            in = c.getInputStream();
            out = new FileOutputStream(part, true);
            synchronized (this) {
                loaded = have;
                total = r.size;
                reportedAt = System.nanoTime() / 1000000L;
                reportedLoaded = have;
                bps = 0;
                send();
            }
            byte[] buf = new byte[BUFFER_BYTES];
            long got = have;
            int n;
            while ((n = in.read(buf)) != -1) {
                if (cancelled) {
                    throw cancelledFailure();
                }
                got += n;
                if (got > r.size) {
                    truncate(part);
                    throw new Failure("size", false, "more than " + r.size + " bytes");
                }
                out.write(buf, 0, n);
                progress(got);
            }
            out.flush();
            try {
                out.getFD().sync();
            } catch (IOException ignored) {
            }
            if (got < r.size) {
                throw new Failure("network", true, "the connection closed early");
            }
        } catch (IOException e) {
            if (cancelled) {
                throw cancelledFailure();
            }
            long room = freeSpace();
            String message = String.valueOf(e.getMessage());
            if (message.contains("ENOSPC") || message.contains("No space") || (room >= 0 && room < 1024 * 1024)) {
                throw space(Math.max(0, r.size - part.length()) + r.size + SPACE_MARGIN, room);
            }
            throw new Failure(online() ? "network" : "offline", true, e.toString());
        } finally {
            closeQuietly(out);
            closeQuietly(in);
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {
                }
            }
            connection = null;
        }
    }

    /** The download is version.json's file, and an update of this app signed with its key. */
    private void verify(Release r, File file) throws Failure {
        if (file.length() != r.size) {
            throw new Failure("size", false, "size " + file.length());
        }
        if (!r.sha256.equals(sha256Of(file))) {
            throw new Failure("checksum", false, "sha256");
        }
        if (cancelled) {
            throw cancelledFailure();
        }
        checkPackage(r, file);
    }

    /**
     * Android's own reading of the APK: this app's package, at version.json's versionCode, signed by
     * exactly the certificates the installed app is signed with.
     */
    private void checkPackage(Release r, File file) throws Failure {
        PackageInfo info = archiveInfo(file);
        if (info == null) {
            throw new Failure("format", false, "not an app Android can read");
        }
        if (!context.getPackageName().equals(info.packageName)) {
            throw new Failure("package", false, String.valueOf(info.packageName));
        }
        if (versionCode(info) != r.versionCode) {
            throw new Failure("version", false, "versionCode " + versionCode(info));
        }
        Set<String> theirs = signers(info);
        if (theirs.isEmpty() || !theirs.equals(installedSigners())) {
            throw new Failure("signature", false, "another certificate");
        }
    }

    // ---------------------------------------------------------------- installing

    private void runInstall(Release r, File apk) {
        PackageInstaller.Session session = null;
        try {
            checkPackage(r, apk); // the hash is checked below, on the bytes the installer gets
            PackageInstaller installer = context.getPackageManager().getPackageInstaller();
            for (PackageInstaller.SessionInfo old : installer.getMySessions()) {
                try {
                    installer.abandonSession(old.getSessionId()); // an earlier try left waiting
                } catch (Throwable ignored) {
                }
            }
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            params.setSize(apk.length());
            params.setInstallReason(PackageManager.INSTALL_REASON_USER);
            int id = installer.createSession(params);
            session = installer.openSession(id);
            write(session, apk, r);
            // Explicit (this app's receiver), so the PendingIntent can be mutable for the status
            // extras Android adds.
            Intent status = new Intent(ACTION_STATUS).setClass(context, Receiver.class).setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent pending = PendingIntent.getBroadcast(context, id, status, flags);
            synchronized (this) {
                sessionId = id;
            }
            session.commit(pending.getIntentSender());
            session.close();
            session = null;
            // Android answers through Receiver.
        } catch (Failure f) {
            abandon(session);
            boolean bad = badBytes(f.code);
            if (bad) {
                dropFiles(null);
            }
            synchronized (this) {
                end("install", bad ? "failed" : "ready", "install", f.code);
            }
        } catch (Throwable t) {
            abandon(session);
            synchronized (this) {
                end("install", "ready", "install", "failed");
            }
        }
    }

    /** The APK into the session, hashed as it goes: the installer gets exactly the bytes checked. */
    private void write(PackageInstaller.Session session, File apk, Release r) throws Failure, IOException {
        OutputStream out = null;
        InputStream in = null;
        try {
            out = session.openWrite("base.apk", 0, apk.length());
            in = new FileInputStream(apk);
            MessageDigest digest = sha256();
            byte[] buf = new byte[BUFFER_BYTES];
            long written = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                digest.update(buf, 0, n);
                written += n;
            }
            session.fsync(out);
            if (written != r.size || !r.sha256.equals(hex(digest.digest()))) {
                throw new Failure("checksum", false, "changed on the phone");
            }
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    /** Android's answer about the install, through the PendingIntent (Receiver). */
    @SuppressWarnings("deprecation") // getParcelableExtra(String, Class) is Android 13+
    void onStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        synchronized (this) {
            restore();
            // An earlier session's answer (it was abandoned for a new try) changes nothing.
            if (intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1) != sessionId
                    || (!"installing".equals(phase) && !"confirm".equals(phase))) {
                return;
            }
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Object extra = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (!(extra instanceof Intent)) {
                    end("install", "ready", "install", "failed");
                    return;
                }
                setPhase("confirm", null, null);
                confirm((Intent) extra);
                return;
            }
            if (status == PackageInstaller.STATUS_SUCCESS) {
                // Usually never heard: Android stops the app to replace it.
                dropFiles(null);
                end("install", "current", null, null);
                return;
            }
            String code = installError(status);
            boolean bad = "invalid".equals(code) || "conflict".equals(code) || "incompatible".equals(code);
            if (bad) {
                dropFiles(null);
            }
            end("install", bad ? "failed" : "ready", "install", code);
        }
    }

    static String installError(int status) {
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return "aborted"; // the person said no, or backed out
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "blocked";
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                return "conflict";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "incompatible";
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return "invalid";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "storage";
            default:
                return "failed";
        }
    }

    /** Android's confirmation screen, over the app (it's in front: the person just tapped Install). */
    private void confirm(final Intent screen) {
        // It's the installer's own screen: nothing in it is ours to grant.
        screen.removeFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        final MainActivity a = MainActivity.live();
        if (a != null) {
            a.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        a.startActivity(screen);
                    } catch (Throwable t) {
                        synchronized (Updater.this) {
                            end("install", "ready", "install", "failed");
                        }
                    }
                }
            });
            return;
        }
        try {
            screen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(screen);
        } catch (Throwable t) {
            synchronized (this) {
                end("install", "ready", "install", "failed");
            }
        }
    }

    /** Settings at "Install unknown apps" for this app (Android 8+), else the app's own page there. */
    private void openInstallSettings() {
        final MainActivity a = MainActivity.live();
        if (a == null) {
            return;
        }
        final Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    a.startActivity(intent);
                } catch (Throwable t) {
                    a.openAppSettings();
                }
            }
        });
    }

    /** Hears the install's status (the manifest's receiver; not exported, so only that PendingIntent reaches it). */
    public static final class Receiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !ACTION_STATUS.equals(intent.getAction())) {
                return;
            }
            try {
                Updater.get(context).onStatus(intent);
            } catch (Throwable ignored) {
                // The page still offers Install.
            }
        }
    }

    // ---------------------------------------------------------------- state

    /** Whether a check or a download can start: nothing else is running or waiting on Android. */
    private boolean idleNow() {
        return "idle".equals(phase) || "current".equals(phase) || "available".equals(phase)
                || "ready".equals(phase) || "failed".equals(phase);
    }

    /** What the last check found, from before the app was started: kept in cache/updates/latest.json. */
    private void restore() {
        if (restored) {
            return;
        }
        restored = true;
        JSONObject saved = readJson(new File(dir(), LATEST_FILE));
        Release r = null;
        try {
            r = saved == null ? null : Release.from(saved);
        } catch (Failure ignored) {
        }
        if (r == null) {
            dropFiles(null);
            return;
        }
        latest = r;
        checkedAt = saved.optLong("checkedAt", 0);
        if (r.versionCode > installedCode) {
            phase = readyFile(r) != null ? "ready" : "available";
            dropFiles(r);
        } else {
            phase = "current"; // installed since (this version, or a newer one)
            dropFiles(null);
        }
    }

    private void setPhase(String phase, String step, String error) {
        this.phase = phase;
        this.step = step;
        this.error = error;
        send();
    }

    /** A step's end: its snapshot carries "done" (the step: check, download or install) once. */
    private void end(String doneStep, String phase, String step, String error) {
        this.done = doneStep;
        this.bps = 0;
        setPhase(phase, step, error);
        this.done = null;
    }

    private synchronized void progress(long got) {
        loaded = got;
        long now = System.nanoTime() / 1000000L;
        long elapsed = now - reportedAt;
        if (elapsed < REPORT_MS) {
            return;
        }
        long speed = (got - reportedLoaded) * 1000L / Math.max(1L, elapsed);
        bps = bps == 0 ? speed : (bps * 3 + speed) / 4;
        reportedAt = now;
        reportedLoaded = got;
        send();
    }

    /**
     * {"phase", "step"?, "error"?, "done"?, "installed": {versionName, versionCode}, "latest"?:
     * {versionName, versionCode, size, notes}, "checkedAt"?, "loaded"?, "total"?, "bps"?, "needed"?,
     * "free"?}. phase: idle, checking, current, available, downloading, verifying, ready, permission,
     * installing, confirm or failed (step says which: check, download or install). On "ready", step
     * and error say why an install didn't go through (the file is still good).
     */
    private JSONObject snapshot() {
        JSONObject o = new JSONObject();
        try {
            o.put("phase", phase);
            if (step != null) {
                o.put("step", step);
            }
            if (error != null) {
                o.put("error", error);
            }
            if (done != null) {
                o.put("done", done);
            }
            o.put("installed", new JSONObject().put("versionName", installedName).put("versionCode", installedCode));
            if (latest != null) {
                o.put("latest", latest.forPage());
            }
            if (checkedAt > 0) {
                o.put("checkedAt", checkedAt);
            }
            if ("downloading".equals(phase) || "verifying".equals(phase)) {
                o.put("loaded", loaded).put("total", total).put("bps", bps);
            }
            if ("failed".equals(phase) && needed >= 0) {
                o.put("needed", needed).put("free", free);
            }
        } catch (JSONException ignored) {
        }
        return o;
    }

    /** The snapshot to the page (window.__gh.onUpdate), whichever activity shows it now. */
    private void send() {
        MainActivity a = MainActivity.live();
        if (a != null) {
            a.callJs(MainActivity.jsCall("onUpdate", snapshot().toString()));
        }
    }

    // ---------------------------------------------------------------- this install

    private boolean canInstall() {
        try {
            return context.getPackageManager().canRequestPackageInstalls();
        } catch (Throwable t) {
            return false;
        }
    }

    private boolean declares(String permission) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
            if (info.requestedPermissions != null) {
                for (String p : info.requestedPermissions) {
                    if (permission.equals(p)) {
                        return true;
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    @SuppressWarnings("deprecation") // getInstallerPackageName: what there is before Android 11
    private String installer() {
        PackageManager pm = context.getPackageManager();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                return Api30.installer(pm, context.getPackageName());
            }
            return pm.getInstallerPackageName(context.getPackageName());
        } catch (Throwable t) {
            return null;
        }
    }

    @SuppressWarnings("deprecation") // GET_SIGNATURES: what there is before Android 9
    private Set<String> installedSigners() {
        PackageManager pm = context.getPackageManager();
        try {
            int flags = Build.VERSION.SDK_INT >= 28 ? Api28.SIGNING : PackageManager.GET_SIGNATURES;
            return signers(pm.getPackageInfo(context.getPackageName(), flags));
        } catch (Throwable t) {
            return Collections.emptySet();
        }
    }

    /**
     * An APK file as Android reads it, with its signers. Android 9 collects an archive's certificates
     * only when GET_SIGNATURES is asked for too, so both are.
     */
    @SuppressWarnings("deprecation")
    private PackageInfo archiveInfo(File file) {
        try {
            int flags = PackageManager.GET_SIGNATURES | (Build.VERSION.SDK_INT >= 28 ? Api28.SIGNING : 0);
            return context.getPackageManager().getPackageArchiveInfo(file.getPath(), flags);
        } catch (Throwable t) {
            return null;
        }
    }

    /** The SHA-256 of each certificate that signs it now (not ones it rotated from). */
    @SuppressWarnings("deprecation") // PackageInfo.signatures: what there is before Android 9
    static Set<String> signers(PackageInfo info) {
        Set<String> out = new HashSet<String>();
        if (info == null) {
            return out;
        }
        Signature[] sigs = Build.VERSION.SDK_INT >= 28 ? Api28.signers(info) : null;
        if (sigs == null || sigs.length == 0) {
            sigs = info.signatures;
        }
        if (sigs == null) {
            return out;
        }
        for (Signature s : sigs) {
            try {
                MessageDigest d = MessageDigest.getInstance("SHA-256");
                out.add(hex(d.digest(s.toByteArray())));
            } catch (Throwable ignored) {
                return new HashSet<String>(); // one that can't be read: none count
            }
        }
        return out;
    }

    @SuppressWarnings("deprecation") // versionCode: what there is before Android 9
    static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? Api28.versionCode(info) : info.versionCode;
    }

    /** Android 9+: signing certificates and long version codes. */
    private static final class Api28 {
        static final int SIGNING = PackageManager.GET_SIGNING_CERTIFICATES;

        static Signature[] signers(PackageInfo info) {
            return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        }

        static long versionCode(PackageInfo info) {
            return info.getLongVersionCode();
        }
    }

    /** Android 11+: who installed the app. */
    private static final class Api30 {
        static String installer(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
            return pm.getInstallSourceInfo(pkg).getInstallingPackageName();
        }
    }

    // ---------------------------------------------------------------- files

    /** In the cache: Android can clear it when space runs short, and backups never include it. */
    private File dir() {
        File dir = new File(context.getCacheDir(), DIR);
        if (!dir.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    /** This release's downloaded and checked APK, or null. */
    private File readyFile(Release r) {
        File f = new File(dir(), r.versionCode + ".apk");
        return f.isFile() && f.length() == r.size ? f : null;
    }

    /** Deletes every download but keep's (all of them for null); latest.json stays. */
    private void dropFiles(Release keep) {
        File[] files = dir().listFiles();
        if (files == null) {
            return;
        }
        String mine = keep == null ? null : keep.versionCode + ".apk";
        for (File f : files) {
            String name = f.getName();
            if (LATEST_FILE.equals(name) || (mine != null && (name.equals(mine) || name.equals(mine + ".part")))) {
                continue;
            }
            deleteFile(f);
        }
    }

    private long freeSpace() {
        try {
            return new StatFs(dir().getPath()).getAvailableBytes();
        } catch (Throwable t) {
            return -1;
        }
    }

    private boolean online() {
        try {
            Object service = context.getSystemService(Context.CONNECTIVITY_SERVICE);
            return !(service instanceof ConnectivityManager) || ((ConnectivityManager) service).getActiveNetwork() != null;
        } catch (Throwable t) {
            return true; // can't tell: try
        }
    }

    private static void truncate(File part) throws Failure {
        RandomAccessFile f = null;
        try {
            f = new RandomAccessFile(part, "rw");
            f.setLength(0);
        } catch (IOException e) {
            throw new Failure("io", false, e.toString());
        } finally {
            closeQuietly(f);
        }
    }

    /** A downloaded file's SHA-256 (Cancel stops it). */
    private String sha256Of(File file) throws Failure {
        InputStream in = null;
        try {
            MessageDigest digest = sha256();
            in = new FileInputStream(file);
            byte[] buf = new byte[BUFFER_BYTES];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (cancelled) {
                    throw cancelledFailure();
                }
                digest.update(buf, 0, n);
            }
            return hex(digest.digest());
        } catch (IOException e) {
            throw new Failure("io", false, e.toString());
        } finally {
            closeQuietly(in);
        }
    }

    private static long[] contentRange(String value) {
        if (value == null) {
            return null;
        }
        Matcher m = CONTENT_RANGE.matcher(value.trim());
        if (!m.matches()) {
            return null;
        }
        try {
            long whole = "*".equals(m.group(3)) ? -1 : Long.parseLong(m.group(3));
            return new long[]{Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), whole};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Waits in small steps, so Cancel is heard quickly. */
    private void pause(long ms) throws Failure {
        long end = System.nanoTime() + ms * 1000000L;
        while (System.nanoTime() < end) {
            if (cancelled) {
                throw cancelledFailure();
            }
            try {
                Thread.sleep(Math.min(250L, Math.max(1L, (end - System.nanoTime()) / 1000000L)));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw cancelledFailure();
            }
        }
    }

    private static Failure cancelledFailure() {
        return new Failure("cancelled", false, "cancelled");
    }

    private static Failure space(long need, long room) {
        Failure f = new Failure("space", false, "needs " + need + " bytes, " + room + " free");
        f.needed = need;
        f.free = room;
        return f;
    }

    private static void abandon(PackageInstaller.Session session) {
        if (session != null) {
            try {
                session.abandon();
            } catch (Throwable ignored) {
            }
            try {
                session.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private synchronized ExecutorService executor() {
        if (executor == null) {
            executor = Executors.newSingleThreadExecutor(new ThreadFactory() {
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "gradient-updates");
                    t.setDaemon(true);
                    return t;
                }
            });
        }
        return executor;
    }

    private static MessageDigest sha256() throws Failure {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception e) {
            throw new Failure("io", false, e.toString());
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        }
        return sb.toString();
    }

    private static JSONObject readJson(File file) {
        if (file == null || !file.isFile() || file.length() > MAX_JSON_BYTES) {
            return null;
        }
        InputStream in = null;
        try {
            in = new FileInputStream(file);
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, n);
            }
            return new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
        } catch (Throwable t) {
            return null;
        } finally {
            closeQuietly(in);
        }
    }

    /** Writes file.tmp, syncs it and renames it over the file. */
    private static boolean writeAtomically(File file, String text) {
        File tmp = new File(file.getPath() + ".tmp");
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(tmp);
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.flush();
            try {
                out.getFD().sync();
            } catch (IOException ignored) {
            }
            out.close();
            out = null;
            return tmp.renameTo(file);
        } catch (IOException e) {
            return false;
        } finally {
            if (out != null) {
                closeQuietly(out);
                deleteFile(tmp);
            }
        }
    }

    private static boolean deleteFile(File f) {
        return f == null || !f.exists() || f.delete();
    }

    private static void closeQuietly(Closeable c) {
        if (c != null) {
            try {
                c.close();
            } catch (IOException ignored) {
            }
        }
    }
}
