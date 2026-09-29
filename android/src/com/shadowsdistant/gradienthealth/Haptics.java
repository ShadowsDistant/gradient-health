package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;

/**
 * Short haptics for UI and workout events, at a strength the person picks (light, medium, strong).
 *
 * View.performHapticFeedback alone was too faint on many phones (ticks and "virtual key" clicks are
 * tuned very soft, or switched off, on several brands), so this drives the vibrator directly:
 * vibration primitives scaled by the chosen strength where the hardware has them (API 30+), the
 * phone's predefined click effects on API 29, and short amplitude-controlled pulses before that.
 * Everything is tagged as touch feedback on Android 13+, so the phone's own touch intensity setting
 * still applies, and UI taps are skipped when touch feedback is switched off in system settings.
 * Anything unsupported quietly does nothing.
 */
final class Haptics {
    private Haptics() {
    }

    /** 0 = light, 1 = medium (default), 2 = strong. */
    private static volatile int level = 1;

    static void setLevel(String name) {
        level = "light".equals(name) ? 0 : "strong".equals(name) ? 2 : 1;
    }

    // Overall scale for each level: noticeable at medium, never harsh at strong.
    private static final float[] SCALE = {0.5f, 0.78f, 1f};
    // Fallback pulse amplitudes (1-255) and lengths for phones without primitives.
    private static final int[] AMP = {90, 160, 230};
    private static final int[] MS = {12, 16, 22};

    // VibrationEffect.Composition primitives (API 30+); the values are fixed by the platform.
    private static final int PRIMITIVE_CLICK = 1;
    private static final int PRIMITIVE_THUD = 2;
    private static final int PRIMITIVE_QUICK_RISE = 4;
    private static final int PRIMITIVE_TICK = 7;
    private static final int PRIMITIVE_LOW_TICK = 8;

