import { requireNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

/**
 * Sharing into Tailzu from other apps: the native half.
 *
 *  - iOS: the share extension (targets/share) leaves the shared items in the
 *    App Group and opens tulmi://share; consumeShared() takes them, moving
 *    the files into the app's caches.
 *  - Android: other apps' Share menus open MainActivity with ACTION_SEND /
 *    SEND_MULTIPLE (plugin/withTulmiShare.js); consumeShared() reads that
 *    intent, copying the files into the app's cache, and "onShare" says a new
 *    one arrived while the app was running.
 *
 * Each share is taken once. src/share/useShareIn.ts does the rest: uploads
 * the files and opens the share-in screen.
 */

export type SharedItem =
  | { type: "text"; text: string }
  | { type: "url"; url: string }
  | { type: "file"; uri: string; name: string; mime: string; bytes: number };

export interface SharedBatch {
  items: SharedItem[];
  /** Files that could not be taken: too many, too big, or unreadable. */
  skipped?: number;
}

interface TulmiShareNative {
  consumeShared(maxAgeMs?: number): SharedBatch | null | undefined;
  setShareConfig?(json: string): void;
  addListener?(eventName: "onShare", listener: () => void): EventSubscription;
}

// Only in builds that carry the module (not Expo Go): absent, sharing is simply not there.
let native: TulmiShareNative | null = null;
try {
  native = requireNativeModule("TulmiShare") as unknown as TulmiShareNative;
} catch {
  native = null;
}

/** What was shared and not yet taken, or null. Never throws. */
export function consumeShared(maxAgeMs?: number): SharedBatch | null {
  try {
    const b = native?.consumeShared(maxAgeMs);
    if (!b || !Array.isArray(b.items) || !b.items.length) return null;
    return { items: b.items, skipped: Number(b.skipped) || 0 };
  } catch {
    return null;
  }
}

/** Android: a share arrived while the app was open. iOS opens tulmi://share instead. */
export function addShareListener(listener: () => void): { remove(): void } | null {
  try {
    return native?.addListener?.("onShare", listener) ?? null;
  } catch {
    return null;
  }
}

/**
 * The iOS share extension's card, as the server words it: its words, its limits (which it only ever lowers) and
 * its look, written to the App Group for the extension to read (targets/share/ShareViewController.swift). A no-op
 * on Android, and in a build without the function. `null` forgets it.
 */
export interface ShareConfig {
  v: 1;
  words: { opening: string; tooBig: string; cantTake: string; saved: string };
  limits: { maxFiles: number; maxBytes: number; maxText: number; maxPixels: number; closeMs: number };
  card: { background: string; ink: string; dim: number; radius: number };
}

export function setShareConfig(config: ShareConfig | null): void {
  try {
    native?.setShareConfig?.(config ? JSON.stringify(config) : "");
  } catch {
    // never let the share card stop the app
  }
}
