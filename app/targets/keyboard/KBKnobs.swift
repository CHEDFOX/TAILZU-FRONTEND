import Foundation

/// Knobs for the parts of the keyboard that are not the renderer — the
/// network client, the stream, telemetry, the image loader, the flow glue.
///
/// The renderer reads flags through its own helpers (flagDouble etc.). These
/// files had no way to ask the server anything, so their numbers, endpoints
/// and strings were literals. Now they call knobDouble with a kb.* key and the
/// old literal, and the value comes from the last config the keyboard fetched (or the one
/// it shipped with), falling back to the literal only before any config.
///
/// Every key read here is collected by tools/knobs/extract-keyboard.mjs, and
/// the backend sends each one explicitly.
final class KBKnobs {
  static let shared = KBKnobs()
  private let lock = NSLock()
  private var flags: [String: Any] = [:]
  private var labels: [String: String] = [:]

  /// Point the knobs at a config (the raw JSON the server sent).
  func update(configJSON data: Data) {
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    lock.lock(); defer { lock.unlock() }
    flags = obj["flags"] as? [String: Any] ?? [:]
    labels = obj["labels"] as? [String: String] ?? [:]
  }

  fileprivate func flag(_ key: String) -> Any? {
    lock.lock(); defer { lock.unlock() }
    return flags[key]
  }
  fileprivate func label(_ key: String) -> String? {
    lock.lock(); defer { lock.unlock() }
    return labels[key]
  }
}

/// Finite and bounded, or the fallback: "nan", "inf" or 1e300 from the
/// server must not reach a timer, a frame or an Int conversion.
func knobDouble(_ key: String, _ fallback: Double) -> Double {
  let v: Double
  switch KBKnobs.shared.flag(key) {
  case let n as NSNumber: v = n.doubleValue
  case let s as String: v = Double(s) ?? fallback
  default: return fallback
  }
  guard v.isFinite else { return fallback }
  return min(1e9, max(-1e9, v))
}

/// Whole numbers. A non-finite or out-of-range value from the server falls
/// back instead of trapping the conversion.
func knobInt(_ key: String, _ fallback: Int) -> Int {
  let d = knobDouble(key, Double(fallback))
  guard d.isFinite, d > Double(Int.min), d < Double(Int.max) else { return fallback }
  return Int(d)
}

func knobBool(_ key: String, _ fallback: Bool) -> Bool {
  (KBKnobs.shared.flag(key) as? Bool) ?? fallback
}

func knobString(_ key: String, _ fallback: String) -> String {
  (KBKnobs.shared.flag(key) as? String) ?? fallback
}

/// A list of strings (patterns, words, ids) — the fallback until one arrives.
func knobStrings(_ key: String, _ fallback: [String]) -> [String] {
  (KBKnobs.shared.flag(key) as? [Any])?.compactMap { $0 as? String } ?? fallback
}

func knobLabel(_ key: String, _ fallback: String) -> String {
  KBKnobs.shared.label(key) ?? fallback
}
