package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.HapticFeedbackConstants;
import android.view.View;

/**
 * Short haptics for UI events. Simple ones go through View.performHapticFeedback, which uses the
 * phone's own tuned effects and respects the system "touch feedback" setting. Richer ones (a
 * finished set, a celebration) use vibration primitives where the hardware has them, falling back
 * to predefined clicks. Anything unsupported quietly does nothing.
 */
final class Haptics {
    private Haptics() {
    }

    /** Must run on the UI thread. {@code view} is the WebView (or the root layout). */
    static void play(Context context, View view, String kind) {
        if (kind == null || view == null) {
            return;
        }
        try {
            switch (kind) {
                case "tap":
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                    break;
                case "select":
                    view.performHapticFeedback(Build.VERSION.SDK_INT >= 34
                            ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK);
                    break;
                case "tick":
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                    break;
                case "toggleOn":
                    view.performHapticFeedback(Build.VERSION.SDK_INT >= 34
                            ? HapticFeedbackConstants.TOGGLE_ON : HapticFeedbackConstants.CONTEXT_CLICK);
                    break;
                case "toggleOff":
                    view.performHapticFeedback(Build.VERSION.SDK_INT >= 34
                            ? HapticFeedbackConstants.TOGGLE_OFF : HapticFeedbackConstants.CLOCK_TICK);
                    break;
                case "success":
                    if (Build.VERSION.SDK_INT >= 30) {
                        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM);
                    } else {
                        predefined(context, VibrationEffect.EFFECT_DOUBLE_CLICK, 40);
                    }
                    break;
                case "error":
                    if (Build.VERSION.SDK_INT >= 30) {
                        view.performHapticFeedback(HapticFeedbackConstants.REJECT);
                    } else {
                        predefined(context, VibrationEffect.EFFECT_HEAVY_CLICK, 60);
                    }
                    break;
                case "heavy":
                    predefined(context, VibrationEffect.EFFECT_HEAVY_CLICK, 35);
                    break;
                case "go":
                    if (!compose(context, new int[]{PRIMITIVE_QUICK_RISE, PRIMITIVE_CLICK},
                            new float[]{0.6f, 1f}, new int[]{0, 40})) {
                        predefined(context, VibrationEffect.EFFECT_HEAVY_CLICK, 45);
                    }
                    break;
                case "done":
                    if (!compose(context, new int[]{PRIMITIVE_THUD, PRIMITIVE_CLICK},
                            new float[]{0.9f, 0.7f}, new int[]{0, 90})) {
                        predefined(context, VibrationEffect.EFFECT_DOUBLE_CLICK, 60);
                    }
                    break;
                case "celebrate":
                    if (!compose(context, new int[]{PRIMITIVE_QUICK_RISE, PRIMITIVE_CLICK, PRIMITIVE_CLICK, PRIMITIVE_TICK},
                            new float[]{0.5f, 1f, 0.8f, 0.6f}, new int[]{0, 60, 90, 90})) {
                        waveform(context, new long[]{0, 30, 70, 30, 70, 60});
                    }
                    break;
                default:
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            }
        } catch (Throwable ignored) {
            // Haptics are a nicety.
        }
    }

    // VibrationEffect.Composition primitives (API 30+); the values are fixed by the platform.
    private static final int PRIMITIVE_CLICK = 1;
    private static final int PRIMITIVE_THUD = 2;
    private static final int PRIMITIVE_QUICK_RISE = 4;
    private static final int PRIMITIVE_TICK = 7;

    @SuppressWarnings("deprecation")
    private static Vibrator vibrator(Context context) {
        Object service = context.getSystemService(Context.VIBRATOR_SERVICE);
        Vibrator v = service instanceof Vibrator ? (Vibrator) service : null;
        return v != null && v.hasVibrator() ? v : null;
    }

    private static void predefined(Context context, int effect, long fallbackMs) {
        Vibrator v = vibrator(context);
        if (v == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            vibrate(v, VibrationEffect.createPredefined(effect));
        } else {
            vibrate(v, VibrationEffect.createOneShot(fallbackMs, VibrationEffect.DEFAULT_AMPLITUDE));
        }
    }

    private static void waveform(Context context, long[] timings) {
        Vibrator v = vibrator(context);
        if (v != null) {
            vibrate(v, VibrationEffect.createWaveform(timings, -1));
        }
    }

    /** Plays a composition if every primitive is supported; returns false otherwise. */
    private static boolean compose(Context context, int[] primitives, float[] scales, int[] delays) {
        if (Build.VERSION.SDK_INT < 30) {
            return false;
        }
        Vibrator v = vibrator(context);
        if (v == null || !v.areAllPrimitivesSupported(primitives)) {
            return false;
        }
        VibrationEffect.Composition c = VibrationEffect.startComposition();
        for (int i = 0; i < primitives.length; i++) {
            c.addPrimitive(primitives[i], scales[i], delays[i]);
        }
        vibrate(v, c.compose());
        return true;
    }

    /** On Android 13+ tag it as touch feedback, so the system touch-feedback setting applies. */
    private static void vibrate(Vibrator v, VibrationEffect effect) {
        if (Build.VERSION.SDK_INT >= 33) {
            v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH));
        } else {
            v.vibrate(effect);
        }
    }
}
