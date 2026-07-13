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
  /// True when the user has multiple keyboards enabled (Apple exposes this as
  /// UIInputViewController.needsInputModeSwitchKey). When true, the space bar
  /// shows the current language code (e.g. "EN") like native iOS; when false
  /// it just shows "space".
  func hostNeedsInputModeSwitchKey() -> Bool
  /// Two-letter code of the currently active primary language (e.g. "EN",
  /// "FR"), used as the space bar label when multiple keyboards are enabled.
  /// Falls back to a locale-derived code if the primary language isn't set.
  func hostPrimaryLanguageCode() -> String
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
  // ----- text + editing -----
  case insertText(text: String)
  case insertKey(char: String)
  case deleteBackward
  case deleteWord
  case shift
  case capsLock
  case returnKey

  // ----- layouts + dictation + refine -----
  case switchLayout(language: String?)
  case showLanguageMenu
  case startDictation
  case stopDictation
  case runRefine
  case cycleTone

  // ----- app / system -----
  case openApp(screenId: String?)
  case openSettings
  case openUrl(url: String, external: Bool)

  // ----- feedback -----
  case haptic(style: String)
  case toast(message: String, tone: String)
  case confetti
  case speak(text: String, voice: String?)
  case playMedia(url: String)
  case stopMedia

  // ----- clipboard + share -----
  case copyToClipboard(text: String, toastMessage: String?)
  case readClipboard(assignTo: String)
  case share(text: String?, url: String?, title: String?)

  // ----- state store (backend can mutate state.user.* paths for setState) -----
  case setState(path: String, value: KBJSON)
  case toggleState(path: String)
  case incrementState(path: String, by: Double)
  case clearState(path: String)

  // ----- network + analytics + logging -----
  case callEndpoint(method: String, path: String, body: KBJSON?, assignTo: String?, onSuccess: KBActionRef?, onError: KBActionRef?)
  case analyticsTrack(event: String, props: KBJSON?)
  case log(message: String, level: String)

  // ----- cache + reload -----
  case clearCache
  case reloadApp

  // ----- flow control -----
  case sequence(actions: [KBActionRef])
  case parallel(actions: [KBActionRef])
  case condition(ifCond: KBCondition, then: KBActionRef, elseRef: KBActionRef?)
  case delay(ms: Double)

  // ----- extensibility slot: backend can invoke a named native handler
  // registered via SDUIRenderer.registerExtension(name:handler:). Unknown
  // names are silently ignored so backend can push forward-looking actions
  // that a given client build hasn't wired up yet — no crash, just a no-op.
  case extensionAction(name: String, params: KBJSON?)

  case unknown(kind: String)

  private enum Keys: String, CodingKey {
    case kind, text, char, language, screenId, style, actions, message, tone
    case url, external, voice
    case toastMessage, assignTo, title
    case path, value, by
    case method, body, onSuccess, onError
    case event, props, level, ms
    case name, params
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
    case "openUrl":
      self = .openUrl(
        url: (try? c.decode(String.self, forKey: .url)) ?? "",
        external: (try? c.decode(Bool.self, forKey: .external)) ?? false
      )
    case "haptic":
      self = .haptic(style: (try? c.decode(String.self, forKey: .style)) ?? "light")
    case "toast":
      self = .toast(
        message: (try? c.decode(String.self, forKey: .message)) ?? "",
        tone: (try? c.decode(String.self, forKey: .tone)) ?? "info"
      )
    case "confetti":
      self = .confetti
    case "speak":
      self = .speak(
        text: (try? c.decode(String.self, forKey: .text)) ?? "",
        voice: try? c.decode(String.self, forKey: .voice)
      )
    case "playMedia":
      self = .playMedia(url: (try? c.decode(String.self, forKey: .url)) ?? "")
    case "stopMedia":
      self = .stopMedia
    case "copyToClipboard":
      self = .copyToClipboard(
        text: (try? c.decode(String.self, forKey: .text)) ?? "",
        toastMessage: try? c.decode(String.self, forKey: .toastMessage)
      )
    case "readClipboard":
      self = .readClipboard(assignTo: (try? c.decode(String.self, forKey: .assignTo)) ?? "")
    case "share":
      self = .share(
        text: try? c.decode(String.self, forKey: .text),
        url: try? c.decode(String.self, forKey: .url),
        title: try? c.decode(String.self, forKey: .title)
      )
    case "setState":
      self = .setState(
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        value: (try? c.decode(KBJSON.self, forKey: .value)) ?? .null
      )
    case "toggleState":
      self = .toggleState(path: (try? c.decode(String.self, forKey: .path)) ?? "")
    case "incrementState":
      self = .incrementState(
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        by: (try? c.decode(Double.self, forKey: .by)) ?? 1
      )
    case "clearState":
      self = .clearState(path: (try? c.decode(String.self, forKey: .path)) ?? "")
    case "callEndpoint":
      self = .callEndpoint(
        method: (try? c.decode(String.self, forKey: .method)) ?? "GET",
        path: (try? c.decode(String.self, forKey: .path)) ?? "",
        body: try? c.decode(KBJSON.self, forKey: .body),
        assignTo: try? c.decode(String.self, forKey: .assignTo),
        onSuccess: try? c.decode(KBActionRef.self, forKey: .onSuccess),
        onError: try? c.decode(KBActionRef.self, forKey: .onError)
      )
    case "analytics.track":
      self = .analyticsTrack(
        event: (try? c.decode(String.self, forKey: .event)) ?? "",
        props: try? c.decode(KBJSON.self, forKey: .props)
      )
    case "log":
      self = .log(
        message: (try? c.decode(String.self, forKey: .message)) ?? "",
        level: (try? c.decode(String.self, forKey: .level)) ?? "info"
      )
    case "clearCache":
      self = .clearCache
    case "reloadApp":
      self = .reloadApp
    case "sequence":
      self = .sequence(actions: (try? c.decode([KBActionRef].self, forKey: .actions)) ?? [])
    case "parallel":
      self = .parallel(actions: (try? c.decode([KBActionRef].self, forKey: .actions)) ?? [])
    case "condition":
      let cond = try c.decode(KBCondition.self, forKey: .ifCond)
      let thenA = try c.decode(KBActionRef.self, forKey: .then)
      let elseA = try? c.decode(KBActionRef.self, forKey: .elseRef)
      self = .condition(ifCond: cond, then: thenA, elseRef: elseA)
    case "delay":
      self = .delay(ms: (try? c.decode(Double.self, forKey: .ms)) ?? 0)
    case "extension":
      self = .extensionAction(
        name: (try? c.decode(String.self, forKey: .name)) ?? "",
        params: try? c.decode(KBJSON.self, forKey: .params)
      )
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
  case startsWith(path: String, prefix: String)
  case endsWith(path: String, suffix: String)
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
    if let arr = raw["startsWith"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .startsWith(path: p, prefix: s); return
    }
    if let arr = raw["endsWith"]?.asArray, arr.count == 2, let p = arr[0].asString, let s = arr[1].asString {
      self = .endsWith(path: p, suffix: s); return
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
  /// Public so callers (analytics tombstone, arbitrary JSON side-channels) can
  /// convert a KBJSON to a JSON-friendly Any for further processing.
  static func lower(_ v: KBJSON) -> Any {
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
/// Anything readable here is bind-able + visibleIf-able from the backend tree,
/// which is what lets us push changes without rebuilding — the more state we
/// expose, the more the backend can control without a Swift release.
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
  // -------- OS-derived state exposed to the backend tree --------------------
  // These read via bind: { text: "primaryLanguage" } / visibleIf conditions,
  // so backend can drive things like "show EN when multi-keyboard, else space"
  // WITHOUT needing new Swift logic. Kept in sync by reflectFieldContext().
  /// Two-letter primary language code (e.g. "EN"). Follows the active input mode.
  var primaryLanguage: String = "EN"
  /// True when the user has more than one keyboard installed (needsInputModeSwitchKey).
  var hasMultipleKeyboards: Bool = false
  /// Current appearance — "dark" or "light". Follows userInterfaceStyle.
  var appearance: String = "dark"
  // -------- Backend-scratch dict ------------------------------------------
  // Free-form key/value store the backend owns. setState/toggleState/etc.
  // write here; bind + visibleIf read from state.user.<key>. This is what lets
  // backend compose behaviors ("if state.user.mode == 'search' then …") without
  // needing new Swift for every new flag.
  var user: [String: KBJSON] = [:]
  // -------- Device / environment (populated at init + refreshed on demand) -
  var deviceModel: String = ""
  var systemVersion: String = ""
  var isNetworkReachable: Bool = true
  var keyboardHeight: CGFloat = 0
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
    self.state.primaryLanguage = controller.hostPrimaryLanguageCode()
    self.state.hasMultipleKeyboards = controller.hostNeedsInputModeSwitchKey()
    self.state.deviceModel = UIDevice.current.model
    self.state.systemVersion = UIDevice.current.systemVersion
    // state.appearance follows the trait collection; can't read here reliably
    // because the controller may not be attached to a window yet.
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
  /// up the new palette. Also syncs state.appearance so backend bind/visibleIf
  /// can key off dark vs light without shipping two Swift builds.
  func appearanceDidChange() {
    state.appearance = currentAppearance == .light ? "light" : "dark"
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
    // If a recording is in progress, the tree we just rebuilt has a fresh
    // tools row that needs to be brought back above the dim overlay, and the
    // emitter's saved emitterPosition points at the OLD mic center (deallocated
    // with the previous tree). Re-anchor both.
    if state.dictating, recordingDimView != nil {
      if let mic = currentMicButton?.superview {
        container.bringSubviewToFront(mic)
      }
      // Move emitter to the new mic position so dots keep flowing from the
      // right place. Only reposition; we don't restart the birthrate.
      if let emitter = dotStreamLayer,
         let mic = currentMicButton, let micSuper = mic.superview {
        emitter.emitterPosition = micSuper.convert(mic.center, to: container)
      }
    }
  }

  /// Public hook — actions call this after mutating KBState.
  /// Deferred + coalesced remount. Multiple `stateChanged()` calls in the
  /// same runloop collapse to a single rebuild scheduled on the next tick,
  /// so touch handlers (insertText, delete, shift toggle, autocap arm) return
  /// immediately instead of blocking on the full tree teardown/rebuild. That
  /// blocking rebuild was the root of the "touch delay" — on complex trees
  /// each remount cost 30-80ms and fired synchronously inside the tap
  /// handler; iOS therefore didn't process the next tap until the rebuild
  /// finished. This coalesced-async model completes the current tap first,
  /// commits the character to the field, THEN rebuilds visuals.
  private var pendingRemount: Bool = false
  func stateChanged() {
    if pendingRemount { return }
    pendingRemount = true
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.pendingRemount = false
      self.remount()
    }
  }

  // MARK: Root backdrop

  /// The theme's `backgroundEffect` sits on the container itself (not on the
  /// root node) so blur / gradient covers the whole keyboard area.
  ///
  /// IMPORTANT: we do NOT paint container.backgroundColor from theme.background
  /// as an opaque layer — that was making the blur backdrop useless (it was
  /// frosting a solid black rectangle instead of the OS keyboard region behind
  /// it). Native iOS keyboards let the underlying region show through the blur
  /// so keys read as "floating on frosted glass" instead of sitting on a slab.
  /// theme.background is kept as a *fallback* color, applied only when no
  /// backgroundEffect is set — that way older client builds without the blur
  /// still get a solid backdrop.
  private func applyRootBackground(to container: UIView) {
    if theme?.backgroundEffect == nil, let bg = theme?.background {
      container.backgroundColor = UIColor(tulmiHex: bg)
    } else {
      container.backgroundColor = .clear
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
    // Generic components — every one of these means "backend can add richer UI
    // without shipping new Swift." Keep additions here in sync with buildXxx.
    case "TextLabel":            v = buildTextLabel(node: node)
    case "Image":                v = buildImageNode(node: node)
    case "ProgressBar":          v = buildProgressBar(node: node)
    case "Toggle":               v = buildToggleNode(node: node)
    case "ScrollView":           v = buildScrollView(node: node)
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
    // Tone pill registration for the dictation dot stream — the pill is the
    // one LetterKey whose bind.content resolves to the "tone" state field, so
    // this identifies it uniquely without a per-node id.
    if node.bind?["content"] == "tone" {
      currentToneButton = btn
    }
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
      // Backend flag: kb.accentTray.longPressMs (default 500) — hold-to-open threshold
      lp.minimumPressDuration = flagDouble("kb.accentTray.longPressMs", 500) / 1000.0
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
  /// Every case here is a "backend can drive this without a rebuild" hook.
  private func stateValue(for key: String) -> String? {
    switch key {
    case "tone":                 return state.tone
    case "status":               return state.status
    case "layoutId":             return state.layoutId
    case "primaryLanguage":      return state.primaryLanguage
    case "appearance":           return state.appearance
    case "hasMultipleKeyboards": return state.hasMultipleKeyboards ? "true" : "false"
    case "hasFullAccess":        return state.hasFullAccess ? "true" : "false"
    case "dictating":            return state.dictating ? "true" : "false"
    case "refining":             return state.refining ? "true" : "false"
    case "shift":                return state.shift ? "true" : "false"
    case "capsLock":             return state.capsLock ? "true" : "false"
    default:                     return nil
    }
  }

  // MARK: - Backend-tunable flags (with sane defaults)
  //
  // Every visual constant we add gets a `flag*` accessor so backend can push
  // a config.flags[<key>] override without a native rebuild. Unset → default.
  //
  // Convention: dot.notation keys under "kb.*". Grouped by feature so backend
  // devs can find them.

  private func flagString(_ key: String, _ def: String) -> String {
    config.flags?[key]?.asString ?? def
  }
  private func flagDouble(_ key: String, _ def: Double) -> Double {
    config.flags?[key]?.asDouble ?? def
  }
  private func flagCGFloat(_ key: String, _ def: CGFloat) -> CGFloat {
    CGFloat(config.flags?[key]?.asDouble ?? Double(def))
  }
  private func flagBool(_ key: String, _ def: Bool) -> Bool {
    config.flags?[key]?.asBool ?? def
  }
  private func flagColor(_ key: String, _ def: String) -> UIColor {
    UIColor(tulmiHex: flagString(key, def))
  }
  /// Icon-spec flag — resolves to a UIImage via the same resolver used by
  /// IconKey. Backend can pass { sf: "..." } / { asset: "..." } / { url: "..." }
  /// / { emoji: "..." } / string shorthand.
  private func flagIcon(_ key: String) -> KBJSON? {
    config.flags?[key]
  }

  /// SF Symbol font-weight name → UIImage.SymbolWeight.
  fileprivate func sfWeight(_ raw: String) -> UIImage.SymbolWeight {
    switch raw.lowercased() {
    case "thin":     return .thin
    case "light":    return .light
    case "regular":  return .regular
    case "medium":   return .medium
    case "semibold": return .semibold
    case "bold":     return .bold
    case "heavy":    return .heavy
    case "black":    return .black
    default:         return .regular
    }
  }

  // MARK: - Dictation visual overlay
  //
  // Two visual layers ride on top of the keyboard while state.dictating=true:
  //   1. Key dimming — a translucent black overlay dims the letter/function
  //      key rows, focusing attention on the tools row. Tools row is brought
  //      above the overlay so mic + tone stay bright.
  //   2. Dot stream — a CAEmitterLayer positioned at the mic button center,
  //      emitting orange dots that travel across to the tone pill and fade
  //      out along the way, so the tone pill visually "receives" them.
  //
  // On stop (state.dictating flips to false), the emitter's birthRate is
  // zeroed but the layer stays live for ~2.5s so already-airborne dots
  // complete their journey. Rough coincidence: refine RTT is ~2s, so the
  // last dot dissolves about when the refined text lands in the field.

  private weak var currentMicButton: UIButton?
  private weak var currentToneButton: UIButton?
  private var dotStreamLayer: CAEmitterLayer?
  private weak var recordingDimView: UIView?

  private func showRecordingVisuals() {
    // Wait for the remount that stateChanged() scheduled — that's where
    // currentMicButton / currentToneButton get set. Async on main gets us the
    // next runloop tick, by which point the new tree is mounted.
    // Guard against a race: if dictation stopped between reflectDictating(true)
    // and this block running, don't create visuals at all.
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.state.dictating else { return }
      self.applyKeyDimming()
      self.startDotStream()
    }
  }

  private func hideRecordingVisuals() {
    fadeOutDotStream()
    removeKeyDimming()
  }

  private func applyKeyDimming() {
    // Backend flags:
    //   kb.dictation.dim.enabled  (default true)  — set false to skip the dim entirely
    //   kb.dictation.dim.color    (default "#000000")
    //   kb.dictation.dim.alpha    (default 0.45)  — 0..1 opacity of the dim overlay
    //   kb.dictation.dim.fadeMs   (default 250)   — fade-in duration
    guard flagBool("kb.dictation.dim.enabled", true) else { return }
    guard let container = mountContainer, recordingDimView == nil else { return }
    let dim = UIView()
    dim.translatesAutoresizingMaskIntoConstraints = false
    dim.backgroundColor = flagColor("kb.dictation.dim.color", "#000000")
      .withAlphaComponent(flagCGFloat("kb.dictation.dim.alpha", 0.45))
    dim.isUserInteractionEnabled = false
    dim.alpha = 0
    container.addSubview(dim)
    NSLayoutConstraint.activate([
      dim.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      dim.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      dim.topAnchor.constraint(equalTo: container.topAnchor),
      dim.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    if let mic = currentMicButton?.superview { container.bringSubviewToFront(mic) }
    let fadeMs = flagDouble("kb.dictation.dim.fadeMs", 250)
    UIView.animate(withDuration: fadeMs / 1000.0) { dim.alpha = 1 }
    recordingDimView = dim
  }

  private func removeKeyDimming() {
    guard let dim = recordingDimView else { return }
    let fadeMs = flagDouble("kb.dictation.dim.fadeMs", 250)
    UIView.animate(withDuration: fadeMs / 1000.0, animations: { dim.alpha = 0 },
                   completion: { _ in dim.removeFromSuperview() })
    recordingDimView = nil
  }

  private func startDotStream() {
    // Backend flags:
    //   kb.dictation.dots.enabled     (default true)      — skip stream entirely
    //   kb.dictation.dots.color       (default "#FF6B1F")
    //   kb.dictation.dots.size        (default 14)        — px, diameter of the source image
    //   kb.dictation.dots.birthRate   (default 7)         — dots per second
    //   kb.dictation.dots.lifetimeMs  (default 1800)      — how long each dot lives
    //   kb.dictation.dots.spread      (default 0.08)      — rad, emission fan
    //   kb.dictation.dots.velocityJitter (default 0.05)   — fraction of base velocity
    //   kb.dictation.dots.scale       (default 0.35)      — CAEmitterCell scale
    //   kb.dictation.dots.scaleRange  (default 0.1)
    //   kb.dictation.dots.alphaSpeed  (default -0.55)     — /sec, negative fades
    guard flagBool("kb.dictation.dots.enabled", true) else { return }
    guard let container = mountContainer,
          let mic = currentMicButton, let micSuper = mic.superview,
          let tone = currentToneButton, let toneSuper = tone.superview,
          dotStreamLayer == nil else { return }

    let micCenter = micSuper.convert(mic.center, to: container)
    let toneCenter = toneSuper.convert(tone.center, to: container)

    let emitter = CAEmitterLayer()
    emitter.emitterPosition = micCenter
    emitter.emitterShape = .point
    emitter.emitterMode = .points
    container.layer.addSublayer(emitter)

    let cell = CAEmitterCell()
    cell.contents = makeDotImage().cgImage
    cell.birthRate = Float(flagDouble("kb.dictation.dots.birthRate", 7))
    cell.lifetime = Float(flagDouble("kb.dictation.dots.lifetimeMs", 1800) / 1000.0)
    let dx = toneCenter.x - micCenter.x
    let dy = toneCenter.y - micCenter.y
    let distance = sqrt(dx * dx + dy * dy)
    cell.velocity = distance / CGFloat(cell.lifetime)
    cell.velocityRange = distance * flagCGFloat("kb.dictation.dots.velocityJitter", 0.05)
    cell.emissionLongitude = atan2(dy, dx)
    cell.emissionRange = flagCGFloat("kb.dictation.dots.spread", 0.08)
    cell.scale = flagCGFloat("kb.dictation.dots.scale", 0.35)
    cell.scaleRange = flagCGFloat("kb.dictation.dots.scaleRange", 0.1)
    cell.alphaSpeed = Float(flagDouble("kb.dictation.dots.alphaSpeed", -0.55))
    emitter.emitterCells = [cell]
    dotStreamLayer = emitter
  }

  private func fadeOutDotStream() {
    // Backend flag:
    //   kb.dictation.dots.decayMs  (default 2500) — how long the birth-zeroed
    //   emitter stays live so already-airborne dots complete their journey.
    //   Bump to align the last dot's dissolve with typical refine RTT.
    guard let emitter = dotStreamLayer else { return }
    emitter.emitterCells?.forEach { $0.birthRate = 0 }
    let decayMs = flagDouble("kb.dictation.dots.decayMs", 2500)
    let cleanup = DispatchWorkItem { [weak self] in
      self?.dotStreamLayer?.removeFromSuperlayer()
      self?.dotStreamLayer = nil
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + decayMs / 1000.0, execute: cleanup)
  }

  /// A single dot image, sized + colored from backend flags.
  private func makeDotImage() -> UIImage {
    let size = flagCGFloat("kb.dictation.dots.size", 14)
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
    return renderer.image { ctx in
      flagColor("kb.dictation.dots.color", "#FF6B1F").setFill()
      ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: CGSize(width: size, height: size)))
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
          if inside { chip.backgroundColor = flagColor("kb.accentTray.chipActiveBg", "#007AFF") }
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

    // Backend flags:
    //   kb.accentTray.chipWidth      (default 40)
    //   kb.accentTray.chipFontSize   (default 22)
    //   kb.accentTray.chipRadius     (default 6)
    //   kb.accentTray.height         (default 48)
    //   kb.accentTray.offsetY        (default -52) — negative = above the key
    //   kb.accentTray.radius         (default 8)
    //   kb.accentTray.padding        (default 4)
    //   kb.accentTray.gap            (default 4)
    let chipW = flagCGFloat("kb.accentTray.chipWidth", 40)
    let chipFont = flagCGFloat("kb.accentTray.chipFontSize", 22)
    let chipRadius = flagCGFloat("kb.accentTray.chipRadius", 6)
    let trayHeight = flagCGFloat("kb.accentTray.height", 48)
    let trayRadius = flagCGFloat("kb.accentTray.radius", 8)
    let trayPad = flagCGFloat("kb.accentTray.padding", 4)
    let gap = flagCGFloat("kb.accentTray.gap", 4)
    let offsetY = flagCGFloat("kb.accentTray.offsetY", -52)

    let tray = UIStackView()
    tray.axis = .horizontal
    tray.distribution = .fillEqually
    tray.alignment = .fill
    tray.spacing = gap
    tray.translatesAutoresizingMaskIntoConstraints = false
    tray.backgroundColor = keyBgColor()
    tray.layer.cornerRadius = trayRadius
    tray.layer.masksToBounds = true
    tray.isLayoutMarginsRelativeArrangement = true
    tray.layoutMargins = UIEdgeInsets(top: trayPad, left: trayPad, bottom: trayPad, right: trayPad)

    let chipCount = items.count
    let width: CGFloat = CGFloat(chipCount) * chipW + CGFloat(chipCount - 1) * gap + trayPad * 2

    for text in items {
      let chip = UIButton(type: .system)
      chip.setTitle(text, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.titleLabel?.font = .systemFont(ofSize: chipFont, weight: .regular)
      chip.backgroundColor = .clear
      chip.layer.cornerRadius = chipRadius
      chip.isUserInteractionEnabled = false
      tray.addArrangedSubview(chip)
    }

    container.addSubview(tray)
    let anchorFrame = anchor.convert(anchor.bounds, to: container)
    let desiredX = anchorFrame.midX - width / 2
    let clampedX = max(4, min(container.bounds.width - width - 4, desiredX))
    let desiredY = anchorFrame.minY + offsetY
    let clampedY = max(4, desiredY)
    NSLayoutConstraint.activate([
      tray.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: clampedX),
      tray.topAnchor.constraint(equalTo: container.topAnchor, constant: clampedY),
      tray.widthAnchor.constraint(equalToConstant: width),
      tray.heightAnchor.constraint(equalToConstant: trayHeight),
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

  /// Generic icon-bearing key. `props.icon` accepts any of:
  ///   - "sf:name"                     (SF Symbol shorthand)
  ///   - "asset:name"                  (bundled UIImage)
  ///   - "https://…" (or "http://…")   (remote — auto-cached to disk)
  ///   - { sf: "…" } / { asset: "…" } / { url: "…" } / { emoji: "…" }
  ///   - A bare SF Symbol name (backwards compat with older backend trees)
  ///
  /// This is the "end the rebuild cycle" hook — every icon-changing keyboard
  /// tweak is a backend push instead of a Swift release. `on.onPress` carries
  /// the KBActionSpec that fires when tapped (startDictation, insertText,
  /// switchLayout, etc.) so the same node covers mic-like, refine-like, and
  /// arbitrary future buttons.
  private func buildIconKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    let spec = node.props?["icon"]
    // Emoji-as-title path: renders as text so multi-color glyphs display right.
    if let emoji = iconEmoji(spec) {
      btn.setTitle(emoji, for: .normal)
      btn.titleLabel?.font = .systemFont(ofSize: 22)
    } else {
      // Weak-ref the button so the remote-image callback can update it without
      // retaining it beyond the tree lifetime. If a URL fetch completes after
      // the button was already replaced by a re-render, this just no-ops.
      let img = resolveIcon(spec) { [weak btn, weak self] in
        guard let btn = btn else { return }
        btn.setImage(self?.resolveIcon(spec) ?? nil, for: .normal)
      }
      if let img = img {
        btn.setImage(img, for: .normal)
      } else if case .string(let raw) = spec ?? .null,
                !raw.hasPrefix("sf:"), !raw.hasPrefix("asset:"),
                !raw.hasPrefix("http") {
        // Bare "mic.fill"-style names — treat as SF Symbol for compat.
        btn.setImage(UIImage(systemName: raw), for: .normal)
      } else if spec == nil {
        btn.setImage(UIImage(systemName: "questionmark"), for: .normal)
      }
      // Icon tint: prefer node.style.fg override so backend can force a
      // specific icon color (mic on orange bg needs black icon, etc.), fall
      // back to theme's keyText for the general case.
      if let hex = node.style?["fg"]?.asString {
        btn.tintColor = UIColor(tulmiHex: hex)
      } else {
        btn.tintColor = keyTextColor()
      }
      // Optional per-side icon inset so backend can control padding without
      // shipping different assets. Reads props.iconInset (uniform) or
      // props.iconInsetTop/… (per side).
      let uni = node.props?["iconInset"]?.asCGFloat
      let top = node.props?["iconInsetTop"]?.asCGFloat ?? uni ?? 0
      let bot = node.props?["iconInsetBottom"]?.asCGFloat ?? uni ?? 0
      let lef = node.props?["iconInsetLeft"]?.asCGFloat ?? uni ?? 0
      let rig = node.props?["iconInsetRight"]?.asCGFloat ?? uni ?? 0
      if top != 0 || bot != 0 || lef != 0 || rig != 0 {
        btn.imageEdgeInsets = UIEdgeInsets(top: top, left: lef, bottom: bot, right: rig)
      }
    }
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
    // Native iOS shows "space" if only Tulmi is enabled, but the language code
    // (e.g. "EN") if the user has multiple keyboards installed. Read via
    // state.* so this stays consistent with backend bind: { text: "..." } and
    // the two paths never drift out of sync.
    let label: String
    if state.hasMultipleKeyboards, !state.primaryLanguage.isEmpty {
      label = state.primaryLanguage
    } else {
      label = host?.hostLabel("space", "space") ?? "space"
    }
    btn.setTitle(label, for: .normal)
    btn.titleLabel?.font = .systemFont(ofSize: 15)
    // Single-tap insertion is deferred to touchUpInside so slide-off cancels
    // cleanly (Apple's slide-off pattern) — see bindTap.
    let action = UIAction { [weak self] _ in self?.handleSpaceTap() }
    btn.addAction(action, for: .touchUpInside)

    // Backend flags:
    //   kb.trackpad.enabled       (default true) — disable to lose the feature entirely
    //   kb.trackpad.longPressMs   (default 300) — hold-to-activate threshold
    // (sensitivity / pt-per-char is exposed on the .changed handler below.)
    if flagBool("kb.trackpad.enabled", true) {
      let lp = UILongPressGestureRecognizer(target: self, action: #selector(spaceLongPress(_:)))
      lp.minimumPressDuration = flagDouble("kb.trackpad.longPressMs", 300) / 1000.0
      lp.allowableMovement = 1000
      btn.addGestureRecognizer(lp)
    }
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
    // Backend flag: kb.smartPeriod.windowMs (default 500) — max gap between two
    // space taps for the "double-space → period-space" replacement to fire.
    let recent = now - _lastSpaceTapTime < (flagDouble("kb.smartPeriod.windowMs", 500) / 1000.0)
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
      // Backend flag: kb.trackpad.ptPerChar (default 7) — pt of finger drag per
      // one-character cursor step. Higher = less sensitive, easier fine-grained control.
      let raw = Double(cur - _trackpadAnchor) / max(1.0, flagDouble("kb.trackpad.ptPerChar", 7))
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

  /// Shift toggle — modern behavior with directional arrows + hold-to-lock:
  ///
  ///   Visual:
  ///     - state.shift = false     → down arrow (lowercase mode)
  ///     - state.shift = true      → up arrow (uppercase mode)
  ///     - state.capsLock = false  → outlined arrow, key-text color
  ///     - state.capsLock = true   → filled arrow, brand orange (locked)
  ///
  ///   Interaction:
  ///     - Tap (unlocked)  → toggle uppercase/lowercase (one-shot arm/disarm)
  ///     - Hold (unlocked) → lock the current format (persistent)
  ///     - Tap or Hold (locked) → unlock AND flip to the other format
  ///
  ///   Notes:
  ///     - capsLock now means "locked in current shift state", not just
  ///       "uppercase locked" as before. The old (capsLock ⇒ shift=true)
  ///       invariant no longer holds; a locked-in-lowercase state is valid
  ///       and shows as the orange down arrow.
  ///     - Long-press threshold is 0.35s — long enough to distinguish from
  ///       a tap, short enough to feel snappy.
  private func buildShiftKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    applyShiftKeyVisual(btn)
    let handler = UIAction { [weak self] _ in self?.handleShiftTap() }
    btn.addAction(handler, for: .touchUpInside)
    // Long-press → lock (or unlock+flip if already locked).
    let lp = UILongPressGestureRecognizer(target: self, action: #selector(handleShiftLongPress(_:)))
    // Backend flag: kb.shift.longPressMs (default 350) — hold threshold to lock
    lp.minimumPressDuration = flagDouble("kb.shift.longPressMs", 350) / 1000.0
    lp.cancelsTouchesInView = false
    btn.addGestureRecognizer(lp)
    return btn
  }

  /// Set the ShiftKey's image + tint based on current state.
  /// Backend flags:
  ///   kb.shift.iconLowerOutlined  (default "arrowtriangle.down")
  ///   kb.shift.iconUpperOutlined  (default "arrowtriangle.up")
  ///   kb.shift.iconLowerLocked    (default "arrowtriangle.down.fill")
  ///   kb.shift.iconUpperLocked    (default "arrowtriangle.up.fill")
  ///   kb.shift.iconSize           (default 16)      — SF Symbol point size
  ///   kb.shift.iconWeight         (default "semibold")
  ///   kb.shift.lockedColor        (default "#FF6B1F") — arrow tint when locked
  private func applyShiftKeyVisual(_ btn: UIButton) {
    let icon: String = {
      if state.capsLock {
        return state.shift
          ? flagString("kb.shift.iconUpperLocked", "arrowtriangle.up.fill")
          : flagString("kb.shift.iconLowerLocked", "arrowtriangle.down.fill")
      } else {
        return state.shift
          ? flagString("kb.shift.iconUpperOutlined", "arrowtriangle.up")
          : flagString("kb.shift.iconLowerOutlined", "arrowtriangle.down")
      }
    }()
    let size = flagCGFloat("kb.shift.iconSize", 16)
    let weight = sfWeight(flagString("kb.shift.iconWeight", "semibold"))
    let cfg = UIImage.SymbolConfiguration(pointSize: size, weight: weight)
    btn.setImage(UIImage(systemName: icon, withConfiguration: cfg), for: .normal)
    btn.setTitle(nil, for: .normal)
    btn.tintColor = state.capsLock
      ? flagColor("kb.shift.lockedColor", "#FF6B1F")
      : keyTextColor()
    btn.contentHorizontalAlignment = .center
    btn.contentVerticalAlignment = .center
  }

  @objc private func handleShiftLongPress(_ gr: UILongPressGestureRecognizer) {
    guard gr.state == .began else { return }
    if state.capsLock {
      // Locked → unlock + flip (same as tap-while-locked).
      state.capsLock = false
      state.shift.toggle()
    } else {
      // Unlocked → lock the current format without changing shift.
      state.capsLock = true
    }
    lastShiftTapTime = 0
    stateChanged()
    fireKeyHaptic()
  }

  private func handleShiftTap() {
    // Locked state → unlock + flip (both tap and long-press do this).
    if state.capsLock {
      state.capsLock = false
      state.shift.toggle()
      lastShiftTapTime = 0
      stateChanged()
      return
    }
    // Unlocked → toggle uppercase/lowercase mode. No more double-tap-to-caps
    // because hold-to-lock is the new mechanism (feels more discoverable and
    // avoids the accidental double-tap-on-fast-typing problem).
    state.shift.toggle()
    lastShiftTapTime = Date().timeIntervalSince1970
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
      // Backend flags:
      //   kb.returnKey.actionBg   (default "#007AFF") — accent for Go/Send/Search/Done
      //   kb.returnKey.actionFg   (default "#FFFFFF")
      let accent = flagColor("kb.returnKey.actionBg", "#007AFF")
      btn.backgroundColor = accent
      btn.setTitleColor(flagColor("kb.returnKey.actionFg", "#FFFFFF"), for: .normal)
      objc_setAssociatedObject(btn, &Self.keyBaseColorKey, accent, .OBJC_ASSOCIATION_RETAIN)
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
    //
    // Backend flag: kb.delete.initialDelayMs (default 500) — how long the user
    // must hold before the auto-repeat kicks in.
    // CRITICAL: scheduledTimer(withTimeInterval:...) adds to .default runloop
    // mode. While a finger is on the screen iOS switches to .tracking mode
    // and .default timers pause. Add explicitly to .common instead.
    let initialDelay = flagDouble("kb.delete.initialDelayMs", 500) / 1000.0
    let initial = Timer(timeInterval: initialDelay, repeats: false) { [weak self] _ in
      self?.startDeleteRepeat()
    }
    RunLoop.main.add(initial, forMode: .common)
    deleteTimer = initial
    // Selection haptic on first press so touch-down feels alive even when the
    // repeat hasn't kicked in yet.
    fireKeyHaptic()
  }

  private func startDeleteRepeat() {
    // Backend flags:
    //   kb.delete.repeatIntervalMs  (default 90)   — per-char delete cadence
    //   kb.delete.wordAfterChars    (default 20)   — count before word-boundary mode
    // Same .common-mode requirement — see deleteDown for why.
    let intervalMs = flagDouble("kb.delete.repeatIntervalMs", 90) / 1000.0
    let wordThreshold = Int(flagDouble("kb.delete.wordAfterChars", 20))
    let repeatTimer = Timer(timeInterval: intervalMs, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      self.deleteRepeatCount += 1
      if self.deleteRepeatCount > wordThreshold {
        self.deleteWordBoundary()
      } else {
        self.host?.hostTextDocumentProxy.deleteBackward()
      }
    }
    RunLoop.main.add(repeatTimer, forMode: .common)
    deleteTimer = repeatTimer
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
  /// Icon tint respects node.style.fg (backend can override the theme's white
  /// keyText — the tools-row mic uses black-on-orange). Stop-dictation now
  /// auto-fires runRefine so the captured message moves straight into the
  /// refinement pipeline without a second button press.
  ///
  /// The default action wiring here still exists so old backend trees (that
  /// don't specify on.onPress) keep working. New trees can override with
  /// on.onPress: { kind: "condition", ... } for custom flows — see
  /// makeToolsRow() in the backend catalog.
  private func buildMicKey(node: KBNode) -> UIView {
    let btn = makeKeyButton()
    // Register for later access by the dot-stream visualizer during recording.
    // There's only ever one MicKey rendered at a time (dark and light variants
    // are visibleIf-gated), so a single weak ref is safe.
    currentMicButton = btn
    // Icon tint: prefer explicit style.fg override, else keyTextColor().
    let tint: UIColor = {
      if let hex = node.style?["fg"]?.asString { return UIColor(tulmiHex: hex) }
      return keyTextColor()
    }()
    if state.dictating {
      // Backend flags:
      //   kb.mic.recordingIcon        — icon spec (sf/asset/url/emoji)
      //   kb.mic.recordingIconSize    — SF Symbol point size (default 14)
      //   kb.mic.recordingIconWeight  — thin/light/regular/medium/semibold/bold/heavy/black
      //
      // Default: "minus" SF Symbol at 14pt heavy = the thick horizontal bar.
      // Backend can swap to any other icon shape (asset, emoji, remote URL, or
      // a different SF Symbol) without a native rebuild.
      let iconSpec = flagIcon("kb.mic.recordingIcon")
      let size = flagCGFloat("kb.mic.recordingIconSize", 14)
      let weight = sfWeight(flagString("kb.mic.recordingIconWeight", "heavy"))
      let sfCfg = UIImage.SymbolConfiguration(pointSize: size, weight: weight)
      if let spec = iconSpec, let img = resolveIcon(spec, onLoad: { [weak self] in
        self?.stateChanged()
      }) {
        btn.setImage(img.applyingSymbolConfiguration(sfCfg) ?? img, for: .normal)
      } else {
        // Legacy default — thick horizontal bar.
        btn.setImage(UIImage(systemName: "minus", withConfiguration: sfCfg), for: .normal)
      }
    } else if let markSpec = flagIcon("kb.mic.idleIcon") {
      // Backend can also override the idle icon (default = bundled TailzuMark).
      if let img = resolveIcon(markSpec, onLoad: { [weak self] in self?.stateChanged() }) {
        btn.setImage(img, for: .normal)
        // Animated images (GIF/APNG) only loop once the imageView is told to
        // — otherwise UIKit shows the first frame frozen.
        btn.imageView?.startAnimating()
      }
    } else if let mark = UIImage(named: "TailzuMark", in: Bundle.main, compatibleWith: nil) {
      // Default inset is 2pt — the mark reads edge-to-edge on the circular
      // button so the brand is legible. Backend can override with
      // kb.mic.idleIconInset when a specific art needs padding.
      btn.setImage(mark.withRenderingMode(.alwaysTemplate), for: .normal)
      btn.imageView?.contentMode = .scaleAspectFit
      btn.imageEdgeInsets = UIEdgeInsets(
        top: flagCGFloat("kb.mic.idleIconInset", 2),
        left: flagCGFloat("kb.mic.idleIconInset", 2),
        bottom: flagCGFloat("kb.mic.idleIconInset", 2),
        right: flagCGFloat("kb.mic.idleIconInset", 2),
      )
    } else {
      btn.setImage(UIImage(systemName: "mic.fill"), for: .normal)
    }
    btn.tintColor = tint
    // If the backend provided an explicit on.onPress, use that (backend can
    // wire condition + sequence to do "stop then refine" itself). Otherwise
    // fall back to the built-in toggle — WITH auto-refine on stop so the
    // captured text always moves forward regardless of tree shape.
    if let ref = node.on?["onPress"] {
      let action = UIAction { [weak self] _ in self?.run(ref) }
      btn.addAction(action, for: .touchUpInside)
    } else {
      let action = UIAction { [weak self] _ in
        guard let self = self else { return }
        if self.state.dictating {
          // stopDictation → runRefine, so the message auto-flows into refine.
          self.run(.inline(.sequence(actions: [
            .inline(.stopDictation),
            .inline(.runRefine),
          ])))
        } else {
          self.run(.inline(.startDictation))
        }
      }
      btn.addAction(action, for: .touchUpInside)
    }
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
    // Backend flags:
    //   kb.suggestion.gap        (default 8)   — spacing between chips
    //   kb.suggestion.edgeInset  (default 8)   — left/right padding of the scroll region
    //   kb.suggestion.chipRadius (default 12)
    //   kb.suggestion.chipPadV   (default 4)   — vertical padding inside chip
    //   kb.suggestion.chipPadH   (default 12)  — horizontal padding inside chip
    //   kb.suggestion.height     (default 36)
    let gap = flagCGFloat("kb.suggestion.gap", 8)
    let edge = flagCGFloat("kb.suggestion.edgeInset", 8)
    let chipRadius = flagCGFloat("kb.suggestion.chipRadius", 12)
    let chipPadV = flagCGFloat("kb.suggestion.chipPadV", 4)
    let chipPadH = flagCGFloat("kb.suggestion.chipPadH", 12)
    let barHeight = flagCGFloat("kb.suggestion.height", 36)

    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = gap
    row.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(row)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: edge),
      row.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -edge),
      row.topAnchor.constraint(equalTo: scroll.topAnchor),
      row.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
      row.heightAnchor.constraint(equalTo: scroll.heightAnchor),
    ])
    for s in state.suggestions {
      let chip = UIButton(type: .system)
      chip.setTitle(s, for: .normal)
      chip.setTitleColor(keyTextColor(), for: .normal)
      chip.backgroundColor = keyBgColor()
      chip.layer.cornerRadius = chipRadius
      chip.contentEdgeInsets = UIEdgeInsets(top: chipPadV, left: chipPadH, bottom: chipPadV, right: chipPadH)
      let action = UIAction { [weak self] _ in
        self?.host?.hostTextDocumentProxy.insertText(s + " ")
      }
      chip.addAction(action, for: .touchUpInside)
      row.addArrangedSubview(chip)
    }
    scroll.heightAnchor.constraint(equalToConstant: barHeight).isActive = true
    return scroll
  }

  /// Waveform bars — driven by a 30 FPS Timer modulating bar heights from
  /// state.micLevel with a random baseline (matches the RN counterpart).
  private func buildWaveform(node: KBNode) -> UIView {
    // Backend flags:
    //   kb.waveform.barCount        (default 24)
    //   kb.waveform.color           (default "#999999")
    //   kb.waveform.radius          (default 1.5)
    //   kb.waveform.spacing         (default 3)
    //   kb.waveform.height          (default 24)
    //   kb.waveform.levelMultiplier (default 0.6)
    //   kb.waveform.baselineMin     (default 0.2)
    //   kb.waveform.baselineMax     (default 0.6)
    //   kb.waveform.fps             (default 30) — see below
    let cfg = WaveformView.Config(
      barCount: Int(flagDouble("kb.waveform.barCount", 24)),
      barColor: flagColor("kb.waveform.color", "#999999"),
      barRadius: flagCGFloat("kb.waveform.radius", 1.5),
      barSpacing: flagCGFloat("kb.waveform.spacing", 3),
      height: flagCGFloat("kb.waveform.height", 24),
      levelMultiplier: flagCGFloat("kb.waveform.levelMultiplier", 0.6),
      baselineMin: flagCGFloat("kb.waveform.baselineMin", 0.2),
      baselineMax: flagCGFloat("kb.waveform.baselineMax", 0.6),
    )
    let w = WaveformView(config: cfg)
    w.tintColor = keyTextColor()
    w.setLevel(state.micLevel)
    if waveformTimer == nil {
      // Backend flag: kb.waveform.fps (default 30)
      let fps = flagDouble("kb.waveform.fps", 30)
      let t = Timer(timeInterval: 1.0 / max(1.0, fps), repeats: true) { [weak self] _ in
        self?.waveformView?.setLevel(self?.state.micLevel ?? 0)
      }
      RunLoop.main.add(t, forMode: .common)
      waveformTimer = t
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

  // MARK: - Generic node builders (backend can render arbitrary UI)

  /// Free-form text label. Backend controls all of: text (literal via
  /// props.text OR live via bind.text against state.*), font size, weight,
  /// color, alignment, numberOfLines. Kept intentionally generic so a single
  /// node type covers headers, status lines, hints, etc.
  private func buildTextLabel(node: KBNode) -> UIView {
    let l = UILabel()
    l.numberOfLines = Int(node.props?["numberOfLines"]?.asDouble ?? 1)
    let literal = node.props?["text"]?.asString
    if let bound = node.bind?["text"], let val = stateValue(for: bound) {
      l.text = val
    } else {
      l.text = literal
    }
    if let size = node.style?["fontSize"]?.asCGFloat {
      let weight = fontWeight(from: node.style?["fontWeight"]?.asString)
      l.font = .systemFont(ofSize: size, weight: weight)
    }
    if let fg = node.style?["fg"]?.asString { l.textColor = UIColor(tulmiHex: fg) }
    switch node.style?["align"]?.asString {
    case "center": l.textAlignment = .center
    case "right":  l.textAlignment = .right
    default:       l.textAlignment = .left
    }
    return l
  }

  /// Static image node. `props.source` accepts the same shapes as
  /// IconKey.props.icon: { sf } / { asset } / { url } / { emoji } / string
  /// shorthand. Async fetches auto-refresh via resolveIcon's onLoad callback.
  private func buildImageNode(node: KBNode) -> UIView {
    let iv = UIImageView()
    iv.contentMode = .scaleAspectFit
    let spec = node.props?["source"] ?? node.props?["icon"]
    if let emoji = iconEmoji(spec) {
      // Render emoji as a label — no image needed.
      let l = UILabel()
      l.text = emoji
      l.textAlignment = .center
      l.font = .systemFont(ofSize: node.style?["fontSize"]?.asCGFloat ?? 32)
      return l
    }
    if let img = resolveIcon(spec, onLoad: { [weak iv, weak self] in
      iv?.image = self?.resolveIcon(spec)
    }) {
      iv.image = img
    }
    if let tint = node.style?["fg"]?.asString {
      iv.tintColor = UIColor(tulmiHex: tint)
    }
    return iv
  }

  /// Simple 0–1 progress bar. `bind.value` → state path returning a number.
  /// style controls track/fill color, height, radius.
  private func buildProgressBar(node: KBNode) -> UIView {
    let track = UIView()
    track.backgroundColor = UIColor(tulmiHex: node.style?["trackBg"]?.asString ?? "#FFFFFF1A")
    track.layer.cornerRadius = node.style?["radius"]?.asCGFloat ?? 4
    track.clipsToBounds = true
    let fill = UIView()
    fill.backgroundColor = UIColor(tulmiHex: node.style?["fg"]?.asString ?? "#FFFFFFCC")
    fill.translatesAutoresizingMaskIntoConstraints = false
    track.addSubview(fill)
    let value: CGFloat = {
      if let key = node.bind?["value"] {
        let v = lookup(key.hasPrefix("state.") ? key : "state.\(key)").asDouble ?? 0
        return CGFloat(max(0, min(1, v)))
      }
      return CGFloat(node.props?["value"]?.asDouble ?? 0)
    }()
    NSLayoutConstraint.activate([
      fill.leadingAnchor.constraint(equalTo: track.leadingAnchor),
      fill.topAnchor.constraint(equalTo: track.topAnchor),
      fill.bottomAnchor.constraint(equalTo: track.bottomAnchor),
      fill.widthAnchor.constraint(equalTo: track.widthAnchor, multiplier: max(0.001, value)),
    ])
    return track
  }

  /// UISwitch bound to a state.user.* path via bind.value. Backend can also
  /// wire on.onChange to any action ref if it wants extra work after the flip.
  private func buildToggleNode(node: KBNode) -> UIView {
    let sw = UISwitch()
    let path = node.bind?["value"]
    if let p = path {
      let key = p.hasPrefix("state.") ? p : "state.\(p)"
      sw.isOn = truthy(lookup(key))
    }
    sw.addAction(UIAction { [weak self, weak sw] _ in
      guard let self = self, let sw = sw else { return }
      if let p = path {
        let bare = p.hasPrefix("state.user.") ? String(p.dropFirst("state.user.".count)) : p
        self.writeStatePath(bare, .bool(sw.isOn))
      }
      if let ref = node.on?["onChange"] {
        self.run(ref)
      }
      self.stateChanged()
    }, for: .valueChanged)
    return sw
  }

  /// UIScrollView container. Children lay out inside a UIStackView so the
  /// existing flex / gap / padding style keys still work. `props.horizontal`
  /// swaps axis.
  private func buildScrollView(node: KBNode) -> UIView {
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    scroll.showsVerticalScrollIndicator = false
    let horizontal = node.props?["horizontal"]?.asBool ?? false
    let stack = UIStackView()
    stack.axis = horizontal ? .horizontal : .vertical
    stack.spacing = CGFloat(node.style?["gap"]?.asDouble ?? node.style?["spacing"]?.asDouble ?? 6)
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
    ])
    if horizontal {
      stack.heightAnchor.constraint(equalTo: scroll.heightAnchor).isActive = true
    } else {
      stack.widthAnchor.constraint(equalTo: scroll.widthAnchor).isActive = true
    }
    for child in node.children ?? [] {
      stack.addArrangedSubview(render(node: child))
    }
    return scroll
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
    // Opacity / border / shadow — all backend-controllable style knobs. Kept
    // ignored when unset so old backend trees don't accidentally change look.
    if let opacity = style["opacity"]?.asDouble {
      view.alpha = CGFloat(opacity)
    }
    if let borderColor = style["borderColor"]?.asString {
      view.layer.borderColor = UIColor(tulmiHex: borderColor).cgColor
    }
    if let borderWidth = style["borderWidth"]?.asCGFloat {
      view.layer.borderWidth = borderWidth
    }
    if case .object(let shadow)? = style["shadow"] {
      view.layer.shadowColor = UIColor(tulmiHex: shadow["color"]?.asString ?? "#000000").cgColor
      view.layer.shadowOpacity = Float(shadow["opacity"]?.asDouble ?? 0.5)
      view.layer.shadowRadius = shadow["radius"]?.asCGFloat ?? 4
      if case .array(let offset)? = shadow["offset"], offset.count == 2 {
        view.layer.shadowOffset = CGSize(
          width: offset[0].asDouble ?? 0,
          height: offset[1].asDouble ?? 2,
        )
      }
      view.clipsToBounds = false  // shadows need overflow
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
      // Backend flags:
      //   kb.key.shadow.color   (default "#000000")
      //   kb.key.shadow.offsetY (default 1)
      //   kb.key.shadow.radius  (default 0)
      //   kb.key.shadow.opacity (default 0.4)
      b.layer.shadowColor = flagColor("kb.key.shadow.color", "#000000").cgColor
      b.layer.shadowOffset = CGSize(width: 0, height: flagCGFloat("kb.key.shadow.offsetY", 1))
      b.layer.shadowRadius = flagCGFloat("kb.key.shadow.radius", 0)
      b.layer.shadowOpacity = Float(flagDouble("kb.key.shadow.opacity", 0.4))
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
    objc_setAssociatedObject(btn, &Self.keyPressedColorKey, pressed, .OBJC_ASSOCIATION_RETAIN)
    // Instant background swap on touch-down (Apple's key press is instant on
    // press-in — the *release* is what's animated). Combined with the animated
    // touchUp below, this gives the "soft glow fade" that reads as premium.
    btn.backgroundColor = pressed
    // System input-click sound. Only plays when the extension conforms to
    // UIInputViewAudioFeedback (see KeyboardViewController extension) AND the
    // user has "Keyboard Feedback → Sound" on in Settings — otherwise silent.
    UIDevice.current.playInputClick()
    fireKeyHaptic()
  }

  @objc private func keyTouchUp(_ btn: UIButton) {
    let base = (objc_getAssociatedObject(btn, &Self.keyBaseColorKey) as? UIColor) ?? keyBgColor()
    // Backend flag: kb.press.fadeMs (default 120) — release animation length.
    // 0 or negative → instant snap-back (native style is 60-120ms).
    let ms = flagDouble("kb.press.fadeMs", 120)
    if ms <= 0 {
      btn.backgroundColor = base
      return
    }
    UIView.animate(withDuration: ms / 1000.0,
                   delay: 0,
                   options: [.curveEaseOut, .allowUserInteraction, .beginFromCurrentState],
                   animations: { btn.backgroundColor = base },
                   completion: nil)
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

  // MARK: - Generic icon resolver + remote cache
  //
  // Backend can specify a button's icon in any of these shapes:
  //
  //   props: { icon: { sf: "mic.fill" } }                 // SF Symbol
  //   props: { icon: { asset: "TailzuMark" } }            // bundled asset
  //   props: { icon: { url: "https://cdn/mark@3x.png" } } // remote — cached
  //   props: { icon: { emoji: "🎙️" } }                  // renders as text
  //   props: { icon: "sf:mic.fill" }                      // string shorthand
  //   props: { icon: "asset:TailzuMark" }
  //   props: { icon: "https://cdn/mark.png" }
  //
  // The whole point: no Swift change is needed to swap an icon. Bundled + SF
  // are instant; remote resolves async and the button re-renders when the
  // download finishes.
  private var remoteImageCache: [String: UIImage] = [:]
  private var remoteImageInflight: Set<String> = []

  /// Resolve an icon spec from `props.icon` (or similar). Returns a UIImage
  /// synchronously for SF symbols and bundled assets; for URLs, returns any
  /// cached image immediately and kicks off a fetch. `onLoad` fires when a
  /// URL fetch completes so the caller can refresh the affected button.
  fileprivate func resolveIcon(_ spec: KBJSON?, onLoad: (() -> Void)? = nil) -> UIImage? {
    guard let spec = spec else { return nil }
    // Object form: { sf } / { asset } / { url } / { emoji }.
    if case .object(let o) = spec {
      if case .string(let sf) = (o["sf"] ?? .null) {
        return UIImage(systemName: sf)?.withRenderingMode(.alwaysTemplate)
      }
      if case .string(let asset) = (o["asset"] ?? .null) {
        return UIImage(named: asset, in: Bundle.main, compatibleWith: nil)?
          .withRenderingMode(.alwaysTemplate)
      }
      if case .string(let url) = (o["url"] ?? .null) {
        return fetchRemoteImage(url, onLoad: onLoad)
      }
      // emoji is rendered by the button title path — resolveIcon returns nil so
      // the caller falls through to setTitle. Callers should check emojiText
      // via iconEmoji(spec) helper below.
      return nil
    }
    // Shorthand string form.
    if case .string(let s) = spec {
      if s.hasPrefix("sf:") {
        return UIImage(systemName: String(s.dropFirst(3)))?
          .withRenderingMode(.alwaysTemplate)
      }
      if s.hasPrefix("asset:") {
        return UIImage(named: String(s.dropFirst(6)), in: Bundle.main, compatibleWith: nil)?
          .withRenderingMode(.alwaysTemplate)
      }
      if s.hasPrefix("https://") || s.hasPrefix("http://") {
        return fetchRemoteImage(s, onLoad: onLoad)
      }
    }
    return nil
  }

  /// Extract an emoji glyph from an icon spec, if that's how it was specified.
  /// Used by button builders to `setTitle(emoji)` instead of an image.
  fileprivate func iconEmoji(_ spec: KBJSON?) -> String? {
    guard let spec = spec else { return nil }
    if case .object(let o) = spec, case .string(let e) = (o["emoji"] ?? .null) { return e }
    return nil
  }

  /// Return a cached remote image if we have one; else start a URLSession
  /// download and call `onLoad` when it lands. The cache is persistent across
  /// keyboard sessions via the app-group container so a single fetch serves
  /// every open of the keyboard until the URL changes.
  private func fetchRemoteImage(_ url: String, onLoad: (() -> Void)?) -> UIImage? {
    if let img = remoteImageCache[url] { return img }
    // Persistent-disk lookup.
    if let img = loadPersistedRemoteImage(url) {
      remoteImageCache[url] = img
      return img
    }
    // Start the download (only once per URL per session).
    if remoteImageInflight.contains(url) { return nil }
    guard let u = URL(string: url) else { return nil }
    remoteImageInflight.insert(url)
    URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
      guard let self = self else { return }
      DispatchQueue.main.async {
        self.remoteImageInflight.remove(url)
        // Route through TulmiImageLoader.decode-style so GIF / APNG land as
        // an animatedImage instead of a frozen first frame. Delegating to
        // that helper's cache also means both the SDUI + hand-built paths
        // share the same warm memory across keyboard opens.
        guard let d = data else { return }
        guard let img = self.decodeAnimated(d) else { return }
        self.remoteImageCache[url] = img
        self.persistRemoteImage(data: d, url: url)
        onLoad?()
      }
    }.resume()
    return nil
  }

  /// Decode a downloaded blob as either a static image or a multi-frame
  /// animated one (GIF / APNG). Uses ImageIO — no third-party dep, and it's
  /// always linked by the SDK.
  private func decodeAnimated(_ data: Data) -> UIImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else {
      return UIImage(data: data)
    }
    let count = CGImageSourceGetCount(src)
    if count <= 1 { return UIImage(data: data) }
    var frames: [UIImage] = []
    var total: TimeInterval = 0
    for i in 0..<count {
      guard let cg = CGImageSourceCreateImageAtIndex(src, i, nil) else { continue }
      total += Self.gifFrameDuration(src, index: i)
      frames.append(UIImage(cgImage: cg))
    }
    if frames.isEmpty { return UIImage(data: data) }
    return UIImage.animatedImage(with: frames, duration: total)
  }

  private static func gifFrameDuration(_ src: CGImageSource, index: Int) -> TimeInterval {
    guard let props = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [String: Any] else { return 0.1 }
    if let gif = props[kCGImagePropertyGIFDictionary as String] as? [String: Any] {
      if let d = gif[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = gif[kCGImagePropertyGIFDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    if let png = props[kCGImagePropertyPNGDictionary as String] as? [String: Any] {
      if let d = png[kCGImagePropertyAPNGUnclampedDelayTime as String] as? Double, d > 0.0009 { return d }
      if let d = png[kCGImagePropertyAPNGDelayTime as String] as? Double, d > 0.0009 { return d }
    }
    return 0.1
  }

  private func remoteImageCacheDir() -> URL? {
    let fm = FileManager.default
    // Prefer the app-group container so main app + extension share the cache.
    let group = fm.containerURL(forSecurityApplicationGroupIdentifier: "group.com.tulmi.shared")
    let base = group ?? fm.urls(for: .cachesDirectory, in: .userDomainMask).first
    guard let root = base?.appendingPathComponent("keyboard-icons", isDirectory: true) else { return nil }
    if !fm.fileExists(atPath: root.path) {
      try? fm.createDirectory(at: root, withIntermediateDirectories: true)
    }
    return root
  }

  private func remoteImageFile(for url: String) -> URL? {
    guard let dir = remoteImageCacheDir() else { return nil }
    // Cheap URL → filename hash (djb2-ish). Not for security — just uniqueness.
    var h: UInt64 = 5381
    for ch in url.unicodeScalars { h = (h << 5) &+ h &+ UInt64(ch.value) }
    return dir.appendingPathComponent(String(h, radix: 36) + ".img")
  }

  private func loadPersistedRemoteImage(_ url: String) -> UIImage? {
    guard let f = remoteImageFile(for: url),
          let data = try? Data(contentsOf: f) else { return nil }
    // Same GIF/APNG handling as the network path so a cached animated file
    // reanimates on the next open of the keyboard.
    return decodeAnimated(data)
  }

  private func persistRemoteImage(data: Data, url: String) {
    guard let f = remoteImageFile(for: url) else { return }
    try? data.write(to: f, options: .atomic)
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
    case .parallel(let actions):
      // Actions run "at the same time" from the tree's POV. For side-effecting
      // ops (haptic, log, network) they truly run concurrently; for state
      // mutations they still serialize on the main queue but the point is
      // authorial intent — no ordering guarantee.
      for a in actions {
        DispatchQueue.main.async { [weak self] in self?.run(a) }
      }
    case .condition(let cond, let thenA, let elseA):
      if evaluate(cond) { run(thenA) }
      else if let e = elseA { run(e) }
    case .delay(let ms):
      // The rest of the current gesture's actions all fire immediately, then
      // a scheduled block re-enters. Backend uses this inside a sequence to
      // stagger effects (haptic → delay 100 → toast).
      // No trailing action — this is just a pause primitive; wrap in sequence
      // for "do X, wait, do Y" semantics.
      _ = ms  // pause primitive standalone is a no-op; the pause happens when nested in sequence
    case .openUrl(let url, _):
      // Extensions can't UIApplication.open directly; drop a tombstone in the
      // app group. Main app picks it up on next foreground.
      writeDeepLinkTombstone(path: "openUrl?u=\(url)")
    case .toast(let msg, let tone):
      showToast(message: msg, tone: tone)
    case .confetti:
      // Confetti rendered as a short-lived CAEmitterLayer over the mount.
      fireConfetti()
    case .speak(let text, let voice):
      speak(text: text, voice: voice)
    case .playMedia(let url):
      playMedia(url: url)
    case .stopMedia:
      stopMedia()
    case .copyToClipboard(let text, let toastMessage):
      UIPasteboard.general.string = text
      if let m = toastMessage { showToast(message: m, tone: "success") }
    case .readClipboard(let assignTo):
      let clip = UIPasteboard.general.string ?? ""
      writeStatePath(assignTo, .string(clip))
      stateChanged()
    case .share(let text, let url, let title):
      var items: [Any] = []
      if let t = text, !t.isEmpty { items.append(t) }
      if let u = url, let real = URL(string: u) { items.append(real) }
      if items.isEmpty { return }
      let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
      if let t = title { vc.setValue(t, forKey: "subject") }
      host?.hostPresent(vc)
    case .setState(let path, let value):
      writeStatePath(path, value)
      stateChanged()
    case .toggleState(let path):
      let current = lookup("state.\(path)")
      let flipped: KBJSON = truthy(current) ? .bool(false) : .bool(true)
      writeStatePath(path, flipped)
      stateChanged()
    case .incrementState(let path, let by):
      let current = lookup("state.\(path)").asDouble ?? 0
      writeStatePath(path, .number(current + by))
      stateChanged()
    case .clearState(let path):
      writeStatePath(path, .null)
      stateChanged()
    case .callEndpoint(let method, let path, let body, let assignTo, let onSuccess, let onError):
      callEndpoint(method: method, path: path, body: body, assignTo: assignTo, onSuccess: onSuccess, onError: onError)
    case .analyticsTrack(let event, let props):
      // Extensions can't hit our analytics SDK directly (memory + sandbox);
      // drop an event tombstone in the app group and the main app forwards
      // on next foreground.
      writeAnalyticsTombstone(event: event, props: props)
    case .log(let msg, let level):
      NSLog("[kb %@] %@", level, msg)
    case .clearCache:
      remoteImageCache.removeAll()
      if let dir = remoteImageCacheDir() {
        try? FileManager.default.removeItem(at: dir)
      }
    case .reloadApp:
      // Reboots the SDUI tree only — the extension process itself stays up.
      remount()
    case .extensionAction(let name, let params):
      // Look up in the registered extension handlers. Unknown → no-op (safe
      // for pushing forward-looking actions to old builds).
      if let handler = Self.extensionHandlers[name] {
        handler(self, params ?? .null)
      } else {
        NSLog("[kb ext] no handler for %@", name)
      }
    case .unknown(let kind):
      NSLog("unknown kb action: %@", kind)
    }
  }

  // MARK: - Extension handler registry
  //
  // Native code can register a named handler at app launch time:
  //     SDUIRenderer.registerExtension("myCustomVoice") { renderer, params in ... }
  // Then backend can fire it as { kind: "extension", name: "myCustomVoice", params: {...} }.
  // Unknown names silently no-op so backend can push handlers older builds don't
  // have yet without a crash.
  private static var extensionHandlers: [String: (SDUIRenderer, KBJSON) -> Void] = [:]
  static func registerExtension(_ name: String, handler: @escaping (SDUIRenderer, KBJSON) -> Void) {
    extensionHandlers[name] = handler
  }

  // MARK: - State path writer (for setState / readClipboard / callEndpoint.assignTo)
  //
  // Writes a KBJSON value into state.user.<path> — a scratch dict that backend
  // can freely read/write via bind + visibleIf. Reserved for backend use;
  // native state fields (shift, dictating, etc.) are not writable via this path.
  private func writeStatePath(_ path: String, _ value: KBJSON) {
    if let str = value.asString { state.user[path] = .string(str) }
    else if let n = value.asDouble { state.user[path] = .number(n) }
    else if let b = value.asBool { state.user[path] = .bool(b) }
    else if case .null = value { state.user.removeValue(forKey: path) }
    else { state.user[path] = value }
  }

  // MARK: - Toast (transient label at the bottom of the keyboard)
  private weak var toastView: UILabel?
  private func showToast(message: String, tone: String) {
    // Backend flags:
    //   kb.toast.durationMs   (default 2000) — visible time before fade begins
    //   kb.toast.fadeInMs     (default 180)
    //   kb.toast.fadeOutMs    (default 250)
    //   kb.toast.height       (default 32)
    //   kb.toast.offsetY      (default -18) — negative = above bottom anchor
    //   kb.toast.fontSize     (default 13)
    //   kb.toast.color.error   (default "#FF3B30E6")
    //   kb.toast.color.success (default "#34C759E6")
    //   kb.toast.color.info    (default "#000000D9")
    guard let container = mountContainer else { return }
    toastView?.removeFromSuperview()
    let l = UILabel()
    l.text = message
    l.textColor = .white
    l.textAlignment = .center
    l.font = .systemFont(ofSize: flagCGFloat("kb.toast.fontSize", 13), weight: .medium)
    let bg: UIColor = {
      switch tone {
      case "error":   return flagColor("kb.toast.color.error", "#FF3B30E6")
      case "success": return flagColor("kb.toast.color.success", "#34C759E6")
      default:        return flagColor("kb.toast.color.info", "#000000D9")
      }
    }()
    l.backgroundColor = bg
    l.layer.cornerRadius = 8
    l.clipsToBounds = true
    l.translatesAutoresizingMaskIntoConstraints = false
    l.alpha = 0
    container.addSubview(l)
    NSLayoutConstraint.activate([
      l.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      l.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: flagCGFloat("kb.toast.offsetY", -18)),
      l.heightAnchor.constraint(equalToConstant: flagCGFloat("kb.toast.height", 32)),
      l.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, multiplier: 0.9),
    ])
    l.layoutMargins = UIEdgeInsets(top: 6, left: 14, bottom: 6, right: 14)
    toastView = l
    let fadeIn = flagDouble("kb.toast.fadeInMs", 180) / 1000.0
    let duration = flagDouble("kb.toast.durationMs", 2000) / 1000.0
    let fadeOut = flagDouble("kb.toast.fadeOutMs", 250) / 1000.0
    UIView.animate(withDuration: fadeIn) { l.alpha = 1 }
    DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak l] in
      UIView.animate(withDuration: fadeOut, animations: { l?.alpha = 0 },
                     completion: { _ in l?.removeFromSuperview() })
    }
  }

  // MARK: - Confetti (short-lived CAEmitterLayer)
  private func fireConfetti() {
    guard let container = mountContainer else { return }
    let emitter = CAEmitterLayer()
    // Backend flags:
    //   kb.confetti.colors       (default 6 system colors) — array of hex strings
    //   kb.confetti.birthRate    (default 6)   — particles/sec per color cell
    //   kb.confetti.lifetimeMs   (default 3000)
    //   kb.confetti.velocity     (default 200) — pt/sec
    //   kb.confetti.spin         (default 3)   — rad/sec
    //   kb.confetti.scale        (default 0.06)
    //   kb.confetti.burstMs      (default 400) — birth cutoff
    //   kb.confetti.teardownMs   (default 3500)
    emitter.emitterPosition = CGPoint(x: container.bounds.midX, y: -10)
    emitter.emitterShape = .line
    emitter.emitterSize = CGSize(width: container.bounds.width, height: 1)
    let defaultColors = ["#FF3B30","#007AFF","#34C759","#FFCC00","#AF52DE","#FF9500"]
    let hexList: [String] = {
      if case .array(let a)? = config.flags?["kb.confetti.colors"] {
        return a.compactMap { $0.asString }
      }
      return defaultColors
    }()
    let birthRate = Float(flagDouble("kb.confetti.birthRate", 6))
    let lifetime = Float(flagDouble("kb.confetti.lifetimeMs", 3000) / 1000.0)
    let velocity = flagCGFloat("kb.confetti.velocity", 200)
    let spin = flagCGFloat("kb.confetti.spin", 3)
    let scale = flagCGFloat("kb.confetti.scale", 0.06)
    emitter.emitterCells = hexList.map { hex in
      let cell = CAEmitterCell()
      cell.birthRate = birthRate
      cell.lifetime = lifetime
      cell.velocity = velocity
      cell.velocityRange = velocity * 0.2
      cell.emissionLongitude = .pi
      cell.emissionRange = 0.5
      cell.spin = spin
      cell.spinRange = spin * 1.3
      cell.scale = scale
      cell.color = UIColor(tulmiHex: hex).cgColor
      cell.contents = UIImage(systemName: "square.fill")?.cgImage
      return cell
    }
    container.layer.addSublayer(emitter)
    let burst = flagDouble("kb.confetti.burstMs", 400) / 1000.0
    let teardown = flagDouble("kb.confetti.teardownMs", 3500) / 1000.0
    DispatchQueue.main.asyncAfter(deadline: .now() + burst) { emitter.birthRate = 0 }
    DispatchQueue.main.asyncAfter(deadline: .now() + teardown) { emitter.removeFromSuperlayer() }
  }

  // MARK: - TTS (AVSpeechSynthesizer)
  private var speechSynth: AVSpeechSynthesizer?
  private func speak(text: String, voice: String?) {
    if speechSynth == nil { speechSynth = AVSpeechSynthesizer() }
    let utter = AVSpeechUtterance(string: text)
    if let v = voice, let sv = AVSpeechSynthesisVoice(language: v) { utter.voice = sv }
    speechSynth?.speak(utter)
  }

  // MARK: - Media (AVPlayer, opt-in)
  private var mediaPlayer: AVPlayer?
  private func playMedia(url: String) {
    guard let u = URL(string: url) else { return }
    let p = AVPlayer(url: u)
    mediaPlayer = p
    p.play()
  }
  private func stopMedia() {
    mediaPlayer?.pause()
    mediaPlayer = nil
  }

  // MARK: - callEndpoint
  //
  // Small helper so backend can trigger arbitrary POST/GET from the keyboard.
  // Uses the same base URL the config was fetched from. Result body (if JSON
  // and assignTo is set) lands at state.user[assignTo]. onSuccess/onError refs
  // run after the response is decoded.
  private func callEndpoint(method: String, path: String, body: KBJSON?,
                            assignTo: String?, onSuccess: KBActionRef?, onError: KBActionRef?) {
    let base = TulmiBackend.baseUrl
    guard let url = URL(string: base + path) else { return }
    // Backend flag: kb.network.timeoutMs (default 15000) — request timeout for
    // callEndpoint invocations. Default was iOS's implicit 60s which is way
    // too long on a bad network.
    var req = URLRequest(url: url)
    req.httpMethod = method.uppercased()
    req.timeoutInterval = flagDouble("kb.network.timeoutMs", 15000) / 1000.0
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let body = body, let data = try? JSONEncoderSafe.data(for: body) {
      req.httpBody = data
    }
    URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
      DispatchQueue.main.async {
        guard let self = self else { return }
        let ok = (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        if let err = err {
          NSLog("[kb callEndpoint] %@", "\(err)")
        }
        if ok, let d = data, let json = try? JSONDecoder().decode(KBJSON.self, from: d) {
          if let key = assignTo { self.writeStatePath(key, json); self.stateChanged() }
          if let ok = onSuccess { self.run(ok) }
        } else {
          if let er = onError { self.run(er) }
        }
      }
    }.resume()
  }

  // MARK: - Analytics tombstone (extension → main app hand-off; deep-link
  // tombstone helper is defined once, further down)
  private func writeAnalyticsTombstone(event: String, props: KBJSON?) {
    let d = UserDefaults(suiteName: "group.com.tulmi.app")
    var log = d?.array(forKey: "tulmi.analytics.pending") as? [[String: Any]] ?? []
    var entry: [String: Any] = ["event": event, "at": Int(0)]  // timestamp filled by main app
    if let p = props, case .object(let o) = p {
      var props2: [String: Any] = [:]
      for (k, v) in o { props2[k] = JSONEncoderSafe.lower(v) }
      entry["props"] = props2
    }
    log.append(entry)
    d?.set(log, forKey: "tulmi.analytics.pending")
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
    // Backend flag: kb.autoCap.enabled (default true) — global auto-cap kill switch
    guard flagBool("kb.autoCap.enabled", true) else { return }
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
    case .startsWith(let p, let s):
      return (lookupString(p) ?? "").hasPrefix(s)
    case .endsWith(let p, let s):
      return (lookupString(p) ?? "").hasSuffix(s)
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
      case "shift":                return .bool(state.shift)
      case "capsLock":             return .bool(state.capsLock)
      case "layoutId":             return .string(state.layoutId)
      case "dictating":            return .bool(state.dictating)
      case "refining":             return .bool(state.refining)
      case "hasFullAccess":        return .bool(state.hasFullAccess)
      case "status":               return .string(state.status)
      case "micLevel":             return .number(Double(state.micLevel))
      case "tone":                 return .string(state.tone)
      case "trackpadActive":       return .bool(state.trackpadActive)
      case "primaryLanguage":      return .string(state.primaryLanguage)
      case "hasMultipleKeyboards": return .bool(state.hasMultipleKeyboards)
      case "appearance":           return .string(state.appearance)
      case "deviceModel":          return .string(state.deviceModel)
      case "systemVersion":        return .string(state.systemVersion)
      case "isNetworkReachable":   return .bool(state.isNetworkReachable)
      case "keyboardHeight":       return .number(Double(state.keyboardHeight))
      default:
        // state.user.<anything> — backend scratch dict.
        if key.hasPrefix("user.") {
          return state.user[String(key.dropFirst("user.".count))] ?? .null
        }
        return .null
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
    // Recording visuals — key dimming + dot stream on start; graceful fade
    // (existing dots keep flying for ~2.5s) on stop. Called before
    // stateChanged() so the tree remounts to update the mic icon (brand mark
    // → thick line) in the same runloop that shows the overlay.
    if v {
      showRecordingVisuals()
    } else {
      hideRecordingVisuals()
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

  /// Field-context refresh — called by the host on textDidChange (which fires
  /// when the user switches focus between text fields, not just on typing).
  /// Rebuilds the mounted tree only if something the tree actually depends on
  /// changed (returnKeyType / primaryLanguage / hasMultipleKeyboards) so we're
  /// not remounting on every keystroke.
  private var lastReflectedReturnKey: UIReturnKeyType?
  func reflectFieldContext() {
    let rt = host?.hostReturnKeyType() ?? .default
    let lang = host?.hostPrimaryLanguageCode() ?? "EN"
    let multi = host?.hostNeedsInputModeSwitchKey() ?? false
    var changed = false
    if lastReflectedReturnKey != rt         { lastReflectedReturnKey = rt; changed = true }
    if state.primaryLanguage != lang        { state.primaryLanguage = lang; changed = true }
    if state.hasMultipleKeyboards != multi  { state.hasMultipleKeyboards = multi; changed = true }
    if changed { stateChanged() }
  }

  /// Appearance refresh — called by the host on traitCollectionDidChange when
  /// the user flips dark/light. Also syncs the state.appearance string so the
  /// backend tree can bind against it (visibleIf, etc.).
  func reflectAppearance(_ dark: Bool) {
    let val = dark ? "dark" : "light"
    if state.appearance == val { return }
    state.appearance = val
    stateChanged()
  }

  deinit {
    waveformTimer?.invalidate()
    deleteTimer?.invalidate()
  }
}

// MARK: - Waveform bars view

/// Waveform bar array — every geometry / color parameter is passed in so
/// backend flags can tune the look. Baseline heights are random per bar so
/// even at zero micLevel the waveform looks alive.
private final class WaveformView: UIView {
  struct Config {
    let barCount: Int
    let barColor: UIColor
    let barRadius: CGFloat
    let barSpacing: CGFloat
    let height: CGFloat
    let levelMultiplier: CGFloat
    let baselineMin: CGFloat
    let baselineMax: CGFloat
  }
  static let `default` = Config(
    barCount: 24, barColor: UIColor(white: 0.6, alpha: 1), barRadius: 1.5,
    barSpacing: 3, height: 24, levelMultiplier: 0.6,
    baselineMin: 0.2, baselineMax: 0.6,
  )
  private var bars: [CALayer] = []
  private var baselines: [CGFloat] = []
  private var level: CGFloat = 0
  private let cfg: Config

  init(config: Config = WaveformView.default) {
    self.cfg = config
    super.init(frame: .zero)
    for _ in 0..<max(1, config.barCount) {
      let l = CALayer()
      l.backgroundColor = config.barColor.cgColor
      l.cornerRadius = config.barRadius
      layer.addSublayer(l)
      bars.append(l)
      baselines.append(CGFloat.random(in: config.baselineMin...max(config.baselineMin, config.baselineMax)))
    }
    heightAnchor.constraint(equalToConstant: config.height).isActive = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }

  override func layoutSubviews() {
    super.layoutSubviews()
    redraw()
  }
  func setLevel(_ l: CGFloat) { level = l; redraw() }

  private func redraw() {
    let W = bounds.width, H = bounds.height
    guard W > 0, H > 0, !bars.isEmpty else { return }
    let n = CGFloat(bars.count)
    let spacing = cfg.barSpacing
    let barW = max(1.5, (W - spacing * (n - 1)) / n)
    let mult = cfg.levelMultiplier
    for (i, l) in bars.enumerated() {
      let jitter = CGFloat.random(in: -0.05...0.05)
      let h = max(2, min(H, H * (baselines[i] + level * mult + jitter)))
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
