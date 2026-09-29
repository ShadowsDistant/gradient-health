package com.shadowsdistant.gradienthealth;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Open Food Facts lookups for the page (only used when the person turns online food search on).
 * Made here rather than with fetch() so the request carries the User-Agent Open Food Facts asks
 * apps to send, and so the page's content security policy can keep every other host out.
 * Only the barcode or the search words are sent. Answers with window.__gh.onFoodResult.
 */
final class FoodLookup {
    private FoodLookup() {
    }

    private static final String HOST = "https://world.openfoodfacts.org";
    private static final String FIELDS = "code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity";
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static ExecutorService pool;

    private static synchronized ExecutorService pool() {
        if (pool == null) {
            pool = Executors.newFixedThreadPool(2);
        }
        return pool;
    }

    /** kind "barcode" (digits) or "search" (words); id is echoed back with the result. */
    static void lookup(final MainActivity activity, final String kind, final String query, final String id) {
        pool().execute(new Runnable() {
            @Override
            public void run() {
                int status = 0;
                String body = "";
                try {
                    String url;
                    if ("barcode".equals(kind)) {
                        String code = query == null ? "" : query.replaceAll("[^0-9]", "");
                        if (code.isEmpty() || code.length() > 14) {
                            deliver(activity, id, false, 400, "");
                            return;
                        }
                        url = HOST + "/api/v2/product/" + code + ".json?fields=" + FIELDS;
                    } else {
                        String q = query == null ? "" : query.trim();
                        if (q.isEmpty() || q.length() > 100) {
                            deliver(activity, id, false, 400, "");
                            return;
                        }
                        url = HOST + "/cgi/search.pl?search_simple=1&action=process&json=1&page_size=20&fields=" + FIELDS
                                + "&search_terms=" + URLEncoder.encode(q, "UTF-8");
                    }
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    try {
                        c.setConnectTimeout(10000);
                        c.setReadTimeout(15000);
                        c.setRequestProperty("User-Agent", "GradientHealth/" + activity.versionName()
                                + " (Android; https://github.com/ShadowsDistant/gradient-health)");
                        c.setRequestProperty("Accept", "application/json");
                        status = c.getResponseCode();
                        // A barcode that isn't known answers 404 with a JSON body; that's a normal "not found".
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        body = in == null ? "" : read(in);
                    } finally {
                        c.disconnect();
                    }
                    if (body == null) { // too big to be a real answer
                        deliver(activity, id, false, status, "");
                        return;
                    }
                    boolean ok = status == 200 || ("barcode".equals(kind) && status == 404);
                    if ("barcode".equals(kind) && status == 404 && body.isEmpty()) {
                        body = "{\"status\":0}";
                    }
                    deliver(activity, id, ok, status, body);
                } catch (Throwable t) {
                    deliver(activity, id, false, status, "");
                }
            }
        });
    }

    /** The whole body, or null if it's over MAX_BYTES. Always closes the stream. */
    private static String read(InputStream in) throws java.io.IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            int total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) {
                    return null;
                }
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        } finally {
            in.close();
        }
    }

    private static void deliver(MainActivity activity, String id, boolean ok, int status, String body) {
        try {
            JSONObject o = new JSONObject();
            o.put("id", id == null ? "" : id);
            o.put("ok", ok);
            o.put("status", status);
            o.put("body", body == null ? "" : body);
            activity.callJs(MainActivity.jsCall("onFoodResult", o.toString()));
        } catch (Throwable ignored) {
        }
    }
}
