#!/usr/bin/env bash
# Builds and signs the Gradient Health APK (android/ + the single-file web app) without Gradle or the
# Android SDK: javac against the API 34 framework jar (Robolectric's android-all from Maven
# Central), dx (dalvik-exchange), aapt, zipalign and apksigner from Ubuntu/Debian packages.
#
#   sudo apt-get install -y --no-install-recommends aapt dalvik-exchange zipalign apksigner
#   npm run build && bash scripts/build-apk.sh
#
# Environment (all optional):
#   APP_HTML       page to ship as assets/index.html   (default: dist/gradient-health.html)
#   VERSION_NAME   versionName                         (default: "version" in package.json, else 1.0.0)
#   VERSION_CODE   versionCode, must only ever grow     (default: minutes since the Unix epoch)
#   OUT            signed APK                          (default: build/gradient-health.apk)
#   CACHE_DIR      download cache                      (default: ~/.cache/gradient-health)
#   ANDROID_ALL_JAR  path of the android-all jar       (default: $CACHE_DIR/android-all-<ver>.jar)
# Signing, for a build to publish (CI gets these from the repository's secrets):
#   RELEASE_KEYSTORE        the release keystore (.jks); without it the build is signed with the
#                           test key in android/, whose password is public: fine for trying a build,
#                           never for a store, and a store build won't install over it.
#   RELEASE_KEYSTORE_PASS   its password (required with RELEASE_KEYSTORE)
#   RELEASE_KEY_ALIAS       the key's alias             (default: gradienthealth)
#   RELEASE_KEY_PASS        the key's password          (default: RELEASE_KEYSTORE_PASS)
#   A release build has to come out with the certificate in android/release-cert.sha256, or it stops.
# Relative paths are taken from the directory you run the script in.
set -euo pipefail

CALLER_PWD="$PWD"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ANDROID_ALL_VERSION="14-robolectric-10818077" # Android 14 / API 34
ANDROID_ALL_SHA1="94b1490a891e9be559aa35c87cd8a0c163f32d83"
ANDROID_ALL_URL="https://repo.maven.apache.org/maven2/org/robolectric/android-all/${ANDROID_ALL_VERSION}/android-all-${ANDROID_ALL_VERSION}.jar"
MIN_SDK=26
# Linked and compiled against API 34 (the newest framework jar aapt can read), but targeting 36:
# the app only calls newer APIs behind SDK_INT checks.
COMPILE_SDK=34
TARGET_SDK=36

