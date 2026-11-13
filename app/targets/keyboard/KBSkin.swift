import Foundation
import CoreGraphics
import CoreText
import UIKit

/// THE SKIN BLOCK — the only thing about a skin the phone ever sees.
///
/// Skins are authored and expanded on the SERVER
/// (`shared/native/skins/*.json` → `experience/keyboard/skin.ts`): what
/// reaches the keyboard is the key tree it already built, with `props.face`
/// and `style.press` on the nodes, plus the one block below. There is no skin
/// resolver and no precedence chain here. This block is three things and
/// nothing else:
///
///   1. the id and sha, for telemetry and the crash guard,
///   2. the budget the view enforces whatever the tree asks for,
///   3. the manifest: every art file and font, fetched in ONE batch when the
///      config arrives, never during a session.
///
/// It is read straight off the config JSON rather than added to `KBConfig`,
/// so a malformed `skin` can never fail the decode of a config that would
/// otherwise draw a keyboard.
struct KBSkin {
  let id: String
  let sha: String
  /// Bytes of images attached to LIVE key views (width x height x 4).
  let decodedKB: Int
  /// Keys that may run a display link. The rest draw their mark at t = 0.
  let animatedKeys: Int
  /// Content-addressed art names, "<sha>@3.png". The renderer draws a face's
  /// art only when its name is in here: a file that was not prefetched would
  /// otherwise mean a fetch mid-session, and a fetch mid-session is a request
  /// that could be tied to a keystroke.
  let art: Set<String>
  let fonts: [(id: String, sha256: String)]

  // MARK: Limits (shared/types/keyboardFace.ts KEY_FACE_LIMITS)

  static let maxFacedKeys = 64
  static let maxArtFiles = 24
  static let maxArtFileBytes = 128 * 1024
  static let maxArtEdgePx = 160
  static let defaultLiveImageBytes = 6 * 1024 * 1024
  static let maxAnimatedKeys = 3
  static let maxFontFileBytes = 300 * 1024
  static let maxFontsPerConfig = 2
  static let maxPressMs: Double = 400

  /// The budget in bytes, the server's number clamped to ours.
  var liveImageBytes: Int {
    let asked = decodedKB * 1024
    return asked > 0 ? min(asked, KBSkin.defaultLiveImageBytes) : KBSkin.defaultLiveImageBytes
  }
  var animatedKeyCap: Int { max(0, min(animatedKeys, KBSkin.maxAnimatedKeys)) }

  // MARK: The one live skin

  /// The skin the current config carries, or nil for an unskinned config —
  /// which is every config today, and every config a launch-dark server
  /// sends.
  private(set) static var current: KBSkin?

  /// PLAIN MODE. After the crash guard has struck twice on a skinned config,
  /// that sha draws with `face`, `press`, `fontFamily` and art ignored: the
  /// tree and the colours stay, because those are today's features and they
  /// have never taken the keyboard down. Set by the host controller, which
  /// owns the guard.
  static var plainMode = false

  /// The skin id the guard has condemned, sent as `X-Tulmi-Keyboard-Bad` so
  /// the server answers with the unskinned tree. Lives in the extension's own
  /// defaults, beside the rest of the guard's marks.
  static let badSkinKey = "tulmi_kb_skin_bad"
  /// When the mark was set. Nothing used to clear the mark, so a skin fixed
  /// under the same id was never served to this device again. The mark now
  /// lets go after `badSkinTTL`; if the skin is still broken the guard puts
  /// it back after two more deaths, which costs one session, once a month.
  static let badSkinAtKey = "tulmi_kb_skin_bad_at"
  static let badSkinTTL: TimeInterval = 30 * 24 * 3600

