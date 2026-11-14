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
  | "onResult" | "onError"
  /**
   * VOCAB 2 (pure/SPEC.md 2.6, 2.8, 2.10). The list, input and media nodes fired the nearest old name while this
   * union was closed, which made `onResult` mean three things at once. Each now has its own:
   *   onPage        a list page arrived      { count, more }
   *   onScan        a code was read          { type, data }
   *   onCapture     a picture was taken      { uri, width, height }
   *   onCommit      a slide-to-confirm went through, or a slider was let go
   *   onPermission  the camera's answer      "granted" | "unasked" | "blocked"
   *   onPlay / onPause / onEnd / onReady     a player's own moments
   */
  | "onPage" | "onScan" | "onCapture" | "onCommit"
  | "onPermission" | "onPlay" | "onPause" | "onEnd" | "onReady";

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
  /**
   * The seven vocab-1 presets, frozen, OR a format-2 motion: a map of style keys with keyframes, springs,
   * `drive`, `loop` and `shared` (pure/SPEC.md 2.5, B4; src/sdui/motion/spec.ts has the exact shape). The two are
   * disjoint in practice — a preset is a string under `appear`, a format-2 section is a map — and the renderer
   * sends each to the half that understands it. New screens use format 2; the presets became server kit helpers.
   */
  motion?: MotionSpec | Record<string, unknown>;
  /** Gestures on this node, into the screen's `ui.*` (SPEC 2.5, B5; src/sdui/gesture/spec.ts). */
  gestures?: unknown[];
  /** This node's own rules, live only while it is visible (SPEC 2.4, B3; the shape is kernel/rules.ts RuleSpec). */
  rules?: unknown[];
  /** Today's condition, or the kernel's `{ expr: "…" }` (SPEC 2.2). */
  visibleIf?: Condition | { expr: string };
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
  /** The window's one key (DESK_TALK_TO_CAPABILITY, the window only): a phone never declares it and is never sent it. */
  talkTo?: TalkTo;
  /**
   * THE BLOCKS THIS SCREEN NEEDS (pure/SPEC.md 2.0 principle 2, 2.12): `["expr", "list"]`. Every block is OFF for
   * a screen that does not name one, so a screen with no `needs` draws exactly as it always did. A screen that
   * needs a block this client does not have is not drawn at all: its `root.fallback` is, or the player's own
   * "open X0 again / update X0" card. Never half of it.
   */
  needs?: string[];
  /** This screen's own templates, for `Use` and `Slot` (SPEC 2.3; needs the `defs` block). */
  defs?: Record<string, { params?: string[]; root: Node }>;
  /** The screen's rules and timers (SPEC 2.4; needs the `rules` block). The shape is kernel/rules.ts RuleSpec. */
  rules?: unknown[];
}

/**
 * PULL-A-BOT (backend shared/types/sdui.ts 3g). This bundle declares PULL_BOT_CAPABILITY: a screen's Screen pulls a bot
 * at the edges `pullBot` turns on, and refreshes the screen when one is let go past the line (PullBot.tsx,
 * pullBotCore.ts). How many are new is counted here: the ids in `items` after the refresh that were not there before.
 */
export const PULL_BOT_CAPABILITY = "PullBot";

/**
 * THE BOTS' SOUNDS (backend shared/types/sdui.ts 3h; sounds.ts, soundsCore.ts). This bundle declares BOT_SOUNDS_CAPABILITY:
 * it fetches the catalog the bootstrap's flag "bots.sounds" names, keeps the files, plays pull-a-bot's and the moments'
 * sounds, writes the phone's `soundsOn` into a screen whose state names it, and runs the action devicePref "sounds".
 */
export const BOT_SOUNDS_CAPABILITY = "BotSounds";

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
/**
 * LOOKS FORMAT 2, SCENES (botTiles/scene.ts). A build that declares this also plays the catalog's `scenes`: drawn,
 * formula-driven animation with springs, ropes and soft rings, reacting to taps, his voice, his own motion and the
 * moment's events, and able to change the bot himself. The server then serves the format-2 projection
 * (GET /v1/bots/looks?v=N&f=2) and the bootstrap's flag carries { v, f, url, off }; a build without it is served
 * exactly what it is served today and plays each format-2 recipe's `fallback` act.
 */
