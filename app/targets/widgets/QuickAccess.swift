import AppIntents
import Foundation
import Security
import SwiftUI
import UIKit
import WidgetKit

// QUICK ACCESS: what the two quick-access widgets read, and their buttons.
//
//   From your people (PeopleWidget.swift)   the latest few things from family and friends
//   Needs you (NeedsWidget.swift)           a bot's question with its answers, a yes, a task given to you, each with its buttons
//
// Everything they draw is the server's: GET /v1/widgets/now answers both widgets' rows already worded, each with where its tap
// goes and its buttons, and the look (colours, each kind's SF Symbol, the buttons' styles, how a time is written, the Lock
// Screen's line, the empty state and its button). The app writes that document as it is to the App Group key "tulmi.widget.now"
// (src/widgets/now.ts, setWidgetNow); nothing here asks the server for rows. Every read is lenient and keeps a literal fallback,
// so a missing or mistyped field never stops the rest from drawing, and a new kind of row or button is the server's data, not code.
//
// ANSWERING IN PLACE. A button the server marks "inPlace" runs AnswerNeedIntent here, in the extension: it posts to the server
// with the widgets' OWN token, never the session's. That token (POST /v1/widgets/token; backend src/widgets/token.ts) can only
// answer this person's needs-you and tick their own tasks, runs out in a day, is revoked at sign-out, and is kept in the shared
// Keychain (WidgetKeychain below; the app writes it through the bridge). The intent asks for the phone to be unlocked
// (authenticationPolicy). An answer that cannot be sent (no token, offline, refused) leaves the row saying "Open X0 Bot to finish",
// and a tap opens it there. A button marked "open" is a Link to the row in the app.

enum QuickKeys {
  /** The document the app wrote (GET /v1/widgets/now, as it was). */
  static let now = "tulmi.widget.now"
  /** When the app wrote it (ms since 1970): an answer given after this is drawn over the row until the next write. */
  static let writtenAt = "tulmi.widget.now.writtenAt"
  /** What a button did to a row since: { "<item>": { "s": "done" | "gone" | "failed", "at": ms } }. */
  static let state = "tulmi.widget.now.state"
  /** Where a button posts and when the token runs out: { "baseUrl", "path", "expiresAt" }. Not the token (the Keychain's). */
  static let tokenMeta = "tulmi.widget.token.meta"
  /** The token's Keychain account. */
  static let tokenAccount = "tulmi.widget.token"
  static let peopleKind = "space.tailzu.people"
  static let needsKind = "space.tailzu.needs"
}

/// Lenient reads out of a JSON object.
private extension Dictionary where Key == String, Value == Any {
  func str(_ k: String, _ fallback: String = "") -> String { (self[k] as? String) ?? fallback }
  func obj(_ k: String) -> [String: Any] { (self[k] as? [String: Any]) ?? [:] }
  func num(_ k: String) -> Double? { WidgetLook.number(self[k]) }
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
    actions = ((o["actions"] as? [Any]) ?? []).compactMap { ($0 as? [String: Any]).flatMap(NowAction.init) }
  }
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
      guard let n = WidgetLook.number(value) else { return nil }
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

/// The colours and styles the server sent with the rows, read through the month's Ink when absent.
struct NowLook {
  var colors: [String: String] = [:]
  var alphas: [String: Double] = [:]
  var styles: [String: [String: String]] = [:]
  var light: [String: String] = [:]

  init() {}

  init(_ o: [String: Any]) {
    colors = o.obj("colors").compactMapValues { $0 as? String }
    alphas = o.obj("alpha").compactMapValues { WidgetLook.number($0) }
    styles = o.obj("styles").compactMapValues { value -> [String: String]? in
      (value as? [String: Any])?.compactMapValues { part in part as? String }
    }
    light = o.obj("light").compactMapValues { $0 as? String }
  }

  /// A colour by role. In Light Mode the server's `light` palette wins when it sent one; with none the card stays the brand's
  /// dark ink, as the Month draws it.
  func color(_ key: String, _ fallback: Color, scheme: ColorScheme) -> Color {
    if scheme == .light, let c = light[key].flatMap({ Color(hex: $0) }) { return c }
    return colors[key].flatMap { Color(hex: $0) } ?? fallback
  }

