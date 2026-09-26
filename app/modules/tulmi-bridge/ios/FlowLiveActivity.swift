import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

// THE FLOW SESSION'S LIVE ACTIVITY, from the app's side.
//
// The app holds the background microphone; this is what makes that visible
// on the Lock Screen and in the Dynamic Island, and stoppable from there. It
// is requested when the session is ARMED — the one moment the app is in the
// foreground, which is the only moment iOS lets an activity begin — and then
// updated from the background as the session goes: ready, listening with the
// words so far, writing, and ended with the session.
//
// The attributes are declared once more, byte for byte, in the widget
// extension (targets/widgets/FlowActivity.swift). ActivityKit matches the two
// by the type's name and its encoding, so the copies must stay identical.

#if canImport(ActivityKit)
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

@available(iOS 16.2, *)
final class FlowLiveActivity {
  static let shared = FlowLiveActivity()
  private var activity: Activity<FlowActivityAttributes>?
  private var phase = "ready"
  private var words = 0
  private var until = Date()

  /// The session is armed (the app is in front): begin the activity, or take
  /// over one left from a session that ended without saying so.
  func sessionStarted(until: Date) {
    guard Thread.isMainThread else { DispatchQueue.main.async { self.sessionStarted(until: until) }; return }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    self.until = until
    phase = "ready"; words = 0
    if let live = activity ?? Activity<FlowActivityAttributes>.activities.first {
      activity = live
      push()
      return
    }
    let content = ActivityContent(state: state(), staleDate: nil)
    activity = try? Activity.request(attributes: FlowActivityAttributes(startedAt: Date()), content: content, pushType: nil)
  }

  /// The idle window was extended (a dictation, a transcript). Stored, not
  /// pushed: it rides along with the next real change.
  func extended(until: Date) { onMain { self.until = until } }
  func listening() { onMain { self.phase = "listening"; self.push() } }
  func writing() { onMain { self.phase = "writing"; self.push() } }
  func ready() { onMain { self.phase = "ready"; self.push() } }
  /// A transcript landed: the count grows by the final's words.
  func spoke(words n: Int) { onMain { self.words += max(0, n); self.push() } }
  /// The activity's words changed (setFlowActivityCopy writes them to the App
  /// Group, where the widget extension reads them). ActivityKit redraws on an
  /// update, so push the unchanged state to show them now rather than at the
  /// next dictation.
  func redraw() { onMain { self.push() } }

  func ended() {
    guard Thread.isMainThread else { DispatchQueue.main.async { self.ended() }; return }
    let a = activity; activity = nil
    let final = ActivityContent(state: FlowActivityAttributes.ContentState(phase: "ready", words: words, until: Date()), staleDate: nil)
    Task { await a?.end(final, dismissalPolicy: .immediate) }
    // Any other stragglers from earlier processes go with it.
    for other in Activity<FlowActivityAttributes>.activities where other.id != a?.id {
      Task { await other.end(nil, dismissalPolicy: .immediate) }
    }
  }

  /// Every change to the activity happens on the main thread. Transcripts
  /// land on URLSession's queue and arming on main; without this, one thread
  /// could replace `activity` while another was reading it.
  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  private func state() -> FlowActivityAttributes.ContentState {
    FlowActivityAttributes.ContentState(phase: phase, words: words, until: until)
  }

  private func push() {
    guard let a = activity else { return }
    let content = ActivityContent(state: state(), staleDate: nil)
    Task { await a.update(content) }
  }
}
#endif
