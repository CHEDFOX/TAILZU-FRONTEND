# Tulmi keyboard (native Android IME)

The keyboard runs in a separate system process where JavaScript can't run, so
it's **native Kotlin**. Expo wraps and builds it via the config plugin in
`plugin/withTulmiKeyboard.js` (registered in `../../app.config.ts`), which
copies every top-level `android/*.kt` file and `android/res/**` into the
prebuilt project — a new `.kt` file needs no plugin change.

The rule is **the backend is the creator, the keyboard is a renderer**: the
layout, theme, labels and every tunable number come from
`GET /v1/keyboard/config`, and the Kotlin only draws and wires them.

## What's here

```
android/
├─ TulmiKeyboardService.kt   the IME: config load/cache, dictation, refine, autocorrect, text expansion
├─ SDUIRenderer.kt           walks the server's node tree into views; reads flags with flagFloat/flagBoolean/…
├─ TulmiKeyPlane.kt          a row of keys that owns its touch (gap filling, drift, drawn keys)
├─ TulmiTone.kt              the tone pill: server voices + tones, the active pick, PUT /v1/personality
├─ KbKnobs.kt                knobFloat/knobBool/knobString/knobLabel… for files outside the renderer
├─ Net.kt                    backend client (every request carries X-Tulmi-Keyboard-Build: A<n>)
├─ Stream.kt                 live dictation over /v1/transcribe-stream
├─ TulmiAutocorrect.kt, TulmiCorrections.kt, TulmiTelemetry.kt, TulmiImageLoader.kt,
│  TulmiPersonalityRow.kt, TulmiAudioFx.kt
└─ res/
   ├─ raw/tailzu_default_config.json   the server's config, bundled for the first open
   ├─ layout/keyboard.xml, xml/qwerty.xml   legacy keyboard (only when a config opts out of SDUI)
   └─ xml/method.xml                        IME metadata
plugin/withTulmiKeyboard.js  injects the above into the Android build
```

## Server values

- Every flag/label read uses a **literal default in the call**
  (`flagFloat("kb.delete.repeatIntervalMs", 50f)`, `label("return.send", "Send")`,
  `knobStrings("kb.swipe.extraWords", listOf())`). `tools/knobs/extract-keyboard.mjs`
  collects those and the backend sends every key, so a default only matters
  before the first config.
- `SDUIRenderer.BUILD_STAMP` (`A2`) is the one build constant: it stamps
  telemetry and the `X-Tulmi-Keyboard-Build` header the backend targets by.
- The last config that parsed is kept (`tulmi_kb` / `config_json`); a bad
  fetch or a corrupt cache never drops the keyboard to the legacy layout.
- The app can pre-seed that cache with `setKeyboardConfig(json)` and shares its
  URL, token and text-expansion dictionary through the `tulmi` preferences
  (tulmi-bridge).

## How it builds

The keyboard is **not** available in Expo Go (Expo Go can't load custom native
code). You need a **dev build**:

```bash
cd app
npx expo prebuild -p android      # generates android/, runs the plugin
npx expo run:android              # builds + installs on a device/emulator
```

Then on the phone: **Settings → System → Languages & input → On-screen keyboard
→ Manage keyboards → enable Tailzu**, then switch to it with the keyboard-switch
icon. Grant microphone permission by opening the Tailzu app once.

CI (`.github/workflows/keyboard-android.yml`) runs the prebuild and
`./gradlew :app:compileDebugKotlin` on every change under `android/`.
