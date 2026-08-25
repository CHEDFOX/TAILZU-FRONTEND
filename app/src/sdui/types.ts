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

export interface ThemeTokens {
  color: Record<string, string>;
  space: Record<string, number>;
  radius: Record<string, number>;
  font: { family?: string; sizes: Record<string, number>; weights: Record<string, string> };
}

export type NavigationShell =
  | { kind: "tabs"; tabs: Array<{ id: string; title: string; icon?: string; screenId: string }> }
  | { kind: "stack"; rootScreenId: string };

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
  update?: UpdateGate;
  languages?: LanguageOption[];
  cacheTtlSeconds?: number;
  cacheVersion?: string;
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
}

export type ActionRef = string | ActionSpec;

export type HapticStyle =
  | "light" | "medium" | "heavy"
  | "selection" | "success" | "warning" | "error";

export type ActionSpec =
  // navigation & flow
  | { kind: "navigate"; screenId: string; params?: Record<string, any> }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  | { kind: "openUrl"; url: string; external?: boolean }
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
    }
  | { kind: "refresh" }
  // local state
  | { kind: "setState"; path: string; value: any }
  | { kind: "toggleState"; path: string }
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
  // permissions
  | {
      kind: "requestPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
    }
  // auth
  | { kind: "biometricPrompt"; reason?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "signOut" }
  // app-level chrome — expo-alternate-app-icons swap
  | { kind: "setAppIcon"; name: string | null; onSuccess?: ActionRef; onError?: ActionRef }
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
