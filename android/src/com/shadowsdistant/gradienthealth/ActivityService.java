package com.shadowsdistant.gradienthealth;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * Records an outdoor activity the person started in the app (a run, walk, hike or ride): GPS fixes
 * about once a second and the phone's step counter go into {@link ActivityTrack}, with the screen off
 * and the app in the background. It's a foreground service of type location that the app starts while
 * it's in front, so it needs no background location permission. Its ongoing notification reads
 * "Run · 12:34 · 2.14 km", has Pause (or Resume) and Finish, and opens the app when tapped.
 *
 * While the page is in front it gets window.__gh.onActivity(state) about once a second. If Android
 * stops the service mid-activity (or the phone restarts), the recording stays in progress on disk and
 * recording starts again the next time the app comes to the front ({@link #pageResumed}).
 *
 * GPS comes from the GPS provider (on Android 12+ asked for with a LocationRequest at high accuracy,
 * once a second); without one, the fused provider (Android 12+), else the network. Until the GPS has
 * a good fix, the fused provider (or, before Android 12, the network) also gives a rough position at
 * once, which the page shows on the map and which never counts toward the distance.
 *
 * With auto-pause on (see {@link ActivityAutoPause}) the clock stops when the person does, and the
 * notification says "Auto-paused". With the voice on, each km or mile is said aloud
 * ({@link ActivityVoice}), screen off or not.
 */
public final class ActivityService extends Service {
    static final String ACTION_START = "com.shadowsdistant.gradienthealth.activity.START";
    static final String ACTION_PAUSE = "com.shadowsdistant.gradienthealth.activity.PAUSE";
    static final String ACTION_RESUME = "com.shadowsdistant.gradienthealth.activity.RESUME";
    static final String ACTION_FINISH = "com.shadowsdistant.gradienthealth.activity.FINISH";
    private static final String CHANNEL = "activity";
    private static final int NOTIFICATION_ID = 4401;
    private static final int FINISHED_NOTIFICATION_ID = 4402;
    private static final long FIX_EVERY_MS = 1000;
    /** The rough position while GPS looks: this often, for at most COARSE_FOR_MS. */
    private static final long COARSE_EVERY_MS = 2000;
    private static final long COARSE_FOR_MS = 180000;
    /** A position the phone already had is a fair first guess this fresh. */
    private static final long LAST_KNOWN_MS = 5 * 60000L;
    private static final long TICK_MS = 1000;
    /** With the screen off the notification changes every 10 s instead of every second. */
    private static final long DARK_NOTIFY_MS = 10000;
    /** A fix accurate to 50 m this recent means GPS is "ok". */
    private static final long FRESH_FIX_MS = 10000;
    private static final int BRAND = 0xFF7B72D9; // the logo's purple (res/values/colors.xml icon_bg)
    private static final double METERS_PER_MILE = 1609.344;

    private static volatile ActivityService running;

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler handler;
    // Started and stopped on the main thread; the listeners' callbacks run on `thread`.
    private LocationManager locations;
    private volatile LocationListener locationListener;
    private volatile String provider;
    private volatile boolean providerOn;
    private volatile LocationListener coarseListener;
    private volatile long coarseSince;
    // The spoken splits (main thread only).
    private ActivityVoice voice;
    private SensorManager sensors;
    private SensorEventListener stepListener;
    private volatile boolean tracking;
    private volatile boolean foreground;
    private volatile long notifiedAt;
    // The notification's parts, made once (it's rebuilt every second while the screen is on).
    private int smallIcon;
    private PendingIntent openIntent;
    private Notification.Action pauseAction;
    private Notification.Action resumeAction;
    private Notification.Action finishAction;

    // ---------------------------------------------------------------- for the bridge

    /**
     * actStart({id, type, title, units?, autoPause?, voice?}). False without precise location
     * permission, while another activity is recording, or if the service can't start.
     */
    static boolean start(Context context, String json) {
        if (!ActivityPermissions.canTrack(context)) {
            return false;
        }
        String id;
        String type;
        String title;
        String units;
        boolean autoPause;
        boolean speak;
        try {
            JSONObject in = new JSONObject(json == null ? "{}" : json);
            id = in.optString("id", "").trim();
            type = in.optString("type", "other");
            title = in.optString("title", "").trim();
            units = ActivityTrack.units(in.optString("units", ""));
            autoPause = in.optBoolean("autoPause", false);
            speak = in.optBoolean("voice", false);
        } catch (Throwable t) {
            return false;
        }
        if (id.isEmpty() || id.length() > 200) {
            return false;
        }
        if (!("walk".equals(type) || "run".equals(type) || "hike".equals(type) || "cycle".equals(type))) {
            type = "other";
        }
        if (title.length() > 100) {
            title = title.substring(0, 100);
        }
        ActivityTrack track = ActivityTrack.get(context);
        int result = track.begin(id, type, title, units, System.currentTimeMillis(), autoPause, speak);
        if (result == ActivityTrack.BUSY) {
            return false;
        }
        if (launch(context)) {
            return true;
        }
        if (result == ActivityTrack.STARTED) {
            track.discard(id);
        }
        return false;
    }

    /** Starts the service (or pokes it). Android only allows that while the app is in front. */
    private static boolean launch(Context context) {
        try {
            Intent intent = new Intent(context, ActivityService.class).setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    static void pause(Context context) {
        ActivityTrack.get(context).pause(System.currentTimeMillis());
        poke();
    }

    static void resume(Context context) {
        ActivityTrack track = ActivityTrack.get(context);
        track.resume(System.currentTimeMillis());
        if (running == null && track.isActive()) {
            launch(context);
        } else {
            poke();
        }
    }

    /** actSetOptions({autoPause?, voice?}): changed while it records. */
    static void setOptions(Context context, String json) {
        Boolean autoPause = null;
        Boolean speak = null;
        try {
            JSONObject in = new JSONObject(json == null ? "{}" : json);
            if (in.has("autoPause")) {
                autoPause = in.optBoolean("autoPause", false);
            }
            if (in.has("voice")) {
                speak = in.optBoolean("voice", false);
            }
        } catch (Throwable t) {
            return;
        }
        ActivityTrack.get(context).setOptions(autoPause, speak, System.currentTimeMillis());
        final ActivityService s = running;
        if (s != null && speak != null) {
            final boolean on = speak;
            s.main.post(new Runnable() {
                @Override
                public void run() {
                    s.voiceOn(on);
                }
            });
        }
        poke();
    }

    /** actStop(): ends the recording and tells the page (onActivity, active false). Returns that state. */
    static String stop(Context context) {
        ActivityTrack track = ActivityTrack.get(context);
        long now = System.currentTimeMillis();
        track.finish(now);
        final ActivityService s = running;
        if (s != null) {
            s.main.post(new Runnable() {
                @Override
                public void run() {
                    s.shutDown();
                }
            });
        }
        String state = track.stateJson(now, "off");
        tellPage(state);
        return state;
    }

    static String state(Context context) {
        return ActivityTrack.get(context).stateJson(System.currentTimeMillis(), gps());
    }

    static String points(Context context, int from) {
        return ActivityTrack.get(context).pointsJson(from);
    }

    static boolean clear(Context context, String id) {
        return ActivityTrack.get(context).clear(id);
    }

    /** actSupport(): {gps, steps, hc, locationOn}. */
    static String support(Context context) {
        boolean gps = false;
        boolean steps = false;
        boolean locationOn = false;
        try {
            LocationManager lm = context.getSystemService(LocationManager.class);
            gps = context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
                    || (lm != null && lm.getAllProviders().contains(LocationManager.GPS_PROVIDER));
            if (lm != null) {
                locationOn = Build.VERSION.SDK_INT >= 28 ? lm.isLocationEnabled()
                        : lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            }
        } catch (Throwable ignored) {
        }
        try {
            SensorManager sm = context.getSystemService(SensorManager.class);
            steps = sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
        } catch (Throwable ignored) {
        }
        boolean hc = Build.VERSION.SDK_INT >= Bridge.HEALTH_CONNECT_MIN_SDK && HealthBridge.available(context);
        try {
            JSONObject o = new JSONObject();
            o.put("gps", gps);
            o.put("steps", steps);
            o.put("hc", hc);
            o.put("locationOn", locationOn);
            return o.toString();
        } catch (Throwable t) {
            return "{\"gps\":false,\"steps\":false,\"hc\":false,\"locationOn\":false}";
        }
    }

    /**
     * The app came to the front: a recording in progress whose service isn't running (Android stopped
     * it, or the phone restarted) records again.
     */
    static void pageResumed(Context context) {
        if (running != null) {
            return;
        }
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (running == null && ActivityTrack.get(app).isActive() && ActivityPermissions.canTrack(app)) {
                        launch(app);
                    }
                } catch (Throwable ignored) {
                }
            }
        }, "gradient-activity-check").start();
    }

    /** "ok", "searching" or "off" for the recording in progress. */
    static String gps() {
        ActivityService s = running;
        return s == null ? "off" : s.gpsState();
    }

    private static void poke() {
        final ActivityService s = running;
        if (s != null) {
            s.handler.post(new Runnable() {
                @Override
                public void run() {
                    s.refresh(true);
                }
            });
        }
    }

    private static void tellPage(String state) {
        MainActivity page = MainActivity.live();
        if (page != null) {
            page.callJs(MainActivity.jsCall("onActivity", state));
        }
    }

    // ---------------------------------------------------------------- the service

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("gradient-activity");
        thread.start();
        handler = new Handler(thread.getLooper());
        createChannel(this);
        smallIcon = drawable("ic_stat_activity");
        openIntent = openApp();
        pauseAction = action("Pause", ACTION_PAUSE, "ic_stat_pause");
        resumeAction = action("Resume", ACTION_RESUME, "ic_stat_play");
        finishAction = action("Finish", ACTION_FINISH, "ic_stat_stop");
        running = this;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        ActivityTrack track = ActivityTrack.get(this);
        long now = System.currentTimeMillis();
        if (ACTION_FINISH.equals(action)) {
            finishHere(track, now);
            return START_NOT_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            track.pause(now);
        } else if (ACTION_RESUME.equals(action)) {
            track.resume(now);
        }
        // startForegroundService() must be followed by startForeground(), whatever comes next.
        boolean ok = foreground || goForeground(build(track.snapshot(now), now));
        if (!ok || !track.isActive()) {
            shutDown();
            return START_NOT_STICKY;
        }
        if (!tracking) {
            startTracking();
        }
        handler.post(new Runnable() {
            @Override
            public void run() {
                refresh(true);
            }
        });
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopTracking();
        voiceOn(false);
        if (running == this) {
            running = null;
        }
        if (thread != null) {
            thread.quitSafely();
        }
        super.onDestroy();
    }

    private boolean goForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            foreground = true;
            return true;
        } catch (Throwable t) {
            // Not allowed now: Android started it again with the app in the background, or location
            // was taken away. The recording waits on disk until the app is opened.
            return false;
        }
    }

    /** Stops recording and removes the service and its notification. */
    void shutDown() {
        stopTracking();
        voiceOn(false);
        if (foreground) {
            try {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } catch (Throwable ignored) {
            }
            foreground = false;
        }
        stopSelf();
    }

    /** Finish in the notification: ends the recording, tells the page, leaves a note to open it. */
    private void finishHere(ActivityTrack track, long now) {
        boolean was = track.isActive();
        track.finish(now);
        tellPage(track.stateJson(now, "off"));
        shutDown();
        if (was) {
            postFinished(track.snapshot(now));
        }
    }

    private void startTracking() {
        tracking = true;
        startLocation();
        startCoarse();
        startSteps();
        // The voice's engine takes a moment to start: it does so now, ready for the first split.
        voiceOn(ActivityTrack.get(this).snapshot(System.currentTimeMillis()).voice);
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    private void stopTracking() {
        tracking = false;
        if (handler != null) {
            handler.removeCallbacks(tick);
        }
        try {
            if (locations != null && locationListener != null) {
                locations.removeUpdates(locationListener);
            }
        } catch (Throwable ignored) {
        }
        locationListener = null;
        stopCoarse();
        try {
            if (sensors != null && stepListener != null) {
                sensors.unregisterListener(stepListener);
            }
        } catch (Throwable ignored) {
        }
        stepListener = null;
    }

    private static String pickProvider(LocationManager lm) {
        List<String> all = lm.getAllProviders();
        if (all.contains(LocationManager.GPS_PROVIDER)) {
            return LocationManager.GPS_PROVIDER;
        }
        if (Build.VERSION.SDK_INT >= 31 && all.contains(LocationManager.FUSED_PROVIDER)) {
            return LocationManager.FUSED_PROVIDER;
        }
        return all.contains(LocationManager.NETWORK_PROVIDER) ? LocationManager.NETWORK_PROVIDER : null;
    }

    private void startLocation() {
        try {
            locations = getSystemService(LocationManager.class);
            if (locations == null || !ActivityPermissions.canTrack(this)) {
                return;
            }
            final String p = pickProvider(locations);
            if (p == null) {
                return;
            }
            provider = p;
            providerOn = locations.isProviderEnabled(p);
            // Every fix (no distance filter): ActivityTrack decides what to store, and a steady
            // stream tells "searching" from standing still.
            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    onFix(location);
                }

                @Override
                public void onProviderEnabled(String name) {
                    if (p.equals(name)) {
                        providerOn = true;
                    }
                }

                @Override
                public void onProviderDisabled(String name) {
                    if (p.equals(name)) {
                        providerOn = false;
                    }
                }

                @Override
                @SuppressWarnings("deprecation") // abstract before Android 11, so it has to be here
                public void onStatusChanged(String name, int status, Bundle extras) {
                }
            };
            // Android 12+: a LocationRequest at high accuracy (the GPS at its best, not in a
            // power-saving mode), once a second and not batched. Before that, the classic request.
            if (Build.VERSION.SDK_INT >= 31) {
                Api31.request(locations, p, FIX_EVERY_MS, true, handler, listener);
            } else {
                locations.requestLocationUpdates(p, FIX_EVERY_MS, 0f, listener, thread.getLooper());
            }
            locationListener = listener;
        } catch (Throwable t) {
            locationListener = null; // no permission after all: GPS shows as off
        }
    }

    /**
     * A rough position at once while the GPS looks: the freshest one the phone already has, then the
     * fused provider's (Android 12+, balanced power) or the network's every 2 s, until the GPS has a
     * good fix (or for 3 minutes). Only for the map: ActivityTrack keeps it apart from the track.
     */
    private void startCoarse() {
        try {
            LocationManager lm = locations;
            if (lm == null || coarseListener != null || !LocationManager.GPS_PROVIDER.equals(provider)
                    || "ok".equals(gpsState())) {
                return;
            }
            Location best = null;
            for (String name : lm.getAllProviders()) {
                Location l = lm.getLastKnownLocation(name);
                if (l != null && ageMs(l) <= LAST_KNOWN_MS && (best == null || ageMs(l) < ageMs(best))) {
                    best = l;
                }
            }
            if (best != null) {
                onCoarse(best);
            }
            String src = Build.VERSION.SDK_INT >= 31 && lm.getAllProviders().contains(LocationManager.FUSED_PROVIDER)
                    ? LocationManager.FUSED_PROVIDER : LocationManager.NETWORK_PROVIDER;
            if (!lm.getAllProviders().contains(src) || !lm.isProviderEnabled(src)) {
                return;
            }
            LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    onCoarse(location);
                }

                @Override
                public void onProviderEnabled(String name) {
                }

                @Override
                public void onProviderDisabled(String name) {
                }

                @Override
                @SuppressWarnings("deprecation") // abstract before Android 11, so it has to be here
                public void onStatusChanged(String name, int status, Bundle extras) {
                }
            };
            if (Build.VERSION.SDK_INT >= 31) {
                Api31.request(lm, src, COARSE_EVERY_MS, false, handler, listener);
            } else {
                lm.requestLocationUpdates(src, COARSE_EVERY_MS, 0f, listener, thread.getLooper());
            }
            coarseListener = listener;
            coarseSince = SystemClock.elapsedRealtime();
        } catch (Throwable t) {
            coarseListener = null; // then the map waits for the GPS
        }
    }

    private void stopCoarse() {
        LocationListener l = coarseListener;
        coarseListener = null;
        try {
            if (locations != null && l != null) {
                locations.removeUpdates(l);
            }
        } catch (Throwable ignored) {
        }
    }

    private void onCoarse(Location l) {
        if (l != null) {
            long age = ageMs(l);
            ActivityTrack.get(this).setCoarse(System.currentTimeMillis() - (age == Long.MAX_VALUE ? 0L : age),
                    l.getLatitude(), l.getLongitude(), l.hasAccuracy() ? l.getAccuracy() : Double.NaN);
        }
    }

    /** How old a fix is, by the clock that doesn't jump (Long.MAX_VALUE when it can't say). */
    private static long ageMs(Location l) {
        long nanos = l.getElapsedRealtimeNanos();
        return nanos > 0 ? Math.max(0L, (SystemClock.elapsedRealtimeNanos() - nanos) / 1000000L) : Long.MAX_VALUE;
    }

    private void onFix(Location l) {
        if (l == null) {
            return;
        }
        double alt = Double.NaN;
        if (Build.VERSION.SDK_INT >= 34 && l.hasMslAltitude()) {
            alt = l.getMslAltitudeMeters(); // above sea level, where the phone knows it
        } else if (l.hasAltitude()) {
            alt = l.getAltitude();
        }
        ActivityTrack.get(this).addFix(fixTime(l), l.getLatitude(), l.getLongitude(), alt,
                l.hasAccuracy() ? l.getAccuracy() : Double.NaN, l.hasSpeed() ? l.getSpeed() : Double.NaN,
                l.hasBearing() ? l.getBearing() : Double.NaN);
    }

    /** A fix's time on this phone's clock: GPS time is wrong on some phones, a fix's age isn't. */
    private static long fixTime(Location l) {
        long now = System.currentTimeMillis();
        long nanos = l.getElapsedRealtimeNanos();
        if (nanos > 0) {
            long age = (SystemClock.elapsedRealtimeNanos() - nanos) / 1000000L;
            if (age >= 0 && age < 60000L) {
                return now - age;
            }
        }
        return now;
    }

    private void startSteps() {
        try {
            sensors = getSystemService(SensorManager.class);
            Sensor counter = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (counter == null || !ActivityPermissions.canCountSteps(this)) {
                return;
            }
            SensorEventListener listener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    if (event != null && event.values != null && event.values.length > 0) {
                        long boot = System.currentTimeMillis() - SystemClock.elapsedRealtime();
                        ActivityTrack.get(ActivityService.this).onStepCounter(event.values[0], boot);
                    }
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {
                }
            };
            if (sensors.registerListener(listener, counter, SensorManager.SENSOR_DELAY_NORMAL, handler)) {
                stepListener = listener;
                ActivityTrack.get(this).stepsAvailable();
            }
        } catch (Throwable t) {
            stepListener = null; // steps stay null
        }
    }

    /** Once a second: save now and then, update the notification and the page. */
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!tracking) {
                return;
            }
            ActivityTrack track = ActivityTrack.get(ActivityService.this);
            long now = System.currentTimeMillis();
            if (!track.isActive()) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        shutDown();
                    }
                });
                return;
            }
            track.saveIfDue(now);
            // The rough position has done its job once the GPS has a good fix.
            if (coarseListener != null && ("ok".equals(gpsState()) || SystemClock.elapsedRealtime() - coarseSince > COARSE_FOR_MS)) {
                stopCoarse();
            }
            // Each km or mile is noted as it passes, and said aloud with the voice on.
            final ActivityTrack.Split split = track.takeSplit(now);
            if (split != null && track.snapshot(now).voice) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (voice == null) {
                            voice = new ActivityVoice(ActivityService.this);
                        }
                        voice.say(ActivityVoice.words(split));
                    }
                });
            }
            ActivityTrack.Snapshot s = refresh(interactive() || now - notifiedAt >= DARK_NOTIFY_MS);
            // The next tick lands just after the moving time's next whole second, so the clock
            // in the notification and the page steps evenly.
            long wait = s.paused ? TICK_MS : TICK_MS - (s.elapsedMs % TICK_MS) + 15;
            if (tracking) {
                handler.postDelayed(this, wait);
            }
        }
    };

    /** Updates the notification (when {@code notify}) and, if it's in front, the page. */
    private ActivityTrack.Snapshot refresh(boolean notify) {
        ActivityTrack track = ActivityTrack.get(this);
        long now = System.currentTimeMillis();
        ActivityTrack.Snapshot s = track.snapshot(now);
        if (notify && foreground && s.active) {
            try {
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm != null) {
                    nm.notify(NOTIFICATION_ID, build(s, now));
                    notifiedAt = now;
                }
            } catch (Throwable ignored) {
            }
        }
        MainActivity page = MainActivity.inFront();
        if (page != null) {
            page.callJs(MainActivity.jsCall("onActivity", track.stateJson(now, gpsState())));
        }
        return s;
    }

    /** The voice's engine, started (ahead of the first split) or shut down. Main thread. */
    void voiceOn(boolean on) {
        if (on) {
            if (voice == null) {
                voice = new ActivityVoice(this);
            }
            voice.open();
        } else if (voice != null) {
            voice.close();
            voice = null;
        }
    }

    private boolean interactive() {
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            return pm == null || pm.isInteractive();
        } catch (Throwable t) {
            return true;
        }
    }

    String gpsState() {
        if (!tracking || locationListener == null || !providerOn) {
            return "off";
        }
        long good = ActivityTrack.get(this).lastGoodFixAt();
        return good > 0 && System.currentTimeMillis() - good <= FRESH_FIX_MS ? "ok" : "searching";
    }

    // ---------------------------------------------------------------- the notification

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null || nm.getNotificationChannel(CHANNEL) != null) {
                return;
            }
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Activity tracking",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Time and distance while you record a run, walk, hike or ride");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(channel);
        } catch (Throwable ignored) {
        }
    }

    /** "Run · 12:34 · 2.14 km", then what's happening: paused, finding GPS, or the average pace. */
    private Notification build(ActivityTrack.Snapshot s, long now) {
        String title = label(s.type) + " · " + clock(s.elapsedMs) + " · " + distance(s.distanceM, s.units);
        String text;
        if (s.paused) {
            text = s.autoPaused ? "Auto-paused · goes on when you do" : "Paused";
        } else if (tracking && (locationListener == null || !providerOn)) {
            text = "Location is off";
        } else if (!"ok".equals(gpsState())) {
            text = "Finding GPS signal";
        } else {
            text = detail(s);
        }
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setColor(BRAND)
                .setCategory(Notification.CATEGORY_WORKOUT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openIntent);
        b.addAction(s.paused ? resumeAction : pauseAction);
        b.addAction(finishAction);
        if (Build.VERSION.SDK_INT >= 31) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }

    /** After Finish in the notification: a quiet note that opens the summary. */
    private void postFinished(ActivityTrack.Snapshot s) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) {
                return;
            }
            Notification n = new Notification.Builder(this, CHANNEL)
                    .setSmallIcon(smallIcon)
                    .setContentTitle(label(s.type) + " finished · " + clock(s.elapsedMs) + " · " + distance(s.distanceM, s.units))
                    .setContentText("Tap to see your summary")
                    .setAutoCancel(true)
                    .setColor(BRAND)
                    .setCategory(Notification.CATEGORY_WORKOUT)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .setContentIntent(openIntent)
                    .build();
            nm.notify(FINISHED_NOTIFICATION_ID, n);
        } catch (Throwable ignored) {
        }
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class)
                .setAction(MainActivity.ACTION_OPEN_ACTIVITY)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(String title, String act, String iconName) {
        Intent intent = new Intent(this, ActivityService.class).setAction(act);
        PendingIntent pi = PendingIntent.getService(this, act.hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        int res = drawable(iconName);
        return new Notification.Action.Builder(res != 0 ? Icon.createWithResource(this, res) : null, title, pi).build();
    }

    /** A drawable's id by name (the build doesn't generate an R class). */
    private int drawable(String name) {
        try {
            int id = getResources().getIdentifier(name, "drawable", getPackageName());
            return id != 0 ? id : getApplicationInfo().icon;
        } catch (Throwable t) {
            return getApplicationInfo().icon;
        }
    }

    static String label(String type) {
        if ("walk".equals(type)) {
            return "Walk";
        }
        if ("run".equals(type)) {
            return "Run";
        }
        if ("hike".equals(type)) {
            return "Hike";
        }
        if ("cycle".equals(type)) {
            return "Ride";
        }
        return "Activity";
    }

    /** 12:34, or 1:02:03 from an hour. */
    static String clock(long ms) {
        long s = Math.max(0L, ms / 1000L);
        long h = s / 3600L;
        long m = (s % 3600L) / 60L;
        long sec = s % 60L;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    /** 2.14 km or 1.33 mi (one decimal from 100). */
    static String distance(double meters, String units) {
        boolean miles = "mi".equals(units);
        double v = Math.max(0, meters) / (miles ? METERS_PER_MILE : 1000.0);
        return String.format(Locale.US, v >= 100 ? "%.1f %s" : "%.2f %s", v, miles ? "mi" : "km");
    }

    /** "Avg pace 5:42 /km" (or "Avg 18.2 km/h" on a ride), and the steps when they're counted. */
    static String detail(ActivityTrack.Snapshot s) {
        StringBuilder sb = new StringBuilder();
        boolean miles = "mi".equals(s.units);
        double units = s.distanceM / (miles ? METERS_PER_MILE : 1000.0);
        double seconds = s.elapsedMs / 1000.0;
        if (s.distanceM >= 50 && seconds > 0) {
            if ("cycle".equals(s.type)) {
                sb.append(String.format(Locale.US, "Avg %.1f %s", units / (seconds / 3600.0), miles ? "mph" : "km/h"));
            } else {
                long pace = Math.round(seconds / units);
                if (pace < 100 * 60) {
                    sb.append(String.format(Locale.US, "Avg pace %d:%02d /%s", pace / 60, pace % 60, miles ? "mi" : "km"));
                }
            }
        }
        if (s.steps >= 0) {
            if (sb.length() > 0) {
                sb.append(" · ");
            }
            sb.append(String.format(Locale.US, "%,d steps", s.steps));
        }
        return sb.length() > 0 ? sb.toString() : "Recording";
    }

    /** API 31+ calls, isolated so older phones never load LocationRequest.Builder. */
    private static final class Api31 {
        /**
         * Updates from {@code provider} every {@code everyMs}, delivered on {@code handler}: at high
         * accuracy (the GPS), or balanced power (a rough position from the fused provider).
         */
        static void request(LocationManager lm, String provider, long everyMs, boolean precise, final Handler handler,
                LocationListener listener) {
            android.location.LocationRequest request = new android.location.LocationRequest.Builder(everyMs)
                    .setQuality(precise ? android.location.LocationRequest.QUALITY_HIGH_ACCURACY
                            : android.location.LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                    .setMinUpdateIntervalMillis(everyMs)
                    .setMinUpdateDistanceMeters(0f)
                    .setMaxUpdateDelayMillis(0L)
                    .build();
            lm.requestLocationUpdates(provider, request, new java.util.concurrent.Executor() {
                @Override
                public void execute(Runnable r) {
                    handler.post(r);
                }
            }, listener);
        }
    }
}
