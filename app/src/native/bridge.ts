/**
 * THE NATIVE LOOKS' CALLS INTO THE BRIDGE (modules/tulmi-bridge): the writes that put a catalog, its art and its fonts where the
 * widgets, the Live Activity and the Android notice can read them, and the two things the natives say back (the design ids a widget
 * marked bad, and the push-to-start token).
 *
 * EVERY CALL HERE IS GUARDED TWICE, and neither guard is optional. This JavaScript ships over the air to every binary on the runtime,
 * including ones built before these functions existed, and calling a missing Expo function THROWS. So a call is made only when the
 * binary says (hasBinaryFeature) it carries the code behind it, the function is really on the module, and the call sits in a try:
 * whatever goes wrong is a no and the native view keeps drawing.
 *
 * The module is looked up here rather than through modules/tulmi-bridge/index.ts, which this package does not own: requireNativeModule
 * hands back the same cached module object.
 */
import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";
import { hasBinaryFeature } from "../device/binary";
import type { BinaryFeature } from "../device/binaryCore";

interface LooksModule {
  setNativeLooks?(json: string): string;
  writeNativeArt?(sha: string, scale: number, path: string): boolean | string;
  writeNativeFont?(sha: string, path: string): boolean | string;
  nativeLooksVersion?(): number;
  nativeLookBadIds?(): string[];
  clearNativeLookBadIds?(): void;
  nativeLooksBad?(): string[];
  botsActivityPushToStartToken?(): string | null | undefined;
  setBotsUpdate?(json: string): void;
  endBotsUpdate?(): void;
  addListener?(event: string, listener: (e: unknown) => void): { remove(): void };
}

let mod: LooksModule | null | undefined;
function native(): LooksModule | null {
  if (mod !== undefined) return mod;
  try {
    mod = requireNativeModule("TulmiBridge") as unknown as LooksModule;
  } catch {
    mod = null;
  }
  return mod;
}

/** The platform, as the server spells it, or null on the web. */
export const platform = (): "ios" | "android" | null => (Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null);

/** A file URI as the natives want it: a plain path, with nothing percent-encoded. (They open it with File / URL(fileURLWithPath:).) */
export function plainPath(uri: string): string {
  const raw = uri.startsWith("file://") ? uri.slice(7) : uri;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Run a bridge call only when the binary carries the feature behind it and the function is there. Never throws. */
function call<T>(feature: BinaryFeature, name: keyof LooksModule, run: (m: LooksModule) => T, fallback: T): T {
  try {
    if (!hasBinaryFeature(feature)) return fallback;
    const m = native();
    if (!m || typeof m[name] !== "function") return fallback;
    return run(m);
  } catch {
    return fallback;
  }
}

/** The catalog: `{ index, designs }`. The version folder it wrote, or "" when nothing was written (the last good one keeps drawing). */
export function setNativeLooks(json: string): string {
  const r = call("nativeLook", "setNativeLooks", (m) => m.setNativeLooks!(json), "");
  return typeof r === "string" ? r : "";
}

/** One art file by content. The value the index maps its key to: iOS's answer is only yes or no (the name is the sha and scale),
 *  Android answers with the path under files/. Empty means refused. */
export function writeNativeArt(sha: string, scale: number, uri: string): string {
  const r = call<boolean | string>("nativeLook", "writeNativeArt", (m) => m.writeNativeArt!(sha, scale, plainPath(uri)), false);
  if (typeof r === "string") return r;
  return r === true ? (platform() === "ios" ? `${sha}@${scale}.png` : `nlook/art/${sha}@${scale}.png`) : "";
}

/** One hooked font by content. Empty means refused. */
export function writeNativeFont(sha: string, ext: "ttf" | "otf", uri: string): string {
  const r = call<boolean | string>("nativeLook", "writeNativeFont", (m) => m.writeNativeFont!(sha, plainPath(uri)), false);
  if (typeof r === "string") return r;
  return r === true ? (platform() === "ios" ? `${sha}.${ext}` : `nlook/font/${sha}`) : "";
}

/** The catalog version the binary actually holds (iOS reads the pointer file, Android its own record; a binary without the call: null, and a null from the native side comes back as 0). */
export function nativeLooksVersion(): number | null {
  return call<number | null>("nativeLook", "nativeLooksVersion", (m) => {
    const n = Number(m.nativeLooksVersion!());
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }, null);
}

/** Design ids a widget's crash marker struck twice. */
export function nativeLooksBadIds(): string[] {
  const read = (m: LooksModule): unknown => (typeof m.nativeLookBadIds === "function" ? m.nativeLookBadIds() : m.nativeLooksBad?.());
  const r = call<unknown>("nativeLook", platform() === "ios" ? "nativeLookBadIds" : "nativeLooksBad", read, []);
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string" && /^[a-z0-9._-]{1,40}$/.test(x)).slice(0, 8) : [];
}

/** iOS only: forget the ids once they are reported, so they are not sent again on every launch. */
export function clearNativeLooksBadIds(): void {
  call("nativeLook", "clearNativeLookBadIds", (m) => m.clearNativeLookBadIds!(), undefined);
}

/** iOS 17.2+: the push-to-start token, readable at any time (it may have arrived before a listener was attached). */
export function pushToStartToken(): string | null {
  const r = call<string | null | undefined>("activityPushStart", "botsActivityPushToStartToken", (m) => m.botsActivityPushToStartToken!(), null);
  return typeof r === "string" && r ? r : null;
}

/** iOS 17.2+: told when the push-to-start token arrives or changes. The listener is removed by the returned function. */
export function onPushToStartToken(fn: (token: string) => void): () => void {
  return call("activityPushStart", "addListener", (m) => {
    const sub = m.addListener!("onBotsActivityPushToStartToken", (e) => {
      const t = (e as { token?: unknown } | null)?.token;
      if (typeof t === "string" && t) fn(t);
    });
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  }, () => {});
}

/** Android: post (or repost) the ongoing "Bots at work" notice with this state. */
export function setBotsUpdate(json: string): void {
  call("liveUpdate", "setBotsUpdate", (m) => m.setBotsUpdate!(json), undefined);
}

/** Android: the job ended, or the person signed out: the notice goes. */
export function endBotsUpdate(): void {
  call("liveUpdate", "endBotsUpdate", (m) => m.endBotsUpdate!(), undefined);
}
