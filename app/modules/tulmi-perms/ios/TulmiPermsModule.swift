import Contacts
import ContactsUI
import CoreLocation
import ExpoModulesCore
import UIKit

/// The iPhone half of the app's own device features: "Add from contacts" and "Use my location" (perms/SPEC.md
/// 2, 3, 6.2), and, from build 8.9.1, the calendar, Reminders, Focus, Motion & Fitness, arrival reminders and
/// abuse prevention (perms2/SPEC.md 2-8).
///
/// EVERY FUNCTION THE MODULE OFFERS IS DECLARED HERE, in one list, and each body is one line into the file that
/// does the work: TulmiCalendar.swift, TulmiReminders.swift, TulmiMotion.swift, TulmiArrival.swift,
/// TulmiTrust.swift. So this file is the whole surface JavaScript can reach, and `abilities()` below is the
/// whole truth about what this binary can actually do.
///
///   pickEmail()                    the system contact picker, no permission at all
///   locationStatus/Ask/Area        one fix, named by the OS geocoder; only the words come back
///   abilities()                    what THIS binary and THIS iOS can do, read from the keys and the OS
///   calendarEditor/Status/Ask/Busy the phone's own editor, and busy times only
///   remindersStatus/Ask/Read/Apply one list, called X0 Bot, and nothing else
///   focusState()                   whether a Focus with X0 Bot's filter is on
///   motionStatus/Ask/Days/Driving  daily steps and walks; and "in a car?" just before a call
///   arrivalArm/List/Clear          reminders the iPhone itself watches for
///   attestKey/Assert/Forget        Apple's App Attest, for abuse prevention only
///   deviceCheckToken()             Apple's DeviceCheck token, for abuse prevention only
///
/// WHAT THIS DELIBERATELY DOES NOT DO. No CNContactStore (that, and only that, would need
/// NSContactsUsageDescription) and no reading, counting or hashing of the address book: the picker runs outside
/// the app and hands back the one address the person tapped. No Always authorization, no region-monitoring
/// delegate, no significant-change or visit service, no background delivery: one fix when a visible control is
/// tapped, and arrival reminders the SYSTEM watches without waking the app. The coordinate never crosses into
/// JavaScript — CLGeocoder, the phone's own map service, turns it into words here and only subLocality /
/// locality / subAdministrativeArea / administrativeArea / isoCountryCode go back. An event's title, place,
/// notes and people, and every list of reminders but our own, are read in Swift and thrown away in Swift. And
/// no Focus Status, no contacts beyond the picker, no speech, no device id built from anything about this phone.
public class TulmiPermsModule: Module {
  /// Read only, for authorizationStatus. Made the first time the status is asked for and kept.
  private var status: CLLocationManager?
  /// Each live job is held here so its delegate is not let go while the system has it.
  private var picking: TulmiContactPick?
  private var asking: TulmiLocationAsk?
  private var locating: TulmiLocateOnce?
  private var editing: TulmiCalendarEditor?
  /// One store each for the calendar and for Reminders, made on first use and kept (perms2 2.6, 3.4).
  private var calendars: TulmiCalendar?
  private var reminders: TulmiReminders?
  private var motion: TulmiMotion?

  /// The group the app, the widgets and the keyboard share. The Focus Filter writes the focus state here.
  private static let appGroup = "group.com.tulmi.app"
  private static let focusKey = "tulmi.focus.state"
  /// A focus state older than this reads as off, whatever it says: the server holds calls for 12 hours at most
  /// (perms2 4.4), so a filter whose end iOS never told us about cannot hold calls for ever.
  private static let focusHours: Double = 12

  private static var fromIOS16: Bool {
    if #available(iOS 16.0, *) { return true } else { return false }
  }

  private static var fromIOS17: Bool {
    if #available(iOS 17.0, *) { return true } else { return false }
  }

  private func calendarStore() -> TulmiCalendar {
    if let made = calendars { return made }
    let made = TulmiCalendar()
    calendars = made
    return made
  }

  private func remindersStore() -> TulmiReminders {
    if let made = reminders { return made }
    let made = TulmiReminders()
    reminders = made
    return made
  }

  private func motionReader() -> TulmiMotion {
    if let made = motion { return made }
    let made = TulmiMotion()
    motion = made
    return made
  }

