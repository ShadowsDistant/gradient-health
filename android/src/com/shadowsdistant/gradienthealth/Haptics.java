package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;

import java.util.HashMap;
import java.util.Map;

/**
 * Haptics with a feel of their own for each kind of moment, at the strength picked in Settings.
 *
 * A kind for each kind of moment, in the groups the Settings gallery shows them in (platform.js has
 * the same names, with browser patterns of the same rhythm):
 *  - Touch: tap, press (a finger down on a knob or thumb), select, tick (a step), edge (a slider or
 *    stepper at its end), toggleOn, toggleOff, detent (a snap), hold (a long press that picks
 *    something up), day (a day picked).
 *  - Navigation: tab, nav (a page opening), back, grab and drop (a drag), sheet (a sheet rising),
 *    menu (a menu blooming out of its button), dismiss (a sheet, menu or card put away), swipe (a
 *    sheet flicked away).
 *  - Feedback: success, log (a quick log), undo, deny (refused), warning, error, heavy (something
 *    destructive, confirmed), save, copy, send, remove (taken out, with Undo), refresh (fresh data
 *    in), scan (a code read).
 *  - Workout: countdown, go, pause, setDone, done (a rest or hold over), workoutDone, levelUp,
 *    milestone, pr, start (a workout starting), cancel (a workout cancelled), skip, extend (more
 *    rest), swap (another exercise).
 *  - Moments: badge, celebrate.
 *  - Activities: actGo, actPause, actResume, actAutoPause, actAutoResume, actSplit, actGps,
 *    actFinish, actDiscard (a run, walk, hike or ride).
 * Touch and navigation are the UI kinds: they're skipped when touch feedback is switched off in the
 * phone's settings. The others always play.
 *
 * View.performHapticFeedback alone was too faint on many phones, so this drives the vibrator itself,
 * the best way the phone has:
 *  1. Composition primitives (API 30+), checked one at a time. A missing one gets a stand-in (a click
 *     for a thud, rise, fall or spin, a tick for a low tick) and the gap after it grows by about the
 *     time the original would have taken, so the rhythm stays recognisable.
 *  2. A predefined effect (API 29+) for the kinds that are one short beat (tap, press, select, tick,
 *     edge) and for deny's two even beats: the phone maker's own tuned tick, click, heavy click or
 *     double click, crisper than a waveform on most motors.
 *  3. A waveform with amplitudes, on phones with amplitude control.
 *  4. Plain on/off pulses, where a longer pulse is the only way to be stronger.
 *
 * Strength: Light plays at 0.75. Medium, the default, plays at full strength (what Strong was before
 * 1.6). Strong adds a body to each click and tick, a low tick 8 ms after it, so it lands heavier;
 * where there are no primitives, Strong steps the predefined effects up (a tick to a click, a click
 * to a heavy click) and plays waveform pulses 1.3 times as long.
 *
 * Every kind plays as a media vibration (VibrationAttributes from Android 13, AudioAttributes before),
 * so a low touch-feedback intensity in the phone's settings can't dull it.
 */
final class Haptics {
    private Haptics() {
    }

    /** 0 = light, 1 = medium (default), 2 = strong. */
    private static volatile int level = 1;

    static void setLevel(String name) {
        level = "light".equals(name) ? 0 : "strong".equals(name) ? 2 : 1;
    }

    // By level: primitives and amplitudes are scaled by SCALE; waveform pulses are STRETCH times as
    // long; on/off pulses (no amplitudes) are LENGTH times as long, their length standing in for strength.
    private static final float[] SCALE = {0.75f, 1f, 1f};
    private static final float[] STRETCH = {1f, 1f, 1.3f};
    private static final float[] LENGTH = {1.1f, 1.4f, 1.8f};

