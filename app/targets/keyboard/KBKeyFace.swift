import UIKit

/// WHAT A KEY PRINTS.
///
/// Today a `LetterKey` sets a title and nothing else, and the drawn `mark` is
/// read only inside the mic key. This file is the face layer: a legend, a
/// second legend, a corner glyph, an icon, art, or a drawn mark with the
/// motion language that already ships — behind the key's title, or instead of
/// it — on ANY key.
///
/// THE FIRST LAW: a key never changes what it does. A face is paint. It
/// carries no actions, no endpoints, no layout, and it never reads text. The
/// key keeps `insertKey`, shift casing, the accent tray and the fast in-place
/// re-title, because none of those go through here (App Review 4.4.1).
///
/// ONE LEGEND PER KEY. The six rules, the same in all three renderers:
///   1. With no `face.label`, the legend IS the key's own title. The face
///      restyles it (`font`, `size`, `weight`, `color`) and it follows shift
///      and caps for free, because the fast-shift path re-titles the button
///      and the face never touches it.
///   2. A `label` that is only the key's own character, in either case
///      (`label: "a"` on an `a` key), counts as NO label, so rule 1 applies
///      and the key still cases. That is what an author means by writing it.
///   3. Any other `label` is a fixed print. It takes the title's place under
///      EITHER layer — the title's text stays, so the fast re-title and the
///      accent tray still work, and only its colour goes clear — because two
///      legends on one cap is never what was meant. It does not case.
///   4. `layer` governs the PICTURES: `icon` in all four forms, `art` and
///      `mark`. `behind` (the default) draws them under the visible legend;
///      `instead` hides the key's title, so only the face draws.
///   5. An emoji is an icon. It draws in the icon slot and follows `layer`
///      like `sf:` and `asset:`; under `behind` it does NOT stand the title
///      down. An author who wants the emoji alone writes `layer: "instead"`.
///   6. `sub` sits at `subPos` and `corner` takes the OPPOSITE corner, so
///      the two can never land on top of each other.
enum KBKeyFace {

  /// Keys a skin may never carry. If a face names one, the whole face is
  /// dropped and the key draws as it always did. The server strips these
  /// before anything reaches a phone; the renderer refuses them again,
  /// because a renderer that trusts the server is a renderer that ships a
  /// 4.4.1 problem the day the server has a bug.
  static let forbidden = ["on", "actions", "action", "callEndpoint", "bind", "visibleIf", "rows", "layouts"]

  // MARK: The hook

  /// Called once per node, from the renderer's `render(node:)`, right after
  /// the node's style. Everything a skin adds to a key happens here:
  /// `style.press`, `style.fontFamily` and `props.face`.
  ///
  /// In plain mode — after the crash guard has struck twice on a skinned
  /// config — this does nothing at all, which leaves today's keyboard.
  static func apply(node: KBNode, to view: UIView, tint: UIColor) {
    // Plain mode is the whole of this file switched off for one config sha.
    // Every key view is built fresh on each rebuild, so there is nothing to
    // undo: not attaching is enough.
    guard !KBSkin.plainMode else { return }
    if let press = KBPress.parse(node.style) { KBPress.attach(press, to: view) }
    applyFontFamily(node: node, to: view)
    guard let raw = node.props?["face"]?.asObject else { return }
    // A face that named something a skin may never carry, or that prints
    // nothing at all, is counted and dropped. The key draws as it always did.
    guard let spec = KBFaceSpec(raw, tint: tint, char: node.props?["char"]?.asString) else {
      KeyboardTelemetry.bump(.faceDropped)
      return
    }
    guard KBFaceBudget.takeFacedKey() else {
      KeyboardTelemetry.bump(.faceDropped)
      return
    }
    draw(spec, on: view)
    KeyboardTelemetry.bump(.facePainted)
  }

