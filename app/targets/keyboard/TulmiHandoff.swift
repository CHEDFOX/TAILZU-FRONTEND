import UIKit
import Foundation

/// Mic handoff coordinator for the keyboard extension.
///
/// iOS blocks microphone recording inside keyboard extensions at the OS level,
/// even with Full Access on (the process gets `CMSUtility_IsAllowedToStartRecording:
/// … doesn't have entitlements to record audio` and never sees a sample). So
/// mic input flows THROUGH the main app instead:
///
///   1. User taps mic in the keyboard.
///   2. `beginHandoff()` writes a record-request tombstone to the shared
///      App Group and tries to open the containing app at a specific SDUI
///      screen (`keyboard_record` when warm, `keyboard_primer` when cold).
///   3. The main app foregrounds, records via `AVAudioEngine`, uploads to
///      /v1/transcribe-clean, then fires a Darwin notification and stashes
///      the cleaned text in the App Group.
///   4. This coordinator observes that Darwin notification, reads the result,
///      and calls its `onResult` callback so the keyboard can insert the text
///      at the cursor.
///
/// "Warm" = the main app has been foregrounded within the last 15 minutes.
/// That means iOS still holds its process image, so bringing it forward feels
/// near-instant. "Cold" = the primer screen has to run so the user knows to
/// grant mic + swipe back.
final class TulmiHandoff: NSObject {
  static let appGroup = "group.com.tulmi.app"
  static let darwinNotification = "space.tailzu.tulmi.handoff.complete"
  /// Main app is treated as "warm" if it was foregrounded within this window.
  static let warmWindowSeconds: TimeInterval = 15 * 60

  /// Called on the main queue when a handoff completes (or is cancelled).
  var onResult: ((_ text: String, _ cancelled: Bool) -> Void)?

  private var currentSessionId: String?
  private var darwinObserverRegistered = false

  override init() {
    super.init()
    registerDarwinObserver()
  }

  deinit {
    // Retain-cycle-safe: pass the observer pointer, not self.
    CFNotificationCenterRemoveObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(TulmiHandoff.darwinNotification as CFString),
      nil
    )
  }

  // MARK: - State

  /// Whether the main app was foregrounded recently enough that the handoff
  /// will feel near-instant (no cold-launch delay).
  var isAppWarm: Bool {
    let d = UserDefaults(suiteName: TulmiHandoff.appGroup)
    let last = d?.double(forKey: "tulmi.app.lastActiveAt") ?? 0
    let now = Date().timeIntervalSince1970 * 1000
    return (now - last) < TulmiHandoff.warmWindowSeconds * 1000
  }

  // MARK: - Public flow

  /// Kick off a mic handoff. Writes the record-request tombstone, chooses the
  /// primer or record screen based on warmth, and tries to open the URL.
  ///
  /// `openURL` is the actual "open the containing app" callback the caller
  /// provides — we walk it up the responder chain in KeyboardViewController
  /// because keyboards can't call `open(_:)` directly.
  ///
  /// Returns the sessionId so the caller can update UI state.
  func beginHandoff(hostApp: String, openURL: (URL) -> Bool) -> String {
    let sessionId = UUID().uuidString
    currentSessionId = sessionId

    // Write the tombstone so the main app can pick up the request even if the
    // URL open fails (user manually foregrounds the app instead).
    let d = UserDefaults(suiteName: TulmiHandoff.appGroup)
    d?.set(sessionId, forKey: "tulmi.kb.recordRequest.sessionId")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.recordRequest.requestedAt")
    d?.set(hostApp, forKey: "tulmi.kb.recordRequest.hostApp")

    // Also drop a "pending deep link" so the existing consumeKeyboardDeepLink
    // path in SduiApp routes the user to the right screen on next foreground.
    let screenId = isAppWarm ? "keyboard_record" : "keyboard_primer"
    d?.set("screen/\(screenId)", forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")

    // Try to open the containing app directly. Query params ride on top so
    // the SDUI screen can pick up the session id.
    let urlString = "tulmi://s/\(screenId)?session=\(sessionId)&host=\(hostApp.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? hostApp)"
    if let url = URL(string: urlString) {
      _ = openURL(url)
    }
    return sessionId
  }

  /// Called by KeyboardViewController when the mic button is tapped a second
  /// time or the user aborts. Wipes the tombstone so the app doesn't chase a
  /// dead handoff on its next foreground.
  func cancelPending() {
    guard let sid = currentSessionId else { return }
    let d = UserDefaults(suiteName: TulmiHandoff.appGroup)
    let stored = d?.string(forKey: "tulmi.kb.recordRequest.sessionId") ?? ""
    if stored == sid {
      d?.removeObject(forKey: "tulmi.kb.recordRequest.sessionId")
      d?.removeObject(forKey: "tulmi.kb.recordRequest.requestedAt")
      d?.removeObject(forKey: "tulmi.kb.recordRequest.hostApp")
      // Also wipe the pending deep link this handoff dropped (keyboard_record /
      // keyboard_primer). Leaving it behind routed the app to keyboard_record on
      // an unrelated later foreground even though the handoff was aborted.
      d?.removeObject(forKey: "tulmi.kb.pendingDeepLink")
      d?.removeObject(forKey: "tulmi.kb.pendingDeepLinkAt")
    }
    currentSessionId = nil
  }

  // MARK: - Darwin notification

  private func registerDarwinObserver() {
    guard !darwinObserverRegistered else { return }
    darwinObserverRegistered = true
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      observer,
      { _, ptr, _, _, _ in
        guard let ptr = ptr else { return }
        let this = Unmanaged<TulmiHandoff>.fromOpaque(ptr).takeUnretainedValue()
        DispatchQueue.main.async { this.handleDarwinNotification() }
      },
      TulmiHandoff.darwinNotification as CFString,
      nil,
      .deliverImmediately
    )
  }

  private func handleDarwinNotification() {
    let d = UserDefaults(suiteName: TulmiHandoff.appGroup)
    let sid = d?.string(forKey: "tulmi.kb.handoffResult.sessionId") ?? ""
    let text = d?.string(forKey: "tulmi.kb.handoffResult.text") ?? ""
    let cancelled = d?.bool(forKey: "tulmi.kb.handoffResult.cancelled") ?? false
    // Only accept results for the session we started.
    guard let expected = currentSessionId, sid == expected else { return }
    // Clear before firing the callback so a fast second-tap doesn't
    // re-observe the same result.
    d?.removeObject(forKey: "tulmi.kb.handoffResult.sessionId")
    d?.removeObject(forKey: "tulmi.kb.handoffResult.text")
    d?.removeObject(forKey: "tulmi.kb.handoffResult.cancelled")
    d?.removeObject(forKey: "tulmi.kb.handoffResult.completedAt")
    currentSessionId = nil
    onResult?(text, cancelled)
  }
}
