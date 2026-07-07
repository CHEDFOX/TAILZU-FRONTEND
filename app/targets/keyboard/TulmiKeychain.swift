import Foundation
import Security

/// Shared-keychain helper for the Tulmi keyboard extension.
///
/// Mirrors app/modules/tulmi-bridge/ios/TulmiKeychain.swift (must stay in
/// sync — same access group + service + account keys). Both binaries are
/// declared under the same Keychain-Sharing entitlement so they see the
/// same items.
enum TulmiKeychain {
  static let accessGroup = "$(AppIdentifierPrefix)com.tulmi.app.shared"
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
