import Foundation
import Security

// ANSWERING FROM OUTSIDE THE APP, WITH THE WIDGETS' OWN TOKEN.
//
// This file is in `_shared`, so @bacons/apple-targets builds it into the main app as well as the widget extension. Both answer
// the same way, through here:
//
//   the X0 widget's answer pills       AnswerNeedIntent (QuickAccess.swift), run in the extension
//   the Bots at work Live Activity's   AnswerBotsActivityIntent (_shared/BotsAtWork.swift), a LiveActivityIntent, run in the
//                                      app's process, which iOS wakes or launches for it
//
// A press posts POST /v1/widgets/act { item, action, key } with the widgets' OWN token, never the session's. That token
// (POST /v1/widgets/token; backend src/widgets/token.ts) can only answer this person's needs-you and tick their own tasks, runs
// out in a day, is revoked at sign-out, and is kept in the shared Keychain (WidgetKeychain below; the app writes it through the
// bridge's setWidgetToken). Where it posts and when it runs out are in the App Group. What a press did to an item is kept in the
// App Group too (NowStates), so a widget draws it over the item until the app writes fresh data.
//
// Nothing here may use the extension's own types: CI type-checks this folder alone, as the app builds it.

/// The App Group, the keys the answers use, and the post itself.
enum WidgetAct {
  static let appGroup = "group.com.tulmi.app"
  static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }
  /// What a button did to an item since: { "<item>": { "s": "done" | "gone" | "failed", "at": ms } }.
  static let stateKey = "tulmi.widget.now.state"
  /// Where a button posts and when the token runs out: { "baseUrl", "path", "expiresAt" }. Not the token (the Keychain's).
  static let tokenMetaKey = "tulmi.widget.token.meta"
  /// The token's Keychain account.
  static let tokenAccount = "tulmi.widget.token"

  /// A finite JSON number, or nil. Shared by every lenient read.
  static func number(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  /// One answer, posted with the widgets' token. What happened, as the item will show it.
  static func post(item: String, action: String) async -> RowState {
    guard let token = WidgetKeychain.string(tokenAccount), token.hasPrefix("xwt_"),
          let raw = store?.string(forKey: tokenMetaKey), let data = raw.data(using: .utf8),
          let meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .failed }
    let expiresAt = number(meta["expiresAt"]) ?? 0
    guard expiresAt > Date().timeIntervalSince1970 * 1000 else { return .failed }
    let base = (meta["baseUrl"] as? String) ?? store?.string(forKey: "tulmi.baseUrl") ?? "https://api.x0bot.com"
    let path = (meta["path"] as? String).flatMap { $0.hasPrefix("/v1/") ? $0 : nil } ?? "/v1/widgets/act"
    guard let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path),
          url.scheme == "https" || url.host == "localhost" else { return .failed }
    var req = URLRequest(url: url, timeoutInterval: 12)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(token, forHTTPHeaderField: "X-Widget-Token")
    // A key per tap: the server answers it once, whatever reaches it twice.
    let body: [String: Any] = ["item": item, "action": action, "key": "w" + UUID().uuidString.replacingOccurrences(of: "-", with: "")]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
      let (_, res) = try await URLSession.shared.data(for: req)
      let status = (res as? HTTPURLResponse)?.statusCode ?? 0
      if (200..<300).contains(status) { return .done }
      if status == 409 || status == 404 || status == 410 { return .gone }
      return .failed
    } catch {
      return .failed
    }
  }
}

/// The kinds of the widgets the app and the intents redraw.
enum WidgetKinds {
  /// The universal X0 widget (glance v2).
  static let x0 = "space.tailzu.x0"
  static let people = "space.tailzu.people"
}

/// What a button did to an item, until the app next writes the data it came from.
enum RowState: String {
  case done, gone, failed
}

enum NowStates {
  /// Every outcome newer than `since` (ms since 1970).
  static func all(since writtenAt: Double) -> [String: RowState] {
    guard let raw = WidgetAct.store?.string(forKey: WidgetAct.stateKey), let data = raw.data(using: .utf8),
          let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
    var out: [String: RowState] = [:]
    for (item, v) in o {
      guard let e = v as? [String: Any], let s = (e["s"] as? String).flatMap(RowState.init(rawValue:)),
            let at = WidgetAct.number(e["at"]), at > writtenAt else { continue }
      out[item] = s
    }
    return out
  }

  static func set(_ item: String, _ state: RowState) {
    let d = WidgetAct.store
    var o = (d?.string(forKey: WidgetAct.stateKey)?.data(using: .utf8))
      .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
    let now = Date().timeIntervalSince1970 * 1000
    // A day is long enough for any item to have been written again.
    o = o.filter { entry in
      let at = (entry.value as? [String: Any]).flatMap { e in WidgetAct.number(e["at"]) } ?? 0
      return at > now - 86_400_000
    }
    o[item] = ["s": state.rawValue, "at": now]
    if let data = try? JSONSerialization.data(withJSONObject: o), let s = String(data: data, encoding: .utf8) {
      d?.set(s, forKey: WidgetAct.stateKey)
    }
  }
}

/// The widgets' own token, read from the shared Keychain the app writes it to (the bridge's TulmiKeychain, the same group and
/// service as the session's, its own account). Read only, here.
enum WidgetKeychain {
  static let accessGroup = "6552H8HYA4.com.tulmi.app.shared"
  static let service = "space.tailzu.tulmi.bearer"

  static func string(_ account: String) -> String? {
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