  /// `style.fontFamily`: a type token or a hooked font id, kept at whatever
  /// size and weight the node's style already asked for.
  private static func applyFontFamily(node: KBNode, to view: UIView) {
    guard let family = node.style?["fontFamily"]?.asString, !family.isEmpty else { return }
    // style.fontWeight is a name ("semibold") today and may be a number in a
    // face's terms; asDouble answers nil for a name, so one key serves both.
    let weight = KBFaceSpec.weight(node.style?["fontWeight"]?.asString,
                                   number: node.style?["fontWeight"]?.asDouble)
    if let btn = view as? UIButton, let label = btn.titleLabel {
      let size = node.style?["fontSize"]?.asCGFloat ?? label.font?.pointSize ?? 18
      label.font = KBFonts.font(family, size: size, weight: weight)
    } else if let label = view as? UILabel {
      let size = node.style?["fontSize"]?.asCGFloat ?? label.font?.pointSize ?? 18
      label.font = KBFonts.font(family, size: size, weight: weight)
    }
  }

  // MARK: Did a face stand this key's own title down?

  private static var titleStoodDownKey: UInt8 = 0

  /// Marked on a button whose own title a face has cleared — it keeps its
  /// TEXT (the fast re-title and the accent tray read it) and loses only its
  /// ink. Anything that sets a title colour afterwards must ask first.
  static func markTitleStoodDown(_ btn: UIButton) {
    objc_setAssociatedObject(btn, &titleStoodDownKey, true, .OBJC_ASSOCIATION_RETAIN)
  }

  /// True when a face on this key prints its own legend, so the key's title
  /// must stay invisible.
  static func titleIsStoodDown(_ view: UIView) -> Bool {
    guard let btn = view as? UIButton else { return false }
    return (objc_getAssociatedObject(btn, &titleStoodDownKey) as? Bool) == true
  }

