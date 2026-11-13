import CoreText
import SwiftUI
import UIKit

// NLOOK COLOUR AND TYPE: the palette roles, the colour grammar and the five type tokens.
//
// The palette is the catalog's (the index's `palettes`), which is THE source for widget colour: it replaces the old
// widgets.look knobs and stands beside today's X0Palette literals, which stay as the fallback for a phone with no catalog.
//
// Ten roles, as the contract froze them into format 1: ground, ink, paper, meta, dim, line, surface, accent, outline, hollow.
// `paper` is a second name for `ground`; `dim` falls back to `meta`; `outline` and `hollow` fall back to `line`. An unknown
// role becomes `ink`, so a design written for a later format still reads.
//
// COLOUR IS NEVER LIFTED BEHIND THE DESIGNER'S BACK. A "#RRGGBB" a designer wrote is drawn as written. A BOT's colour is not
// the designer's: it is the person's own, it arrives from the server, and a pale one would fade on the surface grey — so
// "$color" and "$bot.<slug>" go through BotInk.tint, which already steps a colour until it holds 4.5:1, exactly as today's
// views do.

/// One scheme of a palette: the ten roles, already resolved through their fallbacks.
struct NLookScheme {
  var ground: Color
  var ink: Color
  var meta: Color
  var dim: Color
  var line: Color
  var surface: Color
  var accent: Color
  var outline: Color
  var hollow: Color
  /// True when `ground` is the dark one: a bot's colour is lifted on it, as X0Palette.onDark says.
  var onDark: Bool

  func role(_ name: String) -> Color {
    switch name {
    case "ground", "paper": return ground
    case "ink": return ink
    case "meta": return meta
    case "dim": return dim
    case "line": return line
    case "surface": return surface
    case "accent": return accent
    case "outline": return outline
    case "hollow": return hollow
    // An unknown role becomes ink, never nothing: a hole is worse than a wrong grey.
    default: return ink
    }
  }

  /// Today's literals, so a phone with no catalog draws exactly what it drew before.
  static func of(_ p: X0Palette) -> NLookScheme {
    NLookScheme(
      ground: p.ground, ink: p.ink, meta: p.meta, dim: p.dim, line: p.line, surface: p.surface, accent: p.ink,
      outline: p.outline, hollow: p.hollow, onDark: p.onDark)
  }

  /// Read one scheme out of the index. Missing roles take their fallback; a bad colour takes today's.
  static func read(_ any: Any?, _ base: NLookScheme) -> NLookScheme {
    guard let o = any as? [String: Any] else { return base }
    func hex(_ k: String) -> Color? {
      guard let s = o[k] as? String, !s.isEmpty else { return nil }
      return Color(hex: s)
    }
    var s = base
    s.ground = hex("ground") ?? base.ground
    s.ink = hex("ink") ?? base.ink
    s.meta = hex("meta") ?? base.meta
    s.line = hex("line") ?? base.line
    s.surface = hex("surface") ?? base.surface
    s.accent = hex("accent") ?? base.accent
    s.dim = hex("dim") ?? s.meta
    s.outline = hex("outline") ?? s.line
    s.hollow = hex("hollow") ?? s.line
    // Which ground this is decides whether a bot's colour is lifted. The scheme's own name says it, not its luminance.
    return s
  }

  /// The Always-On Lock Screen dims everything to about half, so there every word takes the ink and the hierarchy is the
  /// type's. The same rule X0Palette.reduced keeps.
  func reduced(_ on: Bool) -> NLookScheme {
    guard on else { return self }
    var s = self
    s.meta = ink
    s.dim = ink
    return s
  }
}

/// A palette by name: the two schemes and the two alphas today's widgets already use.
struct NLookPalette {
  var dark: NLookScheme
  var light: NLookScheme
  var alphaDim: Double = 0.64
  var alphaRule: Double = 0.15

  static let fallback = NLookPalette(dark: .of(.dark), light: .of(.light))
  /// The Dynamic Island is always black, whatever the phone's appearance.
  static let island = NLookPalette(dark: .of(.island), light: .of(.island))

  func scheme(_ s: ColorScheme) -> NLookScheme { s == .dark ? dark : light }

  static func read(_ any: Any?) -> NLookPalette {
    guard let o = any as? [String: Any] else { return .fallback }
    var p = NLookPalette(
      dark: NLookScheme.read(o["dark"], .of(.dark)),
      light: NLookScheme.read(o["light"], .of(.light)))
    let a = NLookProps((o["alpha"] as? [String: Any]) ?? [:])
    if let d = a.num("dim"), d > 0, d <= 1 { p.alphaDim = d }
    if let r = a.num("rule"), r > 0, r <= 1 { p.alphaRule = r }
    return p
  }
}

/// What a colour token resolves against: the scheme in force and the bot whose colour "$color" means.
struct NLookInk {
  let scheme: NLookScheme
  /// The bot "$color" means on this surface (the job's bot, the asking bot), or empty.
  let bot: String
  /// The glance, for a bot's server-sent "#RRGGBB"; nil on a phone that has none.
  let glance: X0Glance?

