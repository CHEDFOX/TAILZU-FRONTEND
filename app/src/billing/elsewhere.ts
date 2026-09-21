/**
 * IS THIS SUBSCRIPTION SOMEWHERE THIS DEVICE CANNOT REACH?
 *
 * One account reaches an iPhone, an Android phone and a window, and no two of
 * those stores can see each other. Buying here while a subscription is live on
 * another one bills the same person twice for one entitlement, and nothing
 * catches it: both stores are working correctly, each is charging for its own
 * product, and neither has any idea the other exists. The refund is two
 * support queues away.
 *
 * NOT A BLOCK ON EVERY SUBSCRIBER, though. Monthly to annual on THIS store is
 * one purchase the store swaps and prorates itself, so it goes through —
 * refusing it would strand somebody on the plan they are trying to spend more
 * on. The line is the store, not the subscription.
 *
 * Where to send them instead is not ours to choose. Apple lets nothing but
 * Apple change an App Store subscription, Google the same, and a web
 * subscription cannot be reached from either.
 *
 * Kept free of react-native so the rule can be tested on its own: it is a
 * decision about money made from three booleans, and the alert around it is
 * the easy half.
 */

/** The flags the bootstrap sends. Only the billing ones matter here. */
export type BillingFlags = Record<string, unknown> | null | undefined;

const MANAGE_ELSEWHERE: Record<string, string> = {
  "billing.manage.apple":
    "Your subscription is with the App Store. Change or cancel it there: Settings → your name → Subscriptions.",
  "billing.manage.google":
    "Your subscription is with Google Play. Change or cancel it there: Play Store → Payments and subscriptions.",
  "billing.manage.web":
    "Your subscription is billed on the web. Write to support@tailzu.space to change your plan.",
};

/** The flag naming the store THIS device buys from. Its own is a tier change. */
function ownStoreFlag(platform: string): string {
  return platform === "ios" ? "billing.manage.apple" : "billing.manage.google";
}

/**
 * The sentence to show instead of starting a purchase, or null to go ahead.
 *
 * An entitlement whose store this build has never heard of — a new billing
 * engine, a promotional grant — still stops the purchase, and says plainly
 * that there is one rather than guessing where it lives. Stopping is the safe
 * direction: the cost of a wrong "go ahead" is somebody's money.
 */
export function manageElsewhere(flags: BillingFlags, platform: string): string | null {
  if (!flags || !flags["billing.entitled"]) return null;
  if (flags[ownStoreFlag(platform)]) return null;
  const where = Object.keys(MANAGE_ELSEWHERE).find((k) => flags[k]);
  return where
    ? MANAGE_ELSEWHERE[where]
    : "This account already has an active subscription.";
}
