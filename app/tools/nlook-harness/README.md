# The nlook snapshot harness

`main.swift` plans and draws the widget target's OWN renderer on a booted iOS Simulator, then prints `CHECK`, `MEASURE`
and `VERDICT` lines and leaves a PNG per family behind. It is the only place a widget layout is actually rendered
outside a phone, and it exists for the one decision H16-Q2 settled: **a root's `bg` is the widget's own background,
drawn the way the system draws that family's background** — the container on the Home Screen, `AccessoryWidgetBackground()`
on `rect` and `circle`, nothing on `inline` — and it never decides an untinted Text's colour where it is not painted in
that colour.

It needs a Mac with Xcode. Nothing here runs on Linux, and nothing here is in the app: this folder sits OUTSIDE
`app/targets/widgets/`, which @bacons/apple-targets hands to Xcode as one synchronized group, so `main.swift` is not a
source of the widget extension. It must stay outside: Swift makes a file named `main.swift` the module's top-level-code
entry point from its NAME, whatever its contents, and the extension already has `@main struct TailzuWidgetBundle`
("'main' attribute cannot be used in a module that contains top-level code"). The `NLOOK_TEST_SEAM` flag, which only
this build passes, is what keeps the store seam out of the shipping extension; it does NOT make a file in the group
safe.

## Run it

```bash
set -euo pipefail
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
APP=build/NLookHarness.app
rm -rf "$APP" && mkdir -p "$APP"

swiftc \
  -sdk "$SDK" \
  -target arm64-apple-ios17.0-simulator \
  -module-name TailzuWidgets \
  -DNLOOK_TEST_SEAM \
  -o "$APP/Harness" \
  app/targets/widgets/*.swift app/targets/widgets/_shared/*.swift app/tools/nlook-harness/main.swift
cp app/tools/nlook-harness/Harness-Info.plist "$APP/Info.plist"

xcrun simctl boot "iPhone 16" || true
xcrun simctl install booted "$APP"
xcrun simctl launch --console booted space.tailzu.nlookharness
```

Note what is NOT passed, on purpose:

- **no `-application-extension`**: the harness is a plain app, not the extension. The extension rules are enforced by the
  `widgets` job in `.github/workflows/keyboard-ios.yml`, which type-checks the same sources with that flag.
- **no `-parse-as-library`**: `main.swift` is the entry point.

The PNGs and `harness.log` land in the app's data container:

```bash
DIR=$(xcrun simctl get_app_container booted space.tailzu.nlookharness data)/Documents
ls "$DIR"   # nlook-rect.png nlook-circle.png nlook-inline.png nlook-small.png harness.log
```

## What fails the run, and what does not

**Fails** (exit 2): the planning decisions — `backdrop` asked for on `rect` and `circle` and nowhere else, the root's `bg`
gone from the drawn tree on every family, the container colour on the Home Screen, `bgRole` empty on accessory roots and
in StandBy — and "the words actually drew pixels", measured as near-white opaque pixels in the frame. On the old code the
words came out in `ground` (near-black) on an accessory root, so that count would be zero.

**Reported, not asserted**: the backdrop's own coverage. `AccessoryWidgetBackground()` is drawn by WidgetKit; in a plain
host app it may come out as a flat material or as nothing, and failing on that would be failing on the harness rather
than on the renderer. That is what the PNGs are for.
