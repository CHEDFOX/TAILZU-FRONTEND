import SwiftUI
import WidgetKit

// THE WIDGETS. One extension: X0, the universal widget (the whole app at a
// glance: what needs you, what the bots are doing, and Ask — X0Widget.swift),
// X0 Board, the spare kind whose contents are a choice (X0Board.swift),
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
// the app's own and lives here: X0Palette, X0Mark (Blip's head), Blip, X0Pill.

@main
struct TailzuWidgetBundle: WidgetBundle {
  var body: some Widget {
    X0GlanceWidget()
    X0BoardWidget()
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
/// The literals below are the fallback, not the source. `of(_:)` reads the
/// nlook catalog's `ink` palette first and the widget theme the app writes
/// (widget.color.* / widgets.look) second, so iOS and Android follow one knob
/// again; with neither on the phone, these literals draw, and they are what
/// the server already sends.
struct X0Palette {
  let ground: Color
  let ink: Color
  /// Secondary words: who, when, a label.
  let meta: Color
  /// A stage still to come, idle things. Words are set in it, so it holds 4.5:1 on its ground (5.1:1 light, 5.7:1 dark).
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
    dim: Color(rgb: 0x6E6E6E), line: Color(rgb: 0xE6E6E6), surface: Color(rgb: 0xF5F5F5),
    outline: Color(rgb: 0xD4D4D4), hollow: Color(rgb: 0xC9C9C9), onDark: false)

  static let dark = X0Palette(
    ground: Color(rgb: 0x0A0A0A), ink: Color(rgb: 0xFFFFFF), meta: Color(rgb: 0xA3A3A3),
    dim: Color(rgb: 0x8A8A8A), line: Color(rgb: 0x262626), surface: Color(rgb: 0x171717),
    outline: Color(rgb: 0x3D3D3D), hollow: Color(rgb: 0x4A4A4A), onDark: true)

  /// The Dynamic Island: always black.
  static let island = X0Palette(
    ground: Color(rgb: 0x000000), ink: Color(rgb: 0xFFFFFF), meta: Color(rgb: 0xA3A3A3),
    dim: Color(rgb: 0x8A8A8A), line: Color(rgb: 0x2C2C2C), surface: Color(rgb: 0x171717),
    outline: Color(rgb: 0x3D3D3D), hollow: Color(rgb: 0x4A4A4A), onDark: true)

  /// THE SERVER'S PALETTE, READ AGAIN. iOS stopped reading the server's colours when the palette went native; Android never
  /// did, so one knob could move the two apps apart. Now there is one source again, tried in order:
  ///
  ///   1. the nlook catalog's `ink` palette, which carries all ten roles and is THE source once a catalog is on the phone;
  ///   2. the widget theme the app still writes on every bootstrap (`tulmi.widget.theme`, from widget.color.*): six roles,
  ///      `colors` for dark and `light` for light, where `pale` is the ink;
  ///   3. the literals below, which are what the server already sends, so nothing moves until someone changes a knob.
  ///
  /// Parsed once per version of the catalog, not per view: a widget render must not parse JSON per view, and a warm
  /// extension must not keep a theme the app has since replaced (`NLookStore.forgetVersion` clears it).
  static func of(_ scheme: ColorScheme) -> X0Palette {
    let base = scheme == .dark ? dark : light
    if let roles = NLookStore.index?.palettes["ink"]?.scheme(scheme) {
      return X0Palette(
        ground: roles.ground, ink: roles.ink, meta: roles.meta, dim: roles.dim, line: roles.line,
        surface: roles.surface, outline: roles.outline, hollow: roles.hollow, onDark: base.onDark)
    }
    guard let sent = X0Palette.themed(scheme) else { return base }
    return sent
  }

  private static let themeLock = NSLock()
  private static var themeRead = false
  private static var themeLight: X0Palette?
  private static var themeDark: X0Palette?

  /// The legacy widget theme, parsed once. Every role keeps the literal under it, so half a theme is half an answer rather
  /// than a hole.
  private static func themed(_ scheme: ColorScheme) -> X0Palette? {
    themeLock.lock()
    if !themeRead {
      themeRead = true
      if let raw = Shared.store?.string(forKey: "tulmi.widget.theme"), !raw.isEmpty,
         let data = raw.data(using: .utf8),
         let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
        themeDark = over(dark, (o["colors"] as? [String: Any]) ?? [:])
        themeLight = over(light, (o["light"] as? [String: Any]) ?? [:])
      }
    }
    let out = scheme == .dark ? themeDark : themeLight
    themeLock.unlock()
    return out
  }

  /// Read the legacy theme again at the next ask. Called when the catalog's version folder changes, which is the one
  /// moment the app has rewritten what this process holds.
  static func forgetTheme() {
    themeLock.lock()
    themeRead = false
    themeDark = nil
    themeLight = nil
    themeLock.unlock()
  }

