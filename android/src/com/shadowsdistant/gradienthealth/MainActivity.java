package com.shadowsdistant.gradienthealth;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Locale;

/**
 * Hosts the single-file web app (assets/index.html) in a full-window WebView.
 *
 * The page is served from https://appassets.androidplatform.net/index.html by
 * {@link AppWebViewClient#shouldInterceptRequest}, which gives it a stable secure origin
 * (localStorage, fetch to https://api.anthropic.com) without file:// access. The page talks
 * back through window.AndroidBridge ({@link Bridge}); Java talks to the page only through
 * {@link #callJs}/{@link #evalJs}, which call optional hooks on window.__gh.
 */
public final class MainActivity extends Activity {
    static final String APP_HOST = "appassets.androidplatform.net";
    static final String APP_URL = "https://" + APP_HOST + "/index.html";
    static final int REQUEST_HEALTH_PERMISSIONS = 4201;
    static final String CLAUDE_PACKAGE = "com.anthropic.claude";

    private static final String ACTION_VIEW_PERMISSION_USAGE =
            "android.intent.action.VIEW_PERMISSION_USAGE";
    private static final String BRIDGE_NAME = "AndroidBridge";

    // Keep in sync with res/values*/colors.xml (window_bg) and the web app's themes.
    private static final int COLOR_DARK = 0xFF0B0C10;
    private static final int COLOR_LIGHT = 0xFFF1F2F6;
    private static final int FLAG_LIGHT_STATUS_BAR = 0x2000;   // View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
    private static final int FLAG_LIGHT_NAVIGATION_BAR = 0x10; // View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

