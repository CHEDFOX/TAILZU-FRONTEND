/**
 * PostHog analytics — env-driven wiring.
 *
 * If POSTHOG_API_KEY is unset (dev / early launch / privacy-first users), every
 * function here is a no-op. With it set, still nothing is sent until the server's
 * "analytics.enabled" flag says this person turned usage statistics on in
 * You › Privacy (App Review 5.1.1(ii)); the default is off. The same binary works whether or not the key is
 * configured, so this is safe to ship in all channels.
 */
import Constants from "expo-constants";
import PostHog from "posthog-react-native";
import { bool, str } from "../sdui/knobs";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const API_KEY = extra.posthogApiKey ?? "";

let client: PostHog | null = null;
let inited = false;
let queue: Array<() => void> = [];

export async function initAnalytics(): Promise<void> {
  if (inited || !API_KEY || !bool("analytics.enabled", false)) return;
  inited = true;
  // The build's host wins when it names one; otherwise the server's.
  const HOST = extra.posthogHost ?? str("analytics.posthogHost", "https://us.i.posthog.com");
  try {
    // posthog-react-native 3+ instantiates directly — the old static
    // initAsync helper is gone. Constructor is sync; the class handles its
    // own persistence + queueing internally.
    client = new PostHog(API_KEY, { host: HOST });
    for (const fn of queue) fn();
    queue = [];
  } catch {
    // silent — analytics never blocks the app
  }
}

function run(fn: (c: PostHog) => void) {
  // Off unless the server says this person turned usage statistics on
  // (You › Privacy; App Review 5.1.1(ii): consent first). Off, nothing is sent
  // and nothing is queued for a client that will never exist.
  if (!API_KEY || !bool("analytics.enabled", false)) return;
  // Turned on after start-up (the flag came with the bootstrap): start now.
  if (!inited) void initAnalytics();
  if (client) fn(client);
  else if (queue.length < 100) queue.push(() => client && fn(client));
}

export function trackEvent(event: string, props?: Record<string, any>): void {
  run((c) => c.capture(event, props ?? {}));
}

export function identifyUser(userId: string, traits?: Record<string, any>): void {
  run((c) => c.identify(userId, traits ?? {}));
}

export function resetAnalytics(): void {
  run((c) => c.reset());
}
