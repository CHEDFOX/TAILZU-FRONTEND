#!/usr/bin/env bash
# Type-check the Android keyboard's Kotlin in seconds, without an Android SDK,
# Gradle or an Expo prebuild — the same question CI's keyboard-android-compile
# answers in ~8 minutes. Compiles every .kt in the keyboard module against the
# Android 15 framework (Robolectric's android-all jar), OkHttp and Okio, all
# from Maven Central.
#
#   tools/android-compile/check.sh            # module dir by default
#   KTC_DIR=/path/to/jars tools/android-compile/check.sh other/dir
#
# android-all carries android.annotation.Nullable on the framework; the SDK
# stub jar that Gradle compiles against does not, so they are ignored here to
# match (findViewById is a platform type there, not a nullable one).
#
# Jars are cached in $KTC_DIR (default ~/.cache/tailzu-ktc); the first run
# downloads about 250 MB. CI stays the gate: this is the fast loop.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
src="${1:-$repo/app/modules/tulmi-keyboard/android}"
jars="${KTC_DIR:-$HOME/.cache/tailzu-ktc}"
K=2.1.20
M=https://repo1.maven.org/maven2
mkdir -p "$jars"
get() { [ -s "$jars/$2" ] || curl -sSfL --retry 4 --retry-delay 3 -o "$jars/$2" "$M/$1"; }
get org/robolectric/android-all/15-robolectric-12650502/android-all-15-robolectric-12650502.jar android-all.jar
get org/jetbrains/kotlin/kotlin-compiler-embeddable/$K/kotlin-compiler-embeddable-$K.jar kc.jar
get org/jetbrains/kotlin/kotlin-stdlib/$K/kotlin-stdlib-$K.jar stdlib.jar
get org/jetbrains/kotlin/kotlin-script-runtime/$K/kotlin-script-runtime-$K.jar script.jar
get org/jetbrains/kotlin/kotlin-reflect/$K/kotlin-reflect-$K.jar reflect.jar
get org/jetbrains/kotlin/kotlin-daemon-embeddable/$K/kotlin-daemon-embeddable-$K.jar daemon.jar
get org/jetbrains/intellij/deps/trove4j/1.0.20200330/trove4j-1.0.20200330.jar trove.jar
get org/jetbrains/kotlinx/kotlinx-coroutines-core-jvm/1.8.0/kotlinx-coroutines-core-jvm-1.8.0.jar coro.jar
get org/jetbrains/annotations/13.0/annotations-13.0.jar ann.jar
get com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0.jar okhttp.jar
get com/squareup/okio/okio-jvm/3.6.0/okio-jvm-3.6.0.jar okio.jar
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
compiler="$jars/kc.jar:$jars/stdlib.jar:$jars/script.jar:$jars/reflect.jar:$jars/daemon.jar:$jars/trove.jar:$jars/coro.jar:$jars/ann.jar"
cp="$jars/android-all.jar:$jars/okhttp.jar:$jars/okio.jar"
java -Xmx3g -cp "$compiler" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-reflect -jvm-target 17 -nowarn \
  -Xnullability-annotations=@android.annotation:ignore \
  -kotlin-home "$jars" -no-stdlib -classpath "$cp:$jars/stdlib.jar" \
  -d "$out" "$src"/*.kt "$here/Stubs.kt"
echo "android keyboard: compiles"
