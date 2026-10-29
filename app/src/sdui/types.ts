/**
 * SDUI types — the client mirror of the backend's server-driven UI contract.
 *
 * SOURCE OF TRUTH: TAILZU-BACKEND/shared/types/sdui.ts. Keep this file in sync
 * with that one by hand. Same rules for TAILZU-BACKEND/shared/types/api.ts →
 * ../api.ts (in src/api.ts).
 *
 * The `props`/`style` bags stay `Record<string, any>` here because the RN
 * renderer reads them polymorphically — a stricter shape would fight the
 * component registry.
 */

/**
 * One role in the backend's type scale — everything needed to set a run of
 * text. `family` is a slot ("display" / "body") filled by `font.display` /
 * `font.family`; `color` is a key in `ThemeTokens.color`. See typeRole().
 */
export interface TypeRole {
  size: number;
  weight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  family?: "display" | "body" | string;
  italic?: boolean;
  transform?: "uppercase" | "lowercase" | "capitalize" | "none";
  align?: "left" | "center" | "right";
  color?: string;
  marginTop?: number;
  marginBottom?: number;
  marginVertical?: number;
}

export interface ThemeTokens {
  color: Record<string, string>;
  space: Record<string, number>;
  radius: Record<string, number>;
  font: {
    /** Running face for the whole app. Unset = the system font. */
    family?: string;
    /** Heading face. Unset = `family`, else the platform serif. */
    display?: string;
    sizes: Record<string, number>;
    weights: Record<string, string>;
    /** The type scale, by role. Missing roles use the renderer's built-in copy. */
    roles?: Record<string, TypeRole>;
  };
}

/**
 * One tab icon, as paths on a 32-unit grid, sent by the backend. Two states,
 * one geometry: a layer is stroked at `stroke` idle and `activeStroke` open,
 * or filled when `fill` / `activeFill`. `punch` is a hole — drawn in the bar's
 * surface colour when active so a solid shape keeps its cut-out. A layer may
 * also carry its own `color` / `activeColor`; without one it takes the bar's.
 */
export interface TabGlyph {
  viewBox?: string;
  layers: Array<{
    d: string;
    stroke?: number;
    activeStroke?: number;
    fill?: boolean;
    activeFill?: boolean;
    punch?: boolean;
    opacity?: number;
    /** This layer's own colour instead of the bar's. Absent, the bar's. */
    color?: string;
    /** The same for the selected state; falls back to `color`, then the bar. */
    activeColor?: string;
  }>;
}

export type NavigationShell =
  | {
      kind: "tabs";
      tabs: Array<{
        id: string;
        title: string;
        icon?: string;
        screenId: string;
        /** The icon, as paths. Absent → the set this build shipped with. */
        glyph?: TabGlyph;
      }>;
      /** Draw the thread across the bar behind the icons. Absent means yes. */
      rail?: boolean;
      /** Which tab to open on. Absent means the first, which is what this did
       *  before the field existed. Decided server-side because it depends on
       *  whether this person has ever reached the tabs before. */
      initialTabId?: string;
      /**
       * The tabs as a centred cluster of squares, each on its own ground,
       * rather than a row spread across the width. Absent → the row, which is
       * what every build drew before this existed.
       */
      dock?: {
        /** The square each icon sits on. */
        size: number;
        /** Its corner. Half the size would make discs; less keeps squares. */
        radius: number;
        /** Between one square and the next. */
        gap: number;
        /** The ground under an icon you are not on. */
        background: string;
        /** And under the one you are. Absent → the same. */
        activeBackground?: string;
        /** Extra lift above the device's safe inset. */
        lift?: number;
      };
    }
  | { kind: "stack"; rootScreenId: string };

/**
 * A card the app puts up when it opens: something to say, and a way to act on
 * it. `root` is an ordinary node tree, so there is no fixed card shape — its
 * buttons carry ordinary actions, and `navigate` is what sends someone to the
 * screen the card is about. Inside a card, `navigate` and `dismiss` both close
 * it first. Shown once per `id`; change the id to say something new.
 */
export interface LaunchCard {
  id: string;
  root: Node;
  repeat?: "once" | "everyLaunch";
  dismissOnBackdrop?: boolean;
  backdrop?: string;
  sheet?: Record<string, unknown>;
}

