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
SDUIRenderer.swift        the server-driven key tree, and the mic key's mark
KBKeyFace.swift           what a key PRINTS: legend, sub, corner, icon, art, mark
KBPress.swift             press effects: fade, pop, glow
KBPath.swift              the `path` mark shape (M L Q C Z O), shared grammar
KBSkin.swift              the skin block, the budget, plain mode, fonts
Fonts/                    bundled type-token faces (see Fonts/FONTS.md)
```

## Key faces (KeySkin1)

A skin is authored and expanded on the **server**. This extension ships
primitives only — no skin resolver, no precedence chain — and the config it
receives is the key tree it always received, now with `props.face` and
`style.press` on the nodes and one `skin` block beside them.

Four laws, enforced here and not only on the server:

1. **A key never changes what it does.** A face is paint: no actions, no
   endpoints, no layout. `KBKeyFace.forbidden` drops a face that names one
   (App Review 4.4.1). `openUrl`, `openSettings` and `openApp` are limited to
   `SDUIRenderer.ownSchemes`, a compiled set, which a flag can narrow and
   nothing can widen. The host's own openers — the mic hand-off, "open the
   app for these words" and the Flow arm, all built from
   `kb.deepLink.urlTemplate` — go through the SAME test at the choke point:
   `attemptOpenApp` and `openURLViaResponderChain` both refuse a URL that is
   not on one of our schemes, so there is one lock and not four.
2. **No typed text ever leaves the device.** The config request carries the
   platform, the build stamp, `X-Tulmi-Keyboard-Can`, `X-Tulmi-Keyboard-Bad`,
   the language and the person's token. Nothing else, and the skin work adds
   nothing.
3. **Every fetch happens when the config arrives** — the config, then ONE
   batch of every art file and font in `skin.manifest`. The renderer reads
   only the cache, so no request can be tied to a keystroke. Missing art
   means the flat colour for that session.
4. **Art and fonts come by content hash from our own compiled-in hosts**
   (`TulmiImageLoader.allowedMediaHosts`: `api.x0bot.com` and
   `api.tailzu.space`, https only — two names because one server answers to
   both while the domain move lasts). A face's `art` is the BARE manifest
   name `<sha256>@<1|2|3>.png`; the phone puts its own host in front of it,
   so no host ever travels in a config. No cookies, no auth, no id in the
   URL, so a skin can never carry a tracking pixel. A DEBUG build also
   admits the exact host the app is pointed at, so face art can be seen on a
   laptop or staging server while skins are still dark; `#if DEBUG` is
   compiled out of every TestFlight and App Store build.

### One legend per key

The rule all three renderers apply, because `KeyFace` is one type:

- No `label` → the key's own title IS the legend. The face restyles it and
  it follows shift and caps for free.
- `label` that is just the key's character (`"a"` on an `a` key) → counts as
  no label, so the line above applies.
- Any other `label` → a fixed print that takes the title's place under
  either `layer`, and does not case.
- `layer` governs the PICTURES — `icon`, `art`, `mark`. `behind` (default)
  draws them under the legend; `instead` hides the key's title.
- **An emoji is an icon**, not a legend: it draws in the icon slot and
  follows `layer` like `sf:` and `asset:`. For the emoji alone, write
  `layer: "instead"`.
- `sub` sits at `subPos`; `corner` takes the opposite corner, so the two can
  never overlap.

### Type tokens

`brand`, `display` and `dots` resolve to exact **PostScript names**, not
family names — the subset files carry families like "Tailzu Bricolage
SemiBold", so a family lookup would find nothing and silently draw the system
face. See `Fonts/FONTS.md` for the table and the files.

Budgets the view enforces whatever the tree asks for (`KBFaceBudget`): 64
faced keys, 3 animated keys, 6 MB of live images, art decoded at the key's
own frame size and never above 160 px. A key that is refused keeps its plain
title — which is a key that still types.

**Plain mode.** The crash guard's trial marker is the config's sha, set when
a config is applied and cleared only on a clean finish (`viewDidDisappear`) —
never on a timer, so a memory death late in a long message is still counted.
Two strikes on a skinned config switch that sha to plain mode: `face`,
`press`, `fontFamily` and art are ignored, the tree and the colours stay, and
`X-Tulmi-Keyboard-Bad` asks the server for the unskinned tree. Two more
strikes fall back to today's behaviour — the bundled snapshot, which stays
unskinned and unchanged.

Both strikes mean **twice in a row**: a clean finish clears the config's
marker AND the skin's, so one death today and an unrelated one weeks later
do not add up. The `X-Tulmi-Keyboard-Bad` mark is stamped with the moment it
was set and lets go after `KBSkin.badSkinTTL` (30 days), so a skin fixed
under the same id reaches the device again; if it is still broken the guard
puts the mark back.

**Plain mode is also what you get with no Full Access.** The cached config
lives in the extension's own defaults, which need no Full Access, so without
it a skin received earlier would otherwise go on drawing. `adoptSkin` forces
plain mode when `hasFullAccess` is false: no Full Access, looks and types
exactly like today.

`default-config.json` is **unchanged** in this build, on purpose: the
no-Full-Access keyboard and the guard's last resort must never depend on new
code.

## On a device, before the cut

Lines this target owns in the store-build checklist (SPEC §8, "Keyboard on
device"):

- **Photograph `pop` on a solid cap, a gradient cap and a blur cap.** `pop`
  moves the key's CONTENTS (`layer.sublayerTransform`), never the cap: the
  typing plane caches every key's rect and re-reads it when the geometry
  moves, so transforming the button would rebuild that cache on every
  keystroke and move the hit target under a finger already down. A gradient
  cap clips to its bounds, so a large legend can be cropped by the scale —
  that is what the photos are for, and any fix stays in `KBPress.swift`.
- **Photograph `pop` and `glow`, held and released, on both phones with the
  same skin.** The clamps match the Android IME (scale 0.9–1.12, dy ±6), so
  one `press` block must look the same on each.
- **Fonts**: the four files in `Fonts/` are byte-for-byte copies of
  IOS-WIDGETS' subset set, and the day-1 EAS build is what proves they
  register. An empty folder proves nothing, because registering zero files
  always "works". Unzip the `.ipa` and list
  `Payload/*.app/PlugIns/TailzuKeyboard.appex/`: the four `.ttf` belong at
  the root of the extension, flat, not in a `Fonts/` folder. A missing file
  is a packaging failure; a file that is there but draws the system face is
  a registration failure.
- **The telemetry window carries its skin.** After a skin is switched on for
  a test account:
  - the first upload has no `skin` — that window straddled the switch, and a
    window that saw two skins is deliberately untagged;
  - the second, about 30 to 60 minutes later at the default
    `kb.telemetry.uploadIntervalSec` of 1800, carries it;
  - so does every upload after that.

  If the second one has no tag, `KeyboardTelemetry.drawing` has regressed and
  §8's "stop a skin whose `keysOverFrame` regresses" has no data to work on.

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
