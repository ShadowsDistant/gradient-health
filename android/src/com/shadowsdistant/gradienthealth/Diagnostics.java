package com.shadowsdistant.gradienthealth;

import android.app.Activity;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Display;
import android.view.FrameMetrics;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.TracingConfig;
import android.webkit.TracingController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Scroll diagnostics, the Android side (src/ui/diag.js is the page's). The page can time its own
 * frames and its own thread, but not the rest of a scroll: Android's UI thread, which takes each
 * touch and drives a fling, and the drawing of the app's window. This keeps, for the page to ask:
 * <ul>
 * <li>Android's timing of each frame of the window (FrameMetrics, API 24+): how long it took, how
 * long it waited for the UI thread, and on API 31+ the GPU's time and the frame's deadline;</li>
 * <li>how late each touch reached the app's UI thread (its timestamp against the clock as it's
 * dispatched);</li>
 * <li>and on request a recording of Chromium's own trace events in the WebView
 * (android.webkit.TracingController, API 28+): each touch's way to the screen, each frame's steps,
 * each fling. It's written to the app's cache and read back by the page a piece at a time, which
 * sums it up (src/tracesum.js) and deletes it.</li>
 * </ul>
 * And it's the glass speed test's finger: a flick of the page made of Android's own touch events, so
 * the test can scroll the page the way a finger does ({@link #flick}).
 * All of it stays on the phone; the page puts the sums in the report the person may copy or share.
 * Nothing here is used outside the scroll diagnostics, and the frame and touch records cost a few
 * array writes each.
 */
final class Diagnostics {
    // About three minutes of frames at 120 Hz, and of touch events.
    private static final int FRAMES = 21600;
    private static final int TOUCHES = 8192;
    private static final String TRACE_FILE = "diag-trace.json";
    private static final int TRACE_CHUNK = 256 * 1024;
    // The trace's categories: input latency and frame reporting (cc, benchmark, input,
    // latencyInfo), the display compositor (viz), the WebView's own drawing (android_webview) and
    // every thread's tasks (toplevel). About 2 MB a second.
    private static final String[] TRACE_CATEGORIES = {
        "cc", "benchmark", "input", "latencyInfo", "viz", "android_webview", "toplevel",
    };

    private final Activity activity;

    // Frames: wall-clock ms of the intended vsync, then durations in µs (-1 where not available).
    private final long[] fWall = new long[FRAMES];
    private final int[] fTotal = new int[FRAMES];
    private final int[] fDeadline = new int[FRAMES];
    private final int[] fGpu = new int[FRAMES];
    private final int[] fWait = new int[FRAMES]; // waiting for the UI thread (UNKNOWN_DELAY)
    private final int[] fInput = new int[FRAMES];
    private final int[] fDraw = new int[FRAMES]; // animation + layout + draw on the UI thread
    private final int[] fSync = new int[FRAMES];
    private final int[] fCommand = new int[FRAMES]; // the RenderThread issuing the frame (the WebView draws here)
    private final int[] fSwap = new int[FRAMES];
    private int fNext;
    private int fCount;

    // Touches: wall-clock ms as dispatched, how late (ms) and the action.
    private final long[] tWall = new long[TOUCHES];
    private final int[] tLate = new int[TOUCHES];
    private final byte[] tAction = new byte[TOUCHES];
    private int tNext;
    private int tCount;

    private HandlerThread frameThread;
    private Object frameListener; // Window.OnFrameMetricsAvailableListener (API 24)

    private final Object traceLock = new Object();
    private InputStream traceIn;
    private byte[] traceCarry = new byte[0];
    private ExecutorService traceExecutor;

    Diagnostics(Activity activity) {
        this.activity = activity;
    }

    // ---------------------------------------------------------------- frames

    /** Starts keeping the window's frame timings (API 24+). Call once, on the UI thread. */
    void start(Window window) {
        if (Build.VERSION.SDK_INT < 24 || window == null || frameListener != null) {
            return;
        }
        try {
            frameThread = new HandlerThread("diag-frames");
            frameThread.start();
            Window.OnFrameMetricsAvailableListener l = new Window.OnFrameMetricsAvailableListener() {
                @Override
                public void onFrameMetricsAvailable(Window w, FrameMetrics m, int dropped) {
                    record(m);
                }
            };
            window.addOnFrameMetricsAvailableListener(l, new Handler(frameThread.getLooper()));
            frameListener = l;
        } catch (Throwable ignored) {
            // Not available here: the report says so.
        }
    }

    void stop(Window window) {
        try {
            if (Build.VERSION.SDK_INT >= 24 && window != null && frameListener != null) {
                window.removeOnFrameMetricsAvailableListener((Window.OnFrameMetricsAvailableListener) frameListener);
            }
        } catch (Throwable ignored) {
        }
        frameListener = null;
        if (frameThread != null) {
            frameThread.quitSafely();
            frameThread = null;
        }
    }

    private static int us(FrameMetrics m, int id) {
        long ns = m.getMetric(id);
        return ns < 0 ? -1 : (int) Math.min(Integer.MAX_VALUE, ns / 1000);
    }

    private void record(FrameMetrics m) {
        if (Build.VERSION.SDK_INT < 24) {
            return;
        }
        try {
            if (m.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1) {
                return;
            }
            long vsyncNs = Build.VERSION.SDK_INT >= 26 ? m.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP) : System.nanoTime();
            long wall = System.currentTimeMillis() - (System.nanoTime() - vsyncNs) / 1000000L;
            int gpu = Build.VERSION.SDK_INT >= 31 ? us(m, FrameMetrics.GPU_DURATION) : -1;
            int deadline = Build.VERSION.SDK_INT >= 31 ? us(m, FrameMetrics.DEADLINE) : -1;
            synchronized (this) {
                int i = fNext;
                fWall[i] = wall;
                fTotal[i] = us(m, FrameMetrics.TOTAL_DURATION);
                fDeadline[i] = deadline;
                fGpu[i] = gpu;
                fWait[i] = us(m, FrameMetrics.UNKNOWN_DELAY_DURATION);
                fInput[i] = us(m, FrameMetrics.INPUT_HANDLING_DURATION);
                fDraw[i] = us(m, FrameMetrics.ANIMATION_DURATION) + us(m, FrameMetrics.LAYOUT_MEASURE_DURATION) + us(m, FrameMetrics.DRAW_DURATION);
                fSync[i] = us(m, FrameMetrics.SYNC_DURATION);
                fCommand[i] = us(m, FrameMetrics.COMMAND_ISSUE_DURATION);
                fSwap[i] = us(m, FrameMetrics.SWAP_BUFFERS_DURATION);
                fNext = (i + 1) % FRAMES;
                if (fCount < FRAMES) {
                    fCount++;
                }
            }
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- touches

    /** Each touch event as the activity dispatches it (UI thread). */
    void touch(MotionEvent ev) {
        try {
            int a = ev.getActionMasked();
            if (a != MotionEvent.ACTION_DOWN && a != MotionEvent.ACTION_MOVE && a != MotionEvent.ACTION_UP && a != MotionEvent.ACTION_CANCEL) {
                return;
            }
            int late = (int) Math.max(0, Math.min(60000, SystemClock.uptimeMillis() - ev.getEventTime()));
            synchronized (this) {
                int i = tNext;
                tWall[i] = System.currentTimeMillis();
                tLate[i] = late;
                tAction[i] = (byte) a;
                tNext = (i + 1) % TOUCHES;
                if (tCount < TOUCHES) {
                    tCount++;
                }
            }
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- the sums

    private static void stats(JSONObject o, String key, int[] v, int n, boolean ms) throws Exception {
        if (n == 0) {
            return;
        }
        int[] a = Arrays.copyOf(v, n);
        Arrays.sort(a);
        int lo = 0;
        while (lo < n && a[lo] < 0) {
            lo++;
        }
        if (lo == n) {
            return;
        }
        int len = n - lo;
        JSONArray t = new JSONArray();
        double div = ms ? 1.0 : 1000.0;
        t.put(Math.round(a[lo + len / 2] / div * 10) / 10.0);
        t.put(Math.round(a[lo + Math.min(len - 1, (int) (len * 0.95))] / div * 10) / 10.0);
        t.put(Math.round(a[n - 1] / div * 10) / 10.0);
        o.put(key, t);
    }

    /**
     * The frames and touches between two wall-clock times, summed up as JSON: counts, frames over
     * their deadline, and [p50, p95, max] in ms of each timing.
     */
    synchronized String summary(long from, long to) {
        try {
            JSONObject o = new JSONObject();
            o.put("frameMetrics", Build.VERSION.SDK_INT >= 24 && frameListener != null);
            int n = 0, over = 0, overOneAndHalf = 0;
            int[] total = new int[fCount], gpu = new int[fCount], wait = new int[fCount], input = new int[fCount];
            int[] draw = new int[fCount], sync = new int[fCount], command = new int[fCount], swap = new int[fCount];
            for (int k = 0; k < fCount; k++) {
                int i = (fNext - fCount + k + FRAMES) % FRAMES;
                if (fWall[i] < from || fWall[i] > to) {
                    continue;
                }
                total[n] = fTotal[i];
                gpu[n] = fGpu[i];
                wait[n] = fWait[i];
                input[n] = fInput[i];
                draw[n] = fDraw[i];
                sync[n] = fSync[i];
                command[n] = fCommand[i];
                swap[n] = fSwap[i];
                if (fDeadline[i] > 0) {
                    if (fTotal[i] > fDeadline[i]) {
                        over++;
                    }
                    if (fTotal[i] > fDeadline[i] * 3 / 2) {
                        overOneAndHalf++;
                    }
                }
                n++;
            }
            o.put("frames", n);
            o.put("overDeadline", over);
            o.put("overDeadlineByHalf", overOneAndHalf);
            stats(o, "total", total, n, false);
            stats(o, "gpu", gpu, n, false);
            stats(o, "waitUi", wait, n, false);
            stats(o, "input", input, n, false);
            stats(o, "uiDraw", draw, n, false);
            stats(o, "sync", sync, n, false);
            stats(o, "command", command, n, false);
            stats(o, "swap", swap, n, false);
            int m = 0, moves = 0;
            int[] late = new int[tCount];
            for (int k = 0; k < tCount; k++) {
                int i = (tNext - tCount + k + TOUCHES) % TOUCHES;
                if (tWall[i] < from || tWall[i] > to) {
                    continue;
                }
                late[m++] = tLate[i];
                if (tAction[i] == MotionEvent.ACTION_MOVE) {
                    moves++;
                }
            }
            o.put("touches", m);
            o.put("moves", moves);
            stats(o, "touchLate", late, m, true);
            return o.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** The display's refresh rate now, and the rates it can run at. */
    String display() {
        try {
            JSONObject o = new JSONObject();
            Display d = Build.VERSION.SDK_INT >= 30 ? activity.getDisplay() : activity.getWindowManager().getDefaultDisplay();
            if (d == null) {
                return "";
            }
            o.put("hz", Math.round(d.getRefreshRate() * 10) / 10.0);
            if (Build.VERSION.SDK_INT >= 23) {
                JSONArray rates = new JSONArray();
                for (Display.Mode mode : d.getSupportedModes()) {
                    double r = Math.round(mode.getRefreshRate() * 10) / 10.0;
                    boolean seen = false;
                    for (int i = 0; i < rates.length(); i++) {
                        if (rates.getDouble(i) == r) {
                            seen = true;
                        }
                    }
                    if (!seen) {
                        rates.put(r);
                    }
                }
                o.put("modes", rates);
            }
            o.put("sdk", Build.VERSION.SDK_INT);
            return o.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * Asks for the display's fastest refresh rate (at the current resolution) while {@code on}, and
     * gives the choice back to Android after. The glass speed test runs in it: a touch makes most
     * phones switch to their fastest rate, and a page scrolling by itself doesn't.
     */
    void highRefresh(final boolean on) {
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window w = activity.getWindow();
                    WindowManager.LayoutParams lp = w.getAttributes();
                    int id = 0;
                    if (on) {
                        Display d = Build.VERSION.SDK_INT >= 30 ? activity.getDisplay() : activity.getWindowManager().getDefaultDisplay();
                        if (d != null) {
                            Display.Mode cur = d.getMode();
                            float best = 0;
                            for (Display.Mode m : d.getSupportedModes()) {
                                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight() && m.getRefreshRate() > best) {
                                    best = m.getRefreshRate();
                                    id = m.getModeId();
                                }
                            }
                        }
                    }
                    if (lp.preferredDisplayModeId != id) {
                        lp.preferredDisplayModeId = id;
                        w.setAttributes(lp);
                    }
                } catch (Throwable ignored) {
                }
            }
        });
    }

    // ---------------------------------------------------------------- the trace

    private File traceFile() {
        return new File(activity.getCacheDir(), TRACE_FILE);
    }

    /**
     * Starts recording the WebView's trace events. False if it can't (before API 28). A recording
     * left running (the page reloaded during one) is dropped first.
     */
    boolean traceStart() {
        if (Build.VERSION.SDK_INT < 28) {
            return false;
        }
        try {
            TracingController tc = TracingController.getInstance();
            if (tc.isTracing()) {
                if (traceExecutor == null) {
                    traceExecutor = Executors.newSingleThreadExecutor();
                }
                tc.stop(null, traceExecutor); // null: its data is discarded
            }
            traceDone();
            TracingConfig cfg = new TracingConfig.Builder()
                    .addCategories(TRACE_CATEGORIES)
                    .setTracingMode(TracingConfig.RECORD_CONTINUOUSLY)
                    .build();
            tc.start(cfg);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Stops the recording and writes it to the cache. When it's all written, {@code saved} runs with
     * its size in bytes (or -1 if writing failed). False if nothing was being recorded.
     */
    boolean traceStop(final SizeCallback saved) {
        if (Build.VERSION.SDK_INT < 28) {
            return false;
        }
        try {
            TracingController tc = TracingController.getInstance();
            if (!tc.isTracing()) {
                return false;
            }
            final File f = traceFile();
            OutputStream out = new BufferedOutputStream(new FileOutputStream(f), 1 << 16) {
                private boolean closed;

                @Override
                public void close() throws IOException {
                    if (closed) {
                        return;
                    }
                    closed = true;
                    long size = -1;
                    try {
                        super.close();
                        size = f.length();
                    } finally {
                        saved.done(size);
                    }
                }
            };
            if (traceExecutor == null) {
                traceExecutor = Executors.newSingleThreadExecutor();
            }
            return tc.stop(out, traceExecutor);
        } catch (Throwable t) {
            return false;
        }
    }

    interface SizeCallback {
        void done(long bytes);
    }

    /**
     * The next piece of the saved recording as text (about 256 KB), or null at its end. A piece
     * never ends inside a character: the bytes of one cut short wait for the next piece.
     */
    String traceRead() {
        synchronized (traceLock) {
            try {
                if (traceIn == null) {
                    File f = traceFile();
                    if (!f.exists()) {
                        return null;
                    }
                    traceIn = new FileInputStream(f);
                    traceCarry = new byte[0];
                }
                byte[] buf = new byte[TRACE_CHUNK + traceCarry.length];
                System.arraycopy(traceCarry, 0, buf, 0, traceCarry.length);
                int n = traceIn.read(buf, traceCarry.length, TRACE_CHUNK);
                if (n < 0) {
                    String rest = traceCarry.length > 0 ? new String(traceCarry, StandardCharsets.UTF_8) : null;
                    traceCarry = new byte[0];
                    closeTrace();
                    return rest;
                }
                int len = traceCarry.length + n;
                int cut = utf8Boundary(buf, len);
                traceCarry = Arrays.copyOfRange(buf, cut, len);
                return new String(buf, 0, cut, StandardCharsets.UTF_8);
            } catch (Throwable t) {
                closeTrace();
                return null;
            }
        }
    }

    /** Where the last whole UTF-8 character in buf[0, len) ends. */
    static int utf8Boundary(byte[] b, int len) {
        int i = len - 1, back = 0;
        while (i >= 0 && back < 3 && (b[i] & 0xC0) == 0x80) {
            i--;
            back++;
        }
        if (i < 0) {
            return len;
        }
        int lead = b[i] & 0xFF;
        int need = lead < 0x80 ? 1 : (lead >> 5) == 6 ? 2 : (lead >> 4) == 14 ? 3 : (lead >> 3) == 30 ? 4 : 1;
        return i + need <= len ? len : i;
    }

    private void closeTrace() {
        if (traceIn != null) {
            try {
                traceIn.close();
            } catch (Throwable ignored) {
            }
            traceIn = null;
        }
    }

    /** The recording is read (or not wanted): closed and deleted. */
    void traceDone() {
        synchronized (traceLock) {
            closeTrace();
            traceCarry = new byte[0];
            try {
                File f = traceFile();
                if (f.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            } catch (Throwable ignored) {
            }
        }
    }

    // ---------------------------------------------------------------- the speed test's finger

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean flicking = new AtomicBoolean();

    /**
     * One vertical flick of the page for the glass speed test, made of Android's own touch events (a
     * finger down, a move every 8 ms, the finger up at speed) and sent through the app's window as a
     * finger's are, so the page goes the way it does under a finger: the touch through the UI thread
     * and the WebView, its fling, the frames drawn after. A page that scrolls by itself (the test's
     * other half) skips all of that, and on the owner's phone that half was smooth while the page
     * stuttered under a finger. In the page view's pixels: from (x, y), dy up or down (100 to 6000)
     * over ms (40 to 600). Only ever a straight vertical move that long, so it can scroll and never
     * tap. False if one is still going or it's out of bounds.
     */
    boolean flick(final View page, final float x, final float y, final float dy, final int ms) {
        if (page == null || !(Math.abs(dy) >= 100 && Math.abs(dy) <= 6000) || ms < 40 || ms > 600 || !(x >= 0) || !(y >= 0)) {
            return false;
        }
        if (!flicking.compareAndSet(false, true)) {
            return false;
        }
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!page.isAttachedToWindow() || x > page.getWidth() || y > page.getHeight() || y + dy < 0 || y + dy > page.getHeight()) {
                        flicking.set(false);
                        return;
                    }
                    int[] at = new int[2];
                    page.getLocationInWindow(at);
                    final float wx = at[0] + x;
                    final float wy = at[1] + y;
                    final long down = SystemClock.uptimeMillis();
                    final int steps = Math.max(4, ms / 8);
                    touch(down, down, MotionEvent.ACTION_DOWN, wx, wy);
                    for (int i = 1; i <= steps; i++) {
                        final long t = down + 16 + (long) ms * i / steps;
                        final float yi = wy + dy * i / steps;
                        final boolean last = i == steps;
                        main.postAtTime(new Runnable() {
                            @Override
                            public void run() {
                                touch(down, t, MotionEvent.ACTION_MOVE, wx, yi);
                                if (last) {
                                    touch(down, t, MotionEvent.ACTION_UP, wx, yi);
                                    flicking.set(false);
                                }
                            }
                        }, t);
                    }
                } catch (Throwable t) {
                    flicking.set(false);
                }
            }
        });
        return true;
    }

    /** One finger's touch event at (x, y) in the window, at the given time, through the activity. */
    private void touch(long down, long at, int action, float x, float y) {
        MotionEvent.PointerProperties p = new MotionEvent.PointerProperties();
        p.id = 0;
        p.toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords c = new MotionEvent.PointerCoords();
        c.x = x;
        c.y = y;
        c.pressure = 1f;
        c.size = 0.1f;
        MotionEvent ev = MotionEvent.obtain(down, at, action, 1, new MotionEvent.PointerProperties[] {p},
                new MotionEvent.PointerCoords[] {c}, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        try {
            activity.dispatchTouchEvent(ev);
        } catch (Throwable ignored) {
        } finally {
            ev.recycle();
        }
    }
}
