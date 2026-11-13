/**
 * Expo config plugin: ONE LIBWEBRTC, NAMED, on both phones.
 *
 * react-native-webrtc does not name the libwebrtc build it links. Android asks
 * for the floating `org.jitsi:webrtc:155.+`, and the iOS podspec for
 * `JitsiWebRTC ~> 155.0.0` — so two builds of the same commit, a week apart,
 * can ship two different libwebrtc binaries. The echo cancellation, the audio
 * device module and the barge-in all live in there, and that is exactly what
 * the device matrix tests (the live call: src/sdui/voice/callRealtime.ts).
 *
 * So both sides are pinned to the one version the matrix passed: a resolution
 * rule in the root build.gradle, and the same version as a pod in the app
 * target. Raise PIN here, deliberately, and run the matrix again.
 *
 * Both mods are idempotent: a second prebuild over the same project changes
 * nothing. And the pin is checked against the bridge before either runs: the
 * two majors have to be the same one, or the build is stopped here.
 */
const { withProjectBuildGradle, withPodfile } = require("@expo/config-plugins");

/** The libwebrtc build this app is tested against (the newest 155, published 2026-10-22). */
const PIN = "155.0.1";
/** Marks our lines, so each file gets them once. */
const MARK = "// tulmi: one libwebrtc, named";
const POD_MARK = "# tulmi: one libwebrtc, named";

function withAndroidPin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("[withWebrtcPin] the root build.gradle is not Groovy; pin org.jitsi:webrtc by hand");
    }
    if (cfg.modResults.contents.includes(MARK)) return cfg;
    cfg.modResults.contents += [
      "",
      MARK,
      "allprojects {",
      "  configurations.all {",
      "    resolutionStrategy.eachDependency { details ->",
      "      if (details.requested.group == 'org.jitsi' && details.requested.name == 'webrtc') {",
      `        details.useVersion '${PIN}'`,
      "        details.because 'react-native-webrtc asks for the floating 155.+'",
      "      }",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    return cfg;
  });
}

function withIosPin(config) {
  return withPodfile(config, (cfg) => {
    if (cfg.modResults.contents.includes(POD_MARK)) return cfg;
    // `use_expo_modules!` is the first line inside the app's own target in every
    // Expo project; the pod goes beside it, at the same indent.
    const lines = cfg.modResults.contents.split("\n");
    const at = lines.findIndex((l) => l.trim() === "use_expo_modules!");
    if (at < 0) {
      throw new Error("[withWebrtcPin] no use_expo_modules! in the Podfile; pin JitsiWebRTC by hand");
    }
    const indent = lines[at].slice(0, lines[at].indexOf("use_expo_modules!"));
    lines.splice(at + 1, 0, `${indent}${POD_MARK}`, `${indent}pod 'JitsiWebRTC', '${PIN}'`);
    cfg.modResults.contents = lines.join("\n");
    return cfg;
  });
}

/**
 * The pin and the bridge must be the same major. If the app ever falls back to
 * react-native-webrtc 124.0.8, that bridge asks for `org.jitsi:webrtc:124.+`
 * and `JitsiWebRTC ~> 124.0.0`: iOS would refuse the 155 pod outright, but
 * Android would quietly force libwebrtc 155 under the 124 bridge, which is a
 * crash nobody would trace back to here. So the build stops instead.
 */
function checkPin() {
  // react-native-webrtc has no `exports` field, so its own package.json reads.
  const bridge = String(require("react-native-webrtc/package.json").version || "");
  const pinned = PIN.split(".")[0];
  const asked = bridge.split(".")[0];
  if (pinned === asked) return;
  throw new Error(
    `[withWebrtcPin] PIN is ${PIN} but react-native-webrtc is ${bridge}, which asks for libwebrtc ${asked}. ` +
    `Set PIN to the ${asked} build the device matrix passed (on react-native-webrtc 124.0.8 that is 124.0.0).`,
  );
}

module.exports = function withWebrtcPin(config) {
  checkPin();
  return withIosPin(withAndroidPin(config));
};
