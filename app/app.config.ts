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

// THE ANDROID HEALTH BUILD SWITCH. Read like META_APP_ID above, recorded per build
// profile in native-inputs.lock, and "on" in exactly one place: an Android build that
// carries Health Connect. On, it links react-native-health-connect, adds READ_STEPS and
// READ_EXERCISE, raises the Android minimum to 8.0 (API 26, Health Connect's floor, which
// drops Android 7.0-7.1 for the whole app), and declares the rationale screen. Off — the
// default, and what the release candidate is built with unless Play has approved the Health
// Connect form by release-candidate day — none of that happens, the package stays installed
// but unlinked (react-native.config.js and modules/tulmi-perms' plugin), and the JS check
// declares no Health1 on that build. iPhone health is not affected either way.
const TULMI_ANDROID_HEALTH = (process.env.TULMI_ANDROID_HEALTH ?? "").trim().toLowerCase() === "on";
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

// THE TWO STRINGS THE LIVE CALL'S PLUGIN ALSO WRITES. @config-plugins/react-native-webrtc
// sets NSMicrophoneUsageDescription and NSCameraUsageDescription itself, and what it is
// given wins over what ios.infoPlist says — so both are named here, once, and handed to
// the plugin below as well as written into infoPlist. Change one, change nothing else: a
// camera string that drifts is a new App Review question. The camera opens only when the
// person chooses to take a photo or video, or to scan a code.
const MIC_USAGE =
  "X0 Bot uses the microphone to turn your speech into text, and to talk with your bots by voice, including when Plan Ease calls you. If you start a Flow session, the microphone stays on in the background so you can dictate from the X0 Bot keyboard, and iOS shows the recording indicator the whole time. It turns off by itself after a few minutes without use, and you can end it anytime from the Lock Screen.";
const CAMERA_USAGE =
  "X0 Bot uses the camera when you take a photo or video, or scan a code, to give to a bot or send in a chat.";
// LOCATION AND HEALTH, each written for one data type and one purpose, and each with a working
// screen in this same binary (no dark declarations).
//
// Location is one foreground fix, taken only when the person taps "Use my location" on Plan
// Ease's "Where does your day start?" card. The phone's own map service names the point; X0 Bot
// keeps the area's name and never the point, and never looks again on its own. Arrival reminders
// would need Always, which is not in this build, so no NSLocationAlways* key is here.
//
// Health is read-only, steps and workouts, for a fitness bot the person made and switched on
// themselves. Keep these two in step with the card words the server sends
// (screens/permitWords.ts) and the store documents: a purpose string that drifts from the screen
// is a 5.1.1 rejection. HEALTH_USAGE is handed to the HealthKit plugin below as well, so the
// plugin cannot replace it with its own default.
const LOCATION_USAGE =
  "X0 Bot uses your location when you tap Use my location, to fill in a place for you, like the area your day starts " +
  "from, so it can work out your travel times. It keeps the area's name, not your exact location.";
