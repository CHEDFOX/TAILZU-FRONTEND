import SwiftUI
import UIKit
import WidgetKit

// WHAT THE X0 WIDGET READS: GET /v1/shell/glance?v=2 (the contract is the backend's docs/widget-glance-v2.md), as the app
// checked it (src/widgets/glanceCore.ts cleanGlance) and wrote it to the App Group key "x0.glance" (the bridge's
// setWidgetGlance, which also notes when, under "x0.glance.writtenAt", and reloads kind space.tailzu.x0). The bots' faces are
// files the app downloaded beside it: faces/<face>.png in the App Group container. Nothing here fetches anything.
//
// Every read is lenient: a missing or mistyped field is simply absent, every word keeps a literal as its fallback, and a glance
// that is not version 2 is no glance. The case the widget leads with is the server's when the glance backs it, else the
// contract's order: needs → done → working → quiet.

enum X0Keys {
  static let glance = "x0.glance"
  static let writtenAt = "x0.glance.writtenAt"
}

/// Lenient reads out of a JSON object.
private extension Dictionary where Key == String, Value == Any {
  func str(_ k: String, _ fallback: String = "") -> String { (self[k] as? String) ?? fallback }
  func obj(_ k: String) -> [String: Any] { (self[k] as? [String: Any]) ?? [:] }
  func objs(_ k: String) -> [[String: Any]] { ((self[k] as? [Any]) ?? []).compactMap { $0 as? [String: Any] } }
  func num(_ k: String) -> Double? { WidgetAct.number(self[k]) }
  func int(_ k: String, _ fallback: Int = 0) -> Int {
    guard let d = num(k), abs(d) < 1e9 else { return fallback }
    return Int(d.rounded())
  }
  func bool(_ k: String, _ fallback: Bool = false) -> Bool { (self[k] as? Bool) ?? fallback }
  /// A whole number, or nil (absent, or out of any sane range).
  func whole(_ k: String) -> Int? {
    guard let d = num(k), abs(d) < 1e9 else { return nil }
    return Int(d.rounded())
  }
}

/// What the widget leads with.
enum X0Case: String {
  case needs, working, done, quiet
}

/// One answer to a question.
struct X0Choice: Identifiable, Hashable {
  let id: String
  let label: String
  let primary: Bool
}

struct X0Glance {
  struct Bot: Identifiable {
    let slug: String
    let name: String
    /// "#RRGGBB" from the server, or empty: the bot's own ink by its slug (BotInk).
    let color: String
    /// The head: faces/<face>.png. Empty: a disc in the bot's colour with its initial.
    let face: String
    /// needs | working | done | failed | idle
    let state: String
    let needs: Int
    let working: Bool
    /// What it is doing ("fixing cart"), or what it did today ("1,240 words today").
    let line: String
    let link: URL?
    var id: String { slug }
  }

  struct Ask: Identifiable {
    /// The same id as /v1/widgets rows: what POST /v1/widgets/act answers.
    let id: String
    let kind: String
    let bot: String
    let botName: String
    let face: String
    let question: String
    let choices: [X0Choice]
    let decideLink: URL?
    let isPrivate: Bool
    let answerable: Bool
    let link: URL?
  }

  struct Job {
    let id: String
    let bot: String
    let task: String
    let stage: Int
    let of: Int
    let stageName: String
    let stages: [String]
    let startedAt: Date?
    let link: URL?
  }

  struct Done {
    let id: String
    let bot: String
    let botName: String
    let result: String
    let endedAt: Date?
    let minutes: Int?
    let prNumber: Int?
    let link: URL?
  }

