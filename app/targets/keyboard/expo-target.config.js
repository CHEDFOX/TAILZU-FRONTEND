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
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: "keyboard",
  name: "Tulmi Keyboard",
  // The keyboard talks to the backend over the network; Open Access is granted
  // by the user in Settings → General → Keyboard → Keyboards → Allow Full Access.
};
