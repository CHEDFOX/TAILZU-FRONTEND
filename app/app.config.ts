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
// SLEEP HAS ITS OWN SWITCH, and it only means anything with the one above on. Read the same
// way, recorded per build profile in native-inputs.lock, and "on" in exactly one place: an
// Android build that carries Health Connect AND has Play's approval for sleep. On, `permissions`
// gains READ_SLEEP; off, blockedPermissions takes it back out.
//
// Why a second switch and not one: steps and exercise still wait on Play's Health Connect form,
// so every profile but n0 has TULMI_ANDROID_HEALTH off. Sleep is a separate line on that form
// with its own answer. Folded into one switch, the day steps are approved the build would either
// carry an unapproved READ_SLEEP (Play refuses the release) or hold steps back until sleep is
// approved too. Two switches let steps ship the day they are cleared, and sleep the day it is.
// tools/ci/check-runtime.mjs refuses a profile with sleep on and health off.
const TULMI_ANDROID_HEALTH_SLEEP =
  TULMI_ANDROID_HEALTH && (process.env.TULMI_ANDROID_HEALTH_SLEEP ?? "").trim().toLowerCase() === "on";
// THE THREE ANDROID SWITCHES OF 8.9.1 (perms2/SPEC.md 2, 5, 7), each read exactly like
// TULMI_ANDROID_HEALTH above, each recorded per build profile in native-inputs.lock, and each
// INDEPENDENT of the other two — because the thing that holds an Android permission up is Play, and
// Play answers each declaration on its own clock. One switch for all three would mean the slowest
// answer decides when any of them ships.
//
// CALENDAR: "Plan around my calendar" reads BUSY TIMES ONLY from the phone's calendars —
// {start, end, all-day} for 14 days, never an event's name, place, notes, people or calendar name
// (modules/tulmi-perms/android/.../TulmiCalendarRead.kt, whose projection has no such column). On,
// `permissions` gains READ_CALENDAR; off, blockedPermissions takes it back out. There is NO
// WRITE_CALENDAR either way: "Add to my calendar" is the calendar app's own ACTION_INSERT screen,
// which needs no permission at all. Play asks for no declaration for a calendar READ, so this is
// the one of the three that can go on as soon as its screens are live.
const TULMI_ANDROID_CALENDAR = (process.env.TULMI_ANDROID_CALENDAR ?? "").trim().toLowerCase() === "on";
// MOTION: daily steps for a fitness bot when Health Connect is not the source, and the "in a car?"
// check just before a Nudj call. ONE grant covers both: from Android 10 the system refuses a
// step-counter listener without ACTIVITY_RECOGNITION, and the driving check needs it too. On,
// `permissions` gains it, modules/tulmi-perms' android/build.gradle compiles src/motion/java and
// links play-services-location; off, blockedPermissions takes the permission out, src/motionOff/java
// is compiled instead and no Play services location class is in the binary. Steps have no Play
// declaration; the driving check has none either (it is not background location).
const TULMI_ANDROID_MOTION = (process.env.TULMI_ANDROID_MOTION ?? "").trim().toLowerCase() === "on";
// ARRIVAL: "Remind me when I get there". THIS IS THE ONE PLAY REVIEWS BY HAND. Android has no
// equivalent of the iPhone's location notification trigger, where the system both watches the place
// and shows the reminder: a geofence is delivered to the app, so it needs ACCESS_FINE_LOCATION and
// ACCESS_BACKGROUND_LOCATION, which means Play's background-location declaration, a demo video and a
// human review (backend docs/owner-8.9.1.md 6.1 and 6.2). It is ON from 8.9.1 in `preview` and `production`
// as well as `n0`, and it stays its own switch so it can be turned back off on its own if Play asks
// for a change. THE DECLARATION MUST BE APPROVED BEFORE THE ANDROID RELEASE IS UPLOADED: nothing in
// the repository can see Play's answer, so that is an owner step, not a check.
// Off: both permissions stay blocked, no geofencing is in the binary, no receiver is in the
// manifest, and abilities().arrival is false, so the server draws no switch on an Android phone.
const TULMI_ANDROID_ARRIVAL = (process.env.TULMI_ANDROID_ARRIVAL ?? "").trim().toLowerCase() === "on";
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
          // The plugin's own iPhone tracking option, left false. It is belt and braces: plugins/withNoMetaIos (first
          // in the plugin list) takes every Meta and tracking key back out of Info.plist whatever is set here, and
          // the iPhone build links neither Meta nor expo-tracking-transparency (package.json's autolinking exclude).
          iosUserTrackingPermission: false,
        },
      ], [
        // ANDROID'S AD_ID PERMISSION, and nothing else. This plugin's other half writes
        // NSUserTrackingUsageDescription, which plugins/withNoMetaIos deletes again: the iPhone build has no App
        // Tracking Transparency code in it, so a string for a prompt it cannot show would be a declaration with no
        // screen behind it. The words are kept here for the day Meta ships on iPhone in its own reviewed build.
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
  "X0 Bot uses the microphone to turn your speech into text, and to talk with your bots by voice, including when Nudj calls you. If you start a Flow session, the microphone stays on in the background so you can dictate from the X0 Bot keyboard, and iOS shows the recording indicator the whole time. It turns off by itself after a few minutes without use, and you can end it anytime from the Lock Screen.";
const CAMERA_USAGE =
  "X0 Bot uses the camera when you take a photo or video, or scan a code, to give to a bot or send in a chat.";
// EVERY PURPOSE STRING, each written for one data type and one purpose, and each with a working
// screen in this same binary (no dark declarations). Keep them in step with the card words the
// server sends (screens/permitWords.ts), the store documents and the privacy policy: a purpose
// string that drifts from the screen is a 5.1.1 rejection, and tulmi/tests/perm-words.test.ts
// pairs each one with its card.
//
// Location is one foreground fix when the person taps "Use my location" on Nudj's "Where
// does your day start?" card, and, from 8.9.1, arrival reminders: the iPhone's OWN location
// notification trigger watches a place and shows the reminder, which needs only While Using
// (the system monitors the region, the app is not woken and is never told of an arrival). So
// still no NSLocationAlways* key and still no `location` background mode.
//
// Health is read-only: steps and workouts, and nightly sleep minutes when the person turns that
// on, for a fitness bot they made and switched on themselves. HEALTH_USAGE is handed to the
// HealthKit plugin below as well, so the plugin cannot replace it with its own default, and
// tulmi-perms' abilities() says `healthSleep` only while this string names sleep — so cutting
// sleep from the string takes its capability with it, without a JavaScript change.
//
// Calendar and Reminders read nothing a card has not asked for: busy times only (start, end,
// all-day), and one list X0 Bot makes and keeps for itself. Motion counts steps for a fitness
// bot when Apple Health is not the source, and answers "in a car?" yes or no just before a Plan
// Ease call. iOS offers no read-only calendar grant and no write-only reminders grant, which is
// why both ask for full access; the cards, the store documents and the review notes say so.
const LOCATION_USAGE =
  "X0 Bot uses your location when you tap Use my location, to fill in the area your day starts from, and for arrival " +
  "reminders you turn on, so your iPhone itself can remind you when you get to a place. It keeps the area's name, not your " +
  "exact location, and is never told where you go.";
const HEALTH_USAGE =
  "X0 Bot reads your steps and workouts, and your sleep if you turn it on, when you connect Apple Health to a fitness bot " +
  "you made, so the bot can count your active days, keep your streak and show how you slept. It reads nothing else and " +
  "never uses it for ads.";
// Apple refuses an upload without this key (ITMS-90683) because the Health library also contains Health's save calls,
// even though X0 Bot never asks to write and never shows this text. It says what is true: nothing is written.
const HEALTH_UPDATE_USAGE =
  "X0 Bot never writes to Apple Health. It only reads your steps, workouts and sleep for a fitness bot you made and switched on.";
const CALENDAR_USAGE =
  "X0 Bot reads when you're busy in your calendar when you turn on Plan around my calendar, so Nudj can plan and call " +
  "around your events. It keeps only the busy times, never event names, and never uses your calendar for ads.";
const REMINDERS_USAGE =
  "X0 Bot keeps one Reminders list, called X0 Bot, in step with your Nudj to-dos when you turn on Sync with Reminders, " +
  "so a to-do you add in either place shows up in both. Its items are treated like your other to-dos, including by AI if you " +
  "allow it. It doesn't open your other lists and never uses Reminders for ads.";
const MOTION_USAGE =
  "X0 Bot uses Motion & Fitness to count your steps for a fitness bot you made, when you choose it instead of Apple Health, " +
  "and, if you turn it on, to check whether you're driving just before Nudj calls, so the call can wait. It never uses " +
  "it for ads.";

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
  // at 8.5 or below, 8.4 included. 8.8 was approved, and Apple closed that train
  // (14 Nov 2026, errors 90186 / 90062), so 8.9 was that build. 8.9.1 is this one: calendar,
  // Reminders, Focus, motion, sleep, arrival reminders and attestation (perms2/SPEC.md). The
  // lookup only sees the LIVE version, never an approved one not yet released: check App
  // Store Connect too.
  version: "8.9.1",
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
      // STILL OUT, each because nothing in the app or its keyboard, share and
      // widget extensions asks for it, and no linked code calls its permission
      // API (checked in node_modules' iOS sources and in targets/ and
      // modules/): Apple Music (only Now Playing and remote commands, no media
      // library), Bluetooth (no CoreBluetooth), local network (a release build
      // talks only to https on x0bot.com; expo-dev-launcher adds its own key to
      // development builds and strips it from release ones), and CONTACTS (see
      // below). Also still out, and named so nobody adds them back by habit:
      // NSLocationAlways* (no background location in this binary),
      // NSFocusStatusUsageDescription (the Focus Filter asks nothing, 4.2),
      // NSCalendarsWriteOnlyAccessUsageDescription (nothing writes through a
      // grant; the editor runs out of process) and
      // NSLocationTemporaryUsageDescriptionDictionary.
      //
      // BACK IN 8.9.1, each with its screen in this same binary and a card before
      // its prompt (perms2/SPEC.md 2-7): CALENDARS, REMINDERS and MOTION, beside
      // LOCATION and HEALTH.
      //  - Location: one foreground fix behind "Use my location" on Nudj's
      //    day-starts card (modules/tulmi-perms, CLLocationManager.requestLocation
      //    plus CLGeocoder), and arrival reminders, which are
      //    UNLocationNotificationTrigger requests the SYSTEM watches — While Using
      //    is all that needs, so no NSLocationAlways* key and no `location`
      //    background mode.
      //  - Health: read-only steps, workouts and nightly sleep minutes behind a
      //    switch on a fitness bot the person made
      //    (@kingstinct/react-native-healthkit).
      //  - Calendars: busy times only (start, end, all-day) behind "Plan around my
      //    calendar" (modules/tulmi-perms, EventKit). iOS 17 has no read-only
      //    calendar grant, so the full-access key is the only read key there is.
      //    "Add to my calendar" needs NO grant at all: EKEventEditViewController
      //    runs out of process on iOS 17+, which is why expo-calendar is still not
      //    in this build (its plugin writes Android READ/WRITE_CALENDAR and the
      //    reminders keys whatever it is passed).
      //  - Reminders: one list X0 Bot makes, called X0 Bot, behind "Sync with
      //    Reminders". iOS has no write-only reminders grant either.
      //  - Motion: CMPedometer and CMMotionActivityManager, behind "Count my steps
      //    with Motion & Fitness" and "Wait while I'm driving". Calling either
      //    without this key crashes, which is why tulmi-perms' abilities() checks
      //    the key is here before it says `motion`.
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
      // AND THE CALL. Nudj calls about anything the call judge thinks
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
      // NSLocationDefaultAccuracyReduced IS GONE IN 8.9.1, and that is the whole
      // reason arrival reminders work. The key made the prompt open on
      // Approximate — and it does not only change the prompt: with it set,
      // EVERY Core Location service runs at reduced accuracy, region monitoring
      // included, so an arrival reminder would be watched against a fix a
      // kilometre wide. So the prompt now opens on Precise, the person can still
      // pick Approximate, and arrivalArm refuses to arm on Approximate and says
      // so (perms2/SPEC.md 7.1). Nothing else changes: the day-starts card still
      // keeps only the area's NAME, never a point, so the privacy label stays
      // Coarse Location with no Precise Location collected.
      // tools/ci/check-config-shape.mjs fails if this key comes back.
      // READ-ONLY steps, workouts and nightly sleep minutes for a fitness bot
      // the person made and switched on. Nothing is ever written to Apple Health
      // and write access is never asked for; the update text exists only because
      // Apple's upload check sees the library's save calls (ITMS-90683). No
      // clinical-records key, and no healthkit entry in
      // UIRequiredDeviceCapabilities — a phone without HealthKit simply never
      // shows the switch. Sleep is asked for in its OWN request, so a refusal of
      // sleep leaves steps working.
      NSHealthShareUsageDescription: HEALTH_USAGE,
      NSHealthUpdateUsageDescription: HEALTH_UPDATE_USAGE,
      // CALENDARS: busy times only, behind "Plan around my calendar". iOS 17
      // offers no read-only calendar grant, so full access is the only read
      // there is — the card, the store documents and the review notes all say
      // the app reads nothing but when events start and end. Both keys carry
      // the SAME text: the new one is what iOS 17+ shows, and the old one is
      // here because EventKit is linked and Apple's upload check may ask for it
      // (N0 item 1 settles whether it is really needed).
      NSCalendarsFullAccessUsageDescription: CALENDAR_USAGE,
      NSCalendarsUsageDescription: CALENDAR_USAGE,
      // REMINDERS: one list X0 Bot makes and keeps, behind "Sync with
      // Reminders". iOS has no write-only reminders grant either, and the module
      // fetches a predicate over that one list and no other. Same two-key
      // reason as calendars.
      NSRemindersFullAccessUsageDescription: REMINDERS_USAGE,
      NSRemindersUsageDescription: REMINDERS_USAGE,
      // MOTION & FITNESS: CMPedometer for a fitness bot's daily steps when Apple
      // Health is not the source, and one CMMotionActivityManager query just
      // before a Nudj call answering "in a car?" yes or no. Nothing else,
      // no places and nothing finer than a day. Touching either API without
      // this key crashes the app, so tulmi-perms' abilities() reads the key out
      // of the running binary before it says `motion` at all.
      NSMotionUsageDescription: MOTION_USAGE,
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
      //
      // NO "location", in 8.9.1 either. Arrival reminders are
      // UNLocationNotificationTrigger requests: the SYSTEM watches the place and
      // shows the notification, and this app is never woken for it. Adding the
      // mode would be a 2.5.4 declaration with no code behind it, so
      // tools/ci/check-config-shape.mjs fails if it ever appears here.
      // "remote-notification" also carries the pre-ring check (perms2/SPEC.md
      // 5.3): a silent push about 30 seconds before a Nudj call, answered
      // "driving" or "not driving" and "a Focus is on" or not. Best effort, and
      // the server rings as it does today when no answer comes.
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
      // Focus and the Scheduled Summary (Nudj's plan_leave and plan_due,
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
      // APP ATTEST, for abuse and fraud prevention only (perms2/SPEC.md 8.5).
      // DCAppAttestService asks Apple whether a request comes from the real X0
      // Bot on a real device; the server keeps only the ANSWER, never a device
      // id made from the phone. There is no prompt, no usage string and no
      // screen, because nothing about the person is read.
      //
      // "production" is right for every build that matters: TestFlight and App
      // Store builds always use the production environment whatever this key
      // says, and a development build without the key falls back to the
      // sandbox. check-config-shape.mjs pins the value, so a stray "development"
      // cannot ship. EAS turns the capability on for the App ID from this key,
      // as it did for time-sensitive and HealthKit; if its sync fails, the App
      // ID gets it by hand in the day-1 signing session.
      //
      // DeviceCheck needs no entitlement and Play Integrity no manifest entry,
      // so this one key is the whole native declaration for attestation.
      "com.apple.developer.devicecheck.appattest-environment": "production",
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
      // Sleep, behind its OWN switch and only with the one above on too (see
      // TULMI_ANDROID_HEALTH_SLEEP at the top). Nightly minutes asleep for a
      // fitness bot the person switched sleep on for; read only, kept 31 days,
      // deleted when they switch it off. It is its own line on Play's Health
      // Connect form with its own reason, and the build carries it only once Play
      // has answered that line. Never READ_HEALTH_DATA_IN_BACKGROUND and never
      // READ_HEALTH_DATA_HISTORY.
      ...(TULMI_ANDROID_HEALTH_SLEEP ? ["android.permission.health.READ_SLEEP"] : []),
      // CALENDAR, READ ONLY, behind TULMI_ANDROID_CALENDAR (see the top). Busy times for 14 days
      // and nothing else. WRITE_CALENDAR is never here: adding an event is the calendar app's own
      // ACTION_INSERT screen, which needs no permission.
      ...(TULMI_ANDROID_CALENDAR ? ["android.permission.READ_CALENDAR"] : []),
      // MOTION, behind TULMI_ANDROID_MOTION. One person-facing grant for both halves: the step
      // counter (Android 10 refuses the listener without it) and the "in a car?" check.
      ...(TULMI_ANDROID_MOTION ? ["android.permission.ACTIVITY_RECOGNITION"] : []),
      // AND ITS API 24-28 TWIN. android.permission.ACTIVITY_RECOGNITION only exists from API 29;
      // this app's minSdk is 24, and on 24-28 Play services checks its OWN permission of the same
      // name instead (Google's activity-recognition sample declares both for exactly this reason).
      // It is install-time, so nobody is prompted and there is no Play form; without it
      // requestActivityTransitionUpdates fails silently on Android 7, 8 and 9 and the driving check
      // answers "unknown" for ever there. play-services-location declares no permissions of its own,
      // so nothing else brings it in.
      ...(TULMI_ANDROID_MOTION ? ["com.google.android.gms.permission.ACTIVITY_RECOGNITION"] : []),
      // ARRIVAL, behind TULMI_ANDROID_ARRIVAL, which is ON in the shipping profiles from 8.9.1 and
      // needs Play's approved background-location declaration before the release is uploaded (the
      // switch is the build's half; the declaration is the owner's). A geofence needs precise location, and
      // one that fires with the app closed needs "Allow all the time". (RECEIVE_BOOT_COMPLETED is
      // deliberately NOT here: expo-notifications already declares it in every build, with the
      // BOOT_COMPLETED receiver that reschedules this app's own local notifications, so this app
      // must neither add it nor block it — blocking would write tools:node="remove" and take that
      // away from every release.)
      ...(TULMI_ANDROID_ARRIVAL
        ? [
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_BACKGROUND_LOCATION",
          ]
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
      // LOCATION, CONTACTS, ACTIVITY AND THE CALENDAR, blocked so no library can
      // merge them in behind the app's back. ACCESS_NOTIFICATION_POLICY is only
      // for CHANGING Do Not Disturb; reading it with getCurrentInterruptionFilter
      // needs nothing.
      //
      // From 8.9.1 three of these move with their own build switch (see the
      // switches at the top): ACTIVITY_RECOGNITION with TULMI_ANDROID_MOTION,
      // FINE and BACKGROUND location with TULMI_ANDROID_ARRIVAL, READ_CALENDAR
      // with TULMI_ANDROID_CALENDAR. From 8.9.1 the shipping profiles have all
      // three ON, so those permissions ARE in the release candidate's merged
      // manifest and are blocked only in a build whose own switch is off (the
      // `development` profile, and anything that sets none of them).
      // WRITE_CALENDAR and
      // FOREGROUND_SERVICE_LOCATION are blocked whatever the switches say.
      // RECEIVE_BOOT_COMPLETED is neither declared nor blocked by this app:
      // expo-notifications declares it, and the receivers behind the two switches
      // use it.
      //
      // FOREGROUND_SERVICE_LOCATION and the two contacts permissions stay blocked
      // in EVERY build, whatever the 8.9.1 switches say: there is no location
      // foreground service in the binary, and the contact picker runs outside the
      // app (ACTION_PICK), so declaring either contacts permission is what Play's
      // 2027 picker rule and Apple's 5.1.1(iii) both refuse.
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.READ_CONTACTS",
      "android.permission.WRITE_CONTACTS",
      // THE THREE THAT NOW MOVE WITH THEIR SWITCH. `permissions` above only ADDS,
      // so only tools:node="remove" takes one out of the MERGED manifest — a
      // library could merge it in, and a prebuild run after an ON prebuild without
      // --clean would keep yesterday's entry. Each is blocked whenever its own
      // switch is off, and must not appear here when it is on.
      //
      // ACTIVITY_RECOGNITION: the step counter and the "in a car?" check
      // (TULMI_ANDROID_MOTION), with the API 24-28 Play services twin beside it so
      // neither can be left behind by a prebuild over an older native folder.
      ...(TULMI_ANDROID_MOTION
        ? []
        : [
            "android.permission.ACTIVITY_RECOGNITION",
            "com.google.android.gms.permission.ACTIVITY_RECOGNITION",
          ]),
      // FINE and BACKGROUND location: arrival reminders only (TULMI_ANDROID_ARRIVAL),
      // which is on in the shipping profiles from 8.9.1 and needs Play's approved
      // background-location declaration before the release is uploaded. "Use my
      // location" still asks for COARSE and nothing more, on every build.
      ...(TULMI_ANDROID_ARRIVAL
        ? []
        : ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_BACKGROUND_LOCATION"]),
      // READ_CALENDAR: "Plan around my calendar" (TULMI_ANDROID_CALENDAR).
      // WRITE_CALENDAR is blocked in every build, switch or no switch: nothing in
      // this app writes to a calendar — "Add to my calendar" is the calendar app's
      // own ACTION_INSERT screen, which has no access at all.
      ...(TULMI_ANDROID_CALENDAR ? [] : ["android.permission.READ_CALENDAR"]),
      "android.permission.WRITE_CALENDAR",
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
      // READ_SLEEP, blocked whenever ITS switch is off — which includes every
      // build with TULMI_ANDROID_HEALTH off, because sleep only means anything
      // with health on. Same reason as the two above: `permissions` only adds,
      // so only tools:node="remove" takes it out of the merged manifest, and a
      // release that carries a permission Play has not approved on the Health
      // Connect form is refused.
      ...(TULMI_ANDROID_HEALTH_SLEEP ? [] : ["android.permission.health.READ_SLEEP"]),
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
    // monochromeImage is Android 13+'s themed icon: the launcher throws our colours away and tints ONE shape to
    // the wallpaper, so the layer is the bot's silhouette in flat white on nothing. It is drawn smaller than the
    // other two on purpose — an adaptive layer only ever shows its middle 72 of 108, and art at this one's full
    // width came out with the dots over the edge and the feelers cut off. Without it Android 13+ draws our black
    // icon untinted beside a screen of tinted ones, which is the one place the app looks unfinished.
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-icon-background.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#0A0A0A",
    },
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
    // META OFF THE IPHONE, whatever META_APP_ID and META_CLIENT_TOKEN are set to for the build. Both Meta plugins
    // stay at the end of this list, so the Android build is unchanged; this takes the iOS half back out — the
    // Facebook keys, the tracking prompt's string, the Meta SKAdNetwork ids and the fb scheme — and package.json's
    // expo.autolinking.ios.exclude keeps the two pods and Meta's launch hook out of the iPhone project, so there is
    // no Meta code in that binary either. App Review 2.5.19: nothing dormant, and nothing a server knob can turn on
    // after approval.
    //
    // FIRST IN THIS LIST ON PURPOSE, which is what makes it run LAST: Expo composes an `Info.plist` mod so that the
    // plugin registered later runs earlier (@expo/config-plugins' withMod calls `nextMod` after its own action). At
    // the end of the list the Meta plugins wrote their keys back in again, which this check caught.
    "./plugins/withNoMetaIos",
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
    // Still no expo-contacts, expo-calendar, expo-location or expo-sensors, and
    // every feature they would carry is in this build anyway — all of it in
    // modules/tulmi-perms, which is reached only through src/device/natives.ts:
    //  - contacts is the system picker (modules/tulmi-perms), so no permission
    //    at all; expo-contacts' plugin adds READ_CONTACTS *and* WRITE_CONTACTS,
    //    and its picker needs READ_CONTACTS on Android.
    //  - location is one fix in that same module, about 150 lines, plus arrival
    //    reminders — UserNotifications on iPhone, and on Android a GeofencingClient
    //    behind TULMI_ANDROID_ARRIVAL; expo-location's plugin writes
    //    NSLocationAlways* and NSMotionUsageDescription unless each is passed
    //    false, merges ACCESS_FINE_LOCATION and a LocationTaskService with
    //    foregroundServiceType="location", and links the Always/background
    //    APIs, which is the ITMS-90683 refusal this file warns about above.
    //  - calendar and reminders are EventKit in that module: busy times (and on
    //    Android CalendarContract.Instances behind TULMI_ANDROID_CALENDAR, read
    //    only), and an out-of-process editor that needs no grant.
    //    expo-calendar's plugin writes the reminders keys and Android
    //    READ_CALENDAR *and* WRITE_CALENDAR whatever it is passed — and this app
    //    must never carry WRITE_CALENDAR — and it keeps its own calendar on the
    //    server besides.
    //  - motion is CMPedometer and CMMotionActivityManager in that module, and on
    //    Android TYPE_STEP_COUNTER plus Play services' activity transitions behind
    //    TULMI_ANDROID_MOTION. expo-sensors has no activity types at all, and its
    //    Android pedometer would want ACTIVITY_RECOGNITION on its own terms.
    //  - attestation is DeviceCheck, App Attest and Play Integrity in that same
    //    module (perms2/SPEC.md 8.5). No npm package: @expo/app-integrity has no
    //    DeviceCheck, no config plugin, and pins an older Play Integrity.
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
    // replace it with "X0 Bot wants to read your health data", the update
    // string says nothing is written (Apple requires the key; write access is
    // never requested), and
    // background:false leaves out the background-delivery entitlement, so the
    // core pod's launch hook has no type to observe. The package has no Android
    // code; Health Connect is the Android half, behind the build switch.
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription: HEALTH_USAGE,
        NSHealthUpdateUsageDescription: HEALTH_UPDATE_USAGE,
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
    // The rationale screen when the health switch is on, Health Connect's Expo half out when it is
    // off, and the two 8.9.1 receivers (motion transitions, geofence arrival + boot) only in a build
    // whose own switch is on. Each branch undoes the other, for a developer machine running prebuild
    // over native folders that are already there.
    [
      "./modules/tulmi-perms/plugin/withTulmiPerms",
      {
        androidHealth: TULMI_ANDROID_HEALTH,
        androidMotion: TULMI_ANDROID_MOTION,
        androidArrival: TULMI_ANDROID_ARRIVAL,
      },
    ],
    "./modules/withPrivacyManifest",
    "@bacons/apple-targets",
    // ANDROID'S META SDK. Everything the iPhone half of these two would write is taken back out by
    // ./plugins/withNoMetaIos at the top of this list.
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
    // THE REVENUECAT KEYS ARE NOT HERE, AND MUST NOT COME BACK.
    //
    // They used to be baked from the environment like the two above, and `eas update` re-evaluates this config on
    // every publish — so an update built on a machine without the variables replaced a working key with an empty
    // string on every phone that took it. Purchases stopped, nobody had touched billing, and the message blamed a
    // build that was fine (billing/purchases.ts tells that story).
    //
    // The guard added then was worse than the bug: the release refused to publish for a platform whose key it could
    // not read, which let a PAYMENT key decide who got JavaScript. A variable stored as "secret" on expo.dev reads
    // empty through `eas env:exec`, so Android was dropped from every update for two months.
    //
    // The server sends them now (bootstrap `billing.revenueCatKey.ios` / `.android`, from its own .env) and the app
    // takes them at boot. Nothing here to lose means no guard to need: an update cannot clobber a key, a release
    // cannot be held up by one, and the key lives in exactly one place.
    // Only when the SDK is configured in this build (metaPlugin above). ANDROID READS IT AND THE IPHONE DOES NOT:
    // src/telemetry/meta.ts leaves at once on iOS, where the binary has no Meta SDK to start. The id is not a secret
    // and one config serves both platforms, so it is left as it is rather than branched on an environment variable
    // that only EAS sets.
    metaAppId: metaPlugin.length ? META_APP_ID : "",
  },
};

export default config;
