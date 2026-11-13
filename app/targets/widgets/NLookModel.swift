import CoreGraphics
import Foundation

// NLOOK FORMAT 1: THE TREE, AS THIS BINARY READS IT (the contract is the backend's shared/types/nlook.ts).
//
// A design is DATA, never code: a closed vocabulary of node types, style keys, colour and type tokens, bind paths, condition
// keys and transition names, all compiled in here. There are no expressions. Every action a design can name already exists in
// the binary (AnswerNeedIntent, AnswerBotsActivityIntent, vetted links).
//
// Three rules this file keeps, so nothing above it has to:
//   1. Unknown degrades, never throws. An unknown node keeps its `fallback`; an unknown style key is dropped; a bad number is
//      simply absent. Nothing here can fail: `parse` always returns a node, or nil for "draw nothing here".
//   2. Clamped again. The server cleaned on publish and the app cleaned before writing; this reads a file, so it counts nodes
//      and depth itself and stops. A design over its budget loses the rest of its tree, never the widget.
//   3. No recursion without a floor. Depth is capped at 10 and the node budget is spent as the tree is read, so a design that
//      nests a thousand deep costs ten frames and stops.
//
// The reading is lenient the way X0Glance is lenient: JSONSerialization and typed accessors, no Codable, because a mistyped
// field must cost that field and nothing else.

/// The design format this build draws. A design whose `format` is higher is skipped ALONE; the rest of the catalog stays.
let nlookFormat = 1

/// The caps, mirroring NLOOK_LIMITS in the contract. Passing one drops the node, never the widget.
enum NLookLimits {
  static let depth = 10
  static let widgetNodes = 150
  static let widgetNodesPerRoot = 80
  static let eachMax = 8
  static let activityEachMax = 3
  static let textChars = 200
  static let dChars = 900
  static let pathsPerShape = 12
  static let varsKeys = 12
  static let varsKeyChars = 24
  static let varsValueChars = 120
  /// Apple's cap is 4 KB; the server, parse() and the JS activity plan all stop here.
  static let activityBodyBytes = 3584
  /// Decoded art for one version of the catalog. The widget extension has about 30 MB in all.
  static let decodedBytes = 12 * 1024 * 1024
  /// What decoded art may HOLD at once. Well under the budget above, because a warm extension keeps this between renders
  /// and the views themselves need the rest of the 30 MB; the cache is emptied under memory pressure anyway.
  static let artCacheBytes = 6 * 1024 * 1024
  /// One art key can be used in the island and the banner alike, so each region caps its own decode.
  static func regionMaxPx(_ root: String) -> CGFloat {
    root.hasPrefix("island.") || root.hasPrefix("compact.") || root == "minimal" ? 135 : 252
  }

  /// How many nodes one activity region may hold.
  static func activityNodes(_ root: String) -> Int {
    if root == "lock" { return 50 }
    if root == "minimal" { return 3 }
    if root.hasPrefix("island.") { return 20 }
    if root.hasPrefix("compact.") { return 6 }
    return 3
  }
}

/// Lenient reads out of a node's `props`. An absent or mistyped key reads as nothing.
struct NLookProps {
  let raw: [String: Any]

  init(_ raw: [String: Any]) { self.raw = raw }

  func str(_ k: String) -> String { (raw[k] as? String) ?? "" }

  /// A non-empty string, or nil.
  func text(_ k: String) -> String? {
    guard let s = raw[k] as? String, !s.isEmpty else { return nil }
    return s
  }

  func num(_ k: String) -> Double? {
    guard let n = raw[k] as? NSNumber else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  func cg(_ k: String) -> CGFloat? {
    guard let d = num(k), abs(d) < 10_000 else { return nil }
    return CGFloat(d)
  }

  func int(_ k: String, _ fallback: Int = 0) -> Int {
    guard let d = num(k), abs(d) < 1e6 else { return fallback }
    return Int(d.rounded())
  }

  func bool(_ k: String) -> Bool? { raw[k] as? Bool }

  func obj(_ k: String) -> [String: Any] { (raw[k] as? [String: Any]) ?? [:] }

  func list(_ k: String) -> [Any] { (raw[k] as? [Any]) ?? [] }
}

/// A width or a height: points, the whole space, or just what fits.
enum NLookSize {
  case points(CGFloat)
  case fill
  case fit

  /// The points this size names, or nil for "fill" and "fit", which are frames rather than numbers.
  var points: CGFloat? {
    if case .points(let v) = self { return v }
    return nil
  }

  static func read(_ v: Any?) -> NLookSize? {
    if let s = v as? String {
      if s == "fill" { return .fill }
      if s == "fit" { return .fit }
      return nil
    }
    guard let n = v as? NSNumber, n.doubleValue.isFinite, abs(n.doubleValue) < 10_000 else { return nil }
    return .points(CGFloat(n.doubleValue))
  }
}

/// ACROSS the stack, never along it (the contract's NLookAlign; nlook has no `justify`). Anything else means `start`.
enum NLookAlign: String {
  case start, center, end

