# Tulmi — app

The **Tulmi** mobile app: an Expo (React Native) client for Android + iOS that
turns rough speech or typing into clean, ready-to-send text **in your own
voice**. The app is a thin, **server-driven** shell — the backend decides what
screens to show and does all the language work.

> **Backend lives in its own repo.** This repository is the app only. The
> Fastify backend (voice/typing/screen pipeline, Supabase auth, SDUI catalog)
> was split out — it runs on the VPS and is deployed separately.

## Layout

```
app/                Expo app (Android + iOS from one codebase)
├─ src/sdui/        Server-Driven UI engine (renderer + action interpreter)
├─ src/auth/        Supabase email auth (sign in/up, JWT, session)
├─ src/api.ts       Backend client (talks to the VPS)
├─ modules/         Native Android keyboard (Kotlin IME) via config plugin
└─ targets/         Native iOS keyboard extension (Swift) via @bacons/apple-targets
```

## Quick start

```bash
cd app
npm install
npm start            # press 'a' for Android, or scan the QR with Expo Go
```

Point the app at the backend: launch it, tap **⚙ (top-right)**, and set the
backend URL to your VPS (e.g. `https://flow.yourdomain.com`).

> Expo Go runs the main app, auth, and onboarding. The **native keyboard**
> needs a development build: `npx expo prebuild` then `npx expo run:android`
> (iOS builds via EAS — `eas build -p ios`).

## How it works

- **Server-driven UI** — the backend sends a tree of UI nodes + actions; the app
  renders them generically. Most product changes ship from the server with no
  app update. See `app/src/sdui/`.
- **Auth** — Supabase email sign-in; the JWT is sent to the backend, which
  verifies it and scopes data per user. Config in `app/src/auth/`.
- **Keyboard** — a native phone keyboard (separate system process where JS can't
  run): Kotlin `InputMethodService` on Android, Swift keyboard extension on iOS,
  both packaged by Expo.

## Build

| Target | Command | Notes |
|---|---|---|
| Android (dev) | `npx expo run:android` | needs Android Studio |
| Android (cloud) | `eas build -p android` | APK/AAB for Play |
| iOS (cloud) | `eas build -p ios` | no Mac needed; needs Apple Developer account |

App identifiers: `com.tulmi.app` (both platforms). Build profiles in
`app/eas.json`.
