import CryptoKit
import DeviceCheck
import Foundation
import Security

/// ABUSE AND FRAUD PREVENTION, THE IPHONE HALF (perms2/SPEC.md 8.5).
///
/// Three calls to Apple, and nothing else:
///
///   App Attest   generates one key for this account on this install, kept in this app's own Keychain, and asks
///                Apple to vouch that the key belongs to the real X0 Bot on a real iPhone. Later the same key
///                signs a short challenge, which is how a session says it is still that app on that phone.
///   DeviceCheck  asks Apple for a token the server can trade for two bits Apple keeps for us on the phone:
///                "a free plan was already started here" and "abuse confirmed". No prompt, no entitlement.
///
/// THE RULE THIS FILE OBEYS (spec 8.2 rule 1 and §1 rule 7). It builds no identity. It reads NOTHING about this
/// phone or how it is connected: no hardware traits, no vendor or advertising ids, no serial, no model, no
/// storage or uptime numbers, no file dates, no locale or time zone, no screen size, no installed-app probes,
/// nothing about Wi-Fi, mobile data, carriers, addresses or interfaces. Apple's licence forbids deriving an id
/// for a device from such things, and there is no fraud exception. Everything per-device here is Apple's own
/// answer to Apple's own question, and the server keeps only the answer.
///
/// It also sends nothing itself: there is no request made from this file. JavaScript posts what comes back, and
/// what it posts to Apple's own services carries only the token, our challenge hash and our key id — never an
/// account, an email or an address.
///
/// The key ids live in the Keychain, this device only, never iCloud-synced: a key is bound to the phone that made
/// it, so a copy on another phone is worthless. Each is filed under a one-way code of the account id, made with a
/// random key this install generated, so the Keychain itself does not carry a list of the accounts that have
/// signed in here. Every query below PINS THE APP'S OWN access group: the app's keychain-access-groups entitlement
/// lists only the shared group, which Apple then makes the default for an item added without one — and the
/// keyboard (which has Full Access and the network) and the widget extension both hold that shared group. Naming
/// the app-id group, which is always in an app's access list, is what keeps these out of their reach.
enum TulmiTrust {
  private static let service = "space.tailzu.tulmi.attest"
  /// The app's own access group: the team prefix and the bundle id, the same hard-coded prefix WidgetKeychain
  /// uses. No extension holds this one, so nothing but the app can read what is filed here.
  private static let accessGroup = "6552H8HYA4.com.tulmi.app"
  /// The random key the filing codes are made with, made once on this install.
  private static let filingAccount = "attest.filing"

  /// Whether this phone can attest at all. A simulator and an old iPhone cannot, which is NO SIGNAL, never a
  /// penalty (spec 8.2 rule 6).
  static func appAttestSupported() -> Bool {
    return DCAppAttestService.shared.isSupported
  }

  static func deviceCheckSupported() -> Bool {
    return DCDevice.current.isSupported
  }

  // MARK: App Attest

  /// One key for `account` on this install, and Apple's statement about it. Answers `{ keyId, attestation }`
  /// (base64), or a short code:
  ///
  ///   "attested"    this account's key has already been vouched for. Nothing was asked of Apple. The server
  ///                 asks for an ASSERTION with that key instead of a second attestation; attestForget is the
  ///                 one way to start a new key.
  ///   "unavailable" Apple's attestation service could not answer. THE SAME KEY IS KEPT and the next ask tries
  ///                 it again, which is Apple's own instruction and keeps the number of keys on the phone down.
  ///   "unsupported" / "invalid_key" / "invalid" / "system" / "no_store" / "failed"
  static func attest(account: String, challenge: String, done: @escaping ([String: String]?, String?) -> Void) {
    let apple = DCAppAttestService.shared
    guard apple.isSupported else {
      done(nil, "unsupported")
      return
    }
    guard !challenge.isEmpty, let filed = filing(account) else {
      done(nil, "no_store")
      return
    }
    // Where a key waits between being generated and being vouched for. Apple counts the keys generated on a
    // phone and scores them (spec 8.5: more than 3 in 30 days is a mark against the account), so a key is
    // written down BEFORE Apple is asked about it and is never thrown away for a network failure.
    let pending = filed + ".pending"
    let hash = Data(SHA256.hash(data: Data(("x0|attest|" + challenge).utf8)))
    var answered = false
    func finish(_ ok: [String: String]?, _ code: String?) {
      if answered { return }
      answered = true
      done(ok, code)
    }

    // Already vouched for. Apple's own header says attestKey on an attested key comes back as
    // DCErrorInvalidKey, so asking again would spend a call to Apple and get us nowhere.
    if !TulmiTrust.keyId(filed).isEmpty {
      finish(nil, "attested")
      return
    }

    /// Apple's statement about the key this install is part way through filing.
    func vouch(_ keyId: String) {
      apple.attestKey(keyId, clientDataHash: hash) { statement, error in
        if let statement = statement, error == nil {
          _ = keep(filed, keyId)
          drop(pending)
          finish(["keyId": keyId, "attestation": statement.base64EncodedString()], nil)
          return
        }
        switch reason(error) {
        case "unavailable":
          // Apple: "retry attestation again using the same key and client data hash later to avoid
          // unnecessarily generating new keys". So the key stays pending and the next ask reuses it: a person
          // on a patchy mobile connection must not spend a key, and their score with it, on every try.
          finish(nil, "unavailable")
        case "invalid_key":
          // Apple's word for a key that has already been attested. File it, so the server moves on to an
          // assertion instead of making yet another key.
          _ = keep(filed, keyId)
          drop(pending)
          finish(nil, "attested")
        case "invalid":
          // Something about the key itself or the hash is wrong, and will be wrong again: let it go.
          drop(pending)
          finish(nil, "invalid")
        case let code:
          // A system failure or something new: keep the key and try it again next time, as above.
          finish(nil, code)
        }
      }
    }

    let waiting = TulmiTrust.keyId(pending)
    if !waiting.isEmpty {
      vouch(waiting)
      return
    }
    apple.generateKey { made, error in
      guard let made = made, error == nil else {
        finish(nil, reason(error))
        return
      }
      guard keep(pending, made) else {
        finish(nil, "no_store")
        return
      }
      vouch(made)
    }
  }