  public func definition() -> ModuleDefinition {
    Name("TulmiPerms")

    // MARK: contacts and location (perms/SPEC.md)

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

    // MARK: what this binary can do (perms2 9.2)

    /// One truth for the whole app: a name is true only when the FUNCTION, the Info.plist KEY and the iOS
    /// VERSION are all there. So a key cut after the proof build silently removes its capability with no
    /// JavaScript change, and CoreMotion or EventKit can never be called without the key that keeps it from
    /// crashing. Read on the JavaScript thread, so nothing here does any work.
    Function("abilities") { () -> [String: Bool] in
      return [
        // The editor needs no key at all, but only on iOS 17 does it run out of process, which is the whole point.
        "calendarAdd": TulmiPermsModule.fromIOS17,
        "calendarRead": TulmiPermsModule.fromIOS17 && TulmiKeys.says("NSCalendarsFullAccessUsageDescription"),
        "reminders": TulmiPermsModule.fromIOS17 && TulmiKeys.says("NSRemindersFullAccessUsageDescription"),
        // No key and no prompt, so the only honest test is whether the filter's own file is in this binary:
        // FocusFilter.swift carries a marker class, which NSClassFromString finds only while that file is
        // compiled in. Cut the filter and the capability goes with it, with no JavaScript change.
        "focus": TulmiPermsModule.fromIOS16 && NSClassFromString("X0FocusFilterCompiled") != nil,
        "motion": TulmiKeys.says("NSMotionUsageDescription") && TulmiMotion.available(),
        // Sleep is only read when the binary's own Health string says so, in words the person can read.
        "healthSleep": TulmiKeys.mentions("NSHealthShareUsageDescription", "sleep"),
        // Arrival reminders need more than the While Using key, which "Use my location" needs anyway: the key
        // must NAME them (the person reads that sentence before the prompt), and the reduced-accuracy key must
        // be gone, because every fence runs at reduced accuracy while it is true (spec 7.1). Cut either and the
        // capability goes, so the server never draws a row for a behaviour this binary does not have.
        "arrival": TulmiKeys.mentions("NSLocationWhenInUseUsageDescription", "arrival reminder")
          && !TulmiKeys.isTrue("NSLocationDefaultAccuracyReduced"),
        "appAttest": TulmiTrust.appAttestSupported(),
        "deviceCheck": TulmiTrust.deviceCheckSupported(),
        // Google's, and Android's alone.
        "playIntegrity": false,
      ]
    }

    // MARK: calendar (perms2 2)

    /// Apple's own event editor, filled in. No permission and no prompt on iOS 17+, where it runs out of
    /// process; below that the capability is not declared, so this answers "unavailable".
    AsyncFunction("calendarEditor") { (event: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        guard TulmiPermsModule.fromIOS17 else {
          promise.resolve("unavailable")
          return
        }
        if self.editing != nil {
          promise.reject("busy", "The calendar editor is already open.")
          return
        }
        // "unavailable" means the person's phone has no calendar app, which the app says out loud ("There's no
        // calendar app on this phone") — so never for our own troubles. An iPhone always has Calendar.
        guard let host = self.appContext?.utilities?.currentViewController() else {
          promise.reject("no_screen", "There is no screen to open the calendar editor on.")
          return
        }
        guard let job = self.calendarStore().editor(event, host: host, done: { word in
          self.editing = nil
          promise.resolve(word)
        }) else {
          promise.reject("bad_event", "That event has no usable start time.")
          return
        }
        self.editing = job
      }
    }

    /// Never prompts. iOS 17's write-only grant reads as "denied": it cannot see a single busy time.
    Function("calendarStatus") { () -> String in
      return TulmiCalendar.status()
    }

    /// The full-access sheet, only after the app's own card's Continue. iOS offers no read-only calendar grant.
    AsyncFunction("calendarAsk") { (promise: Promise) in
      guard TulmiKeys.says("NSCalendarsFullAccessUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("the calendar"))
        return
      }
      if #available(iOS 17.0, *) {
        self.calendarStore().ask { promise.resolve($0) }
      } else {
        promise.reject("unsupported", "This iPhone's iOS is older than 17, which is the first with a calendar grant X0 Bot can use.")
      }
    }

    /// BUSY TIMES ONLY: `{ s, e, allDay }` per event, free, declined and cancelled ones skipped. No title,
    /// place, note, person or calendar name crosses into JavaScript. No grant means an empty list; a binary with
    /// no calendar key refuses instead, because an empty list is an answer and would clear the server's copy.
    AsyncFunction("calendarBusy") { (fromMs: Double, toMs: Double, most: Int, promise: Promise) in
      guard TulmiKeys.says("NSCalendarsFullAccessUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("the calendar"))
        return
      }
      self.calendarStore().busy(fromMs: fromMs, toMs: toMs, cap: most) { promise.resolve($0) }
    }