    /** True unless the phone's "touch feedback" setting is off. */
    static boolean systemTouchFeedback(Context context) {
        try {
            return Settings.System.getInt(context.getContentResolver(), Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0;
        } catch (Throwable t) {
            return true;
        }
    }

    /** Must run on the UI thread. {@code view} is the WebView (or the root layout). */
    static void play(Context context, View view, String kind) {
        if (kind == null || view == null) {
            return;
        }
        try {
            boolean ui = "tap".equals(kind) || "select".equals(kind) || "tick".equals(kind)
                    || "toggleOn".equals(kind) || "toggleOff".equals(kind);
            if (ui && !systemTouchFeedback(context)) {
                return;
            }
            Vibrator v = vibrator(context);
            if (v == null) {
                // No vibrator service we can drive: let the view try its own feedback.
                if (ui) {
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                }
                return;
            }
            float s = SCALE[level];
            switch (kind) {
                case "tap":
                    one(v, PRIMITIVE_CLICK, 0.7f * s, VibrationEffect.EFFECT_CLICK, 1f);
                    break;
                case "select":
                    one(v, PRIMITIVE_CLICK, 0.5f * s, VibrationEffect.EFFECT_TICK, 0.8f);
                    break;
                case "tick":
                    one(v, level == 0 ? PRIMITIVE_LOW_TICK : PRIMITIVE_TICK, 0.75f * s, VibrationEffect.EFFECT_TICK, 0.6f);
                    break;
                case "toggleOn":
                    one(v, PRIMITIVE_CLICK, 0.85f * s, VibrationEffect.EFFECT_CLICK, 1f);
                    break;
                case "toggleOff":
                    one(v, PRIMITIVE_CLICK, 0.55f * s, VibrationEffect.EFFECT_TICK, 0.8f);
                    break;
                case "success":
                    if (!compose(v, new int[]{PRIMITIVE_CLICK, PRIMITIVE_CLICK}, new float[]{0.6f * s, s}, new int[]{0, 70})) {
                        predefined(v, VibrationEffect.EFFECT_DOUBLE_CLICK, new long[]{0, MS[level], 60, MS[level]});
                    }
                    break;
                case "error":
                    if (!compose(v, new int[]{PRIMITIVE_THUD, PRIMITIVE_CLICK}, new float[]{s, 0.6f * s}, new int[]{0, 60})) {
                        predefined(v, VibrationEffect.EFFECT_HEAVY_CLICK, new long[]{0, MS[level] + 10, 50, MS[level]});
                    }
                    break;
                case "heavy":
                    if (!compose(v, new int[]{PRIMITIVE_THUD}, new float[]{s}, new int[]{0})) {
                        predefined(v, VibrationEffect.EFFECT_HEAVY_CLICK, new long[]{0, MS[level] + 8});
                    }
                    break;
                case "go":
                    if (!compose(v, new int[]{PRIMITIVE_QUICK_RISE, PRIMITIVE_CLICK}, new float[]{0.6f * s, s}, new int[]{0, 40})) {
                        predefined(v, VibrationEffect.EFFECT_HEAVY_CLICK, new long[]{0, 30, 50, MS[level]});
                    }
                    break;
                case "done":
                    if (!compose(v, new int[]{PRIMITIVE_THUD, PRIMITIVE_CLICK}, new float[]{s, 0.8f * s}, new int[]{0, 90})) {
                        predefined(v, VibrationEffect.EFFECT_DOUBLE_CLICK, new long[]{0, 30, 80, MS[level]});
                    }
                    break;
                case "celebrate":
                    if (!compose(v, new int[]{PRIMITIVE_QUICK_RISE, PRIMITIVE_CLICK, PRIMITIVE_CLICK, PRIMITIVE_TICK},
                            new float[]{0.5f * s, s, 0.85f * s, 0.7f * s}, new int[]{0, 60, 90, 90})) {
                        waveform(v, new long[]{0, 30, 70, 30, 70, 60});
                    }
                    break;
                default:
                    one(v, PRIMITIVE_CLICK, 0.7f * s, VibrationEffect.EFFECT_CLICK, 1f);
            }
        } catch (Throwable ignored) {
            // Haptics are a nicety.
        }
    }

    @SuppressWarnings("deprecation")
    private static Vibrator vibrator(Context context) {
        Object service = context.getSystemService(Context.VIBRATOR_SERVICE);
        Vibrator v = service instanceof Vibrator ? (Vibrator) service : null;
        return v != null && v.hasVibrator() ? v : null;
    }

    /**
     * One short click: a scaled primitive where supported, else the predefined effect (API 29), else
     * a short pulse whose strength follows the level ({@code weight} softens ticks).
     */
    private static void one(Vibrator v, int primitive, float scale, int effect, float weight) {
        if (compose(v, new int[]{primitive}, new float[]{Math.min(1f, scale)}, new int[]{0})) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            // The predefined effects have no strength, so pick a firmer one for the stronger levels.
            int e = level == 2 && effect == VibrationEffect.EFFECT_TICK ? VibrationEffect.EFFECT_CLICK
                    : level == 2 && effect == VibrationEffect.EFFECT_CLICK ? VibrationEffect.EFFECT_HEAVY_CLICK
                    : level == 0 && effect == VibrationEffect.EFFECT_CLICK ? VibrationEffect.EFFECT_TICK : effect;
            vibrate(v, VibrationEffect.createPredefined(e));
            return;
        }
        pulse(v, Math.round(MS[level] * weight), Math.round(AMP[level] * weight));
    }

    private static void pulse(Vibrator v, long ms, int amplitude) {
        int a = v.hasAmplitudeControl() ? Math.max(1, Math.min(255, amplitude)) : VibrationEffect.DEFAULT_AMPLITUDE;
        vibrate(v, VibrationEffect.createOneShot(Math.max(8, ms), a));
    }

    private static void predefined(Vibrator v, int effect, long[] fallback) {
        if (Build.VERSION.SDK_INT >= 29) {
            vibrate(v, VibrationEffect.createPredefined(effect));
        } else {
            waveform(v, fallback);
        }
    }

    private static void waveform(Vibrator v, long[] timings) {
        vibrate(v, VibrationEffect.createWaveform(timings, -1));
    }

    /** Plays a composition if every primitive is supported; returns false otherwise. */
    private static boolean compose(Vibrator v, int[] primitives, float[] scales, int[] delays) {
        if (Build.VERSION.SDK_INT < 30 || !v.areAllPrimitivesSupported(primitives)) {
            return false;
        }
        VibrationEffect.Composition c = VibrationEffect.startComposition();
        for (int i = 0; i < primitives.length; i++) {
            c.addPrimitive(primitives[i], Math.max(0f, Math.min(1f, scales[i])), delays[i]);
        }
        vibrate(v, c.compose());
        return true;
    }

    /** On Android 13+ tag it as touch feedback, so the system touch-feedback intensity applies. */
    private static void vibrate(Vibrator v, VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH));
        } else {
            v.vibrate(effect);
        }
    }
}