export interface UpdateGate {
  minVersion?: string;
  latestVersion?: string;
  title?: string;
  message?: string;
  cta?: string;
  url?: { ios?: string; android?: string; default?: string };
}

export interface LanguageOption {
  code: string;
  name: string;
  greeting: string;
  regions?: string[];
}

export interface MediaEntry {
  url: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  key?: string;
}

export type MediaSpec =
  | string
  | { key: string }
  | { url: string; contentType?: string }
  | { asset: string }
  | { emoji: string }
  | { data: string; contentType?: string };

/** Bumped only on breaking changes to the SDUI contract. Mirrors backend. */
export const SDUI_SCHEMA_VERSION = 1;

/** What this renderer build can draw + do — sent in the capability handshake. */
export interface ClientCapabilities {
  /** SDUI_SCHEMA_VERSION the renderer was built against. */
  schemaVersion: number;
  /** Native app/renderer version, e.g. "1.4.0". */
  appVersion: string;
  platform: "ios" | "android";
  /** Component `type`s this build can render (the registry keys). */
  components: readonly string[];
  /** Action `kind`s this build can execute. */
  actions: readonly string[];
  /** Device hints the server may use for layout/theming decisions. */
  device?: {
    width: number;
    height: number;
    scale: number;
    colorScheme: "light" | "dark";
    locale: string;
    reduceMotion?: boolean;
  };
}

export interface BootstrapRequest {
  capabilities: ClientCapabilities;
  /** Opaque session/auth token if the user is signed in. */
  authToken?: string;
  /**
   * How many times this install has opened the app, this one included.
   *
   * Lets the server time a prompt by familiarity rather than by calendar —
   * "once they have been here a few times" is a thing only the client can
   * count, and counting it here keeps the decision itself on the server.
   */
  launchCount?: number;
}

export interface BootstrapResponse {
  schemaVersion: number;
  theme: ThemeTokens;
  navigation: NavigationShell;
  initialScreenId: string;
  flags?: Record<string, boolean | number | string | Record<string, unknown> | unknown[]>;
  labels?: Record<string, string>;
  /** Media registry — keyed lookup for backend-uploaded assets.
   * Populated from server `/v1/media/upload` uploads. Empty when no admin
   * uploads have happened yet. */
  media?: Record<string, MediaEntry>;
  /** The account's milestones for Meta's SDK to log (signed up, keyboard on,
   *  first dictation). Each is sent once, ever; only on a network bootstrap,
   *  and dropped before the bootstrap is persisted (telemetry/meta.ts). */
  metaEvents?: Array<{ name: string; params?: Record<string, string | number> }>;
  update?: UpdateGate;
  /** A card shown over the app on open — an announcement, a nudge, an offer. */
  launchCard?: LaunchCard;
  languages?: LanguageOption[];
  cacheTtlSeconds?: number;
  cacheVersion?: string;
  /**
   * Screens to fetch and store on launch, before the user asks for them.
   *
   * The client used to warm only the tab destinations, so everything a tap
   * deeper still waited on the network the first time it was opened — on every
   * install, and again after every cacheVersion bump. The server knows the
   * whole reachable set; this is it.
   */
  warmScreenIds?: string[];
}

export type NodeEvent =
  | "onPress" | "onLongPress" | "onDoubleTap"
  | "onChange" | "onSubmit"
  | "onFocus" | "onBlur"
  | "onAppear" | "onDisappear"
  | "onRefresh" | "onEndReached"
  | "onSwipeLeft" | "onSwipeRight"
  | "onScroll" | "onScrollEnd"
  | "onSelect" | "onDismiss" | "onComplete"
  | "onResult" | "onError";

export type MotionPreset =
  | "fade" | "fadeInUp" | "fadeInDown" | "scaleIn"
  | "slideInLeft" | "slideInRight" | "pulse";

export interface MotionSpec {
  appear?: MotionPreset;
  exit?: MotionPreset;
  durationMs?: number;
  delayMs?: number;
  loop?: boolean;
}