    // MARK: Reminders (perms2 3)

    Function("remindersStatus") { () -> String in
      return TulmiReminders.status()
    }

    /// The full-access sheet, only after the app's own card's Continue. Reminders has no write-only grant.
    AsyncFunction("remindersAsk") { (promise: Promise) in
      guard TulmiKeys.says("NSRemindersFullAccessUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("Reminders"))
        return
      }
      if #available(iOS 17.0, *) {
        self.remindersStore().ask { promise.resolve($0) }
      } else {
        promise.reject("unsupported", "This iPhone's iOS is older than 17, which is the first with a Reminders grant X0 Bot can use.")
      }
    }

    /// The X0 Bot list, and only it: `{ listId, items }`. The list is made on the first read.
    AsyncFunction("remindersRead") { (promise: Promise) in
      guard TulmiKeys.says("NSRemindersFullAccessUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("Reminders"))
        return
      }
      self.remindersStore().read { out, code in
        if let out = out {
          promise.resolve(out)
        } else {
          promise.reject(code ?? "failed", "The X0 Bot list could not be opened.")
        }
      }
    }

    /// The server's `{ add, update, remove }`, applied to the X0 Bot list only. Answers `{ applied }`.
    AsyncFunction("remindersApply") { (ops: [String: Any], promise: Promise) in
      guard TulmiKeys.says("NSRemindersFullAccessUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("Reminders"))
        return
      }
      self.remindersStore().apply(ops) { applied, code in
        if let applied = applied {
          promise.resolve(["applied": applied])
        } else {
          promise.reject(code ?? "failed", "The X0 Bot list could not be written to.")
        }
      }
    }

    // MARK: Focus (perms2 4)

    /// What X0 Bot's Focus Filter last saw, or null when it has never run. NEVER WHICH FOCUS: iOS tells the
    /// filter nothing about the Focus it is in, and the filter writes only on/off and what to hold. A state
    /// older than 12 hours reads as off, so a Focus whose end iOS never signalled cannot hold calls for ever.
    Function("focusState") { () -> [String: Any]? in
      guard let store = UserDefaults(suiteName: TulmiPermsModule.appGroup),
            let raw = store.string(forKey: TulmiPermsModule.focusKey),
            let data = raw.data(using: .utf8),
            let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let at = TulmiArgs.number(saved["at"]), at > 0 else { return nil }
      let fresh = at > Date().timeIntervalSince1970 * 1000 - TulmiPermsModule.focusHours * 3_600_000
      return [
        "on": fresh && TulmiArgs.flag(saved["on"]),
        "hold": (saved["hold"] as? String) ?? "calls",
        "at": at,
      ]
    }

    // MARK: Motion & Fitness (perms2 5)

    Function("motionStatus") { () -> String in
      return TulmiMotion.status()
    }

    /// The system sheet, only after the app's own card's Continue. CoreMotion has no ask of its own, so a query
    /// over the last hour is what puts the question up.
    AsyncFunction("motionAsk") { (promise: Promise) in
      guard TulmiKeys.says("NSMotionUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("Motion & Fitness"))
        return
      }
      self.motionReader().ask { promise.resolve($0) }
    }

    /// The same daily summary Apple Health sends: `{ day, steps, spans: [{ kind, minutes }] }` per local day.
    /// Nothing finer than a day, no places, and never a span in a car. `offsetMin` is the minutes to add to UTC
    /// for the phone's own local time.
    AsyncFunction("motionDays") { (fromMs: Double, toMs: Double, offsetMin: Double, promise: Promise) in
      guard TulmiKeys.says("NSMotionUsageDescription") else {
        promise.reject("unsupported", TulmiKeys.cutWords("Motion & Fitness"))
        return
      }
      self.motionReader().days(fromMs: fromMs, toMs: toMs, offsetMin: offsetMin) { days, code in
        if let code = code {
          promise.reject(code, "This phone cannot count steps.")
        } else {
          promise.resolve(days)
        }
      }
    }

    /// "driving" or "not driving", and null when the phone cannot say. Nothing else, and nothing is kept.
    /// A binary without the motion key cannot say: the grant may still be on from an older build, so the key
    /// has to be checked here too rather than trusting the status.
    AsyncFunction("motionDriving") { (windowSec: Double, promise: Promise) in
      guard TulmiKeys.says("NSMotionUsageDescription") else {
        promise.resolve(nil)
        return
      }
      self.motionReader().driving(windowSec: windowSec) { answer in
        // Resolved by hand, not as an optional: a "cannot say" must reach JavaScript as null, not as a false.
        if let answer = answer {
          promise.resolve(answer)
        } else {
          promise.resolve(nil)
        }
      }
    }

    // MARK: arrival reminders (perms2 7)

    /// Replaces the set of places the IPHONE ITSELF watches for. `{ armed }`, or "approximate" when Precise
    /// Location is off, or "denied" without the While Using grant. Nobody is ever told of an arrival.
    AsyncFunction("arrivalArm") { (items: [[String: Any]], promise: Promise) in
      TulmiArrival.arm(items) { promise.resolve($0) }
    }

    /// The item ids the phone is watching for.
    AsyncFunction("arrivalList") { (promise: Promise) in
      TulmiArrival.list { promise.resolve($0) }
    }

    /// Drops every one of them.
    AsyncFunction("arrivalClear") { (promise: Promise) in
      TulmiArrival.clear { promise.resolve(nil) }
    }

    // MARK: abuse and fraud prevention (perms2 8.5)

    /// App Attest: one key for this account on this install, and Apple's statement about it. No prompt, no
    /// screen, never at launch by itself — only when the server's bootstrap asks for it.
    AsyncFunction("attestKey") { (account: String, challenge: String, promise: Promise) in
      TulmiTrust.attest(account: account, challenge: challenge) { out, code in
        if let out = out {
          promise.resolve(out)
        } else {
          promise.reject(code ?? "failed", "App Attest could not answer.")
        }
      }
    }

    /// The same key, signing the server's challenge, so a session can say it is still this app on this phone.
    AsyncFunction("attestAssert") { (account: String, challenge: String, promise: Promise) in
      TulmiTrust.assertion(account: account, challenge: challenge) { out, code in
        if let out = out {
          promise.resolve(out)
        } else {
          promise.reject(code ?? "failed", "App Attest could not sign.")
        }
      }
    }

    /// Forgets this account's key id, for when the server does not know it. The next ask starts a fresh key.
    AsyncFunction("attestForget") { (account: String, promise: Promise) in
      TulmiTrust.forget(account: account)
      promise.resolve(nil)
    }

    /// DeviceCheck: Apple's token for this phone, which the server trades for the two bits Apple keeps for us.
    /// No entitlement and no prompt. The token itself is never kept.
    AsyncFunction("deviceCheckToken") { (promise: Promise) in
      TulmiTrust.deviceToken { token, code in
        if let token = token {
          promise.resolve(token)
        } else {
          promise.reject(code ?? "failed", "DeviceCheck could not answer.")
        }
      }
    }
  }
}

