/**
 * RevenueCat IAP wiring. Same env-driven no-op-when-unset pattern:
 *
 *   REVENUECAT_IOS_KEY     — iOS SDK key
 *   REVENUECAT_ANDROID_KEY — Android SDK key
 *
 * If both are empty (dev / no-paywall build), every function no-ops so the app
 * still runs. When the keys are set at build time via EAS env variables (no
 * code change needed), IAP works end-to-end.
 *
 * The paywall UI is authored server-side (SDUI screen "paywall"). This module
 * only handles the actual purchase mechanics + entitlement reads.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import Purchases, { LOG_LEVEL, PurchasesOffering } from "react-native-purchases";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const IOS_KEY = extra.revenueCatIosKey ?? "";
const ANDROID_KEY = extra.revenueCatAndroidKey ?? "";
const KEY = Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;

let initPromise: Promise<void> | null = null;
let activeEntitlements: Set<string> = new Set();

// Entitlement-change fan-out so the UI can re-gate after a purchase / restore /
// renewal (the RevenueCat customerInfo listener only mutates a module Set —
// nothing re-renders without this).
let entVersion = 0;
const entListeners = new Set<() => void>();
export function entitlementsVersion(): number {
  return entVersion;
}
export function subscribeEntitlements(cb: () => void): () => void {
  entListeners.add(cb);
  return () => { entListeners.delete(cb); };
}

export function isBillingEnabled(): boolean {
  return !!KEY;
}

/**
 * Configure RevenueCat exactly once and resolve when entitlements are loaded.
 * Returns a SHARED promise so every caller (boot effect + the paywall gate in
 * loadBoot) awaits the same in-flight init — the old code flipped an `inited`
 * flag synchronously, so a second `await initBilling()` returned immediately
 * while configure was still running, and the paywall gate read an empty
 * entitlement set → a paying user got hard-locked behind the paywall on cold
 * start. On failure the promise is cleared so a later call can retry.
 */
export function initBilling(userId?: string): Promise<void> {
  if (!KEY) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      try {
        Purchases.setLogLevel(LOG_LEVEL.WARN);
        await Purchases.configure({ apiKey: KEY, appUserID: userId });
        await refreshEntitlements();
        Purchases.addCustomerInfoUpdateListener(() => { void refreshEntitlements(); });
      } catch {
        // Transient config failure must not permanently disable billing —
        // clear the memoized promise so the next call retries.
        initPromise = null;
      }
    })();
  }
  return initPromise;
}

/**
 * Tie RevenueCat to the signed-in app user so purchases/entitlements follow
 * them across devices (call after auth resolves). Safe no-op when billing is
 * off or not yet configured.
 */
export async function identifyBilling(userId: string): Promise<void> {
  if (!KEY || !userId) return;
  try {
    await initBilling(userId);
    await Purchases.logIn(userId);
    await refreshEntitlements();
  } catch {
    /* identity is best-effort; anonymous entitlements still work */
  }
}

async function refreshEntitlements(): Promise<void> {
  try {
    const info = await Purchases.getCustomerInfo();
    activeEntitlements = new Set(Object.keys(info.entitlements.active));
  } catch {
    activeEntitlements = new Set();
  }
  entVersion++;
  entListeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export function hasEntitlement(entitlement: string): boolean {
  return activeEntitlements.has(entitlement);
}

async function pickOffering(offeringId?: string): Promise<PurchasesOffering | null> {
  try {
    const offerings = await Purchases.getOfferings();
    if (offeringId && offerings.all[offeringId]) return offerings.all[offeringId];
    return offerings.current;
  } catch {
    return null;
  }
}

/** Presents a package from the offering; returns true on success.
 * When packageId is provided, that specific package is offered (identifier match).
 * When omitted, the first available package is used.
 */
export async function showPaywall(offeringId?: string, packageId?: string): Promise<boolean> {
  return (await buyPackage(offeringId, packageId)).ok;
}

/**
 * Why a purchase did not happen.
 *
 * Every failure here used to return a bare `false`, and the screen turned all
 * of them into one toast. A missing API key, an offering RevenueCat has not
 * been told about, a product the store will not sell yet, and a user tapping
 * Cancel were indistinguishable — from the outside and from a log. "Tapping the
 * plans does nothing" is what that looks like when the key is empty, because
 * the first line returns before anything reaches the store at all.
 *
 * The same lesson the auth screen already learned: a silent identical failure
 * is a bug report instead of an answer.
 */
export type PurchaseOutcome = { ok: boolean; reason?: string };

export async function buyPackage(offeringId?: string, packageId?: string): Promise<PurchaseOutcome> {
  // Build-time, from process.env.REVENUECAT_IOS_KEY / _ANDROID_KEY. Empty means
  // the binary was built without them, and no amount of store configuration
  // will help until it is rebuilt with them set.
  if (!KEY) return { ok: false, reason: "No RevenueCat key in this build." };
  const offering = await pickOffering(offeringId);
  if (!offering) {
    return { ok: false, reason: `No offering "${offeringId ?? "current"}" for this platform.` };
  }
  const list = offering.availablePackages ?? [];
  const pkg = packageId ? list.find((p) => p.identifier === packageId) ?? list[0] : list[0];
  if (!pkg) {
    // The offering exists but holds nothing this device can buy — the usual
    // shape of "products not attached for this store yet".
    return { ok: false, reason: `Offering "${offering.identifier}" has no package ${packageId ?? ""}.`.trim() };
  }
  try {
    const res = await Purchases.purchasePackage(pkg);
    await refreshEntitlements();
    const active = Object.keys(res.customerInfo.entitlements.active).length > 0;
    return active ? { ok: true } : { ok: false, reason: "Purchase completed but granted no entitlement." };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; message?: string; code?: string | number };
    // A cancel is not a failure and must not be reported as one.
    if (err?.userCancelled) return { ok: false, reason: undefined };
    return { ok: false, reason: err?.message ?? String(e) };
  }
}

export async function subscribeToProduct(productId: string): Promise<boolean> {
  if (!KEY) return false;
  try {
    const products = await Purchases.getProducts([productId]);
    if (!products[0]) return false;
    const res = await Purchases.purchaseStoreProduct(products[0]);
    await refreshEntitlements();
    return Object.keys(res.customerInfo.entitlements.active).length > 0;
  } catch {
    return false;
  }
}

export async function restorePurchases(): Promise<void> {
  if (!KEY) return;
  try {
    await Purchases.restorePurchases();
    await refreshEntitlements();
  } catch { /* no-op */ }
}
