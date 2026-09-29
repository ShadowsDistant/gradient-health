// See ghllm_core.h.
#include "ghllm_core.h"

#include "ggml-backend.h"
#include "llama.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

struct ghllm {
    llama_model *model = nullptr;
    llama_context *ctx = nullptr;
    const llama_vocab *vocab = nullptr;
    int32_t n_ctx = 0;
    int32_t n_batch = 0;
    std::vector<llama_token> cached;  // what the context's memory holds (sequence 0)
    std::atomic<bool> stop{false};
};

namespace {

std::once_flag g_init;
std::mutex g_log_mu;
std::string g_last_error;  // the last error llama.cpp logged, for load failures
std::string g_backend;     // which CPU backend variant was loaded
std::string g_info;

double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

void on_log(ggml_log_level level, const char *text, void *) {
    if (!text) return;
    std::lock_guard<std::mutex> lock(g_log_mu);
    std::string line(text);
    while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
    if (line.empty()) return;
    if (level == GGML_LOG_LEVEL_ERROR) g_last_error = line;
    if (line.find("loaded CPU backend") != std::string::npos || line.find("libggml-cpu") != std::string::npos) g_backend = line;
}

std::string last_error(const char *fallback) {
    std::lock_guard<std::mutex> lock(g_log_mu);
    return g_last_error.empty() ? std::string(fallback) : g_last_error;
}

// How many leading bytes of s end on a whole UTF-8 character.
size_t utf8_whole(const std::string &s) {
    const size_t n = s.size();
    for (size_t back = 1; back <= 4 && back <= n; back++) {
        const unsigned char c = (unsigned char) s[n - back];
        if ((c & 0xC0) == 0x80) continue;  // a continuation byte: keep looking for the lead
        const size_t need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
        return back >= need ? n : n - back;
    }
    return n;  // only continuation bytes: malformed, pass it on
}

void forget(ghllm *g) {
    llama_memory_clear(llama_get_memory(g->ctx), true);
    g->cached.clear();
}

}  // namespace

extern "C" {

void ghllm_init(const char *backend_dir) {
    std::call_once(g_init, [backend_dir] {
        llama_log_set(on_log, nullptr);
#ifdef GHLLM_BACKEND_DL
        if (backend_dir && *backend_dir) ggml_backend_load_all_from_path(backend_dir);
        else ggml_backend_load_all();
#else
        (void) backend_dir;
#endif
        llama_backend_init();
    });
}

ghllm *ghllm_load(const char *path, int32_t n_ctx, int32_t n_batch, int32_t n_threads,
                  ghllm_load_cb on_load, void *ud, char *err, size_t err_len) {
    auto fail = [&](const std::string &why) -> ghllm * {
        if (err && err_len) std::snprintf(err, err_len, "%s", why.c_str());
        return nullptr;
    };
    {
        std::lock_guard<std::mutex> lock(g_log_mu);
        g_last_error.clear();
    }
    struct Load {
        ghllm_load_cb cb;
        void *ud;
    } load{on_load, ud};
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    if (on_load) {
        mp.progress_callback = [](float p, void *u) -> bool {
            auto *l = static_cast<Load *>(u);
            return l->cb(l->ud, p) != 0;
        };
        mp.progress_callback_user_data = &load;
    }
    llama_model *model = llama_model_load_from_file(path, mp);
    if (!model) return fail(last_error("the model file couldn't be loaded"));

    llama_context_params cp = llama_context_default_params();
    const int32_t train = llama_model_n_ctx_train(model);
    cp.n_ctx = (uint32_t) (train > 0 && n_ctx > train ? train : n_ctx);
    cp.n_batch = (uint32_t) n_batch;
    cp.n_ubatch = (uint32_t) n_batch;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    cp.no_perf = true;
    llama_context *ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        return fail(last_error("not enough memory for the model"));
    }
    auto *g = new ghllm();
    g->model = model;
    g->ctx = ctx;
    g->vocab = llama_model_get_vocab(model);
    g->n_ctx = (int32_t) llama_n_ctx(ctx);
    g->n_batch = n_batch;
    llama_set_abort_callback(ctx, [](void *u) -> bool { return static_cast<ghllm *>(u)->stop.load(); }, g);
    return g;
}

