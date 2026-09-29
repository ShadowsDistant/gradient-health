package com.shadowsdistant.gradienthealth;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.os.SystemClock;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Runs the native engine ({@link LlmNative}) in its own process (":llm" in the manifest), so a
 * crash or an out-of-memory kill there can't take the app with it: the app sees the service
 * disconnect and falls back to its in-app engine. One model at a time; requests run one after
 * another on a worker thread, except "stop", which goes straight to the answer in progress.
 * The app talks to it through {@link LlmClient}.
 */
public final class LlmService extends Service {
    // Requests (what)
    static final int LOAD = 1;
    static final int GENERATE = 2;
    static final int ABORT = 3;
    static final int UNLOAD = 4;
    // Events back (what)
    static final int EV_LOAD_PROGRESS = 101;
    static final int EV_LOADED = 102;
    static final int EV_LOAD_FAILED = 103;
    static final int EV_PROGRESS = 104;
    static final int EV_PIECE = 105;
    static final int EV_DONE = 106;

    private HandlerThread worker;
    private Handler work;
    private Messenger messenger;
    private volatile long handle;
    private volatile String loadedPath;
    private volatile String running; // the request whose answer is being written
    // Stopped before they started (still queued behind another request).
    private final Set<String> cancelled = Collections.synchronizedSet(new HashSet<String>());

    @Override
    public void onCreate() {
        super.onCreate();
        worker = new HandlerThread("llm");
        worker.start();
        work = new Handler(worker.getLooper());
        messenger = new Messenger(new Handler(Looper.getMainLooper()) {
            @Override
            public void handleMessage(Message m) {
                if (m.what == ABORT) {
                    String req = m.getData().getString("req");
                    long h = handle;
                    if (req != null && !req.equals(running)) {
                        cancelled.add(req);
                    } else if (h != 0) {
                        LlmNative.abort(h);
                    }
                    return;
                }
                final Message copy = Message.obtain(m);
                work.post(new Runnable() {
                    @Override
                    public void run() {
                        handle(copy);
                        copy.recycle();
                    }
                });
            }
        });
    }

    @Override
    public IBinder onBind(Intent intent) {
        return messenger.getBinder();
    }

    @Override
    public void onDestroy() {
        long h = handle;
        if (h != 0) {
            LlmNative.abort(h);
        }
        work.post(new Runnable() {
            @Override
            public void run() {
                unload();
            }
        });
        worker.quitSafely();
        super.onDestroy();
    }

    private void handle(Message m) {
        Bundle b = m.getData();
        Messenger reply = m.replyTo;
        switch (m.what) {
            case LOAD:
                load(reply, b);
                break;
            case GENERATE:
                generate(reply, b);
                break;
            case UNLOAD:
                unload();
                break;
            default:
                break;
        }
    }

    private void load(final Messenger reply, Bundle b) {
        String path = b.getString("path");
        int nCtx = b.getInt("ctx", 2048);
        int nBatch = b.getInt("batch", 256);
        int threads = b.getInt("threads", LlmNative.threads());
        if (path == null) {
            send(reply, EV_LOAD_FAILED, text("error", "The model file is missing."));
            return;
        }
        if (handle != 0 && path.equals(loadedPath)) {
            send(reply, EV_LOADED, loaded(handle, 0));
            return;
        }
        unload();
        if (!LlmNative.start(this)) {
            send(reply, EV_LOAD_FAILED, text("error", "The native engine couldn't start on this phone."));
            return;
        }
        final long t0 = SystemClock.elapsedRealtime();
        final long[] lastSent = {0};
        try {
            long h = LlmNative.load(path, nCtx, nBatch, threads, new LlmNative.Listener() {
                @Override
                public boolean onLoad(float progress) {
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastSent[0] >= 100 || progress >= 1f) {
                        lastSent[0] = now;
                        Bundle p = new Bundle();
                        p.putFloat("progress", progress);
                        send(reply, EV_LOAD_PROGRESS, p);
                    }
                    return true;
                }

                @Override
                public boolean onPiece(byte[] utf8) {
                    return false;
                }

                @Override
                public void onProgress(int done, int total) {
                }
            });
            handle = h;
            loadedPath = path;
            Bundle out = loaded(h, SystemClock.elapsedRealtime() - t0);
            out.putInt("threads", threads);
            send(reply, EV_LOADED, out);
        } catch (Throwable t) {
            handle = 0;
            loadedPath = null;
            String why = t.getMessage();
            send(reply, EV_LOAD_FAILED, text("error", why == null || why.isEmpty() ? "The model couldn't be loaded." : why));
        }
    }

    private static Bundle loaded(long h, long ms) {
        Bundle out = new Bundle();
        out.putInt("ctx", LlmNative.nCtx(h));
        out.putLong("ms", ms);
        out.putString("info", LlmNative.systemInfo());
        return out;
    }

    private void generate(final Messenger reply, Bundle b) {
        final String req = b.getString("req", "");
        long h = handle;
        if (cancelled.remove(req)) {
            Bundle out = text("req", req);
            out.putInt("code", 0);
            double[] stats = new double[7];
            stats[5] = 1; // aborted
            stats[6] = 2; // stopped
            out.putDoubleArray("stats", stats);
            send(reply, EV_DONE, out);
            return;
        }
        if (h == 0) {
            Bundle out = text("req", req);
            out.putInt("code", -1);
            out.putString("error", "not-loaded");
            send(reply, EV_DONE, out);
            return;
        }
        running = req;
        final long[] lastProgress = {0};
        double[] stats = new double[7];
        int code;
        try {
            code = LlmNative.generate(h, b.getByteArray("prompt"), b.getFloat("temperature", 0.7f),
                    b.getFloat("top_p", 0.8f), b.getFloat("min_p", 0f), b.getInt("top_k", 20),
                    b.getFloat("repeat_penalty", 1.05f), b.getInt("max_tokens", 320), b.getInt("seed", 0),
                    b.getByteArray("grammar"), new LlmNative.Listener() {
                        @Override
                        public boolean onLoad(float progress) {
                            return true;
                        }

                        @Override
                        public boolean onPiece(byte[] utf8) {
                            Bundle p = text("req", req);
                            p.putByteArray("bytes", utf8);
                            return !send(reply, EV_PIECE, p);
                        }

                        @Override
                        public void onProgress(int done, int total) {
                            long now = SystemClock.elapsedRealtime();
                            if (now - lastProgress[0] >= 100 || done >= total) {
                                lastProgress[0] = now;
                                Bundle p = text("req", req);
                                p.putInt("done", done);
                                p.putInt("total", total);
                                send(reply, EV_PROGRESS, p);
                            }
                        }
                    }, stats);
        } catch (Throwable t) {
            code = -2;
        } finally {
            running = null;
        }
        Bundle out = text("req", req);
        out.putInt("code", code);
        out.putDoubleArray("stats", stats);
        send(reply, EV_DONE, out);
    }

    private void unload() {
        long h = handle;
        handle = 0;
        loadedPath = null;
        if (h != 0) {
            LlmNative.free(h);
        }
    }

    private static Bundle text(String key, String value) {
        Bundle b = new Bundle();
        b.putString(key, value);
        return b;
    }

    /** False when the app is gone (then the answer in progress stops). */
    private static boolean send(Messenger to, int what, Bundle data) {
        if (to == null) {
            return false;
        }
        Message m = Message.obtain(null, what);
        m.setData(data);
        try {
            to.send(m);
            return true;
        } catch (RemoteException e) {
            return false;
        }
    }
}
