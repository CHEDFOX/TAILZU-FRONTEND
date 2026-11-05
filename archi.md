# X0 Bot app — architecture

X0 Bot (the Bots app) is the phone client of Tailzu: an Expo / React Native app in TypeScript for iOS and
Android, plus the native parts JavaScript cannot be: two system keyboards, the widgets and Live Activities, the
share extension and a live-dictation socket.

The app is a **server-driven renderer**. It asks the backend (`TAILZU-BACKEND`) for a bootstrap — theme,
navigation, labels and flags — and then for screens, each a JSON tree of nodes and actions, and draws them with a
fixed registry of components. Nearly every product change ships from the server with no release; JavaScript changes
ship over the air (`eas update`), native changes need a store build.

Sibling repos: `TAILZU-BACKEND` (the server and the screens' source), `TAILZU-DESKTOP` (the desktop app, which
shares the bot tiles' engine with this one), `TAILZU-WEB` (the site).

## The tree

```
.github/workflows/        CI: OTA updates and store builds (eas-release), native compile checks, the keyboard simulator
app/                      the Expo app
├─ index.ts               entry: holds the splash, registers the notification background task, mounts App
├─ App.tsx                root: primes the knobs, loads the app inside an error boundary, Blip's overlay, the launch curtain
├─ app.config.ts          Expo config: ids, version, permissions, plugins, native targets
├─ eas.json               build and submit profiles
├─ assets/                icons, the launch art (assets/launch), the iOS privacy manifest
├─ src/                   the TypeScript app (below)
├─ modules/               local Expo native modules (Swift + Kotlin) and config plugins
│  ├─ tulmi-bridge/       app ↔ keyboard/widgets bridge: App Group, Keychain, Flow session, Live Activities, Android widgets, shortcuts
│  ├─ tulmi-keyboard/     the Android keyboard (InputMethodService) and its config plugin
│  ├─ tulmi-share/        share-in: the Android share intent, and the iOS share extension's App Group hand-off
│  ├─ tulmi-stream/       live dictation over a WebSocket (native mic capture)
│  └─ withPrivacyManifest.js   copies assets/PrivacyInfo.xcprivacy into the iOS app
└─ targets/               iOS extensions (@bacons/apple-targets)
   ├─ keyboard/           the iOS keyboard extension (+ ci/: the simulator harness)
   ├─ share/              the share extension
   └─ widgets/            WidgetKit: the X0 widget, Live Activities (Bots at work, the mic session, setup), controls
docs/                     guides: launch, shipping, streaming protocol, SMS/OTP setup, keyboard spec, store listing
tools/
├─ ci/                    scripts the workflows run (eas-keys.mjs, ios-version.mjs) and the Swift stand-in for ExpoModulesCore
├─ knobs/                 knob manifests (app-knobs.json, keyboard-knobs.json) and the extractors that write them
├─ keyboard-sim/          types into the iOS keyboard's real touch code on Linux (CI: keyboard-sim)
├─ android-compile/       fast local type-check of the Android keyboard's Kotlin
└─ media/                 store screenshots, previews, promo films, brand and icon work
```

### `app/src`

```
src/
├─ api.ts                 the backend "brain" client: refine, transcribe, stream config, health
├─ security.ts            what a link, URL or screen id from the server may do
├─ storage.ts             what the app keeps on the phone (backend URL, language, launch count, knob snapshot…)
├─ sdui/                  the server-driven UI engine
│  ├─ SduiApp.tsx         the shell: state, the hooks below in order, and the frame (header, screen, tabs, toast, overlays)
│  ├─ Renderer.tsx        a node → its component: bindings, conditions, events, motion, styles
│  ├─ registry.ts         what this build declares to the server (node types, actions, capabilities)
│  ├─ actions.ts          the action interpreter (navigate, setState, callEndpoint, iap.*, …)
│  ├─ fill.ts             "$state.x" references in an action's params and text
│  ├─ state.ts            the per-screen Store (dot-path get/set)
│  ├─ knobs.ts            every server-tunable label and value, with its compiled-in fallback
│  ├─ types.ts            the wire types (client mirror of TAILZU-BACKEND shared/types/sdui.ts)
│  ├─ shell/              the shell's parts: Header, TabBar, ToastView, ScreenHost, LaunchCardOverlay,
│  │  │                   UpdateGateOverlay, ConnectionScreen, ErrorBoundary, edge-swipe gestures, tab icons, styles
│  │  └─ hooks/           one hook per concern of the shell (boot, session, keyboard entry, splash, navigation, …)
│  ├─ client/             transport: bootstrap + disk copy, screens + caches, capabilities, errors, endpoint, update check
│  ├─ theme/              ThemeContext, the type scale (typeRole), style resolution, remote fonts
│  ├─ components/         one file per node component; components/index.ts is the REGISTRY
│  ├─ bots/               the Bots app's living components: BotTiles, BotCard, BotBuddy, Home's header, pull-a-bot, BotStage
│  │                      (a bot with a thought; stageCore.ts its geometry and taps; thought.ts what a field in it may ask),
│  │                      BotCrowd (a box of tiny bots)
│  ├─ voice/              live words turn by turn (voiceLive / voiceStop: voiceLive.ts on tulmi-stream, voiceLiveCore.ts the loop),
│  │                      and the voice bus (voiceBus.ts: the words and the level, kept out of the screen's state)
│  ├─ live/               live updates over the socket, and an answer's words streamed into state (askStream)
│  └─ offline/            the connection, the Offline page switch, the outbox, the can't-reach-the-server card
├─ auth/                  sign-in
│  ├─ AuthGateScreen.tsx  the gate: email/phone code flow, Apple, Google; draws the server's sign-in tree when it has one
│  ├─ gate/               the gate's parts: pills, country sheet, glyphs, look, styles, Apple and Google sign-in hooks
│  ├─ sdui/               the sign-in screen's SDUI nodes (SwipePill, CodeEntry, …) and their render context
│  └─ …                   Supabase client and config, captcha, sign-in links (PKCE state), session restore
├─ onboard/               Blip, the onboarding's character: stage, spots, figure, motion, the Skia overlay
├─ botTiles/              the living bot tiles' engine (core.ts, shared with the desktop), looks catalog, Skia surface
├─ media/                 media player and registry, uploads / audio / voice recording actions, the bots' sounds
├─ launch/                the launch curtain (the splash's art, animated) and its timing
├─ billing/               RevenueCat purchases, store prices, managing a subscription bought elsewhere
├─ notifications/         push token, notification categories and buttons, the background task for them
├─ widgets/               what the app hands the widgets: glance, now, quick access, Flow copy, theme
├─ quickActions/          the app icon's long-press items
├─ share/                 share-in: files from other apps to the backend, then the share screen
├─ deeplinks/             tulmi:// and universal-link parsing
├─ device/                device signals (microphone, keyboard enabled / full access)
└─ telemetry/             Sentry, PostHog analytics, Meta ads
```

Tests sit beside their modules as `*.test.ts` (Node's test runner over the pure `*Core.ts` modules and helpers).

## Where to find X

| Looking for | Go to |
|---|---|
| App start, the splash hold | `app/index.ts`, `app/App.tsx` |
| The shell: boot, navigation stack, tabs, toast | `src/sdui/SduiApp.tsx` and `src/sdui/shell/hooks/` |
| Bootstrap and first screen | `shell/hooks/useBootLoader.ts`, `sdui/client/bootstrap.ts` |
| Fetching and caching screens | `shell/hooks/useCurrentScreen.ts`, `sdui/client/screens.ts` |
| Rendering a node tree | `src/sdui/Renderer.tsx` |
| A node component (Screen, Stack, Text, Image, Button, …) | `src/sdui/components/<Name>.tsx`; the type → component map is `components/index.ts` |
| The Bots kit (tiles, cards, buddy, Home's header, pull-a-bot) | `src/sdui/bots/`; engine in `src/botTiles/` |
| Spaces' pieces (section 3i): a bot with a thought, a crowd, a vanishing row, the @ and / field, live words | `sdui/bots/BotStage.tsx` + `stageCore.ts`, `sdui/bots/BotCrowd.tsx`, `sdui/components/Vanish.tsx`, `sdui/components/MentionField.tsx` + `mentionCore.ts`, `sdui/components/LiveWords.tsx` + `liveWordsCore.ts`; walking, roaming, listening, the thought's trail and follow in `src/botTiles/core.ts` |
| Talking to a bot (voiceLive, voiceStop) | `sdui/voice/voiceLive.ts` (the microphone, the screen's actions), `voiceLiveCore.ts` (turns, pauses, the made-up level), `voiceBus.ts` |
| A dotted border with round corners; the screen behind an overlay, blurred | `sdui/components/dotted.tsx` (Stack draws it), `sdui/components/blur.tsx` (BotCard, BotStage) |
| Actions (what a tap does) | `src/sdui/actions.ts`; media actions in `src/media/media.ts` |
| What the build declares to the server | `src/sdui/registry.ts` |
| Theme, type scale, styles | `src/sdui/theme/` |
| Knobs (server-tunable values) | `src/sdui/knobs.ts`; manifest `tools/knobs/app-knobs.json` (`node tools/knobs/extract.mjs`) |
| Sign-in | `src/auth/AuthGateScreen.tsx`, `src/auth/gate/`, server-drawn variant `src/auth/sdui/` |
| Session restore, sign-out cleanup | `shell/hooks/useAuthSession.ts`, `src/auth/restore.ts`, `sdui/client/bootstrap.ts` (forgetAccountData) |
| Purchases / paywall gate | `src/billing/purchases.ts`; the gate in `shell/hooks/useBootLoader.ts`; `iap.*` in `actions.ts` |
| Keyboard ↔ app (mic handoff, Flow session) | `shell/hooks/useKeyboardEntry.ts`, `useFlowArming.ts`, `src/widgets/flow.ts`, `modules/tulmi-bridge/` |
| iOS keyboard | `app/targets/keyboard/` (spec: `docs/keyboard-spec.md`) |
| Android keyboard | `app/modules/tulmi-keyboard/android/` |
| Widgets (iOS / Android) | `app/targets/widgets/` / `modules/tulmi-bridge/android/…/TailzuX0Widget.kt`; data from `src/widgets/` |
| Live Activities | `targets/widgets/BotsActivity.swift`, `FlowActivity.swift`, `SetupActivity.swift`; started from `modules/tulmi-bridge/ios/*LiveActivity.swift`; JS side `src/widgets/glance.ts`, `src/widgets/flow.ts` |
| Live updates (screens refreshed from another device) | `src/sdui/live/` |
| Offline page and outbox | `src/sdui/offline/` |
| Deep links | `src/deeplinks/router.ts`; handled in `shell/hooks/useStartup.ts`; allowed bare actions in `useDeepLinkActions.ts` |
| Push notifications | `src/notifications/` |
| Share-in | `src/share/`, `modules/tulmi-share/`, `targets/share/` |
| Telemetry (Sentry, PostHog, Meta) | `src/telemetry/`; started in `shell/hooks/useStartup.ts` |
| Onboarding character (Blip) | `src/onboard/` |
| Launch animation | `src/launch/` |
| Live dictation protocol | `docs/STREAMING.md`, `modules/tulmi-stream/` |
| CI and release scripts | `.github/workflows/`, `tools/ci/` |
| Store listing and media | `docs/store-listing.md`, `tools/media/store/` |

## How the parts connect

**Boot.** `index.ts` holds the native splash and mounts `App`. `App.tsx` reads the last bootstrap's labels and
flags from a synchronous store and points the knobs at them *before* requiring the rest of the app (module-scope
values read knobs), then renders `SduiApp` inside an error boundary, with Blip's overlay and the launch curtain on
top. On a first launch it briefly waits for a pending OTA update.

**Session.** `useAuthSession` restores the Supabase session (a reinstall starts signed out; a refresh that fails
for a moment does not sign anyone out). No session → the sign-in gate (`AuthGateScreen`), which draws the server's
sign-in tree when the bootstrap sends one and the native screen otherwise. Sign-out clears everything the account
left on the phone.

**Bootstrap → screen.** `useBootLoader` reads the device signals, then paints from the bootstrap on disk while the
fresh one is fetched (`POST /v1/app/bootstrap`, with the capabilities from `client/capabilities.ts`). Committing a
bootstrap sets the knobs, fonts, layout direction, media registry, the widgets' data and the paywall gate, then
picks the first screen. `useCurrentScreen` fetches the screen on top of the stack (`POST /v1/app/screen`), drawing a
cached copy at once and revalidating behind it; `ScreenHost` gives each screen its `Store` and renders its tree
with `RenderNode`.

**Rendering.** `Renderer.tsx` walks the tree: for each node it binds props to the screen's state (`bind`), checks
`visibleIf`, resolves conditional style values and theme tokens, wires its events (`onAppear` fires when the node
becomes visible), and hands it to the component the registry names for its `type`. A type the build does not draw
falls back to the node's `fallback`; the server only sends what `registry.ts` declares.

**Actions.** A node's events name actions; `runAction` (`actions.ts`) interprets them — navigation through the
shell's `NavApi`, state changes on the screen's `Store`, `callEndpoint` to the backend (only under `/v1/`), media,
purchases, permissions, haptics, composition (`sequence`, `condition`, …). Offline, eligible calls wait in the
outbox and are sent in order once the phone is back.

**Native.** JavaScript reaches native code through the local modules: `tulmi-bridge` (App Group / Keychain shared
with the keyboards and widgets, the background Flow session that keeps the mic warm for the keyboards, Live
Activities, Android widgets and shortcuts), `tulmi-stream` (live dictation), `tulmi-share`. Optional native modules
are `require()`d inside functions on purpose, so a binary without one keeps working. The keyboards fetch their own
SDUI config from the server and run in their own processes.

**The tile engine.** `src/botTiles/core.ts` is the living tiles' physics and drawing, shared with the desktop app:
`node src/botTiles/genDesktop.mjs` writes `TAILZU-DESKTOP/botTiles.js` from it, and tests on both sides check the
copy is current. `genStarter.mjs` copies the server's looks catalog into `starter.ts` (and the desktop) at release.

## Contracts with the other repos

- `tools/knobs/app-knobs.json` (and `keyboard-knobs.json`) are read by the backend's `tulmi/scripts/sync-knobs.mjs`.
  Regenerate with `node tools/knobs/extract.mjs` (and `extract-keyboard.mjs`) after adding knobs.
- `TAILZU-DESKTOP/botTiles.js` is generated from `src/botTiles/core.ts` (header carries both hashes).
- `src/sdui/types.ts` and `src/api.ts` mirror `TAILZU-BACKEND/shared/types/sdui.ts` and `api.ts` by hand;
  `src/botTiles/starter.ts` is generated from `TAILZU-BACKEND/shared/bots/looks.json`.
- The backend's render check (`tulmi/scripts/bots-render`) bundles this app's renderer through
  `@app/sdui/Renderer`, `@app/sdui/components` (ThemeContext, typeRole), `@app/sdui/state`, `@app/sdui/knobs` and
  `@app/onboard/stageBus`; keep those modules and exports.
- The backend writes the keyboards' bundled first-open config into `targets/keyboard/default-config.json` and
  `modules/tulmi-keyboard/android/res/raw/tailzu_default_config.json` (`scripts/export-keyboard-snapshots.ts`).
- `tools/ci/ios-version.mjs` reads the `version:` line of `app/app.config.ts`.

## Run, test, build, ship

```bash
cd app
npm install
npx tsc --noEmit        # type-check
npm test                # node --test over src/**/*.test.ts
npx expo start          # Metro; the native parts need a development build (npx expo run:ios / run:android)
```

- Builds and submissions: EAS (`app/eas.json`), started from GitHub Actions → **EAS Release**
  (`.github/workflows/eas-release.yml`): an OTA update, an iOS build to TestFlight, or an Android `.aab`.
- A push to `main` that touches `app/` sends an **over-the-air update to every installed phone** — unless it also
  touched a native file (`app/targets`, `app/modules`, `app.config.ts`, `package.json`, …), in which case no update
  is sent and a store build is needed.
- Day-to-day shipping for every repo: `docs/SHIP.md`. Launch checklist: `docs/LAUNCH.md`. Store copy:
  `docs/store-listing.md`. Phone sign-in setup: `docs/SUPABASE-OTP.md`, `docs/TWILIO-SMS.md`.
