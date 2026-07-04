import UIKit
import AVFoundation

// =============================================================================
// SDUIRenderer — server-driven UI renderer for Tulmi's iOS keyboard extension.
//
// When the backend config sets `features.sdui = true` and provides a `root`
// KeyboardNode tree, KeyboardViewController hands off UI construction to this
// renderer instead of hand-building UIButtons. Every node in the tree maps to
// a small UIView-building method here (LetterKey → UIButton, Row → horizontal
// UIStackView, BlurBackdrop → UIVisualEffectView, etc). Actions are decoded
// as a tagged union and dispatched through the host controller so dictation /
// refine / textDocumentProxy stay in the existing code path.
//
// The renderer is intentionally undiffed — the RN counterpart also rebuilds on
// state change, so we do too: `stateChanged()` tears the mounted subview down
// and re-runs `render()`. Cheap enough for keyboard-sized trees.
// =============================================================================

// MARK: - Host protocol

/// Back-reference the renderer holds weakly so it can call the existing
/// dictation / refine / text-proxy code paths that live on
/// KeyboardViewController without depending on its concrete type.
protocol KBHostControllerProtocol: AnyObject {
  var hostTextDocumentProxy: UITextDocumentProxy { get }
  var hostHasFullAccess: Bool { get }
  var hostExtensionContext: NSExtensionContext? { get }
  func hostLabel(_ key: String, _ fallback: String) -> String
  func hostStartDictation()
  func hostStopDictation()
  func hostRunRefine()
  func hostAdvanceInputMode()
  func hostPresent(_ vc: UIViewController)
  /// The current field's autocap trait. Used by the renderer to decide when to
  /// arm state.shift after inserts. Default `.sentences` matches iOS default.
  func hostAutocapitalizationType() -> UITextAutocapitalizationType
  /// The current field's returnKeyType, so the Return key can render its
  /// context-appropriate label (Go / Search / Send / Done…) + accent color.
  func hostReturnKeyType() -> UIReturnKeyType
}

// MARK: - Polymorphic JSON value (for props / style bags)

/// Small Codable helper matching the `Record<string, any>` shape of props/style
/// bags in the SDUI schema. Kept intentionally lax — reads that don't match a
/// shape just return nil and the renderer falls back to defaults.
enum KBJSON: Decodable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([KBJSON])
  case object([String: KBJSON])

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null; return }
    if let b = try? c.decode(Bool.self) { self = .bool(b); return }
    if let d = try? c.decode(Double.self) { self = .number(d); return }
    if let s = try? c.decode(String.self) { self = .string(s); return }
    if let a = try? c.decode([KBJSON].self) { self = .array(a); return }
    if let o = try? c.decode([String: KBJSON].self) { self = .object(o); return }
    self = .null
  }

  var asString: String? {
    if case .string(let s) = self { return s }
    if case .number(let n) = self { return String(n) }
    if case .bool(let b) = self { return b ? "true" : "false" }
    return nil
  }
  var asDouble: Double? {
    if case .number(let n) = self { return n }
    if case .string(let s) = self, let n = Double(s) { return n }
    return nil
  }
  var asCGFloat: CGFloat? { asDouble.map { CGFloat($0) } }
  var asBool: Bool? {
    if case .bool(let b) = self { return b }
    if case .number(let n) = self { return n != 0 }
    if case .string(let s) = self { return ["true", "1", "yes"].contains(s.lowercased()) }
    return nil
  }
  var asObject: [String: KBJSON]? { if case .object(let o) = self { return o }; return nil }
  var asArray: [KBJSON]? { if case .array(let a) = self { return a }; return nil }
}

// MARK: - Codable schema

/// Top-level config sent by GET /v1/keyboard/config (schema-mirrors the TS
/// KeyboardConfigResponse in TAILZU-BACKEND/shared/types/sdui.ts).
struct KBConfig: Decodable {
  let schemaVersion: Int?
  let theme: KBTheme?
  // v3 dark/light adaptive palettes. When present, the renderer picks between
  // themeDark and themeLight based on the extension's current userInterface-
  // Style and re-renders on traitCollectionDidChange. When absent, `theme` is
  // the sole palette used (backward-compatible).
  let themeDark: KBTheme?
  let themeLight: KBTheme?
  let layouts: [KBLayout]?
  let features: KBFeatures?
  let labels: [String: String]?
  let root: KBNode?
  let actions: [String: KBActionSpec]?
  let cacheTtlSeconds: Int?
  let cacheVersion: String?
  let flags: [String: KBJSON]?
}

struct KBFeatures: Decodable {
  let voice: Bool?
  let refine: Bool?
  let streaming: Bool?
  let sdui: Bool?
}

struct KBTheme: Decodable {
  let background: String?
  let key: String?
  let keyText: String?
  let accent: String?
  let keyPressed: String?
  let backgroundEffect: KBEffect?
  let keyEffect: KBEffect?
  let keyRadius: Double?
  let keyShadow: Bool?
}

struct KBLayout: Decodable {
  let language: String
  let displayName: String?
  let rows: [[String]]
}

/// KeyboardEffect union — `{kind: "solid", color}` / `{kind: "blur", style}` /
/// `{kind: "gradient", colors[], direction?}`.
enum KBEffect: Decodable {
  case solid(color: String)
  case blur(style: String)
  case gradient(colors: [String], direction: String?)

  private enum Keys: String, CodingKey { case kind, color, style, colors, direction }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let kind = try c.decode(String.self, forKey: .kind)
    switch kind {
    case "solid":
      self = .solid(color: (try? c.decode(String.self, forKey: .color)) ?? "#00000000")
    case "blur":
      self = .blur(style: (try? c.decode(String.self, forKey: .style)) ?? "regular")
    case "gradient":
      let colors = (try? c.decode([String].self, forKey: .colors)) ?? []
      let dir = try? c.decode(String.self, forKey: .direction)
      self = .gradient(colors: colors, direction: dir)
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: c, debugDescription: "Unknown effect kind \(kind)")
    }
  }
}

/// A single node in the SDUI keyboard tree. `on`/`bind` are kept lax; the
/// renderer reads them by convention.
struct KBNode: Decodable {
  let type: String
  let id: String?
  let props: [String: KBJSON]?
  let style: [String: KBJSON]?
  let children: [KBNode]?
  let bind: [String: String]?
  let on: [String: KBActionRef]?
  let effect: KBEffect?
  let visibleIf: KBCondition?
}

/// ActionRef = a string alias (looked up in config.actions) OR an inline
/// ActionSpec. Modeled as an enum so both forms decode transparently.
/// `indirect` is required because KBActionSpec.condition references KBActionRef,
/// creating a cycle Swift needs a heap indirection to size.
indirect enum KBActionRef: Decodable {
  case named(String)
  case inline(KBActionSpec)

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if let s = try? c.decode(String.self) { self = .named(s); return }
    let spec = try KBActionSpec(from: decoder)
    self = .inline(spec)
  }
}

/// Tagged union of keyboard actions. Custom-decoded because Swift Codable
/// doesn't handle string-discriminated JSON unions natively. `indirect`
/// because `.condition` holds KBActionRef which wraps KBActionSpec.
indirect enum KBActionSpec: Decodable {
  case insertText(text: String)
  case insertKey(char: String)
  case deleteBackward
  case deleteWord
  case shift
  case capsLock
  case returnKey
  case switchLayout(language: String?)
  case showLanguageMenu
  case startDictation
  case stopDictation
  case runRefine
  case cycleTone
  case openApp(screenId: String?)
  case openSettings
  case haptic(style: String)
  case sequence(actions: [KBActionRef])
  case condition(ifCond: KBCondition, then: KBActionRef, elseRef: KBActionRef?)
  case unknown(kind: String)

  private enum Keys: String, CodingKey {
    case kind, text, char, language, screenId, style, actions
    case ifCond = "if", then, elseRef = "else"
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let kind = try c.decode(String.self, forKey: .kind)
    switch kind {
    case "insertText":
      self = .insertText(text: (try? c.decode(String.self, forKey: .text)) ?? "")
    case "insertKey":
      self = .insertKey(char: (try? c.decode(String.self, forKey: .char)) ?? "")
    case "deleteBackward": self = .deleteBackward
    case "deleteWord":     self = .deleteWord
    case "shift":          self = .shift
    case "capsLock":       self = .capsLock
    case "return":         self = .returnKey
    case "switchLayout":
      self = .switchLayout(language: try? c.decode(String.self, forKey: .language))
    case "showLanguageMenu": self = .showLanguageMenu
    case "startDictation":   self = .startDictation
    case "stopDictation":    self = .stopDictation
    case "runRefine":        self = .runRefine
    case "cycleTone":        self = .cycleTone
    case "openApp":
      self = .openApp(screenId: try? c.decode(String.self, forKey: .screenId))
    case "openSettings":     self = .openSettings
    case "haptic":
      self = .haptic(style: (try? c.decode(String.self, forKey: .style)) ?? "light")
    case "sequence":
      self = .sequence(actions: (try? c.decode([KBActionRef].self, forKey: .actions)) ?? [])
    case "condition":
      let cond = try c.decode(KBCondition.self, forKey: .ifCond)
      let thenA = try c.decode(KBActionRef.self, forKey: .then)
      let elseA = try? c.decode(KBActionRef.self, forKey: .elseRef)
      self = .condition(ifCond: cond, then: thenA, elseRef: elseA)
    default:
      self = .unknown(kind: kind)
    }
  }
}

