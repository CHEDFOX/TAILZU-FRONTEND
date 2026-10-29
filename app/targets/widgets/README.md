# The widgets

One WidgetKit extension. Everything it shows comes from the App Group the app
writes; nothing here fetches anything, and no dictated text is ever drawn — a
widget sits on a Lock Screen. The one thing it ever sends is a Needs you
button's answer (below), with the widgets' own narrow token.

- **The Month** (`MonthWidget.swift`) — Home Screen small, and the three Lock
  Screen families. Words left and the month's line for the free plan; words
  this month and a slow line for a subscriber; the streak. The app writes the
  numbers with `setWidgetMonth` every time a bootstrap lands
  (`src/widgets/month.ts`), and the widget is redrawn then.
- **The Flow session** (`FlowActivity.swift`) — a Live Activity while the
  background microphone is armed: ready, listening with the words so far,
  writing. Stop and End buttons post the Darwin notifications the session
  already listens for. The app side is `modules/tulmi-bridge/ios/FlowLiveActivity.swift`,
  driven by `FlowSessionManager`; the attributes struct is declared in both
  and must stay identical.
- **Dictate** (`DictateControl.swift`) — an iOS 18 Control for Control Center,
  the Lock Screen and the Action Button. It opens the app on its arming
  screen, which arms the microphone and says "swipe back": the same path the
  keyboard's mic key takes, one tap earlier.
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

## What the server decides

The widgets cannot read the server, so the app writes the server's values
into the App Group next to the numbers, and every Swift read keeps the literal
it replaced as its fallback (for a phone whose app has not written them yet):

| App Group key | Written by | Carries | App knobs |
| --- | --- | --- | --- |
| `tulmi.widget.month` | `setWidgetMonth` | the numbers, plus `headline`, `fraction`, `labels`, `colors`, `alpha`, `url`, `refreshSec`, `span` | `widget.month.*` (labels and flags), `widget.color.*`, `widget.alpha.*` |
| `tulmi.widget.flow.copy` | `setFlowActivityCopy` | the Live Activity's words and SF Symbols | `widget.flow.*` |
| `tulmi.widget.dictate.path` | `setWidgetDictatePath` | the screen Dictate opens | `widget.dictate.path` |
| `tulmi.widget.now` | `setWidgetNow` | GET /v1/widgets/now as it was: both quick-access widgets' rows (worded, each with its link and buttons), the look, the counts, the Lock Screen's line, the empty states | `widgets.now.*` (app); everything else is the server's `widgets.*` (below) |
| `tulmi.widget.now.writtenAt` | `setWidgetNow` | when the app wrote it (ms): a button's outcome newer than this is drawn over its row | — |
| `tulmi.widget.now.state` | `AnswerNeedIntent` | what a button did to a row: `{ "<item>": { "s": "done" \| "gone" \| "failed", "at" } }` | — |
| `tulmi.widget.token.meta` | `setWidgetToken` | where a button posts (`baseUrl`, `path`) and when the token runs out (`expiresAt`). **Not the token** | `widgets.token.path` (app); `widgets.token.*` (server) |
| Keychain `tulmi.widget.token` | `setWidgetToken` | the widgets' own narrow token (group `<Team>.com.tulmi.app.shared`, service `space.tailzu.tulmi.bearer`, this device only). Never the session's | — |

`WidgetLook` (`TailzuWidgets.swift`) reads the month's JSON leniently: a
missing or mistyped field falls back without stopping the numbers. `Ink` is
the palette read through it. The quick-access widgets read the server's
`look` first (`QuickInk`), then `Ink`, then the literal; in Light Mode a
`look.light` palette wins when the server sends one, else the card stays the
dark ink the Month draws in both.

## Quick access: what the server decides

GET /v1/widgets/now (backend `src/widgets`, docs/widgets.md) answers the whole
document; the app checks it (`src/widgets/nowCore.ts`: its version, every link
one this app opens, every button one the widgets know) and writes it as it is.
A new kind of row, a new button, a new colour or word is the server's data:

