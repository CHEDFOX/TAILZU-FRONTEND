/**
 * THE STORE'S OWN PRICE ON A PLAN'S TEXT: the pure part (storePrice.ts is the hook).
 *
 * A Text node with `storePrice` (the plan rows on the paywall and in first run: backend catalog.ts paywall,
 * screens/firstRun.ts) shows what the App Store or Play Store will actually charge, in the person's own currency, once
 * RevenueCat has the offering. The server's words (`content`) stay until then, and for good where billing is off, the
 * store does not answer or the offering has no such package. So a price is changed in the stores alone.
 *
 *   storePrice: { packageId: "$rc_annual", offeringId?: "default", field?: "price" | "perMonth", template?: "Then {price}" }
 */

export type StorePriceSpec = { packageId: string; offeringId?: string; field?: "price" | "perMonth"; template?: string };

/** Each package's price strings, by package id, as the store words them ("₹4,999.00", "$9.99"). */
export type StorePrices = Record<string, { price: string; perMonth: string | null }>;

export function isStorePriceSpec(v: unknown): v is StorePriceSpec {
  return !!v && typeof v === "object" && typeof (v as StorePriceSpec).packageId === "string" && !!(v as StorePriceSpec).packageId;
}

/** The words for a spec from the store's prices; null when there is nothing to show, so the server's words stay. */
export function fillStorePrice(spec: StorePriceSpec, prices: StorePrices | null): string | null {
  const p = prices?.[spec.packageId];
  if (!p) return null;
  const value = spec.field === "perMonth" ? p.perMonth : p.price;
  if (!value) return null;
  const template = typeof spec.template === "string" && spec.template.includes("{price}") ? spec.template : "{price}";
  return template.split("{price}").join(value);
}
