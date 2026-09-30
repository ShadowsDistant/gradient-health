package com.shadowsdistant.gradienthealth;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.os.Build;

/**
 * The background sync's periodic job (see {@link HealthSync}): reads the last two days from Health
 * Connect, the same way the page does, and saves the result for the page to fold in. JobScheduler
 * runs it about every 15 minutes, app open or not, and again after a reboot.
 */
public final class HealthSyncJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        if (Build.VERSION.SDK_INT < Bridge.HEALTH_CONNECT_MIN_SDK) {
            return false;
        }
        final Context app = getApplicationContext();
        final long now = System.currentTimeMillis();
        String blocker;
        try {
            blocker = HealthSync.blocker(app);
        } catch (Throwable t) {
            blocker = "failed";
        }
        if (blocker != null) {
            // Switched off, or no longer allowed: record why and stop waking up for nothing. The app
            // schedules the job again when that changes (when it starts and after permission answers).
            HealthSync.skipRun(app, now, blocker);
            HealthSync.updateLater(app);
            tellPage(app);
            return false;
        }
        HealthSync.markRun(app, now);
        try {
            HealthBridge.read(app, HealthSync.DAYS, new HealthBridge.Callback() {
                @Override
                public void done(String json) {
                    try {
                        HealthSync.finishRun(app, json, now);
                    } finally {
                        jobFinished(params, false);
                        tellPage(app);
                    }
                }
            });
        } catch (Throwable t) {
            HealthSync.skipRun(app, now, "failed");
            return false;
        }
        return true; // still reading: jobFinished() comes from the callback
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return false; // a periodic job: the next run comes anyway
    }

    /** If the app is open, the page folds the read in and Settings shows the new state. */
    static void tellPage(Context context) {
        MainActivity page = MainActivity.live();
        if (page != null) {
            page.callJs(MainActivity.jsCall("onHealthBackground", HealthSync.stateJson(context)));
        }
    }
}
