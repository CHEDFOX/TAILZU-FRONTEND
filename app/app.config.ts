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
  // OTA updates (EAS Update). The fingerprint policy ties each update to the
  // native build's fingerprint, so a JS-only OTA can never land on an
  // incompatible binary (e.g. after a keyboard/permission/native change).
  // `eas update:configure` fills in `updates.url` + the EAS projectId.
  runtimeVersion: { policy: "fingerprint" },
  ios: {
    bundleIdentifier: "com.tulmi.app",
    supportsTablet: false,
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Tulmi uses the microphone to turn your speech into clean text.",
    },
  },
  android: {
    package: "com.tulmi.app",
    permissions: ["android.permission.RECORD_AUDIO", "android.permission.INTERNET"],
  },
  // expo-audio provides mic-permission config; usesCleartextTraffic is enabled in
  // the dev build so the app can reach a plain-HTTP backend during testing.
  // The keyboard plugin injects the native Android IME (Kotlin) at build time.
  // @bacons/apple-targets adds the iOS keyboard extension (see targets/keyboard).
  plugins: [
    "expo-audio",
    "./modules/tulmi-keyboard/plugin/withTulmiKeyboard",
    "@bacons/apple-targets",
  ],
};

export default config;
