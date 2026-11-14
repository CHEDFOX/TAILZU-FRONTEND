import CoreLocation
import Foundation
import UserNotifications

/// ARRIVAL REMINDERS, WATCHED BY THE IPHONE ITSELF (perms2/SPEC.md 7).
///
/// The app hands iOS a place and a reminder to show on arrival, and iOS does the rest: THE SYSTEM watches the
/// place and puts the notification up. The app is not woken, nothing is sent anywhere, and neither this file nor
/// the server is ever told that the person arrived — there is no handler here to be told.
///
/// That is also why this needs only Location While Using: Apple's own words, "because the system actually
/// monitors the regions, you don't need to request always permissions". So: no Always, no background location
/// mode, no region-monitoring delegate, no visit or significant-change service, and no reading of where the
/// person is. The places come from the server, which geocoded them from what the person typed.
///
/// Precise Location is required, because a fence at reduced accuracy is useless: if the person gave only
/// Approximate, this refuses and says so, and the switch stays off.
enum TulmiArrival {
  /// Every request this feature owns starts with this. Nothing else of the app's is ever touched.
  static let idPrefix = "x0.arrive."
  /// iOS caps an app's monitored conditions, so the server sends ten at most and this never arms more.
  static let maxItems = 10
  static let minRadius: Double = 100
  static let maxRadius: Double = 500

  /// Replaces the armed set with `items`. Answers `{ armed: n }`, or "approximate" / "denied" when the grant is
  /// not enough. Items the caller sends beyond the first ten, or with a bad id, place or radius, are dropped.
  /// Reminders this phone is watching for that are NOT in `items` are taken off whatever the grant says, so a
  /// finished or deleted item never waits for a grant to come back and then goes off.
  static func arm(_ items: [[String: Any]], done: @escaping (Any) -> Void) {
    let manager = CLLocationManager()
    let auth = manager.authorizationStatus
    let granted = auth == .authorizedWhenInUse || auth == .authorizedAlways
    let precise = manager.accuracyAuthorization == .fullAccuracy

    let wanted = Array(items.compactMap(one).prefix(maxItems))
    let center = UNUserNotificationCenter.current()
    center.getPendingNotificationRequests { pending in
      // THE CLEARING OUT COMES FIRST, before the grant is looked at. Taking a request off the phone reads
      // nothing and needs no permission, and a reminder for an item that is now done or deleted has to go even
      // when the person has since turned Precise off or taken the location grant away. Otherwise it stays
      // pending and fires on arrival the moment the grant comes back.
      let keeping = Set(wanted.map { idPrefix + $0.id })
      let stale = pending.map { $0.identifier }.filter { $0.hasPrefix(idPrefix) && !keeping.contains($0) }
      if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }

      guard granted else {
        done("denied")
        return
      }
      // A fence at reduced accuracy is useless, so nothing new is armed and the switch stays off.
      guard precise else {
        done("approximate")
        return
      }
      guard !wanted.isEmpty else {
        done(["armed": 0])
        return
      }
      let counting = DispatchQueue(label: "space.tailzu.perms.arrival")
      var armed = 0
      let waiting = DispatchGroup()
      for item in wanted {
        let id = idPrefix + item.id
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        var carried: [String: Any] = ["kind": "arrival"]
        if let screen = item.screen { carried["screen"] = screen }
        content.userInfo = carried
        // A circular region is what a location trigger still takes, deprecated elsewhere or not.
        let area = CLCircularRegion(
          center: CLLocationCoordinate2D(latitude: item.lat, longitude: item.lon),
          radius: item.radius,
          identifier: id
        )
        // On the way in only. Leaving a place is nobody's business, and an exit would be a second reminder.
        area.notifyOnEntry = true
        area.notifyOnExit = false
        let request = UNNotificationRequest(
          identifier: id,
          content: content,
          // One shot. The next sync arms it again while the item is still open, so it reminds on each arrival.
          trigger: UNLocationNotificationTrigger(region: area, repeats: false)
        )
        waiting.enter()
        center.add(request) { error in
          counting.async {
            if error == nil { armed += 1 }
            waiting.leave()
          }
        }
      }
      waiting.notify(queue: counting) {
        done(["armed": armed])
      }
    }
  }

  /// The item ids the phone is watching for, without the prefix.
  static func list(done: @escaping ([String]) -> Void) {
    UNUserNotificationCenter.current().getPendingNotificationRequests { pending in
      let mine = pending.map { $0.identifier }
        .filter { $0.hasPrefix(idPrefix) }
        .map { String($0.dropFirst(idPrefix.count)) }
      done(mine.sorted())
    }
  }

  /// Drops every arrival reminder. Used when the switch goes off everywhere, and at sign-out.
  static func clear(done: @escaping () -> Void) {
    UNUserNotificationCenter.current().getPendingNotificationRequests { pending in
      let mine = pending.map { $0.identifier }.filter { $0.hasPrefix(idPrefix) }
      if !mine.isEmpty { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: mine) }
      done()
    }
  }

  /// One item, checked again here. JavaScript checks the same bounds before it calls; this is the floor under it,
  /// so a server that ever sent something odd cannot hand iOS a bad fence or put long words on the lock screen.
  private static func one(_ row: [String: Any]) -> Item? {
    guard let id = row["id"] as? String, ok(id),
          let lat = TulmiArgs.number(row["lat"]), lat >= -90, lat <= 90,
          let lon = TulmiArgs.number(row["lon"]), lon >= -180, lon <= 180 else { return nil }
    let title = ((row["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let body = ((row["body"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return nil }
    let asked = TulmiArgs.number(row["radiusM"]) ?? minRadius
    let radius = min(max(asked, minRadius), maxRadius)
    let screen = (row["screen"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(120)) }
    return Item(
      id: id,
      lat: lat,
      lon: lon,
      radius: radius,
      title: String(title.prefix(60)),
      body: String(body.prefix(140)),
      screen: screen
    )
  }

  /// The only letters an id may hold: `^[a-z0-9_-]{1,64}$`, so an id can never walk out of this feature's own prefix.
  private static let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_-")

  private static func ok(_ id: String) -> Bool {
    guard !id.isEmpty, id.count <= 64 else { return false }
    return id.unicodeScalars.allSatisfy { allowed.contains($0) }
  }

  /// One arrival reminder, after the checks.
  private struct Item {
    let id: String
    let lat: Double
    let lon: Double
    let radius: Double
    let title: String
    let body: String
    let screen: String?
  }
}
