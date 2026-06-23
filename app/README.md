# Tulmi app (Expo — Android + iOS)

One Expo/React Native codebase that builds **both** platforms via EAS (so iOS
ships from Windows, no Mac).

This app is a **generic, server-driven renderer** (SDUI): it boots from the
backend and draws whatever screens, navigation, styling, and behavior the server
sends — there are **no hardcoded screens**. Change the backend, change the app,
no rebuild. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and the
contract in [`../shared/types/sdui.ts`](../shared/types/sdui.ts). The renderer
lives in [`src/sdui/`](src/sdui).

The **keyboard** is a separate native module (Kotlin IME + Swift extension) —
JS can't run inside a keyboard process, so it stays native; Expo wraps and ships
it.

## First-time setup (Windows, VS Code)

The project is self-contained — `package.json`, `tsconfig.json`, `index.ts`,
`App.tsx`, `src/`, `app.config.ts`, and `eas.json` are all committed. Just
install and run:

```bash
cd app

# 1. Install dependencies (versions are pinned for Expo SDK 56)
npm install

# 2. (optional) align any native module versions to the SDK
npx expo install --fix

# 3. Install EAS CLI (once, globally) and log in to your Expo account
npm install -g eas-cli
eas login
```

## Run it (fastest feedback)

```bash
npx expo start
```

Open it in **Expo Go** on your phone (scan the QR). The app boots from the
backend and renders the server-driven screens (Home playground + Personality).

> **Backend URL:** tap the **⚙ Connection** button (top-right). Android emulator
> → your PC is `http://10.0.2.2:8770`. A physical phone on the same WiFi → your
> PC's LAN IP (e.g. `http://192.168.1.20:8770`). Production → your VPS
> `https://...`. If the app can't reach the backend on launch, it opens the
> Connection screen automatically.

> The keyboard itself needs a **dev build** (not Expo Go) because it's native —
> that comes when we add the keyboard module.

## Build + ship (the Windows → stores flow you know)

```bash
# Android APK you can install directly:
eas build -p android --profile preview

# iOS build (Expo's cloud Macs compile it) + submit to TestFlight/App Store:
eas build -p ios --profile production
eas submit -p ios
```

(iOS builds need your Apple Developer account; EAS walks you through credentials.)

## Structure

```
app/
├─ App.tsx          entry — renders the server-driven SduiApp
├─ src/
│  ├─ sdui/         the generic renderer:
│  │  ├─ SduiApp.tsx    shell: bootstrap, navigation, toasts, Connection
│  │  ├─ Renderer.tsx   walks the Node tree → React Native
│  │  ├─ components.tsx component registry + token styling
│  │  ├─ actions.ts     declarative action interpreter
│  │  ├─ state.ts       per-screen state store (dot-path get/set)
│  │  ├─ client.ts      /v1/app/* transport + capability handshake
│  │  └─ types.ts       client mirror of shared/types/sdui.ts
│  ├─ api.ts        backend brain client (refine, transcribe, draft, speak…)
│  └─ storage.ts    switchable backend URL
├─ app.config.ts    Expo config (bundle ids, permissions, plugins)
└─ eas.json         build/submit profiles
   modules/         native Android keyboard (Kotlin IME)
   targets/         native iOS keyboard (Swift extension)
```

The UI contract is `../shared/types/sdui.ts`; the brain API is
`../shared/types/api.ts`. The backend serves screens from
`../tulmi/src/experience/`.