  func alpha(_ key: String, _ fallback: Double) -> Double {
    guard let a = alphas[key], a >= 0, a <= 1 else { return fallback }
    return a
  }

  func style(_ name: String, _ part: String) -> Color? { styles[name]?[part].flatMap { Color(hex: $0) } }
}

struct NowDoc {
  var time = "relative"
  var refreshSec: Double = 900
  var look = NowLook()
  var people = NowSection()
  var needs = NowSection()
  var writtenAt: Double = 0

  init() {}

  init?(json data: Data) {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], (o["v"] as? NSNumber) != nil else { return nil }
    time = o.str("time", "relative")
    refreshSec = max(60, o.num("refreshSec") ?? 900)
    look = NowLook(o.obj("look"))
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

/// What a button did to a row, until the app next writes the rows.
enum RowState: String {
  case done, gone, failed
}

enum NowStates {
  static func all(since writtenAt: Double) -> [String: RowState] {
    guard let raw = Shared.store?.string(forKey: QuickKeys.state), let data = raw.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
    var out: [String: RowState] = [:]
    for (item, v) in o {
      guard let e = v as? [String: Any], let s = (e["s"] as? String).flatMap(RowState.init(rawValue:)),
            let at = WidgetLook.number(e["at"]), at > writtenAt else { continue }
      out[item] = s
    }
    return out
  }

  static func set(_ item: String, _ state: RowState) {
    let d = Shared.store
    var o = (d?.string(forKey: QuickKeys.state)?.data(using: .utf8))
      .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
    let now = Date().timeIntervalSince1970 * 1000
    // A day is long enough for any row to have been written again.
    o = o.filter { entry in
      let at = (entry.value as? [String: Any]).flatMap { e in WidgetLook.number(e["at"]) } ?? 0
      return at > now - 86_400_000
    }
    o[item] = ["s": state.rawValue, "at": now]
    if let data = try? JSONSerialization.data(withJSONObject: o), let s = String(data: data, encoding: .utf8) {
      d?.set(s, forKey: QuickKeys.state)
    }
  }
}

/// The widgets' own token, read from the shared Keychain the app writes it to (the bridge's TulmiKeychain, the same group and
/// service as the session's, its own account). Read only, here.
enum WidgetKeychain {
  static let accessGroup = "6552H8HYA4.com.tulmi.app.shared"
  static let service = "space.tailzu.tulmi.bearer"

  static func string(_ account: String) -> String? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

/// One answer, posted with the widgets' token. What happened, as the row will show it.
enum WidgetAct {
  static func post(item: String, action: String) async -> RowState {
    guard let token = WidgetKeychain.string(QuickKeys.tokenAccount), token.hasPrefix("xwt_"),
          let raw = Shared.store?.string(forKey: QuickKeys.tokenMeta), let data = raw.data(using: .utf8),
          let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .failed }
    let expiresAt = WidgetLook.number(meta["expiresAt"]) ?? 0
    guard expiresAt > Date().timeIntervalSince1970 * 1000 else { return .failed }
    let base = (meta["baseUrl"] as? String) ?? Shared.store?.string(forKey: "tulmi.baseUrl") ?? "https://api.x0bot.com"
    let path = (meta["path"] as? String).flatMap { $0.hasPrefix("/v1/") ? $0 : nil } ?? "/v1/widgets/act"
    guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path),
          url.scheme == "https" || url.host == "localhost" else { return .failed }
    var req = URLRequest(url: url, timeoutInterval: 12)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(token, forHTTPHeaderField: "X-Widget-Token")
    // A key per tap: the server answers it once, whatever reaches it twice.
    let body: [String: Any] = ["item": item, "action": action, "key": "w" + UUID().uuidString.replacingOccurrences(of: "-", with: "")]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
      let (_, res) = try await URLSession.shared.data(for: req)
      let status = (res as? HTTPURLResponse)?.statusCode ?? 0
      if (200..<300).contains(status) { return .done }
      if status == 409 || status == 404 || status == 410 { return .gone }
      return .failed
    } catch {
      return .failed
    }
  }
}