export interface Node {
  type: string;
  id?: string;
  props?: Record<string, any>;
  style?: Record<string, any>;
  children?: Node[];
  bind?: Record<string, string>;
  on?: Partial<Record<NodeEvent, ActionRef>>;
  motion?: MotionSpec;
  visibleIf?: Condition;
  fallback?: Node;
}

export interface ScreenRequest {
  screenId: string;
  capabilities: ClientCapabilities;
  authToken?: string;
  /** Params passed by a `navigate` action (e.g. an item id). */
  params?: Record<string, unknown>;
  /** Device UTC offset in minutes (-getTimezoneOffset()) so server-baked
   * per-day stats bucket in the user's local day, not Greenwich's. */
  tzOffsetMinutes?: number;
}

export interface ScreenResponse {
  schemaVersion: number;
  screenId: string;
  /** Live topics (backend src/live): when the server says one changed, the screen on show reloads itself quietly (live.ts). */
  liveTopics?: string[];
  title?: string;
  theme?: Partial<ThemeTokens>;
  template?: string;
  blocks?: Node[];
  root?: Node;
  state?: Record<string, any>;
  actions?: Record<string, ActionSpec>;
  cacheTtlSeconds?: number;
  /**
   * When true, the client hides its app-level chrome (top bar + tab bar) for
   * this screen so the root renders full-bleed (intro slideshow, immersive
   * paywalls, onboarding videos).
   */
  hideChrome?: boolean;
  /**
   * Hide the top bar but KEEP the tab bar.
   *
   * hideChrome is all or nothing, and a tab root cannot use it: losing the
   * tabs on the tab you are standing on leaves no way off it. But a screen
   * whose art is meant to run to the top of the window cannot have a title bar
   * sitting in front of it either — the header is in flow, so its 56pt of
   * status-bar padding is 56pt the art never reaches.
   *
   * This is the middle: the screen starts at the top of the window, the tabs
   * stay. The settings gear goes with the header, so a screen that sets this
   * should not be the only way to reach Settings.
   */
  hideHeader?: boolean;
  /** "desk": a desktop desk page. "bots": a Bots app page, drawn edge to edge from the kit. Phones draw both as any screen. */
  look?: "desk" | "bots";
  /** Pull to refresh with a bot in it, on this screen's scroll (PULL_BOT_CAPABILITY; PullBot.tsx). */
  pullBot?: PullBotSpec;
}

/**
 * PULL-A-BOT (backend shared/types/sdui.ts 3g). This bundle declares PULL_BOT_CAPABILITY: a screen's Screen pulls a bot
 * at the edges `pullBot` turns on, and refreshes the screen when one is let go past the line (PullBot.tsx,
 * pullBotCore.ts). How many are new is counted here: the ids in `items` after the refresh that were not there before.
 */
export const PULL_BOT_CAPABILITY = "PullBot";

/** A look for the pull bot: his colours (pullBotCore PullLook); any left out are the prototype's. */
export interface PullBotLook {
  shellTop?: string;
  shellBottom?: string;
  body?: string;
  limb?: string;
  visor?: string;
  glow?: string;
  shine?: string;
  accent?: string;
}

export interface PullBotSpec {
  /** Pull down at the top of the list. */
  top?: boolean;
  /** Pull up at the end of the list. */
  bottom?: boolean;
  /** The ids of the list's items, in any order: those not here before a refresh are its new ones. */
  items?: string[];
  /** Where new items land ("top" by default): a pull at the other end says where they are, and a tap goes there. */
  newAt?: "top" | "bottom";
  /** Which bot: a look's id (knob pullBot.looks, or the build's: "x0", "ink"), or colours over the default. None: knob pullBot.avatar. */
  avatar?: string | PullBotLook;
  /** The face the pill's words are set in (the page's own); none: the system's, semibold. */
  font?: string;
}

/**
 * THE BOTS APP'S KIT (backend shared/types/sdui.ts, "The Bots app's kit").
 * This bundle declares BOTS_KIT_CAPABILITY, promising: SVG `shapes` with the
 * three motions (SvgShapes.tsx), SafeArea `edges` / `inset` / `barStyle`, and
 * TextField `on.onSubmit` on the return key.
 */
export const BOTS_KIT_CAPABILITY = "BotsKit";

