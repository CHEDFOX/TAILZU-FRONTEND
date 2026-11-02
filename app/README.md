# app — the X0 Bot Expo app

One Expo / React Native codebase for iOS and Android. It is a generic, server-driven renderer: it boots from the
backend and draws whatever screens, navigation and styling the server sends. The folder map, how boot, rendering and
actions fit together, and where each feature lives are in [../archi.md](../archi.md).

```
index.ts, App.tsx   entry and root
src/                the TypeScript app (sdui/ is the renderer and shell)
modules/            local native modules (tulmi-bridge, tulmi-keyboard, tulmi-share, tulmi-stream)
targets/            iOS extensions: keyboard, share, widgets
assets/             icons, launch art, iOS privacy manifest
app.config.ts       Expo config (ids, version, permissions, plugins)
eas.json            build and submit profiles
```

## Commands

```bash
npm install
npx tsc --noEmit                 # type-check
npm test                         # unit tests
npx expo start                   # Metro
npx expo run:ios                 # development build (needed for the keyboards, widgets and other native parts)
npx expo run:android
```

Releases go through EAS from GitHub Actions (see [../docs/SHIP.md](../docs/SHIP.md)). `app.config.ts`'s `version:`
line is read by `../tools/ci/ios-version.mjs`, which checks it against the App Store before an iOS build.
