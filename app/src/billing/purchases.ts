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
import Purchases, { LOG_LEVEL, PRORATION_MODE, PurchasesOffering } from "react-native-purchases";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const IOS_KEY = extra.revenueCatIosKey ?? "";
const ANDROID_KEY = extra.revenueCatAndroidKey ?? "";

/**
 * A BUILD-TIME KEY IN THE MANIFEST IS NOT A BUILD-TIME KEY.
 *
 * `Constants.expoConfig` is the config of the UPDATE that is running, not of
 * the binary it is running inside. app.config.ts bakes these two values from
 * the environment at the moment the config is evaluated — and that happens
 * again on every `eas update`. Publish one from a machine that does not have
 * the variables set and the new manifest carries two empty strings, which
 * then replace perfectly good keys in an app that was built correctly.
 *
 * The symptom is the worst kind: purchases worked, nobody changed anything
 * about billing, and then they stopped, with a message saying the build has
 * no key — about a build that does.
 *
 * So the manifest is the FALLBACK now, and the server's answer wins. These are
 * the public SDK keys: they ship inside the binary and sit in the manifest in
 * plain text already, so serving them is not a disclosure. What it buys is a
 * key that cannot be lost by publishing, and one that can be corrected without
 * a release.
 */
let initPromise: Promise<void> | null = null;

let KEY = Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;

export function setBillingKey(key?: string | null): void {
  const next = String(key ?? "").trim();
  if (!next || next === KEY) return;
  KEY = next;
  // A billing layer that gave up because there was no key must be allowed to
  // try again now that there is one.
  initPromise = null;
}

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
/**
 * HOW LONG ANYTHING IS ALLOWED TO WAIT ON THE STORE.
 *
 * configure() and getCustomerInfo() go through the platform's billing
 * service, and on Android that means a Play Billing connection that can be
 * absent, broken or slow — an emulator, a device with no Play account, a
 * review farm, a region where the service is blocked. The SDK retries rather
 * than failing, which is right for a purchase and wrong for a launch.
 *
 * Nothing downstream needs this to succeed: an entitlement set that has not
 * loaded reads as empty, which is exactly what it reads as for a user who has
 * not bought anything. So the deadline is not an error path — it is the
 * answer we have by the time the app has to show something.
 */
const STORE_DEADLINE_MS = 6000;

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    p,
    new Promise<undefined>((res) => setTimeout(() => res(undefined), ms)),
  ]);
}

export function initBilling(userId?: string): Promise<void> {
  if (!KEY) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      try {
        Purchases.setLogLevel(LOG_LEVEL.WARN);
        await Purchases.configure({ apiKey: KEY, appUserID: userId });
        // BOUNDED, because this is on the launch path. An unbounded wait here
        // parks whoever awaited it — and the thing that awaits it is the boot.
        // The app has already frozen once on exactly this shape of mistake:
        // a best-effort call that the boot awaited, on a network that accepts
        // the socket and answers nothing.
        await within(refreshEntitlements(), STORE_DEADLINE_MS);
        // The listener is what makes the deadline safe: when the store does
        // answer, late, the entitlements land and everything that reads them
        // re-renders. Nothing is lost by not waiting — it just arrives after
        // the app is on screen instead of before it.
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
    // CHANGING PLAN IS NOT THE SAME AS BUYING ONE, AND ANDROID HAS TO BE TOLD.
    //
    // Apple does this for us: two products in one subscription group are a
    // switch, and the store applies its own rules to it. Google does not. A
    // purchase that does not name the subscription it replaces is a purchase
    // of a SECOND subscription — Play either refuses it, because one in that
    // group is already owned, or sells it, and then somebody is paying twice
    // for the same entitlement and we told them nothing.
    //
    // So: if this device already holds a different active subscription, the
    // purchase names it. IMMEDIATE_WITH_TIME_PRORATION is the honest one for a
    // change of term — the new plan starts now and the unused days of the old
    // one are credited to it, which is what Apple does for the same move.
    let change: { oldProductIdentifier: string; prorationMode: PRORATION_MODE } | null = null;
    if (Platform.OS === "android") {
      try {
        const info = await Purchases.getCustomerInfo();
        const wanted = pkg.product.identifier;
        const current = (info.activeSubscriptions ?? []).find(
          (id) => id !== wanted && id.split(":")[0] !== wanted.split(":")[0],
        );
        if (current) {
          change = {
            oldProductIdentifier: current,
            prorationMode: PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION,
          };
        }
      } catch { /* no customer info is the same as no current subscription */ }
    }
    const res = await Purchases.purchasePackage(pkg, null, change);
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
