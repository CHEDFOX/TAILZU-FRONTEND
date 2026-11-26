import AppIntents
import Foundation

// X0 BOT'S FOCUS FILTER: "HOLD CALLS DURING A FOCUS" (perms2/SPEC.md 4.2, 10.4).
//
// The person adds this in Settings › Focus › (a Focus) › Focus Filters › Add Filter › X0 Bot. When that Focus
// starts, iOS runs perform() below IN THE APP'S OWN PROCESS, waking or launching the app for it. There is NO
// PERMISSION, no prompt and no usage string: a Focus Filter is something the person wires up in Settings, and
// iOS hands the app only what the filter itself asks for.
//
// WHAT THIS LEARNS, AND WHAT IT SENDS. Only that a Focus with this filter is on, and which of the two things to
// hold. NEVER WHICH FOCUS, never its name, mode, schedule or anything else about it — iOS does not offer that to
// a filter, and this file asks for nothing. (The Focus Status API, which would say "this person is in a Focus" to
// other people, is for messaging apps and is deliberately not used: spec 0, change 1.)
//
// WHERE IT GOES. `tulmi.focus.state = { on, hold, at }` into the App Group, which the app reads through
// tulmi-perms' focusState(), and POST /v1/widgets/focus { on, hold, at } with the WIDGETS' OWN narrow token from the
// shared Keychain — never the session's (the pattern and the helpers are WidgetAct.swift's, next door). A token
// already on a phone carries no focus scope until it is next reissued, so that post may be refused for a while;
// Nudj's own focus.sync, from the app, catches that up, and the row never claims the hold is live until the
// server has seen one state.
//
// PLACEMENT (10.4, settled by the proof build's item 5). This file sits in `_shared`, which @bacons/apple-targets
// builds into the MAIN APP as well as the widget extension — the same arrangement _shared/BotsAtWork.swift's
// LiveActivityIntent already relies on, and the reason perform() can run in the app's process. The one risk is
// that the extension's copy registers the filter a second time, so Settings would list "X0 Bot" twice. If the
// proof build shows that, the fix is option (b): move this one file to a new `app/targets/focus/` app-intent
// target with the App Group and the shared Keychain group in its own expo-target.config.js. Nothing here depends
// on the widget's own types, so the move is the file and nothing else.
//
// HOW "ENDED" ARRIVES (spec 4.2, N0 item 5 records the exact shape). Apple's rule, from WWDC22 session 10121:
// "Perform is also called when the system determines that the previously delivered values are no longer
// relevant. In this case, your Focus filter parameters are configured with the default values." So the END of a
// Focus arrives as a perform() with the parameter at its DEFAULT. That is why `hold` below has NO default and is
// optional: no value means "holds nothing", so the end of a Focus writes and posts `on: false`, which is what
// lifts the hold and lets the server send its one end-of-Focus notice. A default of ".calls" would have made the
// end of every Focus look exactly like switching the hold ON for another 12 hours.
// What Settings offers when the person ADDS the filter is `suggestedFocusFilters` below, which suggests holding
// calls — so the suggestion is helpful without the end-of-Focus call meaning the same thing.
// Belt and braces either way: `at` is stamped on every write, tulmi-perms reads a state older than 12 hours as
// off, and the server expires its own copy at the same 12 hours. So a filter whose end iOS never signalled at all
// can still never hold calls for ever.

/// What X0 Bot holds while the Focus is on. The person picks this in Settings when they add the filter.
@available(iOS 16.0, *)
enum X0FocusHold: String, AppEnum {
  /// Nudj's calls wait; everything else is as usual.
  case calls
  /// Its calls and its other pings wait too.
  case callsAndPings

  static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: "What X0 Bot holds")
  }

  static var caseDisplayRepresentations: [X0FocusHold: DisplayRepresentation] {
    [
      .calls: DisplayRepresentation(title: "Hold Nudj calls"),
      .callsAndPings: DisplayRepresentation(title: "Hold calls and other pings"),
    ]
  }
}

/// The filter itself. iOS runs it when the Focus it was added to starts.
@available(iOS 16.0, *)
struct X0FocusFilter: SetFocusFilterIntent {
  static let title: LocalizedStringResource = "X0 Bot"
  static let description = IntentDescription(
    "While this Focus is on, Nudj's calls wait: what can't wait arrives as a notice instead, and the rest is listed when the Focus ends."
  )

