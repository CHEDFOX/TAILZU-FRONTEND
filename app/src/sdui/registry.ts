/**
 * What this renderer build can draw + do. Sent to the server in the capability
 * handshake so it never emits a node/action we can't handle.
 *
 * This build draws the Bots app and nothing else: its kit, its sign-in and the
 * keyboard's handoff screens. The renderer implementations live in
 * components.tsx / componentsV3.tsx (nodes) and actions.ts (actions).
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
  // a setting kept on this phone: the Sounds switch (sounds.ts)
  "devicePref",
  // permissions
  "requestPermission", "checkPermission",
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
