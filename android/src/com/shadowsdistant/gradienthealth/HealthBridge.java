package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsGroupedByDurationResponse;
import android.health.connect.AggregateRecordsGroupedByPeriodResponse;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.AggregateRecordsResponse;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.InsertRecordsResponse;
import android.health.connect.LocalTimeRangeFilter;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.RecordIdFilter;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.ActiveCaloriesBurnedRecord;
import android.health.connect.datatypes.AggregationType;
import android.health.connect.datatypes.BodyFatRecord;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.Device;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseRoute;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.HeartRateVariabilityRmssdRecord;
import android.health.connect.datatypes.HeightRecord;
import android.health.connect.datatypes.Metadata;
import android.health.connect.datatypes.NutritionRecord;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.RestingHeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.TotalCaloriesBurnedRecord;
import android.health.connect.datatypes.WeightRecord;
import android.health.connect.datatypes.units.Energy;
import android.health.connect.datatypes.units.Length;
import android.health.connect.datatypes.units.Mass;
import android.os.OutcomeReceiver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Health Connect through the Android 14 platform API (android.health.connect).
 *
 * ONLY call into this class after checking Build.VERSION.SDK_INT >= 34: it and its inner classes
 * reference types (HealthConnectManager, OutcomeReceiver, record classes) that older devices
 * don't have. {@link Bridge}, {@link MainActivity}, {@link HealthSync} and {@link HealthSyncJob}
 * do that check.
 *
 * Reads answer through a {@link Callback}: the page's (window.__gh.onHealth, onHcSession...) or the
 * background sync's, which saves the same JSON to a file (see HealthSync).
 */
final class HealthBridge {
    private HealthBridge() {
    }

    /** Where an answer goes. Called once, on the Health Connect thread. */
    interface Callback {
        void done(String json);
    }

    /** A callback that hands the JSON to window.__gh.{@code hook} in the page. */
    static Callback page(final MainActivity activity, final String hook) {
        return new Callback() {
            @Override
            public void done(String json) {
                activity.callJs(MainActivity.jsCall(hook, json));
            }
        };
    }

    // Data types: index = type id, {key in the onHealth JSON, read permission}.
    private static final int STEPS = 0;
    private static final int SLEEP = 1;
    private static final int WEIGHT = 2;
    private static final int HEIGHT = 3;
    private static final int BODY_FAT = 4;
    private static final int RESTING_HR = 5;
    private static final int HRV = 6;
    private static final int EXERCISE = 7;
    // Added in 1.2, optional: they don't count toward the connection status.
    private static final int HEART_RATE = 8;
    private static final int ACTIVE_KCAL = 9;
    private static final int DISTANCE = 10;
    private static final int NUTRITION = 11;
    private static final int CORE_TYPES = 8;
    private static final String[][] TYPES = {
            {"steps", "android.permission.health.READ_STEPS"},
            {"sleep", "android.permission.health.READ_SLEEP"},
            {"weight", "android.permission.health.READ_WEIGHT"},
            {"height", "android.permission.health.READ_HEIGHT"},
            {"bodyFat", "android.permission.health.READ_BODY_FAT"},
            {"restingHr", "android.permission.health.READ_RESTING_HEART_RATE"},
            {"hrv", "android.permission.health.READ_HEART_RATE_VARIABILITY"},
            {"exercise", "android.permission.health.READ_EXERCISE"},
            {"heartRate", "android.permission.health.READ_HEART_RATE"},
            {"activeKcal", "android.permission.health.READ_ACTIVE_CALORIES_BURNED"},
            {"distance", "android.permission.health.READ_DISTANCE"},
            {"nutrition", "android.permission.health.READ_NUTRITION"},
    };
    /** Heart rate is read as 30-minute averages, for at most this many days back. */
    private static final int HEART_RATE_DAYS = 30;

    private static final int MIN_DAYS = 1;
    private static final int MAX_DAYS = 90;
    private static final int PAGE_SIZE = 1000;
    private static final int MAX_PAGES = 10; // per type
    private static final long TIMEOUT_SECONDS = 20;

    /** Index = android.health.connect.datatypes.ExerciseSessionType value (API 34: 0..61). */
    private static final String[] EXERCISE_NAMES = {
            "unknown", "badminton", "baseball", "basketball", "biking", "biking_stationary",
            "boot_camp", "boxing", "calisthenics", "cricket", "dancing", "exercise_class", "fencing",
            "football_american", "football_australian", "frisbee_disc", "golf", "guided_breathing",
            "gymnastics", "handball", "high_intensity_interval_training", "hiking", "ice_hockey",
            "ice_skating", "martial_arts", "paddling", "paragliding", "pilates", "racquetball",
            "rock_climbing", "roller_hockey", "rowing", "rugby", "running", "running_treadmill",
            "sailing", "scuba_diving", "skating", "skiing", "snowboarding", "snowshoeing", "soccer",
            "softball", "squash", "stair_climbing", "strength_training", "stretching", "surfing",
            "swimming_open_water", "swimming_pool", "table_tennis", "tennis", "volleyball", "walking",
            "water_polo", "weightlifting", "wheelchair", "yoga", "other_workout",
            "stair_climbing_machine", "elliptical", "rowing_machine",
    };

    /** Lets the app save its own workouts to Health Connect (optional, like every permission here). */
    static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    /** Lets the app save the meals logged in it (calorie tracking). */
    static final String WRITE_NUTRITION = "android.permission.health.WRITE_NUTRITION";
    // For recorded activities (runs, walks...): total calories for the summary, and saving the
    // activity with its route, distance and active calories (the last two only without a watch).
    static final String READ_TOTAL_CALORIES = "android.permission.health.READ_TOTAL_CALORIES_BURNED";
    static final String WRITE_ROUTE = "android.permission.health.WRITE_EXERCISE_ROUTE";
    static final String WRITE_DISTANCE = "android.permission.health.WRITE_DISTANCE";
    static final String WRITE_ACTIVE_CALORIES = "android.permission.health.WRITE_ACTIVE_CALORIES_BURNED";
    private static final String[][] EXTRA = {
            {"writeExercise", WRITE_EXERCISE},
            {"writeNutrition", WRITE_NUTRITION},
            {"totalKcal", READ_TOTAL_CALORIES},
            {"writeRoute", WRITE_ROUTE},
            {"writeDistance", WRITE_DISTANCE},
            {"writeActiveKcal", WRITE_ACTIVE_CALORIES},
    };

    private static ScheduledExecutorService executor;

    /**
     * Every read permission, the writes, and reading in the background where this phone's Health
     * Connect has it (see {@link HealthSync#supported}), for Activity.requestPermissions.
     */
    static String[] permissions(Context context) {
        List<String> out = new ArrayList<String>();
        for (String[] type : TYPES) {
            out.add(type[1]);
        }
        for (String[] extra : EXTRA) {
            out.add(extra[1]);
        }
        if (HealthSync.supported(context)) {
            out.add(HealthSync.PERMISSION);
        }
        return out.toArray(new String[0]);
    }

