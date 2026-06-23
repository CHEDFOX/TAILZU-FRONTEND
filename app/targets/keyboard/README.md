# Tulmi keyboard (native iOS keyboard extension)

The iOS counterpart to the Android IME in `../../modules/tulmi-keyboard/`. iOS
custom keyboards are a native **app extension** written in Swift; Expo adds the
target via [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets)
(registered in `../../app.config.ts`).

## What's here

```
expo-target.config.js     declares the "keyboard" app-extension target
Info.plist                NSExtension config + RequestsOpenAccess + mic usage
KeyboardViewController.swift  the keyboard: QWERTY + 🎙 mic + ✨ Refine, inserts text
TulmiBackend.swift        backend client (POST /v1/refine, /v1/transcribe-clean)
```

## Feature parity with Android

| Feature | Android | iOS |
|---|---|---|
| Typing (QWERTY) | ✅ | ✅ |
| ✨ Refine whole field | ✅ | ✅ |
| 🎙️ Voice dictation | ✅ (in-keyboard) | ✅ (in-keyboard) |

**Voice runs inline in the keyboard** (not via an app-handoff). Despite older
Apple docs, a keyboard extension *can* record the microphone once the user
enables **Allow Full Access** — this is the same inline approach Wispr Flow uses.
Requires `NSMicrophoneUsageDescription` (set in Info.plist) and `.record`
AVAudioSession. If a future iOS build ever blocks this, the fallback is an
app-handoff (keyboard opens the main app to record, then returns the text via a
shared App Group).

## How it builds (requires macOS or EAS)

iOS native targets can only be compiled on a Mac or via EAS Build. From a Mac:

```bash
cd app
npm install @bacons/apple-targets
npx expo prebuild -p ios     # generates ios/, adds the keyboard target
npx expo run:ios             # builds + installs on a simulator/device
```

Or build in the cloud (needs an Apple Developer account for a real device):

```bash
npx eas-cli build --profile development --platform ios
```

Then on the iPhone: **Settings → General → Keyboard → Keyboards → Add New
Keyboard → Tulmi**, then enable **Allow Full Access** (required for ✨ Refine to
reach the backend). Switch to it with the 🌐 globe key.

## Known v1 limits / TODO

- Voice has only been verified to compile/build on macOS; confirm mic capture
  works on a real device with Full Access enabled.
- Backend URL is a constant in `TulmiBackend.swift` — bridge the app's saved URL
  (via a shared App Group) later.
- iOS only exposes text *around the cursor*, so Refine replaces the visible
  context rather than guaranteed whole-field text.
- `targetApp` is hard-coded to `Generic` — iOS sandboxing hides the host app's
  identity, so per-app tone matching isn't available like it is on Android.
- Minimal QWERTY (letters, shift, space, delete, return) — numbers/symbols later.
