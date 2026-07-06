/**
 * Universal media resolver — maps a MediaSpec to a URI the RN <Image> /
 * expo-image / react-native-svg can consume.
 *
 * MediaSpec shapes (mirrors shared/types/sdui.ts):
 *   { key: "brand.mark" }              → resolves via bootstrap.media[key] → URL
 *   { url: "https://…" }               → direct URL (disk-cached by expo-image)
 *   { asset: "TailzuMark" }            → bundled RN require path (see asset-map below)
 *   { emoji: "🎙️" }                    → NOT an image; returns { emoji }
 *   { data: "data:image/…;base64,…" }  → inline data URI
 *
 * String shorthand:
 *   "media:brand.mark"                 → { key: "brand.mark" }
 *   "asset:TailzuMark"                 → { asset: "TailzuMark" }
 *   "https://…" or "data:…"            → treated as { url } / { data }
 *
 * Missing key + no fallback → returns null. Callers show a bundled default in
 * that case (never a blank tile).
 */

// Bundled asset registry. Add new entries here for any asset that MUST ship
// with the binary (splash graphics, App Store icon, keyboard extension mark).
// Every other asset should come from the backend media registry instead.
const BUNDLED_ASSETS: Record<string, number> = {
  // The TailzuMark that ships inside the keyboard extension bundle is
  // referenced by name from Swift; the RN main app can use it via require()
  // if it needs the same graphic.
  //   TailzuMark: require("../../assets/tailzu-mark.png"),
  //
  // Populate as needed; kept empty by default so no unused-require warnings.
};

export type MediaSpec =
  | string
  | { key: string }
  | { url: string; contentType?: string }
  | { asset: string }
  | { emoji: string }
  | { data: string; contentType?: string };

export type MediaEntry = {
  url: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  key?: string;
};

export type MediaRegistry = Record<string, MediaEntry>;

export type ResolvedMedia =
  | { kind: "uri"; uri: string; contentType?: string }
  | { kind: "bundled"; source: number }
  | { kind: "emoji"; glyph: string }
  | { kind: "empty" };

let registryRef: MediaRegistry = {};

/** Update the resolver's view of the current media registry — call this
 * whenever a new bootstrap arrives (see SduiApp). */
export function setMediaRegistry(reg?: MediaRegistry | null): void {
  registryRef = reg ?? {};
}

/** Extract the bootstrap.media block if the shape is right; otherwise {}. */
export function pickMediaRegistry(boot: unknown): MediaRegistry {
  if (boot && typeof boot === "object" && "media" in boot) {
    const m = (boot as { media?: unknown }).media;
    if (m && typeof m === "object") return m as MediaRegistry;
  }
  return {};
}

export function resolveMedia(spec: MediaSpec | null | undefined): ResolvedMedia {
  if (!spec) return { kind: "empty" };

  // String shorthand → normalize to object form first.
  if (typeof spec === "string") {
    if (spec.startsWith("media:")) return resolveMedia({ key: spec.slice(6) });
    if (spec.startsWith("asset:")) return resolveMedia({ asset: spec.slice(6) });
    if (spec.startsWith("http://") || spec.startsWith("https://")) return resolveMedia({ url: spec });
    if (spec.startsWith("data:")) return resolveMedia({ data: spec });
    // Bare string → try both bundled asset lookup and interpret as URL fallback.
    if (BUNDLED_ASSETS[spec] != null) return resolveMedia({ asset: spec });
    return { kind: "empty" };
  }

  if ("emoji" in spec && spec.emoji) return { kind: "emoji", glyph: spec.emoji };
  if ("url" in spec && spec.url) return { kind: "uri", uri: spec.url, contentType: spec.contentType };
  if ("data" in spec && spec.data) return { kind: "uri", uri: spec.data, contentType: spec.contentType };
  if ("asset" in spec && spec.asset) {
    const src = BUNDLED_ASSETS[spec.asset];
    return src != null ? { kind: "bundled", source: src } : { kind: "empty" };
  }
  if ("key" in spec && spec.key) {
    const entry = registryRef[spec.key];
    if (entry?.url) return { kind: "uri", uri: entry.url, contentType: entry.contentType };
    return { kind: "empty" };
  }
  return { kind: "empty" };
}

/** True iff the resolved spec is an SVG (needs react-native-svg instead of
 * <Image>). expo-image also handles SVG but returning this lets callers pick
 * an SVG renderer explicitly when they want animated / styled SVG output. */
export function isSvg(resolved: ResolvedMedia): boolean {
  if (resolved.kind !== "uri") return false;
  if (resolved.contentType?.startsWith("image/svg")) return true;
  return resolved.uri.endsWith(".svg") || resolved.uri.includes("image/svg+xml");
}
