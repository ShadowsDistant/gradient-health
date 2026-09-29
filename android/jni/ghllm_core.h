// The on-device coach's native engine: a small C API over llama.cpp. One model and one context at a
// time; generation streams UTF-8 bytes to a callback and can be stopped from another thread. The
// prompt arrives already formatted (the app builds the chat template in JS), so this stays free of
// chat and JSON logic. The same code runs in the app (through ghllm_jni.cpp) and in a host test.
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ghllm ghllm;

// Load progress (0..1). Return 0 to cancel the load.
typedef int (*ghllm_load_cb)(void *ud, float progress);
// A piece of the answer: bytes that end on a whole UTF-8 character. Return nonzero to stop.
typedef int (*ghllm_piece_cb)(void *ud, const char *bytes, int len);
// Reading the prompt: tokens done out of total (after any reused prefix).
typedef void (*ghllm_progress_cb)(void *ud, int done, int total);

typedef struct {
    float temperature;     // 0 = greedy
    float top_p;           // 1 = off
    float min_p;           // 0 = off
    int32_t top_k;         // 0 = off
    float repeat_penalty;  // 1 = off
    int32_t max_tokens;    // 0 = only read the prompt (to have it cached for the next question)
    uint32_t seed;
    const char *grammar;   // GBNF with a "root" rule, or NULL
} ghllm_gen;

typedef struct {
    int32_t prompt_tokens;
    int32_t reused_tokens;  // prompt tokens kept from the cache (the last answer, or a checkpoint)
    int32_t tokens;         // generated
    double prompt_ms;
    double gen_ms;
    int32_t aborted;
    int32_t finish;         // 0 = end of turn, 1 = token limit, 2 = stopped, 3 = error
} ghllm_stats;

// Codes returned by ghllm_generate.
enum {
    GHLLM_OK = 0,
    GHLLM_ERR_TOO_LONG = 1,  // the prompt doesn't fit the context
    GHLLM_ERR_DECODE = 2,    // llama_decode failed
    GHLLM_ERR_GRAMMAR = 3,   // the grammar didn't parse
    GHLLM_ERR_TOKENIZE = 4,
};

// Once per process: backend_dir is where the CPU backend variants live (the app's native library
// directory); NULL when they're linked in.
void ghllm_init(const char *backend_dir);

// NULL on failure, with a reason in err.
ghllm *ghllm_load(const char *path, int32_t n_ctx, int32_t n_batch, int32_t n_threads,
                  ghllm_load_cb on_load, void *ud, char *err, size_t err_len);

int ghllm_generate(ghllm *g, const char *prompt, const ghllm_gen *gen, ghllm_piece_cb on_piece,
                   ghllm_progress_cb on_progress, void *ud, ghllm_stats *stats);

// Safe from any thread: stops the prompt reading or the answer in progress.
void ghllm_abort(ghllm *g);

// The CPU features and backends in use, for the self-test.
const char *ghllm_system_info(void);
int32_t ghllm_n_ctx(const ghllm *g);

void ghllm_free(ghllm *g);

#ifdef __cplusplus
}
#endif
