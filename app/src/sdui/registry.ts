/**
 * What this renderer build can draw + do. Sent to the server in the capability
 * handshake so it never emits a node/action we can't handle.
 *
 * This build draws the Bots app and nothing else: its kit, its sign-in and the
 * keyboard's handoff screens. The renderer implementations live in
 * components/ (nodes, one file each; components/index.ts is the registry) and
 * actions.ts (actions).
 *
 * THE LIST IS A PROMISE, SO IT ONLY NAMES WHAT ACTUALLY WORKS. The server
 * withholds anything this bundle does not advertise and draws a fallback
 * instead. So every registered component is listed, and so is each
 * NOT-A-COMPONENT declaration below: a behaviour of this bundle the server
 * relies on before it sends something that needs it.
 */
export const CORE_COMPONENTS = [
  // The Bots kit's primitives (Button: the bootstrap's launch card).
  "Screen", "Stack", "Text", "Image", "Button", "TextField", "Grid", "SafeArea", "SVG",
  // A box that scrolls on its own inside a card (components/Scroll.tsx).
  "Scroll",
  // The keyboard handoff screens' mic and dictation (keyboard_record, keyboard_primer, flow_arm).
  "VoiceButton", "VoiceToggle",

  /**
   * NOT A COMPONENT — this build draws only the Bots app: it has no old screens left to fall back on, so the
   * server always serves it the Bots app, whatever its switch says, and opens Home for any other screen id.
   */
  "BotsOnly",
  /**
   * NOT A COMPONENT — a declaration that this bundle's Screen honours
   * `holdTouches`, i.e. that it can carry a draggable control without the
   * scroll stealing the gesture. The backend withholds any screen that needs
   * it from a bundle that does not say this, rather than shipping one whose
   * way in does nothing.
   */
  "ScreenHoldTouches",
  /**
   * NOT A COMPONENT — a declaration that this bundle's toast, snackbar and
   * copy fill in what they say: "@key" from the catalog's copy, "$state.x"
   * inside a sentence, a row's own text on the clipboard. The backend sends
   * those only to a bundle that says this.
   */
  "ActionText",
  /**
   * NOT A COMPONENT — a declaration that this bundle's openUrl and
   * openInAppBrowser fill in "$state.x" in the address, so a page the server
   * only learns after a call (a connected app's sign-in) can be opened from
   * the answer. The backend sends the Connect tap only to a bundle that says
   * this.
   */
  "ActionUrl",
  /**
   * NOT A COMPONENT — a declaration that this bundle's navigate fills in
   * "$state.x" in its params, so a screen can open what an answer named (the
   * task an ask just left waiting for approval). An older bundle would send
   * the reference itself as the param; the backend sends one only to a bundle
   * that says this.
   */
  "ActionParams",
  // The sign-in screen's pieces, drawn from the server's auth tree.
  "SwipePill", "AppleSignIn", "GoogleSignIn", "CodeEntry", "AuthPhase",
  // Entrance motion.
  "Rise",
  // MorphOut — the opening scene drawn into what it becomes, so it hands over as one object rather than two.
  "MorphOut",
  /**
   * The onboarding run, and the one character that walks through it.
   * OnboardStage holds a run of steps and glides between them; BlipSpot marks
   * where Blip stands in a step. Declaring them also promises what ships in the
   * same bundle for them: SwipePill variant "field", CodeEntry variant
   * "boxes", the labelled Google/Apple buttons, VoiceButton's `hold` and
   * `bind.state`. The server draws the new onboarding only for a bundle that
   * says both names.
   */
  "OnboardStage", "BlipSpot",
  /** Home's welcome: Blip waving, who turns and walks off the side when `goWhen` turns true (onboard/BlipWalkOut.tsx). */
  "BlipWalkOut",
  /**
   * NOT A COMPONENT — the Bots app's kit (types.ts BOTS_KIT_CAPABILITY):
   * SVG `shapes` with breathe / pop / draw (SvgShapes.tsx, still under Reduce
   * Motion), SafeArea `edges` / `inset` / `barStyle`, TextField `on.onSubmit`.
   * The server boots the Bots app only for a bundle that says this.
   */
  "BotsKit",
  /**
   * NOT A COMPONENT — the living bot tiles (types.ts BOTS_MOTION_CAPABILITY): BotTiles, Home's grid with a
   * tiny Blip playing in each tile on a faint fabric, and BotCard, a card with one on top (the first-arrival
   * permission card, Keybot's). One physics core, src/botTiles/core.ts (the window's botTiles.js is generated
   * from it). The server sends them only to a bundle that says this; others get static tiles and plain cards.
   */
  "BotsMotion", "BotTiles", "BotCard",
  /** A full-width strip under BotTiles' grid (Notes), its bot at the left, in the same world as the tiles (BotTiles.tsx). */
  "BotTilesStrip",
  /** A bot's own tiny bot on its pages (BotBuddy.tsx; types.ts BotBuddyProps), on the same core. */
  "BotBuddy",
  /**
   * NOT A COMPONENT — BotBuddy's act "carry" and `doneWhen` (BotBuddy.tsx): a lane under a message on its way, where
   * he hauls it as a bag, heavier each trip, and sets it down when the answer is here. Others get "Asking…".
   */
  "BotBuddyCarry",
  /**
   * NOT A COMPONENT — the bots' looks and moments (types.ts BOT_MOMENTS_CAPABILITY): avatars and moments from the
   * server's catalog (botTiles/looks.ts keeps it, core.ts plays it), on BotTiles, BotBuddy and BotCard (`avatar`,
   * `moment`, `momentMode`, `momentEndWhen`, BotTiles `surprises`). Builds without it get a moment's plain act.
   */
  "BotMoments",
  /**
   * NOT A COMPONENT — looks format 2, scenes (types.ts BOT_MOMENTS2_CAPABILITY): the animation language in
   * botTiles/scene.ts, drawn by the same core. It is backed only by JS in this very bundle, so a constant here is
   * the honest answer; the binary-feature rule (device/binaryCore.ts) is for names that need native code.
   */
  "BotMoments2",
  /**
   * NOT A COMPONENT — callEndpoint's `stream` (askStream.ts): an answer's words and what the bot is doing, written into state
   * as they come over the live socket (topic ask:<id>), and the id the server's stop names.
   */
  "AskStream",
  /** Home's header, alive (HomeHead.tsx): the line that writes itself, the living mark, the compact bar on scroll. */
  "WriteOn", "LiveMark", "HeadBar",
  /**
   * NOT COMPONENTS — the media actions (media.ts; types.ts FILE_UPLOAD_CAPABILITY …): uploadFile (a photo, a
   * screenshot, a video or any file, sent with progress), playAudio / stopAudio (one sound at a time, stopped when the
   * screen goes), recordVoice (the microphone into a field, through /v1/transcribe-clean). The server draws Ask's
   * attach and mic, Add to chat's pickers and the voices' play buttons only for a bundle that says these.
   */
  "FileUpload", "AudioPlay", "VoiceRecord",
  /**
   * A running web page or artifact in a sandbox of its own (LiveView.tsx), and — NOT A COMPONENT — the outbox
   * (offline.tsx): asks kept while offline and sent once, in order; `online`, `outbox`, `outboxWaiting` in every
   * screen's state; the Offline page in place of Home while offline, and the line over the others. types.ts 3e.
   */
  "LiveView", "Outbox",
  /**
   * NOT A COMPONENT — pull to refresh with a bot in it (types.ts PULL_BOT_CAPABILITY): a screen's `pullBot` turns it on
   * for the top, the bottom or both of its Screen (PullBot.tsx, pullBotCore.ts). The server sends it only to a bundle
   * that says this.
   */
  "PullBot",
  /**
   * NOT A COMPONENT — the bots' sounds (types.ts BOT_SOUNDS_CAPABILITY; sounds.ts): the pack the bootstrap's "bots.sounds"
   * names, played by pull-a-bot and the bots' moments; the phone's `soundsOn` in a screen that names it, and the action devicePref
   * "sounds" for the switch. The server shows the Sounds switch only to a bundle that says this.
   */
  "BotSounds",
  /**
   * Spaces, the family redesign (types.ts section 3i). BotStage: a full tiny bot on a stage of his own who roams with the
   * catalog's moments, walks out and back in, listens, and holds a thought (a box over him, joined to his head by three
   * bubbles, that follows him at rest and opens when tapped; bots/BotStage.tsx). BotCrowd: a box of tiny bots playing, that
   * grows taller and cheers (bots/BotCrowd.tsx). Vanish: its children vaporise and come back (components/Vanish.tsx).
   * MentionField: a message field where "@" picks a person and "/" a bot's thing (components/MentionField.tsx). LiveWords:
   * the words of the voice session as they are heard (components/LiveWords.tsx). The server sends the new Spaces, Home's
   * Ask and the space feed only to a build that says all of them; older builds keep today's screens.
   */
  "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords",
  /**
   * NOT A COMPONENT — the voiceLive and voiceStop actions (voice/voiceLive.ts): live words over /v1/transcribe-stream, a turn
   * ending on a pause. Only when this binary has the stream module: client/capabilities.ts takes the name out otherwise, and
   * the server then sends no voice piece at all.
   */
  "VoiceLive",
  /** NOT A COMPONENT — BotStage's on.onDoubleTap and a Home tile's doubleTap (BotTiles.tsx): a single tap then waits 260 ms. */
  "DoubleTap",
  /**
   * NOT A COMPONENT — the kit's extras for the new screens: TextField keyboard / autoFocus / maxLength (TextField.tsx);
   * Screen and Scroll startAtEnd; a dotted border with a radius drawn dotted on Android too (Stack.tsx); callEndpoint.stay
   * (a phone never fetches the screen again after a write, so it has nothing to skip); a failed call's { code, message } at
   * `lastError` (actions.ts, as before).
   */
  "KitExtras",
  /**
   * People as their own tiny bots (types.ts section 3j). PersonBot: a person's full tiny bot standing in a size x size box, on the
   * bots' engine with the catalog's avatar and the person's colour, idling on his own seed; every one on a screen on one loop,
   * paused off screen (bots/PersonBot.tsx, personBotCore.ts). MentionField draws one in each row of its "@" list from the row's
   * `bot`. The server shows people this way only to a build that says it; others get a plain circle in the person's colour.
   */
  "PersonBot",
  /**
   * What a bot draws under its words, as dots that obey physics (types.ts DotArtProps; bots/DotArt.tsx, dotArtCore.ts): springs
   * home, damping, gravity for a fall, an impulse where a finger lands, a push while it stays, heat for a tremble; asleep once
   * settled. The server sends a chart, a meter or a drawing this way only to a build that says it; others get the same dots, still.
   */
  "DotArt",
  /**
   * NOT A COMPONENT — the messages' face: "Tailzu Bricolage", "Tailzu Bricolage Medium" and "Tailzu Bricolage SemiBold"
   * (Bricolage Grotesque 400, 500, 600). Loaded as the Geist faces are, from the bootstrap's `fonts` (theme/remoteFonts.ts), which
   * the server fills with them for a build that says this; others get the same nodes in Geist.
   */
  "FontBricolage",
  /**
   * NOT A COMPONENT — a notification button that opens the app (Pay, Send, No, Open map) hands its id to the push's screen as the
   * `button` param (notifications/push.ts onTap). A plain tap on the notification has none, so the server's hand-off screens open
   * WhatsApp, UPI or Maps only for the button, and a tap just to look opens the Plan. Builds without it hand off on neither.
   */
  "PushButton",
  /**
   * NOT A COMPONENT — "X0 is calling" (notifications/calls.ts; the server's bots.plan.call screen). It promises the call screen's
   * pieces: speak.loud (on the speaker even with the silent switch on) and speak.onDone (run once when said, stopped or failed),
   * with "$state" filled in speak.text (sdui/voice/speech.ts); voiceLive.duplex (one audio session that plays and records, held
   * between turns: voice/voiceLive.ts); and Text format "elapsed" ("0:12" since a start time, ticking: components/Text.tsx). The
   * same name goes with the push token (callsCore.ts callCaps), where it says this JavaScript takes calls.
   */
  "BotCall",
  /**
   * NOT HERE, ON PURPOSE — `VoiceRealtime` (Plan Ease's call as a live conversation: the voiceCall and voiceCallSet actions,
   * voice/callRealtime.ts). The live client is native code (react-native-webrtc, tulmi-stream's callAudio), so the name is not
   * this bundle's to promise: it comes from the bridge's `binaryFeatures` ("realtimeCall" → device/binaryCore.ts) and is added
   * by client/capabilities.ts. The same JavaScript on an older binary says nothing, so the server keeps today's turn call for it.
   */
] as const;

