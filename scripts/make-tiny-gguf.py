#!/usr/bin/env python3
"""Writes a tiny random-weight GGUF for test/llm.mjs (default: build/tiny.gguf, llama architecture).

The real models can't be downloaded in tests, so this stands in for them: n_embd 64, a byte-level
BPE vocab (256 byte tokens, a few merges) with Qwen-style ChatML special tokens and chat template,
Q8_0 matrices. It loads in wllama and generates gibberish. The weights come from a fixed seed, so the
file is the same every run.

--arch picks the model architecture, to prove the runtime can load a real model family before the
app offers it: llama (2 layers), qwen3 (2 layers with q/k norms), or qwen35 (Qwen3.5: 3 gated
delta-net layers and one gated full-attention layer, the hybrid layout of the real models).

    python3 -m venv build/venv && build/venv/bin/pip install gguf numpy
    build/venv/bin/python scripts/make-tiny-gguf.py [--arch qwen35] [--out build/tiny-qwen35.gguf]
"""
import argparse
import hashlib
import os

import numpy as np
import gguf

N_EMBD = 64
N_LAYER = 2
N_HEAD = 4
N_HEAD_KV = 2  # grouped-query attention, like Qwen2.5
N_FF = 128
N_CTX_TRAIN = 2048
HEAD_DIM = N_EMBD // N_HEAD
# Qwen3.5's hybrid layers (see --arch qwen35).
FULL_ATTN_EVERY = 4
SSM_CONV = 4
SSM_STATE = 16
SSM_K_HEADS = 2
SSM_V_HEADS = 4

CHATML_TEMPLATE = (
    "{% for message in messages %}"
    "{{'<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>' + '\\n'}}"
    "{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}{% endif %}"
)
# Qwen3 and Qwen3.5 templates end the prompt with an empty think block when thinking is off.
THINK_TEMPLATE = (
    "{% for message in messages %}"
    "{{'<|im_start|>' + message['role'] + '\\n' + message['content'] + '<|im_end|>' + '\\n'}}"
    "{% endfor %}"
    "{% if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}"
    "{% if enable_thinking is defined and enable_thinking is false %}{{ '<think>\\n\\n</think>\\n\\n' }}{% endif %}"
    "{% endif %}"
)
SPECIALS = ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>']
# A few merges so the tokenizer is real BPE; every merged token is in the vocab too.
MERGES = [('Ġ', 't'), ('h', 'e'), ('i', 'n'), ('e', 'r'), ('a', 'n'), ('o', 'u'), ('Ġ', 'a'),
          ('r', 'e'), ('o', 'n'), ('Ġt', 'he'), ('Ġ', 's'), ('Ġ', 'w')]