    // Composition primitives; the values are fixed by the platform (THUD, SPIN and LOW_TICK are API 31).
    private static final int CLICK = 1;
    private static final int THUD = 2;
    private static final int SPIN = 3;
    private static final int QUICK_RISE = 4;
    private static final int SLOW_RISE = 5;
    private static final int QUICK_FALL = 6;
    private static final int TICK = 7;
    private static final int LOW_TICK = 8;
    // A stand-in for a missing primitive plays this much softer (indexed by the missing primitive)...
    private static final float[] STAND_IN_SCALE = {1f, 1f, 1f, 0.8f, 0.6f, 0.5f, 0.6f, 0.5f, 0.8f};
    // ...and about this many ms shorter, which is added to the gap before the next primitive.
    private static final int[] STAND_IN_GAP = {0, 0, 30, 50, 40, 80, 30, 0, 0};

    // Strong's body: a low tick at this strength, this many ms after a click or a tick. It's only added
    // where the next beat is at least BODY_ROOM ms off, and its time (about BODY_MS) comes out of that
    // gap, so the rhythm stays as it was.
    private static final float BODY_SCALE = 0.7f;
    private static final int BODY_DELAY = 8;
    private static final int BODY_ROOM = 40;
    private static final int BODY_MS = 12;

    // Predefined effects (API 29; the values are fixed by the platform).
    private static final int NONE = -1;
    private static final int FX_CLICK = 0;
    private static final int FX_DOUBLE_CLICK = 1;
    private static final int FX_TICK = 2;
    private static final int FX_HEAVY_CLICK = 5;

    /** One kind: its composition, its predefined effect and its waveform for phones without primitives. */
    private static final class Kind {
        final boolean ui;
        final int effect;
        final int[] prims;
        final float[] scales;
        final int[] gaps; // ms of quiet before each primitive
        final long[] ms; // waveform segments...
        final float[] amps; // ...and their strength, 0-1 (0 is a pause)

        Kind(boolean ui, int effect, float[] comp, float[] wave) {
            this.ui = ui;
            this.effect = effect;
            int n = comp.length / 3;
            prims = new int[n];
            scales = new float[n];
            gaps = new int[n];
            for (int i = 0; i < n; i++) {
                prims[i] = (int) comp[i * 3];
                scales[i] = comp[i * 3 + 1];
                gaps[i] = (int) comp[i * 3 + 2];
            }
            int m = wave.length / 2;
            ms = new long[m];
            amps = new float[m];
            for (int i = 0; i < m; i++) {
                ms[i] = (long) wave[i * 2];
                amps[i] = wave[i * 2 + 1];
            }
        }
    }

    private static final Map<String, Kind> KINDS = new HashMap<String, Kind>();

    /**
     * {@code effect}: the predefined effect at Medium, or NONE. {@code comp}: primitive, scale, gap (ms)
     * triples, at Medium. {@code wave}: length (ms), strength pairs.
     */
    private static void put(String name, boolean ui, int effect, float[] comp, float[] wave) {
        KINDS.put(name, new Kind(ui, effect, comp, wave));
    }

    private static float[] c(float... v) {
        return v;
    }

    private static float[] w(float... v) {
        return v;
    }

