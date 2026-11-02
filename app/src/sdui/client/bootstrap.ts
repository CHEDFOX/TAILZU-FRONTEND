/** The bootstrap: fetched, kept on disk for the next cold start, primed into the knobs, and forgotten on sign-out. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_BASE_URL, bumpLaunchCount, getBaseUrl, saveKnobSnapshot } from "../../storage";
import { syncLooks } from "../../botTiles/looks";
import { syncSounds } from "../../media/sounds";
import type { BootstrapResponse, BootstrapRequest } from "../types";
import { getDeviceSignals } from "../../device/signals";
import { setKeyboardCredentials, setKeyboardDictionary, setWidgetMonth, setWidgetTheme } from "../../../modules/tulmi-bridge";
import { setKnobs } from "../knobs";
import { logMetaEvents } from "../../telemetry/meta";
import { post, withRetry } from "./http";
import { buildCapabilities } from "./capabilities";
import { screenCache } from "./screens";

/** The last bootstrap's key on disk (the persisted cache is described in screens.ts). */
const BOOT_KEY = (base: string) => `tulmi.cache.boot:${base}`;

/** The last bootstrap this install received from the current server, or null. */
/**
 * A cached bootstrap is only worth painting while the answers it was computed
 * from still hold.
 *
 * initialScreenId is decided by the server FROM THE DEVICE SIGNALS THE APP
 * SENT — so the copy on disk carries a routing decision made under whatever
 * was true last time. Grant the microphone and reopen the app, and the disk
 * copy still says "show the voice step": it paints, the fresh bootstrap lands
 * a moment later saying otherwise, and the screen the user had already dealt
 * with flashes past on the way to the right one.
 *
 * Stamping the signals into the cache makes that detectable. They match, the
 * cached route is still correct and the app paints instantly as before; they
 * differ, the route is known-stale and the only honest thing to do is wait for
 * the fresh one — a slightly slower open in exactly the case where the fast
 * one would have been wrong.
 */
function signalStamp(): string {
  const d = getDeviceSignals();
  return `${d.micGranted ? 1 : 0}${d.keyboard?.fullAccess ? 1 : 0}${d.keyboard?.enabled ? 1 : 0}`;
}

export async function peekBootstrap(): Promise<BootstrapResponse | null> {
  try {
    const base = await getBaseUrl();
    const raw = await AsyncStorage.getItem(BOOT_KEY(base));
    if (!raw) return null;
    const stored = JSON.parse(raw) as BootstrapResponse & { __signals?: string };
    if (!stored || typeof stored !== "object" || !stored.navigation || !stored.initialScreenId) return null;
    // Written before the stamp existed, or written under different answers.
    if (stored.__signals !== signalStamp()) return null;
    return stored;
  } catch {
    return null;
  }
}

function persistBootstrap(base: string, b: BootstrapResponse): void {
  AsyncStorage.setItem(BOOT_KEY(base), JSON.stringify({ ...b, __signals: signalStamp() })).catch(() => {});
  // And the knobs alone, somewhere the next launch can read before it has
  // loaded anything (see storage.readKnobSnapshotSync).
  saveKnobSnapshot({ labels: b.labels, flags: b.flags as Record<string, unknown> | undefined });
}

/**
 * Point the knobs at the last bootstrap on disk, when nothing better is in hand.
 *
 * The sign-in screen and the pre-boot moments run before this launch has a
 * bootstrap of its own. App.tsx already primes the knobs synchronously where
 * the binary allows (MMKV); this is the asynchronous floor under that, for a
 * binary without it. Unlike peekBootstrap it ignores the device-signal stamp:
 * the stamp guards a ROUTING decision, and knobs are words and numbers.
 */
let knobsPrimed = false;
export function markKnobsPrimed(): void { knobsPrimed = true; }
export async function primeKnobsFromDisk(): Promise<void> {
  if (knobsPrimed) return;
  try {
    const base = await getBaseUrl();
    const raw = await AsyncStorage.getItem(BOOT_KEY(base));
    if (!raw || knobsPrimed) return;
    const stored = JSON.parse(raw) as Partial<BootstrapResponse> | null;
    if (!stored || typeof stored !== "object") return;
    setKnobs({ labels: stored.labels ?? {}, flags: stored.flags ?? {} });
    knobsPrimed = true;
  } catch { /* the fallbacks stand */ }
}

export async function bootstrap(): Promise<BootstrapResponse> {
  // Counted here rather than at the call site so every bootstrap — cold
  // start, reconnect, re-bootstrap after a language change — agrees on what
  // "an open" is.
  const launchCount = await bumpLaunchCount();
  const body: BootstrapRequest = { capabilities: buildCapabilities(), launchCount };
  const b = await withRetry(() => post<BootstrapResponse>("/v1/app/bootstrap", body));
  // Meta's milestones come once, on the bootstrap that reports them: logged
  // here and taken off before it is persisted, so a cached bootstrap can
  // never log them again.
  if (b.metaEvents) {
    const events = b.metaEvents;
    delete b.metaEvents;
    logMetaEvents(events);
  }
  getBaseUrl().then((base) => persistBootstrap(base, b)).catch(() => {});
  // The bots' looks and moments: the server's catalog, fetched and kept when its version moved (botTiles/looks.ts).
  syncLooks((b.flags as Record<string, unknown> | undefined)?.["bots.looks"]);
  // The bots' sounds (sounds.ts): fetched and kept when the catalog's version moves.
  syncSounds((b.flags as Record<string, unknown> | undefined)?.["bots.sounds"]);
  knobsPrimed = true;
  lastBootstrapAt = Date.now();
  return b;
}

/** When this session last received a bootstrap from the network (ms epoch). */
let lastBootstrapAt = 0;

/**
 * Forget that the bootstrap is fresh, so the next foreground fetches a new one.
 * For moments that change what it says about the user — a purchase, a restore,
 * hitting the free cap — which must not wait out the server's cache TTL.
 */
export function expireBootstrap(): void {
  lastBootstrapAt = 0;
}

/**
 * Whether a bootstrap received this session is still inside the TTL the
 * server put on it. False when there has been none, or the server sent no TTL.
 */
export function bootstrapIsFresh(b: Pick<BootstrapResponse, "cacheTtlSeconds"> | null | undefined): boolean {
  const ttl = Number(b?.cacheTtlSeconds ?? 0);
  if (!lastBootstrapAt || !Number.isFinite(ttl) || ttl <= 0) return false;
  return Date.now() - lastBootstrapAt < ttl * 1000;
}

/**
 * SIGNED OUT: NOTHING OF THAT ACCOUNT STAYS ON THE PHONE.
 *
 * The persisted screens (history, stats, the You tab), the last bootstrap, the
 * name the sign-in provider gave, the keyboard's token and dictionary and the
 * widget's month all outlived sign-out — and the next person to sign in on the
 * same phone was painted the previous one's history from the disk cache before
 * their own arrived. Device settings (language, launch count, onboarding seen)
 * belong to the phone and stay.
 */
export async function forgetAccountData(): Promise<void> {
  screenCache.clear();
  lastBootstrapAt = 0;
  setKeyboardCredentials(await getBaseUrl().catch(() => DEFAULT_BASE_URL), "");
  setKeyboardDictionary([]);
  setWidgetMonth(null);
  setWidgetTheme(null);
  try {
    // authName and profileDone: what older builds kept for the name card, cleared wherever they are left.
    const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith("tulmi.cache.") || k === "tulmi.authName" || k === "tulmi.profileDone");
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* storage unreadable: nothing more can be done from here */ }
}
