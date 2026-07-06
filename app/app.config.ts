import { ExpoConfig } from "expo/config";

/**
 * Expo app config for Tulmi (Android + iOS from one codebase).
 *
 * DESIGN NOTE: This build is intentionally "kitchen-sink" — every plugin,
 * permission string, native module, and entitlement we might plausibly want
 * within 12 months is baked in NOW. The goal is that after this build ships,
 * new features arrive as backend JSON pushes or JS-only OTAs, without another
 * App Store review. Extra binary weight is a few MB and worth it.
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
    // Universal Links: taps on tailzu.space URLs open the app directly. Backing
    // JSON must be hosted at https://tailzu.space/.well-known/apple-app-site-association.
    associatedDomains: ["applinks:tailzu.space", "applinks:app.tailzu.space"],
    infoPlist: {
      // Permission strings — Apple rejects any app whose binary CAN request a
      // permission but doesn't ship a Usage Description. Bake all of them in
      // so backend-driven features can call the corresponding permission
      // APIs without a rebuild.
      NSMicrophoneUsageDescription:
        "Tulmi uses the microphone to turn your speech into clean text.",
      NSCameraUsageDescription:
        "Tulmi uses the camera to scan text and QR codes, and for optional video features.",
      NSPhotoLibraryUsageDescription:
        "Tulmi reads photos when you attach them to a message or import them.",
      NSPhotoLibraryAddUsageDescription:
        "Tulmi saves outputs (audio, transcripts) to your Photos when you tap Save.",
      NSSpeechRecognitionUsageDescription:
        "Tulmi uses on-device speech recognition for faster dictation.",
      NSFaceIDUsageDescription:
        "Tulmi uses Face ID to keep your account and drafts private.",
      NSContactsUsageDescription:
        "Tulmi reads contacts when you attach or mention people in a draft.",
      NSCalendarsUsageDescription:
        "Tulmi adds events to your calendar when you dictate a meeting.",
      NSRemindersUsageDescription:
        "Tulmi creates reminders from voice notes when you ask.",
      NSAppleMusicUsageDescription:
        "Tulmi lets you attach audio to messages from your library.",
      NSLocationWhenInUseUsageDescription:
        "Tulmi uses your location only when you dictate a check-in or location-tagged note.",
      NSUserTrackingUsageDescription:
        "Turning this on lets Tulmi personalize suggestions to how you write.",
      NSMotionUsageDescription:
        "Tulmi uses motion sensors for tap-to-record shortcuts.",
      NSBluetoothAlwaysUsageDescription:
        "Tulmi uses Bluetooth to connect to your headset for voice input.",
      NSLocalNetworkUsageDescription:
        "Tulmi uses your local network to sync with nearby devices.",
      // Enable background audio so dictation can continue if the app briefly
      // loses foreground focus (call, notification).
      UIBackgroundModes: ["audio", "remote-notification", "fetch"],
      // Detect installed apps so share targets can prefer WhatsApp/Telegram/etc.
      LSApplicationQueriesSchemes: [
        "whatsapp",
        "tg",
        "telegram",
        "instagram",
        "instagram-stories",
        "twitter",
        "x",
        "discord",
        "slack",
        "linkedin",
        "sms",
        "tel",
        "mailto",
        "fb-messenger",
        "snapchat",
        "reddit",
        "signal",
        "line",
        "wechat",
        "kakaotalk",
      ],
      ITSAppUsesNonExemptEncryption: false,
    },
    // Shared container so the keyboard extension can read the app's backend URL
    // + the user's token (written by the tulmi-bridge native module).
    entitlements: {
      "com.apple.security.application-groups": ["group.com.tulmi.app"],
      "com.apple.developer.applesignin": ["Default"],
      "aps-environment": "production",
      "com.apple.developer.associated-domains": [
        "applinks:tailzu.space",
        "applinks:app.tailzu.space",
      ],
    },
  },
  android: {
    package: "com.tulmi.app",
    // Every permission we might want in the next year. Runtime prompts are
    // still gated by user consent, but they cannot be REQUESTED at all
    // without being declared in the manifest.
    permissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.INTERNET",
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.VIBRATE",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.READ_CONTACTS",
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "com.android.vending.BILLING",
      "com.google.android.gms.permission.AD_ID",
    ],
    adaptiveIcon: { foregroundImage: "./assets/icon.png", backgroundColor: "#E8A23C" },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: "tailzu.space" },
          { scheme: "https", host: "app.tailzu.space" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    blockedPermissions: [],
  },
  // Config plugins — ONLY the packages that ship an `app.plugin.js` and actually
  // need to mutate native config (permissions strings, entitlements, manifest
  // entries, splash config). Packages like expo-linking / expo-web-browser /
  // expo-secure-store / expo-crypto / expo-clipboard DON'T need entries here
  // — you just `import` them and they work. Listing them causes Expo to
  // require() their main entry as if it were a plugin, which throws on
  // "Unexpected token 'export'".
  plugins: [
    "expo-audio",
    "expo-apple-authentication",
    "expo-camera",
    "expo-image-picker",
    "expo-media-library",
    "expo-document-picker",
    "expo-local-authentication",
    "expo-notifications",
    "expo-tracking-transparency",
    "expo-contacts",
    "expo-calendar",
    "expo-video",
    "expo-splash-screen",
    // Sentry's Expo plugin injects a "Upload Debug Symbols" build phase that
    // runs sentry-cli. Without SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
    // (i.e. every build until you configure Sentry), sentry-cli hard-fails and
    // takes the whole build down. `disableAutoUpload: true` skips the upload
    // step; the runtime SDK still reports errors normally. Once you have a
    // Sentry project, flip this back OFF and add the three env vars.
    ["@sentry/react-native/expo", { disableAutoUpload: true }],
    "./modules/tulmi-keyboard/plugin/withTulmiKeyboard",
    "@bacons/apple-targets",
    // Alternate app icons — user can switch between the default icon.png and
    // any of these variants at runtime via the setAppIcon SDUI action.
    // Names must be PascalCase (iOS convention). Add more entries here whenever
    // a new icon file lands under assets/icons/.
    [
      "expo-alternate-app-icons",
      [
        {
          name: "IconAlt",
          ios: "./assets/icons/icon2.png",
          android: {
            foregroundImage: "./assets/icons/icon2.png",
            backgroundColor: "#E8A23C",
          },
        },
      ],
    ],
  ],
  extra: {
    eas: { projectId: "fd5ee89f-3326-473c-a194-61c60f32bb1e" },
    // Third-party keys read by the SDKs at runtime. Any of these can be
    // populated in EAS environment variables without a rebuild — the SDKs
    // gracefully no-op when unset, so the same binary works with or without.
    sentryDsn: process.env.SENTRY_DSN ?? "",
    posthogApiKey: process.env.POSTHOG_API_KEY ?? "",
    posthogHost: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    revenueCatIosKey: process.env.REVENUECAT_IOS_KEY ?? "",
    revenueCatAndroidKey: process.env.REVENUECAT_ANDROID_KEY ?? "",
  },
};

export default config;