    static {
        final boolean ui = true;
        final boolean event = false;
        // Touch: one short beat, or two close together. A long press presses in twice, deeper, and
        // gives; a day picked is a tick with a softer echo.
        put("tap", ui, FX_CLICK, c(CLICK, 1f, 0), w(20, 1f));
        put("press", ui, FX_TICK, c(LOW_TICK, 0.7f, 0), w(6, 0.45f));
        put("select", ui, FX_TICK, c(TICK, 1f, 0), w(12, 0.75f));
        put("tick", ui, FX_TICK, c(LOW_TICK, 1f, 0), w(8, 0.6f));
        put("edge", ui, FX_HEAVY_CLICK, c(THUD, 0.6f, 0), w(30, 0.9f, 40, 0, 12, 0.45f));
        put("toggleOn", ui, NONE, c(QUICK_RISE, 0.45f, 0, CLICK, 1f, 0), w(10, 0.35f, 8, 0.6f, 22, 1f));
        put("toggleOff", ui, NONE, c(CLICK, 0.75f, 0, QUICK_FALL, 0.45f, 0), w(22, 0.85f, 10, 0.45f, 8, 0.25f));
        put("detent", ui, NONE, c(CLICK, 1f, 0, LOW_TICK, 0.6f, 20), w(24, 1f, 20, 0, 10, 0.5f));
        put("hold", ui, NONE, c(LOW_TICK, 0.6f, 0, LOW_TICK, 0.8f, 26, CLICK, 1f, 26), w(8, 0.45f, 26, 0, 10, 0.65f, 26, 0, 22, 1f));
        put("day", ui, NONE, c(TICK, 0.85f, 0, LOW_TICK, 0.55f, 14), w(10, 0.7f, 14, 0, 8, 0.45f));
        // Navigation: a click with an echo for a tab, a swell into a tick going in, a fade into one
        // coming back, and a weight lifted and set down for a drag. A sheet swells up, lands and
        // settles; a menu blooms in a light flutter; put away, a sheet or a menu knocks softly and
        // fades, and flicked away it trails off.
        put("tab", ui, NONE, c(CLICK, 1f, 0, TICK, 0.5f, 25), w(18, 1f, 25, 0, 10, 0.5f));
        put("nav", ui, NONE, c(QUICK_RISE, 0.5f, 0, TICK, 0.9f, 0), w(6, 0.25f, 6, 0.45f, 10, 0, 16, 0.9f));
        put("back", ui, NONE, c(QUICK_FALL, 0.5f, 0, TICK, 0.7f, 0), w(10, 0.6f, 10, 0.35f, 10, 0, 12, 0.7f));
        put("grab", ui, NONE, c(THUD, 0.6f, 0, LOW_TICK, 0.5f, 30), w(35, 0.85f, 30, 0, 12, 0.45f));
        put("drop", ui, NONE, c(CLICK, 0.9f, 0, THUD, 0.45f, 20), w(20, 0.9f, 20, 0, 35, 0.55f));
        put("sheet", ui, NONE, c(QUICK_RISE, 0.35f, 0, LOW_TICK, 0.85f, 0, TICK, 0.3f, 45), w(8, 0.2f, 8, 0.4f, 14, 0.85f, 45, 0, 6, 0.3f));
        put("menu", ui, NONE, c(TICK, 0.5f, 0, TICK, 0.75f, 16, TICK, 0.45f, 16), w(6, 0.45f, 16, 0, 8, 0.7f, 16, 0, 5, 0.4f));
        put("dismiss", ui, NONE, c(LOW_TICK, 0.7f, 0, QUICK_FALL, 0.45f, 0), w(12, 0.65f, 10, 0.4f, 10, 0.2f));
        put("swipe", ui, NONE, c(QUICK_FALL, 0.7f, 0, LOW_TICK, 0.4f, 30, LOW_TICK, 0.25f, 30),
                w(10, 0.75f, 10, 0.5f, 10, 0.3f, 30, 0, 8, 0.35f, 30, 0, 6, 0.2f));
        // Feedback: fuller, and each with its own rhythm.
        put("success", event, NONE, c(CLICK, 0.6f, 0, CLICK, 1f, 70), w(16, 0.6f, 70, 0, 26, 1f));
        put("log", event, NONE, c(CLICK, 1f, 0, LOW_TICK, 0.8f, 40), w(26, 1f, 40, 0, 12, 0.6f));
        put("undo", event, NONE, c(CLICK, 1f, 0, CLICK, 0.6f, 70), w(26, 1f, 70, 0, 16, 0.6f));
        put("deny", event, FX_DOUBLE_CLICK, c(THUD, 0.6f, 0, THUD, 0.6f, 60), w(30, 0.75f, 60, 0, 30, 0.75f));
        put("warning", event, NONE, c(THUD, 0.85f, 0, LOW_TICK, 0.6f, 40), w(50, 0.9f, 40, 0, 14, 0.5f));
        put("error", event, NONE, c(THUD, 1f, 0, THUD, 0.8f, 50, THUD, 0.6f, 50),
                w(44, 1f, 50, 0, 40, 0.85f, 50, 0, 30, 0.65f));
        put("heavy", event, NONE, c(CLICK, 1f, 0, THUD, 1f, 0), w(14, 1f, 50, 0.9f, 20, 0.4f));
        // Saved is a latch (a click, a firmer one with its body); a copy two beats the same; sent, a
        // tap that whirls away; removed, a thump swept off; refreshed, a whirr that clicks home; a
        // code read, a click that rings out.
        put("save", event, NONE, c(CLICK, 0.7f, 0, CLICK, 1f, 30, LOW_TICK, 0.55f, 0), w(14, 0.65f, 30, 0, 20, 1f, 10, 0.45f));
        put("copy", event, NONE, c(CLICK, 0.75f, 0, CLICK, 0.75f, 45), w(14, 0.75f, 45, 0, 14, 0.75f));
        put("send", event, NONE, c(CLICK, 0.75f, 0, SPIN, 0.35f, 20), w(14, 0.75f, 20, 0, 8, 0.25f, 8, 0.4f, 8, 0.25f));
        put("remove", event, NONE, c(THUD, 0.55f, 0, QUICK_FALL, 0.65f, 20, LOW_TICK, 0.3f, 30),
                w(26, 0.65f, 20, 0, 10, 0.65f, 10, 0.4f, 10, 0.2f, 30, 0, 6, 0.25f));
        put("refresh", event, NONE, c(SPIN, 0.45f, 0, CLICK, 0.85f, 20), w(10, 0.3f, 10, 0.5f, 10, 0.3f, 20, 0, 14, 0.85f));
        put("scan", event, NONE, c(CLICK, 1f, 0, TICK, 0.5f, 18, TICK, 0.3f, 18), w(18, 1f, 18, 0, 6, 0.45f, 18, 0, 5, 0.3f));
        // Workout.
        put("countdown", event, NONE, c(CLICK, 1f, 0, LOW_TICK, 0.8f, 0), w(20, 1f, 8, 0.5f));
        put("go", event, NONE, c(QUICK_RISE, 0.8f, 0, CLICK, 1f, 0), w(14, 0.3f, 14, 0.55f, 14, 0.8f, 24, 1f));
        put("pause", event, NONE, c(CLICK, 1f, 0, QUICK_FALL, 0.8f, 0), w(24, 1f, 14, 0.8f, 14, 0.55f, 14, 0.3f));
        put("setDone", event, NONE, c(THUD, 0.9f, 0, CLICK, 1f, 30), w(40, 0.9f, 30, 0, 24, 1f));
        put("done", event, NONE, c(CLICK, 1f, 0, CLICK, 1f, 100, THUD, 1f, 100),
                w(20, 1f, 90, 0, 20, 1f, 90, 0, 44, 0.95f, 16, 0.4f));
        put("workoutDone", event, NONE, c(QUICK_RISE, 0.6f, 0, CLICK, 1f, 0, CLICK, 0.8f, 80, THUD, 1f, 80, SPIN, 0.7f, 60),
                w(12, 0.35f, 12, 0.7f, 24, 1f, 60, 0, 30, 0.85f, 60, 0, 50, 1f, 60, 0, 12, 0.4f, 12, 0.75f, 12, 0.4f));
        put("levelUp", event, NONE, c(TICK, 0.6f, 0, TICK, 0.8f, 50, CLICK, 1f, 50, QUICK_RISE, 0.7f, 0),
                w(10, 0.5f, 40, 0, 14, 0.7f, 40, 0, 20, 1f, 8, 0, 12, 0.4f, 12, 0.7f, 12, 1f));
        put("milestone", event, NONE, c(CLICK, 0.8f, 0, QUICK_RISE, 0.6f, 30, CLICK, 1f, 40),
                w(20, 0.8f, 30, 0, 7, 0.35f, 7, 0.6f, 30, 0, 30, 1f));
        put("pr", event, NONE, c(THUD, 1f, 0, CLICK, 1f, 60, SPIN, 0.8f, 40),
                w(60, 1f, 60, 0, 30, 1f, 40, 0, 12, 0.5f, 12, 0.85f, 12, 1f, 14, 0.6f));
        // A workout starting swells into a firm beat; cancelled, it powers down, each beat softer.
        // Skipping flicks forward twice, more rest winds the timer on by four even notches, and a
        // swap fades one exercise out and the next in.
        put("start", event, NONE, c(SLOW_RISE, 0.5f, 0, CLICK, 1f, 0, TICK, 0.5f, 50), w(16, 0.2f, 16, 0.4f, 16, 0.6f, 24, 1f, 50, 0, 8, 0.45f));
        put("cancel", event, NONE, c(CLICK, 0.85f, 0, QUICK_FALL, 0.6f, 0, LOW_TICK, 0.45f, 70, LOW_TICK, 0.25f, 70),
                w(16, 0.85f, 12, 0.55f, 12, 0.3f, 70, 0, 10, 0.45f, 70, 0, 8, 0.25f));
        put("skip", event, NONE, c(QUICK_RISE, 0.35f, 0, TICK, 0.8f, 0, QUICK_RISE, 0.35f, 25, TICK, 0.8f, 0), w(6, 0.3f, 10, 0.75f, 25, 0, 6, 0.3f, 10, 0.75f));
        put("extend", event, NONE, c(LOW_TICK, 0.6f, 0, LOW_TICK, 0.6f, 25, LOW_TICK, 0.6f, 25, LOW_TICK, 0.6f, 25),
                w(8, 0.55f, 25, 0, 8, 0.55f, 25, 0, 8, 0.55f, 25, 0, 8, 0.55f));
        put("swap", event, NONE, c(QUICK_FALL, 0.5f, 0, QUICK_RISE, 0.45f, 25, CLICK, 0.8f, 0), w(10, 0.6f, 10, 0.3f, 25, 0, 8, 0.3f, 8, 0.55f, 14, 0.85f));
        // Moments.
        put("badge", event, NONE, c(QUICK_RISE, 0.7f, 0, CLICK, 1f, 0, CLICK, 0.8f, 70, CLICK, 1f, 70, SPIN, 1f, 40, THUD, 0.8f, 60),
                w(12, 0.4f, 12, 0.7f, 24, 1f, 70, 0, 20, 0.8f, 60, 0, 30, 1f, 20, 0, 12, 0.5f, 12, 0.85f, 12, 1f, 14, 0.6f, 40, 0, 60, 0.9f));
        put("celebrate", event, NONE, c(QUICK_RISE, 0.6f, 0, CLICK, 1f, 0, CLICK, 0.7f, 70, CLICK, 1f, 70, SPIN, 0.8f, 40),
                w(12, 0.3f, 12, 0.55f, 12, 0.8f, 20, 1f, 70, 0, 18, 0.7f, 70, 0, 20, 1f, 40, 0,
                        14, 0.4f, 14, 0.7f, 14, 1f, 14, 0.7f, 14, 0.4f));
        // Activities: a run, walk, hike or ride. Starting builds up to a firm click; pausing by hand
        // falls away and resuming rises (auto-pause and auto-resume are the softer, slower kin of
        // those, so a stop the app noticed feels different from one you made); a split is a lap's
        // three beats; GPS ready, a quick double and a click; finishing, the line crossed and a spin;
        // discarding, a weight that drops away.
        put("actGo", event, NONE, c(TICK, 0.5f, 0, TICK, 0.75f, 35, CLICK, 0.9f, 40, QUICK_RISE, 0.6f, 40, CLICK, 1f, 0),
                w(10, 0.35f, 25, 0, 16, 0.6f, 25, 0, 24, 0.85f, 50, 0, 40, 1f));
        put("actPause", event, NONE, c(CLICK, 1f, 0, QUICK_FALL, 0.6f, 30, LOW_TICK, 0.5f, 60),
                w(40, 1f, 30, 0, 20, 0.6f, 60, 0, 10, 0.35f));
        put("actResume", event, NONE, c(LOW_TICK, 0.5f, 0, QUICK_RISE, 0.6f, 50, CLICK, 1f, 30),
                w(10, 0.35f, 50, 0, 20, 0.6f, 30, 0, 40, 1f));
        put("actAutoPause", event, NONE, c(TICK, 0.7f, 0, QUICK_FALL, 0.45f, 40, LOW_TICK, 0.4f, 90),
                w(16, 0.6f, 40, 0, 10, 0.4f, 90, 0, 8, 0.3f));
        put("actAutoResume", event, NONE, c(LOW_TICK, 0.4f, 0, QUICK_RISE, 0.45f, 90, TICK, 0.8f, 40),
                w(8, 0.3f, 90, 0, 10, 0.4f, 40, 0, 16, 0.65f));
        put("actSplit", event, NONE, c(TICK, 0.8f, 0, TICK, 0.8f, 50, CLICK, 1f, 50),
                w(16, 0.7f, 50, 0, 16, 0.7f, 50, 0, 28, 1f));
        put("actGps", event, NONE, c(TICK, 0.6f, 0, TICK, 0.6f, 20, CLICK, 0.9f, 20),
                w(8, 0.5f, 20, 0, 8, 0.5f, 20, 0, 30, 0.9f));
        put("actFinish", event, NONE, c(CLICK, 1f, 0, CLICK, 1f, 80, CLICK, 1f, 80, THUD, 1f, 60, SPIN, 0.7f, 40),
                w(24, 1f, 80, 0, 24, 1f, 80, 0, 24, 1f, 60, 0, 50, 0.95f, 20, 0.5f));
        put("actDiscard", event, NONE, c(THUD, 1f, 0, QUICK_FALL, 0.7f, 30, LOW_TICK, 0.4f, 50),
                w(60, 1f, 30, 0, 24, 0.6f, 50, 0, 10, 0.3f));
    }

