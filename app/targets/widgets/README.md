# The widgets

One WidgetKit extension, named **X0** everywhere a person sees it. Everything
it shows comes from the App Group the app writes; nothing here fetches
anything, and no dictated text is ever drawn — a widget sits on a Lock
Screen. The one thing it ever sends is a Needs you button's answer (below),
with the widgets' own narrow token.

- **The Month** (`MonthWidget.swift`) — Home Screen small, and the three Lock
  Screen families. The mark, then words left and the month's line for the
  free plan; words this month and a slow line for a subscriber; the streak.
  Signed out (nothing written yet): the mark and "X0". A tap opens the
  server's `widget.month.url` (fallback `tulmi://screen/bots.usage`). The app
  writes the numbers with `setWidgetMonth` every time a bootstrap lands
  (`src/widgets/month.ts`), and the widget is redrawn then.
- **The mic session** (`FlowActivity.swift`) — a Live Activity while the
  background microphone is armed: ready, listening with the words so far,
  writing. The Lock Screen banner and the expanded island are headed by the
  mark and "X0"; the expanded island keeps the camera's sides for the name and
  the buttons and puts the phase and its hint in the bottom region, so nothing
  is cut. Compact: the mark and the ready word while ready, a waveform and the
  count while listening, a pencil and "Writing" while writing. Stop and End
  buttons post the Darwin notifications the session already listens for; End
  ("Turn off the X0 mic", `_shared/FlowEnd.swift`) runs in the app's process.
  Neither is offered as a Shortcuts action (`isDiscoverable = false`). The app
  side is `modules/tulmi-bridge/ios/FlowLiveActivity.swift`, driven by
  `FlowSessionManager`; the attributes struct is declared in both and must
  stay identical.
- **Setup** (`SetupActivity.swift`) — a Live Activity while setup is
  unfinished: the mark and "X0", the step, what it takes, and the steps as
  segments (ink on the line colour); a ring in the island. Every word and link
  is the server's (`liveActivity.setup`).