  static var badSkinId: String? {
    let d = UserDefaults.standard
    guard let v = d.string(forKey: badSkinKey), !v.isEmpty else { return nil }
    let at = d.double(forKey: badSkinAtKey)
    // No stamp means a mark written by an older build: stamp it now so it
    // ages from here rather than never.
    if at <= 0 { d.set(Date().timeIntervalSince1970, forKey: badSkinAtKey); return v }
    if Date().timeIntervalSince1970 - at > badSkinTTL { clearBadSkin(); return nil }
    return v
  }

  /// Mark a skin id bad, with the moment it happened.
  static func markBadSkin(_ id: String) {
    let d = UserDefaults.standard
    d.set(id, forKey: badSkinKey)
    d.set(Date().timeIntervalSince1970, forKey: badSkinAtKey)
  }

  static func clearBadSkin() {
    let d = UserDefaults.standard
    d.removeObject(forKey: badSkinKey)
    d.removeObject(forKey: badSkinAtKey)
  }

  /// Read the skin block off a config and make it the live one: register its
  /// fonts and fetch every file in its manifest, in one batch, right now.
  /// Nothing else in the keyboard ever starts a fetch for a face.
  @discardableResult
  static func adopt(configJSON data: Data, plain: Bool) -> KBSkin? {
    plainMode = plain
    guard let skin = parse(data) else {
      current = nil
      TulmiImageLoader.setFaceManifest([])
      // No skin draws from here. Said on the main thread, while it is true:
      // the telemetry window is tagged here, not read off `current` half an
      // hour later in a URLSession completion.
      KeyboardTelemetry.noteSkin(nil)
      return nil
    }
    current = skin
    TulmiImageLoader.setFaceManifest(skin.art)
    // Plain mode draws no art and no hooked font, so it fetches none either.
    guard !plain else {
      KeyboardTelemetry.bump(.skinPlainSessions)
      // Plain mode is not this skin's look, so its frames are not this
      // skin's either: the window carries no tag.
      KeyboardTelemetry.noteSkin(nil)
      return skin
    }
    KeyboardTelemetry.noteSkin(skin.id)
    TulmiImageLoader.prefetchFaceArt(Array(skin.art))
    TulmiImageLoader.prefetchFonts(skin.fonts)
    // Register whatever the cache already holds. A font seen for the first
    // time lands during this batch and registers on the next keyboard open —
    // until then the face falls to the next font, then sans, which is what
    // an unregisterable font does anyway.
    KBFonts.registerHooked(skin.fonts)
    // Drop the memo. A family asked for before its file was registered was
    // answered with the system face and that answer was cached for the life
    // of the process — so a font that landed in the batch above only ever
    // took effect after the extension died.
    KBFonts.forget()
    return skin
  }

  /// Lenient by hand: anything missing or of the wrong shape simply means no
  /// skin, which is today's keyboard.
  static func parse(_ data: Data) -> KBSkin? {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let o = root["skin"] as? [String: Any],
          let id = o["id"] as? String, !id.isEmpty else { return nil }
    let budget = o["budget"] as? [String: Any]
    let manifest = o["manifest"] as? [String: Any]
    // Content-addressed names only, and exactly one shape:
    // <sha256>@<1|2|3>.png. A slash, a scheme or a traversal is somebody
    // trying to leave our host, and none of them survives this pattern. It
    // is the pattern the server checks at publish and the one Android's
    // `KbSkin` parse uses, so the two keyboards refuse the same spellings.
    var art = Set<String>()
    for case let name as String in (manifest?["art"] as? [Any] ?? []) {
      let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard TulmiImageLoader.isArtName(n) else { continue }
      if art.count >= maxArtFiles { break }
      art.insert(n)
    }
    var fonts: [(id: String, sha256: String)] = []
    for case let f as [String: Any] in (manifest?["fonts"] as? [Any] ?? []) {
      guard let fid = f["id"] as? String, let shaRaw = f["sha256"] as? String else { continue }
      let id = fid.trimmingCharacters(in: .whitespacesAndNewlines)
      // Lower case, 64 hex, and nothing else: the file is named by this.
      let sha = shaRaw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      guard !id.isEmpty, TulmiImageLoader.isSha256(sha) else { continue }
      if fonts.count >= maxFontsPerConfig { break }
      fonts.append((id: id, sha256: sha))
    }
    // A budget with no `animatedKeys` is not a budget of zero animated keys:
    // it is a skin that did not say, and our own cap stands.
    var decodedKB = 0
    var animatedKeys = maxAnimatedKeys
    if let b = budget {
      if let v = b["decodedKB"] { decodedKB = intOf(v) }
      if let v = b["animatedKeys"] { animatedKeys = intOf(v) }
    }
    return KBSkin(
      id: id,
      sha: (o["sha"] as? String) ?? "",
      decodedKB: decodedKB,
      animatedKeys: animatedKeys,
      art: art,
      fonts: fonts)
  }

