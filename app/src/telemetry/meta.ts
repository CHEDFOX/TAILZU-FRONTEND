/**
 * Meta (Facebook/Instagram ads) — env-driven, like analytics.ts.
 *
 * What the app does here is small on purpose. Meta's SDK, once started, logs
 * the install and each open by itself; that is what lets an ad be credited
 * with the install it brought. Everything else is the server's call: the
 * bootstrap carries `metaEvents` — the account's milestones (signed up,
 * keyboard switched on, first dictation), each handed out once, ever — and
 * this logs them. Which milestones exist, and when one counts, is decided in
 * the backend (src/ads/meta.ts), so changing it needs no release.
 *
 * Off in three ways, each a no-op for everything below:
 *   - the build has no META_APP_ID (and so no SDK configured natively);
 *   - the server's knob ads.meta.enabled is false;
 *   - the native module is missing (an older binary running this bundle).
 *
 * iPhone: there is no tracking prompt. Without one Meta counts iPhone installs
 * and events in aggregate (SKAdNetwork and Aggregated Event Measurement),
 * which is why each event is also given to the AEM reporter there.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";
import { bool } from "../sdui/knobs";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const APP_ID = extra.metaAppId ?? "";

export interface MetaEvent {
  name: string;
  params?: Record<string, string | number>;
}

type Sdk = typeof import("react-native-fbsdk-next");
let sdk: Sdk | null = null;
let started = false;

function load(): Sdk | null {
  if (sdk) return sdk;
  try {
    // Required lazily: a bundle that reaches a binary built before the SDK
    // was added must not crash on an import of a module that is not there.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sdk = require("react-native-fbsdk-next") as Sdk;
  } catch {
    sdk = null;
  }
  return sdk;
}

/** Start the SDK, which logs the install and app opens on its own. */
export function initMeta(): void {
  if (started || !APP_ID || !bool("ads.meta.enabled", true)) return;
  const m = load();
  if (!m) return;
  try {
    m.Settings.initializeSDK();
    started = true;
  } catch {
    // never blocks the app
  }
}

/** Log what the server handed over. Each comes once; nothing is retried. */
export function logMetaEvents(events: unknown): void {
  if (!Array.isArray(events) || !events.length) return;
  initMeta();
  if (!started || !sdk) return;
  for (const raw of events as MetaEvent[]) {
    const name = typeof raw?.name === "string" ? raw.name.slice(0, 40) : "";
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const params = raw.params && typeof raw.params === "object" ? raw.params : {};
    try {
      sdk.AppEventsLogger.logEvent(name, params);
      if (Platform.OS === "ios") sdk.AEMReporterIOS.logAEMEvent(name, 0, undefined, params);
    } catch {
      // one bad event never stops the rest
    }
  }
  try {
    sdk.AppEventsLogger.flush();
  } catch {
    // flushed with the SDK's next batch instead
  }
}
