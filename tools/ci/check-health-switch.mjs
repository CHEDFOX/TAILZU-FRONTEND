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

/** What the config plugin excludes from Expo autolinking with the switch off. */
async function pluginExcludes() {
  const require = createRequire(join(app, "package.json"));
  const withTulmiPerms = require("./modules/tulmi-perms/plugin/withTulmiPerms");
  const config = withTulmiPerms({ name: "x", slug: "x", mods: {} }, { androidHealth: false });
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

function autolinking(args, on) {
  const out = execFileSync("npx", ["expo-modules-autolinking", ...args, "-p", "android", "--json"], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, TULMI_ANDROID_HEALTH: on ? "on" : "" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

/** The Expo half: linked unless the plugin's exclude takes it out. */
function expoHalf(on, exclude) {
  const args = ["resolve", ...(on ? [] : exclude.flatMap((name) => ["--exclude", name]))];
  const list = autolinking(args, on).modules ?? [];
  return list.some((m) => (m.packageName ?? m.name) === PACKAGE);
}

/** The React Native half: linked unless app/react-native.config.js takes it out. */
function nativeHalf(on) {
  return PACKAGE in (autolinking(["react-native-config"], on).dependencies ?? {});
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

for (const on of [true, false]) {
  const expo = expoHalf(on, exclude);
  const native = nativeHalf(on);
  const where = `TULMI_ANDROID_HEALTH=${on ? "on" : "off"}`;
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
    console.log(`::error::${where}: Health Connect is ${expo ? "linked" : "not linked"}, which is the wrong way round.`);
    bad = true;
    continue;
  }
  console.log(`${where}: Health Connect ${on ? "linked, both halves" : "not linked, neither half"}.`);
}
process.exit(bad ? 1 : 0);
