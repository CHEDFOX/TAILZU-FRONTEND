import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

// "BOTS AT WORK", FROM THE APP'S SIDE (docs/widget-glance-v2.md §6, backend repo).
//
// The app reads glance v2 (src/widgets/glance.ts) and, when it has a job, asks for this activity; on every glance it shows what
// the job is doing now (a stage, the question it waits on); when the job has finished it shows that (Done, its PR) for up to 15
// minutes and goes. The JSON each call takes is { jobId, state: <ContentState>, dismissAfterSec? } (a flat object with the
// state's keys beside jobId is read too).
//
// It is requested with pushType .token, so the server can update it over APNs (Live Activity pushes, topic
// <bundle id>.push-type.liveactivity) with the same ContentState: the token is handed to JS as it arrives and changes
// (onBotsActivityPushToken) and can be read at any time (botsActivityPushToken); the app registers it at
// POST /v1/widgets/activity-token.
//
// The widget extension draws it (targets/widgets/BotsActivity.swift) and is built for iOS 17, so on an older phone there is
// nothing to draw it with: it is not started there. ActivityKit only lets an activity begin while the app is in front.
//
// The attributes are declared once more, byte for byte, in targets/widgets/_shared/BotsAtWork.swift (built into the widget
// extension and the app). ActivityKit matches them by the type's name and its encoding, so the copies must stay identical.

#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct BotsAtWorkAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// The bot's key ("code"), its name ("Code bot") and its head ("code": the App Group's faces/<face>.png), or none.
    var bot: String
    var botName: String
    var face: String?
    /// The job ("Fixing cart"), its stage (1-based) of how many, the stage's name and every stage's name.
    var task: String
    var stage: Int
    var of: Int
    var stageName: String
    var stages: [String]
    /// When the job started, ms since 1970.
    var startedAt: Double
    /// "working" | "needs" | "done"
    var phase: String
    /// needs: the question and up to three answers. A private question is sent without them: the activity then says only
    /// that the bot needs the person, and a tap opens the question.
    var question: String?
    var choices: [Choice]?
    /// done: what it finished, and its pull request.
    var result: String?
    var pr: PR?
    /// Where a tap goes: the job in the app.
    var link: String
    /// needs: the needs-you item an answer posts to (POST /v1/widgets/act { item, action }) and its kind, and where "You
    /// decide" opens. Without an item the answers are not offered here, and a tap opens the question in the app.
    var itemId: String?
    var itemKind: String?
    var decideLink: String?
    /// done: how long the job took, in minutes (absent: counted from startedAt).
    var minutes: Int?

    struct Choice: Codable, Hashable {
      var id: String
      var label: String
      var primary: Bool?
    }

    struct PR: Codable, Hashable {
      var number: Int
      var url: String
    }

    enum CodingKeys: String, CodingKey {
      case bot, botName, face, task, stage, of, stageName, stages, startedAt, phase, question, choices, result, pr, link
      case itemId, itemKind, decideLink, minutes
    }
  }

  var jobId: String
}

/// Read leniently: a missing or mistyped field takes its default, so one bad field never stops an update (an APNs push
/// whose state does not decode is dropped by the system).
@available(iOS 16.1, *)
extension BotsAtWorkAttributes.ContentState {
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    func text(_ k: CodingKeys) -> String? { try? c.decodeIfPresent(String.self, forKey: k) }
    func whole(_ k: CodingKeys) -> Int? {
      if let i = try? c.decodeIfPresent(Int.self, forKey: k) { return i }
      if let d = try? c.decodeIfPresent(Double.self, forKey: k), d.isFinite, abs(d) < 1e9 { return Int(d) }
      return nil
    }
    bot = text(.bot) ?? ""
    botName = text(.botName) ?? ""
    face = text(.face)
    task = text(.task) ?? ""
    of = min(12, max(1, whole(.of) ?? 1))
    stage = min(of, max(0, whole(.stage) ?? 0))
    stageName = text(.stageName) ?? ""
    stages = (try? c.decodeIfPresent([String].self, forKey: .stages)) ?? []
    startedAt = (try? c.decodeIfPresent(Double.self, forKey: .startedAt)) ?? 0
    phase = text(.phase) ?? "working"
    question = text(.question)
    choices = try? c.decodeIfPresent([Choice].self, forKey: .choices)
    result = text(.result)
    pr = try? c.decodeIfPresent(PR.self, forKey: .pr)
    link = text(.link) ?? ""
    itemId = text(.itemId)
    itemKind = text(.itemKind)
    decideLink = text(.decideLink)
    minutes = whole(.minutes)
  }
}

@available(iOS 16.2, *)
final class BotsLiveActivity {
  static let shared = BotsLiveActivity()

  /// Told when the running activity's push token arrives or changes (hex), and with nil when its activity has gone.
  var onPushToken: ((String?, String) -> Void)?

  private let lock = NSLock()
  private var token: String?
  private var watched = Set<String>()

  /// The running activity's push token (hex), or nil. Read from any thread.
  var pushToken: String? {
    lock.lock()
    let t = token
    lock.unlock()
    if let t { return t }
    let live = Activity<BotsAtWorkAttributes>.activities.first { $0.activityState == .active }
    guard let data = live?.pushToken else { return nil }
    return BotsLiveActivity.hex(data)
  }

  /// At launch: keep listening to an activity an earlier process started (its token may change while this one runs).
  func adoptLaunch() {
    onMain {
      for a in Activity<BotsAtWorkAttributes>.activities where a.activityState == .active {
        self.watch(a)
      }
    }
  }