    /** If the page has not answered the back button within this time, act as if it declined. */
    private static final long BACK_TIMEOUT_MS = 2000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // UI-thread state.
    private FrameLayout root;
    private WebView webView;
    private Bridge bridge;
    private boolean pageLoaded;
    private String pendingRoute;
    private boolean destroyed;
    private int rendererCrashes;
    private long firstRendererCrashAt;
    // Last system-bar insets in CSS pixels, as JSON, for the page to read (see Bridge.insets()).
    private volatile String insetsJson = "{\"top\":0,\"bottom\":0,\"left\":0,\"right\":0,\"keyboard\":false}";
    private int imeBottomPx;
    // The page's own theme once it has reported one (it can differ from the system's).
    private Boolean pageDark;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        enableEdgeToEdge();
        applyTheme(getResources().getConfiguration());
        setContentView(root);
        listenForInsets();
        registerBackCallback();

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            try {
                WebView.setWebContentsDebuggingEnabled(true);
            } catch (Throwable ignored) {
                // No WebView provider; createWebView() reports it.
            }
        }

        bridge = new Bridge(this);
        String url = APP_URL;
        if (isPrivacyIntent(getIntent())) {
            pendingRoute = "privacy";
            url = APP_URL + "#privacy";
        }
        createWebView(url);
    }

    private void createWebView(String url) {
        WebView wv = null;
        try {
            wv = new WebView(this);
            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setTextZoom(textZoomFor(getResources().getConfiguration()));
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            wv.setBackgroundColor(currentBackground());
            wv.setWebViewClient(new AppWebViewClient());
            // A WebChromeClient is needed for alert()/confirm()/prompt() dialogs to show at all.
            wv.setWebChromeClient(new WebChromeClient());
            wv.addJavascriptInterface(bridge, BRIDGE_NAME);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            lp.bottomMargin = imeBottomPx;
            root.addView(wv, lp);
            webView = wv;
            pageLoaded = false;
            wv.loadUrl(url);
        } catch (Throwable t) {
            // Android System WebView missing, disabled or mid-update: explain instead of crashing.
            webView = null;
            if (wv != null) {
                try {
                    root.removeView(wv);
                    wv.destroy();
                } catch (Throwable ignored) {
                }
            }
            showMessage("Gradient Health needs Android System WebView.\n\n"
                    + "Update or enable it in the Play Store, then reopen the app.");
        }
    }

    /**
     * Text follows the phone's font size setting, capped so the layout holds up: 85% to 130%.
     */
    static int textZoomFor(Configuration c) {
        float scale = c == null || c.fontScale <= 0 ? 1f : c.fontScale;
        return Math.round(Math.max(0.85f, Math.min(1.3f, scale)) * 100f);
    }

    private void showMessage(String message) {
        try {
            TextView tv = new TextView(this);
            tv.setText(message);
            tv.setTextSize(16);
            tv.setGravity(Gravity.CENTER);
            tv.setTextColor(isDarkMode() ? 0xFFE8E9EE : 0xFF1B1D24);
            int pad = (int) (32 * getResources().getDisplayMetrics().density);
            tv.setPadding(pad, pad, pad, pad);
            root.removeAllViews();
            root.addView(tv, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } catch (Throwable ignored) {
            // Nothing else we can do.
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        WebView wv = webView;
        if (wv != null) {
            try {
                wv.onResume();
            } catch (Throwable ignored) {
            }
        }
        callJs(jsCall("onResume", ""));
    }

    @Override
    protected void onPause() {
        // WebView.onPause() pauses animations/geolocation only. JS timers keep running on
        // purpose (no pauseTimers()): a workout in progress must keep counting in the background.
        // The page is told, so it stops background work like the 15-minute health sync.
        callJs(jsCall("onPause", ""));
        WebView wv = webView;
        if (wv != null) {
            try {
                wv.onPause();
            } catch (Throwable ignored) {
            }
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        mainHandler.removeCallbacksAndMessages(null);
        WebView wv = webView;
        webView = null;
        if (wv != null) {
            try {
                root.removeView(wv);
                wv.removeJavascriptInterface(BRIDGE_NAME);
                wv.destroy();
            } catch (Throwable ignored) {
            }
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isPrivacyIntent(intent)) {
            openRoute("privacy");
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView != null) {
            webView.getSettings().setTextZoom(textZoomFor(newConfig));
        }
        boolean dark = isDark(newConfig);
        if (pageDark == null) {
            applyBarAppearance(dark);
        }
        // The page answers with setSystemBars() once it has picked its theme.
        callJs(jsCall("setTheme", jsString(dark ? "dark" : "light")));
    }

    /**
     * Back is offered to the page first: window.__gh.back() returns true if it handled it (closed a
     * sheet, went up a level). Otherwise the app goes to the background. It never finishes, so a
     * running workout (timers, keep-awake) survives. (Deprecated in API 33, but still what runs for
     * apps that don't opt in to OnBackInvokedCallback, and it works on every supported version.)
     */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    private void registerBackCallback() {
        if (Build.VERSION.SDK_INT >= 33) {
            Api33.registerBack(this);
        }
    }

    void handleBack() {
        final boolean[] answered = {false};
        final Runnable fallback = new Runnable() {
            @Override
            public void run() {
                if (answered[0]) {
                    return;
                }
                answered[0] = true;
                sendToBackground();
            }
        };
        mainHandler.postDelayed(fallback, BACK_TIMEOUT_MS);
        evalJs("(window.__gh&&window.__gh.back)?window.__gh.back():false",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (answered[0]) {
                            return;
                        }
                        answered[0] = true;
                        mainHandler.removeCallbacks(fallback);
                        if (!"true".equals(value)) {
                            sendToBackground();
                        }
                    }
                });
    }

    private void sendToBackground() {
        try {
            moveTaskToBack(true);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_HEALTH_PERMISSIONS) {
            notifyHealthPermissions();
        }
    }

    // ---------------------------------------------------------------- called by Bridge (UI thread)

    /** Shows the Health Connect permission dialog; the result arrives via onHealthPerms. */
    void requestHealthPermissions() {
        String status = bridge != null ? bridge.hcStatus() : "unavailable";
        if ("unsupported".equals(status) || "unavailable".equals(status)) {
            callJs(jsCall("onHealthPerms", jsString(status)));
            return;
        }
        try {
            String[] missing = HealthBridge.missingPermissions(this);
            if (missing.length == 0) {
                callJs(jsCall("onHealthPerms", jsString(status)));
                return;
            }
            requestPermissions(missing, REQUEST_HEALTH_PERMISSIONS);
        } catch (Throwable t) {
            notifyHealthPermissions();
        }
    }

    void notifyHealthPermissions() {
        String status = bridge != null ? bridge.hcStatus() : "unavailable";
        callJs(jsCall("onHealthPerms", jsString(status)));
    }

    /** Health Connect's per-app permission screen, falling back to its home screen. */
    void openHealthSettings() {
        Intent manage = new Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS");
        manage.putExtra(Intent.EXTRA_PACKAGE_NAME, getPackageName());
        if (tryStartActivity(manage)) {
            return;
        }
        if (tryStartActivity(new Intent("android.health.connect.action.HEALTH_HOME_SETTINGS"))) {
            return;
        }
        tryStartActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getPackageName(), null)));
    }

    /** Opens an http(s) URL in the user's browser (or the app that owns the link). */
    void openExternal(Uri uri) {
        if (uri == null) {
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        tryStartActivity(intent);
    }

    private boolean tryStartActivity(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Throwable t) {
            // SecurityException for a protected action, etc.
            return false;
        }
    }

    // ---------------------------------------------------------------- JS helpers

    /** Runs a script in the page (posted to the UI thread; result ignored). Safe from any thread. */
    void callJs(String script) {
        evalJs(script, null);
    }

    /**
     * Posts evaluateJavascript to the UI thread. If the page can't run it, the callback (when
     * given) receives null, so it is always called exactly once.
     */
    void evalJs(final String script, final ValueCallback<String> callback) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                WebView wv = webView;
                if (destroyed || wv == null || script == null) {
                    if (callback != null) {
                        callback.onReceiveValue(null);
                    }
                    return;
                }
                try {
                    wv.evaluateJavascript(script, callback);
                } catch (Throwable t) {
                    if (callback != null) {
                        callback.onReceiveValue(null);
                    }
                }
            }
        });
    }

    /**
     * "window.__gh&&window.__gh.fn&&window.__gh.fn(args)". {@code args} must already be JS
     * literals (use {@link #jsString} for strings, JSONObject/JSONArray.toString() for objects).
     */
    static String jsCall(String fn, String args) {
        return "window.__gh&&window.__gh." + fn + "&&window.__gh." + fn + "(" + jsSafe(args) + ")";
    }

    /** A JS string literal (JSON-quoted, so quotes, backslashes and control chars are escaped). */
    static String jsString(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    /**
     * JSON text is a valid JS expression except that U+2028/U+2029 were line terminators before
     * ES2019; they can only occur inside string literals, where an escape is equivalent.
     */
    static String jsSafe(String js) {
        if (js == null) {
            return "";
        }
        return js.replace(String.valueOf((char) 0x2028), "\\u2028")
                .replace(String.valueOf((char) 0x2029), "\\u2029");
    }

    private void openRoute(String route) {
        if (pageLoaded && webView != null) {
            callJs(jsCall("openRoute", jsString(route)));
        } else {
            pendingRoute = route;
        }
    }

    private void flushPendingRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        if (route != null) {
            callJs(jsCall("openRoute", jsString(route)));
        }
    }

    private static boolean isPrivacyIntent(Intent intent) {
        return intent != null && ACTION_VIEW_PERMISSION_USAGE.equals(intent.getAction());
    }

    // ---------------------------------------------------------------- theme

    boolean isDarkMode() {
        try {
            return isDark(getResources().getConfiguration());
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean isDark(Configuration config) {
        return config != null
                && (config.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private int currentBackground() {
        return isDarkMode() ? COLOR_DARK : COLOR_LIGHT;
    }

    /** Follows the system night mode until the page reports its own theme (setSystemBars). */
    private boolean applyTheme(Configuration config) {
        boolean dark = isDark(config);
        applyBarAppearance(dark);
        return dark;
    }

    /**
     * The app draws behind transparent status and navigation bars; the page pads itself using the
     * insets from {@link #listenForInsets}. The navigation bar keeps the system's contrast scrim,
     * which only appears with three-button navigation.
     */
    @SuppressWarnings("deprecation")
    private void enableEdgeToEdge() {
        try {
            Window w = getWindow();
            if (Build.VERSION.SDK_INT >= 30) {
                w.setDecorFitsSystemWindows(false);
            } else {
                View decor = w.getDecorView();
                decor.setSystemUiVisibility(decor.getSystemUiVisibility()
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            }
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                    | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 29) {
                w.setStatusBarContrastEnforced(false);
            }
            if (Build.VERSION.SDK_INT >= 28) {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            }
        } catch (Throwable ignored) {
            // The app still works with opaque bars.
        }
    }

    /** Dark or light status/navigation bar icons, window and WebView background colour. */
    @SuppressWarnings("deprecation")
    void applyBarAppearance(boolean dark) {
        int color = dark ? COLOR_DARK : COLOR_LIGHT;
        try {
            Window w = getWindow();
            w.setBackgroundDrawable(new ColorDrawable(color));
            View decor = w.getDecorView();
            int flags = decor.getSystemUiVisibility();
            if (dark) {
                flags &= ~(FLAG_LIGHT_STATUS_BAR | FLAG_LIGHT_NAVIGATION_BAR);
            } else {
                flags |= FLAG_LIGHT_STATUS_BAR | FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
            if (Build.VERSION.SDK_INT >= 30) {
                // On 30+ the bar appearance goes through WindowInsetsController, after which the
                // legacy flags above no longer change it.
                Api30.setLightBars(w, !dark);
            }
        } catch (Throwable ignored) {
            // Cosmetic only.
        }
        if (root != null) {
            root.setBackgroundColor(color);
        }
        if (webView != null) {
            webView.setBackgroundColor(color);
        }
    }

    // ---------------------------------------------------------------- insets

    /** Passes system-bar insets to the page and keeps the WebView above the keyboard. */
    private void listenForInsets() {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                readInsets(insets);
                return insets;
            }
        });
        root.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets insets) {
        if (insets == null) {
            return;
        }
        int top;
        int bottom;
        int left;
        int right;
        int ime;
        if (Build.VERSION.SDK_INT >= 30) {
            int[] v = Api30.insets(insets);
            top = v[0];
            bottom = v[1];
            left = v[2];
            right = v[3];
            ime = v[4];
        } else {
            top = insets.getSystemWindowInsetTop();
            bottom = insets.getSystemWindowInsetBottom();
            left = insets.getSystemWindowInsetLeft();
            right = insets.getSystemWindowInsetRight();
            // Before Android 11 the keyboard only shows up as a tall bottom inset.
            float density = getResources().getDisplayMetrics().density;
            ime = bottom > 140 * density ? bottom : 0;
        }
        boolean keyboard = ime > 0;
        setImeMargin(keyboard ? ime : 0);
        float density = getResources().getDisplayMetrics().density;
        try {
            JSONObject o = new JSONObject();
            o.put("top", Math.round(top / density * 10) / 10.0);
            // With the keyboard up the WebView stops above it, so nothing needs padding below.
            o.put("bottom", keyboard ? 0 : Math.round(bottom / density * 10) / 10.0);
            o.put("left", Math.round(left / density * 10) / 10.0);
            o.put("right", Math.round(right / density * 10) / 10.0);
            o.put("keyboard", keyboard);
            insetsJson = o.toString();
        } catch (Throwable ignored) {
            return;
        }
        if (pageLoaded) {
            callJs(jsCall("setInsets", insetsJson));
        }
    }

    private void setImeMargin(int px) {
        if (px == imeBottomPx) {
            return;
        }
        imeBottomPx = px;
        WebView wv = webView;
        if (wv == null) {
            return;
        }
        ViewGroup.LayoutParams lp = wv.getLayoutParams();
        if (lp instanceof FrameLayout.LayoutParams) {
            ((FrameLayout.LayoutParams) lp).bottomMargin = px;
            wv.setLayoutParams(lp);
        }
    }

    String insetsJson() {
        return insetsJson;
    }

    /** The page's theme (light or dark), which decides the bar icon colour and the backdrop. */
    void setPageTheme(boolean dark) {
        pageDark = dark;
        applyBarAppearance(dark);
    }

    // ---------------------------------------------------------------- sharing and haptics

    /** Hands text to another app: the given package if it's installed, otherwise the share sheet. */
    void shareText(String text, String targetPackage) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
        if (targetPackage != null && !targetPackage.isEmpty()) {
            Intent direct = new Intent(send);
            direct.setPackage(targetPackage);
            if (tryStartActivity(direct)) {
                return;
            }
        }
        tryStartActivity(Intent.createChooser(send, null));
    }

    boolean isInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    void haptic(String kind) {
        View v = webView != null ? webView : root;
        Haptics.play(this, v, kind);
    }

    /** API 30+ calls, isolated so older devices never load WindowInsetsController. */
    private static final class Api30 {
        /** {top, bottom, left, right, imeBottom} in pixels. */
        static int[] insets(WindowInsets w) {
            android.graphics.Insets bars = w.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = w.getInsets(WindowInsets.Type.ime());
            return new int[]{bars.top, bars.bottom, bars.left, bars.right, ime.bottom};
        }

        static void setLightBars(Window window, boolean light) {
            WindowInsetsController c = window.getInsetsController();
            if (c == null) {
                return;
            }
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(light ? mask : 0, mask);
        }
    }

    /** API 33+: back gestures arrive here (onBackPressed is not called on Android 16 for target 36). */
    private static final class Api33 {
        static void registerBack(final MainActivity activity) {
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackInvokedCallback() {
                        @Override
                        public void onBackInvoked() {
                            activity.handleBack();
                        }
                    });
        }
    }

    // ---------------------------------------------------------------- navigation

    static boolean isAppHost(Uri uri) {
        return uri != null && APP_HOST.equalsIgnoreCase(uri.getHost());
    }

    /** Parses an absolute http(s) URL with a host, or returns null. */
    static Uri httpUri(String url) {
        if (url == null) {
            return null;
        }
        try {
            Uri uri = Uri.parse(url.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (("http".equals(scheme) || "https".equals(scheme)) && host != null && !host.isEmpty()) {
                return uri;
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    /** @return true to cancel the WebView navigation. */
    private boolean handleNavigation(Uri uri, boolean mainFrame) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (isAppHost(uri) || !mainFrame) {
                return false; // our own page stays inside
            }
            openExternal(uri);
            return true;
        }
        if ("about".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)
                || "javascript".equals(scheme)) {
            return false;
        }
        return true; // intent:, file:, content:, market: and friends are blocked
    }

    private static WebResourceResponse emptyResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason,
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private void handleRendererGone(WebView gone) {
        try {
            if (gone.getParent() instanceof ViewGroup) {
                ((ViewGroup) gone.getParent()).removeView(gone);
            }
            gone.destroy();
        } catch (Throwable ignored) {
        }
        if (gone != webView) {
            return;
        }
        webView = null;
        pageLoaded = false;
        if (destroyed || isFinishing()) {
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (rendererCrashes == 0 || now - firstRendererCrashAt > 60000) {
            rendererCrashes = 0;
            firstRendererCrashAt = now;
        }
        rendererCrashes++;
        if (rendererCrashes > 3) {
            showMessage("Gradient Health's page keeps crashing.\n\nPlease close and reopen the app.");
            return;
        }
        // The page restores its state from AndroidBridge.load().
        createWebView(APP_URL);
    }

    /** A file from assets/lazy/ (the page's load-on-demand parts), or a 404. */
    WebResourceResponse assetResponse(String assetPath) {
        if (assetPath.contains("..")) {
            return emptyResponse(404, "Not Found");
        }
        try {
            WebResourceResponse r = new WebResourceResponse(mimeFor(assetPath), null, getAssets().open(assetPath));
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Cache-Control", "no-cache");
            r.setResponseHeaders(headers);
            return r;
        } catch (Throwable t) {
            return emptyResponse(404, "Not Found");
        }
    }

    static String mimeFor(String path) {
        String p = path.toLowerCase(java.util.Locale.ROOT);
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request != null ? request.getUrl() : null;
            if (!isAppHost(uri)) {
                return null; // real network, e.g. https://api.anthropic.com for the AI coach
            }
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path) || "/index.html".equals(path)) {
                try {
                    return new WebResourceResponse("text/html", "utf-8", getAssets().open("index.html"));
                } catch (Throwable t) {
                    return emptyResponse(500, "Internal Server Error");
                }
            }
            if (path.startsWith("/lazy/")) {
                return assetResponse(path.substring(1));
            }
            return emptyResponse(404, "Not Found");
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null) {
                return false;
            }
            return handleNavigation(request.getUrl(), request.isForMainFrame());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != webView || url == null) {
                return;
            }
            if (isAppHost(Uri.parse(url))) {
                pageLoaded = true;
                callJs(jsCall("setInsets", insetsJson));
                flushPendingRoute();
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Returning false would kill the whole app; rebuild the WebView instead.
            handleRendererGone(view);
            return true;
        }
    }
}
