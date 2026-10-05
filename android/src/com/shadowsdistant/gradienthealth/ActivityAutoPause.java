package com.shadowsdistant.gradienthealth;

import android.location.Location;

import java.util.ArrayList;
import java.util.List;

/**
 * Auto-pause for a recording: the clock stops when the person stops and goes on when they go. The
 * same rules as the page's (src/activity.js, autoPauser), so the browser's recorder and this one
 * agree, and test/activity.mjs checks them there.
 *
 * A fix is still when the GPS's own speed (Doppler, steady to a few tenths of a m/s) is under the
 * activity's still speed, moving when it's over its move speed, and neither in between.
 * {@link #STOP_MS} of still fixes pause the clock from the first of them; moving fixes over
 * {@link #MOVE_MS} start it again from the first of those. A fix in between calls a stop off (a
 * runner walking up a hill keeps going), and one worse than 50 m decides nothing. Without speeds
 * (a network position) it's slower and more careful: still is the last {@link #STOP_BLIND_MS} of
 * fixes moving slower than the still speed, by a straight-line fit through them (single fixes wander
 * by their error, the fit much less), and moving is being well outside the stop's circle. The fixes
 * in doubt are held back until it's decided, then handed on with their paused flag set, so the
 * track's pauses are exactly the clock's. It's armed by the first moving fix: after the start, or a
 * resume by hand, standing still doesn't pause straight away.
 *
 * Not synchronized: {@link ActivityTrack} calls it under its own lock.
 */
final class ActivityAutoPause {
    static final long STOP_MS = 5000;
    static final long STOP_BLIND_MS = 20000;
    static final long MOVE_MS = 2000;
    private static final double BAD_ACC = 50;

    private static final int MOVING = 0;
    private static final int STOPPING = 1;
    private static final int PAUSED = 2;
    private static final int STARTING = 3;

    /** What one fix decided. */
    static final class Result {
        /** Fixes to keep now, in order, their paused column set. */
        final List<double[]> out = new ArrayList<double[]>();
        /** When the clock stopped (where the stop began), or -1. */
        long pause = -1L;
        /** When it went on again (where the move began), or -1. */
        long resume = -1L;
    }

    private final double still;
    private final double move;
    private int mode;
    private final List<double[]> held = new ArrayList<double[]>();
    private double[] anchor;
    private double[] ref;
    private long since;
    private boolean armed;

    /** {@code paused}: it starts out auto-paused (a recording picked up again), the stop where the next fix is. */
    ActivityAutoPause(String type, boolean paused) {
        if ("walk".equals(type)) {
            still = 0.35;
            move = 0.8;
        } else if ("hike".equals(type)) {
            still = 0.3;
            move = 0.7;
        } else if ("run".equals(type)) {
            still = 0.9;
            move = 1.6;
        } else if ("cycle".equals(type)) {
            still = 1.2;
            move = 2.4;
        } else {
            still = 0.5;
            move = 1.0;
        }
        mode = paused ? PAUSED : MOVING;
        armed = paused;
    }

    boolean isPaused() {
        return mode == PAUSED || mode == STARTING;
    }

    /** A pause or resume by hand: what's held goes as it stood, and it waits to be armed again. */
    Result manual() {
        Result r = new Result();
        flush(r, isPaused());
        mode = MOVING;
        armed = false;
        anchor = null;
        ref = null;
        return r;
    }

    /** Everything held, as it stands (the recording ends, or auto-pause is turned off). */
    Result drain() {
        Result r = new Result();
        flush(r, isPaused());
        return r;
    }