  /// This account's kept key, signing the server's challenge. Answers `{ keyId, assertion }` (base64), or a code.
  /// "no_key" means there is nothing to sign with yet and the server should ask for an attestation first.
  static func assertion(account: String, challenge: String, done: @escaping ([String: String]?, String?) -> Void) {
    let apple = DCAppAttestService.shared
    guard apple.isSupported else {
      done(nil, "unsupported")
      return
    }
    guard !challenge.isEmpty, let filed = filing(account) else {
      done(nil, "no_store")
      return
    }
    let keyId = TulmiTrust.keyId(filed)
    guard !keyId.isEmpty else {
      done(nil, "no_key")
      return
    }
    let hash = Data(SHA256.hash(data: Data(("x0|assert|" + challenge).utf8)))
    apple.generateAssertion(keyId, clientDataHash: hash) { signed, error in
      guard let signed = signed, error == nil else {
        let code = reason(error)
        // The key is gone: forget it, so the next ask starts a new one instead of failing for ever.
        if code == "invalid_key" { drop(filed) }
        done(nil, code)
        return
      }
      done(["keyId": keyId, "assertion": signed.base64EncodedString()], nil)
    }
  }

  /// Drops this account's key id, filed and half-filed, for when the server does not know it (its row went, or
  /// the statement was refused). The next attestation then starts a fresh key. This is the ONLY way a new key is
  /// started once one is filed, so nothing else in this file can quietly spend keys.
  static func forget(account: String) {
    guard let filed = filing(account) else { return }
    drop(filed)
    drop(filed + ".pending")
  }

  /// The key id filed under `account`, or "" when there is none.
  private static func keyId(_ account: String) -> String {
    guard let kept = read(account), let out = String(data: kept, encoding: .utf8) else { return "" }
    return out
  }

  // MARK: DeviceCheck

  /// Apple's token for this phone, for the server to trade for the two bits Apple keeps for us. Answers the
  /// token in base64, or a code. The token is never kept, here or on the server.
  static func deviceToken(done: @escaping (String?, String?) -> Void) {
    let phone = DCDevice.current
    guard phone.isSupported else {
      done(nil, "unsupported")
      return
    }
    phone.generateToken { token, error in
      guard let token = token, error == nil else {
        done(nil, reason(error))
        return
      }
      done(token.base64EncodedString(), nil)
    }
  }

  // MARK: Apple's errors, in words the server logs

  private static func reason(_ error: Error?) -> String {
    guard let error = error else { return "failed" }
    guard let apple = error as? DCError else { return "failed" }
    switch apple.code {
    case .featureUnsupported: return "unsupported"
    // Apple's service could not answer. NOT the same thing as Apple asking us to slow down: it is usually this
    // phone's own connection, so it must not be reported as throttling, which the server would read as a reason
    // to put attestation into shadow for everybody (spec 8.5). The key is kept and tried again.
    case .serverUnavailable: return "unavailable"
    case .invalidKey: return "invalid_key"
    case .invalidInput: return "invalid"
    case .unknownSystemFailure: return "system"
    @unknown default: return "failed"
    }
  }

  // MARK: where the key ids are filed

  /// The Keychain account one key id is filed under: a one-way code of the account id, made with this install's
  /// own random key, so nothing here spells out who has signed in on this phone.
  private static func filing(_ account: String) -> String? {
    guard !account.isEmpty, let key = filingKey() else { return nil }
    let code = HMAC<SHA256>.authenticationCode(for: Data(account.utf8), using: key)
    return "key." + Data(code).map { String(format: "%02x", $0) }.joined()
  }

  private static func filingKey() -> SymmetricKey? {
    if let kept = read(filingAccount), kept.count == 32 { return SymmetricKey(data: kept) }
    var fresh = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, fresh.count, &fresh) == errSecSuccess else { return nil }
    let made = Data(fresh)
    guard keep(filingAccount, made) else { return nil }
    return SymmetricKey(data: made)
  }

  private static func item(_ account: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      // Named on every add, read and delete. Without it the item would land in the app's DEFAULT group, which
      // is the shared one the keyboard and the widgets can read.
      kSecAttrAccessGroup as String: accessGroup,
    ]
  }

  private static func read(_ account: String) -> Data? {
    var query = item(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
  }

  private static func keep(_ account: String, _ value: Data) -> Bool {
    SecItemDelete(item(account) as CFDictionary)
    var adding = item(account)
    adding[kSecValueData as String] = value
    // This phone only, after the first unlock: a key that followed a backup to another phone would be useless
    // anyway, and one that left this phone at all would be worse.
    adding[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(adding as CFDictionary, nil) == errSecSuccess
  }

  private static func drop(_ account: String) {
    SecItemDelete(item(account) as CFDictionary)
  }

  private static func keep(_ account: String, _ value: String) -> Bool {
    guard let data = value.data(using: .utf8) else { return false }
    return keep(account, data)
  }
}