export const CORE_ACTIONS = [
  // nav & flow
  "navigate", "navigateBack", "switchTab", "openUrl", "openSettings",
  "openInAppBrowser", "dismiss",
  // data
  "callEndpoint", "refresh",
  // state
  "setState", "toggleState", "incrementState", "clearState",
  "toggleInArray", "appendState",
  // feedback
  "haptic", "toast", "snackbar", "stopMedia", "speak", "confetti",
  // system / share / clipboard
  "share", "shareFile", "copyToClipboard", "readClipboard",
  "sms", "email", "phone", "download", "saveToPhotos",
  // media pickers
  "pickImage", "pickDocument", "scanQR",
  // send a picked file, play a sound, speak into a field (media.ts)
  "uploadFile", "playAudio", "stopAudio", "recordVoice",
  // keep an ask to send when online, take one out, try one again, clear the sent (offline.tsx)
  "outbox",
  // listen with live words, turn by turn; stop listening (voice/voiceLive.ts; capability VoiceLive)
  "voiceLive", "voiceStop",
  // a live voice call, and getting the mic ready for one (voice/callRealtime.ts). Running them is this bundle's promise; whether
  // the binary can hold a live call is the binary's (VoiceRealtime, above), and without it the server sends neither.
  "voiceCall", "voiceCallSet",
  // a setting kept on this phone: the Sounds switch (sounds.ts)
  "devicePref",
  // permissions
  "requestPermission", "checkPermission",
  // location, contacts, health: running them is this bundle's promise; whether the binary can is the module's (permCaps.ts:
  // Location1, ContactPick1, Health1), and without it the server sends none of them.
  "location.area", "contact.pick", "health.sync",
  // auth
  "biometricPrompt", "signOut",
  // IAP
  "iap.showPaywall", "iap.subscribe", "iap.restore", "iap.checkEntitlement",
  // notifications
  "scheduleNotification", "cancelNotification", "requestPushPermission",
  // analytics
  "analytics.track", "analytics.identify", "analytics.reset",
  // calendar
  "calendar.addEvent",
  // review
  "requestReview",
  // mic handoff — main app records + refines, keyboard inserts (see
  // targets/keyboard/TulmiHandoff.swift and modules/tulmi-bridge).
  "completeKeyboardHandoff", "cancelKeyboardHandoff", "armFlowSession", "endFlowSession",
  // cache / dev
  "clearCache", "reloadApp",
  // composition
  "sequence", "parallel", "condition", "delay", "log",
] as const;

/**
 * Named layouts the app can compose from `template` + `blocks`: none. Every
 * screen the Bots app sends is a full `root` tree.
 */
export const CORE_TEMPLATES = [] as const;