    private static final AudioAttributes MEDIA = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    private static volatile Vibrator vibrator;

    /**
     * True unless the phone's "touch feedback" setting is off. Android 13 deprecated reading it in
     * favour of tagging vibrations as touch, but every kind plays as media here, so the app checks.
     */
    @SuppressWarnings("deprecation")
    static boolean systemTouchFeedback(Context context) {
        try {
            return Settings.System.getInt(context.getContentResolver(), Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0;
        } catch (Throwable t) {
            return true;
        }
    }

    /** The kind by name; an unknown name is a tap. */
    private static Kind kind(String name) {
        Kind k = name == null ? null : KINDS.get(name);
        return k != null ? k : KINDS.get("tap");
    }

    /**
     * Plays a kind by name. Any thread will do: the vibrator takes calls from any thread, so the bridge
     * plays it straight away instead of waiting for a busy UI thread. Returns false when the phone has
     * no vibrator the app can drive (see {@link #playOnView}).
     */
    static boolean play(Context context, String name) {
        Kind k = kind(name);
        try {
            if (k.ui && !systemTouchFeedback(context)) {
                return true;
            }
            Vibrator v = vibrator(context);
            if (v == null) {
                return false;
            }
            int lvl = level;
            VibrationEffect effect = Build.VERSION.SDK_INT >= 30 ? Api30.compose(v, k, SCALE[lvl], lvl == 2) : null;
            if (effect == null && k.effect != NONE && Build.VERSION.SDK_INT >= 29) {
                effect = Api29.predefined(v, step(k.effect, lvl));
            }
            if (effect == null) {
                effect = waveform(v, k, lvl);
            }
            vibrate(v, effect);
        } catch (Throwable ignored) {
            // Haptics are a nicety.
        }
        return true;
    }

    /** Without a vibrator to drive: the view's own touch feedback, for the UI kinds. UI thread only. */
    static void playOnView(Context context, View view, String name) {
        try {
            Kind k = kind(name);
            if (k.ui && view != null && systemTouchFeedback(context)) {
                view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            }
        } catch (Throwable ignored) {
            // Haptics are a nicety.
        }
    }

    /** A predefined effect a step lighter at Light (a heavy click is a click) and heavier at Strong. */
    private static int step(int effect, int lvl) {
        if (lvl == 0) {
            return effect == FX_HEAVY_CLICK ? FX_CLICK : effect;
        }
        if (lvl == 2) {
            return effect == FX_TICK ? FX_CLICK : effect == FX_CLICK ? FX_HEAVY_CLICK : effect;
        }
        return effect;
    }

    @SuppressWarnings("deprecation") // VIBRATOR_SERVICE is the only way before API 31
    private static Vibrator vibrator(Context context) {
        Vibrator v = vibrator;
        if (v != null) {
            return v;
        }
        // The application context, so the cached service never holds on to an activity.
        Context app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        if (Build.VERSION.SDK_INT >= 31) {
            v = Api31.defaultVibrator(app);
        }
        if (v == null) {
            Object service = app.getSystemService(Context.VIBRATOR_SERVICE);
            v = service instanceof Vibrator ? (Vibrator) service : null;
        }
        if (v == null || !v.hasVibrator()) {
            return null;
        }
        vibrator = v;
        return v;
    }

    /** The kind as a waveform: with amplitudes where the phone has them, else as on/off pulses. */
    private static VibrationEffect waveform(Vibrator v, Kind k, int lvl) {
        if (v.hasAmplitudeControl()) {
            long[] ms = new long[k.ms.length];
            int[] amps = new int[k.amps.length];
            for (int i = 0; i < amps.length; i++) {
                boolean on = k.amps[i] > 0f;
                ms[i] = on ? Math.max(1L, Math.round(k.ms[i] * STRETCH[lvl])) : k.ms[i];
                amps[i] = on ? Math.max(1, Math.min(255, Math.round(k.amps[i] * SCALE[lvl] * 255f))) : 0;
            }
            return VibrationEffect.createWaveform(ms, amps, -1);
        }
        // Without amplitudes the soft parts would play at full strength, so they become pauses; the
        // rest merges into pulses: on, off, on, ... lengths.
        long[] runs = new long[k.ms.length];
        long soft = 0; // all the soft parts together, for a kind that has nothing else
        int n = 0;
        boolean on = false;
        for (int i = 0; i < k.ms.length; i++) {
            if (k.amps[i] > 0f && k.amps[i] < 0.5f) {
                soft += k.ms[i];
            }
            boolean loud = k.amps[i] >= 0.5f;
            if (n == 0 && !loud) {
                continue;
            }
            if (n == 0 || loud != on) {
                runs[n++] = 0;
                on = loud;
            }
            runs[n - 1] += k.ms[i];
        }
        if (n > 0 && !on) {
            n--; // no pause after the last pulse
        }
        if (n <= 1) {
            return VibrationEffect.createOneShot(pulse(n == 1 ? runs[0] : soft, lvl), VibrationEffect.DEFAULT_AMPLITUDE);
        }
        long[] timings = new long[n + 1]; // off, on, off, on, ... starting at once
        for (int i = 0; i < n; i++) {
            timings[i + 1] = i % 2 == 0 ? pulse(runs[i], lvl) : runs[i];
        }
        return VibrationEffect.createWaveform(timings, -1);
    }

    private static long pulse(long ms, int lvl) {
        return Math.max(8L, Math.round(ms * LENGTH[lvl]));
    }

    /** As media: AudioAttributes carry the usage before Android 13. */
    @SuppressWarnings("deprecation") // vibrate(effect, AudioAttributes) is the pre-13 way to set a usage
    private static void vibrate(Vibrator v, VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= 33) {
            Api33.vibrate(v, effect);
        } else {
            v.vibrate(effect, MEDIA);
        }
    }

