import ExpoModulesCore
import Contacts
import ContactsUI
import CoreLocation
import UIKit

/// The iPhone half of "Add from contacts" and "Use my location" (perms/SPEC.md 2, 3, 6.2).
///
/// Three functions, and nothing else:
///   pickEmail()           the system contact picker, no permission at all
///   locationStatus()      what the system says today; never prompts
///   locationAsk()         requestWhenInUseAuthorization, after the app's own card
///   locationArea(timeout) one fix, named by CLGeocoder; only the words come back
///
/// WHAT THIS DELIBERATELY DOES NOT DO. No CNContactStore (that, and only that,
/// would need NSContactsUsageDescription) and no reading, counting or hashing
/// of the address book: the picker runs outside the app and hands back the one
/// address the person tapped. No Always authorization, no region monitoring, no
/// significant-change or visit service, no background delivery: one fix when a
/// visible control is tapped, which is what NSLocationWhenInUseUsageDescription
/// claims. And the coordinate never crosses into JavaScript — CLGeocoder, which
/// is the phone's own map service, turns it into words here and only
/// subLocality / locality / subAdministrativeArea / administrativeArea /
/// isoCountryCode go back. No thoroughfare, no postal code, no CLLocation.
public class TulmiPermsModule: Module {
  /// Read only, for authorizationStatus. Made the first time the status is asked for and kept.
  private var status: CLLocationManager?
  /// Each live job is held here so its delegate is not let go while the system has it.
  private var picking: TulmiContactPick?
  private var asking: TulmiLocationAsk?
  private var locating: TulmiLocateOnce?

  public func definition() -> ModuleDefinition {
    Name("TulmiPerms")

    /// The one email tapped, or null when the person backed out. Rejects only when no picker could open.
    AsyncFunction("pickEmail") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let host = self.appContext?.utilities?.currentViewController() else {
          promise.reject("no_screen", "There is no screen to open the contact picker on.")
          return
        }
        if self.picking != nil {
          promise.reject("busy", "The contact picker is already open.")
          return
        }
        let job = TulmiContactPick { email in
          self.picking = nil
          promise.resolve(email)
        }
        self.picking = job
        host.present(job.controller(), animated: true)
      }
    }

    /// Never prompts. iOS has no "refused once, ask again": a refusal from an earlier run is "blocked".
    Function("locationStatus") { () -> String in
      if self.status == nil { self.status = CLLocationManager() }
      return TulmiPermsWords.word(self.status?.authorizationStatus ?? .notDetermined, justAsked: false)
    }

    /// The system sheet, only after the app's own card's Continue. Resolves once the person has answered.
    AsyncFunction("locationAsk") { (promise: Promise) in
      DispatchQueue.main.async {
        if self.asking != nil {
          promise.reject("busy", "The location question is already up.")
          return
        }
        let job = TulmiLocationAsk { word in
          self.asking = nil
          promise.resolve(word)
        }
        self.asking = job
        job.ask()
      }
    }

    /// One fix, then the phone's own geocoder. null when the place could not be named; rejects when there was no fix.
    AsyncFunction("locationArea") { (timeoutMs: Double, promise: Promise) in
      DispatchQueue.main.async {
        if self.locating != nil {
          promise.reject("busy", "A fix is already being taken.")
          return
        }
        let job = TulmiLocateOnce(timeoutMs: timeoutMs) { parts, failed in
          self.locating = nil
          if failed {
            promise.reject("no_fix", "The phone could not say where it is.")
          } else {
            promise.resolve(parts)
          }
        }
        self.locating = job
        job.start()
      }
    }
  }
}

/// The words JavaScript knows (modules/tulmi-perms/index.ts LocationWord).
enum TulmiPermsWords {
  static func word(_ status: CLAuthorizationStatus, justAsked: Bool) -> String {
    switch status {
    case .authorizedWhenInUse, .authorizedAlways: return "granted"
    // Refused on the sheet we just put up: the app may ask again another day, so the card
    // says "type your area instead". The same status read cold is a no from an earlier run,
    // which only Settings can undo.
    case .denied: return justAsked ? "denied" : "blocked"
    case .restricted: return "blocked"
    case .notDetermined: return "undetermined"
    @unknown default: return "undetermined"
    }
  }
}

/// The system contact picker. No permission, no prompt, no CNContactStore.
private final class TulmiContactPick: NSObject, CNContactPickerDelegate {
  private let done: (String?) -> Void
  private var answered = false

