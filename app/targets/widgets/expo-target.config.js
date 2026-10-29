/**
 * Tailzu's widgets, declared for @bacons/apple-targets: one WidgetKit
 * extension carrying
 *
 *   • The Month        — a Home and Lock Screen widget: words this month and
 *                        the streak, from the numbers the app last fetched.
 *   • The Flow session — a Live Activity while the background microphone is
 *                        armed: ready, listening (with the words so far),
 *                        writing; Stop and End buttons.
 *   • Setup            — a Live Activity while setup is unfinished: the step
 *                        someone left off at, until it is done.
 *   • Dictate          — an iOS 18 Control for Control Center, the Lock
 *                        Screen and the Action Button: arms the microphone.
 *   • From your people — Home Screen small / medium / large and a Lock Screen
 *                        rectangle: the latest from family and friends.
 *   • Needs you        — the same sizes, with buttons (iOS 17 App Intents):
 *                        answer a bot, tick a task, without opening the app.
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
  displayName: "X0 Bot",
  // Live Activity buttons and Control Center controls are iOS 17 and 18
  // features; the month widget is drawn with the iOS 17 container APIs.
  // Older phones simply do not offer the widgets, and lose nothing else.
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
    // The Needs you widget's buttons read the widgets' OWN narrow token
    // (never the session's) from the shared Keychain the app writes it to
    // (QuickAccess.swift WidgetKeychain; the bridge's TulmiKeychain). Same
    // group as the app and the keyboard (app.config.ts, targets/keyboard).
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.tulmi.app.shared"],
  },
};
