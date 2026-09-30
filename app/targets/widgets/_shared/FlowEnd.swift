import ActivityKit
import AppIntents
import Foundation

// THE FLOW ACTIVITY'S END BUTTON, RUN BY THE APP ITSELF.
//
// This file is in `_shared`, so @bacons/apple-targets builds it into the main
// app as well as the widget extension. That is what lets the End button (the
// cross on the Lock Screen and in the Dynamic Island) work when the app is not
// listening for it.
//
// It used to be a plain AppIntent in the extension that posted a Darwin
// notification for the app's Flow session to hear. When the app had been
// suspended or killed — a call took the microphone, iOS reclaimed it, it
// crashed — nobody was listening: the activity stayed on the Lock Screen and
// the cross did nothing. As a LiveActivityIntent it runs in the app's process,
// which iOS wakes or launches for it, and it ends the activities itself.

/// The Flow session's activity. Declared here once for the widget and the
/// app's target; the bridge module (FlowLiveActivity.swift) has its own copy.
/// ActivityKit matches them by name and encoding, so all copies must stay
/// identical.
@available(iOS 16.2, *)
struct FlowActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "ready" | "listening" | "writing"
    var phase: String
    /// Words this session so far.
    var words: Int
    /// When the session ends itself if nothing happens.
    var until: Date
  }
  var startedAt: Date
}

@available(iOS 17.0, *)
struct EndFlowSessionIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "End Flow session"
  static let description = IntentDescription("Turn the background microphone off.")

  func perform() async throws -> some IntentResult {
    // A live session hears this and ends itself: the microphone, the
    // keyboard's state and the activity (FlowSessionManager, End observer).
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName("space.tailzu.tulmi.flow.end" as CFString), nil, nil, true)
    // And whatever is on screen goes now, whether or not one was listening.
    for activity in Activity<FlowActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    return .result()
  }
}
