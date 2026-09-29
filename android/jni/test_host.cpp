// A desktop test for the native engine's core, run against the tiny random-weight model that
// scripts/make-tiny-gguf.py writes (its words are nonsense; what's checked is that loading,
// streaming, stopping, the grammar and the prompt cache behave).
//   ghllm_test build/tiny-qwen35.gguf
#include "ghllm_core.h"

#include <cstdio>
#include <cstring>
#include <string>

static int failures = 0, passes = 0;
static void check(const char *name, bool ok, const std::string &detail = "") {
    if (ok) {
        passes++;
        std::printf("  ok  %s\n", name);
    } else {
        failures++;
        std::printf("  FAIL %s %s\n", name, detail.c_str());
    }
}

struct Run {
    std::string text;
    int pieces = 0;
    int progress_calls = 0;
    int last_done = 0, last_total = 0;
    int stop_after = -1;  // stop once this many pieces arrived
    bool bad_utf8 = false;
    ghllm *stop_reading = nullptr;  // stops the engine after the first batch of the prompt
};

static bool valid_utf8(const char *s, int n) {
    for (int i = 0; i < n;) {
        unsigned char c = (unsigned char) s[i];
        int need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 0;
        if (!need || i + need > n) return false;
        for (int k = 1; k < need; k++) if (((unsigned char) s[i + k] & 0xC0) != 0x80) return false;
        i += need;
    }
    return true;
}

static int on_piece(void *ud, const char *bytes, int len) {
    auto *r = static_cast<Run *>(ud);
    r->text.append(bytes, (size_t) len);
    r->pieces++;
    if (!valid_utf8(bytes, len)) r->bad_utf8 = true;
    return r->stop_after >= 0 && r->pieces >= r->stop_after ? 1 : 0;
}
static void on_progress(void *ud, int done, int total) {
    auto *r = static_cast<Run *>(ud);
    r->progress_calls++;
    r->last_done = done;
    r->last_total = total;
    if (r->stop_reading) ghllm_abort(r->stop_reading);
}
static int on_load(void *ud, float p) {
    *static_cast<float *>(ud) = p;
    return 1;
}

