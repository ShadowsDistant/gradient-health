# The native engine for the on-device coach: libghllm.so on top of llama.cpp (fetched and pinned by
# scripts/build-native.sh). For Android it builds every arm64 CPU backend variant as its own library;
# the app loads the best one for the phone at run time. On a desktop it builds a test harness.
#
#   cmake -S android/jni -B build/native-host -DLLAMA_SRC=<llama.cpp> -DGHLLM_HOST_TEST=ON
cmake_minimum_required(VERSION 3.22)
project(ghllm C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(LLAMA_SRC "" CACHE PATH "llama.cpp source tree")
option(GHLLM_HOST_TEST "Build the host test harness" OFF)
if(NOT EXISTS "${LLAMA_SRC}/CMakeLists.txt")
  message(FATAL_ERROR "Set LLAMA_SRC to a llama.cpp source tree (scripts/build-native.sh fetches one)")
endif()

# Only the library: no tools, examples, tests, server or network.
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)

if(ANDROID)
  # Every CPU variant from armv8.0 up, each its own library, picked at run time.
  set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
  set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
  set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)
  set(GGML_CPU_KLEIDIAI OFF CACHE BOOL "" FORCE)
  set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
  # Android 15 phones can use 16 KB memory pages, and Google Play requires libraries that load there.
  # The CPU variants are CMake modules (loaded with dlopen), which take their own linker flags.
  set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")
  set(CMAKE_MODULE_LINKER_FLAGS "${CMAKE_MODULE_LINKER_FLAGS} -Wl,-z,max-page-size=16384")
endif()

add_subdirectory("${LLAMA_SRC}" llama EXCLUDE_FROM_ALL)

set(GHLLM_SOURCES ghllm_core.cpp)
if(ANDROID)
  list(APPEND GHLLM_SOURCES ghllm_jni.cpp)
endif()
add_library(ghllm SHARED ${GHLLM_SOURCES})
target_link_libraries(ghllm PRIVATE llama ggml)
if(ANDROID)
  target_compile_definitions(ghllm PRIVATE GHLLM_BACKEND_DL)
  target_link_libraries(ghllm PRIVATE log)
endif()

if(GHLLM_HOST_TEST)
  add_executable(ghllm_test test_host.cpp)
  target_link_libraries(ghllm_test PRIVATE ghllm)
  # Asks a real model a few questions (.github/workflows/model-check.yml).
  add_executable(ghllm_ask ask_host.cpp)
  target_link_libraries(ghllm_ask PRIVATE ghllm)
endif()
