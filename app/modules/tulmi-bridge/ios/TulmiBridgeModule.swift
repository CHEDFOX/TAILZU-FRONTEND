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
      defaults?.set(baseUrl, forKey: "tulmi.baseUrl")
      defaults?.set(token, forKey: "tulmi.token")
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
  }
}
