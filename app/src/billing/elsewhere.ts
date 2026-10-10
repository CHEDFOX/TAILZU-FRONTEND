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

/**
 * The words, from the server. The app passes the knobs' txt (labels
 * billing.elsewhere.*); the default fills `{placeholders}` and keeps the
 * fallback, so this file stays free of imports and the rule stays testable in
 * plain node.
 */
export type Txt = (key: string, fallback: string, vars?: Record<string, string | number>) => string;
const fallbackTxt: Txt = (_key, fallback, vars) =>
  vars ? fallback.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : fallback;

/** What to call the place, and what the button that goes there should say. */
function where(txt: Txt): Record<string, { name: string; go: string }> {
  return {
    "billing.manage.apple": {
      name: txt("billing.elsewhere.apple.name", "the App Store"),
      go: txt("billing.elsewhere.apple.go", "Open App Store"),
    },
    "billing.manage.google": {
      name: txt("billing.elsewhere.google.name", "Google Play"),
      go: txt("billing.elsewhere.google.go", "Open Google Play"),
    },
    "billing.manage.web": {
      name: txt("billing.elsewhere.web.name", "the web"),
      go: txt("billing.elsewhere.web.go", "Email support"),
    },
  };
}

/** The flag naming the store THIS device buys from. Its own is a tier change. */
function ownStoreFlag(platform: string): string {
  return platform === "ios" ? "billing.manage.apple" : "billing.manage.google";
}

export type Elsewhere = {
  /** One line. What is true, not what to do about it. */
  message: string;
  /** The button's words, and where it goes. Absent when there is nowhere. */
  action?: { label: string; url: string };
};

/**
 * What to do instead of starting a purchase, or null to go ahead.
 *
 * THE ANSWER IS A DESTINATION, NOT AN INSTRUCTION. Telling somebody their
 * subscription is with Apple and leaving them to find Settings, their name,
 * and Subscriptions is asking them to do the work of the refusal — and that
 * is the part that becomes a support email. Where the flags name a place, the
 * caller gets a button that simply arrives there, so a tap on Upgrade still
 * ends where upgrading happens.
 *
 * An entitlement whose store this build has never heard of — a new billing
 * engine, a promotional grant — still stops the purchase, and says plainly
 * that there is one rather than guessing where it lives. Stopping is the safe
 * direction: a wrong "go ahead" costs somebody money, a wrong stop costs an
 * email.
 */
export function manageElsewhere(flags: BillingFlags, platform: string, txt: Txt = fallbackTxt): Elsewhere | null {
  if (!flags || !flags["billing.entitled"]) return null;
  if (flags[ownStoreFlag(platform)]) return null;
  const places = where(txt);
  const key = Object.keys(places).find((k) => flags[k]);
  const url = typeof flags["billing.manage.url"] === "string" ? String(flags["billing.manage.url"]) : "";
  if (!key) return { message: txt("billing.elsewhere.unknown", "This account already has an active subscription.") };
  const w = places[key];
  return {
    message: txt("billing.elsewhere.message", "Your subscription is with {name}. Change or cancel it there — it covers every device.", { name: w.name }),
    ...(url ? { action: { label: w.go, url } } : {}),
  };
}
