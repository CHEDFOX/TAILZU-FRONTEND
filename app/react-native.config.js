/**
 * The Android health build switch, native half (perms/SPEC.md 6.3).
 *
 * TULMI_ANDROID_HEALTH = "on" puts Health Connect in the Android build:
 * react-native-health-connect is linked, app.config.ts adds READ_STEPS and
 * READ_EXERCISE and raises minSdkVersion to 26 (Health Connect's floor, which
 * drops Android 7), and modules/tulmi-perms' plugin declares the rationale
 * screen. Anything else — the default, and what the release candidate is built
 * with unless Play has approved the Health Connect form by then — leaves the
 * package installed but UNLINKED, so no Health Connect class is in the binary,
 * the app's minimum stays where it is, and the JS check declares no Health1 on
 * that build. One tree, one package-lock.json, one lock file.
 *
 * This file is only half the switch: the library also has an Expo module
 * (android-expo, the permission delegate) that Expo autolinking finds on its
 * own and that declares `implementation project(':react-native-health-connect')`.
 * modules/tulmi-perms/plugin/withTulmiPerms.js drops that half in the same
 * builds, through expoAutolinking.exclude in settings.gradle. Change one,
 * change the other.
 */
const androidHealth = (process.env.TULMI_ANDROID_HEALTH ?? "").trim().toLowerCase() === "on";

/**
 * META IS AN ANDROID-ONLY SDK (plugins/withNoMetaIos.js).
 *
 * react-native-fbsdk-next has a podspec, so React Native's own autolinking
 * would put it in the iPhone Podfile even with the Expo half excluded. This is
 * that half of the switch; package.json's `expo.autolinking.ios.exclude` is the
 * other, for the Expo module (FacebookAppDelegate, which otherwise runs Meta's
 * launch hook on every launch whatever the server knob says) and for
 * expo-tracking-transparency. Change one, change the other.
 *
 * ANDROID IS UNTOUCHED: the package stays installed and linked there, and
 * src/telemetry/meta.ts requires it lazily, so neither phone's bundle can crash
 * on a module that is not in its binary.
 */
module.exports = {
  dependencies: {
    "react-native-fbsdk-next": { platforms: { ios: null } },
    ...(androidHealth ? {} : { "react-native-health-connect": { platforms: { android: null } } }),
  },
};