  /// A colour token, as format 1 spells it: "#RRGGBB", "#RRGGBBAA", a palette role, "$color", "$bot.<slug>", any of them with
  /// an "@0.6" alpha suffix. Anything else is `ink`, never nothing.
  func color(_ token: String?) -> Color? {
    guard let token, !token.isEmpty else { return nil }
    var name = token
    var alpha: Double = 1
    if let at = name.lastIndex(of: "@") {
      let tail = String(name[name.index(after: at)...])
      if let a = Double(tail), a >= 0, a <= 1 {
        alpha = a
        name = String(name[..<at])
      }
    }
    let base = resolve(name)
    return alpha >= 1 ? base : base.opacity(alpha)
  }

  private func resolve(_ name: String) -> Color {
    if name.hasPrefix("#") { return Color(hex: name) ?? scheme.ink }
    if name == "$color" { return tint(bot) }
    if name.hasPrefix("$bot.") { return tint(String(name.dropFirst(5))) }
    return scheme.role(name)
  }

  /// A bot's own colour, lifted for this ground the way today's views lift it; ink when it has none.
  private func tint(_ slug: String) -> Color {
    guard !slug.isEmpty else { return scheme.ink }
    return BotInk.tint(slug, hex: glance?.bot(slug)?.color, dark: scheme.onDark) ?? scheme.ink
  }
}

// ------------------------------------------------------------------ type

/// The five type tokens format 1 promises in every target. A face that is not registered falls to the system one, so a build
/// whose Fonts/ folder is empty still draws every design — in the system face, never in nothing.
enum NLookType {
  /// Token and weight to the EXACT name `UIFont(name:)` answers to, read out of each file's name table with fontTools when
  /// the files were cut (see Fonts/FONTS.md). These are not guessed: the display face is a renamed cut, so its name is
  /// `TailzuBricolageSemiBold` and no family-plus-face guess would ever find it.
  ///
  /// `sans` and `mono` are the system's and have no file. A token with no file, or a file that did not register, falls to
  /// the system face in `font(_:size:weight:)`.
  private static let faceNames: [String: String] = [
    "brand/medium": "Geist-Medium",
    "brand/semibold": "Geist-SemiBold",
    "display/semibold": "TailzuBricolageSemiBold",
    "dots/regular": "Doto-Regular",
  ]

  /// Faces this process has registered (bundled, or hooked from the App Group), so a lookup costs nothing per node.
  private static var ready: Set<String> = []
  private static let lock = NSLock()

  /// A font for a token, a size and a weight. Unknown token: the system face.
  static func font(_ token: String?, size: CGFloat, weight: Int) -> Font {
    let w = swiftWeight(weight)
    let size = max(6, min(96, size))
    switch token {
    case "mono":
      return .system(size: size, weight: w, design: .monospaced)
    case "brand", "display", "dots":
      if let name = registeredName(token ?? "", weight: weight) {
        return .custom(name, size: size)
      }
      return .system(size: size, weight: w)
    default:
      return .system(size: size, weight: w)
    }
  }

  /// The name UIFont answers to, once the file is registered; nil when that face is not on this phone.
  ///
  /// Only the cuts the folder actually holds are named: `brand` has two weights and rounds to the nearer, `display` and
  /// `dots` have one each and take it at every weight the design asks for. A design asking brand 800 gets SemiBold rather
  /// than nothing, which is what the contract means by "the weights a design may ask for".
  private static func registeredName(_ token: String, weight: Int) -> String? {
    let key: String
    switch token {
    case "brand": key = weight >= 600 ? "brand/semibold" : "brand/medium"
    case "display": key = "display/semibold"
    case "dots": key = "dots/regular"
    default: return nil
    }
    guard let name = faceNames[key], UIFont(name: name, size: 12) != nil else { return nil }
    return name
  }

  private static func swiftWeight(_ w: Int) -> Font.Weight {
    switch w {
    case ..<450: return .regular
    case ..<550: return .medium
    case ..<650: return .semibold
    case ..<750: return .bold
    default: return .heavy
    }
  }

  /// Register every face this target carries, and every hooked file the app put in the App Group. Called once per process,
  /// before the first design is drawn. A file that will not register is skipped: its token falls to the system face.
  ///
  /// `.process` scope is the one that works in an extension: there is no UIAppFonts entry and no plist to pass through.
  static func registerOnce(hooked: [URL]) {
    lock.lock()
    defer { lock.unlock() }
    guard ready.isEmpty else { return }
    ready.insert("done")
    var urls: [URL] = []
    if let dir = Bundle.main.url(forResource: "Fonts", withExtension: nil),
       let found = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
      urls += found.filter { ["ttf", "otf"].contains($0.pathExtension.lowercased()) }
    }
    // A face can also sit loose in the bundle root, which is where some packagers flatten a folder.
    urls += (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
    urls += (Bundle.main.urls(forResourcesWithExtension: "otf", subdirectory: nil) ?? [])
    urls += hooked
    // The same face can be found twice (in Fonts/ and flattened at the bundle root), and registering it twice is a wasted
    // call plus an "already registered" error. One per file name, bundled before hooked, so a hooked file can never crowd a
    // bundled one out of the budget.
    var seen = Set<String>()
    for url in urls where seen.insert(url.lastPathComponent).inserted {
      guard seen.count <= 16 else { break }
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
  }
}
