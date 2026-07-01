/**
 * SDUI types — the client mirror of the backend's server-driven UI contract.
 *
 * SOURCE OF TRUTH: TAILZU-BACKEND/shared/types/sdui.ts. Keep this file in sync
 * with that one by hand. Same rules for TAILZU-BACKEND/shared/types/api.ts →
 * ../api.ts (in src/api.ts).
 *
 * Divergence-catching: we mirror the backend's exact enums (HapticStyle,
 * MotionPreset) so a payload that names one the client can't handle turns into
 * a TS error at review time instead of a silent runtime miss. The `props`/
 * `style` bags stay `Record<string, any>` here because the RN renderer reads
 * them polymorphically — a stricter shape would fight the component registry.
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
  name: string;      // endonym shown on the pill
  greeting: string;  // "hello" in that language (the rotating greeting)
  regions?: string[];
}

export interface BootstrapResponse {
  schemaVersion: number;
  theme: ThemeTokens;
  navigation: NavigationShell;
  initialScreenId: string;
  flags?: Record<string, boolean | number | string>;
  labels?: Record<string, string>;
  update?: UpdateGate;
  // The post-auth language picker is fed from here; the app falls back to a
  // built-in list only when the backend doesn't send one.
  languages?: LanguageOption[];
  cacheTtlSeconds?: number;
}

export type NodeEvent =
  | "onPress" | "onLongPress" | "onChange" | "onSubmit"
  | "onAppear" | "onDisappear" | "onRefresh" | "onEndReached"
  | "onResult" | "onError";

/** Server-authored motion preset. The registry rejects anything else. */
export type MotionPreset =
  | "fade"
  | "fadeInUp"
  | "fadeInDown"
  | "scaleIn"
  | "slideInLeft"
  | "slideInRight"
  | "pulse";

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
}

export type ActionRef = string | ActionSpec;

/** Feedback style the action interpreter maps to real haptics/vibration.
 *  Kept aligned with the backend so an unknown value is a TS error. */
export type HapticStyle =
  | "light"
  | "medium"
  | "heavy"
  | "selection"
  | "success"
  | "warning"
  | "error";

export type ActionSpec =
  | { kind: "navigate"; screenId: string; params?: Record<string, any> }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  | { kind: "openUrl"; url: string; external?: boolean }
  | { kind: "openSettings"; target?: "app" | "keyboard" }
  | { kind: "dismiss" }
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
  | { kind: "setState"; path: string; value: any }
  | { kind: "toggleState"; path: string }
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "playMedia"; url: string }
  | { kind: "speak"; text: string }
  | { kind: "signOut" }
  | { kind: "sequence"; actions: ActionRef[] }
  | { kind: "condition"; if: Condition; then: ActionRef; else?: ActionRef };

export type Condition =
  | { eq: [string, any] }
  | { neq: [string, any] }
  | { truthy: string }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

// ===========================================================================
// Keyboard config — the OS-legal "SDUI" for the native keyboard extension.
// ===========================================================================
// Kept here (not just in the native code) so the app can preview / validate
// what the keyboard will render, and so a config regression turns into a TS
// error rather than a silent runtime miss.

export interface KeyboardConfigResponse {
  schemaVersion: number;
  theme: {
    background: string;
    key: string;
    keyText: string;
    accent: string;
    keyPressed: string;
  };
  layouts: KeyboardLayout[];
  features: {
    voice: boolean;
    refine: boolean;
    /** Show a live-streaming dictation UI vs. one-shot. */
    streaming: boolean;
  };
  labels: Record<string, string>;
  cacheTtlSeconds: number;
}

export interface KeyboardLayout {
  language: string;
  rows: string[][];
}
