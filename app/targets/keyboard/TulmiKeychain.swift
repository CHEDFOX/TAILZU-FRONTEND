import Foundation
import Security

/// Shared-keychain helper for the Tulmi keyboard extension.
///
/// Mirrors app/modules/tulmi-bridge/ios/TulmiKeychain.swift (must stay in
/// sync — same access group + service + account keys). Both binaries are
/// declared under the same Keychain-Sharing entitlement so they see the
/// same items.
enum TulmiKeychain {
  // The access group MUST be the fully-resolved string. `$(AppIdentifierPrefix)`
  // is a build-setting token that Xcode only expands inside .entitlements /
  // Info.plist — NEVER in compiled Swift source. Using the literal here made
  // every SecItem query target the nonexistent group "$(AppIdentifierPrefix)…",
  // so the keyboard read failed with errSecMissingEntitlement, the bearer token
  // came back nil, and the keyboard fell back to a "dev" token → 401 on every
  // AI call in production. The entitlement `$(AppIdentifierPrefix)com.tulmi.app.shared`
  // expands to `<TeamID>.com.tulmi.app.shared`; appleTeamId is 6552H8HYA4.
  static let accessGroup = "6552H8HYA4.com.tulmi.app.shared"
  static let service = "space.tailzu.tulmi.bearer"

  private static func query(_ key: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: accessGroup,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
  }

  static func string(forKey key: String) -> String? {
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    guard status == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
