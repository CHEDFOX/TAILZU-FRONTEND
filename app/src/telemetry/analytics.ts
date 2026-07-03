/**
 * PostHog analytics — env-driven wiring.
 *
 * If POSTHOG_API_KEY is unset (dev / early launch / privacy-first users), every
 * function here is a no-op. The same binary works whether or not the key is
 * configured, so this is safe to ship in all channels.
 */
import Constants from "expo-constants";
import PostHog from "posthog-react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const API_KEY = extra.posthogApiKey ?? "";
const HOST = extra.posthogHost ?? "https://us.i.posthog.com";

let client: PostHog | null = null;
let inited = false;
let queue: Array<() => void> = [];

export async function initAnalytics(): Promise<void> {
  if (inited || !API_KEY) return;
  inited = true;
  try {
    client = await PostHog.initAsync(API_KEY, { host: HOST });
    for (const fn of queue) fn();
    queue = [];
  } catch {
    // silent — analytics never blocks the app
  }
}

function run(fn: (c: PostHog) => void) {
  if (!API_KEY) return;
  if (client) fn(client);
  else queue.push(() => client && fn(client));
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