/// WHAT THIS BINARY'S INFO.PLIST SAYS. One reader for all of it, because the keys decide two things at once:
/// what abilities() may claim (perms2 9.2), and whether a call into EventKit, CoreMotion or HealthKit is even
/// allowed — calling one without its usage key CRASHES the app (spec appendix C). The screens the server draws
/// are cached by its own cacheVersion, not by capabilities, so a row left over from before a key was cut can
/// still fire its action once. Every ask and every read checks its own key first, so that firing is a short
/// refusal instead of a crash.
enum TulmiKeys {
  /// Whether this binary's Info.plist carries `name` with words in it.
  static func says(_ name: String) -> Bool {
    guard let words = Bundle.main.object(forInfoDictionaryKey: name) as? String else { return false }
    return !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// Whether that string also names `what`, so a capability is claimed only while the sentence the person reads
  /// before the prompt really covers it.
  static func mentions(_ name: String, _ what: String) -> Bool {
    guard let words = Bundle.main.object(forInfoDictionaryKey: name) as? String else { return false }
    return words.lowercased().contains(what.lowercased())
  }

  /// Whether a plist flag is set to true. A missing key is false.
  static func isTrue(_ name: String) -> Bool {
    return (Bundle.main.object(forInfoDictionaryKey: name) as? NSNumber)?.boolValue ?? false
  }

  /// What a refusal says when the feature is not in this build at all. The person never sees it: the row goes
  /// with the key at the next screen fetch. It is for the log and for whoever reads it next.
  static func cutWords(_ feature: String) -> String {
    return "This build of X0 Bot does not carry \(feature), so it cannot be asked for."
  }
}

/// Reading what JavaScript sent. A number arrives as an NSNumber whatever it looked like in JavaScript, and a
/// missing or odd value must never become a 0 that means something.
enum TulmiArgs {
  static func number(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber else { return nil }
    let out = number.doubleValue
    return out.isFinite ? out : nil
  }

  static func flag(_ value: Any?) -> Bool {
    return (value as? NSNumber)?.boolValue ?? false
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