int ghllm_generate(ghllm *g, const char *prompt, const ghllm_gen *gen, ghllm_piece_cb on_piece,
                   ghllm_progress_cb on_progress, void *ud, ghllm_stats *out) {
    ghllm_stats s{};
    s.finish = 3;
    g->stop.store(false);
    auto done = [&](int code) {
        if (out) *out = s;
        return code;
    };

    // The prompt's tokens (special tokens such as <|im_start|> are parsed, not spelled out).
    const int32_t len = (int32_t) std::strlen(prompt);
    std::vector<llama_token> toks((size_t) len + 8);
    int32_t nt = llama_tokenize(g->vocab, prompt, len, toks.data(), (int32_t) toks.size(), true, true);
    if (nt < 0 && nt != INT32_MIN) {
        toks.resize((size_t) -nt);
        nt = llama_tokenize(g->vocab, prompt, len, toks.data(), (int32_t) toks.size(), true, true);
    }
    if (nt <= 0) return done(GHLLM_ERR_TOKENIZE);
    toks.resize((size_t) nt);
    s.prompt_tokens = nt;
    int32_t max_tokens = gen && gen->max_tokens > 0 ? gen->max_tokens : 256;
    if (nt + 16 > g->n_ctx) return done(GHLLM_ERR_TOO_LONG);
    max_tokens = std::min(max_tokens, g->n_ctx - nt);

    // Keep what the last answer left in memory when this prompt starts the same way (always
    // reading at least the last token again, for fresh logits). Models with recurrent layers can't
    // cut a sequence part way; they read the whole prompt again.
    llama_memory_t mem = llama_get_memory(g->ctx);
    size_t common = 0;
    while (common < g->cached.size() && common + 1 < toks.size() && g->cached[common] == toks[common]) common++;
    if (common < g->cached.size() && !llama_memory_seq_rm(mem, 0, (llama_pos) common, -1)) {
        forget(g);
        common = 0;
    }
    g->cached.resize(common);
    s.reused_tokens = (int32_t) common;

    const double t0 = now_ms();
    const int32_t total = nt - (int32_t) common;
    int32_t read = 0;
    for (size_t i = common; i < toks.size();) {
        const int32_t chunk = std::min((int32_t) (toks.size() - i), g->n_batch);
        const int32_t rc = llama_decode(g->ctx, llama_batch_get_one(toks.data() + i, chunk));
        if (rc == 2 || g->stop.load()) {
            forget(g);
            s.aborted = 1;
            s.finish = 2;
            s.prompt_ms = now_ms() - t0;
            return done(GHLLM_OK);
        }
        if (rc != 0) {
            forget(g);
            return done(GHLLM_ERR_DECODE);
        }
        g->cached.insert(g->cached.end(), toks.begin() + (long) i, toks.begin() + (long) i + chunk);
        i += (size_t) chunk;
        read += chunk;
        if (on_progress) on_progress(ud, read, total);
    }
    s.prompt_ms = now_ms() - t0;

    // Sampling: the grammar first (it rules tokens out), then the usual chain.
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (gen && gen->grammar && *gen->grammar) {
        llama_sampler *gr = llama_sampler_init_grammar(g->vocab, gen->grammar, "root");
        if (!gr) {
            llama_sampler_free(smpl);
            return done(GHLLM_ERR_GRAMMAR);
        }
        llama_sampler_chain_add(smpl, gr);
    }
    const float temp = gen ? gen->temperature : 0.7f;
    if (gen && gen->repeat_penalty > 1.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(llama_vocab_n_tokens(g->vocab), 64, gen->repeat_penalty, 0.0f, 0.0f));
    }
    if (temp <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        if (gen && gen->top_k > 0) llama_sampler_chain_add(smpl, llama_sampler_init_top_k(gen->top_k));
        if (gen && gen->top_p > 0.0f && gen->top_p < 1.0f) llama_sampler_chain_add(smpl, llama_sampler_init_top_p(gen->top_p, 1));
        if (gen && gen->min_p > 0.0f) llama_sampler_chain_add(smpl, llama_sampler_init_min_p(gen->min_p, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(gen && gen->seed ? gen->seed : LLAMA_DEFAULT_SEED));
    }

    const double t1 = now_ms();
    std::string pending;  // bytes that don't end on a whole character yet
    s.finish = 1;         // the token limit, unless the turn ends first
    int code = GHLLM_OK;
    for (int32_t k = 0; k < max_tokens; k++) {
        if (g->stop.load()) {
            s.aborted = 1;
            s.finish = 2;
            break;
        }
        llama_token tok = llama_sampler_sample(smpl, g->ctx, -1);
        if (llama_vocab_is_eog(g->vocab, tok)) {
            s.finish = 0;
            break;
        }
        char buf[256];
        const int32_t n = llama_token_to_piece(g->vocab, tok, buf, (int32_t) sizeof buf, 0, false);
        if (n > 0) pending.append(buf, (size_t) n);
        const size_t whole = utf8_whole(pending);
        if (whole > 0) {
            if (on_piece && on_piece(ud, pending.data(), (int) whole)) g->stop.store(true);
            pending.erase(0, whole);
        }
        s.tokens++;
        const int32_t rc = llama_decode(g->ctx, llama_batch_get_one(&tok, 1));
        if (rc == 2) {
            forget(g);
            s.aborted = 1;
            s.finish = 2;
            break;
        }
        if (rc != 0) {
            forget(g);
            s.finish = 3;
            code = GHLLM_ERR_DECODE;
            break;
        }
        g->cached.push_back(tok);
    }
    if (!pending.empty() && on_piece) on_piece(ud, pending.data(), (int) pending.size());
    s.gen_ms = now_ms() - t1;
    llama_sampler_free(smpl);
    return done(code);
}

void ghllm_abort(ghllm *g) {
    if (g) g->stop.store(true);
}

const char *ghllm_system_info(void) {
    std::lock_guard<std::mutex> lock(g_log_mu);
    g_info = llama_print_system_info();
    if (!g_backend.empty()) g_info += " | " + g_backend;
    return g_info.c_str();
}

int32_t ghllm_n_ctx(const ghllm *g) { return g ? g->n_ctx : 0; }

void ghllm_free(ghllm *g) {
    if (!g) return;
    if (g->ctx) llama_free(g->ctx);
    if (g->model) llama_model_free(g->model);
    delete g;
}

}  // extern "C"
