// What app.config.ts and the config plugins really resolve to, for both values
// of the Android health build switch.
//
//   node tools/ci/check-config-shape.mjs
//
// Every line here is a store-review promise, and every one of them is written
// by a conditional in app.config.ts or by a plugin that can be reordered,
// removed or replaced by a library's own. `expo config --type introspect` runs
// the whole plugin chain the way `expo prebuild` does and prints the resulting
// manifest, Info.plist, entitlements and Gradle properties, so this check sees
// what the binary would declare without building one. No Gradle, no Xcode.
//
// perms/SPEC.md 6.3, 6.5 item 3, rule 1 and perms2/SPEC.md 10.1: no usage
// string, entitlement or Android permission without the screen that uses it in
// the same build.
//
// SEVEN SWITCH COMBINATIONS from 8.9.1, not two. Android health and Android sleep
// have a switch each (perms2/SPEC.md 10.1), because steps and exercise and sleep
// are separate lines on Play's Health Connect form with separate answers. Sleep
// only means anything with health on, so the health shapes that can ship are:
// health off; health on and sleep off; both on. The fourth, sleep on with health
// off, has to resolve to the first — tools/ci/check-health-switch.mjs proves that
// one and tools/ci/check-runtime.mjs refuses such a build profile outright.
//
// Then the three ANDROID PERMISSION SWITCHES of 8.9.1 — calendar, motion and
// arrival (perms2/ANDROID-WIRING.md) — each independent, because what
// holds an Android permission up is Play and Play answers each declaration on its
// own clock. Four more runs cover them: two that exercise them in pairs, so a
// permission that leaks across switches is not hidden by a run where everything
// is on; THE SHIPPING SHAPE — those three on with health and sleep off, which is
// what app/eas.json's `preview` and `production` profiles build from 8.9.1, so the
// release candidate's own merged manifest is read here and not inferred; and THE
// n0 SHAPE — all five switches on, the one build that carries every new permission
// at once. Without the last two a cross-switch interaction in the builds that
// really have them would pass CI.
//
// COST: seven `expo config --type introspect` runs instead of three, a few seconds
// each. The four Android runs may be dropped from a pre-commit path and kept in
// CI — but not dropped altogether: they are the only thing that proves a release
// candidate's merged manifest asks for nothing it has no screen for.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const HEALTH_READS = ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE"];
const SLEEP_READ = "android.permission.health.READ_SLEEP";
const RATIONALE_ACTIVITY = "expo.modules.tulmiperms.HealthRationaleActivity";
const USAGE_ALIAS = "ViewPermissionUsageActivity";

// Blocked in EVERY build, whatever the 8.9.1 Android switches say: nothing in the
// binary reads any of them, and each one is a Play declaration or an Apple
// refusal waiting to happen. FINE and BACKGROUND location and
// ACTIVITY_RECOGNITION LEFT this list in 8.9.1 — each now has a screen behind it
// in a build whose own switch is on, and SWITCHED below holds them to that.
const ALWAYS_REMOVED = [
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  // Nothing in this app writes to a calendar in any build: "Add to my calendar"
  // is the calendar app's own ACTION_INSERT screen, which has no access at all.
  // READ moves with its switch; WRITE never moves.
  "android.permission.WRITE_CALENDAR",
];

// THE THREE 8.9.1 ANDROID SWITCHES, and what moves with each. On: declared and
// NOT removed. Off: removed and NOT declared. There is no third shape, and a
// permission with no switch behind it is rule 1 — "no declaration without its
// screen".
const SWITCHED = {
  calendar: ["android.permission.READ_CALENDAR"],
  motion: [
    "android.permission.ACTIVITY_RECOGNITION",
    // The API 24-28 twin: on Android 7, 8 and 9 this is the one Play services
    // checks, and android.permission.ACTIVITY_RECOGNITION does not exist yet.
    "com.google.android.gms.permission.ACTIVITY_RECOGNITION",
  ],
  arrival: [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
  ],
};

// RECEIVE_BOOT_COMPLETED IS IN NEITHER LIST, ON PURPOSE. The two receivers do
// have BOOT_COMPLETED filters, but expo-notifications already declares the
// permission in every build (with its own boot receiver, which reschedules this
// app's local notifications), so this app must neither declare it nor block it —
// and `expo config --type introspect` cannot see a library's manifest anyway, so
// a check here would be reading nothing.

