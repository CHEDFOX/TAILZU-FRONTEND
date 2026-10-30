import SwiftUI
import WidgetKit

// THE WIDGETS. One extension: the month on the Home and Lock Screen, the
// quick-access widgets (From your people, Needs you: QuickAccess.swift), the
// microphone session as a Live Activity, setup as a Live Activity, and
// Dictate as a Control.
// Everything they show comes from the App Group the app writes; nothing here
// talks to the server, and no dictated text is ever drawn — a widget sits on
// a Lock Screen.
//
// The words are the server's: the app writes them from the server's labels
// and flags (src/widgets/month.ts, now.ts, flow.ts), and every one read here
// keeps a literal as its fallback, for a phone whose app has not written them
// yet. The look is the app's own and lives here: X0Palette, X0Mark, X0Pill.

@main
struct TailzuWidgetBundle: WidgetBundle {
  var body: some Widget {
    MonthWidget()
    PeopleWidget()
    NeedsWidget()
    FlowActivityWidget()
    SetupActivityWidget()
    if #available(iOS 18.0, *) {
      DictateControl()
    }
  }
}

/// The name on every surface.
let x0Name = "X0"

/// THE PALETTE: the app's own (backend experience/bots/palette.ts), white and
/// ink with greys, in a light and a dark version. Home Screen widgets and the
/// Lock Screen banners follow the system's appearance; the Dynamic Island is
/// always dark; the Lock Screen's accessory widgets stay system-tinted. Colour
/// belongs only to bots (BotInk).
///
/// The server's old widget colour knobs (widget.color.* / widget.alpha.*, and
/// the colours in widgets.look) are still written by the app but no longer
/// read: the palette is native.
struct X0Palette {
  let ground: Color
  let ink: Color
  /// Secondary words: who, when, a label.
  let meta: Color
  let dim: Color
  /// Hairlines between rows, a secondary button's border, an empty track.
  let line: Color
  /// An avatar's ground.
  let surface: Color
  /// A dark ground: the mark sits on its white tile.
  let onDark: Bool

  static let light = X0Palette(
    ground: Color(rgb: 0xFFFFFF), ink: Color(rgb: 0x0A0A0A), meta: Color(rgb: 0x5C5C5C),
    dim: Color(rgb: 0x8A8A8A), line: Color(rgb: 0xE6E6E6), surface: Color(rgb: 0xF5F5F5), onDark: false)

  static let dark = X0Palette(
    ground: Color(rgb: 0x0A0A0A), ink: Color(rgb: 0xFFFFFF), meta: Color(rgb: 0xA3A3A3),
    dim: Color(rgb: 0x737373), line: Color(rgb: 0x262626), surface: Color(rgb: 0x171717), onDark: true)

  static func of(_ scheme: ColorScheme) -> X0Palette { scheme == .dark ? dark : light }
}

/// Each bot's own ink (backend experience/bots/art.ts BOT_INK, by the bot's
/// key) and the natural palette a person's own bot is given (palette.ts
/// PALETTE_HEX, by name). X0 itself ("tailzu") has none: it is drawn in ink,
/// which turns white in the dark.
enum BotInk {
  private static let inks: [String: UInt32] = [
    "keybot": 0xA9573A, "code": 0x4F7A3A, "plan": 0x8F6A1F, "travel": 0x3E6E8E,
    "moss": 0x4F7A3A, "clay": 0xA9573A, "ochre": 0x8F6A1F, "sea": 0x3E6E8E,
    "pine": 0x2F5D50, "plum": 0x6E4A6B, "sand": 0x7A6440, "stone": 0x5F6B6E,
  ]

  static func color(_ key: String) -> Color? {
    inks[key.lowercased()].map { Color(rgb: $0) }
  }
}

/// THE MARK: the app icon's painted black bot — his head, cut from the launch
/// art (Assets.xcassets/X0Mark). On a dark ground (Dark Mode, the Dynamic
/// Island, the Lock Screen) he sits on a small white circle so he stays
/// visible. Takes the same size-by-size box either way, so a layout is the
/// same in both appearances.
struct X0Mark: View {
  var size: CGFloat = 20
  var onDark: Bool

  var body: some View {
    ZStack {
      if onDark {
        Circle().fill(Color.white)
        head.frame(width: size * 0.8)
      } else {
        head.frame(width: size)
      }
    }
    .frame(width: size, height: size)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(x0Name)
  }

