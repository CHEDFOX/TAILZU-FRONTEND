/**
 * Tailzu's widgets, declared for @bacons/apple-targets: one WidgetKit
 * extension carrying
 *
 *   • The Month        — a Home and Lock Screen widget: words this month and
 *                        the streak, from the numbers the app last fetched.
 *   • The Flow session — a Live Activity while the background microphone is
 *                        armed: ready, listening (with the words so far),
 *                        writing; Stop and End buttons.
 *   • Dictate          — an iOS 18 Control for Control Center, the Lock
 *                        Screen and the Action Button: arms the microphone.
 *
 * The App Group is how the widgets read what the app writes (the month's
 * numbers, the keyboard's arming tombstone) — the same group the keyboard
 * uses, so it MUST match app.config.ts and targets/keyboard.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: "widget",
  name: "TailzuWidgets",
  displayName: "Tailzu",
  // Live Activity buttons and Control Center controls are iOS 17 and 18
  // features; the month widget is drawn with the iOS 17 container APIs.
  // Older phones simply do not offer the widgets, and lose nothing else.
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
  },
};