  static func read(_ v: Any?) -> NLookAlign? {
    guard let s = v as? String else { return nil }
    return NLookAlign(rawValue: s)
  }
}

/// The style keys format 1 promises. An unknown key never reaches here: it is simply not read.
struct NLookStyleSpec {
  var pad: (top: CGFloat, right: CGFloat, bottom: CGFloat, left: CGFloat) = (0, 0, 0, 0)
  var hasPad = false
  var w: NLookSize?
  var h: NLookSize?
  var maxW: CGFloat?
  var maxH: CGFloat?
  var bg: String?
  var corner: CGFloat?
  var borderColor: String?
  var borderWidth: CGFloat = 0
  var opacity: Double?
  var align: NLookAlign?
  var offset: CGSize?
  /// iOS 18 tinted Home Screens: full | desat | tint.
  var accent: String?
  /// Words that may be private: redacted on a locked phone, and swapped for the lock-safe fill on lock and accessory roots.
  var sensitive = false

  static let none = NLookStyleSpec()

  static func read(_ any: Any?) -> NLookStyleSpec {
    guard let o = any as? [String: Any] else { return .none }
    let p = NLookProps(o)
    var s = NLookStyleSpec()
    if let one = p.cg("pad") {
      s.pad = (one, one, one, one)
      s.hasPad = true
    } else if let four = o["pad"] as? [Any], four.count == 4 {
      let n = four.map { v -> CGFloat in
        guard let x = v as? NSNumber, x.doubleValue.isFinite, abs(x.doubleValue) < 10_000 else { return 0 }
        return CGFloat(x.doubleValue)
      }
      s.pad = (n[0], n[1], n[2], n[3])
      s.hasPad = true
    }
    s.w = NLookSize.read(o["w"])
    s.h = NLookSize.read(o["h"])
    s.maxW = p.cg("maxW")
    s.maxH = p.cg("maxH")
    s.bg = p.text("bg")
    s.corner = p.cg("corner")
    let border = p.obj("border")
    if let c = (border["color"] as? String), !c.isEmpty {
      s.borderColor = c
      s.borderWidth = max(0, min(8, NLookProps(border).cg("width") ?? 1))
    }
    if let o2 = p.num("opacity"), o2 >= 0, o2 <= 1 { s.opacity = o2 }
    s.align = NLookAlign.read(o["align"])
    if let pair = o["offset"] as? [Any], pair.count == 2,
       let x = pair[0] as? NSNumber, let y = pair[1] as? NSNumber,
       x.doubleValue.isFinite, y.doubleValue.isFinite, abs(x.doubleValue) < 400, abs(y.doubleValue) < 400 {
      s.offset = CGSize(width: x.doubleValue, height: y.doubleValue)
    }
    if let a = p.text("accent"), ["full", "desat", "tint"].contains(a) { s.accent = a }
    s.sensitive = p.bool("sensitive") == true
    return s
  }
}

/// `if`: an AND over keys, each key an OR over its values. There are no expressions, ever.
struct NLookCond {
  var family: [String]?
  var appearance: [String]?
  var mode: [String]?
  var reduced: Bool?
  var cases: [String]?
  var phase: [String]?
  var has: String?
  var platform: String?
  var canAnswer: Bool?
  var standby: Bool?