    Result feed(double[] p) {
        Result r = new Result();
        double v = p[ActivityTrack.SPEED];
        boolean hasSpeed = !Double.isNaN(v);
        boolean bad = !(acc(p) <= BAD_ACC);
        if (!armed && !bad) {
            if (hasSpeed) {
                armed = v >= move;
            } else if (ref == null) {
                ref = p;
            } else {
                armed = meters(ref, p) > Math.max(15, 2 * acc(p));
            }
        }
        if (mode == MOVING) {
            // Without a speed, any fix could be where a stop begins: the next ones say whether it was.
            if (bad || !armed || (hasSpeed && v >= still)) {
                keep(r, p, false);
                return r;
            }
            mode = STOPPING;
            since = (long) p[ActivityTrack.T];
            anchor = p;
            held.clear();
            held.add(p);
            return r;
        }
        if (mode == STOPPING) {
            held.add(p);
            if (bad) {
                return r;
            }
            if (hasSpeed ? v < still : near(p)) {
                boolean blind = false;
                for (double[] x : held) {
                    if (Double.isNaN(x[ActivityTrack.SPEED])) {
                        blind = true;
                        break;
                    }
                }
                if ((long) p[ActivityTrack.T] - since < (blind ? STOP_BLIND_MS : STOP_MS)) {
                    return r;
                }
                if (!blind || drift() < still) {
                    if (blind) {
                        // Without speeds the stop is where the fixes' middle was (any one could be off).
                        anchor = middle();
                    }
                    mode = PAUSED;
                    flush(r, true);
                    r.pause = since;
                    return r;
                }
                // Drifting along slowly: the oldest fix goes on as moving, and the window moves with it.
                keep(r, held.remove(0), false);
                since = (long) held.get(0)[ActivityTrack.T];
                anchor = held.get(0);
                return r;
            }
            // Called off: kept as moving. A fix without a speed may start the next stop.
            held.remove(held.size() - 1);
            flush(r, false);
            if (!hasSpeed) {
                since = (long) p[ActivityTrack.T];
                anchor = p;
                held.add(p);
                return r;
            }
            mode = MOVING;
            anchor = null;
            keep(r, p, false);
            return r;
        }
        if (mode == PAUSED) {
            if (anchor == null && !bad) {
                anchor = p;
            }
            if (bad || !(hasSpeed ? v >= move || outside(p) : outside(p))) {
                keep(r, p, true);
                return r;
            }
            mode = STARTING;
            since = (long) p[ActivityTrack.T];
            held.clear();
            held.add(p);
            return r;
        }
        // STARTING
        held.add(p);
        if (bad) {
            return r;
        }
        if (!(hasSpeed ? v >= move || outside(p) : outside(p))) {
            mode = PAUSED;
            flush(r, true);
            return r;
        }
        if ((long) p[ActivityTrack.T] - since < MOVE_MS) {
            return r;
        }
        mode = MOVING;
        anchor = null;
        flush(r, false);
        r.resume = since;
        return r;
    }

    private void flush(Result r, boolean paused) {
        for (double[] x : held) {
            keep(r, x, paused);
        }
        held.clear();
    }

    private static void keep(Result r, double[] p, boolean paused) {
        p[ActivityTrack.PAUSED] = paused ? 1 : 0;
        r.out.add(p);
    }

    private boolean near(double[] p) {
        return meters(anchor, p) <= Math.max(10, 2 * acc(p));
    }

    /** The held fixes worse than 50 m left out. */
    private List<double[]> good() {
        List<double[]> ok = new ArrayList<double[]>();
        for (double[] x : held) {
            if (acc(x) <= BAD_ACC) {
                ok.add(x);
            }
        }
        return ok;
    }

    /** How fast the held fixes move (m/s): the slope of a least-squares line through them, east and north. */
    private double drift() {
        List<double[]> ok = good();
        if (ok.size() < 6) {
            return Double.POSITIVE_INFINITY;
        }
        double[] o = ok.get(0);
        double ky = 6371008.8 * (Math.PI / 180); // as the page works it out, so the two agree to the bit
        double kx = ky * Math.cos(o[ActivityTrack.LAT] * Math.PI / 180);
        double st = 0;
        double sx = 0;
        double sy = 0;
        for (double[] x : ok) {
            st += x[ActivityTrack.T] / 1000;
            sx += (x[ActivityTrack.LON] - o[ActivityTrack.LON]) * kx;
            sy += (x[ActivityTrack.LAT] - o[ActivityTrack.LAT]) * ky;
        }
        int n = ok.size();
        double tm = st / n;
        double xm = sx / n;
        double ym = sy / n;
        double tt = 0;
        double tx = 0;
        double ty = 0;
        for (double[] x : ok) {
            double dt = x[ActivityTrack.T] / 1000 - tm;
            tt += dt * dt;
            tx += dt * ((x[ActivityTrack.LON] - o[ActivityTrack.LON]) * kx - xm);
            ty += dt * ((x[ActivityTrack.LAT] - o[ActivityTrack.LAT]) * ky - ym);
        }
        return tt > 0 ? Math.hypot(tx / tt, ty / tt) : Double.POSITIVE_INFINITY;
    }

    /** Where the held fixes' middle is: a point with their average time and place. */
    private double[] middle() {
        List<double[]> ok = good();
        double[] m = new double[7];
        for (double[] x : ok) {
            m[ActivityTrack.T] += x[ActivityTrack.T] / ok.size();
            m[ActivityTrack.LAT] += x[ActivityTrack.LAT] / ok.size();
            m[ActivityTrack.LON] += x[ActivityTrack.LON] / ok.size();
        }
        m[ActivityTrack.ALT] = Double.NaN;
        m[ActivityTrack.ACC] = ok.isEmpty() ? 5 : acc(ok.get(0));
        m[ActivityTrack.SPEED] = Double.NaN;
        m[ActivityTrack.PAUSED] = 1;
        return m;
    }

    private boolean outside(double[] p) {
        return anchor != null && meters(anchor, p) > Math.max(15, 2 * acc(p));
    }

    private static double acc(double[] p) {
        double a = p[ActivityTrack.ACC];
        return Double.isNaN(a) ? 5 : a;
    }

    private static double meters(double[] a, double[] b) {
        float[] out = new float[1];
        Location.distanceBetween(a[ActivityTrack.LAT], a[ActivityTrack.LON], b[ActivityTrack.LAT], b[ActivityTrack.LON], out);
        return out[0];
    }
}