/// Condition mirrors the RN evaluator: {eq}, {neq}, {gt}, {gte}, {lt}, {lte},
/// {in}, {contains}, {truthy}, {falsy}, {flag}, {platform}, {not}, {all}, {any}.
indirect enum KBCondition: Decodable {
  case eq(path: String, value: KBJSON)
  case neq(path: String, value: KBJSON)
  case gt(path: String, value: Double)
  case gte(path: String, value: Double)
  case lt(path: String, value: Double)
  case lte(path: String, value: Double)
  case inList(path: String, values: [KBJSON])
  case contains(path: String, needle: String)
  case truthy(path: String)
  case falsy(path: String)
  case flag(name: String)
  case platform(name: String)
  case not(inner: KBCondition)
  case all(conds: [KBCondition])
  case any_(conds: [KBCondition])
  case unknown

  init(from decoder: Decoder) throws {
    // Conditions are a discriminator-less "first key wins" shape; peek at each
    // possible key. Only one of them will be present per condition.
    let raw = try decoder.singleValueContainer().decode([String: KBJSON].self)
    if let arr = raw["eq"]?.asArray, arr.count == 2, let p = arr[0].asString {
      self = .eq(path: p, value: arr[1]); return
    }
    if let arr = raw["neq"]?.asArray, arr.count == 2, let p = arr[0].asString {
      self = .neq(path: p, value: arr[1]); return
    }
    if let arr = raw["gt"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .gt(path: p, value: n); return
    }
    if let arr = raw["gte"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .gte(path: p, value: n); return
    }
    if let arr = raw["lt"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .lt(path: p, value: n); return
    }
    if let arr = raw["lte"]?.asArray, arr.count == 2, let p = arr[0].asString, let n = arr[1].asDouble {
      self = .lte(path: p, value: n); return
    }
    if let arr = raw["in"]?.asArray, arr.count == 2, let p = arr[0].asString, let vs = arr[1].asArray {
      self = .inList(path: p, values: vs); return
    }
    if let arr = raw["contains"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .contains(path: p, needle: s); return
    }
    if let p = raw["truthy"]?.asString { self = .truthy(path: p); return }
    if let p = raw["falsy"]?.asString  { self = .falsy(path: p); return }
    if let n = raw["flag"]?.asString   { self = .flag(name: n); return }
    if let n = raw["platform"]?.asString { self = .platform(name: n); return }
    if let inner = raw["not"] {
      let data = try JSONEncoderSafe.data(for: inner)
      let dec = try JSONDecoder().decode(KBCondition.self, from: data)
      self = .not(inner: dec); return
    }
    if let arr = raw["all"]?.asArray {
      var out: [KBCondition] = []
      for v in arr {
        let data = try JSONEncoderSafe.data(for: v)
        out.append(try JSONDecoder().decode(KBCondition.self, from: data))
      }
      self = .all(conds: out); return
    }
    if let arr = raw["any"]?.asArray {
      var out: [KBCondition] = []
      for v in arr {
        let data = try JSONEncoderSafe.data(for: v)
        out.append(try JSONDecoder().decode(KBCondition.self, from: data))
      }
      self = .any_(conds: out); return
    }
    self = .unknown
  }
}

/// Serialize a KBJSON back to Data so `not`/`all`/`any` can recursively decode
/// their inner Condition. KBJSON isn't Encodable directly, so we lower it to
/// Foundation types and hand to JSONSerialization.
enum JSONEncoderSafe {
  static func data(for value: KBJSON) throws -> Data {
    let obj = lower(value)
    return try JSONSerialization.data(withJSONObject: obj, options: .fragmentsAllowed)
  }
  private static func lower(_ v: KBJSON) -> Any {
    switch v {
    case .null: return NSNull()
    case .bool(let b): return b
    case .number(let n): return n
    case .string(let s): return s
    case .array(let a): return a.map { lower($0) }
    case .object(let o):
      var out: [String: Any] = [:]
      for (k, x) in o { out[k] = lower(x) }
      return out
    }
  }
}

// MARK: - State

/// Small state store. Actions mutate this and call stateChanged() to re-render.
final class KBState {
  var shift: Bool = false
  var capsLock: Bool = false
  var layoutId: String = ""
  var dictating: Bool = false
  var refining: Bool = false
  var hasFullAccess: Bool = false
  var status: String = ""
  var micLevel: CGFloat = 0
  var suggestions: [String] = []
  /// Tone the tools-bar pill cycles through. Values chosen server-side via
  /// config.flags["kb.tones"] or the default set below when unset.
  var tone: String = "Neutral"
  /// True while space is held long enough to enter trackpad-cursor mode. When
  /// true, other keys visually dim and touch tracking on space becomes cursor
  /// movement instead of insertion.
  var trackpadActive: Bool = false
}

// MARK: - Renderer

final class SDUIRenderer: NSObject {
  private weak var host: KBHostControllerProtocol?
  private let config: KBConfig
  private let state = KBState()

  /// The container view we mount into (owned by the host controller).
  private weak var mountContainer: UIView?
  /// The single root subview we produce so we can swap it whole on re-render.
  private var mountedRoot: UIView?

  private var lastShiftTapTime: TimeInterval = 0
  private var _lastSpaceTapTime: TimeInterval = 0
  private var _trackpadAnchor: CGFloat = 0
  private var _trackpadOffset: Int = 0
  private var deleteTimer: Timer?
  private var deleteRepeatCount: Int = 0
  // Timer + [weak self] avoids the retain cycle CADisplayLink would create
  // (it retains its target). Renderer is held by the controller and needs to
  // die when the keyboard extension dismisses.
  private var waveformTimer: Timer?
  private weak var waveformView: WaveformView?

  init(controller: KBHostControllerProtocol, config: KBConfig) {
    self.host = controller
    self.config = config
    super.init()
    self.state.hasFullAccess = controller.hostHasFullAccess
    self.state.layoutId = config.layouts?.first?.language ?? ""
  }

  // MARK: Dark/light adaptation

  /// The current appearance the host is in — dark or light. Read from the
  /// host controller's trait collection so the picker below matches whatever
  /// UIVisualEffectView is actually rendering the backdrop.
  private var currentAppearance: UIUserInterfaceStyle {
    (host as? UIViewController)?.traitCollection.userInterfaceStyle ?? .dark
  }

  /// Pick between config.themeDark / themeLight based on the current
  /// appearance. Falls back to config.theme when the adaptive palettes are
  /// absent (backend hasn't emitted them yet). Every color read in the
  /// renderer routes through this so a trait-collection change picks up
  /// automatically on remount().
  var theme: KBTheme? {
    if currentAppearance == .light, let l = config.themeLight { return l }
    if currentAppearance == .dark, let d = config.themeDark { return d }
    return config.theme
  }

  /// Called by the host controller from traitCollectionDidChange. Re-applies
  /// the backdrop with the new blur style and rebuilds the tree so keys pick
  /// up the new palette.
  func appearanceDidChange() {
    if let container = mountContainer { applyRootBackground(to: container) }
    remount()
  }

  // MARK: Mount

  /// Attach the renderer to a container view. Called once by the host
  /// controller after it decides SDUI mode is active.
  func mount(into container: UIView) {
    mountContainer = container
    // Apply theme.backgroundEffect / backgroundColor to the container itself.
    applyRootBackground(to: container)
    remount()
  }