- **Dictate** (`DictateControl.swift`) — an iOS 18 Control for Control Center,
  the Lock Screen and the Action Button ("Dictate with X0": "Turn the X0 mic
  on, ready for the keyboard."). It opens the app on its arming screen, which
  arms the microphone and says "swipe back": the same path the keyboard's mic
  key takes, one tap earlier.
- **From your people** (`PeopleWidget.swift`, kind `space.tailzu.people`) —
  Home Screen small / medium / large and a Lock Screen rectangle: the latest
  few things from family and friends ("Riya shared Weekend plan", "Mom: Call
  Grandma · task", "Sam: running late"), each with who, what and when. On a
  medium or large widget a row is a link to exactly that thing in the app; a
  small one opens the only row, or the server's page for them all. Nobody yet:
  the server's line inviting a space, and its button. **The Lock Screen shows
  only the count line** ("2 new from your people"); a message's words are
  `.privacySensitive()` on the Home Screen, so StandBy / Always-On redact them.
- **Needs you** (`NeedsWidget.swift`, kind `space.tailzu.needs`) — the same
  sizes, with buttons (iOS 17 interactive widgets): a bot's question with its
  answers ("Move dinner to 7:30?" Yes / No), a connected app's yes, a task
  given to you with Done. The words open the row in the app; a button either
  answers right here (`AnswerNeedIntent`) or opens the app, as the server says
  per kind. A pressed row says how it went until the app writes the rows again.

Both quick-access widgets share `QuickAccess.swift`: the lenient model of the
document, the timeline, the parts both draw, the Keychain read and the intent.

## The look

The app's own, drawn natively (`TailzuWidgets.swift`); no colour is the
server's any more:

- **Palette** (`X0Palette`, from the backend's `experience/bots/palette.ts`).
  Light: ground `#FFFFFF`, ink `#0A0A0A`, meta `#5C5C5C`, dim `#8A8A8A`, line
  `#E6E6E6`, surface `#F5F5F5`. Dark: ground `#0A0A0A`, ink `#FFFFFF`, meta
  `#A3A3A3`, dim `#737373`, line `#262626`, surface `#171717`. Home Screen
  widgets and the Lock Screen banners follow the system's appearance; the
  Dynamic Island is always the dark one; the Lock Screen's accessory widgets
  have no ground of their own and stay system-tinted (vibrant).
- **The mark** (`X0Mark`): the app icon's painted black bot, his head, cut from
  `assets/launch/head.png` into `Assets.xcassets/X0Mark.imageset` (@2x/@3x, 32
  pt tall, padded; this folder is synced into the target whole, as the
  keyboard's catalog is). On a dark ground (Dark Mode, the island, the Lock
  Screen) he sits on a small white circle, so he stays visible. It is the brand
  mark everywhere; a waveform appears only as the live "listening" symbol.
- **Buttons** (`X0Pill`): fully rounded. The server's `primary` is filled with
  ink and worded in the ground; every other style is the secondary, a 1 pt
  line-coloured border with ink words. A pill keeps its words' width; where
  they would not fit, the row shows one Answer button instead — never a
  truncated label.
- **Rows**: separated by line-coloured hairlines. A person's row: their
  initial on a surface disc. A bot's row (a `bot` key, or a `question` /
  `approval` kind): a ring in the bot's own colour — by the row's `bot` key
  (`code`, `keybot`, `plan`, `travel`, `tailzu`, or a person's own bot's
  palette name: `BotInk`, from `art.ts` `BOT_INK` and `palette.ts`
  `PALETTE_HEX`), else the row's `color`, else ink (X0 itself is ink).
- **Type**: the system font. Titles semibold, tracking -0.2 to -0.4; meta in
  the meta grey.
- **Times** are words that hold for a minute — "now", "4 min ago", "2 h ago",
  "Yesterday", "Mon", "12 Oct" — never a ticking clock: the timeline carries
  an entry a minute until its refresh.
- **What fits is drawn whole.** A size shows at most the server's number of
  rows (`limits`), then only as many as fit, whole (`ViewThatFits`): Needs you
  shows one row with its buttons on a medium widget and up to three on a large
  one; a small one shows the first: who, the question, its in-place answers
  stacked full width (or one Answer button, the whole widget opening the row).
  From your people shows the server's whole line ("Riya shared Weekend plan")
  with the tag, the space and when under it.

## What the server decides

The widgets cannot read the server, so the app writes the server's values
into the App Group next to the numbers, and every Swift read keeps the literal
it replaced as its fallback (for a phone whose app has not written them yet):

| App Group key | Written by | Carries | App knobs |
| --- | --- | --- | --- |
| `tulmi.widget.month` | `setWidgetMonth` | the numbers, plus `headline`, `fraction`, `labels`, `url`, `refreshSec`, `span`, `showStreak`, `showProgress` (and `colors`, `alpha`: no longer read) | `widget.month.*` (labels and flags) |
| `tulmi.widget.theme` | `setWidgetTheme` | the server's colours and alphas: no longer read on iOS | `widget.color.*`, `widget.alpha.*` |
| `tulmi.widget.flow.copy` | `setFlowActivityCopy` | the Live Activity's words and SF Symbols: `ready`, `readyHint`, `listening`, `writing`, `words`, `stop`, `end`, `compact` (the ready word in the island), and when sent `compactWriting`, `compactListening`, `iconWriting`; `showWords`, `showEnd` (its `accent*` colours are no longer read) | `widget.flow.*` |
| `tulmi.widget.dictate` | `setWidgetDictate` | the Dictate control's `label` and `symbol` (and the arming `path`, mirrored below) | `widget.dictate.*` |
| `tulmi.widget.dictate.path` | `setWidgetDictatePath` | the screen Dictate opens | `widget.dictate.path` |
| `tulmi.widget.now` | `setWidgetNow` | GET /v1/widgets/now as it was: both quick-access widgets' rows (worded, each with its link and buttons), the look, the counts, the Lock Screen's line, the empty states | `widgets.now.*` (app); everything else is the server's `widgets.*` (below) |
| `tulmi.widget.now.writtenAt` | `setWidgetNow` | when the app wrote it (ms): a button's outcome newer than this is drawn over its row | — |
| `tulmi.widget.now.state` | `AnswerNeedIntent` | what a button did to a row: `{ "<item>": { "s": "done" \| "gone" \| "failed", "at" } }` | — |
| `tulmi.widget.token.meta` | `setWidgetToken` | where a button posts (`baseUrl`, `path`) and when the token runs out (`expiresAt`). **Not the token** | `widgets.token.path` (app); `widgets.token.*` (server) |
| Keychain `tulmi.widget.token` | `setWidgetToken` | the widgets' own narrow token (group `<Team>.com.tulmi.app.shared`, service `space.tailzu.tulmi.bearer`, this device only). Never the session's | — |

`WidgetLook` (`TailzuWidgets.swift`) reads the month's JSON leniently: a
missing or mistyped field falls back without stopping the numbers. The
colours are not read from anywhere: `X0Palette` (above).

## Quick access: what the server decides

GET /v1/widgets/now (backend `src/widgets`, docs/widgets.md) answers the whole
document; the app checks it (`src/widgets/nowCore.ts`: its version, every link
one this app opens, every button one the widgets know) and writes it as it is.
A new kind of row, a new button, a new colour or word is the server's data:

| In the document | What it decides | Server knob (control surface `widgets`) |
| --- | --- | --- |
| `people.on`, `needs.on` | each widget on or off (off: the empty state) | `widgets.enabled`, `widgets.people.enabled`, `widgets.needs.enabled` |
| `*.rows[]` | the rows, their order and kinds: `id` (what a button answers), `kind`, `who`, `initial`, `text`, `line`, `tag`, `detail`, `at`, `when`, `url`, `private`, `new`, `icon`, `androidIcon`, `color`, `bot` (whose bot: its ring's colour), `actions[]` | `widgets.*.kinds`, `.sort`, `.max`, `widgets.people.windowDays` / `newHours` / `messageText` / `includeMuted` / `chats`, `widgets.*.private` (the kinds whose words a locked phone redacts), `widgets.links`, `widgets.link.base`, labels `widgets.people.line.*` / `.tag.*`, `widgets.who.*` |
| `*.limits` | rows per size: `small`, `medium`, `large`, `lock`, `android` | `widgets.people.limits`, `widgets.needs.limits` |
| `actions[]` | a row's buttons: `id`, `label`, `style` (primary; secondary / destructive are drawn as the secondary), `mode` (`inPlace`: answered here; `open`: a link with `url`), `icon`, `androidIcon` | `widgets.needs.actions` (per kind), `widgets.needs.modes` (per kind), `widgets.needs.optionsMax`, `widgets.needs.inPlaceRisks`, `widgets.token.enabled`, labels `widgets.action.*` |
| `*.title`, `*.icon`, `*.url`, `*.lock.line`, `*.empty` | the header, its symbol and link, the Lock Screen's count line, the empty state's words and button | labels `widgets.*.title`, `.lock*`, `.empty.*`; `widgets.look.people` / `.needs`; `widgets.links.people` / `needs` / `peopleEmpty` / `needsEmpty` |
| `needs.words` | a pressed button's outcome: `done`, `gone`, `failed`, `working`; and `answer`, the one button a row shows when its own would not fit | labels `widgets.needs.*` |
| `look` | `kinds` (each kind's SF Symbol, drawable, colour) reach the rows as `icon` / `color`; its `colors`, `alpha`, `styles`, `light` are no longer read on iOS | `widgets.look` |
| `time` | how a time is written: `relative` (words as of each minute: "4 min ago"), `clock`, `server` (the row's `when`) | `widgets.time`, labels `widgets.time.*` |
| `refreshSec`, `fetchSec` | the timeline's own refresh; how often the app may fetch | `widgets.refreshSec`, `widgets.fetchSec` |
| `act` | where a button posts, whether answering in place is on | `widgets.act.path`, `widgets.token.enabled` |

**Answering in place.** `AnswerNeedIntent` posts `{ item, action, key }` to
`act.path` with `X-Widget-Token`, the widgets' own token from the Keychain:
it can only answer this person's own needs-you questions and tick their own
tasks (never a reply, never anything else; every other route refuses it),
runs out in a day (`widgets.token.ttlMin`), and is revoked at sign-out. The
server checks the row is still the person's and still waiting, and answers a
key once. The intent asks for the phone to be unlocked
(`authenticationPolicy`). No token, offline, refused: the row says "Open X0
to finish" and its words open it. Chosen over `openAppWhenRun` (which
would only open the app) so a Yes or a Done takes one tap; the server can turn
any kind back to opening the app (`widgets.needs.modes`, or
`widgets.token.enabled` off for all).

**Android** has the same two widgets (`modules/tulmi-bridge/android`
`TailzuQuickWidgets.kt`: `TailzuPeopleWidget`, `TailzuNeedsWidget`, the
`TailzuWidgetActReceiver` their buttons post through) reading the same
document from the app's `tulmi.widget` SharedPreferences (keys as above; the
token under `tulmi.widget.token`, private to the app), and the app shortcuts
(`TailzuShortcuts.kt`). Drawables by the server's name: `tailzu_wi_*` (rows),
`tailzu_qa_*` (shortcuts), kept from resource shrinking by
`res/raw/tailzu_widget_keep.xml`.

## Beside the widgets: a notification's buttons and the icon's long press

Not in this extension, but the same quick access and the same rule (the
server decides, the app keeps today's values as fallbacks):

| Knob (bootstrap) | What | Where |
| --- | --- | --- |
| `push.categories` | the notification categories and their buttons: `id`, `title`, `icon` (kept for when expo-notifications can show one), `input` (`placeholder`, `send`: a text field), `foreground`, `destructive`, `auth`, and what a press does: `act` (POST /v1/widgets/act with the push's `data.item`, the app's session), `open`, or `call` (`method`, a `/v1/` `path` and `body`, `{data.<field>}` / `{text}` filled). Registered on launch when changed; one no longer listed is removed | `src/notifications/categories.ts`, `categoriesCore.ts`, `actions.ts` |
| `push.actions.enabled`, `.path`, `.keepHours`, `.maxTries`, `.backgroundTask`; labels `push.actions.failedTitle` / `failedBody` | the kill switch; where `act` posts; how long and how often an answer the phone could not send is tried again (on coming to the front, same key); Android's task for a press with the app closed; the quiet notice when the server refused one | `src/notifications/actions.ts`, `backgroundTask.ts` |
| `push.<kind>.category` (the push engine's, backend `push/defaults.ts`) | which category each push kind carries: today `space_message` → `x0_reply`, `space_task` / `space_plan` → `x0_task`, `approval` → `x0_yesno` | backend `push/engine.ts` (also adds `data.item`) |
| `app.quickActions.ios`, `app.quickActions.android`, `app.quickActions.max`, `app.quickActions.enabled` | the app icon's long-press list per platform, in order: `id`, `title`, `subtitle`, `icon` (an SF Symbol / a drawable), `url`, and on iOS `arm` (the microphone's arming screen, opened through the keyboard's App Group tombstone, as Dictate does) | `src/quickActions`, the bridge's `TulmiShortcuts.swift` / `TailzuShortcuts.kt` |
| `widgets.now.enabled`, `.path`, `.fetchSec`; `widgets.token.path` | the app's side of the widgets: whether and where it fetches the rows, how often before the server's own `fetchSec` arrives, where it asks for the widgets' token | `src/widgets/now.ts` |

## Needs a device check (quick access)

CI type-checks the Swift here and the bridge; the Android Kotlin compiles
against the Android 15 framework. Nothing below can be seen without a phone:

1. iOS: both widgets in every size, Light and Dark, and in StandBy (private
   words redacted); the Lock Screen rectangle shows only the count line.
   Nothing clipped: Needs you's medium shows one row with its buttons, large
   up to three, small the question and its answers stacked (or Answer); no
   button label ends in "…". The mark shows on its white circle in Dark Mode.
2. iOS: Needs you's Yes / No / Done answer in place (the Keychain read needs
   the new `keychain-access-groups` entitlement on the widget target, so the
   EAS profile must carry it), the unlock prompt from a locked StandBy, and
   "Open X0 to finish" with no token or offline.
3. iOS: a row's link opens exactly that thing, warm and cold.
4. iOS: notification buttons — Reply typed inline, Done, Yes (asks to
   unlock), No — with the app in front, in the background, and killed
   (expo-notifications calls the system back at once; the bridge's
   background time and the owed-answer retry cover the rest).
5. iOS: long-press the icon: the four items, their SF Symbols, each target
   warm and cold; Dictate arms the microphone through the tombstone.
6. Android: both home widgets at 4x2 and resized, each button (a pressed
   row shows Sending…, then Done / Already answered / Open X0 to
   finish), each row's link; the picker previews.
7. Android: notification buttons with the app running and swiped away (the
   headless task), and a reply typed inline.
8. Android: the app shortcuts (icons in a light and a dark launcher, each
   link), and that a release build with resource shrinking still finds the
   `tailzu_wi_*` / `tailzu_qa_*` drawables.
9. Both: sign out, and the widgets empty and their token is gone (the server
   revokes it; the Keychain / SharedPreferences copy is deleted).

Also by eye, on a phone: the Month signed in and signed out, Light and Dark,
and on the Lock Screen; the mic session's banner (Light and Dark) and island
(compact in each phase, expanded ready with its hint uncut, minimal); Setup's
banner and island; the mark found in the bundle everywhere (a missing
`Assets.xcassets` would draw nothing where the bot should be).

Type-checked in CI (`keyboard-ios.yml`, job `widgets`). Built by EAS with the
app through `@bacons/apple-targets`.
