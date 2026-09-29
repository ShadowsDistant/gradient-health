#!/usr/bin/env bash
# Builds the Android App Bundle (.aab) that Google Play needs for a new app, from the same code,
# resources and assets as the APK. It runs where the Android SDK is installed (the GitHub Actions
# runner has it): aapt2 from the SDK's build-tools and an android.jar from its platforms, plus
# bundletool (downloaded from Google's GitHub release once, checked against a pinned SHA-256, then
# cached).
#
#   npm run build && bash scripts/build-apk.sh && bash scripts/build-aab.sh
#
# It reuses the compiled classes.dex and assets from build/apk-work (so run build-apk.sh first, with
# the same VERSION_CODE), and signs the bundle with the same key: set the RELEASE_* variables
# described in build-apk.sh for a bundle Play accepts. Play then signs what it serves with the app
# signing key (Play App Signing); upload this key there as the app signing key to keep Play and
# APKPure builds on one signature (docs/DEVELOPING.md, Publishing).
#
# Environment (all optional besides signing):
#   ANDROID_HOME     Android SDK                     (default: $ANDROID_SDK_ROOT, else ~/Android/Sdk)
#   VERSION_NAME     versionName                     (default: "version" in package.json)
#   VERSION_CODE     versionCode                     (default: the one build-apk.sh used)
#   OUT              the bundle                      (default: build/gradient-health.aab)
#   CACHE_DIR        download cache                  (default: ~/.cache/gradient-health)
#   BUNDLETOOL_JAR   a bundletool-all jar to use instead of downloading one
set -euo pipefail

CALLER_PWD="$PWD"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUNDLETOOL_VERSION="1.18.1"
BUNDLETOOL_ASSET="bundletool-all-${BUNDLETOOL_VERSION}.jar"
BUNDLETOOL_URL="https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/${BUNDLETOOL_ASSET}"
# The SHA-256 of that file, as first downloaded from Google's GitHub release (CI, Sep 29, 2026).
BUNDLETOOL_SHA256="675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c"
MIN_SDK=26
TARGET_SDK=36

die() { echo "build-aab: error: $*" >&2; exit 1; }
step() { echo "==> $*"; }
abspath() { case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s\n' "$CALLER_PWD/$1" ;; esac; }

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
CACHE_DIR="$(abspath "${CACHE_DIR:-$HOME/.cache/gradient-health}")"
OUT="$(abspath "${OUT:-$ROOT/build/gradient-health.aab}")"
APK_WORK="$ROOT/build/apk-work"
WORK="$ROOT/build/aab-work"
if [[ -z "${VERSION_NAME:-}" ]]; then
  VERSION_NAME="$(node -p "require('./package.json').version || ''" 2>/dev/null || true)"
  VERSION_NAME="${VERSION_NAME:-1.0.0}"
fi

# ---------------------------------------------------------------- tools
[[ -d "$SDK" ]] || die "no Android SDK at $SDK. Set ANDROID_HOME, or run this in CI (.github/workflows/android.yml), where the runner has one."
AAPT2="$(ls -d "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -n1 || true)"
[[ -x "$AAPT2" ]] || die "aapt2 not found under $SDK/build-tools. Install one with: sdkmanager 'build-tools;35.0.0'"
PLATFORM_JAR=""
for api in 36 35 34; do
  if [[ -f "$SDK/platforms/android-$api/android.jar" ]]; then PLATFORM_JAR="$SDK/platforms/android-$api/android.jar"; break; fi
done
[[ -n "$PLATFORM_JAR" ]] || die "no android.jar for API 34-36 under $SDK/platforms. Install one with: sdkmanager 'platforms;android-35'"
for tool in java jarsigner unzip zip curl; do command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"; done
[[ -f "$APK_WORK/dex/classes.dex" && -f "$APK_WORK/assets/index.html" ]] || die "no compiled app in $APK_WORK. Run 'bash scripts/build-apk.sh' first."

BUNDLETOOL="${BUNDLETOOL_JAR:+$(abspath "$BUNDLETOOL_JAR")}"
BUNDLETOOL="${BUNDLETOOL:-$CACHE_DIR/$BUNDLETOOL_ASSET}"
if [[ ! -s "$BUNDLETOOL" ]]; then
  step "Downloading bundletool ${BUNDLETOOL_VERSION}"
  mkdir -p "$CACHE_DIR"
  curl -fL --retry 5 --retry-delay 10 --retry-all-errors --connect-timeout 30 -o "$BUNDLETOOL.part" "$BUNDLETOOL_URL"
  got="$(sha256sum "$BUNDLETOOL.part" | cut -d' ' -f1)"
  [[ "$got" == "$BUNDLETOOL_SHA256" ]] || { rm -f "$BUNDLETOOL.part"; die "bundletool SHA-256 mismatch (expected $BUNDLETOOL_SHA256, got $got)"; }
  mv "$BUNDLETOOL.part" "$BUNDLETOOL"