export const BOT_MOMENTS2_CAPABILITY = "BotMoments2";
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
  /** DOUBLE_TAP_CAPABILITY: a double tap on the tile (its single tap then waits about 260 ms). */
  doubleTap?: ActionRef;
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

/** listen: still, eyes open, head to his thought; stand: still, looking about (section 3i: sent only to a BotStage build). */
export type BuddyAct = "play" | "wave" | "survey" | "read" | "settle" | "think" | "carry" | "listen" | "stand";

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

// ---------------------------------------------------------------------------
// 3i. Spaces, the family redesign: a bot with a thought, a crowd, a vanish, @ and /, live words (backend shared/types/sdui.ts 3i)
// ---------------------------------------------------------------------------
//
// Generic blocks the server builds Spaces, Home's Ask and the space feed from. A build declares each name it draws in
// capabilities.components; the server sends the new screens only to a build that has them all (kit canSpaces2 / canHomeThought),
// and every other build keeps today's screens.

/** A full tiny bot on a stage of his own that roams with catalog moments, walks out and back in, listens, thinks and cheers, and
 *  can hold a thought: a box over him, joined to his head by three bubbles, that follows him at rest and opens when tapped
 *  (bots/BotStage.tsx). */
export const BOT_STAGE_COMPONENT = "BotStage";
/** A box of many tiny bots playing with the real physics (one canvas), that can grow taller and cheer all at once (bots/BotCrowd.tsx). */
export const BOT_CROWD_COMPONENT = "BotCrowd";
/** Its children vaporise (blur, rise, fade, ink specks) when goneWhen turns true, and come back when it turns false (components/Vanish.tsx). */
export const VANISH_COMPONENT = "Vanish";
/** A message field: "@" picks a person (a chip), "/" picks one of the person's bots, then one of its things (components/MentionField.tsx). */
export const MENTION_FIELD_COMPONENT = "MentionField";
/** The words of the voice session open on this screen, as they are heard: the newest light grey, settling to ink (components/LiveWords.tsx). */
export const LIVE_WORDS_COMPONENT = "LiveWords";
/** NOT A COMPONENT: actions voiceLive and voiceStop (live words over /v1/transcribe-stream, a turn ends on a pause). Declared only
 *  when this binary has the stream module (capabilities.ts). */
export const VOICE_LIVE_CAPABILITY = "VoiceLive";
/** NOT A COMPONENT: BotStage on.onDoubleTap and BotTileSpec.doubleTap on Home's tiles. */
export const DOUBLE_TAP_CAPABILITY = "DoubleTap";
/** NOT A COMPONENT: TextField keyboard / autoFocus / maxLength; Screen and Scroll props.startAtEnd; callEndpoint.stay (ignored
 *  here); a dotted border with a radius drawn dotted on every platform; a failed call's { code, message } at state `lastError`. */
export const KIT_EXTRAS_CAPABILITY = "KitExtras";
/** NOT A COMPONENT, the window only: ScreenResponse.talkTo. Never declared by a phone. */
export const DESK_TALK_TO_CAPABILITY = "DeskTalkTo";
/** NOT A COMPONENT: the location.area, contact.pick and health.sync actions. SAID ONLY BY THE BINARY'S MODULES (device/permCaps.ts:
 *  a JS check that the native function is there), never by the registry, so an older binary running this JavaScript says none. */
export const LOCATION_CAPABILITY = "Location1";
export const CONTACT_PICK_CAPABILITY = "ContactPick1";
export const HEALTH_CAPABILITY = "Health1";

/** How a bot wanders: walk to a random spot in `span` (fractions of the stage's width), pause, play a random moment, again. */
export interface BotRoam {
  moments: string[];
  /** Seconds between moments, a random value in the range. */
  every: [number, number];
  /** Seconds he stands before and after a walk. */
  pause: [number, number];
  span?: [number, number];
}

export interface BotThoughtSpec {
  /** home: a dotted box (2 px dotted ink, radius 18, white); space: a white field (1 px #d4d4d4, radius 18, soft shadow). */
  style: "home" | "space";
  /** The words in the small box riding over him at rest (a tap on it opens it). None: no box at rest. */
  restText?: string;
  /** A state path holding true while it is open. The app writes true when the resting box is tapped and false when the veil is
   *  tapped or back is pressed; the server's actions may write it too. */
  openPath: string;
  /** Near the whole screen (an answer coming in). Wins over open. */
  fullWhen?: Condition;
  /** square: a square over him (home); wide: the stage's width less the gutters, as tall as its content (space). */
  shape: "square" | "wide";
  /** Blur the screen behind it while open or full. */
  veil: boolean;
  /** follow: over him; low: while open he walks down near the bottom of the screen and the box fills the space above him. */
  place: "follow" | "low";
}