die() { echo "build-apk: error: $*" >&2; exit 1; }
step() { echo "==> $*"; }
abspath() { case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s\n' "$CALLER_PWD/$1" ;; esac; }

# The passwords reach apksigner through the environment (env:NAME), never its command line.
if [[ -n "${RELEASE_KEYSTORE:-}" ]]; then
  KEYSTORE="$(abspath "$RELEASE_KEYSTORE")"
  KEY_ALIAS="${RELEASE_KEY_ALIAS:-gradienthealth}"
  [[ -n "${RELEASE_KEYSTORE_PASS:-}" ]] || die "RELEASE_KEYSTORE_PASS is required with RELEASE_KEYSTORE"
  export GH_SIGN_STORE_PASS="$RELEASE_KEYSTORE_PASS"
  export GH_SIGN_KEY_PASS="${RELEASE_KEY_PASS:-$RELEASE_KEYSTORE_PASS}"
  SIGNED_WITH="the release key"
else
  KEYSTORE="$ROOT/android/gradient-health.keystore"
  KEY_ALIAS="gradient"
  export GH_SIGN_STORE_PASS="gradient-health" GH_SIGN_KEY_PASS="gradient-health"
  SIGNED_WITH="the public test key (for testing only, not for a store)"
fi

CACHE_DIR="$(abspath "${CACHE_DIR:-$HOME/.cache/gradient-health}")"
ANDROID_ALL_JAR="$(abspath "${ANDROID_ALL_JAR:-$CACHE_DIR/android-all-${ANDROID_ALL_VERSION}.jar}")"
APP_HTML="$(abspath "${APP_HTML:-$ROOT/dist/gradient-health.html}")"
OUT="$(abspath "${OUT:-$ROOT/build/gradient-health.apk}")"
if [[ -z "${VERSION_NAME:-}" ]]; then
  VERSION_NAME="$(node -p "require('./package.json').version || ''" 2>/dev/null || true)"
  VERSION_NAME="${VERSION_NAME:-1.0.0}"
fi
VERSION_CODE="${VERSION_CODE:-$(( $(date +%s) / 60 ))}"
WORK="$ROOT/build/apk-work"

# ---------------------------------------------------------------- checks
[[ "$VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] && (( VERSION_CODE <= 2100000000 )) \
  || die "VERSION_CODE must be a positive integer <= 2100000000 (got '$VERSION_CODE')"
[[ "$VERSION_NAME" =~ ^[A-Za-z0-9._+-]+$ ]] || die "VERSION_NAME has unexpected characters: '$VERSION_NAME'"
[[ -f "$APP_HTML" ]] || die "web app not found: $APP_HTML
  Build it first with 'npm run build', or point APP_HTML at an HTML file."
# The parts of the app that load on demand (set-up, the 3D figure, Claude, the on-device model's
# runtime and the rest: scripts/build.mjs APP_CHUNKS and LAZY) sit in lazy/ next to the page. They
# aren't committed, and an APK without them would install, then fail at the first one it needs.
LAZY_DIR="$(dirname "$APP_HTML")/lazy"
[[ -d "$LAZY_DIR" && -n "$(ls -A "$LAZY_DIR")" ]] || die "the page's load-on-demand parts aren't built: $LAZY_DIR
  Run 'npm run build' first."
[[ -f "$KEYSTORE" ]] || die "signing keystore missing: $KEYSTORE
  Do not generate a new one: updates only install over builds signed with the same key."
[[ -r "$KEYSTORE" && -s "$KEYSTORE" ]] || die "signing keystore is empty or unreadable: $KEYSTORE"

missing=()
for tool in javac aapt dalvik-exchange zipalign apksigner unzip curl sha1sum; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
if (( ${#missing[@]} )); then
  die "missing tools: ${missing[*]}
  Install them with:
    sudo apt-get install -y --no-install-recommends aapt dalvik-exchange zipalign apksigner openjdk-21-jdk-headless unzip curl"
fi

# ---------------------------------------------------------------- android-all (API 34 framework)
sha1_ok() { [[ "$(sha1sum "$1" | cut -d' ' -f1)" == "$ANDROID_ALL_SHA1" ]]; }

if [[ -f "$ANDROID_ALL_JAR" ]] && sha1_ok "$ANDROID_ALL_JAR"; then
  step "Using cached $(basename "$ANDROID_ALL_JAR")"
else
  if [[ -f "$ANDROID_ALL_JAR" ]]; then
    echo "Cached jar has the wrong SHA-1; downloading it again." >&2
    rm -f "$ANDROID_ALL_JAR"
  fi
  step "Downloading android-all ${ANDROID_ALL_VERSION} (~137 MB, cached afterwards)"
  mkdir -p "$(dirname "$ANDROID_ALL_JAR")"
  curl -fL --retry 5 --retry-delay 10 --retry-all-errors --connect-timeout 30 \
    -o "$ANDROID_ALL_JAR.part" "$ANDROID_ALL_URL"
  if ! sha1_ok "$ANDROID_ALL_JAR.part"; then
    rm -f "$ANDROID_ALL_JAR.part"
    die "SHA-1 mismatch for $ANDROID_ALL_URL (expected $ANDROID_ALL_SHA1)"
  fi
  mv "$ANDROID_ALL_JAR.part" "$ANDROID_ALL_JAR"
fi

# ---------------------------------------------------------------- compile + dex
rm -rf "$WORK"
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/assets" "$(dirname "$OUT")"
rm -f "$OUT"

step "Compiling Java (release 8, against API ${COMPILE_SDK}, target ${TARGET_SDK})"
mapfile -t SOURCES < <(find "$ROOT/android/src" -name '*.java' | sort)
(( ${#SOURCES[@]} )) || die "no Java sources under android/src"
# dx only understands Java 8 bytecode. The framework classes come from the jar, java.* from the JDK.
javac --release 8 -Xlint:-options -proc:none -encoding UTF-8 \
  -cp "$ANDROID_ALL_JAR" -d "$WORK/classes" "${SOURCES[@]}"

step "Dexing"
dalvik-exchange --dex --output="$WORK/dex/classes.dex" "$WORK/classes"

# ---------------------------------------------------------------- package
step "Packaging resources + assets (versionName $VERSION_NAME, versionCode $VERSION_CODE)"
cp "$APP_HTML" "$WORK/assets/index.html"
# The load-on-demand parts, built next to the page (checked above).
mkdir -p "$WORK/assets/lazy"
cp -R "$LAZY_DIR/." "$WORK/assets/lazy/"
echo "  with $(find "$WORK/assets/lazy" -type f | wc -l) load-on-demand files in assets/lazy/"
UNSIGNED="$WORK/unsigned.apk"
# resources.arsc must be stored uncompressed (and 4-byte aligned) for targetSdk >= 30: -0 arsc.
aapt package -f \
  -M "$ROOT/android/AndroidManifest.xml" \
  -S "$ROOT/android/res" \
  -A "$WORK/assets" \
  -I "$ANDROID_ALL_JAR" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  -0 arsc \
  -F "$UNSIGNED"
# classes.dex has to sit at the root of the zip, so add it from its own directory.
(cd "$WORK/dex" && aapt add "$UNSIGNED" classes.dex >/dev/null)
# The on-device coach's native engine, when scripts/build-native.sh has built it (CI does; a build
# without the NDK leaves it out and the app uses its in-app engine). Installed extracted
# (extractNativeLibs), so the libraries can be compressed here.
NATIVE_LIB_DIR="${NATIVE_LIB_DIR:-$ROOT/build/native/lib}"
NATIVE_NOTE="without the native engine"
if compgen -G "$NATIVE_LIB_DIR/arm64-v8a/*.so" >/dev/null; then
  mkdir -p "$WORK/native/lib/arm64-v8a"
  cp "$NATIVE_LIB_DIR"/arm64-v8a/*.so "$WORK/native/lib/arm64-v8a/"
  (cd "$WORK/native" && aapt add "$UNSIGNED" lib/arm64-v8a/*.so >/dev/null)
  NATIVE_NOTE="with the native engine ($(ls "$WORK/native/lib/arm64-v8a" | wc -l) libraries)"
fi

entry_method() { # prints the zip method (Stored/Defl:N) of an entry
  unzip -lv "$1" | awk -v name="$2" '$NF == name { print $2 }'
}
[[ "$(entry_method "$UNSIGNED" resources.arsc)" == "Stored" ]] \
  || die "resources.arsc is compressed in $UNSIGNED; Android 11+ refuses to install that"
for entry in classes.dex assets/index.html AndroidManifest.xml; do
  [[ -n "$(entry_method "$UNSIGNED" "$entry")" ]] || die "$entry is missing from the APK"
done

step "Aligning"
ALIGNED="$WORK/aligned.apk"
zipalign -f -p 4 "$UNSIGNED" "$ALIGNED"
echo "$VERSION_CODE" > "$WORK/version-code" # build-aab.sh gives the bundle the same one

step "Signing with $SIGNED_WITH"
# v1/v2/v3 follow minSdk (26 -> v2 + v3). No v4: its .idsig side file is only for adb incremental installs.
apksigner sign \
  --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass env:GH_SIGN_STORE_PASS --key-pass env:GH_SIGN_KEY_PASS \
  --v4-signing-enabled false \
  --out "$OUT" "$ALIGNED"
rm -f "$OUT.idsig"

# ---------------------------------------------------------------- verify
step "Verifying"
zipalign -c -p 4 "$OUT" || die "zipalign check failed for $OUT"
apksigner verify --verbose "$OUT" || die "signature verification failed for $OUT"
[[ "$(entry_method "$OUT" resources.arsc)" == "Stored" ]] || die "resources.arsc is compressed in $OUT"

echo
aapt dump badging "$OUT" \
  | grep -E "^(package:|sdkVersion:|targetSdkVersion:|uses-permission:|application-label:|launchable-activity:)" \
  || true
echo
unzip -lv "$OUT" | awk 'NR <= 3 || $NF ~ /^(resources\.arsc|classes\.dex|assets\/index\.html|AndroidManifest\.xml)$/'
echo
# The certificate's SHA-256 is what Android developer verification and the stores know the app by.
CERT_SHA256="$(apksigner verify --print-certs "$OUT" | awk -F': ' '/certificate SHA-256 digest/ { print $2; exit }')"
echo "Signed with $SIGNED_WITH, certificate SHA-256: ${CERT_SHA256:-unknown}"
# The release key never changes, so a release build with another certificate means the wrong keystore.
if [[ -n "${RELEASE_KEYSTORE:-}" ]]; then
  [[ -f "$ROOT/android/release-cert.sha256" ]] || die "android/release-cert.sha256 is missing"
  WANT_SHA256="$(grep -v '^#' "$ROOT/android/release-cert.sha256" | tr -d '[:space:]')"
  if [[ "$CERT_SHA256" != "$WANT_SHA256" ]]; then
    rm -f "$OUT"
    die "signed with certificate ${CERT_SHA256:-unknown}, not the release key's ($WANT_SHA256, android/release-cert.sha256). Check RELEASE_KEYSTORE (in CI, the RELEASE_KEYSTORE_B64 secret)."
  fi
fi
step "Built $OUT ($(du -h "$OUT" | cut -f1)), $NATIVE_NOTE"