#define SYSTEM "<|im_start|>system\nYou are a fitness coach. Be brief. Their data: sleep 7 h 10 min, steps 8400.<|im_end|>\n"
#define ASK(q) SYSTEM "<|im_start|>user\n" q "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
static const char *PROMPT = ASK("How is my sleep?");

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "build/tiny-qwen35.gguf";
    ghllm_init(nullptr);
    char err[512] = {0};
    float loaded = 0;
    ghllm *g = ghllm_load(path, 2048, 64, 2, on_load, &loaded, err, sizeof err);
    check("loads the model", g != nullptr, err);
    if (!g) return 1;
    check("reports load progress to the end", loaded > 0.99f, std::to_string(loaded));
    check("has a context", ghllm_n_ctx(g) >= 1024, std::to_string(ghllm_n_ctx(g)));
    check("describes the CPU", std::strlen(ghllm_system_info()) > 10);

    ghllm_gen gen{};
    gen.temperature = 0.6f;
    gen.top_p = 0.8f;
    gen.top_k = 20;
    gen.repeat_penalty = 1.05f;
    gen.max_tokens = 24;
    gen.seed = 7;

    Run a;
    ghllm_stats s{};
    int rc = ghllm_generate(g, PROMPT, &gen, on_piece, on_progress, &a, &s);
    check("answers", rc == GHLLM_OK && s.tokens > 0 && !a.text.empty(), "rc=" + std::to_string(rc) + " tokens=" + std::to_string(s.tokens));
    check("streams in pieces that are whole characters", a.pieces > 0 && !a.bad_utf8);
    check("reports reading the prompt", a.progress_calls > 0 && a.last_done == a.last_total && a.last_total == s.prompt_tokens - s.reused_tokens,
          std::to_string(a.last_done) + "/" + std::to_string(a.last_total));
    check("stops at the token limit or the end of the turn", s.tokens <= 24 && (s.finish == 0 || s.finish == 1));
    check("counts the time", s.prompt_ms > 0 && s.gen_ms > 0);

    // The same question again: whatever the model can keep of the prompt, it keeps.
    Run b;
    ghllm_stats s2{};
    rc = ghllm_generate(g, PROMPT, &gen, on_piece, on_progress, &b, &s2);
    check("answers a second time", rc == GHLLM_OK && s2.tokens > 0);
    check("the prompt cache never claims more than the prompt", s2.reused_tokens >= 0 && s2.reused_tokens < s2.prompt_tokens);

    // Stop part way.
    Run c;
    c.stop_after = 2;
    ghllm_stats s3{};
    gen.max_tokens = 64;
    rc = ghllm_generate(g, PROMPT, &gen, on_piece, nullptr, &c, &s3);
    check("stops when asked", rc == GHLLM_OK && s3.aborted == 1 && s3.finish == 2 && s3.tokens <= 3, "tokens=" + std::to_string(s3.tokens));

    // A grammar keeps the output to its shape, whatever the weights say.
    Run d;
    ghllm_gen jg = gen;
    jg.max_tokens = 40;
    jg.grammar = "root ::= \"{\\\"minutes\\\": \" [1-9] [0-9] \"}\"";
    ghllm_stats s4{};
    rc = ghllm_generate(g, PROMPT, &jg, on_piece, nullptr, &d, &s4);
    const bool shaped = d.text.size() == 15 && d.text.rfind("{\"minutes\": ", 0) == 0 && d.text.back() == '}';
    check("a grammar shapes the answer", rc == GHLLM_OK && shaped, d.text);
    jg.grammar = "root ::= (";
    Run e;
    rc = ghllm_generate(g, PROMPT, &jg, on_piece, nullptr, &e, nullptr);
    check("a broken grammar is an error, not a crash", rc == GHLLM_ERR_GRAMMAR, std::to_string(rc));

    // Too long for the context.
    std::string big;
    for (int i = 0; i < 4000; i++) big += "word ";
    Run f;
    rc = ghllm_generate(g, big.c_str(), &gen, on_piece, nullptr, &f, nullptr);
    check("a prompt too long for the context says so", rc == GHLLM_ERR_TOO_LONG, std::to_string(rc));

    // Still usable after all that.
    Run h;
    gen.max_tokens = 8;
    rc = ghllm_generate(g, PROMPT, &gen, on_piece, nullptr, &h, nullptr);
    check("still answers afterwards", rc == GHLLM_OK && !h.text.empty());

    // The system prompt, read ahead of the first question (max_tokens 0), stays cached: each new
    // question reads only its own turn, even on this model's recurrent layers (from a checkpoint).
    ghllm_gen greedy = gen;
    greedy.temperature = 0;
    greedy.repeat_penalty = 1;
    greedy.max_tokens = 0;
    ghllm_stats p0{};
    Run r0;
    rc = ghllm_generate(g, "<|im_start|>system\nA different prompt, to start from nothing.<|im_end|>\n", &greedy, on_piece, nullptr, &r0, &p0);
    ghllm_stats p1{};
    Run r1;
    rc = ghllm_generate(g, SYSTEM, &greedy, on_piece, on_progress, &r1, &p1);
    const int sys = p1.prompt_tokens;
    check("reads a prompt ahead without answering", rc == GHLLM_OK && p1.tokens == 0 && r1.text.empty() && r1.last_done == sys && p1.finish == 0,
          "rc=" + std::to_string(rc) + " done=" + std::to_string(r1.last_done) + " of " + std::to_string(sys));
    ghllm_stats p2{};
    Run r2;
    rc = ghllm_generate(g, SYSTEM, &greedy, on_piece, on_progress, &r2, &p2);
    check("reading it again does nothing", rc == GHLLM_OK && p2.reused_tokens == sys && r2.progress_calls == 0);
    greedy.max_tokens = 12;
    ghllm_stats q1{};
    Run a1;
    rc = ghllm_generate(g, ASK("How is my sleep?"), &greedy, on_piece, nullptr, &a1, &q1);
    check("the first question keeps the system prompt", rc == GHLLM_OK && q1.reused_tokens == sys && q1.tokens > 0,
          std::to_string(q1.reused_tokens) + " of " + std::to_string(sys));
    ghllm_stats q2{};
    Run a2;
    rc = ghllm_generate(g, ASK("Should I walk more today?"), &greedy, on_piece, nullptr, &a2, &q2);
    check("so does the next, after the last answer filled the cache", rc == GHLLM_OK && q2.reused_tokens == sys && !a2.text.empty(),
          std::to_string(q2.reused_tokens) + " of " + std::to_string(sys));
    // Stopped while reading a long question: the system prompt is still there for the next one.
    std::string longq = ASK("");
    std::string words;
    for (int i = 0; i < 12; i++) words += "Tell me about my steps and sleep. ";
    longq.insert(longq.find("<|im_end|>\n<|im_start|>assistant"), words);
    Run st;
    st.stop_reading = g;
    ghllm_stats q3{};
    rc = ghllm_generate(g, longq.c_str(), &greedy, on_piece, on_progress, &st, &q3);
    check("stops while reading the prompt", rc == GHLLM_OK && q3.aborted == 1 && q3.tokens == 0 && st.last_done < st.last_total,
          "rc=" + std::to_string(rc) + " read " + std::to_string(st.last_done) + " of " + std::to_string(st.last_total));
    ghllm_stats q4{};
    Run a4;
    rc = ghllm_generate(g, ASK("Should I walk more today?"), &greedy, on_piece, nullptr, &a4, &q4);
    check("and keeps the system prompt after stopping", rc == GHLLM_OK && q4.reused_tokens == sys, std::to_string(q4.reused_tokens));
    check("an answer from the checkpoint is the same as one read from scratch", a4.text == a2.text, a2.text + " | " + a4.text);
    // From scratch (a different system prompt first), the same question gives the same answer.
    greedy.max_tokens = 0;
    rc = ghllm_generate(g, "<|im_start|>system\nSomething else entirely.<|im_end|>\n", &greedy, on_piece, nullptr, &r0, nullptr);
    greedy.max_tokens = 12;
    ghllm_stats q5{};
    Run a5;
    rc = ghllm_generate(g, ASK("Should I walk more today?"), &greedy, on_piece, nullptr, &a5, &q5);
    check("(read from scratch this time)", rc == GHLLM_OK && q5.reused_tokens < sys && a5.text == a2.text, std::to_string(q5.reused_tokens) + ": " + a5.text);

    ghllm_free(g);
    char err2[256] = {0};
    check("a missing file fails cleanly", ghllm_load("/nonexistent.gguf", 512, 32, 1, nullptr, nullptr, err2, sizeof err2) == nullptr && err2[0], err2);

    std::printf("\n%d passed, %d failed\n", passes, failures);
    return failures ? 1 : 0;
}
