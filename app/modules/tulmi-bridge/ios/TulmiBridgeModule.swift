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
  }
}
