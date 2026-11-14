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
// perms/SPEC.md 6.3, 6.5 item 3, rule 1: no usage string, entitlement or
// Android permission without the screen that uses it in the same build.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const HEALTH_READS = ["android.permission.health.READ_STEPS", "android.permission.health.READ_EXERCISE"];
const RATIONALE_ACTIVITY = "expo.modules.tulmiperms.HealthRationaleActivity";
const USAGE_ALIAS = "ViewPermissionUsageActivity";

// Blocked in every build: nothing in the binary reads any of them, and each one
// is a Play declaration or an Apple refusal waiting to happen.
const ALWAYS_REMOVED = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.ACTIVITY_RECOGNITION",
];

// Keys that must never reach Info.plist: the app has no Always location, no
// motion use and no address-book read, so each would be a declaration with no
// screen behind it. (NSHealthUpdateUsageDescription is present on purpose: Apple's
// upload check demands it because the Health library contains save calls; its
// text says nothing is written, and write access is never requested.)
const FORBIDDEN_PLIST = [
  "NSLocationAlwaysUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSContactsUsageDescription",
  "NSMotionUsageDescription",
  "NSHealthClinicalHealthRecordsShareUsageDescription",
];

function introspect(on) {
  const out = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
    cwd: app,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TULMI_ANDROID_HEALTH: on ? "on" : "" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

const bad = [];

for (const on of [true, false]) {
  const where = `TULMI_ANDROID_HEALTH=${on ? "on" : "off"}`;
  const say = (message) => bad.push(`${where}: ${message}`);

  const config = introspect(on);
  const mods = config._internal.modResults;
  const manifest = mods.android.manifest.manifest;
  const application = manifest.application[0];

  const uses = manifest["uses-permission"] ?? [];
  const asked = uses.filter((p) => !p.$["tools:node"]).map((p) => p.$["android:name"]);
  const removed = uses.filter((p) => p.$["tools:node"] === "remove").map((p) => p.$["android:name"]);
  const activities = (application.activity ?? []).map((a) => a.$["android:name"]);
  const aliases = (application["activity-alias"] ?? []).map((a) => a.$["android:name"]);
  const minSdk = (mods.android.gradleProperties ?? []).find((p) => p.key === "android.minSdkVersion")?.value;

  // Location: one coarse fix, and every wider grant taken back out.
  if (!asked.includes("android.permission.ACCESS_COARSE_LOCATION")) say("ACCESS_COARSE_LOCATION is not declared.");
  for (const name of ALWAYS_REMOVED) {
    if (!removed.includes(name)) say(`${name} is not removed from the merged manifest.`);
    if (asked.includes(name)) say(`${name} is declared.`);
  }

  // Health: the two reads, the rationale screen and minSdk 26 move together.
  for (const name of HEALTH_READS) {
    if (on && !asked.includes(name)) say(`${name} is missing.`);
    if (!on && asked.includes(name)) say(`${name} is declared in a build without Health Connect.`);
    if (!on && !removed.includes(name)) say(`${name} is not removed, so a library could merge it in.`);
    if (on && removed.includes(name)) say(`${name} is both declared and removed.`);
  }
  if (activities.includes(RATIONALE_ACTIVITY) !== on) say(`the rationale activity is ${on ? "missing" : "there"}.`);
  if (aliases.includes(USAGE_ALIAS) !== on) say(`${USAGE_ALIAS} is ${on ? "missing" : "there"}.`);
  if (on && minSdk !== "26") say(`android.minSdkVersion is ${minSdk ?? "unset"}, and Health Connect needs 26.`);
  if (!on && minSdk) say(`android.minSdkVersion is pinned to ${minSdk} in a build without Health Connect.`);

  // iPhone: the two strings that have a screen, and nothing else.
  const plist = mods.ios.infoPlist;
  if (!plist.NSLocationWhenInUseUsageDescription) say("NSLocationWhenInUseUsageDescription is missing.");
  if (plist.NSLocationDefaultAccuracyReduced !== true) say("NSLocationDefaultAccuracyReduced is not true.");
  if (!plist.NSHealthShareUsageDescription) say("NSHealthShareUsageDescription is missing.");
  for (const key of FORBIDDEN_PLIST) if (key in plist) say(`${key} is in Info.plist, with no screen behind it.`);

  // HealthKit, read only: the capability but never background delivery.
  const entitlements = mods.ios.entitlements;
  if (entitlements["com.apple.developer.healthkit"] !== true) say("the HealthKit entitlement is missing.");
  if ("com.apple.developer.healthkit.background-delivery" in entitlements) {
    say("the HealthKit background-delivery entitlement is there, and nothing asks for background health.");
  }
  if ("com.apple.developer.healthkit.access" in entitlements) say("the HealthKit clinical-records entitlement is there.");

  console.log(`${where}: read ${asked.length} permissions, ${removed.length} removed, minSdk ${minSdk ?? "default"}.`);
}

for (const line of bad) console.log(`::error::${line}`);
if (bad.length) {
  console.log(`::error::app/app.config.ts and its plugins resolve to the wrong shape (${bad.length} problems).`);
  process.exit(1);
}
console.log("Both switch values resolve to the shape perms/SPEC.md 6.3 describes.");