export interface BotStageProps {
  /** Who he is across screens and repaints: the same life, the same bot, carrying on. */
  life: string;
  kind: BotTileKind;
  color: string;
  avatar?: BotAvatarRef;
  /** His height and the stage's, in px. Never drawn shorter than size + 18, plus (with restText) the trail's rest room (core.ts
   *  trailRoom(), about 82) + 48, whatever `height` says (stageCore.ts minStageHeight). */
  size: number;
  height: number;
  /** What a tap opens: "bot" (default) only his body; "stage" the whole stage. A double tap is always on his body. */
  hit?: "bot" | "stage";
  /** false: he never plays with props (the person's own bot). */
  toys?: boolean;
  roam?: BotRoam;
  /** While it holds he walks out at `outSide` (none: the edge nearer him then, as the prototype does); when it stops he walks back
   *  in from the edge he left by. */
  outWhen?: Condition;
  outSide?: "left" | "right";
  /** Each time it turns true he gives a happy hop. */
  cheerWhen?: Condition;
  thinkWhen?: Condition;
  /** He stands still and listens (eyes open, head to his thought), his bubbles pulsing with the voice. */
  listenWhen?: Condition;
  thought?: BotThoughtSpec;
  /** What a screen reader says for him. */
  label: string;
}
// on.onPress: a tap on him (or the stage, hit "stage"). on.onDoubleTap (DOUBLE_TAP_CAPABILITY): a double tap on him (a single tap
// then waits about 260 ms). on.onDismiss: the open thought was closed by the person (veil, back), after openPath is false. These
// run ONLY from his hit area, never from a press inside the box.
// children: the thought's content while it is open, full, or he listens (with listenWhen). At rest the box shows restText.

export interface BotCrowdProps {
  life: string;
  /** 5 to 9 tiny bots, each on his own patch, lots of empty space. */
  bots: Array<{ kind: BotTileKind; color: string; avatar?: BotAvatarRef }>;
  /** Each bot's height in px. */
  size: number;
  /** Its height at rest; none: as tall as it is wide. */
  height?: number;
  grownWhen?: Condition;
  grownHeight?: number;
  /** While it holds every bot cheers, again and again (a few seconds at most). */
  cheerWhen?: Condition;
  surprises?: { moments: string[]; every: number; chance: number };
  label: string;
}
// children: drawn over the bots at the top of the box (the bots keep the floor).

export interface VanishProps {
  goneWhen: Condition;
  /** Kept per key: drawn gone at once on a repaint, never replayed. */
  key: string;
}

/** What a MentionField writes to its draftPath on every change (empty strings: none). */
export interface MentionDraft {
  text: string;
  toId: string; toName: string;
  bot: string; botName: string; thingId: string; thingTitle: string;
}
export interface MentionFieldProps {
  life: string;
  placeholder: string;
  draftPath: string;
  /** `bot`: the person's own tiny bot (PERSON_BOT_COMPONENT, section 3j), drawn in their row. */
  people: Array<{ id: string; name: string; bot?: Pick<PersonBotProps, "seed" | "avatar" | "color"> }>;
  bots: Array<{ slug: string; name: string; color: string; kind: BotTileKind }>;
  /** GET path (":bot" replaced) answering { items: Array<{ id: string; title: string; line: string }> }. */
  thingsPath: string;
  /** Rows after the bots in the "/" list, each running its action. */
  tools?: Array<{ id: string; label: string; action: ActionRef }>;
  words: { people: string; bots: string; empty: string };
  maxLength?: number;
  autoFocus?: boolean;
}
// on.onSubmit: the return key / the send button, with the draft in draftPath. Before it runs: text starting with "@word" and no
// person chip is turned into that person's chip when exactly one person's first name is that word (case-insensitive, the "@word"
// taken out of the text); when more than one matches, the People list opens filtered to it and nothing is sent (mentionCore.ts).
// The server clears draftPath after sending; the field empties itself (chips too) when draftPath is cleared.

