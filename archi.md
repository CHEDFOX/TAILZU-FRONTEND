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
│  │                      BotCrowd (a box of tiny bots), PersonBot (a person as their own tiny bot, idling; personBotCore.ts
│  │                      his box, his idle and the one loop every PersonBot shares)
│  ├─ voice/              live words turn by turn (voiceLive / voiceStop: voiceLive.ts on tulmi-stream, voiceLiveCore.ts the loop),
│  │                      Plan Ease's call as a live conversation (voiceCall / voiceCallSet: callRealtime.ts on one WebRTC
│  │                      connection to the voice service, callRealtimeCore.ts its rules), and the voice bus (voiceBus.ts:
│  │                      the words and the level, kept out of the screen's state)
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
├─ notifications/         push token, notification categories and buttons, the background task for them, Plan Ease's calls
├─ widgets/               what the app hands the widgets: glance, now, quick access, Flow copy, theme
├─ quickActions/          the app icon's long-press items
├─ share/                 share-in: files from other apps to the backend, then the share screen
├─ deeplinks/             tulmi:// and universal-link parsing
├─ device/                device signals (microphone, keyboard enabled / full access); what the binary can do that an
│                         update cannot add (binaryCore.ts: Time Sensitive pushes, the widget's steps, the live call)
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
| A person as their own tiny bot (section 3j: no initials anywhere in Spaces), in the "@" list too | `sdui/bots/PersonBot.tsx` (the node, PersonBotView for a list drawn from data), `sdui/bots/personBotCore.ts` (his box, his idle recipe and gestures, the one loop; tested on the real engine) |
| The messages' face (Bricolage Grotesque, capability FontBricolage) | no file of its own: the bootstrap's `fonts` names "Tailzu Bricolage", "… Medium", "… SemiBold" for a build that declares it, and `theme/remoteFonts.ts` registers them as it does Geist (the files and their licence are the server's, TAILZU-BACKEND tulmi/fonts) |
| Talking to a bot (voiceLive, voiceStop) | `sdui/voice/voiceLive.ts` (the microphone, the screen's actions), `voiceLiveCore.ts` (turns, pauses, the made-up level), `voiceBus.ts` |
| Plan Ease's call as a live conversation (`voiceCall`, `voiceCallSet`; capability `VoiceRealtime`, a store build only): one WebRTC connection from the phone straight to the voice service, our server doing the handshake with its own key and holding the session beside it, the data channel read only | `sdui/voice/callRealtime.ts` (the microphone, the connection, the screen's actions; the one guarded `require` of `react-native-webrtc`), `callRealtimeCore.ts` (phases, the words kept, the write throttle, the timers, the echo-canceller list, which screen holds the call) + `.test.ts`, `callRealtime.imports.test.ts` (no file imports the client), `callRealtime.turns.test.ts` (one microphone at a time: End
mid-open, two taps, the warm-up still opening, the app going behind something while it connects, a brief ICE "disconnected"); the phone's call audio in `modules/tulmi-stream` (`callAudio`: speaker, focus, interruptions; the software echo canceller in `CallAec.kt` + `TulmiStreamPackage.kt`, applied at the start of the app, `android/consumer-rules.pro`); the binary's own promise in `src/device/binaryCore.ts` (`realtimeCall`); the call ended with the screen in `sdui/shell/ScreenHost.tsx` and the Flow question in `modules/tulmi-bridge/index.ts` (`isFlowActive`); the native config in `app.config.ts`, `plugins/withNoWebrtcFgs.js` and `plugins/withWebrtcPin.js`; the protocol in `docs/STREAMING.md` |
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
| Widget lines that switch on their own (the glance's `steps`: a leave-by, then the next thing) | `src/widgets/glanceCore.ts` (`cleanSteps`, `glanceAt`, the rule), `targets/widgets/X0Glance.swift` (`asOf`, `X0Provider`), `modules/tulmi-bridge/android/…/X0Steps.kt` and `TailzuX0Widget.kt` (the step alarm) |
| What only the binary can promise the server (PushTimeSensitive with the push token, GlanceSteps in the bootstrap and `steps=1` on the glance, VoiceRealtime for the live call) | `src/device/binaryCore.ts` (`binary.ts` reads the bridge's `binaryFeatures`, `TulmiBridgeModule.swift` / `.kt`); the Time Sensitive entitlement in `app.config.ts` |
| Which notification button opened the app (`PushButton`): an opening button's id goes to the push's screen as its `button` param, a plain tap has none, so the server's hand-off screens open UPI, WhatsApp or Maps only for Pay, Send, No or Open map | `src/notifications/push.ts` onTap, `categoriesCore.ts` pressedButton; declared in `src/sdui/registry.ts` |
| A notification button pressed once is answered once (Plan Ease follow-through): the act key is the push and the button (`pressKey`, from `data.pushId`, never the notification's identifier, which a follow's pushes share as their collapse id); a tap is remembered by notification, push and button (`tapSeenKey`); the same press still being answered by its other copy (409 in_progress) is tried again, not refused; the server's buttons registered on every bootstrap, the newest list last (`latestOnly`) | `src/notifications/categoriesCore.ts` (pressKey, answerKey, tapSeenKey, retryable, latestOnly), `actions.ts`, `push.ts` onTap, `categories.ts`; the bootstrap effect in `src/sdui/SduiApp.tsx` |
| "X0 is calling" (a leave-by or a bill due today rings the phone): the token caps, Android's call channels, the iPhone's ringtone, clearing old rings; the call screen's pieces (speak loud / onDone, voiceLive duplex, Text "elapsed") | `src/notifications/calls.ts` + `callsCore.ts`, `ringtone.ios.ts` / `ringtone.ts` + `ringtoneCore.ts`, `assets/sounds/x0_ring_1.wav` (made by `tools/sounds/make_ring.py`); `src/sdui/voice/speech.ts`, `voice/voiceLive.ts`, `components/Text.tsx` + `elapsedCore.ts`; declared as `BotCall` in `src/sdui/registry.ts` |
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
Activities, Android widgets and shortcuts), `tulmi-stream` (live dictation, and the phone's audio for a live call:
`callAudio`), `tulmi-share`. A store build also links `react-native-webrtc` for the live call. Optional native modules
are `require()`d inside functions on purpose, so a binary without one keeps working. The keyboards fetch their own
SDUI config from the server and run in their own processes.

**Calls.** Plan Ease can ring the phone for a leave-by or a bill due today instead of sending the push (the backend's
`docs/plan-ease.md` "Calls" has the whole story). It is an ordinary notification, "<Name> is calling" with Answer and Not
now (the server's categories `x0_call` and `x0_call_missed`, registered like any other), never CallKit or VoIP. The server
rings only a token whose `caps` say `BotCall` (`push.ts` registerForPushToken, `callsCore.ts` callCaps): always on iOS, and on
Android only when `calls.ts` makeCallChannels has made the `calls` channel (high importance, the default sound, a call-like
vibration) and `calls_missed` (quiet), and the person has blocked neither Calls nor Reminders (`plan_reminders`). Without it
the phone gets today's push. An iPhone also says `BotRingtone` once `ringtone.ios.ts` has copied the tone, shipped in the
update as an asset, into the App Group container's `Library/Sounds` (the registration waits up to 2 s for it); only then
does the server name `x0_ring_1.wav` as the push's sound. Android cannot play a sound an update brings (a notification
sound is a `res/raw` resource), so `ringtone.ts` there says no, and the channel `calls_ring` is kept for a store build that
packs `res/raw/x0_ring_1.wav` (a channel's sound is fixed once it is made). Every push of one call shares a collapse id and
tag (`call-<id>`), so ring 2 and the missed call replace ring 1; what a device keeps anyway is cleared here: on launch and
on coming to the front, a ring older than 50 s by its own delivery time (`clearRingingCalls`; never a live ring, never a
missed call, never from a push's arrival), and on a tap or button on any of a call's notifications, all of that call's
(`dismissCall`, from `push.ts` onTap). Answer, a tap and Call back open the server's `bots.plan.call` screen; Not now is a
background `call` button. The screen relies on `speak` with `loud` and `onDone` (`voice/speech.ts`), `voiceLive` with
`duplex`, and Text `format: "elapsed"`, which the bundle declares as `BotCall`.

**A call that is a conversation.** The call above is turn by turn: the bot speaks, then listens, then speaks. A STORE BUILD
can answer it live instead — one WebRTC connection from the phone straight to the voice service, both sides talking, either
able to interrupt (`voiceCall` / `voiceCallSet`, `sdui/voice/callRealtime.ts`; `docs/STREAMING.md` has the protocol and the
rest of the reasoning). Our server does the handshake with its own key and holds a second connection beside the call for the
tools, the record and the endings, so the phone never holds a credential and the data channel it reads is read only. Because
the client (`react-native-webrtc`) is native, the capability `VoiceRealtime` is NOT in `registry.ts`: it comes from the
bridge's `binaryFeatures` (`realtimeCall`), so the very same update on an older binary says nothing, is sent no live call, and
keeps the turn-by-turn one. The one `require` of the client is behind that feature and inside try/catch, and
`callRealtime.imports.test.ts` fails if any file imports it instead. While a call is on — from the moment the audio session
is asked for, a warmed-up microphone included — `media.ts` (sounds, playback, dictation), `media/sounds.ts` (the bots' little
sounds) and `voice/speech.ts` stand aside rather than take the audio session from under it, and leaving the screen ends the
call with it (`ScreenHost.tsx` → `callRealtimeCore.ts` `leaveCall`, beside `leaveMedia` / `leaveVoice` / `leaveSpeech`). One
microphone opens at a time: the warm-up (`voiceCallSet` `warm`, which returns at once so the answer goes out beside it), the
call, and a second tap each wait for the one in front instead of opening their own, and an End mid-open ends whatever holds
the call (`endCallNow`) — the three races are in `callRealtime.turns.test.ts`, with the phone stood in for. A
Flow session is asked about before the microphone is opened (`modules/tulmi-bridge` `isFlowActive`) and ended if one holds
it; one that will not let go means no live call. The native side of it is `modules/tulmi-stream`'s `callAudio` (loudspeaker,
communication mode and focus, interruptions). The software echo canceller for phones whose own one is weak cannot be chosen
when a call starts — React builds the live client's audio as the app starts, before any JS runs — so `prepare` remembers what
`SOFT_AEC_MODELS` asked for and `CallAec.kt` applies it at the next start of the app, from `TulmiStreamPackage.kt`'s
application listener; it reaches the client by name, which `android/consumer-rules.pro` keeps, and loads nothing of the
client on a phone that does not need it. Because of that, `callAudio` answers which canceller the process really has, and a
call that needs the software one and has the phone's own stays a turn call (`openMic`, before anything is sent to the server):
on those models the bot hears itself and could answer its own read-back. `openMic` is also the ONLY place the ask is written, on
purpose: it runs only for people the server sent a live call to, so a phone pays that start-up load only if someone on it really
gets live calls. The store build's config is `app.config.ts` plus
`plugins/withNoWebrtcFgs.js` (no screen-sharing foreground service in the merged manifest) and `plugins/withWebrtcPin.js`
(one named libwebrtc on both phones, instead of the floating versions the library asks for), with `SYSTEM_ALERT_WINDOW`
blocked. `runtimeVersion` is unchanged, following commit 63e40b4: new native code, gated on a binary feature.

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
