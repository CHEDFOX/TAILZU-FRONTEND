import EventKit
import EventKitUI
import Foundation
import UIKit

/// THE IPHONE'S OWN CALENDAR (perms2/SPEC.md 2).
///
/// Two quite different things live here, and only the second asks for anything:
///
///   the editor   `Add to my calendar` opens Apple's own event editor, already filled in. On iOS 17 and later it
///                runs OUTSIDE the app, so it needs no calendar access at all, and the app is told only "saved" or
///                "cancel" — never what was saved, never where it was saved. Nothing is read.
///   busy times   `Plan around my calendar` reads WHEN the person is busy for a two-week window: a start, an end
///                and whether it is all day, and nothing else. The event's title, place, notes, people, URL and
///                calendar name are read by this Swift and thrown away here; THEY NEVER CROSS INTO JAVASCRIPT.
///                iOS offers no read-only calendar grant, so this asks for full access (and the card, the usage
///                string and the review notes all say the app reads only the times).
///
/// What this deliberately does not do: no writing through the full-access grant (the editor is the only way an
/// event is ever made), no event search, no reminders (TulmiReminders.swift), no background read, and nothing
/// below iOS 17 — `abilities()` does not name the capability there, so no screen offers it.
final class TulmiCalendar {
  /// One store for the life of the module. EventKit's grant belongs to the app, not to a store, and the ask and
  /// the read share this one so a grant given this launch is seen by the read that follows it.
  private let store = EKEventStore()

  /// At most this many blocks, whatever the caller asks for (the server takes 300).
  private static let maxBlocks = 300

  // MARK: what the system says

  /// Never prompts, and makes no store: EventKit's grant belongs to the app. "denied" also covers iOS 17's
  /// write-only grant, which cannot read a single event, and reading is all this is for.
  static func status() -> String {
    return TulmiEventWords.word(EKEventStore.authorizationStatus(for: .event))
  }

  /// The system sheet, only after the app's own card's Continue. iOS 17+ only (the caller checks first).
  @available(iOS 17.0, *)
  func ask(done: @escaping (String) -> Void) {
    store.requestFullAccessToEvents { granted, _ in
      // Asked just now, so a no is "denied" (the app may ask again another day), not "blocked".
      done(granted ? "granted" : "denied")
    }
  }

  // MARK: busy times

  /// Busy blocks in the window, as `{ s, e, allDay }` in milliseconds. Free, declined and cancelled events are
  /// skipped. Rejects nothing: no grant means no events, which answers as an empty list.
  func busy(fromMs: Double, toMs: Double, cap: Int, done: @escaping ([[String: Any]]) -> Void) {
    let from = Date(timeIntervalSince1970: fromMs / 1000)
    let to = Date(timeIntervalSince1970: toMs / 1000)
    guard fromMs.isFinite, toMs.isFinite, to > from else {
      done([])
      return
    }
    let keep = cap > 0 ? min(cap, TulmiCalendar.maxBlocks) : TulmiCalendar.maxBlocks
    // events(matching:) walks every calendar and can take a moment, so never on the thread that drew the screen.
    DispatchQueue.global(qos: .userInitiated).async { [store = self.store] in
      let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
      var out: [[String: Any]] = []
      for event in found.sorted(by: { ($0.startDate ?? from) < ($1.startDate ?? from) }) {
        guard out.count < keep else { break }
        guard let starts = event.startDate, let ends = event.endDate, ends > starts else { continue }
        // Marked free (a "FYI" day, a birthday feed): not busy.
        if event.availability == .free { continue }
        if event.status == .canceled { continue }
        if TulmiCalendar.declined(event) { continue }
        out.append([
          "s": starts.timeIntervalSince1970 * 1000,
          "e": ends.timeIntervalSince1970 * 1000,
          "allDay": event.isAllDay,
        ])
      }
      done(out)
    }
  }

  /// An invitation this person turned down is not a busy time.
  private static func declined(_ event: EKEvent) -> Bool {
    guard let people = event.attendees else { return false }
    for person in people where person.isCurrentUser && person.participantStatus == .declined {
      return true
    }
    return false
  }

  // MARK: the editor

  /// Apple's own editor, filled in, presented on the top screen. Answers "saved" or "cancel" through `done`.
  /// Returns nil, WITHOUT calling `done`, when the event has no usable start: the module turns that into a
  /// rejection, because "unavailable" is reserved for a phone with no calendar app at all and an iPhone always
  /// has one. The MODULE offers this on iOS 17 and later only — not because of an API (every call here is older
  /// than that) but because only there does the editor run out of process, which is what makes it need no
  /// calendar access.
  func editor(_ fields: [String: Any], host: UIViewController, done: @escaping (String) -> Void) -> TulmiCalendarEditor? {
    let title = (fields["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard let startMs = TulmiArgs.number(fields["startMs"]) else { return nil }
    let job = TulmiCalendarEditor(done: done)
    let screen = job.controller(
      title: String(title.prefix(200)),
      startMs: startMs,
      endMs: TulmiArgs.number(fields["endMs"]),
      allDay: TulmiArgs.flag(fields["allDay"]),
      notes: (fields["notes"] as? String).map { String($0.prefix(2000)) }
    )
    host.present(screen, animated: true)
    return job
  }
}

/// EventKit's status in the words JavaScript knows. The raw values are EventKit's own: 0 not determined,
/// 1 restricted, 2 denied, 3 full access (what iOS 16 called "authorized"), 4 write-only (iOS 17+). Write-only
/// cannot read a single event, so for a busy read it counts as denied. Read cold, a no from an earlier run is
/// "blocked": only Settings can undo it.
enum TulmiEventWords {
  static func word(_ status: EKAuthorizationStatus) -> String {
    switch status.rawValue {
    case 0: return "undetermined"
    case 1, 2: return "blocked"
    case 3: return "granted"
    case 4: return "denied"
    default: return "undetermined"
    }
  }
}

/// One run of Apple's event editor. Held by the module while the system has it, and let go once it answers.
final class TulmiCalendarEditor: NSObject, EKEventEditViewDelegate {
  private let done: (String) -> Void
  private var answered = false
  /// A bare store, never asked for access: on iOS 17 the editor runs out of process and saves for itself.
  private let store = EKEventStore()

  init(done: @escaping (String) -> Void) {
    self.done = done
    super.init()
  }

  func controller(title: String, startMs: Double, endMs: Double?, allDay: Bool, notes: String?) -> EKEventEditViewController {
    let event = EKEvent(eventStore: store)
    event.title = title
    event.isAllDay = allDay
    let starts = Date(timeIntervalSince1970: startMs / 1000)
    event.startDate = starts
    let asked = endMs.map { Date(timeIntervalSince1970: $0 / 1000) }
    if allDay {
      event.endDate = asked.map { max($0, starts) } ?? starts
    } else {
      event.endDate = asked.flatMap { $0 > starts ? $0 : nil } ?? starts.addingTimeInterval(3600)
    }
    // Whatever the caller wrote: the item's own words and the line that says where they came from. The caller
    // never puts a link with a token, or anybody else's data, in here.
    event.notes = notes
    let screen = EKEventEditViewController()
    screen.event = event
    screen.eventStore = store
    screen.editViewDelegate = self
    return screen
  }

  func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
    // .saved is the only yes. .deleted cannot happen on a fresh event, and counts as a no either way.
    let word = action == .saved ? "saved" : "cancel"
    controller.dismiss(animated: true) { [weak self] in
      self?.finish(word)
    }
  }

  private func finish(_ word: String) {
    if answered { return }
    answered = true
    done(word)
  }
}