fi
bundletool() { java -jar "$BUNDLETOOL" "$@"; }

# The same versionCode as the APK built just before (Play needs it to grow with every upload).
if [[ -z "${VERSION_CODE:-}" ]]; then
  VERSION_CODE="$("$AAPT2" dump badging "$ROOT/build/gradient-health.apk" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -n1 || true)"
fi
[[ "${VERSION_CODE:-}" =~ ^[1-9][0-9]{0,9}$ ]] || die "set VERSION_CODE (the APK's), got '${VERSION_CODE:-}'"

# ---------------------------------------------------------------- signing (as in build-apk.sh)
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
  SIGNED_WITH="the public test key (Play won't take this bundle)"
fi
[[ -s "$KEYSTORE" ]] || die "signing keystore missing: $KEYSTORE"

# ---------------------------------------------------------------- resources in protobuf form
rm -rf "$WORK"
mkdir -p "$WORK/base" "$(dirname "$OUT")"
rm -f "$OUT"
step "Compiling resources with $(basename "$(dirname "$AAPT2")")/aapt2 against $(basename "$(dirname "$PLATFORM_JAR")")"
"$AAPT2" compile --dir "$ROOT/android/res" -o "$WORK/res.zip"
"$AAPT2" link --proto-format -o "$WORK/linked.zip" \
  -I "$PLATFORM_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --auto-add-overlay \
  "$WORK/res.zip"

# ---------------------------------------------------------------- the base module
# A module is a zip laid out as manifest/, dex/, res/, assets/ and resources.pb.
step "Laying out the base module"
unzip -q "$WORK/linked.zip" -d "$WORK/linked"
mkdir -p "$WORK/base/manifest" "$WORK/base/dex"
mv "$WORK/linked/AndroidManifest.xml" "$WORK/base/manifest/AndroidManifest.xml"
mv "$WORK/linked/resources.pb" "$WORK/base/resources.pb"
[[ -d "$WORK/linked/res" ]] && mv "$WORK/linked/res" "$WORK/base/res"
cp "$APK_WORK/dex/classes.dex" "$WORK/base/dex/classes.dex"
cp -R "$APK_WORK/assets" "$WORK/base/assets"
(cd "$WORK/base" && zip -q -r -X "$WORK/base.zip" .)

step "Building the bundle (versionName $VERSION_NAME, versionCode $VERSION_CODE)"
bundletool build-bundle --modules="$WORK/base.zip" --output="$OUT"

step "Signing with $SIGNED_WITH"
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore "$KEYSTORE" -storepass:env GH_SIGN_STORE_PASS -keypass:env GH_SIGN_KEY_PASS \
  "$OUT" "$KEY_ALIAS" >/dev/null

# ---------------------------------------------------------------- checks
step "Validating"
bundletool validate --bundle="$OUT" >/dev/null
jarsigner -verify "$OUT" >/dev/null || die "the bundle's signature doesn't verify"
# A universal APK from the bundle: proves it turns into something a phone installs. bundletool
# takes passwords from a file (or the command line): a private file that's gone right after.
PASSDIR="$(mktemp -d)"
trap 'rm -rf "$PASSDIR"' EXIT
( umask 077; printf '%s\n' "$GH_SIGN_STORE_PASS" > "$PASSDIR/store"; printf '%s\n' "$GH_SIGN_KEY_PASS" > "$PASSDIR/key" )
bundletool build-apks --bundle="$OUT" --output="$WORK/universal.apks" --mode=universal \
  --ks="$KEYSTORE" --ks-key-alias="$KEY_ALIAS" --ks-pass="file:$PASSDIR/store" --key-pass="file:$PASSDIR/key" >/dev/null
rm -rf "$PASSDIR"
unzip -l "$WORK/universal.apks" | grep -q "universal.apk" || die "bundletool couldn't make a universal APK from the bundle"
bundletool dump manifest --bundle="$OUT" | grep -E "package=|versionCode|targetSdkVersion" | head -n 4 || true
echo
step "Built $OUT ($(du -h "$OUT" | cut -f1)), signed with $SIGNED_WITH"
