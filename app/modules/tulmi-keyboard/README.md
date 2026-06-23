# Tulmi keyboard (native Android IME)

The keyboard runs in a separate system process where JavaScript can't run, so
it's **native Kotlin**. Expo wraps and builds it via the config plugin in
`plugin/withTulmiKeyboard.js` (registered in `../../app.config.ts`).

## What's here

```
android/
├─ TulmiKeyboardService.kt   the IME: QWERTY + 🎙 mic + ✨ refine, inserts text
├─ Net.kt                    backend client (POST /v1/transcribe-clean, /v1/refine)
└─ res/
   ├─ layout/keyboard.xml    keyboard view + status line
   └─ xml/method.xml, qwerty.xml   IME metadata + key layout
plugin/withTulmiKeyboard.js  injects the above into the Android build
```

## How it builds

The keyboard is **not** available in Expo Go (Expo Go can't load custom native
code). You need a **dev build**:

```bash
cd app
npx expo install expo-audio @react-native-async-storage/async-storage
npx expo prebuild -p android      # generates android/, runs the plugin
npx expo run:android              # builds + installs on a device/emulator
```

Then on the phone: **Settings → System → Languages & input → On-screen keyboard
→ Manage keyboards → enable Tulmi**, then switch to it with the keyboard-switch
icon. Grant microphone permission by opening the Tulmi app once.

## Known v1 limits / TODO

- Backend URL is a constant in `Net.kt` — we'll bridge the app's saved URL later.
- Uses the one-shot REST endpoints; live `/v1/stream` streaming comes next.
- Minimal QWERTY (letters, numbers, space, mic, refine) — symbols/emoji later.
