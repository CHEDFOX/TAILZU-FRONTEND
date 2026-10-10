import AppIntents
import SwiftUI
import WidgetKit

// DICTATE. A Control for Control Center, the Lock Screen and the Action Button
// (iOS 18). One press turns the Tailzu microphone on — the Flow session the
// keyboard dictates through — so the keyboard's mic key is ready the moment the
// keyboard comes up, without finding the app first.
//
// Arming has to happen in the app (it holds the audio session), so the press
// opens the app on its arming screen, which arms and says "swipe back" — the
// same path the keyboard's own mic key takes, one tap earlier.

/// The control's words, as the app last wrote them to the App Group
/// (tulmi.widget.dictate, from widget.dictate.* — see src/widgets/month.ts).
/// Each falls back to the literal it replaced. Only the button's label and
/// symbol are read here: `.displayName` / `.description` below are the Controls
/// gallery's metadata, which iOS reads before the app has ever run and which
/// take a LocalizedStringResource, so they stay compile-time literals.
@available(iOS 18.0, *)
enum DictateLook {
  private static func value(_ key: String, _ fallback: String) -> String {
    guard let raw = UserDefaults(suiteName: Shared.appGroup)?.string(forKey: "tulmi.widget.dictate"),
          let data = raw.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let s = o[key] as? String, !s.isEmpty
    else { return fallback }
    return s
  }
  static var label: String { value("label", "Dictate") }
  static var symbol: String { value("symbol", "waveform") }
}

@available(iOS 18.0, *)
struct DictateControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "space.tailzu.dictate") {
      ControlWidgetButton(action: DictateIntent()) {
        // The tile's label + symbol render here, so they can be the server's.
        Label(DictateLook.label, systemImage: DictateLook.symbol)
      }
    }
    // Gallery metadata — compile-time static (see DictateLook).
    .displayName("Dictate")
    .description("Turn the Tailzu microphone on, ready for the keyboard.")
  }
}

@available(iOS 18.0, *)
struct DictateIntent: AppIntent {
  static let title: LocalizedStringResource = "Dictate with Tailzu"
  static let description = IntentDescription("Turns the microphone on so the keyboard can dictate.")
  // No openAppWhenRun: that runs perform() inside the APP, and this intent is
  // compiled only into the widget extension, so the press would find nothing
  // to run. It runs here instead and opens the app by returning the URL.

  func perform() async throws -> some IntentResult & OpensIntent {
    // Which screen arms is the server's (widget.dictate.path in the app's
    // flags, written here by the app as "tulmi.widget.dictate.path").
    let d = UserDefaults(suiteName: Shared.appGroup)
    let sent = d?.string(forKey: "tulmi.widget.dictate.path") ?? ""
    let path = sent.isEmpty ? "screen/flow_arm" : sent
    // The tombstone the keyboard leaves when it opens the app to arm: the app
    // consumes it on arrival and arms. Belt and braces with the URL below.
    d?.set(path, forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
    let url = URL(string: "tulmi://\(path)") ?? URL(string: "tulmi://screen/flow_arm")!
    return .result(opensIntent: OpenURLIntent(url))
  }
}
