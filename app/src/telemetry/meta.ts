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
 * Off in four ways, each a no-op for everything below:
 *   - the phone is an iPhone (see the next paragraph: there is no Meta in that binary at all);
 *   - the build has no META_APP_ID (and so no SDK configured natively);
 *   - the server's knob ads.meta.enabled is false;
 *   - the native module is missing (an older binary running this bundle).
 *
 * ANDROID ONLY, AND NOT BY A KNOB. The iPhone build carries no Meta SDK and no tracking prompt at all
 * (plugins/withNoMetaIos.js, package.json's expo.autolinking.ios.exclude): no FacebookAppID, no
 * NSUserTrackingUsageDescription, no App Tracking Transparency code. A binary that could ask to track and never asked
 * is App Review 2.5.19, and is what the build-79 rejection under 2.1 was about. So this returns at once on iOS, where
 * there is nothing to start, and no server knob can change that — ads.meta.ios.enabled is gone. Putting Meta on the
 * iPhone means its own reviewed build, with App Privacy, the privacy manifest and the policy changed in the same
 * submission.
 *
 * The server's knob is in the bootstrap, which is not in hand when the app mounts: so initMeta is tried again when a
 * bootstrap arrives (SduiApp); the first try that finds ads.meta.enabled on starts the SDK (Android only).
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
/** Settles once the SDK is started: true when it is, false when it could not be. */
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

/** Start the SDK, which logs the install and app opens on its own. ANDROID ONLY: the iPhone build has no Meta in it. */
export function initMeta(): void {
  // The iPhone leaves FIRST, before the knob is even read: there is no SDK and no tracking prompt in that binary, so
  // there is nothing a server could switch on. Keeping an iOS branch here would be the dormant feature 2.5.19 names.
  if (Platform.OS === "ios") return;
  if (started || !APP_ID || !bool("ads.meta.enabled", true)) return;
  const m = load();
  if (!m) return;
  started = true;
  ready = (async () => {
    try {
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
  // Only after the SDK has really started, so nothing is logged against a build that has none.
  void after.then((ok) => { if (ok && sdk) logNow(sdk, events as MetaEvent[]); });
}

function logNow(sdk: Sdk, events: MetaEvent[]): void {
  for (const raw of events) {
    const name = typeof raw?.name === "string" ? raw.name.slice(0, 40) : "";
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const params = raw.params && typeof raw.params === "object" ? raw.params : {};
    try {
      // Android's logger only. There is no AEM reporter call here any more: Aggregated Event Measurement is Apple's
      // aggregate side of tracking, and nothing on the iPhone ever gets this far (initMeta returns above).
      sdk.AppEventsLogger.logEvent(name, params);
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
