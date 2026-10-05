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
 * finish and every 20 seconds: {v, id, type, title, units, startedAt, endedAt, pauses: [[from, to,
 * auto]], breaks, steps: {on, n, last, boot}, opts: {autoPause, voice}, splits: {n, at}}.
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
 * <li>between two good points no more than 12 s apart that both have the GPS's own (Doppler) speed,
 * the distance is their average speed times the time between them (nothing under 0.4 m/s): far
 * steadier than the step between two positions, whose errors add up;
 * <li>otherwise distance counts from an anchor that only moves once the position has moved further
 * than the points' accuracy explains (the worse accuracy, 3 to 20 m), and not while the GPS says the
 * phone is standing still (under 0.4 m/s): GPS wander at a crossing adds nothing, and since the anchor
 * waits instead of skipping, a straight line loses nothing.
 * </ul>
 * This is the notification's distance and the spoken splits'; the page works out its own from the
 * points (src/activity.js, track()), and the two agree to about 1% with speeds.
 * Fixes arrive about once a second. One is stored when it's 3 m from the last stored point, 10 s after
 * it, the first accurate one after inaccurate ones, or the first after a pause or resume.
 *
 * Auto-pause ({@link ActivityAutoPause}, when the activity has it on) holds back the fixes it's
 * unsure of for a few seconds, then hands them on flagged: a pause it makes starts where the stop
 * began (its interval's third column is 1), and one it ends, where the moving began. The clock, the
 * stored flags and the page's maths so agree. A pause or resume by hand takes over from it.
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
    /** Points with speeds this close (s) are measured by their speed; farther apart, by where they are. */
    private static final double DOPPLER_GAP_S = 12;
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
        final List<long[]> pauses = new ArrayList<long[]>(); // {from, to, auto}, to = 0 while paused
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
        // The latest fix, stored or not: {t, lat, lon, acc, speed, bearing} (NaN: unknown).
        double[] lastFix;
        long lastGoodAt;
        // Where the phone roughly is while GPS looks (the network's guess, for the map only):
        // {t, lat, lon, acc}.
        double[] coarse;
        // Auto-pause (null when it's off) and the spoken splits.
        ActivityAutoPause auto;
        boolean voice;
        // The whole km or miles passed so far, and the clock when the last one was.
        int splits;
        long splitAtMs;
        long savedAt;
        FileOutputStream out;

        boolean active() {
            return endedAt == 0L;
        }

        boolean paused() {
            return !pauses.isEmpty() && pauses.get(pauses.size() - 1)[1] == 0L;
        }

        /** Paused by auto-pause (not by hand). */
        boolean autoPaused() {
            if (!paused()) {
                return false;
            }
            long[] last = pauses.get(pauses.size() - 1);
            return last.length > 2 && last[2] == 1L;
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

    /** What the notification and the spoken splits read. */
    static final class Snapshot {
        boolean active;
        boolean paused;
        boolean autoPaused;
        boolean voice;
        String type;
        String title;
        String units;
        long elapsedMs;
        double distanceM;
        long steps = -1; // -1: not counted
    }

    /** A whole km or mile just passed: which one, the clock then, and how long that one took. */
    static final class Split {
        int n;
        long clockMs;
        long splitMs;
        String type;
        String units;
    }

    // ---------------------------------------------------------------- recording

    /**
     * Starts a recording: STARTED, ALREADY (this one is recording), or BUSY (another one is). With
     * {@code autoPause} the clock stops by itself when the person stops; {@code voice}: the service
     * says each km or mile.
     */
    synchronized int begin(String id, String type, String title, String units, long now, boolean autoPause, boolean voice) {
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
        r.auto = autoPause ? new ActivityAutoPause(type, false) : null;
        r.voice = voice;
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

    /**
     * A pause by hand. What auto-pause was holding is kept as it stood; a pause it made becomes one
     * by hand (it won't end by itself).
     */
    synchronized void pause(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active()) {
            return;
        }
        if (r.auto != null) {
            keepAll(r, r.auto.manual().out);
        }
        if (r.paused()) {
            long[] last = r.pauses.get(r.pauses.size() - 1);
            if (last.length > 2 && last[2] == 1L) {
                last[2] = 0L;
                saveMeta(r, now);
            }
            return;
        }
        startPause(r, Math.max(now, r.startedAt), false);
        saveMeta(r, now);
        sync(r);
    }

    synchronized void resume(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active() || !r.paused()) {
            return;
        }
        if (r.auto != null) {
            keepAll(r, r.auto.manual().out);
        }
        endPause(r, now);
        saveMeta(r, now);
    }

    private static void startPause(Rec r, long from, boolean auto) {
        r.pauses.add(new long[]{from, 0L, auto ? 1L : 0L});
        r.anchor = null;
        r.prev = null;
        r.jumps = 0;
    }

    private static void endPause(Rec r, long at) {
        long[] last = r.pauses.get(r.pauses.size() - 1);
        last[1] = Math.max(at, last[0]);
        r.breakNext = true; // the line starts again at the next point
    }

    /**
     * Auto-pause and the spoken splits, changed while recording (null: as it is). Auto-pause turned
     * off while it has the clock stopped: the clock goes on now.
     */
    synchronized void setOptions(Boolean autoPause, Boolean voice, long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active()) {
            return;
        }
        if (autoPause != null) {
            if (autoPause && r.auto == null) {
                r.auto = new ActivityAutoPause(r.type, false);
            } else if (!autoPause && r.auto != null) {
                keepAll(r, r.auto.drain().out);
                r.auto = null;
                if (r.autoPaused()) {
                    endPause(r, now);
                }
            }
        }
        if (voice != null) {
            r.voice = voice;
        }
        saveMeta(r, now);
    }

    /** Ends the recording in progress. It stays (as finished) until the page clears it. */
    synchronized void finish(long now) {
        load();
        Rec r = rec;
        if (r == null || !r.active()) {
            return;
        }
        if (r.auto != null) {
            keepAll(r, r.auto.drain().out);
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
     * One location fix: t in epoch ms, alt, speed and bearing NaN when unknown, acc in meters (NaN:
     * unknown, counted as poor). The latest fix is always remembered; see the class comment for what's
     * stored, and auto-pause for when.
     */
    synchronized void addFix(long t, double lat, double lon, double alt, double acc, double speed, double bearing) {
        Rec r = rec;
        if (r == null || !r.active() || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)
                || (lat == 0 && lon == 0)) {
            return;
        }
        double accuracy = acc >= 0 ? acc : 100;
        double v = finite(speed) && speed >= 0 ? round(speed, 2) : Double.NaN;
        r.lastFix = new double[]{t, lat, lon, accuracy, v, finite(bearing) && bearing >= 0 && bearing <= 360 ? round(bearing, 1) : Double.NaN};
        if (accuracy <= MAX_ACCURACY_M) {
            r.lastGoodAt = Math.max(r.lastGoodAt, t);
        }
        double[] p = {t, round(lat, 6), round(lon, 6), finite(alt) ? round(alt, 1) : Double.NaN,
                round(accuracy, 1), v, r.paused() ? 1 : 0};
        // Paused by hand (or waiting for the 3-2-1): kept as it comes. Otherwise auto-pause has its say.
        if (r.auto == null || (r.paused() && !r.autoPaused())) {
            store(r, p);
            return;
        }
        ActivityAutoPause.Result res = r.auto.feed(p);
        if (res.pause >= 0 && !r.paused()) {
            startPause(r, Math.max(res.pause, r.startedAt), true);
            saveMeta(r, t);
        }
        if (res.resume >= 0 && r.autoPaused()) {
            endPause(r, res.resume);
            saveMeta(r, t);
        }
        keepAll(r, res.out);
    }

    private void keepAll(Rec r, List<double[]> points) {
        for (double[] p : points) {
            store(r, p);
        }
    }

    /** Stores a point (its paused column as given) if it's worth keeping: see the class comment. */
    private void store(Rec r, double[] p) {
        long t = (long) p[T];
        boolean paused = p[PAUSED] != 0;
        double[] last = r.points.isEmpty() ? null : r.points.get(r.points.size() - 1);
        if ((last != null && t <= last[T]) || r.points.size() >= MAX_POINTS) {
            return;
        }
        boolean force = r.breakNext || last == null || (last[PAUSED] != 0) != paused
                || (last[ACC] > MAX_ACCURACY_M && p[ACC] <= MAX_ACCURACY_M);
        if (!force && t - last[T] < STORE_EVERY_MS && meters(last, p[LAT], p[LON]) < STORE_MOVE_M) {
            return;
        }
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

    /** A rough position (the network's or the fused provider's) while GPS looks: for the map only. */
    synchronized void setCoarse(long t, double lat, double lon, double acc) {
        Rec r = rec;
        if (r == null || !r.active() || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180) || (lat == 0 && lon == 0)) {
            return;
        }
        if (r.coarse != null && r.coarse[0] > t) {
            return;
        }
        r.coarse = new double[]{t, lat, lon, acc >= 0 ? acc : 1000};
    }

    /**
     * A whole km or mile passed since the last one (in the activity's units, by its distance), or null.
     * Checked every second while it records, whether or not anyone is told, so each one's time is its
     * own. Two at once (a jump after GPS came back) count as one, at the time they took between them.
     */
    synchronized Split takeSplit(long now) {
        Rec r = rec;
        if (r == null || !r.active() || r.paused()) {
            return null;
        }
        double unit = "mi".equals(r.units) ? 1609.344 : 1000.0;
        int whole = (int) Math.floor(r.distanceM / unit + 1e-9);
        if (whole <= r.splits) {
            return null;
        }
        long clock = r.elapsedMs(now);
        Split s = new Split();
        s.n = whole;
        s.clockMs = clock;
        s.splitMs = Math.max(0L, (clock - r.splitAtMs) / (whole - r.splits));
        s.type = r.type;
        s.units = r.units;
        r.splits = whole;
        r.splitAtMs = clock;
        saveMeta(r, now);
        return s;
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
        s.autoPaused = r.active() && r.autoPaused();
        s.voice = r.voice;
        s.type = r.type;
        s.title = r.title;
        s.units = r.units;
        s.elapsedMs = r.elapsedMs(now);
        s.distanceM = r.distanceM;
        s.steps = r.stepsOn ? r.steps : -1L;
        return s;
    }

    /**
     * actState(): {active, id, type, title, units, startedAt, endedAt, paused, autoPaused, pausedMs,
     * elapsedMs, distanceM, steps, points, lastFix: {lat, lon, acc, t, speed?, bearing?}, coarse: {lat,
     * lon, acc, t}, gps, opts: {autoPause, voice}}. With nothing recording it describes the newest
     * finished recording the page hasn't cleared (active false), or nothing.
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
            o.put("autoPaused", r != null && r.active() && r.autoPaused());
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
                if (r.lastFix.length > 5) {
                    if (finite(r.lastFix[4])) {
                        f.put("speed", r.lastFix[4]);
                    }
                    if (finite(r.lastFix[5])) {
                        f.put("bearing", r.lastFix[5]);
                    }
                }
                o.put("lastFix", f);
            } else {
                o.put("lastFix", JSONObject.NULL);
            }
            if (r != null && r.active() && r.coarse != null) {
                JSONObject c = new JSONObject();
                c.put("lat", round(r.coarse[1], 6));
                c.put("lon", round(r.coarse[2], 6));
                c.put("acc", round(r.coarse[3], 1));
                c.put("t", (long) r.coarse[0]);
                o.put("coarse", c);
            }
            o.put("gps", r != null && r.active() ? gps : "off");
            JSONObject opts = new JSONObject();
            opts.put("autoPause", r != null && r.auto != null);
            opts.put("voice", r != null && r.voice);
            o.put("opts", opts);
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
        // Between two good points that both have the GPS's own (Doppler) speed, the distance is that
        // speed times the time between them: steadier by far than the step between two positions,
        // whose errors add up (and their wander while standing still).
        if (q != null && finite(p[SPEED]) && finite(q[SPEED])) {
            double dt = (p[T] - q[T]) / 1000.0;
            if (dt > 0 && dt <= DOPPLER_GAP_S) {
                double v = Math.min(maxSpeed(r.type), (p[SPEED] + q[SPEED]) / 2);
                if (v >= STILL_SPEED) {
                    r.distanceM += v * dt;
                }
                r.anchor = p;
                return KEEP;
            }
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
                    r.pauses.add(new long[]{p.optLong(0), p.optLong(1), p.optLong(2, 0L) == 1L ? 1L : 0L});
                }
            }
            JSONObject opts = o.optJSONObject("opts");
            if (opts != null) {
                // Picked up again: auto-paused if it was (it goes on once the person moves).
                r.auto = opts.optBoolean("autoPause", false) && r.active() ? new ActivityAutoPause(r.type, r.autoPaused()) : null;
                r.voice = opts.optBoolean("voice", false);
            }
            JSONObject splits = o.optJSONObject("splits");
            if (splits != null) {
                r.splits = Math.max(0, splits.optInt("n", 0));
                r.splitAtMs = Math.max(0L, splits.optLong("at", 0L));
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
                pauses.put(new JSONArray().put(p[0]).put(p[1]).put(p.length > 2 ? p[2] : 0L));
            }
            o.put("pauses", pauses);
            JSONObject opts = new JSONObject();
            opts.put("autoPause", r.auto != null);
            opts.put("voice", r.voice);
            o.put("opts", opts);
            JSONObject splits = new JSONObject();
            splits.put("n", r.splits);
            splits.put("at", r.splitAtMs);
            o.put("splits", splits);
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