  /// Tear down the current subview and rebuild from the root node. Cheap: the
  /// keyboard tree is tiny (~40 nodes).
  private func remount() {
    guard let container = mountContainer, let root = config.root else { return }
    mountedRoot?.removeFromSuperview()
    let v = render(node: root)
    v.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(v)
    NSLayoutConstraint.activate([
      v.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      v.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      v.topAnchor.constraint(equalTo: container.topAnchor),
      v.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    mountedRoot = v
  }

  /// Public hook — actions call this after mutating KBState.
  func stateChanged() { remount() }

  // MARK: Root backdrop

  /// The theme's `backgroundEffect` sits on the container itself (not on the
  /// root node) so blur / gradient covers the whole keyboard area.
  private func applyRootBackground(to container: UIView) {
    if let bg = theme?.background {
      container.backgroundColor = UIColor(tulmiHex: bg)
    }
    guard let effect = theme?.backgroundEffect else { return }
    // Remove any previous backdrop we installed.
    container.subviews
      .filter { $0.tag == Self.backdropTag }
      .forEach { $0.removeFromSuperview() }
    let backdrop = makeEffectBackdrop(effect: effect)
    backdrop.tag = Self.backdropTag
    backdrop.translatesAutoresizingMaskIntoConstraints = false
    container.insertSubview(backdrop, at: 0)
    NSLayoutConstraint.activate([
      backdrop.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      backdrop.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      backdrop.topAnchor.constraint(equalTo: container.topAnchor),
      backdrop.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
  }
  private static let backdropTag: Int = 0x7B00D_1_A

  // MARK: - Node dispatch

  /// Walk a node into a UIView. `visibleIf` culls the subtree; unknown types
  /// render a red "?" tile so schema mismatches are visible instead of silent.
  func render(node: KBNode) -> UIView {
    if let cond = node.visibleIf, !evaluate(cond) {
      let empty = UIView()
      empty.isHidden = true
      return empty
    }
    let v: UIView
    switch node.type {
    case "Container", "Column": v = buildStack(node: node, axis: .vertical)
    case "Row":                  v = buildStack(node: node, axis: .horizontal)
    case "Spacer":               v = buildSpacer(node: node)
    case "LetterKey":            v = buildLetterKey(node: node)
    case "IconKey":              v = buildIconKey(node: node)
    case "SpaceKey":             v = buildSpaceKey(node: node)
    case "ShiftKey":             v = buildShiftKey(node: node)
    case "ReturnKey":            v = buildReturnKey(node: node)
    case "BackspaceKey":         v = buildBackspaceKey(node: node)
    case "GlobeKey":             v = buildGlobeKey(node: node)
    case "MicKey":               v = buildMicKey(node: node)
    case "RefineKey":            v = buildRefineKey(node: node)
    case "SuggestionBar":        v = buildSuggestionBar(node: node)
    case "Waveform":             v = buildWaveform(node: node)
    case "StatusLabel":          v = buildStatusLabel(node: node)
    case "Divider":              v = buildDivider(node: node)
    case "BlurBackdrop":         v = buildBlurBackdrop(node: node)
    default:                     v = buildUnknown(type: node.type)
    }
    applyStyle(node: node, to: v)
    applyEffectIfChildlessBackdrop(node: node, view: v)
    return v
  }

  // MARK: - Components

  /// Container / Row / Column all lower to UIStackView. Row = horizontal.
  /// If the node has an `effect` too, `applyEffectIfChildlessBackdrop` inserts
  /// it as a background subview at layer index 0 — UIStackView still lays out
  /// its arrangedSubviews above it.
  ///
  /// Proportional flex: children with a numeric `flex` on their style get a
  /// widthAnchor (row) / heightAnchor (column) constraint whose multiplier is
  /// their `flex / totalFlex` share of the stack's usable size. That's what
  /// makes space:5.79 actually occupy 5.79× a letter key's width instead of
  /// tied-with-everything-at-defaultLow behavior. Explicit `width` still wins
  /// over flex when both are set.
  private func buildStack(node: KBNode, axis: NSLayoutConstraint.Axis) -> UIView {
    let stack = UIStackView()
    stack.axis = axis
    stack.alignment = .fill
    stack.distribution = .fill
    stack.spacing = CGFloat(node.style?["gap"]?.asDouble ?? node.style?["spacing"]?.asDouble ?? 5)

    let kids = node.children ?? []
    var built: [(node: KBNode, view: UIView)] = []
    for child in kids {
      let cv = render(node: child)
      stack.addArrangedSubview(cv)
      built.append((child, cv))
    }

    // Second pass: apply proportional flex constraints. Sum every child's flex
    // (default 0). If the total is > 0 AND the child has flex but no explicit
    // width/height in its dimension, tie its size to a reference child (the
    // first flex sibling) at the ratio flex_i / flex_ref.
    let flexes: [Double] = built.map { $0.node.style?["flex"]?.asDouble ?? 0 }
    let sizeKey = axis == .horizontal ? "width" : "height"
    let hasSizeInAxis: [Bool] = built.map { $0.node.style?[sizeKey]?.asCGFloat != nil }
    // Find the first flex>0 child that DOESN'T have explicit size — becomes the
    // ratio anchor.
    let refIndex = flexes.enumerated().first { (i, f) in f > 0 && !hasSizeInAxis[i] }?.offset
    if let ref = refIndex {
      let refFlex = flexes[ref]
      let refView = built[ref].view
      for i in 0..<built.count {
        guard i != ref else { continue }
        let f = flexes[i]
        if f <= 0 { continue }             // no flex → intrinsic / explicit width
        if hasSizeInAxis[i] { continue }   // explicit width wins
        let child = built[i].view
        let ratio = CGFloat(f / refFlex)
        if axis == .horizontal {
          child.widthAnchor.constraint(equalTo: refView.widthAnchor, multiplier: ratio).isActive = true
        } else {
          child.heightAnchor.constraint(equalTo: refView.heightAnchor, multiplier: ratio).isActive = true
        }
      }
    }
    return stack
  }

  /// An empty view that consumes remaining space in the parent stack, letting
  /// siblings hug their content.
  private func buildSpacer(node: KBNode) -> UIView {
    let v = UIView()
    v.setContentHuggingPriority(.defaultLow, for: .horizontal)
    v.setContentHuggingPriority(.defaultLow, for: .vertical)
    v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    v.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
    return v
  }

  /// Letter key — the workhorse. Title honors shift/capsLock; tap inserts.
  /// Long-press (500ms) reveals an accent tray for letters that have one
  /// (English: a e i o u n c y s d h; Latin extended can be added by locale).
  /// When `bind.content` names a KBState key (e.g. "tone"), the title reads
  /// from that key at render time — used for the tone pill in the tools bar.
  private func buildLetterKey(node: KBNode) -> UIView {
    var ch = node.props?["char"]?.asString ?? ""
    if let boundKey = node.bind?["content"], let live = stateValue(for: boundKey) {
      ch = live
    }
    let btn = makeKeyButton()
    let uppercased = state.shift || state.capsLock
    // Only apply case swap for single-character labels — multi-char titles
    // (like "Neutral") stay as-is regardless of shift.
    let displayed = ch.count == 1 ? (uppercased ? ch.uppercased() : ch.lowercased()) : ch
    btn.setTitle(displayed, for: .normal)
    let payload = node.props?["char"]?.asString ?? ch
    bindTap(btn, node: node, defaultAction: .insertKey(char: uppercased ? payload.uppercased() : payload))

    // Attach an accent popover if this letter has one in the map.
    if let accents = accentMap[ch.lowercased()], !accents.isEmpty {
      let lp = UILongPressGestureRecognizer(target: self, action: #selector(letterLongPress(_:)))
      lp.minimumPressDuration = 0.5
      lp.allowableMovement = 500
      objc_setAssociatedObject(lp, &Self.accentsKey, accents, .OBJC_ASSOCIATION_RETAIN)
      objc_setAssociatedObject(lp, &Self.accentsBaseKey, ch, .OBJC_ASSOCIATION_RETAIN)
      btn.addGestureRecognizer(lp)
    }
    return btn
  }

  private static var accentsKey: UInt8 = 0
  private static var accentsBaseKey: UInt8 = 0
  private weak var activeAccentTray: UIView?

  /// Read a KBState value by name for a `bind` in the tree. Used by
  /// components (LetterKey) that show live state text (e.g. tone pill).
  private func stateValue(for key: String) -> String? {
    switch key {
    case "tone":       return state.tone
    case "status":     return state.status
    case "layoutId":   return state.layoutId
    default:           return nil
    }
  }

  /// Tones the cycleTone action rotates through. Backend can override via
  /// config.flags["kb.tones"] (comma-separated). Default matches the ones
  /// the app's Personality screen uses.
  private func configuredTones() -> [String] {
    if let raw = config.flags?["kb.tones"]?.asString {
      let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
      if !parts.isEmpty { return parts }
    }
    return ["Neutral", "Casual", "Formal", "Excited"]
  }

  /// English accent map. Order matches Apple's stock keyboard. When a locale
  /// needs a different set, config.flags["kb.accents.<locale>"] can eventually
  /// override this.
  private var accentMap: [String: [String]] {
    [
      "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
      "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
      "i": ["î", "ï", "í", "ī", "į", "ì"],
      "o": ["ô", "ö", "ò", "ó", "œ", "ø", "ō", "õ"],
      "u": ["û", "ü", "ù", "ú", "ū"],
      "y": ["ÿ"],
      "s": ["ß", "ś", "š"],
      "l": ["ł"],
      "z": ["ž", "ź", "ż"],
      "c": ["ç", "ć", "č"],
      "n": ["ñ", "ń"],
      "d": ["ď"],
      "h": ["ĥ", "ħ"],
    ]
  }

  @objc private func letterLongPress(_ gr: UILongPressGestureRecognizer) {
    guard let btn = gr.view as? UIButton else { return }
    let accents = (objc_getAssociatedObject(gr, &Self.accentsKey) as? [String]) ?? []
    let base = (objc_getAssociatedObject(gr, &Self.accentsBaseKey) as? String) ?? ""
    switch gr.state {
    case .began:
      showAccentTray(for: btn, base: base, options: accents)
    case .changed:
      if let tray = activeAccentTray {
        let loc = gr.location(in: tray)
        tray.subviews.forEach { chip in
          let inside = chip.frame.contains(loc)
          if inside { chip.backgroundColor = .systemBlue }
          else { chip.backgroundColor = keyBgColor() }
        }
      }
    case .ended:
      pickAccentAndDismiss(gestureRecognizer: gr)
    case .cancelled, .failed:
      dismissAccentTray()
    default:
      break
    }
  }

  private func showAccentTray(for anchor: UIButton, base: String, options: [String]) {
    dismissAccentTray()
    guard let container = mountContainer else { return }
    let uppercased = state.shift || state.capsLock
    let items = ([base] + options).map { uppercased ? $0.uppercased() : $0 }

    let tray = UIStackView()
    tray.axis = .horizontal
    tray.distribution = .fillEqually
    tray.alignment = .fill
    tray.spacing = 4
    tray.translatesAutoresizingMaskIntoConstraints = false
    tray.backgroundColor = keyBgColor()
    tray.layer.cornerRadius = 8
    tray.layer.masksToBounds = true
    tray.isLayoutMarginsRelativeArrangement = true
    tray.layoutMargins = UIEdgeInsets(top: 4, left: 4, bottom: 4, right: 4)

    let chipW: CGFloat = 40
    let chipCount = items.count
    let width: CGFloat = CGFloat(chipCount) * chipW + CGFloat(chipCount - 1) * 4 + 8

    for text in items {
      let chip = UIButton(type: .system)
      chip.setTitle(text, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.titleLabel?.font = .systemFont(ofSize: 22, weight: .regular)
      chip.backgroundColor = .clear
      chip.layer.cornerRadius = 6
      chip.isUserInteractionEnabled = false
      tray.addArrangedSubview(chip)
    }

    container.addSubview(tray)
    let anchorFrame = anchor.convert(anchor.bounds, to: container)
    // Position tray above the key. Clamped to container bounds so it can't
    // draw off-screen. Apple would draw ABOVE the keyboard's top edge — we
    // can't, so we place it inside the keyboard's own frame directly above
    // the key. Reads slightly different from Apple's but stays within API
    // limits (App Extension Programming Guide: no draw above input view).
    let desiredX = anchorFrame.midX - width / 2
    let clampedX = max(4, min(container.bounds.width - width - 4, desiredX))
    let desiredY = anchorFrame.minY - 52
    let clampedY = max(4, desiredY)
    NSLayoutConstraint.activate([
      tray.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: clampedX),
      tray.topAnchor.constraint(equalTo: container.topAnchor, constant: clampedY),
      tray.widthAnchor.constraint(equalToConstant: width),
      tray.heightAnchor.constraint(equalToConstant: 48),
    ])
    activeAccentTray = tray
  }

  private func pickAccentAndDismiss(gestureRecognizer gr: UILongPressGestureRecognizer) {
    defer { dismissAccentTray() }
    guard let tray = activeAccentTray else { return }
    let loc = gr.location(in: tray)
    // Find the chip whose frame contains the release point.
    guard let chip = tray.subviews.first(where: { $0.frame.contains(loc) }) as? UIButton,
          let ch = chip.title(for: .normal), !ch.isEmpty else {
      // Slid off the tray — no insert (matches Apple).
      return
    }
    host?.hostTextDocumentProxy.insertText(ch)
    if state.shift && !state.capsLock {
      state.shift = false
      stateChanged()
    }
    updateAutoCap()
  }

  private func dismissAccentTray() {
    activeAccentTray?.removeFromSuperview()
    activeAccentTray = nil
  }

  /// Icon key — an SF Symbol from props.icon. Any tap semantics come from `on`.
  private func buildIconKey(node: KBNode) -> UIView {
    let icon = node.props?["icon"]?.asString ?? "questionmark"
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: icon), for: .normal)
    btn.tintColor = keyTextColor()
    bindTap(btn, node: node, defaultAction: nil)
    return btn
  }

  /// Big space bar. Custom label from `labels.space` falls back to "space".
  /// Behaviors baked in:
  ///  - Single tap → inserts " ". Double-tap within 500ms → replaces the
  ///    trailing space with ". " (Apple's "quick period" pattern).
  ///  - Long-press (~300ms) → trackpad-cursor mode. Finger drags become
  ///    horizontal cursor moves via adjustTextPosition(byCharacterOffset:).
  ///    Two-finger drag reserved for a future selection extension.
  ///  - Sound + haptic fire on the touch-down when Full Access is granted
  ///    (shared with makeKeyButton — this override just handles the special
  ///    tap semantics).
  private func buildSpaceKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setTitle(host?.hostLabel("space", "space") ?? "space", for: .normal)
    btn.titleLabel?.font = .systemFont(ofSize: 15)
    // Single-tap insertion is deferred to touchUpInside so slide-off cancels
    // cleanly (Apple's slide-off pattern) — see bindTap.
    let action = UIAction { [weak self] _ in self?.handleSpaceTap() }
    btn.addAction(action, for: .touchUpInside)

    // Long-press → trackpad cursor. UILongPressGestureRecognizer fires .began
    // once the 300ms threshold passes; while active we intercept touches
    // moved and translate them into cursor deltas.
    let lp = UILongPressGestureRecognizer(target: self, action: #selector(spaceLongPress(_:)))
    lp.minimumPressDuration = 0.3
    lp.allowableMovement = 1000  // don't cancel on drag; that's the whole point
    btn.addGestureRecognizer(lp)
    return btn
  }

  /// Fires when the user taps space. Handles the double-space-→-". " pattern.
  private func handleSpaceTap() {
    let now = Date().timeIntervalSince1970
    if state.trackpadActive {
      // Trackpad was ending — swallow this tap; the touchUp inside long-press
      // already released the cursor.
      state.trackpadActive = false
      stateChanged()
      return
    }
    let proxy = host?.hostTextDocumentProxy
    let recent = now - _lastSpaceTapTime < 0.5
    let smartPeriodOn: Bool = {
      if let f = config.flags?["kb.smartPeriod"]?.asBool { return f }
      return true
    }()
    if recent && smartPeriodOn,
       let ctx = proxy?.documentContextBeforeInput,
       ctx.hasSuffix(" "),
       let prevChar = ctx.dropLast().last,
       !prevChar.isPunctuation, prevChar != "\n" {
      // Replace the trailing " " with ". ".
      proxy?.deleteBackward()
      proxy?.insertText(". ")
      _lastSpaceTapTime = 0
    } else {
      proxy?.insertText(" ")
      _lastSpaceTapTime = now
    }
    updateAutoCap()
  }

  /// Long-press on the space bar → trackpad-cursor mode. Once .began fires,
  /// we track the finger and issue adjustTextPosition calls in proportion to
  /// horizontal movement. Ends when the finger lifts.
  @objc private func spaceLongPress(_ gr: UILongPressGestureRecognizer) {
    guard let view = gr.view else { return }
    switch gr.state {
    case .began:
      state.trackpadActive = true
      _trackpadAnchor = gr.location(in: view).x
      _trackpadOffset = 0
      // Subtle haptic to signal mode entry.
      if let host = host, host.hostHasFullAccess {
        let g = UIImpactFeedbackGenerator(style: .light)
        g.prepare(); g.impactOccurred()
      }
      stateChanged()
    case .changed:
      let cur = gr.location(in: view).x
      // 7pt per character — matches Apple's feel. Sub-character deltas
      // accumulate in _trackpadOffset so slow drags still move.
      let raw = Double(cur - _trackpadAnchor) / 7.0
      let steps = Int(raw)
      if steps != _trackpadOffset {
        let delta = steps - _trackpadOffset
        host?.hostTextDocumentProxy.adjustTextPosition(byCharacterOffset: delta)
        _trackpadOffset = steps
      }
    case .ended, .cancelled, .failed:
      state.trackpadActive = false
      _lastSpaceTapTime = 0  // don't count the release as a tap
      stateChanged()
    default:
      break
    }
  }

  /// Shift toggle. Single-tap flips state.shift; double-tap within 300ms
  /// promotes to caps lock. Re-render swaps letter titles.
  private func buildShiftKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setTitle(state.capsLock ? "⇪" : "⇧", for: .normal)
    btn.titleLabel?.font = .systemFont(ofSize: 20)
    let handler = UIAction { [weak self] _ in self?.handleShiftTap() }
    btn.addAction(handler, for: .touchUpInside)
    return btn
  }
  private func handleShiftTap() {
    let now = Date().timeIntervalSince1970
    // If we're currently caps-locked, tap 1 turns everything off — and we
    // reset lastShiftTapTime so a follow-up tap is NOT treated as the
    // second half of a double-tap-to-caps. Previously this promoted the
    // "turn caps off" into "turn caps back on" (audit finding).
    if state.capsLock {
      state.capsLock = false
      state.shift = false
      lastShiftTapTime = 0
      stateChanged()
      return
    }
    if now - lastShiftTapTime < 0.3 {
      // Fast double-tap → promote to caps-lock.
      state.capsLock = true
      state.shift = true
    } else {
      state.shift.toggle()
    }
    lastShiftTapTime = now
    stateChanged()
  }

  /// Return key — inserts newline. Adapts label + tint to the current field's
  /// UIReturnKeyType so Go / Send / Search / Done render correctly with the
  /// system-blue accent (Apple's convention for action returns).
  private func buildReturnKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    let rt = host?.hostReturnKeyType() ?? .default
    btn.setTitle(returnKeyLabel(for: rt), for: .normal)
    if returnKeyIsAction(rt) {
      // System-blue accent for action returns. Apple uses UIColor.systemBlue
      // (#0A84FF-ish in dark mode).
      btn.backgroundColor = .systemBlue
      btn.setTitleColor(.white, for: .normal)
      // Update the pressed-color cache so touch feedback doesn't jarringly
      // revert to the base gray.
      objc_setAssociatedObject(btn, &Self.keyBaseColorKey, UIColor.systemBlue, .OBJC_ASSOCIATION_RETAIN)
    }
    bindTap(btn, node: node, defaultAction: .returnKey)
    return btn
  }

  /// Localized label for a UIReturnKeyType. Values pulled from Apple's own
  /// UIKit table (matched empirically). Return "return" for default.
  private func returnKeyLabel(for type: UIReturnKeyType) -> String {
    switch type {
    case .go:              return host?.hostLabel("return.go", "Go") ?? "Go"
    case .join:            return host?.hostLabel("return.join", "Join") ?? "Join"
    case .next:            return host?.hostLabel("return.next", "Next") ?? "Next"
    case .route:           return host?.hostLabel("return.route", "Route") ?? "Route"
    case .search:          return host?.hostLabel("return.search", "Search") ?? "Search"
    case .send:            return host?.hostLabel("return.send", "Send") ?? "Send"
    case .yahoo:           return host?.hostLabel("return.yahoo", "Yahoo") ?? "Yahoo"
    case .google:          return host?.hostLabel("return.google", "Google") ?? "Google"
    case .done:            return host?.hostLabel("return.done", "Done") ?? "Done"
    case .emergencyCall:   return host?.hostLabel("return.emergency", "Emergency") ?? "Emergency"
    case .continue:        return host?.hostLabel("return.continue", "Continue") ?? "Continue"
    case .default:         return host?.hostLabel("return", "return") ?? "return"
    @unknown default:      return host?.hostLabel("return", "return") ?? "return"
    }
  }

  /// True for the return types Apple accents in system-blue (action returns).
  private func returnKeyIsAction(_ type: UIReturnKeyType) -> Bool {
    switch type {
    case .default, .next: return false
    default: return true
    }
  }

  /// Backspace — tap deletes one; long-press repeats (200ms initial then 40ms).
  private func buildBackspaceKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "delete.left"), for: .normal)
    btn.tintColor = keyTextColor()
    btn.addTarget(self, action: #selector(deleteDown), for: .touchDown)
    btn.addTarget(self, action: #selector(deleteUp),
                  for: [.touchUpInside, .touchUpOutside, .touchCancel])
    return btn
  }
  @objc private func deleteDown() {
    // First delete fires immediately on touch-down (Apple's pattern).
    host?.hostTextDocumentProxy.deleteBackward()
    deleteRepeatCount = 1
    deleteTimer?.invalidate()
    // 500ms initial delay before repeat begins, then 90ms per char for the
    // first 20 chars, then accelerate to whole-word deletion. Matches Apple's
    // measured timings (see research report).
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
      self?.startDeleteRepeat()
    }
    // Selection haptic on first press so touch-down feels alive even when the
    // repeat hasn't kicked in yet.
    fireKeyHaptic()
  }

  private func startDeleteRepeat() {
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.09, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      self.deleteRepeatCount += 1
      if self.deleteRepeatCount > 20 {
        // Word-boundary delete: back to the last whitespace/newline.
        self.deleteWordBoundary()
      } else {
        self.host?.hostTextDocumentProxy.deleteBackward()
      }
    }
  }

  private func deleteWordBoundary() {
    guard let p = host?.hostTextDocumentProxy else { return }
    var deleted = 0
    while deleted < 64 {
      let ctx = p.documentContextBeforeInput ?? ""
      guard let last = ctx.last else { break }
      p.deleteBackward()
      deleted += 1
      if last.isWhitespace || last.isNewline { break }
    }
  }

  @objc private func deleteUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
    deleteRepeatCount = 0
    updateAutoCap()
  }

  /// Globe key — advances to next input mode (system behavior). Long-press
  /// falls through to a `showLanguageMenu` action if `on.onLongPress` is set.
  private func buildGlobeKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "globe"), for: .normal)
    btn.tintColor = keyTextColor()
    let action = UIAction { [weak self] _ in self?.host?.hostAdvanceInputMode() }
    btn.addAction(action, for: .touchUpInside)
    if let long = node.on?["onLongPress"] {
      let lp = UILongPressGestureRecognizer(
        target: self, action: #selector(longPressFired(_:)))
      lp.name = "kb.longPress.action"
      btn.addGestureRecognizer(lp)
      objc_setAssociatedObject(lp, &Self.longPressActionKey, long, .OBJC_ASSOCIATION_RETAIN)
    }
    return btn
  }
  private static var longPressActionKey: UInt8 = 0
  @objc private func longPressFired(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began else { return }
    if let ref = objc_getAssociatedObject(gr, &Self.longPressActionKey) as? KBActionRef {
      run(ref)
    }
  }

  /// Mic key — toggles startDictation / stopDictation based on state.dictating.
  /// Idle: shows the Tulmi brand mark (bundled asset "TailzuMark" — the actual
  /// voice button, not the generic SF Symbol mic). Recording: switches to
  /// stop.fill so the state is unmistakable. If the bundled image is missing
  /// for any reason we fall back to the SF Symbol so the key is never blank.
  private func buildMicKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    if state.dictating {
      btn.setImage(UIImage(systemName: "stop.fill"), for: .normal)
      btn.tintColor = keyTextColor()
    } else if let mark = UIImage(named: "TailzuMark", in: Bundle.main, compatibleWith: nil) {
      // Render the mark as a template so keyTextColor tints it — the asset is
      // a monochrome shape, and template rendering makes it match the same
      // white/black the surrounding icons use in dark vs light appearance.
      btn.setImage(mark.withRenderingMode(.alwaysTemplate), for: .normal)
      btn.tintColor = keyTextColor()
      // The bundled asset is ~1024px; UIButton scales to fit. Nudge it a hair
      // smaller than the SF Symbol so the mark reads as an icon, not a splash.
      btn.imageEdgeInsets = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
    } else {
      btn.setImage(UIImage(systemName: "mic.fill"), for: .normal)
      btn.tintColor = keyTextColor()
    }
    let action = UIAction { [weak self] _ in
      guard let self = self else { return }
      if self.state.dictating {
        self.run(.inline(.stopDictation))
      } else {
        self.run(.inline(.startDictation))
      }
    }
    btn.addAction(action, for: .touchUpInside)
    return btn
  }

  /// Refine key — dispatches runRefine.
  private func buildRefineKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    btn.setImage(UIImage(systemName: "sparkles"), for: .normal)
    btn.tintColor = keyTextColor()
    let action = UIAction { [weak self] _ in self?.run(.inline(.runRefine)) }
    btn.addAction(action, for: .touchUpInside)
    return btn
  }

  /// Suggestion bar — horizontal scroll of chip buttons from state.suggestions.
  /// Empty until backend fills it; view is still laid out (fixed height).
  private func buildSuggestionBar(node: KBNode) -> UIView {
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = 8
    row.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(row)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: 8),
      row.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -8),
      row.topAnchor.constraint(equalTo: scroll.topAnchor),
      row.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
      row.heightAnchor.constraint(equalTo: scroll.heightAnchor),
    ])
    for s in state.suggestions {
      let chip = UIButton(type: .system)
      chip.setTitle(s, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.backgroundColor = keyBgColor()
      chip.layer.cornerRadius = 12
      chip.contentEdgeInsets = UIEdgeInsets(top: 4, left: 12, bottom: 4, right: 12)
      let action = UIAction { [weak self] _ in
        self?.host?.hostTextDocumentProxy.insertText(s + " ")
      }
      chip.addAction(action, for: .touchUpInside)
      row.addArrangedSubview(chip)
    }
    scroll.heightAnchor.constraint(equalToConstant: 36).isActive = true
    return scroll
  }

  /// Waveform bars — driven by a 30 FPS Timer modulating bar heights from
  /// state.micLevel with a random baseline (matches the RN counterpart).
  private func buildWaveform(node: KBNode) -> UIView {
    let w = WaveformView()
    w.tintColor = keyTextColor()
    w.setLevel(state.micLevel)
    if waveformTimer == nil {
      waveformTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) {
        [weak self] _ in
        self?.waveformView?.setLevel(self?.state.micLevel ?? 0)
      }
    }
    waveformView = w
    return w
  }

  /// Bound to state.status — updated whenever the host reflects setStatus().
  private func buildStatusLabel(node: KBNode) -> UIView {
    let l = UILabel()
    l.text = state.status
    l.textAlignment = .center
    l.font = .systemFont(ofSize: 12)
    l.textColor = keyTextColor()
    l.isHidden = state.status.isEmpty
    return l
  }

  /// 1pt hairline divider.
  private func buildDivider(node: KBNode) -> UIView {
    let v = UIView()
    v.backgroundColor = UIColor(white: 1, alpha: 0.08)
    v.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale).isActive = true
    return v
  }

  /// Blur backdrop wrapping the children — UIVisualEffectView with the mapped
  /// UIBlurEffect.Style from the node's effect.
  private func buildBlurBackdrop(node: KBNode) -> UIView {
    let style = blurStyle(from: node.effect ?? .blur(style: "systemThinMaterial"))
    let effectView = UIVisualEffectView(effect: UIBlurEffect(style: style))
    // Children mount inside the effect view's contentView so they render above
    // the blur, not underneath it.
    let stack = UIStackView()
    stack.axis = .vertical
    stack.alignment = .fill
    stack.spacing = CGFloat(node.style?["spacing"]?.asDouble ?? 0)
    stack.translatesAutoresizingMaskIntoConstraints = false
    for c in node.children ?? [] {
      stack.addArrangedSubview(render(node: c))
    }
    effectView.contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor),
      stack.topAnchor.constraint(equalTo: effectView.contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor),
    ])
    return effectView
  }

  /// Placeholder for unknown component types — a small red view labeled "?"
  /// so schema mismatches show up on screen instead of silently disappearing.
  private func buildUnknown(type: String) -> UIView {
    NSLog("unknown kb component: %@", type)
    let v = UIView()
    v.backgroundColor = .red
    let l = UILabel()
    l.text = "?"
    l.textColor = .white
    l.textAlignment = .center
    l.font = .boldSystemFont(ofSize: 14)
    l.translatesAutoresizingMaskIntoConstraints = false
    v.addSubview(l)
    NSLayoutConstraint.activate([
      l.leadingAnchor.constraint(equalTo: v.leadingAnchor),
      l.trailingAnchor.constraint(equalTo: v.trailingAnchor),
      l.topAnchor.constraint(equalTo: v.topAnchor),
      l.bottomAnchor.constraint(equalTo: v.bottomAnchor),
    ])
    v.widthAnchor.constraint(greaterThanOrEqualToConstant: 30).isActive = true
    v.heightAnchor.constraint(greaterThanOrEqualToConstant: 20).isActive = true
    return v
  }

  // MARK: - Style + effect resolvers

  /// Apply the node's `style` bag: sizes, insets, radius, colors, font.
  /// Unknown keys are ignored so extending the schema doesn't crash old builds.
  private func applyStyle(node: KBNode, to view: UIView) {
    guard let style = node.style else { return }
    if let w = style["width"]?.asCGFloat {
      view.widthAnchor.constraint(equalToConstant: w).isActive = true
    }
    if let h = style["height"]?.asCGFloat {
      view.heightAnchor.constraint(equalToConstant: h).isActive = true
    }
    if let radius = style["radius"]?.asCGFloat {
      view.layer.cornerRadius = radius
      view.clipsToBounds = true
    }
    if let bg = style["bg"]?.asString {
      view.backgroundColor = UIColor(tulmiHex: bg)
    }
    if let stack = view as? UIStackView {
      // Per-side padding: layoutMargins with individual insets. Uniform
      // `padding` still works as the fallback when specific sides aren't set.
      let pad = style["padding"]?.asCGFloat
      let padTop = style["paddingTop"]?.asCGFloat ?? pad
      let padBottom = style["paddingBottom"]?.asCGFloat ?? pad
      let padLeft = style["paddingLeft"]?.asCGFloat ?? pad
      let padRight = style["paddingRight"]?.asCGFloat ?? pad
      if padTop != nil || padBottom != nil || padLeft != nil || padRight != nil {
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(
          top: padTop ?? 0,
          left: padLeft ?? 0,
          bottom: padBottom ?? 0,
          right: padRight ?? 0,
        )
      }
      // flex on the stack itself no longer forces fillEqually — the parent
      // buildStack now applies proportional widthAnchor multipliers per-child
      // based on their flex ratio. fillEqually would blow that away.
    }
    if let btn = view as? UIButton {
      if let fg = style["fg"]?.asString {
        btn.setTitleColor(UIColor(tulmiHex: fg), for: .normal)
      }
      if let fs = style["fontSize"]?.asCGFloat {
        let weight = fontWeight(from: style["fontWeight"]?.asString)
        btn.titleLabel?.font = .systemFont(ofSize: fs, weight: weight)
      }
    }
    if let lbl = view as? UILabel {
      if let fg = style["fg"]?.asString { lbl.textColor = UIColor(tulmiHex: fg) }
      if let fs = style["fontSize"]?.asCGFloat {
        let weight = fontWeight(from: style["fontWeight"]?.asString)
        lbl.font = .systemFont(ofSize: fs, weight: weight)
      }
    }
    // `flex` on a Spacer / leaf → let it grow inside a stack.
    if let flex = style["flex"]?.asDouble, flex > 0 {
      view.setContentHuggingPriority(.defaultLow, for: .horizontal)
      view.setContentHuggingPriority(.defaultLow, for: .vertical)
    }
  }

  private func fontWeight(from raw: String?) -> UIFont.Weight {
    switch (raw ?? "").lowercased() {
    case "ultralight": return .ultraLight
    case "thin":       return .thin
    case "light":      return .light
    case "regular":    return .regular
    case "medium":     return .medium
    case "semibold":   return .semibold
    case "bold":       return .bold
    case "heavy":      return .heavy
    case "black":      return .black
    default:           return .regular
    }
  }

  /// Apply node.effect to a view. Solid → backgroundColor, gradient →
  /// CAGradientLayer, blur → underlaid effect view. For nodes with children
  /// the effect view sits at subview index 0 so children render above it —
  /// UIStackView still lays out its arrangedSubviews on top.
  private func applyEffectIfChildlessBackdrop(node: KBNode, view: UIView) {
    guard let effect = node.effect else { return }
    switch effect {
    case .solid(let color):
      view.backgroundColor = UIColor(tulmiHex: color)
    case .gradient(let colors, let direction):
      // Wrap in the GradientView subclass (same one used by makeEffectBackdrop)
      // so the CAGradientLayer resizes via layoutSubviews. Raw CALayer
      // autoresizing masks are Mac-only — iOS refuses them.
      let g = GradientView()
      g.gradientColors = colors.map { UIColor(tulmiHex: $0).cgColor }
      g.horizontal = (direction == "horizontal")
      g.translatesAutoresizingMaskIntoConstraints = false
      view.insertSubview(g, at: 0)
      NSLayoutConstraint.activate([
        g.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        g.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        g.topAnchor.constraint(equalTo: view.topAnchor),
        g.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
      view.layer.masksToBounds = true
    case .blur(let style):
      let blur = UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(style)))
      blur.translatesAutoresizingMaskIntoConstraints = false
      view.insertSubview(blur, at: 0)
      NSLayoutConstraint.activate([
        blur.leadingAnchor.constraint(equalTo: view.leadingAnchor),
        blur.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        blur.topAnchor.constraint(equalTo: view.topAnchor),
        blur.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      ])
    }
  }

  private func makeEffectBackdrop(effect: KBEffect) -> UIView {
    switch effect {
    case .solid(let color):
      let v = UIView()
      v.backgroundColor = UIColor(tulmiHex: color)
      return v
    case .blur(let style):
      return UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(style)))
    case .gradient(let colors, let direction):
      let host = GradientView()
      host.gradientColors = colors.map { UIColor(tulmiHex: $0).cgColor }
      host.horizontal = direction == "horizontal"
      return host
    }
  }

  /// Map the schema's KeyboardEffect.blur.style enum to UIBlurEffect.Style.
  private func mapBlur(_ raw: String) -> UIBlurEffect.Style {
    switch raw {
    case "chromeMaterialDark":     return .systemChromeMaterialDark
    case "chromeMaterialLight":    return .systemChromeMaterialLight
    case "systemThinMaterial":     return .systemThinMaterial
    case "systemUltraThinMaterial": return .systemUltraThinMaterial
    case "regular":                return .regular
    default:                       return .systemThinMaterial
    }
  }

  private func blurStyle(from effect: KBEffect) -> UIBlurEffect.Style {
    if case .blur(let s) = effect { return mapBlur(s) }
    return .systemThinMaterial
  }

  // MARK: - Key styling helpers

  /// A generic button matching the hand-built path's default look; overridden
  /// by node-level `style`. Handles:
  ///   - Base fill + shadow + radius from theme
  ///   - Optional per-key blur from theme.keyEffect
  ///   - Press-down visual highlight (Apple's inversion swap) via touch handlers
  ///   - Sound + haptic on touch-down (Full Access gated)
  private func makeKeyButton() -> UIButton {
    let b = UIButton(type: .system)
    b.setTitleColor(keyTextColor(), for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 18)
    let base = keyBgColor()
    b.backgroundColor = base
    b.layer.cornerRadius = CGFloat(theme?.keyRadius ?? 5)
    if theme?.keyShadow == true {
      b.layer.shadowColor = UIColor.black.cgColor
      b.layer.shadowOffset = CGSize(width: 0, height: 1)
      b.layer.shadowRadius = 0
      b.layer.shadowOpacity = 0.4
    }
    // If the theme carries a keyEffect blur, drop it under the button.
    if case .blur(let s) = theme?.keyEffect ?? .solid(color: "#00000000") {
      let blur = UIVisualEffectView(effect: UIBlurEffect(style: mapBlur(s)))
      blur.translatesAutoresizingMaskIntoConstraints = false
      blur.layer.cornerRadius = b.layer.cornerRadius
      blur.clipsToBounds = true
      b.insertSubview(blur, at: 0)
      NSLayoutConstraint.activate([
        blur.leadingAnchor.constraint(equalTo: b.leadingAnchor),
        blur.trailingAnchor.constraint(equalTo: b.trailingAnchor),
        blur.topAnchor.constraint(equalTo: b.topAnchor),
        blur.bottomAnchor.constraint(equalTo: b.bottomAnchor),
      ])
      b.backgroundColor = .clear
    }
    // Press feedback (visual + sound + haptic). Firing on touchDown so the key
    // feels alive at the moment of contact — Apple's exact behavior.
    b.addTarget(self, action: #selector(keyTouchDown(_:)), for: .touchDown)
    b.addTarget(self, action: #selector(keyTouchUp(_:)),
                for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    // Remember the resting background so touchUp can restore it after the
    // inversion swap. Uses associated object so per-instance color survives
    // across renderer rebuilds.
    objc_setAssociatedObject(b, &Self.keyBaseColorKey, base, .OBJC_ASSOCIATION_RETAIN)
    return b
  }

  private static var keyBaseColorKey: UInt8 = 0
  private static var keyPressedColorKey: UInt8 = 0

  @objc private func keyTouchDown(_ btn: UIButton) {
    // Apple's inversion: letter keys press to function color, function keys
    // press to letter color. We don't know which side a key is on, so use
    // theme.keyPressed if present, else lighten the base color.
    let pressed: UIColor
    if let hex = theme?.keyPressed {
      pressed = UIColor(tulmiHex: hex)
    } else {
      pressed = UIColor(white: 0.5, alpha: 0.3)
    }
    btn.backgroundColor = pressed
    objc_setAssociatedObject(btn, &Self.keyPressedColorKey, pressed, .OBJC_ASSOCIATION_RETAIN)
    // System input-click sound. Only plays when the extension conforms to
    // UIInputViewAudioFeedback (see KeyboardViewController extension) AND the
    // user has "Keyboard Feedback → Sound" on in Settings — otherwise silent.
    UIDevice.current.playInputClick()
    fireKeyHaptic()
  }

  @objc private func keyTouchUp(_ btn: UIButton) {
    let base = (objc_getAssociatedObject(btn, &Self.keyBaseColorKey) as? UIColor) ?? keyBgColor()
    btn.backgroundColor = base
  }

  /// Selection-changed haptic on every key. Requires Full Access to fire; the
  /// generator silently no-ops without it. Cheaper than instantiating a new
  /// generator per tap.
  private var selectionGenerator: UISelectionFeedbackGenerator?
  fileprivate func fireKeyHaptic() {
    guard host?.hostHasFullAccess == true else { return }
    if selectionGenerator == nil { selectionGenerator = UISelectionFeedbackGenerator() }
    selectionGenerator?.selectionChanged()
    selectionGenerator?.prepare() // pre-cache the next one
  }

  private func keyBgColor() -> UIColor {
    if let key = theme?.key { return UIColor(tulmiHex: key) }
    return UIColor(red: 0.11, green: 0.11, blue: 0.15, alpha: 1)
  }
  private func keyTextColor() -> UIColor {
    if let t = theme?.keyText { return UIColor(tulmiHex: t) }
    return .white
  }

  // MARK: - Tap binding

  /// Attach the primary tap handler for a component. Priority: an explicit
  /// `on.onPress` action wins; otherwise fall back to the component's default.
  private func bindTap(_ btn: UIButton, node: KBNode, defaultAction: KBActionSpec?) {
    if let ref = node.on?["onPress"] {
      let action = UIAction { [weak self] _ in self?.run(ref) }
      btn.addAction(action, for: .touchUpInside)
    } else if let def = defaultAction {
      let action = UIAction { [weak self] _ in self?.run(.inline(def)) }
      btn.addAction(action, for: .touchUpInside)
    }
  }

  // MARK: - Action interpreter

  /// Resolve a KBActionRef (string alias or inline spec) into a KBActionSpec.
  /// String aliases are looked up in the top-level `config.actions` map.
  private func resolve(_ ref: KBActionRef) -> KBActionSpec? {
    switch ref {
    case .inline(let spec): return spec
    case .named(let name):  return config.actions?[name]
    }
  }

  /// Run an action ref through the interpreter switch. All side-effecting
  /// user gestures land here.
  func run(_ ref: KBActionRef) {
    guard let spec = resolve(ref) else { return }
    let proxy = host?.hostTextDocumentProxy
    switch spec {
    case .insertText(let text):
      proxy?.insertText(applySmartPunctuation(text))
      updateAutoCap()
    case .insertKey(let char):
      proxy?.insertText(applySmartPunctuation(char))
      if state.shift && !state.capsLock {
        state.shift = false
        stateChanged()
      }
      updateAutoCap()
    case .deleteBackward:
      proxy?.deleteBackward()
      updateAutoCap()
    case .deleteWord:
      guard let p = proxy else { return }
      // Delete back until a whitespace/newline or the document is empty.
      // Bounded to avoid pathological loops on unusual editors.
      var deleted = 0
      while deleted < 1000 {
        let ctx = p.documentContextBeforeInput ?? ""
        guard let last = ctx.last else { break }
        p.deleteBackward()
        deleted += 1
        if last.isWhitespace || last.isNewline { break }
      }
    case .shift:
      state.shift.toggle()
      stateChanged()
    case .capsLock:
      state.capsLock.toggle()
      state.shift = state.capsLock ? true : state.shift
      stateChanged()
    case .returnKey:
      proxy?.insertText("\n")
    case .switchLayout(let language):
      let langs = (config.layouts ?? []).map { $0.language }
      if let target = language, langs.contains(target) {
        state.layoutId = target
      } else if !langs.isEmpty {
        let idx = langs.firstIndex(of: state.layoutId) ?? -1
        state.layoutId = langs[(idx + 1) % langs.count]
      }
      stateChanged()
    case .showLanguageMenu:
      presentLanguageMenu()
    case .startDictation:
      state.dictating = true
      stateChanged()
      host?.hostStartDictation()
    case .stopDictation:
      state.dictating = false
      stateChanged()
      host?.hostStopDictation()
    case .runRefine:
      state.refining = true
      stateChanged()
      host?.hostRunRefine()
    case .cycleTone:
      // Cycle through the tones list — either the backend-provided list at
      // config.flags["kb.tones"] or the shipped default set. Result stored
      // in state.tone; the SDUI tools bar rebinds on remount.
      let tones = configuredTones()
      let idx = tones.firstIndex(of: state.tone) ?? -1
      state.tone = tones[(idx + 1) % max(1, tones.count)]
      stateChanged()
      // Publish to the shared App Group so the main app can pick up the
      // current tone selection when it needs to (e.g. for the tone-based
      // refine prompt).
      let d = UserDefaults(suiteName: "group.com.tulmi.app")
      d?.set(state.tone, forKey: "tulmi.kb.tone")
      fireKeyHaptic()
    case .openApp(let screenId):
      // Apple restricts NSExtensionContext.open to Today extensions; keyboard
      // extensions cannot launch URLs directly. We drop a tombstone in the
      // shared App Group and the main app picks it up on next foreground.
      let target = (screenId?.isEmpty == false) ? "screen/\(screenId!)" : ""
      writeDeepLinkTombstone(path: target)
    case .openSettings:
      // Same restriction — tombstone with a well-known path that the app
      // routes to `openSettings()` on foreground.
      writeDeepLinkTombstone(path: "openSettings")
    case .haptic(let style):
      fireHaptic(style)
    case .sequence(let actions):
      for a in actions { run(a) }
    case .condition(let cond, let thenA, let elseA):
      if evaluate(cond) { run(thenA) }
      else if let e = elseA { run(e) }
    case .unknown(let kind):
      NSLog("unknown kb action: %@", kind)
    }
  }

  private func fireHaptic(_ style: String) {
    switch style {
    case "light":
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    case "medium":
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    case "heavy":
      UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
    case "selection":
      UISelectionFeedbackGenerator().selectionChanged()
    case "success":
      UINotificationFeedbackGenerator().notificationOccurred(.success)
    case "warning":
      UINotificationFeedbackGenerator().notificationOccurred(.warning)
    case "error":
      UINotificationFeedbackGenerator().notificationOccurred(.error)
    default:
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
  }

  // MARK: - Auto-capitalization

  /// Called after every insert / delete. Reads the text before the cursor and
  /// arms state.shift when the next character is at a sentence boundary:
  ///   - field start (nothing before cursor)
  ///   - immediately after ". " or "? " or "! " or newline
  /// Respects the field's autocapitalizationType — off entirely on URL /
  /// email / password fields, .allCharacters keeps shift on always,
  /// .words fires on every word boundary.
  private func updateAutoCap() {
    guard let host = host else { return }
    let mode = host.hostAutocapitalizationType()
    if mode == .none { return }
    let ctx = host.hostTextDocumentProxy.documentContextBeforeInput ?? ""
    let shouldCap: Bool
    switch mode {
    case .allCharacters:
      shouldCap = true
    case .words:
      shouldCap = ctx.isEmpty || (ctx.last?.isWhitespace ?? true)
    case .sentences:
      if ctx.isEmpty { shouldCap = true }
      else {
        // Look back past trailing whitespace, then check the last non-space
        // for a sentence-ending mark.
        let trimmed = ctx.reversed().drop(while: { $0.isWhitespace })
        let hadSpace = ctx.count != trimmed.count
        if let last = trimmed.first {
          shouldCap = hadSpace && (last == "." || last == "?" || last == "!" || last == "\n")
        } else {
          shouldCap = true
        }
      }
    @unknown default:
      shouldCap = false
    }
    if state.capsLock { return } // caps lock wins; don't fight the user
    if shouldCap != state.shift {
      state.shift = shouldCap
      stateChanged()
    }
  }

  // MARK: - Smart punctuation

  /// Server-controlled toggle key. When flags["kb.smartPunctuation"] is truthy
  /// (default), we run typed characters through this cleaner:
  ///   `"` → curly quote (open/close by odd/even count in the buffer)
  ///   `--` → em-dash (delete the trailing "-" first)
  ///   `...` → single ellipsis codepoint (delete the trailing ".." first)
  /// Everything else passes through untouched.
  private func applySmartPunctuation(_ text: String) -> String {
    let on: Bool = {
      if let f = config.flags?["kb.smartPunctuation"]?.asBool { return f }
      return true
    }()
    guard on, text.count == 1 else { return text }
    let ch = text.first!
    guard let proxy = host?.hostTextDocumentProxy else { return text }
    let ctx = proxy.documentContextBeforeInput ?? ""
    switch ch {
    case "\"":
      // Toggle straight → curly. Count existing straight " in the paragraph
      // is unreliable; simplest heuristic: last char is a word char → close.
      let last = ctx.last
      if last == nil || last?.isWhitespace == true || last == "\n" { return "\u{201C}" }
      return "\u{201D}"
    case "'":
      let last = ctx.last
      if last == nil || last?.isWhitespace == true || last == "\n" { return "\u{2018}" }
      return "\u{2019}"
    case "-":
      if ctx.hasSuffix("-") {
        proxy.deleteBackward()
        return "\u{2014}" // em-dash
      }
      return text
    case ".":
      if ctx.hasSuffix("..") {
        proxy.deleteBackward()
        proxy.deleteBackward()
        return "\u{2026}" // ellipsis
      }
      return text
    default:
      return text
    }
  }

  /// Write a deep-link target into the shared App Group. The main app checks
  /// UserDefaults(suiteName:)?.string(forKey: "tulmi.kb.pendingDeepLink") on
  /// launch/foreground; if present, it routes to that path and clears the key.
  private func writeDeepLinkTombstone(path: String) {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    d?.set(path, forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
  }

  private func presentLanguageMenu() {
    guard let layouts = config.layouts, !layouts.isEmpty else { return }
    let sheet = UIAlertController(title: host?.hostLabel("language", "Language"),
                                  message: nil,
                                  preferredStyle: .actionSheet)
    for layout in layouts {
      let title = layout.displayName ?? layout.language
      sheet.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in
        self?.run(.inline(.switchLayout(language: layout.language)))
      })
    }
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    // iPad requires a sourceView for action sheets or presentation raises.
    // Anchoring on mountContainer keeps the popover on the keyboard surface.
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = mountContainer
      popover.sourceRect = CGRect(
        x: (mountContainer?.bounds.midX ?? 0),
        y: (mountContainer?.bounds.midY ?? 0),
        width: 0, height: 0,
      )
      popover.permittedArrowDirections = []
    }
    host?.hostPresent(sheet)
  }

  // MARK: - Condition evaluator

  /// Evaluate a KBCondition against KBState + config.flags. Mirrors the shape
  /// used by the RN evaluator so backend authors write the same conditions.
  func evaluate(_ cond: KBCondition) -> Bool {
    switch cond {
    case .eq(let p, let v):   return equal(lookup(p), v)
    case .neq(let p, let v):  return !equal(lookup(p), v)
    case .gt(let p, let v):   return (lookupNumber(p) ?? .nan) > v
    case .gte(let p, let v):  return (lookupNumber(p) ?? .nan) >= v
    case .lt(let p, let v):   return (lookupNumber(p) ?? .nan) < v
    case .lte(let p, let v):  return (lookupNumber(p) ?? .nan) <= v
    case .inList(let p, let vs):
      let l = lookup(p)
      return vs.contains { equal(l, $0) }
    case .contains(let p, let s):
      return (lookupString(p) ?? "").contains(s)
    case .truthy(let p):
      return truthy(lookup(p))
    case .falsy(let p):
      return !truthy(lookup(p))
    case .flag(let name):
      guard let raw = config.flags?[name] else { return false }
      return truthy(raw)
    case .platform(let n):
      return n == "ios"
    case .not(let inner):
      return !evaluate(inner)
    case .all(let cs):
      return cs.allSatisfy { evaluate($0) }
    case .any_(let cs):
      return cs.contains { evaluate($0) }
    case .unknown:
      return false
    }
  }

  /// Read a path like "state.shift" / "flags.betaEnabled" / "config.layoutId"
  /// out of KBState and config.flags.
  private func lookup(_ path: String) -> KBJSON {
    let parts = path.split(separator: ".").map(String.init)
    guard let head = parts.first else { return .null }
    switch head {
    case "state":
      let key = parts.dropFirst().joined(separator: ".")
      switch key {
      case "shift":         return .bool(state.shift)
      case "capsLock":      return .bool(state.capsLock)
      case "layoutId":      return .string(state.layoutId)
      case "dictating":     return .bool(state.dictating)
      case "refining":      return .bool(state.refining)
      case "hasFullAccess": return .bool(state.hasFullAccess)
      case "status":        return .string(state.status)
      case "micLevel":      return .number(Double(state.micLevel))
      default:              return .null
      }
    case "flags":
      let key = parts.dropFirst().joined(separator: ".")
      return config.flags?[key] ?? .null
    default:
      return .null
    }
  }
  private func lookupNumber(_ path: String) -> Double? { lookup(path).asDouble }
  private func lookupString(_ path: String) -> String? { lookup(path).asString }

  private func truthy(_ v: KBJSON) -> Bool {
    switch v {
    case .null:               return false
    case .bool(let b):        return b
    case .number(let n):      return n != 0
    case .string(let s):      return !s.isEmpty
    case .array(let a):       return !a.isEmpty
    case .object(let o):      return !o.isEmpty
    }
  }
  private func equal(_ a: KBJSON, _ b: KBJSON) -> Bool {
    switch (a, b) {
    case (.null, .null):                     return true
    case (.bool(let x), .bool(let y)):       return x == y
    case (.number(let x), .number(let y)):   return x == y
    case (.string(let x), .string(let y)):   return x == y
    case (.string(let x), .bool(let y)):     return x == (y ? "true" : "false")
    case (.bool(let x), .string(let y)):     return (x ? "true" : "false") == y
    default: return false
    }
  }

  // MARK: - State reflect (called by host)

  func reflectHasFullAccess(_ v: Bool) {
    if state.hasFullAccess == v { return }
    state.hasFullAccess = v
    stateChanged()
  }
  func reflectStatus(_ s: String) {
    if state.status == s { return }
    state.status = s
    stateChanged()
  }
  func reflectDictating(_ v: Bool) {
    if state.dictating == v { return }
    state.dictating = v
    // Stop the 30 FPS timer when dictation ends so the extension isn't
    // draining CPU/battery for a static bar row. It'll be recreated on the
    // next buildWaveform call when dictation restarts.
    if !v {
      waveformTimer?.invalidate()
      waveformTimer = nil
    }
    stateChanged()
  }
  func reflectRefining(_ v: Bool) {
    if state.refining == v { return }
    state.refining = v
    stateChanged()
  }
  func reflectMicLevel(_ l: CGFloat) {
    state.micLevel = l  // no remount — the display link picks it up
  }

  deinit {
    waveformTimer?.invalidate()
    deleteTimer?.invalidate()
  }
}

