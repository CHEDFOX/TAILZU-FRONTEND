/**
 * DEVICE FACTS, pure (spec 2.9, B9). The fixed list of read-only facts a screen can read as `device.*`, how raw readings map
 * to them, and a snapshot that tells what changed. No React Native import, so it runs under node --test.
 * Nothing private: no ids, no advertising ids, no location values (only whether location is allowed), no installed-app list
 * beyond the six payment schemes a "pay with" chooser needs.
 */

export type PermState = "granted" | "denied" | "blocked" | "unasked" | "unsupported";
export type SizeClass = "compact" | "regular" | "large";

export type Facts = {
  insets: { top: number; bottom: number; left: number; right: number };
  keyboard: { visible: boolean; height: number; enabled: boolean; ready: boolean };
  reduceMotion: boolean;
  scheme: "light" | "dark";
  locale: string;
  fontScale: number;
  width: number;
  height: number;
  sizeClass: SizeClass;
  online: boolean;
  appState: "active" | "background" | "inactive";
  perm: { mic: PermState; camera: PermState; notifications: PermState; location: PermState; photos: PermState };
  canOpen: Record<string, boolean | null>;   // null = not probed on this platform (unknown, not "not installed")
  platform: "ios" | "android" | "web";
  appVersion: string;
  runtime: string;
  blocks: string[];
};

/** `device.canOpen.<name>`: the URL scheme probed. The schemes are declared in LSApplicationQueriesSchemes (app.config.ts). */
export const CAN_OPEN_SCHEMES: Record<string, string> = {
  upi: "upi://", phonepe: "phonepe://", gpay: "tez://", paytm: "paytmmp://", cred: "credpay://", bhim: "bhim://",
};

/** The schemes this binary can really probe. Android's <queries> lists only upi, so the other five would always read false (looks like "not installed"). */
export function probeSchemes(platform: string): string[] {
  return platform === "android" ? ["upi"] : Object.keys(CAN_OPEN_SCHEMES);
}

export const FACT_PATHS = [
  "insets.top", "insets.bottom", "insets.left", "insets.right",
  "keyboard.visible", "keyboard.height", "keyboard.enabled", "keyboard.ready",
  "reduceMotion", "scheme", "locale", "fontScale", "width", "height", "sizeClass", "online", "appState",
  "perm.mic", "perm.camera", "perm.notifications", "perm.location", "perm.photos",
  ...Object.keys(CAN_OPEN_SCHEMES).map((k) => `canOpen.${k}`),
  "platform", "appVersion", "runtime", "blocks",
] as const;

export const DEVICE_SPEC = {
  block: "device",
  facts: FACT_PATHS,
  perm: "granted | denied | blocked | unasked | unsupported (photos is iPhone only)",
  canOpenNote: "android: only upi is probed in this binary; the others read null (unknown)",
  note: "read-only; no identifiers; canOpen.* is never sent to the server (lint refuses it in a request body)",
} as const;

export function defaultFacts(): Facts {
  return {
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    keyboard: { visible: false, height: 0, enabled: true, ready: true },
    reduceMotion: false, scheme: "light", locale: "en", fontScale: 1, width: 0, height: 0, sizeClass: "compact",
    online: true, appState: "active",
    perm: { mic: "unasked", camera: "unasked", notifications: "unasked", location: "unasked", photos: "unsupported" },
    canOpen: Object.fromEntries(Object.keys(CAN_OPEN_SCHEMES).map((k) => [k, false])),
    platform: "ios", appVersion: "", runtime: "", blocks: [],
  };
}

/** Phone widths: under 600 points compact, under 840 regular, else large (tablets, landscape). */
export function sizeClassOf(width: number): SizeClass {
  return width < 600 ? "compact" : width < 840 ? "regular" : "large";
}

/** An Expo-style permission response ({ status, granted, canAskAgain }) as one of the five words. Anything odd reads unasked. */
export function permFrom(r: unknown): PermState {
  if (!r || typeof r !== "object") return "unasked";
  const o = r as { status?: unknown; granted?: unknown; canAskAgain?: unknown };
  if (o.granted === true || o.status === "granted") return "granted";
  if (o.status === "undetermined") return "unasked";
  if (o.status === "denied") return o.canAskAgain === false ? "blocked" : "denied";
  return "unasked";
}