/// A button of a Needs you row, pressed: answered here with the widgets' token; the row shows how it went until the app writes
/// the rows again. Asks for the phone to be unlocked first.
struct AnswerNeedIntent: AppIntent {
  static let title: LocalizedStringResource = "Answer from the widget"
  static let description = IntentDescription("Answers a question or ticks off a task from the X0 Bot widget.")
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
    let outcome = await WidgetAct.post(item: item, action: action)
    NowStates.set(item, outcome)
    WidgetCenter.shared.reloadTimelines(ofKind: QuickKeys.needsKind)
    WidgetCenter.shared.reloadTimelines(ofKind: QuickKeys.peopleKind)
    return .result()
  }
}

// ------------------------------------------------------------------ the timeline both widgets share

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
    // The app redraws both widgets every time it writes fresh rows; this only has to hold between those writes, so it asks again
    // after the server's interval (relative times count on their own meanwhile).
    let doc = NowDoc.load()
    let entry = NowEntry(date: Date(), doc: doc, states: NowStates.all(since: doc?.writtenAt ?? 0))
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(doc?.refreshSec ?? 900))))
  }
}

// ------------------------------------------------------------------ parts both widgets draw

/// The colours a quick-access widget draws with: the server's look, then the Month's ink, then the literal.
struct QuickInk {
  let look: NowLook
  let scheme: ColorScheme
  var ground: Color { look.color("ground", Ink.ground, scheme: scheme) }
  var pale: Color { look.color("pale", Ink.pale, scheme: scheme) }
  var accent: Color { look.color("accent", look.color("mark", Ink.mark, scheme: scheme), scheme: scheme) }
  var dim: Color { pale.opacity(look.alpha("dim", 0.52)) }
  var rule: Color { pale.opacity(look.alpha("rule", 0.13)) }

  func fg(_ style: String) -> Color {
    look.style(style, "fg") ?? (style == "primary" ? ground : pale)
  }

  func bg(_ style: String) -> Color {
    look.style(style, "bg") ?? (style == "primary" ? pale : rule)
  }
}

/// When, the way the server said: counting ("4 min"), the clock ("6:30 pm"), or its own words.
struct WhenText: View {
  let row: NowRow
  let style: String
  var body: some View {
    if let at = row.at, style == "relative" {
      Text(at, style: .relative)
    } else if let at = row.at, style == "clock" {
      Text(at, style: .time)
    } else {
      Text(row.when)
    }
  }
}

/// A section's header: its symbol and title.
struct QuickHeader: View {
  let section: NowSection
  let fallbackTitle: String
  let fallbackIcon: String
  let ink: QuickInk
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: symbol(section.icon, fallbackIcon))
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(ink.accent)
        .widgetAccentable()
      Text(section.title.isEmpty ? fallbackTitle : section.title)
        .font(.system(size: 11, weight: .semibold))
        .tracking(0.4)
        .foregroundStyle(ink.dim)
        .lineLimit(1)
      Spacer(minLength: 0)
    }
  }
}

/// Nothing to show: the server's line, and its button (the whole widget opens it). Before the app has written anything (never
/// opened, signed out), the literals.
struct QuickEmpty: View {
  let section: NowSection
  let ink: QuickInk
  let compact: Bool
  let fallbackTitle: String
  let fallbackBody: String
  let fallbackCta: String

  private var title: String { section.emptyTitle.isEmpty ? fallbackTitle : section.emptyTitle }
  private var bodyLine: String { section.emptyTitle.isEmpty ? fallbackBody : section.emptyBody }
  private var cta: String { section.emptyTitle.isEmpty ? fallbackCta : section.emptyCta }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Spacer(minLength: 0)
      Text(title)
        .font(.system(size: compact ? 14 : 16, weight: .semibold))
        .foregroundStyle(ink.pale)
        .lineLimit(2)
      if !bodyLine.isEmpty {
        Text(bodyLine)
          .font(.system(size: 12))
          .foregroundStyle(ink.dim)
          .lineLimit(compact ? 3 : 2)
      }
      if !cta.isEmpty {
        Text(cta)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ink.fg("primary"))
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(ink.bg("primary"), in: Capsule())
          .padding(.top, 2)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
  }
}

/// A row's mark: its kind's symbol, in its kind's colour when the server gave one.
struct KindMark: View {
  let row: NowRow
  let ink: QuickInk
  var body: some View {
    Image(systemName: symbol(row.icon, "circle.fill"))
      .font(.system(size: 12, weight: .semibold))
      .foregroundStyle(row.color ?? ink.accent)
      .frame(width: 16)
      .widgetAccentable()
  }
}
