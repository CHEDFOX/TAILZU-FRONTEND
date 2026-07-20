import Foundation

/// TulmiFlow — the keyboard-extension half of the "Flow Session" mic.
///
/// The keyboard can't record, so the MAIN APP holds the mic alive in the
/// background (FlowSessionManager). This coordinator lets the keyboard:
///   • check whether a session is live  (isSessionActive)
///   • start / stop a dictation          (startDictation / stopDictation → Darwin)
///   • receive live transcripts          (onTranscript, via Darwin + App Group)
///   • learn when the session ended       (onEnded)
///
/// All cross-process signalling is Darwin notifications + the shared App Group,
/// exactly like TulmiHandoff.
final class TulmiFlow: NSObject {
  static let appGroup = "group.com.tulmi.app"
  static let nStart      = "space.tailzu.tulmi.flow.start"
  static let nStop       = "space.tailzu.tulmi.flow.stop"
  static let nTranscript = "space.tailzu.tulmi.flow.transcript"
  static let nEnded      = "space.tailzu.tulmi.flow.ended"

  /// A new partial/final transcript landed. `isFinal` distinguishes a finalized
  /// segment (commit) from an in-progress hypothesis (replace).
  var onTranscript: ((_ text: String, _ isFinal: Bool) -> Void)?
  /// The Flow Session ended (idle-expired or turned off) — reset UI to idle.
  var onEnded: (() -> Void)?

  private var lastSeq = 0
  private var registered = false
  private var store: UserDefaults? { UserDefaults(suiteName: TulmiFlow.appGroup) }

  override init() { super.init(); registerObservers() }

  deinit {
    CFNotificationCenterRemoveEveryObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque())
  }

  /// How fresh the app's liveness heartbeat must be for the session to count as
  /// live. The app stamps it ~1×/sec; 4s tolerates a couple of missed ticks
  /// while still catching a force-quit within a few seconds.
  static let heartbeatMaxAgeMs = 4000.0

  /// True when the app has a live Flow Session — armed, not idle-expired, AND
  /// its liveness heartbeat is fresh. The heartbeat is the crux: a FORCE-QUIT
  /// kills the app process before it can clear the `active` flag, so `active`
  /// alone is a tombstone that lies. The app stamps `tulmi.flow.heartbeat` only
  /// while its background mic is genuinely alive; once the process dies the
  /// stamp stops, so a stale heartbeat means "no live session" — the mic tap
  /// then re-opens the app to re-arm instead of animating into a dead session
  /// that records nothing.
  var isSessionActive: Bool {
    guard let d = store, d.bool(forKey: "tulmi.flow.active") else { return false }
    let nowMs = Date().timeIntervalSince1970 * 1000
    let hb = d.double(forKey: "tulmi.flow.heartbeat")
    if hb <= 0 || nowMs - hb > TulmiFlow.heartbeatMaxAgeMs { return false }
    let expires = d.double(forKey: "tulmi.flow.expiresAt")
    if expires > 0 && nowMs >= expires { return false }
    return true
  }

  /// Locally mark the session dead (used when the keyboard detects the app was
  /// force-quit mid-dictation). Clears the tombstone so subsequent checks agree
  /// immediately, before the heartbeat would naturally age out.
  func markSessionDead() {
    let d = store
    d?.set(false, forKey: "tulmi.flow.active")
    d?.removeObject(forKey: "tulmi.flow.heartbeat")
  }

  func startDictation() { post(TulmiFlow.nStart) }
  func stopDictation() { post(TulmiFlow.nStop) }

  private func post(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(name as CFString), nil, nil, true)
  }

  private func registerObservers() {
    guard !registered else { return }
    registered = true
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let ptr = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(center, ptr, { _, p, _, _, _ in
      guard let p = p else { return }
      let this = Unmanaged<TulmiFlow>.fromOpaque(p).takeUnretainedValue()
      DispatchQueue.main.async { this.readTranscript() }
    }, TulmiFlow.nTranscript as CFString, nil, .deliverImmediately)
    CFNotificationCenterAddObserver(center, ptr, { _, p, _, _, _ in
      guard let p = p else { return }
      let this = Unmanaged<TulmiFlow>.fromOpaque(p).takeUnretainedValue()
      DispatchQueue.main.async { this.onEnded?() }
    }, TulmiFlow.nEnded as CFString, nil, .deliverImmediately)
  }

  private func readTranscript() {
    guard let d = store else { return }
    let seq = d.integer(forKey: "tulmi.flow.transcript.seq")
    guard seq != lastSeq else { return }   // dedupe repeated notifications
    lastSeq = seq
    let text = d.string(forKey: "tulmi.flow.transcript.text") ?? ""
    let isFinal = d.bool(forKey: "tulmi.flow.transcript.isFinal")
    onTranscript?(text, isFinal)
  }
}
