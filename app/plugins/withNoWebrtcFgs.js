/**
 * Expo config plugin: NO FOREGROUND SERVICE IN THE MERGED ANDROID MANIFEST.
 *
 * react-native-webrtc's own manifest (the live voice call:
 * src/sdui/voice/callRealtime.ts) declares
 * `com.oney.WebRTCModule.MediaProjectionService` with
 * `foregroundServiceType="mediaProjection"`, for screen sharing. Nothing in
 * this app shares a screen — the call is audio only — but a declared
 * foreground service merges into the AAB whether it is used or not, and Play
 * then asks for a foreground-service declaration and a justification for a
 * service that never runs. `tools:node="remove"` is the only thing that
 * actually takes it out again (the same mechanism app.config.ts's
 * `blockedPermissions` uses for the media permissions).
 *
 * The libwebrtc version is pinned by its own plugin (plugins/withWebrtcPin.js).
 *
 * Idempotent: a second prebuild over the same project changes nothing.
 */
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/** The service to take out, as the library declares it. */
const SERVICE = "com.oney.WebRTCModule.MediaProjectionService";

module.exports = function withNoWebrtcFgs(config) {
  return withAndroidManifest(config, (cfg) => {
    // tools:node needs the tools namespace on <manifest>.
    cfg.modResults = AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = app.service || [];
    const already = app.service.some((s) => s.$ && s.$["android:name"] === SERVICE);
    if (!already) {
      app.service.push({ $: { "android:name": SERVICE, "tools:node": "remove" } });
    }
    return cfg;
  });
};