  var at: Double = 0
  var writtenAt: Double = 0
  var refreshAfterSec: Double = 900
  var lead: X0Case = .quiet
  var hello = ""
  var dayLine = ""
  var summary = ""
  var weekDots = 0
  var weekLine = ""
  var bots: [Bot] = []
  var needsCount = 0
  var asks: [Ask] = []
  var job: Job?
  var lastDone: Done?
  var countWorking = 0
  var lockInline = ""
  var lockTitle = ""
  var lockLine = ""
  var askURL: URL?
  var homeURL: URL?
  var micURL: URL?
  var words: [String: String] = [:]

  init() {}

  init?(json data: Data) {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], o.int("v") == 2 else { return nil }
    at = o.num("at") ?? 0
    refreshAfterSec = min(21_600, max(60, o.num("refreshAfterSec") ?? 900))
    let g = o.obj("greeting")
    hello = g.str("hello")
    dayLine = g.str("line")
    summary = o.str("summary")
    let w = o.obj("week")
    weekDots = min(5, max(0, w.int("dots")))
    weekLine = w.str("line")
    bots = o.objs("bots").compactMap { b -> Bot? in
      let slug = b.str("slug")
      guard !slug.isEmpty else { return nil }
      let state = b.str("state", "idle")
      return Bot(
        slug: slug, name: b.str("name", slug), color: b.str("color"), face: safeFace(b["face"]), state: state,
        needs: b.int("needs"), working: b.bool("working") || state == "working", line: b.str("line"),
        link: appLink(b["link"] as? String))
    }
    let needs = o.obj("needs")
    asks = needs.objs("items").compactMap { i -> Ask? in
      let id = i.str("id")
      guard !id.isEmpty else { return nil }
      let choices = i.objs("choices").compactMap { c -> X0Choice? in
        let cid = c.str("id"), label = c.str("label")
        guard !cid.isEmpty, !label.isEmpty else { return nil }
        return X0Choice(id: cid, label: label, primary: c.bool("primary"))
      }
      return Ask(
        id: id, kind: i.str("kind"), bot: i.str("bot"), botName: i.str("botName"), face: safeFace(i["face"]),
        question: i.str("question"), choices: Array(choices.prefix(3)), decideLink: appLink(i["decideLink"] as? String),
        isPrivate: i.bool("private"), answerable: i.bool("answerable") && !choices.isEmpty,
        link: appLink(i["link"] as? String))
    }
    needsCount = max(needs.int("count"), asks.count)
    let j = o.obj("job")
    if !j.str("id").isEmpty {
      let stages = ((j["stages"] as? [Any]) ?? []).compactMap { $0 as? String }
      let of = min(8, max(1, j.int("of", max(1, stages.count))))
      job = Job(
        id: j.str("id"), bot: j.str("bot"), task: j.str("task"), stage: min(of, max(1, j.int("stage", 1))), of: of,
        stageName: j.str("stageName"), stages: stages, startedAt: j.num("startedAt").flatMap(date),
        link: appLink(j["link"] as? String))
    }
    let d = o.obj("lastDone")
    if !d.str("id").isEmpty {
      let pr = d.obj("pr")
      lastDone = Done(
        id: d.str("id"), bot: d.str("bot"), botName: d.str("botName"), result: d.str("result"),
        endedAt: d.num("endedAt").flatMap(date), minutes: d.whole("minutes"),
        prNumber: pr.whole("number"), link: appLink(d["link"] as? String))
    }
    countWorking = o.obj("counts").int("working")
    let lock = o.obj("lock")
    lockInline = lock.str("inline")
    lockTitle = lock.str("title")
    lockLine = lock.str("line")
    let links = o.obj("links")
    askURL = appLink(links["ask"] as? String)
    homeURL = appLink(links["home"] as? String)
    micURL = appLink(links["mic"] as? String)
    words = o.obj("words").compactMapValues { v -> String? in
      guard let s = v as? String, !s.isEmpty else { return nil }
      return s
    }
    lead = X0Glance.pick(said: X0Case(rawValue: o.str("case")), self)
  }

  /// The server's case when the glance backs it, else the contract's order.
  private static func pick(said: X0Case?, _ g: X0Glance) -> X0Case {
    func backs(_ c: X0Case) -> Bool {
      switch c {
      case .needs: return !g.asks.isEmpty
      case .done: return g.lastDone != nil
      case .working: return g.job != nil || g.bots.contains { $0.working }
      case .quiet: return true
      }
    }
    if let said, backs(said) { return said }
    return [X0Case.needs, .done, .working].first(where: backs) ?? .quiet
  }

  /// What the app last wrote, or nothing (never fetched, signed out, or not a glance this build reads).
  static func load() -> X0Glance? {
    guard let raw = WidgetAct.store?.string(forKey: X0Keys.glance), !raw.isEmpty, let data = raw.data(using: .utf8),
          var g = X0Glance(json: data) else { return nil }
    g.writtenAt = WidgetAct.store?.double(forKey: X0Keys.writtenAt) ?? 0
    return g
  }

  // ---------------------------------------------------------------- reading it

  /// A word of the server's, or the literal it replaces.
  func word(_ key: String, _ fallback: String) -> String { words[key] ?? fallback }

  /// A word with its `{n}` (and the like) filled in.
  func word(_ key: String, _ fallback: String, _ fill: [String: String]) -> String {
    fill.reduce(word(key, fallback)) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
  }

  func bot(_ slug: String) -> Bot? { bots.first { $0.slug == slug } }

  /// A bot's colour as drawn on this ground; ink when it has none.
  func tint(_ slug: String, _ p: X0Palette) -> Color {
    BotInk.tint(slug, hex: bot(slug)?.color, dark: p.onDark) ?? p.ink
  }

  /// The head a bot's face draws: the one the glance names for it, else its slug's (the built-in bots' heads are named so).
  func face(_ slug: String, _ named: String = "") -> String {
    if !named.isEmpty { return named }
    if let f = bot(slug)?.face, !f.isEmpty { return f }
    return slug
  }

  /// The bots at work beside the job's own.
  func othersWorking(besides slug: String) -> [Bot] {
    bots.filter { $0.working && $0.slug != slug }
  }

  /// When the item's outcomes count from: the older of the glance's own time and when the app wrote it, so a press is never
  /// hidden by a glance made before it.
  var outcomesSince: Double {
    let marks = [at, writtenAt].filter { $0 > 0 }
    return marks.min() ?? 0
  }

  /// Minutes the job has run as of `now`; nil when the glance is too old to say (the app has not written one for two hours).
  func minutesIn(_ job: Job, now: Date) -> Int? {
    guard let start = job.startedAt else { return nil }
    let written = Date(timeIntervalSince1970: max(at, writtenAt) / 1000)
    if at > 0 || writtenAt > 0, now.timeIntervalSince(written) > 7200 { return nil }
    return wholeMinutes(now.timeIntervalSince(start))
  }

  // ---------------------------------------------------------------- the sample (the gallery, before the app has written one)

  static var sample: X0Glance {
    var g = X0Glance()
    g.at = Date().timeIntervalSince1970 * 1000
    g.lead = .working
    g.hello = "Good evening"
    g.dayLine = "Anything to write up before the day ends?"
    g.weekDots = 4
    g.weekLine = "4 things done this week · 2 h saved"
    g.bots = [
      Bot(slug: "code", name: "Code bot", color: "", face: "code", state: "working", needs: 0, working: true,
          line: "fixing cart", link: nil),
      Bot(slug: "travel", name: "Travel bot", color: "", face: "travel", state: "working", needs: 0, working: true,
          line: "finding a hotel in Goa", link: nil),
      Bot(slug: "keybot", name: "Keybot", color: "", face: "keybot", state: "idle", needs: 0, working: false,
          line: "1,240 words today", link: nil),
      Bot(slug: "plan", name: "Plan bot", color: "", face: "plan", state: "idle", needs: 0, working: false, line: "",
          link: nil),
    ]
    g.job = Job(
      id: "sample", bot: "code", task: "Fixing cart", stage: 3, of: 5, stageName: "Build",
      stages: ["Understand", "Plan", "Build", "Check", "Ship"], startedAt: Date().addingTimeInterval(-52 * 60), link: nil)
    g.countWorking = 2
    g.lockInline = "Code bot · Build, 3 of 5"
    g.lockTitle = "Fixing cart"
    g.lockLine = "Code bot · Build"
    return g
  }
}

