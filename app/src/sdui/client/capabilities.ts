/** What this build tells the server about itself and the device, on every bootstrap and screen request. */
import { Appearance, Dimensions, I18nManager, PixelRatio, Platform } from "react-native";
import * as Localization from "expo-localization";
import { SDUI_SCHEMA_VERSION } from "../types";
import { getDeviceSignals } from "../../device/signals";
import { CORE_COMPONENTS, CORE_ACTIONS, CORE_TEMPLATES } from "../registry";
import { str } from "../knobs";
import { APP_VERSION } from "./version";
import { isStreamAvailable } from "../../../modules/tulmi-stream";
import { binaryFeatures } from "../../device/binary";
import { featureCaps } from "../../device/binaryCore";
import { looksReport } from "../../botTiles/looks";

/**
 * Which JS bundle is actually running.
 *
 * "embedded" means the binary's own bundle with no update applied; otherwise
 * the first eight characters of the update the device is running. It rides
 * along on every request, so the server log answers a question that previously
 * could only be guessed at by looking at the screen.
 */
/**
 * The previous launch's breadcrumb, read once at startup and held here so
 * buildCapabilities stays synchronous. Diagnostic only.
 */
export const LAST_BOOT_NOTE = { value: "unread" };

export function runningBundle(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require("expo-updates");
    if (Updates.isEmbeddedLaunch) return "embedded";
    const id = String(Updates.updateId ?? "");
    return id ? id.slice(0, 8) : "embedded";
  } catch {
    return "unknown";
  }
}

/**
 * What this build draws and does, as the registry says, less what this binary cannot back: live words need the stream
 * module (a store build has it, Expo Go does not), so VoiceLive is said only when it is there. Plus what only the binary can
 * promise (device/binaryCore.ts: PushTimeSensitive, GlanceSteps), said only when the native bridge says so, because an update
 * also reaches binaries built before them.
 */
function declared(): readonly string[] {
  const js = isStreamAvailable() ? CORE_COMPONENTS : CORE_COMPONENTS.filter((n) => n !== "VoiceLive");
  return [...js, ...featureCaps(binaryFeatures())];
}

export function buildCapabilities() {
  const { width, height } = Dimensions.get("window");
  const colorScheme: "light" | "dark" = Appearance.getColorScheme() === "dark" ? "dark" : "light";
  const locale = Localization.getLocales?.()[0]?.languageTag ?? str("app.defaultLocale", "en-US");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    bundle: runningBundle(),
    lastBoot: LAST_BOOT_NOTE.value,
    platform: (Platform.OS === "ios" ? "ios" : "android") as "ios" | "android",
    // THIS BUNDLE CAN COME BACK FROM GOOGLE. It carries the web path — Google
    // by way of Supabase's page, returning on tulmi:// — so the server may
    // draw the Google button for it. The store binary's own bundle does not
    // say this, and the server leaves the button out of the screen it is
    // handed, because on Android that bundle cannot come back at all. Not a
    // flag to flip: a constant, true of every bundle that has this line.
    googleWeb: true,
    components: declared(),
    // The bots' catalog as this phone really has it (botTiles/looks.ts): its version and format, whether it
    // compiled, and any scene that went wrong or was slowed. No person data; a few hundred bytes at most.
    looks: looksReport(),
    actions: CORE_ACTIONS,
    templates: CORE_TEMPLATES,
    device: {
      width: Math.round(width),
      height: Math.round(height),
      scale: PixelRatio.get(),
      colorScheme,
      locale,
      // The renderer disables non-essential motion when the OS asks (a11y).
      // We don't currently plumb AccessibilityInfo through this synchronous
      // capability builder; the server-side default is "assume off".
      reduceMotion: false,
      rtl: I18nManager.isRTL,
      // WHAT THIS PHONE ALREADY HAS. The server routes on these: a permission
      // belongs to the device, not the account, so someone signing in on a
      // phone that already granted both has no use for the steps that ask.
      //
      // A bridge that did not answer reads as NOT ready — the conservative
      // direction. Showing a setup step that turns out to be unnecessary
      // costs a tap; skipping one that was necessary leaves the keyboard
      // never enabled, which is the whole product.
      micGranted: getDeviceSignals().micGranted,
      keyboardReady: getDeviceSignals().keyboard?.fullAccess ?? false,
      keyboardEnabled: getDeviceSignals().keyboard?.enabled ?? false,
    },
  };
}