  private static func intOf(_ v: Any) -> Int {
    if let n = v as? NSNumber, n.doubleValue.isFinite { return max(0, min(1 << 20, n.intValue)) }
    return 0
  }
}

/// WHAT ONE CONFIG MAY SPEND, counted across the key tree as it is built.
///
/// Thirty animated keys is a different class of cost from one mic key, and a
/// keyboard extension is killed outright somewhere past 48 MB. So the view
/// enforces these whatever the tree asks for: the counters reset at the top
/// of every rebuild, each face asks before it spends, and a key that is
/// refused keeps its plain title — which is a key that still types.
enum KBFaceBudget {
  private(set) static var facedKeys = 0
  private(set) static var animatedKeys = 0
  private(set) static var liveImageBytes = 0

  /// Called at the top of every tree rebuild: the old views are about to go,
  /// so what they were spending goes with them.
  static func beginPass() {
    facedKeys = 0
    animatedKeys = 0
    liveImageBytes = 0
  }

  /// One more faced key, or false and a plain title.
  static func takeFacedKey() -> Bool {
    guard facedKeys < KBSkin.maxFacedKeys else { return false }
    facedKeys += 1
    return true
  }

  /// One more key that may run a display link, or false and a mark drawn at
  /// t = 0 that never starts one.
  static func takeAnimatedKey() -> Bool {
    let cap = KBSkin.current?.animatedKeyCap ?? KBSkin.maxAnimatedKeys
    guard animatedKeys < cap else { return false }
    animatedKeys += 1
    return true
  }

  /// Bytes for an image about to be attached to a live key view, counted as
  /// width x height x 4. False means the flat colour for that key.
  static func takeImage(px: CGSize) -> Bool {
    let cost = Int(max(1, px.width) * max(1, px.height) * 4)
    let cap = KBSkin.current?.liveImageBytes ?? KBSkin.defaultLiveImageBytes
    guard liveImageBytes + cost <= cap else { return false }
    liveImageBytes += cost
    return true
  }
}

/// FONTS, REGISTERED AT RUNTIME.
///
/// An app extension can register a font file with
/// `CTFontManagerRegisterFontsForURL(url, .process, …)`, which works for the
/// files bundled in this target AND for files the keyboard fetched into
/// `keyboard-media/`. So no `UIAppFonts` entry is needed and a hooked font
/// needs no store build.
///
/// A font that will not register means the next font the face asked for, and
/// then the system face. A key always has a legend.
enum KBFonts {
  /// Type tokens format 1 promises in every target, mapped to the exact
  /// POSTSCRIPT names of the four files IOS-WIDGETS subsets and every target
  /// copies byte for byte. PostScript names, not families: the files carry
  /// families like "Tailzu Bricolage SemiBold" and "Geist SemiBold", so a
  /// family lookup for "Bricolage Grotesque" finds nothing, logs nothing,
  /// and silently draws the system face on every key. A token with no file
  /// registered falls back to the system face, which is what a build with no
  /// fonts bundled draws.
  ///
  /// `brand` is the one token with two files: semibold at weight 600 and up,
  /// medium below it.
  private static func postScriptName(_ token: String, weight: UIFont.Weight) -> String? {
    switch token {
    case "brand":   return weight.rawValue >= UIFont.Weight.semibold.rawValue ? "Geist-SemiBold" : "Geist-Medium"
    case "display": return "TailzuBricolageSemiBold"
    case "dots":    return "Doto-Regular"
    default:        return nil
    }
  }

