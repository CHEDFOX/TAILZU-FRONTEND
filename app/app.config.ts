import { ExpoConfig } from "expo/config";
// Config-time only (Node); the app's own TypeScript has no Node types.
const { existsSync } = require("fs") as { existsSync(path: string): boolean };

// Firebase for Android push: without it an Android phone never gets a push
// token, so the server's notifications cannot reach it. EAS builds read it
// from the GOOGLE_SERVICES_JSON file variable; a local build from
// app/google-services.json. Neither present: the build is unchanged.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ||
  (existsSync("./google-services.json") ? "./google-services.json" : undefined);

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

// META (Facebook/Instagram ads). The app id and client token come from the
// Meta app at developers.facebook.com (Settings → Basic, and Settings →
// Advanced → Client token); both are embedded in the app and neither is a
// secret, but they are per-build EAS environment variables like the others.
// Without both, the SDK is not configured natively and src/telemetry/meta.ts
// does nothing — the same bundle runs on either binary.
const META_APP_ID = (process.env.META_APP_ID ?? "").trim();
const META_CLIENT_TOKEN = (process.env.META_CLIENT_TOKEN ?? "").trim();
const metaPlugin: [string, Record<string, unknown>][] =
  /^\d+$/.test(META_APP_ID) && META_CLIENT_TOKEN
    ? [[
        "react-native-fbsdk-next",
        {
          appID: META_APP_ID,
          clientToken: META_CLIENT_TOKEN,
          displayName: "X0 Bot",
          scheme: `fb${META_APP_ID}`,
          // Started from JavaScript (initMeta), so the server's knob
          // ads.meta.enabled can keep it off without a release.
          isAutoInitEnabled: false,
          // Installs and app opens, logged by the SDK itself once started.
          autoLogAppEventsEnabled: true,
          // Android's advertising id, which is what credits an install to an
          // ad there. iPhone's needs the tracking prompt, and gets none.
          advertiserIDCollectionEnabled: true,
          // iPhone: off until the server turns it on (ads.meta.ios.enabled); then Apple's tracking prompt comes first
          // (expo-tracking-transparency below, src/telemetry/meta.ts), and Meta measures in aggregate for those who
          // decline (SKAdNetwork ids are added by the plugin). The prompt's words are expo-tracking-transparency's.
          iosUserTrackingPermission: false,
        },
      ], [
        "expo-tracking-transparency",
        { userTrackingPermission: "X0 Bot uses this to see which ads brought you here. Turn it off any time in Settings." },
      ]]
    : [];

