package com.shadowsdistant.gradienthealth;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Notifications' alarm (see {@link Notifier}): posts what's due and sets the next alarm. After the
 * phone restarts, and after the app is updated, alarms are gone, so the schedule's next one is set
 * again (an item that came due meanwhile goes out then, if it's still in time). The work runs off the
 * main thread (goAsync): it reads the schedule and, for a sleep item, the last background read.
 */
public final class NotifyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent == null ? null : intent.getAction();
        final boolean alarm = Notifier.ACTION_ALARM.equals(action);
        if (!alarm && !Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        final Context app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        final PendingResult result = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (alarm) {
                        Notifier.fire(app, System.currentTimeMillis());
                    } else {
                        Notifier.arm(app, System.currentTimeMillis());
                    }
                } catch (Throwable ignored) {
                    // The page plans again the next time it's opened.
                } finally {
                    result.finish();
                }
            }
        }, "gradient-notify").start();
    }
}
