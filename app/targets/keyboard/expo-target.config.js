/**
 * Tulmi iOS keyboard extension, declared for @bacons/apple-targets.
 *
 * This adds a Custom Keyboard app-extension target to the iOS project during
 * `expo prebuild` / EAS build, alongside the React Native main app. The Swift
 * implementation lives in KeyboardViewController.swift in this folder.
 *
 * Open Access (RequestsOpenAccess) is required so the keyboard can reach the
 * Tulmi backend for ✨ Refine; it is set in Info.plist in this folder.
 *
 * The App Group lets the keyboard read the backend URL + user token the main
 * app shares (written by the tulmi-bridge native module). It MUST match the
 * group in the main app's ios.entitlements (app.config.ts).
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  // No space: the Xcode target `name` must equal the sanitized `productName`
  // ("Tailzu") or EAS's "Configure Xcode project" step can't find the target to
  // attach the provisioning profile. The user-facing keyboard name comes from
  // CFBundleDisplayName in Info.plist (also "Tailzu").
  type: "keyboard",
  name: "Tailzu",
  // The keyboard talks to the backend over the network; Open Access is granted
  // by the user in Settings → General → Keyboard → Keyboards → Allow Full Access.
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
  },
};