  private var head: some View {
    Image("X0Mark")
      .resizable()
      .interpolation(.high)
      .aspectRatio(contentMode: .fit)
  }
}

/// The mark and the name, as a surface's header.
struct X0Brand: View {
  let p: X0Palette
  var size: CGFloat = 22
  var body: some View {
    HStack(spacing: 7) {
      X0Mark(size: size, onDark: p.onDark)
      Text(x0Name)
        .font(.system(size: 14, weight: .semibold))
        .tracking(-0.2)
        .foregroundStyle(p.ink)
        .lineLimit(1)
    }
  }
}

/// A button, as the app draws one: fully rounded; the primary filled with ink
/// and worded in the ground, a secondary one a 1pt line-coloured border with
/// ink words. Never truncated: a pill keeps its words' width (`fill` stretches
/// it to the row and shrinks its words a little before cutting any).
struct X0Pill: View {
  let label: String
  var icon: String? = nil
  let primary: Bool
  let p: X0Palette
  var fill = false
  var height: CGFloat = 30

  var body: some View {
    HStack(spacing: 5) {
      if let icon {
        Image(systemName: symbol(icon, "checkmark")).font(.system(size: 11, weight: .bold))
      }
      Text(label)
        .lineLimit(1)
        .minimumScaleFactor(fill ? 0.75 : 1)
    }
    .font(.system(size: 13, weight: .semibold))
    .foregroundStyle(primary ? p.ground : p.ink)
    .padding(.horizontal, 14)
    .frame(maxWidth: fill ? .infinity : nil)
    .frame(height: height)
    .background {
      if primary {
        Capsule().fill(p.ink)
      } else {
        Capsule().strokeBorder(p.line, lineWidth: 1)
      }
    }
    .fixedSize(horizontal: !fill, vertical: false)
    .contentShape(Capsule())
  }
}

/// A line between rows.
struct Hairline: View {
  let p: X0Palette
  var body: some View {
    Rectangle().fill(p.line).frame(height: 1)
  }
}

enum Shared {
  static let appGroup = "group.com.tulmi.app"
  static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

/// Everything the app wrote next to the month's numbers that is not a number:
/// the words (labels), where a tap goes, how often to ask again, the
/// subscriber's span, whether the streak shows. Read leniently — a missing or
/// mistyped field is simply absent, and its caller falls back to its literal —
/// so nothing here can stop the numbers drawing. (The colours and alphas the
/// app still writes beside them are not read: X0Palette.)
struct WidgetLook {
  var labels: [String: String] = [:]
  var url: String?
  var refreshSec: Double?
  var span: Double?
  /// Whether the month shows the streak (widget.month.streak). Off: minimal.
  var showStreak = false
  /// Whether the month shows the progress line (widget.month.show.progress).
  /// On unless the server turns it off.
  var showProgress = true

  init() {}

  init(json data: Data) {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    labels = (o["labels"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
    url = o["url"] as? String
    refreshSec = WidgetLook.number(o["refreshSec"])
    span = WidgetLook.number(o["span"])
    showStreak = (o["showStreak"] as? Bool) ?? false
    showProgress = (o["showProgress"] as? Bool) ?? true
  }

  /// A finite JSON number, or nil. Shared by every lenient read here.
  static func number(_ v: Any?) -> Double? {
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

  /// Where a tap on the month goes: the server's link (widget.month.url), or
  /// the Bots app's usage screen.
  var tapURL: URL? {
    let fallback = "tulmi://screen/bots.usage"
    return URL(string: url ?? fallback) ?? URL(string: fallback)
  }

  /// Seconds until the timeline asks again (the app also reloads it whenever
  /// it writes fresh numbers).
  var refreshInterval: TimeInterval {
    guard let s = refreshSec, s > 0 else { return 3600 }
    return s
  }

  // What the App Group holds right now, parsed once per change: every word
  // reads through here, several times a render.
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
  /// 0xRRGGBB.
  init(rgb: UInt32) {
    self.init(
      .sRGB,
      red: Double((rgb >> 16) & 0xFF) / 255,
      green: Double((rgb >> 8) & 0xFF) / 255,
      blue: Double(rgb & 0xFF) / 255,
      opacity: 1)
  }

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

/// A count as the app prints it: "4,820".
func n(_ value: Int) -> String {
  let f = NumberFormatter()
  f.numberStyle = .decimal
  return f.string(from: NSNumber(value: value)) ?? String(value)
}
