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
  // The Xcode target name must be DISTINCT from the main app target ("Tailzu")
  // — otherwise Xcode collides on generated Info.plists and EAS applies the
  // wrong provisioning profile ("Provisioning profile ... has app ID
  // 'com.tulmi.app.keyboard', which does not match the bundle ID
  // 'com.tulmi.app'").
  type: "keyboard",
  name: "TailzuKeyboard",
  // User-facing name in the iOS keyboard selector. apple-targets sets
  // INFOPLIST_KEY_CFBundleDisplayName = displayName ?? name, and that build
  // setting OVERRIDES the CFBundleDisplayName in Info.plist — so without this,
  // the selector showed the internal target name "TailzuKeyboard". Setting
  // displayName makes it just "Tailzu" while keeping the distinct target name.
  displayName: "Tailzu",
  // The keyboard talks to the backend over the network; Open Access is granted
  // by the user in Settings → General → Keyboard → Keyboards → Allow Full Access.
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
    // Shared Keychain group so the keyboard can read the bearer token the
    // main app writes there. Must match the group listed on the main app
    // (see app.config.ts).
    "keychain-access-groups": [
      "$(AppIdentifierPrefix)com.tulmi.app.shared",
    ],
  },
};
