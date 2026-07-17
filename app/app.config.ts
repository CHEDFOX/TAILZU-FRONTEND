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
// EAS project binding. Because this is a DYNAMIC config, the CLI cannot write
// the projectId for you — set it HERE after linking a project under your Expo
// account. Leave it EMPTY and run `eas init` to CREATE a fresh project (it will
// print the new id); then either paste that id below or export EAS_PROJECT_ID.
// The OTA update URL is derived from it, so you only ever set the id in one place.
const EAS_PROJECT_ID =
  process.env.EAS_PROJECT_ID ?? "7b0d6b75-e469-4e42-b8de-eb6c0453f72c";

const config: ExpoConfig = {
  // User-visible name (under the home-screen icon + in Settings → General →
  // iPhone Storage). `slug` and bundleIdentifier stay as "tulmi" because
  // both are baked into the EAS project + App Groups + Keychain groups +
  // Supabase project — renaming those would rebuild every entitlement and
  // break the shared bearer token between app + keyboard.
  name: "Tailzu",
  slug: "tulmi",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "tulmi",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  // EAS account that owns the build/project (must match the projectId below and
  // whoever `eas whoami` reports). Change this + EAS_PROJECT_ID together to move
  // the app to a different Expo account.
  owner: "xooteq",
  // OTA updates (EAS Update). The fingerprint policy ties each update to the
  // native build's fingerprint, so a JS-only OTA can never land on an
  // incompatible binary (e.g. after a keyboard/permission/native change).
  runtimeVersion: { policy: "fingerprint" },
  updates: EAS_PROJECT_ID
    ? { url: `https://u.expo.dev/${EAS_PROJECT_ID}` }
    : {},
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
        "Tailzu records audio only while you hold the microphone button, converts it to text, and lets you insert the cleaned-up text into your current message.",
      NSCameraUsageDescription:
        "Tailzu uses the camera when you tap the scan button so it can read printed text or a QR code and turn it into a message.",
      NSPhotoLibraryUsageDescription:
        "Tailzu opens your photo library only when you tap Attach so you can pick an image to include with a message.",
      NSPhotoLibraryAddUsageDescription:
        "Tailzu saves an image of your result to Photos only when you tap Save.",
      NSSpeechRecognitionUsageDescription:
        "Tailzu uses Apple's on-device speech recognition to convert your dictation to text faster when you enable the on-device mode in Settings.",
      NSFaceIDUsageDescription:
        "Tailzu uses Face ID to unlock private drafts and to keep your account signed in on this device.",
      NSContactsUsageDescription:
        "Tailzu reads your contacts only when you use the @mention feature so it can suggest the right person.",
      NSCalendarsUsageDescription:
        "Tailzu writes an event to your calendar only when you tap Add to Calendar on a dictated meeting.",
      NSRemindersUsageDescription:
        "Tailzu writes a reminder only when you tap Add Reminder on a dictated note.",
      NSAppleMusicUsageDescription:
        "Tailzu reads your audio library only when you tap Attach Audio so you can include a clip in a message.",
      NSLocationWhenInUseUsageDescription:
        "Tailzu reads your location only when you dictate a location-tagged note (\"send my location\") so it can attach the correct place to the message.",
      NSUserTrackingUsageDescription:
        "This lets Tailzu personalize writing suggestions to your style. Nothing is shared with third-party advertisers.",
      NSMotionUsageDescription:
        "Tailzu uses motion to detect the raise-to-record shortcut when you enable it in Settings.",
      NSBluetoothAlwaysUsageDescription:
        "Tailzu uses Bluetooth only to connect to a paired headset for hands-free dictation.",
      NSLocalNetworkUsageDescription:
        "Tailzu uses the local network only when you enable Nearby Sync in Settings to keep drafts consistent across your devices on the same Wi-Fi.",
      // Background audio — REQUIRED for the "Flow Session" mic architecture:
      // the keyboard extension cannot hold the microphone (iOS blocks recording
      // in extensions), so the main app keeps a live AVAudioSession alive in the
      // background (FlowSessionManager) after the user swipes back to their app,
      // and the keyboard drives start/stop of each dictation via Darwin
      // notifications. This is the same mechanism Wispr Flow uses. The backing
      // code ships (FlowSessionManager.swift), so this declaration is honest
      // per Guideline 2.5.4.
      UIBackgroundModes: ["audio"],
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
      // Shared Keychain group so the main app and the Custom Keyboard
      // extension can read/write the same encrypted-at-rest bearer token.
      // Apple substitutes $(AppIdentifierPrefix) with the team ID prefix at
      // runtime; the same group is declared on the keyboard target
      // (targets/keyboard/expo-target.config.js).
      "keychain-access-groups": [
        "$(AppIdentifierPrefix)com.tulmi.app.shared",
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
      // FOREGROUND_SERVICE_MICROPHONE removed: the keyboard records inline as an
      // InputMethodService — there is no mic-type foreground service in the
      // binary, and Play policy rejects declaring an FGS-type permission with no
      // matching service + use-declaration. Re-add (with the declaration) only
      // if a real foreground mic service ships.
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
  // Config plugins — the packages that ship an `app.plugin.js` and mutate
  // native config (permissions strings, entitlements, manifest entries,
  // splash config, plus `expo install --fix`'s doctor-style validation).
  // Packages like expo-linking / expo-web-browser / expo-secure-store /
  // expo-crypto / expo-clipboard DON'T need entries — you just `import`
  // them and they work. Listing one that doesn't ship a plugin causes
  // Expo to require() its main entry as if it were a plugin, which throws
  // on "Unexpected token 'export'".
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
    // Splash / launch screen. Shows the Tailzu mark centered on the app's
    // dark ground. `resizeMode: "contain"` keeps the mark crisp on every
    // device size. Light-mode users see the same treatment — we're a
    // dark-first app.
    //
    // Replace assets/splash.png with a 1242×1242 (or higher) PNG when the
    // real brand splash is ready; until then, tailzu-mark.png works.
    [
      "expo-splash-screen",
      {
        // Full-bleed splash — the 750×1333 near-solid-black source scales
        // cleanly with `cover` because uniform regions don't show upscale
        // artifacts. `backgroundColor` matches the top-of-image tone so any
        // aspect-ratio letterboxing blends invisibly.
        backgroundColor: "#000000",
        image: "./assets/splash.png",
        resizeMode: "cover",
        dark: {
          backgroundColor: "#000000",
          image: "./assets/splash.png",
          resizeMode: "cover",
        },
      },
    ],
    // expo-sharing ships an app.plugin.js in SDK 56.0.15+; expo install --fix
    // fails the whole run when it isn't declared here even though the module
    // works fine without any native config to add.
    "expo-sharing",
    // Sentry's Expo plugin injects a "Upload Debug Symbols" build phase that
    // runs sentry-cli. Without SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
    // (i.e. every build until you configure Sentry), sentry-cli hard-fails and
    // takes the whole build down. `disableAutoUpload: true` skips the upload
    // step; the runtime SDK still reports errors normally. Once you have a
    // Sentry project, flip this back OFF and add the three env vars.
    ["@sentry/react-native/expo", { disableAutoUpload: true }],
    "./modules/tulmi-keyboard/plugin/withTulmiKeyboard",
    "./modules/withPrivacyManifest",
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
        {
          name: "IconAlt2",
          ios: "./assets/icons/icon3.png",
          android: {
            foregroundImage: "./assets/icons/icon3.png",
            backgroundColor: "#E8A23C",
          },
        },
      ],
    ],
  ],
  extra: {
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
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