  private static func draw(_ spec: KBFaceSpec, on view: UIView) {
    let btn = view as? UIButton
    // The key's own glyph: kept, restyled, or stood down for the face's.
    if let btn = btn {
      if spec.instead || spec.drawsOwnLegend {
        // The TEXT stays — the fast re-title and the accent tray read it —
        // and only its ink goes. A cleared title would break both.
        btn.setTitleColor(.clear, for: .normal)
        btn.setTitleColor(.clear, for: .highlighted)
        // Say so, so whatever runs after this does not paint the ink back.
        // The return key's action accent did exactly that: the key then
        // showed the face's legend AND its own title under it, and the
        // title flickered away on press (.highlighted stayed clear).
        KBKeyFace.markTitleStoodDown(btn)
      } else {
        if let c = spec.color { btn.setTitleColor(c, for: .normal) }
        if let label = btn.titleLabel {
          let size = spec.size ?? label.font?.pointSize ?? 18
          label.font = KBFonts.font(spec.font, size: size, weight: spec.weight)
        }
      }
    }
    let face = KBFaceView(spec: spec)
    face.isUserInteractionEnabled = false
    face.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(face)
    NSLayoutConstraint.activate([
      face.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      face.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      face.topAnchor.constraint(equalTo: view.topAnchor),
      face.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    // Behind the title, above whatever backdrop the theme or the node's
    // effect put at the bottom of the stack.
    if !spec.instead, let title = btn?.titleLabel { view.bringSubviewToFront(title) }
  }
}

/// One face, read off a node and clamped. Everything optional, because every
/// part of a face is optional and a key with none of it is today's key.
struct KBFaceSpec {
  let label: String?
  let sub: String?
  let subPos: String
  let corner: String?
  /// `sf:` / `asset:` / an emoji only. An icon's `url` is not read: the
  /// server refuses that form at publish, and a picture reaches a key only
  /// through `art` — a manifest name, prefetched into the cache, never a
  /// fetch from here.
  let sfSymbol: String?
  let assetName: String?
  let emoji: String?
  let art: String?
  let mark: [String: KBJSON]?
  let program: [String: KBJSON]?
  let instead: Bool
  let inset: CGFloat
  let font: String?
  let size: CGFloat?
  let weight: UIFont.Weight
  let color: UIColor?
  let opacity: CGFloat
  let tint: UIColor

  /// `char` is the key's own character, from `props.char`. A `label` that is
  /// only that character, in either case, counts as NO label: the key keeps
  /// its own title, so it still follows shift and caps. That is rule 2 of
  /// "one legend per key", and three renderers apply it the same way.
  init?(_ o: [String: KBJSON], tint: UIColor, char: String?) {
    // THE FIRST LAW, checked here and not only on the server.
    for key in KBKeyFace.forbidden where o[key] != nil { return nil }
    self.tint = tint
    let written = KBFaceSpec.text(o["label"])
    if let w = written, let c = char, !c.isEmpty, w.lowercased() == c.lowercased() {
      label = nil
    } else {
      label = written
    }
    sub = KBFaceSpec.text(o["sub"])
    let pos = (o["subPos"]?.asString ?? "top-right").lowercased()
    subPos = ["top-right", "top-left", "bottom-right", "bottom-left"].contains(pos) ? pos : "top-right"
    corner = KBFaceSpec.text(o["corner"])

    // The icon, in the shape the config has always used.
    var sf: String?, asset: String?, emo: String?
    if let io = o["icon"]?.asObject {
      sf = io["sf"]?.asString
      asset = io["asset"]?.asString
      emo = io["emoji"]?.asString
    } else if let s = o["icon"]?.asString {
      if s.hasPrefix("sf:") { sf = String(s.dropFirst(3)) }
      else if s.hasPrefix("asset:") { asset = String(s.dropFirst(6)) }
      else if !s.isEmpty, !s.hasPrefix("http") { emo = s }
    }
    sfSymbol = (sf?.isEmpty == false) ? sf : nil
    assetName = (asset?.isEmpty == false) ? asset : nil
    emoji = (emo?.isEmpty == false) ? emo : nil

    // Art: the BARE manifest name, "<sha256>@3.png". No host ever travels in
    // a config — the phone puts its own compiled host in front of it. Any
    // other form (a URL, a path, a "url:" prefix) fails the name check where
    // it is read and draws nothing. The manifest is checked there too, so a
    // face that names art we never prefetched simply draws the flat colour
    // for this session.
    // Animated raster is refused outright in format 1: thirty animated keys
    // is a different class of cost from one mic key.
    var artName: String?
    if let a = o["art"]?.asString, !a.isEmpty, (o["artKind"]?.asString ?? "png").lowercased() == "png" {
      artName = a
    }
    art = artName

    mark = o["mark"]?.asObject
    // THE PROGRAM, unchanged from the mic key: numbers only, no I/O, bounded
    // repeats, unknown means 0. There is NO press position in its context —
    // a key position is a letter — so a program that asks for one is refused
    // and its mark draws still.
    if let p = o["program"]?.asObject, !KBFaceSpec.asksForPress(p) {
      program = p
    } else {
      program = nil
    }

    instead = (o["layer"]?.asString ?? "behind").lowercased() == "instead"
    inset = min(24, max(0, o["inset"]?.asCGFloat ?? 0))
    let f = o["font"]?.asString
    font = (f?.isEmpty == false) ? f : nil
    if let s = o["size"]?.asCGFloat, s > 0 { size = min(80, s) } else { size = nil }
    weight = KBFaceSpec.weight(nil, number: o["weight"]?.asDouble)
    color = o["color"]?.asString.map { UIColor(tulmiHex: $0) }
    opacity = min(1, max(0, o["opacity"]?.asCGFloat ?? 1))

    // A face that prints nothing is not a face. A `label` the author wrote
    // counts even when rule 2 dropped it: that face still restyles the key's
    // own title, which is the whole point of writing `label: "a"` on an
    // `a` key.
    if written == nil, sub == nil, corner == nil, sfSymbol == nil, assetName == nil,
       emoji == nil, art == nil, mark == nil {
      return nil
    }
  }

  /// True when the face prints a legend of its own, so the key's own title
  /// glyph stands down (its TEXT stays, for the fast re-title and the accent
  /// tray; only its ink goes clear). With no label the title IS the legend,
  /// restyled by the face, and it follows shift and caps for free.
  ///
  /// An emoji does NOT count. An emoji is an icon — one of the four forms of
  /// `icon` in the contract — so it follows `layer` like `sf:` and `asset:`
  /// and draws UNDER the key's own legend. An author who wants the emoji
  /// alone writes `layer: "instead"`. A special case for one form of icon
  /// would have to be a special case in all three renderers.
  var drawsOwnLegend: Bool { label != nil }

  private static func text(_ j: KBJSON?) -> String? {
    guard let s = j?.asString, !s.isEmpty else { return nil }
    // A legend is a glyph or two, never a sentence.
    return String(s.prefix(8))
  }

  /// Does this program reach for the press point anywhere in its text? The
  /// motion language would answer 0 for a name it does not know, so this is
  /// belt and braces — but it is the one thing a skin could ask that would
  /// tell it something about typing, so it is refused by name as well.
  private static func asksForPress(_ p: [String: KBJSON]) -> Bool {
    for (key, value) in p {
      if mentionsPress(key) || mentionsPress(value) { return true }
    }
    return false
  }

  private static func mentionsPress(_ s: String) -> Bool {
    s.contains("press.x") || s.contains("press.y") || s.contains("since.press")
  }

  private static func mentionsPress(_ j: KBJSON) -> Bool {
    switch j {
    case .string(let s): return mentionsPress(s)
    case .array(let a): return a.contains { mentionsPress($0) }
    case .object(let o): return asksForPress(o)
    default: return false
    }
  }

  /// A weight name, or the 100…900 number a face carries.
  static func weight(_ name: String?, number: Double?) -> UIFont.Weight {
    if let n = number, n.isFinite {
      switch n {
      case ..<150: return .ultraLight
      case ..<250: return .thin
      case ..<350: return .light
      case ..<450: return .regular
      case ..<550: return .medium
      case ..<650: return .semibold
      case ..<750: return .bold
      case ..<850: return .heavy
      default: return .black
      }
    }
    switch (name ?? "").lowercased() {
    case "ultralight": return .ultraLight
    case "thin":       return .thin
    case "light":      return .light
    case "medium":     return .medium
    case "semibold":   return .semibold
    case "bold":       return .bold
    case "heavy":      return .heavy
    case "black":      return .black
    default:           return .regular
    }
  }
}

/// The face, drawn. One view over the key, laid out by hand: a key tree is
/// rebuilt on every shift, every layer switch and every appearance change, so
/// a face pays for itself in frames, not in constraints.
final class KBFaceView: UIView {
  private let spec: KBFaceSpec
  private var legend: UILabel?
  private var subLabel: UILabel?
  private var cornerLabel: UILabel?
  private var iconView: UIImageView?
  /// An emoji is an icon drawn as text: same slot, same size, same `layer`.
  private var iconLabel: UILabel?
  private var artView: UIImageView?
  private var markView: TulmiMarkView?
  /// The pixel edge the art was last decoded at, so a resize decodes once.
  private var artPx: CGFloat = 0
  private var artRefused = false

  init(spec: KBFaceSpec) {
    self.spec = spec
    super.init(frame: .zero)
    backgroundColor = .clear
    isOpaque = false
    alpha = spec.opacity
    build()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("not used") }

  private func build() {
    let ink = spec.color ?? spec.tint

    // Art sits at the bottom of the face, and is decoded in layoutSubviews
    // at the key's own size — never at kb.images.maxEdgePx, which is in
    // POINTS and would mean 768 px on a 3x phone for one key cap.
    if spec.art != nil {
      let iv = UIImageView()
      iv.contentMode = .scaleAspectFit
      addSubview(iv)
      artView = iv
    }

    // The mark: the same drawer the mic key uses, so there is one engine for
    // vector prints and one place where Reduce Motion, the frame cap and a
    // bad program already turn into a still picture.
    if let m = spec.mark {
      // Only the first few keys of a config may run a display link; the rest
      // draw their mark at t = 0 and never start one.
      let animated = spec.program != nil && KBFaceBudget.takeAnimatedKey()
      if let mv = TulmiMarkView(spec: m, motion: nil, program: animated ? spec.program : nil, tint: ink) {
        addSubview(mv)
        markView = mv
      }
    }

    // THE ICON SLOT, in all four of its forms. An emoji is an icon: it draws
    // here, centred and icon-sized, not as the legend — so under the default
    // `layer: "behind"` the key's own letter still reads over it.
    if let sf = spec.sfSymbol, let img = UIImage(systemName: sf) {
      iconView = addIcon(img.withRenderingMode(.alwaysTemplate), tint: ink)
    } else if let asset = spec.assetName,
              let img = UIImage(named: asset, in: Bundle.main, compatibleWith: nil) {
      iconView = addIcon(img.withRenderingMode(.alwaysTemplate), tint: ink)
    } else if let emoji = spec.emoji {
      let l = UILabel()
      l.text = emoji
      l.textAlignment = .center
      l.adjustsFontSizeToFitWidth = true
      l.minimumScaleFactor = 0.5
      addSubview(l)
      iconLabel = l
    }

    if let text = spec.label {
      legend = addLabel(text, size: spec.size ?? 18, weight: spec.weight, ink: ink)
    }
    if let text = spec.sub {
      subLabel = addLabel(text, size: (spec.size ?? 18) * 0.52, weight: .regular, ink: ink)
      subLabel?.alpha = 0.75
    }
    if let text = spec.corner {
      cornerLabel = addLabel(text, size: (spec.size ?? 18) * 0.42, weight: .regular, ink: ink)
      cornerLabel?.alpha = 0.6
    }
  }

  private func addIcon(_ img: UIImage, tint: UIColor) -> UIImageView {
    let iv = UIImageView(image: img)
    iv.tintColor = tint
    iv.contentMode = .scaleAspectFit
    addSubview(iv)
    return iv
  }

  private func addLabel(_ text: String, size: CGFloat, weight: UIFont.Weight, ink: UIColor) -> UILabel {
    let l = UILabel()
    l.text = text
    l.textColor = ink
    l.font = KBFonts.font(spec.font, size: size, weight: weight)
    l.textAlignment = .center
    l.adjustsFontSizeToFitWidth = true
    l.minimumScaleFactor = 0.5
    l.baselineAdjustment = .alignCenters
    addSubview(l)
    return l
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let box = bounds.insetBy(dx: spec.inset, dy: spec.inset)
    guard box.width > 1, box.height > 1 else { return }

    artView?.frame = box
    loadArtIfNeeded(in: box)
    markView?.frame = box
    let iconSide = min(spec.size ?? min(box.width, box.height) * 0.6, min(box.width, box.height))
    let iconBox = CGRect(x: box.midX - iconSide / 2, y: box.midY - iconSide / 2,
                         width: iconSide, height: iconSide)
    iconView?.frame = iconBox
    if let l = iconLabel {
      l.frame = iconBox
      // An emoji is drawn by the colour font, so the system face at the icon
      // size is the right one — never the face's `font` token.
      l.font = .systemFont(ofSize: iconSide * 0.86)
    }
    legend?.frame = box

    // The second legend sits in the corner it named; the corner glyph takes
    // the opposite one, so the two can never land on top of each other.
    let small = CGSize(width: min(box.width * 0.5, 18), height: min(box.height * 0.5, 14))
    if let s = subLabel { s.frame = corner(spec.subPos, in: box, size: small) }
    if let c = cornerLabel { c.frame = corner(opposite(spec.subPos), in: box, size: small) }
  }

  private func corner(_ pos: String, in box: CGRect, size: CGSize) -> CGRect {
    let x = pos.hasSuffix("right") ? box.maxX - size.width : box.minX
    let y = pos.hasPrefix("top") ? box.minY : box.maxY - size.height
    return CGRect(x: x, y: y, width: size.width, height: size.height)
  }

  private func opposite(_ pos: String) -> String {
    switch pos {
    case "top-right":    return "bottom-left"
    case "top-left":     return "bottom-right"
    case "bottom-right": return "top-left"
    default:             return "top-right"
    }
  }

  /// Decode the art at THIS key's size, once per size, and only if the live
  /// image budget has room. No budget means the flat colour for that key,
  /// which is a key that still types.
  private func loadArtIfNeeded(in box: CGRect) {
    guard let name = spec.art, let iv = artView, !artRefused else { return }
    let scale = max(1, traitCollection.displayScale)
    let edge = min(CGFloat(KBSkin.maxArtEdgePx), max(box.width, box.height) * scale)
    guard edge > 1, abs(edge - artPx) > 0.5 else { return }
    artPx = edge
    guard let img = TulmiImageLoader.faceArt(name, maxEdgePx: Int(edge.rounded())) else {
      artRefused = true          // not on the host, not in the manifest, or animated
      iv.image = nil
      KeyboardTelemetry.bump(.faceDropped)
      return
    }
    guard KBFaceBudget.takeImage(px: CGSize(width: img.size.width * img.scale,
                                            height: img.size.height * img.scale)) else {
      artRefused = true
      iv.image = nil
      KeyboardTelemetry.bump(.faceDropped)
      return
    }
    iv.image = img
  }
}
