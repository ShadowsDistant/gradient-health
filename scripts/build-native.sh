#!/usr/bin/env bash
# Builds the on-device coach's native engine: android/jni (ghllm) on top of llama.cpp, pinned to
# the same release the in-app WebAssembly engine uses, fetched with git and checked against its
# commit hash.
#
#   bash scripts/build-native.sh          Android arm64 → build/native/lib/arm64-v8a/*.so (needs the NDK)
#   bash scripts/build-native.sh --host   a desktop build of the same core, tested against the tiny
#                                         model from scripts/make-tiny-gguf.py (build/tiny-qwen35.gguf)
#
# Environment:
#   ANDROID_NDK_HOME   the NDK (default: $ANDROID_NDK_LATEST_HOME, as on GitHub's runners)
#   LLAMA_SRC          an existing llama.cpp checkout at the pinned commit (skips the fetch)
#   CACHE_DIR          where the fetched source is kept (default: ~/.cache/gradient-health)
#
# The Android build ships every arm64 CPU variant from armv8.0 (any phone) to armv8.6 with int8
# matrix instructions; the app picks the fastest one the phone supports when it starts the engine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LLAMA_TAG="b10663"
LLAMA_COMMIT="83d855c5a6d70487121edbf4020b25c96b7a04e7"
LLAMA_REPO="https://github.com/ggml-org/llama.cpp"
# The CPU variants that go into the app (the armv9 ones add size for little gain on today's phones).
VARIANTS=(android_armv8.0_1 android_armv8.2_1 android_armv8.2_2 android_armv8.6_1)
MIN_API=26

die() { echo "build-native: error: $*" >&2; exit 1; }
step() { echo "==> $*"; }

MODE="android"
[[ "${1:-}" == "--host" ]] && MODE="host"
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/gradient-health}"
JOBS="$(nproc 2>/dev/null || echo 4)"
command -v cmake >/dev/null 2>&1 || die "cmake is needed"
command -v git >/dev/null 2>&1 || die "git is needed"

# ---------------------------------------------------------------- llama.cpp, pinned
SRC="${LLAMA_SRC:-$CACHE_DIR/llama.cpp-$LLAMA_TAG}"
if [[ ! -f "$SRC/CMakeLists.txt" ]]; then
  step "Fetching llama.cpp $LLAMA_TAG"
  rm -rf "$SRC.part"
  mkdir -p "$(dirname "$SRC")"
  git clone -q --depth 1 --branch "$LLAMA_TAG" "$LLAMA_REPO" "$SRC.part"
  mv "$SRC.part" "$SRC"
fi
got="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)"
[[ "$got" == "$LLAMA_COMMIT" ]] || die "llama.cpp at $SRC is $got, expected $LLAMA_COMMIT ($LLAMA_TAG)"

# ---------------------------------------------------------------- host: build and test
if [[ "$MODE" == "host" ]]; then
  BUILD="$ROOT/build/native-host"
  step "Building the engine for this computer"
  cmake -S android/jni -B "$BUILD" -DLLAMA_SRC="$SRC" -DGHLLM_HOST_TEST=ON -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$BUILD" -j "$JOBS" --target ghllm_test >/dev/null
  MODEL="$ROOT/build/tiny-qwen35.gguf"
  if [[ ! -s "$MODEL" ]]; then
    step "Making the tiny test model"
    PY="python3"
    [[ -x "$ROOT/build/venv/bin/python" ]] && PY="$ROOT/build/venv/bin/python"
    "$PY" scripts/make-tiny-gguf.py --arch qwen35 >/dev/null
  fi
  step "Testing it"
  "$BUILD/ghllm_test" "$MODEL"
  exit 0
fi

# ---------------------------------------------------------------- Android arm64
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_LATEST_HOME:-${ANDROID_NDK_ROOT:-}}}"
[[ -n "$NDK" && -f "$NDK/build/cmake/android.toolchain.cmake" ]] || die "no Android NDK (set ANDROID_NDK_HOME)"
LLVM="$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/ 2>/dev/null | head -n1)"
[[ -n "$LLVM" ]] || die "no LLVM toolchain in $NDK"
BUILD="$ROOT/build/native-android"
OUT="$ROOT/build/native/lib/arm64-v8a"

step "Building the engine for arm64 with NDK $(basename "$NDK")"
cmake -S android/jni -B "$BUILD" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM="android-$MIN_API" -DANDROID_STL=c++_shared \
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_SRC="$SRC" >/dev/null
TARGETS=(ghllm)
for v in "${VARIANTS[@]}"; do TARGETS+=("ggml-cpu-$v"); done
cmake --build "$BUILD" -j "$JOBS" --target "${TARGETS[@]}" >/dev/null

rm -rf "$OUT"
mkdir -p "$OUT"
LIBS=(libghllm.so libllama.so libggml.so libggml-base.so)
for v in "${VARIANTS[@]}"; do LIBS+=("libggml-cpu-$v.so"); done
for lib in "${LIBS[@]}"; do
  found="$(find "$BUILD" -name "$lib" -type f | head -n1)"
  [[ -n "$found" ]] || die "$lib wasn't built"
  cp "$found" "$OUT/$lib"
done
cp "$LLVM/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so" "$OUT/"

step "Stripping and checking the 16 KB page alignment"
for so in "$OUT"/*.so; do
  "$LLVM/bin/llvm-strip" --strip-unneeded "$so"
  # Every loadable segment must be aligned to 16 KB (0x4000) or more.
  while read -r align; do
    (( $(printf '%d' "$align") >= 16384 )) || die "$(basename "$so") has a segment aligned to $align, not 16 KB"
  done < <("$LLVM/bin/llvm-readelf" -lW "$so" | awk '$1 == "LOAD" { print $NF }')
done
du -ch "$OUT"/*.so | tail -n1 | awk '{ print "==> build/native/lib/arm64-v8a: " $1 }'
ls -1 "$OUT"