    /** True when Health Connect is there to talk to. */
    static boolean available(Context context) {
        try {
            return context.getSystemService(HealthConnectManager.class) != null;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * The data types this app may read or write right now, e.g. ["steps", "heartRate", "writeNutrition",
     * "writeRoute", "background"].
     */
    static String granted(Context context) {
        JSONArray out = new JSONArray();
        for (String[] type : TYPES) {
            if (isGranted(context, type[1])) {
                out.put(type[0]);
            }
        }
        for (String[] extra : EXTRA) {
            if (isGranted(context, extra[1])) {
                out.put(extra[0]);
            }
        }
        if (isGranted(context, HealthSync.PERMISSION)) {
            out.put("background");
        }
        return out.toString();
    }

    static boolean canWriteNutrition(Context context) {
        return isGranted(context, WRITE_NUTRITION);
    }

    /**
     * The permissions from {@link #permissions} that aren't granted yet. The nutrition ones are
     * only asked for when food tracking is on, so people who just work out never see them.
     */
    static String[] missingPermissions(Context context, boolean withFood) {
        List<String> missing = new ArrayList<String>();
        for (String permission : permissions(context)) {
            boolean food = permission.endsWith("_NUTRITION");
            if ((withFood || !food) && !isGranted(context, permission)) {
                missing.add(permission);
            }
        }
        return missing.toArray(new String[0]);
    }

    static boolean canWriteExercise(Context context) {
        return isGranted(context, WRITE_EXERCISE);
    }

    /**
     * "unavailable" | "denied" | "partial" | "granted" (the caller handles "unsupported"). Only the
     * read permissions count; see {@link #canWriteExercise} for writing.
     */
    static String status(Context context) {
        try {
            if (context.getSystemService(HealthConnectManager.class) == null) {
                return "unavailable";
            }
        } catch (Throwable t) {
            return "unavailable";
        }
        int granted = 0;
        for (int i = 0; i < CORE_TYPES; i++) {
            if (isGranted(context, TYPES[i][1])) {
                granted++;
            }
        }
        if (granted == CORE_TYPES) {
            return "granted";
        }
        if (granted > 0) {
            return "partial";
        }
        // None of the original types, but maybe some of the newer ones (heart rate, calories...).
        for (int i = CORE_TYPES; i < TYPES.length; i++) {
            if (isGranted(context, TYPES[i][1])) {
                return "partial";
            }
        }
        return "denied";
    }

    /** Starts an asynchronous read; the result is delivered to window.__gh.onHealth. */
    static void read(final MainActivity activity, int days) {
        read(activity, days, page(activity, "onHealth"));
    }

    /**
     * The same read for anyone: {@code callback} gets the JSON window.__gh.onHealth would, once. The
     * background sync uses it with no page around.
     */
    static void read(final Context context, int days, final Callback callback) {
        final int span = Math.max(MIN_DAYS, Math.min(MAX_DAYS, days));
        executor().execute(new Runnable() {
            @Override
            public void run() {
                ReadJob job = new ReadJob(context, span, callback);
                try {
                    job.start();
                } catch (Throwable t) {
                    job.deliverFailure(describe(t)); // no-op if it already answered
                }
            }
        });
    }

    /**
     * Saves one finished workout as an exercise session and answers once with
     * window.__gh.onHealthWrite({id, ok, error?}). {@code json} is
     * {id, start, end (epoch ms), type (an EXERCISE_NAMES entry), title, notes?}. The id becomes the
     * record's clientRecordId, so saving the same workout again updates it instead of adding a copy.
     */
    static void writeWorkout(final MainActivity activity, final String json) {
        executor().execute(new Runnable() {
            @Override
            public void run() {
                String id = "";
                try {
                    JSONObject in = new JSONObject(json == null ? "{}" : json);
                    id = in.optString("id", "");
                    final String clientId = id;
                    if (clientId.isEmpty()) {
                        writeResult(activity, clientId, "no id");
                        return;
                    }
                    if (!canWriteExercise(activity)) {
                        writeResult(activity, clientId, "not granted");
                        return;
                    }
                    HealthConnectManager manager = activity.getSystemService(HealthConnectManager.class);
                    if (manager == null) {
                        writeResult(activity, clientId, "unavailable");
                        return;
                    }
                    Instant start = Instant.ofEpochMilli(in.getLong("start"));
                    Instant end = Instant.ofEpochMilli(in.getLong("end"));
                    if (!end.isAfter(start)) {
                        writeResult(activity, clientId, "bad times");
                        return;
                    }
                    Metadata metadata = new Metadata.Builder()
                            .setClientRecordId(clientId)
                            .setClientRecordVersion(in.optLong("version", 1L))
                            .setRecordingMethod(Metadata.RECORDING_METHOD_ACTIVELY_RECORDED)
                            .setDevice(new Device.Builder().setType(Device.DEVICE_TYPE_PHONE).build())
                            .build();
                    ZoneId zone = ZoneId.systemDefault();
                    ZoneOffset startOffset = zone.getRules().getOffset(start);
                    ZoneOffset endOffset = zone.getRules().getOffset(end);
                    ExerciseSessionRecord.Builder builder = new ExerciseSessionRecord.Builder(
                            metadata, start, end, exerciseType(in.optString("type", "")))
                            .setStartZoneOffset(startOffset)
                            .setEndZoneOffset(endOffset);
                    String title = in.optString("title", "");
                    if (!title.isEmpty()) {
                        builder.setTitle(title);
                    }
                    String notes = in.optString("notes", "");
                    if (!notes.isEmpty()) {
                        builder.setNotes(notes);
                    }
                    List<Record> records = new ArrayList<Record>();
                    records.add(builder.build());
                    manager.insertRecords(records, executor(),
                            new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                                @Override
                                public void onResult(InsertRecordsResponse response) {
                                    writeResult(activity, clientId, null);
                                }

                                @Override
                                public void onError(HealthConnectException e) {
                                    writeResult(activity, clientId, describe(e));
                                }
                            });
                } catch (Throwable t) {
                    writeResult(activity, id, describe(t));
                }
            }
        });
    }

    private static void writeResult(MainActivity activity, String id, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id == null ? "" : id);
            o.put("ok", error == null);
            if (error != null) {
                o.put("error", error);
            }
            activity.callJs(MainActivity.jsCall("onHealthWrite", o.toString()));
        } catch (Throwable ignored) {
        }
    }

    /**
     * Saves meals logged in the app as nutrition records and answers once with
     * window.__gh.onFoodWrite({ok, ids, error?}). {@code json} is a list of
     * {id, v, start, end (epoch ms), meal, name, kcal, p, c, f, fib}. The id is the record's
     * clientRecordId and v its version, so an edited entry replaces its earlier copy.
     */
    static void writeNutrition(final MainActivity activity, final String json) {
        executor().execute(new Runnable() {
            @Override
            public void run() {
                final JSONArray ids = new JSONArray();
                try {
                    JSONArray in = new JSONArray(json == null ? "[]" : json);
                    if (!canWriteNutrition(activity)) {
                        foodResult(activity, "onFoodWrite", ids, "not granted");
                        return;
                    }
                    HealthConnectManager manager = activity.getSystemService(HealthConnectManager.class);
                    if (manager == null) {
                        foodResult(activity, "onFoodWrite", ids, "unavailable");
                        return;
                    }
                    ZoneId zone = ZoneId.systemDefault();
                    List<Record> records = new ArrayList<Record>();
                    // Records Health Connect would refuse are reported back one by one, so one bad
                    // entry never holds up the rest.
                    final JSONArray failed = new JSONArray();
                    long now = System.currentTimeMillis();
                    for (int i = 0; i < in.length() && i < 200; i++) {
                        JSONObject e = in.getJSONObject(i);
                        String id = e.optString("id", "");
                        if (id.isEmpty()) {
                            continue;
                        }
                        try {
                            // Never in the future (Health Connect rejects that), at least a second long.
                            long startMs = Math.min(e.getLong("start"), now - 60000L);
                            long endMs = Math.min(Math.max(e.optLong("end", startMs), startMs + 1000L), now);
                            Instant start = Instant.ofEpochMilli(startMs);
                            Instant end = Instant.ofEpochMilli(Math.max(endMs, startMs + 1000L));
                            Metadata metadata = new Metadata.Builder()
                                    .setClientRecordId(id)
                                    .setClientRecordVersion(e.optLong("v", 0L) + 1L)
                                    .setRecordingMethod(Metadata.RECORDING_METHOD_MANUAL_ENTRY)
                                    .build();
                            NutritionRecord.Builder b = new NutritionRecord.Builder(metadata, start, end)
                                    .setStartZoneOffset(zone.getRules().getOffset(start))
                                    .setEndZoneOffset(zone.getRules().getOffset(end))
                                    .setMealType(mealType(e.optString("meal", "")))
                                    // Energy is in small calories: 1 kcal = 1000 cal.
                                    .setEnergy(Energy.fromCalories(clamp(e.optDouble("kcal", 0), MAX_KCAL) * 1000.0))
                                    .setProtein(Mass.fromGrams(clamp(e.optDouble("p", 0), MAX_GRAMS)))
                                    .setTotalCarbohydrate(Mass.fromGrams(clamp(e.optDouble("c", 0), MAX_GRAMS)))
                                    .setTotalFat(Mass.fromGrams(clamp(e.optDouble("f", 0), MAX_GRAMS)));
                            double fib = clamp(e.optDouble("fib", 0), MAX_GRAMS);
                            if (fib > 0) {
                                b.setDietaryFiber(Mass.fromGrams(fib));
                            }
                            String name = e.optString("name", "");
                            if (!name.isEmpty()) {
                                b.setMealName(name.length() > 100 ? name.substring(0, 100) : name);
                            }
                            records.add(b.build());
                            ids.put(id);
                        } catch (Throwable t) {
                            failed.put(id);
                        }
                    }
                    if (records.isEmpty()) {
                        foodResult(activity, "onFoodWrite", ids, failed, null);
                        return;
                    }
                    manager.insertRecords(records, executor(),
                            new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                                @Override
                                public void onResult(InsertRecordsResponse response) {
                                    foodResult(activity, "onFoodWrite", ids, failed, null);
                                }

                                @Override
                                public void onError(HealthConnectException e) {
                                    foodResult(activity, "onFoodWrite", ids, failed, describe(e));
                                }
                            });
                } catch (Throwable t) {
                    foodResult(activity, "onFoodWrite", ids, describe(t));
                }
            }
        });
    }

    /** Deletes this app's nutrition records by client id; answers with onFoodDelete({ok, ids}). */
    static void deleteNutrition(final MainActivity activity, final String json) {
        executor().execute(new Runnable() {
            @Override
            public void run() {
                final JSONArray ids = new JSONArray();
                try {
                    JSONArray in = new JSONArray(json == null ? "[]" : json);
                    HealthConnectManager manager = activity.getSystemService(HealthConnectManager.class);
                    if (manager == null || !canWriteNutrition(activity)) {
                        foodResult(activity, "onFoodDelete", ids, "not granted");
                        return;
                    }
                    List<RecordIdFilter> filters = new ArrayList<RecordIdFilter>();
                    for (int i = 0; i < in.length() && i < 200; i++) {
                        String id = in.optString(i, "");
                        if (!id.isEmpty()) {
                            filters.add(RecordIdFilter.fromClientRecordId(NutritionRecord.class, id));
                            ids.put(id);
                        }
                    }
                    if (filters.isEmpty()) {
                        foodResult(activity, "onFoodDelete", ids, null);
                        return;
                    }
                    manager.deleteRecords(filters, executor(), new OutcomeReceiver<Void, HealthConnectException>() {
                        @Override
                        public void onResult(Void v) {
                            foodResult(activity, "onFoodDelete", ids, null);
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            foodResult(activity, "onFoodDelete", ids, describe(e));
                        }
                    });
                } catch (Throwable t) {
                    foodResult(activity, "onFoodDelete", ids, describe(t));
                }
            }
        });
    }

    // ---------------------------------------------------------------- recorded activities

    private static final String ACTIVITY_ID_PREFIX = "gradient-activity-";
    /** A route this long is a point a second for five and a half hours; longer ones are thinned. */
    private static final int MAX_ROUTE_POINTS = 20000;
    private static final double MAX_ACTIVITY_DISTANCE_M = 1000000.0; // Health Connect's limit
    private static final double MAX_ACTIVITY_KCAL = 20000.0;
    private static final int MAX_HR_SAMPLES = 50000;

    /**
     * Saves an activity recorded in the app (a run, walk, hike or ride) as an exercise session, with
     * its route when the route permission is granted, plus a distance and an active-calories record
     * when the page passes them (it only does when no watch recorded them). {@code json} is
     * {id, type (walk, run, hike, cycle, other), title, start, end (epoch ms), distanceM|null,
     * activeKcal|null, route: [[t, lat, lon, alt|null], ...]}. The record ids come from the id, so
     * saving again updates the records instead of adding copies, and a distance or calorie record from
     * an earlier save is deleted when a later save leaves it out (a watch's data arrived since).
     * Answers once with {id, ok, error?, route, distance, activeKcal}: the last three say what was written.
     */
    static void writeActivity(final Context context, final String json, final Callback callback) {
        executor().execute(new Runnable() {
            @Override
            public void run() {
                String id = "";
                try {
                    JSONObject in = new JSONObject(json == null ? "{}" : json);
                    id = in.optString("id", "");
                    if (id.isEmpty() || id.length() > 200) {
                        activityResult(callback, id, "no id", false, false, false);
                        return;
                    }
                    if (!isGranted(context, WRITE_EXERCISE)) {
                        activityResult(callback, id, "not granted", false, false, false);
                        return;
                    }
                    final HealthConnectManager manager = context.getSystemService(HealthConnectManager.class);
                    if (manager == null) {
                        activityResult(callback, id, "unavailable", false, false, false);
                        return;
                    }
                    long now = System.currentTimeMillis();
                    long startMs = in.optLong("start", 0L);
                    long endMs = Math.min(in.optLong("end", 0L), now); // never in the future
                    if (startMs <= 0L || endMs <= startMs) {
                        activityResult(callback, id, "bad times", false, false, false);
                        return;
                    }
                    Instant start = Instant.ofEpochMilli(startMs);
                    Instant end = Instant.ofEpochMilli(endMs);
                    ZoneId zone = ZoneId.systemDefault();
                    ZoneOffset startOffset = zone.getRules().getOffset(start);
                    ZoneOffset endOffset = zone.getRules().getOffset(end);
                    String base = ACTIVITY_ID_PREFIX + id;

                    ExerciseSessionRecord.Builder session = new ExerciseSessionRecord.Builder(
                            activityMetadata(base, now), start, end, activityType(in.optString("type", "")))
                            .setStartZoneOffset(startOffset)
                            .setEndZoneOffset(endOffset);
                    String title = in.optString("title", "").trim();
                    if (!title.isEmpty()) {
                        session.setTitle(title.length() > 100 ? title.substring(0, 100) : title);
                    }
                    boolean withRoute = false;
                    if (isGranted(context, WRITE_ROUTE)) {
                        ExerciseRoute route = route(in.optJSONArray("route"), startMs, endMs);
                        if (route != null) {
                            session.setRoute(route);
                            withRoute = true;
                        }
                    }
                    List<Record> records = new ArrayList<Record>();
                    records.add(session.build());

                    final List<RecordIdFilter> stale = new ArrayList<RecordIdFilter>();
                    double distance = number(in, "distanceM");
                    boolean canDistance = isGranted(context, WRITE_DISTANCE);
                    final boolean withDistance = canDistance && distance > 0;
                    if (withDistance) {
                        records.add(new DistanceRecord.Builder(activityMetadata(base + "-distance", now), start, end,
                                Length.fromMeters(Math.min(distance, MAX_ACTIVITY_DISTANCE_M)))
                                .setStartZoneOffset(startOffset).setEndZoneOffset(endOffset).build());
                    } else if (canDistance) {
                        stale.add(RecordIdFilter.fromClientRecordId(DistanceRecord.class, base + "-distance"));
                    }
                    double kcal = number(in, "activeKcal");
                    boolean canKcal = isGranted(context, WRITE_ACTIVE_CALORIES);
                    final boolean withKcal = canKcal && kcal > 0;
                    if (withKcal) {
                        // Energy is in small calories: 1 kcal = 1000 cal.
                        records.add(new ActiveCaloriesBurnedRecord.Builder(activityMetadata(base + "-kcal", now), start, end,
                                Energy.fromCalories(Math.min(kcal, MAX_ACTIVITY_KCAL) * 1000.0))
                                .setStartZoneOffset(startOffset).setEndZoneOffset(endOffset).build());
                    } else if (canKcal) {
                        stale.add(RecordIdFilter.fromClientRecordId(ActiveCaloriesBurnedRecord.class, base + "-kcal"));
                    }

                    final String clientId = id;
                    final boolean routeWritten = withRoute;
                    manager.insertRecords(records, executor(),
                            new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                                @Override
                                public void onResult(InsertRecordsResponse response) {
                                    if (stale.isEmpty()) {
                                        activityResult(callback, clientId, null, routeWritten, withDistance, withKcal);
                                        return;
                                    }
                                    // Usually there's nothing to delete; either way the save worked.
                                    try {
                                        manager.deleteRecords(stale, executor(), new OutcomeReceiver<Void, HealthConnectException>() {
                                            @Override
                                            public void onResult(Void v) {
                                                activityResult(callback, clientId, null, routeWritten, withDistance, withKcal);
                                            }

                                            @Override
                                            public void onError(HealthConnectException e) {
                                                activityResult(callback, clientId, null, routeWritten, withDistance, withKcal);
                                            }
                                        });
                                    } catch (Throwable t) {
                                        activityResult(callback, clientId, null, routeWritten, withDistance, withKcal);
                                    }
                                }

                                @Override
                                public void onError(HealthConnectException e) {
                                    activityResult(callback, clientId, describe(e), false, false, false);
                                }
                            });
                } catch (Throwable t) {
                    activityResult(callback, id, describe(t), false, false, false);
                }
            }
        });
    }

    private static void activityResult(Callback callback, String id, String error, boolean route,
                                       boolean distance, boolean kcal) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id == null ? "" : id);
            o.put("ok", error == null);
            if (error != null) {
                o.put("error", error);
            }
            o.put("route", route);
            o.put("distance", distance);
            o.put("activeKcal", kcal);
            callback.done(o.toString());
        } catch (Throwable ignored) {
        }
    }

    /** Actively recorded on this phone, with a client id and a version that grows with every save. */
    private static Metadata activityMetadata(String clientId, long version) {
        return new Metadata.Builder()
                .setClientRecordId(clientId)
                .setClientRecordVersion(version)
                .setRecordingMethod(Metadata.RECORDING_METHOD_ACTIVELY_RECORDED)
                .setDevice(new Device.Builder().setType(Device.DEVICE_TYPE_PHONE).build())
                .build();
    }

    /** walk, run, hike, cycle → Health Connect's type; its own names work too; anything else is "other". */
    static int activityType(String type) {
        if ("run".equals(type)) {
            return ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING;
        }
        if ("walk".equals(type)) {
            return ExerciseSessionType.EXERCISE_SESSION_TYPE_WALKING;
        }
        if ("hike".equals(type)) {
            return ExerciseSessionType.EXERCISE_SESSION_TYPE_HIKING;
        }
        if ("cycle".equals(type)) {
            return ExerciseSessionType.EXERCISE_SESSION_TYPE_BIKING;
        }
        return exerciseType(type);
    }

    /** A number field, or NaN when it's missing, null or not a finite number. */
    private static double number(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) {
            return Double.NaN;
        }
        double v = o.optDouble(key, Double.NaN);
        return Double.isInfinite(v) ? Double.NaN : v;
    }

    /**
     * The route Health Connect gets: points inside the session, in time order, one per millisecond,
     * at most MAX_ROUTE_POINTS (evenly thinned, keeping the ends). Null when none are usable.
     */
    private static ExerciseRoute route(JSONArray in, long startMs, long endMs) {
        if (in == null || in.length() == 0) {
            return null;
        }
        List<double[]> points = new ArrayList<double[]>();
        for (int i = 0; i < in.length(); i++) {
            JSONArray p = in.optJSONArray(i);
            if (p == null || p.length() < 3) {
                continue;
            }
            double t = p.optDouble(0, Double.NaN);
            double lat = p.optDouble(1, Double.NaN);
            double lon = p.optDouble(2, Double.NaN);
            double alt = p.length() > 3 && !p.isNull(3) ? p.optDouble(3, Double.NaN) : Double.NaN;
            if (!(t >= startMs && t <= endMs) || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
                continue;
            }
            points.add(new double[]{Math.floor(t), lat, lon, alt});
        }
        Collections.sort(points, new Comparator<double[]>() {
            @Override
            public int compare(double[] a, double[] b) {
                return Double.compare(a[0], b[0]);
            }
        });
        List<double[]> unique = new ArrayList<double[]>();
        for (double[] p : points) {
            if (unique.isEmpty() || unique.get(unique.size() - 1)[0] < p[0]) {
                unique.add(p);
            }
        }
        if (unique.size() > MAX_ROUTE_POINTS) {
            List<double[]> thin = new ArrayList<double[]>();
            double step = (unique.size() - 1) / (double) (MAX_ROUTE_POINTS - 1);
            for (int i = 0; i < MAX_ROUTE_POINTS; i++) {
                thin.add(unique.get((int) Math.round(i * step)));
            }
            unique = thin;
        }
        List<ExerciseRoute.Location> locations = new ArrayList<ExerciseRoute.Location>();
        for (double[] p : unique) {
            try {
                ExerciseRoute.Location.Builder b = new ExerciseRoute.Location.Builder(
                        Instant.ofEpochMilli((long) p[0]), p[1], p[2]);
                if (p[3] >= -1000 && p[3] <= 10000) {
                    b.setAltitude(Length.fromMeters(p[3]));
                }
                locations.add(b.build());
            } catch (Throwable ignored) {
                // A point Health Connect won't take is left out.
            }
        }
        return locations.isEmpty() ? null : new ExerciseRoute(locations);
    }

    /**
     * What Health Connect has for one activity's time window, for its summary: steps, distance, and
     * active and total calories from other apps and watches (this app's own records are left out, so
     * an activity it saved doesn't count itself), every heart rate sample in the window, and the apps
     * that wrote them (their names when Android shows them, else package names). {@code json} is
     * {id, start, end} (epoch ms). Answers once with {id, ok, error?, steps, distanceM, activeKcal,
     * totalKcal, hr: [[t, bpm], ...], sources, errors}; a value is null when nothing recorded it or it
     * isn't allowed, and errors says which reads failed or weren't allowed.
     */
    static void session(final Context context, final String json, final Callback callback) {
        executor().execute(new Runnable() {
            @Override
            public void run() {
                String id = "";
                long start = 0L;
                long end = 0L;
                try {
                    JSONObject in = new JSONObject(json == null ? "{}" : json);
                    id = in.optString("id", "");
                    start = in.optLong("start", 0L);
                    end = in.optLong("end", 0L);
                } catch (Throwable ignored) {
                    // Answered below as bad input.
                }
                SessionJob job = new SessionJob(context, id, start, end, callback);
                try {
                    job.start();
                } catch (Throwable t) {
                    job.fail(describe(t)); // no-op if it already answered
                }
            }
        });
    }

    /** An app's name as the phone shows it, or its package name. */
    @SuppressWarnings("deprecation") // getApplicationInfo(String, int): the flags overload is API 33+
    static String appName(Context context, String pkg) {
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(info);
            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Throwable ignored) {
            // Not installed, or not visible to this app.
        }
        return pkg;
    }

    private static double round(double v, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(v * scale) / scale;
    }

    /** One hcSession() call. All methods run on the executor() thread. */
    private static final class SessionJob {
        private final Context context;
        private final String id;
        private final long startMs;
        private final long endMs;
        private final Callback callback;
        private final ScheduledExecutorService exec = executor();
        private final Map<String, Object> values = new HashMap<String, Object>();
        private final JSONObject errors = new JSONObject();
        private final Set<String> origins = new LinkedHashSet<String>();
        private final List<long[]> hr = new ArrayList<long[]>();
        // Reads still out, plus "start" until every read has been launched.
        private final Set<String> running = new LinkedHashSet<String>();
        private boolean delivered;
        private ScheduledFuture<?> timeout;
        private HealthConnectManager manager;
        private TimeInstantRangeFilter range;

        SessionJob(Context context, String id, long startMs, long endMs, Callback callback) {
            this.context = context;
            this.id = id == null ? "" : id;
            this.startMs = startMs;
            this.endMs = endMs;
            this.callback = callback;
        }

        void start() {
            try {
                manager = context.getSystemService(HealthConnectManager.class);
            } catch (Throwable t) {
                manager = null;
            }
            if (manager == null) {
                fail("unavailable");
                return;
            }
            if (id.isEmpty() || startMs <= 0L || endMs <= startMs) {
                fail("bad input");
                return;
            }
            range = new TimeInstantRangeFilter.Builder()
                    .setStartTime(Instant.ofEpochMilli(startMs))
                    .setEndTime(Instant.ofEpochMilli(endMs))
                    .build();
            timeout = exec.schedule(new Runnable() {
                @Override
                public void run() {
                    deliver();
                }
            }, TIMEOUT_SECONDS, TimeUnit.SECONDS);
            running.add("start");
            aggregate("steps", TYPES[STEPS][1], StepsRecord.STEPS_COUNT_TOTAL);
            aggregate("distanceM", TYPES[DISTANCE][1], DistanceRecord.DISTANCE_TOTAL);
            aggregate("activeKcal", TYPES[ACTIVE_KCAL][1], ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL);
            aggregate("totalKcal", READ_TOTAL_CALORIES, TotalCaloriesBurnedRecord.ENERGY_TOTAL);
            if (isGranted(context, TYPES[HEART_RATE][1])) {
                running.add("hr");
                try {
                    readHeartRate(-1L, 0);
                } catch (Throwable t) {
                    finish("hr", t);
                }
            } else {
                putError("hr", "not granted");
            }
            finish("start", null);
        }

        private <T> void aggregate(String key, String permission, AggregationType<T> type) {
            if (!isGranted(context, permission)) {
                putError(key, "not granted");
                return;
            }
            running.add(key);
            try {
                aggregateFrom(key, type, null);
            } catch (Throwable t) {
                finish(key, t);
            }
        }

        /** Totals {@code type} from every app, or only from the packages in {@code only}. */
        private <T> void aggregateFrom(final String key, final AggregationType<T> type, final Set<String> only) {
            AggregateRecordsRequest.Builder<T> b = new AggregateRecordsRequest.Builder<T>(range).addAggregationType(type);
            if (only != null) {
                for (String pkg : only) {
                    b.addDataOriginsFilter(new DataOrigin.Builder().setPackageName(pkg).build());
                }
            }
            manager.aggregate(b.build(), exec,
                    new OutcomeReceiver<AggregateRecordsResponse<T>, HealthConnectException>() {
                        @Override
                        public void onResult(AggregateRecordsResponse<T> response) {
                            try {
                                Set<String> from = packages(response == null ? null : response.getDataOrigins(type));
                                if (from.remove(context.getPackageName()) && only == null) {
                                    // Part of it is this app's own saved activity: total the others only.
                                    if (!from.isEmpty() && !delivered) {
                                        aggregateFrom(key, type, from);
                                        return;
                                    }
                                    finish(key, null);
                                    return;
                                }
                                T value = response == null ? null : response.get(type);
                                if (value != null) {
                                    values.put(key, value);
                                    origins.addAll(from);
                                }
                                finish(key, null);
                            } catch (Throwable t) {
                                finish(key, t);
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish(key, e);
                        }
                    });
        }

        private void readHeartRate(long pageToken, final int page) {
            ReadRecordsRequestUsingFilters.Builder<HeartRateRecord> builder =
                    new ReadRecordsRequestUsingFilters.Builder<HeartRateRecord>(HeartRateRecord.class)
                            .setTimeRangeFilter(range)
                            .setPageSize(PAGE_SIZE);
            if (pageToken != -1L) {
                builder.setPageToken(pageToken);
            }
            manager.readRecords(builder.build(), exec,
                    new OutcomeReceiver<ReadRecordsResponse<HeartRateRecord>, HealthConnectException>() {
                        @Override
                        public void onResult(ReadRecordsResponse<HeartRateRecord> response) {
                            try {
                                List<HeartRateRecord> records = response == null ? null : response.getRecords();
                                if (records != null) {
                                    for (HeartRateRecord r : records) {
                                        addHeartRate(r);
                                    }
                                }
                                long next = response == null ? -1L : response.getNextPageToken();
                                if (next != -1L && !delivered && page + 1 < MAX_PAGES) {
                                    readHeartRate(next, page + 1);
                                    return;
                                }
                                finish("hr", null);
                            } catch (Throwable t) {
                                finish("hr", t); // keeps the pages that did arrive
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish("hr", e);
                        }
                    });
        }

        /** The record's samples inside the window (a record can start before it or end after it). */
        private void addHeartRate(HeartRateRecord r) {
            if (r == null || isOwn(context, r) || r.getSamples() == null) {
                return;
            }
            boolean any = false;
            for (HeartRateRecord.HeartRateSample s : r.getSamples()) {
                if (s == null || s.getTime() == null || hr.size() >= MAX_HR_SAMPLES) {
                    continue;
                }
                long t = s.getTime().toEpochMilli();
                long bpm = s.getBeatsPerMinute();
                if (t < startMs || t > endMs || bpm < 20 || bpm > 250) {
                    continue;
                }
                hr.add(new long[]{t, bpm});
                any = true;
            }
            if (any) {
                try {
                    origins.add(r.getMetadata().getDataOrigin().getPackageName());
                } catch (Throwable ignored) {
                }
            }
        }

        private Set<String> packages(Set<DataOrigin> in) {
            Set<String> out = new LinkedHashSet<String>();
            if (in != null) {
                for (DataOrigin o : in) {
                    String pkg = o == null ? null : o.getPackageName();
                    if (pkg != null && !pkg.isEmpty()) {
                        out.add(pkg);
                    }
                }
            }
            return out;
        }

        private void putError(String key, String message) {
            try {
                errors.put(key, message);
            } catch (Throwable ignored) {
            }
        }

        private void finish(String key, Throwable error) {
            if (!running.remove(key)) {
                return; // already finished
            }
            if (error != null) {
                putError(key, describe(error));
            }
            if (running.isEmpty()) {
                deliver();
            }
        }

        private Object kcal(Object v) {
            return v instanceof Energy ? round(((Energy) v).getInCalories() / 1000.0, 1) : JSONObject.NULL;
        }

        /** Sends whatever has arrived. Runs once: when every read finished, or at the timeout. */
        private void deliver() {
            if (delivered) {
                return;
            }
            delivered = true;
            if (timeout != null) {
                timeout.cancel(false);
            }
            for (String key : running) {
                if (!"start".equals(key)) {
                    putError(key, "timed out");
                }
            }
            try {
                JSONObject o = new JSONObject();
                o.put("id", id);
                o.put("ok", true);
                Object steps = values.get("steps");
                o.put("steps", steps instanceof Long ? steps : JSONObject.NULL);
                Object distance = values.get("distanceM");
                o.put("distanceM", distance instanceof Length ? round(((Length) distance).getInMeters(), 1) : JSONObject.NULL);
                o.put("activeKcal", kcal(values.get("activeKcal")));
                o.put("totalKcal", kcal(values.get("totalKcal")));
                Collections.sort(hr, new Comparator<long[]>() {
                    @Override
                    public int compare(long[] a, long[] b) {
                        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : Long.compare(a[1], b[1]);
                    }
                });
                JSONArray samples = new JSONArray();
                long lastT = Long.MIN_VALUE;
                for (long[] s : hr) {
                    if (s[0] == lastT) {
                        continue; // two sources at the same moment: one is enough
                    }
                    lastT = s[0];
                    samples.put(new JSONArray().put(s[0]).put(s[1]));
                }
                o.put("hr", samples);
                Set<String> names = new LinkedHashSet<String>();
                for (String pkg : origins) {
                    if (!context.getPackageName().equals(pkg)) {
                        names.add(appName(context, pkg));
                    }
                }
                o.put("sources", new JSONArray(names));
                o.put("errors", errors);
                send(o.toString());
            } catch (Throwable t) {
                delivered = false;
                fail(describe(t));
            }
        }

        void fail(String error) {
            if (delivered) {
                return;
            }
            delivered = true;
            if (timeout != null) {
                timeout.cancel(false);
            }
            try {
                JSONObject o = new JSONObject();
                o.put("id", id);
                o.put("ok", false);
                o.put("error", error);
                o.put("steps", JSONObject.NULL);
                o.put("distanceM", JSONObject.NULL);
                o.put("activeKcal", JSONObject.NULL);
                o.put("totalKcal", JSONObject.NULL);
                o.put("hr", new JSONArray());
                o.put("sources", new JSONArray());
                send(o.toString());
            } catch (Throwable ignored) {
            }
        }

        private void send(String json) {
            try {
                callback.done(json);
            } catch (Throwable ignored) {
            }
        }
    }

    // Health Connect's own limits for a nutrition record.
    private static final double MAX_KCAL = 100000.0;
    private static final double MAX_GRAMS = 100000.0;

    private static double clamp(double v, double max) {
        return Double.isNaN(v) ? 0 : Math.max(0, Math.min(max, v));
    }

    private static void foodResult(MainActivity activity, String hook, JSONArray ids, String error) {
        foodResult(activity, hook, ids, null, error);
    }

    private static void foodResult(MainActivity activity, String hook, JSONArray ids, JSONArray failed, String error) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", error == null);
            o.put("ids", ids);
            if (failed != null && failed.length() > 0) {
                o.put("failed", failed);
            }
            if (error != null) {
                o.put("error", error);
            }
            activity.callJs(MainActivity.jsCall(hook, o.toString()));
        } catch (Throwable ignored) {
        }
    }

    private static int mealType(String meal) {
        if ("breakfast".equals(meal)) {
            return 1;
        }
        if ("lunch".equals(meal)) {
            return 2;
        }
        if ("dinner".equals(meal)) {
            return 3;
        }
        return "snack".equals(meal) ? 4 : 0;
    }

    private static String mealName(int type) {
        switch (type) {
            case 1:
                return "breakfast";
            case 2:
                return "lunch";
            case 3:
                return "dinner";
            case 4:
                return "snack";
            default:
                return "";
        }
    }

    /** An EXERCISE_NAMES entry → its ExerciseSessionType value; anything else → other workout. */
    static int exerciseType(String name) {
        for (int i = 1; i < EXERCISE_NAMES.length; i++) {
            if (EXERCISE_NAMES[i].equals(name)) {
                return i;
            }
        }
        return 58; // EXERCISE_SESSION_TYPE_OTHER_WORKOUT
    }

    private static boolean isGranted(Context context, String permission) {
        try {
            return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * One thread runs every ReadJob step: start(), all OutcomeReceiver callbacks and the timeout.
     * Job state is therefore confined to it and needs no locking. Never shut down, so a callback
     * that arrives after the timeout still has somewhere to run.
     */
    private static synchronized ScheduledExecutorService executor() {
        if (executor == null) {
            executor = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "gradient-health-connect");
                    t.setDaemon(true);
                    return t;
                }
            });
        }
        return executor;
    }

    static String describe(Throwable t) {
        if (t == null) {
            return "error";
        }
        String message = t.getMessage();
        String name = t.getClass().getSimpleName();
        if (t instanceof HealthConnectException) {
            name = "HealthConnectException(" + ((HealthConnectException) t).getErrorCode() + ")";
        }
        return message == null || message.isEmpty() ? name : name + ": " + message;
    }

    private static String exerciseName(int type) {
        if (type < 0 || type >= EXERCISE_NAMES.length) {
            return "other";
        }
        String name = EXERCISE_NAMES[type];
        return "unknown".equals(name) || "other_workout".equals(name) ? "other" : name;
    }

    private static long minutes(long seconds) {
        return Math.round(seconds / 60.0);
    }

    private static JSONObject point(Instant time, String key, double value, int decimals)
            throws JSONException {
        if (time == null || Double.isNaN(value) || Double.isInfinite(value)) {
            return null;
        }
        double scale = Math.pow(10, decimals);
        JSONObject o = new JSONObject();
        o.put("time", time.toString());
        o.put(key, Math.round(value * scale) / scale);
        return o;
    }

    /** One read (hcRead() or a background sync). All methods run on the executor() thread. */
    private static final class ReadJob {
        private final Context context;
        private final Callback callback;
        private final int days;
        private final ScheduledExecutorService exec = executor();
        private final JSONObject result = new JSONObject();
        private final JSONObject errors = new JSONObject();
        private final JSONArray[] arrays = new JSONArray[TYPES.length];
        private final boolean[] running = new boolean[TYPES.length];
        // Outstanding reads, plus one held by start() until every read has been launched.
        private final AtomicInteger pending = new AtomicInteger(1);
        private boolean delivered;
        private ScheduledFuture<?> timeout;
        private HealthConnectManager manager;
        private TimeInstantRangeFilter range;
        private LocalDateTime stepsStart;
        private LocalDateTime stepsEnd;

        ReadJob(Context context, int days, Callback callback) {
            this.context = context;
            this.callback = callback;
            this.days = days;
            for (int i = 0; i < arrays.length; i++) {
                arrays[i] = new JSONArray();
            }
        }

        void start() {
            try {
                manager = context.getSystemService(HealthConnectManager.class);
            } catch (Throwable t) {
                manager = null;
            }
            if (manager == null) {
                deliverFailure("unavailable");
                return;
            }
            try {
                ZoneId zone = ZoneId.systemDefault();
                // Records: a rolling window, so "7 days" includes the night that started 7 evenings ago.
                Instant to = Instant.now().truncatedTo(ChronoUnit.MILLIS); // like record timestamps
                Instant from = to.minus(Duration.ofDays(days));
                range = new TimeInstantRangeFilter.Builder().setStartTime(from).setEndTime(to).build();
                // Steps: whole local calendar days, the oldest first, today (so far) last.
                LocalDate today = LocalDate.now(zone);
                stepsStart = today.minusDays(days - 1).atStartOfDay();
                stepsEnd = today.plusDays(1).atStartOfDay();

                result.put("ok", true);
                result.put("tz", zone.getId());
                result.put("from", from.toString());
                result.put("to", to.toString());
                for (int i = 0; i < TYPES.length; i++) {
                    result.put(TYPES[i][0], arrays[i]);
                }
                result.put("errors", errors);
            } catch (Throwable t) {
                deliverFailure(describe(t));
                return;
            }

            timeout = exec.schedule(new Runnable() {
                @Override
                public void run() {
                    deliver();
                }
            }, TIMEOUT_SECONDS, TimeUnit.SECONDS);

            for (int i = 0; i < TYPES.length; i++) {
                if (!isGranted(context, TYPES[i][1])) {
                    putError(i, "not granted");
                    continue;
                }
                running[i] = true;
                pending.incrementAndGet();
                try {
                    launch(i);
                } catch (Throwable t) {
                    finish(i, t);
                }
            }
            countDown(); // release start()'s hold
        }

        private void launch(int type) {
            switch (type) {
                case STEPS:
                    readSteps();
                    break;
                case SLEEP:
                    readPage(type, SleepSessionRecord.class, -1L, 0);
                    break;
                case WEIGHT:
                    readPage(type, WeightRecord.class, -1L, 0);
                    break;
                case HEIGHT:
                    readPage(type, HeightRecord.class, -1L, 0);
                    break;
                case BODY_FAT:
                    readPage(type, BodyFatRecord.class, -1L, 0);
                    break;
                case RESTING_HR:
                    readPage(type, RestingHeartRateRecord.class, -1L, 0);
                    break;
                case HRV:
                    readPage(type, HeartRateVariabilityRmssdRecord.class, -1L, 0);
                    break;
                case EXERCISE:
                    readPage(type, ExerciseSessionRecord.class, -1L, 0);
                    break;
                case HEART_RATE:
                    readRestingFromHeartRate();
                    break;
                case ACTIVE_KCAL:
                    readDaily(type, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL);
                    break;
                case DISTANCE:
                    readDaily(type, DistanceRecord.DISTANCE_TOTAL);
                    break;
                case NUTRITION:
                    readPage(type, NutritionRecord.class, -1L, 0);
                    break;
                default:
                    finish(type, new IllegalArgumentException("unknown type"));
            }
        }

        /** Daily step totals in local time. Days without any data are left out. */
        private void readSteps() {
            LocalTimeRangeFilter filter = new LocalTimeRangeFilter.Builder()
                    .setStartTime(stepsStart).setEndTime(stepsEnd).build();
            AggregateRecordsRequest<Long> request = new AggregateRecordsRequest.Builder<Long>(filter)
                    .addAggregationType(StepsRecord.STEPS_COUNT_TOTAL).build();
            manager.aggregateGroupByPeriod(request, Period.ofDays(1), exec,
                    new OutcomeReceiver<List<AggregateRecordsGroupedByPeriodResponse<Long>>,
                            HealthConnectException>() {
                        @Override
                        public void onResult(List<AggregateRecordsGroupedByPeriodResponse<Long>> days) {
                            try {
                                if (days != null) {
                                    for (AggregateRecordsGroupedByPeriodResponse<Long> day : days) {
                                        Long count = day == null ? null : day.get(StepsRecord.STEPS_COUNT_TOTAL);
                                        LocalDateTime start = day == null ? null : day.getStartTime();
                                        if (count == null || start == null) {
                                            continue;
                                        }
                                        JSONObject o = new JSONObject();
                                        o.put("date", start.toLocalDate().toString());
                                        o.put("count", count.longValue());
                                        arrays[STEPS].put(o);
                                    }
                                }
                                finish(STEPS, null);
                            } catch (Throwable t) {
                                finish(STEPS, t);
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish(STEPS, e);
                        }
                    });
        }

        /**
         * Daily totals in local time for an energy or length aggregate: [{date, kcal}] for active
         * calories, [{date, m}] for distance. Days without data are left out.
         */
        private <T> void readDaily(final int type, final AggregationType<T> aggregation) {
            LocalTimeRangeFilter filter = new LocalTimeRangeFilter.Builder()
                    .setStartTime(stepsStart).setEndTime(stepsEnd).build();
            AggregateRecordsRequest<T> request = new AggregateRecordsRequest.Builder<T>(filter)
                    .addAggregationType(aggregation).build();
            manager.aggregateGroupByPeriod(request, Period.ofDays(1), exec,
                    new OutcomeReceiver<List<AggregateRecordsGroupedByPeriodResponse<T>>, HealthConnectException>() {
                        @Override
                        public void onResult(List<AggregateRecordsGroupedByPeriodResponse<T>> days) {
                            try {
                                if (days != null) {
                                    for (AggregateRecordsGroupedByPeriodResponse<T> day : days) {
                                        T value = day == null ? null : day.get(aggregation);
                                        LocalDateTime start = day == null ? null : day.getStartTime();
                                        if (value == null || start == null) {
                                            continue;
                                        }
                                        JSONObject o = new JSONObject();
                                        o.put("date", start.toLocalDate().toString());
                                        if (value instanceof Energy) {
                                            o.put("kcal", Math.round(((Energy) value).getInCalories() / 1000.0));
                                        } else if (value instanceof Length) {
                                            o.put("m", Math.round(((Length) value).getInMeters()));
                                        } else {
                                            continue;
                                        }
                                        arrays[type].put(o);
                                    }
                                }
                                finish(type, null);
                            } catch (Throwable t) {
                                finish(type, t);
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish(type, e);
                        }
                    });
        }

        /**
         * An estimated resting heart rate for apps that record heart rate but don't share resting
         * heart rate (Samsung Health and Garmin, for instance): heart rate averaged over 30-minute
         * windows, and for each local day the lowest window with at least 5 readings, which lands
         * in deep sleep for people who wear their watch at night. Sends [{time, bpm}] per day, at
         * most HEART_RATE_DAYS back.
         */
        private void readRestingFromHeartRate() {
            Instant to = Instant.now().truncatedTo(ChronoUnit.MINUTES);
            Instant from = to.minus(Duration.ofDays(Math.min(days, HEART_RATE_DAYS)));
            TimeInstantRangeFilter filter = new TimeInstantRangeFilter.Builder().setStartTime(from).setEndTime(to).build();
            AggregateRecordsRequest<Long> request = new AggregateRecordsRequest.Builder<Long>(filter)
                    .addAggregationType(HeartRateRecord.BPM_AVG)
                    .addAggregationType(HeartRateRecord.HEART_MEASUREMENTS_COUNT)
                    .build();
            manager.aggregateGroupByDuration(request, Duration.ofMinutes(30), exec,
                    new OutcomeReceiver<List<AggregateRecordsGroupedByDurationResponse<Long>>, HealthConnectException>() {
                        @Override
                        public void onResult(List<AggregateRecordsGroupedByDurationResponse<Long>> windows) {
                            try {
                                ZoneId zone = ZoneId.systemDefault();
                                Map<LocalDate, Instant> bestTime = new HashMap<LocalDate, Instant>();
                                Map<LocalDate, Long> best = new HashMap<LocalDate, Long>();
                                if (windows != null) {
                                    for (AggregateRecordsGroupedByDurationResponse<Long> w : windows) {
                                        if (w == null || w.getStartTime() == null) {
                                            continue;
                                        }
                                        Long avg = w.get(HeartRateRecord.BPM_AVG);
                                        Long n = w.get(HeartRateRecord.HEART_MEASUREMENTS_COUNT);
                                        if (avg == null || n == null || n < 5 || avg < 25 || avg > 150) {
                                            continue;
                                        }
                                        LocalDate date = w.getStartTime().atZone(zone).toLocalDate();
                                        Long cur = best.get(date);
                                        if (cur == null || avg < cur) {
                                            best.put(date, avg);
                                            bestTime.put(date, w.getStartTime());
                                        }
                                    }
                                }
                                for (Map.Entry<LocalDate, Long> e : best.entrySet()) {
                                    JSONObject o = point(bestTime.get(e.getKey()), "bpm", e.getValue(), 0);
                                    if (o != null) {
                                        arrays[HEART_RATE].put(o);
                                    }
                                }
                                finish(HEART_RATE, null);
                            } catch (Throwable t) {
                                finish(HEART_RATE, t);
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish(HEART_RATE, e);
                        }
                    });
        }

        /** Reads one page (oldest first) and follows the page token, up to MAX_PAGES pages. */
        private <T extends Record> void readPage(final int type, final Class<T> recordClass,
                                                 long pageToken, final int page) {
            ReadRecordsRequestUsingFilters.Builder<T> builder =
                    new ReadRecordsRequestUsingFilters.Builder<T>(recordClass)
                            .setTimeRangeFilter(range)
                            .setPageSize(PAGE_SIZE);
            if (pageToken != -1L) {
                builder.setPageToken(pageToken); // (setAscending can't be combined with a token)
            }
            manager.readRecords(builder.build(), exec,
                    new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
                        @Override
                        public void onResult(ReadRecordsResponse<T> response) {
                            try {
                                List<T> records = response == null ? null : response.getRecords();
                                if (records != null) {
                                    for (T record : records) {
                                        append(type, record);
                                    }
                                }
                                long next = response == null ? -1L : response.getNextPageToken();
                                if (next != -1L && !delivered) {
                                    if (page + 1 < MAX_PAGES) {
                                        readPage(type, recordClass, next, page + 1);
                                        return;
                                    }
                                    putError(type, "truncated after " + arrays[type].length() + " records");
                                }
                                finish(type, null);
                            } catch (Throwable t) {
                                finish(type, t); // keeps the pages that did arrive
                            }
                        }

                        @Override
                        public void onError(HealthConnectException e) {
                            finish(type, e);
                        }
                    });
        }

        /** Converts one record; a record that can't be converted is skipped. */
        private void append(int type, Record record) {
            if (record == null) {
                return;
            }
            try {
                JSONObject o = toJson(type, record);
                if (o != null) {
                    arrays[type].put(o);
                }
            } catch (Throwable ignored) {
            }
        }

        /** True for sessions this app wrote itself (they mirror workouts it already has). */
        private boolean isOwn(Record record) {
            return HealthBridge.isOwn(context, record);
        }

        private JSONObject toJson(int type, Record record) throws JSONException {
            switch (type) {
                case SLEEP:
                    return sleepJson((SleepSessionRecord) record);
                case WEIGHT: {
                    WeightRecord r = (WeightRecord) record;
                    return point(r.getTime(), "kg", r.getWeight().getInGrams() / 1000.0, 2);
                }
                case HEIGHT: {
                    HeightRecord r = (HeightRecord) record;
                    return point(r.getTime(), "m", r.getHeight().getInMeters(), 3);
                }
                case BODY_FAT: {
                    BodyFatRecord r = (BodyFatRecord) record;
                    return point(r.getTime(), "pct", r.getPercentage().getValue(), 2);
                }
                case RESTING_HR: {
                    RestingHeartRateRecord r = (RestingHeartRateRecord) record;
                    return point(r.getTime(), "bpm", r.getBeatsPerMinute(), 0);
                }
                case HRV: {
                    HeartRateVariabilityRmssdRecord r = (HeartRateVariabilityRmssdRecord) record;
                    return point(r.getTime(), "ms", r.getHeartRateVariabilityMillis(), 2);
                }
                case EXERCISE: {
                    ExerciseSessionRecord r = (ExerciseSessionRecord) record;
                    JSONObject o = new JSONObject();
                    o.put("start", r.getStartTime().toString());
                    o.put("end", r.getEndTime().toString());
                    o.put("type", r.getExerciseType());
                    o.put("typeName", exerciseName(r.getExerciseType()));
                    o.put("mine", isOwn(r));
                    CharSequence title = r.getTitle();
                    o.put("title", title == null ? "" : title.toString());
                    return o;
                }
                case NUTRITION: {
                    // Only food logged in other apps: the app already has its own entries.
                    NutritionRecord r = (NutritionRecord) record;
                    if (isOwn(r)) {
                        return null;
                    }
                    JSONObject o = new JSONObject();
                    o.put("start", r.getStartTime().toString());
                    Energy energy = r.getEnergy();
                    o.put("kcal", energy == null ? 0 : Math.round(energy.getInCalories() / 1000.0));
                    o.put("p", grams(r.getProtein()));
                    o.put("c", grams(r.getTotalCarbohydrate()));
                    o.put("f", grams(r.getTotalFat()));
                    o.put("meal", mealName(r.getMealType()));
                    return o;
                }
                default:
                    return null;
            }
        }

        /**
         * Stage minutes are clipped to the session. awake = awake + awake in bed + out of bed;
         * unknown = unknown + generic "sleeping" stages, or the whole session if it has no stages.
         * asleepMin = session length minus awake time (the whole session if there are no stages).
         */
        private static JSONObject sleepJson(SleepSessionRecord r) throws JSONException {
            Instant start = r.getStartTime();
            Instant end = r.getEndTime();
            long total = Math.max(0L, Duration.between(start, end).getSeconds());
            long awake = 0;
            long light = 0;
            long deep = 0;
            long rem = 0;
            long unknown = 0;
            List<SleepSessionRecord.Stage> stages = r.getStages();
            boolean staged = stages != null && !stages.isEmpty();
            if (staged) {
                for (SleepSessionRecord.Stage stage : stages) {
                    if (stage == null || stage.getStartTime() == null || stage.getEndTime() == null) {
                        continue;
                    }
                    Instant a = stage.getStartTime().isBefore(start) ? start : stage.getStartTime();
                    Instant b = stage.getEndTime().isAfter(end) ? end : stage.getEndTime();
                    long seconds = Duration.between(a, b).getSeconds();
                    if (seconds <= 0) {
                        continue;
                    }
                    switch (stage.getType()) {
                        case SleepSessionRecord.StageType.STAGE_TYPE_AWAKE:
                        case SleepSessionRecord.StageType.STAGE_TYPE_AWAKE_IN_BED:
                        case SleepSessionRecord.StageType.STAGE_TYPE_AWAKE_OUT_OF_BED:
                            awake += seconds;
                            break;
                        case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_LIGHT:
                            light += seconds;
                            break;
                        case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_DEEP:
                            deep += seconds;
                            break;
                        case SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_REM:
                            rem += seconds;
                            break;
                        default: // STAGE_TYPE_UNKNOWN, STAGE_TYPE_SLEEPING, future types
                            unknown += seconds;
                    }
                }
            } else {
                unknown = total;
            }
            long asleep = staged ? Math.max(0L, total - awake) : total;

            JSONObject stageMinutes = new JSONObject();
            stageMinutes.put("awake", minutes(awake));
            stageMinutes.put("light", minutes(light));
            stageMinutes.put("deep", minutes(deep));
            stageMinutes.put("rem", minutes(rem));
            stageMinutes.put("unknown", minutes(unknown));

            JSONObject o = new JSONObject();
            o.put("start", start.toString());
            o.put("end", end.toString());
            o.put("asleepMin", minutes(asleep));
            o.put("stages", stageMinutes);
            return o;
        }

        private static double grams(Mass m) {
            return m == null ? 0 : Math.round(m.getInGrams() * 10.0) / 10.0;
        }

        private void putError(int type, String message) {
            try {
                errors.put(TYPES[type][0], message);
            } catch (Throwable ignored) {
            }
        }

        private void finish(int type, Throwable error) {
            if (!running[type]) {
                return; // already finished (or never started)
            }
            running[type] = false;
            if (error != null) {
                putError(type, describe(error));
            }
            countDown();
        }

        private void countDown() {
            if (pending.decrementAndGet() <= 0) {
                deliver();
            }
        }

        /** Sends whatever has arrived. Runs once: when every read finished, or at the timeout. */
        private void deliver() {
            if (delivered) {
                return;
            }
            delivered = true;
            if (timeout != null) {
                timeout.cancel(false);
            }
            for (int i = 0; i < TYPES.length; i++) {
                if (running[i]) {
                    putError(i, "timed out");
                }
            }
            send(result.toString());
        }

        private void deliverFailure(String error) {
            if (delivered) {
                return;
            }
            delivered = true;
            try {
                JSONObject failure = new JSONObject();
                failure.put("ok", false);
                failure.put("error", error);
                send(failure.toString());
            } catch (Throwable ignored) {
            }
        }

        private void send(String json) {
            try {
                callback.done(json);
            } catch (Throwable ignored) {
            }
        }
    }

    /** True for records this app wrote itself. */
    private static boolean isOwn(Context context, Record record) {
        try {
            String origin = record.getMetadata().getDataOrigin().getPackageName();
            return context.getPackageName().equals(origin);
        } catch (Throwable t) {
            return false;
        }
    }
}
