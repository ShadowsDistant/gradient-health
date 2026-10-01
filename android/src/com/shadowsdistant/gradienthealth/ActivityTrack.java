package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;

/**
 * One recorded activity (a run, walk, hike or ride) and the files that keep it: the model behind
 * {@link ActivityService} and the act* bridge methods.
 *
 * Files, in noBackupFilesDir/activity/ (out of device backups: the page saves a finished activity in
 * its own state, then deletes these with actClear):
 * <ul>
 * <li>&lt;key&gt;.json: the recording's details, replaced atomically on start, pause, resume and
 * finish and every 20 seconds: {v, id, type, title, units, startedAt, endedAt, pauses: [[from, to]],
 * breaks, steps: {on, n, last, boot}}.
 * <li>&lt;key&gt;.track: the GPS points, one a line, [t, lat, lon, alt|null, acc, speed|null, paused],
 * appended as they're recorded. actPoints returns them as they are.
 * </ul>
 *
 * The distance is worked out from the points again when a recording is loaded, with the same filter
 * as while recording, so a page reload, a crash or a restart gives the same number. The filter:
 * <ul>
 * <li>points less accurate than 50 m stay in the track (with their accuracy) but out of the distance;
 * <li>nothing counts while paused, and a pause ends the line: no distance across it;
 * <li>a point that would mean moving faster than 12 m/s since the last good one (25 m/s for a run, a
 * ride or other) is a GPS jump and is left out; after three in a row the move is real (a lift, a
 * train), so the line starts again there without counting the gap;
 * <li>distance counts from an anchor that only moves once the position has moved further than the
 * points' accuracy explains (the worse accuracy, 3 to 20 m), and not while the GPS says the phone is
 * standing still (under 0.4 m/s): GPS wander at a crossing adds nothing, and since the anchor waits
 * instead of skipping, a straight line loses nothing.
 * </ul>
 * Fixes arrive about once a second. One is stored when it's 3 m from the last stored point, 10 s after
 * it, the first accurate one after inaccurate ones, or the first after a pause or resume.
 *
 * Steps come from the phone's step counter (steps since the phone started): only steps taken while
 * recording and not paused count.
 *
 * Everything is synchronized: the service's thread feeds fixes and steps, the page's bridge thread reads.
 */
final class ActivityTrack {
    static final String DIR = "activity";
    static final double MAX_ACCURACY_M = 50;
    private static final double MIN_STEP_M = 3;
    private static final double MAX_STEP_M = 20;
    /** Slower than this (GPS speed, m/s) is standing still. */
    private static final double STILL_SPEED = 0.4;
    private static final double FOOT_MAX_SPEED = 12; // m/s: walks and hikes
    private static final double FAST_MAX_SPEED = 25; // m/s: runs, rides, other
    private static final int JUMPS_TO_MOVE = 3;
    private static final double STORE_MOVE_M = 3;
    private static final long STORE_EVERY_MS = 10000;
    private static final int MAX_POINTS = 200000;
    private static final long SAVE_EVERY_MS = 20000;
    private static final int KEEP_FINISHED = 20;

    // A point's columns.
    static final int T = 0;
    static final int LAT = 1;
    static final int LON = 2;
    static final int ALT = 3;
    static final int ACC = 4;
    static final int SPEED = 5;
    static final int PAUSED = 6;

    static final int STARTED = 0;
    static final int ALREADY = 1;
    static final int BUSY = 2;

    private static final int KEEP = 0;
    private static final int DROP = 1;
    private static final int RESTART = 2;

    private static ActivityTrack instance;

    /** The app's one track, loaded from disk on first use. */
    static synchronized ActivityTrack get(Context context) {
        if (instance == null) {
            instance = new ActivityTrack(new File(context.getNoBackupFilesDir(), DIR));
        }
        return instance;
    }

    private final File dir;
    // What actState() reports: the recording in progress, else the newest finished one not cleared.
    private Rec rec;
    private boolean loaded;

