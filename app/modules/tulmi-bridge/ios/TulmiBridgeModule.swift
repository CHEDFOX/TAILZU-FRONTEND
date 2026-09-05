import ExpoModulesCore

/// Writes the app's backend URL + the user's token into the shared App Group so
/// the Tulmi keyboard extension can read them (it's sandboxed separately from
/// the main app, so an App Group is the only way to share).
public class TulmiBridgeModule: Module {
  // Must match the App Group declared in the app + keyboard entitlements.
  private static let appGroup = "group.com.tulmi.app"

  public func definition() -> ModuleDefinition {
    Name("TulmiBridge")

    Function("setKeyboardCredentials") { (baseUrl: String, token: String) in
      let defaults = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      // baseUrl isn't sensitive — user-visible in Connection screen. Kept in
      // UserDefaults so a keyboard cold-start doesn't wait on Keychain.
      defaults?.set(baseUrl, forKey: "tulmi.baseUrl")
      // Bearer token lives in the shared Keychain — encrypted at rest and out
      // of any UserDefaults dump. The keyboard reads it via TulmiKeychain.
      TulmiKeychain.set(token, forKey: "tulmi.token")
      // Clear any legacy token still sitting in UserDefaults from an older
      // build so a compromised backup can't leak it forever.
      defaults?.removeObject(forKey: "tulmi.token")
    }

    // User-selected language code (hi / es / fr / hinglish / auto / …). The
    // keyboard reads this to bias STT and to pass into refine so refinement
    // output lands in the user's tongue. Called by the main app on language
    // change (LanguageSelectScreen + Settings).
    Function("setKeyboardLanguage") { (code: String) in
      let defaults = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      defaults?.set(code, forKey: "tulmi.language")
    }

    // Text-expansion dictionary (JSON array of { word, replacement }). The
    // keyboard reads this from the App Group and expands typed triggers.
    Function("setDictionary") { (json: String) in
      let defaults = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      defaults?.set(json, forKey: "tulmi.dictionary")
    }

    // Read the keyboard's published state from the shared App Group. The
    // keyboard writes these whenever it runs (see KeyboardViewController), so a
    // non-zero lastActive means it's enabled, and fullAccess reflects whether
    // the user granted "Allow Full Access".
    Function("getKeyboardStatus") { () -> [String: Any] in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      let fullAccess = d?.bool(forKey: "tulmi.kb.fullAccess") ?? false
      let lastActive = d?.double(forKey: "tulmi.kb.lastActive") ?? 0
      return [
        "enabled": lastActive > 0,
        "fullAccess": fullAccess,
        "lastActiveMs": lastActive,
      ]
    }

    // Deep-link tombstone: keyboard extensions cannot call open(_:) from
    // NSExtensionContext, so `openApp` / `openSettings` actions leave a
    // pending path here. The app reads + clears it on foreground.
    // Returns "" when nothing is pending.
    Function("consumeKeyboardDeepLink") { () -> String in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      let path = d?.string(forKey: "tulmi.kb.pendingDeepLink") ?? ""
      guard !path.isEmpty else { return "" }
      // Only honor a RECENT tombstone. The keyboard writes this on a mic tap and
      // tries to open the app; when that open fails (iOS often refuses it), the
      // tombstone lingers and would otherwise fire on the NEXT, unrelated app
      // launch — dumping the user on the flow-arm ("swipe back") screen out of
      // nowhere. Always clear it; only return it if it's fresh (~45s), which
      // covers "tapped the mic, then opened the app by hand" without hijacking a
      // later normal open.
      let at = d?.double(forKey: "tulmi.kb.pendingDeepLinkAt") ?? 0
      let ageMs = Date().timeIntervalSince1970 * 1000 - at
      d?.removeObject(forKey: "tulmi.kb.pendingDeepLink")
      d?.removeObject(forKey: "tulmi.kb.pendingDeepLinkAt")
      if at <= 0 || ageMs > 45_000 { return "" }
      return path
    }

    // MARK: - Mic handoff

    // The keyboard extension can't hold the microphone (iOS blocks recording
    // in extension processes even with Full Access). So mic input flows:
    //   keyboard mic tap → writes a record-request tombstone to App Group +
    //                      opens tulmi://s/keyboard_record (warm) or
    //                      tulmi://s/keyboard_primer (cold)
    //   main app        → foregrounds, records via AVAudioEngine, uploads to
    //                      /v1/transcribe-clean, writes the cleaned text back
    //                      to App Group + fires a Darwin notification
    //   keyboard        → listens for the Darwin notification, reads the
    //                      result, inserts at the cursor
    //
    // "Warm" = the main app has been foregrounded within the last 15 minutes,
    // so the handoff to it feels near-instant. "Cold" = the primer screen
    // gets shown so the user knows to grant mic + come back.

    // Called by SduiApp on every foreground so the keyboard can tell whether
    // the app is warm (fast handoff) or cold (needs the primer flow).
    Function("writeAppWarmHeartbeat") { () in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.app.lastActiveAt")
    }

    // Called by SduiApp on foreground to see whether the keyboard left a
    // pending record-request. Returns [sessionId, requestedAtMs] or empty
    // strings when nothing is pending. Consumes the tombstone.
    Function("consumeKeyboardRecordRequest") { () -> [String: Any] in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      let sid = d?.string(forKey: "tulmi.kb.recordRequest.sessionId") ?? ""
      let at = d?.double(forKey: "tulmi.kb.recordRequest.requestedAt") ?? 0
      let host = d?.string(forKey: "tulmi.kb.recordRequest.hostApp") ?? ""
      if !sid.isEmpty {
        d?.removeObject(forKey: "tulmi.kb.recordRequest.sessionId")
        d?.removeObject(forKey: "tulmi.kb.recordRequest.requestedAt")
        d?.removeObject(forKey: "tulmi.kb.recordRequest.hostApp")
      }
      return [
        "sessionId": sid,
        "requestedAtMs": at,
        "hostApp": host,
      ]
    }

    // Called by the SDUI completeKeyboardHandoff action once the main app has
    // recorded + refined the text. Writes the result to the App Group + fires
    // a Darwin notification; the keyboard extension observes that
    // notification and inserts the text at the cursor.
    Function("completeKeyboardHandoff") { (sessionId: String, text: String) in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      d?.set(text, forKey: "tulmi.kb.handoffResult.text")
      d?.set(sessionId, forKey: "tulmi.kb.handoffResult.sessionId")
      d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.handoffResult.completedAt")
      // Darwin notifications wake the extension synchronously when it's
      // alive — same-App-Group cross-process nudge. Name is stable so the
      // extension registers once at load.
      let name = "space.tailzu.tulmi.handoff.complete" as CFString
      CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(name),
        nil, nil, true
      )
    }

