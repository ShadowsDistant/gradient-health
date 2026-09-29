package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.net.ConnectivityManager;
import android.os.Process;
import android.os.StatFs;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The on-device AI's model files (the page side is src/llm.js): downloads them, lists them, and
 * serves them to the page at https://appassets.androidplatform.net/models/&lt;file&gt;.
 *
 * Downloads run one at a time on a background thread and outlive page reloads: the page asks for
 * their state with {@link #statusJson}, and progress goes to window.__gh.onModelProgress at most 4
 * times a second. They only go to Hugging Face (and its CDN, which the resolve URL redirects to),
 * resume from a .part file with a Range request, can wait for an unmetered network, need the free
 * space for the file plus a margin, and must pass three checks before they count as installed: the
 * size (the Hub's exact size, close to the page's figure), the GGUF magic, and the SHA-256 (the page's
 * pinned value, or the X-Linked-Etag the Hub sends with the redirect, computed while the file streams
 * in).
 *
 * In noBackupFilesDir/models/: &lt;file&gt; with &lt;file&gt;.json ({id, file, bytes, sha256, url}) once
 * installed; &lt;file&gt;.part with &lt;file&gt;.part.json ({id, url, sha256, total}) while downloading or paused.
 */
final class ModelStore {
    private static final String DIR = "models";
    /** A download has to leave this much space free. */
    private static final long SPACE_MARGIN = 300L * 1024 * 1024;
    private static final long REPORT_MS = 250;
    private static final long WAIT_POLL_MS = 3000;
    private static final int MAX_FAILURES = 6;
    private static final int MAX_REDIRECTS = 10;
    private static final int CONNECT_TIMEOUT_MS = 20000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int BUFFER_BYTES = 256 * 1024;

    private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9_-]{0,39}");
    private static final Pattern FILE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,150}\\.gguf");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+|\\*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_RANGE_TOTAL = Pattern.compile("bytes [^/]*/(\\d+)", Pattern.CASE_INSENSITIVE);

    private static ModelStore instance;

    private final Context context;
    private final Map<String, Job> jobs = new LinkedHashMap<String, Job>();
    private volatile WeakReference<MainActivity> page = new WeakReference<MainActivity>(null);
    private ExecutorService executor;

    private ModelStore(Context context) {
        this.context = context;
    }

    /** The store; its progress reports go to this activity's page from now on. */
    static synchronized ModelStore get(MainActivity activity) {
        if (instance == null) {
            instance = new ModelStore(activity.getApplicationContext());
        }
        if (instance.page.get() != activity) {
            instance.page = new WeakReference<MainActivity>(activity);
        }
        return instance;
    }

    /** One download. Fields after "lock" are guarded by the store; the rest belong to the download thread. */
    private static final class Job {
        final String id;
        final String file;
        final String url;
        final long bytes;
        final String sha256;
        volatile boolean wifiOnly;
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        MessageDigest digest; // SHA-256 of the first `hashed` bytes of the .part
        long hashed;
        String expectedSha;
        long remoteTotal = -1;
        // lock
        String state = "queued";
        String error;
        long loaded;
        long total;
        long bps;
        long needed = -1;
        long free = -1;
        long reportedAt;
        long reportedLoaded;

        Job(String id, String file, String url, long bytes, String sha256, boolean wifiOnly) {
            this.id = id;
            this.file = file;
            this.url = url;
            this.bytes = bytes;
            this.sha256 = sha256;
            this.wifiOnly = wifiOnly;
        }

        boolean active() {
            return "queued".equals(state) || "downloading".equals(state) || "verifying".equals(state)
                    || "waiting-wifi".equals(state) || "waiting-network".equals(state);
        }
    }

    /** Why a download stopped: retry means after a pause; discard means the .part is no use. */
    private static final class Failure extends Exception {
        final String code;
        final boolean retry;
        boolean discard;
        long needed = -1;
        long free = -1;

        Failure(String code, boolean retry, String detail) {
            super(detail);
            this.code = code;
            this.retry = retry;
        }

        Failure discard() {
            discard = true;
            return this;
        }
    }

    // ---------------------------------------------------------------- for Bridge

    /** Installed models: [{"id","file","bytes"}]. */
    synchronized String listJson() {
        JSONArray out = new JSONArray();
        for (JSONObject meta : installedMetas()) {
            try {
                out.put(new JSONObject().put("id", meta.getString("id")).put("file", meta.getString("file"))
                        .put("bytes", meta.getLong("bytes")));
            } catch (JSONException ignored) {
                // skip a record that lost a field
            }
        }
        return out.toString();
    }

    /**
     * Every download this run has seen (queued, running, waiting, done, failed or cancelled), plus
     * partial downloads left from an earlier run as "paused": [{"id","state","loaded","total",...}].
     */
    synchronized String statusJson() {
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<String>();
        for (Job job : jobs.values()) {
            out.put(snapshot(job));
            seen.add(job.id);
        }
        File[] files = dir().listFiles();
        if (files != null) {
            for (File f : files) {
                if (!f.getName().endsWith(".gguf.part.json")) {
                    continue;
                }
                JSONObject meta = readJson(f);
                File part = new File(f.getParentFile(), f.getName().substring(0, f.getName().length() - 5));
                String id = meta == null ? "" : meta.optString("id", "");
                if (id.isEmpty() || seen.contains(id) || !part.isFile()) {
                    continue;
                }
                seen.add(id);
                try {
                    out.put(new JSONObject().put("id", id).put("state", "paused").put("loaded", part.length())
                            .put("total", meta.optLong("total", 0) > 0 ? meta.optLong("total", 0) : meta.optLong("bytes", 0)));
                } catch (JSONException ignored) {
                }
            }
        }
        return out.toString();
    }

    /**
     * Starts or resumes a download ({"id","url","file","bytes","sha256"?,"wifiOnly"}). One that is
     * already running just reports its state again; an installed model reports "done" at once.
     *
     * @return false if the request isn't valid
     */
    boolean download(String json) {
        final Job job;
        synchronized (this) {
            JSONObject o;
            try {
                o = new JSONObject(json);
            } catch (Throwable t) {
                return false;
            }
            String id = o.optString("id", "");
            String file = o.optString("file", "");
            String url = o.optString("url", "");
            long bytes = o.optLong("bytes", 0);
            String sha = o.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
            boolean wifiOnly = o.optBoolean("wifiOnly", false);
            if (!ID.matcher(id).matches() || !FILE_NAME.matcher(file).matches() || bytes <= 0 || !allowed(url)
                    || (!sha.isEmpty() && !SHA256.matcher(sha).matches())) {
                return false;
            }
            Job running = jobs.get(id);
            if (running != null && running.active()) {
                running.wifiOnly = wifiOnly;
                send(snapshot(running));
                return true;
            }
            job = new Job(id, file, url, bytes, sha.isEmpty() ? null : sha, wifiOnly);
            jobs.put(id, job);
            long installed = installedBytes(job);
            if (installed > 0) {
                job.state = "done";
                job.loaded = installed;
                job.total = installed;
            }
            send(snapshot(job));
            if (installed > 0) {
                return true;
            }
        }
        executor().execute(new Runnable() {
            @Override
            public void run() {
                runJob(job);
            }
        });
        return true;
    }

    /** Stops a download and deletes what it had, or discards a paused one. */
    void cancel(String id) {
        Job job = null;
        synchronized (this) {
            Job j = jobs.get(id);
            if (j != null && j.active()) {
                j.cancelled = true;
                job = j;
                if ("queued".equals(j.state)) {
                    j.state = "cancelled";
                    send(snapshot(j));
                }
            }
        }
        if (job != null) {
            HttpURLConnection c = job.connection;
            if (c != null) {
                try {
                    c.disconnect(); // unblocks a read in progress
                } catch (Throwable ignored) {
                }
            }
            return;
        }
        if (deletePartials(id)) {
            synchronized (this) {
                try {
                    send(new JSONObject().put("id", id).put("state", "cancelled").put("loaded", 0).put("total", 0));
                } catch (JSONException ignored) {
                }
            }
        }
    }

    /** Deletes an installed model, and stops and discards any download of it. */
    boolean delete(String id) {
        cancel(id);
        synchronized (this) {
            boolean ok = true;
            File dir = dir();
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    String name = f.getName();
                    if (!name.endsWith(".gguf.json")) {
                        continue;
                    }
                    JSONObject meta = readJson(f);
                    if (meta != null && id.equals(meta.optString("id", ""))) {
                        ok &= deleteFile(f); // the record first, so a half-deleted model never counts as installed
                        ok &= deleteFile(new File(dir, name.substring(0, name.length() - 5)));
                    }
                }
            }
            deletePartials(id);
            Job job = jobs.get(id);
            if (job != null && !job.active()) {
                jobs.remove(id);
            }
            return ok;
        }
    }

    /** Free bytes where models are stored, or -1. */
    long freeSpace() {
        try {
            return new StatFs(dir().getPath()).getAvailableBytes();
        } catch (Throwable t) {
            return -1;
        }
    }

    // ---------------------------------------------------------------- serving /models/<file>

    /**
     * An installed model file for the page, with HTTP Range support (wllama reads it in pieces).
     * Android WebView applies a single byte range again to whatever this returns: it skip()s the
     * range's first byte position on the stream (keeping our 206 status and headers). So a 206 body
     * starts with that many skippable bytes that are never read, and it's the right slice whether
     * or not WebView skips; available() counts them too, which is what WebView checks the range against.
     */
    WebResourceResponse serve(String name, WebResourceRequest request) {
        try {
            File dir = dir();
            File file = new File(dir, name);
            if (!FILE_NAME.matcher(name).matches() || !file.isFile() || !new File(dir, name + ".json").isFile()) {
                return empty(404, "Not Found", null);
            }
            String method = request != null ? request.getMethod() : null;
            if (method != null && !"GET".equalsIgnoreCase(method)) {
                return empty(405, "Method Not Allowed", null);
            }
            long size = file.length();
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-store");
            long start = 0;
            long end = size - 1;
            int status = 200;
            String reason = "OK";
            String range = header(request, "Range");
            if (range != null) {
                long[] r = parseRange(range, size);
                if (r != null && r.length == 0) {
                    headers.put("Content-Range", "bytes */" + size);
                    return empty(416, "Range Not Satisfiable", headers);
                }
                if (r != null) {
                    start = r[0];
                    end = r[1];
                    status = 206;
                    reason = "Partial Content";
                    headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
                }
            }
            long length = end - start + 1;
            headers.put("Content-Length", Long.toString(length));
            return new WebResourceResponse("application/octet-stream", null, status, reason, headers,
                    new Slice(file, start, length, status == 206 ? start : 0));
        } catch (Throwable t) {
            return empty(500, "Internal Server Error", null);
        }
    }

    /**
     * A single "bytes=" range: {first, last}, an empty array if it can't be satisfied, or null to
     * ignore the header and send the whole file (multiple ranges, other units, nonsense).
     */
    static long[] parseRange(String value, long size) {
        Matcher m = RANGE.matcher(value.trim());
        if (!m.matches() || (m.group(1).isEmpty() && m.group(2).isEmpty())) {
            return null;
        }
        long first;
        long last;
        try {
            if (m.group(1).isEmpty()) {
                long suffix = Long.parseLong(m.group(2));
                if (suffix <= 0) {
                    return new long[0];
                }
                first = Math.max(0, size - suffix);
                last = size - 1;
            } else {
                first = Long.parseLong(m.group(1));
                last = size - 1;
                if (!m.group(2).isEmpty()) {
                    long asked = Long.parseLong(m.group(2));
                    if (asked < first) {
                        return null;
                    }
                    last = Math.min(asked, last);
                }
            }
        } catch (NumberFormatException e) {
            return null;
        }
        if (size <= 0 || first >= size) {
            return new long[0];
        }
        return new long[]{first, last};
    }

    private static String header(WebResourceRequest request, String name) {
        Map<String, String> headers = request != null ? request.getRequestHeaders() : null;
        if (headers == null) {
            return null;
        }
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (name.equalsIgnoreCase(e.getKey())) {
                return e.getValue();
            }
        }
        return null;
    }

    private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason,
                headers != null ? headers : new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    /** `length` bytes of a file from `start`, after `prefix` bytes that can only be skipped. */
    static final class Slice extends InputStream {
        private final RandomAccessFile file;
        private long prefix;
        private long position;
        private long left;

        Slice(File f, long start, long length, long prefix) throws IOException {
            this.file = new RandomAccessFile(f, "r");
            this.position = start;
            this.left = length;
            this.prefix = prefix;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            return read(one, 0, 1) == 1 ? one[0] & 0xff : -1;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (len == 0) {
                return 0;
            }
            if (left <= 0) {
                return -1;
            }
            file.seek(position);
            int n = file.read(b, off, (int) Math.min(len, left));
            if (n <= 0) {
                return -1;
            }
            position += n;
            left -= n;
            return n;
        }

        @Override
        public long skip(long n) {
            if (n <= 0) {
                return 0;
            }
            long fromPrefix = Math.min(n, prefix);
            prefix -= fromPrefix;
            long fromData = Math.min(n - fromPrefix, left);
            position += fromData;
            left -= fromData;
            return fromPrefix + fromData;
        }

        @Override
        public int available() {
            long n = prefix + left;
            return n > Integer.MAX_VALUE ? 0 : (int) n; // 0 makes WebView skip its range check
        }

        @Override
        public void close() throws IOException {
            file.close();
        }
    }

    // ---------------------------------------------------------------- downloading (background thread)

    private void runJob(Job job) {
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
        } catch (Throwable ignored) {
        }
        File dir = dir();
        File part = new File(dir, job.file + ".part");
        File partMeta = new File(dir, job.file + ".part.json");
        try {
            if (job.cancelled) {
                throw cancelled();
            }
            adoptLeftovers(job, dir, part, partMeta);
            int failures = 0;
            while (true) {
                if (job.cancelled) {
                    throw cancelled();
                }
                if (!online()) {
                    setState(job, "waiting-network");
                    pause(job, WAIT_POLL_MS);
                    continue;
                }
                if (job.wifiOnly && metered()) {
                    setState(job, "waiting-wifi");
                    pause(job, WAIT_POLL_MS);
                    continue;
                }
                long before = part.length();
                try {
                    transfer(job, part, partMeta);
                    break;
                } catch (Failure f) {
                    if ("wifi".equals(f.code)) {
                        continue; // the loop waits for Wi-Fi
                    }
                    if (!f.retry) {
                        throw f;
                    }
                    if (part.length() > before) {
                        failures = 0; // it got somewhere: only give up on a download that's stuck
                    }
                    if (++failures > MAX_FAILURES) {
                        throw new Failure(f.code, false, f.getMessage());
                    }
                    pause(job, Math.min(30000L, 1000L << failures));
                }
            }
            verify(job, part);
            install(job, dir, part, partMeta);
            finish(job, "done", null);
        } catch (Failure f) {
            if ("cancelled".equals(f.code)) {
                deleteFile(part);
                deleteFile(partMeta);
                finish(job, "cancelled", null);
            } else {
                if (f.discard) {
                    deleteFile(part);
                    deleteFile(partMeta);
                }
                finish(job, "error", f);
            }
        } catch (Throwable t) {
            finish(job, "error", new Failure("io", false, String.valueOf(t)));
        } finally {
            job.connection = null;
            job.digest = null;
        }
    }

    /**
     * A model whose install was cut short (file, no record) is checked again as a finished .part;
     * a .part recorded for another file is dropped.
     */
    private void adoptLeftovers(Job job, File dir, File part, File partMeta) {
        File target = new File(dir, job.file);
        if (target.isFile() && !new File(dir, job.file + ".json").exists() && !part.exists()) {
            if (!target.renameTo(part)) {
                deleteFile(target);
            }
        }
        JSONObject meta = readJson(partMeta);
        if (meta != null && part.exists()) {
            String sha = meta.optString("sha256", "");
            if (!job.id.equals(meta.optString("id", "")) || (job.sha256 != null && !sha.isEmpty() && !sha.equals(job.sha256))) {
                deleteFile(part);
                deleteFile(partMeta);
            }
        }
    }

    /** One attempt: continues the .part from its end and returns once it holds the whole file. */
    private void transfer(Job job, File part, File partMeta) throws Failure {
        long have = part.isFile() ? part.length() : 0;
        hashPart(job, part, have);
        HttpURLConnection c = null;
        InputStream in = null;
        FileOutputStream out = null;
        try {
            Hop hop = connect(job, have);
            c = hop.connection;
            long total;
            if (hop.code == 416 && have > 0) {
                // Nothing left to send: the .part may be the whole file already, and verify() decides.
                long t = totalOf(c.getHeaderField("Content-Range"));
                if (t == have || (t < 0 && closeInSize(have, job.bytes))) {
                    job.remoteTotal = have;
                    expect(job, hop, have);
                    return;
                }
                truncate(job, part);
                throw new Failure("network", true, "HTTP 416");
            }
            if (hop.code == 206) {
                long[] r = contentRange(c.getHeaderField("Content-Range"));
                if (r == null || r[0] != have) {
                    truncate(job, part);
                    throw new Failure("network", true, "unexpected Content-Range");
                }
                total = r[2];
            } else if (hop.code == 200) {
                total = c.getContentLengthLong();
                if (have > 0) {
                    truncate(job, part); // the server ignored the Range: start over
                    have = 0;
                }
            } else {
                int code = hop.code;
                throw new Failure("http", code == 408 || code == 429 || code >= 500, "HTTP " + code);
            }
            job.remoteTotal = total;
            expect(job, hop, total);
            writePartMeta(job, partMeta);
            long size = total > 0 ? total : job.bytes;
            long free = freeSpace();
            if (free >= 0 && free < size - have + SPACE_MARGIN) {
                throw space(size - have + SPACE_MARGIN, free);
            }
            in = c.getInputStream();
            out = new FileOutputStream(part, true);
            setState(job, "downloading", have, size);
            byte[] buf = new byte[BUFFER_BYTES];
            long loaded = have;
            long checkedAt = System.nanoTime();
            int n;
            while ((n = in.read(buf)) != -1) {
                if (job.cancelled) {
                    throw cancelled();
                }
                out.write(buf, 0, n);
                job.digest.update(buf, 0, n);
                job.hashed += n;
                loaded += n;
                if (total > 0 && loaded > total) {
                    throw new Failure("size", false, "more data than announced").discard();
                }
                progress(job, loaded);
                if (System.nanoTime() - checkedAt > 1000000000L) {
                    checkedAt = System.nanoTime();
                    if (job.wifiOnly && metered()) {
                        throw new Failure("wifi", true, "left Wi-Fi");
                    }
                }
            }
            out.flush();
            try {
                out.getFD().sync();
            } catch (IOException ignored) {
            }
            if (total > 0 && loaded < total) {
                throw new Failure("network", true, "connection closed early");
            }
            if (total <= 0) {
                job.remoteTotal = loaded;
            }
        } catch (IOException e) {
            if (job.cancelled) {
                throw cancelled();
            }
            long free = freeSpace();
            String message = String.valueOf(e.getMessage());
            if (message.contains("ENOSPC") || message.contains("No space") || (free >= 0 && free < 1024 * 1024)) {
                throw space(Math.max(0, job.bytes - part.length()) + SPACE_MARGIN, free);
            }
            throw new Failure("network", true, e.toString());
        } finally {
            closeQuietly(out);
            closeQuietly(in);
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {
                }
            }
            job.connection = null;
        }
    }

    private static final class Hop {
        HttpURLConnection connection;
        int code;
        String linkedSha;
        long linkedSize = -1;
    }

    /** Opens the URL, following redirects by hand: the Hub's resolve response carries the file's hash. */
    private Hop connect(Job job, long from) throws IOException, Failure {
        Hop hop = new Hop();
        URL url = new URL(job.url);
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            if (!allowed(url)) {
                throw new Failure("http", false, "redirected to " + url.getHost());
            }
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            job.connection = c;
            if (job.cancelled) {
                c.disconnect();
                throw cancelled();
            }
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setUseCaches(false);
            c.setRequestProperty("Accept-Encoding", "identity");
            if (from > 0) {
                c.setRequestProperty("Range", "bytes=" + from + "-");
            }
            int code = c.getResponseCode();
            String sha = shaOf(c.getHeaderField("X-Linked-Etag"));
            if (sha == null && isHub(url.getHost())) {
                sha = shaOf(c.getHeaderField("ETag"));
            }
            if (sha != null && hop.linkedSha == null) {
                hop.linkedSha = sha;
            }
            String linkedSize = c.getHeaderField("X-Linked-Size");
            if (linkedSize != null && hop.linkedSize < 0) {
                try {
                    hop.linkedSize = Long.parseLong(linkedSize.trim());
                } catch (NumberFormatException ignored) {
                }
            }
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = c.getHeaderField("Location");
                c.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Failure("http", true, "redirect without a location");
                }
                url = new URL(url, location);
                continue;
            }
            hop.connection = c;
            hop.code = code;
            return hop;
        }
        throw new Failure("http", false, "too many redirects");
    }

    /** A file on the Hub that doesn't match the page's description was replaced there: stop. */
    private static void expect(Job job, Hop hop, long total) throws Failure {
        long size = total > 0 ? total : hop.linkedSize;
        if (size > 0 && !closeInSize(size, job.bytes)) {
            throw new Failure("changed", false, "size " + size).discard();
        }
        if (job.sha256 != null && hop.linkedSha != null && !job.sha256.equals(hop.linkedSha)) {
            throw new Failure("changed", false, "sha256 " + hop.linkedSha).discard();
        }
        job.expectedSha = job.sha256 != null ? job.sha256 : hop.linkedSha;
    }

    /** Makes job.digest cover the .part (re-reading it after a restart or a failed write). */
    private void hashPart(Job job, File part, long have) throws Failure {
        if (job.digest != null && job.hashed == have) {
            return;
        }
        MessageDigest digest = sha256();
        if (have > 0) {
            InputStream in = null;
            try {
                in = new FileInputStream(part);
                byte[] buf = new byte[BUFFER_BYTES];
                long left = have;
                int n;
                while (left > 0 && (n = in.read(buf, 0, (int) Math.min(buf.length, left))) != -1) {
                    if (job.cancelled) {
                        throw cancelled();
                    }
                    digest.update(buf, 0, n);
                    left -= n;
                }
                if (left != 0) {
                    throw new Failure("io", false, "the partial download shrank");
                }
            } catch (IOException e) {
                throw new Failure("io", false, e.toString());
            } finally {
                closeQuietly(in);
            }
        }
        job.digest = digest;
        job.hashed = have;
    }

    private void truncate(Job job, File part) throws Failure {
        RandomAccessFile f = null;
        try {
            f = new RandomAccessFile(part, "rw");
            f.setLength(0);
        } catch (IOException e) {
            throw new Failure("io", false, e.toString());
        } finally {
            closeQuietly(f);
        }
        job.digest = sha256();
        job.hashed = 0;
    }

    private void verify(Job job, File part) throws Failure {
        long length = part.length();
        setState(job, "verifying", length, length);
        if ((job.remoteTotal > 0 && length != job.remoteTotal) || !closeInSize(length, job.bytes)) {
            throw new Failure("size", false, "size " + length).discard();
        }
        if (!isGguf(part)) {
            throw new Failure("format", false, "not a GGUF file").discard();
        }
        if (job.expectedSha != null) {
            hashPart(job, part, length);
            String got = hex(job.digest.digest());
            job.digest = null;
            if (!job.expectedSha.equals(got)) {
                throw new Failure("checksum", false, "sha256 " + got).discard();
            }
        }
    }

    private void install(Job job, File dir, File part, File partMeta) throws Failure {
        File target = new File(dir, job.file);
        File meta = new File(dir, job.file + ".json");
        long length = part.length();
        deleteFile(meta); // an older version's record goes first, so it's never paired with the new file
        if (target.exists() && !target.delete()) {
            throw new Failure("io", false, "can't replace " + job.file);
        }
        if (!part.renameTo(target)) {
            throw new Failure("io", false, "can't rename " + part.getName());
        }
        try {
            JSONObject record = new JSONObject().put("id", job.id).put("file", job.file).put("bytes", length)
                    .put("sha256", job.expectedSha != null ? job.expectedSha : "").put("url", job.url)
                    .put("installed", System.currentTimeMillis());
            if (!writeAtomically(meta, record.toString())) {
                throw new Failure("io", false, "can't write " + meta.getName());
            }
        } catch (JSONException e) {
            throw new Failure("io", false, e.toString());
        }
        deleteFile(partMeta);
        synchronized (this) {
            job.loaded = length;
            job.total = length;
        }
    }

    private void writePartMeta(Job job, File partMeta) {
        try {
            writeAtomically(partMeta, new JSONObject().put("id", job.id).put("file", job.file).put("url", job.url)
                    .put("sha256", job.expectedSha != null ? job.expectedSha : "").put("bytes", job.bytes)
                    .put("total", job.remoteTotal).toString());
        } catch (JSONException ignored) {
        }
    }

    /** Waits in small steps so a cancel is noticed quickly. */
    private static void pause(Job job, long ms) throws Failure {
        long end = System.nanoTime() + ms * 1000000L;
        while (System.nanoTime() < end) {
            if (job.cancelled) {
                throw cancelled();
            }
            try {
                Thread.sleep(Math.min(250L, Math.max(1L, (end - System.nanoTime()) / 1000000L)));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw cancelled();
            }
        }
    }

    private static Failure cancelled() {
        return new Failure("cancelled", false, "cancelled");
    }

    private static Failure space(long needed, long free) {
        Failure f = new Failure("space", false, "needs " + needed + " bytes, " + free + " free");
        f.needed = needed;
        f.free = free;
        return f;
    }

    // ---------------------------------------------------------------- state and progress

    private void setState(Job job, String state) {
        synchronized (this) {
            setState(job, state, job.loaded, job.total);
        }
    }

    private synchronized void setState(Job job, String state, long loaded, long total) {
        boolean changed = !state.equals(job.state);
        job.state = state;
        job.loaded = loaded;
        job.total = total;
        if (changed) {
            job.bps = 0;
            job.reportedAt = System.nanoTime() / 1000000L;
            job.reportedLoaded = loaded;
            send(snapshot(job));
        }
    }

    private synchronized void progress(Job job, long loaded) {
        job.loaded = loaded;
        long now = System.nanoTime() / 1000000L;
        long elapsed = now - job.reportedAt;
        if (elapsed < REPORT_MS) {
            return;
        }
        long speed = (loaded - job.reportedLoaded) * 1000L / Math.max(1L, elapsed);
        job.bps = job.bps == 0 ? speed : (job.bps * 3 + speed) / 4;
        job.reportedAt = now;
        job.reportedLoaded = loaded;
        send(snapshot(job));
    }

    private synchronized void finish(Job job, String state, Failure failure) {
        if ("cancelled".equals(state) && "cancelled".equals(job.state)) {
            return; // cancelled while queued: already reported
        }
        job.state = state;
        job.bps = 0;
        if (failure != null) {
            job.error = failure.code;
            job.needed = failure.needed;
            job.free = failure.free;
        }
        send(snapshot(job));
    }

    private static JSONObject snapshot(Job job) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", job.id).put("state", job.state).put("loaded", job.loaded)
                    .put("total", job.total > 0 ? job.total : job.bytes);
            if ("downloading".equals(job.state)) {
                o.put("bps", job.bps);
            }
            if ("error".equals(job.state) && job.error != null) {
                o.put("error", job.error);
                if (job.needed >= 0) {
                    o.put("needed", job.needed);
                }
                if (job.free >= 0) {
                    o.put("free", job.free);
                }
            }
        } catch (JSONException ignored) {
        }
        return o;
    }

    private void send(JSONObject state) {
        MainActivity a = page.get();
        if (a != null) {
            a.callJs(MainActivity.jsCall("onModelProgress", state.toString()));
        }
    }

    // ---------------------------------------------------------------- helpers

    /**
     * filesDir's sibling that backups skip: a model is far over Auto Backup's 25 MB quota (which would
     * stop the app's own data from being backed up), and it can always be downloaded again.
     */
    private File dir() {
        File dir = new File(context.getNoBackupFilesDir(), DIR);
        if (!dir.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private synchronized ExecutorService executor() {
        if (executor == null) {
            executor = Executors.newSingleThreadExecutor(new ThreadFactory() {
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "gradient-models");
                    t.setDaemon(true);
                    return t;
                }
            });
        }
        return executor;
    }

    private List<JSONObject> installedMetas() {
        List<JSONObject> out = new ArrayList<JSONObject>();
        File dir = dir();
        File[] files = dir.listFiles();
        if (files == null) {
            return out;
        }
        for (File f : files) {
            if (!f.getName().endsWith(".gguf.json")) {
                continue;
            }
            JSONObject meta = readJson(f);
            String file = meta == null ? "" : meta.optString("file", "");
            File model = new File(dir, file);
            if (FILE_NAME.matcher(file).matches() && f.getName().equals(file + ".json") && !meta.optString("id", "").isEmpty()
                    && model.isFile() && model.length() == meta.optLong("bytes", -1)) {
                out.add(meta);
            }
        }
        return out;
    }

    /** The installed size of this job's model, or -1 if it isn't installed (or is another version). */
    private long installedBytes(Job job) {
        for (JSONObject meta : installedMetas()) {
            if (job.file.equals(meta.optString("file")) && job.id.equals(meta.optString("id"))
                    && (job.sha256 == null || job.sha256.equals(meta.optString("sha256")))) {
                return meta.optLong("bytes", -1);
            }
        }
        return -1;
    }

    /** Deletes the .part files recorded for this id; true if there were any. */
    private boolean deletePartials(String id) {
        boolean any = false;
        File dir = dir();
        File[] files = dir.listFiles();
        if (files == null) {
            return false;
        }
        for (File f : files) {
            String name = f.getName();
            if (!name.endsWith(".gguf.part.json")) {
                continue;
            }
            JSONObject meta = readJson(f);
            if (meta != null && id.equals(meta.optString("id", ""))) {
                deleteFile(new File(dir, name.substring(0, name.length() - 5)));
                deleteFile(f);
                any = true;
            }
        }
        return any;
    }

    private boolean online() {
        try {
            ConnectivityManager cm = connectivity();
            return cm == null || cm.getActiveNetwork() != null;
        } catch (Throwable t) {
            return true; // can't tell: try
        }
    }

    /** Wi-Fi-only downloads wait while this is true; if it can't be told, it counts as metered. */
    private boolean metered() {
        try {
            ConnectivityManager cm = connectivity();
            return cm == null || cm.isActiveNetworkMetered();
        } catch (Throwable t) {
            return true;
        }
    }

    private ConnectivityManager connectivity() {
        Object service = context.getSystemService(Context.CONNECTIVITY_SERVICE);
        return service instanceof ConnectivityManager ? (ConnectivityManager) service : null;
    }

    private static boolean allowed(String url) {
        try {
            return allowed(new URL(url));
        } catch (Throwable t) {
            return false;
        }
    }

    /** Hugging Face only (the Hub and its CDNs), over HTTPS. */
    private static boolean allowed(URL url) {
        if (url == null || !"https".equalsIgnoreCase(url.getProtocol()) || url.getHost() == null) {
            return false;
        }
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return isHub(host) || host.endsWith(".huggingface.co") || host.endsWith(".hf.co");
    }

    private static boolean isHub(String host) {
        String h = host == null ? "" : host.toLowerCase(Locale.ROOT);
        return "huggingface.co".equals(h) || "hf.co".equals(h);
    }

    /** A SHA-256 from an ETag-style header ("…", W/"…"), or null if it isn't one. */
    private static String shaOf(String etag) {
        if (etag == null) {
            return null;
        }
        String v = etag.trim();
        if (v.startsWith("W/")) {
            v = v.substring(2);
        }
        v = v.replace("\"", "").trim().toLowerCase(Locale.ROOT);
        return SHA256.matcher(v).matches() ? v : null;
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
            long total = "*".equals(m.group(3)) ? -1 : Long.parseLong(m.group(3));
            return new long[]{Long.parseLong(m.group(1)), Long.parseLong(m.group(2)), total};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static long totalOf(String contentRange) {
        if (contentRange == null) {
            return -1;
        }
        Matcher m = CONTENT_RANGE_TOTAL.matcher(contentRange.trim());
        try {
            return m.matches() ? Long.parseLong(m.group(1)) : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /**
     * Whether a file is the size the page expects: within 3%, since the page may only know it to a few
     * digits. Another quantization of a model differs by far more; the hash then checks every byte.
     */
    private static boolean closeInSize(long actual, long expected) {
        return expected > 0 && Math.abs(actual - expected) <= expected * 3 / 100;
    }

    private static boolean isGguf(File file) {
        InputStream in = null;
        try {
            in = new FileInputStream(file);
            byte[] magic = new byte[4];
            int n = 0;
            while (n < 4) {
                int r = in.read(magic, n, 4 - n);
                if (r < 0) {
                    return false;
                }
                n += r;
            }
            return magic[0] == 'G' && magic[1] == 'G' && magic[2] == 'U' && magic[3] == 'F';
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(in);
        }
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
        if (file == null || !file.isFile() || file.length() > 64 * 1024) {
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