  init(done: @escaping (String?) -> Void) {
    self.done = done
    super.init()
  }

  func controller() -> CNContactPickerViewController {
    let c = CNContactPickerViewController()
    c.delegate = self
    // Only email addresses are shown, a contact with none is greyed out, and a contact with
    // exactly one is picked in a single tap. A contact with several opens its card instead,
    // and the didSelect(property:) below gets the one address tapped.
    c.displayedPropertyKeys = [CNContactEmailAddressesKey]
    c.predicateForEnablingContact = NSPredicate(format: "emailAddresses.@count > 0")
    c.predicateForSelectionOfContact = NSPredicate(format: "emailAddresses.@count == 1")
    return c
  }

  private func finish(_ email: String?) {
    if answered { return }
    answered = true
    let clean = (email ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    done(clean.isEmpty ? nil : clean)
  }

  func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
    finish(nil)
  }

  func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) {
    finish(contact.emailAddresses.first.map { $0.value as String })
  }

  func contactPicker(_ picker: CNContactPickerViewController, didSelect contactProperty: CNContactProperty) {
    finish(contactProperty.value as? String)
  }
}

/// requestWhenInUseAuthorization, and the answer. Never asks for Always.
private final class TulmiLocationAsk: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let done: (String) -> Void
  private var answered = false

  init(done: @escaping (String) -> Void) {
    self.done = done
    super.init()
    manager.delegate = self
  }

  func ask() {
    let now = manager.authorizationStatus
    if now != .notDetermined {
      finish(TulmiPermsWords.word(now, justAsked: false))
      return
    }
    manager.requestWhenInUseAuthorization()
  }

  func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
    // Fires once as soon as the delegate is set, and again when the person answers.
    let now = m.authorizationStatus
    if now == .notDetermined { return }
    finish(TulmiPermsWords.word(now, justAsked: true))
  }

  private func finish(_ word: String) {
    if answered { return }
    answered = true
    manager.delegate = nil
    done(word)
  }
}

/// One fix, at a kilometre, and the phone's own geocoder. Nothing is kept and nothing repeats.
private final class TulmiLocateOnce: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private let geocoder = CLGeocoder()
  /// (the area's words or nil, whether there was no fix at all)
  private let done: ([String: String]?, Bool) -> Void
  private let timeoutMs: Double
  private var answered = false

  init(timeoutMs: Double, done: @escaping ([String: String]?, Bool) -> Void) {
    self.done = done
    self.timeoutMs = timeoutMs
    super.init()
    manager.delegate = self
    // A kilometre is all an area name needs, and it matches Android asking for COARSE only.
    manager.desiredAccuracy = kCLLocationAccuracyKilometer
  }

  func start() {
    let now = manager.authorizationStatus
    guard now == .authorizedWhenInUse || now == .authorizedAlways else {
      finish(nil, true)
      return
    }
    let wait = timeoutMs.isFinite && timeoutMs > 0 ? timeoutMs : 15_000
    DispatchQueue.main.asyncAfter(deadline: .now() + wait / 1000) { [weak self] in
      self?.finish(nil, true)
    }
    manager.requestLocation()
  }

  func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let spot = locations.last else {
      finish(nil, true)
      return
    }
    // CLGeocoder is the phone's own service: it sends the point to Apple. Only words come back here.
    geocoder.reverseGeocodeLocation(spot) { [weak self] marks, _ in
      self?.finish(TulmiLocateOnce.parts(marks?.first), false)
    }
  }

  func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
    finish(nil, true)
  }

  private func finish(_ parts: [String: String]?, _ failed: Bool) {
    if answered { return }
    answered = true
    manager.delegate = nil
    geocoder.cancelGeocode()
    done(parts, failed)
  }

  /// The area, in words. Street, house number and postcode are never read off the placemark.
  private static func parts(_ mark: CLPlacemark?) -> [String: String]? {
    guard let mark = mark else { return nil }
    var out: [String: String] = [:]
    func put(_ key: String, _ value: String?) {
      guard let v = value?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty else { return }
      out[key] = v
    }
    put("subLocality", mark.subLocality)
    put("locality", mark.locality)
    put("subAdminArea", mark.subAdministrativeArea)
    put("adminArea", mark.administrativeArea)
    put("countryCode", mark.isoCountryCode)
    return out.isEmpty ? nil : out
  }
}
