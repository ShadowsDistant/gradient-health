package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsGroupedByPeriodResponse;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.LocalTimeRangeFilter;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.BodyFatRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.HeartRateVariabilityRmssdRecord;
import android.health.connect.datatypes.HeightRecord;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.RestingHeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.WeightRecord;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
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
    private static final String[][] TYPES = {
            {"steps", "android.permission.health.READ_STEPS"},
            {"sleep", "android.permission.health.READ_SLEEP"},
            {"weight", "android.permission.health.READ_WEIGHT"},
            {"height", "android.permission.health.READ_HEIGHT"},
            {"bodyFat", "android.permission.health.READ_BODY_FAT"},
            {"restingHr", "android.permission.health.READ_RESTING_HEART_RATE"},
            {"hrv", "android.permission.health.READ_HEART_RATE_VARIABILITY"},
            {"exercise", "android.permission.health.READ_EXERCISE"},
    };

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

    private static ScheduledExecutorService executor;

    /** The 8 read permissions, for Activity.requestPermissions. */
    static String[] permissions() {
        String[] out = new String[TYPES.length];
        for (int i = 0; i < TYPES.length; i++) {
            out[i] = TYPES[i][1];
        }
        return out;
    }

    /** "unavailable" | "denied" | "partial" | "granted" (the caller handles "unsupported"). */
    static String status(Context context) {
        try {
            if (context.getSystemService(HealthConnectManager.class) == null) {
                return "unavailable";
            }
        } catch (Throwable t) {
            return "unavailable";
        }
        int granted = 0;
        for (String[] type : TYPES) {
            if (isGranted(context, type[1])) {
                granted++;
            }
        }
        if (granted == 0) {
            return "denied";
        }
        return granted == TYPES.length ? "granted" : "partial";
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

        private static JSONObject toJson(int type, Record record) throws JSONException {
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
                    CharSequence title = r.getTitle();
                    o.put("title", title == null ? "" : title.toString());
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