  private static var registeredFiles = Set<String>()
  private static var resolved: [String: UIFont] = [:]

  private static var bundledDone = false

  /// Register every font file bundled in this extension. Called once, before
  /// the first tree is built. Cheap: a handful of URLs and no decode.
  static func registerBundled() {
    guard !bundledDone else { return }
    bundledDone = true
    for ext in ["ttf", "otf"] {
      for url in Bundle.main.urls(forResourcesWithExtension: ext, subdirectory: nil) ?? [] {
        register(url)
      }
      for url in Bundle.main.urls(forResourcesWithExtension: ext, subdirectory: "Fonts") ?? [] {
        register(url)
      }
    }
  }

  /// Register the hooked fonts of a skin's manifest, from the cache the
  /// prefetch filled. Nothing is fetched here.
  static func registerHooked(_ fonts: [(id: String, sha256: String)]) {
    for f in fonts.prefix(KBSkin.maxFontsPerConfig) {
      guard let url = TulmiImageLoader.cachedFontFile(sha256: f.sha256) else { continue }
      register(url)
    }
  }

  private static func register(_ url: URL) {
    guard !registeredFiles.contains(url.path) else { return }
    registeredFiles.insert(url.path)
    // A file over the cap is not registered: a 4 MB face in a 48 MB process
    // is a crash waiting for a long word.
    if let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber,
       size.intValue > KBSkin.maxFontFileBytes {
      return
    }
    var err: Unmanaged<CFError>?
    // Already registered by another session of the same process is not an
    // error worth a log: the call simply fails and the family is there.
    _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &err)
  }

  /// A face's font: a type token, a hooked font id, or a family name — at
  /// `size` and `weight`, falling back to the system face at the same size.
  static func font(_ family: String?, size: CGFloat, weight: UIFont.Weight) -> UIFont {
    let fallback = UIFont.systemFont(ofSize: size, weight: weight)
    guard let family = family, !family.isEmpty else { return fallback }
    if family == "sans" { return fallback }
    if family == "mono" { return UIFont.monospacedSystemFont(ofSize: size, weight: weight) }
    let key = "\(family)|\(size)|\(weight.rawValue)"
    if let hit = resolved[key] { return hit }
    let out: UIFont
    if let ps = postScriptName(family, weight: weight) {
      // A TOKEN: one exact file, asked for by its PostScript name. If that
      // file was not bundled or did not register, the system face at the
      // same size and weight — never another face that happens to share a
      // family name.
      out = UIFont(name: ps, size: size) ?? fallback
    } else if !UIFont.fontNames(forFamilyName: family).isEmpty {
      // A HOOKED FONT or a plain family name. UIFont(name:) wants a
      // PostScript name; a family reaches its faces through a descriptor,
      // which is the shape a server-sent id arrives in. The registered check
      // comes first because UIFont(descriptor:) would otherwise hand back
      // the system face under the wrong name and the memo would cache it.
      out = UIFont(descriptor: UIFontDescriptor(fontAttributes: [
        .family: family,
        .traits: [UIFontDescriptor.TraitKey.weight: weight],
      ]), size: size)
    } else if let direct = UIFont(name: family, size: size) {
      out = direct
    } else {
      out = fallback
    }
    resolved[key] = out
    return out
  }

  /// Drop the memoized fonts (a config swap, or a memory warning).
  static func forget() { resolved.removeAll(keepingCapacity: false) }
}
