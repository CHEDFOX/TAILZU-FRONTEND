/**
 * Expo config plugin: the Android half of the build switches.
 *
 * Three flags the app config hands in, one per switch: `androidHealth`
 * (TULMI_ANDROID_HEALTH === "on"), and from 8.9.1 `androidMotion` and
 * `androidArrival`. The health flag drives the two things below; the other two
 * each declare one receiver, and both write their value into
 * android/gradle.properties so Gradle's source-set choice can never disagree
 * with what this manifest says (see the 8.9.1 block further down).
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
const { withAndroidManifest, withGradleProperties, withSettingsGradle } = require("@expo/config-plugins");

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

// ---------------------------------------------------------------------------------------- 8.9.1

const MOTION_RECEIVER = "expo.modules.tulmiperms.TulmiMotionReceiver";
const MOTION_ACTION = "expo.modules.tulmiperms.ACTIVITY_TRANSITION";
const ARRIVAL_RECEIVER = "expo.modules.tulmiperms.TulmiArrivalReceiver";
const ARRIVAL_ACTION = "expo.modules.tulmiperms.GEOFENCE";

/**
 * The motion transition receiver (TULMI_ANDROID_MOTION). NOT exported: Play services broadcasts to
 * this package's own action, so nothing outside the app can reach it, and it reads nothing it is
 * given beyond the transition type.
 *
 * The BOOT_COMPLETED filter is there because a reboot DROPS the activity-transition registration —
 * Play services keeps no PendingIntent across one — and nothing else would ever put it back: the
 * person turned "Wait while I'm driving" on weeks ago. Without it the driving check answers
 * "unknown" for ever after the first restart. The permission it needs is already in every build
 * (expo-notifications declares RECEIVE_BOOT_COMPLETED; this app neither adds nor blocks it).
 */
function motionReceiver() {
  return {
    $: { "android:name": MOTION_RECEIVER, "android:exported": "false" },
    "intent-filter": [
      { action: [{ $: { "android:name": MOTION_ACTION } }] },
      { action: [{ $: { "android:name": "android.intent.action.BOOT_COMPLETED" } }] },
    ],
  };
}

/**
 * The geofence + boot receiver (TULMI_ANDROID_ARRIVAL). The geofence action is this package's own
 * and the receiver is not exported; BOOT_COMPLETED is delivered by the system, which is why the
 * boot filter is there at all — Android drops every geofence on restart, so without it an arrival
 * reminder silently stops working after the first reboot. It reads nothing it is given: on arrival
 * it looks the item up by the geofence's request id, which is a string this app chose, and shows the
 * reminder. The person's position is never read, passed on or written down.
 */
function arrivalReceiver() {
  return {
    $: { "android:name": ARRIVAL_RECEIVER, "android:exported": "false" },
    "intent-filter": [
      { action: [{ $: { "android:name": ARRIVAL_ACTION } }] },
      { action: [{ $: { "android:name": "android.intent.action.BOOT_COMPLETED" } }] },
    ],
  };
}

/** Declares a receiver, idempotently; a second prebuild over the same manifest adds nothing. */
const withReceiver = (config, name, make) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    application.receiver = application.receiver || [];
    if (!named(application.receiver, name)) application.receiver.push(make());
    return cfg;
  });

/** Takes a receiver back out, for a manifest an earlier ON prebuild wrote. */
const withNoReceiver = (config, name) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    if (application.receiver) {
      application.receiver = application.receiver.filter((e) => e.$?.["android:name"] !== name);
    }
    return cfg;
  });

/**
 * ONE SOURCE OF TRUTH FOR THE TWO SOURCE-SET SWITCHES.
 *
 * The receivers above are written at PREBUILD time from app.config.ts's env. Gradle runs later, and
 * can run with a different environment: a developer who prebuilds with TULMI_ANDROID_ARRIVAL=on and
 * then runs ./gradlew with it unset gets a manifest that declares TulmiArrivalReceiver and a build
 * that compiled src/arrivalOff instead — the class is not there, and the first reboot crashes the
 * app with ClassNotFoundException. So the plugin writes what it decided into gradle.properties, in
 * the same pass, and modules/tulmi-perms/android/build.gradle reads it from there instead of from
 * the environment.
 */
const withSwitchProperties = (config, motion, arrival) =>
  withGradleProperties(config, (cfg) => {
    const want = { "tulmi.androidMotion": motion ? "on" : "off", "tulmi.androidArrival": arrival ? "on" : "off" };
    for (const [key, value] of Object.entries(want)) {
      const had = cfg.modResults.find((e) => e.type === "property" && e.key === key);
      if (had) had.value = value;
      else cfg.modResults.push({ type: "property", key, value });
    }
    return cfg;
  });

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
  const androidMotion = !!(props && props.androidMotion);
  const androidArrival = !!(props && props.androidArrival);
  let out = androidHealth
    ? withHealthConnectLinked(withHealthRationale(config))
    : withNoHealthRationale(withNoHealthConnect(config));
  // Each branch undoes the other, as the health ones do: a developer machine runs prebuild over
  // native folders that are already there, and a flipped switch must not leave a receiver behind
  // for a feature that is no longer in the binary.
  out = androidMotion
    ? withReceiver(out, MOTION_RECEIVER, motionReceiver)
    : withNoReceiver(out, MOTION_RECEIVER);
  out = androidArrival
    ? withReceiver(out, ARRIVAL_RECEIVER, arrivalReceiver)
    : withNoReceiver(out, ARRIVAL_RECEIVER);
  // Written here, read by modules/tulmi-perms/android/build.gradle, so the manifest's receivers and
  // the compiled source sets can never disagree — whatever environment Gradle is later run with.
  out = withSwitchProperties(out, androidMotion, androidArrival);
  return out;
};

// tools/ci/check-health-switch.mjs runs this plugin's settings mod over the
// template's settings.gradle and reads the exclude out of what it writes, so
// the package name lives here only, and deleting the off branch fails that
// check instead of only the Gradle build.
