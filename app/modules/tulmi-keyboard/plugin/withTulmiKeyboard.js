/**
 * Expo config plugin: wires the native Tulmi keyboard (Android IME) into the
 * prebuilt Android project. This runs during `expo prebuild` / EAS build, so
 * managed builds keep working.
 *
 * It (1) adds RECORD_AUDIO/INTERNET permissions, (2) enables cleartext HTTP for
 * dev, (3) registers the IME <service> in the manifest, and (4) copies the
 * Kotlin + resources from ../android into the Android project.
 */
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SERVICE = "com.tulmi.app.keyboard.TulmiKeyboardService";
const JAVA_PKG_PATH = path.join("com", "tulmi", "app", "keyboard");

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app["$"]["android:usesCleartextTraffic"] = "true";
    app.service = app.service || [];
    const already = app.service.some(
      (s) => s["$"] && s["$"]["android:name"] === SERVICE,
    );
    if (!already) {
      app.service.push({
        $: {
          "android:name": SERVICE,
          "android:label": "Tulmi Keyboard",
          "android:permission": "android.permission.BIND_INPUT_METHOD",
          "android:exported": "true",
        },
        "intent-filter": [
          { action: [{ $: { "android:name": "android.view.InputMethod" } }] },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.view.im",
              "android:resource": "@xml/method",
            },
          },
        ],
      });
    }
    return cfg;
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function withNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const moduleDir = path.join(
        cfg.modRequest.projectRoot,
        "modules",
        "tulmi-keyboard",
        "android",
      );
      const androidMain = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
      );

      const javaDest = path.join(androidMain, "java", JAVA_PKG_PATH);
      fs.mkdirSync(javaDest, { recursive: true });
      for (const f of ["TulmiKeyboardService.kt", "Net.kt", "Stream.kt"]) {
        fs.copyFileSync(path.join(moduleDir, f), path.join(javaDest, f));
      }
      copyDir(path.join(moduleDir, "res"), path.join(androidMain, "res"));
      return cfg;
    },
  ]);
}

module.exports = function withTulmiKeyboard(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.RECORD_AUDIO",
    "android.permission.INTERNET",
  ]);
  config = withManifest(config);
  config = withNativeFiles(config);
  return config;
};