    /** API 29+: predefined effects. */
    private static final class Api29 {
        static VibrationEffect predefined(Vibrator v, int effect) {
            try {
                // A phone that says it can't play it would play the platform's plain fallback instead:
                // the kind's own waveform is better then.
                if (Build.VERSION.SDK_INT >= 30 && !Api30.effectPlayable(v, effect)) {
                    return null;
                }
                return VibrationEffect.createPredefined(effect);
            } catch (Throwable t) {
                return null;
            }
        }
    }

    /** API 30+ calls, isolated so older phones never load the composition classes. */
    private static final class Api30 {
        private static volatile boolean[] supported; // by primitive; the hardware doesn't change
        private static final Map<Integer, Boolean> EFFECTS = new HashMap<Integer, Boolean>();

        private static boolean has(Vibrator v, int primitive) {
            boolean[] s = supported;
            if (s == null) {
                s = new boolean[LOW_TICK + 1];
                try {
                    // Android 11 only has these five. It can't be asked about THUD, SPIN or LOW_TICK
                    // reliably (and rejects LOW_TICK in a composition), so they count as missing there.
                    int[] ids = Build.VERSION.SDK_INT >= 31
                            ? new int[]{CLICK, THUD, SPIN, QUICK_RISE, SLOW_RISE, QUICK_FALL, TICK, LOW_TICK}
                            : new int[]{CLICK, QUICK_RISE, SLOW_RISE, QUICK_FALL, TICK};
                    boolean[] got = v.arePrimitivesSupported(ids);
                    for (int i = 0; i < ids.length && i < got.length; i++) {
                        s[ids[i]] = got[i];
                    }
                } catch (Throwable ignored) {
                    // Then there are no primitives to use.
                }
                supported = s;
            }
            return primitive > 0 && primitive < s.length && s[primitive];
        }