export interface LiveWordsProps {
  size: number;
  lineHeight: number;
  fontFamily: string;
  color?: string;          // settled words, ink
  freshColor?: string;     // the newest words, #b5b5b5
  settleMs?: number;       // 600
}

// ---------------------------------------------------------------------------
// 3j. People as their own tiny bots, and the messages' face (backend shared/types/sdui.ts 3j)
// ---------------------------------------------------------------------------
//
// No initials anywhere in Spaces: a person is their own tiny bot, and a space's messages are set in Bricolage Grotesque. Each is a
// name a build declares in capabilities.components. Without PersonBot the server sends a plain circle in the person's colour (no
// letter); without FontBricolage it sets the same nodes in Geist.

/**
 * A person, as their own full tiny bot standing in a size x size box (feet on its floor): the bots' engine, an avatar from the
 * catalog and the person's colour, no cloth, no toys. He idles (blinks, a small sway, rarely a small gesture), staggered by `seed`
 * so a list never moves in step; every PersonBot on a screen runs on one loop, and one off screen is paused. Reduce Motion: a
 * still pose (bots/PersonBot.tsx, personBotCore.ts).
 */
export const PERSON_BOT_COMPONENT = "PersonBot";
/**
 * NOT A COMPONENT: the three Bricolage Grotesque faces are registered, each weight a family of its own as Geist's are ("Tailzu
 * Bricolage" 400, "Tailzu Bricolage Medium" 500, "Tailzu Bricolage SemiBold" 600). The phone loads them as it loads Geist: the
 * bootstrap's `fonts` (theme/remoteFonts.ts), which names them for a build that says this.
 */
export const FONT_BRICOLAGE_CAPABILITY = "FontBricolage";
/**
 * NOT A COMPONENT: a notification button that opens the app (Pay, Send, No, Open map) hands its id to the push's screen as the
 * `button` param; a plain tap has none (notifications/push.ts). The server's hand-off screens open other apps only for the button.
 */
export const PUSH_BUTTON_CAPABILITY = "PushButton";
/** NOT A COMPONENT (the phone): the call screen's pieces — speak.loud, speak.onDone and "$state" in speak.text; voiceLive.duplex;
 *  Text format "elapsed". Also a push-token cap: this JS takes Plan Ease's calls (docs/plan-ease.md "Calls"). */
export const BOT_CALL_CAPABILITY = "BotCall";
// Text props, format "elapsed" (BOT_CALL_CAPABILITY; components/Text.tsx, elapsedCore.ts): content is a start time (epoch ms, or
// ISO); shows "m:ss" (or "h:mm:ss" past an hour) since then, ticking every second; never negative.
/**
 * NOT A COMPONENT (the phone): the actions voiceCall and voiceCallSet — Plan Ease's call as a live conversation instead of turn by
 * turn (sdui/voice/callRealtime.ts). SAID ONLY BY THE BINARY, never by this list: the live client is native code, so the name comes
 * from the bridge's `binaryFeatures` ("realtimeCall" → device/binaryCore.ts), and every older binary running the same JavaScript
 * says nothing and is sent today's turn call.
 */
export const VOICE_REALTIME_CAPABILITY = "VoiceRealtime";

export interface PersonBotProps {
  /** Who he is (the person's id): what staggers his idling, so two of them never blink together. */
  seed: string;
  /** An avatar's id in the looks catalog ("pip", "nova"; the viewer's own bot: "blip"). */
  avatar: string;
  /** His colour (#rrggbb). The viewer's own bot: ink #0a0a0a. */
  color: string;
  /** The box, square, in px. Default 32. */
  size?: number;
  /** false: a still pose (a long list may ask for it). Default true. */
  live?: boolean;
  /** What a screen reader says (the person's name); none: he is decoration beside the name. */
  label?: string;
}
// MentionFieldProps.people items may carry `bot: { seed, avatar, color }`: this build draws that bot in the person's row of the "@"
// list (size 28), in place of anything else.

/** The window's one key (DESK_TALK_TO_CAPABILITY): a phone is never sent it. */
export interface TalkTo {
  voice: Extract<ActionSpec, { kind: "voiceLive" }>;
}

/**
 * TextField's extras (KIT_EXTRAS_CAPABILITY), sent only in the new trees (TextField.tsx):
 *   keyboard   "text" | "email" | "code". email: the email keyboard, no autocapitalise or autocorrect, textContentType
 *              emailAddress. code: ASCII capitals, no autocorrect, oneTimeCode.
 *   autoFocus  focus it when it first appears on the screen (the TextInput mounts when a when() shows it).
 *   maxLength  the most characters it takes.
 */
