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
 * iPhone: on when the server says (ads.meta.ios.enabled). Apple's tracking prompt comes first; Meta gets the
 * advertising id only from those who allow it, and counts the rest in aggregate (SKAdNetwork and Aggregated Event
 * Measurement), which is why each event is also given to the AEM reporter there. Nothing reaches Meta before the person
 * has answered the prompt: the events wait for the SDK to be started after it (`ready`).
 *
 * The server's knob is in the bootstrap, which is not in hand when the app mounts: so initMeta is tried again when a
 * bootstrap arrives (SduiApp), and the first try that finds the knob on is the one that asks. A build that tried only
 * at mount never asked at all (App Review 2.1, build 79).
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
/** Settles once the SDK is started, after Apple's prompt on iPhone: true when it is, false when it could not be. */
let ready: Promise<boolean> | null = null;

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

/** Start the SDK, which logs the install and app opens on its own. On iPhone, only when the server says, after the prompt. */
export function initMeta(): void {
  if (started || !APP_ID || !bool("ads.meta.enabled", true)) return;
  if (Platform.OS === "ios" && !bool("ads.meta.ios.enabled", false)) return;
  const m = load();
  if (!m) return;
  started = true;
  ready = (async () => {
    try {
      if (Platform.OS === "ios") {
        // Apple's prompt, once; a later launch reads the answer without asking again.
        let allowed = false;
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const att = require("expo-tracking-transparency") as typeof import("expo-tracking-transparency");
          allowed = (await att.requestTrackingPermissionsAsync()).granted;
        } catch {
          allowed = false;   // a binary without the module: never tracked
        }
        await m.Settings.setAdvertiserTrackingEnabled(allowed);
      }
      m.Settings.initializeSDK();
      return true;
    } catch {
      started = false;   // never blocks the app; tried again on the next bootstrap or launch
      ready = null;
      return false;
    }
  })();
}

/** Log what the server handed over. Each comes once; nothing is retried. */
export function logMetaEvents(events: unknown): void {
  if (!Array.isArray(events) || !events.length) return;
  initMeta();
  const after = ready;
  if (!after) return;
  // After the SDK has started, and so after the person has answered Apple's prompt: never before.
  void after.then((ok) => { if (ok && sdk) logNow(sdk, events as MetaEvent[]); });
}

function logNow(sdk: Sdk, events: MetaEvent[]): void {
  for (const raw of events) {
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
