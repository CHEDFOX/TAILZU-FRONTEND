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

let inited = false;
let activeEntitlements: Set<string> = new Set();

export function isBillingEnabled(): boolean {
  return !!KEY;
}

export async function initBilling(userId?: string): Promise<void> {
  if (inited || !KEY) return;
  inited = true;
  try {
    Purchases.setLogLevel(LOG_LEVEL.WARN);
    await Purchases.configure({ apiKey: KEY, appUserID: userId });
    await refreshEntitlements();
    Purchases.addCustomerInfoUpdateListener(() => { void refreshEntitlements(); });
  } catch {
    /* billing failure never bricks the app; user just sees paywall CTAs */
  }
}

async function refreshEntitlements(): Promise<void> {
  try {
    const info = await Purchases.getCustomerInfo();
    activeEntitlements = new Set(Object.keys(info.entitlements.active));
  } catch {
    activeEntitlements = new Set();
  }
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
  if (!KEY) return false;
  const offering = await pickOffering(offeringId);
  const list = offering?.availablePackages ?? [];
  const pkg = packageId ? list.find((p) => p.identifier === packageId) ?? list[0] : list[0];
  if (!pkg) return false;
  try {
    const res = await Purchases.purchasePackage(pkg);
    await refreshEntitlements();
    return Object.keys(res.customerInfo.entitlements.active).length > 0;
  } catch {
    return false;
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
