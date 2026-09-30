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
/// The access group is `<TeamID>.com.tulmi.app.shared`. It MUST be the fully
/// resolved string here: `$(AppIdentifierPrefix)` is a build token Xcode expands
/// only inside .entitlements / Info.plist, never in compiled Swift. The literal
/// token made SecItemAdd write to a nonexistent group, so the keyboard could
/// never read the token back (fell through to a "dev" token → 401). The
/// entitlement `$(AppIdentifierPrefix)com.tulmi.app.shared` expands to
/// `<TeamID>.com.tulmi.app.shared`; appleTeamId is 6552H8HYA4. Must stay in
/// sync with targets/keyboard/TulmiKeychain.swift.
enum TulmiKeychain {
  static let accessGroup = "6552H8HYA4.com.tulmi.app.shared"
  static let service = "space.tailzu.tulmi.bearer"

  /// THIS DEVICE ONLY. A bearer token has no business in an iCloud Keychain
  /// sync, an encrypted backup or a transfer to a new phone: wherever it lands
  /// it is a live session for this account. After the first unlock, as before,
  /// so the keyboard still has it after a reboot.
  private static var accessible: CFString { kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly }
  /// What every build before this one wrote. Still read, and moved to the
  /// value above, so nobody's keyboard loses its token to the change.
  /// (Computed, not stored: a stored static CFString is a concurrency
  /// diagnostic under strict checking, and these cost nothing to read.)
  private static var legacyAccessible: CFString { kSecAttrAccessibleAfterFirstUnlock }

  /// The item, whatever its accessibility.
  private static func base(_ key: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessGroup as String: accessGroup,
    ]
  }

  private static func query(_ key: String, _ accessibility: CFString) -> [String: Any] {
    var q = base(key)
    q[kSecAttrAccessible as String] = accessibility
    return q
  }

  static func set(_ value: String?, forKey key: String) {
    // Delete BOTH kinds so `add` doesn't fail with duplicate: accessibility is
    // not part of an item's identity, so a legacy item left here would make
    // the add fail and leave the keyboard reading the old token.
    SecItemDelete(base(key) as CFDictionary)
    guard let value = value, !value.isEmpty else { return }
    var attributes = query(key, accessible)
    attributes[kSecValueData as String] = value.data(using: .utf8)
    SecItemAdd(attributes as CFDictionary, nil)
  }

  static func string(forKey key: String) -> String? {
    if let value = read(key, accessible) { return value }
    guard let legacy = read(key, legacyAccessible) else { return nil }
    // Moved IN PLACE rather than deleted and re-added: if setKeyboardCredentials
    // has written a fresher token in the meantime, this matches nothing and
    // cannot put the older one back. Should it fail, the value is still
    // returned, and the next set() rewrites the item with the new attribute.
    let moved: [String: Any] = [kSecAttrAccessible as String: accessible]
    SecItemUpdate(query(key, legacyAccessible) as CFDictionary, moved as CFDictionary)
    return legacy
  }

  private static func read(_ key: String, _ accessibility: CFString) -> String? {
    var q = query(key, accessibility)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    guard status == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
