// JNI for com.shadowsdistant.gradienthealth.LlmNative: a thin shim over ghllm_core. Text crosses as
// UTF-8 byte arrays (JNI's own string form can't carry every character, emoji included).
#include <jni.h>

#include <android/log.h>

#include <cstdint>
#include <string>

#include "ghllm_core.h"

namespace {

struct Callbacks {
    JNIEnv *env;
    jobject listener;
    jmethodID on_load;
    jmethodID on_piece;
    jmethodID on_progress;
};

bool pending_exception(JNIEnv *env) {
    if (!env->ExceptionCheck()) return false;
    env->ExceptionClear();
    return true;
}

int load_cb(void *ud, float progress) {
    auto *c = static_cast<Callbacks *>(ud);
    const jboolean go = c->env->CallBooleanMethod(c->listener, c->on_load, (jfloat) progress);
    return pending_exception(c->env) ? 0 : (go ? 1 : 0);
}

int piece_cb(void *ud, const char *bytes, int len) {
    auto *c = static_cast<Callbacks *>(ud);
    jbyteArray arr = c->env->NewByteArray(len);
    if (!arr) return 1;
    c->env->SetByteArrayRegion(arr, 0, len, reinterpret_cast<const jbyte *>(bytes));
    const jboolean stop = c->env->CallBooleanMethod(c->listener, c->on_piece, arr);
    c->env->DeleteLocalRef(arr);
    return pending_exception(c->env) ? 1 : (stop ? 1 : 0);
}

void progress_cb(void *ud, int done, int total) {
    auto *c = static_cast<Callbacks *>(ud);
    c->env->CallVoidMethod(c->listener, c->on_progress, (jint) done, (jint) total);
    pending_exception(c->env);
}

Callbacks callbacks(JNIEnv *env, jobject listener) {
    jclass cls = env->GetObjectClass(listener);
    return Callbacks{env, listener, env->GetMethodID(cls, "onLoad", "(F)Z"), env->GetMethodID(cls, "onPiece", "([B)Z"),
                     env->GetMethodID(cls, "onProgress", "(II)V")};
}

std::string utf(JNIEnv *env, jstring s) {
    if (!s) return "";
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

std::string bytes(JNIEnv *env, jbyteArray a) {
    if (!a) return "";
    const jsize n = env->GetArrayLength(a);
    std::string out((size_t) n, '\0');
    if (n) env->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte *>(&out[0]));
    return out;
}

inline ghllm *from(jlong h) { return reinterpret_cast<ghllm *>(static_cast<intptr_t>(h)); }

}  // namespace

extern "C" {

JNIEXPORT void JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_init(JNIEnv *env, jclass, jstring lib_dir) {
    const std::string dir = utf(env, lib_dir);
    ghllm_init(dir.empty() ? nullptr : dir.c_str());
}

JNIEXPORT jlong JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_load(JNIEnv *env, jclass, jstring path, jint n_ctx,
                                                                             jint n_batch, jint n_threads, jobject listener) {
    Callbacks cb = callbacks(env, listener);
    char err[512] = {0};
    ghllm *g = ghllm_load(utf(env, path).c_str(), n_ctx, n_batch, n_threads, load_cb, &cb, err, sizeof err);
    if (!g) {
        __android_log_print(ANDROID_LOG_WARN, "ghllm", "load failed: %s", err);
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), err[0] ? err : "the model couldn't be loaded");
        return 0;
    }
    return static_cast<jlong>(reinterpret_cast<intptr_t>(g));
}

// stats_out: [prompt tokens, reused tokens, tokens, prompt ms, generation ms, aborted, finish]
JNIEXPORT jint JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_generate(
    JNIEnv *env, jclass, jlong h, jbyteArray prompt, jfloat temperature, jfloat top_p, jfloat min_p, jint top_k,
    jfloat repeat_penalty, jint max_tokens, jint seed, jbyteArray grammar, jobject listener, jdoubleArray stats_out) {
    if (!h) return GHLLM_ERR_DECODE;
    const std::string p = bytes(env, prompt);
    const std::string gr = bytes(env, grammar);
    ghllm_gen gen{temperature, top_p, min_p, top_k, repeat_penalty, max_tokens, (uint32_t) seed, gr.empty() ? nullptr : gr.c_str()};
    Callbacks cb = callbacks(env, listener);
    ghllm_stats s{};
    const int rc = ghllm_generate(from(h), p.c_str(), &gen, piece_cb, progress_cb, &cb, &s);
    if (stats_out && env->GetArrayLength(stats_out) >= 7) {
        const jdouble v[7] = {(double) s.prompt_tokens, (double) s.reused_tokens, (double) s.tokens, s.prompt_ms, s.gen_ms,
                              (double) s.aborted, (double) s.finish};
        env->SetDoubleArrayRegion(stats_out, 0, 7, v);
    }
    return rc;
}

JNIEXPORT void JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_abort(JNIEnv *, jclass, jlong h) {
    if (h) ghllm_abort(from(h));
}

JNIEXPORT jint JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_nCtx(JNIEnv *, jclass, jlong h) {
    return h ? ghllm_n_ctx(from(h)) : 0;
}

JNIEXPORT jstring JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_systemInfo(JNIEnv *env, jclass) {
    return env->NewStringUTF(ghllm_system_info());
}

JNIEXPORT void JNICALL Java_com_shadowsdistant_gradienthealth_LlmNative_free(JNIEnv *, jclass, jlong h) {
    if (h) ghllm_free(from(h));
}

}  // extern "C"