        /** False only when the phone says it can't play the effect ("unknown" is worth a try). */
        static boolean effectPlayable(Vibrator v, int effect) {
            synchronized (EFFECTS) {
                Boolean known = EFFECTS.get(effect);
                if (known != null) {
                    return known;
                }
            }
            boolean ok = true;
            try {
                int[] got = v.areEffectsSupported(effect);
                ok = got.length == 0 || got[0] != Vibrator.VIBRATION_EFFECT_SUPPORT_NO;
            } catch (Throwable ignored) {
                // Then it's tried.
            }
            synchronized (EFFECTS) {
                EFFECTS.put(effect, ok);
            }
            return ok;
        }

        /** Where the primitive given is missing: its stand-in, or 0 when there's none (no click). */
        private static int standIn(Vibrator v, int p) {
            while (p != 0 && !has(v, p)) {
                p = p == CLICK ? 0 : p == LOW_TICK ? TICK : CLICK;
            }
            return p;
        }

        /**
         * The kind as a composition at {@code strength} (with Strong's body after each click and tick when
         * {@code body}), or null when the phone can't play it.
         */
        static VibrationEffect compose(Vibrator v, Kind k, float strength, boolean body) {
            try {
                VibrationEffect.Composition c = VibrationEffect.startComposition();
                int owed = 0; // ms to add to the next gap (less, after a body)
                for (int i = 0; i < k.prims.length; i++) {
                    int p = k.prims[i];
                    float scale = k.scales[i] * strength;
                    int gap = Math.max(0, k.gaps[i] + owed);
                    owed = 0;
                    // A low tick becomes a tick, then a click; a thud, spin, rise or fall becomes a click.
                    // Without a click there's no composition.
                    while (!has(v, p)) {
                        if (p == CLICK) {
                            return null;
                        }
                        scale *= STAND_IN_SCALE[p];
                        owed += STAND_IN_GAP[p];
                        p = p == LOW_TICK ? TICK : CLICK;
                    }
                    c.addPrimitive(p, Math.max(0f, Math.min(1f, scale)), gap);
                    // The body never doubles as a second click: only a low tick, or a softer tick.
                    int nextGap = i + 1 < k.prims.length ? k.gaps[i + 1] : -1;
                    if (body && (k.prims[i] == CLICK || k.prims[i] == TICK) && (nextGap < 0 || nextGap >= BODY_ROOM)) {
                        int b = standIn(v, LOW_TICK);
                        if (b == LOW_TICK || b == TICK) {
                            c.addPrimitive(b, b == LOW_TICK ? BODY_SCALE : BODY_SCALE * 0.6f, BODY_DELAY);
                            owed -= BODY_DELAY + BODY_MS;
                        }
                    }
                }
                return c.compose();
            } catch (Throwable t) {
                return null;
            }
        }
    }

    /** API 31+: the default vibrator (Context.VIBRATOR_SERVICE is deprecated from here). */
    private static final class Api31 {
        static Vibrator defaultVibrator(Context context) {
            Object service = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return service instanceof VibratorManager ? ((VibratorManager) service).getDefaultVibrator() : null;
        }
    }

    /** API 33+: vibration attributes. */
    private static final class Api33 {
        private static final VibrationAttributes MEDIA = VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA);

        static void vibrate(Vibrator v, VibrationEffect effect) {
            v.vibrate(effect, MEDIA);
        }
    }
}
