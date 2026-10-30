import AppIntents
import Foundation
import SwiftUI
import UIKit
import WidgetKit

// QUICK ACCESS: what From your people reads (PeopleWidget.swift), and the X0 widget's answer button.
//
// What From your people says is the server's: GET /v1/widgets/now answers its rows already worded, each with where its tap goes,
// how a time is written, the Lock Screen's line, the empty state and its button. The app writes that document as it is to the
// App Group key "tulmi.widget.now" (src/widgets/now.ts, setWidgetNow); nothing here asks the server for rows. Every read is
// lenient and keeps a literal fallback, so a missing or mistyped field never stops the rest from drawing, and a new kind of row
// is the server's data, not code. (The document's needs section was the retired Needs you widget's: the X0 widget now asks the
// person's questions, from glance v2.)
//
// How it looks is the app's own (X0Palette, X0Mark, X0Pill in TailzuWidgets.swift): white and ink with greys in Light, the same
// inverted in Dark, rows on hairlines, a person's initial on a grey disc, a bot's in its own colour's ring. The document's `look`
// (its old colours and button colours) is no longer read.
//
// ANSWERING IN PLACE. An X0 widget answer pill runs AnswerNeedIntent here, in the extension: it posts to the server with the
// widgets' OWN token, never the session's (_shared/WidgetAct.swift: the token, the post, what a press did). The intent asks for
// the phone to be unlocked (authenticationPolicy). It shows "Done" at once; an answer that cannot be sent (no token, offline,
// refused) then says "Open X0 to finish", and a tap opens it there.

enum QuickKeys {
  /** The document the app wrote (GET /v1/widgets/now, as it was). */
  static let now = "tulmi.widget.now"
  /** When the app wrote it (ms since 1970). */
  static let writtenAt = "tulmi.widget.now.writtenAt"
  static let peopleKind = WidgetKinds.people
}

/// Lenient reads out of a JSON object.
private extension Dictionary where Key == String, Value == Any {
  func str(_ k: String, _ fallback: String = "") -> String { (self[k] as? String) ?? fallback }
  func obj(_ k: String) -> [String: Any] { (self[k] as? [String: Any]) ?? [:] }
  func num(_ k: String) -> Double? { WidgetAct.number(self[k]) }
  func bool(_ k: String, _ fallback: Bool) -> Bool { (self[k] as? Bool) ?? fallback }
}

/// A link this app opens: tulmi://, com.tulmi.app://, or its own https hosts. Anything else is no link.
func appLink(_ s: String?) -> URL? {
  guard let s, !s.isEmpty, let u = URL(string: s), let scheme = u.scheme?.lowercased() else { return nil }
  if scheme == "tulmi" || scheme == "com.tulmi.app" { return u }
  let hosts: Set<String> = ["x0bot.com", "app.x0bot.com", "tailzu.space", "app.tailzu.space"]
  if scheme == "https", let h = u.host?.lowercased(), hosts.contains(h) { return u }
  return nil
}

/// An SF Symbol the system has, or the fallback (an unknown name would draw nothing).
func symbol(_ name: String?, _ fallback: String) -> String {
  guard let name, !name.isEmpty, UIImage(systemName: name) != nil else { return fallback }
  return name
}

struct NowAction: Identifiable {
  let id: String
  let label: String
  let style: String
  /// "inPlace" (the widget answers) or "open" (a link into the app).
  let inPlace: Bool
  let url: URL?
  let icon: String?

  init?(_ o: [String: Any]) {
    let id = o.str("id")
    guard !id.isEmpty, let label = o["label"] as? String else { return nil }
    self.id = id
    self.label = label
    style = o.str("style", "secondary")
    inPlace = o.str("mode") == "inPlace"
    url = appLink(o["url"] as? String)
    icon = o["icon"] as? String
    if !inPlace && url == nil { return nil }
  }
}

struct NowRow: Identifiable {
  let id: String
  let kind: String
  let who: String
  let initial: String
  let text: String
  let line: String
  let tag: String
  let detail: String
  let at: Date?
  let when: String
  let url: URL?
  /// Words a locked phone must not show.
  let isPrivate: Bool
  let isNew: Bool
  let icon: String
  let color: Color?
  /// Whose bot a row is ("code", "keybot", "plan", "travel", "tailzu", or a person's own bot's palette name), when the server says.
  let bot: String
  let actions: [NowAction]

  init?(_ o: [String: Any]) {
    let id = o.str("id")
    guard !id.isEmpty else { return nil }
    self.id = id
    kind = o.str("kind")
    who = o.str("who")
    initial = o.str("initial")
    text = o.str("text")
    line = o.str("line", o.str("text"))
    tag = o.str("tag")
    detail = o.str("detail")
    at = o.num("at").map { Date(timeIntervalSince1970: $0 / 1000) }
    when = o.str("when")
    url = appLink(o["url"] as? String)
    isPrivate = o.bool("private", false)
    isNew = o.bool("new", false)
    icon = o.str("icon", "circle.fill")
    color = (o["color"] as? String).flatMap { Color(hex: $0) }
    bot = o.str("bot")
    actions = ((o["actions"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any]).flatMap(NowAction.init) }
  }

