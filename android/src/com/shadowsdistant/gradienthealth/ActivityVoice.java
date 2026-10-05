package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.Locale;

/**
 * Spoken splits while an activity records ("2 kilometres. Time, 10 minutes 24 seconds. Pace, 5
 * minutes 12 seconds per kilometre."), with Android's TextToSpeech: no permission needed. While it
 * speaks it holds transient audio focus that lets other audio duck, as navigation directions do, and
 * lets it go when it's done. The engine starts when the first split is due (or the voice is turned on)
 * and is shut down with the recording.
 *
 * Call {@link #say} and {@link #close} on the main thread; the engine answers there too.
 */
final class ActivityVoice implements TextToSpeech.OnInitListener {
    private final AudioAttributes speech = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    private final Context context;
    private TextToSpeech tts;
    private boolean ready;
    private boolean failed;
    private String pending; // said once the engine is ready
    private volatile AudioFocusRequest focus;
    private int seq;

    ActivityVoice(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Starts the engine ahead of the first split (it takes a moment to bind). */
    void open() {
        if (tts != null || failed) {
            return;
        }
        try {
            tts = new TextToSpeech(context, this);
        } catch (Throwable t) {
            tts = null;
            failed = true; // no engine on this phone: the splits stay silent
        }
    }

    @Override
    public void onInit(int status) {
        TextToSpeech t = tts;
        if (t == null) {
            return;
        }
        if (status != TextToSpeech.SUCCESS) {
            failed = true;
            close();
            return;
        }
        try {
            // The app's words are English: a phone set to another language keeps its own voice
            // for everything else.
            int lang = t.setLanguage(Locale.US);
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                t.setLanguage(Locale.ENGLISH);
            }
            t.setAudioAttributes(speech);
            t.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {
                }

                @Override
                public void onDone(String id) {
                    release();
                }

                @Override
                @SuppressWarnings("deprecation") // abstract, so it has to be here
                public void onError(String id) {
                    release();
                }

                @Override
                public void onError(String id, int code) {
                    release();
                }
            });
            ready = true;
        } catch (Throwable e) {
            failed = true;
            close();
            return;
        }
        String p = pending;
        pending = null;
        if (p != null) {
            say(p);
        }
    }

    /** Says it now (a split that was waiting for the engine is dropped for a newer one). */
    void say(String text) {
        if (failed || text == null) {
            return;
        }
        if (!ready) {
            pending = text;
            open();
            return;
        }
        try {
            take();
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f);
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "split-" + (++seq)) != TextToSpeech.SUCCESS) {
                release();
            }
        } catch (Throwable t) {
            release();
        }
    }

    void close() {
        TextToSpeech t = tts;
        tts = null;
        ready = false;
        pending = null;
        if (t != null) {
            try {
                t.stop();
                t.shutdown();
            } catch (Throwable ignored) {
            }
        }
        release();
    }

    /** Other audio ducks while the split is said. */
    private void take() {
        AudioManager am = context.getSystemService(AudioManager.class);
        if (am == null) {
            return;
        }
        AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(speech)
                .build();
        if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focus = req;
        }
    }

    private void release() {
        AudioFocusRequest req = focus;
        focus = null;
        if (req == null) {
            return;
        }
        try {
            AudioManager am = context.getSystemService(AudioManager.class);
            if (am != null) {
                am.abandonAudioFocusRequest(req);
            }
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- the words

    /**
     * "3 kilometres. Time, 15 minutes 40 seconds. Pace, 5 minutes 10 seconds per kilometre." (the
     * split just finished), or for a ride, "Speed, 21.5 kilometres per hour."
     */
    static String words(ActivityTrack.Split s) {
        boolean miles = "mi".equals(s.units);
        String unit = miles ? "mile" : "kilometre";
        StringBuilder b = new StringBuilder();
        b.append(s.n).append(' ').append(s.n == 1 ? unit : unit + "s").append(". Time, ").append(duration(s.clockMs)).append(". ");
        if ("cycle".equals(s.type) || "other".equals(s.type)) {
            double hours = s.splitMs / 3600000.0;
            if (hours > 0) {
                b.append("Speed, ").append(String.format(Locale.US, "%.1f", 1.0 / hours)).append(miles ? " miles per hour." : " kilometres per hour.");
            }
        } else if (s.splitMs > 0) {
            b.append("Pace, ").append(duration(s.splitMs)).append(" per ").append(unit).append('.');
        }
        return b.toString().trim();
    }

    /** "1 hour 2 minutes 3 seconds", "5 minutes", "40 seconds". */
    static String duration(long ms) {
        long s = Math.max(0L, Math.round(ms / 1000.0));
        long h = s / 3600L;
        long m = (s % 3600L) / 60L;
        long sec = s % 60L;
        StringBuilder b = new StringBuilder();
        if (h > 0) {
            b.append(h).append(h == 1 ? " hour" : " hours");
        }
        if (m > 0) {
            b.append(b.length() > 0 ? " " : "").append(m).append(m == 1 ? " minute" : " minutes");
        }
        if (sec > 0 || b.length() == 0) {
            b.append(b.length() > 0 ? " " : "").append(sec).append(sec == 1 ? " second" : " seconds");
        }
        return b.toString();
    }
}
