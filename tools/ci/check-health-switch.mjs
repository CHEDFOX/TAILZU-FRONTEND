// The Android health build switch has to be all or nothing.
//
//   node tools/ci/check-health-switch.mjs
//
// react-native-health-connect comes in two halves that are linked by two
// different mechanisms: the React Native module under android/ (React Native
// autolinking, which app/react-native.config.js can turn off) and an Expo
// module under android-expo/ that sets the permission delegate (Expo
// autolinking, which app/modules/tulmi-perms/plugin/withTulmiPerms.js turns off
// by writing expoAutolinking.exclude into settings.gradle). The Expo half
// declares `implementation project(':react-native-health-connect')`, so a build
// that links one and not the other dies at Gradle configuration time — and the
// Kotlin job only compiles the switch-off shape, so nothing else would catch it.
//
// This asks both autolinkers, for both values of TULMI_ANDROID_HEALTH, and
// fails unless the two halves agree: both in with the switch on, both out with
// it off. No Gradle, no Android SDK, a few seconds.
//
// AND THE SLEEP SWITCH (perms2/SPEC.md 10.1). From 8.9.1 there is a second switch,
// TULMI_ANDROID_HEALTH_SLEEP, because steps-and-exercise and sleep are separate
// lines on Play's Health Connect form with separate answers. It must change
// nothing but one permission: it links no library half of its own, and it only
// means anything with TULMI_ANDROID_HEALTH on. So the autolinking question is
// asked with sleep on as well — the answer has to be the same — and
// READ_SLEEP is read out of the resolved app config for the three combinations
// that can ship (health off; health on and sleep off; both on) plus the one that
// must not happen by accident (sleep on, health off), which has to come out the
// same as health off. `expo config --json` runs the plugin chain's static half,
// which is where app.config.ts's two permission lists end up, and takes under a
// second. The merged manifest's own tools:node="remove" entries are
// tools/ci/check-config-shape.mjs's job, and a build PROFILE with sleep on and
// health off is refused by tools/ci/check-runtime.mjs.
//
// The exclude is NOT written out here. It is read back from what the config
// plugin's own settings mod writes over the Expo template's settings.gradle,
// so deleting the plugin entry, its off branch or its anchor fails this check
// instead of only the real Gradle build.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const PACKAGE = "react-native-health-connect";
const SLEEP_READ = "android.permission.health.READ_SLEEP";

/**
 * The Expo template's android/settings.gradle, which `expo prebuild` writes and
 * the plugin's mod then edits. It ships as a tarball, so this pulls the one file
 * out of it (ustar: 512-byte header, name first, size in octal at offset 124).
 */
function templateSettingsGradle() {
  const prebuilt = join(app, "android", "settings.gradle");
  if (existsSync(prebuilt)) return readFileSync(prebuilt, "utf8");
  const tar = gunzipSync(readFileSync(join(app, "node_modules", "expo", "template.tgz")));
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = tar.toString("utf8", at, at + 100).replace(/\0.*$/, "");
    if (!name) break;
    const size = parseInt(tar.toString("utf8", at + 124, at + 136).replace(/\0.*$/, "").trim(), 8) || 0;
    const body = at + 512;
    if (name.endsWith("android/settings.gradle")) return tar.toString("utf8", body, body + size);
    at = body + Math.ceil(size / 512) * 512;
  }
  throw new Error("android/settings.gradle is not in expo/template.tgz");
}

/**
 * What the config plugin excludes from Expo autolinking with the health switch off.
 *
 * `props` lets the three 8.9.1 Android switches be turned on in the same call, to prove that none of
 * them touches this: calendar, motion and arrival add no npm package and no autolinking half — two
 * manifest receivers and two Gradle properties, and nothing else — so what is excluded must be the
 * same whatever they say (perms2/ANDROID-WIRING.md 10.2).
 */