    ActivityTrack(File dir) {
        this.dir = dir;
    }

    /** One recording. */
    private static final class Rec {
        String id;
        String key;
        String type;
        String title;
        String units;
        long startedAt;
        long endedAt; // 0 while recording
        final List<long[]> pauses = new ArrayList<long[]>(); // {from, to}, to = 0 while paused
        final List<double[]> points = new ArrayList<double[]>();
        final TreeSet<Integer> breaks = new TreeSet<Integer>(); // points where the line starts again
        double distanceM;
        // The distance filter.
        double[] anchor;
        double[] prev;
        int jumps;
        boolean breakNext;
        // Steps.
        boolean stepsOn;
        long steps;
        double lastCounter = -1;
        long counterBoot;
        // The latest fix, stored or not.
        double[] lastFix;
        long lastGoodAt;
        long savedAt;
        FileOutputStream out;

        boolean active() {
            return endedAt == 0L;
        }

        boolean paused() {
            return !pauses.isEmpty() && pauses.get(pauses.size() - 1)[1] == 0L;
        }

        long pausedMs(long now) {
            long total = 0L;
            for (long[] p : pauses) {
                long to = p[1] != 0L ? p[1] : active() ? now : endedAt;
                total += Math.max(0L, to - p[0]);
            }
            return total;
        }

        long elapsedMs(long now) {
            long end = active() ? now : endedAt;
            return Math.max(0L, end - startedAt - pausedMs(now));
        }
    }

    /** What the notification shows. */
    static final class Snapshot {
        boolean active;
        boolean paused;
        String type;
        String title;
        String units;
        long elapsedMs;
        double distanceM;
        long steps = -1; // -1: not counted
    }

    // ---------------------------------------------------------------- recording

    /** Starts a recording: STARTED, ALREADY (this one is recording), or BUSY (another one is). */
    synchronized int begin(String id, String type, String title, String units, long now) {
        load();
        if (rec != null && rec.active()) {
            return id.equals(rec.id) ? ALREADY : BUSY;
        }
        close(rec);
        Rec r = new Rec();
        r.id = id;
        r.key = key(id);
        r.type = type;
        r.title = title;
        r.units = units;
        r.startedAt = now;
        deleteFiles(r.key); // the same id again: this one replaces it
        rec = r;
        saveMeta(r, now);
        open(r);
        pruneFinished();
        return STARTED;
    }

    synchronized boolean isActive() {
        load();
        return rec != null && rec.active();
    }

    synchronized boolean isPaused() {
        load();
        return rec != null && rec.active() && rec.paused();
    }