/**
 * THE LIVING BOT TILES (backend shared/types/sdui.ts, "The living bot tiles"). This bundle declares
 * BOTS_MOTION_CAPABILITY, promising two nodes around one physics core (src/botTiles/core.ts):
 * BotTiles (Home's grid: BotTiles.tsx) and BotCard (a card with the tiny bot on top: BotCard.tsx).
 */
export const BOTS_MOTION_CAPABILITY = "BotsMotion";

/**
 * MEDIA (backend shared/types/sdui.ts section 3d): this bundle declares these and runs uploadFile, playAudio /
 * stopAudio and recordVoice (media.ts).
 */
export const FILE_UPLOAD_CAPABILITY = "FileUpload";
export const AUDIO_PLAY_CAPABILITY = "AudioPlay";
export const VOICE_RECORD_CAPABILITY = "VoiceRecord";
export type UploadPick = "photo" | "screenshot" | "video" | "file" | "camera";

/**
 * A LIVE PAGE AND THE OUTBOX (backend shared/types/sdui.ts section 3e): LiveView (LiveView.tsx) draws a running page or
 * artifact in a sandbox of its own; the outbox (offline.tsx) keeps asks typed offline and sends them once, in order.
 */
export const LIVE_VIEW_COMPONENT = "LiveView";
export const OUTBOX_CAPABILITY = "Outbox";

export type BotTileKind = "code" | "keybot" | "plan" | "travel" | "notes" | "make" | "custom";

/**
 * THE BOTS' LOOKS AND MOMENTS (backend shared/types/sdui.ts, "Looks and moments"; the catalog is the server's
 * shared/bots/looks.json, kept here by botTiles/looks.ts). A build that declares this plays a catalog's avatars and
 * moments (core.ts compileLooks) through `avatar`, `moment`, `momentMode` on BotTiles' tiles, BotBuddy and BotCard,
 * BotTiles' `surprises`, and fetches the catalog the bootstrap's flag "bots.looks" ({ v, url }) names.
 */
export const BOT_MOMENTS_CAPABILITY = "BotMoments";
/** A look: an avatar's id in the catalog, or a spec of its own (core.ts AvatarSpec; `extends` an id). */
export type BotAvatarRef = string | Record<string, unknown>;
export type BotMomentMode = "once" | "loop";

export interface BotTileSpec {
  slug: string;
  name: string;
  sub: string;
  color: string;
  kind: BotTileKind;
  state: "working" | "needs" | "idle";
  action?: ActionRef;
  label?: string;
  /** His look (BotMoments); none: his kind's. */
  avatar?: BotAvatarRef;
  /** A moment he plays (BotMoments): once, then his own play again, or as a loop. */
  moment?: string;
  momentMode?: BotMomentMode;
}

export interface BotTilesProps {
  tiles: BotTileSpec[];
  columns: number;
  height: number;
  padding: number;
  gap: number;
  faces: { regular: string; medium: string; semibold: string };
  /** One more tile, as a full-width row under the grid (Notes): its bot at the left, its words at the right. Capability BOT_TILES_STRIP. */
  strip?: BotTileSpec;
  /** The strip's height. */
  stripHeight?: number;
  /** Home's rare idle surprises (BotMoments): every `every` seconds, with `chance`, one idle bot plays one of `moments`. */
  surprises?: { every: number; chance: number; moments: string[] };
}

/** A build that draws BotTilesProps.strip. */
export const BOT_TILES_STRIP = "BotTilesStrip";

export interface BotCardProps {
  kind?: BotTileKind;
  color: string;
  stageHeight: number;
  overlay?: boolean;
  width?: number;
  readyWhen?: Condition;
  doneWhen?: Condition;
  doneDelayMs?: number;
  closeWhen?: Condition;
  once?: string;
  label?: string;
  /** The card's bot's look and a moment for him (BotMoments). */
  avatar?: BotAvatarRef;
  moment?: string;
  momentMode?: BotMomentMode;
}

/**
 * A bot's own tiny bot on its pages (BotBuddy.tsx): the same core, his colour, his kind's play, on a small stage of
 * his own (a page's header, the Code bot's setup steps). Kept by `life` for the life of the app, so the same key on
 * the next screen finds him where he was. Declared by the component name "BotBuddy" (with BotsMotion).
 */
