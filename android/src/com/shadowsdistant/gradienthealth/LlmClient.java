package com.shadowsdistant.gradienthealth;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.lang.ref.WeakReference;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * The app's side of {@link LlmService}: binds it on first use, passes the page's requests on, and
 * sends what comes back to the page through window.__gh.onLlm(event). Answer pieces are gathered
 * for 50 ms at a time, so the page redraws a few times a second, not once per word. If the
 * service's process dies, the page is told ("died") and switches to its in-app engine.
 *
 * Events: {type:"loadProgress", progress}, {type:"loaded", ctx, ms, threads, info},
 * {type:"loadFailed", error}, {type:"progress", req, done, total}, {type:"text", req, text},
 * {type:"done", req, code, error?, stats:{promptTokens, reusedTokens, tokens, promptMs, genMs,
 * aborted, finish}}, {type:"died"}.
 */
final class LlmClient implements ServiceConnection {
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final long FLUSH_MS = 50;

    private final Context app;
    private final WeakReference<MainActivity> page;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Message> queue = new ArrayList<Message>();
    private Messenger service;
    private boolean binding;
    private final StringBuilder pending = new StringBuilder();
    private String pendingReq;
    private boolean flushPosted;

    private final Messenger replies = new Messenger(new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(Message m) {
            onEvent(m);
        }
    });

    LlmClient(MainActivity activity) {
        this.app = activity.getApplicationContext();
        this.page = new WeakReference<MainActivity>(activity);
    }

    /** {"ok":true,"threads":4} when the native engine can run here, else {"ok":false}. */
    String availableJson() {
        try {
            boolean ok = LlmNative.packaged(app);
            JSONObject o = new JSONObject().put("ok", ok);
            if (ok) {
                o.put("threads", LlmNative.threads()).put("cores", Runtime.getRuntime().availableProcessors());
            }
            return o.toString();
        } catch (JSONException e) {
            return "{\"ok\":false}";
        }
    }

    void load(File model, int ctx, int batch) {
        Bundle b = new Bundle();
        b.putString("path", model.getAbsolutePath());
        b.putInt("ctx", ctx);
        b.putInt("batch", batch);
        b.putInt("threads", LlmNative.threads());
        send(LlmService.LOAD, b);
    }

    /** {"req","prompt","temperature","top_p","min_p","top_k","repeat_penalty","max_tokens","seed","grammar"?} */
    void generate(JSONObject o) {
        Bundle b = new Bundle();
        b.putString("req", o.optString("req", ""));
        b.putByteArray("prompt", o.optString("prompt", "").getBytes(UTF8));
        b.putFloat("temperature", (float) o.optDouble("temperature", 0.7));
        b.putFloat("top_p", (float) o.optDouble("top_p", 0.8));
        b.putFloat("min_p", (float) o.optDouble("min_p", 0));
        b.putInt("top_k", o.optInt("top_k", 20));
        b.putFloat("repeat_penalty", (float) o.optDouble("repeat_penalty", 1.05));
        b.putInt("max_tokens", o.optInt("max_tokens", 320));
        b.putInt("seed", o.optInt("seed", 0));
        String grammar = o.optString("grammar", "");
        if (!grammar.isEmpty()) {
            b.putByteArray("grammar", grammar.getBytes(UTF8));
        }
        send(LlmService.GENERATE, b);
    }

    void abort(String req) {
        Bundle b = new Bundle();
        b.putString("req", req);
        send(LlmService.ABORT, b);
    }

    void unload() {
        if (service != null) {
            send(LlmService.UNLOAD, new Bundle());
        }
    }

    /** The app is going away: let the service (and its memory) go too. */
    void release() {
        main.post(new Runnable() {
            @Override
            public void run() {
                queue.clear();
                if (service != null || binding) {
                    try {
                        app.unbindService(LlmClient.this);
                    } catch (Throwable ignored) {
                    }
                }
                service = null;
                binding = false;
            }
        });
    }

    private void send(final int what, final Bundle data) {
        main.post(new Runnable() {
            @Override
            public void run() {
                Message m = Message.obtain(null, what);
                m.setData(data);
                m.replyTo = replies;
                if (service == null) {
                    queue.add(m);
                    bind();
                    return;
                }
                try {
                    service.send(m);
                } catch (RemoteException e) {
                    died();
                }
            }
        });
    }

    private void bind() {
        if (binding) {
            return;
        }
        binding = true;
        try {
            boolean ok = app.bindService(new Intent(app, LlmService.class), this, Context.BIND_AUTO_CREATE);
            if (!ok) {
                died();
            }
        } catch (Throwable t) {
            died();
        }
    }

    @Override
    public void onServiceConnected(ComponentName name, IBinder binder) {
        service = new Messenger(binder);
        List<Message> waiting = new ArrayList<Message>(queue);
        queue.clear();
        for (Message m : waiting) {
            try {
                service.send(m);
            } catch (RemoteException e) {
                died();
                return;
            }
        }
    }

    @Override
    public void onServiceDisconnected(ComponentName name) {
        died();
    }

    @Override
    public void onBindingDied(ComponentName name) {
        died();
    }

    private void died() {
        boolean wasUp = service != null || binding;
        service = null;
        queue.clear();
        pending.setLength(0);
        pendingReq = null;
        if (binding) {
            try {
                app.unbindService(this);
            } catch (Throwable ignored) {
            }
        }
        binding = false;
        if (wasUp) {
            try {
                emit(event("died"));
            } catch (JSONException ignored) {
            }
        }
    }

    private void onEvent(Message m) {
        Bundle b = m.getData();
        try {
            switch (m.what) {
                case LlmService.EV_LOAD_PROGRESS:
                    emit(event("loadProgress").put("progress", b.getFloat("progress")));
                    break;
                case LlmService.EV_LOADED:
                    emit(event("loaded").put("ctx", b.getInt("ctx")).put("ms", b.getLong("ms"))
                            .put("threads", b.getInt("threads", LlmNative.threads())).put("info", b.getString("info", "")));
                    break;
                case LlmService.EV_LOAD_FAILED:
                    emit(event("loadFailed").put("error", b.getString("error", "")));
                    break;
                case LlmService.EV_PROGRESS:
                    flush();
                    emit(event("progress").put("req", b.getString("req", "")).put("done", b.getInt("done")).put("total", b.getInt("total")));
                    break;
                case LlmService.EV_PIECE: {
                    String req = b.getString("req", "");
                    if (pendingReq != null && !pendingReq.equals(req)) {
                        flush();
                    }
                    pendingReq = req;
                    byte[] bytes = b.getByteArray("bytes");
                    if (bytes != null) {
                        pending.append(new String(bytes, UTF8));
                    }
                    if (!flushPosted) {
                        flushPosted = true;
                        main.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                flushPosted = false;
                                flush();
                            }
                        }, FLUSH_MS);
                    }
                    break;
                }
                case LlmService.EV_DONE: {
                    flush();
                    JSONObject e = event("done").put("req", b.getString("req", "")).put("code", b.getInt("code"));
                    if (b.getString("error") != null) {
                        e.put("error", b.getString("error"));
                    }
                    double[] s = b.getDoubleArray("stats");
                    if (s != null && s.length >= 7) {
                        e.put("stats", new JSONObject().put("promptTokens", s[0]).put("reusedTokens", s[1]).put("tokens", s[2])
                                .put("promptMs", s[3]).put("genMs", s[4]).put("aborted", s[5] > 0).put("finish", (int) s[6]));
                    }
                    emit(e);
                    break;
                }
                default:
                    break;
            }
        } catch (JSONException ignored) {
        }
    }

    private void flush() {
        if (pending.length() == 0 || pendingReq == null) {
            return;
        }
        try {
            emit(event("text").put("req", pendingReq).put("text", pending.toString()));
        } catch (JSONException ignored) {
        }
        pending.setLength(0);
    }

    private static JSONObject event(String type) throws JSONException {
        return new JSONObject().put("type", type);
    }

    private void emit(JSONObject e) {
        MainActivity a = page.get();
        if (a != null) {
            a.callJs(MainActivity.jsCall("onLlm", e.toString()));
        }
    }

}
