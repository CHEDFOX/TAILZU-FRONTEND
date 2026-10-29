/**
 * Tailzu in other apps' Share menu, declared for @bacons/apple-targets: a
 * share extension that does no work itself.
 *
 * It copies what was shared (text, a link, up to five files or pictures) into
 * the App Group, then opens the app on tulmi://share. The app sends the files
 * to the backend (POST /v1/files) and opens the share-in screen, where the
 * person picks a bot (src/share/useShareIn.ts, modules/tulmi-share).
 *
 * The App Group MUST match app.config.ts and targets/keyboard. No keychain
 * group: the extension never talks to the backend, so it needs no token.
 *
 * STORE STEP: the bundle id is com.tulmi.app.share. It needs an App ID with
 * the App Groups capability (group.com.tulmi.app) in the Apple Developer
 * account and a provisioning profile; EAS creates both on the next build when
 * it manages credentials.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: "share",
  // Distinct from the main app target ("Tailzu"), like the keyboard's.
  name: "TailzuShare",
  // The name under the icon in the Share menu.
  displayName: "X0 Bot",
  // The app's own floor, so sharing works on every phone the app runs on
  // (apple-targets would otherwise default to 18.0).
  deploymentTarget: "16.4",
  frameworks: ["UniformTypeIdentifiers", "ImageIO"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
  },
};
