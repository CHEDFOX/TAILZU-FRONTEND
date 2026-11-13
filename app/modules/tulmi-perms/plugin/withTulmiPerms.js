/**
 * Expo config plugin: the Android half of the health build switch.
 *
 * Two things, both only on Android, both driven by one flag the app config
 * hands in (`androidHealth`, which is TULMI_ANDROID_HEALTH === "on"):
 *
 *  SWITCH ON — the rationale screen is declared. Health Connect shows a "why
 *  does this app want this?" link beside its permission sheet (Android 13 and
 *  older: an ACTION_SHOW_PERMISSIONS_RATIONALE activity), and Android 14 and
 *  newer reach the same thing through a VIEW_PERMISSION_USAGE alias in the
 *  HEALTH_PERMISSIONS category, guarded by START_VIEW_PERMISSION_USAGE so only
 *  the system may start it. Both point at this module's
 *  HealthRationaleActivity, which opens the policy's health section.
 *  react-native-health-connect's own app.plugin.js writes the same two entries
 *  pointing at MainActivity, which cannot tell JavaScript what started it, so
 *  that plugin is deliberately not listed in app.config.ts. The library links
 *  itself either way.
 *
 *  SWITCH OFF — Health Connect is not in the build at all. app/react-native.config.js
 *  already takes the library's React Native half out of the Android build;
 *  this takes out its Expo half too, by setting `expoAutolinking.exclude` in
 *  android/settings.gradle. Both halves have to go together: the Expo half
 *  (android-expo, which sets the permission delegate) declares
 *  `implementation project(':react-native-health-connect')`, so linking one
 *  without the other fails the Gradle build outright.
 *
 * Each branch also UNDOES the other, because a developer machine runs
 * `expo prebuild` / `expo run:android` over native folders that are already
 * there (EAS and CI always start clean, so they never see this). Without that,
 * flipping the switch leaves half of the previous value behind: an ON build
 * carrying yesterday's exclude links only the React Native half, so Health1 is
 * declared but the permission delegate is never set and requestPermission
 * fails; an OFF build keeps yesterday's rationale activity and alias for a
 * feature that is not in the binary. The health permissions themselves are
 * taken out by app.config.ts's blockedPermissions with the switch off.
 *
 * Nothing is written on iOS: HealthKit's own strings and entitlement come from
 * app.config.ts and the library's plugin, and the contact picker and location
 * need no manifest entry on either phone.
 */
const { withAndroidManifest, withSettingsGradle } = require("@expo/config-plugins");

const RATIONALE_ACTION = "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE";
const RATIONALE_ACTIVITY = "expo.modules.tulmiperms.HealthRationaleActivity";
const USAGE_ALIAS = "ViewPermissionUsageActivity";
const HEALTH_CONNECT_PACKAGE = "react-native-health-connect";

function named(list, name) {
  return (list || []).some((entry) => entry.$ && entry.$["android:name"] === name);
}

function rationaleActivity() {
  return {
    $: {
      "android:name": RATIONALE_ACTIVITY,
      // Only the system starts it, but an exported activity is what both of these
      // filters need; it reads nothing it is given and shows nothing of its own.
      "android:exported": "true",
      "android:excludeFromRecents": "true",
      "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
    },
    "intent-filter": [{ action: [{ $: { "android:name": RATIONALE_ACTION } }] }],
  };
}

function usageAlias() {
  return {
    $: {
      "android:name": USAGE_ALIAS,
      "android:exported": "true",
      "android:targetActivity": RATIONALE_ACTIVITY,
      "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
    },
    "intent-filter": [
      {
        action: [{ $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } }],
        category: [{ $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } }],
      },
    ],
  };
}

/** The exclude block the off branch writes, and the on branch takes back out. */
const EXCLUDE_BLOCK =
  "// The Android health build switch is off, so Health Connect is not in this build.\n" +
  "// react-native.config.js drops its React Native half; this drops its Expo half, which\n" +
  "// depends on that very Gradle project (modules/tulmi-perms/plugin/withTulmiPerms.js).\n" +
  `expoAutolinking.exclude = ['${HEALTH_CONNECT_PACKAGE}']\n`;

/** Every line of the off branch's block, so the on branch can remove it again. */
const EXCLUDE_BLOCK_RE = new RegExp(
  `(?:^//[^\\n]*\\n){0,3}^expoAutolinking\\.exclude\\s*=\\s*\\['${HEALTH_CONNECT_PACKAGE}'\\]\\n`,
  "m"
);

const withHealthRationale = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    application.activity = application.activity || [];
    application["activity-alias"] = application["activity-alias"] || [];
    // Idempotent: a second prebuild over the same manifest adds nothing.
    if (!named(application.activity, RATIONALE_ACTIVITY)) application.activity.push(rationaleActivity());
    if (!named(application["activity-alias"], USAGE_ALIAS)) application["activity-alias"].push(usageAlias());
    return cfg;
  });

/** Takes the rationale screen back out, for a manifest an earlier ON prebuild wrote. */
const withNoHealthRationale = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    const drop = (list, name) => (list || []).filter((entry) => entry.$?.["android:name"] !== name);
    if (application.activity) application.activity = drop(application.activity, RATIONALE_ACTIVITY);
    if (application["activity-alias"]) {
      application["activity-alias"] = drop(application["activity-alias"], USAGE_ALIAS);
    }
    return cfg;
  });

const withNoHealthConnect = (config) =>
  withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    if (cfg.modResults.contents.includes(HEALTH_CONNECT_PACKAGE)) return cfg;
    // It has to be set before the modules are looked up.
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /^expoAutolinking\.useExpoModules\(\)/m,
      `${EXCLUDE_BLOCK}expoAutolinking.useExpoModules()`
    );
    return cfg;
  });

/** Takes the exclude back out, for a settings.gradle an earlier OFF prebuild wrote. */
const withHealthConnectLinked = (config) =>
  withSettingsGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(EXCLUDE_BLOCK_RE, "");
    return cfg;
  });

module.exports = function withTulmiPerms(config, props) {
  const androidHealth = !!(props && props.androidHealth);
  return androidHealth
    ? withHealthConnectLinked(withHealthRationale(config))
    : withNoHealthRationale(withNoHealthConnect(config));
};

// tools/ci/check-health-switch.mjs runs this plugin's settings mod over the
// template's settings.gradle and reads the exclude out of what it writes, so
// the package name lives here only, and deleting the off branch fails that
// check instead of only the Gradle build.