// MARK: - Waveform bars view

/// Tiny CADisplayLink-driven bar array. Baseline heights are random per bar so
/// even at zero micLevel the waveform looks alive (matches the RN version).
private final class WaveformView: UIView {
  private var bars: [CALayer] = []
  private var baselines: [CGFloat] = []
  private var level: CGFloat = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    for _ in 0..<24 {
      let l = CALayer()
      l.backgroundColor = UIColor(white: 0.6, alpha: 1).cgColor
      l.cornerRadius = 1.5
      layer.addSublayer(l)
      bars.append(l)
      baselines.append(CGFloat.random(in: 0.2...0.6))
    }
    heightAnchor.constraint(equalToConstant: 24).isActive = true
  }
  required init?(coder: NSCoder) { super.init(coder: coder) }

  override func layoutSubviews() {
    super.layoutSubviews()
    redraw()
  }
  func setLevel(_ l: CGFloat) { level = l; redraw() }

  private func redraw() {
    let W = bounds.width, H = bounds.height
    guard W > 0, H > 0, !bars.isEmpty else { return }
    let n = CGFloat(bars.count)
    let spacing: CGFloat = 3
    let barW = max(1.5, (W - spacing * (n - 1)) / n)
    for (i, l) in bars.enumerated() {
      let jitter = CGFloat.random(in: -0.05...0.05)
      let h = max(2, min(H, H * (baselines[i] + level * 0.6 + jitter)))
      let x = CGFloat(i) * (barW + spacing)
      let y = (H - h) / 2
      l.frame = CGRect(x: x, y: y, width: barW, height: h)
    }
  }
}

// MARK: - Gradient host view

private final class GradientView: UIView {
  var gradientColors: [CGColor] = [] { didSet { setNeedsLayout() } }
  var horizontal: Bool = false      { didSet { setNeedsLayout() } }
  override class var layerClass: AnyClass { CAGradientLayer.self }
  override func layoutSubviews() {
    super.layoutSubviews()
    let g = layer as! CAGradientLayer
    g.colors = gradientColors
    if horizontal {
      g.startPoint = CGPoint(x: 0, y: 0.5); g.endPoint = CGPoint(x: 1, y: 0.5)
    } else {
      g.startPoint = CGPoint(x: 0.5, y: 0); g.endPoint = CGPoint(x: 0.5, y: 1)
    }
  }
}

// MARK: - Config decoder entry point

extension SDUIRenderer {
  /// Decode raw config bytes into a KBConfig. Returns nil on any decode error —
  /// callers fall through to the hand-built path.
  static func decodeConfig(_ data: Data) -> KBConfig? {
    do {
      let dec = JSONDecoder()
      return try dec.decode(KBConfig.self, from: data)
    } catch {
      NSLog("SDUIRenderer.decodeConfig error: %@", "\(error)")
      return nil
    }
  }
}