export interface TextFieldExtras {
  keyboard?: "text" | "email" | "code";
  autoFocus?: boolean;
  maxLength?: number;
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
  | {
      kind: "navigate"; screenId: string; params?: Record<string, any>; replace?: boolean;
      /** How it comes up (SPEC 2.10, the `shell` block). Missing or unknown means `push`, as it always did. */
      presentation?: "push" | "sheet" | "modal" | "overlay" | "fade";
      /** A sheet's stops: names ("small" | "half" | "large" | "full") or fractions 0.1..1. */
      detents?: unknown[];
      /** "default" | "slide" | "fade" | "none", or a format-2 motion value. */
      transition?: unknown;
      /** A sheet or modal the person may close by themselves. Default true. */
      dismissible?: boolean;
    }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  /** `handoff: true`: an assistant's answer, opened only if it is on the hand-off list (security.isHandoffUrl). */
  | { kind: "openUrl"; url: string; external?: boolean; handoff?: boolean }
  | { kind: "openSettings"; target?: "app" | "keyboard" | "healthConnect" }
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
      /** KIT_EXTRAS: the window does not fetch the screen again after this write. The phone never does, so it ignores it. */
      stay?: boolean;
      /**
       * THE `data` BLOCK'S OPTIONS (SPEC 2.10). Each is read only by a client that has the block and a screen
       * that said it needs it; the exact shapes and their caps are in src/sdui/client/endpointCore.ts.
       *   multipart     { files: [{ field, uri, name?, type? }], fields? } — a picked file, sent as it is
       *   progressInto  a state path that gets { loaded, total, pct } while it uploads
       *   retry         { times, backoff, idempotent? } — a POST retries only when it says it is safe to
       *   queue         "outbox": kept while offline and sent in order
       *   cache         { key, ttlMs } — GET only, emptied by any successful write and by signing out
       *   optimistic    { path, value } — written at once, put back if the call fails
       */
      multipart?: unknown;
      progressInto?: string;
      retry?: unknown;
      queue?: "outbox";
      cache?: unknown;
      optimistic?: { path: string; value: unknown };
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
  /**
   * WHAT THIS PHONE REMEMBERS (SPEC 2.9, the `local` block): a hint dismissed, a draft, the last thing chosen.
   * Its own namespace, 256 KB in all, cleared on sign-out, and never a secret — a name that looks like one
   * (token, key, password…) is refused and `onError` runs with the reason in `$state.lastError.reason`.
   */
  | { kind: "local.set"; path: string; value: unknown; onError?: ActionRef }
  | { kind: "local.remove"; path: string; onError?: ActionRef }
  /** Listen to a live topic and write what arrives into state (SPEC 2.10, the `data` block). */
  | { kind: "subscribe"; topic: string; into: string; mode?: "replace" | "append" | "merge"; max?: number }
  // feedback
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "snackbar"; message: string; actionLabel?: string; onAction?: ActionRef }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  | { kind: "speak"; text: string; voice?: string;
      /** BOT_CALL_CAPABILITY: play on the speaker even with the silent switch on (the audio session set to playback first). */
      loud?: boolean;
      /** BOT_CALL_CAPABILITY: when it has been said, stopped or failed (once). */
      onDone?: ActionRef }
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
  // live words (section 3i; VOICE_LIVE_CAPABILITY; voice/voiceLive.ts)
  /** Listen with live words; a turn ends after `silenceMs` without new words. statePath is "listening" while hearing,
   *  "sending" while onHeard runs, "" when over. Each turn's words (every segment the stream finalised, then the last
   *  partial) go to `into`, then onHeard runs (awaited). chat: listen again after it unless stopWhen holds; it ends on
   *  voiceStop, leaving the screen, the app going to the background, quiet (no words for 8 s in the first turn, 12 s in a
   *  chat), or 20 minutes. once: one turn. onBlocked: no microphone permission. The voice level never goes into state. */
  | { kind: "voiceLive"; mode: "once" | "chat"; statePath: string; into: string; silenceMs?: number; language?: string;
      onHeard: ActionRef; stopWhen?: Condition; onEnd?: ActionRef; onError?: ActionRef; onBlocked?: ActionRef;
      /** BOT_CALL_CAPABILITY: one audio session that plays and records, held between turns (a screen that answers out loud). */
      duplex?: boolean }
  /** Stop the voice session on this screen; the words of the turn not yet sent are dropped. */
  | { kind: "voiceStop" }
  // a live voice call (VOICE_REALTIME_CAPABILITY; voice/callRealtime.ts, its rules in callRealtimeCore.ts)
  /** VOICE_REALTIME_CAPABILITY. A live voice call: POST `path` {sdp, resume} -> {sdp, maxSec}; then POST `${path}/ready`; leaving
   *  the app or an audio interruption is POST `${path}/stop`. Writes the phase into `phasePath` (connecting | speaking |
   *  listening | thinking | idle | ended), the bot's words as they are spoken into `saidPath`, the person's last words into
   *  `heardPath`, and {spoke} into `statePath`. After a tool turn it re-reads `viewPath` and sets each `actedState[action]` key to
   *  true for every action in the view's `acted`. Ends on voiceCallSet end, leaving the screen (another screen id or params; a
   *  refresh of the same screen keeps it), the app going to the background or an audio interruption (then onIdle), the reply's
   *  maxSec + 10 s, or the server hanging up (re-reads viewPath: ended -> onEnded, answered -> onFallback). onBlocked: no
   *  microphone permission. Any throw while loading the native module or opening the mic -> onFallback. The level never goes into
   *  state: the stage reads it. */
  | { kind: "voiceCall"; path: string; viewPath: string; resume?: boolean;
      statePath: string; phasePath: string; saidPath: string; heardPath: string; actedState?: Record<string, string>;
      onEnded?: ActionRef; onIdle?: ActionRef; onFallback?: ActionRef; onBlocked?: ActionRef }
  /** VOICE_REALTIME_CAPABILITY. warm: get the mic and the offer ready while the call is answered (only if mic permission is
   *  already granted). end: the live call on this screen ends now. */
  | { kind: "voiceCallSet"; op: "warm" | "end" }
  // the outbox (offline.tsx; backend shared/types/sdui.ts section 3e)
  | { kind: "outbox"; op: "add" | "remove" | "retry" | "clear"; path?: string; body?: Record<string, unknown>; label?: string; sub?: string; id?: string }
  /** A setting kept on this device (sounds.ts): "sounds" on or off; `value` may be "$state.x". BOT_SOUNDS_CAPABILITY. */
  | { kind: "devicePref"; key: "sounds"; value: unknown }
  // location, contacts, health (perms/SPEC.md 5.1). Declared by device/permCaps.ts only when the native module is there.
  /** Phone, Location1. One foreground fix, named by the phone's OS geocoder (which sends the point to Apple or Google); only the
   *  area's words reach `assignTo`. Asks the system first only when `ask` (the card's Continue). The point never reaches JavaScript. */
  | { kind: "location.area"; assignTo: string; ask?: boolean;
      onFound?: ActionRef; onNone?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef; onError?: ActionRef }
  /** Phone, ContactPick1. The system's own contact picker; no permission. Only the ONE email tapped reaches `assignTo`. */
  | { kind: "contact.pick"; assignTo: string; onPicked?: ActionRef; onCancel?: ActionRef; onError?: ActionRef }
  /** Phone, Health1. Reads daily step totals and workouts for `days` (max 31), sums them on the phone, POSTs to `path`, which
   *  must match /^\/v1\/bots\/[a-z0-9]+(?:-[a-z0-9]+)*\/health\/days$/ (else refused before any read).
   *  Asks only when `ask`; `enable` rides on the first POST. No health value reaches state. */
  | { kind: "health.sync"; path: string; days?: number; ask?: boolean; enable?: boolean;
      onSynced?: ActionRef; onEmpty?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef;
      onUnavailable?: ActionRef; onError?: ActionRef }
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
      /** This binary cannot grant this kind at all (contacts, calendar, tracking; photos on Android). Falls back
       *  to onDenied, so a screen written before this behaves as it did. */
      onUnsupported?: ActionRef;
      /** Optional: the whole answer as a word — "granted" | "denied" | "blocked" | "unsupported". */
      statusTo?: string;
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
      /** This binary cannot grant this kind at all. Falls back to onDenied. */
      onUnsupported?: ActionRef;
      /** Optional: the whole answer as a word — "granted" | "denied" | "unsupported". */
      statusTo?: string;
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