  static func read(_ any: Any?) -> NLookCond? {
    guard let o = any as? [String: Any], !o.isEmpty else { return nil }
    func many(_ k: String) -> [String]? {
      if let s = o[k] as? String { return [s] }
      guard let a = o[k] as? [Any] else { return nil }
      let out = a.compactMap { $0 as? String }
      return out.isEmpty ? nil : out
    }
    var c = NLookCond()
    c.family = many("family")
    c.appearance = many("appearance")
    c.mode = many("mode")
    c.reduced = o["reduced"] as? Bool
    c.cases = many("case")
    c.phase = many("phase")
    c.has = (o["has"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    c.platform = o["platform"] as? String
    c.canAnswer = o["canAnswer"] as? Bool
    c.standby = o["standby"] as? Bool
    return c
  }
}

/// One node. A class, not a struct, because a node holds a `fallback` node of its own type, and because a tree is read once
/// and then handed to the renderer unchanged.
final class NLookNode {
  let type: String
  let props: NLookProps
  let style: NLookStyleSpec
  let children: [NLookNode]
  let cond: NLookCond?
  let fallback: NLookNode?

  init(
    type: String, props: NLookProps, style: NLookStyleSpec, children: [NLookNode], cond: NLookCond?,
    fallback: NLookNode?
  ) {
    self.type = type
    self.props = props
    self.style = style
    self.children = children
    self.cond = cond
    self.fallback = fallback
  }

  /// Every node type format 1 knows. A type outside this draws the node's `fallback`, then nothing.
  static let known: Set<String> = [
    "V", "H", "Z", "Spacer", "Grid", "Text", "Image", "Bot", "Shape", "Bar", "Ring", "Kit", "Each", "Button",
  ]

  var isKnown: Bool { NLookNode.known.contains(type) }

  /// The same node with its `bg` taken off. The one caller is a widget root (NLookRoots.widget), for every family: a
  /// root's background belongs to the widget, not to the drawn tree. On the Home Screen that is the CONTAINER, which iOS
  /// drops in StandBy and on tinted and clear Home Screens while never dropping content; on `rect` and `circle` it is
  /// the system's accessory backdrop; on `inline` there is none. A nested node's `bg` is ordinary content and stays.
  func withoutBG() -> NLookNode {
    var bare = style
    bare.bg = nil
    return NLookNode(type: type, props: props, style: bare, children: children, cond: cond, fallback: fallback)
  }

  /// What a design is allowed to spend while it is read: nodes left, and how deep it may still go.
  final class Budget {
    var nodes: Int
    init(_ nodes: Int) { self.nodes = nodes }
  }

  /// Read one node. nil means "nothing here": out of budget, too deep, or not an object at all. A node whose TYPE is unknown
  /// is still returned, so the renderer can draw its `fallback`; dropping it here would lose that.
  static func parse(_ any: Any?, depth: Int, budget: Budget) -> NLookNode? {
    guard depth < NLookLimits.depth, budget.nodes > 0, let o = any as? [String: Any] else { return nil }
    guard let type = o["type"] as? String, !type.isEmpty, type.count <= 24 else { return nil }
    budget.nodes -= 1

    var kids: [NLookNode] = []
    if let raw = o["children"] as? [Any] {
      // 24 children is far above anything a design needs and keeps one bad array from eating a whole budget.
      for child in raw.prefix(24) {
        guard budget.nodes > 0 else { break }
        if let node = parse(child, depth: depth + 1, budget: budget) { kids.append(node) }
      }
    }
    // The fallback is drawn INSTEAD of this node, so it sits at the same depth and costs the same budget.
    let fallback = parse(o["fallback"], depth: depth, budget: budget)

    return NLookNode(
      type: type,
      props: NLookProps((o["props"] as? [String: Any]) ?? [:]),
      style: NLookStyleSpec.read(o["style"]),
      children: kids,
      cond: NLookCond.read(o["if"]),
      fallback: fallback)
  }
}

/// One design, as the phone holds it: the roots it draws and the palette its roles resolve against.
struct NLookDesign {
  let id: String
  let format: Int
  let surface: String
  let fallbackId: String?
  let paletteName: String
  /// Root name ("small", "lock", "island.bottom") to its tree. A missing root means today's native view for that root ALONE.
  let roots: [String: NLookNode]
  let note: String

  /// Ids are [a-z0-9._-], 1 to 40 characters. Anything else is not a design id, so it never names a file.
  static func safeId(_ id: String) -> String? {
    let ok = Set("abcdefghijklmnopqrstuvwxyz0123456789._-")
    guard (1...40).contains(id.count), id.allSatisfy({ ok.contains($0) }), id != ".", id != ".." else { return nil }
    return id
  }

  /// Read a design file. nil means this build cannot draw it: not an object, no id, or a format from a later build.
  static func parse(_ data: Data) -> NLookDesign? {
    guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
    let p = NLookProps(o)
    guard let id = safeId(p.str("id")) else { return nil }
    let format = p.int("format", 0)
    guard format >= 1, format <= nlookFormat else { return nil }
    let surface = p.str("surface")
    guard surface == "widget" || surface == "activity" else { return nil }

    let isWidget = surface == "widget"
    let allowed: Set<String> = isWidget
      ? ["small", "medium", "large", "inline", "rect", "circle"]
      : ["lock", "island.leading", "island.trailing", "island.center", "island.bottom",
         "compact.leading", "compact.trailing", "minimal"]

    // One budget for the whole design, so a huge root cannot starve the others of the widget: each root takes its own cap out
    // of the shared total, in the order the contract lists them.
    let total = NLookNode.Budget(isWidget ? NLookLimits.widgetNodes : 400)
    var roots: [String: NLookNode] = [:]
    for name in allowed {
      guard let raw = (o["roots"] as? [String: Any])?[name] else { continue }
      let cap = isWidget ? NLookLimits.widgetNodesPerRoot : NLookLimits.activityNodes(name)
      let room = NLookNode.Budget(min(cap, total.nodes))
      guard room.nodes > 0, let tree = NLookNode.parse(raw, depth: 0, budget: room) else { continue }
      total.nodes -= (min(cap, max(0, total.nodes)) - room.nodes)
      roots[name] = tree
    }
    guard !roots.isEmpty else { return nil }

    return NLookDesign(
      id: id,
      format: format,
      surface: surface,
      fallbackId: p.text("fallback").flatMap(safeId),
      paletteName: p.text("palette") ?? "ink",
      roots: roots,
      note: p.str("note"))
  }
}