const HEALTH_USAGE =
  "X0 Bot reads your steps and workouts when you connect Apple Health to a fitness bot you made, so the bot can count " +
  "your active days and keep your streak. It reads nothing else and never uses it for ads.";

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
  // The App Store has 8.5 live (lookup, 19 Oct 2026), so Apple refuses any build
  // at 8.5 or below, 8.4 included. 8.8 is what build 79 carried, so build 80 stays on it.
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
  // OTA updates (EAS Update). runtimeVersion is a FIXED STRING, not a policy.
  //
  // The fingerprint policy hashes the native project on whichever machine runs
  // the command, and the same commit gave d6ee7792 on the EAS builder, 6d2ada59
  // on Windows and f6856889 on Linux, so updates published from a laptop
  // reached nobody. One string keeps every build on one update stream.
  //
  // WHAT THE LABEL MEANS: "the native code JS can rely on". Same runtime = the
  // same native code, or the same plus additions that JS detects before it uses
  // them. Each bump cuts every installed phone off from future OTAs until it
  // updates from the store, so bump ONLY when native code that already exists
  // changes:
  //   1. an Expo SDK or React Native upgrade;
  //   2. the version of ANY already-installed native package changes, patch
  //      bumps from `expo install --fix` included (Skia, Reanimated, worklets,
  //      gesture-handler and every Expo module);
  //   3. a native module or function is removed or renamed, or its native API
  //      changes incompatibly;
  //   4. a Reanimated static flag, or anything else about how an existing
  //      package is compiled, changes.
  //
  // NEVER bump for: the icon or splash (new art is a store build on the same
  // runtime), a version or build number, store listing changes, a permission
  // string or plist key that does not change a module's behaviour, an added
  // native package or local module, an added function on an existing local
  // module, or an added extension target. Reach additions only through
  // src/device/natives.ts (optional require / typeof check), never assume them.
  //
  // tools/ci/check-runtime.mjs compares the tree with app/native-inputs.lock
  // and fails CI when existing native code changed without a new string here.
  // After any native change or addition, refresh the lock:
  //   node tools/ci/check-runtime.mjs --write
  // Any new value works for a bump; it only has to differ.
  runtimeVersion: "tailzu-2026-11-x0-blip",
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
      // STILL OUT (the Oct 2026 clear-out), each because nothing in the app or
      // its keyboard, share and widget extensions asks for it, and no linked
      // code calls its permission API (checked in node_modules' iOS sources and
      // in targets/ and modules/): calendars and reminders (expo-calendar is
      // gone: the app keeps its own calendar on the server, actions.ts
      // calendar.addEvent), motion (only CMMotionManager, which needs no key;
      // no activity, pedometer or altimeter), Apple Music (only Now Playing and
      // remote commands, no media library), Bluetooth (no CoreBluetooth), local
      // network (a release build talks only to https on x0bot.com;
      // expo-dev-launcher adds its own key to development builds and strips it
      // from release ones).
      //
      // BACK, each with its screen in this same binary: LOCATION and HEALTH.
      // Location is one foreground fix behind "Use my location" on Plan Ease's
      // day-starts card (modules/tulmi-perms, CLLocationManager.requestLocation
      // plus CLGeocoder) — When In Use only, so no NSLocationAlways* key, no
      // region monitoring and no motion. Health is read-only steps and workouts
      // behind a switch on a fitness bot the person made
      // (@kingstinct/react-native-healthkit).
      //
      // CONTACTS STAYS OUT, and the feature still ships: "Add from contacts"
      // uses the system picker (CNContactPickerViewController in
      // modules/tulmi-perms), which runs outside the app and returns the one
      // email tapped. CNContactStore is what would need the key, and nothing
      // touches it. Asking for the whole address book to read one address is
      // exactly what 5.1.1(iii) refuses.
      //
      // Re-add a key in the SAME release that ships a feature asking for it.
      // Every key here is read by the Expo permission plugins in preference
      // to their generic defaults (IOSConfig.Permissions.applyPermissions).
      //
      // Microphone: besides tap-to-dictate, a Flow session keeps the mic live
      // in the background so the keyboard can dictate without reopening the
      // app. Understating that is a 5.1.1 rejection. It idles out on its own
      // (FlowSessionManager, kb.flow.idleTimeoutMs) and the Live Activity has
      // an End button (targets/widgets/FlowActivity.swift). Voice notes and
      // videos the bots take as input use it too.
      //
      // AND THE CALL. Plan Ease calls about anything the call judge thinks
      // matters, and always about a leave-by or a bill due today; in this build
      // answering it is a conversation: the microphone is open
      // while the call is on, in the app, in the foreground, and only after the
      // person agreed to AI processing (src/sdui/voice/callRealtime.ts). The
      // string says so, because a purpose string that does not name the feature
      // is a 5.1.1 rejection. Keep this text and the plugin entry below in step:
      // the react-native-webrtc plugin is handed this very string.
      NSMicrophoneUsageDescription: MIC_USAGE,
      // A photo or video taken to give a bot or send in a chat (media.ts
      // uploadFile pick "camera", pickImage source "camera"). UNCHANGED by the
      // live call: it is handed to that plugin so the plugin cannot replace it.
      NSCameraUsageDescription: CAMERA_USAGE,
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
      // ONE FIX WHEN THE PERSON TAPS "Use my location" (botsPlaces.ts's
      // day-starts card). While Using only: there is no Always key here and no
      // background location in the binary, so iOS never offers "Always".
      NSLocationWhenInUseUsageDescription: LOCATION_USAGE,
      // The prompt opens on APPROXIMATE, matching Android asking for COARSE
      // only and the label, which claims no Precise Location. A person can
      // still switch it to Precise, and either way only the area's name is
      // kept, never a point. If Bengaluru neighbourhoods come out wrong too
      // often, this key goes and nothing else changes.
      NSLocationDefaultAccuracyReduced: true,
      // READ-ONLY steps and workouts for a fitness bot the person made and
      // switched on. Nothing is ever written to Apple Health, so there is no
      // NSHealthUpdateUsageDescription (the library's plugin is told to skip
      // it), no clinical-records key, and no healthkit entry in
      // UIRequiredDeviceCapabilities — a phone without HealthKit simply never
      // shows the switch.
      NSHealthShareUsageDescription: HEALTH_USAGE,
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
      //
      // "remote-notification" is the SILENT push that refreshes what the
      // widgets and the Live Activity show. When the server publishes a new
      // design catalog or a fresh glance, a content-available push wakes the
      // app, it syncs (src/native/looks.ts, src/widgets/glance.ts) and reloads
      // the timelines — otherwise a new look waits for the next time someone
      // opens the app. It refreshes the app's OWN content and nothing else,
      // which is what 2.5.4 asks. It is best effort and budgeted by iOS: never
      // after a force-quit, seldom in Low Power Mode. No "fetch" or
      // BGAppRefresh mode is added; iOS rarely runs those for an app people do
      // not open daily.
      UIBackgroundModes: ["audio", "remote-notification"],
      // The Flow session is a Live Activity while the background microphone
      // is armed: visible on the Lock Screen and in the Dynamic Island, and
      // stoppable from there. Drawn by the widget extension
      // (targets/widgets), driven by FlowSessionManager.
      NSSupportsLiveActivities: true,
      // "Bots at work" moves stage by stage while a job runs, and the server
      // pushes each step over APNs (tulmi/src/widgets/activity.ts). Without
      // this key iOS budgets those updates hard and quietly drops the ones it
      // does not like, so a job's last two or three stages simply never show.
      // It is a plist key, so it can only be set in a build.
      NSSupportsLiveActivitiesFrequentUpdates: true,
      // FONTS: there is deliberately no UIAppFonts entry. The widget and
      // keyboard extensions register their own faces at runtime with
      // CTFontManagerRegisterFontsForURL(url, .process) — the bundled ones
      // from Fonts/ in each target, and the ones the app hooks in later
      // through the App Group (NLookStyle.swift registerOnce). That works
      // inside an extension, needs no plist key, and avoids the question of
      // whether @bacons/apple-targets would pass one through. A face that
      // will not register falls back to the system one, so a design always
      // draws. If the day-1 device check shows the widget extension refusing
      // runtime registration, the fallback is a hand-written
      // targets/widgets/Info.plist with UIAppFonts (the plugin leaves an
      // existing Info.plist alone, which keeps the WidgetKit NSExtension
      // keys) — not a key here.
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
        // UPI pay hand-off: lets the app tell "no UPI app" from a real open.
        "upi",
        "phonepe",
        "tez",
        "gpay",
        "paytmmp",
        "credpay",
        "bhim",
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
      // TIME SENSITIVE: a leave-by and a bill due today may break through a
      // Focus and the Scheduled Summary (Plan Ease's plan_leave and plan_due,
      // sent with interruptionLevel "time-sensitive"). Only those: the day
      // notes go as they are, and the morning note as "passive". The person
      // can still turn it off for X0 Bot in Settings › Notifications. The
      // server sends the level only to a phone whose binary says it has this
      // (TulmiBridgeModule.swift binaryFeatures → PushTimeSensitive with the
      // push token), so an over-the-air update to an older binary changes
      // nothing. EAS turns the capability on for the App ID from this key.
      "com.apple.developer.usernotifications.time-sensitive": true,
      // HEALTHKIT, read only. The library's plugin writes this key too; it is
      // named here as well so the entitlement is visible beside the others and
      // cannot quietly disappear with a plugin change. Deliberately NOT here:
      // com.apple.developer.healthkit.background-delivery (the plugin is passed
      // background:false, and nothing in src/ may call the background APIs) and
      // healthkit.access (no clinical records). EAS turns the capability on for
      // the App ID from this key, as it did for time-sensitive; if its sync
      // fails, the App ID gets it by hand in the day-1 signing session.
      "com.apple.developer.healthkit": true,
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
      // ONE COARSE FIX when the person taps "Use my location". Approximate only:
      // an area name is all that is wanted, FINE is blocked below, and there is
      // no background location and no location foreground service in the binary.
      "android.permission.ACCESS_COARSE_LOCATION",
      // Health Connect, and only with the build switch on (see TULMI_ANDROID_HEALTH
      // at the top). Two read permissions, nothing else and nothing written. Both
      // are declared to Play on the Health Connect form with a reason each, and a
      // build without the switch carries neither.
      ...(TULMI_ANDROID_HEALTH
        ? ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE"]
        : []),
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
    // SYSTEM_ALERT_WINDOW: react-native-webrtc's plugin asks for it (its screen-sharing
    // path draws over other apps). The live call is audio only and nothing in this app
    // draws over anything, and "display over other apps" is a permission Play looks
    // hard at. Blocked, like the media ones. The plugin's other new permissions are
    // WAKE_LOCK and BLUETOOTH, both normal, neither asked of the person.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.SYSTEM_ALERT_WINDOW",
      // LOCATION, CONTACTS AND ACTIVITY, blocked so no library can merge them in
      // behind the app's back. The app asks for COARSE and nothing else: FINE
      // would offer Precise the app never uses and never stores; BACKGROUND
      // needs Play's declaration with a video and a human review, and nothing
      // here reads location while the app is closed; FOREGROUND_SERVICE_LOCATION
      // has no service to match. READ/WRITE_CONTACTS: the picker runs outside
      // the app (ACTION_PICK), so neither is needed, and declaring them is what
      // Play's 2027 picker rule and Apple's 5.1.1(iii) both refuse.
      // ACTIVITY_RECOGNITION: Health Connect's steps come from Health Connect,
      // not from the phone's own step sensor, so nothing may ask for it.
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.READ_CONTACTS",
      "android.permission.WRITE_CONTACTS",
      "android.permission.ACTIVITY_RECOGNITION",
      // The two health reads, blocked whenever the build switch is OFF. The
      // `permissions` list above only ADDS, so with the switch off nothing
      // removes them: a library could merge them in, and a prebuild run after
      // an ON prebuild without --clean would keep yesterday's entries. Blocking
      // them writes tools:node="remove", which takes them out of the merged
      // manifest either way. With the switch on they are declared above and
      // must not appear here.
      ...(TULMI_ANDROID_HEALTH
        ? []
        : ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE"]),
    ],
    // Android masks the icon into whatever shape the launcher wants (circle,
    // squircle, teardrop) and shows only the middle 72/108 of the canvas.
    //
    // The icon is Blip in shades, white dots on black (tools/media/brand/blip-icon/cool:
    // mono.svg, drawn by gen.mjs). adaptive-icon.png is the figure alone on
    // transparent at 64% about the centre, so the circle and squircle masks both
    // keep his feelers; adaptive-icon-background.png is the black ground, so the
    // launcher's parallax and press animations never show a seam. icon.png is the
    // whole icon, opaque, for iOS and the stores.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundImage: "./assets/adaptive-icon-background.png", backgroundColor: "#0A0A0A" },
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
    // Still no expo-contacts, expo-calendar or expo-location, and all three
    // features they would carry are in this build anyway:
    //  - contacts is the system picker (modules/tulmi-perms), so no permission
    //    at all; expo-contacts' plugin adds READ_CONTACTS *and* WRITE_CONTACTS,
    //    and its picker needs READ_CONTACTS on Android.
    //  - location is one fix in that same module, about 150 lines;
    //    expo-location's plugin writes NSLocationAlways* and
    //    NSMotionUsageDescription unless each is passed false, merges
    //    ACCESS_FINE_LOCATION and a LocationTaskService with
    //    foregroundServiceType="location", and links the Always/background
    //    APIs, which is the ITMS-90683 refusal this file warns about above.
    //  - the app keeps its own calendar on the server.
    "expo-video",
    // Splash / launch screen: the app icon's Blip, small, in ink, hanging upside
    // down from a piece of bar by his robot hands, shades on, his feelers
    // hanging from the top of his head; dead centre on white: the Bots app's own
    // paper, so the launch ends on the app's ground. ONE asset, both platforms.
    //
    // From API 31 Android's splash is the SYSTEM one: a colour and a centred
    // icon, masked to a circle 192 dp across. There is no full-bleed option, so
    // the art is a square 136 pt wide whose drawing stays inside its own
    // inscribed circle: it reads whole inside Android's mask, and iOS shows the
    // same picture at the same size.
    //
    // THE LAUNCH ANIMATION STARTS FROM THIS FRAME. src/launch/LaunchCurtain draws
    // the same art (assets/launch: drawn by tools/media/brand/blip-icon/launch/
    // gen.mjs, this splash being its layers stacked at rest) at the same size on
    // the same ground, lifts this splash from under it, and Blip pulls himself
    // up over his bar, feelers swinging, and is gone, hands and all; then his hands come back and
    // grab the bar's middle, one from above and one from below, and the bar is
    // pulled in to them as they twist.
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
    // PLAN EASE'S LIVE CALL (src/sdui/voice/callRealtime.ts). The client is native, so
    // this is a store build and nothing else: the call is offered only to a binary whose
    // bridge says "realtimeCall" (device/binaryCore.ts), and the same JavaScript on an
    // older binary keeps today's turn-by-turn call.
    //
    // Both permission strings are passed in because the plugin writes them itself and
    // what it is given wins; they are the same two constants infoPlist uses above, so
    // the camera string stays exactly as it was.
    [
      "@config-plugins/react-native-webrtc",
      { cameraPermission: CAMERA_USAGE, microphonePermission: MIC_USAGE },
    ],
    // ...and the two things only the generated native projects can carry: the library's
    // screen-sharing foreground service taken out of the merged Android manifest, and one
    // named libwebrtc on both phones instead of the floating versions it asks for.
    "./plugins/withNoWebrtcFgs",
    "./plugins/withWebrtcPin",
    "./modules/tulmi-keyboard/plugin/withTulmiKeyboard",
    // Tailzu in Android's Share menu (ACTION_SEND / SEND_MULTIPLE on MainActivity).
    // iOS's share extension is targets/share, picked up by apple-targets below.
    "./modules/tulmi-share/plugin/withTulmiShare",
    // APPLE HEALTH, read only. The two option names are the plugin's own
    // (app.plugin.ts): the share string is handed in so the plugin cannot
    // replace it with "X0 Bot wants to read your health data", `false` skips
    // the update string entirely (nothing is ever written to Health), and
    // background:false leaves out the background-delivery entitlement, so the
    // core pod's launch hook has no type to observe. The package has no Android
    // code; Health Connect is the Android half, behind the build switch.
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription: HEALTH_USAGE,
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    // Health Connect needs Android 8.0 (API 26), so the minimum moves ONLY in a
    // build that carries it. Off, the app's minimum stays where it is and
    // Android 7 phones keep the app. react-native-health-connect's own plugin
    // is deliberately not listed: it points the rationale screens at
    // MainActivity, which cannot show the policy. The library links itself.
    ...(TULMI_ANDROID_HEALTH
      ? ([["expo-build-properties", { android: { minSdkVersion: 26 } }]] as [string, Record<string, unknown>][])
      : []),
    // The rationale screen when the switch is on, and taking Health Connect's
    // Expo half out of the build when it is off (react-native.config.js takes
    // out the React Native half; the two have to go together).
    ["./modules/tulmi-perms/plugin/withTulmiPerms", { androidHealth: TULMI_ANDROID_HEALTH }],
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
