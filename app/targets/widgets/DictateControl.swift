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

@available(iOS 18.0, *)
struct DictateControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "space.tailzu.dictate") {
      ControlWidgetButton(action: DictateIntent()) {
        Label("Dictate", systemImage: "waveform")
      }
    }
    .displayName("Dictate")
    .description("Turn the Tailzu microphone on, ready for the keyboard.")
  }
}

@available(iOS 18.0, *)
struct DictateIntent: AppIntent {
  static let title: LocalizedStringResource = "Dictate with Tailzu"
  static let description = IntentDescription("Turns the microphone on so the keyboard can dictate.")
  static let openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult & OpensIntent {
    // The tombstone the keyboard leaves when it opens the app to arm: the app
    // consumes it on arrival and arms. Belt and braces with the URL below.
    let d = UserDefaults(suiteName: Shared.appGroup)
    d?.set("screen/flow_arm", forKey: "tulmi.kb.pendingDeepLink")
    d?.set(Date().timeIntervalSince1970 * 1000, forKey: "tulmi.kb.pendingDeepLinkAt")
    return .result(opensIntent: OpenURLIntent(URL(string: "tulmi://screen/flow_arm")!))
  }
}