/// Seconds as whole minutes, never negative, never past a sane bound (a bad time must not trap a conversion).
func wholeMinutes(_ seconds: TimeInterval) -> Int {
  guard seconds.isFinite else { return 0 }
  return Int(min(1_000_000, max(0, seconds / 60)))
}

/// ms since 1970 as a date; nil for none.
private func date(_ ms: Double) -> Date? {
  ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil
}

private let faceCharacters = Set("abcdefghijklmnopqrstuvwxyz0123456789_-")

/// A face key that is safe as a file name (glanceCore.ts FACE_KEY: [a-z0-9][a-z0-9_-]{0,47}), or empty.
func safeFace(_ v: Any?) -> String {
  guard let s = v as? String, (1...48).contains(s.count), s.allSatisfy({ faceCharacters.contains($0) }),
        let first = s.first, first != "_", first != "-" else { return "" }
  return s
}

/// The bots' heads: the files the app downloaded into the App Group (faces/<face>.png); else, for the built-in bots, the heads
/// bundled here (Assets.xcassets Face-<face>, for the gallery and a first run); else nothing (a disc and the initial).
enum X0Faces {
  private static var dir: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WidgetAct.appGroup)?
      .appendingPathComponent("faces", isDirectory: true)
  }

  static func image(_ face: String) -> UIImage? {
    let key = safeFace(face)
    guard !key.isEmpty else { return nil }
    if let file = dir?.appendingPathComponent(key + ".png"), let img = UIImage(contentsOfFile: file.path) { return img }
    return UIImage(named: "Face-" + key)
  }
}

