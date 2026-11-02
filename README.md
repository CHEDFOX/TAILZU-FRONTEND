# X0 Bot — phone app

The X0 Bot app for iOS and Android: an Expo (React Native, TypeScript) client that draws whatever the Tailzu
backend sends (server-driven UI), plus its native parts — the iOS and Android keyboards, widgets and Live
Activities, the share extension and live dictation.

The backend (`TAILZU-BACKEND`) composes the screens and does the language work; this repository is the app only.
The architecture, the folder map and a "where to find X" index are in **[archi.md](archi.md)**.

## Layout

```
app/        the Expo app: src/ (TypeScript), modules/ (native modules, Android keyboard), targets/ (iOS extensions)
docs/       launch and shipping guides, the streaming protocol, phone sign-in setup, keyboard spec, store listing
tools/      CI scripts, knob manifests, the keyboard simulator, store and brand media
```

## Develop

```bash
cd app
npm install
npx tsc --noEmit     # type-check
npm test             # unit tests (node --test over src/**/*.test.ts)
npx expo start       # Metro; the keyboards, widgets and other native parts need a development build
```

A development build: `npx expo run:ios` / `npx expo run:android` (or `eas build --profile development`).

## Build and ship

Store builds and over-the-air updates run on EAS, started from GitHub Actions → **EAS Release**
(`.github/workflows/eas-release.yml`). A push to `main` that touches `app/` publishes an over-the-air update to
every installed phone, unless it also changed a native file, in which case it needs a store build. Commands for
every repo are in [docs/SHIP.md](docs/SHIP.md); the launch checklist is [docs/LAUNCH.md](docs/LAUNCH.md).

App identifiers: `com.tulmi.app` on both platforms. Build profiles: `app/eas.json`.
