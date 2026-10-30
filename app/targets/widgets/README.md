# The widgets

One WidgetKit extension, named **X0** everywhere a person sees it. Everything
it shows comes from the App Group the app writes; nothing here fetches
anything, and no dictated text is ever drawn — a widget sits on a Lock
Screen. The one thing it ever sends is an answer to a bot's question (below),
with the widgets' own narrow token.

- **X0** (`X0Widget.swift`, kind `space.tailzu.x0`, display name "X0") — the
  universal widget: Home Screen small / medium / large, StandBy, and the Lock
  Screen's inline, rectangle and circle. It reads glance v2 (the backend's
  `docs/widget-glance-v2.md`) and leads with what matters most right now:
  something needs you (the bot's face, its question, its answers answered in
  place), bots working (the job's face, task and stage bar, who else is busy),
  just done (what it finished, its PR), or all quiet (the greeting and the
  day's line, the week's beads, the crew, Ask with the keyboard's peek-bot
  key). Below: **X0, the universal widget**.
- **Bots at work** (`BotsActivity.swift`; attributes and the answer intent in
  `_shared/BotsAtWork.swift`) — a Live Activity while a bot's job runs: the
  face, the task, the stage bar with its names and the minutes in; the
  question with its answers when the job waits on the person; "Done — tap to
  see the PR" when it has finished. Below: **Bots at work**.
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
The Month and Needs you were retired (glance v2 §7): X0 shows both what the
bots are doing and what needs the person. From your people keeps
`QuickAccess.swift` (the lenient model of `/v1/widgets/now`, its timeline,
the parts it draws); the answer itself (the post, the token, what a press
did) is `_shared/WidgetAct.swift`, built into the app too.

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
  outline-grey (`#D4D4D4` / `#3D3D3D`) border with ink words; "You decide" is
  quiet (its words in the meta grey). A pill keeps its words' width; where
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
- **What fits is drawn whole.** A pill keeps its words; a row of answers shows
  as many as fit whole (`ViewThatFits`), and "You decide" after them when it
  fits. From your people shows at most the server's number of rows (`limits`),
  then only as many as fit, whole: the server's whole line ("Riya shared
  Weekend plan") with the tag, the space and when under it.

## What the server decides

The widgets cannot read the server, so the app writes the server's values
into the App Group next to the numbers, and every Swift read keeps the literal
it replaced as its fallback (for a phone whose app has not written them yet):

| App Group key | Written by | Carries | App knobs |
| --- | --- | --- | --- |
| `x0.glance` | `setWidgetGlance` | GET /v1/shell/glance?v=2 as the app checked it (`src/widgets/glanceCore.ts`): the X0 widget's whole document, and the Bots at work activity's words | the server's glance (below) |
| `x0.glance.writtenAt` | `setWidgetGlance` | when the app wrote it (ms): an answer pressed after the older of this and the glance's `at` is drawn over its question | — |
| container `faces/<face>.png` | the app (`src/widgets/glance.ts`) | each bot's head, downloaded from its `faceUrl` (the widget never fetches) | — |
| `tulmi.widget.month` | `setWidgetMonth` | the month's numbers: no longer read on iOS (The Month was retired) | `widget.month.*` |
| `tulmi.widget.theme` | `setWidgetTheme` | the server's colours and alphas: no longer read on iOS | `widget.color.*`, `widget.alpha.*` |
| `tulmi.widget.flow.copy` | `setFlowActivityCopy` | the Live Activity's words and SF Symbols: `ready`, `readyHint`, `listening`, `writing`, `words`, `stop`, `end`, `compact` (the ready word in the island), and when sent `compactWriting`, `compactListening`, `iconWriting`; `showWords`, `showEnd` (its `accent*` colours are no longer read) | `widget.flow.*` |
| `tulmi.widget.dictate` | `setWidgetDictate` | the Dictate control's `label` and `symbol` (and the arming `path`, mirrored below) | `widget.dictate.*` |
| `tulmi.widget.dictate.path` | `setWidgetDictatePath` | the screen Dictate opens | `widget.dictate.path` |
| `tulmi.widget.now` | `setWidgetNow` | GET /v1/widgets/now as it was: both quick-access widgets' rows (worded, each with its link and buttons), the look, the counts, the Lock Screen's line, the empty states | `widgets.now.*` (app); everything else is the server's `widgets.*` (below) |
| `tulmi.widget.now.writtenAt` | `setWidgetNow` | when the app wrote it (ms): a button's outcome newer than this is drawn over its row | — |
| `tulmi.widget.now.state` | `AnswerNeedIntent`, `AnswerBotsActivityIntent` | what an answer did to an item: `{ "<item>": { "s": "done" \| "gone" \| "failed", "at" } }` | — |
| `tulmi.widget.token.meta` | `setWidgetToken` | where a button posts (`baseUrl`, `path`) and when the token runs out (`expiresAt`). **Not the token** | `widgets.token.path` (app); `widgets.token.*` (server) |
| Keychain `tulmi.widget.token` | `setWidgetToken` | the widgets' own narrow token (group `<Team>.com.tulmi.app.shared`, service `space.tailzu.tulmi.bearer`, this device only). Never the session's | — |

Every read is lenient: a missing or mistyped field falls back to its literal
without stopping the rest. The colours are not read from anywhere: `X0Palette`
(above).

## X0, the universal widget

`X0Glance.swift` reads `x0.glance` (version 2 only) and picks the case: the
server's `case` when the glance backs it, else needs → done → working →
quiet. `X0Widget.swift` draws the Home Screen sizes, `X0Lock.swift` the Lock
Screen, `X0Parts.swift` the parts (from the approved design's kit):

| Case | small (158 × 158, 14 pt margins) | medium (338 × 158, 16 pt) | large (338 × 354, 16 pt) |
| --- | --- | --- | --- |
| needs (`needs.items[0]`) | face, name, "needs you", the question (3 lines), both answers in one capsule | big face (and what the bot is still at), NEEDS YOU · BOT, the question, the answers | greeting + week beads; the question card with its answers and You decide; the crew of four; Ask |
| working (`job`, or a bot at work) | face, 3/5, the task, "Code bot · Build", the bar, "+1 working" | face, task, "Code bot · Build, step 3 of 5", minutes, the bar with names, the other bot at work | the job card (bar with names, "Step 3 of 5 · 52 min in"), the crew, Ask |
| done (`lastDone`) | face with a check, what it finished, whose and when, See the PR | the same, wider | the done card (See the PR), the crew, Ask |
| quiet | the painted bot hanging off the top, the peek-bot key, greeting and day line | greeting, day line, Ask any bot… with the peek-bot key, the bot hanging on | the big day line, week beads, the crew, Ask |

- **Faces**: `faces/<face>.png` in the App Group container (the app downloads
  each `faceUrl` there), else the built-in bots' bundled heads
  (`Assets.xcassets/Face-<face>`, for the gallery and a first run), else a
  disc in the bot's colour with its initial. A bot's colour is the glance's
  `color`, else `BotInk` by its slug; lifted 28% on dark grounds.
- **Answers in place**: a pill runs `AnswerNeedIntent` (`QuickAccess.swift`):
  "Done" at once, then POST `/v1/widgets/act { item: <needs item id>, action:
  <choice id>, key }` with the widgets' token (`_shared/WidgetAct.swift`);
  "Already answered" / "Open X0 to finish" when it was not taken. An item the
  server marks not `answerable` opens its `decideLink` instead. "You decide"
  opens `decideLink`. A small widget has no links of its own: there the whole
  widget opens the question.
- **Taps elsewhere**: the question (`decideLink`, else `link`), the job's
  `link`, the finished job's `link`; all quiet: `links.home` (the small widget
  and the circle: `links.ask`). The Ask bar opens `links.ask`, its peek-bot
  key `links.mic`. Only app links are followed (`appLink`).
- **Lock Screen**: only `lock.inline` / `lock.title` / `lock.line` (the
  server's lock-safe words) — never a question's text — beside a face, the bar
  or the 5-segment ring, the week's beads, the peek-bot key (Ask). On the Home
  Screen a `private` question is `.privacySensitive()` (redacted in StandBy and
  on an Always-On display).
- **Times** are whole minutes ("52 min", "4 min ago" via `When.words`): one
  timeline entry a minute while a job or a finished one shows, until the
  glance's `refreshAfterSec` (60 s – 6 h); never a ticking clock. A glance not
  written for two hours stops counting a job's minutes.
- **Words** are the glance's `words` (`needsYou`, `ready`, `ask`, `brand`,
  `youDecide`, `working` "{n} working", `step` "Step {stage} of {of}", `minIn`
  "{n} min in", `seePr`, `done`), each with its literal. Read too when sent:
  `answered` ("Already answered"), `finish` ("Open X0 to finish"),
  `doneSeePr` ("Done — tap to see the PR").
- **Art**: `X0Hang` (the painted bot on his clay bar, the server's
  x0-hang.png cropped; a hairline rim on dark grounds and in StandBy) and
  `X0Peek` (glyphs.ts `peekKey`, rendered as drawn).

## Bots at work

`BotsAtWorkAttributes { jobId }` with the ContentState of glance v2 §6 —
`bot, botName, face, task, stage, of, stageName, stages[], startedAt (ms),
phase ("working" | "needs" | "done"), question?, choices[]? ({ id, label,
primary? }), result?, pr? ({ number, url }), link` — and beside it `itemId?`,
`itemKind?`, `decideLink?` (the question's item, so it can be answered here,
and where You decide goes) and `minutes?` (how long a finished job took).
Read leniently: a missing or mistyped key takes its default, so a push with
one bad field still lands. Declared in `_shared/BotsAtWork.swift` (the widget
and the app) and once more in the bridge (`BotsLiveActivity.swift`); the
copies must stay identical.

- Lock Screen banner (light, or dark in Dark Mode): working — face, task,
  "Code bot · Build, step 3 of 5", minutes, the bar with names; needs —
  NEEDS YOU · BOT, the question, its answers and You decide; done — "Done —
  tap to see the PR", "task · PR #131 · 58 min", every stage filled, a check.
- Dynamic Island (always black): compact — the face and five tiny segments
  (● 1 when it needs the person, ✓ Done when finished); minimal — the face;
  expanded — face, 3/5 (NEEDS YOU, or a check), the task and its step and
  minutes, the bar (the question and its answers, You decide; See the PR).
- Answers: `AnswerBotsActivityIntent`, a LiveActivityIntent (so it runs in
  the app's process, which iOS wakes for it): the activity goes back to work
  at once, the answer posts with the widgets' token, the X0 widget shows it
  answered; if it could not be sent the question comes back. Asks for the
  phone to be unlocked. Without `itemId` the answers are drawn and a tap opens
  the question. A private question arrives without its words: the activity
  says only that the bot needs the person.
- A tap: the question while it waits (`decideLink`), else the job (`link`,
  whose page has the PR).
- The app starts, updates and ends it through the bridge (`startBotsActivity`,
  `updateBotsActivity`, `endBotsActivity`: `{ jobId, state, dismissAfterSec? }`)
  and it is requested with a push token (`botsActivityPushToken`, event
  `onBotsActivityPushToken`) so the server can push the same ContentState. It
  is started only on iOS 17 and later, where this extension draws it.

## Quick access: what the server decides

GET /v1/widgets/now (backend `src/widgets`, docs/widgets.md) answers the whole
document (on iOS only From your people reads it now; its `needs` section was
the retired Needs you widget's, and Android's); the app checks it (`src/widgets/nowCore.ts`: its version, every link
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

**Answering in place.** `AnswerNeedIntent` (the X0 widget) and
`AnswerBotsActivityIntent` (Bots at work) post `{ item, action, key }` to
`act.path` with `X-Widget-Token`, the widgets' own token from the Keychain
(`_shared/WidgetAct.swift`): it can only answer this person's own needs-you
questions and tick their own tasks (never a reply, never anything else; every
other route refuses it), runs out in a day (`widgets.token.ttlMin`), and is
revoked at sign-out. The server checks the item is still the person's and
still waiting, and answers a key once. The intents ask for the phone to be
unlocked (`authenticationPolicy`). No token, offline, refused: "Open X0 to
finish", and a tap opens it. Chosen over `openAppWhenRun` (which would only
open the app) so an answer takes one tap; the server can turn answering in
place off (`answerable` false, or `widgets.token.enabled` off).

**Android** (`modules/tulmi-bridge/android`) has its own X0 widget
(`TailzuX0Widget`, the same glance under `x0.glance`) and From your people
(`TailzuQuickWidgets.kt`, with the `TailzuWidgetActReceiver` buttons post
through) reading the same document from the app's `tulmi.widget` SharedPreferences (keys as above; the
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

## Needs a device check

CI type-checks the Swift here and the bridge; the Android Kotlin compiles
against the Android 15 framework. Nothing below can be seen without a phone:

1. X0, every size, Light and Dark, in each case (needs, working, done, quiet)
   against the approved sheet: the painted bot hangs off the top edge
   (contentMarginsDisabled) and has its rim in Dark; faces drawn from
   `faces/` (and the disc with the initial for a bot without art); the bar's
   current stage striped; nothing clipped, no answer label cut.
2. X0 in StandBy (iPhone on its side, charging): the small widget on black,
   the face and the bar legible; a private question redacted.
3. X0 answers in place: Per item / At the end show Done at once, then stay
   Done (or Already answered / Open X0 to finish with no token or offline);
   the unlock prompt from a locked StandBy; You decide and every tap open the
   right screen, warm and cold.
4. X0 on the Lock Screen: inline, rectangle and circle in each case; only the
   lock words, never a question's text (try a private one).
5. Bots at work: starts with a job (app in front), moves stage by stage,
   turns into the question and back after an answer from the Lock Screen and
   from the expanded island (asks to unlock; the activity moves on at once),
   ends with "Done — tap to see the PR" for up to 15 minutes; compact,
   minimal and expanded in each phase; a push token reaches the app
   (`onBotsActivityPushToken`) and an APNs push (topic
   `com.tulmi.app.push-type.liveactivity`) updates it.
6. From your people in every size, Light and Dark, and in StandBy (private
   words redacted); the Lock Screen rectangle shows only the count line.
7. Notification buttons — Reply typed inline, Done, Yes (asks to unlock),
   No — with the app in front, in the background, and killed.
8. Long-press the icon: the items, their SF Symbols, each target warm and
   cold; Dictate arms the microphone through the tombstone.
9. Android: the X0 widget and From your people at their sizes, each button
   and link; notification buttons; the app shortcuts.
10. Both: sign out, and the widgets empty, any Bots at work activity ends, and
    the widgets' token is gone.

Also by eye, on a phone: the mic session's banner (Light and Dark) and island
(compact in each phase, expanded ready with its hint uncut, minimal); Setup's
banner and island; the mark, the hanging bot and the peek-bot key found in
the bundle everywhere (a missing `Assets.xcassets` would draw nothing).

Type-checked in CI (`keyboard-ios.yml`, job `widgets`). Built by EAS with the
app through `@bacons/apple-targets`.
