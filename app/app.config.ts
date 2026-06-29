import { ExpoConfig } from "expo/config";

/**
 * Expo app config for Tulmi (Android + iOS from one codebase).
 * The native keyboard (Android IME / iOS keyboard extension) is added on top of
 * this via a config plugin + native target in a later step.
 */
const config: ExpoConfig = {
  name: "Tulmi",
  slug: "tulmi",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "tulmi",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  owner: "chadfox",
  // OTA updates (EAS Update). The fingerprint policy ties each update to the
  // native build's fingerprint, so a JS-only OTA can never land on an
  // incompatible binary (e.g. after a keyboard/permission/native change).
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: "https://u.expo.dev/fd5ee89f-3326-473c-a194-61c60f32bb1e",
  },
  ios: {
    bundleIdentifier: "com.tulmi.app",
    appleTeamId: "6552H8HYA4",
    supportsTablet: false,
    // Tulmi only uses standard HTTPS — exempt from export-compliance. Setting
    // this clears the "encryption" question that otherwise blocks every
    // TestFlight build until answered by hand in App Store Connect.
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Tulmi uses the microphone to turn your speech into clean text.",
    },
    // Shared container so the keyboard extension can read the app's backend URL
    // + the user's token (written by the tulmi-bridge native module).
    entitlements: {
      "com.apple.security.application-groups": ["group.com.tulmi.app"],
      "com.apple.developer.applesignin": ["Default"],
    },
  },
  android: {
    package: "com.tulmi.app",
    permissions: ["android.permission.RECORD_AUDIO", "android.permission.INTERNET"],
    adaptiveIcon: { foregroundImage: "./assets/icon.png", backgroundColor: "#E8A23C" },
  },
  // expo-audio provides mic-permission config; usesCleartextTraffic is enabled in
  // the dev build so the app can reach a plain-HTTP backend during testing.
  // The keyboard plugin injects the native Android IME (Kotlin) at build time.
  // @bacons/apple-targets adds the iOS keyboard extension (see targets/keyboard).
  plugins: [
    "expo-audio",
    "expo-apple-authentication",
    "./modules/tulmi-keyboard/plugin/withTulmiKeyboard",
    "@bacons/apple-targets",
  ],
  extra: {
    eas: { projectId: "fd5ee89f-3326-473c-a194-61c60f32bb1e" },
  },
};

export default config;
