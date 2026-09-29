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
 * UI kinds are quick and light: tap, select, tick (slider steps), toggleOn, toggleOff and detent (a
 * sheet snapping to a height). Event kinds are firmer: countdown (the 3-2-1 before a timer ends), go,
 * done (a hold or rest is over), success, warning, error, heavy (destructive confirmations) and
 * celebrate. platform.js keeps browser patterns with the same names and rhythms.
 *
 * View.performHapticFeedback alone was too faint on many phones, so this drives the vibrator itself,
 * the best way the phone has:
 *  1. Composition primitives (API 30+), checked one at a time. A missing one gets a stand-in (a click
 *     for a thud, rise, fall or spin, a tick for a low tick) and the gap after it grows by about the
 *     time the original would have taken, so the rhythm stays recognisable.
 *  2. A waveform with amplitudes, on phones with amplitude control but no primitives.
 *  3. Plain on/off pulses, where a longer pulse is the only way to be stronger.
 * Light, medium and strong scale primitives and amplitudes by 0.55, 0.8 and 1 (strong reaches 255).
 *
 * Events play as media vibrations, so a low touch-feedback intensity in the phone's settings can't
 * mute them. UI kinds are touch feedback at light and medium (the phone's intensity applies) and media
 * at strong, and they're skipped when touch feedback is switched off in the phone's settings.
 */
final class Haptics {
    private Haptics() {
    }

    /** 0 = light, 1 = medium (default), 2 = strong. */
    private static volatile int level = 1;

    static void setLevel(String name) {
        level = "light".equals(name) ? 0 : "strong".equals(name) ? 2 : 1;
    }

    private static final float[] SCALE = {0.55f, 0.8f, 1f};
    // On/off pulses only: their length stands in for strength.
    private static final float[] LENGTH = {0.9f, 1.25f, 1.7f};

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

    /** One kind: its composition and its waveform for phones without primitives. */
    private static final class Kind {
        final boolean event;
        final int[] prims;
        final float[] scales;
        final int[] gaps; // ms of quiet before each primitive
        final long[] ms; // waveform segments...
        final float[] amps; // ...and their strength, 0-1 (0 is a pause)

        Kind(boolean event, float[] comp, float[] wave) {
            this.event = event;
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

    /** {@code comp}: primitive, scale, gap (ms) triples. {@code wave}: length (ms), strength pairs. */
    private static void put(String name, boolean event, float[] comp, float[] wave) {
        KINDS.put(name, new Kind(event, comp, wave));
    }

    private static float[] c(float... v) {
        return v;
    }

    private static float[] w(float... v) {
        return v;
    }

    static {
        final boolean ui = false;
        final boolean event = true;
        // UI kinds: one short beat, or two very close together.
        put("tap", ui, c(CLICK, 0.9f, 0), w(16, 0.95f));
        put("select", ui, c(TICK, 1f, 0), w(10, 0.7f));
        put("tick", ui, c(LOW_TICK, 1f, 0), w(8, 0.55f));
        put("toggleOn", ui, c(QUICK_RISE, 0.35f, 0, CLICK, 0.9f, 0), w(10, 0.35f, 8, 0.6f, 16, 1f));
        put("toggleOff", ui, c(CLICK, 0.65f, 0, QUICK_FALL, 0.4f, 0), w(16, 0.8f, 10, 0.4f));
        put("detent", ui, c(CLICK, 1f, 0, LOW_TICK, 0.6f, 20), w(18, 1f, 24, 0, 8, 0.5f));
        // Events: fuller, and each with its own rhythm.
        put("countdown", event, c(CLICK, 1f, 0, LOW_TICK, 0.8f, 0), w(20, 1f, 8, 0.5f));
        put("go", event, c(QUICK_RISE, 0.8f, 0, CLICK, 1f, 0), w(14, 0.3f, 14, 0.55f, 14, 0.8f, 24, 1f));
        put("done", event, c(CLICK, 1f, 0, CLICK, 1f, 100, THUD, 1f, 100),
                w(20, 1f, 90, 0, 20, 1f, 90, 0, 44, 0.95f, 16, 0.4f));
        put("success", event, c(CLICK, 0.6f, 0, CLICK, 1f, 70), w(14, 0.6f, 70, 0, 22, 1f));
        put("warning", event, c(THUD, 0.85f, 0), w(40, 0.9f, 20, 0.45f));
        put("error", event, c(THUD, 1f, 0, THUD, 0.8f, 50), w(36, 1f, 12, 0.4f, 60, 0, 36, 0.85f, 12, 0.35f));
        put("heavy", event, c(CLICK, 1f, 0, THUD, 1f, 0), w(14, 1f, 50, 0.9f, 20, 0.4f));
        put("celebrate", event, c(QUICK_RISE, 0.6f, 0, CLICK, 1f, 0, CLICK, 0.7f, 70, CLICK, 1f, 70, SPIN, 0.8f, 40),
                w(12, 0.3f, 12, 0.55f, 12, 0.8f, 20, 1f, 70, 0, 18, 0.7f, 70, 0, 20, 1f, 40, 0,
                        14, 0.4f, 14, 0.7f, 14, 1f, 14, 0.7f, 14, 0.4f));
    }

    private static final AudioAttributes MEDIA = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    private static volatile Vibrator vibrator;

    /**
     * True unless the phone's "touch feedback" setting is off. Android 13 deprecated reading it in
     * favour of tagging vibrations as touch, but UI kinds play as media at strong, so the app checks.
     */
    @SuppressWarnings("deprecation")
    static boolean systemTouchFeedback(Context context) {
        try {
            return Settings.System.getInt(context.getContentResolver(), Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0;
        } catch (Throwable t) {
            return true;
        }
    }

    /**
     * Plays a kind by name (an unknown name plays a tap). Runs on the UI thread; {@code view} (the
     * WebView or the root layout) is only for phones without a vibrator the app can drive.
     */
    static void play(Context context, View view, String name) {
        Kind k = name == null ? null : KINDS.get(name);
        if (k == null) {
            k = KINDS.get("tap");
        }
        try {
            if (!k.event && !systemTouchFeedback(context)) {
                return;
            }
            Vibrator v = vibrator(context);
            if (v == null) {
                if (!k.event && view != null) {
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                }
                return;
            }
            int lvl = level;
            VibrationEffect effect = Build.VERSION.SDK_INT >= 30 ? Api30.compose(v, k, SCALE[lvl]) : null;
            if (effect == null) {
                effect = waveform(v, k, lvl);
            }
            vibrate(v, effect, k.event || lvl == 2);
        } catch (Throwable ignored) {
            // Haptics are a nicety.
        }
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
            int[] amps = new int[k.amps.length];
            for (int i = 0; i < amps.length; i++) {
                amps[i] = k.amps[i] <= 0f ? 0 : Math.max(1, Math.min(255, Math.round(k.amps[i] * SCALE[lvl] * 255f)));
            }
            return VibrationEffect.createWaveform(k.ms, amps, -1);
        }
        // Without amplitudes the soft parts would play at full strength, so they become pauses; the
        // rest merges into pulses: on, off, on, ... lengths.
        long[] runs = new long[k.ms.length];
        int n = 0;
        boolean on = false;
        for (int i = 0; i < k.ms.length; i++) {
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
        if (!on) {
            n--; // no pause after the last pulse
        }
        if (n <= 1) {
            return VibrationEffect.createOneShot(pulse(n == 1 ? runs[0] : 16, lvl), VibrationEffect.DEFAULT_AMPLITUDE);
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

    /**
     * Media or touch feedback: AudioAttributes carry the usage before Android 13. Touch feedback there
     * goes without attributes, as short untagged vibrations count as touch.
     */
    @SuppressWarnings("deprecation") // vibrate(effect, AudioAttributes) is the pre-13 way to set a usage
    private static void vibrate(Vibrator v, VibrationEffect effect, boolean media) {
        if (Build.VERSION.SDK_INT >= 33) {
            Api33.vibrate(v, effect, media);
        } else if (media) {
            v.vibrate(effect, MEDIA);
        } else {
            v.vibrate(effect);
        }
    }

    /** API 30+ calls, isolated so older phones never load the composition classes. */
    private static final class Api30 {
        private static volatile boolean[] supported; // by primitive; the hardware doesn't change

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

        /** The kind as a composition at {@code strength}, or null when the phone can't play it. */
        static VibrationEffect compose(Vibrator v, Kind k, float strength) {
            try {
                VibrationEffect.Composition c = VibrationEffect.startComposition();
                int owed = 0; // how much sooner the last stand-in ended than the primitive it replaced
                for (int i = 0; i < k.prims.length; i++) {
                    int p = k.prims[i];
                    float scale = k.scales[i] * strength;
                    int gap = k.gaps[i] + owed;
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
        private static final VibrationAttributes TOUCH = VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH);
        private static final VibrationAttributes MEDIA = VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA);

        static void vibrate(Vibrator v, VibrationEffect effect, boolean media) {
            v.vibrate(effect, media ? MEDIA : TOUCH);
        }
    }
}
