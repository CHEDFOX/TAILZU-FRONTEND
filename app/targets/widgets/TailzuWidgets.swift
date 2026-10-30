import SwiftUI
import WidgetKit

// THE WIDGETS. One extension: X0, the universal widget (the whole app at a
// glance: what needs you, what the bots are doing, and Ask — X0Widget.swift),
// From your people (PeopleWidget.swift), the running job as a Live Activity
// ("Bots at work": BotsActivity.swift), the microphone session and setup as
// Live Activities, and Dictate as a Control. (The Month and Needs you were
// retired: X0 shows both.)
// Everything they show comes from the App Group the app writes; nothing here
// fetches anything (the one thing sent is an answer, with the widgets' own
// token), and no dictated text is ever drawn — a widget sits on a Lock Screen.
//
// The words are the server's: the app writes them from the server's labels,
// flags and glance (src/widgets), and every one read here keeps a literal as
// its fallback, for a phone whose app has not written them yet. The look is
// the app's own and lives here: X0Palette, X0Mark, X0Pill.

@main
struct TailzuWidgetBundle: WidgetBundle {
  var body: some Widget {
    X0GlanceWidget()
    PeopleWidget()
    BotsActivityWidget()
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
  /// An avatar's ground, the Ask bar's.
  let surface: Color
  /// A secondary button's border.
  let outline: Color
  /// The week's open bead.
  let hollow: Color
  /// A dark ground: the mark sits on its white tile, a bot's colour is lifted.
  let onDark: Bool

  static let light = X0Palette(
    ground: Color(rgb: 0xFFFFFF), ink: Color(rgb: 0x0A0A0A), meta: Color(rgb: 0x5C5C5C),
    dim: Color(rgb: 0x8A8A8A), line: Color(rgb: 0xE6E6E6), surface: Color(rgb: 0xF5F5F5),
    outline: Color(rgb: 0xD4D4D4), hollow: Color(rgb: 0xC9C9C9), onDark: false)

  static let dark = X0Palette(
    ground: Color(rgb: 0x0A0A0A), ink: Color(rgb: 0xFFFFFF), meta: Color(rgb: 0xA3A3A3),
    dim: Color(rgb: 0x737373), line: Color(rgb: 0x262626), surface: Color(rgb: 0x171717),
    outline: Color(rgb: 0x3D3D3D), hollow: Color(rgb: 0x4A4A4A), onDark: true)

  /// The Dynamic Island: always black.
  static let island = X0Palette(
    ground: Color(rgb: 0x000000), ink: Color(rgb: 0xFFFFFF), meta: Color(rgb: 0xA3A3A3),
    dim: Color(rgb: 0x737373), line: Color(rgb: 0x2C2C2C), surface: Color(rgb: 0x171717),
    outline: Color(rgb: 0x3D3D3D), hollow: Color(rgb: 0x4A4A4A), onDark: true)

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
    rgb(key).map { Color(rgb: $0) }
  }

  /// The ink as 0xRRGGBB, by the bot's key or its palette name.
  static func rgb(_ key: String) -> UInt32? {
    inks[key.lowercased()]
  }

  /// A bot's colour as drawn: the server's (`color`), else its own ink by key, else nil (draw it in ink). On a dark ground it is
  /// lifted 28% towards white, so it carries.
  static func tint(_ key: String, hex: String? = nil, dark: Bool) -> Color? {
    guard let v = hex.flatMap(rgbOf) ?? rgb(key) else { return nil }
    let t = dark ? 0.28 : 0
    func c(_ shift: UInt32) -> Double {
      let x = Double((v >> shift) & 0xFF) / 255
      return x + (1 - x) * t
    }
    return Color(.sRGB, red: c(16), green: c(8), blue: c(0), opacity: 1)
  }

  /// "#RRGGBB" (the # optional) as 0xRRGGBB.
  private static func rgbOf(_ hex: String) -> UInt32? {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, s.allSatisfy({ $0.isHexDigit }) else { return nil }
    return UInt32(s, radix: 16)
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
/// and worded in the ground, a secondary one a 1pt outline-grey border with
/// ink words, a quiet one only its words in the meta grey ("You decide").
/// Never truncated: a pill keeps its words' width (`fill` stretches it to the
/// row and shrinks its words a little before cutting any).
struct X0Pill: View {
  let label: String
  var icon: String? = nil
  let primary: Bool
  let p: X0Palette
  var fill = false
  var height: CGFloat = 30
  var size: CGFloat = 13
  var padding: CGFloat = 14
  var quiet = false

  var body: some View {
    HStack(spacing: 5) {
      if let icon {
        Image(systemName: symbol(icon, "checkmark")).font(.system(size: 11, weight: .bold))
      }
      Text(label)
        .lineLimit(1)
        .minimumScaleFactor(fill ? 0.75 : 1)
    }
    .font(.system(size: size, weight: quiet ? .medium : .semibold))
    .tracking(-0.1)
    .foregroundStyle(primary ? p.ground : quiet ? p.meta : p.ink)
    .padding(.horizontal, padding)
    .frame(maxWidth: fill ? .infinity : nil)
    .frame(height: height)
    .background {
      if primary {
        Capsule().fill(p.ink)
      } else if !quiet {
        Capsule().strokeBorder(p.outline, lineWidth: 1)
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