// A receiver only in the build that has its feature. Written by the config
// plugin, so deleting its branch fails this check rather than only the real
// Gradle build.
const RECEIVERS = {
  motion: "expo.modules.tulmiperms.TulmiMotionReceiver",
  arrival: "expo.modules.tulmiperms.TulmiArrivalReceiver",
};

// AND THE GRADLE PROPERTY BESIDE EACH RECEIVER, which is what stops the manifest
// and the compiled source sets disagreeing. The receivers are written at PREBUILD
// time from app.config.ts's env; Gradle runs later and may run with a different
// environment, so modules/tulmi-perms/android/build.gradle picks its source set
// from these properties rather than from the env. If one of them ever stopped
// following its switch, a build could declare TulmiArrivalReceiver — exported
// false, with a BOOT_COMPLETED filter — while compiling src/arrivalOff instead,
// and the first reboot would crash the app with ClassNotFoundException.
const SWITCH_PROPERTIES = {
  motion: "tulmi.androidMotion",
  arrival: "tulmi.androidArrival",
};

// Keys that must never reach Info.plist: the app has no Always location, no
// address-book read and no Focus Status, so each would be a declaration with no
// screen behind it. (NSHealthUpdateUsageDescription is present on purpose: Apple's
// upload check demands it because the Health library contains save calls; its
// text says nothing is written, and write access is never requested.)
//
// NSMotionUsageDescription LEFT this list in 8.9.1: Motion & Fitness now has two
// screens behind it, a fitness bot's steps without Apple Health and the "in a
// car?" check before a Nudj call, so it is required below instead.
// NSFocusStatusUsageDescription joined it: the Focus Filter asks nothing and
// Focus Status is deliberately not used (perms2/SPEC.md 0, change 1).
// NSCalendarsWriteOnlyAccessUsageDescription joined it too: nothing writes a
// calendar through a grant — "Add to my calendar" is the system editor, out of
// process, with no access at all. If N0 item 1 shows Apple's upload check
// demanding that key anyway, it moves to REQUIRED_PLIST with the truthful text
// from 10.6, in the same change.
const FORBIDDEN_PLIST = [
  "NSLocationAlwaysUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSLocationTemporaryUsageDescriptionDictionary",
  "NSContactsUsageDescription",
  "NSFocusStatusUsageDescription",
  "NSCalendarsWriteOnlyAccessUsageDescription",
  "NSHealthClinicalHealthRecordsShareUsageDescription",
];

// Keys that must be there, each with the screen named beside it. Every one is
// read by tulmi-perms' abilities() out of the running binary before the phone
// declares the matching capability, so a key cut here takes its feature's row
// off the screen by itself (perms2/SPEC.md 9.2).
const REQUIRED_PLIST = {
  NSLocationWhenInUseUsageDescription: 'Nudj\'s "Use my location", and arrival reminders',
  NSHealthShareUsageDescription: "a fitness bot's Apple Health switch",
  NSCalendarsFullAccessUsageDescription: '"Plan around my calendar" (iOS offers no read-only grant)',
  NSCalendarsUsageDescription: "the same, under the pre-iOS-17 key EventKit's upload scan may ask for",
  NSRemindersFullAccessUsageDescription: '"Sync with Reminders" (iOS offers no write-only grant)',
  NSRemindersUsageDescription: "the same, under the older key",
  NSMotionUsageDescription: '"Count my steps with Motion & Fitness" and "Wait while I\'m driving"',
};

// The App Attest environment, pinned. TestFlight and App Store builds use
// production whatever this says, so a stray "development" would only mislead
// whoever read the entitlements next (perms2/SPEC.md 8.5).
const APP_ATTEST_KEY = "com.apple.developer.devicecheck.appattest-environment";

