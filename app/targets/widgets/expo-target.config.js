/**
 * X0's widgets, declared for @bacons/apple-targets: one WidgetKit extension
 * carrying
 *
 *   • X0               — the universal widget, Home Screen small / medium /
 *                        large, StandBy and the Lock Screen's inline,
 *                        rectangle and circle: what needs you (answered in
 *                        place, iOS 17 App Intents), what the bots are doing,
 *                        or the greeting and Ask (glance v2).
 *   • Bots at work     — a Live Activity while a bot's job runs: its stages,
 *                        its question (answered in place), its PR.
 *   • The mic session  — a Live Activity while the background microphone is
 *                        armed: ready, listening (with the words so far),
 *                        writing; Stop and End buttons.
 *   • Setup            — a Live Activity while setup is unfinished: the step
 *                        someone left off at, until it is done.
 *   • Dictate          — an iOS 18 Control for Control Center, the Lock
 *                        Screen and the Action Button: arms the microphone.
 *   • From your people — Home Screen small / medium / large and a Lock Screen
 *                        rectangle: the latest from family and friends.
 *
 * (The Month and Needs you were retired: X0 shows both.)
 *
 * The App Group is how the widgets read what the app writes (the glance,
 * the faces, the keyboard's arming tombstone) — the same group the keyboard
 * uses, so it MUST match app.config.ts and targets/keyboard.
 *
 * Assets.xcassets (X0Mark: the app icon's bot head; X0Hang: the painted bot
 * hanging off the X0 widget's top edge; X0Peek: the keyboard's peek-bot key;
 * Face-*: the built-in bots' heads, for the gallery and a first run) is in
 * this folder, which the plugin syncs into the target whole —
 * as targets/keyboard's own catalog is.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: "widget",
  name: "TailzuWidgets",
  displayName: "X0",
  // Live Activity and widget buttons and Control Center controls are iOS 17
  // and 18 features; the widgets are drawn with the iOS 17 container APIs.
  // Older phones simply do not offer the widgets (nor draw the Live
  // Activities: the app does not start Bots at work there), and lose nothing
  // else.
  deploymentTarget: "17.0",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tulmi.app"],
    // The X0 widget's answer buttons read the widgets' OWN narrow token
    // (never the session's) from the shared Keychain the app writes it to
    // (_shared/WidgetAct.swift WidgetKeychain; the bridge's TulmiKeychain).
    // Same group as the app and the keyboard (app.config.ts, targets/keyboard).
    "keychain-access-groups": ["$(AppIdentifierPrefix)com.tulmi.app.shared"],
  },
};
