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
      if !path.isEmpty {
        d?.removeObject(forKey: "tulmi.kb.pendingDeepLink")
        d?.removeObject(forKey: "tulmi.kb.pendingDeepLinkAt")
      }
      return path
    }
  }
}
