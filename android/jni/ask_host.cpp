// Asks a real model two questions the way the app does (ChatML with the empty think block, the
// coach's kind of system prompt, then the same system prompt again, as the chat's second question)
// and one Tailor my plan request under its grammar, and prints the answers and timings. For
// .github/workflows/model-check.yml, on a model the tests can't download.
//   ghllm_ask model.gguf [threads] [grammar-file] [prompt-dir]
// With a prompt dir (written by test/model-prompts.mjs: the app's own prompts), it reads prefix.txt
// ahead, answers 01.txt, 02.txt... into 01.out, 02.out... the way the coach samples, and answers
// tailor.txt (if there) under the grammar into tailor.out.
#include "ghllm_core.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

static bool slurp(const std::string &path, std::string &out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

static void spill(const std::string &path, const std::string &text) {
    std::ofstream(path, std::ios::binary) << text;
}

static int on_piece(void *ud, const char *bytes, int len) {
    static_cast<std::string *>(ud)->append(bytes, (size_t) len);
    return 0;
}

static const char *SYSTEM =
    "You are the coach in Gradient Health, a workout and health app on this person's phone.\n"
    "Answer their question in 2 to 4 short sentences, in plain words. Say \"you\". No lists, headings or emoji.\n"
    "Base the answer on FACTS and THEIR DATA below. Use their real numbers. Never make up a number.\n\n"
    "THEIR DATA\nGoals: bigger arms, legs and glutes.\nPlan: 4 workouts a week, about 25 min each, at home.\n"
    "Sleep: 6 h 40 min on average this week (usually 7 h 10 min).\nSteps: 7400 steps on average this week; daily goal 8000.\n"
    "Resting heart rate: 61 bpm on average this week (usually 59 bpm).\nWorkouts: 14 of 16 done in the last 4 weeks; streak 21 days.";

static std::string ask(const std::string &q, const char *facts) {
    return std::string("<|im_start|>system\n") + SYSTEM + "<|im_end|>\n<|im_start|>user\nFACTS\n- " + facts + "\n\nQUESTION\n" + q +
           "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
}

int main(int argc, char **argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: ghllm_ask model.gguf [threads] [grammar-file] [prompt-dir]\n");
        return 2;
    }
    const int threads = argc > 2 ? std::atoi(argv[2]) : 4;
    std::setvbuf(stdout, nullptr, _IONBF, 0);  // CI logs show each line as it happens
    ghllm_init(nullptr);
    char err[512] = {0};
    const auto t0 = std::chrono::steady_clock::now();
    ghllm *g = ghllm_load(argv[1], 4096, 256, threads, nullptr, nullptr, err, sizeof err);
    if (!g) {
        std::printf("LOAD FAILED: %s\n", err);
        return 1;
    }
    const double load_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::printf("loaded in %.0f ms, %d threads\n%s\n\n", load_ms, threads, ghllm_system_info());

    ghllm_gen gen{};
    gen.temperature = 0.6f;
    gen.top_p = 0.8f;
    gen.top_k = 20;
    gen.repeat_penalty = 1.05f;
    gen.max_tokens = 0;
    const std::string dir = argc > 4 ? argv[4] : "";
    int bad = 0;
    auto report = [](const char *what, const std::string &out, int rc, const ghllm_stats &st) {
        const bool think = out.find("<think>") != std::string::npos || out.find("</think>") != std::string::npos;
        std::printf("%s\n   rc=%d, %d prompt tokens (%d reused) in %.0f ms, %d tokens in %.0f ms = %.1f tokens/s, finish %d%s\n\n", what, rc,
                    st.prompt_tokens, st.reused_tokens, st.prompt_ms, st.tokens, st.gen_ms, st.gen_ms > 0 ? st.tokens * 1000.0 / st.gen_ms : 0.0,
                    st.finish, think ? "  THINK TAGS!" : "");
        return rc != GHLLM_OK || out.empty() || think;
    };

    if (dir.empty()) {
        ghllm_stats s{};
        std::string none;
        const std::string sys = std::string("<|im_start|>system\n") + SYSTEM + "<|im_end|>\n";
        ghllm_generate(g, sys.c_str(), &gen, on_piece, nullptr, &none, &s);
        std::printf("read the system prompt ahead: %d tokens in %.0f ms\n\n", s.prompt_tokens, s.prompt_ms);
        const char *qs[][2] = {
            {"How is my sleep?", "What the app worked out: You averaged 6 h 40 min of sleep this week, 30 min less than usual."},
            {"Am I doing enough steps?", "What the app worked out: 7400 steps a day this week, a little under your 8000 goal."},
        };
        gen.max_tokens = 200;
        for (auto &q : qs) {
            std::string out;
            ghllm_stats st{};
            const int rc = ghllm_generate(g, ask(q[0], q[1]).c_str(), &gen, on_piece, nullptr, &out, &st);
            bad += report((std::string("Q: ") + q[0] + "\nA: " + out).c_str(), out, rc, st);
        }
    } else {
        // The app's own prompts, sampled the way the coach samples its answers.
        gen.temperature = 0.3f;
        std::string prefix, none;
        if (slurp(dir + "/prefix.txt", prefix)) {
            ghllm_stats s{};
            ghllm_generate(g, prefix.c_str(), &gen, on_piece, nullptr, &none, &s);
            std::printf("read the rules and data ahead: %d tokens in %.0f ms\n\n", s.prompt_tokens, s.prompt_ms);
        }
        gen.max_tokens = 320;
        for (int i = 1; i < 100; i++) {
            char name[8];
            std::snprintf(name, sizeof name, "/%02d", i);
            std::string prompt, out;
            if (!slurp(dir + name + ".txt", prompt)) break;
            ghllm_stats st{};
            const int rc = ghllm_generate(g, prompt.c_str(), &gen, on_piece, nullptr, &out, &st);
            spill(dir + name + ".out", out);
            bad += report((std::string("prompt ") + (name + 1) + ": " + out).c_str(), out, rc, st);
        }
    }

    if (argc > 3) {
        std::string grammar, prompt;
        slurp(argv[3], grammar);
        ghllm_gen jg = gen;
        jg.temperature = 0.2f;
        jg.max_tokens = 240;
        jg.grammar = grammar.c_str();
        if (dir.empty() || !slurp(dir + "/tailor.txt", prompt))
            prompt =
                "<|im_start|>system\nYou turn a request about a workout plan into JSON. Only include what the person asked for.<|im_end|>\n"
                "<|im_start|>user\nMore legs please, my knees hurt, and I only have 20 minutes<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n";
        std::string out;
        ghllm_stats st{};
        const int rc = ghllm_generate(g, prompt.c_str(), &jg, on_piece, nullptr, &out, &st);
        if (!dir.empty()) spill(dir + "/tailor.out", out);
        bad += report((std::string("Tailor (grammar): ") + out).c_str(), out, rc, st) || out[0] != '{';
    }
    ghllm_free(g);
    std::printf("%s\n", bad ? "SOME ANSWERS FAILED" : "all answered");
    return bad ? 1 : 0;
}