async function pluginExcludes(props = {}) {
  const require = createRequire(join(app, "package.json"));
  const withTulmiPerms = require("./modules/tulmi-perms/plugin/withTulmiPerms");
  const config = withTulmiPerms({ name: "x", slug: "x", mods: {} }, { androidHealth: false, ...props });
  const mod = config.mods?.android?.settingsGradle;
  if (!mod) throw new Error("withTulmiPerms wrote no settings.gradle mod with the switch off.");
  const out = await mod({
    ...config,
    modRequest: { platform: "android", projectRoot: app, modName: "settingsGradle", platformProjectRoot: app },
    modResults: { language: "groovy", path: "settings.gradle", contents: templateSettingsGradle() },
  });
  const line = /^expoAutolinking\.exclude\s*=\s*\[([^\]]*)\]/m.exec(out.modResults.contents);
  if (!line) return [];
  return [...line[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function env(on, sleep) {
  return {
    ...process.env,
    TULMI_ANDROID_HEALTH: on ? "on" : "",
    TULMI_ANDROID_HEALTH_SLEEP: sleep ? "on" : "",
    // The three 8.9.1 Android switches are pinned OFF for every run here: this check is about which
    // halves of Health Connect are linked, and a value left in the shell must not change what it
    // sees. That none of the three moves a library half is proved below instead.
    TULMI_ANDROID_CALENDAR: "",
    TULMI_ANDROID_MOTION: "",
    TULMI_ANDROID_ARRIVAL: "",
  };
}

function autolinking(args, on, sleep) {
  const out = execFileSync("npx", ["expo-modules-autolinking", ...args, "-p", "android", "--json"], {
    cwd: app,
    encoding: "utf8",
    env: env(on, sleep),
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

/** The Expo half: linked unless the plugin's exclude takes it out. */
function expoHalf(on, sleep, exclude) {
  const args = ["resolve", ...(on ? [] : exclude.flatMap((name) => ["--exclude", name]))];
  const list = autolinking(args, on, sleep).modules ?? [];
  return list.some((m) => (m.packageName ?? m.name) === PACKAGE);
}

/** The React Native half: linked unless app/react-native.config.js takes it out. */
function nativeHalf(on, sleep) {
  return PACKAGE in (autolinking(["react-native-config"], on, sleep).dependencies ?? {});
}

/**
 * The two permission lists app.config.ts resolves to. `expo config --json` runs
 * the plugin chain's static half, where both lists live, and leaves the native
 * mods to prebuild — so this is where READ_SLEEP can be read in under a second.
 */
function permissionLists(on, sleep) {
  const out = execFileSync("npx", ["expo", "config", "--json"], {
    cwd: app,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: env(on, sleep),
    stdio: ["ignore", "pipe", "ignore"],
  });
  const android = JSON.parse(out).android ?? {};
  return { asked: android.permissions ?? [], blocked: android.blockedPermissions ?? [] };
}

const exclude = await pluginExcludes();
let bad = false;

if (!exclude.includes(PACKAGE)) {
  console.log(
    `::error::With TULMI_ANDROID_HEALTH off, app/modules/tulmi-perms/plugin/withTulmiPerms.js writes ` +
      `expoAutolinking.exclude = [${exclude.map((n) => `'${n}'`).join(", ")}], which does not hold ` +
      `${PACKAGE}. The Expo half would stay linked in a build that has no React Native half.`
  );
  bad = true;
}
console.log(`The plugin excludes from Expo autolinking with the switch off: ${exclude.join(", ") || "(nothing)"}.`);

// THE THREE 8.9.1 ANDROID SWITCHES MOVE NO LIBRARY HALF. Each adds a manifest receiver and a Gradle
// property, and that is all: no npm package, no autolinking half. If one of them ever started
// touching `expoAutolinking.exclude`, Health Connect's two halves could part company behind the
// health switch's back, which is the failure the rest of this file exists to catch.
const withAll = await pluginExcludes({ androidMotion: true, androidArrival: true });
if (withAll.join("\u0000") !== exclude.join("\u0000")) {
  console.log(
    `::error::With the 8.9.1 Android switches on, the plugin excludes [${withAll.map((n) => `'${n}'`).join(", ")}] ` +
      `instead of [${exclude.map((n) => `'${n}'`).join(", ")}]. Only TULMI_ANDROID_HEALTH may link or unlink a library half.`
  );
  bad = true;
} else {
  console.log("The 8.9.1 Android switches (calendar, motion, arrival) change no Expo autolinking half.");
}

// Both switches, every way round: sleep must never move a library half.
for (const [on, sleep] of [[true, true], [true, false], [false, true], [false, false]]) {
  const expo = expoHalf(on, sleep, exclude);
  const native = nativeHalf(on, sleep);
  const where = `TULMI_ANDROID_HEALTH=${on ? "on" : "off"} SLEEP=${sleep ? "on" : "off"}`;
  if (expo !== native) {
    console.log(
      `::error::${where}: Health Connect's Expo half is ${expo ? "in" : "out"} but its React Native half is ` +
        `${native ? "in" : "out"}. Both have to move together — app/react-native.config.js and ` +
        "app/modules/tulmi-perms/plugin/withTulmiPerms.js."
    );
    bad = true;
    continue;
  }
  if (expo !== on) {
    console.log(
      `::error::${where}: Health Connect is ${expo ? "linked" : "not linked"}, which is the wrong way round. ` +
        "Only TULMI_ANDROID_HEALTH may link or unlink it; the sleep switch is one permission and nothing else."
    );
    bad = true;
    continue;
  }
  console.log(`${where}: Health Connect ${on ? "linked, both halves" : "not linked, neither half"}.`);
}

// READ_SLEEP, across the same four shapes. It is asked for only with both
// switches on, and taken back out of the merged manifest every other time —
// `permissions` only adds, so blockedPermissions is the only thing that removes.
for (const [on, sleep] of [[true, true], [true, false], [false, true], [false, false]]) {
  const where = `TULMI_ANDROID_HEALTH=${on ? "on" : "off"} SLEEP=${sleep ? "on" : "off"}`;
  const want = on && sleep;
  const { asked, blocked } = permissionLists(on, sleep);
  if (asked.includes(SLEEP_READ) !== want) {
    console.log(
      `::error::${where}: ${SLEEP_READ} is ${asked.includes(SLEEP_READ) ? "asked for" : "missing"}, and sleep ships ` +
        "only with both switches on (Play answers steps-and-exercise and sleep on separate lines of the Health " +
        "Connect form). See TULMI_ANDROID_HEALTH_SLEEP in app/app.config.ts."
    );
    bad = true;
    continue;
  }
  if (!want && !blocked.includes(SLEEP_READ)) {
    console.log(
      `::error::${where}: ${SLEEP_READ} is not in blockedPermissions, so a library could merge it into a release ` +
        "Play has not approved sleep for."
    );
    bad = true;
    continue;
  }
  if (want && blocked.includes(SLEEP_READ)) {
    console.log(`::error::${where}: ${SLEEP_READ} is both asked for and blocked.`);
    bad = true;
    continue;
  }
  console.log(`${where}: ${SLEEP_READ} ${want ? "asked for" : "blocked"}.`);
}
process.exit(bad ? 1 : 0);