| In the document | What it decides | Server knob (control surface `widgets`) |
| --- | --- | --- |
| `people.on`, `needs.on` | each widget on or off (off: the empty state) | `widgets.enabled`, `widgets.people.enabled`, `widgets.needs.enabled` |
| `*.rows[]` | the rows, their order and kinds: `id` (what a button answers), `kind`, `who`, `initial`, `text`, `line`, `tag`, `detail`, `at`, `when`, `url`, `private`, `new`, `icon`, `androidIcon`, `color`, `actions[]` | `widgets.*.kinds`, `.sort`, `.max`, `widgets.people.windowDays` / `newHours` / `messageText` / `includeMuted` / `chats`, `widgets.*.private` (the kinds whose words a locked phone redacts), `widgets.links`, `widgets.link.base`, labels `widgets.people.line.*` / `.tag.*`, `widgets.who.*` |
| `*.limits` | rows per size: `small`, `medium`, `large`, `lock`, `android` | `widgets.people.limits`, `widgets.needs.limits` |
| `actions[]` | a row's buttons: `id`, `label`, `style` (primary / secondary / destructive), `mode` (`inPlace`: answered here; `open`: a link with `url`), `icon`, `androidIcon` | `widgets.needs.actions` (per kind), `widgets.needs.modes` (per kind), `widgets.needs.optionsMax`, `widgets.needs.inPlaceRisks`, `widgets.token.enabled`, labels `widgets.action.*` |
| `*.title`, `*.icon`, `*.url`, `*.lock.line`, `*.empty` | the header, its symbol and link, the Lock Screen's count line, the empty state's words and button | labels `widgets.*.title`, `.lock*`, `.empty.*`; `widgets.look.people` / `.needs`; `widgets.links.people` / `needs` / `peopleEmpty` / `needsEmpty` |
| `needs.words` | a pressed button's outcome: `done`, `gone`, `failed`, `working` | labels `widgets.needs.*` |
| `look` | `colors` (ground, pale, mark, accent), `alpha` (dim, rule), `styles`, `kinds` (each kind's SF Symbol, drawable, colour), `light` | `widgets.look` |
| `time` | how a time is written: `relative` (the widget counts), `clock`, `server` (the row's `when`) | `widgets.time`, labels `widgets.time.*` |
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
Bot to finish" and its words open it. Chosen over `openAppWhenRun` (which
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
2. iOS: Needs you's Yes / No / Done answer in place (the Keychain read needs
   the new `keychain-access-groups` entitlement on the widget target, so the
   EAS profile must carry it), the unlock prompt from a locked StandBy, and
   "Open X0 Bot to finish" with no token or offline.
3. iOS: a row's link opens exactly that thing, warm and cold.
4. iOS: notification buttons — Reply typed inline, Done, Yes (asks to
   unlock), No — with the app in front, in the background, and killed
   (expo-notifications calls the system back at once; the bridge's
   background time and the owed-answer retry cover the rest).
5. iOS: long-press the icon: the four items, their SF Symbols, each target
   warm and cold; Dictate arms the microphone through the tombstone.
6. Android: both home widgets at 4x2 and resized, each button (a pressed
   row shows Sending…, then Done / Already answered / Open X0 Bot to
   finish), each row's link; the picker previews.
7. Android: notification buttons with the app running and swiped away (the
   headless task), and a reply typed inline.
8. Android: the app shortcuts (icons in a light and a dark launcher, each
   link), and that a release build with resource shrinking still finds the
   `tailzu_wi_*` / `tailzu_qa_*` drawables.
9. Both: sign out, and the widgets empty and their token is gone (the server
   revokes it; the Keychain / SharedPreferences copy is deleted).

Type-checked in CI (`keyboard-ios.yml`, job `widgets`). Built by EAS with the
app through `@bacons/apple-targets`.
