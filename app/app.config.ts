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

const config: ExpoConfig = {
  // User-visible name (under the home-screen icon + in Settings → General →
  // iPhone Storage). `slug` and bundleIdentifier stay as "tulmi" because
  // both are baked into the EAS project + App Groups + Keychain groups +
  // Supabase project — renaming those would rebuild every entitlement and
  // break the shared bearer token between app + keyboard.
  name: "Tailzu",
  slug: "tulmi",
  version: "1.0.1",
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
  runtimeVersion: "tailzu-2026-09-k42-a3",
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
    // Universal Links: taps on tailzu.space URLs open the app directly. Backing
    // JSON must be hosted at https://tailzu.space/.well-known/apple-app-site-association.
    associatedDomains: ["applinks:tailzu.space", "applinks:app.tailzu.space"],
    infoPlist: {
      // PERMISSION STRINGS SAY WHAT THIS BINARY DOES — nothing it might do one
      // day. They used to describe features that were never built (Face ID
      // drafts, @mentions, location-tagged notes, Nearby Sync, raise-to-record),
      // and a purpose string that promises a feature is a 5.1.1 problem the
      // day a reviewer looks for it.
      //
      // WHY A KEY STAYS EVEN WHEN THE ANSWER IS "NOT USED": Apple refuses an
      // upload whose binary links a permission API without its key (ITMS-90683),
      // and the installed modules link more than the app uses — expo-speech
      // imports Speech, expo-audio/expo-video MediaPlayer, expo-calendar and
      // expo-notifications CoreLocation, expo-camera and Reanimated CoreMotion,
      // expo-calendar the reminders half of EventKit. Deleting those keys is
      // a gamble on a static check; saying "not used" truthfully is not.
      // Every key here is read by the Expo permission plugins in preference
      // to their generic defaults (IOSConfig.Permissions.applyPermissions).
      //
      // Microphone: besides tap-to-dictate, a Flow session keeps the mic live
      // in the background so the keyboard can dictate without reopening the
      // app. Understating that is a 5.1.1 rejection. It idles out on its own
      // (FlowSessionManager, kb.flow.idleTimeoutMs) and the Live Activity has
      // an End button (targets/widgets/FlowActivity.swift).
      NSMicrophoneUsageDescription:
        "Tailzu uses the microphone to turn your speech into text. If you start a Flow session, the microphone stays on in the background so you can dictate from the Tailzu keyboard, and iOS shows the recording indicator the whole time. It turns off by itself after a few minutes without use, and you can end it anytime from the Lock Screen.",
      // pickImage (source "camera") and the camera permission action.
      NSCameraUsageDescription:
        "Tailzu uses the camera only when you choose to take a photo in the app.",
      // pickImage (library) and the photoLibrary permission action.
      NSPhotoLibraryUsageDescription:
        "Tailzu opens your photos only when you choose a picture to use in the app.",
      // saveToPhotos — only files the app made itself (actions.ts, inCache).
      NSPhotoLibraryAddUsageDescription:
        "Tailzu saves an image to Photos only when you ask it to.",
      // Dictation is transcribed by Tailzu's backend; Speech is linked only
      // because expo-speech (read-aloud) imports it.
      NSSpeechRecognitionUsageDescription:
        "Tailzu doesn't use Apple's speech recognition.",
      // The biometricPrompt action (expo-local-authentication); SecureStore
      // links LocalAuthentication too.
      NSFaceIDUsageDescription:
        "Tailzu uses Face ID only to confirm it's you when the app asks you to.",
      // expo-contacts is installed but nothing reads a contact — only the
      // generic permission action can ask. A removal candidate.
      NSContactsUsageDescription:
        "Tailzu doesn't read or upload your contacts.",
      // calendar.addEvent: lists calendars to pick a writable one, adds one
      // event. It never reads events.
      NSCalendarsUsageDescription:
        "Tailzu adds an event to your calendar only when you ask it to. It doesn't read your events.",
      // iOS 17 shows these, not the one above. Without them expo-calendar's
      // generic "Allow Tailzu to access your calendars" is what people see.
      NSCalendarsFullAccessUsageDescription:
        "Tailzu adds an event to your calendar only when you ask it to. It doesn't read your events.",
      NSCalendarsWriteOnlyAccessUsageDescription:
        "Tailzu adds an event to your calendar only when you ask it to.",
      // Nothing requests reminders; expo-calendar links the API regardless.
      NSRemindersUsageDescription:
        "Tailzu doesn't read or change your reminders.",
      NSRemindersFullAccessUsageDescription:
        "Tailzu doesn't read or change your reminders.",
      NSAppleMusicUsageDescription:
        "Tailzu doesn't access your music library.",
      NSLocationWhenInUseUsageDescription:
        "Tailzu doesn't use your location.",
      NSMotionUsageDescription:
        "Tailzu doesn't use motion or fitness data.",
      // Nothing links CoreBluetooth; a paired headset's microphone reaches the
      // app through the audio session, which needs no Bluetooth permission.
      NSBluetoothAlwaysUsageDescription:
        "Tailzu doesn't use Bluetooth itself. A headset paired with your iPhone works through iOS.",
      // A release build talks only to https on tailzu.space (security.ts
      // checkBaseUrl); only a development build reaches a computer on the LAN.
      NSLocalNetworkUsageDescription:
        "Only development builds of Tailzu use the local network, to connect to a developer's computer.",
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
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
    ],
    // Android masks this into whatever shape the launcher wants — circle,
    // squircle, teardrop — and only the middle 66% of the canvas is ever
    // shown. icon.png does not survive that: its mark reaches 427px from a
    // 1000px centre and the guaranteed circle stops at 333, so the amber dot
    // that ends the line is the first thing a Pixel cuts off.
    //
    // adaptive-icon.png is the same artwork inset to 749px, which puts every
    // corner of the mark inside that circle while the black ground still
    // covers the whole mask — no transparent sliver, no ring of the
    // background colour showing through. backgroundColor matches the art's
    // own ground so a mask that ever grew would meet the same black.
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0A0A0B" },
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
    "expo-contacts",
    "expo-calendar",
    "expo-video",
    // Splash / launch screen — ONE asset, both platforms, the mark DEAD CENTRE.
    //
    // It cannot be the full 810×1440 frame. From API 31 Android's splash is the
    // SYSTEM one: a background colour and an icon the platform masks into a
    // circle. There is no full-bleed option and no flag that adds one, so a 9:16
    // composition arrives there as an unreadable crop of its own middle. iOS
    // alone could show the frame, and then the two platforms would not match.
    //
    // So the splash is the MARK: splash-mark.png, on the film's own ground,
    // centred, at a fixed size both platforms honour.
    //
    // THE MARK IS CUT FROM THE FILM'S FIRST FRAME, not drawn separately. It was
    // drawn separately, and the two drifted apart: the launch screen showed a
    // single rounded square while the film opened on three of them and a line,
    // so the handoff was one picture replacing a different picture. Cutting it
    // from frame 0 makes them the same picture by construction, and re-cutting
    // it is the only correct way to change it.
    //
    // MEASURED OFF FRAME 0, not read off the storyboard:
    //
    //   mark in the film    344×258px centred at (648.5,1222.0) of 1290×2796
    //   mark on this canvas 288×216 of 576, its centre ON the canvas centre
    //
    // Both figures here were wrong before, in the two ways this arrangement
    // exists to prevent. The mark was recorded as 338×250, so the film's box
    // was tuned to a mark 2% narrower than the one that actually plays. And
    // the canvas was 288 square, shown at 188pt — 564 device pixels on a 3x
    // screen, drawn from 288 — so the launch mark was upscaled 1.96× while the
    // film's is not. A soft mark replaced by a sharp one is a visible handoff
    // even when both are exactly the right size.
    //
    // HALF THE CANVAS, because Android masks this into a circle and only the
    // inner two thirds is guaranteed. What has to fit is the bounding DIAGONAL,
    // not the width: 360px against a 384px circle. At 0.55 the corners fall
    // outside it.
    //
    // #0B0A0D is the film's own ground, sampled from it. It used to be #000000
    // against art graded to #080809 — near enough to hide, but this art is
    // (11,10,13), and on an OLED eleven values is the pixel faintly on against
    // the pixel off. That edge is visible where the film meets the screen.
    //
    // BOTH SIDES ARE MEASURED, NEVER REASONED ABOUT:
    //
    //   imageWidth 188   × 0.5000 mark fraction = 94.00pt on the launch screen
    //   boxWidth   352.5 × 0.2667 mark fraction = 94.00pt when the film plays
    //
    // And the film's mark is not at the centre of its own frame — it sits
    // 0.0271 of the width right of it and 0.0629 of the height above it — so
    // the box carries nudgeX -0.2713 and nudgeY 6.2947 to put it back. Those
    // are the mark's own offsets, measured, not a number tuned by eye on one
    // phone: as percentages of a box fixed in points they hold on every screen.
    //
    // The film's box is a media-entry value (boxWidth/boxHeight, with the
    // aspect and the focal point beside them), so the film side retunes over
    // the air and only this side needs a build. Change one and you must
    // re-measure the other — a mark that changes size across the handoff is
    // the one thing this whole arrangement exists to prevent.
    //
    // Both platforms open on that frame, then play the film from it.
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0B0A0D",
        image: "./assets/splash-mark.png",
        imageWidth: 188,
        resizeMode: "contain",
        dark: { backgroundColor: "#0B0A0D", image: "./assets/splash-mark.png" },
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
