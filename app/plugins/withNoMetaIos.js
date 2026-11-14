/**
 * Expo config plugin: NO META AND NO TRACKING PROMPT IN THE IPHONE BINARY.
 *
 * Meta's ads SDK ships on ANDROID only. On the iPhone it was in the binary but
 * switched off, waiting for a server knob to turn it on after approval — which
 * is App Review 2.5.19 ("no hidden, dormant, or undocumented features") and is
 * what the build-79 rejection under 2.1 was about (src/telemetry/meta.ts). The
 * privacy manifest says NSPrivacyTracking false with no domains, the App
 * Privacy answers say "Data Used to Track You: none", and the policy says the
 * iPhone app shows no tracking prompt. All three are now true of the binary.
 *
 * What this takes out of Info.plist, whatever META_APP_ID and META_CLIENT_TOKEN
 * are set to for the build:
 *   - FacebookAppID, FacebookClientToken, FacebookDisplayName and the three
 *     Facebook* switches (react-native-fbsdk-next's withFacebookIOS);
 *   - NSUserTrackingUsageDescription (expo-tracking-transparency's plugin), so
 *     the binary cannot ask to track at all;
 *   - the two Meta SKAdNetwork ids, which only mean anything to an install the
 *     SDK attributes;
 *   - the fb<appid> URL scheme, and the four fb* query schemes the SDK adds.
 * `fb-messenger` STAYS: that one is the app's own, for the share sheet, and has
 * nothing to do with the SDK.
 *
 * ANDROID IS UNTOUCHED. Both Meta plugins stay in app.config.ts, so the Android
 * build keeps the app id string, the manifest meta-data, the AD_ID permission
 * and the advertising id exactly as before. This only edits the iOS plist, and
 * package.json's `expo.autolinking.ios.exclude` plus react-native.config.js
 * keep the two pods and the Meta launch hook out of the iPhone project — so
 * there is no Meta code in the binary to reach, as well as no key.
 *
 * WHY A PLUGIN AND NOT AN `EAS_BUILD_PLATFORM === "ios"` BRANCH: that variable
 * is set by EAS and by nothing else, so a local `expo prebuild -p ios` would
 * walk straight past the branch and put the keys back. Stripping the iOS half
 * after the plugins have run cannot be missed, and needs no environment at all.
 *
 * To put Meta ON the iPhone, it ships in its own reviewed build: delete this
 * plugin and the autolinking exclusions, put an iOS branch with Apple's
 * tracking prompt back in src/telemetry/meta.ts, declare tracking in App
 * Privacy, set NSPrivacyTracking true with Meta's domains in
 * assets/PrivacyInfo.xcprivacy, and change the policy. Never by a server knob
 * after approval.
 *
 * Idempotent: a second prebuild over the same project changes nothing.
 */
const { withInfoPlist } = require("@expo/config-plugins");

/** Every Info.plist key the two Meta plugins write. */
const META_KEYS = [
  "FacebookAppID",
  "FacebookClientToken",
  "FacebookDisplayName",
  "FacebookAutoInitEnabled",
  "FacebookAutoLogAppEventsEnabled",
  "FacebookAdvertiserIDCollectionEnabled",
  "NSUserTrackingUsageDescription",
];

/** Meta's own SKAdNetwork ids (react-native-fbsdk-next's withFacebook). */
const META_SKADNETWORK = ["v9wttpbfk9.skadnetwork", "n38lu8286q.skadnetwork"];

/** The query schemes the SDK adds. `fb-messenger` is the app's own and is not here. */
const META_QUERY_SCHEMES = ["fbapi", "fb-messenger-api", "fbauth2", "fbshareextension"];

module.exports = function withNoMetaIos(config) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    for (const key of META_KEYS) delete plist[key];

    // The fb<appid> scheme the plugin appended. CFBundleURLTypes is the app's
    // WHOLE scheme table (see app.config.ts), so only the fb entry goes and the
    // rest is left exactly as it was.
    if (Array.isArray(plist.CFBundleURLTypes)) {
      plist.CFBundleURLTypes = plist.CFBundleURLTypes.filter(
        (entry) => !(entry?.CFBundleURLSchemes ?? []).some((s) => /^fb\d+$/.test(String(s))),
      );
    }

    if (Array.isArray(plist.LSApplicationQueriesSchemes)) {
      plist.LSApplicationQueriesSchemes = plist.LSApplicationQueriesSchemes.filter(
        (s) => !META_QUERY_SCHEMES.includes(String(s)),
      );
    }

    if (Array.isArray(plist.SKAdNetworkItems)) {
      plist.SKAdNetworkItems = plist.SKAdNetworkItems.filter(
        (item) => !META_SKADNETWORK.includes(String(item?.SKAdNetworkIdentifier ?? "").toLowerCase()),
      );
      // Nothing else adds an id, so an empty array would be a declaration with
      // no network behind it.
      if (!plist.SKAdNetworkItems.length) delete plist.SKAdNetworkItems;
    }
    return cfg;
  });
};