export const BOT_BUDDY_COMPONENT = "BotBuddy";

export type BuddyAct = "play" | "wave" | "survey" | "read" | "settle" | "think" | "carry";

/** Declared by a build whose BotBuddy carries (act "carry", `doneWhen`). */
export const BOT_BUDDY_CARRY = "BotBuddyCarry";

export interface BotBuddyProps {
  kind: BotTileKind;
  color: string;
  life: string;
  /** The stage: width (none: fills its row) and height; size is the bot's own height. */
  width?: number;
  height: number;
  size?: number;
  state: "working" | "needs" | "idle";
  act?: BuddyAct;
  /** While this holds he thinks (an answer is on its way). */
  thinkWhen?: Condition;
  /** Carrying: when this holds the answer is here; he sets the bag down and walks off, and the lane folds away. */
  doneWhen?: Condition;
  /** Where the page's ask field is from his stage: he glances at it. */
  lookTo?: "down" | "left" | "right" | "up";
  label?: string;
  /** His look (BotMoments): an avatar's id, or a spec of its own; none: his kind's. */
  avatar?: BotAvatarRef;
  /** A moment from the catalog (BotMoments): once (then his act again) or as a loop; a build without it gets the recipe's plain act from the server. */
  moment?: string;
  momentMode?: BotMomentMode;
  /** When this holds, the moment's end plays (deliver: a loop's `end`), then it is over. */
  momentEndWhen?: Condition;
}

/** Home's header, alive (HomeHead.tsx; components "WriteOn", "LiveMark", "HeadBar", with BotsMotion). */
export interface WriteOnProps {
  content: string;
  size: number;
  lineHeight: number;
  tracking?: number;
  color?: string;
  fontFamily: string;
  /** Keybot's caret colour. */
  caretColor: string;
  /** Written once per app open for this key (it carries the part of the day). */
  once: string;
}

export interface LiveMarkProps {
  size: number;
  /** The colours of the bots at work: one ring dot lights in each. */
  lit: string[];
  life?: string;
  label?: string;
}

export interface HeadBarProps {
  /** Scrolled past this (px), the bar comes in. */
  at: number;
}

/** One shape of an `SVG` node's `shapes`. A circle or a path. */
export interface SvgShape {
  circle?: [number, number, number];
  d?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
  linecap?: "round" | "butt" | "square";
  linejoin?: "round" | "miter" | "bevel";
  opacity?: number;
  rotate?: number;
  origin?: [number, number];
  motion?: "breathe" | "pop" | "draw";
  delayMs?: number;
}

export type ActionRef = string | ActionSpec;

export type HapticStyle =
  | "light" | "medium" | "heavy"
  | "selection" | "success" | "warning" | "error";