    synchronized void pause(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active() || r.paused()) {
            return;
        }
        r.pauses.add(new long[]{Math.max(now, r.startedAt), 0L});
        r.anchor = null;
        r.prev = null;
        r.jumps = 0;
        saveMeta(r, now);
        sync(r);
    }

    synchronized void resume(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active() || !r.paused()) {
            return;
        }
        long[] last = r.pauses.get(r.pauses.size() - 1);
        last[1] = Math.max(now, last[0]);
        r.breakNext = true; // the line starts again at the next point
        saveMeta(r, now);
    }

    /** Ends the recording in progress. It stays (as finished) until the page clears it. */
    synchronized void finish(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active()) {
            return;
        }
        long end = Math.max(now, r.startedAt + 1L);
        if (r.paused()) {
            r.pauses.get(r.pauses.size() - 1)[1] = end;
        }
        r.endedAt = end;
        r.anchor = null;
        r.prev = null;
        saveMeta(r, now);
        close(r);
    }

    /** Forgets a recording that never got going (the service couldn't start). */
    synchronized void discard(String id) {
        load();
        if (rec != null && rec.id.equals(id)) {
            close(rec);
            deleteFiles(rec.key);
            rec = null;
            loaded = false; // the next call loads the newest finished recording, if any
        }
    }

    /** Deletes a finished recording's files (actClear). A recording in progress is left alone. */
    synchronized boolean clear(String id) {
        load();
        if (id == null || id.isEmpty()) {
            return false;
        }
        if (rec != null && rec.id.equals(id)) {
            if (rec.active()) {
                return false;
            }
            deleteFiles(rec.key);
            rec = null;
            loaded = false;
            return true;
        }
        String key = key(id);
        Rec other = readMeta(new File(dir, key + ".json"));
        if (other != null && other.active()) {
            return false;
        }
        return deleteFiles(key);
    }

    // ---------------------------------------------------------------- feeding it

    /**
     * One location fix: t in epoch ms, alt and speed NaN when unknown, acc in meters (NaN: unknown,
     * counted as poor). The latest fix is always remembered; see the class comment for what's stored.
     */
    synchronized void addFix(long t, double lat, double lon, double alt, double acc, double speed) {
        Rec r = rec;
        if (r == null || !r.active() || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)
                || (lat == 0 && lon == 0)) {
            return;
        }
        double accuracy = acc >= 0 ? acc : 100;
        boolean paused = r.paused();
        r.lastFix = new double[]{t, lat, lon, accuracy};
        if (accuracy <= MAX_ACCURACY_M) {
            r.lastGoodAt = Math.max(r.lastGoodAt, t);
        }
        double[] last = r.points.isEmpty() ? null : r.points.get(r.points.size() - 1);
        if ((last != null && t <= last[T]) || r.points.size() >= MAX_POINTS) {
            return;
        }
        boolean force = r.breakNext || last == null || (last[PAUSED] != 0) != paused
                || (last[ACC] > MAX_ACCURACY_M && accuracy <= MAX_ACCURACY_M);
        if (!force && t - last[T] < STORE_EVERY_MS && meters(last, lat, lon) < STORE_MOVE_M) {
            return;
        }
        double[] p = {t, round(lat, 6), round(lon, 6), finite(alt) ? round(alt, 1) : Double.NaN,
                round(accuracy, 1), finite(speed) && speed >= 0 ? round(speed, 2) : Double.NaN, paused ? 1 : 0};
        boolean isBreak = r.breakNext;
        int verdict = step(r, p, isBreak);
        if (verdict == DROP) {
            return;
        }
        r.breakNext = false;
        int index = r.points.size();
        r.points.add(p);
        write(r, p);
        if (isBreak || verdict == RESTART) {
            r.breaks.add(index);
            saveMeta(r, t);
        }
    }

    /**
     * The step counter's value (steps since the phone started; {@code boot} is when that was, in epoch
     * ms). Steps count from the first value this recording sees, and not while paused.
     */
    synchronized void onStepCounter(double value, long boot) {
        Rec r = rec;
        if (r == null || !r.active() || !(value >= 0)) {
            return;
        }
        r.stepsOn = true;
        boolean rebooted = Math.abs(boot - r.counterBoot) > 60000L;
        if (r.lastCounter < 0 || rebooted || value < r.lastCounter) {
            r.lastCounter = value;
            r.counterBoot = boot;
            return;
        }
        double delta = value - r.lastCounter;
        r.lastCounter = value;
        if (!r.paused() && delta > 0 && delta < 100000) {
            r.steps += Math.round(delta);
        }
    }

    /** Steps are being counted (the sensor is there and allowed): steps is a number, not null. */
    synchronized void stepsAvailable() {
        if (rec != null && rec.active()) {
            rec.stepsOn = true;
        }
    }

    /** Saves the details and flushes the track to disk if it's been 20 seconds. */
    synchronized void saveIfDue(long now) {
        Rec r = rec;
        if (r != null && r.active() && now - r.savedAt >= SAVE_EVERY_MS) {
            saveMeta(r, now);
            sync(r);
        }
    }

    /** When the last fix accurate to 50 m arrived (epoch ms), or 0. */
    synchronized long lastGoodFixAt() {
        return rec != null && rec.active() ? rec.lastGoodAt : 0L;
    }

    // ---------------------------------------------------------------- reading it

    synchronized Snapshot snapshot(long now) {
        load();
        Snapshot s = new Snapshot();
        Rec r = rec;
        if (r == null) {
            return s;
        }
        s.active = r.active();
        s.paused = r.active() && r.paused();
        s.type = r.type;
        s.title = r.title;
        s.units = r.units;
        s.elapsedMs = r.elapsedMs(now);
        s.distanceM = r.distanceM;
        s.steps = r.stepsOn ? r.steps : -1L;
        return s;
    }

    /**
     * actState(): {active, id, type, title, units, startedAt, endedAt, paused, pausedMs, elapsedMs,
     * distanceM, steps, points, lastFix: {lat, lon, acc, t}, gps}. With nothing recording it describes
     * the newest finished recording the page hasn't cleared (active false), or nothing.
     */
    synchronized String stateJson(long now, String gps) {
        load();
        Rec r = rec;
        try {
            JSONObject o = new JSONObject();
            o.put("active", r != null && r.active());
            o.put("id", r == null ? JSONObject.NULL : r.id);
            o.put("type", r == null ? JSONObject.NULL : r.type);
            o.put("title", r == null ? JSONObject.NULL : r.title);
            o.put("units", r == null ? JSONObject.NULL : r.units);
            o.put("startedAt", r == null ? JSONObject.NULL : (Object) r.startedAt);
            o.put("endedAt", r == null || r.active() ? JSONObject.NULL : (Object) r.endedAt);
            o.put("paused", r != null && r.active() && r.paused());
            o.put("pausedMs", r == null ? 0L : r.pausedMs(now));
            o.put("elapsedMs", r == null ? 0L : r.elapsedMs(now));
            o.put("distanceM", r == null ? 0.0 : round(r.distanceM, 1));
            o.put("steps", r == null || !r.stepsOn ? JSONObject.NULL : (Object) r.steps);
            o.put("points", r == null ? 0 : r.points.size());
            if (r != null && r.lastFix != null) {
                JSONObject f = new JSONObject();
                f.put("lat", r.lastFix[LAT]);
                f.put("lon", r.lastFix[LON]);
                f.put("acc", round(r.lastFix[3], 1));
                f.put("t", (long) r.lastFix[T]);
                o.put("lastFix", f);
            } else {
                o.put("lastFix", JSONObject.NULL);
            }
            o.put("gps", r != null && r.active() ? gps : "off");
            return o.toString();
        } catch (Throwable t) {
            return "{\"active\":false}";
        }
    }

    /** The points from index {@code from}: [[t, lat, lon, alt|null, acc, speed|null, paused], ...]. */
    synchronized String pointsJson(int from) {
        load();
        Rec r = rec;
        StringBuilder sb = new StringBuilder("[");
        if (r != null) {
            for (int i = Math.max(0, from); i < r.points.size(); i++) {
                if (sb.length() > 1) {
                    sb.append(',');
                }
                sb.append(line(r.points.get(i)));
            }
        }
        return sb.append(']').toString();
    }

    // ---------------------------------------------------------------- the distance filter

    /**
     * One point, in order, through the filter (while recording and when loading alike): KEEP, DROP
     * (a GPS jump, left out of the track) or RESTART (kept, and the line starts again here).
     */
    private static int step(Rec r, double[] p, boolean isBreak) {
        if (isBreak || p[PAUSED] != 0) {
            r.anchor = null;
            r.prev = null;
            r.jumps = 0;
        }
        if (p[PAUSED] != 0 || !(p[ACC] <= MAX_ACCURACY_M)) {
            return KEEP;
        }
        double[] q = r.prev;
        if (q != null) {
            double dt = (p[T] - q[T]) / 1000.0;
            if (dt > 0 && meters(q, p[LAT], p[LON]) / dt > maxSpeed(r.type)) {
                if (++r.jumps < JUMPS_TO_MOVE) {
                    return DROP;
                }
                r.anchor = p;
                r.prev = p;
                r.jumps = 0;
                return RESTART;
            }
        }
        r.jumps = 0;
        r.prev = p;
        double[] a = r.anchor;
        if (a == null) {
            r.anchor = p;
            return KEEP;
        }
        if (p[SPEED] < STILL_SPEED) { // (false for an unknown speed, NaN)
            return KEEP;
        }
        double d = meters(a, p[LAT], p[LON]);
        double threshold = Math.max(MIN_STEP_M, Math.min(MAX_STEP_M, Math.max(a[ACC], p[ACC])));
        if (d >= threshold) {
            r.distanceM += d;
            r.anchor = p;
        }
        return KEEP;
    }

    private static double maxSpeed(String type) {
        return "walk".equals(type) || "hike".equals(type) ? FOOT_MAX_SPEED : FAST_MAX_SPEED;
    }

    private static double meters(double[] a, double lat, double lon) {
        float[] out = new float[1];
        Location.distanceBetween(a[LAT], a[LON], lat, lon, out);
        return out[0];
    }

    private static void replay(Rec r) {
        r.distanceM = 0;
        r.anchor = null;
        r.prev = null;
        r.jumps = 0;
        for (int i = 0; i < r.points.size(); i++) {
            step(r, r.points.get(i), r.breaks.contains(i));
        }
    }

    // ---------------------------------------------------------------- files

    /** A file name for an id: its safe characters plus a hash of the whole id. */
    static String key(String id) {
        String safe = id.replaceAll("[^A-Za-z0-9_-]", "_");
        if (safe.length() > 48) {
            safe = safe.substring(0, 48);
        }
        return safe + "-" + Integer.toHexString(id.hashCode());
    }

    /** Loads the recording in progress, else the newest finished one, once. */
    private void load() {
        if (loaded) {
            return;
        }
        loaded = true;
        rec = null;
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        Rec active = null;
        Rec finished = null;
        for (File f : files) {
            if (!f.getName().endsWith(".json")) {
                continue;
            }
            Rec r = readMeta(f);
            if (r == null) {
                continue;
            }
            if (r.active()) {
                if (active == null || r.startedAt > active.startedAt) {
                    if (active != null) {
                        endStale(active);
                    }
                    active = r;
                } else {
                    endStale(r);
                }
            } else if (finished == null || r.endedAt > finished.endedAt) {
                finished = r;
            }
        }
        rec = active != null ? active : finished;
        if (rec != null) {
            readPoints(rec);
            replay(rec);
            if (rec.active()) {
                // Resumed after the last stored point (then the app stopped): the line starts again.
                long[] last = rec.pauses.isEmpty() ? null : rec.pauses.get(rec.pauses.size() - 1);
                double lastT = rec.points.isEmpty() ? 0 : rec.points.get(rec.points.size() - 1)[T];
                rec.breakNext = last != null && last[1] != 0L && last[1] > lastT;
                open(rec);
            }
        }
    }

    /** Two recordings in progress can't be: the older one ended when its file last changed. */
    private void endStale(Rec r) {
        File f = new File(dir, r.key + ".track");
        r.endedAt = Math.max(r.startedAt + 1L, f.isFile() ? f.lastModified() : r.startedAt + 1L);
        if (r.paused()) {
            r.pauses.get(r.pauses.size() - 1)[1] = r.endedAt;
        }
        saveMeta(r, r.endedAt);
    }

    private static Rec readMeta(File f) {
        try {
            if (!f.isFile() || f.length() > 4L * 1024 * 1024) {
                return null;
            }
            JSONObject o = new JSONObject(readText(f));
            Rec r = new Rec();
            r.id = o.getString("id");
            String name = f.getName();
            r.key = name.substring(0, name.length() - ".json".length());
            r.type = o.optString("type", "other");
            r.title = o.optString("title", "");
            r.units = o.optString("units", "km");
            r.startedAt = o.getLong("startedAt");
            r.endedAt = o.optLong("endedAt", 0L);
            JSONArray pauses = o.optJSONArray("pauses");
            for (int i = 0; pauses != null && i < pauses.length(); i++) {
                JSONArray p = pauses.optJSONArray(i);
                if (p != null && p.length() >= 2) {
                    r.pauses.add(new long[]{p.optLong(0), p.optLong(1)});
                }
            }
            JSONArray breaks = o.optJSONArray("breaks");
            for (int i = 0; breaks != null && i < breaks.length(); i++) {
                r.breaks.add(breaks.optInt(i));
            }
            JSONObject steps = o.optJSONObject("steps");
            if (steps != null) {
                r.stepsOn = steps.optBoolean("on", false);
                r.steps = steps.optLong("n", 0L);
                r.lastCounter = steps.optDouble("last", -1);
                r.counterBoot = steps.optLong("boot", 0L);
            }
            return r;
        } catch (Throwable t) {
            return null;
        }
    }

    private void readPoints(Rec r) {
        File f = new File(dir, r.key + ".track");
        if (!f.isFile()) {
            return;
        }
        try {
            String text = readText(f);
            int start = 0;
            while (start < text.length()) {
                int end = text.indexOf('\n', start);
                if (end < 0) {
                    end = text.length();
                }
                double[] p = parse(text, start, end);
                if (p != null && (r.points.isEmpty() || p[T] > r.points.get(r.points.size() - 1)[T])) {
                    r.points.add(p);
                }
                start = end + 1;
            }
        } catch (Throwable ignored) {
            // Whatever was read stays.
        }
        if (!r.points.isEmpty()) {
            double[] last = r.points.get(r.points.size() - 1);
            r.lastFix = new double[]{last[T], last[LAT], last[LON], last[ACC]};
        }
    }

    /** "[t,lat,lon,alt|null,acc,speed|null,paused]" → a point, or null (a line cut off by a crash). */
    private static double[] parse(String text, int start, int end) {
        String s = text.substring(start, end).trim();
        if (s.length() < 2 || s.charAt(0) != '[' || s.charAt(s.length() - 1) != ']') {
            return null;
        }
        String[] parts = s.substring(1, s.length() - 1).split(",");
        if (parts.length != 7) {
            return null;
        }
        double[] p = new double[7];
        try {
            for (int i = 0; i < 7; i++) {
                String v = parts[i].trim();
                p[i] = "null".equals(v) ? Double.NaN : Double.parseDouble(v);
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return finite(p[T]) && finite(p[LAT]) && finite(p[LON]) && finite(p[ACC]) ? p : null;
    }

    static String line(double[] p) {
        return "[" + (long) p[T] + "," + num(p[LAT]) + "," + num(p[LON]) + "," + num(p[ALT]) + ","
                + num(p[ACC]) + "," + num(p[SPEED]) + "," + (p[PAUSED] != 0 ? 1 : 0) + "]";
    }

    private static String num(double v) {
        if (!finite(v)) {
            return "null";
        }
        if (v == Math.rint(v) && Math.abs(v) < 1e15) {
            return Long.toString((long) v);
        }
        return Double.toString(v);
    }

    private void write(Rec r, double[] p) {
        byte[] bytes = (line(p) + "\n").getBytes(StandardCharsets.UTF_8);
        for (int attempt = 0; attempt < 2; attempt++) {
            if (r.out == null) {
                open(r);
            }
            if (r.out == null) {
                return;
            }
            try {
                r.out.write(bytes);
                return;
            } catch (IOException e) {
                close(r);
            }
        }
    }

    /** Opens the track for appending, first ending a line a crash cut off. */
    private void open(Rec r) {
        if (r.out != null) {
            return;
        }
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return;
            }
            File f = new File(dir, r.key + ".track");
            boolean cut = false;
            if (f.isFile() && f.length() > 0) {
                java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
                try {
                    raf.seek(f.length() - 1);
                    cut = raf.read() != '\n';
                } finally {
                    raf.close();
                }
            }
            r.out = new FileOutputStream(f, true);
            if (cut) {
                r.out.write('\n');
            }
        } catch (Throwable t) {
            r.out = null;
        }
    }

    private static void sync(Rec r) {
        if (r != null && r.out != null) {
            try {
                r.out.getFD().sync();
            } catch (Throwable ignored) {
            }
        }
    }

    private static void close(Rec r) {
        if (r != null && r.out != null) {
            sync(r);
            try {
                r.out.close();
            } catch (Throwable ignored) {
            }
            r.out = null;
        }
    }

    /** Writes &lt;key&gt;.json atomically: a tmp file, fsync, rename. */
    private void saveMeta(Rec r, long now) {
        try {
            JSONObject o = new JSONObject();
            o.put("v", 1);
            o.put("id", r.id);
            o.put("type", r.type);
            o.put("title", r.title);
            o.put("units", r.units);
            o.put("startedAt", r.startedAt);
            o.put("endedAt", r.endedAt);
            JSONArray pauses = new JSONArray();
            for (long[] p : r.pauses) {
                pauses.put(new JSONArray().put(p[0]).put(p[1]));
            }
            o.put("pauses", pauses);
            o.put("breaks", new JSONArray(r.breaks));
            JSONObject steps = new JSONObject();
            steps.put("on", r.stepsOn);
            steps.put("n", r.steps);
            steps.put("last", r.lastCounter);
            steps.put("boot", r.counterBoot);
            o.put("steps", steps);
            o.put("distanceM", round(r.distanceM, 1)); // for people reading the file; loading recomputes it
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return;
            }
            File target = new File(dir, r.key + ".json");
            File tmp = new File(dir, r.key + ".json.tmp");
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
                try {
                    out.getFD().sync();
                } catch (IOException ignored) {
                }
            } finally {
                out.close();
            }
            if (!tmp.renameTo(target)) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                //noinspection ResultOfMethodCallIgnored
                tmp.renameTo(target);
            }
            r.savedAt = now;
        } catch (Throwable ignored) {
            // The next save tries again.
        }
    }

    private boolean deleteFiles(String key) {
        boolean any = false;
        for (String ext : new String[]{".json", ".track", ".json.tmp"}) {
            File f = new File(dir, key + ext);
            if (f.exists()) {
                any |= f.delete();
            }
        }
        return any;
    }

    /** At most KEEP_FINISHED finished recordings wait for the page; older ones go. */
    private void pruneFinished() {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        List<long[]> ends = new ArrayList<long[]>(); // {endedAt, index}
        List<String> keys = new ArrayList<String>();
        for (File f : files) {
            if (!f.getName().endsWith(".json")) {
                continue;
            }
            Rec r = readMeta(f);
            if (r != null && !r.active()) {
                ends.add(new long[]{r.endedAt, keys.size()});
                keys.add(r.key);
            }
        }
        if (ends.size() <= KEEP_FINISHED) {
            return;
        }
        Collections.sort(ends, new java.util.Comparator<long[]>() {
            @Override
            public int compare(long[] a, long[] b) {
                return Long.compare(b[0], a[0]); // newest first
            }
        });
        for (int i = KEEP_FINISHED; i < ends.size(); i++) {
            deleteFiles(keys.get((int) ends.get(i)[1]));
        }
    }

    private static String readText(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream((int) Math.min(f.length(), 1 << 24) + 16);
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, n);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    // ---------------------------------------------------------------- numbers

    static boolean finite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }

    static double round(double v, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(v * scale) / scale;
    }

    /** "km" or "mi" for a units hint from the page, else what this phone's country uses. */
    static String units(String hint) {
        if ("km".equals(hint) || "mi".equals(hint)) {
            return hint;
        }
        String country = Locale.getDefault().getCountry();
        return "US".equals(country) || "LR".equals(country) || "MM".equals(country) ? "mi" : "km";
    }
}
