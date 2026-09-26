import SwiftUI
import WidgetKit

// THE WIDGETS. One extension, three things: the month on the Home and Lock
// Screen, the Flow session as a Live Activity, and Dictate as a Control.
// Everything they show comes from the App Group the app writes; nothing here
// talks to the server, and no dictated text is ever drawn — a widget sits on
// a Lock Screen.
//
// That includes the words and the colours: the app writes them from the
// server's labels and flags next to the month's numbers (src/widgets/month.ts),
// and every one read here keeps the literal it replaced as its fallback, for a
// phone whose app has not written them yet.

@main
struct TailzuWidgetBundle: WidgetBundle {
  var body: some Widget {
    MonthWidget()
    FlowActivityWidget()
    if #available(iOS 18.0, *) {
      DictateControl()
    }
  }
}

/// The app's own colours, as STATS_UI in the backend's catalog has them — or
/// as the server last sent them (widget.color.* / widget.alpha.* in the app's
/// flags, written into the month's JSON).
enum Ink {
  private static let groundFallback = Color(red: 0x0F / 255, green: 0x0D / 255, blue: 0x0B / 255)
  private static let paleFallback = Color(red: 0xF3 / 255, green: 0xE2 / 255, blue: 0xC6 / 255)
  private static let amberFallback = Color(red: 0xE8 / 255, green: 0xA2 / 255, blue: 0x3C / 255)

  static var ground: Color { WidgetLook.current.color("ground", groundFallback) }
  static var pale: Color { WidgetLook.current.color("pale", paleFallback) }
  static var amber: Color { WidgetLook.current.color("amber", amberFallback) }
  static var dim: Color { pale.opacity(WidgetLook.current.alpha("dim", 0.52)) }
  static var rule: Color { pale.opacity(WidgetLook.current.alpha("rule", 0.13)) }
  /// The empty part of the month's line.
  static var track: Double { WidgetLook.current.alpha("track", 0.14) }
}

enum Shared {
  static let appGroup = "group.com.tulmi.app"
  static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

/// Everything the app wrote next to the month's numbers that is not a number:
/// the words (labels), the colours, the line's alphas, where a tap goes, how
/// often to ask again, the subscriber's span. Read leniently — a missing or
/// mistyped field is simply absent, and its caller falls back to its literal —
/// so nothing here can stop the numbers from drawing.
struct WidgetLook {
  var labels: [String: String] = [:]
  var colors: [String: String] = [:]
  var alphas: [String: Double] = [:]
  var url: String?
  var refreshSec: Double?
  var span: Double?

  init() {}

  init(json data: Data) {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    labels = (o["labels"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
    colors = (o["colors"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
    alphas = (o["alpha"] as? [String: Any])?.compactMapValues { WidgetLook.number($0) } ?? [:]
    url = o["url"] as? String
    refreshSec = WidgetLook.number(o["refreshSec"])
    span = WidgetLook.number(o["span"])
  }

  private static func number(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  /// A label, or the literal it replaced.
  func text(_ key: String, _ fallback: String) -> String { labels[key] ?? fallback }

  /// A label with its `{n}` filled in.
  func text(_ key: String, _ fallback: String, n value: String) -> String {
    text(key, fallback).replacingOccurrences(of: "{n}", with: value)
  }

  func color(_ key: String, _ fallback: Color) -> Color {
    colors[key].flatMap { Color(hex: $0) } ?? fallback
  }

  func alpha(_ key: String, _ fallback: Double) -> Double {
    guard let a = alphas[key], a >= 0, a <= 1 else { return fallback }
    return a
  }

  /// Where a tap on the month goes.
  var tapURL: URL? { URL(string: url ?? "tulmi://screen/stats") ?? URL(string: "tulmi://screen/stats") }

  /// Seconds until the timeline asks again (the app also reloads it whenever
  /// it writes fresh numbers).
  var refreshInterval: TimeInterval {
    guard let s = refreshSec, s > 0 else { return 3600 }
    return s
  }

  // What the App Group holds right now, parsed once per change: every colour
  // and word reads through here, several times a render.
  private static let lock = NSLock()
  private static var cachedRaw: String?
  private static var cached = WidgetLook()

  static var current: WidgetLook {
    let raw = Shared.store?.string(forKey: "tulmi.widget.month")
    lock.lock(); defer { lock.unlock() }
    if raw == cachedRaw { return cached }
    cachedRaw = raw
    cached = raw.flatMap { $0.data(using: .utf8) }.map { WidgetLook(json: $0) } ?? WidgetLook()
    return cached
  }
}

extension Color {
  /// "#RGB", "#RRGGBB" or "#RRGGBBAA" (the # optional); nil for anything else.
  init?(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6 || s.count == 8,
          s.allSatisfy({ $0.isHexDigit }),
          let v = UInt64(s, radix: 16) else { return nil }
    let hasAlpha = s.count == 8
    let rgb = hasAlpha ? v >> 8 : v
    let r = Double((rgb >> 16) & 0xFF) / 255
    let g = Double((rgb >> 8) & 0xFF) / 255
    let b = Double(rgb & 0xFF) / 255
    let a = hasAlpha ? Double(v & 0xFF) / 255 : 1
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}

/// THE WAVE OF THE MARK: the seven bars of uneven height from the app icon,
/// as the keyboard's mic key draws them. Drawn, not an image, so it is the
/// same shape at every size and in every colour.
struct WaveMark: View {
  var color: Color = Ink.amber
  private let heights: [CGFloat] = [28, 36, 41, 46, 43, 34, 28]
  var body: some View {
    GeometryReader { geo in
      let n = CGFloat(heights.count)
      let gap = geo.size.width / (n * 2 - 1)
      let unit = geo.size.height / 46
      HStack(alignment: .center, spacing: gap) {
        ForEach(0..<heights.count, id: \.self) { i in
          RoundedRectangle(cornerRadius: gap * 0.5, style: .continuous)
            .fill(color)
            .frame(width: gap, height: heights[i] * unit)
        }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
  }
}

/// A count as the app prints it: "4,820".
func n(_ value: Int) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  return f.string(from: NSNumber(value: value)) ?? String(value)
}
