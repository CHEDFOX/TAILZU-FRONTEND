import EventKit
import Foundation

/// ONE REMINDERS LIST, CALLED X0 BOT (perms2/SPEC.md 3).
///
/// `Sync with Reminders` keeps one list in step with Plan Ease's to-dos. This Swift opens THAT LIST AND NOTHING
/// ELSE: it finds it by the identifier it kept, else by its title, else makes it, and every read and every write
/// below checks the item it found really belongs to that list before touching it. No other list's items are ever
/// fetched, counted or named, and the list's identifier — with the small map of which to-do already got which
/// item, so a repeated add writes no copy — stays on the phone (the app's own UserDefaults, not the App Group,
/// so no extension can read it). Both hold opaque ids and nothing else: no title, no date, no account.
///
/// What an item carries, both ways: a title (200 characters), a due date, and whether it is done. Notes, URL,
/// place, priority, alarms, subtasks and the list's other items are never read and never written.
///
/// iOS offers no write-only grant for reminders, so this asks for full access, and the card, the usage string and
/// the review notes all say the app opens only its own list.
final class TulmiReminders {
  /// One store for the life of the module, shared by the ask, the read and the apply (3.4).
  private let store = EKEventStore()

  /// The list's own name, which is also the marker a reinstall finds it by.
  private static let listTitle = "X0 Bot"
  /// Where the list's identifier is kept, on this phone only.
  private static let listKey = "tulmi.reminders.listId"
  /// Which to-do already got which item, so ADDING IS IDEMPOTENT: the server asks again whenever it did not hear
  /// the links back, and a second ask must find the item the first one made instead of writing a copy. Opaque ids
  /// on both sides, nothing else, in the app's own UserDefaults beside the list id.
  private static let linksKey = "tulmi.reminders.links"
  private static let maxLinks = 500
  /// A completed item is sent for a week, so the server can mirror a tick, and then forgotten.
  private static let doneDays: TimeInterval = 7 * 86_400
  private static let maxItems = 500

  // MARK: what the system says

  /// Never prompts, and makes no store. Reminders has no write-only grant, so only 0, 1, 2 and 3 come back.
  static func status() -> String {
    return TulmiEventWords.word(EKEventStore.authorizationStatus(for: .reminder))
  }

  /// The system sheet, only after the app's own card's Continue. iOS 17+ only (the caller checks first).
  @available(iOS 17.0, *)
  func ask(done: @escaping (String) -> Void) {
    store.requestFullAccessToReminders { granted, _ in
      done(granted ? "granted" : "denied")
    }
  }

  // MARK: the read

