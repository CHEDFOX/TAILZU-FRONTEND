import Foundation
import Security

/// Shared-keychain helper for the Tulmi app + keyboard extension.
///
/// The user's bearer token used to sit in a shared UserDefaults suite; that
/// worked but UserDefaults isn't encrypted at rest and gets flagged in App
/// Store review for anything that looks like a credential. Keychain items
/// with a shared access group are the standard fix — both the main app and
/// the Custom Keyboard extension see the same items.
///
/// The access group is `${TeamID}.com.tulmi.app.shared`; Xcode substitutes
/// the team ID at runtime via `$(AppIdentifierPrefix)`. Both the app's
/// Keychain-Sharing entitlement and the keyboard's list this group so both
/// binaries can read/write the same items.
enum TulmiKeychain {
  static let accessGroup = "$(AppIdentifierPrefix)com.tulmi.app.shared"
  static let service = "space.tailzu.tulmi.bearer"

  private static func query(_ key: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: accessGroup,
      // Only readable when the device is unlocked at least once since boot —
      // strong enough for a bearer token, still available to keyboards after
      // a reboot.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
  }

  static func set(_ value: String?, forKey key: String) {
    // Delete any existing item so `add` doesn't fail with duplicate.
    SecItemDelete(query(key) as CFDictionary)
    guard let value = value, !value.isEmpty else { return }
    var attributes = query(key)
    attributes[kSecValueData as String] = value.data(using: .utf8)
    SecItemAdd(attributes as CFDictionary, nil)
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
