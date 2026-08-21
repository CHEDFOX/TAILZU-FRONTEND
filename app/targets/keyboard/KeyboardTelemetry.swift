import Foundation

/// Keyboard diagnostics — COUNTERS ONLY.
///
/// A keyboard extension sees everything the user types, so this type is built
/// so that leaking content is impossible rather than unlikely: the only thing
/// it can hold is an integer per named counter. There is no API here that
/// accepts a string of user text, and the backend independently allowlists
/// counter names and rejects non-numeric values.
///
/// Why it exists: 130+ keyboard behaviors are backend-tunable and can be rolled
/// out to a slice of users, but without counters every experiment is judged by
/// feel. `autocorrectReverted` is the sharpest signal in here — a user
/// backspacing a correction is them telling us it was wrong.
///
/// Cost discipline (this runs inside a ~48-60MB jetsam ceiling, on the typing
/// hot path):
///   • bump() is a dictionary increment on an in-memory struct. No I/O, no
///     allocation per keystroke, no XPC.
///   • Persistence is App Group UserDefaults, written on a throttle and on
///     backgrounding — NOT per keystroke — so counters survive the extension
///     being killed without paying a write per key.
///   • Upload piggybacks the config refresh the host already performs.
enum KeyboardTelemetry {
  /// Counter names the backend accepts. Kept in sync with TELEMETRY_COUNTERS
  /// in server.ts — an unknown name is dropped server-side, so a typo here is
  /// silent data loss rather than an error.
  enum Counter: String {
    case keystrokes
    case autocorrectApplied
    case autocorrectReverted
    case suggestionAccepted
    case confusableOffered
    case confusableAccepted
    case swipeCommitted
    case swipeAbandoned
    case touchesCancelledRescued
    case accentTrayOpened
    case trackpadUsed
    case micTaps
    case dictationCommitted
    case refineRequested
    case refineFailed
    case toneChanged
    case voiceChanged
    case memoryWarnings
    case coldStarts
  }

  private static let storeKey = "tulmi.kb.telemetry"
  private static let windowStartKey = "tulmi.kb.telemetry.start"
  /// Persist at most this often. Typing bursts hundreds of events; writing
  /// each one would put a UserDefaults sync on the keystroke path.
  private static let persistThrottle: TimeInterval = 20
  /// Don't upload more often than this — the host refreshes config on every
  /// keyboard open, which for a heavy user is dozens of times an hour.
  private static let uploadInterval: TimeInterval = 30 * 60

  private static var counters: [String: Int] = [:]
  private static var lastPersist: TimeInterval = 0
  private static var loaded = false
  private static let lock = NSLock()

  private static var store: UserDefaults? { UserDefaults(suiteName: TulmiFlow.appGroup) }

  /// Increment a counter. Safe to call from anywhere, including the key-press
  /// path — the lock is uncontended in practice (touch handling is main-thread)
  /// and guards only a dictionary bump.
  static func bump(_ c: Counter, by n: Int = 1) {
    lock.lock()
    loadIfNeeded()
    counters[c.rawValue, default: 0] += n
    let now = Date().timeIntervalSince1970
    let due = now - lastPersist > persistThrottle
    if due { lastPersist = now }
    let snapshot = due ? counters : nil
    lock.unlock()
    // Persist OUTSIDE the lock, and only on the throttle.
    if let snapshot = snapshot { persist(snapshot) }
  }

  /// Flush to disk now — call when the keyboard is going away, so the tail of
  /// a session isn't lost to the throttle.
  static func flushToDisk() {
    lock.lock()
    let snapshot = counters
    lock.unlock()
    if !snapshot.isEmpty { persist(snapshot) }
  }

  private static func loadIfNeeded() {
    guard !loaded else { return }
    loaded = true
    if let saved = store?.dictionary(forKey: storeKey) as? [String: Int] {
      counters = saved
    }
    if store?.object(forKey: windowStartKey) == nil {
      store?.set(Date().timeIntervalSince1970, forKey: windowStartKey)
    }
  }

  private static func persist(_ snapshot: [String: Int]) {
    store?.set(snapshot, forKey: storeKey)
  }

  /// Everything the uploader needs, or nil when there's nothing worth sending
  /// or the interval hasn't elapsed. Clearing happens only after a successful
  /// upload (see `commitUpload`), so a failed request doesn't lose the data.
  static func pendingUpload() -> (counters: [String: Int], windowMs: Int)? {
    lock.lock()
    loadIfNeeded()
    let snapshot = counters
    lock.unlock()
    guard !snapshot.isEmpty else { return nil }

    let now = Date().timeIntervalSince1970
    let start = store?.double(forKey: windowStartKey) ?? now
    guard now - start >= uploadInterval else { return nil }
    return (snapshot, Int((now - start) * 1000))
  }

  /// Called after the backend accepted the payload: drop exactly what was
  /// sent and start a new window. Counters that arrived DURING the request are
  /// preserved by subtracting rather than clearing.
  static func commitUpload(_ sent: [String: Int]) {
    lock.lock()
    for (k, v) in sent {
      let remaining = (counters[k] ?? 0) - v
      if remaining > 0 { counters[k] = remaining } else { counters.removeValue(forKey: k) }
    }
    let snapshot = counters
    lock.unlock()
    persist(snapshot)
    store?.set(Date().timeIntervalSince1970, forKey: windowStartKey)
  }
}