    // MARK: - Flow Session (background-audio mic)

    // Arm the background-audio Flow Session. Called by the SDUI arming screen
    // when it loads. The app then holds the mic alive in the background and the
    // keyboard drives each dictation over Darwin notifications (see
    // FlowSessionManager). idleTimeoutMs comes from the backend (kb.flow.*).
    // `oneShot` picks the transport for each utterance: false streams it to the
    // socket (partials at the cursor), true buffers it and POSTs once at stop
    // (nothing until the finished text lands). Backend-chosen — see
    // kb.flow.transport.
    Function("armFlowSession") { (baseUrl: String, token: String, language: String, idleTimeoutMs: Double, oneShot: Bool) in
      FlowSessionManager.shared.arm(
        baseUrl: baseUrl, token: token, language: language, idleTimeoutMs: idleTimeoutMs,
        oneShot: oneShot)
    }

    // End the Flow Session (user turned Flow off). Deactivates the audio session
    // and tells the keyboard the session is over.
    Function("endFlowSession") { () in
      FlowSessionManager.shared.end()
    }

    // Whether a Flow Session is currently armed in this process.
    Function("isFlowActive") { () -> Bool in
      FlowSessionManager.shared.isArmed
    }

    // Called by SduiApp when the user cancels / abandons the handoff so the
    // keyboard's status returns to idle instead of "recording…" forever.
    Function("cancelKeyboardHandoff") { (sessionId: String) in
      let d = UserDefaults(suiteName: TulmiBridgeModule.appGroup)
      d?.set(sessionId, forKey: "tulmi.kb.handoffResult.sessionId")
      d?.set("", forKey: "tulmi.kb.handoffResult.text")
      d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.handoffResult.completedAt")
      d?.set(true, forKey: "tulmi.kb.handoffResult.cancelled")
      let name = "space.tailzu.tulmi.handoff.complete" as CFString
      CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(name),
        nil, nil, true
      )
    }
  }
}