/** The location word the native module speaks ("undetermined") as ours. */
export function locationPerm(s: unknown): PermState {
  return s === "granted" ? "granted" : s === "denied" ? "denied" : s === "blocked" ? "blocked" : s === "undetermined" ? "unasked" : "unsupported";
}

const num = (n: unknown, d = 0) => (typeof n === "number" && Number.isFinite(n) ? n : d);

/** A raw patch (any shape) merged onto the facts with every field type-checked; unknown fields are ignored. Pure: returns a new object. */
export function mergeFacts(base: Facts, patch: Record<string, any>): Facts {
  const f: Facts = { ...base, insets: { ...base.insets }, keyboard: { ...base.keyboard }, perm: { ...base.perm }, canOpen: { ...base.canOpen } };
  const p = patch ?? {};
  if (p.insets && typeof p.insets === "object") for (const k of ["top", "bottom", "left", "right"] as const) f.insets[k] = Math.max(0, num(p.insets[k], f.insets[k]));
  if (p.keyboard && typeof p.keyboard === "object") {
    if (typeof p.keyboard.visible === "boolean") f.keyboard.visible = p.keyboard.visible;
    if (p.keyboard.height != null) f.keyboard.height = Math.max(0, num(p.keyboard.height));
    if (typeof p.keyboard.enabled === "boolean") f.keyboard.enabled = p.keyboard.enabled;
    if (typeof p.keyboard.ready === "boolean") f.keyboard.ready = p.keyboard.ready;
  }
  if (typeof p.reduceMotion === "boolean") f.reduceMotion = p.reduceMotion;
  if (p.scheme === "dark" || p.scheme === "light") f.scheme = p.scheme;
  if (typeof p.locale === "string" && p.locale.length <= 35) f.locale = p.locale;
  if (p.fontScale != null) f.fontScale = Math.min(5, Math.max(0.25, num(p.fontScale, 1)));
  if (p.width != null) f.width = Math.max(0, num(p.width));
  if (p.height != null) f.height = Math.max(0, num(p.height));
  f.sizeClass = sizeClassOf(f.width);
  if (typeof p.online === "boolean") f.online = p.online;
  if (p.appState === "active" || p.appState === "background" || p.appState === "inactive") f.appState = p.appState;
  if (p.perm && typeof p.perm === "object") {
    for (const k of Object.keys(f.perm) as Array<keyof Facts["perm"]>) {
      const v = p.perm[k];
      if (v === "granted" || v === "denied" || v === "blocked" || v === "unasked" || v === "unsupported") f.perm[k] = v;
    }
  }
  if (p.canOpen && typeof p.canOpen === "object") for (const k of Object.keys(CAN_OPEN_SCHEMES)) if ((typeof p.canOpen[k] === "boolean" || p.canOpen[k] === null)) f.canOpen[k] = p.canOpen[k];
  if (p.platform === "ios" || p.platform === "android" || p.platform === "web") f.platform = p.platform;
  if (typeof p.appVersion === "string") f.appVersion = p.appVersion.slice(0, 32);
  if (typeof p.runtime === "string") f.runtime = p.runtime.slice(0, 64);
  if (Array.isArray(p.blocks)) f.blocks = p.blocks.filter((b: unknown) => typeof b === "string").slice(0, 32);
  return f;
}

/** One fact by its dotted path ("perm.mic"), or undefined for a name that is not on the list. Not a free walk: only FACT_PATHS answer. */
export function readFact(f: Facts, path: string): unknown {
  if (!(FACT_PATHS as readonly string[]).includes(path)) return undefined;
  return path.split(".").reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), f);
}

/** The listed paths whose values differ between two snapshots. */
export function changedPaths(a: Facts, b: Facts): string[] {
  return FACT_PATHS.filter((p) => JSON.stringify(readFact(a, p)) !== JSON.stringify(readFact(b, p)));
}
