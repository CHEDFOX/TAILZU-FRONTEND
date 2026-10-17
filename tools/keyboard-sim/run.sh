#!/usr/bin/env bash
# Simulate the iOS keyboard's touch path on Linux and type into it.
#
# Lives OUTSIDE app/targets/keyboard on purpose: Xcode compiles every file in
# that folder into the extension, and Shim.swift's UIView would shadow UIKit's.
#
#   ./run.sh                      # the working tree
#   ./run.sh fc45645 HEAD .       # any git revisions; "." is the working tree
#
# Each target: gen.py lifts the real code from that revision's
# SDUIRenderer.swift, it compiles against Shim.swift, and runs every scenario.
# Output per target in build/<name>/: report.txt, results.json, coverage.png.
#
# Needs swiftc, or docker (it then runs in the official swift:6.0 image).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
rel="app/targets/keyboard"
kb="$repo/$rel"
cd "$here"
[ $# -eq 0 ] && set -- .

swift_run() {
  if command -v swiftc >/dev/null; then bash -c "$1"
  else docker run --rm -v "$here":/sim -w /sim swift:6.0-noble bash -c "$1"; fi
}

for rev in "$@"; do
  if [ "$rev" = "." ]; then
    name="$(grep -o 'static let buildStamp = "K[0-9]*"' "$kb/SDUIRenderer.swift" | grep -o 'K[0-9]*')-worktree"
    src="$kb/SDUIRenderer.swift"; tel="$kb/KeyboardTelemetry.swift"
    mkdir -p "build/$name"
  else
    stamp="$(git -C "$repo" show "$rev:$rel/SDUIRenderer.swift" | grep -o 'static let buildStamp = "K[0-9]*"' | grep -o 'K[0-9]*')"
    name="$stamp-$(git -C "$repo" rev-parse --short "$rev")"
    mkdir -p "build/$name"
    git -C "$repo" show "$rev:$rel/SDUIRenderer.swift" > "build/$name/SDUIRenderer.swift"
    git -C "$repo" show "$rev:$rel/KeyboardTelemetry.swift" > "build/$name/KeyboardTelemetry.swift"
    src="build/$name/SDUIRenderer.swift"; tel="build/$name/KeyboardTelemetry.swift"
  fi
  python3 gen.py "$src" "$tel" config.json "build/$name"
  swift_run "swiftc -O -swift-version 5 $(cat "build/$name/defines") Shim.swift build/$name/Gen.swift build/$name/Layout.swift Sim.swift main.swift -o build/$name/kbsim && build/$name/kbsim $name build/$name"
  if python3 -c "import PIL" 2>/dev/null; then
    python3 -c "from PIL import Image; Image.open('build/$name/coverage.ppm').save('build/$name/coverage.png')"
  elif command -v ffmpeg >/dev/null; then
    ffmpeg -loglevel error -y -i "build/$name/coverage.ppm" "build/$name/coverage.png"
  fi
  echo
done
