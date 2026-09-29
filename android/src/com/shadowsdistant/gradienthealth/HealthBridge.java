package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsGroupedByDurationResponse;
import android.health.connect.AggregateRecordsGroupedByPeriodResponse;
import android.health.connect.AggregateRecordsRequest;
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
import android.health.connect.datatypes.Device;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.HeartRateVariabilityRmssdRecord;
import android.health.connect.datatypes.HeightRecord;
import android.health.connect.datatypes.Metadata;
import android.health.connect.datatypes.NutritionRecord;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.RestingHeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
 * don't have. {@link Bridge} and {@link MainActivity} do that check.
 */
final class HealthBridge {
    private HealthBridge() {
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

    private static ScheduledExecutorService executor;

    /** Every read permission plus the two writes, for Activity.requestPermissions. */
    static String[] permissions() {
        String[] out = new String[TYPES.length + 2];
        for (int i = 0; i < TYPES.length; i++) {
            out[i] = TYPES[i][1];
        }
        out[TYPES.length] = WRITE_EXERCISE;
        out[TYPES.length + 1] = WRITE_NUTRITION;
        return out;
    }

    /** The data types this app may read or write right now, e.g. ["steps", "heartRate", "writeNutrition"]. */
    static String granted(Context context) {
        JSONArray out = new JSONArray();
        for (String[] type : TYPES) {
            if (isGranted(context, type[1])) {
                out.put(type[0]);
            }
        }
        if (isGranted(context, WRITE_EXERCISE)) {
            out.put("writeExercise");
        }
        if (isGranted(context, WRITE_NUTRITION)) {
            out.put("writeNutrition");
        }
        return out.toString();
    }

    static boolean canWriteNutrition(Context context) {
        return isGranted(context, WRITE_NUTRITION);
    }

    /**
     * The permissions from {@link #permissions()} that aren't granted yet. The nutrition ones are
     * only asked for when food tracking is on, so people who just work out never see them.
     */
    static String[] missingPermissions(Context context, boolean withFood) {
        List<String> missing = new ArrayList<String>();
        for (String permission : permissions()) {
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
        final int span = Math.max(MIN_DAYS, Math.min(MAX_DAYS, days));
        executor().execute(new Runnable() {
            @Override
            public void run() {
                ReadJob job = new ReadJob(activity, span);
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

    /** One hcRead() call. All methods run on the executor() thread. */
    private static final class ReadJob {
        private final MainActivity activity;
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

        ReadJob(MainActivity activity, int days) {
            this.activity = activity;
            this.days = days;
            for (int i = 0; i < arrays.length; i++) {
                arrays[i] = new JSONArray();
            }
        }

        void start() {
            try {
                manager = activity.getSystemService(HealthConnectManager.class);
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
                if (!isGranted(activity, TYPES[i][1])) {
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
            try {
                String origin = record.getMetadata().getDataOrigin().getPackageName();
                return activity.getPackageName().equals(origin);
            } catch (Throwable t) {
                return false;
            }
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
            activity.callJs(MainActivity.jsCall("onHealth", json));
        }
    }
}