  /// NO DEFAULT, and optional, on purpose: iOS runs perform() with the default values when the Focus's own values
  /// stop being relevant, which is how the END of a Focus arrives. Nothing held is the only honest meaning for
  /// that call.
  @Parameter(title: "While this Focus is on")
  var hold: X0FocusHold?

  /// What Settings offers when the person adds the filter: holding Nudj's calls. This is a SUGGESTION, which
  /// is a different thing from the default the end-of-Focus call carries.
  static func suggestedFocusFilters(for context: FocusFilterSuggestionContext) async -> [X0FocusFilter] {
    var suggested = X0FocusFilter()
    suggested.hold = .calls
    return [suggested]
  }

  /// What Settings shows under "X0 Bot" once the filter is set up.
  var displayRepresentation: DisplayRepresentation {
    switch hold {
    case .callsAndPings: return DisplayRepresentation(title: "Holds calls and other pings")
    case .calls: return DisplayRepresentation(title: "Holds Nudj calls")
    case nil: return DisplayRepresentation(title: "Holds nothing")
    }
  }

  init() {}

  func perform() async throws -> some IntentResult {
    // No value means the Focus ended (or the person chose to hold nothing): `on` is false and the hold lifts.
    let on = hold != nil
    let what = (hold ?? .calls).rawValue
    // ONE MOMENT FOR BOTH. The App Group state and the post carry the same `at`, so the server's 12 hours run from when
    // this filter ran — not from whichever page appear last reposted the state, which pushed the limit forward each time.
    let at = Date().timeIntervalSince1970 * 1000
    X0FocusState.write(on: on, hold: what, at: at)
    await X0FocusState.post(on: on, hold: what, at: at)
    return .result()
  }
}

/// A MARKER THAT THIS BINARY REALLY CARRIES THE FILTER (spec 9.2, rule 4). tulmi-perms' abilities() looks this
/// class up by name, so `focus` is declared only while the filter above is actually compiled in. If the proof
/// build cuts the filter (cut order item 5), this file goes with it, the class is not there, the capability
/// disappears and the server stops drawing the row — with no JavaScript change at all.
/// Deliberately not marked for iOS 16: the class itself uses nothing new, so its presence means exactly "this
/// file is in the binary", and abilities() adds the iOS check itself.
@objc(X0FocusFilterCompiled)
final class X0FocusFilterCompiled: NSObject {}

/// Where the filter's answer goes: the App Group the app reads, and the server, with the widgets' own token.
enum X0FocusState {
  /// The App Group key tulmi-perms' focusState() reads.
  static let key = "tulmi.focus.state"

  /// `{ on, hold, at }`, overwritten at each change. Nothing else, ever.
  static func write(on: Bool, hold: String, at: Double = Date().timeIntervalSince1970 * 1000) {
    guard let store = WidgetAct.store else { return }
    let state: [String: Any] = ["on": on, "hold": hold, "at": at]
    guard let data = try? JSONSerialization.data(withJSONObject: state),
          let line = String(data: data, encoding: .utf8) else { return }
    store.set(line, forKey: key)
  }

  /// POST /v1/widgets/focus { on, hold, at }, with the widgets' own token. Best effort: a refusal changes nothing
  /// here, because the App Group state above is what Nudj's focus.sync sends from the app — with the same `at`.
  static func post(on: Bool, hold: String, at: Double = Date().timeIntervalSince1970 * 1000) async {
    guard let token = WidgetKeychain.string(WidgetAct.tokenAccount), token.hasPrefix("xwt_"),
          let raw = WidgetAct.store?.string(forKey: WidgetAct.tokenMetaKey), let data = raw.data(using: .utf8),
          let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    let expiresAt = WidgetAct.number(meta["expiresAt"]) ?? 0
    guard expiresAt > Date().timeIntervalSince1970 * 1000 else { return }
    let base = (meta["baseUrl"] as? String) ?? WidgetAct.store?.string(forKey: "tulmi.baseUrl") ?? "https://api.x0bot.com"
    guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/widgets/focus"),
          url.scheme == "https" || url.host == "localhost" else { return }
    var request = URLRequest(url: url, timeoutInterval: 12)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(token, forHTTPHeaderField: "X-Widget-Token")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["on": on, "hold": hold, "at": at])
    _ = try? await URLSession.shared.data(for: request)
  }
}
