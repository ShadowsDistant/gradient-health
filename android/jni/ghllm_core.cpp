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

// A saved copy of the recurrent layers' state after the first n tokens of the cache.
struct checkpoint {
    size_t n;
    std::vector<uint8_t> state;
};

struct ghllm {
    llama_model *model = nullptr;
    llama_context *ctx = nullptr;
    const llama_vocab *vocab = nullptr;
    int32_t n_ctx = 0;
    int32_t n_batch = 0;
    std::vector<llama_token> cached;  // what the context's memory holds (sequence 0)
    std::atomic<bool> stop{false};
    // Models with recurrent layers (Qwen3.5's gated delta-net) can't rewind their state, only
    // restore a copy of it, so one is kept at the end of the first turn (the system prompt, which is
    // the same for every question) and the next question starts from there.
    bool partial = false;
    llama_token im_end = LLAMA_TOKEN_NULL;
    llama_token newline = LLAMA_TOKEN_NULL;
    std::vector<checkpoint> checkpoints;  // oldest first, each n smaller than the next
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
    g->checkpoints.clear();
}

// Cuts the memory back to its first n tokens. A model with recurrent layers goes back to the latest
// checkpoint at or before n instead (or to nothing). Returns how many tokens are kept.
size_t cut(ghllm *g, size_t n) {
    llama_memory_t mem = llama_get_memory(g->ctx);
    if (!g->partial) {
        if (llama_memory_seq_rm(mem, 0, (llama_pos) n, -1)) {
            g->cached.resize(std::min(n, g->cached.size()));
            return g->cached.size();
        }
        forget(g);
        return 0;
    }
    while (!g->checkpoints.empty() && g->checkpoints.back().n > n) g->checkpoints.pop_back();
    if (!g->checkpoints.empty()) {
        const checkpoint &cp = g->checkpoints.back();
        // The attention layers keep their cache up to cp.n; the recurrent state comes from the copy.
        if (llama_state_seq_set_data_ext(g->ctx, cp.state.data(), cp.state.size(), 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY) > 0 &&
            llama_memory_seq_rm(mem, 0, (llama_pos) cp.n, -1)) {
            g->cached.resize(cp.n);
            return cp.n;
        }
    }
    forget(g);
    return 0;
}

// Saves the recurrent state as it is now (after every token in the cache).
void save_checkpoint(ghllm *g) {
    const size_t n = g->cached.size();
    if (!g->partial || n == 0 || (!g->checkpoints.empty() && g->checkpoints.back().n >= n)) return;
    checkpoint cp{n, {}};
    cp.state.resize(llama_state_seq_get_size_ext(g->ctx, 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY));
    if (cp.state.empty() ||
        llama_state_seq_get_data_ext(g->ctx, cp.state.data(), cp.state.size(), 0, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY) != cp.state.size()) {
        return;
    }
    if (g->checkpoints.size() >= 3) g->checkpoints.erase(g->checkpoints.begin());
    g->checkpoints.push_back(std::move(cp));
}

// Where the first turn ends (after its <|im_end|> and line break), or 0 if the prompt has none.
size_t first_turn_end(const ghllm *g, const std::vector<llama_token> &toks) {
    if (g->im_end == LLAMA_TOKEN_NULL) return 0;
    for (size_t i = 0; i < toks.size(); i++) {
        if (toks[i] != g->im_end) continue;
        size_t end = i + 1;
        if (end < toks.size() && toks[end] == g->newline) end++;
        return end;
    }
    return 0;
}

// The token a piece of text is, when it's exactly one (a special token such as <|im_end|>).
llama_token one_token(const llama_vocab *vocab, const char *text) {
    llama_token t[2];
    const int32_t n = llama_tokenize(vocab, text, (int32_t) std::strlen(text), t, 2, false, true);
    return n == 1 ? t[0] : LLAMA_TOKEN_NULL;
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
    g->partial = llama_model_is_recurrent(model) || llama_model_is_hybrid(model);
    g->im_end = one_token(g->vocab, "<|im_end|>");
    g->newline = one_token(g->vocab, "\n");
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
    const bool read_only = gen && gen->max_tokens == 0;
    int32_t max_tokens = gen && gen->max_tokens > 0 ? gen->max_tokens : 256;
    if (nt + (read_only ? 0 : 16) > g->n_ctx) return done(GHLLM_ERR_TOO_LONG);
    max_tokens = std::min(max_tokens, g->n_ctx - nt);

    // Keep what the memory already holds of this prompt: the last answer's prompt when this one
    // starts the same way, or (with recurrent layers) the checkpoint at the end of the system prompt.
    size_t common = 0;
    while (common < g->cached.size() && common < toks.size() && g->cached[common] == toks[common]) common++;
    if (read_only && common == toks.size()) {
        s.reused_tokens = nt;
        s.finish = 0;
        return done(GHLLM_OK);
    }
    if (common == toks.size()) common--;  // read the last token again, for fresh logits
    if (common < g->cached.size()) common = cut(g, common);
    s.reused_tokens = (int32_t) common;

    // The prompt, in batches, with a checkpoint where the first turn ends.
    const size_t turn_end = first_turn_end(g, toks);
    const double t0 = now_ms();
    const int32_t total = nt - (int32_t) common;
    int32_t read = 0;
    for (size_t i = common; i < toks.size();) {
        int32_t chunk = std::min((int32_t) (toks.size() - i), g->n_batch);
        if (i < turn_end && i + (size_t) chunk > turn_end) chunk = (int32_t) (turn_end - i);
        const int32_t rc = llama_decode(g->ctx, llama_batch_get_one(toks.data() + i, chunk));
        if (rc == 2 || g->stop.load()) {
            cut(g, g->cached.size());  // back to what's whole (a stopped batch may be half written)
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
        if (i == turn_end) save_checkpoint(g);
        if (on_progress) on_progress(ud, read, total);
    }
    s.prompt_ms = now_ms() - t0;
    if (read_only) {
        s.finish = 0;
        return done(GHLLM_OK);
    }

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
            cut(g, g->cached.size());
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