  /// The theme's six roles over a base palette. `pale` is what that knob calls the ink.
  private static func over(_ base: X0Palette, _ o: [String: Any]) -> X0Palette {
    func hex(_ k: String) -> Color? {
      guard let s = o[k] as? String, !s.isEmpty else { return nil }
      return Color(hex: s)
    }
    return X0Palette(
      ground: hex("ground") ?? base.ground, ink: hex("pale") ?? base.ink, meta: hex("meta") ?? base.meta,
      dim: base.dim, line: hex("line") ?? base.line, surface: hex("surface") ?? base.surface,
      outline: base.outline, hollow: base.hollow, onDark: base.onDark)
  }

  /// The Always-On Lock Screen dims everything it keeps to about half: there every word takes the ink, so nothing fades out
  /// (a Live Activity's banner reads `isLuminanceReduced`); the weights keep the hierarchy.
  func reduced(_ on: Bool) -> X0Palette {
    guard on else { return self }
    return X0Palette(
      ground: ground, ink: ink, meta: ink, dim: ink, line: line, surface: surface, outline: outline, hollow: hollow,
      onDark: onDark)
  }
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
  /// lifted 28% towards white, so it carries. Words are set in it (3/5, what a bot is doing), so it is then stepped towards
  /// black (light) or white (dark) until it holds 4.5:1 on the paler of the grounds it sits on (the surface grey): a pale
  /// colour from the server (an amber) would otherwise fade. The built-in bots' colours already hold and come back as they are.
  static func tint(_ key: String, hex: String? = nil, dark: Bool) -> Color? {
    guard let v = hex.flatMap(rgbOf) ?? rgb(key) else { return nil }
    let t = dark ? 0.28 : 0
    func c(_ shift: UInt32) -> Double {
      let x = Double((v >> shift) & 0xFF) / 255
      return x + (1 - x) * t
    }
    var mix = (c(16), c(8), c(0))
    let g = dark ? Double(0x17) / 255 : Double(0xF5) / 255
    var steps = 0
    while contrast(mix, (g, g, g)) < 4.5 && steps < 20 {
      mix = dark
        ? (mix.0 + (1 - mix.0) * 0.08, mix.1 + (1 - mix.1) * 0.08, mix.2 + (1 - mix.2) * 0.08)
        : (mix.0 * 0.92, mix.1 * 0.92, mix.2 * 0.92)
      steps += 1
    }
    return Color(.sRGB, red: mix.0, green: mix.1, blue: mix.2, opacity: 1)
  }

  /// WCAG's contrast ratio of two sRGB colours (0...1 channels).
  private static func contrast(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
    func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    func lum(_ x: (Double, Double, Double)) -> Double { 0.2126 * lin(x.0) + 0.7152 * lin(x.1) + 0.0722 * lin(x.2) }
    let (la, lb) = (lum(a), lum(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  /// "#RRGGBB" (the # optional) as 0xRRGGBB.
  private static func rgbOf(_ hex: String) -> UInt32? {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, s.allSatisfy({ $0.isHexDigit }) else { return nil }
    return UInt32(s, radix: 16)
  }
}

/// THE MARK: Blip's head — X0's own mascot, as the small solid glyph (no dots, which would be mush at this size:
/// Assets.xcassets/BlipHead). His malt face in its dark outline reads on the light ground, the dark one and the Dynamic Island
/// alike, so he needs no tile. Fits a size-by-size box, so a layout is the same in both appearances.
struct X0Mark: View {
  var size: CGFloat = 20

  var body: some View {
    Image("BlipHead")
      .resizable()
      .interpolation(.high)
      .x0Desaturated()
      .aspectRatio(contentMode: .fit)
      .frame(width: size, height: size)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(x0Name)
  }
}

/// Blip's poses (Assets.xcassets/Blip<Pose>): the whole dotted figure — one great eye under a heavy lid, a long neck, two
/// antennae — for the places big enough to show him (a Live Activity's banner, the widgets' quiet hours).
enum BlipPose: String {
  case rest, listen, think, look, work, yourTurn, done, oops, sleep

  var asset: String { "Blip" + rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

/// Blip in a pose, `height` tall, his own width (no pose is wider than 0.86 of its height).
struct Blip: View {
  let pose: BlipPose
  var height: CGFloat = 52

  var body: some View {
    Image(pose.asset)
      .resizable()
      .interpolation(.high)
      .x0Desaturated()
      .aspectRatio(contentMode: .fit)
      .frame(height: height)
      .accessibilityHidden(true)
  }
}

extension Image {
  /// On a tinted or clear Home Screen (iOS 18's accented rendering) a full-colour picture would be flattened to one tinted
  /// blob; drawn desaturated it keeps its eye and its dots.
  @ViewBuilder
  func x0Desaturated() -> some View {
    if #available(iOS 18.0, *) {
      self.widgetAccentedRenderingMode(.desaturated)
    } else {
      self
    }
  }
}

/// The mark and the name, as a surface's header.
struct X0Brand: View {
  let p: X0Palette
  var size: CGFloat = 22
  var body: some View {
    HStack(spacing: 7) {
      X0Mark(size: size)
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