  /// A bot's row (a bot asks, or a connected app waits for its yes): drawn with the bot's ring.
  var isBot: Bool { !bot.isEmpty || kind == "question" || kind == "approval" }

  /// The bot's own colour for its ring: by its key, else the colour the server sent, else ink. Nil for a person.
  func ring(_ p: X0Palette) -> Color? {
    guard isBot else { return nil }
    return BotInk.color(bot) ?? color ?? p.ink
  }

  /// The letter an avatar shows.
  var letter: String {
    if !initial.isEmpty { return initial }
    return who.first.map { String($0).uppercased() } ?? ""
  }

  /// The words of a row: the whole line ("Riya shared Weekend plan"), else its text.
  var sentence: String { line.isEmpty ? text : line }

  /// A question or a task as asked: its text ("Move dinner to 7:30?"), else the line.
  var ask: String { text.isEmpty ? line : text }
}

struct NowSection {
  var on = false
  var title = ""
  var url: URL?
  var icon = "circle.fill"
  var limits: [String: Int] = [:]
  var rows: [NowRow] = []
  var newCount = 0
  var lockLine = ""
  var emptyTitle = ""
  var emptyBody = ""
  var emptyCta = ""
  var emptyURL: URL?
  var words: [String: String] = [:]

  init() {}

  init(_ o: [String: Any]) {
    on = o.bool("on", false)
    title = o.str("title")
    url = appLink(o["url"] as? String)
    icon = o.str("icon", "circle.fill")
    limits = o.obj("limits").compactMapValues { value -> Int? in
      guard let n = WidgetAct.number(value) else { return nil }
      return max(0, Int(n))
    }
    rows = ((o["rows"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any]).flatMap(NowRow.init) }
    newCount = Int(o.num("newCount") ?? 0)
    lockLine = o.obj("lock").str("line")
    let e = o.obj("empty")
    emptyTitle = e.str("title")
    emptyBody = e.str("body")
    emptyCta = e.str("cta")
    emptyURL = appLink(e["url"] as? String)
    words = o.obj("words").compactMapValues { $0 as? String }
  }

  /// Rows a size draws: the server's number for it, else this.
  func limit(_ size: String, _ fallback: Int) -> Int { limits[size] ?? fallback }
  /// A button's moment in words: the server's, else this.
  func word(_ key: String, _ fallback: String) -> String { words[key].flatMap { $0.isEmpty ? nil : $0 } ?? fallback }
}

struct NowDoc {
  var time = "relative"
  var refreshSec: Double = 900
  var people = NowSection()
  var needs = NowSection()
  var writtenAt: Double = 0

  init() {}

  init?(json data: Data) {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], (o["v"] as? NSNumber) != nil else { return nil }
    time = o.str("time", "relative")
    refreshSec = max(60, o.num("refreshSec") ?? 900)
    people = NowSection(o.obj("people"))
    needs = NowSection(o.obj("needs"))
  }

  /// What the app last wrote, or nothing (never fetched, or signed out).
  static func load() -> NowDoc? {
    guard let raw = Shared.store?.string(forKey: QuickKeys.now), !raw.isEmpty, let data = raw.data(using: .utf8),
          var doc = NowDoc(json: data) else { return nil }
    doc.writtenAt = Shared.store?.double(forKey: QuickKeys.writtenAt) ?? 0
    return doc
  }
}

/// An answer pill of the X0 widget, pressed: answered here with the widgets' token. The item shows "Done" at once (the widget is
/// redrawn before the answer goes out), then how it went, until the app writes fresh data. Asks for the phone to be unlocked
/// first.
struct AnswerNeedIntent: AppIntent {
  static let title: LocalizedStringResource = "Answer from the widget"
  static let description = IntentDescription("Answers a question or ticks off a task from the X0 widget.")
  static var isDiscoverable: Bool { false }
  static var authenticationPolicy: IntentAuthenticationPolicy { .requiresAuthentication }

  @Parameter(title: "Item") var item: String
  @Parameter(title: "Button") var action: String

  init() {}

  init(item: String, action: String) {
    self.item = item
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    NowStates.set(item, .done)
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.x0)
    let outcome = await WidgetAct.post(item: item, action: action)
    if outcome != .done {
      NowStates.set(item, outcome)
    }
    WidgetCenter.shared.reloadTimelines(ofKind: WidgetKinds.x0)
    return .result()
  }
}

// ------------------------------------------------------------------ From your people's timeline

struct NowEntry: TimelineEntry {
  let date: Date
  let doc: NowDoc?
  let states: [String: RowState]
}

struct NowProvider: TimelineProvider {
  func placeholder(in context: Context) -> NowEntry { NowEntry(date: Date(), doc: nil, states: [:]) }