// ------------------------------------------------------------------ the timeline

struct X0Entry: TimelineEntry {
  let date: Date
  let glance: X0Glance?
  /// What an answer pill did to an item, since the glance was made.
  let states: [String: RowState]
}

struct X0Provider: TimelineProvider {
  func placeholder(in context: Context) -> X0Entry { X0Entry(date: Date(), glance: X0Glance.sample, states: [:]) }

  func getSnapshot(in context: Context, completion: @escaping (X0Entry) -> Void) {
    let g = X0Glance.load()
    let shown: X0Glance? = g ?? (context.isPreview ? X0Glance.sample : nil)
    completion(X0Entry(date: Date(), glance: shown, states: NowStates.all(since: g?.outcomesSince ?? 0)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<X0Entry>) -> Void) {
    // The app redraws the widget whenever it writes a fresh glance; this only has to hold between those writes, so it asks again
    // after the server's refreshAfterSec. A running job's minutes and a finished one's time are words of whole minutes, never a
    // ticking clock: while one shows, one entry a minute until then (at most an hour of them), each as of its own minute.
    let g = X0Glance.load()
    let states = NowStates.all(since: g?.outcomesSince ?? 0)
    let start = Date()
    let span = g?.refreshAfterSec ?? 3600
    let ticks = g.map { $0.job != nil || $0.lastDone != nil } ?? false
    let steps = ticks ? max(1, min(60, Int(span / 60))) : 1
    let minute = Calendar.current.dateInterval(of: .minute, for: start)?.start ?? start
    let entries = (0..<steps).map { i in
      X0Entry(date: i == 0 ? start : minute.addingTimeInterval(Double(i) * 60), glance: g, states: states)
    }
    completion(Timeline(entries: entries, policy: .after(start.addingTimeInterval(span))))
  }
}
