import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

// SETUP, UNTIL IT IS DONE, ON THE LOCK SCREEN.
//
// Someone who installs Tailzu, opens it, and puts the phone down has started a
// task with a clear end — the keyboard added, the microphone allowed, a first
// sentence said — and nothing told them where they left it. This is that task,
// as a Live Activity: the step they are on, what it takes, and a tap back into
// the app at that step. It ends the moment setup is finished, and iOS ends it
// after eight hours regardless.
//
// The server decides every word and whether it shows at all (the bootstrap's
// `liveActivity.setup` flag); the app only starts, updates and ends it. It can
// only begin while the app is in front — the one moment ActivityKit allows —
// which is exactly when a bootstrap runs.
//
// The attributes are declared once more, byte for byte, in the widget
// extension (targets/widgets/SetupActivity.swift).

#if canImport(ActivityKit)
@available(iOS 16.2, *)
struct SetupActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Steps done, and how many there are.
    var done: Int
    var total: Int
    /// What to do next, and what it takes — the server's words.
    var title: String
    var detail: String
    /// Where a tap lands ("tulmi://screen/<id>").
    var url: String
  }
  var startedAt: Date
}

@available(iOS 16.2, *)
final class SetupLiveActivity {
  static let shared = SetupLiveActivity()
  private var activity: Activity<SetupActivityAttributes>?

  // CLEARED MEANS CLEARED. Someone who swipes the activity off the Lock
  // Screen has answered it; starting it again on the next open is the reminder
  // they just dismissed, back. The step they cleared it on is kept, and the
  // activity only returns when setup has moved on to another step.
  private static let clearedKey = "tulmi.setup.clearedAtStep"

  private var clearedAtStep: Int? {
    get { UserDefaults.standard.object(forKey: Self.clearedKey) as? Int }
    set { UserDefaults.standard.set(newValue, forKey: Self.clearedKey) }
  }

  /// Show this step, starting the activity if there is none. `nil` ends it.
  func apply(_ state: SetupActivityAttributes.ContentState?) {
    guard Thread.isMainThread else { DispatchQueue.main.async { self.apply(state) }; return }
    guard let state = state else { end(); return }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    // One dismissed while this process was not watching still says so.
    for gone in Activity<SetupActivityAttributes>.activities where gone.activityState == .dismissed {
      clearedAtStep = gone.content.state.done
    }
    let content = ActivityContent(state: state, staleDate: nil)
    if let live = activity ?? Activity<SetupActivityAttributes>.activities.first(where: { $0.activityState == .active }) {
      activity = live
      Task { await live.update(content) }
      return
    }
    if clearedAtStep == state.done { return }
    activity = try? Activity.request(
      attributes: SetupActivityAttributes(startedAt: Date()), content: content, pushType: nil)
    if let a = activity { watch(a) }
  }

  /// Remember the step it was cleared on, the moment it is.
  private func watch(_ a: Activity<SetupActivityAttributes>) {
    Task { [weak self] in
      for await s in a.activityStateUpdates where s == .dismissed {
        let step = a.content.state.done
        DispatchQueue.main.async {
          self?.clearedAtStep = step
          if self?.activity?.id == a.id { self?.activity = nil }
        }
      }
    }
  }

  func end() {
    let a = activity; activity = nil
    Task { await a?.end(nil, dismissalPolicy: .immediate) }
    for other in Activity<SetupActivityAttributes>.activities where other.id != a?.id {
      Task { await other.end(nil, dismissalPolicy: .immediate) }
    }
  }

  /// Leniently read what JS sent. Anything missing or empty means "no step".
  static func state(from json: String) -> SetupActivityAttributes.ContentState? {
    guard let data = json.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let title = o["title"] as? String, !title.isEmpty
    else { return nil }
    let done = (o["done"] as? NSNumber)?.intValue ?? 0
    let total = max(1, (o["total"] as? NSNumber)?.intValue ?? 1)
    return SetupActivityAttributes.ContentState(
      done: max(0, min(done, total)), total: total, title: title,
      detail: (o["detail"] as? String) ?? "",
      url: (o["url"] as? String) ?? "tulmi://")
  }
}
#endif