  /// The X0 Bot list's open items, plus the ones ticked in the last week. Answers `{ listId, items }`, or a short
  /// code when the list could not be opened or made.
  func read(done: @escaping ([String: Any]?, String?) -> Void) {
    guard let list = list() else {
      done(nil, "no_list")
      return
    }
    let cutoff = Date().addingTimeInterval(-TulmiReminders.doneDays)
    let predicate = store.predicateForReminders(in: [list])
    // The fetch hands back a token for cancelling, which this never needs: one read, then the answer.
    _ = store.fetchReminders(matching: predicate) { found in
      var items: [[String: Any]] = []
      for reminder in found ?? [] {
        guard items.count < TulmiReminders.maxItems else { break }
        // A second guard, so a predicate that ever widened could still not carry another list's item out.
        guard reminder.calendar?.calendarIdentifier == list.calendarIdentifier else { continue }
        if reminder.isCompleted {
          guard let at = reminder.completionDate, at >= cutoff else { continue }
        }
        guard let ext = TulmiReminders.ref(reminder) else { continue }
        let title = (reminder.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var item: [String: Any] = [
          "ext": ext,
          "title": String(title.prefix(200)),
          "dueHasTime": false,
          "done": reminder.isCompleted,
          "changedAt": TulmiReminders.changedAt(reminder),
        ]
        if let due = TulmiReminders.due(reminder.dueDateComponents) {
          item["dueIso"] = due.0
          item["dueHasTime"] = due.1
        }
        items.append(item)
      }
      done(["listId": list.calendarIdentifier, "items": items], nil)
    }
  }

  // MARK: the write

  /// The server's reply, applied to the X0 Bot list only: `{ add, update, remove }`. Answers the links for the
  /// items it added, `[{ id, ext }]`, so the server can tie each to its own to-do. Adding is IDEMPOTENT: this
  /// phone remembers which to-do got which item, so a to-do the server asks about twice (because the links
  /// never reached it) is answered with the same item, not a copy.
  /// `ops["listId"]` is only the read's own echo: this always writes to the list the module itself holds,
  /// never to a list an id in the reply names, so a wrong id can reach nobody else's reminders.
  func apply(_ ops: [String: Any], done: @escaping ([[String: Any]]?, String?) -> Void) {
    guard let list = list() else {
      done(nil, "no_list")
      return
    }
    var applied: [[String: Any]] = []
    var links = TulmiReminders.links()
    let asked = (ops["add"] as? [[String: Any]]) ?? []

    for row in asked {
      guard let id = row["id"] as? String, !id.isEmpty else { continue }
      // ALREADY ADDED ONCE? The links POST may have been lost on its way to the server, so the server asks for
      // the same to-do again. Reuse the item this phone already made for it, rather than leaving the person with
      // "Buy milk" twice in Reminders and, after the next read, twice in Plan Ease.
      if let kept = links[id], let mine = find(kept, in: list) {
        TulmiReminders.fill(mine, from: row)
        do { try store.save(mine, commit: true) } catch { continue }
        applied.append(["id": id, "ext": kept])
        continue
      }
      let reminder = EKReminder(eventStore: store)
      reminder.calendar = list
      TulmiReminders.fill(reminder, from: row)
      // Saved one at a time and committed, because an item has no shareable identifier until it is on disk.
      do { try store.save(reminder, commit: true) } catch { continue }
      guard let ext = TulmiReminders.ref(reminder) else { continue }
      if links.count < TulmiReminders.maxLinks { links[id] = ext }
      applied.append(["id": id, "ext": ext])
    }

    // Keep only the ids the server is still asking about: once it has recorded a link it stops asking, and the
    // entry has done its work. An apply with no adds at all leaves the map alone, because a link whose POST was
    // lost is still needed for the next try.
    if !asked.isEmpty {
      let wanted = Set(asked.compactMap { $0["id"] as? String })
      links = links.filter { wanted.contains($0.key) }
    } else if links.count > TulmiReminders.maxLinks {
      links = [:]
    }
    TulmiReminders.keepLinks(links)

    for row in (ops["update"] as? [[String: Any]]) ?? [] {
      guard let ext = row["ext"] as? String, let reminder = find(ext, in: list) else { continue }
      if let title = row["title"] as? String { reminder.title = String(title.prefix(200)) }
      if row["dueIso"] != nil || row["dueHasTime"] != nil {
        // An update op need not say whether the new due date has a time. When it does not, keep the item's own
        // time-ness: a to-do moved to "20 Nov, 3 pm" must not quietly become an all-day item on 20 Nov, because
        // the save bumps lastModifiedDate and the time-less copy would then win the next "newer wins" merge.
        let said = (row["dueHasTime"] as? NSNumber)?.boolValue
        let had = reminder.dueDateComponents.map { $0.hour != nil || $0.minute != nil } ?? false
        let hasTime = said ?? (had || (row["dueIso"] as? String) != nil)
        reminder.dueDateComponents = TulmiReminders.parts(row["dueIso"] as? String, hasTime: hasTime)
      }
      if let ticked = row["done"] as? NSNumber { reminder.isCompleted = ticked.boolValue }
      do { try store.save(reminder, commit: true) } catch { continue }
    }

    for ext in (ops["remove"] as? [String]) ?? [] {
      guard let reminder = find(ext, in: list) else { continue }
      do { try store.remove(reminder, commit: true) } catch { continue }
    }

    done(applied, nil)
  }

  // MARK: the list, and finding one item in it

  /// The X0 Bot list: the one this phone already made (by identifier, then by title, so a reinstall does not make
  /// a second one), or a new one on the account the person's own reminders go to.
  private func list() -> EKCalendar? {
    let kept = UserDefaults.standard
    if let id = kept.string(forKey: TulmiReminders.listKey), let found = store.calendar(withIdentifier: id),
       found.allowsContentModifications {
      return found
    }
    for calendar in store.calendars(for: .reminder)
    where calendar.title == TulmiReminders.listTitle && calendar.allowsContentModifications {
      kept.set(calendar.calendarIdentifier, forKey: TulmiReminders.listKey)
      return calendar
    }
    guard let source = store.defaultCalendarForNewReminders()?.source
      ?? store.sources.first(where: { $0.sourceType == .local })
      ?? store.sources.first else { return nil }
    let made = EKCalendar(for: .reminder, eventStore: store)
    made.title = TulmiReminders.listTitle
    made.source = source
    do { try store.saveCalendar(made, commit: true) } catch { return nil }
    kept.set(made.calendarIdentifier, forKey: TulmiReminders.listKey)
    return made
  }

  /// The title and due date of an item the server asked for, on its way in. Nothing else is ever written: no
  /// note, URL, place, priority, alarm or subtask.
  private static func fill(_ reminder: EKReminder, from row: [String: Any]) {
    reminder.title = String(((row["title"] as? String) ?? "").prefix(200))
    reminder.dueDateComponents = parts(row["dueIso"] as? String, hasTime: TulmiArgs.flag(row["dueHasTime"]))
  }

  /// The to-do-id-to-item map, on this phone only. Anything that is not a pair of strings is thrown away, so a
  /// value written by an older build can never come back as something else.
  private static func links() -> [String: String] {
    guard let raw = UserDefaults.standard.dictionary(forKey: linksKey) else { return [:] }
    var out: [String: String] = [:]
    for (id, ext) in raw {
      guard let ext = ext as? String, !id.isEmpty, !ext.isEmpty else { continue }
      out[id] = ext
    }
    return out
  }

  private static func keepLinks(_ links: [String: String]) {
    if links.isEmpty {
      UserDefaults.standard.removeObject(forKey: linksKey)
    } else {
      UserDefaults.standard.set(links, forKey: linksKey)
    }
  }

  /// One item of OUR list, by the identifier the read sent out. An item of any other list answers nil, so an
  /// `ext` the server ever got wrong cannot reach somebody's shopping list.
  private func find(_ ext: String, in list: EKCalendar) -> EKReminder? {
    for item in store.calendarItems(withExternalIdentifier: ext) {
      if let reminder = item as? EKReminder, reminder.calendar?.calendarIdentifier == list.calendarIdentifier {
        return reminder
      }
    }
    if let reminder = store.calendarItem(withIdentifier: ext) as? EKReminder,
       reminder.calendar?.calendarIdentifier == list.calendarIdentifier {
      return reminder
    }
    return nil
  }

  /// The opaque identifier an item is matched by. The shareable one first, so the same item on the person's other
  /// iPhone is the same to-do and not a copy; the local one as a fallback for an item not yet synced.
  private static func ref(_ reminder: EKReminder) -> String? {
    if let shared = reminder.calendarItemExternalIdentifier, !shared.isEmpty { return shared }
    let local = reminder.calendarItemIdentifier
    return local.isEmpty ? nil : local
  }

  /// When the item last changed, in UTC, so the server can tell which side changed last against its own
  /// `updated_at`. An item with no date at all reads as the epoch, which always loses that comparison.
  private static func changedAt(_ reminder: EKReminder) -> String {
    let when = reminder.lastModifiedDate ?? reminder.creationDate ?? Date(timeIntervalSince1970: 0)
    let out = ISO8601DateFormatter()
    out.timeZone = TimeZone(secondsFromGMT: 0)
    out.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
    return out.string(from: when)
  }

  /// A due date on its way out. ALWAYS a full date and time with the phone's offset, even when the person set no
  /// time: `dueHasTime` is what says whether the time means anything, and the server keeps that flag beside it.
  private static func due(_ parts: DateComponents?) -> (String, Bool)? {
    guard let parts = parts else { return nil }
    let hasTime = parts.hour != nil || parts.minute != nil
    var calendar = Calendar(identifier: .gregorian)
    let zone = parts.timeZone ?? TimeZone.current
    calendar.timeZone = zone
    guard let when = calendar.date(from: parts) else { return nil }
    let out = ISO8601DateFormatter()
    out.timeZone = zone
    out.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
    return (out.string(from: when), hasTime)
  }

  /// A due date on its way in. Without a time, only the day is set, which is how Reminders shows an all-day item.
  private static func parts(_ iso: String?, hasTime: Bool) -> DateComponents? {
    guard let iso = iso, !iso.isEmpty else { return nil }
    let reader = ISO8601DateFormatter()
    reader.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
    var when = reader.date(from: iso)
    if when == nil {
      reader.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone, .withFractionalSeconds]
      when = reader.date(from: iso)
    }
    guard let when = when else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    let wanted: Set<Calendar.Component> = hasTime ? [.year, .month, .day, .hour, .minute] : [.year, .month, .day]
    return calendar.dateComponents(wanted, from: when)
  }
}