  func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) {
    let doc = NowDoc.load()
    completion(NowEntry(date: Date(), doc: doc, states: NowStates.all(since: doc?.writtenAt ?? 0)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
    // The app redraws the widget every time it writes fresh rows; this only has to hold between those writes, so it asks again
    // after the server's interval. Meanwhile a relative time is words ("4 min ago"), not a ticking clock: one entry a minute
    // until then (at most an hour of them), each worded as of its own minute.
    let doc = NowDoc.load()
    let states = NowStates.all(since: doc?.writtenAt ?? 0)
    let start = Date()
    let span = doc?.refreshSec ?? 900
    let steps = countsFromNow(doc?.time ?? "relative") ? max(1, min(60, Int(span / 60))) : 1
    let entries = (0..<steps).map { i in
      NowEntry(date: start.addingTimeInterval(Double(i) * 60), doc: doc, states: states)
    }
    completion(Timeline(entries: entries, policy: .after(start.addingTimeInterval(span))))
  }
}

// ------------------------------------------------------------------ parts the widgets draw

/// When, in words that hold for a minute: "now", "4 min ago", "2 h ago", "Yesterday", "Mon", "12 Oct". Never seconds.
enum When {
  private static let weekday: DateFormatter = {
    let f = DateFormatter()
    f.setLocalizedDateFormatFromTemplate("EEE")
    return f
  }()

  private static let day: DateFormatter = {
    let f = DateFormatter()
    f.setLocalizedDateFormatFromTemplate("d MMM")
    return f
  }()

  static func words(_ at: Date, now: Date) -> String {
    let ago = max(0, now.timeIntervalSince(at))
    if ago < 60 { return "now" }
    if ago < 3600 { return "\(Int(ago / 60)) min ago" }
    let cal = Calendar.current
    if ago < 12 * 3600 || cal.isDate(at, inSameDayAs: now) { return "\(Int(ago / 3600)) h ago" }
    if let yesterday = cal.date(byAdding: .day, value: -1, to: now), cal.isDate(at, inSameDayAs: yesterday) { return "Yesterday" }
    if ago < 6 * 86_400 { return weekday.string(from: at) }
    return day.string(from: at)
  }
}

/// Whether the server asked for the time counted from now ("relative", or "minutes": whole minutes or larger).
func countsFromNow(_ style: String) -> Bool { style == "relative" || style == "minutes" }

/// When, the way the server said: in words as of `now` ("4 min ago"), the clock ("6:30 PM"), or its own words.
func whenText(_ row: NowRow, style: String, now: Date) -> Text {
  if let at = row.at, countsFromNow(style) { return Text(When.words(at, now: now)) }
  if let at = row.at, style == "clock" { return Text(at, style: .time) }
  return Text(row.when)
}

/// Whether a row has a time to show at all.
func hasWhen(_ row: NowRow, style: String) -> Bool {
  (row.at != nil && (countsFromNow(style) || style == "clock")) || !row.when.isEmpty
}

/// A section's header: its title (and, when given, how many), and the mark.
struct QuickHeader: View {
  let title: String
  var count: Int? = nil
  let p: X0Palette

  var body: some View {
    HStack(alignment: .center, spacing: 6) {
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .tracking(-0.2)
        .foregroundStyle(p.ink)
        .lineLimit(1)
      if let count, count > 0 {
        Text(String(count))
          .font(.system(size: 13, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(p.meta)
      }
      Spacer(minLength: 4)
      X0Mark(size: 18, onDark: p.onDark)
    }
    .frame(height: 18)
  }
}

/// Nothing to show: the server's line, and its button (the whole widget opens it). Before the app has written anything (never
/// opened, signed out), the literals.
struct QuickEmpty: View {
  let section: NowSection
  let p: X0Palette
  let compact: Bool
  let fallbackTitle: String
  let fallbackBody: String
  let fallbackCta: String

  private var title: String { section.emptyTitle.isEmpty ? fallbackTitle : section.emptyTitle }
  private var bodyLine: String { section.emptyTitle.isEmpty ? fallbackBody : section.emptyBody }
  private var cta: String { section.emptyTitle.isEmpty ? fallbackCta : section.emptyCta }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Spacer(minLength: 0)
      Text(title)
        .font(.system(size: compact ? 15 : 17, weight: .semibold))
        .tracking(-0.3)
        .foregroundStyle(p.ink)
        .lineLimit(2)
      if !bodyLine.isEmpty {
        Text(bodyLine)
          .font(.system(size: 12))
          .foregroundStyle(p.meta)
          .lineLimit(compact ? 3 : 2)
      }
      if !cta.isEmpty {
        X0Pill(label: cta, primary: true, p: p, fill: compact, height: compact ? 28 : 30)
          .padding(.top, 8)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
  }
}

/// Who a row is from: their initial on a grey disc; a bot's with a ring in its own colour (ink when the row has none).
struct RowAvatar: View {
  let row: NowRow
  let p: X0Palette
  var size: CGFloat = 26

  var body: some View {
    let ring = row.ring(p)
    Text(row.letter)
      .font(.system(size: size * 0.42, weight: .semibold))
      .foregroundStyle(p.ink)
      .lineLimit(1)
      .frame(width: size, height: size)
      .background { Circle().fill(p.surface) }
      .overlay { Circle().strokeBorder(ring ?? p.line, lineWidth: ring == nil ? 1 : max(1.5, size / 14)) }
  }
}