const config: ExpoConfig = {
  // User-visible name (under the home-screen icon + in Settings → General →
  // iPhone Storage). `slug` and bundleIdentifier stay as "tulmi" because
  // both are baked into the EAS project + App Groups + Keychain groups +
  // Supabase project — renaming those would rebuild every entitlement and
  // break the shared bearer token between app + keyboard.
  name: "X0 Bot",
  slug: "tulmi",
  // CFBundleShortVersionString. Apple closes a version's "train" once a build
  // on it is approved, and refuses any later build that is not HIGHER — so a
  // resubmission needs the marketing version bumped, not just the build number
  // (that is what `appVersionSource: remote` + autoIncrement already do).
  //
  // HIGHER THAN THE STORE'S, not this file's last. The App Store has carried
  // 8.6 since 10 Oct 2026 (a version set outside this repo), so 1.0.2 could
  // never be uploaded; 8.7 is on the store now too. The iOS release job checks
  // this against the live store version before it builds (tools/ci/ios-version.mjs).
  version: "8.8",
  orientation: "portrait",
  // TWO SCHEMES, and the second one is why Google sign-in returns to the app.
  //
  // expo-auth-session's Google provider sends the OAuth redirect to
  // `${applicationId}:/oauthredirect` on a native build — com.tulmi.app:/…
  // on both platforms. That scheme has to be CLAIMED by the app or the
  // browser tab has nowhere to go after consent: on Android the Custom Tab
  // simply stayed on Google, which is what "sign in takes me to google.com"
  // was. Google accepts the package name as a custom scheme for an Android
  // client and the bundle id for an iOS one, so this is the right scheme to
  // claim rather than a workaround. Expo turns each entry into an intent
  // filter on Android and a CFBundleURLTypes entry on iOS — but see the iOS
  // block below, which sets that key explicitly and must list it too.
  scheme: ["tulmi", "com.tulmi.app"],
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  // EAS account that owns the build/project (must match the projectId below and
  // whoever `eas whoami` reports). Change this + EAS_PROJECT_ID together to move
  // the app to a different Expo account.
  owner: "xooteq",
  // OTA updates (EAS Update). The fingerprint policy ties each update to the
  // native build's fingerprint, so a JS-only OTA can never land on an
  // incompatible binary (e.g. after a keyboard/permission/native change).
  // A FIXED STRING, not a policy.
  //
  // The fingerprint policy hashes the native project — and it hashes it on
  // whichever machine runs the command. `eas build` computes it on EAS's
  // Linux/macOS builders; `eas update` computes it on the publisher's laptop.
  // The same commit produced d6ee7792 on the builder, 6d2ada59 on Windows and
  // f6856889 on Linux, so every update published from the laptop was served to
  // a runtime no build has ever reported. It uploaded successfully and reached
  // nobody, which is indistinguishable from nothing happening.
  //
  // This exact value is what build 55 — the binary on the device — reports.
  // Pinning it means updates reach that build without another round through
  // the store, and every future build reports the same thing, so one string
  // keeps them all on the same update stream.
  //
  // The obligation it carries: nothing now stops JS that assumes new native
  // code from reaching a build that lacks it. CHANGE THIS STRING whenever a
  // release adds native capability — a module, a permission, keyboard-extension
  // work — so older builds stop accepting updates written for the newer one.
  // Any new value works; it only has to differ.
  //
  // NOT bumped for 1.0.1, on purpose. That release adds a URL scheme, which
  // is native — but the JavaScript CHECKS for the scheme rather than assuming
  // it (AuthGateScreen, nativeReturns), so an update written for 1.0.1 is safe
  // on the build before it. And that older build needs this very update: it
  // is the one that cannot come back from Google without the web bridge the
  // update carries. Bumping here would have cut it off from its own fix.
  //
  // BUMPED for the release after 1.0.1. It adds native capability on every
  // side — three bridge functions and two new signatures, the widget
  // extension with its Live Activity and Control, and the reworked keyboards
  // — so an update written for it must never reach a binary without them.
  //
  // BUMPED again (Oct 2026) for the opposite reason: this release TAKES
  // native modules out (expo-calendar, expo-contacts). An update published
  // for the binary before it still imports them, and on a binary without
  // them that import throws at launch, so the two must not share a runtime.
  //
  // BUMPED for 8.8: its splash is white (the Bots app's paper) where 8.7's is
  // cream, and its launch curtain is drawn on white. An update for 8.8 on an
  // 8.7 binary would lay a white curtain over a cream splash, a visible flash.
  runtimeVersion: "tailzu-2026-10-x0-88",
  // EVERY FIELD EXPLICIT. The url alone was here and the rest was left to
  // defaults, and the result was a store build that published updates
  // faithfully and applied none of them — for a week, silently, with the
  // channel, the branch and the runtime version all correct. Nothing about
  // that failure is visible from outside the phone, so nothing about it is
  // left implicit any more.
  //
  //   enabled              — on. Not assumed.
  //   checkAutomatically   — ask on every launch. The default is this, but the
  //                          default is also what we thought was happening.
  //   fallbackToCacheTimeout 0 — launch from cache immediately and fetch in the
  //                          background. The update applies on the NEXT launch,
  //                          which is why testing an OTA always takes two.
  updates: EAS_PROJECT_ID
    ? {
        url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
        enabled: true,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : {},
  ios: {
    bundleIdentifier: "com.tulmi.app",
    appleTeamId: "6552H8HYA4",
    supportsTablet: false,
    // Sign in with Apple. The expo-apple-authentication plugin already injects
    // the entitlement; this flag is the explicit, belt-and-suspenders switch so
    // the capability is unambiguous in the generated entitlements. The native
    // sign-in flow lives in AuthGateScreen (onApple → signInWithIdToken).
    usesAppleSignIn: true,
    // Tulmi only uses standard HTTPS — exempt from export-compliance. Setting
    // this clears the "encryption" question that otherwise blocks every
    // TestFlight build until answered by hand in App Store Connect.
    config: { usesNonExemptEncryption: false },
    // Universal Links: taps on x0bot.com URLs open the app directly. Backing
    // JSON is served at https://app.x0bot.com/.well-known/apple-app-site-association
    // (and on x0bot.com through the site's proxy). tailzu.space stays listed: links
    // already sent and printed name it, and it serves the same file.
    associatedDomains: ["applinks:x0bot.com", "applinks:app.x0bot.com", "applinks:tailzu.space", "applinks:app.tailzu.space"],
    infoPlist: {
      // PERMISSION STRINGS SAY WHAT THIS BINARY DOES — and only for what it can
      // ask for. Apple rejects purpose strings for permissions an app never
      // requests (5.1.1), and refuses an upload whose binary links a
      // permission API without its key (ITMS-90683). So a key is here when
      // the app asks for it, or will (image and video bots: a photo as input,
      // saving what they make), or when a linked module calls its API.
      //
      // REMOVED (Oct 2026), each because nothing in the app or its keyboard,
      // share and widget extensions asks for it, and no linked code calls its
      // permission API (checked in node_modules' iOS sources and in targets/
      // and modules/): calendars and reminders (expo-calendar is gone: the app
      // keeps its own calendar on the server, actions.ts calendar.addEvent),
      // contacts (expo-contacts is gone), location (no CLLocationManager
      // anywhere; expo-notifications only names CLRegion types), motion (only
      // CMMotionManager, which needs no key; no activity, pedometer or
      // altimeter), Apple Music (only Now Playing and remote commands, no media
      // library), Bluetooth (no CoreBluetooth), local network (a release build
      // talks only to https on x0bot.com; expo-dev-launcher adds its own key to
      // development builds and strips it from release ones). Re-add a key in
      // the SAME release that ships a feature asking for it.
      // Every key here is read by the Expo permission plugins in preference
      // to their generic defaults (IOSConfig.Permissions.applyPermissions).
      //
      // Microphone: besides tap-to-dictate, a Flow session keeps the mic live
      // in the background so the keyboard can dictate without reopening the
      // app. Understating that is a 5.1.1 rejection. It idles out on its own
      // (FlowSessionManager, kb.flow.idleTimeoutMs) and the Live Activity has
      // an End button (targets/widgets/FlowActivity.swift). Voice notes and
      // videos the bots take as input use it too.
      NSMicrophoneUsageDescription:
        "X0 Bot uses the microphone to turn your speech into text. If you start a Flow session, the microphone stays on in the background so you can dictate from the X0 Bot keyboard, and iOS shows the recording indicator the whole time. It turns off by itself after a few minutes without use, and you can end it anytime from the Lock Screen.",
      // A photo or video taken to give a bot or send in a chat (media.ts
      // uploadFile pick "camera", pickImage source "camera").
      NSCameraUsageDescription:
        "X0 Bot uses the camera when you choose to take a photo or video to give to a bot or send in a chat.",
      // A photo, video or file picked to give a bot or share in a chat
      // (media.ts uploadFile, pickImage; the photoLibrary permission action).
      NSPhotoLibraryUsageDescription:
        "X0 Bot opens your photos when you choose a photo or video to give to a bot or send in a chat.",
      // Saving what the bots make (saveToPhotos: only files the app made
      // itself, actions.ts inCache), and the share sheet's Save Image.
      NSPhotoLibraryAddUsageDescription:
        "X0 Bot saves the images and videos you make to your Photos when you choose to save them.",
      // Kept because the binary links Speech: expo-speech (read-aloud in a
      // voice session) imports it. Dictation itself is transcribed on X0 Bot's
      // servers; nothing asks for Apple's speech recognition.
      NSSpeechRecognitionUsageDescription:
        "X0 Bot turns your speech into text on its own servers. It doesn't use Apple's speech recognition.",
      // The biometricPrompt action (expo-local-authentication): the Code
      // bot's and connected apps' approvals ask for Face ID before a bot acts.
      // SecureStore links LocalAuthentication too.
      NSFaceIDUsageDescription:
        "X0 Bot uses Face ID to confirm it's you before a bot does something you approve.",
      // Background audio — REQUIRED for the "Flow Session" mic architecture:
      // the keyboard extension cannot hold the microphone (iOS blocks recording
      // in extensions), so the main app keeps a live AVAudioSession alive in the
      // background (FlowSessionManager) after the user swipes back to their app,
      // and the keyboard drives start/stop of each dictation via Darwin
      // notifications. This is the same mechanism Wispr Flow uses. The backing
      // code ships (FlowSessionManager.swift), so this declaration is honest
      // per Guideline 2.5.4.
      UIBackgroundModes: ["audio"],
      // The Flow session is a Live Activity while the background microphone
      // is armed: visible on the Lock Screen and in the Dynamic Island, and
      // stoppable from there. Drawn by the widget extension
      // (targets/widgets), driven by FlowSessionManager.
      NSSupportsLiveActivities: true,
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
      // Google sign-in redirect. expo-auth-session (SDK 56) completes the native
      // OAuth round-trip on the BUNDLE ID scheme — com.tulmi.app:/oauthredirect —
      // so that scheme is listed in the first entry below alongside "tulmi".
      // The reversed iOS client id scheme is kept as a second entry: older
      // provider versions redirected there, and Google's iOS client accepts
      // either. This is why Google needs a native build, not an OTA. Env var
      // overrides the literal if you ever rotate the iOS client.
      //
      // Android does NOT get a scheme from here. It gets it from the top-level
      // `scheme` array, which is where com.tulmi.app was missing — the earlier
      // note that "Android uses the tulmi scheme, no entry needed" was wrong,
      // and it was the whole reason Google sign-in stranded Android users on
      // google.com after consent.
      // ROOT CAUSE of the "keyboard mic never opens the app" saga (July 21 →
      // Aug 13): CFBundleURLTypes is the app's ENTIRE URL-scheme registration
      // table, and ios.infoPlist values REPLACE what prebuild generated — so
      // registering only the Google scheme here WIPED the "tulmi" scheme that
      // `scheme: "tulmi"` above produces. From that build on, iOS had no app
      // registered for tulmi:// (Safari: "address is invalid"), so every open
      // attempt from the keyboard — any mechanism — was refused as
      // "no such destination". The "tulmi" entry below MUST stay first in
      // this list; never assign this key without it. And com.tulmi.app must
      // stay beside it, or Google sign-in loses its way back on iOS.
      CFBundleURLTypes: [
        { CFBundleURLSchemes: ["tulmi", "com.tulmi.app"] },
        {
          CFBundleURLSchemes: [
            process.env.GOOGLE_IOS_URL_SCHEME ??
              "com.googleusercontent.apps.276376169707-29fkjccf3kp8t46nlnnfpvml6i4um9h7",
          ],
        },
      ],
    },
    // Shared container so the keyboard extension can read the app's backend URL
    // + the user's token (written by the tulmi-bridge native module).
    entitlements: {
      "com.apple.security.application-groups": ["group.com.tulmi.app"],
      "com.apple.developer.applesignin": ["Default"],
      "aps-environment": "production",
      "com.apple.developer.associated-domains": [
        "applinks:x0bot.com",
        "applinks:app.x0bot.com",
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
    ...(googleServicesFile ? { googleServicesFile } : {}),
    // NO BACKUPS. The keyboard's bearer token lives in shared_prefs/tulmi.xml,
    // and Auto Backup (Android's default, and Expo's) copied it to Google
    // Drive and into `adb backup` — a live session outside the phone. Nothing
    // relies on a restore: the Supabase session is in SecureStore, whose
    // Keystore keys never leave the device, so a restored copy could not be
    // read anyway and the user signs in again regardless; settings come back
    // from the server. A device-to-device transfer on Android 12+ ignores this
    // flag — the data-extraction rules (plugin/withTulmiKeyboard.js) cover it.
    allowBackup: false,
    // ONLY permissions the launch build actually exercises. The old
    // "everything we might want next year" list was a Play-submission
    // liability: READ_MEDIA_IMAGES/VIDEO trigger the Photo & Video Permissions
    // declaration+approval flow (and mandate the system photo picker, which
    // expo-image-picker already uses permission-free), and unused
    // contacts/calendar/location/AD_ID grants invite policy rejections.
    // Re-add a permission in the SAME release that ships its feature.
    permissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.INTERNET",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.VIBRATE",
      "android.permission.ACCESS_NETWORK_STATE",
      // FOREGROUND_SERVICE_MICROPHONE removed: the keyboard records inline as an
      // InputMethodService — there is no mic-type foreground service in the
      // binary, and Play policy rejects declaring an FGS-type permission with no
      // matching service + use-declaration. Re-add (with the declaration) only
      // if a real foreground mic service ships.
      "com.android.vending.BILLING",
    ],
    // `permissions` ADDS. It cannot take away what a library merges in.
    //
    // The list above deliberately omits READ_MEDIA_IMAGES / READ_MEDIA_VIDEO,
    // and Play still reported both as undeclared: expo-media-library's own
    // manifest merges them into the AAB whether we name them or not. The
    // comment above was true about intent and wrong about effect.
    //
    // They trigger the Photo & Video Permissions declaration — a form, a
    // justification, and a human reviewing whether the app really needs broad
    // media access. It does not. Nothing in the app reads the photo library:
    // the backend has never sent permission:"photoLibrary", never rendered an
    // ImagePickerButton, and never emitted a save-to-library action.
    //
    // blockedPermissions writes tools:node="remove" into the merged manifest,
    // which is the only thing that actually removes them.
    //
    // What still works: expo-image-picker uses the system photo picker on
    // Android 13+, which is permission-free by design — picking an image is
    // unaffected. What stops working is reading the library wholesale, which
    // nothing does. Re-add a permission in the SAME release that ships a
    // feature needing it, and expect to fill in the declaration then.
    //
    // expo-media-library's plugin and manifest also merge READ_MEDIA_AUDIO
    // (nothing reads audio files) and READ_MEDIA_VISUAL_USER_SELECTED
    // (Android 14's partial photo access, for reading the library, which
    // nothing does): blocked too. Saving a picture to the gallery needs no
    // permission on Android 10+, and the system photo picker none at all.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
    ],
    // Android masks the icon into whatever shape the launcher wants (circle,
    // squircle, teardrop) and shows only the middle 72/108 of the canvas.
    //
    // adaptive-icon.png is the whole painted icon (icon.png) at 70% of the
    // canvas, a touch larger than the 66.7% that shows, so every mask lands on
    // the art. Its corners are masked away, as on iOS. adaptive-icon-background.png
    // carries the icon's clay bar and cream ground on past the art's edge, so the
    // launcher's parallax and press animations never show a seam or a strip of
    // flat colour. Both come from tools/media/brand/x0-icon/curious-hang.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundImage: "./assets/adaptive-icon-background.png", backgroundColor: "#F7F3EC" },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        // Both domains: x0bot.com, and tailzu.space for links already out
        // there. Each host must serve /.well-known/assetlinks.json (the
        // backend's, docs/domain-x0bot.md) or Android verifies none of them.
        data: [
          { scheme: "https", host: "x0bot.com" },
          { scheme: "https", host: "app.x0bot.com" },
          { scheme: "https", host: "tailzu.space" },
          { scheme: "https", host: "app.tailzu.space" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
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
    // No background playback: nothing plays audio behind the lock screen.
    // Left on (the plugin's default), it put a media-playback foreground
    // service and FOREGROUND_SERVICE_MEDIA_PLAYBACK into the Android build,
    // which Play asks to be declared and justified. The iOS background audio
    // mode the Flow session needs is set explicitly in infoPlist above.
    ["expo-audio", { enableBackgroundPlayback: false }],
    "expo-apple-authentication",
    "expo-camera",
    "expo-image-picker",
    "expo-media-library",
    "expo-document-picker",
    "expo-local-authentication",
    "expo-notifications",
    // No expo-contacts or expo-calendar: neither is installed any more (their
    // plugins added the contacts, calendars and reminders strings, and
    // READ/WRITE_CONTACTS and READ/WRITE_CALENDAR on Android).
    "expo-video",
    // Splash / launch screen: the app icon's bot, small, hanging from a piece of
    // its clay bar, dead centre on white: the Bots app's own paper, so the
    // launch ends on the app's ground. ONE asset, both platforms.
    //
    // From API 31 Android's splash is the SYSTEM one: a colour and a centred
    // icon, masked to a circle 192 dp across. There is no full-bleed option, so
    // the art is a square 136 pt wide whose drawing stays inside its own
    // inscribed circle: it reads whole inside Android's mask, and iOS shows the
    // same picture at the same size.
    //
    // THE LAUNCH ANIMATION STARTS FROM THIS FRAME. src/launch/LaunchCurtain draws
    // the same art (assets/launch: drawn with the icon's own code by
    // tools/media/brand/x0-icon/curious-hang/launch.mjs) at the same size on the
    // same ground, lifts this splash from under it, and the bot pulls himself
    // up over his bar and is gone, and the bar is pulled in to its middle.
    // imageWidth and backgroundColor here are SPLASH_PT and GROUND in
    // src/launch/launchCore.ts (launchCore.test.ts holds them together): change
    // one, change both — and a change here needs a new native build.
    //
    // Dark mode gets the same: the white is the app's ground, not a theme.
    [
      "expo-splash-screen",
      {
        backgroundColor: "#FFFFFF",
        image: "./assets/launch/splash.png",
        imageWidth: 136,
        resizeMode: "contain",
        dark: { backgroundColor: "#FFFFFF", image: "./assets/launch/splash.png" },
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
    // Tailzu in Android's Share menu (ACTION_SEND / SEND_MULTIPLE on MainActivity).
    // iOS's share extension is targets/share, picked up by apple-targets below.
    "./modules/tulmi-share/plugin/withTulmiShare",
    "./modules/withPrivacyManifest",
    "@bacons/apple-targets",
    ...metaPlugin,
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
    // Only when the SDK is configured in this build (metaPlugin above).
    metaAppId: metaPlugin.length ? META_APP_ID : "",
  },
};

export default config;