def bytes_to_unicode():
    """GPT-2's printable stand-ins for the 256 byte values (what Qwen's tokenizer uses)."""
    bs = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {b: chr(c) for b, c in zip(bs, cs)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--arch', choices=['llama', 'qwen3', 'qwen35'], default='llama')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    arch = args.arch
    name = 'tiny.gguf' if arch == 'llama' else f'tiny-{arch}.gguf'
    out = os.path.abspath(args.out or os.path.join(os.path.dirname(__file__), '..', 'build', name))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rng = np.random.default_rng(20260929)

    byte_chars = bytes_to_unicode()
    tokens = [byte_chars[b] for b in range(256)]
    for a, b in MERGES:
        tokens.append(a + b)
    first_special = len(tokens)
    tokens += SPECIALS
    types = [gguf.TokenType.NORMAL] * first_special + [gguf.TokenType.CONTROL] * len(SPECIALS)
    n_vocab = len(tokens)
    eot = tokens.index('<|endoftext|>')
    im_end = tokens.index('<|im_end|>')

    n_layer = 4 if arch == 'qwen35' else N_LAYER
    w = gguf.GGUFWriter(out, arch)
    w.add_name(f'Gradient tiny test model ({arch})')
    w.add_context_length(N_CTX_TRAIN)
    w.add_embedding_length(N_EMBD)
    w.add_block_count(n_layer)
    w.add_feed_forward_length(N_FF)
    w.add_head_count(N_HEAD)
    w.add_head_count_kv(N_HEAD_KV)
    w.add_rope_freq_base(10000.0)
    w.add_layer_norm_rms_eps(1e-6)
    if arch == 'llama':
        w.add_rope_dimension_count(HEAD_DIM)
    else:
        w.add_key_length(HEAD_DIM)
        w.add_value_length(HEAD_DIM)
    if arch == 'qwen35':
        # Qwen3.5: rotary on a quarter of each head (multimodal sections), a full-attention layer
        # every 4th, and gated delta-net sizes (state, key heads, value heads, conv kernel).
        w.add_rope_dimension_count(HEAD_DIM // 4)
        w.add_rope_dimension_sections([1, 1, 0, 0])
        w.add_full_attention_interval(FULL_ATTN_EVERY)
        w.add_ssm_conv_kernel(SSM_CONV)
        w.add_ssm_state_size(SSM_STATE)
        w.add_ssm_group_count(SSM_K_HEADS)
        w.add_ssm_time_step_rank(SSM_V_HEADS)
        w.add_ssm_inner_size(SSM_V_HEADS * SSM_STATE)
    w.add_file_type(gguf.LlamaFileType.MOSTLY_Q8_0)
    w.add_tokenizer_model('gpt2')
    w.add_tokenizer_pre('qwen2')
    w.add_token_list(tokens)
    w.add_token_types(types)
    w.add_token_merges([f'{a} {b}' for a, b in MERGES])
    w.add_bos_token_id(eot)
    w.add_eos_token_id(im_end)
    w.add_pad_token_id(eot)
    w.add_add_bos_token(False)
    w.add_chat_template(CHATML_TEMPLATE if arch == 'llama' else THINK_TEMPLATE)

    def q8(name, rows, cols, scale):
        data = (rng.standard_normal((rows, cols)) * scale).astype(np.float32)
        w.add_tensor(name, gguf.quants.quantize(data, gguf.GGMLQuantizationType.Q8_0), raw_dtype=gguf.GGMLQuantizationType.Q8_0)

    # Dimension 0 of the residual stream is a constant 1, so after the final norm it's a large
    # positive value. The output weights use it to push down control and non-printable tokens:
    # the gibberish stays readable and never hits <|im_end|>, so a stream only ends at maxTokens.
    embd = (rng.standard_normal((n_vocab, N_EMBD)) * 0.1).astype(np.float32)
    embd[:, 0] = 1.0
    w.add_tensor('token_embd.weight', embd)
    ones = lambda n: np.ones(n, dtype=np.float32)
    for i in range(n_layer):
        w.add_tensor(f'blk.{i}.attn_norm.weight', ones(N_EMBD))
        full = arch != 'qwen35' or (i + 1) % FULL_ATTN_EVERY == 0
        if full:
            # Qwen3.5's attention also projects a gate for its output: q is twice as wide.
            q8(f'blk.{i}.attn_q.weight', N_HEAD * HEAD_DIM * (2 if arch == 'qwen35' else 1), N_EMBD, 0.02)
            q8(f'blk.{i}.attn_k.weight', N_HEAD_KV * HEAD_DIM, N_EMBD, 0.02)
            q8(f'blk.{i}.attn_v.weight', N_HEAD_KV * HEAD_DIM, N_EMBD, 0.02)
            q8(f'blk.{i}.attn_output.weight', N_EMBD, N_HEAD * HEAD_DIM, 0.02)
            if arch != 'llama':
                w.add_tensor(f'blk.{i}.attn_q_norm.weight', ones(HEAD_DIM))
                w.add_tensor(f'blk.{i}.attn_k_norm.weight', ones(HEAD_DIM))
        else:
            # A gated delta-net layer: q, k and v in one projection through a short convolution,
            # the output gate, per-head beta and decay (alpha), and the recurrent state's norm.
            key_dim, value_dim = SSM_K_HEADS * SSM_STATE, SSM_V_HEADS * SSM_STATE
            conv_dim = 2 * key_dim + value_dim
            q8(f'blk.{i}.attn_qkv.weight', conv_dim, N_EMBD, 0.02)
            q8(f'blk.{i}.attn_gate.weight', value_dim, N_EMBD, 0.02)
            w.add_tensor(f'blk.{i}.ssm_beta.weight', (rng.standard_normal((SSM_V_HEADS, N_EMBD)) * 0.02).astype(np.float32))
            w.add_tensor(f'blk.{i}.ssm_alpha.weight', (rng.standard_normal((SSM_V_HEADS, N_EMBD)) * 0.02).astype(np.float32))
            w.add_tensor(f'blk.{i}.ssm_conv1d.weight', (rng.standard_normal((conv_dim, SSM_CONV)) * 0.2).astype(np.float32))
            w.add_tensor(f'blk.{i}.ssm_dt.bias', np.zeros(SSM_V_HEADS, dtype=np.float32))
            w.add_tensor(f'blk.{i}.ssm_a', -np.ones(SSM_V_HEADS, dtype=np.float32))
            w.add_tensor(f'blk.{i}.ssm_norm.weight', ones(SSM_STATE))
            q8(f'blk.{i}.ssm_out.weight', N_EMBD, value_dim, 0.02)
        norm2 = 'post_attention_norm' if arch == 'qwen35' else 'ffn_norm'
        w.add_tensor(f'blk.{i}.{norm2}.weight', ones(N_EMBD))
        q8(f'blk.{i}.ffn_gate.weight', N_FF, N_EMBD, 0.02)
        q8(f'blk.{i}.ffn_up.weight', N_FF, N_EMBD, 0.02)
        q8(f'blk.{i}.ffn_down.weight', N_EMBD, N_FF, 0.02)
    w.add_tensor('output_norm.weight', np.ones(N_EMBD, dtype=np.float32))
    out_w = (rng.standard_normal((n_vocab, N_EMBD)) * 0.5).astype(np.float32)
    out_w[:, 0] = 0.0
    for t in range(256):
        if not (0x20 <= t < 0x7f or t == 0x0a):
            out_w[t, 0] = -2.0
    out_w[first_special:, 0] = -4.0
    w.add_tensor('output.weight', gguf.quants.quantize(out_w, gguf.GGMLQuantizationType.Q8_0), raw_dtype=gguf.GGMLQuantizationType.Q8_0)

    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()

    with open(out, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print(f'{out}  {arch}  {os.path.getsize(out)} bytes  {n_vocab} tokens  sha256 {digest}')


if __name__ == '__main__':
    main()