  /// A job is running: show it. One already running for the job is updated; one for another job ends (one job at a time).
  func start(_ json: String) {
    guard let r = Self.parse(json) else { return }
    let job = r.job, state = r.state
    onMain {
      if let live = self.activity(for: job) {
        Task { await live.update(ActivityContent(state: state, staleDate: nil)) }
        self.watch(live)
        return
      }
      for other in Activity<BotsAtWorkAttributes>.activities where other.attributes.jobId != job {
        Task { await other.end(nil, dismissalPolicy: .immediate) }
      }
      // The widget extension that draws the activity is built for iOS 17 (targets/widgets/expo-target.config.js).
      guard #available(iOS 17.0, *), ActivityAuthorizationInfo().areActivitiesEnabled else { return }
      let attributes = BotsAtWorkAttributes(jobId: job)
      let content = ActivityContent(state: state, staleDate: nil)
      // With a push token, so the server can move it on; without one when this build cannot have one (no push entitlement).
      let made = (try? Activity.request(attributes: attributes, content: content, pushType: .token))
        ?? (try? Activity.request(attributes: attributes, content: content, pushType: nil))
      if let made {
        // An ended job's token is no longer anyone's: the new activity's arrives through watch.
        self.setToken(nil)
        self.watch(made)
      }
    }
  }

  /// What the job is doing now. Nothing running for it: nothing (start is the app's call).
  func update(_ json: String) {
    guard let r = Self.parse(json) else { return }
    let job = r.job, state = r.state
    onMain {
      guard let live = self.activity(for: job) else { return }
      Task { await live.update(ActivityContent(state: state, staleDate: nil)) }
    }
  }

  /// The job is over: its last state stays for `dismissAfterSec` (at most 15 minutes; 0 or no state: it goes now). No jobId,
  /// or an empty string (sign-out): every Bots at work activity goes now.
  func end(_ json: String) {
    let parsed = Self.parse(json)
    let job = parsed?.job ?? Self.jobId(json)
    onMain {
      let all = Activity<BotsAtWorkAttributes>.activities
      let ending = job.map { j in all.filter { $0.attributes.jobId == j } } ?? all
      for a in ending {
        if let r = parsed, r.dismissAfter > 0 {
          var last = r.state
          let ran = (Date().timeIntervalSince1970 * 1000 - last.startedAt) / 60_000
          if last.phase == "done", last.minutes == nil, last.startedAt > 0, ran.isFinite {
            last.minutes = Int(min(1_000_000, max(0, ran)))
          }
          let content = ActivityContent(state: last, staleDate: nil)
          let until = Date().addingTimeInterval(r.dismissAfter)
          Task { await a.end(content, dismissalPolicy: .after(until)) }
        } else {
          Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
      }
    }
  }

  // ---------------------------------------------------------------- the activity and its token

  private func activity(for job: String) -> Activity<BotsAtWorkAttributes>? {
    Activity<BotsAtWorkAttributes>.activities.first {
      $0.attributes.jobId == job && ($0.activityState == .active || $0.activityState == .stale)
    }
  }

  /// Hand its push token over as it arrives and changes, and say when it has gone.
  private func watch(_ a: Activity<BotsAtWorkAttributes>) {
    guard !watched.contains(a.id) else { return }
    watched.insert(a.id)
    let job = a.attributes.jobId
    Task { [weak self] in
      for await data in a.pushTokenUpdates {
        let hex = BotsLiveActivity.hex(data)
        self?.setToken(hex)
        DispatchQueue.main.async { self?.onPushToken?(hex, job) }
      }
    }
    Task { [weak self] in
      for await s in a.activityStateUpdates where s == .ended || s == .dismissed {
        DispatchQueue.main.async {
          guard let self else { return }
          self.watched.remove(a.id)
          if !Activity<BotsAtWorkAttributes>.activities.contains(where: { $0.activityState == .active }) {
            self.setToken(nil)
            self.onPushToken?(nil, job)
          }
        }
        break
      }
    }
  }

  private func setToken(_ t: String?) {
    lock.lock(); token = t; lock.unlock()
  }

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  // ---------------------------------------------------------------- what JS sent

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  private static func object(_ json: String) -> [String: Any]? {
    guard let data = json.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func jobId(_ json: String) -> String? {
    guard let id = object(json)?["jobId"] as? String, !id.isEmpty else { return nil }
    return id
  }

  /// What one call asks for: the job, its state, and how long a finished one stays (seconds, at most 15 minutes).
  struct Request {
    let job: String
    let state: BotsAtWorkAttributes.ContentState
    let dismissAfter: TimeInterval
  }

  /// { jobId, state, dismissAfterSec? } (or the state's keys beside jobId). Bounded, so an update stays under ActivityKit's
  /// 4 KB.
  static func parse(_ json: String) -> Request? {
    guard let o = object(json), let job = o["jobId"] as? String, !job.isEmpty else { return nil }
    let raw = (o["state"] as? [String: Any]) ?? o
    guard let data = try? JSONSerialization.data(withJSONObject: raw),
          var s = try? JSONDecoder().decode(BotsAtWorkAttributes.ContentState.self, from: data) else { return nil }
    s.task = String(s.task.prefix(80))
    s.botName = String(s.botName.prefix(40))
    s.stageName = String(s.stageName.prefix(32))
    s.stages = Array(s.stages.prefix(8).map { String($0.prefix(24)) })
    s.question = s.question.map { String($0.prefix(200)) }
    s.choices = s.choices.map { Array($0.prefix(3)) }
    s.result = s.result.map { String($0.prefix(80)) }
    if s.startedAt <= 0 { s.startedAt = Date().timeIntervalSince1970 * 1000 }
    let after = (o["dismissAfterSec"] as? NSNumber)?.doubleValue ?? 0
    return Request(job: job, state: s, dismissAfter: after.isFinite ? min(900, max(0, after)) : 0)
  }
}
#endif
