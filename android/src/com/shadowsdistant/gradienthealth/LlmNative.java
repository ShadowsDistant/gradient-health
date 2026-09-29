package com.shadowsdistant.gradienthealth;

import android.content.Context;
import android.os.Build;

import java.io.File;

/**
 * The native engine for the on-device coach (libghllm.so over llama.cpp, see android/jni/). Only
 * {@link LlmService} loads it, in its own process, so a crash in native code can't take the app
 * down. The library ships for arm64 phones; elsewhere, or in a build made without the NDK, the
 * page falls back to its in-app (WebAssembly) engine.
 */
final class LlmNative {
    private LlmNative() {
    }

    /** Calls back on the thread running load/generate. */
    interface Listener {
        /** Load progress 0..1; false cancels the load. */
        boolean onLoad(float progress);

        /** A piece of the answer (UTF-8, whole characters); true stops the answer. */
        boolean onPiece(byte[] utf8);

        /** Prompt tokens read so far (after any reused prefix), out of total. */
        void onProgress(int done, int total);
    }

    static final int OK = 0;
    static final int ERR_TOO_LONG = 1;
    static final int ERR_DECODE = 2;
    static final int ERR_GRAMMAR = 3;
    static final int ERR_TOKENIZE = 4;

    private static Boolean loaded;

    /** Whether this install carries the native engine for this phone (checked without loading it). */
    static boolean packaged(Context context) {
        if (!is64BitArm()) {
            return false;
        }
        String dir = context.getApplicationInfo().nativeLibraryDir;
        return dir != null && new File(dir, "libghllm.so").isFile();
    }

    static boolean is64BitArm() {
        for (String abi : Build.SUPPORTED_ABIS) {
            if ("arm64-v8a".equals(abi)) {
                return true;
            }
        }
        return false;
    }

    /** Loads the library and picks the CPU backend for this phone. False if it can't run here. */
    static synchronized boolean start(Context context) {
        if (loaded != null) {
            return loaded;
        }
        try {
            System.loadLibrary("ghllm");
            init(context.getApplicationInfo().nativeLibraryDir);
            loaded = Boolean.TRUE;
        } catch (Throwable t) {
            loaded = Boolean.FALSE;
        }
        return loaded;
    }

    /** Threads for the CPU: the big cores on a typical 8-core phone, half the cores otherwise. */
    static int threads() {
        int cores = Runtime.getRuntime().availableProcessors();
        return cores >= 8 ? 4 : Math.max(1, cores / 2);
    }

    static native void init(String libDir);

    /** A model handle; throws IllegalStateException (with the reason) if it can't be loaded. */
    static native long load(String path, int nCtx, int nBatch, int nThreads, Listener listener);

    /** Streams the answer to listener; stats (7 numbers) are filled in. Returns OK or an ERR_ code. */
    static native int generate(long handle, byte[] prompt, float temperature, float topP, float minP, int topK,
            float repeatPenalty, int maxTokens, int seed, byte[] grammar, Listener listener, double[] stats);

    /** Safe from any thread. */
    static native void abort(long handle);

    static native int nCtx(long handle);

    static native String systemInfo();

    static native void free(long handle);
}
