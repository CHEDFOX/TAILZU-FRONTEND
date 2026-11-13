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
    // THE TOUCH PATH, COUNTED — so "fast typing drops keys" is a number.
    /// Touches the plane took.
    case planeTouches
    /// Touches the plane took that resolved to no key at all.
    case planeMissed
    /// Action-key taps that lifted just outside the key and were kept.
    case liftRescued
    /// Space / return fired early because another key landed while they
    /// were held (press-order rollover, K40).
    case liftRolled
    /// Action-key taps the system cancelled early and were kept.
    case cancelRescued
    /// Letters typed on touch-down and taken back because a tray opened.
    case trayRetracted
    /// Full rebuilds of the key tree.
    case remounts
    /// Milliseconds the insert path took, summed. keyMs / keystrokes is the
    /// average wait between contact and the letter showing.
    case keyMs
    /// Inserts that took longer than a frame and a half (24 ms).
    case slowKeys
    /// Inserts that missed a 60 Hz frame (16 ms): the budget every keystroke
    /// has to finish inside for the letter to show on the next frame.
    case keysOverFrame
    /// Milliseconds spent building the key tree, summed. remountMs / remounts
    /// is what one rebuild costs (a 123/ABC switch is one, on touch-down).
    case remountMs
    /// Rebuilds that took longer than a frame (16 ms).
    case slowRemounts
    /// Times the extension's memory was read (each time it appears).
    case memSampled
    /// Of those, how often its footprint was at or over 30 / 40 / 50 MB. A
    /// keyboard is killed outright past its ceiling (about 48-60 MB, by
    /// device), so these say how close it runs, before users see it vanish.
    case memOver30MB
    case memOver40MB
    case memOver50MB
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
    // KEY FACES. Counters only, like everything else here, and the upload
    // carries the skin's id beside them so a skin that regresses can be
    // stopped. There is no per-key press counting, and nothing here can hold
    // a key, a character or a time.
    /// Faces drawn on keys in this window.
    case facePainted
    /// Faces refused: a budget (faced keys, live image bytes), art that was
    /// not on the compiled host or not in the manifest, or a face that named
    /// something a skin may never carry.
    case faceDropped
    /// Sessions drawn in plain mode after the crash guard struck on a skin.
    case skinPlainSessions
  }

  private static let storeKey = "tulmi.kb.telemetry"
  private static let windowStartKey = "tulmi.kb.telemetry.start"
  /// The skin these counters were collected under, and whether the window
  /// saw more than one. Both live in the App Group beside the counters, so a
  /// window that spans several keyboard sessions keeps its tag.
  private static let windowSkinKey = "tulmi.kb.telemetry.skin"
  private static let windowMixedKey = "tulmi.kb.telemetry.skinMixed"
  /// Persist at most this often. Typing bursts hundreds of events; writing
  /// each one would put a UserDefaults sync on the keystroke path. The
  /// server's (kb.telemetry.persistSec); 20s until a config arrives.
  private static var persistThrottle: TimeInterval { knobDouble("kb.telemetry.persistSec", 20) }
  /// Don't upload more often than this — the host refreshes config on every
  /// keyboard open, which for a heavy user is dozens of times an hour. The
  /// server's (kb.telemetry.uploadIntervalSec); 30 minutes until then.
  private static var uploadInterval: TimeInterval { knobDouble("kb.telemetry.uploadIntervalSec", 1800) }

  private static var counters: [String: Int] = [:]
  private static var lastPersist: TimeInterval = 0
  private static var loaded = false
  /// What is drawing right now, as the last `noteSkin` said it: a skin id, or
  /// "" for no skin / plain mode. nil means nobody has said yet in this
  /// process. Guarded by `lock`; read when a new window opens.
  private static var drawing: String?
  private static let lock = NSLock()

  private static var store: UserDefaults? { UserDefaults(suiteName: TulmiFlow.appGroup) }

  /// Increment a counter. Safe to call from anywhere, including the key-press
  /// path — the lock is uncontended in practice (touch handling is main-thread)
  /// and guards only a dictionary bump.
  static func bump(_ c: Counter, by n: Int = 1) {
    // Read before taking the lock, so the knob lookup never nests inside it.
    let throttle = persistThrottle
    lock.lock()
    loadIfNeeded()
    counters[c.rawValue, default: 0] += n
    let now = Date().timeIntervalSince1970
    let due = now - lastPersist > throttle
    if due { lastPersist = now }
    let snapshot = due ? counters : nil
    lock.unlock()
    // Persist OUTSIDE the lock, and only on the throttle.
    if let snapshot = snapshot { persist(snapshot) }
  }

  // MARK: Which skin a window belongs to

  /// Say which skin is about to draw. Called on the main thread from the
  /// config path, never from the typing path — `KBSkin.current` is main-
  /// thread state and the uploader runs in a URLSession completion, so the
  /// tag is recorded HERE, when it is known to be true, rather than read at
  /// upload time.
  ///
  /// A window is tagged only when every part of it ran under one skin:
  ///   • nothing noted yet → this is the window's skin;
  ///   • the same id again → nothing changes;
  ///   • a different id, plain mode, or no skin at all → MIXED, and the
  ///     window uploads with no tag.
  ///
  /// A wrong tag is worse than none. It is what would stop the wrong skin.
  ///
  /// It also remembers what is drawing for the NEXT window. Without that,
  /// almost every window went up untagged: `commitUpload` clears the tag, and
  /// the only thing that sets it again is this call — which runs from
  /// `KBSkin.adopt`, i.e. on a cold start or when the config bytes change. A
  /// refetch of identical bytes returns early, so after the first upload the
  /// tag never came back and the window carried counters with no skin.
  static func noteSkin(_ id: String?) {
    guard let store = store else { return }
    let tag = id ?? ""            // "" is "no skin", which is also no tag
    // The whole body runs under the lock: a commit on the URLSession queue
    // must not land in the middle of this read-modify-write.
    lock.lock()
    defer { lock.unlock() }
    // Set on EVERY call, before any early return, so the next window knows
    // what was drawing when it opened.
    drawing = tag
    if store.bool(forKey: windowMixedKey) { return }
    guard store.object(forKey: windowSkinKey) != nil else {
      // The first word on this window. If it already holds counters from
      // before anyone said which skin was drawing, those frames were not
      // this skin's, so a skin arriving now makes the window mixed. After
      // this build is installed that happens only once: for the counters the
      // previous build left behind, which can never have been skinned.
      loadIfNeeded()
      if counters.isEmpty || tag.isEmpty {
        store.set(tag, forKey: windowSkinKey)
      } else {
        store.set(true, forKey: windowMixedKey)
      }
      return
    }
    if store.string(forKey: windowSkinKey) != tag { store.set(true, forKey: windowMixedKey) }
  }

  /// The tag for this window, or nil when there is none: no skin, more than
  /// one, or plain mode.
  private static func windowSkin() -> String? {
    guard let store = store, !store.bool(forKey: windowMixedKey) else { return nil }
    let id = store.string(forKey: windowSkinKey) ?? ""
    return id.isEmpty ? nil : id
  }

  /// Open a window and carry the tag into it. What was drawing when the last
  /// window closed is what is drawing when this one opens — nothing changed
  /// at the commit. Only a process that has never been told (a fresh launch
  /// before the config is applied) starts untagged.
  private static func startNewWindow() {
    lock.lock()
    let carried = drawing
    lock.unlock()
    store?.set(Date().timeIntervalSince1970, forKey: windowStartKey)
    if let carried = carried {
      store?.set(carried, forKey: windowSkinKey)
      store?.set(false, forKey: windowMixedKey)
    } else {
      store?.removeObject(forKey: windowSkinKey)
      store?.set(false, forKey: windowMixedKey)
    }
  }

  /// The extension's own memory as jetsam counts it (phys_footprint), in MB,
  /// or nil when the kernel would not say. One task_info call: cheap, and
  /// never on the key path.
  static func footprintMB() -> Int? {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { ptr in
      ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard kr == KERN_SUCCESS else { return nil }
    return Int(info.phys_footprint / (1024 * 1024))
  }

  /// Read the footprint once and count which band it is in. Instruments on a
  /// developer's phone measures one session; this measures everyone's.
  static func sampleMemory() {
    guard let mb = footprintMB() else { return }
    bump(.memSampled)
    if mb >= 30 { bump(.memOver30MB) }
    if mb >= 40 { bump(.memOver40MB) }
    if mb >= 50 { bump(.memOver50MB) }
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
  ///
  /// The server can switch uploads off (kb.telemetry.enabled = false): then
  /// nothing is ever pending, and the counters simply stay on the phone.
  /// The skin comes back WITH the counters, so the uploader never reads
  /// `KBSkin` — which lives on the main thread — from a URLSession
  /// completion, and never tags a window with whatever happens to be drawing
  /// half an hour after it started.
  static func pendingUpload() -> (counters: [String: Int], windowMs: Int, skin: String?)? {
    guard knobBool("kb.telemetry.enabled", true) else { return nil }
    lock.lock()
    loadIfNeeded()
    let snapshot = counters
    lock.unlock()
    guard !snapshot.isEmpty else { return nil }

    let now = Date().timeIntervalSince1970
    let start = store?.double(forKey: windowStartKey) ?? now
    guard now - start >= uploadInterval else { return nil }
    return (snapshot, Int((now - start) * 1000), windowSkin())
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
    // A new window, tagged by what is drawing as this one opens. The commit
    // itself changes nothing on screen, so the tag carries across it.
    startNewWindow()
  }
}