function introspect(health, sleep, extra = {}) {
  const out = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
    cwd: app,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Every switch is set EXPLICITLY, so a value left in the shell cannot change
    // what a check sees. The two Meta variables included: an id left in the shell
    // would otherwise put Meta in the shape every other run reads.
    env: {
      ...process.env,
      TULMI_ANDROID_HEALTH: health ? "on" : "",
      TULMI_ANDROID_HEALTH_SLEEP: sleep ? "on" : "",
      TULMI_ANDROID_CALENDAR: extra.calendar ? "on" : "",
      TULMI_ANDROID_MOTION: extra.motion ? "on" : "",
      TULMI_ANDROID_ARRIVAL: extra.arrival ? "on" : "",
      META_APP_ID: extra.metaAppId ?? "",
      META_CLIENT_TOKEN: extra.metaAppId ? "test-client-token" : "",
    },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

// META IS AN ANDROID-ONLY SDK (app/plugins/withNoMetaIos.js). Every Info.plist key
// the two Meta plugins write, and which must not be in an iPhone build whatever
// META_APP_ID is set to: a binary that CAN ask to track and never asks is App
// Review 2.5.19, the manifest says NSPrivacyTracking false, the App Privacy
// answers say "Data Used to Track You: none" and the policy says the iPhone shows
// no tracking prompt. This is the check that keeps all four true.
const META_PLIST = [
  "FacebookAppID",
  "FacebookClientToken",
  "FacebookDisplayName",
  "FacebookAutoInitEnabled",
  "FacebookAutoLogAppEventsEnabled",
  "FacebookAdvertiserIDCollectionEnabled",
  "NSUserTrackingUsageDescription",
];
/** Meta's SKAdNetwork ids and the query schemes its SDK adds. `fb-messenger` is the app's own (the share sheet). */
const META_SKADNETWORK = ["v9wttpbfk9.skadnetwork", "n38lu8286q.skadnetwork"];
const META_QUERY_SCHEMES = ["fbapi", "fb-messenger-api", "fbauth2", "fbshareextension"];
/** A plausible Meta app id for the proof run. Not a real one: nothing is built, only the config resolved. */
const META_TEST_APP_ID = "1234567890";

const bad = [];

// Health off; health on and sleep off; both on. Sleep on with health off is
// check-health-switch.mjs's and check-runtime.mjs's job.
//
// Then the four 8.9.1 Android shapes. Two exercise the switches in pairs —
// calendar with motion, and arrival on its own — so a permission that leaks from
// one switch to another is caught rather than hidden by a run where everything is
// on. The third is THE SHIPPING SHAPE: calendar, motion and arrival on with health
// and sleep off, which is what app/eas.json's `preview` and `production` profiles
// build from 8.9.1, so the release candidate's merged manifest is read here. The
// fourth is THE n0 SHAPE: all five on, exactly what the n0 profile builds, and the
// only build that carries every new permission of 8.9.1 at once.
const RUNS = [
  { health: false, sleep: false },
  { health: true, sleep: false },
  { health: true, sleep: true },
  { health: false, sleep: false, calendar: true, motion: true },
  { health: false, sleep: false, arrival: true },
  // the shipping shape (preview and production)
  { health: false, sleep: false, calendar: true, motion: true, arrival: true },
  // the n0 shape
  { health: true, sleep: true, calendar: true, motion: true, arrival: true },
];
for (const run of RUNS) {
  const on = run.health;
  const sleep = run.sleep;
  const where =
    `TULMI_ANDROID_HEALTH=${on ? "on" : "off"} SLEEP=${sleep ? "on" : "off"}` +
    ` CALENDAR=${run.calendar ? "on" : "off"} MOTION=${run.motion ? "on" : "off"} ARRIVAL=${run.arrival ? "on" : "off"}`;
  const say = (message) => bad.push(`${where}: ${message}`);

  const config = introspect(on, sleep, run);
  const mods = config._internal.modResults;
  const manifest = mods.android.manifest.manifest;
  const application = manifest.application[0];

  const uses = manifest["uses-permission"] ?? [];
  const asked = uses.filter((p) => !p.$["tools:node"]).map((p) => p.$["android:name"]);
  const removed = uses.filter((p) => p.$["tools:node"] === "remove").map((p) => p.$["android:name"]);
  const activities = (application.activity ?? []).map((a) => a.$["android:name"]);
  const receivers = (application.receiver ?? []).map((r) => r.$["android:name"]);
  const aliases = (application["activity-alias"] ?? []).map((a) => a.$["android:name"]);
  const minSdk = (mods.android.gradleProperties ?? []).find((p) => p.key === "android.minSdkVersion")?.value;

  // Location: one coarse fix, and every wider grant taken back out.
  if (!asked.includes("android.permission.ACCESS_COARSE_LOCATION")) say("ACCESS_COARSE_LOCATION is not declared.");
  for (const name of ALWAYS_REMOVED) {
    if (!removed.includes(name)) say(`${name} is not removed from the merged manifest.`);
    if (asked.includes(name)) say(`${name} is declared.`);
  }

  // THE THREE 8.9.1 ANDROID SWITCHES: each permission declared exactly when its
  // switch is on, and removed from the merged manifest otherwise — `permissions`
  // only ADDS, so only tools:node="remove" keeps a library (or yesterday's
  // prebuild) from putting one back.
  for (const [key, names] of Object.entries(SWITCHED)) {
    const want = run[key] === true;
    const label = `TULMI_ANDROID_${key.toUpperCase()}`;
    for (const name of names) {
      if (want && !asked.includes(name)) say(`${name} is missing with ${label} on.`);
      if (want && removed.includes(name)) say(`${name} is both declared and removed.`);
      if (!want && asked.includes(name)) say(`${name} is declared with ${label} off.`);
      if (!want && !removed.includes(name)) say(`${name} is not removed, so a library could merge it in.`);
    }
  }
  // Each receiver in exactly the build that has its feature, and in no other.
  for (const [key, name] of Object.entries(RECEIVERS)) {
    const want = run[key] === true;
    if (receivers.includes(name) !== want) say(`the ${key} receiver is ${want ? "missing" : "there"}.`);
  }
  // And the Gradle property that chooses the source set says the same thing.
  for (const [key, prop] of Object.entries(SWITCH_PROPERTIES)) {
    const want = run[key] === true ? "on" : "off";
    const got = (mods.android.gradleProperties ?? []).find((e) => e.key === prop)?.value;
    if (got !== want) {
      say(`${prop} is ${got ?? "unset"} and should be ${want}, so the manifest and the compiled source set could disagree.`);
    }
  }

  // Health: the two reads, the rationale screen and minSdk 26 move together.
  for (const name of HEALTH_READS) {
    if (on && !asked.includes(name)) say(`${name} is missing.`);
    if (!on && asked.includes(name)) say(`${name} is declared in a build without Health Connect.`);
    if (!on && !removed.includes(name)) say(`${name} is not removed, so a library could merge it in.`);
    if (on && removed.includes(name)) say(`${name} is both declared and removed.`);
  }
  // Sleep: its own switch, and only ever with health on. A release carrying a
  // health permission Play has not answered on the form is refused outright.
  if (sleep && !asked.includes(SLEEP_READ)) say(`${SLEEP_READ} is missing.`);
  if (!sleep && asked.includes(SLEEP_READ)) say(`${SLEEP_READ} is declared in a build without the sleep switch.`);
  if (!sleep && !removed.includes(SLEEP_READ)) say(`${SLEEP_READ} is not removed, so a library could merge it in.`);
  if (sleep && removed.includes(SLEEP_READ)) say(`${SLEEP_READ} is both declared and removed.`);
  if (activities.includes(RATIONALE_ACTIVITY) !== on) say(`the rationale activity is ${on ? "missing" : "there"}.`);
  if (aliases.includes(USAGE_ALIAS) !== on) say(`${USAGE_ALIAS} is ${on ? "missing" : "there"}.`);
  if (on && minSdk !== "26") say(`android.minSdkVersion is ${minSdk ?? "unset"}, and Health Connect needs 26.`);
  if (!on && minSdk) say(`android.minSdkVersion is pinned to ${minSdk} in a build without Health Connect.`);

  // iPhone: every string that has a screen, and nothing else.
  const plist = mods.ios.infoPlist;
  for (const [key, screen] of Object.entries(REQUIRED_PLIST)) {
    if (!plist[key]) say(`${key} is missing, and ${screen} is in this build.`);
  }
  // TURNED ROUND IN 8.9.1, in the same change that took the key out of
  // app.config.ts. It used to fail unless this was true. With it set, EVERY Core
  // Location service runs at reduced accuracy, region monitoring included, so an
  // arrival reminder would be watched against a fix a kilometre wide
  // (perms2/SPEC.md 7.1). The prompt now opens on Precise, the person may still
  // pick Approximate, and arrivalArm refuses to arm on Approximate and says so.
  // Only the area's NAME is ever stored, so the privacy label is unchanged.
  if ("NSLocationDefaultAccuracyReduced" in plist) {
    say("NSLocationDefaultAccuracyReduced is back, which would run arrival-reminder regions at reduced accuracy.");
  }
  // abilities() reads this very string to decide whether to say `healthSleep`
  // (perms2/SPEC.md 9.2), so the string naming sleep is what keeps the iPhone
  // sleep row drawable. Cutting sleep means cutting it from here too.
  if (plist.NSHealthShareUsageDescription && !/\bsleep\b/i.test(String(plist.NSHealthShareUsageDescription))) {
    say("NSHealthShareUsageDescription does not name sleep, so abilities() will never say healthSleep.");
  }
  // No `location` background mode: arrival reminders are
  // UNLocationNotificationTrigger requests the SYSTEM watches, and the app is
  // never woken. Declaring the mode would be 2.5.4 with no code behind it.
  const modes = plist.UIBackgroundModes ?? [];
  if (modes.includes("location")) say("UIBackgroundModes carries `location`, and nothing reads location in the background.");
  for (const key of FORBIDDEN_PLIST) if (key in plist) say(`${key} is in Info.plist, with no screen behind it.`);

  // HealthKit, read only: the capability but never background delivery.
  const entitlements = mods.ios.entitlements;
  if (entitlements["com.apple.developer.healthkit"] !== true) say("the HealthKit entitlement is missing.");
  // App Attest, for abuse and fraud prevention only. No prompt, no string.
  if (entitlements[APP_ATTEST_KEY] !== "production") {
    say(`${APP_ATTEST_KEY} is ${JSON.stringify(entitlements[APP_ATTEST_KEY] ?? null)}, and it has to be "production".`);
  }
  if ("com.apple.developer.healthkit.background-delivery" in entitlements) {
    say("the HealthKit background-delivery entitlement is there, and nothing asks for background health.");
  }
  if ("com.apple.developer.healthkit.access" in entitlements) say("the HealthKit clinical-records entitlement is there.");

  console.log(`${where}: read ${asked.length} permissions, ${removed.length} removed, minSdk ${minSdk ?? "default"}.`);
}

// A SEVENTH RUN, FOR META. Every run above leaves META_APP_ID empty, which is
// what the release is built with — so none of them would notice the day someone
// sets it for an iPhone build. This one sets it, and proves the iPhone shape is
// the same either way: no Facebook key, no tracking string, no Meta SKAdNetwork
// id, no fb scheme, while the Android half is still written. App Review 2.5.19,
// and the privacy manifest, the App Privacy answers and the policy all say the
// iPhone app has no tracking in it.
{
  const where = "META_APP_ID set";
  const say = (message) => bad.push(`${where}: ${message}`);
  const config = introspect(false, false, { metaAppId: META_TEST_APP_ID });
  const mods = config._internal.modResults;
  const plist = mods.ios.infoPlist;

  for (const key of META_PLIST) {
    if (key in plist) say(`${key} is in Info.plist, and Meta ships on Android only.`);
  }
  for (const item of plist.SKAdNetworkItems ?? []) {
    const id = String(item?.SKAdNetworkIdentifier ?? "").toLowerCase();
    if (META_SKADNETWORK.includes(id)) say(`SKAdNetworkItems carries Meta's ${id}.`);
  }
  for (const scheme of plist.LSApplicationQueriesSchemes ?? []) {
    if (META_QUERY_SCHEMES.includes(String(scheme))) say(`LSApplicationQueriesSchemes carries the SDK's ${scheme}.`);
  }
  for (const entry of plist.CFBundleURLTypes ?? []) {
    for (const scheme of entry?.CFBundleURLSchemes ?? []) {
      if (/^fb\d+$/.test(String(scheme))) say(`CFBundleURLTypes carries the Meta scheme ${scheme}.`);
    }
  }
  // The app's own share-sheet scheme is NOT the SDK's, and must survive.
  if (!(plist.LSApplicationQueriesSchemes ?? []).includes("fb-messenger")) {
    say("fb-messenger is gone from LSApplicationQueriesSchemes, and that one is the share sheet's.");
  }
  // ...and Android still gets Meta, exactly as before. The app id string is the
  // plugin's Android half; losing it would break ad attribution there silently.
  const strings = mods.android.strings?.resources?.string ?? [];
  const named = strings.map((s) => s?.$?.name);
  for (const name of ["facebook_app_id", "facebook_client_token"]) {
    if (!named.includes(name)) say(`Android's ${name} string is missing, so Meta is off Android too.`);
  }
  const androidAsked = (mods.android.manifest.manifest["uses-permission"] ?? [])
    .filter((p) => !p.$["tools:node"]).map((p) => p.$["android:name"]);
  if (!androidAsked.includes("com.google.android.gms.permission.AD_ID")) {
    say("Android's AD_ID permission is missing, so the advertising id Meta credits installs with is gone.");
  }
  console.log(`${where}: iPhone carries no Meta or tracking key; Android keeps its app id string and AD_ID.`);
}

for (const line of bad) console.log(`::error::${line}`);
if (bad.length) {
  console.log(`::error::app/app.config.ts and its plugins resolve to the wrong shape (${bad.length} problems).`);
  process.exit(1);
}
console.log("All seven switch combinations resolve to the shape perms/SPEC.md 6.3, perms2/SPEC.md 10.1 and perms2/ANDROID-WIRING.md describe, and Meta stays off the iPhone.");