export type ActionSpec =
  // navigation & flow
  /** `replace: true` swaps the top of the stack instead of pushing onto it —
   *  so there is nothing behind to go back to. What a step in a linear flow
   *  wants: onboarding must not be walkable backwards. */
  | { kind: "navigate"; screenId: string; params?: Record<string, any>; replace?: boolean }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  /** `handoff: true`: an assistant's answer, opened only if it is on the hand-off list (security.isHandoffUrl). */
  | { kind: "openUrl"; url: string; external?: boolean; handoff?: boolean }
  | { kind: "openSettings"; target?: "app" | "keyboard" }
  | { kind: "openInAppBrowser"; url: string }
  | { kind: "dismiss" }
  // data & network
  | {
      kind: "callEndpoint";
      method: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      body?: Record<string, any> | string;
      assignTo?: string;
      onSuccess?: ActionRef;
      onError?: ActionRef;
      /** A state path: the answer's words written there as they come (askStream.ts; capability "AskStream"). */
      stream?: string;
    }
  | { kind: "refresh" }
  // local state
  | { kind: "setState"; path: string; value: any }
  | { kind: "toggleState"; path: string }
  /** Add or remove one value in the array at `path`. `min` refuses the removal
   *  that would take the array below that length, so a required multi-select
   *  cannot be emptied. */
  | { kind: "toggleInArray"; path: string; value: unknown; min?: number }
  | { kind: "appendState"; path: string; value: unknown; max?: number }
  | { kind: "incrementState"; path: string; by?: number }
  | { kind: "clearState"; path: string }
  // feedback
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "snackbar"; message: string; actionLabel?: string; onAction?: ActionRef }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  | { kind: "speak"; text: string; voice?: string }
  | { kind: "confetti" }
  // system / sharing / clipboard
  | { kind: "share"; text?: string; url?: string; title?: string }
  | { kind: "shareFile"; path: string; mimeType?: string }
  | { kind: "copyToClipboard"; text: string; toastMessage?: string }
  | { kind: "readClipboard"; assignTo: string }
  | { kind: "sms"; number?: string; body?: string }
  | { kind: "email"; to?: string; subject?: string; body?: string }
  | { kind: "phone"; number: string }
  | { kind: "download"; url: string; filename?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "saveToPhotos"; path: string }
  // media pickers
  | { kind: "pickImage"; assignTo: string; source?: "library" | "camera"; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "pickDocument"; assignTo: string; types?: string[]; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "scanQR"; assignTo: string; onSuccess?: ActionRef; onError?: ActionRef }
  // send a file, play a sound, speak (media.ts; backend shared/types/sdui.ts section 3d)
  | { kind: "uploadFile"; pick: UploadPick; assignTo: string; path?: string; progressTo?: string; maxBytes?: number;
      onSuccess?: ActionRef; onError?: ActionRef; onCancel?: ActionRef }
  | { kind: "playAudio"; url: string; id?: string; statePath?: string; onEnd?: ActionRef; onError?: ActionRef }
  | { kind: "stopAudio" }
  | { kind: "recordVoice"; assignTo: string; statePath?: string; levelTo?: string; append?: boolean; language?: string;
      maxSeconds?: number; onDone?: ActionRef; onError?: ActionRef; onBlocked?: ActionRef }
  // the outbox (offline.tsx; backend shared/types/sdui.ts section 3e)
  | { kind: "outbox"; op: "add" | "remove" | "retry" | "clear"; path?: string; body?: Record<string, unknown>; label?: string; sub?: string; id?: string }
  // permissions
  | {
      kind: "requestPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
      /** The system will not ask again — the answer is already on record and
       *  only Settings can change it. Falls back to onDenied when unset. */
      onBlocked?: ActionRef;
    }
  // Read a permission WITHOUT asking for it. Same shape as requestPermission,
  // but it never shows a system dialog — so a screen can react to a permission
  // it already has (skip itself, hide its CTA) without the act of checking
  // being the very prompt the screen exists to introduce.
  | {
      kind: "checkPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
      /** Optional: also write the boolean answer to this state path. */
      assignTo?: string;
    }
  // auth
  /** `onUnavailable` runs when the phone has no Face ID, fingerprint or
   *  passcode to check against (not when the person cancels: that is onError). */
  | { kind: "biometricPrompt"; reason?: string; onSuccess?: ActionRef; onError?: ActionRef; onUnavailable?: ActionRef }
  | { kind: "signOut" }
  // IAP
  | { kind: "iap.showPaywall"; offeringId?: string; packageId?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.subscribe"; productId: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.restore"; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.checkEntitlement"; entitlement: string; assignTo: string }
  // notifications
  | {
      kind: "scheduleNotification";
      title: string;
      body?: string;
      afterSeconds?: number;
      atIso?: string;
      identifier?: string;
      payload?: Record<string, any>;
    }
  | { kind: "cancelNotification"; identifier: string }
  | { kind: "requestPushPermission"; onGranted?: ActionRef; onDenied?: ActionRef }
  // analytics
  | { kind: "analytics.track"; event: string; props?: Record<string, any> }
  | { kind: "analytics.identify"; userId: string; traits?: Record<string, any> }
  | { kind: "analytics.reset" }
  // calendar
  | { kind: "calendar.addEvent"; title: string; startsAtIso: string; endsAtIso?: string; notes?: string; location?: string }
  // app store review prompt
  | { kind: "requestReview" }
  // keyboard bridge
  | { kind: "keyboard.reload" }
  | { kind: "keyboard.setLayout"; language: string }
  // mic-handoff completion — used by the keyboard_record screen to write the
  // cleaned text back to the App Group + fire a Darwin notification so the
  // keyboard extension picks it up and inserts at the cursor. When `text` is
  // omitted the value at $state.dictationSample (or the explicit path) is used.
  | {
      kind: "completeKeyboardHandoff";
      sessionId?: string;    // omit → read from $state.handoffSessionId
      text?: string;         // omit → read from $state.dictationSample
      textPath?: string;     // alternate state path if not "dictationSample"
      onSuccess?: ActionRef;
    }
  // cancel a pending handoff — same wire notification, empty text
  | { kind: "cancelKeyboardHandoff"; sessionId?: string; onSuccess?: ActionRef }
  // arm the background-audio Flow Session (iOS); no-op on Android
  | {
      kind: "armFlowSession";
      idleTimeoutMs?: number;
      /** Buffer each utterance and send it once at stop, instead of streaming. */
      oneShot?: boolean;
      onSuccess?: ActionRef;
    }
  | { kind: "endFlowSession"; onSuccess?: ActionRef }
  // cache / dev
  | { kind: "clearCache" }
  | { kind: "reloadApp" }
  // composition
  | { kind: "sequence"; actions: ActionRef[] }
  | { kind: "parallel"; actions: ActionRef[] }
  | { kind: "condition"; if: Condition; then: ActionRef; else?: ActionRef }
  | { kind: "delay"; ms: number }
  | { kind: "log"; message: string; level?: "info" | "warn" | "error" };

export type Condition =
  | { eq: [string, any] }
  | { neq: [string, any] }
  | { gt: [string, number] }
  | { gte: [string, number] }
  | { lt: [string, number] }
  | { lte: [string, number] }
  | { in: [string, any[]] }
  | { contains: [string, string] }
  | { startsWith: [string, string] }
  | { endsWith: [string, string] }
  | { truthy: string }
  | { falsy: string }
  | { entitled: string }
  | { flag: string }
  | { platform: "ios" | "android" }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

// ===========================================================================
// Keyboard config — v2 supports the SDUI-driven renderer.
// ===========================================================================

export interface KeyboardConfigResponse {
  schemaVersion: number;
  theme: {
    background: string;
    key: string;
    keyText: string;
    accent: string;
    keyPressed: string;
    backgroundEffect?: KeyboardEffect;
    keyEffect?: KeyboardEffect;
    keyRadius?: number;
    keyShadow?: boolean;
  };
  layouts: KeyboardLayout[];
  features: {
    voice: boolean;
    refine: boolean;
    streaming: boolean;
    /**
     * Android only: live-stream the mic straight from the keyboard. true → the
     * Android keyboard opens a WebSocket and shows words as you speak; false →
     * batch record→upload. iOS ignores this (uses kb.mic.mode).
     */
    liveVoice?: boolean;
    sdui?: boolean;
  };
  labels: Record<string, string>;
  /** Backend-tunable knobs for keyboard visuals + behavior (kb.* dot-keys). */
  flags?: Record<string, unknown>;
  cacheTtlSeconds: number;
  root?: KeyboardNode;
  actions?: Record<string, KeyboardActionSpec>;
  cacheVersion?: string;
  /**
   * v3 (dark/light adaptive): explicit per-appearance palettes. Used by the
   * next SDUI-renderer build to pick a palette based on the extension's
   * current userInterfaceStyle. The shipped renderer ignores these and reads
   * top-level `theme` — kept populated as a backward-compatible dark default.
   */
  themeDark?: KeyboardConfigResponse["theme"];
  themeLight?: KeyboardConfigResponse["theme"];
}

export interface KeyboardLayout {
  language: string;
  displayName?: string;
  rows: string[][];
}

export type KeyboardEffect =
  | { kind: "solid"; color: string }
  | { kind: "blur"; style: "regular" | "chromeMaterialDark" | "chromeMaterialLight" | "systemThinMaterial" | "systemUltraThinMaterial" }
  | { kind: "gradient"; colors: string[]; direction?: "vertical" | "horizontal" };

/**
 * Extras (bind, visibleIf) are evaluated against the keyboard's state store,
 * which exposes:
 *
 *   state.shift / capsLock / dictating / refining / hasFullAccess
 *   state.layoutId / tone / trackpadActive / status / micLevel
 *   state.primaryLanguage / hasMultipleKeyboards / appearance
 *   state.deviceModel / systemVersion / isNetworkReachable / keyboardHeight
 *   state.user.<any>           → backend scratch dict (setState / toggleState /
 *                                 incrementState / clearState / readClipboard /
 *                                 callEndpoint.assignTo all write here)
 *
 * Icon shapes for IconKey.props.icon AND Image.props.source (no rebuild required):
 *   { sf: "mic.fill" } / { asset: "TailzuMark" } / { url: "https://…" } / { emoji: "🎙️" }
 *   String shorthand: "sf:mic.fill" | "asset:TailzuMark" | "https://…"
 *
 * Generic components: TextLabel / Image / ProgressBar / Toggle / ScrollView.
 * Style bag additions: opacity, borderColor+borderWidth, shadow{color,opacity,radius,offset}.
 * Extension slot: { kind: "extension", name, params? } routes to a native
 * handler registered via SDUIRenderer.registerExtension().
 */
export interface KeyboardNode {
  type: string;
  id?: string;
  props?: Record<string, any>;
  style?: Record<string, any>;
  children?: KeyboardNode[];
  bind?: Record<string, string>;
  on?: Partial<Record<"onPress" | "onLongPress" | "onDoubleTap", KeyboardActionRef>>;
  effect?: KeyboardEffect;
  visibleIf?: Condition;
}

export type KeyboardActionRef = string | KeyboardActionSpec;
export type KeyboardActionSpec =
  // ----- text + editing -----
  | { kind: "insertText"; text: string }
  | { kind: "insertKey"; char: string }
  | { kind: "deleteBackward" }
  | { kind: "deleteWord" }
  | { kind: "shift" }
  | { kind: "capsLock" }
  | { kind: "return" }
  // ----- layouts + dictation + refine -----
  | { kind: "switchLayout"; language?: string }
  | { kind: "showLanguageMenu" }
  | { kind: "startDictation" }
  | { kind: "stopDictation" }
  | { kind: "runRefine" }
  | { kind: "cycleTone" }
  // ----- app / system -----
  | { kind: "openApp"; screenId?: string }
  | { kind: "openSettings" }
  | { kind: "openUrl"; url: string; external?: boolean }
  // ----- feedback -----
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "confetti" }
  | { kind: "speak"; text: string; voice?: string }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  // ----- clipboard + share -----
  | { kind: "copyToClipboard"; text: string; toastMessage?: string }
  | { kind: "readClipboard"; assignTo: string }
  | { kind: "share"; text?: string; url?: string; title?: string }
  // ----- state store (backend scratch dict) -----
  | { kind: "setState"; path: string; value: unknown }
  | { kind: "toggleState"; path: string }
  /** Add or remove one value in the array at `path`. `min` refuses the removal
   *  that would take the array below that length, so a required multi-select
   *  cannot be emptied. */
  | { kind: "toggleInArray"; path: string; value: unknown; min?: number }
  | { kind: "appendState"; path: string; value: unknown; max?: number }
  | { kind: "incrementState"; path: string; by?: number }
  | { kind: "clearState"; path: string }
  // ----- network + analytics + logging -----
  | {
      kind: "callEndpoint";
      method: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      body?: Record<string, unknown> | string;
      assignTo?: string;
      onSuccess?: KeyboardActionRef;
      onError?: KeyboardActionRef;
    }
  | { kind: "analytics.track"; event: string; props?: Record<string, unknown> }
  | { kind: "log"; message: string; level?: "info" | "warn" | "error" }
  // ----- cache / reload -----
  | { kind: "clearCache" }
  | { kind: "reloadApp" }
  // ----- flow control -----
  | { kind: "sequence"; actions: KeyboardActionRef[] }
  | { kind: "parallel"; actions: KeyboardActionRef[] }
  | { kind: "condition"; if: Condition; then: KeyboardActionRef; else?: KeyboardActionRef }
  | { kind: "delay"; ms: number }
  // ----- extensibility (forward-compat slot) -----
  | { kind: "extension"; name: string; params?: Record<string, unknown> };
