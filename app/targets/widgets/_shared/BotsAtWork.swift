import ActivityKit
import AppIntents
import Foundation
import WidgetKit

// "BOTS AT WORK": A RUNNING JOB AS A LIVE ACTIVITY (docs/widget-glance-v2.md §6, backend repo).
//
// This file is in `_shared`, so @bacons/apple-targets builds it into the main app as well as the widget extension: the
// activity's answer buttons are a LiveActivityIntent, which runs in the app's process (iOS wakes or launches it for a press),
// and from there it can move the activity on at once. The views are the extension's (BotsActivity.swift); the app's bridge
// module starts, updates and ends it (modules/tulmi-bridge/ios/BotsLiveActivity.swift), and the server may push the same
// ContentState over APNs to the push token the bridge hands the app.
//
// The attributes are declared once more, byte for byte, in that bridge file. ActivityKit matches them by the type's name and
// its encoding, so the copies must stay identical — and so must the JSON the app and the server send: these keys, as they are.

// BEGIN BotsAtWorkAttributes
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
    /// A private question, and a job that ended badly. The server has always sent both (tulmi/src/widgets/activity.ts) and
    /// this side has always dropped them, because CodingKeys did not list them. It lists them now.
    var `private`: Bool?
    var failed: Bool?
    /// The server design this activity draws, by id ("bots.night"). The design itself waits in the App Group, which the
    /// activity's views can read, so a 4 KB push only has to NAME it. Unknown, missing or too new: today's own regions.
    var look: String?
    /// The one way a later design binds data this frozen struct has no field for (an ETA, a mood, a file count). At most
    /// 12 keys of 24 characters, values of 120. Free strings nobody can classify, so they count as private words.
    var vars: [String: String]?

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
      case `private`, failed, look, vars
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
    self.`private` = try? c.decodeIfPresent(Bool.self, forKey: .private)
    failed = try? c.decodeIfPresent(Bool.self, forKey: .failed)
    // A design id is [a-z0-9._-], 1 to 40 characters. Anything else is not an id, so it never names a file.
    let wanted = text(.look) ?? ""
    let idCharacters = Set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    let idOk = (1...40).contains(wanted.count) && wanted.allSatisfy({ idCharacters.contains($0) })
    look = idOk ? wanted : nil
    // Clamped here as well as on the server: a push is the one input nothing on this phone has checked.
    if let sent = try? c.decodeIfPresent([String: String].self, forKey: .vars), !sent.isEmpty {
      var kept: [String: String] = [:]
      for key in sent.keys.sorted() where kept.count < 12 && key.count <= 24 {
        kept[key] = String((sent[key] ?? "").prefix(120))
      }
      vars = kept.isEmpty ? nil : kept
    } else {
      vars = nil
    }
  }
}
// END BotsAtWorkAttributes

/// The question answered: the job goes back to work. The app's side only; outside the markers, so the two copies of the
/// attributes stay byte for byte the same.
@available(iOS 16.1, *)
extension BotsAtWorkAttributes.ContentState {
  func answered() -> Self {
    var s = self
    s.phase = "working"
    s.question = nil
    s.choices = nil
    s.itemId = nil
    s.itemKind = nil
    s.decideLink = nil
    return s
  }
}

/// An answer pill in the Bots at work activity, pressed: the activity moves on at once (the question answered), the answer goes
/// out with the widgets' own token, and the X0 widget shows it answered. If it cannot be sent, the question comes back and a
/// tap opens it in the app. Asks for the phone to be unlocked first, as the widget's answers do.
@available(iOS 17.0, *)
struct AnswerBotsActivityIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Answer a bot"
  static let description = IntentDescription("Answers a bot's question from the X0 Live Activity.")
  /// The Live Activity's buttons, not an action of their own in Shortcuts.
  static var isDiscoverable: Bool { false }
  static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }

  @Parameter(title: "Job") var job: String
  @Parameter(title: "Item") var item: String
  @Parameter(title: "Button") var action: String

  init() {}

  init(job: String, item: String, action: String) {
    self.job = job
    self.item = item
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    let asking = Activity<BotsAtWorkAttributes>.activities.filter {
      $0.attributes.jobId == job && $0.content.state.phase == "needs" && $0.content.state.itemId == item
    }
    let before = asking.map { ($0, $0.content.state) }
    for (activity, state) in before {
      await activity.update(ActivityContent(state: state.answered(), staleDate: nil))
    }
    NowStates.set(item, .done)
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.x0)

    let outcome = await WidgetAct.post(item: item, action: action)
    NowStates.set(item, outcome)
    if outcome == .failed {
      for (activity, state) in before {
        await activity.update(ActivityContent(state: state, staleDate: nil))
      }
    }
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.x0)
    return .result()
  }
}
